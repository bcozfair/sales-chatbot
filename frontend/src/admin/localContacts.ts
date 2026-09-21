/**
 * กติกา "ใครคือผู้ติดต่อที่แอดมินเพิ่มเอง" ฝั่งหน้าจอ — ที่เดียว
 *
 * แยกออกมาจาก `LocalContactModal.tsx` เพราะไฟล์คอมโพเนนต์ที่ export ของที่ไม่ใช่คอมโพเนนต์
 * ทำให้ fast refresh ของ Vite ใช้ไม่ได้ทั้งไฟล์ (กฎ react-refresh/only-export-components)
 *
 * ค่าเดียวกับ `LOCAL_CONTACT_ID_MIN` ฝั่ง server (`db/localContactsRepo.ts`) และกับ CHECK
 * `local_contacts_id_range` ในฐาน — ที่นี่เป็นแค่ "รู้ไว้เพื่อโชว์ปุ่มให้ถูก" ไม่ใช่ด่าน
 * ด่านจริงอยู่ที่ service ฝั่ง server ซึ่งอ่านจากตาราง ไม่ได้เดาจากช่วงเลข
 */
export const LOCAL_CONTACT_ID_MIN = 900000000;

/** คนที่เลือกอยู่เป็นคนที่เราเพิ่มเองไหม — ตัวตัดสินว่าจะโชว์ปุ่มแก้/ลบข้างช่องหรือไม่ */
export function isLocalContactId(id: number | null | undefined): id is number {
  return typeof id === 'number' && Number.isFinite(id) && id >= LOCAL_CONTACT_ID_MIN;
}
