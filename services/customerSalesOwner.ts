// ─────────────────────────────────────────────────────────────────────────────
//  customerSalesOwner — "ใบนี้ควรออกในนามเซลส์คนไหน" ตอบจากข้อมูล ไม่ต้องให้คนจำ
//  ใช้ที่เดียว: ช่อง "ออกในนาม" ของหน้าเว็บขอใบเสนอราคา (role ที่เลือกเซลส์คนไหนก็ได้)
//  แผน: docs/plan-web-quote-auto-salesperson.md
//
//  มีเพราะแอดมิน/ผู้อนุมัติจำไม่ได้ว่าลูกค้ารายไหนเป็นของเซลส์คนไหน (เจ้าของ 2026-09-24)
//  ⇒ ช่องเริ่มต้นว่าง แล้วระบบเติมให้เมื่อรู้ลูกค้า · เลือกทับเองได้เสมอ
//
//  คำถามสองข้อ สองแหล่ง:
//     1. ใบใหม่ → เซลส์เจ้าของ "บริษัท" ใน `customers_data_view` (คนแรกที่ไม่ว่าง ตาม contact_id)
//     2. แก้ใบเดิม → เซลส์ของ "ใบต้นทาง" (เจ้าของเคาะ 2026-09-24) ไม่ใช่ของลูกค้าในวันนี้
//        เพราะ revision คือใบเดิมที่ลูกค้าถืออยู่ ผู้ลงนามต้องไม่เปลี่ยนเงียบ ๆ
//
//  ⚠️ คำตอบต้องเป็น "ตัวเลือกที่มีอยู่ใน dropdown" เสมอ — ผู้เรียกส่งรายชื่อที่ยุบซ้ำแล้ว
//     (`listSalespersonsForWeb()`) เข้ามา ไม่ใช่ให้ไฟล์นี้ไปอ่านตาราง `salesperson` เอง ไม่งั้น
//     จะได้ user_id ของแถวที่ถูกยุบทิ้ง แล้ว dropdown โชว์ "ยังไม่เลือก" ทั้งที่มีค่าตั้งอยู่
//  ⚠️ **ไม่เดาแทน** — หาไม่เจอ = บอกว่าหาไม่เจอพร้อมชื่อใน Odoo ห้ามถอยไปใช้ "คนที่เลือกล่าสุด"
//     เพราะใบจะออกในนามคนผิดโดยไม่มีใครรู้ ซึ่งแย่กว่าการให้คนเลือกเอง
//  ⚠️ ไม่ใช่ด่านสิทธิ์ — การออกในนามใครได้/ไม่ได้ยังตัดสินที่ `assertMayActAs()` ตามเดิม
//     ไฟล์นี้แค่ "เสนอค่า" และห้าม throw
// ─────────────────────────────────────────────────────────────────────────────
import { getCompanySalesperson, getSalespersonByUserId } from '../db/repositories.js';
import type { PickedSalesperson } from './salespersonPicker.js';

export type SalesOwner =
  /** เจอคนในรายชื่อ "ออกในนาม" — `user_id` ใช้เป็น `sp_user_id` ได้ทันที */
  | { status: 'resolved'; user_id: string; name: string; salesperson_id: string | null; odoo_name: string | null }
  /** รู้ว่าใครเป็นเจ้าของ แต่คนนั้นออกใบในนามไม่ได้ (ไม่ active / บัญชีระบบอย่าง `purchase_user_1`) */
  | { status: 'inactive'; odoo_name: string | null; salesperson_id: string | null }
  /** ไม่มีข้อมูลเจ้าของเลย */
  | { status: 'none' };

/**
 * หาตัวเลือกของ dropdown จากรหัสพนักงาน (หรือ user_id) — ฟังก์ชันบริสุทธิ์ ด่านทดสอบได้ตรง ๆ
 *
 * `userId` มาก่อนรหัสเมื่อส่งมา เพราะแถวที่ไม่มีรหัสถูกจับกลุ่มด้วยชื่อ (`groupKey()` ของ
 * salespersonPicker) ⇒ ถามด้วยรหัสอย่างเดียวจะหาแถวพวกนั้นไม่เจอ · แถวที่ถูกยุบทิ้งตามหาผ่าน
 * `merged_user_ids` แล้วคืนตัวแทนของกลุ่มแทน
 */
export function matchOption(
  options: PickedSalesperson[],
  code: string | null,
  userId?: string | null
): PickedSalesperson | null {
  const uid = String(userId ?? '').trim();
  if (uid !== '') {
    const byUser = options.find((o) => o.user_id === uid || o.merged_user_ids.includes(uid));
    if (byUser) return byUser;
  }
  const c = String(code ?? '').trim();
  if (c === '') return null;
  return options.find((o) => String(o.salesperson_id ?? '').trim() === c) ?? null;
}

function toOwner(opt: PickedSalesperson | null, odooName: string | null, code: string | null): SalesOwner {
  if (opt) {
    return { status: 'resolved', user_id: opt.user_id, name: opt.name, salesperson_id: opt.salesperson_id, odoo_name: odooName };
  }
  if (odooName === null && code === null) return { status: 'none' };
  return { status: 'inactive', odoo_name: odooName, salesperson_id: code };
}

/** ใบใหม่: เซลส์เจ้าของบริษัทตาม Odoo */
export async function resolveCustomerSalesOwner(
  companyId: number,
  options: PickedSalesperson[]
): Promise<SalesOwner> {
  if (!Number.isFinite(companyId) || companyId <= 0) return { status: 'none' };
  const row = await getCompanySalesperson(companyId);
  if (!row) return { status: 'none' };
  return toOwner(matchOption(options, row.salesperson_id), row.salesperson, row.salesperson_id);
}

/**
 * แก้ใบเดิม: เซลส์ของใบต้นทาง
 *
 * `quotations.user_id` เป็นได้สองแบบ และทั้งคู่ตอบคำถามนี้ได้จากแถว `salesperson` ของมันเอง:
 *   · ใบจาก LINE = แถวเซลส์ตัวจริง ⇒ ตามด้วย user_id ได้ตรง ๆ (รวมแถวที่ถูกยุบซ้ำ)
 *   · ใบจากเว็บ = แถวพร็อกซี `web:<admin>:<sp>` ซึ่งลอก `salesperson_id` มาจากเซลส์ตัวจริง
 *     ⇒ ตามด้วยรหัส (user_id ของพร็อกซีไม่มีทางอยู่ในรายชื่อ เพราะรายชื่อกรอง `web:%` ทิ้ง)
 */
export async function resolveQuotationSalesOwner(
  quoteUserId: string | null | undefined,
  options: PickedSalesperson[]
): Promise<SalesOwner> {
  const uid = String(quoteUserId ?? '').trim();
  if (uid === '') return { status: 'none' };
  const sp = await getSalespersonByUserId(uid);
  const code = sp?.salesperson_id ? String(sp.salesperson_id) : null;
  const name = sp?.name ? String(sp.name) : null;
  return toOwner(matchOption(options, code, uid), name, code);
}
