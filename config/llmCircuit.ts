/**
 * ตัวตัดเร็วของการเรียก LLM — AI ล่มต่อเนื่อง = งดเรียกชั่วคราว แล้วให้ผู้เรียกล้มทันที
 * (เจ้าของสั่ง 2026-10-08 · คู่กับปุ่ม "ลองอีกครั้ง" ใน lineHandler)
 *
 * ## ทำไมไฟล์นี้ถึงมี
 *
 * 2026-10-08 09:14–09:16 DeepSeek ไม่ตอบ 10 call ติดกัน ทุก call โดนเพดาน `LLM_HARD_CAP_MS` ตัด
 * ⇒ ทุกข้อความของเซลส์กิน 40 วิ (2 attempt × 20 วิ) แล้วยังได้คำว่า "ระบบไม่ว่าง" อยู่ดี
 * เซลส์ส่งซ้ำตามคำแนะนำทันที ⇒ รอ 40 วิอีกรอบแล้วล้มอีก — 5 ข้อความจาก 2 คน · ใบหนึ่งหายทั้งวัน
 * เพดานแต่ละ call ทำงานถูกแล้ว ที่ขาดคือ "ความจำข้าม call": ล้มสามครั้งติดกันแล้ว ครั้งที่สี่
 * ก็แทบแน่นอนว่าล้ม ไม่ควรให้คนถัดไปจ่าย 40 วิเพื่อพิสูจน์ซ้ำ
 *
 * ## กติกา
 *
 * - นับ **เฉพาะการโดนเพดานตัด** (ปลายทางเงียบ/ช้า = เสียเวลาจริง) · error ที่กลับมาเร็ว (4xx/5xx)
 *   ไม่นับ เพราะไม่ได้กินงบเวลาของใคร และผู้เรียกลองใหม่ได้ถูก ๆ อยู่แล้ว
 * - ครบ `TRIP_COUNT` ครั้งภายใน `WINDOW_MS` (นับรวมทุกผู้ใช้ — ปลายทางล่มคือล่มทั้งระบบ)
 *   ⇒ งด `OPEN_MS` · ระหว่างนั้น `createChatCompletion` โยน `LlmUnavailableError` ทันที
 * - หมดช่วงงดแล้วปล่อยเรียกตามปกติ — ถ้าโดนตัดอีกครั้ง ครั้งเก่ายังอยู่ใน window ⇒ งดต่อทันที
 *   (ไม่ต้องมีสถานะ half-open แยก) · สำเร็จหนึ่งครั้ง = ล้างทุกอย่าง
 * - สถานะอยู่ในหน่วยความจำของโปรเซส · restart = เริ่มนับใหม่ (ตั้งใจ — ไม่มีอะไรต้องกู้)
 *
 * ## ทางที่ไม่ได้เลือก
 *
 * - ลดเพดานต่อ call ให้สั้นลง — ตัดงานปกติที่ช้าบ้างทิ้ง (p95 6.1 วิ) โดยไม่ได้แก้ต้นเหตุ
 * - เก็บสถานะใน DB — ต้องยิงฐานทุก call เพื่อกันเหตุที่เกิด 3 ครั้งในสามเดือน · โปรเซสเดียวอยู่แล้ว
 * - ถอยไปโมเดล/ผู้ให้บริการอื่น — CLAUDE.md กำหนดให้เรียกผ่าน DeepSeek ตัวเดียว
 *
 * ไฟล์นี้ไม่ import อะไร และรับนาฬิกาจากข้างนอกได้ ⇒ ด่าน `diag:llm-circuit` เล่นซ้ำเหตุการณ์จริง
 * ด้วยเวลาจำลองได้โดยไม่ต้องรอจริง
 */

export const CIRCUIT_TRIP_COUNT = 3;
export const CIRCUIT_WINDOW_MS = 120_000;
export const CIRCUIT_OPEN_MS = 60_000;

/** โยนตอนงดเรียก — ผู้เรียกที่มี retry ของตัวเองควรหยุดลองทันที (`isLlmUnavailable`) */
export class LlmUnavailableError extends Error {
  readonly llmUnavailable = true;
  constructor(readonly retryAfterMs: number) {
    super(`งดเรียก AI ชั่วคราว (ล่มต่อเนื่อง) — อีก ${Math.ceil(retryAfterMs / 1000)} วิ`);
    this.name = 'LlmUnavailableError';
  }
}

export function isLlmUnavailable(err: unknown): boolean {
  return !!(err && typeof err === 'object' && (err as any).llmUnavailable === true);
}

export type CapHitResult = 'counted' | 'opened' | 'extended';

export function createLlmCircuit(opts: {
  now?: () => number;
  tripCount?: number;
  windowMs?: number;
  openMs?: number;
} = {}) {
  const now = opts.now ?? Date.now;
  const tripCount = opts.tripCount ?? CIRCUIT_TRIP_COUNT;
  const windowMs = opts.windowMs ?? CIRCUIT_WINDOW_MS;
  const openMs = opts.openMs ?? CIRCUIT_OPEN_MS;
  let hits: number[] = [];
  let openUntil = 0;

  return {
    /** เหลือเวลางดอีกกี่ ms · 0 = เรียกได้ */
    openRemainingMs(): number {
      return Math.max(0, openUntil - now());
    },
    /** call หนึ่งโดนเพดานตัด — call ที่เริ่มก่อนงดแล้วมาโดนตัดระหว่างงด จะยืดช่วงงดออกไป */
    recordCapHit(): CapHitResult {
      const t = now();
      hits = hits.filter(h => t - h < windowMs);
      hits.push(t);
      if (hits.length < tripCount) return 'counted';
      const wasOpen = openUntil > t;
      openUntil = t + openMs;
      return wasOpen ? 'extended' : 'opened';
    },
    /** ปลายทางตอบได้จริง ⇒ หลักฐานว่าหายล่มแล้ว */
    recordSuccess(): void {
      hits = [];
      openUntil = 0;
    },
  };
}

/** ตัวเดียวของทั้งโปรเซส — createChatCompletion ใช้ */
export const llmCircuit = createLlmCircuit();
