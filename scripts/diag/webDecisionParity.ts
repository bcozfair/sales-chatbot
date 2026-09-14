// ─────────────────────────────────────────────────────────────────────────────
//  webDecisionParity — วัด "ชั้นตัดสินใจ" ของสองทางเข้า ไม่ใช่ "ชั้นค้นหา"
//
//  รัน:  npm run diag:web-decision            (deterministic, AI OFF — เร็ว/ฟรี)
//        npm run diag:web-decision -- --ai    (pipeline เต็มรวม AI — ช้า/มีค่าใช้จ่าย)
//
//  ═══ ทำไมต้องมีด่านนี้ ทั้งที่มี diag:customer-search กับ evalCustomerSearch แล้ว ═══
//  สองตัวนั้นวัด `findCustomerCandidates` ซึ่ง **ทั้ง LINE และเว็บเรียกตัวเดียวกัน** —
//  มันจึงรายงานว่า "ไม่ต่างกัน" เสมอ ทั้งที่ผู้ใช้เห็นความต่างชัด ๆ
//  ความต่างอยู่ที่ชั้นถัดไป: LINE เอา candidates ไปเข้า processQuotationRequest
//  (quotationService.ts) ซึ่งชั่งคะแนนแล้วตัดสินใจแทนเซลส์ได้ ส่วนเว็บ (webQuoteService.ts)
//  แค่ "นับจำนวน" → >1 เมื่อไหร่ก็โยนให้แอดมินเลือกทุกครั้ง
//
//  ด่านนี้จึง replay ชุดข้อสอบเดิมแล้วถามคำถามที่ทั้งสองตัวนั้นไม่ได้ถาม:
//    1. มีกี่เคสที่ **LINE ตอบเองได้ แต่เว็บถาม** — ขนาดของช่องว่าง
//    2. ในนั้น **เลือกผิดกี่เคส** — ต้นทุนของการปิดช่องว่าง (ต้องเป็น 0)
//    3. เคสที่หาบริษัทไม่เจอเลย กู้ได้ด้วย findCustomerByContactName กี่เคส (เว็บไม่มีชั้นนี้)
//    4. ลิสต์ที่แอดมินเห็น มีชื่อบริษัทซ้ำกันเป๊ะ ๆ กี่เคส (เว็บไม่ได้ dedupe)
//
//  ⚠️ SELECT อย่างเดียว ไม่เขียน DB ไม่ส่ง LINE ไม่แตะไฟล์ชุดข้อสอบ
//
//  ข้อจำกัดที่ต้องรู้ก่อนอ่านตัวเลข: ชุดข้อสอบขุดมาจากข้อความ LINE และแยก
//  customerQuery/contactQuery ด้วย heuristic ไม่ใช่ด้วย LLM เหมือนของจริง — ตัวเลขจึงวัด
//  "ชั้นตัดสินใจ" ได้ตรง แต่ไม่ใช่ end-to-end accuracy ของหน้าเว็บ
//  §B ด้านล่างชดเชยด้วยการ replay แถว web_propose จริงจาก messages (มีเท่าไรก็เท่านั้น)
// ─────────────────────────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, '..', '..', 'data', 'eval', 'customer_search_cases.json');

const args = process.argv.slice(2);
const MODE_AI = args.includes('--ai');
if (!MODE_AI) process.env.DISABLE_AI_MATCH = '1';

const { pool } = await import('../../config/db.js');
const { findCustomerCandidates, findCustomerByContactName } = await import('../../services/customerService.js');

interface EvalCase {
  id: string;
  customerQuery: string;
  contactQuery: string;
  expected: string;
}

const collapse = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * เคสที่ **LINE เลือกผิดอยู่แล้วในวันนี้** — ไม่ใช่ของที่เกิดจากงาน parity ของหน้าเว็บ
 *
 * ด่านนี้จึงไม่ล้มเพราะมัน แต่ต้องพิมพ์ให้เห็นทุกครั้ง · **เคสใหม่ที่ไม่อยู่ในลิสต์ = ล้มทันที**
 * (ลิสต์ที่โตขึ้นเงียบ ๆ คือวิธีที่ด่านตายโดยไม่มีใครรู้ตัว — เพิ่มชื่อลงนี่ต้องมีเหตุผลกำกับเสมอ)
 *
 * pin-4-person-phone (วัด 2026-09-14, เฉพาะตอน --ai):
 *   "คุณโยธิน 06-3884-0005" → ระบบเลือก "คุณโยธิน นามบุรี" (0.000057) เฉลยคือ
 *   "คุณ โยธิน ปาทาน" อยู่อันดับ 2 (0.139) · ห่างกัน 0.139 จึงผ่าน gate ไปเลือกผิด
 *   ลูกค้าบุคคลชื่อซ้ำกัน และ "เบอร์โทร" ซึ่งเป็นตัวชี้ขาดตัวเดียวถูก stripPhoneNumbers ตัดทิ้ง
 *   ก่อนค้น ⇒ แก้ที่ชั้นตัดสินใจไม่ได้ ต้องแก้ที่ชั้นหลักฐาน (งานคนละชิ้น ยังไม่ได้ทำ)
 *   ตอน AI ปิด เคสนี้ไม่ผิด — เป็นพฤติกรรมของชั้น AI ล้วน
 */
const KNOWN_INHERITED_WRONG = new Set<string>(['pin-4-person-phone']);

/**
 * gate ของ processQuotationRequest — คัดลอกนิยามมาไว้ที่นี่ **โดยตั้งใจ**
 * ด่านต้องเป็นอิสระจากของที่ถูกวัด ไม่งั้นแก้ผิดพร้อมกันแล้วด่านยังเขียว
 * ถ้าวันไหน quotationService.ts:1310 เปลี่ยนตัวเลข ต้องมาแก้ตรงนี้ด้วยมือ
 */
function lineWouldAutoSelect(scores: number[]): boolean {
  if (scores.length === 1) return true;
  if (scores.length < 2) return false;
  return scores[0] <= 0.05 && (scores[1] - scores[0]) > 0.05;
}

/** กติกาปัจจุบันของ webQuoteService.proposeFromText — นับจำนวนล้วน */
function webWouldAutoSelect(count: number): boolean {
  return count === 1;
}

/**
 * §0 — กระจกเงาต้องยังเหมือนต้นฉบับ
 *
 * เจ้าของสั่ง 2026-09-14 ว่า **ห้ามแตะเส้นทาง LINE** (รัน production ได้ดีอยู่แล้ว)
 * กฎ auto-select จึงมีสองชุดโดยตั้งใจ: `if` ของจริงใน `quotationService.ts` กับกระจกเงา
 * `decideCustomerSelection()` ที่หน้าเว็บใช้ · การยอมให้มีสำเนาแปลว่า "ต้องมีด่านเฝ้า"
 * ไม่ใช่ "ต้องจำให้ได้" — ตรงนี้อ่านซอร์สจริงมาเทียบตัวอักษร
 *
 * ถ้าด่านนี้ล้ม: ไปดูว่าฝั่งไหนเปลี่ยน แล้วทำให้ทั้งสามที่ตรงกัน (ต้นฉบับ · กระจกเงา · ด่านนี้)
 */
function sectionZero(): number {
  const SRC = path.join(__dirname, '..', '..', 'services', 'quotationService.ts');
  const EXPECTED = 'if (topScore <= 0.05 && (secondScore - topScore) > 0.05) {';
  const src = fs.readFileSync(SRC, 'utf8');
  const hit = src.includes(EXPECTED);
  console.log('══════════ §0 กฎของ LINE ยังเป็นตัวเดิมที่หน้าเว็บลอกมา ══════════');
  console.log(`  ${hit ? '✓' : '✗'} quotationService.ts ยังมีนิพจน์  ${EXPECTED.trim()}`);
  if (!hit) {
    console.log('  ⚠️ เส้นทาง LINE เปลี่ยนกฎแล้ว แต่ decideCustomerSelection() ยังเป็นของเก่า');
    console.log('     → ซิงก์ customerService.decideCustomerSelection + lineWouldAutoSelect ในไฟล์นี้');
  }
  return hit ? 0 : 1;
}

async function sectionA(): Promise<number> {
  if (!fs.existsSync(CASES_PATH)) {
    console.error(`ไม่พบชุดข้อสอบ ${CASES_PATH} — รัน evalCustomerSearch --mine ก่อน`);
    return 1;
  }
  const cases: EvalCase[] = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));
  const salespersonStub = { name: 'EVAL', branch_code: '' };

  let lineAuto = 0, webAuto = 0;
  let gapClosed = 0, gapCorrect = 0, gapWrong = 0;
  let zero = 0, zeroRescued = 0, zeroRescuedCorrect = 0, zeroListed = 0;
  let dupLists = 0;
  const gapLines: string[] = [];
  const wrongLines: string[] = [];
  const inheritedLines: string[] = [];
  const rescueLines: string[] = [];

  for (const c of cases) {
    let candidates: any[] = [];
    try {
      candidates = await findCustomerCandidates(c.customerQuery, salespersonStub, c.contactQuery);
    } catch (err: any) {
      console.error(`  [${c.id}] ERROR: ${err.message}`);
    }

    const names = candidates.map(r => (r.item?.display_name || '').trim());
    const rank = names.findIndex(n => collapse(n) === collapse(c.expected)) + 1;
    const scores = candidates.map(r => Number(r.score));

    const lineAutoHere = lineWouldAutoSelect(scores);
    const webAutoHere = webWouldAutoSelect(candidates.length);
    if (lineAutoHere) lineAuto++;
    if (webAutoHere) webAuto++;

    // ── 1+2: ช่องว่างและต้นทุนของมัน ──
    if (lineAutoHere && !webAutoHere) {
      gapClosed++;
      const ok = rank === 1;
      if (ok) gapCorrect++; else gapWrong++;
      const line = `  ${ok ? '✅' : '⚠️ ผิด'} [${c.id}] "${c.customerQuery}"\n`
        + `      เว็บถาม ${candidates.length} ตัวเลือก · LINE เลือก: ${names[0]}\n`
        + `      เฉลย: ${c.expected}${ok ? '' : `  (อยู่อันดับ ${rank || '∅'})`}\n`
        + `      คะแนน: top=${scores[0]} second=${scores[1]} gap=${(scores[1] - scores[0]).toFixed(3)}`;
      gapLines.push(line);
      if (!ok && !KNOWN_INHERITED_WRONG.has(c.id)) wrongLines.push(line);
      if (!ok && KNOWN_INHERITED_WRONG.has(c.id)) inheritedLines.push(line);
    }

    // ── 3: เคสหาไม่เจอเลย → ชั้นกู้ด้วยชื่อผู้ติดต่อที่เว็บไม่มี ──
    if (candidates.length === 0) {
      zero++;
      let byContact: any[] = [];
      try {
        byContact = await findCustomerByContactName(c.customerQuery, salespersonStub);
      } catch { /* ด่านวัด ไม่ใช่ของจริง — ล้มเงียบได้ */ }
      if (byContact.length === 1 && Number(byContact[0].score) < 0.45) {
        zeroRescued++;
        const ok = collapse(byContact[0].display_name) === collapse(c.expected);
        if (ok) zeroRescuedCorrect++;
        rescueLines.push(`  ${ok ? '✅' : '⚠️ ผิด'} [${c.id}] "${c.customerQuery}" → ${byContact[0].display_name}`);
      } else if (byContact.length > 1) {
        zeroListed++;
        rescueLines.push(`  📋 [${c.id}] "${c.customerQuery}" → เสนอ ${byContact.length} บริษัทที่มีผู้ติดต่อชื่อนี้ (เว็บตอบ "ไม่พบ")`);
      }
    }

    // ── 4: ลิสต์ที่แอดมินเห็นมีชื่อซ้ำกันเป๊ะไหม (LINE dedupe ก่อนแสดง เว็บไม่ได้ทำ) ──
    const top12 = names.slice(0, 12).map(collapse);
    if (new Set(top12).size < top12.length) dupLists++;
  }

  const n = cases.length;
  console.log('\n══════════ §A ชุดข้อสอบ ' + n + ' เคส (AI ' + (MODE_AI ? 'ON' : 'OFF') + ') ══════════');
  console.log(`LINE ตัดสินใจเองได้        : ${lineAuto}/${n} (${(100 * lineAuto / n).toFixed(1)}%)`);
  console.log(`เว็บตัดสินใจเองได้ (ปัจจุบัน) : ${webAuto}/${n} (${(100 * webAuto / n).toFixed(1)}%)`);
  console.log(`ช่องว่าง (เว็บถามทั้งที่ LINE ตอบได้) : ${gapClosed} เคส`);
  console.log(`   └ ถ้าปิดช่องว่าง เลือกถูก : ${gapCorrect}`);
  console.log(`   └ ถ้าปิดช่องว่าง เลือกผิด : ${gapWrong}`
    + `  (ของเดิมที่ LINE พลาดอยู่แล้ว ${inheritedLines.length} · ของใหม่ ${wrongLines.length}`
    + `${wrongLines.length > 0 ? ' ⚠️ ต้องเป็น 0!' : ' ✓'})`);
  console.log(`หาบริษัทไม่เจอเลย           : ${zero} เคส`);
  console.log(`   └ กู้ได้ด้วยชื่อผู้ติดต่อ (เลือกเดี่ยว) : ${zeroRescued} (ถูก ${zeroRescuedCorrect})`);
  console.log(`   └ กู้เป็นลิสต์ให้เลือก         : ${zeroListed}`);
  console.log(`ลิสต์มีชื่อบริษัทซ้ำกันเป๊ะ    : ${dupLists} เคส (LINE dedupe เว็บไม่ได้ทำ)`);

  if (inheritedLines.length) {
    console.log('\n── ⚠️ ของเดิมที่ LINE เลือกผิดอยู่แล้ว (เว็บจะรับมาด้วย — ไม่ใช่ของใหม่) ──');
    for (const l of inheritedLines) console.log(l);
  }
  if (gapLines.length) {
    console.log('\n── เคสที่ปิดช่องว่างแล้วได้ผล ──');
    for (const l of gapLines) console.log(l);
  }
  if (rescueLines.length) {
    console.log('\n── เคสที่ชั้นกู้ด้วยชื่อผู้ติดต่อช่วยได้ ──');
    for (const l of rescueLines) console.log(l);
  }

  return wrongLines.length;
}

/**
 * §B — replay แถว `web_propose` จริงจาก messages
 * ใช้ meta.cust_candidates ที่ log ไว้แล้ว (มี rank+score ครบ) จึง **ไม่ต้องค้นใหม่**
 * = ฟรี, ไม่แตะ DB นอกจาก SELECT เดียว, และสะท้อนการใช้งานจริงของหน้าเว็บ
 */
async function sectionB(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, created_at, meta FROM messages
      WHERE type = 'web_propose' AND meta->>'outcome' = 'ambiguous'
      ORDER BY id DESC LIMIT 50`
  );

  console.log(`\n══════════ §B แถว web_propose จริง (outcome=ambiguous) ${rows.length} แถว ══════════`);
  if (rows.length === 0) {
    console.log('ยังไม่มีข้อมูลจริง — ระบบ log เพิ่งเริ่มเก็บ 2026-09-14 (ปกติ ไม่ใช่ความล้มเหลว)');
    return;
  }

  let wouldAuto = 0;
  for (const r of rows) {
    const list: any[] = Array.isArray(r.meta?.cust_candidates) ? r.meta.cust_candidates : [];
    if (list.length < 2) continue;
    const scores = list.map((c: any) => Number(c.score));
    const auto = lineWouldAutoSelect(scores);
    if (auto) wouldAuto++;
    console.log(`  ${auto ? '🎯 LINE ตอบเองได้' : '   ต้องถามจริง '} [id=${r.id}] ${list.length} ตัวเลือก`
      + ` · top=${scores[0]} second=${scores[1]}`
      + (auto ? `\n      → ${list[0].display_name}` : ''));
  }
  console.log(`\nสรุป: ${wouldAuto}/${rows.length} แถวที่แอดมินถูกบังคับให้เลือก ทั้งที่ gate ของ LINE ตัดสินได้เอง`);
}

let wrong = 0;
let drift = 0;
try {
  drift = sectionZero();
  wrong = await sectionA();
  await sectionB();
  const bad = wrong + drift;
  console.log(`\n${bad === 0 ? '✅ ผ่าน' : '❌ ล้ม'} — กฎเพี้ยนจากต้นฉบับ ${drift} จุด`
    + ` · เคสเลือกผิดที่ยังไม่มีใครรู้จัก ${wrong} เคส (ทั้งคู่ต้องเป็น 0)`);
} finally {
  await pool.end();
}
process.exit(wrong + drift === 0 ? 0 : 1);
