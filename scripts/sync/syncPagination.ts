// ============================================================
// Logic การตัดสินใจของ cursor-pagination loop ที่ sync ทั้ง 3 ตัวใช้ร่วมกัน
//
// ทำไมแยกออกมา: เดิม loop ถูก copy เหมือนกันใน syncCustomers / syncSaleorders /
// syncProducts รวมถึง "จุดบั๊ก silent truncation" — ตอน has_more=true แต่ cursor
// ไม่ขยับ โค้ดเดิม COMMIT แล้ว break เฉย ๆ ทำให้ startSync บันทึกเป็น success
// ทั้งที่กวาดยังไม่จบ (ข้อมูลหายเงียบ) แก้ที่เดียวไม่ครบ 3 ที่เมื่อไหร่จะเพี้ยนกันเงียบ ๆ
// เหมือนที่ gatewayClient.ts เคยโดน
//
// ฟังก์ชันนี้เป็น pure (ไม่แตะ DB/network) จึง unit test ได้ตรง ๆ
// ============================================================

export interface PageTransitionInput {
  /** payload.has_more จาก gateway */
  hasMore: boolean;
  /** payload.next_cursor */
  nextCursor: string | null | undefined;
  /** cursor ของหน้าที่เพิ่งดึง (null = หน้าแรก since=1970) */
  previousCursor: string | null;
  /** จำนวนครั้งที่ retry เพราะ cursor ไม่ขยับ (reset เป็น 0 ทุกครั้งที่ cursor ขยับจริง) */
  stallRetries: number;
  /** เพดาน retry ตอน cursor ไม่ขยับ ก่อนจะยอมแพ้แล้ว throw */
  maxStallRetries: number;
}

export type PageTransition =
  | { action: 'complete' }                 // has_more=false → flip incremental, save final cursor, break
  | { action: 'advance' }                  // เลื่อนไป nextCursor แล้วดึงหน้าถัดไป
  | { action: 'retry-stall' }              // cursor ไม่ขยับ แต่ยัง retry ได้ → ดึง cursor เดิมซ้ำ
  | { action: 'error'; reason: string };   // ต้อง throw (จะถูกบันทึกเป็น failed ไม่ใช่ success ปลอม)

/** เพดาน retry ตอน cursor ไม่ขยับ — เผื่อ gateway คืนหน้าซ้ำชั่วคราวตอน flaky */
export const MAX_STALL_RETRIES = 2;

/**
 * ตัดสินว่าจะทำอะไรต่อหลังดึง 1 หน้า
 *
 * หัวใจของการแก้ silent truncation: เมื่อ has_more=true แต่ cursor ไม่ขยับ
 * ต้องไม่ "จบแบบสำเร็จ" — retry ก่อน ถ้ายังไม่ขยับก็ throw เพื่อให้ startSync
 * บันทึกเป็น failed (จะได้รู้ว่ากวาดไม่ครบ ไม่ใช่เข้าใจผิดว่า sync จบสมบูรณ์)
 */
export function decidePageTransition(input: PageTransitionInput): PageTransition {
  const { hasMore, nextCursor, previousCursor, stallRetries, maxStallRetries } = input;

  if (!hasMore) return { action: 'complete' };

  if (!nextCursor || typeof nextCursor !== 'string') {
    return { action: 'error', reason: 'has_more=true but next_cursor is missing/invalid' };
  }

  if (nextCursor === previousCursor) {
    if (stallRetries < maxStallRetries) return { action: 'retry-stall' };
    return {
      action: 'error',
      reason: `sync stalled: has_more=true but next_cursor did not advance after ${maxStallRetries} retries — sweep incomplete, refusing to report success`,
    };
  }

  return { action: 'advance' };
}

// ============================================================
// ตัวตัดสินของ sale_order v3 — ไม่เชื่อ has_more ตัวเดียว
//
// v3 เคยตอบ has_more=false ตั้งแต่หน้าแรกทั้งที่ next_cursor เดินต่อได้ (Appsale เจอ 2026-08-21:
// Full Sync ได้ 681 แถวจาก 593,273 แต่ขึ้น "สำเร็จ") · วัด 2026-10-05 ตอบ true ปกติ แต่ไม่มีใครรับประกัน
// ⇒ เกณฑ์ "จบ" คือหน้าว่าง · หน้ามีข้อมูลและ cursor ขยับ = ไปต่อเสมอ (เสียหน้าว่างเพิ่ม 1 หน้าต่อรอบ)
// cursor เป็น keyset (V3 Updated At, Sale Order ID) — หน้าว่างแปลว่าไม่มีใบไหนอยู่หลังจุดนี้แล้วจริง
//
// ยกเว้นรอบ incremental (stopOnShortPage · ตั้งแต่ 2026-10-05): หน้าที่ได้ใบไม่เต็ม limit = จบรอบเลย
// เพราะ v3 ใช้ 6–8 วิต่อครั้งคงที่ไม่ว่าจะได้กี่ใบ (วัด 2026-10-05 · v2 0.2 วิ) หน้าว่างที่ยิงไว้ยืนยัน
// จึงกินครึ่งหนึ่งของรอบ (22 วิ → ~13 วิ) · ไม่ทำข้อมูลหาย: cursor ของหน้านั้นถูกบันทึกแล้ว ถ้ายังมีใบเหลือ
// (หน้าไม่เต็มกลางทาง) รอบถัดไปดึงต่อจากจุดเดิม = ช้าไปหนึ่งรอบ ไม่ใช่หล่น
// การกวาดเต็ม (sync_mode='full') ห้ามใช้ข้อนี้ — มันจะประกาศว่ากวาดจบทั้งที่ยังเหลือหลายแสนใบ
// ============================================================

export interface V3PageTransitionInput extends PageTransitionInput {
  /** จำนวนแถวใน payload.data ของหน้านี้ */
  rowCount: number;
  /** payload.sale_order_count — หน่วยเดียวกับ limit (ใบ ไม่ใช่แถว) · ไม่มีค่า = ถือว่าเต็มหน้า (ไปต่อ) */
  orderCount?: number | null;
  /** limit ที่ขอไปในหน้านี้ */
  pageLimit?: number;
  /** รอบ incremental เท่านั้น — หน้าไม่เต็ม limit = จบรอบ (ดูหัวข้อด้านบน) */
  stopOnShortPage?: boolean;
}

export function decideV3PageTransition(input: V3PageTransitionInput): PageTransition {
  const { rowCount, hasMore, nextCursor, previousCursor, stallRetries, maxStallRetries } = input;

  if (rowCount === 0) return { action: 'complete' };

  const validNext = typeof nextCursor === 'string' && nextCursor.length > 0;
  if (!validNext) {
    // มีข้อมูลแต่ไม่บอกทางไปต่อ — ถ้า gateway ยังยืนยันว่ามีอีก = ไปต่อไม่ได้จริง ห้ามรายงานว่าสำเร็จ
    return hasMore
      ? { action: 'error', reason: 'v3: page has rows and has_more=true but next_cursor is missing/invalid' }
      : { action: 'complete' };
  }

  if (nextCursor === previousCursor) {
    if (!hasMore) return { action: 'complete' };
    if (stallRetries < maxStallRetries) return { action: 'retry-stall' };
    return {
      action: 'error',
      reason: `v3 sync stalled: next_cursor did not advance after ${maxStallRetries} retries — sweep incomplete, refusing to report success`,
    };
  }

  // หลังเช็ก cursor แล้วเท่านั้น — หน้าไม่เต็มที่ cursor ไม่ขยับยังต้อง retry/throw เหมือนเดิม
  const { orderCount, pageLimit, stopOnShortPage } = input;
  if (stopOnShortPage && typeof orderCount === 'number' && typeof pageLimit === 'number' && orderCount < pageLimit) {
    return { action: 'complete' };
  }

  return { action: 'advance' };
}
