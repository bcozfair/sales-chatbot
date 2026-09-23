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
 *  from  = เลขใบที่เซลส์ออกตามมาหลังถูกปฏิเสธ ⇒ ใช้เป็นเฉลย
 *  why   = เหตุผลที่ยังตัดสินไม่ได้ (รอเจ้าของ)
 *  review: 'pending' = ยังไม่มีใครตรวจ · 'confirmed' = เจ้าของตรวจแล้วว่าใช่
 *          เปลี่ยนค่านี้ที่นี่เท่านั้น ห้ามไปแก้ไฟล์ผลลัพธ์
 */
type Decision =
  | { verdict: 'QUOTATION'; from: string; review: 'pending' | 'confirmed' }
  | { verdict: 'PENDING'; why: string };

const DECISIONS: Record<string, Decision> = {
  // ── เฉลยจากใบที่เซลส์ออกตามมา (20) ──────────────────────────────────────
  'b-6438': { verdict: 'QUOTATION', from: 'QT-260905214', review: 'pending' },
  'b-5556': { verdict: 'QUOTATION', from: 'QT-260905120', review: 'pending' },
  'b-5329': { verdict: 'QUOTATION', from: 'QP-260905253', review: 'pending' },
  'b-5314': { verdict: 'QUOTATION', from: 'QP-260905248', review: 'pending' },
  'b-5147': { verdict: 'QUOTATION', from: 'QP-260905204', review: 'pending' },
  'b-5115': { verdict: 'QUOTATION', from: 'QP-260905195', review: 'pending' },
  'b-4743': { verdict: 'QUOTATION', from: 'QP-260905101', review: 'pending' },
  'b-4621': { verdict: 'QUOTATION', from: 'QP-260905067', review: 'pending' },
  'b-4315': { verdict: 'QUOTATION', from: 'QT-260805301', review: 'pending' },
  'b-4301': { verdict: 'QUOTATION', from: 'QT-260805299', review: 'pending' },
  'b-4270': { verdict: 'QUOTATION', from: 'QP-260805801', review: 'pending' },
  'b-3623': { verdict: 'QUOTATION', from: 'QP-260805640', review: 'pending' },
  'b-3583': { verdict: 'QUOTATION', from: 'QT-260805225', review: 'pending' },
  'b-3582': { verdict: 'QUOTATION', from: 'QT-260805225', review: 'pending' },
  'b-3398': { verdict: 'QUOTATION', from: 'QP-260805589', review: 'pending' },
  'b-3115': { verdict: 'QUOTATION', from: 'QT-260805177', review: 'pending' },
  'b-2459': { verdict: 'QUOTATION', from: 'QP-260805340', review: 'pending' },
  'b-1438': { verdict: 'QUOTATION', from: 'QP-260805102', review: 'pending' },
  'b-1295': { verdict: 'QUOTATION', from: 'QT-260805021', review: 'pending' },
  'b-1139': { verdict: 'QUOTATION', from: 'QP-260805024', review: 'pending' },

  // ── รอเจ้าของเคาะ (21) ──────────────────────────────────────────────────
  'b-646': { verdict: 'PENDING', why: 'แก้ใบเดิม QP-260705030 — สเปคยังไม่มี intent สำหรับ "แก้ใบ"' },
  'b-644': { verdict: 'PENDING', why: 'แก้ใบเดิม QP-260705030 — สเปคยังไม่มี intent สำหรับ "แก้ใบ"' },
  'b-639': { verdict: 'PENDING', why: 'แก้ใบเดิม QP-260705030 — สเปคยังไม่มี intent สำหรับ "แก้ใบ"' },
  'b-1327': { verdict: 'PENDING', why: 'ครบทุกช่อง (เสนอราคา + A004064 + PMV12.00220 จำนวน 5 EA + ลด 20%) แต่ตอบฟอร์ม และไม่มีใบตามมา' },
  'b-4924': { verdict: 'PENDING', why: 'มีคำสั่ง + ชื่อบริษัท แต่ไม่มีรายการสินค้าเลย' },
  'b-4742': { verdict: 'PENDING', why: 'พิมพ์ "เสนราคา" + ลูกค้า + Pf-03 แต่ไม่มีจำนวน และไม่มีใบตามมา' },
  'b-3910': { verdict: 'PENDING', why: 'รายการเป็นคำบรรยาย "Pressure 2.5 Bar" ไม่ใช่รหัสรุ่น' },
  'b-3294': { verdict: 'PENDING', why: 'รายการเป็นคำว่า "ตะแกรง" ไม่ใช่รหัสรุ่น' },
  'b-3909': { verdict: 'PENDING', why: 'รายการเป็นรหัสแปลก 8287.55.2515.05…19.58.61.L9' },
  'b-3908': { verdict: 'PENDING', why: 'เหมือน b-3909 แต่ไม่มีคำว่า "เสนอราคา" ด้วย' },
  'b-2319': { verdict: 'PENDING', why: 'ค่าบริการ "ค่าเขียนโปรแกรม plc = 5000 บาท" ไม่ใช่สินค้าในแค็ตตาล็อก' },
  'b-2318': { verdict: 'PENDING', why: 'ค่าบริการ "ค่าเขียนโปรแกรม plc = 5000 บาท" ไม่ใช่สินค้าในแค็ตตาล็อก' },
  'b-3489': { verdict: 'PENDING', why: 'เช็คราคา 2 รุ่น ไม่มีลูกค้า — ต้องตัดสินว่านับเป็นพลาดหรือไม่' },
  'b-4047': { verdict: 'PENDING', why: 'เช็คราคา 1 รุ่น ไม่มีลูกค้า — ใบที่ตามมาเป็นคนละรุ่น' },
  'b-2801': { verdict: 'PENDING', why: 'มีแต่ชื่อบริษัท ต้องอาศัยประวัติ' },
  'b-804': { verdict: 'PENDING', why: 'มีแต่ชื่อบริษัท ต้องอาศัยประวัติ' },
  'b-880': { verdict: 'PENDING', why: 'มีแต่ชื่อคน + ชื่อบริษัทย่อ ต้องอาศัยประวัติ' },
  'b-521': { verdict: 'PENDING', why: '"ใส่ส่วนลด 30%" — เศษข้อความ ต้องอาศัยประวัติ' },
  'b-352': { verdict: 'PENDING', why: '"Vpm-05-p3-4 =1" — ไม่มีลูกค้า ต้องอาศัยประวัติ' },
  'b-6166': { verdict: 'PENDING', why: '"ส่วนลด 20%" — เศษข้อความ และใบที่ตามมาเป็นคนละบริษัท' },
  'b-1052': { verdict: 'PENDING', why: 'ใบที่ตามมาเป็นคนละบริษัทกับที่พิมพ์ ("เบียร์ทิพย์")' },
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

async function main() {
  await pool.query("SET statement_timeout = '30s'");
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
  const bEntries = corpus.entries.filter((e: any) => e.group === 'B-missed');

  const missing = bEntries.filter((e: any) => !DECISIONS[e.id]).map((e: any) => e.id);
  if (missing.length) {
    throw new Error(`corpus มีเคสกลุ่ม B ที่ยังไม่มีคำตัดสินใน DECISIONS: ${missing.join(', ')}`);
  }

  const out: any[] = [];
  for (const e of bEntries) {
    const d = DECISIONS[e.id];
    if (d.verdict === 'PENDING') {
      out.push({ id: e.id, verdict: 'PENDING', why: d.why, message: e.message, observed_reply_head: e.observed_reply_head });
      continue;
    }
    const { rows } = await pool.query(
      `SELECT quotation_no, customer_details, item_details, created_at
         FROM quotations WHERE quotation_no = $1 AND status = 'confirmed' LIMIT 1`, [d.from]);
    if (!rows.length) throw new Error(`${e.id}: หาใบ ${d.from} ไม่เจอ (หรือไม่ได้ยืนยัน)`);
    const r = rows[0];
    const cd = r.customer_details || {};
    const items: ItemTruth[] = (r.item_details || [])
      .filter((it: any) => !it.is_optional)
      .map((it: any) => ({
        model: String(it.model ?? ''),
        quantity: Number(it.quantity) || 0,
        price: it.price === null || it.price === undefined ? null : Number(it.price),
        discount_1: Number(it.discount_1) || 0,
        discount_2: Number(it.discount_2) || 0,
      }));
    const truth = {
      intent: 'QUOTATION',
      customer_name: cd.customer_name ?? null,
      customer_code: cd.customer_code ?? null,
      contact_name: cd.contact_name ?? null,
      items,
    };
    const msgNorm = norm(e.message);
    const aligned = items.filter(it => it.model && msgNorm.includes(norm(it.model).slice(0, 6)));
    const alignment = items.length ? aligned.length / items.length : 0;
    const custOk = customerInMessage(e.message, truth);
    out.push({
      id: e.id,
      verdict: 'QUOTATION',
      truth,
      truth_source: `quotation:${d.from}`,
      seconds_after: Math.round((new Date(r.created_at).getTime() - new Date(e.created_at).getTime()) / 1000),
      truth_alignment: alignment,
      customer_in_message: custOk,
      // high = ทั้งลูกค้าและรุ่นสืบกลับได้จากข้อความ · medium = ได้ด้านเดียว · low = ไม่ได้เลย
      confidence: custOk && alignment > 0 ? 'high' : (custOk || alignment > 0 ? 'medium' : 'low'),
      needs_review: d.review !== 'confirmed',
      message: e.message,
      observed_reply_head: e.observed_reply_head,
    });
  }

  const drafted = out.filter(o => o.verdict === 'QUOTATION');
  const payload = {
    generated_at: new Date().toISOString(),
    corpus_generated_at: corpus.generated_at,
    counts: {
      total: out.length,
      drafted: drafted.length,
      pending: out.length - drafted.length,
      confirmed: drafted.filter(o => !o.needs_review).length,
      high: drafted.filter(o => o.confidence === 'high').length,
      medium: drafted.filter(o => o.confidence === 'medium').length,
      low: drafted.filter(o => o.confidence === 'low').length,
    },
    entries: out,
  };

  for (const o of drafted.sort((a, b) => a.confidence.localeCompare(b.confidence))) {
    const tag = o.confidence === 'high' ? `${GREEN}high  ${RESET}` : `${YEL}${o.confidence.padEnd(6)}${RESET}`;
    const items = o.truth.items.map((i: ItemTruth) => `${i.model} x${i.quantity}`).join(' | ');
    console.log(`${tag} ${BOLD}${o.id}${RESET} +${o.seconds_after}s ${o.truth_source.replace('quotation:', '')}`);
    console.log(`  ${DIM}พิมพ์มา${RESET} ${o.message.replace(/\n/g, ' ⏎ ').slice(0, 96)}`);
    console.log(`  ${DIM}เฉลย  ${RESET} ${o.truth.customer_code || '-'} ${String(o.truth.customer_name || '-').slice(0, 34)} / ${o.truth.contact_name || '-'} / ${items.slice(0, 70)}`);
  }
  console.log(`\n${BOLD}ร่างเฉลย ${payload.counts.drafted} เคส${RESET} (high ${payload.counts.high} · medium ${payload.counts.medium} · low ${payload.counts.low}) · ` +
    `ตรวจแล้ว ${payload.counts.confirmed} · ${BOLD}รอเคาะ ${payload.counts.pending} เคส${RESET}`);

  if (!PRINT_ONLY) {
    writeFileSync(OUT, JSON.stringify(payload, null, 2));
    console.log(`${DIM}เขียน ${OUT}${RESET}`);
  }
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
