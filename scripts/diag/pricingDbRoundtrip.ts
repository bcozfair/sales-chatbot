// ─────────────────────────────────────────────────────────────────────────────
//  ด่าน "ชั้นเก็บของสมุดราคาในฐาน" — npm run diag:pricing-db
//
//  เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md · แบบอยู่ที่ docs/plan-pricebook-db.md §8.2
//
//  **คำถามหลัก:** เขียนเล่มลงฐานแล้วอ่านกลับ ได้เล่มเดิม **ทุกไบต์** ไหม — รวมลำดับรุ่น ลำดับคีย์ และ
//  ฟิลด์ระดับเล่ม · ข้อนี้คือเหตุผลที่คอลัมน์เป็น `json` ไม่ใช่ `jsonb`: jsonb สลับลำดับคีย์ แล้วแม่แบบ
//  .xlsx เรียงแถว/คอลัมน์ใหม่ 16 จาก 22 ชีต **โดยที่ด่านชุดเดิมทั้งสี่ตัวผ่านครบ** (วัด 2026-09-23)
//  ⇒ ข้อ 5 เป็นชุดควบคุมกลับด้าน: สำเนาที่ผ่าน jsonb จริงต้อง **ล้ม** ข้อ 1 และ 3 ไม่งั้นด่านนี้ตาบอด
//
//  **ไม่แตะตารางจริง:** BEGIN → สร้างตารางชั่วคราวชื่อเดียวกัน (`LIKE … INCLUDING ALL`) มาบังของจริง
//  (`pg_temp` ถูกค้นก่อน) → ทำทุกข้อผ่าน **ฟังก์ชันเดียวกับที่แอปใช้** โดยส่ง client ของด่านเข้าไป →
//  **ROLLBACK ใน finally เสมอ** · IDENTITY ของตารางชั่วคราวมี sequence ของตัวเอง ⇒ ไม่กินเลขของจริง
//  · ฆ่ากลางคัน = Postgres rollback ให้เอง ⇒ อยู่กลุ่ม "เขียนแล้ว ROLLBACK" ของ AGENTS.md B2 **รันบน PMSV ได้**
//  **ห้ามเปลี่ยน ROLLBACK เป็น COMMIT** · ข้อ 0 หยุดทั้งด่านก่อนเขียนถ้าตารางที่เห็นไม่ใช่ของชั่วคราว
//
//  รัน:  npm run diag:pricing-db                       เล่มปัจจุบันในฐาน (SELECT อย่างเดียว)
//        tsx scripts/diag/pricingDbRoundtrip.ts --data <dir>        เล่มที่สร้างจากไฟล์ Excel ในหน่วยความจำ
//        tsx scripts/diag/pricingDbRoundtrip.ts --from-json <ไฟล์>  เล่มของยุคไฟล์ (ก่อนย้ายเข้าฐาน)
//  ต้องรัน migration 2026-09-23_01 แล้ว (ตารางจริงต้องมีให้ LIKE) — ตารางว่างก็รันได้ถ้าใส่ --data/--from-json
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { pool, type DbExecutor } from '../../config/db.js';
import { makeTemplate, readUploaded } from '../../services/pricingLab/bookFile.js';
import { loadBookState, readBookState, tokenOf } from '../../services/pricingLab/bookStore.js';
import {
  BookConflict, BookRejected, RevisionNotFound,
  applyModels, commitBookChange, listRestorable, parseRestoreName, restoreRevision, seedBook,
  type BookTx,
} from '../../services/pricingLab/bookUpdate.js';
import { parseProductCode } from '../../services/pricingLab/code.js';
import { computePrice } from '../../services/pricingLab/engine.js';
import { applyModelEdit, modelEditorView } from '../../services/pricingLab/modelEditor.js';
import { checkPriceModel } from '../../services/pricingLab/modelShape.js';
import type { PriceBook, PriceModel, ProductConfig } from '../../services/pricingLab/types.js';
import { NoBook, loadBookFrom } from '../pricebook/bookSource.js';
import { bookToSheets } from '../pricebook/sheet.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const TABLES = ['pricing_book_revisions', 'pricing_models', 'pricing_model_history'] as const;

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail?: string): void => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}${detail ? `  —  ${detail}` : ''}`);
};
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`);

const stringify = (b: PriceBook) => JSON.stringify(b, null, 2);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ── เล่มตั้งต้น ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2).map((a) => (a === '--from-json' ? '--book' : a));
const loaded = await loadBookFrom(argv).catch((e: unknown) => {
  if (e instanceof NoBook) { console.error(e.message); process.exit(1); }
  throw e;
});
const src = loaded.book;
const codes = Object.keys(src.models);
console.log(`สมุดราคาที่ใช้: ${loaded.label} · ${codes.length} รุ่น`);

// จำนวนแถวของตารางจริงก่อนเริ่ม — อ่านด้วย pool (อีก connection) ⇒ ข้อ 15 เทียบหลัง ROLLBACK
async function realCounts(): Promise<string> {
  const parts: string[] = [];
  for (const t of TABLES) {
    const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM public.${t}`);
    parts.push(`${t}=${rows[0]!.n}`);
  }
  return parts.join(' ');
}
let before: string;
try {
  before = await realCounts();
} catch (e) {
  if ((e as { code?: string })?.code === '42P01') {
    console.error('ฐานนี้ยังไม่มีตารางสมุดราคา — รัน migration 2026-09-23_01_pricing_book_db.sql ก่อน');
    process.exit(1);
  }
  throw e;
}

// ── รหัสที่ใช้เทียบราคา (ข้อ 4) — อ่านอย่างเดียว ─────────────────────────────

const fixtureCfgs = (JSON.parse(readFileSync(join(HERE, 'fixtures', 'pricingCases.json'), 'utf8')) as { cfg: ProductConfig }[])
  .map((c) => c.cfg);
const { rows: productRows } = await pool.query<{ model: string }>(
  `SELECT DISTINCT model FROM products WHERE model ~ '^(TS|BH)'`,
);
const productCodes = productRows.map((r) => r.model.trim()).filter(Boolean);

/** ผลของทุกรหัส + ทุกเคสในเล่มหนึ่ง — สตริงเดียวที่เทียบกันได้ */
function priceFingerprint(b: PriceBook): { text: string; priced: number } {
  const out: string[] = [];
  let priced = 0;
  for (const cfg of fixtureCfgs) {
    const o = computePrice(cfg, b);
    out.push(`${o.status}:${o.unitPrice}`);
    priced++;
  }
  for (const code of productCodes) {
    const parsed = parseProductCode(code, b);
    if (!parsed.cfg) { out.push('-'); continue; }
    const o = computePrice(parsed.cfg, b);
    out.push(`${o.status}:${o.unitPrice}`);
    priced++;
  }
  return { text: out.join('|'), priced };
}

// ── ข้อ 13 (grep ซอร์ส) ทำก่อนเปิด transaction — ไม่ต้องใช้ฐาน ──────────────

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', '.claude', 'public', 'docs', 'frontend', 'mockup', 'backup', 'data'].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|mjs|js|sql)$/.test(name)) out.push(p);
  }
  return out;
}
// ประกอบคำจากชิ้น ⇒ ไฟล์นี้เองไม่ตรงกับรูปที่มันค้นหา
const VERBS = ['UPD' + 'ATE', 'DEL' + 'ETE\\s+FROM', 'TRUN' + 'CATE'];
const APPEND_ONLY = ['pricing_model_history', 'pricing_book_revisions'];
const forbidden = new RegExp(`\\b(${VERBS.join('|')})\\s+(?:public\\.)?(${APPEND_ONLY.join('|')})\\b`, 'i');
const offenders: string[] = [];
for (const f of sourceFiles(ROOT)) {
  const rel = relative(ROOT, f);
  if (rel.startsWith('migrations')) continue;   // ไฟล์ migration/schema สร้างตาราง ไม่ได้แก้แถว
  const text = readFileSync(f, 'utf8');
  if (forbidden.test(text)) offenders.push(rel);
}

// ── ตารางชั่วคราว + ตัวรัน transaction ของด่าน ─────────────────────────────

const client: pg.PoolClient = await pool.connect();
/** SAVEPOINT บน client ของด่าน — ทำตัวเหมือน withTransaction (ล้ม = ถอยเฉพาะก้อนนั้น) */
let sp = 0;
const tx: BookTx = async (fn) => {
  const name = `pb_${++sp}`;
  await client.query(`SAVEPOINT ${name}`);
  try {
    const r = await fn(client);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return r;
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw e;
  }
};
const db: DbExecutor = client;
const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  (await client.query(sql, params)).rows[0] as T;
const count = async (t: string): Promise<number> => Number((await one<{ n: string }>(`SELECT count(*) AS n FROM ${t}`)).n);

try {
  await client.query('BEGIN');
  for (const t of TABLES) {
    await client.query(`CREATE TEMP TABLE ${t} (LIKE public.${t} INCLUDING ALL) ON COMMIT DROP`);
  }

  section('0. ตารางที่ด่านเห็นต้องเป็นของชั่วคราว');
  // regclass::text ไม่พิมพ์ชื่อ schema ของตารางที่มองเห็นอยู่แล้ว ⇒ ถาม namespace ตรง ๆ (pg_temp_N)
  const where = await one<Record<string, string>>(
    `SELECT ${TABLES.map((t) => `(SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                                    WHERE c.oid = to_regclass('${t}')) AS ${t}`).join(', ')}`,
  );
  const allTemp = TABLES.every((t) => (where[t] ?? '').startsWith('pg_temp'));
  check('ทั้งสามตารางชี้ไปที่ pg_temp', allTemp, TABLES.map((t) => where[t]).join(' · '));
  if (!allTemp) throw new Error('หยุดก่อนเขียน — ตารางที่เห็นไม่ใช่ของชั่วคราว (มีใครใส่ public. ใน SQL ของ repo?)');

  // ── 1–3 เขียนแล้วอ่านกลับ ─────────────────────────────────────────────────
  section('1. เขียนเล่มลงฐาน แล้วอ่านกลับได้เล่มเดิมทุกไบต์');
  const seedRev = await seedBook(src, { by: 'diag' }, tx);
  const back1 = (await readBookState(db))!;
  check('อ่านกลับ = ต้นฉบับทุกไบต์ (ลำดับรุ่น · ลำดับคีย์ · ฟิลด์ระดับเล่ม)', stringify(back1.book) === stringify(src),
    `${stringify(src).length.toLocaleString()} ไบต์ · ${tokenOf(seedRev)}`);
  check('ไม่มีรุ่นไหนถูกข้ามตอนโหลด', back1.skipped.length === 0, back1.skipped.map((s) => s.code).join(' · '));

  section('2. เทียบรายรุ่น');
  const diffModels = codes.filter((c) => JSON.stringify(back1.book.models[c]) !== JSON.stringify(src.models[c]));
  check('ทุกรุ่นเท่าเดิม', diffModels.length === 0, diffModels.join(' · ') || `${codes.length} รุ่น`);
  check('ลำดับรุ่นเท่าเดิม', Object.keys(back1.book.models).join(',') === codes.join(','));

  section('3. แม่แบบ .xlsx จากเล่มที่อ่านกลับ = จากต้นฉบับ');
  const sheetsSrc = JSON.stringify(bookToSheets(src, { exportedAt: '2026-09-23' }));
  check('ทุกชีต ทุกแถว ทุกคอลัมน์เท่ากัน', JSON.stringify(bookToSheets(back1.book, { exportedAt: '2026-09-23' })) === sheetsSrc);

  section('4. ราคาเท่ากันทุกรหัส');
  const fpSrc = priceFingerprint(src);
  const fpBack = priceFingerprint(back1.book);
  check('ตรวจมากกว่า 0 รหัส (ไม่ใช่ผ่านแบบว่างเปล่า)', fpSrc.priced > 0,
    `คิดราคาได้ ${fpSrc.priced.toLocaleString()} จาก ${(fixtureCfgs.length + productCodes.length).toLocaleString()} (เคส ${fixtureCfgs.length} + รหัสจริง ${productCodes.length.toLocaleString()})`);
  check('ผลทุกรหัสเท่ากันทุกบาท', fpSrc.text === fpBack.text);

  section('5. ชุดควบคุมกลับด้าน — สำเนาที่ผ่าน jsonb จริงต้องถูกจับได้');
  const viaJsonb: PriceBook = { ...src, models: {} };
  for (const c of codes) {
    const r = await one<{ j: string }>(`SELECT $1::jsonb::text AS j`, [JSON.stringify(src.models[c])]);
    viaJsonb.models[c] = JSON.parse(r.j) as PriceModel;
  }
  check('ข้อ 1 ล้มกับสำเนา jsonb (ด่านเห็นลำดับคีย์)', stringify(viaJsonb) !== stringify(src));
  check('ข้อ 3 ล้มกับสำเนา jsonb (แม่แบบเรียงใหม่จริง)',
    JSON.stringify(bookToSheets(viaJsonb, { exportedAt: '2026-09-23' })) !== sheetsSrc);
  check('แต่ราคาเท่าเดิม (ตรงกับที่แผนวัดไว้ — ปัญหาอยู่ที่การแสดงผล)', priceFingerprint(viaJsonb).text === fpSrc.text);

  // ── 6 แก้ทีละรุ่น ────────────────────────────────────────────────────────
  section('6. แก้ทีละรุ่น (PUT /model) เขียนแค่แถวเดียว');
  const editCode = codes.find((c) => src.models[c]!.base.kind === 'banded' && src.models[c]!.variant) ?? codes[0]!;
  const m0 = back1.book.models[editCode]!;
  const view = modelEditorView(back1.book, m0);
  const bands = view.base.kind === 'banded' ? view.base.bands.map((b, i) => ({ ...b, price: i === 0 && b.price !== null ? b.price + 10 : b.price })) : undefined;
  const edited = applyModelEdit(m0, {
    adders: view.adders.map((a) => ({ ...a, when: a.when ?? { always: true } })),
    ...(bands ? { bands } : {}),
    ...(view.variant ? { variant: view.variant } : {}),
    constraintsOff: [],
  });
  const histBefore6 = await count('pricing_model_history');
  const rev6 = await commitBookChange({
    parent: seedRev, kind: 'model', changed: [editCode], by: 'diag',
    next: { ...back1.book, models: { ...back1.book.models, [editCode]: edited }, edited: { at: '2026-09-23T01:00:00.000Z', by: 'diag', note: `แก้ราคารุ่น ${editCode} จากหน้าจอ` } },
  }, tx);
  const back6 = (await readBookState(db))!;
  const rev6Row = await one<{ parent_id: string }>(`SELECT parent_id FROM pricing_book_revisions WHERE id = $1`, [rev6]);
  check('การบันทึกใหม่ตั้งต้นจากเล่มก่อนหน้า', Number(rev6Row.parent_id) === seedRev, `r${rev6} ← r${rev6Row.parent_id}`);
  check('ประวัติเพิ่ม 1 แถว', (await count('pricing_model_history')) === histBefore6 + 1);
  check(`รุ่น ${editCode} เปลี่ยนตามที่แก้`, JSON.stringify(back6.book.models[editCode]) === JSON.stringify(edited)
    && JSON.stringify(edited) !== JSON.stringify(m0));
  const others6 = codes.filter((c) => c !== editCode && JSON.stringify(back6.book.models[c]) !== JSON.stringify(src.models[c]));
  check('รุ่นอื่นเท่าเดิมทุกไบต์', others6.length === 0, others6.join(' · '));
  check('version ไม่ขยับ', back6.book.version === src.version, back6.book.version);
  check('token เปลี่ยนหลังบันทึก', back6.token !== back1.token, `${back1.token} → ${back6.token}`);

  // ── 7 กันทับ ─────────────────────────────────────────────────────────────
  section('7. กันสองคนบันทึกทับกัน');
  const rowsBefore7 = await count('pricing_book_revisions');
  let e7a: unknown;
  try { await commitBookChange({ parent: seedRev, kind: 'model', changed: [editCode], next: back1.book }, tx); } catch (e) { e7a = e; }
  check('token เก่า (ตั้งต้นจากเล่มที่มีคนต่อไปแล้ว) → BookConflict', e7a instanceof BookConflict, String(e7a ?? 'ไม่ปฏิเสธ'));
  let e7b: unknown;
  try { await seedBook(src, {}, tx); } catch (e) { e7b = e; }
  check('นำเข้าเล่มแรกซ้ำ → BookConflict', e7b instanceof BookConflict, String(e7b ?? 'ไม่ปฏิเสธ'));
  check('ทั้งสองครั้งไม่มีแถวใหม่', (await count('pricing_book_revisions')) === rowsBefore7);

  // ── 8 อัปแม่แบบ ──────────────────────────────────────────────────────────
  section('8. อัปแม่แบบที่แก้ 1 ช่อง ติ๊กรุ่นเดียว');
  const matrixCodes = codes.filter((c) => src.models[c]!.base.kind === 'matrix');
  const [A, B] = matrixCodes;
  if (!A || !B) throw new Error('ต้องมีรุ่นที่เป็นตารางอย่างน้อย 2 รุ่น');
  const { book: uploaded, issues } = await readUploaded(Buffer.from(makeTemplate(back6.book, '2026-09-23')));
  if (!uploaded) throw new Error(`อ่านแม่แบบกลับไม่ได้: ${issues.map((i) => i.message).join(' · ')}`);
  const incoming = clone(uploaded);
  const cellsA = (incoming.models[A]!.base as { cells: Record<string, number> }).cells;
  const keyA = Object.keys(cellsA)[0]!;
  const oldA = cellsA[keyA]!;
  cellsA[keyA] = oldA + 100;
  const cellsB = (incoming.models[B]!.base as { cells: Record<string, number> }).cells;
  cellsB[Object.keys(cellsB)[0]!]! += 50;           // แก้แต่ไม่ติ๊ก ⇒ ต้องไม่เข้า
  const next8 = applyModels(back6.book, incoming, [A], { at: '2026-09-23T02:00:00.000Z', by: 'diag-8', file: 'แม่แบบ-ทดสอบ.xlsx' });
  const rev8 = await commitBookChange({ parent: rev6, kind: 'import', next: next8, changed: [A], by: 'diag-8' }, tx);
  const back8 = (await readBookState(db))!;
  check(`รุ่น ${A} (ติ๊ก) ราคาขยับ`, (back8.book.models[A]!.base as { cells: Record<string, number> }).cells[keyA] === oldA + 100);
  const others8 = codes.filter((c) => c !== A && JSON.stringify(back8.book.models[c]) !== JSON.stringify(back6.book.models[c]));
  check(`รุ่นที่ไม่ติ๊ก (รวม ${B} ที่แก้ในไฟล์) เท่าเดิมทุกไบต์`, others8.length === 0, others8.join(' · '));
  check('การ์ดรู้ว่าใครอัปไฟล์ไหน', back8.book.edited?.by === 'diag-8' && back8.book.edited?.note === 'แม่แบบ-ทดสอบ.xlsx',
    JSON.stringify(back8.book.edited));
  check('ประวัติของการบันทึกนี้มีแถวเดียว (รุ่นที่ติ๊ก)',
    Number((await one<{ n: string }>(`SELECT count(*) AS n FROM pricing_model_history WHERE revision_id = $1`, [rev8])).n) === 1);

  // ── 9 ย้อน ────────────────────────────────────────────────────────────────
  section('9. ย้อนไปเล่มแรก แล้วย้อนกลับ');
  const shelf = await listRestorable(3, db);
  check('รายการ "ย้อนไปเล่มก่อนหน้า" เรียงใหม่ไปเก่า รูปเดิมของหน้าจอ',
    shelf.length === 2 && shelf[0]!.name === `rev-${rev6}` && shelf[1]!.name === `rev-${seedRev}` && shelf[0]!.models === codes.length,
    shelf.map((s) => `${s.name}@${s.at}:${s.models}`).join(' · '));
  const histBefore9 = await count('pricing_model_history');
  const rev9 = await restoreRevision(seedRev, 'diag-9', tx);
  const back9 = (await readBookState(db))!;
  check('ย้อนแล้ว = เล่มแรกทุกไบต์ (รวม edited ของเล่มนั้น)', stringify(back9.book) === stringify(src));
  check('ประวัติเพิ่ม ไม่ลด', (await count('pricing_model_history')) > histBefore9);
  const rev9Row = await one<{ kind: string; restored_from: string; created_by: string }>(
    `SELECT kind, restored_from, created_by FROM pricing_book_revisions WHERE id = $1`, [rev9]);
  check('แถวหัวบอกว่าย้อนจากไหน ใครกด', rev9Row.kind === 'restore' && Number(rev9Row.restored_from) === seedRev && rev9Row.created_by === 'diag-9',
    JSON.stringify(rev9Row));
  await restoreRevision(rev8, 'diag-9b', tx);
  const back9b = (await readBookState(db))!;
  check('ย้อนกลับอีกครั้ง = ผลของข้อ 8 ทุกไบต์', stringify(back9b.book) === stringify(back8.book));

  // ── 10 ย้อนที่ปฏิเสธ ─────────────────────────────────────────────────────
  section('10. ย้อนไปเล่มที่ไม่มี / หัวเล่มเอง / ชื่อแปลก');
  const rowsBefore10 = await count('pricing_book_revisions');
  const headNow = (await readBookState(db))!.revision;
  let e10a: unknown, e10b: unknown;
  try { await restoreRevision(headNow + 1000, 'diag', tx); } catch (e) { e10a = e; }
  try { await restoreRevision(headNow, 'diag', tx); } catch (e) { e10b = e; }
  check('ไม่มีเล่มนั้น → ปฏิเสธ', e10a instanceof RevisionNotFound, String(e10a ?? 'ไม่ปฏิเสธ'));
  check('ย้อนไปหัวเล่มเอง → ปฏิเสธ', e10b instanceof RevisionNotFound, String(e10b ?? 'ไม่ปฏิเสธ'));
  check('ไม่มีแถวใหม่', (await count('pricing_book_revisions')) === rowsBefore10);
  check('ชื่อที่ไม่ใช่ rev-<เลข> ถูกปฏิเสธ (รวมชื่อไฟล์ของยุคไฟล์)',
    ['book-2026-09-21T10-00-00-000Z.json', '../../../book.json', 'rev-0', 'rev-1x', 'rev-', 'r5'].every((n) => parseRestoreName(n) === null)
    && parseRestoreName('rev-12') === 12);

  // ── 11 รุ่นใหม่แล้วย้อน ───────────────────────────────────────────────────
  section('11. เพิ่มรุ่นใหม่ แล้วย้อน = รุ่นนั้นหาย · ย้อนกลับ = กลับมาที่เดิม');
  const cur11 = (await readBookState(db))!;
  const Z = 'ZZ-DIAG';
  const zModel: PriceModel = { ...clone(src.models[A]!), code: Z, label: 'รุ่นทดสอบของด่าน' };
  const withZ = applyModels(cur11.book, { ...cur11.book, models: { ...cur11.book.models, [Z]: zModel } }, [Z],
    { at: '2026-09-23T03:00:00.000Z', by: 'diag-11' });
  const revZ = await commitBookChange({ parent: cur11.revision, kind: 'import', next: withZ, changed: [Z], by: 'diag-11' }, tx);
  const posZ = Number((await one<{ position: number }>(`SELECT position FROM pricing_models WHERE code = $1`, [Z])).position);
  const maxOther = Number((await one<{ p: number }>(`SELECT max(position) AS p FROM pricing_models WHERE code <> $1`, [Z])).p);
  check('รุ่นใหม่ต่อท้ายเล่ม', posZ === maxOther + 1, `position ${posZ}`);
  check('รุ่นใหม่อยู่ท้ายสุดของเล่มที่อ่านกลับ', Object.keys((await readBookState(db))!.book.models).at(-1) === Z);
  await restoreRevision(cur11.revision, 'diag-11', tx);
  const gone = await one<{ n: string }>(`SELECT count(*) AS n FROM pricing_models WHERE code = $1`, [Z]);
  const tomb = await one<{ spec: unknown; position: number | null } | undefined>(
    `SELECT spec, position FROM pricing_model_history WHERE code = $1 ORDER BY revision_id DESC LIMIT 1`, [Z]);
  check('ย้อนแล้วรุ่นนั้นหายจากเล่มปัจจุบัน', Number(gone.n) === 0);
  check('ประวัติบันทึกว่าถูกเอาออก (spec NULL) ไม่ใช่ลบแถว', tomb?.spec === null && tomb?.position === null);
  await restoreRevision(revZ, 'diag-11b', tx);
  const back11 = await one<{ position: number } | undefined>(`SELECT position FROM pricing_models WHERE code = $1`, [Z]);
  check('ย้อนกลับแล้วรุ่นนั้นกลับมาที่ตำแหน่งเดิม', back11?.position === posZ, `position ${back11?.position}`);

  // ── 12 ด่านรูป ───────────────────────────────────────────────────────────
  section('12. ด่านรูปที่ประตูเก็บ');
  const rejectedReal = codes.filter((c) => checkPriceModel(src.models[c], c).length > 0);
  check('รับทุกรุ่นของเล่มจริงโดยไม่ปฏิเสธผิด', rejectedReal.length === 0,
    rejectedReal.map((c) => `${c}: ${checkPriceModel(src.models[c], c)[0]}`).join(' · ') || `${codes.length} รุ่น`);
  const bad = (mut: (m: Record<string, unknown>) => void) => { const m = clone(src.models[A]!) as unknown as Record<string, unknown>; mut(m); return m; };
  check('code ไม่ตรงคีย์ → ปฏิเสธ', checkPriceModel(bad((m) => { m.code = 'อื่น'; }), A).length > 0);
  check('ตัวเลขไม่ใช่ตัวเลขจริง → ปฏิเสธ', checkPriceModel(bad((m) => {
    const cells = (m.base as { cells: Record<string, unknown> }).cells;
    cells[Object.keys(cells)[0]!] = 'NaN';
  }), A).length > 0);
  check('ชนิดฐานราคาแปลก → ปฏิเสธ', checkPriceModel(bad((m) => { (m.base as { kind: string }).kind = 'wat'; }), A).length > 0);
  check('เงื่อนไขรูปแปลก → ปฏิเสธ', checkPriceModel(bad((m) => {
    (m.adders as unknown[]).push({ id: 'x', label: 'x', order: 1, kind: 'flat', amount: 1, when: { foo: 1 } });
  }), A).length > 0);
  let e12: unknown;
  const head12 = (await readBookState(db))!.revision;
  try {
    await commitBookChange({ parent: head12, kind: 'import', changed: [A],
      next: { ...src, models: { ...src.models, [A]: bad((m) => { (m.base as { kind: string }).kind = 'wat'; }) as unknown as PriceModel } } }, tx);
  } catch (e) { e12 = e; }
  check('บันทึกของที่รูปเสีย → BookRejected ก่อนเขียน', e12 instanceof BookRejected, String(e12 ?? 'ไม่ปฏิเสธ'));
  // แถวเสียที่ใครแก้มือใน psql — ผ่าน CHECK ของตาราง (object + code ตรง) แต่ไม่ใช่ PriceModel
  await client.query(
    `INSERT INTO pricing_models (code, position, spec, revision_id) VALUES ('ZZ-BAD', 999, $1::json, $2)`,
    [JSON.stringify({ code: 'ZZ-BAD', label: 'เสีย', base: { kind: 'wat' } }), head12]);
  await client.query(
    `INSERT INTO pricing_models (code, position, spec, schema_version, revision_id) VALUES ('ZZ-V2', 1000, $1::json, 2, $2)`,
    [JSON.stringify(src.models[A]).replace(`"code":"${A}"`, '"code":"ZZ-V2"'), head12]);
  const st12 = (await readBookState(db))!;
  check('แถวเสียถูกข้ามตอนโหลด ไม่ป้อนเข้า engine', !('ZZ-BAD' in st12.book.models) && st12.skipped.some((s) => s.code === 'ZZ-BAD'),
    st12.skipped.map((s) => `${s.code}: ${s.reasons[0]}`).join(' · '));
  check('โครงสร้างรุ่นใหม่กว่าโค้ด (schema_version 2) ถูกข้าม', !('ZZ-V2' in st12.book.models) && st12.skipped.some((s) => s.code === 'ZZ-V2'));
  check('รุ่นอื่นยังโหลดได้ครบ', codes.every((c) => c in st12.book.models));
  await client.query(`DELETE FROM pricing_models WHERE code IN ('ZZ-BAD', 'ZZ-V2')`);

  // ── 13 เขียนต่อท้ายอย่างเดียว ─────────────────────────────────────────────
  section('13. ไม่มีโค้ดที่แก้/ลบประวัติ');
  check('grep ทั้งรีโป: UPDATE/DELETE/TRUNCATE ของ pricing_model_history · pricing_book_revisions = 0',
    offenders.length === 0, offenders.join(' · ') || 'ไม่พบ');

  // ── 14 cache ─────────────────────────────────────────────────────────────
  section('14. cache เทียบเลขการบันทึกทุกครั้ง');
  const c1 = await loadBookState(db);
  const c2 = await loadBookState(db);
  check('เรียกซ้ำโดยไม่มีการบันทึก = ใช้ของเดิม (ไม่โหลดใหม่)', !!c1 && c1 === c2);
  // จำลอง "อีกโปรเซส" (CLI) บันทึก: เขียนตรงด้วย SQL — ไม่ผ่านโค้ดในโปรเซสนี้เลย
  const ext = await one<{ id: string }>(
    `INSERT INTO pricing_book_revisions (parent_id, kind, version, source, book_subcodes)
     VALUES ($1, 'model', $2, $3, $4::json) RETURNING id`,
    [c1!.revision, c1!.book.version, c1!.book.source, JSON.stringify(c1!.book.subCodes ?? [])]);
  const c3 = await loadBookState(db);
  check('มีการบันทึกจากที่อื่น → โหลดใหม่เอง', !!c3 && c3 !== c1 && c3.revision === Number(ext.id),
    `${c1?.token} → ${c3?.token}`);

} catch (e) {
  fail++;
  console.log(`✗ FAIL  ด่านหยุดกลางทาง: ${e instanceof Error ? e.message : String(e)}`);
  if (e instanceof Error && e.stack) console.log(e.stack.split('\n').slice(1, 4).join('\n'));
} finally {
  await client.query('ROLLBACK');
  client.release();
}

// ── 15 ของจริงไม่ถูกแตะ ─────────────────────────────────────────────────────
section('15. หลัง ROLLBACK ตารางจริงเท่าเดิม');
const after = await realCounts();
check('จำนวนแถวของตารางจริงเท่าก่อนเริ่ม (อ่านด้วยอีก connection)', after === before, after);

await pool.end();
console.log(`\n${'─'.repeat(70)}\nผล: ผ่าน ${pass} · ตก ${fail}\n${'─'.repeat(70)}`);
process.exit(fail ? 1 : 0);
