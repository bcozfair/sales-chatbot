// ─────────────────────────────────────────────────────────────────────────────
//  ด่านตรวจของแม่แบบ .xlsx: ส่งออก → อ่านกลับ → ราคาต้องเท่าเดิมทุกบาท
//
//  เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md
//
//  **คำถามที่ด่านนี้ตอบ** — ไม่ใช่ "โค้ดรันผ่านไหม" แต่คือ:
//    1. ไฟล์ที่เราปั้นเอง เป็น .xlsx จริงหรือเปล่า (ให้ exceljs ซึ่งเป็นคนละตัวกับตัวเขียน เป็นคนอ่าน)
//    2. ข้อมูลครบไหม — ราคา 303 ช่อง · อัตราตามแกน 346 แถว · กฎ 47 ข้อ · ข้อห้าม 12 ข้อ
//    3. **ราคาที่ลูกค้าจะได้ เปลี่ยนไปไหม** — รันเคสทดสอบทั้งชุดกับสมุดที่เดินทางไปกลับแล้ว
//       ข้อนี้สำคัญที่สุด เพราะ 1 กับ 2 ผ่านได้ทั้งที่ราคาเพี้ยน (เช่น ปัดเศษหาย ช่องว่างกลายเป็น 0)
//    4. แก้ไฟล์แล้วราคาเปลี่ยนตามจริงไหม — จำลองการแก้แบบที่แอดมินจะทำ 3 แบบ
//       (เปลี่ยน % · ปิดกฎ · เพิ่มกฎใหม่) แล้วเทียบกับเลขที่คำนวณด้วยมือ
//
//  รัน:  npm run diag:pricing
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePrice } from '../../services/pricingLab/engine.js';
import { bookToOdooSheets } from '../pricebook/odoo.js';
import { bookToSheets, sheetsToBook, SHEET_NAMES, VOCAB } from '../pricebook/sheet.js';
import type { CellValue, RawSheet } from '../pricebook/sheet.js';
import type { PriceBook, ProductConfig } from '../../services/pricingLab/types.js';
import { BOOK_PATH } from '../../services/pricingLab/bookStore.js';
import { readWorkbook } from '../pricebook/xlsx.js';
import { writeXlsx } from '../pricebook/xlsxlite.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const book = JSON.parse(readFileSync(BOOK_PATH, 'utf8')) as PriceBook;
const CASES = JSON.parse(readFileSync(join(HERE, 'fixtures', 'pricingCases.json'), 'utf8')) as {
  name: string;
  cfg: ProductConfig;
}[];

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: string): void {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}${detail ? `  —  ${detail}` : ''}`);
}

function countBook(b: PriceBook) {
  let cells = 0;
  let bands = 0;
  let rates = 0;
  let adders = 0;
  let constraints = 0;
  let derived = 0;
  for (const m of Object.values(b.models)) {
    if (m.base.kind === 'matrix') cells += Object.keys(m.base.cells).length;
    if (m.base.kind === 'banded') bands += m.base.bands.length;
    adders += m.adders.length;
    constraints += m.constraints.length;
    derived += (m.derivedDims ?? []).length;
    for (const a of m.adders) rates += Object.keys(a.rates ?? {}).length;
  }
  return {
    models: Object.keys(b.models).length,
    cells,
    bands,
    rates,
    adders,
    constraints,
    derived,
    subCodes: (b.subCodes ?? []).length
  };
}

/** หาแถวในตารางที่อ่านกลับมา แล้วแก้ช่องหนึ่ง — จำลองการที่แอดมินเปิด Excel แล้วพิมพ์ทับ */
function editCell(grids: RawSheet[], sheet: string, match: (row: CellValue[]) => boolean, column: string, value: CellValue): boolean {
  const g = grids.find((x) => x.name === sheet);
  if (!g) return false;
  const headerRow = g.rows.findIndex((r) => r.map((c) => String(c ?? '').trim()).includes(column));
  if (headerRow < 0) return false;
  const col = g.rows[headerRow]!.findIndex((c) => String(c ?? '').trim() === column);
  const row = g.rows.find((r, i) => i > headerRow && match(r));
  if (!row) return false;
  row[col] = value;
  return true;
}

const tmp = join(tmpdir(), `pricing-roundtrip-${process.pid}.xlsx`);
const tmpOdoo = join(tmpdir(), `pricing-odoo-${process.pid}.xlsx`);

try {
  // ── 1. เขียน ──────────────────────────────────────────────────────────────
  const sheets = bookToSheets(book, { exportedAt: '2026-09-17' });
  const bytes = writeXlsx(sheets);
  writeFileSync(tmp, bytes);
  console.log(`\nแม่แบบกฎราคา: ${sheets.length} ชีต · ${(bytes.length / 1024).toFixed(0)} KB\n`);

  // ── 2. ให้ไลบรารีคนละตัวเป็นคนอ่าน ────────────────────────────────────────
  const grids = await readWorkbook(tmp);
  check('exceljs เปิดไฟล์ที่เราเขียนเองได้', grids.length === sheets.length, `${grids.length}/${sheets.length} ชีต`);
  check(
    'ชื่อชีตครบและตรง',
    sheets.every((s) => grids.some((g) => g.name === s.name)),
    grids.map((g) => g.name).join(' · ')
  );

  // ── 3. อ่านกลับเป็นสมุดราคา ───────────────────────────────────────────────
  const { book: back, issues } = sheetsToBook(grids);
  const errors = issues.filter((i) => i.level === 'error');
  check('อ่านกลับได้โดยไม่มีข้อผิดพลาด', back !== null && errors.length === 0, `ผิดพลาด ${errors.length} · เตือน ${issues.length - errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`      ✗ [${e.sheet}${e.row ? ' แถว ' + e.row : ''}] ${e.message}`);
  if (!back) throw new Error('อ่านกลับไม่ได้เลย — หยุดตรงนี้');

  const a = countBook(book);
  const b = countBook(back);
  for (const key of Object.keys(a) as (keyof typeof a)[]) {
    check(`จำนวน ${key} เท่าเดิม`, a[key] === b[key], `เดิม ${a[key]} · หลังเดินทางไปกลับ ${b[key]}`);
  }

  // ── 4. ราคาเท่าเดิมทุกเคส (ข้อที่สำคัญที่สุด) ─────────────────────────────
  console.log('');
  let priceDiff = 0;
  for (const c of CASES) {
    const before = computePrice(c.cfg, book);
    const after = computePrice(c.cfg, back);
    const same = before.unitPrice === after.unitPrice && before.status === after.status;
    if (!same) {
      priceDiff++;
      console.log(`      ✗ ${c.name}: ${before.unitPrice} (${before.status}) → ${after.unitPrice} (${after.status})`);
    }
  }
  check(`ราคาเท่าเดิมทั้ง ${CASES.length} เคส`, priceDiff === 0, priceDiff ? `ต่างกัน ${priceDiff} เคส` : 'ตรงทุกบาท');

  // เทียบให้ครบทุกช่องในตาราง ไม่ใช่แค่เคสทดสอบ — เคสทดสอบแตะแค่ไม่กี่ช่อง
  let cellDiff = 0;
  for (const m of Object.values(book.models)) {
    if (m.base.kind !== 'matrix') continue;
    const m2 = back.models[m.code];
    if (!m2 || m2.base.kind !== 'matrix') {
      cellDiff++;
      continue;
    }
    for (const [k, v] of Object.entries(m.base.cells)) {
      if (m2.base.cells[k] !== v) cellDiff++;
    }
  }
  check(`ราคาในตารางตรงกันทุกช่อง (${a.cells} ช่อง)`, cellDiff === 0, cellDiff ? `ต่าง ${cellDiff} ช่อง` : 'ตรงทุกช่อง');

  // ── 5. จำลองการแก้ไฟล์แบบที่แอดมินจะทำจริง ────────────────────────────────
  //
  // เลขที่คาดหวังคำนวณด้วยมือจากตัวอย่างในชีต BH: พื้นที่ผิว 439 × 25 = 10,975
  const bhCase: ProductConfig = { model: 'BH-01C', dims: { dia_mm: 600, width_mm: 150 }, options: ['conn:pl2'] };
  console.log('');
  console.log(`เดิม: ${computePrice(bhCase, book).unitPrice.toLocaleString()} บาท  (10,975 → +20% → +320)`);

  {
    // ก) เปลี่ยนเปอร์เซ็นต์ 20 → 30
    const g = await readWorkbook(tmp);
    const ok = editCell(g, SHEET_NAMES.adders, (r) => String(r[2] ?? '') === 'c_uplift', 'เปอร์เซ็นต์', 30);
    const { book: edited } = sheetsToBook(g);
    const price = edited ? computePrice(bhCase, edited).unitPrice : -1;
    check('แก้ % ในไฟล์ (20 → 30) แล้วราคาเปลี่ยนตาม', ok && price === 14587.5, `ได้ ${price.toLocaleString()} · คาด 14,587.5`);
  }

  {
    // ข) ปิดกฎไว้โดยไม่ลบแถว
    const g = await readWorkbook(tmp);
    const ok = editCell(g, SHEET_NAMES.adders, (r) => String(r[2] ?? '') === 'c_uplift', 'เปิดใช้', VOCAB.OFF);
    const { book: edited } = sheetsToBook(g);
    const price = edited ? computePrice(bhCase, edited).unitPrice : -1;
    const stillThere = edited?.models['BH-01C']?.adders.some((x) => x.id === 'c_uplift' && x.disabled);
    check('ปิดกฎด้วยคำว่า "ปิดไว้" แล้วกฎไม่มีผลกับราคา', ok && price === 11295, `ได้ ${price.toLocaleString()} · คาด 11,295`);
    check('กฎที่ปิดไว้ยังอยู่ในสมุดราคา (เปิดกลับมาใช้ได้)', stillThere === true);
  }

  {
    // ค) เพิ่มกฎใหม่ที่ไม่เคยมีในไฟล์ราคา — ส่วนลด 5% ที่คิดก่อนกฎอื่น
    const g = await readWorkbook(tmp);
    const sheet = g.find((x) => x.name === SHEET_NAMES.adders)!;
    const header = sheet.rows.findIndex((r) => r.map((c) => String(c ?? '')).includes('รหัสกฎ'));
    const cols = sheet.rows[header]!.map((c) => String(c ?? '').trim());
    const newRow: CellValue[] = [];
    const put = (label: string, v: CellValue) => {
      const i = cols.indexOf(label);
      if (i >= 0) newRow[i] = v;
    };
    put('รหัสรุ่น', 'BH-01C');
    put('ลำดับ', 5);
    put('รหัสกฎ', 'promo_q4');
    put('ชื่อที่แสดง', 'ส่วนลดโปรโมชันไตรมาส 4');
    put('วิธีคิด', VOCAB.KIND_TH.percent);
    put('เงื่อนไข', 'ทุกกรณี');
    put('เปอร์เซ็นต์', -5);
    put('เปิดใช้', VOCAB.ON);
    sheet.rows.push(newRow);

    const { book: edited, issues: is2 } = sheetsToBook(g);
    const price = edited ? computePrice(bhCase, edited).unitPrice : -1;
    const err = is2.filter((i) => i.level === 'error');
    // 10,975 − 5% = 10,426.25 → +20% = 12,511.50 → +320 = 12,831.50
    check('เพิ่มกฎใหม่ (ส่วนลด −5%) ในไฟล์แล้วมีผลทันที', price === 12831.5 && err.length === 0, `ได้ ${price.toLocaleString()} · คาด 12,831.5`);
    const added = edited?.models['BH-01C']?.adders.find((x) => x.id === 'promo_q4');
    check('กฎที่เพิ่มเองถูกทำเครื่องหมายว่า "ไม่ได้มาจากไฟล์ราคา"', added?.custom === true);
  }

  {
    // ง) พิมพ์เงื่อนไขผิด — ต้องฟ้องว่าแถวไหน ไม่ใช่ล้มทั้งไฟล์เงียบ ๆ
    const g = await readWorkbook(tmp);
    editCell(g, SHEET_NAMES.adders, (r) => String(r[2] ?? '') === 'c_uplift', 'เงื่อนไข', 'ถ้าลูกค้าใจดี');
    const { book: edited, issues: is3 } = sheetsToBook(g);
    const err = is3.filter((i) => i.level === 'error');
    check(
      'พิมพ์เงื่อนไขผิด → ฟ้องพร้อมเลขแถว และแถวอื่นยังใช้ได้',
      err.length === 1 && err[0]!.row !== undefined && edited !== null,
      err[0] ? `[${err[0].sheet} แถว ${err[0].row}]` : 'ไม่ฟ้องเลย'
    );
  }

  {
    // จ) เพิ่มรหัสย่อยใหม่ในชีต "รหัสย่อย" — ท่าที่แอดมินจะใช้จริงเวลาเจอตัวอักษรที่ระบบไม่รู้จัก
    //
    // ตัวเลข 700 ที่ใช้ที่นี่เป็นค่าสมมติของด่านตรวจ **ไม่ใช่ราคาจริงของ -BU**
    // (ชีตมีคอลัมน์ "หัวกระโหลก Blacklite ใหญ่ +700" อยู่จริง แต่ตัวอย่างการคิดราคาของ
    //  ชีตเองกลับไม่คิดค่านี้ ⇒ ยังเป็นคำถามถึงฝ่ายขาย ห้ามใส่ลงสมุดราคาจริง)
    const g = await readWorkbook(tmp);
    const sheet = g.find((x) => x.name === SHEET_NAMES.subCodes)!;
    const header = sheet.rows.findIndex((r) => r.map((c) => String(c ?? '')).includes('รหัสย่อย'));
    const cols = sheet.rows[header]!.map((c) => String(c ?? '').trim());
    const newRow: CellValue[] = [];
    const put = (label: string, v: CellValue) => {
      const i = cols.indexOf(label);
      if (i >= 0) newRow[i] = v;
    };
    put('รหัสย่อย', 'BU');
    put('แบบจับคู่', VOCAB.MATCH_TH.exact);
    put('ใช้กับรุ่น', 'TS-14');
    put('อ่านว่า', 'หัวกระโหลกใหญ่ (ค่าสมมติของด่านตรวจ)');
    put('ผลกับราคา', VOCAB.EFFECT_TH.flat);
    put('ลำดับ', 60);
    put('จำนวนเงิน', 700);
    put('เปิดใช้', VOCAB.ON);
    sheet.rows.push(newRow);

    const { book: edited, issues: is4 } = sheetsToBook(g);
    const err = is4.filter((i) => i.level === 'error');
    const ts14: ProductConfig = {
      model: 'TS-14',
      axes: { sensor: 'K', dia_group: 'Ø6mm./12.7mm.' },
      dims: { L1: 200, L2: 150 },
      options: ['sub:BU']
    };
    const price = edited ? computePrice(ts14, edited).unitPrice : -1;
    check(
      'เพิ่มรหัสย่อยใหม่ในไฟล์ (-BU +700) แล้วราคาขยับตามทันที',
      price === 5730 && err.length === 0,
      `ได้ ${price.toLocaleString()} · คาด 5,730`
    );
    const added = (edited?.subCodes ?? []).find((s) => s.subCode === 'BU');
    check('รหัสย่อยที่เพิ่มเองถูกทำเครื่องหมายว่า "ไม่ได้มาจากไฟล์ราคา"', added?.custom === true);
  }

  {
    // ฉ) พิมพ์ "ผลกับราคา" ผิด — ต้องฟ้องพร้อมเลขแถว ไม่ใช่เงียบแล้วราคาหาย
    const g = await readWorkbook(tmp);
    const ok = editCell(g, SHEET_NAMES.subCodes, (r) => String(r[0] ?? '') === 'U', 'ผลกับราคา', 'บวกมั่ว ๆ');
    const { book: edited, issues: is5 } = sheetsToBook(g);
    const err = is5.filter((i) => i.level === 'error' && i.sheet === SHEET_NAMES.subCodes);
    check(
      'พิมพ์ "ผลกับราคา" ผิด → ฟ้องพร้อมเลขแถว และสมุดที่เหลือยังใช้ได้',
      ok && err.length === 1 && err[0]!.row !== undefined && edited !== null,
      err[0] ? `[${err[0].sheet} แถว ${err[0].row}]` : 'ไม่ฟ้องเลย'
    );
  }

  // ── 6. ไฟล์สำหรับ Odoo ────────────────────────────────────────────────────
  console.log('');
  const odoo = bookToOdooSheets(book, { exportedAt: '2026-09-17' });
  const odooBytes = writeXlsx(odoo.sheets);
  writeFileSync(tmpOdoo, odooBytes);
  const odooGrids = await readWorkbook(tmpOdoo);
  const productSheet = odooGrids.find((g) => g.name === 'product.template');
  const headerCells = (productSheet?.rows[0] ?? []).map((c) => String(c ?? ''));
  check('ไฟล์ Odoo เปิดด้วย exceljs ได้', odooGrids.length === odoo.sheets.length);
  check(
    'แถวแรกของชีต product.template เป็นชื่อฟิลด์ Odoo (ไม่มีหัวเรื่องมาคั่น)',
    headerCells[0] === 'default_code' && headerCells.includes('list_price'),
    headerCells.slice(0, 4).join(' · ')
  );
  check(`มีรายการสินค้า ${odoo.rowCount} แถว`, (productSheet?.rows.length ?? 0) === odoo.rowCount + 1);

  // ราคาในไฟล์ Odoo ต้องเท่ากับที่ engine คิด ณ สเปกมาตรฐาน — สุ่มเทียบทุกแถวเลยเพราะถูกมาก
  let odooDiff = 0;
  const priceCol = headerCells.indexOf('list_price');
  for (let r = 1; r < (productSheet?.rows.length ?? 0); r++) {
    const v = productSheet!.rows[r]![priceCol];
    if (typeof v !== 'number' || !(v > 0)) odooDiff++;
  }
  check('ทุกแถวมีราคาเป็นตัวเลขมากกว่า 0', odooDiff === 0, odooDiff ? `ผิด ${odooDiff} แถว` : '');
  console.log(`      รุ่นที่คลี่เป็นรายการสินค้าไม่ได้: ${odoo.skipped.length} รายการ (มีเหตุผลกำกับในไฟล์)`);
} finally {
  for (const f of [tmp, tmpOdoo]) {
    try {
      unlinkSync(f);
    } catch {
      /* ไฟล์ชั่วคราว — ลบไม่ได้ก็ไม่เป็นไร */
    }
  }
}

console.log('');
console.log('─'.repeat(70));
console.log(`ผล: ผ่าน ${pass} · ตก ${fail}`);
console.log('─'.repeat(70));
process.exit(fail > 0 ? 1 : 0);
