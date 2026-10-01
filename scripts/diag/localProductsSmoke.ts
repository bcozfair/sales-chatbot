/**
 * npm run diag:local-products — ด่านของโมดูล "สินค้าเพิ่มเอง" (docs/plan-local-products.md §10)
 *
 * ก้อน J1 มีข้อ 6–7 (ตัวกวาดตอน sync + reconcile + ทับรหัสตาม Odoo) · ข้อ 1–5 และ 8–19 เติมตามเฟสที่ลงโค้ด
 *
 * ── ทำบนตารางชั่วคราวที่ "บัง" ของจริง แล้ว ROLLBACK เสมอ ────────────────────────────
 * `CREATE TEMP TABLE products / local_products / quotations` ใน transaction เดียว ⇒ SQL ที่ไม่ใส่
 * `public.` (db/localProductsRepo.ts · upsertProductRows ของ sync) เห็นตารางชั่วคราวก่อน
 * ⇒ ไม่ต้องรัน migration กับฐานจริงก็พิสูจน์ได้ · ฆ่ากลางคัน = Postgres rollback ให้เอง
 * ⇒ อยู่กลุ่ม "เขียนแล้ว ROLLBACK" ของ AGENTS.md B2 **รันบน PMSV ได้**
 * **ห้ามเปลี่ยน ROLLBACK เป็น COMMIT** · ข้อ 0 หยุดทั้งด่านก่อนเขียนถ้าตารางที่เห็นไม่ใช่ของชั่วคราว
 */
import type pg from 'pg';
import { pool } from '../../config/db.js';
import {
  countPendingLocalProducts, deleteMatchedLocalProductRows, markMatchedFromProducts,
  rewriteQuotationItemsForMatches, sweepShadowedLocalProducts,
} from '../../db/localProductsRepo.js';
import { reconcileLocalProductOdooLinks } from '../../services/localProducts.js';
import { upsertProductRows } from '../sync/syncProducts.js';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail?: string): void => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}${detail ? `  —  ${detail}` : ''}`);
};
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`);

// เลขที่ไม่มีทางชนของจริง (ตารางเป็นของชั่วคราวอยู่แล้ว แต่กันคนอ่าน log สับสน)
const REF_A = 'FZZP9ZZZ990001';   // Odoo ส่งรหัสเดียวกันกลับมา (+ มีอีกแถวที่ model ตรง ⇒ รหัสต้องชนะ)
const REF_B = 'FZZP9ZZZ990002';   // แอดมินคีย์เข้า Odoo ด้วยรหัสอื่น แต่ model เดียวกัน
const REF_C = 'FZZP9ZZZ990003';   // ยังไม่เข้า Odoo — ต้องไม่ถูกแตะ
const REF_E = 'FZZP9ZZZ990005';   // model ตรงกับแถว Odoo สองแถว ⇒ เอา id ใหม่สุด
const LOCAL_A = 900000001;
const LOCAL_B = 900000002;
const LOCAL_C = 900000003;
const LOCAL_E = 900000005;
const ODOO_A = 170001;

/** แถวหน้าตาเดียวกับ payload ของ gateway — เฉพาะช่องที่ upsertProductRows อ่าน */
function gatewayRow(id: number, ref: string, model: string) {
  return {
    'Product Template ID': id, 'Internal Reference': ref, 'Name': `Odoo ${model}`, 'Model': model,
    'Sales Price': '100', 'Minimum Sales Price': '70', 'Production': 'Production 2(PM)',
  };
}

async function setup(c: pg.PoolClient): Promise<void> {
  await c.query(`CREATE TEMP TABLE products (LIKE public.products INCLUDING ALL) ON COMMIT DROP`);
  // ฐานที่ยังไม่รัน migration 2026-10-01_01 ไม่มีคอลัมน์นี้ — เติมให้ตารางชั่วคราวด้วยนิยามเดียวกัน
  await c.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'odoo'`);
  await c.query(`
    CREATE TEMP TABLE local_products (
      product_template_id integer PRIMARY KEY, internal_reference text NOT NULL, model text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      odoo_matched_at timestamptz, odoo_matched_template_id integer, odoo_matched_by text
    ) ON COMMIT DROP`);
  await c.query(`CREATE TEMP TABLE quotations (LIKE public.quotations INCLUDING ALL) ON COMMIT DROP`);
}

/** ข้อ 0 — ตารางที่ SQL เห็นต้องเป็นของชั่วคราวทั้งคู่ ไม่งั้นหยุดก่อนเขียนอะไร */
async function assertShadowed(c: pg.PoolClient): Promise<boolean> {
  const { rows } = await c.query<{ t: string; temp: boolean }>(`
    SELECT t, (to_regclass(t)::oid IN (SELECT oid FROM pg_class WHERE relpersistence = 't')) AS temp
      FROM unnest(ARRAY['products', 'local_products', 'quotations']) AS t`);
  const ok = rows.every((r) => r.temp);
  check('ข้อ 0 · products / local_products / quotations ที่ SQL เห็นเป็นตารางชั่วคราวทั้งหมด', ok,
    rows.map((r) => `${r.t}=${r.temp ? 'temp' : 'จริง!'}`).join(' '));
  return ok;
}

async function insertLocal(c: pg.PoolClient, id: number, ref: string, model: string): Promise<void> {
  await c.query(
    `INSERT INTO products (product_template_id, internal_reference, name, model, source,
                           sales_price, minimum_sales_price, quantity_on_hand,
                           quantity_on_hand_unreserved, actual_quantity, incoming, outgoing)
     VALUES ($1, $2, $3, $3, 'local', 100, 70, 0, 0, 0, 0, 0)`,
    [id, ref, model]
  );
  await c.query(
    `INSERT INTO local_products (product_template_id, internal_reference, model) VALUES ($1, $2, $3)`,
    [id, ref, model]
  );
}

/** แถวที่ "Odoo ส่งมา" โดยตรง — source ได้ 'odoo' จาก DEFAULT เหมือนที่ sync เขียน */
async function insertOdoo(c: pg.PoolClient, id: number, ref: string, model: string): Promise<void> {
  await c.query(
    `INSERT INTO products (product_template_id, internal_reference, name, model)
     VALUES ($1, $2, $3, $3)`,
    [id, ref, model]
  );
}

/** อ่านทะเบียนด้วย id — รหัสถูกทับได้ จึงใช้รหัสเป็นกุญแจหาไม่ได้ */
async function registry(c: pg.PoolClient, id: number) {
  const { rows } = await c.query<{
    internal_reference: string; odoo_matched_by: string | null; odoo_matched_template_id: number | null;
  }>(`SELECT internal_reference, odoo_matched_by, odoo_matched_template_id
        FROM local_products WHERE product_template_id = $1`, [id]);
  return rows[0];
}

/** ใบทดสอบ — updated_at ตั้งย้อนหลังไว้ เพื่อพิสูจน์ว่าตัวทับไม่แตะมัน */
async function insertQuote(c: pg.PoolClient, no: string, status: string, items: unknown): Promise<number> {
  const { rows } = await c.query<{ id: number }>(
    `INSERT INTO quotations (quotation_no, status, item_details, updated_at)
     VALUES ($1, $2, $3::jsonb, '2026-01-01T00:00:00Z') RETURNING id`,
    [no, status, items === null ? null : JSON.stringify(items)]);
  return rows[0]!.id;
}
const quoteItems = async (c: pg.PoolClient, id: number): Promise<any> =>
  (await c.query(`SELECT item_details FROM quotations WHERE id = $1`, [id])).rows[0]?.item_details;
const quoteUpdatedAt = async (c: pg.PoolClient, id: number): Promise<string> =>
  (await c.query(`SELECT updated_at::text AS u FROM quotations WHERE id = $1`, [id])).rows[0]?.u;
const localRowExists = async (c: pg.PoolClient, id: number): Promise<boolean> =>
  (await c.query(`SELECT 1 FROM products WHERE product_template_id = $1 AND source = 'local'`, [id])).rows.length > 0;

const c = await pool.connect();
try {
  await c.query('BEGIN');
  await setup(c);
  if (!(await assertShadowed(c))) throw new Error('ตารางไม่ได้ถูกบัง — หยุดก่อนเขียน');

  await insertLocal(c, LOCAL_A, REF_A, 'ZZ-99 local A');
  await insertLocal(c, LOCAL_B, REF_B, 'ZZ-99 local B');
  await insertLocal(c, LOCAL_C, REF_C, 'ZZ-99 local C');
  await insertLocal(c, LOCAL_E, REF_E, 'ZZ-99 local E');

  // ── ข้อ 6 · ตัวกวาด ───────────────────────────────────────────────────────
  section('ข้อ 6 · Odoo ส่งรหัสเดียวกับแถว local กลับมา — sync ต้องไม่ชน');

  // ชุดควบคุม: ไม่กวาด ⇒ ต้องชน unique index จริง ไม่งั้นข้อนี้ไม่ได้พิสูจน์อะไร
  await c.query('SAVEPOINT ctl');
  let collided = false;
  try {
    await upsertProductRows(c, [gatewayRow(ODOO_A, REF_A, 'ZZ-99 odoo A')], false);
  } catch (e) {
    collided = (e as { code?: string })?.code === '23505';
  }
  await c.query('ROLLBACK TO SAVEPOINT ctl');
  check('ชุดควบคุม · ไม่กวาด ⇒ upsert ชน unique index (23505) — อาการที่ §6.1 ทำนายไว้', collided);

  let threw: unknown = null;
  try {
    await upsertProductRows(c, [gatewayRow(ODOO_A, REF_A, 'ZZ-99 odoo A')], true);
  } catch (e) { threw = e; }
  check('กวาดก่อน ⇒ upsert ผ่าน', threw === null, threw ? String((threw as Error).message) : undefined);

  const { rows: afterA } = await c.query<{ product_template_id: number; source: string }>(
    `SELECT product_template_id, source FROM products WHERE internal_reference = $1`, [REF_A]);
  check('รหัสนั้นเหลือแถวเดียว และเป็นของ Odoo',
    afterA.length === 1 && afterA[0]!.product_template_id === ODOO_A && afterA[0]!.source === 'odoo',
    JSON.stringify(afterA));

  const { rows: keepC } = await c.query(`SELECT 1 FROM products WHERE product_template_id = $1 AND source = 'local'`, [LOCAL_C]);
  check('แถว local ที่รหัสไม่อยู่ในหน้านั้นไม่ถูกแตะ', keepC.length === 1);

  const none = await sweepShadowedLocalProducts(c, [], []);
  check('หน้าที่ไม่มีรหัสเลย ⇒ ไม่ยิงคำสั่ง (คืน 0)', none === 0);

  // upsert ซ้ำแถวเดิม (รอบ sync ถัดไป) ต้องไม่เปลี่ยน source กลับ และ source ไม่อยู่ในลิสต์ของ upsert
  await upsertProductRows(c, [gatewayRow(ODOO_A, REF_A, 'ZZ-99 odoo A2')], true);
  const { rows: srcAgain } = await c.query<{ source: string; model: string }>(
    `SELECT source, model FROM products WHERE product_template_id = $1`, [ODOO_A]);
  check('รอบถัดไปอัปเดตแถวเดิม source ยังเป็น odoo', srcAgain[0]?.source === 'odoo' && srcAgain[0]?.model === 'ZZ-99 odoo A2');

  // ── ข้อ 7 · reconcile ─────────────────────────────────────────────────────
  section('ข้อ 7 · ระบบรู้เองว่าเข้า Odoo แล้ว — จากตาราง products: รหัสหรือ model ตรงกัน');

  await insertOdoo(c, 170009, 'FZZP9ZZZ880009', 'ZZ-99 local A');    // model ตรงกับ A แต่ A มีรหัสตรงอยู่แล้ว
  await insertOdoo(c, 170002, 'FZZP9ZZZ880002', '  ZZ-99 local B ');  // รหัสอื่น · model ตรง (ช่องว่างหัวท้าย)
  await insertOdoo(c, 170005, 'FZZP9ZZZ880005', 'ZZ-99 local E');
  await insertOdoo(c, 170006, 'FZZP9ZZZ880006', 'ZZ-99 local E');

  // ใบที่อ้างสินค้า local — สถานะต่างกัน (เจ้าของเคาะ "ทุกใบ") · ชนิดของ id ต่างกัน (เลข/สตริง)
  const qB = await insertQuote(c, 'QP-T-0001', 'confirmed', [
    { model: 'ZZ-99 local B', internal_reference: REF_B, product_id: LOCAL_B, name: 'ชื่อเดิม B', price: 123 },
    { model: 'OPT-1', internal_reference: 'FOPTXXXXXX0001', product_id: 5555, is_optional: true,
      linked_to_product_id: LOCAL_B },
    { model: 'NORMAL-1', internal_reference: 'FNORMALXXX0001', product_id: 4444 },
  ]);
  const qBstr = await insertQuote(c, 'QP-T-0002', 'cancelled', [
    { model: 'ZZ-99 local B', internal_reference: REF_B, product_id: String(LOCAL_B) },
  ]);
  const qA = await insertQuote(c, null as unknown as string, 'draft', [
    { model: 'ZZ-99 local A', internal_reference: REF_A, product_id: LOCAL_A },
  ]);
  const qC = await insertQuote(c, 'QP-T-0003', 'confirmed', [
    { model: 'ZZ-99 local C', internal_reference: REF_C, product_id: LOCAL_C },
  ]);
  const qNull = await insertQuote(c, 'QP-T-0004', 'confirmed', null);
  const qObj = await insertQuote(c, 'QP-T-0005', 'confirmed', { not: 'an array' });
  const cBefore = JSON.stringify(await quoteItems(c, qC));

  const matches = await markMatchedFromProducts(c);
  const nRef = matches.filter((m) => m.by === 'reference').length;
  const nModel = matches.filter((m) => m.by === 'model').length;
  check('จับคู่ได้ 3 รายการ (รหัส 1 · model 2) · C ไม่ถูกแตะ', nRef === 1 && nModel === 2,
    JSON.stringify(matches));

  const a = await registry(c, LOCAL_A);
  check('A · รหัสตรงชนะ model ตรง ⇒ by=reference · รหัสเท่าเดิม · id ของแถว Odoo ที่รหัสตรง',
    a?.odoo_matched_by === 'reference' && a.odoo_matched_template_id === ODOO_A && a.internal_reference === REF_A,
    JSON.stringify(a));

  const b = await registry(c, LOCAL_B);
  check('B · model ตรง (btrim) ⇒ by=model · ทะเบียนถูกทับเป็นรหัสของ Odoo · ไม่เหลือรหัสเดิม',
    b?.odoo_matched_by === 'model' && b.odoo_matched_template_id === 170002 && b.internal_reference === 'FZZP9ZZZ880002',
    JSON.stringify(b));
  check('B · รหัสเดิมไม่เหลือในทะเบียน',
    (await c.query(`SELECT 1 FROM local_products WHERE internal_reference = $1`, [REF_B])).rows.length === 0);

  const e = await registry(c, LOCAL_E);
  check('E · model ตรงหลายแถว ⇒ เอา id ใหม่สุด · รหัสเป็นของแถวนั้น',
    e?.odoo_matched_template_id === 170006 && e.internal_reference === 'FZZP9ZZZ880006', JSON.stringify(e));

  check('C · ยังไม่เข้า Odoo ⇒ ไม่ถูกประทับ', (await registry(c, LOCAL_C))?.odoo_matched_by === null);
  check('ยังค้างเหลือ 1 (แถว C)', (await countPendingLocalProducts(c)) === 1);

  // ── ทับรหัสในใบ ──
  const nQuotes = await rewriteQuotationItemsForMatches(c, matches);
  check('ทับในใบ 3 ใบ (B ยืนยัน · B ยกเลิก · A ร่าง) — ใบของ C / ใบที่ไม่มีรายการไม่ถูกแตะ', nQuotes === 3, `ทับ ${nQuotes}`);

  const itB = await quoteItems(c, qB);
  check('ใบ B · บรรทัดสินค้า ⇒ รหัส/ id ของ Odoo (ชนิดเลขคงเดิม) · ชื่อ ราคา model ไม่แตะ',
    itB[0].internal_reference === 'FZZP9ZZZ880002' && itB[0].product_id === 170002 &&
    itB[0].name === 'ชื่อเดิม B' && itB[0].price === 123 && itB[0].model === 'ZZ-99 local B', JSON.stringify(itB[0]));
  check('ใบ B · สินค้าเสริมที่ผูกกับบรรทัดนั้น ⇒ linked_to_product_id เป็น id ของ Odoo · ช่องอื่นไม่แตะ',
    itB[1].linked_to_product_id === 170002 && itB[1].product_id === 5555 && itB[1].internal_reference === 'FOPTXXXXXX0001',
    JSON.stringify(itB[1]));
  check('ใบ B · บรรทัดสินค้าปกติไม่แตะ · ลำดับบรรทัดคงเดิม',
    // jsonb เรียง key ใหม่เอง ⇒ เทียบทีละช่อง ไม่ใช่เทียบสตริง
    Object.keys(itB[2]).length === 3 && itB[2].model === 'NORMAL-1' &&
    itB[2].internal_reference === 'FNORMALXXX0001' && itB[2].product_id === 4444 &&
    itB.map((x: any) => x.model).join(',') === 'ZZ-99 local B,OPT-1,NORMAL-1');
  const itBs = await quoteItems(c, qBstr);
  check('ใบที่ยกเลิกก็ทับ · product_id ที่เป็นสตริงยังเป็นสตริง',
    itBs[0].internal_reference === 'FZZP9ZZZ880002' && itBs[0].product_id === '170002', JSON.stringify(itBs[0]));
  const itA = await quoteItems(c, qA);
  check('ใบ A (จับคู่ด้วยรหัส) · รหัสเท่าเดิม · product_id เป็น id ของ Odoo',
    itA[0].internal_reference === REF_A && itA[0].product_id === ODOO_A, JSON.stringify(itA[0]));
  check('ใบของ C ไม่ถูกแตะสักไบต์', JSON.stringify(await quoteItems(c, qC)) === cBefore);
  check('ใบที่ item_details เป็น null / ไม่ใช่ array ไม่พัง ไม่ถูกแตะ',
    (await quoteItems(c, qNull)) === null && JSON.stringify(await quoteItems(c, qObj)) === '{"not":"an array"}');
  check('ไม่แตะ updated_at ของใบ (LIFF หา "ใบที่เพิ่งยืนยัน" ด้วยคอลัมน์นี้)',
    (await quoteUpdatedAt(c, qB)).startsWith('2026-01-01') && (await quoteUpdatedAt(c, qA)).startsWith('2026-01-01'));
  check('ทับซ้ำด้วยชุดว่างไม่ยิงคำสั่ง (คืน 0)', (await rewriteQuotationItemsForMatches(c, [])) === 0);

  const again = await markMatchedFromProducts(c);
  check('รันซ้ำไม่จับคู่ซ้ำ ไม่ทับซ้ำ (เดินหน้าทางเดียว)', again.length === 0);

  const removed = await deleteMatchedLocalProductRows(c);
  // A ถูกตัวกวาดลบไปแล้วตอน sync (ข้อ 6) ⇒ รอบนี้ลบ B กับ E
  check('ลบแถว local ที่เข้า Odoo แล้วออกจาก products (B · E)',
    removed === 2 && !(await localRowExists(c, LOCAL_B)) && !(await localRowExists(c, LOCAL_E)), `ลบ ${removed}`);
  check('แถว local ที่ยังไม่เข้า Odoo (C) ยังอยู่ · แถวของ Odoo ไม่ถูกแตะ',
    (await localRowExists(c, LOCAL_C)) &&
    (await c.query(`SELECT 1 FROM products WHERE product_template_id IN (170002, 170005, 170006)`)).rows.length === 3);
  const { rows: dupB } = await c.query(`SELECT count(*)::int AS n FROM products WHERE btrim(model) = 'ZZ-99 local B'`);
  check('model ของ B เหลือแถวเดียว (ของ Odoo) — ไม่มีสินค้าซ้ำในผลค้นหา', dupB[0]?.n === 1);
  check('ลบซ้ำไม่มีอะไรให้ลบ', (await deleteMatchedLocalProductRows(c)) === 0);

  // ── แถว Odoo ที่ model ตรงแต่รหัสว่าง ⇒ ไม่จับคู่ (ทับแล้วจะได้รหัสว่าง) ──
  await insertOdoo(c, 170010, '', 'ZZ-99 local C');
  check('แถว Odoo ที่รหัสว่าง ⇒ ไม่นับเป็นการจับคู่ · C ยังค้าง',
    (await markMatchedFromProducts(c)).length === 0 && (await registry(c, LOCAL_C))?.odoo_matched_by === null);

  // ── ข้อ 7b · ไม่มีตารางต้องไม่ throw (อ่านฐานจริงผ่าน pool — อีก connection) ─────────
  section('ข้อ 7b · reconcile ห้าม throw');
  const { rows: real } = await pool.query(`SELECT to_regclass('public.local_products') IS NOT NULL AS has`);
  let out: unknown = 'threw';
  try { out = await reconcileLocalProductOdooLinks(); } catch { /* ข้อนี้ล้ม */ }
  if (real[0]?.has) {
    check('ฐานนี้มีตารางแล้ว ⇒ คืนตัวเลข ไม่ throw', out !== 'threw' && out !== null, JSON.stringify(out));
  } else {
    check('ฐานนี้ยังไม่รัน migration ⇒ คืน null เงียบ ๆ ไม่ throw', out === null);
  }
} finally {
  await c.query('ROLLBACK');   // ห้ามเปลี่ยนเป็น COMMIT
  c.release();
  await pool.end();
}

console.log(`\nผ่าน ${pass} · ล้ม ${fail}`);
if (fail > 0) process.exit(1);
