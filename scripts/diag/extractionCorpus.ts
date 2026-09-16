// ─────────────────────────────────────────────────────────────────────────────
//  extractionCorpus — ดูด "ข้อความจริงจากแชท + เฉลย" ออกมาเป็นชุดวัดชั้นสกัดคำสั่ง
//
//  ทำไมต้องมี: extractionCases.ts เป็นเคสที่เขียนด้วยมือ 22 เคส ซึ่งตอบได้แค่ว่า
//  "เคสที่เรานึกออกยังผ่านไหม" — ตอบไม่ได้ว่า "ถ้าแก้ prompt แล้วของจริงที่เซลส์พิมพ์
//  ทุกวันดีขึ้นหรือแย่ลง" ไฟล์นี้จึงดูดของจริงจาก `messages` มาทั้งสามกลุ่ม
//
//  เฉลยมาจากไหน — นี่คือส่วนที่ทำให้ตัวเลขเชื่อได้หรือเชื่อไม่ได้:
//    A-confirmed  ข้อความที่นำไปสู่ใบที่ **เซลส์กดยืนยันแล้ว** ⇒ customer_details /
//                 item_details ของใบนั้นคือเฉลยที่มีคนรับรองด้วยการออกใบจริง
//                 (join ด้วยเวลา: ใบถูกสร้าง "ก่อน" แถว messages เพราะแถว messages
//                  เขียนหลังตอบกลับเสร็จ — วัด 2026-09-16: 1,497/1,870 เคสอยู่ในช่วง -30..0 วิ)
//    B-missed     ข้อความที่มีเนื้อหาจริง (มีรุ่น/จำนวน/ชื่อลูกค้า) แต่ระบบตอบว่าไม่เข้าใจ
//                 ⇒ **ไม่มีเฉลยอัตโนมัติ** ต้องมีคนเติม ไฟล์นี้จึง mark `needs_review: true`
//                 ไว้ให้เจ้าของตัดสิน ห้ามนับเป็นคะแนนจนกว่าจะมีเฉลย
//    C-negative   ข้อความที่ "ไม่ควร" กลายเป็นใบเสนอราคา (ทักทาย · ขอฟอร์มเปล่า ·
//                 ถามทั่วไป) ⇒ เฉลยคือ intent ≠ QUOTATION — กลุ่มนี้คือตัวที่บอกว่า
//                 การผ่อนกฎทำให้บอทเริ่มเดาสุ่มหรือเปล่า **ขาดกลุ่มนี้ = วัดได้แต่ด้านที่ดีขึ้น**
//
//  เก็บ "ประวัติแชท ณ เวลานั้น" มาด้วย (10 ข้อความก่อนหน้าของ user เดียวกัน)
//  เพราะ production ใส่ประวัติ 15 นาทีเข้า prompt ⇒ ถ้า corpus ไม่มีประวัติ จะวัด
//  เคสกลุ่ม "เซลส์เติมทีละส่วน" ไม่ได้เลย ซึ่งเป็นกลุ่มใหญ่ที่สุดของ B
//
//  ผลข้างเคียง: ไม่มี — SELECT อย่างเดียว ไม่เรียก LLM ไม่เขียน DB
//
//  รัน:  tsx scripts/diag/extractionCorpus.ts [--limit-a 120] [--out data/eval/extraction_corpus.json]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pool } from '../../config/db.js';

const ARGV = process.argv.slice(2);
function argNum(name: string, fallback: number): number {
  const i = ARGV.indexOf(`--${name}`);
  if (i < 0 || !ARGV[i + 1]) return fallback;
  const v = Number(ARGV[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}
function argStr(name: string, fallback: string): string {
  const i = ARGV.indexOf(`--${name}`);
  return i < 0 || !ARGV[i + 1] ? fallback : ARGV[i + 1];
}

const LIMIT_A = argNum('limit-a', 120);
const LIMIT_C = argNum('limit-c', 40);
const OUT = argStr('out', 'data/eval/extraction_corpus.json');

const GREEN = '\x1b[32m', DIM = '\x1b[2m', BOLD = '\x1b[1m', YEL = '\x1b[33m', CYAN = '\x1b[36m', RESET = '\x1b[0m';

/** user_id จริงเป็น PII — corpus เก็บแค่ hash 8 ตัวไว้จัดกลุ่ม/ไล่ประวัติ ไม่เก็บตัวจริง */
function hashUser(u: string): string {
  return createHash('sha256').update(u || '').digest('hex').slice(0, 8);
}

export interface CorpusHistoryRow {
  content: string;
  reply_content: string | null;
  /** วินาทีก่อนหน้าข้อความหลัก — runner ใช้ตัดหน้าต่าง 15 นาทีเองโดยไม่ต้องพึ่งนาฬิกาจริง */
  seconds_before: number;
}

export interface CorpusItemTruth {
  model: string;
  quantity: number;
  price: number | null;
  discount_1: number;
  discount_2: number;
}

export interface CorpusTruth {
  intent: 'QUOTATION' | 'PRODUCT_INFO' | 'UNCLEAR' | null;
  customer_name?: string | null;
  customer_code?: string | null;
  contact_name?: string | null;
  items?: CorpusItemTruth[];
}

export interface CorpusEntry {
  id: string;
  group: 'A-confirmed' | 'B-missed' | 'C-negative';
  user_hash: string;
  created_at: string;
  message: string;
  history: CorpusHistoryRow[];
  truth: CorpusTruth;
  truth_source: 'confirmed_quotation' | 'current_behavior' | 'needs_review';
  needs_review: boolean;
  /**
   * สัดส่วนรุ่นในเฉลยที่ "หาเจอในข้อความจริง" (0–1) — เฉพาะกลุ่ม A
   *
   * ใบที่ยืนยันแล้วเป็นเฉลยที่ดีของ *ใบ* แต่ไม่ใช่ของ *การสกัด* เสมอไป เพราะเซลส์
   * ไปกดเลือกรุ่นจากปุ่มหรือแก้ใน LIFF ต่อได้ เจอจริง 2 ใน 120 เคส (2026-09-16):
   * เซลส์พิมพ์ `PMV25.01 220` แต่ใบออกมาเป็น `PMV12.00220` — ถ้านับเป็นคะแนน
   * ชั้นสกัดจะ "สอบตก" ทั้งที่มันสกัดตามที่พิมพ์มาถูกแล้ว
   * ⇒ alignment < 1 = ให้คะแนนเฉพาะรายการที่ตรงกับข้อความ · = 0 = ไม่ให้คะแนน items เลย
   */
  truth_alignment?: number;
  /** สิ่งที่ production ตอบกลับจริงในวันนั้น — ไว้เทียบว่าที่เปลี่ยนไปคือดีขึ้นหรือแย่ลง */
  observed_reply_head: string;
  note?: string;
}

/** ข้อความที่บอทตอบว่า "ไม่เข้าใจ" — ชุดเดียวกับที่ใช้จัดกลุ่มตอนสำรวจ 2026-09-16 */
const UNCLEAR_REPLY_SQL = `(
  reply_content LIKE '%สวัสดีครับ%' OR reply_content LIKE '%ไม่แน่ใจว่าต้องการ%'
  OR reply_content LIKE '%เช็คสต๊อก%' OR reply_content LIKE '%รบกวนพิมพ์ข้อมูลตามรูปแบบนี้%'
)`;

/** "ดูเหมือนคำสั่งซื้อจริง" — มีจำนวน/ส่วนลด หรือมีชื่อลูกค้า/รหัสลูกค้า */
const LOOKS_REAL_SQL = `(
  content ~* '(ลด ?[0-9]{1,2}|[0-9]+ ?(ตัว|ea|ชิ้น|อัน)|= ?[0-9])'
  OR content ~* '(บริษัท|บ\\.|หจก|บจก|คุณ|A[0-9/]{4,}|N/[0-9]{4,})'
)`;

/**
 * ข้อความที่ "ไม่ได้มาจากนิ้วเซลส์" — LIFF ยิงเข้าห้องแชทเองหลังกดบันทึกร่าง
 * (📝 บันทึกร่างใบเสนอราคาแล้ว (รหัส: <uuid>) · 💾 ร่างใบเสนอราคา (n รายการ))
 * เจอ 23 ใน 120 เคสแรกที่ดูดมา 2026-09-16 — ถ้าไม่กรอง corpus จะสอนว่า "ข้อความ
 * ที่ไม่มีรุ่นสินค้าเลยต้องออกใบให้ได้" ซึ่งเป็นเฉลยที่ผิดทั้งข้อ
 */
const HUMAN_TYPED_SQL = `(
  content !~ '\\(รหัส: [0-9a-f-]{30,}\\)'
  AND content NOT LIKE '📝%' AND content NOT LIKE '💾%'
)`;

/** normalize สำหรับเทียบรุ่น — ตัดช่องว่าง/ขีด/จุด แล้ว lower (ใช้ทั้งที่นี่และใน runner) */
export function normModel(s: string): string {
  return String(s || '').replace(/[\s\-_.]/g, '').toLowerCase();
}

async function fetchHistory(userId: string, before: string): Promise<CorpusHistoryRow[]> {
  const { rows } = await pool.query(
    `SELECT content, reply_content, created_at FROM messages
      WHERE user_id = $1 AND created_at < $2
      ORDER BY created_at DESC LIMIT 10`, [userId, before]);
  const baseMs = new Date(before).getTime();
  return rows.map((r: any) => ({
    content: r.content ?? '',
    reply_content: r.reply_content ?? null,
    seconds_before: Math.round((baseMs - new Date(r.created_at).getTime()) / 1000),
  }));
}

function headOf(s: string | null, n = 70): string {
  return (s || '').replace(/[\r\n]+/g, ' ').slice(0, n);
}

/** ── กลุ่ม A: ข้อความ → ใบที่ยืนยันแล้ว ────────────────────────────────────── */
async function buildGroupA(): Promise<CorpusEntry[]> {
  // เลือกเฉพาะข้อความที่ได้ "ร่างใบเสนอราคา" กลับมาทันที และมีใบที่ confirmed
  // เกิดขึ้นในช่วง -90..+10 วินาทีรอบแถวนั้น (ใบถูกสร้างก่อนแถว messages)
  //
  // ⚠️ จงใจ "ไม่" กรองเคสที่เซลส์ไปแก้ต่อใน LIFF ออก — กรองไม่ได้จริง เพราะการแก้
  //    ไม่ทิ้งร่องรอยที่แยกจากการยืนยันปกติ ⇒ ชดเชยด้วยเกณฑ์ตัดสินที่ยืดหยุ่นในตัว runner
  //    (เทียบ model แบบ normalize/contains · ไม่บังคับให้จำนวนรายการเท่ากันเป๊ะ)
  const { rows } = await pool.query(
    `SELECT m.id, m.user_id, m.content, m.reply_content, m.created_at,
            q.customer_details, q.item_details
       FROM messages m
       JOIN LATERAL (
         SELECT qq.customer_details, qq.item_details FROM quotations qq
          WHERE qq.user_id = m.user_id AND qq.status = 'confirmed'
            AND qq.created_at BETWEEN m.created_at - interval '90 seconds'
                                  AND m.created_at + interval '10 seconds'
          ORDER BY abs(EXTRACT(epoch FROM qq.created_at - m.created_at)) LIMIT 1
       ) q ON true
      WHERE m.type = 'text'
        AND m.reply_content LIKE '%ร่างใบเสนอราคา%'
        AND ${HUMAN_TYPED_SQL}
        AND jsonb_array_length(q.item_details) > 0
      ORDER BY m.created_at DESC
      LIMIT $1`, [LIMIT_A]);

  const out: CorpusEntry[] = [];
  for (const r of rows) {
    const cd = r.customer_details || {};
    const items: CorpusItemTruth[] = (r.item_details || [])
      .filter((it: any) => !it.is_optional)
      .map((it: any) => ({
        model: String(it.model ?? ''),
        quantity: Number(it.quantity) || 0,
        price: it.price === null || it.price === undefined ? null : Number(it.price),
        discount_1: Number(it.discount_1) || 0,
        discount_2: Number(it.discount_2) || 0,
      }));
    const msgNorm = normModel(r.content ?? '');
    const aligned = items.filter(it => it.model && msgNorm.includes(normModel(it.model).slice(0, 6)));
    out.push({
      id: `a-${r.id}`,
      group: 'A-confirmed',
      user_hash: hashUser(r.user_id),
      created_at: new Date(r.created_at).toISOString(),
      message: r.content ?? '',
      history: await fetchHistory(r.user_id, r.created_at),
      truth: {
        intent: 'QUOTATION',
        customer_name: cd.customer_name ?? null,
        customer_code: cd.customer_code ?? null,
        contact_name: cd.contact_name ?? null,
        items,
      },
      truth_source: 'confirmed_quotation',
      needs_review: false,
      truth_alignment: items.length ? aligned.length / items.length : 0,
      observed_reply_head: headOf(r.reply_content),
      note: aligned.length === items.length ? undefined
        : `เฉลยตรงกับข้อความ ${aligned.length}/${items.length} รายการ — ส่วนที่เหลือเซลส์น่าจะแก้ต่อหลังร่าง`,
    });
  }
  return out;
}

/** ── กลุ่ม B: ข้อความที่มีเนื้อหาจริงแต่ระบบตอบว่าไม่เข้าใจ ─────────────────── */
async function buildGroupB(): Promise<CorpusEntry[]> {
  const { rows } = await pool.query(
    `SELECT id, user_id, content, reply_content, created_at
       FROM messages
      WHERE type = 'text' AND ${UNCLEAR_REPLY_SQL} AND ${LOOKS_REAL_SQL}
        AND ${HUMAN_TYPED_SQL}
        AND length(btrim(content)) > 8
      ORDER BY created_at DESC`);

  const out: CorpusEntry[] = [];
  for (const r of rows) {
    out.push({
      id: `b-${r.id}`,
      group: 'B-missed',
      user_hash: hashUser(r.user_id),
      created_at: new Date(r.created_at).toISOString(),
      message: r.content ?? '',
      history: await fetchHistory(r.user_id, r.created_at),
      // เฉลยว่างโดยตั้งใจ — ใครเติมต้องเป็นคนที่รู้ว่าวันนั้นเซลส์ตั้งใจสั่งอะไร
      truth: { intent: null },
      truth_source: 'needs_review',
      needs_review: true,
      observed_reply_head: headOf(r.reply_content),
      note: 'ระบบตอบว่าไม่เข้าใจ ทั้งที่ข้อความมีรุ่น/จำนวน/ชื่อลูกค้า — ต้องมีคนตัดสินว่าเฉลยคืออะไร',
    });
  }
  return out;
}

/** ── กลุ่ม C: ข้อความที่ไม่ควรกลายเป็นใบ (วัด false positive) ───────────────── */
async function buildGroupC(): Promise<CorpusEntry[]> {
  const { rows } = await pool.query(
    `SELECT id, user_id, content, reply_content, created_at
       FROM messages
      WHERE type = 'text' AND ${UNCLEAR_REPLY_SQL} AND NOT ${LOOKS_REAL_SQL}
        AND ${HUMAN_TYPED_SQL}
      ORDER BY random() LIMIT $1`, [LIMIT_C]);

  const out: CorpusEntry[] = [];
  for (const r of rows) {
    const reply = r.reply_content || '';
    // เฉลย = พฤติกรรมปัจจุบัน ซึ่งกลุ่มนี้ถือว่าถูกอยู่แล้ว (ทักทาย/ขอฟอร์ม/ถามเช็คของ)
    const intent: CorpusTruth['intent'] = reply.includes('เช็คสต๊อก') ? 'UNCLEAR' : 'UNCLEAR';
    out.push({
      id: `c-${r.id}`,
      group: 'C-negative',
      user_hash: hashUser(r.user_id),
      created_at: new Date(r.created_at).toISOString(),
      message: r.content ?? '',
      history: await fetchHistory(r.user_id, r.created_at),
      truth: { intent },
      truth_source: 'current_behavior',
      needs_review: false,
      observed_reply_head: headOf(r.reply_content),
      note: 'ต้องไม่กลายเป็น QUOTATION — ถ้ากลายเมื่อไหร่ แปลว่าการผ่อนกฎเริ่มเดาสุ่ม',
    });
  }
  return out;
}

async function main() {
  console.log(`${BOLD}สร้าง corpus ชั้นสกัดคำสั่งจากข้อความจริง${RESET}\n`);
  const a = await buildGroupA();
  console.log(`  ${GREEN}A-confirmed${RESET} ${a.length} เคส ${DIM}(เฉลยจากใบที่เซลส์ยืนยันแล้ว)${RESET}`);
  const b = await buildGroupB();
  console.log(`  ${YEL}B-missed${RESET}    ${b.length} เคส ${DIM}(ยังไม่มีเฉลย — ต้องมีคนเติม)${RESET}`);
  const c = await buildGroupC();
  console.log(`  ${CYAN}C-negative${RESET}  ${c.length} เคส ${DIM}(ต้องไม่กลายเป็นใบ)${RESET}`);

  const entries = [...a, ...b, ...c];
  const withHistory = entries.filter(e => e.history.some(h => h.seconds_before <= 15 * 60)).length;
  const fullAlign = a.filter(e => (e.truth_alignment ?? 0) === 1).length;
  const zeroAlign = a.filter(e => (e.truth_alignment ?? 0) === 0).length;
  console.log(`  ${DIM}  ↳ เฉลยตรงกับข้อความครบทุกรายการ ${fullAlign}/${a.length} · ไม่ตรงเลย ${zeroAlign} (ไม่ให้คะแนน items)${RESET}`);
  const payload = {
    generated_at: new Date().toISOString(),
    counts: { total: entries.length, a: a.length, b: b.length, c: c.length, with_history_15min: withHistory },
    entries,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n  รวม ${BOLD}${entries.length}${RESET} เคส · มีประวัติใน 15 นาที ${withHistory} เคส`);
  console.log(`  เขียนลง ${BOLD}${OUT}${RESET}`);
  await pool.end();
}

main().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
