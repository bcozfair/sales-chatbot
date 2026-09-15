// ─────────────────────────────────────────────────────────────────────────────
//  priceApprovalSmoke — ด่านของคิว "อนุมัติราคาต่ำกว่าขั้นต่ำ"
//  รัน:  npm run diag:price-approval          (ไม่ต้องเปิดเซิร์ฟเวอร์ — เรียก service ตรง)
//  แผน: docs/plan-quote-price-approval.md §7
//
//  1. **ใบจาก LINE ที่ติดราคาขั้นต่ำ ต้องยังออกไม่ได้เหมือนเดิม** ← ข้อที่ห้ามล้มเด็ดขาด
//     (ตัวพิสูจน์ว่าคิวใหม่ผูกกับ "ใบ" ไม่ใช่ "endpoint" — เส้น LINE ไม่ถูกแตะ)
//  2. เว็บกดออกใบโดยไม่ส่งธง request_approval ⇒ ปฏิเสธ NEEDS_APPROVAL (ไม่สร้างคำขอเงียบ ๆ)
//  3. ส่งขออนุมัติ ⇒ ร่างถูกสร้าง · price_approval = pending · **ยังไม่มีเลขที่ใบ**
//  4. confirm ใบที่ยัง pending ⇒ 422 (คำรับทราบของคนออกใบปลดไม่ได้)
//  5. คำขอโผล่ในคิวของผู้อนุมัติ · เปิดรายละเอียดแล้วเห็นผลตรวจกฎ "สด"
//  6. ไม่อนุมัติโดยไม่ใส่เหตุผล ⇒ 400 · ใส่แล้ว ⇒ rejected และใบยังเป็นร่าง · confirm ยัง 422
//  7. แก้แล้วส่งใหม่ (replacesRequestId) ⇒ คำขอเดิมถูกยกเลิก คำขอใหม่ pending
//  8. insertDraftQuotations รอบใหม่ของ user เดิม ⇒ **ใบที่รออนุมัติไม่ถูกลบ**
//  9. **ผู้อนุมัติแก้ตัวเลขในร่างเองได้** ⇒ ราคาในใบเปลี่ยนจริง · คำขออัปเดตตามราคาใหม่
// 10. **อนุมัติใบที่ตัวเองเป็นคนขอได้** (เจ้าของสั่งปลดด่านนี้) ⇒ ทุกใบในชุดได้เลขที่
// 11. ราคาที่ถูกแก้ให้ต่ำลงกว่าที่อนุมัติ ⇒ คำอนุมัติเดิมใช้ไม่ได้ (approvedViolationKeys)
//
//  ⚠️ เขียนข้อมูลจริงลง DB (salesperson · admin_users · quotations · messages ของชุดทดสอบ)
//     แล้วลบทิ้งใน finally ทุกกรณี · ข้อ 9 **กินเลขที่ใบจริง 1 เลข** จาก quotation_counters
//     เหมือนที่ diag:web-quote ทำอยู่แล้ว — เลขที่ถูกกินคืนไม่ได้ แต่ใบถูกลบ
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from '../../config/db.js';
import {
  validateQuotationItems,
  insertDraftQuotations,
  approvedViolationKeys,
  blockingViolations,
  buildViolationDisplay,
  type Violation,
} from '../../services/quotationService.js';
import { confirmQuotationById } from '../../services/quotationConfirm.js';
import { buildResolvedItem } from '../../services/quoteExtraction.js';
import { createDraft, previewDraft, resolveWebUserId, WebQuoteError } from '../../services/webQuoteService.js';
import {
  approveRequest, rejectRequest, listApprovalRequests, getApprovalRequest, updateRequestItems,
  PriceApprovalError, type ApprovalActor,
} from '../../services/priceApprovalService.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';

const TEST_SP_USER = 'U' + 'a71c' + '0'.repeat(28);
const TEST_ADMIN_USERNAME = 'diag_priceapprove_admin';
const TEST_APPROVER_USERNAME = 'diag_priceapprove_approver';

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ${GREEN}✓${RESET} ${label}${extra ? ` ${DIM}${extra}${RESET}` : ''}`); }
  else { fail++; console.log(`  ${RED}✗${RESET} ${label}${extra ? ` ${DIM}${extra}${RESET}` : ''}`); }
}

let adminId = 0;
let approverId = 0;
let webUserId = '';
let adminActor: ApprovalActor;
let approverActor: ApprovalActor;

async function setup() {
  await pool.query(
    `INSERT INTO salesperson (user_id, name, status, phone, salesperson_id, branch)
     VALUES ($1, 'DIAG อนุมัติราคา (ลบอัตโนมัติ)', 'active', '000-000-0000', 'DIAGA', 'สำนักงานใหญ่')
     ON CONFLICT (user_id) DO UPDATE SET status = 'active'`,
    [TEST_SP_USER]
  );
  const mk = async (username: string, role: string, name: string) => {
    const { rows } = await pool.query(
      `INSERT INTO admin_users (username, password_hash, name, role)
       VALUES ($1, 'x-diag-not-a-login', $3, $2)
       ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role
       RETURNING id`,
      [username, role, name]
    );
    return Number(rows[0].id);
  };
  adminId = await mk(TEST_ADMIN_USERNAME, 'admin', 'DIAG แอดมิน (ลบอัตโนมัติ)');
  // ถ้าบรรทัดนี้ล้มด้วย admin_users_role_check แปลว่า **ยังไม่ได้รัน migration ของฟีเจอร์นี้**
  approverId = await mk(TEST_APPROVER_USERNAME, 'approver', 'DIAG ผู้อนุมัติ (ลบอัตโนมัติ)');

  adminActor = { id: adminId, username: TEST_ADMIN_USERNAME, name: 'DIAG แอดมิน', role: 'admin' };
  approverActor = { id: approverId, username: TEST_APPROVER_USERNAME, name: 'DIAG ผู้อนุมัติ', role: 'approver' };
}

async function teardown() {
  const users = [TEST_SP_USER, webUserId].filter(Boolean);
  for (const u of users) {
    await pool.query('DELETE FROM quotations WHERE user_id = $1', [u]).catch(() => {});
    await pool.query('DELETE FROM messages WHERE user_id = $1', [u]).catch(() => {});
  }
  await pool.query('DELETE FROM salesperson WHERE user_id = ANY($1)', [users]).catch(() => {});
  await pool.query('DELETE FROM admin_users WHERE username = ANY($1)',
    [[TEST_ADMIN_USERNAME, TEST_APPROVER_USERNAME]]).catch(() => {});
}

/** ลูกค้าจริงที่ผ่านด่าน blacklist/เครดิต — กติกาเดียวกับ diag:web-quote */
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
  throw new Error('หาลูกค้าที่ผ่านด่าน blacklist/เครดิตไม่ได้เลยใน 15 แถวแรก');
}

/**
 * สินค้าที่ "ติดเฉพาะราคาขั้นต่ำข้อเดียว" เมื่อขายครึ่งราคาขั้นต่ำ
 *
 * ต้องไม่ติดสต็อก/MOQ/บล็อกไปด้วย ไม่งั้นด่านจะทดสอบสองเรื่องปนกันแล้วอ่านผลไม่ออกว่าอะไรกันแน่
 * ที่ทำให้ใบถูกบล็อก
 */
async function pickMinPriceProduct(cust: { customerId: number; contactId: number; name: string }) {
  const { rows } = await pool.query(`
    SELECT * FROM products
     WHERE minimum_sales_price > 1 AND sales_price > 0 AND quantity_on_hand_unreserved > 5
     ORDER BY quantity_on_hand_unreserved DESC
     LIMIT 12
  `);
  for (const p of rows) {
    const half = Math.max(1, Math.floor(Number(p.minimum_sales_price) / 2));
    const items = [{ product_template_id: p.product_template_id, quantity: 1, price: half }];
    const pv = await previewDraft({ customerId: cust.customerId, contactId: cust.contactId, items });
    const types = new Set(pv.violations.map((v) => v.type));
    if (types.size === 1 && types.has('MIN_PRICE_VIOLATION')) {
      return { product: p, price: half, items };
    }
  }
  throw new Error('หาสินค้าที่ติดเฉพาะกฎราคาขั้นต่ำไม่ได้เลยใน 12 แถวแรก');
}

// ── ด่าน ─────────────────────────────────────────────────────────────────────

/** ข้อ 1 — ใบจาก LINE ที่ติดราคาขั้นต่ำ ยังออกไม่ได้เหมือนเดิม (ข้อที่ห้ามล้ม) */
async function case1(cust: any, pick: any) {
  console.log(`\n${BOLD}1) ใบจาก LINE ติดราคาขั้นต่ำ → ยังออกไม่ได้เหมือนเดิม${RESET}`);
  // ประกอบรายการด้วยตัวเดียวกับเส้น LINE — ไม่ปั้น item เองเพื่อให้รูปร่างตรงกับของจริงทุกฟิลด์
  const { itemForDb } = buildResolvedItem(pick.product, { quantity: 1, price: pick.price }, {});
  const { items: expanded } = await validateQuotationItems(
    [itemForDb],
    { stage: 'draft', customerName: cust.name.split(' | ')[0], customerId: cust.customerId, contactId: cust.contactId }
  );
  const quotes = await insertDraftQuotations(
    TEST_SP_USER, cust.name, expanded, 'draft', cust.customerId, cust.contactId
  );
  ok('สร้างร่างของ LINE ได้', (quotes?.length ?? 0) > 0);
  if (!quotes?.length) return;

  const row = (await pool.query('SELECT price_approval, rule_overrides FROM quotations WHERE id = $1', [quotes[0].id])).rows[0];
  ok('ใบจาก LINE มี price_approval = NULL (ไม่มีคำขอ)', row.price_approval === null);
  ok('ใบจาก LINE มี rule_overrides = NULL (ไม่มีคำรับทราบ)', row.rule_overrides === null);

  const res = await confirmQuotationById({ quoteId: String(quotes[0].id), userId: TEST_SP_USER });
  ok('confirm ใบจาก LINE ⇒ 422 ตามเดิม', res.ok === false && res.status === 422,
    res.ok ? 'ออกใบได้ ‼️' : `status=${res.status}`);
  await pool.query('DELETE FROM quotations WHERE user_id = $1', [TEST_SP_USER]);
}

/** ข้อ 2–4 — เส้นเว็บ: ไม่ส่งธง ⇒ ปฏิเสธ · ส่งธง ⇒ ได้คำขอ · confirm ตรง ๆ ⇒ 422 */
async function case2to4(cust: any, pick: any): Promise<string> {
  console.log(`\n${BOLD}2) เว็บกดออกใบโดยไม่ส่งธงขออนุมัติ → NEEDS_APPROVAL${RESET}`);
  const pv = await previewDraft({ customerId: cust.customerId, contactId: cust.contactId, items: pick.items });
  ok('พรีวิวบอกว่าต้องขออนุมัติ', pv.needs_approval === true && pv.approval_required.length > 0,
    `${pv.approval_required.length} รายการ`);
  ok('override_keys ไม่มีคีย์ของราคาขั้นต่ำ (ติ๊กเองไม่ได้)',
    pv.override_keys.every((k) => !k.startsWith('MIN_PRICE_VIOLATION')), pv.override_keys.join(' · ') || '(ว่าง)');

  let refused = false;
  try {
    await createDraft({
      adminId, spUserId: TEST_SP_USER, customerId: cust.customerId, contactId: cust.contactId,
      items: pick.items, acknowledgedViolations: [`MIN_PRICE_VIOLATION|${pick.product.model}`],
    });
  } catch (e) {
    refused = e instanceof WebQuoteError && e.code === 'NEEDS_APPROVAL' && e.status === 422;
  }
  ok('ส่งคำรับทราบของราคาขั้นต่ำมาเอง ⇒ ยังปฏิเสธ (ติ๊กเองไม่ได้)', refused);
  const stillEmpty = Number((await pool.query(
    "SELECT COUNT(*)::int AS n FROM quotations WHERE user_id = $1", [webUserId]
  )).rows[0].n);
  ok('ถูกปฏิเสธแล้วต้องไม่มีร่างค้างในฐาน', stillEmpty === 0, `เจอ ${stillEmpty} ใบ`);

  console.log(`\n${BOLD}3) ส่งขออนุมัติ → ร่าง pending ที่ยังไม่มีเลขที่ใบ${RESET}`);
  const draft = await createDraft({
    adminId, spUserId: TEST_SP_USER, customerId: cust.customerId, contactId: cust.contactId,
    items: pick.items, requestApproval: true, approvalNote: 'ลูกค้าเทียบราคาเจ้าอื่น (diag)',
    adminUsername: TEST_ADMIN_USERNAME, adminName: 'DIAG แอดมิน',
  });
  ok('createDraft คืนก้อน approval', !!draft.approval, draft.approval?.request_id ?? '(ไม่มี)');
  ok('  สถานะ pending', draft.approval?.status === 'pending');
  ok('  เก็บราคาที่ขอไว้ในคำขอ (ไม่ใช่แค่ชื่อรุ่น)',
    (draft.approval?.items ?? []).every((it) => it.price > 0 && it.min_price > 0));

  const rows = (await pool.query(
    'SELECT id, status, quotation_no, price_approval FROM quotations WHERE user_id = $1', [webUserId]
  )).rows;
  ok('ทุกใบในชุดถูกบันทึกเป็นร่าง', rows.length > 0 && rows.every((r: any) => r.status === 'draft'), `${rows.length} ใบ`);
  ok('ทุกใบยังไม่มีเลขที่ใบ', rows.every((r: any) => !r.quotation_no));
  ok('ทุกใบในชุดใช้ request_id เดียวกัน',
    new Set(rows.map((r: any) => r.price_approval?.request_id)).size === 1);

  console.log(`\n${BOLD}4) confirm ใบที่ยัง pending → 422${RESET}`);
  const res = await confirmQuotationById({ quoteId: String(rows[0].id), userId: webUserId });
  ok('ปฏิเสธเพราะยังไม่มีใครอนุมัติ', res.ok === false && res.status === 422,
    res.ok ? 'ออกใบได้ ‼️' : `status=${res.status}`);

  return String(draft.approval?.request_id);
}

/** ข้อ 5–6 — สิทธิ์การตัดสิน และการไม่อนุมัติ */
async function case5to6(requestId: string) {
  console.log(`\n${BOLD}5) คำขอเข้าคิวของผู้อนุมัติ + เห็นผลตรวจกฎสด${RESET}`);
  const visible = await listApprovalRequests({ actor: approverActor, status: 'pending' });
  ok('คำขอโผล่ในคิวของผู้อนุมัติ', visible.some((r) => r.request_id === requestId), `${visible.length} คำขอ`);

  const mineOnly = await listApprovalRequests({
    actor: { id: approverId + 90000, username: 'diag_ไม่มีจริง', role: 'subadmin' }, status: 'pending',
  });
  ok('คนที่ไม่ใช่ผู้อนุมัติเห็นเฉพาะคำขอของตัวเอง (ของคนอื่นไม่โผล่)',
    !mineOnly.some((r) => r.request_id === requestId), `${mineOnly.length} คำขอ`);

  const detail = await getApprovalRequest({ requestId, actor: approverActor });
  ok('เปิดรายละเอียดแล้วเห็นผลตรวจกฎสด',
    detail.current_violations.some((v) => v.type === 'MIN_PRICE_VIOLATION'));
  ok('เห็นทุกบรรทัดของทุกใบในชุด (ไม่ใช่เฉพาะบรรทัดที่ผิดกฎ)',
    detail.quotes.length > 0 && detail.quotes.every((q) => (q.items?.length ?? 0) > 0));

  console.log(`\n${BOLD}6) ไม่อนุมัติ → ใบยังเป็นร่าง + มีเหตุผล + confirm ยังไม่ได้${RESET}`);
  let needReason = false;
  try {
    await rejectRequest({ requestId, actor: approverActor, reason: '   ' });
  } catch (e) {
    needReason = e instanceof PriceApprovalError && e.code === 'REASON_REQUIRED';
  }
  ok('ไม่ใส่เหตุผล ⇒ ปฏิเสธ', needReason);

  await rejectRequest({ requestId, actor: approverActor, reason: 'ลดได้ไม่เกิน 5% (diag)' });
  const rows = (await pool.query(
    "SELECT id, status, price_approval FROM quotations WHERE price_approval->>'request_id' = $1", [requestId]
  )).rows;
  ok('ทุกใบในชุดเป็น rejected', rows.every((r: any) => r.price_approval?.status === 'rejected'));
  ok('ใบยังเป็นร่าง ไม่ถูกลบ', rows.every((r: any) => r.status === 'draft'));
  ok('เก็บเหตุผลไว้กับใบ', rows.every((r: any) => String(r.price_approval?.decision_note || '').includes('5%')));

  const res = await confirmQuotationById({ quoteId: String(rows[0].id), userId: webUserId });
  ok('confirm ใบที่ถูกตีกลับ ⇒ ยัง 422', res.ok === false && res.status === 422);
}

/** ข้อ 7–8 — แก้แล้วส่งใหม่ · ร่างที่รออนุมัติต้องไม่ถูกลบโดยรอบถัดไป */
async function case7to8(cust: any, pick: any, oldRequestId: string): Promise<string> {
  console.log(`\n${BOLD}7) แก้แล้วส่งใหม่ → คำขอเดิมถูกยกเลิก คำขอใหม่ pending${RESET}`);
  const again = await createDraft({
    adminId, spUserId: TEST_SP_USER, customerId: cust.customerId, contactId: cust.contactId,
    items: pick.items, requestApproval: true, approvalNote: 'แก้แล้วส่งใหม่ (diag)',
    adminUsername: TEST_ADMIN_USERNAME, replacesRequestId: oldRequestId,
  });
  const newId = String(again.approval?.request_id);
  ok('ได้คำขอใหม่', !!newId && newId !== oldRequestId);

  const oldRows = (await pool.query(
    "SELECT status FROM quotations WHERE price_approval->>'request_id' = $1", [oldRequestId]
  )).rows;
  ok('ใบของคำขอเดิมถูกยกเลิกทุกใบ', oldRows.length > 0 && oldRows.every((r: any) => r.status === 'cancelled'));

  console.log(`\n${BOLD}8) สร้างร่างรอบใหม่ของ user เดิม → ใบที่รออนุมัติต้องไม่ถูกลบ${RESET}`);
  const { itemForDb: plainItem } = buildResolvedItem(pick.product, { quantity: 1 }, {});
  const { items: plain } = await validateQuotationItems(
    [plainItem],
    { stage: 'draft', customerName: cust.name.split(' | ')[0], customerId: cust.customerId, contactId: cust.contactId }
  );
  await insertDraftQuotations(webUserId, cust.name, plain, 'draft', cust.customerId, cust.contactId);
  const survived = Number((await pool.query(
    "SELECT COUNT(*)::int AS n FROM quotations WHERE price_approval->>'request_id' = $1 AND status = 'draft'",
    [newId]
  )).rows[0].n);
  ok('ใบที่รออนุมัติยังอยู่ครบ', survived > 0, `เหลือ ${survived} ใบ`);

  // ร่างธรรมดาที่เพิ่งสร้างไม่ใช่ของที่ด่านนี้ต้องใช้ต่อ — เก็บกวาดก่อนไปข้อ 9
  await pool.query(
    'DELETE FROM quotations WHERE user_id = $1 AND price_approval IS NULL', [webUserId]
  );
  return newId;
}

/** ข้อ 9 — ผู้อนุมัติแก้ตัวเลขในร่างเองได้ (ไม่ต้องตีกลับ) */
async function case9(requestId: string, pick: any): Promise<number> {
  console.log(`\n${BOLD}9) ผู้อนุมัติแก้ตัวเลขในร่างเอง → ราคาในใบเปลี่ยนจริง${RESET}`);
  const before = await getApprovalRequest({ requestId, actor: approverActor });
  const quote = before.quotes[0];
  const index = quote.items.findIndex((it: any) => String(it.model) === String(pick.product.model));
  ok('หาบรรทัดที่จะแก้เจอ', index >= 0, `index=${index}`);
  if (index < 0) return 0;

  // ขยับราคาขึ้นมา "ต่ำกว่าขั้นต่ำ 1 บาท" — ยังต้องอนุมัติอยู่ แต่พิสูจน์ว่าค่าที่แก้ถึง DB จริง
  const newPrice = Math.max(1, Number(pick.product.minimum_sales_price) - 1);
  const result = await updateRequestItems({
    requestId,
    actor: approverActor,
    quotes: [{
      quote_id: quote.id,
      items: [{ index, model: String(quote.items[index].model), quantity: 1, price: newPrice, discount_1: 0, discount_2: 0 }],
    }],
  });
  ok('บันทึกแล้วยังติดราคาขั้นต่ำอยู่ (ยังต้องอนุมัติ)',
    result.violations.some((v) => v.type === 'MIN_PRICE_VIOLATION'));
  ok('คำขอถูกอัปเดตเป็นราคาใหม่',
    result.items.some((it) => Math.abs(it.price - newPrice) < 0.005),
    `ราคาในคำขอ = ${result.items.map((it) => it.price).join(', ')}`);

  const row = (await pool.query('SELECT item_details, price_approval FROM quotations WHERE id = $1', [quote.id])).rows[0];
  const saved = (row.item_details as any[]).find((it: any) => String(it.model) === String(pick.product.model));
  ok('ราคาในใบ (item_details) เปลี่ยนตามจริง', Math.abs(Number(saved?.price) - newPrice) < 0.005,
    `ในใบ = ${saved?.price}`);
  ok('คำขอยังเป็น pending (แก้ไม่ใช่การตัดสิน)', row.price_approval?.status === 'pending');
  ok('บันทึกว่าใครแก้', row.price_approval?.edited_by === TEST_APPROVER_USERNAME, row.price_approval?.edited_by);

  let refusedAfterDecision = false;
  try {
    await updateRequestItems({ requestId: 'ไม่มีจริง-00000', actor: approverActor, quotes: [] });
  } catch (e) {
    refusedAfterDecision = e instanceof PriceApprovalError && e.status === 404;
  }
  ok('แก้คำขอที่ไม่มีอยู่ ⇒ 404', refusedAfterDecision);

  return newPrice;
}

/** ข้อ 10 — อนุมัติใบที่ตัวเองเป็นคนขอได้ (เจ้าของสั่งปลดด่านนี้ 2026-09-15) */
async function case10(requestId: string) {
  console.log(`\n${BOLD}10) อนุมัติใบที่ตัวเองเป็นคนขอ → ออกใบทันที${RESET}`);
  // ผู้ขอคือ adminId — ให้เขาสวมบทผู้อนุมัติแล้วกดเอง ซึ่งเจ้าของสั่งว่าต้องทำได้
  const selfApprover: ApprovalActor = {
    id: adminId, username: TEST_ADMIN_USERNAME, name: 'DIAG แอดมิน', role: 'approver',
  };
  const result = await approveRequest({ requestId, actor: selfApprover, note: 'อนุมัติเอง (diag)' });
  ok('ได้เลขที่ใบกลับมา', result.issued.length > 0,
    result.issued.map((i) => i.quotation_no).join(', ') || `failed=${result.failed.length}`);
  ok('ไม่มีใบที่ออกไม่สำเร็จ', result.failed.length === 0,
    result.failed.map((f) => f.error).join(' · '));

  const rows = (await pool.query(
    "SELECT status, quotation_no, price_approval FROM quotations WHERE price_approval->>'request_id' = $1",
    [requestId]
  )).rows;
  ok('ทุกใบในชุดเป็น confirmed และมีเลขที่', rows.every((r: any) => r.status === 'confirmed' && !!r.quotation_no));
  ok('price_approval = approved พร้อมชื่อคนอนุมัติ',
    rows.every((r: any) => r.price_approval?.status === 'approved' && r.price_approval?.decided_by === TEST_ADMIN_USERNAME));
  ok('เก็บทั้งชื่อผู้ขอและผู้อนุมัติไว้ แม้เป็นคนเดียวกัน',
    rows.every((r: any) => !!r.price_approval?.requested_by && !!r.price_approval?.decided_by));
}

/** ข้อ 11 — คำอนุมัติผูกกับ "ราคาที่อนุมัติ" ไม่ใช่แค่ชื่อรุ่น */
function case11() {
  console.log(`\n${BOLD}11) แก้ราคาให้ต่ำลงกว่าที่อนุมัติ → คำอนุมัติเดิมใช้ไม่ได้${RESET}`);
  const mk = (price: number): Violation => {
    const v = { type: 'MIN_PRICE_VIOLATION' as const, model: 'DIAG-X', price, min_price: 200 };
    return { ...v, display_message: buildViolationDisplay(v) };
  };
  const approval = { status: 'approved', items: [{ model: 'DIAG-X', price: 100, min_price: 200 }] };

  ok('ราคาเท่าที่อนุมัติ ⇒ ผ่าน',
    blockingViolations([mk(100)], null, approvedViolationKeys(approval, [mk(100)])).length === 0);
  ok('ราคาสูงขึ้นกว่าที่อนุมัติ ⇒ ผ่าน (ขายแพงขึ้นไม่ต้องขอใหม่)',
    blockingViolations([mk(150)], null, approvedViolationKeys(approval, [mk(150)])).length === 0);
  ok('ราคาต่ำลงกว่าที่อนุมัติ ⇒ บล็อก',
    blockingViolations([mk(50)], null, approvedViolationKeys(approval, [mk(50)])).length === 1);
  ok('คำขอที่ยัง pending ⇒ บล็อก',
    blockingViolations([mk(100)], null, approvedViolationKeys({ ...approval, status: 'pending' }, [mk(100)])).length === 1);
  ok('ไม่มีคำขอเลย (ใบจาก LINE) ⇒ บล็อก',
    blockingViolations([mk(100)], ['MIN_PRICE_VIOLATION|DIAG-X'], approvedViolationKeys(null, [mk(100)])).length === 1);
}

async function main() {
  console.log(`${BOLD}diag:price-approval — คิวอนุมัติราคาต่ำกว่าขั้นต่ำ${RESET}`);
  try {
    await setup();
    webUserId = await resolveWebUserId(adminId, TEST_SP_USER);
    const cust = await pickCustomerContact();
    const pick = await pickMinPriceProduct(cust);
    console.log(`${DIM}ลูกค้า: ${cust.name} · สินค้า: ${pick.product.model} ขาย ฿${pick.price} (ขั้นต่ำ ฿${pick.product.minimum_sales_price})${RESET}`);

    await case1(cust, pick);
    const requestId = await case2to4(cust, pick);
    await case5to6(requestId);
    const newRequestId = await case7to8(cust, pick, requestId);
    await case9(newRequestId, pick);
    await case10(newRequestId);
    case11();
  } catch (err) {
    fail++;
    console.error(`\n${RED}ด่านล้มกลางคัน:${RESET}`, err);
  } finally {
    await teardown();
    await pool.end();
  }

  console.log(`\n${BOLD}สรุป:${RESET} ${GREEN}ผ่าน ${pass}${RESET} · ${fail > 0 ? RED : DIM}ล้ม ${fail}${RESET}`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
