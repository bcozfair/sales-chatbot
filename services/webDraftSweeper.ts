import { pool } from '../config/db.js';
import { deleteStaleWebDrafts } from '../db/repositories.js';

/**
 * ตัวลบ "ร่างจากหน้าเว็บที่ถูกทิ้งไว้" ตามอายุ (เจ้าของสั่ง 2026-10-07 · เกิน 7 วัน)
 *
 * ─── ทำไมต้องมี ──────────────────────────────────────────────────────────────
 * หน้าเว็บขอใบเสนอราคาเขียนร่างลงฐานแค่ตอนกดยืนยัน แล้วยืนยันต่อทันที (ร่างอยู่ไม่ถึงสองวินาที)
 * แต่ถ้าขั้นออกเลขที่ล้ม (ของหมดพอดี · เน็ตหลุด · ปิดแท็บระหว่างหมุน) ร่างจะค้าง และตัวกวาดเดียว
 * ที่มีคือใน insertDraftQuotations ซึ่งลบเฉพาะร่างของ "คู่ (แอดมิน × เซลส์) เดิม" ตอนคู่นั้นออกใบอีก
 * — ช่อง "ออกในนาม" เปลี่ยนตามลูกค้า คู่เดิมจึงอาจไม่กลับมาอีกเลย ⇒ ร่างค้างไม่มีกำหนด
 * (เคสจริง: ร่างวนชัย 2026-10-05 ค้างทั้งที่แอดมินคนเดิมออกใบต่ออีก 5 ใบ ในนามเซลส์คนอื่นทั้งหมด)
 * ทางเข้าที่ทำให้ค้างบ่อยที่สุด ("แก้ใบเดิม" สร้างร่างทันทีที่เลือกใบ) ถูกปิดที่ต้นเหตุแล้วใน
 * reviseQuotation · ตัวนี้คือตาข่ายของกรณีที่เหลือ
 *
 * ─── ขอบเขต ──────────────────────────────────────────────────────────────────
 * เงื่อนไขทั้งหมดอยู่ที่ `STALE_WEB_DRAFT_SQL` (db/repositories.ts) ที่เดียว — ไม่แตะร่างของ LINE
 * และไม่แตะร่างที่ผูกคำขออนุมัติราคา · ลบทั้งแถว ไม่ใช่มาร์ก `cancelled` เพราะ `cancelled` แปลว่า
 * "มีคนกดยกเลิก" เสมอ (CLAUDE.md) และร่างไม่มีเลขที่ = ลบ ตามกติกาของปุ่มยกเลิกทุกเส้น
 * ประวัติว่าเคยมีร่างนี้ยังอยู่ใน `messages` (`web_draft` · `meta.quote_ids`) และใน log บรรทัดที่พิมพ์ข้างล่าง
 *
 * ─── จังหวะ ──────────────────────────────────────────────────────────────────
 * ทุกชั่วโมง รอบแรกหลัง boot 10 นาที (ไม่แย่งตอนสตาร์ต) · ตารางเล็ก (~3,000 แถว · 2026-10-07) จึงเป็น
 * DELETE คำสั่งเดียวไม่ต้องแบ่งก้อน · ห้าม throw — เป็นงานเก็บกวาด พังได้โดยไม่กระทบใคร
 * ไม่เริ่มในพรีวิวร่วม (PREVIEW_MODE) เพราะพรีวิวใช้ฐานตัวจริง — ตัวจริงเป็นคนลบคนเดียว
 */

/** อายุของร่างที่ถือว่าถูกทิ้ง — นับจากครั้งสุดท้ายที่มีคนแตะ (`updated_at`) */
export const STALE_WEB_DRAFT_DAYS = 7;

const TICK_MS = 60 * 60 * 1000;
const START_DELAY_MS = 10 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

/** หนึ่งรอบ — คืนจำนวนที่ลบ (หรือ null ถ้าพัง) · ห้าม throw */
export async function sweepStaleWebDrafts(): Promise<number | null> {
  try {
    const rows = await deleteStaleWebDrafts(pool, STALE_WEB_DRAFT_DAYS);
    if (rows.length > 0) {
      console.log(
        `[web-draft-sweep] ลบร่างจากหน้าเว็บที่ค้างเกิน ${STALE_WEB_DRAFT_DAYS} วัน ${rows.length} ใบ: ` +
        rows.map((r) => `${r.id} (${r.user_id})`).join(', '));
    }
    return rows.length;
  } catch (err: any) {
    console.error('[web-draft-sweep] ลบร่างค้างไม่สำเร็จ (รอบหน้าลองใหม่):', err?.message ?? err);
    return null;
  }
}

/** เรียกครั้งเดียวหลัง app.listen */
export function initWebDraftSweeper(): void {
  if (timer) { clearTimeout(timer); clearInterval(timer); }
  timer = setTimeout(() => {
    void sweepStaleWebDrafts();
    timer = setInterval(() => { void sweepStaleWebDrafts(); }, TICK_MS);
  }, START_DELAY_MS);
}

/** ใช้ตอน graceful shutdown — timer เป็น setTimeout ในช่วงแรกแล้วกลายเป็น setInterval */
export function stopWebDraftSweeper(): void {
  if (timer) { clearTimeout(timer); clearInterval(timer); timer = null; }
}
