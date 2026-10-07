/* ─────────────────────────────────────────────────────────────────────────────
   ภาพ 3 มิติยืดหดตามทันที — เปิดหน้า "คำนวณราคา" จริง แก้ช่องจริง แล้ววัดว่าภาพเปลี่ยนก่อนเซิร์ฟเวอร์ตอบ และมุมกล้องไม่เด้ง
   (หัวหน้าสั่ง 2026-10-07 "ยืดหดได้แบบ interactive เมื่อเปลี่ยนขนาดหรือส่วนประกอบ" · เจ้าของเลือก "แก้ช่องแล้วภาพตามทันที")

   **ไม่แตะฐานเลย และไม่ต้องเปิดเซิร์ฟเวอร์** (ท่าเดียวกับ `diag:pricing-add-ui`): puppeteer เสิร์ฟ `public/` ที่ build แล้ว
   และตอบ `/api/*` เอง — แต่ **ผลอ่านช่อง/รหัสกับคำตัดสินใช้โค้ดจริง** (`readTsForm` · `buildTsCode` · `judge`) ไม่ใช่ค่าที่พิมพ์ไว้
   ⇒ spec ที่การ์ดได้จากเซิร์ฟเวอร์จำลองเป็นตัวเดียวกับของจริง · ทั้งสองเส้น (คิดราคา + แบบ) **หน่วงไว้ 900 ms** เพื่อแยกให้ออกว่า
   ภาพที่เปลี่ยนมาจากการ์ดสร้างเอง ไม่ใช่รอคำตอบ

   สิ่งที่พิสูจน์:
   1. รหัสแรกได้ภาพ (ตัวดูสร้างครั้งเดียว) · คำขอแบบไม่ส่ง GLB (`spec` ไม่กี่ร้อยไบต์)
   2. แก้ "ความยาวแกน" 100 → 300 → ภาพยาวขึ้น 200 mm **ก่อน** เซิร์ฟเวอร์ตอบ (< 900 ms หลังพิมพ์จบ)
   3. หมุนกล้องไว้ก่อนแก้ → หลังแก้ทิศกล้องเท่าเดิม (คลาดไม่เกิน 0.01) · ไม่สร้างตัวดูใหม่ (canvas ตัวเดิม)
   4. แยกชิ้นค้างไว้ได้ระหว่างแก้ (ปุ่มยังเป็น "ประกอบ")
   5. คำตอบเซิร์ฟเวอร์มาถึงแล้วภาพไม่กระตุก (ขนาดเท่าเดิม) · เปลี่ยนชนิดหัว (ส่วนประกอบ) ภาพก็ตาม
   6. ไม่มี error ในหน้า

   รัน: `npm run build --prefix frontend` ก่อน แล้ว `npm run diag:drawing-live-ui`
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type HTTPRequest, type Page } from 'puppeteer';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import { TS_CATALOG, buildTsCode, readTsForm, type TsForm } from '../../services/pricingLab/catalogTs.js';
import { judge } from '../../services/drawing/checks.js';
import type { PricingReading } from '../../services/drawing/types.js';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const ORIGIN = 'http://dl-probe.local';
const DELAY = 900;
const CODE = 'TSK-11 6x100+2M';

let fail = 0;
const pageErrors: string[] = [];
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

// ── API จำลอง: อ่านด้วยโค้ดจริง ─────────────────────────────────────────────
function readingOf(body: { code?: string; tsForm?: TsForm }): { code: string; parsed: PricingReading & { tsForm?: TsForm } } {
  const tsForm = body.tsForm ?? readTsForm(String(body.code ?? ''), 'TS_-11');
  const code = body.tsForm ? buildTsCode(body.tsForm) : String(body.code ?? '').trim();
  return { code, parsed: { tsForm, cfg: { options: [] } } };
}
const previews: number[] = [];
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const json = (req: HTTPRequest, body: unknown) => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function route(req: HTTPRequest) {
  const url = new URL(req.url());
  if (url.origin !== ORIGIN) return req.respond({ status: 204, body: '' });
  const path = url.pathname;
  if (!path.startsWith('/api/')) {
    const file = normalize(join(PUBLIC, path === '/' ? 'admin.html' : path));
    if (!file.startsWith(PUBLIC) || !existsSync(file)) return req.respond({ status: 404, body: 'not found' });
    return req.respond({ status: 200, contentType: MIME[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  }
  if (process.env.DL_DEBUG) console.log('    api', req.method(), path, (req.postData() ?? '').slice(0, 160));
  if (path === '/api/admin/me/capabilities') return json(req, { capabilities: {} });
  if (path === '/api/admin/pricing/overview') return json(req, { book: { ok: true, models: 1 }, version: 'r1', models: [], edited: null, catalog: [], catalogTs: TS_CATALOG.filter((s) => s.family === 'TS_-11') });
  if (path === '/api/admin/pricing/quote') {
    const r = readingOf(JSON.parse(req.postData() ?? '{}'));
    await later(DELAY);
    return json(req, { code: r.code, parsed: { input: r.code, normalized: r.code, parts: [], problems: [], warnings: [], ...r.parsed }, revision: 1, outcome: { status: 'priced', model: 'TSK-11', unitPrice: 900, breakdown: [{ step: 'flat', label: 'ราคาตั้ง TSK-11', amount: 900 }], violations: [], bookVersion: 'r1' } });
  }
  if (path === '/api/admin/drawing/preview') {
    const r = readingOf(JSON.parse(req.postData() ?? '{}'));
    const v = judge(r.parsed, { status: 'priced' });
    const body = JSON.stringify({ code: r.code, verdict: { family: v.family, canDraw: v.canDraw, canSend: v.canSend, noDraw: v.noDraw, noSend: v.noSend, confirm: v.confirm }, ...(v.spec ? { spec: v.spec, cfg: { options: [] } } : {}) });
    previews.push(body.length);
    await later(DELAY);
    return req.respond({ status: 200, contentType: 'application/json', body });
  }
  return json(req, {});
}

const TOKEN_PAYLOAD = Buffer.from(JSON.stringify({ id: 1, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const FAKE_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${TOKEN_PAYLOAD}.probe`;
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const stageState = (page: Page) => page.evaluate(() => {
  const s = document.querySelector<HTMLElement>('[data-testid="drawing-card"] .dv-stage');
  return s ? { box: (s.dataset.dvBox ?? '').split(',').map(Number), builds: Number(s.dataset.dvBuilds ?? 0), cam: (s.dataset.dvCam ?? '').split(',').map(Number), canvases: s.querySelectorAll('canvas').length } : null;
});
const setL1 = async (page: Page, v: string) => {
  const sel = 'input[aria-label="ความยาวแกน"]';
  await page.click(sel, { count: 3 });
  await page.type(sel, v);
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1100 });
  await page.setRequestInterception(true);
  page.on('request', (r) => { void route(r); });
  page.on('pageerror', (e: unknown) => { pageErrors.push(e instanceof Error ? e.message : String(e)); });
  if (process.env.DL_DEBUG) page.on('console', (m) => console.log('    [console]', m.type(), m.text().slice(0, 300)));
  await page.evaluateOnNewDocument('globalThis.__name = (f) => f;');
  await page.evaluateOnNewDocument((t: string) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', JSON.stringify({ id: 1, username: 'probe', name: 'Probe', role: 'admin' }));
  }, FAKE_TOKEN);
  await page.goto(`${ORIGIN}/admin.html#pricing`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#pl-code', { timeout: 15000 });

  console.log('\n── รหัสแรก ─────────────────────────────────────');
  await page.click('#pl-code', { count: 3 });
  await page.type('#pl-code', CODE);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => Number(document.querySelector<HTMLElement>('[data-testid="drawing-card"] .dv-stage')?.dataset.dvBuilds ?? 0) >= 1, { timeout: 20000 });
  const s0 = (await stageState(page))!;
  ok('1 · ได้ภาพ — ตัวดูสร้างหนึ่งครั้ง', s0.builds === 1 && s0.canvases === 1, `กล่อง ${s0.box.join(' × ')} mm`);
  ok('   คำตอบของแบบเป็น spec ไม่ใช่ GLB (< 2 KB)', previews.length > 0 && Math.max(...previews) < 2048, `${previews.at(-1)} ไบต์`);

  // หมุนกล้องด้วยเมาส์จริง แล้วกดแยกชิ้น
  const box = await page.$eval('[data-testid="drawing-card"] .dv-stage canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + 140, box.y + 40, { steps: 12 }); await page.mouse.up();
  await later(900);
  const camBefore = (await stageState(page))!.cam;
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="drawing-card"] button')].find((b) => b.getAttribute('aria-label') === 'แยกชิ้น')?.click());
  await later(900);

  console.log('\n── แก้ความยาวแกน 100 → 300 ─────────────────────');
  const len0 = Math.max(...s0.box);
  await setL1(page, '300');
  const t0 = Date.now();
  await page.waitForFunction((n: number) => Number(document.querySelector<HTMLElement>('[data-testid="drawing-card"] .dv-stage')?.dataset.dvBuilds ?? 0) > n, { timeout: 5000, polling: 50 }, 1);
  const ms = Date.now() - t0;
  const s1 = (await stageState(page))!;
  ok('2 · ภาพยาวขึ้น 200 mm ก่อนเซิร์ฟเวอร์ตอบ', Math.abs(Math.max(...s1.box) - len0 - 200) < 1 && ms < DELAY, `${ms} ms หลังพิมพ์ (เซิร์ฟเวอร์หน่วง ${DELAY} ms) · ${len0} → ${Math.max(...s1.box)} mm`);
  const dCam = Math.max(...s1.cam.map((x, i) => Math.abs(x - camBefore[i])));
  ok('3 · ทิศกล้องเท่าเดิม', dCam <= 0.01, `คลาด ${dCam.toFixed(4)}`);
  ok('   ไม่สร้างตัวดูใหม่ (canvas ตัวเดิม)', s1.canvases === 1);
  const stillExploded = await page.evaluate(() => [...document.querySelectorAll('[data-testid="drawing-card"] button')].some((b) => b.getAttribute('aria-label') === 'ประกอบกลับ'));
  ok('4 · แยกชิ้นค้างอยู่ระหว่างแก้', stillExploded);

  console.log('\n── คำตอบเซิร์ฟเวอร์ตามมา ───────────────────────');
  await later(DELAY * 2 + 800);
  const s2 = (await stageState(page))!;
  ok('5 · ภาพไม่กระตุกเมื่อคำตอบมาถึง (ขนาดเท่าเดิม)', s2.box.join() === s1.box.join(), `สร้าง ${s2.builds} ครั้ง`);
  await page.select('select[aria-label="Spring"]', 'P');
  await page.waitForFunction((b: string) => (document.querySelector<HTMLElement>('[data-testid="drawing-card"] .dv-stage')?.dataset.dvBox ?? b) !== b, { timeout: 3000, polling: 50 }, s2.box.join());
  const s3 = (await stageState(page))!;
  ok('   เปลี่ยนส่วนประกอบ (ถอดสปริง) ภาพก็ตามทันที', s3.box.join() !== s2.box.join(), `${s2.box.join(' × ')} → ${s3.box.join(' × ')}`);

  ok('6 · ไม่มี error ในหน้า', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  fail++;
  console.log('  ✗ ด่านล้มกลางทาง:', e instanceof Error ? e.message : e);
  const pg = (await browser.pages()).at(-1);
  if (pg) console.log('    การ์ด:', await pg.evaluate(() => document.querySelector('[data-testid="drawing-card"]')?.textContent ?? document.body.innerText.slice(0, 600)));
  if (pageErrors.length) console.log('    error ในหน้า:', pageErrors.join(' | '));
} finally {
  await browser.close();
}
console.log(fail ? `\nไม่ผ่าน ${fail} ข้อ` : '\nผ่านทุกข้อ');
process.exit(fail ? 1 : 0);
