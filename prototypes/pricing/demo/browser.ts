// ─────────────────────────────────────────────────────────────────────────────
//  PROTOTYPE — ประตูเดียวของหน้าเว็บตัวอย่าง (esbuild มัดไฟล์นี้เป็น window.PR_ENGINE)
//
//  ⚠️ ของทดลอง ไม่มีใครใน production import ไฟล์นี้ · ดู prototypes/pricing/README.md
//
//  ไฟล์นี้ไม่มีตรรกะของตัวเองสักบรรทัด และต้องเป็นแบบนั้นต่อไป — มันมีไว้บอกว่า
//  "หน้าเว็บใช้ของจากไฟล์ไหนได้บ้าง" เท่านั้น · ตรรกะที่เขียนตรงนี้จะกลายเป็นตรรกะที่
//  มีแต่หน้าเว็บที่รัน ด่านตรวจใน Node มองไม่เห็น แล้วสองฝั่งจะคิดเลขไม่ตรงกัน
// ─────────────────────────────────────────────────────────────────────────────

export { computePrice, formatOutcome, resolveModel, matrixKey, evalPredicate } from '../engine.js';
export { parseProductCode, unknownParts, axisValues } from '../code.js';
export { bookToSheets, sheetsToBook, predicateToText, parsePredicate, SHEET_NAMES, VOCAB } from '../sheet.js';
export { bookToOdooSheets } from '../odoo.js';
export { writeXlsx, readXlsxInBrowser } from '../xlsxlite.js';
