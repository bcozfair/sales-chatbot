/**
 * ชนิดของแถวใน `messages` ที่ไม่ได้มาจาก handleEvent — จุดเดียวที่รู้จัก prefix `wh_`
 *
 * ## ทำไมไฟล์นี้ถึงมี
 *
 * `messages` เป็นสองอย่างในตารางเดียว: **ความจำการสนทนาของบอท** (quoteExtraction อ่าน 10 แถว
 * ล่าสุดยัดเข้า prompt) และ **ประวัติแชทให้คนสอบกลับ** · handleEvent เขียนแถวเองแค่ 7 จุด จาก
 * ~50 ทางตอบ ⇒ event ที่ตอบแล้วแต่ไม่มีแถว ~21.6 ครั้ง/วัน (วัด 2026-10-02: กดเลือกสินค้า 77 ·
 * ผู้ติดต่อ 44 · ข้อความ 32 · บริษัท 22 · เมนูแก้ 13 · ยืนยัน 4 · ยกเลิก 2 ใน 9 วัน)
 * เจ้าของสั่ง 2026-10-02 ให้เก็บส่วนที่ขาดลงตารางเดิม แต่ **บอทต้องเหมือนเดิม 100%**
 * ⇒ แถวที่ตัวบันทึก webhook ใน index.ts เติมให้ (services/webhookRecorder.ts) มี type ขึ้นต้น
 * `wh_` และทุกจุดที่ป้อน LLM ต้องกรองออกด้วย `excludeWebhookFillSql()`
 *
 * ## ทางที่ไม่ได้เลือก
 *
 * - `type NOT LIKE 'wh_%'` — `_` เป็น wildcard ของ LIKE (แถว `whXpostback` จะหายด้วย) และ
 *   `NULL NOT LIKE …` เป็น NULL ⇒ แถวที่ type ว่างหายจากประวัติเงียบ ๆ (วันนี้ 0 แถว แต่คอลัมน์ nullable)
 *   ⇒ ใช้ `left(type, n) IS DISTINCT FROM 'wh_'` ซึ่งคืน true ให้ NULL
 * - คอลัมน์ธงแยก — ต้องแก้ schema ของตารางที่ใหญ่ที่สุดของแชท และทุกผู้อ่านเดิมต้องรู้จักมันอยู่ดี
 *
 * ไฟล์นี้ไม่ import อะไรเลย ⇒ สคริปต์วัดผลใน scripts/diag/ ดึงไปใช้ได้โดยไม่ลาก pool มาด้วย
 * **`'wh_'` เขียนตรง ๆ ได้ที่ไฟล์นี้ที่เดียว** (ด่าน diag:webhook-recorder อ่านซอร์สตรวจ)
 */

export const WEBHOOK_FILL_PREFIX = 'wh_';

/** type ของแถวเติม เช่น `postback` → `wh_postback` */
export function webhookFillType(kind: string): string {
  return `${WEBHOOK_FILL_PREFIX}${kind}`;
}

export function isWebhookFillType(type: unknown): boolean {
  return typeof type === 'string' && type.startsWith(WEBHOOK_FILL_PREFIX);
}

/**
 * เงื่อนไข SQL "ไม่ใช่แถวเติม" — ต่อท้าย WHERE ด้วย `AND`
 * @param alias ชื่อตารางที่ใช้ใน query (`'b'` → `left(b.type, 3) …`) · ไม่ส่ง = ไม่ใส่ alias
 *
 * ค่าคงที่ทั้งสองตัวเป็นของไฟล์นี้เอง ไม่ใช่ input ⇒ ต่อเป็นสตริงได้โดยไม่เปิดช่อง injection
 * (alias ต้องเป็นชื่อที่ผู้เรียกเขียนตายตัวไว้ในโค้ด ห้ามรับจากภายนอก)
 */
export function excludeWebhookFillSql(alias?: string): string {
  const a = alias ? `${alias}.` : '';
  return `left(${a}type, ${WEBHOOK_FILL_PREFIX.length}) IS DISTINCT FROM '${WEBHOOK_FILL_PREFIX}'`;
}
