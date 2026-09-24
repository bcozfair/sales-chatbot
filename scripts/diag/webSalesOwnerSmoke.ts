// ─────────────────────────────────────────────────────────────────────────────
//  webSalesOwnerSmoke — ด่านของการเติม "ออกในนาม" ให้เองจากลูกค้า / จากใบเดิม
//  รัน:  npm run diag:web-sales-owner     (ไม่ต้องเปิดเซิร์ฟเวอร์ · อ่าน DB อย่างเดียว)
//  แผน: docs/plan-web-quote-auto-salesperson.md §6
//
//  1. matchOption() — ฟังก์ชันบริสุทธิ์ ข้อมูลประกอบเอง
//  2. customers_data_view.salesperson_id — อยู่ท้ายสุด · ตรงกับชื่อ→รหัสใน sale_orders ทุกชื่อ
//     · ensureDirectoryRow() ลอกคอลัมน์นี้ไว้ท้ายสุดเหมือนกัน
//  3. resolveCustomerSalesOwner() กับบริษัทจริง — resolved / inactive / none / คนแรกที่ไม่ว่าง
//     / PM-THT คนละรหัส · คำตอบเป็นตัวเลือกของ dropdown เสมอ
//  4. resolveQuotationSalesOwner() กับใบจริง — ใบจาก LINE และใบจากเว็บ (แถวพร็อกซี)
//  5. ไม่เขียน DB สักแถว · ไม่มีแถว salesperson ของคีย์ `web:<admin>:auto`
//
//  ⚠️ ยังไม่ได้รัน migration 2026-09-24_01 ⇒ ข้อ 1 รันได้ ส่วนที่เหลือบอกว่ายังไม่พร้อมแล้วหยุด
//     (ถือว่าล้ม — ด่านที่ "ผ่านแบบว่างเปล่า" คือด่านที่หลอกคน)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'fs';
import { pool } from '../../config/db.js';
import { listSalespersonsForWeb } from '../../services/webQuoteService.js';
import {
  matchOption,
  resolveCustomerSalesOwner,
  resolveQuotationSalesOwner,
} from '../../services/customerSalesOwner.js';
import type { PickedSalesperson } from '../../services/salespersonPicker.js';
import { buildWebProposeKey } from '../../services/webIdentity.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ${GREEN}✓${RESET} ${label}${extra ? ` ${DIM}${extra}${RESET}` : ''}`); }
  else { fail++; console.log(`  ${RED}✗${RESET} ${label}${extra ? ` ${DIM}${extra}${RESET}` : ''}`); }
}

const opt = (user_id: string, name: string, code: string | null, merged: string[] = []): PickedSalesperson => ({
  user_id, name, salesperson_id: code, phone: null, has_sale_sig: false, sig_url: null,
  merged_count: merged.length, merged_user_ids: merged, last_active_at: null,
});

async function main() {
  console.log(`\n${BOLD}1) matchOption — ข้อมูลประกอบเอง${RESET}`);
  const opts = [opt('Ua', 'คุณจิรายุ', '422', ['Ub']), opt('Uc', 'คุณคัมภีร์', '431'), opt('Ud', 'ไม่มีรหัส', null)];
  ok('1a. หาด้วยรหัส', matchOption(opts, '422')?.user_id === 'Ua');
  ok('1b. แถวที่ถูกยุบทิ้ง → คืนตัวแทนของกลุ่ม', matchOption(opts, null, 'Ub')?.user_id === 'Ua');
  ok('1c. แถวไม่มีรหัส หาด้วย user_id ได้', matchOption(opts, null, 'Ud')?.user_id === 'Ud');
  ok('1d. รหัสที่ไม่มีในรายชื่อ → null (ไม่เดา)', matchOption(opts, '999') === null);
  ok('1e. ไม่มีทั้งรหัสและ user_id → null', matchOption(opts, null, null) === null);
  ok('1f. user_id แปลกหน้า แต่รหัสตรง → ตามรหัส (ใบจากเว็บ = แถวพร็อกซี)',
    matchOption(opts, '431', 'web:7:Uc')?.user_id === 'Uc');
  ok('1g. ช่องว่างหัวท้ายของรหัสไม่ทำให้หาไม่เจอ', matchOption(opts, ' 422 ')?.user_id === 'Ua');

  const before = (await pool.query(`SELECT count(*)::int c FROM salesperson`)).rows[0].c;

  // ── 2. คอลัมน์ในตาราง ───────────────────────────────────────────────────────
  console.log(`\n${BOLD}2) customers_data_view.salesperson_id${RESET}`);
  const { rows: cols } = await pool.query(
    `SELECT attname FROM pg_attribute
      WHERE attrelid = 'public.customers_data_view'::regclass AND attnum > 0 AND NOT attisdropped
      ORDER BY attnum DESC LIMIT 1`
  );
  if (cols[0]?.attname !== 'salesperson_id') {
    console.log(`  ${YELLOW}!${RESET} ตารางยังไม่มีคอลัมน์ salesperson_id — รัน migration 2026-09-24_01 แล้ว refresh ด้วย { force: true } ก่อน`);
    fail++;
    return;
  }
  ok('2a. salesperson_id เป็นคอลัมน์ท้ายสุด (ensureDirectoryRow INSERT ตามตำแหน่ง)', true);

  // ชื่อ → รหัส ต้องตรงกับที่คำนวณสดจาก sale_orders (กติกาเดียวกับ CTE sp_code: รหัสของใบล่าสุด)
  const { rows: mism } = await pool.query(`
    WITH fresh AS (
      SELECT DISTINCT ON (public.clean_text(salesperson))
             public.clean_text(salesperson) AS salesperson, salesperson_id::text AS code
        FROM public.sale_orders
       WHERE salesperson IS NOT NULL AND salesperson_id IS NOT NULL
       ORDER BY public.clean_text(salesperson), order_date DESC NULLS LAST
    )
    SELECT v.salesperson, v.salesperson_id, f.code
      FROM (SELECT DISTINCT salesperson, salesperson_id FROM customers_data_view WHERE salesperson IS NOT NULL) v
      LEFT JOIN fresh f ON f.salesperson = v.salesperson
     WHERE v.salesperson_id IS DISTINCT FROM f.code`);
  ok('2b. ทุกชื่อได้รหัสตรงกับใบล่าสุดใน sale_orders', mism.length === 0,
    mism.slice(0, 3).map((r: any) => `${r.salesperson}: ${r.salesperson_id} ≠ ${r.code}`).join(' · '));

  const { rows: dup } = await pool.query(
    `SELECT salesperson FROM customers_data_view WHERE salesperson IS NOT NULL
      GROUP BY salesperson HAVING count(DISTINCT salesperson_id) > 1`);
  ok('2c. ชื่อเดียวไม่มีสองรหัสในตาราง', dup.length === 0, dup.map((r: any) => r.salesperson).join(' · '));

  const repoSrc = readFileSync(new URL('../../db/localContactsRepo.ts', import.meta.url), 'utf-8');
  ok('2d. ensureDirectoryRow() ลอก v.salesperson_id ไว้หลัง v.last_order_at (ท้ายสุด)',
    /v\.last_order_at,[\s\S]{0,300}?v\.salesperson_id\s*\n\s*FROM public\.customers_data_view v/.test(repoSrc));

  // ── 3. บริษัทจริง ───────────────────────────────────────────────────────────
  console.log(`\n${BOLD}3) resolveCustomerSalesOwner — บริษัทจริง${RESET}`);
  const options = await listSalespersonsForWeb();
  const activeCodes = options.map((o) => String(o.salesperson_id ?? '')).filter((c) => c !== '');

  const firstOf = `SELECT DISTINCT ON (company_id) company_id, salesperson, salesperson_id
                     FROM customers_data_view WHERE salesperson IS NOT NULL ORDER BY company_id, contact_id`;
  const pick = async (where: string, params: unknown[] = []) =>
    (await pool.query(`SELECT * FROM (${firstOf}) f WHERE ${where} ORDER BY company_id LIMIT 1`, params)).rows[0];

  const r1 = await pick(`salesperson_id = ANY($1::text[])`, [activeCodes]);
  if (r1) {
    const o = await resolveCustomerSalesOwner(r1.company_id, options);
    ok('3a. เซลส์ active → resolved และรหัสตรง', o.status === 'resolved' && o.salesperson_id === r1.salesperson_id,
      `บริษัท ${r1.company_id} ${r1.salesperson} → ${o.status === 'resolved' ? `${o.name} (${o.salesperson_id})` : o.status}`);
    ok('3b.   คำตอบเป็นตัวเลือกใน dropdown', o.status === 'resolved' && options.some((x) => x.user_id === o.user_id));
  } else ok('3a. มีบริษัทตัวอย่างที่เซลส์ active', false);

  const r2 = await pick(`salesperson = 'purchase_user_1'`);
  if (r2) {
    const o = await resolveCustomerSalesOwner(r2.company_id, options);
    ok('3c. บัญชีระบบ (purchase_user_1) → inactive พร้อมชื่อ ไม่ใช่คนอื่น',
      o.status === 'inactive' && o.odoo_name === 'purchase_user_1', `บริษัท ${r2.company_id} → ${o.status}`);
  } else console.log(`  ${DIM}   (ข้าม 3c — ไม่มีบริษัทของ purchase_user_1)${RESET}`);

  const r3 = (await pool.query(
    `SELECT company_id FROM customers_data_view GROUP BY company_id
      HAVING bool_and(salesperson IS NULL) ORDER BY company_id LIMIT 1`)).rows[0];
  if (r3) {
    const o = await resolveCustomerSalesOwner(r3.company_id, options);
    ok('3d. บริษัทที่ไม่มีเซลส์เลย → none', o.status === 'none', `บริษัท ${r3.company_id}`);
  }
  ok('3e. company_id ไม่ถูกต้อง → none ไม่ throw', (await resolveCustomerSalesOwner(0, options)).status === 'none');

  // คนแรกที่ไม่ว่าง: ผู้ติดต่อคนแรกไม่มีเซลส์ แต่คนถัดไปมี (เจ้าของเคาะ 2026-09-24)
  const r4 = (await pool.query(`
    WITH f AS (SELECT DISTINCT ON (company_id) company_id, salesperson FROM customers_data_view ORDER BY company_id, contact_id)
    SELECT f.company_id, n.salesperson
      FROM f JOIN LATERAL (SELECT salesperson FROM customers_data_view v
                            WHERE v.company_id = f.company_id AND v.salesperson IS NOT NULL
                            ORDER BY contact_id LIMIT 1) n ON true
     WHERE f.salesperson IS NULL ORDER BY f.company_id LIMIT 1`)).rows[0];
  if (r4) {
    const o = await resolveCustomerSalesOwner(r4.company_id, options);
    const got = o.status === 'none' ? null : o.odoo_name;
    ok('3f. ผู้ติดต่อคนแรกว่าง → ใช้คนแรกที่ไม่ว่าง', got === r4.salesperson, `บริษัท ${r4.company_id} → ${got}`);
  }

  // PM/THT คนเดียวกันคนละรหัส — ชื่อใน Odoo บอกฝั่งอยู่แล้ว ห้ามตัด (PM)/(THT) ทิ้งแล้วเทียบ
  const { rows: sides } = await pool.query(
    `SELECT DISTINCT salesperson, salesperson_id FROM customers_data_view
      WHERE salesperson IN ('คุณคัมภีร์(PM)', 'คุณคัมภีร์(THT)')`);
  const pm = sides.find((r: any) => r.salesperson.endsWith('(PM)'))?.salesperson_id;
  const tht = sides.find((r: any) => r.salesperson.endsWith('(THT)'))?.salesperson_id;
  if (pm && tht) ok('3g. PM กับ THT ของคนเดียวกันได้คนละรหัส', pm !== tht, `PM ${pm} · THT ${tht}`);

  // ── 4. ใบเดิม ───────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}4) resolveQuotationSalesOwner — ใบจริง${RESET}`);
  const lineQ = (await pool.query(
    `SELECT q.quotation_no, q.user_id, s.salesperson_id FROM quotations q JOIN salesperson s ON s.user_id = q.user_id
      WHERE q.quotation_no IS NOT NULL AND q.user_id NOT LIKE 'web:%' AND s.status = 'active'
        AND s.salesperson_id = ANY($1::text[])
      ORDER BY q.updated_at DESC LIMIT 1`, [activeCodes])).rows[0];
  if (lineQ) {
    const o = await resolveQuotationSalesOwner(lineQ.user_id, options);
    ok('4a. ใบจาก LINE → เซลส์คนเดิม', o.status === 'resolved' && o.salesperson_id === lineQ.salesperson_id,
      `${lineQ.quotation_no} → ${o.status === 'resolved' ? `${o.name} (${o.salesperson_id})` : o.status}`);
  } else ok('4a. มีใบจาก LINE ตัวอย่าง', false);

  const webQ = (await pool.query(
    `SELECT q.quotation_no, q.user_id, s.salesperson_id FROM quotations q JOIN salesperson s ON s.user_id = q.user_id
      WHERE q.quotation_no IS NOT NULL AND q.user_id LIKE 'web:%' AND s.salesperson_id = ANY($1::text[])
      ORDER BY q.updated_at DESC LIMIT 1`, [activeCodes])).rows[0];
  if (webQ) {
    const o = await resolveQuotationSalesOwner(webQ.user_id, options);
    ok('4b. ใบจากเว็บ (แถวพร็อกซี) → เซลส์ตัวจริงตามรหัส ไม่ใช่ user_id ของพร็อกซี',
      o.status === 'resolved' && o.salesperson_id === webQ.salesperson_id && !o.user_id.startsWith('web:'),
      `${webQ.quotation_no} → ${o.status === 'resolved' ? o.user_id.slice(0, 9) + '…' : o.status}`);
  } else console.log(`  ${DIM}   (ข้าม 4b — ยังไม่มีใบจากเว็บที่ยืนยันแล้ว)${RESET}`);
  ok('4c. user_id ว่าง → none', (await resolveQuotationSalesOwner(null, options)).status === 'none');

  // ── 5. ไม่เขียนอะไร ─────────────────────────────────────────────────────────
  console.log(`\n${BOLD}5) ไม่เขียน DB${RESET}`);
  const after = (await pool.query(`SELECT count(*)::int c FROM salesperson`)).rows[0].c;
  ok('5a. ไม่เขียน DB สักแถว', before === after, `${before} → ${after}`);
  const proxyAuto = (await pool.query(
    `SELECT count(*)::int c FROM salesperson WHERE user_id LIKE $1`,
    [buildWebProposeKey(0).replace(/^web:0:/, 'web:%:')])).rows[0].c;
  ok('5b. ไม่มีแถว salesperson ของคีย์ "วางข้อความโดยยังไม่เลือกเซลส์"', proxyAuto === 0, `${proxyAuto} แถว`);
}

main()
  .catch((err) => { console.error(err); fail++; })
  .finally(async () => {
    console.log(`\n${BOLD}สรุป:${RESET} ${fail === 0 ? GREEN : RED}ผ่าน ${pass}${RESET} · ${DIM}ล้ม ${fail}${RESET}\n`);
    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
  });
