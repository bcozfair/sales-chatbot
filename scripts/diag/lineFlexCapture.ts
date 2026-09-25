// ─────────────────────────────────────────────────────────────────────────────
//  lineFlexCapture — ตัวรันเคสของ diag:line-parity (ไม่ได้ตั้งใจให้เรียกตรง ๆ)
//
//  ยิง 3 เคสเข้า handleEvent ตัวจริง แล้วเขียน "ก้อน JSON ที่จะส่งให้ LINE" ของแต่ละเคสลงไฟล์
//  lineFlexParity.ts เรียกไฟล์นี้สองครั้ง — ครั้งหนึ่งในทรีปัจจุบัน อีกครั้ง **คัดลอกไฟล์นี้ไปวางใน
//  worktree ชั่วคราวของโค้ดก่อนแก้** ⇒ import แบบ relative ข้างล่างจึงชี้ไปที่โค้ดของทรีที่มันถูกวางอยู่
//  ⇒ ไฟล์นี้ใช้ได้เฉพาะ API ที่มีมาตั้งแต่เฟส A/C (2026-09-08): handleEvent(event, { client }) +
//     createCaptureClient() · ห้ามพึ่งของที่เพิ่งเพิ่ม ไม่งั้นเทียบกับ base เก่าไม่ได้
//
//  รัน:  tsx scripts/diag/lineFlexCapture.ts <out.json>
//  ผลข้างเคียง: สร้างแถว salesperson/messages/quotations ของ user ทดสอบ แล้วลบใน finally
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import { pool } from '../../config/db.js';
import { handleEvent } from '../../handlers/lineHandler.js';
import { createCaptureClient } from '../../services/chatChannel.js';

// LINE user id = 'U' + hex 32 ตัว — ปลอมให้เข้ารูปเดิมเป๊ะ เพื่อไม่ให้หลุดเข้าเส้นทาง web:
export const TEST_USER = 'U' + 'd1a9' + '0'.repeat(28);

// 3 เคส = 3 ทางออกของ slots (resolved / กำกวมมี candidate / พิมพ์ผิดไม่มี candidate)
// ผลของแต่ละเคสขึ้นกับสต็อก/ราคาในฐานวันนั้น (เช่น KR-Q50NW ของหมดแล้วกลายเป็นข้อความบล็อก)
// ซึ่งไม่เป็นไร เพราะด่านเทียบ "โค้ดก่อนแก้ vs หลังแก้ บนฐานเดียวกันในเวลาเดียวกัน" ไม่ใช่เทียบกับไฟล์
const CASES = [
  { key: 'case1_resolved', text: 'เสนอราคา\nบริษัท สยามเพาเวอร์ เทคโนโลยี จำกัด\nคุณนรินทร์\nKR-Q50NW = 2 ตัว\nลด 30%' },
  { key: 'case2_ambiguous', text: 'เสนอราคา\nบริษัท สยามเพาเวอร์ เทคโนโลยี จำกัด\nคุณนรินทร์\nKM-09N = 2 ตัว\nลด 30%' },
  { key: 'case3_typo', text: 'เสนอราคา\nบริษัท สยามเพาเวอร์ เทคโนโลยี จำกัด\nคุณนรินทร์\nZZQWXYP = 2 ตัว\nลด 30%' },
];

/**
 * ลบ "ค่าที่เปลี่ยนทุกครั้งโดยธรรมชาติ" ออกก่อนเทียบ — ไม่ใช่การผ่อนเกณฑ์
 * (uuid ของใบ / เลขที่ใบ / วันที่) ที่เหลือต้องตรงทุกตัวอักษร
 */
function normalize(value: any): string {
  let s = JSON.stringify(value, null, 2);
  s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>');
  s = s.replace(/Q[A-Z]-\d{6,}/g, '<quotation_no>');
  s = s.replace(/\d{1,2}\/\d{1,2}\/\d{4}/g, '<date>');
  s = s.replace(/\d{1,2} [ก-๙.]+ \d{4}/g, '<date_th>');
  return s;
}

async function cleanupUser(): Promise<void> {
  // เงื่อนไข user_id ตายตัวและเป็น id ทดสอบเท่านั้น — ไม่มีทางลบข้อมูลเซลส์จริง
  await pool.query('DELETE FROM quotations WHERE user_id = $1', [TEST_USER]);
  await pool.query('DELETE FROM messages WHERE user_id = $1', [TEST_USER]);
}

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('ต้องระบุไฟล์ผลลัพธ์');
  const result: Record<string, { output: string; kinds: string; count: number; ms: number }> = {};
  try {
    await pool.query(
      `INSERT INTO salesperson (user_id, name, status, phone, salesperson_id, branch)
       VALUES ($1, 'DIAG เฟส C (ลบอัตโนมัติ)', 'active', '000-000-0000', 'DIAGC', 'สำนักงานใหญ่')
       ON CONFLICT (user_id) DO UPDATE SET status = 'active'`,
      [TEST_USER]
    );
    for (const c of CASES) {
      // ประวัติแชทเป็นส่วนหนึ่งของ prompt — ล้างทุกเคสให้ผลไม่พึ่งเคสก่อน
      await cleanupUser();
      const cap = createCaptureClient();
      const t0 = Date.now();
      await handleEvent(
        {
          type: 'message',
          replyToken: `diag-${c.key}`,
          source: { type: 'user', userId: TEST_USER },
          message: { id: `diag-msg-${c.key}`, type: 'text', text: c.text },
        },
        { client: cap.client }
      );
      result[c.key] = {
        output: normalize(cap.captured),
        kinds: cap.captured.map((m: any) => m.type).join(',') || '(ว่าง)',
        count: cap.captured.length,
        ms: Date.now() - t0,
      };
    }
  } finally {
    await cleanupUser();
    await pool.query('DELETE FROM salesperson WHERE user_id = $1', [TEST_USER]);
  }
  fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
  await pool.end();
}

main().catch(async (e) => {
  console.error('lineFlexCapture ล้มเหลว:', e);
  try { await cleanupUser(); await pool.query('DELETE FROM salesperson WHERE user_id = $1', [TEST_USER]); } catch {}
  await pool.end();
  process.exit(1);
});
