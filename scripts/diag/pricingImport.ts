// ─────────────────────────────────────────────────────────────────────────────
//  ด่านตรวจของปุ่มนำเข้า/ส่งออกสมุดราคาบนหน้าแอดมิน
//
//  เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md
//
//  **คำถามที่ด่านนี้ตอบ** — ไม่ใช่ "โค้ดรันผ่านไหม" แต่คือคำสัญญาที่เขียนไว้บนหน้าจอ:
//    1. ดาวน์โหลดแม่แบบแล้วอัปกลับทันทีโดยไม่แก้อะไร ⇒ **ต้องไม่มีอะไรเปลี่ยนสักช่อง**
//       (ถ้าข้อนี้ล้ม แปลว่าแค่กดสองปุ่มติดกันราคาก็ขยับแล้ว — ไม่มีใครกล้าใช้ปุ่มอีก)
//    2. **"รุ่นที่ไม่ติ๊ก = คงราคาเดิม"** ต้องจริง ไม่ใช่เขียนทับทั้งเล่ม
//    3. **รุ่นที่ไม่มีในไฟล์ ห้ามหาย** — แม่แบบที่แอดมินถือมาอาจเก่ากว่าสมุดเล่มปัจจุบัน
//    4. ช่องที่ถูกเว้นว่าง = **"หายไป"** ไม่ใช่ราคา 0 และต้องถูกเรียงขึ้นบนสุด
//
//  **ไม่เขียนอะไรเลย** — อ่านเล่มปัจจุบัน (SELECT) มาเป็นตัวตั้ง แล้วทุกข้ออยู่ในหน่วยความจำ
//  ข้อ "เก็บเล่มเก่า · ย้อนกลับได้ · ย้อนแล้วยังย้อนกลับมาได้อีก · token เปลี่ยนหลังบันทึก" ของยุคไฟล์
//  ย้ายไปอยู่ที่ `diag:pricing-db` (scripts/diag/pricingDbRoundtrip.ts) ตั้งแต่สมุดราคาย้ายเข้าฐาน 2026-09-23
//
//  รัน:  npm run diag:pricing-import   (รวมอยู่ใน npm run diag:pricing แล้ว)
// ─────────────────────────────────────────────────────────────────────────────

import { makeTemplate, readUploaded } from '../../services/pricingLab/bookFile.js';
import { applyModels, diffBooks } from '../../services/pricingLab/bookUpdate.js';
import type { PriceBook } from '../../services/pricingLab/types.js';
import { NoBook, loadBookFrom } from '../pricebook/bookSource.js';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail?: string): void => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}${detail ? `  —  ${detail}` : ''}`);
};

const loaded = await loadBookFrom().catch((e: unknown) => {
  if (e instanceof NoBook) { console.error(e.message); process.exit(1); }
  throw e;
});
const real = loaded.book;
const codes = Object.keys(real.models);
console.log(`สมุดราคาที่ใช้: ${loaded.label} · ${codes.length} รุ่น\n`);

// ── 1. ไปกลับแล้วต้องไม่มีอะไรเปลี่ยน ────────────────────────────────────────

const bytes = makeTemplate(real, '2026-09-22');
const { book: back, issues } = await readUploaded(Buffer.from(bytes));

check('อ่านแม่แบบที่เพิ่งสร้างกลับมาได้', back !== null,
  back ? `${Object.keys(back.models).length} รุ่น` : issues.map((i) => i.message).join(' · '));
check('ไม่มีปัญหาระดับ "หยุด" ในไฟล์ที่เราสร้างเอง',
  issues.filter((i) => i.level === 'error').length === 0,
  issues.filter((i) => i.level === 'error').map((i) => i.message).join(' · '));

if (!back) {
  console.log('\nอ่านแม่แบบกลับไม่ได้ ตรวจต่อไม่ได้');
  process.exit(1);
}

const clean = diffBooks(real, back);
check('ส่งออกแล้วอัปกลับทันที = ไม่มีช่องไหนเปลี่ยน',
  clean.summary.changed === 0 && clean.summary.added === 0 && clean.summary.removed === 0,
  `เปลี่ยน ${clean.summary.changed} · เพิ่ม ${clean.summary.added} · หาย ${clean.summary.removed}`);
check('และไม่ใช่เพราะเทียบกับความว่างเปล่า', clean.summary.same > 100, `ช่องที่เท่าเดิม ${clean.summary.same}`);

// ── 2. แก้สองรุ่น แล้วดูว่าส่วนต่างตรงกับที่แก้จริง ──────────────────────────
//
// เลือกรุ่นที่ฐานเป็น matrix สองรุ่นแรก — รุ่น `ref`/`banded` ไม่มีช่องให้แก้แบบเดียวกัน

const matrixCodes = codes.filter((c) => real.models[c]!.base.kind === 'matrix');
const [A, B] = matrixCodes;
if (!A || !B) {
  console.log('\nต้องมีรุ่นที่เป็นตารางอย่างน้อย 2 รุ่นถึงจะตรวจต่อได้');
  process.exit(1);
}

/** สำเนาลึกแบบไม่แชร์ reference — แก้สำเนาแล้วของจริงต้องไม่ขยับ */
const clone = (b: PriceBook): PriceBook => JSON.parse(JSON.stringify(b)) as PriceBook;

const edited = clone(back);
const baseA = edited.models[A]!.base as { kind: 'matrix'; cells: Record<string, number> };
const baseB = edited.models[B]!.base as { kind: 'matrix'; cells: Record<string, number> };
const keyA = Object.keys(baseA.cells)[0]!;
const keyA2 = Object.keys(baseA.cells)[1]!;
const keyB = Object.keys(baseB.cells)[0]!;
const oldA = baseA.cells[keyA]!;
const oldB = baseB.cells[keyB]!;

baseA.cells[keyA] = oldA + 100;   // ราคาขยับ
delete baseA.cells[keyA2];        // เว้นว่าง = ไม่รับผลิต
baseB.cells[keyB] = oldB + 50;    // อีกรุ่นก็ขยับ — แต่จะไม่ติ๊กตอนบันทึก

const d = diffBooks(real, edited);
check('เห็นส่วนต่างครบตามที่แก้', d.summary.changed === 2 && d.summary.removed === 1,
  `เปลี่ยน ${d.summary.changed} · หาย ${d.summary.removed} · เพิ่ม ${d.summary.added}`);
check('ช่องที่เว้นว่างขึ้นเป็น "หายไป" ไม่ใช่ราคา 0',
  d.rows.some((r) => r.model === A && r.what === keyA2 && r.now === null && r.was === oldA && r.was !== 0)
  || d.rows.some((r) => r.model === A && r.what === keyA2 && r.now === null),
  d.rows.filter((r) => r.now === null).map((r) => `${r.model} ${r.what}`).join(' · ') || '(ไม่มี)');
check('แถวที่ "หายไป" ถูกเรียงขึ้นบนสุด', d.rows[0]?.now === null,
  d.rows[0] ? `${d.rows[0].model} ${d.rows[0].what}` : '(ไม่มีแถว)');
check('สรุปรายรุ่นแยกกันถูกต้อง',
  d.models.find((m) => m.model === A)?.changed === 1 && d.models.find((m) => m.model === B)?.changed === 1,
  d.models.filter((m) => m.changed + m.added + m.removed > 0).map((m) => `${m.model}:${m.changed}`).join(' '));

// ── 3. รุ่นที่ไม่มีในไฟล์ ห้ามหาย ────────────────────────────────────────────

const partial = clone(edited);
delete partial.models[B];
const dPartial = diffBooks(real, partial);
check('รุ่นที่ไม่มีในไฟล์ ไม่ถูกนับว่า "หายไป"',
  !dPartial.rows.some((r) => r.model === B) && dPartial.untouched.includes(B),
  `ไฟล์นี้ไม่ได้แตะ ${dPartial.untouched.length} รุ่น`);

const keptAll = applyModels(real, partial, [A], { at: '2026-09-22T00:00:00.000Z' });
check('บันทึกด้วยไฟล์ที่ขาดรุ่นไป แล้วรุ่นนั้นยังอยู่ครบ',
  Object.keys(keptAll.models).length === codes.length && keptAll.models[B] !== undefined);

// ── 4. "รุ่นที่ไม่ติ๊ก = คงราคาเดิม" ─────────────────────────────────────────

const applied = applyModels(real, edited, [A], {
  at: '2026-09-22T00:00:00.000Z', by: 'diag', file: 'แม่แบบราคา-ทดสอบ.xlsx',
});
const cellsA = (applied.models[A]!.base as { cells: Record<string, number> }).cells;
const cellsB = (applied.models[B]!.base as { cells: Record<string, number> }).cells;

check('รุ่นที่ติ๊ก ราคาขยับตามไฟล์', cellsA[keyA] === oldA + 100, `${oldA} → ${cellsA[keyA]}`);
check('รุ่นที่ติ๊ก ช่องที่เว้นว่างหายไปจริง', !(keyA2 in cellsA));
check('**รุ่นที่ไม่ติ๊ก คงราคาเดิม**', cellsB[keyB] === oldB, `${oldB} → ${cellsB[keyB]}`);
check('รุ่นอื่นอยู่ครบไม่หายไปไหน', Object.keys(applied.models).length === codes.length,
  `${Object.keys(applied.models).length} จาก ${codes.length}`);
check('บันทึกแล้วรู้ว่าใครแก้เมื่อไหร่', applied.edited?.by === 'diag' && !!applied.edited?.at,
  JSON.stringify(applied.edited));
check('สมุดเล่มเดิมในหน่วยความจำไม่ถูกแก้',
  (real.models[A]!.base as { cells: Record<string, number> }).cells[keyA] === oldA);

console.log(`\nผ่าน ${pass} · ล้ม ${fail}`);
process.exit(fail ? 1 : 0);
