/**
 * localProductsRepo — SQL ของโมดูล "สินค้าเพิ่มเอง" (`local_products`) ทั้งหมด
 *
 * แผน: docs/plan-local-products.md — ก้อน J1 มีเฉพาะสองอย่างที่รอบ sync ต้องใช้ (ตัวกวาด §6.2 +
 * reconcile §6.3) ส่วน CRUD/รายการ/ออกรหัสมาที่ J2 · กฎ layer เหมือนทุกไฟล์ใน db/:
 * **SQL อยู่ที่นี่ที่เดียว** service/route/สคริปต์ sync ห้ามเขียนเอง
 *
 * ── ทำไมแถว local อยู่ใน `products` จริง ไม่ใช่ view คร่อม ───────────────────────────────
 * สินค้าไม่มีประตูเดียวแบบ `customers_data_view` — `products` ถูก SELECT ตรงจากหลายสิบจุด
 * ⇒ แถวจริงที่ `source = 'local'` ทำให้ค้นเจอ/ใส่ใบได้/กฎราคาทำงาน โดยไม่แก้โค้ดที่อ่านสินค้าสักบรรทัด
 * (ท่าเดียวกับบรรทัดค่าบริการ `product_template_id = -1` · migration 2026-07-22_01)
 */
import { pool, type DbExecutor } from '../config/db.js';

// ⚠️ ชื่อตารางในไฟล์นี้ **ไม่ใส่ `public.`** โดยตั้งใจ — ด่าน `diag:local-products` สร้างตารางชั่วคราว
//    ชื่อเดียวกันบังของจริงแล้ว ROLLBACK (ท่าเดียวกับ diag:pricing-db) · ใส่ `public.` เมื่อไหร่
//    ด่านจะไปเขียนตารางจริงของร้าน (ยกเว้น information_schema ซึ่งถามถึงของจริงโดยตั้งใจ)

/** สินค้า local เริ่มที่ 900,000,001 — ข้อตกลงเดียวกับ CHECK `local_products_id_range` */
export const LOCAL_PRODUCT_ID_MIN = 900000000;

/**
 * ฐานนี้รัน migration 2026-10-01_01 แล้วหรือยัง — ดูที่คอลัมน์ `products.source`
 *
 * ตัวกวาดใน sync ถามข้อนี้ **ครั้งเดียวต่อรอบ** ไม่ใช่ต่อหน้า และไม่ `ALTER` ให้เอง
 * (ขาดคอลัมน์แปลว่ายังไม่มีแถว local ให้กวาด ⇒ ข้ามได้อย่างปลอดภัย · ขึ้นโค้ดก่อน migration ได้)
 */
export async function hasLocalProductSource(executor: DbExecutor = pool): Promise<boolean> {
  const { rows } = await executor.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'source'`
  );
  return rows.length > 0;
}

/**
 * ตัวกวาด (แผน §6.2) — ลบแถว local ที่ Odoo กำลังจะส่งรหัสเดียวกันเข้ามาในหน้านี้
 *
 * ⚠️ ต้องเรียก **ก่อน** upsert ของหน้านั้น ในทรานแซกชันเดียวกัน — `idx_products_internal_reference`
 *    เป็น UNIQUE แต่ upsert ชนที่ `product_template_id` ⇒ ถ้าไม่ลบก่อน แถวของ Odoo (id ใหม่ · รหัสเดิม)
 *    ชน unique → ROLLBACK ทั้งหน้า → cursor ไม่ขยับ → ค้างจนครบ MAX_STALL_RETRIES → **sync สินค้าตายทั้งระบบ**
 *    กวาดท้ายรอบไม่ทัน เพราะการชนเกิดกลางหน้า
 *
 * 1 คำสั่งต่อหน้า (500 แถว) ไม่ใช่ต่อแถว · `idx_products_source_local` รองรับ
 * `<> ALL(ids)` กันตัวเองไว้ เผื่อ id ตรงกันโดยบังเอิญ (ช่วงเลขไม่ทับกัน แต่ไม่เสียอะไรที่จะกัน)
 *
 * แถวทะเบียนใน `local_products` **ไม่ถูกลบ** — reconcile ท้ายรอบเป็นคนประทับว่าเข้า Odoo แล้ว
 */
export async function sweepShadowedLocalProducts(
  executor: DbExecutor,
  refs: readonly string[],
  templateIds: readonly number[],
): Promise<number> {
  if (refs.length === 0) return 0;
  const res = await executor.query(
    `DELETE FROM products
      WHERE source = 'local'
        AND internal_reference = ANY($1::text[])
        AND product_template_id <> ALL($2::int[])`,
    [refs, templateIds]
  );
  return res.rowCount ?? 0;
}

/**
 * สัญญาณ A — รหัสนี้มีแถวของ Odoo ใน `products` แล้ว (รอบ sync เพิ่งเขียนมา)
 * เขียนเฉพาะแถวที่ยังว่าง ⇒ สถานะเดินหน้าทางเดียว รันซ้ำกี่รอบก็ไม่เปลี่ยนค่าเดิม
 */
export async function markMatchedByProductSync(executor: DbExecutor = pool): Promise<number> {
  const res = await executor.query(
    `UPDATE local_products l
        SET odoo_matched_at = NOW(),
            odoo_matched_template_id = p.product_template_id,
            odoo_matched_by = 'product_sync'
       FROM products p
      WHERE l.odoo_matched_at IS NULL
        AND p.internal_reference = l.internal_reference
        AND p.source = 'odoo'`
  );
  return res.rowCount ?? 0;
}

/**
 * สัญญาณ B — ใบที่มีรหัสนี้ถูกนำเข้า Odoo สำเร็จแล้ว (`odoo_imported_at` ที่
 * `reconcileQuotationOdooLinks()` เขียน) ⇒ Odoo ต้องมีสินค้ารหัสนี้แล้ว แม้รอบ sync สินค้าจะยังไม่เห็น
 * (gateway ตัด `active=false` · หรือ Production ว่างจนถูกตัวกรองของ sync ทิ้ง)
 *
 * ไม่รู้ id ฝั่ง Odoo ⇒ `odoo_matched_template_id` เป็น NULL
 * ⚠️ ใช้ `sale_orders.model` ไม่ได้ — ตารางนั้น 1 แถว = 1 ใบ ไม่ใช่ระดับบรรทัด (CLAUDE.md)
 */
export async function markMatchedByImportedOrder(executor: DbExecutor = pool): Promise<number> {
  const res = await executor.query(
    `UPDATE local_products l
        SET odoo_matched_at = NOW(),
            odoo_matched_by = 'imported_order'
      WHERE l.odoo_matched_at IS NULL
        AND EXISTS (
          SELECT 1 FROM quotations q
           WHERE q.odoo_imported_at IS NOT NULL
             AND q.created_at >= l.created_at
             AND q.item_details @> jsonb_build_array(
                   jsonb_build_object('internal_reference', l.internal_reference)))`
  );
  return res.rowCount ?? 0;
}

/** จำนวนที่ยังไม่เข้า Odoo — บรรทัดสรุปท้ายรอบ sync (และตัวเลขข้างเมนูใน J4) */
export async function countPendingLocalProducts(executor: DbExecutor = pool): Promise<number> {
  const { rows } = await executor.query(
    'SELECT count(*)::int AS n FROM local_products WHERE odoo_matched_at IS NULL'
  );
  return Number(rows[0]?.n ?? 0);
}
