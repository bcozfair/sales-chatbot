/**
 * dataDirectoryService — หลังบ้านของสองหน้าใหม่: "ข้อมูลสินค้า" และ "ข้อมูลลูกค้า"
 *
 * ทั้งสองหน้าเป็น **อ่านอย่างเดียว** — ต้นทางคือ Odoo แก้ในแอดมินจะถูก sync ทับรอบถัดไป
 * หน้าที่ของไฟล์นี้คือ "เอาแถวดิบจาก repo มาแปะกฎที่ผูกอยู่" ไม่ใช่ตัดสินกฎเอง
 *
 * ── สิ่งที่ห้ามทำในไฟล์นี้ ────────────────────────────────────────────────
 *   · ห้ามเขียน SQL — SQL ทั้งหมดอยู่ที่ db/dataDirectoryRepo.ts
 *   · ห้ามเขียนตรรกะกฎใหม่ — ใช้ services/rules/ ตัวเดิมที่ LINE กับหน้าเว็บใช้ร่วมกัน
 *     (ถ้าที่นี่ตัดสินเองว่าสินค้าตัวไหนถูกบล็อก วันหนึ่งหน้าจอจะบอกคนละอย่างกับตอนออกใบจริง)
 *
 * ── ทำไมโหลดกฎทั้งชุดแทนการ join (วัด 2026-09-17) ────────────────────────
 *   กฎทุกตารางรวมกัน 5,578 แถว โหลดครบ 4.9 ms และ cache ไว้ต่อ
 *   ส่วน LEFT JOIN กฎเข้ากับหน้าละ 50 แถวราคา 26.2 ms **ต่อหนึ่งหน้า**
 */
import {
  listProducts, getProductFacets, getProductSummary, getProductionSeriesCounts,
  countProductsMatchingSpecificRules,
  listCompanies, listContacts, getCustomerFacets,
  getCompanyDiscountHistory, getDiscountHistoryForCompanies, getCompanyContacts,
  type ProductDirectoryFilter, type CustomerDirectoryFilter, type DiscountOrderRow,
} from '../db/dataDirectoryRepo.js';
import { loadProductBlockRules, findBlockingRule, normalizeProductScope } from './rules/index.js';
import { loadProductRuleSets, rulesForProduct, type ProductRuleFlags } from './rules/productRuleSets.js';

// ═══════════════════════════ สินค้า ═══════════════════════════

export interface ProductBlockInfo {
  blocked: boolean;
  /** ข้อความที่เซลส์จะเห็นตอนเสนอสินค้าตัวนี้ */
  warn: string | null;
  /** กฎที่บล็อกตั้งไว้ที่ระดับไหน — ใช้อธิบายให้แอดมินรู้ว่าต้องไปแก้ที่ไหน */
  scope: string | null;
}

export interface ProductWithRules {
  rules: ProductRuleFlags & { block: ProductBlockInfo };
  [k: string]: unknown;
}

/** แปลงกฎบล็อกที่จับคู่ได้ ให้เป็นคำอธิบายว่า "ตั้งไว้ที่ระดับไหน" */
function describeBlockScope(rule: {
  internal_reference?: string | null; model?: string | null; series?: string | null;
  brand?: string | null; production?: string | null;
}): string {
  if (rule.internal_reference) return `รหัสสินค้า ${rule.internal_reference}`;
  const parts: string[] = [];
  if (rule.production) parts.push(`แหล่งผลิต ${rule.production}`);
  if (rule.brand) parts.push(`แบรนด์ ${rule.brand}`);
  if (rule.series) parts.push(`ซีรีส์ ${rule.series}`);
  if (rule.model) parts.push(`รุ่น ${rule.model}`);
  return parts.join(' + ') || 'ทั้งระบบ';
}

export async function getProductDirectory(f: ProductDirectoryFilter) {
  const [{ rows, total }, blockRules, ruleSets] = await Promise.all([
    listProducts(f),
    loadProductBlockRules(),
    loadProductRuleSets(),
  ]);

  const items = rows.map((p) => {
    // ใช้ตัวจับคู่เดียวกับตอนออกใบจริง — ห้ามเทียบสตริงเอง เพราะกฎมี wildcard หลายชั้น
    const hit = findBlockingRule(blockRules, normalizeProductScope(p));
    const flags = rulesForProduct(ruleSets, p.internal_reference);
    return {
      ...p,
      rules: {
        ...flags,
        block: {
          blocked: !!hit,
          warn: hit?.warn_msg ?? null,
          scope: hit ? describeBlockScope(hit) : null,
        },
      },
    };
  });

  return { items, total };
}

/**
 * ตัวเลขสรุปบนหัวหน้าสินค้า
 *
 * "ถูกกฎบล็อก" นับใน TS ไม่ใช่ SQL เพราะกฎเป็นแบบ scope ที่มี wildcard —
 * นับจาก (แหล่งผลิต × ซีรีส์) ซึ่งเป็นกลุ่มที่เล็กพอจะนับครบโดยไม่ต้องไล่ทีละสินค้า
 * (กฎที่ตั้งเจาะจงระดับ model/internal_reference นับแยกไม่ได้ด้วยวิธีนี้ จึงนับเพิ่มทีละตัว)
 */
export async function getProductDirectorySummary() {
  const [summary, groups, blockRules] = await Promise.all([
    getProductSummary(),
    getProductionSeriesCounts(),
    loadProductBlockRules(),
  ]);

  // ชั้นที่ 1: กฎที่บล็อกทั้งกลุ่ม (production / brand / series) — นับจากกลุ่มได้ทีเดียว
  // 4 ใน 9 ข้อของกฎจริงเป็นแบบนี้ และกินสินค้าไป 39,982 ตัวจาก 51,665 (77%)
  let blocked = 0;
  for (const g of groups) {
    const hit = findBlockingRule(
      blockRules,
      normalizeProductScope({ production: g.production, series: g.series, brand: null, model: null, internal_reference: null }),
    );
    if (hit) blocked += g.n;
  }

  // ชั้นที่ 2: กฎที่เจาะจงระดับรหัสสินค้า/รุ่น — นับจากกลุ่มไม่ได้ ต้องไปดูของจริงทีละตัว
  // ถ้าไม่นับชั้นนี้ ตัวเลขบนหัวจอจะน้อยกว่าความจริงเงียบ ๆ (วัด 2026-09-17: ขาดไป 5 ตัว)
  // กฎกลุ่มนี้มีน้อยมาก (5 ข้อ) จึงถามทีละข้อได้โดยไม่กระทบเวลา
  const specific = blockRules.filter((r) => r.internal_reference || r.model);
  if (specific.length) {
    const extra = await countProductsMatchingSpecificRules(
      specific.map((r) => ({ internal_reference: r.internal_reference ?? null, model: r.model ?? null })),
      // สินค้าที่อยู่ในกลุ่มที่ถูกบล็อกอยู่แล้ว ห้ามนับซ้ำ
      groups.filter((g) => findBlockingRule(blockRules, normalizeProductScope({
        production: g.production, series: g.series, brand: null, model: null, internal_reference: null,
      }))).map((g) => ({ production: g.production, series: g.series })),
    );
    blocked += extra;
  }

  return {
    ...summary,
    blocked,
    quotable: Math.max(0, summary.total - blocked),
  };
}

export { getProductFacets, getCustomerFacets };

// ═══════════════════════════ ลูกค้า ═══════════════════════════

export interface DiscountSummary {
  rows: { ref: string; date: string | null; amount: number; discount: number; pct: number | null; invoiceStatus: string | null }[];
  /** % ของใบล่าสุด — null เมื่อยอดก่อนลดเป็น 0 (หารไม่ได้) */
  latestPct: number | null;
  /** ทั้ง N ใบได้ส่วนลด % เท่ากันหรือไม่ — 83% ของบริษัทเป็นแบบนี้ */
  same: boolean;
  /** 1 = ใบล่าสุดได้มากกว่าใบก่อนหน้า · -1 = น้อยกว่า · 0 = เท่ากัน/เทียบไม่ได้ */
  trend: 1 | 0 | -1;
}

/**
 * แปลงใบสั่งขายเป็นสรุปส่วนลดที่หน้าจอใช้ได้ทันที
 *
 * ⚠️ ใช้ total_discount ตรง ๆ ไม่คำนวณใหม่ — มี 2,362 ใบ (0.7%) ที่
 *    total_amount − total_discount ≠ amount_after_discount จากต้นทาง
 * ⚠️ ส่วนลด 0 ไม่ใช่ "ไม่มีข้อมูล" — มี 27,802 ใบที่ส่วนลดเป็นศูนย์จริง ๆ
 */
export function summarizeDiscounts(orders: DiscountOrderRow[]): DiscountSummary | null {
  if (!orders.length) return null;
  const rows = orders.map((o) => {
    const amount = Number(o.total_amount ?? 0);
    const discount = Number(o.total_discount ?? 0);
    return {
      ref: o.order_reference,
      date: o.order_date,
      amount,
      discount,
      pct: amount > 0 ? (discount / amount) * 100 : null,
      invoiceStatus: o.invoice_status,
    };
  });
  const pcts = rows.map((r) => r.pct).filter((v): v is number => v != null);
  const latestPct = rows[0]?.pct ?? null;
  const same = pcts.length > 0 && pcts.every((v) => Math.abs(v - pcts[0]) < 0.01);
  let trend: 1 | 0 | -1 = 0;
  if (!same && latestPct != null && rows[1]?.pct != null) {
    trend = latestPct > rows[1].pct ? 1 : latestPct < rows[1].pct ? -1 : 0;
  }
  return { rows, latestPct, same, trend };
}

export async function getCompanyDirectory(f: CustomerDirectoryFilter) {
  const { rows, total } = await listCompanies(f);
  // ส่วนลดเป็นของ "บริษัท" ⇒ ดึงเฉพาะมุมมองบริษัท ไม่ดึงในมุมมองผู้ติดต่อ
  const history = await getDiscountHistoryForCompanies(rows.map((r) => r.company_id));
  const items = rows.map((r) => ({
    ...r,
    discount: summarizeDiscounts(history.get(r.company_id) ?? []),
  }));
  return { items, total };
}

export async function getContactDirectory(f: CustomerDirectoryFilter) {
  const { rows, total } = await listContacts(f);
  return { items: rows, total };
}

/** แผงรายละเอียดของบริษัทหนึ่ง — ผู้ติดต่อทั้งหมด + ประวัติส่วนลด */
export async function getCompanyDetail(companyId: number) {
  const [contacts, orders] = await Promise.all([
    getCompanyContacts(companyId),
    getCompanyDiscountHistory(companyId, 3),
  ]);
  if (!contacts.length) return null;
  return {
    company: contacts[0],
    contacts,
    discount: summarizeDiscounts(orders),
  };
}
