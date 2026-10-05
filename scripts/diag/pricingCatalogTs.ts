/**
 * ด่านของ "ช่องกรอกตามแคตตาล็อก" ซีรีส์ TS (`services/pricingLab/catalogTs.ts` · docs/pricing-code-ts-catalog.md)
 *
 * คำถามที่ด่านนี้ตอบ:
 *   1. **ช่องกรอก ↔ รหัส กลับกันได้พอดี** — รหัสจริงทุกตัวที่อ่านเป็นช่องได้ ต้องประกอบกลับเป็นรหัสเดิม และคิดราคาได้
 *      เท่ากับพิมพ์รหัสเดิมเป๊ะ (ไม่งั้นหน้าจอจะเปลี่ยนรหัส/ราคาของคนเงียบ ๆ ตอนกดแก้ช่องเดียว)
 *   2. **ตัวเลือกทุกตัวของแคตตาล็อกไปถึงราคา** — เปลี่ยนทีละช่องจากค่าตั้งต้นของทุกตาราง ต้องไม่มีท่อนไหน "อ่านไม่ออก"
 *      (ตัวที่ Excel ยังไม่มีราคาต้องขึ้น "ยังไม่มีราคา" ไม่ใช่ "อ่านไม่ออก" หรือ "ไม่รับผลิต")
 *   3. **คำตอบของเจ้าของ 2026-09-29 เก้าข้อ** เป็นจริงในตัวคิดราคา — เทียบ "ความสัมพันธ์" ที่ต้องจริงเสมอ
 *      ไม่ใช่ตัวเลขราคา (ไม่มี golden — CLAUDE.md): NTC = ฐาน K/J + กฎ NTC · T = แกนเปล่า + หุ้มเทปล่อนเต็ม L1 ·
 *      Spring P ราคาเท่ามีสปริง · F1/F2 = แถวเดียวกัน · หัก L เปิดกฎของชีต ฯลฯ
 *   5. **TS_-01 ค่านอกแคตตาล็อก = ต้องขอราคาจากฝ่ายผลิต** (เจ้าของเคาะ B#2–B#8 + UI แบบ A · 2026-09-29) — ค่าที่ตารางไม่มี
 *      ขึ้นขอราคา · แอดมินเพิ่มช่อง (`applySheetEdit` ตัวเดียวกับ API · ในหน่วยความจำ) แล้วคิดได้ทันที · TS_-01-0 ขนาด Hold Size นอกแคตตาล็อกก็เหมือนกัน (เจ้าของสั่ง 2026-10-05)
 *   7. **ท่อนที่ยังไม่รู้จัก** (`-S###` · `-L` หลังเลขรุ่น · `+MP` / `.` ท้ายสาย) ไม่คิดเงิน ตั้งราคาทีหลังที่ตารางรหัสย่อย และไม่ทำให้
 *      ท่อนอื่นอ่านไม่ออก (เจ้าของสั่ง 2026-10-05)
 *   8. **TS_-02 / TS_-02-SI** (เจ้าของตอบ 2026-10-05) — ราคาตั้งที่แกน 10 · เขี้ยวล็อคไม่มีผลกับราคา · หน้า TS_-02-SI แยกตาราง ·
 *      แกนที่ตารางไม่มีแถว = ขอราคา + แอดมินเพิ่มแถวสีส้มได้ · ตัว S/L หลังเลขรุ่น = นอกแคตตาล็อก + เตือน · สาย `+400mm` = 0.4 เมตร
 *
 * เล่มที่ใช้: เล่มปัจจุบันในฐาน (SELECT อย่างเดียว) + แถวรหัสย่อยจาก `catalog-subcodes.json` ที่ฐานยังไม่มี + ค่ามาตรฐาน
 * เมื่อรหัสไม่ระบุจากแมป (`axisDefaults` — ตัวเดียวกับ `importer.ts --extras-only`) — **ประกอบในหน่วยความจำ ไม่เขียนฐาน**
 * ⇒ ผ่านได้ทั้งก่อนและหลังรันคำสั่งขึ้นระบบ (DEPLOY.md 4.11ข)
 * ถอนโมดูลคิดราคาออก = ลบไฟล์นี้ + ท่อนใน `diag:pricing` ของ package.json ด้วย
 */
import { pool } from '../../config/db.js';
import { NoBook, loadBookFrom } from '../pricebook/bookSource.js';
import { catalogRulesFromMaps } from '../pricebook/catalogRules.js';
import { loadCatalogSubcodes } from '../pricebook/seedCatalogSubcodes.js';
import { listSubCodes } from '../../db/pricingLabRepo.js';
import { withSubCodes } from '../../services/pricingLab/bookStore.js';
import { askValueProblem, modelOfCode, offCatalogValues, parseProductCode, type CodePicks } from '../../services/pricingLab/code.js';
import { computePrice } from '../../services/pricingLab/engine.js';
import { TS_CATALOG, buildTsCode, readTsForm, sameTsCode, slotOptions, tsFamilyOfModel, type TsForm } from '../../services/pricingLab/catalogTs.js';
import { EditRejected, applySheetEdit } from '../../services/pricingLab/modelEditor.js';
import { checkPriceModel } from '../../services/pricingLab/modelShape.js';
import { axisValues } from '../../services/pricingLab/code.js';
import type { PriceBook, SubCode } from '../../services/pricingLab/types.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', YEL = '\x1b[33m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';
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

/** ค่ามาตรฐานเมื่อรหัสไม่ระบุจากแมป ที่เล่มยังไม่มี (TS-11 สาย None = สแตนเลสถัก · ข้อ 5) — แบบเดียวกับ --extras-only */
function withMapDefaults(book: PriceBook): { book: PriceBook; filled: string[] } {
  const maps = catalogRulesFromMaps();
  const models = { ...book.models };
  const filled: string[] = [];
  for (const [code, m] of Object.entries(book.models)) {
    const f = maps.models[code];
    if (!f?.axisDefaults || JSON.stringify(m.axisDefaults) === JSON.stringify(f.axisDefaults)) continue;
    models[code] = { ...m, axisDefaults: f.axisDefaults };
    filled.push(code);
  }
  return { book: { ...book, models }, filled };
}

async function main(): Promise<void> {
  const loaded = await loadBookFrom();
  // ตารางรหัสย่อยในฐานรวมเสมอ แม้เล่มมาจากไฟล์ (`--book` ของ `importer.ts --new-models --out`) — แบบเดียวกับ diag:pricing-diff
  const dbSubs = await listSubCodes();
  const withDefaults = withMapDefaults(loaded.book);
  const book = withSubCodes(withDefaults.book, mergeSeed(dbSubs, loadCatalogSubcodes()));
  console.log(`สมุดราคาที่ใช้: ${loaded.label} + รหัสย่อยจากแคตตาล็อก${withDefaults.filled.length ? ` + ค่ามาตรฐานจากแมป (${withDefaults.filled.join(', ')})` : ''} (ในหน่วยความจำ)`);

  const priceIn = (b: PriceBook, code: string, picks: CodePicks = {}) => {
    const p = parseProductCode(code, b, picks);
    return { p, o: p.cfg ? computePrice(p.cfg, b) : null };
  };
  const price = (code: string, picks: CodePicks = {}) => priceIn(book, code, picks);
  const sig = (r: ReturnType<typeof price>) =>
    JSON.stringify([r.p.model, r.o?.status, r.o?.unitPrice, r.o?.breakdown.map((b) => [b.label, b.amount]), r.o?.violations.map((v) => v.message)]);

  // ── 0. ข้อมูลแคตตาล็อกตรงกับสมุดราคา ─────────────────────────────────────────
  section('0. ทุกตารางของแคตตาล็อกชี้ไปที่รุ่นที่มีอยู่จริงในสมุดราคา');
  // รุ่นที่แมปมีแล้วแต่เล่มนี้ยังไม่มี = ขั้น "เติมรุ่นลงฐาน" ยังค้าง (โค้ดขึ้นก่อนเขียนฐานเสมอ — `importer.ts --new-models` · DEPLOY.md 4.11ข)
  // ⇒ บอกออกมาแล้วข้ามการตรวจของตารางนั้น (เหมือน `withPendingCatalogRules`) · ไม่มีทั้งในเล่มและในแมป = แคตตาล็อกชี้ผิด ⇒ ตก
  // ตรวจของรุ่นใหม่ก่อนเขียนฐาน: `npm run diag:pricing-catalog-ts -- --book <ไฟล์จาก importer.ts --new-models --out>`
  const mapModels = catalogRulesFromMaps().models;
  const pendingModels = new Set(TS_CATALOG.filter((s) => !book.models[s.model] && mapModels[s.model]).map((s) => s.model));
  const catalog = TS_CATALOG.filter((s) => !pendingModels.has(s.model));
  for (const spec of TS_CATALOG) {
    if (pendingModels.has(spec.model)) {
      console.log(`  ${YEL}…${RESET} ${spec.head} → รุ่น ${spec.model} มีในแมปแต่เล่มนี้ยังไม่มี — ยังไม่ได้เติมลงฐาน (importer.ts --new-models) · ข้ามการตรวจของตารางนี้`);
      continue;
    }
    check(`${spec.head} ${spec.family === 'TS_-12R' ? '(RTD) ' : ''}→ รุ่น ${spec.model}`, !!book.models[spec.model]);
  }

  // ── 1. รหัสจริงทุกตัว: อ่าน → ช่อง → ประกอบกลับ → ราคาเท่าเดิม ─────────────────────
  section('1. รหัสจริงในฐาน (products) — อ่านเป็นช่องแล้วประกอบกลับต้องได้รหัสเดิมและราคาเท่าเดิม');
  const { rows } = await pool.query<{ model: string }>(
    `SELECT DISTINCT model FROM products WHERE model ~* '^(TS[A-Z]*|[NP][0-9]{1,2})-(01|02|04|06|08|10|11|12|14|18)'`
  );
  // ตั้งแต่ 2026-10-01 ทุกรหัสได้ช่อง (เจ้าของ: "ใช้หน้าตา ui เป็นมาตรฐานเดียวกัน อะไรไม่ตรงก็แค่แจ้งเตือน") —
  // ตรงแคตตาล็อกทุกตัวอักษร (`readTsForm`) = เกณฑ์เดิมทุกข้อ · นอกรูปแบบ (`readTsFormLoose`) = ประกอบกลับเป็นรหัสเดิมเกือบทุกตัว
  // (ตัวที่ไม่ได้คือท่อนที่เรียงต่างจากแคตตาล็อก — หน้าจอไม่เขียนทับรหัสจนกว่าคนจะแก้ช่อง)
  const byFamily = new Map<string, { all: number; form: number; exact: number }>();
  const bad: string[] = [];
  const looseBad: string[] = [];
  const priceDrift: string[] = [];
  const noForm: string[] = [];
  for (const { model } of rows) {
    const m = modelOfCode(model, book);
    const fam = m ? tsFamilyOfModel(m.code) : undefined;
    if (!fam) continue;
    const r = price(model);
    const famKey = r.p.tsForm?.family ?? fam;
    const stat = byFamily.get(famKey) ?? { all: 0, form: 0, exact: 0 };
    stat.all++;
    if (!r.p.tsForm) noForm.push(model);
    else {
      stat.form++;
      // ตารางที่ตัวอ่านเลือก (รหัส `-SI` = TS_-02-SI ของรุ่น TSK-02 เดียวกัน) — ไม่ใช่ตารางหลักของรุ่น
      const strict = !!readTsForm(model, r.p.tsForm.family);
      if (strict) stat.exact++;
      const back = buildTsCode(r.p.tsForm);
      if (!sameTsCode(back, model)) (strict ? bad : looseBad).push(`${model}  →  ${back}`);
      else if (sig(price(back)) !== sig(r)) priceDrift.push(`${model}  →  ${back}`);
    }
    byFamily.set(famKey, stat);
  }
  let all = 0, exact = 0;
  for (const [fam, s] of [...byFamily.entries()].sort()) {
    all += s.all; exact += s.exact;
    console.log(`     ${fam.padEnd(9)} ตรงทุกตัวอักษร ${String(s.exact).padStart(5)} / ${String(s.all).padStart(5)}  (${((s.exact / s.all) * 100).toFixed(1)}%) · ได้ช่อง ${s.form}`);
  }
  check('รหัส TS ที่รู้รุ่นได้ช่องกรอกทุกตัว (ไม่มีหน้า "ระบบอ่านรหัสนี้ว่าอะไร" แล้ว)', noForm.length === 0, noForm.slice(0, 4).join(' · '));
  check(`รหัส TS ในฐาน ${all} ตัว · ตรงแคตตาล็อกทุกตัวอักษร ${exact} ตัว (≥ 70%)`, all > 0 && exact >= all * 0.7,
    `${((exact / Math.max(all, 1)) * 100).toFixed(1)}%`);
  check('ทุกตัวที่ตรงแคตตาล็อก ประกอบกลับเป็นรหัสเดิม', bad.length === 0, bad.slice(0, 5).join(' | '));
  check(`นอกรูปแบบ: ประกอบกลับเป็นรหัสเดิม ≥ 99.5% (ไม่ได้ ${looseBad.length} ตัว — ท่อนที่เรียงต่างจากแคตตาล็อก)`,
    looseBad.length <= all * 0.005, looseBad.slice(0, 3).join(' | '));
  check('ประกอบกลับแล้วคิดราคาได้เท่าพิมพ์รหัสเดิมทุกบาท', priceDrift.length === 0, priceDrift.slice(0, 5).join(' | '));

  // ── 2. ตัวเลือกทุกตัว → รหัส → อ่านกลับ → ไม่มีท่อนที่อ่านไม่ออก ─────────────────────
  section('2. เปลี่ยนทีละช่องทุกตัวเลือก — อ่านกลับได้ค่าเดิม ไม่มีท่อน "อ่านไม่ออก" และไม่ตกเป็น "ไม่รับผลิต" เพราะตัวอักษร');
  let combos = 0;
  const drift: string[] = [];
  const unread: string[] = [];
  for (const spec of catalog) {
    const probes = spec.slots.probe?.options?.map((x) => x.code) ?? [undefined];
    for (const probe of probes) {
      const baseVals: Record<string, string> = { ...spec.defaults, ...(probe ? { probe } : {}) };
      if (spec.slots.sensor) baseVals.sensor = slotOptions(spec.slots.sensor, baseVals)[0]!.code;
      for (const [key, slot] of Object.entries(spec.slots)) {
        if (slot.kind !== 'choice' || key === 'probe') continue;
        for (const opt of slotOptions(slot, baseVals)) {
          // ขนาดแกนแต่ละขนาดทำได้เฉพาะวัสดุที่ตาราง Diameter Tube ของแคตตาล็อกบอก (10 mm = SUS 316L · 15.97 = 310S · 7 = Titanium)
          // ⇒ ขนาดหนึ่งผ่านเมื่อมีวัสดุในรายการอย่างน้อยหนึ่งตัวที่อ่านได้ครบ — `10` + SUS 304 ไม่ใช่รหัสตามแคตตาล็อก
          const mats = (key === 'd' || key === 'd2') && spec.slots.mat ? spec.slots.mat.options!.map((x) => x.code) : [baseVals.mat ?? ''];
          let firstUnread = '';
          let ok = false;
          for (const mat of mats) {
            const values = { ...baseVals, [key]: opt.code, ...(spec.slots.mat ? { mat } : {}) };
            const form: TsForm = { family: spec.family, values };
            const code = buildTsCode(form);
            combos++;
            const r = price(code);
            const back = r.p.tsForm;
            if (!back || JSON.stringify(back.values) !== JSON.stringify(readTsForm(code, spec.family)?.values) || !sameTsCode(buildTsCode(back), code)) {
              drift.push(code);
              ok = true;
              break;
            }
            const u = r.p.parts.filter((x) => x.kind === 'unknown');
            if (!u.length) { ok = true; break; }
            firstUnread ||= `${code}: ${u.map((x) => `${x.text}(${x.reads.slice(0, 40)})`).join(',')}`;
          }
          if (!ok) unread.push(firstUnread);
        }
      }
    }
  }
  check(`${combos} ชุดค่าจากแคตตาล็อก อ่านกลับเป็นช่องได้ค่าเดิม`, drift.length === 0, drift.slice(0, 4).join(' | '));
  check('ไม่มีตัวเลือกไหนของแคตตาล็อกตกเป็น "อ่านไม่ออก"', unread.length === 0, unread.slice(0, 4).join(' | '));

  // ── 3. คำตอบของเจ้าของ 2026-09-29 ───────────────────────────────────────────
  section('3. คำตอบของเจ้าของ 2026-09-29 เป็นจริงในตัวคิดราคา');
  const base = (o: ReturnType<typeof price>['o']) => o?.breakdown.find((b) => b.step === 'base')?.amount ?? NaN;
  const line = (o: ReturnType<typeof price>['o'], label: RegExp) => o?.breakdown.find((b) => label.test(b.label))?.amount;
  const noRate = (o: ReturnType<typeof price>['o']) => !!o?.violations.some((v) => v.noRate) && !o.violations.some((v) => v.level === 'block' && !v.noRate && !v.missing);

  // ข้อ 1: หัว NTC/PTC = ตาราง K/J เดียวกัน + กฎ NTC/PTC ของชีต
  const k04 = price('TSK-04(S3)6x100+1M');
  const n04 = price('N10-04(S3)6x100+1M');
  const ntcRule = line(n04.o, /NTC/);
  check('ข้อ 1: N10-04 = ราคาตั้งของ TSK-04 ตัวเดียวกัน + กฎ "NTC / PTC บวกเพิ่มจาก Type K/J"',
    n04.o?.status === 'priced' && base(n04.o) === base(k04.o) && ntcRule !== undefined && n04.o.unitPrice === (k04.o?.unitPrice ?? NaN) + ntcRule,
    `${k04.o?.unitPrice} + ${ntcRule} = ${n04.o?.unitPrice}`);
  check('ข้อ 1: P2-11P · N2-06 อ่านเป็น NTC/PTC ของตารางนั้น', price('P2-11P 6x50+1M-PU').p.model === 'TSK-11' && price('N2-06(S4)6x100-U').p.model === 'TSK-06');
  const p1 = price('P1-11P 6x50+1M-PU');
  check('ข้อ 1: P1 (ไม่อยู่ในตาราง Type for NTC/PTC) ไม่มีรุ่น และบอกเหตุผล', !p1.p.model && /ไม่อยู่ในแคตตาล็อก/.test(p1.p.problems.join(' ')), p1.p.problems[0]);
  check('ข้อ 1: NTC แกนต่ำกว่า 5 mm = ยังไม่มีราคา (แคตตาล็อก 5 mm ขึ้นไป)', noRate(price('N10-04(S3)4x100+1M').o));

  // ข้อ 2: T / AT = แกนเปล่า + หุ้มเทปล่อนเต็มความยาว L1
  const plain = price('TSP-08(S4)6x300-U');
  const coat = price('TSP-08(S4)6Tx300-U');
  const coatLine = line(coat.o, /เทปล่อน/);
  check('ข้อ 2: TSP-08 …6Tx300 = ราคาของแกน 6 + "หุ้มเทปล่อน" 3 ช่วง 100 mm', coat.o?.status === 'priced' && coatLine !== undefined &&
    coat.o.unitPrice === (plain.o?.unitPrice ?? NaN) + coatLine && (book.models['TSP-08']?.adders.find((a) => a.id === 'coat_teflon')?.rates?.['6'] ?? NaN) * 3 === coatLine,
    `${plain.o?.unitPrice} + ${coatLine} = ${coat.o?.unitPrice}`);
  const at = price('TSP-08(S4)6ATx300-U');
  check('ข้อ 2: AT ยืนบนแถว 6A (SUS 316L)', at.o?.breakdown.some((b) => b.step === 'base' && /6A/.test(b.detail ?? '')) ?? false);
  check('ข้อ 2: แกนเคลือบนอก 4/6 mm = ยังไม่มีราคา', noRate(price('TSP-08(S4)8Tx300-U').o));

  // ข้อ 3: 2 Element ของชีตที่ไม่มีราคา = ยังไม่มีราคา · ที่มีราคา = กฎของชีต
  for (const code of ['TSK-04(S2)6x100-2+1M', 'TSP-10(S4)6x100-2+1MPU', 'TSP-11 6x100-2+1M-PU', 'TSP-12 6x100-2+1MPU', 'TSK-14 15x100-2BU']) {
    check(`ข้อ 3: ${code} → ยังไม่มีราคา`, noRate(price(code).o));
  }
  check('ข้อ 3: TSK-06 / TS-18 2 Element เปิดกฎของชีต', !!line(price('TSK-06(S4)6x100-2').o, /element/i) && !!line(price('TSK-18(1.5)6-6x100+20-2').o, /element/i));

  // ข้อ 4: Spring P ไม่มีผลกับราคา
  check('ข้อ 4: TSP-11P ราคาเท่า TSP-11', sig(price('TSP-11P 6x50+5M-PU')).replace(/TSP-11P/g, '') !== '' &&
    price('TSP-11P 6x50+5M-PU').o?.unitPrice === price('TSP-11 6x50+5M-PU').o?.unitPrice && price('TSP-11P 6x50+5M-PU').o?.status === 'priced');

  // ข้อ 5: TS-11 สาย None = สแตนเลสถัก ทั้ง TC และ RTD
  const none11 = price('TSP-11 6x50+3M');
  const ss11 = book.models['TSK-11']?.adders.find((a) => a.id === 'cable_over_1m')?.rates?.['สายสแตนเลสถัก'];
  check('ข้อ 5: TSP-11 +3M ไม่บอกชนิดสาย = คิดสายสแตนเลสถัก', none11.o?.status === 'priced' && line(none11.o, /สาย/) === (ss11 ?? NaN) * 2, `${line(none11.o, /สาย/)}`);

  // ข้อ 6: TS-14 B = กฎ "หัวกระโหลก Blacklite ใหญ่" ของชีต (เจ้าของแก้ในฐานแล้วยืนยัน 2026-09-29 "บวกตามที่ผมแก้" — เดิมไม่บวก)
  //         · TS-18 B +ตามกฎหัวอลูมิเนียมใหญ่
  const b14 = price('TSK-14 13x500+150-BU');
  const u14 = price('TSK-14 13x500+150-U');
  const bl14 = line(b14.o, /Blacklite/i);
  check('ข้อ 6: TSK-14 …-BU = …-U + กฎ "หัวกระโหลก Blacklite ใหญ่"', b14.o?.status === 'priced' && bl14 !== undefined && b14.o.unitPrice === (u14.o?.unitPrice ?? NaN) + bl14, `+${bl14}`);
  const b18 = price('TSP-18(1.5)9.5-9.5x100+20-BU');
  const u18 = price('TSP-18(1.5)9.5-9.5x100+20-U');
  const alu = line(b18.o, /อลูมิเนียม/);
  check('ข้อ 6: TS-18 …-BU = …-U + กฎ "หัวกระโหลก อลูมิเนียม ใหญ่"', alu !== undefined && b18.o?.unitPrice === (u18.o?.unitPrice ?? NaN) + alu, `+${alu}`);

  // ข้อ 7: F1–F5 → แถว JIS 10K · F1 = F2
  const f = ['F1', 'F2', 'F3', 'F4', 'F5'].map((x) => price(`TSP-18(${x})9.5-9.5x300+50-U`));
  check('ข้อ 7: F1–F5 คิดราคาได้ทุกตัว (ไม่ขึ้น "ต้องขอราคาจากฝ่ายผลิต")', f.every((r) => r.o?.status === 'priced'), f.map((r) => r.o?.unitPrice).join(' · '));
  check('ข้อ 7: F1 กับ F2 ใช้แถวเดียวกัน', f[0]?.o?.unitPrice === f[1]?.o?.unitPrice);

  // ข้อ 8: หัก L / หักฉาก ติ๊กนอกรหัส = เปิดกฎของชีต (เฉพาะรุ่นที่มีกฎ)
  const bent = price('TSP-08(S4)6x100-U', { addons: ['bend:L'] });
  check('ข้อ 8: ติ๊ก "หัก L" แล้วคิดกฎหัก L ของชีต', !!line(bent.o, /หัก L/) && bent.o!.unitPrice > (price('TSP-08(S4)6x100-U').o?.unitPrice ?? Infinity));
  check('ข้อ 8: รุ่นที่ชีตไม่มีกฎหัก (TS-04) ไม่คิดอะไรเพิ่ม', price('TSK-04(S2)6x100+1M', { addons: ['bend:L'] }).o?.unitPrice === price('TSK-04(S2)6x100+1M').o?.unitPrice);
  check('ข้อ 8: ค่าที่ติ๊กไปอยู่ในช่องกรอกด้วย (ไม่หายตอนแก้ช่องอื่น)', JSON.stringify(bent.p.tsForm?.addons) === '["bend:L"]');

  // ตัวอย่างจาก mockup: เดิมคิดไม่ได้/ไม่ครบ ตอนนี้ครบ
  section('4. ตัวอย่างใน mockup (เดิมคิดไม่ได้หรือไม่ครบ) คิดครบ');
  for (const code of ['TSK-04(S2)6Ax300+3MP', 'TSK-06(S6)8Ax250-2-B', 'TSP-11P 6x50+5M-PU', 'TSK-12 1.5x230+2MS', 'TSP-12 6x100+5MTU',
    'TSK-14(S4)13x600+50-BU', 'TSP-18(F1)9.5-9.5x300+50-BU', 'TSP-10(S4)6Ax290+2MTSU']) {
    const r = price(code);
    const notIn = r.p.parts.filter((x) => x.kind === 'unknown').length + (r.o?.violations.filter((v) => v.partial).length ?? 0);
    check(`${code} → ${r.o?.unitPrice?.toLocaleString() ?? '—'} บาท`, r.o?.status === 'priced' && notIn === 0 && !!r.p.tsForm,
      r.o?.violations.map((v) => v.message).join(' · '));
  }
  check('TS-12 แกน 1.5 กับ Type J ขึ้นคำเตือนตามแคตตาล็อก', price('TSJ-12 1.5x100+1MS').p.warnings.some((w) => /Type K/.test(w)));

  // ── 5. TS_-01: ค่านอกแคตตาล็อก = ต้องขอราคาจากฝ่ายผลิต ─────────────────────────────
  section('5. TS_-01 ค่านอกแคตตาล็อก = ต้องขอราคาจากฝ่ายผลิต · แอดมินเพิ่มช่องเองได้ (เจ้าของเคาะ 2026-09-29)');
  const k01 = book.models['TSK-01']!;
  const asked = (o: ReturnType<typeof price>['o']) => o?.status === 'quoteOnRequest' && o.violations.some((v) => v.askPrice && v.level === 'quoteOnRequest');
  const lenRate = (d: string) => k01.adders.find((a) => a.byAxis === 'D')?.rates?.[d];
  // ค่าที่ตารางยังไม่มี — หาเอง ไม่ผูกกับข้อมูลวันนี้
  const freeT = ['M97', 'M93', 'M89'].find((t) => !axisValues(k01, 'thread').some((v) => v.toUpperCase().startsWith(t)))!;
  const freeS = ['TSQ', 'TSW', 'TSY'].find((x) => !axisValues(k01, 'sensor').includes(x))!;
  const freeD = ['97', '93', '89'].find((d) => lenRate(d) === undefined)!;
  check(`B#3/B#4: เกลียว ${freeT} (ไม่อยู่ในตาราง) → ต้องขอราคา ไม่ใช่ "อ่านไม่ออก/ไม่รับผลิต"`, asked(price(`TSK-01(${freeT})4.8+1M`).o)
    && !price(`TSK-01(${freeT})4.8+1M`).p.parts.some((x) => x.kind === 'unknown'));
  check('B#7: TSK-01(S2) → ต้องขอราคา (ไม่แปลงหุนเป็น 1/4”) · TSK-04(S2) ยังเป็น 1/4” ตามเดิม',
    asked(price('TSK-01(S2)4.8+1M').o) && price('TSK-04(S2)6x100+1M').o?.status === 'priced');
  const tse = price('TSE-01(M6)4.8+1M');
  check('B#6: TSE-01 → ได้รุ่น TSK-01 แล้วขึ้นต้องขอราคา · TS-01 เปล่า ๆ ยังไม่มีรุ่น', tse.p.model === 'TSK-01' && asked(tse.o) && !price('TS-01(M6)4.8+1M').p.model);
  const m6 = price('TSK-01(M6)4.8+1M').o?.unitPrice ?? NaN;
  const d4 = price('TSK-01(M6)4x105+1M');
  const d5 = price('TSK-01(M6)5x105+1M');
  check('B#2: แกน 4 = ราคาตั้ง + อัตราแกน 4.8 · แกน 5 = + อัตราแกน 6 · ไม่มีท่อนที่ยังไม่รวม',
    d4.o?.status === 'priced' && d4.o.unitPrice === m6 + (lenRate('4.8') ?? NaN) && d5.o?.status === 'priced' && d5.o.unitPrice === m6 + (lenRate('6') ?? NaN)
      && ![d4, d5].some((r) => r.o?.violations.some((v) => v.partial) || r.p.parts.some((x) => x.kind === 'unknown')),
    `${d4.o?.unitPrice} · ${d5.o?.unitPrice}`);
  check(`B#2: แกน ${freeD} (ใหญ่กว่าขนาดที่มีอัตรา) → ต้องขอราคา แม้ไม่ยาวเกินมาตรฐาน`, asked(price(`TSK-01(M6)${freeD}+1M`).o));
  const m8on48 = price('TSK-01(M8)4.8+1M');
  check('B#8: M8 กับแกน 4.8 → คิดราคาตามเดิม + เตือนแกนไม่คู่กับเกลียว', m8on48.o?.status === 'priced'
    && m8on48.o.unitPrice === price('TSK-01(M8)6+1M').o?.unitPrice && m8on48.p.warnings.some((w) => /ใช้แกน 6 mm/.test(w)));
  check('B#8: M6 กับแกน 5 (คิดอัตรา 6) → เตือนว่า M6 ใช้แกน 4.8', d5.p.warnings.some((w) => /M6 ใช้แกน 4\.8 mm/.test(w)));
  for (const [alt, main] of [['M8x1.25', 'M8'], ['M10x1.5', 'M10']] as const) {
    const a = price(`TSK-01(${alt})6+1M`);
    check(`หมายเหตุใต้ตาราง: ${alt} ราคาเท่า ${main} และได้ช่องกรอก (${alt})`, a.o?.status === 'priced'
      && a.o.unitPrice === price(`TSK-01(${main})6+1M`).o?.unitPrice && a.p.tsForm?.values.thread === alt);
  }
  const k010 = book.models['TSK-01-0']!;
  const freeH = ['97', '93', '89'].find((h) => !axisValues(k010, 'thread').includes(h))!;
  const t010 = price(`TSK-01-0(${freeH})+1M`);
  check(`TS_-01-0 (2026-10-05): Hold Size ${freeH} ที่ตารางไม่มี → ต้องขอราคา ไม่ใช่ "อ่านไม่ออก" · ช่อง Hold ขึ้นป้าย ask`,
    asked(t010.o) && !t010.p.parts.some((x) => x.kind === 'unknown') && t010.p.tsForm?.issues?.hold === 'ask');

  // แอดมินเพิ่มช่องเองจากหน้าชีต — ตัวรับเดียวกับ PUT /sheet (ในหน่วยความจำ ไม่เขียนฐาน)
  const cable = k01.axisDefaultsBy?.cable?.values ?? {};
  const firstCable = Object.values(cable)[0];
  const edited = applySheetEdit(book, k01.sheet!, {
    'TSK-01': {
      addValues: { thread: [freeT, '1/8”'].filter((x) => !axisValues(k01, 'thread').includes(x)), sensor: [freeS] },
      cells: { [`TSK/TSJ | ${freeT}`]: 123, [`${freeS} | M6x1.0`]: 321 },
      adderRates: { len_l1: [{ value: freeD, rate: 77 }] },
      ...(firstCable ? { defaultsBy: { cable: { ...cable, [freeS]: firstCable } } } : {}),
    },
  });
  const book2: PriceBook = { ...book, models: edited.models };
  const price2 = (code: string) => { const p = parseProductCode(code, book2); return { p, o: p.cfg ? computePrice(p.cfg, book2) : null }; };
  const warned = (o: ReturnType<typeof price>['o']) => !!o?.violations.some((v) => v.askPrice && v.level === 'warn');
  check('เพิ่มคอลัมน์/แถว/ขนาดแกนแล้วสมุดยังผ่านตัวตรวจรูปแบบ', checkPriceModel(edited.models['TSK-01'], 'TSK-01').length === 0);
  const own = price2(`TSK-01(${freeT})4.8+1M`);
  check(`กรอกช่อง TSK/TSJ × ${freeT} แล้วคิดได้ทันที + เตือนว่าใช้ราคาที่แอดมินใส่`, own.o?.status === 'priced' && own.o.unitPrice === 123 && warned(own.o));
  check(`ช่องส้มที่ยังว่าง (TST × ${freeT}) = ยังขอราคาอยู่`, asked(price2(`TST-01(${freeT})4.8+1M`).o));
  check('คอลัมน์ที่เพิ่มแต่ยังไม่กรอก (1/8”) = ยังขอราคาอยู่', asked(price2('TSK-01(1/8)4.8+1M').o));
  const ownS = price2(`${freeS}-01(M6)4.8+1M`);
  check(`แถวหัววัด ${freeS} ที่เพิ่ม → ${freeS}-01 คิดจากแถวของตัวเอง`, ownS.o?.status === 'priced' && ownS.o.unitPrice === 321 && warned(ownS.o));
  check(`แถว ${freeS} ช่องที่ยังว่าง (M8) = ยังขอราคาอยู่`, asked(price2(`${freeS}-01(M8)4.8+1M`).o));
  const ownD = price2(`TSK-01(M6)${freeD}x105+1M`);
  check(`แกน ${freeD} ที่เพิ่มพร้อมอัตรา → ราคาตั้งของคอลัมน์เกลียว + อัตราใหม่`, ownD.o?.status === 'priced' && ownD.o.unitPrice === m6 + 77 && warned(ownD.o));
  const rejects = (body: unknown) => { try { applySheetEdit(book, k01.sheet!, { 'TSK-01': body }); return false; } catch (e) { return e instanceof EditRejected; } };
  check('ตัวรับปฏิเสธ: เกลียวที่ชนคอลัมน์เดิม (M8x1.25) · ค่าที่อยู่ในแคตตาล็อก (TSK · แกน 6) · รูปแบบผิด (m12)',
    rejects({ addValues: { thread: ['M8x1.25'] } }) && rejects({ addValues: { sensor: ['TSK'] } })
      && rejects({ adderRates: { len_l1: [{ value: '6.0', rate: 1 }] } }) && rejects({ addValues: { thread: ['m12'] } }));
  check('ตัวรับปฏิเสธ: Hold Size ที่อยู่ในแคตตาล็อกของ TS_-01-0 (M6) เพิ่มซ้ำไม่ได้', (() => {
    try { applySheetEdit(book, k010.sheet!, { 'TSK-01-0': { addValues: { thread: ['M6'] } } }); return false; } catch (e) { return e instanceof EditRejected; }
  })());
  const e010 = applySheetEdit(book, k010.sheet!, { 'TSK-01-0': { addValues: { thread: [freeH] }, cells: { [`TSK/TSJ | ${freeH}`]: 135 } } });
  const book3: PriceBook = { ...book, models: e010.models };
  const p3 = (code: string) => { const p = parseProductCode(code, book3); return { p, o: p.cfg ? computePrice(p.cfg, book3) : null }; };
  const own010 = p3(`TSK-01-0(${freeH})+1M`);
  check(`TS_-01-0: แอดมินเพิ่มคอลัมน์ ${freeH} + กรอก TSK/TSJ → คิดได้ทันที + เตือน · TST ช่องที่ยังว่าง = ยังขอราคา`,
    checkPriceModel(e010.models['TSK-01-0'], 'TSK-01-0').length === 0 && own010.o?.status === 'priced' && own010.o.unitPrice === 135
      && warned(own010.o) && asked(p3(`TST-01-0(${freeH})+1M`).o));
  const again = (body: unknown) => { try { return applySheetEdit(book2, k01.sheet!, { 'TSK-01': body }); } catch (e) { return e instanceof EditRejected ? null : undefined; } };
  check('เอาออก: คอลัมน์ที่ยังมีตัวเลขเอาออกไม่ได้ · ล้างตัวเลขพร้อมกันแล้วเอาออกได้',
    again({ removeValues: { thread: [freeT] } }) === null && !!again({ cells: { [`TSK/TSJ | ${freeT}`]: null }, removeValues: { thread: [freeT] } }));

  // ── 6. ทุกรหัสได้ช่องแบบเดียว · อะไรไม่ตรงแค่แจ้งเตือน (เจ้าของเคาะ mockup `pricing-one-form.html` 2026-10-01) ──────────
  // ตรวจเฉพาะสิ่งที่ต้องจริงเสมอ (ป้ายของช่อง · ประกอบกลับ · ความสัมพันธ์ของราคา) ไม่เทียบตัวเลขราคากับไฟล์ที่จดไว้
  section('6. รหัสนอกรูปแบบได้ช่องพร้อมป้ายเตือนรายช่อง · ต้องขอราคา = ราคาเท่าที่คิดได้');
  {
  const f = (code: string) => price(code);
  const m5 = f('TSP-01-0(M5)+3MTU-S000');
  check('ตัวอย่าง 1: เขียน (M5) มาตรฐานออกมา = ช่อง Hold เป็นค่ามาตรฐาน ไม่มีป้ายเตือน · ประกอบกลับคง (M5)',
    m5.p.tsForm?.values.hold === '' && m5.p.tsForm.written?.hold === 'M5' && !m5.p.tsForm.issues?.hold
      && sameTsCode(buildTsCode(m5.p.tsForm), 'TSP-01-0(M5)+3MTU-S000')
      && m5.o?.unitPrice === f('TSP-01-0+3MTU-S000').o?.unitPrice);
  const cm = f('TSK-01 4.8+30cm');
  check('ตัวอย่าง 2: สายเป็น cm = ช่องสายเก็บ 30 หน่วย cm ไม่เตือน · แก้ชนิดสายแล้วยังเป็น cm',
    cm.p.tsForm?.clUnit === 'cm' && cm.p.tsForm.values.cl === '30' && !cm.p.tsForm.issues
      && sameTsCode(buildTsCode({ ...cm.p.tsForm, values: { ...cm.p.tsForm.values, cable: 'T' } }), 'TSK-01 4.8+30cmT'));
  const d4 = f('TSK-01(M6)4+1.5M');
  check('ตัวอย่าง 3: แกนนอกแคตตาล็อก = ป้าย off ที่ช่องแกน · เลือก 4.8 แล้วรหัสเป็นของแคตตาล็อก',
    d4.p.tsForm?.issues?.d === 'off' && d4.p.tsForm.written?.d === '4' && d4.o?.status === 'priced'
      && buildTsCode({ ...d4.p.tsForm, values: { ...d4.p.tsForm.values, d: '4.8' }, written: undefined, issues: undefined }) === 'TSK-01(M6)4.8+1.5M');
  const ask = f('TSK-01(M13)4.8x50+2MT');
  const sum = (ask.o?.breakdown ?? []).reduce((t, b) => t + (b.amount ?? 0), 0);
  check('ตัวอย่าง 4: เกลียวต้องขอราคา = ป้าย ask · สถานะยังขอราคา · ราคาเท่าที่คิดได้ = ผลรวมกฎที่คิด (ไม่มีราคาตั้ง)',
    ask.p.tsForm?.issues?.thread === 'ask' && ask.o?.status === 'quoteOnRequest' && sum > 0 && ask.o.unitPrice === sum
      && !ask.o.breakdown.some((b) => b.step === 'base'), `${ask.o?.status} ${ask.o?.unitPrice} = ${sum}`);
  const tse = f('TSE-01(M6)4.8+3M');
  check('หัววัดต้องขอราคา + สายตั้งต้นที่ขึ้นกับหัววัด = ยังขอราคา (ไม่ตกเป็นไม่รับผลิต) · กฎที่คิดไม่ได้ขึ้น "ยังไม่รวม"',
    tse.p.tsForm?.issues?.sensor === 'ask' && tse.o?.status === 'quoteOnRequest'
      && !tse.o.violations.some((v) => v.level === 'block'), tse.o?.violations.map((v) => `${v.level}:${v.message}`).join(' · '));
  const junk = f('TSK-01-L(M6)4.8+1M');
  check('ตัวอย่าง 5 (2026-10-05): -L หลังเลขรุ่น = ท่อนไม่รู้จัก (ชิป) · เกลียว/แกนข้างหลังยังอ่านได้ · ราคาเท่ารหัสที่ไม่มี -L · ประกอบกลับที่ตำแหน่งเดิม',
    junk.p.tsForm?.headJunk === '-L' && !junk.p.tsForm.issues && junk.p.tsForm.values.thread === 'M6' && junk.p.tsForm.values.d === '4.8'
      && junk.p.parts.some((x) => x.kind === 'unknown' && x.text === '-L' && x.subCode === 'L')
      && junk.o?.unitPrice === f('TSK-01(M6)4.8+1M').o?.unitPrice && sameTsCode(buildTsCode(junk.p.tsForm), 'TSK-01-L(M6)4.8+1M'));
  const h15 = f('TSK-01-0(15)+2M-S000');
  const h15sum = (h15.o?.breakdown ?? []).reduce((t, b) => t + (b.amount ?? 0), 0);
  check('ตัวอย่าง 6 (2026-10-05): TS_-01-0 Hold Size นอกแคตตาล็อก = ป้าย ask · ขอราคา · ราคาเท่าที่คิดได้ = ค่าสาย',
    h15.p.tsForm?.issues?.hold === 'ask' && h15.o?.status === 'quoteOnRequest' && h15sum > 0 && h15.o.unitPrice === h15sum
      && !h15.o.breakdown.some((b) => b.step === 'base'), `${h15.o?.status} ${h15.o?.unitPrice}`);
  // 7. ท่อนที่ยังไม่รู้จัก — ไม่คิดเงิน · มีชื่อให้ตั้งในตารางรหัสย่อย · ไม่ทำให้ท่อนอื่นหายจากราคา
  const sx = f('TSK-01(M6)4.8+3M-S007');
  check('-S### = ท่อนไม่รู้จัก (ตั้งได้ในตารางรหัสย่อย) · ราคาเท่ารหัสที่ไม่มี -S###',
    sx.p.parts.some((x) => x.kind === 'unknown' && x.subCode === 'S007') && sx.o?.unitPrice === f('TSK-01(M6)4.8+3M').o?.unitPrice);
  const mp = f('TSK-01(M6)4.8+1.8M+MP');
  check('+MP ท้ายสาย = ท่อนไม่รู้จักแยกจากความยาวสาย · ค่าสายยังคิด (เท่ารหัสที่ไม่มี +MP) · ช่องสายไม่ขึ้น unread',
    mp.p.parts.some((x) => x.kind === 'unknown' && x.text === '+MP' && x.subCode === 'MP') && mp.o?.unitPrice === f('TSK-01(M6)4.8+1.8M').o?.unitPrice
      && !mp.p.tsForm?.issues?.cl && sameTsCode(buildTsCode(mp.p.tsForm!), 'TSK-01(M6)4.8+1.8M+MP'));
  const dot = f('TSK-01(M6)4.8x9+3M.');
  check('จุดท้ายรหัส = ท่อนไม่รู้จัก · ไม่ไปทับจุดของแกน 4.8 · ราคาเท่ารหัสที่ไม่มีจุด',
    !dot.p.tsForm?.issues && dot.o?.unitPrice === f('TSK-01(M6)4.8x9+3M').o?.unitPrice);
  const hs = f('TSK-01-0-S(4.2)+1M');
  check('-S หลังเลขรุ่น TS_-01-0 = ท่อนไม่รู้จัก · Hold Size ข้างหลังยังอ่าน (ไม่ตกไปใช้ M5 มาตรฐานเงียบ ๆ)',
    hs.p.parts.some((x) => x.kind === 'unknown' && x.text === '-S') && hs.p.tsForm?.issues?.hold === 'ask' && hs.o?.status === 'quoteOnRequest');
  const sfx = f('TSP-08S(S4)5x160-U');
  check('ตัวอักษรติดเลขรุ่น (TSP-08S) ไม่ไปทับช่องเกลียว (S4) / หัววัด', !sfx.p.tsForm?.issues?.thread && !sfx.p.tsForm?.issues?.probe);
  const exactForm = f('TSK-01(M6)4.8+1M');
  check('รหัสตรงแคตตาล็อก = ไม่มีของ "ตามที่เขียน" ติดมา (ช่องแบบเดิมทุกอย่าง)',
    !!exactForm.p.tsForm && !exactForm.p.tsForm.issues && !exactForm.p.tsForm.written && !exactForm.p.tsForm.tail && !exactForm.p.tsForm.omit);
  }

  // ── 8. TS_-02 / TS_-02-SI (เจ้าของตอบ 2026-10-05) ─────────────────────────────────────
  section('8. TS_-02 / TS_-02-SI — คำตอบของเจ้าของ 2026-10-05 เป็นจริงในตัวคิดราคา');
  const k02 = book.models['TSK-02'];
  if (!k02) {
    console.log(`  ${YEL}…${RESET} เล่มนี้ยังไม่มี TSK-02 — ข้าม (ตรวจก่อนเขียนฐานด้วย -- --book <ไฟล์จาก importer.ts --new-models --out>)`);
  } else {
    const len02 = (d: string) => k02.adders.find((a) => a.id === 'len_l1')?.rates?.[d] ?? NaN;
    const cell02 = (key: string) => k02.base.kind === 'matrix' ? k02.base.cells[key] : undefined;
    const p10 = price('TSK-02(12)4.8x10+1M');
    const p25 = price('TSK-02(12)4.8x25+1M');
    const p12 = price('TSK-02(12)4.8x12+1M');
    check('ข้อ 1: ราคาตั้งที่แกน 10 mm (= ช่อง 4.8 · Type K/J · TS-02 ของชีต) ไม่มีค่าความยาว',
      p10.o?.status === 'priced' && p10.o.unitPrice === cell02('4.8 | Type K/J | TS-02') && p10.o.breakdown.length === 1, `${p10.o?.unitPrice}`);
    check('ข้อ 1: แกน 25 = ราคาตั้ง + 3 ช่วง 5 mm ของแกน 4.8 · แกน 12 = 1 ช่วง (ปัดขึ้น)',
      p25.o?.unitPrice === (p10.o?.unitPrice ?? NaN) + 3 * len02('4.8') && p12.o?.unitPrice === (p10.o?.unitPrice ?? NaN) + len02('4.8'),
      `${p25.o?.unitPrice} · ${p12.o?.unitPrice}`);
    check('ข้อ 2: แกนสั้นกว่า 10 mm (5 · 7) = ราคาตั้ง',
      ['TSK-02(12)4.8x5+1M', 'TSK-02(12)4.8x7+1M'].every((c) => price(c).o?.status === 'priced' && price(c).o?.unitPrice === p10.o?.unitPrice));
    const s115 = price('TSK-02(11.5)4.8x10+1M');
    const si115 = price('TSK-02-SI(11.5)4.8x10+1M');
    const si12 = price('TSK-02-SI(12)4.8x10+1M');
    check('ข้อ 3: เขี้ยวล็อค 11.5 กับ TS_-02 ธรรมดา ราคาเท่าเขี้ยวล็อคขนาดอื่น + เตือนว่าทำได้เฉพาะ TS-02-SI',
      s115.o?.status === 'priced' && s115.o.unitPrice === p10.o?.unitPrice && s115.p.warnings.some((w) => /11\.5.*เฉพาะ TS-02-SI/.test(w)), s115.p.warnings.join(' · '));
    check('ข้อ 3: TS_-02-SI กับ 11.5 ไม่เตือน · ราคา = คอลัมน์ TS-02-SI ของชีต (เท่าเขี้ยวล็อค 12)',
      !si115.p.warnings.length && si115.o?.unitPrice === cell02('4.8 | Type K/J | TS-02-SI') && si115.o?.unitPrice === si12.o?.unitPrice, `${si115.o?.unitPrice}`);
    const pB = price('TSP-02(12)5x10+1M');
    const pA = price('TSPA-02(12)5x10+1M');
    check('TSP = PT100 Class B · TSPA = PT100 Class A (หัวคอลัมน์ไม่มีรหัสตระกูลกำกับ — คนละคอลัมน์)',
      pB.o?.unitPrice === cell02('5 | PT100 (Class B) | TS-02') && pA.o?.unitPrice === cell02('5 | PT100 (Class A) | TS-02') && pA.o?.unitPrice !== pB.o?.unitPrice);
    const off = price('TSK-02(12.5)4.8x10+1M');
    check('เขี้ยวล็อคนอกแคตตาล็อก (12.5) = ไม่มีผลกับราคา + เตือน · ไม่ใช่ท่อนที่ยังไม่รู้จัก · ช่องกรอกขึ้นป้ายนอกแคตตาล็อก',
      off.o?.unitPrice === p10.o?.unitPrice && off.p.warnings.some((w) => /12\.5.*ไม่อยู่ในแคตตาล็อก/.test(w))
        && !off.p.parts.some((x) => x.kind === 'unknown') && off.p.tsForm?.issues?.id === 'off');
    const bare = price('TSJ-02 5x50+2M');
    check('ไม่ระบุเขี้ยวล็อค = คิดราคาได้ + เตือน · ช่องกรอกขึ้น missing · ประกอบกลับเป็นรหัสเดิม',
      bare.o?.status === 'priced' && bare.p.warnings.some((w) => /ไม่ได้ระบุขนาดเขี้ยวล็อค/.test(w)) && bare.p.tsForm?.issues?.id === 'missing'
        && sameTsCode(buildTsCode(bare.p.tsForm), 'TSJ-02 5x50+2M'));
    check('เขี้ยวล็อคไม่คู่กับแกน (14.5 กับแกน 5) = ราคาเท่าเดิม + เตือน',
      price('TSK-02(14.5)5x10+1M').o?.unitPrice === price('TSK-02(12)5x10+1M').o?.unitPrice && price('TSK-02(14.5)5x10+1M').p.warnings.some((w) => /ใช้กับแกน/.test(w)));
    // แคตตาล็อก TS_-02-SI แยกหน้า (เจ้าของส่งมา 2026-10-05) — รหัส -SI ได้ตารางของตัวเอง รุ่นในสมุดเดิม
    check('TS_-02-SI: รหัส -SI ได้ช่องของหน้า TS_-02-SI (ไม่มีช่องรุ่นย่อย) · ประกอบกลับเป็นรหัสเดิม · ราคาคอลัมน์ TS-02-SI',
      si115.p.tsForm?.family === 'TS_-02-SI' && !('sub' in (si115.p.tsForm?.values ?? {})) && sameTsCode(buildTsCode(si115.p.tsForm!), 'TSK-02-SI(11.5)4.8x10+1M')
        && p10.p.tsForm?.family === 'TS_-02', `${si115.p.tsForm?.family} · ${p10.p.tsForm?.family}`);
    // ขนาดแกนที่ตารางไม่มีแถว = ขอราคา (เจ้าของสั่ง 2026-10-05) — เดิม "รหัสไม่ได้บอกขนาดแกน" (บล็อก) ทั้งที่รหัสบอกแล้ว
    const d32 = price('TSK-02(12.7)3.2x200+5M');
    const d25a = price('TSK-02-SI(12)2.5Ax25+1.5M');
    check('แกน 3.2 · 2.5A (นอกแคตตาล็อก) = ต้องขอราคาจากฝ่ายผลิต + ราคาเท่าที่คิดได้ · ช่องกรอกขึ้น ask · ไม่ใช่ "รหัสไม่ได้บอก"',
      [d32, d25a].every((x) => x.o?.status === 'quoteOnRequest' && x.o.violations.some((v) => v.askPrice && /ขอราคา/.test(v.message))
        && !x.o.violations.some((v) => v.missing) && x.p.tsForm?.issues?.d === 'ask' && x.p.cfg?.askPrice?.D !== undefined)
        && d32.p.cfg?.askPrice?.D === '3.2' && d25a.p.cfg?.askPrice?.D === '2.5A', `${d32.o?.status} · ${d25a.o?.status}`);
    // แอดมินเพิ่มแถว 3.2 ที่หน้าชีต (ช่องสีส้ม) แล้วกรอก — ตัวรับเดียวกับ PUT /sheet (ในหน่วยความจำ ไม่เขียนฐาน)
    const sheet02 = (b: PriceBook, body: unknown) => applySheetEdit(b, k02.sheet!, { 'TSK-02': body }).models;
    const bookE: PriceBook = { ...book, models: sheet02(book, { addValues: { D: ['3.2'] } }) };
    const empty32 = priceIn(bookE, 'TSK-02(12.7)3.2x200+5M');
    const bookF: PriceBook = { ...book, models: sheet02(bookE, { cells: { '3.2 | Type K/J | TS-02': 700 }, adderRates: { len_l1: [{ value: '3.2', rate: 20 }] } }) };
    const set32 = priceIn(bookF, 'TSK-02(12.7)3.2x200+5M');
    const si32 = priceIn(bookF, 'TSK-02-SI(12.7)3.2x200+5M');
    check('แอดมินเพิ่มแถวแกน 3.2: ยังว่าง = ขอราคา · กรอกแล้ว = ราคาตั้ง 700 + ความยาว 38 ช่วง × 20 + สาย · เตือนว่าใช้ราคาที่แอดมินใส่ · ช่อง SI ที่ยังว่าง = ขอราคา',
      empty32.o?.status === 'quoteOnRequest' && set32.o?.status === 'priced'
        && set32.o.unitPrice === 700 + 38 * 20 + (line(set32.o, /สาย/) ?? NaN)
        && set32.o.violations.some((v) => v.level === 'warn' && v.askPrice) && si32.o?.status === 'quoteOnRequest'
        && checkPriceModel(bookF.models['TSK-02'], 'TSK-02').length === 0, `${empty32.o?.status} · ${set32.o?.unitPrice} · SI ${si32.o?.status}`);
    const a02 = bookF.models['TSK-02']!;
    check('ช่องสีส้มของหน้าสมุดราคา: แถว 3.2 ที่เพิ่ม = นอกแคตตาล็อก · แถว 4A/6.35A ของ Excel ไม่ใช่',
      JSON.stringify(offCatalogValues(a02).D) === JSON.stringify(['3.2']) && offCatalogValues(k02).D === undefined, JSON.stringify(offCatalogValues(a02)));
    const again02 = (body: unknown) => { try { return sheet02(bookF, body); } catch (e) { return e instanceof EditRejected ? null : undefined; } };
    check('เอาแถว 3.2 ออก: ยังมีราคาตั้งหรืออัตราความยาวแกนอยู่ = ไม่ได้ · ล้างทั้งสองพร้อมกันแล้วเอาออกได้',
      again02({ removeValues: { D: ['3.2'] } }) === null
        && again02({ cells: { '3.2 | Type K/J | TS-02': null }, removeValues: { D: ['3.2'] } }) === null
        && !!again02({ cells: { '3.2 | Type K/J | TS-02': null }, adderRates: { len_l1: [{ value: '3.2', rate: null }] }, removeValues: { D: ['3.2'] } }));
    check('เพิ่มแถวจากจอ: 3.2 / 2.5A ได้ · 6 / 4.8A (แคตตาล็อก) / 2.5X (วัสดุนอกรายการ) ไม่ได้',
      askValueProblem(k02, 'd', '3.2') === undefined && askValueProblem(k02, 'd', '2.5A') === undefined
        && !!askValueProblem(k02, 'd', '6') && !!askValueProblem(k02, 'd', '4.8A') && !!askValueProblem(k02, 'd', '2.5X'));
    // ตัว S / L หลังเลขรุ่น = นอกแคตตาล็อก คิดตามรุ่นฐาน + เตือน · ตั้งราคาทีหลังที่ตารางรหัสย่อยชื่อ 02S (เจ้าของเคาะ 2026-10-05)
    const s02 = price('TSJ-02S(12)5x10+1.5M');
    const plain02 = price('TSJ-02(12)5x10+1.5M');
    check('TSJ-02S = ราคาเท่า TSJ-02 + เตือนบนจอ "ยังไม่รวมส่วนของตัว S" · ท่อน S ตั้งได้ที่ตารางรหัสย่อยชื่อ 02S',
      s02.o?.status === 'priced' && s02.o.unitPrice === plain02.o?.unitPrice && s02.p.warnings.some((w) => /ยังไม่รวมส่วนของตัว S/.test(w))
        && s02.p.parts.some((x) => x.kind === 'unknown' && x.subCode === '02S'), s02.p.warnings.join(' · '));
    // สายเขียนเป็น mm — `+400mm` = 0.4 เมตร (เดิม 400 เมตร ได้ราคา 65,160 บาท · 2026-10-05)
    const mm02 = price('TSP-02(12)5x11+400mm.-TSU');
    check('สาย +400mm = 0.4 เมตร ไม่บวกค่าสาย · ช่องกรอกจำหน่วย mm · ประกอบกลับเป็นรหัสเดิม',
      mm02.p.cfg?.dims?.cable_m === 0.4 && !line(mm02.o, /สาย/) && mm02.p.tsForm?.clUnit === 'mm' && sameTsCode(buildTsCode(mm02.p.tsForm!), 'TSP-02(12)5x11+400mm.-TSU'),
      `${mm02.o?.unitPrice}`);
    const si8 = price('TSK-02-SI(15.5)8x10+1M');
    check('TS_-02-SI แกน 8 (ชีตเว้นว่าง) = ต้องขอราคา ไม่ใช่ไม่รับผลิต', si8.o?.status === 'quoteOnRequest' && !!si8.o.violations.some((v) => v.noRate));
    const none02 = price('TSP-02(12)5x10+3M');
    const ss02 = k02.adders.find((a) => a.id === 'cable_over_1m')?.rates?.['สายสแตนเลสถัก'];
    check('สายไม่ระบุชนิด = สแตนเลสถัก ตามแคตตาล็อก (แม้ PT100)', none02.o?.status === 'priced' && line(none02.o, /สาย/) === (ss02 ?? NaN) * 2, `${line(none02.o, /สาย/)}`);
  }
}

main()
  .catch((e) => {
    if (e instanceof NoBook) { console.log(`ข้าม — ${e.message}`); return; }
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await pool.end();
    console.log(`\n${fail ? RED : GREEN}${pass} ผ่าน · ${fail} ไม่ผ่าน${RESET}`);
    process.exit(fail ? 1 : 0);
  });
