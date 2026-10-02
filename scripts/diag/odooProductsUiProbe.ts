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
   ปุ่มกดไม่ได้เมื่อมีใบอ้าง · ออกรหัสใหม่ / ลบ ยิงเส้นที่ถูก · ไม่มีปุ่มเพิ่ม/แก้ (J6) ·
   390px เป็นการ์ดสองบรรทัดและไม่มีแถบเลื่อนแนวนอน

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
    const f = url.searchParams.get('filter') ?? 'not_matched';
    const items = ROWS.filter((r) =>
      f === 'all' ? true
        : f === 'matched' ? !!r.odoo_matched_at
          : f === 'pending' ? !r.odoo_matched_at && !r.exported_at
            : f === 'exported' ? !r.odoo_matched_at && !!r.exported_at
              : !r.odoo_matched_at);
    return json(req, { items, total: items.length, pending: PENDING });
  }
  if (path === `${P}/next-ref`) {
    return json(req, { parent_reference: url.searchParams.get('parent'), ref: { internal_reference: 'FHTP2XBH020248', tier: 'boundary' }, ref_message: null });
  }
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

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
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
  ok('ค่าตั้งต้นแสดงเฉพาะที่ยังไม่นำเข้า', rows.length === PENDING, `${rows.length} แถว`);
  ok('ทุกแถวไม่เกินสองบรรทัด', rows.every((r) => r.lines <= 2), rows.map((r) => r.lines).join(','));
  const tagText = rows.map((r) => r.text).join('\n');
  ok('ป้ายรหัส: "กำหนดเอง" เฉพาะแถวที่คนพิมพ์เอง', (tagText.match(/กำหนดเอง/g) ?? []).length === 1);
  ok('  ที่เหลือเป็น "อัตโนมัติ" ทุกแถว (รวมแบบนับต่อ — ไม่มีป้ายแยก)', (tagText.match(/อัตโนมัติ/g) ?? []).length === PENDING - 1);
  ok('  ไม่มีคำศัพท์ภายในหลุดขึ้นจอ', !/ขอบเลขวิ่ง|นับต่อ|max_plus_one|boundary|สั่งทำ/.test(tagText));
  ok('แถว model ซ้ำ: บรรทัดที่สองของสถานะบอกรหัสใน Odoo', /ซ้ำ\s*FHTP2XCH021960/.test(tagText));
  ok('แถวที่ Odoo เคยไม่รับรหัส มีป้าย "เคยเปลี่ยนรหัส"', tagText.includes('เคยเปลี่ยนรหัส'));
  ok('แถวที่มีใบอ้าง: ออกรหัสใหม่/ลบ กดไม่ได้', rows[0].disabled.every(Boolean), JSON.stringify(rows[0].disabled));
  ok('แถวที่ไม่มีใบอ้าง: กดได้', rows[1].disabled.every((d) => !d), JSON.stringify(rows[1].disabled));
  ok('ไม่มีปุ่มแก้ไข/เพิ่มสินค้า (มากับ J6)',
    !(await page.$('[aria-label^="แก้ไข "]')) && !(await page.evaluate(() => document.body.innerText.includes('เพิ่มสินค้าใหม่'))));

  // แถบแจ้งเตือน
  const bars = await page.evaluate(() => {
    const pick = (needle: string) => {
      const p = [...document.querySelectorAll('p')].find((x) => (x.textContent ?? '').includes(needle));
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
  ok('ปุ่มส่งออกบอกชนิดไฟล์และจำนวน', exportBtn === `ส่งออก xlsx (${PENDING} รายการ)`, String(exportBtn));
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

  // ตัวกรอง
  calls.length = 0;
  await page.select('select[aria-label="สถานะ"]', 'all');
  await page.waitForFunction(() => document.body.innerText.includes('FHTP2XCH021953'), { timeout: 5000 });
  ok('ตัวกรอง "ทั้งหมด" ยิง filter=all และเห็นแถวที่นำเข้าแล้ว', calls.some((c) => c.path.includes('filter=all')));
  const importedRow = await page.$$eval('table tbody tr', (trs) => {
    const tr = trs.find((t) => (t as HTMLElement).innerText.includes('FHTP2XCH021953'))!;
    return { text: (tr as HTMLElement).innerText, disabled: [...tr.querySelectorAll('button')].every((b) => (b as HTMLButtonElement).disabled) };
  });
  ok('  แถวนำเข้าแล้ว: ป้าย "นำเข้าแล้ว" + ปุ่มกดไม่ได้', importedRow.text.includes('นำเข้าแล้ว') && importedRow.disabled);
  await page.close();

  // ═══════════════ 390px ═══════════════
  console.log('\n── 390px ──────────────────────────────────────────');
  const m = await openPage(390);
  const mob = await m.evaluate(() => {
    const table = document.querySelector('table');
    const cards = [...document.querySelectorAll('div.sm\\:hidden > div')] as HTMLElement[];
    return {
      tableVisible: !!table && (table as HTMLElement).offsetParent !== null,
      cards: cards.map((c) => c.getBoundingClientRect().height),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  ok('ตารางถูกซ่อน เป็นการ์ดแทน', !mob.tableVisible && mob.cards.length === PENDING, `${mob.cards.length} การ์ด`);
  // การ์ดสองบรรทัด = ~ 2 × 28px (ปุ่ม 28px คร่อมอยู่ทางขวา) + padding — เกิน 80px แปลว่ามีบรรทัดที่สาม
  ok('การ์ดสองบรรทัดทุกใบ', mob.cards.every((h) => h <= 80), mob.cards.map((h) => Math.round(h)).join(','));
  ok('ไม่มีแถบเลื่อนแนวนอนทั้งหน้า', mob.overflow <= 0, `${mob.overflow}px`);
  await m.screenshot({ path: `${SHOTS}op-390.png`, fullPage: true });
  await m.close();
} finally {
  await browser.close();
}

console.log(`\nภาพอยู่ที่ ${SHOTS}op-*.png`);
console.log(fail === 0 ? '\nผ่านทุกข้อ' : `\nล้ม ${fail} ข้อ`);
process.exit(fail === 0 ? 0 : 1);
