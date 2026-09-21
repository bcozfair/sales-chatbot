// ─────────────────────────────────────────────────────────────────────────────
//  ด่านตรวจ: เทียบผลของ engine กับ "ตัวอย่างการคิดราคา" ที่เขียนอยู่ในชีตเอง
//
//  เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md
//
//  ชีตแถมข้อสอบพร้อมเฉลยมาให้แล้ว — ฝ่ายขายเขียน "วิธีคิดราคา" ไว้ข้าง ๆ ตาราง
//  นี่คือ golden case ที่ดีที่สุดที่หาได้ เพราะมันคือสิ่งที่ "คนที่รู้เรื่องจริง" บอกว่าถูก
//
//  รัน:  npm run diag:pricing
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProductCode } from '../../services/pricingLab/code.js';
import { computePrice, formatOutcome } from '../../services/pricingLab/engine.js';
import type { PriceBook, ProductConfig, SubCode } from '../../services/pricingLab/types.js';
import { BOOK_PATH } from '../../services/pricingLab/bookStore.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const book = JSON.parse(readFileSync(BOOK_PATH, 'utf8')) as PriceBook;

interface Case {
  name: string;
  /** ที่มาของเฉลย — เซลล์ในชีต */
  source: string;
  kind: string;
  cfg: ProductConfig;
  /** รหัสสินค้าที่ต้องอ่านแล้วได้ `cfg` ข้างบนนี้เป๊ะ — มีเฉพาะเคสที่เขียนเป็นรหัสจริงได้ */
  code?: string;
  expectPrice?: number;
  expectStatus?: 'priced' | 'quoteOnRequest' | 'notManufacturable';
  /** พิมพ์ breakdown เต็มออกมาด้วย */
  show?: boolean;
}

// เคสอยู่ในไฟล์ JSON ไฟล์เดียว เพราะหน้าเดโม (demo/) ใช้ชุดเดียวกันนี้
// ถ้าปล่อยให้ต่างคนต่างถือรายการ วันหนึ่งด่านกับหน้าที่เอาไปให้คนดูจะเล่าคนละเรื่อง
const CASES = JSON.parse(readFileSync(join(HERE, 'fixtures', 'pricingCases.json'), 'utf8')) as Case[];

// ── รัน ──────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

console.log(`\nสมุดราคา: ${book.source}`);
console.log(`นำเข้าเมื่อ: ${book.version}   รุ่นในสมุด: ${Object.keys(book.models).join(', ')}\n`);

for (const c of CASES) {
  const out = computePrice(c.cfg, book);
  const okPrice = c.expectPrice === undefined || out.unitPrice === c.expectPrice;
  const okStatus = c.expectStatus === undefined || out.status === c.expectStatus;
  const ok = okPrice && okStatus;
  ok ? pass++ : fail++;

  console.log(`${ok ? '✓' : '✗ FAIL'}  ${c.name}`);
  console.log(`   ที่มาของเฉลย: ${c.source}`);
  if (c.expectPrice !== undefined) {
    console.log(`   คาดหวัง ${c.expectPrice.toLocaleString()} · ได้ ${out.unitPrice.toLocaleString()}`);
  }
  if (c.expectStatus !== undefined) {
    console.log(`   คาดหวังสถานะ ${c.expectStatus} · ได้ ${out.status}`);
  }
  if (c.show || !ok) {
    console.log('');
    console.log(
      formatOutcome(out)
        .split('\n')
        .map((l) => '   ' + l)
        .join('\n')
    );
  }
  console.log('');
}

// ── ตรวจความสอดคล้องของตัวอย่างในชีต (รายงานอย่างเดียว ไม่ใช่ด่าน) ───────────
//
// ไม่ใช่ทุกตัวอย่างในชีตจะยังตรงกับตารางของตัวเอง — ตัวอย่างถูกเขียนครั้งเดียว
// แต่ตารางราคาถูกแก้เรื่อย ๆ ⇒ ต้องแยก "เฉลยที่เชื่อได้" ออกจาก "เฉลยที่ค้างมาจากราคาเก่า"
// ก่อนเอาไปใช้เป็น golden ไม่งั้นจะไปแก้ engine ให้ตรงกับหมายเหตุที่ล้าสมัย

// ── ด่านตรวจตัวอ่านรหัส ──────────────────────────────────────────────────────
//
// เทียบ "สเปกที่อ่านได้จากรหัส" กับ "สเปกที่คนเขียนไว้ในเคส" ทีละคีย์
// เทียบราคาอย่างเดียวไม่พอ เพราะอ่านผิดคนละรหัสย่อยแล้วบังเอิญได้ราคาเท่ากันเป็นไปได้
// (เช่น อ่านความยาวไม่เจอ แล้วไปเจอส่วนบวกเพิ่มอีกตัวที่บังเอิญเท่ากัน)

const sortKeys = (o: unknown): unknown => {
  if (Array.isArray(o)) return [...o].sort();
  if (o && typeof o === 'object') {
    return Object.fromEntries(
      Object.entries(o as Record<string, unknown>)
        .filter(([, v]) => !(v && typeof v === 'object' && Object.keys(v).length === 0))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)])
    );
  }
  return o;
};
const same = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

console.log('─'.repeat(70));
console.log('ด่านตรวจตัวอ่านรหัส — รหัสต้องแปลงเป็นสเปกเดียวกับที่เขียนไว้ในเคส');
console.log('─'.repeat(70));
for (const c of CASES.filter((x) => x.code)) {
  const parsed = parseProductCode(c.code!, book);
  const ok = parsed.cfg !== undefined && same(parsed.cfg, c.cfg);
  ok ? pass++ : fail++;
  const unknown = parsed.parts.filter((p) => p.kind === 'unknown').map((p) => p.text);
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${c.code}`);
  if (!ok) {
    console.log(`   คาดหวัง ${JSON.stringify(sortKeys(c.cfg))}`);
    console.log(`   อ่านได้ ${JSON.stringify(sortKeys(parsed.cfg))}`);
    if (parsed.problems.length) console.log(`   ปัญหา: ${parsed.problems.join(' · ')}`);
  } else if (unknown.length) {
    console.log(`   (มีรหัสย่อยที่อ่านไม่ออกและถูกรายงานไว้: ${unknown.join(' · ')})`);
  }
}
console.log('');

// ── ด่านตรวจตารางรหัสย่อย ────────────────────────────────────────────────────
//
// คำถามที่ด่านนี้ตอบ: **"แอดมินตั้งค่ารหัสย่อยแล้ว ราคาขยับตามที่ตั้งไว้จริงไหม"**
// ตัวเลขที่คาดหวังคิดจากเคส TSK-14 ที่ชีตเฉลยไว้เอง (5,030) แล้วบวกตามกฎที่ตั้ง
// ⇒ ผิดเมื่อไหร่รู้ทันทีว่าเพี้ยนที่ "ตารางรหัสย่อย" ไม่ใช่ที่ราคาตั้ง
//
// **แถวที่ใช้ในด่านนี้เป็นของสมมติ ไม่ใช่ราคาจริงของร้าน** — ราคาจริงของ `-BU` ยังไม่มี
// ใครยืนยัน (ชีตมีคอลัมน์ "หัวกระโหลก Blacklite ใหญ่ +700" แต่ตัวอย่างของชีตเองไม่คิดค่านี้)
// จึงห้ามเอาไปใส่ในสมุดราคาจริงจนกว่าฝ่ายขายจะตอบ

const ts14: ProductConfig = {
  model: 'TS-14',
  axes: { sensor: 'K', dia_group: 'Ø6mm./12.7mm.' },
  dims: { L1: 200, L2: 150 }
};

/** สมุดราคาเล่มเดิม + ตารางรหัสย่อยชุดทดสอบ — ไม่แตะ book.json จริง */
function withSubCodes(rows: SubCode[]): PriceBook {
  return { ...book, subCodes: [...(book.subCodes ?? []), ...rows] };
}

function subCase(name: string, rows: SubCode[], cfg: ProductConfig, expect: number): void {
  const out = computePrice(cfg, withSubCodes(rows));
  const ok = out.unitPrice === expect;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${name}`);
  console.log(`   คาดหวัง ${expect.toLocaleString()} · ได้ ${out.unitPrice.toLocaleString()}`);
  if (!ok) {
    console.log(
      formatOutcome(out)
        .split('\n')
        .map((l) => '   ' + l)
        .join('\n')
    );
  }
}

console.log('─'.repeat(70));
console.log('ด่านตรวจตารางรหัสย่อย — ตั้งค่าแล้วราคาต้องขยับตามที่ตั้งไว้');
console.log('─'.repeat(70));

subCase(
  'บวกเงินคงที่ 700 (5,030 + 700)',
  [{ subCode: 'BU', match: 'exact', scope: 'TS-14', reads: 'หัวกระโหลกใหญ่ (ค่าสมมติสำหรับด่านตรวจ)', effect: 'flat', amount: 700, order: 60 }],
  { ...ts14, options: ['sub:BU'] },
  5730
);

subCase(
  'บวกเปอร์เซ็นต์ 10% ของยอดสะสม (5,030 → 5,533)',
  [{ subCode: 'PX', match: 'exact', scope: 'TS-14', reads: 'ค่าสมมติสำหรับด่านตรวจ', effect: 'percent', percent: 10, order: 60 }],
  { ...ts14, options: ['sub:PX'] },
  5533
);

subCase(
  'บวกตามส่วนที่เกิน — L1 เกิน 100 ไป 100 mm ทีละ 100 @10 (5,030 + 10)',
  [{ subCode: 'PU', match: 'exact', scope: 'TS-14', reads: 'ค่าสมมติสำหรับด่านตรวจ', effect: 'perUnit', dim: 'L1', over: 100, step: 100, rate: 10, unit: ' mm', order: 60 }],
  { ...ts14, options: ['sub:PU'] },
  5040
);

subCase(
  'ราคาตั้งต้นของตัวเอง — ทิ้งตารางราคาตั้งไปเลย (1,234 + ส่วนที่เกินของกฎเดิม 1,030)',
  [{ subCode: 'ZZ', match: 'exact', scope: 'TS-14', reads: 'ราคาเหมาสมมติสำหรับด่านตรวจ', effect: 'basePrice', amount: 1234, order: 1 }],
  { ...ts14, options: ['sub:ZZ'] },
  2264
);

{
  // แม่แบบ: S### ต้องจับ S000 S001 S002 ได้ทั้งชุดด้วยแถวเดียว
  const rows: SubCode[] = [
    { subCode: 'S###', match: 'pattern', scope: '*', reads: 'หมายเลขแบบ (ค่าสมมติ)', effect: 'flat', amount: 100, order: 60 }
  ];
  const a = computePrice({ ...ts14, options: ['sub:S000'] }, withSubCodes(rows)).unitPrice;
  const b = computePrice({ ...ts14, options: ['sub:S742'] }, withSubCodes(rows)).unitPrice;
  const ok = a === 5130 && b === 5130;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  แม่แบบ S### แถวเดียวจับได้ทั้ง S000 และ S742`);
  console.log(`   คาดหวัง 5,130 ทั้งคู่ · ได้ ${a.toLocaleString()} · ${b.toLocaleString()}`);
}

{
  // ชั้นของขอบเขต: แถวที่เจาะจงรุ่น ต้องชนะแถวที่ตั้งไว้กลาง ๆ เสมอ
  const rows: SubCode[] = [
    { subCode: 'KK', match: 'exact', scope: '*', reads: 'ค่ากลาง', effect: 'flat', amount: 100, order: 60 },
    { subCode: 'KK', match: 'exact', scope: 'TS-14', reads: 'ค่าของรุ่นนี้', effect: 'flat', amount: 900, order: 60 }
  ];
  const price = computePrice({ ...ts14, options: ['sub:KK'] }, withSubCodes(rows)).unitPrice;
  const ok = price === 5930;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  แถวที่เจาะจงรุ่นชนะแถวที่ใช้ทุกรุ่น`);
  console.log(`   คาดหวัง 5,930 (ของรุ่นนี้ 900) · ได้ ${price.toLocaleString()}`);
}

{
  // ปิดไว้ = ไม่มีผลกับราคา แต่แถวยังอยู่ (เหมือนกฎบวกเพิ่มที่ปิดไว้)
  const rows: SubCode[] = [
    { subCode: 'OFFX', match: 'exact', scope: 'TS-14', reads: 'ปิดไว้', effect: 'flat', amount: 700, order: 60, disabled: true }
  ];
  const price = computePrice({ ...ts14, options: ['sub:OFFX'] }, withSubCodes(rows)).unitPrice;
  const ok = price === 5030;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  แถวที่ปิดไว้ไม่มีผลกับราคา`);
  console.log(`   คาดหวัง 5,030 · ได้ ${price.toLocaleString()}`);
}

{
  // รหัสย่อยที่ยังไม่มีใครตั้งค่า ต้องไม่ทำให้ราคาขยับ และต้องยังถูกรายงานว่าอ่านไม่ออก
  const price = computePrice({ ...ts14, options: ['sub:ไม่มีจริง'] }, book).unitPrice;
  const parsed = parseProductCode('TSK-14 6x200+150-QQ', book);
  const flagged = parsed.parts.some((p) => p.kind === 'unknown' && p.text.toUpperCase() === 'QQ');
  const ok = price === 5030 && flagged;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  รหัสย่อยที่ยังไม่ได้ตั้งค่า: ราคาไม่ขยับ และขึ้นธงว่าอ่านไม่ออก`);
  console.log(`   ราคา ${price.toLocaleString()} (คาด 5,030) · ขึ้นธง ${flagged ? 'ครบ' : 'ไม่ขึ้น'}`);
}

{
  // setAxis: รหัสย่อยเซ็ตค่าให้ช่อง แล้วปล่อยให้ตารางราคาเดิมคิดต่อ
  // ค่าเกลียวหยิบมาจากเคสที่ชีตเฉลยไว้เอง เพื่อไม่ต้องพิมพ์เครื่องหมายนิ้วซ้ำในไฟล์นี้
  const threadCase = CASES.find((x) => x.cfg.axes?.thread);
  const thread = threadCase?.cfg.axes?.thread ?? '';
  const rows: SubCode[] = [
    { subCode: 'TT', match: 'exact', scope: 'TSK-04', reads: 'เกลียวตามค่าที่ตั้งไว้', effect: 'setAxis', axis: 'thread', value: thread }
  ];
  const price = computePrice({ model: 'TSK-04', axes: { D: '6' }, dims: { L1: 300 }, options: ['sub:TT'] }, withSubCodes(rows)).unitPrice;
  const ok = price === 1010;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ตั้งค่าให้ช่อง (เกลียว ${thread}) แล้วตารางราคาเดิมคิดต่อได้`);
  console.log(`   คาดหวัง 1,010 · ได้ ${price.toLocaleString()}`);
}

console.log('');

console.log('─'.repeat(70));
console.log('ตรวจตัวอย่างในชีตที่ "ไม่ควรเชื่อ" — TS-18');
console.log('─'.repeat(70));
const ts18Note = computePrice(
  {
    model: 'TS-18',
    axes: { D: '6', sensor: 'Type K/J', flange: '2  นิ้ว' },
    dims: { L1: 100, L2: 50 },
    options: ['element:2']
  },
  book
);
console.log('  ชีตเขียนไว้ที่ TS-18!L4 ว่า:');
console.log('     "เช่น TSK-18(2) 6-6x100+50 = 800+650+(5x25) = 1525"');
console.log('  แต่ตัวอย่างนั้นไม่ตรงกับตารางของตัวเองอยู่แล้ว:');
console.log('     · 800 + 650 + 125 = 1,575 ไม่ใช่ 1,525 (เลขในหมายเหตุบวกกันเองยังไม่ลงตัว)');
console.log(`     · ราคาตั้ง D=6 Type K/J ในตารางปัจจุบัน (TS-18!D25) = 880 ไม่ใช่ 800`);
console.log(`  engine คิดจากตารางปัจจุบันได้ = ${ts18Note.unitPrice.toLocaleString()}`);
console.log('  ⇒ หมายเหตุนี้ค้างมาจากราคาเก่า **ห้ามใช้เป็น golden** และห้ามแก้ engine ให้ตรงกับมัน');
console.log('');

console.log('─'.repeat(70));
console.log(`ผล: ผ่าน ${pass} · ตก ${fail}`);
console.log('─'.repeat(70));
process.exit(fail > 0 ? 1 : 0);
