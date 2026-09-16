// ─────────────────────────────────────────────────────────────────────────────
//  productCandidateEval — ด่านของ "รายการรุ่นใกล้เคียงที่ให้เซลส์กดเลือก"
//  รัน:  npm run diag:product-candidates
//        npm run diag:product-candidates -- --print   ดูรายเคสที่ยังหาไม่เจอ
//
//  คำถามที่ด่านนี้ตอบ: **"รุ่นที่เซลส์ต้องการจริง อยู่ในรายการที่บอทเสนอให้กดหรือเปล่า"**
//  ซึ่งต่างจาก diag:stock-rule (กฎระงับ) และ diag:line-parity (รูปร่าง JSON ของ Flex)
//
//  เฉลยมาจากของจริง ไม่ใช่เคสที่เขียนขึ้นเอง: ข้อความที่บอทเคยตอบ "พบหลายรุ่นใกล้เคียง"
//  จับคู่กับ **ใบที่เกิดขึ้นตามมาภายใน 15 นาทีของ user คนเดียวกัน** — รุ่นในใบนั้นคือรุ่นที่
//  เซลส์ต้องการจริง (เขากดปุ่มเลือกหรือพิมพ์ใหม่จนได้) ⇒ ชุดข้อสอบโตเองตามการใช้งานจริง
//  และ **ไม่ต้องเก็บ fixture ไว้ใน git** (ข้อมูลอยู่ในฐาน ซึ่ง `.env` ชี้ไปที่เดียวกับที่ใช้จริง)
//
//  ⚠️ ผลจึงขยับตามข้อมูลได้ — ตัวเลขเปอร์เซ็นต์ใช้ดูแนวโน้ม **ส่วนที่เป็น gate จริงคือ
//  "เคสที่เคยอยู่ใน 3 ตัวแรกแล้วหลุดจากรายการใหม่ ต้องเป็น 0"** ซึ่งเป็นคำถามเชิงเปรียบเทียบ
//  ที่ไม่ขึ้นกับว่าวันนี้ข้อมูลมีกี่เคส
//
//  ด่านนี้วัด **เฉพาะชั้นจัดอันดับ** — เคสที่เฉลยไม่ได้อยู่ใน 8 แถวที่ query คืนมาเลยถูกตัดทิ้ง
//  เพราะนั่นเป็นปัญหาของตัว query ไม่ใช่ของการจัดอันดับ ⇒ ตัวเลขที่นี่จึงสูงกว่าตัวเลข
//  "ทั้งเส้นทาง" ที่เขียนไว้ในหัวข้อ buildCandidateList (342 เคส · 87.4% → 95.9%) โดยธรรมชาติ
//
//  ผลข้างเคียง: ไม่มี — SELECT อย่างเดียว ไม่เรียก LLM ไม่เขียนแถวใด ๆ
//  ค่าอ้างอิง 2026-09-16: 331 เคส · ของเดิม (3 ตัว) 91.2% · ของใหม่ (5 ตัว) 99.1% · หลุด 0 เคส
// ─────────────────────────────────────────────────────────────────────────────
import { pool, withTransaction } from '../../config/db.js';
import {
  buildCandidateList,
  normalizeProductCode,
  CANDIDATE_LIMIT,
  type Product,
} from '../../services/productService.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';
const PRINT = process.argv.includes('--print');

// จำนวนตัวเลือกที่ "ของเดิม" แสดง — ไว้เทียบว่าของใหม่ดีขึ้น/แย่ลงกี่เคส
const LEGACY_LIMIT = 3;

type ScoredProduct = Product & { _score: number };

// บรรทัดที่ไม่ใช่รายการสินค้าในข้อความของเซลส์ (ชื่อบริษัท/ผู้ติดต่อ/ส่วนลด/เบอร์โทร)
const SKIP_LINE = /^(เสนอราคา|บริษัท|บ\.|หจก|ห้าง|คุณ|ลด|โทร|ที่อยู่|tax|เลขที่|\*\*|ราคา|ส่ง|วันที่)/i;

/** ดึง "รหัสสินค้า" ออกจากข้อความหลายบรรทัดแบบเดียวกับที่เซลส์พิมพ์เข้ามาจริง */
function extractCodes(content: string): string[] {
  const out: string[] = [];
  for (const raw of String(content).split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    line = line.replace(/^\d+[.)]\s*/, '');        // เลขข้อ "1." "2)"
    if (SKIP_LINE.test(line)) continue;
    if (/^[\d\s\-()+]+$/.test(line)) continue;      // เบอร์โทร/ตัวเลขล้วน
    let code = String(line.split('=')[0] ?? '');    // "XXX = 2 ตัว" → "XXX"
    code = code
      .replace(/\s*ลด.*$/i, '')
      .replace(/\s*ราคา.*$/i, '')
      .replace(/\s*\d+\s*(ตัว|ชิ้น|อัน|ชุด|เส้น|กล่อง|แพ็ค|ม้วน|pcs?|pc|set)\b.*$/i, '')
      .replace(/\s*(ตัว|ชิ้น|อัน|ชุด|เส้น|กล่อง|แพ็ค|ม้วน)\s*$/i, '')
      .replace(/[\s-]*$/, '')
      .trim();
    if (code.length < 3 || code.length > 60) continue;
    if (!/\d/.test(code) || !/[a-zA-Z]/.test(code)) continue;
    out.push(code);
  }
  return [...new Set(out)];
}

// เงื่อนไข/ลำดับชุดเดียวกับ fuzzySearch() ใน productService.ts — ตัวที่ถูกทดสอบคือชั้น
// จัดอันดับ (buildCandidateList) ไม่ใช่ตัว query ⇒ ที่นี่ทำหน้าที่ "ป้อนแถวให้เหมือนของจริง"
const NORM_MODEL = `LOWER(REGEXP_REPLACE(COALESCE(model,''),'[\\s,\\(\\)]','','g'))`;
const NORM_NAME = `LOWER(REGEXP_REPLACE(COALESCE(name ,''),'[\\s,\\(\\)]','','g'))`;
const FUZZY_SQL = `
  SELECT *,
    GREATEST(similarity(${NORM_MODEL}, $1), similarity(${NORM_NAME}, $1)) AS _score
  FROM products
  WHERE production NOT ILIKE '%buytosell%' AND is_system_item = false
    AND (${NORM_MODEL} % $1 OR ${NORM_NAME} % $1)
    AND GREATEST(similarity(${NORM_MODEL}, $1), similarity(${NORM_NAME}, $1)) > 0.25
  ORDER BY _score DESC
  LIMIT 8`;

interface Case {
  code: string;
  qNorm: string;
  target: string;
  targetStock: number;
  rows: ScoredProduct[];
}

async function buildCorpus(): Promise<{ cases: Case[]; ambiguous: number; withFollowup: number }> {
  // ข้อความที่บอทตอบ "พบหลายรุ่นใกล้เคียง" + รุ่นในใบแรกที่ออกตามมาภายใน 15 นาที
  const { rows: msgs } = await pool.query<{ content: string; models: string[] | null }>(`
    SELECT a.content,
      (SELECT jsonb_agg(DISTINCT i->>'model')
         FROM quotations q, jsonb_array_elements(q.item_details) i
        WHERE q.id = (SELECT q2.id FROM quotations q2
                       WHERE q2.user_id = a.user_id AND q2.created_at > a.created_at
                         AND q2.created_at < a.created_at + interval '15 min'
                         AND q2.status <> 'pending_product'
                       ORDER BY q2.created_at LIMIT 1)) AS models
    FROM messages a
    WHERE a.reply_content LIKE 'พบหลายรุ่นใกล้เคียง%'
    ORDER BY a.created_at`);

  const cases: Case[] = [];
  let withFollowup = 0;

  for (const m of msgs) {
    const models = m.models || [];
    if (models.length === 0) continue;
    withFollowup++;
    const wanted = new Set(models.map((x) => normalizeProductCode(x)));

    for (const code of extractCodes(m.content)) {
      const qNorm = normalizeProductCode(code);
      if (!qNorm) continue;

      // ข้ามรหัสที่ Stage 1 (exact) คว้าไปแล้ว — ไม่เคยเดินมาถึงชั้นจัดอันดับ
      const exact = await pool.query(
        `SELECT 1 FROM products WHERE is_system_item = false
           AND (${NORM_MODEL} = $1 OR ${NORM_NAME} = $1) LIMIT 1`, [qNorm]);
      if (exact.rowCount) continue;

      const rows = await withTransaction(async (client) => {
        await client.query(`SET LOCAL pg_trgm.similarity_threshold = 0.25`);
        const r = await client.query<ScoredProduct>(FUZZY_SQL, [qNorm]);
        return r.rows;
      });

      const hit = rows.find((r) => wanted.has(normalizeProductCode(r.model || '')));
      if (!hit) continue;   // เฉลยไม่ได้อยู่ในผลค้นเลย → เป็นคนละคำถาม (ตัว query ไม่ใช่ชั้นจัดอันดับ)

      cases.push({
        code,
        qNorm,
        target: hit.model,
        targetStock: Number(hit.quantity_on_hand_unreserved || 0),
        rows,
      });
    }
  }
  return { cases, ambiguous: msgs.length, withFollowup };
}

async function main() {
  console.log(`${BOLD}ด่านรายการรุ่นใกล้เคียง — เฉลยจากพฤติกรรมจริงของเซลส์${RESET}`);
  await pool.query(`SET statement_timeout = '120s'`);

  const { cases, ambiguous, withFollowup } = await buildCorpus();
  console.log(`${DIM}ข้อความที่ตอบ "พบหลายรุ่นใกล้เคียง" ${ambiguous} ครั้ง · มีใบตามมา ${withFollowup} ครั้ง → เคสที่มีเฉลย ${cases.length} เคส${RESET}\n`);

  if (cases.length === 0) {
    console.log(`${RED}✗ ไม่มีเคสให้ตรวจ${RESET} — ฐานนี้ยังไม่มีประวัติแชทพอ (ด่านนี้ต้องรันกับฐานที่มีข้อมูลจริง)`);
    process.exitCode = 1;
    return;
  }

  const sameModel = (a: string, b: string) => normalizeProductCode(a) === normalizeProductCode(b);
  let legacyHit = 0, currentHit = 0, improved = 0, regressed = 0;
  const misses: Case[] = [];

  for (const c of cases) {
    const legacy = c.rows.slice(0, LEGACY_LIMIT);                 // ของเดิม: ตัดสามตัวแรกตาม score
    const current = buildCandidateList(c.rows);                   // ของจริงที่ใช้อยู่ตอนนี้
    const inLegacy = legacy.some((r) => sameModel(r.model, c.target));
    const inCurrent = current.some((r) => sameModel(r.model, c.target));
    if (inLegacy) legacyHit++;
    if (inCurrent) currentHit++;
    if (!inLegacy && inCurrent) improved++;
    if (inLegacy && !inCurrent) regressed++;
    if (!inCurrent) misses.push(c);
  }

  const pct = (n: number) => `${((100 * n) / cases.length).toFixed(1)}%`;
  console.log(`  ของเดิม (${LEGACY_LIMIT} ตัว เรียงตาม similarity ล้วน) : ${legacyHit}/${cases.length}  ${pct(legacyHit)}`);
  console.log(`  ของจริงตอนนี้ (สูงสุด ${CANDIDATE_LIMIT} ตัว)          : ${currentHit}/${cases.length}  ${pct(currentHit)}`);
  console.log(`  ${DIM}เคยหาไม่เจอ → เจอ: ${improved}${RESET}`);

  let failures = 0;
  const ok = (label: string, cond: boolean) => {
    if (!cond) failures++;
    console.log(`${cond ? GREEN + '✓' : RED + '✗ FAIL'}${RESET}  ${label}`);
  };

  console.log('');
  // gate ตัวจริง — เชิงเปรียบเทียบ จึงไม่ขึ้นกับว่าวันนี้ข้อมูลมีกี่เคส
  ok(`ไม่มีเคสที่เคยอยู่ใน ${LEGACY_LIMIT} ตัวแรกแล้วหลุดจากรายการใหม่ (หลุด ${regressed} เคส)`, regressed === 0);
  ok(`รายการใหม่ครอบคลุมไม่น้อยกว่าของเดิม (${currentHit} ≥ ${legacyHit})`, currentHit >= legacyHit);
  ok(`ทุกเคสเสนอไม่เกิน ${CANDIDATE_LIMIT} ตัว และไม่มีรุ่นซ้ำในรายการเดียวกัน`,
    cases.every((c) => {
      const list = buildCandidateList(c.rows);
      return list.length <= CANDIDATE_LIMIT &&
        new Set(list.map((r) => normalizeProductCode(r.model || ''))).size === list.length;
    }));

  if (PRINT && misses.length > 0) {
    console.log(`\n${DIM}เคสที่ยังหาไม่เจอ ${misses.length} เคส:${RESET}`);
    for (const c of misses) {
      const list = buildCandidateList(c.rows).map((r) => r.model).join(' | ');
      console.log(`  พิมพ์ "${c.code}" → อยากได้ ${c.target} (คงเหลือ ${c.targetStock})`);
      console.log(`    ${DIM}เสนอ: ${list}${RESET}`);
    }
  } else if (misses.length > 0) {
    console.log(`\n${DIM}ยังหาไม่เจอ ${misses.length} เคส — ดูรายตัวด้วย -- --print${RESET}`);
  }

  console.log(`\n${BOLD}สรุป:${RESET} ${failures === 0 ? GREEN + 'ผ่านทั้งหมด' : RED + `ล้ม ${failures}`}${RESET}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
