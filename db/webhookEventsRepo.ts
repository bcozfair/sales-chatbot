/**
 * ใบรับของ webhook ทุก event ที่ LINE ยิงเข้ามา (ตาราง `webhook_events`)
 *
 * ## ทำไมไฟล์นี้ถึงมี
 *
 * LINE ส่ง event ซ้ำเมื่อรอบแรกไม่ได้ 2xx โดยพก `webhookEventId` และ `replyToken` ตัวเดิมมาด้วย
 * โค้ดเดิมข้ามตัวที่ `isRedelivery` ทุกตัวโดยถือว่า "เราตอบไปแล้วแน่ ๆ" — **จริงแค่ 5 ใน 7 ครั้ง**
 * (วัด 2026-09-23) อีก 2 ครั้งรอบแรกไม่เคยมาถึงแอปเลย ⇒ คำสั่งของเซลส์หายเงียบ
 *
 * ตารางนี้ตอบคำถามเดียวที่แยกสองกลุ่มนั้นออกจากกันได้: **"เคยรับ event นี้แล้วหรือยัง
 * และรอบนั้นทำจนจบไหม"** — ต้องตอบจากฐานข้อมูล ไม่ใช่จากความจำในโปรเซส เพราะช่วงที่
 * redelivery ถี่ที่สุดคือตอน deploy ซึ่งเป็นตอนที่โปรเซสเพิ่งเกิดใหม่และจำอะไรไม่ได้เลย
 *
 * ## กติกาของไฟล์นี้
 *
 * **ทุกฟังก์ชันห้าม throw** — ตารางนี้เป็นตัวช่วยตัดสินใจ ไม่ใช่เส้นทางหลักของการตอบข้อความ
 * DB ล่มหรือยังไม่ได้รัน migration ต้องแปลว่า "ไม่รู้" แล้วให้ผู้เรียกตกกลับไปพฤติกรรมเดิม
 * ไม่ใช่ทำให้ webhook ทั้งเส้นพัง
 */
import { pool, type DbExecutor } from '../config/db.js';

function logErr(fn: string, err: any): void {
  console.error(`[webhookEvents.${fn}]`, err?.message || err);
}

export type WebhookOutcomeName = 'replied' | 'timeout' | 'dropped' | 'failed';
export type RedeliveryAction = 'skipped_duplicate' | 'warned' | 'warn_failed';

/** ข้อมูลที่ดึงออกจาก event ดิบของ LINE — ประกอบที่ผู้เรียกเพื่อให้ไฟล์นี้ไม่ต้องรู้จักรูปร่างของ event */
export interface IncomingEvent {
  webhookEventId: string;
  eventType: string;
  messageType?: string | null;
  postbackData?: string | null;
  lineUserId?: string | null;
  sourceType?: string | null;
  /** event.timestamp ของ LINE (ms) */
  eventAtMs?: number | null;
  /** เวลาที่เรารับ webhook (ms) */
  receivedAtMs: number;
  replyToken?: string | null;
  requestId?: string | null;
  /**
   * ข้อความดิบของ event ชนิด text — **`recordIncomingEvent` ไม่อ่านช่องนี้โดยตั้งใจ**
   * ถ้าใส่ใน INSERT ใบรับ แล้วฐานยังไม่ได้รัน migration 2026-10-02_01 ใบรับจะล้มทั้งแถว
   * ⇒ การตัดสินการส่งซ้ำเปลี่ยนไป · เขียนแยกด้วย `recordEventText` ซึ่งพักเองเมื่อล้ม
   */
  messageText?: string | null;
}

export interface ReceiptResult {
  /** true = ไม่เคยเห็น event นี้มาก่อน ⇒ ถ้าเป็นตัวส่งซ้ำ แปลว่า **รอบแรกไม่เคยมาถึง** */
  isFirstSight: boolean;
  /** ผลของรอบก่อนหน้า — `null` = เคยรับแต่ยังทำไม่จบ (หรือยังไม่รู้ผล) */
  previousOutcome: WebhookOutcomeName | null;
  /** LINE ยิง event นี้มาแล้วกี่ครั้งรวมครั้งนี้ */
  deliveryCount: number;
  /** `false` เมื่อถามฐานไม่ได้ — ผู้เรียกต้องตกกลับไปพฤติกรรมเดิม ห้ามตีความว่า "ไม่เคยเห็น" */
  known: boolean;
}

const UNKNOWN: ReceiptResult = { isFirstSight: false, previousOutcome: null, deliveryCount: 0, known: false };

/**
 * บันทึกใบรับ แล้วบอกกลับว่า "เคยเห็นมาก่อนไหม และรอบก่อนจบยังไง" — ในคำสั่งเดียว
 *
 * ใช้ `INSERT … ON CONFLICT DO UPDATE` เพราะตัวส่งซ้ำใช้ `webhookEventId` เดิม ⇒ เป็นการ
 * แตะแถวเดิม ไม่ใช่แถวใหม่ · `xmax = 0` คือวิธีมาตรฐานของ Postgres ในการถามว่าแถวที่ RETURNING
 * คืนมานั้นเกิดจาก INSERT (xmax = 0) หรือ UPDATE (xmax ≠ 0) ⇒ ได้คำตอบทั้งสองอย่างจาก
 * การยิงครั้งเดียว และ **atomic** ไม่มีช่องให้สอง request แข่งกันอ่านแล้วเขียนทับกัน
 *
 * ค่าที่ RETURNING คืนคือค่า **ก่อน** UPDATE ของรอบนี้หรือไม่ ขึ้นกับว่าอ้างผ่าน `webhook_events.`
 * (ค่าใหม่) หรือ `EXCLUDED.`/subquery (ค่าที่ส่งเข้ามา) — ที่นี่ต้องการ `outcome` ของรอบก่อน
 * ซึ่ง UPDATE ไม่ได้แตะ จึงอ่านตรง ๆ ได้
 */
export async function recordIncomingEvent(ev: IncomingEvent): Promise<ReceiptResult> {
  const delayMs = typeof ev.eventAtMs === 'number' ? ev.receivedAtMs - ev.eventAtMs : null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO webhook_events (
         webhook_event_id, first_seen_at, last_seen_at, delivery_count,
         event_type, message_type, postback_data,
         line_user_id, source_type, event_at, first_delay_ms, last_delay_ms,
         reply_token, request_id
       ) VALUES (
         $1, to_timestamp($10::double precision / 1000), to_timestamp($10::double precision / 1000), 1,
         $2, $3, $4,
         $5, $6, CASE WHEN $7::double precision IS NULL THEN NULL
                      ELSE to_timestamp($7::double precision / 1000) END, $8, $8,
         $9, $11
       )
       ON CONFLICT (webhook_event_id) DO UPDATE SET
         last_seen_at   = to_timestamp($10::double precision / 1000),
         delivery_count = webhook_events.delivery_count + 1,
         last_delay_ms  = $8
       RETURNING (xmax = 0) AS is_first_sight, outcome, delivery_count`,
      [
        ev.webhookEventId,
        ev.eventType,
        ev.messageType ?? null,
        ev.postbackData ?? null,
        ev.lineUserId ?? null,
        ev.sourceType ?? null,
        ev.eventAtMs ?? null,
        delayMs,
        ev.replyToken ?? null,
        ev.receivedAtMs,
        ev.requestId ?? null,
      ]
    );
    const r = rows[0];
    if (!r) return UNKNOWN;
    return {
      isFirstSight: r.is_first_sight === true,
      previousOutcome: (r.outcome as WebhookOutcomeName | null) ?? null,
      deliveryCount: Number(r.delivery_count) || 1,
      known: true,
    };
  } catch (err) {
    logErr('recordIncomingEvent', err);
    return UNKNOWN;
  }
}

/** ปิดใบรับด้วยผลของการประมวลผล — เรียกตอนงานในคิวจบ ไม่ว่าจะจบแบบไหน */
export async function markEventOutcome(webhookEventId: string, outcome: WebhookOutcomeName): Promise<void> {
  try {
    await pool.query(
      `UPDATE webhook_events SET handled_at = now(), outcome = $2 WHERE webhook_event_id = $1`,
      [webhookEventId, outcome]
    );
  } catch (err) {
    logErr('markEventOutcome', err);
  }
}

/** บันทึกว่าทำอะไรกับตัวที่ถูกส่งซ้ำ — `note` ใช้เก็บสาเหตุตอนแจ้งเซลส์ไม่สำเร็จ */
export async function markRedeliveryAction(
  webhookEventId: string,
  action: RedeliveryAction,
  note?: string | null
): Promise<void> {
  try {
    await pool.query(
      `UPDATE webhook_events SET redelivery_action = $2, note = $3 WHERE webhook_event_id = $1`,
      [webhookEventId, action, note ?? null]
    );
  } catch (err) {
    logErr('markRedeliveryAction', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  คอลัมน์บันทึกผล (migration 2026-10-02_01 · docs/plan-message-log-merge.md เฟส 1)
//
//  ข้อมูลประกอบการสอบกลับ ไม่ใช่ตัวตัดสินอะไร — `reply_status` **ไม่ใช่** `outcome`
//  และห้ามใช้ตัดสินการส่งซ้ำ · ทั้งสองฟังก์ชันเขียนครั้งเดียวต่อแถว (`IS NULL` ใน WHERE)
//
//  ตัวพักร่วม: error ใด ๆ (ส่วนใหญ่คือฐานยังไม่ได้รัน migration) ⇒ หยุดเขียนสองคอลัมน์ชุดนี้
//  10 นาที พิมพ์บรรทัดเดียว — ไม่ให้ log ท่วมด้วย error เดิมทุก event และไม่ถ่วง pool
//  ตัวพักไม่แตะสามฟังก์ชันข้างบน (ใบรับ/ผล/การส่งซ้ำ ยังทำงานตามเดิมทุกกรณี)
// ─────────────────────────────────────────────────────────────────────────────

export type ReplyStatus = 'sent' | 'failed' | 'pending' | 'none';

const REPLY_COLUMNS_PAUSE_MS = 10 * 60_000;
let replyColumnsPausedUntil = 0;

function pauseReplyColumns(fn: string, err: unknown): void {
  replyColumnsPausedUntil = Date.now() + REPLY_COLUMNS_PAUSE_MS;
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[webhookEvents.${fn}] พักเขียนคอลัมน์บันทึกผล 10 นาที — ${msg}`);
}

/** Postgres เก็บ NUL ใน text ไม่ได้ (ทั้งแถวตก) · ตัดความยาวโดยไม่ทิ้งครึ่งตัวของ surrogate pair */
function clipText(s: string | null | undefined, max: number): string | null {
  if (typeof s !== 'string') return null;
  let out = s.replace(/\u0000/g, '');
  if (out.length > max) {
    out = out.slice(0, max);
    if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  }
  return out;
}

const MESSAGE_TEXT_MAX = 5000;
const REPLY_ERROR_MAX = 1000;
export const REPLY_PREVIEW_MAX = 1000;

/** ข้อความดิบของ event text — ผู้เรียกต้องรอให้ใบรับ INSERT เสร็จก่อน ไม่งั้น UPDATE ไม่โดนแถว */
export async function recordEventText(
  webhookEventId: string,
  text: string | null | undefined,
  db: DbExecutor = pool
): Promise<void> {
  try {
    if (Date.now() < replyColumnsPausedUntil) return;
    const v = clipText(text, MESSAGE_TEXT_MAX);
    if (v === null) return;
    await db.query(
      `UPDATE webhook_events SET message_text = $2 WHERE webhook_event_id = $1 AND message_text IS NULL`,
      [webhookEventId, v]
    );
  } catch (err) {
    pauseReplyColumns('recordEventText', err);
  }
}

/** ผลของการตอบกลับ — เรียกหลังงานจบ (หรือครบเพดานรอ) ครั้งเดียวต่อ event */
export async function recordReplyOutcome(
  webhookEventId: string,
  r: { status: ReplyStatus; error?: string | null; preview?: string | null },
  db: DbExecutor = pool
): Promise<void> {
  try {
    if (Date.now() < replyColumnsPausedUntil) return;
    await db.query(
      `UPDATE webhook_events SET reply_status = $2, reply_error = $3, reply_preview = $4
        WHERE webhook_event_id = $1 AND reply_status IS NULL`,
      [webhookEventId, r.status, clipText(r.error, REPLY_ERROR_MAX), clipText(r.preview, REPLY_PREVIEW_MAX)]
    );
  } catch (err) {
    pauseReplyColumns('recordReplyOutcome', err);
  }
}
