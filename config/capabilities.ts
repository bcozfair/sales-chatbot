/**
 * capabilities — "ใครทำอะไรได้บ้าง" ของ Admin Portal ในที่เดียว
 *
 * แผนเต็ม: docs/plan-role-permissions.md · เจ้าของสั่ง 2026-09-18 ว่ากติกาว่าใครทะลุกฎข้อไหนได้
 * "อาจมีการเปลี่ยนแปลงตลอดเวลา" ⇒ ต้องตั้งจากหน้าจอได้ ไม่ใช่ค่าคงที่ที่ต้อง deploy ใหม่ทุกครั้ง
 *
 * ทางที่เลือก — **แคตตาล็อกอยู่ในโค้ด · ค่าอยู่ใน DB · ตารางว่าง = พฤติกรรมวันนี้เป๊ะ**
 *
 *   แคตตาล็อก (ไฟล์นี้)      = มีความสามารถอะไรบ้าง · แต่ละอันโหมดไหนได้ · ค่าเริ่มต้นเท่าไร
 *   ตาราง role_permissions   = เฉพาะช่องที่ถูกแก้จากค่าเริ่มต้น
 *
 * ทำไมไม่เก็บทั้งเมทริกซ์ลง DB: แถวที่ค้างอยู่จะกลายเป็นคำตอบเก่าในวันที่แคตตาล็อกเปลี่ยน และ
 * ระบบจะไม่มีทางตอบได้ว่า "ค่าที่ถูกต้องของวันนี้คืออะไร" ⇒ ของที่ไม่มีใครแก้ ต้องไม่มีแถว
 *
 * ทำไมไม่ทำ per-user override: สิทธิ์ผูกกับ role เท่านั้น คนที่ต้องการสิทธิ์ต่างออกไป = เปลี่ยน role
 * (ถ้าวันหนึ่งต้องมีจริง ตารางต่อเติมได้โดยไม่ต้องรื้อ — เพิ่มคอลัมน์ user_id ที่ NULL = ทั้ง role)
 *
 * ⚠️ ไฟล์นี้ **ไม่ใช่ด่านตรวจกฎ** — มันตอบแค่ว่า "role นี้อยู่โหมดไหน" การบังคับใช้จริงยังอยู่ที่
 *    `blockingViolations()` ใน services/quotationService.ts ที่เดียวเหมือนเดิม โหมดที่ได้จากที่นี่
 *    เป็น *ข้อมูลที่ส่งเข้าไป* ไม่ใช่ตรรกะชุดที่สอง (ไม่งั้นใบจากเว็บกับจาก LINE จะคิดคนละแบบ)
 */
import type { Violation } from '../services/quotationService.js';
import type { Role } from './auth.js';
import { getRolePermissionRows } from '../db/repositories.js';

/**
 * โหมดของหนึ่งช่องในเมทริกซ์
 *   deny     = ทำไม่ได้ ไม่มีทางปลด
 *   approval = ทำได้ถ้ามีคนอนุมัติให้ (คิวเดียวกับอนุมัติราคาต่ำกว่าขั้นต่ำ)
 *   allow    = ทำได้เอง (กฎ = ติ๊กรับทราบเองได้ · ความสามารถ = ใช้ได้)
 */
export type PermissionMode = 'deny' | 'approval' | 'allow';

export const PERMISSION_MODES: readonly PermissionMode[] = ['deny', 'approval', 'allow'];

/** role ทั้งหมดที่มีช่องในเมทริกซ์ — ต้องตรงกับ CHECK constraint admin_users_role_check */
export const ROLES: readonly Role[] = ['admin', 'approver', 'subadmin', 'salesperson', 'user'];

/**
 * ชนิดกฎที่ "มีสวิตช์ได้"
 *
 * `SYSTEM_ERROR` ไม่อยู่ในนี้และต้องไม่มีวันอยู่ — มันแปลว่า *ยังไม่รู้ว่าผิดหรือไม่* ไม่ใช่
 * *ผิดข้อนี้* การให้สวิตช์กับมันคือการเปลี่ยนด่าน fail-closed ให้เป็น fail-open โดยใช้หน้าจอ
 * เป็นข้ออ้าง · `satisfies` ข้างล่างทำให้ชื่อที่พิมพ์ผิดหรือกฎที่ถูกลบออกจาก Violation ล้มตอน
 * typecheck แทนที่จะกลายเป็นช่องที่กดแล้วไม่มีผลอะไร
 */
export const SWITCHABLE_VIOLATION_TYPES = [
  'BLOCKED',
  'OUT_OF_STOCK',
  'MOQ_VIOLATION',
  'MIN_PRICE_VIOLATION',
  'CUSTOMER_BLACKLISTED',
  'CUSTOMER_CREDIT_HOLD',
] as const satisfies readonly Violation['type'][];

export type SwitchableViolationType = (typeof SWITCHABLE_VIOLATION_TYPES)[number];

export type RuleCapability = `rule.${SwitchableViolationType}`;

export type QuoteCapability =
  | 'quote.create'
  | 'quote.revise'
  | 'quote.view_all'
  | 'quote.export_odoo'
  | 'quote.unmark_export'
  | 'quote.payment_terms_override'
  | 'quote.act_as_any_salesperson'
  | 'approval.decide'
  | 'users.set_issuer_identity';

export type Capability = RuleCapability | QuoteCapability;

export interface CapabilityDef {
  key: Capability;
  /** 'rule' = ทะลุกฎข้อนั้นได้แค่ไหน · 'quote' = ทำงานกับใบ/ระบบได้แค่ไหน */
  group: 'rule' | 'quote';
  label: string;
  /**
   * โหมดที่เลือกได้ของช่องนี้ — กฎเป็นสามค่า ความสามารถเป็นสวิตช์สองค่า
   * (หน้าจอใช้ค่านี้ตัดสินว่าจะวาด dropdown หรือสวิตช์ · ฝั่ง server ใช้ปฏิเสธค่าที่ไม่เข้าพวก)
   */
  modes: readonly PermissionMode[];
  defaults: Record<Role, PermissionMode>;
  /** จุดบังคับใช้จริง — เขียนไว้ให้คนตามโค้ดเจอ ไม่ได้ถูกอ่านตอนรัน */
  enforcedAt: string;
}

const THREE: readonly PermissionMode[] = ['deny', 'approval', 'allow'];
const SWITCH: readonly PermissionMode[] = ['deny', 'allow'];

/**
 * ค่าเริ่มต้นของกฎที่วันนี้ "ติ๊กรับทราบเองได้ทุก role ที่ออกใบได้"
 * — salesperson เป็นคอลัมน์ใหม่ทั้งคอลัมน์ ไม่ได้เปลี่ยนของใคร
 */
const selfAck = (salesperson: PermissionMode): Record<Role, PermissionMode> => ({
  admin: 'allow',
  approver: 'allow',
  subadmin: 'allow',
  salesperson,
  // `user` = บัญชีห้ามเสนอราคา เข้าหน้าออกใบไม่ได้อยู่แล้ว ⇒ deny คือคำตอบที่ตรงกับความจริง
  // และทำให้ไม่มีช่องว่างเงียบ ๆ ถ้าวันหนึ่งมีใครเปิดเมนูให้ role นี้
  user: 'deny',
});

const switchFor = (
  admin: PermissionMode,
  approver: PermissionMode,
  subadmin: PermissionMode,
  salesperson: PermissionMode
): Record<Role, PermissionMode> => ({ admin, approver, subadmin, salesperson, user: 'deny' });

/**
 * แคตตาล็อกทั้งฉบับ — เพิ่มความสามารถใหม่ = เติมที่นี่ที่เดียว
 *
 * ค่าเริ่มต้นของ admin/approver/subadmin ทุกช่อง **คือพฤติกรรมของวันนี้** ตรวจซ้ำได้ที่
 * `npm run diag:role-permissions` ข้อ 1 ⇒ ขึ้นระบบแล้วไม่มีใครรู้สึกว่ามีอะไรเปลี่ยน
 */
export const CAPABILITIES: readonly CapabilityDef[] = [
  // ── ก. การทะลุกฎ ───────────────────────────────────────────────────────────
  {
    key: 'rule.BLOCKED',
    group: 'rule',
    label: 'สินค้าที่ถูกระงับการเสนอราคา',
    modes: THREE,
    defaults: selfAck('approval'),
    enforcedAt: 'services/webQuoteService.ts (createDraftFromWeb)',
  },
  {
    key: 'rule.OUT_OF_STOCK',
    group: 'rule',
    label: 'สินค้าไม่พอในสต็อก',
    modes: THREE,
    defaults: selfAck('approval'),
    enforcedAt: 'services/webQuoteService.ts (createDraftFromWeb)',
  },
  {
    key: 'rule.MOQ_VIOLATION',
    group: 'rule',
    label: 'จำนวนต่ำกว่าขั้นต่ำการสั่งซื้อ',
    modes: THREE,
    defaults: selfAck('approval'),
    enforcedAt: 'services/webQuoteService.ts (createDraftFromWeb)',
  },
  {
    key: 'rule.MIN_PRICE_VIOLATION',
    group: 'rule',
    label: 'ราคาต่ำกว่าราคาขั้นต่ำ',
    modes: THREE,
    // ทุก role เป็น approval อยู่แล้วตั้งแต่ 2026-09-15 (docs/plan-quote-price-approval.md)
    // — ช่องนี้ไม่ได้เปลี่ยนอะไรเลย แค่ย้ายค่าที่เคยเป็น APPROVAL_REQUIRED_TYPES มาให้แก้ได้
    defaults: { admin: 'approval', approver: 'approval', subadmin: 'approval', salesperson: 'approval', user: 'deny' },
    enforcedAt: 'services/quotationService.ts (blockingViolations) + priceApprovalService.ts',
  },
  {
    key: 'rule.CUSTOMER_BLACKLISTED',
    group: 'rule',
    label: 'ลูกค้าอยู่ในบัญชีห้ามเสนอราคา',
    modes: THREE,
    // เสนอเป็น deny สำหรับเซลส์: blacklist กับเครดิตค้างเป็นเรื่องของ *ตัวลูกค้า* ไม่ใช่ของใบ
    // คนที่ปลดควรเป็นคนที่แก้สถานะลูกค้าได้ ไม่ใช่คนที่กดอนุมัติใบทีละใบ · เปลี่ยนจากหน้าจอได้ทันที
    defaults: selfAck('deny'),
    enforcedAt: 'services/webQuoteService.ts (createDraftFromWeb)',
  },
  {
    key: 'rule.CUSTOMER_CREDIT_HOLD',
    group: 'rule',
    label: 'ลูกค้าติดเงื่อนไขเครดิต',
    modes: THREE,
    defaults: selfAck('deny'),
    enforcedAt: 'services/webQuoteService.ts (createDraftFromWeb)',
  },

  // ── ข. การทำงานกับใบ ──────────────────────────────────────────────────────
  {
    key: 'quote.create',
    group: 'quote',
    label: 'ขอใบเสนอราคาจากหน้าเว็บ',
    modes: SWITCH,
    defaults: switchFor('allow', 'allow', 'allow', 'allow'),
    enforcedAt: 'POST /api/admin/webquote/drafts',
  },
  {
    key: 'quote.revise',
    group: 'quote',
    label: 'แก้ใบเดิมแล้วออกใหม่ (revise)',
    modes: SWITCH,
    defaults: switchFor('allow', 'allow', 'allow', 'allow'),
    enforcedAt: 'POST /api/admin/webquote/revise',
  },
  {
    key: 'quote.view_all',
    group: 'quote',
    label: 'เห็นใบของทุกคนในประวัติใบเสนอราคา',
    modes: SWITCH,
    // ปิดช่องนี้ = เห็นเฉพาะใบของรหัสพนักงานขายที่ผูกไว้กับบัญชี (admin_user_salespersons)
    // ตัวกรองต้องมีผลกับ export และตัวนับด้วย ไม่ใช่แค่หน้าประวัติ (P2)
    defaults: switchFor('allow', 'allow', 'allow', 'deny'),
    enforcedAt: 'GET /api/admin/quotations (+ export, counts)',
  },
  {
    key: 'quote.export_odoo',
    group: 'quote',
    label: 'ส่งออกไฟล์เข้า Odoo',
    modes: SWITCH,
    defaults: switchFor('allow', 'allow', 'allow', 'deny'),
    enforcedAt: 'GET /api/admin/quotations/export',
  },
  {
    key: 'quote.unmark_export',
    group: 'quote',
    label: 'ถอยเครื่องหมาย "ส่งออกแล้ว"',
    modes: SWITCH,
    defaults: switchFor('allow', 'allow', 'allow', 'deny'),
    enforcedAt: 'POST /api/admin/quotations/unmark-export · …/export-batches/:id/unmark',
  },
  {
    key: 'quote.payment_terms_override',
    group: 'quote',
    label: 'ตั้งเครดิตทับเฉพาะใบนั้น',
    modes: SWITCH,
    defaults: switchFor('allow', 'allow', 'allow', 'deny'),
    enforcedAt: 'services/webQuoteService.ts (propose/preview/drafts)',
  },
  {
    key: 'quote.act_as_any_salesperson',
    group: 'quote',
    label: 'เลือกพนักงานขายคนไหนก็ได้ตอนออกใบ',
    modes: SWITCH,
    // ปิดช่องนี้ = เลือกได้เฉพาะรหัสของตัวเอง ⇒ เซลส์ทั่วไปมีตัวเลือกเดียว = ถูกล็อกโดยปริยาย
    defaults: switchFor('allow', 'allow', 'allow', 'deny'),
    enforcedAt: 'services/salespersonPicker.ts + ตอนสร้างร่าง',
  },
  {
    key: 'approval.decide',
    group: 'quote',
    label: 'อนุมัติ / ไม่อนุมัติคำขอ',
    modes: SWITCH,
    defaults: switchFor('allow', 'allow', 'deny', 'deny'),
    enforcedAt: 'services/priceApprovalService.ts (canDecideApproval)',
  },
  {
    key: 'users.set_issuer_identity',
    group: 'quote',
    label: 'ตั้งชื่อผู้เสนอราคา/ลายเซ็นให้บัญชีอื่น',
    modes: SWITCH,
    // การตั้งชื่อ "ของตัวเอง" ถูกถอดออกจากทุก role โดยตั้งใจ (§4ข) — ของที่ไม่ควรมีใครทำได้
    // ไม่ควรมีสวิตช์ เพราะสวิตช์คือคำเชิญให้เปิด
    defaults: switchFor('allow', 'deny', 'deny', 'deny'),
    enforcedAt: 'หน้าจัดการผู้ใช้ (P3.5)',
  },
];

const BY_KEY = new Map<Capability, CapabilityDef>(CAPABILITIES.map(c => [c.key, c]));

export const capabilityDef = (key: Capability): CapabilityDef | undefined => BY_KEY.get(key);

/** คีย์ของกฎหนึ่งข้อ — ใช้แปลง Violation['type'] เป็นชื่อความสามารถ */
export const ruleCapability = (type: SwitchableViolationType): RuleCapability => `rule.${type}`;

/** `SYSTEM_ERROR` ตอบ false ที่นี่ และนั่นคือคำตอบที่ถูก (ไม่มีสวิตช์ = ไม่มีทางปลด) */
export function isSwitchableViolationType(type: string): type is SwitchableViolationType {
  return (SWITCHABLE_VIOLATION_TYPES as readonly string[]).includes(type);
}

export type CapabilityMap = Record<Capability, PermissionMode>;

function defaultsFor(role: Role): CapabilityMap {
  const out = {} as CapabilityMap;
  for (const def of CAPABILITIES) out[def.key] = def.defaults[role];
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  cache — ตารางนี้ถูกอ่านทุก request แต่ถูกแก้ปีละไม่กี่ครั้ง
//
//  หน้าตั้งค่าต้องเรียก invalidateCapabilityCache() ทุกครั้งที่บันทึก เพราะคนตั้งค่าจะกดทดสอบ
//  ทันทีที่กดเสร็จ · TTL เป็นแค่ตาข่ายเผื่อมีคนแก้ DB ตรง ๆ · ระบบรัน Node โปรเซสเดียว
//  ต่อหนึ่ง container จึงไม่ต้องมี invalidation ข้ามเครื่อง (เหมือน services/rules/cache.ts)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 60_000;

interface Overrides {
  /** role → capability → mode (เฉพาะช่องที่ถูกแก้และผ่านการตรวจแล้ว) */
  byRole: Map<string, Map<string, PermissionMode>>;
  loadedAt: number;
}

let cached: Overrides | null = null;
let inflight: Promise<Overrides> | null = null;

function cacheTtlMs(): number {
  const raw = process.env.ROLE_PERMISSIONS_CACHE_TTL_MS;
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TTL_MS;
}

export function invalidateCapabilityCache(): void {
  cached = null;
  inflight = null;
}

async function loadOverrides(): Promise<Overrides> {
  const rows = await getRolePermissionRows();

  // null = อ่านฐานไม่สำเร็จ (ไม่ใช่ "ตารางว่าง" ซึ่งเป็นสถานะปกติ) ⇒ ใช้ค่าที่ cache ไว้ล่าสุดต่อ
  // ถ้ายังไม่เคยอ่านสำเร็จเลยก็ตกไปที่ค่าเริ่มต้น — ไม่ปล่อยให้คำขอล้มเพราะตารางตั้งค่าอ่านไม่ได้
  if (rows === null) return cached ?? { byRole: new Map(), loadedAt: Date.now() };

  const byRole = new Map<string, Map<string, PermissionMode>>();
  for (const row of rows) {
    const role = String(row.role ?? '');
    const capability = String(row.capability ?? '');
    const mode = String(row.mode ?? '') as PermissionMode;

    // แถวที่โค้ดไม่รู้จักถูกมองข้ามเงียบ ๆ โดยตั้งใจ — ความสามารถที่ถูกถอดออกจากแคตตาล็อกแล้ว
    // ต้องไม่ทำให้ระบบล้ม และ DB เก่ากว่าโค้ดเป็นสถานะปกติระหว่าง deploy
    const def = BY_KEY.get(capability as Capability);
    if (!def) continue;

    // โหมดที่ไม่เข้าพวกกับช่องนั้น (เช่น 'approval' ในช่องที่เป็นสวิตช์) = ข้อมูลที่ไม่ควรมี
    // ⇒ ถอยไปใช้ค่าเริ่มต้นแทนการเดา และส่งเสียงไว้ใน log ให้ตามเจอ
    if (!def.modes.includes(mode)) {
      console.warn(`[capabilities] โหมดไม่ถูกต้อง ข้ามไป: ${role}/${capability} = ${mode}`);
      continue;
    }

    let forRole = byRole.get(role);
    if (!forRole) byRole.set(role, (forRole = new Map()));
    forRole.set(capability, mode);
  }

  return { byRole, loadedAt: Date.now() };
}

async function overrides(): Promise<Overrides> {
  const ttl = cacheTtlMs();
  if (ttl === 0) return await loadOverrides();

  if (cached && Date.now() - cached.loadedAt < ttl) return cached;
  if (inflight) return await inflight;

  inflight = loadOverrides()
    .then(next => {
      cached = next;
      return next;
    })
    .finally(() => {
      inflight = null;
    });

  return await inflight;
}

/**
 * เมทริกซ์ของ role หนึ่งแถว = ค่าเริ่มต้นที่ถูกทับด้วยค่าใน DB
 *
 * **แถวของ `admin` ถูกล็อก** — ค่าใน DB ถูกมองข้ามทั้งแถว เพราะถ้าเผลอปิดสิทธิ์ของ admin
 * จะไม่เหลือใครที่เปิดกลับได้ และการกู้ต้องลงมือที่ฐานข้อมูลโดยตรง (ฝั่งเขียนก็ต้องปฏิเสธด้วย)
 */
export async function capsOf(role: Role): Promise<CapabilityMap> {
  const base = defaultsFor(role);
  if (role === 'admin') return base;

  const forRole = (await overrides()).byRole.get(role);
  if (!forRole) return base;

  for (const [capability, mode] of forRole) base[capability as Capability] = mode;
  return base;
}

/** โหมดของช่องเดียว */
export async function modeOf(role: Role, capability: Capability): Promise<PermissionMode> {
  return (await capsOf(role))[capability];
}

/**
 * ทำได้เองเลยไหม — `approval` ตอบ false เพราะ "ต้องมีคนอนุมัติก่อน" ยังไม่ใช่ "ทำได้"
 * เส้นทางที่รองรับการขออนุมัติต้องอ่าน `modeOf()` เอง เพื่อไม่ให้ใครเผลอมองว่าสองอย่างนี้เท่ากัน
 */
export async function can(role: Role, capability: Capability): Promise<boolean> {
  return (await modeOf(role, capability)) === 'allow';
}
