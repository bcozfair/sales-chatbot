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

   รัน: `npm run build --prefix frontend` ก่อน แล้ว `npm run diag:drawing-live-ui` (`DL_SHOT=<ไฟล์.png>` = ถ่ายภาพการ์ดตอนจบ + การ์ดแบบคู่ของแต่ละรุ่นในข้อ 14)
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type HTTPRequest, type Page } from 'puppeteer';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import { TS_CATALOG, buildTsCode, readTsForm, type TsFamily, type TsForm } from '../../services/pricingLab/catalogTs.js';
import { judge } from '../../services/drawing/checks.js';
import type { PricingReading } from '../../services/drawing/types.js';
import { checkStill, renderSheet } from '../../services/drawing/sheet.js';
import { A4_LANDSCAPE, sheetHtml } from '../../services/drawing/render/sheetHtml.js';
import { closePrintBrowser, printHtml } from '../../pdfGenerator.js';

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
/** ตระกูลจากรหัส — แทนตัวหาตระกูลของ parseProductCode (ด่านนี้ไม่โหลดสมุดราคา) · เฉพาะรหัสที่ด่านพิมพ์เอง */
const familyOf = (code: string): TsFamily => {
  const m = code.match(/-(11|01-0|01|02|03|05)\b/);
  return (m ? `TS_-${m[1]}` : 'TS_-11') as TsFamily;
};
/** รหัสจริงหนึ่งตัวต่อตระกูลที่เพิ่ม (2026-10-09) — ข้อ 14 */
const CABLE_CODES = ['TSK-01(M8)6x50+2MC', 'TSK-01-0(M6)+2MP', 'TSJ-02(12)4.8Ax10+3MFU', 'TSK-03 6x100+1MP', 'TSJ-05(12)4.8x20+2M'];
function readingOf(body: { code?: string; tsForm?: TsForm }): { code: string; parsed: PricingReading & { tsForm?: TsForm } } {
  const tsForm = body.tsForm ?? readTsForm(String(body.code ?? ''), familyOf(String(body.code ?? '')));
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
  if (path === '/api/admin/pricing/overview') return json(req, { book: { ok: true, models: 1 }, version: 'r1', models: [], edited: null, catalog: [], catalogTs: TS_CATALOG.filter((s) => s.family === 'TS_-11' || CABLE_CODES.some((c) => familyOf(c) === s.family)) });
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
  if (path === '/api/admin/drawing/sheet') {
    // ส่วนประกอบจริงของ /sheet (checkStill · renderSheet · sheetHtml · printHtml) — พิสูจน์ว่าภาพนิ่งที่การ์ดส่งมาผ่านตัวตรวจของเซิร์ฟเวอร์
    const body = JSON.parse(req.postData() ?? '{}');
    const r = readingOf(body);
    const v = judge(r.parsed, { status: 'priced' });
    const still = body.still == null ? null : checkStill(body.still);
    sheets.push({ format: body.format, still: typeof still === 'string' ? still : still ? 'ok' : 'none' });
    if (typeof still === 'string' || !v.spec) return req.respond({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: typeof still === 'string' ? still : 'no spec' }) });
    const svg = renderSheet({ spec: v.spec, code: r.code, still, logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', meta: { drawer: 'Probe', date: '09/10/2569' } });
    const kind = body.format === 'png' ? 'png' : 'pdf';
    const file = await printHtml(sheetHtml(svg), { kind, widthMm: A4_LANDSCAPE.w, heightMm: A4_LANDSCAPE.h, pngWidthPx: 1754 });
    return req.respond({ status: 200, contentType: kind === 'pdf' ? 'application/pdf' : 'image/png', headers: { 'Content-Disposition': `attachment; filename="x.${kind}"` }, body: Buffer.from(file) });
  }
  return json(req, {});
}
const sheets: { format: string; still: string }[] = [];

const TOKEN_PAYLOAD = Buffer.from(JSON.stringify({ id: 1, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const FAKE_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${TOKEN_PAYLOAD}.probe`;
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const stageState = (page: Page) => page.evaluate(() => {
  const s = document.querySelector<HTMLElement>('[data-testid="drawing-card"] .dv-stage');
  return s ? { box: (s.dataset.dvBox ?? '').split(',').map(Number), builds: Number(s.dataset.dvBuilds ?? 0), cam: (s.dataset.dvCam ?? '').split(',').map(Number), pan: Number(s.dataset.dvPan ?? 0), canvases: s.querySelectorAll('canvas').length } : null;
});
/** รอจนภาพนิ่ง (แรงเฉื่อยของกล้องหมด) — swiftshader วาดช้า เวลาที่รอตายตัวจึงอ่านกล้องตอนยังไหลอยู่ */
const settle = async (page: Page) => {
  let prev = '', same = 0;
  for (let i = 0; i < 80 && same < 3; i++) {
    await later(150);
    const s = await stageState(page); const cur = s ? `${s.cam.join()}|${s.pan}` : '';
    same = cur === prev ? same + 1 : 0; prev = cur;
  }
  return (await stageState(page))!;
};
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
  const camBefore = (await settle(page)).cam;
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
  const probeRow = await page.evaluate(() => {
    const dl = document.querySelector('[data-testid="drawing-spec"] dl');
    const dts = [...(dl?.querySelectorAll('dt') ?? [])];
    const i = dts.findIndex((d) => d.textContent === 'แกนวัด');
    return { rows: dts.length, probe: i < 0 ? '' : dl!.querySelectorAll('dd')[i].textContent ?? '', note: document.querySelector('[data-testid="drawing-note"]')?.textContent ?? '' };
  });
  ok('   ตารางรายละเอียดตามช่องทันที (แกนวัด ยาว 300)', probeRow.rows >= 8 && /ยาว 300 mm/.test(probeRow.probe), `${probeRow.rows} แถว · แกนวัด "${probeRow.probe}"`);
  ok('   หมายเหตุของแบบ (เห็นเฉพาะในระบบ)', /หมายเหตุของแบบ.*เห็นเฉพาะในระบบ.*สปริงกันสายหัก/.test(probeRow.note));
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

  console.log('\n── ซูมแล้วเลื่อนดู (เจ้าของ 2026-10-09) ──────────');
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="drawing-card"] button')].find((b) => b.getAttribute('aria-label') === 'กลับมุมเริ่มต้น')?.click());
  await settle(page);
  const cv = await page.$eval('[data-testid="drawing-card"] .dv-stage canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const p0 = (await stageState(page))!.pan;
  // ล้อเมาส์ที่มุมซ้ายบนของภาพ — ซูมเข้าหาจุดใต้เมาส์ จุดหมุนต้องขยับออกจากกลาง
  await page.mouse.move(cv.x + cv.w * 0.25, cv.y + cv.h * 0.3);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel({ deltaY: -200 }); await later(60); }
  const p1 = (await settle(page)).pan;
  ok('7 · ซูมเข้าหาจุดใต้เมาส์ (ไม่ใช่กลางจอ)', p0 < 0.5 && p1 > 2, `จุดหมุนห่างกลาง ${p0} → ${p1} mm`);
  // คลิกขวาลาก = เลื่อน · ทิศกล้องต้องไม่เปลี่ยน (ไม่ใช่หมุน)
  const camZ = (await settle(page)).cam;
  await page.mouse.move(cv.x + cv.w * 0.5, cv.y + cv.h * 0.5);
  await page.mouse.down({ button: 'right' }); await page.mouse.move(cv.x + cv.w * 0.5 + 160, cv.y + cv.h * 0.5 + 60, { steps: 12 }); await page.mouse.up({ button: 'right' });
  const s4 = await settle(page);
  const dPanCam = Math.max(...s4.cam.map((x, i) => Math.abs(x - camZ[i])));
  ok('8 · คลิกขวาลาก = เลื่อนภาพ ไม่หมุน', Math.abs(s4.pan - p1) > 2 && dPanCam <= 0.01, `จุดหมุน ${p1} → ${s4.pan} mm · ทิศกล้องคลาด ${dPanCam.toFixed(4)}`);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="drawing-card"] button')].find((b) => /^(แยกชิ้น|ประกอบกลับ)$/.test(b.getAttribute('aria-label') ?? ''))?.click());
  await later(800);
  const s5 = await settle(page);
  ok('9 · แยกชิ้น/ประกอบแล้วภาพไม่ดีดกลับกลางจอ', s5.pan > 2, `จุดหมุนห่างกลาง ${s5.pan} mm`);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="drawing-card"] button')].find((b) => b.getAttribute('aria-label') === 'กลับมุมเริ่มต้น')?.click());
  const s6 = await settle(page);
  ok('   ปุ่มกลับมุมเริ่มต้นล้างการเลื่อน', s6.pan < 0.5, `${s6.pan} mm`);

  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="drawing-card"] button')].find((b) => b.getAttribute('aria-label') === 'คัดลอกรหัส')?.click());
  await later(200);
  const copied = await page.evaluate(() => [...document.querySelectorAll('[data-testid="drawing-card"] button')].some((b) => b.getAttribute('aria-label') === 'คัดลอกแล้ว'));
  ok('10 · ปุ่มคัดลอกรหัส', copied);
  // สลับ 3 มิติ / 2 มิติ / คู่ (ตั้งต้น 3 มิติ — เจ้าของเคาะ mockup รอบ 5 ข้อ 1)
  const tab = (label: string) => page.evaluate((l: string) => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="drawing-card"] [role="tab"]')].find((b) => b.textContent === l)?.click(), label);
  const viewState = () => page.evaluate(() => {
    const card = document.querySelector('[data-testid="drawing-card"]')!;
    const sel = card.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? '';
    const svg = card.querySelector('[data-testid="drawing-2d"] svg');
    return { sel, canvases: card.querySelectorAll('canvas').length, svgText: svg?.textContent ?? '', vb: svg?.getAttribute('viewBox') ?? '' };
  });
  const v0 = await viewState();
  ok('12 · ภาพตั้งต้น = 3 มิติ', v0.sel === '3 มิติ' && v0.canvases === 1 && !v0.svgText);
  await tab('2 มิติ'); await later(400);
  const v1 = await viewState();
  ok('   2 มิติ: ภาพฉายตามช่องที่แก้ (L1 300) · ไม่มีภาพ 3 มิติค้าง · ตัดกรอบตามเนื้อภาพ', v1.canvases === 0 && /L1 300 mm\./.test(v1.svgText) && v1.vb !== '' && v1.vb !== '0 0 980 640', `canvas ${v1.canvases} · viewBox ${v1.vb}`);
  await tab('คู่');
  await page.waitForFunction(() => Number(document.querySelector<HTMLElement>('[data-testid="drawing-card"] .dv-stage')?.dataset.dvBuilds ?? 0) >= 1, { timeout: 10000 });
  const v2 = await viewState();
  ok('   คู่: 3 มิติบน + 2 มิติล่าง', v2.canvases === 1 && /L1 300 mm\./.test(v2.svgText));
  await tab('3 มิติ'); await later(300);
  const v3 = await viewState();
  ok('   กลับ 3 มิติ: ตัวดูตัวเดียว', v3.canvases === 1 && !v3.svgText, `canvas ${v3.canvases}`);
  // กระดาษแบบ SVG — กดปุ่มจริง แล้วอ่านไฟล์ที่ดาวน์โหลด
  const dlDir = mkdtempSync(join(tmpdir(), 'dl-sheet-'));
  try {
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
    await tab('คู่');
    await page.waitForFunction(() => Number(document.querySelector<HTMLElement>('[data-testid="drawing-card"] .dv-stage')?.dataset.dvBuilds ?? 0) >= 1, { timeout: 10000 });
    await later(600);
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="drawing-card"] button')].find((b) => b.textContent?.trim() === 'SVG')?.click());
    let file = '';
    for (let i = 0; i < 50 && !file; i++) { await later(100); file = readdirSync(dlDir).find((f) => f.endsWith('.svg')) ?? ''; }
    const svg = file ? readFileSync(join(dlDir, file), 'utf8') : '';
    const has = (re: RegExp) => re.test(svg);
    ok('13 · ปุ่ม SVG ได้กระดาษแบบ A4 (980 × 693)', has(/viewBox="0 0 980 693"/), file || 'ไม่มีไฟล์');
    ok('   ภาพ 3 มิติ (ภาพนิ่ง PNG + ป้าย) + ภาพฉาย 2 มิติตามช่องที่แก้', has(/<image href="data:image\/png;base64,[A-Za-z0-9+/]{2000}/) && has(/class="stlb"/) && has(/L1 300 mm\./) && has(/data-view="ortho"/));
    ok('   title block + ตาราง + บรรทัด "ไม่ใช่แบบผลิต" · โลโก้ฝังในไฟล์', has(/เลขที่แบบ/) && has(/ผู้เขียนแบบ/) && has(/รายละเอียดสินค้า/) && has(/ไม่ใช่แบบผลิต/) && (svg.match(/data:image\/png;base64,/g) ?? []).length === 2);
    ok('   ไม่มีหมายเหตุของแบบ (เห็นเฉพาะในระบบ) · ไม่มีราคา', !has(/หมายเหตุของแบบ|สปริงลวด/) && !has(/บาท|฿/));
    ok('   สัญลักษณ์เส้นผ่านศูนย์กลางเป็น Ø (ฟอนต์ที่ฝัง/ในกล่อง prod ไม่มี ∅)', !has(/&#8709;|\u2205/) && has(/&#216;D1 6/));
    ok('   SVG เป็น XML ที่อ่านได้ (ไม่มี named entity)', !has(/&(?!#\d+;|amp;|lt;|gt;|quot;)[a-z]+;/));
    for (const fmt of ['PDF', 'PNG'] as const) {
      // PDF เปิดในแท็บใหม่แบบพรีวิวใบเสนอราคา (ไม่ดาวน์โหลด) ⇒ แทน window.open ด้วยแท็บจำลองที่จำ URL ไว้ แล้วอ่าน blob จากหน้าเดิม
      if (fmt === 'PDF') await page.evaluate(() => {
        const w = window as unknown as { __pdfTab: { href: string; opened: number; closed: boolean } };
        w.__pdfTab = { href: '', opened: 0, closed: false };
        window.open = ((u?: string | URL) => {
          w.__pdfTab.opened++;
          if (u) { w.__pdfTab.href = String(u); return null; }
          return { location: { set href(v: string) { w.__pdfTab.href = v; } }, close() { w.__pdfTab.closed = true; } } as unknown as Window;
        }) as typeof window.open;
      });
      await page.evaluate((l: string) => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="drawing-card"] button')].find((b) => b.textContent?.trim() === l)?.click(), fmt);
      let f = '';
      let bytes = Buffer.alloc(0);
      if (fmt === 'PDF') {
        for (let i = 0; i < 100 && !f; i++) { await later(100); f = await page.evaluate(() => (window as unknown as { __pdfTab: { href: string } }).__pdfTab.href); }
        const tabInfo = await page.evaluate(() => (window as unknown as { __pdfTab: { opened: number; closed: boolean } }).__pdfTab);
        const b64 = f.startsWith('blob:') ? await page.evaluate(async (u: string) => {
          const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s);
        }, f) : '';
        bytes = Buffer.from(b64, 'base64');
        const downloaded = readdirSync(dlDir).some((x) => x.endsWith('.pdf'));
        ok('   ปุ่ม PDF: เปิดแท็บใหม่ตอนกด 1 แท็บ แล้วพาไปที่ไฟล์ PDF (ไม่ดาวน์โหลด)', tabInfo.opened === 1 && !tabInfo.closed && f.startsWith('blob:') && !downloaded, `เปิด ${tabInfo.opened} · ${f || 'ไม่มี URL'}`);
      } else {
        for (let i = 0; i < 100 && !f; i++) { await later(100); f = readdirSync(dlDir).find((x) => x.endsWith(`.${fmt.toLowerCase()}`)) ?? ''; }
        bytes = f ? readFileSync(join(dlDir, f)) : Buffer.alloc(0);
      }
      const sig = fmt === 'PDF' ? bytes.subarray(0, 5).toString() === '%PDF-' : bytes.subarray(1, 4).toString() === 'PNG';
      const sent = sheets.find((x) => x.format === fmt.toLowerCase());
      ok(`   ปุ่ม ${fmt}: ภาพนิ่งที่การ์ดส่งผ่านตัวตรวจของเซิร์ฟเวอร์ · ได้ไฟล์`, sig && sent?.still === 'ok', `${f || 'ไม่มีไฟล์'} · ${(bytes.length / 1024).toFixed(0)} KB · ภาพนิ่ง ${sent?.still ?? '-'}`);
      if (process.env.DL_SHOT && fmt === 'PNG' && bytes.length) (await import('node:fs')).writeFileSync(process.env.DL_SHOT.replace(/\.png$/, '-print.png'), bytes);
    }
    if (process.env.DL_SHOT && svg) {
      const pg = await browser.newPage();
      await pg.setViewport({ width: 1470, height: 1040 });
      await pg.setContent(`<body style="margin:0;background:#888">${svg.replace('<svg ', '<svg width="1470" height="1040" ')}</body>`);
      await later(500);
      await pg.screenshot({ path: process.env.DL_SHOT.replace(/\.png$/, '-sheet.png') });
      await pg.close();
    }
  } finally {
    rmSync(dlDir, { recursive: true, force: true });
  }
  await tab('3 มิติ'); await later(300);

  if (process.env.DL_SHOT) { const card = await page.$('[data-testid="drawing-card"]'); await card?.screenshot({ path: process.env.DL_SHOT }); await tab('คู่'); await later(1500); await card?.screenshot({ path: process.env.DL_SHOT.replace(/\.png$/, '-pair.png') }); await tab('3 มิติ'); await later(300); }

  // ข้อ 14 — รุ่นที่เพิ่ม 2026-10-09 (TS_-01 · 01-0 · 02 · 03 · 05): รหัสจริงบนหน้าจริงได้ภาพ 3 มิติ + ภาพฉาย 2 มิติของรุ่นนั้น
  for (const code of CABLE_CODES) {
    const before = (await stageState(page))?.builds ?? 0;
    // ล้างช่องด้วย Ctrl+A (คลิกสามครั้งพลาดได้หลังถ่ายภาพการ์ดที่เลื่อนหน้าจอ — รหัสถูกพิมพ์ต่อท้ายของเดิม)
    await page.focus('#pl-code');
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.type('#pl-code', code);
    await page.keyboard.press('Enter');
    await page.waitForFunction((n: number) => Number(document.querySelector<HTMLElement>('[data-testid="drawing-card"] .dv-stage')?.dataset.dvBuilds ?? 0) > n, { timeout: 15000, polling: 100 }, before);
    const st = await settle(page);
    await tab('2 มิติ'); await later(400);
    const svg = await page.evaluate(() => document.querySelector('[data-testid="drawing-card"] svg[aria-label="ภาพฉาย 2 มิติ"]')?.textContent ?? '');
    if (process.env.DL_SHOT) {   // ภาพการ์ดแบบคู่ของแต่ละรุ่น → <DL_SHOT>-TS_-02.png
      await tab('คู่'); await later(1500);
      await (await page.$('[data-testid="drawing-card"]'))?.screenshot({ path: process.env.DL_SHOT.replace(/\.png$/, `-${familyOf(code)}.png`) });
    }
    await tab('3 มิติ'); await later(300);
    ok(`14 · ${familyOf(code)} «${code}»: ภาพ 3 มิติ + ภาพฉาย 2 มิติ`, st.canvases === 1 && svg.includes(code) && /CL1/.test(svg), `กล่อง ${st.box.map((x) => Math.round(x)).join(' × ')} mm`);
  }

  ok('11 · ไม่มี error ในหน้า', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  fail++;
  console.log('  ✗ ด่านล้มกลางทาง:', e instanceof Error ? e.message : e);
  const pg = (await browser.pages()).at(-1);
  if (pg) console.log('    การ์ด:', (await pg.evaluate(() => document.querySelector('[data-testid="drawing-card"]')?.textContent ?? document.body.innerText.slice(0, 600))).replace(/\s+/g, ' '));
  if (pageErrors.length) console.log('    error ในหน้า:', pageErrors.join(' | '));
} finally {
  await browser.close();
  await closePrintBrowser();
}
console.log(fail ? `\nไม่ผ่าน ${fail} ข้อ` : '\nผ่านทุกข้อ');
process.exit(fail ? 1 : 0);
