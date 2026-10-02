/**
 * ตัวบันทึก webhook — เก็บส่วนที่ handleEvent ไม่ได้เขียนเอง ลง "ตารางเดิมของมัน"
 * (เจ้าของสั่ง 2026-10-02 · แผน: docs/plan-message-log-merge.md เฟส 1)
 *
 * ## ทำไมไฟล์นี้ถึงมี
 *
 * วัด 2026-10-02 (ฐานจริง · 9 วัน): event ที่ outcome = 'replied' แต่ไม่มีแถวใน `messages`
 * ~21.6 ครั้ง/วัน (กดเลือกสินค้า 77 · ผู้ติดต่อ 44 · ข้อความ 32 · บริษัท 22 · เมนูแก้ 13 · ยืนยัน 4
 * · ยกเลิก 2) และกลุ่ม B ของการส่งซ้ำ 12 ครั้ง — เพราะ handleEvent เขียนแถวเองแค่ 7 จุดจาก ~50 ทางตอบ
 * และ outcome = 'replied' ไม่ได้แปลว่าส่งถึง (ทางสำรองท้าย handleEvent กลืน error ของ replyMessage)
 *
 * ไฟล์นี้คุมลำดับ "รองานจบ → ปิดตัวจด → เขียนผล" ทั้งหมด ⇒ index.ts เรียกแค่ฟังก์ชันเดียวต่อจุด
 *   - event ↦ `webhook_events` (ข้อความดิบ · reply_status · reply_error · reply_preview)
 *   - message ↦ `messages` แถวเติมชนิด `wh_*` (db/messageKinds.ts) — **ไม่เข้าประวัติที่ป้อน LLM**
 *
 * ## กติกา
 *
 * - **ห้าม throw และห้ามถ่วงเส้นที่รอตอบ** — ทุกฟังก์ชันที่มีผลข้างเคียงคืนทันที งานจริงวิ่งข้างหลัง
 *   ใน promise ที่ติดตามไว้ (`flushWebhookRecords` ตอนปิดโปรเซส)
 * - เขียนแถวเติม **หลัง** handleEvent จบเท่านั้น ⇒ แถวของ handler (insertMessage ถูก await ก่อนจบ
 *   ทุกจุด) ลงฐานไปก่อนเสมอ แล้ว NOT EXISTS ใน `insertWebhookFillMessage` กันซ้ำได้คำสั่งเดียว
 * - เกินเพดาน 120 วิ (งานผีที่ยังไม่จบ) = ไม่เขียนแถวเติม · reply_status = pending
 *   (แม้รอบที่จดได้จะล้มหมดแล้ว — งานที่ยังไม่จบยังส่งทางสำรองสำเร็จได้ ⇒ failed ได้เฉพาะงานที่จบแล้ว)
 *
 * ## ทางที่ไม่ได้เลือก
 *
 * - เติม insertMessage ในทุกทางตอบของ lineHandler (~50 จุด) — แตะตรรกะที่รันจริง และแถวของ handler
 *   เขียน "ก่อนส่ง" จึงบอกไม่ได้อยู่ดีว่าส่งถึงไหม
 * - แปลง postback เป็นชื่อสินค้า/บริษัทตอนเขียน — ต้อง query เพิ่มทุกปุ่ม · select_product หาย้อนไม่ได้
 *   ⇒ เก็บ data ดิบ แปลงตอนอ่าน (หน้าจอเฟส 2 กับการทดลองให้บอทจำปุ่มใช้ตัวแสดงผลเดียวกัน)
 * - UNIQUE บน reply_token — ปุ่มยืนยันชุด PM+THT เขียนสองแถวต่อ token โดยชอบ (8 event วัด 2026-10-02)
 * - ใช้ reply_status ตัดสิน outcome หรือการส่งซ้ำ — มันคือข้อมูลประกอบ ไม่ใช่ตัวตัดสิน
 * - แถวเติมของ image (handleImage ส่งผ่าน lineClient ตรง ไม่ผ่านตัวจด) · follow/unfollow/join ·
 *   ตัวส่งซ้ำที่รอบแรกเคยมาถึง (รอบแรกเขียนเองหลังจบ)
 */
import type { RecordingClient, ReplyAttempt, ReplyPart } from './chatChannel.js';
import {
  recordEventText, recordReplyOutcome, REPLY_PREVIEW_MAX, type ReplyStatus,
} from '../db/webhookEventsRepo.js';
import { insertWebhookFillMessage, type WebhookFillRow } from '../db/repositories.js';
import { webhookFillType } from '../db/messageKinds.js';

/** รองานผีได้นานสุดเท่านี้ก่อนตัดใจ — token ที่ยังไม่ใช้ตอบได้ถึง ≥120 วิ (วัด 2026-09-23) */
export const SETTLE_CAP_MS = 120_000;
/** reply_content ของแถวเติมเมื่อไม่มีรอบไหนส่งสำเร็จ — ห้ามเป็น null (quoteExtraction ต่อสตริง "บอท: …") */
export const NO_REPLY_TEXT = '[บอทไม่ได้ตอบ]';

const SAFE_KIND = /^[a-z_]{1,20}$/;

// ── ฟังก์ชันบริสุทธิ์ ─────────────────────────────────────────────────────────

/**
 * สถานะการตอบของหนึ่ง event — ลำดับของเงื่อนไขคือความหมาย ห้ามสลับ
 *   1. มีรอบที่ส่งสำเร็จ                          → sent
 *   2. งานยังไม่จบ (ไม่ settled) หรือยังมีรอบค้าง  → pending
 *      แม้ทุกรอบที่จดได้จะล้มแล้วก็ตาม — งานที่ยังวิ่งอยู่ยังส่งทางสำรองสำเร็จได้
 *      (ทางสำรอง "ระบบขัดข้อง" ท้าย handleEvent) จึงยังตัดสินว่า failed ไม่ได้
 *   3. จบแล้ว มีแต่รอบที่ล้ม                       → failed
 *   4. จบแล้ว ไม่เคยเรียกส่งเลย                     → none
 */
export function replyStatusOf(attempts: readonly ReplyAttempt[], settled: boolean): ReplyStatus {
  if (attempts.some(a => a.ok === true)) return 'sent';
  if (!settled || attempts.some(a => a.ok === null)) return 'pending';
  if (attempts.length === 0) return 'none';
  return 'failed';
}

function partLine(p: ReplyPart, withKind: boolean): string {
  if (p.kind === 'text') return p.text ?? '[text]';
  if (p.kind === 'flex' || p.kind === 'template') {
    if (p.text === null) return `[${p.kind}]`;
    return withKind ? `[${p.kind}] ${p.text}` : p.text;
  }
  return `[${p.kind}]`;
}

/** reply_content ของแถวเติม — text ตรงตัว · flex/template = altText · อื่น = [ชนิด] */
export function renderReplyContent(parts: readonly ReplyPart[]): string {
  return parts.map(p => partLine(p, false)).join('\n');
}

/** reply_preview ของ webhook_events — เหมือนข้างบนแต่ติดชนิดหน้า altText ให้รู้ว่าเป็น Flex */
export function renderReplyPreview(parts: readonly ReplyPart[]): string {
  let out = parts.map(p => partLine(p, true)).join('\n');
  if (out.length > REPLY_PREVIEW_MAX) {
    out = out.slice(0, REPLY_PREVIEW_MAX);
    if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);   // ไม่ทิ้งครึ่งตัวของ emoji
  }
  return out;
}

/** รอให้งานที่ watch ไว้จบ ไม่เกิน capMs · true = จบแล้ว */
export function waitSettled(rec: RecordingClient, capMs: number): Promise<boolean> {
  const s = rec.whenSettled();
  if (!s) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), capMs);
    t.unref?.();
    s.then(() => { clearTimeout(t); resolve(true); }, () => { clearTimeout(t); resolve(true); });
  });
}

const okParts = (attempts: readonly ReplyAttempt[]): ReplyPart[] =>
  attempts.filter(a => a.ok === true).flatMap(a => a.parts);

/**
 * แถวเติมของ `messages` หรือ null (ไม่ต้องเขียน)
 * | event          | type          | content                     | message_id            |
 * | postback       | wh_postback   | [กดปุ่ม] <postback.data>    | wh_postback_<ms>      |
 * | message text   | wh_text       | ข้อความดิบ                   | message.id            |
 * | message อื่น   | wh_<ชนิด>      | [Received <ชนิด> message]   | message.id            |
 * | image · อื่น ๆ  | —             |                             |                       |
 */
export function buildFillRow(a: {
  event: any; receivedAt: number; attempts: readonly ReplyAttempt[]; settled: boolean;
}): WebhookFillRow | null {
  const { event, receivedAt, attempts, settled } = a;
  if (!settled) return null;
  const userId = event?.source?.userId;
  const replyToken = event?.replyToken;
  if (typeof userId !== 'string' || userId === '') return null;
  if (typeof replyToken !== 'string' || replyToken === '') return null;

  let type: string, content: string, messageId: string;
  if (event?.type === 'postback') {
    type = webhookFillType('postback');
    content = `[กดปุ่ม] ${event?.postback?.data ?? ''}`;
    messageId = `${type}_${Date.now()}`;
  } else if (event?.type === 'message') {
    const mt = event?.message?.type;
    if (mt === 'image') return null;
    messageId = String(event?.message?.id ?? `${webhookFillType('message')}_${Date.now()}`);
    if (mt === 'text') {
      type = webhookFillType('text');
      content = typeof event?.message?.text === 'string' ? event.message.text : '';
    } else {
      type = webhookFillType(typeof mt === 'string' && SAFE_KIND.test(mt) ? mt : 'unknown');
      content = `[Received ${mt} message]`;   // สำเนาของ lineHandler (บรรทัด `[Received ${messageType} message]`)
    }
  } else {
    return null;
  }

  const rendered = renderReplyContent(okParts(attempts));
  return {
    created_at_ms: receivedAt,
    user_id: userId,
    message_id: messageId,
    type,
    content,
    reply_token: replyToken,
    reply_content: rendered === '' ? NO_REPLY_TEXT : rendered,
  };
}

// ── ฟังก์ชันที่มีผลข้างเคียง — คืนทันที ห้าม throw ──────────────────────────────

const inflight = new Set<Promise<void>>();

function track(work: () => Promise<void>, label: string): void {
  try {
    const p: Promise<void> = work().catch((err: unknown) => {
      console.error(`[webhookRecorder.${label}]`, err instanceof Error ? err.message : err);
    });
    inflight.add(p);
    p.then(() => { inflight.delete(p); }, () => { inflight.delete(p); });
  } catch (err: unknown) {
    console.error(`[webhookRecorder.${label}]`, err instanceof Error ? err.message : err);
  }
}

/** ข้อความดิบของ event text → webhook_events · `after` = ใบรับ INSERT (ต้องลงก่อน UPDATE) */
export function noteEventText(webhookEventId: string, text: string, after?: Promise<unknown> | null): void {
  track(async () => {
    if (after) await after.catch(() => {});
    await recordEventText(webhookEventId, text);
  }, 'noteEventText');
}

/**
 * ปิดบันทึกของ event ที่ผ่านคิว — เรียกท้าย finally ของงานในคิว **ไม่ await**
 * รองานจบ (ไม่เกิน SETTLE_CAP_MS) → ปิดตัวจด → reply_* ลง webhook_events → แถวเติมลง messages
 */
export function finishEventRecord(a: {
  event: any; webhookEventId: string | null; rec: RecordingClient | null; receivedAt: number;
}): void {
  const { event, webhookEventId, rec, receivedAt } = a;
  if (!rec) return;
  track(async () => {
    // handleImage ส่งผ่าน lineClient ตรง ไม่ผ่านตัวจด ⇒ ไม่มีข้อมูลให้เขียน (คอลัมน์ทั้งหมดคง NULL)
    if (event?.type === 'message' && event?.message?.type === 'image') { rec.close(); return; }
    const settled = await waitSettled(rec, SETTLE_CAP_MS);
    const attempts = rec.close();
    if (webhookEventId) {
      const errors = attempts.filter(x => x.ok === false && x.error).map(x => x.error as string);
      const sent = okParts(attempts);
      await recordReplyOutcome(webhookEventId, {
        status: replyStatusOf(attempts, settled),
        error: errors.length ? errors.join('\n') : null,
        preview: sent.length ? renderReplyPreview(sent) : null,
      });
    }
    const row = buildFillRow({ event, receivedAt, attempts, settled });
    if (row) await insertWebhookFillMessage(row);
  }, 'finishEventRecord');
}

/**
 * แถวเติมของตัวส่งซ้ำที่รอบแรกไม่เคยมาถึง (กลุ่ม B) — คำตอบคือข้อความแจ้งเซลส์ให้สั่งใหม่
 * `sentText` null = แจ้งไม่สำเร็จ ⇒ reply_content = NO_REPLY_TEXT
 */
export function noteRedeliveryReply(a: { event: any; receivedAt: number; sentText: string | null }): void {
  const { event, receivedAt, sentText } = a;
  track(async () => {
    const attempts: ReplyAttempt[] = sentText === null ? [] : [{
      startedAt: receivedAt, endedAt: receivedAt, ok: true,
      parts: [{ kind: 'text', text: sentText }], error: null,
    }];
    const row = buildFillRow({ event, receivedAt, attempts, settled: true });
    if (row) await insertWebhookFillMessage(row);
  }, 'noteRedeliveryReply');
}

/** รอรายการค้างไม่เกิน ms (ตอนปิดโปรเซส) · คืนจำนวนที่ยังไม่เสร็จ */
export async function flushWebhookRecords(ms: number): Promise<number> {
  try {
    if (inflight.size === 0) return 0;
    let t: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...inflight]),
      // ไม่ unref โดยตั้งใจ — ตอนปิดโปรเซสตัวจับเวลานี้ต้องค้ำ event loop ไว้จนครบ ms (ไม่เกิน 3 วิ)
      // ส่วนตัวจับเวลา 120 วิของ waitSettled เป็น unref ⇒ ถ้าไม่มีตัวนี้ค้ำ โปรเซสอาจหลุดออกก่อนถึงขั้นถัดไป
      new Promise<void>((resolve) => { t = setTimeout(resolve, Math.max(0, ms)); }),
    ]);
    if (t) clearTimeout(t);
    return inflight.size;
  } catch {
    return inflight.size;
  }
}
