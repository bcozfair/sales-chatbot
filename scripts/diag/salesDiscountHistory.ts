/* ─────────────────────────────────────────────────────────────────────────────
   "ส่วนลดเดิม" ฝั่งเซลส์ — การ์ดสรุปใน LINE (Flex) + หน้าแก้ใบ LIFF (เจ้าของเคาะ mockup sdh-* 2026-10-07)

   ครอบ:
     1. % เป็นจำนวนเต็ม ปัดครึ่งขึ้น (discountPctText) — 29.97 → 30 · 27.5 → 28
     2. ด่านยืนยันตัวตน LIFF (config/liffAuth.ts) ด้วย LINE จำลอง — ไม่ยิงเน็ตจริง
        ไม่มี token / token เสีย / channel อื่น / หมดอายุ = 401 · ไม่ใช่เซลส์ = 403 ·
        LINE ล่ม / ฐานล่ม = 503 (ไม่ใช่ "ไม่มีสิทธิ์") · ผ่านแล้วจำผล ไม่ถาม LINE ซ้ำ
     3. ฐานจริง (อ่านอย่างเดียว): สามทางเข้าใช้ตัวเลขชุดเดียวกัน · isRegisteredSalesperson
     4. การ์ดสรุป (getQuotationSummaryMessage) กับฐานจริง: มีใบ = ป้ายครบตามลำดับ · ไม่เคยมีใบ ·
        อ่านไม่สำเร็จ = "โหลดไม่สำเร็จ" แต่การ์ดยังออก · ยังไม่ระบุลูกค้า = ไม่มีแถว
     5. หน้า quote-edit.html ตัวจริงที่ 390px — LIFF SDK และ API จำลองทั้งหมด (ไม่ต้องเปิด server)
        แนบ token จริง · กาง/พับ · เปลี่ยนบริษัท · ผลที่มาช้าของบริษัทเก่าถูกทิ้ง · ล้างบริษัท ·
        โหลดไม่สำเร็จ → ลองใหม่ · 403 → 🔒 · ไม่ล้นแนวนอน

   **ไม่เขียน DB** · รัน: npm run diag:sales-discount
   ───────────────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer, { type Page, type HTTPRequest } from 'puppeteer';
import { pool } from '../../config/db.js';
import { createLiffVerifier, liffChannelIdsFromEnv, bearerToken, requireLiffSalesperson } from '../../config/liffAuth.js';
import { isRegisteredSalesperson } from '../../db/repositories.js';
import { discountPctText, getRecentDiscountSummary, getCompanyDetail, summarizeDiscounts } from '../../services/dataDirectoryService.js';
import { getCustomerDiscountHistory } from '../../services/webQuoteService.js';
import { getQuotationSummaryMessage } from '../../utils/flexTemplates.js';

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── 1. จำนวนเต็ม ────────────────────────────────────────────────────────────
console.log('\n── 1. % จำนวนเต็ม ──');
for (const [v, want] of [[30, '30%'], [29.97, '30%'], [27.5, '28%'], [12.49, '12%'], [0, '0%'], [null, '—']] as const) {
  ok(`${v} → ${want}`, discountPctText(v) === want, discountPctText(v));
}

{
  const row = (pct: number, i: number) => ({ order_reference: `R${i}`, order_date: '2026-09-01', order_total_amount: '100', order_total_discount: String(pct), invoice_status: null });
  const a = summarizeDiscounts([row(30, 1), row(29.97, 2), row(30.2, 3)]);
  ok('30 · 29.97 · 30.2 → "คงที่" (เลขที่เห็นเท่ากันหมด)', a?.same === true && a?.trend === 0);
  const b = summarizeDiscounts([row(30, 1), row(29.97, 2), row(25, 3)]);
  ok('30 · 29.97 · 25 → ไม่เท่ากัน แต่ทิศทางเทียบ 30 กับ 30 = 0 (ไม่ใช่ "เพิ่มขึ้น")', b?.same === false && b?.trend === 0);
  const c = summarizeDiscounts([row(31, 1), row(29.97, 2)]);
  ok('31 กับ 29.97 → เพิ่มขึ้น', c?.trend === 1);
}

// ── 2. ด่านยืนยันตัวตน (LINE จำลอง) ─────────────────────────────────────────
console.log('\n── 2. ด่าน LIFF (LINE จำลอง) ──');
ok('channel ID จาก LIFF ID ทั้งสามตัว', [...liffChannelIdsFromEnv({ LIFF_ID: '1650-aaa', LIFF_QUOTE_ID: '1777-bbb', LIFF_PRODUCT_SEARCH_ID: 'xx' } as any)].join(',') === '1650,1777');
ok('Bearer อ่านได้ · ผิดรูป = ว่าง', bearerToken('Bearer abc') === 'abc' && bearerToken('abc') === '' && bearerToken(undefined) === '');

type LineMode = { verify: number | 'throw'; clientId?: string; expiresIn?: number; profile?: number; userId?: string };
function fakeVerifier(mode: LineMode, sales: boolean | 'throw' = true) {
  const calls: string[] = [];
  let t = 1_000_000;
  const fetchImpl = (async (url: any) => {
    const u = String(url);
    calls.push(u.includes('/verify') ? 'verify' : 'profile');
    if (u.includes('/verify')) {
      if (mode.verify === 'throw') throw new Error('ECONNRESET');
      return new Response(JSON.stringify({ client_id: mode.clientId ?? '1650', expires_in: mode.expiresIn ?? 3600 }), { status: mode.verify });
    }
    return new Response(JSON.stringify({ userId: mode.userId ?? 'Uabc' }), { status: mode.profile ?? 200 });
  }) as typeof fetch;
  const v = createLiffVerifier({
    fetchImpl,
    allowedChannelIds: () => new Set(['1650']),
    isSalesperson: async (uid) => { if (sales === 'throw') throw new Error('db down'); return sales && uid === 'Uabc'; },
    now: () => t,
  });
  return { v, calls, advance: (ms: number) => { t += ms; } };
}
{
  const r = await fakeVerifier({ verify: 200 }).v('');
  ok('ไม่มี token → 401 NO_TOKEN', !r.ok && r.status === 401 && r.code === 'NO_TOKEN');
}
{
  const r = await fakeVerifier({ verify: 400 }).v('t');
  ok('LINE ตอบ 400 (token เสีย/หมดอายุ) → 401', !r.ok && r.status === 401 && r.code === 'BAD_TOKEN');
}
{
  const r = await fakeVerifier({ verify: 200, clientId: '9999' }).v('t');
  ok('token ของ channel อื่น → 401', !r.ok && r.status === 401);
}
{
  const r = await fakeVerifier({ verify: 200, expiresIn: 0 }).v('t');
  ok('expires_in = 0 → 401', !r.ok && r.status === 401);
}
{
  const r = await fakeVerifier({ verify: 200 }, false).v('t');
  ok('ไม่ใช่เซลส์ → 403', !r.ok && r.status === 403 && r.code === 'NOT_SALESPERSON');
}
{
  const r = await fakeVerifier({ verify: 503 }).v('t');
  ok('LINE ตอบ 5xx → 503 (ไม่ใช่ไม่มีสิทธิ์)', !r.ok && r.status === 503);
}
{
  const r = await fakeVerifier({ verify: 'throw' }).v('t');
  ok('ต่อ LINE ไม่ได้ → 503', !r.ok && r.status === 503);
}
{
  const r = await fakeVerifier({ verify: 200, profile: 200, userId: '' }).v('t');
  ok('profile ไม่มี userId → 503', !r.ok && r.status === 503);
}
{
  const r = await fakeVerifier({ verify: 200 }, 'throw').v('t');
  ok('อ่านตาราง salesperson ไม่ได้ → 503', !r.ok && r.status === 503);
}
{
  const f = fakeVerifier({ verify: 200 });
  const a = await f.v('t');
  const b = await f.v('t');
  ok('เซลส์ → ผ่าน + userId จาก LINE', a.ok && a.userId === 'Uabc');
  ok('ครั้งที่สองใช้ผลที่จำไว้ (ถาม LINE 2 ครั้ง ไม่ใช่ 4)', b.ok && f.calls.length === 2, f.calls.join(','));
  f.advance(5 * 60_000 + 1);
  await f.v('t');
  ok('เกิน 5 นาที → ถาม LINE ใหม่', f.calls.length === 4, String(f.calls.length));
}
{
  const f = fakeVerifier({ verify: 200 }, false);
  await f.v('t'); await f.v('t');
  ok('ผลที่ไม่ผ่านไม่จำ', f.calls.length === 4, String(f.calls.length));
}
{
  let status = 0; let body: any = null; let nexted = false;
  const res = { status(s: number) { status = s; return this; }, json(b: any) { body = b; } };
  await requireLiffSalesperson({ headers: {} }, res, () => { nexted = true; });
  ok('middleware: ไม่มี header → 401 ไม่เรียก next', status === 401 && body?.code === 'NO_TOKEN' && !nexted);
}

// ── 3. ฐานจริง ───────────────────────────────────────────────────────────────
console.log('\n── 3. ฐานจริง (อ่านอย่างเดียว) ──');
const { rows: recent } = await pool.query(`
  SELECT company_id, max(customer_name) AS name, array_agg(contact_id) FILTER (WHERE contact_id > 0) AS contacts
    FROM customers_data_view
   WHERE company_id IN (SELECT DISTINCT company_id FROM customers_data_view WHERE source <> 'local'
                         ORDER BY company_id DESC LIMIT 3000)
   GROUP BY company_id ORDER BY company_id DESC`);
async function sample(withOrders: boolean) {
  for (const co of recent) {
    if (!co.contacts?.length) continue;
    // บริษัทที่มีใบต้องมีส่วนลดจริงอย่างน้อยหนึ่งใบ — ไม่งั้นการ์ดได้ "0% 0% 0%" ซึ่งพิสูจน์ลำดับ/การปัดไม่ได้
    const { n, d } = (await pool.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE order_total_discount > 0)::int AS d
         FROM sale_orders WHERE contact_id = ANY($1::int[]) AND order_total_amount IS NOT NULL`, [co.contacts])).rows[0];
    if (withOrders ? n >= 3 && d >= 2 : n === 0) return co;
  }
  return null;
}
const H = await sample(true);
const N = await sample(false);
if (!H || !N) throw new Error('หาบริษัทตัวอย่างไม่ได้');
console.log(`  มีใบ: company_id ${H.company_id} · ไม่เคยมีใบ: company_id ${N.company_id}`);
const shared = await getRecentDiscountSummary(Number(H.company_id));
ok('หน้าเว็บ = ตัวกลาง ทุกช่อง', JSON.stringify(await getCustomerDiscountHistory(H.company_id)) === JSON.stringify(shared));
ok('หน้า "ข้อมูลลูกค้า" = ตัวกลาง ทุกช่อง', JSON.stringify((await getCompanyDetail(Number(H.company_id)))?.discount ?? null) === JSON.stringify(shared));
ok('ไม่เคยมีใบ → null', (await getRecentDiscountSummary(Number(N.company_id))) === null);

const sp = (await pool.query(`SELECT user_id FROM salesperson WHERE user_id NOT LIKE 'web:%' AND COALESCE(TRIM(salesperson_id),'') <> '' AND status NOT LIKE 'pending%' LIMIT 1`)).rows[0];
const web = (await pool.query(`SELECT user_id FROM salesperson WHERE user_id LIKE 'web:%' LIMIT 1`)).rows[0];
if (sp) ok('เซลส์ที่ลงทะเบียนแล้ว → true', await isRegisteredSalesperson(sp.user_id));
else console.log('  · ข้าม: ไม่มีเซลส์ที่ลงทะเบียนแล้วในฐานนี้');
if (web) ok('แถวพร็อกซีหน้าเว็บ (web:*) → false', !(await isRegisteredSalesperson(web.user_id)));
ok('userId ที่ไม่มีจริง → false', !(await isRegisteredSalesperson('U-diag-not-exist')));

// ── 4. การ์ดสรุปใน LINE ───────────────────────────────────────────────────────
console.log('\n── 4. การ์ดสรุป (Flex) ──');
function findDiscountNode(node: any): any {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'text' && typeof node.text === 'string' && node.text.startsWith('🏷️ ส่วนลดเดิม')) return { text: node };
  if (node.type === 'box' && Array.isArray(node.contents)) {
    const first = node.contents[0];
    if (first?.type === 'text' && first.text === '🏷️ ส่วนลดเดิม:') return { box: node };
    for (const c of node.contents) { const f = findDiscountNode(c); if (f) return f; }
  }
  for (const k of ['header', 'body', 'footer', 'contents']) {
    if (node[k] && !Array.isArray(node[k])) { const f = findDiscountNode(node[k]); if (f) return f; }
  }
  return null;
}
const quoteOf = (customerId: any, company: string) => [{
  id: 'diag', status: 'draft', customer_id: customerId, contact_id: null,
  customer_name: company ? `${company} | คุณทดสอบ` : '', payment_terms: '30 Days', items: [],
}];
let lastSummaryText = '';
const flexOf = async (q: any[]) => {
  const out: any = await getQuotationSummaryMessage(q);
  lastSummaryText = String(out?.summaryText ?? '');
  return (out?.messages ?? []).find((m: any) => m?.type === 'flex');
};
{
  const msg = await flexOf(quoteOf(H.company_id, H.name));
  const f = findDiscountNode(msg?.contents);
  const pills = f?.box?.contents.slice(1).map((b: any) => b.contents?.[0]?.text) ?? [];
  const want = shared!.rows.map((r) => discountPctText(r.pct));
  ok('มีใบ → ป้ายครบตามลำดับ ใบล่าสุดซ้าย', JSON.stringify(pills) === JSON.stringify(want), pills.join(' '));
  const lbl = f?.box?.contents[0];
  ok('ป้ายชื่อ xs ตัวหนา (ขนาดเท่าบรรทัดอื่น)', lbl?.size === 'xs' && lbl?.weight === 'bold');
  ok('ป้ายตัวเลข: พื้น #2563EB ตัวขาว ตัวหนา xs', f?.box?.contents.slice(1).every((b: any) =>
    b.backgroundColor === '#2563EB' && b.contents[0].color === '#FFFFFF' && b.contents[0].weight === 'bold' && b.contents[0].size === 'xs'));
  ok('แถวเดียว (กล่องแนวนอน)', f?.box?.layout === 'horizontal');
  const cust = msg?.contents?.body?.contents?.[0]?.contents ?? [];
  const iCredit = cust.findIndex((n: any) => typeof n.text === 'string' && n.text.startsWith('💳 เครดิต'));
  ok('อยู่ต่อจาก 💳 เครดิต', iCredit >= 0 && cust[iCredit + 1] === f?.box);
  ok('ข้อความสรุป (summaryText) มีบรรทัดเดียวกัน', lastSummaryText.includes(`🏷️ ส่วนลดเดิม: ${want.join(', ')}\n`));
}
{
  const f = findDiscountNode((await flexOf(quoteOf(N.company_id, N.name)))?.contents);
  ok('ไม่เคยมีใบ → "ยังไม่เคยมีใบสั่งขาย" สีเทา', f?.text?.text === '🏷️ ส่วนลดเดิม: ยังไม่เคยมีใบสั่งขาย' && f.text.color === '#4B5563');
}
{
  // company_id เกินช่วง int4 ⇒ Postgres โยน error จริง = จำลองฐานอ่านไม่ได้โดยไม่ต้องปิดฐาน
  const msg = await flexOf(quoteOf(3_000_000_000, 'บริษัททดสอบ'));
  const f = findDiscountNode(msg?.contents);
  ok('อ่านไม่สำเร็จ → "โหลดไม่สำเร็จ" สีแดง', f?.text?.text === '🏷️ ส่วนลดเดิม: โหลดไม่สำเร็จ' && f.text.color === '#DC2626');
  ok('อ่านไม่สำเร็จ → การ์ดยังออกครบ (มีปุ่ม)', Array.isArray(msg?.contents?.footer?.contents) && msg.contents.footer.contents.length > 0);
}
{
  ok('ยังไม่ระบุลูกค้า → ไม่มีแถว', findDiscountNode((await flexOf(quoteOf(null, '')))?.contents) === null);
  ok('ใบเก่าที่ไม่มี customer_id → ไม่มีแถว', findDiscountNode((await flexOf(quoteOf(null, H.name)))?.contents) === null);
}
await pool.end();

// ── 5. หน้า LIFF จริง (API จำลอง) ─────────────────────────────────────────────
console.log('\n── 5. หน้าแก้ใบ LIFF (quote-edit.html · API จำลอง · 390px) ──');
const HTML = fs.readFileSync(path.resolve('liff_pages/quote-edit.html'), 'utf8');
const TOKEN = 'diag-access-token';
const LIFF_STUB = `window.liff = {
  init: async () => {}, isLoggedIn: () => true, isInClient: () => false, login() {},
  getAccessToken: () => window.__diagToken === undefined ? ${JSON.stringify(TOKEN)} : window.__diagToken,
  getProfile: async () => ({ userId: 'Udiag' }), closeWindow() {}, sendMessages: async () => {},
};`;
const QUOTE = {
  id: 'q1', status: 'draft', user_id: 'Udiag', customer_id: 111, contact_id: 1,
  customer_name: 'บริษัท ทดสอบ ก | คุณก', payment_terms: '30 Days', quote_company: 'PM',
  items: [{ product_code: 'DIAG-1', model: 'DIAG-1', name: 'สินค้าทดสอบ', price: 100, quantity: 1, discount_1: 0, discount_2: 0 }],
};
const HIST = {
  rows: [
    { ref: 'OP-DIAG-03', date: '2026-09-29', amount: 12400, discount: 3720, pct: 30, invoiceStatus: null },
    { ref: 'OP-DIAG-02', date: '2026-08-21', amount: 8950, discount: 2682.32, pct: 29.97, invoiceStatus: null },
    { ref: 'OP-DIAG-01', date: '2026-07-02', amount: 4200, discount: 1050, pct: 25, invoiceStatus: null },
  ],
  latestPct: 30, same: false, trend: 0,
};
type Reply = { status: number; body: any; delay?: number };
let discountReplies: Record<string, Reply[]> = {};
let authHeaders: string[] = [];

async function openPage(): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 900 });
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', async (req: HTTPRequest) => {
    const u = new URL(req.url());
    const json = (status: number, body: any) => req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.host === 'liff.test' && u.pathname === '/quote-edit.html') return req.respond({ status: 200, contentType: 'text/html', body: HTML });
    if (u.host.endsWith('line-scdn.net')) return req.respond({ status: 200, contentType: 'text/javascript', body: LIFF_STUB });
    if (u.host !== 'liff.test') return req.abort();
    if (u.pathname === '/api/quotations') return json(200, [QUOTE]);
    if (/^\/api\/customer\/\d+\/contacts$/.test(u.pathname)) return json(200, [{ id: 1, name: 'คุณก' }]);
    if (u.pathname === '/api/liff/discount-history') {
      authHeaders.push(req.headers()['authorization'] ?? '');
      const id = u.searchParams.get('customer_id') ?? '';
      const r = discountReplies[id]?.shift() ?? { status: 500, body: { error: 'no fixture' } };
      if (r.delay) await wait(r.delay);
      return json(r.status, r.body);
    }
    return json(404, { error: 'not mocked' });
  });
  await page.goto('http://liff.test/quote-edit.html?quoteIds=q1&userId=Udiag', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#customer-details-global', { timeout: 10_000 });
  // จอโหลดจางหายใน 400 ms แล้วค่อย display:none — ระหว่างนั้นมันบังทุกการแตะ (คนจริงก็แตะไม่ได้เหมือนกัน)
  await page.waitForFunction(() => document.getElementById('loaderScreen')?.style.display === 'none', { timeout: 10_000 });
  (page as any).__errs = errs;
  return { page, close: () => browser.close() };
}
const discText = (page: Page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#customer-details-global .info-row')];
  const r = rows.find((x) => x.querySelector('.info-label')?.textContent?.includes('ส่วนลดเดิม'));
  return r ? (r.querySelector('.info-value')?.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
});
const until = async (fn: () => Promise<boolean>, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await wait(50); }
  return false;
};

{
  discountReplies = { '111': [{ status: 200, body: { discount: HIST } }] };
  authHeaders = [];
  const { page, close } = await openPage();
  ok('มีใบ → ปุ่ม "30%, 30%, 25%" (29.97 ปัดเป็น 30)', await until(async () => (await discText(page)) === '30%, 30%, 25% ▼'), String(await discText(page)));
  ok('แนบ access token ของ LINE', authHeaders[0] === `Bearer ${TOKEN}`, authHeaders[0]);
  const order = await page.evaluate(() => [...document.querySelectorAll('#customer-details-global .info-label')].map((e) => e.textContent?.trim()));
  ok('แถวอยู่ต่อจาก 💳 เครดิต', order.indexOf('🏷️ ส่วนลดเดิม') === order.indexOf('💳 เครดิต') + 1, order.join(' / '));
  await page.click('#disc-chip');
  const panel = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#disc-panel tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim())),
    ft: document.querySelector('#disc-panel .ft')?.textContent?.trim(),
    expanded: document.getElementById('disc-chip')?.getAttribute('aria-expanded'),
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  ok('กางแล้วได้ตาราง 3 ใบ', panel.rows.length === 3 && panel.expanded === 'true');
  ok('แถวแรก: เลขใบ · วันที่ พ.ศ. · ยอด · %', JSON.stringify(panel.rows[0]) === JSON.stringify(['OP-DIAG-03', '29/09/69', '12,400.00', '30%']), JSON.stringify(panel.rows[0]));
  ok('"ไม่เท่ากัน" มาจาก same ของ server', panel.ft === 'ส่วนลดไม่เท่ากัน · ข้อมูลให้ดูเท่านั้น ไม่พิมพ์ลงใบ', panel.ft);
  ok('ไม่ล้นแนวนอนที่ 390px', panel.over <= 0, String(panel.over));
  await page.click('#disc-chip');
  ok('แตะอีกครั้ง → พับ', await page.evaluate(() => !document.getElementById('disc-panel')));

  // เปลี่ยนบริษัท → โหลดใหม่ · พับ · ไม่เคยมีใบ
  discountReplies['222'] = [{ status: 200, body: { discount: null }, delay: 300 }];
  await page.click('#disc-chip');
  await page.evaluate(() => (window as any).selectCompanyForQuote({ id: 222, display_name: 'บริษัท ทดสอบ ข', payment_terms: 'Cash' }));
  ok('เปลี่ยนบริษัท → กำลังโหลด', await until(async () => (await discText(page)) === 'กำลังโหลด...'), String(await discText(page)));
  ok('→ "ยังไม่เคยมีใบสั่งขาย" และพับตาราง', await until(async () => (await discText(page)) === 'ยังไม่เคยมีใบสั่งขาย')
    && await page.evaluate(() => !document.getElementById('disc-panel')));

  // ผลของบริษัทเก่าที่มาช้ากว่าการเปลี่ยนครั้งถัดไป ต้องถูกทิ้ง
  discountReplies['333'] = [{ status: 200, body: { discount: HIST }, delay: 800 }];
  discountReplies['444'] = [{ status: 200, body: { discount: null } }];
  await page.evaluate(() => (window as any).selectCompanyForQuote({ id: 333, display_name: 'บริษัท ช้า', payment_terms: '' }));
  await wait(100);
  await page.evaluate(() => (window as any).selectCompanyForQuote({ id: 444, display_name: 'บริษัท เร็ว', payment_terms: '' }));
  await wait(1200);
  ok('ผลที่มาช้าของบริษัทเก่าถูกทิ้ง', (await discText(page)) === 'ยังไม่เคยมีใบสั่งขาย', String(await discText(page)));

  await page.click('#clear-company-global');
  ok('ล้างบริษัท → "-"', await until(async () => (await discText(page)) === '-'), String(await discText(page)));
  ok('ไม่มี error ของหน้า', (page as any).__errs.length === 0, (page as any).__errs.join(' | '));
  await close();
}
{
  discountReplies = { '111': [{ status: 500, body: { error: 'x' } }, { status: 200, body: { discount: HIST } }] };
  const { page, close } = await openPage();
  ok('อ่านไม่สำเร็จ → "โหลดไม่สำเร็จ" + ลองใหม่', await until(async () => (await discText(page)) === 'โหลดไม่สำเร็จลองใหม่'), String(await discText(page)));
  await page.click('#disc-retry');
  ok('กดลองใหม่ → ได้ข้อมูล', await until(async () => (await discText(page)) === '30%, 30%, 25% ▼'), String(await discText(page)));
  await close();
}
{
  discountReplies = { '111': [{ status: 403, body: { code: 'NOT_SALESPERSON' } }] };
  const { page, close } = await openPage();
  ok('403 → "🔒 ดูได้เฉพาะเซลส์ที่ลงทะเบียนแล้ว"', await until(async () => (await discText(page)) === '🔒 ดูได้เฉพาะเซลส์ที่ลงทะเบียนแล้ว'), String(await discText(page)));
  await close();
}

console.log(fail === 0 ? '\nผ่านทุกข้อ' : `\nล้ม ${fail} ข้อ`);
process.exit(fail === 0 ? 0 : 1);
