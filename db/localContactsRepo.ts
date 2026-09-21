/**
 * localContactsRepo — SQL ของโมดูล "เพิ่มผู้ติดต่อเอง" (`local_contacts`) ทั้งหมด
 *
 * แผน: docs/plan-local-contacts.md — ก้อน I1 มีเฉพาะ `ensureDirectoryRow()` ส่วน CRUD/รายการ
 * ตามมาที่ I2 · กฎ layer เหมือนทุกไฟล์ใน db/: **SQL อยู่ที่นี่ที่เดียว** service/route ห้ามเขียนเอง
 *
 * ── ทำไมต้องมี ensureDirectoryRow() ทั้งที่ Arm 3 ของ view สร้างแถวให้อยู่แล้ว ─────────────
 * `customers_data_view` ไม่ได้อัปเดตทันทีที่เพิ่มคน — มันถูกสร้างใหม่ทั้งก้อนรอบละครั้ง
 * (build+swap ~6 วิ ทุก ≤10 นาที) ⇒ ระหว่างนั้นคนที่เพิ่งเพิ่มจะยัง **ไม่มีตัวตน** สำหรับทั้งระบบ
 * ซึ่งแปลว่าออกใบให้เขาไม่ได้ และ snapshot ของใบจะไม่มีชื่อผู้ติดต่อ
 *
 * ทางแก้คือเขียนสองที่: `local_contacts` (ของจริง) + แถวใน `customers_data_view` (ของชั่วคราว
 * ที่รอบ rebuild ถัดไปจะสร้างทับให้เองด้วยค่าเดียวกันเป๊ะ)
 *
 * ⚠️ **เขียนแถวใหม่ด้วยการ "ลอกจากแถวตัวแทน" ไม่ใช่ประกอบค่าเอง** — 24 คอลัมน์ที่ก๊อปมาไว้ใน
 *    โค้ด TS คือ 24 ช่องที่รอวันไม่ตรงกับนิยาม view · ด่าน `diag:local-contacts` ข้อ 3 เทียบ
 *    แถวที่ฟังก์ชันนี้เขียน กับแถวที่ Arm 3 สร้างตอน rebuild **ทีละคอลัมน์ทั้ง 24 ช่อง**
 *    ถ้าวันหนึ่งมีคนแก้ฝั่งเดียว ด่านนั้นล้มทันที
 *
 * ⚠️ `source <> 'local'` ทั้งสองที่ = ลอกจากแถวที่ Odoo เป็นเจ้าของเท่านั้น ไม่ลอกต่อจาก
 *    ผู้ติดต่อ local ที่เพิ่มไปก่อนหน้า ซึ่งจะทำให้ค่าเพี้ยนสะสม
 *
 * ⚠️ idempotent (`ON CONFLICT DO NOTHING`) โดยตั้งใจ — เรียกซ้ำกี่ครั้งก็ได้ และ **ต้องเรียกซ้ำ**
 *    ที่ `createDraft()` ด้วย เผื่อกรณีรอบ rebuild เริ่ม `CREATE TABLE AS` ไปก่อนที่เราจะ commit
 *    (แถวใหม่ตกอยู่ในตารางเก่าที่กำลังจะถูก DROP ⇒ หายไปจนกว่าจะ rebuild รอบหน้า)
 */
import { pool, type DbExecutor } from '../config/db.js';

/** ผู้ติดต่อ local เริ่มที่ 900,000,001 — ข้อตกลงเดียวกับ CHECK `local_contacts_id_range` */
export const LOCAL_CONTACT_ID_MIN = 900000000;

export function isLocalContactId(contactId: unknown): boolean {
  const n = Number(contactId);
  return Number.isFinite(n) && n >= LOCAL_CONTACT_ID_MIN;
}

export interface LocalContactRow {
  contact_id: number;
  company_id: number;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
}

/**
 * เติมแถวของผู้ติดต่อ local ลง `customers_data_view` ทันทีโดยไม่ต้องรอ rebuild
 * คืน `true` เมื่อเพิ่งสร้างแถวใหม่ · `false` เมื่อมีอยู่แล้ว หรือบริษัทนั้นไม่มีแถวของ Odoo ให้ลอก
 */
export async function ensureDirectoryRow(
  row: LocalContactRow,
  executor: DbExecutor = pool
): Promise<boolean> {
  const res = await executor.query(
    `INSERT INTO public.customers_data_view
     SELECT v.company_id, $2::int, 'local',
            v.customer_name, v.customer_reference, v.customer_tax_id, v.customer_payment_terms,
            v.customer_sale_area, v.salesperson,
            -- ทีมขาย: ค่าแรกที่ไม่ว่างของทั้งบริษัท — ต้องตรงกับ CTE local_team ของ Arm 3 เป๊ะ
            -- ไม่มีอะไรมาก่อนมันและไม่มีอะไรมาทีหลัง ว่างก็คือ NULL (เจ้าของเคาะ 2026-09-17)
            (SELECT (array_remove(array_agg(w.sales_team ORDER BY w.contact_id), NULL))[1]
               FROM public.customers_data_view w
              WHERE w.company_id = $1::int AND w.source <> 'local'),
            v.customer_type, v.phone, v.mobile, v.email,
            public.clean_text($3), public.clean_text($4), public.clean_text($4), public.clean_text($5),
            v.invoice_street, v.invoice_district, v.invoice_sub_district, v.invoice_state, v.invoice_zip,
            v.last_order_at
       FROM public.customers_data_view v
      WHERE v.company_id = $1::int AND v.source <> 'local'
      ORDER BY v.contact_id                        -- เกณฑ์เดียวกับ local_anchor ของ Arm 3 เป๊ะ
      LIMIT 1
     ON CONFLICT DO NOTHING`,
    [row.company_id, row.contact_id, row.contact_name, row.contact_phone, row.contact_email]
  );
  return (res.rowCount ?? 0) > 0;
}
