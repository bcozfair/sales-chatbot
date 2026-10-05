// ============================================================
// sync ใบสั่งขายผ่าน sale_order_updated_records_v3 — ตัวเขียนฐาน · ตัวคุมรอบ · โหมดอ่านอย่างเดียว
// แบบเต็มและเหตุผล: docs/plan-saleorder-v3.md (ตัวแปลง pure อยู่ที่ saleOrderV3.ts)
//
// ทำไมแยกจาก syncSaleorders.ts: ทางของ v2 ต้องอยู่ครบเหมือนเดิมทุกบรรทัดเพื่อเป็นทางถอย (แผนข้อ 4.7)
// ไฟล์นั้นจึงแค่เพิ่มตัวเลือกเวอร์ชันที่หัว syncSaleOrders() กับคำสั่ง CLI ส่วนของใหม่อยู่ที่นี่ทั้งหมด
//
// สามเรื่องที่ห้ามถอดออก
//  1. updated_at ขยับเฉพาะเมื่อค่าธุรกิจเปลี่ยนจริง — SYNC_API ภายนอกและ watermark ของ
//     customers_data_view อ่านคอลัมน์นี้ · v3 ส่งใบซ้ำทุกครั้งที่ MO/ใบแจ้งหนี้ขยับ ถ้าขยับทุกครั้ง
//     ทั้งสองจะทำงานฟรีทุกรอบ
//  2. source_updated_at กันของเก่าทับของใหม่ — backfill (CLI) กับรอบของแอปเขียนใบเดียวกันได้
//  3. เรียงแถวตามคีย์ก่อนเขียน — สองทรานแซกชันที่ล็อกหลายแถวสลับลำดับกัน = deadlock
// ============================================================
import type pg from 'pg';
import { pool } from '../../config/db.js';
import { createGatewayGet, GatewayUnreachableError, sleep } from './gatewayClient.js';
import { decideV3PageTransition, MAX_STALL_RETRIES } from './syncPagination.js';
import { createPageTicker, fmtNum, logResourceDone, setSyncCtx, slog, swarn, vlog } from './syncLog.js';
import {
  isBeforeCutoff, normalizeV3Page, V3_SWEEP_SINCE_ISO, V3_ORDER_DATE_CUTOFF_ISO,
  type OrderSnapshot,
} from './saleOrderV3.js';

/** แถว state ของ v3 — แยกจาก 'sale_order' ของ v2 ⇒ cursor ของ v2 ไม่ถูกแตะ ถอยกลับไปเดินต่อได้ */
export const V3_STATE_KEY = 'sale_order_v3';
/** แถวที่หน้าสถานะ sync ของแอปอ่าน (RESOURCES.saleorders.stateKey ใน syncService) */
const STATUS_KEY = 'sale_order';
const ADVISORY_LOCK_NAME = 'sync:sale_order_v3';
const PAGE_LIMIT = 500;
const PAGE_PAUSE_MS = 1200;
/** วัด 2026-10-05: หน้าละ 6.3–15.2 วิ (v2 0.3 วิ) — 30 วิ ของค่าเริ่มต้นเหลือที่ว่างไม่พอ */
const V3_TIMEOUT_MS = 60_000;
/** backfill: ติดต่อไม่ได้ทั้งชุด retry แล้ว (~3 นาที) — พักแล้วลองหน้าเดิมอีกกี่รอบก่อนยอมหยุด */
const PATIENT_PAGE_RETRIES = 3;
const PATIENT_PAGE_PAUSE_MS = 120_000;

type Client = pg.PoolClient;

function recordsPath(cursor: string | null, since: string) {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (cursor) params.set('cursor', cursor);
  else params.set('since', since);
  return `/api/odoo/sale_order_updated_records_v3?${params.toString()}`;
}

function v3Gateway(patient: boolean) {
  return createGatewayGet(['Saleorder_full_sync', 'GATEWAY_API_KEY'], {
    timeoutMs: V3_TIMEOUT_MS,
    maxAttempts: patient ? 8 : undefined,
  });
}

// ── สคีมา ──────────────────────────────────────────────────────────────────────
// คอลัมน์เดิมของ sale_orders ตามลำดับที่ upsertSaleOrderRows() ของ v2 เขียน · ชนิดตาม schema.sql
export const LEGACY_COLS: ReadonlyArray<readonly [string, string]> = [
  ['order_reference', 'varchar'], ['customer_reference', 'text'], ['customer_tax_id', 'text'],
  ['customer_name', 'text'], ['contact_name', 'text'], ['contact_mobile', 'text'], ['contact_phone', 'text'],
  ['invoice_street', 'text'], ['invoice_district', 'text'], ['invoice_sub_district', 'text'],
  ['invoice_state', 'text'], ['invoice_zip', 'text'], ['order_date', 'timestamptz'],
  ['customer_reference_po', 'text'], ['delivery_street', 'text'], ['delivery_district', 'text'],
  ['delivery_sub_district', 'text'], ['delivery_state', 'text'], ['delivery_zip', 'text'],
  ['employee_quotations', 'text'], ['employee_quotations_phone', 'text'], ['salesperson', 'text'],
  ['salesperson_phone', 'text'], ['sales_team', 'text'], ['customer_sale_area', 'text'],
  ['invoice_status', 'text'], ['last_updated', 'timestamptz'], ['sale_order_id', 'integer'],
  ['company_id', 'integer'], ['contact_id', 'integer'], ['salesperson_id', 'integer'],
  ['total_amount', 'numeric'], ['total_discount', 'numeric'], ['amount_after_discount', 'numeric'],
  ['vat', 'numeric'], ['net_amount', 'numeric'], ['model', 'text'], ['model_code', 'varchar'],
  ['quantity', 'numeric'], ['product_category', 'text'], ['product_group', 'text'],
  ['product_sub_category', 'text'], ['product_series', 'text'], ['order_status', 'text'],
  ['invoice_date', 'timestamptz'], ['source', 'text'],
];
// คอลัมน์ของ migration 2026-10-05_01
const V3_COLS: ReadonlyArray<readonly [string, string]> = [
  ['source_updated_at', 'timestamptz'], ['order_total_amount', 'numeric'], ['order_total_discount', 'numeric'],
  ['order_amount_after_discount', 'numeric'], ['order_vat', 'numeric'], ['order_net_amount', 'numeric'],
  ['order_line_count', 'integer'],
];
const ALL_COLS = [...LEGACY_COLS, ...V3_COLS];
/** ไม่เขียนทับตอนอัปเดต — คีย์ และ model (ของ v3 คนละความหมายกับ v2 · แผนข้อ 4.2) */
const KEEP_ON_UPDATE = new Set(['order_reference', 'model']);
/** ค่าธุรกิจ = ตัวตัดสินว่าแถวเปลี่ยนจริงไหม (source_updated_at เป็นข้อมูลกำกับ ไม่นับ) */
const BUSINESS_COLS = ALL_COLS.map(([c]) => c).filter((c) => !KEEP_ON_UPDATE.has(c) && c !== 'source_updated_at');
const LEGACY_COMPARE_COLS = LEGACY_COLS.map(([c]) => c).filter((c) => !KEEP_ON_UPDATE.has(c));

const recordsetDef = (cols: ReadonlyArray<readonly [string, string]>) => cols.map(([c, t]) => `${c} ${t}`).join(', ');
const rowOf = (alias: string, cols: string[]) => `ROW(${cols.map((c) => `${alias}.${c}`).join(', ')})`;
const SO_CHANGED = `${rowOf('sale_orders', BUSINESS_COLS)} IS DISTINCT FROM ${rowOf('EXCLUDED', BUSINESS_COLS)}`;

const UPSERT_SALE_ORDERS_SQL = `
  INSERT INTO sale_orders (${ALL_COLS.map(([c]) => c).join(', ')}, updated_at)
  SELECT ${ALL_COLS.map(([c]) => `x.${c}`).join(', ')}, NOW()
    FROM jsonb_to_recordset($1::jsonb) AS x(${recordsetDef(ALL_COLS)})
   ORDER BY x.order_reference
  ON CONFLICT (order_reference) DO UPDATE SET
    ${ALL_COLS.filter(([c]) => !KEEP_ON_UPDATE.has(c)).map(([c]) => `${c} = EXCLUDED.${c}`).join(',\n    ')},
    updated_at = CASE WHEN ${SO_CHANGED} THEN NOW() ELSE sale_orders.updated_at END
  WHERE (sale_orders.source_updated_at IS NULL OR EXCLUDED.source_updated_at >= sale_orders.source_updated_at)
    AND (${SO_CHANGED} OR sale_orders.source_updated_at IS DISTINCT FROM EXCLUDED.source_updated_at)
  RETURNING (xmax = 0) AS inserted, (updated_at = NOW()) AS bumped`;

const UPSERT_DETAILS_SQL = `
  INSERT INTO sale_order_details (sale_order_id, order_reference, source_updated_at, lines, updated_at)
  SELECT x.sale_order_id, x.order_reference, x.source_updated_at, x.lines, NOW()
    FROM jsonb_to_recordset($1::jsonb)
         AS x(sale_order_id integer, order_reference varchar, source_updated_at timestamptz, lines jsonb)
   ORDER BY x.sale_order_id
  ON CONFLICT (sale_order_id) DO UPDATE SET
    order_reference = EXCLUDED.order_reference,
    source_updated_at = EXCLUDED.source_updated_at,
    lines = EXCLUDED.lines,
    updated_at = CASE
      WHEN (sale_order_details.lines, sale_order_details.order_reference) IS DISTINCT FROM (EXCLUDED.lines, EXCLUDED.order_reference)
      THEN NOW() ELSE sale_order_details.updated_at END
  WHERE EXCLUDED.source_updated_at >= sale_order_details.source_updated_at
    AND (sale_order_details.lines, sale_order_details.order_reference, sale_order_details.source_updated_at)
        IS DISTINCT FROM (EXCLUDED.lines, EXCLUDED.order_reference, EXCLUDED.source_updated_at)
  RETURNING 1`;

export interface V3WriteResult {
  /** ใบที่ส่งเข้ามา (หลังตัดวันตัดแล้ว) */
  orders: number;
  inserted: number;
  /** ค่าธุรกิจเปลี่ยน ⇒ updated_at ขยับ */
  changed: number;
  /** เปลี่ยนแค่ source_updated_at (เช่น MO ขยับแต่หัวใบ/ยอดเท่าเดิม) ⇒ updated_at ไม่ขยับ */
  metaOnly: number;
  /** ไม่ได้เขียน — ค่าเท่าเดิมทุกช่อง หรือในฐานใหม่กว่าอยู่แล้ว */
  untouched: number;
  detailsWritten: number;
}

/**
 * เขียนใบชุดหนึ่งลง sale_orders + sale_order_details (ผู้เรียกคุมทรานแซกชันเอง)
 * SQL ไม่ใส่ public. ⇒ diag:saleorder-v3 ใช้ตารางชั่วคราวที่บังของจริงได้
 */
export async function writeV3Orders(db: Client, orders: OrderSnapshot[]): Promise<V3WriteResult> {
  const result: V3WriteResult = { orders: orders.length, inserted: 0, changed: 0, metaOnly: 0, untouched: 0, detailsWritten: 0 };
  if (orders.length === 0) return result;

  // order_reference เดียวกันสองใบในหน้าเดียว (ไม่เคยเห็น แต่ ON CONFLICT จะล้มทั้งคำสั่ง) — เก็บใบที่ใหม่กว่า
  const byRef = new Map<string, OrderSnapshot>();
  for (const o of orders) {
    const had = byRef.get(o.orderReference);
    if (had) swarn(`saleorders v3: ${o.orderReference} มาสองใบในหน้าเดียว (id ${had.saleOrderId} / ${o.saleOrderId}) — เก็บใบที่ใหม่กว่า`);
    if (!had || o.sourceUpdatedAt >= had.sourceUpdatedAt) byRef.set(o.orderReference, o);
  }

  const soRecords = [...byRef.values()].map((o) => ({
    ...o.legacy,
    source_updated_at: o.sourceUpdatedAt,
    order_total_amount: o.totals.amount,
    order_total_discount: o.totals.discount,
    order_amount_after_discount: o.totals.afterDiscount,
    order_vat: o.totals.vat,
    order_net_amount: o.totals.net,
    order_line_count: o.totals.lineCount,
  }));
  const so = await db.query<{ inserted: boolean; bumped: boolean }>(UPSERT_SALE_ORDERS_SQL, [JSON.stringify(soRecords)]);
  for (const r of so.rows) {
    if (r.inserted) result.inserted++;
    else if (r.bumped) result.changed++;
    else result.metaOnly++;
  }
  result.untouched = soRecords.length - so.rows.length;

  const detailRecords = orders.map((o) => ({
    sale_order_id: o.saleOrderId,
    order_reference: o.orderReference,
    source_updated_at: o.sourceUpdatedAt,
    lines: o.details,
  }));
  const det = await db.query(UPSERT_DETAILS_SQL, [JSON.stringify(detailRecords)]);
  result.detailsWritten = det.rowCount ?? 0;
  return result;
}

/**
 * วันตัด (แผนข้อ 4.5 · เจ้าของเคาะ 2026-10-05): ใบที่สั่งก่อน 2022 เก็บเฉพาะเมื่อมีแถวในฐานอยู่แล้ว
 * ⇒ v3 ไม่เพิ่มใบเก่า ~60,000 ใบที่ v2 ไม่เคยส่ง (v2 ให้แค่ใบที่แก้ตั้งแต่ 2022-01-03) และไม่ลบอะไร
 * — รายชื่อลูกค้า (Arm 2) · ด่านเครดิต · การค้นหาลูกค้า เห็นชุดใบเดิมทุกใบ ส่วนใบเดิมได้ค่าสดและยอดทั้งใบ
 * เทียบด้วย order_reference (PK) · ใบเก่าที่ถูกเปลี่ยนชื่อหลังวันนี้จะไม่ถูกเพิ่ม (ยอมรับ — ไม่เคยเห็นเกิด)
 */
export async function selectStorable(db: Pick<Client, 'query'>, orders: OrderSnapshot[]) {
  const old = orders.filter(isBeforeCutoff);
  if (old.length === 0) return { kept: orders, skipped: 0 };
  const { rows } = await db.query<{ order_reference: string }>(
    `SELECT order_reference FROM sale_orders WHERE order_reference = ANY($1)`, [old.map((o) => o.orderReference)]);
  const existing = new Set(rows.map((r) => r.order_reference));
  const kept = orders.filter((o) => !isBeforeCutoff(o) || existing.has(o.orderReference));
  return { kept, skipped: orders.length - kept.length };
}

// ── เลือกเวอร์ชัน ──────────────────────────────────────────────────────────────
export type SaleOrderApiVersion = 'v2' | 'v3';

/**
 * SALEORDER_API_VERSION = v3 (ค่าเริ่มต้น) | v2 (ทางถอย)
 * ขึ้นโค้ดนี้ = ใช้ v3 ทันที (เจ้าของเคาะ 2026-10-05 — v3 มีทุกอย่างที่ v2 มี ไม่ต้องรอ) ⇒ migration
 * 2026-10-05_01 ต้องลงก่อน ไม่งั้นรอบใบสั่งขายล้มดัง ๆ ทุกรอบ (assertV3Schema) · รอบแรกของ v3 คือการกวาด
 * ตั้งแต่ V3_SWEEP_SINCE_ISO ~1.5–2 ชม. — ทำก่อนสลับกล่องตามแผนข้อ 6 ไม่งั้นแอปกวาดเองในคิว sync ของมัน
 * ค่าอื่นที่ไม่รู้จัก (รวม auto ของร่างแรก) = throw — พิมพ์ผิดต้องดัง ไม่ใช่เงียบกลายเป็นอีกเวอร์ชัน
 */
export function resolveSaleOrderApiVersion(): SaleOrderApiVersion {
  const raw = (process.env.SALEORDER_API_VERSION || 'v3').trim().toLowerCase();
  if (raw === 'v2' || raw === 'v3') return raw;
  throw new Error(`SALEORDER_API_VERSION="${raw}" ไม่รู้จัก — ใช้ได้แค่ v3 (ค่าเริ่มต้น) / v2`);
}

async function assertV3Schema(db: Client) {
  // ถามตารางที่ชื่อ "sale_orders" ชี้ไปจริงตาม search_path (ไม่ล็อก schema public) ⇒ ด่านที่บังด้วยตารางชั่วคราวใช้ได้
  const { rows } = await db.query(`
    SELECT (SELECT count(*) FROM pg_attribute
             WHERE attrelid = to_regclass('sale_orders') AND attname = ANY($1) AND NOT attisdropped) AS cols,
           to_regclass('sale_order_details') IS NOT NULL AS details`, [V3_COLS.map(([c]) => c)]);
  if (Number(rows[0].cols) !== V3_COLS.length || !rows[0].details) {
    throw new Error('ฐานนี้ยังไม่ได้รัน migration 2026-10-05_01_sale_order_v3.sql — sync v3 เขียนไม่ได้');
  }
}

// ── รอบกวาด ─────────────────────────────────────────────────────────────────────
export interface V3SweepOptions {
  /** ล้าง cursor ของ v3 แล้วกวาดใหม่ตั้งแต่ V3_SWEEP_SINCE_ISO (ไม่แตะ cursor ของ v2) */
  restart?: boolean;
  /** backfill ที่รันยาวโดยไม่มีคนเฝ้า — retry gateway นานขึ้น และพักแล้วลองหน้าเดิมซ้ำก่อนยอมหยุด */
  patient?: boolean;
  /** รอบของแอป: อัปเดตเวลา/จำนวนของแถว 'sale_order' ให้หน้าสถานะ sync ด้วย (ไม่แตะ cursor ของ v2) */
  mirrorStatus?: boolean;
  /** ชื่อใน log */
  label?: string;
}

/** ของที่ด่านฉีดแทนได้ (diag:saleorder-v3 ส่วน ค) — ไม่ส่ง = ของจริง */
export interface V3SweepDeps {
  /** connection ของผู้เรียก (ผู้เรียกเป็นเจ้าของ ไม่ถูก release ที่นี่) */
  client?: Client;
  gatewayGet?: (path: string) => Promise<any>;
}

export interface V3SweepResult {
  pages: number;
  rows: number;
  orders: number;
  skippedByCutoff: number;
  write: V3WriteResult;
}

export async function runSaleOrderV3Sweep(opts: V3SweepOptions = {}, deps: V3SweepDeps = {}): Promise<V3SweepResult> {
  const label = opts.label || 'saleorders';
  const gatewayGet = deps.gatewayGet ?? v3Gateway(!!opts.patient);
  const startTime = Date.now();
  const total: V3SweepResult = {
    pages: 0, rows: 0, orders: 0, skippedByCutoff: 0,
    write: { orders: 0, inserted: 0, changed: 0, metaOnly: 0, untouched: 0, detailsWritten: 0 },
  };

  const db = deps.client ?? await pool.connect();
  let locked = false;
  try {
    const lock = await db.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [ADVISORY_LOCK_NAME]);
    locked = !!lock.rows[0]?.ok;
    if (!locked) throw new Error('มีรอบ sync ใบสั่งขาย v3 อีกรอบกำลังรันอยู่ (backfill จาก CLI?) — ข้ามรอบนี้');

    await assertV3Schema(db);
    await db.query(
      `INSERT INTO sync_state (resource, sync_cursor, sync_cursor_timestamp, sync_mode, pages_synced, records_synced)
       VALUES ($1, NULL, NULL, 'full', 0, 0) ON CONFLICT (resource) DO NOTHING`, [V3_STATE_KEY]);
    if (opts.restart) {
      await db.query(
        `UPDATE sync_state SET sync_cursor = NULL, sync_cursor_timestamp = NULL, sync_mode = 'full',
                pages_synced = 0, records_synced = 0 WHERE resource = $1`, [V3_STATE_KEY]);
      slog(`♻️ ${label}: ล้าง cursor ของ v3 แล้ว — กวาดใหม่ตั้งแต่ ${V3_SWEEP_SINCE_ISO} (cursor ของ v2 ไม่ถูกแตะ)`);
    }

    const { rows: [state] } = await db.query(
      `SELECT sync_cursor, sync_cursor_timestamp, sync_mode FROM sync_state WHERE resource = $1`, [V3_STATE_KEY]);
    let cursor: string | null = state?.sync_cursor || null;
    let cursorTimestamp: string | null = state?.sync_cursor_timestamp || null;
    const syncMode: string = state?.sync_mode === 'incremental' ? 'incremental' : 'full';
    vlog(`⏳ ${label}: mode=${syncMode} cursor=${cursorTimestamp ?? '(เริ่มที่ ' + V3_SWEEP_SINCE_ISO + ')'}`);

    const tick = createPageTicker(label, 'orders');
    let stallRetries = 0;
    let prevPageLast: { saleOrderId: number; sourceUpdatedAt: string } | null = null;

    while (true) {
      total.pages += 1;
      setSyncCtx(label, total.pages);
      const payload = await fetchPage(gatewayGet, recordsPath(cursor, V3_SWEEP_SINCE_ISO), !!opts.patient, label);
      const orders = normalizeV3Page(payload.data, { saleOrderCount: payload.sale_order_count, prevPageLast });

      await db.query('BEGIN');
      try {
        const { kept, skipped } = await selectStorable(db, orders);
        const w = await writeV3Orders(db, kept);
        const nextCursor: string | null = payload.next_cursor || null;
        const transition = decideV3PageTransition({
          rowCount: payload.data.length,
          hasMore: !!payload.has_more,
          nextCursor,
          previousCursor: cursor,
          stallRetries,
          maxStallRetries: MAX_STALL_RETRIES,
          // รอบ incremental: หน้าไม่เต็ม = จบรอบ ไม่ต้องยิงหน้าว่างอีก 6–8 วิ (ของที่เหลือรอบหน้าดึงต่อจาก cursor)
          // limit ที่ gateway ตอบกลับมา (ถ้ามันตัดให้ต่ำกว่าที่ขอ หน้าเต็มจะไม่ถูกนับเป็นหน้าไม่เต็ม)
          orderCount: typeof payload.sale_order_count === 'number' ? payload.sale_order_count : null,
          pageLimit: typeof payload.limit === 'number' && payload.limit > 0 ? payload.limit : PAGE_LIMIT,
          stopOnShortPage: syncMode === 'incremental',
        });

        if (transition.action === 'error') throw new Error(transition.reason);
        if (transition.action === 'retry-stall') {
          await db.query('ROLLBACK');
          stallRetries += 1;
          total.pages -= 1;
          swarn(`${label} หน้า ${total.pages + 1}: next_cursor ไม่ขยับ — retry ${stallRetries}/${MAX_STALL_RETRIES}`);
          await sleep(2000);
          continue;
        }

        total.rows += payload.data.length;
        total.orders += orders.length;
        total.skippedByCutoff += skipped;
        for (const k of ['orders', 'inserted', 'changed', 'metaOnly', 'untouched', 'detailsWritten'] as const) {
          total.write[k] += w[k];
        }

        const done = transition.action === 'complete';
        const savedCursor = nextCursor || cursor;
        const savedTs = payload.next_position?.updated_at || cursorTimestamp;
        await db.query(
          `UPDATE sync_state SET sync_cursor = $2, sync_cursor_timestamp = $3, sync_mode = $4,
                  pages_synced = $5, records_synced = $6, last_success_at = NOW()
            WHERE resource = $1`,
          [V3_STATE_KEY, savedCursor, savedTs, done ? 'incremental' : syncMode, total.pages, total.rows]);
        if (opts.mirrorStatus) {
          await db.query(
            `UPDATE sync_state SET pages_synced = $2, records_synced = $3, last_success_at = NOW() WHERE resource = $1`,
            [STATUS_KEY, total.pages, total.rows]);
        }
        await db.query('COMMIT');

        stallRetries = 0;
        cursor = savedCursor;
        cursorTimestamp = savedTs;
        const last = orders[orders.length - 1];
        prevPageLast = last ? { saleOrderId: last.saleOrderId, sourceUpdatedAt: last.sourceUpdatedAt } : prevPageLast;
        tick(total.pages, total.rows, total.orders);
        if (done) break;
      } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        throw err;
      }
      await sleep(PAGE_PAUSE_MS);
    }

    logResourceDone({
      resource: label, units: total.orders, unitLabel: 'orders', rows: total.rows,
      pages: total.pages, ms: Date.now() - startTime, cursorTimestamp,
    });
    const w = total.write;
    if (total.orders > 0) {
      slog(`  ${label} (v3): ใหม่ ${fmtNum(w.inserted)} · ค่าเปลี่ยน ${fmtNum(w.changed)} · เปลี่ยนแค่เวลา ${fmtNum(w.metaOnly)} · ` +
        `เท่าเดิม ${fmtNum(w.untouched)} · รายละเอียด ${fmtNum(w.detailsWritten)} · ข้าม (สั่งก่อน 2022 และไม่มีในฐาน) ${fmtNum(total.skippedByCutoff)}`);
    }
    return total;
  } finally {
    setSyncCtx(null);
    // ล็อกระดับ session ติดไปกับ connection — ปลดไม่สำเร็จแล้วคืนเข้า pool = ทุกรอบหลังจากนี้เข้าไม่ได้
    // จนกว่า connection นั้นจะถูกปิด ⇒ ปลดไม่ได้ให้ทิ้ง connection ไปเลย (Postgres ปล่อยล็อกให้เอง)
    let destroy = false;
    if (locked) {
      await db.query(`SELECT pg_advisory_unlock(hashtext($1))`, [ADVISORY_LOCK_NAME]).catch(() => { destroy = true; });
    }
    if (!deps.client) db.release(destroy);
  }
}

async function fetchPage(gatewayGet: (p: string) => Promise<any>, path: string, patient: boolean, label: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      const body = await gatewayGet(path);
      const payload = body?.payload;
      if (!payload || !Array.isArray(payload.data)) throw new Error('Invalid gateway response: payload.data is missing');
      return payload;
    } catch (err) {
      if (!patient || !(err instanceof GatewayUnreachableError) || attempt >= PATIENT_PAGE_RETRIES) throw err;
      swarn(`${label}: ${err.message} — พัก ${PATIENT_PAGE_PAUSE_MS / 60000} นาทีแล้วลองหน้าเดิมอีกครั้ง (${attempt + 1}/${PATIENT_PAGE_RETRIES})`);
      await sleep(PATIENT_PAGE_PAUSE_MS);
    }
  }
}

// ── โหมดอ่านอย่างเดียว (--v3-dry-run) ──────────────────────────────────────────
// ดึงหน้าจริง → ผ่านตัวแปลงและด่านตรวจรูป → เทียบคอลัมน์เดิมกับที่โค้ด v2 เขียนไว้ในฐาน ด้วย IS DISTINCT FROM
// ชุดเดียวกับตัวเขียน · ไม่เขียนอะไรเลย ไม่แตะ sync_state · ใช้ได้ทั้งก่อนและหลังรัน migration
export interface V3DryRunOptions {
  /** ISO — ค่าเริ่มต้น 2 วันก่อน */
  since?: string;
  /** จำนวนหน้า — 0 = จนสุด · ค่าเริ่มต้น 3 */
  pages?: number;
}

const FIRST_LINE_COLS = ['total_amount', 'total_discount', 'amount_after_discount', 'vat', 'net_amount', 'quantity'];

export async function dryRunSaleOrderV3(opts: V3DryRunOptions = {}) {
  const since = opts.since || new Date(Date.now() - 2 * 86_400_000).toISOString();
  const maxPages = opts.pages ?? 3;
  const gatewayGet = v3Gateway(false);
  const colDiff = new Map<string, { n: number; ex: string[] }>();
  const stat = {
    pages: 0, rows: 0, orders: 0, cutoff: 0, isNew: 0, same: 0, differ: 0, lines: 0, invoices: 0, mos: 0,
    hasMoreFalseWithRows: 0, firstLineDriftOnUntouched: 0, ms: [] as number[], jsonBytes: [] as number[],
  };

  // เทียบในฐานด้วยชนิดข้อมูลจริง — ตรงกับที่ ON CONFLICT ของตัวเขียนจะตัดสิน (ไม่เทียบใน JS)
  const chunks: string[][] = [];
  for (let i = 0; i < LEGACY_COMPARE_COLS.length; i += 20) chunks.push(LEGACY_COMPARE_COLS.slice(i, i + 20));
  const diffExpr = chunks.map((cols) => `jsonb_build_object(${cols.map((c) =>
    `'${c}', CASE WHEN s.${c} IS DISTINCT FROM x.${c} THEN jsonb_build_array(s.${c}, x.${c}) END`).join(', ')})`).join(' || ');
  const compareSql = `
    SELECT x.order_reference, (s.order_reference IS NULL) AS is_new,
           jsonb_strip_nulls(${diffExpr}) AS diff
      FROM jsonb_to_recordset($1::jsonb) AS x(${recordsetDef(LEGACY_COLS)})
      LEFT JOIN sale_orders s ON s.order_reference = x.order_reference`;

  let cursor: string | null = null;
  let prevPageLast: { saleOrderId: number; sourceUpdatedAt: string } | null = null;
  while (maxPages === 0 || stat.pages < maxPages) {
    const t0 = Date.now();
    const payload = await fetchPage(gatewayGet, recordsPath(cursor, since), false, 'dry-run');
    stat.ms.push(Date.now() - t0);
    stat.pages += 1;
    if (!payload.has_more && payload.data.length > 0) stat.hasMoreFalseWithRows += 1;

    const orders = normalizeV3Page(payload.data, { saleOrderCount: payload.sale_order_count, prevPageLast });
    const { kept, skipped } = await selectStorable(pool, orders);
    stat.rows += payload.data.length;
    stat.orders += orders.length;
    stat.cutoff += skipped;
    for (const o of kept) {
      stat.lines += o.details.lines.length;
      for (const l of o.details.lines) { stat.invoices += l.invoices.length; stat.mos += l.mos.length; }
      stat.jsonBytes.push(Buffer.byteLength(JSON.stringify(o.details)));
    }

    if (kept.length > 0) {
      const { rows } = await pool.query(compareSql, [JSON.stringify(kept.map((o) => o.legacy))]);
      for (const r of rows) {
        if (r.is_new) { stat.isNew++; continue; }
        const cols = Object.keys(r.diff);
        if (cols.length === 0) { stat.same++; continue; }
        stat.differ++;
        // ใบที่หัวใบไม่ถูกแก้ตั้งแต่ v2 เขียน (last_updated เท่าเดิม) ยอดของบรรทัดแรกต้องเท่าเดิมทุกตัว
        if (!cols.includes('last_updated') && cols.some((c) => FIRST_LINE_COLS.includes(c))) stat.firstLineDriftOnUntouched++;
        for (const c of cols) {
          const e = colDiff.get(c) || { n: 0, ex: [] };
          e.n++;
          if (e.ex.length < 3) e.ex.push(`${r.order_reference}: ${JSON.stringify(r.diff[c][0])} → ${JSON.stringify(r.diff[c][1])}`);
          colDiff.set(c, e);
        }
      }
    }

    const transition = decideV3PageTransition({
      rowCount: payload.data.length, hasMore: !!payload.has_more, nextCursor: payload.next_cursor || null,
      previousCursor: cursor, stallRetries: 0, maxStallRetries: 0,
    });
    if (transition.action === 'error') throw new Error(transition.reason);
    if (transition.action !== 'advance') break;
    cursor = payload.next_cursor;
    const last = orders[orders.length - 1];
    if (last) prevPageLast = { saleOrderId: last.saleOrderId, sourceUpdatedAt: last.sourceUpdatedAt };
    await sleep(PAGE_PAUSE_MS);
  }

  const pct = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  console.log(`\n── saleorders v3 dry-run (อ่านอย่างเดียว · since=${since}) ──────────────────`);
  console.log(`หน้า ${stat.pages} · แถว ${fmtNum(stat.rows)} · ใบ ${fmtNum(stat.orders)} · ด่านตรวจรูปผ่านทุกหน้า`);
  console.log(`เวลา/หน้า: เฉลี่ย ${(avg(stat.ms) / 1000).toFixed(1)} วิ · สูงสุด ${(Math.max(0, ...stat.ms) / 1000).toFixed(1)} วิ (timeout ${V3_TIMEOUT_MS / 1000} วิ)`);
  console.log(`has_more=false ทั้งที่หน้ามีข้อมูล: ${stat.hasMoreFalseWithRows} หน้า`);
  console.log(`ข้าม (สั่งก่อน ${V3_ORDER_DATE_CUTOFF_ISO} และไม่มีในฐาน): ${fmtNum(stat.cutoff)} ใบ`);
  console.log(`บรรทัด ${fmtNum(stat.lines)} · ใบแจ้งหนี้ ${fmtNum(stat.invoices)} · MO ${fmtNum(stat.mos)}`);
  console.log(`jsonb ต่อใบ: เฉลี่ย ${avg(stat.jsonBytes)} B · p95 ${pct(stat.jsonBytes, 0.95)} B · สูงสุด ${Math.max(0, ...stat.jsonBytes)} B`);
  console.log(`เทียบคอลัมน์เดิมกับฐาน (ไม่นับ model): ใหม่ ${fmtNum(stat.isNew)} · เท่าเดิม ${fmtNum(stat.same)} · ต่าง ${fmtNum(stat.differ)}`);
  for (const [c, e] of [...colDiff].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${c.padEnd(26)} ${String(e.n).padStart(5)}  เช่น ${e.ex.join(' · ')}`);
  }
  const ok = stat.firstLineDriftOnUntouched === 0;
  console.log(`${ok ? '✓' : '✗'} ใบที่หัวใบไม่ถูกแก้ (last_updated เท่าเดิม) แต่ยอด/จำนวนบรรทัดแรกต่างจากที่ v2 เขียน: ${stat.firstLineDriftOnUntouched}`);
  return { ok, stat, colDiff };
}
