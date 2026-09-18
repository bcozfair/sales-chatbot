/**
 * ด่านของโมดูล "คิดราคาสินค้าสั่งทำ" — พิสูจน์สายที่ Node ตรวจได้ทั้งเส้น
 *
 *   pricebook/book.json → ตาราง pricing_subcodes → engine → ราคาบนจอ
 *
 * ทำไมต้องมีด่านนี้ทั้งที่ golden.ts ผ่าน 35 เคสแล้ว: golden พิสูจน์ว่า **ถ้าสมุดราคามีแถวนี้
 * engine คิดถูก** แต่ไม่ได้พิสูจน์ว่าแถวที่แอดมินกดบันทึกลงตารางจริง ๆ จะเดินทางกลับเข้า engine
 * ได้ — ซึ่งเป็นคนละเรื่องและเป็นจุดที่โมดูลนี้เพิ่มเข้ามาใหม่ทั้งหมด
 *
 * ⚠️ ด่านนี้ **เขียนฐานจริง** (insert แล้วลบทิ้งใน finally) — ใช้รหัสย่อยทดสอบที่ไม่มีทางชนของจริง
 * และลบทิ้งก่อนเริ่มด้วย เผื่อรอบก่อนตายกลางทาง · ตัวเลข 700 ในไฟล์นี้เป็นค่าสมมติ ไม่ใช่ราคาจริง
 *
 * ถอนโมดูลออก = ลบไฟล์นี้ + 1 บรรทัดใน package.json ด้วย
 */
import { pool } from '../../config/db.js';
import { loadBook, bookStatus, withSubCodes } from '../../services/pricingLab/bookStore.js';
import { AXIS_TH, DIM_TH } from '../../services/pricingLab/labels.js';
import { parseProductCode, unknownParts } from '../../services/pricingLab/code.js';
import { computePrice } from '../../services/pricingLab/engine.js';
import { listSubCodes, upsertSubCode, deleteSubCode, clean } from '../../db/pricingLabRepo.js';
import type { PriceBook } from '../../services/pricingLab/types.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';
let pass = 0, fail = 0;
function ok(label: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ${GREEN}✓${RESET} ${label}${extra ? ` ${DIM}${extra}${RESET}` : ''}`); }
  else { fail++; console.log(`  ${RED}✗${RESET} ${label}${extra ? ` ${DIM}${extra}${RESET}` : ''}`); }
}

/** รหัสทดสอบมาจากตัวอย่างที่ฝ่ายขายเขียนไว้ในชีต TS-14 เอง ⇒ 5,030 เป็นเฉลยของชีต ไม่ใช่ของผม */
const CODE = 'TSK-14 6x200+150-BU';
const EXPECT_BEFORE = 5030;
const TEST_AMOUNT = 700;          // ค่าสมมติ — ไม่มีใครยืนยันว่า -BU ราคาเท่าไหร่จริง
const EXPECT_AFTER = EXPECT_BEFORE + TEST_AMOUNT;

const TEST_ROW = {
  subCode: 'ZZDIAG',
  match: 'exact' as const,
  scope: 'TS-14',
  reads: 'แถวทดสอบของ diag:pricing (ลบทิ้งเองเสมอ)',
  effect: 'flat' as const,
  amount: TEST_AMOUNT,
};

function priceOf(book: PriceBook, code: string): number | null {
  const parsed = parseProductCode(code, book);
  if (!parsed.cfg) return null;
  return computePrice(parsed.cfg, book).unitPrice;
}

async function cleanupTestRows() {
  await pool.query(`DELETE FROM pricing_subcodes WHERE sub_code IN ('ZZDIAG', 'BU')
                      AND data->>'reads' LIKE '%diag:pricing%'`);
}

async function main() {
  console.log(`\n${BOLD}ด่านโมดูลคิดราคาสินค้าสั่งทำ${RESET}\n`);

  console.log(`${BOLD}1. สมุดราคา${RESET}`);
  const status = bookStatus();
  if (!status.ok) {
    console.log(`  ${RED}✗${RESET} ${status.message}`);
    console.log(`\n${BOLD}สรุป:${RESET} ${RED}รันต่อไม่ได้${RESET} — ไม่มี pricebook/book.json\n`);
    process.exitCode = 1;
    return;
  }
  ok('อ่าน pricebook/book.json ได้', true, `${status.models} รุ่น · ${status.version}`);
  const base = loadBook()!;
  ok('ไม่มีรหัสย่อยที่ไม่ได้มาจากไฟล์ราคาติดมากับสมุด', (base.subCodes ?? []).every((s) => !!s.source),
    `${(base.subCodes ?? []).length} แถวในไฟล์`);

  console.log(`\n${BOLD}2. ทุกคีย์ในสมุดราคามีคำไทย${RESET}`);
  // คีย์อย่าง `dia_group` เป็นหัวคอลัมน์ในชีต Excel — ขึ้นจอดิบ ๆ แล้วแอดมินอ่านไม่ออก
  // ด่านนี้ทำให้ไฟล์ราคารอบใหม่ที่มีคีย์ใหม่ **ล้มที่นี่** ไม่ใช่ไปโผล่เป็นคำเครื่องบนหน้าจอ
  const axisKeys = new Set<string>();
  const dimKeys = new Set<string>();
  for (const m of Object.values(base.models)) {
    // BaseSpec เป็น union — มีช่อง `axes` เฉพาะแบบตาราง (matrix) ส่วนแบบ banded ใช้ `quantity`
    if ('axes' in m.base) for (const a of m.base.axes) axisKeys.add(a);
    if ('quantity' in m.base) dimKeys.add(m.base.quantity);
    for (const d of Object.keys(m.standard ?? {})) dimKeys.add(d);
    for (const ad of m.adders ?? []) {
      if (ad.dim) dimKeys.add(ad.dim);
      if (ad.byAxis) axisKeys.add(ad.byAxis);
    }
  }
  const noAxis = [...axisKeys].filter((k) => !AXIS_TH[k]);
  const noDim = [...dimKeys].filter((k) => !DIM_TH[k]);
  ok('แกนทุกตัวมีคำไทย', noAxis.length === 0, noAxis.join(' · ') || `${axisKeys.size} ตัว`);
  ok('ช่องตัวเลขทุกตัวมีคำไทย', noDim.length === 0, noDim.join(' · ') || `${dimKeys.size} ตัว`);

  console.log(`\n${BOLD}3. คิดราคาจากรหัสที่พิมพ์มา${RESET}`);
  const before = priceOf(base, CODE);
  ok(`${CODE} = ${EXPECT_BEFORE.toLocaleString()}`, before === EXPECT_BEFORE, `ได้ ${before?.toLocaleString()}`);
  const unknownBefore = unknownParts(parseProductCode(CODE, base)).map((p) => p.text);
  ok('BU ยังขึ้นว่าอ่านไม่ออก', unknownBefore.includes('BU'), unknownBefore.join(' · ') || '(ไม่มี)');
  const parsedNow = parseProductCode(CODE, base);
  const bd = parsedNow.cfg ? computePrice(parsedNow.cfg, base).breakdown : [];
  ok('ทุกบรรทัดของ "ที่มาของราคา" มีคำที่คนอ่านได้', bd.length > 0 && bd.every((l) => !!l.label),
    bd.map((l) => l.label).join(' · '));
  ok('ไม่มีคีย์ดิบหลุดไปอยู่ในคำอธิบาย',
    !bd.some((l) => [...axisKeys].some((k) => k.length > 2 && (l.detail ?? '').includes(k))));

  // ขนาดที่ตารางเว้นว่าง = ไม่รับผลิต · ข้อความนี้แอดมินเอาไปตอบลูกค้าตรง ๆ จึงต้องเป็นคำคน
  const noSize = parseProductCode('TSJ-04(S1) 19x100+1M', base);
  const noSizeOut = noSize.cfg ? computePrice(noSize.cfg, base) : null;
  const reason = noSizeOut?.violations.map((v) => v.message).join(' ') ?? '';
  ok('ข้อความ "ไม่รับผลิต" ไม่มีคีย์ดิบ',
    reason.length > 0 && ![...axisKeys].some((k) => k.length > 2 && reason.includes(k)), reason);

  console.log(`\n${BOLD}4. ตัวตรวจรูปแถว (clean)${RESET}`);
  ok('flat ที่ไม่มีจำนวนเงิน ⇒ ปฏิเสธ', clean({ subCode: 'X', effect: 'flat' }) === null);
  ok('ผลกับราคาที่ไม่รู้จัก ⇒ ปฏิเสธ', clean({ subCode: 'X', effect: 'wat', amount: 1 }) === null);
  ok('percent ที่ค้าง amount มาจากการสลับ effect ⇒ ตัด amount ทิ้ง',
    clean({ subCode: 'X', effect: 'percent', percent: 10, amount: 999 })?.amount === undefined);
  ok('ทุกแถวจากตารางนี้ถูกตีธง "ตั้งค่าเอง"', clean(TEST_ROW)?.custom === true);

  console.log(`\n${BOLD}5. แถวในตาราง → ราคาขยับ${RESET}`);
  await cleanupTestRows();
  const saved = await upsertSubCode({ ...TEST_ROW, subCode: 'BU' }, 'diag');
  ok('บันทึกลงตารางได้', !!saved && saved.id > 0, saved ? `id ${saved.id}` : '');
  try {
    const rows = await listSubCodes();
    ok('อ่านกลับออกมาเจอ', rows.some((r) => r.subCode === 'BU' && r.scope === 'TS-14'));
    const merged = withSubCodes(base, rows);
    const after = priceOf(merged, CODE);
    ok(`ราคาขยับเป็น ${EXPECT_AFTER.toLocaleString()}`, after === EXPECT_AFTER, `ได้ ${after?.toLocaleString()}`);
    ok('BU เลิกขึ้นว่าอ่านไม่ออก',
      !unknownParts(parseProductCode(CODE, merged)).some((p) => p.text === 'BU'));

    ok('สมุดราคาตัวที่ cache ไว้ไม่ถูกเขียนทับ', priceOf(loadBook()!, CODE) === EXPECT_BEFORE,
      'คำขอของคนหนึ่งต้องไม่เปลี่ยนคำตอบของอีกคน');

    const again = await upsertSubCode({ ...TEST_ROW, subCode: 'BU', amount: 900 }, 'diag');
    const rows2 = await listSubCodes();
    ok('ตั้งซ้ำที่ (รหัสย่อย, ขอบเขต) เดิม = แก้ของเดิม ไม่ใช่เพิ่มแถวที่สอง',
      again?.id === saved?.id && rows2.filter((r) => r.subCode === 'BU' && r.scope === 'TS-14').length === 1);
    ok('ราคาตามค่าที่แก้ล่าสุด', priceOf(withSubCodes(base, rows2), CODE) === EXPECT_BEFORE + 900);
  } finally {
    if (saved) await deleteSubCode(saved.id);
    await cleanupTestRows();
  }
  const leftover = (await listSubCodes()).filter((r) => r.reads.includes('diag:pricing'));
  ok('ลบแถวทดสอบทิ้งหมดแล้ว', leftover.length === 0, `เหลือ ${leftover.length}`);

  console.log(`\n${BOLD}สรุป:${RESET} ${GREEN}ผ่าน ${pass}${RESET}${fail ? ` · ${RED}ล้ม ${fail}${RESET}` : ''}\n`);
  if (fail) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
