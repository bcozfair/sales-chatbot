// ─────────────────────────────────────────────────────────────────────────────
//  customerSalesOwner — "ใบนี้ควรออกในนามเซลส์คนไหน" ตอบจากข้อมูล ไม่ต้องให้คนจำ
//  ใช้ที่เดียว: ช่อง "ออกในนาม" ของหน้าเว็บขอใบเสนอราคา (role ที่เลือกเซลส์คนไหนก็ได้)
//  แผน: docs/plan-web-quote-auto-salesperson.md
//
//  มีเพราะแอดมิน/ผู้อนุมัติจำไม่ได้ว่าลูกค้ารายไหนเป็นของเซลส์คนไหน (เจ้าของ 2026-09-24)
//  ⇒ ช่องเริ่มต้นว่าง แล้วระบบเติมให้เมื่อรู้ลูกค้า · เลือกทับเองได้เสมอ
//
//  ใบใหม่ — ถอยทีละขั้นภายใน company_id เดียวกัน จนเจอเซลส์ที่ "ยังออกใบในนามได้" (เจ้าของเคาะ
//  2026-09-24 ให้ใช้ครบ 4 ขั้น และขั้น 4 ไม่จำกัดอายุ):
//     1. customer    เซลส์ในข้อมูลลูกค้า Odoo — ผู้ติดต่อคนแรกที่ไม่ว่าง ตาม contact_id
//     2. contact     เซลส์ของผู้ติดต่อคนอื่นในบริษัทเดียวกัน
//     3. last_order  เซลส์ของใบสั่งขายล่าสุดของบริษัท
//     4. older_order เซลส์ของใบสั่งขายที่ใหม่ที่สุดที่ยังออกใบได้ (ย้อนได้ไม่จำกัด)
//  วัด 2026-09-24 กับลูกค้าที่มีออเดอร์ใน 365 วัน (8,239 บริษัท) ยอดสะสม:
//     76.4% → 77.1% → 88.8% → 91.2% · ที่เหลือ = เซลส์ทุกคนที่เคยดูแลไม่ active แล้ว
//
//  แก้ใบเดิม — เซลส์ของ "ใบต้นทาง" (เจ้าของเคาะ 2026-09-24) ไม่ใช่ของลูกค้าในวันนี้ และไม่ถอย
//     เพราะ revision คือใบเดิมที่ลูกค้าถืออยู่ ผู้ลงนามต้องไม่เปลี่ยนเงียบ ๆ
//
//  ⚠️ "ยังออกใบในนามได้" ตัดสินที่นี่ตอนเปิดใบ ไม่ใช่ใน view — สถานะ active เปลี่ยนได้ทุกเมื่อ
//     ที่แอดมินเปิด/ปิดเซลส์ แต่ customers_data_view สร้างใหม่เฉพาะตอนข้อมูล Odoo ขยับ ⇒ ถ้าฝัง
//     ไว้ใน view ตัวเลือกจะค้างเป็นคนที่ถูกปิดไปแล้ว · view เก็บแค่ข้อเท็จจริง (รหัสตามชื่อใน Odoo)
//  ⚠️ คำตอบต้องเป็น "ตัวเลือกที่มีอยู่ใน dropdown" เสมอ — ผู้เรียกส่งรายชื่อที่ยุบซ้ำแล้ว
//     (`listSalespersonsForWeb()`) เข้ามา ไม่ใช่ให้ไฟล์นี้ไปอ่านตาราง `salesperson` เอง ไม่งั้น
//     จะได้ user_id ของแถวที่ถูกยุบทิ้ง แล้ว dropdown โชว์ "ยังไม่เลือก" ทั้งที่มีค่าตั้งอยู่
//  ⚠️ **ไม่เดานอกบริษัท** — ไม่ยืมเซลส์ของสาขาอื่นที่เลขภาษีเดียวกัน (คนละรหัสลูกค้า = คนละข้อตกลง ·
//     เหตุผลเดียวกับประวัติส่วนลด) และไม่ถอยไปใช้ "คนที่เลือกล่าสุด" · หาไม่เจอ = บอกว่าหาไม่เจอ
//  ⚠️ ไม่ใช่ด่านสิทธิ์ — การออกในนามใครได้/ไม่ได้ยังตัดสินที่ `assertMayActAs()` ตามเดิม
//     ไฟล์นี้แค่ "เสนอค่า" และห้าม throw
// ─────────────────────────────────────────────────────────────────────────────
import {
  getCompanySalespersons,
  getCompanyOrderSalespersons,
  getSalespersonByUserId,
} from '../db/repositories.js';
import type { PickedSalesperson } from './salespersonPicker.js';

/** ได้คำตอบจากขั้นไหน — หน้าจอใช้ติดป้ายในช่อง ให้คนรู้ว่าอันไหนมาจากการถอย */
export type SalesOwnerSource = 'customer' | 'contact' | 'last_order' | 'older_order' | 'quotation';

export type SalesOwner =
  /** เจอคนในรายชื่อ "ออกในนาม" — `user_id` ใช้เป็น `sp_user_id` ได้ทันที */
  | {
      status: 'resolved';
      source: SalesOwnerSource;
      user_id: string;
      name: string;
      salesperson_id: string | null;
      /** ชื่อตามต้นทาง (Odoo / ใบสั่งขาย) — ไว้บอกคนว่าระบบอ่านมาจากอะไร */
      odoo_name: string | null;
      /** วันที่ของใบสั่งขายที่ใช้ (ขั้น 3–4 เท่านั้น) · ISO */
      order_date: string | null;
    }
  /** รู้ว่าใครเป็นเจ้าของ แต่ไม่มีใครในบริษัทที่ออกใบในนามได้ (ไม่ active / บัญชีระบบ) */
  | { status: 'inactive'; odoo_name: string | null; salesperson_id: string | null }
  /** ไม่มีข้อมูลเจ้าของเลย — บริษัทที่ไม่มีเซลส์ใน Odoo และไม่เคยมีใบสั่งขาย */
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

/** หนึ่ง "ผู้สมัคร" ของห่วงโซ่ถอย — แยกจาก DB เพื่อให้ `pickSalesOwner()` เป็นฟังก์ชันบริสุทธิ์ */
export interface OwnerCandidate {
  source: Exclude<SalesOwnerSource, 'quotation'>;
  code: string | null;
  name: string | null;
  order_date?: string | null;
}

/**
 * ไล่ผู้สมัครตามลำดับ คืนคนแรกที่อยู่ในรายชื่อ dropdown — ฟังก์ชันบริสุทธิ์
 *
 * ไม่เจอใครเลย: มีชื่อให้บอก = `inactive` (ชื่อของผู้สมัครตัวแรก = เจ้าของตามข้อมูลที่หนักที่สุด)
 * · ไม่มีผู้สมัครเลย = `none`
 */
export function pickSalesOwner(candidates: OwnerCandidate[], options: PickedSalesperson[]): SalesOwner {
  for (const c of candidates) {
    const opt = matchOption(options, c.code);
    if (opt) {
      return {
        status: 'resolved',
        source: c.source,
        user_id: opt.user_id,
        name: opt.name,
        salesperson_id: opt.salesperson_id,
        odoo_name: c.name,
        order_date: c.order_date ?? null,
      };
    }
  }
  if (candidates.length === 0) return { status: 'none' };
  return { status: 'inactive', odoo_name: candidates[0].name, salesperson_id: candidates[0].code };
}

/** ใบใหม่: ถอย 4 ขั้นภายในบริษัทเดียวกัน (ดูหัวไฟล์) */
export async function resolveCustomerSalesOwner(
  companyId: number,
  options: PickedSalesperson[]
): Promise<SalesOwner> {
  if (!Number.isFinite(companyId) || companyId <= 0) return { status: 'none' };
  const [master, orders] = await Promise.all([
    getCompanySalespersons(companyId),
    getCompanyOrderSalespersons(companyId),
  ]);
  const candidates: OwnerCandidate[] = [
    ...master.map((m, i): OwnerCandidate => ({
      source: i === 0 ? 'customer' : 'contact', code: m.salesperson_id, name: m.salesperson,
    })),
    ...orders.map((o, i): OwnerCandidate => ({
      source: i === 0 ? 'last_order' : 'older_order', code: o.salesperson_id, name: o.salesperson,
      order_date: o.last_order_date,
    })),
  ];
  return pickSalesOwner(candidates, options);
}

/**
 * แก้ใบเดิม: เซลส์ของใบต้นทาง — **ไม่ถอย**
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
  const opt = matchOption(options, code, uid);
  if (opt) {
    return {
      status: 'resolved', source: 'quotation', user_id: opt.user_id, name: opt.name,
      salesperson_id: opt.salesperson_id, odoo_name: name, order_date: null,
    };
  }
  if (name === null && code === null) return { status: 'none' };
  return { status: 'inactive', odoo_name: name, salesperson_id: code };
}
