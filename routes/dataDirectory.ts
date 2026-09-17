import { Router, type Request, type Response } from 'express';
import { Parser } from 'json2csv';
import {
  getProductDirectory, getProductDirectorySummary, getProductFacets,
  getCompanyDirectory, getContactDirectory, getCompanyDetail, getCustomerFacets,
} from '../services/dataDirectoryService.js';
import { DIRECTORY_MAX_LIMIT } from '../db/dataDirectoryRepo.js';

/**
 * API ของสองหน้าใหม่: "ข้อมูลสินค้า" และ "ข้อมูลลูกค้า"
 *
 * ⚠️ ไฟล์ใหม่ทั้งไฟล์ ไม่แตะ endpoint เดิมสักตัว (ท่าเดียวกับ routes/logs.ts)
 *    ถอนทั้งงานออก = ลบไฟล์นี้ + services/dataDirectoryService.ts + db/dataDirectoryRepo.ts
 *    + services/rules/productRuleSets.ts + 2 บรรทัดใน index.ts
 *
 * **สิทธิ์บังคับที่จุด mount ใน index.ts** (adminAuthMiddleware + requireRole) ไม่ใช่ในไฟล์นี้
 * ⇒ ไม่มีทางที่ route ใหม่จะหลุดออกไปโดยไม่มีการตรวจสิทธิ์
 * เจ้าของกำหนด 2026-09-17: admin · approver · subadmin เห็นได้ (ไม่รวม role 'user')
 *
 * ทุกเส้นเป็น **อ่านอย่างเดียว** — ไม่มี POST/PUT/DELETE โดยตั้งใจ ต้นทางคือ Odoo
 */
export const dataDirectoryRouter = Router();

/** อ่านค่าจาก query string ให้เป็นสตริงเสมอ (express คืน array ได้ถ้าส่งซ้ำ) */
function str(v: unknown): string | undefined {
  if (Array.isArray(v)) v = v[0];
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

// ═══════════════════════════ สินค้า ═══════════════════════════

dataDirectoryRouter.get('/products', async (req: Request, res: Response) => {
  try {
    const { items, total } = await getProductDirectory({
      q: str(req.query.q),
      group: str(req.query.group),
      brand: str(req.query.brand),
      production: str(req.query.production),
      stock: str(req.query.stock),
      flag: str(req.query.flag),
      sort: str(req.query.sort),
      dir: str(req.query.dir),
      limit: Number(req.query.limit),
      offset: Number(req.query.offset),
    });
    res.json({ items, total, maxLimit: DIRECTORY_MAX_LIMIT });
  } catch (err: any) {
    console.error('GET /api/admin/data/products error:', err);
    res.status(500).json({ error: err?.message || 'ดึงข้อมูลสินค้าไม่สำเร็จ' });
  }
});

dataDirectoryRouter.get('/products/summary', async (_req: Request, res: Response) => {
  try {
    res.json(await getProductDirectorySummary());
  } catch (err: any) {
    console.error('GET /api/admin/data/products/summary error:', err);
    res.status(500).json({ error: err?.message || 'ดึงตัวเลขสรุปไม่สำเร็จ' });
  }
});

dataDirectoryRouter.get('/products/facets', async (_req: Request, res: Response) => {
  try {
    res.json(await getProductFacets());
  } catch (err: any) {
    console.error('GET /api/admin/data/products/facets error:', err);
    res.status(500).json({ error: err?.message || 'ดึงตัวเลือกตัวกรองไม่สำเร็จ' });
  }
});

// ═══════════════════════════ ลูกค้า ═══════════════════════════

dataDirectoryRouter.get('/customers', async (req: Request, res: Response) => {
  try {
    const filter = {
      q: str(req.query.q),
      type: str(req.query.type),
      pay: str(req.query.pay),
      team: str(req.query.team),
      state: str(req.query.state),
      gate: str(req.query.gate),
      sort: str(req.query.sort),
      dir: str(req.query.dir),
      limit: Number(req.query.limit),
      offset: Number(req.query.offset),
    };
    // มุมมองบริษัท = ยุบขึ้น 1 ระดับ (ค่าเริ่มต้นตามที่เจ้าของเลือก 2026-09-17)
    // มุมมองผู้ติดต่อ = 1 แถวตรงกับ 1 แถวในตารางจริง
    const view = str(req.query.view) === 'contact' ? 'contact' : 'company';
    const data = view === 'company' ? await getCompanyDirectory(filter) : await getContactDirectory(filter);
    res.json({ ...data, view, maxLimit: DIRECTORY_MAX_LIMIT });
  } catch (err: any) {
    console.error('GET /api/admin/data/customers error:', err);
    res.status(500).json({ error: err?.message || 'ดึงข้อมูลลูกค้าไม่สำเร็จ' });
  }
});

dataDirectoryRouter.get('/customers/facets', async (_req: Request, res: Response) => {
  try {
    res.json(await getCustomerFacets());
  } catch (err: any) {
    console.error('GET /api/admin/data/customers/facets error:', err);
    res.status(500).json({ error: err?.message || 'ดึงตัวเลือกตัวกรองไม่สำเร็จ' });
  }
});

dataDirectoryRouter.get('/customers/:companyId', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.companyId);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'company_id ไม่ถูกต้อง' });
    const detail = await getCompanyDetail(id);
    if (!detail) return res.status(404).json({ error: 'ไม่พบบริษัทนี้' });
    res.json(detail);
  } catch (err: any) {
    console.error('GET /api/admin/data/customers/:companyId error:', err);
    res.status(500).json({ error: err?.message || 'ดึงรายละเอียดไม่สำเร็จ' });
  }
});

// ═══════════════════════════ ส่งออก CSV ═══════════════════════════

/**
 * ส่งออก **เฉพาะที่กรองอยู่** (เจ้าของกำหนด 2026-09-17) — ไม่ใช่ทั้งฐาน
 * ⇒ รับ query string ชุดเดียวกับตาราง แล้วดึงซ้ำด้วย limit ที่สูงกว่า
 *
 * เพดาน 10,000 แถวเพื่อไม่ให้คนเผลอส่งออกทั้ง 82,721 แถวแล้วโหลดค้าง —
 * ถ้าเกิน ตอบ 413 พร้อมบอกจำนวนจริง ให้ผู้ใช้กรองให้แคบลงก่อน
 */
const CSV_MAX_ROWS = 10_000;

function sendCsv(res: Response, filename: string, fields: { label: string; value: string }[], rows: any[]) {
  // BOM ให้ Excel บนวินโดวส์อ่านภาษาไทยออก — ขาดบรรทัดนี้แล้วไฟล์เปิดมาเป็นตัวยึกยือ
  const csv = '﻿' + new Parser({ fields }).parse(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

dataDirectoryRouter.get('/products/export', async (req: Request, res: Response) => {
  try {
    const base = {
      q: str(req.query.q), group: str(req.query.group), brand: str(req.query.brand),
      production: str(req.query.production), stock: str(req.query.stock), flag: str(req.query.flag),
      sort: str(req.query.sort), dir: str(req.query.dir),
    };
    const probe = await getProductDirectory({ ...base, limit: 1, offset: 0 });
    if (probe.total > CSV_MAX_ROWS) {
      return res.status(413).json({
        error: `กรองอยู่ ${probe.total.toLocaleString('th-TH')} แถว เกินเพดาน ${CSV_MAX_ROWS.toLocaleString('th-TH')} แถว — กรุณากรองให้แคบลงก่อน`,
        total: probe.total, max: CSV_MAX_ROWS,
      });
    }

    // ดึงทีละหน้าเพราะ repo หนีบ limit ไว้ที่ DIRECTORY_MAX_LIMIT เพื่อกันคนยิงขอทั้งตาราง
    const all: any[] = [];
    for (let offset = 0; offset < probe.total; offset += DIRECTORY_MAX_LIMIT) {
      const page = await getProductDirectory({ ...base, limit: DIRECTORY_MAX_LIMIT, offset });
      all.push(...page.items);
      if (!page.items.length) break;
    }

    const rows = all.map((p: any) => ({
      internal_reference: p.internal_reference,
      name: p.name,
      model: p.model,
      brand: p.brand,
      series: p.series,
      production: p.production,
      product_group: p.product_group,
      product_sub_category: p.product_sub_category,
      sales_price: p.sales_price,
      minimum_sales_price: p.minimum_sales_price,
      unreserved: p.quantity_on_hand_unreserved,
      on_hand: p.quantity_on_hand,
      unit_of_measure: p.unit_of_measure,
      blocked: p.rules.block.blocked ? 'ห้ามเสนอราคา' : '',
      block_scope: p.rules.block.scope ?? '',
      moq: p.rules.moq?.qty ?? '',
      stock_rule: p.rules.stockRule ? 'ของหมดห้ามเสนอ' : '',
      optional: p.rules.optional.join(' | '),
    }));

    sendCsv(res, `products-${new Date().toISOString().slice(0, 10)}.csv`, [
      { label: 'รหัสสินค้า', value: 'internal_reference' },
      { label: 'ชื่อสินค้า', value: 'name' },
      { label: 'รุ่น', value: 'model' },
      { label: 'แบรนด์', value: 'brand' },
      { label: 'ซีรีส์', value: 'series' },
      { label: 'แหล่งผลิต', value: 'production' },
      { label: 'กลุ่มสินค้า', value: 'product_group' },
      { label: 'หมวดย่อย', value: 'product_sub_category' },
      { label: 'ราคาขาย', value: 'sales_price' },
      { label: 'ราคาต่ำสุด', value: 'minimum_sales_price' },
      { label: 'พร้อมขาย', value: 'unreserved' },
      { label: 'ยอดคงคลัง', value: 'on_hand' },
      { label: 'หน่วย', value: 'unit_of_measure' },
      { label: 'สถานะกฎบล็อก', value: 'blocked' },
      { label: 'กฎบล็อกตั้งที่', value: 'block_scope' },
      { label: 'ขั้นต่ำสั่งซื้อ', value: 'moq' },
      { label: 'กฎระงับสต็อก', value: 'stock_rule' },
      { label: 'สินค้าพ่วง', value: 'optional' },
    ], rows);
  } catch (err: any) {
    console.error('GET /api/admin/data/products/export error:', err);
    res.status(500).json({ error: err?.message || 'ส่งออก CSV ไม่สำเร็จ' });
  }
});

dataDirectoryRouter.get('/customers/export/csv', async (req: Request, res: Response) => {
  try {
    const base = {
      q: str(req.query.q), type: str(req.query.type), pay: str(req.query.pay),
      team: str(req.query.team), state: str(req.query.state), gate: str(req.query.gate),
      sort: str(req.query.sort), dir: str(req.query.dir),
    };
    const view = str(req.query.view) === 'contact' ? 'contact' : 'company';
    const fetchPage = (limit: number, offset: number) =>
      view === 'company'
        ? getCompanyDirectory({ ...base, limit, offset })
        : getContactDirectory({ ...base, limit, offset });

    const probe = await fetchPage(1, 0);
    if (probe.total > CSV_MAX_ROWS) {
      return res.status(413).json({
        error: `กรองอยู่ ${probe.total.toLocaleString('th-TH')} แถว เกินเพดาน ${CSV_MAX_ROWS.toLocaleString('th-TH')} แถว — กรุณากรองให้แคบลงก่อน`,
        total: probe.total, max: CSV_MAX_ROWS,
      });
    }

    const all: any[] = [];
    for (let offset = 0; offset < probe.total; offset += DIRECTORY_MAX_LIMIT) {
      const page = await fetchPage(DIRECTORY_MAX_LIMIT, offset);
      all.push(...page.items);
      if (!page.items.length) break;
    }

    const rows = all.map((c: any) => ({
      customer_reference: c.customer_reference,
      customer_name: c.customer_name,
      customer_tax_id: c.customer_tax_id,
      contact_name: c.contact_name ?? '',
      contact_mobile: c.contact_mobile ?? '',
      contact_phone: c.contact_phone ?? '',
      contact_email: c.contact_email ?? '',
      customer_type: c.customer_type,
      customer_payment_terms: c.customer_payment_terms,
      sales_team: c.sales_team,
      salesperson: c.salesperson,
      invoice_state: c.invoice_state,
      invoice_district: c.invoice_district,
      invoice_zip: c.invoice_zip,
      // ชื่อคอลัมน์ต้องไม่เขียนว่า "ซื้อล่าสุด" — คอลัมน์นี้นับเฉพาะใบที่ออกบิลแล้ว
      // และเฉพาะลูกค้าเครดิต ⇒ ลูกค้า Cash ที่ซื้อทุกเดือนก็ได้ค่าว่าง
      credit_gate_at: c.last_order_at ?? '',
      discount_latest_pct: c.discount?.latestPct != null ? c.discount.latestPct.toFixed(2) : '',
      discount_same: c.discount ? (c.discount.same ? 'คงที่' : 'ไม่เท่ากัน') : '',
    }));

    sendCsv(res, `customers-${view}-${new Date().toISOString().slice(0, 10)}.csv`, [
      { label: 'รหัสลูกค้า', value: 'customer_reference' },
      { label: 'ชื่อบริษัท', value: 'customer_name' },
      { label: 'เลขประจำตัวผู้เสียภาษี', value: 'customer_tax_id' },
      { label: 'ผู้ติดต่อ', value: 'contact_name' },
      { label: 'มือถือผู้ติดต่อ', value: 'contact_mobile' },
      { label: 'โทรศัพท์ผู้ติดต่อ', value: 'contact_phone' },
      { label: 'อีเมลผู้ติดต่อ', value: 'contact_email' },
      { label: 'ประเภทลูกค้า', value: 'customer_type' },
      { label: 'เงื่อนไขชำระเงิน', value: 'customer_payment_terms' },
      { label: 'ทีมขาย', value: 'sales_team' },
      { label: 'ผู้ดูแล', value: 'salesperson' },
      { label: 'จังหวัด', value: 'invoice_state' },
      { label: 'อำเภอ', value: 'invoice_district' },
      { label: 'รหัสไปรษณีย์', value: 'invoice_zip' },
      { label: 'วันอ้างอิงด่านเครดิต', value: 'credit_gate_at' },
      { label: 'ส่วนลดใบล่าสุด (%)', value: 'discount_latest_pct' },
      { label: 'ส่วนลด 3 ใบล่าสุด', value: 'discount_same' },
    ], rows);
  } catch (err: any) {
    console.error('GET /api/admin/data/customers/export error:', err);
    res.status(500).json({ error: err?.message || 'ส่งออก CSV ไม่สำเร็จ' });
  }
});
