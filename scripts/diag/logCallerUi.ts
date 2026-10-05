/* ─────────────────────────────────────────────────────────────────────────────
   ช่อง "ผู้เรียก" ในตัวกรองขั้นสูงของหน้า "บันทึกการเรียก API" — หน้าจอจริง

   แบบ: mockup `log-caller-filter` แบบ B + ชื่อเซลส์ในตาราง (เจ้าของตอบ "B + เอาชื่อ" 2026-10-05)
   **ไม่แตะฐาน และไม่ต้องเปิดเซิร์ฟเวอร์** (ท่าเดียวกับ `diag:log-chat-ui`): puppeteer เสิร์ฟ `public/` ที่ build
   แล้วเอง และตอบทุก `/api/*` ด้วยข้อมูลจำลอง ⇒ รันบน PMSV ได้

   a. รายชื่อโหลดครั้งเดียวต่อช่วงวัน · เรียง ไม่มีผู้เรียก → แอดมิน → LINE · มีป้ายชนิด + จำนวนครั้ง
   b. เลือกแอดมิน ⇒ ส่ง adminUserId (ไม่มี lineUserId/noCaller ค้าง) + ชิป "ผู้เรียก"
   c. เลือกเซลส์ LINE ⇒ ส่ง lineUserId · ช่องโชว์ชื่อ + ป้าย LINE
   d. เลือก "ไม่มีผู้เรียก" ⇒ ส่ง noCaller=1 · ล้างชิปแล้วไม่เหลือตัวกรองผู้เรียกใน request
   e. วางไอดี LINE เต็มในช่องค้นแล้วเจอ
   f. ค่าที่ค้างใน URL แต่ไม่อยู่ในรายชื่อช่วงนี้ ⇒ ช่องยังโชว์ (ไม่ทำเป็นว่าไม่ได้กรอง) + ส่ง lineUserId เดิม
   g. ตาราง: ไอดีที่เป็นเซลส์ = ชื่อ + ป้าย LINE + ไอดีย่อบรรทัดล่าง · ไอดีที่ไม่ใช่เซลส์ = ไอดีย่อแบบเดิม
   h. endpoint รายชื่อล้ม ⇒ หน้าไม่พัง ตารางยังขึ้น และบอกในรายการว่าโหลดไม่สำเร็จ
   i. 390px: หน้าไม่เลื่อนแนวนอนตอนกางรายการ
   + ไม่มี error หลุดจากหน้าเว็บ · เก็บภาพไว้ที่ LOG_CALLER_UI_SHOTS (ถ้าตั้ง) ทั้งธีมมืด/สว่าง

   รัน: `npm --prefix frontend run build` ก่อน แล้ว `npm run diag:log-caller-ui`
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type HTTPRequest, type Page } from 'puppeteer';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const ORIGIN = 'http://log-caller-probe.local';
const SHOTS = process.env.LOG_CALLER_UI_SHOTS ?? '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

// ── ข้อมูลจำลอง ────────────────────────────────────────────────────────────────
const U_SALE = 'U33163c9500000000000000000004a1f';
const U_OTHER = 'U9a01f2c000000000000000000077d0';
const U_STALE = 'Uzzzz00000000000000000000000beef';
const CALLERS = [
  { kind: 'admin', id: '7', name: 'admin01', code: null, count: 9354 },
  { kind: 'none', id: null, name: null, code: null, count: 2391 },
  { kind: 'line', id: U_SALE, name: 'คุณทดลอง', code: '421', count: 1289 },
  { kind: 'admin', id: '9', name: 'THT0082', code: null, count: 1486 },
  { kind: 'line', id: U_OTHER, name: null, code: null, count: 12 },
];

const row = (id: string, path: string, extra: Record<string, unknown> = {}) => ({
  id, created_at: '2026-10-05T08:30:00Z', request_id: `b00000000000000${id}`, method: 'GET', route: null,
  route_group: path, path, status_code: 200, duration_ms: 12, resp_bytes: 2, admin_user_id: null,
  admin_username: null, line_user_id: null, line_user_name: null, ip: '203.0.113.9',
  doc_owner_user_id: null, doc_owner_name: null, inflight: 1, db_waiting: 0, queue_waited_ms: null, ...extra,
});
const ROWS = [
  row('3', '/api/admin/approvals/count', { admin_user_id: 7, admin_username: 'admin01' }),
  row('2', '/api/quotation/probe-sale', { line_user_id: U_SALE, line_user_name: 'คุณทดลอง' }),
  row('1', '/api/quotation/probe-other', { line_user_id: U_OTHER }),
];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json',
};
const json = (req: HTTPRequest, body: unknown, status = 200) =>
  req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface Probe { callersFail: boolean; callerCalls: string[]; listCalls: URLSearchParams[] }

function router(p: Probe) {
  return async (req: HTTPRequest) => {
    const url = new URL(req.url());
    if (url.origin !== ORIGIN) return req.respond({ status: 204, body: '' });
    const path = url.pathname;
    if (!path.startsWith('/api/')) {
      const file = normalize(join(PUBLIC, path === '/' ? 'admin.html' : path));
      if (!file.startsWith(PUBLIC) || !existsSync(file)) return req.respond({ status: 404, body: 'not found' });
      return req.respond({ status: 200, contentType: MIME[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
    }
    if (path === '/api/admin/me/capabilities') return json(req, { capabilities: {} });
    if (path === '/api/admin/api-logs/stats') {
      return json(req, { byRoute: [], byHour: [], slowest: [], dateFrom: '2026-10-05', dateTo: '2026-10-05',
        saturation: { total: 3, max_inflight: 1, max_db_waiting: 0, db_wait_hits: 0, errors: 0, webhook_dropped: 0,
          webhook_timeout: 0, p95: 12, max_queue_waited: 0, s2xx: 3, s3xx: 0, s4xx: 0, s5xx: 0 } });
    }
    if (path === '/api/admin/api-logs/callers') {
      p.callerCalls.push(url.search);
      return p.callersFail ? json(req, { error: 'probe ล้ม' }, 500) : json(req, { data: CALLERS });
    }
    if (path === '/api/admin/api-logs') {
      p.listCalls.push(url.searchParams);
      return json(req, { data: ROWS, total: ROWS.length, limit: 50, offset: 0 });
    }
    if (path === '/api/admin/logs/chat') return json(req, { content: true, data: {} });
    return json(req, {});
  };
}

const TOKEN_PAYLOAD = Buffer.from(JSON.stringify({ id: 1, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const FAKE_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${TOKEN_PAYLOAD}.probe`;

async function openPage(width: number, p: Probe, hash = '', theme: 'dark' | 'light' = 'dark'): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage();
  const errors: string[] = [];
  await page.setViewport({ width, height: 1000 });
  await page.setRequestInterception(true);
  page.on('request', (r) => { void router(p)(r); });
  page.on('pageerror', (e: unknown) => { errors.push(e instanceof Error ? e.message : String(e)); });
  await page.evaluateOnNewDocument('globalThis.__name = (f) => f;');
  await page.evaluateOnNewDocument((t: string, th: string) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', JSON.stringify({ id: 1, username: 'probe', name: 'Probe', role: 'admin' }));
    try { localStorage.setItem('admin-theme', th); } catch { /* ไม่มี storage */ }
  }, FAKE_TOKEN, theme);
  await page.goto(`${ORIGIN}/admin.html#apilogs${hash}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.innerText.includes('/api/quotation/probe-sale'), { timeout: 15000 });
  return { page, errors };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shot = async (pg: Page, name: string) => {
  if (SHOTS) await pg.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
};

/** กดปุ่ม "ตัวกรองขั้นสูง" ถ้ายังไม่กาง */
async function openAdvanced(pg: Page) {
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('ตัวกรองขั้นสูง'));
    if (b?.getAttribute('aria-expanded') !== 'true') (b as HTMLElement | undefined)?.click();
  });
  await pg.waitForSelector('[aria-label="ผู้เรียก"]', { timeout: 5000 });
}
const field = (pg: Page) => pg.$eval('[aria-label="ผู้เรียก"]', el => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim());
async function openCombo(pg: Page) {
  await pg.click('[aria-label="ผู้เรียก"]');
  await sleep(150);
}
/** แถวในรายการที่กางอยู่ (ข้อความทั้งแถว) */
const listItems = (pg: Page) => pg.evaluate(() => {
  const box = document.querySelector('[aria-label="ผู้เรียก"]')?.parentElement;
  return [...(box?.querySelectorAll('div.max-h-64 button') ?? [])].map(b => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim());
});
async function pick(pg: Page, startsWith: string) {
  await openCombo(pg);
  await pg.evaluate((s: string) => {
    const box = document.querySelector('[aria-label="ผู้เรียก"]')?.parentElement;
    const b = [...(box?.querySelectorAll('div.max-h-64 button') ?? [])].find(x => (x as HTMLElement).innerText.trim().startsWith(s));
    (b as HTMLElement | undefined)?.click();
  }, startsWith);
  await sleep(500);   // ตารางหน่วง 300ms ก่อนยิง
}
const last = (p: Probe) => p.listCalls[p.listCalls.length - 1];
/** ชิปตัวกรองของผู้เรียก (FilterChip = ปุ่มที่มี title "เอาตัวกรอง <label> ออก") */
const CHIP = 'button[title="เอาตัวกรอง ผู้เรียก ออก"]';
const chipText = (pg: Page) => pg.$$eval(CHIP, bs => bs.map(b => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
try {
  console.log('\n── 1280px ─────────────────────────────────────────────────');
  const p: Probe = { callersFail: false, callerCalls: [], listCalls: [] };
  const { page, errors } = await openPage(1280, p);

  ok('a. รายชื่อผู้เรียกโหลดครั้งเดียว', p.callerCalls.length === 1, String(p.callerCalls.length));
  await openAdvanced(page);
  ok('   ช่อง LINE User ID แบบพิมพ์เดิมไม่อยู่แล้ว', !(await page.evaluate(() => document.body.innerText.includes('LINE User ID'))));
  await openCombo(page);
  const items = await listItems(page);
  ok('a. ลำดับ: ทั้งหมด → ไม่มีผู้เรียก → แอดมิน (มาก→น้อย) → LINE (มาก→น้อย)',
    items.length === 6 && items[0].startsWith('ทั้งหมด') && items[1].startsWith('ไม่มีผู้เรียก')
    && items[2].startsWith('admin01') && items[3].startsWith('THT0082')
    && items[4].startsWith('คุณทดลอง') && items[5].startsWith('U9a01f2c'), items.join(' | '));
  ok('a. ป้ายชนิด + รหัสเซลส์ + จำนวนครั้ง',
    items[2].includes('แอดมิน') && items[2].includes('9,354') && items[4].includes('LINE')
    && items[4].includes('421') && items[4].includes('1,289') && items[1].includes('ลิงก์สาธารณะ'), `${items[2]} | ${items[4]}`);
  ok('a. "ทั้งหมด" ไม่มีป้ายชนิด', items[0] === 'ทั้งหมด', items[0]);
  await shot(page, '1280-open-dark');
  await page.keyboard.press('Escape');

  await pick(page, 'admin01');
  let q = last(p);
  ok('b. เลือกแอดมิน ⇒ adminUserId=7 ไม่มีค่าอื่นค้าง',
    q.get('adminUserId') === '7' && !q.has('lineUserId') && !q.has('noCaller'), q.toString());
  ok('b. ชิปตัวกรอง "ผู้เรียก admin01"', (await chipText(page)).some(t => t.includes('admin01')), (await chipText(page)).join(' | '));

  await pick(page, 'คุณทดลอง');
  q = last(p);
  ok('c. เลือกเซลส์ ⇒ lineUserId ไม่มี adminUserId ค้าง',
    q.get('lineUserId') === U_SALE && !q.has('adminUserId') && !q.has('noCaller'), q.toString());
  const f = await field(page);
  ok('c. ช่องโชว์ชื่อ + ป้าย LINE', f.includes('คุณทดลอง') && f.includes('LINE'), f);
  await shot(page, '1280-picked-dark');

  await pick(page, 'ไม่มีผู้เรียก');
  q = last(p);
  ok('d. เลือก "ไม่มีผู้เรียก" ⇒ noCaller=1', q.get('noCaller') === '1' && !q.has('lineUserId') && !q.has('adminUserId'), q.toString());
  ok('d. ชิป "ผู้เรียก ไม่มีผู้เรียก"', (await chipText(page)).some(t => t.includes('ไม่มีผู้เรียก')), (await chipText(page)).join(' | '));
  await page.click(CHIP);
  await sleep(500);
  q = last(p);
  ok('d. ล้างชิปแล้ว request ไม่มีตัวกรองผู้เรียก', !q.has('noCaller') && !q.has('lineUserId') && !q.has('adminUserId'), q.toString());

  await openCombo(page);
  await page.keyboard.type(U_OTHER);
  await sleep(150);
  const found = await listItems(page);
  ok('e. วางไอดี LINE เต็มในช่องค้นแล้วเจอ', found.length === 1 && found[0].startsWith('U9a01f2c'), found.join(' | '));
  await page.keyboard.press('Escape');

  const cells = await page.evaluate(() => [...document.querySelectorAll('tbody > tr')].filter(tr => tr.querySelector('td'))
    .map(tr => (tr.querySelectorAll('td')[2] as HTMLElement | undefined)?.innerText.replace(/\s+/g, ' ').trim() ?? ''));
  ok('g. แอดมิน = username', cells[0]?.startsWith('admin01'), cells[0]);
  ok('g. เซลส์ = ชื่อ + LINE + ไอดีย่อ · IP', cells[1]?.startsWith('คุณทดลอง LINE') && cells[1].includes('U33163c9') && cells[1].includes('203.0.113.9'), cells[1]);
  ok('g. ไอดีที่ไม่ใช่เซลส์ = ไอดีย่อแบบเดิม (ไม่มีป้าย)', cells[2]?.startsWith('U9a01f2c') && !cells[2].includes('LINE'), cells[2]);
  ok('   ไม่มี error หลุดจากหน้าเว็บ', errors.length === 0, errors.join(' | '));
  await page.close();

  console.log('\n── ค่าค้างใน URL ที่ไม่อยู่ในรายชื่อ · ธีมสว่าง ───────────────');
  const p2: Probe = { callersFail: false, callerCalls: [], listCalls: [] };
  const o2 = await openPage(1280, p2, `?lineUserId=${U_STALE}`, 'light');
  await openAdvanced(o2.page);
  const f2 = await field(o2.page);
  ok('f. ช่องยังโชว์ค่าที่กรองอยู่ (ไอดีย่อ)', f2.includes('Uzzzz000'), f2);
  ok('f. request ยังส่ง lineUserId เดิม', last(p2).get('lineUserId') === U_STALE, last(p2).toString());
  await openCombo(o2.page);
  await shot(o2.page, '1280-open-light');
  ok('   ไม่มี error หลุดจากหน้าเว็บ', o2.errors.length === 0, o2.errors.join(' | '));
  await o2.page.close();

  console.log('\n── รายชื่อโหลดไม่สำเร็จ ────────────────────────────────────');
  const p3: Probe = { callersFail: true, callerCalls: [], listCalls: [] };
  const o3 = await openPage(1280, p3);
  await openAdvanced(o3.page);
  await openCombo(o3.page);
  const body3 = await o3.page.evaluate(() => document.body.innerText);
  ok('h. ตารางยังขึ้น + บอกในรายการว่าโหลดรายชื่อไม่สำเร็จ',
    body3.includes('/api/quotation/probe-sale') && body3.includes('โหลดรายชื่อไม่สำเร็จ'));
  ok('   ไม่มี error หลุดจากหน้าเว็บ', o3.errors.length === 0, o3.errors.join(' | '));
  await o3.page.close();

  console.log('\n── 390px ──────────────────────────────────────────────────');
  const p4: Probe = { callersFail: false, callerCalls: [], listCalls: [] };
  const o4 = await openPage(390, p4);
  await openAdvanced(o4.page);
  await openCombo(o4.page);
  const w = await o4.page.evaluate(() => ({ doc: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  ok('i. กางรายการแล้วหน้าไม่เลื่อนแนวนอน', w.doc <= w.client, JSON.stringify(w));
  await shot(o4.page, '390-open-dark');
  ok('   ไม่มี error หลุดจากหน้าเว็บ', o4.errors.length === 0, o4.errors.join(' | '));
  await o4.page.close();
} finally {
  await browser.close();
}

console.log(fail ? `\n❌ ไม่ผ่าน ${fail} ข้อ` : '\n✅ ผ่านทั้งหมด');
process.exit(fail ? 1 : 0);
