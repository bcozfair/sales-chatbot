/**
 * ด่านของ "วิธีคำนวณทีละขั้น" (`PriceOutcome.trace`) — การ์ดใหม่ในหน้าคำนวณราคา (เจ้าของขอ 2026-09-28)
 *
 * คำถามเดียวที่ด่านนี้ตอบ: **สิ่งที่หน้าจออธิบาย ตรงกับเงินที่คิดจริงทุกบาทไหม**
 * คำอธิบายที่ไม่ตรงกับตัวเลขแย่กว่าไม่มีคำอธิบาย — คนตรวจจะเชื่อคำอธิบาย แล้วสรุปว่าตรรกะถูกทั้งที่ผิด
 *
 * ไม่มี golden ของผลลัพธ์โดยตั้งใจ (CLAUDE.md: ห้ามเทียบผลที่ขึ้นกับข้อมูลในฐานกับไฟล์ที่บันทึกไว้) ⇒ ตรวจสองแบบ:
 *   1. **ข้อที่ต้องจริงเสมอ** กับทุกรหัสจริงในฐาน (อ่านอย่างเดียว) — ไม่ว่าราคาในฐานจะเป็นเท่าไหร่
 *      · ราคาตั้ง + ทุกกฎที่ขึ้น "คิด" = ราคาต่อหน่วย · ลำดับ/จำนวน/ยอดสะสมตรงกับ `breakdown` ทีละบรรทัด
 *      · กฎที่ขึ้น "คิดไม่ได้" มีคำเตือนตัวเดียวกันใน `violations` และกลับกัน
 *      · ข้อห้ามที่ขึ้น "ติด" มีจำนวนเท่ากับคำเตือนจากข้อห้าม
 *   2. **สมุดราคาจำลองในไฟล์นี้** — ตัวเลขรู้ล่วงหน้า จึงตรวจข้อความได้ (ปัดขึ้น/ปัดลง · กฎที่ปิด · เงื่อนไขไม่ตรง)
 * พร้อม **ชุดควบคุมกลับด้าน**: trace ที่ถูกแก้ตัวเลขทีละจุดต้องถูกจับได้ ไม่งั้นข้อ 1 อาจผ่านแบบว่างเปล่า
 *
 * `--data <dir>` ใช้ไฟล์ Excel แทนเล่มในฐานได้ (ดู scripts/pricebook/bookSource.ts)
 * ถอนโมดูลคิดราคาออก = ลบไฟล์นี้ + ท่อนใน `diag:pricing` ของ package.json ด้วย
 */
import { pool } from '../../config/db.js';
import { NoBook, loadBookFrom } from '../pricebook/bookSource.js';
import { listSubCodes } from '../../db/pricingLabRepo.js';
import { withSubCodes } from '../../services/pricingLab/bookStore.js';
import { parseProductCode } from '../../services/pricingLab/code.js';
import { computePrice } from '../../services/pricingLab/engine.js';
import type { PriceBook, PriceOutcome } from '../../services/pricingLab/types.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';
let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail?: string): void => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${RESET}  ${label}${detail ? `${DIM}  —  ${detail}${RESET}` : ''}`);
};
const section = (t: string) => console.log(`\n${BOLD}${t}${RESET}`);
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** คืนข้อความที่ผิด หรือ '' ถ้า trace ตรงกับเงินทุกบาท */
function inconsistency(o: PriceOutcome): string {
  const t = o.trace;
  if (!t) return 'ไม่มี trace';
  const applied = t.rules.filter((r) => r.status === 'applied');
  const lines = o.breakdown.filter((b) => b.step !== 'base');
  if (applied.length !== lines.length) return `กฎที่ขึ้น "คิด" ${applied.length} ข้อ แต่ breakdown มี ${lines.length} บรรทัด`;
  for (let i = 0; i < lines.length; i++) {
    const r = applied[i]!, b = lines[i]!;
    if (r.label !== b.label || !near(r.amount ?? NaN, b.amount) || !near(r.running ?? NaN, b.running)) {
      return `บรรทัด ${i + 1}: trace "${r.label}" ${r.amount}/${r.running} ≠ breakdown "${b.label}" ${b.amount}/${b.running}`;
    }
  }
  const baseLine = o.breakdown.find((b) => b.step === 'base');
  if (t.base.ok !== !!baseLine) return `ราคาตั้ง ok=${t.base.ok} แต่ breakdown ${baseLine ? 'มี' : 'ไม่มี'}บรรทัดราคาตั้ง`;
  if (baseLine && !near(t.base.amount ?? NaN, baseLine.amount)) return `ราคาตั้ง ${t.base.amount} ≠ ${baseLine.amount}`;
  if (o.status === 'priced') {
    const sum = (t.base.amount ?? 0) + applied.reduce((s, r) => s + (r.amount ?? 0), 0);
    if (!near(sum, o.unitPrice)) return `ราคาตั้ง + กฎที่คิด = ${sum} ≠ ราคาต่อหน่วย ${o.unitPrice}`;
  }
  const vIds = new Set(o.violations.filter((v) => v.level === 'block').map((v) => v.id));
  for (const r of t.rules) {
    if (r.status === 'blocked' && !vIds.has(r.id)) return `กฎ "${r.label}" ขึ้นคิดไม่ได้ แต่ไม่มีคำเตือน`;
  }
  const blockedIds = new Set(t.rules.filter((r) => r.status === 'blocked').map((r) => r.id));
  const ruleIds = new Set(t.rules.map((r) => r.id));
  for (const v of o.violations) {
    if (v.level === 'block' && ruleIds.has(v.id) && !blockedIds.has(v.id)) return `คำเตือน ${v.id} แต่กฎนั้นไม่ได้ขึ้นคิดไม่ได้`;
    if (v.partial && t.rules.find((r) => r.id === v.id)?.status !== 'waiting') return `คำเตือน ${v.id} (ยังไม่รวม) แต่กฎนั้นไม่ได้ขึ้นยังไม่รวม`;
  }
  const hits = t.checks.filter((c) => c.hit).length;
  // คำเตือนจากค่านอกแคตตาล็อก (`askPrice` · TS_-01 2026-09-29) ไม่ได้มาจากข้อห้าม — ตรวจแยกข้างล่าง
  const fromConstraints = o.violations.filter((v) => !ruleIds.has(v.id) && !v.id.startsWith('SUBCODE_') && v.id !== 'NO_BASE_PRICE' && !v.askPrice).length;
  // "ต้องขอราคา" จากค่านอกแคตตาล็อก ⇒ ห้ามมีราคาที่หน้าตาเหมือนราคาเต็ม และวิธีคิดต้องบอกว่าขอราคาที่ราคาตั้งหรือที่กฎ
  if (o.violations.some((v) => v.askPrice && v.level === 'quoteOnRequest')) {
    if (o.status === 'priced') return 'ค่านอกแคตตาล็อกขึ้นขอราคา แต่สถานะเป็นคิดราคาได้';
    const told = [...t.base.steps, ...t.rules.map((r) => r.reason ?? '')].some((x) => /ไม่อยู่ในแคตตาล็อก/.test(x));
    if (!told && !o.violations.some((v) => v.askPrice && v.id.startsWith('ASK_PRICE:'))) return 'ขอราคาแต่วิธีคิดไม่บอกเหตุผล';
  }
  if (hits !== fromConstraints) return `ข้อห้ามขึ้น "ติด" ${hits} ข้อ แต่มีคำเตือนจากข้อห้าม ${fromConstraints}`;
  return '';
}

// ── สมุดราคาจำลอง: ตัวเลขรู้ล่วงหน้า ────────────────────────────────────────
const toy: PriceBook = {
  version: 'toy',
  source: 'diag',
  models: {
    'TOY-1': {
      code: 'TOY-1',
      label: 'รุ่นจำลอง',
      sheet: 'TOY',
      standard: { L1: 100, L2: 50, cable_m: 1 },
      derivedDims: [{ name: 'L_total', label: 'ความยาวรวม', formula: 'sum', args: ['L1', 'L2'] }],
      base: { kind: 'matrix', axes: ['D'], cells: { '6': 1000 } },
      adders: [
        { id: 'len', label: 'ความยาวรวม', order: 10, kind: 'perUnit', dim: 'L_total', over: 100, step: 100, round: 'ceil', unit: 'mm', rate: 300, source: 'TOY!A1' },
        { id: 'cab', label: 'สาย', order: 20, kind: 'perUnit', dim: 'cable_m', step: 1, round: 'floor', unit: 'm', rate: 100 },
        { id: 'thr', label: 'รุ่นมีเกลียว', order: 30, kind: 'flat', amount: 900, when: { option: 'thread' } },
        { id: 'old', label: 'กฎที่ปิดไว้', order: 40, kind: 'flat', amount: 50, disabled: true },
      ],
      constraints: [{ id: 'MAX', when: { dim: 'L_total', gt: 1000 }, level: 'block', message: 'ยาวเกิน 1000' }],
    },
  },
};

async function main(): Promise<void> {
  console.log(`\n${BOLD}ด่านวิธีคำนวณทีละขั้น (trace ตรงกับเงินทุกบาท)${RESET}`);

  section('1. สมุดราคาจำลอง — ข้อความของแต่ละขั้น');
  const o = computePrice({ model: 'TOY-1', axes: { D: '6' }, dims: { L1: 200, L2: 150, cable_m: 2.5 } }, toy);
  const t = o.trace!;
  const rule = (id: string) => t.rules.find((r) => r.id === id)!;
  check('ราคา = 1000 + 900 (ยาว 350 เกิน 100 = 250 → 3 ช่วง) + 100 (สาย 1.5 m → ปัดลง 1) = 2000', o.unitPrice === 2000, String(o.unitPrice));
  check('ความยาวรวมบอกสูตร L1 + L2', t.inputs.some((i) => i.key === 'L_total' && i.from.includes('200 + ') && i.from.includes('150 = 350')),
    t.inputs.find((i) => i.key === 'L_total')?.from);
  check('ค่าที่พิมพ์มาบอกมาตรฐานของรุ่นด้วย', t.inputs.some((i) => i.key === 'L2' && i.from.includes('ระบุในรหัส') && i.from.includes('50')));
  check('ราคาตั้งบอกช่องที่เปิด', t.base.steps.some((s) => s.includes('ขนาดแกน = 6')) && t.base.amount === 1000);
  check('ราคาตั้งบอกว่ารวมสเปกมาตรฐานไว้แล้ว', t.base.steps.some((s) => s.includes('รวมสเปกมาตรฐานไว้แล้ว')));
  check('ปัดขึ้น: 2.5 → 3 ช่วง', rule('len').steps.some((s) => s.includes('250 ÷ 100 = 2.5') && s.includes('ปัดขึ้น') && s.includes('= 3 ช่วง')),
    rule('len').steps.join(' | '));
  check('สูตรเงิน 3 × 300 = 900', rule('len').steps.some((s) => s.includes('3 × 300 = 900')));
  check('over ที่ไม่ได้ตั้งในกฎ = มาตรฐานของรุ่น (ไม่ใช่ 0)', rule('cab').steps.some((s) => s.includes('มาตรฐานของรุ่น 1')));
  check('ปัดลง: 1.5 → 1 ช่วง', rule('cab').steps.some((s) => s.includes('1.5 ÷ 1 = 1.5') && s.includes('ปัดลง') && s.includes('= 1 ช่วง')));
  check('ที่มาในชีตติดมาด้วย', rule('len').source === 'TOY!A1');
  check('เงื่อนไขไม่ตรง ⇒ ขึ้น "ไม่คิด" พร้อมเหตุผล', rule('thr').status === 'skipped' && rule('thr').steps[0]?.includes('ใบนี้ไม่มี') === true);
  check('กฎที่ปิดไว้ยังโผล่ แต่ขึ้น "ปิดไว้"', rule('old').status === 'off' && rule('old').amount === undefined);
  check('ข้อห้ามที่ไม่ติดขึ้น "ผ่าน" พร้อมค่าจริง', t.checks.length === 1 && !t.checks[0]!.hit && t.checks[0]!.condition.includes('ใบนี้ 350'));
  check('trace ตรงกับเงิน (ตัวตรวจข้อ 2)', inconsistency(o) === '', inconsistency(o));

  const within = computePrice({ model: 'TOY-1', axes: { D: '6' }, dims: { L1: 50 } }, toy);
  check('ไม่เกินมาตรฐาน ⇒ ขึ้น "ไม่คิด" ไม่ใช่หายไป', within.trace!.rules.find((r) => r.id === 'len')?.reason?.includes('ไม่เกินมาตรฐาน') === true);
  const tooLong = computePrice({ model: 'TOY-1', axes: { D: '6' }, dims: { L1: 2000 } }, toy);
  check('ข้อห้ามที่ติด ⇒ ขึ้น "ติด"', tooLong.trace!.checks[0]?.hit === true && inconsistency(tooLong) === '', inconsistency(tooLong));
  const noCell = computePrice({ model: 'TOY-1', axes: { D: '9' } }, toy);
  check('หาราคาตั้งไม่ได้ ⇒ บอกเหตุผลและไม่ตรวจกฎต่อ', !noCell.trace!.base.ok && noCell.trace!.rules.length === 0
    && noCell.trace!.base.steps.some((s) => s.includes('ไม่รับผลิต')));

  section('2. ชุดควบคุมกลับด้าน — trace ที่ถูกแก้ตัวเลขต้องถูกจับได้');
  const tamper = (f: (x: PriceOutcome) => void): string => {
    const x = structuredClone(o);
    f(x);
    return inconsistency(x);
  };
  check('แก้เงินของกฎหนึ่งข้อ', tamper((x) => { x.trace!.rules[0]!.amount! += 1; }) !== '');
  check('แก้ยอดสะสม', tamper((x) => { x.trace!.rules[1]!.running! += 1; }) !== '');
  check('แก้ราคาตั้ง', tamper((x) => { x.trace!.base.amount! += 1; }) !== '');
  check('ซ่อนกฎที่คิดไปหนึ่งข้อ', tamper((x) => { x.trace!.rules[0]!.status = 'skipped'; }) !== '');
  check('บอกว่าข้อห้ามติดทั้งที่ไม่ติด', tamper((x) => { x.trace!.checks[0]!.hit = true; }) !== '');

  section('3. ทุกรหัสจริงในฐาน (อ่านอย่างเดียว) — trace ตรงกับเงินทุกบาท');
  let book: PriceBook;
  try {
    const loaded = await loadBookFrom();
    book = loaded.from === 'db' ? withSubCodes(loaded.book, await listSubCodes()) : loaded.book;
    console.log(`  ${DIM}สมุดราคาที่ใช้: ${loaded.label}${RESET}`);
  } catch (e) {
    if (!(e instanceof NoBook)) throw e;
    check('มีสมุดราคาให้ตรวจ', false, e.message);
    return;
  }
  const { rows } = await pool.query<{ model: string | null }>(
    `SELECT model FROM products WHERE model IS NOT NULL AND model <> ''`
  );
  const codes = rows.map((r) => (r.model ?? '').trim()).filter((m) => /^(TS|BH)/.test(m));
  let checked = 0, priced = 0, withSkipped = 0;
  const bad: string[] = [];
  for (const code of codes) {
    const parsed = parseProductCode(code, book);
    if (!parsed.cfg) continue;
    const out = computePrice(parsed.cfg, book);
    checked++;
    if (out.status === 'priced') priced++;
    if (out.trace?.rules.some((r) => r.status === 'skipped')) withSkipped++;
    const why = inconsistency(out);
    if (why) bad.push(`${code}: ${why}`);
  }
  check('ตรวจมากกว่า 0 รหัส (ไม่ใช่ผ่านแบบว่างเปล่า)', checked > 0 && priced > 0,
    `${checked.toLocaleString()} รหัสที่อ่านรุ่นออก · คิดราคาได้ ${priced.toLocaleString()} · มีกฎที่ถูกข้าม ${withSkipped.toLocaleString()}`);
  check('trace ตรงกับเงินทุกรหัส', bad.length === 0, bad.slice(0, 5).join(' / ') || `${checked.toLocaleString()} รหัส`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await pool.end();
    console.log(`\nผล: ผ่าน ${pass} · ตก ${fail}\n`);
    process.exitCode = fail ? 1 : 0;
  });
