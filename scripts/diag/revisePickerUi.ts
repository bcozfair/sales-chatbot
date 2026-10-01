/* ─────────────────────────────────────────────────────────────────────────────
   ช่องเลือกใบที่จะแก้ไข (revise) ในหน้าขอใบเสนอราคา — แบบ A ของ mockup `quote-revise-picker`
   (เจ้าของเคาะ 2026-10-01 · frontend/src/admin/RevisePicker.tsx · GET /api/admin/webquote/revisable)

   สิ่งที่พิสูจน์:
     ก. API (อ่านอย่างเดียว)
        · หนึ่งเลขฐาน = หนึ่งแถว · ไม่มีใบยกเลิก/ใบร่าง
        · **แถวที่ได้ = ใบที่ revise จะหยิบจริง** — ค้นด้วยเลขฐานของใบที่เคยแก้ แล้วเทียบกับ
          loadActiveQuotation() ตัวจริง (ถ้าสองตัวนี้ไม่ตรงกัน คนกดใบหนึ่งแต่ระบบแก้อีกใบ)
        · ไม่ส่ง mine = ทั้งหมด · mine=1 ยอด = mine_total · limit ถูกหนีบที่ 50
        · subadmin "ใบของฉัน" = เฉพาะใบที่ออกจากบัญชีตัวเอง (ขอบเขตเดียวกับหน้าประวัติ)
     ข. หน้าจอ (1280 / 390)
        · เปิดมาเจอ "ใบของฉัน" · คลิกช่องแล้วเห็นใบทันทีโดยไม่ต้องพิมพ์ · ค้นชื่อบริษัทได้
        · ป้าย R02 + ป้ายเหลือง "เข้า Odoo แล้ว" (ใส่ลงคำตอบในเบราว์เซอร์ — ไม่พึ่งว่าฐานมีใบแบบนั้น)
        · พิมพ์เลขที่ที่ไม่อยู่ในรายการ ⇒ มีแถว "ใช้เลขที่ … ตามที่พิมพ์" (ทางเดิมไม่หาย)
        · เลือกแล้วมีการ์ดสรุป · ใบว่างไม่เตือน · มีรายการค้างแล้วเตือน "จะถูกแทนที่"
        · กดเตรียมใบแก้ไขแล้วช่องล้างตัวเอง + แถบ "revision ของ …" ขึ้น
        · 390px ไม่มีเลื่อนซ้ายขวา · ไม่มี error ในหน้า

   **ไม่เขียนฐานเลย** — ทุกคำขอที่ไม่ใช่ GET ถูกดักในเบราว์เซอร์ (`/revise` ตอบปลอมเป็นร่างหนึ่งบรรทัด)
   ต้องมี API ของทรีนี้รันอยู่ที่ RP_PORT (ค่าเริ่มต้น 3099) — **ห้ามใช้ 5180**:
     npm --prefix frontend run build
     PORT=3099 PREVIEW_MODE=1 npx tsx index.ts
     npm run diag:revise-picker            (RP_SHOTS=<โฟลเดอร์> = เก็บภาพหน้าจอไว้ดูด้วยตา · RP_THEME=light)
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type HTTPRequest, type Page } from 'puppeteer';
import jwt from 'jsonwebtoken';
import { join } from 'node:path';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { loadActiveQuotation } from '../../services/quotationAgent.js';

const PORT = Number(process.env.RP_PORT ?? 3099);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.RP_SHOTS;
/** ธีมของหน้าจอ — ค่าเริ่มต้นตามแอป · `RP_THEME=light` ไว้ดูธีมสว่างด้วยตา (ข้อตรวจเหมือนกันทุกข้อ) */
const THEME = process.env.RP_THEME;
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail?: string) => {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? GREEN + '✓' : RED + '✗'}${RESET}  ${label}${detail ? `${DIM}  —  ${detail}${RESET}` : ''}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

if ([5174, 5180, 3011].includes(PORT)) {
  console.error(`ไม่รันกับ ${PORT} — 5174 = mockup · 5180 = พรีวิวร่วม · 3011 = แอปตัวจริง`);
  process.exit(1);
}
try {
  await fetch(`${BASE}/__preview/boot`);
} catch {
  console.error(`ไม่มีเซิร์ฟเวอร์ที่ ${BASE} — เปิดด้วย  PORT=${PORT} PREVIEW_MODE=1 npx tsx index.ts  ในทรีของงานนี้ก่อน`);
  process.exit(1);
}

const { rows: admins } = await pool.query(`SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`);
const { rows: subs } = await pool.query(
  `SELECT a.id, a.username, a.name, a.role
     FROM admin_users a
    WHERE a.role = 'subadmin'
      AND EXISTS (SELECT 1 FROM quotations q WHERE q.user_id LIKE 'web:' || a.id || ':%' AND q.quotation_no IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM admin_user_salespersons x WHERE x.admin_user_id = a.id)
    ORDER BY a.id LIMIT 1`
);
const admin = admins[0];
if (!admin) { console.error('ไม่มีบัญชี admin ในฐานนี้'); process.exit(1); }
const tokenOf = (a: any) => jwt.sign({ id: a.id, username: a.username, name: a.name, role: a.role }, getJwtSecret(), { expiresIn: '1h' });
const api = async (a: any, path: string) => {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${tokenOf(a)}` } });
  return { status: res.status, body: await res.json() };
};
const baseOf = (no: string) => no.replace(/^((?:QP|QT)-\d+)-\d+$/i, '$1');

/* ── ก. API ─────────────────────────────────────────────────────────────── */
console.log('── API ──────────────────────────────────────────────');
{
  const all = (await api(admin, '/api/admin/webquote/revisable?mine=0&limit=50')).body;
  ok('ไม่ส่ง mine=1 = ทั้งหมด · view_all ของ admin', all.scope === 'all' && all.view_all === true, `${all.total} ใบ`);
  const bases = all.data.map((r: any) => baseOf(r.quotation_no));
  ok('หนึ่งเลขฐาน = หนึ่งแถว', new Set(bases).size === bases.length && bases.length > 0, `${bases.length} แถว`);
  const { rows: st } = await pool.query(`SELECT status, quotation_no FROM quotations WHERE id = ANY($1::uuid[])`, [all.data.map((r: any) => r.id)]);
  ok('ไม่มีใบยกเลิก/ใบร่าง', st.length === all.data.length && st.every((r: any) => r.status !== 'cancelled' && r.quotation_no),
    st.map((r: any) => r.status).filter((s: string) => s !== 'confirmed').join(',') || 'confirmed ทั้งหมด');
  const big = (await api(admin, '/api/admin/webquote/revisable?mine=0&limit=500')).body;
  ok('limit ถูกหนีบที่ 50', big.data.length <= 50, `${big.data.length}`);
  const { rows: [live] } = await pool.query(
    `SELECT COUNT(DISTINCT substring(quotation_no from '^[A-Za-z]+-[0-9]+'))::int AS n
       FROM quotations WHERE quotation_no IS NOT NULL AND status <> 'cancelled'`);
  ok('ยอดทั้งหมด = จำนวนเลขฐานที่ยังใช้งานอยู่ (นับสด)', all.total === live.n, `${all.total} = ${live.n}`);

  // ใบที่เคยแก้ — ค้นด้วยเลขฐาน (เลขที่คนจำได้) ต้องได้ใบเดียวกับที่ revise จะหยิบจริง
  const { rows: revised } = await pool.query(
    `SELECT DISTINCT substring(quotation_no from '^[A-Za-z]+-[0-9]+') AS base
       FROM quotations WHERE quotation_no ~ '^[A-Za-z]+-[0-9]+-[0-9]+$' ORDER BY 1 DESC LIMIT 8`);
  let same = 0;
  const diff: string[] = [];
  for (const { base } of revised) {
    const r = (await api(admin, `/api/admin/webquote/revisable?mine=0&q=${encodeURIComponent(base)}`)).body;
    const hit = r.data.filter((x: any) => baseOf(x.quotation_no) === base);
    const active = await loadActiveQuotation(base);
    const want = active && active.status !== 'cancelled' ? active.quotation_no : null;
    if ((hit[0]?.quotation_no ?? null) === want && hit.length <= 1) same++;
    else diff.push(`${base}: รายการ ${hit.map((x: any) => x.quotation_no).join('/') || '-'} · revise หยิบ ${want ?? '-'}`);
  }
  ok('ค้นเลขฐานของใบที่เคยแก้ ⇒ ได้ใบเดียวกับที่ revise หยิบจริง (loadActiveQuotation)',
    revised.length > 0 && same === revised.length, diff[0] ?? `${same}/${revised.length} เลข`);

  const mine = (await api(admin, '/api/admin/webquote/revisable?mine=1&limit=1')).body;
  ok('mine=1 ยอด = ตัวเลขบนปุ่ม "ใบของฉัน"', mine.scope === 'own' && mine.total === all.mine_total, `${mine.total} = ${all.mine_total}`);

  const sub = subs[0];
  if (sub) {
    const m = (await api(sub, '/api/admin/webquote/revisable?mine=1&limit=50')).body;
    ok(`subadmin #${sub.id} "ใบของฉัน" = เฉพาะใบที่ออกจากบัญชีตัวเอง`,
      m.data.length > 0 && m.data.every((r: any) => r.channel === 'web'),
      `${m.total} ใบ`);
    const { rows: own } = await pool.query(`SELECT user_id FROM quotations WHERE id = ANY($1::uuid[])`, [m.data.map((r: any) => r.id)]);
    ok(`  ทุกแถวเป็น web:${sub.id}:…`, own.every((r: any) => String(r.user_id).startsWith(`web:${sub.id}:`)));
  } else {
    ok('(ข้าม) ไม่มี subadmin ที่ไม่ผูกเซลส์และมีใบของตัวเองบนฐานนี้', true);
  }
  const noAuth = await fetch(`${BASE}/api/admin/webquote/revisable`);
  ok('ไม่มี token ⇒ 401', noAuth.status === 401, String(noAuth.status));
}

/* ── ข. หน้าจอ ─────────────────────────────────────────────────────────── */
console.log('\n── หน้าจอ ──────────────────────────────────────────────');
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
let reviseCalls = 0;
let otherWrites = 0;
/** แถวแรกของคำตอบ = ใบที่เคยแก้ 2 ครั้ง และส่งออก Odoo แล้ว — ป้ายต้องขึ้นไม่ว่าฐานมีใบแบบนี้หรือไม่ */
const injectRow = (body: any) => {
  if (body?.data?.[0]) Object.assign(body.data[0], { revision: 2, odoo_exported_at: '2026-09-30T03:00:00Z' });
  return body;
};
const REVISE_MOCK = {
  web_user_id: 'web:0:diag', sp_user_id: '', draft_quote_id: 'diag', revise_from: 'QP-DIAG',
  quotes: [{ id: 'diag', items: [{ model: 'DIAG-1', name: 'DIAG-1', quantity: 2, price: 100 }], customer_id: null }],
};

const open = async (width: number): Promise<{ page: Page; errors: string[] }> => {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e instanceof Error ? e.message : String(e)));
  await page.setRequestInterception(true);
  page.on('request', (r: HTTPRequest) => {
    const url = r.url();
    if (r.method() !== 'GET' && url.includes('/api/')) {
      if (url.endsWith('/api/admin/webquote/revise')) {
        reviseCalls++;
        return void r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(REVISE_MOCK) });
      }
      otherWrites++;
      return void r.respond({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (url.includes('/api/admin/webquote/revisable?')) {
      void fetch(url, { headers: r.headers() })
        .then((x) => x.json())
        .then((b) => r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(injectRow(b)) }));
      return;
    }
    void r.continue();
  });
  await page.evaluateOnNewDocument((t: string, u: string) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', u);
  }, tokenOf(admin), JSON.stringify({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }));
  if (THEME) await page.evaluateOnNewDocument((t: string) => { try { localStorage.setItem('admin-theme', t); } catch { /* about:blank */ } }, THEME);
  await page.setViewport({ width, height: 900 });
  await page.goto(`${BASE}/admin.html#quoterequest`, { waitUntil: 'networkidle0' });
  await wait(500);
  return { page, errors };
};
const settle = async (page: Page) => {
  await wait(450);
  await page.waitForNetworkIdle({ idleTime: 250, timeout: 15000 }).catch(() => {});
  await wait(100);
};
const SECTION = `[...document.querySelectorAll('h3')].find((h) => h.textContent?.includes('แก้ไขใบที่ออกไปแล้ว'))?.closest('.rounded-2xl')`;
const sectionText = (page: Page) => page.evaluate(`(${SECTION})?.innerText ?? ''`) as Promise<string>;
const openCombo = (page: Page) => page.evaluate(() => (document.querySelector('[aria-label="เลือกใบที่จะแก้ไข"]') as HTMLElement | null)?.click());
const listRows = (page: Page) => page.evaluate(`[...(${SECTION})?.querySelectorAll('.max-h-64 > button') ?? []].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`) as Promise<string[]>;
const typeQuery = async (page: Page, q: string) => {
  const input = await page.$('[aria-label="เลือกใบที่จะแก้ไข"] input');
  await input!.focus();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (q) await input!.type(q);
  await settle(page);
};
const clickText = (page: Page, text: string) => page.evaluate((t: string) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim().includes(t) && (x as HTMLElement).offsetParent) as HTMLButtonElement | undefined;
  b?.click();
  return !!b;
}, text);
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = (page: Page, name: string) => SHOTS ? page.screenshot({ path: join(SHOTS, `${name}.png`) }) : Promise.resolve();

try {
  for (const width of [1280, 390]) {
    console.log(`\n── ${width}px ──`);
    const { page, errors } = await open(width);
    await settle(page);
    const pressedMine = await page.evaluate(`[...(${SECTION})?.querySelectorAll('button[aria-pressed="true"]') ?? []].map((b) => b.innerText)`) as string[];
    ok('เปิดมาเจอ "ใบของฉัน"', pressedMine.some((t) => t.includes('ใบของฉัน')), pressedMine.join(' | '));

    // admin ส่วนใหญ่ไม่ได้ออกใบเอง — สลับไป "ทั้งหมด" ให้มีใบให้ทดสอบเสมอ
    await page.evaluate(`[...(${SECTION})?.querySelectorAll('button[aria-pressed]') ?? []].find((b) => b.innerText.includes('ทั้งหมด'))?.click()`);
    await settle(page);
    await openCombo(page);
    await settle(page);
    let rows = await listRows(page);
    await shot(page, `list-${width}`);
    ok('คลิกช่องแล้วเห็นใบทันทีโดยไม่ต้องพิมพ์', rows.length > 0, `${rows.length} แถว`);
    ok('แถวแรกมีป้าย R02 และ "เข้า Odoo แล้ว"', /R02/.test(rows[0] ?? '') && (rows[0] ?? '').includes('เข้า Odoo แล้ว'), rows[0]);
    const text = await sectionText(page);
    ok('บอกว่าเป็นฉบับล่าสุดของแต่ละเลข', text.includes('ฉบับล่าสุดของแต่ละเลข'));

    // ชื่อลูกค้า = ช่องที่สามของแถว (บรรทัดล่างซ้าย) ของแถวที่สอง — ตัดก่อน " · ผู้ติดต่อ"
    const company = (await page.evaluate(`(${SECTION})?.querySelectorAll('.max-h-64 > button')[1]?.querySelector('.grid > span:nth-child(3)')?.innerText ?? ''`) as string)
      .split(' · ')[0].slice(0, 14);
    await typeQuery(page, company);
    rows = await listRows(page);
    ok(`ค้นชื่อบริษัท "${company}" ได้`, company.length > 0 && rows.length > 0 && rows.every((r) => r.includes(company)), `${rows.length} แถว`);
    await typeQuery(page, 'QP-999999999');
    await shot(page, `typed-${width}`);
    const action = await page.evaluate(`[...(${SECTION})?.querySelectorAll('button') ?? []].some((b) => b.innerText.includes('ใช้เลขที่ QP-999999999'))`);
    ok('พิมพ์เลขที่ที่ไม่อยู่ในรายการ ⇒ มีแถว "ใช้เลขที่ … ตามที่พิมพ์"', action === true);

    await typeQuery(page, '');
    await page.keyboard.press('Enter');
    await wait(200);
    let t = await sectionText(page);
    await shot(page, `picked-${width}`);
    ok('เลือกแล้วมีการ์ดสรุป + ปุ่มเตรียมใบแก้ไข', t.includes('เตรียมใบแก้ไข') && t.includes('ยอดรวม ฿'));
    ok('ใบยังว่าง ⇒ ไม่เตือนเรื่องแทนที่', !t.includes('จะถูกแทนที่'));
    ok('ไม่ล้นแนวนอน (การ์ดสรุป)', await noOverflow(page));

    await clickText(page, 'เตรียมใบแก้ไข');
    await settle(page);
    t = await sectionText(page);
    const banner = await page.evaluate(() => document.body.innerText.includes('revision ของ QP-DIAG'));
    ok('กดแล้วยิง /revise หนึ่งครั้ง · ช่องล้างตัวเอง · แถบ "revision ของ …" ขึ้น',
      reviseCalls >= 1 && !t.includes('เปลี่ยนใบ') && banner, `revise ${reviseCalls} · banner ${banner}`);

    await openCombo(page);
    await settle(page);
    await page.keyboard.press('Enter');
    await wait(200);
    t = await sectionText(page);
    await shot(page, `replace-${width}`);
    ok('มีรายการค้างอยู่ ⇒ เตือน "รายการ 1 บรรทัด … จะถูกแทนที่"', t.includes('รายการ 1 บรรทัดที่อยู่ในใบตอนนี้จะถูกแทนที่'));
    ok('ไม่ล้นแนวนอน', await noOverflow(page));
    ok('ไม่มี error ในหน้า', errors.length === 0, errors[0]);
    await page.close();
  }
  console.log(`${DIM}(คำขอเขียนอื่นที่ถูกดักไว้ในเบราว์เซอร์: ${otherWrites} — ไม่มีอะไรถึงเซิร์ฟเวอร์)${RESET}`);
} finally {
  await browser.close();
  await pool.end();
}

console.log(`\n${fail === 0 ? GREEN : RED}${pass} ผ่าน · ${fail} ไม่ผ่าน${RESET}`);
process.exit(fail === 0 ? 0 : 1);
