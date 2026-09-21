/**
 * localContactsRepo — SQL ของโมดูล "เพิ่มผู้ติดต่อเอง" (`local_contacts`) ทั้งหมด
 *
 * แผน: docs/plan-local-contacts.md — ก้อน I1 มีเฉพาะ `ensureDirectoryRow()` ส่วน CRUD/รายการ
 * และ reconcile มาที่ I2 (ไฟล์นี้) · กฎ layer เหมือนทุกไฟล์ใน db/: **SQL อยู่ที่นี่ที่เดียว**
 * service/route ห้ามเขียนเอง
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

// ═════════════════════════════════════════════════════════════════════════════
//  ก้อน I2 — CRUD · รายการ · reconcile
//
//  ทุกฟังก์ชันรับ `executor` ได้ เพราะ service ต้องเรียกได้ทั้งใน `withTransaction()`
//  (เขียน local_contacts + customers_data_view ให้อยู่ใน tx เดียวกันตามกับดัก §7.5)
//  และนอก tx (รายการ/ไฟล์ export ที่อ่านอย่างเดียว)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * นิพจน์ "ชื่อที่ตัดคำนำหน้าและช่องว่างออกแล้ว" — ชั้นหลักของเกณฑ์ "ชื่อใกล้เคียง" (§5.5)
 *
 * ⚠️ **ใช้ `[[:space:]]` ไม่ใช่ `\s`** — วัด 2026-09-17: `regexp_replace(x, '\s+', '', 'g')` บนฐานนี้
 *    คืนค่าเดิมไม่เปลี่ยน (backslash ถูกกลืนระหว่างทางผ่านชั้น escape) ส่วน `[[:space:]]+` ทำงานถูก
 * ⚠️ `K[.]` ไม่ใช่ `K\.` ด้วยเหตุผลเดียวกัน — เลี่ยง backslash ในสตริง SQL ทุกจุดที่เลี่ยงได้
 * ⚠️ เรียง `นางสาว` ก่อน `นาง` — สลับเมื่อไหร่ "นางสาวแนน" จะเหลือ "สาวแนน"
 *
 * ทำไมต้องมีชั้นนี้ทั้งที่มี `similarity()` อยู่แล้ว: `คุณแนน` ~ `แนน` ได้ similarity **0.222**
 * ซึ่งต่ำกว่าเกณฑ์ 0.4 — ชื่อสั้นทำให้ trigram เหลือน้อยจนวัดไม่ได้ (วัด 2026-09-17)
 */
const normName = (col: string): string =>
  `regexp_replace(regexp_replace(lower(btrim(${col})),` +
  ` '^(คุณ|นางสาว|นาง|นาย|k[.]|khun)[[:space:]]*', ''),` +
  ` '[[:space:]]+', '', 'g')`;

/** เกณฑ์ชั้นรอง — สะกดเพี้ยน (`สมชาย` ~ `สมชาญ` = 0.692) · pg_trgm ติดตั้งอยู่แล้วบนฐานนี้ */
const SIMILARITY_FLOOR = 0.4;

/** ค้างเกินกี่วันถึงเปลี่ยนจาก "รอคีย์" เป็น "ค้าง N วัน" (§5.5) */
export const STALE_AFTER_DAYS = 7;

export interface LocalContactRecord {
  contact_id: number;
  company_id: number;
  contact_name: string;
  job_position: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  odoo_matched_at: string | null;
  odoo_matched_contact_id: number | null;
  odoo_matched_by: string | null;
}

/** แถวในรายการ = แถวจริง + ของที่ระบบคำนวณให้ (ไม่มีใครติ๊กเอง — §6) */
export interface LocalContactListRow extends LocalContactRecord {
  customer_name: string | null;
  customer_reference: string | null;
  customer_tax_id: string | null;
  created_by_name: string | null;
  /** จำนวนใบเสนอราคาที่อ้างผู้ติดต่อคนนี้ — ตัวตัดสินสิทธิ์แก้ชื่อ/ลบ (§5.5) */
  quote_count: number;
  /** ชื่อใน Odoo ที่ใกล้เคียงแต่ไม่ตรงเป๊ะ — ที่มาของป้าย 🔴 (§7.4) · null = ไม่เจอ */
  similar_odoo_name: string | null;
}

const RECORD_COLS = `contact_id, company_id, contact_name, job_position, contact_phone,
                     contact_email, created_by, created_at, updated_at,
                     odoo_matched_at, odoo_matched_contact_id, odoo_matched_by`;

/**
 * บริษัทนี้มีอยู่จริงใน `customers_data_view` ไหม
 *
 * **นี่คือการบังคับ "ห้ามสร้างบริษัทใหม่"** ซึ่งเป็นขอบเขตทั้งหมดของโมดูลนี้ — และเป็นการตรวจ
 * ฝั่ง server ไม่ใช่ FK เพราะ `customers_data_view` ถูก DROP/สร้างใหม่ทุกรอบ refresh
 * (FK ไปหาตารางที่ถูก swap ทั้งก้อนใช้ไม่ได้)
 */
export async function companyExistsInDirectory(
  companyId: number,
  executor: DbExecutor = pool
): Promise<boolean> {
  const { rows } = await executor.query(
    'SELECT 1 FROM public.customers_data_view WHERE company_id = $1 LIMIT 1',
    [companyId]
  );
  return rows.length > 0;
}

/**
 * ผู้ติดต่อชื่อนี้ (เทียบแบบ `btrim`) มีอยู่แล้วในบริษัทนี้ไหม — ทั้งของ Odoo และของ local
 *
 * เกณฑ์ `btrim` ต้องตรงกับ unique index `idx_local_contacts_company_name` และ CTE `local_taken`
 * ของ Arm 3 เป๊ะ ไม่งั้นจะมีเคสที่ endpoint ปล่อยผ่านแล้วไปตายที่ index (500 แทน 409)
 * คืนแถวเดิมมาด้วยเพื่อให้หน้าจอเสนอ "ใช้คนเดิม" ได้ (§4.1)
 */
export async function findDirectoryContactByName(
  companyId: number,
  contactName: string,
  executor: DbExecutor = pool
): Promise<{ contact_id: number; contact_name: string; source: string } | null> {
  const { rows } = await executor.query(
    `SELECT contact_id, contact_name, source
       FROM public.customers_data_view
      WHERE company_id = $1 AND contact_id > 0 AND btrim(contact_name) = btrim($2)
      ORDER BY contact_id
      LIMIT 1`,
    [companyId, contactName]
  );
  if (rows[0]) return rows[0];

  // แถว local ที่ถูก `local_taken` ซ่อนไปแล้วไม่อยู่ใน view — แต่ยังกินชื่ออยู่ที่ unique index
  const { rows: local } = await executor.query(
    `SELECT contact_id, contact_name, 'local'::text AS source
       FROM public.local_contacts
      WHERE company_id = $1 AND btrim(contact_name) = btrim($2)
      LIMIT 1`,
    [companyId, contactName]
  );
  return local[0] ?? null;
}

export async function insertLocalContact(
  input: {
    company_id: number;
    contact_name: string;
    job_position: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    created_by: number | null;
  },
  executor: DbExecutor = pool
): Promise<LocalContactRecord> {
  const { rows } = await executor.query(
    `INSERT INTO public.local_contacts
       (company_id, contact_name, job_position, contact_phone, contact_email, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${RECORD_COLS}`,
    [input.company_id, input.contact_name, input.job_position,
     input.contact_phone, input.contact_email, input.created_by]
  );
  return rows[0];
}

export async function getLocalContactById(
  contactId: number,
  executor: DbExecutor = pool
): Promise<LocalContactRecord | null> {
  const { rows } = await executor.query(
    `SELECT ${RECORD_COLS} FROM public.local_contacts WHERE contact_id = $1`,
    [contactId]
  );
  return rows[0] ?? null;
}

/**
 * แก้ไขแถวจริง — service เป็นคนตัดสินว่าช่องไหนแก้ได้ตามสถานะ (§5.5) ที่นี่แค่เขียนตามสั่ง
 * `undefined` = ไม่แตะช่องนั้น · `null` = ล้างค่า
 */
export async function updateLocalContact(
  contactId: number,
  patch: {
    contact_name?: string;
    job_position?: string | null;
    contact_phone?: string | null;
    contact_email?: string | null;
  },
  executor: DbExecutor = pool
): Promise<LocalContactRecord | null> {
  const sets: string[] = [];
  const vals: unknown[] = [contactId];
  for (const key of ['contact_name', 'job_position', 'contact_phone', 'contact_email'] as const) {
    if (patch[key] === undefined) continue;
    vals.push(patch[key]);
    sets.push(`${key} = $${vals.length}`);
  }
  if (sets.length === 0) return getLocalContactById(contactId, executor);
  const { rows } = await executor.query(
    `UPDATE public.local_contacts
        SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE contact_id = $1
      RETURNING ${RECORD_COLS}`,
    vals
  );
  return rows[0] ?? null;
}

export async function deleteLocalContact(
  contactId: number,
  executor: DbExecutor = pool
): Promise<boolean> {
  const res = await executor.query(
    'DELETE FROM public.local_contacts WHERE contact_id = $1',
    [contactId]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * ใบเสนอราคาที่อ้างผู้ติดต่อคนนี้มีกี่ใบ — ตัวตัดสินทั้ง `409` ตอนลบ และสิทธิ์แก้ชื่อ (§5.5 · §7.5)
 *
 * ไม่มี index บน `quotations.contact_id` และไม่ต้องมี: ตารางนี้อยู่หลักพันแถว (1,947 ใบ ณ
 * 2026-09-21) seq scan จึงถูกกว่าการแบกอินเด็กซ์ที่ไม่มีเส้นทางอื่นใช้
 */
export async function countQuotationsByContactId(
  contactId: number,
  executor: DbExecutor = pool
): Promise<number> {
  const { rows } = await executor.query(
    'SELECT count(*)::int AS n FROM public.quotations WHERE contact_id = $1',
    [contactId]
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * แถวของผู้ติดต่อ local ใน `customers_data_view` ต้องเดินตามการแก้ไขทันที ไม่ใช่รอ rebuild
 *
 * ใช้ `public.clean_text()` เหมือน Arm 3 ทุกช่อง — ถ้าฝั่งนี้ไม่ clean แถวจะต่างกันจนกว่าจะ
 * rebuild รอบหน้าแล้วค่า "แอบเปลี่ยนเอง" โดยไม่มีใครแตะอะไร (ด่านข้อ 3 จับข้อนี้)
 * แถวที่ถูก `local_taken` ซ่อนไปแล้วจะไม่มีใน view ⇒ `rowCount = 0` ซึ่งถูกแล้ว ไม่ใช่ error
 */
export async function syncDirectoryRow(
  row: { contact_id: number; contact_name: string; contact_phone: string | null; contact_email: string | null },
  executor: DbExecutor = pool
): Promise<boolean> {
  const res = await executor.query(
    `UPDATE public.customers_data_view
        SET contact_name   = public.clean_text($2),
            contact_mobile = public.clean_text($3),
            contact_phone  = public.clean_text($3),
            contact_email  = public.clean_text($4)
      WHERE contact_id = $1 AND source = 'local'`,
    [row.contact_id, row.contact_name, row.contact_phone, row.contact_email]
  );
  return (res.rowCount ?? 0) > 0;
}

/** ลบแถวชั่วคราวใน view คู่กับการลบแถวจริง — ต้องอยู่ใน transaction เดียวกัน (§7.5) */
export async function deleteDirectoryRow(
  contactId: number,
  executor: DbExecutor = pool
): Promise<boolean> {
  const res = await executor.query(
    `DELETE FROM public.customers_data_view WHERE contact_id = $1 AND source = 'local'`,
    [contactId]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * รายการผู้ติดต่อที่แอดมินเพิ่มเอง + ป้ายที่ระบบคำนวณให้ (§5.5)
 *
 * `similar_odoo_name` คือหัวใจของกับดัก §7.4 — คนคีย์ชื่อใน Odoo ไม่ตรงเป๊ะแล้วทั้งสัญญาณ A
 * และ B จะไม่ยิง แถวค้างอยู่เงียบ ๆ โดยไม่มีใครรู้ว่าเพราะอะไร · คอลัมน์นี้ทำให้ "เพราะอะไร"
 * เป็นสิ่งที่มองเห็น: มันชี้ชื่อที่ชนให้ดูตรง ๆ
 *
 * ⚠️ หาเฉพาะแถวที่ยังไม่ match — แถวที่ match แล้วไม่มีอะไรให้เตือนอีก และการยิง similarity
 *    กับทุกแถวของบริษัทโดยไม่จำเป็นคือค่าใช้จ่ายที่โตตามจำนวนผู้ติดต่อที่เคยเพิ่มมาทั้งหมด
 */
export async function listLocalContacts(
  opts: { filter?: 'pending' | 'all'; q?: string; limit?: number; offset?: number } = {},
  executor: DbExecutor = pool
): Promise<{ items: LocalContactListRow[]; total: number }> {
  const pendingOnly = (opts.filter ?? 'pending') === 'pending';
  const q = (opts.q ?? '').trim();
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  const where: string[] = [];
  const vals: unknown[] = [];
  if (pendingOnly) where.push('l.odoo_matched_at IS NULL');
  if (q) {
    vals.push(`%${q}%`);
    where.push(`(l.contact_name ILIKE $${vals.length}
              OR COALESCE(v.customer_name, '') ILIKE $${vals.length}
              OR COALESCE(v.customer_reference, '') ILIKE $${vals.length}
              OR COALESCE(v.customer_tax_id, '') ILIKE $${vals.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // แถวตัวแทนของบริษัท (contact_id น้อยสุด) = ที่มาของชื่อบริษัท/รหัส/เลขภาษี
  // เกณฑ์เดียวกับ local_anchor ของ Arm 3 เพื่อให้ชื่อบริษัทบนจอตรงกับที่ใบจะได้
  const company = `LEFT JOIN LATERAL (
      SELECT b.customer_name, b.customer_reference, b.customer_tax_id
        FROM public.customers_data_view b
       WHERE b.company_id = l.company_id AND b.source <> 'local'
       ORDER BY b.contact_id
       LIMIT 1
    ) v ON true`;

  const { rows: totalRows } = await executor.query(
    `SELECT count(*)::int AS n FROM public.local_contacts l ${company} ${whereSql}`,
    vals
  );

  vals.push(limit, offset);
  const { rows } = await executor.query(
    `SELECT l.contact_id, l.company_id, l.contact_name, l.job_position, l.contact_phone,
            l.contact_email, l.created_by, l.created_at, l.updated_at,
            l.odoo_matched_at, l.odoo_matched_contact_id, l.odoo_matched_by,
            v.customer_name, v.customer_reference, v.customer_tax_id,
            a.name AS created_by_name,
            (SELECT count(*)::int FROM public.quotations q WHERE q.contact_id = l.contact_id) AS quote_count,
            CASE WHEN l.odoo_matched_at IS NOT NULL THEN NULL ELSE (
              SELECT s.contact_name
                FROM public.customers_data_view s
               WHERE s.company_id = l.company_id
                 AND s.source <> 'local'
                 AND s.contact_id > 0
                 AND s.contact_name IS NOT NULL
                 AND btrim(s.contact_name) <> btrim(l.contact_name)
                 AND (${normName('s.contact_name')} = ${normName('l.contact_name')}
                      OR similarity(s.contact_name, l.contact_name) >= ${SIMILARITY_FLOOR})
               ORDER BY similarity(s.contact_name, l.contact_name) DESC, s.contact_id
               LIMIT 1
            ) END AS similar_odoo_name
       FROM public.local_contacts l
       ${company}
       LEFT JOIN public.admin_users a ON a.id = l.created_by
       ${whereSql}
      ORDER BY l.odoo_matched_at NULLS FIRST, l.created_at, l.contact_id
      LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
    vals
  );

  return { items: rows, total: Number(totalRows[0]?.n ?? 0) };
}

// ═════════════════════════════════════════════════════════════════════════════
//  reconcile — "เข้า Odoo แล้วหรือยัง" ระบบตอบเอง ไม่มีปุ่มให้คนติ๊ก (§6)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * สัญญาณ A — Odoo มีผู้ติดต่อชื่อนี้ในบริษัทนี้แล้ว
 *
 * ⚠️ เกณฑ์ต้อง **เหมือน CTE `local_taken` ของ Arm 3 ทุกตัวอักษร** (`btrim` + `source <> 'local'`)
 *    ผลที่ได้ฟรีคือ **`odoo_matched_at` ถูกเขียนเมื่อไหร่ = แถว local ถูกซ่อนจาก view เมื่อนั้น**
 *    ⇒ ไม่มีสถานะที่ "บอกว่าเข้าแล้วแต่ยังโผล่ซ้ำใน picker" ให้ใครต้องมานั่งอธิบาย
 *    (ด่าน `diag:local-contacts` ข้อ 7 พิสูจน์ความเท่ากันนี้ทุกครั้งที่รัน)
 */
export async function markMatchedByContactSync(executor: DbExecutor = pool): Promise<number> {
  const res = await executor.query(
    `UPDATE public.local_contacts l
        SET odoo_matched_at = NOW(),
            odoo_matched_contact_id = v.contact_id,
            odoo_matched_by = 'contact_sync'
       FROM public.customers_data_view v
      WHERE l.odoo_matched_at IS NULL
        AND v.company_id = l.company_id
        AND v.source <> 'local'
        AND v.contact_id > 0
        AND btrim(v.contact_name) = btrim(l.contact_name)`
  );
  return res.rowCount ?? 0;
}

/**
 * สัญญาณ B — ใบที่อ้างผู้ติดต่อคนนี้ถูกนำเข้า Odoo สำเร็จแล้ว
 *
 * หนักแน่นกว่า A เพราะมันบอกว่า *ใบนำเข้าได้จริง* ไม่ใช่แค่ *มีคนชื่อนี้อยู่* — และปิดจุดบอด
 * ของ A ได้: gateway ตัด `active=false` ทิ้ง ⇒ ผู้ติดต่อบางคนไม่มีวันถูก sync กลับมาให้ A เห็น
 *
 * ⚠️ `btrim(s.contact_name) = btrim(l.contact_name)` ไม่ใช่ของประดับ — ถ้าไม่มี เงื่อนไขจะจับ
 *    partner ระดับ *บริษัท* ของใบมาเป็น "ผู้ติดต่อ" แล้วมาร์กว่าเข้า Odoo แล้วทั้งที่ยังไม่มีคนนั้น
 * ⚠️ `odoo_imported_at` / `odoo_so_id` มาจาก `reconcileQuotationOdooLinks()` ในรอบ sync
 *    เดียวกัน ⇒ ต้องรันหลังตัวนั้น และไม่ต้องยิง Odoo เพิ่มเลยสักครั้ง
 */
export async function markMatchedByImportedOrder(executor: DbExecutor = pool): Promise<number> {
  const res = await executor.query(
    `UPDATE public.local_contacts l
        SET odoo_matched_at = NOW(),
            odoo_matched_contact_id = s.contact_id,
            odoo_matched_by = 'imported_order'
       FROM public.quotations q
       JOIN public.sale_orders s ON s.sale_order_id = q.odoo_so_id
      WHERE l.odoo_matched_at IS NULL
        AND q.contact_id = l.contact_id
        AND q.odoo_imported_at IS NOT NULL
        AND s.contact_id > 0
        AND btrim(s.contact_name) = btrim(l.contact_name)`
  );
  return res.rowCount ?? 0;
}

/** จำนวนที่ยังไม่เข้า Odoo — ตัวเลขข้างเมนู (I4) และบรรทัดสรุปท้ายรอบ sync */
export async function countPendingLocalContacts(executor: DbExecutor = pool): Promise<number> {
  const { rows } = await executor.query(
    'SELECT count(*)::int AS n FROM public.local_contacts WHERE odoo_matched_at IS NULL'
  );
  return Number(rows[0]?.n ?? 0);
}
