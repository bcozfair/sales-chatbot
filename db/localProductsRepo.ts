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
 * "เข้า Odoo แล้วหรือยัง" — ยืนยันจากตาราง `products` อย่างเดียว (เจ้าของเคาะ 2026-10-01):
 * มีแถวของ Odoo (`source = 'odoo'`) ที่ **`internal_reference` หรือ `model` ตรงกัน**
 *
 * - ตรงทั้งสองแบบ ⇒ ถือแถวที่รหัสตรงก่อน (`by = 'reference'`) · model ตรงหลายแถว ⇒ แถวที่ id ใหม่สุด
 * - จับคู่ด้วย model ได้ แปลว่าแอดมินคีย์เข้า Odoo ด้วย **รหัสอื่น** ⇒ เก็บรหัสฝั่ง Odoo ไว้ที่
 *   `odoo_matched_reference` ให้คนแก้ใบที่ออกไปแล้วรู้ว่าต้องใช้รหัสไหน
 * - model เทียบแบบ `btrim` ทั้งสองฝั่ง — แค่ใช้เทียบ ไม่ได้เขียนค่าที่ trim แล้วกลับไปที่ไหน
 * - ไม่มีทางจับคู่ผิดตัวตั้งแต่วันสร้าง: `POST /` ปฏิเสธ model ที่ซ้ำกับ `products` ทั้งตาราง (§5)
 *   ⇒ แถว Odoo ที่ model ตรงกันโผล่มาทีหลังได้ทางเดียวคือมีคนคีย์มันเข้า Odoo
 *
 * เขียนเฉพาะแถวที่ยังว่าง ⇒ สถานะเดินหน้าทางเดียว รันซ้ำกี่รอบก็ไม่เปลี่ยนค่าเดิม
 * `UNION ALL` สองขา (ไม่ใช่ `JOIN … OR …`) ให้แต่ละขาใช้ hash join ได้ — ไม่ไล่ทั้งตารางต่อแถว
 */
export async function markMatchedFromProducts(
  executor: DbExecutor = pool,
): Promise<{ reference: number; model: number }> {
  const { rows } = await executor.query<{ by: string }>(
    `WITH cand AS (
       SELECT l.product_template_id AS local_id, p.product_template_id AS odoo_id,
              p.internal_reference AS odoo_ref, 'reference' AS by, 0 AS rank
         FROM local_products l
         JOIN products p ON p.internal_reference = l.internal_reference
        WHERE l.odoo_matched_at IS NULL AND p.source = 'odoo'
       UNION ALL
       SELECT l.product_template_id, p.product_template_id,
              p.internal_reference, 'model', 1
         FROM local_products l
         JOIN products p ON btrim(p.model) = btrim(l.model)
        WHERE l.odoo_matched_at IS NULL AND p.source = 'odoo'
     ),
     pick AS (
       SELECT DISTINCT ON (local_id) local_id, odoo_id, odoo_ref, by
         FROM cand
        ORDER BY local_id, rank, odoo_id DESC
     )
     UPDATE local_products l
        SET odoo_matched_at = NOW(),
            odoo_matched_template_id = pick.odoo_id,
            odoo_matched_reference = pick.odoo_ref,
            odoo_matched_by = pick.by
       FROM pick
      WHERE l.product_template_id = pick.local_id
      RETURNING pick.by`
  );
  return {
    reference: rows.filter((r) => r.by === 'reference').length,
    model: rows.filter((r) => r.by === 'model').length,
  };
}

/**
 * แถว local ที่เข้า Odoo แล้ว ⇒ ลบออกจาก `products` (ทะเบียนใน `local_products` อยู่ต่อเป็นหลักฐาน)
 *
 * จำเป็นเพราะการจับคู่ด้วย model: รหัสต่างกัน ⇒ ตัวกวาดตอน sync (เทียบรหัส) ไม่เห็นมัน แล้ว
 * `products` จะมี model ซ้ำสองแถว — ผลค้นหาซ้ำ และ `buildItemSnapshots()` (หาด้วย model
 * เรียงตามสต็อก) อาจหยิบรหัส local ไปใส่ใบใหม่แทนรหัสจริงของ Odoo · ใบเก่าไม่กระทบ (แผน §6.4)
 * ลบทุกแถวที่จับคู่แล้ว ไม่ใช่เฉพาะรอบนี้ ⇒ รอบที่ล้มกลางทาง รอบหน้าเก็บต่อให้เอง
 */
export async function deleteMatchedLocalProductRows(executor: DbExecutor = pool): Promise<number> {
  const res = await executor.query(
    `DELETE FROM products p
      USING local_products l
      WHERE p.source = 'local'
        AND p.product_template_id = l.product_template_id
        AND l.odoo_matched_at IS NOT NULL`
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
