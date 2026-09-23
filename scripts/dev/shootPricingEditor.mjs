/* ถ่ายภาพหน้า "แก้ราคาทีละรุ่น" ของจริง — เครื่อง dev เท่านั้น
   ต้องมีเซิร์ฟเวอร์รันอยู่ และ .token (จาก scripts/dev/mintAdminToken.ts) */
import puppeteer from 'puppeteer';
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3099';
const token = readFileSync('.token', 'utf8').trim();
mkdirSync('shots', { recursive: true });

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function open(w, h) {
  await page.setViewport({ width: w, height: h });
  await page.goto(`${BASE}/admin.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    sessionStorage.setItem('admin_token', t);
    const p = JSON.parse(atob(t.split('.')[1]));
    sessionStorage.setItem('admin_user', JSON.stringify(p));
  }, token);
  // goto ที่ต่างกันแค่ hash ไม่โหลดหน้าใหม่ ⇒ แอปจะยังอยู่ในสถานะ "ยังไม่ล็อกอิน"
  // ต้อง reload จริงหลังยัด sessionStorage ไม่งั้นได้หน้า login มาถ่ายรูปแทน
  await page.evaluate(() => { location.hash = '#pricing'; });
  await page.reload({ waitUntil: 'networkidle0' });
  // รอจนปุ่มแก้ราคาโผล่จริง — `networkidle0` จบก่อนที่ /overview จะกลับมาวาดเสร็จ
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((x) => (x.getAttribute('aria-label') ?? '').startsWith('แก้ราคารุ่น')),
    { timeout: 15000 },
  );
}

for (const [w, h, tag] of [[1280, 1400, '1280'], [390, 1000, '390']]) {
  await open(w, h);
  // กดปุ่มดินสอของ BH-01
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'แก้ราคารุ่น BH-01');
    if (!b) return false;
    b.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `shots/edit-${tag}.png`, fullPage: tag === '1280' });
  console.log(tag, 'opened=', opened, 'scrollX=', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
}

// กล่องแก้กฎ
await open(1280, 1000);
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'แก้ราคารุ่น BH-01')?.click();
});
await new Promise((r) => setTimeout(r, 900));
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '').startsWith('แก้กฎ สายยาวเกิน'))?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'shots/edit-rule.png' });

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.slice(0, 5).join('\n') : 'ไม่มี error ใน console');
await browser.close();
