/**
 * apiError — แปลง error ที่ API ตอบกลับมา ให้เป็นประโยคที่คนอ่านบนจอรู้เรื่อง **ที่เดียวของแอดมิน**
 *
 * ทำไมต้องมี (เจ้าของสั่งแก้ 2026-09-18): เวลาใบติดด่านตรวจ server ตอบ
 *   { "error": "VALIDATION_ERROR", "violations": [ { …, "display_message": "…ประโยคไทย…" } ] }
 * แต่หน้าจอหยิบแค่ `error` มาแสดง ⇒ แอดมินเห็นคำว่า **VALIDATION_ERROR** ลอย ๆ ทั้งที่ประโยค
 * ที่บอกว่าติดกฎข้อไหนเดินทางมาถึงหน้าจอแล้วในก้อนเดียวกัน · เกิดที่หน้า "ขอใบเสนอราคา"
 * (ตอนกดยืนยันแล้วมีกฎข้อใหม่โผล่ระหว่างทาง) และที่หน้าคิวอนุมัติราคา (ตอนอนุมัติแล้วออกใบไม่ผ่าน)
 *
 * กติกา: **มี `violations` เมื่อไหร่ให้ใช้ประโยคของมันเสมอ** ไม่มีจึงค่อยตกไปใช้ `error` เหมือนเดิม
 * — `error` ยังมีประโยชน์กับ error ที่ไม่ใช่เรื่องกฎ (เช่น ข้อความจาก confirmFailureMessage()
 * ของ services/quotationConfirm.ts ซึ่งเป็นภาษาไทยมาแล้วตั้งแต่ฝั่ง server)
 *
 * ⚠️ ผลลัพธ์คั่นรายข้อด้วยการขึ้นบรรทัดใหม่ — กล่องแดงของหน้า "ขอใบเสนอราคา" ตั้ง `whitespace-pre-wrap` ไว้จึง
 * ขึ้นบรรทัดให้ ส่วน `ErrorBox` ที่หน้าคิวอนุมัติใช้ **ไม่ได้ตั้ง** ⇒ ฝั่งนั้นต่อรายข้อด้วย " · " เอง
 * ก่อนส่งเข้ากล่อง (ดู approve() ใน PriceApprovals.tsx) · ใครเอาไปใช้ที่ใหม่ให้เช็กกล่องปลายทางก่อน
 */

/** รูปร่างเท่าที่ฟังก์ชันนี้ต้องใช้ — ตัวเต็มของ violation อยู่ที่ services/quotationService.ts */
type ApiErrorBody = {
  error?: unknown;
  violations?: unknown;
};

/** ประโยคของแต่ละข้อที่ติด — ข้อที่ไม่มี display_message (ไม่ควรมี) ถูกข้ามไป ไม่ใช่โชว์ว่าง ๆ */
function violationLines(body: ApiErrorBody): string[] {
  if (!Array.isArray(body?.violations)) return [];
  return body.violations
    .map((v) => String((v as { display_message?: unknown })?.display_message ?? '').trim())
    .filter((msg) => msg.length > 0);
}

export function describeApiError(body: ApiErrorBody, fallback: string): string {
  const lines = violationLines(body);
  if (lines.length > 0) {
    return `${fallback} — ติดด่านตรวจ ${lines.length} ข้อ\n${lines.map((l) => `• ${l}`).join('\n')}`;
  }
  return String(body?.error || fallback);
}
