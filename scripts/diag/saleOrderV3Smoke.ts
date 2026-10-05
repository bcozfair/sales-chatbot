/**
 * npm run diag:saleorder-v3 — ด่านของ sync ใบสั่งขาย v3 (docs/plan-saleorder-v3.md)
 *
 * ส่วน ก (ไม่แตะ DB/network): ตัวแปลง · ด่านตรวจรูป · วันตัด · ผลรวมทศนิยม · ตัวตัดสินการแบ่งหน้า
 *   ใช้แถวสังเคราะห์ที่หน้าตาเหมือน payload จริง — ไม่ใช่ golden ของข้อมูลจริง (ข้อมูลโตทุกวัน)
 * ส่วน ข (ตารางชั่วคราวที่ "บัง" ของจริง แล้ว ROLLBACK เสมอ): ตัวเขียน writeV3Orders()
 *   `CREATE TEMP TABLE sale_orders / sale_order_details` ⇒ SQL ที่ไม่ใส่ `public.` เห็นของชั่วคราวก่อน
 *   คอลัมน์ใหม่และตารางรายละเอียดสร้างจาก **ไฟล์ migration ตรง ๆ** ⇒ ไม่ต้องรัน migration กับฐานจริง
 *   ⇒ อยู่กลุ่ม "เขียนแล้ว ROLLBACK" ของ AGENTS.md B2 **รันบน PMSV ได้** · **ห้ามเปลี่ยน ROLLBACK เป็น COMMIT**
 *   ข้อ ข0 หยุดทั้งด่านก่อนเขียนถ้าตารางที่เห็นไม่ใช่ของชั่วคราว
 * ส่วน ค (รอบกวาดเต็ม runSaleOrderV3Sweep กับ gateway จำลอง): รอบกวาด COMMIT เองทุกหน้า จึงใช้ตารางชั่วคราว
 *   **ระดับ session** (sync_state / sale_orders / sale_order_details) บน connection ที่ส่งเข้าไป แล้ว DROP +
 *   ทิ้ง connection ตอนจบ — คนอื่นมองไม่เห็นตารางพวกนี้เลย · ข้อ ค0 หยุดก่อนรันถ้าตารางไม่ใช่ของชั่วคราว
 *   ของจริงที่แตะคือ advisory lock ชื่อ sync:sale_order_v3 ชั่วขณะ (ถ้า backfill จริงกำลังรัน ข้อ ค0 จะบอก)
 *
 * ของที่ด่านนี้ไม่ครอบ: รูปของ payload จริงจาก gateway — ใช้ `npm run sync:saleorders -- --v3-dry-run`
 * (อ่านอย่างเดียว · เทียบคอลัมน์เดิมกับที่โค้ด v2 เขียนไว้ในฐาน)
 */
import type pg from 'pg';
import { readFileSync } from 'node:fs';
import { pool } from '../../config/db.js';
import {
  isBeforeCutoff, normalizeV3Page, sumDecimal, V3ShapeError, V3_ORDER_DATE_CUTOFF_ISO,
  type OrderSnapshot, type V3Row,
} from '../sync/saleOrderV3.js';
import { decideV3PageTransition } from '../sync/syncPagination.js';
import {
  LEGACY_COLS, resolveSaleOrderApiVersion, runSaleOrderV3Sweep, selectStorable, writeV3Orders,
} from '../sync/syncSaleordersV3.js';
import { syncSaleOrders } from '../sync/syncSaleorders.js';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail?: string): void => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}${detail ? `  —  ${detail}` : ''}`);
};
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`);
const throwsShape = (fn: () => unknown): boolean => {
  try { fn(); return false; } catch (e) { return e instanceof V3ShapeError; }
};

// ── แถวสังเคราะห์ ───────────────────────────────────────────────────────────────
// เลขใบ ZZV3-* / id 9xxxxxxx ไม่มีทางชนของจริง (ตารางเป็นของชั่วคราวอยู่แล้ว แต่กันคนอ่าน log สับสน)
const T1 = '2026-09-20T00:10:11.354Z';

function head(id: number, ref: string, extra: V3Row = {}): V3Row {
  return {
    'Sale Order ID': id, 'Order Reference': ref, 'V3 Updated At': T1, 'V3 Update Sources': 'invoice',
    'Order Date': '2026-06-22T07:07:20.000Z', 'Last Updated': '2026-07-17T04:05:42.035Z', 'Status': 'Locked',
    'Order Status': 'Locked', 'Invoice Status': 'invoiced', 'contact_id': 9100001, 'company_id': 1, 'salesperson_id': 433,
    'Customer/Reference': 'A/ZZ', 'Customer/Name': 'คุณทดสอบ ', 'Contact/Name': 'คุณแขก', 'Customer/Tax ID': '0000000000000',
    'Salesperson': 'คุณทดสอบ(PM)', 'Sales Team': 'พระราม 2', 'Source': 'Sales',
    ...extra,
  };
}
function line(model: string, amount: string, extra: V3Row = {}): V3Row {
  return {
    'Model Code': model, 'Model': null, 'Quantity': '3.000', 'Quantity Invoiced': '3.000',
    'ยอดรวม': amount, 'ยอดรวมส่วนลด': '0.1000000000000000', 'มูลค่าหลังหักส่วนลด': '16726.50', 'VAT': 1170.855,
    'ยอดเงินสุทธิ': '17897.36', 'Product Category': 'Heater', 'Product Group': 'Inst 1',
    'Product Sub Category': 'Immersion Heater', 'Product Series': 'IMH',
    ...extra,
  };
}
function inv(no: string | null, use: boolean, extra: V3Row = {}): V3Row {
  return {
    'Invoice Number': no, 'Invoice Type': no ? 'out_invoice' : null, 'Invoice Date': no ? '2026-07-20T00:00:00.000Z' : null,
    'Invoice Quantity': no ? '3.000' : null, 'Invoice Total': no ? '17897.36' : null, 'Invoice Line Status': no ? 'invoiced' : null,
    use_for_invoice_amount: use, ...extra,
  };
}
function mo(ref: string | null, use: boolean): V3Row {
  return { 'MO Reference': ref, 'MO Status': ref ? 'QC' : null, 'MO Quantity': ref ? '3.000' : null, use_for_mo: use };
}
const row = (h: V3Row, l: V3Row, i: V3Row, m: V3Row, ufo: boolean): V3Row => ({ ...h, ...l, ...i, ...m, use_for_order_amount: ufo });

/** ใบ A: บรรทัด 1 = 2 ใบแจ้งหนี้ × 2 MO (4 แถว) · บรรทัด 2 = รุ่นเดียวกันซ้ำ ไม่มีใบแจ้งหนี้/MO (1 แถว) */
function orderA(id = 91000001, ref = 'ZZV3-0001', h: V3Row = {}): V3Row[] {
  const H = head(id, ref, h);
  const L1 = line('IMH-1F', '23895.0000000');
  const L2 = line('IMH-1F', '0.2', { 'VAT': 0.145, 'ยอดรวมส่วนลด': '0.2' });
  return [
    row(H, L1, inv('INV-1', true), mo('Assy/1', true), true),
    row(H, L1, inv('INV-1', false), mo('Assy/2', true), false),
    row(H, L1, inv('INV-2', true, { 'Invoice Type': 'out_refund' }), mo('Assy/1', false), false),
    row(H, L1, inv('INV-2', false), mo('Assy/2', false), false),
    row(H, L2, inv(null, false), mo(null, false), true),
  ];
}

// ── ส่วน ก ─────────────────────────────────────────────────────────────────────
function partA() {
  section('ก1 · แตกหน้าเป็นใบ/บรรทัด/ใบแจ้งหนี้/MO');
  const page = [...orderA(), ...orderA(91000002, 'ZZV3-0002')];
  const orders = normalizeV3Page(page, { saleOrderCount: 3 });
  const a = orders[0];
  check('2 ใบตามลำดับที่ส่งมา', orders.length === 2 && a.orderReference === 'ZZV3-0001' && orders[1].saleOrderId === 91000002);
  check('ใบ A มี 2 บรรทัด — รุ่นซ้ำกันไม่ถูกยุบรวม', a.details.lines.length === 2 && a.totals.lineCount === 2);
  const l1 = a.details.lines[0];
  check('บรรทัด 1: ใบแจ้งหนี้ 2 ใบ (ตามธง use_for_invoice_amount ไม่นับซ้ำจากการคูณกับ MO)',
    l1.invoices.length === 2 && l1.invoices[1].type === 'out_refund', JSON.stringify(l1.invoices.map((x) => x.number)));
  check('บรรทัด 1: MO 2 ตัว (ตามธง use_for_mo)', l1.mos.length === 2 && l1.mos.map((m) => m.ref).join() === 'Assy/1,Assy/2');
  check('บรรทัด 2: ไม่มีใบแจ้งหนี้/MO', a.details.lines[1].invoices.length === 0 && a.details.lines[1].mos.length === 0);
  check('ยอดทั้งใบรวมทุกบรรทัดแบบทศนิยมตรง', a.totals.amount === '23895.2' && a.totals.discount === '0.3' && a.totals.vat === '1171',
    `${a.totals.amount} / ${a.totals.discount} / ${a.totals.vat}`);
  check('sourceUpdatedAt = V3 Updated At', a.sourceUpdatedAt === T1);
  check('details.v = 3 · src ติดมา', a.details.v === 3 && a.details.src === 'invoice');

  section('ก2 · คอลัมน์เดิม = สูตรของ v2 จากแถวแรก');
  check('ยอดของบรรทัดแรกผ่าน parseFloat เหมือน v2', a.legacy.total_amount === 23895 && a.legacy.vat === 1170.855 && a.legacy.quantity === 3);
  check('model = N/A เสมอ (ใบเดิมตัวเขียนไม่แตะ) · model_code มาจากแถวแรก', a.legacy.model === 'N/A' && a.legacy.model_code === 'IMH-1F');
  check('ชื่อลูกค้าไม่ถูก trim (CLAUDE.md: ห้าม trim ชื่อที่ส่งไป Odoo)', a.legacy.customer_name === 'คุณทดสอบ ');
  check('invoice_date = ของแถวแรก (เหมือน v2) · order_status = Status', a.legacy.invoice_date === '2026-07-20T00:00:00.000Z' && a.legacy.order_status === 'Locked');
  const names = LEGACY_COLS.map(([c]) => c);
  check('ชุดคีย์ของ legacy = ชุดคอลัมน์ที่ตัวเขียนประกาศ', JSON.stringify(Object.keys(a.legacy).sort()) === JSON.stringify([...names].sort()));
  const v2Src = readFileSync(new URL('../sync/syncSaleorders.ts', import.meta.url), 'utf-8');
  const v2Cols = /INSERT INTO sale_orders \(([\s\S]*?)\) VALUES/.exec(v2Src)?.[1].split(',').map((c) => c.trim()).filter((c) => c && c !== 'updated_at') ?? [];
  check('คอลัมน์เดิมที่ v3 เขียน = ชุดเดียวกับ INSERT ของ v2 ตามลำดับเดียวกัน', JSON.stringify(v2Cols) === JSON.stringify(names),
    `v2 ${v2Cols.length} · v3 ${names.length}`);

  section('ก3 · ด่านตรวจรูป — ผิดแล้วต้อง throw ไม่ใช่เดา');
  const A = orderA();
  check('แถวของใบไม่ติดกัน', throwsShape(() => normalizeV3Page([A[0], ...orderA(91000002, 'ZZV3-0002'), ...A.slice(1)])));
  check('แถวแรกของใบไม่ใช่ use_for_order_amount', throwsShape(() => normalizeV3Page([A[1], A[0], ...A.slice(2)])));
  check('ค่าระดับบรรทัดไม่เท่ากันในกลุ่ม', throwsShape(() => normalizeV3Page([A[0], { ...A[1], 'ยอดรวม': '1' }, ...A.slice(2)])));
  check('หัวใบไม่เท่ากันทุกแถว', throwsShape(() => normalizeV3Page([A[0], { ...A[1], 'Invoice Status': 'no' }, ...A.slice(2)])));
  check('ไม่มี Sale Order ID', throwsShape(() => normalizeV3Page([{ ...A[0], 'Sale Order ID': null }])));
  check('ไม่มี V3 Updated At', throwsShape(() => normalizeV3Page([{ ...A[0], 'V3 Updated At': null }])));
  check('จำนวนใบเกิน sale_order_count', throwsShape(() => normalizeV3Page(A, { saleOrderCount: 0 })));
  check('ใบถูกตัดข้ามหน้า (id และเวลาเท่าใบสุดท้ายของหน้าก่อน)',
    throwsShape(() => normalizeV3Page(A, { prevPageLast: { saleOrderId: 91000001, sourceUpdatedAt: T1 } })));
  check('ใบเดิมที่ถูกแก้ระหว่างกวาด (เวลาใหม่กว่า) ไม่ถือว่าถูกตัด',
    !throwsShape(() => normalizeV3Page(A, { prevPageLast: { saleOrderId: 91000001, sourceUpdatedAt: '2026-09-19T00:00:00.000Z' } })));
  check('ใบที่ไม่มีบรรทัด (sale_order_count มากกว่าจำนวนใบ) ผ่าน', normalizeV3Page(A, { saleOrderCount: 5 }).length === 1);
  check('หน้าว่าง = ไม่มีใบ', normalizeV3Page([]).length === 0);

  section('ก4 · วันตัด 2022-01-01 เวลาไทย');
  const at = (d: string | null) => normalizeV3Page(orderA(91000003, 'ZZV3-0003', { 'Order Date': d }))[0];
  check('วันตัดคือ 2021-12-31T17:00:00Z', V3_ORDER_DATE_CUTOFF_ISO === '2021-12-31T17:00:00.000Z');
  check('23:59:59.999 ของ 31 ธ.ค. 2021 (ไทย) = ก่อนวันตัด', isBeforeCutoff(at('2021-12-31T16:59:59.999Z')));
  check('00:00 ของ 1 ม.ค. 2022 (ไทย) = ไม่ตัด', !isBeforeCutoff(at('2021-12-31T17:00:00.000Z')));
  check('ไม่มีวันที่ = ไม่ตัด', !isBeforeCutoff(at(null)));

  section('ก5 · ผลรวมทศนิยม');
  check('ข้อความยาว + number + ค่าว่าง', sumDecimal(['7168.5000000000000000', 1170.855, null, '', undefined]) === '8339.355');
  check('ไม่หลุด float (0.1 + 0.2)', sumDecimal(['0.1', '0.2']) === '0.3' && sumDecimal([0.1, 0.2]) === '0.3');
  check('ติดลบ (ใบลดหนี้)', sumDecimal(['-10.25', '4']) === '-6.25' && sumDecimal(['-0.5']) === '-0.5');
  check('ว่างทั้งหมด = 0', sumDecimal([]) === '0' && sumDecimal([null]) === '0');

  section('ก6 · ตัวตัดสินการแบ่งหน้า — ไม่เชื่อ has_more ตัวเดียว');
  const d = (rowCount: number, hasMore: boolean, nextCursor: string | null, previousCursor: string | null, stallRetries = 0) =>
    decideV3PageTransition({ rowCount, hasMore, nextCursor, previousCursor, stallRetries, maxStallRetries: 2 }).action;
  check('หน้าว่าง = จบ แม้ has_more=true', d(0, true, 'c2', 'c1') === 'complete');
  check('มีข้อมูล + cursor ขยับ = ไปต่อ แม้ has_more=false (บั๊กที่ Appsale เจอ)', d(10, false, 'c2', 'c1') === 'advance');
  check('มีข้อมูล + ไม่มี next_cursor + has_more=true = error', d(10, true, null, 'c1') === 'error');
  check('มีข้อมูล + ไม่มี next_cursor + has_more=false = จบ', d(10, false, null, 'c1') === 'complete');
  check('cursor ไม่ขยับ + has_more=true = retry แล้ว error', d(10, true, 'c1', 'c1', 0) === 'retry-stall' && d(10, true, 'c1', 'c1', 2) === 'error');
  check('cursor ไม่ขยับ + has_more=false = จบ', d(10, false, 'c1', 'c1') === 'complete');
  check('หน้าแรก (since=) มีข้อมูล = ไปต่อ', d(10, true, 'c1', null) === 'advance');

  section('ก7 · สวิตช์เวอร์ชัน — ไม่ตั้ง = v3 ทันที · v2 = ทางถอย');
  const version = (v: string | undefined): string => {
    const saved = process.env.SALEORDER_API_VERSION;
    if (v === undefined) delete process.env.SALEORDER_API_VERSION; else process.env.SALEORDER_API_VERSION = v;
    try { return resolveSaleOrderApiVersion(); } catch { return 'throw'; } finally {
      if (saved === undefined) delete process.env.SALEORDER_API_VERSION; else process.env.SALEORDER_API_VERSION = saved;
    }
  };
  check('ไม่ตั้ง / ค่าว่าง = v3 (ไม่ถามฐาน ไม่รอ backfill)', version(undefined) === 'v3' && version('') === 'v3');
  check('v2 = ทางถอย · ตัวพิมพ์/ช่องว่างไม่มีผล', version('v2') === 'v2' && version(' V2 ') === 'v2' && version('V3') === 'v3');
  check('ค่าที่ไม่รู้จัก (รวม auto ของร่างแรก) = throw ไม่ใช่เดา', version('auto') === 'throw' && version('3') === 'throw');
}

// ── ส่วน ข ─────────────────────────────────────────────────────────────────────
async function setup(c: pg.PoolClient, onCommit = 'ON COMMIT DROP'): Promise<void> {
  await c.query(`CREATE TEMP TABLE sale_orders (LIKE public.sale_orders INCLUDING ALL) ${onCommit}`);
  const mig = readFileSync(new URL('../../migrations/changes/2026-10-05_01_sale_order_v3.sql', import.meta.url), 'utf-8');
  // คอลัมน์ใหม่ของ sale_orders — นิยามจากไฟล์ migration (ฐานที่รันแล้ว LIKE ติดมาให้อยู่แล้ว ⇒ IF NOT EXISTS)
  const adds = [...mig.matchAll(/ADD COLUMN IF NOT EXISTS (\w+) ([^,;]+)/g)];
  if (adds.length !== 7) throw new Error(`อ่าน ADD COLUMN จากไฟล์ migration ได้ ${adds.length} ตัว (คาด 7)`);
  for (const m of adds) await c.query(`ALTER TABLE sale_orders ADD COLUMN IF NOT EXISTS ${m[1]} ${m[2]}`);
  const body = /CREATE TABLE IF NOT EXISTS public\.sale_order_details \(([\s\S]*?)\n\);/.exec(mig)?.[1];
  if (!body) throw new Error('หา CREATE TABLE sale_order_details ในไฟล์ migration ไม่เจอ');
  await c.query(`CREATE TEMP TABLE sale_order_details (${body}) ${onCommit}`);
}

async function assertShadowed(c: pg.PoolClient, label: string, tables = ['sale_orders', 'sale_order_details']): Promise<boolean> {
  const { rows } = await c.query<{ t: string; temp: boolean }>(`
    SELECT t, coalesce(to_regclass(t)::oid IN (SELECT oid FROM pg_class WHERE relpersistence = 't'), false) AS temp
      FROM unnest($1::text[]) AS t`, [tables]);
  const ok = rows.every((r) => r.temp);
  check(`${label} · ${tables.join(' / ')} ที่ SQL เห็นเป็นตารางชั่วคราวทั้งหมด`, ok,
    rows.map((r) => `${r.t}=${r.temp ? 'temp' : 'จริง!'}`).join(' '));
  return ok;
}

const snap = (rows: V3Row[]): OrderSnapshot => normalizeV3Page(rows)[0];
/** updated_at ทั้งรอบเป็น NOW() ค่าเดียว (ทรานแซกชันเดียว) ⇒ ตั้งค่าเก่าไว้ก่อนแต่ละข้อ แล้วดูว่าขยับไหม */
const OLD = '2000-01-01T00:00:00Z';
async function soRow(c: pg.PoolClient, ref: string) {
  const { rows } = await c.query(
    `SELECT ctid::text AS ctid, model, invoice_status, order_total_amount::text AS ota, order_line_count AS olc,
            source_updated_at, (updated_at = $2::timestamptz) AS kept_old
       FROM sale_orders WHERE order_reference = $1`, [ref, OLD]);
  return rows[0];
}

async function partB() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await setup(c);
    if (!(await assertShadowed(c, 'ข0'))) return;

    section('ข1 · แถวเดิมของ v2 → v3 เขียนทับ');
    await c.query(
      `INSERT INTO sale_orders (order_reference, sale_order_id, model, model_code, total_amount, vat, quantity, invoice_status, updated_at)
       VALUES ('ZZV3-0001', 91000001, 'ชื่อสินค้าเต็มจาก v2', 'IMH-1F', 23895, 1170.855, 3, 'to invoice', $1)`, [OLD]);
    let w = await writeV3Orders(c, [snap(orderA())]);
    let r = await soRow(c, 'ZZV3-0001');
    check('นับเป็น "ค่าเปลี่ยน" และ updated_at ขยับ (ยอดทั้งใบเป็นค่าใหม่)', w.changed === 1 && !r.kept_old, JSON.stringify(w));
    check('model ของ v2 ไม่ถูกทับ', r.model === 'ชื่อสินค้าเต็มจาก v2');
    check('ยอดทั้งใบ + จำนวนบรรทัด + สถานะบิลสดขึ้น', r.ota === '23895.2' && r.olc === 2 && r.invoice_status === 'invoiced', `${r.ota} · ${r.olc} · ${r.invoice_status}`);
    check('รายละเอียด 1 แถว', w.detailsWritten === 1);

    section('ข2 · ส่งซ้ำค่าเดิม = ไม่เขียน');
    await c.query(`UPDATE sale_orders SET updated_at = $1 WHERE order_reference = 'ZZV3-0001'`, [OLD]);
    const before = await soRow(c, 'ZZV3-0001');
    w = await writeV3Orders(c, [snap(orderA())]);
    r = await soRow(c, 'ZZV3-0001');
    check('untouched=1 · updated_at ไม่ขยับ · ไม่สร้างแถวใหม่ (ctid เดิม)', w.untouched === 1 && r.kept_old && r.ctid === before.ctid, JSON.stringify(w));
    check('รายละเอียดไม่ถูกเขียนซ้ำ', w.detailsWritten === 0);

    section('ข3 · เวลาใหม่กว่าแต่ค่าเท่าเดิม (เช่น MO ขยับ) = อัปเดตแค่เวลา');
    const T2 = '2026-09-21T00:00:00.000Z';
    w = await writeV3Orders(c, [snap(orderA(91000001, 'ZZV3-0001', { 'V3 Updated At': T2 }))]);
    r = await soRow(c, 'ZZV3-0001');
    check('metaOnly=1 · updated_at ไม่ขยับ · source_updated_at เดินหน้า',
      w.metaOnly === 1 && r.kept_old && new Date(r.source_updated_at).toISOString() === T2, JSON.stringify(w));

    section('ข4 · ของเก่ามาทีหลัง = ไม่ทับของใหม่');
    w = await writeV3Orders(c, [snap(orderA(91000001, 'ZZV3-0001', { 'Invoice Status': 'no' }))]);   // เวลา T1 < T2
    r = await soRow(c, 'ZZV3-0001');
    check('untouched=1 · invoice_status ยังเป็นค่าใหม่', w.untouched === 1 && r.invoice_status === 'invoiced', JSON.stringify(w));
    const det = await c.query(`SELECT source_updated_at FROM sale_order_details WHERE sale_order_id = 91000001`);
    check('รายละเอียดก็ไม่ถูกทับ', new Date(det.rows[0].source_updated_at).toISOString() === T2 && w.detailsWritten === 0);

    section('ข5 · ค่าธุรกิจเปลี่ยน = updated_at ขยับ');
    const T3 = '2026-09-22T00:00:00.000Z';
    w = await writeV3Orders(c, [snap(orderA(91000001, 'ZZV3-0001', { 'V3 Updated At': T3, 'Invoice Status': 'no' }))]);
    r = await soRow(c, 'ZZV3-0001');
    check('changed=1 · updated_at ขยับ · ค่าใหม่ลง', w.changed === 1 && !r.kept_old && r.invoice_status === 'no', JSON.stringify(w));

    section('ข6 · ใบใหม่ · ชื่อเอกสารเปลี่ยน (Q→OP) · ชื่อซ้ำในหน้าเดียว');
    w = await writeV3Orders(c, [snap(orderA(91000002, 'ZZQ3-0002'))]);
    r = await soRow(c, 'ZZQ3-0002');
    check('ใบใหม่ inserted=1 · model = N/A', w.inserted === 1 && r.model === 'N/A', JSON.stringify(w));
    w = await writeV3Orders(c, [snap(orderA(91000002, 'ZZV3-0002', { 'V3 Updated At': T2 }))]);
    const d2 = await c.query(`SELECT order_reference FROM sale_order_details WHERE sale_order_id = 91000002`);
    const ghost = await soRow(c, 'ZZQ3-0002');
    check('รายละเอียดตามชื่อใหม่ (คีย์ sale_order_id) · แถว Q เดิมค้างเหมือนพฤติกรรม v2',
      d2.rows[0]?.order_reference === 'ZZV3-0002' && !!ghost, d2.rows[0]?.order_reference);
    const dup = [snap(orderA(91000004, 'ZZV3-0004')), snap(orderA(91000005, 'ZZV3-0004', { 'V3 Updated At': T2 }))];
    w = await writeV3Orders(c, dup);
    const kept = await c.query(`SELECT sale_order_id FROM sale_orders WHERE order_reference = 'ZZV3-0004'`);
    check('ชื่อเดียวกันสองใบในหน้าเดียว ไม่ล้มทั้งคำสั่ง · เก็บใบที่ใหม่กว่า', kept.rows[0]?.sale_order_id === 91000005 && w.detailsWritten === 2);
    w = await writeV3Orders(c, []);
    check('รายการว่าง = ไม่ยิงอะไร', w.orders === 0 && w.detailsWritten === 0);

    section('ข7 · วันตัด: ใบก่อน 2022 เก็บเฉพาะที่มีในฐานแล้ว');
    const OLD_DATE = { 'Order Date': '2021-06-01T03:00:00.000Z' };
    await c.query(`INSERT INTO sale_orders (order_reference, sale_order_id) VALUES ('ZZV3-2101', 91002101)`);
    const batch = [
      snap(orderA(91002101, 'ZZV3-2101', OLD_DATE)),   // ก่อนวันตัด + มีในฐาน ⇒ เก็บ (อัปเดตต่อ)
      snap(orderA(91002102, 'ZZV3-2102', OLD_DATE)),   // ก่อนวันตัด + ไม่มีในฐาน ⇒ ข้าม
      snap(orderA(91002201, 'ZZV3-2201')),             // หลังวันตัด ⇒ เก็บ
    ];
    const { kept: storable, skipped } = await selectStorable(c, batch);
    check('เก็บ 2 · ข้าม 1 (ใบเก่าที่ไม่เคยอยู่ในฐาน)', skipped === 1 && storable.map((o) => o.orderReference).join() === 'ZZV3-2101,ZZV3-2201',
      storable.map((o) => o.orderReference).join());
    const onlyNew = await selectStorable(c, [batch[2]]);
    check('ไม่มีใบก่อนวันตัด = ไม่ถามฐาน คืนชุดเดิม', onlyNew.skipped === 0 && onlyNew.kept[0] === batch[2]);
  } finally {
    await c.query('ROLLBACK').catch(() => {});   // ห้ามเปลี่ยนเป็น COMMIT
    c.release();
  }
}

// ── ส่วน ค ─────────────────────────────────────────────────────────────────────
async function partC() {
  const c = await pool.connect();
  const T2 = '2026-09-21T00:00:00.000Z';
  const calls: string[] = [];
  const pages: Record<string, any> = {
    // หน้าแรกตอบ has_more=false ทั้งที่ยังมีต่อ (บั๊กที่ Appsale เจอ) — ต้องไปต่อเพราะ cursor ขยับ
    since: { data: [...orderA(91003001, 'ZZV3-3001'), ...orderA(91003002, 'ZZV3-3002')], has_more: false,
             next_cursor: 'c1', sale_order_count: 2, next_position: { updated_at: T1 } },
    c1: { data: orderA(91003003, 'ZZV3-3003', { 'V3 Updated At': T2 }), has_more: true,
          next_cursor: 'c2', sale_order_count: 1, next_position: { updated_at: T2 } },
    c2: { data: [], has_more: false, next_cursor: null, sale_order_count: 0 },
  };
  const gatewayGet = async (path: string) => {
    calls.push(path);
    const p = pages[new URLSearchParams(path.split('?')[1]).get('cursor') ?? 'since'];
    if (!p) throw new Error(`gateway จำลองไม่มีหน้า ${path}`);
    return { payload: p };
  };
  const state = async (resource: string) =>
    (await c.query(`SELECT sync_cursor, sync_cursor_timestamp, sync_mode, pages_synced, last_success_at
                      FROM sync_state WHERE resource = $1`, [resource])).rows[0];
  const count = async () => Number((await c.query(`SELECT count(*) FROM sale_orders`)).rows[0].count);
  try {
    await setup(c, '');
    await c.query(`CREATE TEMP TABLE sync_state (LIKE public.sync_state INCLUDING ALL)`);
    if (!(await assertShadowed(c, 'ค0', ['sale_orders', 'sale_order_details', 'sync_state']))) return;
    const held = await c.query(`SELECT pg_try_advisory_lock(hashtext('sync:sale_order_v3')) AS ok`);
    if (!held.rows[0].ok) { check('ค0 · advisory lock ว่าง (มีรอบ v3 จริงกำลังรัน — ข้ามส่วน ค)', false); return; }
    await c.query(`SELECT pg_advisory_unlock(hashtext('sync:sale_order_v3'))`);
    await c.query(`INSERT INTO sync_state (resource, sync_cursor, sync_mode, last_success_at)
                   VALUES ('sale_order', 'v2-cursor', 'incremental', '2000-01-01')`);

    section('ค1 · กวาดครั้งแรกจนจบ — ไม่เชื่อ has_more ตัวเดียว');
    const r1 = await runSaleOrderV3Sweep({ mirrorStatus: true, label: 'diag-v3' }, { client: c, gatewayGet });
    check('3 หน้า (หน้าแรก has_more=false แต่ไปต่อ) · 3 ใบ ใหม่ทั้งหมด',
      r1.pages === 3 && r1.orders === 3 && r1.write.inserted === 3 && (await count()) === 3, JSON.stringify({ pages: r1.pages, ...r1.write }));
    check('หน้าแรกถามด้วย since=2021-12-01 แล้วตาม cursor', calls[0].includes('since=2021-12-01') && calls[1].includes('cursor=c1') && calls[2].includes('cursor=c2'),
      calls.map((x) => x.split('?')[1]).join(' | '));
    const s1 = await state('sale_order_v3');
    check('state ของ v3: cursor หน้าสุดท้าย · เวลา · เปลี่ยนเป็น incremental',
      s1.sync_cursor === 'c2' && s1.sync_cursor_timestamp === T2 && s1.sync_mode === 'incremental', JSON.stringify(s1));
    const v2s = await state('sale_order');
    check('แถวของ v2: cursor ไม่ถูกแตะ · เวลาสำเร็จล่าสุดถูกอัปเดตให้หน้าสถานะ',
      v2s.sync_cursor === 'v2-cursor' && new Date(v2s.last_success_at).getFullYear() > 2000 && v2s.pages_synced === 3, JSON.stringify(v2s));

    section('ค2 · รอบ incremental ที่ไม่มีอะไรใหม่');
    calls.length = 0;
    const r2 = await runSaleOrderV3Sweep({ label: 'diag-v3' }, { client: c, gatewayGet });
    check('1 หน้า (หน้าว่าง) · ไม่เขียนอะไร · cursor เดิม', r2.pages === 1 && r2.orders === 0 && calls.length === 1
      && calls[0].includes('cursor=c2') && (await state('sale_order_v3')).sync_cursor === 'c2');

    section('ค3 · หน้าผิดรูป = throw · rollback · cursor ไม่ขยับ');
    const A = orderA(91003004, 'ZZV3-3004');
    pages.c2 = { data: [A[0], ...orderA(91003005, 'ZZV3-3005'), ...A.slice(1)], has_more: true, next_cursor: 'c3', sale_order_count: 2 };
    let err: unknown = null;
    try { await runSaleOrderV3Sweep({ label: 'diag-v3' }, { client: c, gatewayGet }); } catch (e) { err = e; }
    check('throw V3ShapeError · ไม่มีใบใหม่ · cursor ยังเป็น c2', err instanceof V3ShapeError && (await count()) === 3
      && (await state('sale_order_v3')).sync_cursor === 'c2', String((err as Error)?.message).slice(0, 80));

    section('ค4 · มีรอบ v3 อื่นถือล็อกอยู่ = ไม่รัน');
    const other = await pool.connect();
    try {
      await other.query(`SELECT pg_advisory_lock(hashtext('sync:sale_order_v3'))`);
      err = null;
      try { await runSaleOrderV3Sweep({ label: 'diag-v3' }, { client: c, gatewayGet }); } catch (e) { err = e; }
      check('throw "อีกรอบกำลังรันอยู่" ก่อนยิง gateway', /อีกรอบกำลังรันอยู่/.test(String((err as Error)?.message)));
    } finally {
      await other.query(`SELECT pg_advisory_unlock(hashtext('sync:sale_order_v3'))`).catch(() => {});
      other.release();
    }

    section('ค5 · --restart เริ่มใหม่จาก since โดยไม่แตะ v2');
    pages.c2 = { data: [], has_more: false, next_cursor: null, sale_order_count: 0 };
    calls.length = 0;
    const r5 = await runSaleOrderV3Sweep({ restart: true, label: 'diag-v3' }, { client: c, gatewayGet });
    check('กลับไปเริ่มที่ since · 3 หน้า · ค่าเท่าเดิม = ไม่เขียนซ้ำ', calls[0].includes('since=') && r5.pages === 3
      && r5.write.untouched === 3 && r5.write.inserted === 0, JSON.stringify(r5.write));
    check('cursor ของ v2 ยังเป็นค่าเดิม', (await state('sale_order')).sync_cursor === 'v2-cursor');

    // ทางเดียวกับที่ syncService เรียก (fn({ forceFull })) — ปุ่ม Full sync ใบสั่งขายต้องยังใช้ได้เมื่อเป็น v3
    section('ค6 · ปุ่ม Full sync ใบสั่งขาย (forceFull) ผ่านตัวเลือกเวอร์ชัน = กวาดใหม่ด้วย v3');
    const savedVer = process.env.SALEORDER_API_VERSION;
    delete process.env.SALEORDER_API_VERSION;
    try {
      calls.length = 0;
      const r6 = await syncSaleOrders({ forceFull: true }, { client: c, gatewayGet }) as Awaited<ReturnType<typeof runSaleOrderV3Sweep>>;
      check('ไม่ throw · กลับไปเริ่มที่ since · 3 หน้า · จบเป็น incremental', calls[0]?.includes('since=2021-12-01') && r6?.pages === 3
        && (await state('sale_order_v3')).sync_mode === 'incremental', calls.map((x) => x.split('?')[1]).join(' | '));
      const v2f = await state('sale_order');
      check('cursor ของ v2 ไม่ถูกล้าง · หน้าสถานะได้จำนวนหน้าของรอบนี้', v2f.sync_cursor === 'v2-cursor' && v2f.pages_synced === 3,
        JSON.stringify(v2f));
      calls.length = 0;
      const r7 = await syncSaleOrders({}, { client: c, gatewayGet }) as Awaited<ReturnType<typeof runSaleOrderV3Sweep>>;
      check('รอบอัตโนมัติ (ไม่มี forceFull) = เดินต่อจาก cursor ไม่เริ่มใหม่', r7?.pages === 1 && calls.length === 1
        && calls[0].includes('cursor=c2'), calls.map((x) => x.split('?')[1]).join(' | '));
    } finally {
      if (savedVer === undefined) delete process.env.SALEORDER_API_VERSION; else process.env.SALEORDER_API_VERSION = savedVer;
    }
    const lk = await c.query(`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`);
    check('จบแล้วไม่เหลือ advisory lock ค้างบน connection', Number(lk.rows[0].count) === 0);
  } finally {
    await c.query(`DROP TABLE IF EXISTS pg_temp.sale_orders, pg_temp.sale_order_details, pg_temp.sync_state`).catch(() => {});
    c.release(true);   // ทิ้ง session ไปเลย — ของชั่วคราวทุกอย่างหายตามไปแม้ DROP ล้ม
  }
}

async function main() {
  partA();
  await partB();
  await partC();
  console.log(`\n${fail === 0 ? '✓' : '✗'} saleorder-v3: ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  await pool.end();
  if (fail > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error('✗ diag ล้มกลางทาง:', e);
  await pool.end().catch(() => {});
  process.exit(1);
});
