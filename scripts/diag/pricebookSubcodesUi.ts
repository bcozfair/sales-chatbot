/* ─────────────────────────────────────────────────────────────────────────────
   รหัสย่อยย้ายเข้าหน้าชีต + ตัวนับ "ยังอ่านไม่ออก" แบบสด (เจ้าของเคาะ mockup `pricebook-subcodes-sheet` 2026-09-29)

   เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md · หัว frontend/src/admin/pricingLab/SubCodePanels.tsx
   · services/pricingLab/subcodeView.ts

   สิ่งที่พิสูจน์ (build ผ่านทั้งที่ของพวกนี้พังได้ — AGENTS.md A9):
     ก. ตัวนับ (ในโปรเซสนี้ ไม่ผ่าน HTTP)
        · ระหว่างนับ event loop ไม่ค้างเกิน 250 ms (งานนับรันในโปรเซสเดียวกับ webhook ของ LINE)
        · ยอดรวม = ผลรวมรายชีต · ท่อนที่ติดป้าย "ตั้งเป็นรหัสย่อยได้" **ตั้งแล้วหายจริง** (ลองแถวร่างในหน่วยความจำ)
     ข. หน้าจอ (ต้องมี API ของทรีนี้ที่ PB_PORT)
        · หน้าแรกไม่มีตารางใหญ่แบบเดิมแล้ว · มีค้น / หลายรุ่น / สรุปที่อ่านไม่ออก · ค้นแล้วกดลิงก์ไปถึงชีต
        · ทุกชีต: ทุกตัวอักษรที่มีผลกับรุ่นในชีตโผล่ครบ · ปุ่มแก้/ปิด/ลบเป็นไอคอน (มี aria-label) ·
          แถวหลายรุ่น/จากไฟล์ไม่มีปุ่มแก้ · ชิปตัวอักษรไม่มีหน้าตาขนาด (`6Ax150`) · ตัวเลขในหัวส่วนตรงกับ API
        · ชีตสองรุ่น: แถวที่เหมือนกันรวมเป็นแถวเดียว · บันทึก "ทุกรุ่นในชีต" = PUT ทุกแถวเดิมด้วยขอบเขตเดิม ·
          "เฉพาะรุ่น" = PUT แถวเดียว · ปิด/ลบ ทำกับทุกแถวที่รวมอยู่ · เพิ่มจากชิป = POST ต่อรุ่น
        · จอ 390 ไม่มีเลื่อนซ้ายขวา · ไม่มี error ในหน้า

   **ไม่เขียนฐานเลย** — คำขอ POST/PUT/DELETE ของ `/subcodes` ถูกดักในเบราว์เซอร์แล้วตอบปลอมทุกตัว
   (ฐานบนเครื่องนี้คือฐาน prod) · ข้อ ก. ใช้แถวร่างในหน่วยความจำ ไม่แตะตาราง
   ต้องมี API ของทรีนี้รันอยู่ที่ PB_PORT (ค่าเริ่มต้น 3099) — **ห้ามใช้ 5180**:
     PORT=3099 PREVIEW_MODE=1 npx tsx index.ts
     npm run diag:pricebook-subcodes-ui
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type HTTPRequest } from 'puppeteer';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { readBookState, withSubCodes } from '../../services/pricingLab/bookStore.js';
import { listSubCodes } from '../../db/pricingLabRepo.js';
import { unreadBySheet } from '../../services/pricingLab/subcodeView.js';
import type { SubCode } from '../../services/pricingLab/types.js';

const PORT = Number(process.env.PB_PORT ?? 3099);
const BASE = `http://localhost:${PORT}`;
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail?: string) => {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? GREEN + '✓' : RED + '✗'}${RESET}  ${label}${detail ? `${DIM}  —  ${detail}${RESET}` : ''}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (PORT === 5180) {
  console.error('ไม่รันกับ 5180 — พอร์ตนั้นเป็นพรีวิวร่วมที่เจ้าของเปิด/ปิดเอง');
  process.exit(1);
}
try {
  await fetch(`${BASE}/admin.html`);
} catch {
  console.error(`ไม่มีเซิร์ฟเวอร์ที่ ${BASE} — เปิดด้วย  PORT=${PORT} PREVIEW_MODE=1 npx tsx index.ts  ในทรีของงานนี้ก่อน`);
  process.exit(1);
}

await pool.query('SET statement_timeout = 15000');
const state = await readBookState();
if (!state) throw new Error('ยังไม่มีสมุดราคาในฐานนี้');
const dbRows = await listSubCodes();

/* ── ก. ตัวนับ ─────────────────────────────────────────────────────────── */
console.log('── ตัวนับ "ท่อนที่ยังไม่ได้กำหนด" ──────────────────────────────');
{
  const book = withSubCodes(state.book, dbRows);
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 10);
  const t0 = performance.now();
  const sum = await unreadBySheet(state, book);
  clearInterval(timer);
  ok('นับสำเร็จ', !!sum, `${Math.round(performance.now() - t0)} ms`);
  ok('event loop ไม่ค้างเกิน 250 ms ระหว่างนับ', maxGap < 250, `ช่วงห่างสูงสุด ${Math.round(maxGap)} ms`);
  if (sum) {
    ok('ยอดรวม = ผลรวมรายชีต', sum.unread === sum.sheets.reduce((n, s) => n + s.unread, 0) && sum.codes === sum.sheets.reduce((n, s) => n + s.codes, 0),
      `${sum.unread.toLocaleString()} จาก ${sum.codes.toLocaleString()} รหัส`);
    ok('ทุกชีตในสมุดมีแถวในผลนับ', new Set(Object.values(state.book.models).map((m) => m.sheet || m.code)).size === sum.sheets.length);
    // ท่อนที่ติดป้าย "ตั้งได้" ต้องหายจริงเมื่อมีแถว — ลองตัวที่เจอบ่อยสุดของแต่ละชีต (แถวร่างในหน่วยความจำ)
    const probes = sum.sheets.flatMap((s) => {
      const t = s.tokens.find((x) => x.subCode && /[A-Z]/i.test(x.subCode));
      return t ? [{ sheet: s.sheet, token: t }] : [];
    });
    const drafts: SubCode[] = probes.map((p) => ({
      subCode: p.token.subCode!, match: 'exact', scope: '*', reads: 'ด่านทดสอบ', effect: 'none', custom: true,
    }));
    const after = await unreadBySheet(state, withSubCodes(state.book, [...dbRows, ...drafts]));
    const stuck = probes.filter((p) => after?.sheets.find((s) => s.sheet === p.sheet)?.tokens.some((t) => t.subCode?.toUpperCase() === p.token.subCode!.toUpperCase()));
    ok('ท่อนที่ป้ายบอกว่าตั้งได้ ตั้งแล้วอ่านออกจริง', probes.length > 0 && stuck.length === 0,
      `${probes.length} ชีต · ${probes.map((p) => `${p.sheet}:${p.token.subCode}`).join(' ')}${stuck.length ? ` · ค้าง ${stuck.map((p) => p.token.subCode).join(',')}` : ''}`);
  }
}

const { rows: admins } = await pool.query(`SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`);
await pool.end();
if (!admins.length) throw new Error('ไม่มีบัญชี admin บนฐานนี้');
const admin = admins[0];
const token = jwt.sign({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }, getJwtSecret(), { expiresIn: '1h' });
const api = async (path: string) => (await fetch(`${BASE}/api/admin/pricebook${path}`, { headers: { Authorization: `Bearer ${token}` } })).json();

interface Row extends SubCode { id?: number; models?: string[] }
const overview = await api('/overview') as { models: { code: string; name: string; sheet?: string }[]; subCodes: Row[]; fromPriceFile: Row[] };
const unread = (await api('/unread')).summary as { sheets: { sheet: string; unread: number }[] } | null;
const allRows = [...overview.subCodes, ...overview.fromPriceFile];
const sheetOf = (code: string) => { const m = overview.models.find((x) => x.code === code); return m?.sheet || code; };
const wide = (r: Row) => r.scope.trim() === '' || r.scope.trim().endsWith('*');

/* ── ข. หน้าจอ ─────────────────────────────────────────────────────────── */
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e instanceof Error ? e.message : String(e)));
page.on('dialog', (d) => void d.accept());
/** คำขอเขียนที่ถูกดักไว้ — ไม่มีตัวไหนถึงเซิร์ฟเวอร์ */
let writes: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
let leaked = 0;
await page.setRequestInterception(true);
page.on('request', (r: HTTPRequest) => {
  const url = r.url();
  if (r.method() !== 'GET' && url.includes('/api/admin/pricebook/')) {
    if (!url.includes('/api/admin/pricebook/subcodes')) leaked++;
    let body: Record<string, unknown> | null = null;
    try { body = r.postData() ? JSON.parse(r.postData()!) : null; } catch { body = null; }
    writes.push({ method: r.method(), path: url.replace(`${BASE}/api/admin/pricebook`, ''), body });
    return void r.respond({ status: 200, contentType: 'application/json', body: '{"row":{"id":1},"ok":true}' });
  }
  void r.continue();
});

const settle = async () => {
  await page.waitForNetworkIdle({ idleTime: 300, timeout: 15000 }).catch(() => {});
  await wait(150);
};
const clickText = async (re: RegExp, root = 'body') => {
  const done = await page.evaluate((src: string, sel: string) => {
    const b = [...document.querySelectorAll(`${sel} button`)].find((x) => new RegExp(src).test((x as HTMLElement).innerText.trim()) && (x as HTMLElement).offsetParent) as HTMLButtonElement | undefined;
    b?.click();
    return !!b;
  }, re.source, root);
  await settle();
  return done;
};
const back = async () => { await clickText(/^กลับ$/); };
const openSheet = async (sheet: string) => {
  const done = await page.evaluate((s: string) => {
    const b = [...document.querySelectorAll('button[aria-label^="แก้ราคา "]')].find((x) => x.getAttribute('data-sheet') === s) as HTMLButtonElement | undefined;
    b?.click();
    return !!b;
  }, sheet);
  await settle();
  await page.waitForSelector('[data-testid="sheet-subcodes"]', { timeout: 15000 }).catch(() => {});
  return done;
};
const sectionText = (id: string) => page.$eval(`[data-testid="${id}"]`, (e) => (e as HTMLElement).innerText).catch(() => '');
const shown = (id: string) => page.$$eval(`[data-testid="${id}"] [data-subcode]`, (els) => els.map((e) => e.getAttribute('data-subcode')!));

await page.evaluateOnNewDocument((t: string, u: string) => {
  sessionStorage.setItem('admin_token', t);
  sessionStorage.setItem('admin_user', u);
}, token, JSON.stringify({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }));
await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/admin.html#pricebook`, { waitUntil: 'networkidle0' });
await settle();

console.log('\n── หน้าแรก ────────────────────────────────────────────');
{
  const body = await page.evaluate(() => document.body.innerText);
  ok('ไม่มีตาราง "รหัสย่อยที่ตั้งค่าไว้" / "ยังไม่ได้ตั้งค่า" แบบเดิม', !/รหัสย่อยที่ตั้งค่าไว้|ยังไม่ได้ตั้งค่า\n/.test(body));
  for (const id of ['subcode-search', 'subcode-wide', 'subcode-unread']) ok(`มีการ์ด ${id}`, (await sectionText(id)) !== '');
  await page.waitForFunction(() => !/กำลังนับ/.test((document.querySelector('[data-testid="subcode-unread"]') as HTMLElement)?.innerText ?? ''), { timeout: 20000 }).catch(() => {});
  const chips = await page.$$eval('[data-testid="subcode-unread"] button', (b) => b.length);
  ok('สรุปท่อนที่ยังไม่ได้กำหนดมีปุ่มต่อชีต ครบตาม API', chips === (unread?.sheets.filter((s) => s.unread > 0).length ?? -1), `${chips} ชีต`);
  const wideRows = allRows.filter((r) => wide(r) || (r.models ?? []).length === 0);
  ok('การ์ดหลายรุ่นมีครบทุกแถวที่ขอบเขตกว้าง/ไม่ตรงรุ่น', (await shown('subcode-wide')).length === new Set(wideRows.map((r) => `${r.subCode}|${r.scope}`)).size, `${wideRows.length} แถว`);

  // ค้นตัวอักษรที่ตั้งไว้มากรุ่นที่สุด แล้วกดลิงก์ไปชีต
  const freq = new Map<string, number>();
  for (const r of allRows) if (r.match === 'exact') freq.set(r.subCode.toUpperCase(), (freq.get(r.subCode.toUpperCase()) ?? 0) + 1);
  const q = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (q) {
    await page.type('input[aria-label="ค้นตัวอักษรในรหัส"]', q);
    await wait(200);
    const links = await page.$$eval('[data-testid="subcode-search"] button', (b) => b.map((x) => (x as HTMLElement).innerText.replace(' →', '').trim()));
    const want = new Set(allRows.filter((r) => r.subCode.toUpperCase() === q).flatMap((r) => (r.models ?? []).map(sheetOf)));
    ok(`ค้น "${q}" ได้ลิงก์ชีตครบ`, links.length >= want.size && want.size > 0, `${links.length} ลิงก์ · ${want.size} ชีต`);
    await clickText(/→$/, '[data-testid="subcode-search"]');
    ok('กดลิงก์แล้วไปถึงหน้าชีต', (await sectionText('sheet-subcodes')) !== '');
    await back();
  }
}

console.log('\n── ทุกชีต ─────────────────────────────────────────────');
const sheets = await page.$$eval('button[aria-label^="แก้ราคา "]', (bs) => bs.map((b) => b.getAttribute('data-sheet')!).filter(Boolean));
ok('ปุ่มเปิดชีตบอกชื่อชีต (data-sheet)', sheets.length > 0, `${sheets.length} ชีต`);
let twoModel: string | null = null;
for (const sheet of sheets) {
  await openSheet(sheet);
  await page.waitForFunction(() => !/กำลังนับ/.test((document.querySelector('[data-testid="sheet-unread"]') as HTMLElement)?.innerText ?? ''), { timeout: 20000 }).catch(() => {});
  const codes = overview.models.filter((m) => (m.sheet || m.code) === sheet).map((m) => m.code);
  const mine = allRows.filter((r) => (r.models ?? []).some((c) => codes.includes(c)));
  const got = await shown('sheet-subcodes');
  const want = new Set(mine.map((r) => r.subCode));
  const missing = [...want].filter((s) => !got.includes(s));
  ok(`${sheet}: ทุกตัวอักษรที่มีผลกับรุ่นในชีตโผล่ครบ`, missing.length === 0, `${got.length} แถวบนจอ · ${mine.length} แถวในฐาน${missing.length ? ` · ขาด ${missing.join(',')}` : ''}`);

  const bad = await page.evaluate(() => {
    const sec = document.querySelector('[data-testid="sheet-subcodes"]')!;
    const textBtns = [...sec.querySelectorAll('[data-subcode] button')].filter((b) => /^(แก้|ปิดไว้|เปิด|ลบ)$/.test((b as HTMLElement).innerText.trim()));
    const noLabel = [...sec.querySelectorAll('[data-subcode] button')].filter((b) => !b.getAttribute('aria-label'));
    return textBtns.length + noLabel.length;
  });
  ok(`${sheet}: ปุ่มแก้/ปิด/ลบเป็นไอคอนที่มี aria-label`, bad === 0);
  const roEdit = await page.evaluate(() => [...document.querySelectorAll('[data-testid="sheet-subcodes"] [data-subcode]')]
    .filter((r) => /แก้ที่หน้าแรกสมุดราคา|มาจากไฟล์ราคา/.test((r as HTMLElement).innerText) && r.querySelector('button')).length);
  ok(`${sheet}: แถวหลายรุ่น/จากไฟล์ราคาไม่มีปุ่มแก้`, roEdit === 0);

  const u = unread?.sheets.find((s) => s.sheet === sheet);
  const head = await sectionText('sheet-unread');
  ok(`${sheet}: ตัวเลขในหัว "ท่อนที่ยังไม่ได้กำหนด" ตรงกับ API`, !!u && head.includes(u.unread.toLocaleString('en-US')), `${u?.unread ?? '—'}`);
  const sizeChips = await page.$$eval('[data-testid="sheet-unread"] button b', (bs) => bs.map((b) => (b as HTMLElement).innerText).filter((t) => /x\d/i.test(t)));
  ok(`${sheet}: ชิปตัวอักษรไม่มีหน้าตาขนาด`, sizeChips.length === 0, sizeChips.join(' '));

  // ชีตสองรุ่นที่มีแถวรวม — ใช้ทดสอบบันทึก
  if (!twoModel && codes.length > 1) {
    const merged = mine.filter((r) => r.id && !wide(r));
    const dupe = merged.some((r) => merged.some((x) => x !== r && x.subCode === r.subCode && x.reads === r.reads && x.effect === r.effect && x.value === r.value && x.amount === r.amount && !!x.disabled === !!r.disabled));
    if (dupe) twoModel = sheet;
  }
  await back();
}

console.log('\n── บันทึกจากชีตสองรุ่น (ดักคำขอ ไม่ถึงฐาน) ────────────────');
if (!twoModel) {
  console.log(`  ${DIM}ข้าม — ไม่มีชีตสองรุ่นที่มีแถวรวมในฐานนี้${RESET}`);
} else {
  await openSheet(twoModel);
  const codes = overview.models.filter((m) => (m.sheet || m.code) === twoModel).map((m) => m.code);
  const first = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="sheet-subcodes"] [data-subcode]')] as HTMLElement[];
    const r = rows.find((x) => (x.getAttribute('data-models') ?? '').split(',').filter(Boolean).length >= 2 && x.querySelector('button[aria-label^="แก้ "]'));
    return r?.getAttribute('data-subcode') ?? null;
  });
  const members = overview.subCodes.filter((r) => r.subCode === first && !wide(r) && (r.models ?? []).some((c) => codes.includes(c)));
  ok(`${twoModel}: มีแถวรวม (${first}) ที่มาจาก ${members.length} แถวในฐาน`, !!first && members.length >= 2);
  const rowSel = `[data-testid="sheet-subcodes"] [data-subcode="${first}"][data-models*=","]`;
  const byLabel = async (prefix: string) => { await page.$eval(`${rowSel} button[aria-label^="${prefix}"]`, (b) => (b as HTMLButtonElement).click()); await settle(); };

  // ทุกรุ่นในชีต (ค่าตั้งต้นของแถวรวม) → PUT ทุกแถวเดิมด้วยขอบเขตเดิม
  writes = [];
  await byLabel('แก้ ');
  await clickText(/^บันทึก · มีผลทันที$/);
  const puts = writes.filter((w) => w.method === 'PUT');
  ok('ทุกรุ่นในชีต → PUT ทุกแถวที่รวมอยู่ ขอบเขตเดิม',
    puts.length === members.length && members.every((m) => puts.some((p) => p.path === `/subcodes/${m.id}` && p.body?.scope === m.scope)) && writes.length === puts.length,
    writes.map((w) => `${w.method} ${w.path} ${w.body?.scope ?? ''}`).join(' · '));

  // เฉพาะรุ่นแรก → PUT แถวเดียว
  writes = [];
  await byLabel('แก้ ');
  await page.evaluate(() => (document.querySelectorAll('input[name="sc-pick"]')[1] as HTMLInputElement)?.click());
  await clickText(/^บันทึก · มีผลทันที$/);
  const target = members.find((m) => (m.models ?? []).includes(codes[0]!));
  ok('เฉพาะรุ่น → PUT แถวเดียวของรุ่นนั้น', writes.length === 1 && writes[0]!.path === `/subcodes/${target?.id}`,
    writes.map((w) => `${w.method} ${w.path}`).join(' · '));

  // ปิดไว้ / ลบ → ทุกแถวที่รวมอยู่
  writes = [];
  await byLabel('ปิดไว้ ');
  ok('ปิดไว้ → PUT ทุกแถว disabled=true', writes.length === members.length && writes.every((w) => w.method === 'PUT' && w.body?.disabled === true));
  writes = [];
  await byLabel('ลบ ');
  ok('ลบ → DELETE ทุกแถว', writes.length === members.length && writes.every((w) => w.method === 'DELETE'));

  // เพิ่มจากชิปที่อ่านไม่ออก → POST ต่อรุ่นในชีต (ไม่มีแถวเดิมของตัวนี้)
  const chip = await page.$('[data-testid="sheet-unread"] button');
  if (chip) {
    writes = [];
    await chip.click();
    await settle();
    await page.type('#sc-reads', 'ด่านทดสอบ');
    await page.select('#sc-effect', 'none');
    await clickText(/^บันทึก · มีผลทันที$/);
    ok('เพิ่มจากชิป → POST หนึ่งแถวต่อรุ่นในชีต ขอบเขต = รหัสรุ่น',
      writes.length === codes.length && writes.every((w) => w.method === 'POST' && codes.includes(String(w.body?.scope))),
      writes.map((w) => `${w.method} ${w.body?.subCode} @${w.body?.scope}`).join(' · '));
  }
  await back();
}
ok('ไม่มีคำขอเขียนหลุดไปที่อื่นนอกจาก /subcodes (ถูกดักทั้งหมด)', leaked === 0);

console.log('\n── จอ 390 · โหมดมืด ────────────────────────────────────');
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await page.setViewport({ width: 390, height: 900 });
await page.goto(`${BASE}/admin.html#pricebook`, { waitUntil: 'networkidle0' });
await settle();
ok('หน้าแรกไม่มีเลื่อนซ้ายขวา', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
for (const sheet of sheets.slice(0, 3)) {
  await openSheet(sheet);
  ok(`${sheet}: ไม่มีเลื่อนซ้ายขวา`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await back();
}

ok('ไม่มี error ในหน้า', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${fail === 0 ? GREEN : RED}${pass}/${pass + fail} ผ่าน${RESET}`);
process.exit(fail === 0 ? 0 : 1);
