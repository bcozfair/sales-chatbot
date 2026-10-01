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
 * "เข้า Odoo แล้วหรือยัง" — **`internal_reference` ตรงกับแถวของ Odoo ใน `products` เท่านั้น**
 * (เจ้าของเคาะ 2026-10-01: "ตรงไปตรงมา internal_reference ควรตรงกัน")
 *
 * - ไม่ตรง = ยังไม่นำเข้า · ไม่มีการเดาจาก model · ไม่แปลง/ไม่ทับรหัสที่ไหน
 * - model ที่ซ้ำกับแถว Odoo รหัสอื่นเป็นแค่ **ป้ายเตือนตอนอ่าน** (`findOdooModelConflicts`) ให้คนไปแก้ให้ตรง
 * - แถว local ของรหัสนั้นใน `products` ถูกตัวกวาดลบไปแล้วตั้งแต่หน้าที่ Odoo ส่งรหัสนี้มา (§6.2) ⇒
 *   ที่นี่ประทับทะเบียนอย่างเดียว (unique index ของรหัสทำให้สองแถวรหัสเดียวกันอยู่พร้อมกันไม่ได้อยู่แล้ว)
 *
 * เขียนเฉพาะแถวที่ยังว่าง ⇒ สถานะเดินหน้าทางเดียว รันซ้ำกี่รอบก็ไม่เปลี่ยนค่าเดิม
 */
export async function markMatchedFromProducts(executor: DbExecutor = pool): Promise<number> {
  const res = await executor.query(
    `UPDATE local_products l
        SET odoo_matched_at = NOW(), odoo_matched_template_id = p.product_template_id
       FROM products p
      WHERE l.odoo_matched_at IS NULL
        AND p.internal_reference = l.internal_reference
        AND p.source = 'odoo'`
  );
  return res.rowCount ?? 0;
}

export interface OdooModelConflict {
  product_template_id: number;
  internal_reference: string | null;
  name: string | null;
}

/**
 * ป้ายเตือน "model นี้ซ้ำกับ internal_reference … ใน Odoo" — **คำนวณตอนอ่าน ไม่เก็บ ไม่แปลงอะไร**
 * (เจ้าของเคาะ 2026-10-01) · แปลว่าน่าจะมีคนคีย์สินค้าตัวนี้เข้า Odoo ด้วยรหัสอื่น ⇒ คนต้องไปแก้ให้รหัสตรง
 * เทียบ model แบบ btrim (ใช้เทียบเท่านั้น)
 */
export async function findOdooModelConflicts(
  executor: DbExecutor, items: readonly { id: number; model: string; ref: string }[],
): Promise<Map<number, OdooModelConflict[]>> {
  const out = new Map<number, OdooModelConflict[]>();
  if (items.length === 0) return out;
  const { rows } = await executor.query<OdooModelConflict & { local_id: number }>(
    `WITH m AS (SELECT * FROM unnest($1::int[], $2::text[], $3::text[]) AS m(id, model, ref))
     SELECT m.id AS local_id, p.product_template_id, p.internal_reference, p.name
       FROM m JOIN products p ON btrim(p.model) = btrim(m.model)
      WHERE p.source = 'odoo' AND p.internal_reference IS DISTINCT FROM m.ref
      ORDER BY m.id, p.product_template_id DESC`,
    [items.map((x) => x.id), items.map((x) => x.model), items.map((x) => x.ref)]
  );
  for (const r of rows) {
    const list = out.get(Number(r.local_id)) ?? [];
    list.push({ product_template_id: r.product_template_id, internal_reference: r.internal_reference, name: r.name });
    out.set(Number(r.local_id), list);
  }
  return out;
}

/** จำนวนที่ยังไม่เข้า Odoo — บรรทัดสรุปท้ายรอบ sync (และตัวเลขข้างเมนูใน J4) */
export async function countPendingLocalProducts(executor: DbExecutor = pool): Promise<number> {
  const { rows } = await executor.query(
    'SELECT count(*)::int AS n FROM local_products WHERE odoo_matched_at IS NULL'
  );
  return Number(rows[0]?.n ?? 0);
}

// ════════════════════════════════════════════════════════════════════════════
//  J2 — CRUD · ออกรหัส · ต้นแบบ · รายการ (แผน §3.4 · §4 · §5 · §13)
//  ทุกฟังก์ชันรับ executor — service ส่ง client ของทรานแซกชันมา · ด่านส่ง client ที่บังตารางไว้
// ════════════════════════════════════════════════════════════════════════════

/** ช่องของสินค้าที่สืบทอดจากต้นแบบ (§13.4) — ไม่มี `production` โดยตั้งใจ (§2.1 ทางเลือก ก) */
export const INHERITED_FIELDS = [
  'brand', 'series', 'product_group', 'product_category', 'product_sub_category', 'unit_of_measure',
] as const;
export type InheritedField = (typeof INHERITED_FIELDS)[number];

export interface ProductRow {
  product_template_id: number;
  internal_reference: string;
  model: string;
  name: string | null;
  brand: string | null;
  series: string | null;
  product_group: string | null;
  product_category: string | null;
  product_sub_category: string | null;
  unit_of_measure: string | null;
  production: string | null;
  sales_price: number | null;
  source: string;
}

const PRODUCT_COLS = `product_template_id, internal_reference, model, name, brand, series, product_group,
  product_category, product_sub_category, unit_of_measure, production, sales_price::float8 AS sales_price, source`;

/** หนีอักขระพิเศษของ LIKE — key ของ model มีวงเล็บและอาจมี `_`/`%` ในวงเล็บ */
const likePrefix = (s: string): string => `${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * รหัสพี่น้องของต้นแบบ (§4.1) = รหัสใน `products` ∪ รหัสที่ยังรอเข้า Odoo ∪ `rejected_refs`
 * — กรองที่ 8 ตัวแรก (L ต่ำสุดของอัลกอริทึม) · `rejected_refs` = เลขที่ Odoo มีอยู่แล้ว (archive) ห้ามออกซ้ำ
 * · รหัสที่ถูกทับตอนจับคู่ (§8.4) ไม่อยู่ในนี้ ⇒ ออกซ้ำได้ (เจ้าของเลือก 2026-10-01)
 */
export async function loadSiblingRefs(executor: DbExecutor, parentRef: string): Promise<string[]> {
  const { rows } = await executor.query<{ r: string }>(
    `SELECT internal_reference AS r FROM products
      WHERE left(internal_reference, 8) = left($1, 8)
     UNION
     SELECT internal_reference FROM local_products
      WHERE odoo_matched_at IS NULL AND left(internal_reference, 8) = left($1, 8)
     UNION
     SELECT x FROM local_products, unnest(rejected_refs) AS x
      WHERE left(x, 8) = left($1, 8)`,
    [parentRef]
  );
  return rows.map((r) => r.r);
}

/** รหัสนี้มีคนใช้อยู่แล้วไหม — ทุกที่ที่ `loadSiblingRefs` นับ (รหัสที่คนพิมพ์ทับเอง · ด่านข้อ 4b) */
export async function isRefTaken(executor: DbExecutor, ref: string): Promise<boolean> {
  const { rows } = await executor.query(
    `SELECT 1 FROM products WHERE internal_reference = $1
     UNION ALL
     SELECT 1 FROM local_products WHERE odoo_matched_at IS NULL AND internal_reference = $1
     UNION ALL
     SELECT 1 FROM local_products WHERE $1 = ANY(rejected_refs)
     LIMIT 1`,
    [ref]
  );
  return rows.length > 0;
}

/**
 * แถวที่ model ซ้ำ — **ทั้งตาราง `products`** ไม่ใช่แค่ของ local (§5)
 * สินค้า local สต็อก 0 ⇒ ถ้า model ซ้ำ `buildItemSnapshots()` จะหยิบรหัสของอีกตัวเสมอ ⇒ ไฟล์ส่งรหัสผิดเข้า Odoo
 * เทียบแบบ btrim ให้ตรงกับเกณฑ์จับคู่ตอน sync (§6.3)
 */
export async function findProductsByModel(
  executor: DbExecutor, model: string, exceptId: number | null = null,
): Promise<ProductRow[]> {
  const { rows } = await executor.query<ProductRow>(
    `SELECT ${PRODUCT_COLS} FROM products
      WHERE btrim(model) = btrim($1) AND ($2::int IS NULL OR product_template_id <> $2)
      ORDER BY product_template_id LIMIT 5`,
    [model, exceptId]
  );
  return rows;
}

/** ผู้สมัครเป็นต้นแบบ — model ขึ้นต้นด้วย key แบบไม่มีวงเล็บ (ตัวเลือกจริงอยู่ที่ productNamePattern.ts) */
export async function findParentCandidates(executor: DbExecutor, bareKey: string): Promise<ProductRow[]> {
  const { rows } = await executor.query<ProductRow>(
    `SELECT ${PRODUCT_COLS} FROM products
      WHERE model LIKE $1 ESCAPE '\\' AND internal_reference ~ '^[A-Z0-9]{14}$' AND NOT is_system_item`,
    [likePrefix(bareKey)]
  );
  return rows;
}

export async function getProductByRef(executor: DbExecutor, ref: string): Promise<ProductRow | null> {
  const { rows } = await executor.query<ProductRow>(
    `SELECT ${PRODUCT_COLS} FROM products WHERE internal_reference = $1 LIMIT 1`, [ref]);
  return rows[0] ?? null;
}

/** สมาชิกของตระกูล (10 ตัวแรก) — ใช้หาคำนำหน้าชื่อสำรองเมื่อชื่อต้นแบบไม่เข้ารูปแบบ (§13.3) */
export async function listFamilyRows(executor: DbExecutor, familyPrefix: string): Promise<ProductRow[]> {
  const { rows } = await executor.query<ProductRow>(
    `SELECT ${PRODUCT_COLS} FROM products WHERE left(internal_reference, 10) = $1 LIMIT 2000`, [familyPrefix]);
  return rows;
}

/** ค้นต้นแบบด้วยรหัส/ชื่อ/model — คืน `production` ด้วยให้จอเตือนเรื่องกฎบล็อก (§2.1) */
export async function searchParentProducts(executor: DbExecutor, q: string, limit = 20): Promise<ProductRow[]> {
  const { rows } = await executor.query<ProductRow>(
    `SELECT ${PRODUCT_COLS} FROM products
      WHERE internal_reference ~ '^[A-Z0-9]{14}$' AND NOT is_system_item
        AND (internal_reference ILIKE $1 OR model ILIKE $1 OR name ILIKE $1)
      ORDER BY (internal_reference ILIKE $2) DESC, (model ILIKE $2) DESC, model
      LIMIT $3`,
    [`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, likePrefix(q), Math.min(Math.max(limit, 1), 50)]
  );
  return rows;
}

export interface LocalProductRecord {
  product_template_id: number;
  internal_reference: string;
  parent_reference: string | null;
  ref_tier: 'boundary' | 'max_plus_one' | 'manual';
  rejected_refs: string[];
  model: string;
  name: string;
  sales_description: string | null;
  brand: string | null;
  series: string | null;
  product_group: string | null;
  product_category: string | null;
  product_sub_category: string | null;
  unit_of_measure: string | null;
  sales_price: number;
  minimum_sales_price: number;
  price_source: 'pricebook' | 'manual';
  price_book_revision: number | null;
  pricebook_price: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  exported_at: string | null;
  odoo_matched_at: string | null;
  odoo_matched_template_id: number | null;
}

const LOCAL_COLS = `product_template_id, internal_reference, parent_reference, ref_tier, rejected_refs, model, name,
  sales_description, brand, series, product_group, product_category, product_sub_category, unit_of_measure,
  sales_price::float8 AS sales_price, minimum_sales_price::float8 AS minimum_sales_price, price_source,
  price_book_revision::float8 AS price_book_revision, pricebook_price::float8 AS pricebook_price, created_by,
  created_at, updated_at, exported_at, odoo_matched_at, odoo_matched_template_id`;

export type NewLocalProduct = Omit<LocalProductRecord,
  'product_template_id' | 'rejected_refs' | 'created_at' | 'updated_at' | 'exported_at'
  | 'odoo_matched_at' | 'odoo_matched_template_id'>;

/**
 * กันสองคนสร้างพร้อมกันแล้วได้รหัสเดียวกัน/model เดียวกัน — ล็อกระดับทรานแซกชันตัวเดียวทั้งโมดูล
 * (สร้างวันละไม่กี่ตัว ⇒ ไม่มีใครรอใคร) · ปล่อยเองตอน COMMIT/ROLLBACK
 */
export async function lockLocalProductWrites(executor: DbExecutor): Promise<void> {
  await executor.query(`SELECT pg_advisory_xact_lock(hashtext('local_products:write'))`);
}

/**
 * เขียนสองที่ (§3.4) — ทะเบียนก่อน (ได้ id จาก sequence) แล้วแถวจริงใน `products`
 * `is_system_item = false` ⇒ ค้นเจอ · สต็อกทุกช่อง 0 ตามความจริง · `production` ว่าง (§2.1)
 * ⚠️ ต้องอยู่ในทรานแซกชันเดียวกัน — ผู้เรียกเป็นคนเปิด
 */
export async function insertLocalProduct(executor: DbExecutor, rec: NewLocalProduct): Promise<LocalProductRecord> {
  const { rows } = await executor.query<LocalProductRecord>(
    `INSERT INTO local_products (internal_reference, parent_reference, ref_tier, model, name, sales_description,
       brand, series, product_group, product_category, product_sub_category, unit_of_measure,
       sales_price, minimum_sales_price, price_source, price_book_revision, pricebook_price, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING ${LOCAL_COLS}`,
    [rec.internal_reference, rec.parent_reference, rec.ref_tier, rec.model, rec.name, rec.sales_description,
      rec.brand, rec.series, rec.product_group, rec.product_category, rec.product_sub_category, rec.unit_of_measure,
      rec.sales_price, rec.minimum_sales_price, rec.price_source, rec.price_book_revision, rec.pricebook_price,
      rec.created_by]
  );
  const row = rows[0]!;
  await executor.query(
    `INSERT INTO products (product_template_id, internal_reference, name, model, sales_description,
       brand, series, product_group, product_category, product_sub_category, unit_of_measure,
       sales_price, minimum_sales_price, source, is_system_item,
       quantity_on_hand, quantity_on_hand_unreserved, actual_quantity, incoming, outgoing)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'local',false,0,0,0,0,0)`,
    [row.product_template_id, row.internal_reference, row.name, row.model, row.sales_description,
      row.brand, row.series, row.product_group, row.product_category, row.product_sub_category,
      row.unit_of_measure, row.sales_price, row.minimum_sales_price]
  );
  return row;
}

export async function getLocalProductById(
  executor: DbExecutor, id: number, forUpdate = false,
): Promise<LocalProductRecord | null> {
  const { rows } = await executor.query<LocalProductRecord>(
    `SELECT ${LOCAL_COLS} FROM local_products WHERE product_template_id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  return rows[0] ?? null;
}

export type LocalProductPatch = Partial<Pick<LocalProductRecord,
  'model' | 'name' | 'sales_description' | 'sales_price' | 'minimum_sales_price'
  | 'price_source' | 'price_book_revision' | 'pricebook_price'>>;

/** แก้สองที่พร้อมกัน — ช่องที่ `products` มีด้วยต้องตรงกันเสมอ ไม่งั้นค้นเจอกับในทะเบียนพูดคนละอย่าง */
export async function updateLocalProduct(
  executor: DbExecutor, id: number, patch: LocalProductPatch,
): Promise<LocalProductRecord | null> {
  const keys = Object.keys(patch) as (keyof LocalProductPatch)[];
  if (keys.length === 0) return getLocalProductById(executor, id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const { rows } = await executor.query<LocalProductRecord>(
    `UPDATE local_products SET ${sets.join(', ')}, updated_at = NOW()
      WHERE product_template_id = $1 RETURNING ${LOCAL_COLS}`,
    [id, ...keys.map((k) => patch[k])]
  );
  const row = rows[0];
  if (!row) return null;
  await executor.query(
    `UPDATE products SET model = $2, name = $3, sales_description = $4, sales_price = $5,
            minimum_sales_price = $6, updated_at = NOW()
      WHERE product_template_id = $1 AND source = 'local'`,
    [id, row.model, row.name, row.sales_description, row.sales_price, row.minimum_sales_price]
  );
  return row;
}

/** ออกเลขใหม่ (§1.5) — รหัสเดิมเข้า `rejected_refs` · ล้าง `exported_at` (ต้องส่งออกรหัสใหม่อีกรอบ) */
export async function replaceLocalProductRef(
  executor: DbExecutor, id: number, newRef: string, tier: LocalProductRecord['ref_tier'],
): Promise<LocalProductRecord | null> {
  const { rows } = await executor.query<LocalProductRecord>(
    `UPDATE local_products
        SET rejected_refs = array_append(rejected_refs, internal_reference),
            internal_reference = $2, ref_tier = $3, exported_at = NULL, updated_at = NOW()
      WHERE product_template_id = $1 AND odoo_matched_at IS NULL
      RETURNING ${LOCAL_COLS}`,
    [id, newRef, tier]
  );
  const row = rows[0];
  if (!row) return null;
  await executor.query(
    `UPDATE products SET internal_reference = $2, updated_at = NOW()
      WHERE product_template_id = $1 AND source = 'local'`,
    [id, newRef]
  );
  return row;
}

export async function deleteLocalProduct(executor: DbExecutor, id: number): Promise<boolean> {
  await executor.query(`DELETE FROM products WHERE product_template_id = $1 AND source = 'local'`, [id]);
  const res = await executor.query(`DELETE FROM local_products WHERE product_template_id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

/**
 * ใบที่อ้างสินค้าเหล่านี้ (นับใบ ไม่ใช่บรรทัด) — สแกน `item_details` รอบเดียวสำหรับทุกตัว
 * จับด้วยรหัส **หรือ** id เพราะบรรทัดเก่าบางแบบอาจมีอย่างใดอย่างหนึ่ง
 */
export async function countQuotationsReferencing(
  executor: DbExecutor, items: readonly { id: number; ref: string }[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (items.length === 0) return out;
  const { rows } = await executor.query<{ id: number; n: number }>(
    `WITH m AS (SELECT * FROM unnest($1::int[], $2::text[]) AS m(id, ref))
     SELECT m.id, count(DISTINCT q.id)::int AS n
       FROM quotations q
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(q.item_details) = 'array' THEN q.item_details ELSE '[]'::jsonb END) AS e(x)
       JOIN m ON m.ref = e.x->>'internal_reference' OR m.id::text = e.x->>'product_id'
      GROUP BY m.id`,
    [items.map((x) => x.id), items.map((x) => x.ref)]
  );
  for (const r of rows) out.set(Number(r.id), Number(r.n));
  return out;
}

export type LocalProductFilter = 'not_matched' | 'pending' | 'exported' | 'matched' | 'all';

const FILTER_SQL: Record<LocalProductFilter, string> = {
  not_matched: 'odoo_matched_at IS NULL',
  pending: 'odoo_matched_at IS NULL AND exported_at IS NULL',
  exported: 'odoo_matched_at IS NULL AND exported_at IS NOT NULL',
  matched: 'odoo_matched_at IS NOT NULL',
  all: 'TRUE',
};

export async function listLocalProducts(
  executor: DbExecutor,
  opts: { filter: LocalProductFilter; q?: string; limit: number; offset: number },
): Promise<{ rows: LocalProductRecord[]; total: number }> {
  const params: unknown[] = [];
  let where = FILTER_SQL[opts.filter];
  if (opts.q) {
    params.push(`%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where += ` AND (internal_reference ILIKE $1 OR model ILIKE $1 OR name ILIKE $1)`;
  }
  const { rows: cnt } = await executor.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM local_products WHERE ${where}`, params);
  params.push(opts.limit, opts.offset);
  const { rows } = await executor.query<LocalProductRecord>(
    `SELECT ${LOCAL_COLS} FROM local_products WHERE ${where}
      ORDER BY created_at DESC, product_template_id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { rows, total: Number(cnt[0]?.n ?? 0) };
}

/** ประทับว่าส่งออกไฟล์ไปคีย์ Odoo แล้ว (§4.3 `GET /export`) */
export async function markLocalProductsExported(executor: DbExecutor, ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await executor.query(
    `UPDATE local_products SET exported_at = NOW() WHERE product_template_id = ANY($1::int[])`, [ids]);
  return res.rowCount ?? 0;
}
