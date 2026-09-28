/**
 * ด่านของ "ระบุรายละเอียดตามแคตตาล็อก" ซีรีส์ BH (`services/pricingLab/catalogBh.ts` · docs/pricing-code-bh.md)
 *
 * คำถามที่ด่านนี้ตอบ:
 *   1. **ช่องกรอก ↔ รหัส กลับกันได้พอดี** — รหัสจริงทุกตัวที่อ่านเป็นช่องได้ ต้องประกอบกลับเป็นรหัสเดิม
 *      (ไม่งั้นหน้าจอจะเปลี่ยนรหัสของคนเงียบ ๆ ตอนกดแก้ช่องเดียว) และช่องที่กรอกทุกแบบต้องอ่านกลับเป็นค่าเดิม
 *   2. **ตัวเลือกทุกตัวของแคตตาล็อกไปถึงราคา** — ไม่มีตัวไหนตกเป็น "อ่านไม่ออก" เงียบ ๆ
 *   3. **คำตอบของเจ้าของ 2026-09-28 ห้าข้อ** เป็นจริงในตัวคิดราคา (สูตรพื้นที่ BH-02 · C +20% · T เลือก 10A/30A ·
 *      ID เล็กสุดตามแคตตาล็อก · BH-03 ไม่ระบุขั้วไฟ = คิดค่าน็อต)
 *
 * ไม่มี golden ของราคา (CLAUDE.md) — ข้อ 3 เทียบ "ความสัมพันธ์" ที่ต้องจริงเสมอไม่ว่าราคาในฐานเป็นเท่าไหร่
 * (C = ฐาน × 1.2 · 30A − 10A = ส่วนต่างของสองกฎในเล่มเดียวกัน · ขนาดเล็กกว่าเกณฑ์ = ติดข้อห้าม)
 *
 * เล่มที่ใช้: เล่มปัจจุบันในฐาน (SELECT อย่างเดียว) + กติกาแคตตาล็อกจากแมป (`catalogRules.ts` ตัวเดียวกับ
 * `importer.ts --catalog`) + แถวรหัสย่อยจาก `catalog-subcodes.json` ที่ฐานยังไม่มี — **ประกอบในหน่วยความจำ ไม่เขียนฐาน**
 * ⇒ ผ่านได้ทั้งก่อนและหลังรันคำสั่งขึ้นระบบ (DEPLOY.md 4.11ข)
 * ถอนโมดูลคิดราคาออก = ลบไฟล์นี้ + ท่อนใน `diag:pricing` ของ package.json ด้วย
 */
import { pool } from '../../config/db.js';
import { NoBook, loadBookFrom } from '../pricebook/bookSource.js';
import { catalogRulesFromMaps, withCatalogRules } from '../pricebook/catalogRules.js';
import { loadCatalogSubcodes } from '../pricebook/seedCatalogSubcodes.js';
import { listSubCodes } from '../../db/pricingLabRepo.js';
import { withSubCodes } from '../../services/pricingLab/bookStore.js';
import { parseProductCode } from '../../services/pricingLab/code.js';
import { computePrice } from '../../services/pricingLab/engine.js';
import { BH_CATALOG, buildBhCode, sameBhCode, sizeKeys, type BhForm } from '../../services/pricingLab/catalogBh.js';
import type { SubCode } from '../../services/pricingLab/types.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';
let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail?: string): void => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${RESET}  ${label}${detail ? `${DIM}  —  ${detail}${RESET}` : ''}`);
};
const section = (t: string) => console.log(`\n${BOLD}${t}${RESET}`);

/** แถวจากไฟล์ที่ฐานยังไม่มี (กติกาเดียวกับ seedCatalogSubcodes: ของในฐานชนะไฟล์) */
function mergeSeed(inDb: SubCode[], seed: SubCode[]): SubCode[] {
  const key = (s: SubCode) => `${s.subCode.toUpperCase()}|${s.scope}`;
  const have = new Set(inDb.map(key));
  return [...inDb, ...seed.filter((s) => !have.has(key(s)))];
}

async function main(): Promise<void> {
  const loaded = await loadBookFrom();
  const dbSubs = loaded.from === 'db' ? await listSubCodes() : [];
  const book = withSubCodes(withCatalogRules(loaded.book, catalogRulesFromMaps()), mergeSeed(dbSubs, loadCatalogSubcodes()));
  console.log(`สมุดราคาที่ใช้: ${loaded.label} + กติกาแคตตาล็อกจากแมป + รหัสย่อยจากแคตตาล็อก (ในหน่วยความจำ)`);

  const price = (code: string, picks = {}) => {
    const p = parseProductCode(code, book, picks);
    return { p, o: p.cfg ? computePrice(p.cfg, book) : null };
  };

  // ── 1. รหัสจริงทุกตัว: อ่าน → ช่อง → ประกอบกลับ ─────────────────────────────
  section('1. รหัสจริงในฐาน (products) — อ่านเป็นช่องแล้วประกอบกลับต้องได้รหัสเดิม');
  const { rows } = await pool.query<{ model: string }>(
    `SELECT DISTINCT model FROM products WHERE model ~* '^BH-?0[123]'`
  );
  let withForm = 0;
  const bad: string[] = [];
  const noForm: string[] = [];
  let spaceFixed = 0;
  for (const { model } of rows) {
    const p = parseProductCode(model, book);
    // ช่องว่างระหว่างตัวเลขต้องเป็นตัวคั่น ไม่ใช่ถูกลบจนขนาดติดกับแรงดัน (`101x150 220` ≠ ความสูง 150220)
    if (/\d\s+\d/.test(model.replace(/^\s*BH-?0\d[A-Z]?\s+/i, '')) && p.parts.some((x) => x.kind === 'noPrice' && /^แรงดัน/.test(x.reads))) spaceFixed++;
    if (!p.form) { noForm.push(model); continue; }
    withForm++;
    const back = buildBhCode(p.form);
    if (!sameBhCode(back, model.replace(/(\d)\s+(?=\d)/g, '$1-'))) bad.push(`${model}  →  ${back}`);
  }
  check(`รหัส BH ในฐาน ${rows.length} ตัว · อ่านเป็นช่องตามแคตตาล็อกได้ ${withForm} ตัว (≥ 95%)`, rows.length > 0 && withForm >= rows.length * 0.95,
    `ไม่ได้ ${noForm.length} ตัว เช่น ${noForm.slice(0, 4).join(' · ')}`);
  check('ทุกตัวที่อ่านเป็นช่องได้ ประกอบกลับเป็นรหัสเดิม', bad.length === 0, bad.slice(0, 5).join(' | '));
  check('รหัสที่คั่นท่อนด้วยช่องว่าง อ่านแรงดันแยกจากขนาดได้', spaceFixed > 0, `${spaceFixed} ตัว`);

  // ── 2. ช่องทุกแบบ → รหัส → ช่องเดิม ──────────────────────────────────────────
  section('2. ช่องที่กรอกทุกตัวเลือก → รหัส → อ่านกลับได้ค่าเดิม และไม่มีท่อนที่อ่านไม่ออก');
  let combos = 0;
  const drift: string[] = [];
  const unread: string[] = [];
  for (const spec of BH_CATALOG) {
    const shapes = spec.shapes ?? [{ code: '', label: '', dims: [] }];
    for (const shape of shapes) {
      for (const term of spec.slots.term!.options!) {
        for (const mat of spec.slots.mat?.options ?? [{ code: '', label: '' }]) {
          for (const conn of spec.slots.conn?.options ?? [{ code: '', label: '' }]) {
            const form: BhForm = { family: spec.family, volt: '220', watt: 1500, term: term.code || undefined, extras: [] };
            if (spec.shapes) form.shape = shape.code;
            for (const k of sizeKeys(form)) form[k] = k === 'd2' ? 100 : k === 'h' ? 150 : 300;
            if (spec.slots.mat) form.mat = mat.code || undefined;
            if (spec.slots.conn) form.conn = conn.code || undefined;
            if (term.code === 'T') form.amp = '30A';
            combos++;
            const code = buildBhCode(form);
            const p = parseProductCode(code, book, { amp: form.amp });
            const want = JSON.stringify({ ...form, extras: [] });
            const got = JSON.stringify(p.form ? { ...p.form, extras: p.form.extras ?? [] } : null);
            const norm = (s: string) => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(s) ?? {}).filter(([, v]) => v !== undefined).sort()));
            if (norm(want) !== norm(got)) drift.push(`${code}: ${got}`);
            const u = p.parts.filter((x) => x.kind === 'unknown' || x.kind === 'choose');
            if (u.length) unread.push(`${code}: ${u.map((x) => x.text).join(',')}`);
          }
        }
      }
    }
  }
  check(`${combos} ชุดค่าจากแคตตาล็อก อ่านกลับได้ค่าเดิมทุกช่อง`, drift.length === 0, drift.slice(0, 3).join(' | '));
  check('ไม่มีตัวเลือกไหนของแคตตาล็อกตกเป็น "อ่านไม่ออก"', unread.length === 0, unread.slice(0, 3).join(' | '));

  // ── 3. คำตอบของเจ้าของ 2026-09-28 ──────────────────────────────────────────
  section('3. คำตอบของเจ้าของ 2026-09-28 เป็นจริงในตัวคิดราคา');
  const base = (o: ReturnType<typeof price>['o']) => o?.breakdown.find((b) => b.step === 'base')?.amount ?? NaN;
  const rule = (o: ReturnType<typeof price>['o'], id: string) => o?.trace?.rules.find((r) => r.id === id);

  // ข้อ 1: สูตรพื้นที่ตามรูปทรง (เทียบกับสูตรเดียวกันที่เขียนตรงนี้ ไม่ใช่ตัวเลขราคา)
  const sq = price('BH-02 120x345-220-2500W');
  const areaOf = (o: ReturnType<typeof price>['o']) => Number(o?.trace?.inputs.find((i) => i.key === 'area_in2')?.value.replace(/,/g, ''));
  check('ข้อ 1 สี่เหลี่ยม: พื้นที่ = กว้าง × ยาว ÷ 645 ปัดขึ้น (ไม่ใช่ × 3.14)', areaOf(sq.o) === Math.ceil(120 * 345 / 645), `ได้ ${areaOf(sq.o)}`);
  const ci = price('BH-02C 210-220-1400W-Z');
  check('ข้อ 1 วงกลม: พื้นที่ = 3.14 × D1² ÷ 4 ÷ 645', areaOf(ci.o) === Math.ceil(3.14 * 210 * 210 / 4 / 645), `ได้ ${areaOf(ci.o)}`);
  const dn = price('BH-02D 230x140-220-1000W');
  check('ข้อ 1 โดนัท: พื้นที่ = 3.14 × (D1² − D2²) ÷ 4 ÷ 645', areaOf(dn.o) === Math.ceil(3.14 * (230 * 230 - 140 * 140) / 4 / 645), `ได้ ${areaOf(dn.o)}`);
  const dnBad = price('BH-02D 100x140-220-1000W');
  check('ข้อ 1 โดนัท D2 ≥ D1 = ไม่รับผลิต (ไม่ใช่ราคาแถบเล็กสุด)', dnBad.o?.status === 'notManufacturable');
  const sp = price('BH-02S 100x200-220-1000W');
  check('ข้อ 1 Special Shape = ต้องขอราคา', sp.o?.status === 'quoteOnRequest', sp.o?.status);

  // ข้อ 2: BH-02C = วงกลม + 20% ตาม Excel
  const cPct = rule(ci.o, 'variant:C');
  check('ข้อ 2 BH-02C บวก 20% จากราคาตั้ง', cPct?.status === 'applied' && Math.abs((cPct.amount ?? 0) - base(ci.o) * 0.2) < 0.01,
    `ราคาตั้ง ${base(ci.o)} · บวก ${cPct?.amount}`);
  const d2 = price('BH-02D 230x140-220-1000W');
  check('ข้อ 2 BH-02D ไม่บวก 20% (C เท่านั้น)', !d2.o?.trace?.rules.some((r) => r.id.startsWith('variant:')));

  // ข้อ 3: T เลือกได้ทั้ง 10A/30A · ไม่เลือก = ยังไม่รวม (ห้ามเดา)
  const t0 = price('BH-01 180x110-240-2540W-T');
  const t10 = price('BH-01 180x110-240-2540W-T', { amp: '10A' });
  const t30 = price('BH-01 180x110-240-2540W-T', { amp: '30A' });
  check('ข้อ 3 T ไม่เลือกขนาด = ท่อน "ต้องเลือก" และไม่คิดค่าเต๋า', t0.p.parts.some((x) => x.text === 'T' && x.kind === 'choose')
    && rule(t0.o, 'term_10a')?.status !== 'applied' && rule(t0.o, 'term_30a')?.status !== 'applied');
  check('ข้อ 3 เลือก 10A = กฎเต๋า 10A · เลือก 30A = กฎเต๋า 30A', rule(t10.o, 'term_10a')?.status === 'applied' && rule(t30.o, 'term_30a')?.status === 'applied'
    && (t30.o?.unitPrice ?? 0) - (t10.o?.unitPrice ?? 0) === (rule(t30.o, 'term_30a')?.amount ?? 0) - (rule(t10.o, 'term_10a')?.amount ?? 0));
  check('ข้อ 3 รหัสไม่เปลี่ยนตามขนาดเต๋า (อยู่นอกรหัส)', t30.p.form !== undefined && buildBhCode(t30.p.form) === 'BH-01 180x110-240-2540W-T');

  // ข้อ 4: ขนาดเล็กสุดตามแคตตาล็อก — BH-01 25 · BH-01C 60 · BH-03 65
  const blocked = (code: string) => price(code).o?.status === 'notManufacturable';
  check('ข้อ 4 BH-01 ID 30 คิดได้ (เดิมติด "OD 65" ของชีต)', !blocked('BH-01 30x100-220-300W'));
  check('ข้อ 4 BH-01 ID 20 ไม่รับผลิต', blocked('BH-01 20x100-220-300W'));
  check('ข้อ 4 BH-01C ID 50 ไม่รับผลิต · 60 คิดได้', blocked('BH-01C-50x100-220-300W') && !blocked('BH-01C-60x100-220-300W'));
  check('ข้อ 4 BH-03 ID 60 ไม่รับผลิต · 65 คิดได้', blocked('BH-03 60x100-220-300W') && !blocked('BH-03 65x100-220-300W'));
  check('ข้อ 4 BH-01 ออกน็อตสูง 35 ไม่รับผลิต · ออกสายสูง 35 คิดได้', blocked('BH-01 100x35-220-300W-N') && !blocked('BH-01 100x35-220-300W'));

  // ข้อ 5: BH-03 ไม่ระบุขั้วไฟ = ออกน็อต + ฝาครอบ คิดค่าน็อตปกติ
  const b3 = price('BH-03 170x110-220-2700W');
  const b3n = rule(b3.o, 'nut');
  check('ข้อ 5 BH-03 ไม่ระบุขั้วไฟ = คิดค่าออกน็อต', b3n?.status === 'applied', `+${b3n?.amount}`);
  check('ข้อ 5 BH-03 ออกเต๋า = ไม่คิดค่าน็อต', rule(price('BH-03 170x110-220-2700W-T', { amp: '10A' }).o, 'nut')?.status !== 'applied');

  // ตัวเลือกอื่นของแคตตาล็อก
  section('4. ตัวเลือกอื่นของแคตตาล็อกไปถึงกฎราคาที่ถูกตัว');
  check('N = กฎออกน็อต', rule(price('BH-01 180x110-240-2540W-N').o, 'nut')?.status === 'applied');
  check('1/2/3 = สายยาว 1/2/3 M เข้ากฎ "สายยาวเกิน 30 CM"', ['1', '2', '3'].every((n) =>
    rule(price(`BH-01 180x110-240-2540W-${n}`).o, 'cable_over_30cm')?.status === 'applied'));
  const pl5 = price('BH-01 180x110-240-2540W-PL5');
  check('PL5 = อ่านออก แต่ "ยังไม่มีราคา" (ไม่ใช่ +0)', pl5.o?.status === 'notManufacturable' && pl5.o.violations.some((v) => v.noRate)
    && !pl5.p.parts.some((x) => x.kind === 'unknown'));
  const z = price('BH-01C-600x150-380-4950W-SE-PL2-Z');
  check('SE / Z = อ่านออก ไม่มีผลกับราคา', z.p.parts.filter((x) => x.text === 'SE' || x.text === 'Z').every((x) => x.kind === 'noPrice')
    && z.p.parts.filter((x) => x.text === 'SE' || x.text === 'Z').length === 2);
  const ex = price('BH-01 140x170-220-2500W-T(HPT)-Z');
  check('ท่อนนอกแคตตาล็อกกลับไปที่เดิมตอนประกอบรหัส', ex.p.form !== undefined && buildBhCode(ex.p.form) === 'BH-01 140x170-220-2500W-T(HPT)-Z',
    ex.p.form ? buildBhCode(ex.p.form) : '');

  console.log(`\n${fail ? RED : GREEN}${pass} ผ่าน · ${fail} ตก${RESET}`);
}

try {
  await main();
} catch (e) {
  if (e instanceof NoBook) { console.error(e.message); fail++; } else throw e;
} finally {
  await pool.end();
}
process.exit(fail ? 1 : 0);
