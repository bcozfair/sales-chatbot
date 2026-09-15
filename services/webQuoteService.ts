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
  getCustomerById, getContactById, getSalespersonByUserId,
  insertMessage, getMessageMetaById, listCustomerPaymentTerms,
  saveQuotationRuleOverrides,
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
  type Violation,
  type DraftQuoteOverrides,
} from './quotationService.js';
import {
  resolveDeliveryTerms, deliveryDisplayText, deliveryTypeLabel,
  parseDeliveryTypeOverride, DELIVERY_TYPES, type DeliveryTypeKey,
} from '../utils/deliveryTerms.js';
import { buildThaiAddress } from '../utils/address.js';
import { round2, calcNetPrice } from '../utils/pricing.js';
import { loadActiveQuotation } from './quotationAgent.js';
import { appendReviseFrom } from '../utils/flexTemplates.js';
import {
  ensureWebProxy,
  getAdminIssuerProfile,
  listActingSalespersons,
} from './webIdentity.js';
import { dedupeActingSalespersons, type PickedSalesperson } from './salespersonPicker.js';

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
  | 'BAD_REQUEST'
  | 'QUOTATION_NOT_FOUND'
  | 'QUOTATION_NOT_CONFIRMED'
  | 'PRODUCT_NOT_FOUND'
  | 'RULE_VIOLATION'
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
 */
export async function resolveWebUserId(adminId: number, spUserId: string): Promise<string> {
  const sp = String(spUserId ?? '').trim();
  if (sp === '') throw new WebQuoteError('BAD_REQUEST', 'ต้องระบุเซลส์ที่จะออกใบในนาม (sp_user_id)', 400);

  const profile = await getAdminIssuerProfile(adminId);
  if (!profile) throw new WebQuoteError('ADMIN_NOT_FOUND', `ไม่พบแอดมิน id=${adminId}`, 404);
  if (!profile.employee_quotation_id) {
    throw new WebQuoteError(
      'MAKER_NOT_SET',
      'ยังไม่ได้ตั้งชื่อผู้เสนอราคา/ผู้จัดทำ — ตั้งค่าที่แถบโปรไฟล์ก่อนออกใบ',
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
  spUserId: string;
  text: string;
}): Promise<ProposeResult> {
  const text = String(params.text ?? '').trim();
  if (text === '') throw new WebQuoteError('BAD_REQUEST', 'ต้องมีข้อความที่จะสกัด (text)', 400);

  const webUserId = await resolveWebUserId(params.adminId, params.spUserId);

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
    const realSp = await getSalespersonByUserId(String(params.spUserId).trim());
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
}

export interface CreateDraftResult {
  web_user_id: string;
  customer_id: number;
  contact_id: number;
  customer_name: string;
  quotes: any[];
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
  spUserId: string;
  customerId: number | string;
  contactId: number | string;
  items: WebQuoteItemInput[];
  /** id ของแถว `web_propose` ที่ฟอร์มได้มาจากขั้นก่อนหน้า — ไม่ส่งมาก็สร้างร่างได้ตามปกติ */
  proposeMsgId?: number | string | null;
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

  const webUserId = await resolveWebUserId(params.adminId, params.spUserId);

  return runQueued(webUserId, async () => {
    const startedAt = Date.now();
    const contact = await getContactById(contactId);
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
    const blockers = blockingViolations(violations, acknowledgedKeys);
    if (blockers.length > 0) {
      throw new WebQuoteError('RULE_VIOLATION', buildViolationText(blockers), 422, { violations: blockers });
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
            acknowledged_keys: mine.filter(isBypassableViolation).map(violationKey),
            violations: mine,
          });
        } catch (err) {
          // เขียนไม่ลงไม่ใช่เหตุให้ทิ้งร่างที่ INSERT สำเร็จไปแล้ว — ใบจะไปติดด่านตอนกดยืนยันเอง
          // (ไม่มี acknowledged_keys = ไม่มีอะไรถูกปล่อยผ่าน) ซึ่งเป็นทางที่ปลอดภัยกว่าอยู่แล้ว
          console.error('[webQuote] บันทึก rule_overrides ไม่สำเร็จ:', err);
        }
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
        // ค่าที่คนกดตั้งทับระบบ — ต้องตอบได้ย้อนหลังว่า "เครดิตในใบนี้ไม่ตรงกับลูกค้าเพราะใคร"
        payment_terms_override: overrides.paymentTerms,
        delivery_overrides: overrides.delivery ?? null,
        // กฎที่คนกดรับทราบเพื่อออกใบทั้งที่ติดด่าน — ตอบได้ย้อนหลังว่า "ใครปล่อยผ่านข้อไหน เมื่อไหร่"
        acknowledged_violations: acknowledgedKeys,
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

export async function previewDraft(params: {
  customerId: number | string;
  contactId: number | string;
  items: WebQuoteItemInput[];
  /** ค่าที่แอดมินตั้งทับ — ต้องเดินทางมาถึงพรีวิวด้วย ไม่งั้นจอกับใบจริงคนละเรื่อง */
  paymentTermsOverride?: any;
  delivery?: WebQuoteDeliveryInput[] | null;
}): Promise<WebQuotePreviewResult> {
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

  const contact = await getContactById(contactId);
  if (!contact) throw new WebQuoteError('BAD_REQUEST', `ไม่พบผู้ติดต่อ id=${contactId}`, 400);
  // กติกาเดียวกับ createDraft — ผูกตามบริษัทของผู้ติดต่อที่เลือกจริง ไม่ใช่ที่กดใน dropdown
  const resolvedCustomerId = Number(contact.customer_id ?? customerIdIn);
  const customer = await getCustomerById(resolvedCustomerId);
  if (!customer) throw new WebQuoteError('BAD_REQUEST', `ไม่พบบริษัท id=${resolvedCustomerId}`, 400);

  // ตรวจค่าที่ตั้งทับด้วยตัวตรวจชุดเดียวกับ createDraft — พรีวิวที่รับค่าที่ /drafts จะปฏิเสธ
  // คือพรีวิวที่โกหก · เครดิตที่ใช้จริงในรอบนี้ = ค่าที่ตั้งทับ ถ้าไม่มีจึงตกมาที่ของลูกค้า
  const paymentTermsOverride = parsePaymentTermsOverride(params.paymentTermsOverride);
  const deliveryOverrides = parseDeliveryOverrides(params.delivery);
  const customerPaymentTerms = String(customer.customer_payment_terms || '');
  const effectivePaymentTerms = paymentTermsOverride ?? customerPaymentTerms;

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
      violations: violationsOf(model),
    };
  };

  const quotes: WebQuotePreviewQuote[] = [];
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
  }

  for (const q of quotes) q.subtotal = round2(q.items.reduce((sum, it) => sum + it.line_total, 0));
  const grandTotal = round2(quotes.reduce((sum, q) => sum + q.subtotal, 0));

  return {
    customer: {
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
    quotes,
    delivery_types: DELIVERY_TYPES.map((t) => ({ key: t.key, label: t.label })),
    goods_total: goodsTotal,
    grand_total: grandTotal,
    violations,
    can_create_draft: violations.every(isBypassableViolation),
    override_keys: violations.filter(isBypassableViolation).map(violationKey),
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
  spUserId: string;
  quotationNo: string;
}): Promise<ReviseResult> {
  const quoteNo = String(params.quotationNo ?? '').trim().toUpperCase();
  if (quoteNo === '') throw new WebQuoteError('BAD_REQUEST', 'ต้องระบุเลขที่ใบเสนอราคา (quotation_no)', 400);

  const webUserId = await resolveWebUserId(params.adminId, params.spUserId);

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
    const revBlockers = violations.filter((v) => !isBypassableViolation(v));
    if (revBlockers.length > 0) {
      throw new WebQuoteError('RULE_VIOLATION', buildViolationText(revBlockers), 422, { violations: revBlockers });
    }

    // ยกเลิกร่างที่ค้างของ "คู่ (แอดมิน × เซลส์) นี้เท่านั้น" — ไม่แตะร่างของเซลส์ตัวจริง
    // และไม่แตะร่างที่แอดมินคนเดียวกันทำค้างไว้ในนามเซลส์คนอื่น
    try {
      await pool.query(
        "UPDATE quotations SET status = 'cancelled' WHERE user_id = $1 AND status = ANY($2)",
        [webUserId, ['pending_company', 'pending_contact', 'draft']]
      );
    } catch (err) {
      console.error('[webQuote] cancel pending drafts error:', err);
    }

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
