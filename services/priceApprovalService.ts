/**
 * services/priceApprovalService.ts — คิว "อนุมัติราคาต่ำกว่าขั้นต่ำ" ของหน้าเว็บขอใบเสนอราคา
 *
 * แผนเต็ม: docs/plan-quote-price-approval.md · โจทย์จากหัวหน้า 2026-09-15:
 * ใบที่ออกจากหน้าเว็บแล้วขายต่ำกว่าราคาขั้นต่ำ **คนออกใบติ๊กรับทราบเองไม่ได้** ต้องมีคนอนุมัติ
 * ให้ก่อนถึงจะกลายเป็นใบเสนอราคาจริงได้ · ไม่อนุมัติ = ย้อนกลับไปให้คนขอแก้หรือยกเลิก
 *
 * ## สิ่งที่ไฟล์นี้ **ไม่** ทำ — และทำไม
 *
 * * **ไม่ตรวจกฎเอง** — เรียก `validateQuotationItems()` ตัวเดียวกับทุกเส้น ผลที่ผู้อนุมัติเห็น
 *   จึงมาจากด่านเดียวกับที่บล็อกใบตอนออกจริง (ห้ามก๊อปกฎมาไว้ที่นี่ — `AGENTS.md` B4)
 * * **ไม่ออกใบเอง** — เรียก `confirmQuotationById()` ของ `services/quotationConfirm.ts`
 *   ซึ่งเป็นตัวเดียวกับที่ปุ่มยืนยันปกติเรียก ⇒ ใบที่ออกจากคิวนี้กับใบที่ออกจากปุ่มปกติ
 *   เดินลำดับเดียวกันทุกไบต์
 * * **ไม่แจ้งเตือนผ่าน LINE** — ห้าม push (กฎเหล็ก) · คิวเป็นตัวเลขบนเมนูของแอดมินแทน
 *
 * ## กติกาสิทธิ์ (เจ้าของเลือก 2026-09-15)
 *
 * * `approver` ทำงานของ `subadmin` ได้ด้วย **และอนุมัติใบที่ตัวเองเป็นคนขอได้** — เจ้าของสั่ง
 *   ชัดเมื่อ 2026-09-15 หลังลองใช้: ทีมมีผู้อนุมัติไม่กี่คนและเป็นคนออกใบเองด้วย การบังคับให้
 *   ต้องมีคนที่สองมากดทำให้ใบค้างโดยไม่ได้อะไรกลับมา (รอบแรกเคยกันไว้ แล้วถูกสั่งให้ปลด)
 *   ⇒ **สิ่งที่กันคนละเรื่องกับ "ใครกด" คือ "มีร่องรอยว่าใครกด"** — ทุกคำขอเก็บชื่อผู้ขอและ
 *   ผู้อนุมัติพร้อมเวลาไว้ในใบเสมอ แม้จะเป็นคนเดียวกัน
 * * **ผู้อนุมัติแก้ตัวเลขในร่างได้เองก่อนอนุมัติ** (`updateRequestItems`) — เคสจริงคือ
 *   "ลดได้แค่นี้" ซึ่งถ้าต้องตีกลับไปให้ผู้ขอพิมพ์ใหม่แล้วส่งกลับมา คือการเดินสองรอบเพื่อแก้
 *   ตัวเลขตัวเดียว · ขอบเขตคือ **จำนวน/ราคา/ส่วนลดของบรรทัดที่มีอยู่** เท่านั้น
 *   การเพิ่ม-ลบสินค้าหรือเปลี่ยนลูกค้ายังต้องกลับไปที่ฟอร์มของผู้ขอ (ดู `loadRequestIntoForm`)
 */

import { randomUUID } from 'crypto';
import { pool } from '../config/db.js';
import {
  listPriceApprovalQuotations,
  getQuotationsByApprovalRequest,
  decidePriceApprovalRequest,
  countPriceApprovalRequests,
  getAcknowledgedViolationKeys,
  insertMessage,
} from '../db/repositories.js';
import {
  enrichQuotationData,
  validateQuotationItems,
  buildItemSnapshots,
  blockingViolations,
  requiresPriceApproval,
  buildViolationText,
  type Violation,
} from './quotationService.js';
import { sumLineTotals } from '../utils/pricing.js';
import { confirmQuotationById } from './quotationConfirm.js';
import { parseWebUserId } from './webIdentity.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** ตัวตนของคนที่กดปุ่ม — มาจาก `req.admin` ที่ `adminAuthMiddleware` เซ็ตไว้ */
export interface ApprovalActor {
  id: number;
  username: string;
  name?: string | null;
  role: string;
}

export class PriceApprovalError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = 'PriceApprovalError';
  }
}

/** ใครกดอนุมัติ/ไม่อนุมัติได้บ้าง — รวมไว้ที่เดียวเพื่อให้ route กับ service ตอบเหมือนกัน */
export const canDecideApproval = (actor: ApprovalActor): boolean =>
  actor.role === 'admin' || actor.role === 'approver';

/**
 * รายการที่ถูกส่งไปขออนุมัติ — เก็บ **ราคาที่ขอ** ไว้ด้วย ไม่ใช่แค่ชื่อรุ่น
 * (เหตุผลอยู่ที่ `approvedViolationKeys()` ใน quotationService.ts)
 */
export interface ApprovalItem {
  model: string;
  name: string;
  quantity: number;
  price: number;
  min_price: number;
}

export function buildApprovalItems(violations: Violation[], items: any[]): ApprovalItem[] {
  const out: ApprovalItem[] = [];
  for (const v of violations || []) {
    if (!requiresPriceApproval(v)) continue;
    const line = (items || []).find((it: any) => String(it?.model ?? it?.internal_reference ?? '') === v.model);
    out.push({
      model: v.model,
      name: String(line?.name ?? ''),
      quantity: Number(line?.quantity ?? line?.qty ?? 0),
      price: Number(v.price ?? line?.price ?? 0),
      min_price: Number(v.min_price ?? 0),
    });
  }
  return out;
}

/** ก้อน jsonb ที่จะถูกเขียนลง `quotations.price_approval` ตอนสร้างร่าง */
export function buildApprovalPayload(params: {
  requestId: string;
  actor: { id: number; username?: string | null; name?: string | null };
  violations: Violation[];
  items: ApprovalItem[];
  note?: string | null;
}) {
  return {
    request_id: params.requestId,
    status: 'pending' as ApprovalStatus,
    requested_by_id: params.actor.id,
    requested_by: params.actor.username ?? String(params.actor.id),
    requested_by_name: params.actor.name ?? null,
    requested_at: new Date().toISOString(),
    note: params.note ?? null,
    items: params.items,
    // เก็บสิ่งที่ server คำนวณเอง ไม่ใช่ที่หน้าจอส่งมา — เหตุผลเดียวกับ rule_overrides
    violations: params.violations,
  };
}

export const newApprovalRequestId = (): string => randomUUID();

// ── อ่าน ─────────────────────────────────────────────────────────────────────

export interface ApprovalRequestSummary {
  request_id: string;
  status: ApprovalStatus;
  requested_by_id: number | null;
  requested_by: string | null;
  requested_by_name: string | null;
  requested_at: string | null;
  note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  customer_name: string | null;
  contact_name: string | null;
  salesperson_name: string | null;
  total_sum: number;
  quote_ids: string[];
  /** เลขที่ใบของชุดนี้ — มีค่าเฉพาะคำขอที่อนุมัติแล้ว (ก่อนหน้านั้นใบยังไม่มีเลข) */
  quotation_nos: string[];
  items: ApprovalItem[];
  /** จำนวนบรรทัดทั้งหมดของทุกใบในชุด — ให้หน้าจอบอกได้ว่า "ต่ำกว่าขั้นต่ำ 2 จาก 7 รายการ" */
  line_count: number;
}

/** ยุบแถว (= ใบ) เป็นชุดคำขอ — ใบ PM/THT ของการกดครั้งเดียวกันต้องขึ้นเป็นรายการเดียว */
function groupRows(rows: any[]): ApprovalRequestSummary[] {
  const byRequest = new Map<string, ApprovalRequestSummary>();
  for (const r of rows) {
    const pa = r.price_approval || {};
    const requestId = String(pa.request_id ?? r.id);
    const lines = Array.isArray(r.item_details) ? r.item_details.length : 0;
    const existing = byRequest.get(requestId);
    if (existing) {
      existing.quote_ids.push(String(r.id));
      if (r.quotation_no) existing.quotation_nos.push(String(r.quotation_no));
      existing.total_sum += Number(r.total_sum ?? 0);
      existing.line_count += lines;
      for (const it of (Array.isArray(pa.items) ? pa.items : [])) existing.items.push(it);
      continue;
    }
    byRequest.set(requestId, {
      request_id: requestId,
      status: (pa.status ?? 'pending') as ApprovalStatus,
      requested_by_id: pa.requested_by_id ?? null,
      requested_by: pa.requested_by ?? null,
      requested_by_name: pa.requested_by_name ?? null,
      requested_at: pa.requested_at ?? (r.created_at ? new Date(r.created_at).toISOString() : null),
      note: pa.note ?? null,
      decided_by: pa.decided_by ?? null,
      decided_at: pa.decided_at ?? null,
      decision_note: pa.decision_note ?? null,
      customer_name: r.customer_name ?? null,
      contact_name: r.contact_name ?? null,
      salesperson_name: r.salesperson_name ?? null,
      total_sum: Number(r.total_sum ?? 0),
      quote_ids: [String(r.id)],
      quotation_nos: r.quotation_no ? [String(r.quotation_no)] : [],
      items: Array.isArray(pa.items) ? [...pa.items] : [],
      line_count: lines,
    });
  }
  return [...byRequest.values()];
}

/**
 * คิวของคนที่เปิดหน้า
 *
 * * ผู้อนุมัติ (`admin` / `approver`) → เห็นทุกคำขอ
 * * คนอื่น (`subadmin`) → เห็นเฉพาะคำขอของตัวเอง — ไม่ใช่เรื่องความลับ แต่คิวของคนอื่น
 *   ไม่ใช่ของที่เขาทำอะไรได้ การเอามาแสดงมีแต่ทำให้ตัวเลขบนเมนูหมายถึงคนละเรื่องกับที่เขาคิด
 */
export async function listApprovalRequests(params: {
  actor: ApprovalActor;
  status?: string;
}): Promise<ApprovalRequestSummary[]> {
  const status = params.status === 'rejected' || params.status === 'approved' || params.status === 'pending'
    ? params.status
    : undefined;
  const rows = await listPriceApprovalQuotations(pool, {
    status,
    requestedById: canDecideApproval(params.actor) ? null : params.actor.id,
  });
  return groupRows(rows);
}

export async function countOpenRequests(actor: ApprovalActor): Promise<{ pending: number; rejected: number }> {
  const mine = canDecideApproval(actor) ? null : actor.id;
  return {
    // ผู้อนุมัติสนใจ "รออยู่กี่ชุด" · คนขอสนใจ "ของฉันถูกตีกลับกี่ชุด" — ส่งไปทั้งคู่ ให้หน้าจอเลือกใช้
    pending: await countPriceApprovalRequests(pool, { status: 'pending', requestedById: mine }),
    rejected: await countPriceApprovalRequests(pool, { status: 'rejected', requestedById: mine }),
  };
}

export interface ApprovalRequestDetail extends ApprovalRequestSummary {
  quotes: {
    id: string;
    company: 'PM' | 'THT';
    total_sum: number;
    items: any[];
    customer_name: string | null;
    payment_terms: string | null;
  }[];
  /** ผลตรวจกฎ ณ ตอนเปิดดู — ผู้อนุมัติต้องเห็นของสด ไม่ใช่ของที่แช่ไว้ตอนกดขอ */
  current_violations: Violation[];
}

async function loadRequestRows(requestId: string, actor: ApprovalActor): Promise<any[]> {
  const rows = await getQuotationsByApprovalRequest(pool, String(requestId));
  if (rows.length === 0) throw new PriceApprovalError('NOT_FOUND', 'ไม่พบคำขออนุมัติราคานี้', 404);
  const requestedById = Number(rows[0]?.price_approval?.requested_by_id ?? 0);
  if (!canDecideApproval(actor) && requestedById !== actor.id) {
    throw new PriceApprovalError('FORBIDDEN', 'ไม่มีสิทธิ์เข้าถึงคำขอนี้', 403);
  }
  return rows;
}

export async function getApprovalRequest(params: {
  requestId: string;
  actor: ApprovalActor;
}): Promise<ApprovalRequestDetail> {
  const rows = await loadRequestRows(params.requestId, params.actor);
  const summary = groupRows(rows.map((r) => ({
    ...r,
    customer_name: r.customer_details?.customer_name ?? null,
    contact_name: r.customer_details?.contact_name ?? null,
    salesperson_name: r.employee_details?.saleperson ?? null,
  })))[0];

  const quotes: ApprovalRequestDetail['quotes'] = [];
  const violations: Violation[] = [];
  for (const row of rows) {
    const enriched = await enrichQuotationData(row);
    quotes.push({
      id: String(row.id),
      // อักษรนำของเลขที่ใบเป็นตัวแบ่งบริษัทของไฟล์ export อยู่แล้ว — ร่างยังไม่มีเลข
      // จึงดูจาก snapshot ของบรรทัดแรกแทน (ค่าเดียวกับที่ resolveQuoteCompany ตัดสินตอนแตกใบ)
      company: String(enriched.items?.[0]?.production ?? '').toUpperCase() === 'THT' ? 'THT' : 'PM',
      total_sum: Number(row.total_sum ?? 0),
      items: enriched.items ?? [],
      customer_name: enriched.customer_name ?? null,
      payment_terms: enriched.customer_details?.payment_terms ?? null,
    });
    const { violations: v } = await validateQuotationItems(enriched.items ?? [], {
      stage: 'save',
      customerName: enriched.customer_name,
      customerId: row.customer_id,
      contactId: row.contact_id,
    });
    violations.push(...v);
  }

  return { ...summary, quotes, current_violations: violations };
}

// ── ผู้อนุมัติแก้ตัวเลขเองก่อนอนุมัติ ────────────────────────────────────────
//
//  เจ้าของสั่งเพิ่ม 2026-09-15: "ให้ผู้อนุมัติแก้ไขร่างนั้นได้เอง เพื่อไม่ต้องตีกลับ"
//  เคสจริงคือ *ลดได้แค่นี้* — ตีกลับไปให้ผู้ขอพิมพ์เลขใหม่แล้วส่งกลับมา คือการเดินสองรอบ
//  เพื่อแก้ตัวเลขตัวเดียว
//
//  **ขอบเขต: จำนวน · ราคา · ส่วนลด ของบรรทัดที่มีอยู่แล้วเท่านั้น**
//  เพิ่ม/ลบสินค้า หรือเปลี่ยนลูกค้า/เครดิต ⇒ ยังต้องกลับไปที่ฟอร์มของผู้ขอ (loadRequestIntoForm)
//  เพราะสองอย่างนั้นแตะ `customer_details` กับการแตกใบ PM/THT ซึ่งเป็นงานของ
//  `insertDraftQuotations` ทั้งก้อน ไม่ใช่การแก้ตัวเลขในใบที่แตกไปแล้ว
//
//  ด่านตรวจกฎยังทำงานเต็มรูปแบบและเป็น fail-closed เหมือนทุกเส้น — แก้แล้วไปชนกฎข้ออื่น
//  (ของหมด · MOQ · สินค้าระงับ) จะถูกปฏิเสธ ไม่ใช่บันทึกทับแล้วไปเจอตอนกดอนุมัติ
//  ส่วนราคาที่ยังต่ำกว่าขั้นต่ำอยู่ **ไม่ใช่เหตุให้บันทึกไม่ได้** — มันคือเรื่องที่กำลังจะอนุมัติอยู่

export interface ApprovalLineEdit {
  /** ตำแหน่งบรรทัดใน item_details ของใบนั้น — ส่งคู่กับ model เพื่อกันข้อมูลเลื่อนใต้มือ */
  index: number;
  model: string;
  quantity?: number;
  price?: number;
  discount_1?: number;
  discount_2?: number;
}

export interface ApprovalQuoteEdit {
  quote_id: string;
  items: ApprovalLineEdit[];
}

/** ตัวเลขที่รับมาจากหน้าจอ — ค่าที่ไม่ใช่ตัวเลขหรือติดลบถือว่าไม่ได้แก้ ไม่ใช่ error เงียบ ๆ */
const editedNumber = (raw: unknown, current: number, max = Number.MAX_SAFE_INTEGER): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > max) return current;
  return n;
};

export async function updateRequestItems(params: {
  requestId: string;
  actor: ApprovalActor;
  quotes: ApprovalQuoteEdit[];
}): Promise<{ request_id: string; violations: Violation[]; items: ApprovalItem[]; total_sum: number }> {
  if (!canDecideApproval(params.actor)) {
    throw new PriceApprovalError('FORBIDDEN', 'ไม่มีสิทธิ์แก้ไขร่างที่รออนุมัติ', 403);
  }
  const rows = await loadRequestRows(params.requestId, params.actor);
  const pa = rows[0]?.price_approval || {};
  if (pa.status !== 'pending') {
    throw new PriceApprovalError('ALREADY_DECIDED', `คำขอนี้ถูกตัดสินไปแล้ว (${pa.status}) แก้ไขไม่ได้`, 409);
  }

  const editByQuote = new Map<string, ApprovalLineEdit[]>();
  for (const q of (params.quotes || [])) {
    editByQuote.set(String(q.quote_id), Array.isArray(q.items) ? q.items : []);
  }

  const allViolations: Violation[] = [];
  const approvalItems: ApprovalItem[] = [];
  let grandTotal = 0;

  for (const row of rows) {
    if (row.status !== 'draft') continue;
    const enriched = await enrichQuotationData(row);
    const items: any[] = Array.isArray(enriched.items) ? enriched.items : [];
    const edits = editByQuote.get(String(row.id)) ?? [];

    for (const e of edits) {
      const line = items[Number(e.index)];
      // บรรทัดเลื่อนไปแล้ว = หน้าจอถือของเก่า — ปฏิเสธทั้งชุด ดีกว่าบันทึกราคาลงผิดบรรทัด
      if (!line || String(line.model ?? '') !== String(e.model ?? '')) {
        throw new PriceApprovalError('STALE_ITEMS', 'รายการในใบเปลี่ยนไปแล้ว กรุณารีเฟรชหน้าจอแล้วแก้ใหม่', 409);
      }
      // บรรทัดที่กฎเป็นคนเติม (สินค้าพ่วง · ค่าบริการอัตโนมัติ) ไม่ใช่ของที่คนแก้เอง —
      // มันถูกคำนวณใหม่ทุกครั้งที่บันทึก การยอมให้แก้คือการให้คนแก้สิ่งที่จะถูกเขียนทับอยู่ดี
      if (line.is_optional || (line.is_shipping_fee && line.is_manual_service !== true)) continue;

      line.quantity = Math.max(1, Math.round(editedNumber(e.quantity, Number(line.quantity) || 1, 1_000_000)));
      line.price = editedNumber(e.price, Number(line.price) || 0);
      line.discount_1 = editedNumber(e.discount_1, Number(line.discount_1) || 0, 100);
      line.discount_2 = editedNumber(e.discount_2, Number(line.discount_2) || 0, 100);
    }

    // สินค้าพ่วงเดินตามจำนวนของตัวหลักเสมอ — กติกาเดียวกับ PUT /api/quotation/:id
    for (const opt of items) {
      if (!opt?.is_optional || !opt.linked_to_product_id) continue;
      const parent = items.find((it: any) => it.product_id === opt.linked_to_product_id);
      if (parent) opt.quantity = parent.quantity;
    }

    // ด่านตรวจกฎเต็มรูปแบบ (fail-closed) — ข้อที่ **ไม่ใช่** เรื่องราคาขั้นต่ำยังบล็อกเหมือนเดิม
    const { violations } = await validateQuotationItems(items, {
      stage: 'save',
      customerName: enriched.customer_name,
      customerId: row.customer_id,
      contactId: row.contact_id,
    });
    // ข้อที่ยังบล็อกอยู่จริง = หักคำรับทราบที่ผูกกับใบไว้แล้ว (เช่นของหมดที่ผู้ขอกดรับทราบตอนส่ง)
    // แล้วเอา "ข้อที่กำลังจะอนุมัติ" (ราคาขั้นต่ำ) ออก — ที่เหลือคือของที่ต้องหยุดมือจริง ๆ
    const ackKeys = await getAcknowledgedViolationKeys(pool, String(row.id));
    const hard = blockingViolations(violations, ackKeys).filter((v) => !requiresPriceApproval(v));
    if (hard.length > 0) {
      throw new PriceApprovalError('RULE_VIOLATION', buildViolationText(hard), 422);
    }

    const total = sumLineTotals(items);
    const snapshot = await buildItemSnapshots(items);
    await pool.query(
      `UPDATE quotations
          SET item_details = $2::jsonb, total_sum = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'draft'`,
      [row.id, JSON.stringify(snapshot), total]
    );

    allViolations.push(...violations.filter(requiresPriceApproval));
    approvalItems.push(...buildApprovalItems(violations, items));
    grandTotal += total;
  }

  // ค่าบริการอัตโนมัติคิดจากยอดรวมของทุกใบในชุด — ต้องคิดใหม่หลังแก้ตัวเลข และ **ผูกขอบเขต
  // ด้วย request_id** ไม่งั้นไปรวมกับชุดอื่นของแอดมินคนเดียวกันที่ค้างอยู่ (plan §2.3)
  try {
    const { applyShippingFeeToQuoteGroup } = await import('./shippingFee.js');
    await applyShippingFeeToQuoteGroup(rows[0].user_id, undefined, String(params.requestId));
  } catch (err) {
    console.error('[priceApproval] คิดค่าบริการใหม่หลังแก้ไม่สำเร็จ:', err);
  }

  // คำขอต้องสะท้อน "ราคาที่กำลังจะถูกอนุมัติ" ตัวใหม่เสมอ — ไม่งั้นคนกดอนุมัติทีหลังจะอนุมัติ
  // ราคาชุดเก่าที่ไม่มีอยู่ในใบแล้ว (และ approvedViolationKeys จะเทียบกับตัวเลขผิดตัว)
  await decidePriceApprovalRequest(pool, String(params.requestId), 'pending', {
    items: approvalItems,
    violations: allViolations,
    edited_by_id: params.actor.id,
    edited_by: params.actor.username,
    edited_at: new Date().toISOString(),
  });

  await logApprovalEvent(rows[0]?.user_id, 'web_approval_edited', {
    request_id: String(params.requestId),
    edited_by: params.actor.username,
    items: approvalItems,
    total_sum: grandTotal,
  }, `✏️ ผู้อนุมัติแก้ตัวเลขในร่าง (ยอดรวมใหม่ ฿${grandTotal.toFixed(2)})`);

  return { request_id: String(params.requestId), violations: allViolations, items: approvalItems, total_sum: grandTotal };
}

// ── ตัดสิน ───────────────────────────────────────────────────────────────────

export interface ApproveResult {
  request_id: string;
  issued: { quote_id: string; quotation_no: string; pdf_link: string }[];
  /** ใบที่ยังออกไม่ได้หลังอนุมัติ (กฎข้ออื่นเพิ่งโผล่) — ผู้อนุมัติต้องรู้ตามจริง ไม่ใช่เห็นว่าสำเร็จหมด */
  failed: { quote_id: string; error: string; violations?: Violation[] }[];
}

/**
 * อนุมัติ แล้ว **ออกใบทันที** (เจ้าของเลือกไว้ 2026-09-15) — ไม่มีใบค้างเพราะคนลืมกลับมากด
 *
 * ลำดับสำคัญ: เขียน `approved` ลงใบ **ก่อน** เรียก confirm เสมอ เพราะด่านตรวจของ confirm
 * อ่านคำอนุมัติจากแถวของใบ (ไม่ใช่จากผู้เรียก) ถ้าสลับลำดับ มันจะบล็อกตัวเอง
 */
export async function approveRequest(params: {
  requestId: string;
  actor: ApprovalActor;
  note?: string | null;
}): Promise<ApproveResult> {
  if (!canDecideApproval(params.actor)) {
    throw new PriceApprovalError('FORBIDDEN', 'ไม่มีสิทธิ์อนุมัติราคา', 403);
  }
  const rows = await loadRequestRows(params.requestId, params.actor);
  const pa = rows[0]?.price_approval || {};
  if (pa.status !== 'pending') {
    throw new PriceApprovalError('ALREADY_DECIDED', `คำขอนี้ถูกตัดสินไปแล้ว (${pa.status})`, 409);
  }
  const decidedAt = new Date().toISOString();
  const touched = await decidePriceApprovalRequest(pool, String(params.requestId), 'pending', {
    status: 'approved',
    decided_by_id: params.actor.id,
    decided_by: params.actor.username,
    decided_by_name: params.actor.name ?? null,
    decided_at: decidedAt,
    decision_note: params.note ?? null,
  });
  if (touched.length === 0) {
    // มีคนกดตัดสินไปก่อนหน้าเราแค่เสี้ยววินาที — UPDATE มีเงื่อนไขสถานะอยู่แล้วจึงไม่มีอะไรถูกเขียนทับ
    throw new PriceApprovalError('ALREADY_DECIDED', 'คำขอนี้เพิ่งถูกตัดสินโดยคนอื่น กรุณารีเฟรชหน้าจอ', 409);
  }

  const issued: ApproveResult['issued'] = [];
  const failed: ApproveResult['failed'] = [];
  for (const row of rows) {
    // ใบหนึ่งติดกฎข้ออื่นไม่ใช่เหตุให้อีกใบในชุดออกไม่ได้ — ทำให้ครบทุกใบแล้วรายงานตามจริง
    const result = await confirmQuotationById({
      quoteId: String(row.id),
      userId: row.user_id,
      skipOwnerCheck: true,
    });
    if (result.ok) {
      issued.push({ quote_id: String(row.id), quotation_no: result.quotationNo, pdf_link: result.pdfLink });
    } else {
      failed.push({ quote_id: String(row.id), error: result.error, violations: result.violations });
    }
  }

  await logApprovalEvent(rows[0]?.user_id, 'web_approval_approved', {
    request_id: String(params.requestId),
    decided_by: params.actor.username,
    decision_note: params.note ?? null,
    issued: issued.map((i) => i.quotation_no),
    failed: failed.map((f) => f.quote_id),
  }, issued.length > 0
    ? `✅ อนุมัติราคาแล้ว\n📄 ใบเสนอราคาเลขที่: ${issued.map((i) => i.quotation_no).join(', ')}`
    : '✅ อนุมัติราคาแล้ว แต่ยังออกใบไม่สำเร็จ');

  return { request_id: String(params.requestId), issued, failed };
}

/** ไม่อนุมัติ — ใบยังอยู่เป็นร่าง กลับไปอยู่คิวของคนขอให้แก้หรือยกเลิก (เจ้าของสั่ง) */
export async function rejectRequest(params: {
  requestId: string;
  actor: ApprovalActor;
  reason: string;
}): Promise<{ request_id: string; quote_ids: string[] }> {
  if (!canDecideApproval(params.actor)) {
    throw new PriceApprovalError('FORBIDDEN', 'ไม่มีสิทธิ์อนุมัติราคา', 403);
  }
  const reason = String(params.reason ?? '').trim();
  // บังคับเหตุผล เพราะคนที่รับใบกลับไปต้องรู้ว่าจะแก้อะไร — "ไม่อนุมัติ" เฉย ๆ ทำให้เขาส่งกลับมาเหมือนเดิม
  if (reason === '') {
    throw new PriceApprovalError('REASON_REQUIRED', 'ต้องระบุเหตุผลที่ไม่อนุมัติ', 400);
  }
  const rows = await loadRequestRows(params.requestId, params.actor);
  const pa = rows[0]?.price_approval || {};
  if (pa.status !== 'pending') {
    throw new PriceApprovalError('ALREADY_DECIDED', `คำขอนี้ถูกตัดสินไปแล้ว (${pa.status})`, 409);
  }

  const touched = await decidePriceApprovalRequest(pool, String(params.requestId), 'pending', {
    status: 'rejected',
    decided_by_id: params.actor.id,
    decided_by: params.actor.username,
    decided_by_name: params.actor.name ?? null,
    decided_at: new Date().toISOString(),
    decision_note: reason,
  });
  if (touched.length === 0) {
    throw new PriceApprovalError('ALREADY_DECIDED', 'คำขอนี้เพิ่งถูกตัดสินโดยคนอื่น กรุณารีเฟรชหน้าจอ', 409);
  }

  await logApprovalEvent(rows[0]?.user_id, 'web_approval_rejected', {
    request_id: String(params.requestId),
    decided_by: params.actor.username,
    decision_note: reason,
    quote_ids: touched,
  }, `❌ ไม่อนุมัติราคา\n📝 เหตุผล: ${reason}`);

  return { request_id: String(params.requestId), quote_ids: touched };
}

/** คนขอยกเลิกคำขอของตัวเอง (หรือ admin ยกเลิกให้) — ใบกลายเป็น cancelled ด้วยกลไกเดิม */
export async function cancelRequest(params: {
  requestId: string;
  actor: ApprovalActor;
}): Promise<{ request_id: string; quote_ids: string[] }> {
  const rows = await loadRequestRows(params.requestId, params.actor);
  const pa = rows[0]?.price_approval || {};
  const isOwner = Number(pa.requested_by_id) === params.actor.id;
  if (!isOwner && params.actor.role !== 'admin') {
    throw new PriceApprovalError('FORBIDDEN', 'ยกเลิกได้เฉพาะคำขอของตัวเอง', 403);
  }
  const ids = rows.filter((r) => r.status === 'draft').map((r) => String(r.id));
  if (ids.length === 0) {
    throw new PriceApprovalError('ALREADY_CLOSED', 'คำขอนี้ไม่มีร่างที่ยกเลิกได้แล้ว', 409);
  }
  await pool.query(
    `UPDATE quotations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE id = ANY($1::uuid[]) AND status = 'draft'`, [ids]);

  await logApprovalEvent(rows[0]?.user_id, 'web_approval_cancelled', {
    request_id: String(params.requestId),
    cancelled_by: params.actor.username,
    quote_ids: ids,
  }, '🗑️ ยกเลิกคำขออนุมัติราคา');

  return { request_id: String(params.requestId), quote_ids: ids };
}

/**
 * ดึงคำขอที่ถูกตีกลับ กลับเข้าฟอร์ม "ขอใบเสนอราคา" เพื่อแก้แล้วส่งใหม่
 *
 * **ไม่ยกเลิกใบเดิมตรงนี้** — ใบเดิมถูกยกเลิก *หลัง* คำขอใหม่ถูกสร้างสำเร็จเท่านั้น
 * (`replaces_request_id` ที่ `createDraft`) ไม่งั้นคนที่กดแก้แล้วปิดจอไป จะเหลือมือเปล่า
 */
export async function loadRequestIntoForm(params: {
  requestId: string;
  actor: ApprovalActor;
}): Promise<{
  request_id: string;
  customer_id: number | null;
  contact_id: number | null;
  /** ชื่อบริษัท/ผู้ติดต่อของร่างเดิม — ฟอร์มต้องมีไว้เติม dropdown ไม่งั้นช่องจะว่างทั้งที่ id ตั้งอยู่ */
  company_name: string | null;
  contact_name: string | null;
  payment_terms_override: string | null;
  note: string | null;
  decision_note: string | null;
  items: any[];
}> {
  const rows = await loadRequestRows(params.requestId, params.actor);
  const pa = rows[0]?.price_approval || {};
  const items: any[] = [];
  for (const row of rows) {
    if (row.status !== 'draft') continue;
    const enriched = await enrichQuotationData(row);
    // บรรทัดที่ "กฎ" เป็นคนเติม (สินค้าพ่วง · ค่าขนส่งอัตโนมัติ) ต้องไม่กลับเข้าฟอร์ม ไม่งั้น
    // ตอนออกใบจริงมันจะถูกขยายซ้ำอีกชุด — กติกาเดียวกับฝั่ง revise ของหน้าเว็บ
    for (const it of (enriched.items ?? [])) {
      if (it?.is_optional) continue;
      if (it?.is_shipping_fee && !it?.is_manual_service) continue;
      items.push(it);
    }
  }
  return {
    request_id: String(params.requestId),
    customer_id: rows[0]?.customer_id ?? null,
    contact_id: rows[0]?.contact_id ?? null,
    company_name: rows[0]?.customer_details?.customer_name ?? null,
    contact_name: rows[0]?.customer_details?.contact_name ?? null,
    payment_terms_override: rows[0]?.customer_details?.payment_terms_override ?? null,
    note: pa.note ?? null,
    decision_note: pa.decision_note ?? null,
    items,
  };
}

/**
 * ประวัติของหน้าเว็บ — เขียนลง `messages` ขา `web:%` เหมือนขั้นอื่นของหน้านี้
 * (docs/plan-web-quote-logging.md) · ล้มเหลวแล้ว **ห้ามทำให้การอนุมัติล้มตาม**
 * เพราะใบออกไปแล้วจริง การโยน error ที่นี่จะทำให้หน้าจอบอกว่าไม่สำเร็จทั้งที่สำเร็จ
 */
async function logApprovalEvent(
  webUserId: string | null | undefined, type: string, meta: Record<string, unknown>, replyContent: string
): Promise<void> {
  if (!webUserId || !parseWebUserId(webUserId)) return;
  try {
    await insertMessage({
      user_id: webUserId,
      message_id: `${type}_${Date.now()}`,
      type,
      content: 'อนุมัติราคา',
      reply_token: null,
      reply_content: replyContent,
      meta,
    });
  } catch (err) {
    console.error(`[priceApproval] เขียนประวัติ ${type} ไม่สำเร็จ:`, err);
  }
}
