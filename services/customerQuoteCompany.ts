// ─────────────────────────────────────────────────────────────────────────────
//  บัญชีเสนอในนาม PM — "ลูกค้ารายนี้ทุกสินค้าออกเป็นใบ Primus ใบเดียว" (เจ้าของสั่ง 2026-09-28)
//  แผน: docs/plan-customer-quote-company.md
//
//  ไฟล์นี้ตอบสองคำถาม และมีแค่สองคำถามนี้:
//    1. บริษัทนี้ถูกตั้งให้เสนอในนามบริษัทไหน (ตาราง customer_quote_company · ขยายทั้งนิติบุคคล)
//    2. ร่างที่กำลังจะสร้าง ต้องบังคับเป็นบริษัทไหน (`decideForcedQuoteCompany`)
//  ส่วน "ใบที่มีอยู่แล้วเป็นบริษัทไหน" อ่านจากคอลัมน์ quotations.quote_company_override ที่ตรึงไว้
//  ตอนผูกลูกค้า (quoteCompanyOverrideOf) — ไม่ถามตารางนี้ซ้ำ ⇒ แก้ค่าตั้งทีหลังแล้วใบเดิมไม่สลับหัว
//
//  ── ขอบเขต = บัญชีห้ามเสนอราคา ──
//  เจ้าของเลือก 2026-09-28: ตั้งที่รหัสไหน สาขาในนิติบุคคลเดียวกันได้ไปด้วย ⇒ ใช้ SQL fragment
//  ของ db/companyIdentity.ts ชุดเดียวกับ blacklistService.ts ไม่เขียนนิยามใหม่ · **ทั้งบริษัทเท่านั้น**
//  (ไม่มีระดับผู้ติดต่อ — บริษัทเดียวกันต้องได้ใบแบบเดียวกันไม่ว่าใครเป็นคนขอ)
//
//  ── ทำไมล้มแล้วปล่อยผ่าน (ต่างจาก blacklist ที่ fail-closed) ──
//  นี่ไม่ใช่ด่านกฎ ถามไม่สำเร็จแล้วแบ่งใบตามสินค้าเหมือนเดิม = ผิดแบบเห็นได้ (ได้สองใบ) แต่ไม่มีของ
//  หลุดไปถึงลูกค้าที่ไม่ควรได้ · ถ้าทำเป็น fail-closed DB สะดุดครั้งเดียวการออกใบทั้งระบบจะหยุด
//  ⇒ `decideForcedQuoteCompany` กลืน error แล้วคืน null · ฟังก์ชันระดับล่างปล่อย error ลอยขึ้นไป
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from '../config/db.js';
import { companyKeysSql, keysOverlapSql } from '../db/companyIdentity.js';

export type QuoteCompany = 'PM' | 'THT';

/** ค่าที่บันทึก/รับเข้ามา → 'PM' | 'THT' | null (อย่างอื่นทั้งหมด = null ไม่เดา) */
export function normalizeQuoteCompany(value: unknown): QuoteCompany | null {
  const v = String(value ?? '').trim().toUpperCase();
  return v === 'PM' || v === 'THT' ? v : null;
}

/** บริษัทที่ "ใบนี้" ถูกตรึงไว้ — null = แบ่งตามสินค้าเหมือนเดิม (ใบเก่าทุกใบ · ใบจาก LINE ที่ลูกค้าไม่ได้ตั้งค่า) */
export function quoteCompanyOverrideOf(quote: any): QuoteCompany | null {
  return normalizeQuoteCompany(quote?.quote_company_override);
}

function normalizeId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * CTE `qc` = ทุกแถวในบัญชี พร้อมคีย์นิติบุคคลที่แถวนั้นชี้ถึง — รูปเดียวกับ BLACKLIST_KEYS_CTE
 * (CROSS JOIN LATERAL ให้ `c.company_id = q.company_id` เป็น index cond เสมอ · ตารางเล็ก หลักสิบ)
 */
const QUOTE_COMPANY_KEYS_CTE = `
  qc AS (
    SELECT q.company_id, q.quote_company, k.taxes, k.refs, k.nms
      FROM public.customer_quote_company q
      CROSS JOIN LATERAL (
        SELECT ${companyKeysSql('c')}
          FROM public.customers_data_view c
         WHERE c.company_id = q.company_id
      ) k
  )`;

/**
 * บริษัทนี้ถูกตั้งให้เสนอในนามบริษัทไหน — ตรงรหัสเอง หรือเป็นนิติบุคคลเดียวกับแถวในบัญชี
 * ไม่พบ = null · ⚠️ ปล่อย error ลอยขึ้นไป (ผู้เรียกเลือกเองว่าจะกลืนหรือไม่)
 *
 * ถ้าหลายแถวในนิติบุคคลเดียวกันตั้งไว้คนละค่า (วันนี้หน้าจอตั้งได้แค่ PM จึงยังเกิดไม่ได้)
 * แถวที่ตรงรหัสเองชนะ แล้วค่อยเป็นรหัสน้อยสุด — ผลคงที่ทุกครั้ง
 */
export async function forcedQuoteCompanyOf(companyId: unknown): Promise<QuoteCompany | null> {
  const company = normalizeId(companyId);
  if (company === null) return null;
  const { rows } = await pool.query(
    `WITH me AS (
       SELECT ${companyKeysSql('m')}
         FROM public.customers_data_view m
        WHERE m.company_id = $1
     ),
     ${QUOTE_COMPANY_KEYS_CTE}
     SELECT qc.quote_company
       FROM qc, me
      WHERE qc.company_id = $1 OR ${keysOverlapSql('me', 'qc')}
      ORDER BY (qc.company_id = $1) DESC, qc.company_id
      LIMIT 1`,
    [company]
  );
  return normalizeQuoteCompany(rows[0]?.quote_company);
}

/**
 * ติดป้ายในผลค้นหา / หน้าข้อมูลลูกค้า — query เดียวทั้งชุด (ผลค้นหามีได้ถึง 30 แถว)
 * คืน Map ของ company_id ที่อยู่ในบัญชี → บริษัทที่ตั้งไว้
 */
export async function findForcedQuoteCompanies(companyIds: unknown[]): Promise<Map<number, QuoteCompany>> {
  const ids = [...new Set(companyIds.map(normalizeId).filter((n): n is number => n !== null))];
  const out = new Map<number, QuoteCompany>();
  if (ids.length === 0) return out;
  const { rows } = await pool.query(
    `WITH ${QUOTE_COMPANY_KEYS_CTE}
     SELECT DISTINCT ON (u.company_id) u.company_id, qc.quote_company
       FROM unnest($1::int[]) AS u(company_id)
       CROSS JOIN LATERAL (
         SELECT ${companyKeysSql('m')}
           FROM public.customers_data_view m
          WHERE m.company_id = u.company_id
       ) me
       JOIN qc ON (qc.company_id = u.company_id OR ${keysOverlapSql('me', 'qc')})
      ORDER BY u.company_id, (qc.company_id = u.company_id) DESC, qc.company_id`,
    [ids]
  );
  for (const r of rows as { company_id: number; quote_company: string }[]) {
    const co = normalizeQuoteCompany(r.quote_company);
    if (co) out.set(Number(r.company_id), co);
  }
  return out;
}

/**
 * ร่างที่กำลังจะสร้าง/ผูกลูกค้า ต้องบังคับเป็นบริษัทไหน — **จุดตัดสินเดียว** ที่ทั้ง
 * insertDraftQuotations · การรวมใบตอน LINE เลือกบริษัท · พรีวิวหน้าเว็บ เรียกร่วมกัน
 * (ถ้าตัดสินกันคนละที่ วันหนึ่งพรีวิวจะโชว์ใบเดียวแต่บันทึกได้สองใบ)
 *
 *   แก้ใบเดิม (reviseFrom) → ใช้ค่าของ **ใบต้นทาง** ไม่ใช่ค่าตั้งปัจจุบันของลูกค้า
 *     เพราะเลข revision ยึดคำนำหน้าของเลขเดิม (QT-…-01) — ถ้าใบต้นทางเป็นใบ THT แล้วร่าง revise
 *     ถูกบังคับเป็น PM จะได้หัว Primus บนเลข QT · ใบต้นทางไม่มีค่า (ออกก่อนตั้ง) = แบ่งเหมือนเดิม
 *   ใบใหม่ → ค่าตั้งของลูกค้า (ขยายทั้งนิติบุคคล)
 *
 * ถามไม่สำเร็จ = null (แบ่งตามสินค้าเหมือนเดิม) — เหตุผลอยู่หัวไฟล์
 */
export async function decideForcedQuoteCompany(params: {
  customerId?: unknown;
  reviseFrom?: string | null;
}): Promise<QuoteCompany | null> {
  const reviseFrom = String(params.reviseFrom ?? '').trim();
  try {
    if (reviseFrom) {
      const { rows } = await pool.query(
        `SELECT quote_company_override FROM public.quotations
          WHERE quotation_no = $1
          ORDER BY (status = 'confirmed') DESC, updated_at DESC
          LIMIT 1`,
        [reviseFrom]
      );
      return normalizeQuoteCompany(rows[0]?.quote_company_override);
    }
    return await forcedQuoteCompanyOf(params.customerId);
  } catch (err) {
    console.error('[customerQuoteCompany] ถามบัญชีเสนอในนาม PM ไม่สำเร็จ — แบ่งใบตามสินค้าไปก่อน:', err);
    return null;
  }
}

// ═══════════════════════════ หน้าจัดการฝั่งแอดมิน ═══════════════════════════

export interface QuoteCompanyRow {
  company_id: number;
  quote_company: QuoteCompany;
  company_name: string | null;
  company_reference: string | null;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

/**
 * รายการทั้งหมดพร้อมชื่อ/รหัสอ้างอิง — LEFT JOIN เหตุผลเดียวกับ listBlacklist (ลูกค้าที่หายจาก
 * Odoo ต้องยังเห็นและถอดออกได้) · "ครอบกี่รหัส" ไม่นับตรงนี้ (scan cdv ต่อแถว ~85 ms)
 * หน้าจอขอทีละแถวผ่าน `/customers/:id/related` แทน
 */
export async function listQuoteCompanyEntries(): Promise<QuoteCompanyRow[]> {
  const { rows } = await pool.query(
    `SELECT q.company_id, q.quote_company, q.note, q.created_at,
            au.name AS created_by_name,
            co.customer_name      AS company_name,
            cr.customer_reference AS company_reference
       FROM public.customer_quote_company q
       LEFT JOIN public.admin_users au ON au.id = q.created_by
       LEFT JOIN LATERAL (
         SELECT customer_name FROM public.customers_data_view
          WHERE company_id = q.company_id AND customer_name IS NOT NULL
          ORDER BY contact_id LIMIT 1
       ) co ON true
       LEFT JOIN LATERAL (
         SELECT customer_reference FROM public.customers_data_view
          WHERE company_id = q.company_id
            AND customer_reference IS NOT NULL AND customer_reference <> ''
          ORDER BY contact_id LIMIT 1
       ) cr ON true
      ORDER BY q.created_at DESC, q.company_id DESC`
  );
  return rows as QuoteCompanyRow[];
}

function cleanNote(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * เพิ่มบริษัท — คืน null เมื่อ companyId ใช้ไม่ได้ · โยน error รหัส 23505 เมื่อมีอยู่แล้ว
 * วันนี้ตั้งได้แค่ PM (เจ้าของสั่ง) — ตารางรับ THT ได้แต่ทางเข้านี้ไม่เปิด
 */
export async function addQuoteCompanyEntry(input: {
  companyId: unknown;
  note: unknown;
  createdBy: number | null;
}): Promise<{ company_id: number } | null> {
  const company = normalizeId(input.companyId);
  if (company === null) return null;
  const { rows } = await pool.query(
    `INSERT INTO public.customer_quote_company (company_id, quote_company, note, created_by)
     VALUES ($1, 'PM', $2, $3) RETURNING company_id`,
    [company, cleanNote(input.note), input.createdBy]
  );
  return { company_id: rows[0].company_id };
}

/** แก้หมายเหตุ — บริษัทเปลี่ยนไม่ได้ (เปลี่ยน = ถอดแล้วเพิ่มใหม่ ไม่เสียประวัติว่าใครตั้งไว้) */
export async function updateQuoteCompanyEntry(companyId: unknown, input: { note: unknown }): Promise<boolean> {
  const company = normalizeId(companyId);
  if (company === null) return false;
  const { rowCount } = await pool.query(
    `UPDATE public.customer_quote_company
        SET note = $1, updated_at = CURRENT_TIMESTAMP
      WHERE company_id = $2`,
    [cleanNote(input.note), company]
  );
  return (rowCount ?? 0) > 0;
}

/** ถอดออก — คืน false เมื่อไม่มีแถว · ใบที่ตรึงค่าไปแล้วไม่เปลี่ยน (อ่านจากคอลัมน์ของใบ) */
export async function removeQuoteCompanyEntry(companyId: unknown): Promise<boolean> {
  const company = normalizeId(companyId);
  if (company === null) return false;
  const { rowCount } = await pool.query(
    'DELETE FROM public.customer_quote_company WHERE company_id = $1',
    [company]
  );
  return (rowCount ?? 0) > 0;
}
