/* ─────────────────────────────────────────────────────────────────────────────
   ลูกค้าเครดิตที่ไม่มีบิลเกินเกณฑ์ → หน้าขอใบเสนอราคาตั้ง Term Payment เป็น Cash ให้ (เจ้าของสั่ง 2026-09-25)

   ครอบ:
     ฝั่ง server (อ่านอย่างเดียว)
       · บริษัทที่ติดด่าน → credit_hold มีค่า · suggested_terms = Cash เฉพาะ role ที่ตั้งเครดิตทับได้
       · บริษัทที่ไม่ติด → credit_hold = null
       · "Cash" อยู่ในรายการเครดิตที่เลือกได้จริง (สะกดตรงกับ Odoo)
       · ด่านเครดิตยังบล็อกเหมือนเดิม — ใบที่ใช้ Cash ก็ยังติด CUSTOMER_CREDIT_HOLD (เจ้าของเลือกเอง)
     หน้าจริง (1280 และ 390px)
       · เลือกบริษัทที่ติด → ช่องเป็น Cash + ป้าย "ระบบตั้ง" + บรรทัดเหตุผล
       · กด ↺ → กลับเป็นเครดิตของลูกค้า และระบบ **ไม่ตั้งกลับให้เอง** · ปุ่ม "ใช้ Cash" ตั้งกลับได้
       · เลือกบริษัทที่ไม่ติด → ช่องเป็นค่าของลูกค้า ไม่มีคำเตือน
       · โหลดใบกลับมาแก้ (price-approval-reload) ที่ไม่ได้ตั้งเครดิตทับ → ไม่ตั้ง Cash ทับค่าของใบต้นทาง

   **ไม่เขียน DB** — ไม่กด "ยืนยัน" ไม่เรียก propose
   ต้องมี API ที่ CD_PORT (ค่าเริ่มต้น 3099): `PREVIEW_MODE=1 PORT=3099 npx tsx index.ts` จาก worktree
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type Page } from 'puppeteer';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { can } from '../../config/capabilities.js';
import { checkCreditHold, loadCreditPolicy } from '../../services/creditHoldService.js';
import { getQuoteParty, listPaymentTermOptions, DORMANT_CREDIT_TERMS } from '../../services/webQuoteService.js';
import { validateQuotationItems } from '../../services/quotationService.js';

const PORT = process.env.CD_PORT || '3099';
const BASE = `http://localhost:${PORT}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

const policy = await loadCreditPolicy();
if (policy.mode !== 'block') {
  console.log(`เกณฑ์เครดิตปิดอยู่ (mode=${policy.mode}) — ไม่มีบริษัทไหนติด ทดสอบไม่ได้`);
  process.exit(1);
}

// ── บริษัทตัวอย่าง: ติดด่าน / ไม่ติดแต่เป็นลูกค้าเครดิต ───────────────────────────
// ต้องค้นด้วยรหัสลูกค้าได้ตัวเดียว (ช่องค้นหาบนจอ) และมีผู้ติดต่อ
async function sample(held: boolean) {
  const { rows } = await pool.query(`
    SELECT company_id, max(customer_name) AS name, max(customer_reference) AS ref,
           max(customer_payment_terms) AS terms,
           array_agg(contact_id) FILTER (WHERE contact_id > 0) AS contacts
      FROM customers_data_view
     WHERE source <> 'local' AND customer_payment_terms ~ '[0-9]'
     GROUP BY company_id
    HAVING ${held ? `max(last_order_at) < now() - make_interval(months => $1::int)`
                  : `max(last_order_at) >= now() - make_interval(months => $1::int)`}
     ORDER BY company_id DESC LIMIT 200`, [policy.dormant_months]);
  for (const co of rows) {
    if (!/^[A-Z]\/[0-9]{4,}$/.test(co.ref ?? '') || !co.contacts?.length) continue;
    const dup = await pool.query(`SELECT count(DISTINCT company_id)::int AS k FROM customers_data_view WHERE customer_reference = $1`, [co.ref]);
    if (dup.rows[0].k !== 1) continue;
    if ((await checkCreditHold(co.company_id)).held !== held) continue;
    return co;
  }
  return null;
}
const H = await sample(true);
const N = await sample(false);
if (!H || !N) throw new Error('หาบริษัทตัวอย่างไม่ได้');
console.log(`ติดด่าน: ${H.name} ${H.ref} (${H.terms}) · ไม่ติด: ${N.name} ${N.ref} (${N.terms})`);

console.log('\n── server ──');
const hAdmin = await getQuoteParty({ customerId: H.company_id, contactId: null, role: 'admin' });
ok('ติดด่าน → credit_hold มีค่า', hAdmin.credit_hold !== null);
ok('admin → แนะนำ Cash', hAdmin.credit_hold?.suggested_terms === DORMANT_CREDIT_TERMS, String(hAdmin.credit_hold?.suggested_terms));
ok('เกณฑ์เดือนตรงกับหน้า "เกณฑ์เครดิต"', hAdmin.credit_hold?.dormant_months === policy.dormant_months);
const hFull = await getQuoteParty({ customerId: H.company_id, contactId: H.contacts[0], role: 'admin' });
ok('ก้อนเต็ม (มีผู้ติดต่อ) ก็มี credit_hold', hFull.credit_hold?.suggested_terms === DORMANT_CREDIT_TERMS);
const spMay = await can('salesperson', 'quote.payment_terms_override');
const hSp = await getQuoteParty({ customerId: H.company_id, contactId: null, role: 'salesperson' });
ok(`salesperson (ตั้งทับ${spMay ? 'ได้' : 'ไม่ได้'}) → ${spMay ? 'แนะนำ Cash' : 'เห็นแค่คำเตือน'}`,
  hSp.credit_hold !== null && hSp.credit_hold.suggested_terms === (spMay ? DORMANT_CREDIT_TERMS : null),
  String(hSp.credit_hold?.suggested_terms));
const nAdmin = await getQuoteParty({ customerId: N.company_id, contactId: null, role: 'admin' });
ok('ไม่ติดด่าน → credit_hold = null', nAdmin.credit_hold === null);
const opts = (await listPaymentTermOptions()).map((o) => o.value);
ok('"Cash" อยู่ในรายการเครดิตที่เลือกได้', opts.includes(DORMANT_CREDIT_TERMS));
const gate = await validateQuotationItems([], { customerId: H.company_id, stage: 'confirm' as any });
ok('ด่านเครดิตยังบล็อกเหมือนเดิม', gate.violations.some((v) => v.type === 'CUSTOMER_CREDIT_HOLD'));

// ── หน้าจริง ─────────────────────────────────────────────────────────────────
const admin = (await pool.query(`SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`)).rows[0];
const token = jwt.sign({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }, getJwtSecret(), { expiresIn: '1h' });
const { rows: [prod] } = await pool.query(`SELECT product_template_id, model, sales_price FROM products
  WHERE sales_price > 0 AND model ~ '^[A-Z]{2}[A-Z0-9-]*[0-9]' ORDER BY product_template_id LIMIT 1`);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
async function open(width: number, seed: string | null) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => { fail++; console.log('  ✗ หน้าพัง:', (e as Error)?.message ?? String(e)); });
  await page.setViewport({ width, height: 900 });
  await page.evaluateOnNewDocument((t, u, p) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', u);
    if (p && !sessionStorage.getItem('diag-seeded')) {
      sessionStorage.setItem('price-approval-reload', p);
      sessionStorage.setItem('diag-seeded', '1');
    }
  }, token, JSON.stringify(admin), seed ?? '');
  await page.goto(`${BASE}/admin.html?w=${width}#quoterequest`, { waitUntil: 'networkidle2' });
  return page;
}
async function until(fn: () => Promise<boolean>, ms = 10000) {
  for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await wait(250); }
  return false;
}
async function pickCompany(page: Page, ref: string, name: string) {
  await page.$eval('[aria-label="บริษัท / ลูกค้า"]', (el) => el.scrollIntoView({ block: 'center' }));
  await page.click('[aria-label="บริษัท / ลูกค้า"]');
  await page.keyboard.type(ref, { delay: 15 });
  await until(async () => page.evaluate((n) => [...document.querySelectorAll('button')].some((b) => b.innerText.includes(n)), name));
  await page.evaluate((n) => ([...document.querySelectorAll('button')].find((b) => b.innerText.includes(n)) as HTMLElement)?.click(), name);
}
const SEL = 'select[aria-label="เครดิตของใบนี้"]';
/** ค่าของช่อง · ข้อความของตัวเลือกบรรทัดแรก (= เครดิตของลูกค้า) · ป้ายในกรอบ · บรรทัดข้างใต้
 *  แยกกันเพราะ innerText ของ <select> พ่นรายการตัวเลือกทั้งหมดออกมาด้วย — ตรวจรวมแล้วผ่านแบบว่างเปล่า */
const credit = (page: Page) => page.evaluate((sel) => {
  const s = document.querySelector(sel) as HTMLSelectElement | null;
  const dd = s?.closest('dd');
  return {
    value: s?.value ?? null,
    first: s?.options[0]?.text ?? '',
    badge: [...(s?.parentElement?.querySelectorAll('span') ?? [])].map((x) => x.textContent?.trim()).join(' '),
    text: [...(dd?.querySelectorAll('p') ?? [])].map((x) => (x as HTMLElement).innerText).join(' | '),
  };
}, SEL);

for (const width of [1280, 390]) {
  console.log(`\n── หน้าจริง ${width}px ──`);
  let page = await open(width, null);
  await pickCompany(page, H.ref, H.name);
  const got = await until(async () => (await credit(page)).value === DORMANT_CREDIT_TERMS);
  let c = await credit(page);
  ok('ติดด่าน → ช่องเป็น Cash เอง', got, String(c.value));
  ok('มีป้าย "ระบบตั้ง"', c.badge.includes('ระบบตั้ง'), c.badge);
  ok('บรรทัดบอกเหตุผล + เครดิตเดิม', c.text.includes(`ไม่มีบิลเครดิตเกิน ${policy.dormant_months} เดือน`) && c.text.includes(String(H.terms)), c.text);
  ok('ไม่มีบรรทัดน้ำเงิน "✏️ ตั้งเอง"', !c.text.includes('✏️ ตั้งเอง'));
  await page.$eval(SEL, (el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `/tmp/claude-1000/cd-auto-${width}.png` }).catch(() => {});

  await page.click('button[aria-label="ใช้เครดิตของลูกค้า"]');
  await until(async () => (await credit(page)).value === '', 3000);
  await wait(2500); // ให้ /party ยิงรอบใหม่ให้เสร็จ — ถ้าระบบตั้งกลับเอง จะเห็นตรงนี้
  c = await credit(page);
  ok('กด ↺ → กลับเป็นเครดิตของลูกค้า และไม่ถูกตั้งกลับเอง', c.value === '', String(c.value));
  ok('ยังเตือน + ปุ่ม "ใช้ Cash"', c.text.includes('แนะนำให้ใช้ Cash') && c.text.includes('ใช้ Cash'));
  await page.screenshot({ path: `/tmp/claude-1000/cd-reset-${width}.png` }).catch(() => {});
  await page.evaluate(() => ([...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'ใช้ Cash') as HTMLElement)?.click());
  ok('กด "ใช้ Cash" → กลับเป็น Cash', await until(async () => (await credit(page)).value === DORMANT_CREDIT_TERMS, 3000));

  await pickCompany(page, N.ref, N.name);
  const nOk = await until(async () => { const x = await credit(page); return x.value === '' && x.first === String(N.terms); });
  await wait(1500);
  c = await credit(page);
  ok('เปลี่ยนเป็นบริษัทที่ไม่ติด → ค่าของลูกค้า + ป้าย "ค่าเดิม" ไม่มีคำเตือน',
    nOk && c.value === '' && c.badge.includes('ค่าเดิม') && !c.text.includes('ไม่มีบิลเครดิต'), `${c.value} · ${c.first} · ${c.badge} · ${c.text}`);
  await page.close();

  // ── ใบที่โหลดกลับมาแก้ ไม่ได้ตั้งเครดิตทับ → ต้องไม่ถูกตั้ง Cash ทับ ──
  page = await open(width, JSON.stringify({
    request_id: 'diag-credit-dormant-probe',
    customer_id: Number(H.company_id), contact_id: Number(H.contacts[0]), company_name: H.name,
    payment_terms_override: null, note: null, auto_fee: null,
    items: [{ product_id: prod.product_template_id, model: prod.model, name: '', quantity: 1, price: Number(prod.sales_price) }],
  }));
  await until(async () => (await credit(page)).text.includes('ไม่มีบิลเครดิต'), 15000);
  await wait(2000);
  c = await credit(page);
  ok('ใบที่โหลดกลับมาแก้ → คงค่าของใบต้นทาง (ไม่ตั้ง Cash)', c.value === '', String(c.value));
  ok('แต่ยังเตือน + มีปุ่ม "ใช้ Cash"', c.text.includes('แนะนำให้ใช้ Cash'));
  await page.close();
}

await browser.close();
await pool.end();
console.log(fail === 0 ? '\nผ่านทั้งหมด' : `\nล้ม ${fail} ข้อ`);
process.exit(fail === 0 ? 0 : 1);
