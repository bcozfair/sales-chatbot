/**
 * npm run diag:llm-circuit — ด่านของตัวตัดเร็ว LLM + ปุ่ม "ลองอีกครั้ง" ตอน AI ขัดข้อง (2026-10-08)
 *
 * คำถามที่ด่านนี้ตอบ: **"AI ล่มต่อเนื่องแล้วคนถัดไปไม่ต้องรอ 40 วิ และปุ่มลองใหม่ไม่สร้างร่างใบซ้ำ"**
 *
 *   1. สถานะของ createLlmCircuit ด้วยนาฬิกาจำลอง (นับ · เปิด · ยืด · หมดเวลา · สำเร็จล้าง · window)
 *   2. เล่นซ้ำเหตุการณ์จริง 2026-10-08 09:14–09:16 (เวลาจาก docker logs) — ข้อความที่ 3–5 ต้องล้มเร็ว
 *   3. pickRetryableText — ส่วนตัดสินของปุ่ม (ล่าสุด + ตอบด้วยข้อความล้ม เท่านั้น)
 *   4. createLlmOutageRetryFlex — ข้อจำกัดของ LINE (label ≤ 20 · data ≤ 300 · altText ≤ 400) + mid ไป-กลับ
 *   5. อ่านซอร์ส — จุดต่อสายที่ด่านข้อ 1–4 มองไม่เห็น
 *
 * ── ผลข้างเคียง ── ไม่แตะฐาน (import repositories แค่ฟังก์ชันบริสุทธิ์ · pg ไม่ต่อจนกว่าจะ query)
 * ไม่ยิงเน็ต · ไม่ต้องรอเวลาจริง ⇒ อยู่กลุ่ม "ไม่แตะ DB เลย" · รันบน PMSV ได้
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['OPENAI_API_KEY', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET']) {
  if (!process.env[k]) process.env[k] = 'diag-placeholder';
}
const { createLlmCircuit, isLlmUnavailable, LlmUnavailableError, CIRCUIT_TRIP_COUNT, CIRCUIT_WINDOW_MS, CIRCUIT_OPEN_MS } =
  await import('../../config/llmCircuit.js');
const { LLM_HARD_CAP_MS } = await import('../../config/clients.js');
const { pickRetryableText } = await import('../../db/repositories.js');
const { createLlmOutageRetryFlex } = await import('../../utils/flexTemplates.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ── 1. สถานะ ────────────────────────────────────────────────────────────────
console.log('\n1. สถานะของตัวตัดเร็ว (นาฬิกาจำลอง)');
{
  let t = 0;
  const c = createLlmCircuit({ now: () => t });
  check('1a. เริ่มต้นเรียกได้', c.openRemainingMs() === 0);
  const r1 = c.recordCapHit(); t += 1_000; const r2 = c.recordCapHit();
  check(`1b. ครั้งที่ 1–${CIRCUIT_TRIP_COUNT - 1} แค่นับ ยังเรียกได้`, r1 === 'counted' && r2 === 'counted' && c.openRemainingMs() === 0);
  t += 1_000;
  check(`1c. ครั้งที่ ${CIRCUIT_TRIP_COUNT} เปิดวงจร ${CIRCUIT_OPEN_MS / 1000} วิ`, c.recordCapHit() === 'opened' && c.openRemainingMs() === CIRCUIT_OPEN_MS);
  t += 10_000;
  check('1d. call ที่ค้างมาโดนตัดระหว่างงด = ยืดช่วงงด', c.recordCapHit() === 'extended' && c.openRemainingMs() === CIRCUIT_OPEN_MS);
  t += CIRCUIT_OPEN_MS;
  check('1e. หมดช่วงงดแล้วเรียกได้', c.openRemainingMs() === 0);
  check('1f. โดนตัดอีกครั้งตอนครั้งเก่ายังอยู่ใน window = งดต่อทันที', c.recordCapHit() === 'opened');
  c.recordSuccess();
  check('1g. สำเร็จหนึ่งครั้ง = ล้างทั้งหมด', c.openRemainingMs() === 0 && c.recordCapHit() === 'counted');

  let u = 0;
  const w = createLlmCircuit({ now: () => u });
  w.recordCapHit(); u += CIRCUIT_WINDOW_MS / 2; w.recordCapHit(); u += CIRCUIT_WINDOW_MS / 2 + 1;
  check(`1h. ครั้งที่เก่ากว่า ${CIRCUIT_WINDOW_MS / 1000} วิไม่นับ (ช้าห่าง ๆ ไม่ใช่ล่ม)`, w.recordCapHit() === 'counted' && w.openRemainingMs() === 0);

  const e = new LlmUnavailableError(12_345);
  check('1i. LlmUnavailableError แยกได้ด้วย isLlmUnavailable · error อื่นไม่ใช่',
    isLlmUnavailable(e) && !isLlmUnavailable(new Error('x')) && !isLlmUnavailable(null) && e.retryAfterMs === 12_345);
}

// ── 2. เหตุการณ์จริง ─────────────────────────────────────────────────────────
// เวลา UTC จาก `docker logs primus-chatbot-app-1` 2026-10-08 · ข้อความ i เริ่มที่ (attempt 1 ล้ม) − เพดาน
console.log('\n2. เล่นซ้ำเหตุการณ์ 2026-10-08 09:14–09:16 (5 ข้อความ · 2 คน)');
{
  const at = (hms: string) => Date.parse(`2026-10-08T${hms}Z`);
  const real = [
    { a1: '02:14:29.292', a2: '02:14:49.294' },
    { a1: '02:14:32.766', a2: '02:14:52.767' },
    { a1: '02:15:22.918', a2: '02:15:42.921' },
    { a1: '02:15:39.378', a2: '02:15:59.380' },
    { a1: '02:16:21.817', a2: '02:16:41.817' },
  ].map(r => ({ start: at(r.a1) - LLM_HARD_CAP_MS, oldTook: at(r.a2) - at(r.a1) + LLM_HARD_CAP_MS }));

  // จำลอง: ปลายทางเงียบตลอดช่วงนี้ ⇒ ทุก call ที่ยิงจริงโดนตัดที่เพดาน · ข้อความละ ≤ 2 attempt
  // event: [เวลา, ชนิด] เรียงเวลา — 'start' = ข้อความเข้ามาหรือ attempt ถัดไป · 'cap' = call ที่ยิงไปโดนตัด
  let now = 0;
  const c = createLlmCircuit({ now: () => now });
  type Ev = { t: number; kind: 'try' | 'cap'; msg: number; attempt: number };
  const q: Ev[] = real.map((r, i) => ({ t: r.start, kind: 'try' as const, msg: i, attempt: 1 }));
  const took: number[] = [];
  while (q.length) {
    q.sort((x, y) => x.t - y.t);
    const ev = q.shift()!;
    now = ev.t;
    if (ev.kind === 'try') {
      if (c.openRemainingMs() > 0) { took[ev.msg] = now - real[ev.msg].start; continue; }      // ล้มทันที (quoteExtraction หยุดลอง)
      q.push({ t: now + LLM_HARD_CAP_MS, kind: 'cap', msg: ev.msg, attempt: ev.attempt });
    } else {
      c.recordCapHit();
      if (ev.attempt < 2) q.push({ t: now, kind: 'try', msg: ev.msg, attempt: 2 });
      else took[ev.msg] = now - real[ev.msg].start;
    }
  }
  real.forEach((r, i) => console.log(`     ข้อความ ${i + 1}: เดิม ${(r.oldTook / 1000).toFixed(1)} วิ → ใหม่ ${(took[i] / 1000).toFixed(1)} วิ`));
  check('2a. ข้อความ 1–2 (ก่อนรู้ว่าล่ม) เท่าเดิม ~40 วิ', took[0] === 2 * LLM_HARD_CAP_MS && took[1] === 2 * LLM_HARD_CAP_MS);
  check('2b. ข้อความ 3–4 ล้มทันที (< 1 วิ)', took[2] < 1_000 && took[3] < 1_000);
  check('2c. ข้อความ 5 (หลังหมดช่วงงด) ลองจริง 1 ครั้ง แล้วงดต่อ — ไม่ต้องรอครบ 2 attempt', took[4] === LLM_HARD_CAP_MS);
}

// ── 3. ปุ่มลองอีกครั้ง: ส่วนตัดสิน ─────────────────────────────────────────────
console.log('\n3. pickRetryableText');
{
  const FAIL = 'ขออภัยระบบ AI ขัดข้องชั่วคราว กรุณารอสักครู่ แล้วลองใหม่อีกครั้งนะครับ 🙏';
  const row = { message_id: '600123', content: 'เสนอราคา\nบริษัท ก', reply_content: FAIL };
  check('3a. ข้อความล่าสุด + ตอบด้วยข้อความล้ม = รันได้', pickRetryableText(row, '600123', FAIL) === row.content);
  check('3b. ข้อความล่าสุดเป็นข้อความอื่น (ทำรายการแล้ว/พิมพ์ต่อแล้ว) = ไม่รัน', pickRetryableText({ ...row, message_id: 'retry_X' }, '600123', FAIL) === null);
  check('3c. ล่าสุดแต่บอทตอบอย่างอื่น = ไม่รัน', pickRetryableText({ ...row, reply_content: '📝 ร่างใบเสนอราคา' }, '600123', FAIL) === null);
  check('3d. ไม่มีแถว / mid ว่าง / เนื้อว่าง = ไม่รัน',
    pickRetryableText(undefined, '600123', FAIL) === null
    && pickRetryableText({ ...row, message_id: '' }, '', FAIL) === null
    && pickRetryableText({ ...row, content: '  ' }, '600123', FAIL) === null);
}

// ── 4. Flex ─────────────────────────────────────────────────────────────────
console.log('\n4. createLlmOutageRetryFlex');
{
  const text = 'ขออภัยระบบ AI ขัดข้องชั่วคราว กรุณารอสักครู่ แล้วลองใหม่อีกครั้งนะครับ 🙏';
  const mid = 'retry_01JABCDEFGHJKMNPQRSTVWXYZ';
  const f: any = createLlmOutageRetryFlex(text, mid);
  const btn = f.contents.body.contents.find((x: any) => x.type === 'button');
  const back = new URLSearchParams(btn.action.data);
  check('4a. type flex · altText = ข้อความ · ≤ 400', f.type === 'flex' && f.altText === text && [...f.altText].length <= 400);
  check('4b. ปุ่ม postback · label ≤ 20 ตัว · data ≤ 300', btn.action.type === 'postback'
    && [...btn.action.label].length <= 20 && btn.action.data.length <= 300, `label ${[...btn.action.label].length} · data ${btn.action.data.length}`);
  check('4c. data ถอดกลับได้ action=retry_text + mid เดิม', back.get('action') === 'retry_text' && back.get('mid') === mid);
}

// ── 5. ซอร์ส ────────────────────────────────────────────────────────────────
console.log('\n5. จุดต่อสาย');
{
  const cl = read('config/clients.ts');
  const fn = /export async function createChatCompletion\([\s\S]*?\n}\n/.exec(cl)?.[0] ?? '';
  const gate = fn.indexOf('llmCircuit.openRemainingMs()');
  const create = fn.indexOf('openai.chat.completions.create(');
  check('5a. createChatCompletion ถามตัวตัดก่อนยิงจริง', gate > 0 && create > gate);
  check('5b. สำเร็จ → recordSuccess · โดนเพดานตัด → recordCapHit (เฉพาะใต้ capSignal.aborted)',
    /completions\.create\([\s\S]*?\);\s*\n\s*llmCircuit\.recordSuccess\(\);/.test(fn)
    && /if \(capSignal\.aborted\) \{[\s\S]*?llmCircuit\.recordCapHit\(\)/.test(fn)
    && (fn.match(/recordCapHit\(/g) ?? []).length === 1);
  const qe = read('services/quoteExtraction.ts');
  check('5c. quoteExtraction หยุดลองเมื่อเจอ LlmUnavailable', /if \(isLlmUnavailable\(e\)\) break;/.test(qe));
  const lh = read('handlers/lineHandler.ts');
  check('5d. lineHandler ใช้ LLM_OUTAGE_REPLY ตัวเดียวกันทั้งตอนตอบและตอนตรวจปุ่ม',
    /createLlmOutageRetryFlex\(LLM_OUTAGE_REPLY, messageId\)/.test(lh)
    && /getRetryableFailedText\(userId, mid, LLM_OUTAGE_REPLY\)/.test(lh)
    && /botReplyText = LLM_OUTAGE_REPLY;/.test(lh));
}

console.log(failed === 0 ? '\n✅ ผ่านทั้งหมด\n' : `\n❌ ไม่ผ่าน ${failed} ข้อ\n`);
process.exit(failed === 0 ? 0 : 1);
