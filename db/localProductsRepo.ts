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

/** คู่ที่เพิ่งจับได้ในรอบนี้ — `oldRef`/`localId` มีชีวิตแค่ในทรานแซกชันนี้ (หลังจากนั้นไม่เก็บที่ไหน) */
export interface LocalProductMatch {
  localId: number;
  oldRef: string;
  odooId: number;
  odooRef: string;
  by: 'reference' | 'model';
}

/**
 * "เข้า Odoo แล้วหรือยัง" — ยืนยันจากตาราง `products` อย่างเดียว (เจ้าของเคาะ 2026-10-01):
 * มีแถวของ Odoo (`source = 'odoo'`) ที่ **`internal_reference` หรือ `model` ตรงกัน**
 * แล้ว **เขียนรหัสของ Odoo ทับรหัสในทะเบียน** (เจ้าของเคาะ 2026-10-01 · แผน §8.4)
 *
 * - ตรงทั้งสองแบบ ⇒ ถือแถวที่รหัสตรงก่อน (`by = 'reference'`) · model ตรงหลายแถว ⇒ แถวที่ id ใหม่สุด
 * - แถว Odoo ที่รหัสว่างไม่นับ — ทับแล้วจะได้รหัสว่าง ⇒ ค้างให้เห็นในรายการดีกว่า
 * - model เทียบแบบ `btrim` ทั้งสองฝั่ง — แค่ใช้เทียบ ไม่ได้เขียนค่าที่ trim แล้วกลับไปที่ไหน
 * - ไม่มีทางจับคู่ผิดตัวตั้งแต่วันสร้าง: `POST /` ปฏิเสธ model ที่ซ้ำกับ `products` ทั้งตาราง (§5)
 *   ⇒ แถว Odoo ที่ model ตรงกันโผล่มาทีหลังได้ทางเดียวคือมีคนคีย์มันเข้า Odoo
 *
 * ⚠️ **ต้องเรียกในทรานแซกชันเดียวกับ `rewriteQuotationItemsForMatches()`** — รหัสเดิมไม่ถูกเก็บไว้ที่ไหน
 *    (เจ้าของเลือก) ⇒ ถ้าทะเบียนถูกทับแล้วแต่ใบยังไม่ถูกทับ จะไม่มีอะไรเหลือให้รอบหน้าตามแก้
 *    ทำพร้อมกัน ⇒ ล้มก็ ROLLBACK ทั้งคู่ แล้วรอบหน้าจับคู่ใหม่ตั้งแต่ต้น
 *
 * เขียนเฉพาะแถวที่ยังไม่จับคู่ ⇒ สถานะเดินหน้าทางเดียว รันซ้ำกี่รอบก็ไม่เปลี่ยนค่าเดิม
 * `UNION ALL` สองขา (ไม่ใช่ `JOIN … OR …`) ให้แต่ละขาใช้ hash join ได้ — ไม่ไล่ทั้งตารางต่อแถว
 */
export async function markMatchedFromProducts(executor: DbExecutor = pool): Promise<LocalProductMatch[]> {
  const { rows } = await executor.query<{
    local_id: number; old_ref: string; odoo_id: number; odoo_ref: string; by: 'reference' | 'model';
  }>(
    `WITH cand AS (
       SELECT l.product_template_id AS local_id, l.internal_reference AS old_ref,
              p.product_template_id AS odoo_id, p.internal_reference AS odoo_ref,
              'reference' AS by, 0 AS rank
         FROM local_products l
         JOIN products p ON p.internal_reference = l.internal_reference
        WHERE l.odoo_matched_at IS NULL AND p.source = 'odoo'
       UNION ALL
       SELECT l.product_template_id, l.internal_reference,
              p.product_template_id, p.internal_reference, 'model', 1
         FROM local_products l
         JOIN products p ON btrim(p.model) = btrim(l.model)
        WHERE l.odoo_matched_at IS NULL AND p.source = 'odoo'
          AND btrim(coalesce(p.internal_reference, '')) <> ''
     ),
     pick AS (
       SELECT DISTINCT ON (local_id) local_id, old_ref, odoo_id, odoo_ref, by
         FROM cand
        ORDER BY local_id, rank, odoo_id DESC
     )
     UPDATE local_products l
        SET odoo_matched_at = NOW(),
            odoo_matched_template_id = pick.odoo_id,
            odoo_matched_by = pick.by,
            internal_reference = pick.odoo_ref,
            updated_at = NOW()
       FROM pick
      WHERE l.product_template_id = pick.local_id
      RETURNING pick.local_id, pick.old_ref, pick.odoo_id, pick.odoo_ref, pick.by`
  );
  return rows.map((r) => ({
    localId: Number(r.local_id), oldRef: r.old_ref, odooId: Number(r.odoo_id), odooRef: r.odoo_ref, by: r.by,
  }));
}

/**
 * ทับรหัสในใบเสนอราคาทุกใบให้ตรงกับ Odoo (เจ้าของเคาะ 2026-10-01 · ทุกสถานะ รวมใบที่ส่งออกแล้ว/ยกเลิก)
 *
 * แตะเฉพาะ `item_details` และเฉพาะสามช่องของบรรทัดที่อ้างสินค้าที่เพิ่งจับคู่:
 * `internal_reference` → รหัส Odoo · `product_id` → id ของ Odoo · `linked_to_product_id` ของสินค้าเสริม
 * ที่ผูกกับบรรทัดนั้น → id ของ Odoo (ไม่ทับช่องนี้ = ป้าย/การผูกสินค้าเสริมขาดเงียบ ๆ)
 * - **ชนิดของค่าคงเดิม** (เลข → เลข · สตริง → สตริง) — ฝั่งอ่านหลายจุดเทียบด้วย `===`
 * - ชื่อ · ราคา · model ไม่แตะ — เป็นข้อเท็จจริงของใบ และ PDF พิมพ์ model ไม่ใช่รหัส
 * - **ไม่แตะ `updated_at`** — `getRecentConfirmedQuotations` ใช้มันหา "ใบที่เพิ่งยืนยัน" ของ LIFF
 *   (ท่าเดียวกับสคริปต์ backfill) · แลกกับ: ระบบภายนอกที่ดึงใบแบบ incremental จะไม่เห็นการเปลี่ยนนี้
 *   จนกว่าใบจะถูกแก้ครั้งถัดไป
 */
export async function rewriteQuotationItemsForMatches(
  executor: DbExecutor,
  matches: readonly LocalProductMatch[],
): Promise<number> {
  if (matches.length === 0) return 0;
  // ค่าใหม่ในชนิดเดียวกับของเดิม — ไม่มีช่องเดิม/เป็น null ⇒ เป็นเลข
  const typed = (field: string, val: string) =>
    `CASE WHEN jsonb_typeof(t.e->'${field}') = 'string' THEN to_jsonb(${val}::text) ELSE to_jsonb(${val}) END`;
  const res = await executor.query(
    `WITH m AS (
       SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::int[]) AS m(old_ref, new_ref, old_id, new_id)
     ),
     hit AS (
       SELECT q.id
         FROM quotations q
        WHERE jsonb_typeof(q.item_details) = 'array'
          AND EXISTS (
            SELECT 1
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(q.item_details) = 'array'
                                             THEN q.item_details ELSE '[]'::jsonb END) AS x(e)
              JOIN m ON m.old_ref = x.e->>'internal_reference'
                     OR m.old_id::text = x.e->>'product_id'
                     OR m.old_id::text = x.e->>'linked_to_product_id')
     )
     UPDATE quotations q
        SET item_details = (
          SELECT jsonb_agg(
                   t.e
                   || CASE WHEN own.new_id IS NULL THEN '{}'::jsonb
                           ELSE jsonb_build_object('internal_reference', own.new_ref,
                                                   'product_id', ${typed('product_id', 'own.new_id')}) END
                   || CASE WHEN lnk.new_id IS NULL THEN '{}'::jsonb
                           ELSE jsonb_build_object('linked_to_product_id', ${typed('linked_to_product_id', 'lnk.new_id')}) END
                   ORDER BY t.ord)
            FROM jsonb_array_elements(q.item_details) WITH ORDINALITY AS t(e, ord)
            LEFT JOIN LATERAL (
              SELECT m.new_ref, m.new_id FROM m
               WHERE m.old_ref = t.e->>'internal_reference' OR m.old_id::text = t.e->>'product_id'
               LIMIT 1) own ON true
            LEFT JOIN LATERAL (
              SELECT m.new_id FROM m WHERE m.old_id::text = t.e->>'linked_to_product_id' LIMIT 1) lnk ON true
        )
       FROM hit
      WHERE q.id = hit.id`,
    [
      matches.map((x) => x.oldRef), matches.map((x) => x.odooRef),
      matches.map((x) => x.localId), matches.map((x) => x.odooId),
    ]
  );
  return res.rowCount ?? 0;
}

/**
 * แถว local ที่เข้า Odoo แล้ว ⇒ ลบออกจาก `products` (ทะเบียนใน `local_products` อยู่ต่อ)
 *
 * จำเป็นเพราะการจับคู่ด้วย model: รหัสต่างกัน ⇒ ตัวกวาดตอน sync (เทียบรหัส) ไม่เห็นมัน แล้ว
 * `products` จะมี model ซ้ำสองแถว — ผลค้นหาซ้ำ และ `buildItemSnapshots()` (หาด้วย model
 * เรียงตามสต็อก) อาจหยิบรหัส local ไปใส่ใบใหม่แทนรหัสจริงของ Odoo · ใบเก่าถูกทับรหัสแล้ว (§8.4)
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
