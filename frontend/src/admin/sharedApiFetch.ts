/**
 * fetch ของ "เส้นที่หน้าแอดมินใช้ร่วมกับหน้า LIFF" — ค้นสินค้า · ค้นลูกค้า · ผู้ติดต่อ · ค่าขนส่ง ·
 * รายชื่อเซลส์ · ยืนยันใบ (ขั้น 2 ของการยืนยันตัวตน LIFF · เจ้าของสั่ง 2026-10-07)
 *
 * แนบ token แอดมินไปด้วย — วันนี้ server ยังไม่บังคับ แค่นับว่าเรียกมาจากแอดมิน (config/liffAuthObserve.ts)
 * ⇒ วันที่เส้นพวกนี้เริ่มบังคับตัวตน หน้าแอดมินจะไม่พัง · **เรียกเส้นเหล่านี้ด้วย fetch เปล่า ๆ ไม่ได้**
 * (`npm run diag:liff-auth` ตรวจซอร์สให้)
 *
 * อ่าน token จาก sessionStorage คีย์เดียวกับ AuthContext เพราะหลายจุดเป็นคอมโพเนนต์ที่ไม่มี useAuth
 * (ProductComboBox · ช่องค้นสินค้าในหน้าขอใบเสนอราคา · LocalProductModal) — ส่ง token ผ่าน props
 * ทุกชั้นแก้ไฟล์มากกว่าโดยไม่ได้อะไรเพิ่ม · มี Authorization มาแล้ว = ไม่ทับ
 */
export function sharedApiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let token: string | null;
  try {
    token = sessionStorage.getItem('admin_token');
  } catch {
    token = null;
  }
  const headers = new Headers(init.headers);
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
