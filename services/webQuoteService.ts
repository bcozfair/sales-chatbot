// ─────────────────────────────────────────────────────────────────────────────
//  webQuoteService — หลังบ้านของหน้าเว็บ "ขอใบเสนอราคา" (เฟส D)
//  แผน: docs/plan-web-quote-request.md ขั้น 3′ (§0.4 · §2.3 · §6.0)
//
//  ⚠️ กติกาเหล็กของไฟล์นี้:
//     * **ไม่แตะ handleEvent · ไม่ประกอบ Flex · ไม่มี replyToken** — คืน "ข้อมูลดิบ" ให้
//       frontend เรนเดอร์เอง ทุกอย่างที่เป็นรูปร่างของ LINE ห้ามหลุดเข้ามาในไฟล์นี้
//       (appendReviseFrom ที่ import จาก utils/flexTemplates เป็นตัวต่อสตริง customer_name
//        ล้วน ๆ ไม่ได้สร้าง Flex — ใช้ตัวเดียวกับ handleQuotationEditRequest เพื่อให้
//        รูปแบบ meta `revise_from=` ของสองเส้นไม่มีวันเพี้ยนออกจากกัน)
//     * ทุกฟังก์ชันรับ `adminId` + `spUserId` แล้วแปลงเป็น `webUserId` ด้วย ensureWebProxy()
//       **ก่อนเสมอ** — กัน FK 23503 ตอน insert และ refresh ชื่อ/เบอร์/รหัสของเซลส์ให้ทันปัจจุบัน
//     * ตรรกะธุรกิจทั้งหมด (ราคา · ส่วนลด · กฎบล็อก · blacklist · เครดิต) **เรียกของเดิม**
//       ไม่ก๊อปมาไว้ที่นี่ ไม่งั้นวันหนึ่งใบที่ออกจากเว็บกับจาก LINE จะคิดเลขไม่ตรงกัน
//
//  ทำไม propose กับ createDraft ถึงแยกเป็นสองก้าว: ของเดิมใน LINE ทำรวดเดียว (ล้างใบค้าง
//  แล้ว insert ทันที) เพราะแชทไม่มีที่ให้ "ดูก่อนแล้วค่อยกด" · ฟอร์มมี ⇒ แยกได้ **และต้องแยก**
//  ไม่งั้นแค่วางข้อความผิดก็ไปลบร่างที่ค้างอยู่ทิ้งแล้ว (ด่าน diag:web-quote ข้อ 2 ตรวจข้อนี้)
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from '../config/db.js';
import {
  getCustomerById, getContactById, getSalespersonByUserId, getAdminSalespersonIds,
  insertMessage, getMessageMetaById, listCustomerPaymentTerms,
  saveQuotationRuleOverrides,
  savePriceApproval,
} from '../db/repositories.js';
import { KeyedTaskQueue, runWithDeadline } from './webhookQueue.js';
import { extractQuoteFromText, buildResolvedItem, type QuoteSlot } from './quoteExtraction.js';
import { findCustomerCandidates, findContactCandidates, decideCustomerSelection } from './customerService.js';
import { getProductById, findProduct } from './productService.js';
import {
  validateQuotationItems,
  insertDraftQuotations,
  buildViolationText,
  resolveQuoteCompany,
  buildItemSnapshots,
  resolveQuotationDeliveryDays,
  parseDeliveryDaysOverride,
  buildOdooManualReview,
  violationKey,
  isBypassableViolation,
  blockingViolations,
  violationMode,
  type Violation,
  type ViolationModeMap,
  type DraftQuoteOverrides,
} from './quotationService.js';
import { ruleModesOf, can } from '../config/capabilities.js';
import { isLocalContactId, ensureDirectoryRow, getLocalContactById } from '../db/localContactsRepo.js';
import type { Role } from '../config/auth.js';
import {
  buildApprovalItems,
  buildApprovalPayload,
  newApprovalRequestId,
  type ApprovalItem,
} from './priceApprovalService.js';
import {
  resolveDeliveryTerms, deliveryDisplayText, deliveryTypeLabel,
  parseDeliveryTypeOverride, DELIVERY_TYPES, type DeliveryTypeKey, type DeliveryTerms,
} from '../utils/deliveryTerms.js';
import ThaiBahtText from 'thai-baht-text';
import { buildThaiAddress } from '../utils/address.js';
import { COMPANY_PROFILES, type CompanyProfile } from '../utils/companyProfile.js';
import { round2, calcNetPrice, quotationDocumentTotals } from '../utils/pricing.js';
import { resolveMinWarrantyDisplay, warrantyNoteText } from '../utils/warranty.js';
import { loadActiveQuotation } from './quotationAgent.js';
import { appendReviseFrom } from '../utils/flexTemplates.js';
import {
  ensureWebProxy,
  getAdminIssuerProfile,
  listActingSalespersons,
  buildWebProposeKey,
} from './webIdentity.js';
import { dedupeActingSalespersons, type PickedSalesperson } from './salespersonPicker.js';
import { resolveCustomerSalesOwner, resolveQuotationSalesOwner, type SalesOwner } from './customerSalesOwner.js';

/**
 * งบเวลาต่อ 1 คำขอของหน้าเว็บ
 *
 * เว็บไม่มี replyToken เดินถอยหลัง 1 นาทีมาบีบเหมือน LINE (ผู้ใช้นั่งดูสปินเนอร์อยู่ กดใหม่ได้เอง)
 * ⇒ ให้งบยาวกว่าเพื่อไม่ตัดงานที่ "ช้าแต่จะสำเร็จ" ทิ้งฟรี ๆ แต่ยังต้องมีเพดาน ไม่งั้น request
 * ที่ค้างจะกินสล็อตคิวไว้ตลอดกาล
 */
export const WEB_BUDGET_MS = 60_000;

/**
 * คิวของหน้าเว็บ — **instance ของตัวเอง ห้ามใช้ตัวเดียวกับ /callback**
 *
 * ถ้าใช้ร่วมกัน แอดมิน 1 คนวางข้อความยาว ๆ จะไปกินสล็อตของเซลส์ที่รอ LINE ตอบอยู่
 * ซึ่งฝั่งนั้นมี replyToken เดินถอยหลังอยู่ = เสียหายกว่ากันมาก
 * maxConcurrency 4 เพราะงานหนักของเส้นนี้คือ LLM + ค้นสินค้า ซึ่งไปกิน LLM/DB ตัวเดียวกับ LINE
 *
 * key = webUserId ⇒ แอดมินคนเดียวกันที่ออกใบในนามเซลส์คนเดียวกันถูกจัดคิวทีละงาน
 * (กดปุ่มรัว ๆ ไม่สร้างร่างซ้อนกัน) ส่วนคู่อื่น ๆ ยังขนานกันได้ตามปกติ
 */
const webQueue = new KeyedTaskQueue(4);

/** ให้ด่านตรวจดูสถานะคิวได้ โดยไม่ต้อง export ตัวคิวออกไปให้ใครแก้สถานะ */
export function webQueueStats() {
  return { active: webQueue.activeCount, pending: webQueue.pendingCount, idle: webQueue.isIdle };
}

export type WebQuoteErrorCode =
  | 'MAKER_NOT_SET'            // แอดมินยังไม่ได้ตั้งชื่อผู้จัดทำ (เฟส B/B2)
  | 'ADMIN_NOT_FOUND'
  | 'SALESPERSON_NOT_FOUND'
  | 'SALESPERSON_REQUIRED'     // ระบบหาเซลส์ให้เองไม่ได้ ⇒ ต้องเลือกเอง (customerSalesOwner.ts)
  | 'BAD_REQUEST'
  | 'QUOTATION_NOT_FOUND'
  | 'QUOTATION_NOT_CONFIRMED'
  | 'PRODUCT_NOT_FOUND'
  | 'RULE_VIOLATION'
  | 'NEEDS_APPROVAL'            // ติดราคาขั้นต่ำ ⇒ ต้องส่งให้ผู้อนุมัติ ไม่ใช่ติ๊กรับทราบเอง
  | 'FORBIDDEN'                 // role นี้ทำสิ่งนี้ไม่ได้ (เมทริกซ์สิทธิ์ · docs/plan-role-permissions.md)
  | 'INSERT_FAILED'
  | 'TIMEOUT';

/** error ที่ route แปลงเป็น HTTP status ได้ตรง ๆ โดยไม่ต้องเดาจากข้อความ */
export class WebQuoteError extends Error {
  constructor(
    public readonly code: WebQuoteErrorCode,
    message: string,
    public readonly status: number,
    /** รายละเอียดเพิ่มให้ UI แสดง (เช่น violations ที่ติดกฎ) */
    public readonly detail?: any
  ) {
    super(message);
    this.name = 'WebQuoteError';
  }
}

/**
 * แปลง (แอดมิน × เซลส์) เป็น `webUserId` — ด่านแรกของทุกฟังก์ชันในไฟล์นี้
 *
 * ตรวจ "ตั้งชื่อผู้จัดทำแล้วหรือยัง" ที่นี่แทนที่จะปล่อยให้ ensureWebProxy โยน Error ดิบ
 * เพราะเป็นเคสที่ผู้ใช้แก้เองได้ (ไปตั้งชื่อในแถบโปรไฟล์) ⇒ ต้องได้ 400 พร้อมบอกวิธี ไม่ใช่ 500
 *
 * `role === 'salesperson'` เดินเส้น "เซลส์ออกใบเอง" (§13.2) — ไม่ต้องมี
 * `admin_users.employee_quotation_id` (บัญชีเซลส์ไม่มีแนวคิดนี้ ดู §13.5) และ `ensureWebProxy`
 * ก๊อปช่อง J จากแถวเซลส์เองแทนของแอดมิน ⚠️ **ผู้เรียกต้องเรียก `assertMayActAs()` มาก่อนแล้ว
 * เสมอ** ฟังก์ชันนี้ไม่ตรวจสิทธิ์ซ้ำ (ไว้ใจว่า spUserId ผ่านด่านมาแล้ว)
 */
export async function resolveWebUserId(adminId: number, spUserId: string, role?: Role): Promise<string> {
  const sp = String(spUserId ?? '').trim();
  if (sp === '') throw new WebQuoteError('BAD_REQUEST', 'ต้องระบุเซลส์ที่จะออกใบในนาม (sp_user_id)', 400);

  if (role === 'salesperson') {
    try {
      return await ensureWebProxy({ id: adminId, employee_quotation_id: null }, sp, { selfIssue: true });
    } catch (err: any) {
      if (String(err?.message || '').includes('ไม่พบเซลส์')) {
        throw new WebQuoteError('SALESPERSON_NOT_FOUND', `ไม่พบเซลส์ที่ใช้งานอยู่ (user_id=${sp})`, 400);
      }
      throw err;
    }
  }

  const profile = await getAdminIssuerProfile(adminId);
  if (!profile) throw new WebQuoteError('ADMIN_NOT_FOUND', `ไม่พบแอดมิน id=${adminId}`, 404);
  if (!profile.employee_quotation_id) {
    throw new WebQuoteError(
      'MAKER_NOT_SET',
      'ยังไม่ได้ตั้งชื่อผู้เสนอราคา/ผู้จัดทำ — ตั้งค่าที่หน้าจัดการผู้ใช้งานระบบก่อนออกใบ',
      400
    );
  }

  try {
    return await ensureWebProxy({ id: adminId, employee_quotation_id: profile.employee_quotation_id }, sp);
  } catch (err: any) {
    // ensureWebProxy โยนเมื่อไม่พบเซลส์ที่ active — ข้อมูลที่ client ส่งมาผิด ไม่ใช่ระบบพัง
    if (String(err?.message || '').includes('ไม่พบเซลส์')) {
      throw new WebQuoteError('SALESPERSON_NOT_FOUND', `ไม่พบเซลส์ที่ใช้งานอยู่ (user_id=${sp})`, 400);
    }
    throw err;
  }
}

/**
 * รันงาน 1 ชิ้นผ่านคิวของหน้าเว็บภายใต้ WEB_BUDGET_MS
 *
 * runWithDeadline คืนแค่ "ผลของการรัน" ไม่ใช่ค่าที่งานคืน ⇒ ต้องรับค่าออกมาทางตัวแปรนอกสุดเอง
 * · งานที่หมดเวลาถูก abort แล้ว error ที่ตามมาทีหลังถูกกลืนที่ onGhostError ไม่ปล่อยให้กลายเป็น
 * unhandledRejection (ซึ่ง Node จะฆ่าโปรเซสทิ้งทั้งตัว)
 */
async function runQueued<T>(key: string, work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    webQueue.push(key, async () => {
      let value: T | undefined;
      const res = await runWithDeadline(
        WEB_BUDGET_MS,
        async () => { value = await work(); },
        (err) => console.error('[webQuote] งานที่ถูกตัดเวลาพังทีหลัง (ไม่กระทบคำตอบที่ส่งไปแล้ว):', err)
      );
      if (res.outcome === 'ok') return resolve(value as T);
      if (res.outcome === 'timeout') {
        return reject(new WebQuoteError('TIMEOUT', 'ระบบใช้เวลานานเกินกำหนด รบกวนลองใหม่อีกครั้ง', 504));
      }
      reject(res.error);
    });
  });
}

// ── ประวัติการใช้งานของหน้าเว็บ — docs/plan-web-quote-logging.md ─────────────
//
//  เก็บลง `messages` ตารางเดียวกับ LINE ไม่แยกตารางใหม่ · `user_id = web:%` คือสวิตช์
//  ช่องทาง (services/webIdentity.ts) จึงไม่มีคอลัมน์ "channel" มาซ้ำ
//
//  ⚠️ `type` ต้องขึ้นต้น `web_` เสมอ ห้ามใช้ `'text'` — ด่านขุด corpus ทุกตัวกรอง
//     `type = 'text'` ถ้าใช้ชื่อเดียวกัน แถวของเว็บจะไหลเข้า corpus ของ eval เงียบ ๆ
//     และ customerSearchEval จะให้คะแนนด้วย "แถวพร็อกซีที่ branch เป็น NULL" แทนเซลส์ตัวจริง
//     ⇒ ผลก่อน/หลังเทียบกันไม่ได้ · prefix นี้ทำให้ค่าตั้งต้นคือ "ถูกกันออก"
//
//  ⚠️ โครงสร้างไปอยู่ที่ `meta` เท่านั้น ห้ามยัด JSON ลง `reply_content` — evalCustomerSearch
//     ขุดเฉลยด้วย `reply_content LIKE '%ร่างใบเสนอราคา%'` แล้ว `/🏢 (.+)/` การคงรูปแบบข้อความ
//     ไว้ทำให้แถวของเว็บใช้เป็นเฉลยได้ทันทีในวันที่เราตัดสินใจเปิดให้มันเข้า corpus

/** จำนวน candidate ที่เก็บลง meta — เท่ากับที่ picker ของ LINE slice ไว้ (quotationService.ts) */
const LOG_CANDIDATE_LIMIT = 12;

/** ชนิดของเหตุการณ์ที่หน้าเว็บเขียนลง messages.type */
type WebEventType = 'web_propose' | 'web_draft' | 'web_revise';

/**
 * ย่อ candidate ให้เหลือเฉพาะสิ่งที่ตอบคำถาม "ทำไมระบบเรียงลำดับแบบนี้"
 * ไม่เก็บแถวลูกค้าทั้งแถว — ที่อยู่/เบอร์/อีเมลของลูกค้าไม่ได้ช่วยตอบคำถามนั้นเลย
 * และการไม่ก๊อปมันมาไว้อีกที่คือการไม่เพิ่มจุดที่ PII รั่วโดยไม่จำเป็น
 */
function slimCustomerCandidates(candidates: any[] | null | undefined): any[] {
  return (candidates ?? []).slice(0, LOG_CANDIDATE_LIMIT).map((c: any, i: number) => ({
    rank: i + 1,
    id: c?.item?.id ?? null,
    display_name: c?.item?.display_name ?? null,
    reference: c?.item?.reference ?? null,
    score: c?.score ?? null,
    matched_contacts: c?.evidence?.matchedContacts ?? [],
    partial_contacts: c?.evidence?.partialContacts ?? [],
  }));
}

function slimContactCandidates(candidates: any[] | null | undefined): any[] {
  return (candidates ?? []).slice(0, LOG_CANDIDATE_LIMIT).map((c: any, i: number) => ({
    rank: i + 1,
    id: c?.item?.id ?? null,
    name: c?.item?.name ?? null,
    score: c?.score ?? null,
  }));
}

/**
 * เขียนแถวประวัติ 1 เหตุการณ์ — **ห้าม throw และห้ามให้เส้นทางหลักรอผลของมันเพื่อตัดสินใจอะไร**
 * `insertMessage()` กลืน error ไว้เองอยู่แล้ว (db/repositories.ts) ที่นี่แค่ยืนยันสัญญานั้น
 *
 * ⚠️ ทุกจุดที่เรียกต้องอยู่ **นอกทรานแซกชัน** — ฟังก์ชันนี้ใช้ `pool` ตามกฎเหล็กของ CLAUDE.md
 */
async function logWebEvent(params: {
  webUserId: string;
  type: WebEventType;
  content: string;
  replyContent: string;
  meta: Record<string, any>;
}): Promise<number | null> {
  return insertMessage({
    user_id: params.webUserId,
    message_id: `${params.type}_${Date.now()}`,
    type: params.type,
    content: params.content,
    // เว็บไม่มี replyToken และจะไม่มีวันมี — ไม่ใช่ "ยังไม่ได้ใส่"
    reply_token: null,
    reply_content: params.replyContent,
    meta: params.meta,
  });
}

/** สรุปผลของ propose เป็นข้อความ — ถ้อยคำเดินตามฝั่ง LINE เพื่อให้อ่านเทียบกันได้ */
function buildProposeReplyText(r: ProposeResult, customerQuery: string): string {
  if (r.extraction_failed) return r.reply_message || 'ระบบไม่ว่าง สกัดข้อความไม่สำเร็จ';
  if (!r.quote_data) return r.reply_message || `intent=${r.intent}`;

  const lines = [`📝 ร่างใบเสนอราคา (ยังไม่บันทึก)`];
  const n = r.customer_candidates.length;
  if (customerQuery === '') lines.push(`⚠️ ไม่ได้ระบุชื่อบริษัท/ลูกค้า`);
  else if (n === 0) lines.push(`❌ ไม่พบชื่อบริษัท "${customerQuery}" ในระบบ`);
  else if (r.auto_customer_id != null) {
    // ระบบชี้ขาดได้ → บรรทัด 🏢 ต้องเป็น "ชื่อบริษัทล้วน" เหมือนของ LINE เป๊ะ ๆ
    // เพราะ evalCustomerSearch ขุดเฉลยด้วย /🏢 (.+)/ — แถวเว็บจึงกลายเป็นชุดข้อสอบได้ฟรีในอนาคต
    // (§3.2) · จำนวนตัวเลือกไปอยู่บรรทัด 📦 แทน ห้ามต่อท้ายบรรทัดนี้
    const picked = r.customer_candidates.find((c: any) => Number(c?.item?.id) === r.auto_customer_id);
    lines.push(`🏢 ${picked?.item?.display_name ?? '-'}`);
  }
  else lines.push(`🏢 พบชื่อบริษัทใกล้เคียงกับ "${customerQuery}" ${n} ราย — รอเคาะ`);

  lines.push(`📦 รายการ ${r.slots.length} · ยังไม่ระบุรุ่นได้ ${r.unresolved_count}`);
  return lines.join('\n');
}

// ── 1) ข้อความ → ร่าง (ยังไม่เขียน quotations) ───────────────────────────────

export interface ProposeResult {
  web_user_id: string;
  intent: string;
  /** true = UNCLEAR เพราะระบบไม่ว่าง ไม่ใช่เพราะข้อความไม่ชัด — UI ขึ้นแถบแดง + ปุ่มลองใหม่ */
  extraction_failed: boolean;
  reply_message: string | null;
  /** quotation_data ดิบจาก AI (customer_query / contact_query / ส่วนลดระดับบิล) */
  quote_data: any | null;
  slots: QuoteSlot[];
  /** จำนวน slot ที่ยัง resolve ไม่ได้ — ฟอร์มต้องให้แอดมินเคาะให้ครบก่อนสร้างร่าง */
  unresolved_count: number;
  customer_candidates: any[];
  contact_candidates: any[];
  /**
   * id ของแถวประวัติที่เพิ่งเขียนลง `messages` — ฟอร์มต้องส่งกลับมาตอนกดสร้างร่าง
   * เพื่อให้คำนวณ `chosen_rank` ได้ว่าแอดมินเคาะบริษัทอันดับที่เท่าไรของสิ่งที่ระบบเรียงให้
   * (docs/plan-web-quote-logging.md §5) · `null` = เขียน log ไม่สำเร็จ ซึ่งไม่ใช่เหตุให้งานล้ม
   */
  propose_msg_id: number | null;
  /**
   * บริษัทที่ระบบตัดสินให้เองได้ (`decideCustomerSelection` — กฎเดียวกับที่ LINE ใช้อยู่)
   * `null` = หลักฐานไม่พอ ต้องให้แอดมินเคาะเอง
   *
   * ฟอร์ม **ยังได้ `customer_candidates` ครบทุกตัวเหมือนเดิม** — ค่านี้บอกแค่ว่าจะ preselect
   * ตัวไหน ไม่ได้ตัดตัวเลือกอื่นทิ้ง แอดมินเปลี่ยนเองได้เสมอ (ต่างจาก LINE ที่ auto-select
   * แล้วปิดทางเลือกไปเลย — บนหน้าจอมี dropdown อยู่แล้วจึงไม่ต้องยอมแลกแบบนั้น)
   */
  auto_customer_id: number | null;
}

/**
 * วางข้อความ → คืน slots + candidates โดย **ไม่เขียน `quotations` สักแถว**
 *
 * ต่างจากทางเดินของ LINE 2 จุดเท่านั้น:
 *   1. `purgePending: false` — ยังไม่ใช่การตัดสินใจ จึงไม่มีสิทธิ์ไปลบร่างที่ค้างอยู่
 *   2. ไม่เรียก processQuotationRequest — ฟังก์ชันนั้นเขียนใบสถานะ `pending_*` ระหว่างไล่ถามหา
 *      บริษัท/ผู้ติดต่อ ซึ่งเป็นกลไกของแชทล้วน ๆ · ฟอร์มถามทั้งหมดจบในหน้าเดียวก่อน insert
 *      ⇒ เรียก findCustomerCandidates/findContactCandidates (อ่านอย่างเดียว) ตรง ๆ แทน
 *
 * **เขียน `messages` 1 แถว** (`type='web_propose'`) ตั้งแต่ 2026-09-14 — ตารางคนละตัวกับ
 * `quotations` และคำมั่นข้อ 1 ยังอยู่ครบ ด่าน `diag:web-quote` ข้อ 2 ตรวจที่ `quotations`
 */
export async function proposeFromText(params: {
  adminId: number;
  /** role ของคนที่กำลังวางข้อความ — บังคับส่งเสมอ ใช้ตรวจว่าออกใบในนามรหัสนี้ได้ไหม (§13.2/§13.6 ข้อ 9) */
  role: Role;
  /**
   * ว่างได้ (2026-09-24) เฉพาะ role ที่เลือกเซลส์คนไหนก็ได้ — ช่อง "ออกในนาม" เริ่มต้นว่าง แล้ว
   * หน้าจอเติมให้จากลูกค้าที่ได้จากขั้นนี้ (docs/plan-web-quote-auto-salesperson.md)
   */
  spUserId?: string | null;
  text: string;
}): Promise<ProposeResult> {
  const text = String(params.text ?? '').trim();
  if (text === '') throw new WebQuoteError('BAD_REQUEST', 'ต้องมีข้อความที่จะสกัด (text)', 400);

  const spUserId = String(params.spUserId ?? '').trim();
  let webUserId: string;
  if (spUserId === '') {
    // ยังไม่รู้เซลส์ ⇒ ไม่สร้างแถวพร็อกซี (ขั้นนี้ไม่เขียน quotations อยู่แล้ว) ใช้คีย์คิว/ประวัติแทน
    await assertMayProposeWithoutSalesperson(params.role);
    webUserId = buildWebProposeKey(params.adminId);
  } else {
    // ออกใบในนามคนอื่นไม่ได้ ถ้าไม่มีสิทธิ์ — ก่อน resolveWebUserId เสมอ (มันเขียนแถวพร็อกซีแล้ว)
    await assertMayActAs(params.adminId, params.role, spUserId);
    webUserId = await resolveWebUserId(params.adminId, spUserId, params.role);
  }

  return runQueued(webUserId, async () => {
    const startedAt = Date.now();
    // useHistory: false — เส้นเว็บมีแถวของตัวเองใน messages แล้ว แต่ยังไม่เปิดให้ป้อน prompt
    // (เหตุผลเต็มอยู่ที่นิยามของพารามิเตอร์ใน quoteExtraction.ts)
    const extracted = await extractQuoteFromText({
      userId: webUserId, text, purgePending: false, useHistory: false,
    });

    const base: ProposeResult = {
      web_user_id: webUserId,
      intent: extracted.intent,
      extraction_failed: !!extracted.extraction_failed,
      reply_message: extracted.reply_message ?? null,
      quote_data: extracted.quoteData ?? null,
      slots: extracted.slots ?? [],
      unresolved_count: (extracted.slots ?? []).filter(s => !s.resolved).length,
      customer_candidates: [],
      contact_candidates: [],
      propose_msg_id: null,
      auto_customer_id: null,
    };

    /** เขียนประวัติแล้วติด id กลับเข้า result — เรียกที่ทางออกทุกทางของฟังก์ชันนี้ */
    const finish = async (customerQuery: string, outcome: string): Promise<ProposeResult> => {
      base.propose_msg_id = await logWebEvent({
        webUserId,
        type: 'web_propose',
        content: text,
        replyContent: buildProposeReplyText(base, customerQuery),
        meta: {
          intent: base.intent,
          outcome,
          // บริษัทที่ระบบชี้ขาดเอง — คู่กับ `outcome` ไม่ใช่แทนที่: outcome บอก "รูปร่างของผลค้น"
          // (กี่ราย) ส่วนตัวนี้บอก "ตัดสินได้ไหม" ⇒ แถว outcome='ambiguous' ที่มีค่านี้
          // คือเคสที่ชั้นตัดสินใจทำงาน ซึ่งเป็นตัวเลขที่ต้องเฝ้าหลังเปลี่ยนกฎ
          auto_customer_id: base.auto_customer_id,
          extracted: base.quote_data,
          cust_candidates: slimCustomerCandidates(base.customer_candidates),
          contact_candidates: slimContactCandidates(base.contact_candidates),
          duration_ms: Date.now() - startedAt,
        },
      });
      return base;
    };

    // intent อื่น (REGISTER / PRODUCT_INFO / UNCLEAR) ไม่มีอะไรให้เติม — ฟอร์มขึ้นข้อความจาก AI
    if (!extracted.quoteData) {
      return finish('', base.extraction_failed ? 'extraction_failed' : `intent_${base.intent}`);
    }

    // ใช้แถวเซลส์ "ตัวจริง" ไม่ใช่แถวพร็อกซี — การให้คะแนนใช้ชื่อเจ้าของลูกค้าและสาขา
    // ซึ่งแถวพร็อกซีไม่ได้ก๊อป branch มาด้วยตามที่ §2.3 ตั้งใจ ⇒ ใช้พร็อกซีจะได้คะแนน
    // ต่างจากตอนเซลส์คนนั้นทักเอง ทั้งที่เป็นใบของลูกค้ารายเดียวกัน
    // ยังไม่เลือกเซลส์ = null ⇒ ไม่มีสัญญาณ "เซลส์เจ้าของลูกค้าตรงกับผู้ส่ง" (ถูกแล้ว: คนวางข้อความ
    // ไม่ใช่เจ้าของลูกค้า) — baseline ของ eval วัดโหมดนี้อยู่แล้ว (plan §4)
    const realSp = spUserId === '' ? null : await getSalespersonByUserId(spUserId);
    const customerQuery = String(extracted.quoteData.customer_query ?? '').trim();
    const contactQuery = String(extracted.quoteData.contact_query ?? '').trim();

    if (customerQuery) {
      base.customer_candidates = await findCustomerCandidates(customerQuery, realSp, contactQuery);
    }

    // ชั้นตัดสินใจ — กฎเดียวกับที่ LINE ใช้ (decideCustomerSelection ใน customerService.ts)
    // ก่อน 2026-09-14 ตรงนี้นับจำนวน candidate ล้วน: เจอ 2 ตัวขึ้นไปก็ให้แอดมินเคาะทุกครั้ง
    // ทั้งที่คะแนนชี้ขาดอยู่แล้ว — วัดได้ 38/56 เคสของชุดข้อสอบ (npm run diag:web-decision)
    const decision = decideCustomerSelection(base.customer_candidates);
    const decidedCustomerId = decision.auto ? Number(decision.winner?.item?.id) || null : null;
    base.auto_customer_id = decidedCustomerId;

    // ผู้ติดต่อค้นได้ก็ต่อเมื่อรู้บริษัทแน่นอนแล้ว — บริษัทที่ยังกำกวมให้ฟอร์มเคาะก่อน แล้วค่อยเรียก
    // `GET /api/customer/:id/contacts` เดิมเอง (endpoint นั้นไม่ผูก LINE — §0.3)
    // เงื่อนไขนี้เคยเป็น `candidates.length === 1` ซึ่งเป็นข้อจำกัดที่ §5.1 ของแผน log เขียนไว้ว่า
    // "งานแก้ parity จะเปลี่ยน" — ตอนนี้ผูกกับผลการตัดสินแทนการนับ จึงได้ผู้ติดต่อในเคส auto ด้วย
    if (decidedCustomerId && contactQuery) {
      base.contact_candidates = await findContactCandidates(decidedCustomerId, contactQuery);
    }

    return finish(
      customerQuery,
      customerQuery === '' ? 'no_customer_query'
        : base.customer_candidates.length === 0 ? 'no_candidates'
        : base.customer_candidates.length === 1 ? 'single_candidate'
        : 'ambiguous'
    );
  });
}

// ── 2) ฟอร์มที่แอดมินเคาะแล้ว → ร่างจริงใน DB ────────────────────────────────

// ── ค่าที่คนออกใบตั้งทับ: เครดิต + กำหนดส่ง (2026-09-14) ──────────────────────
//
//  พรีวิวกับการสร้างร่างต้องอ่าน body ชุดเดียวกันและตีความเหมือนกันเป๊ะ ⇒ แปลงที่นี่ที่เดียว
//  ไม่งั้นสองเส้นจะตีความคำว่า "ว่าง" คนละแบบ แล้วสิ่งที่แอดมินเห็นก่อนกดจะไม่ใช่สิ่งที่บันทึก
//  ซึ่งเป็นข้อเดียวที่หัวไฟล์ของ previewDraft ยกให้เป็นเหตุผลของการมีอยู่ของพรีวิว

export interface WebQuoteDeliveryInput {
  /** 'PM' | 'THT' — ใบที่ค่านี้เป็นของ (สองใบมีสต๊อกคนละชุด ค่าอัตโนมัติจึงไม่เท่ากัน) */
  quote_company?: string | null;
  delivery_type_override?: any;
  delivery_days_override?: any;
}

/** ยาวกว่านี้คือวางข้อความผิดช่อง ไม่ใช่เครดิต — ค่ายาวสุดที่มีจริงในฐานคือ 18 ตัวอักษร */
const PAYMENT_TERMS_MAX = 60;
/** ความยาวสูงสุดของหมายเหตุรายบรรทัด — ยาวกว่านี้ใบ PDF จะดันแถวจนตกหน้า */
const ITEM_REMARK_MAX = 200;

/**
 * เครดิตที่ตั้งทับ — `null` = ไม่ได้ตั้ง ให้ใช้ของลูกค้าตามเดิม
 *
 * ช่องว่างล้วนนับเป็น "ไม่ได้ตั้ง" ไม่ใช่ "ใบนี้ไม่มีเครดิต" เพราะหน้าจอมี `Cash` กับ
 * `Immediate Payment` ให้เลือกอยู่แล้วเมื่อจะสั่งว่าไม่มีเครดิตจริง ๆ ⇒ ช่องว่างที่หลุดมา
 * มีทางเดียวคือพลาด และการเดาว่า "ตั้งใจล้างเครดิต" จะทำให้ใบมีค่าบริการโผล่มาโดยไม่มีใครสั่ง
 */
export function parsePaymentTermsOverride(raw: any): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (s.length > PAYMENT_TERMS_MAX) {
    throw new WebQuoteError('BAD_REQUEST', `เครดิตยาวเกิน ${PAYMENT_TERMS_MAX} ตัวอักษร`, 400);
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ด่านสิทธิ์ของ "ของที่ไม่ใช่กฎ" — เครดิตที่ตั้งทับ และการออกใบในนามคนอื่น
//
//  ทั้งคู่บังคับใช้ **ที่ service ไม่ใช่ที่ route** เพราะมันตัดสินจาก *เนื้อของคำขอ* ไม่ใช่จาก
//  ปลายทางที่ยิงมา: แอดมินที่ไม่ได้ตั้งเครดิตทับก็ยิง endpoint เดียวกัน และเซลส์ที่ออกใบในนาม
//  ตัวเองก็ส่ง sp_user_id มาเหมือนกันทุกประการ ⇒ `requireCapability()` ที่ route แยกไม่ออก
//
//  แผน: docs/plan-role-permissions.md §4ข · §13.2
// ─────────────────────────────────────────────────────────────────────────────

async function assertMayOverridePaymentTerms(role: Role, override: string | null | undefined): Promise<void> {
  if (override === null || override === undefined) return;
  if (await can(role, 'quote.payment_terms_override')) return;
  throw new WebQuoteError('FORBIDDEN', 'บัญชีนี้ไม่มีสิทธิ์ตั้งเครดิตทับเฉพาะใบ — ใบจะใช้เครดิตของลูกค้าตามฐานข้อมูล', 403);
}

/**
 * ออกใบในนามรหัสนี้ได้ไหม
 *
 * บัญชีที่ไม่มี `quote.act_as_any_salesperson` ทำได้เฉพาะ **รหัสของตัวเอง** ที่ผูกไว้ใน
 * `admin_user_salespersons` · คนที่มีสองรหัส (มีจริง — วัด 2026-09-18) เลือกได้ว่าจะออก
 * ในนามสาขาไหน ซึ่งยังเป็นตัวเขาเองทั้งสองทาง
 *
 * ⚠️ ตอบ **403 พร้อมเหตุผล** ไม่ใช่ "เงียบ ๆ แก้ให้เป็นรหัสตัวเอง" — คนยิงต้องรู้ว่าทำไม่ได้
 *    ไม่ใช่เข้าใจว่าทำได้แล้ว (§13.2) · บัญชีที่ไม่ได้ผูกรหัสไว้เลยออกใบไม่ได้ทั้งหมด ซึ่งตรงกับ
 *    ด่าน "ความพร้อมของบัญชี" ใน §13.5
 *
 * ⚠️ **ต้องเรียกทุกเส้นที่รับ `sp_user_id` จาก client แล้วเอาไปใช้จริง** ไม่ใช่แค่ตอนสร้างร่าง
 *    (§13.6 ข้อ 9) — `role` เป็น `undefined` ได้เฉพาะตอนผู้เรียกเก่าที่ไม่รู้จัก role เลย ซึ่งจะตกไป
 *    ที่ด่านตรวจความเป็นเจ้าของเสมอ (ไม่มีทาง "any salesperson" แบบไม่รู้ role) — ปลอดภัยไว้ก่อน
 */
async function assertMayActAs(adminId: number, role: Role | undefined, spUserId: any): Promise<void> {
  if (role && (await can(role, 'quote.act_as_any_salesperson'))) return;

  const mine = await getAdminSalespersonIds(adminId);
  if (mine.length === 0) {
    throw new WebQuoteError(
      'FORBIDDEN',
      'บัญชีนี้ยังไม่ได้ผูกกับรหัสพนักงานขาย จึงยังออกใบเสนอราคาไม่ได้ — ติดต่อผู้ดูแลระบบ',
      403
    );
  }

  const sp = await getSalespersonByUserId(String(spUserId ?? '').trim());
  const code = sp ? String(sp.salesperson_id ?? '') : '';
  if (code === '' || !mine.includes(code)) {
    throw new WebQuoteError('FORBIDDEN', 'บัญชีนี้ออกใบเสนอราคาได้เฉพาะในนามตัวเองเท่านั้น', 403);
  }
}

/**
 * ไม่ส่งเซลส์มาได้ไหม — ได้เฉพาะบัญชีที่เลือกเซลส์คนไหนก็ได้ (ช่องเริ่มต้นว่าง · 2026-09-24)
 *
 * บัญชีที่ออกในนามตัวเองเท่านั้น (role salesperson) หน้าจอเติมรหัสตัวเองให้เสมอ ⇒ ถ้ามาถึงนี่
 * แบบว่าง ๆ คือ client ผิดปกติ — ตอบข้อความเดิมก่อนมีฟีเจอร์นี้เป๊ะ
 */
async function assertMayProposeWithoutSalesperson(role: Role | undefined): Promise<void> {
  if (role && (await can(role, 'quote.act_as_any_salesperson'))) return;
  throw new WebQuoteError('BAD_REQUEST', 'ต้องระบุเซลส์ที่จะออกใบในนาม (sp_user_id)', 400);
}

/** ค่าที่ `sp_source` รับได้ — นอกรายการ = null (ข้อมูลประวัติ ไม่ใช่เหตุให้ปฏิเสธคำขอ) */
const SP_SOURCES = ['customer', 'contact', 'last_order', 'older_order', 'quotation', 'manual'] as const;
function parseSpSource(raw: unknown): (typeof SP_SOURCES)[number] | null {
  return (SP_SOURCES as readonly string[]).includes(String(raw)) ? (raw as (typeof SP_SOURCES)[number]) : null;
}

/** คีย์ที่ยาวกว่านี้ไม่มีทางมาจาก `violationKey()` — กันคนยิง payload บวมเข้ามาตรง ๆ */
const VIOLATION_KEY_MAX = 120;

/**
 * คำรับทราบที่หน้าจอส่งกลับมา — `null` = ไม่ได้ส่งมาเลย (เส้นทางเดิมก่อน 2026-09-15 ทุกเส้น)
 *
 * แยก "ไม่ส่งมา" (null) ออกจาก "ส่งมาเป็นรายการว่าง" ([]) โดยตั้งใจ แม้ผลลัพธ์วันนี้จะเท่ากัน —
 * เพราะ `blockingViolations()` อ่าน null ว่า "ไม่มีใครรับทราบอะไร" ซึ่งเป็นค่าที่ปลอดภัยที่สุด
 * และทำให้ผู้เรียกใหม่ที่ลืมส่งฟิลด์นี้ได้พฤติกรรมเดิมเป๊ะ ไม่ใช่ได้ทางที่ปล่อยผ่าน
 */
function parseAcknowledgedKeys(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) {
    throw new WebQuoteError('BAD_REQUEST', 'acknowledged_violations ต้องเป็น array ของคีย์กฎ', 400);
  }
  return raw
    .map((k) => String(k ?? '').trim())
    .filter((k) => k !== '' && k.length <= VIOLATION_KEY_MAX);
}

/**
 * กำหนดส่งที่ตั้งทับรายใบ — ใช้ตัวตรวจตัวเดียวกับ `PUT /api/quotation/:id` ของหน้า LIFF
 * (`parseDeliveryTypeOverride` / `parseDeliveryDaysOverride`) ⇒ ค่าที่หน้าหนึ่งรับ อีกหน้าก็รับ
 *
 * ใบที่ไม่รู้จักต้อง **ตอบ 400** ไม่ใช่ทิ้งเงียบ — ทิ้งเงียบแปลว่าแอดมินตั้ง 14 วันแล้วได้ใบ 3 วัน
 * โดยไม่มีอะไรบอกสักบรรทัด
 */
export function parseDeliveryOverrides(raw: any): DraftQuoteOverrides['delivery'] {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: NonNullable<DraftQuoteOverrides['delivery']> = {};
  for (const entry of raw) {
    const company = String(entry?.quote_company ?? '').trim().toUpperCase();
    if (company !== 'PM' && company !== 'THT') {
      throw new WebQuoteError('BAD_REQUEST', `ใบที่ไม่รู้จักในกำหนดส่ง: ${company || '(ว่าง)'}`, 400);
    }
    try {
      out[company] = {
        type: parseDeliveryTypeOverride(entry?.delivery_type_override) ?? null,
        days: parseDeliveryDaysOverride(entry?.delivery_days_override) ?? null,
      };
    } catch (err: any) {
      throw new WebQuoteError('BAD_REQUEST', String(err?.message || 'กำหนดส่งไม่ถูกต้อง'), 400);
    }
  }
  return out;
}

export interface WebQuoteItemInput {
  /** ชี้สินค้าด้วย product_template_id เป็นหลัก (มาจาก candidates / product-search) */
  product_template_id?: number | string | null;
  /** ทางสำรองเมื่อ client มีแต่รหัสรุ่น */
  model?: string | null;
  quantity?: number | string;
  /** ราคาต่อหน่วยที่แอดมินตั้ง — ไม่ส่ง/0 = ใช้ราคาขายของสินค้าจาก DB */
  price?: number | string | null;
  discount_1?: number | string | null;
  discount_2?: number | string | null;
  /**
   * ชื่อรายการที่แอดมินตั้งเอง — **ใช้กับบรรทัดค่าบริการเท่านั้น**
   * สินค้าจริงเอาชื่อจาก products เสมอ (ดูกติกาในหัวข้อ resolveItems)
   */
  name?: string | null;
  /**
   * หมายเหตุของบรรทัดนั้น — ขึ้นใต้ชื่อสินค้าบนใบ PDF จริง (pdfGenerator: `remarkHtml`)
   * เป็นข้อเท็จจริงของ *ใบ* ไม่ใช่ของสินค้า ⇒ client เป็นเจ้าของค่านี้ได้เต็มที่
   * ทางเดิมของ LINE ให้พิมพ์ผ่านหน้า LIFF (`quote-edit.html` ปุ่ม "📝 เพิ่มหมายเหตุ") อยู่แล้ว
   * และ snapshot รองรับทั้งขาเขียน (`buildItemSnapshots`) และขาอ่าน (`legacyItems`) มาตั้งแต่ต้น
   */
  remark?: string | null;
}

export interface CreateDraftResult {
  web_user_id: string;
  customer_id: number;
  contact_id: number;
  customer_name: string;
  quotes: any[];
  /**
   * มีค่า = ร่างชุดนี้ **ยังไม่ใช่ใบเสนอราคา** มันถูกส่งเข้าคิวอนุมัติราคาแล้วรออยู่
   * ⇒ หน้าจอห้ามยิง `/confirm` ต่อ (จะได้ 422) ให้บอกคนกดว่ารอผู้อนุมัติ
   */
  approval: {
    request_id: string;
    status: 'pending';
    items: ApprovalItem[];
    violations: Violation[];
  } | null;
}

/**
 * แปลง item ที่ฟอร์มส่งมาเป็น itemForDb — การ map ฟิลด์ใช้ `buildResolvedItem` ตัวเดียวกับทางเดิม
 *
 * ไม่รับข้อมูลสินค้าที่ client ส่งมาเป็นของจริงสักฟิลด์ — ชื่อ · brand · series · production ·
 * product_id · ราคาตั้ง ถูกอ่านใหม่จาก DB เสมอ · client กำหนดได้แค่ "จำนวน · ราคา · ส่วนลด"
 * ซึ่งเป็นสิทธิ์ของคนออกใบอยู่แล้ว
 *
 * ⚠️ **จุดเดียวที่เส้นเว็บต่างจากเส้น LINE โดยตั้งใจ: ราคาที่ตั้งเองไม่ล้างส่วนลด**
 * `buildResolvedItem` มีกติกา "พิมพ์ราคามาเอง = ราคาสุทธิ ⇒ ส่วนลดเป็น 0" ซึ่งถูกต้องสำหรับ
 * *ข้อความอิสระ* (เซลส์พิมพ์ "ราคา 650" หมายถึงสุทธิ) แต่ผิดสำหรับ *ฟอร์ม* ที่มีช่องราคาและ
 * ช่องส่วนลดแยกกันอยู่ตรงหน้า — สิ่งที่แอดมินเห็นในฟอร์มต้องเป็นสิ่งที่ถูกบันทึกเป๊ะ ไม่งั้น
 * แค่เปิดร่างที่ระบบสกัดมา (ราคาตั้ง + ลด 30%) แล้วกดสร้าง ส่วนลดจะหายไปเงียบ ๆ
 * ⇒ เรียก buildResolvedItem โดย **ไม่ส่ง price** (ให้มันคิดส่วนลดบนราคาตั้งตามปกติ)
 *   แล้วค่อยทับราคาต่อหน่วยทีหลังถ้าแอดมินตั้งมา
 */
async function resolveItems(items: WebQuoteItemInput[]): Promise<any[]> {
  const { isShippingFeeItem, loadShippingFeeConfig } = await import('./shippingFee.js');
  const shippingCfg = await loadShippingFeeConfig();
  const out: any[] = [];
  for (const [i, raw] of items.entries()) {
    const tplId = raw?.product_template_id;
    let product: any = null;

    if (tplId !== undefined && tplId !== null && String(tplId).trim() !== '') {
      product = await getProductById(Number(tplId));
    }
    if (!product) {
      const code = String(raw?.model ?? '').trim();
      if (code) {
        // findProduct ตัวเดียวกับทางเดิม — รหัสที่ฟอร์มเลือกมาแล้วเข้า Stage 1 exact ตรง ๆ
        const found = await findProduct(code);
        if (found.found && found.product) product = found.product;
      }
    }
    if (!product) {
      throw new WebQuoteError(
        'PRODUCT_NOT_FOUND',
        `ไม่พบสินค้าของรายการที่ ${i + 1} (${raw?.model ?? raw?.product_template_id ?? '-'})`,
        400
      );
    }

    const qty = Number(raw?.quantity);
    const { itemForDb } = buildResolvedItem(
      product,
      {
        quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
        discount_1: raw?.discount_1,
        discount_2: raw?.discount_2,
      },
      {}
    );

    const price = Number(raw?.price);
    if (Number.isFinite(price) && price > 0) itemForDb.price = price;

    // หมายเหตุรายบรรทัด — ตัดหัวท้ายได้ (เป็นข้อความอิสระ ไม่ใช่ชื่อที่ Odoo เอาไปจับคู่ partner)
    // ตัดความยาวกันคนวางทั้งอีเมลลงมา เพราะช่องนี้ไปโผล่บนกระดาษ A4 ที่มีที่จำกัด
    const remark = String(raw?.remark ?? '').trim();
    if (remark) itemForDb.remark = remark.slice(0, ITEM_REMARK_MAX);

    // ── ข้อยกเว้นข้อเดียวของกฎ "ชื่อสินค้ามาจาก DB เสมอ": บรรทัดค่าบริการ ──
    // สินค้าตัวนี้เป็น is_system_item ตัวเดียวที่ทุกบรรทัดใช้ร่วมกัน (model = N/A) ชื่อใน products
    // จึงเป็นแค่ "ค่าบริการ" กลาง ๆ ส่วนสิ่งที่ต้องขึ้นในใบคือชื่อที่แอดมินตั้ง (ค่าติดตั้งหน้างาน ฯลฯ)
    // ⇒ ชื่อของบรรทัดนี้เป็นข้อมูลของ *ใบ* ไม่ใช่ของ *สินค้า* · จำนวนกับส่วนลดยังถูกล็อกตามกฎ
    // เพราะ buildShippingFeeSnapshot เขียนทับด้วย fee_quantity และ 0 ทุกครั้งอยู่ดี
    if (isShippingFeeItem(itemForDb, shippingCfg)) {
      const customName = String(raw?.name ?? '').trim();
      itemForDb.name = customName || shippingCfg.defaultItemName;
      itemForDb.internal_reference = shippingCfg.productInternalReference;
      itemForDb.quantity = shippingCfg.feeQuantity;
      itemForDb.discount_1 = 0;
      itemForDb.discount_2 = 0;
      itemForDb.is_manual_service = true;
    }

    out.push(itemForDb);
  }
  return out;
}

/**
 * สร้างร่างจริงจากฟอร์มที่เคาะแล้ว
 *
 * ด่านกฎใช้ `validateQuotationItems(stage:'draft')` ตัวเดียวกับทุกเส้น และส่ง
 * `customerId`/`contactId` เข้าไปด้วย ⇒ ครอบทั้ง blacklist และเครดิตระดับลูกค้าในด่านเดียว
 * (ใน LINE ต้องแยกไปตรวจซ้ำใน resolveContactFlow เพราะตอนเรียกด่านกลางยังไม่รู้ว่าลูกค้าคือใคร
 *  — ฟอร์มรู้ตั้งแต่ต้น จึงไม่ต้องมีด่านที่สอง)
 */
export async function createDraft(params: {
  adminId: number;
  /**
   * role ของคนที่กดออกใบ — **บังคับ** เพราะทุกอย่างที่ฟังก์ชันนี้ตัดสินใจ (กฎข้อไหนทะลุได้ ·
   * ตั้งเครดิตทับได้ไหม · ออกใบในนามใครได้บ้าง) ขึ้นกับมัน · ทำเป็น optional ไม่ได้ เพราะ
   * "ไม่ส่งมา = ใช้กติกาเดิม" จะกลายเป็นช่องที่เรียกแล้วข้ามสิทธิ์ได้ทั้งชุดโดยไม่มีอะไรฟ้อง
   */
  role: Role;
  spUserId: string;
  customerId: number | string;
  contactId: number | string;
  items: WebQuoteItemInput[];
  /** id ของแถว `web_propose` ที่ฟอร์มได้มาจากขั้นก่อนหน้า — ไม่ส่งมาก็สร้างร่างได้ตามปกติ */
  proposeMsgId?: number | string | null;
  /**
   * ช่อง "ออกในนาม" ได้ค่ามาจากไหน — ข้อมูลประวัติล้วน ไม่มีผลกับการออกใบ (ด่านสิทธิ์ยังเป็น
   * assertMayActAs ตัวเดิม) · ใช้วัดว่าแต่ละขั้นของ customerSalesOwner.ts ช่วยได้จริงแค่ไหน
   * และคนเลือกทับบ่อยแค่ไหน (docs/plan-web-quote-auto-salesperson.md §3.4)
   */
  spSource?: unknown;
  /**
   * เลขที่ใบต้นทางเมื่อร่างนี้เกิดจากการ "แก้ใบเดิม" — ติดไว้ใน `customer_name` ด้วยตัวต่อสตริง
   * ตัวเดียวกับ reviseQuotation() (`appendReviseFrom`) ⇒ รูปแบบ `revise_from=` ของสองเส้นไม่เพี้ยนกัน
   *
   * มีพารามิเตอร์นี้เพราะหน้าเว็บ **ไม่เขียนใบร่างลง DB จนกว่าจะกดยืนยัน** (2026-09-14) —
   * ขั้น revise จึงส่งรายการกลับเข้าฟอร์มแล้วมาออกใบจริงที่นี่ ไม่ได้ยืนยันร่างที่ revise สร้างไว้
   */
  reviseFrom?: string | null;
  /** เครดิตที่แอดมินเขียนทับเฉพาะชุดใบนี้ — ว่าง/ไม่ส่ง = ใช้ของลูกค้า */
  paymentTermsOverride?: any;
  /** กำหนดส่งที่ตั้งเอง แยกรายใบ — ไม่ส่ง = ให้ระบบคิดเองทุกใบ */
  delivery?: WebQuoteDeliveryInput[] | null;
  /**
   * คีย์ของกฎที่คนกดรับทราบไว้ในโมดัล (`override_keys` ที่ /preview ส่งไปให้) — ไม่ส่ง = ไม่รับทราบอะไรเลย
   *
   * ⚠️ มันคือ "รับทราบข้อไหน" ไม่ใช่ "ปิดด่านตรวจ" — server ตรวจกฎใหม่เองทุกครั้งแล้วเทียบว่า
   *    ข้อที่เจอตอนนี้อยู่ในรายการนี้ครบไหม ข้อที่โผล่มาใหม่ยังปฏิเสธเหมือนเดิม (422)
   */
  acknowledgedViolations?: unknown;
  /** ชื่อผู้ใช้ของแอดมินที่กดรับทราบ — เก็บลงใบเพื่อตอบได้ย้อนหลังว่าใครเป็นคนปล่อยผ่าน */
  adminUsername?: string | null;
  /** ชื่อเต็มของแอดมิน — ขึ้นในคิวของผู้อนุมัติว่าใครเป็นคนขอ */
  adminName?: string | null;
  /**
   * หน้าจอรู้ตัวว่ากำลัง "ส่งขออนุมัติ" ไม่ใช่ "ออกใบ" — ต้องส่งมาเมื่อใบติดกฎราคาขั้นต่ำ
   *
   * มีธงนี้เพราะผลของสองอย่างต่างกันคนละเรื่องสำหรับคนกด (ได้ใบเลย vs ต้องรอคนอื่น)
   * ถ้าปล่อยให้ server เดาเอง client เก่า/สคริปต์ที่ยิงตรงจะสร้างคำขอค้างไว้โดยไม่มีใครรู้ว่ามี
   */
  requestApproval?: boolean;
  /** เหตุผลที่ขอขายต่ำกว่าขั้นต่ำ — ผู้อนุมัติอ่านอันนี้ก่อนตัดสิน */
  approvalNote?: string | null;
  /** คำขอเดิมที่ถูกตีกลับแล้วแก้มาส่งใหม่ — ร่างเก่าถูก **ทิ้ง** *หลัง* ใบใหม่สร้างสำเร็จเท่านั้น */
  replacesRequestId?: string | null;
}): Promise<CreateDraftResult> {
  if (!Array.isArray(params.items) || params.items.length === 0) {
    throw new WebQuoteError('BAD_REQUEST', 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ (items)', 400);
  }
  // id ทั้งสองตัวเป็นเลขของ customers_data_view — บังคับเป็น number ตั้งแต่ปากทาง
  // ไม่งั้นค่าที่มาจาก JSON body แบบสตริงจะไหลไปถึง insertDraftQuotations แล้วชนกับ FK ทีหลัง
  const customerIdIn = Number(params.customerId);
  const contactId = Number(params.contactId);
  if (!Number.isFinite(customerIdIn) || customerIdIn <= 0) {
    throw new WebQuoteError('BAD_REQUEST', 'ต้องระบุบริษัท (customer_id) เป็นตัวเลข', 400);
  }
  if (!Number.isFinite(contactId) || contactId <= 0) {
    throw new WebQuoteError('BAD_REQUEST', 'ต้องระบุผู้ติดต่อ (contact_id) เป็นตัวเลข', 400);
  }

  // ไม่ใช่ตัวเลข = ไม่มีการอ้างอิง ไม่ใช่ error — ร่างต้องสร้างได้แม้ log ของขั้นก่อนหน้าจะหาย
  const proposeMsgIdRaw = Number(params.proposeMsgId);
  const proposeMsgId = Number.isFinite(proposeMsgIdRaw) && proposeMsgIdRaw > 0 ? proposeMsgIdRaw : null;

  // ว่าง = ร่างปกติ ไม่ใช่ error — เส้นทางเดิมไม่ส่งฟิลด์นี้มาเลยและต้องทำงานเหมือนเดิมทุกประการ
  const reviseFrom = String(params.reviseFrom ?? '').trim().toUpperCase();

  // ตรวจค่าที่ตั้งทับก่อนแตะ DB — ค่าผิดต้องเป็น 400 ตั้งแต่ปากทาง ไม่ใช่ไปตายกลาง INSERT
  const overrides: DraftQuoteOverrides = {
    paymentTerms: parsePaymentTermsOverride(params.paymentTermsOverride),
    delivery: parseDeliveryOverrides(params.delivery),
  };
  // เครดิตที่ตั้งทับเป็นสิทธิ์ต่างหาก — ปฏิเสธเสียงดังแทนการ "เงียบ ๆ ไม่เอาค่าที่ส่งมา"
  // เพราะคนยิงต้องรู้ว่าใบที่ได้ไม่ใช่ใบที่เขาสั่ง (และมันมีผลกับกฎค่าบริการ + คิวแก้มือ Odoo ด้วย)
  await assertMayOverridePaymentTerms(params.role, overrides.paymentTerms);
  // ออกใบในนามคนอื่นไม่ได้ ถ้าไม่มีสิทธิ์ — ด่านอยู่ที่ server ไม่ใช่การซ่อน dropdown (§13.2)
  await assertMayActAs(params.adminId, params.role, params.spUserId);

  const ruleModes = await ruleModesOf(params.role);
  const webUserId = await resolveWebUserId(params.adminId, params.spUserId, params.role);

  return runQueued(webUserId, async () => {
    const startedAt = Date.now();
    let contact = await getContactById(contactId);

    // ── ผู้ติดต่อที่แอดมินเพิ่มเอง: เติมแถวกลับแล้วลองใหม่ครั้งเดียว ───────────────────
    //  ช่องว่างที่ปิดตรงนี้กว้างแค่ ~2–3 วิ แต่เจ็บจริง: ถ้ารอบ rebuild ของ customers_data_view
    //  เริ่ม `CREATE TABLE AS` ไปก่อนที่การเพิ่มผู้ติดต่อจะ commit แถวใหม่จะตกอยู่ในตารางเก่า
    //  ที่กำลังจะถูก DROP ⇒ คนที่เพิ่งเพิ่มหายไปจนกว่าจะ rebuild รอบหน้า (≤10 นาที) และ
    //  snapshot ของใบจะไม่มีชื่อผู้ติดต่อ · `ensureDirectoryRow()` idempotent อยู่แล้ว
    //  (docs/plan-local-contacts.md §3.4)
    //  ⚠️ ยิงเฉพาะเมื่อ contact_id >= 900,000,000 ⇒ ใบปกติทั้งหมดจ่าย 0 query
    if (!contact && isLocalContactId(contactId)) {
      const local = await getLocalContactById(contactId);
      if (local) {
        await ensureDirectoryRow({
          contact_id: local.contact_id,
          company_id: local.company_id,
          contact_name: local.contact_name,
          contact_phone: local.contact_phone,
          contact_email: local.contact_email,
        });
        contact = await getContactById(contactId);
      }
    }
    if (!contact) throw new WebQuoteError('BAD_REQUEST', `ไม่พบผู้ติดต่อ id=${contactId}`, 400);

    // ผู้ติดต่อที่เลือกอาจอยู่ใต้ company_id ของสาขาอื่นในนิติบุคคลเดียวกัน — ผูกใบตามบริษัทของ
    // "คนที่เลือกจริง" เสมอ (กติกาเดียวกับ resolveContactFlow) ไม่งั้นคู่ (customer_id, contact_id)
    // จะชี้แถวที่ไม่มีอยู่ ⇒ snapshot และด่านตรวจ lookup ไม่เจอ
    const resolvedCustomerId = Number(contact.customer_id ?? customerIdIn);
    const customer = await getCustomerById(resolvedCustomerId);
    if (!customer) throw new WebQuoteError('BAD_REQUEST', `ไม่พบบริษัท id=${resolvedCustomerId}`, 400);

    const itemsForDb = await resolveItems(params.items);

    const { items: expanded, violations } = await validateQuotationItems(itemsForDb, {
      stage: 'draft',
      customerName: customer.display_name,
      customerId: resolvedCustomerId,
      contactId,
    });
    // ── ด่านตรวจ: ทะลุได้ แต่เฉพาะข้อที่คนกดรับทราบไว้จริง ─────────────────────
    //  ข้อที่ยังบล็อกอยู่มีสองแบบ: (1) `SYSTEM_ERROR` ซึ่งทะลุไม่ได้ทุกกรณี
    //  (2) ข้อที่เพิ่งโผล่หลังจากคนกดรับทราบ (ของหมดระหว่างที่โมดัลเปิดค้าง) — เจ้าของเลือกไว้ว่า
    //  ให้ **ปฏิเสธและให้ดูใหม่** ไม่ใช่ปล่อยผ่านเพราะ "ก็กดยืนยันมาแล้ว"
    const acknowledgedKeys = parseAcknowledgedKeys(params.acknowledgedViolations);
    const blockers = blockingViolations(violations, acknowledgedKeys, null, ruleModes);

    // ── ราคาต่ำกว่าขั้นต่ำ: ติ๊กเองไม่ได้ ต้องเข้าคิวอนุมัติ (2026-09-15) ────────
    //  แยกกองก่อนตัดสิน เพราะสองกองนี้จบคนละแบบ:
    //    needApproval → ยังสร้างร่างได้ แต่ร่างนั้น "รออนุมัติ" และยังไม่ใช่ใบเสนอราคา
    //    hardBlockers → ปฏิเสธเหมือนเดิมทุกประการ (SYSTEM_ERROR หรือข้อที่เพิ่งโผล่)
    //  ตั้งแต่ 2026-09-18 "ข้อไหนอยู่กองไหน" ขึ้นกับ role ของคนออกใบ (ruleModes) ไม่ใช่ค่าคงที่
    //  ของทั้งระบบ — ค่าเริ่มต้นของ admin/approver/subadmin ให้ผลเท่ากับบรรทัดเดิมทุกประการ
    const needApproval = blockers.filter((v) => violationMode(v, ruleModes) === 'approval');
    const hardBlockers = blockers.filter((v) => violationMode(v, ruleModes) !== 'approval');
    if (hardBlockers.length > 0) {
      throw new WebQuoteError('RULE_VIOLATION', buildViolationText(hardBlockers), 422, { violations: hardBlockers });
    }
    if (needApproval.length > 0 && params.requestApproval !== true) {
      throw new WebQuoteError(
        'NEEDS_APPROVAL',
        `${buildViolationText(needApproval)}\n\nรายการนี้ต้องส่งให้ผู้มีสิทธิ์อนุมัติราคาก่อน จึงจะออกใบเสนอราคาได้`,
        422,
        { violations: needApproval }
      );
    }

    const plainName = `${customer.display_name} | ${contact.name}`;
    const customerName = reviseFrom ? appendReviseFrom(plainName, reviseFrom) : plainName;
    const quotes = await insertDraftQuotations(
      webUserId, customerName, expanded, 'draft', resolvedCustomerId, contactId, false, overrides
    );
    if (!quotes || quotes.length === 0) {
      throw new WebQuoteError('INSERT_FAILED', 'ไม่สามารถบันทึกข้อมูลใบเสนอราคาได้', 500);
    }

    // ── ผูก "กฎที่ทะลุ" ไว้กับใบ ไม่ใช่กับ endpoint ────────────────────────────
    //  เก็บลงแถวเพราะ `PUT /api/quotation/:id` และ `/confirm` เป็น endpoint ที่ LIFF ใช้ร่วมกัน
    //  ⇒ ถ้าไปปลดล็อกที่ endpoint ใบจาก LINE จะทะลุกฎตามไปด้วยเงียบ ๆ · เขียนหลัง COMMIT
    //  ของ insertDraftQuotations เหมือนที่ logWebEvent ทำ ด้วยเหตุผลข้อเดียวกัน
    //
    //  **เก็บ violation ที่ server คำนวณเอง ไม่ใช่ที่หน้าจอส่งมา** — สิ่งที่หน้าจอส่งมาคือ
    //  "รับทราบข้อไหน" เท่านั้น ถ้าเก็บข้อความจากหน้าจอ ใครแก้ payload ก็เขียนประวัติปลอมได้
    if (violations.length > 0) {
      const acknowledgedAt = new Date().toISOString();
      const acknowledgedBy = `admin:${params.adminUsername || params.adminId}`;
      for (const q of quotes) {
        // ใบแตกเป็น PM/THT แล้ว ⇒ ข้อของ "รายการสินค้า" ตามใบที่มีสินค้านั้นไป
        // ส่วนข้อระดับลูกค้า (blacklist / เครดิตค้าง / ตรวจไม่สำเร็จ) model = '-' ติดทั้งสองใบ
        const models = new Set((q.items || []).map((it: any) => String(it?.model ?? '')));
        const mine = violations.filter((v) => !v.model || v.model === '-' || models.has(v.model));
        if (mine.length === 0) continue;
        try {
          await saveQuotationRuleOverrides(pool, String(q.id), {
            acknowledged_by: acknowledgedBy,
            acknowledged_at: acknowledgedAt,
            // ข้อที่ต้องอนุมัติไม่ใช่ "ข้อที่คนออกใบรับทราบ" — มันปลดด้วยคีย์นี้ไม่ได้อยู่แล้ว
            // (blockingViolations มองข้าม ack ของมัน) แต่ถ้าเขียนลงไปด้วย ประวัติจะอ่านได้ว่า
            // "คนออกใบปล่อยผ่านราคาต่ำกว่าขั้นต่ำเอง" ซึ่งไม่จริงและเป็นคนละคนกับที่อนุมัติ
            acknowledged_keys: mine.filter((v) => violationMode(v, ruleModes) === 'allow').map(violationKey),
            violations: mine,
          });
        } catch (err) {
          // เขียนไม่ลงไม่ใช่เหตุให้ทิ้งร่างที่ INSERT สำเร็จไปแล้ว — ใบจะไปติดด่านตอนกดยืนยันเอง
          // (ไม่มี acknowledged_keys = ไม่มีอะไรถูกปล่อยผ่าน) ซึ่งเป็นทางที่ปลอดภัยกว่าอยู่แล้ว
          console.error('[webQuote] บันทึก rule_overrides ไม่สำเร็จ:', err);
        }
      }
    }

    // ── เปิดคำขออนุมัติราคา (ถ้ามีรายการต่ำกว่าขั้นต่ำ) ────────────────────────
    //  ทุกใบในชุด (PM/THT) ใช้ `request_id` เดียวกัน — ผู้อนุมัติกดครั้งเดียวออกทั้งชุด
    //  เพราะค่าขนส่งอัตโนมัติคิดจากยอดรวมของทุกใบในกลุ่ม ถ้าอนุมัติทีละใบจะได้สภาพ
    //  "ออกใบ PM ไปแล้ว ส่วน THT ยังรออยู่" ซึ่งอธิบายกับลูกค้าไม่ได้ (แผน §3.3)
    //
    //  ⚠️ เขียนให้ครบทุกใบก่อนคืนค่า — ใบที่พลาดไปจะไม่มีคำขอผูกอยู่ แปลว่ามันจะถูกลบทิ้ง
    //     ตอน insertDraftQuotations รอบหน้า และจะไม่โผล่ในคิวของใครเลย
    let approval: CreateDraftResult['approval'] = null;
    if (needApproval.length > 0) {
      const requestId = newApprovalRequestId();
      const approvalItems: ApprovalItem[] = buildApprovalItems(needApproval, expanded);
      for (const q of quotes) {
        const models = new Set((q.items || []).map((it: any) => String(it?.model ?? '')));
        const payload = buildApprovalPayload({
          requestId,
          actor: { id: params.adminId, username: params.adminUsername ?? null, name: params.adminName ?? null },
          violations: needApproval.filter((v) => models.has(v.model)),
          // ใบที่ไม่มีรายการต่ำกว่าขั้นต่ำก็อยู่ในคำขอด้วย (items ว่าง) — มันต้องรอออกพร้อมกัน
          items: approvalItems.filter((it) => models.has(it.model)),
          note: params.approvalNote ?? null,
        });
        await savePriceApproval(pool, String(q.id), payload);
      }
      approval = {
        request_id: requestId,
        status: 'pending',
        items: approvalItems,
        violations: needApproval,
      };

    }

    // ── ร่างของคำขอเดิมที่แก้มาส่งใหม่ — **ทิ้งทั้งแถว ไม่ใช่มาร์กว่ายกเลิก** ──────
    //  เจ้าของสั่ง 2026-09-21: "แก้แล้วส่งใหม่" คือการ *แก้ทับร่างเดิม* ไม่ใช่การยกเลิกมัน
    //  ⇒ ประวัติใบเสนอราคาต้องไม่มีแถว "ยกเลิก" ที่ไม่มีเลขที่ โผล่มาทุกครั้งที่มีคนแก้คำขอ
    //  และสถานะ `cancelled` เหลือความหมายเดียว: **มีคนกดยกเลิกจริง ๆ** (`cancelRequest`)
    //  ซึ่งตรงกับกติกาที่ระบบใช้อยู่แล้วทั้งสองเส้น — ร่างที่ยังไม่มีเลขที่ถูก DELETE
    //  (`POST /api/quotation/:id/cancel` · ปุ่มยกเลิกใน LINE) ส่วนใบที่มีเลขที่แล้วถูกมาร์ก
    //
    //  ทำ *หลัง* ใบใหม่ถูกสร้างและผูกคำขอเรียบร้อย — ถ้าทิ้งก่อนแล้วขั้นใดขั้นหนึ่งล้ม
    //  คนขอจะเหลือมือเปล่าทั้งที่ยังไม่ได้อะไรใหม่เลย
    //
    //  **อยู่นอกบล็อก `needApproval` ตั้งแต่ 2026-09-21** — แก้ราคาขึ้นจนไม่ติดขั้นต่ำแล้ว
    //  ส่งใหม่ ก็ต้องเก็บร่างเดิมเหมือนกัน ตอนที่เงื่อนไขนี้อยู่ข้างในบล็อก เคสนั้นได้ใบจริง
    //  ออกไปแล้ว **แต่คำขอที่ถูกตีกลับยังค้างอยู่ในคิวตลอดไป** โดยไม่มีปุ่มไหนปิดมันได้
    //
    //  ใครล้างได้ = ใครเปิดคำขอนี้เข้าฟอร์มได้ (`loadRequestRows`): เจ้าของคำขอ หรือคนที่มี
    //  สิทธิ์ตัดสิน · `replaces_request_id` มาจาก body ของ request ⇒ ถ้าไม่กรองเจ้าของ
    //  ใครยิง id ของคนอื่นเข้ามาก็ลบร่างที่คนอื่นรออนุมัติอยู่ได้
    const replaces = String(params.replacesRequestId ?? '').trim();
    if (replaces !== '') {
      const anyOwner = params.role ? await can(params.role, 'approval.decide') : false;
      try {
        await pool.query(
          `DELETE FROM quotations
            WHERE price_approval->>'request_id' = $1
              AND status = 'draft'
              AND quotation_no IS NULL
              AND ($2::text IS NULL OR price_approval->>'requested_by_id' = $2)`,
          [replaces, anyOwner ? null : String(params.adminId)]);
      } catch (err) {
        console.error('[webQuote] ล้างร่างของคำขอเดิมไม่สำเร็จ:', err);
      }
    }

    // ── ประวัติ: เขียน "หลัง" insertDraftQuotations คืนค่าแล้วเท่านั้น ──────────
    // ฟังก์ชันนั้นมี withTransaction อยู่ข้างใน (services/quotationService.ts) การเขียน log
    // ระหว่างนั้นคือการเรียก pool.query ในทรานแซกชัน = ผิดกฎเหล็กของ CLAUDE.md
    await logWebEvent({
      webUserId,
      type: 'web_draft',
      content: `เลือก ${customer.display_name} / ${contact.name}`,
      // รูปแบบเดียวกับสรุปร่างของ LINE (utils/flexTemplates.ts) — คง `📝 ร่างใบเสนอราคา`
      // และ `🏢 <ชื่อบริษัท>` ไว้เพื่อให้แถวนี้ใช้เป็นเฉลยของ evalCustomerSearch ได้ตรง ๆ
      replyContent:
        `📝 ร่างใบเสนอราคา\n🏢 ${customer.display_name}\n👤 ${contact.name}\n` +
        `📄 รหัสร่าง: ${quotes.map((q: any) => q.id).join(', ')}`,
      meta: {
        propose_msg_id: proposeMsgId,
        revise_from: reviseFrom || null,
        sp_source: parseSpSource(params.spSource),
        // ค่าที่คนกดตั้งทับระบบ — ต้องตอบได้ย้อนหลังว่า "เครดิตในใบนี้ไม่ตรงกับลูกค้าเพราะใคร"
        payment_terms_override: overrides.paymentTerms,
        delivery_overrides: overrides.delivery ?? null,
        // กฎที่คนกดรับทราบเพื่อออกใบทั้งที่ติดด่าน — ตอบได้ย้อนหลังว่า "ใครปล่อยผ่านข้อไหน เมื่อไหร่"
        acknowledged_violations: acknowledgedKeys,
        // คำขออนุมัติราคา — ตอบได้ย้อนหลังว่า "ใบนี้เคยถูกส่งไปขออนุมัติด้วยคำขอไหน"
        approval_request_id: approval?.request_id ?? null,
        approval_items: approval?.items ?? null,
        replaces_request_id: params.replacesRequestId ?? null,
        chosen_customer_id: resolvedCustomerId,
        chosen_contact_id: contactId,
        chosen_rank: await resolveChosenRank(proposeMsgId, resolvedCustomerId, customerIdIn),
        quote_ids: quotes.map((q: any) => String(q.id)),
        outcome: 'ok',
        duration_ms: Date.now() - startedAt,
      },
    });

    return {
      web_user_id: webUserId,
      customer_id: resolvedCustomerId,
      contact_id: contactId,
      customer_name: customerName,
      quotes,
      approval,
    };
  });
}

// ── 3) พรีวิวก่อนกดสร้างร่าง — dry-run ของ createDraft ที่ไม่เขียนอะไรลง DB เลย ─────
//
//  ทำไมต้องมี: เส้นเว็บ (ต่างจาก LINE) **ทิ้งร่างทั้งใบ** เมื่อติดกฎข้อใดข้อหนึ่ง — createDraft
//  โยน RULE_VIOLATION ก่อนถึง insertDraftQuotations ⇒ แอดมินรู้ว่าติดอะไรก็ต่อเมื่อกดปุ่มไปแล้ว
//  (ฝั่ง LINE สร้างร่างไว้ก่อนแล้วค่อยซ่อนปุ่มยืนยัน จึงไม่เจ็บเท่ากัน)
//
//  ทุกคำตอบในนี้มาจากฟังก์ชันของจริงที่เส้น LINE ใช้ — validateQuotationItems ·
//  resolveQuoteCompany · buildItemSnapshots · resolveQuotationDeliveryDays ·
//  shouldHaveShippingFee · resolveDeliveryTerms — ห้ามคิดเลขเองซ้ำแม้แต่ข้อเดียว
//  ไม่งั้นสิ่งที่แอดมินเห็นก่อนกด กับสิ่งที่ถูกบันทึกจริง จะเริ่มเพี้ยนออกจากกันโดยไม่มีใครรู้
//
//  **ไม่เรียก resolveWebUserId** โดยตั้งใจ — ensureWebProxy() เขียนแถวพร็อกซีลง salesperson
//  ซึ่งเป็นการเขียน DB · พรีวิวต้องอ่านอย่างเดียวจริง ๆ เพื่อให้คำว่า "ยังไม่บันทึกอะไร" เป็นจริง

export interface WebQuotePreviewItem {
  product_template_id: number | null;
  model: string;
  name: string;
  quantity: number;
  price: number;
  discount_1: number;
  discount_2: number;
  line_total: number;
  /** ของว่างขายได้จริง ณ ตอนพรีวิว — badge เตือนเท่านั้น server เป็นด่านจริงเสมอ */
  stock: number;
  is_optional: boolean;
  /** รุ่นของสินค้าหลักที่บรรทัดนี้พ่วงมา — null = ไม่ใช่สินค้าพ่วง */
  linked_to_model: string | null;
  is_shipping_fee: boolean;
  is_manual_service: boolean;
  warranty_display: string;
  /** คำอธิบายสินค้าที่ขึ้นใต้ชื่อบนใบจริง — มาจาก snapshot ตัวเดียวกับที่ PDF พิมพ์ */
  sales_description: string;
  /** หมายเหตุที่แอดมินพิมพ์ให้บรรทัดนี้ — ขึ้นบนใบจริงเช่นกัน */
  remark: string;
  /** ข้อกฎที่บรรทัดนี้ติด (จับคู่ด้วยรหัสรุ่น — ถ้อยคำมาจาก buildViolationDisplay ฝั่ง server) */
  violations: Violation[];
}

export interface WebQuotePreviewQuote {
  quote_company: 'PM' | 'THT';
  company_label: string;
  items: WebQuotePreviewItem[];
  subtotal: number;
  /** ข้อความที่จะขึ้นจริงบนใบ — resolve แล้ว (ค่าที่ตั้งเองชนะค่าอัตโนมัติ) */
  delivery_text: string;
  delivery_days: number;
  delivery_all_in_stock: boolean;
  /** ค่าที่ตั้งเองมากับคำขอนี้ — null = ยังใช้ค่าอัตโนมัติ */
  delivery_type_override: DeliveryTypeKey | null;
  delivery_days_override: number | null;
  /** ค่าที่ระบบคำนวณได้จากสต๊อก + กฎ ณ ตอนนี้ — ไว้ขึ้นบรรทัด "ค่าอัตโนมัติคือ …" ให้คนเทียบ */
  delivery_type_auto: DeliveryTypeKey;
  delivery_days_auto: number;
  delivery_auto_label: string;
  /**
   * ยอดท้ายใบทั้ง 5 ช่องที่จะพิมพ์บนใบจริง — คิดด้วย `quotationDocumentTotals()` ตัวเดียว
   * กับที่ pdfGenerator ใช้ ⇒ จอ "ใบร่าง" กับไฟล์ PDF ไม่มีทางได้เลขคนละชุด
   * (`discount` เป็น 0 เสมอตามที่ใบพิมพ์จริง — เหตุผลอยู่ที่ utils/pricing.ts)
   */
  totals: {
    subtotal: number;
    discount: number;
    after_discount: number;
    vat: number;
    grand_total: number;
    /** ยอดสุทธิเป็นตัวอักษรไทย — ใช้แพ็กเกจตัวเดียวกับ PDF ไม่ให้ frontend เขียนเอง */
    amount_text: string;
    /**
     * ส่วนลดที่หักไปแล้วจริง (ราคาตั้ง − ราคาหลังลดสองชั้น) — **ไม่ใช่ช่อง `discount` ของใบ**
     * ช่องบนกระดาษพิมพ์ `0.00` เสมอตามแบบฟอร์มของบริษัท ตัวนี้จึงมีไว้ให้ "แถบสรุปของแอดมิน"
     * ท้ายจอเท่านั้น (2026-09-17 เจ้าของสั่งให้สรุปยอดส่วนลดให้เห็น) — ห้ามเอาไปพิมพ์ลงใบ
     * ⇒ ส่งมาจาก `quotationDocumentTotals().discount_line` ไม่ให้หน้าจอบวกเอง
     */
    discount_total: number;
  };
  /** บรรทัด "หมายเหตุ:" ท้ายใบ — คำเดียวกับที่ PDF และไฟล์นำเข้า Odoo ใช้ */
  warranty_note: string;
  /**
   * หัวกระดาษของบริษัทผู้ขายใบนี้ (ชื่อ · ที่อยู่ · เลขผู้เสียภาษี · โลโก้ · ข้อความปิดท้าย)
   * ส่งมาให้แทนที่จะให้หน้าจอถือสำเนาของตัวเอง — ที่อยู่บริษัทต้องมีที่แก้ที่เดียวกับที่ PDF ใช้
   */
  company: CompanyProfile;
}

export interface WebQuotePreviewResult {
  customer: {
    customer_id: number;
    contact_id: number;
    display_name: string;
    reference: string;
    tax_id: string;
    /** เครดิตที่ **จะถูกบันทึกลงใบ** — คือค่าที่ตั้งทับถ้ามี ไม่ใช่ค่าของลูกค้าเสมอไป */
    payment_terms: string;
    /** เครดิตจริงของลูกค้าจาก Odoo — ไว้ให้หน้าจอบอกว่ากำลังทับค่าอะไรอยู่ */
    customer_payment_terms: string;
    payment_terms_overridden: boolean;
    /** ระบบอ่านค่าที่ใช้จริงออกว่าเป็น "มีเครดิต" ไหม (กฎค่าบริการใช้คำตอบนี้) */
    has_credit_terms: boolean;
    contact_name: string;
    contact_phone: string;
    contact_email: string;
    address: string;
  };
  quotes: WebQuotePreviewQuote[];
  /**
   * ประเภทการจัดส่งทั้งหมดที่เลือกได้ — มาจาก `DELIVERY_TYPES` ตัวจริง
   *
   * ส่งมาให้แทนที่จะให้หน้าจอถือตารางคำของตัวเอง เพราะ `utils/deliveryTerms.ts` เขียนไว้ว่า
   * คำพวกนี้ต้องตรงกับ dropdown ของ Odoo ทุกอักขระ ⇒ มีสำเนาที่สองเมื่อไหร่ก็เพี้ยนเมื่อนั้น
   */
  delivery_types: { key: DeliveryTypeKey; label: string }[];
  /** ยอดสินค้าก่อน VAT (ไม่รวมบรรทัดค่าบริการ) — ฐานเดียวกับที่กฎค่าขนส่งใช้ตัดสิน */
  goods_total: number;
  grand_total: number;
  violations: Violation[];
  /**
   * ออกใบต่อได้ไหม — ตั้งแต่ 2026-09-15 **ติดกฎไม่ได้แปลว่าออกไม่ได้อีกแล้ว**
   *
   * เจ้าของสั่งให้หน้าเว็บทะลุด่านตรวจได้ทุกข้อ ยกเว้น `SYSTEM_ERROR` ("ตรวจกฎไม่สำเร็จ")
   * ซึ่งเป็นค่าของด่าน fail-closed ที่แปลว่า *ยังไม่รู้ว่าผิดหรือไม่* ⇒ ค่านี้จึงเหลือความหมายว่า
   * "ไม่มีข้อที่ทะลุไม่ได้" ไม่ใช่ "ไม่ติดกฎเลย" · คำถามว่าติดอะไรบ้างอ่านจาก `violations`
   */
  can_create_draft: boolean;
  /**
   * รายการที่หน้าจอต้องส่งกลับมาเป็น "คำรับทราบ" ตอนกดสร้างร่าง (ดู `violationKey`)
   *
   * ส่งมาให้แทนที่จะให้หน้าจอประกอบคีย์เอง เพราะถ้าสองฝั่งประกอบคนละแบบเมื่อไหร่
   * คำรับทราบจะ "ไม่ตรงกับข้อไหนเลย" แล้ว server ปฏิเสธทั้งที่คนกดรับทราบไปแล้ว
   */
  override_keys: string[];
  /**
   * ข้อที่ role นี้ **ทะลุไม่ได้เลย** — โมดัลต้องบอกให้แก้ใบ ไม่ใช่ให้ติ๊กหรือส่งขออนุมัติ
   *
   * วันนี้ว่างเสมอสำหรับ admin/approver/subadmin (ค่าเริ่มต้นของทุกกฎคือ allow หรือ approval)
   * และ `SYSTEM_ERROR` **ไม่อยู่ในนี้** เพราะมันมี `can_create_draft` เป็นตัวบอกอยู่แล้ว
   */
  blocked_keys: string[];
  /**
   * ข้อที่ **ติ๊กรับทราบเองไม่ได้ ต้องให้ผู้อนุมัติราคาตัดสิน** (วันนี้มีแต่ราคาต่ำกว่าขั้นต่ำ)
   *
   * แยกออกมาจาก `override_keys` เพราะปุ่มบนหน้าจอเปลี่ยนความหมายไปเลยเมื่อมีข้อพวกนี้:
   * จาก "ยืนยันออกใบ" กลายเป็น "ส่งขออนุมัติราคา" — ใบจะยังไม่ถูกออกจนกว่าจะมีคนอนุมัติ
   * (docs/plan-quote-price-approval.md)
   */
  approval_required: Violation[];
  needs_approval: boolean;
  /**
   * เหตุที่ใบชุดนี้จะ **ต้องแก้มือใน Odoo ก่อนนำเข้า** — คนละแกนกับ `violations` โดยสิ้นเชิง
   *
   * กฎที่ทะลุ = ผิดกติกาของร้าน แต่ข้อมูลตรงฐาน Odoo ⇒ นำเข้าได้เลย อยู่ในไฟล์ปกติเหมือนเดิม
   * ส่วนรายการนี้ = **ค่าในไฟล์ไม่มีอยู่ในฐาน Odoo** ⇒ นำเข้าแล้วตกทั้งใบ ต้องไปสร้าง/แก้ก่อน
   *
   * คำนวณด้วย `buildOdooManualReview()` ตัวเดียวกับที่ตอนยืนยันเขียนลงคอลัมน์ `odoo_manual_review`
   * ⇒ สิ่งที่โมดัลบอกก่อนกด กับสิ่งที่ถูกบันทึกจริง มาจากฟังก์ชันเดียวกัน ไม่มีสำเนาที่สองบนหน้าจอ
   */
  odoo_manual_reasons: { kind: string; field: string; value: string | null; display_message: string }[];
  /** ค่าที่ฟอร์มต้องใช้ตอนกดปุ่ม "เพิ่มค่าบริการ" — มาจาก shipping_fee_config + products */
  service_line: {
    product_template_id: number | null;
    model: string;
    internal_reference: string;
    default_item_name: string;
    default_price: number;
    /** บรรทัดนี้มาจากกฎอัตโนมัติหรือไม่ — ถ้าใช่ แอดมินลบเองไม่ได้ ระบบถอดให้เมื่อยอดถึงเกณฑ์ */
    auto_applied: boolean;
  };
}

export interface WebQuotePreviewParams {
  customerId: number | string;
  contactId: number | string;
  items: WebQuoteItemInput[];
  /**
   * role ของคนที่กำลังดูพรีวิว — ไม่ส่งมา = กติกาเดิมของทั้งระบบ (ราคาขั้นต่ำต้องอนุมัติ ·
   * ที่เหลือติ๊กเองได้) ซึ่งเป็นค่าที่ผู้เรียกเก่าทุกตัวเคยได้อยู่แล้ว
   *
   * พรีวิวไม่เขียนอะไรลงฐาน จึงเป็นที่เดียวในเส้นนี้ที่ optional ได้โดยไม่เปิดช่องข้ามสิทธิ์ —
   * ด่านจริงอยู่ที่ createDraft ซึ่งบังคับให้ส่ง role เสมอ
   */
  role?: Role;
  /** ค่าที่แอดมินตั้งทับ — ต้องเดินทางมาถึงพรีวิวด้วย ไม่งั้นจอกับใบจริงคนละเรื่อง */
  paymentTermsOverride?: any;
  delivery?: WebQuoteDeliveryInput[] | null;
}

/**
 * ของที่ "อยู่ระหว่างทาง" ของพรีวิว — รายการดิบ + snapshot ต่อหนึ่งใบ
 *
 * ไม่ส่งออกไปหา client (หน้าจอไม่ต้องรู้ และก้อนใหญ่) แต่ **ตัวเจน PDF พรีวิวต้องใช้**
 * ⇒ ทำเป็นผลพลอยได้ของ pipeline เดิม ไม่ใช่ pipeline ที่สอง — ถ้าเขียนทางเดินคู่ขนาน
 * วันหนึ่ง PDF ที่กดดูจะไม่ใช่ใบเดียวกับที่จอโชว์ ซึ่งเป็นอาการที่ไม่มีอะไรฟ้องเลย
 */
interface PreviewArtifacts {
  byCompany: Partial<Record<'PM' | 'THT', { items: any[]; snaps: any[]; terms: DeliveryTerms }>>;
}

/** ก้อน "คู่สัญญาของใบ" ที่ทั้ง `/party` และ `/preview` คืน — รูปเดียวกันเป๊ะเพราะมาจากที่เดียวกัน */
export type WebQuoteParty = WebQuotePreviewResult['customer'];

/**
 * ── บริษัท + ผู้ติดต่อ + เครดิต ของใบ ────────────────────────────────────────────
 *
 * แยกออกมาเป็นฟังก์ชันของตัวเองเพราะหน้าจอต้องเห็นข้อมูลชุดนี้ **ตั้งแต่เลือกผู้ติดต่อเสร็จ**
 * ซึ่งเกิดก่อนจะมีรายการสินค้าสักบรรทัด ⇒ `/preview` ตอบแทนไม่ได้ (มันบังคับว่าต้องมี items
 * เพราะทั้งฟังก์ชันคือการตรวจกฎของรายการ) ก่อนหน้านี้หน้าจอจึงขึ้น "—" ที่ รหัสลูกค้า ·
 * เลขผู้เสียภาษี · ที่อยู่ · เครดิต จนกว่าจะพิมพ์สินค้าเข้าไป ทั้งที่ข้อมูลพร้อมอยู่แล้ว
 * (เจ้าของรายงาน 2026-09-21)
 *
 * ⚠️ **ห้ามประกอบก้อนนี้ซ้ำที่อื่น** — สองเส้นต้องเรียกตัวนี้ตัวเดียว ไม่งั้นวันหนึ่งเครดิต/ที่อยู่
 *    ที่เห็นก่อนใส่ของกับหลังใส่ของจะไม่ตรงกัน ซึ่งเป็นอาการที่ไม่มีอะไรฟ้องเลย
 * ⚠️ ด่านสิทธิ์ของการตั้งทับเครดิตอยู่ในนี้ด้วย ด้วยเหตุผลเดียวกับที่ `/preview` มี — จอที่ยอม
 *    ให้ตั้งทับแล้วปุ่มยืนยันตอบ 403 คือจอที่โกหก
 */
async function resolveQuoteParty(params: {
  customerId: unknown;
  contactId: unknown;
  paymentTermsOverride?: unknown;
  role?: Role | null;
}): Promise<{
  contact: any;
  customer: any;
  contactId: number;
  resolvedCustomerId: number;
  paymentTermsOverride: string | null;
  customerPaymentTerms: string;
  effectivePaymentTerms: string;
  block: WebQuoteParty;
}> {
  const customerIdIn = Number(params.customerId);
  const contactId = Number(params.contactId);
  if (!Number.isFinite(customerIdIn) || customerIdIn <= 0) {
    throw new WebQuoteError('BAD_REQUEST', 'ต้องระบุบริษัท (customer_id) เป็นตัวเลข', 400);
  }
  if (!Number.isFinite(contactId) || contactId <= 0) {
    throw new WebQuoteError('BAD_REQUEST', 'ต้องระบุผู้ติดต่อ (contact_id) เป็นตัวเลข', 400);
  }

  const contact = await getContactById(contactId);
  if (!contact) throw new WebQuoteError('BAD_REQUEST', `ไม่พบผู้ติดต่อ id=${contactId}`, 400);
  // กติกาเดียวกับ createDraft — ผูกตามบริษัทของผู้ติดต่อที่เลือกจริง ไม่ใช่ที่กดใน dropdown
  const resolvedCustomerId = Number(contact.customer_id ?? customerIdIn);
  const customer = await getCustomerById(resolvedCustomerId);
  if (!customer) throw new WebQuoteError('BAD_REQUEST', `ไม่พบบริษัท id=${resolvedCustomerId}`, 400);

  // ตรวจค่าที่ตั้งทับด้วยตัวตรวจชุดเดียวกับ createDraft — จอที่รับค่าที่ /drafts จะปฏิเสธ คือจอที่โกหก
  // เครดิตที่ใช้จริงในรอบนี้ = ค่าที่ตั้งทับ ถ้าไม่มีจึงตกมาที่ของลูกค้า
  const paymentTermsOverride = parsePaymentTermsOverride(params.paymentTermsOverride);
  if (params.role) await assertMayOverridePaymentTerms(params.role, paymentTermsOverride);
  const customerPaymentTerms = String(customer.customer_payment_terms || '');
  const effectivePaymentTerms = paymentTermsOverride ?? customerPaymentTerms;

  const { hasCreditTerms } = await import('./shippingFee.js');

  return {
    contact,
    customer,
    contactId,
    resolvedCustomerId,
    paymentTermsOverride,
    customerPaymentTerms,
    effectivePaymentTerms,
    block: {
      customer_id: resolvedCustomerId,
      contact_id: contactId,
      display_name: String(customer.display_name || ''),
      reference: String(customer.reference || ''),
      tax_id: String(customer.tax_id || ''),
      payment_terms: effectivePaymentTerms,
      customer_payment_terms: customerPaymentTerms,
      payment_terms_overridden: paymentTermsOverride !== null,
      has_credit_terms: hasCreditTerms(effectivePaymentTerms),
      contact_name: String(contact.name || ''),
      contact_phone: String(contact.phone || contact.mobile || ''),
      contact_email: String(contact.email || ''),
      address: buildThaiAddress(contact),
    },
  };
}

/**
 * ทางเข้าสาธารณะของก้อนคู่สัญญา — ใช้โดย `GET /api/admin/webquote/party` ที่หน้าจอเรียก
 * ทันทีที่เลือกบริษัท/ผู้ติดต่อครบ โดยยังไม่มีสินค้าในใบ
 */
export async function getQuoteParty(params: {
  customerId: unknown;
  contactId: unknown;
  paymentTermsOverride?: unknown;
  role?: Role | null;
}): Promise<WebQuoteParty> {
  return (await resolveQuoteParty(params)).block;
}

/** ทางเข้าสาธารณะ — คืนเฉพาะสิ่งที่หน้าจอต้องใช้ */
export async function previewDraft(params: WebQuotePreviewParams): Promise<WebQuotePreviewResult> {
  return (await previewDraftInternal(params)).result;
}

async function previewDraftInternal(
  params: WebQuotePreviewParams
): Promise<{ result: WebQuotePreviewResult; artifacts: PreviewArtifacts }> {
  if (!Array.isArray(params.items) || params.items.length === 0) {
    throw new WebQuoteError('BAD_REQUEST', 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ (items)', 400);
  }
  const customerIdIn = Number(params.customerId);
  const contactId = Number(params.contactId);
  if (!Number.isFinite(customerIdIn) || customerIdIn <= 0) {
    throw new WebQuoteError('BAD_REQUEST', 'ต้องระบุบริษัท (customer_id) เป็นตัวเลข', 400);
  }
  if (!Number.isFinite(contactId) || contactId <= 0) {
    throw new WebQuoteError('BAD_REQUEST', 'ต้องระบุผู้ติดต่อ (contact_id) เป็นตัวเลข', 400);
  }

  // โหมดกฎของคนที่กำลังดู — ไม่ส่ง role มา = null ⇒ กติกาเดิมของทั้งระบบ (ดู violationMode)
  const ruleModes: ViolationModeMap | null = params.role ? await ruleModesOf(params.role) : null;

  // บริษัท/ผู้ติดต่อ/เครดิต ทั้งก้อน รวมด่านสิทธิ์ของการตั้งทับ — ตัวเดียวกับที่ `/party` ใช้
  // (ตัวตรวจ id ซ้ำข้างบนอีกชั้นไม่เสียหาย ข้อความเดียวกันทั้งคู่)
  const party = await resolveQuoteParty({
    customerId: customerIdIn,
    contactId,
    paymentTermsOverride: params.paymentTermsOverride,
    role: params.role,
  });
  const { contact, customer, resolvedCustomerId, paymentTermsOverride, effectivePaymentTerms } = party;
  const deliveryOverrides = parseDeliveryOverrides(params.delivery);

  const {
    isShippingFeeItem, loadShippingFeeConfig, buildShippingFeeSnapshot,
    shouldHaveShippingFee, goodsSubtotal, hasCreditTerms,
  } = await import('./shippingFee.js');
  const cfg = await loadShippingFeeConfig();

  const itemsForDb = await resolveItems(params.items);
  const { items: expanded, violations } = await validateQuotationItems(itemsForDb, {
    stage: 'draft',
    customerName: customer.display_name,
    customerId: resolvedCustomerId,
    contactId,
  });

  // บรรทัดค่าบริการไม่เข้าการแบ่ง PM/THT — เหมือนที่ insertDraftQuotations ตัดออกก่อนแบ่งใบ
  const goodsItems = expanded.filter((it: any) => !isShippingFeeItem(it, cfg));
  const incomingFee = expanded.find((it: any) => isShippingFeeItem(it, cfg)) ?? null;

  // สต๊อกสด — badge เตือนเท่านั้น (CLAUDE.md: client ห้ามบล็อกจากสต็อกดิบ)
  const stockMap: Record<string, number> = {};
  const codes = goodsItems.map((it: any) => String(it.model || it.product_code || '')).filter(Boolean);
  if (codes.length > 0) {
    try {
      const { rows } = await pool.query(
        'SELECT model AS code, quantity_on_hand_unreserved AS stock FROM products WHERE model = ANY($1)',
        [codes]
      );
      for (const row of rows) {
        const n = Number(row.stock) || 0;
        if (stockMap[row.code] === undefined || n > stockMap[row.code]) stockMap[row.code] = n;
      }
    } catch (err) {
      console.error('[previewDraft] อ่านสต๊อกไม่สำเร็จ — แสดงเป็น 0 ไปก่อน', err);
    }
  }

  // รุ่นของสินค้าหลักของบรรทัดพ่วง (linked_to_product_id เก็บเป็น product_template_id)
  const modelByProductId = new Map<number, string>();
  for (const it of goodsItems) {
    const pid = Number((it as any).product_id);
    if (Number.isFinite(pid)) modelByProductId.set(pid, String((it as any).model || ''));
  }

  const byCompany: Record<'PM' | 'THT', any[]> = { PM: [], THT: [] };
  for (const it of goodsItems) {
    const company = await resolveQuoteCompany(it);
    byCompany[company === 'THT' ? 'THT' : 'PM'].push(it);
  }

  const violationsOf = (model: string) =>
    violations.filter((v) => v.model && v.model !== '-' && v.model === model);

  const toPreviewItem = (it: any, snap: any): WebQuotePreviewItem => {
    const model = String(it.model || it.product_code || '');
    const linkedId = Number(it.linked_to_product_id);
    const qty = Number(it.quantity) || 0;
    const price = Number(it.price) || 0;
    const d1 = Number(it.discount_1) || 0;
    const d2 = Number(it.discount_2) || 0;
    return {
      product_template_id: Number.isFinite(Number(it.product_id)) ? Number(it.product_id) : null,
      model,
      name: String(snap?.name || it.name || ''),
      quantity: qty,
      price,
      discount_1: d1,
      discount_2: d2,
      // สูตรเดียวกับ calcNetPrice ฝั่ง pricing — ยอดจริงที่บันทึกคิดจากฟังก์ชันนั้นเสมอ
      line_total: round2(qty * calcNetPrice(price, d1, d2)),
      stock: stockMap[model] ?? 0,
      is_optional: !!it.is_optional,
      linked_to_model: Number.isFinite(linkedId) ? (modelByProductId.get(linkedId) ?? null) : null,
      is_shipping_fee: isShippingFeeItem(it, cfg),
      is_manual_service: it.is_manual_service === true,
      warranty_display: String(snap?.warranty_display || ''),
      // snapshot มาก่อนเสมอ — เป็นค่าที่จะถูกตรึงลงใบจริง ส่วน it.* เป็นของก่อนตรึง
      sales_description: String(snap?.sales_description ?? it.sales_description ?? ''),
      remark: String(snap?.remark ?? it.remark ?? ''),
      violations: violationsOf(model),
    };
  };

  const quotes: WebQuotePreviewQuote[] = [];
  const artifacts: PreviewArtifacts = { byCompany: {} };
  for (const company of ['PM', 'THT'] as const) {
    const mine = byCompany[company];
    if (mine.length === 0) continue;

    // snapshot ตัวเดียวกับที่จะถูก freeze ลงใบจริง ⇒ กำหนดส่ง/รับประกันที่เห็นคือของจริง
    const snaps = await buildItemSnapshots(mine);
    const withStock = mine.map((it: any) => ({
      ...it,
      stock: stockMap[String(it.model || it.product_code || '')] ?? 0,
    }));
    const summary = resolveQuotationDeliveryDays(withStock, snaps);
    const autoOnly = {
      delivery_all_in_stock: summary.all_in_stock,
      delivery_days_auto: summary.days,
    };
    // ค่าที่ตั้งเองต้องผ่าน resolveDeliveryTerms ตัวเดียวกับที่ใบจริงใช้ — ลำดับความสำคัญ
    // (ตรึง > ตั้งเอง > อัตโนมัติ) เป็นของโมดูลนั้น หน้านี้ห้ามตัดสินใหม่เอง
    const typeOverride = deliveryOverrides?.[company]?.type ?? null;
    const daysOverride = deliveryOverrides?.[company]?.days ?? null;
    const terms = resolveDeliveryTerms({
      ...autoOnly,
      delivery_type_override: typeOverride,
      delivery_days_override: daysOverride,
    });
    const auto = resolveDeliveryTerms(autoOnly);
    // ใช้ withStock ไม่ใช่ mine — PDF พิมพ์คำเตือน "สินค้าคงเหลือ N pcs." จากค่านี้
    artifacts.byCompany[company] = { items: [...withStock], snaps: [...snaps], terms };

    quotes.push({
      quote_company: company,
      company_label: company === 'PM' ? 'Primus (PM)' : 'Themtech (THT)',
      items: mine.map((it: any, i: number) => toPreviewItem(it, snaps[i])),
      subtotal: 0,
      delivery_text: deliveryDisplayText(terms),
      delivery_days: terms.days,
      delivery_all_in_stock: terms.all_in_stock,
      delivery_type_override: typeOverride,
      delivery_days_override: daysOverride,
      delivery_type_auto: auto.type,
      delivery_days_auto: auto.days,
      delivery_auto_label: deliveryTypeLabel(auto.type),
      // ยอดจริงคิดหลังบรรทัดค่าบริการเข้าใบแล้ว (ดูท้ายฟังก์ชัน) — ตรงนี้เป็นที่จองไว้เฉย ๆ
      totals: { subtotal: 0, discount: 0, after_discount: 0, vat: 0, grand_total: 0, amount_text: '', discount_total: 0 },
      warranty_note: warrantyNoteText(resolveMinWarrantyDisplay(snaps)),
      company: COMPANY_PROFILES[company],
    });
  }

  // ── บรรทัดค่าบริการ: ถามกฎตัวจริง แล้ววางในใบ PM ตามที่ applyShippingFeeToQuoteGroup ทำ ──
  const goodsTotal = round2(goodsSubtotal(expanded, cfg));
  const keepFee = shouldHaveShippingFee(cfg, {
    goods: goodsTotal,
    // พรีวิวเกิดหลังแอดมินเลือกบริษัท+ผู้ติดต่อแล้วเสมอ = "ผูกลูกค้าแล้ว" ในความหมายของกฎ
    bound: true,
    // เครดิตที่ตั้งทับมีผลกับกฎนี้ด้วย (เจ้าของเลือกไว้ 2026-09-14) — ค่าเดียวกับที่จะถูก
    // บันทึกลง customer_details แล้ว applyShippingFeeToQuoteGroup อ่านซ้ำหลัง INSERT
    paymentTerms: effectivePaymentTerms,
    prevFee: incomingFee,
  });
  if (keepFee && quotes.length > 0) {
    const feeSnap = buildShippingFeeSnapshot(cfg, incomingFee ?? undefined);
    const target = quotes.find((q) => q.quote_company === 'PM') ?? quotes[0];
    target.items.push(toPreviewItem(feeSnap, feeSnap));
    // ใบเดียวกันบน PDF ต้องมีบรรทัดนี้ด้วย — feeSnap เป็นทั้ง item และ snapshot เหมือนตอน
    // insert จริง (applyShippingFeeToQuoteGroup เขียนก้อนเดียวกันลงทั้ง items และ item_details)
    const art = artifacts.byCompany[target.quote_company];
    if (art) { art.items.push(feeSnap); art.snaps.push(feeSnap); }
  }

  for (const q of quotes) {
    q.subtotal = round2(q.items.reduce((sum, it) => sum + it.line_total, 0));
    // ยอดท้ายใบคิดจาก "รายการของใบนั้น" ด้วยฟังก์ชันเดียวกับ PDF — ไม่ได้บวกจาก line_total
    // ที่ปัดรายบรรทัดมาแล้ว เพราะ PDF บวกค่าดิบก่อนค่อยปัด สองวิธีนี้ต่างกันได้ระดับสตางค์
    const t = quotationDocumentTotals(q.items);
    q.totals = {
      subtotal: round2(t.net),
      discount: t.discount_shown,
      after_discount: round2(t.net),
      vat: t.vat,
      grand_total: t.grand,
      amount_text: (ThaiBahtText as any)(t.grand),
      discount_total: round2(t.discount_line),
    };
  }
  const grandTotal = round2(quotes.reduce((sum, q) => sum + q.subtotal, 0));

  const result: WebQuotePreviewResult = {
    customer: party.block,
    quotes,
    delivery_types: DELIVERY_TYPES.map((t) => ({ key: t.key, label: t.label })),
    goods_total: goodsTotal,
    grand_total: grandTotal,
    violations,
    can_create_draft: violations.every(isBypassableViolation),
    // คำรับทราบใช้กับกฎที่ "ติ๊กเองได้" เท่านั้น — ราคาขั้นต่ำถูกตัดออกตั้งแต่ตรงนี้ เพราะมันต้อง
    // ผ่านผู้อนุมัติ ถ้ายังส่งคีย์ของมันไปให้หน้าจอ คนจะเข้าใจว่าติ๊กแล้วจบ แล้วไปเจอ 422 ตอนกด
    // ⚠️ สามกองนี้ต้องคัดด้วย `ruleModes` ชุดเดียวกับที่ createDraft จะใช้ตอนกดจริง ไม่งั้น
    //    โมดัลจะบอกว่าติ๊กได้ แล้วปุ่มยืนยันตอบ 422 — อาการที่ไม่มีใครเดาถูกว่ามาจากสิทธิ์
    override_keys: violations.filter((v) => violationMode(v, ruleModes) === 'allow').map(violationKey),
    blocked_keys: violations
      .filter((v) => isBypassableViolation(v) && violationMode(v, ruleModes) === 'deny')
      .map(violationKey),
    approval_required: violations.filter((v) => violationMode(v, ruleModes) === 'approval'),
    needs_approval: violations.some((v) => violationMode(v, ruleModes) === 'approval'),
    odoo_manual_reasons:
      buildOdooManualReview({ customer_details: { payment_terms_override: paymentTermsOverride } })?.reasons ?? [],
    service_line: {
      product_template_id: cfg.productId,
      model: cfg.productModel,
      internal_reference: cfg.productInternalReference,
      default_item_name: cfg.defaultItemName,
      default_price: cfg.feePrice,
      auto_applied: keepFee && incomingFee?.is_manual_service !== true,
    },
  };
  return { result, artifacts };
}

/**
 * PDF พรีวิวของ "ใบที่จะได้" — **ไม่เขียน DB สักแถว และไม่ออกเลขที่ใบ**
 *
 * ทำไมต้องมี: จอใบร่างเลียนแบบใบจริงได้ใกล้แค่ไหนก็ยังเป็น HTML คนละตัวกับไฟล์ที่ลูกค้าเปิด
 * ปุ่มนี้คือคำตอบสุดท้ายว่า "ของจริงหน้าตาแบบนี้" ⇒ **ต้องเจนด้วย `generateQuotationPDF()`
 * ตัวเดียวกับใบจริงเท่านั้น** ห้ามมี template ที่สองเด็ดขาด
 *
 * ของที่ยังไม่มีในขั้นร่างและจะไม่เดาให้:
 *   · เลขที่ใบ — ออกตอนยืนยันเท่านั้น (allocateQuotationNo) เอกสารจึงพิมพ์ว่า `DRAFT`
 *   · วันที่ — ใบร่างไม่มี created_at ⇒ pdfGenerator ลงวันไทยของวันนี้ ตรงกับที่จอโชว์
 *
 * ตัวตนสองคนบนหัวกระดาษอ่านแบบ **read-only** ทั้งคู่:
 *   · เซลส์ที่ออกในนาม — `getSalespersonByUserId` ไม่ใช่ `ensureWebProxy` เพราะพรีวิวต้องไม่
 *     ไปสร้างแถวพร็อกซีใน `salesperson` (เหตุผลเดียวกับที่ POST /preview ไม่รับ sp_user_id)
 *   · ผู้เสนอราคา — โปรไฟล์ของแอดมินที่ล็อกอินอยู่ (ชื่อ/เบอร์/คีย์ลายเซ็น)
 */
export async function previewQuotePdf(params: WebQuotePreviewParams & {
  adminId: number;
  /** เซลส์ที่ "ออกในนาม" — ไม่ส่งมาก็เจนได้ แค่ช่องลายเซ็นซ้ายจะว่าง */
  spUserId?: string | null;
  /** ใบไหนของคำขอนี้ — คำขอเดียวออกได้ทั้ง PM และ THT ⇒ ต้องระบุ */
  quoteCompany: string;
}): Promise<{ pdf: Buffer; filename: string; quote_company: 'PM' | 'THT' }> {
  const company = String(params.quoteCompany || '').trim().toUpperCase();
  if (company !== 'PM' && company !== 'THT') {
    throw new WebQuoteError('BAD_REQUEST', 'ต้องระบุใบที่จะพรีวิว (quote_company = PM หรือ THT)', 400);
  }

  // ออกใบในนามคนอื่นไม่ได้ ถ้าไม่มีสิทธิ์ — แม้พรีวิวจะไม่เขียน DB แต่ก็ไม่ควรให้เห็นหน้าตา
  // ใบที่ใช้ชื่อ/ลายเซ็นของรหัสอื่นที่ไม่มีสิทธิ์ออกในนาม (§13.6 ข้อ 9)
  // ⚠️ เรียกแค่ตัวตรวจสิทธิ์ ไม่เรียก resolveWebUserId/ensureWebProxy — พรีวิวต้องไม่สร้างแถวพร็อกซี
  if (params.spUserId) {
    await assertMayActAs(params.adminId, params.role, params.spUserId);
  }

  const { result, artifacts } = await previewDraftInternal(params);
  const art = artifacts.byCompany[company];
  if (!art || art.items.length === 0) {
    throw new WebQuoteError('BAD_REQUEST', `คำขอนี้ไม่มีใบของ ${company}`, 400);
  }

  const sp = params.spUserId ? await getSalespersonByUserId(String(params.spUserId)) : null;
  // role='salesperson': ไม่อ่านโปรไฟล์แอดมินเลย — ปล่อย issuer เป็น null ให้ PDF เดินเส้นเดิม
  // ของใบ LINE (ช่องขวาเดินเส้นเดิมทุกบรรทัด = ชื่อ/ลายเซ็นเดียวกับช่องพนักงานขาย §13.2)
  const issuer = params.role === 'salesperson' ? null : await getAdminIssuerProfile(params.adminId);
  const c = result.customer;

  // รูปร่างเดียวกับที่ enrichQuotationData() คืนให้ route /download-pdf — pdfGenerator อ่านจาก
  // คีย์แบน ๆ พวกนี้ล้วน ๆ ไม่ได้แตะ DB เอง ⇒ ใบร่างที่ยังไม่มีแถวในฐานจึงเจนได้ด้วยชุดเดียวกัน
  const quoteData: any = {
    id: null,
    quotation_no: '',
    created_at: null,
    customer_code: c.reference,
    customer_tax_id: c.tax_id,
    company_name: c.display_name,
    customer_name: c.display_name,
    contact_name: c.contact_name,
    contact_phone: c.contact_phone,
    contact_email: c.contact_email,
    contact_address: c.address,
    delivery_address: c.address,
    payment_terms: c.payment_terms,
    salesperson_name: sp?.name || '',
    salesperson_phone: sp?.phone || '',
    salesperson_employee_code: sp?.salesperson_id || null,
    // ไม่มีโปรไฟล์ = ยังไม่ได้ตั้งชื่อผู้จัดทำ ⇒ ช่องขวาเดินเส้นเดิมของใบ LINE (ไม่มีชื่อ ไม่มีลายเซ็น)
    issuer_name: issuer?.employee_quotation_id || null,
    issuer_phone: issuer?.employee_quotation_phone || null,
    issuer_sig_key: issuer?.signature_key || null,
    items: art.items,
    item_details: art.snaps,
    // กำหนดส่งที่ resolve แล้วจากพรีวิว — ส่งเป็นก้อน "ตรึง" เพื่อให้ PDF พิมพ์ข้อความเดียวกับจอ
    // เป๊ะ ๆ แทนที่จะให้มันไปคิดใหม่จาก snapshot แล้วมีโอกาสได้คนละคำ
    delivery_terms: {
      type: art.terms.type,
      days: art.terms.days,
      all_in_stock: art.terms.all_in_stock,
      type_source: art.terms.type_source,
      days_source: art.terms.days_source,
    },
  };

  const { generateQuotationPDF } = await import('../pdfGenerator.js');
  const pdf = Buffer.from(await generateQuotationPDF(quoteData, 'DRAFT'));
  // ชื่อไฟล์เป็น ASCII ล้วน — ค่านี้ไปลง header `Content-Disposition` และ Node **โยน
  // ERR_INVALID_CHAR ทันทีถ้ามีอักขระไทย** (เจอ 2026-09-17: route ตอบ 500 ทั้งที่ service ทำงานปกติ)
  // อยากได้ชื่อไทยให้ใส่ `filename*=UTF-8''…` ที่ฝั่ง route เพิ่ม ไม่ใช่ยัดลงตัวนี้
  return { pdf, filename: `quotation-draft-${company}`, quote_company: company };
}

/**
 * แอดมินเคาะบริษัทอันดับที่เท่าไรของสิ่งที่ระบบเรียงให้ตอน propose (§5 ของแผน)
 *
 * เทียบทั้ง `resolvedCustomerId` (บริษัทของผู้ติดต่อที่เลือกจริง ซึ่งอาจเป็นสาขาพี่น้อง) และ
 * `pickedCustomerId` (บริษัทที่กดใน dropdown) เพราะสองค่านี้ต่างกันได้ตามกติกา resolveContactFlow
 * — เจอค่าใดค่าหนึ่งก็ถือว่าระบบเสนอถูกแล้ว
 *
 * คืน `null` เมื่อ: ไม่มี propose_msg_id · อ่าน meta ไม่ได้ · หรือ **ไม่เจอในรายการที่เสนอไป**
 * กรณีสุดท้ายคือข้อมูลที่มีค่าที่สุดของตารางนี้ — แปลว่าแอดมินต้องไปค้นเพิ่มเอง
 */
async function resolveChosenRank(
  proposeMsgId: number | null,
  resolvedCustomerId: number,
  pickedCustomerId: number
): Promise<number | null> {
  if (proposeMsgId == null) return null;
  const meta = await getMessageMetaById(proposeMsgId);
  const list: any[] = Array.isArray(meta?.cust_candidates) ? meta.cust_candidates : [];
  const hit = list.find(
    (c: any) => Number(c?.id) === resolvedCustomerId || Number(c?.id) === pickedCustomerId
  );
  return hit ? Number(hit.rank) : null;
}

// ── 5) revise ────────────────────────────────────────────────────────────────

export interface ReviseResult {
  web_user_id: string;
  /**
   * เซลส์ที่ใบ revision นี้ออกในนาม — หน้าจอเอาไปตั้งช่อง "ออกในนาม" ต่อ ไม่งั้นกดออกใบจริง
   * จะไปคนละคู่ (แอดมิน × เซลส์) กับร่างที่เพิ่งสร้าง
   */
  sp_user_id: string;
  /** id ของ "ร่าง" ที่เพิ่งสร้าง — ฟอร์มเปิดใบนี้ต่อในหน้าเดิม */
  draft_quote_id: string;
  /** เลขที่ใบต้นทางที่กำลังแก้ */
  revise_from: string;
  quotes: any[];
}

/**
 * ทำ revision ของใบที่ยืนยันแล้ว — เดินลำดับเดียวกับ handleQuotationEditRequest() เป๊ะ
 * (loadActiveQuotation → validateQuotationItems → ยกเลิกร่างค้าง → insertDraftQuotations)
 * ต่างกันแค่ **คืน id ของร่าง แทนที่จะคืน Flex**
 *
 * ⚠️ ลำดับ "ตรวจกฎก่อนยกเลิกร่างค้าง" ห้ามสลับ — ถ้าตรวจทีหลังแล้วติดกฎ ร่างที่แอดมิน
 *    ทำค้างไว้จะถูกทิ้งไปฟรี ๆ ทั้งที่ทำอะไรต่อไม่ได้เลย
 */
export async function reviseQuotation(params: {
  adminId: number;
  /**
   * ไม่ส่งมา = กติกาเดิมของกฎ (กัน SYSTEM_ERROR อย่างเดียว) ผู้เรียกเก่าทุกตัวได้ผลเท่าเดิม
   * ⚠️ **ด่านออกใบในนามคนอื่น (assertMayActAs) ยังบังคับใช้เสมอไม่ว่าจะส่ง role มาหรือไม่**
   *    (§13.6 ข้อ 9) — ไม่ส่ง role มาจะตกไปที่ด่านที่เข้มที่สุด (ต้องเป็นรหัสของตัวเองเท่านั้น)
   */
  role?: Role;
  /**
   * ว่างได้ (2026-09-24) เฉพาะ role ที่เลือกเซลส์คนไหนก็ได้ ⇒ ใช้ **เซลส์ของใบต้นทาง**
   * (เจ้าของเคาะ: แก้ใบเดิมให้คงเซลส์ของใบเดิมไว้) · ส่งมา = คนเลือกทับเอง ใช้ค่านั้นตามเดิม
   */
  spUserId?: string | null;
  quotationNo: string;
}): Promise<ReviseResult> {
  const quoteNo = String(params.quotationNo ?? '').trim().toUpperCase();
  if (quoteNo === '') throw new WebQuoteError('BAD_REQUEST', 'ต้องระบุเลขที่ใบเสนอราคา (quotation_no)', 400);

  let spUserId = String(params.spUserId ?? '').trim();
  if (spUserId === '') {
    await assertMayProposeWithoutSalesperson(params.role);
    spUserId = await salespersonOfQuotation(quoteNo);
  }

  // ออกใบ (revision) ในนามคนอื่นไม่ได้ ถ้าไม่มีสิทธิ์ — เส้นนี้เขียนร่างจริงลง DB (§13.6 ข้อ 9)
  await assertMayActAs(params.adminId, params.role, spUserId);
  const webUserId = await resolveWebUserId(params.adminId, spUserId, params.role);

  return runQueued(webUserId, async () => {
    const startedAt = Date.now();
    const active = await loadActiveQuotation(quoteNo);
    if (!active) {
      throw new WebQuoteError('QUOTATION_NOT_FOUND', `ไม่พบใบเสนอราคาเลขที่ "${quoteNo}" ในระบบ`, 404);
    }
    if (!active.quotation_no) {
      throw new WebQuoteError(
        'QUOTATION_NOT_CONFIRMED',
        'ใบเสนอราคานี้ยังเป็นร่าง (ยังไม่มีเลขที่ยืนยัน) จึงยังแก้ไขแบบ revision ไม่ได้',
        400
      );
    }

    const { items: revExpanded, violations } = await validateQuotationItems(active.items, {
      stage: 'draft', customerId: active.customer_id, contactId: active.contact_id
    });
    // ร่างที่ได้จากขั้นนี้ยัง **ออกใบไม่ได้** ด้วยตัวมันเอง — มันถูกโยนกลับเข้าฟอร์มให้แอดมินแก้ต่อ
    // แล้วไปออกใบจริงที่ createDraft ซึ่งมีโมดัลรับทราบอยู่แล้ว ⇒ ที่นี่ไม่ต้องขอคำรับทราบซ้ำ
    // ปล่อยผ่านได้ แต่ **ยังกัน `SYSTEM_ERROR` ไว้** เพราะ "ตรวจกฎไม่สำเร็จ" แปลว่ายังไม่รู้ว่าผิดไหม
    // ⇒ ยกใบที่ยังไม่ได้ตรวจจริงเข้าฟอร์ม คือการพาคนไปกดยืนยันบนข้อมูลที่ไม่มีใครตรวจ
    // ตั้งแต่ 2026-09-18 กฎที่ role นี้ถูกปิดไว้ (`deny`) ก็ถูกกันตรงนี้ด้วย — ไม่ใช่เพื่อความ
    // ปลอดภัย (createDraft กันอยู่แล้ว) แต่เพื่อไม่ให้คนแก้ใบทั้งใบเสร็จแล้วค่อยเจอว่ากดออกไม่ได้
    // `violationMode` ที่ไม่มี ruleModes ตอบ 'deny' เฉพาะ SYSTEM_ERROR ⇒ ค่าเดิมเป๊ะ
    const revRuleModes = params.role ? await ruleModesOf(params.role) : null;
    const revBlockers = violations.filter((v) => violationMode(v, revRuleModes) === 'deny');
    if (revBlockers.length > 0) {
      throw new WebQuoteError('RULE_VIOLATION', buildViolationText(revBlockers), 422, { violations: revBlockers });
    }

    // ร่างที่ค้างของ "คู่ (แอดมิน × เซลส์) นี้" ถูกเก็บกวาดโดย insertDraftQuotations ข้างล่าง
    // ซึ่ง **DELETE** ด้วยขอบเขตเดียวกันเป๊ะ (`user_id` + สามสถานะ + `price_approval IS NULL`)
    // อยู่ในทรานแซกชันเดียวกับ INSERT ⇒ ที่นี่ไม่ต้องทำอะไรอีก
    //
    // เคยมี `UPDATE … SET status = 'cancelled'` ยืนอยู่ตรงนี้ **ถอดออก 2026-09-21** เพราะมันไม่ได้
    // ซ้ำซ้อนเฉย ๆ แต่ทำให้ตัวเก็บกวาดข้างล่างหาไม่เจอ (แถวไม่ใช่ `draft` แล้ว) ⇒ ทุกครั้งที่มีคน
    // กดแก้ใบ จะมีแถว "ยกเลิก" ที่ไม่มีเลขที่ตกค้างในประวัติใบเสนอราคาหนึ่งแถวเสมอ
    // และยังเสียทางถอยด้วย: ถ้า INSERT ล้ม ร่างเดิมถูกยกเลิกไปแล้วฟรี ๆ ส่วน DELETE ใน
    // ทรานแซกชันจะ rollback คืนให้เอง

    const quotes = await insertDraftQuotations(
      webUserId,
      appendReviseFrom(active.customer_name, active.quotation_no),
      revExpanded,
      'draft',
      active.customer_id,
      active.contact_id
    );
    if (!quotes || quotes.length === 0) {
      throw new WebQuoteError('INSERT_FAILED', 'ไม่สามารถเตรียมใบเสนอราคาเพื่อแก้ไขได้', 500);
    }

    // นอกทรานแซกชันของ insertDraftQuotations แล้ว — เหตุผลเดียวกับใน createDraft()
    await logWebEvent({
      webUserId,
      type: 'web_revise',
      content: `แก้ไข ${active.quotation_no}`,
      replyContent:
        `📝 ร่างใบเสนอราคา\n🏢 ${active.customer_name}\n` +
        `📄 รหัสร่าง: ${quotes[0].id} (แก้จาก ${active.quotation_no})`,
      meta: {
        revise_from: active.quotation_no,
        draft_quote_id: String(quotes[0].id),
        chosen_customer_id: active.customer_id ?? null,
        chosen_contact_id: active.contact_id ?? null,
        outcome: 'ok',
        duration_ms: Date.now() - startedAt,
      },
    });

    return {
      web_user_id: webUserId,
      sp_user_id: spUserId,
      draft_quote_id: String(quotes[0].id),
      revise_from: active.quotation_no,
      quotes,
    };
  });
}

// ── รายชื่อ "ออกในนาม" ───────────────────────────────────────────────────────

/**
 * รายชื่อเซลส์ที่เลือกเป็น "ออกในนาม" ได้ — ตัวเดียวกับที่เฟส B เขียนไว้ (พก sig_url มาด้วย
 * ตั้งแต่เฟส D เพื่อให้หน้าเว็บพรีวิวลายเซ็นได้ก่อนออกใบ) · ห่อไว้ที่นี่เพื่อให้ route ของ
 * กลุ่ม webquote อ่านจากไฟล์เดียวกันทั้งเฟส
 *
 * ต่อชั้น "ยุบชื่อ/รหัสซ้ำ" ของ services/salespersonPicker.ts ไว้ที่นี่ (ไม่ใช่ใน
 * listActingSalespersons) เพื่อให้เส้น LINE และด่าน diag:pdf-issuer เห็นแถวดิบเหมือนเดิม
 * — คนเดียวที่เห็นรายชื่อยุบแล้วคือ dropdown ของหน้าเว็บ
 */
export async function listSalespersonsForWeb(): Promise<PickedSalesperson[]> {
  return dedupeActingSalespersons(await listActingSalespersons());
}

// ── เติม "ออกในนาม" ให้เอง — ตรรกะอยู่ที่ services/customerSalesOwner.ts ─────────
//  ส่งรายชื่อ dropdown ตัวเดียวกับ GET /salespersons เข้าไป ⇒ คำตอบเป็นตัวเลือกที่มีอยู่จริงเสมอ

/** เซลส์เจ้าของบริษัทนี้ (ใบใหม่) — หาไม่เจอไม่ throw แต่คืนสถานะบอกเหตุผล (throw เฉพาะ id ผิดรูป) */
export async function getCustomerSalesOwner(customerId: unknown): Promise<SalesOwner> {
  const id = Number(customerId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new WebQuoteError('BAD_REQUEST', 'ต้องระบุ customer_id', 400);
  }
  return resolveCustomerSalesOwner(id, await listSalespersonsForWeb());
}

/**
 * เซลส์ของใบต้นทาง (แก้ใบเดิม) — คืน `user_id` ที่ใช้เป็น `sp_user_id` ได้ทันที
 *
 * หาไม่ได้ **ไม่เดาแทน** (ไม่ถอยไปใช้เซลส์ของลูกค้าวันนี้ หรือคนที่เลือกล่าสุด) — ใบ revision
 * คือใบเดิมที่ลูกค้าถืออยู่ ผู้ลงนามต้องไม่เปลี่ยนเงียบ ๆ ⇒ ตอบ 400 ให้คนเลือกเองแล้วกดใหม่
 */
async function salespersonOfQuotation(quoteNo: string): Promise<string> {
  const active = await loadActiveQuotation(quoteNo);
  if (!active) {
    throw new WebQuoteError('QUOTATION_NOT_FOUND', `ไม่พบใบเสนอราคาเลขที่ "${quoteNo}" ในระบบ`, 404);
  }
  const owner = await resolveQuotationSalesOwner(active.user_id, await listSalespersonsForWeb());
  if (owner.status === 'resolved') return owner.user_id;
  const who = owner.status === 'inactive' && owner.odoo_name ? ` (${owner.odoo_name})` : '';
  throw new WebQuoteError(
    'SALESPERSON_REQUIRED',
    `เซลส์ของใบเดิม${who}ไม่อยู่ในรายชื่อที่ออกใบในนามได้แล้ว — เลือกพนักงานขายที่จะออกในนามก่อน แล้วกดแก้ไขอีกครั้ง`,
    400,
    { owner }
  );
}

// ── รายการเครดิตสำหรับช่อง "เขียนทับเครดิต" ──────────────────────────────────

/** อายุแคช — เทอมใหม่จาก Odoo โผล่ช้าได้ 5 นาที แต่ห้ามยิง GROUP BY 82k แถวทุกครั้งที่เปิดหน้า */
const PAYMENT_TERMS_TTL_MS = 5 * 60_000;
let paymentTermsCache: { at: number; rows: { value: string; count: number }[] } | null = null;

/**
 * ตัวเลือกเครดิตที่ "มีจริง" — คนละเรื่องกับ "เครดิตที่ระบบนับว่าเป็นเครดิต"
 *
 * ⚠️ รายการนี้รวม `Cash` / `Immediate Payment` ด้วย ซึ่ง `hasCreditTerms()` ตอบว่า *ไม่มี*
 *    เครดิต — และนั่นถูกแล้ว เพราะแอดมินต้องเลือก "ลูกค้ารายนี้จ่ายสด" ได้เหมือนกัน
 *    ⇒ ห้ามกรองรายการนี้ด้วย hasCreditTerms() เด็ดขาด
 *
 * ล้มแล้วคืนรายการว่าง ไม่ throw — ช่องนี้เป็นของเสริม หน้าจอต้องยังกรอกใบได้ถ้ามันหาย
 */
export async function listPaymentTermOptions(): Promise<{ value: string; count: number }[]> {
  if (paymentTermsCache && Date.now() - paymentTermsCache.at < PAYMENT_TERMS_TTL_MS) {
    return paymentTermsCache.rows;
  }
  const rows = await listCustomerPaymentTerms();
  // ว่างเปล่า = query ล้ม (ฐานจริงไม่มีทางไม่มีเครดิตสักค่า) ⇒ อย่าแคชความล้มเหลวไว้ 5 นาที
  if (rows.length > 0) paymentTermsCache = { at: Date.now(), rows };
  return rows;
}

export type { Violation };
