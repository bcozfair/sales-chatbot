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
import { getRolePermissionRows, getAdminSalespersonIds, type OwnQuotesScope } from '../db/repositories.js';

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

/**
 * หน้าจอที่เข้าถึงได้ — หนึ่งช่องต่อหนึ่งเมนูใน Admin Portal (เจ้าของสั่งเพิ่ม 2026-09-18)
 *
 * ค่าเริ่มต้นของทุกช่อง **คัดลอกมาจาก `roles: [...]` ที่เขียนไว้ตายตัวใน AdminApp.tsx วันนี้**
 * ⇒ ตารางว่าง = เมนูของทุกคนเหมือนเดิมเป๊ะ
 *
 * ⚠️ **การซ่อนเมนูไม่ใช่ด่านตรวจ** — ช่องพวกนี้ต้องถูกบังคับที่ route ของหน้านั้นด้วย ไม่งั้น
 *    เปิดเมนูให้ใครแล้วเขาจะเห็นหน้าที่ยิง API ไม่ผ่านสักเส้น ซึ่งแย่กว่าไม่เห็นเมนูเลย
 *    (จุดบังคับของแต่ละช่องเขียนไว้ที่ `enforcedAt` ของมันเอง)
 *
 * ⚠️ **หน้า "สิทธิ์ตามบทบาท" เองไม่อยู่ในรายการนี้โดยตั้งใจ** — ความสามารถที่ปิดตัวเองได้
 *    คือความสามารถที่ล็อกคนสุดท้ายออกจากระบบได้ · มันเป็นของ `admin` ล้วนตลอดไป
 */
export type PageCapability =
  | 'page.dashboard'
  | 'page.approvals'
  | 'page.quotations'
  | 'page.settings_quotation'
  | 'page.promotions'
  | 'page.settings_optional'
  | 'page.settings_stock'
  | 'page.settings_moq'
  | 'page.settings_block'
  | 'page.settings_shipping'
  | 'page.pricing'
  | 'page.productsdata'
  | 'page.customersdata'
  | 'page.odoocontacts'
  | 'page.blacklist'
  | 'page.salespersons'
  | 'page.users'
  | 'page.traffic';

export type QuoteCapability =
  | 'quote.create'
  | 'quote.revise'
  | 'quote.view_all'
  | 'quote.export_odoo'
  | 'quote.unmark_export'
  | 'quote.payment_terms_override'
  | 'quote.manage_contacts'
  | 'quote.act_as_any_salesperson'
  | 'approval.decide'
  | 'users.set_issuer_identity';

export type Capability = RuleCapability | QuoteCapability | PageCapability;

export interface CapabilityDef {
  key: Capability;
  /**
   * 'rule' = ทะลุกฎข้อนั้นได้แค่ไหน · 'quote' = ทำงานกับใบ/ระบบได้แค่ไหน ·
   * 'page' = เข้าหน้าจอไหนได้บ้าง (หน้าจอวาดเป็นสามกลุ่มตามค่านี้)
   */
  group: 'rule' | 'quote' | 'page';
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
 * ⚠️ **คอลัมน์ `salesperson` คือค่าที่เจ้าของตั้งเองจากหน้าจอ ไม่ใช่ค่าที่ใครเสนอ**
 *    (ตั้ง 2026-09-23 แล้วสั่งให้ยึดเป็นค่าเริ่มต้น — ที่มาของตัวเลขคือ `role_permissions`
 *    ของจริง 4 แถว ทับบนค่าเริ่มต้นชุดก่อนหน้า · ที่มาเต็มอยู่ที่ §14.5)
 *
 *    เซลส์ **ออกใบและแก้ใบได้ เห็นหน้าประวัติและหน้าอนุมัติราคาได้**
 *    แต่ **ทะลุกฎไม่ได้เลยสักข้อ** — กฎทั้ง 6 เป็น `deny` ล้วน ไม่มีแม้แต่ทางขออนุมัติ
 *    ซึ่งตรงกับนิยามของ role ที่เขียนไว้ตั้งแต่แรกใน `config/auth.ts`
 *    ("ออกใบ/แก้ใบเองได้ แต่ทะลุกฎเองไม่ได้") · ที่เหลือทั้งหมดเป็น `deny`
 *
 * ⚠️ **`rule.MIN_PRICE_VIOLATION` = `deny` ไม่ใช่ `approval`** ⇒ เซลส์ที่ตั้งราคาต่ำกว่าขั้นต่ำ
 *    จะถูกบล็อกตรงนั้นเลย **ไม่มีคำขอเข้าคิวอนุมัติ** · นี่คือช่องเดียวที่ถ้าอ่านผ่าน ๆ จะนึกว่า
 *    มันเข้าคิว เพราะ role อื่นทุกตัวเป็น `approval` · จะเปิดคิวให้เซลส์ต้องตั้งช่องนี้เป็น
 *    `approval` จากหน้าจอ (และดู §11 ข้อ 4 เรื่องจำนวนผู้อนุมัติก่อน)
 *
 * ⇒ `npm run diag:role-permissions` ข้อ 1 ตรึงคอลัมน์นี้ไว้ทั้งคอลัมน์ ใครแก้ค่าเริ่มต้นของเซลส์
 *   โดยไม่ได้ตั้งใจ (เช่น copy-paste `switchFor` มาทั้งบรรทัดตอนเพิ่มความสามารถใหม่) ด่านจะล้ม
 *   พร้อมบอกช่องที่ต่าง แทนที่จะกลายเป็นสิทธิ์ที่เซลส์ได้ไปโดยไม่มีใครสั่ง
 *
 * ค่าเริ่มต้นของกฎที่วันนี้ "ติ๊กรับทราบเองได้ทุก role ที่ออกใบได้"
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
    defaults: selfAck('deny'),
    enforcedAt: 'services/webQuoteService.ts (createDraftFromWeb)',
  },
  {
    key: 'rule.OUT_OF_STOCK',
    group: 'rule',
    label: 'สินค้าไม่พอในสต็อก',
    modes: THREE,
    defaults: selfAck('deny'),
    enforcedAt: 'services/webQuoteService.ts (createDraftFromWeb)',
  },
  {
    key: 'rule.MOQ_VIOLATION',
    group: 'rule',
    label: 'จำนวนต่ำกว่าขั้นต่ำการสั่งซื้อ',
    modes: THREE,
    defaults: selfAck('deny'),
    enforcedAt: 'services/webQuoteService.ts (createDraftFromWeb)',
  },
  {
    key: 'rule.MIN_PRICE_VIOLATION',
    group: 'rule',
    label: 'ราคาต่ำกว่าราคาขั้นต่ำ',
    modes: THREE,
    // admin/approver/subadmin เป็น approval อยู่แล้วตั้งแต่ 2026-09-15
    // (docs/plan-quote-price-approval.md) — ช่องนี้ไม่ได้เปลี่ยนของใคร แค่ย้ายค่าที่เคยเป็น
    // APPROVAL_REQUIRED_TYPES มาให้แก้ได้
    // ⚠️ **เซลส์เป็น `deny` ไม่ใช่ `approval`** (เจ้าของตั้งเอง 2026-09-23) ⇒ ราคาต่ำกว่าขั้นต่ำ
    //    ของเซลส์ **ถูกบล็อกตรงนั้น ไม่เข้าคิวอนุมัติ** · เป็น role เดียวที่ไม่ใช่ approval
    //    เปิดคิวเมื่อไหร่ให้ตั้งช่องนี้เป็น approval จากหน้าจอ (ตั้ง allow = ไม่ต้องขอใครเลย)
    defaults: { admin: 'approval', approver: 'approval', subadmin: 'approval', salesperson: 'deny', user: 'deny' },
    enforcedAt: 'services/quotationService.ts (blockingViolations) + priceApprovalService.ts',
  },
  {
    key: 'rule.CUSTOMER_BLACKLISTED',
    group: 'rule',
    label: 'ลูกค้าอยู่ในบัญชีห้ามเสนอราคา',
    modes: THREE,
    // blacklist กับเครดิตค้างเป็นเรื่องของ *ตัวลูกค้า* ไม่ใช่ของใบ คนที่ปลดควรเป็นคนที่แก้
    // สถานะลูกค้าได้ ไม่ใช่คนที่กดอนุมัติใบทีละใบ ⇒ เซลส์เป็น deny · เปลี่ยนจากหน้าจอได้ทันที
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
    // อยู่กลุ่ม 'page' เพราะมันคือ **ทั้งหน้า** "ขอใบเสนอราคา" ไม่ใช่ฟังก์ชันย่อยในหน้านั้น —
    // ปิดช่องนี้แล้วทั้ง 8 เส้นของหน้านั้นตอบ 403 และเมนูหายไปพร้อมกัน ⇒ ไม่ต้องมีสวิตช์ที่สอง
    // ชื่อ key ยังเป็น quote.create เหมือนเดิม เพราะมันถูกอ้างที่ route 8 จุดแล้วตั้งแต่ P2
    key: 'quote.create',
    group: 'page',
    label: 'ขอใบเสนอราคา',
    modes: SWITCH,
    defaults: switchFor('allow', 'allow', 'allow', 'allow'),
    enforcedAt: '/api/admin/webquote/* 8 เส้น (makers · me · salespersons · payment-terms · propose · preview · preview-pdf · drafts)',
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
    key: 'quote.manage_contacts',
    group: 'quote',
    label: 'เพิ่ม/แก้ผู้ติดต่อใหม่ใต้บริษัทเดิม',
    modes: SWITCH,
    // เจ้าของเคาะ 2026-09-17: ฟีเจอร์นี้อยู่บนหน้าเว็บเท่านั้น ไม่เปิดให้ฝั่ง LINE
    // เพราะคนใน LINE คือเซลส์ ไม่ใช่แอดมิน (docs/plan-local-contacts.md §9 ข้อ 1)
    //
    // ⚠️ "เพิ่มจาก LINE ไม่ได้" ≠ "ไม่โผล่ใน LINE" — ผู้ติดต่อที่แอดมินเพิ่มอยู่ใน
    //    customers_data_view ⇒ โผล่ใน picker ของ LIFF และในแชทด้วย และเซลส์ออกใบให้คนนั้นได้
    //    ช่องนี้คุมแค่ "ใครสร้างได้" ไม่ได้คุมว่า "ใครเห็น"
    defaults: switchFor('allow', 'allow', 'allow', 'deny'),
    enforcedAt: 'จุด mount /api/admin/webquote/contacts ใน index.ts (5 เส้น)',
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
    enforcedAt: 'services/priceApprovalService.ts (canDecideApproval) + 3 route ที่ตัดสินคำขอ (items · approve · reject)',
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

  // ── ค. หน้าจอที่เข้าถึงได้ ──────────────────────────────────────────────────
  //  ค่าเริ่มต้นทุกช่องคัดลอกจาก `roles: [...]` ใน AdminApp.tsx วันนี้ ⇒ ตารางว่าง = เมนูเหมือนเดิม
  //  ทุกช่องบังคับที่ route ของหน้านั้นจริงแล้ว (P3c) — `enforcedAt` คือรายการเส้นที่มันคุม
  //  ⚠️ เพิ่มช่องใหม่ในกลุ่มนี้ = ต้องเติมด่านที่ route ด้วยเสมอ ไม่งั้นเปิดเมนูให้ใครแล้วเขาจะเห็น
  //     หน้าที่ยิง API ไม่ผ่านสักเส้น ซึ่งแย่กว่าไม่เห็นเมนูเลย
  {
    key: 'page.dashboard',
    group: 'page',
    label: 'แผงควบคุม',
    modes: SWITCH,
    defaults: switchFor('allow', 'deny', 'deny', 'deny'),
    enforcedAt: 'GET /api/admin/stats · /api/admin/sync/* (4 เส้น)',
  },
  {
    key: 'page.approvals',
    group: 'page',
    label: 'อนุมัติราคา',
    modes: SWITCH,
    defaults: switchFor('allow', 'allow', 'allow', 'allow'),
    enforcedAt: '/api/admin/approvals/* ทั้ง 8 เส้น (3 เส้นที่ตัดสินคำขอซ้อน approval.decide อีกชั้น)',
  },
  {
    key: 'page.quotations',
    group: 'page',
    label: 'ประวัติใบเสนอราคา',
    modes: SWITCH,
    defaults: switchFor('allow', 'allow', 'allow', 'allow'),
    enforcedAt: '/api/admin/quotations/* ทั้ง 7 เส้น (เส้นที่มีด่านของตัวเองอยู่แล้วถูกซ้อนไว้ข้างหน้า)',
  },
  {
    key: 'page.settings_quotation',
    group: 'page',
    label: 'เงื่อนไขหลัก',
    modes: SWITCH,
    defaults: switchFor('allow', 'deny', 'deny', 'deny'),
    enforcedAt: '/api/admin/quotation-rules/* (5 เส้น)',
  },
  {
    key: 'page.promotions',
    group: 'page',
    label: 'จัดการโปรโมชันส่วนลด',
    modes: SWITCH,
    defaults: switchFor('allow', 'deny', 'deny', 'deny'),
    enforcedAt: '/api/admin/promotions/* (7) + /api/admin/products/search · /customers/search · /customers/types (ช่องค้นหาในตัวแก้โปรโมชัน)',
  },
  {
    key: 'page.settings_optional',
    group: 'page',
    label: 'สินค้าพ่วงเสริม',
    modes: SWITCH,
    defaults: switchFor('allow', 'deny', 'deny', 'deny'),
    enforcedAt: '/api/admin/optional-links/* (4 เส้น)',
  },
  {
    key: 'page.settings_stock',
    group: 'page',
    label: 'ระงับเมื่อหมดสต็อก',
    modes: SWITCH,
    defaults: switchFor('allow', 'deny', 'deny', 'deny'),
    enforcedAt: '/api/admin/stock-rules/* (6 เส้น)',
  },
  {
    key: 'page.settings_moq',
    group: 'page',
    label: 'ขั้นต่ำสั่งซื้อ',
    modes: SWITCH,
    defaults: switchFor('allow', 'deny', 'deny', 'deny'),
    enforcedAt: '/api/admin/moq-rules/* (4 เส้น)',
  },
  {
    key: 'page.settings_block',
    group: 'page',
    label: 'บล็อกสินค้า',
    modes: SWITCH,
    defaults: switchFor('allow', 'deny', 'deny', 'deny'),
    enforcedAt: '/api/admin/block-rules/* (5 เส้น)',
  },
  {
    key: 'page.settings_shipping',
    group: 'page',
    label: 'ค่าขนส่ง & เครดิต',
    modes: SWITCH,
    defaults: switchFor('allow', 'deny', 'deny', 'deny'),
    enforcedAt: '/api/admin/shipping-fee-config · /api/admin/credit-policy (อย่างละ GET+PUT)',
  },
  {
    // โมดูลทดลอง (services/pricingLab/) — ยังไม่ต่อกับใบเสนอราคา คิดราคาให้ดูอย่างเดียว
    // ค่าเริ่มต้น admin คนเดียว เพราะเป็นหน้าที่ยังไม่เคยมี ⇒ ไม่มีใครเสียสิทธิ์ที่เคยมี
    // และเจ้าของเปิดให้ role อื่นเองได้จากหน้าเมทริกซ์สิทธิ์เมื่อพร้อมให้คนทดลอง
    key: 'page.pricing',
    group: 'page',
    label: 'คิดราคาสินค้า',
    modes: SWITCH,
    defaults: switchFor('allow', 'deny', 'deny', 'deny'),
    enforcedAt: 'app.use(/api/admin/pricing) — ด่านวางก่อนจุด mount ของ pricingLabRouter',
  },
  {
    key: 'page.productsdata',
    group: 'page',
    label: 'ข้อมูลสินค้า',
    modes: SWITCH,
    defaults: switchFor('allow', 'allow', 'allow', 'deny'),
    enforcedAt: 'app.use(/api/admin/data/products) — ด่านวางก่อนจุด mount ของ dataDirectoryRouter',
  },
  {
    key: 'page.customersdata',
    group: 'page',
    label: 'ข้อมูลลูกค้า',
    modes: SWITCH,
    defaults: switchFor('allow', 'allow', 'allow', 'deny'),
    enforcedAt: 'app.use(/api/admin/data/customers) — ด่านวางก่อนจุด mount ของ dataDirectoryRouter',
  },
  {
    // หน้า "ผู้ติดต่อเพิ่มเอง" — รายชื่อที่ยังไม่มีใน Odoo + ไฟล์ให้เอาไปคีย์
    //
    // ⚠ **คนละช่องกับ `quote.manage_contacts` โดยตั้งใจ** — ช่องนั้นคือ "ใครเพิ่มคนได้
    //    ตอนออกใบ" ส่วนช่องนี้คือ "ใครดูกองงานค้างของทั้งร้านได้" ถ้ามัดรวมเป็นช่องเดียว
    //    การปิดหน้านี้ให้ subadmin จะทำให้เขาเพิ่มผู้ติดต่อตอนออกใบไม่ได้ไปด้วย ซึ่งไม่มีใครเดาถูก
    key: 'page.odoocontacts',
    group: 'page',
    label: 'ผู้ติดต่อเพิ่มเอง',
    modes: SWITCH,
    // เจ้าของเคาะ 2026-09-17 (§9 ข้อ 2): admin · approver · subadmin — ตรงกับ quote.manage_contacts
    defaults: switchFor('allow', 'allow', 'allow', 'deny'),
    enforcedAt: 'app.use([/api/admin/webquote/contacts/{list,export,count}]) — ด่านชั้นที่สอง ซ้อนกับ quote.manage_contacts ที่คร่อมทั้งโมดูล',
  },
  {
    key: 'page.blacklist',
    group: 'page',
    label: 'บัญชีห้ามเสนอราคา',
    modes: SWITCH,
    // ช่องเดียวในแคตตาล็อกที่ role `user` เป็น allow — วันนี้มันคือ **เมนูเดียวที่ role นั้นเห็น**
    // (AdminApp.tsx: roles: ['admin', 'user']) ปิดช่องนี้ = บัญชีทั่วไปเข้าระบบมาแล้วไม่เหลืออะไรเลย
    defaults: { admin: 'allow', approver: 'deny', subadmin: 'deny', salesperson: 'deny', user: 'allow' },
    enforcedAt: '/api/admin/blacklist/* (8 เส้น)',
  },
  {
    key: 'page.salespersons',
    group: 'page',
    label: 'จัดการพนักงานขาย',
    modes: SWITCH,
    defaults: switchFor('allow', 'deny', 'deny', 'deny'),
    enforcedAt: '/api/admin/salespersons/* (3) · /api/admin/signatures/* (2)',
  },
  {
    key: 'page.users',
    group: 'page',
    label: 'จัดการผู้ใช้งานระบบ',
    modes: SWITCH,
    defaults: switchFor('allow', 'deny', 'deny', 'deny'),
    enforcedAt: '/api/admin/users/* (5 เส้น)',
  },
  {
    key: 'page.traffic',
    group: 'page',
    label: 'รายงานการใช้งาน',
    modes: SWITCH,
    defaults: switchFor('allow', 'deny', 'deny', 'deny'),
    enforcedAt: 'app.use(/api/admin/logs) + /api/admin/api-logs/* (แท็บย่อยของหน้าเดียวกัน)',
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

/**
 * โหมดของกฎทุกข้อในครั้งเดียว — รูปที่ `blockingViolations()` รับเข้าไป
 *
 * มีฟังก์ชันนี้เพราะด่านตรวจกฎต้องเป็น **ฟังก์ชันซิงโครนัสที่ไม่รู้จักเรื่องสิทธิ์เลย** ผู้เรียก
 * ถามโหมดครั้งเดียวตอนต้นทาง แล้วส่ง "ข้อมูล" ก้อนนี้เข้าไป ⇒ ไม่มีตรรกะสิทธิ์ชุดที่สองไป
 * งอกอยู่ใน quotationService และใบจาก LINE (ที่ไม่มีใครส่งโหมดเข้าไป) เดินเส้นเดิมทุกประการ
 *
 * `SYSTEM_ERROR` ไม่อยู่ในผลลัพธ์โดยตั้งใจ — มันไม่มีสวิตช์ และ `blockingViolations()` บล็อกมัน
 * ก่อนจะมองแมปนี้ด้วยซ้ำ
 */
export type RuleModeMap = Record<SwitchableViolationType, PermissionMode>;

export async function ruleModesOf(role: Role): Promise<RuleModeMap> {
  const caps = await capsOf(role);
  const out = {} as RuleModeMap;
  for (const type of SWITCHABLE_VIOLATION_TYPES) out[type] = caps[ruleCapability(type)];
  return out;
}

/**
 * ขอบเขต "ใบที่บัญชีนี้เห็น" — `null` = เห็นทุกใบ (พฤติกรรมของทุก role ที่ออกใบได้ในวันนี้)
 *
 * อยู่ที่นี่เพราะมันเป็น **คำถามเรื่องสิทธิ์** ไม่ใช่เรื่องของ SQL — ส่วนตัวเงื่อนไข SQL อยู่ที่
 * `ownQuotesCondition()` ใน db/repositories.ts ที่เดียว ผู้เรียกเอาผลของสองตัวนี้มาต่อกัน
 *
 * ⚠️ ทุก endpoint ที่แสดง/นับ/ส่งออกใบ ต้องถามตัวนี้ **พร้อมกัน** ไม่ใช่เฉพาะหน้าประวัติ —
 *    ตัวนับที่ไม่ได้กรองจะบอกจำนวนใบที่คนดูเปิดดูไม่ได้ และไฟล์ export ที่ไม่ได้กรองคือ
 *    ช่องที่ทำให้ "เห็นเฉพาะใบของตัวเอง" กลายเป็นของประดับ
 */
export async function quoteScopeOf(admin: { id: number; role: Role }): Promise<OwnQuotesScope | null> {
  if (await can(admin.role, 'quote.view_all')) return null;
  return { adminId: admin.id, salespersonIds: await getAdminSalespersonIds(admin.id) };
}
