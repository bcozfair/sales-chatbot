/* ─────────────────────────────────────────────────────────────────────────────
   เปิดหน้า "คำนวณราคา" จริงแล้วกดปุ่ม "เพิ่มเป็นสินค้าใหม่" จริง
   — mockup `pricing-add-product` รอบ 3 ที่เจ้าของยืนยัน 2026-10-02

   **ไม่แตะฐานเลย และไม่ต้องเปิดเซิร์ฟเวอร์** (ท่าเดียวกับ `diag:op-ui`): puppeteer เสิร์ฟ `public/` ที่ build แล้วเอง
   และตอบทุก `/api/*` ด้วยข้อมูลชุดเล็กในไฟล์นี้ ⇒ รันบน PMSV ได้ · ราคาที่จ่ายคือไม่ได้พิสูจน์ฝั่ง server ซึ่งเป็นงานของ
   `diag:local-products` (model ซ้ำ = 409 · ที่มาของราคาตัดสินจาก `pricebook_price`) กับ `diag:pricing` (ตัวคิดราคา)

   สิ่งที่พิสูจน์ (ตามข้อในหน้า mockup):
   1. ปุ่มโผล่เฉพาะคนที่มี `quote.manage_products` — ไม่มีสิทธิ์ = ไม่มีปุ่ม และไม่ยิง /suggest เลย
   2. ปุ่มรองสีน้ำเงิน + ไอคอนบวก (`Button variant="secondary"` ตัวเดียวกับ "เพิ่มค่าบริการ")
   3. ราคาครบ = เติมราคา + ป้าย "จากสมุดราคา" + ส่ง `pricebook_price`/`price_book_revision` ตอนบันทึก ·
      ราคาไม่ครบ / ต้องขอราคา = เปิดได้แต่ไม่เติมราคา · ไม่รับผลิต = ปุ่มกดไม่ได้ + เหตุผลข้างปุ่ม + ไม่ยิง /suggest
   4. ตัวเลือกนอกรหัส (ขนาดเต๋า · สาย · เจาะรู) ลงช่อง Description ให้ · ปุ่มคิดราคาในหน้าต่างส่งตัวเลือกชุดเดียวกันไปด้วย
      · ปุ่มนั้นเติมราคาลงช่องเอง (2026-10-02) ⇒ ราคาไม่ครบต้องไม่ถูกเติม (เกณฑ์ `isFullPrice` ตัวเดียวกับหน้าคำนวณราคา)
   5. **รหัสที่มีในระบบแล้ว = แถบเตือนตั้งแต่ยังไม่กด · ปุ่มกดไม่ได้ · กดแล้วไม่มีหน้าต่าง** (รอบ 3) ·
      บอกว่ามาจาก Odoo หรือสินค้าเพิ่มเอง · ลิงก์ไปหน้าสินค้าเพิ่มเองเฉพาะของเพิ่มเอง และเฉพาะคนที่เปิดหน้านั้นได้
   6. เพิ่มเสร็จ = แถบเขียว "เพิ่มสินค้าแล้ว" + รหัส แทนปุ่ม · หน้าคำนวณราคาอยู่ที่เดิม
   7. หัวหน้าไม่มีคำว่า "ยังไม่ต่อกับใบเสนอราคา"
   + ทุกกรณีที่ 390 / 640 / 641 / 1280 ไม่มีแถบเลื่อนแนวนอน · ภาพทั้งธีมมืดและสว่าง

   รัน: `npm run build --prefix frontend` ก่อน แล้ว `npm run diag:pricing-add-ui`
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type HTTPRequest, type Page } from 'puppeteer';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import { BH_CATALOG } from '../../services/pricingLab/catalogBh.js';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const SHOTS = process.env.PA_SHOTS || fileURLToPath(new URL('../../mockup/shots/', import.meta.url));
const ORIGIN = 'http://pa-probe.local';
mkdirSync(SHOTS, { recursive: true });

let fail = 0;
const pageErrors: string[] = [];
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

// ── ผลคิดราคาจำลอง — รูปเดียวกับ `pricingQuoteHandler` (code · parsed · outcome · revision) ──────────
const REVISION = 17;
const line = (label: string, amount: number) => ({ step: 'flat', label, amount });
const outcome = (status: string, unitPrice: number, breakdown: unknown[], violations: unknown[] = []) =>
  ({ status, model: 'X', unitPrice, breakdown, violations, bookVersion: `r${REVISION}` });
const parsed = (code: string, extra: Record<string, unknown> = {}) =>
  ({ input: code, normalized: code, parts: [], problems: [], warnings: [], ...extra });

const C = {
  priced: 'BH-01C-600x150-380-4950W-PL-PL2',
  picks: 'BH-03 170x110-220-2700W-T',
  partial: 'TSK-04(S2)6x75+3M-S123',
  ask: 'TSK-01 6x100 M12',
  block: 'BH-01 30x20-220-100W',
  dupOdoo: 'BH-01 100x50-240-1000W',
  dupLocal: 'CH-02 6.5x240-42-450W-1-S000',
} as const;

/** ช่องตามแคตตาล็อกของ BH-03 ที่ติ๊กตัวเลือกนอกรหัสไว้ครบสามชนิด */
const PICK_FORM = { family: 'BH-03', id: 170, h: 110, volt: '220', watt: 2700, term: 'T', amp: '30A', addons: ['cable:silicone'], holes: [{ count: 2, mm: 10 }] };
const PICK_DESC = 'ตัวเลือกนอกรหัส (จากหน้าคำนวณราคา): ขนาดเต๋า 30A · สาย Silicone · เจาะรู 2 รู Ø10 mm';

function quoteFor(code: string) {
  const base = { code, revision: REVISION };
  switch (code) {
    case C.priced: return { ...base, parsed: parsed(code), outcome: outcome('priced', 12480, [line('ราคาตั้ง BH-01', 10400), line('รุ่น C +20%', 2080)]) };
    case C.picks: return { ...base, parsed: parsed(code, { form: PICK_FORM }),
      outcome: outcome('priced', 3350, [line('ราคาตั้ง BH-03', 2950), line('ขนาดเต๋า 30A', 250), line('สาย Silicone', 150)]) };
    case C.partial: return { ...base,
      parsed: parsed(code, { parts: [{ text: 'S123', reads: 'ยังไม่ได้ตั้งค่าว่าแปลว่าอะไร', kind: 'unknown', subCode: 'S123' }] }),
      outcome: outcome('priced', 775, [line('ราคาตั้ง TSK-04', 615), line('สายเกิน 1 ม.', 160)]) };
    case C.ask: return { ...base, parsed: parsed(code),
      outcome: outcome('quoteOnRequest', 540, [line('ราคาตั้ง TSK-01', 540)],
        [{ id: 'ask', level: 'quoteOnRequest', message: 'ขนาดเกลียว M12 ไม่อยู่ในแคตตาล็อก — ต้องขอราคาจากฝ่ายผลิต' }]) };
    case C.block: return { ...base, parsed: parsed(code),
      outcome: outcome('notManufacturable', 0, [], [{ id: 'w', level: 'block', message: 'ความกว้างต่ำสุดของ BH-01 คือ 25 mm' }]) };
    case C.dupOdoo: return { ...base, parsed: parsed(code), outcome: outcome('priced', 1050, [line('ราคาตั้ง BH-01', 1050)]) };
    case C.dupLocal: return { ...base, parsed: parsed(code), outcome: outcome('priced', 1420, [line('ราคาตั้ง CH-02', 1420)]) };
    default: return { ...base, parsed: parsed(code, { problems: ['อ่านไม่ออกว่ารหัสนี้เป็นรุ่นอะไร'] }), outcome: null };
  }
}

const DUP: Record<string, unknown[]> = {
  [C.dupOdoo]: [{ product_template_id: 5551, internal_reference: 'FHTP2XBH010715', model: C.dupOdoo, name: `Band Heater "PM" ${C.dupOdoo}`, production: null, source: 'odoo' }],
  [C.dupLocal]: [{ product_template_id: 900000001, internal_reference: 'FCUP2XCH020457', model: C.dupLocal, name: `Cartridge Heater "PM" ${C.dupLocal}`, production: null, source: 'local' }],
};
const P_PARENT = { product_template_id: 1, internal_reference: 'FHTP2XBH010421', model: 'BH-01 x', name: 'Band Heater "PM" BH-01 x', production: null, source: 'odoo' };
const suggestFor = (model: string) => ({
  model, duplicate: DUP[model] ?? [], is_custom: false, parent: P_PARENT, parent_reason: 'key', group_size: 854, group_key: 'BH-01',
  ref: { internal_reference: 'FHTP2XBH010735', tier: 'boundary', prefix_length: 8, siblings: 734, min: 0, max: 734, warning: null },
  ref_message: null, name: `Band Heater "PM" ${model}`, inherited: {}, minimum_sales_price: null, min_price_ratio: 0.7,
});

// ── เสิร์ฟหน้า + API จำลอง ─────────────────────────────────────────────────
const calls: { method: string; path: string; body: string | undefined }[] = [];
let caps: Record<string, string> = {};
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json',
};
const json = (req: HTTPRequest, body: unknown, status = 200) =>
  req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function route(req: HTTPRequest) {
  const url = new URL(req.url());
  if (url.origin !== ORIGIN) return req.respond({ status: 204, body: '' });
  const path = url.pathname;
  if (!path.startsWith('/api/')) {
    const file = normalize(join(PUBLIC, path === '/' ? 'admin.html' : path));
    if (!file.startsWith(PUBLIC) || !existsSync(file)) return req.respond({ status: 404, body: 'not found' });
    return req.respond({ status: 200, contentType: MIME[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  }
  calls.push({ method: req.method(), path: path + url.search, body: req.postData() });
  const P = '/api/admin/webquote/products';
  if (path === '/api/admin/me/capabilities') return json(req, { capabilities: caps });
  if (path === '/api/admin/pricing/overview') {
    return json(req, { book: { ok: true, models: 13 }, version: `r${REVISION}`, models: [], edited: { at: '2026-10-01T03:13:12Z' }, catalog: BH_CATALOG, catalogTs: [] });
  }
  if (path === '/api/admin/pricing/quote' || path === `${P}/price`) {
    const b = JSON.parse(req.postData() ?? '{}');
    return json(req, quoteFor(String(b.code ?? '').trim()));
  }
  if (path === `${P}/suggest`) return json(req, suggestFor(url.searchParams.get('model') ?? ''));
  if (path === `${P}/count`) return json(req, { pending: 1 });
  if (path === `${P}/list`) return json(req, { items: [], total: 0, pending: 1, conflicts: 0 });
  if (path === P && req.method() === 'POST') {
    const b = JSON.parse(req.postData() ?? '{}');
    return json(req, { product: { product_template_id: 900000099, internal_reference: b.internal_reference, model: b.model, name: b.name, sales_price: b.sales_price } }, 201);
  }
  return json(req, {});
}

const TOKEN_PAYLOAD = Buffer.from(JSON.stringify({ id: 1, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const FAKE_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${TOKEN_PAYLOAD}.probe`;
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });

async function openPage(width: number): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 1000 });
  await page.setRequestInterception(true);
  page.on('request', (r) => { void route(r); });
  page.on('pageerror', (e: unknown) => { pageErrors.push(e instanceof Error ? e.message : String(e)); });
  await page.evaluateOnNewDocument('globalThis.__name = (f) => f;');
  await page.evaluateOnNewDocument((t: string) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', JSON.stringify({ id: 1, username: 'probe', name: 'Probe', role: 'admin' }));
  }, FAKE_TOKEN);
  await page.goto(`${ORIGIN}/admin.html?w=${width}#pricing`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#pl-code', { timeout: 15000 });
  // จอแคบซ่อนคำอธิบายหัวหน้า ⇒ รอที่เครือข่าย ไม่ใช่ข้อความ
  await page.waitForNetworkIdle({ idleTime: 250, timeout: 15000 });
  return page;
}

/** พิมพ์รหัสแล้วกด Enter — รอจนคำตอบทุกเส้น (คิดราคา + ตรวจรหัสซ้ำ) กลับมาครบ */
async function quote(page: Page, code: string) {
  await page.click('#pl-code', { count: 3 });
  await page.type('#pl-code', code);
  await page.keyboard.press('Enter');
  await page.waitForFunction((c: string) => document.body.innerText.includes(c === 'BH-01 30x20-220-100W' ? 'ไม่รับผลิต' : 'บาท'), { timeout: 5000 }, code);
  await page.waitForNetworkIdle({ idleTime: 250, timeout: 5000 });
}

/** สถานะของแถวปุ่ม — อ่านจากจอ ไม่ใช่จาก state */
const addRow = (page: Page) => page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'เพิ่มเป็นสินค้าใหม่') as HTMLButtonElement | undefined;
  const text = document.body.innerText;
  return {
    hasBtn: !!btn,
    disabled: btn?.disabled ?? null,
    hasIcon: !!btn?.querySelector('svg'),
    bg: btn ? getComputedStyle(btn).backgroundColor : '',
    why: btn?.parentElement?.querySelector('span')?.textContent?.trim() ?? '',
    dupBand: text.includes('รหัสนี้มีในระบบแล้ว'),
    tagOdoo: [...document.querySelectorAll('span')].some((s) => s.textContent?.trim() === 'Odoo'),
    tagLocal: text.includes('สินค้าเพิ่มเอง · ยังไม่เข้า Odoo'),
    link: [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('ไปหน้าสินค้าเพิ่มเอง')),
    saved: text.includes('เพิ่มสินค้าแล้ว'),
    modal: [...document.querySelectorAll('h2, h3')].some((h) => h.textContent?.trim() === 'เพิ่มสินค้าใหม่'),
    hscroll: document.documentElement.scrollWidth > window.innerWidth,
  };
});

const clickAdd = (page: Page) => page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'เพิ่มเป็นสินค้าใหม่') as HTMLButtonElement | undefined;
  btn?.click();
});
const waitModal = (page: Page) => page.waitForSelector('#lp-model', { timeout: 5000 });
const modalState = (page: Page) => page.evaluate(() => {
  const v = (sel: string) => (document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? null;
  const dialog = document.querySelector('#lp-model')?.closest('[role="dialog"]') ?? document.body;
  const text = (dialog as HTMLElement).innerText;
  return {
    model: v('#lp-model'), price: v('#lp-price'), desc: v('textarea'),
    bookTag: text.includes('จากสมุดราคา'), manualTag: text.includes('กำหนดเอง'),
    fromCode: text.includes('จากรหัสที่คิดราคา'), notFilled: text.includes('ราคาจากหน้าคำนวณยังไม่ครบ — ไม่ได้เติมให้'),
    descHint: text.includes('เติมตัวเลือกนอกรหัสให้แล้ว'),
  };
});
const modalButton = (page: Page, label: string) => page.evaluate((l: string) => {
  const b = [...document.querySelectorAll('button')].filter((x) => (x.textContent ?? '').trim() === l).at(-1) as HTMLButtonElement | undefined;
  if (b && !b.disabled) { b.click(); return true; }
  return false;
}, label);
/** สลับธีมด้วยปุ่มจริงของแอป (จอแคบปุ่มอยู่ในเมนูที่ซ่อน — `click()` ของ DOM ยังยิง onClick ได้) */
const toggleTheme = async (page: Page) => {
  const before = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark');
  const clicked = await page.evaluate(() => {
    const b = document.getElementById('admin-theme-toggle-btn') as HTMLButtonElement | null;
    b?.click();
    return !!b;
  });
  if (!clicked) throw new Error('หาปุ่มสลับธีมไม่เจอ');
  await page.waitForFunction((t: string) => (document.documentElement.dataset.theme ?? 'dark') !== t, { timeout: 3000 }, before);
  await new Promise((res) => setTimeout(res, 150));
};
const closeModal = async (page: Page) => { await modalButton(page, 'ยกเลิก'); await page.waitForSelector('#lp-model', { hidden: true, timeout: 5000 }); };

try {
  // ═══════════════ 1280px · admin ที่มีทุกสิทธิ์ ═══════════════
  console.log('\n── 1280px · มีสิทธิ์เพิ่มสินค้า ─────────────────────────');
  const page = await openPage(1280);
  const head = await page.evaluate(() => document.body.innerText);
  ok('7 · หัวหน้าไม่มีคำว่า "ยังไม่ต่อกับใบเสนอราคา"', head.includes('สมุดราคา 13 รุ่น') && !head.includes('ยังไม่ต่อกับใบเสนอราคา'));

  // ── ราคาครบ ──
  await quote(page, C.priced);
  let r = await addRow(page);
  ok('1 · มีปุ่ม "เพิ่มเป็นสินค้าใหม่" และกดได้', r.hasBtn && r.disabled === false);
  ok('2 · ปุ่มรองสีน้ำเงิน + ไอคอนบวก', r.hasIcon && /rgb\(\s*(37|59|96), (99|130|165), (235|246|250)/.test(r.bg), r.bg);
  ok('   ราคาครบไม่มีข้อความข้างปุ่ม · ไม่มีแถบรหัสซ้ำ', r.why === '' && !r.dupBand, r.why);
  ok('5 · ตรวจรหัสซ้ำตั้งแต่ยังไม่กด (ยิง /suggest ของรหัสที่คิด)',
    calls.some((c) => c.path === `/api/admin/webquote/products/suggest?${new URLSearchParams({ model: C.priced })}`));
  await page.screenshot({ path: `${SHOTS}pa-priced-1280.png` });
  await clickAdd(page);
  await waitModal(page);
  await page.waitForNetworkIdle({ idleTime: 450, timeout: 5000 });
  let m = await modalState(page);
  ok('3 · หน้าต่าง: model = รหัสที่คิด + ป้าย "จากรหัสที่คิดราคา"', m.model === C.priced && m.fromCode, String(m.model));
  ok('   ราคาครบ = เติมราคา + ป้าย "จากสมุดราคา"', m.price === '12480' && m.bookTag && !m.manualTag, `${m.price}`);
  ok('   ไม่มีตัวเลือกนอกรหัส = Description ว่าง', m.desc === '' && !m.descHint);
  await page.screenshot({ path: `${SHOTS}pa-modal-priced-1280.png` });
  calls.length = 0;
  ok('   กด "เพิ่มสินค้า" ได้', await modalButton(page, 'เพิ่มสินค้า'));
  await page.waitForSelector('#lp-model', { hidden: true, timeout: 5000 });
  const post = calls.find((c) => c.method === 'POST' && c.path === '/api/admin/webquote/products');
  const pb = JSON.parse(post?.body ?? '{}');
  ok('   POST ส่ง model · ราคา · pricebook_price · เล่มที่คิด', pb.model === C.priced && pb.sales_price === 12480
    && pb.pricebook_price === 12480 && pb.price_book_revision === REVISION && pb.minimum_sales_price === 8736, post?.body);
  r = await addRow(page);
  ok('6 · เพิ่มเสร็จ = แถบเขียว "เพิ่มสินค้าแล้ว" + รหัส แทนปุ่ม', r.saved && !r.hasBtn
    && (await page.evaluate(() => document.body.innerText.includes('FHTP2XBH010735'))));
  ok('   มีลิงก์ไปหน้าสินค้าเพิ่มเอง (คนนี้เปิดหน้านั้นได้)', r.link);
  ok('   หน้าคำนวณราคาอยู่ที่เดิม', (await page.evaluate(() => location.hash)) === '#pricing');
  await page.screenshot({ path: `${SHOTS}pa-saved-1280.png` });

  // ── ตัวเลือกนอกรหัส ──
  await quote(page, C.picks);
  r = await addRow(page);
  ok('   รหัสใหม่ = แถบเขียวของรหัสเดิมหาย ปุ่มกลับมา', !r.saved && r.hasBtn && r.disabled === false);
  await clickAdd(page);
  await waitModal(page);
  await page.waitForNetworkIdle({ idleTime: 450, timeout: 5000 });
  m = await modalState(page);
  ok('4 · ตัวเลือกนอกรหัสลง Description ให้', m.desc === PICK_DESC && m.descHint, String(m.desc));
  ok('   ราคาที่เติม = ราคาที่รวมตัวเลือกแล้ว', m.price === '3350' && m.bookTag, String(m.price));
  calls.length = 0;
  await modalButton(page, 'คิดราคา');
  await page.waitForNetworkIdle({ idleTime: 250, timeout: 5000 });
  const priceCall = calls.find((c) => c.path === '/api/admin/webquote/products/price');
  const pcb = JSON.parse(priceCall?.body ?? '{}');
  ok('   ปุ่มคิดราคาในหน้าต่างส่งตัวเลือกชุดเดียวกันไปด้วย', pcb.code === C.picks && pcb.picks?.amp === '30A'
    && pcb.picks?.addons?.[0] === 'cable:silicone' && pcb.picks?.holes?.[0]?.mm === 10, priceCall?.body);
  await page.screenshot({ path: `${SHOTS}pa-modal-picks-1280.png` });
  await closeModal(page);

  // ── ราคาไม่ครบ / ต้องขอราคา ──
  for (const [label, code] of [['ราคาไม่ครบ', C.partial], ['ต้องขอราคา (คิดได้บางส่วน)', C.ask]] as const) {
    await quote(page, code);
    r = await addRow(page);
    ok(`3 · ${label}: ปุ่มกดได้ + บอกว่าจะให้กรอกราคาเอง`, r.disabled === false && r.why === 'ราคายังไม่ครบ — ในหน้าต่างจะให้กรอกราคาเอง', r.why);
    await clickAdd(page);
    await waitModal(page);
    m = await modalState(page);
    ok('   หน้าต่างไม่เติมราคา + บอกเหตุผล', m.price === '' && m.notFilled && !m.bookTag, String(m.price));
    // ปุ่มคิดราคาในหน้าต่างเติมลงช่องเอง (2026-10-02) ⇒ เกณฑ์ "ครบ" ต้องตัวเดียวกับหน้านี้ ไม่งั้นราคาครึ่งเดียวหลุดลงช่อง
    await modalButton(page, 'คิดราคา');
    await page.waitForFunction(() => document.body.innerText.includes('คิดราคาจากสมุดราคาไม่ครบ'), { timeout: 5000 }).catch(() => undefined);
    m = await modalState(page);
    ok('   กดคิดราคาในหน้าต่าง = กล่อง "ไม่ครบ" · ช่องราคายังว่าง', m.price === ''
      && (await page.evaluate(() => document.body.innerText.includes('คิดราคาจากสมุดราคาไม่ครบ'))), String(m.price));
    await closeModal(page);
  }

  // ── ไม่รับผลิต ──
  calls.length = 0;
  await quote(page, C.block);
  r = await addRow(page);
  ok('3 · ไม่รับผลิต: ปุ่มยังอยู่แต่กดไม่ได้ + เหตุผลข้างปุ่ม', r.hasBtn && r.disabled === true && r.why === 'คิดราคาไม่ได้ — แก้รหัสให้คิดราคาได้ก่อน', r.why);
  ok('   ไม่ยิง /suggest', !calls.some((c) => c.path.startsWith('/api/admin/webquote/products/suggest')));
  await page.screenshot({ path: `${SHOTS}pa-block-1280.png` });

  // ── รหัสที่มีในระบบแล้ว ──
  await quote(page, C.dupOdoo);
  r = await addRow(page);
  ok('5 · มีใน Odoo แล้ว: แถบเตือนขึ้นตั้งแต่ยังไม่กด + ป้าย Odoo', r.dupBand && r.tagOdoo && !r.tagLocal);
  ok('   ปุ่มกดไม่ได้ + เหตุผลข้างปุ่ม', r.disabled === true && r.why === 'มีในระบบแล้ว — เพิ่มซ้ำไม่ได้', r.why);
  ok('   ของ Odoo ไม่มีลิงก์ไปหน้าสินค้าเพิ่มเอง', !r.link);
  ok('   บอกรหัส + ชื่อของตัวที่มีอยู่', await page.evaluate(() => document.body.innerText.includes('FHTP2XBH010715 Band Heater "PM" BH-01 100x50-240-1000W')));
  await clickAdd(page);
  await new Promise((res) => setTimeout(res, 300));
  ok('   กดปุ่มแล้วไม่มีหน้าต่างเด้ง', !(await page.$('#lp-model')));
  await page.screenshot({ path: `${SHOTS}pa-dup-odoo-1280.png` });

  await quote(page, C.dupLocal);
  r = await addRow(page);
  ok('5 · มีเป็นสินค้าเพิ่มเองแล้ว: ป้าย "สินค้าเพิ่มเอง · ยังไม่เข้า Odoo" + ลิงก์', r.dupBand && r.tagLocal && r.link && r.disabled === true);
  await page.screenshot({ path: `${SHOTS}pa-dup-local-1280.png` });
  await toggleTheme(page);
  await page.screenshot({ path: `${SHOTS}pa-dup-local-1280-light.png` });
  await toggleTheme(page);
  await page.evaluate(() => ([...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('ไปหน้าสินค้าเพิ่มเอง')) as HTMLButtonElement).click());
  await page.waitForFunction(() => location.hash === '#odooproducts', { timeout: 5000 }).catch(() => undefined);
  ok('   กดลิงก์ = ไปหน้าสินค้าเพิ่มเอง', (await page.evaluate(() => location.hash)) === '#odooproducts');
  await page.close();

  // ═══════════════ สิทธิ์ ═══════════════
  console.log('\n── สิทธิ์ ───────────────────────────────────────────');
  caps = { 'page.odooproducts': 'deny' };
  const noPage = await openPage(1280);
  await quote(noPage, C.dupLocal);
  r = await addRow(noPage);
  ok('5 · เปิดหน้าสินค้าเพิ่มเองไม่ได้ = แถบเตือนยังขึ้น แต่ไม่มีลิงก์', r.dupBand && !r.link);
  await noPage.close();

  caps = { 'quote.manage_products': 'deny' };
  calls.length = 0;
  const noPerm = await openPage(1280);
  await quote(noPerm, C.priced);
  r = await addRow(noPerm);
  ok('1 · ไม่มีสิทธิ์เพิ่มสินค้า = ไม่มีปุ่ม', !r.hasBtn && !r.dupBand);
  ok('   และไม่ยิง /suggest เลย', !calls.some((c) => c.path.startsWith('/api/admin/webquote/products/suggest')));
  await noPerm.close();
  caps = {};

  // ═══════════════ ความกว้าง ═══════════════
  for (const w of [390, 640, 641]) {
    console.log(`\n── ${w}px ─────────────────────────────────────────`);
    const p = await openPage(w);
    for (const [label, code] of [['ราคาครบ', C.priced], ['ไม่รับผลิต', C.block], ['มีใน Odoo แล้ว', C.dupOdoo], ['เพิ่มเองแล้ว', C.dupLocal]] as const) {
      await quote(p, code);
      r = await addRow(p);
      ok(`${label}: ไม่มีแถบเลื่อนแนวนอน`, !r.hscroll && r.hasBtn);
    }
    await p.screenshot({ path: `${SHOTS}pa-dup-local-${w}.png`, fullPage: true });
    await toggleTheme(p);
    await p.screenshot({ path: `${SHOTS}pa-dup-local-${w}-light.png`, fullPage: true });
    await toggleTheme(p);
    await quote(p, C.picks);
    await clickAdd(p);
    await waitModal(p);
    await p.waitForNetworkIdle({ idleTime: 450, timeout: 5000 });
    ok('หน้าต่างเพิ่มสินค้าไม่ล้นจอ', !(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
    await p.screenshot({ path: `${SHOTS}pa-modal-picks-${w}.png` });
    await p.close();
  }

  ok('ไม่มี error หลุดจากหน้าเว็บ', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
}

console.log(`\nภาพอยู่ที่ ${SHOTS}pa-*.png`);
console.log(fail === 0 ? '\nผ่านทุกข้อ' : `\nล้ม ${fail} ข้อ`);
process.exit(fail === 0 ? 0 : 1);
