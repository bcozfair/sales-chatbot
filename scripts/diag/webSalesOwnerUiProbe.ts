/* ─────────────────────────────────────────────────────────────────────────────
   เปิดหน้า "ขอใบเสนอราคา" จริงแล้วกดจริง — ช่อง "ออกในนาม" ที่เติมเองจากลูกค้า
   แผน: docs/plan-web-quote-auto-salesperson.md §5

   ทำไมต้องมีด่านนี้ ทั้งที่ `build` ผ่านแล้ว: ปุ่มที่อ้างฟังก์ชันที่ไม่เคยถูกเขียน และบรรทัด
   import ที่หาย **build ผ่านทั้งคู่** (AGENTS.md A9) ⇒ "เสร็จ" แปลว่าเปิดดูที่ความกว้างจริง

   ครอบ: เปิดหน้าช่องว่าง → เลือกบริษัท → ระบบเติม + ป้าย "ระบบเลือก" → บริษัทที่หาเซลส์ไม่ได้
   → ช่องว่าง + กล่องเหลือง → เลือกเอง → ป้าย "เลือกเอง" → เปลี่ยนบริษัทแล้วไม่ถูกเขียนทับ
   → กด "ระบบเลือกอัตโนมัติ" บนสุดของรายการ → กลับเป็นเซลส์ของบริษัทปัจจุบัน + ป้าย "ระบบเลือก"
   · ทำซ้ำที่ 1280px และ 390px (390px ชื่อต้องไม่ถูกตัดจนอ่านไม่ออก)
   + API: role salesperson เรียก /sales-owner ไม่ได้ (403)

   ⚠️ **อ่านอย่างเดียว** — ไม่กด "สร้างร่าง" / "แก้ใบเดิม" / "ออกใบ" (สามปุ่มนั้นเขียนแถวจริงลงฐาน)
      ทางพวกนั้นพิสูจน์ด้วย `npm run diag:web-sales-owner` แทน · การเปิดหน้ายังเขียน api_logs
      ตามปกติเหมือนคนเปิดหน้าจริง

   ต้องมี API รันอยู่ที่พอร์ตที่ส่งมาทาง SO_PORT (ค่าเริ่มต้น 3099) — เปิดจาก worktree ด้วย
   `PREVIEW_MODE=1 PORT=3099 npx tsx index.ts` (PREVIEW_MODE = ไม่เริ่ม auto sync ซ้อนตัวจริง)
   ⚠️ `/admin` ตอบ 404 เมื่อรันจาก worktree ⇒ เข้าทาง `/admin.html` ตรง ๆ (เหมือน odooContactsUiProbe)
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type Page } from 'puppeteer';
import jwt from 'jsonwebtoken';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';

const PORT = process.env.SO_PORT || '3099';
const BASE = `http://localhost:${PORT}`;
const SHOTS = fileURLToPath(new URL('../../mockup/shots/', import.meta.url));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SHOTS, { recursive: true });

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

const tokenOf = (a: any) =>
  jwt.sign({ id: a.id, username: a.username, name: a.name, role: a.role }, getJwtSecret(), { expiresIn: '1h' });
const accountOf = async (role: string) =>
  (await pool.query(`SELECT id, username, name, role FROM admin_users WHERE role = $1 ORDER BY id LIMIT 1`, [role])).rows[0];

const admin = await accountOf('admin');
if (!admin) throw new Error('ไม่มีบัญชี admin บนฐานนี้');
const token = tokenOf(admin);
console.log(`ใช้บัญชี ${admin.username} (${admin.role})`);

// ── บริษัทตัวอย่าง: เลือกจากฐานจริงด้วยคำตอบของ API เอง ไม่ใช่ id ที่ฝังไว้ ──────────
//  resolved = ระบบเติมได้ · none = หาเซลส์ไม่ได้ (Odoo ไม่ใส่ และไม่เคยมีใบสั่งขาย)
async function owner(companyId: number): Promise<any> {
  const r = await fetch(`${BASE}/api/admin/webquote/sales-owner?customer_id=${companyId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.ok ? (await r.json()).owner : { status: `HTTP ${r.status}` };
}
async function sampleCompany(where: string, want: string): Promise<{ id: number; name: string; ref: string; owner: any } | null> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (company_id) company_id, customer_name, customer_reference
       FROM customers_data_view
      WHERE customer_reference IS NOT NULL AND ${where}
      ORDER BY company_id, contact_id LIMIT 40`);
  for (const r of rows) {
    const o = await owner(r.company_id);
    if (o.status === want) return { id: r.company_id, name: r.customer_name, ref: r.customer_reference, owner: o };
  }
  return null;
}
const good = await sampleCompany(`salesperson_id IS NOT NULL`, 'resolved');
const good2 = await sampleCompany(`salesperson_id IS NOT NULL AND company_id > 20000`, 'resolved');
const none = await sampleCompany(`company_id IN (SELECT company_id FROM customers_data_view GROUP BY company_id HAVING bool_and(salesperson IS NULL))`, 'none');

console.log('\nAPI');
ok('มีบริษัทตัวอย่างที่ระบบเติมให้ได้ (2 ราย)', !!good && !!good2 && good.id !== good2.id,
  `${good?.ref} → ${good?.owner?.name} · ${good2?.ref} → ${good2?.owner?.name}`);
ok('มีบริษัทตัวอย่างที่หาเซลส์ไม่ได้', !!none, `${none?.ref}`);
const sp = await accountOf('salesperson');
if (sp) {
  const r = await fetch(`${BASE}/api/admin/webquote/sales-owner?customer_id=${good?.id}`, {
    headers: { Authorization: `Bearer ${tokenOf(sp)}` },
  });
  ok('role salesperson เรียก /sales-owner ไม่ได้ (403)', r.status === 403, `HTTP ${r.status}`);
} else console.log('  · (ข้าม — ไม่มีบัญชี role salesperson)');
const bad = await fetch(`${BASE}/api/admin/webquote/sales-owner?customer_id=abc`, { headers: { Authorization: `Bearer ${token}` } });
ok('customer_id ผิดรูป → 400', bad.status === 400, `HTTP ${bad.status}`);

// ── หน้าจริง ─────────────────────────────────────────────────────────────────
// --no-sandbox: PMSV ปิด unprivileged user namespace ⇒ Chrome เปิด sandbox ไม่ได้ (วัด 2026-09-24)
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

/**
 * ป้ายในช่อง — อ่านจาก span ที่ข้อความตรงเป๊ะ ไม่ใช่ `includes` ของทั้งช่อง เพราะคำตั้งต้นของช่อง
 * ("ระบบเลือกอัตโนมัติ หรือเลือกเอง") มีทั้งคำว่า "ระบบเลือก" และ "เลือกเอง" อยู่ในตัว
 */
const chipOf = (page: Page) =>
  page.$eval('[aria-label="พนักงานขายที่จะออกใบในนาม"]', (el) =>
    [...el.querySelectorAll('span')].map((s) => s.textContent).find((t) => t === 'ระบบเลือก' || t === 'เลือกเอง') ?? '');
const PLACEHOLDER = 'ระบบเลือกอัตโนมัติ หรือเลือกเอง';
const AUTO_ROW = 'ระบบเลือกอัตโนมัติ';
/** ข้อความในช่อง "ออกในนาม" (ช่องที่ aria-label = พนักงานขายที่จะออกใบในนาม) */
const spFieldText = (page: Page) =>
  page.$eval('[aria-label="พนักงานขายที่จะออกใบในนาม"]', (el) => (el.textContent || '').replace(/\s+/g, ' ').trim());

async function pickCustomer(page: Page, ref: string) {
  // 390px: แถบลอยท้ายจอ (ยกเลิก/ยืนยัน) บังช่องได้ ⇒ เลื่อนช่องมากลางจอก่อนกด ไม่งั้นคลิกโดนแถบแทน
  await page.$eval('[aria-label="บริษัท / ลูกค้า"]', (el) => el.scrollIntoView({ block: 'center' }));
  await page.click('[aria-label="บริษัท / ลูกค้า"]');
  await page.keyboard.type(ref, { delay: 20 });
  // รอผลค้นจาก /api/customers/search แล้วกดตัวที่มีรหัสนี้
  for (let i = 0; i < 40; i++) {
    const clicked = await page.evaluate((r) => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(r));
      if (btn) { (btn as HTMLButtonElement).click(); return true; }
      return false;
    }, ref);
    if (clicked) return;
    await wait(250);
  }
  await page.screenshot({ path: `${SHOTS}so-pick-fail.png`, fullPage: true });
  throw new Error(`ค้นบริษัท ${ref} ไม่เจอในช่องเลือกบริษัท (ภาพ: mockup/shots/so-pick-fail.png)`);
}
/** รอจนป้ายในช่องเป็นค่าที่ต้องการ ('' = ไม่มีป้าย) แล้วคืนข้อความทั้งช่อง */
async function waitChip(page: Page, want: string, ms = 8000): Promise<string> {
  for (let i = 0; i < ms / 200; i++) {
    if ((await chipOf(page)) === want) break;
    await wait(200);
  }
  return spFieldText(page);
}
/** แถวในรายการที่กางอยู่ของช่อง "ออกในนาม" */
const listRows = (page: Page) =>
  page.evaluate(() => {
    const box = document.querySelector('[aria-label="พนักงานขายที่จะออกใบในนาม"]')?.parentElement;
    return [...(box?.querySelectorAll('button') ?? [])].map((b) => (b.textContent || '').trim());
  });
async function openSpList(page: Page) {
  await page.$eval('[aria-label="พนักงานขายที่จะออกใบในนาม"]', (el) => el.scrollIntoView({ block: 'center' }));
  await page.click('[aria-label="พนักงานขายที่จะออกใบในนาม"]');
  await wait(300);
}
const noticeText = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('div')].map((d) => d.textContent || '')
    .find((t) => t.includes('เลือกพนักงานขายเองก่อนออกใบ') && t.length < 200) ?? '');

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
  await page.waitForSelector('[aria-label="พนักงานขายที่จะออกใบในนาม"]', { timeout: 15000 });

  const t0 = await spFieldText(page);
  ok('เปิดหน้า: ช่องว่าง ไม่มีป้าย', t0.includes(PLACEHOLDER) && (await chipOf(page)) === '', t0);

  if (good) {
    await pickCustomer(page, good.ref);
    const t1 = await waitChip(page, 'ระบบเลือก');
    ok('เลือกบริษัท → เติมเซลส์ + ป้าย "ระบบเลือก"', t1.includes(good.owner.name) && (await chipOf(page)) === 'ระบบเลือก', t1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${SHOTS}so-auto-${width}.png` });
    {
      // ชื่อต้องอ่านออกทุกความกว้าง — เคยหายทั้งคำที่ 1280 (ช่องกว้างแค่ ~196px) · วัดจาก span ชื่อ
      const field = await page.$('[aria-label="พนักงานขายที่จะออกใบในนาม"]');
      await field?.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await field?.screenshot({ path: `${SHOTS}so-field-${width}.png` });
      const m = await page.$eval('[aria-label="พนักงานขายที่จะออกใบในนาม"] .font-semibold', (el) => ({
        text: el.textContent, sw: (el as HTMLElement).scrollWidth, cw: (el as HTMLElement).clientWidth,
      }));
      ok(`${width}px: ชื่อเซลส์ไม่ถูกตัด`, m.sw <= m.cw + 1, `${m.text} กว้าง ${m.cw}/${m.sw}px`);
      // ป้ายต้องอยู่ในกรอบช่อง ไม่ล้นไปทับกรอบลายเซ็น
      const inside = await page.$eval('[aria-label="พนักงานขายที่จะออกใบในนาม"]', (el) => {
        const box = el.getBoundingClientRect();
        const chip = [...el.querySelectorAll('span')].find((s) => s.textContent === 'ระบบเลือก');
        const c = chip?.getBoundingClientRect();
        return !!c && c.right <= box.right;
      });
      ok(`${width}px: ป้าย "ระบบเลือก" อยู่ในกรอบช่อง`, inside);
    }
  }
  if (none) {
    await pickCustomer(page, none.ref);
    const t2 = await waitChip(page, '');
    const n = await noticeText(page);
    ok('บริษัทที่หาเซลส์ไม่ได้ → ช่องว่าง (ไม่ค้างคนของบริษัทก่อน)', t2.includes(PLACEHOLDER) && (await chipOf(page)) === '', t2);
    ok('  และมีกล่องบอกเหตุผล', n.includes('เลือกพนักงานขายเองก่อนออกใบ'), n.slice(0, 80));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${SHOTS}so-none-${width}.png` });
  }
  // เลือกเอง → ป้าย "เลือกเอง" → เปลี่ยนบริษัทแล้วไม่ถูกเขียนทับ
  await openSpList(page);
  const rows0 = await listRows(page);
  ok('รายการมีแถว "ระบบเลือกอัตโนมัติ" เป็นแถวแรก', rows0[0]?.startsWith(AUTO_ROW) === true, rows0[0]);
  // พิมพ์ค้น ⇒ แถวนี้ต้องหาย (มันไม่ใช่ชื่อคน)
  await page.keyboard.type('คุณ', { delay: 20 });
  await wait(200);
  ok('  พิมพ์ค้นแล้วแถวนั้นหาย', !(await listRows(page)).some((t) => t.startsWith(AUTO_ROW)));
  await page.keyboard.press('Escape');
  await openSpList(page);
  // ตัวที่เลือกเอง = คนแรกที่ไม่ใช่คนที่ระบบเติมไว้ ⇒ พิสูจน์ได้จริงว่ากด "อัตโนมัติ" แล้วชื่อเปลี่ยนกลับ
  const manualName = await page.evaluate((auto, avoid) => {
    const box = document.querySelector('[aria-label="พนักงานขายที่จะออกใบในนาม"]')?.parentElement;
    const btn = [...(box?.querySelectorAll('button') ?? [])].find((b) => {
      const t = b.textContent || '';
      return !t.startsWith(auto) && !(avoid && t.includes(avoid));
    }) as HTMLButtonElement | undefined;
    const name = btn?.querySelector('span')?.textContent ?? '';
    btn?.click();
    return name.trim();
  }, AUTO_ROW, good2?.owner?.name ?? '');
  const t3 = await waitChip(page, 'เลือกเอง');
  ok('เลือกเอง → ป้าย "เลือกเอง"', t3.includes(manualName) && (await chipOf(page)) === 'เลือกเอง', t3);
  if (good2) {
    await pickCustomer(page, good2.ref);
    await wait(2000);   // ให้เวลา /sales-owner ตอบ ถ้าระบบจะเขียนทับ มันต้องทับภายในนี้
    const t4 = await spFieldText(page);
    ok('เปลี่ยนบริษัทหลังเลือกเอง → ไม่ถูกเขียนทับ', t4.includes(manualName) && (await chipOf(page)) === 'เลือกเอง', t4);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${SHOTS}so-manual-${width}.png` });

    // กลับไปให้ระบบเลือก — ต้องได้เซลส์ของบริษัท "ปัจจุบัน" (good2) ไม่ใช่ของรายแรก
    await openSpList(page);
    await page.screenshot({ path: `${SHOTS}so-list-${width}.png` });
    await page.evaluate((auto) => {
      const box = document.querySelector('[aria-label="พนักงานขายที่จะออกใบในนาม"]')?.parentElement;
      const btn = [...(box?.querySelectorAll('button') ?? [])].find((b) => (b.textContent || '').startsWith(auto));
      (btn as HTMLButtonElement | undefined)?.click();
    }, AUTO_ROW);
    const t5 = await waitChip(page, 'ระบบเลือก');
    ok('กด "ระบบเลือกอัตโนมัติ" → กลับเป็นเซลส์ของบริษัทปัจจุบัน + ป้าย "ระบบเลือก"',
      t5.includes(good2.owner.name) && (await chipOf(page)) === 'ระบบเลือก', t5);
    const rows1 = (await openSpList(page), await listRows(page));
    ok('  แถว "ระบบเลือกอัตโนมัติ" มีเครื่องหมายว่ากำลังใช้อยู่',
      await page.evaluate((auto) => {
        const box = document.querySelector('[aria-label="พนักงานขายที่จะออกใบในนาม"]')?.parentElement;
        const btn = [...(box?.querySelectorAll('button') ?? [])].find((b) => (b.textContent || '').startsWith(auto));
        return !!btn?.querySelector('svg.lucide-check');
      }, AUTO_ROW), rows1[0]);
    await page.keyboard.press('Escape');
  }
  await page.close();
}

await browser.close();
await pool.end();
console.log(`\n${fail === 0 ? 'ผ่านทั้งหมด' : `ล้ม ${fail} ข้อ`} · ภาพอยู่ที่ mockup/shots/so-*.png`);
process.exit(fail === 0 ? 0 : 1);
