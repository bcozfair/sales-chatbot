/* ─────────────────────────────────────────────────────────────────────────────
   ช่อง "Source" ของหน้าขอใบเสนอราคา → quotations.source_id → คอลัมน์ K ของไฟล์ Odoo (เจ้าของสั่ง 2026-09-25)

   ครอบ:
     ตรรกะ (ไม่แตะฐาน)
       · parseSourceId รับครบ 6 ค่าตรงตัว · ว่าง = null · ค่านอกรายการ/ตัวพิมพ์ต่าง = 400
       · buildOdooSaleOrderRows: ใบที่ระบุ → K เป็นค่าของใบ (แถวที่ 2 ว่างตามกติกา one2many)
         · ใบที่ไม่ระบุ (ใบจาก LINE / ใบเก่า) → K เป็นค่าตั้งต้นเหมือนเดิม
       · หน้าเว็บไม่ฝังรายการเอง (อ่านจาก /webquote/sources ที่เดียว)
       · SQL ของ export เลือก q.source_id · INSERT ของร่างเขียน source_id
     หน้าจริง (1280 และ 390px)
       · แถว "Source" อยู่ใต้ "ส่วนลดเดิม" · ค่าเริ่ม Sales · ตัวเลือก 6 ค่าตามลำดับ
       · เปลี่ยนค่า → ขอบน้ำเงิน + ปุ่ม ↺ · กด ↺ กลับเป็น Sales
       · โหลดคำขอกลับมาแก้ (price-approval-reload) ที่มี source_id → ช่องได้ค่านั้น
       · กดออกใบ → body ของ POST /webquote/drafts มี source_id ที่เลือก
         (**ดักคำขอไว้ ไม่ปล่อยถึง server** ⇒ ไม่มีแถวใหม่ในฐาน)
       · 390px ไม่มี scroll แนวนอน

   **ไม่เขียน DB** · ต้องมี API ที่ SRC_PORT (ค่าเริ่มต้น 3099): `PREVIEW_MODE=1 PORT=3099 npx tsx index.ts` จาก worktree
   ───────────────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import puppeteer, { type Page } from 'puppeteer';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { parseSourceId, listSourceOptions } from '../../services/webQuoteService.js';
import {
  buildOdooSaleOrderRows,
  loadOdooExportConfig,
  ODOO_SOURCE_OPTIONS,
} from '../../services/odooSaleOrderExport.js';

const PORT = process.env.SRC_PORT || '3099';
const BASE = `http://localhost:${PORT}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };

const EXPECTED = ['Sales', 'Inside Sales', 'Admin (Line)', 'Admin (Tel.)', 'Admin (E-Mail)', 'Marketing (Line OA)'];

console.log('── ตรรกะ ──');
ok('รายการตรงกับที่เจ้าของให้มา (ลำดับ + สะกด)', JSON.stringify([...ODOO_SOURCE_OPTIONS]) === JSON.stringify(EXPECTED));
ok('ค่าตั้งต้น = Sales', listSourceOptions().default === 'Sales');
ok('parseSourceId รับครบ 6 ค่า', EXPECTED.every((v) => parseSourceId(v) === v));
ok('ว่าง/ไม่ส่ง = null', parseSourceId(undefined) === null && parseSourceId(null) === null && parseSourceId('  ') === null);
ok('ค่านอกรายการ → error', throws(() => parseSourceId('Other')) && throws(() => parseSourceId('sales')) && throws(() => parseSourceId('Admin (Tel)')));

const cfg = loadOdooExportConfig();
const item = (m: string) => ({ model: m, internal_reference: m, price: 100, quantity: 1 });
const base = {
  customer_details: { customer_name: 'บริษัท ทดสอบ จำกัด', contact_name: 'คุณเอ', payment_terms: 'Cash' },
  employee_details: {}, updated_at: '2026-09-25T03:00:00Z',
};
const rows = buildOdooSaleOrderRows([
  { ...base, quotation_no: 'QP-260900001', item_details: [item('AA-1'), item('AA-2')], source_id: 'Admin (Line)' },
  { ...base, quotation_no: 'QP-260900002', item_details: [item('BB-1')], source_id: null },
  { ...base, quotation_no: 'QP-260900003', item_details: [item('CC-1')] },
], cfg, 'QP');
ok('ใบที่ระบุ → K = ค่าของใบ', rows[0]?.source_id === 'Admin (Line)', String(rows[0]?.source_id));
ok('แถวที่ 2 ของใบเดียวกัน → K ว่าง (one2many)', rows[1]?.source_id === '', JSON.stringify(rows[1]?.source_id));
ok('source_id = null → ค่าตั้งต้น', rows[2]?.source_id === cfg.sourceId, String(rows[2]?.source_id));
ok('ไม่มีฟิลด์ (ใบจาก LINE) → ค่าตั้งต้น', rows[3]?.source_id === cfg.sourceId, String(rows[3]?.source_id));

const fe = fs.readFileSync('frontend/src/admin/QuoteRequest.tsx', 'utf8');
ok('หน้าเว็บไม่ฝังรายการเอง', !fe.includes("'Inside Sales'") && !fe.includes('"Inside Sales"') && fe.includes('/api/admin/webquote/sources'));
const idx = fs.readFileSync('index.ts', 'utf8');
ok('SQL ของ export เลือก q.source_id', /q\.delivery_terms, q\.source_id,/.test(idx));
const qs = fs.readFileSync('services/quotationService.ts', 'utf8');
ok('INSERT ของร่างเขียน source_id', /delivery_type_override, delivery_days_override,\s*source_id\s*\) VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12\)/.test(qs));

// ── หน้าจริง ─────────────────────────────────────────────────────────────────
const admin = (await pool.query(`SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`)).rows[0];
const token = jwt.sign({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }, getJwtSecret(), { expiresIn: '1h' });

const res = await fetch(`${BASE}/api/admin/webquote/sources`, { headers: { Authorization: `Bearer ${token}` } });
const body = await res.json().catch(() => null);
ok('GET /webquote/sources ตอบรายการ', res.ok && JSON.stringify(body?.sources) === JSON.stringify(EXPECTED) && body?.default === 'Sales', String(res.status));

// บริษัทตัวอย่างที่ออกใบได้ไม่ติดกฎระดับลูกค้า — ลูกค้า Cash ที่มีเซลส์ผูกอยู่ + สินค้าที่ไม่ติดกฎสต็อก/บล็อก
const { rows: [co] } = await pool.query(`
  SELECT v.company_id, v.customer_name AS name, v.contact_id
    FROM customers_data_view v
   WHERE v.source <> 'local' AND v.contact_id > 0 AND v.customer_payment_terms = 'Cash'
     AND v.salesperson_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM quotation_blacklist b WHERE b.contact_id = v.contact_id)
   ORDER BY v.company_id DESC LIMIT 1`);
const { rows: [prod] } = await pool.query(`SELECT product_template_id, model, sales_price FROM products
  WHERE sales_price > 0 AND model ~ '^[A-Z]{2}[A-Z0-9-]*[0-9]' ORDER BY product_template_id LIMIT 1`);
console.log(`ตัวอย่าง: ${co.name} (${co.company_id}/${co.contact_id}) · ${prod.model}`);
const seed = (source_id: string | null) => JSON.stringify({
  request_id: 'diag-quote-source-probe',
  customer_id: Number(co.company_id), contact_id: Number(co.contact_id), company_name: co.name,
  payment_terms_override: null, source_id, note: null, auto_fee: null,
  items: [{ product_id: prod.product_template_id, model: prod.model, name: '', quantity: 1, price: Number(prod.sales_price) }],
});

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
async function open(width: number, seedJson: string | null) {
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
  }, token, JSON.stringify(admin), seedJson ?? '');
  await page.goto(`${BASE}/admin.html?w=${width}#quoterequest`, { waitUntil: 'networkidle2' });
  return page;
}
async function until(fn: () => Promise<boolean>, ms = 10000) {
  for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await wait(250); }
  return false;
}
const SEL = 'select[aria-label="Source ของใบนี้ (ไฟล์ Odoo)"]';
const source = (page: Page) => page.evaluate((sel) => {
  const s = document.querySelector(sel) as HTMLSelectElement | null;
  const row = s?.closest('div.flex');
  // แถวก่อนหน้าในคอลัมน์เดียวกัน = ป้ายของแถวที่อยู่เหนือ Source
  const prev = row?.previousElementSibling?.querySelector('span')?.textContent?.trim() ?? '';
  return {
    value: s?.value ?? null,
    options: [...(s?.options ?? [])].map((o) => o.value),
    label: row?.querySelector('span')?.textContent?.trim() ?? '',
    prev,
    blue: !!s?.className.includes('border-blue-600'),
    reset: !!row?.querySelector('button[aria-label="กลับเป็น Sales"]'),
  };
}, SEL);

for (const width of [1280, 390]) {
  console.log(`\n── หน้าจริง ${width}px ──`);
  let page = await open(width, null);
  await until(async () => (await source(page)).options.length === EXPECTED.length);
  let s = await source(page);
  ok('มีแถว "Source" ใต้ "ส่วนลดเดิม"', s.label === 'Source' && s.prev === 'ส่วนลดเดิม', `${s.prev} → ${s.label}`);
  ok('ค่าเริ่ม Sales ไม่มีขอบน้ำเงิน/ปุ่ม ↺', s.value === 'Sales' && !s.blue && !s.reset, String(s.value));
  ok('ตัวเลือก 6 ค่าตามลำดับ', JSON.stringify(s.options) === JSON.stringify(EXPECTED));
  await page.select(SEL, 'Admin (E-Mail)');
  s = await source(page);
  ok('เลือกค่าอื่น → ขอบน้ำเงิน + ปุ่ม ↺', s.value === 'Admin (E-Mail)' && s.blue && s.reset);
  await page.$eval(SEL, (el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `/tmp/claude-1000/src-changed-${width}.png` }).catch(() => {});
  await page.click('button[aria-label="กลับเป็น Sales"]');
  s = await source(page);
  ok('กด ↺ → กลับเป็น Sales', s.value === 'Sales' && !s.blue && !s.reset);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('ไม่มี scroll แนวนอน', overflow <= 0, `${overflow}px`);
  await page.close();

  // ── คำขอที่โหลดกลับมาแก้ ถือ source_id มาด้วย → ช่องได้ค่านั้น และส่งค่านั้นตอนออกใบ ──
  page = await open(width, seed('Admin (Tel.)'));
  const got = await until(async () => (await source(page)).value === 'Admin (Tel.)', 15000);
  ok('โหลดคำขอกลับมาแก้ → ช่องได้ค่าของคำขอเดิม', got, String((await source(page)).value));
  await page.select(SEL, 'Marketing (Line OA)');

  let posted: any = null;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/admin/webquote/drafts')) {
      posted = JSON.parse(req.postData() || '{}');
      void req.respond({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'diag: ดักไว้ ไม่ส่งถึง server' }) });
      return;
    }
    void req.continue();
  });
  // รอให้ผลตรวจกลับมาและปุ่มพร้อม — ปุ่มท้ายจอเป็น "ยืนยัน" หรือ "ขออนุมัติ"
  const mainBtn = async () => page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter((x) => ['ยืนยัน', 'ขออนุมัติ'].includes(x.innerText.trim()));
    const last = b[b.length - 1] as HTMLButtonElement | undefined;
    return last ? { ready: !last.disabled, title: last.title } : null;
  });
  const ready = await until(async () => (await mainBtn())?.ready === true, 20000);
  if (!ready) {
    ok('ปุ่มออกใบพร้อมกด', false, JSON.stringify(await mainBtn()));
  } else {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].filter((x) => ['ยืนยัน', 'ขออนุมัติ'].includes(x.innerText.trim()));
      (b[b.length - 1] as HTMLElement).click();
    });
    await wait(800);
    // ติดกฎ → โมดัล: ติ๊กรับทราบแล้วกดปุ่มในโมดัล
    if (!posted) {
      await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return;
        (dlg.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.click();
        const b = [...dlg.querySelectorAll('button')].filter((x) => ['ยืนยัน', 'ขออนุมัติ'].includes((x as HTMLElement).innerText.trim()));
        (b[b.length - 1] as HTMLElement | undefined)?.click();
      });
      if ((await page.$('[role="dialog"] textarea')) && !posted) {
        await page.type('[role="dialog"] textarea', 'diag');
        await page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"]')!;
          const b = [...dlg.querySelectorAll('button')].filter((x) => ['ยืนยัน', 'ขออนุมัติ'].includes((x as HTMLElement).innerText.trim()));
          (b[b.length - 1] as HTMLElement | undefined)?.click();
        });
      }
    }
    await until(async () => posted !== null, 5000);
    ok('POST /drafts ส่ง source_id ที่เลือก', posted?.source_id === 'Marketing (Line OA)', JSON.stringify(posted?.source_id));
  }
  await page.close();
}

await browser.close();
await pool.end();
console.log(fail === 0 ? '\nผ่านทั้งหมด' : `\nล้ม ${fail} ข้อ`);
process.exit(fail === 0 ? 0 : 1);
