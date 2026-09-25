/**
 * ด่าน "แก้ราคาทีละรุ่นจากหน้าจอ" — เฟสที่เจ้าของสั่งเมื่อ 2026-09-23
 *
 * ตอบสามคำถามที่ตารางราคาจะพังเงียบ ๆ ถ้าไม่มีใครถาม:
 *   1. ตัวเลือกท้ายรหัส (ซีรีส์ BH = ตัว C) คิดราคาถูกไหม และครอบรหัสที่ขายจริงครบไหม
 *      — `BH-02C` / `BH-03C` เคยตกไปคิดเป็นรุ่นฐานเปล่า ๆ โดยไม่มีอะไรฟ้อง
 *   2. สิ่งที่หน้าจอส่งกลับมา ถูกตรวจจริงไหม — หน้าจอไม่ใช่ด่าน ใครยิง API ตรงก็ได้
 *   3. ช่องที่หน้าจอไม่ได้เปิดให้แก้ (สูตรคำนวณ · ข้อความข้อจำกัด · สเปกมาตรฐาน)
 *      รอดจากการบันทึกไหม — ถ้าไม่รอด แปลว่ายิง API ตรงแล้วลบมันได้
 *
 * รันโดยไม่เขียนอะไรลงฐาน — อ่านเล่มปัจจุบัน (SELECT) แล้วทุกอย่างอยู่ในหน่วยความจำ
 * (ทางบันทึกลงฐานของ `PUT /model` พิสูจน์ที่ `diag:pricing-db` ข้อ 6)
 */
import { NoBook, loadBookFrom } from '../pricebook/bookSource.js';
import { computePrice, resolveModel } from '../../services/pricingLab/engine.js';
import { parseProductCode } from '../../services/pricingLab/code.js';
import { EditRejected, applyModelEdit, excelReady, modelEditorView } from '../../services/pricingLab/modelEditor.js';
import type { PriceBook, PriceModel, SheetLayout } from '../../services/pricingLab/types.js';
import { makeTemplate, readUploaded } from '../../services/pricingLab/bookFile.js';
import { applyModels } from '../../services/pricingLab/bookUpdate.js';
import { checkPriceModel } from '../../services/pricingLab/modelShape.js';
import { loadCatalogSubcodes } from '../pricebook/seedCatalogSubcodes.js';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, extra?: string): void => {
  if (ok) pass++;
  else fails.push(name + (extra ? `  —  ${extra}` : ''));
  console.log(`${ok ? '✓ ' : '✗ FAIL'}  ${name}${extra ? `  —  ${extra}` : ''}`);
};

// เล่มปัจจุบันในฐาน (SELECT อย่างเดียว) · `--data <dir>` = ตรวจกับตัวเลขของชีตตรง ๆ · `--book <ไฟล์>` (ดู bookSource.ts)
const loaded = await loadBookFrom().catch((e: unknown) => {
  if (e instanceof NoBook) { console.error(e.message); process.exit(1); }
  throw e;
});
const book = loaded.book;
console.log(`สมุดราคาที่ใช้: ${loaded.label}\n`);

const bh01 = book.models['BH-01'];
const bh03 = book.models['BH-03'];
if (!bh01 || !bh03) {
  console.error('สมุดราคาเล่มนี้ไม่มีซีรีส์ BH — ด่านนี้ตรวจซีรีส์ BH โดยเฉพาะ');
  process.exit(1);
}

/** คิดราคาจากรหัสจริงแบบที่หน้าจอทำ (อ่านรหัส → cfg → คิด) */
function priceOfCode(code: string, b: PriceBook = book!): number {
  const parsed = parseProductCode(code, b);
  if (!parsed.cfg) return -1;
  return computePrice(parsed.cfg, b).unitPrice;
}

const withModel = (m: PriceModel): PriceBook => ({ ...book!, models: { ...book!.models, [m.code]: m } });

console.log('\n── 1. ตัวเลือกท้ายรหัสคิดราคาถูก และครอบรหัสที่ขายจริง ─────────────────\n');

// เฉลยที่ฝ่ายขายเขียนไว้ในชีตเอง: BH!E19:E22 → 10,975 → +20% = 13,170 → +320 = 13,490
check('BH-01C คิดได้ตรงตัวอย่างในชีต (13,490)', priceOfCode('BH-01C-600x150-380-4950W-PL2') === 13490,
  String(priceOfCode('BH-01C-600x150-380-4950W-PL2')));
check('BH-02C ได้ราคาเดียวกับ BH-01C (เคยตกไปคิดเป็นรุ่นฐาน)',
  priceOfCode('BH-02C-600x150-380-4950W-PL2') === 13490,
  String(priceOfCode('BH-02C-600x150-380-4950W-PL2')));
check('BH-02 (ไม่มีตัว C) ต้องไม่บวก 20%', priceOfCode('BH-02-600x150-380-4950W-PL2') === 11135,
  String(priceOfCode('BH-02-600x150-380-4950W-PL2')));
check('BH-03C แพงกว่า BH-03 จริง', priceOfCode('BH-03C 185x283-230-3000Wx2') > priceOfCode('BH-03 185x283-230-3000Wx2'),
  `${priceOfCode('BH-03C 185x283-230-3000Wx2')} vs ${priceOfCode('BH-03 185x283-230-3000Wx2')}`);

// ตัว C ต้องถูกอ่านว่าเป็น "ตัวเลือกของรุ่น" ไม่ใช่ตัวอักษรที่อ่านไม่ออก
const parsedC = parseProductCode('BH-02C-600x150-380-4950W-PL2', book);
check('ตัว C ไม่ถูกมาร์กว่าอ่านไม่ออกอีกแล้ว', !parsedC.parts.some((p) => p.kind === 'unknown' && p.text === 'C'),
  parsedC.parts.filter((p) => p.kind === 'unknown').map((p) => p.text).join(' · ') || '(ไม่มีตัวที่อ่านไม่ออก)');
check('cfg ที่อ่านได้มี variant ติดมาด้วย', parsedC.cfg?.variant === 'C', String(parsedC.cfg?.variant));
check('BH-01C ไม่เป็นรุ่นแยกในสมุดแล้ว', resolveModel(book, 'BH-01C') === undefined);

console.log('\n── 2. สิ่งที่หน้าจอส่งกลับมา ถูกตรวจจริง ────────────────────────────────\n');

const view = modelEditorView(book, bh01);
check('หน้าจอได้ช่วงขนาดครบทุกช่วง', view.base.kind === 'banded' && view.base.bands.length === 7,
  view.base.kind === 'banded' ? `${view.base.bands.length} ช่วง` : view.base.kind);
check('หน้าจอได้ตัวเลือกท้ายรหัสพร้อมรหัสที่ครอบ',
  view.variant?.covers.join(',') === 'BH-01C,BH-02C', view.variant?.covers.join(',') ?? '(ไม่มี)');
check('คอลัมน์ "คิดเมื่อไหร่" เป็นประโยคไทย ไม่ใช่ข้อความของเครื่อง',
  view.adders.some((a) => a.whenTh.startsWith('ลูกค้าติ๊ก')) && !view.adders.some((a) => a.whenTh.includes('[')),
  view.adders.map((a) => a.whenTh).find((t) => t.includes('[')) ?? 'ไทยครบ');
check('คำศัพท์ให้ช่องเลือกเป็นรายการปิดที่ไม่ว่าง',
  view.vocab.options.length > 5 && view.vocab.dims.length > 5 && view.vocab.kinds.length === 3);

/** ส่งของที่หน้าจอจะส่ง แล้วดูว่าโดนปฏิเสธด้วยข้อความอะไร */
function rejects(name: string, body: unknown, expect: RegExp): void {
  try {
    applyModelEdit(bh01!, body);
    check(name, false, 'ไม่ปฏิเสธเลย');
  } catch (e) {
    const msg = e instanceof EditRejected ? e.message : `พังด้วย ${String(e)}`;
    check(name, e instanceof EditRejected && expect.test(msg), msg);
  }
}

/** แบบทั่วไปของ `rejects` — สำหรับรุ่นอื่นนอกจาก BH-01 */
function expectReject(name: string, fn: () => unknown, expect: RegExp): void {
  try {
    fn();
    check(name, false, 'ไม่ปฏิเสธเลย');
  } catch (e) {
    const msg = e instanceof EditRejected ? e.message : `พังด้วย ${String(e)}`;
    check(name, e instanceof EditRejected && expect.test(msg), msg);
  }
}

const okAdders = view.adders.map((a) => ({ ...a, when: a.when ?? { always: true } }));

rejects('เงื่อนไขที่ชี้ไปยังตัวเลือกที่ไม่รู้จัก → ปฏิเสธ',
  { adders: [{ ...okAdders[1], when: { option: 'conn:แอบยัด' } }] }, /ไม่รู้จักตัวเลือก/);
rejects('เงื่อนไขที่ชี้ไปยังช่องตัวเลขที่ไม่รู้จัก → ปฏิเสธ',
  { adders: [{ ...okAdders[0], kind: 'perUnit', dim: 'ค่าอะไรก็ไม่รู้' }] }, /ไม่รู้จักช่องตัวเลข/);
rejects('รหัสกฎที่มีอักขระแปลก → ปฏิเสธ',
  { adders: [{ ...okAdders[0], id: 'a b/c' }] }, /รหัสกฎ/);
rejects('รหัสกฎซ้ำกันในรุ่นเดียว → ปฏิเสธ',
  { adders: [okAdders[0], { ...okAdders[1], id: okAdders[0]!.id }] }, /ซ้ำ/);
rejects('ช่วงขนาดที่ทับกัน → ปฏิเสธ',
  { adders: okAdders, bands: [{ min: 0, max: 10, kind: 'flat', price: 700 }, { min: 5, max: 20, kind: 'flat', price: 800 }] },
  /ทับกัน/);
rejects('ช่วงที่ไม่มีขอบบนแต่มีช่วงต่อท้าย → ปฏิเสธ',
  { adders: okAdders, bands: [{ min: 0, max: null, kind: 'flat', price: 700 }, { min: 20, max: 30, kind: 'flat', price: 800 }] },
  /ไม่มีขอบบน/);
rejects('ราคาฝั่งตัวเลือกที่ชี้ไปยังกฎที่ไม่มีอยู่ → ปฏิเสธ',
  { adders: okAdders, variant: { suffix: 'C', label: 'รุ่น C', percent: 20, adderPrices: { ไม่มีจริง: 300 } } },
  /ไม่มีกฎ/);
rejects('ตัวเลขใหญ่เกินจริง → ปฏิเสธ',
  { adders: [{ ...okAdders[1], amount: 1e12 }] }, /ใหญ่เกินจริง/);
rejects('ชื่อรายการว่าง → ปฏิเสธ',
  { adders: [{ ...okAdders[1], label: '   ' }] }, /ยังไม่ได้กรอก/);

console.log('\n── 3. ช่องที่หน้าจอไม่ได้เปิดให้แก้ ต้องรอดจากการบันทึก ──────────────────\n');

// body ที่ "พยายามลบของที่แก้ไม่ได้" — สูตรคำนวณ · สเปกมาตรฐาน · ข้อความข้อจำกัด · ชื่อพ้อง
const sneaky = {
  adders: okAdders,
  bands: (view.base.kind === 'banded' ? view.base.bands : []).map((b) => ({ ...b })),
  variant: { suffix: 'C', label: 'รุ่น C', percent: 20, adderPrices: view.variant?.adderPrices ?? {} },
  constraintsOff: [],
  derivedDims: [],
  standard: {},
  aliases: [],
  constraints: [],
  code: 'BH-99',
};
const after = applyModelEdit(bh01, sneaky);
check('สูตรที่ระบบคิดเองยังอยู่ครบ', (after.derivedDims ?? []).length === (bh01.derivedDims ?? []).length);
check('สเปกที่รวมในราคาตั้งแล้วยังอยู่', JSON.stringify(after.standard) === JSON.stringify(bh01.standard));
check('ชื่อพ้อง (BH-02) ยังอยู่', (after.aliases ?? []).join(',') === (bh01.aliases ?? []).join(','));
check('ข้อความของข้อจำกัดยังอยู่ครบ',
  after.constraints.map((c) => c.message).join('|') === bh01.constraints.map((c) => c.message).join('|'));
check('รหัสรุ่นเปลี่ยนจาก body ไม่ได้', after.code === 'BH-01', after.code);
check('บันทึกแบบไม่แก้อะไร แล้วราคายังเท่าเดิม',
  computePrice({ model: 'BH-01', variant: 'C', dims: { dia_mm: 600, width_mm: 150 }, options: ['conn:pl2'] },
    withModel(after)).unitPrice === 13490);

// ปิดข้อจำกัดหนึ่งข้อ แล้วต้องปิดจริง (สวิตช์เป็นสิ่งเดียวที่แก้ได้)
const off = applyModelEdit(bh01, { ...sneaky, constraintsOff: ['MIN_OD'] });
check('ปิดข้อจำกัดจากหน้าจอได้', off.constraints.find((c) => c.id === 'MIN_OD')?.disabled === true);
check('ข้อจำกัดข้ออื่นไม่ถูกปิดตามไปด้วย', off.constraints.find((c) => c.id === 'MIN_WIDTH')?.disabled !== true);

// แก้ราคาแล้วต้องมีผลกับราคาที่คิดออกมาจริง ไม่ใช่แค่เก็บลงไฟล์
const raised = applyModelEdit(bh01, {
  ...sneaky,
  variant: { suffix: 'C', label: 'รุ่น C', percent: 30, adderPrices: view.variant?.adderPrices ?? {} },
});
check('แก้ % ของตัวเลือกแล้วราคาขยับตาม (30% → 14,587.5)',
  computePrice({ model: 'BH-01', variant: 'C', dims: { dia_mm: 600, width_mm: 150 }, options: ['conn:pl2'] },
    withModel(raised)).unitPrice === 14587.5,
  String(computePrice({ model: 'BH-01', variant: 'C', dims: { dia_mm: 600, width_mm: 150 }, options: ['conn:pl2'] },
    withModel(raised)).unitPrice));

// ลบราคาฝั่งตัวเลือกออก = กลับไปคิดเท่ารุ่นหลัก (160 ไม่ใช่ 320) ⇒ 10,975 + 20% + 160 = 13,330
const sameAsBase = applyModelEdit(bh01, {
  ...sneaky,
  variant: { suffix: 'C', label: 'รุ่น C', percent: 20, adderPrices: {} },
});
check('ลบราคาฝั่งตัวเลือกออก = ของแถมคิดเท่ารุ่นหลัก (13,330)',
  computePrice({ model: 'BH-01', variant: 'C', dims: { dia_mm: 600, width_mm: 150 }, options: ['conn:pl2'] },
    withModel(sameAsBase)).unitPrice === 13330,
  String(computePrice({ model: 'BH-01', variant: 'C', dims: { dia_mm: 600, width_mm: 150 }, options: ['conn:pl2'] },
    withModel(sameAsBase)).unitPrice));

// กฎที่เพิ่มจากหน้าจอต้องติดธง custom — ไฟล์ราคารอบใหม่จะได้รู้ว่าไม่ได้มาจากชีต
const added = applyModelEdit(bh01, {
  ...sneaky,
  adders: [...okAdders, { id: 'promo_q4', label: 'ส่วนลดโปรโมชัน', order: 5, kind: 'percent', percent: -5, when: { always: true } }],
});
check('กฎที่เพิ่มจากหน้าจอติดธง "ไม่ได้มาจากไฟล์ราคา"',
  added.adders.find((a) => a.id === 'promo_q4')?.custom === true);
check('กฎเดิมไม่ถูกมาร์กว่าเพิ่มเอง', added.adders.find((a) => a.id === 'conn_pl2')?.custom !== true);
check('ที่มาในชีตของกฎเดิมยังอยู่',
  added.adders.find((a) => a.id === 'hold')?.source === bh01.adders.find((a) => a.id === 'hold')?.source);

console.log('\n── 4. ราคาแยกตามค่าแกน (ซีรีส์ TS) — ช่องว่างต้องไม่กลายเป็น 0 ────────────\n');

// เจ้าของเจอ 2026-09-23: ลบเลขในช่อง "ความยาวแกน L1 · ขนาด 2" ทิ้งแล้วบันทึก เดิมหน้าจอส่ง 0 ⇒ ขนาดนั้น
// กลายเป็น "ไม่คิดเงินเพิ่ม" เงียบ ๆ · ของที่ถูกคือ "ไม่มีราคา" ⇒ ตัวคิดราคาต้องไม่คิดราคาขนาดนั้นให้
const tsk04 = book.models['TSK-04'];
if (!tsk04?.adders.find((a) => a.id === 'len_l1')?.rates) {
  check('สมุดมี TSK-04 พร้อมกฎ len_l1 ที่ราคาแยกตามขนาดแกน', false, 'ไม่มี — ข้ามหัวข้อนี้');
} else {
  const tView = modelEditorView(book, tsk04);
  const tAdders = tView.adders.map((a) => ({ ...a, when: a.when ?? { always: true } }));
  const withRate = (rate: number | null) => applyModelEdit(tsk04, {
    adders: tAdders.map((a) => (a.id !== 'len_l1' ? a : {
      ...a, rates: a.rates!.map((r) => (r.value === '2' ? { ...r, rate } : r)),
    })),
    constraintsOff: [],
  });
  const emptied = withRate(null).adders.find((a) => a.id === 'len_l1')!;
  check('ลบเลขทิ้ง ⇒ ขนาดนั้นหายจากตาราง (ไม่มีราคา) ไม่ใช่ 0', !('2' in (emptied.rates ?? {})),
    JSON.stringify(emptied.rates?.['2']));
  check('  ขนาดอื่นในกฎเดียวกันไม่ขยับ',
    Object.keys(emptied.rates ?? {}).length === Object.keys(tsk04.adders.find((a) => a.id === 'len_l1')!.rates!).length - 1);
  check('ใส่ 0 เอง ⇒ เก็บเป็น 0 จริง (ไม่คิดเงินเพิ่ม)',
    withRate(0).adders.find((a) => a.id === 'len_l1')!.rates?.['2'] === 0);
}

/**
 * จุดแรกที่สองค่าต่างกันจริง — ไม่นับลำดับคีย์ในออบเจกต์ และไม่นับคีย์ที่ค่าเป็น undefined
 * (ตัวบันทึกประกอบกฎใหม่ด้วยลำดับคีย์ของมันเอง ซึ่งไม่กระทบราคาและไม่กระทบแม่แบบ .xlsx)
 * ลำดับใน **อาเรย์** ยังนับ — ลำดับกฎ/ช่วงราคาคือสิ่งที่คนเห็นในแม่แบบ
 */
function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`;
    if (a.length !== b.length) return `${path}: ${a.length} → ${b.length} รายการ`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`;
}

console.log('\n── 5. บันทึกโดยไม่แตะอะไร ⇒ สมุดต้องเท่าเดิมทุกค่า ทุกรุ่น ──────────────────\n');

// ข้อนี้มีเพราะเจอพร้อมกันสามเรื่อง 2026-09-23: TS-18 บันทึกไม่ได้เลย (เงื่อนไขประกอบถูกปฏิเสธ) ·
// ช่วงราคาของ BH สลับลำดับคีย์ · หน่วย " m" ถูกตัดช่องว่าง — สองเรื่องหลังไม่เปลี่ยนราคา แต่ทำให้
// ประวัติบันทึกว่า "เปลี่ยน" ทั้งที่ไม่มีใครแก้อะไร ⇒ ส่งสิ่งที่หน้าจอส่งจริง แล้วเทียบทั้งรุ่น (ไม่นับลำดับคีย์)
for (const m of Object.values(book.models)) {
  const v = modelEditorView(book, m);
  const body: Record<string, unknown> = {
    adders: v.adders.map((a) => ({ ...a, when: a.when ?? { always: true } })),
    constraintsOff: v.constraints.filter((c) => c.disabled).map((c) => c.id),
  };
  if (v.base.kind === 'banded') body.bands = v.base.bands;
  if (v.variant) {
    body.variant = { suffix: v.variant.suffix, label: v.variant.label, percent: v.variant.percent,
      adderPrices: v.variant.adderPrices ?? {}, disabled: v.variant.disabled };
  }
  try {
    const diff = firstDiff(m, applyModelEdit(m, body, book));
    check(`${m.code} — บันทึกเปล่าแล้วสมุดเท่าเดิม`, diff === null, diff ?? '');
  } catch (e) {
    check(`${m.code} — บันทึกเปล่าแล้วสมุดเท่าเดิม`, false, e instanceof Error ? e.message : String(e));
  }
}

console.log('\n── 6. สมุดรายชีต (ชีต TS-01+TS-01-0) — ตารางราคาตั้งสองแกนแก้จากจอ ─────────\n');

// เจ้าของสั่ง 2026-09-24: "1 ชีท / 1 สมุด" + หน้าตาใกล้ Excel ที่สุด เริ่มที่ชีตนี้
// ทางบันทึกคือ `PUT /sheet/:sheet` → `applyModelEdit(รุ่น, { cells, adderRates }, เล่ม)` ของแต่ละรุ่นในชีต
const ts01 = book.models['TSK-01'];
const ts010 = book.models['TSK-01-0'];
if (!ts01 || !ts010 || ts01.base.kind !== 'matrix') {
  check('สมุดมี TSK-01 / TSK-01-0 แบบตารางสองแกน', false, 'ไม่มี — ข้ามหัวข้อนี้');
} else {
  const ready = Object.values(book.models).filter(excelReady).map((m) => m.code).sort();
  check('รุ่นที่เปิดแบบชีต Excel ได้ = สองรุ่นของชีต TS-01+TS-01-0 เท่านั้น',
    ready.join(',') === 'TSK-01,TSK-01-0', ready.join(','));

  const v = modelEditorView(book, ts01);
  const grid = v.base.kind === 'matrix' ? v.base : null;
  check('จอได้ตาราง 5 แถว (TSK/TSJ…TSZ) × 5 คอลัมน์ (M6x1.0…5/16”) ตามลำดับในชีต',
    !!grid && grid.rows.join(',') === 'TSK/TSJ,TST,TSP,TSPA,TSZ' && grid.cols.join(',') === 'M6x1.0,M8x1.0,M10x1.25,1/4”,5/16”',
    grid ? `${grid.rows.join(',')} × ${grid.cols.join(',')}` : 'ไม่ใช่ matrix');
  check('ช่องมุมซ้ายบน = 160 (TS-01!B11) · มุมขวาล่าง = 1,680 (TS-01!F15)',
    grid?.cells?.[0]?.[0] === 160 && grid?.cells?.[4]?.[4] === 1680);
  check('หัวตารางแบบที่ชีตเขียน (TS_-01 · TS_-01-0)',
    v.title === 'TS_-01' && modelEditorView(book, ts010).title === 'TS_-01-0', `${v.title}`);

  const K = 'TSK/TSJ | M6x1.0';
  const priceK = (b: PriceBook) => computePrice({ model: 'TSK-01', axes: { sensor: 'TSK/TSJ', thread: 'M6x1.0' } }, b);
  const edited = applyModelEdit(ts01, { cells: { [K]: 175 } }, book);
  const cells = edited.base.kind === 'matrix' ? edited.base.cells : {};
  check('แก้ช่องเดียว ⇒ ช่องนั้นเปลี่ยน', cells[K] === 175, String(cells[K]));
  check('  ช่องอื่นและลำดับคีย์ไม่ขยับ',
    JSON.stringify(Object.keys(cells)) === JSON.stringify(Object.keys(ts01.base.cells))
      && Object.keys(cells).every((k) => k === K || cells[k] === (ts01.base as { cells: Record<string, number> }).cells[k]));
  check('  ราคาที่คิดได้ขยับตาม (160 → 175)', priceK(withModel(edited)).unitPrice === 175 && priceK(book).unitPrice === 160,
    `${priceK(book).unitPrice} → ${priceK(withModel(edited)).unitPrice}`);

  const emptied = applyModelEdit(ts01, { cells: { [K]: null } }, book);
  const ec = emptied.base.kind === 'matrix' ? emptied.base.cells : {};
  check('ลบเลขทิ้ง ⇒ ช่องนั้นหาย (ไม่รับผลิต) ไม่ใช่ 0', !(K in ec));
  check('  คิดราคาช่องนั้นแล้วไม่ได้ราคา 0 เงียบ ๆ', priceK(withModel(emptied)).status !== 'priced',
    priceK(withModel(emptied)).status);
  const refilled = applyModelEdit(emptied, { cells: { [K]: 160 } }, withModel(emptied));
  check('  กรอกคืนได้ (ช่องที่ว่างในตารางยังกรอกได้)',
    refilled.base.kind === 'matrix' && refilled.base.cells[K] === 160);
  expectReject('ช่องที่ไม่มีในตาราง (แถว/คอลัมน์ใหม่) ถูกปฏิเสธ',
    () => applyModelEdit(ts01, { cells: { 'TSX | M6x1.0': 100 } }, book), /ไม่มีช่อง/);
  expectReject('ราคาที่ไม่ใช่ตัวเลขถูกปฏิเสธ',
    () => applyModelEdit(ts01, { cells: { [K]: 'abc' } }, book), /ตัวเลข/);
  expectReject('แก้ตารางสองแกนกับรุ่นแบบช่วงขนาด (BH) ถูกปฏิเสธ',
    () => applyModelEdit(bh01, { cells: { [K]: 1 } }, book), /สองแกน/);

  // ราคาสาย (แถบหมายเหตุใต้ตาราง) — ช่องว่างต้องไม่กลายเป็น 0 และต้องกรอกคืนได้
  const cable = ts01.adders.find((a) => a.id === 'cable_over_1m');
  const cableKey = Object.keys(cable?.rates ?? {})[0];
  if (!cable || !cableKey) {
    check('TSK-01 มีกฎราคาสาย', false);
  } else {
    const noCable = applyModelEdit(ts01, { adderRates: { cable_over_1m: [{ value: cableKey, rate: null }] } }, book);
    const r1 = noCable.adders.find((a) => a.id === 'cable_over_1m')?.rates ?? {};
    check(`ลบราคาสาย "${cableKey}" ⇒ หายจากสมุด (ต้องขอราคา) ไม่ใช่ 0`, !(cableKey in r1));
    check('  ราคาสายชนิดอื่นไม่ขยับ',
      Object.keys(cable.rates!).filter((k) => k !== cableKey).every((k) => r1[k] === cable.rates![k]));
    const vAfter = modelEditorView(withModel(noCable), noCable);
    check('  จอยังเห็นช่องของสายชนิดนั้น (ว่าง) ให้กรอกคืน',
      !!vAfter.adders.find((a) => a.id === 'cable_over_1m')?.rates?.some((r) => r.value === cableKey && r.rate === null));
    const back = applyModelEdit(noCable, { adderRates: { cable_over_1m: [{ value: cableKey, rate: 80 }] } }, withModel(noCable));
    check('  กรอกคืนแล้วเก็บได้จริง',
      back.adders.find((a) => a.id === 'cable_over_1m')?.rates?.[cableKey] === 80);
    expectReject('ราคาสายของกฎที่ไม่มีถูกปฏิเสธ',
      () => applyModelEdit(ts01, { adderRates: { nope: [] } }, book), /ไม่มีกฎ/);
    const bogus = applyModelEdit(ts01, { adderRates: { cable_over_1m: [{ value: 'สายทองคำ', rate: 1 }] } }, book);
    check('ชนิดสายที่สมุดไม่รู้จักถูกทิ้ง (สร้างค่าแกนใหม่จาก API ไม่ได้)',
      !('สายทองคำ' in (bogus.adders.find((a) => a.id === 'cable_over_1m')?.rates ?? {})));
  }

  // บันทึกจากหน้าสมุดรายชีตโดยไม่แตะอะไร ⇒ ต้องเท่าเดิม **ทุกไบต์** (เส้น PUT /sheet ใช้ JSON.stringify ตัดสินว่ารุ่นไหนเปลี่ยน)
  for (const m of [ts01, ts010]) {
    const mv = modelEditorView(book, m);
    const body = {
      cells: mv.base.kind === 'matrix' && mv.base.cells
        ? Object.fromEntries(mv.base.rows.flatMap((r, i) => mv.base.kind === 'matrix'
          ? mv.base.cols.map((c, j) => [`${r} | ${c}`, mv.base.kind === 'matrix' ? mv.base.cells![i]![j] : null]) : []))
        : {},
      adderRates: Object.fromEntries(mv.adders.filter((a) => a.rates).map((a) => [a.id, a.rates])),
    };
    check(`${m.code} — บันทึกทั้งชีตแบบไม่แก้อะไร ได้ JSON เดิมทุกไบต์`,
      JSON.stringify(applyModelEdit(m, body, book)) === JSON.stringify(m));
  }
}

console.log('\n── 7. หน้าตาของชีต (ชนิดสายรุ่นเริ่มต้น · ตัวหนังสือแดง · คอลัมน์เหลือง) ────────\n');

// เจ้าของสั่งเพิ่ม 2026-09-24 — แสดงผลอย่างเดียว ⇒ ข้อที่สำคัญที่สุดคือ "ราคาไม่ขยับ" และ "ไม่หายระหว่างทาง"
// ค่าเดียวกับที่ `importer.ts --layout-only` อ่านได้จากไฟล์จริง (TS-01+TS-01-0!G11:G15 · C16:D16 · E11:E15)
if (ts01 && ts01.base.kind === 'matrix') {
  const LAY: SheetLayout = {
    rowNote: { label: 'ชนิดสาย รุ่นเริ่มต้น', values: { 'TSK/TSJ': 'สาย ถักสแตนเลส', TST: 'สาย เทปล่อน', TSP: 'สาย PVC', TSPA: 'สาย PVC', TSZ: 'สาย PVC' } },
    colNotes: { 'M8x1.0': '*M8x1.25', 'M10x1.25': '*M10x1.5' },
    highlightCols: ['1/4”'],
  };
  const withL: PriceModel = { ...ts01, layout: LAY };
  const bookL = withModel(withL);
  const v7 = modelEditorView(bookL, withL);
  check('จอได้หน้าตาครบสามอย่าง',
    v7.layout.rowNote?.values.TST === 'สาย เทปล่อน' && v7.layout.colNotes['M8x1.0'] === '*M8x1.25' && v7.layout.highlightCols[0] === '1/4”');
  const priceAll = (b: PriceBook) => ['TSK/TSJ', 'TST', 'TSZ'].map((r) =>
    computePrice({ model: 'TSK-01', axes: { sensor: r, thread: 'M8x1.0' } }, b).unitPrice).join(',');
  check('มีหน้าตาแล้วราคาไม่ขยับสักช่อง', priceAll(bookL) === priceAll(book));

  const sameBody = { layout: { rowNote: LAY.rowNote!.values, colNotes: LAY.colNotes, highlightCols: LAY.highlightCols } };
  check('บันทึกหน้าตาเดิมกลับไป ⇒ JSON เดิมทุกไบต์', JSON.stringify(applyModelEdit(withL, sameBody, bookL)) === JSON.stringify(withL));
  check('ไม่ส่ง layout มา ⇒ คงเดิม (หน้าแก้ทีละรุ่นไม่ลบของที่มันไม่เห็น)',
    JSON.stringify(applyModelEdit(withL, { cells: {} }, bookL).layout) === JSON.stringify(LAY));
  const e7 = applyModelEdit(withL, { layout: { ...sameBody.layout, rowNote: { ...LAY.rowNote!.values, TSZ: 'สาย ไฟเบอร์กลาส' }, highlightCols: ['M6x1.0', '1/4”'] } }, bookL);
  check('แก้ข้อความท้ายแถว + เพิ่มคอลัมน์เหลือง ได้ตามลำดับคอลัมน์ของตาราง',
    e7.layout?.rowNote?.values.TSZ === 'สาย ไฟเบอร์กลาส' && e7.layout?.highlightCols?.join(',') === 'M6x1.0,1/4”'
      && e7.layout?.rowNote?.label === 'ชนิดสาย รุ่นเริ่มต้น', JSON.stringify(e7.layout));
  const cleared = applyModelEdit(withL, { layout: { rowNote: {}, colNotes: {}, highlightCols: [] } }, bookL);
  check('ลบทุกอย่าง ⇒ ช่อง layout หายไปทั้งช่อง (ไม่เหลือ {} ค้าง)', !('layout' in cleared));
  expectReject('ข้อความของแถวที่ไม่มีในตาราง ถูกปฏิเสธ',
    () => applyModelEdit(withL, { layout: { rowNote: { TSX: 'x' } } }, bookL), /ไม่มี "TSX"/);
  expectReject('ไฮไลต์คอลัมน์ที่ไม่มี ถูกปฏิเสธ',
    () => applyModelEdit(withL, { layout: { highlightCols: ['M99'] } }, bookL), /ไม่มี "M99"/);
  expectReject('ข้อความยาวเกิน ถูกปฏิเสธ',
    () => applyModelEdit(withL, { layout: { colNotes: { 'M6x1.0': 'x'.repeat(61) } } }, bookL), /ยาวเกิน/);
  const bad = modelEditorView(bookL, { ...withL, layout: { rowNote: 'พัง', colNotes: [1], highlightCols: 'x' } as unknown as SheetLayout });
  check('layout เสียในฐาน (ใครแก้มือ) ⇒ จอไม่พัง อ่านเป็นว่าง',
    bad.layout.rowNote === null && Object.keys(bad.layout.colNotes).length === 0 && bad.layout.highlightCols.length === 0);

  // แม่แบบ Excel ไป-กลับ: หน้าตาต้องไม่หายระหว่างทาง (ชีต "หน้าตาในไฟล์ราคา")
  const { book: back } = await readUploaded(Buffer.from(makeTemplate(bookL, '2026-09-24')));
  check('แม่แบบ .xlsx ไป-กลับ ⇒ หน้าตาเท่าเดิมทุกไบต์',
    JSON.stringify(back?.models['TSK-01']?.layout) === JSON.stringify(LAY), JSON.stringify(back?.models['TSK-01']?.layout));
  // ไฟล์รุ่นเก่า (ไม่มีชีตหน้าตา) = ไม่รู้ ไม่ใช่ลบ
  const oldFile: PriceBook = { ...bookL, models: { ...bookL.models, 'TSK-01': { ...withL, layout: undefined } } };
  const merged = applyModels(bookL, oldFile, ['TSK-01'], { at: '2026-09-24T00:00:00.000Z' });
  check('อัปแม่แบบรุ่นก่อนที่ไม่มีชีตหน้าตา ⇒ หน้าตาเดิมยังอยู่', JSON.stringify(merged.models['TSK-01']?.layout) === JSON.stringify(LAY));
}

console.log('\n── 8. ชนิดสายรุ่นเริ่มต้นตาม TYPE (axisDefaultsBy) — มีผลกับราคา ─────────────\n');

// เจ้าของยืนยัน 2026-09-24 (ชี้คอลัมน์ G): "มันก็บอกอยู่แล้วนี้ไงครับ เรื่องสาย" — ชนิดสายผูกกับ TYPE
// เดิม TSJ-01 4.8+2M คิดไม่ได้ และหน้าจอขึ้น "ไม่รับผลิตขนาดนี้" ทั้งที่แค่รหัสไม่บอกเกลียว/สาย
if (ts01 && ts01.base.kind === 'matrix') {
  const DEF = { cable: { label: 'ชนิดสาย รุ่นเริ่มต้น', by: 'sensor', values: {
    'TSK/TSJ': 'สายสแตนเลสถัก', TST: 'สายเทปล่อน', TSP: 'สายพีวีซี', TSPA: 'สายพีวีซี', TSZ: 'สายพีวีซี' },
    source: 'TS-01+TS-01-0!G11:G15' } };
  // ตัดค่ามาตรฐานของเกลียวทิ้ง (เล่มจาก --data มี 1/4” ตามแคตตาล็อก) — ข้อนี้ทดสอบกลไกตาม TYPE ล้วน ๆ
  const m8: PriceModel = { ...ts01, axisDefaults: undefined, axisDefaultsBy: DEF };
  const b8 = withModel(m8);
  const q = (axes: Record<string, string>, cable_m: number, b: PriceBook = b8) =>
    computePrice({ model: 'TSK-01', axes, dims: { cable_m } }, b);

  const tsj = q({ sensor: 'TSK/TSJ', thread: '1/4”' }, 2);
  check('TSJ-01(1/4”)4.8+2M = 160 + สายสแตนเลสถัก 80 = 240', tsj.status === 'priced' && tsj.unitPrice === 240,
    `${tsj.status} ${tsj.unitPrice} ${tsj.violations.map((v) => v.message).join('|')}`);
  check('  บรรทัดค่าสายบอกว่าใช้สายรุ่นเริ่มต้นเพราะรหัสไม่ได้ระบุ',
    tsj.breakdown.some((l) => /สายสแตนเลสถัก.*รหัสไม่ได้ระบุ/.test(l.detail ?? '')), tsj.breakdown.map((l) => l.detail).join(' / '));
  const tst = q({ sensor: 'TST', thread: 'M6x1.0' }, 3);
  check('TST +3M = 220 + เทปล่อน 180 × 2 = 580 (สายตาม TYPE ไม่ใช่ค่าเดียวทั้งรุ่น)', tst.unitPrice === 580, String(tst.unitPrice));
  const tsz = q({ sensor: 'TSZ', thread: 'M6x1.0' }, 2);
  check('TSZ +2M = 1,740 + PVC 100 = 1,840', tsz.unitPrice === 1840, String(tsz.unitPrice));
  const own = q({ sensor: 'TSK/TSJ', thread: '1/4”', cable: 'สายเทปล่อน' }, 2);
  check('รหัสที่บอกชนิดสายเอง ชนะค่าเริ่มต้น (160 + 180 = 340)', own.unitPrice === 340, String(own.unitPrice));
  const rows = ['TSK/TSJ', 'TST', 'TSP', 'TSPA', 'TSZ'];
  const cols = (ts01.base as { cells: Record<string, number> }).cells;
  const allSame = rows.every((r) => Object.keys(cols).filter((k) => k.startsWith(r + ' |')).every((k) => {
    const t = k.split(' | ')[1]!;
    return q({ sensor: r, thread: t }, 1).unitPrice === q({ sensor: r, thread: t }, 1, withModel({ ...ts01, axisDefaultsBy: undefined })).unitPrice;
  }));
  check('สายไม่เกิน 1 เมตร ⇒ ราคาเท่าเดิมทุกช่อง (ค่าเริ่มต้นไม่แตะรหัสที่คิดได้อยู่แล้ว)', allSame);

  const noThread = q({ sensor: 'TSK/TSJ' }, 2);
  check('ไม่มีเกลียวในรหัส ⇒ ขึ้นว่า "รหัสไม่ได้บอก" ไม่ใช่ "ไม่รับผลิต"',
    noThread.violations.some((v) => v.missing && /รหัสไม่ได้บอก/.test(v.message))
      && !noThread.violations.some((v) => /ไม่รับผลิต/.test(v.message)), noThread.violations.map((v) => v.message).join('|'));
  const bare = withModel({ ...ts01, axisDefaultsBy: undefined }); // เล่มจาก --data มีค่าเริ่มต้นติดมาแล้ว — ตัดทิ้งให้ข้อนี้ทดสอบกรณีไม่มีจริง
  const noCable = q({ sensor: 'TSK/TSJ', thread: '1/4”' }, 2, bare);
  check('ไม่มีค่าเริ่มต้นและรหัสไม่บอกสาย ⇒ "รหัสไม่ได้บอกชนิดสาย" (missing)',
    noCable.violations.some((v) => v.missing && /รหัสไม่ได้บอกชนิดสาย/.test(v.message)), noCable.violations.map((v) => v.message).join('|'));
  // ตัวอักษรหลัง M = ชนิดสาย/Ground ตามแคตตาล็อก (docs/pricing-code-ts-01.md) ที่ยังไม่ต่อเข้าราคา —
  // ห้ามเติมสายตั้งต้นทับ: เคยได้ 240 (สแตนเลสถัก) ทั้งที่ `T` คือเทปล่อน (340) พร้อมคำว่า "รหัสไม่ได้ระบุ"
  const byCode = (code: string) => { const p = parseProductCode(code, b8); return computePrice(p.cfg!, b8); };
  // เจ้าของสั่ง 2026-09-25: "รหัสที่อ่านไม่ออกให้ขึ้นเตือนไว้ แต่คำนวณเฉพาะส่วนที่คำนวณได้ไปก่อน"
  // ⇒ ได้ราคาตั้งอย่างเดียว (ไม่รวมค่าสาย) + เตือน partial · ยังห้ามเติมสายตั้งต้นแทน
  for (const [code, base] of [['TSK-01(M6)4.8+2MT', 160], ['TSK-01(M6)4.8+2MTU', 160], ['TSP-01(M6)4.8+2MC', 920]] as const) {
    const r = byCode(code);
    check(`${code} ⇒ ได้ ${base} (เฉพาะราคาตั้ง) + เตือนว่ายังไม่รวมค่าสาย · ไม่ได้สายตั้งต้น`,
      r.status === 'priced' && r.unitPrice === base
        && r.violations.some((v) => v.partial && v.level === 'warn' && /ยังไม่รวม: อ่าน ".+" ในรหัสไม่ออก/.test(v.message))
        && !r.breakdown.some((l) => /รหัสไม่ได้ระบุ/.test(l.detail ?? '')),
      `${r.status} ${r.unitPrice} ${r.violations.map((v) => v.message).join('|')}`);
  }
  const at1m = byCode('TSK-01(M6)4.8+1MT');
  check('  สายไม่เกิน 1 M มีตัวอักษรต่อท้าย ⇒ ยังคิดได้ 160 (ไม่มีค่าสายให้ต้องรู้ชนิด)', at1m.status === 'priced' && at1m.unitPrice === 160,
    `${at1m.status} ${at1m.unitPrice}`);
  const plain = byCode('TSK-01(M6)4.8+2M');
  check('  ไม่มีตัวอักษรต่อท้าย ⇒ ยังใช้สายตั้งต้นตาม TYPE (240)', plain.unitPrice === 240, String(plain.unitPrice));

  const realGap = q({ sensor: 'TSK/TSJ', thread: 'M99' }, 1);
  check('ช่องที่ไม่มีจริงในตาราง ⇒ ยังเป็น "ไม่รับผลิต" (ไม่ใช่ missing)',
    realGap.violations.some((v) => !v.missing && /ไม่รับผลิต/.test(v.message)));

  check('รุ่นที่มีค่าเริ่มต้นตาม TYPE ยังเปิดแบบชีต Excel ได้', excelReady(m8));
  check('ค่าเริ่มต้นที่ขึ้นกับแกนคอลัมน์ ⇒ ไม่เปิดแบบชีต (ไม่มีที่วาง)',
    !excelReady({ ...m8, axisDefaultsBy: { cable: { ...DEF.cable, by: 'thread' } } }));
  check('ตัวตรวจรูปรับของดี', checkPriceModel(m8, 'TSK-01').length === 0, checkPriceModel(m8, 'TSK-01').join('|'));
  check('ตัวตรวจรูปปฏิเสธของเสีย (engine อ่านช่องนี้ — ต่างจาก layout)',
    checkPriceModel({ ...m8, axisDefaultsBy: { cable: { by: 1, values: 'x' } } }, 'TSK-01').length > 0);

  const v8 = modelEditorView(b8, m8);
  const df = v8.defaultsBy[0];
  check('จอได้คอลัมน์ค่าเริ่มต้น + ตัวเลือก = ชนิดสายที่มีราคา',
    df?.label === 'ชนิดสาย รุ่นเริ่มต้น' && df.options.length === 4 && df.values.TST === 'สายเทปล่อน', JSON.stringify(df));
  check('บันทึกค่าเดิมกลับไป ⇒ JSON เดิมทุกไบต์',
    JSON.stringify(applyModelEdit(m8, { defaultsBy: { cable: DEF.cable.values } }, b8)) === JSON.stringify(m8));
  const ch8 = applyModelEdit(m8, { defaultsBy: { cable: { ...DEF.cable.values, TSZ: 'สายไฟเบอร์กลาส' } } }, b8);
  check('เปลี่ยน TSZ เป็นไฟเบอร์กลาส ⇒ TSZ +2M = 1,740 + 95', q({ sensor: 'TSZ', thread: 'M6x1.0' }, 2, withModel(ch8)).unitPrice === 1835);
  check('  label · by · source ไม่เปลี่ยน', JSON.stringify({ ...ch8.axisDefaultsBy!.cable, values: undefined })
    === JSON.stringify({ ...DEF.cable, values: undefined }));
  expectReject('ชนิดสายที่ไม่มีราคา ถูกปฏิเสธ',
    () => applyModelEdit(m8, { defaultsBy: { cable: { TSZ: 'สายทองคำ' } } }, b8), /ไม่มีในราคา/);
  expectReject('แถวที่ไม่มีในตาราง ถูกปฏิเสธ',
    () => applyModelEdit(m8, { defaultsBy: { cable: { TSX: 'สายพีวีซี' } } }, b8), /ไม่มี "TSX"/);
  expectReject('แกนที่รุ่นไม่มีค่าเริ่มต้น ถูกปฏิเสธ (เพิ่มใหม่ทางแม่แบบ)',
    () => applyModelEdit(m8, { defaultsBy: { thread: {} } }, b8), /ไม่มีค่าเริ่มต้น/);
  const cl8 = applyModelEdit(m8, { defaultsBy: { cable: { ...DEF.cable.values, TSZ: '' } } }, b8);
  check('ล้างค่าของ TSZ ⇒ TSZ +2M กลับไปคิดไม่ได้ (ไม่ใช่เดา)',
    q({ sensor: 'TSZ', thread: 'M6x1.0' }, 2, withModel(cl8)).status !== 'priced' && !('TSZ' in cl8.axisDefaultsBy!.cable!.values));

  const { book: back8 } = await readUploaded(Buffer.from(makeTemplate(b8, '2026-09-24')));
  check('แม่แบบ .xlsx ไป-กลับ ⇒ ค่าเริ่มต้นเท่าเดิมทุกไบต์',
    JSON.stringify(back8?.models['TSK-01']?.axisDefaultsBy) === JSON.stringify(DEF), JSON.stringify(back8?.models['TSK-01']?.axisDefaultsBy));
  const old8: PriceBook = { ...b8, models: { ...b8.models, 'TSK-01': { ...m8, axisDefaultsBy: undefined } } };
  check('อัปแม่แบบรุ่นก่อน (ไม่มีชีตค่าเริ่มต้น) ⇒ ค่าเดิมยังอยู่',
    JSON.stringify(applyModels(b8, old8, ['TSK-01'], { at: '2026-09-24T00:00:00.000Z' }).models['TSK-01']?.axisDefaultsBy) === JSON.stringify(DEF));
}

console.log('\n── 9. แคตตาล็อก TS_-01 / TS_-01-0 (เจ้าของสั่ง 2026-09-24: "ยึดตามภาพ · ทำตามภาพเลย · U ไม่มีราคาเพิ่ม") ─\n');

// ค่ามาตรฐานมาจากแมป (19/20-*.map.json) · ความหมายตัวอักษรหลัง M มาจาก catalog-subcodes.json
// ที่ seedCatalogSubcodes.ts เขียนลงตารางรหัสย่อย — ด่านนี้ประกอบเล่มเองจากสองไฟล์นั้น ไม่พึ่งของในฐาน
if (ts01 && ts010) {
  const STD = { cable: { label: 'ชนิดสายมาตรฐาน', by: 'sensor', values: {} as Record<string, string> } };
  const withStd = (m: PriceModel, thread: string): PriceModel => {
    const rows = m.base.kind === 'matrix' ? [...new Set(Object.keys(m.base.cells).map((k) => k.split(' | ')[0]!))] : [];
    return { ...m, axisDefaults: { thread },
      axisDefaultsBy: { cable: { ...STD.cable, values: Object.fromEntries(rows.map((r) => [r, 'สายสแตนเลสถัก'])) } } };
  };
  const cat = loadCatalogSubcodes();
  const b9: PriceBook = {
    ...book,
    models: { ...book.models, 'TSK-01': withStd(ts01, '1/4”'), 'TSK-01-0': withStd(ts010, 'M5') },
    subCodes: [...(book.subCodes ?? []), ...cat],
  };
  const run = (code: string) => { const p = parseProductCode(code, b9); return { p, r: computePrice(p.cfg!, b9) }; };
  const price = (code: string, want: number, label: string) => {
    const { p, r } = run(code);
    check(`${code} = ${want.toLocaleString()} — ${label}`, r.status === 'priced' && r.unitPrice === want,
      `${r.status} ${r.unitPrice} ${r.violations.map((v) => v.message).join('|')} · ${p.parts.map((x) => `${x.text}[${x.kind}]`).join(' ')}`);
    return { p, r };
  };

  const a = price('TSJ-01 4.8+2M', 240, 'ไม่มีวงเล็บ = เกลียว 1/4” · ไม่บอกสาย = สแตนเลสถัก 80');
  check('  บรรทัดราคาตั้งบอกว่าเกลียวมาจากค่ามาตรฐาน', /ขนาดเกลียว 1\/4” = ค่ามาตรฐานของรุ่น — รหัสไม่ได้ระบุ/.test(a.r.breakdown[0]?.detail ?? ''),
    a.r.breakdown[0]?.detail);
  check('  ไม่มีคำเตือน "ไม่มีวงเล็บ" แล้ว', !a.p.warnings.some((w) => /วงเล็บ/.test(w)), a.p.warnings.join('|'));
  price('TST-01(M6)4.8+3M', 380, 'TYPE T ไม่บอกสาย = สแตนเลสถัก ตามแคตตาล็อก (ไม่ใช่เทปล่อนตามคอลัมน์ G)');
  price('TSP-01(1/4")4.8+2M', 1000, 'RTD ไม่บอกสาย = สแตนเลสถัก 80 (ไม่ใช่ PVC)');
  const t = price('TSK-01(M6)4.8+2MT', 340, 'T = เทปล่อน 180');
  check('  บรรทัดค่าสายไม่อ้างว่า "รหัสไม่ได้ระบุ"', !t.r.breakdown.some((l) => /รหัสไม่ได้ระบุ/.test(l.detail ?? '')));
  price('TSK-01(M6)4.8+2MTU', 340, 'T + U — Unground ไม่มีราคาเพิ่ม');
  const pu = price('TSP-01(M6)4.8+2MPU', 1020, 'P = พีวีซี 100 + U');
  check('  U ขึ้นเป็น "ไม่มีผลกับราคา" ไม่ใช่ตัวแดง', pu.p.parts.some((x) => x.text === 'U' && x.kind === 'noPrice'));
  price('TSK-01(M6)4.8+3MF', 350, 'F = ไฟเบอร์กลาส 95 × 2');
  price('TSK-01(M8)6+1M', 190, 'แกน 6 คู่กับ M8 — ไม่มีผลกับราคา');
  check('  แกน 6 ไม่ขึ้นแดง', !run('TSK-01(M8)6+1M').p.parts.some((x) => x.kind === 'unknown'));
  const tsu = run('TSP-01(M6)4.8+2MTSU');
  check('TSP-01(M6)4.8+2MTSU — TS = เทปล่อนหุ้มชีลด์ ยังไม่มีราคา ⇒ "ยังไม่มีราคา" (noRate) ไม่ใช่ไม่รับผลิต',
    tsu.r.status !== 'priced' && tsu.r.violations.some((v) => v.noRate && /เทปล่อนหุ้มชีลด์/.test(v.message)) && !tsu.r.violations.some((v) => v.missing),
    tsu.r.violations.map((v) => JSON.stringify(v)).join('|'));
  price('TSK-01(M6)4.8+1MC', 160, 'สายซิลิโคนไม่เกิน 1 M ⇒ ไม่มีค่าสายให้ต้องรู้ราคา');

  price('TSJ-01-0+2M', 240, 'TS_-01-0 ไม่มีวงเล็บ = M5 160 + สแตนเลสถัก 80');
  price('TSK-01-0(M6)+2MT', 370, 'TS_-01-0 T = เทปล่อน 190 + 180');
  price('TSP-01-0(M4)+2MPU', 1030, 'TS_-01-0 P + U = 930 + 100');
  const z = run('TSK-01-0(M6)+2MTSU');
  check('TSK-01-0(M6)+2MTSU — แคตตาล็อก TS_-01-0 ไม่มี TS ⇒ ทิ้งทั้งท่อน (ไม่แตกเป็น T + SU) · ได้ 190 เฉพาะราคาตั้ง + เตือน',
    z.r.status === 'priced' && z.r.unitPrice === 190 && z.r.violations.some((v) => v.partial)
      && z.p.parts.some((x) => x.text === 'TSU' && x.kind === 'unknown'),
    `${z.r.status} ${z.r.unitPrice} ${z.p.parts.map((x) => `${x.text}[${x.kind}]`).join(' ')}`);
  const c0 = run('TSK-01-0(M6)+2MC');
  check('TSK-01-0(M6)+2MC — แคตตาล็อก TS_-01-0 ไม่มี C ⇒ อ่านไม่ออก (ไม่ใช้ C ของ TS_-01) · ได้ 190 + เตือน',
    c0.r.status === 'priced' && c0.r.unitPrice === 190 && c0.r.violations.some((v) => v.partial),
    `${c0.r.status} ${c0.r.unitPrice} ${c0.r.violations.map((v) => v.message).join('|')}`);
  const full = run('TSK-01-0(M6)+2MT');
  check('  รหัสที่อ่านได้ครบ ⇒ ไม่มีเตือน partial', !full.r.violations.some((v) => v.partial));

  const v9 = modelEditorView(b9, b9.models['TSK-01']!);
  check('หน้าชีตรู้ค่ามาตรฐานของเกลียว', JSON.stringify(v9.axisDefaults) === JSON.stringify([{ axis: 'thread', axisTh: 'ขนาดเกลียว', value: '1/4”' }]),
    JSON.stringify(v9.axisDefaults));
  check('ยังเปิดแบบชีต Excel ได้', excelReady(b9.models['TSK-01']!) && excelReady(b9.models['TSK-01-0']!));
  check('ไฟล์ catalog-subcodes.json ผ่านตัวตรวจทุกแถว (10 + แกน 6)', cat.length === 11, String(cat.length));
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`ผล: ผ่าน ${pass} · ตก ${fails.length}`);
console.log('─'.repeat(70));
process.exit(fails.length ? 1 : 0);
