/* ─────────────────────────────────────────────────────────────────────────────
   แถว "ส่วนลดเดิม" ใต้ "สถานที่ส่งของ" + ข้อมูลลูกค้าชุดเดียวเมื่อแยกใบ PM/THT (เจ้าของสั่ง 2026-09-25)

   ครอบ:
     ฝั่ง server (อ่านอย่างเดียว)
       · getCustomerDiscountHistory = ตัวเลขชุดเดียวกับหน้า "ข้อมูลลูกค้า" (getCompanyDetail) ทุกช่อง
       · บริษัทที่ไม่เคยมีใบสั่งขาย → null · customer_id ผิดรูป → 400
     หน้าจริง (1280 และ 390px)
       · ยังไม่เลือกบริษัท → "—"
       · บริษัทที่มีใบ → ปุ่ม "30%, 30%, 25%" ตรงกับ server · กดแล้วกางเลขใบครบ · Esc ปิด
       · บริษัทที่ไม่เคยมีใบ → "ยังไม่เคยมีใบสั่งขาย"
       · ใบแยก PM/THT → บล็อกผู้ซื้อ (ช่องเลือกบริษัท/ผู้ติดต่อ/ส่วนลดเดิม) มีชุดเดียว ·
         ใบที่สองเหลือบรรทัด "ข้อมูลลูกค้าและผู้ติดต่อเดียวกับใบ PM ด้านบน"

   **ไม่เขียน DB** — ไม่กด "ยืนยัน" ไม่เรียก propose (ซึ่งเขียนประวัติลง messages)
   ต้องมี API ที่ DH_PORT (ค่าเริ่มต้น 3099): `PREVIEW_MODE=1 PORT=3099 npx tsx index.ts` จาก worktree
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type Page } from 'puppeteer';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { getCustomerDiscountHistory } from '../../services/webQuoteService.js';
import { getCompanyDetail } from '../../services/dataDirectoryService.js';
import { resolveQuoteCompany } from '../../services/quotationService.js';

const PORT = process.env.DH_PORT || '3099';
const BASE = `http://localhost:${PORT}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};
const pctText = (v: number) => `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}%`;

// ── บริษัทตัวอย่าง: มีใบ ≥ 3 ใบ / ไม่เคยมีใบ ───────────────────────────────────
// สแกนแค่บริษัทล่าสุด 3,000 รายก่อน — ทั้งตาราง (82k แถว) เกินเพดาน 15 วิของ pool
const { rows: recent } = await pool.query(`
  SELECT company_id, max(customer_name) AS name, max(customer_reference) AS ref,
         array_agg(contact_id) FILTER (WHERE contact_id > 0) AS contacts
    FROM customers_data_view
   WHERE company_id IN (SELECT DISTINCT company_id FROM customers_data_view WHERE source <> 'local'
                         ORDER BY company_id DESC LIMIT 3000)
   GROUP BY company_id ORDER BY company_id DESC`);
async function sample(withOrders: boolean) {
  for (const co of recent) {
    if (!/^[A-Z]\/[0-9]{4,}$/.test(co.ref ?? '') || !co.contacts?.length) continue;
    const dup = await pool.query(`SELECT count(DISTINCT company_id)::int AS k FROM customers_data_view WHERE customer_reference = $1`, [co.ref]);
    if (dup.rows[0].k !== 1) continue;
    const n = (await pool.query(`SELECT count(*)::int AS n FROM sale_orders WHERE contact_id = ANY($1::int[])`, [co.contacts])).rows[0].n;
    if (withOrders ? n >= 3 : n === 0) return co;
  }
  return null;
}
const H = await sample(true);
const N = await sample(false);
if (!H || !N) throw new Error('หาบริษัทตัวอย่างไม่ได้');
console.log(`มีใบ: ${H.name} ${H.ref} · ไม่เคยมีใบ: ${N.name} ${N.ref}`);

console.log('\n── server ──');
const mine = await getCustomerDiscountHistory(H.company_id);
const dir = (await getCompanyDetail(Number(H.company_id)))?.discount ?? null;
ok('มีใบ → 3 ใบ', mine?.rows.length === 3, mine?.rows.map((r) => r.ref).join(' '));
ok('ตัวเลขชุดเดียวกับหน้า "ข้อมูลลูกค้า" ทุกช่อง', JSON.stringify(mine) === JSON.stringify(dir));
ok('ไม่เคยมีใบ → null', (await getCustomerDiscountHistory(N.company_id)) === null);
let bad = '';
try { await getCustomerDiscountHistory('abc'); } catch (e: any) { bad = String(e?.status ?? e?.httpStatus ?? e?.code ?? ''); }
ok('customer_id ผิดรูป → โยน error', bad !== '', bad);
const expectBtn = mine!.rows.map((r) => (r.pct != null ? pctText(r.pct) : '—')).join(', ');

// ── สินค้า PM หนึ่งตัว + THT หนึ่งตัว ให้ผลตรวจแตกเป็นสองใบ ────────────────────
// สองกองแยกกัน — ตัวตัดสินจริงคือ resolveQuoteCompany (กฎ + production) ไม่ใช่ production อย่างเดียว
const { rows: prods } = await pool.query(`
  (SELECT product_template_id, model, sales_price, production FROM products
    WHERE sales_price > 0 AND model ~ '^[A-Z]{2}[A-Z0-9-]*[0-9]' AND production = 'Import(PM)'
    ORDER BY product_template_id LIMIT 150)
  UNION ALL
  (SELECT product_template_id, model, sales_price, production FROM products
    WHERE sales_price > 0 AND model ~ '^[A-Z]{2}[A-Z0-9-]*[0-9]' AND production IS DISTINCT FROM 'Import(PM)'
    ORDER BY product_template_id LIMIT 150)`);
let pm: any = null, tht: any = null;
for (const p of prods) {
  const c = await resolveQuoteCompany({ model: p.model, production: p.production });
  if (c === 'PM' && !pm) pm = p;
  if (c === 'THT' && !tht) tht = p;
  if (pm && tht) break;
}
if (!pm || !tht) throw new Error('หาสินค้าคู่ PM/THT ไม่ได้');
console.log(`สินค้า PM ${pm.model} · THT ${tht.model}`);

// ── หน้าจริง ─────────────────────────────────────────────────────────────────
const admin = (await pool.query(`SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`)).rows[0];
const token = jwt.sign({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }, getJwtSecret(), { expiresIn: '1h' });
const r400 = await fetch(`${BASE}/api/admin/webquote/discount-history?customer_id=abc`, { headers: { Authorization: `Bearer ${token}` } });
ok('API: customer_id ผิดรูป → 400', r400.status === 400, String(r400.status));
const rNo = await fetch(`${BASE}/api/admin/webquote/discount-history?customer_id=${H.company_id}`);
ok('API: ไม่มี token → 401', rNo.status === 401, String(rNo.status));

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
/** ค่าของทุกช่องในหัวใบที่ป้ายตรงกัน (DocField) — หลายใบ = หลายค่า */
const fields = (page: Page, label: string) => page.evaluate((l) => {
  const out: string[] = [];
  for (const s of document.querySelectorAll('span')) {
    if (s.textContent?.trim() === l && s.nextElementSibling) out.push((s.nextElementSibling as HTMLElement).innerText.trim());
  }
  return out;
}, label);
const field = async (page: Page, label: string) => (await fields(page, label))[0] ?? null;
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
const btnSel = 'button[aria-controls][aria-label^="ส่วนลดทั้งบิล"]';

for (const width of [1280, 390]) {
  console.log(`\n── หน้าจริง ${width}px ──`);
  let page = await open(width, null);
  ok('ยังไม่เลือกบริษัท → "—"', (await field(page, 'ส่วนลดเดิม')) === '—', String(await field(page, 'ส่วนลดเดิม')));

  await pickCompany(page, H.ref, H.name);
  const got = await until(async () => !!(await page.$(btnSel)));
  const btnText = got ? await page.$eval(btnSel, (b) => (b as HTMLElement).innerText.trim()) : '';
  ok('มีใบ → ปุ่มสรุป % ตรงกับ server', btnText === expectBtn, `${btnText} / ${expectBtn}`);
  await page.$eval(btnSel, (el) => el.scrollIntoView({ block: 'center' }));
  await page.click(btnSel);
  const popOk = await until(async () => page.evaluate((refs) => {
    const d = document.querySelector('[role="dialog"][aria-label="ส่วนลดทั้งบิลของใบสั่งขายล่าสุด"]') as HTMLElement | null;
    return !!d && refs.every((r: string) => d.innerText.includes(r));
  }, mine!.rows.map((r) => r.ref)), 3000);
  ok('กดแล้วกางเลขใบครบ 3 ใบ', popOk);
  const inView = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="ส่วนลดทั้งบิลของใบสั่งขายล่าสุด"]');
    if (!d) return false;
    const r = d.getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth;
  });
  ok('กล่องอยู่ในจอทั้งกล่อง', inView);
  await page.screenshot({ path: `/tmp/claude-1000/dh-open-${width}.png` }).catch(() => {});
  await page.keyboard.press('Escape');
  ok('Esc ปิดกล่อง', await until(async () => !(await page.$('[role="dialog"][aria-label="ส่วนลดทั้งบิลของใบสั่งขายล่าสุด"]')), 2000));

  await pickCompany(page, N.ref, N.name);
  ok('ไม่เคยมีใบ → "ยังไม่เคยมีใบสั่งขาย"',
    await until(async () => (await field(page, 'ส่วนลดเดิม')) === 'ยังไม่เคยมีใบสั่งขาย'), String(await field(page, 'ส่วนลดเดิม')));
  await page.close();

  // ── ใบแยก PM/THT: ข้อมูลลูกค้าชุดเดียว ──
  page = await open(width, JSON.stringify({
    request_id: 'diag-discount-history-probe',
    customer_id: Number(H.company_id), contact_id: Number(H.contacts[0]), company_name: H.name,
    payment_terms_override: null, note: null, auto_fee: null,
    items: [
      { product_id: pm.product_template_id, model: pm.model, name: '', quantity: 1, price: Number(pm.sales_price) },
      { product_id: tht.product_template_id, model: tht.model, name: '', quantity: 1, price: Number(tht.sales_price) },
    ],
  }));
  const split = await until(async () => page.evaluate(() => document.body.innerText.includes('ข้อมูลลูกค้าและผู้ติดต่อเดียวกับใบ PM ด้านบน')), 20000);
  ok('แยกสองใบ → ใบที่สองเหลือบรรทัดชี้ไปใบ PM', split);
  const combos = await page.$$eval('[aria-label="บริษัท / ลูกค้า"]', (els) => els.length);
  ok('ช่องเลือกบริษัทมีชุดเดียว', combos === 1, String(combos));
  ok('แถวรหัสลูกค้ามีชุดเดียว', (await fields(page, 'รหัสลูกค้า')).length === 1, String((await fields(page, 'รหัสลูกค้า')).length));
  ok('แถวส่วนลดเดิมมีชุดเดียว', (await fields(page, 'ส่วนลดเดิม')).length === 1, String((await fields(page, 'ส่วนลดเดิม')).length));
  const docs = await page.evaluate(() => [...document.querySelectorAll('p')].filter((p) => p.textContent === 'ใบเสนอราคา').length);
  ok('ยังเป็นสองใบ', docs === 2, String(docs));
  // ชื่อผู้ซื้อในบรรทัดของใบที่สอง = span ก่อนหน้าข้อความที่ชี้ไปใบแรก
  const buyerName = await page.evaluate(() => {
    const note = [...document.querySelectorAll('span')].find((s) => s.textContent?.includes('เดียวกับใบ PM ด้านบน'));
    return (note?.previousElementSibling as HTMLElement | null)?.innerText.trim() ?? '';
  });
  ok('บรรทัดใบที่สองมีชื่อผู้ซื้อ', buyerName === String(H.name).trim(), buyerName);
  await page.evaluate(() => [...document.querySelectorAll('span')].find((s) => s.textContent?.includes('เดียวกับใบ PM ด้านบน'))?.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `/tmp/claude-1000/dh-split-${width}.png` }).catch(() => {});
  await page.close();
}

await browser.close();
await pool.end();
console.log(fail === 0 ? '\nผ่านทั้งหมด' : `\nล้ม ${fail} ข้อ`);
process.exit(fail === 0 ? 0 : 1);
