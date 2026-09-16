// ─────────────────────────────────────────────────────────────────────────────
//  extractionEval — วัดชั้นสกัดคำสั่งด้วย "ข้อความจริง + เฉลยจากใบที่ออกจริง"
//
//  ตอบคำถามเดียวที่ต้องตอบก่อนแตะ prompt: **"แก้แล้วดีกว่าเดิมจริงไหม"**
//  ซึ่งแปลว่าต้องวัดสองด้านพร้อมกันเสมอ — ของที่เคยทำได้ต้องไม่พัง (กลุ่ม A + C)
//  และของที่เคยทำไม่ได้ต้องทำได้เพิ่ม (กลุ่ม B) **วัดด้านเดียวคือวิธีหลอกตัวเอง**
//
//  วิธีที่ทำให้ตัวเลขเชื่อได้:
//   1. prompt มาจาก `services/quoteExtraction.ts` ของจริงเสมอ (`buildExtractionPrompt`)
//      variant ที่อยากทดลองเป็น "ส่วนต่าง" ที่ประกาศไว้ใน extractionVariants.ts และ
//      **ยืนยันตอนรันว่าแทนที่ได้จริง** ถ้าแทนไม่ได้ = โยน error ทันที ดีกว่าวัด prompt เดิม
//      แล้วรายงานว่า variant ไม่ช่วยอะไร
//   2. ประกอบ historyContext ด้วยตรรกะเดียวกับ production (15 นาที + ตัดที่ยืนยัน/ยกเลิก)
//      จาก `history` ที่ corpus เก็บไว้ ⇒ replay ได้เหมือนวันนั้นโดยไม่ต้องยิง DB
//   3. จำคำตอบ LLM ไว้ในดิสก์ตาม hash ของ prompt ⇒ รันซ้ำได้ผลเดิม ไม่เสียเงินซ้ำ
//      ความต่างที่เห็นระหว่าง variant จึงมาจาก prompt ล้วน ๆ ไม่ใช่ความสุ่มของโมเดล
//   4. เฉลยที่ "ไม่ตรงกับข้อความ" ไม่ถูกนับเป็นคะแนน (`truth_alignment`) — ใบที่เซลส์
//      ไปแก้รุ่นต่อใน LIFF ไม่ใช่ความผิดของชั้นสกัด
//
//  ผลข้างเคียง: ไม่เขียน DB · ไม่เรียก LINE · ยิง LLM เท่าจำนวนเคสที่ยังไม่มีใน cache
//
//  รัน:
//    tsx scripts/diag/extractionEval.ts --dry-run              ดูว่าจะยิงกี่ call ก่อนจ่ายเงิน
//    tsx scripts/diag/extractionEval.ts --save                 บันทึก baseline ของ prompt ปัจจุบัน
//    tsx scripts/diag/extractionEval.ts                        เทียบกับ baseline
//    tsx scripts/diag/extractionEval.ts --variant relax-keyword เทียบ variant กับ baseline
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { createChatCompletion, LLM_MODEL } from '../../config/clients.js';
import { buildExtractionPrompt, parseAiJson } from '../../services/quoteExtraction.js';
import { VARIANTS, applyVariant } from './extractionVariants.js';

const ARGV = process.argv.slice(2);
const DRY_RUN = ARGV.includes('--dry-run');
const SAVE = ARGV.includes('--save');
const VERBOSE = ARGV.includes('--verbose');
function argStr(name: string, fallback: string): string {
  const i = ARGV.indexOf(`--${name}`);
  return i < 0 || !ARGV[i + 1] ? fallback : ARGV[i + 1];
}
function argNum(name: string, fallback: number): number {
  const i = ARGV.indexOf(`--${name}`);
  if (i < 0 || !ARGV[i + 1]) return fallback;
  const v = Number(ARGV[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const VARIANT = argStr('variant', '');
const CONCURRENCY = argNum('concurrency', 4);
/**
 * โหมดวัด "ความนิ่งของคำตอบ" — ยิงเคสเดิมซ้ำ N รอบโดยไม่ใช้ cache
 *
 * ต้องมีก่อนจะเชื่อส่วนต่างใด ๆ: `temperature: 0` ไม่ได้แปลว่าผลคงที่ (DeepSeek เป็น MoE
 * และชื่อรุ่นชี้ไป snapshot ที่ผู้ให้บริการอัปเดตเองได้) ⇒ ถ้าคำตอบแกว่งเอง 5 เคส
 * การอ่านว่า "variant ดีขึ้น 3 เคส" ก็ไม่มีความหมาย **นี่คือหน่วยวัดของ noise**
 */
const STABILITY = argNum('stability', 0);
const ONLY_GROUP = argStr('group', '');
const DIR = 'data/eval';
const CORPUS = `${DIR}/extraction_corpus.json`;
const CACHE = `${DIR}/extraction_llm_cache.json`;
const BASELINE = `${DIR}/extraction_baseline.json`;

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', YEL = '\x1b[33m', CYAN = '\x1b[36m', RESET = '\x1b[0m';

interface HistoryRow { content: string; reply_content: string | null; seconds_before: number }
interface ItemTruth { model: string; quantity: number; price: number | null; discount_1: number; discount_2: number }
interface Entry {
  id: string; group: 'A-confirmed' | 'B-missed' | 'C-negative';
  message: string; history: HistoryRow[];
  truth: { intent: string | null; customer_name?: string | null; customer_code?: string | null; contact_name?: string | null; items?: ItemTruth[] };
  truth_alignment?: number; needs_review: boolean; observed_reply_head: string;
}

/**
 * โหมด "อ่านก่อนแล้วค่อยสกัด" — สองรอบต่อหนึ่งข้อความ
 *
 * รอบ 1 ให้โมเดลอ่านข้อความ + ประวัติแล้วสรุปเป็นภาษาคนว่าเซลส์ต้องการอะไร
 * รอบ 2 ใช้ prompt ของ production ทุกตัวอักษร โดยเอาบทสรุปใส่ใน "ช่องบริบท"
 *       ที่ prompt มีอยู่แล้ว (ที่เดิมใส่ประวัติแชท) ⇒ ไม่ต้องแก้ prompt เลยสักไบต์
 *
 * ต้นทุนที่ต้องเอาไปชั่งกับผลที่ได้: LLM 2 call ต่อข้อความ (เวลา + เงินเป็นสองเท่า)
 * ภายใต้งบ 48 วินาทีของ replyToken
 */
const TWO_PASS = 'two-pass';

function buildReadingPrompt(message: string, historyContext: string): string {
  return `คุณคือผู้ช่วยฝ่ายขายที่กำลังอ่านข้อความจากเซลส์ในห้องแชท LINE
${historyContext ? `${historyContext}\n` : ''}ข้อความล่าสุดจากเซลส์:
${message}

อ่านข้อความล่าสุดโดยดูประวัติประกอบ แล้วสรุปสั้น ๆ เป็นภาษาไทยไม่เกิน 4 บรรทัดว่า:
1. เซลส์ต้องการอะไร (ขอใบเสนอราคา / ถามราคาสินค้า / แนะนำตัว / อย่างอื่น)
2. ลูกค้าคือใคร (ถ้ามี — รวมถึงที่ระบุไว้ในข้อความก่อนหน้าของใบที่ยังทำไม่เสร็จ)
3. รายการสินค้าและจำนวนที่ต้องการ (ถ้ามี)
4. ส่วนลดที่ระบุ (ถ้ามี)
ห้ามเดาข้อมูลที่ไม่มีในข้อความ — ไม่มีให้เขียนว่า "ไม่ระบุ" · ตอบเป็นข้อความธรรมดา ไม่ใช่ JSON`;
}

/**
 * normalize รุ่นสินค้า/ชื่อ — ตัดช่องว่าง ขีด จุด แล้ว lower
 *
 * `เเ` (สระเอ สองตัว) → `แ` ด้วย: คนพิมพ์ไทยพิมพ์แบบนี้ประจำ และมันไม่ใช่ความผิดของ
 * ชั้นสกัด — เจอจริง 3 เคสใน 140 (2026-09-16) ที่เซลส์พิมพ์ "บริษัท เเสงพิทักษ์"
 * แล้วใบออกมาเป็น "แสงพิทักษ์" ได้ถูกต้อง ⇒ ถ้าไม่พับให้เท่ากัน ตัววัดจะรายงานว่า
 * ชั้นสกัดจับลูกค้าผิด ทั้งที่มันคืนตามที่เซลส์พิมพ์มาถูกทุกตัวอักษร
 */
function norm(s: any): string {
  return String(s ?? '').replace(/เเ/g, 'แ').replace(/[\s\-_.()"']/g, '').toLowerCase();
}

/**
 * ประกอบ historyContext แบบเดียวกับ extractQuoteFromText() — คัดตรรกะมา ไม่ใช่เรียกของจริง
 * เพราะของจริงผูกกับ `getRecentMessages(userId)` ที่ต้องยิง DB ตามเวลา ณ ปัจจุบัน
 * ⚠️ ตรรกะสองชุดนี้ต้องตรงกัน — เปลี่ยนที่ quoteExtraction.ts เมื่อไหร่ ต้องตามมาแก้ที่นี่
 *    (หน้าต่าง 15 นาที · ตัดตรงที่บอทตอบว่ายืนยัน/ยกเลิกแล้ว · เรียงเก่า→ใหม่)
 */
export function buildHistoryContext(history: HistoryRow[], windowMinutes = 15): string {
  let recent = history.filter(h => h.seconds_before <= windowMinutes * 60);
  const closeIndex = recent.findIndex(h => h.reply_content && (
    h.reply_content.includes('ยกเลิกการออกใบเสนอราคา') ||
    h.reply_content.includes('ยกเลิกการเสนอราคา') ||
    h.reply_content.includes('ยืนยันสำเร็จ') ||
    h.reply_content.includes('ลงทะเบียนสำเร็จ')
  ));
  if (closeIndex !== -1) recent = recent.slice(0, closeIndex);
  if (!recent.length) return '';
  const chat = [...recent].reverse();
  return 'ประวัติการสนทนาล่าสุดในห้องแชทนี้:\n' +
    chat.map(h => `เซลส์: ${h.content}\nบอท: ${h.reply_content}`).join('\n') + '\n\n';
}

// ── การให้คะแนน ────────────────────────────────────────────────────────────────

interface Scored {
  id: string; group: Entry['group'];
  intent: string;
  intent_ok: boolean | null;          // null = ไม่มีเฉลย (กลุ่ม B)
  customer_ok: boolean | null;
  items_ok: boolean | null;
  items_found: number; items_expected: number;
  discount_ok: boolean | null;
  failed: boolean;                    // LLM ล้ม/parse ไม่ได้
  ms: number; cached: boolean;
  detail?: string;
}

/** ลูกค้าถูกไหม — ชั้นสกัดคืนข้อความดิบ ไม่ใช่ id ⇒ เทียบแบบ "ชี้ไปทางเดียวกัน" */
function customerMatches(ai: any, truth: Entry['truth']): boolean {
  const q = norm(ai?.quotation_data?.customer_query);
  const c = norm(ai?.quotation_data?.contact_query);
  const both = `${q}|${c}`;
  const name = norm(truth.customer_name);
  const contact = norm(truth.contact_name);
  const code = norm(truth.customer_code);
  if (code && both.includes(code)) return true;
  // ชื่อบริษัทในใบมี "(สำนักงานใหญ่)/จำกัด" ต่อท้ายที่เซลส์ไม่ได้พิมพ์ ⇒ เทียบสองทางด้วยแกนกลาง 6 ตัวอักษร
  const core = name.replace(/^(บริษัท|บ|หจก|บจก|หา้งหุ้นส่วนจำกัด|ห้างหุ้นส่วนจำกัด)/, '').slice(0, 6);
  if (core.length >= 4 && (q.includes(core) || name.includes(q) && q.length >= 4)) return true;
  if (contact && c && (c.includes(contact.replace(/^คุณ/, '')) || contact.includes(c.replace(/^คุณ/, '')))) return true;
  return false;
}

function scoreOne(e: Entry, ai: any, ms: number, cached: boolean): Scored {
  const base: Scored = {
    id: e.id, group: e.group, intent: ai?.intent ?? 'ERROR',
    intent_ok: null, customer_ok: null, items_ok: null,
    items_found: 0, items_expected: 0, discount_ok: null,
    failed: !ai, ms, cached,
  };
  if (!ai) return base;

  const isQuote = ai.intent === 'QUOTATION';
  if (e.group === 'A-confirmed') base.intent_ok = isQuote;
  else if (e.group === 'C-negative') base.intent_ok = !isQuote;
  // กลุ่ม B ไม่มีเฉลย — เก็บ intent ไว้รายงานเฉย ๆ

  const truthItems = (e.truth.items ?? []);
  const alignment = e.truth_alignment ?? 0;
  if (e.group === 'A-confirmed' && truthItems.length && alignment > 0) {
    const msgNorm = norm(e.message);
    // ให้คะแนนเฉพาะรายการที่ "มีอยู่ในข้อความจริง" — ที่เหลือเซลส์แก้ต่อทีหลัง ไม่ใช่งานของชั้นสกัด
    const gradable = truthItems.filter(it => it.model && msgNorm.includes(norm(it.model).slice(0, 6)));
    const aiItems: any[] = ai?.quotation_data?.items ?? [];
    let found = 0;
    for (const want of gradable) {
      const wn = norm(want.model);
      const hit = aiItems.find(it => {
        const gn = norm(it?.model);
        return gn && (gn.includes(wn.slice(0, 6)) || wn.includes(gn.slice(0, 6)));
      });
      if (hit && Number(hit.quantity) === want.quantity) found++;
    }
    base.items_expected = gradable.length;
    base.items_found = found;
    base.items_ok = gradable.length > 0 ? found === gradable.length : null;

    // ส่วนลดที่มีผลจริง = ของรายการนั้นถ้ามี ไม่งั้นตกมาจากระดับบิล (ตรรกะเดียวกับ buildResolvedItem)
    if (gradable.length) {
      const billD1 = Number(ai?.quotation_data?.discount_1) || 0;
      const okAll = gradable.every(want => {
        const wn = norm(want.model);
        const hit = aiItems.find(it => {
          const gn = norm(it?.model);
          return gn && (gn.includes(wn.slice(0, 6)) || wn.includes(gn.slice(0, 6)));
        });
        if (!hit) return false;
        const eff = Number(hit.discount_1) > 0 ? Number(hit.discount_1) : billD1;
        return eff === want.discount_1;
      });
      base.discount_ok = okAll;
    }
  }

  if (e.group === 'A-confirmed' && (e.truth.customer_name || e.truth.contact_name)) {
    base.customer_ok = isQuote ? customerMatches(ai, e.truth) : false;
  }
  return base;
}

// ── cache ────────────────────────────────────────────────────────────────────

type Cache = Record<string, { content: string; ms: number }>;
function loadCache(): Cache { try { return JSON.parse(readFileSync(CACHE, 'utf8')); } catch { return {}; } }
function cacheKey(prompt: string): string {
  return createHash('sha256').update(`${LLM_MODEL} ${prompt}`).digest('hex').slice(0, 32);
}

async function main() {
  if (!existsSync(CORPUS)) {
    console.error(`${RED}ไม่พบ ${CORPUS}${RESET} — รัน tsx scripts/diag/extractionCorpus.ts ก่อน`);
    process.exit(1);
  }
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
  let entries: Entry[] = corpus.entries;
  if (ONLY_GROUP) entries = entries.filter(e => e.group.startsWith(ONLY_GROUP));

  if (VARIANT && VARIANT !== TWO_PASS && !VARIANTS[VARIANT]) {
    console.error(`${RED}ไม่รู้จัก variant "${VARIANT}"${RESET} — ที่มี: ${Object.keys(VARIANTS).join(', ') || '(ยังไม่มี)'}`);
    process.exit(1);
  }

  console.log(`${BOLD}วัดชั้นสกัดคำสั่งจากข้อความจริง${RESET} ${DIM}(corpus ${entries.length} เคส · สร้าง ${corpus.generated_at?.slice(0, 16)})${RESET}`);
  const variantDesc = VARIANT === TWO_PASS
    ? 'อ่าน/ตีความก่อน (LLM รอบ 1) แล้วค่อยสกัดด้วย prompt production (รอบ 2) — 2 call ต่อข้อความ'
    : VARIANT ? VARIANTS[VARIANT].description : '';
  console.log(`  prompt: ${VARIANT ? `${YEL}variant "${VARIANT}"${RESET} — ${variantDesc}` : `${GREEN}production ปัจจุบัน${RESET}`}`);
  console.log(`  model : ${LLM_MODEL}\n`);

  // ประกอบ prompt ทุกเคสก่อน เพื่อบอกจำนวน call ที่ต้องยิงจริงได้ก่อนเริ่มจ่ายเงิน
  const cache = loadCache();
  const jobs = entries.map(e => {
    const historyContext = buildHistoryContext(e.history);
    // two-pass: prompt รอบ 2 ขึ้นกับผลรอบ 1 ⇒ ประกอบไม่ได้ตอนนี้ ใช้ prompt รอบ 1 ไปก่อน
    // (cache key จึงเป็นของรอบ 1 — รอบ 2 มี key ของตัวเองตอนยิง)
    if (VARIANT === TWO_PASS) {
      const reading = buildReadingPrompt(e.message, historyContext);
      return { entry: e, prompt: reading, key: cacheKey(reading), hasHistory: historyContext.length > 0, historyContext };
    }
    let prompt = buildExtractionPrompt(e.message, historyContext);
    if (VARIANT) prompt = applyVariant(VARIANT, prompt);
    return { entry: e, prompt, key: cacheKey(prompt), hasHistory: historyContext.length > 0, historyContext };
  });
  const missing = jobs.filter(j => !cache[j.key]).length;
  const avgPromptChars = Math.round(jobs.reduce((s, j) => s + j.prompt.length, 0) / jobs.length);
  console.log(`  ต้องยิง LLM ${BOLD}${missing}${RESET} call (อีก ${jobs.length - missing} ใช้ cache) · prompt เฉลี่ย ${avgPromptChars} ตัวอักษร`);
  console.log(`  มีประวัติแชทเข้า prompt ${jobs.filter(j => j.hasHistory).length} เคส\n`);
  if (DRY_RUN) { console.log(`${DIM}--dry-run — จบโดยไม่ยิงอะไร${RESET}`); return; }

  // ── โหมดวัดความนิ่ง: ยิงซ้ำ N รอบ ไม่แตะ cache แล้วรายงานเคสที่ตอบไม่เหมือนเดิม ──
  if (STABILITY > 1) {
    console.log(`${BOLD}วัดความนิ่งของคำตอบ${RESET} — ยิงซ้ำ ${STABILITY} รอบ ไม่ใช้ cache (${jobs.length * STABILITY} call)\n`);
    const intents: Record<string, string[]> = {};
    const perRound: number[] = [];
    for (let round = 1; round <= STABILITY; round++) {
      await Promise.all(Array.from({ length: CONCURRENCY }, (_, w) => (async () => {
        for (let i = w; i < jobs.length; i += CONCURRENCY) {
          const j = jobs[i];
          let content = '';
          try {
            if (VARIANT === TWO_PASS) {
              const r1: any = await createChatCompletion({ messages: [{ role: 'user', content: j.prompt }], max_tokens: 1024 });
              const reading = (r1.choices[0]?.message?.content || '').trim();
              const ctx = reading ? `สรุปความเข้าใจข้อความนี้ (ผู้ช่วยอ่านมาให้แล้ว):\n${reading}\n\n${j.historyContext}` : j.historyContext;
              const r2: any = await createChatCompletion({
                messages: [{ role: 'user', content: buildExtractionPrompt(j.entry.message, ctx) }],
                response_format: { type: 'json_object' }, max_tokens: 8192,
              });
              content = r2.choices[0]?.message?.content || '';
            } else {
              const res = await createChatCompletion({
                messages: [{ role: 'user', content: j.prompt }],
                response_format: { type: 'json_object' },
                max_tokens: 8192,
              });
              content = res.choices[0]?.message?.content || '';
            }
          } catch { content = ''; }
          const ai = content ? parseAiJson(content) : null;
          (intents[j.entry.id] ??= []).push(ai?.intent ?? 'ERROR');
        }
      })()));
      const q = Object.values(intents).filter(v => v[round - 1] === 'QUOTATION').length;
      perRound.push(q);
      process.stdout.write(`${DIM}  รอบ ${round}/${STABILITY} เสร็จ — เป็น QUOTATION ${q}/${jobs.length}${RESET}\n`);
    }
    // ค่าเฉลี่ย ± ช่วง คือสิ่งที่เอาไปเทียบข้าม variant ได้ ตัวเลขรอบเดียวเทียบไม่ได้
    const mean = perRound.reduce((a, b) => a + b, 0) / perRound.length;
    console.log(`\n  QUOTATION ต่อรอบ: ${BOLD}${perRound.join(' · ')}${RESET} ⇒ เฉลี่ย ${mean.toFixed(1)} (ต่ำสุด ${Math.min(...perRound)} สูงสุด ${Math.max(...perRound)})`);
    const unstable = Object.entries(intents).filter(([, v]) => new Set(v).size > 1);
    console.log(`\n  เคสที่ตอบ ${BOLD}ไม่เหมือนกันทุกรอบ${RESET}: ${unstable.length ? RED : GREEN}${unstable.length}${RESET}/${jobs.length}`);
    for (const [id, v] of unstable) {
      const e = entries.find(x => x.id === id)!;
      console.log(`   ${id}: ${v.join(' · ')}  ${DIM}${e.message.replace(/[\r\n]+/g, ' / ').slice(0, 60)}${RESET}`);
    }
    console.log(`\n${DIM}ตัวเลขนี้คือ "พื้นเสียง" — ส่วนต่างระหว่าง variant ที่เล็กกว่านี้ อ่านเป็นการปรับปรุงไม่ได้${RESET}`);
    return;
  }

  // ── ยิงจริง ──
  const results: Scored[] = new Array(jobs.length);
  let done = 0;
  async function worker(slice: number[]) {
    for (const i of slice) {
      const j = jobs[i];
      const hit = cache[j.key];
      let content = hit?.content ?? '';
      let ms = hit?.ms ?? 0;
      if (!hit) {
        const t0 = Date.now();
        try {
          if (VARIANT === TWO_PASS) {
            // รอบ 1 — อ่านและตีความเป็นภาษาคน (ไม่บังคับ JSON)
            const r1: any = await createChatCompletion({
              messages: [{ role: 'user', content: j.prompt }], max_tokens: 1024,
            });
            const reading = (r1.choices[0]?.message?.content || '').trim();
            // รอบ 2 — prompt production ทุกตัวอักษร โดยบทสรุปไปอยู่ในช่องบริบทเดิม
            const ctx = reading ? `สรุปความเข้าใจข้อความนี้ (ผู้ช่วยอ่านมาให้แล้ว):\n${reading}\n\n${j.historyContext}` : j.historyContext;
            const r2: any = await createChatCompletion({
              messages: [{ role: 'user', content: buildExtractionPrompt(j.entry.message, ctx) }],
              response_format: { type: 'json_object' }, max_tokens: 8192,
            });
            content = r2.choices[0]?.message?.content || '';
          } else {
            const res = await createChatCompletion({
              messages: [{ role: 'user', content: j.prompt }],
              response_format: { type: 'json_object' },
              max_tokens: 8192,
            });
            content = res.choices[0]?.message?.content || '';
          }
        } catch (err: any) {
          content = '';
          if (VERBOSE) console.error(`  ${RED}${j.entry.id} ล้ม:${RESET} ${err?.message || err}`);
        }
        ms = Date.now() - t0;
        cache[j.key] = { content, ms };
      }
      const ai = content ? parseAiJson(content) : null;
      results[i] = scoreOne(j.entry, ai, ms, !!hit);
      done++;
      if (done % 20 === 0) process.stdout.write(`${DIM}  …${done}/${jobs.length}${RESET}\n`);
    }
  }
  const slices: number[][] = Array.from({ length: CONCURRENCY }, () => []);
  jobs.forEach((_, i) => slices[i % CONCURRENCY].push(i));
  await Promise.all(slices.map(worker));
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache), 'utf8');

  // ── สรุป ──
  const byGroup = (g: Entry['group']) => results.filter(r => r.group === g);
  const pct = (n: number, d: number) => d === 0 ? '  –  ' : `${(100 * n / d).toFixed(1).padStart(5)}%`;
  const A = byGroup('A-confirmed'), B = byGroup('B-missed'), C = byGroup('C-negative');

  const summary = {
    generated_at: new Date().toISOString(),
    variant: VARIANT || 'production',
    model: LLM_MODEL,
    corpus_generated_at: corpus.generated_at,
    A: {
      n: A.length,
      intent_ok: A.filter(r => r.intent_ok).length,
      customer_ok: A.filter(r => r.customer_ok).length,
      customer_n: A.filter(r => r.customer_ok !== null).length,
      items_ok: A.filter(r => r.items_ok).length,
      items_n: A.filter(r => r.items_ok !== null).length,
      discount_ok: A.filter(r => r.discount_ok).length,
      discount_n: A.filter(r => r.discount_ok !== null).length,
      failed: A.filter(r => r.failed).length,
    },
    B: {
      n: B.length,
      became_quotation: B.filter(r => r.intent === 'QUOTATION').length,
      still_unclear: B.filter(r => r.intent === 'UNCLEAR').length,
      product_info: B.filter(r => r.intent === 'PRODUCT_INFO').length,
    },
    C: {
      n: C.length,
      intent_ok: C.filter(r => r.intent_ok).length,
      false_quotation: C.filter(r => r.intent === 'QUOTATION').length,
    },
    per_case: results.map(r => ({ id: r.id, intent: r.intent, intent_ok: r.intent_ok, items_ok: r.items_ok, customer_ok: r.customer_ok, discount_ok: r.discount_ok })),
  };

  console.log(`\n${BOLD}A — ของที่เคยทำได้ ต้องไม่พัง${RESET} ${DIM}(เฉลยจากใบที่ยืนยันแล้ว)${RESET}`);
  console.log(`   intent = QUOTATION   ${pct(summary.A.intent_ok, summary.A.n)}  ${summary.A.intent_ok}/${summary.A.n}`);
  console.log(`   จับลูกค้าถูก          ${pct(summary.A.customer_ok, summary.A.customer_n)}  ${summary.A.customer_ok}/${summary.A.customer_n}`);
  console.log(`   รายการ+จำนวนครบ      ${pct(summary.A.items_ok, summary.A.items_n)}  ${summary.A.items_ok}/${summary.A.items_n}`);
  console.log(`   ส่วนลดตรง            ${pct(summary.A.discount_ok, summary.A.discount_n)}  ${summary.A.discount_ok}/${summary.A.discount_n}`);
  if (summary.A.failed) console.log(`   ${RED}LLM ล้ม/parse ไม่ได้ ${summary.A.failed}${RESET}`);

  console.log(`\n${BOLD}B — ของที่เคยทำไม่ได้ ${DIM}(ไม่มีเฉลย — ดูทิศทาง)${RESET}`);
  console.log(`   กลายเป็น QUOTATION   ${pct(summary.B.became_quotation, summary.B.n)}  ${summary.B.became_quotation}/${summary.B.n}`);
  console.log(`   ยังไม่เข้าใจเหมือนเดิม  ${pct(summary.B.still_unclear, summary.B.n)}  ${summary.B.still_unclear}/${summary.B.n}`);
  console.log(`   ตีเป็นถามข้อมูลสินค้า   ${pct(summary.B.product_info, summary.B.n)}  ${summary.B.product_info}/${summary.B.n}`);

  console.log(`\n${BOLD}C — ของที่ต้องไม่กลายเป็นใบ${RESET}`);
  console.log(`   ไม่กลายเป็นใบ         ${pct(summary.C.intent_ok, summary.C.n)}  ${summary.C.intent_ok}/${summary.C.n}`);
  if (summary.C.false_quotation) console.log(`   ${RED}⚠ กลายเป็นใบทั้งที่ไม่ควร ${summary.C.false_quotation} เคส${RESET}`);

  const cachedN = results.filter(r => r.cached).length;
  const fresh = results.filter(r => !r.cached);
  if (fresh.length) {
    const lat = fresh.map(r => r.ms).sort((a, b) => a - b);
    console.log(`\n${DIM}เวลา LLM (เฉพาะ ${fresh.length} call ที่ยิงจริง): p50 ${lat[Math.floor(lat.length / 2)]}ms · p95 ${lat[Math.floor(lat.length * 0.95)]}ms${RESET}`);
  }
  console.log(`${DIM}ใช้ cache ${cachedN}/${results.length} เคส${RESET}`);

  // ── เทียบ baseline ──
  if (SAVE) {
    writeFileSync(BASELINE, JSON.stringify(summary, null, 2), 'utf8');
    console.log(`\n${GREEN}บันทึก baseline แล้ว${RESET} → ${BASELINE}`);
  } else if (existsSync(BASELINE)) {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
    console.log(`\n${BOLD}เทียบกับ baseline${RESET} ${DIM}(${base.variant} · ${base.generated_at?.slice(0, 16)})${RESET}`);
    // corpus ดูด "ข้อความล่าสุด N เคส" ⇒ ชุดเลื่อนเองทุกวันที่มีแชทใหม่เข้ามา
    // เทียบข้ามชุดแล้วส่วนต่างจะมาจากเคสที่เปลี่ยนไป ไม่ใช่จาก prompt ที่แก้ — ต้องฟ้อง
    if (base.corpus_generated_at && base.corpus_generated_at !== corpus.generated_at) {
      console.log(`   ${RED}⚠ corpus คนละชุดกับตอนบันทึก baseline${RESET} (baseline ใช้ ${base.corpus_generated_at?.slice(0, 16)} · ตอนนี้ ${corpus.generated_at?.slice(0, 16)})`);
      console.log(`   ${DIM}ส่วนต่างข้างล่างอ่านเป็น "ผลของการแก้ prompt" ไม่ได้ — สร้าง baseline ใหม่ด้วย --save ก่อน${RESET}`);
    }
    const rows: [string, number, number][] = [
      ['A intent',   summary.A.intent_ok,   base.A.intent_ok],
      ['A ลูกค้า',    summary.A.customer_ok, base.A.customer_ok],
      ['A รายการ',    summary.A.items_ok,    base.A.items_ok],
      ['A ส่วนลด',    summary.A.discount_ok, base.A.discount_ok],
      ['B ได้ใบเพิ่ม', summary.B.became_quotation, base.B.became_quotation],
      ['C ไม่หลุด',   summary.C.intent_ok,   base.C.intent_ok],
    ];
    for (const [label, now, was] of rows) {
      const d = now - was;
      const mark = d === 0 ? `${DIM}  =${RESET}` : d > 0 ? `${GREEN}+${d}${RESET}` : `${RED}${d}${RESET}`;
      console.log(`   ${label.padEnd(12)} ${String(was).padStart(4)} → ${String(now).padStart(4)}  ${mark}`);
    }
    // เคสที่เปลี่ยนคำตอบ — ตัวเลขรวมเท่ากันไม่ได้แปลว่าไม่มีอะไรเปลี่ยน
    const baseById = new Map<string, any>((base.per_case ?? []).map((p: any) => [p.id, p]));
    const flips = summary.per_case.filter(p => {
      const b = baseById.get(p.id);
      return b && (b.intent !== p.intent || b.items_ok !== p.items_ok);
    });
    console.log(`   ${DIM}เคสที่คำตอบเปลี่ยน ${flips.length} เคส${RESET}`);
    if (VERBOSE) for (const f of flips.slice(0, 30)) {
      const b = baseById.get(f.id);
      console.log(`     ${f.id}: intent ${b.intent}→${f.intent} · items ${b.items_ok}→${f.items_ok}`);
    }
  }
  const out = `${DIR}/extraction_result_${VARIANT || 'production'}.json`;
  writeFileSync(out, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`${DIM}ผลเต็มอยู่ที่ ${out}${RESET}`);
}

main().catch(e => { console.error(e); process.exit(1); });
