/**
 * กติกาว่าจะทำอะไรกับ event ที่ LINE ส่งซ้ำ — แยกออกมาเป็นฟังก์ชันบริสุทธิ์
 *
 * ## ทำไมต้องแยกออกจาก index.ts
 *
 * ของเดิมตัดสินด้วยธง `isRedelivery` ตัวเดียว = ทิ้งทุกตัว ซึ่งถูกแค่ 5 ใน 7 ครั้ง (วัด 2026-09-23)
 * กติกาใหม่มีสามทางออกและขึ้นกับสถานะในฐาน ⇒ ต้องมีด่านพิสูจน์ได้ว่ามันตัดสินถูกทุกกรณี
 * ถ้าปล่อยไว้กลางฟังก์ชัน webhook ใน index.ts ด่านจะต้องยิง webhook จริงและแตะ DB จริงถึงจะทดสอบได้
 *
 * ทั้งสองฟังก์ชันในไฟล์นี้ไม่แตะ DB ไม่แตะเครือข่าย ⇒ `npm run diag:redelivery` เรียกตรง ๆ ได้
 *
 * ที่มาของตัวเลขและหลักฐานทั้งหมด: `docs/line-webhook-redelivery.md`
 */

/** ผลของการประมวลผลรอบก่อนหน้า ตรงกับ `WebhookOutcome` ของ services/webhookQueue.ts */
export type PreviousOutcome = 'replied' | 'timeout' | 'dropped' | 'failed' | null;

export interface RedeliverySituation {
  /** ถามฐานได้ไหม — `false` เมื่อ DB ล่ม / ยังไม่ได้รัน migration / event ไม่มี webhookEventId */
  known: boolean;
  /** true = ไม่เคยเห็น event นี้มาก่อนเลย ⇒ **รอบแรกไม่เคยมาถึงแอป** */
  isFirstSight: boolean;
  previousOutcome: PreviousOutcome;
}

export type RedeliveryDecision =
  /** รอบแรกตอบไปแล้ว — เซลส์ได้คำตอบแล้วและ token ถูกใช้ไปแล้ว ไม่ต้องทำอะไร */
  | { action: 'skip'; reason: 'already_replied' }
  /** ถามฐานไม่ได้ ⇒ พิสูจน์ไม่ได้ว่าทำไปแล้วหรือยัง เลือกทางที่ไม่กวนเซลส์ที่อาจได้คำตอบแล้ว */
  | { action: 'skip'; reason: 'unknown_state' }
  /** งานยังไม่ได้ทำและเซลส์ยังไม่รู้ ⇒ แจ้งให้สั่งใหม่ (ห้ามทำงานให้เงียบ ๆ — เจ้าของสั่ง 2026-09-23) */
  | { action: 'warn'; reason: 'never_arrived' | 'did_not_finish' };

/**
 * ⚠️ ห้ามเพิ่มทางออก "ทำงานให้เลย" เข้ามาในนี้
 *
 * เจ้าของตัดสินใจ 2026-09-23 ว่าการยืนยันใบให้สำเร็จโดยเซลส์ไม่รู้ตัวนั้นแย่กว่าการไม่ทำอะไร
 * เพราะเซลส์จะไม่รู้ว่าร่างถูกยืนยันไปแล้วจริง แล้วไปกดซ้ำหรือออกใบใหม่ทับ
 */
export function decideRedelivery(s: RedeliverySituation): RedeliveryDecision {
  if (!s.known) return { action: 'skip', reason: 'unknown_state' };
  if (s.isFirstSight) return { action: 'warn', reason: 'never_arrived' };
  if (s.previousOutcome === 'replied') return { action: 'skip', reason: 'already_replied' };
  // เคยรับแต่จบแบบ timeout/dropped/failed หรือยังไม่มีผล = งานไม่เสร็จ และไม่มีใครบอกเซลส์
  return { action: 'warn', reason: 'did_not_finish' };
}

/**
 * ข้อความที่ส่งกลับเมื่อคำสั่งตกหล่น — **ต้องบอกสถานะ ไม่ใช่แค่ "ลองใหม่"**
 *
 * ปุ่มยืนยันต้องระบุตรง ๆ ว่า "ใบยังไม่ถูกยืนยัน" ไม่งั้นเซลส์ต้องเดาเองว่ามันทำไปครึ่งทางหรือเปล่า
 * ซึ่งเป็นสิ่งเดียวที่เจ้าของสั่งห้ามไว้
 */
export function lostCommandMessage(event: any): string {
  if (event?.type === 'postback') {
    const data = String(event?.postback?.data ?? '');
    if (data.includes('action=confirm')) {
      return '⚠️ คำสั่งยืนยันเมื่อสักครู่ส่งไม่ถึงระบบ — ใบยังไม่ถูกยืนยัน กรุณากดยืนยันอีกครั้งครับ';
    }
    return '⚠️ คำสั่งเมื่อสักครู่ส่งไม่ถึงระบบ กรุณากดอีกครั้งครับ';
  }
  return '⚠️ ข้อความเมื่อสักครู่ส่งไม่ถึงระบบ รบกวนส่งใหม่อีกครั้งครับ';
}
