// ─────────────────────────────────────────────────────────────────────────────
//  สมุดราคาอยู่ที่ไหน — ในฐานข้อมูล (ตั้งแต่ 2026-09-23 · docs/plan-pricebook-db.md)
//
//  โมดูล "คิดราคาสินค้า" — ถอดออกได้ทั้งก้อน ดู services/pricingLab/README.md
//
//  สามตาราง: `pricing_models` (รุ่นละแถว = เล่มปัจจุบัน) · `pricing_model_history` (เขียนต่อท้าย)
//  · `pricing_book_revisions` (การบันทึกหนึ่งครั้ง + ฟิลด์ระดับเล่ม) — SQL อยู่ที่ db/pricingBookRepo.ts
//  ทางเขียนทุกทางอยู่ที่ `bookUpdate.ts` ไฟล์นี้อ่านอย่างเดียว
//
//  **ทำไมย้ายออกจาก `pricebook/book.json`:** ไฟล์อยู่ในคอนเทนเนอร์ที่ไม่มี volume ⇒ ทุกครั้งที่
//  `docker compose up --build` ราคาที่แอดมินแก้หายทั้งเล่มพร้อมเล่มสำรอง และสำรองตีสามไม่เคยถ่ายมันไป
//  **ทางที่ไม่ได้เลือก:** เพิ่ม volume ให้ `pricebook/` (ไม่เข้าสำรองอัตโนมัติ · ไม่มี transaction ·
//  dev กับ prod ยังเป็นสองเล่ม) · สวิตช์ file|db (ความจริงสองแหล่ง — prod ไม่มีไฟล์ให้ถอยไปหาอยู่แล้ว)
//
//  ⚠️ **สมุดราคาคือราคาจริงของบริษัททั้งเล่ม** — สามที่ที่มันต้องไม่ไปอยู่ (ถูกเสิร์ฟออกเว็บโดยไม่ตรวจสิทธิ์):
//    · `public/` · `data/` (express.static ที่ index.ts — ไฟล์ .xlsx ต้นทางก็ห้าม)
//    · bundle ของหน้าแอดมิน — หน้าแอดมินเป็นไฟล์สาธารณะ การล็อกอินเกิดในเบราว์เซอร์
//  และตารางสามตัวนี้ **ห้ามลงทะเบียนใน services/externalSync.ts** (ตารางที่ไม่อยู่ในทะเบียนตอบ 404 อยู่แล้ว)
//  นี่คือเหตุผลที่ราคาถูกคิดที่เซิร์ฟเวอร์แล้วส่งกลับไปแค่ "ผลของรหัสที่พิมพ์มา"
// ─────────────────────────────────────────────────────────────────────────────

import { pool, type DbExecutor } from '../../config/db.js';
import { headRevisionId, readHeadRevision, readModels } from '../../db/pricingBookRepo.js';
import { PRICE_MODEL_SCHEMA_VERSION, checkPriceModel } from './modelShape.js';
import type { PriceBook, PriceModel, SubCode } from './types.js';

/** ข้อความบนจอเมื่อยังไม่มีสมุด — เจ้าของเคาะถ้อยคำ 2026-09-23 (แผน §12 ข้อ 9) */
export const NO_BOOK_MESSAGE = 'ยังไม่มีสมุดราคาในระบบ — ให้ผู้ดูแลระบบนำเข้าเล่มแรก';

/** รุ่นที่อยู่ในฐานแต่ไม่ถูกป้อนเข้า engine — พร้อมเหตุผล (แถวเสีย / โครงสร้างรุ่นใหม่กว่าโค้ด) */
export interface SkippedModel {
  code: string;
  reasons: string[];
}

export interface BookState {
  book: PriceBook;
  /** เลขการบันทึกที่เล่มนี้เป็นผลของ */
  revision: number;
  /**
   * สิ่งที่หน้าจอถือไว้ในช่อง `fingerprint` แล้วส่งกลับมาตอนบันทึก — `r<เลขการบันทึก>`
   * ทึบสำหรับหน้าจอ (ชื่อช่องเดิม รูปเดิม) ⇒ frontend ไม่ต้องแก้สักบรรทัด
   */
  token: string;
  skipped: SkippedModel[];
}

export const tokenOf = (revision: number): string => `r${revision}`;

/** ตารางยังไม่ถูกสร้าง (ยังไม่รัน migration) = "ยังไม่มีสมุด" ไม่ใช่ 500 ⇒ ลำดับ migration/deploy สลับกันได้ */
export function isMissingTable(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === '42P01';
}

/**
 * อ่านเล่มปัจจุบันจากฐาน **ไม่ใช้ cache** — ใช้ใน transaction (ส่ง client มา) และในด่าน
 *
 * ลำดับคีย์ของเล่มที่ประกอบคืนต้องเท่ากับไฟล์เดิม (`version · source · models · subCodes · edited`)
 * เพราะด่าน `diag:pricing-db` เทียบ `JSON.stringify` ทุกไบต์กับเล่มต้นทาง
 *
 * รุ่นที่ไม่ผ่าน `checkPriceModel` หรือ `schema_version` ไม่ตรง **ถูกข้าม ไม่ใช่ทั้งเล่มล้ม** —
 * หน้าจอที่ตายทั้งหน้าเพราะแถวเดียวเสีย แย่กว่า (ท่าเดียวกับ `toStored()` ของรหัสย่อย)
 */
export async function readBookState(db: DbExecutor = pool): Promise<BookState | undefined> {
  const head = await readHeadRevision(db);
  if (!head) return undefined;
  const rows = await readModels(db);

  const models: Record<string, PriceModel> = {};
  const skipped: SkippedModel[] = [];
  for (const r of rows) {
    const reasons = r.schemaVersion === PRICE_MODEL_SCHEMA_VERSION
      ? checkPriceModel(r.spec, r.code)
      : [`โครงสร้างรุ่นที่ ${r.schemaVersion} — โค้ดนี้รู้จักแค่ ${PRICE_MODEL_SCHEMA_VERSION}`];
    if (reasons.length > 0) { skipped.push({ code: r.code, reasons }); continue; }
    models[r.code] = r.spec as PriceModel;
  }

  const book: PriceBook = { version: head.version, source: head.source, models, subCodes: head.bookSubCodes };
  if (head.edited) book.edited = head.edited;
  return { book, revision: head.id, token: tokenOf(head.id), skipped };
}

// ── cache ────────────────────────────────────────────────────────────────────
//
// เทียบเลขการบันทึกล่าสุดทุกครั้งที่เรียก (query เดียว อ่านจาก PK) — ตรง = ใช้ของเดิม · ไม่ตรง = โหลดใหม่
// **ทำไมไม่ล้าง cache แค่ตอนเขียนในโปรเซส:** แอปเป็นโปรเซสเดียวก็จริง แต่ CLI นำเข้าเล่มเป็นอีกโปรเซส
// ⇒ หน้าจอจะเห็นเล่มเก่าจนกว่าจะรีสตาร์ต · นี่คือของคู่กับ `statSync` ต่อ request ของยุคไฟล์
// **ห้าม import services/rules/cache.ts** — โมดูลนี้ต้องไม่พึ่งของระบบหลัก (README "การพึ่งพาเป็นทางเดียว")
// **ห้ามแก้ object ใน cache** — มันถูกใช้ร่วมทุก request (`withSubCodes` คืนก้อนใหม่ให้อยู่แล้ว)

let cached: BookState | undefined;
let loading: { revision: number; promise: Promise<BookState | undefined> } | undefined;
const warnedFor = new Set<number>();

/**
 * เล่มปัจจุบัน (ผ่าน cache) · `undefined` = ยังไม่มีสมุด หรือยังไม่ได้รัน migration
 *
 * `db` มีไว้ให้ด่าน `diag:pricing-db` ส่ง client ที่มีตารางชั่วคราวเข้ามาพิสูจน์ cache — แอปใช้ค่าเริ่มต้นเสมอ
 *
 * error อื่นของฐาน (ฐานล่ม) โยนต่อ — Express 5 แปลงเป็น 500 ให้ · ไม่กลืนเป็น "ยังไม่มีสมุด"
 * เพราะข้อความนั้นจะบอกแอดมินให้ไปนำเข้าเล่มใหม่ ทั้งที่ของเดิมยังอยู่ครบ
 */
export async function loadBookState(db: DbExecutor = pool): Promise<BookState | undefined> {
  let head: number | null;
  try {
    head = await headRevisionId(db);
  } catch (e) {
    if (isMissingTable(e)) { cached = undefined; return undefined; }
    throw e;
  }
  if (head === null) { cached = undefined; return undefined; }
  if (cached && cached.revision === head) return cached;

  // หลาย request มาพร้อมกันตอน cache เพิ่งหมดอายุ = โหลดครั้งเดียว ไม่ใช่คนละครั้ง
  if (!loading || loading.revision !== head) {
    const promise = readBookState(db).then((state) => {
      // เล่มที่โหลดได้อาจใหม่กว่า head ที่ถามไว้ (มีคนบันทึกแทรก) — ใช้เลขของมันเอง
      // ครั้งหน้าที่ max(id) ไม่ตรงก็โหลดใหม่เอง ไม่มีทางค้างเล่มเก่า
      cached = state;
      if (state && state.skipped.length > 0 && !warnedFor.has(state.revision)) {
        warnedFor.add(state.revision);
        console.warn(`[pricingLab] สมุดราคา ${state.token} ข้าม ${state.skipped.length} รุ่นที่อ่านไม่ได้:`,
          state.skipped.map((s) => `${s.code} (${s.reasons[0]})`).join(' · '));
      }
      return state;
    }).finally(() => { if (loading?.promise === promise) loading = undefined; });
    loading = { revision: head, promise };
  }
  return loading.promise;
}

/** แค่ตัวเล่ม — สำหรับจุดที่ไม่ต้องใช้ token */
export async function loadBook(): Promise<PriceBook | undefined> {
  return (await loadBookState())?.book;
}

export interface BookStatus {
  ok: boolean;
  /** ข้อความไทยพร้อมขึ้นจอเมื่อยังไม่มีสมุด — หน้าจอไม่ต้องรู้จักรหัส error */
  message?: string;
  models?: number;
  version?: string;
  /** รุ่นที่อยู่ในฐานแต่ใช้ไม่ได้ — ต้องโผล่ให้เห็น ไม่ใช่หายไปเงียบ ๆ */
  skipped?: SkippedModel[];
}

/**
 * สถานะสำหรับการ์ดบนจอ · **ตัด `path` ทิ้งแล้ว** (ยุคไฟล์ส่ง path ในเครื่องหลุดออกไปกับ `/overview`
 * และหน้าจอไม่ได้ใช้)
 */
export async function bookStatus(state?: BookState): Promise<BookStatus> {
  const s = state ?? await loadBookState();
  if (!s) return { ok: false, message: NO_BOOK_MESSAGE };
  const out: BookStatus = { ok: true, models: Object.keys(s.book.models).length, version: s.book.version };
  if (s.skipped.length > 0) out.skipped = s.skipped;
  return out;
}

/**
 * รวมรหัสย่อยจากตารางในฐานเข้ากับที่ติดมากับไฟล์ราคา — **ของในฐานชนะ**
 *
 * ที่ต้องมีลำดับชัด ๆ เพราะสองที่มีสิทธิ์พูดถึงตัวอักษรเดียวกันได้: ไฟล์ราคาพูดเมื่อชีตเขียนไว้เอง
 * (วันนี้มีแถวเดียว — `-U` ของ TS-14) ส่วนฐานคือสิ่งที่แอดมินตั้งทีหลัง ⇒ คนที่ตั้งทีหลังต้องชนะ
 * ไม่งั้นเขาจะกดตั้งแล้วราคาไม่ขยับ โดยไม่มีอะไรบอกว่าทำไม
 *
 * ไม่แก้ `book` ตัวเดิม — มันถูก cache ไว้ใช้ร่วมทุก request การเขียนทับคือการทำให้
 * คำขอของคนหนึ่งเปลี่ยนคำตอบของอีกคน
 */
export function withSubCodes(book: PriceBook, fromDb: SubCode[]): PriceBook {
  // คีย์เป็น JSON ของคู่ [รหัสย่อย, ขอบเขต] ไม่ใช่การต่อสตริงด้วยตัวคั่น —
  // ตัวคั่นตัวไหนก็ตามที่โผล่ในค่าจริงได้ จะทำให้สองคู่ที่ต่างกันกลายเป็นคีย์เดียวกันเงียบ ๆ
  const key = (sc: SubCode) => JSON.stringify([sc.subCode, sc.scope]);
  const merged = new Map<string, SubCode>();
  for (const sc of book.subCodes ?? []) merged.set(key(sc), sc);
  for (const sc of fromDb) merged.set(key(sc), sc);
  return { ...book, subCodes: [...merged.values()] };
}
