/**
 * localProducts — ตรรกะธุรกิจของโมดูล "สินค้าเพิ่มเอง"
 *
 * แผน: docs/plan-local-products.md · ก้อน J1 มีเฉพาะ reconcile ท้ายรอบ sync (§6.3 · §7)
 * ส่วนสร้าง/แก้/ออกรหัส/ชื่อ/ต้นแบบ มาที่ J2 (§4 · §13)
 *
 * ── ทางที่ไม่ได้เลือก ──────────────────────────────────────────────────────────────
 * - **ปุ่มให้คนติ๊กว่า "คีย์เข้า Odoo แล้ว"** — สินค้าที่คีย์แล้วเดินกลับมาหาเราเองทางรอบ sync
 *   ปุ่มมีแต่จะสร้างสถานะที่ขัดกับความจริง (เหตุผลเดียวกับผู้ติดต่อ · เจ้าของเคาะ 2026-09-17)
 * - **import `services/pricingLab/`** เพื่อคิดราคา — ห้าม (§13.5): ปุ่มคิดราคาเรียกผ่าน HTTP
 *   ไม่งั้นโมดูลคิดราคาถอดออกทั้งก้อนไม่ได้อีก
 */
import {
  markMatchedFromProducts, deleteMatchedLocalProductRows, countPendingLocalProducts,
} from '../db/localProductsRepo.js';
import { pool } from '../config/db.js';
import { slog, swarn } from '../scripts/sync/syncLog.js';

/**
 * "เข้า Odoo แล้วหรือยัง" — ตอบด้วยของที่ Odoo ส่งกลับมาจริง
 *
 * **ยืนยันจากตาราง `products` อย่างเดียว** (เจ้าของเคาะ 2026-10-01): แถวของ Odoo ที่
 * `internal_reference` หรือ `model` ตรงกัน · ไม่ใช้ "ใบที่นำเข้าแล้ว" เป็นสัญญาณ (ต่างจากผู้ติดต่อ)
 * ⇒ ต้องรันหลังรอบ sync สินค้า ซึ่งเป็นตัวเขียน `products`
 *
 * **ห้าม throw** — ถูกเรียกท้ายรอบ sync โยนออกไปจะกลืนบรรทัดสรุปรอบทั้งที่ sync สำเร็จแล้ว
 */
export async function reconcileLocalProductOdooLinks(): Promise<
  { reference: number; model: number; removed: number; pending: number } | null
> {
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'local_products'`
    );
    if (rows.length === 0) {
      // ยังไม่ได้รัน migration 2026-10-01_01 → ข้ามเงียบ ๆ · ไม่ CREATE ให้เอง (sync ไม่ควรสั่ง DDL)
      return null;
    }

    const matched = await markMatchedFromProducts();
    const removed = await deleteMatchedLocalProductRows();
    const pending = await countPendingLocalProducts();

    if (matched.reference || matched.model) {
      slog(`สินค้าเพิ่มเองเข้า Odoo แล้ว ${matched.reference + matched.model} รายการ ` +
           `(รหัสตรง ${matched.reference} · model ตรง ${matched.model}) · ยังค้าง ${pending}`);
    }
    return { ...matched, removed, pending };
  } catch (err) {
    swarn(`จับคู่สินค้าเพิ่มเองกับ Odoo ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
