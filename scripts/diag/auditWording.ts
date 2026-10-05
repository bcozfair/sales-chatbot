/* ─────────────────────────────────────────────────────────────────────────────
   ถ้อยคำของบันทึกการแก้ไข + ตัวนับ "การแก้ไข" ของรายงานการใช้งาน — เทียบกับแถวจริงทั้งตาราง

   แบบ: mockup `audit-wording` (เจ้าของตอบ "ตามที่เสนอ" ทั้ง 3 ข้อ 2026-10-05)
   **อ่านฐานอย่างเดียว** (SELECT + EXPLAIN ไม่มี ANALYZE) ⇒ รันบน PMSV ได้ · ไม่ต้องเปิดเซิร์ฟเวอร์

   a. ทุกแถวใน audit_logs: isRealChange() (หน้าจอ) == realAuditChangeSql() (ตัวนับ) — สองสำเนาของกติกาเดียว
   b. ทุก action ที่มีในฐานได้ชื่อภาษาไทย (ไม่มีชื่อในระบบอย่าง `local_product.delete` หลุดขึ้นจอ)
   c. แถวพนักงานขายที่ไม่ใช่การเพิ่ม/แก้จริง ไม่มีแถวไหนขึ้นคำว่า "เพิ่ม/แก้ไขพนักงานขาย" อีก
      (พร็อกซีหน้าเว็บ · สถานะการคุยของบอท) และเคสลงทะเบียนจริงได้คำที่ถูก
   d. ชื่อบริษัทของบัญชีเสนอในนาม PM หาเจอ (ไม่ใช่รหัสล้วน) — ผ่าน listAuditLogs ตัวจริงของหน้าจอ
   e. ก้อน audit ของกล่อง "ทุกอย่างของ request นี้" ใช้ได้ (SQL รันจริง + แปลได้คำเดียวกับหน้าบันทึก)
   f. SQL ของ logworker (traffic_daily) ยัง parse ผ่านหลังเติมเงื่อนไข — EXPLAIN อย่างเดียว ไม่เขียน

   รัน: `npm run diag:audit-wording`
   ───────────────────────────────────────────────────────────────────────────── */
import { pool } from '../../config/db.js';
import { realAuditChangeSql } from '../../db/auditKinds.js';
import { listAuditLogs, getRequestTimeline } from '../../db/logRepositories.js';
import { SQL as TRAFFIC_DAILY_SQL } from '../logworker/trafficDailyJob.js';
import { describeAudit, isRealChange, type AuditFacts } from '../../frontend/src/admin/logs/auditMeaning.js';

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

type Row = AuditFacts & { id: string; real: boolean; request_id: string | null };

try {
  await pool.query(`SET statement_timeout = '30s'`);
  const { rows } = await pool.query<Row>(
    `SELECT id::text AS id, request_id, action, entity_type, entity_id, entity_label, changed_cols,
            "before", "after", ${realAuditChangeSql()} AS real
       FROM audit_logs ORDER BY id`);
  console.log(`\n── แถวจริงทั้งตาราง (${rows.length} แถว) ─────────────────────────────`);
  ok('มีแถวให้ตรวจ (ด่านที่ตรวจ 0 แถวเชื่อไม่ได้)', rows.length > 0, String(rows.length));

  const mismatch = rows.filter(r => isRealChange(r) !== r.real);
  ok('a. หน้าจอกับตัวนับตัดสิน "แก้จริง" ตรงกันทุกแถว', mismatch.length === 0,
    mismatch.slice(0, 5).map(r => `#${r.id} ${r.action} หน้าจอ=${isRealChange(r)} SQL=${r.real}`).join(' | '));

  const raw = [...new Set(rows.map(r => describeAudit(r).title).filter(t => /^[a-z_]+\.[a-z_]+$/.test(t)))];
  ok('b. ทุก action ในฐานได้ชื่อภาษาไทย', raw.length === 0, raw.join(', '));

  const sp = rows.filter(r => r.entity_type === 'salesperson');
  const proxy = sp.filter(r => (r.entity_id ?? '').startsWith('web:'));
  const flips = sp.filter(r => r.action === 'salesperson.update'
    && (r.changed_cols ?? []).filter(c => c !== 'updated_at').join() === 'status'
    && ['active', 'edit_quote_number'].includes(String(r.before?.status))
    && ['active', 'edit_quote_number'].includes(String(r.after?.status)));
  const titles = (xs: Row[]) => [...new Set(xs.map(r => describeAudit(r).title))];
  ok('c. แถวพร็อกซีหน้าเว็บไม่ขึ้น "เพิ่ม/แก้ไขพนักงานขาย"',
    proxy.length > 0 && titles(proxy).every(t => !t.includes('พนักงานขาย')), `${proxy.length} แถว → ${titles(proxy).join(' / ')}`);
  ok('c. สถานะการคุยของบอทขึ้นเป็น "กดแก้ใบ / จบขั้นตอนแก้ใบ" เท่านั้น',
    flips.length > 0 && titles(flips).every(t => t === 'กดแก้ใบเสนอราคาใน LINE' || t === 'จบขั้นตอนแก้ใบใน LINE'),
    `${flips.length} แถว → ${titles(flips).join(' / ')}`);
  ok('c. ทั้งสองกลุ่มไม่นับเป็นการแก้จริง', [...proxy, ...flips].every(r => !r.real));
  const reg = sp.filter(r => r.before?.status === 'pending_branch' && r.after?.status === 'active');
  ok('c. ลงทะเบียนเสร็จ = "ลงทะเบียนเซลส์เสร็จ" และนับเป็นการแก้จริง',
    reg.every(r => describeAudit(r).title === 'ลงทะเบียนเซลส์เสร็จ' && r.real), `${reg.length} แถว`);
  const views = rows.filter(r => r.action === 'log.view');
  ok('c. เข้าดู log ไม่นับ และขึ้น "เปิดดู…"', views.every(r => !r.real && describeAudit(r).title.startsWith('เปิดดู')),
    `${views.length} แถว · ${titles(views).join(' / ')}`);

  console.log('\n── ชื่อบริษัท · กล่อง request · logworker ─────────────────────────');
  const pm = await listAuditLogs({ entityType: 'quote_pm' }, 20, 0, undefined, { display: true }) as Array<Record<string, unknown>>;
  const named = pm.filter(r => typeof r.entity_display === 'string' && r.entity_display !== '');
  ok('d. บัญชีเสนอในนาม PM ได้ชื่อบริษัท (อย่างน้อยหนึ่งแถว)', pm.length === 0 || named.length > 0,
    `${named.length}/${pm.length} · ${String(named[0]?.entity_display ?? '')}`);
  const plain = await listAuditLogs({ entityType: 'quote_pm' }, 1, 0) as Array<Record<string, unknown>>;
  ok('d. ไม่ขอชื่อ = ไม่มีคอลัมน์เพิ่ม (ไฟล์ส่งออกคอลัมน์เท่าเดิม)', plain.every(r => !('entity_display' in r)));

  const rid = proxy.find(r => r.request_id)?.request_id ?? rows.find(r => r.request_id)?.request_id;
  if (rid) {
    const tl = await getRequestTimeline(rid) as Array<{ kind: string; title: string; audit: Omit<AuditFacts, 'action'> | null }>;
    const a = tl.find(t => t.kind === 'audit');
    const full = rows.find(r => r.request_id === rid)!;
    ok('e. กล่อง request: แถว audit มีก้อน audit · แถวอื่นเป็น null',
      !!a?.audit && tl.filter(t => t.kind !== 'audit').every(t => t.audit === null), rid);
    ok('e. กล่อง request แปลได้คำเดียวกับหน้าบันทึกการแก้ไข',
      !!a && describeAudit({ action: a.title, ...a.audit! }).title === describeAudit(full).title,
      a ? describeAudit({ action: a.title, ...a.audit! }).title : '-');
  } else ok('e. มี request ให้ตรวจกล่อง request', false);

  await pool.query(`EXPLAIN ${TRAFFIC_DAILY_SQL}`, ['2026-10-05']);
  ok('f. SQL ของ logworker (traffic_daily) parse ผ่าน', true);
} catch (err) {
  fail++;
  console.log(`  ✗ ล้มกลางทาง · ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await pool.end();
}

console.log(fail ? `\n❌ ไม่ผ่าน ${fail} ข้อ` : '\n✅ ผ่านทั้งหมด');
process.exit(fail ? 1 : 0);
