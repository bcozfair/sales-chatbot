/**
 * dataDirectoryRepo — SQL ของหน้า "ข้อมูลสินค้า" และ "ข้อมูลลูกค้า" (อ่านอย่างเดียว)
 *
 * แยกไฟล์จาก db/repositories.ts เพราะไฟล์นั้น 1,485 บรรทัดแล้ว และของชุดนี้เป็นหน้าจอใหม่
 * ที่ไม่มีใครเรียกซ้ำจากที่อื่น — กฎ layer ยังเหมือนเดิมทุกข้อ: **SQL ทั้งหมดของสองหน้านี้
 * อยู่ในไฟล์นี้ที่เดียว** route/service ห้ามเขียน SQL เอง
 *
 * ทั้งสองหน้าเป็น **อ่านอย่างเดียว** — ต้นทางคือ Odoo การแก้ในแอดมินจะถูก sync ทับรอบถัดไป
 *
 * ── ตัวเลขที่ออกแบบ query ชุดนี้ (วัดบนฐาน dev 2026-09-17) ───────────────────
 *   products               51,665 แถว
 *   customers_data_view    82,721 แถว / 53,490 บริษัท
 *   sale_orders           320,090 แถว **และ 320,090 order_reference** ⇒ 1 แถว = 1 ใบจริง ๆ
 *                          (คอลัมน์ model/quantity ทำให้ดูเหมือนระดับบรรทัด แต่ไม่ใช่)
 *   ⇒ ต้องแบ่งหน้าฝั่ง server ทั้งคู่ ส่งทั้งก้อนไม่ได้
 */
import { pool } from '../config/db.js';

function logErr(fn: string, err: any): void {
  console.error(`[dataDirectoryRepo.${fn}]`, err?.message || err);
}

/** เพดานของ page size — กันคนยิง ?limit=999999 แล้วดึงทั้งตาราง */
export const DIRECTORY_MAX_LIMIT = 200;

export function clampLimit(raw: unknown, fallback = 50): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), DIRECTORY_MAX_LIMIT);
}

export function clampOffset(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// ═══════════════════════════ สินค้า ═══════════════════════════

export interface ProductDirectoryRow {
  product_template_id: number;
  internal_reference: string | null;
  name: string | null;
  brand: string | null;
  series: string | null;
  model: string | null;
  sales_price: string | null;
  minimum_sales_price: string | null;
  product_group: string | null;
  product_category: string | null;
  product_sub_category: string | null;
  production: string | null;
  quantity_on_hand: string | null;
  quantity_on_hand_unreserved: string | null;
  unit_of_measure: string | null;
  sales_description: string | null;
  is_system_item: boolean;
  sync_updated_at: string | null;
}

export interface ProductDirectoryFilter {
  q?: string;
  group?: string;
  brand?: string;
  production?: string;
  /** 'has' มีของพร้อมขาย · 'none' ไม่มี · 'resv' มีของแต่ถูกจองบางส่วน */
  stock?: string;
  /** 'noprice' | 'minge' | 'nobrand' | 'nodesc' */
  flag?: string;
  sort?: string;
  dir?: string;
  limit?: number;
  offset?: number;
}

/**
 * คอลัมน์ที่ยอมให้เรียง — allowlist ไม่ใช่การต่อสตริงจาก query string
 * (ค่าที่ไม่อยู่ในนี้ตกไปใช้ค่าเริ่มต้น ไม่ throw เพราะผู้ใช้ไม่ได้ทำอะไรผิด)
 */
const PRODUCT_SORTS: Record<string, string> = {
  internal_reference: 'p.internal_reference',
  name: 'p.name',
  brand: 'p.brand',
  production: 'p.production',
  product_group: 'p.product_group',
  sales_price: 'p.sales_price',
  minimum_sales_price: 'p.minimum_sales_price',
  quantity_on_hand_unreserved: 'p.quantity_on_hand_unreserved',
};

/** ประกอบ WHERE + params ของหน้าสินค้า — ใช้ร่วมกันระหว่าง query ข้อมูลกับ query นับ */
function productWhere(f: ProductDirectoryFilter): { sql: string; params: any[] } {
  const where: string[] = [];
  const params: any[] = [];

  if (f.q && f.q.trim()) {
    params.push(`%${f.q.trim()}%`);
    const i = params.length;
    // ครอบ 5 ช่องเหมือน /api/products/search ที่มี trgm index รองรับอยู่แล้ว
    where.push(`(p.internal_reference ILIKE $${i} OR p.name ILIKE $${i} OR p.model ILIKE $${i}
                 OR p.brand ILIKE $${i} OR p.series ILIKE $${i})`);
  }
  if (f.group) { params.push(f.group); where.push(`p.product_group = $${params.length}`); }
  if (f.brand) { params.push(f.brand); where.push(`p.brand = $${params.length}`); }
  if (f.production) { params.push(f.production); where.push(`p.production = $${params.length}`); }

  // สต็อกที่ "พร้อมขาย" คือ unreserved ไม่ใช่ quantity_on_hand — ตรงกับที่ด่านกฎใช้ตัดสิน
  if (f.stock === 'has') where.push('p.quantity_on_hand_unreserved > 0');
  else if (f.stock === 'none') where.push('COALESCE(p.quantity_on_hand_unreserved, 0) <= 0');
  else if (f.stock === 'resv') where.push('p.quantity_on_hand > p.quantity_on_hand_unreserved');

  // ธงคุณภาพข้อมูล — สองข้อแรกคือของที่ทำให้ใบติด MIN_PRICE_VIOLATION
  if (f.flag === 'noprice') where.push('COALESCE(p.sales_price, 0) = 0');
  else if (f.flag === 'minge') where.push('p.sales_price > 0 AND p.minimum_sales_price >= p.sales_price');
  else if (f.flag === 'nobrand') where.push("p.brand IS NULL OR TRIM(p.brand) = ''");
  else if (f.flag === 'nodesc') where.push("p.sales_description IS NULL OR TRIM(p.sales_description) = ''");

  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

export async function listProducts(
  f: ProductDirectoryFilter,
): Promise<{ rows: ProductDirectoryRow[]; total: number }> {
  try {
    const { sql: whereSql, params } = productWhere(f);
    const orderCol = PRODUCT_SORTS[String(f.sort)] ?? PRODUCT_SORTS.internal_reference;
    const dir = String(f.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const limit = clampLimit(f.limit);
    const offset = clampOffset(f.offset);

    const rowsQ = pool.query(
      `SELECT p.product_template_id, p.internal_reference, p.name, p.brand, p.series, p.model,
              p.sales_price, p.minimum_sales_price, p.product_group, p.product_category,
              p.product_sub_category, p.production, p.quantity_on_hand, p.quantity_on_hand_unreserved,
              p.unit_of_measure, p.sales_description, p.is_system_item, p.sync_updated_at
         FROM products p
         ${whereSql}
        ORDER BY ${orderCol} ${dir} NULLS LAST, p.product_template_id ASC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const countQ = pool.query(`SELECT count(*)::int AS n FROM products p ${whereSql}`, params);
    const [rowsRes, countRes] = await Promise.all([rowsQ, countQ]);
    return { rows: rowsRes.rows as ProductDirectoryRow[], total: countRes.rows[0]?.n ?? 0 };
  } catch (err) {
    logErr('listProducts', err);
    return { rows: [], total: 0 };
  }
}

/** ตัวเลือกของ dropdown — มาจากค่าที่มีอยู่จริงในตาราง ไม่ใช่รายการที่พิมพ์ไว้ในโค้ด */
export async function getProductFacets(): Promise<{
  groups: { value: string; n: number }[];
  brands: { value: string; n: number }[];
  productions: { value: string; n: number }[];
}> {
  try {
    const q = (col: string) =>
      pool.query(
        `SELECT ${col} AS value, count(*)::int AS n FROM products
          WHERE ${col} IS NOT NULL AND TRIM(${col}) <> ''
          GROUP BY 1 ORDER BY 1`,
      );
    const [g, b, pr] = await Promise.all([q('product_group'), q('brand'), q('production')]);
    return { groups: g.rows, brands: b.rows, productions: pr.rows };
  } catch (err) {
    logErr('getProductFacets', err);
    return { groups: [], brands: [], productions: [] };
  }
}

/**
 * ตัวเลขสรุปบนหัวหน้าสินค้า
 * ไม่รวม "ถูกกฎบล็อก" ไว้ที่นี่ เพราะการจับคู่กฎ scope ทำใน TS (scopeMatch) ไม่ใช่ใน SQL
 * — service เป็นคนคำนวณต่อจากตัวเลขชุดนี้
 */
export async function getProductSummary(): Promise<{
  total: number; withStock: number; priceZero: number; minGe: number;
}> {
  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE quantity_on_hand_unreserved > 0)::int AS with_stock,
              count(*) FILTER (WHERE COALESCE(sales_price, 0) = 0)::int AS price_zero,
              count(*) FILTER (WHERE sales_price > 0 AND minimum_sales_price >= sales_price)::int AS min_ge
         FROM products`,
    );
    const r = rows[0] ?? {};
    return { total: r.total ?? 0, withStock: r.with_stock ?? 0, priceZero: r.price_zero ?? 0, minGe: r.min_ge ?? 0 };
  } catch (err) {
    logErr('getProductSummary', err);
    return { total: 0, withStock: 0, priceZero: 0, minGe: 0 };
  }
}

/** แหล่งผลิต + ซีรีส์ทั้งหมดที่มี — service ใช้คำนวณว่ากฎบล็อกกินสินค้าไปกี่ตัว */
export async function getProductionSeriesCounts(): Promise<
  { production: string | null; series: string | null; n: number }[]
> {
  try {
    const { rows } = await pool.query(
      `SELECT production, series, count(*)::int AS n FROM products GROUP BY 1, 2`,
    );
    return rows;
  } catch (err) {
    logErr('getProductionSeriesCounts', err);
    return [];
  }
}

// ═══════════════════════════ ลูกค้า / ผู้ติดต่อ ═══════════════════════════

export interface ContactDirectoryRow {
  company_id: number;
  contact_id: number;
  source: string | null;
  customer_name: string | null;
  customer_reference: string | null;
  customer_tax_id: string | null;
  customer_payment_terms: string | null;
  customer_sale_area: string | null;
  salesperson: string | null;
  sales_team: string | null;
  customer_type: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  contact_name: string | null;
  contact_mobile: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  invoice_street: string | null;
  invoice_district: string | null;
  invoice_sub_district: string | null;
  invoice_state: string | null;
  invoice_zip: string | null;
  last_order_at: string | null;
}

export interface CompanyDirectoryRow extends ContactDirectoryRow {
  contact_count: number;
  blacklisted: boolean;
}

export interface CustomerDirectoryFilter {
  q?: string;
  type?: string;
  /** ค่าตรง ๆ จาก customer_payment_terms หรือ '__credit' / '__null' */
  pay?: string;
  team?: string;
  state?: string;
  /** 'stale' เกิน 1 ปี · 'ok' อยู่ในเกณฑ์ · 'na' ไม่เข้าข่ายตรวจ */
  gate?: string;
  sort?: string;
  dir?: string;
  limit?: number;
  offset?: number;
}

const COMPANY_SORTS: Record<string, string> = {
  customer_name: 'v.customer_name',
  customer_type: 'v.customer_type',
  customer_payment_terms: 'v.customer_payment_terms',
  sales_team: 'v.sales_team',
  invoice_state: 'v.invoice_state',
};

const CONTACT_SORTS: Record<string, string> = {
  ...COMPANY_SORTS,
  contact_name: 'v.contact_name',
};

/**
 * เงื่อนไข "เป็นลูกค้าเครดิต" — ต้องตรงกับนิยามใน customers_data_build ทุกตัวอักษร
 * ('^[0-9]+ Days$' หรือขึ้นต้น 'เช็คล่วงหน้า') · ค่าใหม่ที่ Odoo เพิ่มมาแล้วไม่เข้าสองรูปแบบนี้
 * จะไม่ถูกนับว่าเป็นเครดิต ซึ่งเป็นพฤติกรรมเดียวกับด่านตรวจจริง
 */
const CREDIT_TERMS_SQL = `(v.customer_payment_terms ~ '^[0-9]+ Days$'
                        OR v.customer_payment_terms LIKE 'เช็คล่วงหน้า%')`;

function customerWhere(f: CustomerDirectoryFilter): { sql: string; params: any[] } {
  const where: string[] = [];
  const params: any[] = [];

  if (f.q && f.q.trim()) {
    params.push(`%${f.q.trim()}%`);
    const i = params.length;
    where.push(`(v.customer_name ILIKE $${i} OR v.contact_name ILIKE $${i}
                 OR v.customer_reference ILIKE $${i} OR v.customer_tax_id ILIKE $${i}
                 OR v.phone ILIKE $${i} OR v.mobile ILIKE $${i}
                 OR v.contact_mobile ILIKE $${i} OR v.contact_phone ILIKE $${i}
                 OR v.email ILIKE $${i} OR v.contact_email ILIKE $${i})`);
  }
  if (f.type) { params.push(f.type); where.push(`v.customer_type = $${params.length}`); }
  if (f.team) { params.push(f.team); where.push(`v.sales_team = $${params.length}`); }
  if (f.state) { params.push(f.state); where.push(`v.invoice_state = $${params.length}`); }

  if (f.pay === '__credit') where.push(CREDIT_TERMS_SQL);
  else if (f.pay === '__null') where.push('v.customer_payment_terms IS NULL');
  else if (f.pay) { params.push(f.pay); where.push(`v.customer_payment_terms = $${params.length}`); }

  // ด่านเครดิต: NULL = ไม่เข้าข่ายตรวจ (= ผ่าน) ไม่ใช่ "ไม่มีข้อมูล"
  if (f.gate === 'na') where.push('v.last_order_at IS NULL');
  else if (f.gate === 'stale') where.push("v.last_order_at < now() - interval '1 year'");
  else if (f.gate === 'ok') where.push("v.last_order_at >= now() - interval '1 year'");

  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

/**
 * มุมมอง "บริษัท" — ยุบ customers_data_view ขึ้นมา 1 ระดับ
 *
 * ทำไมต้องยุบ: customers_data_view เป็น 1 แถว = 1 ผู้ติดต่อ และฟิลด์ระดับบริษัทซ้ำทุกแถว
 * บริษัทหนึ่งมีผู้ติดต่อได้ถึง 12 คน ⇒ ตารางแบนจะซ้ำชื่อบริษัทเดิม 12 แถวติดกัน
 * (43,395 จาก 53,490 บริษัทมีผู้ติดต่อคนเดียว แต่ที่เหลือคือกลุ่มที่อ่านยากที่สุด)
 *
 * DISTINCT ON เลือกผู้ติดต่อ contact_id น้อยสุดเป็นตัวแทน — ตรงกับที่ comp propagation
 * ใน customers_data_build ใช้ ⇒ ค่าที่ได้คงที่และตรงกับที่อื่นในระบบ
 */
export async function listCompanies(
  f: CustomerDirectoryFilter,
): Promise<{ rows: CompanyDirectoryRow[]; total: number }> {
  try {
    const { sql: whereSql, params } = customerWhere(f);
    const orderCol = COMPANY_SORTS[String(f.sort)] ?? COMPANY_SORTS.customer_name;
    const dir = String(f.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const limit = clampLimit(f.limit);
    const offset = clampOffset(f.offset);

    const base = `
      FROM (
        SELECT DISTINCT ON (company_id) *
          FROM customers_data_view v
          ${whereSql}
         ORDER BY company_id, contact_id
      ) v`;

    const rowsQ = pool.query(
      `SELECT v.*,
              (SELECT count(*)::int FROM customers_data_view c WHERE c.company_id = v.company_id) AS contact_count,
              EXISTS (SELECT 1 FROM quotation_blacklist b WHERE b.company_id = v.company_id) AS blacklisted
       ${base}
       ORDER BY ${orderCol} ${dir} NULLS LAST, v.company_id ASC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const countQ = pool.query(`SELECT count(*)::int AS n ${base}`, params);
    const [rowsRes, countRes] = await Promise.all([rowsQ, countQ]);
    return { rows: rowsRes.rows as CompanyDirectoryRow[], total: countRes.rows[0]?.n ?? 0 };
  } catch (err) {
    logErr('listCompanies', err);
    return { rows: [], total: 0 };
  }
}

/** มุมมอง "ผู้ติดต่อ" — 1 แถวตรงกับ 1 แถวในตารางจริง */
export async function listContacts(
  f: CustomerDirectoryFilter,
): Promise<{ rows: ContactDirectoryRow[]; total: number }> {
  try {
    const { sql: whereSql, params } = customerWhere(f);
    const orderCol = CONTACT_SORTS[String(f.sort)] ?? CONTACT_SORTS.contact_name;
    const dir = String(f.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const limit = clampLimit(f.limit);
    const offset = clampOffset(f.offset);

    const rowsQ = pool.query(
      `SELECT v.*,
              EXISTS (SELECT 1 FROM quotation_blacklist b
                       WHERE b.company_id = v.company_id
                         AND (b.contact_id IS NULL OR b.contact_id = v.contact_id)) AS blacklisted
         FROM customers_data_view v
         ${whereSql}
        ORDER BY ${orderCol} ${dir} NULLS LAST, v.contact_id ASC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const countQ = pool.query(`SELECT count(*)::int AS n FROM customers_data_view v ${whereSql}`, params);
    const [rowsRes, countRes] = await Promise.all([rowsQ, countQ]);
    return { rows: rowsRes.rows, total: countRes.rows[0]?.n ?? 0 };
  } catch (err) {
    logErr('listContacts', err);
    return { rows: [], total: 0 };
  }
}

/** ตัวเลือก dropdown ของหน้าลูกค้า */
export async function getCustomerFacets(): Promise<{
  types: { value: string; n: number }[];
  teams: { value: string; n: number }[];
  states: { value: string; n: number }[];
  payTerms: { value: string; n: number }[];
}> {
  try {
    const q = (col: string) =>
      pool.query(
        `SELECT ${col} AS value, count(*)::int AS n FROM customers_data_view
          WHERE ${col} IS NOT NULL AND TRIM(${col}) <> ''
          GROUP BY 1 ORDER BY 1`,
      );
    const [t, tm, st, pay] = await Promise.all([
      q('customer_type'), q('sales_team'), q('invoice_state'), q('customer_payment_terms'),
    ]);
    return { types: t.rows, teams: tm.rows, states: st.rows, payTerms: pay.rows };
  } catch (err) {
    logErr('getCustomerFacets', err);
    return { types: [], teams: [], states: [], payTerms: [] };
  }
}

// ═══════════════════════════ ประวัติส่วนลด ═══════════════════════════

export interface DiscountOrderRow {
  order_reference: string;
  order_date: string | null;
  total_amount: string | null;
  total_discount: string | null;
  invoice_status: string | null;
}

/**
 * ส่วนลดทั้งบิลของ N ใบล่าสุด ต่อ "รหัสลูกค้า" (company_id) หนึ่งราย
 *
 * ⚠️ ขอบเขตเป็น company_id เดียว **ไม่ขยายเป็นนิติบุคคล** — เจ้าของตัดสิน 2026-09-17
 *    เหตุผล: "รหัสลูกค้าไม่เหมือนกัน" คนละรหัสคือคนละข้อตกลงราคา สาขาที่เจรจาแยกกัน
 *    ได้ส่วนลดคนละอัตราจริง การเอามารวมจะโชว์ตัวเลขที่ไม่มีใบไหนเคยใช้
 *    **ต่างจากด่านเครดิต (last_order_at) ที่ขยายเป็นนิติบุคคล — ต่างกันโดยตั้งใจ
 *    ไม่ใช่ของค้างที่รอเก็บให้เหมือนกัน** ใครจะแก้ให้เหมือนกัน ต้องถามเจ้าของก่อน
 *
 * ⚠️ วิธีเขียนสำคัญกว่าขนาดข้อมูล (วัด 2026-09-17): กรอง contact_id ก่อนแล้วค่อย ORDER BY
 *    ⇒ ตรงกับ idx_so_contact_latest พอดี ได้ **1 ms** · ถ้าสร้าง CTE DISTINCT ON
 *    คร่อมทั้ง 320,090 แถวก่อนค่อยกรอง planner ใช้ index ไม่ได้เลยและ **timeout เกิน 15 วินาที**
 *
 * ⚠️ ส่งค่า total_discount ตรง ๆ ห้ามคำนวณใหม่จาก total_amount - amount_after_discount
 *    เพราะมี 2,362 ใบ (0.7%) ที่สามช่องนั้นไม่ลงตัวกันเองจากต้นทาง
 *
 * ⚠️ คืน order_date เป็น **วันไทยแบบ YYYY-MM-DD** ไม่ใช่ timestamp เต็ม —
 *    `formatDate()` ฝั่งหน้าจอรับเฉพาะรูปแบบวันล้วน (มันต่อ 'T00:00:00+07:00' เอง)
 *    ถ้าส่ง ISO เต็มไปจะได้ 'Invalid Date' โผล่บนจอโดยที่ไม่มีอะไร error (เจอจริงตอนเปิดดู 2026-09-17)
 *    · `timestamptz AT TIME ZONE 'Asia/Bangkok'` = เวลาตามนาฬิกาไทย แล้ว ::date = วันไทย
 *      ⇒ ผลไม่ขึ้นกับ TZ ของโปรเซส (host เป็น UTC · คอนเทนเนอร์ prod เป็น Asia/Bangkok)
 */
export async function getCompanyDiscountHistory(
  companyId: number,
  limit = 3,
): Promise<DiscountOrderRow[]> {
  try {
    const { rows } = await pool.query(
      `SELECT s.order_reference,
              to_char(s.order_date AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS order_date,
              s.total_amount, s.total_discount, s.invoice_status
         FROM sale_orders s
        WHERE s.contact_id IN (SELECT contact_id FROM customers_data_view WHERE company_id = $1)
        ORDER BY s.order_date DESC NULLS LAST, s.order_reference DESC
        LIMIT $2`,
      [companyId, Math.min(Math.max(1, limit), 20)],
    );
    return rows as DiscountOrderRow[];
  } catch (err) {
    logErr('getCompanyDiscountHistory', err);
    return [];
  }
}

/** ประวัติส่วนลดของหลายบริษัทพร้อมกัน — ใช้ตอนวาดตารางทั้งหน้า */
export async function getDiscountHistoryForCompanies(
  companyIds: number[],
  perCompany = 3,
): Promise<Map<number, DiscountOrderRow[]>> {
  const out = new Map<number, DiscountOrderRow[]>();
  if (!companyIds.length) return out;
  try {
    const { rows } = await pool.query(
      `SELECT c.company_id, x.order_reference, x.order_date, x.total_amount, x.total_discount, x.invoice_status
         FROM UNNEST($1::int[]) AS c(company_id)
         JOIN LATERAL (
           SELECT s.order_reference,
              to_char(s.order_date AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS order_date,
              s.total_amount, s.total_discount, s.invoice_status
             FROM sale_orders s
            WHERE s.contact_id IN (SELECT contact_id FROM customers_data_view WHERE company_id = c.company_id)
            ORDER BY s.order_date DESC NULLS LAST, s.order_reference DESC
            LIMIT $2
         ) x ON true`,
      [companyIds, Math.min(Math.max(1, perCompany), 20)],
    );
    for (const r of rows) {
      const list = out.get(r.company_id);
      const item: DiscountOrderRow = {
        order_reference: r.order_reference, order_date: r.order_date,
        total_amount: r.total_amount, total_discount: r.total_discount,
        invoice_status: r.invoice_status,
      };
      if (list) list.push(item);
      else out.set(r.company_id, [item]);
    }
    return out;
  } catch (err) {
    logErr('getDiscountHistoryForCompanies', err);
    return out;
  }
}

/** ผู้ติดต่อทั้งหมดของบริษัทหนึ่ง — ใช้ในแผงรายละเอียด */
export async function getCompanyContacts(companyId: number): Promise<ContactDirectoryRow[]> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM customers_data_view WHERE company_id = $1 ORDER BY contact_id`,
      [companyId],
    );
    return rows as ContactDirectoryRow[];
  } catch (err) {
    logErr('getCompanyContacts', err);
    return [];
  }
}

/**
 * นับสินค้าที่ถูกกฎ "เจาะจงระดับรหัส/รุ่น" บล็อก และ **ยังไม่ถูกนับจากกฎระดับกลุ่ม**
 *
 * มีไว้เพื่อให้ตัวเลข "ถูกกฎบล็อกไว้" บนหัวหน้าสินค้าตรงเป๊ะ ไม่ใช่ค่าประมาณ —
 * กฎกลุ่มนี้มีแค่ 5 ข้อ (วัด 2026-09-17) แต่ถ้าไม่นับ ตัวเลขจะน้อยกว่าความจริงเงียบ ๆ
 *
 * เทียบแบบ lower(btrim(...)) ให้ตรงกับ engine ฝั่ง TS (ruleMatchesScope) ทุกประการ
 */
export async function countProductsMatchingSpecificRules(
  rules: { internal_reference: string | null; model: string | null }[],
  blockedGroups: { production: string | null; series: string | null }[],
): Promise<number> {
  if (!rules.length) return 0;
  try {
    const refs = rules.map((r) => (r.internal_reference ?? '').trim().toLowerCase()).filter(Boolean);
    const models = rules.map((r) => (r.model ?? '').trim().toLowerCase()).filter(Boolean);
    const gProd = blockedGroups.map((g) => (g.production ?? '').trim().toLowerCase());
    const gSeries = blockedGroups.map((g) => (g.series ?? '').trim().toLowerCase());

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n
         FROM products p
        WHERE (lower(btrim(COALESCE(p.internal_reference, ''))) = ANY($1::text[])
            OR lower(btrim(COALESCE(p.model, ''))) = ANY($2::text[]))
          AND NOT EXISTS (
            SELECT 1 FROM UNNEST($3::text[], $4::text[]) AS g(prod, ser)
             WHERE g.prod = lower(btrim(COALESCE(p.production, '')))
               AND g.ser  = lower(btrim(COALESCE(p.series, '')))
          )`,
      [refs, models, gProd, gSeries],
    );
    return rows[0]?.n ?? 0;
  } catch (err) {
    logErr('countProductsMatchingSpecificRules', err);
    return 0;
  }
}
