// ─────────────────────────────────────────────────────────────────────────────
//  webSalesOwnerSmoke — ด่านของการเติม "ออกในนาม" ให้เองจากลูกค้า / จากใบเดิม
//  รัน:  npm run diag:web-sales-owner     (ไม่ต้องเปิดเซิร์ฟเวอร์ · อ่าน DB อย่างเดียว)
//  แผน: docs/plan-web-quote-auto-salesperson.md §6
//
//  1. matchOption() / pickSalesOwner() — ฟังก์ชันบริสุทธิ์ ข้อมูลประกอบเอง
//     + อ่านซอร์ส: query ใบสั่งขายต้องเชื่อมด้วย contact_id ห้ามแตะ sale_orders.company_id
//  2. customers_data_view.salesperson_id — อยู่ท้ายสุด · ตรงกับชื่อ→รหัสใน sale_orders ทุกชื่อ
//     · ensureDirectoryRow() ลอกคอลัมน์นี้ไว้ท้ายสุดเหมือนกัน
//  3. resolveCustomerSalesOwner() กับบริษัทจริง — ครบ 4 ขั้นของการถอย (customer · contact ·
//     last_order · older_order) + inactive / none · คำตอบเป็นตัวเลือกของ dropdown เสมอ
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
  pickSalesOwner,
  resolveCustomerSalesOwner,
  resolveQuotationSalesOwner,
  type SalesOwner,
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


  console.log(`\n${BOLD}1b) pickSalesOwner — ลำดับการถอย${RESET}`);
  {
    const inactiveCode = '777';   // ไม่อยู่ใน opts = เซลส์ที่ไม่ active
    const r1 = pickSalesOwner([
      { source: 'customer', code: inactiveCode, name: 'คนเก่า(PM)' },
      { source: 'contact', code: null, name: 'purchase_user_1' },
      { source: 'last_order', code: '431', name: 'คุณคัมภีร์(PM)', order_date: '2026-01-01T00:00:00.000Z' },
      { source: 'older_order', code: '422', name: 'คุณจิรายุ(PM)' },
    ], opts);
    ok('1h. ขั้น 1–2 ไม่ active → ได้ขั้น 3 (ใบล่าสุด) พร้อมวันที่',
      r1.status === 'resolved' && r1.source === 'last_order' && r1.user_id === 'Uc' && r1.order_date !== null,
      r1.status === 'resolved' ? `${r1.source} → ${r1.user_id}` : r1.status);
    const r2 = pickSalesOwner([
      { source: 'customer', code: '422', name: 'คุณจิรายุ(PM)' },
      { source: 'last_order', code: '431', name: 'คุณคัมภีร์(PM)' },
    ], opts);
    ok('1i. ขั้น 1 active → ใช้ขั้น 1 ไม่ดูใบสั่งขาย', r2.status === 'resolved' && r2.source === 'customer');
    const r3 = pickSalesOwner([
      { source: 'customer', code: null, name: 'purchase_user_1' },
      { source: 'last_order', code: inactiveCode, name: 'คนเก่า(PM)' },
    ], opts);
    ok('1j. ไม่มีใคร active → inactive พร้อมชื่อของขั้นแรก (ไม่เดาคนอื่น)',
      r3.status === 'inactive' && r3.odoo_name === 'purchase_user_1');
    ok('1k. ไม่มีผู้สมัครเลย → none', pickSalesOwner([], opts).status === 'none');
  }

  // query ใบสั่งขายต้องเชื่อมลูกค้าด้วย contact_id — sale_orders.company_id คือบริษัทผู้ขาย (1/2)
  const repoAll = readFileSync(new URL('../../db/repositories.ts', import.meta.url), 'utf-8');
  const fnStart = repoAll.indexOf('export async function getCompanyOrderSalespersons');
  const fnSrc = fnStart >= 0 ? repoAll.slice(fnStart, repoAll.indexOf('\n}\n', fnStart)) : '';
  ok('1l. getCompanyOrderSalespersons() เชื่อมด้วย s.contact_id และไม่แตะ s.company_id',
    fnSrc !== '' && /s\.contact_id IN/.test(fnSrc) && !/s\.company_id/.test(fnSrc));

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
  console.log(`\n${BOLD}3) resolveCustomerSalesOwner — บริษัทจริง ครบ 4 ขั้น${RESET}`);
  const options = await listSalespersonsForWeb();
  const activeCodes = options.map((o) => String(o.salesperson_id ?? '')).filter((c) => c !== '');
  const inOptions = (o: SalesOwner) => o.status !== 'resolved' || options.some((x) => x.user_id === o.user_id);
  const show = (o: SalesOwner) =>
    o.status === 'resolved' ? `${o.source} → ${o.name} (${o.salesperson_id})${o.order_date ? ' ' + o.order_date.slice(0, 10) : ''}` : o.status;

  // สถานะของแต่ละบริษัทคำนวณด้วย SQL แยกจากโค้ดที่ถูกทดสอบ — แล้วดูว่าโค้ดเลือกขั้นเดียวกันไหม
  //  ⚠️ ใบสั่งขายเชื่อมด้วย contact_id เหมือนกัน (ไม่ใช่ sale_orders.company_id)
  const facts = `
    WITH act AS (SELECT unnest($1::text[]) AS code),
    m1 AS (SELECT DISTINCT ON (company_id) company_id, salesperson_id FROM customers_data_view
            WHERE salesperson IS NOT NULL ORDER BY company_id, contact_id),
    mact AS (SELECT DISTINCT company_id FROM customers_data_view v JOIN act ON act.code = v.salesperson_id),
    cc AS (SELECT DISTINCT company_id, contact_id FROM customers_data_view WHERE contact_id > 0),
    o AS (SELECT cc.company_id, s.salesperson_id::text code, s.order_date FROM cc
            JOIN sale_orders s ON s.contact_id = cc.contact_id WHERE s.salesperson_id IS NOT NULL),
    olast AS (SELECT DISTINCT ON (company_id) company_id, code FROM o ORDER BY company_id, order_date DESC NULLS LAST),
    oact AS (SELECT DISTINCT o.company_id FROM o JOIN act ON act.code = o.code)
    SELECT c.company_id,
           (m1.salesperson_id IN (SELECT code FROM act)) AS s1,
           (mact.company_id IS NOT NULL)                 AS s2,
           (olast.code IN (SELECT code FROM act))        AS s3,
           (oact.company_id IS NOT NULL)                 AS s4,
           (m1.company_id IS NOT NULL OR olast.company_id IS NOT NULL) AS any_info
      FROM (SELECT DISTINCT company_id FROM customers_data_view) c
      LEFT JOIN m1 USING (company_id) LEFT JOIN mact USING (company_id)
      LEFT JOIN olast USING (company_id) LEFT JOIN oact USING (company_id)`;
  const pickCo = async (cond: string) =>
    (await pool.query(`SELECT company_id FROM (${facts}) f WHERE ${cond} ORDER BY company_id LIMIT 1`, [activeCodes])).rows[0]?.company_id as number | undefined;

  const cases: { label: string; cond: string; expect: SalesOwner['status']; source?: string }[] = [
    { label: '3a. ขั้น 1 เซลส์ในข้อมูลลูกค้า active → customer', cond: 's1', expect: 'resolved', source: 'customer' },
    { label: '3b. ขั้น 1 ไม่ได้ แต่ผู้ติดต่อคนอื่นได้ → contact', cond: 'NOT coalesce(s1,false) AND s2', expect: 'resolved', source: 'contact' },
    { label: '3c. ข้อมูลลูกค้าไม่ได้ ใบล่าสุดได้ → last_order', cond: 'NOT coalesce(s1,false) AND NOT s2 AND s3', expect: 'resolved', source: 'last_order' },
    { label: '3d. ใบล่าสุดก็ไม่ได้ ใบเก่ากว่าได้ → older_order', cond: 'NOT coalesce(s1,false) AND NOT s2 AND NOT coalesce(s3,false) AND s4', expect: 'resolved', source: 'older_order' },
    { label: '3e. มีข้อมูลแต่ไม่มีใคร active เลย → inactive (ไม่เดา)', cond: 'any_info AND NOT coalesce(s1,false) AND NOT s2 AND NOT coalesce(s3,false) AND NOT s4', expect: 'inactive' },
    { label: '3f. ไม่มีข้อมูลเซลส์เลย → none', cond: 'NOT any_info', expect: 'none' },
  ];
  for (const k of cases) {
    const id = await pickCo(k.cond);
    if (id === undefined) { console.log(`  ${DIM}   (ข้าม ${k.label.slice(0, 3)} — ไม่มีบริษัทตัวอย่าง)${RESET}`); continue; }
    const o = await resolveCustomerSalesOwner(id, options);
    const good = o.status === k.expect && (k.source === undefined || (o.status === 'resolved' && o.source === k.source));
    ok(k.label, good && inOptions(o), `บริษัท ${id} → ${show(o)}`);
  }
  ok('3g. company_id ไม่ถูกต้อง → none ไม่ throw', (await resolveCustomerSalesOwner(0, options)).status === 'none');

  // กวาดตัวอย่าง 300 บริษัทที่มีออเดอร์ใน 365 วัน: คำตอบต้องเป็นตัวเลือกของ dropdown ทุกราย
  const { rows: sampleCos } = await pool.query(
    `SELECT DISTINCT v.company_id FROM sale_orders s JOIN customers_data_view v ON v.contact_id = s.contact_id AND v.contact_id > 0
      WHERE s.order_date > now() - interval '365 days' ORDER BY v.company_id LIMIT 300`);
  let resolvedN = 0, notInOptions = 0;
  const bySource: Record<string, number> = {};
  for (const r of sampleCos) {
    const o = await resolveCustomerSalesOwner(r.company_id, options);
    if (o.status === 'resolved') { resolvedN++; bySource[o.source] = (bySource[o.source] ?? 0) + 1; }
    if (!inOptions(o)) notInOptions++;
  }
  ok(`3h. ตัวอย่าง ${sampleCos.length} บริษัท: คำตอบเป็นตัวเลือกของ dropdown ทุกราย`, notInOptions === 0,
    `เติมให้ได้ ${resolvedN} · ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

  // PM/THT คนเดียวกันคนละรหัส — ชื่อใน Odoo บอกฝั่งอยู่แล้ว ห้ามตัด (PM)/(THT) ทิ้งแล้วเทียบ
  const { rows: sides } = await pool.query(
    `SELECT DISTINCT salesperson, salesperson_id FROM customers_data_view
      WHERE salesperson IN ('คุณคัมภีร์(PM)', 'คุณคัมภีร์(THT)')`);
  const pm = sides.find((r: any) => r.salesperson.endsWith('(PM)'))?.salesperson_id;
  const tht = sides.find((r: any) => r.salesperson.endsWith('(THT)'))?.salesperson_id;
  if (pm && tht) ok('3i. PM กับ THT ของคนเดียวกันได้คนละรหัส', pm !== tht, `PM ${pm} · THT ${tht}`);

  // ── 4. ใบเดิม ───────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}4) resolveQuotationSalesOwner — ใบจริง${RESET}`);
  const lineQ = (await pool.query(
    `SELECT q.quotation_no, q.user_id, s.salesperson_id FROM quotations q JOIN salesperson s ON s.user_id = q.user_id
      WHERE q.quotation_no IS NOT NULL AND q.user_id NOT LIKE 'web:%' AND s.status = 'active'
        AND s.salesperson_id = ANY($1::text[])
      ORDER BY q.updated_at DESC LIMIT 1`, [activeCodes])).rows[0];
  if (lineQ) {
    const o = await resolveQuotationSalesOwner(lineQ.user_id, options);
    ok('4a. ใบจาก LINE → เซลส์คนเดิม', o.status === 'resolved' && o.source === 'quotation' && o.salesperson_id === lineQ.salesperson_id,
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
