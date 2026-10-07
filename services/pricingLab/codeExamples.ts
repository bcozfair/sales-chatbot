import { listCatalogProducts, type CatalogProductRow } from '../../db/pricingLabRepo.js';
import { modelOfCode } from './code.js';
import { tsFamilyOfModel } from './catalogTs.js';
import type { BookState } from './bookStore.js';

/**
 * "ค้นรหัสสินค้าจริงจากฐาน" ของช่องรหัสในหน้าคำนวณราคา (เจ้าของเคาะ mockup `pricing-calc-redesign` 2026-10-07)
 * — พิมพ์ส่วนไหนของรหัสก็ได้ → รหัสในฐานที่ตรง · เลือกรุ่นแล้ว → ตัวอย่างของรุ่นนั้น · คิดราคาแล้ว → ราคาในฐานของรหัสเดียวกันไว้เทียบ
 *
 * **ขึ้นเฉพาะรหัสที่สมุดราคาเปิดรุ่นให้** (`modelOfCode` ตัวเดียวกับตัวคิดราคา) — รหัสอื่นเลือกมาก็คิดราคาไม่ได้อยู่แล้ว
 * ⇒ ตัวเลข "พบ N รายการ" = รหัสที่ระบบจะเปิดตารางของรุ่นให้ ไม่ใช่ "รหัสที่คิดราคาได้ครบ" (เกณฑ์เดียวกับ `productsPerModel`)
 *
 * ราคาในฐาน (`products.sales_price`) ส่งไปให้ **เทียบเท่านั้น** — ราคาที่ใช้ยึดสมุดราคา (Excel) เสมอ (เจ้าของ 2026-09-25)
 * เจ้าของขอให้แสดง "เอาไว้เทียบว่าระบบคิดได้ต่างกันเยอะมั้ย" (2026-10-07) · ห้ามเอาไปดัดราคาหรือเติมลงใบ
 *
 * จำไว้ต่อเล่ม 10 นาทีแบบเดียวกับ `productsPerModel` — สินค้าเปลี่ยนตามรอบ sync · เล่มใหม่ (token เปลี่ยน) อ่านใหม่ทันที
 * **ห้าม throw** — ช่องค้นเป็นของช่วย ฐานตอบช้า/ล่มต้องไม่ทำให้หน้าคำนวณราคาใช้ไม่ได้ (ได้ `null` แล้วหน้าจอเงียบไป)
 */

export interface CodeExample {
  model: string;
  ref: string;
  name: string;
  /** ราคาขายในฐาน · 0 = ในฐานไม่มีราคา */
  price: number;
  /** ตารางของแคตตาล็อก (ค่าเดียวกับช่อง "รุ่น" ของหน้าคำนวณราคา) · ไม่มี = รุ่นในสมุดที่ยังไม่มีช่องตามแคตตาล็อก */
  family?: string;
}

interface Indexed extends CodeExample { key: string }

const TTL_MS = 10 * 60_000;
let cache: { token: string; at: number; rows: Indexed[] } | null = null;

/** รหัสตามที่คนพิมพ์ค้น — ไม่สนตัวพิมพ์ ช่องว่าง และ `×` (รหัสจริงเขียน `x` ทั้งสองแบบ) */
export function normCode(s: string): string {
  return s.toUpperCase().replace(/×/g, 'X').replace(/\s+/g, '');
}

/**
 * ตารางของแคตตาล็อกที่รหัสนี้ใช้ — ซีรีส์ BH ดูจากหัวรหัส ไม่ใช่รุ่นในสมุด เพราะสมุดรวม BH-01/BH-02 เป็นรุ่น `BH-01`
 * ตัวเดียว (ชื่อบนจอ `BH-01,02`) และ BH-01C เป็นตัวเลือก C ของรุ่นนั้น แต่แคตตาล็อกแยกเป็นสามตาราง (วัด 2026-10-07)
 */
function familyOf(code: string, modelCode: string): string | undefined {
  if (modelCode.startsWith('BH')) {
    const m = /^\s*BH-?0([123])\s*(C)?/i.exec(code);
    if (!m) return undefined;
    return m[1] === '1' && m[2] ? 'BH-01C' : `BH-0${m[1]}`;
  }
  return tsFamilyOfModel(modelCode, /-02-SI/i.test(code) ? 'TS-02-SI' : undefined);
}

async function indexed(state: BookState): Promise<Indexed[] | null> {
  if (cache && cache.token === state.token && Date.now() - cache.at < TTL_MS) return cache.rows;
  let raw: CatalogProductRow[];
  try {
    raw = await listCatalogProducts();
  } catch (e) {
    console.warn('[pricing] อ่านรหัสสินค้าให้ช่องค้นไม่สำเร็จ:', e instanceof Error ? e.message : e);
    return null;
  }
  const rows: Indexed[] = [];
  for (const r of raw) {
    const model = r.model.trim();
    const m = model ? modelOfCode(model, state.book) : undefined;
    if (!m) continue;
    rows.push({
      model, ref: r.internal_reference ?? '', name: r.name ?? '', price: r.sales_price,
      family: familyOf(model, m.code), key: normCode(model),
    });
  }
  rows.sort((a, b) => a.model.localeCompare(b.model));
  cache = { token: state.token, at: Date.now(), rows };
  return rows;
}

const out = ({ key: _k, ...r }: Indexed): CodeExample => r;

/**
 * `q` = ส่วนไหนของรหัสก็ได้ (ตัวที่ขึ้นต้นตรงกันมาก่อน) · `family` = เฉพาะตารางนั้น · `exact` = รหัสนี้ตรงตัว (เทียบราคา)
 * คืน `total` = ทั้งหมดที่ตรง (หน้าจอบอก "แสดง 8 จาก N") · `null` = อ่านฐานไม่ได้
 */
export async function findCodeExamples(
  state: BookState,
  opts: { q?: string; family?: string; exact?: string; limit: number },
): Promise<{ total: number; rows: CodeExample[] } | null> {
  const all = await indexed(state);
  if (!all) return null;
  if (opts.exact !== undefined) {
    const k = normCode(opts.exact);
    const hit = k ? all.filter((r) => r.key === k) : [];
    return { total: hit.length, rows: hit.slice(0, opts.limit).map(out) };
  }
  const q = normCode(opts.q ?? '');
  let hit = opts.family ? all.filter((r) => r.family === opts.family) : all;
  if (q) {
    hit = hit.filter((r) => r.key.includes(q));
    // ขึ้นต้นตรงกันก่อน แล้วรหัสสั้นก่อน (รหัสสั้น = ใกล้สิ่งที่พิมพ์ที่สุด) · ที่เหลือตามตัวอักษร (เรียงไว้แล้ว)
    hit = [...hit].sort((a, b) =>
      Number(!a.key.startsWith(q)) - Number(!b.key.startsWith(q)) || a.key.length - b.key.length);
  }
  return { total: hit.length, rows: hit.slice(0, opts.limit).map(out) };
}
