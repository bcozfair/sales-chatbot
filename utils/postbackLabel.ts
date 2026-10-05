/**
 * ข้อมูลดิบของปุ่ม LINE (`postback.data`) → คำอ่านง่าย เช่น `action=confirm&id=a,b` → "กดยืนยันใบเสนอราคา (2 ใบ)"
 *
 * **ฟังก์ชันเดียวของทั้งระบบ** (docs/plan-message-log-merge.md) — หน้าบันทึก (เฟส 2) ใช้ตอนนี้ ·
 * การทดลองให้บอทจำปุ่ม (เฟส 3) ต้องเรียกตัวนี้ ห้ามเขียนตารางคำแปลซ้ำ ไม่งั้นจอกับ prompt จะเรียกปุ่มเดียวกันคนละชื่อ
 *
 * ## ทำไมแปลงตอนอ่าน ไม่ใช่ตอนเขียน
 * ตัวบันทึก webhook เก็บ data ดิบ (`[กดปุ่ม] action=…` ใน messages · `postback_data` ใน webhook_events)
 * โดยตั้งใจ — ชื่อสินค้า/บริษัทหาย้อนหลังไม่ได้ (select_product ชี้ตำแหน่ง ไม่ใช่รหัส) และคำแปลเปลี่ยนได้
 * โดยไม่ต้องแก้ข้อมูลเก่า · ⇒ ไม่ query ฐานเพิ่ม: คำอ่านบอก "กดอะไร" ไม่บอก "กดตัวไหน" (ข้อมูลดิบอยู่ใต้คำอ่านเสมอ)
 *
 * action ที่รู้จัก = ทุกตัวที่ handlers/lineHandler.ts + utils/flexTemplates.ts สร้าง (ไล่ 2026-10-05) ·
 * ไม่รู้จัก = "กดปุ่ม (action=…)" ไม่เดา · ฟังก์ชันบริสุทธิ์ ไม่ import อะไร ⇒ สคริปต์ดึงไปใช้ได้โดยไม่ลาก pool มาด้วย
 */

const POSTBACK_PREFIX = /^\s*\[กดปุ่ม\]\s*/;

const EDIT_FIELD: Record<string, string> = {
  name: ' (ชื่อ)',
  phone: ' (เบอร์โทร)',
  salesperson_id: ' (รหัสพนักงาน)',
};

const EDIT_MENU: Record<string, string> = {
  quotation: 'กดเมนูแก้ไขใบเสนอราคา',
  branches: 'กดเมนูแก้ไขสาขา',
};

/** "1" → 2 (นับจากหนึ่ง) · อ่านไม่ออก = null */
function ordinal(v: string | null): number | null {
  if (v === null || !/^\d+$/.test(v)) return null;
  return Number(v) + 1;
}

export function postbackLabel(data: string | null | undefined): string {
  const raw = String(data ?? '').replace(POSTBACK_PREFIX, '');
  const p = new URLSearchParams(raw);
  const action = p.get('action');
  const ids = (p.get('id') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const many = ids.length > 1 ? ` (${ids.length} ใบ)` : '';

  switch (action) {
    case 'select_company': return 'กดเลือกบริษัท';
    case 'select_contact': return 'กดเลือกผู้ติดต่อ';
    case 'select_product': {
      const slot = ordinal(p.get('slot'));
      const pick = ordinal(p.get('pick'));
      const where = slot !== null && pick !== null ? ` (รายการที่ ${slot} · ตัวเลือกที่ ${pick})` : '';
      return `กดเลือกสินค้า${where}`;
    }
    case 'confirm': return `กดยืนยันใบเสนอราคา${many}`;
    case 'cancel': return `กดยกเลิกใบเสนอราคา${many}`;
    case 'cancel_pending': return 'กดยกเลิกการออกใบที่ค้างอยู่';
    case 'edit_menu': return EDIT_MENU[p.get('sub') ?? ''] ?? 'กดเมนูแก้ไข';
    case 'edit_btn': return `กดแก้ไขข้อมูลเซลส์${EDIT_FIELD[p.get('field') ?? ''] ?? ''}`;
    case 'edit_profile': return 'กดแก้ไขข้อมูลส่วนตัว';
    case 'confirm_profile': return 'กดยืนยันข้อมูลลงทะเบียน';
    default: return `กดปุ่ม (action=${action || '?'})`;
  }
}
