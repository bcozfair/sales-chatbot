// ─────────────────────────────────────────────────────────────────────────────
//  Smoke test ของ "ลบใบเสนอราคาถาวร" (แอดมินเท่านั้น)
//  รัน:  npm run diag:quote-delete
//
//  ⚠️ สคริปต์นี้ "เขียน" DB จริง แต่ทำงานทั้งหมดในทรานแซกชันเดียวแล้ว ROLLBACK ตอนจบเสมอ
//     รวมถึงตอน assert ไม่ผ่านหรือ throw จึงไม่ทิ้งร่องรอยลง DB — ห้ามเปลี่ยนเป็น COMMIT เด็ดขาด
//     และมัน **สร้างใบทดสอบของตัวเอง** ไม่ได้หยิบใบจริงมาลบ แม้จะ ROLLBACK อยู่ดีก็ตาม
//
//  ครอบคลุม: เลขที่ตรงเท่านั้นถึงลบได้ · พิมพ์ผิด/ตัวพิมพ์ไม่ตรง/มีช่องว่างเกิน = ไม่ลบอะไรเลย ·
//            เลขที่ของ "ใบอื่น" ปนมาไม่ได้ · ใบที่ยังไม่มีเลขที่ลบทางนี้ไม่ได้ ·
//            audit_logs ได้ snapshot ทั้งใบในทรานแซกชันเดียวกัน · ประวัติการส่งออกไม่หายตามใบ ·
//            การถอยส่งออกทั้งชุดยังทำงานได้หลังใบในชุดถูกลบ
//  ให้รันซ้ำทุกครั้งที่แตะ deleteQuotationByNo, insertQuotationDeleteAudit
//  หรือ endpoint DELETE /api/admin/quotations/:id
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from '../../config/db.js';
import {
  deleteQuotationByNo,
  insertExportBatch,
  insertExportLogRows,
  unmarkExportBatch,
} from '../../db/repositories.js';
import { insertQuotationDeleteAudit } from '../../db/logRepositories.js';

let failures = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

/** เลขที่ใบของชุดทดสอบ — ขึ้นต้น ZZ ให้ต่างจากของจริง (QP/QT) ชัดเจนถ้าเผลอหลุดออกไป */
const NO_A = 'ZZTEST-0001';
const NO_B = 'ZZTEST-0002';

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // ── 0. สร้างใบทดสอบ 3 ใบ: A กับ B มีเลขที่ · C ยังไม่มีเลขที่ ──────────
  // user_id ปล่อย NULL เพราะ FK ไป salesperson เป็น ON DELETE SET NULL อยู่แล้ว
  // ⇒ ไม่ต้องไปยืมผู้ขายจริงมาเป็นเจ้าของใบทดสอบ
  const mk = async (no: string | null, status: string) => {
    const { rows } = await client.query(
      `INSERT INTO quotations (quotation_no, status, total_sum, customer_details, item_details)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb) RETURNING id`,
      [no, status, 1234.56,
       JSON.stringify({ customer_name: 'บจก. ทดสอบการลบ', contact_name: 'คุณทดสอบ ' }),
       JSON.stringify([{ model: 'ZZ-TEST', quantity: 1, price: 1234.56 }])]);
    return String(rows[0].id);
  };

  const idA = await mk(NO_A, 'confirmed');
  const idB = await mk(NO_B, 'confirmed');
  const idC = await mk(null, 'draft');
  console.log(`   ใบทดสอบ: A=${NO_A} · B=${NO_B} · C=(ไม่มีเลขที่)\n`);

  // ── 1. พิมพ์ไม่ตรง = ไม่ลบอะไรเลย ─────────────────────────────────────
  // ทุกเคสในข้อนี้ต้องคืน null **และ** ใบต้องยังอยู่ — เช็คแค่ค่าที่คืนมาไม่พอ
  // เพราะ null ที่มาพร้อมกับใบที่หายไปแล้วคือบั๊กที่ร้ายที่สุดของฟีเจอร์นี้
  const stillThere = async (id: string) => {
    const { rows } = await client.query(`SELECT 1 FROM quotations WHERE id = $1::uuid`, [id]);
    return rows.length === 1;
  };

  ok('พิมพ์เลขที่ผิดไป 1 ตัว → ไม่ลบ',
    (await deleteQuotationByNo(client, idA, 'ZZTEST-0091')) === null && await stillThere(idA));

  ok('พิมพ์ถูกแต่เป็นตัวพิมพ์เล็ก → ไม่ลบ (เทียบตรงตัว ไม่ทำ case-insensitive)',
    (await deleteQuotationByNo(client, idA, NO_A.toLowerCase())) === null && await stillThere(idA));

  ok('พิมพ์ถูกแต่มีช่องว่างท้าย → ไม่ลบ (ด่านนี้ไม่ trim ให้)',
    (await deleteQuotationByNo(client, idA, `${NO_A} `)) === null && await stillThere(idA));

  ok('ส่งค่าว่างมา → ไม่ลบ',
    (await deleteQuotationByNo(client, idA, '')) === null && await stillThere(idA));

  // เคสที่อันตรายที่สุด: เลขที่ถูกต้องจริง แต่เป็นของ "อีกใบ" ⇒ ต้องไม่ลบใบไหนเลยสักใบ
  ok('id ของใบ A + เลขที่ของใบ B → ไม่ลบ และใบ B ไม่ถูกแตะ',
    (await deleteQuotationByNo(client, idA, NO_B)) === null
    && await stillThere(idA) && await stillThere(idB));

  // ── 2. ใบที่ยังไม่มีเลขที่ ลบทางนี้ไม่ได้ ──────────────────────────────
  ok('ใบที่ไม่มีเลขที่ + ส่งค่าว่าง → ไม่ลบ (กติกาที่เจ้าของเลือก: ซ่อนปุ่มในแถวแบบนี้)',
    (await deleteQuotationByNo(client, idC, '')) === null && await stillThere(idC));

  // ── 3. ประวัติการส่งออกของใบ A ต้องรอดหลังใบถูกลบ ─────────────────────
  const batchId = await insertExportBatch(client, {
    adminId: null, adminUsername: 'diag', format: 'csv',
    quotationCount: 2, rowCount: 2, filters: {},
  });
  await insertExportLogRows(client, batchId, [
    { id: idA, quotation_no: NO_A },
    { id: idB, quotation_no: NO_B },
  ]);
  await client.query(
    `UPDATE quotations SET odoo_exported_at = CURRENT_TIMESTAMP WHERE id = ANY($1::uuid[])`,
    [[idA, idB]]);

  // ── 4. เลขที่ตรง = ลบได้ และได้ทั้งแถวกลับมาทำ snapshot ───────────────
  const deleted = await deleteQuotationByNo(client, idA, NO_A);
  ok('เลขที่ตรงทุกตัวอักษร → ลบสำเร็จ', deleted !== null && !(await stillThere(idA)));
  ok('คืนทั้งแถวกลับมาให้ทำ snapshot ไม่ใช่แค่ id',
    !!deleted && String(deleted.id) === idA && deleted.quotation_no === NO_A
    && deleted.customer_details?.customer_name === 'บจก. ทดสอบการลบ'
    && Array.isArray(deleted.item_details) && deleted.item_details.length === 1,
    deleted ? `(คอลัมน์ที่ได้กลับมา ${Object.keys(deleted).length} ช่อง)` : '');

  ok('ลบซ้ำใบเดิม → คืน null เฉย ๆ ไม่ throw (idempotent)',
    (await deleteQuotationByNo(client, idA, NO_A)) === null);

  // ── 5. audit_logs ได้ snapshot ครบในทรานแซกชันเดียวกัน ────────────────
  await insertQuotationDeleteAudit(client, {
    actorId: 999999, actorName: 'ผู้ดูแลทดสอบ', requestId: 'diagdel0',
    ip: '127.0.0.1', quotation: deleted!,
  });
  const { rows: audit } = await client.query(
    `SELECT action, entity_type, entity_id, entity_label, actor_type, actor_id,
            actor_name, actor_source, ip, request_id, before
       FROM audit_logs WHERE entity_id = $1 ORDER BY id DESC LIMIT 1`, [idA]);
  const a = audit[0];
  ok('audit_logs ได้แถวของการลบใบนี้', !!a);
  ok('action / entity_type ตรงตามที่หน้ารายงานใช้กรอง',
    !!a && a.action === 'quotation.delete' && a.entity_type === 'quotation');
  ok('entity_label เก็บเลขที่ใบไว้ให้อ่านออกโดยไม่ต้องแกะ jsonb', !!a && a.entity_label === NO_A);
  ok('ผู้ทำถูกบันทึกแบบ direct (ไม่ต้องรอ logworker เดาย้อนหลัง)',
    !!a && a.actor_type === 'admin' && a.actor_id === '999999'
    && a.actor_name === 'ผู้ดูแลทดสอบ' && a.actor_source === 'direct');
  ok('IP และ request_id ถูกบันทึก (ต่อกับ api_logs ของ request เดียวกันได้)',
    !!a && a.ip === '127.0.0.1' && a.request_id === 'diagdel0');
  ok('before = snapshot ทั้งใบ ไม่ใช่แค่ id/เลขที่',
    !!a && a.before?.quotation_no === NO_A
    && a.before?.customer_details?.customer_name === 'บจก. ทดสอบการลบ'
    && Array.isArray(a.before?.item_details) && a.before.item_details.length === 1);
  ok('ช่องว่างท้ายชื่อผู้ติดต่อใน snapshot ไม่ถูก trim (ชื่อที่ trim แล้วคือคนละ partner ของ Odoo)',
    !!a && a.before?.customer_details?.contact_name === 'คุณทดสอบ ');

  // ── 6. ของที่ต้องไม่หายตามใบไปด้วย ────────────────────────────────────
  const { rows: log } = await client.query(
    `SELECT quotation_id, quotation_no FROM quotation_export_log
      WHERE batch_id = $1::uuid AND quotation_no = $2`, [batchId, NO_A]);
  ok('แถวประวัติการส่งออกของใบที่ถูกลบยังอยู่', log.length === 1);
  ok('quotation_id กลายเป็น NULL (FK ON DELETE SET NULL) แต่เลขที่ใบยังอ่านได้',
    log.length === 1 && log[0].quotation_id === null && log[0].quotation_no === NO_A);

  // ── 7. ถอยส่งออกทั้งชุดยังทำงานได้ ไม่สะดุดกับใบที่หายไป ──────────────
  const reverted = await unmarkExportBatch(client, batchId);
  ok('ถอยทั้งชุดได้ และนับเฉพาะใบที่ยังอยู่ (ข้ามใบที่ถูกลบไปเงียบ ๆ)', reverted === 1,
    `(ถอย ${reverted} / คาด 1 — ชุดนี้มี 2 ใบ ลบไปแล้ว 1)`);
  const { rows: bStill } = await client.query(
    `SELECT odoo_exported_at FROM quotations WHERE id = $1::uuid`, [idB]);
  ok('ใบ B กลับมาอยู่ในคิวรอส่งออกตามปกติ', bStill[0]?.odoo_exported_at === null);
} finally {
  // ROLLBACK เสมอ — สคริปต์นี้ต้องไม่ทิ้งอะไรไว้ใน DB
  await client.query('ROLLBACK');
  client.release();
}

console.log(failures === 0 ? '\nผ่านทั้งหมด' : `\nไม่ผ่าน ${failures} ข้อ`);
await pool.end();
process.exit(failures === 0 ? 0 : 1);
