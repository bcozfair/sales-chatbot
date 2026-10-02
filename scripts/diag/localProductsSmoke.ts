/**
 * npm run diag:local-products — ด่านของโมดูล "สินค้าเพิ่มเอง" (docs/plan-local-products.md §10)
 *
 * J1 = ข้อ 6–7 (ตัวกวาดตอน sync + reconcile: รหัสตรงเท่านั้น · model ซ้ำเป็นป้ายเตือน)
 * J2 = ข้อ 1–5 · 8 · 11–17 · 19 (ออกรหัส · ต้นแบบ · ชื่อ · สร้าง/แก้/ลบ · ออกเลขใหม่ · ส่งออก · ด่านสิทธิ์)
 * J3 = ข้อ 9–10 (ธง is_local_product ใน snapshot สองชั้น → เหตุ custom_product → กลุ่มในเมนูส่งออก)
 *
 * ข้อ 1 · 13 · 14 อ่าน `products` ของจริงผ่าน pool (อีก connection · SELECT อย่างเดียว) — ตัวเลขเป็นรายงาน
 * gate คือเกณฑ์ที่เขียนไว้ในแต่ละข้อ ไม่ใช่ค่าเป๊ะ (ข้อมูลโตทุกวัน · ห้ามเทียบกับ golden ที่ขึ้นกับข้อมูล)
 *
 * ── ทำบนตารางชั่วคราวที่ "บัง" ของจริง แล้ว ROLLBACK เสมอ ────────────────────────────
 * `CREATE TEMP TABLE products / local_products / quotations` ใน transaction เดียว ⇒ SQL ที่ไม่ใส่
 * `public.` (db/localProductsRepo.ts · upsertProductRows ของ sync) เห็นตารางชั่วคราวก่อน
 * ⇒ ไม่ต้องรัน migration กับฐานจริงก็พิสูจน์ได้ · ฆ่ากลางคัน = Postgres rollback ให้เอง
 * ⇒ อยู่กลุ่ม "เขียนแล้ว ROLLBACK" ของ AGENTS.md B2 **รันบน PMSV ได้**
 * **ห้ามเปลี่ยน ROLLBACK เป็น COMMIT** · ข้อ 0 หยุดทั้งด่านก่อนเขียนถ้าตารางที่เห็นไม่ใช่ของชั่วคราว
 */
import type pg from 'pg';
import { readFileSync } from 'node:fs';
import { pool } from '../../config/db.js';
import {
  countPendingLocalProducts, markMatchedFromProducts, findOdooModelConflicts, sweepShadowedLocalProducts,
} from '../../db/localProductsRepo.js';
import {
  reconcileLocalProductOdooLinks, suggestLocalProduct, listProducts, previewNextRef, createLocalProduct, updateLocalProductById,
  deleteLocalProductById, reissueLocalProductRef, exportProducts, decidePriceSource, defaultMinimumPrice,
  LocalProductError,
} from '../../services/localProducts.js';
import {
  buildRefIndex, nextReference, nextReferenceFromIndex, REF_SHAPE,
} from '../../utils/productRefPattern.js';
import {
  suggestParent, suggestName, namePrefix, modelKeyBare, isCustomModel, isCustomRef,
} from '../../utils/productNamePattern.js';
import { upsertProductRows } from '../sync/syncProducts.js';
import { buildItemSnapshots, buildOdooManualReview, enrichQuotationData } from '../../services/quotationService.js';
import { ODOO_MANUAL_BUCKET_SQL } from '../../db/repositories.js';

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
  // ตารางทะเบียนสร้างจาก **ไฟล์ migration ตรง ๆ** (เปลี่ยนแค่ชื่อให้เป็นของชั่วคราว) ⇒ CHECK/unique/default
  // ในด่านเป็นตัวเดียวกับที่จะขึ้นฐานจริงเสมอ ไม่มีสำเนาแบบให้เพี้ยน · sequence เริ่มสูงกว่า id ที่ข้อ 6–7 ตั้งเอง
  const mig = readFileSync(new URL('../../migrations/changes/2026-10-01_01_local_products.sql', import.meta.url), 'utf-8');
  const body = /CREATE TABLE IF NOT EXISTS public\.local_products \(([\s\S]*?)\n\);/.exec(mig)?.[1];
  if (!body) throw new Error('หา CREATE TABLE local_products ในไฟล์ migration ไม่เจอ');
  await c.query(`CREATE TEMP SEQUENCE local_product_template_id_seq AS integer START WITH 900000100 MINVALUE 900000001`);
  await c.query(`CREATE TEMP TABLE local_products (${body.replace(/public\.local_product_template_id_seq/g, 'local_product_template_id_seq')}) ON COMMIT DROP`);
  for (const m of mig.matchAll(/CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+)\s+ON public\.local_products ([^;]+);/g)) {
    await c.query(`CREATE ${m[1] ?? ''}INDEX ${m[2]} ON local_products ${m[3]}`);
  }
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
    `INSERT INTO local_products (product_template_id, internal_reference, model, name) VALUES ($1, $2, $3, $3)`,
    [id, ref, model]
  );
}

/** แถวที่ "Odoo ส่งมา" โดยตรง — source ได้ 'odoo' จาก DEFAULT เหมือนที่ sync เขียน */
async function insertOdoo(c: pg.PoolClient, id: number, ref: string, model: string, name: string = model,
  extra: { brand?: string; production?: string } = {}): Promise<void> {
  await c.query(
    `INSERT INTO products (product_template_id, internal_reference, name, model, brand, production, unit_of_measure)
     VALUES ($1, $2, $3, $4, $5, $6, 'Pcs')`,
    [id, ref, name, model, extra.brand ?? null, extra.production ?? null]
  );
}

/** เรียกแล้วต้องล้มด้วยรหัสที่คาดไว้ — คืน error ให้ตรวจ detail ต่อ */
async function expectError(fn: () => Promise<unknown>): Promise<LocalProductError | null> {
  try { await fn(); return null; } catch (e) { return e instanceof LocalProductError ? e : null; }
}

async function registry(c: pg.PoolClient, id: number) {
  const { rows } = await c.query<{
    internal_reference: string; odoo_matched_at: string | null; odoo_matched_template_id: number | null;
  }>(`SELECT internal_reference, odoo_matched_at, odoo_matched_template_id
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

  const swept0 = await sweepShadowedLocalProducts(c, [], []);
  check('หน้าที่ไม่มีรหัสเลย ⇒ ไม่ยิงคำสั่ง (คืน 0)', swept0 === 0);

  // upsert ซ้ำแถวเดิม (รอบ sync ถัดไป) ต้องไม่เปลี่ยน source กลับ และ source ไม่อยู่ในลิสต์ของ upsert
  await upsertProductRows(c, [gatewayRow(ODOO_A, REF_A, 'ZZ-99 odoo A2')], true);
  const { rows: srcAgain } = await c.query<{ source: string; model: string }>(
    `SELECT source, model FROM products WHERE product_template_id = $1`, [ODOO_A]);
  check('รอบถัดไปอัปเดตแถวเดิม source ยังเป็น odoo', srcAgain[0]?.source === 'odoo' && srcAgain[0]?.model === 'ZZ-99 odoo A2');

  // ── ข้อ 7 · reconcile ─────────────────────────────────────────────────────
  section('ข้อ 7 · เข้า Odoo แล้ว = internal_reference ตรงเท่านั้น · model ซ้ำ = ป้ายเตือน ไม่แปลงอะไร');

  await insertOdoo(c, 170009, 'FZZP9ZZZ880009', 'ZZ-99 local A');    // model ตรงกับ A แต่ A มีรหัสตรงอยู่แล้ว
  await insertOdoo(c, 170002, 'FZZP9ZZZ880002', '  ZZ-99 local B ');  // รหัสอื่น · model ตรง (ช่องว่างหัวท้าย)
  await insertOdoo(c, 170005, 'FZZP9ZZZ880005', 'ZZ-99 local E');
  await insertOdoo(c, 170006, 'FZZP9ZZZ880006', 'ZZ-99 local E');

  // ใบที่อ้างสินค้า local B — ต้องไม่ถูกแตะสักไบต์ (ไม่มีการแปลงรหัสอีกแล้ว)
  const qB = await insertQuote(c, 'QP-T-0001', 'confirmed', [
    { model: 'ZZ-99 local B', internal_reference: REF_B, product_id: LOCAL_B },
  ]);
  const qBefore = JSON.stringify(await quoteItems(c, qB));

  const matched = await markMatchedFromProducts(c);
  check('จับคู่ได้ 1 รายการ (A · รหัสตรง) — model ตรงไม่นับเป็นการจับคู่', matched === 1, `ได้ ${matched}`);
  const a = await registry(c, LOCAL_A);
  check('A · ประทับเข้า Odoo แล้ว · id ของแถว Odoo ที่รหัสตรง · รหัสเท่าเดิม',
    !!a?.odoo_matched_at && a.odoo_matched_template_id === ODOO_A && a.internal_reference === REF_A, JSON.stringify(a));
  const b = await registry(c, LOCAL_B);
  check('B · model ตรงแต่รหัสต่าง ⇒ ยังไม่นำเข้า · รหัสในทะเบียนไม่ถูกทับ',
    b?.odoo_matched_at === null && b.internal_reference === REF_B, JSON.stringify(b));
  check('E · ยังไม่นำเข้า', (await registry(c, LOCAL_E))?.odoo_matched_at === null);
  check('ยังไม่นำเข้าเหลือ 3 (B · C · E)', (await countPendingLocalProducts(c)) === 3);
  check('ใบที่อ้าง B ไม่ถูกแตะสักไบต์', JSON.stringify(await quoteItems(c, qB)) === qBefore);
  check('ไม่แตะ updated_at ของใบ', (await quoteUpdatedAt(c, qB)).startsWith('2026-01-01'));
  check('รันซ้ำไม่จับคู่ซ้ำ', (await markMatchedFromProducts(c)) === 0);

  const conflicts = await findOdooModelConflicts(c, [
    { id: LOCAL_B, model: 'ZZ-99 local B', ref: REF_B },
    { id: LOCAL_C, model: 'ZZ-99 local C', ref: REF_C },
    { id: LOCAL_E, model: 'ZZ-99 local E', ref: REF_E },
  ]);
  check('ป้ายเตือน · B ⇒ "model นี้ซ้ำกับ FZZP9ZZZ880002 ใน Odoo" (เทียบแบบ btrim)',
    conflicts.get(LOCAL_B)?.map((x) => x.internal_reference).join() === 'FZZP9ZZZ880002', JSON.stringify(conflicts.get(LOCAL_B)));
  check('ป้ายเตือน · E ⇒ ทั้งสองแถวของ Odoo (ใหม่สุดก่อน)',
    conflicts.get(LOCAL_E)?.map((x) => x.internal_reference).join() === 'FZZP9ZZZ880006,FZZP9ZZZ880005');
  check('ป้ายเตือน · C ไม่มีแถว Odoo model เดียวกัน ⇒ ไม่มีป้าย', !conflicts.has(LOCAL_C));
  check('แถว local ของ B · C · E ยังอยู่ใน products (ไม่มีอะไรถูกลบ/ทับ)',
    (await localRowExists(c, LOCAL_B)) && (await localRowExists(c, LOCAL_C)) && (await localRowExists(c, LOCAL_E)));
  const listed = await listProducts({ filter: 'all' }, c);
  const lb = listed.items.find((x) => x.product_template_id === LOCAL_B);
  const la = listed.items.find((x) => x.product_template_id === LOCAL_A);
  check('รายการ · A = imported · B = not_imported พร้อมป้าย model ซ้ำ',
    la?.status === 'imported' && lb?.status === 'not_imported' && lb.odoo_model_conflicts.length === 1 &&
    lb.quotation_count === 1, JSON.stringify({ a: la?.status, b: lb?.status, c: lb?.odoo_model_conflicts }));

  // 7c · สี่กลุ่มของหน้ารายการไม่ทับกัน (เจ้าของสั่ง 2026-10-02 รอบ 5) — ซ้ำชนะส่งออกแล้ว · กลุ่มซ้ำ = ป้ายเตือนทุกแถว
  //      ส่งออก B (ซ้ำ) กับ C (ไม่ซ้ำ) ชั่วคราวเพื่อพิสูจน์ลำดับ แล้วคืนค่า ⇒ ข้อหลังจากนี้เห็นสถานะเดิม
  await c.query(`UPDATE local_products SET exported_at = '2026-10-01' WHERE product_template_id = ANY($1::int[])`, [[LOCAL_B, LOCAL_C]]);
  const GROUPS = ['pending', 'exported', 'conflict', 'matched'] as const;
  const byGroup = new Map<string, number[]>();
  for (const g of GROUPS) byGroup.set(g, (await listProducts({ filter: g }, c)).items.map((x) => x.product_template_id));
  const everyone = (await listProducts({ filter: 'all' }, c)).items;
  const flat = [...byGroup.values()].flat();
  check('ข้อ 7c · สี่กลุ่มครอบทุกแถวพอดี ไม่มีแถวอยู่สองกลุ่ม',
    flat.length === everyone.length && new Set(flat).size === everyone.length,
    JSON.stringify(Object.fromEntries(byGroup)));
  const tagged = everyone.filter((x) => !x.odoo_matched_at && x.odoo_model_conflicts.length > 0).map((x) => x.product_template_id).sort();
  check('  กลุ่ม "รหัสซ้ำ/ไม่ตรง" = แถวที่มีป้ายเตือนพอดี (SQL ของกลุ่ม = findOdooModelConflicts)',
    JSON.stringify([...byGroup.get('conflict')!].sort()) === JSON.stringify(tagged) && tagged.includes(LOCAL_B) && tagged.includes(LOCAL_E),
    JSON.stringify({ group: byGroup.get('conflict'), tagged }));
  check('  ส่งออกแล้วแต่ซ้ำ ⇒ อยู่กลุ่มซ้ำ ไม่ใช่รอนำเข้า · ส่งออกแล้วไม่ซ้ำ ⇒ รอนำเข้า',
    !byGroup.get('exported')!.includes(LOCAL_B) && byGroup.get('exported')!.includes(LOCAL_C));
  check('  ตัวเลขแถบแดง (conflicts) = ขนาดกลุ่มซ้ำ ไม่ว่าเปิดกลุ่มไหน',
    (await listProducts({ filter: 'pending' }, c)).conflicts === tagged.length);
  await c.query(`UPDATE local_products SET exported_at = NULL WHERE product_template_id = ANY($1::int[])`, [[LOCAL_B, LOCAL_C]]);

  // ════════════════════════════════════════════════════════════════════════
  //  J2 — บนตารางชั่วคราวชุดเดียวกัน (ข้อมูลสังเคราะห์ล้วน ไม่ขึ้นกับฐานจริง)
  // ════════════════════════════════════════════════════════════════════════
  section('ข้อ 2–4 · ตัวออกรหัส: golden 12 เคสของ §1.4 (ข้อมูลพี่น้องสังเคราะห์ตามที่วัดไว้)');
  const span = (prefix: string, from: number, to: number, width: number, skip: number[] = []) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i).filter((n) => !skip.includes(n))
      .map((n) => prefix + String(n).padStart(width, '0'));
  // ตระกูล TGM06: 815 ตัวกระจาย 35–9122 (เลขรุ่น ไม่ใช่ตัวนับ) — ห่างกันพอที่จะไม่หนาแน่นในกลุ่มย่อยไหนเลย
  const tgm = Array.from({ length: 815 }, (_, i) => 35 + Math.round((i * (9122 - 35)) / 814));
  if (!tgm.includes(1140)) tgm[100] = 1140;
  const tgmRefs = tgm.map((n) => 'FTGP1TGM06' + String(n).padStart(4, '0'));
  const GOLDEN: [string, string[], string, string][] = [
    ['FTCP2TSK040073', span('FTCP2TSK04', 0, 2921, 4, [5, 77, 900, 1500]), 'FTCP2TSK042922', 'boundary'],
    ['FCUP2TSK040073', span('FCUP2TSK04', 0, 175, 4), 'FCUP2TSK040176', 'boundary'],
    ['FHTP2XCH021363', span('FHTP2XCH02', 0, 2328, 4, [1, 2, 3, 40, 41, 500, 501, 502, 2000]), 'FHTP2XCH022329', 'boundary'],
    ['FRDP2TSP090184', span('FRDP2TSP09', 0, 412, 4, [7, 8]), 'FRDP2TSP090413', 'boundary'],
    ['FCDT1TTM214000', span('FCDT1TTM214', 0, 8, 3), 'FCDT1TTM214009', 'boundary'],
    ['FPTT2XPD000001', span('FPTT2XPD', 0, 2, 6), 'FPTT2XPD000003', 'boundary'],
    ['FTGP1TGM060035', tgmRefs, 'FTGP1TGM069123', 'max_plus_one'],
    ['FTGP1TGM061140', tgmRefs, 'FTGP1TGM069123', 'max_plus_one'],
    ['FACBYFD1000000', ['FACBYFD1000000'], 'FACBYFD1000001', 'max_plus_one'],
    ['FACP1CONXX0000', ['FACP1CONXX0000'], 'FACP1CONXX0001', 'max_plus_one'],
    ['FTGP1TGM65129R', ['FTGP1TGM65129R', ...[96, 98, 100, 102, 104, 106, 108, 110].map((n) => 'FTGP1TGM65' + String(n).padStart(4, '0'))], 'FTGP1TGM650111', 'max_plus_one'],
    ['FCDT1PCB09W000', ['FCDT1PCB09W000'], 'FCDT1PCB09W001', 'max_plus_one'],
  ];
  for (const [parent, sibs, want, tier] of GOLDEN) {
    const got = nextReference(sibs, parent);
    check(`ข้อ 2 · ${parent} ⇒ ${want} (${tier})`, got?.ref === want && got.boundary.tier === tier,
      got ? `${got.ref} ${got.boundary.tier} L=${got.boundary.prefixLength}` : 'null');
  }
  check('ข้อ 3 · ตระกูลที่ไม่มีเลขวิ่ง (TGM06) ได้เลข **พร้อมป้าย max_plus_one** ไม่ใช่ถูกปฏิเสธ',
    nextReference(tgmRefs, 'FTGP1TGM060035')?.boundary.tier === 'max_plus_one');
  // กลุ่มที่เต็มถึง 9999 ที่ L=10 (หลวม ๆ — ไม่ผ่านชั้น 1) ⇒ ชั้น 2 ห้ามถอยไป L=9/8 แล้วออก …070000
  const full = Array.from({ length: 100 }, (_, i) => 'FAAP1BBB06' + String(i * 101).padStart(4, '0')).concat('FAAP1BBB069999');
  const shifted = nextReference(full, 'FAAP1BBB060000');
  check('ข้อ 4 · ชั้น 2 ไม่ทำให้อักขระ 9–10 (รุ่นย่อย) ขยับ — ออกไม่ได้ดีกว่าออกเป็นรหัสของรุ่นอื่น',
    shifted === null || shifted.ref.slice(0, 10) === 'FAAP1BBB06', shifted ? shifted.ref : 'null (ให้คนพิมพ์เอง)');
  check('ข้อ 4 · รหัสต้นแบบผิดรูป (มีขีด) ⇒ null ไม่ใช่ throw', nextReference(['FTGP1TGM-64009'], 'FTGP1TGM-64009') === null);

  section('ข้อ 15 · สั่งทำหรือมาตรฐาน เดาจาก -S### ใน model');
  check('`TSK-04(S2)6x50+5M-S000` = สั่งทำ', isCustomModel('TSK-04(S2)6x50+5M-S000'));
  check('`TSK-04(S2)6x50+5M` = มาตรฐาน', !isCustomModel('TSK-04(S2)6x50+5M'));

  section('ข้อ 17 · ที่มาของราคา server ตัดสิน · ราคาขั้นต่ำ 70%');
  check('ราคาเท่าสมุด ⇒ pricebook', decidePriceSource(1234.5, 1234.5) === 'pricebook');
  check('แก้ทับแม้สตางค์เดียว ⇒ manual', decidePriceSource(1234.51, 1234.5) === 'manual');
  check('ไม่ได้กดคิดราคา ⇒ manual', decidePriceSource(1000, null) === 'manual');
  check('ราคาขั้นต่ำตั้งต้น = 70% ปัดสตางค์ (333.33 ⇒ 233.33)', defaultMinimumPrice(333.33) === 233.33);

  section('ข้อ 5 · 8 · 13–14 · 19 · สร้างจริงบนตารางชั่วคราว');
  // ตระกูลสังเคราะห์: มาตรฐาน FTCP2QQQ04 (10 ตัว) · สั่งทำ FCUP2QQQ04 (3 ตัว) · คำนำหน้าชื่อมีเว้นวรรคสองช่อง
  const PFX = 'Thermocouple K Type  "Primus" ';
  for (let i = 0; i < 10; i++) {
    await insertOdoo(c, 180100 + i, `FTCP2QQQ04${String(i).padStart(4, '0')}`, `QQQ-04(S2)6x${50 + i}+5M`,
      `${PFX}QQQ-04(S2)6x${50 + i}+5M`, { brand: 'Primus', production: 'Production 2(PM)' });
  }
  for (let i = 0; i < 3; i++) {
    await insertOdoo(c, 180200 + i, `FCUP2QQQ04${String(i).padStart(4, '0')}`, `QQQ-04(S2)6x${50 + i}+5M-S00${i}`,
      `${PFX}QQQ-04(S2)6x${50 + i}+5M-S00${i}`, { brand: 'Primus', production: 'Production 2(PM)' });
  }
  const sg = await suggestLocalProduct({ model: '  QQQ-04(S2)8x100+2M ', salesPrice: '1000' }, c);
  check('suggest · มาตรฐาน ⇒ ต้นแบบในตระกูล FTCP2QQQ04 · รหัส FTCP2QQQ040010 (boundary)',
    sg.parent?.internal_reference.startsWith('FTCP2QQQ04') === true && sg.ref?.internal_reference === 'FTCP2QQQ040010' &&
    sg.ref?.tier === 'boundary', JSON.stringify({ p: sg.parent?.internal_reference, r: sg.ref }));
  check('suggest · ชื่อ = คำนำหน้าของต้นแบบทุกไบต์ (เว้นวรรคสองช่องรอด) + model ที่ trim แล้ว',
    sg.name === `${PFX}QQQ-04(S2)8x100+2M`, JSON.stringify(sg.name));
  check('suggest · ช่องสืบทอดมาจากต้นแบบ · production ไม่อยู่ในช่องสืบทอด (§2.1)',
    sg.inherited.brand === 'Primus' && sg.inherited.unit_of_measure === 'Pcs' && !('production' in sg.inherited));
  check('suggest · ราคาขั้นต่ำ 70% มาจาก server', sg.minimum_sales_price === 700);
  const sgCu = await suggestLocalProduct({ model: 'QQQ-04(S2)8x100+2M-S123' }, c);
  check('suggest · มี -S### ⇒ ต้นแบบตระกูลสั่งทำ FCUP2QQQ04 · รหัส FCUP2QQQ040003',
    sgCu.parent?.internal_reference.startsWith('FCUP2QQQ04') === true && sgCu.ref?.internal_reference === 'FCUP2QQQ040003',
    JSON.stringify({ p: sgCu.parent?.internal_reference, r: sgCu.ref?.internal_reference }));
  const sgNone = await suggestLocalProduct({ model: 'ไม่มีต้นแบบ-1' }, c);
  check('suggest · หาต้นแบบไม่ได้ ⇒ ให้คนเลือก (ไม่เดา)', sgNone.parent === null && sgNone.ref === null && !!sgNone.ref_message);
  const sgDup = await suggestLocalProduct({ model: 'QQQ-04(S2)6x50+5M' }, c);
  check('suggest · model ซ้ำ ⇒ บอกแถวที่ชน', sgDup.duplicate.length === 1);

  const created = await createLocalProduct({
    model: 'QQQ-04(S2)8x100+2M', sales_price: 1000, parent_reference: sg.parent!.internal_reference,
    internal_reference: sg.ref!.internal_reference, pricebook_price: 1000, price_book_revision: 17,
  }, 7, c);
  check('สร้าง · รหัสตามพรีวิว · ราคาขั้นต่ำ 700 · ที่มาราคา pricebook · ชื่อ/ช่องสืบทอดตั้งให้',
    created.internal_reference === 'FTCP2QQQ040010' && created.minimum_sales_price === 700 &&
    created.price_source === 'pricebook' && created.price_book_revision === 17 && created.ref_tier === 'boundary' &&
    created.name === `${PFX}QQQ-04(S2)8x100+2M` && created.brand === 'Primus' && created.created_by === 7,
    JSON.stringify(created));
  const { rows: pRow } = await c.query(
    `SELECT source, is_system_item, production, quantity_on_hand::int AS q, sales_price::float8 AS sp
       FROM products WHERE product_template_id = $1`, [created.product_template_id]);
  check('ข้อ 8 · แถวจริงใน products: source=local · ค้นเจอ (is_system_item=false) · สต็อก 0 · production ว่าง',
    pRow[0]?.source === 'local' && pRow[0]?.is_system_item === false && pRow[0]?.q === 0 &&
    pRow[0]?.production === null && pRow[0]?.sp === 1000, JSON.stringify(pRow[0]));

  // ════════════════════════════════════════════════════════════════════════
  //  ข้อ 9 · 10 — ธง is_local_product / เหตุ custom_product (J3 · §8) · ทำใน SAVEPOINT แล้วถอยคืน
  //  ใบที่สร้างตรงนี้ต้องไม่ไปทำให้ข้อ 11 ("มีใบอ้าง ⇒ ห้ามลบ") เห็นใบเกินมา
  // ════════════════════════════════════════════════════════════════════════
  section('ข้อ 9 · 10 · ธงสินค้าเพิ่มเองใน snapshot → คิวแก้มือ');
  await c.query('SAVEPOINT j3');
  const ODOO_MODEL = 'QQQ-04(S2)6x50+5M';
  const GONE_MODEL = 'QQQ-GONE-1';          // แถว local ถูกกวาดไปแล้ว — ฐานไม่มี model นี้ให้ถาม
  const raw = [
    { model: created.model, price: 1000, quantity: 1 },
    { model: ODOO_MODEL, price: 100, quantity: 2 },
    { model: created.model, price: 1000, quantity: 3 },     // รหัสเดียวกันสองบรรทัด ⇒ นับเหตุครั้งเดียว
    { model: GONE_MODEL, price: 10, quantity: 1, is_local_product: true },
    { model: 'QQQ-UNKNOWN', price: 10, quantity: 1 },
  ];
  const snaps = await buildItemSnapshots(raw, c);
  check('ข้อ 9 · snapshot: local ⇒ true · Odoo ⇒ false · ไม่มีในฐาน ⇒ ถือค่าเดิมของบรรทัด',
    snaps.map((s) => s.is_local_product).join(',') === 'true,false,true,true,false' &&
    snaps[0]?.internal_reference === created.internal_reference,
    JSON.stringify(snaps.map((s) => [s.model, s.internal_reference, s.is_local_product])));

  const enriched = await enrichQuotationData({
    id: 0, status: 'draft', item_details: snaps, customer_details: {}, employee_details: {},
    created_at: new Date().toISOString(),
  });
  check('ข้อ 9 · enrichQuotationData (whitelist ขาอ่าน) ส่งธงต่อครบ',
    enriched?.items?.map((i: any) => i.is_local_product).join(',') === 'true,false,true,true,false',
    JSON.stringify(enriched?.items?.map((i: any) => i.is_local_product)));
  // round-trip แบบ LIFF/PUT หลังสินค้าเข้า Odoo แล้ว (แถว local ถูกกวาด) — ธงของใบเดิมต้องไม่หาย
  await c.query(`DELETE FROM products WHERE product_template_id = $1`, [created.product_template_id]);
  const again = await buildItemSnapshots(enriched.items, c);
  check('ข้อ 9 · round-trip หลังแถว local ถูกกวาด ⇒ ธงยังอยู่ (สร้างใหม่จากฐานไม่ได้แล้ว)',
    again.map((s) => s.is_local_product).join(',') === 'true,false,true,true,false',
    JSON.stringify(again.map((s) => s.is_local_product)));
  // ฐานที่ยังไม่มีคอลัมน์ source (dump เก่า) — query ต้องไม่ล้ม ไม่งั้นทุกบรรทัดเสียค่าจากฐานเงียบ ๆ
  await c.query('SAVEPOINT nosrc');
  await c.query(`ALTER TABLE products DROP COLUMN source`);
  const noSrc = await buildItemSnapshots([{ model: ODOO_MODEL, price: 1, quantity: 1 }], c);
  await c.query('ROLLBACK TO SAVEPOINT nosrc');
  check('ข้อ 9 · ฐานที่ไม่มี products.source ⇒ ธง false และยังได้รหัสจากฐาน (query ไม่ล้ม)',
    noSrc[0]?.is_local_product === false && noSrc[0]?.internal_reference === 'FTCP2QQQ040000',
    JSON.stringify(noSrc[0]));

  const review = buildOdooManualReview({ ...enriched, customer_details: { payment_terms_override: '30 Days' } });
  const kinds = review?.reasons.map((r) => `${r.kind}:${r.value}`) ?? [];
  check('ข้อ 10 · ใบที่มีสินค้าเพิ่มเอง ⇒ custom_product หนึ่งเหตุต่อรหัส (ช่อง order_line/product) · เรียงก่อนเครดิต',
    kinds.join(' ') === `custom_product:${created.internal_reference} custom_product:${GONE_MODEL} payment_terms_override:30 Days` &&
    review!.reasons[0]!.field === 'order_line/product' && review!.reasons[0]!.display_message.includes(created.internal_reference),
    kinds.join(' '));
  check('ข้อ 10 · ใบปกติ (ไม่มีธง) ⇒ ไม่มีเหตุ',
    buildOdooManualReview({ item_details: snaps.filter((s) => !s.is_local_product), customer_details: {} }) === null);
  check('ข้อ 10 · ไม่มี item_details (ใบเก่า/พรีวิว) ⇒ ถอยไปอ่าน items',
    buildOdooManualReview({ items: enriched.items, customer_details: {} })?.reasons.length === 2);
  const qid = await insertQuote(c, 'QP-T-0900', 'confirmed', snaps);
  await c.query(`UPDATE quotations SET odoo_manual_review = $2::jsonb WHERE id = $1`, [qid, JSON.stringify(review)]);
  const { rows: bucket } = await c.query(`SELECT ${ODOO_MANUAL_BUCKET_SQL} AS b FROM quotations q WHERE q.id = $1`, [qid]);
  check('ข้อ 10 · เมนูส่งออกจัดใบนี้ไว้กลุ่ม custom_product (ไม่ใช่ payment_terms_override)', bucket[0]?.b === 'custom_product',
    bucket[0]?.b);
  const wqSrc = readFileSync(new URL('../../services/webQuoteService.ts', import.meta.url), 'utf-8');
  check('ข้อ 10 · โมดัลพรีวิวส่ง snapshot เข้า buildOdooManualReview ตัวเดียวกับตอนยืนยัน',
    /buildOdooManualReview\(\{[\s\S]{0,200}item_details:[^\n]*snaps/.test(wqSrc));
  await c.query('ROLLBACK TO SAVEPOINT j3');

  const dupErr = await expectError(() => createLocalProduct({
    model: ' QQQ-04(S2)6x50+5M ', sales_price: 10, parent_reference: 'FTCP2QQQ040000' }, null, c));
  check('ข้อ 5 · model ซ้ำกับแถวของ Odoo (ช่องว่างหัวท้าย) ⇒ 409 DUPLICATE_MODEL',
    dupErr?.code === 'DUPLICATE_MODEL' && dupErr.status === 409);
  const dupLocal = await expectError(() => createLocalProduct({
    model: 'QQQ-04(S2)8x100+2M', sales_price: 10, parent_reference: 'FTCP2QQQ040000' }, null, c));
  check('ข้อ 5 · model ซ้ำกับสินค้าเพิ่มเองตัวก่อน ⇒ 409', dupLocal?.code === 'DUPLICATE_MODEL');

  // 4c · พรีวิวไม่ใช่การจอง
  const preview = await previewNextRef('FTCP2QQQ040000', c);
  await createLocalProduct({ model: 'QQQ-04(S2)9x1+1M', sales_price: 50, parent_reference: 'FTCP2QQQ040000' }, null, c);
  const raced = await expectError(() => createLocalProduct({
    model: 'QQQ-04(S2)9x2+1M', sales_price: 50, parent_reference: 'FTCP2QQQ040000',
    internal_reference: preview.ref!.internal_reference }, null, c));
  check('ข้อ 4c · พรีวิวค้างไว้แล้วมีคนแทรก ⇒ 409 REF_CHANGED พร้อมรหัสใหม่ ไม่ใช่บันทึกทับ',
    raced?.code === 'REF_CHANGED' && (raced.detail as any)?.ref?.internal_reference === 'FTCP2QQQ040012',
    `${preview.ref?.internal_reference} → ${JSON.stringify(raced?.detail)}`);

  // 4b · พิมพ์รหัสเอง
  const badShape = await expectError(() => createLocalProduct({
    model: 'QQQ-M1', sales_price: 5, ref_manual: true, internal_reference: 'abc' }, null, c));
  const taken = await expectError(() => createLocalProduct({
    model: 'QQQ-M1', sales_price: 5, ref_manual: true, internal_reference: 'FTCP2QQQ040003' }, null, c));
  const manual = await createLocalProduct({
    model: 'QQQ-M1', sales_price: 5, ref_manual: true, internal_reference: 'ftcp2qqq049000' }, null, c);
  check('ข้อ 4b · พิมพ์เอง: ผิดรูป 400 · ซ้ำ 409 · ถูก ⇒ ref_tier=manual (ตัวพิมพ์เล็กแปลงเป็นใหญ่)',
    badShape?.status === 400 && taken?.code === 'REF_TAKEN' && manual.ref_tier === 'manual' &&
    manual.internal_reference === 'FTCP2QQQ049000');
  check('ข้อ 4b · ไม่มีต้นแบบ ⇒ ชื่อ = model (ไม่มีคำนำหน้าให้ลอก)', manual.name === 'QQQ-M1');

  // 17 · แก้ราคาทับ ⇒ manual
  const edited = await updateLocalProductById(created.product_template_id, { sales_price: 1100 }, c);
  check('ข้อ 17 · แก้ราคาทับราคาสมุด ⇒ price_source=manual · ราคาขั้นต่ำเดิมไม่ถูกเขียนทับ',
    edited.price_source === 'manual' && edited.minimum_sales_price === 700 && edited.sales_price === 1100);
  const { rows: pAfter } = await c.query(`SELECT sales_price::float8 AS sp FROM products WHERE product_template_id = $1`,
    [created.product_template_id]);
  check('ข้อ 17 · แก้สองที่พร้อมกัน (products ตาม)', pAfter[0]?.sp === 1100);

  // 11 · ห้ามแก้ model / ห้ามลบ เมื่อมีใบอ้าง
  await insertQuote(c, 'QP-T-0100', 'confirmed', [
    { model: created.model, internal_reference: created.internal_reference, product_id: created.product_template_id },
  ]);
  const lockModel = await expectError(() => updateLocalProductById(created.product_template_id, { model: 'QQQ-NEW' }, c));
  const lockDel = await expectError(() => deleteLocalProductById(created.product_template_id, c));
  const okName = await updateLocalProductById(created.product_template_id, { name: 'ชื่อใหม่' }, c);
  check('ข้อ 11 · มีใบอ้าง ⇒ เปลี่ยน model 409 · ลบ 409 · แก้ชื่อได้',
    lockModel?.code === 'LOCKED' && lockDel?.code === 'LOCKED' && okName.name === 'ชื่อใหม่');
  await deleteLocalProductById(manual.product_template_id, c);
  check('ข้อ 11 · ไม่มีใบอ้าง ⇒ ลบได้ทั้งสองที่',
    (await c.query(`SELECT 1 FROM local_products WHERE product_template_id = $1
                    UNION ALL SELECT 1 FROM products WHERE product_template_id = $1`, [manual.product_template_id])).rows.length === 0);

  // ออกเลขใหม่ — มีใบอ้าง ⇒ ห้าม (ไม่ทับใบ) · ไม่มีใบอ้าง ⇒ รหัสเดิมเข้า rejected_refs · exported_at ล้าง
  const reLocked = await expectError(() => reissueLocalProductRef(created.product_template_id, {}, c));
  check('ออกเลขใหม่ · มีใบอ้างรหัสนี้แล้ว ⇒ 409 LOCKED (ระบบไม่ทับรหัสในใบ)', reLocked?.code === 'LOCKED');
  const solo = await createLocalProduct({ model: 'QQQ-04(S2)9x3+1M', sales_price: 80, parent_reference: 'FTCP2QQQ040000' }, null, c);
  await c.query(`UPDATE local_products SET exported_at = NOW() WHERE product_template_id = $1`, [solo.product_template_id]);
  const re = await reissueLocalProductRef(solo.product_template_id, {}, c);
  const { rows: soloP } = await c.query(`SELECT internal_reference FROM products WHERE product_template_id = $1`, [solo.product_template_id]);
  check('ออกเลขใหม่ · ไม่มีใบอ้าง ⇒ รหัสใหม่ · เดิมเข้า rejected_refs · exported_at ล้าง · products ตาม',
    re.product.internal_reference !== solo.internal_reference && re.product.rejected_refs.includes(solo.internal_reference) &&
    re.product.exported_at === null && soloP[0]?.internal_reference === re.product.internal_reference,
    JSON.stringify({ old: solo.internal_reference, now: re.product.internal_reference, rej: re.product.rejected_refs }));

  // 19 · พี่น้องนับรหัสที่ยังไม่นำเข้า + rejected_refs (แม้แถวใน products ถูกกวาดไปแล้ว)
  await c.query(`DELETE FROM products WHERE product_template_id = $1`, [re.product.product_template_id]);
  const after = await previewNextRef('FTCP2QQQ040000', c);
  const maxSeen = Math.max(Number(re.product.internal_reference.slice(10)), Number(solo.internal_reference.slice(10)));
  check('ข้อ 19 · /next-ref ไม่ออกเลขที่ยังไม่นำเข้า หรือเลขใน rejected_refs',
    !!after.ref && Number(after.ref.internal_reference.slice(10)) > maxSeen, after.ref?.internal_reference);

  // ส่งออก
  const rowsOut = await exportProducts({ filter: 'not_matched' }, c);
  const { rows: stamped } = await c.query(`SELECT count(*)::int AS n FROM local_products WHERE exported_at IS NOT NULL`);
  check('ส่งออก · ได้แถวของที่ยังไม่เข้า Odoo (12 คอลัมน์) และประทับ exported_at ให้',
    rowsOut.length >= 2 && rowsOut.every((r) => r.length === 12) && stamped[0]?.n >= 2,
    `แถว ${rowsOut.length} · ประทับ ${stamped[0]?.n}`);

  // ════════════════════════════════════════════════════════════════════════
  //  ข้อ 12 · 16 — ด่านสิทธิ์และตัวคิดราคาตัวเดียว (อ่านซอร์ส)
  // ════════════════════════════════════════════════════════════════════════
  section('ข้อ 12 · 16 · ด่านที่จุด mount + ปุ่มคิดราคาใช้ตัวจัดการเดียวกัน');
  const indexSrc = readFileSync(new URL('../../index.ts', import.meta.url), 'utf-8');
  const pricingSrc = readFileSync(new URL('../../routes/pricingLab.ts', import.meta.url), 'utf-8');
  const gateAt = indexSrc.indexOf(`app.use('/api/admin/webquote/products', adminAuthMiddleware, requireCapability('quote.manage_products'));`);
  const routerAt = indexSrc.indexOf(`app.use('/api/admin/webquote/products', localProductsRouter);`);
  check('ข้อ 12 · ทุกเส้นใต้ /api/admin/webquote/products ผ่านด่าน quote.manage_products ก่อนถึง router',
    gateAt >= 0 && routerAt > gateAt);
  check('ข้อ 16 · POST …/products/price = pricingQuoteHandler ตัวเดียวกับ POST /api/admin/pricing/quote (ไม่มีตัวคิดราคาสองตัว)',
    /app\.post\('\/api\/admin\/webquote\/products\/price',[^\n]*requireCapability\('quote\.manage_products'\)[^\n]*pricingQuoteHandler\);/.test(indexSrc) &&
    /^pricingLabRouter\.post\('\/quote', pricingQuoteHandler\);$/m.test(pricingSrc));
  const svcSrc = readFileSync(new URL('../../services/localProducts.ts', import.meta.url), 'utf-8');
  const routeSrc = readFileSync(new URL('../../routes/localProducts.ts', import.meta.url), 'utf-8');
  check('ข้อ 16 · โมดูลนี้ไม่ import services/pricingLab (ถอดโมดูลคิดราคาได้ทั้งก้อน)',
    !/from '\.\.\/services\/pricingLab|from '\.\/pricingLab/.test(svcSrc + routeSrc));

  // ════════════════════════════════════════════════════════════════════════
  //  ข้อ 1 · 13 · 14 — อ่านฐานจริง (pool = อีก connection · SELECT อย่างเดียว)
  // ════════════════════════════════════════════════════════════════════════
  section('ข้อ 1 · ลองทุกรหัสในฐานจริงเป็นต้นแบบ');
  const { rows: realRows } = await pool.query<{ internal_reference: string; model: string; name: string | null }>(
    `SELECT internal_reference, model, name FROM products WHERE internal_reference IS NOT NULL`);
  const realRefs = realRows.map((r) => r.internal_reference);
  const realSet = new Set(realRefs);
  const realIdx = buildRefIndex(realRefs);
  let t1 = 0, t2 = 0, collide = 0, unexplained = 0;
  const noneRefs: string[] = [];
  for (const ref of realRefs) {
    const r = nextReferenceFromIndex(realIdx, ref);
    if (!r) {
      noneRefs.push(ref);
      // ออกไม่ได้ต้องมีเหตุ: รหัสผิดรูป หรือไม่มีกลุ่ม L ≥ 10 ที่นับต่อได้ (ที่เหลือคือ L=9/8 ซึ่งจะเปลี่ยนรุ่นย่อย)
      const fitsAt10Plus = [10, 11, 12, 13].some((L) => {
        const tail = ref.slice(L);
        return REF_SHAPE.test(ref) && realRefs.some((x) => x.startsWith(ref.slice(0, L)) && /^\d+$/.test(x.slice(L))
          && Number(x.slice(L)) + 1 < 10 ** (14 - L)) && tail !== undefined;
      });
      if (fitsAt10Plus) unexplained++;
      continue;
    }
    if (realSet.has(r.ref)) collide++;
    if (r.boundary.tier === 'boundary') t1++; else t2++;
  }
  const pct = (n: number) => ((100 * n) / realRefs.length).toFixed(2);
  console.log(`   ${realRefs.length} รหัส · ชั้น 1 ${t1} (${pct(t1)}%) · ชั้น 2 ${t2} (${pct(t2)}%) · ออกไม่ได้ ${noneRefs.length}`);
  check('ข้อ 1 · รหัสใหม่ชนของเดิมในฐาน 0 ตัว', collide === 0, `ชน ${collide}`);
  check('ข้อ 1 · ทุกเคสที่ออกไม่ได้มีเหตุ (รหัสผิดรูป หรือนับต่อแล้วรุ่นย่อยจะเปลี่ยน) — ให้คนพิมพ์เอง',
    unexplained === 0, `${noneRefs.length} เคส · อธิบายไม่ได้ ${unexplained} · ${noneRefs.slice(0, 5).join(' ')}`);

  section('ข้อ 13 · 14 · ต้นแบบและชื่อ — ซ่อนสินค้าทีละตัวแล้วให้ระบบเลือก (ฐานจริง)');
  const usable = realRows.filter((r) => REF_SHAPE.test(r.internal_reference) && r.model);
  const byBare = new Map<string, typeof usable>();
  for (const r of usable) {
    const b = modelKeyBare(r.model);
    if (!b) continue;
    const list = byBare.get(b);
    if (list) list.push(r); else byBare.set(b, [r]);
  }
  const acc = { cu: { n: 0, picked: 0, hit: 0 }, std: { n: 0, picked: 0, hit: 0 } };
  let nameN = 0, nameOk = 0;
  for (const r of usable) {
    const b = modelKeyBare(r.model);
    if (!b) continue;
    const a = acc[isCustomRef(r.internal_reference) ? 'cu' : 'std'];
    a.n++;
    const pick = suggestParent(r.model, byBare.get(b)!.filter((x) => x !== r));
    if (pick) {
      a.picked++;
      if (pick.familyPrefix === r.internal_reference.slice(0, 10)) a.hit++;
    }
    if (namePrefix(r.name, r.model) !== null) {
      nameN++;
      if (suggestName(r.model, r) === r.name) nameOk++;
    }
  }
  for (const [k, a] of Object.entries(acc)) {
    const hit = (100 * a.hit) / Math.max(a.picked, 1);
    console.log(`   ${k === 'cu' ? 'สั่งทำ' : 'มาตรฐาน'}: ${a.n} ตัว · เลือกให้ได้ ${a.picked} · ตระกูลตรง ${hit.toFixed(2)}% ของที่เลือกให้`);
    check(`ข้อ 13 · ${k === 'cu' ? 'สั่งทำ' : 'มาตรฐาน'} · ตระกูลที่เลือกให้ตรงของจริง ≥ 90% (ของเคสที่ระบบเลือกให้)`, hit >= 90, `${hit.toFixed(2)}%`);
  }
  check('ข้อ 14 · ใช้ตัวเองเป็นต้นแบบ ⇒ ชื่อที่ตั้งให้ = ชื่อจริงทุกแถวที่ชื่อลงท้ายด้วย model',
    nameN > 0 && nameOk === nameN, `${nameOk}/${nameN}`);
  check('ข้อ 14 · ต้นแบบชื่อไม่เข้ารูปแบบ ⇒ ใช้คำนำหน้าที่ตระกูลใช้มากสุด ไม่ใช่ว่าง',
    suggestName('X-1', { internal_reference: 'FAAAAAAAAA0001', model: 'X-0', name: 'ชื่ออื่น' }, [
      { internal_reference: 'FAAAAAAAAA0002', model: 'X-2', name: 'Heater "PM" X-2' },
      { internal_reference: 'FAAAAAAAAA0003', model: 'X-3', name: 'Heater "PM" X-3' },
      { internal_reference: 'FAAAAAAAAA0004', model: 'X-4', name: 'Other X-4' },
    ]) === 'Heater "PM" X-1');

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
