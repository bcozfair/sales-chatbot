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
import { modelOfCode, parseProductCode, type CodePicks } from '../../services/pricingLab/code.js';
import { computePrice } from '../../services/pricingLab/engine.js';
import { TS_CATALOG, buildTsCode, readTsForm, sameTsCode, slotOptions, tsFamilyOfModel, type TsForm } from '../../services/pricingLab/catalogTs.js';
import type { PriceBook, SubCode } from '../../services/pricingLab/types.js';

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
  const dbSubs = loaded.from === 'db' ? await listSubCodes() : [];
  const withDefaults = withMapDefaults(loaded.book);
  const book = withSubCodes(withDefaults.book, mergeSeed(dbSubs, loadCatalogSubcodes()));
  console.log(`สมุดราคาที่ใช้: ${loaded.label} + รหัสย่อยจากแคตตาล็อก${withDefaults.filled.length ? ` + ค่ามาตรฐานจากแมป (${withDefaults.filled.join(', ')})` : ''} (ในหน่วยความจำ)`);

  const price = (code: string, picks: CodePicks = {}) => {
    const p = parseProductCode(code, book, picks);
    return { p, o: p.cfg ? computePrice(p.cfg, book) : null };
  };
  const sig = (r: ReturnType<typeof price>) =>
    JSON.stringify([r.p.model, r.o?.status, r.o?.unitPrice, r.o?.breakdown.map((b) => [b.label, b.amount]), r.o?.violations.map((v) => v.message)]);

  // ── 0. ข้อมูลแคตตาล็อกตรงกับสมุดราคา ─────────────────────────────────────────
  section('0. ทุกตารางของแคตตาล็อกชี้ไปที่รุ่นที่มีอยู่จริงในสมุดราคา');
  for (const spec of TS_CATALOG) {
    check(`${spec.head} ${spec.family === 'TS_-12R' ? '(RTD) ' : ''}→ รุ่น ${spec.model}`, !!book.models[spec.model]);
  }

  // ── 1. รหัสจริงทุกตัว: อ่าน → ช่อง → ประกอบกลับ → ราคาเท่าเดิม ─────────────────────
  section('1. รหัสจริงในฐาน (products) — อ่านเป็นช่องแล้วประกอบกลับต้องได้รหัสเดิมและราคาเท่าเดิม');
  const { rows } = await pool.query<{ model: string }>(
    `SELECT DISTINCT model FROM products WHERE model ~* '^(TS[A-Z]*|[NP][0-9]{1,2})-(01|04|06|08|10|11|12|14|18)'`
  );
  const byFamily = new Map<string, { all: number; form: number }>();
  const bad: string[] = [];
  const priceDrift: string[] = [];
  for (const { model } of rows) {
    const m = modelOfCode(model, book);
    const fam = m ? tsFamilyOfModel(m.code) : undefined;
    if (!fam) continue;
    const r = price(model);
    const famKey = r.p.tsForm?.family ?? fam;
    const stat = byFamily.get(famKey) ?? { all: 0, form: 0 };
    stat.all++;
    if (r.p.tsForm) {
      stat.form++;
      const back = buildTsCode(r.p.tsForm);
      if (!sameTsCode(back, model)) bad.push(`${model}  →  ${back}`);
      else if (sig(price(back)) !== sig(r)) priceDrift.push(`${model}  →  ${back}`);
    }
    byFamily.set(famKey, stat);
  }
  let all = 0, withForm = 0;
  for (const [fam, s] of [...byFamily.entries()].sort()) {
    all += s.all; withForm += s.form;
    console.log(`     ${fam.padEnd(9)} ${String(s.form).padStart(5)} / ${String(s.all).padStart(5)}  (${((s.form / s.all) * 100).toFixed(1)}%)`);
  }
  check(`รหัส TS ในฐาน ${all} ตัว · อ่านเป็นช่องตามแคตตาล็อกได้ ${withForm} ตัว (≥ 70%)`, all > 0 && withForm >= all * 0.7,
    `${((withForm / Math.max(all, 1)) * 100).toFixed(1)}%`);
  check('ทุกตัวที่อ่านเป็นช่องได้ ประกอบกลับเป็นรหัสเดิม', bad.length === 0, bad.slice(0, 5).join(' | '));
  check('ประกอบกลับแล้วคิดราคาได้เท่าพิมพ์รหัสเดิมทุกบาท', priceDrift.length === 0, priceDrift.slice(0, 5).join(' | '));

  // ── 2. ตัวเลือกทุกตัว → รหัส → อ่านกลับ → ไม่มีท่อนที่อ่านไม่ออก ─────────────────────
  section('2. เปลี่ยนทีละช่องทุกตัวเลือก — อ่านกลับได้ค่าเดิม ไม่มีท่อน "อ่านไม่ออก" และไม่ตกเป็น "ไม่รับผลิต" เพราะตัวอักษร');
  let combos = 0;
  const drift: string[] = [];
  const unread: string[] = [];
  for (const spec of TS_CATALOG) {
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

  // ข้อ 6: TS-14 B ไม่บวก · TS-18 B +ตามกฎหัวอลูมิเนียมใหญ่
  check('ข้อ 6: TSK-14 …-BU ราคาเท่า …-U', price('TSK-14 13x500+150-BU').o?.unitPrice === price('TSK-14 13x500+150-U').o?.unitPrice && price('TSK-14 13x500+150-BU').o?.status === 'priced');
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
