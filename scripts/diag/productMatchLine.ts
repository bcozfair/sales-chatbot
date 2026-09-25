// ─────────────────────────────────────────────────────────────────────────────
//  productMatchLine — ด่าน "เซลส์พิมพ์รหัสแบบนี้ บอทตอบรุ่นไหน" ผ่าน handleEvent ตัวจริงทั้งเส้น
//
//  ครอบสองด่านเสริมของการจับคู่สินค้า (2026-09-25) ในทั้งสองทางที่เรียก findProduct จากแชท:
//    · ขอใบเสนอราคา (QUOTATION → quoteExtraction) · ถามราคา/สต็อก (PRODUCT_INFO → lineHandler)
//    ด่านคำไทยท้ายชื่อ = services/thaiSuffixVariant.ts ("ดูดออก" ที่ AI ตัดทิ้ง)
//    ด่านลำดับของรหัส  = applySequenceGuard ใน services/productService.ts (ผิดซีรีส์)
//  เคสมาจากข้อความจริงที่เซลส์แจ้งปัญหา (id 8336 / 8385 / 8401 / 8402) + รหัสที่เจ้าของยกตัวอย่าง
//
//  วิธีเดียวกับ diag:line-parity: เรียก handleEvent ด้วย event รูปเดียวกับ webhook แล้วดักข้อความ
//  ตอบกลับด้วย createCaptureClient() — ไม่ยิงออก LINE จริง · ตัดสินจาก "รุ่นแรกที่บอทพูดถึง"
//  ในคำตอบ (ใบที่ resolve แล้ว = รุ่นในใบ · ให้เลือก = ตัวเลือกอันดับ 1)
//
//  ⚠️ ผลข้างเคียง: **commit แถวจริง** ลง salesperson / messages / quotations ของ user ทดสอบ แล้วลบใน
//  finally (กลุ่มเดียวกับ lineFlexParity — ต้องขอเจ้าของก่อนรัน · ฆ่ากลางคัน = แถวค้าง ล้างด้วยการรันซ้ำ)
//  user id ตายตัว และสคริปต์ปฏิเสธที่จะรันถ้า id นี้มีข้อมูลที่ไม่ได้มาจากตัวเองอยู่ก่อน
//  ค่าใช้จ่าย: LLM ~1-2 call ต่อเคส · ผลขึ้นกับสต็อก/สินค้าในฐานจริง
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from '../../config/db.js';
import { handleEvent } from '../../handlers/lineHandler.js';
import { createCaptureClient } from '../../services/chatChannel.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';
const TEST_USER = 'U' + 'd1a8' + '0'.repeat(28);
const SP_NAME = 'DIAG จับคู่สินค้า (ลบอัตโนมัติ)';
const HEAD = 'เสนอราคา\nบริษัท สยามเพาเวอร์ เทคโนโลยี จำกัด\nคุณนรินทร์\n';

interface Case {
  key: string;
  text: string;
  /** "auto" = ใบ resolve รุ่นนี้ · "ask" = เป็นตัวเลือกอันดับ 1 · "info" = บรรทัด ข้อมูลสินค้า [รุ่น] */
  expect: 'auto' | 'ask' | 'info' | 'info-ask';
  model: string;
}

const CASES: Case[] = [
  // ── ขอใบเสนอราคา ──
  { key: 'q_exact_suffix', text: HEAD + 'Pmv12.220 ดูดออก 2 ตัว', expect: 'auto', model: 'PMV12.00220 ดูดออก' },
  { key: 'q_fuzzy_suffix', text: HEAD + 'Pmv12.220 ดูดลมออก 2 ตัว', expect: 'ask', model: 'PMV12.00220 ดูดออก' },
  { key: 'q_plain', text: HEAD + 'PMV12.00220 2 ตัว', expect: 'auto', model: 'PMV12.00220' },
  { key: 'q_series_024', text: HEAD + 'PMV25.01.024 1 ตัว', expect: 'ask', model: 'PMV25.01024' },
  { key: 'q_series_c220', text: HEAD + 'pmv25.c220 1 ตัว', expect: 'ask', model: 'PMV25C.01220' },
  { key: 'q_series_c220_suffix', text: HEAD + 'pmv25.c220 ดูดออก 1 ตัว', expect: 'ask', model: 'PMV25C.01220 ดูดออก' },
  { key: 'q_control', text: HEAD + 'KR-Q50NW 2 ตัว', expect: 'auto', model: 'KR-Q50NW' },
  // ── ถามราคา/สต็อก ──
  { key: 'i_exact_suffix', text: 'PMV12.00220 ดูดออก', expect: 'info', model: 'PMV12.00220 ดูดออก' },
  { key: 'i_reorder_suffix', text: 'Pmv25c.01.220 ดูดออก', expect: 'info-ask', model: 'PMV25C.01220 ดูดออก' },
  { key: 'i_series_024', text: 'เช็คราคา PMV25.01.024', expect: 'info-ask', model: 'PMV25.01024' },
  { key: 'i_control', text: 'เช็คราคา KM-09N-A', expect: 'info', model: 'KM-09N-A' },
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** ข้อความทั้งหมดที่เซลส์จะเห็น (text + ทุก text/label ใน Flex) ต่อกันตามลำดับ */
function visibleText(messages: any[]): string {
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n.text === 'string') out.push(n.text);
    if (typeof n.label === 'string') out.push(n.label);
    for (const [k, v] of Object.entries(n)) if (k !== 'text' && k !== 'label') walk(v);
  };
  walk(messages);
  return out.join('\n');
}

/** รุ่นแรกที่ถูกพูดถึงจากชุดรุ่นที่รู้จัก (รุ่นของทุกเคส) — เทียบแบบไม่สนช่องว่างซ้อน */
function firstModel(text: string, known: string[]): string | null {
  const t = norm(text);
  let best: { i: number; m: string } | null = null;
  for (const m of known) {
    const re = new RegExp(norm(m).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![0-9a-z.\\-]|\\s*ดูด)', 'i');
    const hit = re.exec(t);
    if (hit && (!best || hit.index < best.i || (hit.index === best.i && m.length > best.m.length))) best = { i: hit.index, m };
  }
  return best?.m ?? null;
}

async function cleanupUser(): Promise<void> {
  await pool.query('DELETE FROM quotations WHERE user_id = $1', [TEST_USER]);
  await pool.query('DELETE FROM messages WHERE user_id = $1', [TEST_USER]);
}

async function main() {
  const pre = await pool.query('SELECT name FROM salesperson WHERE user_id = $1', [TEST_USER]);
  if (pre.rows.length && pre.rows[0].name !== SP_NAME) {
    console.error(`${RED}user ทดสอบ ${TEST_USER} มีแถวที่ไม่ได้มาจากด่านนี้ — ไม่รัน${RESET}`);
    process.exit(1);
  }
  console.log(`${BOLD}ด่านจับคู่สินค้าผ่าน handleEvent ${CASES.length} เคส${RESET}  user=${DIM}${TEST_USER}${RESET}\n`);

  const known = [...new Set(CASES.map((c) => c.model).concat([
    'PMV12.00024', 'PMV12.00024 ดูดออก', 'PMV25.01024 ดูดออก', 'PMV25C.01220', 'PMV12.00220', 'PMV250NP220', 'PMV250NA220',
    'PMV250NP220-C', 'PMV250NA220-C', 'PM-019-220',
  ]))];
  let pass = 0, fail = 0;
  try {
    await pool.query(
      `INSERT INTO salesperson (user_id, name, status, phone, salesperson_id, branch)
       VALUES ($1, $2, 'active', '000-000-0000', 'DIAGPM', 'สำนักงานใหญ่')
       ON CONFLICT (user_id) DO UPDATE SET status = 'active'`,
      [TEST_USER, SP_NAME]
    );
    for (const c of CASES) {
      await cleanupUser(); // ประวัติแชทเป็นส่วนหนึ่งของ prompt — ล้างทุกเคสให้ผลไม่พึ่งเคสก่อน
      const cap = createCaptureClient();
      const t0 = Date.now();
      const log = console.log;
      console.log = () => {}; // log ของการค้นลูกค้า/สินค้ายาวมาก — ผลที่ตัดสินอยู่ในข้อความตอบกลับ
      try {
        await handleEvent(
          { type: 'message', replyToken: `diag-${c.key}`, source: { type: 'user', userId: TEST_USER },
            message: { id: `diag-pm-${c.key}`, type: 'text', text: c.text } },
          { client: cap.client }
        );
      } finally {
        console.log = log;
      }
      const ms = Date.now() - t0;
      const text = visibleText(cap.captured);
      const { rows } = await pool.query('SELECT status, item_details FROM quotations WHERE user_id = $1', [TEST_USER]);
      const inQuote = rows.flatMap((r: any) => (Array.isArray(r.item_details) ? r.item_details : []).map((i: any) => String(i.model ?? '')));

      let got: string | null, ok: boolean;
      if (c.expect === 'auto') {
        got = inQuote[0] ?? firstModel(text, known);
        ok = got !== null && norm(got) === norm(c.model);
      } else if (c.expect === 'info') {
        const m = /ข้อมูลสินค้า \[([^\]]+)\]/.exec(text);
        got = m?.[1] ?? null;
        ok = got !== null && norm(got) === norm(c.model);
      } else {
        got = firstModel(text, known);
        // ให้เลือก = การ์ดเลือกรุ่น (ขอใบ) หรือรายงาน "🔍 ค้นหารุ่น" (ถามข้อมูล) — ไม่ใช่รุ่นที่ถูกเลือกให้แล้ว
        const asked = c.expect === 'ask' ? text.includes('เลือกรุ่นสินค้าที่ถูกต้อง') : text.includes('🔍 ค้นหารุ่น') && !/ข้อมูลสินค้า \[/.test(text);
        ok = got !== null && norm(got) === norm(c.model) && asked;
      }
      ok ? pass++ : fail++;
      console.log(`${ok ? GREEN + '✓' : RED + '✗'}${RESET} ${c.key} ${DIM}${ms}ms${RESET}  ${JSON.stringify(c.text.replace(HEAD, ''))}`);
      console.log(`   ${DIM}ต้องการ ${c.expect} ${c.model} · ได้ ${got ?? '(ไม่พบ)'}${RESET}`);
      if (!ok) console.log(`   ${DIM}${text.replace(/\n/g, ' ⏎ ').slice(0, 400)}${RESET}`);
    }
  } finally {
    await cleanupUser();
    await pool.query('DELETE FROM salesperson WHERE user_id = $1 AND name = $2', [TEST_USER, SP_NAME]);
  }
  console.log(`\n${BOLD}สรุป:${RESET} ${GREEN}ผ่าน ${pass}${RESET} · ${fail ? RED : DIM}ล้ม ${fail}${RESET}`);
  if (fail) console.log(`${DIM}LLM ไม่ deterministic 100% และผลขึ้นกับสินค้า/สต็อกในฐาน — ล้มให้รันซ้ำ 1 รอบก่อนสรุปว่าโค้ดพัง${RESET}`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(`${RED}ด่านล้มเหลว:${RESET}`, e);
  try { await cleanupUser(); await pool.query('DELETE FROM salesperson WHERE user_id = $1 AND name = $2', [TEST_USER, SP_NAME]); } catch {}
  await pool.end();
  process.exit(1);
});
