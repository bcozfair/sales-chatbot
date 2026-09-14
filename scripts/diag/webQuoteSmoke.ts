// ─────────────────────────────────────────────────────────────────────────────
//  webQuoteSmoke — ด่านของเฟส D (docs/plan-web-quote-request.md §9.0 ข้อ 1–4)
//  รัน:  npm run diag:web-quote        (ต้องเปิดเซิร์ฟเวอร์ npm run dev ไว้ก่อน — ใช้ในข้อ 3)
//
//  1. extractQuoteFromText() ด้วยข้อความจริง → slots ครบ 3 แบบ เรียงตามที่พิมพ์
//     และเรียกได้โดยไม่ส่ง remainingMs/checkpoint                                    [เฟส C]
//  2. proposeFromText() ต้อง **ไม่เขียน quotations** และ **ไม่ลบร่างที่ค้างอยู่**      [เฟส D]
//  3. createDraft() → PUT /api/quotation/:id → confirm ครบวงจรด้วย webUserId          [เฟส D]
//  4. reviseQuotation() — ใบที่ยืนยันแล้ว → ได้ร่าง revision · เลขที่ไม่มีจริง → ปฏิเสธ [เฟส D]
//     + เส้นทางของหน้าเว็บ: รายการกลับเข้าฟอร์ม → createDraft({reviseFrom}) → confirm
//  5. ประวัติลง `messages` ครบ 4 ชนิด · chosen_rank คำนวณถูก · แถวของ LINE ไม่ปนเปื้อน
//     (docs/plan-web-quote-logging.md §7)
//  6. previewDraft() — dry-run ที่ต้องไม่เขียน DB · แบ่งใบ PM/THT · คืนกำหนดส่ง
//     และบรรทัดค่าบริการที่แอดมินเพิ่มเองต้องรอดไปถึงใบจริง (บรรทัดเดียวเสมอ)
//  7. เครดิต/กำหนดส่งที่แอดมินตั้งทับ — เปลี่ยนคำตอบของกฎค่าบริการจริง · ลงคอลัมน์/คีย์ถูกที่
//     · ค่าที่ไม่รู้จักถูกปฏิเสธ 400 · ยืนยันแล้วถูกตรึงเป็น source 'override'
//
//  ⚠️ เขียนข้อมูลจริงลง DB (salesperson · admin_users · quotations ของ user ทดสอบ)
//     แล้วลบทิ้งใน finally ทุกกรณี — user/แอดมินทดสอบเป็นค่าคงที่ที่ไม่ชนของจริง
//  ค่าใช้จ่าย: LLM ~2-4 call (ข้อ 1 และข้อ 2 อย่างละรอบ)
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from '../../config/db.js';
import { insertMessage } from '../../db/repositories.js';
import { extractQuoteFromText, buildResolvedItem } from '../../services/quoteExtraction.js';
import { validateQuotationItems } from '../../services/quotationService.js';
import { decideCustomerSelection } from '../../services/customerService.js';
import {
  proposeFromText,
  createDraft,
  previewDraft,
  reviseQuotation,
  resolveWebUserId,
  WebQuoteError,
} from '../../services/webQuoteService.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';

const PORT = process.env.PORT || 3011;
const BASE = process.env.APP_URL || `http://localhost:${PORT}`;

// LINE user id = 'U' + hex 32 ตัว — ให้เข้ารูปเดิมเป๊ะ จะได้ไม่หลุดเข้าเส้นทาง web: ของแผนนี้เอง
const TEST_SP_USER = 'U' + 'd2b8' + '0'.repeat(28);
const TEST_ADMIN_USERNAME = 'diag_webquote_tmp';
const TEST_MAKER = 'DIAG ผู้จัดทำ (ลบอัตโนมัติ)';

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ${GREEN}✓${RESET} ${label}${extra ? ` ${DIM}${extra}${RESET}` : ''}`); }
  else { fail++; console.log(`  ${RED}✗${RESET} ${label}${extra ? ` ${DIM}${extra}${RESET}` : ''}`); }
}

/** ข้อความทดสอบชุดเดียวกับด่านเฟส C — 3 บรรทัดสินค้า = 3 ทางออกของ slots */
const SAMPLE_TEXT = [
  'เสนอราคา',
  'บริษัท สยามเพาเวอร์ เทคโนโลยี จำกัด',
  'คุณนรินทร์',
  'KR-Q50NW = 2 ตัว',   // stage1 exact      → resolved
  'KM-09N = 2 ตัว',     // candidates หลายตัว → กำกวม
  'ZZQWXYP = 2 ตัว',    // ไม่มี candidate    → พิมพ์ผิด
  'ลด 30%',
].join('\n');

const slotModel = (s: any): string =>
  String(s?.itemForDb?.model ?? s?.item?.model ?? s?.item?.product_code ?? '').toUpperCase();

// ── setup / teardown ─────────────────────────────────────────────────────────

let adminId = 0;
let webUserId = '';

async function setup() {
  await pool.query(
    `INSERT INTO salesperson (user_id, name, status, phone, salesperson_id, branch)
     VALUES ($1, 'DIAG เฟส D (ลบอัตโนมัติ)', 'active', '000-000-0000', 'DIAGD', 'สำนักงานใหญ่')
     ON CONFLICT (user_id) DO UPDATE SET status = 'active'`,
    [TEST_SP_USER]
  );

  const { rows } = await pool.query(
    `INSERT INTO admin_users (username, password_hash, name, role, employee_quotation_id)
     VALUES ($1, 'x-diag-not-a-login', 'DIAG แอดมินทดสอบ (ลบอัตโนมัติ)', 'admin', $2)
     ON CONFLICT (username) DO UPDATE SET employee_quotation_id = EXCLUDED.employee_quotation_id
     RETURNING id`,
    [TEST_ADMIN_USERNAME, TEST_MAKER]
  );
  adminId = rows[0].id;
}

async function teardown() {
  // ลบใบของ user ทดสอบทั้งฝั่ง LINE-shaped และฝั่งพร็อกซี ก่อนลบแถวเจ้าของ (FK)
  const users = [TEST_SP_USER, webUserId].filter(Boolean);
  for (const u of users) {
    await pool.query('DELETE FROM quotations WHERE user_id = $1', [u]).catch(() => {});
    await pool.query('DELETE FROM messages WHERE user_id = $1', [u]).catch(() => {});
  }
  await pool.query("DELETE FROM salesperson WHERE user_id = ANY($1)", [users]).catch(() => {});
  await pool.query('DELETE FROM admin_users WHERE username = $1', [TEST_ADMIN_USERNAME]).catch(() => {});
}

/** หา (บริษัท × ผู้ติดต่อ) จริงที่ผ่านด่านลูกค้า (ไม่ติด blacklist / ไม่ติดเครดิต) */
async function pickCustomerContact(): Promise<{ customerId: number; contactId: number; name: string }> {
  const { rows } = await pool.query(`
    SELECT company_id, contact_id, customer_name, contact_name
      FROM customers_data_view
     WHERE contact_id > 0 AND company_id > 0
       AND customer_name IS NOT NULL AND contact_name IS NOT NULL
     ORDER BY contact_id DESC
     LIMIT 15
  `);
  for (const r of rows) {
    const { violations } = await validateQuotationItems([], {
      stage: 'draft', customerId: r.company_id, contactId: r.contact_id
    });
    if (violations.length === 0) {
      return { customerId: r.company_id, contactId: r.contact_id, name: `${r.customer_name} | ${r.contact_name}` };
    }
  }
  throw new Error('หาลูกค้าที่ผ่านด่าน blacklist/เครดิตไม่ได้เลยใน 15 แถวแรก — ตรวจข้อมูล dev ก่อน');
}

/** หาสินค้าจริงที่ผ่านด่านกฎกับลูกค้ารายนั้น (สต๊อก · MOQ · ราคาขั้นต่ำ · บล็อก) */
async function pickProduct(cust: { customerId: number; contactId: number; name: string }): Promise<any> {
  const { rows } = await pool.query(`
    SELECT * FROM products
     WHERE sales_price > 0 AND quantity_on_hand_unreserved > 5
     ORDER BY quantity_on_hand_unreserved DESC
     LIMIT 10
  `);
  for (const p of rows) {
    const { itemForDb } = buildResolvedItem(p, { quantity: 1 }, {});
    const { violations } = await validateQuotationItems([itemForDb], {
      stage: 'draft', customerName: cust.name.split(' | ')[0], customerId: cust.customerId, contactId: cust.contactId
    });
    if (violations.length === 0) return p;
  }
  throw new Error('หาสินค้าที่ผ่านด่านกฎไม่ได้เลยใน 10 แถวแรก — ตรวจข้อมูล dev ก่อน');
}

async function serverIsUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/shipping-fee/config`, { method: 'GET' });
    return r.status < 500;
  } catch { return false; }
}

// ── ด่าน ─────────────────────────────────────────────────────────────────────

/** ข้อ 1 — extractQuoteFromText() คืน slots ครบ 3 แบบ เรียงตามที่พิมพ์ (เฟส C) */
async function case1() {
  console.log(`\n${BOLD}1) extractQuoteFromText — slots 3 แบบ เรียงตามที่พิมพ์${RESET}`);
  // จงใจไม่ส่ง remainingMs/checkpoint — ต้องทำงานได้โดยไม่ต้องปลอม deadline ของ LINE
  const r = await extractQuoteFromText({ userId: TEST_SP_USER, text: SAMPLE_TEXT });

  ok('intent = QUOTATION', r.intent === 'QUOTATION', `ได้ ${r.intent}`);
  const slots = r.slots ?? [];
  ok('ได้ slots ครบ 3 รายการ', slots.length === 3, `ได้ ${slots.length}`);
  if (slots.length !== 3) return;

  ok('เรียงตามลำดับที่พิมพ์', slotModel(slots[0]).includes('KR-Q50NW') && slotModel(slots[2]).includes('ZZQWXYP'),
    `[${slots.map(slotModel).join(', ')}]`);
  ok('slot 1 = resolved', slots[0].resolved === true);
  ok('slot 2 = กำกวม (ไม่ resolved แต่มี candidates)',
    slots[1].resolved === false && (slots[1].candidates?.length ?? 0) > 0,
    `candidates=${slots[1].candidates?.length ?? 0}`);
  ok('slot 3 = พิมพ์ผิด (ไม่ resolved และไม่มี candidates)',
    slots[2].resolved === false && (slots[2].candidates?.length ?? 0) === 0);
}

/** ข้อ 2 — proposeFromText ต้องไม่เขียน quotations และไม่ลบร่างที่ค้างอยู่ */
async function case2() {
  console.log(`\n${BOLD}2) proposeFromText — ไม่เขียน quotations · ไม่ลบร่างที่ค้าง${RESET}`);
  webUserId = await resolveWebUserId(adminId, TEST_SP_USER);
  ok('ensureWebProxy คืน web:<admin>:<sp>', webUserId === `web:${adminId}:${TEST_SP_USER}`, webUserId);

  // ร่างค้าง 1 ใบที่ "ต้องรอด" — นี่คือของที่ deletePendingQuotations จะกวาดทิ้งถ้าเผลอเรียก
  const { rows: seeded } = await pool.query(
    `INSERT INTO quotations (user_id, status, total_sum, customer_details, item_details, employee_details)
     VALUES ($1, 'draft', 0, '{"customer_name":"DIAG ร่างที่ต้องรอด"}', '[]', '{}')
     RETURNING id`,
    [webUserId]
  );
  const survivorId = seeded[0].id;

  const before = Number((await pool.query('SELECT COUNT(*)::int AS n FROM quotations WHERE user_id = $1', [webUserId])).rows[0].n);
  const proposed = await proposeFromText({ adminId, spUserId: TEST_SP_USER, text: SAMPLE_TEXT });
  const after = Number((await pool.query('SELECT COUNT(*)::int AS n FROM quotations WHERE user_id = $1', [webUserId])).rows[0].n);

  ok('ไม่มีใบใหม่ถูกเขียน', before === after, `ก่อน ${before} → หลัง ${after}`);
  const alive = Number((await pool.query(
    "SELECT COUNT(*)::int AS n FROM quotations WHERE id = $1 AND status = 'draft'", [survivorId]
  )).rows[0].n);
  ok('ร่างที่ค้างอยู่ยังอยู่ครบ (ไม่เรียก deletePendingQuotations)', alive === 1);

  ok('คืน slots ให้ฟอร์มเรนเดอร์', (proposed.slots?.length ?? 0) === 3, `ได้ ${proposed.slots?.length ?? 0}`);
  ok('นับ slot ที่ยังไม่ resolve ให้', proposed.unresolved_count === 2, `ได้ ${proposed.unresolved_count}`);
  ok('คืน customer_candidates มาให้เคาะ', Array.isArray(proposed.customer_candidates),
    `${proposed.customer_candidates.length} ตัว`);

  // ── ชั้นตัดสินใจ (2026-09-14) ──────────────────────────────────────────────
  // ตารางความจริงของ decideCustomerSelection เขียนไว้ตรง ๆ ตรงนี้ ไม่ได้คำนวณจากตัวมันเอง
  // ⇒ ใครขยับเกณฑ์ 0.05 หรือเผลอเปลี่ยนเป็นนับจำนวน ด่านนี้ล้มทันที · ไม่แตะ DB ไม่แตะ LLM
  const s = (...scores: number[]) => scores.map(v => ({ item: { id: 1 }, score: v }));
  ok('gate: ไม่มี candidate → ไม่ตัดสิน', decideCustomerSelection([]).auto === false);
  ok('gate: candidate เดียว → ตัดสินได้', decideCustomerSelection(s(0.4)).auto === true);
  ok('gate: 0 vs 0.06 → ตัดสินได้ (ห่างเกิน 0.05)', decideCustomerSelection(s(0, 0.06)).auto === true);
  ok('gate: 0 vs 0.05 → ไม่ตัดสิน (ห่างไม่ถึง)', decideCustomerSelection(s(0, 0.05)).auto === false);
  ok('gate: 0.06 vs 0.5 → ไม่ตัดสิน (ตัวนำคะแนนแย่เกิน)', decideCustomerSelection(s(0.06, 0.5)).auto === false);
  ok('gate: คะแนนเท่ากัน → ไม่ตัดสิน', decideCustomerSelection(s(0, 0)).auto === false);

  // สัญญาที่ฟอร์มพึ่งพา — ตรวจแบบไม่ผูกกับข้อมูลจริง (ชื่อบริษัทใน SAMPLE_TEXT มี/ไม่มีใน DB ก็ผ่าน)
  const expectAuto = decideCustomerSelection(proposed.customer_candidates);
  ok('auto_customer_id ตรงกับผลของ gate',
    proposed.auto_customer_id === (expectAuto.auto ? Number(expectAuto.winner?.item?.id) || null : null),
    `ได้ ${proposed.auto_customer_id}`);
  ok('auto_customer_id ที่ไม่ null ต้องอยู่ในลิสต์ที่ส่งให้ฟอร์มจริง',
    proposed.auto_customer_id === null
    || proposed.customer_candidates.some((c: any) => Number(c?.item?.id) === proposed.auto_customer_id));

  await pool.query('DELETE FROM quotations WHERE id = $1', [survivorId]);
}

/** ข้อ 3 — createDraft → PUT → confirm ครบวงจรด้วย webUserId */
async function case3(): Promise<string | null> {
  console.log(`\n${BOLD}3) createDraft → PUT /api/quotation/:id → confirm${RESET}`);
  const cust = await pickCustomerContact();
  const product = await pickProduct(cust);
  console.log(`  ${DIM}ลูกค้า: ${cust.name} · สินค้า: ${product.model}${RESET}`);

  const draft = await createDraft({
    adminId,
    spUserId: TEST_SP_USER,
    customerId: cust.customerId,
    contactId: cust.contactId,
    items: [{ product_template_id: product.product_template_id, quantity: 2 }],
  });
  ok('createDraft คืนใบร่าง', (draft.quotes?.length ?? 0) > 0, `${draft.quotes?.length ?? 0} ใบ`);
  ok('ใบเป็นของ webUserId', draft.web_user_id === webUserId, draft.web_user_id);
  if (!draft.quotes?.length) return null;

  const quote = draft.quotes[0];
  const ownerRow = (await pool.query('SELECT user_id, status FROM quotations WHERE id = $1', [quote.id])).rows[0];
  ok('แถวใน DB ถูกผูกกับ web:% และเป็น draft',
    ownerRow?.user_id === webUserId && ownerRow?.status === 'draft', `${ownerRow?.user_id} / ${ownerRow?.status}`);

  // ── ต่อด้วย endpoint เดิมที่ตรวจสิทธิ์จาก userId ใน body (ขั้น 8′) ──
  const putResp = await fetch(`${BASE}/api/quotation/${quote.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: quote.items, total_sum: quote.total_sum, userId: webUserId }),
  });
  ok('PUT /api/quotation/:id ด้วย webUserId → 200', putResp.status === 200, `HTTP ${putResp.status}`);

  const wrongResp = await fetch(`${BASE}/api/quotation/${quote.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: quote.items, userId: TEST_SP_USER }),
  });
  ok('PUT ด้วย userId ของคนอื่น → 403', wrongResp.status === 403, `HTTP ${wrongResp.status}`);

  const confirmResp = await fetch(`${BASE}/api/quotation/${quote.id}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: webUserId }),
  });
  const confirmBody: any = await confirmResp.json().catch(() => ({}));
  ok('confirm ด้วย webUserId → 200', confirmResp.status === 200, `HTTP ${confirmResp.status}`);

  const confirmed = (await pool.query('SELECT status, quotation_no FROM quotations WHERE id = $1', [quote.id])).rows[0];
  ok('ใบถูกยืนยันและได้เลขที่จริง',
    confirmed?.status === 'confirmed' && !!confirmed?.quotation_no,
    `${confirmed?.status} / ${confirmed?.quotation_no ?? '(ไม่มีเลข)'}`);

  return confirmed?.quotation_no ?? confirmBody?.quotation_no ?? null;
}

/** ข้อ 4 — reviseQuotation: ใบที่ยืนยันแล้วได้ร่าง · เลขที่ใช้ไม่ได้ต้องถูกปฏิเสธ */
async function case4(quotationNo: string | null) {
  console.log(`\n${BOLD}4) reviseQuotation${RESET}`);
  if (!quotationNo) {
    fail++;
    console.log(`  ${RED}✗${RESET} ข้ามข้อ 4 — ข้อ 3 ไม่ได้เลขที่ใบมาให้ revise`);
    return;
  }

  const revised = await reviseQuotation({ adminId, spUserId: TEST_SP_USER, quotationNo });
  ok('ใบที่ยืนยันแล้ว → ได้ร่าง revision', !!revised.draft_quote_id, revised.draft_quote_id);
  ok('ร่างอ้างเลขที่ใบต้นทางถูกต้อง', revised.revise_from === quotationNo, revised.revise_from);

  const draftRow = (await pool.query(
    'SELECT user_id, status, quotation_no FROM quotations WHERE id = $1', [revised.draft_quote_id]
  )).rows[0];
  ok('ร่างเป็นของ webUserId และยังไม่มีเลขที่',
    draftRow?.user_id === webUserId && draftRow?.status === 'draft' && !draftRow?.quotation_no,
    `${draftRow?.status} / ${draftRow?.quotation_no ?? '(ไม่มีเลข)'}`);

  // ร่าง (ยังไม่มีเลขที่) ไม่มีทางถูกอ้างถึงได้เลย — ไม่มีเลขให้พิมพ์ ⇒ ต้องตอบ "ไม่พบ" ไม่ใช่ 500
  let code = '';
  try { await reviseQuotation({ adminId, spUserId: TEST_SP_USER, quotationNo: 'QP-999999999' }); }
  catch (e: any) { code = e instanceof WebQuoteError ? e.code : `(${e?.name}) ${e?.message}`; }
  ok('เลขที่ไม่มีในระบบ → QUOTATION_NOT_FOUND', code === 'QUOTATION_NOT_FOUND', code || '(ไม่ throw)');

  let blankCode = '';
  try { await reviseQuotation({ adminId, spUserId: TEST_SP_USER, quotationNo: '  ' }); }
  catch (e: any) { blankCode = e instanceof WebQuoteError ? e.code : `(${e?.name}) ${e?.message}`; }
  ok('ไม่ส่งเลขที่ → BAD_REQUEST', blankCode === 'BAD_REQUEST', blankCode || '(ไม่ throw)');


  // ── เส้นทางจริงของหน้าเว็บตั้งแต่ 2026-09-14 ────────────────────────────────
  //  หน้าเว็บ *ไม่* ยืนยันร่างที่ reviseQuotation สร้างไว้ — มันเอารายการกลับเข้าฟอร์มให้แก้
  //  แล้วออกใบจริงผ่าน createDraft({ reviseFrom }) เส้นเดียวกับทางปกติ ⇒ ด่านนี้เดินตามนั้นเป๊ะ
  //  รวมถึงการกรองบรรทัดที่กฎเติมให้เอง ซึ่งถ้าพลาดจะได้สินค้าพ่วงซ้ำสองชุดในใบใหม่
  const rq: any = revised.quotes?.[0];
  const formItems = (rq?.items ?? [])
    .filter((it: any) => !it.is_optional && (!it.is_shipping_fee || it.is_manual_service === true))
    .map((it: any) => ({
      product_template_id: it.product_id,
      quantity: it.quantity,
      price: it.price,
      discount_1: it.discount_1,
      discount_2: it.discount_2,
      ...(it.is_manual_service ? { name: it.name } : {}),
    }));

  const redraft = await createDraft({
    adminId,
    spUserId: TEST_SP_USER,
    customerId: rq?.customer_id,
    contactId: rq?.contact_id,
    items: formItems,
    reviseFrom: quotationNo,
  });
  ok('createDraft({reviseFrom}) คืนใบร่าง', (redraft.quotes?.length ?? 0) > 0, `${redraft.quotes?.length ?? 0} ใบ`);

  const leftover = Number((await pool.query(
    'SELECT COUNT(*)::int AS n FROM quotations WHERE id = $1', [revised.draft_quote_id]
  )).rows[0].n);
  ok('ร่างที่ revise เตรียมไว้ถูกล้างตอนออกใบจริง (ไม่มีร่างซ้อน)', leftover === 0, `เหลือ ${leftover} แถว`);

  const newQuote: any = redraft.quotes?.[0];
  // ธง revise_from อยู่ใน customer_details.revise_from — คอลัมน์ customer_name ไม่มีจริง
  // (enrichQuotationData เป็นคนประกอบกลับมาให้ตอนอ่าน) — นี่คือค่าที่ cancelOldRevision อ่านจริงตอนยืนยัน
  const nameRow = (await pool.query(
    `SELECT customer_details->>'revise_from' AS revise_from FROM quotations WHERE id = $1`, [newQuote?.id]
  )).rows[0];
  ok('ใบใหม่ติดธง revise_from ของใบต้นทาง',
    nameRow?.revise_from === quotationNo, String(nameRow?.revise_from ?? '(ไม่มี)'));

  const reConfirm = await fetch(`${BASE}/api/quotation/${newQuote?.id}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: webUserId }),
  });
  ok('ยืนยันใบ revision ด้วย webUserId → 200', reConfirm.status === 200, `HTTP ${reConfirm.status}`);

  const after = (await pool.query(
    'SELECT status, quotation_no FROM quotations WHERE id = $1', [newQuote?.id]
  )).rows[0];
  ok('ใบ revision ได้เลขที่ของตัวเอง', after?.status === 'confirmed' && !!after?.quotation_no,
    `${after?.status} / ${after?.quotation_no ?? '(ไม่มีเลข)'}`);

  const origin = (await pool.query(
    'SELECT status FROM quotations WHERE quotation_no = $1', [quotationNo]
  )).rows[0];
  ok('ใบต้นทางถูกยกเลิกอัตโนมัติตอนยืนยัน', origin?.status === 'cancelled', String(origin?.status));

  console.log(`  ${DIM}หมายเหตุ: กิ่ง QUOTATION_NOT_CONFIRMED เป็นด่านกันเหนียวที่ยกมาจาก`);
  console.log(`  handleQuotationEditRequest() — ผ่านทางค้นด้วยเลขที่จะไปไม่ถึง เพราะใบร่างไม่มีเลข${RESET}`);
}

// ── main ─────────────────────────────────────────────────────────────────────

/**
 * ข้อ 5 — ประวัติของหน้าเว็บลง `messages` (docs/plan-web-quote-logging.md)
 *
 * ต้องรันหลังข้อ 2–4 เพราะมันตรวจ "ร่องรอยที่สามข้อนั้นทิ้งไว้" ไม่ได้สร้างเหตุการณ์ใหม่เอง
 * ยกเว้นท่อนสุดท้ายที่ปลูกแถว web_propose สังเคราะห์เพื่อวัด chosen_rank แบบ deterministic
 * (ไม่ต้องพึ่ง LLM ว่าจะค้นเจอบริษัทไหน ⇒ ด่านไม่แกว่งตามข้อมูลจริง)
 */
async function case5() {
  console.log(`\n${BOLD}5) ประวัติลง messages${RESET}`);

  const rowsOf = async (t: string) => (await pool.query(
    'SELECT content, reply_content, reply_token, meta FROM messages WHERE user_id = $1 AND type = $2 ORDER BY id',
    [webUserId, t]
  )).rows;

  const propose = await rowsOf('web_propose');
  ok('propose เขียนแถว web_propose', propose.length >= 1, `${propose.length} แถว`);
  const p0 = propose[0];
  ok('content เก็บข้อความที่วางไว้ดิบ ๆ', p0?.content === SAMPLE_TEXT);
  ok('reply_token เป็น NULL (เว็บไม่มี token)', p0?.reply_token === null);
  ok('meta.cust_candidates ไม่ว่าง', Array.isArray(p0?.meta?.cust_candidates) && p0.meta.cust_candidates.length > 0,
    `${p0?.meta?.cust_candidates?.length ?? 0} ตัว`);
  ok('candidate เก็บ rank/score ไว้ให้วัดได้',
    p0?.meta?.cust_candidates?.[0]?.rank === 1 && p0?.meta?.cust_candidates?.[0]?.score !== undefined);

  const draft = await rowsOf('web_draft');
  ok('createDraft เขียนแถว web_draft', draft.length >= 1, `${draft.length} แถว`);
  ok('reply_content คงรูปแบบที่ evalCustomerSearch ขุดเฉลยได้',
    /ร่างใบเสนอราคา/.test(draft[0]?.reply_content ?? '') && /🏢 .+/.test(draft[0]?.reply_content ?? ''));
  ok('meta บันทึกสิ่งที่แอดมินเคาะจริง',
    Number(draft[0]?.meta?.chosen_customer_id) > 0 && Number(draft[0]?.meta?.chosen_contact_id) > 0);

  const confirmed = await rowsOf('web_confirm');
  ok('confirm เขียนแถว web_confirm', confirmed.length >= 1, `${confirmed.length} แถว`);
  ok('reply_content มีคำว่า "ยืนยันสำเร็จ" (ตัวตัดหน้าต่างประวัติ)',
    /ยืนยันสำเร็จ/.test(confirmed[0]?.reply_content ?? ''));
  ok('meta เก็บเลขที่ใบ', !!confirmed[0]?.meta?.quotation_no, confirmed[0]?.meta?.quotation_no ?? '-');

  const revised = await rowsOf('web_revise');
  ok('revise เขียนแถว web_revise', revised.length >= 1, `${revised.length} แถว`);

  // ── chosen_rank: ปลูก candidate ที่รู้คำตอบล่วงหน้า แล้ววัดว่าหลังบ้านอ่านกลับถูก ──
  const cust = await pickCustomerContact();
  const plantedId = await insertMessage({
    user_id: webUserId,
    message_id: `web_propose_planted_${Date.now()}`,
    type: 'web_propose',
    content: '(แถวสังเคราะห์ของด่าน — วัด chosen_rank)',
    reply_token: null,
    reply_content: '📝 ร่างใบเสนอราคา (ยังไม่บันทึก)',
    meta: {
      cust_candidates: [
        { rank: 1, id: -1, display_name: 'DIAG บริษัทที่ไม่ถูกเลือก', score: 0 },
        { rank: 2, id: cust.customerId, display_name: cust.name, score: 0.1 },
      ],
    },
  });
  ok('insertMessage คืน id ของแถวที่เพิ่งเขียน', typeof plantedId === 'number' && plantedId > 0, String(plantedId));

  const product = await pickProduct(cust);
  const d2 = await createDraft({
    adminId, spUserId: TEST_SP_USER,
    customerId: cust.customerId, contactId: cust.contactId,
    items: [{ product_template_id: product.product_template_id, quantity: 1 }],
    proposeMsgId: plantedId,
  });
  const linked = (await pool.query(
    `SELECT meta FROM messages WHERE user_id = $1 AND type = 'web_draft' ORDER BY id DESC LIMIT 1`, [webUserId]
  )).rows[0];
  ok('web_draft อ้างกลับไปที่แถว propose ที่ถูกต้อง', Number(linked?.meta?.propose_msg_id) === plantedId);
  ok('chosen_rank = อันดับที่แอดมินเคาะจริง (ปลูกไว้ที่ 2)', Number(linked?.meta?.chosen_rank) === 2,
    `ได้ ${linked?.meta?.chosen_rank}`);
  ok('createDraft ยังคืนใบร่างตามปกติ', (d2.quotes?.length ?? 0) > 0);

  // ── กันแถวสองช่องทางปนกัน (§3.1 · §7) ──
  const bleed = Number((await pool.query(
    `SELECT COUNT(*)::int AS n FROM messages WHERE user_id NOT LIKE 'web:%' AND meta IS NOT NULL`
  )).rows[0].n);
  ok('แถวที่ไม่ใช่ของเว็บต้องมี meta เป็น NULL ทุกแถว', bleed === 0, `พบ ${bleed} แถว`);

  const wrongType = Number((await pool.query(
    `SELECT COUNT(*)::int AS n FROM messages WHERE user_id LIKE 'web:%' AND left(type, 4) <> 'web_'`
  )).rows[0].n);
  ok("แถวของเว็บต้องไม่ใช้ type ของ LINE (เช่น 'text')", wrongType === 0, `พบ ${wrongType} แถว`);
}

/**
 * ข้อ 6 — พรีวิวก่อนกดสร้างร่าง + ค่าบริการที่แอดมินเพิ่มเอง
 *
 * สองเรื่องนี้อยู่ในข้อเดียวกันเพราะมันคือเส้นทางเดียวกันของแอดมิน: เห็นก่อน → เคาะ → กด
 * และทั้งคู่พังเงียบได้แบบเดียวกัน (บรรทัดหาย / ตัวเลขไม่ตรงกับที่บันทึกจริง)
 */
async function case6() {
  console.log(`\n${BOLD}6) previewDraft + ค่าบริการที่แอดมินเพิ่มเอง${RESET}`);
  const cust = await pickCustomerContact();
  const product = await pickProduct(cust);
  const { loadShippingFeeConfig, isShippingFeeItem } = await import('../../services/shippingFee.js');
  const cfg = await loadShippingFeeConfig();
  console.log(`  ${DIM}ลูกค้า: ${cust.name} · สินค้า: ${product.model} · ค่าบริการ: ${cfg.productInternalReference}${RESET}`);

  const items = [
    { product_template_id: product.product_template_id, quantity: 2 },
    { product_template_id: cfg.productId, quantity: 1, price: 3500, name: 'ค่าติดตั้งหน้างาน' },
  ];

  const countQuotes = async () =>
    Number((await pool.query(`SELECT COUNT(*)::int AS n FROM quotations`)).rows[0].n);

  const before = await countQuotes();
  const pv = await previewDraft({ customerId: cust.customerId, contactId: cust.contactId, items });
  const after = await countQuotes();
  ok('previewDraft ไม่เขียน quotations สักแถว', before === after, `${before} → ${after}`);
  ok('คืนใบอย่างน้อย 1 ใบ พร้อมข้อความกำหนดส่ง',
    pv.quotes.length > 0 && !!pv.quotes[0].delivery_text, pv.quotes[0]?.delivery_text);
  ok('คืนข้อมูลลูกค้าที่จะถูกบันทึกลงใบ', !!pv.customer.display_name && pv.customer.contact_id === cust.contactId);

  const pvFees = pv.quotes.flatMap((q) => q.items).filter((it) => it.is_shipping_fee);
  ok('บรรทัดค่าบริการมีบรรทัดเดียว', pvFees.length === 1, `ได้ ${pvFees.length}`);
  ok('  ใช้ชื่อที่แอดมินตั้ง ไม่ใช่ชื่อกลางจาก products', pvFees[0]?.name === 'ค่าติดตั้งหน้างาน', pvFees[0]?.name);
  ok('  ถูกทำเครื่องหมายว่าเป็นของที่คนใส่เอง', pvFees[0]?.is_manual_service === true);
  // กติกาของ applyShippingFeeToQuoteGroup: ใบ PM ก่อน ถ้าไม่มีใบ PM เลยก็ใบแรกที่มีสินค้า
  // (สินค้านำเข้าล้วนจะได้ใบ THT ใบเดียว — บรรทัดต้องไปอยู่ที่นั่น ไม่ใช่สร้างใบ PM เปล่าขึ้นมา)
  const feeQuote = pv.quotes.find((q) => q.items.some((it) => it.is_shipping_fee));
  const expectQuote = pv.quotes.find((q) => q.quote_company === 'PM') ?? pv.quotes[0];
  ok('  อยู่ในใบเดียวกับที่กฎฝั่ง server จะวางไว้', feeQuote === expectQuote,
    `ได้ใบ ${feeQuote?.quote_company} · คาด ${expectQuote?.quote_company}`);
  ok('ยอดสินค้าที่ใช้ตัดสินกฎไม่รวมค่าบริการ', pv.goods_total < pv.grand_total,
    `goods=${pv.goods_total} grand=${pv.grand_total}`);
  ok('ลูกค้า/สินค้าชุดนี้ไม่ติดกฎ ⇒ สร้างร่างได้', pv.violations.length === 0 && pv.can_create_draft);

  // ของจริง: กดสร้างแล้วบรรทัดต้องยังอยู่ — จุดที่เคยหายคือ insertDraftQuotations ตัดทิ้งก่อนแบ่งใบ
  const draft = await createDraft({
    adminId, spUserId: TEST_SP_USER,
    customerId: cust.customerId, contactId: cust.contactId, items,
  });
  ok('createDraft คืนใบร่าง', (draft.quotes?.length ?? 0) > 0, `${draft.quotes?.length ?? 0} ใบ`);

  const { rows: dbRows } = await pool.query(
    `SELECT item_details FROM quotations WHERE user_id = $1 AND status = 'draft'`, [webUserId]
  );
  const dbItems = dbRows.flatMap((r: any) => (Array.isArray(r.item_details) ? r.item_details : []));
  const dbFees = dbItems.filter((it: any) => isShippingFeeItem(it, cfg));
  ok('บรรทัดค่าบริการรอดไปถึงใบจริง 1 บรรทัด', dbFees.length === 1, `ได้ ${dbFees.length}`);
  ok('  ชื่อที่แอดมินตั้งอยู่รอดถึง DB', dbFees[0]?.name === 'ค่าติดตั้งหน้างาน', dbFees[0]?.name);
  ok('  ราคาที่แอดมินตั้งอยู่รอดถึง DB', Number(dbFees[0]?.price) === 3500, String(dbFees[0]?.price));
  ok('  ธง is_manual_service ถูกเก็บลง snapshot', dbFees[0]?.is_manual_service === true);

  // ตัวเลขที่แอดมินเห็นก่อนกด ต้องตรงกับที่บันทึกจริง ไม่งั้นพรีวิวไม่มีความหมาย
  const dbSum = Number(
    (await pool.query(
      `SELECT COALESCE(SUM(total_sum), 0)::float8 AS s FROM quotations WHERE user_id = $1 AND status = 'draft'`,
      [webUserId]
    )).rows[0].s
  );
  ok('ยอดรวมที่พรีวิวโชว์ = ยอดที่บันทึกจริง', Math.abs(dbSum - pv.grand_total) < 0.01,
    `พรีวิว ${pv.grand_total} · ใบจริง ${dbSum}`);
}

/** สินค้าที่ผ่านกฎ **และ** ราคาต่ำกว่าเกณฑ์ค่าบริการ — ต้องต่ำ ไม่งั้นกฎไม่ทำงานให้ทดสอบ */
async function pickCheapProduct(
  cust: { customerId: number; contactId: number; name: string },
  threshold: number,
): Promise<any> {
  const { rows } = await pool.query(`
    SELECT * FROM products
     WHERE sales_price > 0 AND sales_price < $1 AND quantity_on_hand_unreserved > 5
     ORDER BY quantity_on_hand_unreserved DESC
     LIMIT 10
  `, [threshold]);
  for (const p of rows) {
    const { itemForDb } = buildResolvedItem(p, { quantity: 1 }, {});
    const { violations } = await validateQuotationItems([itemForDb], {
      stage: 'draft', customerName: cust.name.split(' | ')[0], customerId: cust.customerId, contactId: cust.contactId
    });
    if (violations.length === 0) return p;
  }
  throw new Error(`หาสินค้าราคาต่ำกว่า ${threshold} ที่ผ่านด่านกฎไม่ได้ — ตรวจข้อมูล dev ก่อน`);
}

/**
 * ข้อ 7 — เครดิต/กำหนดส่งที่แอดมินตั้งทับ (2026-09-14)
 *
 * ข้อนี้มีเพราะการตั้งทับเครดิต **ไม่ได้แค่เปลี่ยนตัวหนังสือบนเอกสาร** — มันเปลี่ยนคำตอบของ
 * กฎค่าบริการด้วย ⇒ ต้องพิสูจน์ทั้งสองด้าน: พรีวิวเปลี่ยนตาม และใบที่บันทึกจริงตรงกับพรีวิว
 */
async function case7() {
  console.log(`\n${BOLD}7) เครดิต/กำหนดส่งที่แอดมินตั้งทับ${RESET}`);
  const cust = await pickCustomerContact();
  const { loadShippingFeeConfig, isShippingFeeItem } = await import('../../services/shippingFee.js');
  const cfg = await loadShippingFeeConfig();
  const product = await pickCheapProduct(cust, cfg.thresholdBeforeVat);
  const items = [{ product_template_id: product.product_template_id, quantity: 1 }];
  const base = { customerId: cust.customerId, contactId: cust.contactId, items };
  console.log(`  ${DIM}ลูกค้า: ${cust.name} · สินค้า: ${product.model} · เกณฑ์ค่าบริการ: ${cfg.thresholdBeforeVat}${RESET}`);

  // ── ก) เครดิตที่ตั้งทับต้องเปลี่ยนคำตอบของกฎค่าบริการ ──
  const cash = await previewDraft({ ...base, paymentTermsOverride: 'Cash' });
  const credit = await previewDraft({ ...base, paymentTermsOverride: '30 Days' });
  const feeCount = (pv: any) => pv.quotes.flatMap((q: any) => q.items).filter((it: any) => it.is_shipping_fee).length;

  ok('เครดิตที่ตั้งทับสะท้อนกลับมาในผลพรีวิว',
    cash.customer.payment_terms === 'Cash' && cash.customer.payment_terms_overridden === true,
    `${cash.customer.payment_terms} (ของลูกค้า: ${cash.customer.customer_payment_terms || '-'})`);
  ok('  has_credit_terms ตอบตามค่าที่ใช้จริง ไม่ใช่ค่าของลูกค้า',
    cash.customer.has_credit_terms === false && credit.customer.has_credit_terms === true);

  if (cfg.isActive) {
    ok('  ตั้งเป็น Cash ⇒ กฎเติมบรรทัดค่าบริการให้', feeCount(cash) === 1, `ได้ ${feeCount(cash)}`);
    ok('  ตั้งเป็น 30 Days ⇒ บรรทัดค่าบริการหายไป', feeCount(credit) === 0, `ได้ ${feeCount(credit)}`);
    ok('  ยอดรวมสองรอบต่างกันเท่าค่าบริการพอดี',
      Math.abs(cash.grand_total - credit.grand_total - cfg.feePrice * cfg.feeQuantity) < 0.01,
      `${cash.grand_total} − ${credit.grand_total}`);
  } else {
    console.log(`  ${DIM}ข้ามสามข้อของกฎค่าบริการ — shipping_fee_config ปิดอยู่บนเครื่องนี้${RESET}`);
  }

  // ── ข) กำหนดส่งที่ตั้งทับต้องเดินผ่าน resolveDeliveryTerms ตัวจริง ──
  const co = credit.quotes[0].quote_company;
  const autoDays = credit.quotes[0].delivery_days;
  const ovDelivery = [{ quote_company: co, delivery_type_override: 'import', delivery_days_override: 21 }];
  const ovPv = await previewDraft({ ...base, paymentTermsOverride: '30 Days', delivery: ovDelivery });
  const q0 = ovPv.quotes.find((q) => q.quote_company === co)!;

  ok('พรีวิวคืนข้อความกำหนดส่งตามค่าที่ตั้งเอง',
    q0.delivery_text.includes('Import.,With in') && q0.delivery_days === 21, q0.delivery_text);
  ok('  ยังคืนค่าอัตโนมัติมาให้เทียบคู่กัน', q0.delivery_days_auto === autoDays && !!q0.delivery_auto_label,
    `อัตโนมัติ ${q0.delivery_auto_label} ${q0.delivery_days_auto} วัน`);
  ok('  คืนตารางประเภทการจัดส่งครบชุดให้หน้าจอ (ไม่ต้องมีสำเนาที่สอง)',
    ovPv.delivery_types.length === 4 && ovPv.delivery_types.every((t) => !!t.key && !!t.label));

  let rejected = false;
  try {
    await previewDraft({ ...base, delivery: [{ quote_company: co, delivery_type_override: 'teleport' }] });
  } catch (e: any) {
    rejected = e instanceof WebQuoteError && e.status === 400;
  }
  ok('  ประเภทที่ไม่รู้จักถูกปฏิเสธเป็น 400 ไม่ใช่ทิ้งเงียบ', rejected);

  // ── ค) ของจริง: createDraft แล้วค่าต้องลงถูกที่ ──
  const draft = await createDraft({
    adminId, spUserId: TEST_SP_USER,
    customerId: cust.customerId, contactId: cust.contactId, items,
    paymentTermsOverride: '30 Days', delivery: ovDelivery,
  });
  ok('createDraft คืนใบร่าง', (draft.quotes?.length ?? 0) > 0, `${draft.quotes?.length ?? 0} ใบ`);

  const { rows: dbRows } = await pool.query(`
    SELECT id, delivery_type_override, delivery_days_override, item_details,
           customer_details->>'payment_terms' AS pt
      FROM quotations
     WHERE user_id = $1 AND status = 'draft'`, [webUserId]);
  // ใบที่ตั้งค่าไว้คือใบของบริษัท `co` — หาเจอจากคอลัมน์ override ที่มีค่า (อีกใบต้องเป็น null)
  const target = dbRows.find((r: any) => r.delivery_type_override !== null) ?? dbRows[0];

  ok('เครดิตที่ตั้งทับถูกบันทึกลง customer_details', target?.pt === '30 Days', String(target?.pt));
  ok('กำหนดส่งที่ตั้งทับลงคอลัมน์ override ครบทั้งคู่',
    target?.delivery_type_override === 'import' && Number(target?.delivery_days_override) === 21,
    `${target?.delivery_type_override} / ${target?.delivery_days_override}`);

  const dbFees = dbRows
    .flatMap((r: any) => (Array.isArray(r.item_details) ? r.item_details : []))
    .filter((it: any) => isShippingFeeItem(it, cfg));
  ok('ใบที่บันทึกจริงไม่มีบรรทัดค่าบริการ — กฎหลัง INSERT อ่านเครดิตที่ตั้งทับด้วย',
    dbFees.length === 0, `ได้ ${dbFees.length} บรรทัด`);

  // ── ค2) บันทึกซ้ำผ่าน PUT ต้องไม่คืนเครดิตกลับเป็นของลูกค้า ──
  //  จุดนี้คือสิ่งที่ plan-web-quote-request §4.1 ทำนายไว้: ทุกจุดที่บันทึกใบประกอบ
  //  customer_details ใหม่จาก customers_data_view ⇒ ถ้าไม่มีธง payment_terms_override
  //  ให้หยิบกลับ ค่าที่แอดมินตั้งจะหายเงียบ ๆ ตอนเซลส์กดบันทึกในหน้าแก้ไขใบ
  const targetQuote = draft.quotes.find((q: any) => String(q.id) === String(target.id)) ?? draft.quotes[0];
  const putResp = await fetch(`${BASE}/api/quotation/${target.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: targetQuote.items, total_sum: targetQuote.total_sum, userId: webUserId }),
  });
  ok('PUT /api/quotation/:id บนใบที่ตั้งเครดิตเอง → 200', putResp.status === 200, `HTTP ${putResp.status}`);
  const afterPut = (await pool.query(
    `SELECT customer_details->>'payment_terms' AS pt,
            customer_details->>'payment_terms_override' AS ov,
            delivery_type_override, delivery_days_override
       FROM quotations WHERE id = $1`, [target.id])).rows[0];
  ok('  เครดิตที่ตั้งทับไม่ถูกเขียนกลับเป็นของลูกค้า', afterPut?.pt === '30 Days', String(afterPut?.pt));
  ok('  ธง payment_terms_override ยังติดอยู่กับใบ', afterPut?.ov === '30 Days', String(afterPut?.ov));
  ok('  กำหนดส่งที่ตั้งเองก็ไม่ถูกล้างด้วย client ที่ไม่ส่งฟิลด์นั้นมา',
    afterPut?.delivery_type_override === 'import' && Number(afterPut?.delivery_days_override) === 21,
    `${afterPut?.delivery_type_override} / ${afterPut?.delivery_days_override}`);

  // ── ง) ยืนยันแล้วค่าที่ตั้งไว้ต้องถูก "ตรึง" ลงใบ ──
  const confirmResp = await fetch(`${BASE}/api/quotation/${target.id}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: webUserId }),
  });
  ok('confirm ใบที่ตั้งค่าเอง → 200', confirmResp.status === 200, `HTTP ${confirmResp.status}`);

  const after = (await pool.query(
    `SELECT delivery_terms, customer_details->>'payment_terms' AS pt FROM quotations WHERE id = $1`,
    [target.id])).rows[0];
  const dt = after?.delivery_terms ?? {};
  ok('delivery_terms ที่ตรึงตอนยืนยันใช้ค่าที่ตั้งเอง',
    dt.type === 'import' && Number(dt.days) === 21, `${dt.type} ${dt.days}`);
  ok('  บันทึกที่มาไว้ว่า "ตั้งเอง" ไม่ใช่ "อัตโนมัติ"',
    dt.type_source === 'override' && dt.days_source === 'override', `${dt.type_source}/${dt.days_source}`);
  ok('  เครดิตที่ตั้งทับอยู่รอดหลังยืนยัน (confirm ไม่เขียน customer_details ทับ)',
    after?.pt === '30 Days', String(after?.pt));
}

async function main() {
  console.log(`${BOLD}webQuoteSmoke — ด่านเฟส D${RESET} ${DIM}(${BASE})${RESET}`);

  if (!(await serverIsUp())) {
    console.error(`\n${RED}เซิร์ฟเวอร์ไม่ตอบที่ ${BASE}${RESET} — ข้อ 3 ต้องยิง HTTP จริง`);
    console.error(`${DIM}เปิด npm run dev ไว้อีกหน้าต่างก่อนแล้วรันใหม่${RESET}`);
    await pool.end();
    process.exit(1);
  }

  try {
    await setup();
    await case1();
    await case2();
    const quotationNo = await case3();
    await case4(quotationNo);
    await case5();
    await case6();
    await case7();
  } finally {
    await teardown();
  }

  console.log(`\n${BOLD}สรุป:${RESET} ${GREEN}ผ่าน ${pass}${RESET} · ${fail > 0 ? RED : DIM}ล้ม ${fail}${RESET}`);
  if (fail > 0) {
    console.log(`${DIM}หมายเหตุ: ข้อ 1–2 พึ่ง LLM ซึ่งไม่ deterministic 100% — ถ้าล้มให้รันซ้ำ 1 รอบก่อนสรุปว่าโค้ดพัง${RESET}`);
  }
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(`\n${RED}ด่านล้มเหลว:${RESET}`, e);
  try { await teardown(); } catch { /* teardown ล้มเองก็ยังต้องปิด pool */ }
  await pool.end();
  process.exit(1);
});
