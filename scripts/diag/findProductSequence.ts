// ─────────────────────────────────────────────────────────────────────────────
//  findProductSequence — ด่านของ applySequenceGuard (ด่าน "ลำดับของรหัส" ท้าย findProduct)
//
//  ข้อที่ห้ามล้ม: **ชื่อรุ่นทุกตัวในฐาน เมื่อเป็นรหัสที่พิมพ์มาเอง ต้องได้รุ่นตัวเองกลับมาไม่ถูกแตะ**
//  เคยพลาดมาแล้ว (2026-09-25 ตรวจซ้ำก่อน deploy): 326 รุ่นที่มีคำไทยกลางชื่อหรือขึ้นต้นด้วยไทย
//  (`Heater (หล่ออะลูมิเนียม) Size …` · `สาย THW 10 Sq.mm.`) ไม่ผ่านด่านของตัวเอง ⇒ พิมพ์มาเป๊ะก็กลาย
//  เป็นให้เลือก และหน้าเว็บที่หาสินค้าด้วยรหัสเต็มตอบ "ไม่พบสินค้า" · ด่านนี้ไล่ทุกแถวของ `products`
//  จึงจับได้ทันทีถ้ามีใครแก้ `codeRuns`/`followsSequence` แล้วพลาดแบบเดิม
//
//  ข้ออื่นมาจากรหัสที่เจ้าของแจ้ง (`PMV25.01.024` · `pmv25.c220`) — ขึ้นกับสินค้าในฐานจริง ⇒
//  ถ้ารุ่นที่คาดไว้หายจากฐาน (Odoo ลบ/เปลี่ยนชื่อ) ข้อนั้น **ข้าม** ไม่ใช่ล้ม (ไม่มี golden ตามกติกาใน CLAUDE.md)
//  ทางเต็มผ่าน handleEvent อยู่ที่ `diag:product-match-line` (เขียนฐาน ต้องขอก่อน) — ตัวนี้อ่านอย่างเดียว
//  ไม่เรียก LLM รันกับฐาน prod ได้ (~5 วิ)
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from '../../config/db.js';
import {
  applySequenceGuard,
  normalizeProductCode as normalize,
  type FindProductResult,
  type Product,
} from '../../services/productService.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let fail = 0;
const pass = (msg: string) => console.log(`${GREEN}✓${RESET} ${msg}`);
const bad = (msg: string) => { fail++; console.log(`${RED}✗ ${msg}${RESET}`); };
const skip = (msg: string) => console.log(`${DIM}- ข้าม: ${msg}${RESET}`);

async function productByModel(model: string): Promise<Product | null> {
  const { rows } = await pool.query<Product>(
    `SELECT * FROM products WHERE is_system_item = false AND model = $1
      ORDER BY quantity_on_hand_unreserved DESC LIMIT 1`,
    [model]
  );
  return rows[0] ?? null;
}

const found = (p: Product): FindProductResult => ({ found: true, product: p, candidates: [], report: '' });
const models = (r: FindProductResult) => r.candidates.map((c) => normalize(c.model || ''));

try {
  // ── 1. ชื่อรุ่นทุกตัว = รหัสของตัวเอง → ต้องไม่ถูกแตะ ──
  const { rows: all } = await pool.query<Product>(
    `SELECT * FROM products WHERE is_system_item = false AND COALESCE(model, '') <> ''`
  );
  const touched: string[] = [];
  for (const p of all) {
    const input = found(p);
    const out = await applySequenceGuard(p.model, input);
    if (out !== input) touched.push(p.model);
  }
  if (touched.length === 0) pass(`ชื่อรุ่นทุกตัวในฐานได้รุ่นตัวเองกลับมา (${all.length.toLocaleString()} รุ่น)`);
  else bad(`${touched.length} รุ่นถูกเปลี่ยนทั้งที่พิมพ์ชื่อรุ่นมาเป๊ะ เช่น ${touched.slice(0, 5).map((m) => JSON.stringify(m)).join(' · ')}`);

  // ── 2. ผิดซีรีส์ที่เจ้าของแจ้ง → ต้องกลายเป็นให้เลือก โดยรุ่นที่ถูกอยู่อันดับ 1 ──
  const wrong = await productByModel('PMV12.00024');
  const want024 = await productByModel('PMV25.01024');
  if (!wrong || !want024) skip('PMV25.01.024 — ไม่มี PMV12.00024 หรือ PMV25.01024 ในฐานแล้ว');
  else {
    const out = await applySequenceGuard('PMV25.01.024', found(wrong));
    const list = models(out);
    if (!out.found && list[0] === normalize(want024.model) && list.includes(normalize(wrong.model))) {
      pass(`PMV25.01.024 ที่เคยได้ PMV12.00024 → ให้เลือก: ${out.candidates.map((c) => c.model).join(' | ')}`);
    } else bad(`PMV25.01.024 → ${out.found ? 'เลือกให้ ' + out.product?.model : 'ให้เลือก ' + list.join(' | ')}`);
  }

  const wantC220 = await productByModel('PMV25C.01220');
  if (!wantC220) skip('pmv25.c220 — ไม่มี PMV25C.01220 ในฐานแล้ว');
  else {
    const out = await applySequenceGuard('pmv25.c220', { found: false, candidates: [], report: '' });
    if (!out.found && models(out).includes(normalize(wantC220.model))) {
      pass(`pmv25.c220 ที่เคยไม่มีตัวเลือกที่ถูก → ${out.candidates.map((c) => c.model).join(' | ')}`);
    } else bad(`pmv25.c220 → ไม่มี PMV25C.01220 ในรายการ: ${models(out).join(' | ') || '(ว่าง)'}`);
  }

  // ── 3. รหัสที่ขึ้นต้นด้วยไทย → ไม่ตัดสิน (คืนผลเดิมตัวเดิม) ──
  const empty: FindProductResult = { found: false, candidates: [], report: '' };
  const thaiLead = await applySequenceGuard('สาย THW 10 Sq.mm.', empty);
  if (thaiLead === empty) pass('รหัสที่ขึ้นต้นด้วยภาษาไทย ไม่ถูกแตะ');
  else bad(`รหัสที่ขึ้นต้นด้วยภาษาไทยถูกแตะ: ${models(thaiLead).join(' | ')}`);

  console.log(fail ? `\n${RED}ล้ม ${fail} ข้อ${RESET}` : `\n${GREEN}ผ่านทุกข้อ${RESET}`);
  await pool.end();
  process.exit(fail ? 1 : 0);
} catch (e: any) {
  console.error(`${RED}ด่านพัง:${RESET}`, e?.stack || e);
  await pool.end();
  process.exit(1);
}
