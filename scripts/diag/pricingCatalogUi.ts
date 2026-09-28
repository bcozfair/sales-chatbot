/* ─────────────────────────────────────────────────────────────────────────────
   เปิดหน้า "คำนวณราคา" จริงแล้วกรอกตามแคตตาล็อก BH (ช่องกรอก ↔ ช่องรหัส ตามกันจริงไหม)

   เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md · docs/pricing-code-bh.md

   ทำไมต้องมีด่านนี้ ทั้งที่ `diag:pricing-catalog` ผ่านแล้ว: ด่านนั้นพิสูจน์ตัวอ่าน/ตัวประกอบรหัสฝั่งเซิร์ฟเวอร์
   แต่ "แก้ช่องแล้วรหัสด้านบนเปลี่ยนตาม · คำตอบเก่ามาถึงทีหลังแล้วช่องเด้งกลับ · สลับรุ่นแล้วช่องเปลี่ยน"
   เป็นของฝั่งจอล้วน และ **build ผ่านทั้งที่ปุ่มไม่ทำงานได้** (AGENTS.md A9) ⇒ เปิดดูที่ความกว้างจริง 1280 / 390

   **อ่านอย่างเดียว** — หน้านี้ยิงแค่ `GET /overview` กับ `POST /quote` (ไม่มีทางเขียนสมุดราคา) จึงไม่ต้องมีด่านกันเครื่อง
   แบบ `diag:pb-ui` · ใช้บัญชี admin ตัวแรกในฐานออก token ชั่วคราว 1 ชั่วโมง

   ต้องมี API ของทรีนี้รันอยู่ที่ PB_PORT (ค่าเริ่มต้น 3099 · 3098 เป็นของโปรเซสอื่นบน PMSV) — **ห้ามใช้ 5180** (พรีวิวร่วมที่เจ้าของเปิด/ปิดเอง):
     PORT=3099 PREVIEW_MODE=1 npx tsx index.ts        (PREVIEW_MODE = ไม่เริ่มตัวตั้งเวลา sync)
     npm run diag:pricing-catalog-ui
   ⚠️ ผลขึ้นกับเล่มในฐาน: ก่อนรัน `importer.ts --catalog` รหัส BH-02 คิดพื้นที่ไม่ได้ (ด่านบอกไว้ในผล ไม่นับตก)
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer from 'puppeteer';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { readBookState } from '../../services/pricingLab/bookStore.js';
import { catalogRulesChanges, catalogRulesFromMaps } from '../pricebook/catalogRules.js';

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

const state = await readBookState();
const bookHasCatalog = !!state && catalogRulesChanges(state.book, catalogRulesFromMaps()).length === 0;
const { rows: admins } = await pool.query(`SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`);
await pool.end();
if (!admins.length) throw new Error('ไม่มีบัญชี admin บนฐานนี้');
const admin = admins[0];
const token = jwt.sign({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }, getJwtSecret(), { expiresIn: '1h' });
console.log(`ใช้บัญชี ${admin.username} · เซิร์ฟเวอร์ ${BASE} · เล่มในฐาน${bookHasCatalog ? 'มีกติกาแคตตาล็อกแล้ว' : 'ยังไม่ได้รัน importer --catalog'}\n`);

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e instanceof Error ? e.message : String(e)));

const codeValue = () => page.$eval('#pl-code', (el) => (el as HTMLInputElement).value);
const text = () => page.evaluate(() => document.body.innerText);
/** รอให้คำตอบของ /quote กลับมาและหน้าจอวาดเสร็จ */
async function settle(): Promise<void> {
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 8000 }).catch(() => {});
  await wait(150);
}
/** ล้างช่องแบบที่คนทำ (Ctrl+A แล้วลบ) — คลิกสามครั้งไม่เลือกทั้งช่องใน input ตัวเลข ของเก่าจะค้างต่อท้าย */
async function clear(sel: string): Promise<void> {
  await page.focus(sel);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
}
async function typeCode(code: string): Promise<void> {
  await clear('#pl-code');
  await page.type('#pl-code', code);
  await page.keyboard.press('Enter');
  await settle();
}
async function setNumber(label: string, value: string): Promise<void> {
  const sel = `input[aria-label="${label}"]`;
  await clear(sel);
  await page.type(sel, value, { delay: 30 });
  await settle();
}
async function choose(label: string, value: string): Promise<void> {
  await page.select(`select[aria-label="${label}"]`, value);
  await settle();
}

for (const width of [1280, 390]) {
  console.log(`\n── ${width}px ──────────────────────────────────────────────`);
  await page.setViewport({ width, height: 900 });
  await page.evaluateOnNewDocument((t: string, u: string) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', u);
  }, token, JSON.stringify({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }));
  await page.goto(`${BASE}/admin.html#pricing`, { waitUntil: 'networkidle0' });
  await wait(600);

  await typeCode('BH-01C-600x150-380-4950W-PL-PL2');
  let body = await text();
  ok('พิมพ์รหัส BH → ขึ้นช่องตามแคตตาล็อก (ไม่ใช่การ์ด "ระบบอ่านรหัสนี้ว่าอะไร")',
    (await page.$('select[aria-label="การออกขั้วไฟ"]')) !== null && !body.includes('ระบบอ่านรหัสนี้ว่าอะไร'));
  ok('ช่องได้ค่าจากรหัส (การต่อ PL · ขั้วไฟ PL2)',
    (await page.$eval('select[aria-label="การต่อใช้งาน"]', (el) => (el as HTMLSelectElement).value)) === 'PL'
    && (await page.$eval('select[aria-label="การออกขั้วไฟ"]', (el) => (el as HTMLSelectElement).value)) === 'PL2');
  // ปิดอยู่โชว์แค่รหัส · คำอธิบายอยู่ในรายการ · ชื่อรุ่นเป็นอังกฤษตามแคตตาล็อก (เจ้าของสั่ง 2026-09-28)
  const shown = (label: string) => page.$eval(`select[aria-label="${label}"]`, (el) => {
    const sel = el as HTMLSelectElement;
    return { face: el.nextElementSibling?.textContent ?? '', color: getComputedStyle(sel).color, opt: sel.selectedOptions[0]?.textContent ?? '' };
  });
  const [m, t] = [await shown('รุ่น'), await shown('การออกขั้วไฟ')];
  ok('dropdown ปิดอยู่โชว์แค่รหัส · รายการมีคำอธิบาย · ชื่อรุ่นอังกฤษตามแคตตาล็อก',
    m.face === 'BH-01C' && t.face === 'PL2' && /rgba\(0, 0, 0, 0\)|transparent/.test(t.color)
      && m.opt === 'BH-01C · 2 Piece Band Heater' && t.opt.startsWith('PL2 · '), `${m.face} | ${t.face} | ${m.opt}`);
  ok('ราคาตรงตัวอย่างในชีต 13,490', body.includes('13,490'));

  await setNumber('ความสูง H', '200');
  ok('แก้ความสูง → รหัสด้านบนเปลี่ยนตาม', (await codeValue()) === 'BH-01C-600x200-380-4950W-PL-PL2', await codeValue());
  body = await text();
  ok('แก้ความสูง → ราคาเปลี่ยน', !body.includes('13,490'));

  await choose('การออกขั้วไฟ', 'T');
  body = await text();
  ok('เลือกเต๋า T → ขึ้นช่องขนาดเต๋า และเตือนว่ายังไม่รวมในราคา',
    (await page.$('select[aria-label="ขนาดเต๋า (ไม่อยู่ในรหัส)"]')) !== null && body.includes('ยังไม่รวมในราคา'));
  await choose('ขนาดเต๋า (ไม่อยู่ในรหัส)', '30A');
  body = await text();
  ok('เลือก 30A → รวมในราคาแล้ว รหัสยังลงท้าย -T', !body.includes('ยังไม่รวมในราคา') && (await codeValue()).endsWith('-T'), await codeValue());

  // สิ่งที่ต้องบวกเพิ่ม — ติ๊กแล้วราคาเปลี่ยน รหัสไม่เปลี่ยน · พิมพ์รหัสเดิมซ้ำแล้วค่าที่ติ๊กไม่หาย
  await choose('การออกขั้วไฟ', '2');
  const before = await text();
  const codeBefore = await codeValue();
  await page.click('input[aria-label="สายถักสแตนเลส"]');
  await settle();
  body = await text();
  ok('ติ๊กสายถักสแตนเลส → ราคาเปลี่ยน รหัสไม่เปลี่ยน · การ์ดคำนวณมีบรรทัดสายถัก',
    body !== before && (await codeValue()) === codeBefore && body.includes('สายถักสแตนเลส'), await codeValue());
  await typeCode(await codeValue());
  ok('พิมพ์รหัสเดิมซ้ำ → ช่องติ๊กยังติ๊กอยู่',
    await page.$eval('input[aria-label="สายถักสแตนเลส"]', (el) => (el as HTMLInputElement).checked));
  await page.click('input[aria-label="สายถักสแตนเลส"]');
  await settle();

  ok('เลือกรุ่นจาก dropdown ในช่อง "รุ่น" (ไม่มีการ์ดแยกแล้ว) · มี 4 รุ่น',
    (await page.$$eval('select[aria-label="รุ่น"] option', (os) => os.length)) === 4
      && (await page.$$('xpath/.//button[.//b[text()="BH-03"]]')).length === 0);
  await choose('รุ่น', 'BH-03');
  await choose('การออกขั้วไฟ', '1');
  ok('BH-03 เลือกออกสาย 1 M ได้ → รหัสลงท้าย -1', (await codeValue()).endsWith('-1') && !(await text()).includes('ระบบอ่านรหัสนี้ว่าอะไร'), await codeValue());

  await choose('รุ่น', 'BH-02');
  ok('สลับเป็น BH-02 → มีช่อง Shape', (await page.$('select[aria-label="Shape"]')) !== null);
  await choose('Shape', 'C');
  ok('Shape C → เหลือช่อง D1 ช่องเดียว · รหัสขึ้นต้น BH-02C',
    (await page.$('input[aria-label="D1"]')) !== null && (await page.$('input[aria-label="ยาว L"]')) === null
    && (await codeValue()).startsWith('BH-02C '), await codeValue());
  body = await text();
  if (bookHasCatalog) ok('BH-02C คิดราคาได้ (สูตรวงกลม)', /\d,?\d{3}\s*บาท/.test(body) && !body.includes('ยังคิดราคาไม่ได้'));
  else console.log(`  ${DIM}·  ข้ามราคา BH-02C — เล่มในฐานยังไม่มีสูตรพื้นที่ตามรูปทรง (DEPLOY.md 4.11ข)${RESET}`);

  // พิมพ์เร็ว ๆ แล้วคำตอบของตัวเลขก่อนหน้าต้องไม่ทับค่าล่าสุด
  await clear('input[aria-label="D1"]');
  await page.type('input[aria-label="D1"]', '215', { delay: 0 });
  await settle();
  ok('พิมพ์ต่อกันเร็ว ๆ แล้วช่องไม่เด้งกลับเป็นค่าเก่า',
    (await page.$eval('input[aria-label="D1"]', (el) => (el as HTMLInputElement).value)) === '215' && (await codeValue()).startsWith('BH-02C 215-'),
    await codeValue());

  await typeCode('TSK-14 6x200+150-BU');
  body = await text();
  ok('รหัสที่ยังไม่มีแคตตาล็อก (TS) → หน้าเดิม', body.includes('ระบบอ่านรหัสนี้ว่าอะไร') && (await page.$('select[aria-label="การออกขั้วไฟ"]')) === null);

  await typeCode('BH-02-S 406x330-220-2500W');
  body = await text();
  ok('รหัส BH ที่เขียนนอกรูปแบบ → หน้าเดิม (ไม่เดาช่อง)', body.includes('ระบบอ่านรหัสนี้ว่าอะไร'));

  await typeCode('BH-02C 210-220-1400W-N-Z');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('ไม่มีเลื่อนซ้ายขวาทั้งหน้า', overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: join(tmpdir(), `pricing-catalog-${width}.png`), fullPage: true });
}

ok('ไม่มี error ในหน้า', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
console.log(`\n${fail ? RED : GREEN}${pass} ผ่าน · ${fail} ตก${RESET}   (ภาพ: ${join(tmpdir(), 'pricing-catalog-1280.png')} · -390.png)`);
process.exit(fail ? 1 : 0);
