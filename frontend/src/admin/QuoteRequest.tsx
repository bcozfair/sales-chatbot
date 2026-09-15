// ─────────────────────────────────────────────────────────────────────────────
//  หน้า "ขอใบเสนอราคา" — หน้าเดียวจบ (เฟส E · ขั้น 9′)
//  แผน: docs/plan-web-quote-request.md §0 (form-first) · ขั้น 9′
//
//  v5 ตัดการจำลองแชท LINE ทิ้งทั้งก้อน — หน้านี้ไม่มี Flex ไม่มีฟองแชท ไม่มี postback
//  มีแค่ 3 ส่วนเรียงลงมาในหน้าเดียว ไม่มีการเปลี่ยนหน้า:
//    ส่วนที่ 0  แถบตัวตนของใบ            → QuoteIssuerProfile.tsx
//    ส่วนที่ 1  ช่องวางข้อความ            → POST /api/admin/webquote/propose  (ยังไม่เขียน DB)
//    ส่วนที่ 2  ร่างใบเสนอราคา (ฟอร์ม)    → POST /api/admin/webquote/preview  (ยังไม่เขียน DB)
//    ส่วนที่ 3  revise จากเลขที่ใบ        → POST /api/admin/webquote/revise   → เติมกลับเข้าฟอร์ม
//
//  **ส่วนที่ 2 เปิดค้างไว้ตั้งแต่โหลดหน้า แม้ยังไม่มีรายการสักบรรทัด** (2026-09-14) — การวางข้อความ
//  เป็นทางเข้า *ทางหนึ่ง* ไม่ใช่ทางเดียว แอดมินกรอกทั้งใบเองได้ ⇒ `rows` เป็น `Row[]` ที่ว่างได้
//  ไม่ใช่ `null` ที่แปลว่า "ยังไม่มีฟอร์ม"
//
//  ── ทั้งหน้ามีจุดเดียวที่เขียน DB: ปุ่ม "ยืนยัน" (2026-09-14) ────────────────────────────
//  หน้านี้เดินสองขั้น `stage`: **form → review** · ขั้น review คือ "ใบร่าง" ที่เรนเดอร์จากผลของ
//  `/preview` ล้วน ๆ ซึ่งเป็น dry-run ที่ไม่แตะฐานข้อมูล ⇒ ใบร่างที่แอดมินเห็น **ไม่มีแถวใน DB**
//  ปุ่ม "แก้ไข" จึงเป็นแค่การกลับไป `form` ไม่มีอะไรต้องล้าง และ "ยกเลิก" ไม่ต้องไปแตะใบไหน
//  "ยืนยัน" เท่านั้นที่ยิง `/drafts` (สร้างจริง) แล้วต่อด้วย `/confirm` ทีละใบจนได้เลขที่ + PDF
//
//  ที่ทำแบบนี้เพราะขั้น "ใบร่างใน DB ที่รอยืนยัน" ไม่มีใครใช้ประโยชน์: หน้านี้ทำงานจบในหนึ่ง
//  เซสชัน ไม่มีที่ให้กลับมาเปิดร่างค้างต่อ ⇒ สิ่งที่มันทิ้งไว้จริงคือแถว `draft` ที่ไม่มีวันถูก
//  ยืนยันทุกครั้งที่แอดมินเปลี่ยนใจ · ราคาที่ต้องจ่ายแทนคือ "ยืนยันแล้วล้มกลางคัน" ซึ่งจอ
//  ขั้น review รายงานตามจริงว่าออกได้กี่ใบ และใบไหนค้างเป็นร่างอยู่ในระบบ
//
//  ความกำกวมทั้งหมด (บริษัทซ้ำ · รุ่นกำกวม · รุ่นพิมพ์ผิด) ถูกเคาะในฟอร์ม **ก่อน** ยืนยัน
//  ⇒ ไม่มี state `pending_product`/`pending_company` ใน DB จากเส้นทางนี้เลย
//
//  `/confirm` เป็น endpoint เดิมของ LIFF ซึ่งตรวจสิทธิ์ด้วย `userId` ใน body ⇒ ต้องแนบ
//  `web_user_id` ที่ได้จาก /drafts ไปด้วยทุกครั้ง (ขั้น 8′)
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from './PageHeader';
import { QuoteIssuerProfile } from './QuoteIssuerProfile';
import { Button } from './Button';
import { ComboBox, type ComboOption } from './PersonComboBox';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Ban,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Eye,
  Factory,
  FilePlus2,
  FileText,
  Hash,
  Link2,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Truck,
  Wrench,
} from 'lucide-react';

const BRAND = 'var(--brand-fg)';

// ── รูปร่างข้อมูลที่ backend ส่งมา ───────────────────────────────────────────

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
}

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
  can_create_draft: boolean;
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
  default_price: number;
}

// ── ป้ายกำกับใต้ชื่อสินค้าในแต่ละแถว ────────────────────────────────────────
//  ถ้อยคำของ violation มาจาก server (buildViolationDisplay) แต่ในแถวใช้คำสั้นกว่าเพื่อไม่ให้
//  ตารางบวม — ข้อความเต็มอยู่ในกล่องสรุปด้านล่างซึ่งเป็นที่เดียวที่ต้องอ่านครบ

type TagTone = 'ok' | 'warn' | 'bad' | 'info';
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
    return `${base} ฿${money(v.min_price)}`;
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

/** หนึ่งช่องในแถบข้อมูลลูกค้า — ไอคอน + ป้าย + ค่า (ว่างแล้วบอกว่าว่าง ไม่ปล่อยเป็นช่องเปล่า) */
const CustField: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}> = ({ icon: Icon, label, value }) => (
  <div className="flex items-start gap-1.5 min-w-0">
    <Icon className="w-3 h-3 shrink-0 mt-0.5 text-slate-400" />
    <span className="text-slate-500 shrink-0">{label}</span>
    <span className={`font-semibold break-words ${value ? 'text-slate-800' : 'text-slate-400'}`}>
      {value || 'ไม่มีข้อมูล'}
    </span>
  </div>
);

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
}> = ({ effective, customerValue, overridden, hasCredit, options, onChange }) => {
  /** โหมด "พิมพ์เอง" — เป็น state ของหน้าจอ ไม่ใช่ของค่า เพราะคนกดเลือกแล้วยังไม่ได้พิมพ์อะไร */
  const [other, setOther] = useState(false);
  const custom = other || (overridden && !options.includes(effective));

  return (
    <>
      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
        <CreditCard className="w-3 h-3 shrink-0 text-slate-400" />
        <span className="text-slate-500 shrink-0">เครดิต</span>
        <select
          value={!overridden ? '' : custom ? '__other' : effective}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__other') { setOther(true); onChange(effective || customerValue); return; }
            setOther(false);
            onChange(v === '' ? null : v);
          }}
          aria-label="เครดิตของใบนี้"
          className={`h-7 pl-2 pr-6 rounded-lg border bg-card text-[11px] font-semibold text-slate-800 outline-none max-w-[10rem] ${
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
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-blue-600 text-blue-700">
              ตั้งเอง
            </span>
          </>
        )}
      </div>
      {overridden && (
        <p className="sm:col-span-2 lg:col-span-3 text-[10.5px] text-slate-500 leading-relaxed">
          ค่าจริงของลูกค้า: <span className="font-semibold">{customerValue || 'ไม่มีข้อมูล'}</span> —
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
    </>
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

/** ป้ายอ่านอย่างเดียว — ขั้นใบร่างเป็นจอ "อ่านแล้วยืนยัน" การแก้อยู่ที่ขั้นฟอร์มที่เดียว */
const DeliveryBadge: React.FC<{ quote: PreviewQuote }> = ({ quote }) => (
  <span className="flex flex-wrap items-center gap-1.5">
    <span
      className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg border ${deliveryTone(
        quote.delivery_all_in_stock,
      )}`}
    >
      {quote.delivery_all_in_stock ? (
        <CheckCircle2 className="w-3 h-3 shrink-0" />
      ) : (
        <AlertTriangle className="w-3 h-3 shrink-0" />
      )}
      กำหนดส่ง: {quote.delivery_text}
    </span>
    {(quote.delivery_type_override !== null || quote.delivery_days_override !== null) && (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-blue-600 text-blue-700">
        ตั้งเอง
      </span>
    )}
  </span>
);

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
  candidates: Candidate[];
  status: RowStatus;
  /** บรรทัดค่าบริการ (สินค้าระบบตัวเดียวของทั้งระบบ) — ชื่อแก้ได้ จำนวน/ส่วนลดถูกล็อก */
  isService?: boolean;
  /** ใบที่แถวนี้จะไปอยู่ตามผลตรวจครั้งล่าสุด — จำไว้เพื่อไม่ให้กลุ่มกระโดดระหว่างรอผลรอบใหม่ */
  company?: 'PM' | 'THT';
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const money = (v: unknown): string =>
  num(v).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

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
      candidates: cands,
      status: (cands.length > 0 ? 'ambiguous' : 'notfound') as RowStatus,
    };
  });
}

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
  const [pos, setPos] = useState<PopPos | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();

  const place = useCallback(() => {
    const el = shellRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 320);
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
  }, []);

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
  }, [open, place, hits.length, loading, failed]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (shellRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

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
                        ฿{money(h.price)}
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

// ── หน้าหลัก ─────────────────────────────────────────────────────────────────

export const QuoteRequest: React.FC = () => {
  const { token } = useAuth();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [profileReady, setProfileReady] = useState(false);
  const [spUserId, setSpUserId] = useState('');
  const onReadyChange = useCallback((v: boolean) => setProfileReady(v), []);

  // ── ส่วนที่ 1 ──
  const [text, setText] = useState('');
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState('');
  const [systemBusy, setSystemBusy] = useState(false);

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
   * ขั้นที่หน้าอยู่ · `review` = การ์ด "ใบร่าง" ซึ่งเรนเดอร์จากผลตรวจล้วน ๆ ยังไม่มีแถวใน DB
   * ⇒ เป็น state ของหน้าจอ ไม่ใช่ของข้อมูล การกลับไป `form` จึงไม่ต้องล้างอะไรทั้งสิ้น
   */
  const [stage, setStage] = useState<'form' | 'review'>('form');

  // ── ผลตรวจก่อนสร้างร่าง ──
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewAt, setPreviewAt] = useState('');
  /** ลายเซ็นของข้อมูลที่ถูกตรวจไปแล้ว — ต่างจากของปัจจุบันเมื่อไหร่ = ผลที่เห็นเก่าแล้ว */
  const [previewSig, setPreviewSig] = useState('');
  const [custOpen, setCustOpen] = useState(true);
  const [svcCfg, setSvcCfg] = useState<ServiceCfg | null>(null);

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
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [results, setResults] = useState<{ quotation_no: string; pdf_link: string }[]>([]);
  /**
   * ใบที่ถูก "สร้าง" ไปแล้วแต่ยืนยันไม่ผ่าน — ค้างเป็นร่างอยู่ในระบบจริง ๆ
   * ต้องเก็บไว้และบอกออกไป ไม่งั้นหน้าจอจะพูดว่า "ไม่ได้บันทึกอะไร" ทั้งที่บันทึกไปแล้วครึ่งทาง
   */
  const [strandedIds, setStrandedIds] = useState<string[]>([]);

  // ── ส่วนที่ 3 ──
  const [reviseNo, setReviseNo] = useState('');
  const [revising, setRevising] = useState(false);
  const [reviseError, setReviseError] = useState('');
  const [reviseFrom, setReviseFrom] = useState('');

  const selectedCustomer = customerOptions.find((c) => c.id === customerId) ?? null;

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
    setStage('form');
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
  };

  /** อ่าน error ที่ backend ส่งมาเป็นข้อความจริง ไม่ใช่ "HTTP 400" ลอย ๆ */
  const readError = async (res: Response, fallback: string) => {
    const body = await res.json().catch(() => ({}));
    return String(body?.error || fallback);
  };

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
        // ปล่อยค้างไว้ = dropdown ว่างแต่ปุ่ม "ดูใบร่าง" กดได้ แล้วใบไปโผล่ผิดผู้ติดต่อ
        setContactId((cur) => (cur !== null && list.some((c) => c.id === cur) ? cur : null));
      } catch {
        if (!cancelled) setContacts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [customerId]);

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
          // (ผู้ใช้เห็น "ยังไม่เลือก" แต่ปุ่มไปขั้นใบร่างกดได้ = ออกใบให้บริษัทที่มองไม่เห็นบนจอ)
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

  // ── ส่วนที่ 1: วางข้อความ → ร่าง ──
  const propose = async () => {
    if (!text.trim() || !spUserId) return;
    setProposing(true);
    setProposeError('');
    setSystemBusy(false);
    setConfirmError('');
    try {
      const res = await fetch('/api/admin/webquote/propose', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sp_user_id: spUserId, text }),
      });
      if (!res.ok) throw new Error(await readError(res, 'สร้างร่างไม่สำเร็จ'));
      const data: ProposeResult = await res.json();

      setWebUserId(data.web_user_id);
      setProposeMsgId(data.propose_msg_id ?? null);
      setStage('form');
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
      { key: newKey(), productTemplateId: null, model: '', name: '', quantity: '1', price: '', disc1: '', disc2: '', candidates: [], status: 'notfound' },
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
      rows.map((r) => ({
        product_template_id: r.productTemplateId,
        model: r.model,
        quantity: num(r.quantity) || 1,
        price: num(r.price) || null,
        discount_1: num(r.disc1) || 0,
        discount_2: num(r.disc2) || 0,
        // ชื่อส่งไปเฉพาะบรรทัดค่าบริการ — สินค้าจริงเอาชื่อจาก DB เสมอ (กติกาของ resolveItems)
        ...(r.isService ? { name: r.name } : {}),
      })),
    [rows],
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
        name: svcCfg.default_item_name,
        quantity: '1',
        price: String(svcCfg.default_price),
        disc1: '',
        disc2: '',
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

  const groups = useMemo(() => {
    const all = rows;
    const sumRows = (rs: Row[]) => rs.reduce((s, r) => s + (r.status === 'ok' ? rowTotal(r) : 0), 0);
    // ก่อนตรวจครั้งแรกยังไม่รู้ว่าแถวไหนไปใบไหน — resolveQuoteCompany อยู่ฝั่ง server เท่านั้น
    if (!preview) {
      return all.length === 0
        ? []
        : [{
            co: 'PM' as const,
            label: 'รายการทั้งหมด',
            rows: all,
            extras: [] as PreviewItem[],
            quote: undefined as PreviewQuote | undefined,
            subtotal: sumRows(all),
          }];
    }
    const out: {
      co: 'PM' | 'THT';
      label: string;
      rows: Row[];
      extras: PreviewItem[];
      quote: PreviewQuote | undefined;
      subtotal: number;
    }[] = [];
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
        subtotal: sumRows(rs) + ex.reduce((s, it) => s + num(it.line_total), 0),
      });
    }
    return out;
  }, [preview, rows, matched]);

  const grandTotal = groups.reduce((s, g) => s + g.subtotal, 0);
  const blockers = staleNow ? [] : (preview?.violations ?? []);

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
        tone: 'info',
        kind: 'link',
        text: it.linked_to_model ? `สินค้าพ่วงของ ${it.linked_to_model} — ระบบเพิ่มให้เอง` : 'ระบบเพิ่มให้เอง',
      });
    } else if (it.linked_to_model) {
      tags.push({ tone: 'info', kind: 'link', text: `พ่วงกับ ${it.linked_to_model}` });
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
    return hit ? itemTagsOf(hit, false) : [];
  };

  const extraTagsOf = (it: PreviewItem): RowTag[] => itemTagsOf(it, true);

  // ── ยืนยัน — จุดเดียวของทั้งหน้าที่เขียนฐานข้อมูล ───────────────────────────
  //  ลำดับคือ "สร้างร่างจริงทีเดียวทั้งชุด" แล้ว "ยืนยันทีละใบ" · แยกไปสร้างทีละบริษัทไม่ได้
  //  เพราะกฎค่าขนส่งอัตโนมัติคิดจากยอดรวมของทุกใบในกลุ่ม (applyShippingFeeToQuoteGroup)
  //  ถ้าสร้างแยก ค่าขนส่งที่ได้จะไม่ใช่ค่าเดียวกับที่พรีวิวโชว์ไว้ก่อนกด

  /** ไปขั้นใบร่างได้ไหม — ต้องมีผลตรวจที่ "สด" จริง เพราะการ์ดใบร่างเรนเดอร์จากผลตรวจล้วน ๆ */
  const canReview =
    rows.length > 0 && unresolved === 0 && customerId !== null && contactId !== null && !!spUserId &&
    !previewing && !!preview && !staleNow && preview.can_create_draft;

  /** ปุ่มที่จางอยู่เฉย ๆ โดยไม่บอกเหตุผล คือปุ่มที่ผู้ใช้สรุปว่าระบบพัง */
  const reviewBlockedBecause = (): string => {
    if (!spUserId) return 'เลือกพนักงานขายที่จะออกใบในนามก่อน';
    if (rows.length === 0) return 'ยังไม่มีรายการในใบ — เพิ่มสินค้าก่อน';
    if (unresolved > 0) return `ยังมี ${unresolved} รายการที่ยังไม่ได้เลือกสินค้า`;
    if (customerId === null || contactId === null) return 'ยังไม่ได้เลือกบริษัทและผู้ติดต่อ';
    if (previewing) return 'กำลังตรวจรายละเอียด...';
    if (!preview || staleNow) return 'ต้องตรวจรายละเอียดให้สำเร็จก่อน — กด “ตรวจใหม่”';
    return 'ติดด่านตรวจ — แก้ตามรายการด้านบนก่อน';
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

  const confirmAll = async () => {
    if (!canReview || confirming) return;
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
          // ใบนี้เกิดจากการแก้ใบเดิม ⇒ ให้หลังบ้านติด revise_from ไว้ด้วยตัวต่อสตริงของมันเอง
          revise_from: reviseFrom || undefined,
          items: itemsPayload,
          // ค่าชุดเดียวกับที่ส่งให้ /preview — ถ้าสองที่ส่งไม่เท่ากัน ใบที่ออกจะไม่ใช่ใบที่เห็น
          payment_terms_override: paymentTerms,
          delivery: deliveryPayload,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, 'ออกใบเสนอราคาไม่สำเร็จ'));
      const data = await res.json();
      const webId = String(data.web_user_id ?? webUserId);
      setWebUserId(webId);
      const created = (data.quotes ?? []) as DraftQuote[];
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
    if (!reviseNo.trim() || !spUserId) return;
    setRevising(true);
    setReviseError('');
    try {
      const res = await fetch('/api/admin/webquote/revise', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sp_user_id: spUserId, quotation_no: reviseNo }),
      });
      if (!res.ok) throw new Error(await readError(res, 'เตรียมใบแก้ไขไม่สำเร็จ'));
      const data = await res.json();
      setWebUserId(data.web_user_id);
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
          candidates: [],
          status: 'ok' as RowStatus,
          isService: it.is_manual_service === true,
        })),
      );
      // บริษัทที่เลือกไว้ต้องมีอยู่ในลิสต์ ไม่งั้น <select> โชว์ "ยังไม่เลือก" ทั้งที่ id ตั้งอยู่แล้ว
      const cid = q?.customer_id ?? null;
      setCustomerOptions(cid ? [{ id: cid, display_name: q?.company_name ?? '' }] : []);
      setCustomerId(cid);
      setContactId(q?.contact_id ?? null);
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
      setStage('form');
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
  /** อยู่ในขั้นใบร่างแล้ว — พับส่วนที่ 1/2/3 ไว้ ให้เหลือของที่ต้องอ่านก่อนกดยืนยันอย่างเดียว */
  const reviewing = stage === 'review';
  /** ออกใบไปแล้ว — ไม่มีอะไรให้ยืนยันซ้ำ เหลือแค่ลิงก์ PDF กับทางเริ่มใบใหม่ */
  const issued = results.length > 0;
  /** มีอะไรให้ล้างไหม — การ์ดร่างที่เปิดค้างไว้เปล่า ๆ ไม่ใช่ "งานที่เริ่มแล้ว" */
  const hasWork = rows.length > 0 || text.trim().length > 0 || customerId !== null || issued;

  return (
    <div className="space-y-5">
      <PageHeader icon={FilePlus2} title="ขอใบเสนอราคา" description="วางข้อความหรือกรอกเอง → เคาะในฟอร์ม → ยืนยัน">
        {hasWork && (
          <Button variant="neutral" tone="soft" icon={RotateCcw} onClick={resetAll}>
            เริ่มใหม่
          </Button>
        )}
      </PageHeader>

      {/* ── ส่วนที่ 0 — แถบตัวตนของใบ ── */}
      <QuoteIssuerProfile spUserId={spUserId} onSpUserIdChange={setSpUserId} onReadyChange={onReadyChange} />

      {/* ── ส่วนที่ 1 — ช่องพิมพ์ข้อความ · พับหายตอนขึ้นขั้นใบร่าง ── */}
      {!reviewing && (
        <div className={`bg-card border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3 ${blocked ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center gap-2">
            <FileText className="w-[18px] h-[18px]" style={{ color: BRAND }} />
            <h3 className="text-sm font-bold text-slate-800">วางข้อความขอใบเสนอราคา</h3>
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
              disabled={!text.trim() || !spUserId}
              onClick={propose}
            >
              {proposing ? 'กำลังสกัดคำสั่ง...' : 'สร้างร่าง'}
            </Button>
            {!spUserId && <span className="text-xs text-amber-700">เลือกพนักงานขายที่จะออกใบในนามก่อน</span>}
            {proposing && <span className="text-xs text-slate-400">ระบบมีเวลาสกัดสูงสุด 60 วินาที</span>}
            <p className="basis-full text-[11px] text-slate-400">
              ไม่มีข้อความก็ได้ — กรอกเองในฟอร์ม “ร่างใบเสนอราคา” ด้านล่างได้เลย
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
      )}

      {/* ── ส่วนที่ 2 — ฟอร์มร่าง ──
          เปิดค้างไว้ตั้งแต่โหลดหน้า แม้ยังไม่มีรายการสักบรรทัด เพราะการวางข้อความเป็นทางเข้า
          *ทางหนึ่ง* ไม่ใช่ทางเดียว — แอดมินกรอกทั้งใบเองได้ · ซ่อนเฉพาะตอนขึ้นขั้นใบร่างแล้ว */}
      {!reviewing && (
        <div className={`bg-card border border-slate-200 rounded-2xl shadow-sm p-4 space-y-4 ${blocked ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center gap-2">
            <FilePlus2 className="w-[18px] h-[18px]" style={{ color: BRAND }} />
            <h3 className="text-sm font-bold text-slate-800">ร่างใบเสนอราคา</h3>
          </div>

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

          {/* หัวฟอร์ม */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                บริษัท / ลูกค้า
              </label>
              {/* ช่องเดียวจบ: กดแล้วกลายเป็นช่องค้น — เลิกมี <select> คู่กับช่องค้นแยกใบ
                  ซึ่งบังคับให้พิมพ์ที่หนึ่งแล้วไปเลือกอีกที่ · โครงเดียวกับช่องเลือกชื่อแอดมิน
                  `onQueryChange` = ผู้เรียกเป็นคนค้นเอง (ยิง /api/customers/search) ⇒ ComboBox
                  ต้องไม่กรองผลซ้ำด้วยคำเดิม ไม่งั้นชื่อที่สะกดต่างจากคำค้นจะหายไปทั้งที่ server ส่งมา */}
              <ComboBox<CustomerOpt>
                value={customerOpt}
                options={customerOpts}
                onPick={(o) => {
                  setCustomerId(Number(o.id));
                  setContactId(null);
                  // เครดิตเป็นของ "บริษัทนี้" — เปลี่ยนบริษัทแล้วค่าที่ตั้งทับไว้หมดความหมาย
                  // (กติกาเดียวกับ quote-edit.html ที่เขียนเครดิตใหม่ทุกครั้งที่เปลี่ยนบริษัท)
                  setPaymentTerms(null);
                }}
                onQueryChange={setCustomerQuery}
                placeholder="— เลือกบริษัท —"
                emptyText={
                  customerQuery.trim()
                    ? `ไม่พบบริษัทที่ตรงกับ “${customerQuery.trim()}”`
                    : 'พิมพ์ชื่อหรือรหัสลูกค้าเพื่อค้นหา'
                }
                ariaLabel="บริษัท / ลูกค้า"
                searchPlaceholder="พิมพ์ชื่อหรือรหัสลูกค้าเพื่อค้นหา..."
                invalid={customerId === null && mustPick}
                busy={custSearching}
                facts={(o) => <CustomerFacts row={o.row} />}
              />
              {customerId === null && (
                <p className={`text-[11px] ${mustPick ? 'text-amber-700' : 'text-slate-500'}`}>
                  {customerOptions.length > 0
                    ? 'พบบริษัทใกล้เคียงหลายราย — ต้องเลือกก่อนไปขั้นใบร่าง'
                    : 'กดที่ช่องแล้วพิมพ์ชื่อหรือรหัสลูกค้าเพื่อค้นหา'}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">ผู้ติดต่อ</label>
              {/* ผู้ติดต่อเป็นรายชื่อในเครื่อง (โหลดมาทั้งชุดตอนเลือกบริษัท) ⇒ ไม่ส่ง onQueryChange
                  ให้ ComboBox กรองเองได้เลย · ไม่ใช้ PersonComboBox เพราะตัวนั้นบังคับเตือน
                  "ไม่มีเบอร์" ซึ่งเป็นกติกาของคนที่ไปเซ็นบน PDF ไม่ใช่ของผู้ติดต่อฝั่งลูกค้า */}
              <ComboBox
                value={contactOpt}
                options={contactOpts}
                onPick={(o) => setContactId(Number(o.id))}
                placeholder={customerId === null ? '— เลือกบริษัทก่อน —' : '— เลือกผู้ติดต่อ —'}
                emptyText="บริษัทนี้ยังไม่มีผู้ติดต่อในระบบ"
                ariaLabel="ผู้ติดต่อ"
                searchPlaceholder="พิมพ์ชื่อหรือเบอร์เพื่อค้นหา..."
                invalid={contactId === null && mustPick}
                disabled={customerId === null}
                searchText={(o) => `${o.name} ${o.phone}`}
                facts={(o) => (
                  <span className="shrink-0 text-[11px] text-slate-500 whitespace-nowrap">{o.phone || '—'}</span>
                )}
              />
              {/* ก่อนตรวจครั้งแรกยังมีแค่ค่าที่ติดมากับ candidates ซึ่งว่างได้บ่อย — พอผลตรวจมาถึง
                  แถบข้อมูลลูกค้ากับชิปกำหนดส่งของแต่ละใบเป็นของจริงกว่า จึงเลิกโชว์บรรทัดนี้
                  ไม่งั้นหน้าจอเดียวกันจะบอกเครดิตสองค่าที่ไม่ตรงกัน · ยังไม่เลือกบริษัทก็ไม่โชว์
                  เพราะ "เครดิต: —" ของลูกค้าที่ยังไม่มีตัวตน อ่านได้เป็น "ลูกค้ารายนี้ไม่มีเครดิต" */}
              {!preview && customerId !== null && (
                <p className="text-[11px] text-slate-500">
                  เครดิต:{' '}
                  <span className="font-semibold text-slate-700">
                    {selectedCustomer?.payment_terms || selectedCustomer?.customer_payment_terms || '—'}
                  </span>
                  <span className="text-slate-300 mx-1.5">·</span>
                  เงื่อนไขจัดส่ง: <span className="text-slate-600">ระบบคำนวณให้ตอนตรวจรายละเอียด</span>
                </p>
              )}
            </div>
          </div>

          {/* ── ข้อมูลลูกค้าที่จะถูกบันทึกลงใบ — พับได้ เพราะคนดูซ้ำแค่ตอนสงสัย ── */}
          {preview && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
              <button
                type="button"
                onClick={() => setCustOpen((v) => !v)}
                aria-expanded={custOpen}
                /* แถบทั้งแถบคือปุ่ม — ถ้าชี้แล้วไม่มีอะไรขยับ คนจะไม่รู้ว่ากดตรงนี้ได้ */
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <Building2 className="w-3.5 h-3.5 shrink-0" style={{ color: BRAND }} />
                ข้อมูลลูกค้าที่จะถูกบันทึกลงใบ
                {custOpen ? (
                  <ChevronUp className="w-3.5 h-3.5 ml-auto shrink-0" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 ml-auto shrink-0" />
                )}
              </button>
              {custOpen && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5 px-3 pb-3 text-[11px]">
                  <CustField icon={Hash} label="Ref" value={preview.customer.reference} />
                  <CustField icon={Receipt} label="เลขเสียภาษี" value={preview.customer.tax_id} />
                  <CreditField
                    effective={paymentTerms ?? preview.customer.payment_terms}
                    customerValue={preview.customer.customer_payment_terms}
                    overridden={paymentTerms !== null}
                    hasCredit={preview.customer.has_credit_terms}
                    options={paymentTermOpts}
                    onChange={setPaymentTerms}
                  />
                  <CustField icon={Phone} label="โทร" value={preview.customer.contact_phone} />
                  <CustField icon={Mail} label="อีเมล" value={preview.customer.contact_email} />
                  <CustField icon={MapPin} label="ที่อยู่" value={preview.customer.address} />
                </div>
              )}
            </div>
          )}

          {/* ── ตารางสินค้า แยกกลุ่มตาม "ใบที่จะออกจริง" ──
              ก่อนตรวจครั้งแรกยังไม่รู้ว่าแถวไหนไปใบไหน (resolveQuoteCompany อยู่ฝั่ง server)
              จึงรวมเป็นกลุ่มเดียวไว้ก่อน แล้วค่อยแตกเป็น PM/THT เมื่อผลตรวจกลับมา */}
          {groups.map((g) => (
            <div key={g.co} className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
                <Factory className="w-3.5 h-3.5 shrink-0" style={{ color: BRAND }} />
                <span className="text-xs font-bold text-slate-800">{g.label}</span>
                <span className="text-[11px] text-slate-500">
                  {g.rows.length + g.extras.length} รายการ
                </span>
                {/* กำหนดส่งไม่อยู่ตรงนี้แล้ว — ย้ายลงไปอยู่แถวเดียวกับยอดรวมท้ายการ์ด
                    เพราะมันเป็นเงื่อนไขของทั้งใบ และตอนนี้แก้ได้ (2026-09-14) */}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                      <th className="text-left py-2 pl-3 w-8">#</th>
                      <th className="text-left py-2">รายการ</th>
                      <th className="text-right py-2 w-20">จำนวน</th>
                      <th className="text-right py-2 w-28">ราคา/หน่วย</th>
                      <th className="text-right py-2 w-20">ลด 1 %</th>
                      <th className="text-right py-2 w-20">ลด 2 %</th>
                      <th className="text-right py-2 w-28">รวม</th>
                      <th className="w-10 pr-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {g.rows.map((r, i) => {
                      const hit = matched.byRow.get(r.key) ?? null;
                      const vios = staleNow ? [] : (hit?.violations ?? []);
                      const bad = vios.length > 0;
                      return (
                        <tr
                          key={r.key}
                          className={
                            bad
                              ? 'bg-red-50/60 border-l-[3px] border-l-red-500'
                              : r.status === 'notfound'
                                ? 'bg-red-50/60'
                                : r.status === 'ambiguous'
                                  ? 'bg-amber-50/60'
                                  : ''
                          }
                        >
                          <td className="py-2 pl-3 text-xs text-slate-400 align-top pt-4">{i + 1}</td>
                          <td className="py-2 pr-3 align-top">
                            {r.isService ? (
                              <div className="space-y-1 pt-1">
                                <input
                                  value={r.name}
                                  onChange={(e) => patchRow(r.key, { name: e.target.value })}
                                  placeholder="ชื่อรายการที่จะขึ้นในใบ เช่น ค่าติดตั้งหน้างาน"
                                  aria-label="ชื่อรายการค่าบริการ"
                                  className="w-full max-w-xs h-9 px-2.5 rounded-lg border border-slate-200 bg-card text-xs text-slate-800 outline-none"
                                />
                                <p className="text-[11px] text-slate-400">
                                  {r.model} · {svcCfg?.internal_reference} · {svcCfg?.odoo_name} (Odoo)
                                </p>
                              </div>
                            ) : r.status === 'ok' ? (
                              <div className="pt-1.5">
                                <p className="font-semibold text-slate-800 text-sm">{r.model}</p>
                                <p className="text-[11px] text-slate-500 line-clamp-1">{r.name}</p>
                              </div>
                            ) : r.status === 'ambiguous' ? (
                              // คำเตือนอยู่ "ใต้" ตัวเลือก เหมือนแถวที่หาสินค้าไม่เจอ —
                              // ของที่ต้องลงมือทำมาก่อน คำอธิบายว่าทำไมตามหลัง
                              <div className="space-y-1">
                                <select
                                  defaultValue=""
                                  onChange={(e) => {
                                    const c = r.candidates.find(
                                      (x) => String(x.product_template_id) === e.target.value,
                                    );
                                    if (c) pickCandidate(r.key, c);
                                  }}
                                  className="w-full h-9 px-2.5 rounded-lg border border-amber-400 bg-card text-xs outline-none"
                                >
                                  <option value="">— เลือกรุ่น —</option>
                                  {r.candidates.map((c) => (
                                    <option key={c.product_template_id} value={c.product_template_id}>
                                      {c.model} · ฿{money(c.sales_price)} · คงเหลือ{' '}
                                      {money(c.quantity_on_hand_unreserved)}
                                    </option>
                                  ))}
                                </select>
                                <p className="text-[11px] text-amber-800">
                                  “{r.model}” ตรงกับหลายรุ่น — เลือกรุ่นที่ถูกต้อง
                                </p>
                              </div>
                            ) : (
                              // คำเตือนอยู่ "ใต้" ช่องค้น ไม่ใช่เหนือ — ของที่ต้องลงมือทำมาก่อน
                              // คำอธิบายว่าทำไมถึงต้องทำ เพราะสายตาไล่จากบนลงล่างแล้วหยุดที่ช่องกรอก
                              <div className="space-y-1">
                                <ProductSearchBox
                                  initialQuery={r.model}
                                  placeholder="ค้นหารุ่นที่ถูกต้อง..."
                                  tone="danger"
                                  needQty={num(r.quantity) || 1}
                                  onPick={(h) =>
                                    patchRow(r.key, {
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
                              tags={rowTagsOf(r, hit)}
                              dim={staleNow}
                              checking={previewing && !preview}
                            />
                          </td>
                          <td className="py-2 align-top">
                            <input
                              value={r.quantity}
                              onChange={(e) => patchRow(r.key, { quantity: e.target.value })}
                              inputMode="decimal"
                              aria-label="จำนวน"
                              disabled={r.isService}
                              className="w-full h-9 px-2 rounded-lg border border-slate-200 bg-card text-xs text-right outline-none disabled:bg-slate-100"
                            />
                          </td>
                          <td className="py-2 pl-2 align-top">
                            <input
                              value={r.price}
                              onChange={(e) => patchRow(r.key, { price: e.target.value })}
                              inputMode="decimal"
                              placeholder="ราคาตั้ง"
                              aria-label="ราคาต่อหน่วย"
                              disabled={r.status !== 'ok'}
                              className="w-full h-9 px-2 rounded-lg border border-slate-200 bg-card text-xs text-right outline-none disabled:bg-slate-100"
                            />
                          </td>
                          <td className="py-2 pl-2 align-top">
                            <input
                              value={r.disc1}
                              onChange={(e) => patchRow(r.key, { disc1: e.target.value })}
                              inputMode="decimal"
                              aria-label="ส่วนลดที่ 1"
                              disabled={r.status !== 'ok' || r.isService}
                              className="w-full h-9 px-2 rounded-lg border border-slate-200 bg-card text-xs text-right outline-none disabled:bg-slate-100"
                            />
                          </td>
                          <td className="py-2 pl-2 align-top">
                            <input
                              value={r.disc2}
                              onChange={(e) => patchRow(r.key, { disc2: e.target.value })}
                              inputMode="decimal"
                              aria-label="ส่วนลดที่ 2"
                              disabled={r.status !== 'ok' || r.isService}
                              className="w-full h-9 px-2 rounded-lg border border-slate-200 bg-card text-xs text-right outline-none disabled:bg-slate-100"
                            />
                          </td>
                          <td className="py-2 pl-2 text-right align-top pt-4 tabular-nums text-slate-800 font-semibold">
                            {r.status === 'ok' ? money(rowTotal(r)) : '—'}
                          </td>
                          <td className="py-2 pr-3 text-right align-top pt-3">
                            <button
                              onClick={() => removeRow(r.key)}
                              className="w-7 h-7 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center"
                              aria-label="ลบแถว"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                    {/* บรรทัดที่ระบบเติมให้เอง (สินค้าพ่วง · ค่าขนส่งอัตโนมัติ) — แก้ในฟอร์มนี้ไม่ได้
                        เพราะเจ้าของมันคือกฎฝั่ง server แต่ต้องเห็น ไม่งั้นยอดรวมจะอธิบายไม่ได้ */}
                    {g.extras.map((it, i) => (
                      <tr key={`x-${g.co}-${i}`} className="bg-slate-50/60">
                        <td className="py-2 pl-3 text-xs text-slate-400 align-top pt-4">
                          {g.rows.length + i + 1}
                        </td>
                        <td className="py-2 pr-3 align-top">
                          {/* บรรทัดค่าบริการใช้ model ร่วมกันทั้งระบบ (N/A) ⇒ ตัวที่คนอ่านต้องเห็นคือ
                              "ชื่อรายการ" ส่วนรหัสสินค้าเป็นแค่ที่มา — สลับลำดับให้ตรงกับแถวที่แก้ได้ */}
                          {it.is_shipping_fee ? (
                            <div className="pt-1.5">
                              <p className="font-semibold text-slate-800 text-sm">{it.name}</p>
                              <p className="text-[11px] text-slate-400">
                                {it.model} · {svcCfg?.internal_reference} · {svcCfg?.odoo_name} (Odoo)
                              </p>
                            </div>
                          ) : (
                            <div className="pt-1.5">
                              <p className="font-semibold text-slate-800 text-sm">{it.model}</p>
                              <p className="text-[11px] text-slate-500 line-clamp-1">{it.name}</p>
                            </div>
                          )}
                          <RowTags tags={extraTagsOf(it)} dim={staleNow} checking={false} />
                        </td>
                        <td className="py-2 pl-2 text-right align-top pt-4 text-xs text-slate-500 tabular-nums">
                          {money(it.quantity)}
                        </td>
                        <td className="py-2 pl-2 text-right align-top pt-4 text-xs text-slate-500 tabular-nums">
                          {money(it.price)}
                        </td>
                        <td className="py-2 pl-2 text-right align-top pt-4 text-xs text-slate-400 tabular-nums">
                          {it.discount_1 ? money(it.discount_1) : '—'}
                        </td>
                        <td className="py-2 pl-2 text-right align-top pt-4 text-xs text-slate-400 tabular-nums">
                          {it.discount_2 ? money(it.discount_2) : '—'}
                        </td>
                        <td className="py-2 pl-2 text-right align-top pt-4 tabular-nums text-slate-800 font-semibold">
                          {money(it.line_total)}
                        </td>
                        <td className="py-2 pr-3"></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* แถวท้ายการ์ด: กำหนดส่ง (ชิดซ้าย แก้ได้) คู่กับยอดรวมของใบนี้ (ชิดขวา)
                  จอแคบแล้ว flex-wrap พาชุดกำหนดส่งขึ้นบรรทัดบน ยอดรวมตกลงบรรทัดล่างชิดขวา */}
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-50 border-t border-slate-200">
                {previewing ? (
                  <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg border border-slate-200 bg-card text-slate-500">
                    <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                    กำลังคำนวณกำหนดส่ง...
                  </span>
                ) : g.quote && preview ? (
                  <DeliveryStrip
                    quote={g.quote}
                    types={preview.delivery_types}
                    ov={deliveryOv[g.quote.quote_company]}
                    onChange={(v) =>
                      setDeliveryOv((cur) => {
                        const next = { ...cur };
                        if (v) next[g.quote!.quote_company] = v;
                        else delete next[g.quote!.quote_company];
                        return next;
                      })
                    }
                  />
                ) : (
                  <span className="text-[11px] px-2 py-0.5 rounded-lg border border-slate-200 bg-card text-slate-500">
                    กำหนดส่ง: ยังไม่ได้ตรวจ
                  </span>
                )}
                <span className="ml-auto text-[11px] text-slate-500">รวมใบนี้ (ก่อน VAT)</span>
                <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                  ฿{money(g.subtotal)}
                </span>
              </div>
            </div>
          ))}

          {/* ว่างเปล่าต้องบอกว่าทำไมถึงว่าง (docs/design.md §8) — การ์ดนี้เปิดค้างไว้ตั้งแต่หน้าโหลด
              คนที่เพิ่งเข้ามาจึงต้องอ่านออกทันทีว่ามีสองทางเข้า ไม่ใช่เห็นกล่องเปล่าแล้วเดาว่าพัง */}
          {groups.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
              <FileText className="w-5 h-5 mx-auto text-slate-400" />
              <p className="mt-1.5 text-xs font-semibold text-slate-600">ยังไม่มีรายการในใบ</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                เพิ่มสินค้าจากช่องด้านล่างได้เลย — หรือวางข้อความที่ลูกค้าส่งมาไว้ด้านบน แล้วกด “สร้างร่าง” ให้ระบบเคาะรายการให้
              </p>
            </div>
          )}

          {/* แถบเพิ่มสินค้า — พิมพ์แล้ว Enter ได้แถวที่เคาะเสร็จทันที โฟกัสค้างไว้ให้พิมพ์ตัวถัดไปต่อ
              ปุ่ม "แถวเปล่า" คือของเดิม เก็บไว้สำหรับกรณีที่ยังไม่รู้ว่าจะใส่รุ่นอะไร */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-2">
            <Plus className="w-4 h-4 shrink-0" style={{ color: BRAND }} />
            <div className="flex-1 min-w-[180px]">
              <ProductSearchBox
                placeholder="เพิ่มสินค้า — พิมพ์รุ่นหรือชื่อ แล้วกด Enter"
                tone="plain"
                clearOnPick
                onPick={addProductRow}
              />
            </div>
            <Button variant="neutral" tone="soft" onClick={addRow}>
              แถวเปล่า
            </Button>
            {justAdded && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                เพิ่ม {justAdded} แล้ว
              </span>
            )}
            <p className="basis-full text-[11px] text-slate-400">
              ระบบวางแถวลงใบของบริษัทผู้ผลิตให้เอง — ไม่ต้องเลือกว่าจะไปใบไหน
            </p>

            {/* ── ค่าบริการ: มีได้บรรทัดเดียวต่อการเสนอราคา (ข้อตกลง 2026-09-14) ──
                ใช้สินค้าระบบตัวเดียวกับกฎค่าขนส่งอัตโนมัติ ⇒ ปุ่มต้องปิดตัวเองเมื่อบรรทัดนั้น
                มีอยู่แล้ว ไม่ว่าจะมาจากกฎหรือจากที่แอดมินกดเพิ่ม */}
            <div className="basis-full border-t border-slate-200 pt-2 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                icon={Wrench}
                disabled={!svcCfg || !!serviceRow || autoFeeShown}
                onClick={addServiceRow}
              >
                เพิ่มค่าบริการ
              </Button>
              <span className="flex-1 min-w-[200px] text-[11px] text-slate-400">
                {!svcCfg
                  ? 'ยังอ่านค่าตั้งต้นของค่าบริการไม่ได้ — ลองรีเฟรชหน้า'
                  : autoFeeShown
                    ? 'ระบบเติมบรรทัดค่าขนส่งให้แล้ว — ค่าบริการมีได้บรรทัดเดียว จึงเพิ่มอีกไม่ได้'
                    : serviceRow
                      ? 'มีบรรทัดค่าบริการแล้ว 1 บรรทัด — แก้ชื่อและราคาได้ที่แถวนั้น ลบก่อนจึงเพิ่มใหม่ได้'
                      : `ใช้สินค้าระบบ ${svcCfg.internal_reference} (${svcCfg.odoo_name}) · ตั้งชื่อรายการเองได้ · มีได้บรรทัดเดียว และอยู่ในใบ Primus (PM) เสมอ`}
              </span>
            </div>
          </div>

          {groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="ml-auto text-sm">
                <span className="text-slate-500">ยอดรวมทุกใบ (ก่อน VAT): </span>
                <span className="font-extrabold text-slate-900 tabular-nums">฿{money(grandTotal)}</span>
              </div>
            </div>
          )}

          {/* ── แถบสถานะการตรวจ — บอกว่าสิ่งที่เห็นตรงกับข้อมูลล่าสุดแค่ไหน ── */}
          {previewError ? (
            <div className="flex flex-wrap items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span className="flex-1 min-w-[180px]">
                ตรวจรายละเอียดไม่สำเร็จ — {previewError} · ข้อมูลในฟอร์มยังอยู่ครบ กดตรวจใหม่ได้เลย
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
                ฟอร์มถูกแก้หลังตรวจครั้งล่าสุด — สต็อกและกฎที่เห็นอาจไม่ใช่ของล่าสุด
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
          ) : null}

          {unresolved > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>ยังมี {unresolved} รายการที่ยังไม่ได้เลือกสินค้า — เคาะให้ครบก่อนไปขั้นใบร่าง</span>
            </div>
          )}

          {/* ติดกฎ = สร้างร่างไม่ได้เลย (createDraft ทิ้งทั้งใบ) ⇒ ต้องเห็นตั้งแต่ยังไม่กด */}
          {blockers.length > 0 && !staleNow && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-xs text-red-700">
              <p className="flex items-center gap-2 font-bold">
                <Ban className="w-4 h-4 shrink-0" />
                ออกใบนี้ไม่ได้ — ติดด่านตรวจ {blockers.length} ข้อ
              </p>
              <ul className="mt-1 pl-6 list-disc space-y-0.5">
                {blockers.map((v, i) => (
                  <li key={`${v.type}-${v.model}-${i}`}>{v.display_message}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="md" icon={ArrowRight} disabled={!canReview} onClick={() => setStage('review')}>
              ดูใบร่าง
            </Button>
            {/* ปุ่มนี้ไม่ได้เขียนอะไรลงฐาน มันพาไปหน้าตรวจก่อนยืนยันเท่านั้น — ปุ่มที่จางอยู่เฉย ๆ
                โดยไม่บอกว่าติดอะไร คือปุ่มที่ผู้ใช้สรุปเองว่าระบบพัง */}
            {!canReview && <span className="text-xs text-amber-700">{reviewBlockedBecause()}</span>}
          </div>
        </div>
      )}

      {/* ── ขั้นใบร่าง — เรนเดอร์จากผลตรวจล้วน ๆ ยังไม่มีแถวไหนอยู่ในฐานข้อมูล ──
          ใช้ข้อมูลชุดเดียวกับที่ฟอร์มโชว์ (preview) ⇒ สิ่งที่เห็นตรงนี้คือสิ่งที่จะถูกบันทึกจริง
          ไม่ใช่ "ใบที่บันทึกไปแล้ว" — คำว่าบันทึกเกิดขึ้นครั้งแรกตอนกด "ยืนยัน" เท่านั้น */}
      {reviewing && preview && (
        <div className="space-y-4">
          {reviseFrom && (
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-600">
              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
              แก้ไขจากใบเลขที่ <span className="font-semibold text-slate-800">{reviseFrom}</span>
            </div>
          )}

          {/* ข้อมูลลูกค้าที่จะถูกบันทึกลงใบ — ขั้นนี้กางไว้เสมอ (ต่างจากในฟอร์มที่พับได้)
              เพราะนี่คือจอสุดท้ายก่อนออกใบจริง ของที่ต้องตรวจห้ามอยู่หลังการกดเพิ่มอีกครั้ง */}
          <div className="bg-card border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Building2 className="w-[18px] h-[18px] shrink-0" style={{ color: BRAND }} />
              <h3 className="text-sm font-bold text-slate-800">{preview.customer.display_name}</h3>
              <span className="text-xs text-slate-500">{preview.customer.contact_name}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5 text-[11px]">
              <CustField icon={Hash} label="Ref" value={preview.customer.reference} />
              <CustField icon={Receipt} label="เลขเสียภาษี" value={preview.customer.tax_id} />
              {/* ขั้นใบร่างอ่านอย่างเดียว — แต่ต้องเห็นว่าเครดิตนี้ "ตั้งเอง" ไม่ใช่ของลูกค้า
                  ไม่งั้นคนกดยืนยันจะอ่านค่าที่ถูกทับว่าเป็นข้อมูลจริงจาก Odoo */}
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <CustField icon={CreditCard} label="เครดิต" value={preview.customer.payment_terms} />
                {preview.customer.payment_terms_overridden && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-blue-600 text-blue-700">
                    ตั้งเอง (ของลูกค้า: {preview.customer.customer_payment_terms || 'ไม่มีข้อมูล'})
                  </span>
                )}
              </div>
              <CustField icon={Phone} label="โทร" value={preview.customer.contact_phone} />
              <CustField icon={Mail} label="อีเมล" value={preview.customer.contact_email} />
              <CustField icon={MapPin} label="ที่อยู่" value={preview.customer.address} />
            </div>
          </div>

          {preview.quotes.map((q) => (
            <div key={q.quote_company} className="bg-card border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Factory className="w-[18px] h-[18px] shrink-0" style={{ color: BRAND }} />
                <h3 className="text-sm font-bold text-slate-800">ใบร่าง ({q.quote_company})</h3>
                <span className="text-xs text-slate-500">{q.company_label}</span>
                {/* กำหนดส่งย้ายลงไปอยู่แถวยอดรวมเหมือนขั้นฟอร์ม — ตำแหน่งเดียวกันทั้งสองขั้น
                    แต่ขั้นนี้อ่านอย่างเดียว การแก้อยู่ที่ขั้นฟอร์มที่เดียว (ปุ่ม "แก้ไข") */}
              </div>

              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                      <th className="text-left py-2 w-8">#</th>
                      <th className="text-left py-2">รายการ</th>
                      <th className="text-right py-2 w-20">จำนวน</th>
                      <th className="text-right py-2 w-28">ราคา/หน่วย</th>
                      <th className="text-right py-2 w-20">ลด 1 %</th>
                      <th className="text-right py-2 w-20">ลด 2 %</th>
                      <th className="text-right py-2 w-28">รวม</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {q.items.map((it, idx) => (
                      <tr key={`${q.quote_company}-${it.model}-${idx}`}>
                        <td className="py-2 text-xs text-slate-400 align-top pt-3">{idx + 1}</td>
                        <td className="py-2 pr-3 align-top">
                          {/* ค่าบริการ/ค่าขนส่งใช้รหัสสินค้าร่วมกันทั้งระบบ ⇒ ตัวที่คนต้องอ่านคือ
                              "ชื่อรายการ" ส่วนรหัสเป็นแค่ที่มา — ลำดับเดียวกับตารางในฟอร์ม */}
                          {it.is_shipping_fee ? (
                            <>
                              <p className="font-semibold text-slate-800 text-sm">{it.name}</p>
                              <p className="text-[11px] text-slate-400">{it.model}</p>
                            </>
                          ) : (
                            <>
                              <p className="font-semibold text-slate-800 text-sm">{it.model}</p>
                              <p className="text-[11px] text-slate-500 line-clamp-1">{it.name}</p>
                            </>
                          )}
                          <RowTags tags={itemTagsOf(it, false, true)} dim={false} checking={false} />
                        </td>
                        <td className="py-2 pl-2 text-right align-top pt-3 tabular-nums text-slate-600">
                          {money(it.quantity)}
                        </td>
                        <td className="py-2 pl-2 text-right align-top pt-3 tabular-nums text-slate-600">
                          {money(it.price)}
                        </td>
                        <td className="py-2 pl-2 text-right align-top pt-3 tabular-nums text-slate-500">
                          {it.discount_1 ? money(it.discount_1) : '—'}
                        </td>
                        <td className="py-2 pl-2 text-right align-top pt-3 tabular-nums text-slate-500">
                          {it.discount_2 ? money(it.discount_2) : '—'}
                        </td>
                        <td className="py-2 pl-2 text-right align-top pt-3 tabular-nums font-semibold text-slate-800">
                          {money(it.line_total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200">
                <DeliveryBadge quote={q} />
                <span className="ml-auto text-[11px] text-slate-500">รวมใบนี้ (ก่อน VAT)</span>
                <span className="text-sm font-extrabold text-slate-900 tabular-nums">฿{money(q.subtotal)}</span>
              </div>
            </div>
          ))}

          {/* ใบเดียวไม่ต้องมียอดรวมสองชั้น — บรรทัด "รวมใบนี้" ข้างบนก็คือเลขเดียวกัน */}
          {preview.quotes.length > 1 && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="ml-auto text-sm">
                <span className="text-slate-500">ยอดรวมทุกใบ (ก่อน VAT): </span>
                <span className="font-extrabold text-slate-900 tabular-nums">฿{money(preview.grand_total)}</span>
              </div>
            </div>
          )}

          {/* คำว่า "ใบร่าง" ชวนให้เข้าใจว่าระบบเก็บไว้ให้แล้ว — ต้องพูดตรงนี้ว่ายังไม่ได้เก็บ */}
          {!issued && (
            <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-600">
              <FileText className="w-4 h-4 shrink-0 mt-px" />
              <span>ใบร่างนี้ยังไม่ถูกบันทึกลงระบบ — กด “ยืนยัน” เมื่อไหร่จึงจะออกเลขที่และบันทึกจริง</span>
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

          <div className="flex flex-wrap items-center justify-end gap-2">
            {issued ? (
              <Button variant="primary" size="md" icon={FilePlus2} onClick={resetAll}>
                เริ่มใบใหม่
              </Button>
            ) : (
              <>
                <Button variant="neutral" tone="soft" icon={Pencil} disabled={confirming} onClick={() => setStage('form')}>
                  แก้ไข
                </Button>
                <Button variant="danger" tone="soft" icon={Ban} disabled={confirming} onClick={resetAll}>
                  ยกเลิก
                </Button>
                <Button
                  variant="primary"
                  icon={CheckCircle2}
                  busy={confirming}
                  disabled={!canReview || strandedIds.length > 0}
                  onClick={confirmAll}
                >
                  {confirming ? 'กำลังออกใบ...' : 'ยืนยัน'}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── ส่วนที่ 3 — revise · พับหายตอนขึ้นขั้นใบร่าง เหมือนส่วนที่ 1 ── */}
      {!reviewing && (
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
              disabled={!reviseNo.trim() || !spUserId}
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
      )}
    </div>
  );
};
