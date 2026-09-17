// ─────────────────────────────────────────────────────────────────────────────
//  สูตรคำนวณราคาที่ใช้ร่วมกันทั้งระบบ — เดิมสูตรเดียวกันนี้ถูก inline ไว้ 9 จุด
//
//  ⚠️ liff_pages/quote-edit.html มีสูตรชุดเดียวกันเขียนซ้ำไว้ (vanilla JS ไม่มี bundler
//     ตาม AGENTS.md) เป็น duplication จุดเดียวที่ยอมรับโดยตั้งใจ — แก้ที่นี่ต้องไปแก้ที่นั่นด้วยมือ
// ─────────────────────────────────────────────────────────────────────────────

export const VAT_RATE = 0.07;

/** ปัดเป็นทศนิยม 2 ตำแหน่ง */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * ราคาต่อหน่วยหลังหักส่วนลด 2 ขั้น
 *
 * ⚠️ ตั้งใจไม่ปัดเศษ — มีผู้เรียกเพียงจุดเดียว (lineHandler: ส่วนลดแบบ net ที่เขียนทับ unit price)
 * ที่ต้องการค่าปัดแล้ว จุดนั้นเรียก round2() ครอบเอง ถ้าย้ายการปัดเข้ามาในนี้
 * ยอดรวมของทุกใบจะเลื่อนระดับสตางค์
 */
export function calcNetPrice(price: number, disc1: number, disc2: number): number {
  const p = Number(price) || 0;
  const d1 = Number(disc1) || 0;
  const d2 = Number(disc2) || 0;
  return p * (1 - d1 / 100) * (1 - d2 / 100);
}

/** ยอดรวมของรายการเดียว = จำนวน × ราคาสุทธิต่อหน่วย (รองรับทั้ง quantity และ qty) */
export function calcLineTotal(item: any): number {
  const qty = Number(item?.quantity ?? item?.qty) || 0;
  return qty * calcNetPrice(item?.price, item?.discount_1, item?.discount_2);
}

/** ยอดรวมสินค้าทั้งใบ (ก่อน VAT) */
export function sumLineTotals(items: any[]): number {
  return (items || []).reduce((sum, item) => sum + calcLineTotal(item), 0);
}

/** VAT 7% จากฐานก่อน VAT (ปัด 2 ตำแหน่ง) */
export function calcVat(baseBeforeVat: number): number {
  return round2(baseBeforeVat * VAT_RATE);
}

/** ยอดสุทธิรวม VAT (ปัด 2 ตำแหน่ง) */
export function calcGrandTotal(baseBeforeVat: number): number {
  return round2(baseBeforeVat + calcVat(baseBeforeVat));
}

/**
 * ยอดท้ายใบทั้ง 5 ช่องที่พิมพ์อยู่บนใบเสนอราคา — **ที่เดียวของทั้งระบบ**
 *
 * มีเพราะตั้งแต่ 2026-09-17 หน้าจอ "ใบร่าง" ของหน้าขอใบเสนอราคาโชว์ยอดชุดเดียวกับใบจริง
 * ถ้าปล่อยให้แต่ละฝั่งบวกเอง วันหนึ่งจอกับไฟล์จะไม่ตรงกันโดยไม่มีอะไรฟ้อง
 *
 * ⚠️ **`discount_shown` เป็น 0 เสมอ ไม่ใช่บั๊ก** — ช่อง "ส่วนลด" บนใบพิมพ์ `0.00` มาตลอด
 * (pdfGenerator เดิมเขียน `const totalDiscountAmount = 0.00;` ตายตัว) เพราะส่วนลดถูกหักลง
 * ในราคารายบรรทัดไปแล้ว และคอลัมน์ DISCOUNT ของแต่ละแถวเป็นตัวที่บอกว่าหักไปกี่ %
 * ⇒ "รวมเงิน" กับ "มูลค่าหลังหักส่วนลด" จึงเป็นเลขเดียวกันเสมอ (= `net`)
 * `discount_line` คือส่วนต่างจริง มีไว้ให้ที่อื่นใช้ **แต่ห้ามเอาไปพิมพ์ในช่องส่วนลดของใบ**
 * โดยไม่ได้รับคำสั่ง เพราะนั่นคือการเปลี่ยนเอกสารที่ลูกค้าได้รับ
 */
export interface QuotationDocumentTotals {
  gross: number;
  net: number;
  discount_line: number;
  discount_shown: number;
  vat: number;
  grand: number;
}

export function quotationDocumentTotals(items: any[]): QuotationDocumentTotals {
  let gross = 0;
  let net = 0;
  for (const item of items || []) {
    const qty = Number(item?.quantity ?? item?.qty) || 0;
    gross += qty * (Number(item?.price) || 0);
    net += qty * calcNetPrice(item?.price, item?.discount_1, item?.discount_2);
  }
  return {
    gross,
    net,
    discount_line: gross - net,
    discount_shown: 0,
    vat: calcVat(net),
    grand: calcGrandTotal(net),
  };
}
