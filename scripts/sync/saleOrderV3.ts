// ============================================================
// ตัวแปลงหน้าของ sale_order_updated_records_v3 → 1 ก้อนต่อใบ (pure · ไม่แตะ DB/network)
//
// v3 ส่ง 1 แถว = บรรทัดสินค้า × บรรทัดใบแจ้งหนี้ × MO และ "ไม่มี line id" (ขอเพิ่มจากทีม Odoo ไม่ได้)
// ไฟล์นี้จึงพึ่งข้อเท็จจริงที่วัดไว้ใน docs/plan-saleorder-v3.md ข้อ 3 — แถวของใบติดกัน · แถวแรกของ
// ทุกบรรทัดมี use_for_order_amount=true · ค่าระดับบรรทัดเท่ากันทุกแถวในกลุ่ม · หัวใบเท่ากันทุกแถว
// ข้อไหนไม่จริงในหน้าที่ได้มา = throw V3ShapeError แล้วผู้เรียก rollback ทั้งหน้า
// เพราะยอดทั้งใบที่ผิดแบบเงียบ ๆ แย่กว่า sync ที่หยุดแล้วมีคนเห็น (ถอยไป v2 ได้ — แผนข้อ 4.7)
//
// คอลัมน์เดิมของ sale_orders เขียนด้วยสูตรเดียวกับ upsertSaleOrderRows() ของ v2 ทุกตัวจาก "แถวแรกของใบ"
// (parseFloat · `|| 0` · `|| 'N/A'`) ⇒ ใบที่ข้อมูลไม่เปลี่ยน ค่าที่เขียนต้องเท่าของเดิมทุกไบต์ และ
// --v3-dry-run วัดข้อนี้กับฐานจริงได้ · **ห้ามจัดสูตรใหม่ให้ "ถูกกว่า"** ไม่งั้นทุกแถวจะขยับ updated_at
// ข้อยกเว้นเดียวคือ model (แผนข้อ 4.2) ซึ่งตัวเขียนจัดการเอง
// ============================================================

/** วันตัดของข้อมูล (เจ้าของเคาะ 2026-10-05) = 2022-01-01 00:00 เวลาไทย — ใบที่สั่งก่อนนี้เขียนได้
 *  **เฉพาะเมื่อมีอยู่ในฐานแล้ว** (ตัวเขียนถามฐาน · แผนข้อ 4.5) ⇒ ความครอบคลุมเท่ากับที่ v2 เคยให้เป๊ะ
 *  ห้ามเปลี่ยนเป็น "ย้อนหลัง N ปี" แบบเลื่อน — รายชื่อลูกค้า (Arm 2) และด่านเครดิตพึ่งใบเก่า (แผนข้อ 2) */
export const V3_ORDER_DATE_CUTOFF_ISO = '2021-12-31T17:00:00.000Z';

/** จุดเริ่มของการกวาดครั้งแรก — since= คัดตาม V3 Updated At ซึ่งไม่เคยเก่ากว่า Last Updated ของหัวใบ
 *  (วัด 992 แถว 2026-10-05) · ทุกแถวในฐานมี last_updated ตั้งแต่ 2022-01-03 · เผื่อหน้าวันตัดไว้หนึ่งเดือน */
export const V3_SWEEP_SINCE_ISO = '2021-12-01T00:00:00.000Z';

export type V3Row = Record<string, any>;

export interface V3Invoice {
  number: string | null;
  type: string | null;
  date: string | null;
  qty: number | null;
  unit_price: number | null;
  discount_pct: number | null;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  status: string | null;
}

export interface V3Mo {
  ref: string;
  deadline: string | null;
  planned_start: string | null;
  planned_finished: string | null;
  qty: number | null;
  routing: string | null;
  status: string | null;
}

export interface V3Line {
  model_code: string | null;
  model: string | null;
  qty: number | null;
  qty_invoiced: number | null;
  amount: number | null;
  discount: number | null;
  after_discount: number | null;
  vat: number | null;
  net: number | null;
  category: string | null;
  group: string | null;
  sub_category: string | null;
  series: string | null;
  invoices: V3Invoice[];
  mos: V3Mo[];
}

/** รูปของ sale_order_details.lines — เปลี่ยนรูปเมื่อไหร่ต้องขยับ v */
export interface V3Details {
  v: 3;
  src: string | null;
  lines: V3Line[];
}

export interface OrderTotals {
  /** ทศนิยมเป็นข้อความ คิดแบบไม่ผ่าน float — ส่งเข้าคอลัมน์ numeric ตรง ๆ */
  amount: string;
  discount: string;
  afterDiscount: string;
  vat: string;
  net: string;
  lineCount: number;
}

export interface OrderSnapshot {
  saleOrderId: number;
  orderReference: string;
  /** ISO · null = gateway ไม่ส่งมา (เขียนตามปกติ ไม่ตัดทิ้ง) */
  orderDate: string | null;
  /** "V3 Updated At" (ISO) — ตัวกันของเก่าทับของใหม่ */
  sourceUpdatedAt: string;
  /** คอลัมน์เดิมของ sale_orders ตามชื่อคอลัมน์ — สูตรเดียวกับ v2 */
  legacy: Record<string, unknown>;
  totals: OrderTotals;
  details: V3Details;
}

export class V3ShapeError extends Error {
  constructor(message: string) {
    super(`v3 รูปข้อมูลไม่ตรงที่ตัวแปลงพึ่ง — ${message}`);
    this.name = 'V3ShapeError';
  }
}

/** ช่องที่ต้องเท่ากันทุกแถวของใบเดียวกัน (Invoice Date ไม่อยู่ในนี้ — v3 เป็นของรายแถวใบแจ้งหนี้) */
const HEADER_FIELDS = [
  'Order Reference', 'V3 Updated At', 'V3 Update Sources', 'Order Date', 'Last Updated', 'Status',
  'Invoice Status', 'contact_id', 'company_id', 'salesperson_id', 'Customer/Reference', 'Customer/Name',
] as const;

/** ช่องระดับบรรทัด — ต้องเท่ากันทุกแถวในกลุ่มที่เริ่มด้วย use_for_order_amount=true */
const LINE_FIELDS = [
  'Model Code', 'Model', 'Quantity', 'Quantity Invoiced', 'ยอดรวม', 'ยอดรวมส่วนลด', 'มูลค่าหลังหักส่วนลด',
  'VAT', 'ยอดเงินสุทธิ', 'Product Category', 'Product Group', 'Product Sub Category', 'Product Series',
] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function iso(v: unknown): string | null {
  return v ? new Date(v as string).toISOString() : null;
}

// ── ผลรวมทศนิยมแบบตรง ─────────────────────────────────────────────────────────
// gateway ส่งยอดเป็นข้อความทศนิยมยาว ("7168.5000000000000000") ปนกับ number (VAT = 1170.855)
// บวกด้วย float แล้วจะได้ 3622.0800000000004 แบบที่คอลัมน์ vat เดิมมีอยู่ ⇒ บวกเป็นจำนวนเต็มสเกล 1e9
const SCALE = 9;
const SCALE_N = 10n ** BigInt(SCALE);

function toScaled(v: unknown): bigint {
  if (v === null || v === undefined || v === '') return 0n;
  let s = typeof v === 'number' ? (Number.isFinite(v) ? v.toFixed(SCALE) : '0') : String(v).trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return 0n;
    s = n.toFixed(SCALE);
  }
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace(/^[+-]/, '').split('.');
  const scaled = BigInt(i) * SCALE_N + BigInt((f + '0'.repeat(SCALE)).slice(0, SCALE));
  return neg ? -scaled : scaled;
}

export function sumDecimal(values: unknown[]): string {
  const total = values.reduce<bigint>((acc, v) => acc + toScaled(v), 0n);
  const neg = total < 0n;
  const abs = neg ? -total : total;
  const frac = (abs % SCALE_N).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${abs / SCALE_N}${frac ? `.${frac}` : ''}`;
}

// ── คอลัมน์เดิม — สูตรเดียวกับ upsertSaleOrderRows() ของ v2 (syncSaleorders.ts) ────────────────
function legacyColumns(row: V3Row): Record<string, unknown> {
  return {
    order_reference: row['Order Reference'],
    customer_reference: row['Customer/Reference'],
    customer_tax_id: row['Customer/Tax ID'],
    customer_name: row['Customer/Name'],
    contact_name: row['Contact/Name'],
    contact_mobile: row['Contact/Mobile'],
    contact_phone: row['Contact/Phone'],
    invoice_street: row['Invoice Address/Street'],
    invoice_district: row['Invoice Address/District'],
    invoice_sub_district: row['Invoice Address/Sub District'],
    invoice_state: row['Invoice Address/State'],
    invoice_zip: row['Invoice Address/Zip'],
    order_date: iso(row['Order Date']),
    customer_reference_po: row['Customer Reference'],
    delivery_street: row['Delivery Address/Street'],
    delivery_district: row['Delivery Address/District'],
    delivery_sub_district: row['Delivery Address/Sub District'],
    delivery_state: row['Delivery Address/State'],
    delivery_zip: row['Delivery Address/Zip'],
    employee_quotations: row['Employee Quotations'],
    employee_quotations_phone: row['Employee Quotations/Work Phone'],
    salesperson: row['Salesperson'],
    salesperson_phone: row['Salesperson/Phone'],
    sales_team: row['Sales Team'],
    customer_sale_area: row['Customer/Sale Area'],
    invoice_status: row['Invoice Status'],
    last_updated: iso(row['Last Updated']),
    sale_order_id: row['Sale Order ID'],
    company_id: row.company_id,
    contact_id: row.contact_id,
    salesperson_id: row.salesperson_id,
    total_amount: row['ยอดรวม'] ? parseFloat(row['ยอดรวม']) : 0,
    total_discount: row['ยอดรวมส่วนลด'] ? parseFloat(row['ยอดรวมส่วนลด']) : 0,
    amount_after_discount: row['มูลค่าหลังหักส่วนลด'] ? parseFloat(row['มูลค่าหลังหักส่วนลด']) : 0,
    vat: row.VAT ? parseFloat(row.VAT) : 0,
    net_amount: row['ยอดเงินสุทธิ'] ? parseFloat(row['ยอดเงินสุทธิ']) : 0,
    // ช่อง Model ของ v3 คือรหัสรุ่นย่อ ไม่ใช่ชื่อสินค้าเต็มแบบ v2 — ใบใหม่ได้ค่าเริ่มต้นของคอลัมน์
    // ส่วนใบเดิมตัวเขียนไม่แตะคอลัมน์นี้ (แผนข้อ 4.2) · ค่าของ v3 อยู่ที่ details.lines[].model
    model: 'N/A',
    model_code: row['Model Code'] || 'N/A',
    quantity: row.Quantity ? parseFloat(row.Quantity) : 0,
    product_category: row['Product Category'],
    product_group: row['Product Group'],
    product_sub_category: row['Product Sub Category'],
    product_series: row['Product Series'],
    order_status: row.Status,
    invoice_date: iso(row['Invoice Date']),
    source: row.Source,
  };
}

function toLine(group: V3Row[]): V3Line {
  const first = group[0];
  const invoices: V3Invoice[] = [];
  const mos: V3Mo[] = [];
  for (const r of group) {
    if (r.use_for_invoice_amount === true && r['Invoice Number']) {
      invoices.push({
        number: str(r['Invoice Number']),
        type: str(r['Invoice Type']),
        date: str(r['Invoice Date']),
        qty: num(r['Invoice Quantity']),
        unit_price: num(r['Invoice Unit Price']),
        discount_pct: num(r['Invoice Discount (%)']),
        subtotal: num(r['Invoice Subtotal']),
        vat: num(r['Invoice VAT']),
        total: num(r['Invoice Total']),
        status: str(r['Invoice Line Status']),
      });
    }
    if (r.use_for_mo === true && r['MO Reference']) {
      mos.push({
        ref: String(r['MO Reference']),
        deadline: str(r['Deadline']),
        planned_start: str(r['MO Planned Start']),
        planned_finished: str(r['MO Planned Finished']),
        qty: num(r['MO Quantity']),
        routing: str(r['MO Routing']),
        status: str(r['MO Status']),
      });
    }
  }
  return {
    model_code: str(first['Model Code']),
    model: str(first['Model']),
    qty: num(first['Quantity']),
    qty_invoiced: num(first['Quantity Invoiced']),
    amount: num(first['ยอดรวม']),
    discount: num(first['ยอดรวมส่วนลด']),
    after_discount: num(first['มูลค่าหลังหักส่วนลด']),
    vat: num(first['VAT']),
    net: num(first['ยอดเงินสุทธิ']),
    category: str(first['Product Category']),
    group: str(first['Product Group']),
    sub_category: str(first['Product Sub Category']),
    series: str(first['Product Series']),
    invoices,
    mos,
  };
}

function toSnapshot(rows: V3Row[]): OrderSnapshot {
  const first = rows[0];
  const id = first['Sale Order ID'];
  const ref = first['Order Reference'];

  for (const r of rows) {
    for (const f of HEADER_FIELDS) {
      if (!same(r[f], first[f])) throw new V3ShapeError(`ใบ ${ref} (id ${id}) ช่องหัวใบ "${f}" ไม่เท่ากันทุกแถว`);
    }
  }
  if (first.use_for_order_amount !== true) {
    throw new V3ShapeError(`ใบ ${ref} (id ${id}) แถวแรกไม่ใช่ use_for_order_amount=true — แบ่งบรรทัดไม่ได้`);
  }

  // แบ่งบรรทัด: กลุ่มใหม่เริ่มที่แถว use_for_order_amount=true ทุกครั้ง
  const groups: V3Row[][] = [];
  for (const r of rows) {
    if (r.use_for_order_amount === true) groups.push([r]);
    else groups[groups.length - 1].push(r);
  }
  for (const [i, g] of groups.entries()) {
    for (const r of g) {
      for (const f of LINE_FIELDS) {
        if (!same(r[f], g[0][f])) {
          throw new V3ShapeError(`ใบ ${ref} (id ${id}) บรรทัดที่ ${i + 1} ช่อง "${f}" ไม่เท่ากันทุกแถวในกลุ่ม`);
        }
      }
    }
  }

  const heads = groups.map((g) => g[0]);
  return {
    saleOrderId: id,
    orderReference: ref,
    orderDate: iso(first['Order Date']),
    sourceUpdatedAt: new Date(first['V3 Updated At']).toISOString(),
    legacy: legacyColumns(first),
    totals: {
      amount: sumDecimal(heads.map((r) => r['ยอดรวม'])),
      discount: sumDecimal(heads.map((r) => r['ยอดรวมส่วนลด'])),
      afterDiscount: sumDecimal(heads.map((r) => r['มูลค่าหลังหักส่วนลด'])),
      vat: sumDecimal(heads.map((r) => r['VAT'])),
      net: sumDecimal(heads.map((r) => r['ยอดเงินสุทธิ'])),
      lineCount: groups.length,
    },
    details: { v: 3, src: str(first['V3 Update Sources']), lines: groups.map(toLine) },
  };
}

export interface PageContext {
  /** payload.sale_order_count — จำนวนใบที่แตกออกมาต้องไม่เกินนี้ (ใบไม่มีบรรทัดนับแต่ไม่มีแถว) */
  saleOrderCount?: number | null;
  /** ใบสุดท้ายของหน้าก่อน — ใบเดียวกันที่ V3 Updated At เท่าเดิมโผล่หัวหน้านี้ = ถูกตัดข้ามหน้า */
  prevPageLast?: { saleOrderId: number; sourceUpdatedAt: string } | null;
}

/** แตก 1 หน้าเป็นก้อนต่อใบ ตามลำดับที่ gateway ส่ง · ผิดรูป = throw V3ShapeError */
export function normalizeV3Page(rows: V3Row[], ctx: PageContext = {}): OrderSnapshot[] {
  const byOrder: V3Row[][] = [];
  const seen = new Set<number>();
  let currentId: number | null = null;

  for (const [i, r] of rows.entries()) {
    const id = r?.['Sale Order ID'];
    if (!Number.isInteger(id) || id <= 0) throw new V3ShapeError(`แถวที่ ${i + 1} ไม่มี Sale Order ID`);
    if (typeof r['Order Reference'] !== 'string' || !r['Order Reference']) {
      throw new V3ShapeError(`แถวที่ ${i + 1} (id ${id}) ไม่มี Order Reference`);
    }
    if (!r['V3 Updated At'] || Number.isNaN(Date.parse(r['V3 Updated At']))) {
      throw new V3ShapeError(`แถวที่ ${i + 1} (id ${id}) ไม่มี V3 Updated At ที่อ่านได้`);
    }
    if (id !== currentId) {
      if (seen.has(id)) throw new V3ShapeError(`แถวของใบ id ${id} ไม่อยู่ติดกัน`);
      seen.add(id);
      byOrder.push([]);
      currentId = id;
    }
    byOrder[byOrder.length - 1].push(r);
  }

  if (typeof ctx.saleOrderCount === 'number' && byOrder.length > ctx.saleOrderCount) {
    throw new V3ShapeError(`แตกได้ ${byOrder.length} ใบ มากกว่า sale_order_count=${ctx.saleOrderCount}`);
  }

  const orders = byOrder.map(toSnapshot);

  const prev = ctx.prevPageLast;
  if (prev && orders.length > 0
      && orders[0].saleOrderId === prev.saleOrderId && orders[0].sourceUpdatedAt === prev.sourceUpdatedAt) {
    throw new V3ShapeError(`ใบ ${orders[0].orderReference} (id ${prev.saleOrderId}) ถูกตัดข้ามหน้า`);
  }
  return orders;
}

/** ใบที่สั่งก่อนวันตัด — ตัวเขียนเก็บเฉพาะใบที่มีในฐานอยู่แล้ว (selectStorable) · ไม่มีวันที่ = ไม่ตัด */
export function isBeforeCutoff(order: OrderSnapshot): boolean {
  return order.orderDate !== null && order.orderDate < V3_ORDER_DATE_CUTOFF_ISO;
}
