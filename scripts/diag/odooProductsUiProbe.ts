/* ─────────────────────────────────────────────────────────────────────────────
   เปิดหน้า "สินค้าเพิ่มเอง" จริงแล้วกดจริง — เฟส J4 ของ docs/plan-local-products.md

   ทำไมต้องมีด่านนี้ ทั้งที่ `build` ผ่านแล้ว: ปุ่มที่อ้างฟังก์ชันที่ไม่เคยถูกเขียน และบรรทัด
   import ที่หาย **build ผ่านทั้งคู่** (AGENTS.md A9) ⇒ "เสร็จ" แปลว่าเปิดดูที่ความกว้างจริง

   **ไม่แตะฐานเลย และไม่ต้องเปิดเซิร์ฟเวอร์** — ต่างจาก `diag:oc-ui` ที่สร้างแถวจริงแล้วลบทิ้ง:
   puppeteer เสิร์ฟ `public/` ที่ build แล้วเอง และตอบทุก `/api/*` ด้วยข้อมูลชุดเล็กในไฟล์นี้
   ⇒ รันซ้ำกี่รอบก็ไม่มีแถวค้าง · ราคาที่จ่ายคือ "ไม่ได้พิสูจน์ฝั่ง server" ซึ่งเป็นงานของ
   `diag:local-products` (กติกาแก้/ลบ/ออกรหัส) กับ `diag:role-permissions` (ด่านสิทธิ์) อยู่แล้ว

   สิ่งที่พิสูจน์ (ตาม mockup `local-products-list` ที่เจ้าของยืนยัน 2026-10-02 รอบ 4):
   เมนู + ตัวเลขวงกลมเหลือง · หัวคอลัมน์ (รหัสสินค้าแรก · สถานะก่อนจัดการ) · ทุกแถว ≤ 2 บรรทัด ·
   ป้าย "อัตโนมัติ"/"กำหนดเอง" เท่านั้น · แถบแจ้งเตือนบรรทัดเดียวเหนือตัวกรอง · ปุ่มส่งออก ·
   ปุ่มกดไม่ได้เมื่อมีใบอ้าง · ออกรหัสใหม่ / ลบ ยิงเส้นที่ถูก ·
   390px เป็นการ์ดสองบรรทัดและไม่มีแถบเลื่อนแนวนอน
   + รอบ 5 (2026-10-02): ตัวกรองสี่กลุ่มที่ไม่ทับกัน (ยังไม่ส่งออก · รอนำเข้า · รหัสซ้ำ/ไม่ตรง · นำเข้าแล้ว)
   ป้ายสถานะใช้คำเดียวกับตัวกรอง · แถบแดงนับจาก server ทุกกลุ่มและกดแล้วเปิดกลุ่ม "รหัสซ้ำ/ไม่ตรง"
   (ตัวจำลอง `groupOf` ข้างล่างลอกลำดับของ `FILTER_SQL` — ตัวจริงพิสูจน์ใน `diag:local-products`)
   + J6 (2026-10-02 · mockup `local-product-add`): หน้าต่างเพิ่ม/แก้สินค้าทุกกรณี (ปกติ · ไม่แน่ใจรหัส ⇒ ต้องติ๊ก ·
   ออกรหัสไม่ได้ ⇒ พิมพ์เอง · หาต้นแบบไม่ได้ ⇒ ค้นเอง · model ซ้ำ · แก้ไข) · ปุ่มคิดราคา + ใช้ราคานี้ · % ราคาขั้นต่ำ ·
   ทางเข้าจากหน้าขอใบเสนอราคา (แถว "+ เพิ่มสินค้าใหม่" ท้ายผลค้น ⇒ ใส่ลงใบ + ป้าย "เพิ่มเอง") · 390px ไม่ล้น
   ⚠️ ก้อน /suggest · /price ข้างล่างเป็นของจำลอง — ตรรกะจริงพิสูจน์ใน `diag:local-products` ข้อ 13–17

   รัน: `npm run build --prefix frontend` ก่อน แล้ว `npm run diag:op-ui`
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type HTTPRequest, type Page } from 'puppeteer';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const SHOTS = process.env.OP_SHOTS || fileURLToPath(new URL('../../mockup/shots/', import.meta.url));
const ORIGIN = 'http://op-probe.local';
mkdirSync(SHOTS, { recursive: true });

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

// ── ข้อมูลชุดเล็ก — รูปเดียวกับ `listProducts()` ของ services/localProducts.ts ────────────
const base = {
  parent_reference: null, rejected_refs: [] as string[], sales_description: null, brand: null, series: null,
  product_group: null, product_category: null, product_sub_category: null, unit_of_measure: 'Pcs',
  price_book_revision: null, pricebook_price: null, created_by: 1, updated_at: '2026-10-02T03:00:00Z',
  odoo_matched_template_id: null, ref_parts: null,
};
const ROWS = [
  { ...base, product_template_id: 900000001, internal_reference: 'FCUP2XCH020457', ref_tier: 'boundary',
    model: 'CH-02 6.5x240-42-450W-1-S000', name: 'Cartridge Heater "PM" CH-02 6.5x240-42-450W-1-S000',
    sales_price: 1420, minimum_sales_price: 994, price_source: 'manual', created_at: '2026-10-02T03:00:00Z',
    created_by_name: 'สมชาย', exported_at: null, odoo_matched_at: null, status: 'not_imported',
    quotation_count: 2, odoo_model_conflicts: [] },
  { ...base, product_template_id: 900000002, internal_reference: 'FHTP2XBH020247', ref_tier: 'max_plus_one',
    model: 'BH-02 100x320-230-130W', name: 'Strip Heater "PM" BH-02 100x320-230-130W',
    sales_price: 1050, minimum_sales_price: 735, price_source: 'pricebook', created_at: '2026-10-02T02:00:00Z',
    created_by_name: 'วิภา', exported_at: null, odoo_matched_at: null, status: 'not_imported',
    quotation_count: 0, odoo_model_conflicts: [] },
  { ...base, product_template_id: 900000003, internal_reference: 'FHTP2XCH021954', ref_tier: 'boundary',
    model: 'CH-02 12x110-220-350W-60cm', name: 'Cartridge Heater "PM" CH-02 12x110-220-350W-60cm',
    sales_price: 905, minimum_sales_price: 633.5, price_source: 'manual', created_at: '2026-09-30T02:00:00Z',
    created_by_name: 'วิภา', exported_at: '2026-10-01T02:00:00Z', odoo_matched_at: null, status: 'not_imported',
    quotation_count: 0,
    odoo_model_conflicts: [{ product_template_id: 5551, internal_reference: 'FHTP2XCH021960', name: 'x' }] },
  { ...base, product_template_id: 900000004, internal_reference: 'FTGP1TGM66012R', ref_tier: 'manual',
    rejected_refs: ['FTGP1TGM66011R'],
    model: 'TGM-66012.R1', name: 'Temperature Controller "TOHO" TGM-66012.R1',
    sales_price: 3200, minimum_sales_price: 2240, price_source: 'manual', created_at: '2026-09-29T02:00:00Z',
    created_by_name: null, exported_at: '2026-09-30T02:00:00Z', odoo_matched_at: null, status: 'not_imported',
    quotation_count: 0, odoo_model_conflicts: [] },
  { ...base, product_template_id: 900000005, internal_reference: 'FHTP2XCH021953', ref_tier: 'boundary',
    model: 'CH-02 11.8x500-220-1300W-3', name: 'Cartridge Heater "PM" CH-02 11.8x500-220-1300W-3',
    sales_price: 1750, minimum_sales_price: 1225, price_source: 'manual', created_at: '2026-09-24T02:00:00Z',
    created_by_name: 'วิภา', exported_at: '2026-09-25T02:00:00Z', odoo_matched_at: '2026-09-27T02:00:00Z',
    status: 'imported', quotation_count: 4, odoo_model_conflicts: [] },
];
const PENDING = ROWS.filter((r) => !r.odoo_matched_at).length;
type Row = (typeof ROWS)[number];
/** กลุ่มของแถว — ลำดับเดียวกับ `FILTER_SQL` (นำเข้าแล้ว > ซ้ำ > ส่งออกแล้ว > ยังไม่ส่งออก) */
const groupOf = (r: Row) =>
  r.odoo_matched_at ? 'matched' : r.odoo_model_conflicts.length ? 'conflict' : r.exported_at ? 'exported' : 'pending';
const inGroup = (g: string) => ROWS.filter((r) => groupOf(r) === g);
const CONFLICTS = inGroup('conflict').length;

// ── J6 · ก้อนของ GET /suggest — ลอกจากฐานจริง 2026-10-02 (อ่านอย่างเดียว) ยกเว้น max_plus_one ที่หาเคสจริงไม่เจอ ──
const INH_TSK = { brand: 'PM', series: 'TSK', product_group: 'Inst 1', product_category: 'FinishGoods', product_sub_category: 'Thermocouple', unit_of_measure: 'Pcs.' };
const P_TSK = { product_template_id: 164775, internal_reference: 'FCUP2TSK040094', model: 'TSK-04(S2)6x75+1MF-S000',
  name: 'Thermocouple K Type "Primus" TSK-04(S2)6x75+1MF-S000', production: 'Production 2(PM)', source: 'odoo' };
const P_PICKED = { product_template_id: 155085, internal_reference: 'FTGP1TGM066099', model: 'TGM-66099',
  name: '7 Segment Big Display 2.3" Red "Primus" TGM-66099', production: 'Production 1(PM)', source: 'odoo' };
const sugBase = (model: string) => ({ model, duplicate: [] as unknown[], is_custom: false, parent: null as unknown, parent_reason: null as string | null,
  group_size: 0, group_key: null as string | null, ref: null as unknown, ref_message: null as string | null, name: model,
  inherited: {} as Record<string, string | null>, minimum_sales_price: null, min_price_ratio: 0.7 });
function suggestFor(model: string, parent: string | null) {
  if (parent) {
    return { ...sugBase(model), parent: P_PICKED, parent_reason: 'chosen', name: `7 Segment Big Display 2.3" Red "Primus" ${model}`,
      ref: { internal_reference: 'FTGP1TGM066194', tier: 'boundary', prefix_length: 11, siblings: 147, min: 1, max: 193, warning: null },
      inherited: { ...INH_TSK, series: 'TGM' } };
  }
  if (model === 'TSK-04(S2)6x75+3M-S123') {
    return { ...sugBase(model), is_custom: true, parent: P_TSK, parent_reason: 'key', group_size: 33, group_key: 'TSK-04(S2)',
      ref: { internal_reference: 'FCUP2TSK040178', tier: 'boundary', prefix_length: 10, siblings: 178, min: 0, max: 177, warning: null },
      name: 'Thermocouple K Type "Primus" TSK-04(S2)6x75+3M-S123', inherited: INH_TSK };
  }
  if (model === 'BH-01 100x50') {
    return { ...sugBase(model), parent: { ...P_TSK, internal_reference: 'FHTP2XBH010715', model: 'BH-01 100x50-240-1000W', name: 'Band Heater "PM" BH-01 100x50-240-1000W' },
      parent_reason: 'key', group_size: 854, group_key: 'BH-01', name: 'Band Heater "PM" BH-01 100x50', inherited: INH_TSK,
      ref: { internal_reference: 'FHTP2XBH010735', tier: 'max_plus_one', prefix_length: 8, siblings: 732, min: 0, max: 734,
        warning: 'เลขท้ายของตระกูลนี้อาจเป็นเลขรุ่น ระบบแค่นับต่อจากตัวล่าสุดให้ — เทียบกับรหัสใน Odoo ก่อนบันทึก' } };
  }
  if (model === 'TGM-66011.R2') {
    return { ...sugBase(model), parent: { ...P_PICKED, internal_reference: 'FTGP1TGM66011R', model: 'TGM-66011.R1' }, parent_reason: 'key',
      group_size: 2, group_key: 'TGM-66011', name: '7 Segment Big Display 4" Red "Primus" TGM-66011.R2', inherited: INH_TSK,
      ref_message: 'ตระกูลนี้ออกเลขต่อให้ไม่ได้ (เลขท้ายคือเลขรุ่น หรือนับต่อแล้วจะกลายเป็นรหัสของรุ่นอื่น) — กรุณาพิมพ์รหัสเอง' };
  }
  // server รุ่นที่ยังไม่ส่ง min_price_ratio (เกิดจริงบนพรีวิว 2026-10-02 · ช่อง % ขึ้น NaN)
  if (model === 'OLD-SERVER-1') {
    const { min_price_ratio: _drop, ...old } = { ...sugBase(model), parent: P_TSK, parent_reason: 'key',
      ref: { internal_reference: 'FCUP2TSK040178', tier: 'boundary', prefix_length: 10, siblings: 178, min: 0, max: 177, warning: null } };
    void _drop;
    return old;
  }
  if (model === 'TSK-04(S2)6x75+1MF-S000') return { ...sugBase(model), duplicate: [P_TSK], parent: P_TSK, parent_reason: 'key', ref: null };
  return { ...sugBase(model), ref_message: 'ระบบหาต้นแบบให้ไม่ได้ — กรุณาเลือกต้นแบบเอง' };
}
/** คำตอบของ POST /price — ตัวคิดราคาจริงพิสูจน์ใน diag:local-products ข้อ 16 */
const PRICED = { code: 'TSK-04(S2)6x75+3M-S123', parsed: { problems: [] }, revision: 17, outcome: { status: 'priced', unitPrice: 775,
  violations: [], breakdown: [
    { step: 'base', label: 'ราคาตั้ง TSK-04', detail: 'ขนาดแกน 6 · ขนาดเกลียว 1/4”', amount: 615, running: 615 },
    { step: 'perUnit', label: 'สายส่วนที่ยาวเกิน 1 เมตร', detail: '2 × 1 m @80', amount: 160, running: 775 }] } };
let lastCreated: Record<string, unknown> | null = null;

/** ทุกคำขอ API ที่หน้าเว็บยิงมา — ใช้ตรวจว่าปุ่มยิงเส้นที่ถูกด้วย method ที่ถูก */
const calls: { method: string; path: string; body: string | undefined }[] = [];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json',
};

function json(req: HTTPRequest, body: unknown, status = 200) {
  return req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function route(req: HTTPRequest) {
  const url = new URL(req.url());
  if (url.origin !== ORIGIN) {
    // ฟอนต์จากภายนอก — ไม่ต้องรอเน็ต ตอบว่างไปเลย
    return req.respond({ status: 204, body: '' });
  }
  const path = url.pathname;
  if (!path.startsWith('/api/')) {
    const file = normalize(join(PUBLIC, path === '/' ? 'admin.html' : path));
    if (!file.startsWith(PUBLIC) || !existsSync(file)) return req.respond({ status: 404, body: 'not found' });
    return req.respond({ status: 200, contentType: MIME[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  }
  calls.push({ method: req.method(), path: path + url.search, body: req.postData() });

  const P = '/api/admin/webquote/products';
  if (path === '/api/admin/me/capabilities') return json(req, { capabilities: {} });  // ไม่ deny อะไร = เห็นทุกเมนู
  if (path === `${P}/count`) return json(req, { pending: PENDING });
  if (path === `${P}/list`) {
    const items = inGroup(url.searchParams.get('filter') ?? 'pending');
    return json(req, { items, total: items.length, pending: PENDING, conflicts: CONFLICTS });
  }
  if (path === `${P}/next-ref`) {
    return json(req, { parent_reference: url.searchParams.get('parent'), ref: { internal_reference: 'FHTP2XBH020248', tier: 'boundary' }, ref_message: null });
  }
  if (path === `${P}/suggest`) return json(req, suggestFor(url.searchParams.get('model') ?? '', url.searchParams.get('parent')));
  if (path === `${P}/parents`) return json(req, { items: [P_PICKED] });
  if (path === `${P}/price`) {
    const code = JSON.parse(req.postData() ?? '{}').code;
    return json(req, code === PRICED.code ? PRICED : { code, parsed: { problems: ['อ่านไม่ออกว่ารหัสนี้เป็นรุ่นอะไร'] }, outcome: null, revision: 17 });
  }
  if (path === P && req.method() === 'POST') {
    const b = JSON.parse(req.postData() ?? '{}');
    lastCreated = b;
    return json(req, { product: { product_template_id: 900000099, model: b.model, name: b.name, sales_price: b.sales_price } }, 201);
  }
  if (path === '/api/products/search') return json(req, []);
  if (path === `${P}/900000002` && req.method() === 'GET') {
    return json(req, { product: { ...ROWS[1], parent: P_TSK, min_price_ratio: 0.7, ...INH_TSK } });
  }
  if (path === `${P}/900000002` && req.method() === 'PUT') return json(req, { product: { ...ROWS[1], ...JSON.parse(req.postData() ?? '{}') } });
  if (/\/api\/admin\/webquote\/products\/\d+\/reissue-ref$/.test(path)) return json(req, { product: {} });
  if (/\/api\/admin\/webquote\/products\/\d+$/.test(path) && req.method() === 'DELETE') return json(req, { ok: true });
  // เส้นอื่นของแอป (สถิติหน้าแรก · ตัวเลขเมนูอื่น) — ตอบว่างพอให้หน้าไม่ล้ม
  return json(req, {});
}

const TOKEN_PAYLOAD = Buffer.from(JSON.stringify({ id: 1, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const FAKE_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${TOKEN_PAYLOAD}.probe`;

async function openPage(width: number): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 1000 });
  await page.setRequestInterception(true);
  page.on('request', (r) => { void route(r); });
  // tsx (esbuild keepNames) ห่อฟังก์ชันที่มีชื่อด้วย `__name(...)` — โค้ดที่ส่งเข้าไปรันในหน้าเว็บจึงต้องมีตัวนี้
  await page.evaluateOnNewDocument('globalThis.__name = (f) => f;');
  await page.evaluateOnNewDocument((t: string) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', JSON.stringify({ id: 1, username: 'probe', name: 'Probe', role: 'admin' }));
  }, FAKE_TOKEN);
  await page.goto(`${ORIGIN}/admin.html?w=${width}#odooproducts`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.innerText.includes('FCUP2XCH020457'), { timeout: 15000 });
  return page;
}

// headless ตอบ (hover: hover) = false และ Tailwind 4 ห่อ hover: ไว้ในเงื่อนไขนั้น ⇒ ไม่ตั้งเป็นเมาส์ก็ไม่มีสีตอนชี้ให้ตรวจ
// (puppeteer emulateMediaFeatures กับ CDP setEmulatedMedia ไม่รับ `hover` — ต้องตั้งที่ blink · 2 = hover · 4 = fine)
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'] });
try {
  // ═══════════════ 1280px ═══════════════
  console.log('\n── 1280px ─────────────────────────────────────────');
  const page = await openPage(1280);

  // เมนู + ตัวเลข
  const badge = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('nav button, aside button, button')]
      .find((b) => (b.textContent ?? '').includes('สินค้าเพิ่มเอง'));
    const span = btn ? [...btn.querySelectorAll('span')].find((s) => /^\d+$/.test((s.textContent ?? '').trim())) : null;
    if (!span) return null;
    const cs = getComputedStyle(span);
    const r = span.getBoundingClientRect();
    return { n: span.textContent?.trim(), radius: cs.borderRadius, border: cs.borderTopWidth, w: r.width, h: r.height };
  });
  ok('เมนู "สินค้าเพิ่มเอง" มีตัวเลขค้าง = จำนวนที่ยังไม่นำเข้า', badge?.n === String(PENDING), JSON.stringify(badge));
  ok('  ตัวเลขเป็นวงกลมมีขอบ (เจ้าของสั่ง 2026-10-02)',
    !!badge && parseFloat(badge.border) >= 1 && Math.abs(badge.w - badge.h) <= 1 && parseFloat(badge.radius) >= badge.h / 2 - 1);

  const titles = await page.$$eval('main h1, main h2, h1, h2', (hs) => hs.map((h) => h.textContent?.trim()));
  ok('หัวหน้า = ชื่อเมนู', titles.includes('สินค้าเพิ่มเอง'), titles.join(' | '));

  // หัวคอลัมน์
  const heads = await page.$$eval('table thead th', (ths) => ths.filter((t) => (t as HTMLElement).offsetParent !== null).map((t) => t.textContent?.trim()));
  ok('คอลัมน์แรก = รหัสสินค้า', heads[0] === 'รหัสสินค้า', heads.join(' | '));
  ok('สถานะอยู่ก่อนจัดการ (สองคอลัมน์สุดท้าย)', heads.at(-2) === 'สถานะ' && heads.at(-1) === 'การจัดการ');

  // แถว
  const rows = await page.$$eval('table tbody tr', (trs) => trs.map((tr) => ({
    text: (tr as HTMLElement).innerText,
    h: tr.getBoundingClientRect().height,
    // เซลล์ที่สูงที่สุดในแถว เทียบกับความสูงของหนึ่งบรรทัดตัวเล็ก (11px × 1.5 ≈ 16.5px)
    lines: Math.max(...[...tr.querySelectorAll('td')].map((td) => {
      const kids = [...td.children] as HTMLElement[];
      return kids.reduce((n, k) => n + Math.max(1, Math.round(k.getBoundingClientRect().height / 18)), 0);
    })),
    disabled: [...tr.querySelectorAll('button')].map((b) => (b as HTMLButtonElement).disabled),
  })));
  const PENDING_GROUP = inGroup('pending').length;
  ok('ค่าตั้งต้น = กลุ่ม "ยังไม่ส่งออก"', rows.length === PENDING_GROUP
    && calls.some((c) => c.path.startsWith('/api/admin/webquote/products/list?filter=pending')), `${rows.length} แถว`);
  ok('ทุกแถวไม่เกินสองบรรทัด', rows.every((r) => r.lines <= 2), rows.map((r) => r.lines).join(','));
  const tagText = rows.map((r) => r.text).join('\n');
  ok('ป้ายรหัส "อัตโนมัติ" ทุกแถวที่ระบบออกให้ (รวมแบบนับต่อ — ไม่มีป้ายแยก)', (tagText.match(/อัตโนมัติ/g) ?? []).length === PENDING_GROUP);
  ok('  ไม่มีคำศัพท์ภายในหลุดขึ้นจอ', !/ขอบเลขวิ่ง|นับต่อ|max_plus_one|boundary|สั่งทำ/.test(tagText));
  ok('ป้ายสถานะใช้คำของกลุ่ม + บรรทัดสองเป็นวันที่เพิ่ม', (tagText.match(/ยังไม่ส่งออก/g) ?? []).length === PENDING_GROUP
    && (tagText.match(/เพิ่มเมื่อ/g) ?? []).length === PENDING_GROUP);
  const options = await page.$$eval('select[aria-label="สถานะ"] option', (os) => os.map((o) => o.textContent?.trim()));
  ok('ตัวกรองมีสี่กลุ่มตามที่เจ้าของสั่ง (เรียงตามนี้)',
    options.join('|') === 'ยังไม่ส่งออก|รอนำเข้า|รหัสซ้ำ/ไม่ตรง|นำเข้าแล้ว', options.join(' | '));
  // ปุ่มแรกคือแก้ไข (J6) ซึ่งกดได้แม้มีใบอ้าง — แก้ชื่อ/ราคาได้ แค่ model ล็อก
  ok('แถวที่มีใบอ้าง: ออกรหัสใหม่/ลบ กดไม่ได้ · แก้ไขยังกดได้', rows[0].disabled.slice(-2).every(Boolean) && rows[0].disabled[0] === false,
    JSON.stringify(rows[0].disabled));
  ok('แถวที่ไม่มีใบอ้าง: กดได้', rows[1].disabled.every((d) => !d), JSON.stringify(rows[1].disabled));
  ok('J6 · มีปุ่ม "เพิ่มสินค้าใหม่" สีหลัก + ไอคอนแก้ไขเป็นปุ่มแรกของแถว',
    !!(await page.$('button[aria-label="เพิ่มสินค้าใหม่"]'))
      && (await page.$$eval('table tbody tr:nth-child(2) button', (bs) => bs[0]?.getAttribute('aria-label') ?? '')).startsWith('แก้ไข '));

  // แถบแจ้งเตือน
  const bars = await page.evaluate(() => {
    const pick = (needle: string) => {
      const p = [...document.querySelectorAll('p, button > span')].find((x) => (x.textContent ?? '').includes(needle));
      const box = p?.parentElement;
      return box ? { h: box.getBoundingClientRect().height, top: box.getBoundingClientRect().top, ph: p!.getBoundingClientRect().height } : null;
    };
    const search = document.querySelector('input[placeholder^="ค้นหา รหัสสินค้า"]');
    return { info: pick('ด้วยรหัสตามไฟล์'), red: pick('model ซ้ำกับ Odoo'), filterTop: search?.getBoundingClientRect().top ?? 0 };
  });
  ok('แถบฟ้า/แดงอยู่บรรทัดเดียว', !!bars.info && !!bars.red && bars.info.ph <= 20 && bars.red.ph <= 20,
    `ฟ้า ${bars.info?.ph}px · แดง ${bars.red?.ph}px`);
  ok('  และอยู่เหนือตัวกรองทั้งคู่', !!bars.info && !!bars.red && bars.info.top < bars.filterTop && bars.red.top < bars.filterTop);

  const exportBtn = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '').find((t) => t.startsWith('ส่งออก')));
  ok('ปุ่มส่งออกบอกชนิดไฟล์และจำนวนในกลุ่มที่เลือก', exportBtn === `ส่งออก xlsx (${PENDING_GROUP} รายการ)`, String(exportBtn));
  await page.screenshot({ path: `${SHOTS}op-1280.png`, fullPage: true });

  // ออกรหัสใหม่ — แถวที่ 2 (ไม่มีใบอ้าง)
  calls.length = 0;
  await page.click('[aria-label="ออกรหัสใหม่ BH-02 100x320-230-130W"]');
  await page.waitForFunction(() => document.body.innerText.includes('FHTP2XBH020248'), { timeout: 5000 });
  ok('กล่องออกรหัสใหม่แสดงรหัสที่จะได้จาก /next-ref', calls.some((c) => c.path.startsWith('/api/admin/webquote/products/next-ref?parent=FHTP2XBH020247')));
  await page.screenshot({ path: `${SHOTS}op-reissue.png` });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter((x) => x.textContent?.trim() === 'ออกรหัสใหม่').at(-1) as HTMLButtonElement;
    b.click();
  });
  await page.waitForFunction(() => !document.body.innerText.includes('ให้ระบบออกรหัสถัดไปให้'), { timeout: 5000 });
  const re = calls.find((c) => c.method === 'POST' && c.path.endsWith('/900000002/reissue-ref'));
  ok('กดยืนยัน = POST /:id/reissue-ref แบบให้ระบบออกให้', !!re && (re.body ?? '{}') === '{}', re?.body);
  ok('  แล้วโหลดรายการใหม่', calls.some((c) => c.path.startsWith('/api/admin/webquote/products/list')));

  // ออกรหัสใหม่แบบกำหนดเอง — ปุ่มยืนยันกดไม่ได้จนรหัสครบ 14 ตัว
  calls.length = 0;
  await page.click('[aria-label="ออกรหัสใหม่ BH-02 100x320-230-130W"]');
  await page.waitForFunction(() => document.body.innerText.includes('FHTP2XBH020248'), { timeout: 5000 });
  const radios = await page.$$('input[name="reissue"]');
  await radios[1].click();
  await page.type('input[aria-label="รหัสสินค้าใหม่"]', 'fhtp2xbh02');
  const confirmDisabled = () => page.evaluate(() =>
    ([...document.querySelectorAll('button')].filter((x) => x.textContent?.trim() === 'ออกรหัสใหม่').at(-1) as HTMLButtonElement).disabled);
  ok('กำหนดเอง: ยังไม่ครบ 14 ตัว ⇒ ปุ่มยืนยันกดไม่ได้', await confirmDisabled());
  await page.type('input[aria-label="รหัสสินค้าใหม่"]', '9999');
  ok('  ครบ 14 ตัว ⇒ กดได้', !(await confirmDisabled()));
  await page.evaluate(() => (([...document.querySelectorAll('button')].filter((x) => x.textContent?.trim() === 'ออกรหัสใหม่').at(-1)) as HTMLButtonElement).click());
  await page.waitForFunction(() => !document.body.innerText.includes('ให้ระบบออกรหัสถัดไปให้'), { timeout: 5000 });
  const reManual = calls.find((c) => c.method === 'POST' && c.path.endsWith('/reissue-ref'));
  ok('  ส่งรหัสตัวพิมพ์ใหญ่ + ref_manual', reManual?.body === JSON.stringify({ ref_manual: true, internal_reference: 'FHTP2XBH029999' }), reManual?.body);

  // ลบ
  calls.length = 0;
  await page.click('[aria-label="ลบ BH-02 100x320-230-130W"]');
  await page.waitForFunction(() => document.body.innerText.includes('ลบสินค้าที่เพิ่มเอง'), { timeout: 5000 });
  await page.evaluate(() => (([...document.querySelectorAll('button')].filter((x) => x.textContent?.trim() === 'ลบ').at(-1)) as HTMLButtonElement).click());
  await page.waitForFunction(() => !document.body.innerText.includes('ลบสินค้าที่เพิ่มเอง'), { timeout: 5000 });
  ok('ลบ = DELETE /:id', calls.some((c) => c.method === 'DELETE' && c.path === '/api/admin/webquote/products/900000002'));

  // ตัวกรอง — ทุกกลุ่มเห็นเฉพาะแถวของกลุ่มตัวเอง ป้ายสถานะ = ชื่อกลุ่ม
  const tableRows = () => page.$$eval('table tbody tr', (trs) => trs.map((tr) => ({
    text: (tr as HTMLElement).innerText,
    disabled: [...tr.querySelectorAll('button')].every((b) => (b as HTMLButtonElement).disabled),
  })));
  const GROUP_TEXT: Record<string, string> = { exported: 'รอนำเข้า', conflict: 'รหัสซ้ำ/ไม่ตรง', matched: 'นำเข้าแล้ว' };
  for (const g of ['exported', 'conflict', 'matched']) {
    calls.length = 0;
    const want = inGroup(g).map((r) => r.internal_reference);
    await page.select('select[aria-label="สถานะ"]', g);
    await page.waitForFunction((refs: string[]) => {
      const t = [...document.querySelectorAll('table tbody tr')].map((x) => (x as HTMLElement).innerText).join('\n');
      return refs.every((r) => t.includes(r)) && document.querySelectorAll('table tbody tr').length === refs.length;
    }, { timeout: 5000 }, want);
    const got = await tableRows();
    ok(`กลุ่ม "${GROUP_TEXT[g]}" ยิง filter=${g} และเห็น ${want.length} แถวของกลุ่มนี้ ป้ายตรงชื่อกลุ่ม`,
      calls.some((c) => c.path.includes(`filter=${g}`)) && got.every((r) => r.text.includes(GROUP_TEXT[g])));
    if (g === 'exported') {
      const t = got.map((r) => r.text).join('\n');
      ok('  ป้ายรหัส "กำหนดเอง" + "เคยเปลี่ยนรหัส" ของแถวที่คนพิมพ์รหัสเอง', t.includes('กำหนดเอง') && t.includes('เคยเปลี่ยนรหัส'));
      ok('  บรรทัดสองเป็นวันที่ส่งออก', (t.match(/ส่งออกเมื่อ/g) ?? []).length === want.length);
    }
    if (g === 'conflict') {
      const t = got.map((r) => r.text).join('\n');
      ok('  บรรทัดสองบอกรหัสที่ Odoo ใช้', /Odoo ใช้\s*FHTP2XCH021960/.test(t));
      ok('  แถบแดงซ่อนเมื่อเปิดกลุ่มนี้อยู่แล้ว', !(await page.evaluate(() => document.body.innerText.includes('ดูรายการ'))));
    }
    if (g === 'matched') ok('  แถวนำเข้าแล้ว: ปุ่มกดไม่ได้', got.every((r) => r.disabled));
  }

  // แถบแดงกดแล้วเปิดกลุ่ม "รหัสซ้ำ/ไม่ตรง"
  await page.select('select[aria-label="สถานะ"]', 'pending');
  await page.waitForFunction(() => document.body.innerText.includes('ดูรายการ'), { timeout: 5000 });
  calls.length = 0;
  await page.evaluate(() => ([...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('ดูรายการ')) as HTMLButtonElement).click());
  await page.waitForFunction(() => document.body.innerText.includes('FHTP2XCH021954'), { timeout: 5000 });
  ok('กดแถบแดง ⇒ เปิดกลุ่ม "รหัสซ้ำ/ไม่ตรง"', calls.some((c) => c.path.includes('filter=conflict'))
    && (await page.$eval('select[aria-label="สถานะ"]', (s) => (s as HTMLSelectElement).value)) === 'conflict');
  await page.close();

  // ═══════════════ J6 · หน้าต่างเพิ่มสินค้า (หน้า "สินค้าเพิ่มเอง") ═══════════════
  console.log('\n── J6 · หน้าต่างเพิ่ม/แก้สินค้า ─────────────────────────');
  const j6 = await openPage(1280);
  const txt = () => j6.evaluate(() => document.body.innerText);
  const saveBtn = (label: string) => j6.evaluateHandle((l: string) =>
    [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === l).at(-1), label);
  const saveDisabled = async (label: string) => j6.evaluate((b) => (b as HTMLButtonElement | undefined)?.disabled ?? true, await saveBtn(label));
  const setModel = async (m: string) => {
    await j6.$eval('#lp-model', (e) => { (e as HTMLInputElement).select(); });
    await j6.keyboard.press('Backspace');
    await j6.type('#lp-model', m);
  };
  const setField = async (sel: string, v: string) => {
    await j6.$eval(sel, (e) => { (e as HTMLInputElement).select(); });
    await j6.keyboard.press('Backspace');
    if (v) await j6.type(sel, v);
  };

  await j6.click('button[aria-label="เพิ่มสินค้าใหม่"]');
  await j6.waitForSelector('#lp-model');
  calls.length = 0;
  await setModel('TSK-04(S2)6x75+3M-S123');
  await j6.waitForFunction(() => document.body.innerText.includes('FCUP2TSK040178'), { timeout: 5000 });
  let t = await txt();
  ok('พิมพ์ model ⇒ ยิง /suggest แล้วเติมต้นแบบ (ชื่อ + รหัส + เหตุผล) · รหัส · ชื่อให้',
    calls.some((c) => c.path.startsWith('/api/admin/webquote/products/suggest?model=TSK-04'))
      && t.includes('FCUP2TSK040094') && t.includes('เลือกให้จาก 33 สินค้าที่ขึ้นต้น TSK-04(S2)')
      && (await j6.$eval('#lp-name', (e) => (e as HTMLInputElement).value)) === 'Thermocouple K Type "Primus" TSK-04(S2)6x75+3M-S123');
  ok('  รหัสมีป้าย "อัตโนมัติ" · ไม่มีคำเตือน (ระบบมั่นใจ)', t.includes('อัตโนมัติ') && !t.includes('ระบบไม่แน่ใจรหัสนี้'));
  ok('  ยังไม่กรอกราคา ⇒ ปุ่มเพิ่มกดไม่ได้', await saveDisabled('เพิ่มสินค้า'));
  await j6.evaluate(() => ([...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'คิดราคา') as HTMLButtonElement).click());
  await j6.waitForFunction(() => document.body.innerText.includes('ราคาจากสมุดราคา'), { timeout: 5000 });
  const priceCall = calls.find((c) => c.path === '/api/admin/webquote/products/price');
  t = await txt();
  ok('ปุ่มคิดราคา = POST /price ด้วย model · โชว์ราคา + ที่มาเป็นบรรทัด', priceCall?.body === JSON.stringify({ code: 'TSK-04(S2)6x75+3M-S123' })
    && t.includes('฿775.00') && t.includes('ราคาตั้ง TSK-04') && t.includes('สายส่วนที่ยาวเกิน 1 เมตร'));
  await j6.evaluate(() => ([...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'ใช้ราคานี้') as HTMLButtonElement).click());
  const minOf = () => j6.$eval('#lp-min', (e) => (e as HTMLInputElement).value);
  ok('"ใช้ราคานี้" ⇒ ราคาขาย 775 · ป้าย "จากสมุดราคา" · ขั้นต่ำ 70% = 542.50',
    (await j6.$eval('#lp-price', (e) => (e as HTMLInputElement).value)) === '775' && (await txt()).includes('จากสมุดราคา')
      && (await minOf()) === '542.50', await minOf());
  await setField('input[aria-label^="ราคาขั้นต่ำ เป็นเปอร์เซ็นต์"]', '65');
  ok('เปลี่ยน % ⇒ ราคาขั้นต่ำตาม (65% = 503.75)', (await minOf()) === '503.75', await minOf());
  await setField('#lp-min', '500');
  ok('  พิมพ์บาทเอง ⇒ % ตาม (500 / 775 = 64.5%)',
    (await j6.$eval('input[aria-label^="ราคาขั้นต่ำ เป็นเปอร์เซ็นต์"]', (e) => (e as HTMLInputElement).value)) === '64.5');
  await j6.screenshot({ path: `${SHOTS}op-j6-add.png` });
  calls.length = 0;
  await j6.evaluate((b) => (b as HTMLButtonElement).click(), await saveBtn('เพิ่มสินค้า'));
  await j6.waitForFunction(() => !document.querySelector('#lp-model'), { timeout: 5000 });
  // TS มองไม่เห็นว่า route() เขียนตัวแปรนี้ระหว่างรอ ⇒ ต้องอ่านผ่านตัวแปรใหม่ที่ประกาศชนิดเอง
  const created = lastCreated as Record<string, unknown> | null;
  ok('บันทึก = POST / พร้อมรหัส · ต้นแบบ · ราคา · ขั้นต่ำ · ราคาจากสมุดให้ server ตัดสินที่มา',
    created?.model === 'TSK-04(S2)6x75+3M-S123' && created?.internal_reference === 'FCUP2TSK040178'
      && created?.parent_reference === 'FCUP2TSK040094' && created?.sales_price === 775
      && created?.minimum_sales_price === 500 && created?.pricebook_price === 775 && created?.price_book_revision === 17
      && !('price_source' in (created ?? {})), JSON.stringify(lastCreated));
  ok('  แล้วปิดหน้าต่าง + โหลดรายการใหม่', calls.some((c) => c.path.startsWith('/api/admin/webquote/products/list')));

  // ค่าตั้งต้น 70% ต้องขึ้นแม้ server ไม่ส่ง min_price_ratio — ห้ามขึ้น NaN (เจ้าของเจอ 2026-10-02)
  await j6.click('button[aria-label="เพิ่มสินค้าใหม่"]');
  await j6.waitForSelector('#lp-model');
  await setModel('OLD-SERVER-1');
  await j6.waitForFunction(() => document.body.innerText.includes('FCUP2TSK040178'), { timeout: 5000 });
  await j6.type('#lp-price', '1000');
  const pctOld = await j6.$eval('input[aria-label^="ราคาขั้นต่ำ เป็นเปอร์เซ็นต์"]', (e) => (e as HTMLInputElement).value);
  ok('server ไม่ส่ง % ตั้งต้น ⇒ ช่อง % ยังขึ้น 70 (ไม่ใช่ NaN) · ขั้นต่ำ 700.00',
    pctOld === '70' && (await minOf()) === '700.00', `% = ${pctOld} · ขั้นต่ำ = ${await minOf()}`);
  await j6.evaluate(() => ([...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'ยกเลิก').at(-1) as HTMLButtonElement).click());

  // ระบบไม่แน่ใจรหัส — ต้องติ๊กก่อนบันทึก
  await j6.click('button[aria-label="เพิ่มสินค้าใหม่"]');
  await j6.waitForSelector('#lp-model');
  await setModel('BH-01 100x50');
  await j6.waitForFunction(() => document.body.innerText.includes('ระบบไม่แน่ใจรหัสนี้'), { timeout: 5000 });
  await j6.type('#lp-price', '850');
  ok('ระบบไม่แน่ใจรหัส ⇒ กล่องเหลือง + ปุ่มเพิ่มกดไม่ได้จนติ๊ก "ตรวจรหัสแล้ว"', await saveDisabled('เพิ่มสินค้า'));
  await j6.screenshot({ path: `${SHOTS}op-j6-unsure.png` });
  await j6.evaluate(() => ([...document.querySelectorAll('label')].find((l) => l.textContent?.includes('ตรวจรหัสแล้ว'))!.querySelector('input') as HTMLInputElement).click());
  ok('  ติ๊กแล้วกดได้', !(await saveDisabled('เพิ่มสินค้า')));
  ok('  ราคาที่พิมพ์เอง = ป้าย "กำหนดเอง"', (await txt()).includes('กำหนดเอง'));

  // ออกรหัสให้ไม่ได้ — ช่องพิมพ์รหัสเปิดเอง
  await setModel('TGM-66011.R2');
  await j6.waitForFunction(() => document.body.innerText.includes('ตระกูลนี้ออกเลขต่อให้ไม่ได้'), { timeout: 5000 });
  ok('ออกรหัสให้ไม่ได้ ⇒ ช่องพิมพ์รหัสเปิดเอง · ยังไม่ครบ 14 ตัวกดไม่ได้',
    !!(await j6.$('input[aria-label="รหัสสินค้า (พิมพ์เอง)"]')) && await saveDisabled('เพิ่มสินค้า'));
  await j6.type('input[aria-label="รหัสสินค้า (พิมพ์เอง)"]', 'ftgp1tgm66011s');
  ok('  ครบ 14 ตัวกดได้', !(await saveDisabled('เพิ่มสินค้า')));

  // หาต้นแบบไม่ได้ — ค้นเอง แล้วได้รหัสจากต้นแบบที่เลือก
  await setModel('XYZ-99 test');
  await j6.waitForFunction(() => document.body.innerText.includes('ระบบหาสินค้าที่ใกล้เคียงไม่เจอ'), { timeout: 5000 });
  await j6.type('input[aria-label="ค้นต้นแบบ"]', 'TGM-66');
  await j6.waitForFunction(() => document.body.innerText.includes('FTGP1TGM066099'), { timeout: 5000 });
  calls.length = 0;
  await j6.evaluate(() => ([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('FTGP1TGM066099')) as HTMLButtonElement).click());
  await j6.waitForFunction(() => document.body.innerText.includes('FTGP1TGM066194'), { timeout: 5000 });
  ok('หาต้นแบบไม่ได้ ⇒ ค้นเอง → เลือก → /suggest ส่ง parent และได้รหัสของตระกูลนั้น',
    calls.some((c) => c.path.includes('parent=FTGP1TGM066099')) && (await txt()).includes('คุณเลือกเอง'));

  // model ซ้ำ — ไม่มีปุ่มบันทึก (หน้ารายการไม่มี "ใช้สินค้านี้ในใบ")
  await setModel('TSK-04(S2)6x75+1MF-S000');
  await j6.waitForFunction(() => document.body.innerText.includes('model นี้มีอยู่แล้ว'), { timeout: 5000 });
  t = await txt();
  ok('model ซ้ำ ⇒ กล่องแดงบอกรหัสเดิม · ไม่มีปุ่มบันทึก · หน้ารายการไม่มี "ใช้สินค้านี้ในใบ"',
    t.includes('FCUP2TSK040094') && !(await j6.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'เพิ่มสินค้า')))
      && !t.includes('ใช้สินค้านี้ในใบ'));
  await j6.evaluate(() => ([...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'ยกเลิก').at(-1) as HTMLButtonElement).click());

  // แก้ไข
  calls.length = 0;
  await j6.click('[aria-label="แก้ไข BH-02 100x320-230-130W"]');
  await j6.waitForFunction(() => (document.querySelector('#lp-model') as HTMLInputElement | null)?.value === 'BH-02 100x320-230-130W', { timeout: 5000 });
  t = await txt();
  ok('แก้ไข ⇒ GET /:id · รหัสอ่านอย่างเดียว · ต้นแบบโชว์ชื่อ · ราคาขั้นต่ำ = ค่าที่เก็บไว้ (70%)',
    calls.some((c) => c.method === 'GET' && c.path === '/api/admin/webquote/products/900000002')
      && t.includes('เปลี่ยนรหัสใช้ปุ่ม') && t.includes(P_TSK.name) && (await minOf()) === '735.00'
      && (await j6.$eval('input[aria-label^="ราคาขั้นต่ำ เป็นเปอร์เซ็นต์"]', (e) => (e as HTMLInputElement).value)) === '70');
  await setField('#lp-price', '1100');
  calls.length = 0;
  await j6.evaluate((b) => (b as HTMLButtonElement).click(), await saveBtn('บันทึก'));
  await j6.waitForFunction(() => !document.querySelector('#lp-model'), { timeout: 5000 });
  const put = calls.find((c) => c.method === 'PUT');
  const putBody = JSON.parse(put?.body ?? '{}');
  ok('  บันทึก = PUT /:id ไม่ส่งรหัส · ขั้นต่ำคิดใหม่จาก % เดิม (1100 × 70% = 770)',
    put?.path === '/api/admin/webquote/products/900000002' && !('internal_reference' in putBody)
      && putBody.sales_price === 1100 && putBody.minimum_sales_price === 770 && !('pricebook_price' in putBody), put?.body);
  await j6.close();

  // ═══════════════ J6 · ทางเข้าจากหน้าขอใบเสนอราคา ═══════════════
  const qp = await browser.newPage();
  await qp.setViewport({ width: 1280, height: 1000 });
  await qp.setRequestInterception(true);
  qp.on('request', (r) => { void route(r); });
  await qp.evaluateOnNewDocument('globalThis.__name = (f) => f;');
  await qp.evaluateOnNewDocument((tk: string) => {
    sessionStorage.setItem('admin_token', tk);
    sessionStorage.setItem('admin_user', JSON.stringify({ id: 1, username: 'probe', name: 'Probe', role: 'admin' }));
  }, FAKE_TOKEN);
  await qp.goto(`${ORIGIN}/admin.html#quoterequest`, { waitUntil: 'networkidle0' });
  const bar = await qp.waitForSelector('input[placeholder^="เพิ่มสินค้า — พิมพ์รุ่น"]', { timeout: 15000 }).catch(() => null);
  if (!bar) {
    ok('หน้าขอใบเสนอราคาเปิดได้ (ช่องเพิ่มสินค้า)', false);
  } else {
    await bar.type('TSK-04(S2)6x75+3M-S123');
    await qp.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('เพิ่มสินค้าใหม่')), { timeout: 5000 });
    const act = await qp.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('เพิ่มสินค้าใหม่'))?.textContent);
    ok('ช่องค้นในใบ: ผลค้นว่างแล้วมีแถว "+ เพิ่มสินค้าใหม่ “คำที่พิมพ์”"', !!act && act.includes('“TSK-04(S2)6x75+3M-S123”'), String(act));
    // บั๊กจริง 2026-10-02: ตอนชี้ พื้นแถบกลายเป็น --brand-soft (โปร่ง 90%) ⇒ รายการข้างใต้โผล่ทะลุ
    // รอผลค้นนิ่งก่อน — ระหว่างค้นแถบถูกถอดออก (`!loading`) แล้วสร้างใหม่ ป้ายที่ติดไว้จะหายไปกับมัน
    // ("ไม่พบ…" ขึ้นตั้งแต่ก่อนการค้นแบบหน่วงจะยิง ใช้รอไม่ได้ ⇒ รอเน็ตเงียบแทน)
    await new Promise((r) => setTimeout(r, 600));
    await qp.waitForNetworkIdle({ idleTime: 400, timeout: 5000 });
    await qp.evaluate(() => ([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('เพิ่มสินค้าใหม่')) as HTMLElement).setAttribute('data-probe-add', '1'));
    if (!(await qp.evaluate(() => matchMedia('(hover: hover)').matches))) ok('  จำลอง (hover: hover) ได้ — ไม่งั้นข้อถัดไปผ่านแบบไม่ได้ตรวจ', false);
    // ห้าม qp.hover() — มันเลื่อนหน้าก่อน แล้วป๊อปอัปที่ position: fixed ปิดตัวเองเมื่อหน้าเลื่อน
    const box = await qp.$eval('[data-probe-add]', (b) => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await qp.mouse.move(box.x, box.y);
    await new Promise((r) => setTimeout(r, 300));
    const stickyBg = await qp.$eval('[data-probe-add]', (b) => {
      let el: HTMLElement | null = b as HTMLElement;
      while (el && getComputedStyle(el).position !== 'sticky') el = el.parentElement;
      return el ? getComputedStyle(el).backgroundColor : 'ไม่มีตัว sticky';
    });
    const alpha = /rgba?\(([^)]+)\)/.exec(stickyBg)?.[1].split(/[,\s/]+/).filter(Boolean)[3];
    ok('  ชี้เมาส์ที่แถบ ⇒ พื้นของตัว sticky ยังทึบ (รายการข้างใต้ไม่ทะลุ)', /^rgb|^oklch|^color/.test(stickyBg) && (alpha === undefined || Number(alpha) === 1), stickyBg);
    await qp.screenshot({ path: `${SHOTS}op-j6-quote-entry.png` });
    await qp.evaluate(() => ([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('เพิ่มสินค้าใหม่')) as HTMLButtonElement).click());
    await qp.waitForFunction(() => document.body.innerText.includes('FCUP2TSK040178'), { timeout: 5000 });
    ok('  กด ⇒ หน้าต่างเปิดพร้อม model = คำที่พิมพ์', (await qp.$eval('#lp-model', (e) => (e as HTMLInputElement).value)) === 'TSK-04(S2)6x75+3M-S123');
    await qp.type('#lp-price', '800');
    await qp.evaluate(() => ([...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'เพิ่มและใส่ลงใบ').at(-1) as HTMLButtonElement).click());
    await qp.waitForFunction(() => !document.querySelector('#lp-model'), { timeout: 5000 });
    await qp.waitForFunction(() => document.body.innerText.includes('เพิ่มเอง'), { timeout: 5000 }).catch(() => null);
    const rowText = await qp.evaluate(() => [...document.querySelectorAll('tr')].map((r) => (r as HTMLElement).innerText).find((x) => x.includes('TSK-04(S2)6x75+3M-S123')) ?? '');
    ok('  "เพิ่มและใส่ลงใบ" ⇒ แถวใหม่ในใบ + ป้าย "เพิ่มเอง"', rowText.includes('เพิ่มเอง'), rowText.replace(/\s+/g, ' ').slice(0, 120));
    await qp.screenshot({ path: `${SHOTS}op-j6-quote-row.png` });
  }
  await qp.close();

  // ═══════════════ 390px ═══════════════
  console.log('\n── 390px ──────────────────────────────────────────');
  const m = await openPage(390);
  const mob = await m.evaluate(() => {
    const table = document.querySelector('table');
    const cards = [...document.querySelectorAll('div.sm\\:hidden > div')] as HTMLElement[];
    return {
      tableVisible: !!table && (table as HTMLElement).offsetParent !== null,
      // จำนวนบรรทัด = จำนวนแนวของลูกในกริด (จุดกึ่งกลางแนวตั้งที่ต่างกัน — การ์ดจัด items-center) — ไม่เทียบ
      // ความสูงเป็นพิกเซล เพราะปุ่มจัดการชุดกลาง (table-ds 2026-10-02) สูงขึ้นแล้วเกณฑ์ 80px ล้มทั้งที่ยังสองบรรทัด
      cards: cards.map((c) => new Set([...c.children].map((k) => {
        const r = k.getBoundingClientRect();
        return Math.round((r.top + r.height / 2) / 8);
      })).size),
      // ลูกแต่ละตัวต้องเป็นบรรทัดเดียว (ข้อความยาวถูกตัด ไม่ขึ้นบรรทัดใหม่) — สูงไม่เกินปุ่มจัดการ
      tallest: Math.max(...cards.flatMap((c) => [...c.children].map((k) => k.getBoundingClientRect().height))),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  ok('ตารางถูกซ่อน เป็นการ์ดแทน', !mob.tableVisible && mob.cards.length === inGroup('pending').length, `${mob.cards.length} การ์ด`);
  ok('การ์ดสองบรรทัดทุกใบ', mob.cards.every((n) => n === 2) && mob.tallest <= 40,
    `บรรทัด ${mob.cards.join(',')} · ช่องสูงสุด ${Math.round(mob.tallest)}px`);
  ok('ไม่มีแถบเลื่อนแนวนอนทั้งหน้า', mob.overflow <= 0, `${mob.overflow}px`);
  await m.screenshot({ path: `${SHOTS}op-390.png`, fullPage: true });
  await m.click('button[aria-label="เพิ่มสินค้าใหม่"]');
  await m.waitForSelector('#lp-model');
  await m.type('#lp-model', 'TSK-04(S2)6x75+3M-S123');
  await m.waitForFunction(() => document.body.innerText.includes('FCUP2TSK040178'), { timeout: 5000 });
  const mo = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('หน้าต่างเพิ่มสินค้าที่ 390px ไม่ล้นแนวนอน', mo <= 0, `${mo}px`);
  await m.screenshot({ path: `${SHOTS}op-j6-390.png` });
  await m.close();
} finally {
  await browser.close();
}

console.log(`\nภาพอยู่ที่ ${SHOTS}op-*.png`);
console.log(fail === 0 ? '\nผ่านทุกข้อ' : `\nล้ม ${fail} ข้อ`);
process.exit(fail === 0 ? 0 : 1);
