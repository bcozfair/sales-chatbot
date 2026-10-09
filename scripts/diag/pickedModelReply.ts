// ─────────────────────────────────────────────────────────────────────────────
//  pickedModelReply — ด่าน "กดปุ่มเลือกรุ่นซ้ำหลังได้การ์ดสรุปแล้ว ตอบข้อความที่ถูกไหม" (2026-10-09)
//
//  ข้อความใหม่ (PICKED_MODEL_REPLY) บอกให้กดปุ่ม "แก้ไข" ⇒ ต้องขึ้นเฉพาะเมื่อการ์ดสรุปร่างมีปุ่ม
//  "🔧 แก้ไขรายละเอียด" จริง ซึ่งการ์ดตัดสินด้วย !isCustomerInfoIncomplete (ไม่งั้นปุ่มเป็น "🏢 กรอกข้อมูลลูกค้า")
//  ด่านนี้พิสูจน์สองอย่าง:
//   1. ตัวตัดสินกับกรณีจำลอง (ไม่มีร่าง · ลูกค้าครบ · ยังไม่ระบุ · ลูกค้าทั่วไป · pending_*)
//   2. ร่างจริง 30 ใบล่าสุด ผ่าน enrichQuotationData ตัวเดียวกับการ์ด → ตัวตัดสินต้องตรงกับเงื่อนไขปุ่ม
//      ทุกใบ (ข้อนี้ตรวจ "สิ่งที่ต้องจริงเสมอ" ไม่ได้เทียบกับไฟล์เฉลย ⇒ ข้อมูลเปลี่ยนแล้วไม่เน่า)
//      + SQL ของ getFreshDraftForUser รันได้จริงบนฐาน (เคยพลาด: คอลัมน์ customer_name ไม่มีในตาราง
//      ⇒ ถ้าไม่ตรวจ .catch จะกลืน error แล้วตอบข้อความเดิมทุกครั้งเงียบ ๆ)
//
//  รัน: npm run diag:picked-model-reply   (อ่านฐานอย่างเดียว · ไม่ยิง LINE/LLM)
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from '../../config/db.js';
import { pickedModelReplyApplies } from '../../handlers/lineHandler.js';
import { getFreshDraftForUser } from '../../db/repositories.js';
import { enrichQuotationData } from '../../services/quotationService.js';
import { isCustomerInfoIncomplete } from '../../utils/flexTemplates.js';

let fail = 0;
const ok = (n: string, c: boolean) => { if (!c) fail++; console.log(c ? '✅' : '❌', n); };

console.log('1. ตัวตัดสิน');
ok('ไม่มีร่าง → ข้อความเดิม', pickedModelReplyApplies(null) === false);
ok('ร่างลูกค้าครบ → ข้อความใหม่', pickedModelReplyApplies({ status: 'draft', customer_name: 'บริษัท ทดสอบ จำกัด | คุณเอ' }) === true);
ok('ยังไม่ระบุลูกค้า → ข้อความเดิม', pickedModelReplyApplies({ status: 'draft', customer_name: null }) === false);
ok('ลูกค้าทั่วไป → ข้อความเดิม', pickedModelReplyApplies({ status: 'draft', customer_name: 'ลูกค้าทั่วไป | คุณเอ' }) === false);
ok('pending_company → ข้อความเดิม', pickedModelReplyApplies({ status: 'pending_company', customer_name: 'บริษัท ก | คุณเอ' }) === false);

console.log('\n2. กับฐานจริง (อ่านอย่างเดียว)');
const c = await pool.connect();
try {
  await c.query("SET statement_timeout = '10s'");
  ok('getFreshDraftForUser รันได้ (user ไม่มีจริง → null)', (await getFreshDraftForUser(c, 'U_diag_nobody', 120)) === null);
  const { rows } = await c.query("SELECT * FROM quotations WHERE user_id LIKE 'U%' ORDER BY created_at DESC LIMIT 30");
  let agree = 0, yes = 0;
  for (const row of rows) {
    const e = await enrichQuotationData({ ...row, status: 'draft' });
    const a = pickedModelReplyApplies(e);
    if (a === !isCustomerInfoIncomplete(e)) agree++;
    if (a) yes++;
  }
  ok(`ร่างจริง ${rows.length} ใบ ตัดสินตรงกับปุ่มของการ์ดทุกใบ (ได้ข้อความใหม่ ${yes} ใบ)`, rows.length > 0 && agree === rows.length);
} finally {
  c.release();
  await pool.end();
}
console.log(fail ? `\nล้ม ${fail}` : '\nผ่านทั้งหมด');
process.exit(fail ? 1 : 0);
