import { AsyncLocalStorage } from 'async_hooks';
import * as line from '@line/bot-sdk';
import * as dotenv from 'dotenv';
import { OpenAI } from 'openai';

dotenv.config();

const hasDeepSeekKey = !!process.env.DEEPSEEK_API_KEY;

/**
 * เพดานเวลาของ LLM — จุดเดียวที่คุมได้ทั้งระบบ (ทุกการเรียกผ่าน createChatCompletion ด้านล่าง)
 *
 * ของเดิมไม่ตั้งอะไรเลย ⇒ ใช้ default ของ SDK คือ timeout 600 วิ × ลองใหม่ 3 ครั้ง = 1,800 วิ
 * ต่อ 1 การเรียก ซ้อนกับ retry ระดับแอปอีก 3 ชั้น ⇒ worst case ~90 นาที/ข้อความ ขณะกินสล็อตคิว
 * อยู่ตลอด ทั้งที่ replyToken ตายไปตั้งแต่นาทีแรก
 *
 * 20 วิมาจากของที่วัดจริง (scripts/diag/extractionReliability.ts, 150 call):
 * p50 1,787ms · p95 2,554ms · max 3,000ms ⇒ เผื่อไว้ราว 8 เท่าของ p95 แล้ว
 *
 * ⚠️ **`timeout` ของ SDK ไม่ครอบคลุมช่วงดาวน์โหลด body — มันนับถึงแค่ตอนได้ response header**
 * วัดเองกับ SDK/Node ตัวจริงในกล่องจริง 2026-09-23 (openai 6.38.0 · Node 22.23.2):
 *   · เซิร์ฟเวอร์เงียบไม่ตอบเลย         → ตัดที่ 40.5 วิ ถูกต้องตามที่ตั้ง (20 วิ × 2 ครั้ง)
 *   · เซิร์ฟเวอร์ตอบ header แล้วส่ง body ช้า 45 วิ → **สำเร็จที่ 45 วิ ไม่ตัดเลย**
 * ⇒ พอ DeepSeek เริ่มตอบแล้วพ่นคำตอบช้า การเรียก 1 ครั้งวิ่งได้ไม่จำกัดเวลา
 *   เกิดจริง 2026-09-23 14:34: 1 call กิน **93 วินาที แล้วสำเร็จ** (ไม่ใช่ error) งบ 48 วิหมดไปก่อน
 *   เซลส์จึงไม่ได้คำตอบเลย · ลายเซ็นในตาราง api_logs คือ `llm_ms=0 llm_calls=0 own_ms=48000`
 *   (ศูนย์เพราะตอนพิมพ์บรรทัดสรุป call ยังไม่กลับมา ไม่ใช่เพราะไม่ได้เรียก) · เกิดแบบนี้
 *   **3 ครั้งใน 44 วัน จาก 6,644 งาน** (19 ส.ค. · 15 ก.ย. · 23 ก.ย.) ทุกครั้งเซลส์เงียบสนิท
 *
 * ตัวที่ครอบได้จริงคือ `signal` ซึ่งคุมทั้ง request รวมช่วง body (วัดแล้ว: ตัดที่ 20.0 วิเป๊ะ)
 * จึงบังคับ `AbortSignal.timeout(LLM_HARD_CAP_MS)` ให้ทุกการเรียกใน createChatCompletion
 * ⇒ **ห้ามถอดออกแล้วหวังพึ่ง `timeout` ตัวเดียว** มันกันได้แค่ครึ่งเดียวของกรณีที่เกิดจริง
 * · gate: `npm run diag:llm-timeout` (จำลองทั้งสองแบบด้วยเซิร์ฟเวอร์ในเครื่อง ไม่ยิงเน็ตจริง)
 */
export const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: hasDeepSeekKey ? 'https://api.deepseek.com' : (process.env.OPENAI_BASE_URL || undefined),
  timeout: 20_000,
  maxRetries: 1,   // default 2 (= ยิงรวม 3 ครั้ง) → เหลือยิงรวม 2 ครั้ง
});

/**
 * เพดานแข็งต่อ "1 การเรียก createChatCompletion" นับรวม retry ภายในของ SDK และช่วงโหลด body
 *
 * 20 วิเท่ากับ `timeout` ข้างบนโดยตั้งใจ — ไม่ได้ตั้งเป็น 40 (= 20 × 2 ครั้ง) เพราะงบของทั้งงาน
 * มีแค่ 48 วิ ถ้าปล่อยให้ attempt เดียวกิน 40 วิ จะเหลือ 8 วิซึ่งชนเงื่อนไข "งบเหลือ < 8 วิ
 * ให้ข้าม attempt ถัดไป" ใน quoteExtraction พอดี ⇒ ไม่มีโอกาสลองใหม่เลย
 * ตัดที่ 20 วิแล้วเหลือ ~28 วิ ซึ่งพอสำหรับลองใหม่อีกรอบ (ปกติใช้ 2.5 วิ) = โอกาสได้คำตอบจริง
 */
export const LLM_HARD_CAP_MS = 20_000;

// โมเดลกลางของระบบ — ใช้ deepseek-v4-flash
// (deepseek-chat / deepseek-reasoner จะถูก deprecate 2026/07/24 — v4-flash คือตัวแทนถาวร)
export const LLM_MODEL = 'deepseek-v4-flash';

/**
 * เรียก chat completion ด้วยโมเดลกลาง + ปิด thinking mode เป็นค่าเริ่มต้น
 *
 * ทำไมต้องปิด thinking: deepseek-v4-flash default = thinking mode ซึ่งช้ามาก
 * (วัดจริง avg ~6.9s, p95 ~12.6s) ขณะที่ non-thinking เร็ว ~1.7s (p95 ~2.1s) โดย
 * ความถูกต้องเท่ากัน 100% — งานสกัด/จับคู่ของเราไม่ต้องใช้ reasoning
 *
 * ทำไม temperature = 0: งานทุกจุดของระบบนี้เป็น "เลือกคำตอบเดียวที่ถูก" (สกัด JSON / เลือกเบอร์ตัวเลือก)
 * ค่า default ของ DeepSeek คือ 1.0 = สุ่มตามความน่าจะเป็น ทำให้ตอนโมเดลลังเลจะได้คำตอบไม่เหมือนเดิมทุกครั้ง
 * (วัดจริงกับ prompt เลือกรุ่นสินค้า: temp 1.0 ตอบผิด 1/8 ครั้ง, temp 0 ถูก 8/8)
 * DeepSeek เองแนะนำ 0.0 สำหรับงานประเภท Coding/Math ซึ่งตรงกับงานเรา
 *
 * รับ params เหมือน openai.chat.completions.create ทุกอย่าง ยกเว้นไม่ต้องระบุ model/thinking/temperature
 * (ถ้าอยากเปิด thinking หรือเพิ่มความหลากหลายเฉพาะจุด ส่ง thinking/temperature มา override ได้)
 */
export async function createChatCompletion(params: Record<string, any>): Promise<any> {
  const timing = llmTimingStore.getStore();
  const t0 = timing ? Date.now() : 0;
  // `signal` ไม่ใช่ field ของ body — ต้องแยกออกไปเป็น request option ไม่งั้น SDK ส่งขึ้นไปกับ JSON
  const { signal: callerSignal, ...body } = params;
  // เพดานแข็งของเราเอง + ธงยกเลิกของผู้เรียก (ถ้ามี) — ตัวไหนมาก่อนตัดก่อน
  const capSignal = AbortSignal.timeout(LLM_HARD_CAP_MS);
  const signal = callerSignal ? AbortSignal.any([callerSignal, capSignal]) : capSignal;
  // เปิดช่วง busy ตอนเป็น call แรกที่ยังค้างอยู่ — call ที่ซ้อนเข้ามาระหว่างช่วงนี้ไม่เปิดช่วงใหม่
  // ⇒ เวลาที่ทับกันถูกนับครั้งเดียว (ดูเหตุผลที่ฟิลด์ busyMs)
  if (timing && timing.inFlight++ === 0) timing.busyStart = t0;
  try {
    const res: any = await openai.chat.completions.create({
      model: LLM_MODEL,
      thinking: { type: 'disabled' },
      temperature: 0,
      ...body,
    } as any, { signal });
    // G#2 — นับ token เฉพาะครั้งที่สำเร็จ ครั้งที่พังไม่มี usage ให้อ่านอยู่แล้ว
    // อ่าน prompt_cache_hit_tokens ก่อน (ฟิลด์ของ DeepSeek) แล้วค่อยตกไป
    // prompt_tokens_details.cached_tokens ซึ่งเป็นชื่อฝั่ง OpenAI — เผื่อวันที่สลับ baseURL กลับ
    if (timing && res?.usage) {
      timing.promptTokens += res.usage.prompt_tokens ?? 0;
      timing.cachedTokens += res.usage.prompt_cache_hit_tokens
        ?? res.usage.prompt_tokens_details?.cached_tokens ?? 0;
    }
    return res;
  } catch (err) {
    if (timing) timing.errors++;
    // บรรทัดนี้คือตัวที่ใช้วัดว่าเพดานทำงานกี่ครั้งจริง — ต้องแยกออกจาก error อื่นให้ชัด
    // ไม่งั้นมันจะไปปนกับ `[extraction] attempt N ล้มเหลว` ซึ่งรวมทุกสาเหตุไว้ด้วยกัน
    // นับด้วย: docker logs primus-chatbot-app-1 | grep -c '\[llm\] ⏱️'
    if (capSignal.aborted) {
      console.warn(`[llm] ⏱️ ตัดที่เพดาน ${LLM_HARD_CAP_MS}ms — ปลายทางตอบช้าเกินงบ (ผู้เรียกจะลองใหม่ถ้างบเหลือพอ)`);
    }
    throw err;
  } finally {
    // นับทั้งครั้งที่สำเร็จและครั้งที่พัง — ครั้งที่พังคือครั้งที่กินเวลานานที่สุด (timeout 20 วิ + retry)
    // ถ้าไม่นับ ตัวเลขจะสวยกว่าความจริงพอดีตอนที่ระบบมีปัญหา ซึ่งเป็นตอนที่ต้องการตัวเลขที่สุด
    if (timing) {
      const t1 = Date.now();
      timing.ms += t1 - t0;
      timing.calls++;
      // ปิดช่วง busy ตอน call สุดท้ายที่ค้างอยู่จบ ⇒ busyMs = union ของช่วงเวลา ไม่ใช่ผลรวม
      // call ที่ยังค้างตอนงานหมดเวลา (abort) จะไม่ถูกนับ — เหมือน ms ที่ไม่นับเช่นกัน
      if (--timing.inFlight === 0) timing.busyMs += t1 - timing.busyStart;
    }
  }
}

/**
 * ─── เวลาที่หมดไปกับ LLM ต่อ "1 งานของคิว webhook" (P4a) ─────────────────────────────
 *
 * ที่มา: api_logs บอกได้แค่ว่างาน /callback ใช้เวลา 17.8 วิ แต่บอกไม่ได้ว่าเป็น LLM / DB / LINE API
 * ซึ่งเป็นภาระที่หนักที่สุดของระบบ (45% ของเวลาเครื่องรวม) และกิน 37% ของงบ 48 วิที่ replyToken มีให้
 * ⇒ ยังตัดสินใจไม่ได้เลยว่าต้องไปแก้ prompt, ลดจำนวนการเรียก, หรือแก้โค้ดฝั่งเรา
 *
 * ทำไมต้องใช้ AsyncLocalStorage ไม่ใช่ตัวแปรนับรวมทั้งโมดูล: คิวรันพร้อมกันได้ 12 งาน
 * (KeyedTaskQueue(12) ใน index.ts) ตัวนับก้อนเดียวจะเอาเวลาของงานคนอื่นมาปนจนตัวเลขไร้ความหมาย
 * และไม่ร้อยพารามิเตอร์ผ่าน handleEvent เพราะจุดเรียก createChatCompletion กระจายอยู่ 4 ที่ใน 3 ไฟล์
 *
 * เฟสนี้ยังไม่แตะ schema ของ api_logs โดยตั้งใจ — ออกทาง console.log ของ [queue] ก่อน
 * ให้ข้อมูลจริงตอบว่าคุ้มไหมที่จะเพิ่มคอลัมน์ (P4b)
 */
export interface LlmTiming {
  /** เวลารวมที่รออยู่ใน createChatCompletion (รวมครั้งที่พัง) */
  ms: number;
  calls: number;
  errors: number;
  /**
   * เวลาตามนาฬิกาจริงที่ "มี LLM ค้างอยู่อย่างน้อย 1 call" — ช่วงที่ยิงซ้อนกันนับครั้งเดียว
   *
   * ทำไมต้องมีคู่กับ ms: ms เป็นผลรวมของทุก call ⇒ ตอนยิงขนาน (Promise.all) มันโตเกินเวลาจริง
   * ที่ผ่านไปได้ ทำให้ own_ms = processed - ms ติดลบ (เจอจริงใน api_logs 1 ใน 72 แถว: -1,996ms)
   * ตัวนี้ไม่มีทางเกินเวลาที่ผ่านไปจริงตามนิยาม ⇒ ใช้เป็นตัวลบของ own_ms ได้ตรง ๆ
   *
   * เก็บ ms ไว้เหมือนเดิมเพราะตอบคนละคำถาม: ms/calls = "เฉลี่ยต่อ call นานแค่ไหน" (ไปแก้ prompt)
   * ส่วน busyMs = "งานนี้เสียเวลาไปกับการรอ LLM จริง ๆ เท่าไร" (ไปเทียบกับงานฝั่งเรา)
   */
  busyMs: number;
  /**
   * G#2 — prompt token รวมทุก call และส่วนที่ DeepSeek คืนมาจากแคช
   *
   * แคชเป็นของฝั่ง DeepSeek เอง เข้าเมื่อ prefix ตรงกันเป๊ะและยาวพอ (วัดจริง 2026-09-04:
   * prompt 2,129 token · call แรก hit 0 · call ที่สอง prefix เดิม hit 2,048 = 96.2%)
   * ⇒ cached/prompt ต่ำแปลว่า prompt ของเราเปลี่ยนหัวทุกครั้ง มีของที่ควรย้ายไปท้าย prompt
   *
   * นับเฉพาะครั้งที่สำเร็จ ต่างจาก ms/calls ที่นับครั้งที่พังด้วย — ครั้งที่พังไม่มี usage
   */
  promptTokens: number;
  cachedTokens: number;
  /** ใช้ภายใน createChatCompletion เท่านั้น — ตัวนับ call ที่ยังไม่จบ / เวลาเริ่มช่วง busy ปัจจุบัน */
  inFlight: number;
  busyStart: number;
}

const llmTimingStore = new AsyncLocalStorage<LlmTiming>();

export function newLlmTiming(): LlmTiming {
  return { ms: 0, calls: 0, errors: 0, busyMs: 0, promptTokens: 0, cachedTokens: 0, inFlight: 0, busyStart: 0 };
}

/**
 * รัน fn โดยให้ทุก createChatCompletion ที่เกิดข้างในสะสมเวลาลง store ที่ผู้เรียกถือไว้เอง
 *
 * ผู้เรียกเป็นเจ้าของ object เพื่อให้บล็อก finally อ่านค่าได้แม้ fn จะโยน error ออกมา
 * นอกบริบทนี้ getStore() คืน undefined แล้วทุกอย่างทำงานเหมือนเดิม — ไม่มีใครพังเพราะไม่ได้ห่อ
 */
export function withLlmTiming<T>(store: LlmTiming, fn: () => Promise<T>): Promise<T> {
  return llmTimingStore.run(store, fn);
}

export const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

export const lineClient = line.LineBotClient.fromChannelAccessToken({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});
