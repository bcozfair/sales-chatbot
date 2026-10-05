/* ─────────────────────────────────────────────────────────────────────────────
   บทสนทนาในหน้า "บันทึกการเรียก API" + กล่อง "ทุกอย่างของ request นี้" — หน้าจอจริง

   แบบ: mockup `log-chat-messages` ทาง ก ทั้ง 4 ข้อ (เจ้าของตอบ "ตามที่แนะนำ" 2026-10-05)
   **ไม่แตะฐาน และไม่ต้องเปิดเซิร์ฟเวอร์** (ท่าเดียวกับ `diag:badges-live-ui`): puppeteer เสิร์ฟ `public/` ที่ build
   แล้วเอง และตอบทุก `/api/*` ด้วยข้อมูลจำลอง ⇒ รันบน PMSV ได้ · การตัดเนื้อแชทฝั่ง server พิสูจน์ที่ `diag:log-chat`
   ด่านนี้พิสูจน์ว่า **จอ** ทำตามสิ่งที่ server ส่งมา และไม่เดาเอง

   a. ชิปแยกตามหน้าที่ของแถว: /callback = ขาเข้า (คำแปลปุ่ม) · TASK = คำตอบ + ผลการส่ง · หน้าเว็บ = ก้อนของมัน
      · แถวที่ไม่มีข้อความไม่มีชิป
   b. ข้อความโหลด **ครั้งเดียวต่อหน้า** (≤200 id ใน request เดียว) ไม่ยิงทีละแถว
   c. แถวที่กาง: ก้อนบทสนทนา + ป้าย "เห็นเฉพาะ admin" + "บันทึกก่อนส่ง" + error ของ LINE + ข้อความท้ายแบบใหม่
   d. กล่อง request: ก้อนปักบนสุด → "ลำดับเวลา" มีหมุดรับ/ส่งคำตอบตามเวลาจริง (ไม่พิมพ์เนื้อซ้ำ)
   e. ติ๊ก "เฉพาะที่บอทส่งไม่ถึง" ⇒ ส่ง undelivered=1 + ขึ้นชิปตัวกรอง
   f. ไม่ใช่ admin (server ส่ง content=false): แม่กุญแจ + ชนิด + ผลการส่ง + error · **ไม่มีข้อความเฝ้าระวังใน DOM**
   g. 390px: แผงที่กางติดขอบซ้ายและอยู่ในจอแม้ตารางถูกเลื่อนไปทางขวา
   + ไม่มี error หลุดจากหน้าเว็บ · เก็บภาพไว้ที่ LOG_CHAT_UI_SHOTS (ถ้าตั้ง) ให้คนเปิดดูด้วยตา ทั้งธีมมืด/สว่าง

   รัน: `npm --prefix frontend run build` ก่อน แล้ว `npm run diag:log-chat-ui`
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type HTTPRequest, type Page } from 'puppeteer';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const ORIGIN = 'http://log-chat-probe.local';
const SHOTS = process.env.LOG_CHAT_UI_SHOTS ?? '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

// ── ข้อมูลจำลอง ────────────────────────────────────────────────────────────────
const SENT = {
  reply1: 'PROBE-คำตอบ ✅ ยืนยันสำเร็จ!\n📄 ใบเสนอราคาเลขที่: QP-261005017',
  reply2: 'PROBE-คำตอบ ✅ ยืนยันสำเร็จ!\n📄 ใบเสนอราคาเลขที่: QT-261005018',
  label: 'กดยืนยันใบเสนอราคา (2 ใบ)',
  raw: 'action=confirm&id=PROBE-a,PROBE-b',
  web: 'PROBE-ลูกค้า หจก.ทดสอบการช่าง\nTS-01-J-150-8-3M 10 ตัว',
  webOut: 'PROBE-📝 ร่างใบเสนอราคา (ยังไม่บันทึก)',
};
const R2 = 'a000000000000002', R5 = 'a000000000000005', R6 = 'a000000000000006', R0 = 'a000000000000000';
const T = (s: string) => `2026-10-05T07:${s}Z`;

const row = (id: string, at: string, method: string, path: string, rid: string, extra: Record<string, unknown> = {}) => ({
  id, created_at: T(at), request_id: rid, method, route: null, route_group: path, path, status_code: 200,
  duration_ms: method === 'TASK' ? 2100 : 11, resp_bytes: method === 'TASK' ? null : 2, admin_user_id: null,
  admin_username: null, line_user_id: method === 'POST' && path === '/callback' || method === 'TASK' ? 'U4f2a00000000000000000000009c1e' : null,
  ip: null, doc_owner_user_id: null, doc_owner_name: null, inflight: 3, db_waiting: 0,
  queue_waited_ms: method === 'TASK' ? 25 : null, ...extra,
});
const ROWS = [
  row('6', '30:44', 'TASK', '/callback', R2),
  row('5', '30:41', 'POST', '/callback', R2),
  row('4', '29:00', 'GET', '/api/admin/api-logs', R0, { admin_username: 'admin01' }),
  row('3', '28:03', 'POST', '/api/admin/webquote/propose', R5, { admin_username: 'admin01', duration_ms: 5120 }),
  row('2', '20:12', 'TASK', '/callback', R6),
  row('1', '20:12', 'POST', '/callback', R6),
];

const sender = { line_user_id: 'U4f2a00000000000000000000009c1e', name: 'คุณบี ทดลอง', code: 'S-099', admin: null };
function exchanges(content: boolean): Record<string, unknown[]> {
  const c = <V>(v: V) => (content ? { content: v } : {});
  return {
    [R2]: [{
      key: 'ev-r2', request_id: R2, channel: 'line', kind: 'postback', subtype: null, at: T('30:41'), done_at: T('30:44'),
      sender, redelivery: null,
      delivery: { status: 'failed', problem: true, error: '400 Bad Request {"message":"Invalid reply token"}' },
      ...c({ in_text: SENT.label, raw: SENT.raw, preview: null, replies: [
        { source: 'handler', text: SENT.reply1, no_reply: false, at: T('30:43') },
        { source: 'handler', text: SENT.reply2, no_reply: false, at: T('30:43') },
      ] }),
    }],
    [R5]: [{
      key: 'web-9', request_id: R5, channel: 'web', kind: 'web', subtype: 'web_propose', at: T('28:08'), done_at: null,
      sender: { ...sender, line_user_id: null, admin: 'admin01' }, redelivery: null,
      delivery: { status: 'web', problem: false, error: null },
      ...c({ in_text: SENT.web, raw: null, preview: null, replies: [{ source: 'web', text: SENT.webOut, no_reply: false, at: T('28:08') }] }),
    }],
    [R6]: [{
      key: 'ev-r6', request_id: R6, channel: 'line', kind: 'sticker', subtype: 'sticker', at: T('20:12'), done_at: T('20:12'),
      sender, redelivery: null, delivery: { status: 'none', problem: true, error: null },
      ...c({ in_text: null, raw: null, preview: null, replies: [{ source: 'fill', text: '[บอทไม่ได้ตอบ]', no_reply: true, at: T('20:12') }] }),
    }],
  };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json',
};
const json = (req: HTTPRequest, body: unknown, status = 200) =>
  req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface Probe { content: boolean; chatCalls: string[]; listCalls: string[] }

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
        saturation: { total: 6, max_inflight: 3, max_db_waiting: 0, db_wait_hits: 0, errors: 0, webhook_dropped: 0,
          webhook_timeout: 0, p95: 2100, max_queue_waited: 25, s2xx: 6, s3xx: 0, s4xx: 0, s5xx: 0 } });
    }
    if (path === '/api/admin/api-logs') {
      p.listCalls.push(url.search);
      const data = url.searchParams.get('undelivered') === '1' ? ROWS.filter(r => r.id === '6' || r.id === '2') : ROWS;
      return json(req, { data, total: data.length, limit: 50, offset: 0 });
    }
    const one = /^\/api\/admin\/api-logs\/(\d+)$/.exec(path);
    if (one) {
      const r = ROWS.find(x => x.id === one[1]);
      const related = ROWS.filter(x => x.request_id === r?.request_id && x.id !== r?.id)
        .map(x => ({ id: x.id, created_at: x.created_at, method: x.method, path: x.path, status_code: 200, duration_ms: x.duration_ms, queue_waited_ms: x.queue_waited_ms }));
      return json(req, { ...r, related });
    }
    if (path === '/api/admin/logs/chat') {
      p.chatCalls.push(url.searchParams.get('ids') ?? '');
      const ids = (url.searchParams.get('ids') ?? '').split(',');
      const all = exchanges(p.content);
      return json(req, { content: p.content, data: Object.fromEntries(Object.entries(all).filter(([k]) => ids.includes(k))) });
    }
    const tl = /^\/api\/admin\/logs\/request\/([0-9a-f]{16})$/.exec(path);
    if (tl) {
      const all = exchanges(p.content);
      return json(req, {
        requestId: tl[1], content: p.content, chat_error: null, messages: all[tl[1]] ?? [],
        data: tl[1] === R2 ? [
          { kind: 'api', id: '5', at: T('30:41'), title: 'POST /callback', detail: '200', duration_ms: 11 },
          { kind: 'audit', id: '77', at: T('30:43'), title: 'quotation.confirm', detail: 'QP-261005017', duration_ms: null },
          { kind: 'system', id: '88', at: T('30:44'), title: 'error line', detail: 'replyMessage ล้ม 400', duration_ms: null },
          { kind: 'api', id: '6', at: T('30:44'), title: 'TASK /callback', detail: '200', duration_ms: 2100 },
        ] : [],
      });
    }
    return json(req, {});
  };
}

const TOKEN_PAYLOAD = Buffer.from(JSON.stringify({ id: 1, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const FAKE_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${TOKEN_PAYLOAD}.probe`;

async function openPage(width: number, p: Probe, theme: 'dark' | 'light' = 'dark'): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage();
  const errors: string[] = [];
  await page.setViewport({ width, height: 1000 });
  await page.setRequestInterception(true);
  page.on('request', (r) => { void router(p)(r); });
  page.on('pageerror', (e: unknown) => { errors.push(e instanceof Error ? e.message : String(e)); });
  await page.evaluateOnNewDocument('globalThis.__name = (f) => f;');
  await page.evaluateOnNewDocument((t: string, role: string, th: string) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', JSON.stringify({ id: 1, username: 'probe', name: 'Probe', role }));
    try { localStorage.setItem('admin-theme', th); } catch { /* ไม่มี storage */ }
  }, FAKE_TOKEN, p.content ? 'admin' : 'subadmin', theme);
  await page.goto(`${ORIGIN}/admin.html#apilogs`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.innerText.includes('/api/admin/webquote/propose'), { timeout: 15000 });
  await page.waitForFunction(() => document.body.innerText.includes('แสดงบนหน้าเว็บ'), { timeout: 5000 }).catch(() => {});
  return { page, errors };
}

/** ข้อความของชิปใต้ path ของแถวที่ id ตรง (ตามลำดับแถวในตาราง) */
const chipTexts = (pg: Page) => pg.evaluate(() =>
  [...document.querySelectorAll('tbody > tr')].filter(tr => tr.querySelector('td'))
    .map(tr => {
      const cell = tr.querySelectorAll('td')[1];
      const chip = cell ? [...cell.querySelectorAll('div')].find(d => d.className.includes('rounded-[7px]')) : null;
      return { path: cell?.querySelector('span.font-mono')?.textContent ?? '', chip: chip?.textContent ?? null };
    }));

const shot = async (pg: Page, name: string, full = true) => {
  if (SHOTS) await pg.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: full });
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
try {
  // ════════ admin · 1280 ════════
  console.log('\n── admin · 1280px ─────────────────────────────────────────');
  const pa: Probe = { content: true, chatCalls: [], listCalls: [] };
  const { page, errors } = await openPage(1280, pa);
  const chips = await chipTexts(page);
  const chipOf = (i: number) => chips[i]?.chip ?? '';
  ok('a. TASK ของปุ่มยืนยัน = คำตอบ + ผลการส่ง', chipOf(0).includes('2 คำตอบ') && chipOf(0).includes('ส่งไม่ถึง'), chipOf(0));
  ok('a. /callback = ขาเข้า (คำแปลปุ่ม) ไม่มีผลการส่ง', chipOf(1).includes(SENT.label) && !chipOf(1).includes('ส่งไม่ถึง'), chipOf(1));
  ok('a. แถวที่ไม่มีข้อความไม่มีชิป', chips[2]?.chip === null, String(chips[2]?.chip));
  ok('a. หน้าเว็บ = ข้อความในหน้าเว็บ + "แสดงบนหน้าเว็บ"', chipOf(3).includes('PROBE-ลูกค้า') && chipOf(3).includes('แสดงบนหน้าเว็บ'), chipOf(3));
  ok('a. สติกเกอร์: TASK = "ไม่มีคำตอบ · บอทไม่ได้ตอบ"', chipOf(4).includes('ไม่มีคำตอบ') && chipOf(4).includes('บอทไม่ได้ตอบ'), chipOf(4));
  const oneLine = await page.evaluate(() => [...document.querySelectorAll('td div')]
    .filter(d => d.className.includes('rounded-[7px]')).every(d => (d as HTMLElement).getBoundingClientRect().height < 30));
  ok('a. ชิปเป็นบรรทัดเดียวทุกตัว', oneLine);
  // ชิปต้องไม่ทำให้ตารางกว้างขึ้น — ตารางที่ล้นจอดันคอลัมน์ "ใช้เวลา" กับแผงที่กางออกไปนอกจอ
  const widths = await page.evaluate(() => {
    const sc = document.querySelector('table')?.closest('.overflow-x-auto') as HTMLElement | null;
    const chips = [...document.querySelectorAll('td div')].filter(d => d.className.includes('rounded-[7px]')) as HTMLElement[];
    const w1 = sc?.scrollWidth ?? -1;
    chips.forEach(c => { c.style.display = 'none'; });
    const w0 = sc?.scrollWidth ?? -1;
    chips.forEach(c => { c.style.display = ''; });
    return { withChips: w1, without: w0, client: sc?.clientWidth ?? -1 };
  });
  ok('a. ชิปไม่ทำให้ตารางกว้างขึ้น', widths.withChips === widths.without, JSON.stringify(widths));
  ok('b. ข้อความโหลดครั้งเดียวต่อหน้า และขอทุก request ของหน้าใน request เดียว',
    pa.chatCalls.length === 1 && [R2, R5, R6, R0].every(id => pa.chatCalls[0].split(',').includes(id)), `${pa.chatCalls.length} ครั้ง`);
  await shot(page, 'admin-1280-table');

  // c. กางแถว TASK
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tbody > tr')].find(r => r.textContent?.includes('2 คำตอบ'));
    (tr as HTMLElement | undefined)?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('บทสนทนาของ request นี้'), { timeout: 5000 }).catch(() => {});
  const body = await page.evaluate(() => document.body.innerText);
  ok('c. แถวที่กาง: หัวข้อบทสนทนา + ป้าย "เห็นเฉพาะ admin"', body.includes('บทสนทนาของ request นี้') && body.includes('เห็นเฉพาะ admin'));
  ok('c. คำตอบสองแถว + "บันทึกก่อนส่ง" + "ไม่ถึงเซลส์"',
    body.includes('QP-261005017') && body.includes('QT-261005018') && body.includes('บันทึกก่อนส่ง') && body.includes('ไม่ถึงเซลส์'));
  ok('c. ผลการส่ง: ป้าย + คำอธิบาย + error ของ LINE', body.includes('LINE ไม่รับคำตอบ') && body.includes('Invalid reply token'));
  ok('c. ข้อความท้ายแบบใหม่ + ลิงก์บอกว่ารวมข้อความ',
    body.includes('ข้อความข้างบนมาจากประวัติแชท ซึ่งเก็บแยกและดูได้เฉพาะ admin') && body.includes('รวมข้อความ · การแก้ไข · บันทึกระบบ'));
  await shot(page, 'admin-1280-expanded');

  // d. กล่อง request
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('ดูทุกอย่างของ request นี้'));
    (b as HTMLElement | undefined)?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('ลำดับเวลา'), { timeout: 5000 }).catch(() => {});
  const order = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const t = (dlg as HTMLElement | null)?.innerText ?? '';
    const lis = [...(dlg?.querySelectorAll('ol > li') ?? [])].map(li => (li as HTMLElement).innerText.split('\n').slice(0, 2).join(' '));
    return { t, pin: t.indexOf('บทสนทนา'), seq: t.indexOf('ลำดับเวลา'), lis };
  });
  ok('d. ก้อนบทสนทนาอยู่บนสุด ก่อน "ลำดับเวลา"', order.pin >= 0 && order.seq > order.pin, `${order.pin} < ${order.seq}`);
  const iIn = order.lis.findIndex(l => l.includes('รับการกดปุ่มจากเซลส์'));
  const iOut = order.lis.findIndex(l => l.includes('ส่งคำตอบ'));
  const iAudit = order.lis.findIndex(l => l.includes('การแก้ไข'));
  ok('d. หมุดรับ/ส่งคำตอบเรียงตามเวลาจริง (รับ → การแก้ไข → ส่งคำตอบ)', iIn >= 0 && iAudit > iIn && iOut > iAudit, order.lis.join(' | '));
  const replyTwice = (order.t.match(/QT-261005018/g) ?? []).length;   // QP- อยู่ใน detail ของแถวการแก้ไขด้วย
  ok('d. เส้นเวลาไม่พิมพ์คำตอบซ้ำ (เนื้ออยู่ในก้อนข้างบนที่เดียว)', replyTwice === 1, `${replyTwice} ครั้ง`);
  await shot(page, 'admin-1280-timeline');
  await page.keyboard.press('Escape');

  // e. ตัวกรองส่งไม่ถึง
  await page.evaluate(() => {
    const lab = [...document.querySelectorAll('label')].find(l => l.textContent?.includes('เฉพาะที่บอทส่งไม่ถึง'));
    (lab?.querySelector('input') as HTMLInputElement | null)?.click();
  });
  await sleep(800);
  ok('e. ติ๊กแล้วส่ง undelivered=1 + ชิปตัวกรอง "บอทส่งไม่ถึง"',
    pa.listCalls.some(s => s.includes('undelivered=1')) && (await page.evaluate(() => document.body.innerText)).includes('บอทส่งไม่ถึง'),
    pa.listCalls.at(-1) ?? '');
  ok('   ไม่มี error หลุดจากหน้าเว็บ', errors.length === 0, errors.join(' | '));
  await page.close();

  // ════════ ไม่ใช่ admin · 1280 ════════
  console.log('\n── ไม่ใช่ admin (server ส่ง content=false) · 1280px ─────────');
  const pn: Probe = { content: false, chatCalls: [], listCalls: [] };
  const n = await openPage(1280, pn);
  const nc = await chipTexts(n.page);
  ok('f. ชิปขึ้นแม่กุญแจ "มีข้อความ · ชนิด" + ผลการส่งยังเห็น',
    (nc[0]?.chip ?? '').includes('มีข้อความ · กดปุ่ม') && (nc[0]?.chip ?? '').includes('ส่งไม่ถึง')
      && (nc[3]?.chip ?? '').includes('มีข้อความ · หน้าเว็บ · ตรวจคำขอ'), `${nc[0]?.chip} | ${nc[3]?.chip}`);
  await n.page.evaluate(() => {
    const tr = [...document.querySelectorAll('tbody > tr')].find(r => r.textContent?.includes('มีข้อความ · กดปุ่ม') && r.textContent?.includes('ส่งไม่ถึง'));
    (tr as HTMLElement | undefined)?.click();
  });
  await n.page.waitForFunction(() => document.body.innerText.includes('บทสนทนาของ request นี้'), { timeout: 5000 }).catch(() => {});
  await n.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('ดูทุกอย่างของ request นี้'));
    (b as HTMLElement | undefined)?.click();
  });
  await n.page.waitForFunction(() => document.body.innerText.includes('ลำดับเวลา'), { timeout: 5000 }).catch(() => {});
  const nb = await n.page.evaluate(() => document.body.innerText + document.body.innerHTML);
  ok('f. แถวที่กาง/กล่อง request: แม่กุญแจ · ผลการส่ง · error ของ LINE · ไม่มีป้าย "เห็นเฉพาะ admin"',
    nb.includes('เนื้อข้อความดูได้เฉพาะผู้ดูแลระบบ (admin)') && nb.includes('Invalid reply token')
      && nb.includes('รับการกดปุ่มจากเซลส์') && !nb.includes('เห็นเฉพาะ admin'));
  ok('f. ไม่มีข้อความเฝ้าระวังใน DOM (ทั้ง text และ attribute เช่น title)', !nb.includes('PROBE-') && !nb.includes(SENT.label));
  ok('f. ข้อความท้ายแถวที่กางเป็นแบบเดิม (ไม่อ้างว่ามีข้อความให้ดู)', nb.includes('ระบบไม่เก็บเนื้อหาที่ส่งมากับ request'));
  await shot(n.page, 'other-1280-timeline');
  ok('   ไม่มี error หลุดจากหน้าเว็บ', n.errors.length === 0, n.errors.join(' | '));
  await n.page.close();

  // ════════ 390px ════════
  console.log('\n── admin · 390px ──────────────────────────────────────────');
  const pm: Probe = { content: true, chatCalls: [], listCalls: [] };
  const m = await openPage(390, pm);
  await m.page.evaluate(() => {
    const tr = [...document.querySelectorAll('tbody > tr')].find(r => r.textContent?.includes('2 คำตอบ'));
    (tr as HTMLElement | undefined)?.click();
  });
  await m.page.waitForFunction(() => document.body.innerText.includes('บทสนทนาของ request นี้'), { timeout: 5000 }).catch(() => {});
  const geo = await m.page.evaluate(() => {
    const head = [...document.querySelectorAll('b')].find(b => b.textContent === 'บทสนทนาของ request นี้');
    const panel = head?.closest('div.px-4') as HTMLElement | null;
    const scroller = panel?.closest('.overflow-x-auto') as HTMLElement | null;
    const before = panel?.getBoundingClientRect();
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
    const after = panel?.getBoundingClientRect();
    return {
      vw: window.innerWidth, docW: document.documentElement.scrollWidth,
      scrolled: scroller ? scroller.scrollLeft : -1,
      before: before ? { l: before.left, r: before.right } : null,
      after: after ? { l: after.left, r: after.right } : null,
    };
  });
  ok('g. แผงที่กางกว้างไม่เกินจอ และหน้าไม่เลื่อนแนวนอน',
    !!geo.before && geo.before.l >= 0 && geo.before.r <= geo.vw + 0.5 && geo.docW <= geo.vw, JSON.stringify(geo.before) + ` docW=${geo.docW}`);
  ok('g. เลื่อนตารางไปขวาแล้วแผงยังติดขอบซ้ายอยู่ในจอ (sticky)',
    geo.scrolled > 0 && !!geo.after && geo.after.l >= 0 && geo.after.r <= geo.vw + 0.5, `scroll ${geo.scrolled} · ${JSON.stringify(geo.after)}`);
  await shot(m.page, 'admin-390-expanded', false);
  ok('   ไม่มี error หลุดจากหน้าเว็บ', m.errors.length === 0, m.errors.join(' | '));
  await m.page.close();

  // ภาพธีมสว่าง (ดูด้วยตา — ไม่มี assert สี)
  if (SHOTS) {
    const l = await openPage(1280, { content: true, chatCalls: [], listCalls: [] }, 'light');
    await l.page.evaluate(() => {
      const tr = [...document.querySelectorAll('tbody > tr')].find(r => r.textContent?.includes('2 คำตอบ'));
      (tr as HTMLElement | undefined)?.click();
    });
    await sleep(500);
    await shot(l.page, 'admin-1280-light-expanded');
    await l.page.close();
    console.log(`\n  ภาพอยู่ที่ ${SHOTS}`);
  }
} finally {
  await browser.close();
}

console.log(`\n${fail === 0 ? '✅ ผ่านทั้งหมด' : `❌ ล้ม ${fail} ข้อ`}`);
if (fail > 0) process.exit(1);
