/* ─────────────────────────────────────────────────────────────────────────────
   เปิดหน้า "ขอใบเสนอราคา" จริงแล้วกดจริง — ช่องชื่อของบรรทัดค่าบริการที่คนกดเพิ่มเอง

   ครอบ (เจ้าของสั่ง 2026-09-25):
     · กด "เพิ่มค่าบริการ" → ชื่อตั้งต้นเป็น "ค่าบริการ" (ไม่ใช่ "ค่าขนส่ง" ของกฎอัตโนมัติ)
     · กดลูกศร → รายการชื่อที่ใช้บ่อยตรงกับที่ server ส่งมา → กดแล้วชื่อในช่องเปลี่ยนตาม
     · พิมพ์ชื่อเองได้ และพิมพ์แล้วกล่องหุบ
     · ช่องค้นสินค้า (ใช้ตัววางกล่องลอยตัวเดียวกัน) ยังกางผลค้นได้
   ทำซ้ำที่ 1280px และ 390px

   ⚠️ **อ่านอย่างเดียว** — ไม่กด "สร้างร่าง" / "ออกใบ" · ต้องมี API รันอยู่ที่ SVC_PORT (ค่าเริ่มต้น 3099)
      เปิดจาก worktree ด้วย `PREVIEW_MODE=1 PORT=3099 npx tsx index.ts` แล้วเข้าทาง `/admin.html`
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type Page } from 'puppeteer';
import jwt from 'jsonwebtoken';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';

const PORT = process.env.SVC_PORT || '3099';
const BASE = `http://localhost:${PORT}`;
const SHOTS = fileURLToPath(new URL('../../mockup/shots/', import.meta.url));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SHOTS, { recursive: true });

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

const admin = (await pool.query(`SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`)).rows[0];
if (!admin) throw new Error('ไม่มีบัญชี admin บนฐานนี้');
const token = jwt.sign({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }, getJwtSecret(), { expiresIn: '1h' });

console.log('API');
const cfg = await (await fetch(`${BASE}/api/shipping-fee/config`)).json();
const presets: string[] = cfg.manual_name_presets ?? [];
ok('config ส่งชื่อตั้งต้นของบรรทัดที่เพิ่มเอง = "ค่าบริการ"', cfg.manual_item_name === 'ค่าบริการ', String(cfg.manual_item_name));
ok('config ส่งรายการชื่อ 3 รายการ', presets.length === 3, presets.join(' | '));
ok('ชื่อของกฎอัตโนมัติยังอยู่ช่องเดิม (หน้า LIFF อ่านช่องนี้)', typeof cfg.default_item_name === 'string' && cfg.default_item_name.length > 0, cfg.default_item_name);

const NAME = '[aria-label="ชื่อรายการค่าบริการ"]';
const nameValue = (page: Page) => page.$eval(NAME, (el) => (el as HTMLInputElement).value);
const listOptions = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('[role="listbox"] [role="option"]')].map((b) => (b.textContent || '').trim()));

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
for (const width of [1280, 390]) {
  console.log(`\nหน้าจอ ${width}px`);
  const page = await browser.newPage();
  page.on('pageerror', (e) => { fail++; console.log('  ✗ หน้าพัง:', (e as Error)?.message ?? String(e)); });
  await page.setViewport({ width, height: 900 });
  await page.evaluateOnNewDocument((t, u) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', u);
  }, token, JSON.stringify({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }));
  await page.goto(`${BASE}/admin.html?w=${width}#quoterequest`, { waitUntil: 'networkidle2' });

  // ปุ่มเปิดใช้ได้เมื่ออ่าน config ค่าบริการเสร็จแล้วเท่านั้น
  let clicked = false;
  for (let i = 0; i < 40 && !clicked; i++) {
    clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'เพิ่มค่าบริการ') as HTMLButtonElement | undefined;
      if (!b || b.disabled) return false;
      b.scrollIntoView({ block: 'center' });
      b.click();
      return true;
    });
    if (!clicked) await wait(250);
  }
  ok('กด "เพิ่มค่าบริการ" ได้', clicked);
  await page.waitForSelector(NAME, { timeout: 5000 });
  ok('ชื่อตั้งต้น = "ค่าบริการ"', (await nameValue(page)) === 'ค่าบริการ', await nameValue(page));

  // ลูกศร → รายการ
  await page.$eval(NAME, (el) => el.scrollIntoView({ block: 'center' }));
  await page.click('[aria-label="เลือกจากชื่อที่ใช้บ่อย"]');
  await wait(200);
  const opts = await listOptions(page);
  ok('กดลูกศร → รายการตรงกับ config', JSON.stringify(opts) === JSON.stringify(presets), opts.join(' | '));
  await page.screenshot({ path: `${SHOTS}svc-name-list-${width}.png` });
  // กล่องต้องอยู่ในจอทั้งกล่อง (390px ห้ามล้นขวา)
  const inView = await page.evaluate(() => {
    const r = document.querySelector('[role="listbox"]')?.getBoundingClientRect();
    return !!r && r.left >= 0 && r.right <= window.innerWidth;
  });
  ok(`${width}px: กล่องรายการอยู่ในจอ`, inView);

  // เลือกตัวที่สอง
  await page.evaluate((want) => {
    const b = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find((x) => (x.textContent || '').trim() === want) as HTMLButtonElement;
    b.click();
  }, presets[1]);
  await wait(200);
  ok('เลือกจากรายการ → ชื่อในช่องเปลี่ยน', (await nameValue(page)) === presets[1], await nameValue(page));
  ok('  และกล่องหุบ', (await listOptions(page)).length === 0);

  // เปิดใหม่ → ตัวที่เลือกอยู่มีเครื่องหมายถูก
  await page.click('[aria-label="เลือกจากชื่อที่ใช้บ่อย"]');
  await wait(200);
  const checked = await page.evaluate(() =>
    [...document.querySelectorAll('[role="listbox"] [role="option"]')].filter((b) => b.querySelector('svg')).map((b) => (b.textContent || '').trim()));
  ok('ตัวที่เลือกอยู่มีเครื่องหมายถูก (ตัวเดียว)', checked.length === 1 && checked[0] === presets[1], checked.join(' | '));

  // พิมพ์เอง → กล่องหุบ และชื่อเป็นสิ่งที่พิมพ์
  // ไม่ใช้ triple-click: ข้อความไทยไม่มีช่องว่าง เลือกไม่ครบทั้งช่อง ⇒ Ctrl+A แทน
  await page.click(NAME);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.type('ค่าติดตั้งหน้างาน', { delay: 10 });
  await wait(200);
  ok('พิมพ์ชื่อเองได้', (await nameValue(page)) === 'ค่าติดตั้งหน้างาน', await nameValue(page));
  ok('  พิมพ์แล้วกล่องหุบ', (await listOptions(page)).length === 0);

  // คีย์บอร์ด: ↓ กาง · ↓ เลื่อนไปตัวแรก · Enter เลือก
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await wait(200);
  ok('คีย์บอร์ด ↓ ↓ Enter → เลือกตัวแรก', (await nameValue(page)) === presets[0], await nameValue(page));

  // คลิกนอกกล่อง → หุบ
  await page.click('[aria-label="เลือกจากชื่อที่ใช้บ่อย"]');
  await wait(150);
  await page.mouse.click(5, 5);
  await wait(150);
  ok('คลิกนอกกล่อง → หุบ', (await listOptions(page)).length === 0);

  // ช่องค้นสินค้าใช้ตัววางกล่องตัวเดียวกัน — ต้องยังกางผลค้นได้
  const searchSel = 'input[placeholder^="เพิ่มสินค้า"]';
  await page.$eval(searchSel, (el) => el.scrollIntoView({ block: 'center' }));
  await page.click(searchSel);
  await page.keyboard.type('TS', { delay: 20 });
  let n = 0;
  for (let i = 0; i < 30 && n === 0; i++) {
    await wait(250);
    n = await page.evaluate(() => document.querySelectorAll('[role="listbox"] [role="option"]').length);
  }
  ok('ช่องค้นสินค้ายังกางผลค้นได้', n > 0, `${n} รายการ`);
  await page.close();
}
await browser.close();
await pool.end();
console.log(fail ? `\n✗ ล้ม ${fail} ข้อ` : '\n✓ ผ่านทุกข้อ');
process.exit(fail ? 1 : 0);
