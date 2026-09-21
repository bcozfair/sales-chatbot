/**
 * localContacts — หลังบ้านของ "เพิ่มผู้ติดต่อใหม่เอง" (ก้อน I2)
 *
 * แผน: docs/plan-local-contacts.md · ที่มาและเจตนาอยู่ที่ §5 ของ docs/plan-web-quote-request.md
 *
 * ── ปัญหาที่โมดูลนี้แก้ ──────────────────────────────────────────────────────
 * แอดมินเพิ่มผู้ติดต่อใต้บริษัทที่มีอยู่แล้วไม่ได้เลย ต้องรอให้มีคนไปคีย์ใน Odoo แล้ว sync กลับมา
 * — และเขียนลง `customers` ตรง ๆ ไม่ได้เพราะ sync ทับทุกรอบ (หายเงียบ ไม่มีอะไรฟ้อง)
 *
 * ── ทางที่เลือก และทางที่ไม่ได้เลือก ────────────────────────────────────────
 * เลือก: ตารางของตัวเอง (`local_contacts`) ที่ sync ไม่แตะ แล้วต่อท่อเข้า `customers_data_view`
 * ผ่าน Arm 3 ⇒ คนที่เพิ่งเพิ่มโผล่ครบทุกที่ (แชท · LIFF · หน้าเว็บ · reverse lookup) **โดยไม่ต้อง
 * แก้โค้ดที่อ่านลูกค้าสักบรรทัด**
 *
 * ไม่เลือก: ให้คนกดปุ่ม ✅ "คีย์เข้า Odoo แล้ว" — ปุ่มนั้นไม่ได้แค่เพิ่มงาน มัน **กลบกับดัก §7.4
 * ทั้งหมด** คนที่คีย์ชื่อผิดแล้วกดติ๊กว่าเสร็จจะทำให้ระบบเชื่อว่าพร้อม แล้วปล่อยใบเข้าไฟล์ปกติ
 * ไปตกที่ Odoo โดยไม่มีใครรู้ว่าเพราะอะไร · สัญญาณอัตโนมัติโกหกแบบนั้นไม่ได้เพราะมันวัดจากของ
 * ที่ Odoo ส่งกลับมาจริง (§6 · เจ้าของเคาะ 2026-09-17)
 *
 * ── สองกฎที่ค้ำทั้งไฟล์ ──────────────────────────────────────────────────────
 * 1. **เขียนสองที่เสมอ และต้องอยู่ใน transaction เดียวกัน** — `local_contacts` (ของจริง) กับแถวใน
 *    `customers_data_view` (ของชั่วคราวจนกว่า rebuild รอบหน้าจะสร้างทับด้วยค่าเดียวกันเป๊ะ)
 *    หลุดข้อนี้เมื่อไหร่ จะมีช่วงที่ผู้ติดต่อ "มีในตารางแต่ไม่มีตัวตน" ซึ่งแปลว่าออกใบให้เขาไม่ได้
 * 2. **สิทธิ์แก้/ลบคำนวณจากข้อมูล ไม่ใช่จากที่ใครเลือก** (§5.5) — มีใบอ้างแล้วห้ามแก้ชื่อเพราะชื่อ
 *    ถูกตรึงลง snapshot ของใบไปแล้ว · เข้า Odoo แล้วห้ามแก้เพราะแถว local ถูกของจริงบังไปแล้ว
 *    แก้ไปก็ไม่มีผล มีแต่จะทำให้สองฝั่งต่างกันโดยไม่มีใครรู้
 *
 * ⚠️ **ทีมขายไม่ใช่เรื่องของไฟล์นี้** — ไม่มีช่อง ไม่มีพารามิเตอร์ ไม่มี endpoint · มันสืบทอดจาก
 *    บริษัทตอนอ่าน (CTE `local_team` ของ Arm 3) ว่างก็ปล่อยว่าง (§3.5 · 59.1% ของบริษัทไม่มีทีมขาย)
 */
import { withTransaction, pool } from '../config/db.js';
import { slog, swarn } from '../scripts/sync/syncLog.js';
import {
  companyExistsInDirectory, findDirectoryContactByName, insertLocalContact,
  getLocalContactById, updateLocalContact, deleteLocalContact,
  countQuotationsByContactId, listLocalContacts, ensureDirectoryRow,
  syncDirectoryRow, deleteDirectoryRow, markMatchedByContactSync,
  markMatchedByImportedOrder, countPendingLocalContacts,
  type LocalContactRecord, type LocalContactListRow, type LocalContactFilter,
} from '../db/localContactsRepo.js';

export type LocalContactErrorCode = 'BAD_REQUEST' | 'NOT_FOUND' | 'DUPLICATE' | 'LOCKED';

export class LocalContactError extends Error {
  constructor(
    public readonly code: LocalContactErrorCode,
    message: string,
    public readonly status: number,
    /** ข้อมูลประกอบให้หน้าจอตัดสินใจต่อ เช่น แถวเดิมที่ชื่อชนกัน */
    public readonly detail?: unknown
  ) {
    super(message);
    this.name = 'LocalContactError';
  }
}

/** ความยาวสูงสุดต่อช่อง — กันคนวางข้อความทั้งย่อหน้าลงช่องชื่อ (§4.1) */
const MAX_LEN = { contact_name: 120, job_position: 120, contact_phone: 60, contact_email: 160 } as const;

/**
 * ชื่อผู้ติดต่อที่เราสร้างเอง **trim ตั้งแต่บันทึก** — ไม่ขัดกับกฎ "ห้าม trim ชื่อที่ส่งไป Odoo"
 *
 * กฎนั้นคุ้มครองชื่อที่ **Odoo เป็นเจ้าของ** (มีช่องว่างหัว/ท้ายจริง 17,666 แถว ซึ่ง trim แล้ว
 * จะกลายเป็นคนละ partner แล้วตกทั้งใบ) ส่วนคนที่เราสร้างเอง **เราเป็นต้นทาง** — เก็บช่องว่าง
 * ที่มองไม่เห็นไว้ให้คนคัดลอกไปวางใน Odoo = สร้างเคส "ชื่อไม่ตรง" ขึ้นมาเปล่า ๆ (§7.3)
 */
function cleanInput(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function optional(v: unknown, field: keyof typeof MAX_LEN): string | null {
  const s = cleanInput(v);
  if (s === '') return null;
  if (s.length > MAX_LEN[field]) {
    throw new LocalContactError('BAD_REQUEST', `${field} ยาวเกิน ${MAX_LEN[field]} ตัวอักษร`, 400);
  }
  return s;
}

/** รูปแบบอีเมลแบบหลวม — กันพิมพ์ผิดชัด ๆ ไม่ใช่ตรวจว่าส่งถึงจริง (ซึ่งตรวจไม่ได้อยู่แล้ว) */
function validEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export interface LocalContactInput {
  /** จำเป็นเฉพาะตอนเพิ่ม — ตอนแก้ไขย้ายบริษัทไม่ได้ (ผู้ติดต่อผูกกับบริษัทตั้งแต่สร้าง) */
  company_id?: unknown;
  contact_name: unknown;
  job_position?: unknown;
  contact_phone?: unknown;
  contact_email?: unknown;
}

interface ParsedInput {
  company_id: number;
  contact_name: string;
  job_position: string | null;
  contact_phone: string | null;
  contact_email: string | null;
}

/** ตรวจ body ให้จบก่อนแตะ DB — ค่าผิดต้องเป็น 400 ตั้งแต่ปากทาง ไม่ใช่ไปตายกลาง INSERT */
function parseInput(body: LocalContactInput, opts: { requireCompany: boolean }): ParsedInput {
  const companyId = Number(body.company_id);
  if (opts.requireCompany && (!Number.isFinite(companyId) || companyId <= 0)) {
    throw new LocalContactError('BAD_REQUEST', 'ต้องระบุบริษัท (company_id) เป็นตัวเลข', 400);
  }
  const name = cleanInput(body.contact_name);
  if (name === '') {
    throw new LocalContactError('BAD_REQUEST', 'ต้องระบุชื่อผู้ติดต่อ', 400);
  }
  if (name.length > MAX_LEN.contact_name) {
    throw new LocalContactError('BAD_REQUEST', `ชื่อผู้ติดต่อยาวเกิน ${MAX_LEN.contact_name} ตัวอักษร`, 400);
  }
  const email = optional(body.contact_email, 'contact_email');
  if (email && !validEmail(email)) {
    throw new LocalContactError('BAD_REQUEST', 'รูปแบบอีเมลไม่ถูกต้อง', 400);
  }
  return {
    company_id: companyId,
    contact_name: name,
    job_position: optional(body.job_position, 'job_position'),
    contact_phone: optional(body.contact_phone, 'contact_phone'),
    contact_email: email,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  สถานะและสิทธิ์ของแต่ละแถว — ระบบตัดสินจากข้อมูล ไม่มีใครเลือก (§5.5)
// ═════════════════════════════════════════════════════════════════════════════

export type LocalContactStatus = 'matched' | 'pending' | 'name_mismatch';

export interface LocalContactView extends LocalContactListRow {
  status: LocalContactStatus;
  can_edit_name: boolean;
  can_edit_fields: boolean;
  can_delete: boolean;
}

/**
 * ⚠ **ไม่มีสถานะ "ค้างนาน" โดยตั้งใจ** (เจ้าของเคาะ 2026-09-21) — เคยมีชั้นกลางที่
 * เปลี่ยนสีเมื่อค้างเกิน 7 วัน แต่ถูกถอดออก เพราะ "ค้าง 3 วัน" กับ "ค้าง 30 วัน" สั่งให้
 * ทำสิ่งเดียวกันเป๊ะ คือ เอาไปคีย์ ⇒ สองป้ายที่สั่งงานเหมือนกัน คือป้ายที่แบ่งคนอ่านออกเป็นสองกอง
 * โดยที่กองที่สองต้องทำอย่างเดียวกัน · "เพิ่มเมื่อ" ยังเป็นคอลัมน์หนึ่งในตารางเหมือนเดิม
 * คนที่อยากไล่ของเก่าเรียงจากคอลัมน์นั้นได้
 *
 * สามสถานะที่เหลือตอบคนละคำถาม: `matched` = จบแล้ว · `name_mismatch` = มีคนทำแต่
 * ชื่อไม่ตรง ⇒ **ต้องมีคนไปแก้ชื่อ** · `pending` = ยังไม่มีใครคีย์ ⇒ **เอาไปคีย์**
 * ลำดับการตัดสินยังสำคัญเหมือนเดิม: `name_mismatch` มาก่อน `pending` — สลับกันแล้ว
 * ป้ายชื่อไม่ตรงจะไม่โผล่ให้ใครเห็นเลย
 */
export function decorate(row: LocalContactListRow): LocalContactView {
  const matched = row.odoo_matched_at !== null;
  const status: LocalContactStatus = matched
    ? 'matched'
    : row.similar_odoo_name
      ? 'name_mismatch'
      : 'pending';
  const hasQuotes = Number(row.quote_count) > 0;
  return {
    ...row,
    status,
    can_edit_name: !matched && !hasQuotes,
    can_edit_fields: !matched,
    can_delete: !matched && !hasQuotes,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  CRUD
// ═════════════════════════════════════════════════════════════════════════════

/**
 * เพิ่มผู้ติดต่อใหม่ใต้บริษัทที่มีอยู่แล้ว
 *
 * ⚠️ `ensureDirectoryRow()` ต้องอยู่ใน transaction เดียวกับ `INSERT` — ไม่ใช่ "เขียนเสร็จแล้ว
 *    ค่อยตามไปเติม" ถ้าแยกกัน แล้วตัวหลังล้ม จะได้ผู้ติดต่อที่มีในตารางแต่ทั้งระบบมองไม่เห็น
 *    ซึ่งเป็นสถานะที่ไม่มีหน้าจอไหนอธิบายได้
 */
export async function createLocalContact(
  body: LocalContactInput,
  createdBy: number | null
): Promise<LocalContactRecord> {
  const input = parseInput(body, { requireCompany: true });

  if (!(await companyExistsInDirectory(input.company_id))) {
    throw new LocalContactError('BAD_REQUEST', `ไม่พบบริษัท id=${input.company_id}`, 400);
  }
  const clash = await findDirectoryContactByName(input.company_id, input.contact_name);
  if (clash) {
    throw new LocalContactError(
      'DUPLICATE', `บริษัทนี้มีผู้ติดต่อชื่อ "${clash.contact_name}" อยู่แล้ว`, 409, { existing: clash });
  }

  return withTransaction(async (client) => {
    const row = await insertLocalContact({ ...input, created_by: createdBy }, client);
    await ensureDirectoryRow(
      {
        contact_id: row.contact_id,
        company_id: row.company_id,
        contact_name: row.contact_name,
        contact_phone: row.contact_phone,
        contact_email: row.contact_email,
      },
      client
    );
    return row;
  });
}

/**
 * อ่านแถวเดียวเพื่อเติมลงกล่อง "แก้ไขผู้ติดต่อ" (2026-09-21)
 *
 * ต้องมีเส้นของตัวเองเพราะ `/api/customer/:id/contacts` ที่หน้าใบใช้อยู่คืนแค่ ชื่อ/เบอร์/อีเมล
 * — ไม่มี `job_position` ⇒ เปิดกล่องแก้ไขจากรายการนั้นตรง ๆ แล้วตำแหน่งงานจะว่างทุกครั้ง
 * แล้วถูกบันทึกทับเป็นว่างโดยที่คนแก้ไม่ได้ตั้งใจ
 *
 * `quote_count` ติดมาด้วยเพื่อให้หน้าจอ **บอกล่วงหน้า** ว่าแก้ชื่อ/ลบไม่ได้ แทนที่จะปล่อยให้
 * กดแล้วไปเจอ 409 — กติกาตัวจริงยังอยู่ที่ updateLocalContactById/deleteLocalContactById เหมือนเดิม
 */
export async function getLocalContactForEdit(
  contactId: number
): Promise<LocalContactRecord & { quote_count: number }> {
  const row = await getLocalContactById(contactId);
  if (!row) throw new LocalContactError('NOT_FOUND', `ไม่พบผู้ติดต่อ id=${contactId}`, 404);
  return { ...row, quote_count: await countQuotationsByContactId(contactId) };
}

export async function updateLocalContactById(
  contactId: number,
  body: LocalContactInput
): Promise<LocalContactRecord> {
  const existing = await getLocalContactById(contactId);
  if (!existing) throw new LocalContactError('NOT_FOUND', `ไม่พบผู้ติดต่อ id=${contactId}`, 404);
  if (existing.odoo_matched_at) {
    throw new LocalContactError(
      'LOCKED', 'ผู้ติดต่อคนนี้มีอยู่ใน Odoo แล้ว — แก้ที่ Odoo แทน', 409);
  }

  const input = parseInput(body, { requireCompany: false });
  const quoteCount = await countQuotationsByContactId(contactId);
  const nameChanged = input.contact_name !== existing.contact_name;

  // ชื่อถูกตรึงลง snapshot ของใบและคอลัมน์ C ของไฟล์ไปแล้ว — แก้ฝั่งเราไม่ทำให้ใบที่ออกไปแล้ว
  // นำเข้าได้ มีแต่จะทำให้สองฝั่งต่างกัน ⇒ เคสนั้นต้องไปแก้ที่ Odoo ให้ตรงกับใบแทน (§5.5)
  if (nameChanged && quoteCount > 0) {
    throw new LocalContactError(
      'LOCKED', `แก้ชื่อไม่ได้ — มีใบเสนอราคาอ้างผู้ติดต่อคนนี้อยู่ ${quoteCount} ใบ`, 409);
  }
  if (nameChanged) {
    const clash = await findDirectoryContactByName(existing.company_id, input.contact_name);
    if (clash && clash.contact_id !== contactId) {
      throw new LocalContactError(
        'DUPLICATE', `บริษัทนี้มีผู้ติดต่อชื่อ "${clash.contact_name}" อยู่แล้ว`, 409, { existing: clash });
    }
  }

  return withTransaction(async (client) => {
    const row = await updateLocalContact(
      contactId,
      {
        contact_name: nameChanged ? input.contact_name : undefined,
        job_position: input.job_position,
        contact_phone: input.contact_phone,
        contact_email: input.contact_email,
      },
      client
    );
    if (!row) throw new LocalContactError('NOT_FOUND', `ไม่พบผู้ติดต่อ id=${contactId}`, 404);
    // แถวที่ถูก local_taken ซ่อนไปแล้วจะไม่มีใน view ⇒ ไม่มีอะไรให้อัปเดต ซึ่งถูกแล้ว
    await syncDirectoryRow(
      {
        contact_id: row.contact_id,
        contact_name: row.contact_name,
        contact_phone: row.contact_phone,
        contact_email: row.contact_email,
      },
      client
    );
    return row;
  });
}

/**
 * ลบผู้ติดต่อ — ได้เฉพาะแถวที่ยังไม่มีใบอ้างถึงและยังไม่เข้า Odoo (§7.5)
 *
 * ⚠️ แถวที่เข้า Odoo แล้ว **ห้ามลบ** ถึงจะดูเหมือนเป็นขยะ — มันคือหลักฐานว่าใบเก่าที่อ้าง
 *    `contact_id` 900 ล้าน เคยหมายถึงใคร และเป็นที่เก็บ `odoo_matched_contact_id` ที่โยง
 *    สองโลกเข้าด้วยกัน (§7.2)
 */
export async function deleteLocalContactById(contactId: number): Promise<void> {
  const existing = await getLocalContactById(contactId);
  if (!existing) throw new LocalContactError('NOT_FOUND', `ไม่พบผู้ติดต่อ id=${contactId}`, 404);
  if (existing.odoo_matched_at) {
    throw new LocalContactError(
      'LOCKED', 'ผู้ติดต่อคนนี้มีอยู่ใน Odoo แล้ว — ลบออกจากระบบไม่ได้', 409);
  }
  const quoteCount = await countQuotationsByContactId(contactId);
  if (quoteCount > 0) {
    throw new LocalContactError(
      'LOCKED', `ลบไม่ได้ — มีใบเสนอราคาอ้างผู้ติดต่อคนนี้อยู่ ${quoteCount} ใบ`, 409);
  }

  await withTransaction(async (client) => {
    await deleteDirectoryRow(contactId, client);
    await deleteLocalContact(contactId, client);
  });
}

export async function listContacts(
  opts: { filter?: LocalContactFilter; q?: string; limit?: number; offset?: number }
): Promise<{ items: LocalContactView[]; total: number; pending: number }> {
  const { items, total } = await listLocalContacts(opts);
  return { items: items.map(decorate), total, pending: await countPendingLocalContacts() };
}

// ═════════════════════════════════════════════════════════════════════════════
//  ไฟล์ส่งงาน — คนเปิดไฟล์นี้เอาไปคีย์ใน Odoo เอง (§5.3)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * หัวคอลัมน์เป็น**ภาษาไทยอ่านง่าย ไม่ใช่ชื่อฟิลด์ของ Odoo** — ไฟล์นี้ไม่ได้เอาไป import
 * คนอ่านแล้วคีย์เอง
 *
 * หลักตัดสินว่าคอลัมน์ไหนควรมี: *"คนที่เปิดไฟล์นี้ต้องพิมพ์ค่านี้ลงช่องไหนใน Odoo"* ตอบไม่ได้
 * = ไม่ต้องมี · คอลัมน์ที่ไม่มีปลายทางทำให้คนคีย์ลังเลว่าตกอะไรไปหรือเปล่า
 * ⇒ **ไม่มีคอลัมน์ทีมขาย** (สืบทอดที่ฝั่งฐานอยู่แล้ว ไม่มีใครต้องคีย์ — §3.5)
 * ⇒ **มีรหัสลูกค้า/เลขผู้เสียภาษี** เพราะคนคีย์ต้องหาบริษัทให้เจอก่อนถึงจะสร้างผู้ติดต่อใต้มันได้
 */
export const EXPORT_HEADERS = [
  'สถานะ', 'บริษัท', 'รหัสลูกค้า', 'เลขผู้เสียภาษี', 'ชื่อผู้ติดต่อ', 'ตำแหน่งงาน',
  'โทรศัพท์', 'อีเมล', 'เพิ่มเมื่อ', 'เพิ่มโดย', 'ใบที่อ้างถึง',
] as const;

const STATUS_TEXT: Record<LocalContactStatus, string> = {
  matched: 'เข้า Odoo แล้ว',
  pending: 'รอนำเข้า',
  name_mismatch: 'น่าจะคีย์แล้วแต่ชื่อไม่ตรง',
};

export function toExportRows(items: LocalContactView[]): (string | number)[][] {
  return items.map((r) => [
    STATUS_TEXT[r.status],
    r.customer_name ?? '',
    r.customer_reference ?? '',
    r.customer_tax_id ?? '',
    r.contact_name,
    r.job_position ?? '',
    r.contact_phone ?? '',
    r.contact_email ?? '',
    r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '',
    r.created_by_name ?? '',
    Number(r.quote_count),
  ]);
}

// ═════════════════════════════════════════════════════════════════════════════
//  reconcile — เรียกท้ายทุกรอบ sync (§6.1)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * "เข้า Odoo แล้วหรือยัง" — ตอบด้วยของที่ Odoo ส่งกลับมาจริง ไม่ใช่ปุ่มให้คนติ๊ก
 *
 * ── กติกา (ยืมจาก `reconcileQuotationOdooLinks()` ทุกข้อ) ────────────────────
 * **ห้าม throw** — ถูกเรียกท้ายรอบ sync ถ้าโยน error ออกไปจะกลืนบรรทัดสรุปรอบทิ้งทั้งที่ตัว sync
 * สำเร็จแล้ว · **เขียนเฉพาะแถวที่ยังว่าง** = สถานะเดินหน้าทางเดียว รันซ้ำกี่รอบก็ไม่เปลี่ยนค่าเดิม
 * · **ต้องรันหลัง `refreshCustomerDataView()`** ไม่งั้นสัญญาณ A เทียบกับ view ของรอบก่อน
 * และ **หลัง `reconcileQuotationOdooLinks()`** เพราะสัญญาณ B อ่าน `odoo_imported_at` ที่ตัวนั้นเขียน
 *
 * ── ทำไมต้องมีสองสัญญาณ ไม่ใช่เลือกอันเดียว ──────────────────────────────────
 * A เร็วกว่า (ทันทีที่ Odoo มีผู้ติดต่อ) แต่ตาบอดกับคนที่ gateway ไม่ส่งมา (`active=false` —
 * เพดาน 5,906 contact ที่บันทึกไว้ใน CLAUDE.md) · B ช้ากว่าแต่หนักแน่นกว่าเพราะมันบอกว่า
 * **ใบนำเข้าได้จริง** ซึ่งเป็นเป้าหมายตัวจริง แต่ไม่เห็นคนที่ยังไม่เคยมีใบ ⇒ ต่างคนต่างปิดจุดบอด
 * ของอีกฝั่ง · รัน A ก่อน B ในรอบเดียวกัน
 *
 * และถ้าคีย์ชื่อไม่ตรง **ทั้งคู่จะไม่ยิง** ⇒ แถวค้างอยู่ในรายการแล้วป้าย 🔴 (`similar_odoo_name`)
 * ชี้ให้เห็นว่าชนกับชื่อไหน — กับดัก §7.4 กลายเป็นสิ่งที่ระบบมองเห็น แทนที่จะเป็นสิ่งที่ไม่มีใครรู้
 */
export async function reconcileLocalContactOdooLinks(): Promise<
  { contact_sync: number; imported_order: number; pending: number } | null
> {
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'local_contacts'`
    );
    if (rows.length === 0) {
      // ยังไม่ได้รัน migration 2026-09-18_04 → ข้ามเงียบ ๆ เหมือนที่ quotationOdooLink ทำ
      // ไม่ CREATE ให้เอง: ขาดตารางนี้แค่ทำให้โมดูลไม่ทำงาน ไม่คุ้มที่จะให้ sync สั่ง DDL
      swarn('ข้ามการจับคู่ผู้ติดต่อใหม่กับ Odoo — ยังไม่มีตาราง local_contacts (รัน migration 2026-09-18_04)');
      return null;
    }

    const bySync = await markMatchedByContactSync();
    const byOrder = await markMatchedByImportedOrder();
    const pending = await countPendingLocalContacts();

    if (bySync || byOrder) {
      slog(`ผู้ติดต่อใหม่เข้า Odoo แล้ว ${bySync + byOrder} คน ` +
           `(จากรายชื่อ ${bySync} · จากใบที่นำเข้า ${byOrder}) · ยังค้าง ${pending}`);
    }
    return { contact_sync: bySync, imported_order: byOrder, pending };
  } catch (err) {
    swarn(`จับคู่ผู้ติดต่อใหม่กับ Odoo ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
