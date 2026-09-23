// ─────────────────────────────────────────────────────────────────────────────
//  คำสั่งบรรทัดคำสั่งสำหรับแม่แบบ .xlsx
//
//  เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md
//
//    npm run pricebook:xlsx -- export [--out ไฟล์.xlsx]   แม่แบบกฎราคา (แก้แล้วนำกลับได้)
//    npm run pricebook:xlsx -- odoo   [--out ไฟล์.xlsx]   ตารางราคาสำหรับนำเข้า Odoo
//    npm run pricebook:xlsx -- import <ไฟล์.xlsx>          ตรวจไฟล์อย่างเดียว ไม่เขียนอะไร
//  เล่มที่ใช้ = เล่มปัจจุบันในฐาน · `--book <ไฟล์.json>` / `--data <dir>` ใช้แทนได้ (ดู bookSource.ts)
//
//  **`import --save` ถูกถอดแล้ว** (เจ้าของเคาะ 2026-09-23 · แผน §12 ข้อ 11) — มันเขียนทับ **ทั้งเล่ม**
//  (ลบรุ่นที่ไม่มีในไฟล์ ขัดกับกติกาข้อ 2 ของหน้าจอ) และไม่มีประวัติให้ย้อน ⇒ ทางเขียนเหลือสองทาง:
//  ปุ่มอัปโหลดบนหน้าจอ (รวมรายรุ่น) กับ `importer.ts --apply` (เล่มแรก/แทนทั้งเล่มแบบย้อนได้)
//  **ไฟล์ปลายทางตั้งต้นที่โฟลเดอร์ชั่วคราวของเครื่อง** ไม่ใช่ `scripts/pricebook/` ซึ่ง git ไม่ได้ ignore
//  ⇒ ไฟล์ราคาทั้งเล่มจะไม่เผลอติด commit ไปขึ้นรีโป
//  **เขียนด้วย xlsxlite (เขียนเอง) แต่อ่านด้วย exceljs (ไลบรารีจริง) โดยตั้งใจ**
//  ถ้าใช้ตัวเดียวกันทั้งอ่านและเขียน ความผิดพลาดที่สมมาตรจะมองไม่เห็น — เขียนผิดแบบไหน
//  ก็อ่านกลับได้แบบนั้น · การให้ไลบรารีคนละตัวเป็นคนอ่าน คือด่านที่พิสูจน์ว่าไฟล์ที่เราปั้น
//  "เป็น .xlsx จริง" ไม่ใช่แค่ "ไฟล์ที่เราเองอ่านออก" — ซึ่งเป็นคำถามเดียวที่สำคัญ
//  เพราะปลายทางคือ Excel ของแอดมิน ไม่ใช่โค้ดนี้
// ─────────────────────────────────────────────────────────────────────────────

import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../../config/db.js';
import { bookToOdooSheets } from './odoo.js';
import { bookToSheets, sheetsToBook } from './sheet.js';
import type { CellValue, ImportIssue, RawSheet } from './sheet.js';
import { NoBook, loadBookFrom } from './bookSource.js';
import { writeXlsx } from './xlsxlite.js';

/** เล่มที่จะส่งออก + บอกว่าเป็นเล่มไหน (ด่าน/CLI ทุกตัวพิมพ์บรรทัดนี้) */
async function pickBook(args: string[]) {
  const loaded = await loadBookFrom(args);
  console.log(`สมุดราคาที่ใช้: ${loaded.label}`);
  return loaded.book;
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
    const book = await pickBook(args);
    const out = outIdx > -1 ? resolve(args[outIdx + 1]!) : join(tmpdir(), `แม่แบบกฎราคา ${today}.xlsx`);
    const bytes = writeXlsx(bookToSheets(book, { exportedAt: today }));
    writeFileSync(out, bytes);
    console.log(`แม่แบบกฎราคา → ${out}  (${(bytes.length / 1024).toFixed(0)} KB)`);
    console.log('แก้ในไฟล์นี้แล้วนำกลับผ่านปุ่ม "อัปโหลดราคาใหม่" บนหน้าจอ · ตรวจไฟล์ก่อนได้ด้วย  npm run pricebook:xlsx -- import "<ไฟล์>"');
    return;
  }

  if (cmd === 'odoo') {
    const book = await pickBook(args);
    const r = bookToOdooSheets(book, { exportedAt: today });
    const out = outIdx > -1 ? resolve(args[outIdx + 1]!) : join(tmpdir(), `ตารางราคา Odoo ${today}.xlsx`);
    const bytes = writeXlsx(r.sheets);
    writeFileSync(out, bytes);
    console.log(`ตารางราคาสำหรับ Odoo → ${out}  (${(bytes.length / 1024).toFixed(0)} KB)`);
    console.log(`  ออกได้ ${r.rowCount} รายการ · ออกไม่ได้ ${r.skipped.length} รายการ (มีเหตุผลกำกับในไฟล์)`);
    return;
  }

  if (cmd === 'import') {
    const path = args[1];
    if (!path) {
      console.error('ต้องบอกชื่อไฟล์:  npm run pricebook:xlsx -- import "<ไฟล์.xlsx>"');
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
      console.log('\n--save ถูกถอดแล้ว — บันทึกผ่านปุ่ม "อัปโหลดราคาใหม่" บนหน้าจอ (เลือกรุ่นได้ · ย้อนได้)');
      process.exitCode = 1;
    } else {
      console.log('\n(ตรวจอย่างเดียว — บันทึกผ่านปุ่ม "อัปโหลดราคาใหม่" บนหน้าจอ)');
    }
    return;
  }

  console.log('คำสั่ง:');
  console.log('  npm run pricebook:xlsx -- export [--out ไฟล์.xlsx]   แม่แบบกฎราคา');
  console.log('  npm run pricebook:xlsx -- odoo   [--out ไฟล์.xlsx]   ตารางราคาสำหรับ Odoo');
  console.log('  npm run pricebook:xlsx -- import <ไฟล์.xlsx>          ตรวจไฟล์อย่างเดียว');
  process.exit(1);
}

// รันเป็นสคริปต์เท่านั้น — ไฟล์นี้ถูก import โดย roundtrip.ts ด้วย
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    await main();
  } catch (e) {
    if (!(e instanceof NoBook)) throw e;
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
