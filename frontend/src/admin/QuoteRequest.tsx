// ──────────────────────────────────────────────────────────────────────────────
//  หน้า "ขอใบเสนอราคา" — หน้าเดียวจบ (เฟส E · ขั้น 9′)
//  แผน: docs/plan-web-quote-request.md §0 (form-first) · §P.8 (ยุบสองขั้นเป็นขั้นเดียว)
//
//  v5 ตัดการจำลองแชท LINE ทิ้งทั้งก้อน — หน้านี้ไม่มี Flex ไม่มีฟองแชท ไม่มี postback
//  มีแค่ 3 ส่วนเรียงลงมาในหน้าเดียว ไม่มีการเปลี่ยนหน้า:
//    ส่วนที่ 0  แถบตัวตนของใบ            → QuoteIssuerProfile.tsx
//    ส่วนที่ 1  ช่องวางข้อความ            → POST /api/admin/webquote/propose  (ยังไม่เขียน DB)
//    ส่วนที่ 2  **ตัวเอกสาร**             → POST /api/admin/webquote/preview  (ยังไม่เขียน DB)
//    ส่วนที่ 3  revise จากเลขที่ใบ        → POST /api/admin/webquote/revise   → เติมกลับเข้าใบ
//
//  ── "เอกสารคือฟอร์ม" — ไม่มีขั้นฟอร์มแยกจากขั้นใบร่างอีกแล้ว (เจ้าของเคาะ 2026-09-17) ──────
//  เดิมหน้านี้เดินสองขั้น (`stage: form → review`) คือกรอกในตาราง 8 คอลัมน์ก่อน แล้วกด "ดูใบร่าง"
//  ไปดูเอกสารอีกจอ · ตอนนี้**เหลือจอเดียว**: ช่องกรอกอยู่ในคอลัมน์ของใบเอง (จำนวน · หน่วยละ ·
//  ส่วนลด) และของที่เคยอยู่ในฟอร์ม (เลือกบริษัท/ผู้ติดต่อ · เครดิต · กำหนดส่ง · แถบเพิ่มสินค้า ·
//  เลือกรุ่นที่กำกวม · ค้นรุ่นที่ไม่พบ) ย้ายเข้าไปอยู่ในหัวใบและในตารางของใบ
//
//  เหตุผลที่ยุบได้โดยไม่เสียอะไร: ขั้น review ไม่เคยเป็น "ขั้น" ของข้อมูลเลย มันเรนเดอร์จากผล
//  `/preview` ชุดเดียวกับที่ฟอร์มใช้อยู่แล้ว ⇒ การมีสองจอคือการวาดข้อมูลชุดเดียวกันสองแบบ
//  ซึ่งต้องคอยทำให้ตรงกันตลอดไป · ราคาที่จ่ายแทนคือเอกสารต้องยอมให้พิมพ์ทับได้ ซึ่งถูกกว่า
//
//  ── ทั้งหน้ายังมีจุดเดียวที่เขียน DB: ปุ่ม "ยืนยัน" (2026-09-14 · ยืนยันซ้ำ 2026-09-17) ──────
//  **ไม่มีปุ่ม "บันทึกร่าง"** โดยตั้งใจ — ถ้ามี จะเกิดร่างค้างในระบบที่ต้องมีเมนูให้เปิดต่อ
//  ต้องมีตัวกวาดทิ้ง และต้องตอบให้ได้ว่าร่างที่ค้างคิดราคาด้วยกฎของวันไหน · หน้านี้ทำงานจบใน
//  หนึ่งเซสชัน ไม่มีใครได้ประโยชน์จากร่างค้าง ⇒ "ยกเลิก" ไม่ต้องไปแตะใบไหนเลย
//  "ยืนยัน" เท่านั้นที่ยิง `/drafts` (สร้างจริง) แล้วต่อด้วย `/confirm` ทีละใบจนได้เลขที่ + PDF
//  ราคาที่ต้องจ่ายคือ "ยืนยันแล้วล้มกลางคัน" ซึ่งหน้าจอรายงานตามจริงว่าออกได้กี่ใบ และใบไหน
//  ค้างเป็นร่างอยู่ในระบบ (`strandedIds`)
//
//  ความกำกวมทั้งหมด (บริษัทซ้ำ · รุ่นกำกวม · รุ่นพิมพ์ผิด) ถูกเคาะในใบ **ก่อน** ยืนยัน
//  ⇒ ไม่มี state `pending_product`/`pending_company` ใน DB จากเส้นทางนี้เลย
//
//  `/confirm` เป็น endpoint เดิมของ LIFF ซึ่งตรวจสิทธิ์ด้วย `userId` ใน body ⇒ ต้องแนบ
//  `web_user_id` ที่ได้จาก /drafts ไปด้วยทุกครั้ง (ขั้น 8′)
// ──────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from './PageHeader';
import { QuoteIssuerProfile, type QuoteIssuerIdentity } from './QuoteIssuerProfile';
import { Button } from './Button';
import { ComboBox, type ComboOption } from './PersonComboBox';
import { ConfirmIssueModal } from './ConfirmIssueModal';
import { describeApiError } from './apiError';
import { LocalContactModal, DeleteContactModal } from './LocalContactModal';
import { isLocalContactId } from './localContacts';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  BadgeCheck,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Eye,
  FilePlus2,
  FileText,
  Link2,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Truck,
  Wrench,
} from 'lucide-react';

const BRAND = 'var(--brand-fg)';

/**
 * กุญแจของ sessionStorage ที่หน้า "อนุมัติราคา" ใช้ส่งคำขอที่ถูกตีกลับมาให้ฟอร์มนี้เปิดต่อ
 * — ประกาศคู่กับชนิดของมันที่นี่ เพราะฝั่งเขียนกับฝั่งอ่านต้องเห็นรูปร่างเดียวกัน
 */
export const APPROVAL_RELOAD_KEY = 'price-approval-reload';

/**
 * หยิบก้อนที่หน้า "อนุมัติราคา" ฝากไว้ แล้วลบทิ้งทันที (เปิดได้ครั้งเดียว ไม่ค้างข้ามการรีเฟรช)
 *
 * เป็น `async` ทั้งที่อ่าน sessionStorage เป็นงาน sync — เพื่อให้ `setState` ทุกตัวในเอฟเฟกต์
 * เกิด **หลัง** `await` ตามกฎ `react-hooks/set-state-in-effect` ของรีโปนี้
 */
async function takeApprovalReload(): Promise<ApprovalReloadPayload | null> {
  try {
    const raw = sessionStorage.getItem(APPROVAL_RELOAD_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(APPROVAL_RELOAD_KEY);
    return JSON.parse(raw) as ApprovalReloadPayload;
  } catch {
    // เบราว์เซอร์ที่ปิด storage หรือก้อนที่พังแล้ว — ไม่ใช่เหตุให้หน้าพัง แค่ไม่มีของให้เปิดต่อ
    return null;
  }
}

export interface ApprovalReloadPayload {
  request_id: string;
  customer_id: number | null;
  contact_id: number | null;
  company_name: string | null;
  payment_terms_override: string | null;
  note: string | null;
  items: {
    product_id?: number | null;
    model: string;
    name: string;
    quantity: number;
    price: number;
    discount_1?: number;
    discount_2?: number;
    /** หมายเหตุที่ขึ้นบนใบจริง — ต้องกลับเข้าฟอร์มด้วย ไม่งั้นแก้ใบทีไรหมายเหตุหายทุกที */
    remark?: string | null;
    is_manual_service?: boolean;
  }[];
  /** ชื่อ/ราคาของบรรทัดค่าขนส่งที่กฎเติม — ไม่อยู่ใน `items` แต่แก้ทับได้ ต้องตามกลับมาด้วย */
  auto_fee?: { name: string; price: number } | null;
}

// ── รูปร่างข้อมูลที่ backend ส่งมา ───────────────────────────────────────────

/**
 * ช่อง "ออกในนาม" ได้ค่ามาจากไหน — สี่ค่าแรกคือขั้นของ services/customerSalesOwner.ts ·
 * `quotation` = แก้ใบเดิม · `manual` = คนเลือกเอง · บนจอยุบเหลือสองป้าย ("ระบบเลือก" / "เลือกเอง")
 * แต่ส่งค่าเต็มไปเก็บใน `sp_source` ของประวัติ ไว้วัดว่าแต่ละขั้นช่วยได้จริงแค่ไหน
 */
type SpSource = 'customer' | 'contact' | 'last_order' | 'older_order' | 'quotation' | 'manual';

/** คำตอบของ GET /api/admin/webquote/sales-owner — รูปร่างเดียวกับ `SalesOwner` ฝั่ง server */
type SalesOwner =
  | { status: 'resolved'; source: Exclude<SpSource, 'manual'>; user_id: string; name: string; odoo_name: string | null }
  | { status: 'inactive'; odoo_name: string | null }
  | { status: 'none' };

interface Candidate {
  model: string;
  sales_price: number | string;
  quantity_on_hand_unreserved: number | string;
  product_template_id: number;
  name: string;
  brand?: string;
  series?: string;
  production?: string;
}

interface Slot {
  resolved: boolean;
  itemForDb?: Record<string, unknown>;
  item?: Record<string, unknown>;
  candidates?: Candidate[];
}

interface Scored<T> {
  item: T;
  score: number;
}

interface CustomerRow {
  id: number;
  display_name: string;
  reference?: string | null;
  // เครดิตมาจาก 2 ต้นทางที่ตั้งชื่อคอลัมน์ไม่ตรงกัน และหน้านี้ใช้ทั้งคู่ในลิสต์เดียว:
  //   · `/api/customers/search`  → `payment_terms`          (ADMIN_COMPANY_SUBQ alias ไว้)
  //   · candidates จาก /propose → `customer_payment_terms`  (CDV_COMPANY_SUBQ ไม่ alias)
  // อ่านตัวเดียวจะได้ "—" ครึ่งหนึ่งของเคส จึงต้องรับทั้งสองชื่อ
  payment_terms?: string | null;
  customer_payment_terms?: string | null;
  // สองธงนี้ `/api/customers/search` ส่งมาให้ตั้งแต่แรกแต่หน้าจอไม่เคยหยิบมาใช้ ⇒ แอดมินรู้ว่า
  // เลือกบริษัทที่ออกใบไม่ได้ ก็ต่อเมื่อกดตรวจไปแล้วทั้งใบ (candidates จาก /propose ไม่มีสองตัวนี้
  // จึงเป็น optional — ไม่มีธง = ไม่ขึ้นป้าย ไม่ใช่ "ผ่าน")
  is_blacklisted?: boolean;
  is_credit_hold?: boolean;
}

/** บริษัทในรูปแบบที่ ComboBox ใช้ได้ — พก CustomerRow ตัวเต็มไปด้วยเพื่อเรนเดอร์ป้ายท้ายบรรทัด */
interface CustomerOpt extends ComboOption {
  row: CustomerRow;
}

interface ContactRow {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
}

interface ProposeResult {
  web_user_id: string;
  intent: string;
  extraction_failed: boolean;
  reply_message: string | null;
  quote_data: Record<string, unknown> | null;
  slots: Slot[];
  unresolved_count: number;
  customer_candidates: Scored<CustomerRow>[];
  contact_candidates: Scored<ContactRow>[];
  /** id แถวประวัติของขั้น propose — ส่งกลับตอนสร้างร่างเพื่อให้หลังบ้านวัดได้ว่าเคาะอันดับไหน */
  propose_msg_id: number | null;
  /** บริษัทที่หลังบ้านชั่งคะแนนแล้วชี้ขาดได้ — `null` = ต้องให้แอดมินเคาะเอง */
  auto_customer_id: number | null;
}

interface QuoteItem {
  /** = `product_template_id` (buildResolvedItem ตั้งชื่อฟิลด์นี้ว่า product_id มาแต่เดิม) */
  product_id: number | null;
  model: string;
  name: string;
  quantity: number;
  price: number;
  discount_1: number;
  discount_2: number;
  remark?: string | null;
  is_shipping_fee?: boolean;
  /** สินค้าพ่วงที่กฎเติมให้เอง — ห้ามเติมกลับเข้าฟอร์ม เดี๋ยวถูกขยายซ้ำเป็นสองชุด */
  is_optional?: boolean;
  /** ค่าบริการที่ "คน" เป็นคนใส่ — ต่างจากค่าขนส่งของกฎ ตรงที่ต้องรอดกลับเข้าฟอร์มด้วย */
  is_manual_service?: boolean;
}

/** ใบที่หลังบ้านคืนมา — ใช้แค่ 2 จังหวะ: revise (ดึงรายการกลับเข้าฟอร์ม) และยืนยัน (ต้องรู้ id) */
interface DraftQuote {
  id: string;
  customer_id?: number | null;
  contact_id?: number | null;
  company_name?: string;
  contact_name?: string;
  items: QuoteItem[];
  /** ── ฟิลด์ที่ใช้ตอน revise เท่านั้น: ค่าที่คนออกใบต้นทางตั้งทับไว้ ต้องตามมากับใบแก้ไข ── */
  quote_company?: 'PM' | 'THT';
  /** null = เครดิตของใบต้นทางคือของลูกค้าจริง ๆ ไม่ได้ถูกทับ */
  payment_terms_override?: string | null;
  delivery_type_override?: string | null;
  delivery_days_override?: number | null;
}

// ── ผลตรวจก่อนสร้างร่าง (POST /api/admin/webquote/preview) ───────────────────
//  เป็น dry-run ของ /drafts ที่ไม่เขียน DB — มีเพราะเส้นเว็บ **ทิ้งร่างทั้งใบ** เมื่อติดกฎ
//  ถ้าไม่มีตัวนี้ แอดมินจะรู้ว่าติดอะไรก็ต่อเมื่อกดสร้างไปแล้ว (ดูหัวข้อ previewDraft ฝั่ง server)

interface PreviewViolation {
  type: string;
  model: string;
  display_message: string;
  warn_msg?: string;
  price?: number;
  min_price?: number;
  min_order_qty?: number;
  qty?: number;
}

interface PreviewItem {
  product_template_id: number | null;
  model: string;
  name: string;
  quantity: number;
  price: number;
  discount_1: number;
  discount_2: number;
  line_total: number;
  stock: number;
  is_optional: boolean;
  linked_to_model: string | null;
  is_shipping_fee: boolean;
  is_manual_service: boolean;
  warranty_display: string;
  /** คำอธิบายสินค้าที่จะขึ้นใต้ชื่อบนใบจริง (มาจาก snapshot ตัวเดียวกับที่ PDF พิมพ์) */
  sales_description: string;
  /** หมายเหตุรายบรรทัดที่แอดมินพิมพ์ */
  remark: string;
  violations: PreviewViolation[];
}

/** คีย์ประเภทการจัดส่ง — คำที่จะขึ้นจริงมาจาก `delivery_types` ของ server ไม่ได้เขียนไว้ที่นี่ */
type DeliveryTypeKey = 'in_stock' | 'make_to_order' | 'import' | 'install';

interface PreviewQuote {
  quote_company: 'PM' | 'THT';
  company_label: string;
  items: PreviewItem[];
  subtotal: number;
  delivery_text: string;
  delivery_days: number;
  delivery_all_in_stock: boolean;
  delivery_type_override: DeliveryTypeKey | null;
  delivery_days_override: number | null;
  delivery_type_auto: DeliveryTypeKey;
  delivery_days_auto: number;
  delivery_auto_label: string;
  /** ยอดท้ายใบ 5 ช่อง — server คิดด้วยฟังก์ชันเดียวกับ PDF ห้ามบวกเองบนจอ */
  totals: {
    subtotal: number;
    discount: number;
    after_discount: number;
    vat: number;
    grand_total: number;
    amount_text: string;
    /** ส่วนลดที่หักไปแล้วจริง — ใช้ได้เฉพาะแถบสรุปของแอดมิน ห้ามเอาไปลงช่อง "ส่วนลด" ของใบ */
    discount_total: number;
  };
  warranty_note: string;
  /** หัวกระดาษของบริษัทผู้ขายใบนี้ — มาจาก utils/companyProfile.ts ที่ PDF ใช้ */
  company: {
    key: 'PM' | 'THT';
    logo_file: string;
    name_th: string;
    name_en: string;
    address_lines: string[];
    tax_id: string;
    closing_lines: string[];
  };
}

/**
 * หัวใบที่จอวาด — ก้อน `customer` ของ `/preview` หรือของ `/party` ซึ่ง `contact_id` เป็น `null` ได้
 * (= ก้อนระดับบริษัท ยังไม่ได้เลือกผู้ติดต่อ)
 */
type PartyView = Omit<PreviewResult['customer'], 'contact_id'> & { contact_id: number | null };

interface PreviewResult {
  customer: {
    customer_id: number;
    contact_id: number;
    display_name: string;
    reference: string;
    tax_id: string;
    /** เครดิตที่จะถูกบันทึกลงใบ (= ค่าที่ตั้งทับ ถ้ามี) */
    payment_terms: string;
    /** เครดิตจริงของลูกค้าจาก Odoo */
    customer_payment_terms: string;
    payment_terms_overridden: boolean;
    has_credit_terms: boolean;
    contact_name: string;
    contact_phone: string;
    contact_email: string;
    address: string;
  };
  quotes: PreviewQuote[];
  delivery_types: { key: DeliveryTypeKey; label: string }[];
  goods_total: number;
  grand_total: number;
  violations: PreviewViolation[];
  /**
   * ออกใบต่อได้ไหม — **ติดกฎไม่ได้แปลว่าออกไม่ได้อีกแล้ว** (2026-09-15)
   * เหลือ `false` เฉพาะข้อที่ทะลุไม่ได้จริง ๆ คือ `SYSTEM_ERROR` ("ตรวจกฎไม่สำเร็จ")
   */
  can_create_draft: boolean;
  /** คีย์ของกฎที่ต้องส่งกลับไปเป็น "คำรับทราบ" ตอนกดออกใบ — server เป็นคนประกอบคีย์ให้ */
  override_keys: string[];
  /**
   * ข้อที่ **ติ๊กรับทราบเองไม่ได้ ต้องให้ผู้อนุมัติราคาตัดสิน** (ราคาต่ำกว่าขั้นต่ำ)
   * มีข้อเดียวก็เปลี่ยนความหมายของปุ่มทั้งปุ่ม: จาก "ออกใบ" เป็น "ส่งขออนุมัติ"
   */
  approval_required: PreviewViolation[];
  needs_approval: boolean;
  /** เหตุที่ใบชุดนี้จะถูกกันออกจากไฟล์ export ปกติ — คนละแกนกับ violations ทั้งหมด */
  odoo_manual_reasons: { kind: string; field: string; value: string | null; display_message: string }[];
  service_line: {
    product_template_id: number | null;
    model: string;
    internal_reference: string;
    default_item_name: string;
    default_price: number;
    auto_applied: boolean;
  };
}

/** ค่าตั้งต้นของบรรทัดค่าบริการ — มาจาก GET /api/shipping-fee/config (สินค้าระบบตัวเดียวของทั้งระบบ) */
interface ServiceCfg {
  product_id: number | null;
  model: string;
  internal_reference: string;
  odoo_name: string;
  default_item_name: string;
  /** ชื่อตั้งต้นตอนกด "เพิ่มค่าบริการ" — คนละค่ากับ default_item_name ซึ่งเป็นชื่อของบรรทัดที่กฎเติม */
  manual_item_name: string;
  /** ชื่อที่เลือกได้จาก dropdown ของช่องชื่อ */
  name_presets: string[];
  default_price: number;
}

// ── ป้ายกำกับใต้ชื่อสินค้าในแต่ละแถว ────────────────────────────────────────
//  ถ้อยคำของ violation มาจาก server (buildViolationDisplay) แต่ในแถวใช้คำสั้นกว่าเพื่อไม่ให้
//  ตารางบวม — ข้อความเต็มอยู่ในกล่องสรุปด้านล่างซึ่งเป็นที่เดียวที่ต้องอ่านครบ

type TagTone = 'ok' | 'warn' | 'bad' | 'info' | 'link';
type TagKind = 'check' | 'alert' | 'ban' | 'link' | 'truck' | 'wrench' | 'shield';
interface RowTag {
  tone: TagTone;
  kind: TagKind;
  text: string;
}

const VIOLATION_LABEL: Record<string, string> = {
  BLOCKED: 'ถูกระงับการเสนอราคา',
  OUT_OF_STOCK: 'ระงับเมื่อสต็อกไม่พอ',
  MOQ_VIOLATION: 'ต่ำกว่าจำนวนสั่งขั้นต่ำ',
  MIN_PRICE_VIOLATION: 'ราคาต่ำกว่าขั้นต่ำ',
  CUSTOMER_BLACKLISTED: 'ลูกค้าถูกห้ามเสนอราคา',
  CUSTOMER_CREDIT_HOLD: 'ติดเงื่อนไขเครดิต',
  SYSTEM_ERROR: 'ตรวจกฎไม่สำเร็จ',
};

const shortViolation = (v: PreviewViolation): string => {
  const base = VIOLATION_LABEL[v.type] ?? 'ติดกฎ';
  if (v.type === 'MIN_PRICE_VIOLATION' && v.min_price !== undefined) {
    return `${base} ฿${money2(v.min_price)}`;
  }
  if (v.type === 'MOQ_VIOLATION' && v.min_order_qty !== undefined) {
    return `${base} ${money(v.min_order_qty)}`;
  }
  return v.warn_msg ? `${base} — ${v.warn_msg}` : base;
};

const TAG_ICON: Record<TagKind, React.ComponentType<{ className?: string }>> = {
  check: CheckCircle2,
  alert: AlertTriangle,
  ban: Ban,
  link: Link2,
  truck: Truck,
  wrench: Wrench,
  shield: ShieldCheck,
};

const TAG_CLASS: Record<TagTone, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  bad: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-slate-200 bg-slate-50 text-slate-600',
  // พ่วง = น้ำเงิน — แยกจาก info ที่เป็นสีเทา เพราะบรรทัดที่ระบบผูกให้เองต้องหาเจอง่ายในตารางที่มีหลายป้าย
  // (คำว่า "พ่วง" + ไอคอนโซ่ยังคงอยู่ — ไม่ได้สื่อด้วยสีอย่างเดียว)
  link: 'border-blue-200 bg-blue-50 text-blue-700',
};

/**
 * หมายเหตุรายบรรทัดที่จะไปขึ้น**บนใบจริง** — ยกทรงมาจากหน้า LIFF (`quote-edit.html`
 * ปุ่ม "📝 เพิ่มหมายเหตุ") ที่เซลส์ใช้อยู่ทุกวัน ⇒ สองพื้นผิวสอนเรื่องเดียวกันด้วยท่าเดียวกัน
 *
 * ซ่อนอยู่หลังปุ่มจนกว่าจะมีคนกด เพราะแถวส่วนใหญ่ไม่มีหมายเหตุ — ถ้าโชว์ช่องว่างทุกแถว
 * ตารางจะสูงขึ้นเท่าตัวโดยไม่ได้อะไรกลับมา · มีค่าอยู่แล้วต้องกางเสมอ ไม่งั้นของที่พิมพ์ไว้
 * จะหายไปจากสายตาคนที่กำลังตรวจใบ
 */
const RemarkField: React.FC<{
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  if (disabled) return null;
  if (!open && !value) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-500 hover:text-slate-800"
      >
        <MessageSquarePlus className="w-3 h-3 shrink-0" />
        เพิ่มหมายเหตุ
      </button>
    );
  }
  return (
    <input
      value={value}
      autoFocus={open && !value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={REMARK_MAX}
      placeholder="หมายเหตุที่จะขึ้นบนใบ เช่น ลูกค้าขอรุ่นเดิมกับล็อตที่แล้ว"
      aria-label="หมายเหตุของรายการนี้ (ขึ้นบนใบเสนอราคา)"
      className="mt-1 w-full h-8 px-2 rounded-lg border border-slate-200 bg-card text-[11px] text-slate-700 outline-none"
    />
  );
};

const RowTags: React.FC<{ tags: RowTag[]; dim: boolean; checking: boolean }> = ({ tags, dim, checking }) => {
  if (checking) {
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border border-slate-200 bg-slate-50 text-slate-500">
          <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
          กำลังตรวจ...
        </span>
      </div>
    );
  }
  if (tags.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1 mt-1 ${dim ? 'opacity-50' : ''}`}>
      {tags.map((t, i) => {
        const Icon = TAG_ICON[t.kind];
        return (
          <span
            key={`${t.kind}-${i}`}
            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border ${TAG_CLASS[t.tone]}`}
          >
            <Icon className="w-3 h-3 shrink-0" />
            {t.text}
          </span>
        );
      })}
    </div>
  );
};

// ── เครดิตที่แอดมินเขียนทับได้เฉพาะใบนี้ (2026-09-14) ────────────────────────
//
//  ค่าจริงมาจาก Odoo และแก้ที่นี่ไม่ได้ — แต่ "ใบนี้ตกลงเครดิตกันไว้แบบไหน" เป็นข้อเท็จจริง
//  ของใบ ไม่ใช่ของลูกค้า · เขียนทับแล้ว **กฎค่าบริการเปลี่ยนตามด้วย** (เจ้าของเลือกไว้ว่าให้
//  "มีผลทุกอย่าง") จึงต้องขึ้นบรรทัดบอกทุกครั้งว่ากำลังทับค่าอะไรอยู่ ไม่ใช่เปลี่ยนเงียบ ๆ

/** ข้อความมีตัวเลข = คนน่าจะตั้งใจพิมพ์เครดิต — ใช้เลือกถ้อยคำของคำเตือนเท่านั้น
 *  คำตอบจริงว่า "นับเป็นเครดิตไหม" มาจาก server ในฟิลด์ has_credit_terms */
const looksLikeTerms = (s: string) => /\d/.test(s);

const CreditField: React.FC<{
  effective: string;
  customerValue: string;
  overridden: boolean;
  hasCredit: boolean;
  options: string[];
  onChange: (v: string | null) => void;
  /** ในหัวใบมีป้าย "เครดิต" ของบล็อก meta อยู่แล้ว ⇒ ตัวมันเองต้องไม่พิมพ์ป้ายซ้ำอีกอัน */
  bare?: boolean;
}> = ({ effective, customerValue, overridden, hasCredit, options, onChange, bare }) => {
  /** โหมด "พิมพ์เอง" — เป็น state ของหน้าจอ ไม่ใช่ของค่า เพราะคนกดเลือกแล้วยังไม่ได้พิมพ์อะไร */
  const [other, setOther] = useState(false);
  const custom = other || (overridden && !options.includes(effective));

  return (
    /* คำอธิบายอยู่ในช่องเดียวกับช่องเลือก — ก่อนหน้านี้เคยให้มันกินเต็มความกว้างของ grid
       แล้วไปตกที่หัวแถวถัดไป ซึ่งอยู่คนละฝั่งจอกับช่องที่มันอธิบาย — คำเตือนที่อยู่ไกลจากของที่มันเตือนคือคำเตือนที่ไม่มีใครอ่าน */
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
        {!bare && (
          <>
            <CreditCard className="w-3 h-3 shrink-0 text-slate-400" />
            <span className="text-slate-500 shrink-0">เครดิต</span>
          </>
        )}
        <select
          value={!overridden ? '' : custom ? '__other' : effective}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__other') { setOther(true); onChange(effective || customerValue); return; }
            setOther(false);
            onChange(v === '' ? null : v);
          }}
          aria-label="เครดิตของใบนี้"
          className={`${bare ? 'h-8' : 'h-7'} pl-2 pr-6 rounded-lg border bg-card text-[11px] font-semibold text-slate-800 outline-none max-w-[10rem] ${
            overridden ? 'border-blue-600' : 'border-slate-300'
          }`}
        >
          <option value="">{customerValue || 'ไม่มีข้อมูล'} (ของลูกค้า)</option>
          {options.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
          <option value="__other">อื่น ๆ (พิมพ์เอง)…</option>
        </select>
        {custom && (
          <input
            value={effective}
            onChange={(e) => onChange(e.target.value)}
            placeholder="พิมพ์เครดิตเอง"
            aria-label="เครดิตที่พิมพ์เอง"
            className="h-7 w-32 px-2 rounded-lg border border-blue-600 bg-card text-[11px] font-semibold text-slate-800 outline-none"
          />
        )}
        {overridden && (
          <>
            <Button
              type="button"
              size="icon-sm"
              icon={RotateCcw}
              onClick={() => { setOther(false); onChange(null); }}
              title="ใช้เครดิตของลูกค้า"
              aria-label="ใช้เครดิตของลูกค้า"
            />
            {/* ท้ายใบ (bare) ไม่มีป้าย — ขอบน้ำเงิน + บรรทัด "ค่าจริงของลูกค้า" ข้างล่างบอกอยู่แล้ว
                ป้ายซ้ำในแถวเดียวกันทำให้แถวเงื่อนไขดูรก (เจ้าของทักจากจอจริง 2026-09-23) */}
            {!bare && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-blue-600 text-blue-700">
                ตั้งเอง
              </span>
            )}
          </>
        )}
      </div>
      {overridden && (
        /* สีน้ำเงิน + ✏️ ตั้งเอง = ภาษาเดียวกับบรรทัด "ตั้งเอง" ของกำหนดส่ง (DeliveryStrip) ที่อยู่แถวถัดไป
           (เจ้าของสั่ง 2026-09-23 · เดิม slate-500 จมหายไปกับพื้น) · คำเตือนสีเหลืองข้างในยังเป็นสีเหลืองเหมือนเดิม */
        <p className="mt-1 text-[10.5px] text-blue-700 leading-relaxed">
          ✏️ ตั้งเอง — ค่าจริงของลูกค้า: <span className="font-semibold">{customerValue || 'ไม่มีข้อมูล'}</span> —
          ใบนี้จะบันทึกเป็น “{effective || '(ว่าง)'}”
          {/* คำเตือนสำคัญกว่าเรื่องกฎค่าบริการ: ค่านี้ไหลตรงเข้าคอลัมน์ payment_term_id ของไฟล์
              นำเข้า Odoo (services/odooSaleOrderExport.ts) ค่าที่ Odoo ไม่รู้จัก = แถวนั้น
              นำเข้าไม่ผ่านทั้งแถว ⇒ ต้องเตือนทุกครั้งที่พิมพ์ค่านอกรายการ ไม่ใช่เฉพาะตอนอ่านไม่ออก */}
          {options.length > 0 && !options.includes(effective) && (
            <span className="text-amber-800 font-semibold">
              {' '}· ⚠️ ค่านี้ไม่มีอยู่ในข้อมูลลูกค้ารายไหนเลย — ถ้า Odoo ไม่รู้จัก ไฟล์นำเข้าของใบนี้จะถูกปฏิเสธทั้งแถว
            </span>
          )}
          {looksLikeTerms(effective) && !hasCredit && (
            <span className="text-amber-800 font-semibold">
              {' '}· ⚠️ ระบบอ่านคำนี้ไม่ออกว่าเป็นเครดิต จะถือว่า “ไม่มีเครดิต” (รูปแบบที่อ่านออกคือ “30 Days” หรือ “เช็คล่วงหน้า30วัน”)
            </span>
          )}
        </p>
      )}
    </div>
  );
};

// ── กำหนดส่งของใบ — ย้ายจากหัวการ์ดลงมาอยู่แถวเดียวกับยอดรวม (2026-09-14) ────
//
//  ทำไมย้าย: มันคือ "เงื่อนไขของทั้งใบ" เหมือนยอดรวม ไม่ใช่ป้ายกำกับของกลุ่มสินค้า —
//  และตั้งแต่วันนี้มันแก้ได้ จึงต้องอยู่ในระยะที่มือไปถึง พร้อมกับตัวเลขที่ต้องอ่านคู่กัน
//
//  ชุดควบคุม (ตัวเลือกประเภท · ภายใน N วัน · ปุ่มกลับไปอัตโนมัติ · บรรทัด "ตั้งเอง")
//  ยกมาจาก `liff_pages/quote-edit.html` ทั้งชุด รวมทั้งกติกา "กดรีเซ็ตล้างทั้งประเภทและวัน"
//  — เซลส์คนเดียวกันใช้ทั้งสองหน้า ถ้าปุ่มเดียวกันทำคนละอย่างเขาจะเชื่อหน้าที่เปิดอยู่
//
//  ⚠️ คำของประเภทมาจาก `delivery_types` ที่ server ส่งมา (DELIVERY_TYPES ตัวจริง ซึ่งต้องตรงกับ
//     dropdown ของ Odoo ทุกอักขระ) — ห้ามเขียนตารางคำชุดที่สองไว้ในไฟล์นี้

type DeliveryOv = { type: DeliveryTypeKey | null; days: number | null };

/** สีของกำหนดส่ง = สถานะสต๊อก ไม่ใช่สถานะ "ตั้งเองหรือเปล่า" (มีไอคอนกำกับด้วยเสมอ) */
const deliveryTone = (allInStock: boolean) =>
  allInStock
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-amber-200 bg-amber-50 text-amber-800';

const DeliveryStrip: React.FC<{
  quote: PreviewQuote;
  types: { key: DeliveryTypeKey; label: string }[];
  ov: DeliveryOv | undefined;
  onChange: (v: DeliveryOv | undefined) => void;
}> = ({ quote, types, ov, onChange }) => {
  /** ตัวเลขที่ "กำลังพิมพ์อยู่" — null = ไม่ได้พิมพ์ ให้แสดงค่าที่ใช้จริง (กันเลขกระโดดกลางคัน) */
  const [typing, setTyping] = useState<string | null>(null);
  const on = !!ov && (ov.type !== null || ov.days !== null);
  // อ่านจาก state ของหน้า ไม่ใช่จากผลตรวจ — ผลตรวจตามมาทีหลัง 700ms ช่องจะกระพริบกลับค่าเก่า
  const shown = typing ?? String(ov?.days ?? quote.delivery_days_auto);

  const patch = (p: Partial<DeliveryOv>) => {
    const next: DeliveryOv = { type: ov?.type ?? null, days: ov?.days ?? null, ...p };
    onChange(next.type === null && next.days === null ? undefined : next);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Truck className="w-3.5 h-3.5 shrink-0 text-slate-400" />
      <select
        value={ov?.type ?? ''}
        onChange={(e) => patch({ type: (e.target.value || null) as DeliveryTypeKey | null })}
        aria-label={`ประเภทการจัดส่งของใบ ${quote.quote_company}`}
        className={`h-8 pl-2 pr-6 rounded-lg border text-[11px] font-semibold outline-none ${deliveryTone(
          quote.delivery_all_in_stock,
        )} ${ov?.type ? 'ring-1 ring-blue-600' : ''}`}
      >
        <option value="">อัตโนมัติ ({quote.delivery_auto_label})</option>
        {types.map((t) => (
          <option key={t.key} value={t.key}>{t.label}</option>
        ))}
      </select>
      <span className="text-[11px] text-slate-500">ภายใน</span>
      <input
        type="number"
        min={0}
        max={3650}
        step={1}
        inputMode="numeric"
        value={shown}
        aria-label={`จำนวนวันจัดส่งของใบ ${quote.quote_company}`}
        onChange={(e) => {
          const raw = e.target.value;
          setTyping(raw);
          const t = raw.trim();
          // ลบจนว่าง = กลับไปใช้ค่าอัตโนมัติ (เติมเลขคืนให้ตอนเลิกพิมพ์) — ท่าเดียวกับ quote-edit
          if (t === '') { patch({ days: null }); return; }
          const n = Math.round(Number(t));
          if (!Number.isFinite(n)) return;
          patch({ days: Math.max(0, Math.min(3650, n)) });
        }}
        onBlur={() => setTyping(null)}
        className={`h-8 w-16 px-2 text-center rounded-lg border bg-card text-[11px] font-semibold text-slate-800 tabular-nums outline-none ${
          ov?.days !== null && ov?.days !== undefined ? 'border-blue-600' : 'border-slate-300'
        }`}
      />
      <span className="text-[11px] text-slate-500">วัน</span>
      {on && (
        <Button
          type="button"
          size="icon"
          icon={RotateCcw}
          onClick={() => { setTyping(null); onChange(undefined); }}
          title="ใช้ค่าอัตโนมัติ"
          aria-label={`ใช้กำหนดส่งอัตโนมัติของใบ ${quote.quote_company}`}
        />
      )}
      {on && (
        <span className="basis-full text-[10.5px] text-blue-700">
          ✏️ ตั้งเอง — ค่าอัตโนมัติคือ {quote.delivery_auto_label} {quote.delivery_days_auto} วัน
          (จะไม่เปลี่ยนตามสินค้าที่แก้ทีหลัง)
        </span>
      )}
    </div>
  );
};

// ── แถวในตารางสินค้าของฟอร์ม (ก่อนสร้างร่าง) ────────────────────────────────

type RowStatus = 'ok' | 'ambiguous' | 'notfound';

interface Row {
  key: string;
  productTemplateId: number | null;
  model: string;
  name: string;
  /** เก็บเป็น string เพื่อให้ลบทั้งช่องแล้วพิมพ์ใหม่ได้ (เหมือนหน้าตั้งค่าอื่นในระบบ) */
  quantity: string;
  price: string;
  disc1: string;
  disc2: string;
  /**
   * หมายเหตุที่จะขึ้น**บนใบจริง**ใต้ชื่อสินค้า (pdfGenerator พิมพ์ว่า "หมายเหตุ: …")
   * ไม่ใช่โน้ตภายใน — ลูกค้าเห็น · ทางเดิมของ LINE พิมพ์ผ่าน LIFF (quote-edit ปุ่ม "📝 เพิ่มหมายเหตุ")
   */
  remark: string;
  candidates: Candidate[];
  status: RowStatus;
  /** บรรทัดค่าบริการ (สินค้าระบบตัวเดียวของทั้งระบบ) — ชื่อแก้ได้ จำนวน/ส่วนลดถูกล็อก */
  isService?: boolean;
  /** ใบที่แถวนี้จะไปอยู่ตามผลตรวจครั้งล่าสุด — จำไว้เพื่อไม่ให้กลุ่มกระโดดระหว่างรอผลรอบใหม่ */
  company?: 'PM' | 'THT';
}

/** ต้องเท่ากับ `ITEM_REMARK_MAX` ใน services/webQuoteService.ts — server ตัดให้อยู่ดี
 *  แต่ตัดบนจอด้วยดีกว่า เพราะคนจะได้รู้ตั้งแต่ตอนพิมพ์ ไม่ใช่ตอนเห็นใบว่าหายไปครึ่งประโยค */
const REMARK_MAX = 200;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** ของที่ไม่ใช่เงิน — จำนวนชิ้น · สต๊อก · เปอร์เซ็นต์ (ยอดเงินใช้ `money2()` เสมอ) */
const money = (v: unknown): string =>
  num(v).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * ตัวเลขทศนิยม 2 ตำแหน่งเสมอ — **ยอดเงินทุกตัวในหน้านี้ใช้ตัวนี้** (เจ้าของสั่ง 2026-09-17)
 * เพราะใบ PDF พิมพ์ `1,234.00` ไม่ใช่ `1,234` ⇒ ถ้าจอตัด `.00` ทิ้ง คนจะเทียบกับไฟล์ไม่ตรง
 * และ `฿274,628.5` อ่านผิดเป็นจำนวนสตางค์ได้ · `money()` เหลือไว้สำหรับของที่ **ไม่ใช่เงิน**
 * เท่านั้น — จำนวนชิ้น · สต๊อกคงเหลือ · เปอร์เซ็นต์ส่วนลด (ตรงนั้น `.00` คือขยะ)
 */
const money2 = (v: unknown): string =>
  num(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ยอดรวมของแถว — ตรรกะเดียวกับ calcNetPrice ฝั่ง server (แสดงผลอย่างเดียว server ตัดสินจริงเสมอ) */
const rowTotal = (r: Row): number =>
  num(r.quantity) * num(r.price) * (1 - num(r.disc1) / 100) * (1 - num(r.disc2) / 100);

let rowSeq = 0;
const newKey = () => `r${++rowSeq}`;

function rowsFromSlots(slots: Slot[], quoteData: Record<string, unknown> | null): Row[] {
  const billD1 = quoteData ? String(num(quoteData.discount_1) || '') : '';
  const billD2 = quoteData ? String(num(quoteData.discount_2) || '') : '';
  return slots.map((s) => {
    if (s.resolved && s.itemForDb) {
      const it = s.itemForDb as Record<string, unknown>;
      return {
        key: newKey(),
        productTemplateId: num(it.product_id) || null,
        model: String(it.model ?? ''),
        name: String(it.name ?? ''),
        quantity: String(num(it.quantity) || 1),
        price: String(num(it.price)),
        disc1: String(num(it.discount_1) || ''),
        disc2: String(num(it.discount_2) || ''),
        remark: String(it.remark ?? ''),
        candidates: [],
        status: 'ok' as RowStatus,
      };
    }
    const raw = (s.item ?? {}) as Record<string, unknown>;
    const cands = s.candidates ?? [];
    return {
      key: newKey(),
      productTemplateId: null,
      model: String(raw.model ?? raw.product_code ?? ''),
      name: '',
      quantity: String(num(raw.quantity) || 1),
      price: '',
      // ส่วนลดตั้งต้นตามกติกาเดียวกับตอนสกัด: ระบุรายบรรทัดมา = ใช้ของบรรทัด ไม่งั้นใช้ของท้ายบิล
      disc1: String(num(raw.discount_1) || '') || billD1,
      disc2: String(num(raw.discount_1) || '') ? String(num(raw.discount_2) || '') : billD2,
      remark: String(raw.remark ?? ''),
      candidates: cands,
      status: (cands.length > 0 ? 'ambiguous' : 'notfound') as RowStatus,
    };
  });
}

/**
 * วันที่บนเอกสาร — ต้องเป็นค่าเดียวกับที่ `thaiDateDMY()` ฝั่ง server พิมพ์ลง PDF
 * (`en-GB` + โซนกรุงเทพ ⇒ dd/mm/yyyy **ปี ค.ศ.** ไม่ใช่ พ.ศ.) · ผูกกับโซนไทยตายตัว
 * ไม่ใช่โซนของเครื่องที่เปิดหน้าจอ ไม่งั้นแอดมินคนละโซนเห็นคนละวันกับที่ใบจะพิมพ์จริง
 */
const THAI_DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const thaiToday = () => THAI_DATE_FMT.format(new Date());

/**
 * ── เอกสาร = "ใบที่จะได้" และเป็นฟอร์มไปในตัว (2026-09-17 · จาก mockup ชุด ed-) ────────
 *
 * ลำดับการอ่านและถ้อยคำทุกบล็อกยกมาจากใบ PDF จริง (หัวบริษัท → ผู้ซื้อ/เลขที่ → ตาราง 6
 * คอลัมน์ → สรุปยอดพร้อม VAT และตัวอักษร → เงื่อนไข 3 บรรทัด → ช่องลงนาม 3 ช่อง)
 * แต่วาดด้วยโทเคนของแอดมิน **ไม่ใช่รูปถ่ายของกระดาษ** — เหตุผลที่ไม่ทำเป็นกระดาษ A4 จำลอง:
 *   1. หน้าตาใบมีเจ้าของอยู่แล้วคือ `pdfGenerator.ts` ก๊อป HTML/CSS มาไว้ที่นี่ = สองสำเนา
 *      ที่ไม่มีวันถูกแก้พร้อมกัน วันหนึ่งใบบนจอกับใบที่ลูกค้าได้รับจะไม่ใช่ใบเดียวกันเงียบ ๆ
 *   2. A4 บนจอ 390px ย่อจนอ่านไม่ออก ต้องมีดีไซน์ที่สองไว้ดูแลคู่กันตลอดไป
 * ⇒ "ของจริงหน้าตาเป๊ะแบบไหน" ตอบด้วยปุ่ม **พรีวิว PDF** ซึ่งเจนจาก generateQuotationPDF()
 *   ตัวเดียวกับใบจริง ไม่ใช่ด้วยการวาดเลียนแบบ
 *
 * ตัวเลขทุกตัวในบล็อกสรุปมาจาก `q.totals` ของ server — **ห้ามบวกเองบนจอ**
 * (`ส่วนลด` เป็น 0.00 เสมอเพราะใบจริงพิมพ์แบบนั้นมาตลอด · เหตุผลอยู่ที่ utils/pricing.ts)
 * ⇒ ยังไม่ได้ตรวจก็ยังไม่มียอดท้ายใบให้โชว์ บอกว่า "รอผลตรวจ" ตรง ๆ ดีกว่าเดาเลขให้ดูครบ
 *
 * **ยกเว้นคอลัมน์ "ราคา" รายบรรทัด** ที่คิดบนจอด้วย `rowTotal()` — มันต้องขยับทันทีที่พิมพ์
 * ไม่งั้นช่องกรอกจะรู้สึกเหมือนพัง · ตัวตัดสินจริงยังเป็น server เสมอ และยอดท้ายใบไม่เคยใช้ค่านี้
 */
const deHtml = (s: string) => s.replace(/&nbsp;/g, ' ');

/** แถวข้อมูลของบล็อกหัวใบ — คู่ label/value ที่ตัดบรรทัดได้โดยไม่ดันคอลัมน์ */
const DocField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex gap-2 py-[2px] text-[11.5px] items-start">
    <span className="text-slate-400 shrink-0 w-[86px]">{label}</span>
    <span className="text-slate-700 min-w-0 break-words">{children}</span>
  </div>
);

const SumRow: React.FC<{ label: string; value: string; strong?: boolean; big?: boolean }> = ({
  label, value, strong, big,
}) => (
  <div
    className={`flex justify-between gap-3 py-[3px] ${
      big
        ? 'mt-1.5 pt-2 border-t border-slate-200 text-[15px] font-extrabold text-slate-900'
        : strong
          ? 'text-xs font-bold text-slate-800'
          : 'text-xs text-slate-600'
    }`}
  >
    <span>{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
);

/**
 * ชื่อใต้เส้นลายเซ็นในรูปเดียวกับบนกระดาษ — **สำเนาของ `formatPersonNameWithSuffix()` ใน
 * pdfGenerator.ts** (หน้าแอดมิน import ฝั่ง backend ไม่ได้) แก้ที่ไหนต้องแก้อีกที่ให้ตรงกัน
 * ตัด `คุณ` นำหน้า → ลบ `(PM)`/`(THT)` เดิมกันซ้อน → ห้อยค่ายของใบ
 * `co = null` = ยังไม่ได้ตรวจ ยังไม่รู้ว่าใบเป็นค่ายไหน ⇒ ไม่ห้อย ดีกว่าห้อยผิดค่าย
 */
function signName(rawName: string | null | undefined, co: 'PM' | 'THT' | null): string | null {
  const raw = rawName ? String(rawName).trim() : '';
  if (raw === '') return null;
  const clean = raw.replace(/^(คุณ)\s*/, '').replace(/\s*\((PM|THT)\)$/gi, '');
  return co ? `${clean} (${co})` : clean;
}

const SignCell: React.FC<{ role: string; name: string | null; phone?: string | null; sig?: string | null }> = ({
  role, name, phone, sig,
}) => (
  <div className="px-4 py-3 text-center border-t sm:border-t-0 sm:border-l border-slate-200 sm:first:border-l-0">
    <div className="h-10 flex items-center justify-center">
      {sig ? <img src={sig} alt="" className="max-h-10 object-contain" /> : null}
    </div>
    <div className="border-t border-slate-300 mx-6 mt-1 mb-1.5" />
    <p className="text-[12px] font-bold text-slate-700">{name || '—'}</p>
    <p className="text-[10.5px] text-slate-400">
      {role}
      {phone ? ` · ${phone}` : ''}
    </p>
  </div>
);

// ── ช่องค้นหาสินค้าแบบกะทัดรัด — ใช้สองที่: ในแถวตาราง และแถบเพิ่มสินค้าใต้ตาราง ────
//  ไม่ใช้ ProductComboBox ของหน้าตั้งค่า เพราะตัวนั้นเป็นฟิลด์เต็มความสูง 44px พร้อม label
//  ซึ่งวางในเซลล์ตารางไม่ได้ และไม่คืนราคามาให้ (แถวนี้ต้องเติมราคาตั้งต้นทันทีที่เลือก)
//
//  **รายการผลค้นต้องอยู่นอกกล่องตาราง** — ตารางสินค้าถูกครอบด้วย `overflow-x-auto` และ
//  ตามสเปค CSS พออีกแกนเป็น `visible` เบราว์เซอร์จะคำนวณ `overflow-y` เป็น `auto` ให้เอง
//  กล่องนั้นจึงกลายเป็น clipping context: dropdown แบบ `absolute` ในเซลล์ถูกตัด **และ**
//  ไปดันให้กล่องตารางงอก scrollbar ของตัวเองขึ้นมาอีกชั้น (วัดที่ 1280px: ตัดทิ้ง 219px
//  จากรายการสูง 224px · กล่องตารางงอก scroll 219px) ⇒ ต้อง `createPortal` ออกไปที่
//  `document.body` แล้ววางด้วย `position: fixed` จากพิกัดของช่องค้น
//  — วิธีเดียวกับ flyout ของ sidebar ใน AdminApp.tsx ซึ่งชน `overflow-y-auto` ของ nav แบบเดียวกัน

interface SearchHit {
  product_id: number;
  model: string;
  name: string;
  price: number | string;
  stock?: number | string;
}

/**
 * ข้อเท็จจริงท้ายบรรทัดของบริษัท — รหัสลูกค้า + สถานะที่ทำให้ออกใบไม่ได้
 * แยกสีและไอคอนคนละตัวระหว่าง "ห้ามเสนอราคา" (บล็อกแน่นอน) กับ "ติดเครดิต" (บล็อกตามกฎ)
 * เพราะสองอย่างนี้คนละความรุนแรง — และทั้งคู่มีทั้งคำและไอคอน ไม่ได้สื่อด้วยสีอย่างเดียว
 */
const CustomerFacts: React.FC<{ row: CustomerRow }> = ({ row }) => {
  const terms = row.payment_terms || row.customer_payment_terms || '';
  return (
    <span className="flex items-center gap-2 shrink-0 text-[11px] whitespace-nowrap">
      {row.reference && <span className="text-slate-500">{row.reference}</span>}
      {row.is_blacklisted ? (
        <span className="flex items-center gap-1 font-semibold px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-700">
          <Ban className="w-3 h-3 shrink-0" />
          ห้ามเสนอราคา
        </span>
      ) : row.is_credit_hold ? (
        <span className="flex items-center gap-1 font-semibold px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-800">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          ติดเครดิต
        </span>
      ) : terms ? (
        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{terms}</span>
      ) : null}
    </span>
  );
};

/**
 * ป้ายสต็อกของรายการสินค้า — สามสถานะเดียวกับ `liff_pages/product-search.html` เป๊ะ
 * (`out` / `low` / `ok`) เพราะเซลส์คนเดียวกันสลับไปมาระหว่างสองพื้นผิว ถ้าคำหรือเกณฑ์
 * ไม่ตรงกัน เขาจะเชื่อหน้าที่เปิดอยู่ตอนนั้นแล้วสรุปว่าอีกหน้าผิด
 * `need` = จำนวนที่ขอ ⇒ ช่อง "เพิ่มสินค้า" ที่ยังไม่รู้จำนวนถือว่าขอ 1 ชิ้น
 */
const StockBadge: React.FC<{ stock: number; need: number }> = ({ stock, need }) => {
  const [cls, text] =
    stock <= 0
      ? ['border-red-200 bg-red-50 text-red-700', 'สินค้าหมด']
      : stock < need
        ? ['border-amber-200 bg-amber-50 text-amber-800', `ไม่พอ (เหลือ ${money(stock)})`]
        : ['border-emerald-200 bg-emerald-50 text-emerald-700', `พร้อมส่ง ${money(stock)}`];
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>{text}</span>;
};

/** พิกัดของรายการผลค้นบนจอ — คำนวณใหม่ทุกครั้งที่เปิด/เลื่อนจอ/ปรับขนาดหน้าต่าง */
interface PopPos {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

/**
 * กล่องลอยที่เกาะใต้ช่องกรอก — วาดผ่าน portal ด้วย `position: fixed` เพราะตารางของใบเลื่อน/ตัดขอบเองได้
 * กล่องแบบ absolute ในแถวจึงโดนตัดหาย · ใช้ร่วมกันระหว่างช่องค้นสินค้ากับช่องชื่อค่าบริการ
 * `contentKey` เปลี่ยน = วางตำแหน่งใหม่ (เนื้อหาในกล่องเปลี่ยนความสูง)
 */
function useAnchoredPopover(open: boolean, setOpen: (v: boolean) => void, minWidth: number, contentKey?: unknown) {
  const [pos, setPos] = useState<PopPos | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const el = shellRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, minWidth);
    const below = window.innerHeight - r.bottom - 16;
    const above = r.top - 16;
    // คีย์บอร์ดมือถือกินครึ่งล่างของจอ ⇒ ถ้าข้างล่างไม่พอให้พลิกขึ้นบนแทน
    const down = below >= 220 || below >= above;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 12)),
      top: down ? r.bottom + 4 : undefined,
      bottom: down ? undefined : window.innerHeight - r.top + 4,
      width,
      maxHeight: Math.max(120, Math.min(360, down ? below : above)),
    });
  }, [minWidth]);

  // `scroll` ต้องดักแบบ capture เพราะกล่องตารางเลื่อนเองได้ ไม่ใช่แค่หน้าเว็บ
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place, contentKey]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (shellRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open, setOpen]);

  return { shellRef, popRef, pos };
}

/**
 * ชื่อของบรรทัดค่าบริการที่คนเพิ่มเอง — พิมพ์เองได้ หรือกดลูกศรเลือกจากชื่อที่ใช้บ่อย
 * (เจ้าของสั่ง 2026-09-25) · รายการมาจาก server (`MANUAL_SERVICE_NAME_PRESETS` ใน
 * `services/shippingFee.ts`) ไม่เขียนซ้ำในไฟล์นี้ · อ่านรายการไม่ได้ = เหลือช่องพิมพ์ล้วนเหมือนเดิม
 * · พิมพ์แล้วกล่องหุบ — คนที่เริ่มพิมพ์คือคนที่ไม่เอาชื่อในรายการ
 * · กว้างเต็มคอลัมน์ "รายการ" ไม่มีเพดาน (เจ้าของสั่ง 2026-09-25) — ชื่อค่าบริการยาวได้เป็นประโยค
 */
const ServiceNameField: React.FC<{
  value: string;
  presets: string[];
  onChange: (v: string) => void;
}> = ({ value, presets, onChange }) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const { shellRef, popRef, pos } = useAnchoredPopover(open, setOpen, 280);
  const inputRef = useRef<HTMLInputElement>(null);
  const popId = useId();
  const hasList = presets.length > 0;

  const show = (v: boolean) => {
    setOpen(v && hasList);
    setActive(-1);
  };
  const choose = (name: string) => {
    onChange(name);
    show(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!hasList) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) return show(true);
      setActive((i) => (i + 1) % presets.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) setActive((i) => (i <= 0 ? presets.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (open && active >= 0) {
        e.preventDefault();
        choose(presets[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        show(false);
      }
    } else if (e.key === 'Tab') {
      show(false);
    }
  };

  return (
    <>
      <div
        ref={shellRef}
        className="flex items-center flex-1 min-w-0 w-full h-8 rounded-lg border border-slate-300 bg-card focus-within:border-[var(--brand-fg)]"
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            show(false);
          }}
          onFocus={() => show(true)}
          onKeyDown={onKeyDown}
          placeholder="ชื่อรายการที่จะขึ้นในใบ — เลือกหรือพิมพ์เอง"
          aria-label="ชื่อรายการค่าบริการ"
          autoComplete="off"
          role={hasList ? 'combobox' : undefined}
          aria-expanded={hasList ? open : undefined}
          aria-controls={hasList ? popId : undefined}
          aria-activedescendant={open && active >= 0 ? `${popId}-opt-${active}` : undefined}
          className="flex-1 min-w-0 h-full px-2.5 bg-transparent text-xs text-slate-800 outline-none"
        />
        {hasList && (
          <button
            type="button"
            tabIndex={-1}
            // ห้ามขโมยโฟกัสจากช่องพิมพ์ ไม่งั้นกล่องหุบแล้วกางใหม่สลับกัน
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              show(!open);
              inputRef.current?.focus();
            }}
            title="เลือกจากชื่อที่ใช้บ่อย"
            aria-label="เลือกจากชื่อที่ใช้บ่อย"
            className="h-full px-2 text-slate-400 hover:text-slate-700"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            id={popId}
            role="listbox"
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'fixed',
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
            className="z-50 overflow-y-auto overscroll-contain bg-card border border-slate-200 rounded-xl shadow-xl"
          >
            <div className="px-3 py-1 bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500">
              เลือกชื่อที่ใช้บ่อย — หรือพิมพ์ชื่ออื่นในช่องได้เลย
            </div>
            {presets.map((name, i) => (
              <button
                key={name}
                id={`${popId}-opt-${i}`}
                role="option"
                aria-selected={value === name}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(name)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 text-xs ${
                  value === name ? 'font-semibold text-[var(--brand-fg)]' : 'text-slate-700'
                } ${i === active ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
              >
                <span className="flex-1 min-w-0">{name}</span>
                {value === name && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

const ProductSearchBox: React.FC<{
  /** คำที่เติมไว้ให้ตั้งแต่แรก — แถวที่จับคู่ไม่ได้ใช้รุ่นที่ลูกค้าพิมพ์มาเป็นตัวตั้ง */
  initialQuery?: string;
  placeholder: string;
  /** danger = ช่องในแถวที่ยังเคาะไม่เสร็จ · plain = แถบเพิ่มสินค้าใต้ตาราง */
  tone: 'danger' | 'plain';
  /** แถบเพิ่มสินค้าต้องล้างคำค้นหลังเลือก เพื่อพิมพ์ตัวถัดไปต่อได้ทันที */
  clearOnPick?: boolean;
  /** จำนวนที่แถวนั้นขอ — ใช้ตัดสินว่าสต็อก "ไม่พอ" · ช่องเพิ่มสินค้ายังไม่รู้จำนวน ถือว่า 1 */
  needQty?: number;
  onPick: (hit: SearchHit) => void;
}> = ({ initialQuery = '', placeholder, tone, clearOnPick, needQty = 1, onPick }) => {
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { shellRef, popRef, pos } = useAnchoredPopover(open, setOpen, 320, `${hits.length}|${loading}|${failed}`);
  const popId = useId();

  useEffect(() => {
    // ล้างผลค้นตอนช่องว่างทำที่ onChange ไม่ใช่ที่นี่ — setState ตรง ๆ ใน effect
    // ถูกกฎ react-hooks/set-state-in-effect ปฏิเสธ (และมันคืองานของ event handler จริง ๆ)
    const q = query.trim();
    if (!q) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&limit=12`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setHits(Array.isArray(data) ? data : []);
        setFailed(false);
      } catch {
        setHits([]);
        setFailed(true);
      } finally {
        setLoading(false);
        setActive(0);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const choose = (h: SearchHit) => {
    onPick(h);
    setOpen(false);
    if (clearOnPick) {
      setQuery('');
      setHits([]);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) return setOpen(query.trim().length > 0);
      setActive((i) => (hits.length ? (i + 1) % hits.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (hits.length ? (i - 1 + hits.length) % hits.length : 0));
    } else if (e.key === 'Enter') {
      const hit = hits[active];
      if (open && hit) {
        e.preventDefault();
        choose(hit);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <>
      <div
        ref={shellRef}
        className={`flex items-center gap-1.5 h-9 px-2.5 rounded-lg border bg-card ${
          tone === 'danger' ? 'border-red-300' : 'border-slate-200'
        }`}
      >
        <Search className={`w-3.5 h-3.5 shrink-0 ${tone === 'danger' ? 'text-red-400' : 'text-slate-400'}`} />
        <input
          value={query}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            setOpen(v.trim().length > 0);
            if (!v.trim()) {
              setHits([]);
              setFailed(false);
            }
          }}
          onFocus={() => setOpen(query.trim().length > 0)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={popId}
          aria-activedescendant={open && hits[active] ? `${popId}-opt-${active}` : undefined}
          className="flex-1 bg-transparent outline-none text-xs text-slate-800 placeholder:text-slate-400 min-w-0"
        />
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
      </div>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            id={popId}
            role="listbox"
            // กดที่รายการแล้วต้องไม่ทำให้ช่องค้นเสียโฟกัส ไม่งั้นพิมพ์ตัวถัดไปต่อไม่ได้
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'fixed',
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
            className="z-50 overflow-y-auto overscroll-contain bg-card border border-slate-200 rounded-xl shadow-xl"
          >
            {/* slate-500 ไม่ใช่ slate-400: ตัวอักษร 10px บนพื้น slate-50 ของธีมสว่าง
                ที่ slate-400 ได้ contrast ~2.6:1 ซึ่งตกเกณฑ์ 4.5 ของตัวอักษรขนาดปกติ */}
            <div className="sticky top-0 flex items-center gap-2 px-3 py-1 bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500">
              {loading ? 'กำลังค้นหา...' : failed ? 'ค้นหาไม่สำเร็จ' : `${hits.length} รายการ`}
              <span className="ml-auto hidden sm:inline">↑ ↓ เลื่อน · Enter เลือก · Esc ปิด</span>
            </div>

            {loading ? (
              <p className="flex items-center gap-2 px-3 py-4 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                กำลังค้นหา &ldquo;{query.trim()}&rdquo;
              </p>
            ) : failed ? (
              <p className="flex items-start gap-2 px-3 py-4 text-xs text-red-700">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                ค้นหาไม่สำเร็จ — เช็กการเชื่อมต่อแล้วพิมพ์ใหม่อีกครั้ง
              </p>
            ) : hits.length === 0 ? (
              <p className="px-3 py-4 text-xs text-slate-500">
                ไม่พบสินค้าที่ตรงกับ &ldquo;{query.trim()}&rdquo;
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {hits.map((h, i) => (
                  <button
                    key={h.product_id}
                    id={`${popId}-opt-${i}`}
                    role="option"
                    aria-selected={i === active}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(h)}
                    ref={(el) => {
                      if (i === active) el?.scrollIntoView({ block: 'nearest' });
                    }}
                    className={`w-full text-left px-3 py-2 flex items-center gap-3 ${
                      num(h.stock) <= 0 ? 'bg-red-50/40 ' : ''
                    }${i === active ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-semibold text-slate-800 truncate">{h.model}</span>
                      <span className="block text-[11px] text-slate-500 truncate">{h.name}</span>
                    </span>
                    {/* ราคาและสต็อกชิดขวาเป็นคอลัมน์ของตัวเอง — สองค่านี้คือสิ่งที่คนกวาดตาหา
                        ตอนเลือกรุ่น การวางไว้ท้ายบรรทัดที่สามทำให้ต้องอ่านทั้งการ์ดก่อนถึงจะเจอ */}
                    <span className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-xs font-bold tabular-nums" style={{ color: BRAND }}>
                        ฿{money2(h.price)}
                      </span>
                      <StockBadge stock={num(h.stock)} need={needQty} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
};

/** หนึ่ง "ใบที่จะออกจริง" · `quote` ว่าง = ยังไม่ได้ตรวจ จึงยังไม่รู้ว่าบรรทัดไหนไปบริษัทไหน */
interface DocGroup {
  co: 'PM' | 'THT';
  label: string;
  rows: Row[];
  extras: PreviewItem[];
  quote: PreviewQuote | undefined;
}

/**
 * ทุกอย่างที่เอกสารต้องใช้เพื่อ "เป็นฟอร์ม" มัดรวมเป็นก้อนเดียว — prop เรียงกัน 20 ตัวไม่มีใครอ่าน
 * และไม่ต้องกลัวว่าก้อนใหม่ทุกเรนเดอร์จะทำให้ช้า เพราะเอกสารต้องวาดใหม่อยู่แล้วทุกครั้งที่ตัวเลขขยับ
 */
/** หนึ่งบรรทัดที่ส่งให้ /preview · /drafts · /preview-pdf (= WebQuoteItemInput ฝั่ง server) */
interface ItemPayload {
  product_template_id: number | null;
  model: string;
  quantity: number;
  price: number | null;
  discount_1: number;
  discount_2: number;
  remark: string;
  name?: string;
  is_auto_fee?: boolean;
}

/** ชื่อ/ราคาที่คนแก้ทับบรรทัดค่าขนส่งของกฎ — เก็บเป็นข้อความเหมือนช่องกรอกของแถวอื่น */
type AutoFeeOv = { name: string; price: string };

interface DocCtx {
  customer: PartyView | null;
  identity: QuoteIssuerIdentity | null;
  svcCfg: ServiceCfg | null;
  /** ค่าที่แก้ทับบรรทัดค่าขนส่งของกฎ — null = ใช้ชื่อ/ราคาจากหน้าตั้งค่า */
  autoFeeOv: AutoFeeOv | null;
  /** `base` = บรรทัดที่ผลตรวจโชว์อยู่ ใช้เติมช่องที่ยังไม่ได้แตะ (แก้ชื่อแล้วราคาต้องไม่หาย) */
  editAutoFee: (base: PreviewItem, patch: Partial<AutoFeeOv>) => void;
  resetAutoFee: () => void;
  /** ผลตรวจของแต่ละแถว (จับคู่ด้วย `Row.key` มาแล้ว) — ไม่มี = แถวนี้ยังไม่เคยผ่านการตรวจ */
  matched: Map<string, PreviewItem>;
  staleNow: boolean;
  previewing: boolean;
  /** ยังไม่เลือกบริษัท/ผู้ติดต่อ แล้วมีของจะเสนอแล้ว = ต้องไฮไลต์ว่าต้องเคาะ */
  mustPick: boolean;
  patchRow: (key: string, patch: Partial<Row>) => void;
  removeRow: (key: string) => void;
  pickCandidate: (key: string, c: Candidate) => void;
  /** พิมพ์ส่วนลดเสร็จแล้วเสนอ "ใช้กับทุกรายการ" — ผู้เรียกเป็นคนหน่วงเวลาเอง */
  offerBulk: (key: string) => void;
  /** ข้อเสนอที่กำลังโชว์ (ชิปใต้ช่องส่วนลดของแถว `rowKey`) · null = ไม่มี */
  bulkOffer: BulkOffer | null;
  multiDoc: boolean;
  applyBulk: (scope: 'doc' | 'all') => void;
  dismissBulk: () => void;
  rowTagsOf: (r: Row, hit: PreviewItem | null) => RowTag[];
  extraTagsOf: (it: PreviewItem) => RowTag[];
  // ── หัวใบ: ลูกค้า · เครดิต · กำหนดส่ง ──
  customerOpt: CustomerOpt | null;
  customerOpts: CustomerOpt[];
  onPickCustomer: (o: CustomerOpt) => void;
  onCustomerQuery: (q: string) => void;
  custSearching: boolean;
  contactOpt: { id: string; name: string; phone: string } | null;
  contactOpts: { id: string; name: string; phone: string }[];
  onPickContact: (id: number) => void;
  /** เปิดกล่อง "เพิ่มผู้ติดต่อใหม่" พร้อมชื่อที่พิมพ์ค้างไว้ในช่องค้น (ว่างได้) */
  onAddContact: (prefill: string) => void;
  /**
   * แก้ไข/ลบ "คนที่เราเพิ่มเอง" — `null` เมื่อคนที่เลือกอยู่เป็นของ Odoo หรือยังไม่ได้เลือกใคร
   *
   * เป็น callback ที่เป็น null ได้ ไม่ใช่ boolean คู่กับ callback อีกตัว — เอกสารจะได้ไม่ต้อง
   * ถือกติกา "ใคร local ใคร Odoo" ของตัวเอง (ตัวตัดสินอยู่ที่ `isLocalContactId` ที่เดียว)
   */
  onEditContact: (() => void) | null;
  onDeleteContact: (() => void) | null;
  paymentTerms: string | null;
  paymentTermOpts: string[];
  setPaymentTerms: (v: string | null) => void;
  deliveryTypes: { key: DeliveryTypeKey; label: string }[];
  deliveryOv: Partial<Record<'PM' | 'THT', DeliveryOv>>;
  setDeliveryOv: (co: 'PM' | 'THT', v: DeliveryOv | undefined) => void;
  // ── แถบเพิ่มรายการท้ายตาราง ──
  addProductRow: (h: SearchHit) => void;
  addRow: () => void;
  addServiceRow: () => void;
  canAddService: boolean;
  serviceHint: string;
  justAdded: string | null;
}

const QuoteDocument: React.FC<{ g: DocGroup; ctx: DocCtx }> = ({ g, ctx }) => {
  const q = g.quote;
  const co = q?.company ?? null;
  const cust = ctx.customer;
  const t = q?.totals ?? null;
  const empty = g.rows.length === 0 && g.extras.length === 0;

  /* ชั้นเดียวกันทุกเซลล์ตัวเลข: จอแคบเป็นบรรทัด "ป้าย — ค่า" · จอกว้างกลับเป็นคอลัมน์ตาราง
     (ย่อตาราง 6 คอลัมน์ลงมาเฉย ๆ = ตารางที่อ่านไม่ออก — docs/design.md หัวข้อ responsive) */
  const cell =
    'flex justify-between items-center gap-3 px-4 py-0.5 text-xs text-slate-600 tabular-nums ' +
    'before:content-[attr(data-k)] before:text-slate-400 ' +
    'md:table-cell md:px-2 md:py-2 md:text-right md:align-top md:before:content-none';
  /** เซลล์ช่องกรอก (จำนวน · หน่วยละ · ส่วนลด) — จัดกลางในโหมดตารางให้ตรงกับหัวคอลัมน์ */
  const cellC = cell.replace('md:text-right', 'md:text-center');
  /** ของในเซลล์ชิดขวาเสมอ ทั้งโหมดการ์ดและโหมดตาราง
   *  · จอกว้างสูงอย่างน้อยเท่าช่องกรอก (h-8) แล้วจัดกลางแนวตั้ง ⇒ ตัวเลขล้วน ("1 Pcs" · ยอดราคา · "—")
   *    อยู่แนวเดียวกับตัวเลขในช่องกรอกของแถวเดียวกัน (เจ้าของทักจากจอจริง 2026-09-25 ว่าตัวหนังสือลอยสูงกว่า) */
  const inner = 'inline-flex items-center justify-end gap-1.5 md:min-h-8';
  const inp =
    'h-8 px-2 rounded-lg border border-slate-300 bg-card text-xs text-right text-slate-800 outline-none ' +
    'focus:border-[var(--brand-fg)] disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200';

  /**
   * ปุ่มลบเป็นไอคอน **ในเซลล์ "ราคา"** ไม่ใช่คอลัมน์ที่ 7 (เจ้าของเคาะ 2026-09-17)
   * — ใบจริงมี 6 คอลัมน์ เพิ่มคอลัมน์เมื่อไหร่ หัวตารางบนจอกับบนกระดาษจะเริ่มไม่ตรงกัน
   * และในโหมดการ์ดมันก็ยังชิดขวาของบรรทัดราคาเหมือนกัน
   */
  const DelBtn: React.FC<{ onClick?: () => void; locked?: boolean; label: string }> = ({
    onClick, locked, label,
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      title={locked ? 'บรรทัดที่กฎเติมให้เอง — ถอดออกได้ที่กฎ ไม่ใช่ที่ใบ' : 'ลบบรรทัดนี้'}
      aria-label={`ลบบรรทัด ${label}`}
      className="shrink-0 w-[26px] h-[26px] rounded-lg flex items-center justify-center text-slate-400
        hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:bg-transparent"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div className="bg-card border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* ── หัวเอกสาร ──
          ยังไม่ได้ตรวจ = **พูดตรง ๆ ว่ารอผลตรวจ** (เจ้าของเคาะ 2026-09-17) ไม่ใช่เดาบริษัท
          แล้วเอาโลโก้ผิดขึ้นไว้ก่อน — หัวใบที่ผิดคือสิ่งที่คนเชื่อโดยไม่ตรวจซ้ำ */}
      <div
        className={`flex flex-wrap items-start gap-3 px-4 py-3 border-b border-slate-200 ${
          co ? 'bg-slate-50' : 'bg-slate-100'
        }`}
      >
        {co ? (
          <img src={`/data/${co.logo_file}`} alt="" className="w-16 h-auto object-contain shrink-0" />
        ) : (
          <span className="w-[76px] h-[46px] shrink-0 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-center text-[10px] leading-tight text-slate-400 px-1">
            ใบของบริษัทไหน
            <br />
            รอผลตรวจ
          </span>
        )}
        <div className="flex-1 min-w-[200px]">
          {co ? (
            <>
              <p className="text-[13px] font-extrabold text-slate-800">{co.name_th}</p>
              <p className="text-xs text-slate-500">{co.name_en}</p>
              <p className="text-[10.5px] text-slate-400 leading-snug mt-0.5">
                {deHtml(co.address_lines[0] ?? '')}
                <br />
                เลขประจำตัวผู้เสียภาษี {co.tax_id}
              </p>
            </>
          ) : (
            <>
              <p className="text-[13px] font-extrabold text-slate-600">ระบบจัดใบให้เองตอนตรวจ</p>
              <p className="text-xs text-slate-500">
                บรรทัดของ Primus กับ Themtech จะถูกแยกเป็นคนละใบอัตโนมัติ
              </p>
              <p className="text-[10.5px] text-slate-400 leading-snug mt-0.5">
                หัวบริษัท ที่อยู่ และเลขผู้เสียภาษี มาจากที่เดียวกับที่ไฟล์ PDF ใช้
              </p>
            </>
          )}
        </div>
        <div className="text-right ml-auto">
          <p className="text-sm font-extrabold text-slate-800">ใบเสนอราคา</p>
          <p className="text-[10.5px] text-slate-500">Quotation · F-MK-04 REV.6</p>
        </div>
      </div>

      {/* ── ผู้ซื้อ / ข้อมูลเอกสาร — ช่องกรอกอยู่ตรงที่มันไปโผล่บนใบ ไม่ใช่ในฟอร์มอีกใบข้างบน ──
          ซ้าย 2/3 · ขวา 1/3 (เจ้าของสั่ง 2026-09-23 · แทน 3/4–1/4 ที่ลองก่อน) — ฝั่งซ้ายมีช่องเลือกบริษัท/ผู้ติดต่อที่ชื่อยาว
          ส่วนฝั่งขวาเป็นค่าสั้น ๆ ที่ตัดบรรทัดได้ (เครดิต/กำหนดส่ง wrap เองอยู่แล้ว) */}
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] border-b border-slate-200">
        <div className="px-4 py-3">
          <DocField label="รหัสลูกค้า">
            {cust?.reference || '—'}
            <span className="text-slate-300 mx-1.5">·</span>
            เลขผู้เสียภาษี {cust?.tax_id || '—'}
          </DocField>
          {/* นามผู้ซื้อ = ช่องเลือกบริษัท · ไม่มีฟอร์มแยกข้างบนอีกแล้ว ⇒ ต้องเลือกได้จากในใบ */}
          <div className="flex gap-2 py-[2px] text-[11.5px] items-start">
            <span className="text-slate-400 shrink-0 w-[86px] mt-2">นามผู้ซื้อ</span>
            {/* เต็มความกว้างคอลัมน์ — เคยตันที่ 320px ชื่อบริษัทถูกตัดจนอ่านไม่ออก */}
            <span className="min-w-0 flex-1">
              <ComboBox<CustomerOpt>
                value={ctx.customerOpt}
                options={ctx.customerOpts}
                onPick={ctx.onPickCustomer}
                onQueryChange={ctx.onCustomerQuery}
                placeholder="— เลือกบริษัท —"
                emptyText="พิมพ์ชื่อหรือรหัสลูกค้าเพื่อค้นหา"
                ariaLabel="บริษัท / ลูกค้า"
                searchPlaceholder="พิมพ์ชื่อหรือรหัสลูกค้าเพื่อค้นหา..."
                invalid={!ctx.customerOpt && ctx.mustPick}
                busy={ctx.custSearching}
                facts={(o) => <CustomerFacts row={o.row} />}
              />
            </span>
          </div>
          <div className="flex gap-2 py-[2px] text-[11.5px] items-start">
            <span className="text-slate-400 shrink-0 w-[86px] mt-2">ผู้ติดต่อ</span>
            <span className="min-w-0 flex-1">
              <ComboBox
                value={ctx.contactOpt}
                options={ctx.contactOpts}
                onPick={(o) => ctx.onPickContact(Number(o.id))}
                placeholder={ctx.customerOpt ? '— เลือกผู้ติดต่อ —' : '— เลือกบริษัทก่อน —'}
                emptyText="บริษัทนี้ยังไม่มีผู้ติดต่อในระบบ"
                ariaLabel="ผู้ติดต่อ"
                searchPlaceholder="พิมพ์ชื่อหรือเบอร์เพื่อค้นหา..."
                invalid={!ctx.contactOpt && ctx.mustPick}
                disabled={!ctx.customerOpt}
                searchText={(o) => `${o.name} ${o.phone}`}
                facts={(o) => (
                  <span className="shrink-0 text-[11px] text-slate-500 whitespace-nowrap">{o.phone || '—'}</span>
                )}
                /*
                 * ทางเข้าของ "เพิ่มผู้ติดต่อใหม่" — เจ้าของเลือกแบบนี้จาก mockup ชุด lc-* (2026-09-21)
                 * อยู่ท้ายรายการเพราะนั่นคือจังหวะที่คนกำลังหาคนที่ไม่มีอยู่พอดี และไม่กินความกว้าง
                 * ของช่องบนใบ · ช่องนี้ disabled อยู่แล้วเมื่อยังไม่เลือกบริษัท
                 * ⇒ กางไม่ออก = กดไม่ได้ ไม่ต้องมีสถานะ disabled ของแถวนี้แยกอีกชั้น
                 */
                action={(q) => (
                  <button
                    type="button"
                    onClick={() => ctx.onAddContact(q)}
                    className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs font-bold text-[var(--brand-fg)] bg-slate-50 hover:bg-[var(--brand-soft)] transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    เพิ่มผู้ติดต่อใหม่
                  </button>
                )}
              />
            </span>
            {/* แก้/ลบ เฉพาะคนที่เราเพิ่มเอง — ผู้ติดต่อของ Odoo ต้องไปแก้ที่ Odoo (เจ้าของเคาะ
                2026-09-21) · ไอคอนล้วนเพราะหัวใบต้องอ่านเหมือน
                เอกสาร ไม่ใช่แถบเครื่องมือ */}
            {(ctx.onEditContact || ctx.onDeleteContact) && (
              <span className="flex shrink-0 items-center gap-0.5 mt-1">
                {ctx.onEditContact && (
                  <button
                    type="button"
                    onClick={ctx.onEditContact}
                    title="แก้ไขผู้ติดต่อที่เพิ่มเอง"
                    aria-label="แก้ไขผู้ติดต่อที่เพิ่มเอง"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-[var(--brand-fg)] hover:bg-slate-100 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                {ctx.onDeleteContact && (
                  <button
                    type="button"
                    onClick={ctx.onDeleteContact}
                    title="ลบผู้ติดต่อที่เพิ่มเอง"
                    aria-label="ลบผู้ติดต่อที่เพิ่มเอง"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </span>
            )}
          </div>
          <DocField label="โทรศัพท์">{cust?.contact_phone || ctx.contactOpt?.phone || '—'}</DocField>
          <DocField label="อีเมล">{cust?.contact_email || '—'}</DocField>
          <DocField label="ที่อยู่">{cust?.address || '—'}</DocField>
        </div>
        <div className="px-4 py-3 border-t sm:border-t-0 sm:border-l border-slate-200">
          {/* เลขที่ใบออกตอนกดยืนยันเท่านั้น (allocateQuotationNo) — เขียนตรง ๆ ว่ายังไม่มี
              ดีกว่าปล่อยช่องว่างที่อ่านได้ว่า "ระบบลืมใส่" */}
          <DocField label="เลขที่">
            <span className="italic text-slate-400">ออกให้เมื่อกดยืนยัน</span>
          </DocField>
          <DocField label="วันที่">{thaiToday()}</DocField>
          <DocField label="PO Ref.">
            <span className="text-slate-400">—</span>
          </DocField>
          <DocField label="สถานที่ส่งของ">{cust?.address || '—'}</DocField>
        </div>
      </div>

      {/* ── ตารางรายการ 6 คอลัมน์เหมือนใบจริง — และเป็นที่ที่แก้ของได้จริง ── */}
      <table className="w-full text-sm">
        <thead className="hidden md:table-header-group">
          <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
            <th className="text-left font-bold py-2 pl-4 pr-2 w-12">ลำดับ</th>
            <th className="text-left font-bold py-2">รายการ</th>
            {/* หัวคอลัมน์ต้องตรงกับช่องกรอกข้างล่าง (เจ้าของทักจากจอจริง 2026-09-23):
                สามคอลัมน์ที่เป็นช่องกรอก + หน่วย (Pcs / %) จัดกลางทั้งหัวและเซลล์ (`cellC`) ⇒ หัวอยู่
                กลางกลุ่มช่องพอดี · "ราคา" ชิดขวาแต่เว้นที่ปุ่มลบ (26px + gap 6px) ⇒ หัวตรงกับตัวเลข */}
            <th className="text-center font-bold py-2 px-2 w-[104px]">จำนวน</th>
            <th className="text-center font-bold py-2 px-2 w-[116px]">หน่วยละ</th>
            <th className="text-center font-bold py-2 px-2 w-[132px]">ส่วนลด</th>
            <th className="text-right font-bold py-2 pl-2 pr-12 w-[148px]">ราคา</th>
          </tr>
        </thead>
        <tbody>
          {empty && (
            <tr className="block md:table-row">
              <td className="block md:table-cell px-4 py-6 text-center" colSpan={6}>
                <FileText className="w-5 h-5 mx-auto text-slate-400" />
                <p className="mt-1.5 text-xs font-semibold text-slate-600">ยังไม่มีรายการในใบ</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  เพิ่มสินค้าจากช่องด้านล่างได้เลย — หรือวางข้อความที่ลูกค้าส่งมาไว้ด้านบน แล้วกด “สร้างร่าง”
                  ให้ระบบเคาะรายการให้
                </p>
              </td>
            </tr>
          )}

          {g.rows.map((r, idx) => {
            const hit = ctx.matched.get(r.key) ?? null;
            const vios = ctx.staleNow ? [] : (hit?.violations ?? []);
            const bad = vios.length > 0;
            const editable = r.status === 'ok';
            return (
              <tr
                key={r.key}
                className={`block md:table-row border-b border-slate-100 last:border-0 py-2 md:py-0 ${
                  bad
                    ? 'bg-red-50/60 md:border-l-[3px] md:border-l-red-500'
                    : r.status === 'notfound'
                      ? 'bg-red-50/60'
                      : r.status === 'ambiguous'
                        ? 'bg-amber-50/60'
                        : ''
                }`}
              >
                <td className="hidden md:table-cell align-top py-2.5 pl-4 text-xs text-slate-400">{idx + 1}</td>
                <td className="block md:table-cell align-top px-4 md:pl-0 md:pr-3 py-1 md:py-2">
                  {r.isService ? (
                    <div className="space-y-1">
                      <ServiceNameField
                        value={r.name}
                        presets={ctx.svcCfg?.name_presets ?? []}
                        onChange={(name) => ctx.patchRow(r.key, { name })}
                      />
                      <p className="text-[11px] text-slate-400">
                        {r.model} · {ctx.svcCfg?.internal_reference} · {ctx.svcCfg?.odoo_name} (Odoo)
                      </p>
                    </div>
                  ) : r.status === 'ok' ? (
                    <>
                      <p className="font-semibold text-slate-800 text-[13px]">{r.model}</p>
                      <p className="text-[11px] text-slate-500">{r.name}</p>
                      {/* สองบรรทัดนี้ขึ้นบนใบจริง ⇒ ต้องอ่านได้ตอนทำใบ ไม่ใช่ไปเจอตอนเปิด PDF */}
                      {hit?.sales_description && (
                        <p className="text-[11px] text-slate-400 whitespace-pre-line leading-snug mt-0.5">
                          {hit.sales_description.trim()}
                        </p>
                      )}
                    </>
                  ) : r.status === 'ambiguous' ? (
                    // คำเตือนอยู่ "ใต้" ตัวเลือก — ของที่ต้องลงมือทำมาก่อน คำอธิบายว่าทำไมตามหลัง
                    <div className="space-y-1">
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const c = r.candidates.find((x) => String(x.product_template_id) === e.target.value);
                          if (c) ctx.pickCandidate(r.key, c);
                        }}
                        aria-label={`เลือกรุ่นที่ถูกต้องแทน ${r.model}`}
                        className="w-full max-w-sm h-8 px-2.5 rounded-lg border border-amber-400 bg-card text-xs outline-none"
                      >
                        <option value="">— เลือกรุ่น —</option>
                        {r.candidates.map((c) => (
                          <option key={c.product_template_id} value={c.product_template_id}>
                            {c.model} · ฿{money2(c.sales_price)} · คงเหลือ {money(c.quantity_on_hand_unreserved)}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-amber-800">
                        “{r.model}” ตรงกับหลายรุ่น — เลือกรุ่นที่ถูกต้อง
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1 max-w-sm">
                      <ProductSearchBox
                        initialQuery={r.model}
                        placeholder="ค้นหารุ่นที่ถูกต้อง..."
                        tone="danger"
                        needQty={num(r.quantity) || 1}
                        onPick={(h) =>
                          ctx.patchRow(r.key, {
                            productTemplateId: h.product_id,
                            model: h.model,
                            name: h.name,
                            price: String(num(h.price)),
                            status: 'ok',
                            candidates: [],
                          })
                        }
                      />
                      <p className="text-[11px] text-red-700">
                        {r.model ? `ไม่พบรุ่น “${r.model}” ในระบบ` : 'ยังไม่ได้เลือกสินค้า'}
                      </p>
                    </div>
                  )}
                  <RowTags
                    tags={ctx.rowTagsOf(r, hit)}
                    dim={ctx.staleNow}
                    checking={ctx.previewing && !hit && r.status === 'ok'}
                  />
                  <RemarkField
                    value={r.remark}
                    onChange={(v) => ctx.patchRow(r.key, { remark: v })}
                    /* บรรทัดค่าบริการรับหมายเหตุไม่ได้ — buildShippingFeeSnapshot ประกอบบรรทัดนี้
                       ใหม่ทุกครั้งด้วย remark: '' ⇒ โชว์ช่องให้พิมพ์ = สัญญาว่าจะเก็บให้ทั้งที่เก็บไม่ได้ */
                    disabled={r.isService || r.status !== 'ok'}
                  />
                </td>
                <td data-k="จำนวน" className={cellC}>
                  <span className={inner}>
                    <input
                      value={r.quantity}
                      onChange={(e) => ctx.patchRow(r.key, { quantity: e.target.value })}
                      inputMode="decimal"
                      aria-label="จำนวน"
                      disabled={r.isService}
                      title={r.isService ? 'ค่าบริการนับเป็น 1 รายการเสมอ' : undefined}
                      className={`${inp} w-[62px]`}
                    />
                    <span className="text-[11px] text-slate-400">Pcs</span>
                  </span>
                </td>
                <td data-k="หน่วยละ" className={cellC}>
                  <span className={inner}>
                    <input
                      value={r.price}
                      onChange={(e) => ctx.patchRow(r.key, { price: e.target.value })}
                      inputMode="decimal"
                      placeholder="ราคาตั้ง"
                      aria-label="ราคาต่อหน่วย"
                      disabled={!editable}
                      className={`${inp} w-[92px]`}
                    />
                  </span>
                </td>
                <td data-k="ส่วนลด" className={cellC}>
                  {/* ห่อไว้ตลอด ไม่ใช่เฉพาะตอนมีชิป — เปลี่ยนโครงรอบช่องกรอกเมื่อไหร่ React ถอดช่องแล้วสร้างใหม่
                      ⇒ เคอร์เซอร์หลุดจากช่องที่กำลังพิมพ์ */}
                  <span className="inline-flex flex-col items-end md:items-center gap-1.5">
                    <span className={inner}>
                      {!editable || r.isService ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <>
                          <input
                            value={r.disc1}
                            /* ล้างชั้น 1 แล้วชั้น 2 ต้องหายด้วย — ไม่งั้นจะเหลือช่องที่กรอกไม่ได้แต่ยังหักเงินอยู่ */
                            onChange={(e) => {
                              const v = e.currentTarget.value;
                              ctx.patchRow(r.key, num(v) > 0 ? { disc1: v } : { disc1: v, disc2: '' });
                              ctx.offerBulk(r.key);
                            }}
                            inputMode="decimal"
                            aria-label="ส่วนลดชั้นที่ 1 (%)"
                            className={`${inp} w-[46px]`}
                          />
                          <span className="text-[11px] text-slate-400">%</span>
                          <span className="text-[11px] text-slate-300">,</span>
                          <input
                            value={r.disc2}
                            onChange={(e) => {
                              ctx.patchRow(r.key, { disc2: e.currentTarget.value });
                              ctx.offerBulk(r.key);
                            }}
                            inputMode="decimal"
                            aria-label="ส่วนลดชั้นที่ 2 (%)"
                            /* ล็อกเฉพาะตอนที่ "ไม่มีอะไรอยู่เลย" — ใบเก่าที่มีชั้น 2 มาโดยไม่มีชั้น 1
                               (ใบเก่าจาก LINE เป็นแบบนี้ได้) ต้องแก้ไขได้ ไม่งั้นกลายเป็นเลขที่ใครก็แก้ไม่ได้ */
                            disabled={num(r.disc1) <= 0 && num(r.disc2) <= 0}
                            title={num(r.disc1) > 0 ? undefined : 'กรอกส่วนลดชั้นที่ 1 ก่อน'}
                            className={`${inp} w-[46px]`}
                          />
                          <span className="text-[11px] text-slate-400">%</span>
                        </>
                      )}
                    </span>
                    {ctx.bulkOffer?.rowKey === r.key && (
                      <BulkDiscountChips
                        offer={ctx.bulkOffer}
                        multiDoc={ctx.multiDoc}
                        onApply={ctx.applyBulk}
                        onDismiss={ctx.dismissBulk}
                      />
                    )}
                  </span>
                </td>
                <td data-k="ราคา" className={`${cell} md:pr-4 font-bold text-slate-800`}>
                  <span className={inner}>
                    <span>{editable ? money2(rowTotal(r)) : '—'}</span>
                    <DelBtn onClick={() => ctx.removeRow(r.key)} label={r.model || 'ที่ยังไม่ได้เลือกสินค้า'} />
                  </span>
                </td>
              </tr>
            );
          })}

          {/* บรรทัดที่ระบบเติมให้เอง (สินค้าพ่วง · ค่าขนส่งอัตโนมัติ) — ลบไม่ได้ เพราะเจ้าของมันคือกฎ
              ฝั่ง server แต่ต้องเห็น ไม่งั้นยอดรวมจะอธิบายไม่ได้
              · ค่าขนส่งของกฎ **แก้ชื่อ/ราคาทับได้** (เจ้าของสั่ง 2026-09-25 · หน้า LIFF แก้ได้มาก่อนแล้ว)
                แต่ยังเป็นของกฎ: ยอดถึงเกณฑ์เมื่อไหร่ถอดออกเอง ค่าที่แก้ไว้ส่งไปเป็น `is_auto_fee` */}
          {g.extras.map((it, i) => {
            const fee = it.is_shipping_fee && !it.is_manual_service && !!ctx.svcCfg;
            const ov = ctx.autoFeeOv;
            // ปุ่มคืนค่าโผล่เมื่อค่าต่างจากหน้าตั้งค่าจริง ๆ — ใบที่เปิดกลับมาแก้ก็พกค่ามาด้วย แต่ไม่ได้แปลว่ามีคนแก้
            const feeEdited =
              fee && !!ov && (ov.name.trim() !== ctx.svcCfg!.default_item_name || num(ov.price) !== ctx.svcCfg!.default_price);
            return (
            <tr
              key={`x-${g.co}-${it.model}-${i}`}
              className="block md:table-row border-b border-slate-100 last:border-0 py-2 md:py-0 bg-slate-50/70"
            >
              <td className="hidden md:table-cell align-top py-2.5 pl-4 text-xs text-slate-400">
                {g.rows.length + i + 1}
              </td>
              <td className="block md:table-cell align-top px-4 md:pl-0 md:pr-3 py-1 md:py-2">
                {/* ค่าบริการ/ค่าขนส่งใช้รหัสสินค้าร่วมกันทั้งระบบ ⇒ ตัวที่ต้องอ่านคือชื่อรายการ */}
                {fee ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <ServiceNameField
                        value={ov?.name ?? it.name}
                        presets={ctx.svcCfg?.name_presets ?? []}
                        onChange={(name) => ctx.editAutoFee(it, { name })}
                      />
                      {feeEdited && (
                        <Button
                          type="button"
                          size="icon-sm"
                          icon={RotateCcw}
                          onClick={ctx.resetAutoFee}
                          title="ใช้ชื่อและราคาจากหน้าตั้งค่า"
                          aria-label="ใช้ชื่อและราคาจากหน้าตั้งค่า"
                        />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">{it.model}</p>
                  </div>
                ) : it.is_shipping_fee || it.is_manual_service ? (
                  <>
                    <p className="font-semibold text-slate-800 text-[13px]">{it.name}</p>
                    <p className="text-[11px] text-slate-400">{it.model}</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-slate-800 text-[13px]">{it.model}</p>
                    <p className="text-[11px] text-slate-500">{it.name}</p>
                  </>
                )}
                {it.sales_description && (
                  <p className="text-[11px] text-slate-400 whitespace-pre-line leading-snug mt-0.5">
                    {it.sales_description.trim()}
                  </p>
                )}
                <RowTags tags={ctx.extraTagsOf(it)} dim={ctx.staleNow} checking={false} />
              </td>
              <td data-k="จำนวน" className={cellC}>
                <span className={inner}>{money(it.quantity)} Pcs</span>
              </td>
              <td data-k="หน่วยละ" className={cellC}>
                <span className={inner}>
                  {fee ? (
                    <input
                      value={ov?.price ?? String(it.price)}
                      onChange={(e) => ctx.editAutoFee(it, { price: e.target.value })}
                      inputMode="decimal"
                      placeholder={money2(ctx.svcCfg!.default_price)}
                      aria-label="ราคาค่าขนส่ง"
                      className={`${inp} w-[92px]`}
                    />
                  ) : (
                    money2(it.price)
                  )}
                </span>
              </td>
              <td data-k="ส่วนลด" className={cellC}>
                <span className={inner}>
                  {it.discount_1 || it.discount_2
                    ? [it.discount_1, it.discount_2].filter(Boolean).map((d) => `${money(d)} %`).join(' , ')
                    : '—'}
                </span>
              </td>
              <td data-k="ราคา" className={`${cell} md:pr-4 font-bold text-slate-800`}>
                <span className={inner}>
                  <span>{money2(it.line_total)}</span>
                  <DelBtn locked label={it.model} />
                </span>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>

      {/* ── แถบเพิ่มรายการ — อยู่ "ในใบ" แต่เป็นเส้นประ ⇒ อ่านออกว่าไม่ใช่บรรทัดของเอกสาร ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-t border-dashed border-slate-300 bg-slate-50">
        <Plus className="w-4 h-4 shrink-0" style={{ color: BRAND }} />
        <div className="flex-1 min-w-[180px]">
          <ProductSearchBox
            placeholder="เพิ่มสินค้า — พิมพ์รุ่นหรือชื่อ แล้วกด Enter"
            tone="plain"
            clearOnPick
            onPick={ctx.addProductRow}
          />
        </div>
        <Button variant="neutral" tone="soft" onClick={ctx.addRow}>
          แถวเปล่า
        </Button>
        <Button variant="secondary" icon={Wrench} disabled={!ctx.canAddService} onClick={ctx.addServiceRow}>
          เพิ่มค่าบริการ
        </Button>
        {ctx.justAdded && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            เพิ่ม {ctx.justAdded} แล้ว
          </span>
        )}
        <p className="basis-full text-[11px] text-slate-400">
          ระบบวางแถวลงใบของบริษัทผู้ผลิตให้เอง — เพิ่มจากใบไหนก็ได้ ไม่ต้องเลือกว่าจะไปใบไหน ·{' '}
          {ctx.serviceHint}
        </p>
      </div>

      {/* ── สรุปยอด + หมายเหตุท้ายใบ ──
          ทุกตัวเลขมาจาก `q.totals` ที่ server คิดด้วยฟังก์ชันเดียวกับ PDF — ห้ามบวกเองบนจอ
          ⇒ ยังไม่ได้ตรวจก็ยังไม่มีตัวเลขให้โชว์ พูดว่า “รอผลตรวจ” ตรง ๆ ดีกว่าโชว์เลขที่เดาเอง
          ฝั่งซ้ายเรียงตามใบจริง (เจ้าของสั่ง 2026-09-23): หมายเหตุ → นโยบายข้อมูลส่วนบุคคล →
          ตัวอักษร → เงื่อนไข 3 บรรทัด — ข้อความ/ลิงก์ต้องตรงกับท่อน pdpa/terms ใน pdfGenerator.ts */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_300px] border-t border-slate-200">
        <div className="px-4 py-3 text-[11px] text-slate-500 leading-relaxed">
          <p>
            <span className="font-bold text-slate-600">หมายเหตุ:</span> {q?.warranty_note ?? '—'}
          </p>
          <p className="mt-2 text-slate-400">
            ขอแจ้งนโยบายขอข้อมูลส่วนบุคคล เพื่อประโยชน์ในการได้รับข้อมูลผลิตภัณฑ์หรือบริการของเรา
            อาทิ ใบเสนอราคา, การติดต่อกลับเพื่อสอบถามหรือนำเสนอข้อมูล ดูรายละเอียดเพิ่มเติม:{' '}
            <a
              href="https://www.primusthai.com/primus/Activity/info?ID=340"
              target="_blank"
              rel="noopener noreferrer"
              className="break-all underline hover:text-[var(--brand-fg)]"
            >
              https://www.primusthai.com/primus/Activity/info?ID=340
            </a>
          </p>
          <p className={`mt-3 pt-2 border-t border-slate-100 ${ctx.staleNow ? 'opacity-50' : ''}`}>
            <span className="font-bold text-slate-600">ตัวอักษร:</span> {t ? t.amount_text : '—'}
          </p>
          {/* เงื่อนไข 3 บรรทัด — ลำดับเดียวกับกระดาษ หนึ่งค่าต่อหนึ่งแถว
              เครดิตกับกำหนดส่ง "ช่องเลือกคือตัวแสดงผล" (เจ้าของสั่ง 2026-09-23) — ไม่พิมพ์ค่าซ้ำเป็นข้อความ
              ข้างช่องอีก เพราะสองอย่างนี้บอกเรื่องเดียวกันแล้วทำให้แถวรก · คำอธิบายรอง (ค่าจริงของลูกค้า /
              ตั้งเอง) ตกไปอยู่ใต้ช่องของแถวนั้นเอง · หัวแถวสูง h-8 เท่าช่องเลือก ⇒ ป้ายตรงกับช่องพอดี */}
          <dl className="mt-3 pt-2 border-t border-slate-100 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="h-8 flex items-center text-slate-500">Price Validity</dt>
            <dd className="h-8 flex items-center font-semibold text-slate-700">7 Day</dd>

            <dt className="h-8 flex items-center text-slate-500">Term Payment</dt>
            <dd className="min-w-0">
              <CreditField
                effective={ctx.paymentTerms ?? cust?.payment_terms ?? ''}
                customerValue={cust?.customer_payment_terms ?? ''}
                overridden={ctx.paymentTerms !== null}
                hasCredit={cust?.has_credit_terms ?? false}
                options={ctx.paymentTermOpts}
                onChange={ctx.setPaymentTerms}
                bare
              />
            </dd>

            <dt className="h-8 flex items-center text-slate-500">Delivery Time</dt>
            <dd className="min-w-0">
              {ctx.previewing && !q ? (
                <span className="h-8 flex items-center gap-1 text-slate-500">
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                  กำลังคำนวณกำหนดส่ง...
                </span>
              ) : q ? (
                <DeliveryStrip
                  quote={q}
                  types={ctx.deliveryTypes}
                  ov={ctx.deliveryOv[q.quote_company]}
                  onChange={(v) => ctx.setDeliveryOv(q.quote_company, v)}
                />
              ) : (
                <span className="h-8 flex items-center text-slate-400">ระบบคำนวณให้ตอนตรวจรายละเอียด</span>
              )}
            </dd>
          </dl>
        </div>
        <div
          className={`px-4 py-3 border-t sm:border-t-0 sm:border-l border-slate-200 ${
            ctx.staleNow ? 'opacity-50' : ''
          }`}
        >
          <SumRow label="รวมเงิน" value={t ? money2(t.subtotal) : '—'} />
          <SumRow label="ส่วนลด" value={t ? money2(t.discount) : '—'} />
          <SumRow label="มูลค่าหลังหักส่วนลด" value={t ? money2(t.after_discount) : '—'} strong />
          <SumRow label="ภาษีมูลค่าเพิ่ม 7%" value={t ? money2(t.vat) : '—'} />
          <SumRow label="ยอดเงินสุทธิ" value={t ? `฿${money2(t.grand_total)}` : '—'} big />
          {!t && (
            <p className="text-[10.5px] text-slate-400 text-right mt-1">
              ยอดท้ายใบมาจากผลตรวจ — ยังไม่ได้ตรวจจึงยังไม่มีตัวเลข
            </p>
          )}
        </div>
      </div>

      {/* ── ช่องลงนาม 3 ช่องเหมือนใบจริง ──
          ไม่มีชื่อ/ลายเซ็น = ใบจริงก็จะไม่มี ⇒ ต้องเห็นตั้งแต่ตอนนี้ ไม่ใช่ไปรู้ตอนลูกค้าถาม */}
      <div className="grid grid-cols-1 sm:grid-cols-3 bg-slate-50">
        <SignCell role="ลูกค้า (ผู้มีอำนาจ)" name="ลงนาม / วันที่" />
        <SignCell
          role="พนักงานขาย"
          name={signName(ctx.identity?.salesperson?.name, q ? g.co : null)}
          phone={ctx.identity?.salesperson?.phone}
          sig={ctx.identity?.salesperson?.sig_url}
        />
        <SignCell
          role="ผู้เสนอราคา"
          name={signName(ctx.identity?.issuer.name, q ? g.co : null)}
          phone={ctx.identity?.issuer.phone}
          sig={ctx.identity?.issuer.sig_url}
        />
      </div>
    </div>
  );
};

// ── ปุ่มพรีวิว PDF ในแถบยืนยัน (เจ้าของสั่ง 2026-09-23) ─────────────────────────
//
//  ปุ่มเดียวเสมอ ชื่อ "พรีวิว PDF" · ใบเดียว = กดแล้วเปิดเลย · ใบแยกสองบริษัท = กางเมนูให้เลือก
//  PM / THT (กางขึ้นข้างบน เพราะแถบนี้ติดขอบล่างจอ กางลงจะตกขอบ)
//  ยังไม่ตรวจ = ยังไม่รู้ว่าใบเป็นของบริษัทไหน ⇒ ปุ่มจางพร้อมบอกเหตุผล
//  ปิดเมนูด้วยคลิกนอกกล่อง/Esc — ท่าเดียวกับเมนู "..." ของ SyncPanel.tsx

const PdfPreviewButton: React.FC<{
  groups: DocGroup[];
  busy: 'PM' | 'THT' | null;
  onOpen: (co: 'PM' | 'THT') => void;
}> = ({ groups, busy, onOpen }) => {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const ready = groups.filter((g) => g.quote);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (co: 'PM' | 'THT') => { setOpen(false); onOpen(co); };
  const multi = ready.length > 1;

  return (
    <div className="relative" ref={boxRef}>
      <Button
        variant="neutral"
        tone="soft"
        icon={FileText}
        busy={busy !== null}
        disabled={ready.length === 0}
        title={ready.length === 0 ? 'ต้องตรวจก่อน ระบบจึงรู้ว่าใบนี้เป็นของบริษัทไหน' : undefined}
        aria-haspopup={multi ? 'menu' : undefined}
        aria-expanded={multi ? open : undefined}
        onClick={() => {
          if (ready.length === 1) pick(ready[0].quote!.quote_company);
          else if (multi) setOpen((v) => !v);
        }}
      >
        พรีวิว PDF
      </Button>
      {open && multi && (
        <div
          role="menu"
          className="absolute right-0 bottom-full mb-1.5 z-30 w-36 bg-card border border-slate-200 rounded-lg shadow-lg py-1 animate-fade-in"
        >
          <p className="px-3 pt-1 pb-1.5 text-[10.5px] text-slate-400">เลือกใบที่จะดู</p>
          {ready.map((g) => (
            <button
              key={g.co}
              role="menuitem"
              type="button"
              onClick={() => pick(g.quote!.quote_company)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <FileText className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              {g.co}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── ชิป "ใช้ส่วนลดนี้กับรายการอื่น" (เจ้าของสั่ง 2026-09-17 · เป็นชิปใต้ช่องตั้งแต่ 2026-09-24) ──
//
//  **เป็นข้อเสนอ ไม่ใช่คำถามที่ต้องตอบ** จึงไม่ใช่โมดัล — พิมพ์ต่อ กดที่อื่น ย้ายไปช่องอื่น หรือ Esc
//  ก็หายไปโดยไม่มีอะไรเปลี่ยน · โมดัลที่เด้งทุกครั้งที่กรอกส่วนลดคือโมดัลที่ขวางงานมากกว่าช่วย
//
//  **อยู่ในเซลล์ส่วนลดเอง ไม่ใช่กล่องลอย** (เจ้าของเลือกแบบ C จาก mockup 3 แบบ 2026-09-24) — กล่องลอย
//  เดิมสูง ~131px บังแถวถัดไปทั้งแถว และต้องคอยวางตำแหน่งตามช่องทุกครั้งที่จอขยับ (เคยแวบหายเอง
//  เพราะแถบสถานะเหนือตารางเปลี่ยนความสูงตอนตรวจรายละเอียด) · อยู่ในเซลล์ = ไม่บังอะไรและไม่มีตำแหน่ง
//  ให้คลาด แลกกับแถวนั้นสูงขึ้นชั่วคราวระหว่างที่ชิปโผล่
//
//  ขอบเขตที่มันแตะได้คือ "สินค้าที่แก้ได้" เท่านั้น — ค่าขนส่ง/ค่าบริการรับส่วนลดไม่ได้อยู่แล้ว
//  และบรรทัดที่กฎเติมให้เองไม่ได้อยู่ใน `rows` ตั้งแต่ต้น ⇒ ถูกกันออกโดยโครงสร้าง ไม่ใช่โดยเงื่อนไข
//  คำอธิบายข้อนี้อยู่ใน tooltip ของชิป ไม่ได้โชว์ตลอด เพราะไม่ใช่ทางเลือกที่คนต้องตัดสินใจ

interface BulkOffer {
  rowKey: string;
  co: 'PM' | 'THT';
  d1: number;
  d2: number;
  /** จำนวนบรรทัดที่จะโดน — ไม่นับบรรทัดต้นทางเอง */
  inDoc: number;
  inAll: number;
}

/** ชิปในตาราง สูง 24px ไม่ใช่ `btn-h` — docs/design.md 2.2 "ชิป/ป้ายกดได้ในตาราง 20–28px" */
const CHIP =
  'h-6 px-2 inline-flex items-center gap-1 rounded-full border text-[11px] font-bold whitespace-nowrap transition-colors';
const CHIP_BRAND =
  `${CHIP} border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-fg)] hover:bg-[var(--brand-soft-strong)]`;
const CHIP_PLAIN = `${CHIP} border-slate-300 bg-slate-100 text-slate-500 hover:text-slate-800`;

const BulkDiscountChips: React.FC<{
  offer: BulkOffer;
  multiDoc: boolean;
  onApply: (scope: 'doc' | 'all') => void;
  onDismiss: () => void;
}> = ({ offer, multiDoc, onApply, onDismiss }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /* "ข้างใน" = ทั้งเซลล์ส่วนลด (ช่องกรอก + ชิป) ไม่ใช่แค่ตัวชิป — คลิกกลับเข้าช่องเดิมเพื่อแก้ตัวเลข
       ไม่ควรปิด เพราะพิมพ์ต่อเมื่อไหร่ `offerBulk` ล้างของเก่าแล้วเสนอใหม่ด้วยตัวเลขใหม่อยู่แล้ว */
    const zone = () => ref.current?.parentElement ?? null;
    const outside = (t: EventTarget | null) => !(t instanceof Node && zone()?.contains(t));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    const onPointer = (e: MouseEvent) => { if (outside(e.target)) onDismiss(); };
    // กด Tab ไปช่องอื่น = เลิกสนใจแล้ว เหมือนคลิกที่อื่น (Tab จากช่องส่วนลดมาถึงชิปก่อนพอดี)
    const onFocus = (e: FocusEvent) => { if (outside(e.target)) onDismiss(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('focusin', onFocus);
    };
  }, [onDismiss]);

  const label = offer.d2 > 0 ? `${money(offer.d1)}% , ${money(offer.d2)}%` : `${money(offer.d1)}%`;
  const hint = `ใส่ส่วนลด ${label} ให้สินค้าบรรทัดอื่นด้วย — ไม่รวมค่าขนส่ง ค่าบริการ และบรรทัดที่กฎเติมให้เอง`;
  const doc = offer.inDoc > 0;
  const all = multiDoc && offer.inAll > offer.inDoc;

  return (
    <div ref={ref} role="group" aria-label="ใช้ส่วนลดนี้กับรายการอื่น" title={hint} className="flex flex-wrap justify-end md:justify-center gap-1">
      {doc && !all && (
        <button type="button" onClick={() => onApply('doc')} className={CHIP_BRAND}>
          <ArrowDown className="w-3 h-3 shrink-0" />
          ใช้กับอีก {offer.inDoc} รายการ
        </button>
      )}
      {doc && all && (
        <>
          <button type="button" onClick={() => onApply('doc')} className={CHIP_BRAND}>
            <ArrowDown className="w-3 h-3 shrink-0" />
            ใบนี้ ({offer.inDoc})
          </button>
          <button type="button" onClick={() => onApply('all')} className={CHIP_PLAIN}>
            ทุกใบ ({offer.inAll})
          </button>
        </>
      )}
      {!doc && all && (
        <button type="button" onClick={() => onApply('all')} className={CHIP_BRAND}>
          <ArrowDown className="w-3 h-3 shrink-0" />
          ใช้กับทุกใบ ({offer.inAll})
        </button>
      )}
    </div>
  );
};

// ── หน้าหลัก ─────────────────────────────────────────────────────────────────

export const QuoteRequest: React.FC = () => {
  const { token, user } = useAuth();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [profileReady, setProfileReady] = useState(false);
  const [spUserId, setSpUserId] = useState('');
  // ── "ออกในนาม" เติมเองจากลูกค้า (2026-09-24 · docs/plan-web-quote-auto-salesperson.md) ──
  //  role ที่เลือกเซลส์ได้เริ่มจากช่องว่าง แล้วระบบเติมให้เมื่อรู้ลูกค้า · role salesperson
  //  ออกในนามตัวเองเสมอ ไม่ผ่านส่วนนี้เลย (QuoteIssuerProfile ตั้งค่าให้เอง)
  const canPickAnySp = user?.role !== 'salesperson';
  /** ช่องได้ค่ามาจากไหน — `manual` = คนเลือกเอง (ระบบห้ามเขียนทับ) · อื่น ๆ = ขั้นที่ระบบใช้ · null = ว่าง */
  const [spSource, setSpSource] = useState<SpSource | null>(null);
  const spSourceRef = useRef<SpSource | null>(null);
  useEffect(() => { spSourceRef.current = spSource; }, [spSource]);
  /** เหตุผลที่ระบบเติมให้ไม่ได้ — ขึ้นใต้แถบ "ออกในนาม" */
  const [spNotice, setSpNotice] = useState<string | null>(null);
  /** แก้ใบเดิมแล้วเซลส์ของใบเดิมออกใบไม่ได้ ⇒ รอบถัดไปต้องส่งคนที่เลือกเองไปแทน */
  const [reviseNeedsPick, setReviseNeedsPick] = useState(false);
  const onSpPick = useCallback((userId: string) => {
    setSpUserId(userId);
    setSpSource('manual');
    setSpNotice(null);
  }, []);
  /** เซลส์ที่ระบบได้จากใบเดิมตอนกด "แก้ใบเดิม" — ปุ่ม "ระบบเลือกอัตโนมัติ" คืนค่านี้ (null = ใบเดิมไม่มีคนที่ออกได้) */
  const reviseSpRef = useRef<string | null>(null);
  /** เพิ่มทีละ 1 เพื่อสั่งให้ effect เติมจากลูกค้าถามใหม่ แม้บริษัทจะเป็นรายเดิม */
  const [spAutoNonce, setSpAutoNonce] = useState(0);
  const onReadyChange = useCallback((v: boolean) => setProfileReady(v), []);
  /** ตัวตนที่จะไปขึ้นช่องลงนามของใบ — คอมโพเนนต์แถบบนโหลดมาแล้ว ไม่ยิง API ซ้ำที่นี่ */
  const [identity, setIdentity] = useState<QuoteIssuerIdentity | null>(null);
  const onIdentityChange = useCallback((v: QuoteIssuerIdentity) => setIdentity(v), []);

  // ── ส่วนที่ 1 ──
  const [text, setText] = useState('');
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState('');
  const [systemBusy, setSystemBusy] = useState(false);

  /**
   * กล่อง "เพิ่มผู้ติดต่อใหม่" — `null` = ปิดอยู่ · สตริง = เปิดพร้อมชื่อที่พิมพ์ค้างไว้
   *
   * เก็บเป็น "ชื่อที่พิมพ์ค้าง" ไม่ใช่ boolean คู่กับ state อีกตัว เพราะสองตัวที่ต้องเปลี่ยน
   * พร้อมกันเสมอคือสองตัวที่วันหนึ่งจะไม่ตรงกัน (เปิดกล่องแต่ชื่อเป็นของรอบก่อน)
   */
  const [addContactFor, setAddContactFor] = useState<string | null>(null);
  /** `contact_id` ที่กำลังแก้อยู่ — `null` = ไม่ได้เปิดกล่องแก้ไข */
  const [editContactId, setEditContactId] = useState<number | null>(null);
  /** คนที่กำลังจะลบ — เก็บชื่อมาด้วย เพราะรายชื่อถูกดึงใหม่หลังลบ แล้วชื่อจะหายไปจากที่เดิม */
  const [deleteContact, setDeleteContact] = useState<{ id: number; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── ส่วนที่ 2 ──
  const [webUserId, setWebUserId] = useState('');
  // ประวัติของขั้น propose — ไม่มีผลกับสิ่งที่แสดงบนหน้าจอ ใช้ผูกแถว web_draft กลับไปหาแถว
  // web_propose เท่านั้น (docs/plan-web-quote-logging.md §5)
  const [proposeMsgId, setProposeMsgId] = useState<number | null>(null);
  // `[]` ไม่ใช่ `null` — การ์ดร่างเปิดค้างไว้ตั้งแต่โหลดหน้า แอดมินกรอกเองได้โดยไม่ต้องวางข้อความ
  // ⇒ "ว่าง" กับ "ยังไม่มีฟอร์ม" ไม่ใช่สถานะเดียวกันอีกต่อไป
  const [rows, setRows] = useState<Row[]>([]);
  const [aiMessage, setAiMessage] = useState('');
  const [customerOptions, setCustomerOptions] = useState<CustomerRow[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [custSearching, setCustSearching] = useState(false);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [contactId, setContactId] = useState<number | null>(null);
  /**
   * เลือกผู้ติดต่อให้เองเมื่อบริษัทมีคนเดียว (เจ้าของสั่ง 2026-09-25) — สองค่านี้คุมว่าเมื่อไหร่ห้าม
   * · `contactAuto` = false ตอนเปิดใบเดิม/คำขอที่ตีกลับ — คนของใบต้นทางหายไปแล้วต้องให้คนเลือก
   *   ไม่ใช่สลับเป็นอีกคนเงียบ ๆ
   * · `contactQuery` = ชื่อ/เบอร์ผู้ติดต่อที่สกัดจากข้อความ — มีค่าแล้วต้องถาม server ว่าตรงกับ
   *   คนนั้นไหมก่อน ("ระบุมาแล้วไม่ใช่คนนี้" = ห้ามเลือกให้)
   */
  const [contactAuto, setContactAuto] = useState(true);
  const [contactQuery, setContactQuery] = useState('');
  /**
   * ช่องวางข้อความกางอยู่ไหม — พับเองเมื่อสกัดสำเร็จ เพราะตั้งแต่นั้นงานอยู่ในใบแล้ว
   * เป็น state ของหน้าจอล้วน ๆ ไม่ใช่ "ขั้น" ที่ผ่านไปแล้วผ่านเลย (กางกลับมาได้ตลอด)
   */
  const [pasteOpen, setPasteOpen] = useState(true);

  // ── ผลตรวจก่อนสร้างร่าง ──
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewAt, setPreviewAt] = useState('');
  /** ลายเซ็นของข้อมูลที่ถูกตรวจไปแล้ว — ต่างจากของปัจจุบันเมื่อไหร่ = ผลที่เห็นเก่าแล้ว */
  const [previewSig, setPreviewSig] = useState('');
  const [svcCfg, setSvcCfg] = useState<ServiceCfg | null>(null);
  /** ชื่อ/ราคาที่แก้ทับบรรทัดค่าขนส่งของกฎ — อยู่นอก `rows` เพราะบรรทัดนั้นไม่ใช่แถวของฟอร์ม
   *  (กฎเป็นคนตัดสินว่ามีหรือไม่มี) · ค้างไว้แม้บรรทัดหายไปตอนยอดถึงเกณฑ์ ยอดลดลงอีกก็กลับมาเป็นค่าที่แก้ไว้ */
  const [autoFeeOv, setAutoFeeOv] = useState<AutoFeeOv | null>(null);

  // ── ค่าที่แอดมินตั้งทับของที่ระบบหามาให้ (2026-09-14) ──
  //
  //  ทั้งสองตัวอยู่ในลายเซ็นของพรีวิว ⇒ แก้แล้วหน้าจะตรวจใหม่เอง และตัวเลขที่เห็นคือตัวเลข
  //  ที่จะถูกบันทึก · เก็บเป็น state ของหน้า ไม่ใช่ของ `preview` เพราะ `preview` ถูกเขียนทับ
  //  ทุกครั้งที่ผลตรวจกลับมา ถ้าเก็บไว้ในนั้นค่าที่เพิ่งตั้งจะหายทุกครั้งที่ตรวจเสร็จ
  /** `null` = ใช้เครดิตของลูกค้าตามเดิม */
  const [paymentTerms, setPaymentTerms] = useState<string | null>(null);
  const [paymentTermOpts, setPaymentTermOpts] = useState<string[]>([]);
  /** กำหนดส่งที่ตั้งเอง แยกตามใบ — ใบที่ไม่มีคีย์ = ยังใช้ค่าอัตโนมัติ */
  const [deliveryOv, setDeliveryOv] = useState<
    Partial<Record<'PM' | 'THT', { type: DeliveryTypeKey | null; days: number | null }>>
  >({});

  // ── ยืนยัน / ผลลัพธ์ ──
  /** โมดัลยืนยันอีกชั้น — เปิดเฉพาะตอนที่มีอะไรให้รับทราบ ไม่ใช่เด้งทุกครั้งที่กดออกใบ */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [results, setResults] = useState<{ quotation_no: string; pdf_link: string }[]>([]);
  /**
   * ใบที่ถูก "สร้าง" ไปแล้วแต่ยืนยันไม่ผ่าน — ค้างเป็นร่างอยู่ในระบบจริง ๆ
   * ต้องเก็บไว้และบอกออกไป ไม่งั้นหน้าจอจะพูดว่า "ไม่ได้บันทึกอะไร" ทั้งที่บันทึกไปแล้วครึ่งทาง
   */
  const [strandedIds, setStrandedIds] = useState<string[]>([]);
  /** เหตุผลที่ขอขายต่ำกว่าขั้นต่ำ — เดินทางไปกับคำขอ ผู้อนุมัติอ่านก่อนตัดสิน */
  const [approvalNote, setApprovalNote] = useState('');
  /**
   * คำขอที่เพิ่งส่งไป — มีค่าแล้วแปลว่า **ใบยังไม่ออก** หน้าจอต้องพูดเรื่องรอคน ไม่ใช่เรื่อง PDF
   */
  const [approvalSent, setApprovalSent] = useState<{ request_id: string; count: number } | null>(null);
  /** คำขอเดิมที่ถูกตีกลับแล้วกำลังแก้อยู่ — ส่งไปกับคำขอใหม่เพื่อให้หลังบ้านยกเลิกใบเก่าให้ */
  const [replacesRequestId, setReplacesRequestId] = useState<string | null>(null);

  // ── ส่วนที่ 3 ──
  const [reviseNo, setReviseNo] = useState('');
  const [revising, setRevising] = useState(false);
  const [reviseError, setReviseError] = useState('');
  const [reviseFrom, setReviseFrom] = useState('');

  // อ่าน customerId ล่าสุดจากใน effect ค้นหาได้โดยไม่ต้องยิงค้นใหม่ทุกครั้งที่เปลี่ยนบริษัท
  const customerIdRef = useRef<number | null>(null);
  useEffect(() => { customerIdRef.current = customerId; }, [customerId]);

  const resetAll = () => {
    setText('');
    setRows([]);
    setAiMessage('');
    setCustomerOptions([]);
    setCustomerId(null);
    setCustomerQuery('');
    setContacts([]);
    setContactId(null);
    setContactAuto(true);
    setContactQuery('');
    setPasteOpen(true);
    setResults([]);
    setStrandedIds([]);
    setReviseFrom('');
    setProposeError('');
    setConfirmError('');
    setSystemBusy(false);
    setPreview(null);
    setPreviewError('');
    setPreviewSig('');
    setPreviewAt('');
    setPaymentTerms(null);
    setDeliveryOv({});
    setAutoFeeOv(null);
    setApprovalSent(null);
    setApprovalNote('');
    setReplacesRequestId(null);
    // ใบใหม่ = ช่อง "ออกในนาม" กลับเป็นว่าง (role ที่เลือกได้) — เซลส์ออกใบเองคงตัวเองไว้
    if (canPickAnySp) {
      setSpUserId('');
      setSpSource(null);
      setSpNotice(null);
      setReviseNeedsPick(false);
      reviseSpRef.current = null;
    }
  };

  // ── คำขอที่ถูกตีกลับ → เปิดกลับเข้าฟอร์ม ───────────────────────────────────
  //  หน้า "อนุมัติราคา" เขียนก้อนนี้ลง sessionStorage แล้วเปลี่ยนแท็บมาที่นี่ — ส่งผ่าน
  //  sessionStorage ไม่ใช่ query string เพราะมันเป็นรายการสินค้าทั้งใบ ไม่ใช่ id ตัวเดียว
  //  และมันเป็นของชั่วคราวของแท็บนั้น ไม่ควรติดไปกับลิงก์ที่ใครก๊อปส่งต่อ
  //
  //  **ร่างเดิมยังไม่ถูกแตะตอนนี้** — มันจะถูกทิ้งก็ต่อเมื่อใบใหม่ถูกสร้างสำเร็จแล้ว
  //  (`replaces_request_id`) ไม่งั้นคนที่กดแก้แล้วปิดจอไปจะเหลือมือเปล่า
  //  ทิ้งทั้งแถว ไม่ใช่มาร์ก `cancelled` — "แก้แล้วส่งใหม่" คือการแก้ทับร่างเดิม ไม่ใช่การยกเลิก
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await takeApprovalReload();
      if (cancelled || !data) return;
      setRows(
        (data.items ?? []).map((it) => ({
          key: newKey(),
          productTemplateId: it.product_id ?? null,
          model: it.model,
          name: it.name,
          quantity: String(num(it.quantity)),
          price: String(num(it.price)),
          disc1: num(it.discount_1) ? String(num(it.discount_1)) : '',
          disc2: num(it.discount_2) ? String(num(it.discount_2)) : '',
          remark: String(it.remark ?? ''),
          candidates: [],
          status: 'ok' as RowStatus,
          isService: it.is_manual_service === true,
        })),
      );
      // บริษัทที่เลือกไว้ต้องมีอยู่ในลิสต์ ไม่งั้น dropdown โชว์ "ยังไม่เลือก" ทั้งที่ id ตั้งอยู่แล้ว
      setCustomerOptions(data.customer_id ? [{ id: data.customer_id, display_name: data.company_name ?? '' }] : []);
      setCustomerId(data.customer_id ?? null);
      setContactId(data.contact_id ?? null);
      setContactAuto(false);
      setContactQuery('');
      setPaymentTerms(String(data.payment_terms_override ?? '').trim() || null);
      setAutoFeeOv(data.auto_fee ? { name: data.auto_fee.name, price: String(num(data.auto_fee.price)) } : null);
      setApprovalNote(String(data.note ?? ''));
      setReplacesRequestId(String(data.request_id));
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * อ่าน error ที่ backend ส่งมาเป็นข้อความจริง ไม่ใช่ "HTTP 400" ลอย ๆ
   *
   * 422 ส่ง `violations` มาพร้อมประโยคไทยครบในก้อนเดียวกันอยู่แล้ว (ชุดเดียวกับที่กล่องแดง
   * ของผลตรวจใช้) แต่ `error` ของมันเป็นรหัสดิบ `VALIDATION_ERROR` ⇒ ถ้าอ่านแค่ `error`
   * คนกดจะเห็นคำว่า VALIDATION_ERROR ลอย ๆ โดยไม่รู้ว่าติดกฎข้อไหน (เจ้าของสั่งแก้ 2026-09-18)
   * ⇒ มี violations เมื่อไหร่ให้ใช้ประโยคของมันเสมอ · ไม่มีจึงค่อยตกไปใช้ `error` เหมือนเดิม
   *
   * ขึ้นบรรทัดใหม่ได้เพราะกล่องที่แสดงผลตั้ง `whitespace-pre-wrap` ไว้แล้ว
   */
  const readError = async (res: Response, fallback: string) => {
    const body = await res.json().catch(() => ({}));
    return describeApiError(body, fallback);
  };

  // เติม "ออกในนาม" จากเซลส์ของลูกค้าทุกครั้งที่บริษัทเปลี่ยน — ตรรกะการเลือกอยู่ฝั่ง server ที่เดียว
  // (services/customerSalesOwner.ts: ข้อมูลลูกค้า → ผู้ติดต่ออื่น → ใบสั่งขายล่าสุด → ใบเก่ากว่า)
  //  · คนเลือกเองแล้ว = ไม่เขียนทับ · แก้ใบเดิม = ใช้เซลส์ของใบเดิม ไม่ดูลูกค้า
  //  · หาไม่เจอ = ล้างค่าที่ระบบเคยเติมให้ลูกค้ารายก่อน แล้วบอกเหตุผล **ไม่เดาแทน**
  //  · เรียก API ไม่ผ่าน (ไม่มีสิทธิ์/ล่ม) = เงียบ ปล่อยให้เลือกเอง — ช่องนี้เป็นความสะดวก
  useEffect(() => {
    if (!canPickAnySp || reviseFrom) return;
    let cancelled = false;
    // อ่านค่าสดทุกครั้ง (ไม่ใช่ค่าที่ TS จำกัดชนิดไว้ก่อน await) — คนอาจกดเลือกเองระหว่างรอคำตอบ
    const pickedByHand = () => spSourceRef.current === 'manual';
    (async () => {
      if (pickedByHand()) return;
      if (customerId === null) {
        if (spSourceRef.current !== null) {
          setSpUserId('');
          setSpSource(null);
        }
        setSpNotice(null);
        return;
      }
      try {
        const res = await fetch(`/api/admin/webquote/sales-owner?customer_id=${customerId}`, { headers: authHeaders });
        if (!res.ok || cancelled) return;
        const { owner } = (await res.json()) as { owner: SalesOwner };
        if (cancelled || pickedByHand()) return;
        if (owner?.status === 'resolved') {
          setSpUserId(owner.user_id);
          setSpSource(owner.source);
          setSpNotice(null);
        } else {
          setSpUserId('');
          setSpSource(null);
          setSpNotice(
            owner?.status === 'inactive'
              ? `ไม่มีเซลส์ของลูกค้ารายนี้ที่ออกใบในนามได้${owner.odoo_name ? ` (ใน Odoo: ${owner.odoo_name})` : ''} — เลือกพนักงานขายเองก่อนออกใบ`
              : 'ลูกค้ารายนี้ยังไม่มีเซลส์ในระบบ — เลือกพนักงานขายเองก่อนออกใบ',
          );
        }
      } catch {
        /* เติมให้ไม่ได้ = ให้คนเลือกเอง */
      }
    })();
    return () => { cancelled = true; };
  }, [customerId, reviseFrom, canPickAnySp, authHeaders, spAutoNonce]);

  // "ระบบเลือกอัตโนมัติ" บนสุดของรายการ = ทิ้งค่าที่เลือกเองแล้วกลับไปใช้กติกาเดียวกับตอนเติมเอง
  //  · แก้ใบเดิม = เซลส์ของใบเดิม (จำไว้ตอน revise ไม่ยิง API ซ้ำ)
  //  · ใบใหม่ = ถามเซลส์ของลูกค้าใหม่ผ่าน effect ข้างบน (ยังไม่เลือกลูกค้า = ช่องว่างรอไว้)
  const onSpAuto = useCallback(() => {
    // ตั้ง ref ทันที ไม่รอ render — effect ที่ถูกปลุกด้วย nonce ต้องไม่เห็นค่า 'manual' ค้าง
    spSourceRef.current = null;
    setSpNotice(null);
    if (reviseFrom) {
      const sp = reviseSpRef.current;
      setSpUserId(sp ?? '');
      setSpSource(sp ? 'quotation' : null);
      if (!sp) setSpNotice('เซลส์ของใบเดิมออกใบในนามไม่ได้แล้ว — เลือกพนักงานขายเองก่อนออกใบ');
      return;
    }
    setSpUserId('');
    setSpSource(null);
    setSpAutoNonce((n) => n + 1);
  }, [reviseFrom]);

  // โหลดผู้ติดต่อทุกครั้งที่บริษัทเปลี่ยน — endpoint เดิมของ LIFF ใช้ได้ตรง ๆ (§0.3)
  useEffect(() => {
    if (customerId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/customer/${customerId}/contacts`);
        const data = res.ok ? await res.json() : [];
        if (cancelled) return;
        const list: ContactRow[] = Array.isArray(data) ? data : [];
        setContacts(list);
        // ผู้ติดต่อที่ระบบเดาไว้ให้อาจไม่มีในลิสต์ของบริษัทที่เลือก — findContactCandidates ค้นข้าม
        // ทุกรหัสสาขาของนิติบุคคลเดียวกัน คนที่ได้มาจึงอาจอยู่ใต้อีก company_id
        // ปล่อยค้างไว้ = ช่องผู้ติดต่อว่างแต่ปุ่ม "ยืนยัน" กดได้ แล้วใบไปโผล่ผิดผู้ติดต่อ
        setContactId((cur) => (cur !== null && list.some((c) => c.id === cur) ? cur : null));

        // บริษัทมีผู้ติดต่อคนเดียว = เลือกให้เลย (เจ้าของสั่ง 2026-09-25 · 75% ของบริษัททั้งหมด
        // วัดวันเดียวกัน) · ข้อความระบุชื่อมา ⇒ ต้องตรงกับคนนั้นก่อน ตัดสินด้วยตัวจับคู่ของ LINE
        // ที่ server ไม่ใช่เทียบสตริงบนจอ · ไม่ทับคนที่เลือกไว้แล้ว (`cur ??`)
        if (list.length !== 1 || !contactAuto) return;
        const only = list[0].id;
        if (contactQuery) {
          // ถามไม่สำเร็จ = ไม่เลือกให้ (ปลอดภัยกว่าเดา) · ห้ามปล่อยให้ตกไป catch ด้านล่าง
          // ซึ่งล้างรายชื่อผู้ติดต่อทิ้งทั้งที่โหลดมาได้แล้ว
          const qs = new URLSearchParams({ customer_id: String(customerId), contact_id: String(only), q: contactQuery });
          const m = await fetch(`/api/admin/webquote/contact-match?${qs.toString()}`, { headers: authHeaders })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
          if (cancelled || m?.match !== true) return;
        }
        setContactId((cur) => cur ?? only);
      } catch {
        if (!cancelled) setContacts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [customerId, contactAuto, contactQuery, authHeaders]);

  /**
   * หัวใบ (รหัสลูกค้า · เลขผู้เสียภาษี · ที่อยู่ · เครดิตของลูกค้า) ต้องขึ้น **ตั้งแต่เลือก
   * ผู้ติดต่อเสร็จ** ไม่ใช่รอจนมีสินค้าในใบ — ก้อนนี้คือก้อนเต็ม (มีผู้ติดต่อ) · ก่อนเลือกผู้ติดต่อ
   * หัวใบอ่านก้อนระดับบริษัท `coParty` ข้างล่างแทน
   *
   * `/preview` ตอบก้อนนี้แทนไม่ได้เพราะมันบังคับว่าต้องมี items (ทั้งฟังก์ชันคือการตรวจกฎของ
   * รายการ) ⇒ ก่อนหน้านี้ช่องพวกนี้ขึ้น "—" จนกว่าจะพิมพ์สินค้าเข้าไป ทั้งที่ข้อมูลพร้อมอยู่แล้ว
   * (เจ้าของรายงาน 2026-09-21)
   *
   * ⚠️ `/party` คืนก้อน `customer` **รูปเดียวกับ `/preview` เป๊ะ** เพราะฝั่ง server ประกอบจาก
   *    ฟังก์ชันตัวเดียวกัน ⇒ พอพรีวิวมาถึง ตัวเลขไม่กระพริบและไม่มีทางขัดกันเอง
   * ⚠️ ค่าเครดิตที่ตั้งทับอยู่ในลิสต์ของ effect ด้วย — `has_credit_terms` ของก้อนนี้คิดจาก
   *    "ค่าที่ใบจะใช้จริง" ไม่ใช่ของลูกค้าเสมอไป (กติกาเดียวกับที่ /preview ใช้)
   */
  /**
   * เก็บคู่กับ "คีย์ของคนที่ค่านี้เป็นของเขา" ไม่ใช่ก้อนเปล่า ๆ — แล้วอ่านผ่าน `partyBlock`
   * ซึ่งทิ้งของที่คีย์ไม่ตรงทันที ⇒ ค่าของผู้ติดต่อคนก่อนไม่มีทางค้างบนจอแม้แต่เฟรมเดียว
   * โดยไม่ต้องล้าง state ในตัว effect (ซึ่งกฎ react-hooks/set-state-in-effect ปฏิเสธ)
   */
  const [party, setParty] = useState<{ key: string; block: PreviewResult['customer'] } | null>(null);
  const partyKey = customerId !== null && contactId !== null ? `${customerId}:${contactId}` : '';
  useEffect(() => {
    if (customerId === null || contactId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({
          customer_id: String(customerId),
          contact_id: String(contactId),
        });
        if (paymentTerms !== null) qs.set('payment_terms_override', paymentTerms);
        const res = await fetch(`/api/admin/webquote/party?${qs.toString()}`, { headers: authHeaders });
        const data = res.ok ? await res.json() : null;
        if (!cancelled && data?.customer) setParty({ key: `${customerId}:${contactId}`, block: data.customer });
      } catch {
        // อ่านไม่ได้ = หัวใบคงเป็น "—" เหมือนเดิม · ของเก่าไม่ค้างอยู่แล้วเพราะคีย์ไม่ตรง
      }
    })();
    return () => { cancelled = true; };
  }, [customerId, contactId, paymentTerms, authHeaders]);

  /**
   * ก้อนระดับบริษัท — หัวใบต้องขึ้น **ตั้งแต่เจอบริษัท ไม่ต้องรอผู้ติดต่อ** (เจ้าของสั่ง 2026-09-25)
   * รหัสลูกค้า · เลขผู้เสียภาษี · เครดิต ไม่ขึ้นกับผู้ติดต่อ ส่วนโทร/อีเมลเป็นของบริษัท และที่อยู่
   * ขึ้นเฉพาะเมื่อผู้ติดต่อทุกคนใช้ที่เดียวกัน (server ตัดสิน) · ยิงเฉพาะตอนยังไม่มีผู้ติดต่อ แต่
   * อ่านได้ตลอดที่บริษัทยังเป็นรายเดิม ⇒ ตอนเพิ่งเลือกผู้ติดต่อ หัวใบไม่ว่างวูบระหว่างรอก้อนเต็ม
   */
  const [coParty, setCoParty] = useState<{ key: number; block: PartyView } | null>(null);
  useEffect(() => {
    if (customerId === null || contactId !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ customer_id: String(customerId) });
        if (paymentTerms !== null) qs.set('payment_terms_override', paymentTerms);
        const res = await fetch(`/api/admin/webquote/party?${qs.toString()}`, { headers: authHeaders });
        const data = res.ok ? await res.json() : null;
        if (!cancelled && data?.customer) setCoParty({ key: customerId, block: data.customer });
      } catch {
        // อ่านไม่ได้ = หัวใบคงเป็น "—" จนกว่าจะเลือกผู้ติดต่อ (ก้อนเต็มยิงแยกอีกเส้น)
      }
    })();
    return () => { cancelled = true; };
  }, [customerId, contactId, paymentTerms, authHeaders]);

  /** ก้อนของ "คนที่เลือกอยู่ตอนนี้" เท่านั้น — คีย์ไม่ตรง = ของรอบก่อน ทิ้ง · ยังไม่มี = ของบริษัท */
  const partyBlock: PartyView | null =
    (party && party.key === partyKey ? party.block : null) ??
    (coParty && coParty.key === customerId ? coParty.block : null);

  // ค้นบริษัทเพิ่ม — หน่วง 300ms เท่ากับช่องค้นสินค้า ไม่งั้นยิงคิวรีทุกตัวอักษรที่พิมพ์
  useEffect(() => {
    const q = customerQuery.trim();
    if (!q) return;
    const timer = setTimeout(async () => {
      // ตั้งธงในตัว timer ไม่ใช่ในตัว effect — กฎ react-hooks/set-state-in-effect ปฏิเสธอย่างหลัง
      // และผลที่ได้ดีกว่าด้วย: สปินเนอร์ขึ้นตอนยิงจริง ไม่ใช่กะพริบทุกตัวอักษรที่พิมพ์
      setCustSearching(true);
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`);
        const data = res.ok ? await res.json() : [];
        if (!Array.isArray(data)) return;
        setCustomerOptions((prev) => {
          // บริษัทที่เลือกไว้ต้องอยู่ในลิสต์เสมอ ไม่งั้น <select> แสดงว่างทั้งที่ customerId ยังตั้งอยู่
          // (ผู้ใช้เห็น "ยังไม่เลือก" แต่ปุ่มยืนยันกดได้ = ออกใบให้บริษัทที่มองไม่เห็นบนจอ)
          const keep = prev.find((c) => c.id === customerIdRef.current);
          return keep && !data.some((c: CustomerRow) => c.id === keep.id) ? [keep, ...data] : data;
        });
      } catch {
        /* ค้นไม่ได้ = คงรายการเดิมไว้ ไม่ล้างของที่ผู้ใช้กำลังดูอยู่ */
      } finally {
        setCustSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [customerQuery]);

  // รูปแบบที่ ComboBox กิน — id เป็นสตริงเพราะโครงกลางเทียบ id ด้วย === ไม่ใช่ ==
  const customerOpts = useMemo<CustomerOpt[]>(
    () => customerOptions.map((c) => ({ id: String(c.id), name: c.display_name, row: c })),
    [customerOptions],
  );
  const customerOpt = customerOpts.find((o) => o.id === String(customerId)) ?? null;
  const contactOpts = useMemo(
    () => contacts.map((c) => ({ id: String(c.id), name: c.name, phone: c.phone ?? '' })),
    [contacts],
  );
  const contactOpt = contactOpts.find((o) => o.id === String(contactId)) ?? null;

  const openAddContact = useCallback((prefill: string) => setAddContactFor(prefill), []);

  /**
   * เพิ่มผู้ติดต่อสำเร็จ (หรือกด "ใช้คนเดิม" ตอนชื่อซ้ำ) — เจ้าของเคาะ 2026-09-21 ว่า
   * **ให้เลือกคนนั้นในใบทันที** เพราะคนกดเพิ่มเพราะกำลังจะออกใบให้เขาอยู่แล้ว
   *
   * ⚠️ ดึงรายชื่อใหม่ทั้งชุดแทนการต่อแถวเข้าไปเอง — ทางลัดนั้นใช้ไม่ได้กับปุ่ม "ใช้คนเดิม"
   *    ซึ่งคืน `contact_id` ของคนที่อาจเป็นของ Odoo และอาจยังไม่อยู่ในรายการรอบนี้
   *    (server จับคู่ชื่อแบบ btrim ข้ามทั้งบริษัท) ⇒ ยิงเส้นเดิมของ LIFF ซ้ำหนึ่งครั้ง จบทุกเคส
   */
  const onContactAdded = useCallback(
    async (newId: number) => {
      setAddContactFor(null);
      try {
        const res = await fetch(`/api/customer/${customerId}/contacts`);
        const data = res.ok ? await res.json() : [];
        if (Array.isArray(data)) setContacts(data as ContactRow[]);
      } catch {
        /* ดึงรายชื่อใหม่ไม่ได้ = ยังเลือกคนที่เพิ่งเพิ่มได้อยู่ดี (id ถูกต้องแล้ว) */
      }
      setContactId(newId);
    },
    [customerId],
  );

  /** ดึงรายชื่อผู้ติดต่อของบริษัทที่เลือกอยู่ใหม่ — ใช้ร่วมกันหลังแก้ไขและหลังลบ */
  const reloadContacts = useCallback(async () => {
    try {
      const res = await fetch(`/api/customer/${customerId}/contacts`);
      const data = res.ok ? await res.json() : [];
      if (Array.isArray(data)) setContacts(data as ContactRow[]);
    } catch {
      /* ดึงใหม่ไม่ได้ = ช่องยังโชว์ค่าเดิมไปก่อน ซึ่งไม่กระทบใบที่จะออก (ชื่อบนใบมาจาก server) */
    }
  }, [customerId]);

  /** แก้ไขสำเร็จ — ชื่อ/เบอร์ในช่องต้องเปลี่ยนตาม และคนที่เลือกไว้ต้องยังเป็นคนเดิม */
  const onContactSaved = useCallback(
    async (savedId: number) => {
      setEditContactId(null);
      await reloadContacts();
      setContactId(savedId);
    },
    [reloadContacts],
  );

  /**
   * ลบจริง — ด่านทั้งสองข้อ (เข้า Odoo แล้ว / มีใบอ้างอยู่) อยู่ฝั่ง server ที่เดียว
   * ตรงนี้แค่เอาคำตอบของมันมาแสดง แล้วปล่อยช่องผู้ติดต่อให้ว่างถ้าลบคนที่เลือกอยู่
   */
  const confirmDeleteContact = useCallback(async () => {
    if (!deleteContact) return;
    const gone = deleteContact.id;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/webquote/contacts/${gone}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (!res.ok) {
        setDeleteError(await readError(res, 'ลบผู้ติดต่อไม่สำเร็จ'));
        return;
      }
      setDeleteContact(null);
      setContactId((cur) => (cur === gone ? null : cur));
      await reloadContacts();
    } catch {
      setDeleteError('ติดต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่อีกครั้ง');
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteContact, authHeaders, reloadContacts]);

  // ── ส่วนที่ 1: วางข้อความ → ร่าง ──
  const propose = async () => {
    if (!text.trim()) return;
    setProposing(true);
    setProposeError('');
    setSystemBusy(false);
    setConfirmError('');
    try {
      const res = await fetch('/api/admin/webquote/propose', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        // ส่งเซลส์ไปเฉพาะคนที่ "เลือกเอง" (หรือเซลส์ออกใบเอง) — ค่าที่ระบบเติมจากลูกค้ารายก่อนต้องไม่ติด
        // ไปถ่วงการค้นหาลูกค้าของข้อความใหม่ (findCustomerCandidates ให้น้ำหนักลูกค้าของเซลส์คนนั้น)
        body: JSON.stringify({
          sp_user_id: !canPickAnySp || spSource === 'manual' ? spUserId : undefined,
          text,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, 'สร้างร่างไม่สำเร็จ'));
      const data: ProposeResult = await res.json();

      setWebUserId(data.web_user_id);
      setProposeMsgId(data.propose_msg_id ?? null);
      setResults([]);
      setStrandedIds([]);
      setReviseFrom('');

      // สองเคสล่างนี้ไม่แตะ rows โดยตั้งใจ — ฟอร์มอาจมีของที่แอดมินกรอกเองอยู่แล้ว
      // การล้างทิ้งเพราะ "สกัดข้อความไม่สำเร็จ" คือการลบงานที่ไม่เกี่ยวกับข้อความนั้นเลย
      if (data.extraction_failed) {
        // ไม่ล้างข้อความที่พิมพ์ไว้ — ผู้ใช้ต้องกดลองใหม่ได้ทันทีโดยไม่ต้องวางใหม่
        setSystemBusy(true);
        return;
      }
      if (!data.slots || data.slots.length === 0) {
        setAiMessage(data.reply_message || 'ระบบอ่านข้อความนี้เป็นคำสั่งขอใบเสนอราคาไม่ได้');
        return;
      }

      setAiMessage('');
      setRows(rowsFromSlots(data.slots, data.quote_data));
      // สกัดสำเร็จ = งานย้ายไปอยู่ในใบแล้ว ⇒ พับช่องข้อความเก็บ (กางกลับมาได้ตลอด)
      setPasteOpen(false);

      const custs = data.customer_candidates.map((c) => c.item);
      // ชื่อบริษัทซ้ำกันได้หลายรหัส — ตัดซ้ำด้วย id ไม่ใช่ชื่อ
      const seen = new Set<number>();
      const uniq = custs.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
      setCustomerOptions(uniq);
      // ระบบชั่งคะแนนแล้วชี้ตัวได้ = เลือกให้เลย · ชี้ไม่ได้ = ปล่อยว่างแล้วไฮไลต์ว่าต้องเคาะ (ขั้น 9′)
      // auto_customer_id มาจากกฎเดียวกับที่ LINE ใช้ (decideCustomerSelection) ไม่ใช่การนับจำนวน
      // เช็คว่ามีอยู่ใน uniq จริงก่อนใช้ — กัน dropdown ถือค่าที่ไม่มี option รองรับ
      const autoId =
        data.auto_customer_id != null && uniq.some((c) => c.id === data.auto_customer_id)
          ? data.auto_customer_id
          : null;
      setCustomerId(autoId);
      setContactId(autoId !== null && data.contact_candidates.length === 1 ? data.contact_candidates[0].item.id : null);
      setContactAuto(true);
      setContactQuery(String(data.quote_data?.contact_query ?? '').trim());
      setCustomerQuery('');
      // ร่างชุดใหม่จากข้อความใหม่ = ลูกค้าคนใหม่ ⇒ ค่าที่ตั้งทับของชุดก่อนต้องไม่ติดมาด้วย
      setPaymentTerms(null);
      setDeliveryOv({});
    } catch (e) {
      setProposeError(e instanceof Error ? e.message : 'สร้างร่างไม่สำเร็จ');
    } finally {
      setProposing(false);
    }
  };

  // ── ส่วนที่ 2: ตารางสินค้า ──
  const patchRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => (rs ? rs.map((r) => (r.key === key ? { ...r, ...patch } : r)) : rs));

  const pickCandidate = (key: string, c: Candidate) =>
    patchRow(key, {
      productTemplateId: c.product_template_id,
      model: c.model,
      name: c.name,
      price: String(num(c.sales_price)),
      candidates: [],
      status: 'ok',
    });

  const addRow = () =>
    setRows((rs) => [
      ...(rs ?? []),
      { key: newKey(), productTemplateId: null, model: '', name: '', quantity: '1', price: '', disc1: '', disc2: '', remark: '', candidates: [], status: 'notfound' },
    ]);

  const removeRow = (key: string) => setRows((rs) => (rs ? rs.filter((r) => r.key !== key) : rs));

  // แถบเพิ่มสินค้าใต้ตาราง — เลือกแล้วได้แถวที่เคาะเสร็จเลย ไม่ต้องไปค้นซ้ำในแถว
  const addedTimer = useRef<number | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  useEffect(() => () => { if (addedTimer.current) window.clearTimeout(addedTimer.current); }, []);

  const addProductRow = (h: SearchHit) => {
    setRows((rs) => [
      ...(rs ?? []),
      {
        key: newKey(),
        productTemplateId: h.product_id,
        model: h.model,
        name: h.name,
        quantity: '1',
        price: String(num(h.price)),
        disc1: '',
        disc2: '',
        remark: '',
        candidates: [],
        status: 'ok',
      },
    ]);
    setJustAdded(h.model);
    if (addedTimer.current) window.clearTimeout(addedTimer.current);
    addedTimer.current = window.setTimeout(() => setJustAdded(null), 2500);
  };

  // ── ตรวจรายละเอียดก่อนสร้างร่าง ─────────────────────────────────────────────
  //  ฟอร์มนี้เป็นที่เดียวที่ทั้ง "ตรวจ" และ "แก้" ⇒ ผลตรวจต้องตามการแก้ให้ทัน แต่ต้องไม่ยิงทุก
  //  ตัวอักษร · หน่วง 700ms หลังหยุดพิมพ์ แล้วจำลายเซ็นของสิ่งที่ตรวจไว้ เพื่อบอกได้ว่า
  //  สิ่งที่เห็นตรงกับฟอร์ม ณ ตอนนี้หรือเปล่า (ไม่ใช่แค่ "เคยตรวจแล้ว")
  const itemsPayload = useMemo(
    () =>
      rows.map((r): ItemPayload => ({
        product_template_id: r.productTemplateId,
        model: r.model,
        quantity: num(r.quantity) || 1,
        price: num(r.price) || null,
        discount_1: num(r.disc1) || 0,
        discount_2: num(r.disc2) || 0,
        remark: r.remark || '',
        // ชื่อส่งไปเฉพาะบรรทัดค่าบริการ — สินค้าจริงเอาชื่อจาก DB เสมอ (กติกาของ resolveItems)
        ...(r.isService ? { name: r.name } : {}),
      })).concat(
        // ค่าที่แก้ทับค่าขนส่งของกฎ — ส่งเป็นบรรทัดค่าบริการที่ติดธง is_auto_fee ⇒ server ยังให้กฎ
        // ตัดสินว่าบรรทัดนี้อยู่ไหม แค่ใช้ชื่อ/ราคานี้แทน · มีบรรทัดที่คนเพิ่มเองอยู่แล้ว = ไม่ส่ง
        // (ค่าบริการมีได้บรรทัดเดียว และกฎไม่เติมซ้อนบรรทัดที่คนเพิ่ม)
        autoFeeOv && svcCfg && !rows.some((r) => r.isService)
          ? [{
              product_template_id: svcCfg.product_id,
              model: svcCfg.model,
              quantity: 1,
              price: num(autoFeeOv.price) || null,
              discount_1: 0,
              discount_2: 0,
              remark: '',
              name: autoFeeOv.name,
              is_auto_fee: true,
            }]
          : [],
      ),
    [rows, autoFeeOv, svcCfg],
  );

  /** กำหนดส่งที่ตั้งเอง ในรูปที่ทั้ง /preview และ /drafts รับ — ใบที่ไม่ได้ตั้งไม่ต้องส่งไป */
  const deliveryPayload = useMemo(
    () =>
      (['PM', 'THT'] as const)
        .filter((co) => deliveryOv[co])
        .map((co) => ({
          quote_company: co,
          delivery_type_override: deliveryOv[co]?.type ?? null,
          delivery_days_override: deliveryOv[co]?.days ?? null,
        })),
    [deliveryOv],
  );

  const unresolved = rows.filter((r) => r.status !== 'ok').length;
  // ค่าที่ตั้งทับอยู่ในลายเซ็นด้วย — ไม่งั้นแก้กำหนดส่ง/เครดิตแล้วหน้าจะบอกว่า "ตรวจแล้ว"
  // ทั้งที่ผลที่เห็นคิดจากค่าชุดก่อน (และกฎค่าบริการขึ้นกับเครดิตโดยตรง)
  const sig = useMemo(
    () => JSON.stringify([customerId, contactId, itemsPayload, paymentTerms, deliveryPayload]),
    [customerId, contactId, itemsPayload, paymentTerms, deliveryPayload],
  );
  const canPreview =
    rows.length > 0 && unresolved === 0 && customerId !== null && contactId !== null;
  /** ฟอร์มเปล่ายังไม่ใช่ฟอร์มที่กรอกผิด — ป้ายสีเหลืองจึงขึ้นต่อเมื่อมีของจะเสนอแล้วเท่านั้น */
  const mustPick = rows.length > 0;
  const staleNow = !!preview && sig !== previewSig;

  const runPreview = useCallback(async () => {
    if (!canPreview) return;
    const mySig = sig;
    setPreviewing(true);
    setPreviewError('');
    try {
      const res = await fetch('/api/admin/webquote/preview', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          contact_id: contactId,
          items: itemsPayload,
          payment_terms_override: paymentTerms,
          delivery: deliveryPayload,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(String(body?.error || 'ตรวจรายละเอียดไม่สำเร็จ'));
      }
      const data: PreviewResult = await res.json();
      setPreview(data);
      setPreviewSig(mySig);
      setPreviewAt(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }));
      // จำใบของแต่ละแถวไว้ ไม่งั้นกลุ่มจะกระโดดไปมาระหว่างที่ผลตรวจรอบถัดไปยังไม่กลับมา
      setRows((rs) =>
        rs
          ? rs.map((r) => {
              const co = data.quotes.find((q) => q.items.some((it) => it.model === r.model))?.quote_company;
              return co ? { ...r, company: co } : r;
            })
          : rs,
      );
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'ตรวจรายละเอียดไม่สำเร็จ');
    } finally {
      setPreviewing(false);
    }
  }, [canPreview, sig, itemsPayload, customerId, contactId, authHeaders, paymentTerms, deliveryPayload]);

  useEffect(() => {
    if (!canPreview || sig === previewSig) return;
    const timer = setTimeout(() => { void runPreview(); }, 700);
    return () => clearTimeout(timer);
  }, [canPreview, sig, previewSig, runPreview]);

  // ค่าตั้งต้นของบรรทัดค่าบริการ — endpoint เดียวกับที่หน้า LIFF ใช้ (ไม่ต้องมีสิทธิ์แอดมิน)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/shipping-fee/config');
        if (!res.ok) return;
        const d = await res.json();
        if (cancelled || !d?.product_id) return;
        setSvcCfg({
          product_id: Number(d.product_id),
          model: String(d.product_model ?? ''),
          internal_reference: String(d.internal_reference ?? ''),
          odoo_name: String(d.product_name ?? ''),
          default_item_name: String(d.default_item_name ?? ''),
          // ค่าจริงอยู่ที่ server ที่เดียว (MANUAL_SERVICE_*) · ไม่มีช่องนี้ = ถอยไปพฤติกรรมเดิม
          manual_item_name: String(d.manual_item_name ?? d.default_item_name ?? ''),
          name_presets: Array.isArray(d.manual_name_presets) ? d.manual_name_presets.map(String) : [],
          default_price: num(d.fee_price),
        });
      } catch {
        /* อ่านไม่ได้ = ปุ่มเพิ่มค่าบริการปิดไว้ พร้อมบอกเหตุผลบนหน้าจอ */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ตัวเลือกของช่อง "เครดิต" — เอาค่าที่มีจริงในฐานมาเรียงตามความถี่ ไม่ใช่รายการที่เขียนค้างไว้
  // ในโค้ด (เครดิตเป็นข้อมูลที่ sync มาจาก Odoo · ฝังไว้เมื่อไหร่ก็ล้าสมัยเงียบ ๆ เมื่อนั้น)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/webquote/payment-terms', { headers: authHeaders });
        if (!res.ok) return;
        const d = await res.json();
        if (cancelled || !Array.isArray(d?.terms)) return;
        setPaymentTermOpts(d.terms.map((t: { value: string }) => String(t.value)));
      } catch {
        /* อ่านไม่ได้ = เหลือเฉพาะช่องพิมพ์เอง ซึ่งยังออกใบได้ครบ */
      }
    })();
    return () => { cancelled = true; };
  }, [authHeaders]);

  /** ค่าบริการมีได้บรรทัดเดียวต่อการเสนอราคา — ทั้งที่แอดมินเพิ่มเองและที่กฎเติมให้ */
  const serviceRow = rows.find((r) => r.isService) ?? null;
  const autoFeeShown = preview?.service_line.auto_applied === true;

  const addServiceRow = () => {
    if (!svcCfg || serviceRow || autoFeeShown) return;
    setRows((rs) => [
      ...(rs ?? []),
      {
        key: newKey(),
        productTemplateId: svcCfg.product_id,
        model: svcCfg.model,
        name: svcCfg.manual_item_name,
        quantity: '1',
        price: String(svcCfg.default_price),
        disc1: '',
        disc2: '',
        remark: '',
        candidates: [],
        status: 'ok' as RowStatus,
        isService: true,
        // กฎวางบรรทัดนี้ไว้ในใบ PM เสมอ (applyShippingFeeToQuoteGroup) — แสดงให้ตรงกันตั้งแต่แรก
        company: 'PM' as const,
      },
    ]);
  };

  // ── จับคู่แถวในฟอร์มกับผลตรวจ แล้วแตกเป็นกลุ่มตามใบที่จะออกจริง ──────────────
  //  จับคู่ด้วยรหัสรุ่น (ตัวแรกที่ยังไม่ถูกจอง) เพราะ server เรียงใหม่และเติมสินค้าพ่วงเข้ามา
  //  รายการที่ไม่มีแถวรองรับ = ของที่ระบบเติมให้เอง (สินค้าพ่วง · ค่าขนส่งอัตโนมัติ)
  const matched = useMemo(() => {
    const byRow = new Map<string, PreviewItem>();
    const coByRow = new Map<string, 'PM' | 'THT'>();
    const extras: { co: 'PM' | 'THT'; item: PreviewItem }[] = [];
    if (!preview) return { byRow, coByRow, extras };
    const used = new Set<PreviewItem>();
    for (const r of rows) {
      for (const q of preview.quotes) {
        const hit = q.items.find((it) => !used.has(it) && it.model === r.model);
        if (hit) {
          used.add(hit);
          byRow.set(r.key, hit);
          coByRow.set(r.key, q.quote_company);
          break;
        }
      }
    }
    for (const q of preview.quotes) {
      for (const it of q.items) if (!used.has(it)) extras.push({ co: q.quote_company, item: it });
    }
    return { byRow, coByRow, extras };
  }, [preview, rows]);

  /**
   * แตกแถวในหน้าจอเป็น "ใบที่จะออกจริง" — และ**คืนอย่างน้อยหนึ่งใบเสมอ** (2026-09-17)
   * เพราะตั้งแต่ยุบสองขั้นเป็นขั้นเดียว เอกสารคือฟอร์ม ⇒ ใบเปล่าคือที่ที่คนเริ่มพิมพ์
   * ไม่ใช่สิ่งที่ต้องซ่อนจนกว่าจะมีของ (ใบเปล่าบอกเองในตารางว่ายังไม่มีรายการ)
   */
  const groups = useMemo<DocGroup[]>(() => {
    const all = rows;
    // ก่อนตรวจครั้งแรกยังไม่รู้ว่าแถวไหนไปใบไหน — resolveQuoteCompany อยู่ฝั่ง server เท่านั้น
    const pending: DocGroup[] = [{
      co: 'PM',
      label: 'รายการทั้งหมด',
      rows: all,
      extras: [],
      quote: undefined,
    }];
    if (!preview) return pending;
    const out: DocGroup[] = [];
    for (const co of ['PM', 'THT'] as const) {
      const rs = all.filter((r) => (matched.coByRow.get(r.key) ?? r.company ?? 'PM') === co);
      const ex = matched.extras.filter((e) => e.co === co).map((e) => e.item);
      if (rs.length === 0 && ex.length === 0) continue;
      const quote = preview.quotes.find((q) => q.quote_company === co);
      out.push({
        co,
        label: quote?.company_label ?? (co === 'PM' ? 'Primus (PM)' : 'Themtech (THT)'),
        rows: rs,
        extras: ex,
        quote,
      });
    }
    return out.length > 0 ? out : pending;
  }, [preview, rows, matched]);

  /**
   * ข้อที่ต้องให้ผู้อนุมัติตัดสิน — **แยกออกจาก `blockers` ตั้งแต่ต้นทาง** (2026-09-15)
   * เพราะสองกองนี้จบคนละแบบ: กองนี้ส่งคำขอแล้วรอคน · อีกกองติ๊กรับทราบแล้วออกใบได้เลย
   */
  const approvalRequired = staleNow ? [] : (preview?.approval_required ?? []);
  const needsApproval = approvalRequired.length > 0;
  /** ข้อที่ยัง "ติ๊กรับทราบเองได้" เท่านั้น — server ตัดข้อที่ต้องอนุมัติออกให้แล้วใน override_keys */
  const blockers = staleNow
    ? []
    : (preview?.violations ?? []).filter((v) => !approvalRequired.some((a) => a.type === v.type && a.model === v.model));
  /**
   * เหตุที่ใบชุดนี้จะถูกกันออกจากไฟล์ export ปกติ — **คนละแกนกับ `blockers` โดยสิ้นเชิง**
   * ใบที่ติดกฎยังอยู่ในไฟล์ปกติ (ข้อมูลตรงฐาน Odoo) ส่วนใบในรายการนี้คือใบที่ค่าในไฟล์ไม่มีในฐาน
   * ⇒ ห้ามเอาสองอันนี้มารวมนับเป็นตัวเลขเดียว ใบเดียวติดได้ทั้งคู่
   */
  const manualReasons = staleNow ? [] : (preview?.odoo_manual_reasons ?? []);

  /**
   * ป้ายใต้ชื่อรายการ — ตัวเดียวใช้ทั้งตารางในฟอร์มและตารางใบร่าง ไม่งั้นสองจอจะอธิบาย
   * บรรทัดเดียวกันคนละแบบ · `systemAdded` = บรรทัดที่กฎเติมให้เอง ไม่ใช่ของที่คนพิมพ์
   */
  const itemTagsOf = (it: PreviewItem, systemAdded: boolean, withWarranty = false): RowTag[] => {
    // เช็คก่อน is_shipping_fee เสมอ — ค่าบริการที่คนใส่ใช้สินค้าระบบตัวเดียวกับค่าขนส่งของกฎ
    if (it.is_manual_service) {
      return [{ tone: 'info', kind: 'wrench', text: 'ค่าบริการของใบนี้ · ตั้งชื่อและราคาได้ — มีได้บรรทัดเดียว' }];
    }
    if (it.is_shipping_fee) {
      return [{ tone: 'info', kind: 'truck', text: 'ระบบเติมให้เอง — ถอดออกเองเมื่อยอดถึงเกณฑ์' }];
    }
    const tags: RowTag[] = it.violations.map((v) => ({
      tone: 'bad' as TagTone,
      kind: (v.type === 'BLOCKED' ? 'ban' : 'alert') as TagKind,
      text: shortViolation(v),
    }));
    if (systemAdded) {
      tags.push({
        tone: it.linked_to_model ? 'link' : 'info',
        kind: 'link',
        text: it.linked_to_model ? `สินค้าพ่วงของ ${it.linked_to_model} — ระบบเพิ่มให้เอง` : 'ระบบเพิ่มให้เอง',
      });
    } else if (it.linked_to_model) {
      tags.push({ tone: 'link', kind: 'link', text: `พ่วงกับ ${it.linked_to_model}` });
    }
    tags.push(
      it.stock >= it.quantity
        ? { tone: 'ok', kind: 'check', text: `พร้อมส่ง คงเหลือ ${money(it.stock)}` }
        : { tone: 'warn', kind: 'alert', text: `ของไม่พอ คงเหลือ ${money(it.stock)}` },
    );
    // รับประกันเป็นข้อความที่จะไปโผล่บนใบจริง ⇒ ต้องอ่านได้ก่อนกดยืนยัน แต่ในฟอร์มไม่ต้องรก
    if (withWarranty && it.warranty_display) {
      tags.push({ tone: 'info', kind: 'shield', text: `รับประกัน ${it.warranty_display}` });
    }
    return tags;
  };

  const rowTagsOf = (r: Row, hit: PreviewItem | null): RowTag[] => {
    // ยังไม่มีผลตรวจก็รู้อยู่แล้วว่าแถวนี้เป็นค่าบริการ เพราะเป็นคนกดเพิ่มเองกับมือ
    if (r.isService && !hit) {
      return [{ tone: 'info', kind: 'wrench', text: 'ค่าบริการของใบนี้ · ตั้งชื่อและราคาได้ — มีได้บรรทัดเดียว' }];
    }
    // `true` = โชว์ป้ายรับประกันด้วย — ข้อความนี้ขึ้นบนใบจริง และใบนี้คือจอสุดท้ายก่อนกดยืนยัน
    return hit ? itemTagsOf(hit, false, true) : [];
  };

  const extraTagsOf = (it: PreviewItem): RowTag[] => itemTagsOf(it, true);

  // ── ยืนยัน — จุดเดียวของทั้งหน้าที่เขียนฐานข้อมูล ───────────────────────────
  //  ลำดับคือ "สร้างร่างจริงทีเดียวทั้งชุด" แล้ว "ยืนยันทีละใบ" · แยกไปสร้างทีละบริษัทไม่ได้
  //  เพราะกฎค่าขนส่งอัตโนมัติคิดจากยอดรวมของทุกใบในกลุ่ม (applyShippingFeeToQuoteGroup)
  //  ถ้าสร้างแยก ค่าขนส่งที่ได้จะไม่ใช่ค่าเดียวกับที่พรีวิวโชว์ไว้ก่อนกด

  /**
   * ออกใบได้ไหม — ต้องมีผลตรวจที่ "สด" จริง เพราะยอดท้ายใบทุกตัวมาจากผลตรวจ
   * (ตั้งแต่ยุบสองขั้นเป็นขั้นเดียว 2026-09-17 เงื่อนไขชุดนี้คุมปุ่ม "ยืนยัน" โดยตรง
   *  แทนที่จะคุมปุ่ม "ดูใบร่าง" ที่ถูกถอดออกไปแล้ว — แต่เงื่อนไขไม่เปลี่ยนสักข้อ)
   */
  const canIssue =
    rows.length > 0 && unresolved === 0 && customerId !== null && contactId !== null && !!spUserId &&
    !previewing && !!preview && !staleNow && preview.can_create_draft;

  /** ปุ่มที่จางอยู่เฉย ๆ โดยไม่บอกเหตุผล คือปุ่มที่ผู้ใช้สรุปว่าระบบพัง */
  const issueBlockedBecause = (): string => {
    if (!spUserId) return 'เลือกพนักงานขายที่จะออกใบในนามก่อน';
    if (rows.length === 0) return 'ยังไม่มีรายการในใบ — เพิ่มสินค้าก่อน';
    if (unresolved > 0) return `ยังมี ${unresolved} รายการที่ยังไม่ได้เลือกสินค้า`;
    if (customerId === null || contactId === null) return 'ยังไม่ได้เลือกบริษัทและผู้ติดต่อ';
    if (previewing) return 'กำลังตรวจรายละเอียด...';
    if (!preview || staleNow) return 'ต้องตรวจรายละเอียดให้สำเร็จก่อน — กด “ตรวจใหม่”';
    // เหลือทางเดียวที่ปุ่มยังจางอยู่: ด่านตรวจทำงานไม่สำเร็จ (SYSTEM_ERROR) ซึ่งทะลุไม่ได้
    // เพราะมันไม่ได้แปลว่า "ใบนี้ผิดกฎ" แต่แปลว่า **ยังไม่รู้ว่าผิดหรือไม่**
    return 'ตรวจกฎไม่สำเร็จ — ลองกด “ตรวจใหม่” อีกครั้ง ถ้ายังไม่หายให้แจ้งผู้ดูแลระบบ';
  };

  const confirmOne = async (quoteId: string, webId: string) => {
    const res = await fetch(`/api/quotation/${quoteId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // userId = web_user_id เท่านั้น — isQuotationOwner ฝั่ง server เทียบกับเจ้าของใบ (ขั้น 8′)
      body: JSON.stringify({ userId: webId }),
    });
    if (!res.ok) throw new Error(await readError(res, 'ยืนยันไม่สำเร็จ'));
    return (await res.json()) as { quotation_no: string; pdf_link: string };
  };

  /**
   * ยืนยันทุกใบโดยไม่หยุดที่ใบแรกที่ล้ม — PM กับ THT เป็นคนละเอกสาร ใบหนึ่งติดสต็อกไม่ใช่
   * เหตุผลที่อีกใบจะออกไม่ได้ · คืน "ใบที่ยังไม่ออก" กลับไปให้ผู้เรียกเอาไปบอกผู้ใช้ตามจริง
   */
  const confirmMany = async (ids: string[], webId: string) => {
    const done: { quotation_no: string; pdf_link: string }[] = [];
    const left: string[] = [];
    const errors: string[] = [];
    for (const id of ids) {
      try {
        done.push(await confirmOne(id, webId));
      } catch (e) {
        left.push(id);
        errors.push(e instanceof Error ? e.message : 'ยืนยันไม่สำเร็จ');
      }
    }
    return { done, left, errors };
  };

  // ── พรีวิว PDF ของใบร่าง ────────────────────────────────────────────────────
  //  จอใบร่างเลียนแบบใบจริงได้ใกล้แค่ไหนก็ยังเป็น HTML คนละตัวกับไฟล์ที่ลูกค้าเปิด
  //  ปุ่มนี้คือคำตอบสุดท้าย — server เจนด้วย generateQuotationPDF() ตัวเดียวกับใบจริง
  //  โดยไม่เขียน DB และไม่กินเลขที่ใบ (ดู previewQuotePdf ใน webQuoteService.ts)
  const [pdfBusy, setPdfBusy] = useState<'PM' | 'THT' | null>(null);
  const [pdfError, setPdfError] = useState('');

  const openPdfPreview = async (company: 'PM' | 'THT') => {
    if (pdfBusy) return;
    setPdfError('');
    setPdfBusy(company);
    // เปิดแท็บ "ตอนกด" ไม่ใช่หลัง await — เบราว์เซอร์บล็อก window.open ที่ไม่ได้เกิดจากการกดโดยตรง
    const tab = window.open('', '_blank');
    try {
      const res = await fetch('/api/admin/webquote/preview-pdf', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        // ค่าชุดเดียวกับที่ส่งให้ /preview เป๊ะ ๆ — ส่งไม่เท่ากันเมื่อไหร่ ไฟล์ที่เปิดดูจะไม่ใช่ใบที่เห็น
        body: JSON.stringify({
          sp_user_id: spUserId,
          quote_company: company,
          customer_id: customerId,
          contact_id: contactId,
          items: itemsPayload,
          payment_terms_override: paymentTerms,
          delivery: deliveryPayload,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, 'เปิดพรีวิว PDF ไม่สำเร็จ'));
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
      // คืน objectURL ทีหลัง ไม่ใช่ทันที — คืนเร็วไปแท็บที่เพิ่งเปิดจะได้ไฟล์ว่าง
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      tab?.close();
      setPdfError(e instanceof Error ? e.message : 'เปิดพรีวิว PDF ไม่สำเร็จ');
    } finally {
      setPdfBusy(null);
    }
  };

  /**
   * ปุ่ม "ยืนยัน" ท้ายจอ — มีอะไรให้รับทราบก็เด้งโมดัลก่อน ไม่ออกใบทันที
   * ไม่มีอะไรติดเลยก็ออกใบตรง ๆ เหมือนเดิม — โมดัลที่เด้งทั้งที่ไม่มีอะไรให้อ่าน คือโมดัลที่ถูกกดผ่าน
   */
  const requestConfirm = () => {
    if (!canIssue || confirming) return;
    if (needsApproval || blockers.length > 0 || manualReasons.length > 0) { setConfirmOpen(true); return; }
    void confirmAll();
  };

  const confirmAll = async () => {
    if (!canIssue || confirming) return;
    setConfirmOpen(false);
    setConfirming(true);
    setConfirmError('');
    try {
      const res = await fetch('/api/admin/webquote/drafts', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sp_user_id: spUserId,
          customer_id: customerId,
          contact_id: contactId,
          propose_msg_id: proposeMsgId,
          sp_source: canPickAnySp ? spSource : null,
          // ใบนี้เกิดจากการแก้ใบเดิม ⇒ ให้หลังบ้านติด revise_from ไว้ด้วยตัวต่อสตริงของมันเอง
          revise_from: reviseFrom || undefined,
          items: itemsPayload,
          // ค่าชุดเดียวกับที่ส่งให้ /preview — ถ้าสองที่ส่งไม่เท่ากัน ใบที่ออกจะไม่ใช่ใบที่เห็น
          payment_terms_override: paymentTerms,
          delivery: deliveryPayload,
          // คำรับทราบจากโมดัล — คีย์มาจาก server (ไม่ประกอบเอง) และ server ตรวจกฎใหม่แล้วเทียบอีกที
          // ⇒ ข้อที่เพิ่งโผล่หลังจากคนกดรับทราบ (ของหมดระหว่างทาง) ยังตอบ 422 เหมือนเดิม
          acknowledged_violations: preview?.override_keys ?? [],
          // ติดราคาขั้นต่ำ = ส่งคำขอ ไม่ใช่ออกใบ — ธงนี้ทำให้ server ปฏิเสธ (NEEDS_APPROVAL)
          // ถ้าหน้าจอยังคิดว่ากำลังออกใบอยู่ แทนที่จะสร้างคำขอค้างไว้โดยไม่มีใครรู้ว่ามี
          request_approval: needsApproval,
          approval_note: needsApproval ? approvalNote.trim() || null : null,
          // **ส่งทุกกรณี ไม่ใช่เฉพาะตอนยังต้องขออนุมัติ** (แก้ 2026-09-21) — คนที่ถูกตีกลับ
          // แล้วแก้ราคาขึ้นจนไม่ติดขั้นต่ำ จะออกใบได้เลยโดยไม่มีคำขอใหม่ ถ้าไม่ส่ง id เดิมไปด้วย
          // ร่างของคำขอที่ถูกตีกลับจะค้างอยู่ในคิว "ไม่อนุมัติ" ตลอดไป โดยไม่มีปุ่มไหนปิดมันได้
          replaces_request_id: replacesRequestId,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, needsApproval ? 'ส่งขออนุมัติไม่สำเร็จ' : 'ออกใบเสนอราคาไม่สำเร็จ'));
      const data = await res.json();
      const webId = String(data.web_user_id ?? webUserId);
      setWebUserId(webId);
      const created = (data.quotes ?? []) as DraftQuote[];
      // ร่างของคำขอเดิมถูกล้างไปแล้วฝั่ง server ⇒ ถือว่าใช้ไปแล้ว ไม่ว่าจะจบทางไหน
      // (ถ้ายังถือไว้ แล้วคนกดส่งซ้ำ id นี้จะชี้คำขอที่ไม่มีแถวเหลืออยู่แล้ว)
      setReplacesRequestId(null);

      // ── ส่งขออนุมัติ: ร่างถูกบันทึกแล้วแต่ **ห้ามยิง confirm ต่อ** ────────────
      //  ยิงไปก็ได้ 422 เพราะด่านตรวจอ่านคำอนุมัติจากแถวของใบ ซึ่งยังเป็น pending อยู่
      if (data.approval) {
        setApprovalSent({ request_id: String(data.approval.request_id), count: created.length });
        return;
      }

      const { done, left, errors } = await confirmMany(created.map((q) => String(q.id)), webId);
      setResults(done);
      setStrandedIds(left);
      if (errors.length > 0) setConfirmError(errors.join('\n'));
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : 'ออกใบเสนอราคาไม่สำเร็จ');
    } finally {
      setConfirming(false);
    }
  };

  /** ใบที่สร้างไปแล้วแต่ยืนยันไม่ผ่าน — ลองใหม่ตรง ๆ ห้ามสร้างซ้ำ ไม่งั้นได้ร่างสองชุด */
  const retryStranded = async () => {
    if (strandedIds.length === 0 || confirming) return;
    setConfirming(true);
    setConfirmError('');
    try {
      const { done, left, errors } = await confirmMany(strandedIds, webUserId);
      setResults((r) => [...r, ...done]);
      setStrandedIds(left);
      if (errors.length > 0) setConfirmError(errors.join('\n'));
    } finally {
      setConfirming(false);
    }
  };

  // ── ส่วนที่ 3: revise → เติมรายการกลับเข้าฟอร์ม ──
  //  หลังบ้านยังสร้าง "ร่าง revision" ไว้ใน DB เหมือนเดิม (มันคือด่านตรวจกฎของใบต้นทางไปในตัว)
  //  แต่หน้านี้ไม่ยืนยันร่างตัวนั้น — มันเอา *รายการ* มาเปิดในฟอร์มให้แก้ได้เต็มรูปแบบ แล้วไป
  //  ออกใบจริงที่ปุ่มยืนยันเส้นเดียวกับทางปกติ · ร่างที่ค้างไว้ถูก insertDraftQuotations ลบทิ้ง
  //  ให้เองตอนสร้างใบจริง (คู่แอดมิน×เซลส์เดียวกัน) ⇒ ไม่มีร่างซ้อน
  const doRevise = async () => {
    if (!reviseNo.trim() || (!canPickAnySp && !spUserId)) return;
    setRevising(true);
    setReviseError('');
    // แก้ใบเดิม = เซลส์ของใบเดิม (เจ้าของเคาะ 2026-09-24) ⇒ ไม่ส่งเซลส์ให้ server หาเอง
    // ยกเว้นรอบที่ server บอกแล้วว่าเซลส์ของใบเดิมออกใบไม่ได้ และคนเลือกเองแล้ว
    const pickedForRevise = reviseNeedsPick && spSource === 'manual';
    try {
      const res = await fetch('/api/admin/webquote/revise', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sp_user_id: !canPickAnySp || pickedForRevise ? spUserId : undefined,
          quotation_no: reviseNo,
        }),
      });
      if (!res.ok) {
        const body = await res.clone().json().catch(() => null);
        if (body?.code === 'SALESPERSON_REQUIRED') setReviseNeedsPick(true);
        throw new Error(await readError(res, 'เตรียมใบแก้ไขไม่สำเร็จ'));
      }
      const data = await res.json();
      setWebUserId(data.web_user_id);
      if (canPickAnySp) {
        setSpUserId(String(data.sp_user_id ?? ''));
        setSpSource(pickedForRevise ? 'manual' : 'quotation');
        reviseSpRef.current = pickedForRevise ? null : String(data.sp_user_id ?? '') || null;
        setSpNotice(null);
        setReviseNeedsPick(false);
      }
      setReviseFrom(data.revise_from);
      const q = ((data.quotes ?? []) as DraftQuote[])[0];
      // บรรทัดที่ "กฎ" เป็นคนเติม (สินค้าพ่วง · ค่าขนส่งอัตโนมัติ) ต้องไม่กลับเข้าฟอร์ม ไม่งั้น
      // ตอนออกใบจริงมันจะถูกขยายซ้ำอีกชุด — ค่าบริการที่คนใส่เองไม่เข้าข่ายข้อนี้ ต้องรอดไป
      const keep = (q?.items ?? []).filter(
        (it) => !it.is_optional && (!it.is_shipping_fee || it.is_manual_service === true),
      );
      setRows(
        keep.map((it) => ({
          key: newKey(),
          productTemplateId: it.product_id ?? null,
          model: it.model,
          name: it.name,
          quantity: String(num(it.quantity)),
          price: String(num(it.price)),
          disc1: num(it.discount_1) ? String(num(it.discount_1)) : '',
          disc2: num(it.discount_2) ? String(num(it.discount_2)) : '',
          remark: String(it.remark ?? ''),
          candidates: [],
          status: 'ok' as RowStatus,
          isService: it.is_manual_service === true,
        })),
      );
      // ค่าขนส่งของกฎไม่กลับเข้าแถว (ข้างบน) แต่ชื่อ/ราคาที่ใบเดิมใช้ต้องตามมา — คนอาจแก้ทับไว้
      // ถ้ากฎยังเข้าเงื่อนไข ใบแก้ไขจะได้ค่าเดิม · ไม่เข้าแล้ว บรรทัดก็หายเองเหมือนเดิม
      const oldFee = (q?.items ?? []).find((it) => it.is_shipping_fee && it.is_manual_service !== true);
      setAutoFeeOv(oldFee ? { name: String(oldFee.name ?? ''), price: String(num(oldFee.price)) } : null);
      // บริษัทที่เลือกไว้ต้องมีอยู่ในลิสต์ ไม่งั้น <select> โชว์ "ยังไม่เลือก" ทั้งที่ id ตั้งอยู่แล้ว
      const cid = q?.customer_id ?? null;
      setCustomerOptions(cid ? [{ id: cid, display_name: q?.company_name ?? '' }] : []);
      setCustomerId(cid);
      setContactId(q?.contact_id ?? null);
      setContactAuto(false);
      setContactQuery('');
      // ค่าที่คนออกใบต้นทางตั้งทับไว้ต้องตามมา ไม่งั้น "แก้ใบเดิม" จะเงียบ ๆ คืนกำหนดส่งกับ
      // เครดิตกลับเป็นค่าอัตโนมัติ ทั้งที่ใบที่ลูกค้าถืออยู่ไม่ได้เขียนแบบนั้น
      // อ่านจากธง `payment_terms_override` ตรง ๆ ไม่ใช่เดาจากการเทียบค่า — ใบที่ลูกค้ามีเครดิต
      // 30 Days อยู่แล้วและไม่มีใครแก้ ต้องไม่ขึ้นป้าย "ตั้งเอง" ให้คนอ่านสับสน
      setPaymentTerms(String(q?.payment_terms_override ?? '').trim() || null);
      setDeliveryOv(
        ((data.quotes ?? []) as DraftQuote[]).reduce<
          Partial<Record<'PM' | 'THT', { type: DeliveryTypeKey | null; days: number | null }>>
        >((acc, dq) => {
          const co = dq.quote_company;
          if (!co) return acc;
          const type = (dq.delivery_type_override ?? null) as DeliveryTypeKey | null;
          const days = dq.delivery_days_override ?? null;
          if (type !== null || days !== null) acc[co] = { type, days };
          return acc;
        }, {}),
      );
      setProposeMsgId(null);
      setPreview(null);
      setPreviewSig('');
      setResults([]);
      setStrandedIds([]);
      setText('');
    } catch (e) {
      setReviseError(e instanceof Error ? e.message : 'เตรียมใบแก้ไขไม่สำเร็จ');
    } finally {
      setRevising(false);
    }
  };

  const blocked = !profileReady;
  /** บวกยอดข้ามใบจาก `q.totals` ที่ server คิดมาแล้ว — รวมเฉย ๆ ไม่ใช่คิดสูตรเองบนจอ */
  const sumQuotes = (pick: (t: PreviewQuote['totals']) => number): number =>
    (preview?.quotes ?? []).reduce((n, q) => n + pick(q.totals), 0);
  /** ออกใบไปแล้ว — ไม่มีอะไรให้ยืนยันซ้ำ เหลือแค่ลิงก์ PDF กับทางเริ่มใบใหม่ */
  const issued = results.length > 0;
  /** ส่งคำขอไปแล้ว — เหมือน issued ตรงที่ "จบรอบแล้ว" แต่ไม่มีเลขใบให้โชว์ */
  const requested = approvalSent !== null;
  /** มีอะไรให้ล้างไหม — การ์ดร่างที่เปิดค้างไว้เปล่า ๆ ไม่ใช่ "งานที่เริ่มแล้ว" */
  const hasWork = rows.length > 0 || text.trim().length > 0 || customerId !== null || issued || requested;

  // ── ชิป "ใช้ส่วนลดนี้กับรายการอื่น" (เจ้าของสั่ง 2026-09-17) ────────────────
  //  หน่วง 650ms หลังหยุดพิมพ์แล้วค่อยเสนอ — โผล่ทุกตัวอักษรคือแถวที่กระตุกสูงต่ำใส่หน้าคน
  const [bulkOffer, setBulkOffer] = useState<BulkOffer | null>(null);
  const bulkTimer = useRef<number | null>(null);
  /** ค่าล่าสุดสำหรับตอนตัวจับเวลาเด้ง — closure ของ setTimeout ถือ rows ของตอนที่พิมพ์ตัวนั้น */
  const bulkRef = useRef<{ rows: Row[]; coByRow: Map<string, 'PM' | 'THT'> }>({ rows, coByRow: matched.coByRow });
  useEffect(() => { bulkRef.current = { rows, coByRow: matched.coByRow }; }, [rows, matched]);
  useEffect(() => () => { if (bulkTimer.current) window.clearTimeout(bulkTimer.current); }, []);

  const coOfRow = (r: Row, map: Map<string, 'PM' | 'THT'>): 'PM' | 'THT' => map.get(r.key) ?? r.company ?? 'PM';
  /** บรรทัดที่รับส่วนลดได้จริง — ค่าบริการรับไม่ได้ · ของที่กฎเติมให้เองไม่ได้อยู่ใน `rows` ตั้งแต่ต้น */
  const discountable = (r: Row) => r.status === 'ok' && !r.isService;

  const dismissBulk = useCallback(() => {
    if (bulkTimer.current) window.clearTimeout(bulkTimer.current);
    setBulkOffer(null);
  }, []);

  const offerBulk = (key: string) => {
    if (bulkTimer.current) window.clearTimeout(bulkTimer.current);
    setBulkOffer(null);
    bulkTimer.current = window.setTimeout(() => {
      const { rows: rs, coByRow } = bulkRef.current;
      const src = rs.find((r) => r.key === key);
      // ล้างส่วนลดทิ้งแล้วไม่ต้องเสนออะไร · แถวที่ถูกลบไประหว่างรอก็ไม่มีที่ให้ชิปโผล่
      if (!src || !discountable(src) || num(src.disc1) <= 0) return;
      const co = coOfRow(src, coByRow);
      const others = rs.filter((r) => r.key !== key && discountable(r));
      if (others.length === 0) return; // มีสินค้าบรรทัดเดียวก็ไม่มีอะไรให้ "ใช้กับทุกรายการ"
      setBulkOffer({
        rowKey: key,
        co,
        d1: num(src.disc1),
        d2: num(src.disc2),
        inDoc: others.filter((r) => coOfRow(r, coByRow) === co).length,
        inAll: others.length,
      });
    }, 650);
  };

  const applyBulk = (scope: 'doc' | 'all') => {
    const o = bulkOffer;
    if (!o) return;
    const d1 = String(o.d1);
    const d2 = o.d2 > 0 ? String(o.d2) : '';
    setRows((rs) =>
      rs.map((r) =>
        discountable(r) && (scope === 'all' || coOfRow(r, bulkRef.current.coByRow) === o.co)
          ? { ...r, disc1: d1, disc2: d2 }
          : r,
      ),
    );
    dismissBulk();
  };

  /** ทุกอย่างที่เอกสารต้องใช้เพื่อเป็นฟอร์ม — ก้อนเดียว ส่งให้ทุกใบใช้ร่วมกัน */
  const docCtx: DocCtx = {
    // พรีวิวมาแล้วใช้ของพรีวิว (ก้อนเดียวกัน แต่สดกว่าเพราะคิดพร้อมกับรายการ) ไม่มีก็ใช้ /party
    customer: preview?.customer ?? partyBlock,
    identity,
    svcCfg,
    autoFeeOv,
    editAutoFee: (base, patch) =>
      setAutoFeeOv((cur) => ({ name: cur?.name ?? base.name, price: cur?.price ?? String(base.price), ...patch })),
    resetAutoFee: () => setAutoFeeOv(null),
    matched: matched.byRow,
    staleNow,
    previewing,
    mustPick,
    patchRow,
    removeRow,
    pickCandidate,
    offerBulk,
    bulkOffer,
    multiDoc: groups.length > 1,
    applyBulk,
    dismissBulk,
    rowTagsOf,
    extraTagsOf,
    customerOpt,
    customerOpts,
    onPickCustomer: (o) => {
      // กดบริษัทเดิมซ้ำ = ไม่ได้เปลี่ยนอะไร — ล้างผู้ติดต่อทิ้งตรงนี้ effect โหลดรายชื่อจะไม่วิ่ง
      // (customerId ไม่ขยับ) ⇒ คนเดียวของบริษัทจะไม่ถูกเลือกกลับให้ ช่องค้างว่างโดยไม่มีเหตุ
      if (Number(o.id) === customerId) return;
      setCustomerId(Number(o.id));
      setContactId(null);
      // เปลี่ยนบริษัทเอง = เลิกยึดผู้ติดต่อของใบต้นทางแล้ว เลือกคนเดียวของบริษัทใหม่ให้ได้
      setContactAuto(true);
      // เครดิตเป็นของ "บริษัทนี้" — เปลี่ยนบริษัทแล้วค่าที่ตั้งทับไว้หมดความหมาย
      // (กติกาเดียวกับ quote-edit.html ที่เขียนเครดิตใหม่ทุกครั้งที่เปลี่ยนบริษัท)
      setPaymentTerms(null);
    },
    onCustomerQuery: setCustomerQuery,
    custSearching,
    contactOpt,
    contactOpts,
    onPickContact: setContactId,
    onAddContact: openAddContact,
    onEditContact: isLocalContactId(contactId) ? () => setEditContactId(contactId) : null,
    onDeleteContact:
      isLocalContactId(contactId) && contactOpt
        ? () => {
            setDeleteError(null);
            setDeleteContact({ id: contactId, name: contactOpt.name });
          }
        : null,
    paymentTerms,
    paymentTermOpts,
    setPaymentTerms,
    deliveryTypes: preview?.delivery_types ?? [],
    deliveryOv,
    setDeliveryOv: (co, v) =>
      setDeliveryOv((cur) => {
        const next = { ...cur };
        if (v) next[co] = v;
        else delete next[co];
        return next;
      }),
    addProductRow,
    addRow,
    addServiceRow,
    canAddService: !!svcCfg && !serviceRow && !autoFeeShown,
    serviceHint: !svcCfg
      ? 'ยังอ่านค่าตั้งต้นของค่าบริการไม่ได้ — ลองรีเฟรชหน้า'
      : autoFeeShown
        ? 'ระบบเติมบรรทัดค่าขนส่งให้แล้ว — ค่าบริการมีได้บรรทัดเดียว จึงเพิ่มอีกไม่ได้'
        : serviceRow
          ? 'มีบรรทัดค่าบริการแล้ว 1 บรรทัด — แก้ชื่อและราคาได้ที่แถวนั้น ลบก่อนจึงเพิ่มใหม่ได้'
          : `ค่าบริการมีได้บรรทัดเดียว และอยู่ในใบ Primus (PM) เสมอ (สินค้าระบบ ${svcCfg.internal_reference})`,
    justAdded,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        icon={FilePlus2}
        title="ขอใบเสนอราคา"
        description="วางข้อความหรือกรอกเอง → แก้ในใบ → ยืนยัน"
      >
        {hasWork && (
          <Button variant="neutral" tone="soft" icon={RotateCcw} onClick={resetAll}>
            เริ่มใหม่
          </Button>
        )}
      </PageHeader>

      {/* ── ส่วนที่ 0 — แถบตัวตนของใบ ── */}
      <QuoteIssuerProfile
        spUserId={spUserId}
        onSpUserIdChange={setSpUserId}
        onSpPick={onSpPick}
        onSpAuto={canPickAnySp ? onSpAuto : undefined}
        spAutoHint={reviseFrom ? 'ตามใบเดิม' : 'ตามลูกค้า'}
        spBadge={spSource === null ? null : spSource === 'manual' ? 'manual' : 'system'}
        spNotice={spNotice}
        onReadyChange={onReadyChange}
        onIdentityChange={onIdentityChange}
      />

      {/* ── ส่วนที่ 1 — ช่องพิมพ์ข้อความ ──
          พับเองเมื่อสกัดสำเร็จ เพราะตั้งแต่นั้นงานอยู่ในใบแล้ว — แต่ยังกางกลับมาวางข้อความชุดใหม่
          ได้ตลอด (การวางข้อความเป็นทางเข้าทางหนึ่ง ไม่ใช่ขั้นที่ผ่านไปแล้วผ่านเลย) */}
      {pasteOpen ? (
        <div className={`bg-card border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3 ${blocked ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center gap-2">
            <FileText className="w-[18px] h-[18px]" style={{ color: BRAND }} />
            <h3 className="text-sm font-bold text-slate-800">วางข้อความขอใบเสนอราคา</h3>
            {rows.length > 0 && (
              <button
                type="button"
                onClick={() => setPasteOpen(false)}
                className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800"
              >
                พับเก็บ
                <ChevronUp className="w-3.5 h-3.5 shrink-0" />
              </button>
            )}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder={'เสนอราคา\nบริษัท ...\nคุณ ...\nรุ่นสินค้า = จำนวน\nลด 30%'}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-800 outline-none focus:border-[var(--brand-fg)] focus:bg-card resize-y font-mono"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="md"
              icon={ArrowRight}
              busy={proposing}
              disabled={!text.trim() || (!canPickAnySp && !spUserId)}
              onClick={propose}
            >
              {proposing ? 'กำลังสกัดคำสั่ง...' : 'สร้างร่าง'}
            </Button>
            {!canPickAnySp && !spUserId && <span className="text-xs text-amber-700">เลือกพนักงานขายที่จะออกใบในนามก่อน</span>}
            {proposing && <span className="text-xs text-slate-400">ระบบมีเวลาสกัดสูงสุด 60 วินาที</span>}
            <p className="basis-full text-[11px] text-slate-400">
              ไม่มีข้อความก็ได้ — พิมพ์รายการลงในใบด้านล่างได้เลย
            </p>
          </div>

          {systemBusy && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">ระบบไม่ว่างชั่วคราว</p>
                <p className="text-xs">ข้อความที่พิมพ์ไว้ยังอยู่ครบ กด “สร้างร่าง” อีกครั้งได้เลย</p>
              </div>
            </div>
          )}
          {proposeError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>{proposeError}</span>
            </div>
          )}
          {aiMessage && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>{aiMessage}</span>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPasteOpen(true)}
          className={`w-full flex flex-wrap items-center gap-2 bg-card border border-slate-200 rounded-2xl shadow-sm px-4 py-3 text-left hover:bg-slate-50 transition-colors ${blocked ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <FileText className="w-[18px] h-[18px] shrink-0" style={{ color: BRAND }} />
          <span className="text-sm font-bold text-slate-800">วางข้อความขอใบเสนอราคา</span>
          <span className="text-[11px] text-slate-400">พับไว้เพราะมีรายการในใบแล้ว — กางเพื่อวางข้อความชุดใหม่</span>
          <ChevronDown className="w-4 h-4 ml-auto shrink-0 text-slate-400" />
        </button>
      )}

      {/* ธง revision มองไม่เห็นไม่ได้ — ตอนยืนยัน มันจะไป "ยกเลิกใบเก่า" ที่เลขที่นี้ด้วย
          ⇒ คนที่แก้ลูกค้าเป็นอีกรายระหว่างทาง ต้องถอดธงออกได้ก่อนที่จะเกิดเรื่องนั้น */}
      {reviseFrom && (
        <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-600">
          <RotateCcw className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1 min-w-[180px]">
            ใบนี้จะออกเป็น <span className="font-semibold text-slate-800">revision ของ {reviseFrom}</span>
            {' '}— ยืนยันแล้วใบเดิมจะถูกยกเลิกให้อัตโนมัติ
          </span>
          <Button variant="neutral" tone="soft" onClick={() => setReviseFrom('')}>
            ออกเป็นใบใหม่แทน
          </Button>
        </div>
      )}

      {/* ── ส่วนที่ 2 — เอกสารคือฟอร์ม ──
          แถบสถานะการตรวจกับกล่องเตือนอยู่ "เหนือใบ" เพราะมันพูดถึงทั้งชุด ไม่ใช่ของใบใดใบหนึ่ง
          และแถบสรุป+ปุ่มอยู่ท้ายกลุ่มนี้แบบติดขอบล่าง ⇒ ปุ่มตามคนไปตลอดที่ยังอยู่กับเอกสาร */}
      <div className={`space-y-4 ${blocked ? 'opacity-50 pointer-events-none' : ''}`}>
        {/* ── แถบสถานะการตรวจ — บอกว่าสิ่งที่เห็นตรงกับข้อมูลล่าสุดแค่ไหน ── */}
        {previewError ? (
          <div className="flex flex-wrap items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            <span className="flex-1 min-w-[180px]">
              ตรวจรายละเอียดไม่สำเร็จ — {previewError} · ข้อมูลในใบยังอยู่ครบ กดตรวจใหม่ได้เลย
            </span>
            <Button variant="danger" tone="soft" icon={Eye} onClick={() => void runPreview()}>
              ตรวจใหม่
            </Button>
          </div>
        ) : previewing ? (
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-600">
            <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
            <span>กำลังตรวจสต็อก กฎระงับ ราคาขั้นต่ำ ค่าบริการ และกำหนดส่ง...</span>
          </div>
        ) : staleNow ? (
          <div className="flex flex-wrap items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1 min-w-[180px]">
              ใบถูกแก้หลังตรวจครั้งล่าสุด — ยอดท้ายใบ สต็อก และกฎที่เห็นยังเป็นของรอบก่อน
            </span>
            <Button variant="warning" tone="soft" icon={Eye} onClick={() => void runPreview()}>
              ตรวจใหม่
            </Button>
          </div>
        ) : preview ? (
          <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-600">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span className="flex-1 min-w-[180px]">
              ตรวจกับข้อมูลล่าสุดเมื่อ {previewAt} น. — ทั้งหน้ายังไม่เขียนอะไรลงฐานข้อมูลจนกว่าจะกด “ยืนยัน”
            </span>
            <Button variant="neutral" tone="soft" icon={Eye} onClick={() => void runPreview()}>
              ตรวจใหม่
            </Button>
          </div>
        ) : rows.length > 0 ? (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              ยังไม่ได้ตรวจกับข้อมูลล่าสุด — ระบบจะตรวจให้เองเมื่อเลือกบริษัท ผู้ติดต่อ และเคาะรายการครบแล้ว
            </span>
          </div>
        ) : null}

        {unresolved > 0 && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            <span>ยังมี {unresolved} รายการที่ยังไม่ได้เลือกสินค้า — เคาะให้ครบก่อนจึงจะออกใบได้</span>
          </div>
        )}

        {/* ราคาต่ำกว่าขั้นต่ำ = **ติ๊กเองไม่ได้** ต้องส่งให้คนอื่นตัดสิน ⇒ กล่องคนละใบกับกล่องแดง
            ไม่งั้นคนอ่านรวมกันว่า "ติดกฎ แต่กดผ่านได้" ซึ่งเป็นสิ่งที่ปุ่มไม่ทำแล้ว */}
        {needsApproval && !staleNow && (
          <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5 text-xs text-violet-800">
            <p className="flex items-center gap-2 font-bold">
              <BadgeCheck className="w-4 h-4 shrink-0" />
              ต้องขออนุมัติราคา {approvalRequired.length} รายการ — ออกใบเองไม่ได้
            </p>
            <ul className="mt-1 pl-6 list-disc space-y-0.5">
              {approvalRequired.map((v, i) => (
                <li key={`${v.type}-${v.model}-${i}`}>{v.display_message}</li>
              ))}
            </ul>
            <p className="mt-1.5 pl-6">กด “ยืนยัน” จะเป็นการ<b>ส่งคำขอ</b>ให้ผู้มีสิทธิ์อนุมัติ — ใบจะออกเมื่อได้รับอนุมัติแล้วเท่านั้น</p>
          </div>
        )}

        {/* ติดกฎ = **ออกใบได้ แต่ต้องยืนยันอีกชั้น** (2026-09-15) — บทสรุปบรรทัดแรกต้องตรงกับสิ่งที่
            ปุ่มทำจริง ไม่งั้นจอบอกว่า "ออกไม่ได้" แล้วปุ่มออกใบได้ = จอที่ไม่มีใครเชื่ออีกเลย */}
        {blockers.length > 0 && !staleNow && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-xs text-red-700">
            <p className="flex items-center gap-2 font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              ติดด่านตรวจ {blockers.length} ข้อ — ออกใบได้ แต่ต้องยืนยันอีกชั้น
            </p>
            <ul className="mt-1 pl-6 list-disc space-y-0.5">
              {blockers.map((v, i) => (
                <li key={`${v.type}-${v.model}-${i}`}>{v.display_message}</li>
              ))}
            </ul>
          </div>
        )}

        {/* คนละแกนกับกล่องแดง: ใบยังนำเข้า Odoo ได้หรือไม่ ไม่ใช่ผิดกฎของร้านหรือไม่ */}
        {manualReasons.length > 0 && !staleNow && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800">
            <p className="flex items-center gap-2 font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              ต้องแก้มือใน Odoo ก่อนนำเข้า {manualReasons.length} เรื่อง
            </p>
            <ul className="mt-1 pl-6 list-disc space-y-0.5">
              {manualReasons.map((r, i) => (
                <li key={`${r.kind}-${i}`}>{r.display_message}</li>
              ))}
            </ul>
            <p className="mt-1.5 pl-6">ใบชุดนี้จะ<b>ไม่อยู่ในไฟล์ส่งออก Odoo ชุดปกติ</b> — ส่งออกจากเมนู “ต้องแก้มือก่อน” ในหน้าประวัติ</p>
          </div>
        )}

        {/* ── ใบ ── ก่อนตรวจครั้งแรกเป็นใบเดียวที่ยังไม่รู้ว่าเป็นของบริษัทไหน
            (resolveQuoteCompany อยู่ฝั่ง server) แล้วค่อยแตกเป็น PM/THT เมื่อผลตรวจกลับมา */}
        {groups.map((g) => (
          <QuoteDocument key={g.co} g={g} ctx={docCtx} />
        ))}

        {/* เปิดไฟล์ไม่ได้ต้องบอกเหตุผล — แท็บที่ไม่เปิดเฉย ๆ คนอ่านว่าระบบพัง */}
        {pdfError && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            <span>{pdfError}</span>
          </div>
        )}

        {confirmError && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 whitespace-pre-wrap">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            <span>{confirmError}</span>
          </div>
        )}

        {/* สร้างไปแล้วแต่ยืนยันไม่ผ่าน = มีแถวค้างอยู่ในฐานจริง ๆ ห้ามเงียบ และห้ามให้กด
            "ยืนยัน" ซ้ำจากศูนย์ ไม่งั้นจะได้ร่างสองชุดของลูกค้าคนเดียวกัน */}
        {strandedIds.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800 space-y-1.5">
            <p className="flex items-center gap-2 font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              ยืนยันไม่ครบ — ใบที่เหลือถูกบันทึกเป็นร่างไว้ในระบบแล้ว {strandedIds.length} ใบ
            </p>
            <p className="pl-6">รหัสร่าง: {strandedIds.join(', ')}</p>
            <p className="pl-6">
              กด “ยกเลิก” ได้ — ร่างที่ค้างจะถูกล้างเองตอนออกใบครั้งถัดไปในนามพนักงานขายคนเดิม
            </p>
            <div className="pl-6">
              <Button variant="warning" tone="soft" icon={CheckCircle2} busy={confirming} onClick={retryStranded}>
                ยืนยันใบที่เหลืออีกครั้ง
              </Button>
            </div>
          </div>
        )}

        {/* ส่งคำขอแล้ว = ใบถูกบันทึกเป็นร่างจริงในระบบ แต่ยังไม่ใช่ใบเสนอราคา —
            ต้องพูดสองเรื่องนี้พร้อมกัน ไม่งั้นคนกดจะไปตามหา PDF ที่ยังไม่มี */}
        {approvalSent && (
          <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 space-y-2 text-sm">
            <p className="flex items-center gap-2 font-bold text-violet-800">
              <BadgeCheck className="w-4 h-4 shrink-0" />
              ส่งขออนุมัติราคาแล้ว {approvalSent.count} ใบ — รอผู้อนุมัติ
            </p>
            <p className="text-xs text-violet-800">
              ใบชุดนี้ถูกบันทึกเป็นร่างที่รออนุมัติ <b>ยังไม่มีเลขที่ใบและยังไม่มี PDF</b> ·
              ติดตามสถานะได้ที่เมนู “อนุมัติราคา”
            </p>
          </div>
        )}

        {issued && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-2">
            <p className="text-sm font-bold text-emerald-800">ออกใบเสนอราคาสำเร็จ {results.length} ใบ</p>
            {results.map((r) => (
              <div key={r.quotation_no} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-semibold text-slate-800 tabular-nums">{r.quotation_no}</span>
                <a
                  href={r.pdf_link}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                >
                  <FileText className="w-3.5 h-3.5" />
                  เปิดไฟล์ PDF
                </a>
              </div>
            ))}
          </div>
        )}

        {/* ── แถบสรุป + ปุ่ม ติดขอบล่างจอ ──
            หน้ายาวขึ้นเพราะยุบสองขั้นเป็นขั้นเดียว ⇒ ปุ่มต้องตามคนไป ไม่ใช่ให้เลื่อนลงไปหา
            **ยอดทุกตัวบวกจาก `q.totals` ที่ server คิดด้วยฟังก์ชันเดียวกับ PDF** — จอไม่คิดสูตรเอง
            และ "ส่วนลดรวม" คือสิ่งที่กระดาษไม่มีวันบอก (ช่อง "ส่วนลด" บนใบพิมพ์ 0.00 เสมอ
            ตามแบบฟอร์มของบริษัท ดู utils/pricing.ts) ⇒ ใบเดียวก็ยังมีข้อมูลใหม่ให้อ่าน
            ⚠️ ผลบวกคลาดจากราคาตั้งได้ 1 สตางค์เพราะแต่ละช่องปัดทศนิยมของตัวเอง — ไม่ใช่บั๊ก */}
        <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-slate-200 bg-card/95 backdrop-blur px-3.5 py-2.5 shadow-sm">
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 min-w-0">
            {preview && !staleNow ? (
              <>
                <span className="text-[11.5px] text-slate-500 whitespace-nowrap">
                  รวมก่อนส่วนลด{' '}
                  <span className="text-xs font-bold text-slate-800 tabular-nums">
                    ฿{money2(sumQuotes((t) => t.subtotal) + sumQuotes((t) => t.discount_total))}
                  </span>
                </span>
                <span className="text-[11.5px] text-slate-500 whitespace-nowrap">
                  ส่วนลดรวม{' '}
                  <span className="text-xs font-bold text-red-700 tabular-nums">
                    −฿{money2(sumQuotes((t) => t.discount_total))}
                  </span>
                </span>
                <span className="text-[11.5px] text-slate-500 whitespace-nowrap">
                  รวมก่อน VAT{' '}
                  <span className="text-xs font-bold text-slate-800 tabular-nums">
                    ฿{money2(sumQuotes((t) => t.subtotal))}
                  </span>
                </span>
                <span className="text-[11.5px] text-slate-500 whitespace-nowrap">
                  VAT 7%{' '}
                  <span className="text-xs font-bold text-slate-800 tabular-nums">
                    ฿{money2(sumQuotes((t) => t.vat))}
                  </span>
                </span>
                <span className="text-[11.5px] text-slate-500 whitespace-nowrap">
                  {preview.quotes.length > 1 ? 'ยอดสุทธิทุกใบ' : 'ยอดสุทธิ'}{' '}
                  <span className="text-base font-extrabold text-slate-900 tabular-nums">
                    ฿{money2(sumQuotes((t) => t.grand_total))}
                  </span>
                </span>
              </>
            ) : (
              <span className="text-[11.5px] text-slate-500">
                {staleNow
                  ? 'ยอดรวมรอผลตรวจรอบใหม่ — กด “ตรวจใหม่” ด้านบน'
                  : 'ยอดรวมขึ้นเมื่อตรวจรายละเอียดสำเร็จ — ตัวเลขทุกตัวมาจากผลตรวจ ไม่ได้บวกเองบนจอ'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {issued || requested ? (
              <Button variant="primary" size="md" icon={FilePlus2} onClick={resetAll}>
                เริ่มใบใหม่
              </Button>
            ) : (
              <>
                {/* ปุ่มที่จางอยู่เฉย ๆ โดยไม่บอกเหตุผล คือปุ่มที่ผู้ใช้สรุปว่าระบบพัง */}
                {!canIssue && (
                  <span className="text-[11px] text-amber-700 max-w-[320px]">{issueBlockedBecause()}</span>
                )}
                {/* พรีวิว PDF อยู่แถวเดียวกับปุ่มยืนยัน (เจ้าของสั่ง 2026-09-23) — ปุ่มเดียวเสมอ ดู PdfPreviewButton */}
                <PdfPreviewButton groups={groups} busy={pdfBusy} onOpen={(co) => void openPdfPreview(co)} />
                <Button variant="danger" tone="soft" icon={Ban} disabled={confirming} onClick={resetAll}>
                  ยกเลิก
                </Button>
                {/* ใบที่ติดอะไรอยู่ ปุ่มเป็นสีแดง ไม่ใช่เขียว — สีของปุ่มต้องตรงกับผลของการกด
                    (docs/design.md หัวข้อสีปุ่ม: แดง = ของที่ย้อนยาก) */}
                <Button
                  variant={needsApproval ? 'warning' : (blockers.length > 0 || manualReasons.length > 0 ? 'danger' : 'primary')}
                  size="md"
                  icon={needsApproval ? Send : CheckCircle2}
                  busy={confirming}
                  disabled={!canIssue || strandedIds.length > 0}
                  onClick={requestConfirm}
                >
                  {confirming
                    ? (needsApproval ? 'กำลังส่งคำขอ...' : 'กำลังออกใบ...')
                    : (needsApproval ? 'ส่งขออนุมัติราคา' : 'ยืนยัน')}
                </Button>
              </>
            )}
          </div>

          {/* คำว่า "ร่าง" ชวนให้เข้าใจว่าระบบเก็บไว้ให้แล้ว — ต้องพูดตรงนี้ว่ายังไม่ได้เก็บ
              และไม่มีปุ่ม "บันทึกร่าง" ให้กด (เจ้าของเคาะ 2026-09-17) ⇒ ทั้งหน้ามีจุดเดียวที่เขียน DB */}
          {!issued && !requested && (
            <p className="basis-full text-[10.5px] text-slate-400">
              {needsApproval
                ? 'ใบนี้ยังไม่ถูกบันทึกลงระบบ — กด “ยืนยัน” จะเป็นการส่งคำขออนุมัติราคา ยังไม่ออกเลขที่ใบ'
                : 'ใบนี้ยังไม่ถูกบันทึกลงระบบ — กด “ยืนยัน” เมื่อไหร่จึงจะออกเลขที่และบันทึกจริง'}
            </p>
          )}
        </div>
      </div>

      {/* ชั้นยืนยันอีกชั้นก่อนออกใบจริง — เด้งเฉพาะตอนที่มีอะไรให้รับทราบ (ดู requestConfirm) */}
      {confirmOpen && (
        <ConfirmIssueModal
          violations={blockers}
          manualReasons={manualReasons}
          approvalRequired={approvalRequired}
          note={approvalNote}
          onNoteChange={setApprovalNote}
          quoteLabels={groups.map((g) => g.label)}
          busy={confirming}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={confirmAll}
        />
      )}

      {/* ผู้ติดต่อใหม่ใต้บริษัทที่เลือกอยู่ — เปิดจากท้ายรายการในช่อง "ผู้ติดต่อ" (ก้อน I3)
          `customerOpt` ต้องมีค่าเสมอตรงนี้ เพราะช่องผู้ติดต่อ disabled อยู่จนกว่าจะเลือกบริษัท
          — เช็กอีกชั้นไว้เพราะ state สองตัวนี้ไม่ได้ผูกกันด้วยชนิดข้อมูล */}
      {addContactFor !== null && customerId !== null && customerOpt && (
        <LocalContactModal
          companyId={customerId}
          companyName={customerOpt.name}
          companyRef={customerOpt.row.reference ?? null}
          initialName={addContactFor}
          authHeaders={authHeaders}
          onClose={() => setAddContactFor(null)}
          onPicked={onContactAdded}
        />
      )}

      {/* แก้ไข/ลบ คนที่เราเพิ่มเอง — เปิดจากไอคอนข้างช่อง "ผู้ติดต่อ" (เจ้าของเคาะ 2026-09-21) */}
      {editContactId !== null && customerId !== null && customerOpt && (
        <LocalContactModal
          editId={editContactId}
          companyId={customerId}
          companyName={customerOpt.name}
          companyRef={customerOpt.row.reference ?? null}
          authHeaders={authHeaders}
          onClose={() => setEditContactId(null)}
          onPicked={onContactSaved}
        />
      )}

      {deleteContact && (
        <DeleteContactModal
          contactName={deleteContact.name}
          companyName={customerOpt?.name ?? ''}
          busy={deleteBusy}
          error={deleteError}
          onCancel={() => setDeleteContact(null)}
          onConfirm={confirmDeleteContact}
        />
      )}

      {/* ── ส่วนที่ 3 — revise ── */}
      <div className={`bg-card border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3 ${blocked ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center gap-2">
          <RotateCcw className="w-[18px] h-[18px]" style={{ color: BRAND }} />
          <h3 className="text-sm font-bold text-slate-800">แก้ไขใบที่ออกไปแล้ว (revise)</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={reviseNo}
            onChange={(e) => setReviseNo(e.target.value)}
            placeholder="เลขที่ใบ เช่น QP-260705030"
            className="h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 outline-none focus:border-[var(--brand-fg)] focus:bg-card w-64"
          />
          <Button
            variant="neutral"
            tone="soft"
            size="md"
            icon={ArrowRight}
            busy={revising}
            disabled={!reviseNo.trim() || (!canPickAnySp && !spUserId) || (reviseNeedsPick && spSource !== 'manual')}
            onClick={doRevise}
          >
            เตรียมใบแก้ไข
          </Button>
          <span className="text-xs text-slate-400">ใบที่ยังไม่มีเลขที่ (ร่าง) แก้แบบ revision ไม่ได้</span>
        </div>
        {reviseError && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            <span>{reviseError}</span>
          </div>
        )}
      </div>

    </div>
  );
};
