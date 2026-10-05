/**
 * บทสนทนาของ request — ก้อนข้อมูลที่หน้าบันทึกแสดง (เฟส 2 ของ docs/plan-message-log-merge.md)
 *
 * 1 ก้อน (`ChatExchange`) = 1 event ของ LINE หรือ 1 แถว `web_*` ของหน้าเว็บ · ไทม์ไลน์ของ request
 * กับชิปในตาราง API logs ใช้ก้อนเดียวกัน (แท็บ "บทสนทนา" ในอนาคตก็ต้องใช้ตัวนี้)
 *
 * ## สิทธิ์ — ตัดที่นี่ที่เดียว (เจ้าของเลือกทาง ก 2026-10-05)
 * route ทั้งหมดอยู่หลัง `requireCapability('page.traffic')` ที่ index.ts · ช่องนั้นเปิดให้ role อื่นได้
 * ⇒ admin = เห็นเนื้อ · role อื่น = ได้แค่ "มีข้อความ · ชนิด · ผลการส่ง · error ของ LINE"
 * **server ไม่ส่งเนื้อออกไปเลย** ไม่ใช่ส่งแล้วให้จอซ่อน: ไม่ใช่ admin = repository ไม่ SELECT คอลัมน์เนื้อ
 * และก้อนไม่มีคีย์ `content` (สองชั้น — ด่าน diag:log-chat ข้อ 2 ไล่ทุก role)
 * เนื้อ = ข้อความที่เซลส์พิมพ์ · data ของปุ่ม + คำแปล · คำตอบของบอท · สิ่งที่ LINE รับไป · ข้อความในหน้าเว็บ
 *
 * ## ผลการส่ง — อ่านจาก reply_status / redelivery_action เท่านั้น
 * `outcome = 'replied'` แปลว่า "งานจบ" ไม่ใช่ "ส่งถึง" (ทางสำรองท้าย handleEvent กลืน error ของ replyMessage)
 * ⇒ ห้ามใช้ outcome ตัดสินช่องนี้ · แถวของ handler ใน messages บันทึก **ก่อนส่ง** = คำตอบที่ตั้งใจส่ง
 * ไม่ใช่หลักฐานว่าถึง (หน้าจอติดป้าย "บันทึกก่อนส่ง" ทุกครั้ง)
 *
 * ## ทางที่ไม่ได้เลือก
 * - ตัดเนื้อที่หน้าจอ — ข้อมูลออกจาก server ไปแล้ว ใครเปิด devtools ก็เห็น
 * - จับคู่แถวหน้าเว็บกับ request ด้วยเวลา — แอดมินคนเดียวเปิดสองแท็บได้ ⇒ เขียน `meta.api_request_id` แทน
 *   (คีย์ไม่ใช่ `request_id` เพราะแถว `web_approval_*` ใช้ชื่อนั้นเก็บเลขคำขออนุมัติอยู่แล้ว)
 */
import type { Role } from '../config/auth.js';
import type { DbExecutor } from '../config/db.js';
import {
  listChatRowsForRequests,
  type ChatEventRow, type ChatLineMessageRow, type ChatRows, type ChatWebMessageRow,
} from '../db/logRepositories.js';
import { isWebhookFillType } from '../db/messageKinds.js';
import { NO_REPLY_TEXT } from './webhookRecorder.js';
import { postbackLabel } from '../utils/postbackLabel.js';

/** รูปของ request_id ใน api_logs (config/apiLogger.ts) — ตัวเดียวกับที่ route /request/:id ตรวจ */
export const REQUEST_ID_RE = /^[0-9a-f]{16}$/;
/** หนึ่งหน้าของตาราง API logs มีได้ถึง 200 แถว */
export const MAX_CHAT_REQUEST_IDS = 200;

/** ใครเห็นเนื้อแชท — ที่เดียวของทั้งระบบ */
export function canReadChatContent(role: Role | string | null | undefined): boolean {
  return role === 'admin';
}

export type ChatDelivery =
  | 'sent' | 'failed' | 'pending' | 'none'   // reply_status
  | 'warned' | 'warn_failed'                 // redelivery_action ของตัวส่งซ้ำ
  | 'web'                                    // หน้าเว็บ ไม่มีขั้นส่ง
  | 'nodata';                                // ไม่มีบันทึกผล (ก่อนติดตั้งตัวบันทึก · ไม่ผ่านคิว · รูปภาพ · ยังรอผล)

const PROBLEMS: ReadonlySet<ChatDelivery> = new Set(['failed', 'pending', 'none', 'warn_failed']);

/** "บอทส่งไม่ถึง" — ต้องตรงกับ UNDELIVERED_EVENT_SQL ทุกกรณี (ด่าน diag:log-chat ข้อ 3) */
export function isDeliveryProblem(status: ChatDelivery): boolean {
  return PROBLEMS.has(status);
}

/**
 * ผลการส่งของหนึ่ง event — ลำดับเงื่อนไขคือความหมาย:
 *   1. แจ้งเซลส์ให้ส่งใหม่ไม่สำเร็จ → warn_failed (แม้รอบแรกจะ sent ก็ยังต้องมีคนตาม)
 *   2. มี reply_status            → ค่านั้น (ของรอบที่ผ่านคิว)
 *   3. ตัวส่งซ้ำที่แจ้งสำเร็จ        → warned (รอบแรกไม่เคยผ่านคิว ⇒ ไม่มี reply_status)
 *   4. อื่น ๆ                     → nodata
 */
export function deliveryOf(ev: Pick<ChatEventRow, 'reply_status' | 'redelivery_action'>): ChatDelivery {
  if (ev.redelivery_action === 'warn_failed') return 'warn_failed';
  const rs = ev.reply_status;
  if (rs === 'sent' || rs === 'failed' || rs === 'pending' || rs === 'none') return rs;
  if (ev.redelivery_action === 'warned') return 'warned';
  return 'nodata';
}

export type ChatKind = 'text' | 'postback' | 'sticker' | 'image' | 'other' | 'event' | 'web';

export interface ChatReply {
  /** handler = แถวที่ handleEvent เขียนก่อนส่ง · fill = แถวเติม (สิ่งที่ส่งถึงจริง) · web = ผลบนหน้าเว็บ */
  source: 'handler' | 'fill' | 'web';
  text: string;
  /** แถวเติมของงานที่ไม่ได้ส่งอะไรกลับ (`[บอทไม่ได้ตอบ]`) — จอแสดงเป็นประโยค */
  no_reply: boolean;
  at: string;
}

/** เนื้อแชท — มีเฉพาะผู้ที่ canReadChatContent() */
export interface ChatContent {
  /** คำที่โชว์ของขาเข้า: ข้อความที่พิมพ์ · คำแปลของปุ่ม · ข้อความในหน้าเว็บ · null = ไม่มีบันทึก */
  in_text: string | null;
  /** data ดิบของปุ่ม (postback) */
  raw: string | null;
  replies: ChatReply[];
  /** สิ่งที่ LINE รับไปจริง (ชั้นบนสุด · Flex = altText) */
  preview: string | null;
}

export interface ChatExchange {
  key: string;
  request_id: string;
  channel: 'line' | 'web';
  kind: ChatKind;
  /** ชนิดย่อย: message_type / event_type ของ LINE · type ของแถว web_* */
  subtype: string | null;
  at: string;
  /** เวลาที่งานจบ (handled_at) — หมุด "ส่งคำตอบ" ของไทม์ไลน์ · หน้าเว็บ = null */
  done_at: string | null;
  sender: { line_user_id: string | null; name: string | null; code: string | null; admin: string | null };
  redelivery: { count: number; action: string | null; delay_ms: number | null } | null;
  delivery: { status: ChatDelivery; problem: boolean; error: string | null };
  content?: ChatContent;
}

const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

function kindOf(ev: ChatEventRow): ChatKind {
  if (ev.event_type === 'postback') return 'postback';
  if (ev.event_type !== 'message') return 'event';
  if (ev.message_type === 'text') return 'text';
  if (ev.message_type === 'sticker') return 'sticker';
  if (ev.message_type === 'image') return 'image';
  return 'other';
}

function lineContent(ev: ChatEventRow, kind: ChatKind, msgs: ChatLineMessageRow[]): ChatContent {
  let inText: string | null = null;
  let raw: string | null = null;
  if (kind === 'postback') {
    // แถวเติมเก็บ "[กดปุ่ม] <data>" · แถวของ handler เก็บคำของมันเอง ("ยืนยันออกใบเสนอราคา")
    const fillData = msgs.find(m => isWebhookFillType(m.type))?.content ?? null;
    raw = ev.postback_data ?? (fillData ? fillData.replace(/^\s*\[กดปุ่ม\]\s*/, '') : null);
    inText = raw !== null ? postbackLabel(raw) : (msgs.find(m => m.content)?.content ?? null);
  } else if (kind === 'text') {
    inText = ev.message_text ?? msgs.find(m => m.content)?.content ?? null;
  }
  return {
    in_text: inText,
    raw,
    replies: msgs.map(m => ({
      source: isWebhookFillType(m.type) ? 'fill' as const : 'handler' as const,
      text: m.reply_content ?? '',
      no_reply: m.reply_content === NO_REPLY_TEXT,
      at: iso(m.created_at) ?? '',
    })),
    preview: ev.reply_preview ?? null,
  };
}

function lineExchange(ev: ChatEventRow, msgs: ChatLineMessageRow[], withContent: boolean): ChatExchange {
  const kind = kindOf(ev);
  const status = deliveryOf(ev);
  const redelivered = ev.delivery_count > 1 || ev.redelivery_action !== null;
  const out: ChatExchange = {
    key: ev.webhook_event_id,
    request_id: ev.request_id,
    channel: 'line',
    kind,
    subtype: kind === 'event' ? ev.event_type : ev.message_type,
    at: iso(ev.first_seen_at) ?? '',
    done_at: iso(ev.handled_at),
    sender: { line_user_id: ev.line_user_id, name: ev.sender_name, code: ev.sender_code, admin: null },
    redelivery: redelivered
      ? { count: Number(ev.delivery_count) || 1, action: ev.redelivery_action, delay_ms: ev.last_delay_ms }
      : null,
    delivery: {
      status,
      problem: isDeliveryProblem(status),
      error: status === 'warn_failed' ? ev.warn_error : ev.reply_error,
    },
  };
  if (withContent) out.content = lineContent(ev, kind, msgs);
  return out;
}

function webExchange(m: ChatWebMessageRow, withContent: boolean): ChatExchange {
  const out: ChatExchange = {
    key: `web-${m.id}`,
    request_id: m.request_id,
    channel: 'web',
    kind: 'web',
    subtype: m.type,
    at: iso(m.created_at) ?? '',
    done_at: null,
    sender: { line_user_id: null, name: m.sender_name, code: m.sender_code, admin: m.admin_username },
    redelivery: null,
    delivery: { status: 'web', problem: false, error: null },
  };
  if (withContent) {
    out.content = {
      in_text: m.content ?? null,
      raw: null,
      replies: m.reply_content
        ? [{ source: 'web', text: m.reply_content, no_reply: false, at: iso(m.created_at) ?? '' }]
        : [],
      preview: null,
    };
  }
  return out;
}

/**
 * แถวดิบ → ก้อนของแต่ละ request (เรียงตามเวลา) · ฟังก์ชันบริสุทธิ์ ⇒ ด่านป้อนแถวสังเคราะห์ได้
 * withContent = false ⇒ ไม่มีคีย์ `content` ในก้อนไหนเลย แม้แถวที่ส่งเข้ามาจะมีเนื้อติดมาก็ตาม
 */
export function buildChatExchanges(rows: ChatRows, withContent: boolean): Record<string, ChatExchange[]> {
  const byEvent = new Map<string, ChatLineMessageRow[]>();
  if (withContent) {
    for (const m of rows.lineMessages) {
      const list = byEvent.get(m.webhook_event_id) ?? [];
      list.push(m);
      byEvent.set(m.webhook_event_id, list);
    }
  }
  const out: Record<string, ChatExchange[]> = {};
  const push = (x: ChatExchange) => { (out[x.request_id] ??= []).push(x); };
  for (const ev of rows.events) push(lineExchange(ev, byEvent.get(ev.webhook_event_id) ?? [], withContent));
  for (const m of rows.webMessages) if (m.request_id) push(webExchange(m, withContent));
  for (const list of Object.values(out)) list.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
  return out;
}

/** `?ids=a,b,c` → รายการที่ผ่านรูปแบบ (ไม่ซ้ำ) · null = มีตัวผิดรูปหรือเกินเพดาน (route ตอบ 400) */
export function parseRequestIds(raw: unknown): string[] | null {
  const parts = String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const ids = [...new Set(parts)];
  if (ids.length > MAX_CHAT_REQUEST_IDS) return null;
  if (ids.some(id => !REQUEST_ID_RE.test(id))) return null;
  return ids;
}

export interface ChatForRequests {
  /** true = ก้อนมีเนื้อ (ผู้ดูเป็น admin) · หน้าจอใช้ตัดสินว่าจะขึ้นแม่กุญแจ */
  content: boolean;
  byRequest: Record<string, ChatExchange[]>;
  /** จำนวนก้อนทั้งหมด — route ใช้ตัดสินว่าต้องเขียน audit การเปิดดูเนื้อไหม */
  count: number;
}

/** ทางเดียวที่ route ใช้ — สิทธิ์ตัดสินจาก role ของคนที่เรียกเท่านั้น */
export async function getChatForRequests(
  requestIds: readonly string[], viewerRole: Role | string | null | undefined, db?: DbExecutor,
): Promise<ChatForRequests> {
  const withContent = canReadChatContent(viewerRole);
  const ids = requestIds.filter(id => REQUEST_ID_RE.test(id)).slice(0, MAX_CHAT_REQUEST_IDS);
  const rows = await listChatRowsForRequests(ids, withContent, db);
  const byRequest = buildChatExchanges(rows, withContent);
  const count = Object.values(byRequest).reduce((s, l) => s + l.length, 0);
  return { content: withContent, byRequest, count };
}
