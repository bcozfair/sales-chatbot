/**
 * กติกา "สินค้าตัวไหนเป็นสินค้าที่แอดมินเพิ่มเอง" ฝั่งหน้าจอ — ที่เดียว (ฝาแฝดของ `localContacts.ts`)
 *
 * แยกจาก `LocalProductModal.tsx` เพราะไฟล์คอมโพเนนต์ที่ export ของที่ไม่ใช่คอมโพเนนต์
 * ทำให้ fast refresh ของ Vite ใช้ไม่ได้ทั้งไฟล์ (กฎ react-refresh/only-export-components)
 *
 * ค่าเดียวกับ `LOCAL_PRODUCT_ID_MIN` ฝั่ง server (`db/localProductsRepo.ts`) และ CHECK
 * `local_products_id_range` ในฐาน — ที่นี่แค่ "รู้ไว้เพื่อติดป้ายให้ถูก" ไม่ใช่ด่าน
 * · พอสินค้าเข้า Odoo แล้ว แถวใน `products` จะเป็น id ของ Odoo (ต่ำกว่าช่วงนี้) ⇒ ค้นใหม่แล้วป้ายหายเอง
 */
export const LOCAL_PRODUCT_ID_MIN = 900000000;

export function isLocalProductId(id: number | null | undefined): id is number {
  return typeof id === 'number' && Number.isFinite(id) && id >= LOCAL_PRODUCT_ID_MIN;
}

/** สินค้าที่เพิ่ม/เลือกสำเร็จ — รูปเดียวกับผลค้น `/api/products/search` ที่ช่องค้นในใบใช้อยู่ */
export interface PickedProduct {
  product_id: number;
  model: string;
  name: string;
  price: number | string;
  stock?: number | string;
}
