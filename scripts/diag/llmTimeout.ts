/**
 * ด่านตรวจ: เพดานเวลาของการเรียก LLM ต้องครอบ "ช่วงโหลดคำตอบ" ด้วย
 *
 * ## ทำไมต้องมีด่านนี้
 *
 * `timeout` ของ OpenAI SDK **นับถึงแค่ตอนได้ response header** ไม่ครอบช่วงดาวน์โหลด body
 * ⇒ ปลายทางที่ตอบ header เร็วแล้วพ่นคำตอบช้า จะวิ่งได้ไม่จำกัดเวลาโดยไม่มีอะไรฟ้อง
 * เกิดจริง 2026-09-23 14:34 — 1 call กิน **93 วินาทีแล้วสำเร็จ** (ไม่ใช่ error) งบ 48 วิหมดไปก่อน
 * เซลส์จึงไม่ได้คำตอบเลย · แบบนี้เกิด 3 ครั้งใน 44 วัน จาก 6,644 งาน
 *
 * ด่านนี้จำลองทั้งสองแบบด้วยเซิร์ฟเวอร์ใน localhost **ไม่ยิงเน็ตจริง ไม่ใช้โควตา ไม่แตะฐาน**
 * จึงรันบน prod ได้ · ใช้เวลาราว 25 วินาที (ต้องรอเพดานตัดจริง ๆ ถึงจะพิสูจน์ได้)
 *
 * ⚠️ ถ้าด่านนี้ล้มที่ข้อ 2 แปลว่ามีคนถอด `signal` ออกจาก `createChatCompletion`
 *    แล้วไปหวังพึ่ง `timeout` ตัวเดียว ซึ่งกันได้แค่ครึ่งเดียวของกรณีที่เกิดจริง
 */
import http from 'http';
import { OpenAI } from 'openai';

// config/clients.ts สร้าง client ของ OpenAI และ LINE ตั้งแต่โหลดโมดูล ⇒ ต้องมีคีย์ก่อน import
// ด่านนี้ไม่ยิงเน็ตจริงสักครั้ง คีย์หลอกจึงพอ และไม่บังคับให้ต้องมี .env ตอนรัน
// เติมเฉพาะตัวที่ยังว่าง ⇒ รันบนเครื่องที่มี .env จริงก็ใช้ค่าจริง ไม่ถูกกลบ
for (const k of ['OPENAI_API_KEY', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET']) {
  if (k === 'OPENAI_API_KEY' && process.env.DEEPSEEK_API_KEY) continue;
  if (!process.env[k]) process.env[k] = 'diag-placeholder';
}
const { LLM_HARD_CAP_MS } = await import('../../config/clients.js');

let failed = 0;
const ok = (n: number, m: string) => console.log(`  ✅ ${n}. ${m}`);
const bad = (n: number, m: string) => { failed++; console.error(`  ❌ ${n}. ${m}`); };

const REPLY = JSON.stringify({
  id: 'x', object: 'chat.completion', created: 0, model: 'x',
  choices: [{ index: 0, message: { role: 'assistant', content: '{"intent":"UNCLEAR"}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

/** เซิร์ฟเวอร์ที่ตอบ header ทันที แล้วหยอด body ทีละไบต์จนครบใน `spreadMs` */
function slowBodyServer(spreadMs: number) {
  return http.createServer(async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(REPLY) });
    for (const ch of REPLY) {
      res.write(ch);
      await new Promise(r => setTimeout(r, spreadMs / REPLY.length));
    }
    res.end();
  });
}

async function listen(srv: http.Server): Promise<number> {
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  return (srv.address() as any).port;
}

console.log('\n⏱️  ด่านตรวจ: เพดานเวลาของการเรียก LLM\n');

// ── 1. ค่าคงที่ต้องอยู่ในช่วงที่ใช้งานได้จริง ────────────────────────────────
{
  // ต่ำกว่า 5 วิ = ตัดงานปกติทิ้ง (p95 ที่วัดได้ 2.55 วิ) · เกิน 40 วิ = เหลืองบไม่พอให้ลองใหม่
  // (งบทั้งงาน 48 วิ และ quoteExtraction ข้าม attempt ถัดไปเมื่อเหลือ < 8 วิ)
  const sane = LLM_HARD_CAP_MS >= 5_000 && LLM_HARD_CAP_MS <= 40_000;
  sane ? ok(1, `LLM_HARD_CAP_MS = ${LLM_HARD_CAP_MS}ms อยู่ในช่วงที่ใช้งานได้`)
       : bad(1, `LLM_HARD_CAP_MS = ${LLM_HARD_CAP_MS}ms หลุดช่วง 5,000–40,000`);
}

// ── 2. หัวใจของด่าน: body ช้าต้องถูกตัด ไม่ใช่ปล่อยให้สำเร็จ ─────────────────
{
  const spread = LLM_HARD_CAP_MS * 2;           // ช้ากว่าเพดานเท่าตัว
  const srv = slowBodyServer(spread);
  const port = await listen(srv);
  // ต้องสร้าง client ชี้เซิร์ฟเวอร์ปลอมเอง — ของจริงชี้ DeepSeek และ import ไปแล้ว
  // จึงทดสอบ "กติกา" ตัวเดียวกัน: body ช้า + signal เพดาน ⇒ ต้องโดนตัด
  const c = new OpenAI({ apiKey: 'test', baseURL: `http://127.0.0.1:${port}/v1`, timeout: LLM_HARD_CAP_MS, maxRetries: 1 });
  const t0 = Date.now();
  let outcome = '';
  try {
    await c.chat.completions.create(
      { model: 'x', messages: [{ role: 'user', content: 'hi' }] } as any,
      { signal: AbortSignal.timeout(LLM_HARD_CAP_MS) }
    );
    outcome = 'สำเร็จ';
  } catch {
    outcome = 'ถูกตัด';
  }
  const took = Date.now() - t0;
  srv.close();
  const inTime = outcome === 'ถูกตัด' && took < spread * 0.75;
  inTime ? ok(2, `body ช้า ${spread}ms ถูกตัดที่ ${(took / 1000).toFixed(1)} วิ (signal ครอบช่วงโหลด body จริง)`)
         : bad(2, `body ช้า ${spread}ms → ${outcome} ที่ ${(took / 1000).toFixed(1)} วิ — เพดานไม่ทำงาน`);
}

// ── 3. พิสูจน์ว่า `timeout` อย่างเดียวกันไม่ได้ (กันคนถอด signal ออกในอนาคต) ──
{
  const spread = LLM_HARD_CAP_MS * 2;
  const srv = slowBodyServer(spread);
  const port = await listen(srv);
  const c = new OpenAI({ apiKey: 'test', baseURL: `http://127.0.0.1:${port}/v1`, timeout: LLM_HARD_CAP_MS, maxRetries: 1 });
  const t0 = Date.now();
  let slipped = false;
  try {
    await c.chat.completions.create({ model: 'x', messages: [{ role: 'user', content: 'hi' }] } as any);
    slipped = true;                                  // ← หลุดเพดานได้จริง
  } catch { /* ถ้าวันหนึ่ง SDK แก้ให้ ก็ไม่ใช่เรื่องเสียหาย */ }
  const took = Date.now() - t0;
  srv.close();
  console.log(slipped
    ? `  ℹ️  3. ยืนยันช่องโหว่: ใช้ timeout อย่างเดียว body ช้าหลุดไปได้ถึง ${(took / 1000).toFixed(1)} วิ ⇒ signal ในข้อ 2 คือตัวที่กันจริง`
    : `  ℹ️  3. SDK รุ่นนี้ตัด body ช้าได้เองที่ ${(took / 1000).toFixed(1)} วิ — signal ยังต้องอยู่ (เป็นตัวกันของเราเอง ไม่ขึ้นกับรุ่น SDK)`);
}

// ── 4. โค้ดจริงต้องส่ง signal เข้า SDK ────────────────────────────────────────
{
  const fs = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const src = fs.readFileSync(path.join(root, 'config/clients.ts'), 'utf8');
  const has = /chat\.completions\.create\([\s\S]{0,400}?\{\s*signal\s*\}/.test(src)
    && src.includes('AbortSignal.timeout(LLM_HARD_CAP_MS)');
  has ? ok(4, 'createChatCompletion ส่ง signal ที่ผูกกับ LLM_HARD_CAP_MS เข้า SDK จริง')
      : bad(4, 'createChatCompletion ไม่ได้ส่ง signal เข้า SDK — ช่องโหว่ body ช้ากลับมาแล้ว');
}

console.log(failed === 0 ? '\n✅ ผ่านทั้งหมด\n' : `\n❌ ไม่ผ่าน ${failed} ข้อ\n`);
process.exit(failed === 0 ? 0 : 1);
