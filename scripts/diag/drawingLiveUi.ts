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
   12–13. จอ = กระดาษ (เจ้าของ 2026-10-09): แท็บ 3 มิติ/2 มิติ/คู่ แสดงกระดาษ A4 ใบที่จะพิมพ์ · ตัวดูวางทับกรอบภาพ 3 มิติพอดี
       · PDF/PNG/SVG ตามแท็บที่เปิด (คู่ = PDF 2 หน้า · PNG/SVG 2 ไฟล์ · 2 มิติ = ไม่ส่งภาพนิ่ง)

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
import { PIC_3D, SHEET_H, SHEET_W, checkStill, renderSheet } from '../../services/drawing/sheet.js';
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
    const view: string = body.view;
    sheets.push({ format: body.format, view, still: typeof still === 'string' ? still : still ? 'ok' : 'none' });
    // กติกาเดียวกับ routes/drawing.ts: ชนิดใบต้องรู้จัก · ใบ 3 มิติ/คู่ต้องมีภาพนิ่ง · คู่ = PDF เท่านั้น
    const bad = typeof still === 'string' ? still : !v.spec ? 'no spec' : !['3d', '2d', 'pair'].includes(view) ? 'view' : view !== '2d' && !still ? 'no still' : view === 'pair' && body.format !== 'pdf' ? 'pair png' : '';
    if (bad) return req.respond({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: bad }) });
    const base = { spec: v.spec!, code: r.code, still: still as Exclude<typeof still, string>, logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', meta: { drawer: 'Probe', date: '09/10/2569' } };
    const svgs = (view === 'pair' ? ['3d', '2d'] as const : [view as '3d' | '2d']).map((k) => renderSheet({ ...base, view: k }));
    const kind = body.format === 'png' ? 'png' : 'pdf';
    const file = await printHtml(sheetHtml(svgs), { kind, widthMm: A4_LANDSCAPE.w, heightMm: A4_LANDSCAPE.h, pngWidthPx: 1754, pages: svgs.length });
    return req.respond({ status: 200, contentType: kind === 'pdf' ? 'application/pdf' : 'image/png', headers: { 'Content-Disposition': `attachment; filename="x.${kind}"` }, body: Buffer.from(file) });
  }
  return json(req, {});
}
const sheets: { format: string; view: string; still: string }[] = [];

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
  // ตารางรายละเอียดอยู่ในกระดาษบนจอแล้ว (ไม่มีกล่องแยก) — ข้อความ "แกนวัด" ตามด้วยค่าของแถวนั้น
  const probeRow = await page.evaluate(() => {
    const ts = [...document.querySelectorAll('[data-testid="drawing-sheet-3d"] svg text')].map((t) => t.textContent ?? '');
    const i = ts.indexOf('แกนวัด');
    return { probe: i < 0 ? '' : ts[i + 1] ?? '', box: !!document.querySelector('[data-testid="drawing-spec"]'), note: document.querySelector('[data-testid="drawing-note"]')?.textContent ?? '' };
  });
  ok('   ตารางรายละเอียดในกระดาษตามช่องทันที (แกนวัด ยาว 300) · ไม่มีกล่องรายละเอียดแยก', /ยาว 300 mm/.test(probeRow.probe) && !probeRow.box, `แกนวัด "${probeRow.probe}"`);
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
    const papers = [...card.querySelectorAll<HTMLElement>('[data-testid^="drawing-sheet-"]')];
    const p3 = card.querySelector<HTMLElement>('[data-testid="drawing-sheet-3d"]'), stg = p3?.querySelector<HTMLElement>('.dv-stage');
    const r = (e?: Element | null) => { const b = e?.getBoundingClientRect(); return b ? [b.x, b.y, b.width, b.height] : null; };
    return { sel, canvases: card.querySelectorAll('canvas').length, order: papers.map((p) => p.dataset.testid!.slice(-2)),
      vb: papers.map((p) => p.querySelector('svg')?.getAttribute('viewBox') ?? ''),
      text2d: card.querySelector('[data-testid="drawing-sheet-2d"] svg')?.textContent ?? '', paper: r(p3), stage: r(stg) };
  });
  const v0 = await viewState();
  ok('12 · ภาพตั้งต้น = กระดาษ 3 มิติ ใบเดียว (A4 980 × 693) · ตัวดูอยู่ในกระดาษ', v0.sel === '3 มิติ' && v0.canvases === 1 && v0.order.join() === '3d' && v0.vb.join() === `0 0 ${SHEET_W} ${SHEET_H}`, `ใบ ${v0.order.join('+')}`);
  // ตัวดูต้องทับกรอบภาพ PIC_3D ของกระดาษพอดี (คลาดไม่เกิน 1.5 px) ⇒ ภาพบนจอ = ภาพในไฟล์
  const fit = (st: typeof v0) => {
    if (!st.paper || !st.stage) return Infinity;
    const [px, py, pw, ph] = st.paper, k = pw / SHEET_W;
    const want = [px + PIC_3D.x * k, py + PIC_3D.y * k, PIC_3D.w * k, PIC_3D.h * k];
    return Math.max(...want.map((x, i) => Math.abs(x - st.stage![i])), Math.abs(ph - SHEET_H * k));
  };
  ok('   ตัวดูทับกรอบภาพ 3 มิติของกระดาษพอดี', fit(v0) <= 1.5, `คลาด ${fit(v0).toFixed(2)} px`);
  await tab('2 มิติ'); await later(400);
  const v1 = await viewState();
  ok('   2 มิติ: กระดาษภาพฉายใบเดียวตามช่องที่แก้ (L1 300) · ไม่มีตัวดูค้าง', v1.canvases === 0 && v1.order.join() === '2d' && /L1 300 mm\./.test(v1.text2d), `canvas ${v1.canvases} · ใบ ${v1.order.join('+')}`);
  await tab('คู่');
  await page.waitForFunction(() => Number(document.querySelector<HTMLElement>('[data-testid="drawing-card"] .dv-stage')?.dataset.dvBuilds ?? 0) >= 1, { timeout: 10000 });
  await later(300);
  const v2 = await viewState();
  ok('   คู่: กระดาษ 3 มิติตามด้วย 2 มิติ · ตัวดูยังทับกรอบพอดี', v2.canvases === 1 && v2.order.join() === '3d,2d' && /L1 300 mm\./.test(v2.text2d) && fit(v2) <= 1.5, `ใบ ${v2.order.join('+')}`);
  await tab('3 มิติ'); await later(300);
  const v3 = await viewState();
  ok('   กลับ 3 มิติ: ตัวดูตัวเดียว ใบเดียว', v3.canvases === 1 && v3.order.join() === '3d', `canvas ${v3.canvases}`);
  // กระดาษแบบ SVG — กดปุ่มจริง แล้วอ่านไฟล์ที่ดาวน์โหลด
  const dlDir = mkdtempSync(join(tmpdir(), 'dl-sheet-'));
  try {
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
    await tab('คู่');
    await page.waitForFunction(() => Number(document.querySelector<HTMLElement>('[data-testid="drawing-card"] .dv-stage')?.dataset.dvBuilds ?? 0) >= 1, { timeout: 10000 });
    await later(600);
    const click = (l: string) => page.evaluate((x: string) => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="drawing-card"] button')].find((b) => b.textContent?.trim() === x)?.click(), l);
    const waitFiles = async (ext: string, n: number) => {
      let fs: string[] = [];
      for (let i = 0; i < 100 && fs.length < n; i++) { await later(100); fs = readdirSync(dlDir).filter((f) => f.endsWith(ext) && !f.endsWith('.crdownload')).sort(); }
      return fs;
    };
    // แท็บคู่ → SVG 2 ไฟล์ (ใบ 3 มิติ + ใบ 2 มิติ)
    await click('SVG');
    const svgFiles = await waitFiles('.svg', 2);
    const read = (suffix: string) => { const f = svgFiles.find((x) => x.endsWith(`-${suffix}.svg`)); return f ? readFileSync(join(dlDir, f), 'utf8') : ''; };
    const svg3 = read('3D'), svg2 = read('2D'), svg = svg3;
    const has = (t: string, re: RegExp) => re.test(t);
    const pngs = (t: string) => (t.match(/data:image\/png;base64,/g) ?? []).length;
    ok('13 · แท็บคู่ → ปุ่ม SVG ได้ 2 ไฟล์ (…-3D.svg · …-2D.svg) กระดาษ A4 980 × 693', svgFiles.length === 2 && !!svg3 && !!svg2 && [svg3, svg2].every((t) => has(t, /viewBox="0 0 980 693"/)), svgFiles.join(' · ') || 'ไม่มีไฟล์');
    ok('   ใบ 3 มิติ: ภาพนิ่ง PNG + ป้าย เต็มกรอบ · ไม่มีภาพฉาย', has(svg3, /<image href="data:image\/png;base64,[A-Za-z0-9+/]{2000}/) && has(svg3, /class="stlb"/) && !has(svg3, /data-view="ortho"/) && has(svg3, new RegExp(`<svg x="${PIC_3D.x}" y="${PIC_3D.y}" width="${PIC_3D.w}" height="${PIC_3D.h}"`)) && has(svg3, /ภาพ 3 มิติ<\/text>/));
    ok('   ใบ 2 มิติ: ภาพฉายตามช่องที่แก้ · ไม่มีภาพนิ่ง (มีแค่โลโก้)', has(svg2, /data-view="ortho"/) && has(svg2, /L1 300 mm\./) && pngs(svg2) === 1 && has(svg2, /ภาพฉาย 2 มิติ<\/text>/));
    for (const t of [svg3, svg2]) {
      ok('   title block + ตาราง + บรรทัด "ไม่ใช่แบบผลิต" · โลโก้ฝังในไฟล์', has(t, /เลขที่แบบ/) && has(t, /ผู้เขียนแบบ/) && has(t, /รายละเอียดสินค้า/) && has(t, /ไม่ใช่แบบผลิต/) && pngs(t) === (t === svg3 ? 2 : 1));
      ok('   ไม่มีหมายเหตุของแบบ (เห็นเฉพาะในระบบ) · ไม่มีราคา', !has(t, /หมายเหตุของแบบ|สปริงลวด/) && !has(t, /บาท|฿/));
      ok('   SVG เป็น XML ที่อ่านได้ (ไม่มี named entity)', !has(t, /&(?!#\d+;|amp;|lt;|gt;|quot;)[a-z]+;/));
    }
    ok('   สัญลักษณ์เส้นผ่านศูนย์กลางเป็น Ø (ฟอนต์ที่ฝัง/ในกล่อง prod ไม่มี ∅)', !has(svg2 + svg3, /&#8709;|\u2205/) && has(svg2 + svg3, /&#216;D1 6/));

    // PDF เปิดในแท็บใหม่แบบพรีวิวใบเสนอราคา (ไม่ดาวน์โหลด) ⇒ แทน window.open ด้วยแท็บจำลองที่จำ URL ไว้ แล้วอ่าน blob จากหน้าเดิม
    const pdfOf = async () => {
      await page.evaluate(() => {
        const w = window as unknown as { __pdfTab: { href: string; opened: number; closed: boolean } };
        w.__pdfTab = { href: '', opened: 0, closed: false };
        window.open = ((u?: string | URL) => {
          w.__pdfTab.opened++;
          if (u) { w.__pdfTab.href = String(u); return null; }
          return { location: { set href(v: string) { w.__pdfTab.href = v; } }, close() { w.__pdfTab.closed = true; } } as unknown as Window;
        }) as typeof window.open;
      });
      const n0 = sheets.length;
      await click('PDF');
      let f = '';
      for (let i = 0; i < 100 && !f; i++) { await later(100); f = await page.evaluate(() => (window as unknown as { __pdfTab: { href: string } }).__pdfTab.href); }
      const tabInfo = await page.evaluate(() => (window as unknown as { __pdfTab: { opened: number; closed: boolean } }).__pdfTab);
      const b64 = f.startsWith('blob:') ? await page.evaluate(async (u: string) => {
        const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s);
      }, f) : '';
      const bytes = Buffer.from(b64, 'base64');
      return { f, tabInfo, bytes, pages: (bytes.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length, sent: sheets.slice(n0) };
    };
    const pair = await pdfOf();
    ok('   ปุ่ม PDF: เปิดแท็บใหม่ตอนกด 1 แท็บ แล้วพาไปที่ไฟล์ PDF (ไม่ดาวน์โหลด)', pair.tabInfo.opened === 1 && !pair.tabInfo.closed && pair.f.startsWith('blob:') && !readdirSync(dlDir).some((x) => x.endsWith('.pdf')), `เปิด ${pair.tabInfo.opened} · ${pair.f || 'ไม่มี URL'}`);
    ok('   แท็บคู่ → PDF ไฟล์เดียว 2 หน้า · ส่งภาพนิ่งผ่านตัวตรวจของเซิร์ฟเวอร์', pair.bytes.subarray(0, 5).toString() === '%PDF-' && pair.pages === 2 && pair.sent.length === 1 && pair.sent[0].view === 'pair' && pair.sent[0].still === 'ok', `${pair.pages} หน้า · ${(pair.bytes.length / 1024).toFixed(0)} KB · ${JSON.stringify(pair.sent)}`);
    const n0 = sheets.length;
    await click('PNG');
    const pngFiles = await waitFiles('.png', 2);
    const sentPng = sheets.slice(n0);
    const pngOk = pngFiles.length === 2 && pngFiles.every((f) => readFileSync(join(dlDir, f)).subarray(1, 4).toString() === 'PNG') && pngFiles.some((f) => f.endsWith('-3D.png')) && pngFiles.some((f) => f.endsWith('-2D.png'));
    ok('   แท็บคู่ → PNG 2 ไฟล์ (3D ส่งภาพนิ่ง · 2D ไม่ส่ง)', pngOk && sentPng.map((x) => `${x.view}:${x.still}`).join() === '3d:ok,2d:none', `${pngFiles.join(' · ')} · ${JSON.stringify(sentPng)}`);
    if (process.env.DL_SHOT && pngFiles[0]) (await import('node:fs')).writeFileSync(process.env.DL_SHOT.replace(/\.png$/, '-print.png'), readFileSync(join(dlDir, pngFiles.find((f) => f.endsWith('-3D.png')) ?? pngFiles[0])));
    await tab('2 มิติ'); await later(400);
    const one2 = await pdfOf();
    ok('   แท็บ 2 มิติ → PDF 1 หน้า ใบ 2 มิติ ไม่ส่งภาพนิ่ง', one2.pages === 1 && one2.sent.length === 1 && one2.sent[0].view === '2d' && one2.sent[0].still === 'none', `${one2.pages} หน้า · ${JSON.stringify(one2.sent)}`);
    await tab('3 มิติ');
    await page.waitForFunction(() => Number(document.querySelector<HTMLElement>('[data-testid="drawing-card"] .dv-stage')?.dataset.dvBuilds ?? 0) >= 1, { timeout: 10000 });
    await later(600);
    const one3 = await pdfOf();
    ok('   แท็บ 3 มิติ → PDF 1 หน้า ใบ 3 มิติ ส่งภาพนิ่ง', one3.pages === 1 && one3.sent.length === 1 && one3.sent[0].view === '3d' && one3.sent[0].still === 'ok', `${one3.pages} หน้า · ${JSON.stringify(one3.sent)}`);
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
    const svg = await page.evaluate(() => document.querySelector('[data-testid="drawing-sheet-2d"] [data-view="ortho"]')?.textContent ?? '');
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
