/**
 * กติกา "สินค้าตัวไหนเป็นสินค้าที่แอดมินเพิ่มเอง" ฝั่งหน้าจอ — ที่เดียว (ฝาแฝดของ `localContacts.ts`)
 * + เกณฑ์ "ราคาครบพอจะเติมให้" (`isFullPrice`) ที่สองทางเข้าของหน้าต่างเพิ่มสินค้าใช้ร่วมกัน
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

/** ผลคิดราคา (`POST /pricing/quote` = `POST /webquote/products/price`) เท่าที่ `isFullPrice` ต้องดู */
export interface PriceCheckInput {
  parsed?: { problems?: string[]; parts?: { kind: string }[] } | null;
  outcome?: { status: string; unitPrice: number; violations?: { level?: string; partial?: boolean }[] } | null;
}

/**
 * ราคาครบพอจะเติมลงช่องราคาขายของสินค้าเพิ่มเองให้เองไหม — **ที่เดียว** ใช้ทั้งหน้าคำนวณราคา (ปุ่ม "เพิ่มเป็นสินค้าใหม่")
 * และปุ่มคิดราคาในหน้าต่างเพิ่มสินค้า (เติมลงช่องทันที · เจ้าของสั่ง 2026-10-02)
 * ครบ = `priced` · มากกว่า 0 · ไม่มีกฎที่ข้ามเพราะอ่านค่าไม่ออก (`partial`) · ไม่มีท่อนที่อ่านไม่ออก/ยังต้องเลือก ·
 * ไม่ติดกฎบล็อก · ไม่มีปัญหาของรหัส — ขาดข้อใด = ไม่เติม ให้คนกรอกเอง (ราคาครึ่งเดียวห้ามหลุดเข้าใบ)
 */
export function isFullPrice(r: PriceCheckInput | null | undefined): boolean {
  const o = r?.outcome;
  return !!o && o.status === 'priced' && o.unitPrice > 0
    && !(o.violations ?? []).some((v) => v.partial || v.level === 'block')
    && !(r?.parsed?.parts ?? []).some((p) => p.kind === 'unknown' || p.kind === 'choose')
    && (r?.parsed?.problems ?? []).length === 0;
}

/** สินค้าที่เพิ่ม/เลือกสำเร็จ — รูปเดียวกับผลค้น `/api/products/search` ที่ช่องค้นในใบใช้อยู่ */
export interface PickedProduct {
  product_id: number;
  model: string;
  name: string;
  price: number | string;
  stock?: number | string;
}
