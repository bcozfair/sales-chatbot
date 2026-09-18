// ─────────────────────────────────────────────────────────────────────────────
//  สมุดราคาอยู่ที่ไหน และทำไมถึงไม่ได้อยู่ใน git
//
//  โมดูล "คิดราคาสินค้า" — ถอดออกได้ทั้งก้อน ดู services/pricingLab/README.md
//
//  **สมุดราคาคือราคาจริงของบริษัททั้งเล่ม** (`pricebook/book.json` แปลงมาจากไฟล์ Excel
//  ด้วย prototypes/pricing/importer.ts) จึงถูก git-ignore ไว้เหมือน prototypes/pricing/book.json
//  ⇒ `git pull` บนเซิร์ฟเวอร์ **ไม่ได้ไฟล์นี้ไปด้วย** ต้องคัดลอกขึ้นไปเอง (ดู README ของโมดูล)
//
//  ⚠️ สามที่ที่ห้ามวางไฟล์นี้เด็ดขาด — ทั้งสามที่ถูกเสิร์ฟออกเว็บโดยไม่มีการตรวจสิทธิ์:
//    · `public/`              — express.static ที่ index.ts
//    · `data/`                — express.static('/data') ที่ index.ts (ไฟล์ .xlsx ต้นทางก็ห้ามไปไว้ที่นั่น)
//    · bundle ของหน้าแอดมิน   — หน้าแอดมินเป็นไฟล์สาธารณะ การล็อกอินเกิดในเบราว์เซอร์
//                               ของที่ build รวมเข้าไปในหน้าจอ ใครก็โหลดได้โดยไม่ต้องล็อกอิน
//  นี่คือเหตุผลที่ราคาถูกคิดที่เซิร์ฟเวอร์แล้วส่งกลับไปแค่ "ผลของรหัสที่พิมพ์มา"
//  ไม่ใช่ส่งสมุดราคาไปให้เบราว์เซอร์คิดเอง — สมุดราคาไม่เคยออกจากเครื่องเลยสักครั้ง
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PriceBook, SubCode } from './types.js';

const BOOK_PATH = join(process.cwd(), 'pricebook', 'book.json');

let cached: { book: PriceBook; mtimeMs: number } | undefined;

export interface BookStatus {
  ok: boolean;
  path: string;
  /** ข้อความไทยพร้อมขึ้นจอเมื่อยังไม่มีไฟล์ — หน้าจอไม่ต้องรู้จัก errno */
  message?: string;
  models?: number;
  version?: string;
}

/**
 * อ่านสมุดราคาจากดิสก์ · cache ไว้จนกว่าไฟล์จะถูกเขียนทับ (ดูจาก mtime)
 *
 * ทำไมไม่โหลดครั้งเดียวตอน boot: ไฟล์ราคาถูกเปลี่ยนโดยการคัดลอกไฟล์ใหม่ทับ ซึ่งไม่ควรต้อง
 * restart ทั้งแอป (แอปเดียวกับบอทที่ตอบ LINE อยู่) · `statSync` ต่อ 1 request ราคาถูกกว่า
 * การ parse JSON 450KB ทุกครั้งมาก
 *
 * **ห้าม throw** — ไฟล์ที่ยังไม่ได้คัดลอกขึ้นเซิร์ฟเวอร์เป็นสถานะปกติของโมดูลนี้ ไม่ใช่ความผิดพลาด
 * ของระบบ · router เป็นคนแปลง `undefined` เป็น 503 พร้อมข้อความว่าต้องทำอะไรต่อ
 */
export function loadBook(): PriceBook | undefined {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(BOOK_PATH).mtimeMs;
  } catch {
    cached = undefined;
    return undefined;
  }
  if (cached && cached.mtimeMs === mtimeMs) return cached.book;
  try {
    const book = JSON.parse(readFileSync(BOOK_PATH, 'utf8')) as PriceBook;
    if (!book || typeof book !== 'object' || !book.models) return undefined;
    cached = { book, mtimeMs };
    return book;
  } catch {
    return undefined;
  }
}

export function bookStatus(): BookStatus {
  const book = loadBook();
  if (!book) {
    return {
      ok: false,
      path: BOOK_PATH,
      message:
        'ยังไม่มีสมุดราคาในเครื่องนี้ — ต้องสร้างด้วย prototypes/pricing/importer.ts ' +
        'แล้วคัดลอก book.json มาไว้ที่ pricebook/book.json (ห้ามวางใน public/ หรือ data/)',
    };
  }
  return { ok: true, path: BOOK_PATH, models: Object.keys(book.models).length, version: book.version };
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
