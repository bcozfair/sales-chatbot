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
  markMatchedByProductSync, markMatchedByImportedOrder, countPendingLocalProducts,
} from '../db/localProductsRepo.js';
import { pool } from '../config/db.js';
import { slog, swarn } from '../scripts/sync/syncLog.js';

/**
 * "เข้า Odoo แล้วหรือยัง" — ตอบด้วยของที่ Odoo ส่งกลับมาจริง
 *
 * **ห้าม throw** — ถูกเรียกท้ายรอบ sync โยนออกไปจะกลืนบรรทัดสรุปรอบทั้งที่ sync สำเร็จแล้ว
 * · **ต้องรันหลัง `reconcileQuotationOdooLinks()`** เพราะสัญญาณ B อ่าน `odoo_imported_at` ที่ตัวนั้นเขียน
 * · รัน A ก่อน B ⇒ แถวที่ทั้งสองยืนยันได้ ได้ id ฝั่ง Odoo ติดมาด้วย
 */
export async function reconcileLocalProductOdooLinks(): Promise<
  { product_sync: number; imported_order: number; pending: number } | null
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

    const bySync = await markMatchedByProductSync();
    const byOrder = await markMatchedByImportedOrder();
    const pending = await countPendingLocalProducts();

    if (bySync || byOrder) {
      slog(`สินค้าเพิ่มเองเข้า Odoo แล้ว ${bySync + byOrder} รายการ ` +
           `(จากรอบ sync ${bySync} · จากใบที่นำเข้า ${byOrder}) · ยังค้าง ${pending}`);
    }
    return { product_sync: bySync, imported_order: byOrder, pending };
  } catch (err) {
    swarn(`จับคู่สินค้าเพิ่มเองกับ Odoo ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
