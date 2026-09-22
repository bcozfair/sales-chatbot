// ─────────────────────────────────────────────────────────────────────────────
//  เทียบสมุดราคาสองเล่ม · รวมเฉพาะรุ่นที่แอดมินติ๊ก · เก็บเล่มเก่าไว้ย้อนกลับ
//
//  โมดูล "คิดราคาสินค้า" — ถอดออกได้ทั้งก้อน ดู services/pricingLab/README.md
//
//  เจ้าของเคาะ 2026-09-21 (จาก mockup ชุด pb-*):
//    · **ไฟล์ที่อัปผ่านจอเป็นตัวจริง** — Excel ใน `data/` กลายเป็นเอกสารอ้างอิง ไม่ใช่ทางเข้าของระบบ
//    · **เลือกได้ว่าจะบันทึกรุ่นไหนบ้าง** — รุ่นที่ไม่ติ๊ก "คงราคาเดิม" ไม่ใช่ถูกลบ
//    · **เก็บเล่มเก่าไว้ 3 เล่ม** — อัปผิดแล้วต้องย้อนได้จากหน้าจอ ไม่ต้อง ssh ไปรัน CLI
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

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BOOK_PATH } from './bookStore.js';
import type { Money, PriceBook, PriceModel } from './types.js';

/** เก็บเล่มเก่ากี่เล่ม — เจ้าของเคาะ 3 */
export const KEEP_BACKUPS = 3;

const BACKUP_DIR = join(dirname(BOOK_PATH), 'backups');

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
    if (next) models[code] = next;
  }
  return {
    ...current,
    version: meta.at.slice(0, 10),
    models,
    edited: { at: meta.at, by: meta.by, note: meta.file },
  };
}

/**
 * ลายนิ้วมือของสมุดเล่มที่ใช้อยู่ — ใช้ตอบคำถามเดียว: **"เล่มที่คุณเพิ่งดูส่วนต่าง
 * ยังเป็นเล่มเดียวกับที่กำลังจะเขียนทับอยู่ไหม"**
 *
 * มีเพราะสองคนอัปพร้อมกันได้จริง: A ดูส่วนต่างค้างไว้ · B บันทึกไป · A กดบันทึก
 * ⇒ ส่วนต่างที่ A เห็นเป็นของเล่มที่ไม่มีอยู่แล้ว การปล่อยให้เขียนทับคือการลบงานของ B
 * โดยที่ A ไม่รู้ตัว · ไม่มีไฟล์ = `''` (เล่มแรกของเครื่อง ใครอัปก่อนได้ก่อน)
 */
export function bookFingerprint(path: string = BOOK_PATH): string {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
  } catch {
    return '';
  }
}

export interface BackupEntry {
  /** ชื่อไฟล์ล้วน ๆ — เป็นตัวเดียวที่หน้าจอส่งกลับมาตอนกดย้อน (ดู `restoreBackup`) */
  name: string;
  /** เวลาที่เล่มนั้นถูกเก็บ รูปแบบ ISO */
  at: string;
  models: number;
}

export function listBackups(dir: string = BACKUP_DIR): BackupEntry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith('book-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .map((name) => {
      let models = 0;
      let at = '';
      try {
        const b = JSON.parse(readFileSync(join(dir, name), 'utf8')) as PriceBook;
        models = Object.keys(b.models ?? {}).length;
        at = b.edited?.at ?? b.version ?? '';
      } catch { /* เล่มที่อ่านไม่ออกยังต้องโผล่ในรายการ ไม่ใช่หายไปเงียบ ๆ */ }
      return { name, at, models };
    });
}

/** ชื่อไฟล์สำรองเรียงตามเวลาได้ด้วยตัวอักษร — `sort()` จึงเป็นลำดับเวลาจริง ไม่ต้อง stat */
function backupName(now: Date): string {
  return `book-${now.toISOString().replace(/[:.]/g, '-')}.json`;
}

/**
 * เขียนสมุดเล่มใหม่ **หลังจากย้ายเล่มเดิมไปกองสำรองแล้วเท่านั้น**
 *
 * ลำดับสำคัญ: ย้ายก่อน เขียนทีหลัง — ถ้าเขียนก่อนแล้วไฟฟ้าดับกลางคัน เล่มเดิมหายไปพร้อมกับ
 * เล่มใหม่ที่เขียนไม่จบ · `renameSync` บนไดรฟ์เดียวกันเป็น atomic จึงไม่มีช่วงที่ไม่มีไฟล์เลย
 */
export function saveBook(book: PriceBook, path: string = BOOK_PATH, now: Date = new Date()): void {
  const dir = join(dirname(path), 'backups');
  mkdirSync(dir, { recursive: true });

  if (existsSync(path)) renameSync(path, join(dir, backupName(now)));

  writeFileSync(path, JSON.stringify(book, null, 2), 'utf8');

  // เก็บ 3 เล่ม — ตัดจากท้าย (เก่าสุด) หลังเรียงใหม่→เก่า
  for (const old of listBackups(dir).slice(KEEP_BACKUPS)) {
    try { unlinkSync(join(dir, old.name)); } catch { /* ลบไม่ได้ก็ไม่ใช่เหตุให้การบันทึกล้ม */ }
  }
}

/**
 * ย้อนไปเล่มก่อนหน้า — **เล่มปัจจุบันถูกเก็บเป็นสำรองด้วย** ไม่ใช่ทิ้ง
 *
 * คนที่กดย้อนเพราะตกใจ แล้วพบว่าย้อนผิดเล่ม ต้องมีทางกลับ ⇒ การย้อนคือการบันทึกอีกครั้ง
 * ไม่ใช่การถอยประวัติ · คืน `false` เมื่อไม่มีไฟล์นั้นแล้ว (มีคนย้อนไปก่อนหน้าเราแล้ว)
 */
export function restoreBackup(name: string, path: string = BOOK_PATH, now: Date = new Date()): boolean {
  // กันชื่อที่พาออกนอกโฟลเดอร์ — ชื่อมาจาก body ของ request ไม่ใช่จากรายการที่เราสร้างเอง
  if (!/^book-[\w.-]+\.json$/.test(name)) return false;
  const dir = join(dirname(path), 'backups');
  const src = join(dir, name);
  if (!existsSync(src)) return false;

  let book: PriceBook;
  try {
    book = JSON.parse(readFileSync(src, 'utf8')) as PriceBook;
  } catch {
    return false;
  }
  if (!book?.models) return false;

  saveBook(book, path, now);
  try { unlinkSync(src); } catch { /* เล่มที่ถูกยกกลับมาใช้แล้วไม่ต้องค้างอยู่ในกองสำรองอีก */ }
  return true;
}
