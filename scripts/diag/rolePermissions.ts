// ─────────────────────────────────────────────────────────────────────────────
//  rolePermissions — ด่านของเมทริกซ์สิทธิ์ต่อ role
//  รัน:  npm run diag:role-permissions        (ไม่ต้องเปิดเซิร์ฟเวอร์ · อ่านอย่างเดียว ไม่เขียน DB)
//  แผน: docs/plan-role-permissions.md §9
//
//  รอบนี้ครอบถึง P2 (จุดบังคับใช้ฝั่ง server) — ข้อที่ยังต้องรอคือข้อที่ต้อง **เขียน DB จริง**
//  เพื่อพิสูจน์ (สร้างใบ · เปิดคำขออนุมัติ · ยิง API ด้วยบัญชีจริง) ซึ่งฐานในกล่องคือฐานลูกค้าจริง
//  ⇒ ด่านนี้พิสูจน์ที่ระดับฟังก์ชันแทน: ฟังก์ชันเดียวกับที่ endpoint เรียกจริง ไม่ใช่สำเนา
//
//  1. แคตตาล็อกไม่บิด — ทุกช่องมีค่าเริ่มต้นครบทั้ง 5 role และเป็นโหมดที่ช่องนั้นรับได้
//  2. `SYSTEM_ERROR` ไม่มีสวิตช์ และต้องไม่มีตลอดไป (§3.3)
//  3. ค่าเริ่มต้นของ admin/approver/subadmin = พฤติกรรมวันนี้เป๊ะ (เทียบกับตารางใน §4)
//  4. ตารางว่าง/ยังไม่มีตาราง = ค่าเริ่มต้น ⇒ ขึ้นระบบแล้วไม่มีอะไรเปลี่ยน
//  5. แถวของ `admin` ถูกล็อก — ค่าใน DB ทับไม่ได้ (§3.4)
//  6. ค่าใน DB ทับค่าเริ่มต้นของ role อื่นได้จริง และ cache ล้างแล้วเห็นผลทันที
//  7. role ทั้ง 5 ผ่าน CHECK constraint ของ DB จริง (ข้ามถ้ายังไม่ได้รัน migration)
//  8. **ใบจาก LINE ไม่ขยับ** — ไม่ส่งโหมดเข้าไป = คำตอบเดิมของทั้งระบบทุกชนิดกฎ (§9 ข้อ 3)
//  9. **สามเส้นทาง deny / approval / allow** ที่ `blockingViolations()` (§9 ข้อ 4 · §6)
// 10. **ตัวกรอง "ใบของตัวเอง"** — ผูกรหัส = กรองด้วยรหัส · ไม่ผูก = ถอยไปใบของบัญชีตัวเอง (§13.7)
// 11. **คำอนุมัติผูกกับตัวเลขของกฎข้อนั้น** — ราคา/จำนวน แล้วแต่ชนิด (§3.6 · §9 ข้อ 5)
// 12. **ทุกช่องกลุ่ม "หน้าจอ" มีด่านที่ route จริง** และไม่มี route ไหนหลุดรายการ (P3c)
//     รวมถึงเมนูฝั่งหน้าจอที่ต้องอ่านจากช่องเดียวกัน และค่าสำรองที่ต้องไม่ใจกว้างเกินค่าเริ่มต้น
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { pool } from '../../config/db.js';
import {
  CAPABILITIES,
  ROLES,
  SWITCHABLE_VIOLATION_TYPES,
  capsOf,
  invalidateCapabilityCache,
  isSwitchableViolationType,
  type Capability,
  type PermissionMode,
} from '../../config/capabilities.js';
import { getRolePermissionRows, ownQuotesCondition } from '../../db/repositories.js';
import {
  blockingViolations,
  violationMode,
  violationKey,
  approvedViolationKeys,
  type Violation,
  type ViolationModeMap,
} from '../../services/quotationService.js';
import type { Role } from '../../config/auth.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', YELLOW = '\x1b[33m', RESET = '\x1b[0m';

let pass = 0, fail = 0, skip = 0;
function ok(label: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ${GREEN}✓${RESET} ${label}${extra ? ` ${DIM}${extra}${RESET}` : ''}`); }
  else { fail++; console.log(`  ${RED}✗${RESET} ${label}${extra ? ` ${DIM}${extra}${RESET}` : ''}`); }
}
function skipped(label: string, why: string) {
  skip++; console.log(`  ${YELLOW}–${RESET} ${label} ${DIM}(${why})${RESET}`);
}

/**
 * พฤติกรรมวันนี้ เขียนไว้เป็นตัวหนังสือ — ตารางนี้คือ "คำตอบที่ถูก" ของข้อ 3
 * ถ้าใครแก้ค่าเริ่มต้นในแคตตาล็อกโดยไม่ได้ตั้งใจ ด่านนี้จะล้มทันทีพร้อมบอกช่องที่ต่าง
 */
const TODAY: Record<Capability, [admin: PermissionMode, approver: PermissionMode, subadmin: PermissionMode]> = {
  'rule.BLOCKED':                 ['allow', 'allow', 'allow'],
  'rule.OUT_OF_STOCK':            ['allow', 'allow', 'allow'],
  'rule.MOQ_VIOLATION':           ['allow', 'allow', 'allow'],
  'rule.MIN_PRICE_VIOLATION':     ['approval', 'approval', 'approval'],
  'rule.CUSTOMER_BLACKLISTED':    ['allow', 'allow', 'allow'],
  'rule.CUSTOMER_CREDIT_HOLD':    ['allow', 'allow', 'allow'],
  'quote.create':                 ['allow', 'allow', 'allow'],
  'quote.revise':                 ['allow', 'allow', 'allow'],
  'quote.view_all':               ['allow', 'allow', 'allow'],
  'quote.export_odoo':            ['allow', 'allow', 'allow'],
  'quote.unmark_export':          ['allow', 'allow', 'allow'],
  'quote.payment_terms_override': ['allow', 'allow', 'allow'],
  'quote.act_as_any_salesperson': ['allow', 'allow', 'allow'],
  'approval.decide':              ['allow', 'allow', 'deny'],
  'users.set_issuer_identity':    ['allow', 'deny', 'deny'],
  // ── หน้าจอ: คัดลอกมาจาก `roles: [...]` ใน AdminApp.tsx ตรง ๆ (วัด 2026-09-18) ──
  //  ตารางนี้คือสำเนาที่ **ตั้งใจให้มี** — ถ้าใครแก้ค่าเริ่มต้นในแคตตาล็อกโดยไม่ได้ตั้งใจ
  //  ด่านจะล้มพร้อมบอกช่องที่ต่าง · ถ้าแก้เมนูใน AdminApp.tsx จริง ต้องมาแก้ที่นี่ด้วย
  'page.dashboard':               ['allow', 'deny', 'deny'],
  'page.approvals':               ['allow', 'allow', 'allow'],
  'page.quotations':              ['allow', 'allow', 'allow'],
  'page.settings_quotation':      ['allow', 'deny', 'deny'],
  'page.promotions':              ['allow', 'deny', 'deny'],
  'page.settings_optional':       ['allow', 'deny', 'deny'],
  'page.settings_stock':          ['allow', 'deny', 'deny'],
  'page.settings_moq':            ['allow', 'deny', 'deny'],
  'page.settings_block':          ['allow', 'deny', 'deny'],
  'page.settings_shipping':       ['allow', 'deny', 'deny'],
  'page.productsdata':            ['allow', 'allow', 'allow'],
  'page.customersdata':           ['allow', 'allow', 'allow'],
  'page.blacklist':               ['allow', 'deny', 'deny'],
  'page.salespersons':            ['allow', 'deny', 'deny'],
  'page.users':                   ['allow', 'deny', 'deny'],
  'page.traffic':                 ['allow', 'deny', 'deny'],
};

async function tableExists(name: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${name}`]);
  return Boolean(rows[0]?.ok);
}

async function main() {
  console.log(`\n${BOLD}ด่านเมทริกซ์สิทธิ์ต่อ role${RESET}\n`);

  // ── 1. แคตตาล็อกไม่บิด ─────────────────────────────────────────────────────
  console.log(`${BOLD}1. แคตตาล็อก${RESET}`);
  const keys = CAPABILITIES.map(c => c.key);
  ok('ชื่อความสามารถไม่ซ้ำกัน', new Set(keys).size === keys.length, `${keys.length} ช่อง`);

  let defaultsBad = 0;
  for (const def of CAPABILITIES) {
    for (const role of ROLES) {
      const mode = def.defaults[role];
      if (!mode || !def.modes.includes(mode)) {
        defaultsBad++;
        console.log(`      ${DIM}${def.key} / ${role} = ${mode}${RESET}`);
      }
    }
  }
  ok('ทุกช่องมีค่าเริ่มต้นครบทั้ง 5 role และเป็นโหมดที่ช่องนั้นรับได้', defaultsBad === 0);

  const ruleKeys = keys.filter(k => k.startsWith('rule.')).sort();
  const fromTypes = SWITCHABLE_VIOLATION_TYPES.map(t => `rule.${t}`).sort();
  ok('ความสามารถกลุ่ม rule.* ตรงกับชนิดกฎที่มีสวิตช์ได้พอดี',
    JSON.stringify(ruleKeys) === JSON.stringify(fromTypes), `${ruleKeys.length} ข้อ`);

  // หน้า "สิทธิ์ตามบทบาท" ต้องไม่มีสวิตช์ของตัวเอง — ความสามารถที่ปิดตัวเองได้
  // คือความสามารถที่ล็อกคนสุดท้ายออกจากระบบได้ (เหตุผลเดียวกับที่ admin ถูกล็อกทั้งแถว)
  ok('ไม่มีช่องสำหรับหน้า "สิทธิ์ตามบทบาท" เอง',
    !keys.some(k => /role.?permission|rolepermissions/i.test(k)));
  const pageKeys = CAPABILITIES.filter(c => c.group === 'page');
  ok('ทุกช่องของกลุ่มหน้าจอเป็นสวิตช์สองค่า (deny/allow) ไม่ใช่สามค่า',
    pageKeys.every(c => c.modes.length === 2), `${pageKeys.length} หน้า`);

  // ── 2. SYSTEM_ERROR ────────────────────────────────────────────────────────
  console.log(`\n${BOLD}2. SYSTEM_ERROR ไม่มีสวิตช์${RESET}`);
  ok('ไม่อยู่ในรายชื่อชนิดกฎที่มีสวิตช์',
    !(SWITCHABLE_VIOLATION_TYPES as readonly string[]).includes('SYSTEM_ERROR'));
  ok('ไม่มีความสามารถ rule.SYSTEM_ERROR ในแคตตาล็อก',
    !keys.includes('rule.SYSTEM_ERROR' as Capability));
  ok('isSwitchableViolationType(\'SYSTEM_ERROR\') = false', !isSwitchableViolationType('SYSTEM_ERROR'));

  // ── 3. ค่าเริ่มต้น = พฤติกรรมวันนี้ ────────────────────────────────────────
  console.log(`\n${BOLD}3. ค่าเริ่มต้นของ role เดิม = พฤติกรรมวันนี้${RESET}`);
  let drift = 0;
  for (const def of CAPABILITIES) {
    const expect = TODAY[def.key];
    if (!expect) { drift++; console.log(`      ${DIM}${def.key}: ไม่มีคำตอบที่ถูกเขียนไว้ในด่าน${RESET}`); continue; }
    const got: PermissionMode[] = [def.defaults.admin, def.defaults.approver, def.defaults.subadmin];
    if (got.join('|') !== expect.join('|')) {
      drift++;
      console.log(`      ${DIM}${def.key}: ได้ ${got.join('/')} · ควรเป็น ${expect.join('/')}${RESET}`);
    }
  }
  ok('admin / approver / subadmin ไม่มีช่องไหนเปลี่ยนไปจากเดิม', drift === 0, `${CAPABILITIES.length} ช่อง`);
  ok('ทุกช่องของด่านนี้มีคู่ในแคตตาล็อก', Object.keys(TODAY).length === CAPABILITIES.length);

  // ── 4–7. ฝั่งฐานข้อมูล ─────────────────────────────────────────────────────
  console.log(`\n${BOLD}4–7. ค่าที่อ่านจากฐานข้อมูล${RESET}`);
  const hasTable = await tableExists('role_permissions');

  if (!hasTable) {
    // สถานะที่ตั้งใจ: โค้ดขึ้นก่อน migration ได้ เพราะ "ไม่มีตาราง" กับ "ตารางว่าง" ให้ผลเดียวกัน
    invalidateCapabilityCache();
    const caps = await capsOf('subadmin');
    const sameAsDefault = CAPABILITIES.every(d => caps[d.key] === d.defaults.subadmin);
    ok('ยังไม่มีตาราง = ใช้ค่าเริ่มต้น ไม่ล้ม', sameAsDefault);
    skipped('ข้อ 5–7 (admin ถูกล็อก · ค่าใน DB ทับได้ · CHECK constraint)',
      'ยังไม่ได้รัน migrations/changes/2026-09-18_01_role_permissions.sql');
  } else {
    const rows = (await getRolePermissionRows()) ?? [];
    console.log(`  ${DIM}แถวในตาราง: ${rows.length}${RESET}`);

    invalidateCapabilityCache();
    const byRole = new Map<string, Map<string, string>>();
    for (const r of rows) {
      let m = byRole.get(r.role);
      if (!m) byRole.set(r.role, (m = new Map()));
      m.set(r.capability, r.mode);
    }

    // ข้อ 4/6 รวมกัน: ผลของ capsOf ต้อง = ค่าเริ่มต้น ทับด้วยแถวใน DB ของ role นั้น พอดี
    let mismatch = 0;
    for (const role of ROLES) {
      const caps = await capsOf(role as Role);
      for (const def of CAPABILITIES) {
        const override = role === 'admin' ? undefined : byRole.get(role)?.get(def.key);
        const expect = (override && def.modes.includes(override as PermissionMode))
          ? override : def.defaults[role];
        if (caps[def.key] !== expect) {
          mismatch++;
          console.log(`      ${DIM}${role}/${def.key}: ได้ ${caps[def.key]} · ควรเป็น ${expect}${RESET}`);
        }
      }
    }
    ok('capsOf() = ค่าเริ่มต้น ทับด้วยค่าใน DB พอดีทุกช่องทุก role', mismatch === 0);

    const adminRows = rows.filter(r => r.role === 'admin');
    const adminCaps = await capsOf('admin');
    ok('แถวของ admin ถูกล็อก — ค่าใน DB ทับไม่ได้',
      CAPABILITIES.every(d => adminCaps[d.key] === d.defaults.admin),
      adminRows.length ? `มีแถว admin ใน DB ${adminRows.length} แถว และถูกมองข้ามครบ` : 'ไม่มีแถว admin ใน DB');

    // ข้อ 7: role ในโค้ดกับ CHECK constraint ของ DB ต้องเป็นชุดเดียวกัน
    const { rows: conRows } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'admin_users_role_check'`);
    const conDef = String(conRows[0]?.def ?? '');
    const missing = ROLES.filter(r => !conDef.includes(`'${r}'`));
    ok('role ทั้ง 5 ในโค้ดผ่าน CHECK constraint ของ admin_users',
      conDef !== '' && missing.length === 0,
      missing.length ? `ยังไม่มีใน constraint: ${missing.join(', ')}` : conDef.slice(0, 80));
  }

  // ── 8. ใบจาก LINE ไม่ขยับ ──────────────────────────────────────────────────
  //  เส้น LINE ไม่มีใครส่ง ruleModes เข้าไป ⇒ ทุกคำตอบต้องเท่ากับกติกาเดิมของทั้งระบบ
  //  เขียนคำตอบที่ถูกไว้เป็นตัวหนังสือ ไม่ได้คำนวณจากโค้ดตัวเดียวกับที่กำลังตรวจ
  console.log(`\n${BOLD}8. ไม่ส่งโหมดเข้าไป = กติกาเดิมของทั้งระบบ (เส้น LINE)${RESET}`);
  const LEGACY: Record<string, PermissionMode> = {
    BLOCKED: 'allow', OUT_OF_STOCK: 'allow', MOQ_VIOLATION: 'allow',
    CUSTOMER_BLACKLISTED: 'allow', CUSTOMER_CREDIT_HOLD: 'allow',
    MIN_PRICE_VIOLATION: 'approval', SYSTEM_ERROR: 'deny',
  };
  const mk = (type: string): Violation =>
    ({ type, model: 'DIAG-X', display_message: 'ทดสอบ' } as unknown as Violation);
  let legacyDrift = 0;
  for (const [type, expect] of Object.entries(LEGACY)) {
    const got = violationMode(mk(type));
    if (got !== expect) { legacyDrift++; console.log(`      ${DIM}${type}: ได้ ${got} · ควรเป็น ${expect}${RESET}`); }
  }
  ok('violationMode() ที่ไม่มีโหมด ตอบเหมือนกติกาเดิมทุกชนิดกฎ', legacyDrift === 0,
    `${Object.keys(LEGACY).length} ชนิด`);

  const vStock = mk('OUT_OF_STOCK');
  ok('ติ๊กรับทราบแล้วผ่าน (ของหมด) — เหมือนเดิม',
    blockingViolations([vStock], [violationKey(vStock)]).length === 0);
  const vSys = mk('SYSTEM_ERROR');
  ok('SYSTEM_ERROR ติ๊กรับทราบแล้วก็ยังบล็อก — เหมือนเดิม',
    blockingViolations([vSys], [violationKey(vSys)]).length === 1);
  ok('SYSTEM_ERROR บล็อกแม้จะมีคนพยายามตั้งโหมดให้มัน',
    blockingViolations([vSys], [violationKey(vSys)], [violationKey(vSys)],
      { SYSTEM_ERROR: 'allow' } as ViolationModeMap).length === 1);

  // ── 9. สามเส้นทางของ §6 ────────────────────────────────────────────────────
  console.log(`\n${BOLD}9. deny / approval / allow${RESET}`);
  const v = mk('MOQ_VIOLATION');
  const key = violationKey(v);
  ok('deny — ติ๊กรับทราบก็ไม่ผ่าน และคำอนุมัติก็ปลดไม่ได้',
    blockingViolations([v], [key], [key], { MOQ_VIOLATION: 'deny' }).length === 1);
  ok('approval — คำรับทราบของคนออกใบไม่มีผล',
    blockingViolations([v], [key], null, { MOQ_VIOLATION: 'approval' }).length === 1);
  ok('approval — คำอนุมัติปลดได้',
    blockingViolations([v], null, [key], { MOQ_VIOLATION: 'approval' }).length === 0);
  ok('allow — ติ๊กรับทราบแล้วผ่าน',
    blockingViolations([v], [key], null, { MOQ_VIOLATION: 'allow' }).length === 0);
  ok('allow — ไม่ติ๊กก็ยังบล็อก (คำรับทราบต้องมาจากคนจริง)',
    blockingViolations([v], null, null, { MOQ_VIOLATION: 'allow' }).length === 1);

  // ── 10. ตัวกรอง "ใบของตัวเอง" ──────────────────────────────────────────────
  //  ตรวจ *รูปของเงื่อนไข* ไม่ใช่ผลของ query เพราะยังไม่มีบัญชีที่ผูกรหัสจริงสักบัญชี
  //  (ตาราง admin_user_salespersons เพิ่งเกิดใน P1 และ P4 คือรอบที่เปิดบัญชี)
  console.log(`\n${BOLD}10. ตัวกรอง "ใบของตัวเอง"${RESET}`);
  const bound = ownQuotesCondition({ adminId: 7, salespersonIds: ['441', '688'] }, 3);
  ok('ผูกรหัสไว้ ⇒ กรองด้วย *รหัสพนักงานขาย* ไม่ใช่ user_id',
    bound.sql.includes('= ANY($3)') && !bound.sql.includes('user_id LIKE'), bound.sql);
  ok('  และส่งรหัสไปเป็นพารามิเตอร์เดียว (คนเดียวมีหลายรหัสได้)',
    bound.params.length === 1 && Array.isArray(bound.params[0]) && bound.params[0].length === 2);
  const unbound = ownQuotesCondition({ adminId: 7, salespersonIds: [] }, 1);
  ok('ไม่ผูกรหัส ⇒ ถอยไปใบที่ออกจากบัญชีนี้ ไม่ใช่ "เห็นทุกใบ"',
    unbound.sql.includes('q.user_id LIKE $1') && unbound.params[0] === 'web:7:%', String(unbound.params[0]));

  // ── 11. คำอนุมัติผูกกับตัวเลขของกฎข้อนั้น ─────────────────────────────────
  //  คำอนุมัติหนึ่งครั้งต้องไม่กลายเป็นใบเบิกทางถาวร — เกณฑ์คือ "แก้ไปทางที่ผิดหนักขึ้น
  //  กว่าที่คนอนุมัติเห็น = ต้องขอใหม่" ซึ่งทิศทางของของหมดกับ MOQ **กลับกัน**
  console.log(`\n${BOLD}11. คำอนุมัติผูกกับตัวเลขของกฎข้อนั้น${RESET}`);
  const approvalOf = (type: string, item: Record<string, unknown>) => ({
    status: 'approved',
    violations: [{ type, model: 'DIAG-X' }],
    items: [{ model: 'DIAG-X', ...item }],
  });
  const vAt = (type: string, extra: Record<string, unknown>): Violation =>
    ({ type, model: 'DIAG-X', display_message: 'ทดสอบ', ...extra } as unknown as Violation);

  const priceApp = approvalOf('MIN_PRICE_VIOLATION', { price: 100, quantity: 10 });
  ok('ราคา — เท่าที่อนุมัติ ⇒ ปลด',
    approvedViolationKeys(priceApp, [vAt('MIN_PRICE_VIOLATION', { price: 100 })]).length === 1);
  ok('ราคา — ต่ำลงกว่าที่อนุมัติ ⇒ ต้องขอใหม่',
    approvedViolationKeys(priceApp, [vAt('MIN_PRICE_VIOLATION', { price: 50 })]).length === 0);

  const stockApp = approvalOf('OUT_OF_STOCK', { quantity: 10, price: 5 });
  ok('ของหมด — สั่งเท่าที่อนุมัติ ⇒ ปลด',
    approvedViolationKeys(stockApp, [vAt('OUT_OF_STOCK', { qty: 10 })]).length === 1);
  ok('ของหมด — สั่งมากขึ้นกว่าที่อนุมัติ ⇒ ต้องขอใหม่',
    approvedViolationKeys(stockApp, [vAt('OUT_OF_STOCK', { qty: 11 })]).length === 0);

  const moqApp = approvalOf('MOQ_VIOLATION', { quantity: 10, price: 5 });
  ok('MOQ — สั่งเท่าที่อนุมัติ ⇒ ปลด',
    approvedViolationKeys(moqApp, [vAt('MOQ_VIOLATION', { qty: 10 })]).length === 1);
  ok('MOQ — สั่งน้อยลงกว่าที่อนุมัติ ⇒ ต้องขอใหม่ (ทิศตรงข้ามกับของหมด)',
    approvedViolationKeys(moqApp, [vAt('MOQ_VIOLATION', { qty: 9 })]).length === 0);

  const blockApp = approvalOf('BLOCKED', { quantity: 10, price: 5 });
  ok('สินค้าระงับ — ไม่มีตัวเลขผูก ใช้คีย์ล้วน',
    approvedViolationKeys(blockApp, [vAt('BLOCKED', {})]).length === 1);
  ok('  คนละรุ่น = คนละคีย์ ⇒ ปลดข้ามรุ่นไม่ได้',
    approvedViolationKeys(blockApp,
      [{ type: 'BLOCKED', model: 'DIAG-Y', display_message: 'x' } as unknown as Violation]).length === 0);
  ok('คำขอที่ยังไม่อนุมัติ ⇒ ไม่ปลดอะไรเลย',
    approvedViolationKeys({ ...stockApp, status: 'pending' }, [vAt('OUT_OF_STOCK', { qty: 10 })]).length === 0);
  ok('คำขอเก่าที่ไม่ได้เก็บ violations ⇒ ยังตีความเป็นคำขอราคาขั้นต่ำ',
    approvedViolationKeys({ status: 'approved', items: [{ model: 'DIAG-X', price: 100 }] },
      [vAt('MIN_PRICE_VIOLATION', { price: 100 })]).length === 1);


  // ── 12. ทุกช่องกลุ่ม "หน้าจอ" มีด่านที่ route จริง (P3c) ────────────────────
  //  ข้อนี้มีอยู่เพราะ "ซ่อนเมนูอย่างเดียว" ไม่ใช่สิทธิ์ — มันคือคำสัญญาที่ผิด: เปิดเมนูให้ใคร
  //  แล้วเขาเห็นหน้าที่ยิง API ไม่ผ่านสักเส้น ซึ่งแย่กว่าไม่เห็นเมนูเลย
  //  จึงอ่าน **ซอร์สของ index.ts** มาเทียบ ไม่ใช่เชื่อ `enforcedAt` ที่เป็นแค่ข้อความ
  console.log(`\n${BOLD}12. ช่องกลุ่ม "หน้าจอ" มีด่านที่ route จริง${RESET}`);
  const indexSrc = readFileSync(new URL('../../index.ts', import.meta.url), 'utf-8');

  const pageCaps = CAPABILITIES.filter((c) => c.group === 'page');
  const unenforced = pageCaps
    .filter((c) => !indexSrc.includes(`requireCapability('${c.key}')`))
    .map((c) => c.key);
  ok(`ทุกช่องหน้าจอถูกใช้เป็นด่านใน index.ts (${pageCaps.length} ช่อง)`,
    unenforced.length === 0, unenforced.join(' · '));

  // route ที่ "ไม่มีด่านเลย" กับ "มีแต่ requireRole" ต้องตรงกับรายการที่ตั้งใจไว้ **เป๊ะ**
  //  เทียบแบบเท่ากันทั้งเซ็ต ไม่ใช่ "อยู่ในรายการ" — เส้นใหม่ที่ลืมใส่ด่านจึงล้มด่านนี้ทันที
  const NO_GUARD = [
    'POST /api/admin/login',              // ยังไม่มีตัวตนให้ถาม
    'GET /api/admin/verify',              // ตรวจ token ของตัวเอง
    'POST /api/admin/change-password',    // รหัสของตัวเอง
    'GET /api/admin/me/capabilities',     // ทุก role ต้องเรียกได้ เพราะเมนูของทุกคนอ่านจากเส้นนี้
  ];
  const ROLE_ONLY = [
    'GET /api/admin/role-permissions',        // หน้าตั้งค่าสิทธิ์ จงใจไม่เอาตัวเองเข้าเมทริกซ์ (§4ข)
    'PUT /api/admin/role-permissions',
    'PUT /api/admin/webquote/me',             // ตัวตนบนใบ — §13.3 ห้ามเปิดให้ salesperson
    'POST /api/admin/webquote/me/signature',
    'DELETE /api/admin/webquote/me/signature',
  ];
  const noGuard: string[] = [];
  const roleOnly: string[] = [];
  for (const line of indexSrc.split('\n')) {
    const m = /^app\.(get|post|put|patch|delete)\('(\/api\/admin[^']*)'([^\n]*)$/.exec(line);
    if (!m) continue;
    const name = `${m[1].toUpperCase()} ${m[2]}`;
    if (m[3].includes('requireCapability')) continue;
    (m[3].includes('requireRole') ? roleOnly : noGuard).push(name);
  }
  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
  ok('route ที่ไม่มีด่านเลย = รายการที่ตั้งใจไว้ เป๊ะทั้งเซ็ต',
    sameSet(noGuard, NO_GUARD), noGuard.join(' · '));
  ok('route ที่มีแต่ requireRole = รายการที่ตั้งใจไว้ เป๊ะทั้งเซ็ต',
    sameSet(roleOnly, ROLE_ONLY), roleOnly.join(' · '));

  // จุด mount ของ router ลูก — ด่านไม่ได้อยู่บนบรรทัด app.get/app.post จึงต้องตรวจแยก
  ok('logsRouter บังคับด้วย page.traffic ที่จุด mount',
    /app\.use\('\/api\/admin\/logs',[^)]*requireCapability\('page\.traffic'\)/.test(indexSrc));
  ok('หน้าข้อมูลสินค้า/ลูกค้าเป็นด่าน **คนละตัว** ก่อนถึง router ตัวเดียวกัน',
    /app\.use\('\/api\/admin\/data\/products',[^)]*requireCapability\('page\.productsdata'\)/.test(indexSrc) &&
    /app\.use\('\/api\/admin\/data\/customers',[^)]*requireCapability\('page\.customersdata'\)/.test(indexSrc));
  ok('  และจุด mount ของ dataDirectoryRouter ไม่เหลือ requireRole ค้างไว้ให้ตีความสองทาง',
    /app\.use\('\/api\/admin\/data', adminAuthMiddleware, dataDirectoryRouter\)/.test(indexSrc));

  // ── เมนูฝั่งหน้าจออ่านจากช่องเดียวกับด่าน ─────────────────────────────────
  //  AdminApp.tsx ถือ `roles: [...]` ไว้เป็น **ค่าสำรอง** ตอนเรียก /me/capabilities ไม่สำเร็จ
  //  ค่าสำรองที่ใจกว้างกว่าค่าเริ่มต้นคือช่องโหว่ที่โผล่เฉพาะตอนเน็ตสะดุด ซึ่งไม่มีใครเจอตอนทดสอบ
  //  ⇒ บังคับว่า roles ต้องเป็น **สับเซ็ต** ของ role ที่ค่าเริ่มต้นเปิดให้ (เท่ากันไม่ได้ เพราะ
  //  salesperson เป็นคอลัมน์ใหม่ที่ยังไม่มีบัญชี จึงยังไม่ถูกใส่ในรายชื่อสำรองของเมนู)
  const navSrc = readFileSync(new URL('../../frontend/src/admin/AdminApp.tsx', import.meta.url), 'utf-8');
  const navItems: { roles: string[]; cap: string }[] = [];
  for (const line of navSrc.split('\n')) {
    const m = /roles: \[([^\]]*)\][^\n]*?cap: '([^']+)'/.exec(line);
    if (m) navItems.push({ roles: [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]), cap: m[2] });
  }
  ok(`เมนูใน AdminApp.tsx ผูกกับช่องในเมทริกซ์ครบ (${navItems.length} เมนู)`, navItems.length >= 17);
  const unknownCaps = navItems.filter((n) => !CAPABILITIES.some((c) => c.key === n.cap)).map((n) => n.cap);
  ok('  ทุก cap ที่เมนูอ้างถึงมีอยู่จริงในแคตตาล็อก', unknownCaps.length === 0, unknownCaps.join(' · '));
  const tooWide = navItems.filter((n) => {
    const def = CAPABILITIES.find((c) => c.key === n.cap);
    return def ? n.roles.some((r) => def.defaults[r as Role] === 'deny') : false;
  });
  ok('  ค่าสำรองของเมนูไม่ใจกว้างกว่าค่าเริ่มต้นของช่องนั้นสักเมนู',
    tooWide.length === 0, tooWide.map((n) => n.cap).join(' · '));
  const missingInNav = pageCaps.filter((c) => !navItems.some((n) => n.cap === c.key)).map((c) => c.key);
  ok('  ทุกช่องกลุ่มหน้าจอมีเมนูของตัวเองใน AdminApp.tsx', missingInNav.length === 0, missingInNav.join(' · '));

  // การตัดสินคำขอต้องซ้อนสองชั้น: ประตู (approval.decide) + ตัว service (canDecideApproval)
  //  ถ้าเหลือชั้นเดียว เปิดสิทธิ์ให้ role ใหม่แล้วจะได้ครึ่งเดียว ซึ่งดูเหมือนบั๊กสุ่ม
  const decideRoutes = (indexSrc.match(/requireCapability\('approval\.decide'\)/g) ?? []).length;
  ok('3 เส้นที่ตัดสินคำขอมีด่าน approval.decide ที่ประตูด้วย', decideRoutes === 3, `${decideRoutes} เส้น`);

  console.log(`\n${BOLD}สรุป:${RESET} ${GREEN}ผ่าน ${pass}${RESET} · ${fail > 0 ? RED : DIM}ล้ม ${fail}${RESET}${skip ? ` · ${YELLOW}ข้าม ${skip}${RESET}` : ''}`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

void main();
