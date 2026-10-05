/**
 * ด่านของ "ระบุรายละเอียดตามแคตตาล็อก" ซีรีส์ BH (`services/pricingLab/catalogBh.ts` · docs/pricing-code-bh.md)
 *
 * คำถามที่ด่านนี้ตอบ:
 *   1. **ช่องกรอก ↔ รหัส กลับกันได้พอดี** — รหัสจริงทุกตัวที่อ่านเป็นช่องได้ ต้องประกอบกลับเป็นรหัสเดิม
 *      (ไม่งั้นหน้าจอจะเปลี่ยนรหัสของคนเงียบ ๆ ตอนกดแก้ช่องเดียว) และช่องที่กรอกทุกแบบต้องอ่านกลับเป็นค่าเดิม
 *   2. **ตัวเลือกทุกตัวของแคตตาล็อกไปถึงราคา** — ไม่มีตัวไหนตกเป็น "อ่านไม่ออก" เงียบ ๆ
 *   3. **คำตอบของเจ้าของ 2026-09-28 ห้าข้อ** เป็นจริงในตัวคิดราคา (สูตรพื้นที่ BH-02 · C +20% · T เลือก 10A/30A ·
 *      ID เล็กสุดตามแคตตาล็อก · BH-03 ไม่ระบุขั้วไฟ = คิดค่าน็อต)
 *   4. **สิ่งที่ต้องบวกเพิ่มนอกรหัส** (สาย Silicone · สายถักสแตนเลส · ท่อเฟ็กส์ — คำตอบชุดที่สอง 2026-09-28)
 *   5. **คำตอบของเจ้าของ 2026-09-29** — เจาะรู · PL-5 ว่าง = ยังไม่มีราคา · BH-03 คิดค่ากำลังไฟทุกขนาด · BH-03C ยืนยัน ·
 *      S### / (HPT) ไม่มีผลกับราคา · สายเป็นตัวเลขเปล่า = เมตร · BH-03 `-N` = น็อต · ขนาดเล็กกว่าแคตตาล็อก = เตือน ไม่บล็อก
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
import { parseProductCode, type CodePicks } from '../../services/pricingLab/code.js';
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

  const price = (code: string, picks: CodePicks = {}) => {
    const p = parseProductCode(code, book, picks);
    return { p, o: p.cfg ? computePrice(p.cfg, book) : null };
  };

  // ── 1. รหัสจริงทุกตัว: อ่าน → ช่อง → ประกอบกลับ ─────────────────────────────
  section('1. รหัสจริงในฐาน (products) — อ่านเป็นช่องแล้วประกอบกลับต้องได้รหัสเดิม');
  const { rows } = await pool.query<{ model: string }>(
    `SELECT DISTINCT model FROM products WHERE model ~* '^BH-?0[123]'`
  );
  // ตั้งแต่ 2026-10-01 ทุกรหัสได้ช่อง (เจ้าของ: "ใช้หน้าตา ui เป็นมาตรฐานเดียวกัน อะไรไม่ตรงก็แค่แจ้งเตือน") — รหัสนอกรูปแบบ
  // ได้ช่องที่ติด `loose` ⇒ "ประกอบกลับได้รหัสเดิม" ยังบังคับเฉพาะช่องที่ไม่ติดธง (ตัวที่หน้าจอถือว่าตรงแคตตาล็อก)
  let exact = 0;
  const bad: string[] = [];
  const noForm: string[] = [];
  const loose: string[] = [];
  let spaceFixed = 0;
  for (const { model } of rows) {
    const p = parseProductCode(model, book);
    // ช่องว่างระหว่างตัวเลขต้องเป็นตัวคั่น ไม่ใช่ถูกลบจนขนาดติดกับแรงดัน (`101x150 220` ≠ ความสูง 150220)
    if (/\d\s+\d/.test(model.replace(/^\s*BH-?0\d[A-Z]?\s+/i, '')) && p.parts.some((x) => x.kind === 'noPrice' && /^แรงดัน/.test(x.reads))) spaceFixed++;
    if (!p.form) { if (p.model) noForm.push(model); continue; }
    if (p.form.loose) { loose.push(model); continue; }
    exact++;
    const back = buildBhCode(p.form);
    if (!sameBhCode(back, model.replace(/(\d)\s+(?=\d)/g, '$1-'))) bad.push(`${model}  →  ${back}`);
  }
  check(`รหัส BH ที่รู้รุ่นได้ช่องกรอกทุกตัว (ไม่มีหน้า "ระบบอ่านรหัสนี้ว่าอะไร" แล้ว)`, noForm.length === 0, noForm.slice(0, 4).join(' · '));
  check(`รหัส BH ในฐาน ${rows.length} ตัว · ตรงแคตตาล็อกทุกตัวอักษร ${exact} ตัว (≥ 95%) · นอกรูปแบบ ${loose.length} ตัว`,
    rows.length > 0 && exact >= rows.length * 0.95, `เช่น ${loose.slice(0, 4).join(' · ')}`);
  check('ทุกตัวที่ตรงแคตตาล็อก ประกอบกลับเป็นรหัสเดิม', bad.length === 0, bad.slice(0, 5).join(' | '));
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

  // ข้อ 4: ขนาดเล็กสุดตามแคตตาล็อก — BH-01 25 · BH-01C 60 · BH-03 65 · ตั้งแต่ 2026-09-29 เล็กกว่านี้ = **เตือน** ยังคิดราคาให้
  // (เจ้าของ: "อยากให้แค่เตือนแทนการบล็อก" · "ใช้กับทุกรหัส") ⇒ ข้อที่ต้องจริง: ได้ราคา + มีคำเตือนข้อนั้น · ขนาดปกติไม่มีคำเตือน
  const small = (code: string, id: string) => {
    const o = price(code).o;
    return o?.status === 'priced' && o.violations.some((v) => v.id === id && v.level === 'warn');
  };
  const clean = (code: string) => {
    const o = price(code).o;
    return o?.status === 'priced' && !o.violations.some((v) => v.id.startsWith('MIN_'));
  };
  check('ข้อ 4 BH-01 ID 30 คิดได้ ไม่มีคำเตือน (เดิมติด "OD 65" ของชีต)', clean('BH-01 30x100-220-300W'));
  check('ข้อ 4 BH-01 ID 20 = ได้ราคา + เตือนเล็กกว่าแคตตาล็อก', small('BH-01 20x100-220-300W', 'MIN_ID'));
  check('ข้อ 4 BH-01C ID 50 เตือน · 60 ไม่เตือน', small('BH-01C-50x100-220-300W', 'MIN_ID_C') && clean('BH-01C-60x100-220-300W'));
  check('ข้อ 4 BH-03 ID 60 เตือน · 65 ไม่เตือน', small('BH-03 60x100-220-300W', 'MIN_OD') && clean('BH-03 65x100-220-300W'));
  check('ข้อ 4 BH-01 ออกน็อตสูง 35 เตือน · ออกสายสูง 35 ไม่เตือน', small('BH-01 100x35-220-300W-N', 'MIN_H_NUT') && clean('BH-01 100x35-220-300W'));

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
  check('PL5 = อ่านออก แต่ "ยังไม่มีราคา" (ไม่ใช่ +0) · ขอราคา + ราคาเท่าที่คิดได้ (2026-10-05)', pl5.o?.status === 'quoteOnRequest' && pl5.o.unitPrice > 0 && pl5.o.violations.some((v) => v.id === 'conn_pl5' && v.noRate)
    && !pl5.p.parts.some((x) => x.kind === 'unknown'));
  const z = price('BH-01C-600x150-380-4950W-SE-PL2-Z');
  check('SE / Z = อ่านออก ไม่มีผลกับราคา', z.p.parts.filter((x) => x.text === 'SE' || x.text === 'Z').every((x) => x.kind === 'noPrice')
    && z.p.parts.filter((x) => x.text === 'SE' || x.text === 'Z').length === 2);
  const ex = price('BH-01 140x170-220-2500W-T(HPT)-Z');
  check('ท่อนนอกแคตตาล็อกกลับไปที่เดิมตอนประกอบรหัส', ex.p.form !== undefined && buildBhCode(ex.p.form) === 'BH-01 140x170-220-2500W-T(HPT)-Z',
    ex.p.form ? buildBhCode(ex.p.form) : '');

  // ── 5. สิ่งที่ต้องบวกเพิ่ม (ไม่อยู่ในรหัส) — เจ้าของตอบ 2026-09-28 ─────────────────
  // ความสัมพันธ์ที่ต้องจริงเสมอ ไม่ใช่ตัวเลขราคา: คิดเฉพาะส่วนที่เกินสายมาตรฐาน ปัดขึ้นเป็นเมตรเต็ม · ติ๊กได้พร้อมกัน ·
  // เลือกได้ทุกขั้วไฟ · รหัสไม่เปลี่ยน · BH-03 ออกสาย 1/2/3 ได้
  section('5. สิ่งที่ต้องบวกเพิ่ม (สาย Silicone · สายถักสแตนเลส · ท่อเฟ็กส์) — ไม่อยู่ในรหัส');
  const ADD: [string, string][] = [['cable:silicone', 'cable_silicone'], ['cable:ss_braid', 'cable_ss_braid'], ['flex_tube', 'flex_tube']];
  const B = 'BH-01 180x110-240-2540W';
  for (const [code, id] of ADD) {
    const one = price(`${B}-1`, { addons: [code] });
    const three = price(`${B}-3`, { addons: [code] });
    const half = price(`${B}+1.5M`, { addons: [code] });
    const a1 = rule(one.o, id)?.amount ?? NaN;
    check(`${id}: สาย 1 M = 1 เมตร (เกิน 70 cm ปัดขึ้น) และราคาเพิ่มเท่ากฎข้อนี้พอดี`, rule(one.o, id)?.status === 'applied' && a1 > 0
      && (one.o?.unitPrice ?? 0) - (price(`${B}-1`).o?.unitPrice ?? 0) === a1, `+${a1}`);
    check(`${id}: สาย 3 M = 3 เมตร · 1.5 M = 2 เมตร`, rule(three.o, id)?.amount === a1 * 3 && rule(half.o, id)?.amount === a1 * 2,
      `${rule(three.o, id)?.amount} · ${rule(half.o, id)?.amount}`);
    const std = price(B, { addons: [code] });
    check(`${id}: สายมาตรฐาน 30 cm = ไม่มีค่าเพิ่ม`, rule(std.o, id)?.status !== 'applied' && std.o?.unitPrice === price(B).o?.unitPrice);
    const nut = price(`${B}-N`, { addons: [code] });
    check(`${id}: ออกน็อตยังติ๊กได้ (อ่านออก ไม่เพิ่มเงิน)`, nut.p.form?.addons?.includes(code) === true
      && !nut.p.parts.some((x) => x.kind === 'unknown') && nut.o?.unitPrice === price(`${B}-N`).o?.unitPrice);
    const c01 = price(`BH-01C-600x150-380-4950W-PL-1`, { addons: [code] });
    check(`${id}: BH-01C คิดอัตราเดียวกับ BH-01 (ชีตคอลัมน์ C ไม่คูณสอง)`, rule(c01.o, id)?.amount === a1, `${rule(c01.o, id)?.amount}`);
  }
  const all = price(`${B}-2`, { addons: ADD.map(([c]) => c) });
  const none = price(`${B}-2`);
  const sum = ADD.reduce((t, [, id]) => t + (rule(all.o, id)?.amount ?? NaN), 0);
  check('ติ๊กทั้งสามพร้อมกัน = บวกทั้งสามข้อ', (all.o?.unitPrice ?? 0) - (none.o?.unitPrice ?? 0) === sum, `+${sum}`);
  check('ติ๊กแล้วรหัสไม่เปลี่ยน (อยู่นอกรหัส)', all.p.form !== undefined && buildBhCode(all.p.form) === `${B}-2`
    && all.p.form.addons?.length === 3);
  check('ค่าที่ไม่อยู่ในรายการถูกทิ้ง', price(`${B}-2`, { addons: ['nut', 'x'] }).o?.unitPrice === none.o?.unitPrice);
  const b31 = price('BH-03 160x47-220-1500W-3', { addons: ['cable:ss_braid'] });
  check('BH-03 ออกสาย 3 M อ่านเป็นช่องขั้วไฟ (ไม่คิดค่าน็อต · ไม่มีค่าสายเกิน)', b31.p.form?.term === '3' && !b31.p.parts.some((x) => x.kind === 'unknown')
    && rule(b31.o, 'nut')?.status !== 'applied' && !b31.o?.trace?.rules.some((r) => r.id.startsWith('cable_over') && r.status === 'applied'));
  check('BH-03 ออกสาย 3 M + สายถักสแตนเลส = 3 เมตร', rule(b31.o, 'cable_ss_braid')?.status === 'applied'
    && rule(b31.o, 'cable_ss_braid')?.amount === (rule(price('BH-03 160x47-220-1500W-1', { addons: ['cable:ss_braid'] }).o, 'cable_ss_braid')?.amount ?? NaN) * 3);

  // ── 6. คำตอบของเจ้าของ 2026-09-29 ────────────────────────────────────────────
  // ไม่มีตัวเลขราคาฝังในด่าน — อัตราอ่านจากกฎในเล่ม แล้วตรวจความสัมพันธ์ (จำนวนรู × ขนาด × อัตรา · ตัวเลขเปล่า = M เดียวกัน)
  section('6. คำตอบของเจ้าของ 2026-09-29');
  const bh01 = book.models['BH-01']!;
  const bh03 = book.models['BH-03']!;
  const holdRate = bh01.adders.find((a) => a.id === 'hold')?.rate ?? NaN;
  const holes = [{ count: 2, mm: 20 }, { count: 1, mm: 12 }];
  for (const code of ['BH-01 120x60-220-800W-N', 'BH-01C-600x150-380-4950W-PL-PL2', 'BH-02 100x500-220-1000W', 'BH-03 170x110-220-2700W']) {
    const h = price(code, { holes });
    const r = rule(h.o, 'hold');
    check(`เจาะรู ${code.split(' ')[0]!.split('-').slice(0, 2).join('-')}: 2 รู × Ø20 + 1 รู × Ø12 = 52 mm × อัตราต่อ mm ของกฎ hold`,
      r?.status === 'applied' && r.amount === 52 * holdRate && (h.o?.unitPrice ?? 0) - (price(code).o?.unitPrice ?? 0) === r.amount, `+${r?.amount}`);
  }
  const hf = price('BH-01 120x60-220-800W-N', { holes });
  check('เจาะรู: รหัสไม่เปลี่ยน (อยู่นอกรหัส) · ช่องกรอกได้ค่ากลับ', hf.p.form !== undefined && buildBhCode(hf.p.form) === 'BH-01 120x60-220-800W-N'
    && JSON.stringify(hf.p.form.holes) === JSON.stringify(holes));
  check('เจาะรู: ไม่ได้กรอก = ไม่มีค่าเจาะรู', rule(price('BH-01 120x60-220-800W-N').o, 'hold')?.status !== 'applied');

  const pl5Rule = (m: typeof bh01) => m.adders.find((a) => a.id === 'conn_pl5');
  check('PL-5 เป็นกฎในสมุดราคาทั้ง BH-01 และ BH-03 · ช่องเงินว่าง (กรอกทีหลัง)', [bh01, bh03].every((m) => {
    const a = pl5Rule(m);
    return a?.kind === 'flat' && a.amount === undefined && a.when !== undefined && 'option' in a.when && a.when.option === 'conn:pl5';
  }));
  const pl5b3 = price('BH-03 114x110-230-900W-PL5');
  check('PL-5 ของ BH-03 = "ยังไม่มีราคา" (ไม่ใช่ +0) · ขอราคา', pl5b3.o?.status === 'quoteOnRequest' && pl5b3.o.unitPrice > 0 && pl5b3.o.violations.some((v) => v.id === 'conn_pl5' && v.noRate));
  // กรอกราคาแล้ว (จำลองในหน่วยความจำ) — รุ่นปกติได้ราคานั้น · รุ่น C ที่ว่าง = เท่ารุ่นหลัก (กติกาเดิมของช่อง C) · กรอก C = ใช้ของ C
  const typed = (pl5: number, pl5C?: number) => ({
    ...book,
    models: {
      ...book.models,
      'BH-01': {
        ...bh01,
        adders: bh01.adders.map((a) => (a.id === 'conn_pl5' ? { ...a, amount: pl5 } : a)),
        variant: { ...bh01.variant!, adderPrices: { ...bh01.variant!.adderPrices, ...(pl5C !== undefined ? { conn_pl5: pl5C } : {}) } },
      },
    },
  });
  const withPl5 = (b: typeof book, code: string) => { const p = parseProductCode(code, b); return p.cfg ? computePrice(p.cfg, b) : null; };
  const n200 = withPl5(typed(200), 'BH-01 180x110-240-2540W-PL5');
  check('PL-5 กรอกราคาแล้ว = บวกเท่าที่กรอก', n200?.status === 'priced' && rule(n200, 'conn_pl5')?.amount === 200);
  check('PL-5 รุ่น C: ช่อง C ว่าง = เท่ารุ่นหลัก · กรอก C = ใช้ของ C',
    rule(withPl5(typed(200), 'BH-01C-600x150-380-4950W-PL-PL5'), 'conn_pl5')?.amount === 200
    && rule(withPl5(typed(200, 400), 'BH-01C-600x150-380-4950W-PL-PL5'), 'conn_pl5')?.amount === 400);

  const big = price('BH-03 300x200-220-5000W');
  check('BH-03 พื้นที่เกิน 100 ตร.นิ้ว คิดค่ากำลังไฟตามปกติ', areaOf(big.o) > 100 && rule(big.o, 'watt_over_100')?.status === 'applied'
    && rule(big.o, 'watt_over_100')?.amount === Math.ceil((5000 - 100) / 100) * (bh03.adders.find((a) => a.id === 'watt_over_100')?.rate ?? NaN));
  check('BH-03C ยืนยันแล้ว — บวก % และของแถมตามที่ตั้ง', bh03.variant?.confirmed === true
    && rule(price('BH-03C-200x100-220-2000W').o, 'variant:C')?.status === 'applied');

  const tagged = price('BH-01 100x50-220-600W-N-S000(HPT)');
  check('S### และ (HPT) = อ่านออก ไม่มีผลกับราคา', ['S000', '(HPT)'].every((t) => tagged.p.parts.some((x) => x.text === t && x.kind === 'noPrice'))
    && !tagged.p.parts.some((x) => x.kind === 'unknown') && tagged.o?.unitPrice === price('BH-01 100x50-220-600W-N').o?.unitPrice);
  check('S### / (HPT) ไม่ลามไปซีรีส์อื่น (scope BH-0*)', parseProductCode('TSK-01(M6)4.8+3M-S007', book).parts.some((x) => x.text === 'S007' && x.kind === 'unknown'));

  // เครื่องหมายคูณ `×` = `x` (เจ้าของสั่ง 2026-10-05) — ขนาดอ่านได้ · ช่องกรอกครบ · ราคาเท่ากัน
  const times = price('BH-01 113×50-220-750W');
  check('ขนาด 113×50 = 113x50 (ราคาเท่ากัน · ได้ช่องกรอก)', times.o?.status === 'priced' && !!times.p.form
    && times.o.unitPrice === price('BH-01 113x50-220-750W').o?.unitPrice && !times.p.parts.some((x) => x.kind === 'unknown'));

  const bare = price('BH-01 113x50-220-750W-1.5');
  check('สายเป็นตัวเลขเปล่า = เมตร (1.5 เท่ากับ +1.5M)', rule(bare.o, 'cable_over_30cm')?.status === 'applied'
    && bare.o?.unitPrice === price('BH-01 113x50-220-750W+1.5M').o?.unitPrice && !bare.p.parts.some((x) => x.kind === 'unknown'));
  check('สายตัวเลขเปล่า: ช่องกรอกประกอบกลับเป็นรหัสเดิม', bare.p.form !== undefined && buildBhCode(bare.p.form) === 'BH-01 113x50-220-750W-1.5');
  check('สายตัวเลขเปล่า: เลข 2–3 หลักยังเป็นแรงดัน (ไม่ใช่สาย 50 เมตร)', rule(price('BH-01 100x50-220-500W-50').o, 'cable_over_30cm')?.status !== 'applied');

  const n3 = price('BH-03 180x33-230-848W-N');
  check('BH-03 -N = ออกน็อตครั้งเดียว (เท่ากับไม่ระบุขั้วไฟ)', rule(n3.o, 'nut')?.status === 'applied' && n3.o?.unitPrice === price('BH-03 180x33-230-848W').o?.unitPrice
    && !n3.p.parts.some((x) => x.kind === 'unknown'));
  check('BH-03 -N: ช่องกรอกประกอบกลับเป็นรหัสเดิม', n3.p.form !== undefined && buildBhCode(n3.p.form) === 'BH-03 180x33-230-848W-N');

  const minIds = [...bh01.constraints, ...bh03.constraints].filter((c) => c.id.startsWith('MIN_'));
  check('ข้อห้ามขนาดเล็กสุดทุกข้อของ BH เป็น "เตือน" (BH-01 ห้าข้อ · BH-03 สองข้อ)', minIds.length === 7 && minIds.every((c) => c.level === 'warn'), minIds.map((c) => `${c.id}:${c.level}`).join(' · '));

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
