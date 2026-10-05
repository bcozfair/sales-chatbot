// ─────────────────────────────────────────────────────────────────────────────
//  ช่องทางตอบกลับที่ถอดออกจาก LINE ได้ — เฟส A ของ docs/plan-web-quote-request.md
//
//  โจทย์: อยากให้ handleEvent (ตัวประมวลผลข้อความทั้งก้อน ~1,900 บรรทัด) ถูกเรียกจาก
//  หน้าเว็บแอดมินได้ด้วย โดย **ไม่ต้องแตะตรรกะข้างในเลยแม้แต่บรรทัดเดียว**
//  ทางที่เลือกคือ "ฉีดตัวตอบกลับเข้าไป" แทนที่จะให้ handleEvent import lineClient มาใช้ตรง ๆ
//
//  ไฟล์นี้จงใจไม่รู้จักอะไรเลยนอกจากรูปร่างของ replyMessage — ไม่ import LINE SDK
//  ไม่แตะ DB ⇒ ถอดไฟล์นี้ออกแล้วระบบเดิมกลับมาเหมือนเดิมเป๊ะ (หลักการข้อ 1 ของแผน)
//
//  ผู้ส่ง client เข้ามามีสองทาง: หน้าเว็บส่ง createCaptureClient() (เก็บแทนส่ง) · คิว LINE ใน
//  index.ts ส่ง createRecordingClient(lineClient) (ส่งจริงตามเดิม แล้วจดว่าส่งอะไร/สำเร็จไหม
//  ให้ services/webhookRecorder.ts — ตั้งแต่ 2026-10-02) · ไม่ส่งมา = lineClient ตัวเดิมทุกบิต
// ─────────────────────────────────────────────────────────────────────────────

/**
 * สิ่งเดียวที่ `handleEvent` ต้องการจากตัวตอบกลับ — แคบไว้ตั้งใจ
 *
 * `lineClient` ของ LINE SDK เข้ารูปนี้อยู่แล้วโดยไม่ต้องห่ออะไร (ตรวจด้วย tsc)
 * ถ้าวันหนึ่ง handleEvent ไปเรียกเมธอดอื่นของ SDK เพิ่ม จะพังที่ compile time ทันที
 * ซึ่งเป็นสิ่งที่ต้องการ — จะได้รู้ตัวว่าเส้นทางเว็บกำลังจะขาดอะไร ไม่ใช่ไปเงียบตอนรัน
 */
export interface ReplyClient {
  replyMessage(p: { replyToken: string; messages: any[] }): Promise<any>;
}

/**
 * ตัวตอบกลับที่ "เก็บใส่ตะกร้าแทนส่งออก LINE"
 *
 * ใช้ตอนเรียก handleEvent จากฝั่งเว็บ: ข้อความที่ปกติจะถูกยิงกลับไปทาง replyToken
 * จะไปกองอยู่ใน `captured` ให้ฝั่งเรียกหยิบไปตอบเป็น JSON แทน
 *
 * คืน `null` ได้โดยไม่ต้องปลอม response ของ LINE ให้เหมือนจริง เพราะไม่มีใครอ่านค่านี้:
 * ใน handleEvent ทุกจุดเป็น `return lineClient.replyMessage(...)` (ไม่เอาไปคิดต่อ) และค่าที่
 * ไหลออกไปก็ไม่มีใครแตะ — index.ts ดู `res.outcome` ของ runWithDeadline แทน ส่วน abortCheck
 * ตรวจแค่เคส abort ที่คืน null อยู่แล้ว
 */
export function createCaptureClient(): { captured: any[]; client: ReplyClient } {
  const captured: any[] = [];
  return {
    captured,
    client: {
      async replyMessage(p: { replyToken: string; messages: any[] }) {
        captured.push(...p.messages);   // เก็บแทนส่งออก LINE
        return null;
      }
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  ตัวจดคำตอบ — ส่งจริงผ่านตัวเดิมทุกบิต แล้ว "จด" ว่าส่งอะไรและสำเร็จไหม
//  (เจ้าของสั่ง 2026-10-02 · docs/plan-message-log-merge.md เฟส 1)
//
//  ทำไมต้องจดที่ชั้นนี้: handleEvent มี ~50 ทางตอบ และกลืน error ของ replyMessage เองในทางสำรอง
//  ⇒ คิวรู้แค่ว่า handleEvent จบ ไม่รู้ว่าข้อความถึงเซลส์ไหม · การจดที่ตัวส่งได้ข้อเท็จจริงครบ
//  โดยไม่แตะตรรกะของ handleEvent สักบรรทัด
//
//  สัญญาที่ต้องจริงเสมอ (ด่าน diag:webhook-recorder ตรวจ):
//   - ค่าที่คืน / error ที่โยน คือตัวเดิมของ inner (===) · inner โยนแบบ sync ก็โยนตัวเดิมแบบ sync
//   - error ของการจดเองห้ามหลุดไปถึงผู้เรียก · หลัง close() หยุดจดอย่างเดียว การส่งทำงานตามปกติ
//   - อ่านแค่ชั้นบนของข้อความ (type · text · altText) — **ไม่เปิด contents ของ Flex** (มีชื่อ/
//     เบอร์ลูกค้า) · ไม่ import SDK ไม่แตะ DB เหมือนส่วนบนของไฟล์
// ─────────────────────────────────────────────────────────────────────────────

/** ข้อความหนึ่งก้อนในหนึ่งรอบส่ง — `text` = ข้อความของ text / altText ของ flex·template / null */
export interface ReplyPart { kind: string; text: string | null }

/** หนึ่งครั้งที่เรียก replyMessage — `ok: null` = ยังไม่ได้ผล (ค้าง) */
export interface ReplyAttempt {
  startedAt: number;
  endedAt: number | null;
  ok: boolean | null;
  parts: ReplyPart[];
  error: string | null;
}

export interface RecordingClient {
  /** ส่งเข้า handleEvent ผ่าน `opts.client` */
  client: ReplyClient;
  /** ผูก promise ของงาน (handleEvent) เพื่อรู้ว่าจบเมื่อไหร่ — คืน `p` ตัวเดิม (===) */
  watch<T>(p: Promise<T>): Promise<T>;
  /** resolve `true` เมื่องานที่ watch ไว้จบ (สำเร็จหรือล้ม) · `null` = ยังไม่เคย watch */
  whenSettled(): Promise<true> | null;
  /** หยุดจด แล้วคืนสำเนาของทุกรอบที่จดไว้ */
  close(): readonly ReplyAttempt[];
}

const ERROR_BODY_MAX = 300;

/** ชั้นบนของข้อความที่ส่ง — ห้ามอ่านลึกกว่านี้ (contents ของ Flex มีข้อมูลลูกค้า) */
export function describeReplyMessages(messages: unknown): ReplyPart[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((m: any): ReplyPart => {
    const kind = typeof m?.type === 'string' ? m.type : 'unknown';
    if (kind === 'text') return { kind, text: typeof m?.text === 'string' ? m.text : null };
    return { kind, text: typeof m?.altText === 'string' ? m.altText : null };
  });
}

/**
 * error ของการส่ง เป็นบรรทัดเดียว — HTTPFetchError ของ @line/bot-sdk มี status/statusText/headers/body
 * (วัด 2026-10-02 · SDK 11.0.0) · `x-line-request-id` คือเลขที่ LINE ใช้ตามเรื่องให้
 */
export function describeReplyError(err: unknown): string {
  try {
    const e: any = err;
    if (e && typeof e.status === 'number') {
      let rid: unknown = null;
      try { rid = typeof e.headers?.get === 'function' ? e.headers.get('x-line-request-id') : null; } catch { rid = null; }
      const rawBody = typeof e.body === 'string' ? e.body : (e.body == null ? '' : JSON.stringify(e.body));
      const body = String(rawBody ?? '').slice(0, ERROR_BODY_MAX);
      return `${e.status} ${e.statusText ?? ''} rid=${rid ?? '-'} ${body}`.trim();
    }
    if (e instanceof Error) return `${e.name}: ${e.message}`;
    return String(e);
  } catch {
    return 'unknown error';
  }
}

export function createRecordingClient(inner: ReplyClient): RecordingClient {
  const attempts: ReplyAttempt[] = [];
  let closed = false;
  let settled: Promise<true> | null = null;

  const finish = (att: ReplyAttempt | null, ok: boolean, err?: unknown) => {
    try {
      if (!att || closed) return;
      att.endedAt = Date.now();
      att.ok = ok;
      if (!ok) att.error = describeReplyError(err);
    } catch { /* การจดล้มต้องไม่กระทบการส่ง */ }
  };

  const client: ReplyClient = {
    replyMessage(p: { replyToken: string; messages: any[] }) {
      let att: ReplyAttempt | null = null;
      try {
        if (!closed) {
          att = { startedAt: Date.now(), endedAt: null, ok: null, parts: describeReplyMessages(p?.messages), error: null };
          attempts.push(att);
        }
      } catch { att = null; }

      let res: Promise<any>;
      try {
        res = inner.replyMessage(p);          // เรียกแบบเมธอด — inner ที่อ่าน this ต้องทำงานได้
      } catch (err) {
        finish(att, false, err);
        throw err;                            // ตัวเดิม แบบ sync เหมือนเรียก inner ตรง ๆ
      }
      try {
        if (res && typeof (res as any).then === 'function') {
          // ผูกข้างทาง ไม่ใช่ห่อ — คืน res ตัวเดิมให้ผู้เรียก (error/ค่าเดิม ===) · ตัวที่ผูกนี้จัดการ
          // rejection ของตัวเองแล้ว ไม่ก่อ unhandledRejection เพิ่ม
          res.then(() => finish(att, true), (err: unknown) => finish(att, false, err));
        } else {
          finish(att, true);
        }
      } catch { /* ไม่ปล่อยให้การผูกตัวจดทำให้การส่งพัง */ }
      return res;
    },
  };

  return {
    client,
    watch<T>(p: Promise<T>): Promise<T> {
      try {
        if (!settled && p && typeof (p as any).then === 'function') {
          settled = Promise.resolve(p).then(() => true as const, () => true as const);
        }
      } catch { /* ไม่รู้ว่าจบเมื่อไหร่ = ผู้เรียกถือว่ายังไม่ settled */ }
      return p;
    },
    whenSettled() {
      return settled;
    },
    close() {
      closed = true;
      try {
        return Object.freeze(attempts.map(a => Object.freeze({ ...a, parts: a.parts.map(x => ({ ...x })) })));
      } catch {
        return [];
      }
    },
  };
}
