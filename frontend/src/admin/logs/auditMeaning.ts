/**
 * "แถวนี้ในบันทึกการแก้ไขแปลว่าอะไรจริง ๆ" — ถ้อยคำของบันทึกการแก้ไขอยู่ที่ไฟล์นี้ที่เดียว
 *
 * ## ทำไมไฟล์นี้ถึงมี (เจ้าของเคาะ mockup `audit-wording` "ตามที่เสนอ" ทั้ง 3 ข้อ · 2026-10-05)
 *
 * บันทึกการแก้ไขมาจาก trigger ระดับตาราง (`audit_stmt`) ⇒ รู้แค่ "ตารางไหน · เพิ่ม/แก้/ลบ" แต่ตาราง
 * `salesperson` ถูกใช้ทำงานอีกสองอย่างที่ไม่ใช่ "พนักงานขาย" เลย และหน้าจอเคยเรียกทุกแถวว่า
 * "เพิ่ม/แก้ไขพนักงานขาย" (วัดจากบันทึกจริง 2026-10-05):
 *   · บอทใช้ `salesperson.status` จำว่าเซลส์ "กดเมนูแก้ใบแล้ว รอเลขที่ใบ" (74 แถว · 8 คน)
 *   · หน้าเว็บสร้าง "ตัวตนออกใบในนาม" `web:<admin>:<sales>` ตอนแอดมินออกใบในนามเซลส์ครั้งแรก
 *     (services/webIdentity.ts) ซึ่งไม่ใช่การเพิ่มพนักงานขาย (18 แถว + ปรับชื่อผู้จัดทำ 24 แถว)
 * ⇒ แปลจาก "ค่าที่เปลี่ยนจริง" แทนชื่อตาราง · ใช้ร่วมกันทั้งหน้าบันทึกการแก้ไข (AuditLogs.tsx)
 *   และกล่อง "ทุกอย่างของ request นี้" (RequestTimeline.tsx) ห้ามเขียนถ้อยคำแยกในหน้าใดหน้าหนึ่ง
 *
 * ## คู่ของไฟล์นี้ฝั่ง SQL
 *
 * `isRealChange()` ตอบคำถามเดียวกับ `realAuditChangeSql()` ใน `db/auditKinds.ts` (ตัวนับ "การแก้ไข"
 * ของหน้ารายงานการใช้งาน) — สองที่ต้องตอบเหมือนกันทุกแถว · ด่าน `npm run diag:audit-wording`
 * ไล่แถวจริงทั้งตารางมาเทียบให้ (frontend import ของฝั่ง server ไม่ได้ จึงเป็นสองสำเนาโดยตั้งใจ)
 *
 * ไฟล์นี้ไม่ import อะไรเลย ⇒ สคริปต์ใน scripts/diag/ ดึงไปทดสอบได้ตรง ๆ
 */

/** ขั้นต่ำที่ต้องรู้เพื่อแปล — แถวเต็มของหน้าบันทึกการแก้ไขมีครบ · กล่อง request ได้มาจาก server เฉพาะเท่านี้ */
export interface AuditFacts {
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  changed_cols: string[] | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** ชื่อที่ server หามาให้ (เช่นชื่อบริษัทของบัญชีเสนอในนาม PM) — ไม่มี = ใช้ entity_label */
  entity_display?: string | null;
}

export interface AuditMeaning {
  /** สิ่งที่ทำ — ตัวหนาในแถว */
  title: string;
  /** ชื่อรายการที่ถูกทำ (ว่าง = ไม่ต้องแสดง เช่นแถวที่ชื่อยังเป็นค่าตั้งต้น) */
  label: string | null;
  /** คำอธิบายสั้นต่อท้าย — บอกสิ่งที่ "ไม่ได้" เกิดขึ้นเมื่อชื่อชวนเข้าใจผิด */
  note: string | null;
}

/** ชื่อภาษาไทยของชนิดข้อมูล — ไม่มีในรายการก็แสดงชื่อดิบ ไม่ใช่ซ่อน */
export const ENTITY_LABELS: Record<string, string> = {
  promotion: 'โปรโมชันส่วนลด',
  quotation_rule: 'เงื่อนไขใบเสนอราคา',
  optional_link: 'สินค้าพ่วงเสริม',
  stock_rule: 'กฎระงับเมื่อหมดสต็อก',
  moq_rule: 'ขั้นต่ำสั่งซื้อ',
  shipping_fee: 'ค่าขนส่ง',
  credit_policy: 'นโยบายเครดิต',
  blacklist: 'บัญชีห้ามเสนอราคา',
  quote_pm: 'บัญชีเสนอในนาม PM',
  admin_user: 'ผู้ใช้งานระบบ',
  salesperson: 'พนักงานขาย',
  local_contact: 'ผู้ติดต่อเพิ่มเอง',
  local_product: 'สินค้าเพิ่มเอง',
  quotation: 'ใบเสนอราคา',
  sync_setting: 'ตั้งค่าการ sync',
  traffic: 'รายงานการใช้งาน',
  audit_log: 'บันทึกการแก้ไข',
  system_log: 'บันทึกระบบ',
  message: 'ประวัติแชท',
  backup_run: 'การสำรองข้อมูล',
  // entity_type ของ log.export = ชนิดไฟล์ที่ส่งออก (routes/logs.ts /export/:kind)
  audit: 'บันทึกการแก้ไข',
  system: 'บันทึกระบบ',
};

export function entityLabel(t: string | null): string {
  if (!t) return '-';
  return ENTITY_LABELS[t] ?? t;
}

const OP_LABELS: Record<string, string> = {
  insert: 'เพิ่ม', update: 'แก้ไข', delete: 'ลบ', view: 'เปิดดู', export: 'ส่งออก',
  // คำสั่งเดียวที่กระทบเกินเพดาน — trigger ยุบเหลือแถวสรุปแถวเดียว (ดู audit_stmt ใน migration)
  bulk_insert: 'เพิ่มยกชุด', bulk_update: 'แก้ไขยกชุด', bulk_delete: 'ลบยกชุด',
};

/** ถ้อยคำเฉพาะชนิดที่ "เพิ่ม/แก้ไข/ลบ + ชื่อชนิด" อ่านแล้วไม่เป็นภาษาคน */
const SPECIAL_OPS: Record<string, string> = {
  'local_product.insert': 'เพิ่มสินค้าใหม่',
  'local_product.update': 'แก้สินค้าที่เพิ่มเอง',
  'local_product.delete': 'ลบสินค้าที่เพิ่มเอง',
  'local_contact.insert': 'เพิ่มผู้ติดต่อใหม่',
  'local_contact.update': 'แก้ผู้ติดต่อที่เพิ่มเอง',
  'local_contact.delete': 'ลบผู้ติดต่อที่เพิ่มเอง',
};

/** แถวสรุปของการกดยกชุด — หน้าจอต้องแสดงต่างจากการแก้รายตัว ห้ามให้ดูเหมือนกัน */
export function isBulk(action: string): boolean {
  return action.includes('.bulk_');
}

/**
 * ชื่อการกระทำแบบไม่ดูค่า — 'promotion.update' → 'แก้ไขโปรโมชันส่วนลด' · 'log.view' + traffic → 'เปิดดูรายงานการใช้งาน'
 * ชนิดที่ไม่รู้จักคืนชื่อดิบ (ไม่ซ่อน) — ด่าน diag:audit-wording ตรวจว่าทุก action ในฐานจริงได้คำไทย
 */
export function actionLabel(action: string, entityType: string | null = null): string {
  if (SPECIAL_OPS[action]) return SPECIAL_OPS[action];
  const dot = action.lastIndexOf('.');
  if (dot < 0) return action;
  const op = OP_LABELS[action.slice(dot + 1)];
  // ชนิดอ่านจากหัวของ action ก่อน · ไม่รู้จัก (เช่น 'log.view') ค่อยใช้ entity_type ของแถว
  const ent = ENTITY_LABELS[action.slice(0, dot)] ?? (entityType ? ENTITY_LABELS[entityType] : undefined);
  return op && ent ? `${op}${ent}` : action;
}

/** ชื่อแหล่งข้อมูลในตั้งค่าการ sync — entity_label ของแถวนี้เป็น JSON array ของชื่อในระบบ */
const SYNC_RESOURCES: Record<string, string> = {
  products: 'สินค้า', customers: 'ลูกค้า', saleorders: 'ใบสั่งขาย',
};

/** ค่าของ salesperson.status ที่บอทใช้ — ตรงกับ handlers/lineHandler.ts */
const SP_STATUS_LABELS: Record<string, string> = {
  active: 'ใช้งาน',
  pending_branch: 'ยังกรอกข้อมูลไม่ครบ',
  edit_quote_number: 'รอเลขที่ใบที่จะแก้',
};
const SP_CHAT_STATES = new Set(['active', 'edit_quote_number']);

/** ชื่อช่องที่พบบ่อย (ตารางที่ร้านแก้จากหน้าจอ) — ไม่มีในรายการ = ชื่อดิบ */
const COL_LABELS: Record<string, string> = {
  name: 'ชื่อ', phone: 'เบอร์', branch: 'สาขา', status: 'สถานะ', user_id: 'รหัสผู้ใช้',
  salesperson_id: 'รหัสเซลส์', employee_quotation_id: 'ชื่อผู้จัดทำ',
  employee_quotation_phone: 'เบอร์ผู้จัดทำ', username: 'ชื่อผู้ใช้', role: 'สิทธิ์',
  signature_key: 'ลายเซ็น', acting_salesperson_id: 'เซลส์ที่ออกในนาม (เดิม)',
  created_at: 'สร้างเมื่อ', updated_at: 'แก้ล่าสุดเมื่อ', created_by: 'สร้างโดย',
  contact_name: 'ชื่อผู้ติดต่อ', contact_phone: 'เบอร์ผู้ติดต่อ', contact_email: 'อีเมล',
  job_position: 'ตำแหน่ง', company_id: 'รหัสบริษัท', contact_id: 'รหัสผู้ติดต่อ',
  odoo_matched_at: 'พบใน Odoo เมื่อ', odoo_matched_by: 'พบใน Odoo ด้วย',
  odoo_matched_contact_id: 'รหัสผู้ติดต่อใน Odoo', odoo_matched_template_id: 'รหัสสินค้าใน Odoo',
  exported_at: 'ส่งออกไฟล์ Odoo เมื่อ', note: 'หมายเหตุ', quote_company: 'บริษัทที่ออกใบ',
  is_active: 'เปิดใช้', min_order_qty: 'ขั้นต่ำสั่งซื้อ', internal_reference: 'รหัสสินค้า',
  interval_seconds: 'รอบเวลา (วินาที)', resources: 'ข้อมูลที่ sync', mode: 'โหมด',
  production: 'แหล่งผลิต', brand: 'แบรนด์', series: 'ซีรีส์', model: 'รุ่น',
};

export function colLabel(col: string): string {
  return COL_LABELS[col] ?? col;
}

/** ค่าในตาราง "ค่าเดิม → ค่าใหม่" ที่เป็นรหัสในระบบ → คำไทย (ตอนนี้มีแค่สถานะเซลส์) */
export function valueLabel(entityType: string | null, col: string, v: unknown): string | null {
  if (entityType === 'salesperson' && col === 'status' && typeof v === 'string' && SP_STATUS_LABELS[v]) {
    return SP_STATUS_LABELS[v];
  }
  return null;
}

/** ช่องที่เปลี่ยนโดยไม่นับเวลาแก้ล่าสุด (ทุกตารางขยับ updated_at ไปด้วยเสมอ) */
function meaningfulCols(f: AuditFacts): string[] {
  return (f.changed_cols ?? []).filter(c => c !== 'updated_at');
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** แถวพร็อกซีของหน้าเว็บ — รูปเดียวกับ buildWebUserId() ใน services/webIdentity.ts */
function isWebProxy(f: AuditFacts): boolean {
  return f.entity_type === 'salesperson' && (f.entity_id ?? '').startsWith('web:');
}

/** บอทจดสถานะการคุย (กดเมนูแก้ใบ ↔ ปกติ) ไว้ในแถวเซลส์ — ไม่ใช่การแก้ข้อมูลเซลส์ */
function isChatStateFlip(f: AuditFacts): boolean {
  if (f.entity_type !== 'salesperson' || !f.action.endsWith('.update')) return false;
  const cols = meaningfulCols(f);
  if (cols.length !== 1 || cols[0] !== 'status') return false;
  const b = str(f.before?.status), a = str(f.after?.status);
  return !!b && !!a && SP_CHAT_STATES.has(b) && SP_CHAT_STATES.has(a);
}

/**
 * แถวนี้คือ "การแก้ข้อมูลจริง" ไหม — ตัวนับ "การแก้ไข" ของหน้ารายงานการใช้งานนับเฉพาะแถวที่ตอบ true
 * ไม่ใช่: เข้าดู log · แถวพร็อกซีออกใบในนาม · สถานะการคุยของบอท
 * ⚠️ ต้องตรงกับ realAuditChangeSql() ใน db/auditKinds.ts — ดูหัวไฟล์
 */
export function isRealChange(f: AuditFacts): boolean {
  if (f.action === 'log.view') return false;
  if (isWebProxy(f)) return false;
  if (isChatStateFlip(f)) return false;
  return true;
}

function salespersonMeaning(f: AuditFacts, label: string | null): AuditMeaning | null {
  const op = f.action.slice(f.action.lastIndexOf('.') + 1);

  if (isWebProxy(f)) {
    if (op === 'insert') return { title: 'เริ่มออกใบในนาม', label, note: 'ครั้งแรกของบัญชีนี้ · ไม่ได้เพิ่มพนักงานขาย' };
    if (op === 'update') return { title: 'ปรับชื่อผู้จัดทำของใบในนาม', label, note: null };
    if (op === 'delete') return { title: 'ลบตัวตนออกใบในนาม', label, note: 'ไม่ได้ลบพนักงานขาย' };
    return null;
  }

  if (isChatStateFlip(f)) {
    return str(f.after?.status) === 'edit_quote_number'
      ? { title: 'กดแก้ใบเสนอราคาใน LINE', label: null, note: 'บอทรอให้พิมพ์เลขที่ใบ' }
      : { title: 'จบขั้นตอนแก้ใบใน LINE', label: null, note: 'พิมพ์เลขที่ใบแล้ว หรือยกเลิก' };
  }

  // คนใหม่ทักบอทครั้งแรก — lineHandler สร้างแถว status 'pending_branch' ชื่อ 'รอดำเนินการ'
  if (op === 'insert' && str(f.after?.status) === 'pending_branch') {
    return { title: 'เริ่มลงทะเบียนเซลส์ผ่าน LINE', label: null, note: 'ยังไม่ได้กรอกข้อมูล' };
  }
  if (op === 'update' && str(f.before?.status) === 'pending_branch' && str(f.after?.status) === 'active') {
    return { title: 'ลงทะเบียนเซลส์เสร็จ', label, note: null };
  }
  if (op === 'update') return { title: 'แก้ไขข้อมูลพนักงานขาย', label, note: null };
  return null;
}

function adminUserMeaning(f: AuditFacts, label: string | null): AuditMeaning | null {
  if (!f.action.endsWith('.update')) return null;
  const cols = new Set(meaningfulCols(f));
  const only = (...want: string[]) => cols.size > 0 && [...cols].every(c => want.includes(c));
  if (only('employee_quotation_id', 'employee_quotation_phone')) return { title: 'ตั้งชื่อผู้จัดทำของผู้ใช้งาน', label, note: null };
  if (only('signature_key')) {
    return { title: f.after?.signature_key ? 'อัปโหลดลายเซ็นของผู้ใช้งาน' : 'ลบลายเซ็นของผู้ใช้งาน', label, note: null };
  }
  if (only('role')) return { title: 'เปลี่ยนสิทธิ์ผู้ใช้งาน', label, note: null };
  if (only('name')) return { title: 'แก้ชื่อผู้ใช้งาน', label, note: null };
  if (only('acting_salesperson_id')) return { title: 'เลือกเซลส์ที่ออกในนาม', label, note: null };
  return null;
}

/** รอบ sync จับคู่ (หรือล้างการจับคู่) ผู้ติดต่อ/สินค้าเพิ่มเองกับ Odoo — ไม่มีคนแก้ */
function odooMatchMeaning(f: AuditFacts, label: string | null): AuditMeaning | null {
  if (!f.action.endsWith('.update')) return null;
  const cols = meaningfulCols(f);
  if (cols.length === 0 || !cols.every(c => c.startsWith('odoo_matched_'))) return null;
  return f.after?.odoo_matched_at
    ? { title: 'ระบบพบว่าเข้า Odoo แล้ว', label, note: null }
    : { title: 'ระบบล้างการจับคู่กับ Odoo', label, note: null };
}

/** ชื่อรายการที่อ่านออก — ชื่อจาก server ก่อน · ตั้งค่าการ sync แปลจาก JSON */
function readableLabel(f: AuditFacts): string | null {
  if (f.entity_display) return f.entity_display;
  if (f.entity_type === 'sync_setting' && f.entity_label) {
    try {
      const arr = JSON.parse(f.entity_label) as unknown;
      if (Array.isArray(arr)) return arr.map(x => SYNC_RESOURCES[String(x)] ?? String(x)).join(' · ');
    } catch { /* ไม่ใช่ JSON — ใช้ค่าเดิม */ }
  }
  return f.entity_label;
}

/** แปลแถวบันทึกการแก้ไขเป็นภาษาคน — จุดเดียวที่หน้าจอใช้ */
export function describeAudit(f: AuditFacts): AuditMeaning {
  const label = readableLabel(f);
  if (!isBulk(f.action)) {
    const special =
      (f.entity_type === 'salesperson' ? salespersonMeaning(f, label) : null)
      ?? (f.entity_type === 'admin_user' ? adminUserMeaning(f, label) : null)
      ?? (f.entity_type === 'local_contact' || f.entity_type === 'local_product' ? odooMatchMeaning(f, label) : null);
    if (special) return special;
  }
  return { title: actionLabel(f.action, f.entity_type), label, note: null };
}
