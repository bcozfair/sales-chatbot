/* ─────────────────────────────────────────────────────────────────────────────
   เปิดหน้า "ขอใบเสนอราคา" จริงแล้วกดจริง — แก้ชื่อ/ราคาของค่าขนส่งที่กฎเติมให้ (เจ้าของสั่ง 2026-09-25)

   ครอบ:
     · บรรทัดของกฎขึ้นมาพร้อมช่องชื่อ (เลือก/พิมพ์) + ช่องราคา ค่าตั้งต้นตรงกับหน้าตั้งค่า
     · แก้ราคา/ชื่อ → ผลตรวจรอบใหม่ใช้ค่าที่แก้ (ยอดของบรรทัดเปลี่ยน) + ปุ่มคืนค่าโผล่
     · ยอดสินค้าถึงเกณฑ์ → บรรทัดหาย (ยังเป็นของกฎ) · ลดกลับ → กลับมาพร้อมค่าที่แก้ไว้
     · ปุ่มคืนค่า → ชื่อ/ราคาจากหน้าตั้งค่า
     · เปิดคำขอกลับเข้าฟอร์มพร้อม auto_fee → ค่าที่แก้ไว้ตามมา
   ทำซ้ำที่ 1280px และ 390px

   ป้อนฟอร์มผ่านก้อน sessionStorage ของ "แก้แล้วส่งใหม่" (APPROVAL_RELOAD_KEY) — ไม่ต้องกดค้นบริษัท
   และ **ไม่เขียน DB** (ผลตรวจ = /preview ซึ่งเป็น dry-run) · ไม่กด "ยืนยัน"
   ต้องมี API ที่ AF_PORT (ค่าเริ่มต้น 3099): `PREVIEW_MODE=1 PORT=3099 npx tsx index.ts` จาก worktree
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type Page } from 'puppeteer';
import jwt from 'jsonwebtoken';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { previewDraft } from '../../services/webQuoteService.js';
import { loadShippingFeeConfig } from '../../services/shippingFee.js';

const PORT = process.env.AF_PORT || '3099';
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
const cfg = await loadShippingFeeConfig();
if (!cfg.isActive || cfg.productId === null) throw new Error('shipping_fee_config ปิดอยู่ — ทดสอบไม่ได้');

// ── ลูกค้า + สินค้าราคาถูกที่พรีวิวแล้วกฎเติมค่าขนส่งให้ และไม่ติดกฎข้ออื่น ─────────────
const { rows: custs } = await pool.query(`
  SELECT company_id, contact_id, customer_name FROM customers_data_view
   WHERE source <> 'local' AND customer_reference IS NOT NULL AND contact_id IS NOT NULL
   ORDER BY company_id LIMIT 15`);
const { rows: prods } = await pool.query(`
  SELECT product_template_id, model, sales_price FROM products
   WHERE sales_price BETWEEN 50 AND $1 AND quantity_on_hand_unreserved > 50
   ORDER BY quantity_on_hand_unreserved DESC LIMIT 15`, [cfg.thresholdBeforeVat / 4]);
let seed: { customer_id: number; contact_id: number; company_name: string; product: any } | null = null;
outer: for (const c of custs) {
  for (const p of prods) {
    try {
      const pv = await previewDraft({
        customerId: c.company_id, contactId: c.contact_id, paymentTermsOverride: 'Cash',
        items: [{ product_template_id: p.product_template_id, quantity: 1 }],
      } as any);
      const fee = pv.quotes.flatMap((q: any) => q.items).some((it: any) => it.is_shipping_fee);
      if (fee && pv.violations.length === 0) {
        seed = { customer_id: c.company_id, contact_id: c.contact_id, company_name: c.customer_name, product: p };
        break outer;
      }
    } catch { /* ลูกค้ารายนี้ติดด่าน — ลองรายถัดไป */ }
  }
}
if (!seed) throw new Error('หาลูกค้า+สินค้าที่กฎค่าขนส่งทำงานไม่ได้');
// จำนวนที่ทำให้ยอดถึงเกณฑ์แน่ ๆ (ราคาหลังส่วนลดอาจต่ำกว่าราคาตั้ง ⇒ เผื่อ 2 เท่า)
const bigQty = Math.ceil((cfg.thresholdBeforeVat * 2) / Number(seed.product.sales_price));
console.log(`ลูกค้า ${seed.company_name} · สินค้า ${seed.product.model} ฿${seed.product.sales_price} · เกณฑ์ ${cfg.thresholdBeforeVat} · จำนวนที่ถึงเกณฑ์ ${bigQty}`);

const payload = (autoFee: { name: string; price: number } | null) => JSON.stringify({
  request_id: 'diag-auto-fee-probe',
  customer_id: seed!.customer_id,
  contact_id: seed!.contact_id,
  company_name: seed!.company_name,
  payment_terms_override: 'Cash',
  note: null,
  items: [{ product_id: seed!.product.product_template_id, model: seed!.product.model, name: '', quantity: 1, price: Number(seed!.product.sales_price) }],
  auto_fee: autoFee,
});

const NAME = '[aria-label="ชื่อรายการค่าบริการ"]';
const PRICE = '[aria-label="ราคาค่าขนส่ง"]';
const RESET = '[aria-label="ใช้ชื่อและราคาจากหน้าตั้งค่า"]';
const val = (page: Page, sel: string) => page.$eval(sel, (el) => (el as HTMLInputElement).value).catch(() => null);
/** ยอดในเซลล์ "ราคา" ของแถวค่าขนส่ง */
const feeTotal = (page: Page) =>
  page.$eval(PRICE, (el) => el.closest('tr')?.querySelector('td[data-k="ราคา"]')?.textContent?.trim() ?? '').catch(() => null);
async function waitFor(page: Page, fn: () => Promise<boolean>, ms = 10000) {
  for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await wait(250); }
  return false;
}
async function typeInto(page: Page, sel: string, text: string) {
  await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
  await page.click(sel);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.type(text, { delay: 10 });
}
const money2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
async function open(width: number, autoFee: { name: string; price: number } | null) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => { fail++; console.log('  ✗ หน้าพัง:', (e as Error)?.message ?? String(e)); });
  await page.setViewport({ width, height: 900 });
  await page.evaluateOnNewDocument((t, u, p) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', u);
    if (!sessionStorage.getItem('diag-seeded')) {
      sessionStorage.setItem('price-approval-reload', p);
      sessionStorage.setItem('diag-seeded', '1');
    }
  }, token, JSON.stringify({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }), payload(autoFee));
  await page.goto(`${BASE}/admin.html?w=${width}#quoterequest`, { waitUntil: 'networkidle2' });
  return page;
}

for (const width of [1280, 390]) {
  console.log(`\nหน้าจอ ${width}px`);
  const page = await open(width, null);
  const shown = await waitFor(page, async () => (await val(page, PRICE)) !== null, 15000);
  ok('กฎเติมค่าขนส่ง → แถวมีช่องชื่อ + ช่องราคา', shown);
  if (!shown) { await page.screenshot({ path: `${SHOTS}af-fail-${width}.png`, fullPage: true }); await page.close(); continue; }
  ok('  ชื่อตั้งต้น = ชื่อจากหน้าตั้งค่า', (await val(page, NAME)) === cfg.defaultItemName, String(await val(page, NAME)));
  ok('  ราคาตั้งต้น = ราคาจากหน้าตั้งค่า', Number(await val(page, PRICE)) === cfg.feePrice, String(await val(page, PRICE)));
  ok('  ยังไม่แก้ = ไม่มีปุ่มคืนค่า', (await page.$(RESET)) === null);
  const addDisabled = await page.evaluate(() =>
    ([...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'เพิ่มค่าบริการ') as HTMLButtonElement)?.disabled);
  ok('  ปุ่ม "เพิ่มค่าบริการ" ยังปิด (มีได้บรรทัดเดียว)', addDisabled === true);

  // แก้ราคา
  const newPrice = cfg.feePrice + 50;
  await typeInto(page, PRICE, String(newPrice));
  const priced = await waitFor(page, async () => (await feeTotal(page))?.includes(money2(newPrice)) === true);
  ok('แก้ราคา → ผลตรวจรอบใหม่ใช้ราคาที่แก้', priced, String(await feeTotal(page)));
  ok('  ปุ่มคืนค่าโผล่', (await page.$(RESET)) !== null);

  // แก้ชื่อจากรายการ
  await page.$eval(NAME, (el) => el.scrollIntoView({ block: 'center' }));
  await page.click('[aria-label="เลือกจากชื่อที่ใช้บ่อย"]');
  await wait(200);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find((x) => (x.textContent || '').trim() === 'ค่าเปลี่ยนแปลงสินค้า') as HTMLButtonElement;
    b?.click();
  });
  await wait(1500);
  ok('เลือกชื่อจากรายการ → ช่องชื่อเปลี่ยน และไม่ถูกผลตรวจเขียนทับ', (await val(page, NAME)) === 'ค่าเปลี่ยนแปลงสินค้า', String(await val(page, NAME)));
  ok('  ราคาที่แก้ไว้ยังอยู่', Number(await val(page, PRICE)) === newPrice, String(await val(page, PRICE)));
  await page.$eval(PRICE, (el) => el.closest('tr')?.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${SHOTS}af-edited-${width}.png` });

  // ยอดถึงเกณฑ์ → หาย · ลดกลับ → กลับมาพร้อมค่าที่แก้
  await typeInto(page, '[aria-label="จำนวน"]', String(bigQty));
  const gone = await waitFor(page, async () => (await val(page, PRICE)) === null, 12000);
  ok('ยอดถึงเกณฑ์ → บรรทัดหายเอง (ยังเป็นของกฎ)', gone);
  await typeInto(page, '[aria-label="จำนวน"]', '1');
  const back = await waitFor(page, async () => (await val(page, PRICE)) !== null, 12000);
  ok('ลดยอดกลับ → บรรทัดกลับมา', back);
  ok('  พร้อมชื่อ/ราคาที่แก้ไว้',
    (await val(page, NAME)) === 'ค่าเปลี่ยนแปลงสินค้า' && Number(await val(page, PRICE)) === newPrice,
    `${await val(page, NAME)} · ${await val(page, PRICE)}`);

  // คืนค่า
  await page.$eval(RESET, (el) => el.scrollIntoView({ block: 'center' }));
  await page.click(RESET);
  const reset = await waitFor(page, async () =>
    (await val(page, NAME)) === cfg.defaultItemName && Number(await val(page, PRICE)) === cfg.feePrice
    && (await feeTotal(page))?.includes(money2(cfg.feePrice)) === true);
  ok('กดคืนค่า → ชื่อ/ราคาจากหน้าตั้งค่า และยอดของบรรทัดตาม', reset, `${await val(page, NAME)} · ${await feeTotal(page)}`);
  ok('  ปุ่มคืนค่าหายไป', (await page.$(RESET)) === null);
  await page.close();

  // เปิดคำขอกลับเข้าฟอร์มพร้อมค่าที่แก้ไว้
  const page2 = await open(width, { name: 'ค่าส่งนอกเขต (ทดสอบ)', price: 321 });
  const shown2 = await waitFor(page2, async () => (await val(page2, PRICE)) !== null, 15000);
  ok('เปิดคำขอกลับเข้าฟอร์ม → ค่าที่แก้ไว้ตามมา',
    shown2 && (await val(page2, NAME)) === 'ค่าส่งนอกเขต (ทดสอบ)' && Number(await val(page2, PRICE)) === 321,
    `${await val(page2, NAME)} · ${await val(page2, PRICE)}`);
  ok('  ผลตรวจใช้ราคานั้น', await waitFor(page2, async () => (await feeTotal(page2))?.includes('321.00') === true), String(await feeTotal(page2)));
  await page2.close();
}
await browser.close();
await pool.end();
console.log(fail ? `\n✗ ล้ม ${fail} ข้อ` : '\n✓ ผ่านทุกข้อ');
process.exit(fail ? 1 : 0);
