// ─────────────────────────────────────────────────────────────────────────────
//  ค่าขนส่งอัตโนมัติ — จุดเดียวในระบบที่มีตรรกะกฎนี้
//
//  กฎ: ลูกค้าที่ "ไม่มีเครดิต" และยอดสินค้าก่อน VAT (หลังหักส่วนลด) รวมทุกใบในกลุ่มร่าง
//      < เกณฑ์ที่ตั้งไว้ → ระบบเติมบรรทัดค่าขนส่ง 1 บรรทัดให้เอง และถอดออกเองเมื่อยอดถึงเกณฑ์
//
//  **บรรทัดค่าบริการมีได้บรรทัดเดียวต่อกลุ่มร่าง** (เจ้าของเคาะ 2026-09-14) และมีสองที่มา:
//      · กฎเติมให้เอง            — ถอดออกเองเมื่อเงื่อนไขไม่เข้าแล้ว
//      · แอดมินกดเพิ่มเองจากหน้าเว็บ — `is_manual_service: true` ⇒ **กฎห้ามถอดทิ้ง**
//    ธงนี้จำเป็นเพราะกฎเดิมถอด "ทุกบรรทัดที่เข้าเงื่อนไข" ออกก่อนเสมอ ⇒ ค่าบริการที่คนตั้งใจใส่
//    หายเงียบทุกครั้งที่บันทึก สำหรับลูกค้าเครดิตทุกราย (ซึ่งเป็นเคสส่วนใหญ่)
//    ⚠️ ธงเดินทางข้าม round-trip ได้เพราะถูกเพิ่มใน whitelist **ทั้งสองชั้น** แล้ว —
//       ฝั่งเขียน buildItemSnapshots() (ผ่าน buildShippingFeeSnapshot ตัวนี้) และฝั่งอ่าน
//       legacyItems ใน enrichQuotationData() ลืมชั้นใดชั้นหนึ่งแล้วธงหายถาวร (CLAUDE.md)
//
//  ⚠️ liff_pages/quote-edit.html จำลองกฎชุดเดียวกันนี้ไว้ฝั่ง client เพื่อให้เซลล์เห็นบรรทัด
//     ทันทีระหว่างแก้ (vanilla JS ไม่มี bundler ตาม AGENTS.md) — เป็น duplication ที่ยอมรับ
//     โดยตั้งใจแบบเดียวกับสูตรราคาใน utils/pricing.ts แก้ที่นี่ต้องไปแก้ที่นั่นด้วยมือ
//     ฝั่ง server เป็นผู้ตัดสินเสมอ ค่าที่ client คำนวณเป็นแค่ภาพ preview
// ─────────────────────────────────────────────────────────────────────────────

import { pool, withTransaction, type DbExecutor } from '../config/db.js';
import { sumLineTotals, round2 } from '../utils/pricing.js';
import { loadCached } from './rules/cache.js';
import { resolveQuoteCompany } from './quotationService.js';

/** สถานะร่างที่ยังแก้ได้ — ชุดเดียวกับที่ insertDraftQuotations ใช้ลบร่างเดิม */
const DRAFT_STATUSES = ['pending_company', 'pending_contact', 'draft'];

/** "<เลข> Days" — 30 Days / 60 Days / 5 days / 30days */
const DAYS_TERMS_RE = /^\d+\s*days$/i;

/** "เช็คล่วงหน้า<เลข>วัน" — เช็คล่วงหน้า30วัน / เช็คล่วงหน้า7วัน / เช็คล่วงหน้า15วัน / เช็คล่วงหน้า45วัน */
const ADVANCE_CHEQUE_RE = /^เช็คล่วงหน้า\s*\d+\s*วัน$/;

/**
 * "มีเครดิต" = จ่ายทีหลังได้ — ทั้งเครดิตเทอมปกติและเช็คล่วงหน้า
 *
 * ค่าที่มีจริงในฐานข้อมูล (ยืนยันแล้ว):
 *   30/60/45/90/15/7/65/14/5/40/20/10 Days · เช็คล่วงหน้า 30/15/7/45 วัน  → มีเครดิต
 *   NULL / Cash / Immediate Payment                                      → ไม่มีเครดิต
 */
export function hasCreditTerms(paymentTerms: string | null | undefined): boolean {
  const terms = String(paymentTerms ?? '').trim();
  return DAYS_TERMS_RE.test(terms) || ADVANCE_CHEQUE_RE.test(terms);
}

export interface ShippingFeeConfig {
  isActive: boolean;
  thresholdBeforeVat: number;
  feePrice: number;
  feeQuantity: number;
  defaultItemName: string;
  productInternalReference: string;
  /** products.product_template_id ของแถวสินค้าค่าบริการ — null = ตั้งค่าไม่ครบ กฎจะไม่ทำงาน */
  productId: number | null;
  /** products.model — กุญแจที่ทุก query ในระบบใช้อ้างถึงสินค้าตัวนี้ */
  productModel: string;
  /** products.name ของแถวนั้น (ชื่อกลางฝั่ง Odoo) — ใช้บอกที่มาของบรรทัดบนหน้าจอเท่านั้น
   *  ไม่ใช่ชื่อที่จะขึ้นในใบ (ชื่อในใบคือ name ของบรรทัด ซึ่งแอดมิน/เซลส์ตั้งเอง) */
  productName: string;
}

/** ปิดกฎไว้ก่อนเมื่ออ่านค่าไม่ได้ — fail-safe: ยอมไม่คิดค่าขนส่ง ดีกว่าคิดมั่ว */
const DISABLED_CONFIG: ShippingFeeConfig = {
  isActive: false,
  thresholdBeforeVat: 0,
  feePrice: 0,
  feeQuantity: 1,
  defaultItemName: 'ค่าขนส่ง',
  productInternalReference: '',
  productId: null,
  productModel: '',
  productName: ''
};

/**
 * อ่านค่าคงที่ของกฎ (cache 60 วิ — แอดมินกดบันทึกแล้วเรียก invalidateRuleCache ให้เห็นผลทันที)
 * ข้อมูล Odoo (internal_reference / name / group / category) อยู่ที่แถวใน products ไม่ใช่ที่นี่
 */
export async function loadShippingFeeConfig(executor: DbExecutor = pool): Promise<ShippingFeeConfig> {
  const rows = await loadCached<ShippingFeeConfig>('shipping_fee_config', async () => {
    const { rows: cfgRows } = await executor.query(`
      SELECT
        c.is_active,
        c.threshold_before_vat,
        c.fee_price,
        c.fee_quantity,
        c.default_item_name,
        c.product_internal_reference,
        p.product_template_id,
        p.model,
        p.name AS product_name
      FROM shipping_fee_config c
      LEFT JOIN LATERAL (
        SELECT product_template_id, model, name
          FROM products
         WHERE internal_reference = c.product_internal_reference
           AND is_system_item = true
         ORDER BY product_template_id
         LIMIT 1
      ) p ON true
      WHERE c.id = 1
    `);

    const row = cfgRows[0];
    if (!row) {
      console.error('[shippingFee] ไม่พบแถว shipping_fee_config (id=1) — ปิดกฎค่าขนส่งไว้ก่อน');
      return [DISABLED_CONFIG];
    }
    if (row.product_template_id === null || row.product_template_id === undefined) {
      console.error(
        `[shippingFee] ไม่พบสินค้า is_system_item ที่ internal_reference="${row.product_internal_reference}" ` +
        `— ปิดกฎค่าขนส่งไว้ก่อน (ต้องรัน migration 2026-07-22_01_shipping_fee.sql)`
      );
      return [DISABLED_CONFIG];
    }

    return [{
      isActive: row.is_active === true,
      thresholdBeforeVat: Number(row.threshold_before_vat) || 0,
      feePrice: Number(row.fee_price) || 0,
      feeQuantity: Number(row.fee_quantity) || 1,
      defaultItemName: String(row.default_item_name || 'ค่าขนส่ง'),
      productInternalReference: String(row.product_internal_reference || ''),
      productId: Number(row.product_template_id),
      productModel: String(row.model || ''),
      productName: String(row.product_name || '')
    }];
  });

  return rows[0] ?? DISABLED_CONFIG;
}

/**
 * บรรทัดนี้เป็นค่าขนส่งหรือไม่ — เทียบจาก model/internal_reference ที่อยู่ใน item อยู่แล้ว
 *
 * ตั้งใจไม่เก็บ field ธงแยก เพราะ field ใหม่ใน snapshot จะหายเงียบตอน round-trip ผ่าน
 * LIFF editor ถ้าลืมเพิ่มใน whitelist ของ enrichQuotationData ส่วน model อยู่ใน whitelist อยู่แล้ว
 */
export function isShippingFeeItem(item: any, cfg: ShippingFeeConfig): boolean {
  if (!item) return false;
  const code = String(item.model ?? item.product_code ?? '').trim();
  if (cfg.productModel && code === cfg.productModel) return true;
  const ref = String(item.internal_reference ?? '').trim();
  return !!cfg.productInternalReference && ref === cfg.productInternalReference;
}

/** ยอดเฉพาะ "สินค้าจริง" ก่อน VAT (หลังหักส่วนลด) — ไม่นับค่าขนส่งเข้าไปในฐานที่ใช้ตัดสิน */
export function goodsSubtotal(items: any[] | null | undefined, cfg: ShippingFeeConfig): number {
  const list = Array.isArray(items) ? items : [];
  return sumLineTotals(list.filter(item => !isShippingFeeItem(item, cfg)));
}

/**
 * ประกอบ snapshot ของบรรทัดค่าขนส่งให้ shape ตรงกับที่ buildItemSnapshots สร้าง
 *
 * ตั้งใจไม่เรียก buildItemSnapshots ใหม่ทั้งใบ เพราะจะไป resolve กฎรับประกัน/วันจัดส่ง
 * ของสินค้าทุกบรรทัดใหม่หมด แล้วละลายค่าที่ freeze ไว้ตอนสร้างใบ
 *
 * @param prev บรรทัดเดิม (ถ้ามี) — ชื่อ ราคา และธง "คนใส่เอง" ที่เซลล์/แอดมินตั้งไว้
 *             ต้องอยู่รอดทุกครั้งที่กฎรันซ้ำ
 */
export function buildShippingFeeSnapshot(cfg: ShippingFeeConfig, prev?: any): any {
  const prevName = String(prev?.name ?? '').trim();
  const prevPrice = Number(prev?.price);

  return {
    internal_reference: cfg.productInternalReference,
    product_id: cfg.productId,
    model: cfg.productModel,
    name: prevName || cfg.defaultItemName,
    sales_description: '',
    price: Number.isFinite(prevPrice) ? prevPrice : cfg.feePrice,
    quantity: cfg.feeQuantity,
    discount_1: 0,
    discount_2: 0,
    remark: '',
    brand: '',
    series: '',
    production: '',
    warranty_display: '',
    // ไม่ใช่สินค้าที่ต้องผลิต/ส่ง — resolveQuotationDeliveryDays ข้ามบรรทัดนี้อยู่แล้ว
    // ค่า 0 ที่ใส่ไว้เป็นแค่ backstop เผื่อมีเส้นทางอ่านที่ยังไม่รู้จักบรรทัดนี้
    delivery_in_stock_days: 0,
    delivery_out_of_stock_days: 0,
    delivery_source: 'shipping_fee',
    is_optional: false,
    // ธงเดียวที่แยก "บรรทัดที่แอดมินกดเพิ่มเอง" ออกจาก "บรรทัดที่กฎเติมให้" — ดูหัวไฟล์
    is_manual_service: isManualServiceItem(prev)
  };
}

/** บรรทัดค่าบริการนี้เป็นของที่คนกดเพิ่มเองหรือไม่ — ที่เดียวที่อ่านธงนี้ */
export function isManualServiceItem(item: any): boolean {
  return item?.is_manual_service === true;
}

/**
 * ใบนี้ควรมีบรรทัดค่าบริการอยู่หรือไม่ — **จุดเดียวที่ตัดสิน**
 *
 * แยกออกมาจาก applyShippingFeeToQuoteGroup เพราะหน้าเว็บต้องตอบคำถามเดียวกันนี้ *ก่อน*
 * มีแถวใน DB ให้อ่าน (พรีวิวก่อนกดสร้างใบร่าง) — ถ้าไม่แยก ฝั่งเว็บจะต้องก๊อปกฎไปไว้เอง
 * ซึ่ง CLAUDE.md ห้ามไว้ตรง ๆ ("ตรรกะธุรกิจเรียกของเดิม ห้ามก๊อปมาไว้ฝั่งเว็บ")
 */
export function shouldHaveShippingFee(
  cfg: ShippingFeeConfig,
  opts: { goods: number; bound: boolean; paymentTerms: string | null | undefined; prevFee?: any }
): boolean {
  const auto =
    cfg.isActive &&
    opts.bound &&
    opts.goods > 0 &&
    opts.goods < cfg.thresholdBeforeVat &&
    !hasCreditTerms(opts.paymentTerms);

  // บรรทัดที่แอดมินกดเพิ่มเองอยู่ต่อเสมอ ไม่ว่ากฎอัตโนมัติจะเข้าเงื่อนไขหรือไม่ —
  // คนที่ใส่มันเข้ามาตั้งใจให้มันอยู่ ส่วนคนที่อยากเอาออกก็กดลบแถวนั้นได้เอง
  // (มีได้บรรทัดเดียว ⇒ ถ้ามีของคนใส่เองแล้ว กฎไม่เติมซ้อนอีกใบ)
  return auto || isManualServiceItem(opts.prevFee);
}

/**
 * ปรับบรรทัดค่าขนส่งของ "ทั้งกลุ่มใบร่าง" ของพนักงานคนหนึ่งให้ตรงกับกฎ
 *
 * เป็นจุดเดียวที่เขียนบรรทัดนี้ลง DB — ทั้ง LINE flow (insertDraftQuotations),
 * การบันทึกจาก LIFF (PUT /api/quotation/:id) และตอนยืนยันต้องเรียกตัวนี้
 *
 * ยอดที่ใช้ตัดสินคิดรวมทุกใบ (PM + THT) แล้วใส่บรรทัดเดียวในใบ PM ก่อน
 * เพราะเป็นค่าขนส่งของออเดอร์เดียวกัน ไม่ใช่ของแต่ละนิติบุคคล
 *
 * ไม่โยน error — ค่าขนส่งพลาดต้องไม่ทำให้การบันทึก/ยืนยันใบทั้งใบล้ม
 *
 * @param incomingFee บรรทัดค่าบริการที่เพิ่งมากับคำขอ แต่ยังไม่ทันได้ลง DB —
 *        insertDraftQuotations ตัดบรรทัดนี้ออกก่อนแบ่ง PM/THT (ไม่มี production ให้ตัดสิน)
 *        ถ้าไม่ส่งต่อมาที่นี่ ค่าบริการที่แอดมินเพิ่มจากหน้าเว็บจะหายตั้งแต่ตอนสร้างร่าง
 */
/**
 * `requestId` = ขอบเขตของ "กลุ่มใบ" เมื่อเจ้าของใบมีหลายชุดค้างอยู่พร้อมกัน (2026-09-15)
 *
 * เดิมกลุ่ม = "ร่างทั้งหมดของ user นี้" ซึ่งถูกเสมอ เพราะร่างของหน้าเว็บอยู่ไม่ถึงสองวินาที
 * และร่างของ LINE มีชุดเดียวต่อคน · พอมีคิวอนุมัติราคา **ร่างเริ่มค้างอยู่ข้ามวัน** แอดมินคนเดิม
 * จึงมีได้ทั้ง "ชุดที่รออนุมัติ" กับ "ชุดที่กำลังทำอยู่" พร้อมกัน ⇒ ถ้ายังรวมเป็นกลุ่มเดียว
 * ยอดสินค้าของสองชุดจะถูกบวกกันเพื่อตัดสินค่าขนส่ง และใบที่รออนุมัติจะถูกแก้ยอดใต้มือ
 * คนอนุมัติทั้งที่เขากำลังอ่านมันอยู่
 *
 * ไม่ส่งมา = กลุ่มของ "ใบที่ไม่ได้อยู่ในคำขออนุมัติ" — ซึ่งคือทุกใบของเส้น LINE และ LIFF
 * ⇒ พฤติกรรมเดิมทุกประการ (`price_approval` เป็น NULL ทั้งตารางก่อนฟีเจอร์นี้)
 */
export async function applyShippingFeeToQuoteGroup(
  userId: string | null | undefined,
  incomingFee?: any,
  requestId?: string | null
): Promise<void> {
  if (!userId) return;

  let cfg: ShippingFeeConfig;
  try {
    cfg = await loadShippingFeeConfig();
  } catch (err) {
    console.error('[applyShippingFeeToQuoteGroup] อ่าน config ไม่สำเร็จ — ข้ามการปรับค่าขนส่ง', err);
    return;
  }
  if (!cfg.productModel) return; // ตั้งค่าไม่ครบ (log ไปแล้วตอนโหลด config)

  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, status, customer_id, customer_details, item_details, total_sum
           FROM quotations
          WHERE user_id = $1 AND status = ANY($2)
            AND price_approval->>'request_id' IS NOT DISTINCT FROM $3
          ORDER BY created_at, id
          FOR UPDATE`,
        [userId, DRAFT_STATUSES, requestId ?? null]
      );
      if (rows.length === 0) return;

      // แยกบรรทัดค่าขนส่งเดิมออกจากทุกใบ พร้อมจำตัวแรกไว้เพื่อรักษาชื่อ/ราคาที่เซลล์แก้
      let prevFee: any = null;
      const quotes = rows.map((row: any) => {
        const items: any[] = Array.isArray(row.item_details) ? row.item_details : [];
        const goodsItems: any[] = [];
        for (const item of items) {
          if (isShippingFeeItem(item, cfg)) {
            if (!prevFee) prevFee = item;
          } else {
            goodsItems.push(item);
          }
        }
        return { row, items, goodsItems };
      });

      // บรรทัดที่มากับคำขอแต่ยังไม่ได้ลง DB — ใช้ต่อเมื่อในใบไม่มีบรรทัดค่าบริการอยู่แล้ว
      if (!prevFee && incomingFee) prevFee = incomingFee;

      const goods = quotes.reduce((sum, q) => sum + sumLineTotals(q.goodsItems), 0);

      // ยังไม่ผูกลูกค้า = ยังไม่รู้เครดิต → ยังไม่ใส่ (จะใส่ให้เองตอนเซลล์เลือกลูกค้าแล้วบันทึก)
      const bound = quotes.some(q => q.row.status === 'draft' && q.row.customer_id !== null);
      const paymentTerms = quotes
        .map(q => q.row.customer_details?.payment_terms)
        .find((t: any) => t !== undefined && t !== null && String(t).trim() !== '') ?? '';

      const keepFee = shouldHaveShippingFee(cfg, { goods, bound, paymentTerms, prevFee });

      // ใบเป้าหมาย = ใบ PM ใบแรก ไม่มีก็ใบแรกที่มีสินค้า
      let targetIdx = quotes.findIndex(q => q.goodsItems.length > 0);
      if (targetIdx === -1) targetIdx = 0;
      if (keepFee && quotes.length > 1) {
        for (let i = 0; i < quotes.length; i++) {
          const first = quotes[i].goodsItems[0];
          if (!first) continue;
          if (await resolveQuoteCompany(first, client) === 'PM') {
            targetIdx = i;
            break;
          }
        }
      }

      for (let i = 0; i < quotes.length; i++) {
        const q = quotes[i];
        const nextItems = (keepFee && i === targetIdx)
          ? [...q.goodsItems, buildShippingFeeSnapshot(cfg, prevFee)]
          : q.goodsItems;
        const nextSum = round2(sumLineTotals(nextItems));

        // ต้องเทียบ total_sum ด้วย ไม่ใช่แค่รายการ — ถ้าใบถูกเขียน item_details มาโดยยอดยังไม่ตาม
        // (เช่น client เขียนตรง / งานเขียนก่อนหน้าล้มกลางคัน) การข้ามตรงนี้จะทิ้งยอดผิดไว้ถาวร
        const sumUnchanged = round2(Number(q.row.total_sum) || 0) === nextSum;
        if (sumUnchanged && JSON.stringify(q.items) === JSON.stringify(nextItems)) continue;

        await client.query(
          `UPDATE quotations
              SET item_details = $1, total_sum = $2, updated_at = NOW()
            WHERE id = $3 AND status <> 'confirmed' AND status <> 'cancelled'`,
          [JSON.stringify(nextItems), nextSum, q.row.id]
        );
      }
    });
  } catch (err) {
    console.error(`[applyShippingFeeToQuoteGroup] ปรับค่าขนส่งไม่สำเร็จ (userId=${userId})`, err);
  }
}
