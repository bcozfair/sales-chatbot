// ─────────────────────────────────────────────────────────────────────────────
//  extractionTruthB — ร่าง "เฉลย" ของกลุ่ม B (ข้อความที่ระบบเคยตอบว่าไม่เข้าใจ)
//
//  ทำไมต้องมีไฟล์นี้: ตัวเลขของกลุ่ม B ที่รายงานไปก่อนหน้า (31/41) บอกได้แค่ว่า
//  "กลายเป็นใบ" ไม่ได้บอกว่า **ลูกค้าและรายการในใบนั้นถูกด้วย** — กลุ่ม A มีเฉลย
//  จากใบที่ยืนยันแล้ว แต่กลุ่ม B ไม่มี เพราะวันนั้นบอทไม่ได้ออกใบให้
//
//  ที่มาของเฉลย: เซลส์ที่ถูกปฏิเสธ **พิมพ์ใหม่แล้วออกใบได้ในไม่กี่นาทีถัดมา**
//  ⇒ ใบนั้นคือคำตอบของข้อความที่ถูกปฏิเสธ วัด 2026-09-23: 23 ใน 41 เคสมีใบตามมา
//  ภายใน 45 นาที และ 20 ใบในนั้นเป็นลูกค้า/รายการเดียวกับที่พิมพ์มา
//
//  เจ้าของเคาะเฉลยที่เหลือครบแล้ว 2026-09-23 — กติกาที่ได้มาและใช้กับทั้งชุด:
//   · ไม่ระบุจำนวน = ออกใบ ใส่จำนวนตั้งต้น 1 (ไม่ใช่ถามกลับ)
//     แต่ "ไม่มีสินค้าเลยสักรายการ" คนละเรื่อง ⇒ ถามกลับ (b-4924)
//   · คำบรรยายที่สกัดรุ่นใกล้เคียงได้ = ให้เสนอรุ่นให้กดเลือก · สกัดไม่ได้จึงถามกลับ
//   · ค่าบริการที่ไม่มีในแค็ตตาล็อก = ทำไม่ได้โดยตั้งใจ ให้ตอบว่าติดต่อแอดมิน
//   · ถามราคาโดยไม่มีลูกค้า = ไม่ออกใบคือถูกแล้ว
//   · เศษข้อความต่อจากของเดิม: **ใบก่อนหน้ายังไม่ยืนยัน → ต่อจากใบเดิม · ยืนยันไปแล้ว → ถามกลับ**
//   · "แก้ใบเดิม" เป็นเจตนาใหม่ที่ต้องแยกออกมา (ระบบยังไม่มี — ดู requires_code_change)
//
//  กติกาที่ทำให้ไฟล์นี้เชื่อได้:
//   1. **ตารางคำตัดสินอยู่ในซอร์ส ไม่ใช่ในไฟล์ผลลัพธ์** — `DECISIONS` เก็บแค่
//      "เคสนี้เฉลยคือใบเลขนี้" ซึ่งไม่มีข้อมูลลูกค้าติดมา จึง commit ได้ ส่วนตัวเฉลยจริง
//      (ชื่อ/รหัส/ผู้ติดต่อ/รายการ) ดึงสดจาก DB ตอนรัน และตกที่ไฟล์ที่ .gitignore กันไว้
//   2. **ไม่ตัดสินให้เอง** — ทุกแถวออกมาเป็น `needs_review: true` เสมอ เจ้าของเคาะแล้ว
//      ค่อยเปลี่ยนเป็น `confirmed` ในตารางข้อ 1 ไม่ใช่ไปแก้ไฟล์ผลลัพธ์ (ซึ่งถูกสร้างใหม่ทุกครั้ง)
//   3. **ติดป้ายว่าเฉลยแต่ละข้อ "ตรงกับข้อความแค่ไหน"** (`customer_in_message` /
//      `truth_alignment`) เพราะเฉลยที่ไม่มีในข้อความไม่ใช่ความผิดของชั้นสกัด —
//      กติกาเดียวกับที่ extractionEval.ts ใช้กับกลุ่ม A อยู่แล้ว
//
//  ผลข้างเคียง: SELECT อย่างเดียว · ไม่ยิง LLM · ไม่แตะ corpus
//
//  รัน (ต้องอยู่ในคอนเทนเนอร์ที่ต่อ DB ได้):
//    tsx scripts/diag/extractionTruthB.ts            เขียน data/eval/extraction_truth_b.json
//    tsx scripts/diag/extractionTruthB.ts --print    พิมพ์ตารางให้คนตรวจ ไม่เขียนไฟล์
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { pool } from '../../config/db.js';

const ARGV = process.argv.slice(2);
const PRINT_ONLY = ARGV.includes('--print');
const DIR = 'data/eval';
const CORPUS = `${DIR}/extraction_corpus.json`;
const OUT = `${DIR}/extraction_truth_b.json`;

const GREEN = '\x1b[32m', YEL = '\x1b[33m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';

/**
 * คำตัดสินต่อเคส — คีย์คือ id ใน corpus (= `b-<messages.id>`)
 *
 * เก็บเฉพาะ "คำตัดสิน" ไม่เก็บข้อมูลลูกค้า ⇒ ไฟล์นี้ commit ได้โดยไม่มี PII
 * ยกเว้น `manual` ที่จำเป็นต้องมี เพราะเป็นเคสที่ไม่มีใบให้สืบและเจ้าของเคาะจากข้อความเอง
 * (ข้อมูลในนั้นคือสิ่งที่เซลส์พิมพ์ลงแชทเอง ซึ่งอยู่ใน corpus อยู่แล้ว)
 *
 * review: 'pending' = ยังไม่มีใครตรวจ · 'confirmed-YYYY-MM-DD' = เจ้าของเคาะแล้ว
 *         เปลี่ยนค่านี้ที่นี่เท่านั้น ห้ามไปแก้ไฟล์ผลลัพธ์ (ถูกสร้างใหม่ทุกครั้ง)
 */
type Review = 'pending' | `confirmed-${string}`;
interface ManualItem { model: string; quantity: number; discount_1: number }
interface ManualTruth {
  customer_name: string | null; customer_code: string | null; contact_name: string | null;
  items: ManualItem[];
}

type Decision =
  /** เฉลย = ใบที่เซลส์ออกตามมาเองหลังถูกปฏิเสธ (ดึงสดจาก DB) */
  | { verdict: 'QUOTATION'; from: string; review: Review }
  /** เฉลยที่เจ้าของเคาะจากข้อความ เพราะไม่มีใบให้สืบ */
  | { verdict: 'QUOTATION'; manual: ManualTruth; why: string; review: Review }
  /** ควรออกใบ แต่รุ่นต้องให้เลือกก่อน — ชั้นสกัดต้องตอบ QUOTATION แล้วส่งคำบรรยายไปจับคู่ */
  | { verdict: 'SUGGEST'; manual: ManualTruth; candidates: string[]; why: string; review: Review }
  /** แก้ใบเดิม — เจตนาที่ระบบยังไม่มี (intent มีแค่ QUOTATION/REGISTER/PRODUCT_INFO/UNCLEAR) */
  | { verdict: 'REVISE'; quotation_no: string; change: string; review: Review }
  /** ไม่ออกใบคือถูกแล้ว — ถามกลับ */
  | { verdict: 'ASK_BACK'; why: string; review: Review }
  /** ทำไม่ได้โดยตั้งใจ — ต้องตอบว่าให้ติดต่อแอดมิน ไม่ใช่ตอบฟอร์ม */
  | { verdict: 'REFUSE'; why: string; review: Review }
  /** ถามราคา ไม่ใช่ขอใบ — ไม่ออกใบคือถูกแล้ว */
  | { verdict: 'PRODUCT_INFO'; why: string; review: Review };

const OWNER: Review = 'confirmed-2026-09-23';

const DECISIONS: Record<string, Decision> = {
  // ── เฉลยจากใบที่เซลส์ออกตามมา (21) ──────────────────────────────────────
  'b-6438': { verdict: 'QUOTATION', from: 'QT-260905214', review: OWNER },
  // ⚠️ ขึ้น confidence='low' โดยชอบ — ข้อความคือ "ส่วนลด 20%" ล้วน ลูกค้ากับรุ่นอยู่ในประวัติ
  //    (ก่อนหน้า 20 วิ: เดอะจูซ / Si12 ที่ยังค้างเลือกรุ่นอยู่ ยังไม่ยืนยัน) ⇒ ตามกฎ "ต่อจากใบเดิม"
  'b-6166': { verdict: 'QUOTATION', from: 'QT-260905181', review: OWNER },
  'b-5556': { verdict: 'QUOTATION', from: 'QT-260905120', review: OWNER },
  'b-5329': { verdict: 'QUOTATION', from: 'QP-260905253', review: OWNER },
  'b-5314': { verdict: 'QUOTATION', from: 'QP-260905248', review: OWNER },
  'b-5147': { verdict: 'QUOTATION', from: 'QP-260905204', review: OWNER },
  'b-5115': { verdict: 'QUOTATION', from: 'QP-260905195', review: OWNER },
  'b-4743': { verdict: 'QUOTATION', from: 'QP-260905101', review: OWNER },
  'b-4621': { verdict: 'QUOTATION', from: 'QP-260905067', review: OWNER },
  'b-4315': { verdict: 'QUOTATION', from: 'QT-260805301', review: OWNER },
  'b-4301': { verdict: 'QUOTATION', from: 'QT-260805299', review: OWNER },
  'b-4270': { verdict: 'QUOTATION', from: 'QP-260805801', review: OWNER },
  'b-3623': { verdict: 'QUOTATION', from: 'QP-260805640', review: OWNER },
  'b-3583': { verdict: 'QUOTATION', from: 'QT-260805225', review: OWNER },
  'b-3582': { verdict: 'QUOTATION', from: 'QT-260805225', review: OWNER },
  'b-3398': { verdict: 'QUOTATION', from: 'QP-260805589', review: OWNER },
  'b-3115': { verdict: 'QUOTATION', from: 'QT-260805177', review: OWNER },
  'b-2459': { verdict: 'QUOTATION', from: 'QP-260805340', review: OWNER },
  'b-1438': { verdict: 'QUOTATION', from: 'QP-260805102', review: OWNER },
  'b-1295': { verdict: 'QUOTATION', from: 'QT-260805021', review: OWNER },
  'b-1139': { verdict: 'QUOTATION', from: 'QP-260805024', review: OWNER },

  // ── เฉลยที่เจ้าของเคาะจากข้อความ (2) ────────────────────────────────────
  'b-1327': {
    verdict: 'QUOTATION', review: OWNER,
    why: 'ครบทุกช่องอยู่แล้ว เจ้าของยืนยันว่าเคสนี้ต้องออกใบได้ — ไม่มีใบตามมาให้สืบ',
    manual: {
      customer_name: 'บริษัท เอเซียมอเตอร์ เซอร์วิส เซ็นเตอร์ จำกัด',
      customer_code: 'A004064', contact_name: 'คุณหมู',
      items: [{ model: 'PMV12.00220', quantity: 5, discount_1: 20 }],
    },
  },
  'b-4742': {
    verdict: 'QUOTATION', review: OWNER,
    why: 'ไม่ระบุจำนวน ⇒ เจ้าของสั่งให้ใส่จำนวนตั้งต้น 1 ไม่ใช่ถามกลับ',
    manual: {
      customer_name: 'บ.กรีน โปรเกรส', customer_code: null, contact_name: 'คุณสุเมธ',
      items: [{ model: 'PF-03', quantity: 1, discount_1: 0 }],
    },
  },

  // ── คำบรรยายที่สกัดรุ่นใกล้เคียงได้ ⇒ ต้องเสนอรุ่นให้กดเลือก (4) ────────
  // ยืนยันจากแค็ตตาล็อกจริง 2026-09-23 ว่ามีรุ่นให้เสนอ — ไม่ได้เดา
  // และเซลส์คนเดียวกันเคยพิมพ์ `Pressure 4 Bar "Trafag" 8287.56.25…` แล้วได้ร่างใบจริงมาแล้ว
  'b-3909': {
    verdict: 'SUGGEST', review: OWNER,
    candidates: ['EPI 0..2.5A ; PU12.5(2515)'],
    why: 'รหัสที่พิมพ์ตรงกับชื่อสินค้า Pressure 2.5 Bar "Trafag" 8287.55.2515.05...19.58.61.L9 ตัวเดียว',
    manual: {
      customer_name: 'บ.ซิตี้ฟาร์ม', customer_code: 'A/33714', contact_name: 'คุณธนกร',
      items: [{ model: '8287.55.2515.05…19.58.61.L9', quantity: 1, discount_1: 25 }],
    },
  },
  'b-3908': {
    verdict: 'SUGGEST', review: OWNER,
    candidates: ['EPI 0..2.5A ; PU12.5(2515)'],
    why: 'เหมือน b-3909 ทุกอย่าง ต่างแค่ไม่มีคำว่า "เสนอราคา" ในข้อความ',
    manual: {
      customer_name: 'บ.ซิตี้ฟาร์ม', customer_code: 'A/33714', contact_name: 'คุณธนกร',
      items: [{ model: '8287.55.2515.05…19.58.61.L9', quantity: 1, discount_1: 25 }],
    },
  },
  'b-3910': {
    verdict: 'SUGGEST', review: OWNER,
    candidates: ['EPI 0..2.5A ; PU12.5(2515)', 'EPI 0..2.5V / Out: 0-10V(2515)',
      'EPI 0..2.5A ; PU12.5', 'EPI 0..2.5V / Out: 0-10V',
      '8236.75.2393.05.0000.0000.19.58.61', '8235.75.23.91.05.0000.0000.19.58.61'],
    why: '"Pressure 2.5 Bar" ตรงกับสินค้า 6 รายการในแค็ตตาล็อก ⇒ เสนอให้เลือก ไม่ใช่ถามกลับเปล่า ๆ',
    manual: {
      customer_name: 'บ.ซิตี้ฟาร์ม', customer_code: 'A/33714', contact_name: 'คุณธนกร',
      items: [{ model: 'Pressure 2.5 Bar', quantity: 1, discount_1: 25 }],
    },
  },
  'b-3294': {
    verdict: 'SUGGEST', review: OWNER,
    candidates: ['FINGER GUARD 4" FG-12', 'FINGER GUARD 6" S-0172-7 T', 'FINGER GUARD 8" B10-220 mm.',
      'FINGER GUARD 10"', 'FINGER GUARD 10" B9-254 mm.', 'Guard ตะแกรง Level Switch'],
    why: '"ตะแกรง" ตรงกับสินค้า 6 รายการ (ตะแกรงพัดลม 5 + Guard ตะแกรง Level Switch)',
    manual: {
      customer_name: 'บ.ทีพีดี เอ็นจิเนียริ่ง', customer_code: 'A005152(2)', contact_name: 'คุณไพฑูร',
      items: [{ model: 'ตะแกรง', quantity: 1, discount_1: 30 }],
    },
  },

  // ── แก้ใบเดิม — เจตนาใหม่ที่ระบบยังไม่มี (3) ────────────────────────────
  'b-646': { verdict: 'REVISE', quotation_no: 'QP-260705030', change: 'เพิ่มจำนวนเป็น 2 ตัว', review: OWNER },
  'b-644': { verdict: 'REVISE', quotation_no: 'QP-260705030', change: 'แก้จำนวนสินค้าเป็น 2 ตัว', review: OWNER },
  'b-639': { verdict: 'REVISE', quotation_no: 'QP-260705030', change: 'แก้จำนวนสินค้าเป็น 2 ตัว', review: OWNER },

  // ── ค่าบริการที่ไม่มีในแค็ตตาล็อก — ทำไม่ได้โดยตั้งใจ (2) ───────────────
  'b-2319': { verdict: 'REFUSE', review: OWNER, why: '"ค่าเขียนโปรแกรม plc = 5000 บาท" ไม่ใช่สินค้าในแค็ตตาล็อก ⇒ ต้องตอบว่าติดต่อแอดมิน' },
  'b-2318': { verdict: 'REFUSE', review: OWNER, why: 'เหมือน b-2319 ต่างแค่ตำแหน่งขึ้นบรรทัดใหม่ของราคา' },

  // ── ถามราคา ไม่มีลูกค้า — ไม่ออกใบคือถูกแล้ว (2) ───────────────────────
  'b-3489': { verdict: 'PRODUCT_INFO', review: OWNER, why: 'เช็คราคา 2 รุ่น ไม่มีลูกค้า' },
  'b-4047': { verdict: 'PRODUCT_INFO', review: OWNER, why: 'เช็คราคา 1 รุ่น ไม่มีลูกค้า' },

  // ── เศษข้อความที่ใบก่อนหน้า "ยืนยันไปแล้ว" หรือไม่มีใบค้าง ⇒ ถามกลับ (7) ─
  // ไล่ประวัติทีละเคส 2026-09-23 — มีแค่ b-6166 ที่ใบก่อนหน้ายังค้าง จึงไปอยู่กองบน
  'b-521': { verdict: 'ASK_BACK', review: OWNER, why: 'ก่อนหน้า 49 วิ ยืนยันออก QP-260705011 ไปแล้ว ⇒ ไม่มีใบให้ต่อ' },
  'b-1052': { verdict: 'ASK_BACK', review: OWNER, why: 'ประวัติล่าสุดห่าง 3 วัน และยืนยันไปแล้ว ⇒ ไม่มีใบให้ต่อ' },
  'b-880': { verdict: 'ASK_BACK', review: OWNER, why: 'ก่อนหน้า 5 วิ เซลส์กด "ยกเลิก" ⇒ ร่างเดิมถูกทิ้งไปแล้ว ไม่มีอะไรให้ต่อ' },
  'b-2801': { verdict: 'ASK_BACK', review: OWNER, why: 'ในช่วงที่ยังไม่ยืนยันมีแต่ "ออกใบเสนอราคา" ที่ยังไม่มีสินค้าเลย ⇒ ต้องขอรายการสินค้า' },
  'b-804': { verdict: 'ASK_BACK', review: OWNER, why: 'เหมือน b-2801 — มีแต่คำว่า "เสนอราคา" ค้างอยู่ ไม่มีรายการสินค้า' },
  'b-352': { verdict: 'ASK_BACK', review: OWNER, why: 'ไม่มีประวัติเลยสักแถว และข้อความไม่มีลูกค้า ⇒ ไม่มีใบให้ต่อ' },
  'b-4924': { verdict: 'ASK_BACK', review: OWNER, why: 'ไม่มีรายการสินค้าเลย (ต่างจาก b-4742 ที่ขาดแค่จำนวน) และประวัติล่าสุดห่าง 2 วัน' },
};

interface ItemTruth { model: string; quantity: number; price: number | null; discount_1: number; discount_2: number }

/** normalize เดียวกับ extractionEval.ts — พับสระ "เเ" แล้วตัดช่องว่าง/ขีด/จุด/วงเล็บ */
function norm(s: any): string {
  return String(s ?? '').replace(/เเ/g, 'แ').replace(/[\s\-_.()"']/g, '').toLowerCase();
}

/** ลูกค้าในเฉลย "ปรากฏในข้อความที่เซลส์พิมพ์" หรือไม่ — เกณฑ์เดียวกับ customerMatches() */
function customerInMessage(msg: string, t: { customer_name: string | null; customer_code: string | null; contact_name: string | null }): boolean {
  const m = norm(msg);
  const code = norm(t.customer_code);
  if (code && m.includes(code)) return true;
  const name = norm(t.customer_name);
  const core = name.replace(/^(บริษัท|บ|หจก|บจก|ห้างหุ้นส่วนจำกัด)/, '').slice(0, 6);
  if (core.length >= 4 && m.includes(core)) return true;
  const contact = norm(t.contact_name).replace(/^คุณ/, '');
  if (contact.length >= 3 && m.includes(contact)) return true;
  return false;
}

/**
 * เฉลยของเคสที่ "ไม่ออกใบคือถูก" — ตัววัดต้องยอมรับ intent อะไรก็ได้ที่ไม่ใช่ QUOTATION
 * ไม่ใช่บังคับตัวอักษรเดียว เพราะเจ้าของเคาะแค่ว่า "ไม่ออกใบ" ไม่ได้เคาะชื่อ intent
 */
type Accept = 'EXACT' | 'NOT_QUOTATION';

/** เติมช่องที่เฉลยแบบเคาะมือไม่มี ให้รูปร่างเท่ากับเฉลยที่มาจากใบจริง */
function withItemDefaults(it: ManualItem): ItemTruth {
  return { model: it.model, quantity: it.quantity, price: null, discount_1: it.discount_1, discount_2: 0 };
}

async function main() {
  await pool.query("SET statement_timeout = '30s'");
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
  const bEntries = corpus.entries.filter((e: any) => e.group === 'B-missed');

  const missing = bEntries.filter((e: any) => !DECISIONS[e.id]).map((e: any) => e.id);
  if (missing.length) {
    throw new Error(`corpus มีเคสกลุ่ม B ที่ยังไม่มีคำตัดสินใน DECISIONS: ${missing.join(', ')}`);
  }
  const extra = Object.keys(DECISIONS).filter(id => !bEntries.some((e: any) => e.id === id));
  if (extra.length) {
    throw new Error(`DECISIONS มีเคสที่ไม่อยู่ใน corpus แล้ว (corpus เปลี่ยนชุด?): ${extra.join(', ')}`);
  }

  const out: any[] = [];
  for (const e of bEntries) {
    const d = DECISIONS[e.id];
    const common = {
      id: e.id, verdict: d.verdict,
      needs_review: d.review === 'pending',
      reviewed: d.review === 'pending' ? null : d.review,
      message: e.message, observed_reply_head: e.observed_reply_head,
    };

    // ── ไม่ออกใบคือถูกแล้ว ────────────────────────────────────────────────
    if (d.verdict === 'ASK_BACK' || d.verdict === 'REFUSE' || d.verdict === 'PRODUCT_INFO') {
      out.push({
        ...common,
        truth: { intent: null },
        accept: 'NOT_QUOTATION' as Accept,
        why: d.why,
        // REFUSE ต้องตอบ "ติดต่อแอดมิน" ซึ่งตอนนี้ระบบตอบฟอร์ม ⇒ ยังต้องแก้โค้ด
        requires_code_change: d.verdict === 'REFUSE',
      });
      continue;
    }

    // ── แก้ใบเดิม — intent ที่ยังไม่มีในระบบ ──────────────────────────────
    if (d.verdict === 'REVISE') {
      out.push({
        ...common,
        truth: { intent: 'REVISE_QUOTATION', quotation_no: d.quotation_no, change: d.change },
        accept: 'EXACT' as Accept,
        requires_code_change: true,
        why: 'intent ของชั้นสกัดมีแค่ QUOTATION/REGISTER/PRODUCT_INFO/UNCLEAR ⇒ เคสนี้ยังตอบถูกไม่ได้จนกว่าจะเพิ่มเจตนานี้',
      });
      continue;
    }

    // ── ควรออกใบ แต่รุ่นต้องให้เลือกก่อน ──────────────────────────────────
    if (d.verdict === 'SUGGEST') {
      out.push({
        ...common,
        truth: { intent: 'QUOTATION', ...d.manual, items: d.manual.items.map(withItemDefaults) },
        truth_source: 'owner-decision',
        accept: 'EXACT' as Accept,
        expect_model_choice: d.candidates,
        why: d.why,
        // ชั้นสกัดตอบ QUOTATION ได้อยู่แล้ว ส่วน "เสนอรุ่นให้กด" เป็นงานของชั้นจับคู่สินค้า
        requires_code_change: false,
      });
      continue;
    }

    // ── QUOTATION: เฉลยจากใบจริง หรือจากที่เจ้าของเคาะ ────────────────────
    let truth: any;
    let source: string;
    let secondsAfter: number | null = null;
    if ('manual' in d) {
      truth = { intent: 'QUOTATION', ...d.manual, items: d.manual.items.map(withItemDefaults) };
      source = 'owner-decision';
    } else {
      const { rows } = await pool.query(
        `SELECT quotation_no, customer_details, item_details, created_at
           FROM quotations WHERE quotation_no = $1 AND status = 'confirmed' LIMIT 1`, [d.from]);
      if (!rows.length) throw new Error(`${e.id}: หาใบ ${d.from} ไม่เจอ (หรือไม่ได้ยืนยัน)`);
      const r = rows[0];
      const cd = r.customer_details || {};
      truth = {
        intent: 'QUOTATION',
        customer_name: cd.customer_name ?? null,
        customer_code: cd.customer_code ?? null,
        contact_name: cd.contact_name ?? null,
        items: (r.item_details || [])
          .filter((it: any) => !it.is_optional)
          .map((it: any) => ({
            model: String(it.model ?? ''),
            quantity: Number(it.quantity) || 0,
            price: it.price === null || it.price === undefined ? null : Number(it.price),
            discount_1: Number(it.discount_1) || 0,
            discount_2: Number(it.discount_2) || 0,
          })),
      };
      source = `quotation:${d.from}`;
      secondsAfter = Math.round((new Date(r.created_at).getTime() - new Date(e.created_at).getTime()) / 1000);
    }

    const msgNorm = norm(e.message);
    const items: ItemTruth[] = truth.items;
    const aligned = items.filter(it => it.model && msgNorm.includes(norm(it.model).slice(0, 6)));
    const alignment = items.length ? aligned.length / items.length : 0;
    const custOk = customerInMessage(e.message, truth);
    out.push({
      ...common,
      truth, truth_source: source, seconds_after: secondsAfter,
      truth_alignment: alignment, customer_in_message: custOk,
      accept: 'EXACT' as Accept,
      // high = ทั้งลูกค้าและรุ่นสืบกลับได้จากข้อความ · medium = ได้ด้านเดียว · low = ไม่ได้เลย
      confidence: custOk && alignment > 0 ? 'high' : (custOk || alignment > 0 ? 'medium' : 'low'),
      why: 'why' in d ? d.why : undefined,
      requires_code_change: false,
    });
  }

  const by = (v: string) => out.filter(o => o.verdict === v).length;
  const payload = {
    generated_at: new Date().toISOString(),
    corpus_generated_at: corpus.generated_at,
    counts: {
      total: out.length,
      quotation: by('QUOTATION'), suggest: by('SUGGEST'), revise: by('REVISE'),
      ask_back: by('ASK_BACK'), refuse: by('REFUSE'), product_info: by('PRODUCT_INFO'),
      needs_review: out.filter(o => o.needs_review).length,
      requires_code_change: out.filter(o => o.requires_code_change).length,
    },
    entries: out,
  };

  const LABEL: Record<string, string> = {
    QUOTATION: 'ออกใบ', SUGGEST: 'ออกใบ+ให้เลือกรุ่น', REVISE: 'แก้ใบเดิม',
    ASK_BACK: 'ถามกลับ', REFUSE: 'ติดต่อแอดมิน', PRODUCT_INFO: 'ถามราคา',
  };
  for (const o of out) {
    const flag = o.needs_review ? `${YEL}?${RESET}` : (o.requires_code_change ? `${YEL}!${RESET}` : `${GREEN}✓${RESET}`);
    const conf = o.confidence ? ` ${DIM}[${o.confidence}]${RESET}` : '';
    console.log(`${flag} ${BOLD}${o.id.padEnd(7)}${RESET} ${LABEL[o.verdict].padEnd(20)}${conf} ${DIM}${o.message.replace(/\n/g, ' ⏎ ').slice(0, 58)}${RESET}`);
  }
  const c = payload.counts;
  console.log(`\n${BOLD}เฉลยครบ ${c.total} เคส${RESET} — ออกใบ ${c.quotation} · ออกใบ+ให้เลือกรุ่น ${c.suggest} · ` +
    `แก้ใบเดิม ${c.revise} · ถามกลับ ${c.ask_back} · ติดต่อแอดมิน ${c.refuse} · ถามราคา ${c.product_info}`);
  console.log(`${BOLD}ยังรอเคาะ ${c.needs_review}${RESET} · ${BOLD}ต้องแก้โค้ดก่อนถึงจะตอบถูกได้ ${c.requires_code_change}${RESET}`);

  if (!PRINT_ONLY) {
    writeFileSync(OUT, JSON.stringify(payload, null, 2));
    console.log(`${DIM}เขียน ${OUT}${RESET}`);
  }
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
