/* ─────────────────────────────────────────────────────────────────────────────
   หน้า "ตรวจก่อนบันทึก" ของปุ่มอัปโหลดราคาใหม่ — ต้องเห็น "กฎที่เปลี่ยน" ไม่ใช่แค่ตัวเลขราคา
   (แบบ B ของ mockup `pricebook-import-rule-rows` · เจ้าของเคาะ 2026-10-01)

   เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md · frontend/src/admin/pricingLab/BookImportModal.tsx

   ทำไมต้องมีด่านนี้: หลังบ้านส่ง `ruleRows` มาตั้งแต่ 2026-09-28 (`diag:pricing-import` พิสูจน์ฝั่งนั้น)
   แต่ "แม่แบบเก่า ⇒ จอเปิดแท็บกฎให้เอง · แถบสรุปมีช่องกฎ · ข้อความว่างไม่โกหกว่าไม่เปลี่ยน · ชิปมีป้ายกฎ"
   เป็นของจอล้วน และ **build ผ่านทั้งที่จอยังพูดว่า "ไม่มีช่องไหนเปลี่ยน" ได้** (AGENTS.md A9)

   **ไม่แตะฐาน ไม่ต้องมี API** — เสิร์ฟ `public/` (ผลของ build) เองบนพอร์ตชั่วคราว แล้วดักทุก `/api/*`
   ในเบราว์เซอร์ด้วยคำตอบจำลอง · `/import/apply` ถูกดักแล้วนับ — ถ้ามีสักครั้ง ด่านล้ม (ห้ามบันทึก)
   ข้อมูลจำลองอยู่ในไฟล์นี้ ตรวจแค่สิ่งที่ต้องจริงเสมอ (CLAUDE.md: ห้ามเทียบผลที่ขึ้นกับข้อมูลในฐานกับ golden)

     npm --prefix frontend run build     # ด่านนี้อ่านของที่ build ออกมา ไม่ใช่ซอร์ส
     npm run diag:pricebook-import-ui    # PBI_PORT=3097 เป็นค่าเริ่มต้น · ห้าม 5174/5180/3011
   ภาพหน้าจอเก็บใน tmp (บรรทัดแรกบอก path) — ไม่เข้า git
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type HTTPRequest } from 'puppeteer';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PBI_PORT ?? 3097);
const BASE = `http://localhost:${PORT}`;
const PUBLIC = join(process.cwd(), 'public');
const SRC = join(process.cwd(), 'frontend/src/admin/pricingLab/BookImportModal.tsx');
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
if (!existsSync(join(PUBLIC, 'admin.html'))) {
  console.error('ไม่มี public/admin.html — สั่ง npm --prefix frontend run build ก่อน');
  process.exit(1);
}
if (statSync(SRC).mtimeMs > statSync(join(PUBLIC, 'admin.html')).mtimeMs) {
  console.error('BookImportModal.tsx ใหม่กว่า build — สั่ง npm --prefix frontend run build แล้วรันใหม่ (ไม่งั้นจะตรวจจอเก่า)');
  process.exit(1);
}

// ── ข้อมูลจำลองของ /import/preview (รูปเดียวกับ routes/pricingLab.ts) ─────────────────
const CAB = 'กฎ: ราคาสายส่วนที่ยาวเกิน 1 เมตร (ตามชนิดสาย) [cable_over_1m]';
const ALIAS_WAS = '["TSJ-01","TST-01","TSP-01","TSPA-01","TSZ-01","TSE-01"]';
const ALIAS_NOW = '["TSJ-01","TST-01","TSP-01","TSPA-01","TSZ-01"]';
const base = { ok: true, issues: [], fingerprint: 'r0:diag', untouched: [] as string[] };
const FIX: Record<string, unknown> = {
  // ก · ราคา + กฎเปลี่ยน
  a: {
    ...base,
    summary: { changed: 4, added: 0, removed: 0, same: 6461, rules: 3 },
    models: [
      { model: 'TSK-01', label: 'TSK-01', changed: 0, added: 0, removed: 0, rules: 0 },
      { model: 'TSK-04', label: 'TSK-04', changed: 3, added: 0, removed: 0, rules: 1 },
      { model: 'TSK-12', label: 'TSK-12', changed: 0, added: 0, removed: 0, rules: 1 },
      { model: 'TSP-10', label: 'TSP-10', changed: 1, added: 0, removed: 0, rules: 1 },
    ],
    rows: [
      { model: 'TSK-04', what: '6 | 1/4”', kind: 'cell', was: 420, now: 450 },
      { model: 'TSK-04', what: '8 | 1/4”', kind: 'cell', was: 460, now: 490 },
      { model: 'TSK-04', what: '8 | 3/8”', kind: 'cell', was: 480, now: 510 },
      { model: 'TSP-10', what: 'กฎ: ความยาวแกนส่วนที่เกินมาตรฐาน (ต่อหน่วย)', kind: 'rate', was: 40, now: 45 },
    ],
    totalRows: 4,
    ruleRows: [
      { model: 'TSK-04', what: 'ใช้กับรหัส', was: '["TSJ-04","TSP-04"]', now: '["TSJ-04","TSP-04","TST-04"]' },
      { model: 'TSK-12', what: 'ค่ามาตรฐาน cable_m', was: '1', now: '2' },
      { model: 'TSP-10', what: 'กฎ: ความยาวแกนส่วนที่เกินมาตรฐาน [len_l1] · ทีละ', was: '100', now: '50' },
    ],
    totalRuleRows: 3,
  },
  // ข · กฎเปลี่ยนอย่างเดียว (แม่แบบเก่า) — เคสที่จอเดิมขึ้น "ไม่มีช่องไหนเปลี่ยน"
  b: {
    ...base,
    untouched: ['BH-03'],
    summary: { changed: 0, added: 0, removed: 0, same: 6466, rules: 4 },
    models: [
      { model: 'BH-01', label: 'BH-01', changed: 0, added: 0, removed: 0, rules: 0 },
      { model: 'TSK-01', label: 'TSK-01', changed: 0, added: 0, removed: 0, rules: 3 },
      { model: 'TSK-04', label: 'TSK-04', changed: 0, added: 0, removed: 0, rules: 1 },
    ],
    rows: [],
    totalRows: 0,
    ruleRows: [
      { model: 'TSK-01', what: `${CAB} · วิธีปัด`, was: 'ปัดขึ้น', now: 'ปัดลง (นับเฉพาะหน่วยเต็ม)' },
      { model: 'TSK-01', what: 'ค่ามาตรฐานของแกน thread', was: '1/4”', now: '—' },
      { model: 'TSK-01', what: 'ใช้กับรหัส', was: ALIAS_WAS, now: ALIAS_NOW },
      { model: 'TSK-04', what: `${CAB} · วิธีปัด`, was: 'ปัดขึ้น', now: 'ปัดลง (นับเฉพาะหน่วยเต็ม)' },
    ],
    totalRuleRows: 4,
  },
  // ค · ไม่มีอะไรเปลี่ยน
  c: {
    ...base,
    summary: { changed: 0, added: 0, removed: 0, same: 6466, rules: 0 },
    models: [
      { model: 'TSK-01', label: 'TSK-01', changed: 0, added: 0, removed: 0, rules: 0 },
      { model: 'TSK-04', label: 'TSK-04', changed: 0, added: 0, removed: 0, rules: 0 },
    ],
    rows: [], totalRows: 0, ruleRows: [], totalRuleRows: 0,
  },
  // ง · เซิร์ฟเวอร์ก่อน 2026-09-28 — ไม่มี rules/ruleRows เลย ต้องไม่พัง
  d: {
    ...base,
    summary: { changed: 1, added: 0, removed: 0, same: 10 },
    models: [{ model: 'TSK-04', label: 'TSK-04', changed: 1, added: 0, removed: 0 }],
    rows: [{ model: 'TSK-04', what: '6 | 1/4”', kind: 'cell', was: 420, now: 450 }],
    totalRows: 1,
  },
  // จ · ไฟล์มีปัญหา (ขั้น 2ข) — แถบสรุปตัวเดียวกัน ได้ช่องกฎไปด้วย (กล่อง lg แคบกว่า)
  e: {
    ...base,
    issues: [{ sheet: 'TS-01+TS-01-0', row: 12, level: 'error', message: 'อ่านตัวเลขไม่ออก' }],
    summary: { changed: 2, added: 0, removed: 1, same: 6400, rules: 2 },
  },
  // ฉ · แถวถูกตัดที่โควตา 300 — รุ่น TSK-09 มีช่องราคาเปลี่ยน 5 ช่องแต่ไม่อยู่ในแถวที่ส่งมา + กฎ 1 ข้อ
  f: {
    ...base,
    summary: { changed: 305, added: 0, removed: 0, same: 6000, rules: 1 },
    models: [
      { model: 'TSK-04', label: 'TSK-04', changed: 300, added: 0, removed: 0, rules: 0 },
      { model: 'TSK-09', label: 'TSK-09', changed: 5, added: 0, removed: 0, rules: 1 },
    ],
    rows: Array.from({ length: 300 }, (_, i) => ({ model: 'TSK-04', what: `${i} | 1/4”`, kind: 'cell', was: 100, now: 110 })),
    totalRows: 305,
    ruleRows: [{ model: 'TSK-09', what: 'ค่ามาตรฐาน cable_m', was: '1', now: '2' }],
    totalRuleRows: 1,
  },
};
const OVERVIEW = { book: { ok: true, models: 0 }, version: null, models: [], subCodes: [], fromPriceFile: [], axisLabels: {}, shelf: null };

// ── เสิร์ฟ public/ ────────────────────────────────────────────────────────────────
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, path === '/' ? 'admin.html' : path);
  if (!file.startsWith(PUBLIC) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise<void>((resolve, reject) => {
  server.once('error', (e) => reject(new Error(`เปิดพอร์ต ${PORT} ไม่ได้ (${(e as Error).message}) — ตั้ง PBI_PORT เป็นพอร์ตอื่น`)));
  server.listen(PORT, '127.0.0.1', () => resolve());
});

const shots = mkdtempSync(join(tmpdir(), 'pb-import-'));
const dummy = join(shots, 'แม่แบบราคา-diag.xlsx');
writeFileSync(dummy, 'diag — คำตอบของ /import/preview ถูกจำลอง ไฟล์นี้ไม่มีใครอ่าน');
console.log(`เสิร์ฟ public/ ที่ ${BASE} · ไม่แตะฐาน · ภาพ ${shots}\n`);

let state = 'a';
let applyCalls = 0;
const unknownApi = new Set<string>();

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e instanceof Error ? e.message : String(e)));
await page.setRequestInterception(true);
page.on('request', (r: HTTPRequest) => {
  const url = new URL(r.url());
  if (url.host !== `localhost:${PORT}`) { void r.abort(); return; } // ออฟไลน์ล้วน
  if (!url.pathname.startsWith('/api/')) { void r.continue(); return; }
  const json = (status: number, body: unknown) => void r.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const p = url.pathname;
  if (p === '/api/admin/pricebook/import/apply') { applyCalls++; void r.abort(); return; }
  if (p === '/api/admin/pricebook/import/preview') return json(200, FIX[state]);
  if (p === '/api/admin/pricebook/overview') return json(200, OVERVIEW);
  if (p === '/api/admin/me/capabilities') return json(200, { capabilities: {} });
  unknownApi.add(p);
  json(404, { error: 'diag: ไม่ได้จำลองเส้นนี้' });
});

const USER = { id: 1, username: 'diag', name: 'diag', role: 'admin' };
// try: สคริปต์นี้รันกับ about:blank ด้วย ซึ่งแตะ storage ไม่ได้ (SecurityError ไม่ใช่ของหน้าแอป)
await page.evaluateOnNewDocument((u: string) => {
  try {
    sessionStorage.setItem('admin_token', 'diag.not-a-jwt');
    sessionStorage.setItem('admin_user', u);
  } catch { /* about:blank */ }
}, JSON.stringify(USER));

const dialogText = () => page.evaluate(() => (document.querySelector('[role="dialog"]') as HTMLElement | null)?.innerText ?? '');
const activeTab = () => page.evaluate(() =>
  (document.querySelector('[role="dialog"] [role="tab"][aria-selected="true"]') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? '');
const chipText = (model: string) => page.evaluate((m: string) =>
  ([...document.querySelectorAll('[role="dialog"] button[aria-pressed]')] as HTMLElement[])
    .find((b) => b.querySelector('b')?.innerText === m)?.innerText.replace(/\s+/g, ' ').trim() ?? '', model);
const clickChip = (model: string) => page.evaluate((m: string) => {
  ([...document.querySelectorAll('[role="dialog"] button[aria-pressed]')] as HTMLElement[])
    .find((b) => b.querySelector('b')?.innerText === m)?.click();
}, model);
const clickTab = (label: string) => page.evaluate((l: string) => {
  ([...document.querySelectorAll('[role="dialog"] [role="tab"]')] as HTMLElement[])
    .find((b) => b.innerText.replace(/\s+/g, ' ').trim().startsWith(l))?.click();
}, label);
/** แถบสรุป: ป้าย → ตัวเลข + คลาสของตัวเลข */
const summary = () => page.evaluate(() => {
  const grid = [...document.querySelectorAll('[role="dialog"] .grid')].find((g) => (g as HTMLElement).innerText.includes('เท่าเดิม') && (g as HTMLElement).innerText.includes('หายไป'));
  return [...(grid?.children ?? [])].map((c) => {
    const spans = c.querySelectorAll('span');
    return { label: (spans[1] as HTMLElement | undefined)?.innerText.trim() ?? '', n: (spans[0] as HTMLElement | undefined)?.innerText.trim() ?? '', cls: spans[0]?.className ?? '' };
  });
});
const noOverflow = () => page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]') as HTMLElement | null;
  return document.documentElement.scrollWidth <= window.innerWidth && !!d && d.scrollWidth <= d.clientWidth + 1;
});

async function openPreview(s: string, width: number, theme: 'dark' | 'light' = 'dark') {
  state = s;
  await page.setViewport({ width, height: width < 640 ? 844 : 900 });
  await page.evaluateOnNewDocument((t: string) => { try { localStorage.setItem('admin-theme', t); } catch { /* about:blank */ } }, theme);
  await page.goto('about:blank'); // URL เดิมต่างกันแค่ hash = ไม่โหลดใหม่ (กล่องเดิมค้าง)
  await page.goto(`${BASE}/admin.html#pricebook`, { waitUntil: 'networkidle0' });
  await wait(300);
  await page.evaluate(() => {
    ([...document.querySelectorAll('button')] as HTMLElement[]).find((b) => b.innerText.includes('อัปโหลด'))?.click();
  });
  const input = await page.waitForSelector('[role="dialog"] input[type="file"]', { timeout: 5000 });
  await input!.uploadFile(dummy);
  // รอขั้น 2ก/2ข จากคำที่มีมาก่อนงานนี้ — จอรุ่นเก่า (ไม่มีแท็บ) ต้องได้ ✗ รายข้อ ไม่ใช่ค้างจน timeout
  await page.waitForFunction(() => /รุ่นที่จะบันทึก|บันทึกไม่ได้/.test((document.querySelector('[role="dialog"]') as HTMLElement | null)?.innerText ?? ''), { timeout: 5000 });
  await wait(150);
}
const shot = (name: string) => page.screenshot({ path: join(shots, `${name}.png`) });

try {
  for (const width of [1280, 390]) {
    console.log(`\n── ${width}px ──────────────────────────────────────────────`);

    // ข · กฎอย่างเดียว — หัวใจของงานนี้
    await openPreview('b', width);
    await shot(`b-${width}`);
    let t = await dialogText();
    ok('ข: เปิดแท็บ "กฎ" ให้เองเมื่อช่องราคาที่เห็นเป็น 0 แต่มีกฎ', (await activeTab()).startsWith('กฎ'), await activeTab());
    const sb = await summary();
    const ruleCell = sb.find((c) => c.label === 'กฎเปลี่ยน');
    ok('ข: แถบสรุปมีช่อง "กฎเปลี่ยน" = 4 และตัวเลขเด่น (สีเหลือง)', ruleCell?.n === '4' && /amber/.test(ruleCell.cls), JSON.stringify(ruleCell));
    ok('ข: ช่องแรกของแถบสรุปชื่อ "ช่องราคาเปลี่ยน"', sb[0]?.label === 'ช่องราคาเปลี่ยน', sb[0]?.label);
    ok('ข: ไม่มีข้อความเดิม "ไม่มีช่องไหนเปลี่ยน"', !t.includes('ไม่มีช่องไหนเปลี่ยน'));
    ok('ข: กล่องเหลืองบอกว่าราคาที่คิดออกมาจะเปลี่ยน + ทางแก้', t.includes('ราคาที่คิดออกมาจะเปลี่ยน') && t.includes('ดาวน์โหลดแม่แบบราคา'));
    ok('ข: ชิปรุ่นที่เปลี่ยนแต่กฎมีป้าย "กฎ N"', (await chipText('TSK-01')).endsWith('กฎ 3'), await chipText('TSK-01'));
    ok('ข: ชิปรุ่นที่ไม่เปลี่ยนอะไรได้ป้าย "เท่าเดิม"', (await chipText('BH-01')).endsWith('เท่าเดิม'), await chipText('BH-01'));
    ok('ข: แถวกฎแสดงครบ + บรรทัด "แสดง 4 จาก 4 กฎที่เปลี่ยน"', t.includes('ปัดลง (นับเฉพาะหน่วยเต็ม)') && t.includes('แสดง 4 จาก 4 กฎที่เปลี่ยน'));
    ok('ข: ไม่มีส่วนต่างเป็นเงินในแท็บกฎ', !t.includes('ส่วนต่าง'));
    ok('ข: ไม่ล้นแนวนอน', await noOverflow());
    // ติ๊กออกรุ่นที่มีกฎทั้งหมด ⇒ ข้อความว่างพูดความจริง
    await clickChip('TSK-01'); await clickChip('TSK-04'); await wait(100);
    t = await dialogText();
    ok('ข: ติ๊กออกรุ่นที่มีกฎ ⇒ "ที่เปลี่ยนอยู่ในรุ่นที่ไม่ได้ติ๊ก" (ไม่ใช่ "ไม่เปลี่ยน")', t.includes('รุ่นที่ติ๊กไว้ไม่มีอะไรเปลี่ยน ทั้งตัวเลขราคาและกฎ — ที่เปลี่ยนอยู่ในรุ่นที่ไม่ได้ติ๊ก'));
    await clickTab('กฎ'); await wait(100);
    ok('ข: แท็บกฎว่าง ⇒ "กฎที่เปลี่ยนอยู่ในรุ่นที่ไม่ได้ติ๊ก"', (await dialogText()).includes('รุ่นที่ติ๊กไว้ไม่มีกฎเปลี่ยน — กฎที่เปลี่ยนอยู่ในรุ่นที่ไม่ได้ติ๊ก'));

    // ก · ราคา + กฎ
    await openPreview('a', width);
    await shot(`a-${width}`);
    t = await dialogText();
    ok('ก: เริ่มที่แท็บ "ช่องราคา" เมื่อมีช่องราคาเปลี่ยน', (await activeTab()).startsWith('ช่องราคา'), await activeTab());
    ok('ก: กล่องเหลืองบรรทัดเดียว "มีกฎเปลี่ยน 3 ข้อด้วย"', t.includes('มีกฎเปลี่ยน 3 ข้อด้วย') && !t.includes('ราคาที่คิดออกมาจะเปลี่ยน'));
    ok('ก: ชิปมีทั้งป้ายราคาเดิมและป้ายกฎ', (await chipText('TSK-04')).includes('3 เปลี่ยน') && (await chipText('TSK-04')).endsWith('กฎ 1'), await chipText('TSK-04'));
    ok('ก: ชิปที่เปลี่ยนแต่กฎ / ไม่เปลี่ยนเลย', (await chipText('TSK-12')).endsWith('กฎ 1') && (await chipText('TSK-01')).endsWith('เท่าเดิม'));
    ok('ก: บรรทัดท้ายของแท็บราคาเหมือนเดิม', t.includes('แสดง 4 จาก 4 ช่องที่ไม่เท่าเดิม'));
    ok('ก: ไม่ล้นแนวนอน', await noOverflow());
    await clickTab('กฎ'); await wait(100);
    await shot(`a-${width}-rules`);
    t = await dialogText();
    ok('ก: กดแท็บกฎ ⇒ เห็นแถวกฎ + "แสดง 3 จาก 3 กฎที่เปลี่ยน"', t.includes('ค่ามาตรฐาน cable_m') && t.includes('แสดง 3 จาก 3 กฎที่เปลี่ยน'));
    await clickTab('ช่องราคา'); await clickChip('TSK-04'); await clickChip('TSP-10'); await wait(100);
    t = await dialogText();
    ok('ก: คนเลือกแท็บราคาเอง ⇒ ไม่สลับให้ แต่ข้อความว่างบอกว่ากฎยังเปลี่ยน', (await activeTab()).startsWith('ช่องราคา') && t.includes('แต่มีกฎเปลี่ยน 1 ข้อ (ดูแท็บ “กฎ”)'));
    ok('ก: เหลือแต่กฎในรุ่นที่ติ๊ก ⇒ กล่องเหลืองเปลี่ยนเป็นแบบ "ตัวเลขราคาเท่าเดิมทุกช่อง"', t.includes('ตัวเลขราคาเท่าเดิมทุกช่อง แต่กฎต่างจากเล่มที่ใช้อยู่ 1 ข้อ'));

    // ค · ไม่มีอะไรเปลี่ยน
    await openPreview('c', width);
    await shot(`c-${width}`);
    t = await dialogText();
    ok('ค: ข้อความว่าง "ทั้งตัวเลขราคาและกฎ"', t.includes('ไฟล์นี้เหมือนเล่มที่ใช้อยู่ทุกช่อง ทั้งตัวเลขราคาและกฎ'));
    ok('ค: ไม่มีกล่องเหลืองเรื่องกฎ', !t.includes('มีกฎเปลี่ยน') && !t.includes('กฎต่างจาก'));
    const sc = await summary();
    ok('ค: ช่อง "กฎเปลี่ยน" = 0 ไม่เด่น', sc[4]?.label === 'กฎเปลี่ยน' && sc[4]?.n === '0' && !/amber/.test(sc[4]?.cls ?? ''), JSON.stringify(sc[4]));
    ok('ค: ชิปทุกตัว "เท่าเดิม"', (await chipText('TSK-01')).endsWith('เท่าเดิม') && (await chipText('TSK-04')).endsWith('เท่าเดิม'));

    // จ · ไฟล์มีปัญหา
    await openPreview('e', width);
    await shot(`e-${width}`);
    const se = await summary();
    ok('จ: ขั้น "ไฟล์มีปัญหา" แถบสรุปมีช่องกฎด้วย · ไม่ล้นแนวนอน', se.length === 5 && se[4]?.n === '2' && await noOverflow(), se.map((c) => `${c.n} ${c.label}`).join(' | '));

    // ฉ · โควตา — ติ๊กเหลือรุ่นที่แถวราคาตกโควตา ⇒ ห้ามบอกว่า "ตัวเลขราคาเท่าเดิมทุกช่อง"
    await openPreview('f', width);
    await clickChip('TSK-04'); await wait(100);
    t = await dialogText();
    ok('ฉ: แถวราคาตกโควตา ⇒ ไม่บอกว่าตัวเลขเท่าเดิม · ไม่สลับไปแท็บกฎ · บอกว่าอยู่นอกแถวที่แสดง',
      !t.includes('ตัวเลขราคาเท่าเดิมทุกช่อง') && (await activeTab()).startsWith('ช่องราคา') && t.includes('มีช่องราคาเปลี่ยน 5 ช่อง แต่อยู่นอก 300 แถวแรกที่แสดง') && t.includes('มีกฎเปลี่ยน 1 ข้อด้วย'));

    // ง · เซิร์ฟเวอร์เก่า
    await openPreview('d', width);
    t = await dialogText();
    const sd = await summary();
    ok('ง: เซิร์ฟเวอร์ไม่ส่ง rules/ruleRows ⇒ ไม่พัง · กฎเปลี่ยน 0 · ตารางราคาขึ้น', sd[4]?.n === '0' && t.includes('6 | 1/4”') && (await activeTab()).startsWith('ช่องราคา'));
  }

  // เส้น sm ทั้งสองฝั่ง (docs/design.md หัวข้อ 10) — ไม่มีอะไรค้างจากฝั่งแคบ
  for (const width of [640, 641]) {
    await openPreview('b', width);
    await shot(`b-${width}`);
    ok(`${width}px: แท็บกฎเปิดเอง · ไม่ล้นแนวนอน`, (await activeTab()).startsWith('กฎ') && await noOverflow());
  }

  // ธีมสว่าง — ภาพสำหรับตาคน (กดสลับจริงเท่ากับตั้งค่าเดียวกันตอนโหลด)
  for (const width of [1280, 390]) {
    await openPreview('b', width, 'light');
    await shot(`b-${width}-light`);
    await openPreview('a', width, 'light');
    await shot(`a-${width}-light`);
  }

} finally {
  await browser.close();
  server.close();
}

console.log('');
ok('ไม่มี error ในหน้า', errors.length === 0, errors.slice(0, 3).join(' | '));
ok('ไม่ยิง /import/apply สักครั้ง', applyCalls === 0, `${applyCalls} ครั้ง`);
if (unknownApi.size) console.log(`${DIM}  (เส้นที่ไม่ได้จำลอง ตอบ 404: ${[...unknownApi].join(' · ')})${RESET}`);

console.log(`\nสรุป: ${fail === 0 ? GREEN + 'ผ่าน' : RED + 'ล้ม'}${RESET} ${pass}/${pass + fail} · ภาพ ${shots}`);
process.exit(fail === 0 ? 0 : 1);
