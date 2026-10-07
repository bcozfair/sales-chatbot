// ─────────────────────────────────────────────────────────────────────────────
//  ด่านของตัวลบ "ร่างจากหน้าเว็บที่ถูกทิ้งไว้" (services/webDraftSweeper.ts · 2026-10-07)
//  รัน:  npm run diag:web-draft-sweep
//
//  ⚠️ สคริปต์นี้ "เขียน" DB จริง แต่ทำงานทั้งหมดในทรานแซกชันเดียวแล้ว ROLLBACK ตอนจบเสมอ
//     รวมถึงตอน assert ไม่ผ่านหรือ throw — **ห้ามเปลี่ยนเป็น COMMIT เด็ดขาด**
//     ใบทดสอบสร้างเอง (เลขที่ขึ้นต้น ZZ) ใต้ user_id ที่มีอยู่แล้วในฐาน ไม่ได้หยิบใบจริงมาลบ
//     ⚠️ ระหว่างทรานแซกชัน DELETE ของจริงก็ลบร่างจริงที่เข้าเงื่อนไขด้วย — ROLLBACK คืนให้ทั้งหมด
//
//  พิสูจน์: เรียก deleteStaleWebDrafts() ตัวเดียวกับที่ตัวลบใช้ (เงื่อนไข STALE_WEB_DRAFT_SQL ชุดเดียว)
//    ลบ   = ร่างจากหน้าเว็บ ไม่มีเลขที่ ไม่ผูกคำขออนุมัติ ไม่มีใครแตะเกิน 7 วัน
//    ไม่ลบ = ร่างอายุไม่ถึง 7 วัน · ร่างของ LINE · ร่างรออนุมัติ/ถูกตีกลับ/อนุมัติแล้วยังออกใบไม่ได้ ·
//            ใบที่มีเลขที่แล้ว · ใบที่ยกเลิกแล้ว (cancelled = มีคนกดยกเลิก ต้องเหลือเป็นหลักฐาน)
//  ท้ายสุดบอกว่าฐานจริงตอนนี้มีกี่ใบที่รอบแรกจะลบ (อ่านอย่างเดียว) — ไว้เทียบกับ log ตอนขึ้นระบบ
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from '../../config/db.js';
import { deleteStaleWebDrafts, STALE_WEB_DRAFT_SQL } from '../../db/repositories.js';
import { STALE_WEB_DRAFT_DAYS } from '../../services/webDraftSweeper.js';

let failures = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

ok('อายุที่ตัวลบใช้ = 7 วัน (เจ้าของสั่ง 2026-10-07)', STALE_WEB_DRAFT_DAYS === 7, String(STALE_WEB_DRAFT_DAYS));

const client = await pool.connect();
try {
  await client.query("SET statement_timeout = '15s'");
  await client.query('BEGIN');

  // เจ้าของใบทดสอบ — FK ไป salesperson ⇒ ยืม user_id ที่มีอยู่แล้ว (แถวพร็อกซีของเว็บ 1 + เซลส์ LINE 1)
  const { rows: owners } = await client.query(`
    SELECT (SELECT user_id FROM salesperson WHERE user_id LIKE 'web:%' ORDER BY user_id LIMIT 1) AS web,
           (SELECT user_id FROM salesperson WHERE user_id NOT LIKE 'web:%' ORDER BY user_id LIMIT 1) AS line`);
  const WEB = owners[0]?.web as string | null;
  const LINE = owners[0]?.line as string | null;
  if (!WEB || !LINE) {
    console.log('⚠️  ฐานนี้ไม่มีแถวพร็อกซีของเว็บหรือเซลส์ LINE ให้ยืม — ข้ามด่าน (ไม่นับว่าผ่าน)');
    failures++;
  } else {
    const days = (n: number) => `CURRENT_TIMESTAMP - INTERVAL '${n} days'`;
    const mk = async (label: string, opts: {
      user: string; status?: string; no?: string | null; ageDays: number; approval?: object | null;
    }) => {
      const { rows } = await client.query(
        `INSERT INTO quotations (user_id, quotation_no, status, total_sum, customer_details, item_details,
                                 price_approval, created_at, updated_at)
         VALUES ($1, $2, $3, 0, $4::jsonb, '[]'::jsonb, $5::jsonb, ${days(opts.ageDays)}, ${days(opts.ageDays)})
         RETURNING id`,
        [opts.user, opts.no ?? null, opts.status ?? 'draft',
         JSON.stringify({ customer_name: `diag:web-draft-sweep ${label}` }),
         opts.approval ? JSON.stringify(opts.approval) : null]);
      return String(rows[0].id);
    };

    const cases: { label: string; id: string; expectDeleted: boolean }[] = [];
    const add = async (label: string, expectDeleted: boolean, opts: Parameters<typeof mk>[1]) =>
      cases.push({ label, expectDeleted, id: await mk(label, opts) });

    await add('ร่างเว็บ อายุ 8 วัน', true, { user: WEB, ageDays: 8 });
    await add('ร่างเว็บ อายุ 30 วัน', true, { user: WEB, ageDays: 30 });
    await add('ร่างเว็บ อายุ 6 วัน (ยังไม่ถึง)', false, { user: WEB, ageDays: 6 });
    await add('ร่าง LINE อายุ 30 วัน', false, { user: LINE, ageDays: 30 });
    await add('ร่างเว็บรออนุมัติ อายุ 30 วัน', false, { user: WEB, ageDays: 30, approval: { request_id: 'diag', status: 'pending' } });
    await add('ร่างเว็บถูกตีกลับ อายุ 30 วัน', false, { user: WEB, ageDays: 30, approval: { request_id: 'diag', status: 'rejected' } });
    await add('ร่างเว็บอนุมัติแล้วแต่ออกใบไม่สำเร็จ อายุ 30 วัน', false, { user: WEB, ageDays: 30, approval: { request_id: 'diag', status: 'approved' } });
    await add('ใบเว็บมีเลขที่แล้ว อายุ 30 วัน', false, { user: WEB, ageDays: 30, status: 'confirmed', no: 'ZZSWEEP-0001' });
    await add('ใบเว็บยกเลิกแล้ว (ไม่มีเลขที่) อายุ 30 วัน', false, { user: WEB, ageDays: 30, status: 'cancelled' });

    const deleted = await deleteStaleWebDrafts(client, STALE_WEB_DRAFT_DAYS);
    const deletedIds = new Set(deleted.map((r) => String(r.id)));
    for (const c of cases) {
      const { rows } = await client.query('SELECT 1 FROM quotations WHERE id = $1', [c.id]);
      const gone = rows.length === 0;
      ok(`${c.expectDeleted ? 'ลบ' : 'ไม่ลบ'}: ${c.label}`,
        gone === c.expectDeleted && deletedIds.has(c.id) === c.expectDeleted,
        gone ? '(หายแล้ว)' : '(ยังอยู่)');
    }
    ok('รอบที่สองไม่ลบใบทดสอบซ้ำ (ไม่เหลือใบที่เข้าเงื่อนไข)',
      (await deleteStaleWebDrafts(client, STALE_WEB_DRAFT_DAYS)).length === 0);
  }
} finally {
  // ROLLBACK เสมอ — สคริปต์นี้ต้องไม่ทิ้งอะไรไว้ใน DB และต้องคืนร่างจริงที่ DELETE ข้างบนลบไปด้วย
  await client.query('ROLLBACK');
  client.release();
}

// ── ฐานจริงตอนนี้: รอบแรกหลังขึ้นระบบจะลบกี่ใบ (อ่านอย่างเดียว) ─────────────────
const { rows: real } = await pool.query(
  `SELECT id, user_id, updated_at, customer_details->>'customer_name' AS name
     FROM quotations WHERE ${STALE_WEB_DRAFT_SQL} ORDER BY updated_at`, [STALE_WEB_DRAFT_DAYS]);
console.log(`\nℹ️  ฐานนี้มีร่างเว็บที่เข้าเงื่อนไขตอนนี้ ${real.length} ใบ` +
  (real.length ? ':\n' + real.map((r: any) => `   · ${r.id} · ${r.user_id} · แตะล่าสุด ${new Date(r.updated_at).toISOString()} · ${r.name ?? '-'}`).join('\n') : ''));

console.log(failures === 0 ? '\nผ่านทั้งหมด' : `\nไม่ผ่าน ${failures} ข้อ`);
await pool.end();
process.exit(failures === 0 ? 0 : 1);
