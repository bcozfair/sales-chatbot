/* ─────────────────────────────────────────────────────────────────────────────
   ขั้น 0 + 2 ของการยืนยันตัวตน LIFF — "ตรวจแล้วนับ ไม่บล็อก" (เจ้าของสั่ง 2026-10-07)

   ครอบ:
     1. รายการเส้นที่สังเกต — ทุก /api ที่หน้า LIFF สามหน้าเรียก ต้องอยู่ในรายการ (อ่านจากซอร์ส HTML)
        · เส้นที่บังคับแล้ว / ของแอดมิน / webhook ไม่อยู่
     2. ตัดสินผล (classifyObservation) ครบทุกแบบ · token แอดมินแยกออกจาก token ของ LINE
     3. middleware ไม่บล็อก: เรียก next() ทันทีครั้งเดียว · ไม่ผูกอะไรกับเส้นที่ไม่สังเกต · พังแล้วไม่ throw
     4. ตัวนับในฐาน: บวกต่อแถวเดิม · เก็บคู่ userId เฉพาะ mismatch — ตารางชั่วคราว + ROLLBACK (ไม่เขียนของจริง)
     5. หน้า LIFF ตัวจริงสามหน้า (LIFF SDK + API จำลอง): ทุก request ไป /api แนบ Bearer token ·
        ยังไม่มี token = ไม่แนบ · ไม่มีหน้าไหนพัง
     6. หน้าแอดมิน: เส้นที่ใช้ร่วมกับ LIFF ต้องเรียกผ่าน sharedApiFetch (อ่านซอร์ส) + ตัวช่วยแนบ token จริง

   **ไม่เขียน DB** · ไม่ยิง LINE · รัน: npm run diag:liff-auth
   ───────────────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import puppeteer, { type HTTPRequest } from 'puppeteer';
import { pool } from '../../config/db.js';
import {
  OBSERVED_ROUTES, observedRouteLabel, classifyObservation, isAdminJwt, observeLiffIdentity,
} from '../../config/liffAuthObserve.js';
import { recordLiffAuthObservation } from '../../db/liffAuthObservationsRepo.js';

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LIFF_PAGES = ['product-search.html', 'quote-edit.html', 'register.html'];
/** เส้นที่บังคับตัวตนแล้ว — ไม่ต้องสังเกต */
const ENFORCED = new Set(['/api/liff/discount-history']);

// ── 1. รายการเส้น ────────────────────────────────────────────────────────────
console.log('\n── 1. เส้นที่สังเกต ──');
{
  const found = new Set<string>();
  for (const f of LIFF_PAGES) {
    const src = fs.readFileSync(path.resolve('liff_pages', f), 'utf8');
    for (const m of src.matchAll(/["'`](\/api\/[^"'`?\s]+)/g)) {
      found.add(m[1].replace(/\$\{[^}]+\}/g, 'X').replace(/\/+$/, ''));
    }
  }
  const missing = [...found].filter((p) => !ENFORCED.has(p) && !['GET', 'POST', 'PUT'].some((mth) => observedRouteLabel(mth, p)));
  ok(`ทุก /api ในหน้า LIFF อยู่ในรายการ (${found.size} เส้นจากซอร์ส)`, found.size >= 15 && missing.length === 0, missing.join(' · '));
  ok('รายการไม่มีชื่อซ้ำ', new Set(OBSERVED_ROUTES.map((r) => r.label)).size === OBSERVED_ROUTES.length);
  const notObserved: [string, string][] = [
    ['GET', '/api/liff/discount-history'], ['GET', '/api/admin/webquote/discount-history'], ['POST', '/callback'],
    ['GET', '/api/liff/config'], ['GET', '/api/quotation/abc'], ['GET', '/api/products/search/extra'],
  ];
  ok('ไม่สังเกตเส้นที่บังคับแล้ว / ของแอดมิน / webhook', notObserved.every(([m, p]) => observedRouteLabel(m, p) === null));
  ok('label ไม่มีเลขใบ/รหัส', observedRouteLabel('PUT', '/api/quotation/7f3a-11') === 'PUT /api/quotation/:id'
    && observedRouteLabel('GET', '/api/salesperson/U123') === 'GET /api/salesperson/:userId'
    && observedRouteLabel('POST', '/api/quotation/7f3a/cancel') === 'POST /api/quotation/:id/cancel');
}

// ── 2. ตัดสินผล ─────────────────────────────────────────────────────────────
console.log('\n── 2. ตัดสินผล ──');
{
  const okId = { ok: true as const, userId: 'Ua' };
  const cases: [string, ReturnType<typeof classifyObservation>['outcome'], ReturnType<typeof classifyObservation>][] = [
    ['ไม่มี token', 'none', classifyObservation('', false, 'Ua', null)],
    ['token แอดมิน', 'admin', classifyObservation('jwt', true, 'web:1:2', null)],
    ['token LINE ตรง', 'match', classifyObservation('t', false, 'Ua', okId)],
    ['token LINE ไม่ตรง', 'mismatch', classifyObservation('t', false, 'Ub', okId)],
    ['token LINE ไม่มี userId จากหน้า', 'no_claim', classifyObservation('t', false, null, okId)],
    ['token เสีย', 'bad_token', classifyObservation('t', false, 'Ua', { ok: false, code: 'BAD_TOKEN' })],
    ['ถาม LINE ไม่ได้', 'verify_failed', classifyObservation('t', false, 'Ua', { ok: false, code: 'VERIFY_FAILED' })],
  ];
  for (const [name, want, got] of cases) ok(`${name} → ${want}`, got.outcome === want, got.outcome);
  const mm = classifyObservation('t', false, 'Ub', okId);
  ok('mismatch เก็บคู่ userId · แบบอื่นไม่เก็บ', mm.claimedUser === 'Ub' && mm.tokenUser === 'Ua'
    && cases.filter(([, w]) => w !== 'mismatch').every(([, , g]) => g.claimedUser === null && g.tokenUser === null));
  const secret = 'diag-secret';
  ok('token แอดมินที่เซ็นด้วย secret เรา → admin', isAdminJwt(jwt.sign({ id: 1 }, secret), secret));
  ok('JWT ของที่อื่น (secret อื่น) → ไม่ใช่แอดมิน', !isAdminJwt(jwt.sign({ id: 1 }, 'other'), secret));
  ok('ไม่มี id ตัวเลข → ไม่ใช่แอดมิน', !isAdminJwt(jwt.sign({ sub: 'x' }, secret), secret));
  ok('ข้อความมั่ว → ไม่ใช่แอดมิน', !isAdminJwt('not-a-jwt', secret));
}

// ── 3. middleware ไม่บล็อก ─────────────────────────────────────────────────────
console.log('\n── 3. middleware ──');
{
  const run = (method: string, p: string, badPath = false) => {
    let nexted = 0; const hooks: string[] = [];
    const req: any = { method, headers: {} };
    Object.defineProperty(req, 'path', { get: () => { if (badPath) throw new Error('boom'); return p; } });
    const res: any = { once: (ev: string) => { hooks.push(ev); } };
    let threw = false;
    try { observeLiffIdentity(req, res, () => { nexted++; }); } catch { threw = true; }
    return { nexted, hooks, threw };
  };
  const a = run('GET', '/api/products/search');
  ok('เส้นที่สังเกต → next() ทันที 1 ครั้ง + ผูก finish', a.nexted === 1 && a.hooks.join() === 'finish' && !a.threw);
  const b = run('GET', '/api/admin/whatever');
  ok('เส้นอื่น → next() ทันที ไม่ผูกอะไร', b.nexted === 1 && b.hooks.length === 0);
  const c = run('GET', '/x', true);
  ok('ข้างในพัง → ไม่ throw และยังเรียก next()', c.nexted === 1 && !c.threw);
}

// ── 4. ตัวนับในฐาน (ตารางชั่วคราว + ROLLBACK) ──────────────────────────────────
console.log('\n── 4. ตัวนับในฐาน ──');
{
  const ddl = fs.readFileSync(path.resolve('migrations/changes/2026-10-07_01_liff_auth_observations.sql'), 'utf8')
    .replace(/CREATE TABLE IF NOT EXISTS liff_auth_observations/, 'CREATE TEMP TABLE liff_auth_observations');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(ddl);   // ตารางชั่วคราวบังตารางจริง (SQL ใน repo ไม่ใส่ public.)
    await recordLiffAuthObservation('GET /api/x', 'match', null, null, client);
    await recordLiffAuthObservation('GET /api/x', 'match', null, null, client);
    await recordLiffAuthObservation('GET /api/x', 'mismatch', 'Ub', 'Ua', client);
    await recordLiffAuthObservation('GET /api/x', 'mismatch', null, null, client);
    const { rows } = await client.query(`SELECT outcome, n, last_claimed_user, last_token_user,
        day = (now() AT TIME ZONE 'Asia/Bangkok')::date AS today FROM liff_auth_observations ORDER BY outcome`);
    const m = rows.find((r) => r.outcome === 'match');
    const mm = rows.find((r) => r.outcome === 'mismatch');
    ok('บวกต่อแถวเดิมของวันเดียวกัน', m?.n === 2 && mm?.n === 2 && rows.length === 2, JSON.stringify(rows.map((r) => [r.outcome, r.n])));
    ok('วันที่เป็นวันไทย', rows.every((r) => r.today));
    ok('คู่ userId ของ mismatch ไม่ถูกลบทิ้งโดยแถวถัดไป', mm?.last_claimed_user === 'Ub' && mm?.last_token_user === 'Ua');
    ok('แถว match ไม่มี userId', m?.last_claimed_user === null && m?.last_token_user === null);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
await pool.end();

// ── 5. หน้า LIFF จริง ───────────────────────────────────────────────────────
console.log('\n── 5. หน้า LIFF แนบ token ──');
const TOKEN = 'diag-line-access-token';
const stub = (token: string | null) => `window.liff = {
  init: async () => {}, isLoggedIn: () => true, isInClient: () => false, login() {},
  getAccessToken: () => ${JSON.stringify(token)},
  getProfile: async () => ({ userId: 'Udiag' }), closeWindow() {}, sendMessages: async () => {},
};`;
const QUOTE = {
  id: 'q1', status: 'draft', user_id: 'Udiag', customer_id: 111, contact_id: 1,
  customer_name: 'บริษัท ทดสอบ | คุณก', payment_terms: '30 Days', quote_company: 'PM',
  items: [{ product_code: 'DIAG-1', model: 'DIAG-1', name: 'ทดสอบ', price: 100, quantity: 1 }],
};
async function capture(page: string, query: string, token: string | null) {
  const browser = await puppeteer.launch({ headless: true });
  const p = await browser.newPage();
  await p.setViewport({ width: 390, height: 900 });
  const errs: string[] = [];
  const seen: { path: string; auth: string }[] = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.setRequestInterception(true);
  p.on('request', (req: HTTPRequest) => {
    const u = new URL(req.url());
    const json = (body: any) => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.host === 'liff.test' && u.pathname === `/${page}`) {
      return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.resolve('liff_pages', page), 'utf8') });
    }
    if (u.host.endsWith('line-scdn.net')) return req.respond({ status: 200, contentType: 'text/javascript', body: stub(token) });
    if (u.host !== 'liff.test') return req.abort();
    // นับเฉพาะ /api — favicon.ico ฯลฯ เบราว์เซอร์ขอเองไม่ผ่าน fetch ของหน้า
    if (u.pathname.startsWith('/api/')) seen.push({ path: `${req.method()} ${u.pathname}`, auth: req.headers()['authorization'] ?? '' });
    if (u.pathname === '/api/quotations') return json([QUOTE]);
    if (u.pathname === '/api/salesperson/Udiag') return json({ user_id: 'Udiag', name: 'ทดสอบ', status: 'active' });
    if (/contacts|search|salespeople|branches/.test(u.pathname)) return json([]);
    if (u.pathname === '/api/liff/discount-history') return json({ discount: null });
    return req.respond({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await p.goto(`http://liff.test/${page}?${query}`, { waitUntil: 'domcontentloaded' });
  await wait(2500);
  await browser.close();
  return { seen, errs };
}
for (const [page, query] of [
  ['quote-edit.html', 'quoteIds=q1&userId=Udiag'],
  ['product-search.html', 'userId=Udiag&q=DIAG'],
  ['register.html', 'userId=Udiag'],
] as const) {
  const { seen, errs } = await capture(page, query, TOKEN);
  const bad = seen.filter((s) => s.auth !== `Bearer ${TOKEN}`);
  ok(`${page}: ทุก request แนบ token (${seen.length} ครั้ง)`, seen.length > 0 && bad.length === 0,
    `${[...new Set(seen.map((s) => s.path))].join(' · ')}${bad.length ? ' | ไม่แนบ: ' + bad.map((b) => b.path).join(', ') : ''}`);
  ok(`${page}: หน้าไม่พัง`, errs.length === 0, errs.join(' | '));
  const none = await capture(page, query, null);
  ok(`${page}: ยังไม่มี token → ไม่แนบ (และยังทำงาน)`, none.seen.length > 0 && none.seen.every((s) => s.auth === ''), String(none.seen.length));
}

// ── 6. หน้าแอดมิน ────────────────────────────────────────────────────────────
console.log('\n── 6. หน้าแอดมิน ──');
{
  const SHARED = /fetch\(\s*[`'"]\/api\/(products\/search|customers\/search|customer\/|shipping-fee\/config|salespeople|quotation\/|quotations|branches|salesperson\/)/;
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          if (SHARED.test(line) && !/sharedApiFetch\(/.test(line)) offenders.push(`${path.relative('.', f)}:${i + 1}`);
        });
      }
    }
  };
  walk(path.resolve('frontend/src'));
  ok('เส้นที่ใช้ร่วมกับ LIFF เรียกผ่าน sharedApiFetch ทุกจุด', offenders.length === 0, offenders.join(' · '));
  const n = fs.readdirSync(path.resolve('frontend/src/admin')).reduce((s, f) =>
    /\.(ts|tsx)$/.test(f) ? s + (fs.readFileSync(path.resolve('frontend/src/admin', f), 'utf8').match(/sharedApiFetch\(/g)?.length ?? 0) : s, 0);
  ok('จุดเรียกครบ 11 (+ ตัวนิยาม 1)', n === 12, String(n));

  // ตัวช่วยจริงในเบราว์เซอร์: แนบ token แอดมิน · ไม่ทับที่มีอยู่ · ไม่มี token = ไม่แนบ
  const src = fs.readFileSync(path.resolve('frontend/src/admin/sharedApiFetch.ts'), 'utf8')
    .replace(/export function/, 'function').replace(/\(input: string, init: RequestInit = \{\}\): Promise<Response>/, '(input, init = {})')
    .replace(/let token: string \| null;/, 'let token;');
  const browser = await puppeteer.launch({ headless: true });
  const p = await browser.newPage();
  // ต้องมี origin จริง — about:blank ใช้ sessionStorage ไม่ได้
  await p.setRequestInterception(true);
  p.on('request', (req) => req.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>diag</title>' }));
  await p.goto('http://admin.test/');
  const r = await p.evaluate(async (code: string) => {
    const seen: string[] = [];
    (window as any).fetch = async (_u: string, init: RequestInit) => { seen.push(new Headers(init.headers).get('Authorization') ?? ''); return new Response('{}'); };
    const fn = new Function(`${code}; return sharedApiFetch;`)();
    sessionStorage.setItem('admin_token', 'ADM');
    await fn('/api/products/search?q=a');
    await fn('/api/x', { headers: { Authorization: 'Bearer KEEP' } });
    sessionStorage.removeItem('admin_token');
    await fn('/api/products/search?q=b');
    return seen;
  }, src);
  await browser.close();
  ok('ตัวช่วยแนบ token แอดมิน · ไม่ทับของเดิม · ไม่มี token = ไม่แนบ',
    JSON.stringify(r) === JSON.stringify(['Bearer ADM', 'Bearer KEEP', '']), JSON.stringify(r));
}

console.log(fail === 0 ? '\nผ่านทุกข้อ' : `\nล้ม ${fail} ข้อ`);
process.exit(fail === 0 ? 0 : 1);
