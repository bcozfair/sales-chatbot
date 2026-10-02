/**
 * localProducts — ตรรกะธุรกิจของโมดูล "สินค้าเพิ่มเอง"
 *
 * แผน: docs/plan-local-products.md · J1 = reconcile ท้ายรอบ sync (§6.3 · §7)
 * · J2 = แนะนำต้นแบบ/รหัส/ชื่อ · สร้าง/แก้/ลบ · ออกเลขใหม่ · รายการ · ไฟล์ส่งออก (§4 · §5 · §13)
 *
 * ── สองกฎที่ค้ำทั้งไฟล์ ──────────────────────────────────────────────────────
 * 1. **หน้าจอเสนอ server ตัดสิน** (§13.1) — ต้นแบบ รหัส ชื่อ ราคาขั้นต่ำ ที่จอแสดงมาจาก `suggest()` และ
 *    `createLocalProduct()` คำนวณรหัสซ้ำในทรานแซกชันเสมอ · ไม่ตรงกับที่จอส่งมา = 409 พร้อมรหัสใหม่
 * 2. **model ห้ามซ้ำกับ `products` ทั้งตาราง** (§5) — สินค้า local สต็อก 0 ⇒ ถ้าซ้ำ `buildItemSnapshots()`
 *    หยิบรหัสของอีกตัวเสมอ แล้วไฟล์ส่งรหัสผิดเข้า Odoo เงียบ ๆ · ตรวจใต้ล็อกเดียวกับการเขียน
 *
 * ── ทางที่ไม่ได้เลือก ──────────────────────────────────────────────────────────────
 * - **ปุ่มให้คนติ๊กว่า "คีย์เข้า Odoo แล้ว"** — สินค้าที่คีย์แล้วเดินกลับมาหาเราเองทางรอบ sync
 *   ปุ่มมีแต่จะสร้างสถานะที่ขัดกับความจริง (เหตุผลเดียวกับผู้ติดต่อ · เจ้าของเคาะ 2026-09-17)
 * - **import `services/pricingLab/`** เพื่อคิดราคา — ห้าม (§13.5): ปุ่มคิดราคาเรียกผ่าน HTTP
 *   ไม่งั้นโมดูลคิดราคาถอดออกทั้งก้อนไม่ได้อีก
 */
import type pg from 'pg';
import {
  markMatchedFromProducts, findOdooModelConflicts,
  countPendingLocalProducts, loadSiblingRefs, isRefTaken, findProductsByModel, findParentCandidates,
  getProductByRef, listFamilyRows, searchParentProducts, lockLocalProductWrites, insertLocalProduct,
  getLocalProductById, updateLocalProduct, replaceLocalProductRef, deleteLocalProduct,
  countQuotationsReferencing, listLocalProducts, markLocalProductsExported, INHERITED_FIELDS,
  type ProductRow, type LocalProductRecord, type LocalProductPatch, type LocalProductFilter, type OdooModelConflict,
} from '../db/localProductsRepo.js';
import { pool, withTransaction } from '../config/db.js';
import { REF_SHAPE, nextReference, describeRef, type RefBoundary } from '../utils/productRefPattern.js';
import { modelKeyBare, suggestParent, suggestName, isCustomModel } from '../utils/productNamePattern.js';
import { slog, swarn } from '../scripts/sync/syncLog.js';

/**
 * "เข้า Odoo แล้วหรือยัง" — ตอบด้วยของที่ Odoo ส่งกลับมาจริง
 *
 * **`internal_reference` ตรงกับแถวของ Odoo ใน `products` เท่านั้น** (เจ้าของเคาะ 2026-10-01:
 * "ตรงไปตรงมา internal_reference ควรตรงกัน") · ไม่ตรง = ยังไม่นำเข้า · ไม่เดาจาก model ไม่แปลง/ทับข้อมูล
 * model ที่ซ้ำกับแถว Odoo รหัสอื่น = ป้ายเตือนตอนอ่าน (`listProducts`) ให้คนไปแก้รหัสให้ตรง
 * ⇒ ต้องรันหลังรอบ sync สินค้า ซึ่งเป็นตัวเขียน `products`
 *
 * **ห้าม throw** — ถูกเรียกท้ายรอบ sync โยนออกไปจะกลืนบรรทัดสรุปรอบทั้งที่ sync สำเร็จแล้ว
 */
export async function reconcileLocalProductOdooLinks(): Promise<{ matched: number; pending: number } | null> {
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
    const pending = await countPendingLocalProducts();
    if (matched) slog(`สินค้าเพิ่มเองเข้า Odoo แล้ว ${matched} รายการ (รหัสตรง) · ยังไม่นำเข้า ${pending}`);
    return { matched, pending };
  } catch (err) {
    swarn(`จับคู่สินค้าเพิ่มเองกับ Odoo ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  J2
// ════════════════════════════════════════════════════════════════════════════

export type LocalProductErrorCode =
  | 'BAD_REQUEST' | 'NOT_FOUND' | 'DUPLICATE_MODEL' | 'REF_TAKEN' | 'REF_CHANGED' | 'REF_UNAVAILABLE' | 'LOCKED';

export class LocalProductError extends Error {
  constructor(
    public readonly code: LocalProductErrorCode,
    message: string,
    public readonly status: number,
    /** ข้อมูลประกอบให้หน้าจอตัดสินใจต่อ เช่น แถวที่ model ชน หรือรหัสใหม่ที่ควรใช้ */
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'LocalProductError';
  }
}

/**
 * ราคาขั้นต่ำที่เติมให้ = 70% ของราคาขาย ปัดเป็นสตางค์ (§13.4)
 * วัด 2026-10-01: 41,332 จาก 42,421 แถวที่มีทั้งสองราคา (97.4%) อยู่ที่ 0.70 พอดี
 * เป็น "ค่าที่เติมให้" ไม่ใช่กฎ ⇒ แก้ได้ทุกครั้ง และไม่ต้องลง DB
 */
export const MIN_PRICE_RATIO = 0.7;
export const defaultMinimumPrice = (salesPrice: number): number => Math.round(salesPrice * MIN_PRICE_RATIO * 100) / 100;

/**
 * ที่มาของราคา — **server ตัดสิน** (§13.5 · ด่านข้อ 17): `pricebook` เฉพาะเมื่อราคาขายเท่ากับราคาที่ปุ่มคิดราคาให้
 * แก้ทับแม้สตางค์เดียว ⇒ `manual` · หน้าจอไม่มีช่อง `price_source` ให้ส่งมาเอง
 */
export function decidePriceSource(salesPrice: number, pricebookPrice: number | null): 'pricebook' | 'manual' {
  return pricebookPrice !== null && Math.round(salesPrice * 100) === Math.round(pricebookPrice * 100)
    ? 'pricebook' : 'manual';
}

const MAX_LEN = { model: 200, name: 300, sales_description: 2000 } as const;

/**
 * ทรานแซกชันของ service — ปกติเปิดใหม่ด้วย `withTransaction`
 * ด่านส่ง client ที่บังตารางไว้มาเอง ⇒ ทำใต้ SAVEPOINT ของมัน (ล้มแล้วถอยเฉพาะก้อนนี้ ด่านเดินต่อได้)
 */
async function inTx<T>(db: pg.PoolClient | undefined, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!db) return withTransaction(fn);
  await db.query('SAVEPOINT local_products_op');
  try {
    const out = await fn(db);
    await db.query('RELEASE SAVEPOINT local_products_op');
    return out;
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT local_products_op');
    throw err;
  }
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** model เราเป็นต้นทาง ⇒ trim ตั้งแต่บันทึก (เหตุผลเดียวกับชื่อผู้ติดต่อใน localContacts.ts) */
function cleanModel(v: unknown): string {
  const s = text(v).trim();
  if (!s) throw new LocalProductError('BAD_REQUEST', 'ต้องกรอก model', 400);
  if (s.length > MAX_LEN.model) throw new LocalProductError('BAD_REQUEST', `model ยาวเกิน ${MAX_LEN.model} ตัวอักษร`, 400);
  return s;
}

/**
 * ชื่อ **ไม่ trim** — ชื่อที่ตั้งให้ลอกคำนำหน้าของต้นแบบทุกไบต์ (§13.3) · แค่ห้ามว่าง
 * `undefined`/ว่าง ⇒ ให้ผู้เรียกตั้งชื่อเอง
 */
function nameOrNull(v: unknown): string | null {
  const s = text(v);
  if (s.trim() === '') return null;
  if (s.length > MAX_LEN.name) throw new LocalProductError('BAD_REQUEST', `ชื่อยาวเกิน ${MAX_LEN.name} ตัวอักษร`, 400);
  return s;
}

function descriptionOrNull(v: unknown): string | null {
  const s = text(v).trim();
  if (!s) return null;
  if (s.length > MAX_LEN.sales_description) {
    throw new LocalProductError('BAD_REQUEST', `รายละเอียดยาวเกิน ${MAX_LEN.sales_description} ตัวอักษร`, 400);
  }
  return s;
}

function money(v: unknown, field: string, { required, positive }: { required: boolean; positive: boolean }): number | null {
  if (v === undefined || v === null || v === '') {
    if (required) throw new LocalProductError('BAD_REQUEST', `ต้องกรอก ${field}`, 400);
    return null;
  }
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0 || (positive && n <= 0) || n > 1e9) {
    throw new LocalProductError('BAD_REQUEST', `${field} ไม่ถูกต้อง`, 400);
  }
  return Math.round(n * 100) / 100;
}

function cleanRef(v: unknown): string {
  return text(v).trim().toUpperCase();
}

// ── แนะนำ (GET /suggest · /next-ref · /parents) ──────────────────────────────

export interface RefSuggestion {
  internal_reference: string;
  tier: RefBoundary['tier'];
  prefix_length: number;
  siblings: number;
  min: number;
  max: number;
  /** ชั้น 2 ต้องมีคำเตือนบนจอ (§1.4) */
  warning: string | null;
}

function refSuggestion(next: { ref: string; boundary: RefBoundary }): RefSuggestion {
  const b = next.boundary;
  return {
    internal_reference: next.ref,
    tier: b.tier,
    prefix_length: b.prefixLength,
    siblings: b.count,
    min: b.min,
    max: b.max,
    warning: b.tier === 'max_plus_one'
      ? `นับต่อจากกลุ่ม ${next.ref.slice(0, b.prefixLength)} ให้เฉย ๆ (เลขท้ายของกลุ่มนี้อาจเป็นเลขรุ่น) — ตรวจก่อนบันทึก`
      : null,
  };
}

/** ข้อความเมื่อออกเลขให้ไม่ได้ — ต้องบอกคนว่าให้พิมพ์เอง ไม่ใช่ปล่อยช่องว่างเงียบ ๆ */
const REF_UNAVAILABLE_TEXT =
  'ตระกูลนี้ออกเลขต่อให้ไม่ได้ (เลขท้ายคือเลขรุ่น หรือนับต่อแล้วจะกลายเป็นรหัสของรุ่นอื่น) — กรุณาพิมพ์รหัสเอง';

async function nextRefFor(db: pg.PoolClient | typeof pool, parentRef: string) {
  return nextReference(await loadSiblingRefs(db, parentRef), parentRef);
}

const inheritedOf = (row: ProductRow | null) =>
  Object.fromEntries(INHERITED_FIELDS.map((f) => [f, row?.[f] ?? null])) as Record<(typeof INHERITED_FIELDS)[number], string | null>;

const parentView = (row: ProductRow) => ({
  product_template_id: row.product_template_id,
  internal_reference: row.internal_reference,
  model: row.model,
  name: row.name,
  production: row.production,
  source: row.source,
});

/**
 * ทางหลักของฟอร์ม (§13.1) — จาก model ที่พิมพ์ คืนทุกอย่างที่จอต้องเติมให้
 *
 * `parentRef` = คนกด "เปลี่ยนต้นแบบ" ⇒ ใช้ตัวนั้นแทนตัวที่ระบบเลือก (ไม่เจอในฐาน = 400 ไม่เดาต่อ)
 * `salesPrice` = ถ้ามี คืนราคาขั้นต่ำที่เติมให้ด้วย (ตรรกะไม่อยู่ในหน้าจอ)
 */
export async function suggestLocalProduct(
  input: { model: unknown; parentRef?: unknown; salesPrice?: unknown },
  db: pg.PoolClient | typeof pool = pool,
) {
  const model = cleanModel(input.model);
  const salesPrice = money(input.salesPrice, 'ราคาขาย', { required: false, positive: false });
  const duplicate = await findProductsByModel(db, model);

  let parent: ProductRow | null = null;
  let family: ProductRow[] = [];
  let reason: 'key' | 'key_bare' | 'chosen' | null = null;
  let groupSize = 0;
  const chosen = cleanRef(input.parentRef);
  if (chosen) {
    parent = await getProductByRef(db, chosen);
    if (!parent) throw new LocalProductError('BAD_REQUEST', `ไม่พบต้นแบบรหัส ${chosen}`, 400);
    reason = 'chosen';
  } else {
    const bare = modelKeyBare(model);
    const pick = bare ? suggestParent(model, await findParentCandidates(db, bare)) : null;
    if (pick) {
      parent = pick.parent;
      family = pick.family;
      reason = pick.reason;
      groupSize = pick.groupSize;
    }
  }

  let ref: RefSuggestion | null = null;
  let refMessage: string | null = null;
  if (parent) {
    const next = await nextRefFor(db, parent.internal_reference);
    if (next) ref = refSuggestion(next);
    else refMessage = REF_UNAVAILABLE_TEXT;
    if (family.length === 0) family = await listFamilyRows(db, parent.internal_reference.slice(0, 10));
  } else {
    refMessage = 'ระบบหาต้นแบบให้ไม่ได้ — กรุณาเลือกต้นแบบเอง';
  }

  return {
    model,
    duplicate: duplicate.map(parentView),
    is_custom: isCustomModel(model),
    parent: parent ? parentView(parent) : null,
    parent_reason: reason,
    group_size: groupSize,
    ref,
    ref_message: refMessage,
    name: suggestName(model, parent, family),
    inherited: inheritedOf(parent),
    minimum_sales_price: salesPrice !== null ? defaultMinimumPrice(salesPrice) : null,
  };
}

/** พรีวิวรหัสถัดไปของต้นแบบ — **ไม่ใช่การจอง** (§1.4) */
export async function previewNextRef(parentRefRaw: unknown, db: pg.PoolClient | typeof pool = pool) {
  const parentRef = cleanRef(parentRefRaw);
  if (!REF_SHAPE.test(parentRef)) throw new LocalProductError('BAD_REQUEST', 'รหัสต้นแบบต้องเป็น 14 ตัว A-Z/0-9', 400);
  const next = await nextRefFor(db, parentRef);
  return { parent_reference: parentRef, ref: next ? refSuggestion(next) : null, ref_message: next ? null : REF_UNAVAILABLE_TEXT };
}

export async function searchParents(qRaw: unknown, db: pg.PoolClient | typeof pool = pool) {
  const q = text(qRaw).trim();
  if (q.length < 2) return { items: [] };
  return { items: (await searchParentProducts(db, q.slice(0, 100))).map(parentView) };
}

// ── สร้าง · แก้ · ลบ · ออกเลขใหม่ ────────────────────────────────────────────

/**
 * สร้างสินค้าใหม่ (§3.4 · §13) — ทุกอย่างที่จอส่งมาเป็นแค่ข้อเสนอ:
 * - รหัส: คำนวณใหม่ใต้ล็อก · ไม่ตรงกับที่จอเห็น = 409 `REF_CHANGED` พร้อมรหัสใหม่ (มีคนแทรกไปก่อน)
 *   · `ref_manual = true` = คนพิมพ์เอง ⇒ ตรวจรูป 14 ตัว + ไม่ซ้ำทุกที่ (`ref_tier = 'manual'`)
 * - model: ซ้ำกับ `products` ทั้งตาราง = 409 `DUPLICATE_MODEL` (§5)
 * - ช่องสืบทอด: ลอกจากต้นแบบที่ server อ่านเอง ไม่รับจากจอ
 * - ราคาขั้นต่ำ: ไม่ส่งมา = 70% · ที่มาของราคา: server ตัดสิน
 */
export async function createLocalProduct(body: Record<string, unknown>, adminId: number | null, db?: pg.PoolClient) {
  const model = cleanModel(body.model);
  const salesPrice = money(body.sales_price, 'ราคาขาย', { required: true, positive: true })!;
  const minimum = money(body.minimum_sales_price, 'ราคาขั้นต่ำ', { required: false, positive: false })
    ?? defaultMinimumPrice(salesPrice);
  const pricebookPrice = money(body.pricebook_price, 'ราคาจากสมุดราคา', { required: false, positive: false });
  const revRaw = Number(body.price_book_revision);
  const priceBookRevision = pricebookPrice !== null && Number.isInteger(revRaw) && revRaw > 0 ? revRaw : null;
  const refManual = body.ref_manual === true;
  const wantedRef = cleanRef(body.internal_reference);
  const parentRef = cleanRef(body.parent_reference);
  const description = descriptionOrNull(body.sales_description);
  const nameInput = nameOrNull(body.name);

  if (!parentRef && !refManual) {
    throw new LocalProductError('BAD_REQUEST', 'ต้องมีต้นแบบ หรือพิมพ์รหัสเอง', 400);
  }

  return inTx(db, async (c) => {
    await lockLocalProductWrites(c);

    const parent = parentRef ? await getProductByRef(c, parentRef) : null;
    if (parentRef && !parent) throw new LocalProductError('BAD_REQUEST', `ไม่พบต้นแบบรหัส ${parentRef}`, 400);

    const dup = await findProductsByModel(c, model);
    if (dup.length) {
      throw new LocalProductError('DUPLICATE_MODEL', `model "${model}" มีอยู่แล้วในระบบ`, 409, { rows: dup.map(parentView) });
    }

    let ref: string;
    let tier: LocalProductRecord['ref_tier'];
    if (refManual) {
      if (!REF_SHAPE.test(wantedRef)) throw new LocalProductError('BAD_REQUEST', 'รหัสต้องเป็น 14 ตัว A-Z/0-9', 400);
      if (await isRefTaken(c, wantedRef)) throw new LocalProductError('REF_TAKEN', `รหัส ${wantedRef} มีคนใช้แล้ว`, 409);
      ref = wantedRef;
      tier = 'manual';
    } else {
      const next = await nextRefFor(c, parentRef);
      if (!next) throw new LocalProductError('REF_UNAVAILABLE', REF_UNAVAILABLE_TEXT, 409);
      if (wantedRef && wantedRef !== next.ref) {
        throw new LocalProductError('REF_CHANGED', `รหัส ${wantedRef} ถูกใช้ไปแล้ว รหัสถัดไปคือ ${next.ref}`, 409,
          { ref: refSuggestion(next) });
      }
      ref = next.ref;
      tier = next.boundary.tier;
    }

    let name = nameInput;
    if (name === null) {
      const prefix10 = parent?.internal_reference.slice(0, 10);
      name = suggestName(model, parent, prefix10 ? await listFamilyRows(c, prefix10) : []);
    }

    return insertLocalProduct(c, {
      internal_reference: ref,
      parent_reference: parent?.internal_reference ?? null,
      ref_tier: tier,
      model,
      name,
      sales_description: description,
      ...inheritedOf(parent),
      sales_price: salesPrice,
      minimum_sales_price: minimum,
      price_source: decidePriceSource(salesPrice, pricebookPrice),
      price_book_revision: priceBookRevision,
      pricebook_price: pricebookPrice,
      created_by: adminId,
    });
  });
}

async function referencingCount(c: pg.PoolClient | typeof pool, row: LocalProductRecord): Promise<number> {
  return (await countQuotationsReferencing(c, [{ id: row.product_template_id, ref: row.internal_reference }]))
    .get(row.product_template_id) ?? 0;
}

/**
 * แก้ (§4.3) — สิทธิ์แก้คำนวณจากข้อมูล ไม่ใช่จากที่ใครเลือก:
 * - เข้า Odoo แล้ว ⇒ ห้ามแก้ (แถวใน `products` เป็นของ Odoo แล้ว แก้ไปก็ไม่มีผล)
 * - มีใบอ้างแล้ว ⇒ ห้ามเปลี่ยน model (ใบหาสินค้าด้วย model) · ชื่อ/ราคาแก้ได้ (ใบตรึงค่าของตัวเองไว้แล้ว)
 * - รหัสแก้ที่นี่ไม่ได้ — ใช้ "ออกเลขใหม่"
 */
export async function updateLocalProductById(id: number, body: Record<string, unknown>, db?: pg.PoolClient) {
  return inTx(db, async (c) => {
    await lockLocalProductWrites(c);
    const row = await getLocalProductById(c, id, true);
    if (!row) throw new LocalProductError('NOT_FOUND', 'ไม่พบสินค้านี้', 404);
    if (row.odoo_matched_at) throw new LocalProductError('LOCKED', 'สินค้านี้เข้า Odoo แล้ว แก้ที่นี่ไม่ได้', 409);

    const patch: LocalProductPatch = {};
    if (body.model !== undefined) {
      const model = cleanModel(body.model);
      if (model !== row.model) {
        if (await referencingCount(c, row)) {
          throw new LocalProductError('LOCKED', 'มีใบเสนอราคาอ้างสินค้านี้แล้ว เปลี่ยน model ไม่ได้', 409);
        }
        const dup = await findProductsByModel(c, model, id);
        if (dup.length) {
          throw new LocalProductError('DUPLICATE_MODEL', `model "${model}" มีอยู่แล้วในระบบ`, 409, { rows: dup.map(parentView) });
        }
        patch.model = model;
      }
    }
    if (body.name !== undefined) {
      const name = nameOrNull(body.name);
      if (name === null) throw new LocalProductError('BAD_REQUEST', 'ชื่อสินค้าว่างไม่ได้', 400);
      patch.name = name;
    }
    if (body.sales_description !== undefined) patch.sales_description = descriptionOrNull(body.sales_description);
    const salesPrice = body.sales_price !== undefined
      ? money(body.sales_price, 'ราคาขาย', { required: true, positive: true })! : row.sales_price;
    if (body.sales_price !== undefined) patch.sales_price = salesPrice;
    if (body.minimum_sales_price !== undefined) {
      patch.minimum_sales_price = money(body.minimum_sales_price, 'ราคาขั้นต่ำ', { required: false, positive: false })
        ?? defaultMinimumPrice(salesPrice);
    }
    // ที่มาของราคาคำนวณใหม่ทุกครั้งที่ราคาหรือราคาจากสมุดเปลี่ยน
    if (body.pricebook_price !== undefined) {
      const pb = money(body.pricebook_price, 'ราคาจากสมุดราคา', { required: false, positive: false });
      const rev = Number(body.price_book_revision);
      patch.pricebook_price = pb;
      patch.price_book_revision = pb !== null && Number.isInteger(rev) && rev > 0 ? rev : null;
    }
    if (patch.sales_price !== undefined || patch.pricebook_price !== undefined) {
      patch.price_source = decidePriceSource(salesPrice, patch.pricebook_price !== undefined ? patch.pricebook_price : row.pricebook_price);
    }
    return (await updateLocalProduct(c, id, patch))!;
  });
}

/** ลบ — ห้ามเมื่อมีใบอ้าง (ใบจะชี้สินค้าที่ไม่มีอยู่) หรือเข้า Odoo แล้ว (ทะเบียนคือหลักฐาน) */
export async function deleteLocalProductById(id: number, db?: pg.PoolClient): Promise<void> {
  await inTx(db, async (c) => {
    await lockLocalProductWrites(c);
    const row = await getLocalProductById(c, id, true);
    if (!row) throw new LocalProductError('NOT_FOUND', 'ไม่พบสินค้านี้', 404);
    if (row.odoo_matched_at) throw new LocalProductError('LOCKED', 'สินค้านี้เข้า Odoo แล้ว ลบไม่ได้', 409);
    const n = await referencingCount(c, row);
    if (n) throw new LocalProductError('LOCKED', `มีใบเสนอราคาอ้างสินค้านี้ ${n} ใบ ลบไม่ได้`, 409);
    await deleteLocalProduct(c, id);
  });
}

/**
 * Odoo ปฏิเสธรหัสเดิมตอนคีย์ (ซ้ำกับของที่ archive ซึ่งเรามองไม่เห็น · §1.5) ⇒ ขอเลขถัดไป
 *
 * รหัสเดิมเข้า `rejected_refs` (ห้ามออกซ้ำ) · ล้าง `exported_at` (ต้องส่งออกรหัสใหม่อีกรอบ)
 * **ห้ามเมื่อมีใบอ้างรหัสนี้แล้ว** — ระบบไม่แปลง/ทับรหัสในใบ (เจ้าของเคาะ 2026-10-01 "ตรงไปตรงมา")
 * เปลี่ยนรหัสทั้งที่ใบถือรหัสเดิมอยู่ = ใบชี้รหัสที่ไม่มีใครรู้จัก
 */
export async function reissueLocalProductRef(id: number, body: Record<string, unknown>, db?: pg.PoolClient) {
  return inTx(db, async (c) => {
    await lockLocalProductWrites(c);
    const row = await getLocalProductById(c, id, true);
    if (!row) throw new LocalProductError('NOT_FOUND', 'ไม่พบสินค้านี้', 404);
    if (row.odoo_matched_at) throw new LocalProductError('LOCKED', 'สินค้านี้เข้า Odoo แล้ว', 409);
    const n = await referencingCount(c, row);
    if (n) {
      throw new LocalProductError('LOCKED',
        `มีใบเสนอราคาอ้างรหัส ${row.internal_reference} แล้ว ${n} ใบ — เปลี่ยนรหัสไม่ได้ (ใบจะชี้รหัสที่ไม่มีอยู่)`, 409);
    }

    let ref: string;
    let tier: LocalProductRecord['ref_tier'];
    if (body.ref_manual === true) {
      ref = cleanRef(body.internal_reference);
      if (!REF_SHAPE.test(ref)) throw new LocalProductError('BAD_REQUEST', 'รหัสต้องเป็น 14 ตัว A-Z/0-9', 400);
      if (ref === row.internal_reference || await isRefTaken(c, ref)) {
        throw new LocalProductError('REF_TAKEN', `รหัส ${ref} มีคนใช้แล้ว`, 409);
      }
      tier = 'manual';
    } else {
      // รหัสปัจจุบันนับเป็นพี่น้องอยู่แล้ว (แถวรอเข้า Odoo) ⇒ เลขถัดไปไม่มีทางเป็นตัวเดิม
      const base = row.parent_reference ?? row.internal_reference;
      const next = await nextReference([...await loadSiblingRefs(c, base), row.internal_reference], base);
      if (!next) throw new LocalProductError('REF_UNAVAILABLE', REF_UNAVAILABLE_TEXT, 409);
      ref = next.ref;
      tier = next.boundary.tier;
    }
    return { product: (await replaceLocalProductRef(c, id, ref, tier))! };
  });
}

// ── รายการ · ไฟล์ส่งออก ────────────────────────────────────────────────────────

/**
 * สองสถานะเท่านั้น (เจ้าของเคาะ 2026-10-01): `imported` = Odoo มีรหัสนี้ตรงตัว · `not_imported` = ยังไม่มี
 * ส่งออกไฟล์ไปแล้วหรือยังดูที่ `exported_at` แยก · model ซ้ำกับ Odoo รหัสอื่น = `odoo_model_conflicts` (ป้ายเตือน)
 */
export type LocalProductStatus = 'imported' | 'not_imported';

export interface LocalProductView extends LocalProductRecord {
  created_by_name?: string | null;
  status: LocalProductStatus;
  quotation_count: number;
  ref_parts: ReturnType<typeof describeRef>;
  /** "model นี้ซ้ำกับ internal_reference … ใน Odoo" — ว่าง = ไม่มีป้าย */
  odoo_model_conflicts: OdooModelConflict[];
}

const statusOf = (r: LocalProductRecord): LocalProductStatus => (r.odoo_matched_at ? 'imported' : 'not_imported');

export async function listProducts(
  opts: { filter: LocalProductFilter; q?: string; limit?: number; offset?: number },
  db: pg.PoolClient | typeof pool = pool,
): Promise<{ items: LocalProductView[]; total: number; pending: number }> {
  const limit = Number.isInteger(opts.limit) && opts.limit! > 0 ? Math.min(opts.limit!, 500) : 100;
  const offset = Number.isInteger(opts.offset) && opts.offset! > 0 ? opts.offset! : 0;
  const { rows, total } = await listLocalProducts(db, { filter: opts.filter, q: opts.q, limit, offset });
  const keys = rows.map((r) => ({ id: r.product_template_id, ref: r.internal_reference, model: r.model }));
  const counts = await countQuotationsReferencing(db, keys);
  const conflicts = await findOdooModelConflicts(db, keys);
  return {
    total,
    // ตัวเลขบนหัวหน้า "N รายการยังไม่มีใน Odoo" — ไม่ขึ้นกับตัวกรอง (ท่าเดียวกับหน้าผู้ติดต่อ)
    pending: await countPendingLocalProducts(db),
    items: rows.map((r) => ({
      ...r,
      status: statusOf(r),
      quotation_count: counts.get(r.product_template_id) ?? 0,
      ref_parts: describeRef(r.internal_reference),
      odoo_model_conflicts: conflicts.get(r.product_template_id) ?? [],
    })),
  };
}

export async function getLocalProductForEdit(id: number, db: pg.PoolClient | typeof pool = pool) {
  const row = await getLocalProductById(db, id);
  if (!row) throw new LocalProductError('NOT_FOUND', 'ไม่พบสินค้านี้', 404);
  const n = await referencingCount(db, row);
  const conflicts = await findOdooModelConflicts(db, [{ id, ref: row.internal_reference, model: row.model }]);
  return {
    ...row, status: statusOf(row), quotation_count: n, ref_parts: describeRef(row.internal_reference),
    odoo_model_conflicts: conflicts.get(id) ?? [],
  };
}

/**
 * หัวคอลัมน์ไฟล์ให้ไปคีย์ Odoo (§2.2) — ⚠️ **ยังไม่ได้ยืนยันกับ template นำเข้าของ Odoo**
 * (ยังไม่มี template ฝั่งสินค้าในรีโป · เจ้าของเคาะ 2026-10-01 ให้ใช้ชุดนี้ไปก่อนแล้วปรับตามแอดมิน)
 * ใช้ชื่อตาม field label ของ Odoo ที่ gateway ส่งมา · **ไม่มี `production`** — ช่องว่างในไฟล์ import
 * จะเขียนทับค่าที่แอดมินตั้งใน Odoo ได้ (§2.1)
 */
export const PRODUCT_EXPORT_HEADERS = [
  'Internal Reference', 'Name', 'Model', 'Sales Price', 'Minimum Sales Price', 'Unit of Measure',
  'Product Group', 'Product Category', 'Product Sub Category', 'Brand', 'Series', 'Sales Description',
] as const;

export function toProductExportRows(items: readonly LocalProductRecord[]): (string | number)[][] {
  return items.map((r) => [
    r.internal_reference, r.name, r.model, r.sales_price, r.minimum_sales_price, r.unit_of_measure ?? '',
    r.product_group ?? '', r.product_category ?? '', r.product_sub_category ?? '', r.brand ?? '', r.series ?? '',
    r.sales_description ?? '',
  ]);
}

/** แถวของไฟล์ + ประทับ `exported_at` ให้แถวที่อยู่ในไฟล์ (ส่งออกได้แต่ไม่ประทับไม่ได้ — ป้ายสถานะจะโกหก) */
export async function exportProducts(
  opts: { filter: LocalProductFilter; q?: string },
  db?: pg.PoolClient,
): Promise<(string | number)[][]> {
  return inTx(db, async (c) => {
    const { rows } = await listLocalProducts(c, { filter: opts.filter, q: opts.q, limit: 1000, offset: 0 });
    await markLocalProductsExported(c, rows.filter((r) => !r.odoo_matched_at).map((r) => r.product_template_id));
    return toProductExportRows(rows);
  });
}

export async function countPending(db: pg.PoolClient | typeof pool = pool): Promise<number> {
  return countPendingLocalProducts(db);
}
