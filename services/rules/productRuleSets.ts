// ─────────────────────────────────────────────────────────────────────────────
//  "สินค้าตัวนี้ติดกฎอะไรอยู่บ้าง" — ชุดกฎที่ผูกกับ internal_reference ตรง ๆ
//
//  ทำไมต้องมีไฟล์นี้ ทั้งที่แต่ละตารางมีหน้า CRUD ของตัวเองอยู่แล้ว:
//    หน้า "ข้อมูลสินค้า" ต้องตอบ "สินค้าตัวนี้เสนอราคาได้ไหม" ให้ครบทั้งหน้า (50 แถว/หน้า)
//    ไม่ใช่ทีละตัว ⇒ ต้องมีที่ที่โหลดกฎทั้งชุดมาเก็บไว้ แล้วให้ผู้เรียกจับคู่เองในหน่วยความจำ
//
//  ทำไมโหลดทั้งตาราง ไม่ join ต่อหน้า — วัดบนฐาน dev 2026-09-17:
//    · ทั้งสามตารางรวมกัน 5,578 แถว (stock 5,273 · moq 152 · optional 153) โหลดครบ 4.9 ms
//    · LEFT JOIN กฎเข้ากับหน้าละ 50 แถว = 26.2 ms **ต่อหนึ่งหน้า** จ่ายใหม่ทุกครั้งที่
//      เปลี่ยนหน้า/เรียง/กรอง
//    ⇒ โหลดทั้งชุดรอบเดียวถูกกว่า และ cache ที่มีอยู่แล้วทำให้ครั้งถัดไปไม่เสียอะไรเลย
//
//  ⚠️ กฎบล็อกสินค้า **ไม่อยู่ในไฟล์นี้** — มันเป็นกฎแบบ scope (production/brand/series/model/ref
//     ที่ว่างได้ = wildcard) จึงจับคู่ด้วยการเทียบสตริงตรง ๆ ไม่ได้ ต้องใช้
//     loadProductBlockRules() + findBlockingRule() ของ blockRules.ts ซึ่งมีอยู่แล้ว
//     (ตัวเลขที่ทำให้เรื่องนี้สำคัญ: กฎบล็อกที่เปิดอยู่มี 9 ข้อ แต่ 4 ข้อบล็อกด้วย production
//      ทั้งกลุ่ม ⇒ สินค้า 39,987 จาก 51,665 ตัว (77%) เสนอราคาผ่านระบบไม่ได้)
//
//  ⚠️ ทุก write path ของสามตารางนี้ต้องเรียก invalidateRuleCache(<key>) เหมือนที่
//     product_block_rules ทำอยู่ — TTL 60 วิเป็นแค่ตาข่าย ไม่ใช่กลไกหลัก
//     (แอดมินแก้กฎแล้วต้องเห็นผลทันที ไม่ใช่รออีกนาที)
// ─────────────────────────────────────────────────────────────────────────────
import { pool, type DbExecutor } from '../../config/db.js';
import { loadCached } from './cache.js';

export interface ProductMoqRule {
  internal_reference: string;
  min_order_qty: number;
  sale_line_warn_msg: string;
}

export interface ProductOptionalLink {
  trigger_product_id: string;
  optional_product_id: string;
}

/** กฎที่ผูกกับสินค้าหนึ่งตัว — รูปร่างที่หน้าจอใช้ตรง ๆ */
export interface ProductRuleFlags {
  /** ขั้นต่ำสั่งซื้อ · null = ไม่มีกฎ */
  moq: { qty: number; warn: string } | null;
  /** มีแถวใน product_stock_rules = ของหมดแล้วห้ามเสนอ (ไม่มีแถว = เสนอได้เสมอแม้ของว่าง) */
  stockRule: boolean;
  /** รหัสสินค้าพ่วงที่ผูกไว้กับสินค้าตัวนี้ */
  optional: string[];
}

/** ชุดกฎทั้งระบบ พร้อมให้จับคู่ในหน่วยความจำ */
export interface ProductRuleSets {
  moq: Map<string, ProductMoqRule>;
  stock: Set<string>;
  optional: Map<string, string[]>;
}

async function loadMoqRules(exec: DbExecutor): Promise<ProductMoqRule[]> {
  return await loadCached<ProductMoqRule>('product_moq_rules', async () => {
    const res = await exec.query(
      `SELECT internal_reference, min_order_qty, sale_line_warn_msg
         FROM product_moq_rules
        WHERE is_active = true AND internal_reference IS NOT NULL`,
    );
    return res.rows as ProductMoqRule[];
  });
}

async function loadStockRules(exec: DbExecutor): Promise<{ internal_reference: string }[]> {
  return await loadCached<{ internal_reference: string }>('product_stock_rules', async () => {
    const res = await exec.query(
      `SELECT internal_reference FROM product_stock_rules
        WHERE is_active = true AND internal_reference IS NOT NULL`,
    );
    return res.rows as { internal_reference: string }[];
  });
}

async function loadOptionalLinks(exec: DbExecutor): Promise<ProductOptionalLink[]> {
  return await loadCached<ProductOptionalLink>('product_optional_links', async () => {
    const res = await exec.query(
      `SELECT trigger_product_id, optional_product_id
         FROM product_optional_links
        WHERE is_active = true`,
    );
    return res.rows as ProductOptionalLink[];
  });
}

/**
 * คีย์ของ Map/Set — เทียบแบบ trim + lowercase ให้ตรงกับที่ engine กฎอื่นทำอยู่
 * ('FTBK1XDG100000' กับ 'ftbk1xdg100000 ' ต้องเป็นรหัสเดียวกัน)
 *
 * ⚠️ ห้ามเอาฟังก์ชันนี้ไปใช้กับ "ชื่อลูกค้า/ผู้ติดต่อ" ที่จะส่งไป Odoo — ที่นั่นห้าม trim
 * (CLAUDE.md: ช่องว่างหัวท้ายเป็นข้อมูลจริง 17,666 แถว) ที่นี่ปลอดภัยเพราะเป็นรหัสสินค้า
 * ที่ใช้เทียบภายในระบบเท่านั้น ไม่ได้ส่งออกไปไหน
 */
function refKey(v: string | null | undefined): string {
  return String(v ?? '').trim().toLowerCase();
}

/** โหลดกฎทั้งสามตารางแล้วยุบเป็นโครงสร้างที่ค้นด้วยรหัสสินค้าได้ทันที */
export async function loadProductRuleSets(exec: DbExecutor = pool): Promise<ProductRuleSets> {
  const [moqRows, stockRows, optionalRows] = await Promise.all([
    loadMoqRules(exec),
    loadStockRules(exec),
    loadOptionalLinks(exec),
  ]);

  const moq = new Map<string, ProductMoqRule>();
  for (const r of moqRows) moq.set(refKey(r.internal_reference), r);

  const stock = new Set<string>();
  for (const r of stockRows) stock.add(refKey(r.internal_reference));

  const optional = new Map<string, string[]>();
  for (const r of optionalRows) {
    const k = refKey(r.trigger_product_id);
    const list = optional.get(k);
    if (list) list.push(r.optional_product_id);
    else optional.set(k, [r.optional_product_id]);
  }

  return { moq, stock, optional };
}

/** หยิบกฎของสินค้าหนึ่งตัวออกจากชุดที่โหลดไว้ */
export function rulesForProduct(sets: ProductRuleSets, internalReference: string | null): ProductRuleFlags {
  const k = refKey(internalReference);
  const moq = sets.moq.get(k);
  return {
    moq: moq ? { qty: moq.min_order_qty, warn: moq.sale_line_warn_msg } : null,
    stockRule: sets.stock.has(k),
    optional: sets.optional.get(k) ?? [],
  };
}
