// ─────────────────────────────────────────────────────────────────────────────
//  PROTOTYPE — คำสั่งบรรทัดคำสั่งสำหรับแม่แบบ .xlsx
//
//  ⚠️ ของทดลอง ไม่มีใครใน production import ไฟล์นี้ · ดู prototypes/pricing/README.md
//
//    npx tsx prototypes/pricing/xlsx.ts export [--out ไฟล์.xlsx]   แม่แบบกฎราคา (แก้แล้วนำกลับได้)
//    npx tsx prototypes/pricing/xlsx.ts odoo   [--out ไฟล์.xlsx]   ตารางราคาสำหรับนำเข้า Odoo
//    npx tsx prototypes/pricing/xlsx.ts import <ไฟล์.xlsx> [--save]
//
//  **เขียนด้วย xlsxlite (เขียนเอง) แต่อ่านด้วย exceljs (ไลบรารีจริง) โดยตั้งใจ**
//  ถ้าใช้ตัวเดียวกันทั้งอ่านและเขียน ความผิดพลาดที่สมมาตรจะมองไม่เห็น — เขียนผิดแบบไหน
//  ก็อ่านกลับได้แบบนั้น · การให้ไลบรารีคนละตัวเป็นคนอ่าน คือด่านที่พิสูจน์ว่าไฟล์ที่เราปั้น
//  "เป็น .xlsx จริง" ไม่ใช่แค่ "ไฟล์ที่เราเองอ่านออก" — ซึ่งเป็นคำถามเดียวที่สำคัญ
//  เพราะปลายทางคือ Excel ของแอดมิน ไม่ใช่โค้ดนี้
// ─────────────────────────────────────────────────────────────────────────────

import ExcelJS from 'exceljs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bookToOdooSheets } from './odoo.js';
import { bookToSheets, sheetsToBook } from './sheet.js';
import type { CellValue, ImportIssue, RawSheet } from './sheet.js';
import type { PriceBook } from './types.js';
import { writeXlsx } from './xlsxlite.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadBook(): PriceBook {
  return JSON.parse(readFileSync(join(HERE, 'book.json'), 'utf8')) as PriceBook;
}

// ── อ่านไฟล์ที่คนแก้กลับมา ───────────────────────────────────────────────────

/** ค่าที่ Excel คำนวณไว้แล้ว — เหตุผลเดียวกับ importer.ts: ไม่ประเมินสูตรเอง */
function cellValue(raw: unknown): CellValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'boolean') return raw ? 'TRUE' : 'FALSE';
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if ('result' in o) return cellValue(o.result);
    if ('richText' in o) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if ('text' in o) return String(o.text);
    if ('hyperlink' in o) return String(o.text ?? o.hyperlink);
  }
  return String(raw);
}

export async function readWorkbook(path: string): Promise<RawSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const out: RawSheet[] = [];
  wb.eachSheet((ws) => {
    const rows: CellValue[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: CellValue[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cells[colNumber - 1] = cellValue(cell.value);
      });
      rows[rowNumber - 1] = cells;
    });
    for (let i = 0; i < rows.length; i++) rows[i] = rows[i] ?? [];
    out.push({ name: ws.name, rows });
  });
  return out;
}

export function printIssues(issues: ImportIssue[]): void {
  if (issues.length === 0) {
    console.log('  ไม่มีปัญหา');
    return;
  }
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  for (const i of [...errors, ...warns]) {
    const where = i.row ? `${i.sheet} แถว ${i.row}` : i.sheet;
    console.log(`  ${i.level === 'error' ? '✗' : '!'} [${where}] ${i.message}`);
  }
  console.log(`  รวม: ต้องแก้ ${errors.length} · เตือน ${warns.length}`);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const outIdx = args.indexOf('--out');
  const today = new Date().toISOString().slice(0, 10);

  if (cmd === 'export') {
    const book = loadBook();
    const out = outIdx > -1 ? resolve(args[outIdx + 1]!) : join(HERE, `แม่แบบกฎราคา ${today}.xlsx`);
    const bytes = writeXlsx(bookToSheets(book, { exportedAt: today }));
    writeFileSync(out, bytes);
    console.log(`แม่แบบกฎราคา → ${out}  (${(bytes.length / 1024).toFixed(0)} KB)`);
    console.log('แก้ในไฟล์นี้แล้วนำกลับด้วย:  npx tsx prototypes/pricing/xlsx.ts import "<ไฟล์>"');
    return;
  }

  if (cmd === 'odoo') {
    const book = loadBook();
    const r = bookToOdooSheets(book, { exportedAt: today });
    const out = outIdx > -1 ? resolve(args[outIdx + 1]!) : join(HERE, `ตารางราคา Odoo ${today}.xlsx`);
    const bytes = writeXlsx(r.sheets);
    writeFileSync(out, bytes);
    console.log(`ตารางราคาสำหรับ Odoo → ${out}  (${(bytes.length / 1024).toFixed(0)} KB)`);
    console.log(`  ออกได้ ${r.rowCount} รายการ · ออกไม่ได้ ${r.skipped.length} รายการ (มีเหตุผลกำกับในไฟล์)`);
    return;
  }

  if (cmd === 'import') {
    const path = args[1];
    if (!path) {
      console.error('ต้องบอกชื่อไฟล์:  npx tsx prototypes/pricing/xlsx.ts import "<ไฟล์.xlsx>"');
      process.exit(1);
    }
    const grids = await readWorkbook(resolve(path));
    console.log(`อ่าน ${grids.length} ชีต: ${grids.map((g) => g.name).join(' · ')}`);
    const { book, issues } = sheetsToBook(grids);
    printIssues(issues);
    if (!book) {
      console.error('นำเข้าไม่สำเร็จ');
      process.exit(1);
    }
    const models = Object.values(book.models);
    console.log('');
    console.log(`รุ่น ${models.length} รุ่น`);
    for (const m of models) {
      const base =
        m.base.kind === 'matrix'
          ? `ตาราง ${Object.keys(m.base.cells).length} ช่อง`
          : m.base.kind === 'banded'
            ? `${m.base.bands.length} ช่วง`
            : `ใช้ฐานของ ${m.base.model}`;
      console.log(`  ${m.code.padEnd(8)} ${base.padEnd(18)} กฎบวกเพิ่ม ${m.adders.length} · ข้อห้าม ${m.constraints.length}`);
    }
    if (args.includes('--save')) {
      writeFileSync(join(HERE, 'book.json'), JSON.stringify(book, null, 2), 'utf8');
      console.log('\nบันทึกทับ book.json แล้ว — รัน golden.ts ต่อเพื่อดูว่าราคาที่เคยถูกยังถูกอยู่ไหม');
    } else {
      console.log('\n(ยังไม่ได้บันทึกทับ book.json — ใส่ --save ถ้าต้องการ)');
    }
    return;
  }

  console.log('คำสั่ง:');
  console.log('  npx tsx prototypes/pricing/xlsx.ts export [--out ไฟล์.xlsx]   แม่แบบกฎราคา');
  console.log('  npx tsx prototypes/pricing/xlsx.ts odoo   [--out ไฟล์.xlsx]   ตารางราคาสำหรับ Odoo');
  console.log('  npx tsx prototypes/pricing/xlsx.ts import <ไฟล์.xlsx> [--save]');
  process.exit(1);
}

// รันเป็นสคริปต์เท่านั้น — ไฟล์นี้ถูก import โดย roundtrip.ts ด้วย
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
