/* ─────────────────────────────────────────────────────────────────────────────
   บัญชีเสนอในนาม PM (เจ้าของสั่ง 2026-09-28) — ลูกค้าในรายการ ทุกสินค้าออกเป็นใบ Primus ใบเดียว
   แผน: docs/plan-customer-quote-company.md

   ครอบ:
     1. ตรรกะ + ซอร์ส (ไม่แตะฐาน)
        · normalizeQuoteCompany · จุดเรียก resolveQuoteCompany ทุกจุดมีค่าที่ตรึงไว้มาก่อน (นับจำนวนต่อไฟล์
          — เพิ่มจุดเรียกใหม่แล้วด่านล้ม ให้คนเพิ่มตัดสินว่าต้องเคารพค่าที่ตรึงไหม)
        · 6 เส้นของหน้าตั้งค่ามีด่าน page.quotepm · INSERT ของร่างเขียน quote_company_override
     2. ฐานจริง (**เขียนแล้วลบ** — ใบทดสอบของ user ชั่วคราว + แถวตั้งค่าของบริษัทตัวอย่าง)
        · ก่อนตั้ง: แบ่ง PM/THT เหมือนเดิม ทั้งสองใบ override = NULL
        · ตั้งแล้ว: ร่างใบเดียว override = PM · ใบรวมที่ขึ้นต้นด้วยสินค้า THT ยังเป็น PM (enrich + ออกเลข QP
          — ออกเลขใน transaction แล้ว ROLLBACK ⇒ ไม่กินเลขจริง)
        · ขยายทั้งนิติบุคคล: สาขาที่เลขภาษีเดียวกันได้ค่าไปด้วย
        · LINE: ร่าง pending_company ที่แบ่งไปก่อน → เลือกบริษัท → รวมเหลือใบเดียว ยอดรวมเท่าเดิม
        · แก้ใบเดิม: ยึดค่าของใบต้นทาง ไม่ใช่ค่าตั้งปัจจุบัน
        · พรีวิวหน้าเว็บ: ใบเดียว + moved_from ของบรรทัด THT · ลูกค้าอื่นยังได้สองใบ
        · ถอดออกแล้ว: ใบที่ตรึงไว้ยังเป็น PM · ร่างใหม่กลับไปแบ่งเหมือนเดิม
     3. หน้าจริง (1280 / 390) — ต้องมี API ที่ QPM_PORT (ค่าเริ่ม 3099): `PREVIEW_MODE=1 PORT=3099 npx tsx index.ts`
        · หน้า "บัญชีเสนอในนาม PM": เพิ่มผ่านโมดัล (ค้น → เลือก → กล่องความครอบ → บันทึก) · แก้หมายเหตุ · ถอดออก
        · หน้าขอใบเสนอราคา: ใบเดียว + ป้ายใต้ชื่อบริษัท + ป้ายหัวใบ + ป้ายบรรทัด THT · 390 ไม่มี scroll แนวนอน
   ───────────────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import puppeteer, { type Page } from 'puppeteer';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import {
  normalizeQuoteCompany,
  forcedQuoteCompanyOf,
  findForcedQuoteCompanies,
  decideForcedQuoteCompany,
} from '../../services/customerQuoteCompany.js';
import {
  resolveQuoteCompany,
  insertDraftQuotations,
  updateQuotationCustomerSnapshot,
  enrichQuotationData,
  allocateQuotationNo,
} from '../../services/quotationService.js';
import { previewDraft } from '../../services/webQuoteService.js';

const PORT = process.env.QPM_PORT || '3099';
const BASE = `http://localhost:${PORT}`;
const USER = 'Udiagquotepm01';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

// ── 1. ตรรกะ + ซอร์ส ─────────────────────────────────────────────────────────
console.log('── 1. ตรรกะ + ซอร์ส ──');
ok('normalizeQuoteCompany', normalizeQuoteCompany('pm') === 'PM' && normalizeQuoteCompany(' THT ') === 'THT'
  && normalizeQuoteCompany('X') === null && normalizeQuoteCompany(null) === null && normalizeQuoteCompany('') === null);

/**
 * จุดเรียก resolveQuoteCompany( ต่อไฟล์ ที่ตรวจแล้วว่า "ค่าที่ตรึงไว้มาก่อน" (หรือไม่ต้องเคารพโดยตั้งใจ)
 * index.ts = ป้ายบริษัทของ "สินค้า" ในผลค้นหา LIFF ไม่ใช่ของใบ ⇒ ไม่ต้องเคารพ
 * เลขเปลี่ยน = มีคนเพิ่ม/ลบจุดเรียก → ตรวจว่าจุดใหม่ต้องอ่าน quote_company_override ก่อนไหม แล้วแก้ตัวเลขที่นี่
 */
const CALL_SITES: Record<string, number> = {
  // นับข้อความ `resolveQuoteCompany(` ทั้งไฟล์รวมคอมเมนต์ (ไม่นับบรรทัดนิยาม) — ง่ายและคงที่พอสำหรับด่านนี้
  'services/quotationService.ts': 5,  // allocate · insertDraft · enrich×2 · applyForced
  'pdfGenerator.ts': 2,               // ร่าง 1 จุด + คอมเมนต์อธิบาย 1 จุด
  'utils/flexTemplates.ts': 1,
  'services/shippingFee.ts': 1,
  'services/webQuoteService.ts': 1,
  'index.ts': 1,
};
for (const [file, n] of Object.entries(CALL_SITES)) {
  const src = fs.readFileSync(file, 'utf8');
  const calls = (src.match(/resolveQuoteCompany\(/g) ?? []).length - (src.match(/function resolveQuoteCompany\(/g) ?? []).length;
  const guarded = file === 'index.ts' || /quoteCompanyOverrideOf|forcedCompany/.test(src);
  ok(`${file}: จุดเรียก ${n} จุด และอ่านค่าที่ตรึงไว้`, calls === n && guarded, `${calls} จุด`);
}
const idx = fs.readFileSync('index.ts', 'utf8');
const guardedRoutes = (idx.match(/'\/api\/admin\/quote-pm[^']*', adminAuthMiddleware, requireCapability\('page\.quotepm'\)/g) ?? []).length;
ok('6 เส้นของหน้าตั้งค่ามีด่าน page.quotepm', guardedRoutes === 6, `${guardedRoutes} เส้น`);
const qs = fs.readFileSync('services/quotationService.ts', 'utf8');
ok('INSERT ของร่างเขียน quote_company_override', /source_id, quote_company_override\s*\) VALUES \(\$1,[^)]*\$13\)/.test(qs));

// ── เตรียมตัวอย่าง ────────────────────────────────────────────────────────────
// บริษัทที่มีสาขาเลขภาษีเดียวกัน (ทดสอบการขยายทั้งนิติบุคคล) และไม่มีใบเสนอราคาเลยในปีนี้
// ⇒ แถวตั้งค่าที่เขียนชั่วคราวไม่ไปกระทบใบของใครที่กำลังออกอยู่จริง
const { rows: [pair] } = await pool.query(`
  WITH t AS (
    SELECT NULLIF(TRIM(customer_tax_id),'') AS tax, company_id
      FROM customers_data_view
     WHERE source <> 'local' AND contact_id > 0 AND NULLIF(TRIM(customer_tax_id),'') IS NOT NULL
     GROUP BY 1, 2
  ), g AS (
    SELECT tax, array_agg(company_id ORDER BY company_id) ids FROM t GROUP BY tax HAVING count(*) BETWEEN 2 AND 4
  )
  SELECT g.ids[1] AS a, g.ids[2] AS b
    FROM g
   WHERE NOT EXISTS (SELECT 1 FROM quotations q WHERE q.customer_id = ANY(g.ids) AND q.created_at > now() - interval '365 days')
     AND NOT EXISTS (SELECT 1 FROM quotation_blacklist bl WHERE bl.company_id = ANY(g.ids))
   ORDER BY g.ids[1] DESC LIMIT 1`);
const coA = Number(pair.a), coB = Number(pair.b);
const contactOf = async (co: number) => (await pool.query(
  `SELECT contact_id, customer_name, contact_name FROM customers_data_view WHERE company_id = $1 AND contact_id > 0 ORDER BY contact_id LIMIT 1`, [co])).rows[0];
const ctA = await contactOf(coA), ctB = await contactOf(coB);
// ลูกค้า "ธรรมดา" ไว้เทียบ — ไม่อยู่นิติบุคคลเดียวกับ A
const { rows: [plain] } = await pool.query(`
  SELECT company_id, contact_id, customer_name FROM customers_data_view
   WHERE source <> 'local' AND contact_id > 0 AND company_id <> ALL($1::int[])
     AND NULLIF(TRIM(customer_tax_id),'') IS DISTINCT FROM (SELECT NULLIF(TRIM(customer_tax_id),'') FROM customers_data_view WHERE company_id = $2 LIMIT 1)
   ORDER BY company_id DESC LIMIT 1`, [[coA, coB], coA]);

// สินค้าตัวอย่าง: หนึ่งตัวที่ไปใบ PM เอง · หนึ่งตัวที่ไปใบ THT เอง (ถามตัวตัดสินจริง ไม่เดาจาก production)
async function pickProduct(want: 'PM' | 'THT') {
  const { rows } = await pool.query(`
    SELECT product_template_id, model, name, production, brand, series, sales_price FROM products
     WHERE sales_price > 0 AND model ~ '^[A-Z]{2}[A-Z0-9-]*[0-9]'
       AND production ${want === 'THT' ? "= 'Import(PM)'" : "LIKE 'Production%'"}
     ORDER BY product_template_id LIMIT 40`);
  for (const r of rows) if (await resolveQuoteCompany({ model: r.model, production: r.production }) === want) return r;
  throw new Error(`หาสินค้าที่ไปใบ ${want} ไม่เจอ`);
}
const pPM = await pickProduct('PM');
const pTHT = await pickProduct('THT');
const line = (p: any, qty = 2) => ({
  product_id: p.product_template_id, product_code: p.model, model: p.model, internal_reference: p.model,
  name: p.name, quantity: qty, price: Number(p.sales_price), discount_1: 0, discount_2: 0, production: p.production,
});
console.log(`\nตัวอย่าง: A=${ctA.customer_name} (${coA}) · B=${coB} (นิติบุคคลเดียวกัน) · ลูกค้าธรรมดา=${plain.company_id}`);
console.log(`          สินค้า PM=${pPM.model} · สินค้า THT=${pTHT.model}`);

const nameA = `${ctA.customer_name} | ${ctA.contact_name}`;
const spRow = { user_id: USER, salesperson_id: 'DIAGQPM', name: 'diag', phone: '' };
const myQuotes = async () => (await pool.query(`SELECT * FROM quotations WHERE user_id = $1 ORDER BY created_at, id`, [USER])).rows;
const cleanQuotes = () => pool.query(`DELETE FROM quotations WHERE user_id = $1`, [USER]);
const setA = () => pool.query(`INSERT INTO customer_quote_company (company_id, note) VALUES ($1, 'diag') ON CONFLICT DO NOTHING`, [coA]);
const unsetA = () => pool.query(`DELETE FROM customer_quote_company WHERE company_id = $1`, [coA]);

const hadRow = (await pool.query(`SELECT 1 FROM customer_quote_company WHERE company_id = ANY($1)`, [[coA, coB]])).rowCount;
if (hadRow) throw new Error('บริษัทตัวอย่างอยู่ในบัญชีจริงอยู่แล้ว — ไม่แตะ');

await pool.query(`INSERT INTO salesperson (user_id, salesperson_id, name) VALUES ($1, 'DIAGQPM', 'diag') ON CONFLICT (user_id) DO NOTHING`, [USER]);

try {
  // ── 2. ฐานจริง ───────────────────────────────────────────────────────────────
  console.log('\n── 2. ฐานจริง ──');
  ok('ก่อนตั้ง: forcedQuoteCompanyOf(A) = null', (await forcedQuoteCompanyOf(coA)) === null);
  let ins = await insertDraftQuotations(USER, nameA, [line(pPM), line(pTHT)], 'draft', coA, ctA.contact_id);
  let rows = await myQuotes();
  ok('ก่อนตั้ง: แบ่งเป็นสองใบเหมือนเดิม', ins?.length === 2 && rows.length === 2, `${rows.length} ใบ`);
  ok('ก่อนตั้ง: override = NULL ทั้งสองใบ', rows.every((r) => r.quote_company_override === null));
  ok('ก่อนตั้ง: enrich ได้ PM + THT', JSON.stringify((ins ?? []).map((q: any) => q.quote_company).sort()) === '["PM","THT"]');
  await cleanQuotes();

  await setA();
  ok('ตั้งแล้ว: forcedQuoteCompanyOf(A) = PM', (await forcedQuoteCompanyOf(coA)) === 'PM');
  ok('ขยายทั้งนิติบุคคล: forcedQuoteCompanyOf(B) = PM', (await forcedQuoteCompanyOf(coB)) === 'PM');
  ok('ลูกค้าธรรมดายัง null', (await forcedQuoteCompanyOf(plain.company_id)) === null);
  const m = await findForcedQuoteCompanies([coA, coB, plain.company_id]);
  ok('findForcedQuoteCompanies ติดธง A และ B ไม่ติดลูกค้าธรรมดา', m.get(coA) === 'PM' && m.get(coB) === 'PM' && !m.has(Number(plain.company_id)));

  // สินค้า THT ขึ้นก่อน — กรณีที่ถ้าไม่เคารพค่าที่ตรึงไว้จะได้เลข QT
  ins = await insertDraftQuotations(USER, nameA, [line(pTHT), line(pPM)], 'draft', coA, ctA.contact_id);
  rows = await myQuotes();
  ok('ตั้งแล้ว: ร่างใบเดียว', ins?.length === 1 && rows.length === 1, `${rows.length} ใบ`);
  ok('ตั้งแล้ว: override = PM · มีครบ 2 รายการ', rows[0]?.quote_company_override === 'PM' && (rows[0]?.item_details ?? []).length === 2);
  ok('ตั้งแล้ว: enrich ได้ PM แม้สินค้ารายการแรกเป็น THT', ins?.[0]?.quote_company === 'PM');
  {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const no = await allocateQuotationNo(ins![0], c);
      ok('ออกเลขได้ QP (ใน transaction แล้ว ROLLBACK)', /^QP-/.test(no), no);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  }
  await cleanQuotes();

  // ── LINE: แบ่งไปก่อนตอนยังไม่รู้ลูกค้า แล้วค่อยเลือกบริษัท ──
  ins = await insertDraftQuotations(USER, ' | ', [line(pPM), line(pTHT, 3)], 'pending_company');
  rows = await myQuotes();
  const sumBefore = rows.reduce((s, r) => s + Number(r.total_sum), 0);
  ok('LINE: ก่อนรู้ลูกค้าแบ่งเป็นสองใบ', rows.length === 2);
  const merged = await updateQuotationCustomerSnapshot(rows.map((r) => String(r.id)), nameA, 'draft', spRow, coA, ctA.contact_id);
  rows = await myQuotes();
  ok('LINE: เลือกบริษัทแล้วเหลือใบเดียว', merged.length === 1 && rows.length === 1, `${rows.length} ใบ`);
  ok('LINE: ใบที่เหลือ override = PM · 2 รายการ', rows[0]?.quote_company_override === 'PM' && (rows[0]?.item_details ?? []).length === 2);
  ok('LINE: ยอดรวมเท่าเดิม', Math.abs(Number(rows[0]?.total_sum) - sumBefore) < 0.001, `${sumBefore} → ${rows[0]?.total_sum}`);
  ok('LINE: Flex/enrich ได้ PM', merged[0]?.quote_company === 'PM');
  await cleanQuotes();

  // สาขา B (นิติบุคคลเดียวกัน) ผ่านเส้น LINE ก็รวมเหมือนกัน
  await insertDraftQuotations(USER, ' | ', [line(pTHT), line(pPM)], 'pending_company');
  rows = await myQuotes();
  await updateQuotationCustomerSnapshot(rows.map((r) => String(r.id)), `${ctB.customer_name} | ${ctB.contact_name}`, 'draft', spRow, coB, ctB.contact_id);
  rows = await myQuotes();
  ok('LINE สาขา B: รวมเหลือใบเดียว', rows.length === 1 && rows[0]?.quote_company_override === 'PM');
  await cleanQuotes();

  // ลูกค้าธรรมดาผ่านเส้น LINE — ต้องไม่ถูกรวม
  await insertDraftQuotations(USER, ' | ', [line(pPM), line(pTHT)], 'pending_company');
  rows = await myQuotes();
  await updateQuotationCustomerSnapshot(rows.map((r) => String(r.id)), `${plain.customer_name} | x`, 'draft', spRow, plain.company_id, plain.contact_id);
  rows = await myQuotes();
  ok('LINE ลูกค้าธรรมดา: ยังเป็นสองใบ override NULL', rows.length === 2 && rows.every((r) => r.quote_company_override === null));
  await cleanQuotes();

  // ── แก้ใบเดิม: ยึดใบต้นทาง ──
  const { rows: [oldQt] } = await pool.query(
    `SELECT quotation_no FROM quotations WHERE quotation_no LIKE 'QT-%' AND status = 'confirmed' AND quote_company_override IS NULL ORDER BY id DESC LIMIT 1`);
  ok('แก้ใบเดิมที่ออกก่อนตั้ง (ไม่มีค่า) = แบ่งเหมือนเดิม แม้ลูกค้าตั้ง PM', (await decideForcedQuoteCompany({ customerId: coA, reviseFrom: oldQt.quotation_no })) === null, oldQt.quotation_no);
  ins = await insertDraftQuotations(USER, nameA, [line(pTHT)], 'draft', coA, ctA.contact_id);
  await pool.query(`UPDATE quotations SET quotation_no = 'DIAG-QPM-0001' WHERE id = $1`, [ins![0].id]);
  ok('แก้ใบเดิมที่ตรึง PM = PM แม้ถามด้วยลูกค้าธรรมดา', (await decideForcedQuoteCompany({ customerId: plain.company_id, reviseFrom: 'DIAG-QPM-0001' })) === 'PM');
  await cleanQuotes();

  // ── พรีวิวหน้าเว็บ ──
  const items = [pPM, pTHT].map((p) => ({ product_template_id: p.product_template_id, quantity: 1 }));
  const pv = await previewDraft({ customerId: coA, contactId: ctA.contact_id, items, role: 'admin' });
  const moved = pv.quotes.flatMap((q) => q.items).filter((it) => it.moved_from === 'THT').map((it) => it.model);
  ok('พรีวิว: ใบเดียว PM', pv.quotes.length === 1 && pv.quotes[0].quote_company === 'PM', pv.quotes.map((q) => q.quote_company).join(','));
  ok('พรีวิว: บรรทัด THT ติด moved_from', JSON.stringify(moved) === JSON.stringify([pTHT.model]));
  ok('พรีวิว: customer.forced_quote_company = PM', pv.customer.forced_quote_company === 'PM');
  const pvPlain = await previewDraft({ customerId: plain.company_id, contactId: plain.contact_id, items, role: 'admin' });
  ok('พรีวิวลูกค้าธรรมดา: สองใบ ไม่มี moved_from', pvPlain.quotes.length === 2
    && pvPlain.quotes.every((q) => q.items.every((it) => it.moved_from === null)) && pvPlain.customer.forced_quote_company === null);

  // ── ถอดออก ──
  ins = await insertDraftQuotations(USER, nameA, [line(pTHT), line(pPM)], 'draft', coA, ctA.contact_id);
  await unsetA();
  const again = await enrichQuotationData((await myQuotes())[0]);
  ok('ถอดแล้ว: ใบที่ตรึงไว้ยังเป็น PM', again.quote_company === 'PM');
  await cleanQuotes();
  ins = await insertDraftQuotations(USER, nameA, [line(pPM), line(pTHT)], 'draft', coA, ctA.contact_id);
  ok('ถอดแล้ว: ร่างใหม่กลับไปแบ่งสองใบ', ins?.length === 2);
  await cleanQuotes();
} finally {
  await cleanQuotes();
  await unsetA();
}

// ── 3. หน้าจริง ──────────────────────────────────────────────────────────────
console.log('\n── 3. หน้าจริง ──');
const admin = (await pool.query(`SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`)).rows[0];
const token = jwt.sign({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }, getJwtSecret(), { expiresIn: '1h' });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
async function open(width: number, hash: string, seedJson: string | null = null) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => { fail++; console.log('  ✗ หน้าพัง:', (e as Error)?.message ?? String(e)); });
  await page.setViewport({ width, height: 900 });
  await page.evaluateOnNewDocument((t, u, p) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', u);
    if (p && !sessionStorage.getItem('diag-seeded')) {
      sessionStorage.setItem('price-approval-reload', p);
      sessionStorage.setItem('diag-seeded', '1');
    }
  }, token, JSON.stringify(admin), seedJson ?? '');
  await page.goto(`${BASE}/admin.html?w=${width}#${hash}`, { waitUntil: 'networkidle2' });
  return page;
}
async function until(fn: () => Promise<boolean>, ms = 10000) {
  for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await wait(250); }
  return false;
}
const text = (page: Page) => page.evaluate(() => document.body.innerText);
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const clickText = (page: Page, label: string, within = 'body') => page.evaluate((l, w) => {
  const root = w === 'body' ? document.body : document.querySelector(w);
  const b = [...(root?.querySelectorAll('button') ?? [])].find((x) => (x as HTMLElement).innerText.trim() === l) as HTMLButtonElement | undefined;
  if (!b || b.disabled) return false;
  b.click();
  return true;
}, label, within);
const shots = '/tmp/claude-1000';

try {
  // ── หน้าตั้งค่า (1280): เพิ่ม → แก้หมายเหตุ → ถอด ผ่านหน้าจอจริง ──
  const ref = (await pool.query(`SELECT customer_reference FROM customers_data_view WHERE company_id = $1 AND NULLIF(customer_reference,'') IS NOT NULL LIMIT 1`, [coA])).rows[0]?.customer_reference;
  let page = await open(1280, 'quotepm');
  ok('หน้าเปิดได้ · หัวข้อ "บัญชีเสนอในนาม PM"', await until(async () => (await text(page)).includes('บัญชีเสนอในนาม PM')));
  ok('เมนูชื่อ "บัญชีเสนอในนาม PM" อยู่ในแถบข้าง', await page.evaluate(() => [...document.querySelectorAll('nav a, nav button, aside a, aside button')].some((e) => (e as HTMLElement).innerText.includes('บัญชีเสนอในนาม PM'))));
  await clickText(page, 'เพิ่มบริษัท');
  await page.waitForSelector('#qpm-company');
  await page.type('#qpm-company', ref || ctA.customer_name.slice(0, 12));
  const picked = await until(async () => page.evaluate((co) => {
    const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b as HTMLElement).innerText.includes(co)) as HTMLElement | undefined;
    if (!btn) return false;
    btn.click();
    return true;
  }, ctA.customer_name.trim().slice(0, 10)), 8000);
  ok('ค้นแล้วเลือกบริษัทได้', picked);
  ok('กล่องความครอบโผล่ (มีหลายรหัสในนิติบุคคล)', await until(async () => (await text(page)).includes('รหัสลูกค้าในนิติบุคคลเดียวกัน'), 6000));
  await page.type('#qpm-note', 'diag-note');
  await page.screenshot({ path: `${shots}/qpm-add-1280.png` }).catch(() => {});
  await clickText(page, 'เพิ่มบริษัท', '[role="dialog"]');
  ok('บันทึกแล้วแถวขึ้นในตาราง', await until(async () => (await text(page)).includes('diag-note'), 8000));
  const dbRow = (await pool.query(`SELECT quote_company, note, created_by FROM customer_quote_company WHERE company_id = $1`, [coA])).rows[0];
  ok('แถวในฐาน: PM · หมายเหตุ · ผู้เพิ่ม', dbRow?.quote_company === 'PM' && dbRow?.note === 'diag-note' && dbRow?.created_by === admin.id);
  ok('คอลัมน์ครอบคลุมนับได้', await until(async () => /\d+ รหัสลูกค้า/.test(await text(page)), 8000));
  await page.screenshot({ path: `${shots}/qpm-list-1280.png`, fullPage: true }).catch(() => {});

  // บริษัทที่อยู่ในรายการแล้วเพิ่มซ้ำไม่ได้ (รวมสาขา B)
  await clickText(page, 'เพิ่มบริษัท');
  await page.waitForSelector('#qpm-company');
  await page.type('#qpm-company', ref || ctA.customer_name.slice(0, 12));
  ok('ผลค้นหาติด "อยู่ในรายการแล้ว" และกดไม่ได้', await until(async () => page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] button')].some((b) => (b as HTMLElement).innerText.includes('อยู่ในรายการแล้ว') && (b as HTMLButtonElement).disabled)), 8000));
  await page.keyboard.press('Escape');
  await page.close();

  // ── หน้าขอใบเสนอราคา: ลูกค้า A (อยู่ในรายการ) ──
  const seed = JSON.stringify({
    request_id: 'diag-quote-pm-probe', customer_id: coA, contact_id: Number(ctA.contact_id), company_name: ctA.customer_name,
    payment_terms_override: null, source_id: null, note: null, auto_fee: null,
    items: [pTHT, pPM].map((p) => ({ product_id: p.product_template_id, model: p.model, name: '', quantity: 1, price: Number(p.sales_price) })),
  });
  for (const width of [1280, 390]) {
    page = await open(width, 'quoterequest', seed);
    const got = await until(async () => (await text(page)).includes('รวมสินค้า THT'), 20000);
    const t = await text(page);
    ok(`${width}: ป้ายหัวใบ "รวมสินค้า THT 1 รายการ"`, got && t.includes('รวมสินค้า THT 1 รายการไว้ในใบนี้'));
    ok(`${width}: ป้ายใต้ชื่อบริษัท "เสนอราคาในนาม PM เท่านั้น"`, t.includes('เสนอราคาในนาม PM เท่านั้น'));
    ok(`${width}: ป้ายบรรทัด THT`, t.includes('สินค้า THT · ออกในใบนี้ตามบัญชีเสนอในนาม PM'));
    ok(`${width}: ไม่มีใบ Themtech`, !t.includes('Themtech (THT)') && !/บริษัท เธมเทค|Themtech Co/.test(t));
    ok(`${width}: ไม่มี scroll แนวนอน`, (await overflow(page)) <= 0, `${await overflow(page)}px`);
    await page.screenshot({ path: `${shots}/qpm-quote-${width}.png`, fullPage: true }).catch(() => {});
    await page.close();
  }

  // ── หน้าตั้งค่า 390 + แก้หมายเหตุ + ถอดออก ──
  page = await open(390, 'quotepm');
  await until(async () => (await text(page)).includes('diag-note'));
  ok('390: การ์ดขึ้น · ไม่มี scroll แนวนอน', (await text(page)).includes('diag-note') && (await overflow(page)) <= 0, `${await overflow(page)}px`);
  await page.screenshot({ path: `${shots}/qpm-list-390.png`, fullPage: true }).catch(() => {});
  await page.evaluate((co) => (document.querySelector(`button[aria-label^="แก้หมายเหตุของ"][aria-label*="${co}"]`) as HTMLElement | null)?.click(), ctA.customer_name.trim().slice(0, 8));
  await page.waitForSelector('#qpm-edit-note');
  await page.$eval('#qpm-edit-note', (el) => { (el as HTMLInputElement).select(); });
  await page.type('#qpm-edit-note', 'diag-edited');
  await clickText(page, 'บันทึก', '[role="dialog"]');
  ok('แก้หมายเหตุแล้วฐานเปลี่ยน', await until(async () =>
    (await pool.query(`SELECT note FROM customer_quote_company WHERE company_id = $1`, [coA])).rows[0]?.note === 'diag-edited', 6000));
  await until(async () => (await text(page)).includes('diag-edited'));
  await page.evaluate((co) => (document.querySelector(`button[aria-label^="ถอด"][aria-label*="${co}"]`) as HTMLElement | null)?.click(), ctA.customer_name.trim().slice(0, 8));
  await until(async () => (await text(page)).includes('ถอดออกจากบัญชีเสนอในนาม PM ใช่หรือไม่'));
  await clickText(page, 'ถอดออก', '[role="dialog"]');
  ok('ถอดออกแล้วแถวหายจากฐาน', await until(async () =>
    (await pool.query(`SELECT 1 FROM customer_quote_company WHERE company_id = $1`, [coA])).rowCount === 0, 6000));
  await page.close();
} finally {
  await browser.close();
  await pool.query(`DELETE FROM customer_quote_company WHERE company_id = $1`, [coA]);
  await pool.query(`DELETE FROM quotations WHERE user_id = $1`, [USER]);
  await pool.query(`DELETE FROM salesperson WHERE user_id = $1`, [USER]);
}

console.log(`\n${fail === 0 ? '✅ ผ่านทุกข้อ' : `❌ ล้ม ${fail} ข้อ`}`);
await pool.end();
process.exit(fail === 0 ? 0 : 1);
