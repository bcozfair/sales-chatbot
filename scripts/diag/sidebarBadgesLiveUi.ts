/* ─────────────────────────────────────────────────────────────────────────────
   ตัวเลขข้างเมนู sidebar ต้องตามข้อมูลใหม่เอง — ไม่ต้องเปลี่ยนหน้าหรือรีเฟรช

   ที่มา: เจ้าของแจ้ง 2026-10-02 "ตัวเลขแจ้งเตือนที่ sidebar มันไม่ interact แบบเรียลไทม์ตามข้อมูลใหม่
   ต้องเปลี่ยนหน้าหรือรีเฟรชถึงจะขึ้น" — เดิมสามป้าย (อนุมัติราคา · ผู้ติดต่อเพิ่มเอง · สินค้าเพิ่มเอง)
   นับใหม่เฉพาะตอนเปลี่ยนแท็บ · ตัวแก้อยู่ที่ `frontend/src/admin/badgeRefresh.ts` + effect เดียวใน AdminApp.tsx

   **ไม่แตะฐานเลย และไม่ต้องเปิดเซิร์ฟเวอร์** (ท่าเดียวกับ `diag:op-ui`): puppeteer เสิร์ฟ `public/` ที่ build แล้วเอง
   และตอบทุก `/api/*` ด้วยค่าที่ด่านเปลี่ยนเองระหว่างทาง ⇒ รันบน PMSV ได้ · ด่านไม่ได้พิสูจน์ว่าตัวนับฝั่ง server ถูก
   (นั่นคืองานของ `diag:price-approval` · `diag:local-contacts` · `diag:local-products`)

   สิ่งที่พิสูจน์ (ทุกข้อ "ไม่เปลี่ยน hash ไม่กดเมนู"):
   a. ตัวเลขตั้งต้นขึ้นครบสามเมนู + ป้ายยังเป็นวงกลมมีขอบ (รูปร่างเป็นของ docs/design.md ไม่ใช่ของงานนี้)
   b. แท็บกลับมาเห็น (visibilitychange) ⇒ นับใหม่ · c. หน้าต่างได้โฟกัส ⇒ นับใหม่
   d. หน้าใดหน้าหนึ่งบอกว่าเพิ่งเขียน (event ใน badgeRefresh.ts) ⇒ นับใหม่ — ชื่อ event อ่านจากซอร์สจริง
   e. ตัวจับเวลา 60 วิ: ถึงรอบตอนเห็นหน้า ⇒ นับใหม่ · ถึงรอบตอนแท็บซ่อน ⇒ **ไม่ยิงเลย** (ทุกครั้งคือแถวใน api_logs)
   f. ทางจริงหนึ่งทาง: ลบสินค้าเพิ่มเองจากหน้า "สินค้าเพิ่มเอง" ⇒ ตัวเลขลดเองทันที
   g. นับได้ 0 ⇒ ป้ายหาย · กลับมา > 0 ⇒ ป้ายกลับมา
   h. หลายสัญญาณพร้อมกัน (โฟกัส + เห็นหน้า + event) ⇒ นับรอบเดียว ไม่ใช่สามรอบขนานกัน
   + ไม่มี error หลุดจากหน้าเว็บ

   รัน: `npm run build --prefix frontend` ก่อน แล้ว `npm run diag:badges-live-ui`
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type HTTPRequest, type Page } from 'puppeteer';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const BADGE_SRC = fileURLToPath(new URL('../../frontend/src/admin/badgeRefresh.ts', import.meta.url));
const ORIGIN = 'http://badges-probe.local';
const POLL_MS = 60_000;

let fail = 0;
const pageErrors: string[] = [];
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

// ── ชื่อ event — อ่านจากซอร์สจริง ไม่พิมพ์ซ้ำ (เปลี่ยนชื่อที่นั่นแล้วด่านตามเอง) ─────────────
const src = existsSync(BADGE_SRC) ? readFileSync(BADGE_SRC, 'utf8') : '';
const EVENT_NAME = /BADGES_CHANGED_EVENT\s*=\s*'([^']+)'/.exec(src)?.[1] ?? null;
const POLL_IN_SRC = /BADGE_POLL_MS\s*=\s*60_000\b/.test(src);

// ── ค่าที่ตัวนับตอบ — ด่านเปลี่ยนเองระหว่างทาง ────────────────────────────────────────────
const counts = { approvals: { pending: 2, rejected: 1 }, contacts: 4, products: 5 };
const COUNT_PATHS = {
  approvals: '/api/admin/approvals/count',
  contacts: '/api/admin/webquote/contacts/count',
  products: '/api/admin/webquote/products/count',
} as const;
const countCalls: string[] = [];
const callsOf = (k: keyof typeof COUNT_PATHS) => countCalls.filter((p) => p === COUNT_PATHS[k]).length;

// ── แถวของหน้า "สินค้าเพิ่มเอง" — รูปเดียวกับ `listProducts()` (ลอกจาก diag:op-ui) ─────────
const base = {
  parent_reference: null, rejected_refs: [] as string[], sales_description: null, brand: null, series: null,
  product_group: null, product_category: null, product_sub_category: null, unit_of_measure: 'Pcs',
  price_book_revision: null, pricebook_price: null, created_by: 1, updated_at: '2026-10-02T03:00:00Z',
  odoo_matched_template_id: null, ref_parts: null, exported_at: null, odoo_matched_at: null,
  status: 'not_imported', odoo_model_conflicts: [] as unknown[],
};
let ROWS = [
  { ...base, product_template_id: 900000001, internal_reference: 'FCUP2XCH020457', ref_tier: 'boundary',
    model: 'CH-02 6.5x240-42-450W-1-S000', name: 'Cartridge Heater "PM" CH-02 6.5x240-42-450W-1-S000',
    sales_price: 1420, minimum_sales_price: 994, price_source: 'manual', created_at: '2026-10-02T03:00:00Z',
    created_by_name: 'สมชาย', quotation_count: 2 },
  { ...base, product_template_id: 900000002, internal_reference: 'FHTP2XBH020247', ref_tier: 'max_plus_one',
    model: 'BH-02 100x320-230-130W', name: 'Strip Heater "PM" BH-02 100x320-230-130W',
    sales_price: 1050, minimum_sales_price: 735, price_source: 'pricebook', created_at: '2026-10-02T02:00:00Z',
    created_by_name: 'วิภา', quotation_count: 0 },
];

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
  if (path === '/api/admin/me/capabilities') return json(req, { capabilities: {} });  // ไม่ deny อะไร = เห็นทุกเมนู
  if (path === COUNT_PATHS.approvals) { countCalls.push(path); return json(req, counts.approvals); }
  if (path === COUNT_PATHS.contacts) { countCalls.push(path); return json(req, { pending: counts.contacts }); }
  if (path === COUNT_PATHS.products) { countCalls.push(path); return json(req, { pending: counts.products }); }
  if (path === '/api/admin/webquote/products/list') {
    return json(req, { items: ROWS, total: ROWS.length, pending: ROWS.length, conflicts: 0 });
  }
  const del = /^\/api\/admin\/webquote\/products\/(\d+)$/.exec(path);
  if (del && req.method() === 'DELETE') {
    ROWS = ROWS.filter((r) => r.product_template_id !== Number(del[1]));
    counts.products -= 1;   // server ลบจริงแล้วตัวนับลดตาม
    return json(req, { ok: true });
  }
  return json(req, {});
}

const TOKEN_PAYLOAD = Buffer.from(JSON.stringify({ id: 1, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const FAKE_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${TOKEN_PAYLOAD}.probe`;

/**
 * จับตัวจับเวลาที่แอปตั้งไว้ 60 วิ — ด่านรอ 60 วิจริงไม่ได้ จึงเก็บ callback ไว้แล้วเรียกเอง
 * เก็บเฉพาะตัวที่ยังไม่ถูก clearInterval (effect ที่ถูกล้างแล้วต้องไม่ถูกปลุกขึ้นมาอีก)
 */
const CAPTURE_INTERVALS = `(() => {
  const active = new Map();
  const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
  window.setInterval = (fn, ms, ...rest) => { const id = si(fn, ms, ...rest); if (ms === ${POLL_MS}) active.set(id, fn); return id; };
  window.clearInterval = (id) => { active.delete(id); return ci(id); };
  window.__pollTicks = () => [...active.values()];
  // ข้อ f ต้องพิสูจน์ "หน้าบอกเอง" ไม่ใช่ "คลิกทำให้หน้าต่างได้โฟกัส" — headless วันนี้ไม่ยิง focus ตอนคลิก
  // (วัด 2026-10-02: ถอด notify ออกแล้วข้อ f ล้มทั้งมีและไม่มีตัวดักนี้) แต่ถ้า Chrome รุ่นหน้ายิง ข้อ f
  // จะผ่านทั้งที่ถอด notify ออก ⇒ ดักไว้ก่อนแอปจะได้ยิน
  window.__muteFocus = false;
  const mute = (e) => { if (window.__muteFocus) e.stopImmediatePropagation(); };
  window.addEventListener('focus', mute, true);
  document.addEventListener('visibilitychange', mute, true);
})();`;

type Badges = { approvals: number | null; contacts: number | null; products: number | null };
/** ตัวเลขบนป้ายของสามเมนูใน sidebar ที่มองเห็นอยู่ · null = ไม่มีป้าย */
const readBadges = (pg: Page): Promise<Badges> => pg.evaluate(() => {
  const read = (label: string) => {
    const btn = [...document.querySelectorAll('aside button')]
      .find((b) => (b as HTMLElement).offsetParent !== null
        && [...b.querySelectorAll('span')].some((s) => s.textContent?.trim() === label));
    const span = btn ? [...btn.querySelectorAll('span')].find((s) => /^\d+$/.test((s.textContent ?? '').trim())) : null;
    return span ? Number(span.textContent) : null;
  };
  return { approvals: read('อนุมัติราคา'), contacts: read('ผู้ติดต่อเพิ่มเอง'), products: read('สินค้าเพิ่มเอง') };
});
const nz = (n: number) => (n > 0 ? n : null);
const expected = (): Badges => ({
  approvals: nz(counts.approvals.pending + counts.approvals.rejected), contacts: nz(counts.contacts), products: nz(counts.products),
});
/** รอจนป้ายตรงกับค่าที่ตัวนับตอบตอนนี้ — คืน true/false ไม่ throw (ล้ม = ข้อนั้นล้ม ไม่ใช่ด่านพัง) */
async function badgesCatchUp(pg: Page, timeout = 3000): Promise<boolean> {
  try {
    await pg.waitForFunction((want: Badges) => {
      const read = (label: string) => {
        const btn = [...document.querySelectorAll('aside button')]
          .find((b) => (b as HTMLElement).offsetParent !== null
            && [...b.querySelectorAll('span')].some((s) => s.textContent?.trim() === label));
        const span = btn ? [...btn.querySelectorAll('span')].find((s) => /^\d+$/.test((s.textContent ?? '').trim())) : null;
        return span ? Number(span.textContent) : null;
      };
      return read('อนุมัติราคา') === want.approvals && read('ผู้ติดต่อเพิ่มเอง') === want.contacts
        && read('สินค้าเพิ่มเอง') === want.products;
    }, { timeout }, expected());
    return true;
  } catch {
    return false;
  }
}
const show = async (pg: Page) => `จอ ${JSON.stringify(await readBadges(pg))} · ควรเป็น ${JSON.stringify(expected())}`;
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
try {
  console.log(`\n── ตัวเลขข้างเมนู sidebar · 1280px ─────────────────────────`);
  ok('ซอร์ส badgeRefresh.ts มีชื่อ event + รอบ 60 วิ', !!EVENT_NAME && POLL_IN_SRC, String(EVENT_NAME));

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setRequestInterception(true);
  page.on('request', (r) => { void route(r); });
  page.on('pageerror', (e: unknown) => { pageErrors.push(e instanceof Error ? e.message : String(e)); });
  await page.evaluateOnNewDocument('globalThis.__name = (f) => f;');
  await page.evaluateOnNewDocument(CAPTURE_INTERVALS);
  await page.evaluateOnNewDocument((t: string) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', JSON.stringify({ id: 1, username: 'probe', name: 'Probe', role: 'admin' }));
  }, FAKE_TOKEN);
  await page.goto(`${ORIGIN}/admin.html#odooproducts`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.innerText.includes('FHTP2XBH020247'), { timeout: 15000 });
  const hash0 = await page.evaluate(() => location.hash);

  // a. ตั้งต้น
  ok('a. ตัวเลขตั้งต้นขึ้นครบสามเมนู', await badgesCatchUp(page, 5000), await show(page));
  const shape = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('aside button')]
      .find((b) => [...b.querySelectorAll('span')].some((s) => s.textContent?.trim() === 'สินค้าเพิ่มเอง'));
    const span = btn ? [...btn.querySelectorAll('span')].find((s) => /^\d+$/.test((s.textContent ?? '').trim())) : null;
    if (!span) return null;
    const cs = getComputedStyle(span);
    const r = span.getBoundingClientRect();
    return { radius: cs.borderRadius, border: cs.borderTopWidth, w: r.width, h: r.height };
  });
  ok('   ป้ายยังเป็นวงกลมมีขอบ (รูปร่างไม่ขยับ)',
    !!shape && parseFloat(shape.border) >= 1 && Math.abs(shape.w - shape.h) <= 1 && parseFloat(shape.radius) >= shape.h / 2 - 1,
    JSON.stringify(shape));

  // b. แท็บกลับมาเห็น
  counts.approvals = { pending: 3, rejected: 2 }; counts.contacts = 6; counts.products = 7;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  ok('b. แท็บกลับมาเห็น (visibilitychange) ⇒ สามป้ายนับใหม่เอง', await badgesCatchUp(page), await show(page));

  // c. หน้าต่างได้โฟกัส
  counts.approvals = { pending: 1, rejected: 0 }; counts.contacts = 2; counts.products = 8;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  ok('c. หน้าต่างได้โฟกัส ⇒ สามป้ายนับใหม่เอง', await badgesCatchUp(page), await show(page));

  // d. หน้าบอกว่าเพิ่งเขียน
  counts.approvals = { pending: 4, rejected: 1 }; counts.contacts = 9; counts.products = 3;
  await page.evaluate((name: string) => window.dispatchEvent(new CustomEvent(name)), EVENT_NAME ?? 'primus:badges-changed');
  ok(`d. event "${EVENT_NAME}" ⇒ สามป้ายนับใหม่เอง`, !!EVENT_NAME && await badgesCatchUp(page), await show(page));

  // e. ตัวจับเวลา
  const tickCount = () => page.evaluate(() => (window as unknown as { __pollTicks: () => unknown[] }).__pollTicks().length);
  const fireTicks = () => page.evaluate(() => {
    for (const f of (window as unknown as { __pollTicks: () => (() => void)[] }).__pollTicks()) f();
  });
  const ticks = await tickCount();
  ok(`e. มีตัวจับเวลา ${POLL_MS / 1000} วิ ที่ยังทำงานอยู่ (ไม่ใช่ของ effect ที่ถูกล้างแล้ว)`, ticks === 1, `${ticks} ตัว`);
  counts.approvals = { pending: 0, rejected: 5 }; counts.contacts = 1; counts.products = 2;
  await fireTicks();
  ok('   ถึงรอบตอนเห็นหน้า ⇒ สามป้ายนับใหม่เอง', ticks > 0 && await badgesCatchUp(page), await show(page));
  await settle(400);
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
  const before = countCalls.length;
  await fireTicks();
  await settle(800);
  ok('   ถึงรอบตอนแท็บซ่อน ⇒ ไม่ยิง /count เลย', ticks > 0 && countCalls.length === before, `ยิงเพิ่ม ${countCalls.length - before} ครั้ง`);
  await page.evaluate(() => { delete (document as unknown as { visibilityState?: string }).visibilityState; });

  // h. หลายสัญญาณพร้อมกัน ⇒ รอบเดียว
  await settle(400);
  const n0 = { a: callsOf('approvals'), c: callsOf('contacts'), p: callsOf('products') };
  counts.contacts = 5;
  await page.evaluate((name: string) => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new CustomEvent(name));
  }, EVENT_NAME ?? 'primus:badges-changed');
  const burstOk = await badgesCatchUp(page);
  await settle(800);
  const nd = { a: callsOf('approvals') - n0.a, c: callsOf('contacts') - n0.c, p: callsOf('products') - n0.p };
  ok('h. สามสัญญาณพร้อมกัน ⇒ นับรอบเดียว (แต่ละเส้นยิงครั้งเดียว)', burstOk && nd.a === 1 && nd.c === 1 && nd.p === 1,
    JSON.stringify(nd));

  // f. ทางจริง: ลบสินค้าเพิ่มเองจากหน้า "สินค้าเพิ่มเอง"
  const productsBefore = counts.products;
  await page.evaluate(() => { (window as unknown as { __muteFocus: boolean }).__muteFocus = true; });
  await page.click('[aria-label="ลบ BH-02 100x320-230-130W"]');
  await page.waitForFunction(() => document.body.innerText.includes('ลบสินค้าที่เพิ่มเอง'), { timeout: 5000 });
  await page.evaluate(() => (([...document.querySelectorAll('button')].filter((x) => x.textContent?.trim() === 'ลบ').at(-1)) as HTMLButtonElement).click());
  await page.waitForFunction(() => !document.body.innerText.includes('ลบสินค้าที่เพิ่มเอง'), { timeout: 5000 });
  ok('f. ลบสินค้าเพิ่มเองในหน้า ⇒ ตัวเลข "สินค้าเพิ่มเอง" ลดเองทันที',
    counts.products === productsBefore - 1 && await badgesCatchUp(page), await show(page));
  await page.evaluate(() => { (window as unknown as { __muteFocus: boolean }).__muteFocus = false; });

  // g. ศูนย์ ⇒ ป้ายหาย · กลับมา ⇒ ป้ายกลับมา
  counts.contacts = 0;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  ok('g. นับได้ 0 ⇒ ป้าย "ผู้ติดต่อเพิ่มเอง" หาย', await badgesCatchUp(page), await show(page));
  counts.contacts = 3;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  ok('   กลับมามากกว่า 0 ⇒ ป้ายกลับมา', await badgesCatchUp(page), await show(page));

  const hash1 = await page.evaluate(() => location.hash);
  ok('ทุกข้อไม่เปลี่ยนหน้า (hash เดิม)', hash1 === hash0, `${hash0} → ${hash1}`);
  ok('ไม่มี error หลุดจากหน้าเว็บ (pageerror)', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log(fail === 0 ? '\nผ่านทุกข้อ' : `\nล้ม ${fail} ข้อ`);
process.exit(fail === 0 ? 0 : 1);
