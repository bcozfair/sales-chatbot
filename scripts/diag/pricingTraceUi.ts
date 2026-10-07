/* ─────────────────────────────────────────────────────────────────────────────
   เปิดหน้า "คำนวณราคา" จริงแล้วดูการ์ด "วิธีคำนวณราคา" — แบบ A "ใบเสร็จ + แถบข้าง" ที่เจ้าของเลือก 2026-10-07
   (mockup ชุด `ct-*` · คำตอบ: แบบ A · เปลี่ยนชื่อการ์ด · พับรายละเอียดไว้ · ที่มาในชีตเหลือแค่ตำแหน่งช่อง)

   **ไม่แตะฐานและไม่ต้องเปิดเซิร์ฟเวอร์** (ท่าเดียวกับ `diag:pricing-add-ui`): puppeteer เสิร์ฟ `public/` ที่ build แล้วเอง
   และตอบ `/api/*` เอง · **แต่ผลคิดราคาไม่ได้ปั้นมือ** — คิดจริงด้วย `computePrice` กับสมุดราคาจำลองในไฟล์นี้
   ⇒ ข้อความทุกบรรทัดบนการ์ดเป็นของเซิร์ฟเวอร์จริง (ด่านนี้พิสูจน์การจัดวาง · `diag:pricing-trace` พิสูจน์ข้อความกับเงิน)

   สิ่งที่พิสูจน์:
   1. ชื่อการ์ดใหม่ · ไม่มีชื่อเดิมค้าง
   2. ใบเสร็จมีเฉพาะก้อนที่คิดเงิน (ราคาตั้ง + กฎที่คิด) · ยอดท้ายใบ = `unitPrice` · รายละเอียดพับไว้ตอนเปิด
   3. กดแถว / "กางทุกแถว" แล้วเห็นขั้นตอน + ตำแหน่งช่องในชีต (ไม่ใช่ย่อหน้าเหตุผลของ source)
   4. กฎที่ไม่ได้คิดยังอยู่ — รวมเป็นกลุ่ม "ใบนี้ไม่มี" / "ไม่เกินมาตรฐาน" / "ปิดไว้ในสมุดราคา" บรรทัดเดียว
   5. ข้อห้าม: แยก "ผ่าน" กับ "ไม่เกี่ยวกับใบนี้" · ข้อที่ติดโชว์เต็ม
   6. ค่าที่ระบบเติมให้มีป้าย "ค่าตั้งต้น" · ขนาดที่พิมพ์มาบอกมาตรฐาน
   7. ต้องขอราคา = ยอดสีเหลือง "ยังไม่รวม N ข้อ" · คิดไม่ได้ = "คิดราคาไม่ได้" + ยังไม่ตรวจกฎ
   + ทุกกรณีที่ 390 / 640 / 641 / 1280 ไม่มีแถบเลื่อนแนวนอน · ภาพทั้งธีมมืดและสว่าง

   รัน: `npm run build --prefix frontend` ก่อน แล้ว `npm run diag:pricing-trace-ui`
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type HTTPRequest, type Page } from 'puppeteer';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import { computePrice } from '../../services/pricingLab/engine.js';
import type { PriceBook, ProductConfig } from '../../services/pricingLab/types.js';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const SHOTS = process.env.CT_SHOTS || fileURLToPath(new URL('../../mockups/shots/', import.meta.url));
const ORIGIN = 'http://ct-probe.local';
mkdirSync(SHOTS, { recursive: true });

let fail = 0;
const pageErrors: string[] = [];
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

// ── สมุดราคาจำลอง — ครบทุกสถานะที่การ์ดต้องวาด ──────────────────────────────
const book: PriceBook = {
  version: 'ct',
  source: 'diag',
  models: {
    'TOY-1': {
      code: 'TOY-1',
      label: 'รุ่นจำลอง',
      sheet: 'TOY',
      standard: { L1: 100, cable_m: 1 },
      axisDefaults: { cable: 'สแตนเลสถัก' },
      base: { kind: 'matrix', axes: ['D'], cells: { '6': 460 } },
      adders: [
        { id: 'len', label: 'ความยาวแกน L1', order: 10, kind: 'perUnit', dim: 'L1', step: 100, round: 'ceil', unit: 'mm', rate: 150,
          source: "TOY!B11 'บวกเพิ่ม 100 mm ละ' — เหตุผลยาวของการตั้งกฎที่ไม่ควรขึ้นการ์ด" },
        { id: 'cab', label: 'สายยาวเกิน 1 เมตร', order: 20, kind: 'perUnit', dim: 'cable_m', step: 1, round: 'ceil', unit: 'm',
          byAxis: 'cable', rates: { 'สแตนเลสถัก': 80 }, source: 'TOY!A32 + TOY2!A26:B29' },
        { id: 'bend', label: 'หัก L ดัดงอ', order: 30, kind: 'flat', amount: 100, when: { option: 'bend:L' } },
        { id: 'coat', label: 'หุ้มเทปล่อน', order: 40, kind: 'flat', amount: 120, when: { option: 'coat:teflon' } },
        { id: 'old', label: 'กฎที่ปิดไว้', order: 50, kind: 'flat', amount: 50, disabled: true },
      ],
      constraints: [
        { id: 'LONG', when: { dim: 'L1', gt: 2000 }, level: 'block', message: 'แกนยาวเกิน 2000 mm' },
        { id: 'E2', when: { all: [{ option: 'element:2' }, { dim: 'L1', lt: 60 }] }, level: 'block', message: '2 element ต้องยาว 60 mm ขึ้นไป' },
        { id: 'NUT', when: { option: 'nut' }, level: 'warn', message: 'ราคานี้ไม่รวมหน้าแปลนเชื่อม' },
      ],
    },
  },
};

const CASES: Record<string, ProductConfig> = {
  'TOY-1 6x150+6M': { model: 'TOY-1', axes: { D: '6' }, dims: { L1: 150, cable_m: 6 } },
  'TOY-1 9x250+1M': { model: 'TOY-1', axes: { D: '9' }, dims: { L1: 250, cable_m: 1 } },
  'TOY-1 x150-N': { model: 'TOY-1', axes: {}, dims: { L1: 150 }, options: ['nut'] },
};
const PRICED = 'TOY-1 6x150+6M', ASK = 'TOY-1 9x250+1M', BLOCK = 'TOY-1 x150-N';
const outcomes = Object.fromEntries(Object.entries(CASES).map(([c, cfg]) => [c, computePrice(cfg, book)]));

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
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
  if (path === '/api/admin/me/capabilities') return json(req, { capabilities: {} });
  if (path === '/api/admin/pricing/overview') {
    return json(req, { book: { ok: true, models: 1 }, version: 'ct', models: [], edited: null, catalog: [], catalogTs: [] });
  }
  if (path === '/api/admin/pricing/quote') {
    const code = String(JSON.parse(req.postData() ?? '{}').code ?? '').trim();
    const outcome = outcomes[code] ?? null;
    return json(req, { code, revision: 1, parsed: { input: code, normalized: code, parts: [], problems: [], warnings: [] }, outcome });
  }
  if (path.startsWith('/api/admin/drawing/')) return json(req, { error: 'ไม่ได้จำลองแบบ 3 มิติในด่านนี้' }, 404);
  if (path === '/api/admin/pricing/examples') return json(req, { total: 0, rows: [] });
  return json(req, {});
}

const TOKEN_PAYLOAD = Buffer.from(JSON.stringify({ id: 1, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const FAKE_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${TOKEN_PAYLOAD}.probe`;
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });

async function openPage(width: number): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 1000 });
  await page.setRequestInterception(true);
  page.on('request', (r) => { void route(r); });
  page.on('pageerror', (e: unknown) => { pageErrors.push(e instanceof Error ? e.message : String(e)); });
  await page.evaluateOnNewDocument('globalThis.__name = (f) => f;');
  await page.evaluateOnNewDocument((t: string) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', JSON.stringify({ id: 1, username: 'probe', name: 'Probe', role: 'admin' }));
  }, FAKE_TOKEN);
  await page.goto(`${ORIGIN}/admin.html?w=${width}#pricing`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#pl-code', { timeout: 15000 });
  await page.waitForNetworkIdle({ idleTime: 250, timeout: 15000 });
  return page;
}

/** พิมพ์รหัสแล้วกด Enter — รอจนการ์ดวาดผลของรหัสนั้น (ยอดท้ายใบเปลี่ยนตามสถานะ) */
async function quote(page: Page, code: string) {
  await page.click('#pl-code', { count: 3 });
  await page.type('#pl-code', code);
  await page.keyboard.press('Enter');
  const expect = code === PRICED ? 'ราคาต่อชิ้น' : code === ASK ? 'ต้องขอราคา · ยังไม่รวม' : 'คิดราคาไม่ได้';
  await page.waitForFunction((t: string) => {
    const h = [...document.querySelectorAll('h3')].find((x) => x.textContent?.trim() === 'วิธีคำนวณราคา');
    return !!(h?.closest('.rounded-2xl') as HTMLElement | null)?.innerText.includes(t);
  }, { timeout: 5000 }, expect);
  await page.waitForNetworkIdle({ idleTime: 250, timeout: 5000 });
}

const card = (page: Page) => page.evaluate(() => {
  const h = [...document.querySelectorAll('h3')].find((x) => x.textContent?.trim() === 'วิธีคำนวณราคา');
  const c = h?.closest('.rounded-2xl') as HTMLElement | null;
  const rows = [...(c?.querySelectorAll('ol > li') ?? [])] as HTMLElement[];
  return {
    found: !!c,
    oldTitle: [...document.querySelectorAll('h3')].some((x) => x.textContent?.includes('วิธีคำนวณทีละขั้น')),
    text: c?.innerText ?? '',
    rows: rows.map((r) => r.querySelector('button')?.innerText.replace(/\s+/g, ' ').trim() ?? ''),
    openDetails: rows.filter((r) => r.querySelector('ol ol, ol li ol, div ol')).length,
    hscroll: document.documentElement.scrollWidth > window.innerWidth,
  };
});

const clickText = (page: Page, label: string) => page.evaluate((l: string) => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === l) as HTMLButtonElement | undefined;
  b?.click();
  return !!b;
}, label);

const toggleTheme = async (page: Page) => {
  const before = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark');
  await page.evaluate(() => (document.getElementById('admin-theme-toggle-btn') as HTMLButtonElement | null)?.click());
  await page.waitForFunction((t: string) => (document.documentElement.dataset.theme ?? 'dark') !== t, { timeout: 3000 }, before);
  await new Promise((res) => setTimeout(res, 150));
};

const shoot = async (page: Page, name: string) => {
  await new Promise((res) => setTimeout(res, 250)); // ลูกศรหมุนมี transition — ถ่ายกลางทางแล้วหน้าตาเพี้ยน
  const el = await page.evaluateHandle(() => {
    const h = [...document.querySelectorAll('h3')].find((x) => x.textContent?.trim() === 'วิธีคำนวณราคา');
    return h?.closest('.rounded-2xl') ?? document.body;
  });
  await (el as unknown as { screenshot: (o: { path: string }) => Promise<unknown> }).screenshot({ path: join(SHOTS, `ct-${name}.png`) });
};

try {
  console.log('\nการ์ด "วิธีคำนวณราคา" — แบบ A ใบเสร็จ (เจ้าของเลือก 2026-10-07)');
  const p = outcomes[PRICED]!;
  ok('สมุดจำลองคิดได้ตามที่ตั้งใจ (460 + 150 + 400 = 1,010)', p.status === 'priced' && p.unitPrice === 1010, `${p.status} ${p.unitPrice}`);

  const page = await openPage(1280);
  await quote(page, PRICED);
  let c = await card(page);
  ok('1. ชื่อการ์ด "วิธีคำนวณราคา" · ไม่มีชื่อเดิม', c.found && !c.oldTitle);
  ok('2. ใบเสร็จ = ราคาตั้ง + 2 ก้อนที่คิด (กฎที่ไม่ได้คิดไม่ได้เป็นแถว)', c.rows.length === 3
    && c.rows[0]!.includes('ราคาตั้ง TOY-1') && c.rows[0]!.includes('ช่อง 6') && c.rows[0]!.includes('460')
    && c.rows[1]!.includes('เกิน 50 mm → 1 ช่วง × 150') && c.rows[1]!.includes('+150')
    && c.rows[2]!.includes('เกิน 5 m × 80 บาท') && c.rows[2]!.includes('+400'), c.rows.join(' | '));
  ok('2. ยอดท้ายใบ = unitPrice', /ราคาต่อชิ้น\s*1,010\s*บาท/.test(c.text), c.text.match(/ราคาต่อชิ้น[^\n]*\n?[^\n]*/)?.[0]);
  ok('2. รายละเอียดพับไว้ตอนเปิด', !c.text.includes('คิดทีละ 100 mm') && !c.text.includes('ที่มาในชีต:'));

  await page.evaluate(() => (document.querySelector('ol > li button') as HTMLButtonElement | null)?.click());
  c = await card(page);
  ok('3. กดแถวราคาตั้ง → เห็นขั้นตอนของแถวนั้นแถวเดียว', c.text.includes('ราคาตั้งรวมสเปกมาตรฐานไว้แล้ว') && !c.text.includes('คิดทีละ 100 mm'));
  ok('3. ปุ่ม "กางทุกแถว" มี', await clickText(page, 'กางทุกแถว'));
  c = await card(page);
  ok('3. กางทุกแถว → เห็นขั้นตอนทุกก้อน + ตำแหน่งช่องในชีต', c.text.includes('คิดทีละ 100 mm เศษปัดขึ้น') && c.text.includes('ที่มาในชีต: TOY!B11')
    && c.text.includes('ที่มาในชีต: TOY!A32 · TOY2!A26:B29'));
  ok('3. ไม่มีย่อหน้าเหตุผลของ source บนการ์ด (เหลือแค่ตำแหน่งช่อง)', !c.text.includes('เหตุผลยาวของการตั้งกฎ'));
  await shoot(page, 'priced-open-1280');
  ok('3. ปุ่มกลายเป็น "พับทุกแถว" แล้วพับได้', await clickText(page, 'พับทุกแถว'));
  c = await card(page);
  ok('3. พับแล้วขั้นตอนหาย', !c.text.includes('คิดทีละ 100 mm'));

  ok('4. กฎที่ไม่ได้คิดรวมเป็นกลุ่ม "ใบนี้ไม่มี (2)" บรรทัดเดียว', /ใบนี้ไม่มี \(2\)\s*หัก L ดัดงอ\s*หุ้มเทปล่อน/.test(c.text));
  ok('4. กฎที่ปิดไว้ยังโผล่ในกลุ่มของมัน', c.text.includes('ปิดไว้ในสมุดราคา') && c.text.includes('กฎที่ปิดไว้'));
  ok('5. ข้อห้ามพับเป็นบรรทัดเดียว แยกผ่าน/ไม่เกี่ยว', c.text.includes('ข้อห้าม 3 ข้อ — ผ่าน 1 · ไม่เกี่ยวกับใบนี้ 2'), c.text.match(/ข้อห้าม \d[^\n]*/)?.[0]);
  ok('6. ค่าที่ระบบเติมให้มีป้าย "ค่าตั้งต้น" · ขนาดที่พิมพ์มาบอกมาตรฐาน', c.text.includes('ค่าตั้งต้น') && c.text.includes('มาตรฐาน 100'));
  ok('ไม่มีแถบเลื่อนแนวนอน @1280', !c.hscroll);
  await shoot(page, 'priced-1280-dark');
  await toggleTheme(page);
  await shoot(page, 'priced-1280-light');
  await toggleTheme(page);

  await quote(page, ASK);
  c = await card(page);
  ok('7. ต้องขอราคา: ราคาตั้งเป็น "ยังไม่รวม" · ยอด 300+ · บอกจำนวนที่ยังไม่รวม',
    c.rows[0]!.includes('ยังไม่รวม') && /ต้องขอราคา · ยังไม่รวม 1 ข้อ\s*300\+\s*บาท/.test(c.text), c.rows.join(' | '));
  ok('4. สายเท่ามาตรฐาน → กลุ่ม "ไม่เกินมาตรฐาน" พร้อมค่าจริง', c.text.includes('ไม่เกินมาตรฐาน') && c.text.includes('ความยาวสาย 1 m เท่ากับมาตรฐาน'));
  await shoot(page, 'ask-1280-dark');

  await quote(page, BLOCK);
  c = await card(page);
  ok('7. คิดไม่ได้: ยอด "คิดราคาไม่ได้" · ยังไม่ตรวจกฎ · ข้อห้ามที่ติดโชว์เต็ม',
    c.text.includes('คิดราคาไม่ได้') && c.text.includes('ยังไม่ได้ตรวจกฎบวกเพิ่ม') && c.text.includes('ข้อควรรู้ — ราคานี้ไม่รวมหน้าแปลนเชื่อม'));
  ok('7. ค่าที่ไม่ได้ระบุโชว์ในรายการค่าที่ใช้คิด', c.text.includes('ไม่ได้ระบุ'));
  await shoot(page, 'block-1280-dark');
  await page.close();

  for (const w of [390, 640, 641]) {
    const pg = await openPage(w);
    for (const code of [PRICED, ASK, BLOCK]) {
      await quote(pg, code);
      await clickText(pg, 'กางทุกแถว');
      const s = await card(pg);
      ok(`ไม่มีแถบเลื่อนแนวนอน @${w} · ${code}`, s.found && !s.hscroll);
    }
    await quote(pg, PRICED);
    await clickText(pg, 'กางทุกแถว');
    await shoot(pg, `priced-open-${w}`);
    await pg.close();
  }
  ok('ไม่มี error ในหน้า', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  fail++;
  console.log('  ✗ ด่านหยุดกลางทาง ·', e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
}
console.log(`\nภาพ: ${SHOTS}ct-*.png`);
console.log(fail ? `\n✗ ไม่ผ่าน ${fail} ข้อ` : '\n✓ ผ่านทั้งหมด');
process.exit(fail ? 1 : 0);
