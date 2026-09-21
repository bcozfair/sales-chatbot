import { pool, withTransaction, type DbExecutor } from '../config/db.js';
// type-only โดยตั้งใจ — เหตุผลอยู่ที่หัวข้อ "ชั้นเดียวกันนี้ตั้งค่าต่อ role ได้แล้ว" ข้างล่าง
import type { PermissionMode } from '../config/capabilities.js';
import { getCustomerByDisplayName, getCustomerById, getFirstContact, getCompanyAddressRows, getContactById, resolveCustomerSalesTeam } from '../db/repositories.js';
import {
  findCustomerCandidates,
  findContactCandidates,
  findCustomerByContactName,
  formatLineLabel,
  cleanContactName,
  splitCustomerContact,
  dedupeIdenticalCompanies,
  buildCompanyOptionLabel
} from './customerService.js';
import { 
  createListFlexMessage, 
  createUnregisteredCustomerFlex
} from '../utils/flexTemplates.js';
import { expandOptionalProducts, checkStockRules, StockViolation } from './productService.js';
import { sumLineTotals, calcNetPrice } from '../utils/pricing.js';
import { validateProductPriceWithPromotions } from '../utils/promotionValidator.js';
import { buildThaiAddress } from '../utils/address.js';
import { resolveDeliveryTerms, type DeliveryTypeKey } from '../utils/deliveryTerms.js';
import { isBlacklisted } from './blacklistService.js';
import { checkCreditHold, type CreditHoldResult } from './creditHoldService.js';
import { getIssuerSnapshot } from './webIdentity.js';
import { thaiDateDMY, thaiYearMonth } from '../utils/thaiTime.js';
import {
  loadQuotationRules,
  resolveQuotationRule,
  resolveDeliveryOutOfStockDays,
  loadProductBlockRules,
  findBlockingRule,
  blockWarnText,
  findCompanyRule,
  normalizeProductScope
} from './rules/index.js';

export type ValidationStage = 'draft' | 'save' | 'confirm';

export interface Violation {
  type: 'BLOCKED' | 'OUT_OF_STOCK' | 'MOQ_VIOLATION' | 'MIN_PRICE_VIOLATION' | 'CUSTOMER_BLACKLISTED' | 'CUSTOMER_CREDIT_HOLD' | 'SYSTEM_ERROR';
  model: string;
  display_message: string;
  warn_msg?: string;
  is_optional?: boolean;
  linked_to_model?: string;
  // เฉพาะชนิด (คงไว้เผื่อผู้ใช้)
  price?: number;
  min_price?: number;
  min_order_qty?: number;
  qty?: number;
  quantity_on_hand_unreserved?: number;
  last_order_at?: string | null;
  dormant_months?: number;
}

/** สร้างข้อความพร้อมโชว์จาก violation — ถ้อยคำเดียวของทั้งระบบ (server เป็น source of truth) */
export function buildViolationDisplay(v: Omit<Violation, 'display_message'>): string {
  const model = v.model || '-';
  const optionalNote = v.is_optional && v.linked_to_model ? ` (สินค้าเสริมของ ${v.linked_to_model})` : '';
  switch (v.type) {
    // ทรงเดียวกับ MOQ: หัวข้อ + รหัสสินค้า + เหตุผลที่แอดมินกรอก
    // ห้ามพิมพ์ scope ของกฎ (production > brand > series) ให้เซลล์เห็น — เป็นเรื่องภายใน
    case 'BLOCKED': {
      const detail = v.warn_msg ? `: ${v.warn_msg}` : ' กรุณาติดต่อแอดมิน';
      return `❌ ระงับการเสนอราคา รายการ ${model}${optionalNote}${detail}`;
    }
    case 'OUT_OF_STOCK': {
      const detail = v.warn_msg ? `: ${v.warn_msg}` : '';
      return `📦 ระงับเมื่อสต็อกไม่พอ รายการ ${model}${optionalNote}${detail}`;
    }
    case 'MOQ_VIOLATION': {
      const detail = v.warn_msg
        ? `: ${v.warn_msg}`
        : ` (สั่งขั้นต่ำ ${v.min_order_qty ?? '-'} ชิ้น, ใส่มา ${v.qty ?? '-'} ชิ้น)`;
      return `⬇️ จำนวนไม่ถึงขั้นต่ำ รายการ ${model}${detail}`;
    }
    case 'MIN_PRICE_VIOLATION': {
      const price = Number(v.price ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const minPrice = Number(v.min_price ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `💰 ห้ามขายต่ำกว่าราคาขั้นต่ำ รายการ ${model} (ราคาหลังลด ฿${price} < ขั้นต่ำ ฿${minPrice})`;
    }
    // ไม่บอกเหตุผลที่แอดมินกรอกไว้ และไม่บอกว่าติดระดับบริษัทหรือระดับผู้ติดต่อ — เซลล์ต้องไปถามแอดมิน
    case 'CUSTOMER_BLACKLISTED':
      return '🚫 บริษัท/ผู้ติดต่อ รายนี้ถูกระงับการเสนอราคา กรุณาติดต่อแอดมิน';
    // ตรงข้ามกับ blacklist: เคสนี้ต้องบอกวันที่ซื้อล่าสุด เพราะเซลล์ต้องเอาไปคุยกับแอดมินต่อ
    // ต้องพูดว่า "ที่ออกบิล" ให้ชัด — ใบที่ยังไม่วางบิล (invoice_status='no') ไม่นับตั้งแต่
    // 2026-08-25 ถ้าไม่บอก เซลล์จะงงว่าเพิ่งมีใบเมื่อเดือนก่อนแล้วทำไมยังโดนบล็อก
    case 'CUSTOMER_CREDIT_HOLD': {
      const months = v.dormant_months ?? 12;
      const since = v.last_order_at ? thaiDateDMY(new Date(v.last_order_at)) : null;
      const when = since ? `ตั้งแต่ ${since} ` : '';
      return `⛔ บริษัทนี้ไม่มีคำสั่งซื้อที่ออกบิล ${when}(เกิน ${months} เดือน) กรุณาติดต่อแอดมินเพื่อตรวจสอบเครดิตก่อน`;
    }
    case 'SYSTEM_ERROR':
      return '⚠️ ตรวจสอบกฎไม่สำเร็จ กรุณาลองใหม่หรือติดต่อแอดมิน';
    default:
      return v.warn_msg || '';
  }
}

/** violation สำเร็จรูปสำหรับด่านที่อยู่นอก validateQuotationItems — ถ้อยคำต้องมาจากที่เดียวกัน */
export const blacklistViolation = (): Violation => {
  const v: Omit<Violation, 'display_message'> = { type: 'CUSTOMER_BLACKLISTED', model: '-' };
  return { ...v, display_message: buildViolationDisplay(v) };
};

export const creditHoldViolation = (result: CreditHoldResult): Violation => {
  const v: Omit<Violation, 'display_message'> = {
    type: 'CUSTOMER_CREDIT_HOLD',
    model: '-',
    last_order_at: result.last_order_at ? result.last_order_at.toISOString() : null,
    dormant_months: result.dormant_months,
  };
  return { ...v, display_message: buildViolationDisplay(v) };
};

export const systemErrorViolation = (): Violation => {
  const v: Omit<Violation, 'display_message'> = { type: 'SYSTEM_ERROR', model: '-' };
  return { ...v, display_message: buildViolationDisplay(v) };
};

// ─────────────────────────────────────────────────────────────────────────────
//  การ "ทะลุด่านตรวจ" ของหน้าเว็บขอใบเสนอราคา (2026-09-15)
//
//  เจ้าของสั่งว่าหน้าเว็บต้องออกใบได้แม้ติดกฎ **แต่คำเตือนต้องอยู่ครบเหมือนเดิม** และต้องมี
//  โมดัลให้ยืนยันอีกชั้น ⇒ สามฟังก์ชันข้างล่างคือกติกาเดียวของทั้งระบบว่า "ข้อไหนทะลุได้"
//  และ "รับทราบข้อไหนไปแล้ว" — ห้ามเขียนเงื่อนไขซ้ำที่ endpoint ไหนอีก
//
//  ⚠️ การปลดล็อก **ผูกกับใบ ไม่ใช่กับ endpoint** เพราะ `PUT /api/quotation/:id` กับ
//     `POST /api/quotation/:id/confirm` เป็นของที่ LIFF ใช้ร่วมกันอยู่ ถ้าไปปลดที่ endpoint
//     ใบจาก LINE จะทะลุกฎตามไปด้วยโดยไม่มีใครรู้ · ตัวปลดคือคอลัมน์ `quotations.rule_overrides`
//     ซึ่งมีค่าเฉพาะใบที่คนกดรับทราบไว้แล้ว (ใบจาก LINE เป็น NULL เสมอ)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ชื่อเรียกของกฎหนึ่งข้อบนใบหนึ่งใบ — ใช้เทียบว่า "ข้อที่เพิ่งเจอ อยู่ในรายการที่รับทราบไว้ไหม"
 *
 * `type|model` เท่านั้น ไม่รวมตัวเลข (ราคา/จำนวน) โดยตั้งใจ — ถ้ารวม การแก้จำนวนหนึ่งชิ้น
 * จะกลายเป็นกฎ "ข้อใหม่" แล้วโมดัลเด้งซ้ำทุกครั้งที่พิมพ์ ซึ่งคือการฝึกให้คนกดผ่านโดยไม่อ่าน
 */
export function violationKey(v: Violation): string {
  return `${v.type}|${v.model || '-'}`;
}

/**
 * ข้อที่ทะลุไม่ได้ไม่ว่าใครจะรับทราบก็ตาม
 *
 * `SYSTEM_ERROR` = "ตรวจกฎไม่สำเร็จ" (ฐานล่ม/กฎอ่านไม่ขึ้น) ซึ่งเป็นค่าของด่าน fail-closed —
 * มันไม่ได้แปลว่า "ใบนี้ผิดกฎข้อนี้" แต่แปลว่า **ยังไม่รู้ว่าผิดหรือไม่** การให้คนกดรับทราบ
 * สิ่งที่ระบบยังไม่รู้ คือการเปลี่ยน fail-closed ให้กลายเป็น fail-open โดยใช้ปุ่มเป็นข้ออ้าง
 */
export const isBypassableViolation = (v: Violation): boolean => v.type !== 'SYSTEM_ERROR';

// ─────────────────────────────────────────────────────────────────────────────
//  ชั้นที่สาม: "ทะลุได้ด้วยการอนุมัติเท่านั้น" (2026-09-15)
//
//  เจ้าของสั่งว่าใบจากหน้าเว็บที่ขายต่ำกว่าราคาขั้นต่ำ **คนออกใบติ๊กรับทราบเองไม่ได้**
//  ต้องส่งให้ผู้มีสิทธิ์อนุมัติราคาให้ก่อน ⇒ กฎจึงมีสามชั้นแทนที่จะเป็นสอง:
//
//    ติ๊กรับทราบเองได้      — ของหมด · MOQ · สินค้าระงับ · blacklist · เครดิตค้าง
//    ต้องมีคนอนุมัติ         — ราคาต่ำกว่าขั้นต่ำ            ← ชั้นใหม่
//    ทะลุไม่ได้ทุกกรณี       — SYSTEM_ERROR
//
//  แผนเต็ม: docs/plan-quote-price-approval.md
// ─────────────────────────────────────────────────────────────────────────────

/** กฎที่ต้องผ่านผู้อนุมัติ — เพิ่มกฎข้อใหม่เข้าคิวอนุมัติ = เติมที่นี่บรรทัดเดียว */
export const APPROVAL_REQUIRED_TYPES: Violation['type'][] = ['MIN_PRICE_VIOLATION'];

export const requiresPriceApproval = (v: Violation): boolean => APPROVAL_REQUIRED_TYPES.includes(v.type);

// ─────────────────────────────────────────────────────────────────────────────
//  ชั้นเดียวกันนี้ตั้งค่าต่อ role ได้แล้ว (2026-09-18 · docs/plan-role-permissions.md)
//
//  ของที่เปลี่ยนคือ **"ข้อไหนอยู่ชั้นไหน" กลายเป็นค่าที่ขึ้นกับ role ของคนออกใบ** ไม่ใช่ค่าคงที่
//  ของทั้งระบบอีกต่อไป — แต่ *ตรรกะ* ยังอยู่ที่ฟังก์ชันเดียวเหมือนเดิม โหมดถูกส่งเข้ามาเป็น
//  **ข้อมูล** จากผู้เรียก (`ruleModesOf()` ใน config/capabilities.ts)
//
//  ⚠️ ไฟล์นี้ **ห้าม import config/capabilities.ts แบบ runtime** — ต้องเป็น type-only เท่านั้น
//     ไม่ใช่เรื่องวงจร import อย่างเดียว แต่เพราะ "ด่านตรวจกฎที่ไปถามตารางสิทธิ์เอง" คือด่านที่
//     ให้คำตอบต่างกันตามผู้เรียก ⇒ ใบจาก LINE กับใบจากเว็บจะเริ่มคิดคนละแบบโดยไม่มีใครตั้งใจ
//
//  `ruleModes` เป็น `null` = ไม่มีใครส่งโหมดมา ⇒ ใช้กติกาเดิมของทั้งระบบเป๊ะ
//  (ราคาขั้นต่ำ = ต้องอนุมัติ · ที่เหลือ = ติ๊กรับทราบเองได้) ซึ่งเป็นค่าของใบจาก LINE ทุกใบ
// ─────────────────────────────────────────────────────────────────────────────

/** แมป "ชนิดกฎ → โหมด" ที่ผู้เรียกส่งเข้ามา — รูปเดียวกับ `RuleModeMap` ของ config/capabilities.ts */
export type ViolationModeMap = Partial<Record<Violation['type'], PermissionMode>>;

/**
 * ข้อนี้อยู่ชั้นไหนสำหรับคนที่กำลังออกใบอยู่
 *
 *   deny     = ออกใบไม่ได้ ต้องแก้ใบ (ไม่มีคำรับทราบหรือคำอนุมัติใดปลดได้)
 *   approval = ต้องมีคนอนุมัติก่อน
 *   allow    = ติ๊กรับทราบเองได้
 */
export function violationMode(v: Violation, ruleModes?: ViolationModeMap | null): PermissionMode {
  // ตรวจกฎไม่สำเร็จ = ยังไม่รู้ว่าผิดหรือไม่ ⇒ ไม่มีโหมดไหนปลดได้ และต้องตอบก่อนดูแมปเสมอ
  if (!isBypassableViolation(v)) return 'deny';
  const mode = ruleModes?.[v.type];
  if (mode) return mode;
  return requiresPriceApproval(v) ? 'approval' : 'allow';
}

/**
 * คีย์ของข้อที่ "อนุมัติไว้แล้วและยังใช้ได้อยู่" — อ่านจาก `quotations.price_approval` ของใบนั้น
 *
 * ⚠️ เทียบ **ราคา** ด้วย ไม่ใช่แค่ชื่อรุ่น — `violationKey()` เป็น `type|model` ที่จงใจไม่มีตัวเลข
 *    (ไม่งั้นโมดัลเด้งซ้ำทุกครั้งที่พิมพ์) ถ้าเอาคีย์นั้นมาปลดตรง ๆ คนที่อนุมัติราคา ฿100 จะกลาย
 *    เป็นอนุมัติ ฿10 ให้ด้วยโดยไม่มีใครรู้ · ขายแพงขึ้นกว่าที่อนุมัติไม่ต้องขอใหม่ (ปลอดภัยกว่าเดิม)
 *    แต่ต่ำลงกว่าที่อนุมัติแม้บาทเดียว = คำขอใหม่
 */
export function approvedViolationKeys(priceApproval: any, current: Violation[]): string[] {
  if (!priceApproval || priceApproval.status !== 'approved') return [];

  // ชนิดกฎที่ **คำขอนี้** ขออนุมัติไว้ — อ่านจากตัวคำขอเอง ไม่ใช่จากค่าคงที่ของระบบ
  // เพราะตั้งแต่ 2026-09-18 กฎข้อไหนเข้าคิวอนุมัติขึ้นกับ role ของคนขอ (ดู violationMode)
  // คำขอเก่าที่ไม่ได้เก็บ violations ไว้ = คำขอราคาขั้นต่ำ ซึ่งเป็นชนิดเดียวที่มีก่อนหน้านั้น
  const askedTypes = new Set<string>();
  // คีย์ (`type|model`) ของข้อที่ถูกส่งไปขอจริง ๆ — กฎที่ไม่มีตัวเลขผูกใช้ชุดนี้เป็นขอบเขต
  // ไม่งั้นการอนุมัติ "ระงับรุ่น A" จะกลายเป็นอนุมัติ "ระงับรุ่น B" ให้ด้วยเพราะเป็นกฎชนิดเดียวกัน
  const askedKeys = new Set<string>();
  for (const v of (Array.isArray(priceApproval.violations) ? priceApproval.violations : [])) {
    const t = String(v?.type ?? '');
    if (!t) continue;
    askedTypes.add(t);
    askedKeys.add(`${t}|${String(v?.model ?? '') || '-'}`);
  }
  if (askedTypes.size === 0) askedTypes.add('MIN_PRICE_VIOLATION');

  const approvedPriceOf = new Map<string, number>();
  const approvedQtyOf = new Map<string, number>();
  for (const it of (Array.isArray(priceApproval.items) ? priceApproval.items : [])) {
    const model = String(it?.model ?? '');
    if (!model) continue;
    const price = Number(it?.price);
    if (Number.isFinite(price)) {
      // รุ่นเดียวกันหลายบรรทัด ⇒ ยึดราคาที่ต่ำที่สุดที่ถูกอนุมัติ (เป็นเพดานที่อนุมัติไว้จริง)
      const prev = approvedPriceOf.get(model);
      approvedPriceOf.set(model, prev === undefined ? price : Math.min(prev, price));
    }
    const qty = Number(it?.quantity);
    if (Number.isFinite(qty)) {
      const prev = approvedQtyOf.get(model);
      approvedQtyOf.set(model, prev === undefined ? qty : Math.max(prev, qty));
    }
  }

  const keys: string[] = [];
  for (const v of current || []) {
    if (!askedTypes.has(v.type)) continue;
    switch (v.type) {
      case 'MIN_PRICE_VIOLATION': {
        const approved = approvedPriceOf.get(v.model);
        if (approved === undefined) break;
        // 0.005 = ครึ่งสตางค์ กันเลขทศนิยมลอยตัวปัดไม่ตรงกันระหว่าง JSON กับ numeric ของ Postgres
        if (Number(v.price ?? 0) >= approved - 0.005) keys.push(violationKey(v));
        break;
      }
      // ─ กฎที่ผูกกับ "จำนวน" ─────────────────────────────────────────────────
      //  ทิศทางของสองข้อนี้ **กลับกัน** และนั่นคือประเด็นทั้งหมด — เกณฑ์คือ
      //  "แก้ไปทางที่ทำให้ผิดหนักขึ้นกว่าที่คนอนุมัติเห็น = ต้องขอใหม่"
      case 'OUT_OF_STOCK': {
        // ผิดเพราะ "สั่งมากกว่าของที่มี" ⇒ สั่งเพิ่มขึ้น = หนักขึ้น
        const approved = approvedQtyOf.get(v.model);
        if (approved === undefined) break;
        if (Number(v.qty ?? 0) <= approved) keys.push(violationKey(v));
        break;
      }
      case 'MOQ_VIOLATION': {
        // ผิดเพราะ "สั่งน้อยกว่าขั้นต่ำ" ⇒ สั่งลดลง = หนักขึ้น (ตรงข้ามกับของหมด)
        const approved = approvedQtyOf.get(v.model);
        if (approved === undefined) break;
        if (Number(v.qty ?? 0) >= approved) keys.push(violationKey(v));
        break;
      }
      // ─ กฎที่ไม่มีตัวเลขผูก — เทียบคีย์ล้วน แต่ **ต้องเป็นคีย์ที่อยู่ในคำขอจริง** ─
      //  (คนละรุ่น/คนละลูกค้า = คนละคีย์ ⇒ อนุมัติรุ่นหนึ่งไม่ปลดอีกรุ่นให้)
      default:
        if (askedKeys.has(violationKey(v))) keys.push(violationKey(v));
        break;
    }
  }
  return keys;
}

/**
 * คัดว่าข้อไหน "ยังบล็อกอยู่" หลังหักรายการที่รับทราบ/อนุมัติไว้แล้ว — คืน [] แปลว่าออกใบต่อได้
 *
 * `acknowledgedKeys` มาจาก `rule_overrides.acknowledged_keys` ของใบนั้น (หรือจากสิ่งที่
 * หน้าจอส่งมาตอนสร้างร่าง) · ข้อที่ **ไม่อยู่** ในรายการคือข้อที่เพิ่งโผล่หลังคนกดรับทราบ
 * (เช่นของหมดสต็อกระหว่างทาง) ⇒ ต้องกลับไปให้คนดูใหม่ ไม่ใช่ปล่อยผ่านเพราะ "ก็กดไปแล้ว"
 *
 * `approvedKeys` มาจาก `approvedViolationKeys()` ของใบนั้น — **ค่าเริ่มต้นคือ `null` โดยตั้งใจ**
 * ผู้เรียกที่ไม่ส่งค่าจึงได้ "ไม่มีใครอนุมัติ" = ราคาขั้นต่ำบล็อกเสมอ ซึ่งเป็นด้าน fail-closed
 * และตรงกับพฤติกรรมเดิมของใบจาก LINE ทุกใบ (คอลัมน์ price_approval เป็น NULL)
 */
export function blockingViolations(
  violations: Violation[],
  acknowledgedKeys: string[] | null,
  approvedKeys: string[] | null = null,
  ruleModes: ViolationModeMap | null = null
): Violation[] {
  const list = violations || [];
  const ack = new Set(acknowledgedKeys || []);
  const approved = new Set(approvedKeys || []);
  return list.filter((v) => {
    switch (violationMode(v, ruleModes)) {
      // `deny` ครอบทั้ง SYSTEM_ERROR และกฎที่ role นี้ถูกปิดไว้ — ไม่มีคีย์ไหนปลดได้
      case 'deny':
        return true;
      // ราคาขั้นต่ำ (และกฎอื่นที่ถูกตั้งเป็น approval): คำรับทราบของคนออกใบไม่มีผล
      // ต้องมาจากผู้อนุมัติเท่านั้น
      case 'approval':
        return !approved.has(violationKey(v));
      case 'allow':
        if (!acknowledgedKeys) return true;
        return !ack.has(violationKey(v));
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  คิว "ต้องแก้มือใน Odoo ก่อนนำเข้า" — คนละเรื่องกับการทะลุกฎข้างบนโดยสิ้นเชิง
//
//  ใบที่ทะลุกฎ (ของหมด/ต่ำกว่าราคาขั้นต่ำ/ลูกค้าติด blacklist) **นำเข้า Odoo ได้ทันที**
//  เพราะทุกช่องในไฟล์ยังตรงกับฐาน Odoo — มันผิดกฎของร้าน ไม่ใช่ผิดข้อมูล
//  ส่วนใบในคิวนี้คือใบที่ **ค่าในไฟล์ไม่มีอยู่ในฐาน Odoo** ⇒ นำเข้าแล้วตกทั้งใบ
//  ต้องไปสร้าง/แก้ใน Odoo ก่อน ⇒ กันออกจากไฟล์ปกติแล้วส่งออกจากเมนูแยก
// ─────────────────────────────────────────────────────────────────────────────

/** ชนิดของเหตุ — เรียงตามลำดับที่ต้องไปสร้างใน Odoo ก่อน (ใช้เป็นลำดับของกลุ่มในเมนูส่งออกด้วย) */
export const ODOO_MANUAL_REASON_KINDS = ['new_contact', 'custom_product', 'payment_terms_override'] as const;
export type OdooManualReasonKind = (typeof ODOO_MANUAL_REASON_KINDS)[number];

export interface OdooManualReason {
  kind: OdooManualReasonKind;
  /** ชื่อคอลัมน์ในไฟล์ Odoo ที่จะไม่ตรงกับฐาน — บอกคนที่รับไปแก้ว่าต้องดูช่องไหน */
  field: string;
  value: string | null;
  /** ถ้อยคำเดียวของทั้งระบบ — server เป็นเจ้าของคำ เหมือน buildViolationDisplay ของฝั่งกฎ */
  display_message: string;
}

/** คำอธิบายเหตุที่ต้องแก้มือ — โมดัล หน้าประวัติ และไฟล์ export ต้องใช้ประโยคเดียวกัน */
export function buildManualReasonDisplay(r: Omit<OdooManualReason, 'display_message'>): string {
  switch (r.kind) {
    case 'payment_terms_override':
      return `💳 เครดิตของใบนี้ตั้งเอง เป็น “${r.value ?? '-'}” ⇒ ช่อง ${r.field} ในไฟล์อาจไม่ตรงกับฐาน Odoo`;
    case 'new_contact':
      return `👤 ผู้ติดต่อรายนี้ยังไม่มีใน Odoo ⇒ ต้องสร้างก่อน ไม่งั้นช่อง ${r.field} จับคู่ไม่ติด`;
    case 'custom_product':
      return `📦 รหัสสินค้า “${r.value ?? '-'}” ยังไม่มีใน Odoo ⇒ ต้องสร้างก่อน ไม่งั้นช่อง ${r.field} จับคู่ไม่ติด`;
  }
}

/**
 * ใบนี้ต้องแก้มือใน Odoo ก่อนไหม — อ่านจากข้อมูลของใบเองล้วน ๆ ไม่ยิง query เพิ่ม
 * (เรียกอยู่ใน transaction ของ confirmQuotationAtomic จึงห้ามยิงงานหนัก)
 *
 * วันนี้มีเหตุเดียวคือ **เครดิตที่แอดมินตั้งทับ** และเจ้าของเลือกไว้ชัดเมื่อ 2026-09-15 ว่าให้
 * นับ **ทุกครั้งที่ทับ** ไม่ต้องดูว่าค่าที่ตั้งบังเอิญตรงกับ payment term ที่ Odoo รู้จักหรือไม่ —
 * ปลอดภัยกว่าและอธิบายให้คนหน้างานเข้าใจง่ายกว่า "ทับแล้วต้องดูอีกทีว่าตรงรายการไหม"
 * แลกกับคิวที่ยาวกว่าความจำเป็นบ้าง (วัด 2026-09-15: ใบที่ทับเครดิตทั้งฐานมี 2 ใบ)
 *
 * เหตุอีกสองชนิด (`new_contact` · `custom_product`) ยังไม่มีฟีเจอร์ที่สร้างมันได้ในวันนี้ —
 * จงใจประกาศชนิดไว้ก่อน เพื่อให้ตัวกรองหน้าประวัติกับเมนูส่งออกที่ทำรอบนี้ใช้ต่อได้เลย
 * โดยไม่ต้องแก้ schema หรือ backfill อีกรอบ
 */
export function buildOdooManualReview(enrichedQuote: any): { reasons: OdooManualReason[] } | null {
  const reasons: OdooManualReason[] = [];

  const ptOverride = enrichedQuote?.customer_details?.payment_terms_override;
  if (ptOverride !== null && ptOverride !== undefined) {
    const r = { kind: 'payment_terms_override' as const, field: 'payment_term_id', value: String(ptOverride) };
    reasons.push({ ...r, display_message: buildManualReasonDisplay(r) });
  }

  return reasons.length > 0 ? { reasons } : null;
}

/** ประกอบหลาย violation เป็นข้อความเดียวสำหรับ LINE (หัวข้อ + รายการ) */
export function buildViolationText(violations: Violation[]): string {
  if (!violations || violations.length === 0) return '';
  const lines = violations.map(v => ` - ${v.display_message}`).join('\n');
  return `❌ ระงับการเสนอราคา ตามเงื่อนไขด้านล่าง\nกรุณาแก้ไข หรือติดต่อแอดมิน\n\n${lines}`;
}

/**
 * เพิ่มตัวนับของ key แล้วคืนลำดับใหม่แบบ atomic (row lock ผ่าน ON CONFLICT DO UPDATE)
 * ต้องเรียกภายใน transaction (executor = PoolClient) เพื่อให้ lock ถูกถือจนกว่าจะ COMMIT
 */
async function bumpCounter(key: string, executor: DbExecutor): Promise<number> {
  const { rows } = await executor.query(
    `INSERT INTO quotation_counters (counter_key, last_seq) VALUES ($1, 1)
     ON CONFLICT (counter_key) DO UPDATE
       SET last_seq = quotation_counters.last_seq + 1, updated_at = NOW()
     RETURNING last_seq`,
    [key]
  );
  return rows[0].last_seq;
}

/**
 * จองเลขที่ใบเสนอราคาแบบ atomic ผ่านตาราง quotation_counters (แทนการ COUNT-then-INSERT ที่ race)
 * ต้องเรียกภายใน transaction เท่านั้น (executor = PoolClient) เพราะ row lock ของ counter
 * ต้องถูกถือไว้จนกว่าจะ COMMIT พร้อมกับการ UPDATE status
 *
 * เดือนของเลขยึด quoteData.created_at (วันที่ร่าง) ตามเดิม — จึงต้องไม่เขียนทับ created_at ตอนยืนยัน
 */
export async function allocateQuotationNo(quoteData: any, executor: DbExecutor): Promise<string> {
  // 1) revision → นับต่อจากเลขฐาน (แกะ revise_from จาก customer_name)
  let reviseFrom: string | null = null;
  if (quoteData?.customer_name && quoteData.customer_name.includes(' | ')) {
    const parts = quoteData.customer_name.split(' | ');
    if (parts[2]) {
      try {
        reviseFrom = Object.fromEntries(new URLSearchParams(parts[2])).revise_from || null;
      } catch (err) {
        console.warn(`[allocateQuotationNo] parse metadata ไม่สำเร็จ (quote id=${quoteData.id})`, err);
      }
    }
  }
  if (reviseFrom) {
    const m = reviseFrom.match(/^((?:QP|QT)-\d+)(-\d+)$/i);
    const baseQuoteNo = m ? m[1] : reviseFrom;
    const seq = await bumpCounter(`REV:${baseQuoteNo}`, executor);
    return `${baseQuoteNo}-${String(seq).padStart(2, '0')}`;
  }

  // 2) เลขปกติ — prefix จากสินค้ารายการแรก, เดือนจาก created_at (วันที่ร่าง)
  if (!quoteData?.created_at) {
    throw new Error('[allocateQuotationNo] quoteData.created_at ไม่มีค่า — ไม่สามารถออกเลขได้');
  }
  let isThemtech = false;
  if (quoteData.items && quoteData.items.length > 0) {
    isThemtech = (await resolveQuoteCompany(quoteData.items[0], executor)) === 'THT';
  }
  const prefix = isThemtech ? 'QT' : 'QP';
  // งวดยึด "เดือนตามวันไทย" ของ created_at ไม่ใช่ TZ ของโปรเซส — ไม่งั้นใบที่ร่างตี 3 ของวันที่ 1
  // จะได้งวดของเดือนก่อนหน้าบน production (UTC) แล้วเลขนั้นติดไปถาวร
  const period = thaiYearMonth(new Date(quoteData.created_at));
  const seq = await bumpCounter(`${prefix}:${period}`, executor);
  return `${prefix}-${period}05${String(seq).padStart(3, '0')}`;
}

export type ConfirmResult =
  | { outcome: 'confirmed';         quotationNo: string }
  | { outcome: 'already_confirmed'; quotationNo: string }
  | { outcome: 'cancelled' }
  | { outcome: 'not_found' };

/**
 * ยืนยันใบเสนอราคาแบบ atomic + idempotent — จุดเดียวในระบบที่เปลี่ยน status เป็น confirmed
 *
 * ต้องเรียก "หลัง" enrich + ตรวจราคาขั้นต่ำ/โปรโมชันเสร็จแล้ว (ทำนอก transaction) เพราะ
 * enrichQuotationData ผูกกับ pool ตรง ๆ ถ้าดึงเข้ามาในนี้จะขอ connection ซ้อนขณะถือ row lock จนตัน
 *
 * @param enrichedQuote ผลจาก enrichQuotationData ใช้แค่ items/customer_name/created_at สำหรับออกเลข
 *                      + ตัดสิน revision — status ในนี้ห้ามเชื่อ อ่านใหม่ใต้ row lock เสมอ
 */
export async function confirmQuotationAtomic(
  quoteId: string,
  enrichedQuote: any
): Promise<ConfirmResult> {
  return withTransaction(async (client) => {
    // 1) ล็อกแถว — ผู้กดยืนยันพร้อมกันคนที่ 2 จะรอตรงนี้จนคนแรก COMMIT แล้วจึงเห็น status ล่าสุด
    // contact_id/customer_id อ่านจากแถวในฐานใต้ล็อก ไม่ใช่จาก enrichedQuote — ไฟล์ export ก็ join
    // ด้วยสองคอลัมน์นี้ ค่าที่ตรึงจึงต้องมาจากที่เดียวกัน ไม่งั้นค่าที่ตรึงกับค่าที่ join ได้ต่างกันเอง
    const cur = await client.query(
      `SELECT id, status, quotation_no, contact_id, customer_id FROM quotations WHERE id = $1 FOR UPDATE`,
      [quoteId]
    );
    if (cur.rowCount === 0) return { outcome: 'not_found' as const };

    const row = cur.rows[0];
    if (row.status === 'cancelled') return { outcome: 'cancelled' as const };
    if (row.status === 'confirmed') {
      return { outcome: 'already_confirmed' as const, quotationNo: row.quotation_no || '-' };
    }

    // 1.5) ตรึงทีมขายของผู้ติดต่อ — ช่อง Sales Team (คอลัมน์ I) ของไฟล์นำเข้า Odoo
    //      ต้องอยู่ในทรานแซกชันเดียวกับการออกเลข ไม่ใช่หลังจากนั้น: ใบที่ยืนยันสำเร็จแต่ตรึงไม่สำเร็จ
    //      จะได้ NULL แล้วเงียบ ๆ ตกไปใช้ join สด ซึ่งคือปัญหาที่เฟส H ตั้งใจปิด (plan §5.7)
    //      ⇒ resolveCustomerSalesTeam ปล่อยให้ error ทะลุ = ROLLBACK ทั้งการยืนยัน ไม่ใช่ตรึงไม่ครบ
    //
    //      ⚠️ อยู่ "ก่อน" allocateQuotationNo โดยตั้งใจ — bumpCounter ถือ row lock ของ
    //      quotation_counters (คีย์เดียวต่อเดือนต่อบริษัท = จุดที่ทุกการยืนยันในเดือนนั้นมาต่อคิวกัน)
    //      ไปจน COMMIT ถ้าวางไว้หลังจากนั้น การอ่าน customers_data_view ที่ช้าจะลากคิวของทุกคนไปด้วย
    //      วัดแล้วบนเครื่อง dev 2026-09-18: ปกติ 1.6 ms · กรณีเลวร้าย (ตารางถูกล็อกค้าง) ชน
    //      statement_timeout ของ pool ที่ 15 วิ แล้ว rollback ทั้งใบ — ตอนนั้นต้องไม่มีใครติดอยู่ข้างหลัง
    const customerSalesTeam = await resolveCustomerSalesTeam(row.contact_id, row.customer_id, client);

    // 2) จองเลข (ใช้เลขเดิมถ้ามีอยู่แล้ว เพื่อไม่เผาเลขซ้ำ) — created_at ยึดของ enrichedQuote (วันที่ร่าง)
    const quotationNo = row.quotation_no
      || await allocateQuotationNo(enrichedQuote, client);

    // 2.5) ตรึงกำหนดส่งลงใบ — ประเภทอัตโนมัติคิดจาก "สต๊อก ณ ตอนนี้" ซึ่ง item_details ไม่ได้เก็บไว้
    //      ถ้าไม่ตรึง ไฟล์ export ที่กดทีหลังจะได้ค่าคนละตัวกับ PDF ที่ลูกค้าถืออยู่
    //      enrichedQuote มี delivery_days_auto / delivery_all_in_stock ติดมาแล้วจาก
    //      enrichQuotationData() จึงไม่ต้อง query เพิ่มในนี้ (อยู่ใน transaction ห้ามยิงงานหนัก)
    const deliveryTerms = resolveDeliveryTerms(enrichedQuote);

    // 2.6) ตรึงสต๊อกลงใบ — เป็นค่าเดียวที่ PDF ใช้แล้วไม่มีเก็บไว้ที่ไหนเลย (item_details ไม่มีคีย์
    //      stock) ถ้าไม่ตรึง บรรทัด "(*** สินค้าคงเหลือ N pcs. ***)" จะเปลี่ยนไปเรื่อยตามของเข้า/ออก
    //      ทั้งที่ลูกค้าถือเอกสารเวอร์ชันเดิมอยู่ · เรียงตรง index กับ item_details
    //      ค่ามาจาก enrichedQuote.items ที่ enrichQuotationData เพิ่งดึงสดมา — ไม่ query เพิ่มในล็อก
    const printSnapshot = {
      item_stock: (enrichedQuote?.items || []).map((it: any) => Number(it?.stock) || 0),
      frozen_at: new Date().toISOString(),
    };

    // 2.7) ตรึง "ต้องแก้มือใน Odoo ก่อนไหม" ลงใบ — ที่เดียวของทั้งระบบที่เขียนคอลัมน์นี้
    //      อยู่ตรงนี้เพราะเป็น **จุดเดียวที่ใบกลายเป็นเอกสารจริง** และไฟล์ export หยิบเฉพาะใบที่
    //      มีเลขที่แล้ว ⇒ คำนวณครั้งเดียวตอนยืนยัน ไม่ต้องคอยตามอัปเดตทุกครั้งที่ร่างถูกแก้
    //      (ถ้าไปคำนวณตอนสร้างร่างแทน จะมีสองจุดที่ต้องดูแล คือ insert กับ PUT — เหมือนที่
    //       payment_terms_override เคยพลาดมาแล้ว)
    const odooManualReview = buildOdooManualReview(enrichedQuote);

    // 3) UPDATE แบบมีเงื่อนไข status + เช็ค rowCount (ห้ามเขียนทับ created_at เพราะเลขคำนวณจากมัน)
    const upd = await client.query(
      `UPDATE quotations
          SET status = 'confirmed',
              quotation_no = COALESCE(quotation_no, $1),
              delivery_terms = $3::jsonb,
              print_snapshot = $4::jsonb,
              odoo_manual_review = $5::jsonb,
              customer_sales_team = COALESCE(customer_sales_team, $6),
              updated_at = NOW()
        WHERE id = $2 AND status <> 'confirmed' AND status <> 'cancelled'
      RETURNING quotation_no`,
      [quotationNo, quoteId, JSON.stringify(deliveryTerms), JSON.stringify(printSnapshot),
       odooManualReview ? JSON.stringify(odooManualReview) : null, customerSalesTeam]
    );
    if (upd.rowCount === 0) {
      // มี FOR UPDATE แล้วยังโดน 0 แถว = มีทางเขียน status ที่เรายังไม่รู้ ให้ rollback ทั้งชุด
      throw new Error(`[confirmQuotationAtomic] UPDATE ไม่โดนแถวใด (id=${quoteId}) — สถานะเปลี่ยนระหว่างล็อก`);
    }

    // 4) ยกเลิกใบเก่ากรณี revision — อยู่ใน tx เดียวกัน ล้มแล้ว rollback ทั้งการยืนยัน
    const custName = enrichedQuote?.customer_name;
    if (custName && custName.includes('revise_from=')) {
      await cancelOldRevision(custName, client);
    }

    return { outcome: 'confirmed' as const, quotationNo: upd.rows[0].quotation_no };
  });
}

export async function resolveQuoteCompany(item: any, executor: DbExecutor = pool): Promise<'PM' | 'THT'> {
  let rules: any[] = [];
  try {
    rules = await loadQuotationRules(executor);
  } catch (err) {
    console.error('Error fetching quotation rules for company resolution:', err);
  }

  // ไม่มีกฏที่ระบุค่ายเลย → ข้ามการ query สินค้าไปเลย (เหมือนเดิม)
  const hasCompanyRule = rules.some((r: any) => r.quote_company != null);
  const code = item.product_code || item.model || item.code;
  if (code && hasCompanyRule) {
    const prod = await getProductInfo(code, executor);
    if (prod) {
      const rule = findCompanyRule(rules, normalizeProductScope(prod));
      if (rule) {
        if (rule.quote_company === 'PM') return 'PM';
        if (rule.quote_company === 'THT') return 'THT';
      }
    }
  }

  // fallback: logic เดิม
  return item.production === 'Import(PM)' ? 'THT' : 'PM';
}

/**
 * สร้าง snapshot ของรายการสินค้าเพื่อ freeze ลง quotations.item_details
 *
 * เป็นจุดเดียวในระบบที่สร้าง snapshot — ทั้ง LINE flow (insertDraftQuotations)
 * และ PUT /api/quotation/:id ใช้ตัวนี้ร่วมกัน field ใหม่ทุกตัวต้องเพิ่มที่นี่ที่เดียว
 */
export async function buildItemSnapshots(rawItems: any[], executor: DbExecutor = pool): Promise<any[]> {
  let quotationRules: any[] = [];
  try {
    quotationRules = await loadQuotationRules(executor);
  } catch (err) {
    console.error('[buildItemSnapshots] Error fetching quotation rules:', err);
  }

  const { isShippingFeeItem, loadShippingFeeConfig, buildShippingFeeSnapshot } =
    await import('./shippingFee.js');
  const shippingCfg = await loadShippingFeeConfig(executor);

  const snapshotItems: any[] = [];
  for (const item of rawItems) {
    // บรรทัดค่าขนส่งมีกติกาคนละชุด: ชื่อ/ราคาเป็นของที่เซลล์ตั้งเอง (ห้ามให้ชื่อ 'ค่าบริการ'
    // จาก products ทับ) จำนวนกับส่วนลดถูกล็อก และไม่มีวันจัดส่ง/การรับประกัน
    // มอบงานให้ผู้สร้างบรรทัดนั้นโดยตรง เพื่อให้ shape ออกมาจากที่เดียวเสมอ
    if (isShippingFeeItem(item, shippingCfg)) {
      snapshotItems.push(buildShippingFeeSnapshot(shippingCfg, item));
      continue;
    }

    const code = item.product_code || item.model || item.code || '';
    let dbProduct: any = null;
    try {
      const prodRes = await executor.query(
        'SELECT product_template_id AS product_id, internal_reference, name, sales_description, brand, series, production FROM products WHERE model = $1 ORDER BY quantity_on_hand_unreserved DESC LIMIT 1',
        [code]
      );
      dbProduct = prodRes.rows[0];
    } catch (err) {
      console.warn(`[buildItemSnapshots] ดึงข้อมูลสินค้าไม่สำเร็จ (model="${code}") — ใช้ค่าจาก item แทน`, err);
    }

    const finalInternalRef = dbProduct?.internal_reference || code;
    const finalProductId = dbProduct?.product_id || item.product_id || null;
    const finalName = dbProduct?.name || item.name || '';
    const finalSalesDesc = dbProduct?.sales_description || item.sales_description || '';
    const iBrand = dbProduct?.brand || item.brand || '';
    const iSeries = dbProduct?.series || item.series || '';
    const iProduction = dbProduct?.production || item.production || '';

    const outcome = resolveQuotationRule(
      quotationRules,
      normalizeProductScope({ production: iProduction, brand: iBrand, series: iSeries })
    );

    // วันส่งกรณีสต็อกไม่พอขึ้นกับจำนวนที่สั่งของรายการนี้ (tier) — freeze ค่าที่ผ่าน tier แล้วลง snapshot
    // ทำที่นี่ได้เพราะ tier ขึ้นกับจำนวนล้วน ๆ ไม่ขึ้นกับสต็อก (สต็อกเป็นตัวเลือกว่าจะใช้ in หรือ out)
    const quantity = Number(item.quantity ?? item.qty) || 0;
    const outOfStock = resolveDeliveryOutOfStockDays(outcome, quantity);

    snapshotItems.push({
      internal_reference: finalInternalRef,
      product_id: finalProductId,
      model: code,
      name: finalName,
      sales_description: finalSalesDesc,
      price: Number(item.price) || 0,
      quantity,
      discount_1: Number(item.discount_1) || 0,
      discount_2: Number(item.discount_2) || 0,
      remark: item.remark || '',
      brand: iBrand,
      series: iSeries,
      production: iProduction,
      warranty_display: outcome.warranty_display,
      delivery_in_stock_days: outcome.delivery_in_stock_days,
      delivery_out_of_stock_days: outOfStock.days,
      delivery_source: outOfStock.source,
      is_optional: !!item.is_optional,
      // ผูกสินค้าเสริมกลับไปยังสินค้าหลัก — ต้อง persist ลง snapshot ด้วย
      // ไม่งั้นหายตอน round-trip แล้วฝั่งแสดงผล (Flex/LIFF) แยกสินค้าพ่วงไม่ออก
      linked_to_product_id: item.linked_to_product_id ?? null
    });
  }
  return snapshotItems;
}

// ค่าตั้งต้นเมื่อ snapshot ไม่มีวันจัดส่งติดมา (ใบเก่าก่อนมี rule engine) — ตรงกับ QUOTATION_RULE_DEFAULTS
const DELIVERY_DAYS_FALLBACK_IN_STOCK = 3;
const DELIVERY_DAYS_FALLBACK_OUT_OF_STOCK = 7;

/**
 * จำนวนวันจัดส่งของ "ทั้งใบ" = ค่ามากสุดของทุกรายการ (รายการที่ช้าสุดเป็นตัวกำหนดวันส่งทั้งใบ)
 *
 * อ่านจาก snapshot ที่ freeze ไว้ตอนสร้าง/บันทึกใบ (delivery_in_stock_days /
 * delivery_out_of_stock_days ผ่าน tier มาแล้ว) โดยใช้สต๊อกจาก items เป็นตัวเลือกว่าจะใช้ in หรือ out
 *
 * ⚠️ เป็นจุดเดียวที่คำนวณเลขนี้ — ทั้ง enrichQuotationData (ที่หน้า LIFF เอาไปโชว์)
 * และ pdfGenerator (ที่พิมพ์ลงเอกสาร) ต้องเรียกตัวนี้ ไม่งั้นเซลล์เห็นเลขคนละตัวกับในไฟล์
 *
 * บรรทัดค่าขนส่งถูกข้ามทั้งการนับวันและการตัดสิน all_in_stock — มันไม่ใช่ของที่ต้องผลิต/ส่ง
 * ถ้านับด้วย สต๊อก 0 ของมันจะดึงทั้งใบไปเป็น "ของไม่พอ" แล้วดันวันส่งขึ้นเป็นเคสสต๊อกขาด
 */
export function resolveQuotationDeliveryDays(
  items: any[],
  snapshots: any[]
): { days: number; all_in_stock: boolean } {
  const list = Array.isArray(items) ? items : [];
  const snaps = Array.isArray(snapshots) ? snapshots : [];
  // snapshot จับคู่กับ items ตาม index ได้ต่อเมื่อจำนวนตรงกัน (เหมือนที่ pdfGenerator เช็ค)
  const snapsUsable = snaps.length > 0 && snaps.length === list.length;

  let allInStock = true;
  const perItemDays: number[] = [];

  list.forEach((item: any, idx: number) => {
    const snap = snapsUsable ? snaps[idx] : null;
    // ฟังก์ชันนี้เป็น sync (pdfGenerator เรียกตรง) จึงอ่าน config มาเทียบไม่ได้ —
    // ใช้มาร์กที่ buildShippingFeeSnapshot ปั๊มไว้ใน snapshot แทน
    if (snap?.delivery_source === 'shipping_fee') return;

    const qty = Number(item.quantity ?? item.qty) || 0;
    const stock = item.stock !== undefined && item.stock !== null ? Number(item.stock) : 0;
    const hasStock = qty <= stock;
    if (!hasStock) allInStock = false;

    const inDays = snap && snap.delivery_in_stock_days !== undefined && snap.delivery_in_stock_days !== null
      ? Number(snap.delivery_in_stock_days)
      : DELIVERY_DAYS_FALLBACK_IN_STOCK;
    const outDays = snap && snap.delivery_out_of_stock_days !== undefined && snap.delivery_out_of_stock_days !== null
      ? Number(snap.delivery_out_of_stock_days)
      : DELIVERY_DAYS_FALLBACK_OUT_OF_STOCK;

    perItemDays.push(hasStock ? inDays : outDays);
  });

  const fallback = allInStock ? DELIVERY_DAYS_FALLBACK_IN_STOCK : DELIVERY_DAYS_FALLBACK_OUT_OF_STOCK;
  return {
    days: perItemDays.length > 0 ? Math.max(...perItemDays) : fallback,
    all_in_stock: allInStock
  };
}

/**
 * วันจัดส่งของรายการที่ "ยังไม่ได้บันทึก" — หน้า LIFF เรียกระหว่างเซลล์แก้จำนวน/เพิ่มสินค้า
 *
 * สร้าง snapshot ชั่วคราวด้วย buildItemSnapshots ตัวเดียวกับตอนบันทึกจริง แล้วอ่านสต๊อกสดจาก DB
 * (ไม่เชื่อ stock ที่ client ส่งมา เพราะอาจค้างตั้งแต่ตอนเปิดหน้า) → เลขที่โชว์ระหว่างแก้
 * จึงเท่ากับเลขที่จะได้หลังกดบันทึก ทั้งใน Flex และใน PDF
 */
export async function previewQuotationDeliveryDays(
  rawItems: any[]
): Promise<{ days: number; all_in_stock: boolean }> {
  const snapshots = await buildItemSnapshots(rawItems);

  const stockKeys = snapshots.map((s: any) => s.model || s.internal_reference).filter(Boolean);
  const stockMap: Record<string, number> = {};
  if (stockKeys.length > 0) {
    try {
      const { rows } = await pool.query(
        'SELECT model AS code, quantity_on_hand_unreserved AS stock FROM products WHERE model = ANY($1)',
        [stockKeys]
      );
      rows.forEach((p: any) => {
        const s = p.stock !== undefined && p.stock !== null ? Number(p.stock) : 0;
        // เผื่อมีหลายแถวชื่อ model เดียวกัน ให้ใช้สต๊อกสูงสุด (เหมือนที่ enrichQuotationData ทำ)
        if (stockMap[p.code] === undefined || s > stockMap[p.code]) stockMap[p.code] = s;
      });
    } catch (err) {
      console.error('[previewQuotationDeliveryDays] ดึงสต๊อกสดไม่สำเร็จ — ใช้ค่าที่ client ส่งมาแทน', err);
    }
  }

  const itemsWithStock = snapshots.map((snap: any, idx: number) => {
    const key = snap.model || snap.internal_reference;
    const clientStock = rawItems[idx]?.stock;
    return {
      quantity: snap.quantity,
      stock: stockMap[key] !== undefined
        ? stockMap[key]
        : (clientStock !== undefined && clientStock !== null ? Number(clientStock) : 0)
    };
  });

  return resolveQuotationDeliveryDays(itemsWithStock, snapshots);
}

/**
 * ตรวจค่า "วันจัดส่งที่เซลล์แก้เอง" ที่ส่งมาจาก client
 * คืน number = ใช้ค่านี้, null = ล้างกลับไปใช้ค่าอัตโนมัติ, undefined = client ไม่ได้ส่งมา (คงค่าเดิม)
 * โยน Error พร้อมข้อความภาษาไทยเมื่อค่าไม่ผ่าน — ผู้เรียกเอาไปตอบ 400
 */
export function parseDeliveryDaysOverride(raw: any): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 3650) {
    throw new Error('จำนวนวันจัดส่งต้องเป็นจำนวนเต็ม 0–3650 วัน');
  }
  return n;
}

/**
 * ชื่อบริษัทใน snapshot ต้องมาจาก "แถวเดียวกัน" กับที่ให้รหัสลูกค้า/เลขภาษี
 *
 * ── ทำไมต้องมีกฎนี้ ──
 * ชื่อบริษัทที่ไหลเข้ามาคือชื่อที่เซลส์ค้นตอนแรก แต่รหัส/เลขภาษีถูกดึงใหม่จาก
 * (customer_id, contact_id) ที่ผูกใบจริง สองค่านี้เป็นคนละบริษัทกันได้เมื่อผู้ติดต่อที่เลือก
 * อยู่ใต้บริษัทพี่น้อง — รายชื่อผู้ติดต่อค้นข้ามนิติบุคคลให้ (getRelatedContactsByCustomerId)
 * และการเลือกผู้ติดต่อ = เลือกสาขา/นิติบุคคลไปในตัว
 *
 * เคสจริง 2026-08-21 (QT-260805193): เซลส์ค้น "บริษัท โปรต้าวัน" (A/35080) แล้วกดปุ่ม
 * "คุณเอกชัย" ที่อยู่ใต้ "บริษัท เอ.เอ็น.เอ็น. เทรดดิ้ง" (A/32533, เลขภาษีเดียวกัน)
 * ใบจึงออกมาเป็นชื่อโปรต้าวัน คู่กับรหัส A/32533 = ชื่อกับรหัสคนละบริษัท
 *
 * ⚠️ ทุกที่ที่หยิบ customer_reference/customer_tax_id จากแถวลูกค้า ต้องเรียกตัวนี้ด้วยเสมอ
 *    ไม่งั้นชื่อกับรหัสหลุดจากกันได้อีก · แถวไม่มีชื่อ = คงชื่อเดิมไว้ ไม่ล้างทิ้ง
 */
export function companyNameOfRow(row: any, current: string): string {
  return String(row?.customer_name ?? row?.display_name ?? '').trim() || current;
}

/**
 * ค่าที่ "คนออกใบ" ตั้งทับของที่ระบบหามาให้ — ใบร่างจากหน้าเว็บใช้ตัวนี้ (2026-09-14)
 *
 * แยกเป็นพารามิเตอร์ตัวสุดท้ายแบบไม่บังคับ เพราะ **เส้น LINE ไม่ส่งมาเลยสักฟิลด์** และต้อง
 * ได้ผลเหมือนเดิมทุกไบต์ (ไม่ส่ง ⇒ เครดิตมาจากลูกค้า · คอลัมน์ override เป็น null เหมือนเดิม)
 */
export interface DraftQuoteOverrides {
  /**
   * เครดิตที่แอดมินเขียนทับเฉพาะชุดใบนี้ — ลงใน `customer_details.payment_terms`
   *
   * ⚠️ ไม่ได้แค่ขึ้นบนเอกสาร: `applyShippingFeeToQuoteGroup()` ที่ถูกเรียกท้ายฟังก์ชันนี้
   *    อ่านค่านี้จากแถวไปตัดสินว่าใบนี้ต้องมีบรรทัดค่าบริการไหม (เจ้าของเลือกไว้ 2026-09-14
   *    ว่าให้ "มีผลทุกอย่าง" — สิ่งที่เห็นบนจอต้องเท่ากับสิ่งที่บันทึก ไม่มีเลขซ่อน)
   */
  paymentTerms?: string | null;
  /**
   * กำหนดส่งที่ตั้งเอง แยกตาม "ใบที่จะออกจริง" เพราะ PM กับ THT มีสต๊อกคนละชุด
   * ⇒ ค่าอัตโนมัติของสองใบไม่เท่ากันอยู่แล้ว การตั้งทับจึงต้องแยกใบตามไปด้วย
   */
  delivery?: Partial<Record<'PM' | 'THT', { type?: DeliveryTypeKey | null; days?: number | null }>>;
}

export async function insertDraftQuotations(
  userId: string,
  customerName: string,
  itemsForDb: any[] | null,
  status: string,
  customerId?: number | null,
  contactId?: number | null,
  preserveDrafts: boolean = false,
  overrides?: DraftQuoteOverrides
): Promise<any[] | null> {
  // การลบร่างเดิม (pending/draft) ย้ายไปทำใน transaction เดียวกับ INSERT ด้านล่าง
  // เพื่อให้ DELETE+INSERT เป็น atomic — ถ้า INSERT ล้ม ร่างเดิมจะไม่ถูกลบทิ้งไปฟรี ๆ

  // บรรทัดค่าขนส่งต้องไม่เข้าการแบ่ง PM/THT — มันไม่มี production/brand/series ให้ตัดสิน
  // resolveQuoteCompany จึงจะตอบ 'PM' เสมอ แล้วสร้างใบ PM เปล่า ๆ ขึ้นมาในเคสที่สั่ง THT ล้วน
  // ตัดทิ้งตรงนี้แล้วให้ applyShippingFeeToQuoteGroup เติมกลับเองหลัง INSERT
  const { isShippingFeeItem, loadShippingFeeConfig, applyShippingFeeToQuoteGroup } =
    await import('./shippingFee.js');
  const shippingCfg = await loadShippingFeeConfig();
  const items = (itemsForDb || []).filter((item: any) => !isShippingFeeItem(item, shippingCfg));
  // ตัดออกจากการแบ่งใบ แต่ต้องไม่ทิ้ง — ส่งต่อให้ applyShippingFeeToQuoteGroup เติมกลับหลัง COMMIT
  // (มีได้บรรทัดเดียว ⇒ หยิบตัวแรกพอ) ถ้าปล่อยหายตรงนี้ ค่าบริการที่แอดมินเพิ่มจากหน้าเว็บ
  // จะไม่มีวันถึง DB เลยสักครั้ง
  const incomingFee = (itemsForDb || []).find((item: any) => isShippingFeeItem(item, shippingCfg)) ?? null;
  const pmItems: any[] = [];
  const thtItems: any[] = [];

  for (const item of items) {
    const company = await resolveQuoteCompany(item);
    if (company === 'THT') {
      thtItems.push(item);
    } else {
      pmItems.push(item);
    }
  }

  // 1. ดึงข้อมูลทีมขาย
  let employeeDetails: any = {
    salesperson_id: null,
    saleperson: '',
    sale_phone: ''
  };
  let salespersonIdStr: string | null = null;

  if (userId) {
    try {
      const spRes = await pool.query(
        'SELECT salesperson_id, name, phone FROM salesperson WHERE user_id = $1 LIMIT 1',
        [userId]
      );
      const spData = spRes.rows[0];
      if (spData) {
        salespersonIdStr = spData.salesperson_id ? String(spData.salesperson_id).trim() : null;
        employeeDetails = {
          salesperson_id: salespersonIdStr,
          saleperson: spData.name || '',
          sale_phone: spData.phone || '',
          // ตัวตน "ผู้เสนอราคา" ของใบที่ออกจากเว็บ — ใบจาก LINE ได้ null แล้ว spread เป็นศูนย์คีย์
          // ⇒ snapshot ของใบ LINE เหมือนเดิมทุกไบต์ (docs/plan-web-quote-request.md §2.6)
          ...(await getIssuerSnapshot(userId) ?? {})
        };
      }
    } catch (err) {
      console.error('[insertDraftQuotations] Error fetching salesperson info:', err);
    }
  }

  // 2. ดึงข้อมูลรายละเอียดลูกค้าและจัด format ที่อยู่
  let companyName = (customerName || '').trim();
  let contactNameQuery = '';
  let customMeta: any = {};
  let reviseFrom: string | null = null;
  let customMetaStr = '';

  if (customerName && customerName.includes(' | ')) {
    const parts = customerName.split(' | ');
    companyName = parts[0].trim();
    contactNameQuery = parts[1].trim();
    if (parts[2]) {
      customMetaStr = parts.slice(2).join(' | ').trim();
      try {
        customMeta = Object.fromEntries(new URLSearchParams(customMetaStr));
        reviseFrom = customMeta.revise_from || null;
      } catch (err) {
        console.warn(`[insertDraftQuotations] parse metadata ไม่สำเร็จ (userId=${userId}) meta="${customMetaStr}"`, err);
      }
    }
  }

  let customerCode = '';
  let customerTaxId = '';
  let contactName = contactNameQuery || '';
  let contactPhone = '';
  let contactEmail = '';
  let contactAddress = '';
  let paymentTerms = '';

  if (companyName) {
    try {
      let custData = null;
      // แถวที่ค้นเจอเป็น "ผู้ติดต่อคนที่ใบนี้พูดถึงจริง ๆ" หรือเป็นแค่ "แถวตัวแทนของบริษัท"
      //
      // 1 บริษัท = หลายแถวใน view (แถวละผู้ติดต่อ) เวลายังไม่รู้ว่าผู้ติดต่อคือใคร (สถานะ
      // pending_*) การหยิบแถวไหนมาก็ได้แล้วเอา contact_name/เบอร์/อีเมลของแถวนั้นมาใส่
      // = ยัดผู้ติดต่อคนอื่นให้ใบเสนอราคาแล้วทับชื่อที่เซลส์พิมพ์มาทิ้ง
      // (เคสจริง 2026-08-07: เซลส์พิมพ์ "คุณขยัน" แต่ใบได้ "การตลาด" ซึ่งเป็นผู้ติดต่อคนแรก
      //  ของบริษัทที่ชื่อพ้องกัน แล้วชื่อที่พิมพ์มาก็หายถาวรตั้งแต่ก่อนกดเลือกบริษัท)
      // ธงนี้จึงกำหนดว่าแถวที่ได้มา "ใช้เป็นข้อมูลระดับบุคคลได้ไหม" — ระดับบริษัท
      // (รหัสลูกค้า/เลขภาษี/เครดิต/ที่อยู่) ใช้ได้เสมอเพราะทุกแถวของบริษัทให้ค่าเดียวกัน
      let custDataIsTheContact = false;

      // 2.1 ใช้ ID ดึงตรงจาก customers_data_view (ครอบคลุม orphan จาก sale_orders + enrich payment/type)
      // และ orphan มี customerId+contactId เสมอจึงเข้า path นี้ (view lookup by (company_id,contact_id) = ~3ms)
      if (customerId && contactId) {
        const custRes = await pool.query(
          'SELECT * FROM customers_data_view WHERE company_id = $1 AND contact_id = $2 LIMIT 1',
          [customerId, contactId]
        );
        custData = custRes.rows[0];
        if (custData) custDataIsTheContact = true;   // ระบุ contact_id มาเอง = ชี้ตัวบุคคลแล้ว
      }
      if (customerId && !custData) {
        if (contactNameQuery) {
          const custRes = await pool.query(
            `SELECT * FROM customers_data_view WHERE company_id = $1 AND TRIM(contact_name) = TRIM($2)
             ORDER BY contact_id LIMIT 1`,
            [customerId, contactNameQuery]
          );
          custData = custRes.rows[0];
          if (custData) custDataIsTheContact = true; // ชื่อตรงกับที่เซลส์พิมพ์ = คนเดียวกัน
        }
        if (!custData) {
          const custRes = await pool.query(
            'SELECT * FROM customers_data_view WHERE company_id = $1 ORDER BY contact_id LIMIT 1',
            [customerId]
          );
          custData = custRes.rows[0];                // แถวตัวแทนบริษัทเท่านั้น — ไม่ใช่ผู้ติดต่อของใบนี้
        }
      }

      // 2.2 Fallback: ยังไม่รู้ company_id → ค้นด้วยชื่อแบบ TRIM ป้องกันช่องว่างส่วนเกิน
      // คง customers ไว้ (ไม่ใช้ view) เพราะเร็วกว่า และเป็นตารางที่มีเฉพาะบริษัทจริงจาก Odoo
      // ซึ่งมีค่าระดับบริษัท (เครดิต/ประเภท) ครบ — แถวที่มีแต่ใน sale_orders ไม่มีค่าพวกนี้
      // แต่ต้องมี ORDER BY เสมอ ไม่งั้นชื่อบริษัทที่ซ้ำกันหลาย company_id จะคืนแถวไม่คงที่ในแต่ละครั้ง
      if (!custData) {
        if (contactNameQuery) {
          const custRes = await pool.query(
            `SELECT * FROM customers
              WHERE TRIM(customer_name) = TRIM($1) AND TRIM(contact_name) = TRIM($2)
              ORDER BY company_id, contact_id LIMIT 1`,
            [companyName, contactNameQuery]
          );
          custData = custRes.rows[0];
          if (custData) custDataIsTheContact = true;
        }
        if (!custData) {
          const custRes = await pool.query(
            `SELECT * FROM customers WHERE TRIM(customer_name) = TRIM($1)
              ORDER BY company_id, contact_id LIMIT 1`,
            [companyName]
          );
          custData = custRes.rows[0];                // แถวตัวแทนบริษัทเท่านั้น
        }
      }

      if (custData) {
        // ── ระดับบริษัท: ใช้ได้ไม่ว่าแถวที่ได้จะเป็นผู้ติดต่อคนไหน ──
        companyName = companyNameOfRow(custData, companyName);
        customerCode = custData.customer_reference || '';
        customerTaxId = custData.customer_tax_id || '';
        paymentTerms = custData.customer_payment_terms || '';

        // ── ระดับบุคคล: ใช้ได้เฉพาะเมื่อพิสูจน์แล้วว่าเป็นผู้ติดต่อของใบนี้จริง ──
        // ไม่ใช่ → คงชื่อที่เซลส์พิมพ์ไว้ตามเดิม (ไม่มีให้พิมพ์ก็ปล่อยว่าง = ยังไม่รู้ว่าใคร
        // ซึ่งตรงกับความจริง และใบสถานะ pending_* ยืนยันไม่ได้อยู่แล้ว)
        if (custDataIsTheContact) {
          contactName = custData.contact_name || contactNameQuery || '';

          if (custData.contact_mobile && custData.contact_mobile.trim()) {
            contactPhone = custData.contact_mobile.trim();
          } else if (custData.contact_phone && custData.contact_phone.trim()) {
            contactPhone = custData.contact_phone.trim();
          } else if (custData.phone && custData.phone.trim()) {
            contactPhone = custData.phone.trim();
          } else if (custData.mobile && custData.mobile.trim()) {
            contactPhone = custData.mobile.trim();
          }

          const emails = [];
          if (custData.contact_email && custData.contact_email.trim()) {
            emails.push(custData.contact_email.trim());
          }
          if (custData.email && custData.email.trim()) {
            emails.push(custData.email.trim());
          }
          const uniqueEmails = Array.from(new Set(emails));
          contactEmail = uniqueEmails.length > 0 ? uniqueEmails.join(', ') : '';
        } else {
          contactName = contactNameQuery || '';
          // เบอร์/อีเมลของบริษัท (ไม่ใช่ของผู้ติดต่อคนใดคนหนึ่ง) ยังใช้ได้
          if (custData.phone && custData.phone.trim()) {
            contactPhone = custData.phone.trim();
          } else if (custData.mobile && custData.mobile.trim()) {
            contactPhone = custData.mobile.trim();
          }
          contactEmail = custData.email && custData.email.trim() ? custData.email.trim() : '';
        }

        // ที่อยู่ดึงจาก customers_data_view (ผ่าน getContactById) เพราะ view blend อำเภอ/ตำบลที่ขาดจาก sale_orders ล่าสุดให้
        let addrSrc: any = custData;
        if (custData.contact_id) {
          const viewContact = await getContactById(custData.contact_id);
          if (viewContact) addrSrc = viewContact;
        }

        contactAddress = buildThaiAddress(addrSrc);
      }
    } catch (err) {
      console.error('[insertDraftQuotations] Error fetching customer details:', err);
    }
  }

  if (customMeta) {
    if (customMeta.tax_id) customerTaxId = customMeta.tax_id;
    if (customMeta.phone) contactPhone = customMeta.phone;
    if (customMeta.email) contactEmail = customMeta.email;
    if (customMeta.address) contactAddress = customMeta.address;
  }

  // เครดิตที่คนออกใบตั้งทับ — ทับ *หลัง* custom_meta เพราะเป็นค่าที่เพิ่งพิมพ์มากับคำขอนี้
  // `null`/ไม่ส่ง = ใช้ของลูกค้าตามเดิม · สตริงว่าง = ตั้งใจให้ใบนี้ไม่มีเครดิต (คนละความหมาย)
  const paymentTermsOverride = overrides?.paymentTerms ?? null;
  if (paymentTermsOverride !== null) paymentTerms = paymentTermsOverride;

  // ยังไม่ได้ผูกลูกค้า = null (ระบบอนุญาตเฉพาะลูกค้าที่มีในฐานข้อมูล ไม่มีค่า default อีกแล้ว)
  const customerDetails = {
    customer_name: companyName || null,
    customer_code: customerCode,
    customer_tax_id: customerTaxId,
    contact_name: contactName || null,
    phone: contactPhone,
    email: contactEmail,
    address: contactAddress,
    payment_terms: paymentTerms,
    /**
     * ธงบอกว่า `payment_terms` ข้างบนเป็นค่าที่ "คนสั่งทับ" ไม่ใช่ค่าที่อ่านมาจากลูกค้า
     *
     * ⚠️ จำเป็นเพราะ **ทุกจุดที่บันทึกใบจะประกอบ `customer_details` ใหม่จาก `customers_data_view`**
     *    (ที่นี่ และ `PUT /api/quotation/:id`) ⇒ ถ้าไม่ทิ้งร่องรอยไว้ การกดบันทึกครั้งถัดไป
     *    จะเขียนเครดิตกลับเป็นของลูกค้าเงียบ ๆ — ปัญหาที่ docs/plan-web-quote-request.md §4.1
     *    ทำนายไว้ตั้งแต่ก่อนลงมือ · null = ไม่ได้ทับ (ใบของ LINE ทุกใบเป็นแบบนี้)
     */
    payment_terms_override: paymentTermsOverride,
    revise_from: reviseFrom,
    custom_meta: customMetaStr
  };

  const draftQuotesToInsert: any[] = [];

  /** กำหนดส่งที่ตั้งทับของใบนั้น — ไม่ส่งมา = null ซึ่งคือค่าที่คอลัมน์นี้เคยเป็นมาตลอด */
  const deliveryOf = (company: 'PM' | 'THT') => ({
    delivery_type_override: overrides?.delivery?.[company]?.type ?? null,
    delivery_days_override: overrides?.delivery?.[company]?.days ?? null,
  });

  if (pmItems.length > 0) {
    const pmSum = sumLineTotals(pmItems);
    const itemDetails = await buildItemSnapshots(pmItems);
    draftQuotesToInsert.push({
      user_id: userId,
      total_sum: pmSum,
      status: status,
      customer_details: customerDetails,
      item_details: itemDetails,
      salesperson_id: salespersonIdStr,
      employee_details: employeeDetails,
      customer_id: customerId || null,
      contact_id: contactId || null,
      ...deliveryOf('PM')
    });
  }

  if (thtItems.length > 0) {
    const thtSum = sumLineTotals(thtItems);
    const itemDetails = await buildItemSnapshots(thtItems);
    draftQuotesToInsert.push({
      user_id: userId,
      total_sum: thtSum,
      status: status,
      customer_details: customerDetails,
      item_details: itemDetails,
      salesperson_id: salespersonIdStr,
      employee_details: employeeDetails,
      customer_id: customerId || null,
      contact_id: contactId || null,
      ...deliveryOf('THT')
    });
  }

  // DELETE ร่างเดิม + INSERT ใบใหม่ ใน transaction เดียว (atomic) — enrich ทำนอก tx เสมอ
  // เพราะ enrichQuotationData ผูกกับ pool ตรง ๆ ถ้าเรียกใน tx จะขอ connection ซ้อนจนตัน
  let insertedRaw: any[];
  try {
    insertedRaw = await withTransaction(async (client) => {
      if (!preserveDrafts) {
        // ⚠️ `price_approval IS NULL` คือของใหม่ 2026-09-15 และขาดไม่ได้ — ร่างที่ "รออนุมัติราคา"
        //    ค้างอยู่ใน DB จริงระหว่างรอคน (ต่างจากร่างปกติของหน้าเว็บที่อยู่ไม่ถึงสองวินาที)
        //    ถ้าไม่เว้นไว้ แอดมินคนเดิมออกใบให้เซลส์คนเดิมอีกใบ = คำขอที่รออยู่หายทั้งใบเงียบ ๆ
        await client.query(
          `DELETE FROM quotations
            WHERE user_id = $1
              AND status IN ('pending_company', 'pending_contact', 'draft')
              AND price_approval IS NULL`,
          [userId]
        );
      }
      const rows: any[] = [];
      for (const q of draftQuotesToInsert) {
        const res = await client.query(`
          INSERT INTO quotations (
            user_id, total_sum, status,
            customer_details, item_details, salesperson_id, employee_details,
            customer_id, contact_id,
            delivery_type_override, delivery_days_override
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `, [
          q.user_id, q.total_sum, q.status,
          JSON.stringify(q.customer_details), JSON.stringify(q.item_details), q.salesperson_id, JSON.stringify(q.employee_details),
          q.customer_id,
          q.contact_id,
          q.delivery_type_override,
          q.delivery_days_override
        ]);
        if (res.rows[0]) rows.push(res.rows[0]);
      }
      return rows;
    });
  } catch (err) {
    console.error("[insertDraftQuotations] Database Insert Error:", err);
    return null;
  }

  // ค่าขนส่งอัตโนมัติ — ต้องทำหลัง COMMIT เพราะกฎคิดจากยอดรวมของ "ทุกใบในกลุ่ม"
  // ซึ่งเพิ่งมีครบตอนนี้ แล้วอ่านแถวกลับมาใหม่เพื่อให้ผู้เรียกได้ item_details ล่าสุด
  await applyShippingFeeToQuoteGroup(userId, incomingFee);
  const insertedIds = insertedRaw.map((row: any) => row.id);
  if (insertedIds.length > 0) {
    try {
      const { rows: refreshed } = await pool.query(
        'SELECT * FROM quotations WHERE id = ANY($1)',
        [insertedIds]
      );
      // เรียงตามลำดับที่ INSERT ไว้เดิม (ผู้เรียกใช้ insertedQuotes[0] เป็นใบหลัก)
      const byId = new Map(refreshed.map((row: any) => [row.id, row]));
      insertedRaw = insertedIds.map((id: any) => byId.get(id) ?? insertedRaw.find((r: any) => r.id === id));
    } catch (err) {
      console.error('[insertDraftQuotations] อ่านใบกลับหลังปรับค่าขนส่งไม่สำเร็จ — ใช้ค่าก่อนปรับ', err);
    }
  }

  const insertedQuotes: any[] = [];
  for (const row of insertedRaw) {
    insertedQuotes.push(await enrichQuotationData(row));
  }
  return insertedQuotes;
}

/**
 * ค้นหาข้อมูลสินค้าจากรหัสสินค้า (Product Code)
 */
export async function getProductInfo(code: string, executor: DbExecutor = pool): Promise<any> {
  try {
    const { rows } = await executor.query(`
      SELECT 
        model AS code, 
        name, 
        brand, 
        series, 
        production, 
        product_template_id
      FROM products
      WHERE model = $1
      ORDER BY quantity_on_hand_unreserved DESC
      LIMIT 1
    `, [code]);
    return rows[0] || null;
  } catch (err) {
    console.error(`Error fetching product info for code ${code}:`, err);
    return null;
  }
}

export interface BlockViolation {
  type: 'BLOCKED';
  model: string;
  name: string;
  warn_msg: string | null;
}

/**
 * ตรวจว่ามีบรรทัดไหนติดกฎบล็อกสินค้า (product_block_rules) — คืนครบทุกบรรทัดที่ผิด
 *
 * ทรงเดียวกับ checkMinOrderQty: lookup รอบเดียวด้วย ANY($1) แล้ววนของในหน่วยความจำ
 * (ของเดิมเรียก getProductInfo ทีละ item ในลูป = N+1 query และ return ทันทีที่เจอตัวแรก
 *  เซลล์จึงเห็นทีละรายการ ต้องแก้แล้วกดใหม่ซ้ำ ๆ กว่าจะรู้ว่าติดกี่ตัว)
 *
 * ⚠️ ข้ามบรรทัดค่าขนส่ง — มันมี internal_reference จริง (SOFBLDXXXX0010) กฎระดับ ref
 * จึงเผลอครอบมันได้ ถ้าโดนจะออกใบไม่ได้ทั้งใบ ทั้งที่ pdfGenerator ข้ามบรรทัดนี้อยู่แล้ว
 */
export async function checkBlockedProducts(items: any[] | null): Promise<BlockViolation[]> {
  if (!items || items.length === 0) return [];

  let rules: any[] = [];
  try {
    rules = await loadProductBlockRules();
  } catch (err) {
    console.error('Error fetching product block rules for blocking validation:', err);
    throw err;   // fail-closed — ผู้เรียกจะเปลี่ยนเป็น SYSTEM_ERROR ให้เอง
  }
  if (rules.length === 0) return [];

  const { isShippingFeeItem, loadShippingFeeConfig } = await import('./shippingFee.js');
  const shippingCfg = await loadShippingFeeConfig();

  const targets = items.filter(i => !isShippingFeeItem(i, shippingCfg));
  const codes = Array.from(new Set(
    targets.map(i => String(i.product_code || i.model || i.code || '').trim()).filter(Boolean)
  ));
  if (codes.length === 0) return [];

  // DISTINCT ON (btrim(model)) + ORDER BY เดียวกับ getProductInfo — สินค้ารหัสเดียวกันมีได้หลายแถว
  // ต้องเลือกแถวเดิมกับที่จุดอื่นเลือก ไม่งั้น scope อาจต่างกันแล้วผลบล็อกไม่ตรงกัน
  //
  // ⚠️ ต้องเทียบด้วย btrim ทั้งสองฝั่ง ห้ามใช้ `model = ANY($1)` เฉย ๆ
  // ข้อมูลจาก Odoo มีสินค้าที่ model ติดช่องว่างหัว/ท้ายมาจริง (เช่น 'FP-108-1 220 V.U1BW ')
  // รหัสที่ส่งเข้ามาถูก trim ไปแล้วข้างบน เทียบตรง ๆ จะไม่เจอแถว → ไม่มี scope → หลุดด่านเงียบ ๆ
  // เจอตอนตรวจหลัง deploy 2026-09-07: สินค้าที่ต้องถูกบล็อก 3 ตัวออกใบได้ตามปกติ
  // ยอมแลกเป็น seq scan (~33ms บนสินค้า 51k แถว) เพราะด่านที่ปล่อยของหลุดแย่กว่าด่านที่ช้าขึ้น 30ms
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (btrim(model))
           btrim(model) AS code, btrim(model) AS model,
           name, brand, series, production, internal_reference
      FROM products
     WHERE btrim(model) = ANY($1)
     ORDER BY btrim(model), quantity_on_hand_unreserved DESC
  `, [codes]);

  const prodMap = new Map(rows.map((r: any) => [r.code, r]));
  const violations: BlockViolation[] = [];

  for (const item of targets) {
    const code = String(item.product_code || item.model || item.code || '').trim();
    if (!code) continue;

    const prod = prodMap.get(code);
    if (!prod) continue;   // ไม่มีในคลัง = ไม่มี scope ให้ตัดสิน ปล่อยให้ด่านอื่นจัดการ

    const rule = findBlockingRule(rules as any, normalizeProductScope(prod));
    if (!rule) continue;

    violations.push({
      type: 'BLOCKED' as const,
      model: prod.code,
      name: prod.name,
      warn_msg: blockWarnText(rule as any)
    });
  }

  return violations;
}

export interface MoqViolation {
  type: 'MOQ_VIOLATION';
  model: string;
  name: string;
  qty: number;
  min_order_qty: number;
  warn_msg: string;
}

export async function checkMinOrderQty(
  items: any[] | null
): Promise<MoqViolation[]> {
  if (!items || items.length === 0) return [];

  const productIds = items
    .map(i => i.product_template_id ?? i.product_id)
    .filter(Boolean);

  if (!productIds.length) return [];

  const { rows } = await pool.query(`
    SELECT
      p.product_template_id AS product_id,
      pmr.min_order_qty,
      pmr.sale_line_warn_msg,
      p.model,
      p.name
    FROM product_moq_rules pmr
    JOIN products p ON p.internal_reference = pmr.internal_reference
    WHERE p.product_template_id = ANY($1)
      AND pmr.is_active = true
  `, [productIds]);

  if (!rows.length) return [];

  const ruleMap = new Map(rows.map((r: any) => [r.product_id, r]));
  const violations: MoqViolation[] = [];

  for (const item of items) {
    const pid = item.product_template_id ?? item.product_id;
    const rule = ruleMap.get(pid);
    if (!rule) continue;

    const qty = item.qty ?? item.quantity ?? 0;
    if (qty >= rule.min_order_qty) continue;

    violations.push({
      type: 'MOQ_VIOLATION' as const,
      model: rule.model,
      name: rule.name,
      qty,
      min_order_qty: rule.min_order_qty,
      warn_msg: rule.sale_line_warn_msg,
    });
  }

  return violations;
}

export interface MinPriceViolation {
  type: 'MIN_PRICE_VIOLATION';
  model: string;
  price: number;      // ราคาต่อหน่วยหลังหักส่วนลดแล้ว
  min_price: number;  // minimum_sales_price ของสินค้า
  warn_msg: string;
}

/**
 * ตรวจว่าราคาหลังหักส่วนลดของทุกบรรทัด >= minimum_sales_price ของสินค้านั้น
 * ยกเว้นเข้าเงื่อนไขโปรโมชันที่ active อยู่ (validateProductPriceWithPromotions)
 *
 * ⚠️ เป็นจุดเดียวของกฎ "ห้ามขายต่ำกว่าราคาขั้นต่ำ" — ใช้ทั้งตอนบันทึกจาก LIFF (PUT /api/quotation/:id)
 * และตอนยืนยันออกเอกสาร (POST /api/quotation/:id/confirm, postback action=confirm)
 * ห้ามก๊อปตรรกะนี้ไปเขียนซ้ำที่อื่น ไม่งั้นกฎจะเพี้ยนกันคนละที่
 *
 * โยน error เมื่อดึงราคาขั้นต่ำไม่ได้ (fail-closed — ห้ามปล่อยผ่านทั้งที่ยังไม่ได้ตรวจ)
 * ส่วนข้อมูลลูกค้า/โปรโมชันถ้าดึงไม่ได้จะถือว่าไม่มีโปรโมชันช่วย (เข้มไว้ก่อน)
 */
export async function checkMinSalesPrice(
  items: any[] | null,
  customerName?: string | null
): Promise<MinPriceViolation[]> {
  if (!items || items.length === 0) return [];

  const productCodes = items.map((item: any) => item.model || item.product_code).filter(Boolean);
  if (productCodes.length === 0) return [];

  const prodRes = await pool.query(
    'SELECT model AS code, minimum_sales_price FROM products WHERE model = ANY($1)',
    [productCodes]
  );
  const minPriceMap: Record<string, number> = {};
  prodRes.rows.forEach((p: any) => {
    minPriceMap[p.code] = parseFloat(p.minimum_sales_price) || 0;
  });

  // ชื่อบริษัทใช้เช็คสิทธิ์โปรโมชัน (customer_type / reference)
  let companyName = (customerName || '').trim();
  if (companyName.includes(' | ')) {
    companyName = companyName.split(' | ')[0].trim();
  }

  let customerData = null;
  if (companyName) {
    try {
      const custRes = await pool.query(
        `SELECT DISTINCT ON (company_id) customer_type, customer_reference AS reference
         FROM customers_data_view WHERE customer_name = $1 ORDER BY company_id, contact_id LIMIT 1`,
        [companyName]
      );
      if (custRes.rows.length > 0) {
        customerData = {
          customer_type: custRes.rows[0].customer_type,
          reference: custRes.rows[0].reference
        };
      }
    } catch (err) {
      console.error('[checkMinSalesPrice] fetch customer error:', err);
    }
  }

  let activePromos: any[] = [];
  try {
    const promoRes = await pool.query('SELECT * FROM promotions WHERE is_active = true');
    activePromos = promoRes.rows;
  } catch (err) {
    console.error('[checkMinSalesPrice] fetch promotions error:', err);
  }

  const violations: MinPriceViolation[] = [];
  for (const item of items) {
    const itemKey = item.model || item.product_code;
    if (!itemKey) continue;
    const minPrice = minPriceMap[itemKey] || 0;
    if (minPrice <= 0) continue;

    const discountedPrice = calcNetPrice(item.price, item.discount_1, item.discount_2);
    if (discountedPrice >= minPrice - 0.01) continue;

    // ไม่ผ่านขั้นต่ำปกติ → ยังผ่านได้ถ้าเข้าเงื่อนไขโปรโมชัน
    const promoResult = validateProductPriceWithPromotions(
      itemKey,
      item.quantity || 1,
      discountedPrice,
      minPrice,
      customerData,
      activePromos
    );
    if (promoResult.allowed) continue;

    violations.push({
      type: 'MIN_PRICE_VIOLATION',
      model: itemKey,
      price: discountedPrice,
      min_price: minPrice,
      warn_msg: `ราคาหลังลด ฿${discountedPrice.toFixed(2)} ต่ำกว่าขั้นต่ำ ฿${minPrice.toFixed(2)} และไม่เข้าเงื่อนไขโปรโมชัน`
    });
  }

  return violations;
}

export type ValidationError = StockViolation | MoqViolation;

export async function validateAndPrepareItems(items: any[] | null): Promise<{
  items: any[];
  errors: ValidationError[];
}> {
  if (!items || items.length === 0) {
    return { items: [], errors: [] };
  }

  // Step 1: Expand optional products (F2)
  const expanded = await expandOptionalProducts(items);

  // Step 2: Check stock rules (F4)
  const stockErrors = await checkStockRules(expanded);

  // Step 3: Check MOQ (F3)
  const moqErrors = await checkMinOrderQty(expanded);

  const errors: ValidationError[] = [...stockErrors, ...moqErrors];

  return { items: expanded, errors };
}

/**
 * ด่านตรวจกฎเดียวของทั้งระบบ — ทุกเส้นทาง draft/save/confirm/revision เรียกตัวนี้
 * ลำดับ: blacklist ลูกค้า → expand optional → blocked → stock → MOQ → min-price เหนือ "ทุกบรรทัด"
 * fail-closed: check ใด throw → คืน SYSTEM_ERROR violation ให้ผู้เรียก reject เสมอ
 * stage เป็น metadata สำหรับ log เท่านั้น (ชุดกฎเท่ากันทุก stage)
 *
 * เงื่อนไขใหม่ของการออกใบเสนอราคาให้เพิ่มที่นี่ที่เดียว — ทุก call site ได้ผลทันทีทั้ง 3 stage
 * (ดู docs/plan-user-roles-auth.md §4.4 สำหรับผังว่าใครเรียกจากตรงไหนบ้าง)
 *
 * customerId/contactId ไม่ใส่มาก็ได้ — เส้นทางที่ยังไม่รู้ว่าลูกค้าคือใคร (สถานะ pending_company)
 * จะข้ามการตรวจ blacklist ไปเอง ส่วนเส้นทางที่รู้แล้วต้องส่งมาเสมอ
 */
export async function validateQuotationItems(
  items: any[] | null,
  opts: {
    customerName?: string | null;
    customerId?: unknown;
    contactId?: unknown;
    stage: ValidationStage;
  }
): Promise<{ items: any[]; violations: Violation[] }> {
  const violations: Violation[] = [];
  let expanded: any[] = items ?? [];

  // เงื่อนไขระดับ "ลูกค้า" — ตรวจก่อนรายการสินค้าเสมอ และตรวจแม้ใบยังไม่มีสินค้าสักบรรทัด
  // ทั้งสองด่านอยู่ใน try เดียวกันเพราะเป็น fail-closed เหมือนกัน: ตรวจไม่สำเร็จ = ห้ามออกใบ
  // และแจ้งพร้อมกันได้ถ้าติดทั้งคู่ (คนละสาเหตุ เซลล์ต้องรู้ทั้งสองอย่างก่อนไปหาแอดมิน)
  try {
    if (await isBlacklisted(opts.customerId, opts.contactId)) {
      const v: Omit<Violation, 'display_message'> = { type: 'CUSTOMER_BLACKLISTED', model: '-' };
      violations.push({ ...v, display_message: buildViolationDisplay(v) });
    }

    const credit = await checkCreditHold(opts.customerId);
    if (credit.held) violations.push(creditHoldViolation(credit));
  } catch (err) {
    console.error(`[validateQuotationItems] stage=${opts.stage} customer gate failed (blacklist/credit, fail-closed):`, err);
    const v: Omit<Violation, 'display_message'> = { type: 'SYSTEM_ERROR', model: '-' };
    return { items: expanded, violations: [{ ...v, display_message: buildViolationDisplay(v) }] };
  }

  if (!items || items.length === 0) return { items: expanded, violations };

  try {
    expanded = await expandOptionalProducts(items);

    // blocked — รายงานครบทุกบรรทัดพร้อมรหัสสินค้าจริง (เดิมบอกได้ทีละ 1 รายการ และ model เป็น '-')
    const blockErrors = await checkBlockedProducts(expanded);
    for (const e of blockErrors) {
      const v: Omit<Violation, 'display_message'> = {
        type: 'BLOCKED', model: e.model, warn_msg: e.warn_msg ?? undefined
      };
      violations.push({ ...v, display_message: buildViolationDisplay(v) });
    }

    // stock
    const stockErrors = await checkStockRules(expanded);
    for (const e of stockErrors) {
      const v: Omit<Violation, 'display_message'> = {
        type: 'OUT_OF_STOCK', model: e.model, warn_msg: e.warn_msg,
        is_optional: e.is_optional, linked_to_model: e.linked_to_model,
        quantity_on_hand_unreserved: e.quantity_on_hand_unreserved,
        qty: e.qty
      };
      violations.push({ ...v, display_message: buildViolationDisplay(v) });
    }

    // MOQ
    const moqErrors = await checkMinOrderQty(expanded);
    for (const e of moqErrors) {
      const v: Omit<Violation, 'display_message'> = {
        type: 'MOQ_VIOLATION', model: e.model, warn_msg: e.warn_msg, min_order_qty: e.min_order_qty, qty: e.qty
      };
      violations.push({ ...v, display_message: buildViolationDisplay(v) });
    }

    // min-price
    const priceErrors = await checkMinSalesPrice(expanded, opts.customerName ?? null);
    for (const e of priceErrors) {
      const v: Omit<Violation, 'display_message'> = {
        type: 'MIN_PRICE_VIOLATION', model: e.model, warn_msg: e.warn_msg, price: e.price, min_price: e.min_price
      };
      violations.push({ ...v, display_message: buildViolationDisplay(v) });
    }
  } catch (err) {
    console.error(`[validateQuotationItems] stage=${opts.stage} check failed (fail-closed):`, err);
    const v: Omit<Violation, 'display_message'> = { type: 'SYSTEM_ERROR', model: '-' };
    return { items: expanded, violations: [{ ...v, display_message: buildViolationDisplay(v) }] };
  }
  return { items: expanded, violations };
}

export async function processQuotationRequest(userId: string, rawCustomerQuery: string, rawContactQuery: string, itemsForDb: any[] | null, salesperson: any): Promise<any> {
  const { items: expanded, violations } = await validateQuotationItems(itemsForDb, { stage: 'draft' });
  if (violations && violations.length > 0) {
    return { text: buildViolationText(violations) };
  }

  let cleanCust = String(rawCustomerQuery || '').trim();
  let cleanCont = String(rawContactQuery || '').trim();

  // Backstop: ลูกค้า+ผู้ติดต่อพิมพ์มาบรรทัด/ก้อนเดียว เช่น "บ.เคยู  คุณจิตติพงษ์" —
  // แยกส่วน คุณY ออกเป็น contact เฉพาะเมื่อยังไม่มี contact query (AI prompt rule 14 เป็นด่านแรก นี่คือด่านกันเหนียว)
  if (cleanCust && !cleanCont) {
    const split = splitCustomerContact(cleanCust);
    if (split.contact) {
      console.log(`[processQuotationRequest] split same-line customer/contact: "${split.customer}" + "${split.contact}"`);
      cleanCust = split.customer;
      cleanCont = split.contact;
    }
  }

  if (!cleanCust && !cleanCont) {
    return { text: "รบกวนระบุชื่อบริษัท/ลูกค้า และชื่อผู้ติดต่อด้วยครับ 🏢👤" };
  }

  // Case 1: No company query provided, only contact query (e.g. cleanCont = "อธิชาต")
  if (!cleanCust) {
    const rawName = ` | ${cleanCont}`;
    const insertedQuotes = await insertDraftQuotations(userId, rawName, expanded, 'pending_company');
    if (!insertedQuotes || insertedQuotes.length === 0) {
      return { text: "❌ ไม่สามารถบันทึกข้อมูลใบเสนอราคาได้" };
    }
    return { text: "รบกวนระบุชื่อบริษัท/ลูกค้าด้วยครับ 🏢" };
  }

  // Find customer candidates
  const customerCandidates = await findCustomerCandidates(cleanCust, salesperson, cleanCont);

  // Case 2: No customer candidates found
  if (customerCandidates.length === 0) {
    // Try to see if this represents a contact query in the database instead
    const customerCandidatesFromContact = await findCustomerByContactName(cleanCust, salesperson);

    if (customerCandidatesFromContact.length === 1 && customerCandidatesFromContact[0].score < 0.45) {
      // Automatically match!
      const selectedCompany = customerCandidatesFromContact[0].display_name;
      const selectedCustomerId = customerCandidatesFromContact[0].id;
      const matchedContactName = customerCandidatesFromContact[0].contact_name;

      return await resolveContactFlow(userId, null, selectedCustomerId, selectedCompany, matchedContactName, expanded, salesperson);
    }

    if (customerCandidatesFromContact.length > 1) {
      // Ambiguous contact matches across multiple companies
      const rawName = ` | ${cleanCust}`; // Save cleanCust as contact query
      const insertedQuotes = await insertDraftQuotations(userId, rawName, expanded, 'pending_company');
      if (!insertedQuotes || insertedQuotes.length === 0) {
        return { text: "❌ ไม่สามารถบันทึกข้อมูลใบเสนอราคาได้" };
      }

      return createListFlexMessage(
        "🏢 เลือกบริษัทที่ต้องการเสนอราคา",
        `พบผู้ติดต่อชื่อ "${cleanCust}" ในหลายบริษัทดังนี้ครับ กรุณาเลือกบริษัทที่ต้องการเสนอราคาครับ 👇`,
        customerCandidatesFromContact.slice(0, 12).map((c: any) => ({
          label: formatLineLabel(c.display_name),
          data: `action=select_company&custId=${c.id}`,
          displayText: `เลือก ${c.display_name}`
        }))
      );
    }

    // Fallback: Save as pending company query
    const rawName = `${cleanCust} | ${cleanCont}`;
    const insertedQuotes = await insertDraftQuotations(userId, rawName, expanded, 'pending_company');
    if (!insertedQuotes || insertedQuotes.length === 0) {
      return { text: "❌ ไม่สามารถบันทึกข้อมูลใบเสนอราคาได้" };
    }
    return createUnregisteredCustomerFlex(cleanCust, insertedQuotes.map((q: any) => q.id).join(','), userId);
  }

  // Case 3: Multiple customer candidates found
  if (customerCandidates.length > 1) {
    // Auto-select if the top candidate is a clear winner (exact/reference/contains match)
    const topScore = customerCandidates[0].score;
    const secondScore = customerCandidates[1].score;
    console.log('[processQuotationRequest] Top candidate:', customerCandidates[0].item.display_name, 'score:', topScore, '| 2nd:', customerCandidates[1].item.display_name, 'score:', secondScore);
    if (topScore <= 0.05 && (secondScore - topScore) > 0.05) {
      console.log('[processQuotationRequest] Auto-selected:', customerCandidates[0].item.display_name);
      const selectedCompany = customerCandidates[0].item.display_name;
      const selectedCustomerId = customerCandidates[0].item.id;
      return await resolveContactFlow(userId, null, selectedCustomerId, selectedCompany, cleanCont, expanded, salesperson);
    }

    const rawName = `${cleanCust} | ${cleanCont}`;
    const insertedQuotes = await insertDraftQuotations(userId, rawName, expanded, 'pending_company');
    if (!insertedQuotes || insertedQuotes.length === 0) {
      return { text: "❌ ไม่สามารถบันทึกข้อมูลใบเสนอราคาได้" };
    }

    return createListFlexMessage(
      "🏢 เลือกบริษัทที่ถูกต้อง",
      `พบชื่อบริษัทใกล้เคียงกับ "${cleanCust}" หลายบริษัทเลยครับ กรุณาเลือกบริษัทที่ถูกต้องด้านล่างนี้ครับ 👇`,
      dedupeIdenticalCompanies(customerCandidates).slice(0, 12).map((c: any) => ({
        label: buildCompanyOptionLabel(c),
        data: `action=select_company&custId=${c.item.id}`,
        displayText: `เลือก ${c.item.display_name}`
      }))
    );
  }

  // Case 4: Exactly one customer candidate found
  const selectedCompany = customerCandidates[0].item.display_name;
  const selectedCustomerId = customerCandidates[0].item.id;

  return await resolveContactFlow(userId, null, selectedCustomerId, selectedCompany, cleanCont, expanded, salesperson);
}

export async function resolveContactFlow(
  userId: string,
  existingQuoteIdsStr: string | null,
  customerId: any,
  companyName: string,
  contactQuery: string,
  itemsForDb: any[] | null,
  salesperson: any
): Promise<any> {
  // ด่าน blacklist ระดับบริษัท — ต้องอยู่บนสุด "ก่อน" เขียน DB ทุกบรรทัดในฟังก์ชันนี้
  //
  // ทำไมต้องมีด่านแยกตรงนี้ ทั้งที่ validateQuotationItems เป็นด่านกลาง: ใน flow ของ LINE
  // ด่านกลางทำงานตั้งแต่ตอนที่ยังไม่รู้ว่าลูกค้าคือใคร (processQuotationRequest ตรวจสินค้า
  // แล้วค่อยไปค้นหาบริษัท) — เงื่อนไขระดับลูกค้าจึงตรวจได้ก็ต่อเมื่อมาถึงจุดนี้
  //
  // ฟังก์ชันนี้ถูกเรียกเฉพาะตอนใบอยู่สถานะ pending_company/pending_contact ซึ่งยังไม่เคยผูก
  // ลูกค้ามาก่อน = เป็นการ "ผูกใหม่" เสมอ จึงบล็อกได้เต็มที่โดยไม่ไปโดนร่างที่ค้างอยู่
  //
  // คืน { text } แทนการ throw เพราะเป็น shape ที่ caller ทุกที่รองรับอยู่แล้ว (reply ผ่าน
  // replyToken เดิม ไม่ต้องแก้ caller สักจุด และไม่มีทางเผา replyToken ทิ้งด้วย error ที่ไม่ได้ดัก)
  try {
    if (await isBlacklisted(customerId, null)) {
      return { text: buildViolationText([blacklistViolation()]) };
    }

    // ด่านเครดิตอยู่ระดับบริษัทล้วน ไม่เกี่ยวกับผู้ติดต่อ จึงตรวจตรงนี้ได้เลยทั้งที่ยังไม่รู้ว่า
    // เซลล์จะเลือกผู้ติดต่อคนไหน · ถ้าหลังจากนี้ใบถูกย้ายไปผูกบริษัทพี่น้อง (resolvedCustomerId
    // ด้านล่าง) ก็ไม่ต้องตรวจซ้ำ เพราะ last_order_at เป็นค่าระดับนิติบุคคล ทุกรหัสในกลุ่มได้ค่าเดียวกัน
    const credit = await checkCreditHold(customerId);
    if (credit.held) {
      return { text: buildViolationText([creditHoldViolation(credit)]) };
    }
  } catch (err) {
    console.error('[resolveContactFlow] customer gate failed (blacklist/credit, fail-closed):', err);
    return { text: buildViolationText([systemErrorViolation()]) };
  }

  const contactCandidates = await findContactCandidates(customerId, contactQuery);

  // ค้นหาผู้ติดต่อที่ชื่อตรงเป๊ะ (Exact Match) หลังทำความสะอาดชื่อ (ตัดคำนำหน้าออก)
  const exactMatch = contactCandidates.find((c: any) => {
    const nameA = cleanContactName(c.item.name);
    const nameB = cleanContactName(contactQuery);
    return nameA && nameB && nameA.toLowerCase() === nameB.toLowerCase();
  });

  let finalCandidates = contactCandidates;
  if (exactMatch) {
    // หากเจอสะกดตรงเป๊ะ ให้บังคับใช้คนนี้เป็น candidate หลักคนเดียวทันที
    finalCandidates = [{
      ...exactMatch,
      score: 0 // บังคับ score เป็น 0 เพื่อให้ผ่าน auto-match
    }];
  }

  if (finalCandidates.length === 1 && finalCandidates[0].score < 0.45) {
    const matchedContactName = finalCandidates[0].item.name;
    const contactId = finalCandidates[0].item.id;

    // ผู้ติดต่อที่ค้นเจออาจอยู่ใต้ company_id ของสาขาอื่นในนิติบุคคลเดียวกัน
    // (findContactCandidates ค้นข้ามสาขาให้เมื่อบริษัทที่เลือกตอบไม่ได้ — ดู preferAnchorCompany)
    // ต้องผูกใบเข้ากับบริษัทของ "คนที่เลือกจริง" ไม่ใช่บริษัทที่ค้นเจอตอนแรก ไม่งั้นคู่
    // (customer_id, contact_id) จะชี้แถวที่ไม่มีอยู่ → snapshot/ด่านตรวจ lookup ไม่เจอ
    // เลือกผู้ติดต่อ = เลือกสาขาไปในตัว ชื่อบริษัทที่โชว์จึงต้องเปลี่ยนตามด้วย
    let resolvedCustomerId = customerId;
    let resolvedCompanyName = companyName;
    const contactCompanyId = finalCandidates[0].item.company_id;
    if (contactCompanyId && String(contactCompanyId) !== String(customerId)) {
      const sibling = await getCustomerById(contactCompanyId);
      if (sibling) {
        resolvedCustomerId = contactCompanyId;
        resolvedCompanyName = sibling.display_name || companyName;
        console.log(`[resolveContactFlow] ผู้ติดต่อ "${matchedContactName}" อยู่ใต้บริษัทพี่น้อง → ผูกกับ ${resolvedCompanyName} (${resolvedCustomerId}) แทน ${customerId}`);
      }
    }
    const finalCustomerName = `${resolvedCompanyName} | ${matchedContactName}`;

    // เพิ่งรู้ตัวผู้ติดต่อตรงนี้ — ด่านบนสุดตรวจได้แค่ระดับบริษัท ต้องตรวจระดับผู้ติดต่อซ้ำ
    // ก่อนเขียน DB (ครอบทั้ง updateQuotationCustomerSnapshot และ insertDraftQuotations ด้านล่าง)
    // ใช้คู่ที่จะผูกจริง — บริษัทอาจเปลี่ยนไปเป็นสาขาอื่นจากบล็อกด้านบน
    try {
      if (await isBlacklisted(resolvedCustomerId, contactId)) {
        return { text: buildViolationText([blacklistViolation()]) };
      }
    } catch (err) {
      console.error('[resolveContactFlow] blacklist check (contact) failed (fail-closed):', err);
      return { text: buildViolationText([systemErrorViolation()]) };
    }

    let quotes;
    if (existingQuoteIdsStr) {
      const ids = existingQuoteIdsStr.split(',').filter(Boolean);
      quotes = await updateQuotationCustomerSnapshot(ids, finalCustomerName, 'draft', salesperson, resolvedCustomerId, contactId);
    } else {
      quotes = await insertDraftQuotations(userId, finalCustomerName, itemsForDb, 'draft', resolvedCustomerId, contactId);
    }

    if (!quotes || quotes.length === 0) {
      return { text: "❌ ไม่สามารถบันทึกข้อมูลใบเสนอราคาได้" };
    }

    return {
      success: true,
      quotes: quotes
    };
  }

  let quoteIdsStr = existingQuoteIdsStr;
  if (!quoteIdsStr) {
    const rawName = `${companyName} | ${contactQuery}`;
    const insertedQuotes = await insertDraftQuotations(userId, rawName, itemsForDb, 'pending_contact', customerId, null);
    if (!insertedQuotes || insertedQuotes.length === 0) {
      return { text: "❌ ไม่สามารถบันทึกข้อมูลใบเสนอราคาได้" };
    }
    quoteIdsStr = insertedQuotes.map((q: any) => q.id).join(',');
  } else {
    const ids = quoteIdsStr.split(',').filter(Boolean);
    const customerDetailsTemp = {
      customer_name: `${companyName} | ${contactQuery}`,
      customer_code: '',
      customer_tax_id: '',
      contact_name: contactQuery || '-',
      phone: '-',
      email: '-',
      address: '-',
      payment_terms: '-',
      revise_from: null,
      custom_meta: ''
    };
    
    try {
      const compRes = await pool.query(
        `SELECT DISTINCT ON (company_id) customer_reference AS reference, customer_tax_id AS tax_id, customer_payment_terms AS payment_terms
         FROM customers_data_view WHERE TRIM(customer_name) = TRIM($1) ORDER BY company_id, contact_id LIMIT 1`,
        [companyName]
      );
      if (compRes.rows.length > 0) {
        const row = compRes.rows[0];
        customerDetailsTemp.customer_code = row.reference || '';
        customerDetailsTemp.customer_tax_id = row.tax_id || '';
        customerDetailsTemp.payment_terms = row.payment_terms || '-';
      }
    } catch (err) {
      console.error("Error fetching temp customer in resolveContactFlow:", err);
    }

    try {
      await pool.query(
        `UPDATE quotations 
         SET customer_details = $1, 
             status = 'pending_contact',
             customer_id = $2,
             contact_id = NULL,
             updated_at = NOW()
         WHERE id = ANY($3)`,
        [JSON.stringify(customerDetailsTemp), customerId, ids]
      );
    } catch (err) {
      console.error("Error updating temp contact status in resolveContactFlow:", err);
    }
  }

  // ═══ ปุ่มให้เลือกผู้ติดต่อ — ห้ามปล่อยให้เป็นทางตัน ═══
  // ค้นด้วยชื่อไม่เจอ ไม่ได้แปลว่าบริษัทไม่มีผู้ติดต่อ — Fuse.js คืนศูนย์ผลลัพธ์ได้ง่าย ๆ
  // เมื่อชื่อที่พิมพ์มาไม่ใกล้เคียงใครเลย (เช่นพิมพ์ชื่อคนที่อยู่คนละนิติบุคคล) เดิมกรณีนี้
  // ตอบเป็นข้อความล้วนโดยไม่มีปุ่มสักปุ่ม ทั้งที่บริษัทนั้นมีผู้ติดต่ออยู่จริง เซลส์จึงไปต่อไม่ได้
  // ต้องพิมพ์ "ยกเลิก" แล้วเริ่มใหม่ (วัดจากประวัติจริง 5 วัน: เจอ 6 เคส)
  // → ค้นไม่เจอเมื่อไหร่ ให้ย้อนไปเอารายชื่อทั้งหมดของบริษัทมาให้เลือกแทน
  let optionSource = contactCandidates;
  let usedFallbackList = false;
  if (optionSource.length === 0) {
    optionSource = await findContactCandidates(customerId, '');
    usedFallbackList = optionSource.length > 0;
  }

  // สาขาของผู้ติดต่อแต่ละคน — จำเป็นเมื่อรายชื่อข้ามสาขา ซึ่งตอนนี้เกิดเฉพาะตอนบริษัทที่เซลส์
  // เลือกตอบไม่ได้เลย (ดู preferAnchorCompany ใน services/customerService.ts)
  // ชื่อคนซ้ำกันข้ามสาขาได้จริง (เบียร์ทิพย์มี "คุณธนาพร"/"คุณอัญชลี" ทั้งที่สำนักงานใหญ่และสาขา
  // 00001) ถ้าไม่บอกสาขา เซลส์จะเห็นปุ่มข้อความเหมือนกันเป๊ะสองปุ่มแล้วแยกไม่ออก
  //
  // ใช้ "รหัสลูกค้า" ไม่ใช่ชื่อบริษัท — สั้นกว่ามากจึงไม่ถูกตัดทิ้ง และเป็นตัวที่แยกสาขาได้จริง
  // (ชื่อบริษัทของสาขาต่างกันแค่วงเล็บท้าย ซึ่งจะโดนตัดเป็นอย่างแรก)
  const siblingIds = Array.from(new Set(
    optionSource.slice(0, 11)
      .map((c: any) => c.item.company_id)
      .filter((id: any) => id && String(id) !== String(customerId))));
  const siblingRefs = new Map<string, string>();
  if (siblingIds.length > 0) {
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT ON (company_id) company_id, customer_reference, customer_name
           FROM customers_data_view WHERE company_id = ANY($1) ORDER BY company_id, contact_id`,
        [siblingIds]);
      rows.forEach((r: any) => siblingRefs.set(
        String(r.company_id),
        String(r.customer_reference || '').trim() || formatLineLabel(r.customer_name)));
    } catch (err) {
      console.error('[resolveContactFlow] fetch sibling company refs failed:', err);
    }
  }

  const options: any[] = optionSource.slice(0, 11).map((c: any) => {
    // ตัดเฉพาะชื่อคนที่ยาวผิดปกติ (บาง record ใส่หมายเหตุการวางบิลทั้งย่อหน้ามาเป็นชื่อ)
    // แล้วค่อยต่อรหัสสาขา เพื่อไม่ให้ตัวแยกสาขาโดนตัดทิ้งไปด้วย
    const name = String(c.item.name || '').slice(0, 30);
    const branch = siblingRefs.get(String(c.item.company_id));
    return {
      label: branch ? `${name} · ${branch}` : name,
      data: `action=select_contact&contactId=${c.item.id}`,
      displayText: `เลือกผู้ติดต่อ: ${c.item.name}`
    };
  });

  // ไม่เพิ่มปุ่ม ใช้ชื่อ (Custom Contact Name) ตามคำสั่งของบริษัท เพื่อจำกัดให้เลือกเฉพาะที่มีอยู่ในฐานข้อมูลเท่านั้น

  let responseText = '';
  if (!contactQuery) {
    if (options.length > 0) {
      responseText = `กรุณาเลือกผู้ติดต่อสำหรับบริษัท "${companyName}" จากรายการด้านล่างนี้ได้เลยครับ 👇`;
    } else {
      responseText = `ไม่พบข้อมูลผู้ติดต่อสำหรับบริษัท "${companyName}" ในระบบ\n\nรบกวนติดต่อแอดมินเพื่อเพิ่มข้อมูล หรือพิมพ์ "ยกเลิก" เพื่อยกเลิกใบเสนอราคาครับ`;
    }
  } else {
    if (options.length > 0) {
      responseText = usedFallbackList
        ? `ไม่พบชื่อผู้ติดต่อ "${contactQuery}" ในฐานข้อมูลของบริษัท "${companyName}" ครับ\n\nนี่คือรายชื่อผู้ติดต่อทั้งหมดที่มีอยู่ กรุณาเลือกจากรายการด้านล่าง หรือติดต่อแอดมินเพื่อเพิ่มข้อมูลครับ 👇`
        : `ไม่พบชื่อผู้ติดต่อ "${contactQuery}" ที่ตรงกับฐานข้อมูลของบริษัท "${companyName}" ครับ\n\nกรุณาเลือกรายชื่อผู้ติดต่อจากรายการด้านล่างนี้ หรือติดต่อแอดมินเพื่อเพิ่มข้อมูลก่อนนะครับ 👇`;
    } else {
      responseText = `ไม่พบชื่อผู้ติดต่อ "${contactQuery}" ที่ตรงกับฐานข้อมูลของบริษัท "${companyName}" ในฐานข้อมูลครับ\n\nรบกวนติดต่อแอดมินเพื่อเพิ่มข้อมูลก่อนนะครับ`;
    }
  }

  if (options.length > 0) {
    return createListFlexMessage(
      "👤 เลือกผู้ติดต่อ",
      responseText,
      options
    );
  }

  return {
    text: responseText
  };
}

export async function updateQuotationCustomerSnapshot(
  quoteIds: string[],
  finalCustomerName: string,
  status: string,
  salesperson: any,
  customerId?: number | null,
  contactId?: number | null
): Promise<any[]> {
  const parts = finalCustomerName.split(' | ');
  const companyName = parts[0] ? parts[0].trim() : '';
  const contactName = parts[1] ? parts[1].trim() : '';
  const metaStr = parts[2] || '';

  const customerDetails: any = {
    customer_name: companyName || null,
    customer_code: '',
    customer_tax_id: '',
    contact_name: contactName || null,
    phone: null,
    email: null,
    address: null,
    payment_terms: null,
    revise_from: null,
    custom_meta: metaStr
  };

  if (metaStr) {
    try {
      const params = new URLSearchParams(metaStr);
      customerDetails.phone = params.get('phone') || null;
      customerDetails.email = params.get('email') || null;
      customerDetails.address = params.get('address') || null;
      customerDetails.customer_tax_id = params.get('tax_id') || '';
      customerDetails.revise_from = params.get('revise_from') as any || null;
    } catch (e) {
      console.warn(`[updateQuotationCustomerSnapshot] parse metadata ไม่สำเร็จ meta="${metaStr}"`, e);
    }
  }

  try {
    let custRes = null;

    // 1. ถ้ามี ID ส่งมา ให้ดึงข้อมูลตรงจาก ID ผ่าน customers_data_view (บริษัท+ผู้ติดต่ออยู่แถวเดียวกัน ไม่ต้อง JOIN)
    if (customerId) {
      if (contactId) {
        custRes = await pool.query(
          `SELECT customer_name, customer_reference AS reference, customer_tax_id AS tax_id, customer_payment_terms AS payment_terms,
                  COALESCE(contact_phone, phone) AS contact_phone, COALESCE(contact_email, email) AS contact_email,
                  invoice_street AS contact_address,
                  invoice_district, invoice_sub_district, invoice_state, invoice_zip
           FROM customers_data_view
           WHERE company_id = $1 AND contact_id = $2 LIMIT 1`,
          [customerId, contactId]
        );
      }
      if (!custRes || custRes.rows.length === 0) {
        custRes = await pool.query(
          `SELECT DISTINCT ON (company_id) customer_name, customer_reference AS reference, customer_tax_id AS tax_id,
                  customer_payment_terms AS payment_terms
           FROM customers_data_view
           WHERE company_id = $1 ORDER BY company_id, contact_id LIMIT 1`,
          [customerId]
        );
      }
    }

    // 2. Fallback: ค้นหาด้วยชื่อแบบ TRIM เพื่อป้องกันสะกดสลับแถวหรือมีช่องว่างต่อท้าย
    if (!custRes || custRes.rows.length === 0) {
      custRes = await pool.query(
        `SELECT customer_reference AS reference, customer_tax_id AS tax_id, customer_payment_terms AS payment_terms,
                COALESCE(contact_phone, phone) AS contact_phone, COALESCE(contact_email, email) AS contact_email,
                invoice_street AS contact_address,
                invoice_district, invoice_sub_district, invoice_state, invoice_zip
         FROM customers_data_view
         WHERE TRIM(customer_name) = TRIM($1) AND TRIM(contact_name) = TRIM($2) LIMIT 1`,
        [companyName, contactName]
      );
    }
    if (!custRes || custRes.rows.length === 0) {
      custRes = await pool.query(
        `SELECT DISTINCT ON (company_id) customer_reference AS reference, customer_tax_id AS tax_id,
                customer_payment_terms AS payment_terms
         FROM customers_data_view WHERE TRIM(customer_name) = TRIM($1) ORDER BY company_id, contact_id LIMIT 1`,
        [companyName]
      );
    }

    if (custRes && custRes.rows.length > 0) {
      const row = custRes.rows[0];
      customerDetails.customer_name = companyNameOfRow(row, companyName) || null;
      if (row.reference) customerDetails.customer_code = row.reference;
      if (row.tax_id && !customerDetails.customer_tax_id) customerDetails.customer_tax_id = row.tax_id;
      if (row.contact_phone && !customerDetails.phone) customerDetails.phone = row.contact_phone;
      if (row.contact_email && !customerDetails.email) customerDetails.email = row.contact_email;
      if (row.contact_address && !customerDetails.address) {
        // query alias invoice_street มาเป็น contact_address จึงต้อง map กลับให้ helper อ่านชื่อคอลัมน์เดิมได้
        const fullAddr = buildThaiAddress({ ...row, invoice_street: row.contact_address });
        if (fullAddr) customerDetails.address = fullAddr;
      }
      if (row.payment_terms) customerDetails.payment_terms = row.payment_terms;
    }
  } catch (err) {
    console.error("Error updating customer snapshot in helper:", err);
  }

  // ⚠️ จุดนี้เขียน employee_details ทับทั้งก้อนทุกครั้งที่ผูก/เปลี่ยนลูกค้าของใบ
  //    ลืมเติม issuer_* ตรงนี้ = ชื่อผู้เสนอราคาหายเงียบ ๆ ทันทีที่ผู้ใช้เลือกลูกค้า
  //    (กับดักเดียวกับ whitelist ของ legacyItems — ด่าน diag:pdf-issuer เคส 5 จับจุดนี้โดยเฉพาะ)
  const employeeDetails = {
    salesperson_id: salesperson.salesperson_id || null,
    saleperson: salesperson.name || '',
    sale_phone: salesperson.phone || '',
    ...(await getIssuerSnapshot(salesperson.user_id) ?? {})
  };

  await pool.query(
    `UPDATE quotations 
     SET customer_details = $1, 
         employee_details = $2, 
         salesperson_id = $3,
         status = $4,
         customer_id = $5,
         contact_id = $6,
         updated_at = NOW()
     WHERE id = ANY($7)`,
    [JSON.stringify(customerDetails), JSON.stringify(employeeDetails), salesperson.salesperson_id || null, status, customerId || null, contactId || null, quoteIds]
  );

  const selectRes = await pool.query(
    `SELECT * FROM quotations WHERE id = ANY($1)`,
    [quoteIds]
  );
  
  const enrichPromises = selectRes.rows.map(q => enrichQuotationData(q));
  return await Promise.all(enrichPromises);
}

export async function cancelOldRevision(customerName: string, executor: DbExecutor = pool): Promise<void> {
  // เมื่อถูกเรียกภายใน transaction (executor เป็น client) ต้องโยน error ออกไปให้ caller rollback
  // ไม่งั้น transaction จะ commit ทั้งที่ยกเลิกใบเก่าไม่สำเร็จ
  const inTransaction = executor !== pool;

  if (!customerName || !customerName.includes(' | ')) return;
  const parts = customerName.split(' | ');
  if (!parts[2]) return;

  let reviseFrom: string | null = null;
  try {
    const meta = Object.fromEntries(new URLSearchParams(parts[2]));
    reviseFrom = meta.revise_from || null;
  } catch (err) {
    console.error("[cancelOldRevision] Error parsing customer metadata for cancellation:", err);
    if (inTransaction) throw err;
    return;
  }

  if (!reviseFrom) return;

  console.log(`[cancelOldRevision] Attempting to cancel old quotation with quotation_no: ${reviseFrom}`);
  try {
    // ตั้งใจยกเลิกใบเก่าที่ confirmed อยู่ (revise = ออกใบใหม่แทนใบเดิม) quotation_no ไม่ซ้ำอยู่แล้ว
    // จึงไม่ต้องมี status guard — การใส่ AND status <> 'confirmed' จะทำให้ไม่ยกเลิกใบเก่าเลย
    await executor.query(
      "UPDATE quotations SET status = 'cancelled' WHERE quotation_no = $1",
      [reviseFrom]
    );
    console.log(`[cancelOldRevision] Successfully cancelled old quotation: ${reviseFrom}`);
  } catch (err) {
    console.error(`[cancelOldRevision] Error cancelling old quotation ${reviseFrom}:`, err);
    if (inTransaction) throw err;
  }
}

// Helper to enrich quotation data with full customer and contact information from database/snapshots
export async function enrichQuotationData(quoteDb: any): Promise<any> {
  if (!quoteDb) return null;

  const customerDetails = quoteDb.customer_details;
  const itemDetails = quoteDb.item_details;
  const employeeDetails = quoteDb.employee_details;
  const salespersonId = quoteDb.salesperson_id;
  const customerIdFromDb = quoteDb.customer_id;
  const contactIdFromDb = quoteDb.contact_id;

  // 1. หากข้อมูล Snapshot ครบถ้วนแล้ว ให้อ่านและส่งออกได้ทันทีโดยไม่ต้อง Query ตารางหลัก
  if (customerDetails && itemDetails && employeeDetails) {
    // Snapshot ควรเก็บเฉพาะชื่อบริษัท แต่ข้อมูลเก่าอาจปนเปื้อนเป็น "company | contact" — split กันเหนียว
    // ยังไม่ได้ผูกลูกค้า = ค่าว่าง (null ใน DB) ไม่มีการเติมชื่อ default ให้อีกแล้ว
    const rawCustomerName = customerDetails.customer_name || '';
    const companyName = rawCustomerName.split(' | ')[0].trim();
    const contactName = customerDetails.contact_name || '';

    // จัด format customer_name เก่าเพื่อส่งกลับไปให้ frontend
    let oldCustomerNameFormat = companyName;
    if (contactName) {
      oldCustomerNameFormat += ` | ${contactName}`;
    }

    const reviseFrom = customerDetails.revise_from || null;
    const customMetaStr = customerDetails.custom_meta || '';
    if (customMetaStr) {
      oldCustomerNameFormat += ` | ${customMetaStr}`;
    }

    // ดึง customer_id จริงจากระบบ
    let customerId = customerIdFromDb || null;
    if (!customerId && companyName) {
      try {
        const custRes = await pool.query(
          `SELECT DISTINCT ON (company_id) company_id AS id
           FROM customers_data_view WHERE customer_name = $1 ORDER BY company_id, contact_id LIMIT 1`,
          [companyName]
        );
        if (custRes.rows.length > 0) {
          customerId = custRes.rows[0].id;
        }
      } catch (err) {
        console.error("Error fetching customer_id for enrichment:", err);
      }
    }

    // หาสังกัดบริษัท (PM หรือ THT) โดยใช้ resolveQuoteCompany ที่เช็คจาก quotation_rules
    let quoteCompany: 'PM' | 'THT' = 'PM';
    if (itemDetails.length > 0) {
      try {
        quoteCompany = await resolveQuoteCompany(itemDetails[0]);
      } catch (err) {
        console.error("Error resolving quote company in enrichQuotationData:", err);
        quoteCompany = 'PM';
      }
    } else {
      quoteCompany = quoteDb.quotation_no?.toUpperCase()?.startsWith('QT') ? 'THT' : 'PM';
    }

    // ดึงสต๊อกสด (quantity_on_hand_unreserved = ของว่างขายได้จริง) จากตารางสินค้า เพื่อให้คำเตือน "สินค้าคงเหลือ" ใน PDF
    // ตรงกับที่แสดงใน flex message — snapshot ไม่ได้เก็บ stock ไว้ จึงต้อง query สดตอน enrich
    const stockMap: Record<string, number> = {};
    const stockKeys = itemDetails
      .map((item: any) => item.model || item.internal_reference)
      .filter(Boolean);
    if (stockKeys.length > 0) {
      try {
        const { rows: stockRows } = await pool.query(
          `SELECT model AS code, quantity_on_hand_unreserved AS stock
             FROM products
            WHERE model = ANY($1)`,
          [stockKeys]
        );
        stockRows.forEach((p: any) => {
          const s = p.stock !== undefined && p.stock !== null ? Number(p.stock) : 0;
          // เผื่อมีหลายแถวชื่อ model เดียวกัน ให้ใช้สต๊อกสูงสุด (เหมือน ORDER BY quantity_on_hand_unreserved DESC)
          if (stockMap[p.code] === undefined || s > stockMap[p.code]) {
            stockMap[p.code] = s;
          }
        });
      } catch (err) {
        console.error('Error fetching live stock for snapshot enrichment:', err);
      }
    }

    // ค่าขนส่งใช้ config ตัวเดียวกับฝั่งเขียน — is_shipping_fee ที่ส่งออกไปเป็นค่า "คำนวณสด"
    // ทุกครั้ง ไม่ใช่ field ที่เก็บไว้ จึงไม่ต้องพึ่ง whitelist ด้านล่างในการเดินทางกลับ
    const { isShippingFeeItem: isShippingFeeLine, loadShippingFeeConfig: loadShippingCfg } =
      await import('./shippingFee.js');
    const shippingCfgForEnrich = await loadShippingCfg();

    // จัดระเบียบ items เพื่อความเข้ากันได้ย้อนหลังกับ Frontend
    //
    // ⚠️ นี่เป็น whitelist — field ที่ไม่อยู่ในลิสต์นี้จะหายตอน round-trip ผ่าน LIFF editor
    // เกณฑ์ว่าต้องเพิ่มหรือไม่:
    //   - field ที่ buildItemSnapshots() คำนวณใหม่ได้เอง (warranty_display, delivery_*_days,
    //     delivery_source) → ไม่ต้องเพิ่ม เพราะ input ของมัน (quantity, production/brand/series)
    //     อยู่ในลิสต์นี้แล้ว หายไปก็สร้างใหม่ได้ค่าเดิม
    //   - field ที่เป็นข้อเท็จจริงของบรรทัดนั้นเองและสร้างใหม่ไม่ได้ → **ต้องเพิ่ม**
    //     ไม่งั้นข้อมูลหายถาวร (ตัวอย่าง: name ของบรรทัดค่าขนส่งที่เซลล์ตั้งเอง — มีในลิสต์แล้ว)
    const legacyItems = itemDetails.map((item: any) => {
      const stockKey = item.model || item.internal_reference;
      const liveStock = stockKey !== undefined && stockMap[stockKey] !== undefined
        ? stockMap[stockKey]
        : (item.stock !== undefined ? item.stock : 0);
      return {
        product_id: item.product_id,
        model: item.model || item.internal_reference,
        product_code: item.model || item.internal_reference,
        name: item.name,
        // ธงสำหรับฝั่งแสดงผล (LIFF / PDF / Flex) — ล็อกช่องจำนวน ซ่อนปุ่มลบ ซ่อนสถานะสต๊อก
        is_shipping_fee: isShippingFeeLine(item, shippingCfgForEnrich),
        sales_description: item.sales_description || '',
        price: item.price,
        quantity: item.quantity,
        discount_1: item.discount_1 || 0,
        discount_2: item.discount_2 || 0,
        remark: item.remark || '',
        brand: item.brand || '',
        series: item.series || '',
        production: item.production || '',
        stock: liveStock,
        is_optional: !!item.is_optional,
        linked_to_product_id: item.linked_to_product_id || null,
        // ข้อเท็จจริงของบรรทัดนั้นที่สร้างใหม่ไม่ได้ (ใครเป็นคนใส่บรรทัดค่าบริการ) ⇒ ต้องอยู่ในลิสต์
        // ตกหล่นเมื่อไหร่ = ค่าบริการที่แอดมินเพิ่มกลายเป็นบรรทัดของกฎ แล้วโดนถอดทิ้งรอบถัดไป
        is_manual_service: item.is_manual_service === true
      };
    });

    // วันจัดส่งที่ระบบคำนวณได้ — ส่งไปให้หน้า LIFF โชว์เป็นค่าตั้งต้น/ค่าอ้างอิงคู่กับ
    // delivery_days_override (มาจาก ...quoteDb) ที่เซลล์ตั้งทับไว้
    const deliverySummary = resolveQuotationDeliveryDays(legacyItems, itemDetails);

    return {
      ...quoteDb,
      delivery_days_auto: deliverySummary.days,
      delivery_all_in_stock: deliverySummary.all_in_stock,
      customer_id: customerId,
      contact_id: contactIdFromDb || null,
      customer_name: oldCustomerNameFormat,
      company_name: companyName,
      customer_code: customerDetails.customer_code || '',
      customer_tax_id: customerDetails.customer_tax_id || '',
      contact_name: contactName,
      contact_phone: customerDetails.phone || '',
      contact_email: customerDetails.email || '',
      contact_address: customerDetails.address || '',
      delivery_address: customerDetails.address || '',
      payment_terms: customerDetails.payment_terms || '',
      // null = เครดิตข้างบนคือของลูกค้าจริง ๆ · มีค่า = คนออกใบสั่งทับไว้ (ใบของ LINE เป็น null เสมอ)
      payment_terms_override: customerDetails.payment_terms_override ?? null,
      salesperson_name: employeeDetails.saleperson || '',
      salesperson_phone: employeeDetails.sale_phone || '',
      salesperson_employee_code: salespersonId || null,
      // ตัวตนผู้เสนอราคา — มีเฉพาะใบที่ออกจากเว็บ · ใบ LINE ได้ null ทั้งสามตัวและ pdfGenerator
      // จะเดินเส้นเดิมทุกบรรทัด (issuer_name เป็นสวิตช์เดียวของทางใหม่ · §2.7)
      issuer_name: employeeDetails.issuer_name || null,
      issuer_phone: employeeDetails.issuer_phone || null,
      issuer_sig_key: employeeDetails.issuer_sig_key || null,
      items: legacyItems,
      revise_from: reviseFrom,
      quote_company: quoteCompany
    };
  }

  // 2. Fallback: หากไม่มีข้อมูล Snapshot (ใบเสนอราคาตกหล่น หรือขั้นตอนแรก) ให้ใช้การ Query ตารางหลักแบบเดิม
  let customerCode = '';
  let customerTaxId = '';
  let contactName = '';
  let contactPhone = '';
  let contactEmail = '';
  let contactAddress = '';
  let deliveryAddress = '';
  let customerId = null;

  let companyName = (quoteDb.customer_name || '').trim();
  let contactNameQuery = '';
  let customMeta: any = {};
  let paymentTerms = '';

  if (quoteDb.customer_name && quoteDb.customer_name.includes(' | ')) {
    const parts = quoteDb.customer_name.split(' | ');
    companyName = parts[0].trim();
    contactNameQuery = parts[1].trim();
    if (parts[2]) {
      try {
        const metaStr = parts.slice(2).join(' | ').trim();
        customMeta = Object.fromEntries(new URLSearchParams(metaStr));
      } catch (err) {
        console.error("Error parsing custom metadata:", err);
      }
    }
  }

  if (companyName) {
    try {
      const custData = await getCustomerByDisplayName(companyName);

      if (custData) {
        customerId = custData.id;
        customerCode = custData.reference || '';
        customerTaxId = custData.tax_id || '';
        paymentTerms = custData.customer_payment_terms || '';

        const contactData = await getFirstContact(custData.id, contactNameQuery || null);

        if (contactData) {
          contactName = contactData.name || '';
          
          const hasAddr = (contactData.invoice_street && contactData.invoice_street.trim()) || (contactData.invoice_state && contactData.invoice_state.trim());
          let target = contactData;

          if (!hasAddr) {
            const companyRows = await getCompanyAddressRows(custData.id);

            if (companyRows && companyRows.length > 0) {
              target = companyRows.find((r: any) => r.invoice_street && r.invoice_street.trim()) || 
                       companyRows.find((r: any) => r.invoice_state && r.invoice_state.trim()) || 
                       companyRows[0];
            }
          }

          const addr = buildThaiAddress(target);
          contactAddress = addr;
          deliveryAddress = addr;
        } else if (contactNameQuery) {
          contactName = contactNameQuery;
        }

        let resolvedPhone = '';
        if (contactData) {
          if (contactData.mobile && contactData.mobile.trim()) {
            resolvedPhone = contactData.mobile.trim();
          } else if (contactData.phone && contactData.phone.trim()) {
            resolvedPhone = contactData.phone.trim();
          }
        }

        if (!resolvedPhone) {
          if (custData && custData.phone && custData.phone.trim()) {
            resolvedPhone = custData.phone.trim();
          }
        }
        contactPhone = resolvedPhone;

        const emails = [];
        if (contactData && contactData.email && contactData.email.trim()) {
          emails.push(contactData.email.trim());
        }
        if (custData.email && custData.email.trim()) {
          emails.push(custData.email.trim());
        }
        const uniqueEmails = Array.from(new Set(emails));
        contactEmail = uniqueEmails.length > 0 ? uniqueEmails.join(', ') : '';
      }
    } catch (err) {
      console.error('Error fetching customer/contact metadata fallback:', err);
    }
  }

  if (customMeta) {
    if (customMeta.tax_id) customerTaxId = customMeta.tax_id;
    if (customMeta.phone) contactPhone = customMeta.phone;
    if (customMeta.email) contactEmail = customMeta.email;
    if (customMeta.address) contactAddress = customMeta.address;
    if (customMeta.delivery) deliveryAddress = customMeta.delivery;
    else if (customMeta.address) deliveryAddress = customMeta.address;
  }

  if (contactName === '' && contactNameQuery) {
    contactName = contactNameQuery;
  }

  // Enrich items details
  let enrichedItems = quoteDb.items || [];
  if (Array.isArray(enrichedItems) && enrichedItems.length > 0) {
    const productKeys = enrichedItems.map((item: any) => item.model || item.product_code).filter(Boolean);
    if (productKeys.length > 0) {
      try {
        const { rows: productsData } = await pool.query(
          `SELECT 
             model AS code, 
             quantity_on_hand_unreserved AS stock,
             model, 
             product_sub_category, 
             sales_description, 
             brand, 
             series, 
             production 
           FROM products 
           WHERE model = ANY($1)`,
          [productKeys]
        );

        const stockMap: Record<string, number> = {};
        const modelMap: Record<string, string> = {};
        const subCatMap: Record<string, string> = {};
        const descMap: Record<string, string> = {};
        const brandMap: Record<string, string> = {};
        const seriesMap: Record<string, string> = {};
        const productionMap: Record<string, string> = {};
        
        if (productsData && productsData.length > 0) {
          productsData.forEach((p: any) => {
            const currentStock = stockMap[p.code] || 0;
            const newStock = p.stock !== undefined && p.stock !== null ? p.stock : 0;
            if (newStock > currentStock || stockMap[p.code] === undefined) {
              stockMap[p.code] = newStock;
              modelMap[p.code] = p.model || '';
              subCatMap[p.code] = p.product_sub_category || '';
              descMap[p.code] = p.sales_description || '';
              brandMap[p.code] = p.brand || '';
              seriesMap[p.code] = p.series || '';
              productionMap[p.code] = p.production || '';
            }
          });
        }
        enrichedItems = enrichedItems.map((item: any) => {
          const key = item.model || item.product_code;
          return {
            ...item,
            stock: stockMap[key] !== undefined ? stockMap[key] : 0,
            model: modelMap[key] || '',
            product_sub_category: subCatMap[key] || '',
            sales_description: descMap[key] || '',
            brand: brandMap[key] || '',
            series: seriesMap[key] || '',
            production: productionMap[key] || ''
          };
        });
      } catch (err) {
        console.error('Error enriching items stock fallback:', err);
        enrichedItems = enrichedItems.map((item: any) => ({ ...item, stock: 0, brand: '', series: '', production: '' }));
      }
    }
  }

  let quoteCompany: 'PM' | 'THT' = 'PM';
  try {
    if (enrichedItems && enrichedItems.length > 0) {
      quoteCompany = await resolveQuoteCompany(enrichedItems[0]);
    } else {
      quoteCompany = quoteDb.quotation_no?.toUpperCase()?.startsWith('QT') ? 'THT' : 'PM';
    }
  } catch (err) {
    quoteCompany = quoteDb.quotation_no?.toUpperCase()?.startsWith('QT') ? 'THT' : 'PM';
  }

  // ใบเก่าที่ไม่มี snapshot → ไม่มี delivery_*_days ให้อ่าน helper จึงคืนค่าตั้งต้น 3/7 ตามสถานะสต๊อก
  const deliverySummaryFallback = resolveQuotationDeliveryDays(enrichedItems, quoteDb.item_details);

  return {
    ...quoteDb,
    delivery_days_auto: deliverySummaryFallback.days,
    delivery_all_in_stock: deliverySummaryFallback.all_in_stock,
    customer_id: customerId,
    customer_name: companyName,
    company_name: companyName,
    customer_code: customerCode,
    customer_tax_id: customerTaxId,
    contact_name: contactName,
    contact_phone: contactPhone,
    contact_email: contactEmail,
    contact_address: contactAddress,
    delivery_address: deliveryAddress,
    payment_terms: paymentTerms,
    items: enrichedItems,
    revise_from: customMeta.revise_from || null,
    quote_company: quoteCompany
  };
}
