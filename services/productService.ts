import { createChatCompletion } from '../config/clients.js';
import { pool, withTransaction } from '../config/db.js';

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────
export interface Product {
  product_template_id: number;
  name: string;
  brand: string;
  series: string;
  model: string;
  sales_price: number;
  minimum_sales_price: number;
  product_group: string;
  product_category: string;
  product_sub_category: string;
  production: string;
  quantity_on_hand_unreserved: number;
  unit_of_measure: string;
  sales_description: string;
  // virtual fields จาก query
  _score?: number;
  _matched_from?: 'model' | 'name';
}

export interface FindProductResult {
  found: boolean;
  product?: Product;
  candidates: Product[];
  report: string;
}

// ─────────────────────────────────────────────
//  Normalize
//  - เก็บ - . / ไว้ เพราะเป็นส่วนของรหัสสินค้า
//  - ตัดเฉพาะ space, comma และ วงเล็บ ()
//  - เหตุผล: "TSP-08(S4)6x50-U" → "tsp-08s46x50-u"
//            "TSP-08(S4)6x50-U" ใน DB ก็ normalize เป็นเหมือนกัน
// ─────────────────────────────────────────────
function normalize(text: string = ''): string {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[\s,،\(\)]/g, '')                      // ลบ space, comma, วงเล็บ
    .replace(/[^a-z0-9\u0E00-\u0E7F\/\-\.\+]/g, '');  // เก็บ - . / +
}

// ─────────────────────────────────────────────
//  Helper: สกัดส่วนตัวเลขจาก query (≥3 หลักติดกัน)
//  เช่น "04120 AVK2.5" → ["04120"]
//       "NPP/AVK2.5-10 444120" → ["444120"] (เลือกที่ยาวสุด)
// ─────────────────────────────────────────────
function extractLongestNumber(text: string): string {
  const nums = String(text).match(/\d{3,}/g) || [];
  if (nums.length === 0) return '';
  // เลือกตัวเลขที่ยาวที่สุด (มักเป็น product code)
  return nums.sort((a, b) => b.length - a.length)[0] ?? '';
}

// ─────────────────────────────────────────────
//  Helper: สกัดส่วนที่ไม่ใช่ตัวเลขจาก normalized query
//  เช่น "04120avk2.5" → "avk2.5"
// ─────────────────────────────────────────────
function extractTextPart(qNorm: string): string {
  return qNorm.replace(/\d+/g, '').replace(/^[-\/\.]+|[-\/\.]+$/g, '') || '';
}

// ─────────────────────────────────────────────
//  Helper: text part สำหรับ "ส่งเข้า prompt ให้ AI ตัดสินใจ" เท่านั้น
//  ต่างจาก extractTextPart ตรงที่คืน '' เมื่อเศษที่ได้ไม่มีความหมาย
//  เช่น "50x800-550-3x220s-3000w-1" → extractTextPart ได้ "x--xs-w" (ขยะ — เกิดจากตัวอักษร
//  เดี่ยว x/s/w ที่แทรกกลางตัวเลข ไม่ใช่ชื่อรุ่น) ถ้าส่งขยะนี้เข้า prompt กติกาข้อ 1
//  ("ต้องเลือกเฉพาะตัวเลือกที่มี text part ไม่งั้นตอบ 0") จะบังคับให้ AI ตอบ 0
//  ทั้งที่ตัวเลือกที่ถูกอยู่ตรงหน้า → เคยทำให้หาสินค้าไม่เจอแบบสุ่ม
//  เกณฑ์ (วัดกับสินค้าจริง 50,752 รายการ): ถือว่ามี "ชื่อรุ่น" จริงเมื่อมี token ใด token หนึ่ง
//    (ก) ขึ้นต้นด้วยตัวอักษร  — j2d, h100p, v-42, r0  (ตัวอักษรเดี่ยวก็สำคัญ! เช่น J2D-H10N vs J2D-S10P,
//        ท้าย N/P = NPN/PNP คนละชนิดกัน — ห้ามปิด rule 1 ทิ้ง)
//    (ข) มีตัวอักษรติดกัน ≥2 ตัวในก้อนเดียว — 4vprt35, 5gn50k, 30a/50mv
//  ถ้าไม่เข้าทั้งสองข้อ แปลว่าตัวอักษรที่เจอเป็นแค่ "หน่วยที่ฝังในตัวเลข" (50x800, 3x220s, 3000w) = ขยะ
//  เกณฑ์นี้ปิด rule 1 กับสินค้าเพียง 0.57% และเหลือความเสี่ยงหลวมแค่ 28 รายการ (0.055%)
// ─────────────────────────────────────────────
function promptTextPart(qNorm: string): string {
  const L = '[a-z\\u0E00-\\u0E7F]';
  const hasModelName = qNorm.split(/[-\/.+]/).some(t =>
    new RegExp(`^${L}`).test(t) || new RegExp(`${L}{2,}`).test(t)
  );
  return hasModelName ? extractTextPart(qNorm) : '';
}

// ─────────────────────────────────────────────
//  Helper: สกัด "key tokens" = ส่วนที่มีตัวเลขปนอยู่ (ตัวระบุรุ่นที่สำคัญจริง)
//  แยก token ตาม separator ทุกชนิด (รวม space) เพื่อไม่ให้ token เชื่อมกันผิด
//  เช่น "TIM-94N-AB-220"      → ["94n", "220"]
//       "TIM-94N-4CH-AB-220"  → ["94n", "4ch", "220"]
//       "CMA-005-1-220-P1K"   → ["005", "1", "220", "p1k"]
//  ส่วนที่เป็นตัวอักษรล้วน (tim, ab, cma) มักเป็น prefix/suffix ที่ใช้ร่วมกันหลายรุ่น
//  จึงไม่ถือเป็นตัวระบุ
// ─────────────────────────────────────────────
function codeKeyTokens(s: string): string[] {
  return String(s)
    .toLowerCase()
    .split(/[\s,()/.\-]+/)
    .filter((t) => t.length > 0 && /\d/.test(t));
}

// ─────────────────────────────────────────────
//  Guard: ตรวจว่าตัวเลือกที่ AI/fuzzy เลือกมา "ตรงกับ query" ในระดับ key token
//   1) forward — key token ทุกตัวของ query ต้องปรากฏใน model หรือ name
//      (กันการเลือกตัวที่ขาดตัวระบุสำคัญ)
//   2) reverse — ถ้า query เป็นรหัสเต็ม (มีส่วนตัวอักษร/textPart) model ต้องไม่มี
//      key token "เกิน" มาที่ query ไม่ได้ระบุ (กันรุ่นที่มี spec เพิ่ม เช่น 4CH)
//      *ข้าม reverse เมื่อ query เป็นตัวเลขล้วน เพราะผู้ใช้ตั้งใจค้นด้วยเลขเท่านั้น
//  ป้องกัน auto-correct รหัสที่ไม่มีในฐานข้อมูลไปเป็นรุ่นใกล้เคียงที่ผิด
//  คืน null = ผ่าน, หรือ string อธิบายเหตุที่ปฏิเสธ (ไว้ log)
// ─────────────────────────────────────────────
function keyTokenMismatchReason(raw: string, product: Product): string | null {
  const queryTokens = codeKeyTokens(raw);
  if (queryTokens.length === 0) return null; // ไม่มี token ตัวเลข → ไม่มีอะไรให้ตรวจ

  const model = normalize(product.model || '');
  const name = normalize(product.name || '');

  // 1) forward — query key token ทุกตัวต้องปรากฏใน model/name
  const missing = queryTokens.filter((t) => !model.includes(t) && !name.includes(t));
  if (missing.length > 0) return `missing key token(s) ${missing.join(', ')}`;

  // 2) reverse — เฉพาะเมื่อ query เป็นรหัสเต็ม (มีส่วนตัวอักษร)
  const textPart = extractTextPart(normalize(raw));
  if (textPart.length >= 2) {
    const querySet = new Set(queryTokens);
    const extra = codeKeyTokens(product.model || '').filter((t) => !querySet.has(t));
    if (extra.length > 0) return `extra key token(s) ${extra.join(', ')}`;
  }

  return null;
}

// ─────────────────────────────────────────────
//  รายการ "รุ่นใกล้เคียง" ที่ส่งกลับให้เซลส์กดเลือก — ยุบรุ่นซ้ำ + ถ่วงน้ำหนักของที่มีสต็อก
//
//  วัดกับเคสจริง 342 เคส (ข้อความที่บอทเคยตอบ "พบหลายรุ่นใกล้เคียง" ระหว่าง 2026-06-17 ถึง
//  2026-09-16 จับคู่กับรุ่นที่เซลส์เลือกจริงในใบที่ออกตามมาภายใน 15 นาที):
//    ของเดิม — 3 ตัว เรียงตาม similarity ล้วน   รุ่นที่ถูกอยู่ในรายการ 87.4%
//    ของนี้  — 5 ตัว + โบนัสมีของ + ยุบรุ่นซ้ำ    95.9%  (ดีขึ้น 29 เคส · แย่ลง 0 เคส)
//
//  **ทำไมเป็น "โบนัส" ไม่ใช่ "เอาของที่มีสต็อกขึ้นก่อน"** — รุ่นที่เซลส์เลือกจริงมีของ 90.1%
//  สูงพอให้ถ่วงน้ำหนัก แต่ไม่ใช่ทั้งหมด: 34/342 เคสเขาตั้งใจสั่งรุ่นที่ของเหลือ 0 ⇒ เรียง
//  "มีของก่อน" แบบแข็ง ๆ วัดแล้วพัง 14 เคส · ค่าโบนัสกวาดตั้งแต่ 0.02 ถึง 1.0 แล้ว
//  ช่วง 0.05–0.10 ดีที่สุด และตั้งแต่ 0.15 ขึ้นไปผลรวมเริ่มแย่ลง
//
//  ⚠️ **โบนัสนี้ใช้ตอน "เลือกว่าจะโชว์อะไร" เท่านั้น ห้ามย้ายไปใส่ใน ORDER BY ของ SQL และ
//  ห้ามเขียนทับ `_score`** เพราะ `_score` ของแถวแรกคือตัวตัดสินว่าจะ "เชื่อได้เลย (≥0.9)"
//  หรือ "ให้ AI เลือก (≥0.20)" — วัดกับรหัสที่เซลส์พิมพ์จริง 3,679 รหัส: ย้ายไปไว้ใน SQL
//  แล้วหัวแถวของเส้น AI เปลี่ยน 90 รหัส (4.8%) ทั้งที่เส้นนั้นเลือกถูกอยู่แล้ว
//  (เส้น ≥0.9 เปลี่ยน 0 รหัส เพราะรหัสที่ตรงเป๊ะถูก Stage 1 คว้าไปก่อนแล้ว)
//
//  **ยุบรุ่นซ้ำ** — ฐานสินค้ามี 453 กลุ่มที่ชื่อรุ่น normalize แล้วตรงกัน (920 แถว) และ 419 กลุ่ม
//  ชื่อเหมือนกันทุกตัวอักษร เช่น `FP-108EX 220 V.S1BW` (ของ 3,184) กับ `FP-108 EX 220 V.S1BW`
//  (ของ 0) ⇒ เซลส์เห็นสองบรรทัดที่แยกไม่ออกและเปลืองช่องไปเปล่า ๆ เก็บตัวที่ของเหลือมากกว่าไว้
//  (ต้นตออยู่ที่ข้อมูล Odoo ไม่ใช่ที่นี่ — ที่นี่แค่ไม่เอามาโชว์ซ้ำ)
// ─────────────────────────────────────────────
export const CANDIDATE_LIMIT = 5;
const IN_STOCK_BONUS = 0.05;

export function buildCandidateList<T extends Product>(rows: T[]): T[] {
  const byModel = new Map<string, T>();
  for (const row of rows) {
    const key = normalize(row.model || '');
    const kept = byModel.get(key);
    if (
      !kept ||
      Number(row.quantity_on_hand_unreserved || 0) > Number(kept.quantity_on_hand_unreserved || 0)
    ) {
      byModel.set(key, row);
    }
  }

  const rankOf = (p: T) =>
    (Number(p._score) || 0) +
    (Number(p.quantity_on_hand_unreserved || 0) > 0 ? IN_STOCK_BONUS : 0);

  // Array.prototype.sort เสถียรตั้งแต่ ES2019 ⇒ แถวที่คะแนนเท่ากันคงลำดับเดิมที่ต้นทางให้มา
  // (สำคัญกับ Stage 1.3/legacy ที่ไม่มี `_score` และเรียงมาด้วยเกณฑ์ของตัวเองแล้ว)
  return [...byModel.values()].sort((a, b) => rankOf(b) - rankOf(a)).slice(0, CANDIDATE_LIMIT);
}

// ─────────────────────────────────────────────
//  รายงานข้อความของรายการรุ่นใกล้เคียง — ที่เดียวทั้งสามเส้นทาง (stage 1.3 / stage 2 / legacy)
//  และ thaiSuffixVariant.ts ที่เรียงรายการใหม่หลัง findProduct
// ─────────────────────────────────────────────
export function candidateReport(header: string, candidates: Product[]): string {
  let report = `${header}\n`;
  candidates.forEach((p) => {
    const price = Number(p.sales_price || 0).toLocaleString();
    const stock = Number(p.quantity_on_hand_unreserved || 0);
    report += `📌 รุ่น: ${p.model}\n`;
    report += `💵 ฿${price}  (📦คงเหลือ ${stock})\n`;
    report += `-------------------------------------\n`;
  });
  return report;
}

// ด่าน scripts/diag/productCandidateEval.ts เรียก normalize ตัวนี้ผ่านชื่อนี้ — ให้ด่านตรวจ
// ใช้ของจริงร่วมกัน ไม่ใช่สำเนาที่แช่แข็งไว้แล้วเพี้ยนจากกันเงียบ ๆ
export { normalize as normalizeProductCode };

// ─────────────────────────────────────────────
//  Main findProduct = ขั้นค้นเดิมทุกขั้น → ด่าน "ลำดับของรหัส" (ข้างล่าง)
// ─────────────────────────────────────────────
export async function findProduct(codeRaw: any, chatContext?: string): Promise<FindProductResult> {
  const result = await findProductStages(codeRaw, chatContext);
  return applySequenceGuard(String(codeRaw || '').trim(), result);
}

async function findProductStages(codeRaw: any, chatContext?: string): Promise<FindProductResult> {
  const codeTrimmed = String(codeRaw || '').trim();

  if (!codeTrimmed) {
    return { found: false, candidates: [], report: '❌ ไม่ระบุรหัสสินค้า\n' };
  }

  const qNorm = normalize(codeTrimmed);

  if (!qNorm) {
    return {
      found: false,
      candidates: [],
      report: `❌ ไม่พบสินค้ารหัส "${codeTrimmed}"\n`,
    };
  }

  // ── Stage 1: Exact match (normalize ทั้ง 2 ฝั่ง) ────────────────────────
  const stage1 = await exactMatch(qNorm, codeTrimmed);
  if (stage1) {
    return { found: true, product: stage1, candidates: [], report: '' };
  }

  // ── Stage 1.3: Multi-token AND Search (ค้นหาด้วย AND ทุกคำ) ──────────────
  const stage13 = await multiTokenAndSearch(qNorm, codeTrimmed, chatContext);
  if (stage13.product) {
    return { found: true, product: stage13.product, candidates: [], report: '' };
  }
  // Stage 1.3 พบ candidates แต่ AI เลือกไม่ได้ → หยุดเลย ไม่ไป Stage ถัดไป
  // (ป้องกัน Stage 2 fuzzy auto-select ผิดเพราะ query สั้นกว่า model ใน DB)
  if (stage13.candidates.length > 0) {
    const candidates = buildCandidateList(stage13.candidates);
    const report = candidateReport(
      `⚠️ พบหลายรุ่นที่ตรงกับ "${codeTrimmed}" กรุณาระบุเพิ่มเติม`,
      candidates
    );
    return { found: false, candidates, report };
  }

  // ── Stage 1.5: Numeric code search (LIKE '%code%' ใน model+name) ─────────
  const numericCode = extractLongestNumber(codeTrimmed);
  if (numericCode) {
    const stage15 = await numericCodeSearch(numericCode, qNorm, codeTrimmed, chatContext);
    if (stage15) {
      return { found: true, product: stage15, candidates: [], report: '' };
    }
  }

  // ── Stage 1.7: Split-part fuzzy (numeric part + text part แยกกัน) ────────
  const textPart = extractTextPart(qNorm);
  if (numericCode && textPart && textPart.length >= 2) {
    try {
      const stage17 = await splitPartFuzzySearch(numericCode, textPart, codeTrimmed, chatContext);
      if (stage17) {
        return { found: true, product: stage17, candidates: [], report: '' };
      }
    } catch (_e) {
      // pg_trgm ไม่พร้อม → ข้ามไป Stage 2
    }
  }

  // ── Stage 2: pg_trgm fuzzy + AI pick ────────────────────────────────────
  try {
    return await fuzzySearch(codeTrimmed, qNorm, chatContext);
  } catch (pgError: any) {
    // pg_trgm ยังไม่ได้ติดตั้ง → fallback วิธีเดิม
    console.warn('[findProduct] pg_trgm unavailable, using legacy search:', pgError.message);
    return legacySearch(codeTrimmed, qNorm);
  }
}

// ─────────────────────────────────────────────
//  ด่าน "ลำดับของรหัส" — กันผลที่ผิดซีรีส์ (เพิ่ม 2026-09-25 · เจ้าของเลือก "แบบ A")
//
//  ปัญหา: Stage 1.5 ค้นด้วย "เลขที่ยาวที่สุด" ตัวเดียว แล้วเทียบแค่ตัวอักษร ⇒ `PMV25.01.024`
//  ค้นด้วย `024` + `pmv` ได้ `PMV12.00024` (ผิดซีรีส์ เลข 25/01 ไม่ถูกดูเลย) และ `pmv25.c220`
//  ค้นด้วย `220` ได้ 10 แถวแรกเป็น PMV250… ทั้งหมด ⇒ `PMV25C.01220` ไม่เคยได้เป็นตัวเลือก
//
//  กติกา: รหัสที่เซลส์พิมพ์แบ่งเป็นช่วงตัวอักษร/ตัวเลข (`pmv25.c220` → pmv|25|c|220) รุ่นที่
//  "เข้าข่าย" คือรุ่นที่ขึ้นต้นด้วยช่วงแรกและมีทุกช่วงเรียงตามลำดับ (แทรกได้ ≤ 4 ตัว) —
//    · ผลเดิมเลือกรุ่นที่เข้าข่ายอยู่แล้ว          → ไม่แตะ (ไม่ query เพิ่มด้วย)
//    · ผลเดิมเลือกรุ่นที่ไม่เข้าข่าย แต่มีรุ่นที่เข้าข่าย → **ไม่เลือกแทนให้** เปลี่ยนเป็นให้เซลส์เลือก
//      (รุ่นที่เข้าข่ายก่อน รุ่นเดิมท้ายสุด)
//    · ผลเดิมเป็นรายการให้เลือก                     → ตัวที่เข้าข่ายของเดิมคงลำดับเดิม แทรกรุ่นที่
//      เข้าข่ายต่อท้ายพวกนั้น (≤ 3 ตัวถ้ายังมีของเดิมที่ไม่เข้าข่าย — ไม่ดันของเดิมหลุดทั้งหมด)
//  ⚠️ ห้ามเปลี่ยนเป็น "ตัดจุด/ขีดแล้วตรง = เลือกให้เลย" (แบบ B ที่ไม่ได้เลือก): ตัดตัวคั่นแล้ว
//  สินค้า 136 กลุ่ม / 274 รุ่นชนกัน และบางคู่คนละของจริง (`…+1.5m` กับ `…+15m`)
//
//  ทดลองก่อนเขียน (2026-09-25 · รหัสจริง 2,543 ตัว = AI สกัด 531 + ดึงจากข้อความจริง 2,000 + เคสเป้าหมาย):
//  เหมือนเดิม 2,464 · เลือกผิด → ให้เลือก 8 (ไล่ดูแล้ว ผลเดิมผิดชัดทั้ง 8 เช่น `PEV4000` → `VT-4000`) ·
//  เรียงตัวเลือกใหม่ 71 · ไม่มีรายการไหนถูกเลือกให้ใหม่ · query เพิ่ม p50 3 ms / p95 8 ms
//  ล้มเหลวด้วยเหตุใดก็ตาม = คืนผลเดิม · export ไว้ให้ `scripts/diag/findProductSequence.ts` เรียกตรง
//
//  แก้ 2026-09-25 (ตรวจซ้ำก่อน deploy · ไล่ชื่อรุ่นทุกตัวในฐานเป็นรหัสของตัวเอง): เดิม **326 รุ่นไม่ผ่านกติกา
//  ของตัวเอง** และ 3 รุ่นในนั้นถูกเปลี่ยนเป็นให้เลือกจริง (`ลวดชั้นท์ 30A/50mV` · `ขาหยึดติดตั้งCMT-007BN`)
//  ทั้งที่พิมพ์ชื่อรุ่นมาเป๊ะ — หน้าเว็บ (`resolveItems` ที่หาด้วยรหัสเต็ม) จะตอบ "ไม่พบสินค้า"
//  สาเหตุสองข้อ: (1) ตัดคำไทยทิ้งแล้วช่วงสองฝั่งติดกัน (`Heater (หล่อ…) Size` → `heatersize` ·
//  `WS5/8*แหวน…5/8` → `…85…`) ⇒ คำไทยต้องเป็นตัวคั่น (2) ชื่อที่ขึ้นต้นด้วยไทย/สัญลักษณ์
//  (`สาย THW 10 Sq.mm.`) ไม่มีวันขึ้นต้นด้วยช่วงแรก ⇒ ข้ามรหัสแบบนี้ (273 รุ่น) · หลังแก้: 0 จาก 50,891 ·
//  และรุ่นที่ normalize แล้วตรงกับรหัสเป๊ะ ไม่แตะเสมอ ไม่ว่ากติกาข้างบนจะเป็นยังไง
//  query กรองความยาวใน SQL ก่อน `LIMIT` — เดิมรหัสสั้น (`TSK-01-0`) ได้เกิน 300 แถวแล้วตัดตามสต็อก
//  ทำให้รุ่นที่ใกล้ที่สุดหลุดได้ (9 จาก 2,543 รหัสในชุดทดลอง) · รหัสจริง 2,543 ตัวผลเท่าเดิมทุกตัวหลังแก้ทั้งหมดนี้
// ─────────────────────────────────────────────
const SEQ_MAX_EXTRA = 4;
const SEQ_MAX_INSERT_WITH_ORIGINALS = 3;
const THAI_CHARS = /[฀-๿]/g;
const MODEL_NORM_SQL = `LOWER(REGEXP_REPLACE(COALESCE(model, ''), '[\\s,\\(\\)]', '', 'g'))`;

/** ช่วงตัวอักษร/ตัวเลข แบ่งจากรหัสที่ยังมีตัวคั่น — "25.01.024" ต้องเป็น 25|01|024 ไม่ใช่ 2501024
 *  คำไทยเป็นตัวคั่นด้วย ห้ามตัดทิ้งเฉย ๆ ("Heater (หล่อ…) Size" ต้องเป็น heater|size ไม่ใช่ heatersize) */
function codeRuns(code: string): string[] {
  return normalize(code).replace(THAI_CHARS, ' ').match(/[a-z]+|[0-9]+/g) ?? [];
}
function codeSkeleton(code: string): string {
  return normalize(code).replace(THAI_CHARS, '').replace(/[^a-z0-9]/g, '');
}
function followsSequence(runs: string[], model: string): boolean {
  const m = normalize(model);
  if (!m.startsWith(runs[0]!)) return false;
  let i = runs[0]!.length;
  for (const r of runs.slice(1)) {
    const j = m.indexOf(r, i);
    if (j < 0) return false;
    i = j + r.length;
  }
  return true;
}

export async function applySequenceGuard(code: string, result: FindProductResult): Promise<FindProductResult> {
  try {
    // ตรงกับรหัสเป๊ะ = ไม่แตะ (หน้าเว็บหาสินค้าด้วยรหัสเต็มแล้วต้องได้ตัวนั้น ไม่ใช่รายการให้เลือก)
    if (result.found && result.product && normalize(result.product.model || '') === normalize(code)) return result;
    const runs = codeRuns(code);
    const sk = codeSkeleton(code);
    if (sk.length < 5 || runs.length < 2 || !runs.some((r) => /[a-z]/.test(r)) || !runs.some((r) => /\d/.test(r))) {
      return result;
    }
    // ขึ้นต้นด้วยไทย/สัญลักษณ์ ("สาย THW 10") — กติกา "ขึ้นต้นด้วยช่วงแรก" ใช้ไม่ได้ ⇒ ไม่ตัดสิน
    if (!/^[a-z0-9]/.test(normalize(code))) return result;
    if (result.found && result.product && followsSequence(runs, result.product.model || '')) return result;

    const { rows } = await pool.query<Product>(
      `SELECT * FROM products
        WHERE is_system_item = false AND ${MODEL_NORM_SQL} LIKE $1
          AND LENGTH(REGEXP_REPLACE(LOWER(COALESCE(model, '')), '[^a-z0-9]', '', 'g')) <= $2
        ORDER BY quantity_on_hand_unreserved DESC
        LIMIT 300`,
      [runs.join('%') + '%', sk.length + SEQ_MAX_EXTRA]
    );
    const extraOf = (p: Product) => codeSkeleton(p.model || '').length - sk.length;
    const seq = dedupeByModel(rows.filter((p) => extraOf(p) <= SEQ_MAX_EXTRA)).sort(
      (a, b) => extraOf(a) - extraOf(b) ||
        Number(b.quantity_on_hand_unreserved || 0) - Number(a.quantity_on_hand_unreserved || 0)
    );
    if (seq.length === 0) return result;

    if (result.found && result.product) {
      const candidates = dedupeByModel([...seq.slice(0, CANDIDATE_LIMIT - 1), result.product]);
      console.log(`[findProduct] sequence: "${code}" ${result.product.model} ไม่ตรงลำดับ → ให้เลือก ${candidates.map((c) => c.model).join(' | ')}`);
      return {
        found: false,
        candidates,
        report: candidateReport(`⚠️ พบหลายรุ่นที่ตรงกับ "${code}" กรุณาระบุเพิ่มเติม`, candidates),
      };
    }

    const orig = result.candidates || [];
    const ok = orig.filter((p) => followsSequence(runs, p.model || ''));
    const bad = orig.filter((p) => !followsSequence(runs, p.model || ''));
    const known = new Set(orig.map((p) => normalize(p.model || '')));
    const added = seq.filter((p) => !known.has(normalize(p.model || '')))
      .slice(0, bad.length ? SEQ_MAX_INSERT_WITH_ORIGINALS : CANDIDATE_LIMIT);
    const candidates = dedupeByModel([...ok, ...added, ...bad]).slice(0, CANDIDATE_LIMIT);
    const key = (list: Product[]) => list.slice(0, CANDIDATE_LIMIT).map((p) => normalize(p.model || '')).join('|');
    if (key(candidates) === key(orig)) return result;

    console.log(`[findProduct] sequence: "${code}" เรียงตัวเลือกใหม่ ${candidates.map((c) => c.model).join(' | ')}`);
    const header = orig.length ? (result.report.split('\n')[0] || '') : '';
    return {
      found: false,
      candidates,
      report: candidateReport(header || `⚠️ พบหลายรุ่นที่ตรงกับ "${code}" กรุณาระบุเพิ่มเติม`, candidates),
    };
  } catch (err: any) {
    console.warn('[findProduct] sequence: ข้าม — ใช้ผลเดิม:', err?.message || err);
    return result;
  }
}

function dedupeByModel(rows: Product[]): Product[] {
  const seen = new Set<string>();
  return rows.filter((p) => {
    const k = normalize(p.model || '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ─────────────────────────────────────────────
//  Stage 1: Exact match
//  normalize ทั้ง 2 ฝั่ง รวมถึงตัด () ด้วย
//  ทำให้ "TSP-08(S4)6x50-U" === "tsp-08s46x50-u" ทั้งคู่
// ─────────────────────────────────────────────
async function exactMatch(qNorm: string, codeTrimmed: string): Promise<Product | null> {
  try {
    const { rows } = await pool.query<Product>(
      `
      SELECT *
      FROM products
      WHERE is_system_item = false
        AND (
          LOWER(REGEXP_REPLACE(COALESCE(model, ''), '[\\s,\\(\\)]', '', 'g')) = $1
          OR LOWER(REGEXP_REPLACE(COALESCE(name,  ''), '[\\s,\\(\\)]', '', 'g')) = $1
        )
      ORDER BY quantity_on_hand_unreserved DESC
      LIMIT 1
      `,
      [qNorm]
    );

    if (rows.length === 0) return null;

    console.log(`[findProduct] stage1 exact: ${rows[0].model}`);
    return rows[0];
  } catch (err) {
    console.error('[exactMatch] error:', err);
    return null;
  }
}

// ─────────────────────────────────────────────
//  Stage 1.3: Multi-token AND Search
//  ใช้เมื่อผู้ใช้พิมพ์คำค้นหาแยกด้วยช่องว่างหลายคำ เช่น "TSK-11P 6x50+2M"
//  จะช่วยให้หาได้แม่นยำขึ้นโดยการบังคับให้ผลลัพธ์มีคำค้นหาทุกคำ (AND)
//
//  Return:
//    product    = สินค้าที่เลือกได้ชัดเจน
//    candidates = รายการที่พบแต่เลือกไม่ได้ (AI ตอบ 0) → caller ต้อง return ทันที
//                 ห้ามปล่อยให้ไหลต่อไป Stage ถัดไป เพราะ fuzzy จะเลือกผิด
// ─────────────────────────────────────────────
async function multiTokenAndSearch(
  qNorm: string,
  codeTrimmed: string,
  chatContext?: string
): Promise<{ product: Product | null; candidates: Product[] }> {
  const empty = { product: null, candidates: [] };
  try {
    const rawTokens = codeTrimmed.split(/\s+/).filter(Boolean);
    // กรองเอาเฉพาะ token ที่ยาวอย่างน้อย 2 ตัวอักษร หรือมีตัวเลขปนอยู่
    const tokens = rawTokens.filter(token => token.length >= 2 || /\d/.test(token));

    if (tokens.length < 2) {
      return empty;
    }

    const conditions: string[] = [];
    const values: any[] = [];

    tokens.forEach((token, index) => {
      const paramIndex = index + 1;
      conditions.push(`(model ILIKE $${paramIndex} OR name ILIKE $${paramIndex})`);
      values.push(`%${token}%`);
    });

    const sql = `
      SELECT *
      FROM products
      WHERE ${conditions.join(' AND ')}
        AND production NOT ILIKE '%buytosell%'
        AND is_system_item = false
      ORDER BY quantity_on_hand_unreserved DESC
      LIMIT 10
    `;

    const { rows } = await pool.query<Product>(sql, values);
    if (rows.length === 0) return empty;

    console.log(`[findProduct] stage1.3 multiTokenAndSearch found ${rows.length} row(s)`);

    // ถ้าได้ผลเดียว → return ทันที
    if (rows.length === 1) return { product: rows[0], candidates: [] };

    // ถ้าได้หลายผล → ลองหาผลที่ตรงกับ qNorm (normalize แล้วตรงเป๊ะ)
    const exactRow = rows.find(
      (r) => normalize(r.model || '') === qNorm || normalize(r.name || '') === qNorm
    );
    if (exactRow) {
      console.log(`[findProduct] stage1.3 exact normalize match: ${exactRow.model}`);
      return { product: exactRow, candidates: [] };
    }

    // ถ้าได้หลายผลและไม่มี normalize ตรงเป๊ะ → ส่งให้ AI ช่วยเลือก
    console.log(`[findProduct] stage1.3 multiple(${rows.length}) → AI pick`);
    const candidatesForAI = rows.map(r => ({ ...r, _score: 0.5, _matched_from: 'model' as const }));
    const best = await pickBestWithAI(codeTrimmed, candidatesForAI, undefined, chatContext);

    if (best) {
      return { product: best, candidates: [] };
    }

    // AI ตอบ 0 → ส่ง candidates กลับ ให้ caller หยุดและแจ้ง user
    console.log(`[findProduct] stage1.3 AI no match → returning ${rows.length} candidates to caller`);
    return { product: null, candidates: rows };
  } catch (err) {
    console.error('[multiTokenAndSearch] error:', err);
    return empty;
  }
}

// ─────────────────────────────────────────────
//  Stage 1.5: Numeric Code Search
//  ค้นหา LIKE '%numericCode%' ใน model และ name ทั้งคู่
//  รองรับทั้งกรณีตัวเลขอยู่หน้า/หลัง ใน DB
// ─────────────────────────────────────────────
async function numericCodeSearch(
  numericCode: string,
  qNorm: string,
  codeTrimmed: string,
  chatContext?: string
): Promise<Product | null> {
  try {
    const result = await pool.query<Product>(
      `
      SELECT *
      FROM products
      WHERE (
        LOWER(REGEXP_REPLACE(COALESCE(model, ''), '[\\s,\\(\\)]', '', 'g')) LIKE $1
        OR LOWER(REGEXP_REPLACE(COALESCE(name,  ''), '[\\s,\\(\\)]', '', 'g')) LIKE $1
      )
      AND production NOT ILIKE '%buytosell%'
      AND is_system_item = false
      ORDER BY quantity_on_hand_unreserved DESC
      LIMIT 10
      `,
      [`%${numericCode}%`]
    );

    const rows = result.rows;
    if (rows.length === 0) return null;

    console.log(`[findProduct] stage1.5 numeric='${numericCode}' found ${rows.length} row(s)`);

    // ถ้าได้ 1 ผลเดียว → return ทันที
    if (rows.length === 1) return rows[0];

    // ถ้าได้หลายผล → ลอง exact normalize match กับ qNorm ก่อน
    const exactRow = rows.find(
      (r) => normalize(r.model || '') === qNorm || normalize(r.name || '') === qNorm
    );
    if (exactRow) return exactRow;

    // ลอง match ส่วน text part ด้วย (เช่น avk2.5 ใน model)
    const textPart = extractTextPart(qNorm);
    if (textPart && textPart.length >= 2) {
      const textMatch = rows.find(
        (r) =>
          normalize(r.model || '').includes(textPart) ||
          normalize(r.name || '').includes(textPart)
      );
      if (textMatch) {
        console.log(`[findProduct] stage1.5 text-match: ${textMatch.model}`);
        return textMatch;
      }
    }

    // หลายผล ไม่สามารถ auto-select ได้
    // ถ้ามี textPart แต่ไม่มีผลใดที่ match → ตัวเลขทั่วไป ไม่ควรเดา AI เลือก
    // ตัวอย่าง: CMP-24-220 → numeric=220, textPart=cmp แต่ไม่มี model/name ใดมี cmp → return null
    if (textPart && textPart.length >= 2) {
      console.log(`[findProduct] stage1.5 textPart='${textPart}' not found in any of ${rows.length} rows → skip to next stage`);
      return null;
    }

    // ไม่มี textPart (ตัวเลขล้วน) → ส่ง AI pick
    console.log(`[findProduct] stage1.5 multiple(${rows.length}) → AI pick`);
    const best = await pickBestWithAI(codeTrimmed, rows as (Product & { _score: number; _matched_from: string })[], numericCode, chatContext);
    return best;
  } catch (err) {
    console.error('[numericCodeSearch] error:', err);
    return null;
  }
}

// ─────────────────────────────────────────────
//  Stage 1.7: Split-part Fuzzy Search
//  ค้น pg_trgm โดยให้คะแนนกับ numeric part และ text part แยกกัน
//  ใช้เมื่อ query มีทั้งตัวเลขและตัวอักษร
// ─────────────────────────────────────────────
async function splitPartFuzzySearch(
  numericCode: string,
  textPart: string,
  codeTrimmed: string,
  chatContext?: string
): Promise<Product | null> {
  const result = await pool.query<Product & { _score: number; _matched_from: string }>(
    `
    SELECT *,
      GREATEST(
        similarity(
          LOWER(REGEXP_REPLACE(COALESCE(model, ''), '[\\s,\\(\\)]', '', 'g')),
          $2
        ),
        similarity(
          LOWER(REGEXP_REPLACE(COALESCE(name, ''),  '[\\s,\\(\\)]', '', 'g')),
          $2
        )
      ) AS _score,
      CASE
        WHEN similarity(
            LOWER(REGEXP_REPLACE(COALESCE(model, ''), '[\\s,\\(\\)]', '', 'g')), $2
          ) >= similarity(
            LOWER(REGEXP_REPLACE(COALESCE(name, ''),  '[\\s,\\(\\)]', '', 'g')), $2
          )
          THEN 'model'
        ELSE 'name'
      END AS _matched_from
    FROM products
    WHERE (
      LOWER(REGEXP_REPLACE(COALESCE(model, ''), '[\\s,\\(\\)]', '', 'g')) LIKE $1
      OR LOWER(REGEXP_REPLACE(COALESCE(name,  ''), '[\\s,\\(\\)]', '', 'g')) LIKE $1
    )
    AND production NOT ILIKE '%buytosell%'
    AND is_system_item = false
    ORDER BY _score DESC
    LIMIT 5
    `,
    [`%${numericCode}%`, textPart]
  );

  const rows = result.rows;
  if (rows.length === 0) return null;

  console.log(`[findProduct] stage1.7 numeric='${numericCode}' text='${textPart}' found ${rows.length}, top score=${rows[0]._score}`);

  // คะแนนสูงพอ → return ทันที (แต่ต้องผ่าน key-token guard)
  if (rows[0]._score >= 0.40) {
    const reason = keyTokenMismatchReason(codeTrimmed, rows[0]);
    if (reason) {
      console.log(`[findProduct] stage1.7 rejected ${rows[0].model}: ${reason}`);
      return null;
    }
    console.log(`[findProduct] stage1.7 auto-select: ${rows[0].model}`);
    return rows[0];
  }

  // คะแนนปานกลาง → AI pick (แล้วตรวจ key-token guard อีกชั้น)
  if (rows[0]._score >= 0.20) {
    const best = await pickBestWithAI(codeTrimmed, rows, numericCode, chatContext);
    if (best) {
      const reason = keyTokenMismatchReason(codeTrimmed, best);
      if (reason) {
        console.log(`[findProduct] stage1.7 rejected AI pick ${best.model}: ${reason}`);
        return null;
      }
    }
    return best;
  }

  return null;
}

// ─────────────────────────────────────────────
//  Stage 2: pg_trgm fuzzy search
//  ใช้ qNorm ที่ตัด () แล้วเพื่อให้ trigram match ดีขึ้น
// ─────────────────────────────────────────────
async function fuzzySearch(codeTrimmed: string, qNorm: string, chatContext?: string): Promise<FindProductResult> {
  // normalize สำหรับ pg_trgm — ตัด () เช่นเดียวกัน
  const qNormForTrgm = qNorm; // ตัด () ไปแล้วใน normalize()

  // ── ด่านกรองที่ใช้ index ได้ ────────────────────────────────────────────────
  // เงื่อนไข similarity(...) > 0.25 ใช้ index ไม่ได้ ต้องคำนวณทีละแถวบนทั้งตาราง
  // จึงเติม operator % (ตัวเดียวที่ GIN trgm index รองรับ) เข้าไป "เพิ่ม" โดยคงเงื่อนไข
  // เดิมไว้ครบทุกข้อ ⇒ ชุดผลลัพธ์และลำดับเท่าเดิมเป๊ะ แต่ตัดแถวทิ้งได้ตั้งแต่ชั้น index
  //
  // ⚠️ a % b เป็นจริงเมื่อ similarity(a, b) >= pg_trgm.similarity_threshold ซึ่ง default = 0.3
  //    "เข้มกว่า" เกณฑ์ 0.25 ของเรา ⇒ ถ้าปล่อยตามค่า default แถวที่ similarity อยู่ใน
  //    [0.25, 0.3) จะถูกตัดหายเงียบ ๆ ไม่มี error ให้เห็น = ผลค้นหาเพี้ยนแบบตรวจจับไม่ได้
  //    จึงตั้งค่าไว้ในโค้ดตรงนี้เอง ไม่ฝากไว้กับ config ของ DB ซึ่งหายได้ตอนสร้าง DB ใหม่
  //    (SET LOCAL ต้องอยู่ใน transaction ถึงจะมีผล และหมดผลเองตอน COMMIT จึงไม่ค้างติด
  //     ไปกับ connection ที่คืนเข้า pool)
  const result = await withTransaction(async (client) => {
    await client.query(`SET LOCAL pg_trgm.similarity_threshold = 0.25`);
    return client.query<Product & { _score: number; _matched_from: string }>(
    `
    SELECT *,
      GREATEST(
        similarity(
          LOWER(REGEXP_REPLACE(COALESCE(model, ''), '[\\s,\\(\\)]', '', 'g')),
          $1
        ),
        similarity(
          LOWER(REGEXP_REPLACE(COALESCE(name, ''), '[\\s,\\(\\)]', '', 'g')),
          $1
        )
      ) AS _score,

      CASE
        WHEN similarity(
            LOWER(REGEXP_REPLACE(COALESCE(model, ''), '[\\s,\\(\\)]', '', 'g')), $1
          ) >= similarity(
            LOWER(REGEXP_REPLACE(COALESCE(name, ''),  '[\\s,\\(\\)]', '', 'g')), $1
          )
          THEN 'model'
        ELSE 'name'
      END AS _matched_from

    FROM products
    WHERE
      production NOT ILIKE '%buytosell%'
      AND is_system_item = false
      AND (
        LOWER(REGEXP_REPLACE(COALESCE(model, ''), '[\\s,\\(\\)]', '', 'g')) % $1
        OR LOWER(REGEXP_REPLACE(COALESCE(name, ''), '[\\s,\\(\\)]', '', 'g')) % $1
      )
      AND GREATEST(
        similarity(
          LOWER(REGEXP_REPLACE(COALESCE(model, ''), '[\\s,\\(\\)]', '', 'g')), $1
        ),
        similarity(
          LOWER(REGEXP_REPLACE(COALESCE(name, ''), '[\\s,\\(\\)]', '', 'g')), $1
        )
      ) > 0.25

    ORDER BY _score DESC
    LIMIT 8
    `,
      [qNormForTrgm]
    );
  });

  const candidates = result.rows;

  // ── ไม่พบเลย ──────────────────────────────────────────────────────────
  if (candidates.length === 0) {
    return {
      found: false,
      candidates: [],
      report: `❌ ไม่พบสินค้ารหัสใกล้เคียงกับ "${codeTrimmed}" เลยครับ\n-------------------------\n`,
    };
  }

  // ── score สูงมาก (≥0.9) → เชื่อได้เลย (แต่ต้องผ่าน key-token guard) ──────
  if (candidates[0]._score >= 0.9) {
    const reason = keyTokenMismatchReason(codeTrimmed, candidates[0]);
    if (!reason) {
      console.log(`[findProduct] stage2 high-confidence: ${candidates[0].model} score=${candidates[0]._score}`);
      return { found: true, product: candidates[0], candidates: [], report: '' };
    }
    console.log(`[findProduct] stage2 rejected high-confidence ${candidates[0].model}: ${reason}`);
  }

  // ── score ปานกลาง/ต่ำ (≥0.20) → ให้ AI เลือก (แล้วตรวจ key-token guard) ───
  else if (candidates[0]._score >= 0.20) {
    console.log(`[findProduct] stage2 AI pick from ${candidates.length} candidates, top score=${candidates[0]._score}`);
    const best = await pickBestWithAI(codeTrimmed, candidates, undefined, chatContext);
    const reason = best ? keyTokenMismatchReason(codeTrimmed, best) : null;
    if (best && !reason) {
      return { found: true, product: best, candidates: [], report: '' };
    }
    if (best) {
      console.log(`[findProduct] stage2 rejected AI pick ${best.model}: ${reason}`);
    }
  }

  // ── score ต่ำทุกตัว → แสดง candidates ให้ user ระบุเพิ่ม ──────────────
  const shortlist = buildCandidateList(candidates);
  const report = candidateReport(`⚠️ รุ่นใกล้เคียง "${codeTrimmed}"`, shortlist);

  return { found: false, candidates: shortlist, report };
}

// ─────────────────────────────────────────────
//  AI Pick — ให้ DeepSeek เลือก best match
//  รับ numericHint (optional) เพื่อช่วย AI ให้ weight ตัวเลขสำคัญ
// ─────────────────────────────────────────────
async function pickBestWithAI(
  rawCode: string,
  candidates: (Product & { _score: number; _matched_from: string })[],
  numericHint?: string,
  chatContext?: string
): Promise<Product | null> {
  try {
    // สร้าง context เพิ่มเติมเกี่ยวกับ numeric/text parts
    const numericPart = numericHint || extractLongestNumber(rawCode);
    // ใช้ promptTextPart (ไม่ใช่ extractTextPart) เพื่อกันเศษตัวอักษรขยะไปทริกกติกาข้อ 1 ให้ AI ตอบ 0
    const textPart = promptTextPart(normalize(rawCode));
    const partsContext = numericPart
      ? `\n- ส่วนรหัสตัวเลขที่สำคัญ: "${numericPart}" — ให้ความสำคัญสูงสุดกับตัวเลือกที่มีเลขนี้ใน model หรือ name\n- ส่วนชื่อรุ่น: "${textPart || '-'}"\n`
      : '';

    // ข้อความเต็มจากแชท = หลักฐานชี้ขาด เพราะเซลส์มักพิมพ์รหัสแตกหลายบรรทัด
    // (เช่น "QH" อยู่บรรทัดบน, "50X800-..." บรรทัดล่าง) ถ้า AI เห็นแค่รหัสท่อนเดียวจะตัดสินไม่ได้
    // วัดจริง: ไม่มีบริบท ตอบถูก 0/15 — ใส่บริบท ตอบถูก 15/15
    const chatBlock = chatContext && chatContext.trim()
      ? `\nข้อความเต็มที่เซลส์พิมพ์มา (ใช้ประกอบการตัดสิน — เซลส์มักพิมพ์รหัสแตกหลายบรรทัด คำนำหน้า/ส่วนขยายรุ่นอาจอยู่คนละบรรทัดกัน):\n"""\n${chatContext.trim()}\n"""\n`
      : '';
    const chatRule = chatBlock
      ? `\n0. **หลักฐานแข็งแรงที่สุด (สำคัญกว่าทุกข้อ):** ถ้ารุ่นของตัวเลือกใดปรากฏอยู่ใน "ข้อความเต็มที่เซลส์พิมพ์มา" — แม้จะข้ามบรรทัด เว้นวรรคต่างกัน หรือพิมพ์เล็ก/ใหญ่ต่างกัน — ให้เลือกตัวนั้นทันที และห้ามให้กฎข้ออื่นมาทำให้ตอบ 0\n`
      : '';

    const response = await createChatCompletion({
      messages: [
        {
          role: 'user',
          content: `คุณคือผู้เชี่ยวชาญการตรวจจับรหัสสินค้า (Product Code Matcher)
งานของคุณคือจับคู่รหัสสินค้าที่ต้องการค้นหากับรายการในฐานข้อมูล

รหัสสินค้าที่ต้องการค้นหา: "${rawCode}"${partsContext}${chatBlock}
รายการในฐานข้อมูล:
${candidates
  .map(
    (c, i) =>
      `${i + 1}. model=${c.model || '-'} | name=${c.name || '-'}`
  )
  .join('\n')}

กติกาการเลือก (เรียงตามลำดับความสำคัญ):${chatRule}
1. **กฎเหล็ก — ส่วนตัวอักษร (text part):** ถ้า "ส่วนชื่อรุ่น" ระบุมา (ไม่ใช่ '-') ต้องเลือกเฉพาะตัวเลือกที่ model หรือ name มีอักษรส่วนนั้นปรากฏอยู่เท่านั้น เช่น ถ้า text part คือ "cmp" → ตัวเลือกที่ model/name ขึ้นต้นด้วย "cm" แต่ไม่มี "cmp" ถือว่าไม่ผ่าน — ตอบ 0 ทันที
2. **กฎเหล็ก — ส่วนรหัสผสมอักษร+ตัวเลข:** token ที่ผสมตัวอักษรกับตัวเลข (เช่น "94N", "94B2", "P1K") ถือเป็นตัวระบุรุ่นที่สำคัญมาก ต้องปรากฏตรงกันในตัวเลือกทุกตัว หากต่างกันแม้แต่ตัวเดียว (เช่น query มี "94N" แต่ตัวเลือกมี "94B2") ถือว่าไม่ผ่าน — ตอบ 0 ทันที ห้ามเดา
3. หากมีรหัสตัวเลขเฉพาะ (เช่น 304120, 444160) — ให้เลือกตัวเลือกที่ model หรือ name มีตัวเลขนั้นปรากฏอยู่ก่อนเป็นอันดับแรก ไม่ว่าตัวเลขจะอยู่หน้าหรือหลัง
4. หากตัวเลือกมีเลขตรงกันหลายตัว ให้ดูส่วนชื่อรุ่น (text part) ประกอบ เลือกที่ตรงกับชื่อรุ่นมากที่สุด
5. หากไม่มีตัวเลือกใดที่ผ่านทั้งกฎตัวอักษรและตัวเลขข้างต้น ให้ตอบ 0

ตอบเป็นตัวเลข 1-${candidates.length} ที่เลือก หรือ 0 เท่านั้น ห้ามเขียนคำอธิบายใดๆ`,
        },
      ],
    });

    const answer = (response.choices[0].message.content || '').trim();
    const idx = parseInt(answer, 10) - 1;

    if (idx >= 0 && idx < candidates.length) {
      console.log(`[pickBestWithAI] AI chose index ${idx + 1}: ${candidates[idx].model}`);
      return candidates[idx];
    }

    console.log(`[pickBestWithAI] AI returned 0 (no match) for "${rawCode}"`);
    return null;
  } catch (err) {
    console.error('[pickBestWithAI] error:', err);
    return null;
  }
}

// ─────────────────────────────────────────────
//  Legacy fallback (กรณี pg_trgm ไม่พร้อม)
// ─────────────────────────────────────────────
async function legacySearch(codeTrimmed: string, qNorm: string): Promise<FindProductResult> {
  const getTokens = (text = ''): string[] =>
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9\u0E00-\u0E7F\/]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

  const qTokens = getTokens(codeTrimmed);
  const filterTokens = qTokens.filter(token => token.length >= 2 || /\d/.test(token));

  if (filterTokens.length === 0) {
    return {
      found: false,
      candidates: [],
      report: `❌ ไม่พบสินค้ารหัสใกล้เคียงกับ "${codeTrimmed}" เลยครับ\n-------------------------\n`,
    };
  }

  const conditions: string[] = [];
  const values: any[] = [];

  filterTokens.forEach((token, index) => {
    const paramIndex = index + 1;
    conditions.push(`model ILIKE $${paramIndex} OR name ILIKE $${paramIndex}`);
    values.push(`%${token}%`);
  });

  const sql = `
    SELECT * 
    FROM products 
    WHERE (${conditions.join(' OR ')})
    LIMIT 200
  `;

  let dbProducts: Product[] = [];
  try {
    const { rows } = await pool.query<Product>(sql, values);
    dbProducts = rows;
  } catch (err) {
    console.error('[legacySearch] query error:', err);
    return {
      found: false,
      candidates: [],
      report: `❌ เกิดข้อผิดพลาดในการค้นหาข้อมูลสินค้า\n-------------------------\n`,
    };
  }

  if (!dbProducts || dbProducts.length === 0) {
    return {
      found: false,
      candidates: [],
      report: `❌ ไม่พบสินค้ารหัสใกล้เคียงกับ "${codeTrimmed}" เลยครับ\n-------------------------\n`,
    };
  }

  const rows = (dbProducts as Product[])
    .map((row) => ({
      ...row,
      _normModel: normalize(row.model || ''),
      _normName: normalize(row.name || ''),
    }))
    .filter(
      (r: any) =>
        !String(r.production || '')
          .toLowerCase()
          .replace(/\s+/g, '')
          .includes('buytosell') && r.model
    );

  // Exact match (normalize ตัด () แล้ว)
  const exactRows = rows.filter(
    (r: any) => r._normModel === qNorm || r._normName === qNorm
  );
  if (exactRows.length > 0) {
    exactRows.sort(
      (a: any, b: any) =>
        (Number(b.quantity_on_hand_unreserved) || 0) -
        (Number(a.quantity_on_hand_unreserved) || 0)
    );
    return { found: true, product: exactRows[0], candidates: [], report: '' };
  }

  // Contains match
  const containsRows = rows.filter(
    (r: any) =>
      r._normModel.includes(qNorm) ||
      qNorm.includes(r._normModel) ||
      r._normName.includes(qNorm) ||
      qNorm.includes(r._normName)
  );

  if (containsRows.length === 1) {
    return { found: true, product: containsRows[0], candidates: [], report: '' };
  }

  if (containsRows.length > 1) {
    containsRows.sort(
      (a: any, b: any) =>
        Math.abs(a._normModel.length - qNorm.length) -
        Math.abs(b._normModel.length - qNorm.length)
    );

    if (
      Math.abs(containsRows[0]._normModel.length - qNorm.length) <
      Math.abs(containsRows[1]._normModel.length - qNorm.length)
    ) {
      return { found: true, product: containsRows[0], candidates: [], report: '' };
    }

    const shortlist = buildCandidateList(containsRows);
    const report = candidateReport(`⚠️ รุ่นใกล้เคียง "${codeTrimmed}"`, shortlist);
    return { found: false, candidates: shortlist, report };
  }

  return {
    found: false,
    candidates: [],
    report: `❌ ไม่พบสินค้ารหัสใกล้เคียงกับ "${codeTrimmed}" เลยครับ\n-------------------------------------\n`,
  };
}

export interface StockViolation {
  type: 'OUT_OF_STOCK';
  model: string;
  name: string;
  quantity_on_hand_unreserved: number;  // ของว่างขายได้จริง (หักที่ถูกจองแล้ว) ณ ตอนตรวจ
  qty: number;                          // จำนวนที่สั่งมาในบรรทัดนั้น — คำอนุมัติผูกกับตัวเลขนี้
  warn_msg: string;
  is_optional?: boolean;          // true = หมดเพราะ optional แนบมา
  linked_to_model?: string;       // ชื่อ trigger product
}

/** สต็อกของสินค้าที่ติดกฎ — ใช้ตัดสินว่าของ "พอส่ง" ตามจำนวนที่สั่งหรือไม่ */
export interface RuleStock {
  model: string;
  name: string;
  available: number;              // quantity_on_hand_unreserved = ของว่างขายได้จริง (หักที่ถูกจองแล้ว)
}

/**
 * ตัดสินว่าบรรทัดนี้ต้องถูกระงับหรือไม่ — ตรรกะ pure ไม่แตะ DB (เทสได้ตรง ๆ)
 *
 * เดิมเช็คแบบ "มี/ไม่มี" (สต๊อก <= 0) ทำให้ของมี 1 ชิ้นแต่สั่ง 2 ชิ้นหลุดกฎ
 * ตอนนี้เทียบ "ของว่างขายได้จริง (unreserved)" กับ "จำนวนที่สั่ง" → ของไม่พอส่งเมื่อไหร่ก็บล็อก
 * (ยืนยันกับฝ่ายขายแล้วว่านิยาม "หมด" คือ unreserved ไม่พอกับจำนวนที่สั่ง)
 */
export function evaluateStockViolation(
  item: any,
  stock: RuleStock
): StockViolation | null {
  const requested = Number(item?.qty ?? item?.quantity ?? 1) || 1;
  const available = Number(stock.available) || 0;
  if (available >= requested) return null;

  return {
    type: 'OUT_OF_STOCK' as const,
    model: stock.model,
    name: stock.name,
    quantity_on_hand_unreserved: available,
    // เก็บ "จำนวนที่สั่ง" ไว้ด้วย เพราะคำอนุมัติของกฎข้อนี้ผูกกับตัวเลขนี้ (ขอมากกว่าที่อนุมัติ
    // = คำขอใหม่) — หลักเดียวกับที่ราคาขั้นต่ำผูกกับราคา (docs/plan-role-permissions.md §3.6)
    qty: requested,
    warn_msg: available <= 0
      ? 'สินค้าหมดสต็อก'
      : `ของว่างขายได้ ${available} ชิ้น ไม่พอกับจำนวนที่สั่ง ${requested} ชิ้น`,
  };
}

export async function checkStockRules(
  items: any[]
): Promise<StockViolation[]> {
  if (!items || items.length === 0) return [];
  const productIds = items
    .map(i => i.product_template_id ?? i.product_id)
    .filter(Boolean);
  if (productIds.length === 0) return [];

  // ดึงของว่างขายได้ของ "ทุกสินค้าที่ติดกฎ" (ไม่กรองจำนวนใน SQL) แล้วมาตัดสินฝั่ง JS
  // เทียบกับจำนวนที่สั่งของแต่ละบรรทัด — SQL กรอง <= 0 ไม่ได้เพราะไม่รู้ว่าสั่งกี่ชิ้น
  const { rows } = await pool.query(`
    SELECT
      p.product_template_id,
      p.model,
      p.name,
      p.quantity_on_hand_unreserved
    FROM product_stock_rules psr
    JOIN products p
      ON p.internal_reference = psr.internal_reference
    WHERE p.product_template_id = ANY($1)
      AND psr.is_active = true
  `, [productIds]);

  const stockByPid = new Map<number, RuleStock>(
    rows.map((r: any) => [r.product_template_id, {
      model: r.model,
      name: r.name,
      available: Number(r.quantity_on_hand_unreserved) || 0,
    }])
  );

  const violations: StockViolation[] = [];
  for (const item of items) {
    const pid = item.product_template_id ?? item.product_id;
    const stock = stockByPid.get(pid);
    if (!stock) continue;

    const violation = evaluateStockViolation(item, stock);
    if (!violation) continue;

    const linkedToProductId = item.linked_to_product_id;
    const linkedItem = linkedToProductId
      ? items.find(i => (i.product_template_id ?? i.product_id) === linkedToProductId)
      : undefined;

    violations.push({
      ...violation,
      is_optional: item.is_optional ?? false,
      linked_to_model: linkedItem ? linkedItem.model : undefined,
    });
  }

  return violations;
}

export async function getOptionalLinks(triggerInternalRef: string): Promise<any[]> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM product_optional_links WHERE trigger_product_id = $1 AND is_active = true`,
      [triggerInternalRef]
    );
    return rows || [];
  } catch (err) {
    console.error(`Error in getOptionalLinks for trigger product ref ${triggerInternalRef}:`, err);
    return [];
  }
}

export async function getProductByInternalRef(internalRef: string): Promise<any | null> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM products WHERE internal_reference = $1 LIMIT 1`,
      [internalRef]
    );
    return rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error(`Error in getProductByInternalRef for ${internalRef}:`, err);
    return null;
  }
}

export async function getProductById(productId: number): Promise<any | null> {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM products WHERE product_template_id = $1 LIMIT 1',
      [productId]
    );
    return rows[0] || null;
  } catch (err) {
    console.error(`Error in getProductById for ID ${productId}:`, err);
    return null;
  }
}

// resolve สินค้าเสริมของสินค้าหลัก 1 ตัว → คืน array ที่มีฟิลด์พอสร้าง line item ฝั่ง client
// (สัญญาฟิลด์ตายตัว — client ฝั่ง quote-edit/product-search พึ่งพา shape นี้ ห้ามเปลี่ยน)
export async function resolveOptionalProductsFor(product: any): Promise<any[]> {
  try {
    if (!product || !product.internal_reference) return [];

    const links = await getOptionalLinks(product.internal_reference);
    if (!links || links.length === 0) return [];

    const result: any[] = [];
    for (const link of links) {
      const optProduct = await getProductByInternalRef(link.optional_product_id);
      if (!optProduct) continue; // resolve ไม่ได้ → ข้าม

      result.push({
        product_id: optProduct.product_template_id,
        model: optProduct.model,
        name: optProduct.name,
        price: optProduct.sales_price,
        stock: optProduct.quantity_on_hand_unreserved ?? 0,
        internal_reference: optProduct.internal_reference,
        brand: optProduct.brand,
      });
    }
    return result;
  } catch (err) {
    console.error('Error in resolveOptionalProductsFor:', err);
    return [];
  }
}

export async function expandOptionalProducts(items: any[]): Promise<any[]> {
  if (!items || items.length === 0) return [];

  const result: any[] = [];

  for (const item of items) {
    result.push(item);

    const productId = item.product_id;
    if (!productId) continue;

    // Get trigger product to obtain its internal_reference
    const trigProduct = await getProductById(productId);
    if (!trigProduct || !trigProduct.internal_reference) continue;

    const links = await getOptionalLinks(trigProduct.internal_reference);
    if (!links || links.length === 0) continue;

    for (const link of links) {
      // Find optional product by its internal_reference stored in optional_product_id
      const optProduct = await getProductByInternalRef(link.optional_product_id);
      if (!optProduct) continue;

      // ตรวจสอบว่าสินค้าเสริมนี้ถูกสั่งไปแล้วในรายการหลักหรือไม่ เพื่อไม่ให้เพิ่มซ้ำซ้อน
      const isAlreadyOrdered = items.some(i => 
        (i.product_id && i.product_id === optProduct.product_template_id) ||
        (i.model && String(i.model).trim().toLowerCase() === String(optProduct.model).trim().toLowerCase()) ||
        (i.product_code && String(i.product_code).trim().toLowerCase() === String(optProduct.model).trim().toLowerCase())
      );
      if (isAlreadyOrdered) continue;

      const itemQty = item.qty ?? item.quantity ?? 1;

      result.push({
        product_id: optProduct.product_template_id,
        model: optProduct.model,
        name: optProduct.name,
        qty: itemQty,
        quantity: itemQty,
        price: optProduct.sales_price,
        is_optional: true,
        linked_to_product_id: productId,
        brand: optProduct.brand,
        series: optProduct.series,
        production: optProduct.production,
        discount_1: 0,
        discount_2: 0,
      });
    }
  }

  return result;
}