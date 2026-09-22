// ─────────────────────────────────────────────────────────────────────────────
//  แม่แบบ .xlsx ของสมุดราคา — ฝั่งที่รันตอนมีคนกดปุ่มบนหน้าจอ
//
//  โมดูล "คิดราคาสินค้า" — ถอดออกได้ทั้งก้อน ดู services/pricingLab/README.md
//
//  **ทำไมไฟล์นี้ถึง import จาก `scripts/pricebook/`** ทั้งที่ปกติทิศทางเป็น scripts → services:
//  ตรรกะ "สมุดราคา ⇄ ตารางในชีต" อยู่ที่ `scripts/pricebook/sheet.ts` มาตั้งแต่ต้น และมันเป็น
//  ตรรกะล้วน (ไม่แตะดิสก์) ที่ `npm run pricebook:xlsx` กับด่าน `diag:pricing` ใช้อยู่แล้ว
//  ⇒ การก๊อปมาไว้ใน services เพื่อให้ทิศทางสวย คือการสร้างสำเนาที่สองของกติกาการอ่านไฟล์ราคา
//  ซึ่งวันหนึ่งจะตอบไม่ตรงกับ CLI แล้วไม่มีใครรู้ว่าฝั่งไหนถูก · ไม่มีวงจรย้อนกลับ:
//  `sheet.ts` → `engine.ts` เท่านั้น และ `engine.ts` ไม่รู้จักไฟล์นี้
//
//  **exceljs ถูก import แบบ dynamic โดยตั้งใจ** — ไฟล์นี้ถูกลากเข้ามาตอน boot ผ่าน
//  `routes/pricingLab.ts` ซึ่งอยู่ในโปรเซสเดียวกับบอทที่ต้องตอบ LINE ภายใน 48 วินาที
//  การ import ไลบรารีอ่าน .xlsx ไว้ตั้งแต่ boot คือค่าที่ทุก request จ่าย ทั้งที่มีคนกดปุ่ม
//  อัปโหลดเดือนละครั้ง ⇒ โหลดตอนมีคนกดจริงเท่านั้น
// ─────────────────────────────────────────────────────────────────────────────

import { bookToSheets, sheetsToBook } from '../../scripts/pricebook/sheet.js';
import type { CellValue, ImportIssue, RawSheet } from '../../scripts/pricebook/sheet.js';
import { writeXlsx } from '../../scripts/pricebook/xlsxlite.js';
import type { PriceBook } from './types.js';

export type { ImportIssue };

/** ชื่อไฟล์ที่แอดมินจะเห็นในโฟลเดอร์ดาวน์โหลด — มีวันที่เพื่อไม่ให้ทับของเดิมเงียบ ๆ */
export function templateFileName(today: string): string {
  return `แม่แบบราคา-${today}.xlsx`;
}

/** สมุดราคาในเครื่อง → ไฟล์ .xlsx ที่แก้แล้วอัปกลับได้ */
export function makeTemplate(book: PriceBook, today: string): Uint8Array {
  return writeXlsx(bookToSheets(book, { exportedAt: today }));
}

/**
 * ค่าที่ Excel คำนวณไว้แล้ว — **ไม่ประเมินสูตรเอง** ด้วยเหตุผลเดียวกับ `importer.ts`:
 * ชีตจริงมีทั้งเซลล์ที่เป็นสูตรและเซลล์ที่พิมพ์เลขทับสูตร ถ้าเราคิดเองจะไม่ตามของที่ถูกพิมพ์ทับ
 *
 * ตรรกะเดียวกับ `scripts/pricebook/xlsx.ts` — ที่นั่นอ่านจาก path (CLI) ที่นี่อ่านจาก buffer
 * เพราะ **ไฟล์ที่อัปผ่านจอต้องไม่ถูกเขียนลงดิสก์**: `data/` กับ `public/` ถูกเสิร์ฟออกเว็บ
 * โดยไม่มีการตรวจสิทธิ์ และไฟล์แม่แบบคือราคาจริงของบริษัททั้งเล่ม
 */
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

/**
 * ไฟล์ที่อัปมา → สมุดราคา + รายการปัญหา
 *
 * **ห้าม throw เมื่อไฟล์อ่านไม่ออก** — คนที่เผลออัป .pdf มาไม่ควรเห็น 500
 * เขาควรเห็นประโยคที่บอกว่าไฟล์ไม่ใช่แม่แบบสมุดราคา ⇒ คืนเป็น issue ระดับ error
 */
export async function readUploaded(
  bytes: Buffer,
): Promise<{ book: PriceBook | null; issues: ImportIssue[] }> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    return {
      book: null,
      issues: [{
        sheet: '(ทั้งไฟล์)',
        level: 'error',
        message: 'เปิดไฟล์ไม่ได้ — ต้องเป็นไฟล์ .xlsx ที่ได้จากปุ่ม "ดาวน์โหลดแม่แบบราคา"',
      }],
    };
  }

  const grids: RawSheet[] = [];
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
    grids.push({ name: ws.name, rows });
  });

  return sheetsToBook(grids);
}
