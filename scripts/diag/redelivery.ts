/**
 * ด่านตรวจ: กติกาการจัดการ event ที่ LINE ส่งซ้ำ
 *
 * ตอบคำถามที่ทำให้เรื่องนี้พลาดมาแล้วสองรอบ:
 *   1. ของซ้ำที่ตอบไปแล้ว ต้องไม่ถูกแตะซ้ำ (ของเดิมถูกข้อนี้อยู่แล้ว)
 *   2. **ของที่รอบแรกไม่เคยมาถึง ต้องไม่ถูกทิ้งเงียบ** (ของเดิมพลาดข้อนี้ ⇒ ใบ 4ae3ef39 ค้างเป็นร่าง)
 *   3. ห้ามมีทางไหนที่ "ทำงานให้เงียบ ๆ" — เจ้าของสั่งห้ามไว้ 2026-09-23
 *
 * ⚠️ ด่านนี้ **ไม่เขียนฐานข้อมูลเลย** รันบน prod ได้ · ข้อ 1–3 เป็นฟังก์ชันบริสุทธิ์
 *    ข้อ 4–6 อ่านซอร์สมาเทียบ · ข้อ 7 เป็น SELECT อย่างเดียว และข้ามเองถ้าต่อฐานไม่ได้
 *
 * ที่มา: docs/line-webhook-redelivery.md
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decideRedelivery, lostCommandMessage, type RedeliverySituation } from '../../services/redeliveryPolicy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failed = 0;
function ok(n: number, msg: string) { console.log(`  ✅ ${n}. ${msg}`); }
function bad(n: number, msg: string) { failed++; console.error(`  ❌ ${n}. ${msg}`); }
function check(n: number, cond: boolean, pass: string, fail: string) { cond ? ok(n, pass) : bad(n, fail); }

const sit = (o: Partial<RedeliverySituation>): RedeliverySituation =>
  ({ known: true, isFirstSight: false, previousOutcome: null, ...o });

console.log('\n🔁 ด่านตรวจ: event ที่ LINE ส่งซ้ำ\n');

// ── 1. ตารางการตัดสินใจครบทุกช่อง ─────────────────────────────────────────────
{
  const cases: Array<[string, RedeliverySituation, 'skip' | 'warn']> = [
    ['รอบแรกตอบไปแล้ว → ทิ้งเงียบ',              sit({ previousOutcome: 'replied' }),            'skip'],
    ['รอบแรกไม่เคยมาถึง → แจ้งเซลส์',            sit({ isFirstSight: true }),                    'warn'],
    ['รอบแรกหมดเวลา → แจ้งเซลส์',                sit({ previousOutcome: 'timeout' }),            'warn'],
    ['รอบแรกพัง → แจ้งเซลส์',                    sit({ previousOutcome: 'failed' }),             'warn'],
    ['รอบแรกถูกทิ้งเพราะคิวตัน → แจ้งเซลส์',      sit({ previousOutcome: 'dropped' }),            'warn'],
    ['รอบแรกยังไม่มีผล → แจ้งเซลส์',              sit({ previousOutcome: null }),                 'warn'],
    ['ถามฐานไม่ได้ → ทิ้งไว้ก่อน ไม่เดา',         sit({ known: false, isFirstSight: true }),      'skip'],
  ];
  const wrong = cases.filter(([, s, want]) => decideRedelivery(s).action !== want);
  check(1, wrong.length === 0,
    `ตารางการตัดสินใจถูกครบ ${cases.length}/${cases.length} ช่อง`,
    `ตัดสินผิด ${wrong.length} ช่อง: ${wrong.map(([n]) => n).join(' · ')}`);
}

// ── 2. ไม่มีทางออก "ทำงานให้เงียบ ๆ" ──────────────────────────────────────────
{
  const actions = new Set<string>();
  for (const known of [true, false])
    for (const first of [true, false])
      for (const prev of ['replied', 'timeout', 'dropped', 'failed', null] as const)
        actions.add(decideRedelivery({ known, isFirstSight: first, previousOutcome: prev }).action);
  check(2, actions.size === 2 && actions.has('skip') && actions.has('warn'),
    'ทางออกมีแค่ skip กับ warn — ไม่มีช่องให้ยืนยันใบเงียบ ๆ',
    `พบทางออกเกินที่อนุญาต: ${[...actions].join(', ')}`);
}

// ── 3. ข้อความต้องบอกสถานะ ไม่ใช่แค่ "ลองใหม่" ────────────────────────────────
{
  const confirm = lostCommandMessage({ type: 'postback', postback: { data: 'action=confirm&id=abc' } });
  const other   = lostCommandMessage({ type: 'postback', postback: { data: 'action=select_company&q=x' } });
  const text    = lostCommandMessage({ type: 'message', message: { type: 'text', text: 'ขอราคา' } });
  const distinct = new Set([confirm, other, text]).size === 3;
  check(3, confirm.includes('ใบยังไม่ถูกยืนยัน') && distinct,
    'ข้อความของปุ่มยืนยันระบุ "ใบยังไม่ถูกยืนยัน" และแยกจากอีกสองแบบ',
    `ข้อความไม่ผ่าน — confirm="${confirm}" · แยกกันจริง=${distinct}`);
}

// ── 4. เส้น redelivery ต้องไม่แตะคิวประมวลผล ─────────────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'index.ts'), 'utf8');
  const fn = src.slice(src.indexOf('async function handleRedelivery'), src.indexOf('app.post(\'/callback\''));
  const forbidden = ['webhookQueue.push', 'handleEvent(', 'createChatCompletion', 'confirmQuotation'];
  const hit = forbidden.filter(f => fn.includes(f));
  check(4, fn.length > 0 && hit.length === 0,
    'handleRedelivery ไม่เรียกคิว / handleEvent / LLM / การยืนยันใบ เลยสักตัว',
    `handleRedelivery เรียกสิ่งที่ห้าม: ${hit.join(', ')}`);
}

// ── 5. pushMessage ต้องเป็น 0 จุดทั้งรีโป ────────────────────────────────────
{
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'frontend' || e.name === 'public') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(ROOT);
  const hits = files.filter(f => /\.pushMessage\s*\(/.test(fs.readFileSync(f, 'utf8')));
  check(5, hits.length === 0,
    `pushMessage = 0 จุด (ตรวจ ${files.length} ไฟล์)`,
    `พบ pushMessage ใน: ${hits.map(f => path.relative(ROOT, f)).join(', ')}`);
}

// ── 6. โค้ดกับ migration ต้องพูดถึงคอลัมน์ชุดเดียวกัน ────────────────────────
{
  const sql = fs.readFileSync(path.join(ROOT, 'migrations/changes/2026-09-23_02_webhook_events.sql'), 'utf8');
  const repo = fs.readFileSync(path.join(ROOT, 'db/webhookEventsRepo.ts'), 'utf8');
  const needed = ['webhook_event_id', 'first_seen_at', 'last_seen_at', 'delivery_count', 'event_type',
    'message_type', 'postback_data', 'line_user_id', 'source_type', 'event_at', 'first_delay_ms',
    'last_delay_ms', 'reply_token', 'request_id', 'handled_at', 'outcome', 'redelivery_action', 'note'];
  const missingInSql  = needed.filter(c => !sql.includes(c));
  const usedButNotDeclared = needed.filter(c => repo.includes(c) && !sql.includes(c));
  check(6, missingInSql.length === 0 && usedButNotDeclared.length === 0,
    `คอลัมน์ที่โค้ดใช้มีครบใน migration ทั้ง ${needed.length} ช่อง`,
    `คอลัมน์หายจาก migration: ${[...new Set([...missingInSql, ...usedButNotDeclared])].join(', ')}`);
}

// ── 7. ตารางจริง (SELECT อย่างเดียว · ข้ามเองถ้าต่อฐานไม่ได้) ────────────────
{
  const n = 7;
  try {
    const { pool } = await import('../../config/db.js');
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'webhook_events'`
    );
    if (rows.length === 0) {
      console.log(`  ⏭️  ${n}. ยังไม่ได้รัน migration บนฐานนี้ — ข้าม (รันก่อน deploy ได้ ไม่บังคับลำดับ)`);
    } else {
      const have = new Set(rows.map((r: any) => r.column_name));
      const miss = ['webhook_event_id', 'delivery_count', 'outcome', 'redelivery_action', 'postback_data']
        .filter(c => !have.has(c));
      check(n, miss.length === 0,
        `ตาราง webhook_events บนฐานจริงมีครบ (${have.size} คอลัมน์)`,
        `ตารางจริงขาดคอลัมน์: ${miss.join(', ')}`);
    }
    await pool.end();
  } catch (e: any) {
    console.log(`  ⏭️  ${n}. ต่อฐานไม่ได้ — ข้าม (${e?.message || e})`);
  }
}

console.log(failed === 0 ? '\n✅ ผ่านทั้งหมด\n' : `\n❌ ไม่ผ่าน ${failed} ข้อ\n`);
process.exit(failed === 0 ? 0 : 1);
