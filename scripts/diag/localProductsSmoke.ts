/**
 * npm run diag:local-products — ด่านของโมดูล "สินค้าเพิ่มเอง" (docs/plan-local-products.md §10)
 *
 * ก้อน J1 มีข้อ 6–7 (ตัวกวาดตอน sync + reconcile) · ข้อ 1–5 และ 8–17 เติมตามเฟสที่ลงโค้ด
 *
 * ── ทำบนตารางชั่วคราวที่ "บัง" ของจริง แล้ว ROLLBACK เสมอ ────────────────────────────
 * `CREATE TEMP TABLE products / local_products` ใน transaction เดียว ⇒ SQL ที่ไม่ใส่
 * `public.` (db/localProductsRepo.ts · upsertProductRows ของ sync) เห็นตารางชั่วคราวก่อน
 * ⇒ ไม่ต้องรัน migration กับฐานจริงก็พิสูจน์ได้ · ฆ่ากลางคัน = Postgres rollback ให้เอง
 * ⇒ อยู่กลุ่ม "เขียนแล้ว ROLLBACK" ของ AGENTS.md B2 **รันบน PMSV ได้**
 * **ห้ามเปลี่ยน ROLLBACK เป็น COMMIT** · ข้อ 0 หยุดทั้งด่านก่อนเขียนถ้าตารางที่เห็นไม่ใช่ของชั่วคราว
 */
import type pg from 'pg';
import { pool } from '../../config/db.js';
import {
  countPendingLocalProducts, deleteMatchedLocalProductRows, markMatchedFromProducts,
  sweepShadowedLocalProducts,
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
      odoo_matched_at timestamptz, odoo_matched_template_id integer,
      odoo_matched_reference text, odoo_matched_by text
    ) ON COMMIT DROP`);
}

/** ข้อ 0 — ตารางที่ SQL เห็นต้องเป็นของชั่วคราวทั้งคู่ ไม่งั้นหยุดก่อนเขียนอะไร */
async function assertShadowed(c: pg.PoolClient): Promise<boolean> {
  const { rows } = await c.query<{ t: string; temp: boolean }>(`
    SELECT t, (to_regclass(t)::oid IN (SELECT oid FROM pg_class WHERE relpersistence = 't')) AS temp
      FROM unnest(ARRAY['products', 'local_products']) AS t`);
  const ok = rows.every((r) => r.temp);
  check('ข้อ 0 · products / local_products ที่ SQL เห็นเป็นตารางชั่วคราวทั้งคู่', ok,
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

async function registry(c: pg.PoolClient, ref: string) {
  const { rows } = await c.query<{
    odoo_matched_by: string | null; odoo_matched_template_id: number | null; odoo_matched_reference: string | null;
  }>(`SELECT odoo_matched_by, odoo_matched_template_id, odoo_matched_reference
        FROM local_products WHERE internal_reference = $1`, [ref]);
  return rows[0];
}
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

  const matched = await markMatchedFromProducts(c);
  check('จับคู่ได้ 3 รายการ (รหัส 1 · model 2) · C ไม่ถูกแตะ',
    matched.reference === 1 && matched.model === 2, JSON.stringify(matched));

  const a = await registry(c, REF_A);
  check('A · รหัสตรงชนะ model ตรง ⇒ by=reference · id/รหัสของแถว Odoo ที่รหัสตรง',
    a?.odoo_matched_by === 'reference' && a.odoo_matched_template_id === ODOO_A && a.odoo_matched_reference === REF_A,
    JSON.stringify(a));

  const b = await registry(c, REF_B);
  check('B · model ตรง (เทียบแบบ btrim) ⇒ by=model · เก็บรหัสฝั่ง Odoo ที่ต่างจากรหัส local',
    b?.odoo_matched_by === 'model' && b.odoo_matched_template_id === 170002 && b.odoo_matched_reference === 'FZZP9ZZZ880002',
    JSON.stringify(b));

  const e = await registry(c, REF_E);
  check('E · model ตรงหลายแถว ⇒ เอา id ใหม่สุด', e?.odoo_matched_template_id === 170006, JSON.stringify(e));

  check('C · ยังไม่เข้า Odoo ⇒ ไม่ถูกประทับ', (await registry(c, REF_C))?.odoo_matched_by === null);
  check('ยังค้างเหลือ 1 (แถว C)', (await countPendingLocalProducts(c)) === 1);

  const again = await markMatchedFromProducts(c);
  check('รันซ้ำไม่เขียนทับ (เดินหน้าทางเดียว)', again.reference === 0 && again.model === 0);

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
