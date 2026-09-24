import { listCatalogCodes } from '../../db/pricingLabRepo.js';
import { modelOfCode } from './code.js';
import type { BookState } from './bookStore.js';

/**
 * "แก้รุ่นนี้แล้วกระทบสินค้ากี่รายการ" — คอลัมน์ในตารางรุ่นของหน้า "สมุดราคา" (เจ้าของสั่ง 2026-09-23)
 *
 * นับจาก `products.model` ที่หัวรหัสตกรุ่นนั้น (`modelOfCode` = ด่านเดียวกับที่ตัวคิดราคาใช้หารุ่น)
 * ⇒ ตัวเลขนี้คือ "รหัสที่ระบบจะเปิดตารางของรุ่นนี้" ไม่ใช่ "รหัสที่คิดราคาได้ครบ" — รหัสที่มีรหัสย่อย
 *   ที่ยังไม่ได้ตั้งค่าก็ถูกนับด้วย (ตัวนั้นวัดด้วย `diag:pricing-coverage`)
 * ⇒ **ไม่เท่ากับจำนวนในหน้าข้อมูลสินค้า** โดยตั้งใจ: หน้านั้นนับตามซีรีส์ของ Odoo ซึ่งจัดกลุ่มคนละแบบ
 *   (ซีรีส์ `Heater (สั่งในประเทศ)` 269 รายการมีหัวรหัส `BH-01` ⇒ นับรวมที่นี่ แต่ไม่อยู่ในซีรีส์ `BH-01,02`)
 *
 * จำไว้ต่อเล่ม 10 นาที — สินค้าเปลี่ยนตามรอบ sync ไม่ใช่ทุกวินาที และเล่มใหม่ (token เปลี่ยน) นับใหม่ทันที
 * **ห้าม throw** — ตัวเลขนี้เป็นของประกอบจอ ฐานสินค้าตอบช้าต้องไม่ทำให้หน้าสมุดราคาเปิดไม่ขึ้น
 */
const TTL_MS = 10 * 60_000;
let cache: { token: string; at: number; counts: Record<string, number>; total: number } | null = null;

export async function productsPerModel(
  state: BookState,
): Promise<{ counts: Record<string, number>; total: number } | null> {
  if (cache && cache.token === state.token && Date.now() - cache.at < TTL_MS) return cache;
  try {
    const codes = await listCatalogCodes();
    const counts: Record<string, number> = {};
    for (const code of Object.keys(state.book.models)) counts[code] = 0;
    for (const raw of codes) {
      const m = modelOfCode(raw, state.book);
      if (m) counts[m.code] = (counts[m.code] ?? 0) + 1;
    }
    cache = { token: state.token, at: Date.now(), counts, total: codes.length };
    return cache;
  } catch (e) {
    console.warn('[pricebook] นับสินค้าต่อรุ่นไม่สำเร็จ:', e instanceof Error ? e.message : e);
    return null;
  }
}
