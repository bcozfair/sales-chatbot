/* ─────────────────────────────────────────────────────────────────────────────
   หัวใบขึ้นตั้งแต่เจอบริษัท + เลือกผู้ติดต่อคนเดียวของบริษัทให้เอง (เจ้าของสั่ง 2026-09-25)

   ครอบ:
     ฝั่ง server (อ่านอย่างเดียว)
       · getQuoteParty ไม่ส่งผู้ติดต่อ → ก้อนระดับบริษัท (contact_id = null · รหัสลูกค้า/เลขภาษี ตรง)
       · matchQuoteContact: ชื่อของคนนั้น → ตรง · ชื่อที่ไม่มีจริง → ไม่ตรง · ว่าง → ไม่ตรง
     หน้าจริง (1280 และ 390px)
       · เลือกบริษัทที่มีผู้ติดต่อคนเดียว → ผู้ติดต่อถูกเลือกให้ + หัวใบเต็ม
       · เลือกบริษัทที่มีหลายคน → หัวใบขึ้นรหัสลูกค้า/เลขภาษี ทั้งที่ผู้ติดต่อยังว่าง และไม่เลือกให้
       · เปิดคำขอกลับเข้าฟอร์ม (ผู้ติดต่อเดิมไม่อยู่ในบริษัทนี้แล้ว) → ไม่สลับเป็นคนเดียวที่เหลือ

   **ไม่เขียน DB** — ไม่กด "ยืนยัน" ไม่เรียก propose (ซึ่งเขียนประวัติลง messages)
   ต้องมี API ที่ CH_PORT (ค่าเริ่มต้น 3099): `PREVIEW_MODE=1 PORT=3099 npx tsx index.ts` จาก worktree
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type Page } from 'puppeteer';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { getQuoteParty, matchQuoteContact } from '../../services/webQuoteService.js';

const PORT = process.env.CH_PORT || '3099';
const BASE = `http://localhost:${PORT}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

// ── บริษัทตัวอย่าง: คนเดียว / หลายคน ─────────────────────────────────────────
// สแกนแค่บริษัทล่าสุด 3,000 รายก่อนจัดกลุ่ม — ทั้งตาราง (82k แถว) เกินเพดาน 15 วิของ pool
const { rows: pool3k } = await pool.query(`
  WITH recent AS (SELECT DISTINCT company_id FROM customers_data_view WHERE source <> 'local'
                   ORDER BY company_id DESC LIMIT 3000)
  SELECT company_id, max(customer_name) AS name, max(customer_reference) AS ref, max(customer_tax_id) AS tax,
         count(*) FILTER (WHERE contact_id > 0) AS n, min(contact_id) FILTER (WHERE contact_id > 0) AS contact_id
    FROM customers_data_view WHERE company_id IN (SELECT company_id FROM recent)
   GROUP BY company_id ORDER BY company_id DESC`);
const sampleCompany = async (single: boolean) => {
  for (const co of pool3k) {
    const n = Number(co.n);
    if (single ? n !== 1 : n < 3 || n > 6) continue;
    if (!/^[A-Z]\/[0-9]{4,}$/.test(co.ref ?? '') || !/^[0-9]{13}$/.test(co.tax ?? '')) continue;
    // รหัสลูกค้าต้องชี้บริษัทเดียว ไม่งั้นช่องค้นอาจคืนหลายรายแล้วกดผิดตัว
    const dup = await pool.query(`SELECT count(DISTINCT company_id)::int AS k FROM customers_data_view WHERE customer_reference = $1`, [co.ref]);
    if (dup.rows[0].k !== 1) continue;
    const c = (await pool.query(`SELECT contact_name, COALESCE(contact_mobile, contact_phone) AS phone FROM customers_data_view WHERE contact_id = $1`, [co.contact_id])).rows[0];
    if (!c || String(c.contact_name ?? '').length <= 4) continue;
    return { ...co, contact_name: c.contact_name, phone: c.phone };
  }
  return null;
};
const S = await sampleCompany(true);
const M = await sampleCompany(false);
if (!S || !M) throw new Error('หาบริษัทตัวอย่างไม่ได้');
console.log(`คนเดียว: ${S.name} ${S.ref} (${S.contact_name}) · หลายคน: ${M.name} ${M.ref}`);

console.log('\n── server ──');
const co = await getQuoteParty({ customerId: S.company_id, contactId: undefined });
ok('ไม่ส่งผู้ติดต่อ → ก้อนระดับบริษัท', co.contact_id === null && co.reference === S.ref && co.tax_id === S.tax, `${co.reference} ${co.tax_id}`);
const coEmpty = await getQuoteParty({ customerId: M.company_id, contactId: '' });
ok('contact_id ว่าง → ก้อนระดับบริษัท', coEmpty.contact_id === null && coEmpty.reference === M.ref);
const full = await getQuoteParty({ customerId: S.company_id, contactId: S.contact_id });
ok('ส่งผู้ติดต่อ → ก้อนเต็มเหมือนเดิม', full.contact_id === Number(S.contact_id) && full.contact_name === S.contact_name);
ok('ชื่อตรง → match', (await matchQuoteContact({ customerId: S.company_id, contactId: S.contact_id, contactQuery: S.contact_name })).match);
// เบอร์ในรูปที่เซลส์พิมพ์ (0xx…) — ตัวจับคู่ของ LINE อ่านเบอร์จากข้อความด้วย regex ที่ขึ้นต้นด้วย 0
const localPhone = String(S.phone ?? '').replace(/^\+66\s*/, '0').replace(/[^0-9]/g, '');
if (/^0\d{8,9}$/.test(localPhone)) {
  ok('เบอร์ตรง → match', (await matchQuoteContact({ customerId: S.company_id, contactId: S.contact_id, contactQuery: localPhone })).match, localPhone);
}
ok('ชื่อที่ไม่มีจริง → ไม่ match', !(await matchQuoteContact({ customerId: S.company_id, contactId: S.contact_id, contactQuery: 'คุณซานต้าคลอสทดสอบระบบ' })).match);
ok('ไม่ระบุชื่อ → ไม่ match', !(await matchQuoteContact({ customerId: S.company_id, contactId: S.contact_id, contactQuery: '' })).match);

// ── หน้าจริง ─────────────────────────────────────────────────────────────────
const admin = (await pool.query(`SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`)).rows[0];
const token = jwt.sign({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }, getJwtSecret(), { expiresIn: '1h' });
const prod = (await pool.query(`SELECT product_template_id, model, sales_price FROM products WHERE sales_price > 0 ORDER BY product_template_id LIMIT 1`)).rows[0];
// ผู้ติดต่อของบริษัทอื่น — แทน "คนของใบต้นทางที่ย้ายไปแล้ว"
const stranger = Number(M.contact_id);

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
  }, token, JSON.stringify({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }), seed ?? '');
  await page.goto(`${BASE}/admin.html?w=${width}#quoterequest`, { waitUntil: 'networkidle2' });
  return page;
}
/** ค่าของช่องในหัวใบตามป้าย (DocField) */
const field = (page: Page, label: string) => page.evaluate((l) => {
  for (const s of document.querySelectorAll('span')) {
    if (s.textContent?.trim() === l && s.nextElementSibling) return (s.nextElementSibling as HTMLElement).innerText.trim();
  }
  return null;
}, label);
const contactText = (page: Page) => page.$eval('[aria-label="ผู้ติดต่อ"]', (el) => (el as HTMLElement).innerText.trim()).catch(() => '');
async function until(fn: () => Promise<boolean>, ms = 10000) {
  for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await wait(250); }
  return false;
}
async function pickCompany(page: Page, ref: string, name: string) {
  // จอแคบ: ช่องนี้อยู่ใต้แถบปุ่มที่ลอยท้ายจอ — เลื่อนขึ้นกลางจอก่อน ไม่งั้นคลิกโดนแถบนั้น
  await page.$eval('[aria-label="บริษัท / ลูกค้า"]', (el) => el.scrollIntoView({ block: 'center' }));
  await page.click('[aria-label="บริษัท / ลูกค้า"]');
  await page.keyboard.type(ref, { delay: 15 });
  await until(async () => page.evaluate((n) => [...document.querySelectorAll('button')].some((b) => b.innerText.includes(n)), name));
  await page.evaluate((n) => ([...document.querySelectorAll('button')].find((b) => b.innerText.includes(n)) as HTMLElement)?.click(), name);
}

for (const width of [1280, 390]) {
  console.log(`\n── หน้าจริง ${width}px ──`);
  let page = await open(width, null);
  await pickCompany(page, M.ref, M.name);
  const coOk = await until(async () => (await field(page, 'รหัสลูกค้า'))?.includes(M.ref) ?? false);
  ok('หลายคน: รหัสลูกค้าขึ้นทั้งที่ยังไม่เลือกผู้ติดต่อ', coOk, (await field(page, 'รหัสลูกค้า')) ?? '');
  ok('หลายคน: เลขผู้เสียภาษีขึ้น', ((await field(page, 'รหัสลูกค้า')) ?? '').includes(M.tax));
  await wait(1500);
  ok('หลายคน: ไม่เลือกผู้ติดต่อให้', (await contactText(page)).includes('เลือกผู้ติดต่อ'), await contactText(page));

  await pickCompany(page, S.ref, S.name);
  const picked = await until(async () => (await contactText(page)).includes(S.contact_name));
  ok('คนเดียว: เลือกผู้ติดต่อให้เอง', picked, await contactText(page));
  ok('คนเดียว: รหัสลูกค้าของบริษัทใหม่', await until(async () => (await field(page, 'รหัสลูกค้า'))?.includes(S.ref) ?? false), (await field(page, 'รหัสลูกค้า')) ?? '');
  await page.screenshot({ path: `/tmp/claude-1000/ch-${width}.png` }).catch(() => {});
  await page.close();

  // คำขอที่ตีกลับ: ผู้ติดต่อเดิมไม่อยู่ในบริษัทนี้ ⇒ ต้องว่างให้คนเลือก ไม่สลับเป็นคนเดียวที่เหลือ
  page = await open(width, JSON.stringify({
    request_id: 'diag-company-header-probe',
    customer_id: Number(S.company_id), contact_id: stranger, company_name: S.name,
    payment_terms_override: null, note: null, auto_fee: null,
    items: [{ product_id: prod.product_template_id, model: prod.model, name: '', quantity: 1, price: Number(prod.sales_price) }],
  }));
  await until(async () => (await field(page, 'รหัสลูกค้า'))?.includes(S.ref) ?? false);
  await wait(2000);
  ok('เปิดคำขอกลับ: ไม่สลับเป็นคนเดียวที่เหลือ', !(await contactText(page)).includes(S.contact_name), await contactText(page));
  ok('เปิดคำขอกลับ: หัวใบยังขึ้นรหัสลูกค้า', ((await field(page, 'รหัสลูกค้า')) ?? '').includes(S.ref));
  await page.close();
}

await browser.close();
await pool.end();
console.log(fail === 0 ? '\nผ่านทั้งหมด' : `\nล้ม ${fail} ข้อ`);
process.exit(fail === 0 ? 0 : 1);
