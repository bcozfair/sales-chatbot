import { createHash } from 'node:crypto';
import { listCatalogCodes } from '../../db/pricingLabRepo.js';
import { modelOfCode, parseProductCode } from './code.js';
import { scopeRank } from './subcodes.js';
import type { BookState } from './bookStore.js';
import type { PriceBook, SubCode } from './types.js';

/**
 * รหัสย่อยบนหน้า "สมุดราคา" — ย้ายจากตารางใหญ่หน้าแรกไปอยู่ในหน้าชีตของแต่ละรุ่น
 * (เจ้าของเคาะ mockup `pricebook-subcodes-sheet` 2026-09-29 · ถามมาว่า "มันดูซ้ำกันหลายรุ่น")
 *
 * ไฟล์นี้ตอบสองคำถามให้หน้าจอ **โดยไม่ส่งราคาออกไปเพิ่ม** (แถวรหัสย่อยเดินทางไปหน้าจออยู่แล้วตั้งแต่เดิม):
 *
 * 1. `subCodeModels` — แถวนี้ใช้กับรุ่นไหนบ้าง ⇒ หน้าจอเอาไปจัดเข้าชีต · ค้น "ตัวอักษรนี้ใช้ที่ไหน"
 *    ใช้ `scopeRank` ตัวเดียวกับที่ตัวอ่านรหัสตัดสิน **ห้ามเขียนกติกาขอบเขตชุดที่สองบนหน้าจอ** —
 *    วันที่สองชุดต่างกัน แถวจะโผล่ในชีตที่มันไม่ได้มีผลจริง
 *
 * 2. `unreadBySheet` — "ยังอ่านไม่ออกในชีตนี้" **นับสดจากรหัสสินค้าจริง** ด้วยตัวอ่านรหัสปัจจุบัน
 *    แทนรายการ `subcode-census.json` ที่นับไว้ครั้งเดียว 2026-09-18 (เจ้าของเคาะข้อ 3) — รายการเดิมยังโชว์
 *    ตัวที่ระบบอ่านออกแล้ว (S4 = เกลียว · BU = B+U · N ของ BH) เพราะมันไม่รู้ว่าตัวอ่านเก่งขึ้น
 *    · ท่อนที่ **เพิ่มแถวรหัสย่อยแล้วอ่านออก** (`CodePart.subCode`) แยกกองจากท่อนที่ต้องแก้ที่ตาราง/ตัวอ่าน
 *      (ขนาดที่ตารางไม่มี `10.2` · `+400`) — ให้กด "+" ตั้งรหัสย่อยกับท่อนหลังคือพาคนไปทางที่แก้ไม่ได้
 *
 * 3. `askPrice` ต่อชีต — ค่านอกแคตตาล็อกที่พบในรหัสจริง (`ProductConfig.askPrice` · TS_-01 2026-09-29) = ชิปของกล่อง
 *    "ต้องขอราคาจากฝ่ายผลิต" บนหน้าชีต · นับในรอบเดียวกับข้อ 2 (อ่านรหัสครั้งเดียว)
 *
 * ⚠️ **งานนับรันในโปรเซสเดียวกับ webhook ของ LINE** — อ่านรหัส 17,879 ตัวใช้ ~1.9 วินาที CPU
 *   (วัด 2026-09-29 หลังจำค่าแกนใน `axisValues` · ก่อนหน้านั้น 11.4 วินาที) ⇒ แบ่งเป็นช่วงไม่เกิน
 *   `SLICE_MS` แล้วคืนเครื่องให้ event loop ทุกช่วง ไม่งั้นบอทค้างทั้งระบบตลอดเวลาที่มีคนเปิดหน้านี้
 *   · จำผลต่อ (เล่ม · ชุดรหัสย่อย) + อายุ 10 นาทีสำหรับสินค้าที่ sync เข้ามาใหม่ · คำขอที่มาระหว่างนับ
 *     รอผลรอบเดียวกัน ไม่เริ่มรอบที่สอง
 *   · **ห้าม throw** — เป็นของประกอบจอ ฐานสินค้าตอบช้าต้องไม่ทำให้หน้าสมุดราคาเปิดไม่ขึ้น
 */

/** รหัสรุ่นทุกตัวที่แถวนี้มีผล — รวมขอบเขตทั้งตระกูล (`BH-0*`) และทุกรุ่น (`*`) */
export function subCodeModels(book: PriceBook, sc: SubCode): string[] {
  return Object.values(book.models)
    .filter((m) => scopeRank(sc, m) !== undefined)
    .map((m) => m.code);
}

/** ชีตของรุ่น — กติกาเดียวกับตารางชีตของหน้าสมุดราคา (`groupSheets`): รุ่นที่ไม่รู้ชีตเป็นชีตของตัวเอง */
const sheetOf = (m: { code: string; sheet?: string }) => m.sheet || m.code;

export interface UnreadToken {
  /** ข้อความตามที่อยู่ในรหัส (มีวงเล็บถ้ารหัสมี) */
  text: string;
  /** มี = เพิ่มแถวรหัสย่อยด้วยคำนี้แล้วอ่านออก · ไม่มี = แก้ที่ตาราง/ตัวอ่าน */
  subCode?: string;
  /** จำนวนรหัสสินค้าที่มีท่อนนี้ */
  count: number;
  /** รหัสจริงหนึ่งตัวที่มีท่อนนี้ — กล่องตั้งค่าใช้พรีวิวราคาก่อน/หลัง */
  example: string;
  /** ตัวอ่านบอกว่าอะไร (ตัวอย่างแรก) — ขึ้นเป็นคำอธิบายเมื่อชี้ */
  reads: string;
}

/**
 * ค่านอกแคตตาล็อกที่พบในรหัสจริง (`ProductConfig.askPrice`) — ชิป "+ เพิ่ม" ของกล่อง "ต้องขอราคาจากฝ่ายผลิต" บนหน้าชีต
 * (เจ้าของเคาะ mockup `ts01-ask-price` แบบ A 2026-09-29) · นับรวมค่าที่แอดมินเพิ่มเข้าตารางแล้วด้วย — จอเป็นคนติดป้าย "อยู่ในตารางแล้ว"
 */
export interface AskValue {
  model: string;
  axis: string;
  value: string;
  count: number;
  example: string;
}

export interface SheetUnread {
  sheet: string;
  /** รหัสสินค้าที่ตกรุ่นในชีตนี้ */
  codes: number;
  /** ในนั้นมีท่อนที่อ่านไม่ออกอย่างน้อยหนึ่งท่อนกี่รหัส */
  unread: number;
  /** เรียงจากเจอบ่อยไปน้อย · ตัดที่ `TOP_TOKENS` */
  tokens: UnreadToken[];
  /** เรียงจากเจอบ่อยไปน้อย · มีเฉพาะชีตที่รุ่นตั้งให้ "ค่านอกแคตตาล็อก = ขอราคา" */
  askPrice: AskValue[];
}

export interface UnreadSummary {
  measuredAt: string;
  /** รหัสสินค้าที่ตกรุ่นใดรุ่นหนึ่งในสมุด (ไม่ใช่ทั้งฐาน) */
  codes: number;
  unread: number;
  sheets: SheetUnread[];
}

const SLICE_MS = 15;
const TTL_MS = 10 * 60_000;
const TOP_TOKENS = 40;

let cache: { key: string; at: number; value: UnreadSummary } | null = null;
let running: { key: string; promise: Promise<UnreadSummary | null> } | null = null;

/** ลายนิ้วมือของชุดรหัสย่อย — แก้/เพิ่ม/ปิดแถวไหนก็ตาม ผลต้องนับใหม่ (แก้แล้วมีผลทันที · เจ้าของเคาะข้อ 2) */
function stampOf(state: BookState, book: PriceBook): string {
  const h = createHash('sha1').update(JSON.stringify(book.subCodes ?? [])).digest('hex').slice(0, 16);
  return `${state.token}:${h}`;
}

const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));

async function measure(book: PriceBook): Promise<UnreadSummary> {
  const raw = await listCatalogCodes();
  const perSheet = new Map<string, { codes: number; unread: number; tokens: Map<string, UnreadToken>; ask: Map<string, AskValue> }>();
  for (const m of Object.values(book.models)) {
    if (!perSheet.has(sheetOf(m))) perSheet.set(sheetOf(m), { codes: 0, unread: 0, tokens: new Map(), ask: new Map() });
  }

  let sliceStart = performance.now();
  for (const input of raw) {
    if (performance.now() - sliceStart > SLICE_MS) {
      await yieldToLoop();
      sliceStart = performance.now();
    }
    const code = input.trim();
    const m = modelOfCode(code, book);
    if (!m) continue;
    const bucket = perSheet.get(sheetOf(m))!;
    bucket.codes += 1;
    const parsed = parseProductCode(code, book);
    for (const [axis, value] of Object.entries(parsed.cfg?.askPrice ?? {})) {
      const key = `${m.code}|${axis}|${value}`;
      const hit = bucket.ask.get(key);
      if (hit) hit.count += 1;
      else bucket.ask.set(key, { model: m.code, axis, value, count: 1, example: code });
    }
    const unknown = parsed.parts.filter((p) => p.kind === 'unknown');
    if (unknown.length === 0) continue;
    bucket.unread += 1;
    const seen = new Set<string>();
    for (const p of unknown) {
      const key = p.subCode !== undefined ? `s:${p.subCode.toUpperCase()}` : `t:${p.text.toUpperCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = bucket.tokens.get(key);
      if (t) t.count += 1;
      else bucket.tokens.set(key, { text: p.text, ...(p.subCode !== undefined ? { subCode: p.subCode } : {}), count: 1, example: code, reads: p.reads });
    }
  }

  const sheets = [...perSheet].map(([sheet, b]) => ({
    sheet,
    codes: b.codes,
    unread: b.unread,
    tokens: [...b.tokens.values()].sort((x, y) => y.count - x.count || x.text.localeCompare(y.text)).slice(0, TOP_TOKENS),
    askPrice: [...b.ask.values()].sort((x, y) => y.count - x.count || x.value.localeCompare(y.value)),
  }));
  return {
    measuredAt: new Date().toISOString(),
    codes: sheets.reduce((n, s) => n + s.codes, 0),
    unread: sheets.reduce((n, s) => n + s.unread, 0),
    sheets,
  };
}

/** `book` ต้องรวมรหัสย่อยจากฐานแล้ว (`withSubCodes`) — ไม่งั้นแถวที่แอดมินตั้งไว้จะถูกนับว่าอ่านไม่ออก */
export async function unreadBySheet(state: BookState, book: PriceBook): Promise<UnreadSummary | null> {
  const key = stampOf(state, book);
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.value;
  if (running && running.key === key) return running.promise;
  const promise = measure(book)
    .then((value) => {
      cache = { key, at: Date.now(), value };
      return value;
    })
    .catch((e: unknown) => {
      console.warn('[pricebook] นับท่อนที่ยังไม่ได้กำหนดไม่สำเร็จ:', e instanceof Error ? e.message : e);
      return null;
    })
    .finally(() => {
      if (running?.promise === promise) running = null;
    });
  running = { key, promise };
  return promise;
}
