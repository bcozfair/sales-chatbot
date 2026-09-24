// ─────────────────────────────────────────────────────────────────────────────
//  เทียบสมุดราคาสองเล่ม · รวมเฉพาะรุ่นที่แอดมินติ๊ก · บันทึกลงฐาน · ย้อนเล่ม
//
//  โมดูล "คิดราคาสินค้า" — ถอดออกได้ทั้งก้อน ดู services/pricingLab/README.md
//
//  เจ้าของเคาะ 2026-09-21 (จาก mockup ชุด pb-*):
//    · **ไฟล์ที่อัปผ่านจอเป็นตัวจริง** — Excel ใน `data/` กลายเป็นเอกสารอ้างอิง ไม่ใช่ทางเข้าของระบบ
//    · **เลือกได้ว่าจะบันทึกรุ่นไหนบ้าง** — รุ่นที่ไม่ติ๊ก "คงราคาเดิม" ไม่ใช่ถูกลบ
//    · **เก็บเล่มเก่าไว้ 3 เล่ม** — อัปผิดแล้วต้องย้อนได้จากหน้าจอ ไม่ต้อง ssh ไปรัน CLI
//      (ตั้งแต่ 2026-09-23 ประวัติอยู่ในฐานครบทุกครั้ง · จอยังโชว์ 3 เล่มล่าสุดเหมือนเดิม — แผน §12 ข้อ 2)
//    · ช่องที่เว้นว่างในไฟล์ = **ไม่รับผลิต** ไม่ใช่ราคา 0 (กติกาเดิมของทั้งโมดูล)
//
//  ⚠️ **สามข้อที่ห้ามทำให้ง่ายกว่านี้**
//   1. **บันทึก = รวมรายรุ่น ไม่ใช่เขียนทับทั้งไฟล์** — จอเขียนไว้ว่ารุ่นที่ไม่ติ๊กคงราคาเดิม
//      ถ้าเขียนทับทั้งเล่ม รุ่นที่ไม่ติ๊กจะหายไปทั้งรุ่นโดยที่หน้าจอเพิ่งสัญญาตรงกันข้าม
//   2. **รุ่นที่ไม่มีในไฟล์ ห้ามลบ** — ไฟล์แม่แบบที่แอดมินถือมาอาจเก่ากว่าสมุดเล่มปัจจุบัน
//      (ดาวน์โหลดไว้เมื่อวาน วันนี้มีคนอัปรุ่นใหม่เข้าไป) การตีความว่า "ไม่มีในไฟล์ = ให้ลบ"
//      จะลบงานของคนอื่นทิ้งด้วยไฟล์ที่ไม่ได้ตั้งใจจะแตะรุ่นนั้นเลย
//   3. **`subCodes` ไม่รับจากไฟล์** — ตารางรหัสย่อยมีเจ้าของคือฐานข้อมูล (แอดมินแก้ผ่านหน้าจอ)
//      และ `withSubCodes()` ให้ของในฐานชนะอยู่แล้ว ⇒ รับจากไฟล์ = เพิ่มทางที่สองให้ค่าเดียวกัน
// ─────────────────────────────────────────────────────────────────────────────

import { withTransaction, type DbExecutor } from '../../config/db.js';
import {
  countModelsAt, deleteModel, headRevisionId, insertHistory, insertRevision, listRevisionsBefore,
  readModels, readModelsAt, readRevision, upsertModel,
  type RevisionKind, type SourceFile,
} from '../../db/pricingBookRepo.js';
import { checkPriceModel } from './modelShape.js';
import type { Money, PriceBook, PriceModel } from './types.js';

/**
 * จำนวนเล่มก่อนหน้าที่ **แสดงบนจอ** ให้กดย้อน — เจ้าของเคาะ 3 (2026-09-21)
 * ตั้งแต่ย้ายเข้าฐาน (2026-09-23) ประวัติเก็บทุกครั้งตลอดไป เลขนี้เป็นแค่ความยาวของรายการบนจอ
 */
export const KEEP_BACKUPS = 3;

// ── ส่วนต่างของราคา ─────────────────────────────────────────────────────────

/**
 * หนึ่งแถวของตาราง "ตรวจก่อนบันทึก"
 *
 * `was`/`now` เป็น `null` ได้คนละความหมายและห้ามยุบรวมกับ 0:
 *   `was === null` = ช่องนี้เพิ่งมีราคาครั้งแรก · `now === null` = **ไม่รับผลิตแล้ว**
 * ราคา 0 คือ "ขายฟรี" ซึ่งไม่เคยเป็นสิ่งที่ชีตตั้งใจจะบอก
 */
export interface BookDiffRow {
  model: string;
  /** ชื่อช่องที่คนอ่านรู้เรื่อง เช่น `6 | 1/2" | TSPA` หรือ `กฎ: ความยาวแกน L1 · 6` */
  what: string;
  kind: 'cell' | 'band' | 'adder' | 'rate';
  was: Money | null;
  now: Money | null;
}

export interface BookDiffModel {
  model: string;
  label: string;
  changed: number;
  added: number;
  removed: number;
}

export interface BookDiff {
  summary: { changed: number; added: number; removed: number; same: number };
  models: BookDiffModel[];
  /** ทุกแถวที่ไม่เท่าเดิม — เรียงให้ "หายไป" ขึ้นก่อนเสมอ (ดู `sortRows`) */
  rows: BookDiffRow[];
  /** รุ่นที่มีในสมุดเล่มปัจจุบันแต่ไม่มีในไฟล์ ⇒ ไฟล์นี้ไม่ได้แตะมันเลย */
  untouched: string[];
}

/** ทุกตัวเลขของรุ่นหนึ่ง แบน ๆ เป็น `ชื่อช่อง → ราคา` — ด้านเดียวของการเทียบ */
function flatten(m: PriceModel): Map<string, { kind: BookDiffRow['kind']; value: Money }> {
  const out = new Map<string, { kind: BookDiffRow['kind']; value: Money }>();

  if (m.base.kind === 'matrix') {
    for (const [k, v] of Object.entries(m.base.cells)) out.set(k, { kind: 'cell', value: v });
  } else if (m.base.kind === 'banded') {
    for (const b of m.base.bands) {
      const name = b.label ?? `${b.min}–${b.max ?? '∞'}`;
      if (b.flat !== undefined) out.set(`ช่วง ${name}`, { kind: 'band', value: b.flat });
      if (b.rate !== undefined) out.set(`ช่วง ${name} (ต่อหน่วย)`, { kind: 'band', value: b.rate });
    }
  }

  for (const a of m.adders) {
    // ป้ายชื่อกฎมาก่อน id เพราะแอดมินอ่านชื่อไทยในไฟล์ ไม่ได้อ่าน id — แต่ id ต่อท้ายไว้
    // เพราะสองกฎตั้งชื่อซ้ำกันได้ และถ้าซ้ำแล้วยุบเป็นแถวเดียว ส่วนต่างจะหายไปหนึ่งรายการเงียบ ๆ
    const head = `กฎ: ${a.label} [${a.id}]`;
    if (a.amount !== undefined) out.set(head, { kind: 'adder', value: a.amount });
    if (a.percent !== undefined) out.set(`${head} (%)`, { kind: 'adder', value: a.percent });
    for (const [k, v] of Object.entries(a.rates ?? {})) out.set(`${head} · ${k}`, { kind: 'rate', value: v });
  }

  return out;
}

/**
 * "หายไปก่อน แล้วเพิ่มใหม่ แล้วค่อยราคาที่ขยับ" — ไม่ใช่ลำดับตามชีต
 *
 * ช่องที่หายไปคือช่องที่รหัสนั้นจะคิดราคาไม่ได้อีกเลย ถ้าไปอยู่ท้ายตารางที่ต้องเลื่อนหา
 * คนกดยืนยันจะไม่เคยเห็นมัน (เคาะจาก mockup 2026-09-21)
 */
function sortRows(rows: BookDiffRow[]): BookDiffRow[] {
  const rank = (d: BookDiffRow) => (d.now === null ? 0 : d.was === null ? 1 : 2);
  return rows.slice().sort((a, b) => rank(a) - rank(b) || a.model.localeCompare(b.model));
}

/**
 * เทียบสมุดสองเล่ม **เฉพาะรุ่นที่มีในไฟล์ใหม่**
 *
 * รุ่นที่มีเฉพาะในเล่มปัจจุบันไม่ถูกนับเป็น "หายไป" — มันแค่ไม่ได้อยู่ในไฟล์นี้ (ข้อ 2 ที่หัวไฟล์)
 * และชื่อมันถูกส่งกลับไปที่ `untouched` เพื่อให้หน้าจอบอกได้ว่าไฟล์นี้ไม่ได้แตะรุ่นไหนบ้าง
 */
export function diffBooks(current: PriceBook, incoming: PriceBook): BookDiff {
  const rows: BookDiffRow[] = [];
  const models: BookDiffModel[] = [];
  let same = 0;

  for (const [code, next] of Object.entries(incoming.models)) {
    const cur = current.models[code];
    const before = cur ? flatten(cur) : new Map<string, { kind: BookDiffRow['kind']; value: Money }>();
    const after = flatten(next);
    const stat: BookDiffModel = { model: code, label: next.label, changed: 0, added: 0, removed: 0 };

    for (const [what, a] of after) {
      const b = before.get(what);
      if (!b) { rows.push({ model: code, what, kind: a.kind, was: null, now: a.value }); stat.added++; }
      else if (b.value !== a.value) { rows.push({ model: code, what, kind: a.kind, was: b.value, now: a.value }); stat.changed++; }
      else same++;
    }
    for (const [what, b] of before) {
      if (!after.has(what)) { rows.push({ model: code, what, kind: b.kind, was: b.value, now: null }); stat.removed++; }
    }

    models.push(stat);
  }

  const untouched = Object.keys(current.models).filter((c) => !(c in incoming.models));

  return {
    summary: {
      changed: models.reduce((n, m) => n + m.changed, 0),
      added: models.reduce((n, m) => n + m.added, 0),
      removed: models.reduce((n, m) => n + m.removed, 0),
      same,
    },
    models,
    rows: sortRows(rows),
    untouched,
  };
}

// ── บันทึก ──────────────────────────────────────────────────────────────────

/**
 * รวมเฉพาะรุ่นที่ติ๊ก — ของเดิมทุกอย่างที่ไม่ได้ถูกติ๊กยังอยู่ครบ
 *
 * `version` ขยับเป็นวันที่บันทึก และ `edited` บันทึกว่าใครอัปจากไฟล์ไหน เพราะคำถามแรก
 * เวลาราคาไม่ตรงกับที่ฝ่ายขายคิดคือ "ใครแก้ เมื่อไหร่" (ช่องนี้มีอยู่ใน `PriceBook` แล้ว)
 * ส่วน `source` ไม่แตะ — มันคือชื่อไฟล์ Excel ต้นทางของตารางราคา ไม่ใช่ของไฟล์ที่เพิ่งอัป
 */
export function applyModels(
  current: PriceBook,
  incoming: PriceBook,
  picked: string[],
  meta: { at: string; by?: string; file?: string },
): PriceBook {
  const models: Record<string, PriceModel> = { ...current.models };
  for (const code of picked) {
    const next = incoming.models[code];
    if (!next) continue;
    // หน้าตาของชีต (`layout` — แสดงผลอย่างเดียว) ที่ไฟล์ไม่ได้ส่งมา = แม่แบบรุ่นก่อน 2026-09-24 ที่ยังไม่มีชีต
    // "หน้าตาในไฟล์ราคา" ⇒ คงของเดิมไว้ ไม่ใช่ลบทิ้งเงียบ ๆ (ลบได้จากหน้าสมุดรายชีต)
    const keep = !next.layout && current.models[code]?.layout;
    models[code] = keep ? { ...next, layout: current.models[code]!.layout } : next;
  }
  return {
    ...current,
    version: meta.at.slice(0, 10),
    models,
    edited: { at: meta.at, by: meta.by, note: meta.file },
  };
}


// ── บันทึกลงฐาน ─────────────────────────────────────────────────────────────
//
// ทุกทางเขียน (แก้ทีละรุ่น · อัปแม่แบบ · CLI นำเข้าเล่มแรก · ย้อน) ผ่านสองฟังก์ชันข้างล่างนี้เท่านั้น
// **CLI ห้ามยิง SQL เอง** — ก๊อปเมื่อไหร่ วันหนึ่งเล่มที่เข้าทาง CLI จะไม่มีประวัติหรือข้ามด่านกันทับไป
//
// การบันทึกหนึ่งครั้ง = transaction เดียว: แถวหัว (`pricing_book_revisions`) → รุ่นที่แตะ
// (`pricing_models`) → ประวัติของรุ่นที่แตะ (`pricing_model_history`) · ล้มตรงไหนก็ ROLLBACK ทั้งก้อน
// ⇒ ไม่มีสถานะ "มีเล่มสำรองแต่ไม่มีเล่มปัจจุบัน" แบบ `saveBook()` ของยุคไฟล์
//
// **กันสองคนบันทึกทับกัน — ให้ฐานเป็นคนตัดสิน:** แถวหัวเก็บ `parent_id` = เล่มที่ผู้บันทึกตั้งต้นจาก และมี
// UNIQUE NULLS NOT DISTINCT บนคอลัมน์นั้น ⇒ ต่อได้เฉพาะจากหัวเล่ม คนที่สองที่ถือเล่มเดียวกันโดน 23505
// (รวมถึงกรณีที่ตรวจเร็วผ่านแล้วมีคนแทรกก่อน INSERT — ช่องโหว่แบบเดียวกับ `:223→:244` ของยุคไฟล์)
// **ทางที่ไม่ได้เลือก:** `updated_at` เป็น token (JS ละเอียด ms · PG ละเอียด µs) · advisory lock
// (logworker ใช้ key ของตัวเองอยู่แล้ว และ constraint อธิบายตัวเองได้)

/** มีคนบันทึกจากเล่มเดียวกันไปก่อนแล้ว — route ตอบ 409 ด้วยข้อความเดิมของยุคไฟล์ */
export class BookConflict extends Error {
  constructor() {
    super('สมุดราคาเพิ่งถูกบันทึกโดยคนอื่น');
    this.name = 'BookConflict';
  }
}

/** ของที่จะบันทึกไม่ผ่านด่านรูป (`checkPriceModel`) — ไม่มีอะไรถูกเขียน */
export class BookRejected extends Error {
  constructor(readonly problems: string[]) {
    super(`สมุดราคาเล่มนี้บันทึกไม่ได้: ${problems.slice(0, 3).join(' · ')}`);
    this.name = 'BookRejected';
  }
}

/** เล่มที่ขอย้อนไปไม่มีแล้ว หรือเป็นหัวเล่มเอง — ไม่มีอะไรถูกเขียน */
export class RevisionNotFound extends Error {
  constructor() {
    super('ไม่พบเล่มนี้');
    this.name = 'RevisionNotFound';
  }
}

/**
 * unique violation ของ `parent_id` — ดูชื่อตาราง + คำว่า parent แทนการเทียบชื่อ constraint ตรงตัว
 * เพราะตารางเงาของด่าน (`LIKE … INCLUDING ALL`) ได้ชื่อ constraint ใหม่ (`…_parent_id_key`)
 * ตารางนี้มี unique สองตัว: PK ที่เป็น IDENTITY (ชนไม่ได้) กับตัวนี้ ⇒ ไม่มีทางแปลผิดตัว
 */
function isParentConflict(e: unknown): boolean {
  const pg = e as { code?: string; table?: string; constraint?: string } | null;
  return pg?.code === '23505' && pg.table === 'pricing_book_revisions' && /parent/.test(pg.constraint ?? '');
}

/**
 * ตัวรัน transaction — ค่าเริ่มต้นคือ `withTransaction` ของทั้งระบบ
 * ด่าน `diag:pricing-db` ส่งตัวที่ใช้ SAVEPOINT บน client ของมันเองเข้ามา (ตารางชั่วคราว + ROLLBACK ท้ายรอบ)
 * ⚠️ ข้างใน fn ห้าม `pool.query` / `loadBookState()` — ใช้ `db` ที่ส่งมาเท่านั้น (กฎของ withTransaction)
 */
export type BookTx = <T>(fn: (db: DbExecutor) => Promise<T>) => Promise<T>;

const defaultTx: BookTx = (fn) => withTransaction((client) => fn(client));

export interface BookChange {
  /** เลขการบันทึกที่ผู้บันทึกตั้งต้นจาก — `null` ได้เฉพาะเล่มแรก (`kind: 'seed'`) */
  parent: number | null;
  kind: Exclude<RevisionKind, 'restore'>;
  /** เล่มหลังการบันทึก — ฟิลด์ระดับเล่ม (`version/source/subCodes/edited`) มาจากตัวนี้ทั้งหมด */
  next: PriceBook;
  /** รุ่นที่เขียน — ต้องมีอยู่ใน `next.models` · รุ่นอื่นไม่ถูกแตะสักไบต์ */
  changed: string[];
  /**
   * true = เล่มปลายทางคือ `next` ทั้งเล่ม: รุ่นที่ไม่มีใน `next` ถูกเอาออก และลำดับรุ่นตาม `next`
   * (เล่มแรก · CLI `--replace-all`) — ทางเขียนของหน้าจอไม่ใช้เด็ดขาด (กติกาข้อ 2 ที่หัวไฟล์)
   */
  replaceAll?: boolean;
  by?: string | null;
  sourceFiles?: SourceFile[] | null;
}

/**
 * บันทึกหนึ่งครั้ง — คืนเลขการบันทึกใหม่ (หน้าจอถือ `tokenOf(เลขนี้)` ต่อ)
 * โยน `BookConflict` ถ้า `parent` ไม่ใช่หัวเล่มแล้ว · `BookRejected` ถ้ารุ่นที่จะเขียนรูปเสีย (ก่อน BEGIN)
 */
export async function commitBookChange(change: BookChange, tx: BookTx = defaultTx): Promise<number> {
  const { next } = change;
  const problems: string[] = [];
  if ((change.kind === 'seed') !== (change.parent === null)) {
    problems.push(change.kind === 'seed' ? 'เล่มแรกต้องไม่มีเล่มตั้งต้น' : 'ต้องบอกเล่มที่ตั้งต้นจาก');
  }
  for (const code of change.changed) {
    const spec = next.models[code];
    if (!spec) { problems.push(`${code}: ไม่มีในเล่มที่จะบันทึก`); continue; }
    for (const p of checkPriceModel(spec, code)) problems.push(`${code} ${p}`);
  }
  if (problems.length > 0) throw new BookRejected(problems);

  const by = change.by ?? null;
  const order = Object.keys(next.models);

  try {
    return await tx(async (db) => {
      // แถวหัวก่อน — ถ้าชนจะรู้ก่อนเขียนอะไรอย่างอื่น
      const id = await insertRevision({
        parentId: change.parent,
        kind: change.kind,
        version: next.version,
        source: next.source,
        bookSubCodes: next.subCodes ?? [],
        edited: next.edited ?? null,
        sourceFiles: change.sourceFiles ?? null,
        createdBy: by,
      }, db);

      const current = await readModels(db, { forUpdate: true });
      const have = new Map(current.map((m) => [m.code, m]));
      let nextPos = current.reduce((n, m) => Math.max(n, m.position), -1) + 1;
      const changed = new Set(change.changed);

      if (change.replaceAll) {
        for (const m of current) {
          if (m.code in next.models) continue;
          await deleteModel(m.code, db);
          await insertHistory(id, { code: m.code, position: null, spec: null }, db);
        }
      }

      // วนตามลำดับของเล่มปลายทาง ⇒ รุ่นใหม่ต่อท้ายตามลำดับเดียวกับ `{ ...current.models, [code]: x }`
      for (const [i, code] of order.entries()) {
        if (!changed.has(code)) continue;
        const position = change.replaceAll ? i : (have.get(code)?.position ?? nextPos++);
        const spec = next.models[code]!;
        await upsertModel({ code, position, spec }, id, by, db);
        await insertHistory(id, { code, position, spec }, db);
      }
      return id;
    });
  } catch (e) {
    if (isParentConflict(e)) throw new BookConflict();
    throw e;
  }
}

/** เล่มแรกของฐาน — มีเล่มอยู่แล้ว = `BookConflict` (ให้ CLI บอกให้ใช้ `--replace-all`) */
export function seedBook(
  book: PriceBook,
  opts: { by?: string | null; sourceFiles?: SourceFile[] | null } = {},
  tx?: BookTx,
): Promise<number> {
  return commitBookChange({
    parent: null, kind: 'seed', next: book, changed: Object.keys(book.models), replaceAll: true, ...opts,
  }, tx);
}

/**
 * ย้อนไปเล่มของการบันทึกครั้งที่ `targetId` — **เป็นการบันทึกใหม่ ไม่ใช่การถอยประวัติ**
 *
 * คนที่กดย้อนเพราะตกใจ แล้วพบว่าย้อนผิดเล่ม ต้องมีทางกลับ ⇒ ไม่มีอะไรถูกลบจากประวัติ ย้อนผิดก็ย้อนกลับได้
 * (ตรงกับสัญญาบนจอ "เล่มที่ใช้อยู่ตอนนี้จะถูกเก็บไว้") · ฟิลด์ระดับเล่มรวม `edited` คัดมาจากเล่มปลายทาง
 * ⇒ การ์ดบนจอกลับเป็นสถานะของเล่มนั้น (แผน §12 ข้อ 6) · ใครกดอยู่ที่ `created_by`
 */
export async function restoreRevision(targetId: number, by: string | null, tx: BookTx = defaultTx): Promise<number> {
  try {
    return await tx(async (db) => {
      const head = await headRevisionId(db);
      if (head === null || !Number.isSafeInteger(targetId) || targetId >= head) throw new RevisionNotFound();
      const target = await readRevision(targetId, db);
      if (!target) throw new RevisionNotFound();

      const want = await readModelsAt(targetId, db);
      const current = await readModels(db, { forUpdate: true });

      const id = await insertRevision({
        parentId: head,
        kind: 'restore',
        restoredFrom: targetId,
        version: target.version,
        source: target.source,
        bookSubCodes: target.bookSubCodes,
        edited: target.edited,
        sourceFiles: null,
        createdBy: by,
      }, db);

      const wanted = new Set(want.map((m) => m.code));
      for (const m of current) {
        if (wanted.has(m.code)) continue;
        await deleteModel(m.code, db);
        await insertHistory(id, { code: m.code, position: null, spec: null }, db);
      }
      const have = new Map(current.map((m) => [m.code, m]));
      for (const w of want) {
        const h = have.get(w.code);
        if (h && h.position === w.position && h.schemaVersion === w.schemaVersion
          && JSON.stringify(h.spec) === JSON.stringify(w.spec)) continue;
        const row = { code: w.code, position: w.position, spec: w.spec as PriceModel, schemaVersion: w.schemaVersion };
        await upsertModel(row, id, by, db);
        await insertHistory(id, row, db);
      }
      return id;
    });
  } catch (e) {
    if (isParentConflict(e)) throw new BookConflict();
    throw e;
  }
}

export interface BackupEntry {
  /** `rev-<เลขการบันทึก>` — ตัวเดียวที่หน้าจอส่งกลับมาตอนกดย้อน (ดู `parseRestoreName`) */
  name: string;
  /** เวลาที่เล่มนั้นถูกบันทึก — คิดแบบเดียวกับ `listBackups()` ของยุคไฟล์ (`edited.at` ?? `version`) */
  at: string;
  models: number;
}

/** การบันทึกก่อนหัวเล่ม เรียงใหม่ไปเก่า — รูปเดียวกับรายการเล่มสำรองของยุคไฟล์ หน้าจอจึงไม่ต้องแก้ */
export async function listRestorable(limit: number = KEEP_BACKUPS, db?: DbExecutor): Promise<BackupEntry[]> {
  const head = await headRevisionId(db);
  if (head === null) return [];
  const revs = await listRevisionsBefore(head, limit, db);
  const out: BackupEntry[] = [];
  for (const r of revs) {
    out.push({ name: `rev-${r.id}`, at: r.edited?.at ?? r.version, models: await countModelsAt(r.id, db) });
  }
  return out;
}

/** ชื่อที่หน้าจอส่งมาตอนกดย้อน → เลขการบันทึก · รูปอื่นทั้งหมด (รวมชื่อไฟล์ `book-*.json` ของยุคไฟล์) → null */
export function parseRestoreName(name: unknown): number | null {
  if (typeof name !== 'string') return null;
  const m = /^rev-([1-9]\d{0,15})$/.exec(name);
  return m ? Number(m[1]) : null;
}
