// ─────────────────────────────────────────────────────────────────────────────
//  rolePermissions — ด่านของเมทริกซ์สิทธิ์ต่อ role
//  รัน:  npm run diag:role-permissions        (ไม่ต้องเปิดเซิร์ฟเวอร์ · อ่านอย่างเดียว ไม่เขียน DB)
//  แผน: docs/plan-role-permissions.md §9
//
//  รอบนี้ (P1) ตรวจเฉพาะสิ่งที่ P1 ส่งมอบจริง — แคตตาล็อก ค่าเริ่มต้น และการอ่านค่าจากตาราง
//  ข้อที่เหลือของ §9 (deny/approval/allow สามเส้นทาง · ตัวกรอง "ใบของตัวเอง" · admin แก้ไม่ได้
//  ผ่าน API) ต้องรอจุดบังคับใช้ใน P2 ถึงจะมีของให้ตรวจ
//
//  1. แคตตาล็อกไม่บิด — ทุกช่องมีค่าเริ่มต้นครบทั้ง 5 role และเป็นโหมดที่ช่องนั้นรับได้
//  2. `SYSTEM_ERROR` ไม่มีสวิตช์ และต้องไม่มีตลอดไป (§3.3)
//  3. ค่าเริ่มต้นของ admin/approver/subadmin = พฤติกรรมวันนี้เป๊ะ (เทียบกับตารางใน §4)
//  4. ตารางว่าง/ยังไม่มีตาราง = ค่าเริ่มต้น ⇒ ขึ้นระบบแล้วไม่มีอะไรเปลี่ยน
//  5. แถวของ `admin` ถูกล็อก — ค่าใน DB ทับไม่ได้ (§3.4)
//  6. ค่าใน DB ทับค่าเริ่มต้นของ role อื่นได้จริง และ cache ล้างแล้วเห็นผลทันที
//  7. role ทั้ง 5 ผ่าน CHECK constraint ของ DB จริง (ข้ามถ้ายังไม่ได้รัน migration)
// ─────────────────────────────────────────────────────────────────────────────
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
import { getRolePermissionRows } from '../../db/repositories.js';
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

  console.log(`\n${BOLD}สรุป:${RESET} ${GREEN}ผ่าน ${pass}${RESET} · ${fail > 0 ? RED : DIM}ล้ม ${fail}${RESET}${skip ? ` · ${YELLOW}ข้าม ${skip}${RESET}` : ''}`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

void main();
