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
import { readFileSync, readdirSync } from 'node:fs';
import { NoBook, loadBookFrom } from '../pricebook/bookSource.js';
import { withPendingCatalogRules } from '../pricebook/catalogRules.js';
import { computePrice, resolveModel } from '../../services/pricingLab/engine.js';
import { parseProductCode } from '../../services/pricingLab/code.js';
import { EditRejected, applyModelEdit, excelReady, modelEditorView, pruneUnpriced } from '../../services/pricingLab/modelEditor.js';
import type { Adder, PriceBook, PriceModel, SheetLayout } from '../../services/pricingLab/types.js';
import { makeTemplate, readUploaded } from '../../services/pricingLab/bookFile.js';
import { applyModels } from '../../services/pricingLab/bookUpdate.js';
import { checkPriceModel } from '../../services/pricingLab/modelShape.js';
import { loadCatalogSubcodes } from '../pricebook/seedCatalogSubcodes.js';
import { clean } from '../../db/pricingLabRepo.js';
import { withSubCodes } from '../../services/pricingLab/bookStore.js';

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
// กติกาแคตตาล็อก BH (สูตรพื้นที่ตามรูปทรง · ขนาดเล็กสุด) ที่เล่มในฐานยังไม่มี = เติมในหน่วยความจำแล้วบอก (ดู catalogRules.ts)
const pendingRules = withPendingCatalogRules(loaded.book);
const book = pendingRules.book;
if (pendingRules.note) console.log(pendingRules.note);
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

// ข้อของหัวข้อ 9 และ 11 ทดสอบทาง "สายที่ยังไม่มีราคา" โดยใช้ซิลิโคนเป็นตัวอย่าง — ฐานใส่ราคาซิลิโคนไปแล้ว (r17 · 2026-10-01)
// ⇒ ถอดราคาซิลิโคนออกจากเล่มทดสอบเสมอ ด่านจึงไม่เน่าตามข้อมูลในฐาน (เคยตกค้าง 7 ข้อจนถึง 2026-10-05)
const noSilicone = (a: Adder): Adder => {
  if (a.id !== 'cable_over_1m' || !a.rates || !('สายซิลิโคน' in a.rates)) return a;
  const { ['สายซิลิโคน']: _si, ...rest } = a.rates;
  return { ...a, rates: rest };
};
const withModel = (m: PriceModel): PriceBook => ({ ...book!, models: { ...book!.models, [m.code]: m } });

console.log('\n── 1. ตัวเลือกท้ายรหัสคิดราคาถูก และครอบรหัสที่ขายจริง ─────────────────\n');

// เฉลยที่ฝ่ายขายเขียนไว้ในชีตเอง: BH!E19:E22 → 10,975 → +20% = 13,170 → +320 = 13,490
check('BH-01C คิดได้ตรงตัวอย่างในชีต (13,490)', priceOfCode('BH-01C-600x150-380-4950W-PL2') === 13490,
  String(priceOfCode('BH-01C-600x150-380-4950W-PL2')));
// BH-02C = แผ่นวงกลม (แคตตาล็อก) และยังบวก 20% ตามชีต (เจ้าของเคาะ 2026-09-28) — เทียบกับใบเดียวกันที่ไม่ใช้ตัวเลือก C
const c02 = parseProductCode('BH-02C 210-220-1400W', book).cfg!;
const c02Plain = computePrice({ ...c02, variant: undefined }, book).unitPrice;
check('BH-02C บวก 20% เหมือน BH-01C (เคยตกไปคิดเป็นรุ่นฐาน)',
  computePrice(c02, book).unitPrice === Math.round(c02Plain * 1.2 * 100) / 100 && c02Plain > 0,
  `${computePrice(c02, book).unitPrice} = ${c02Plain} × 1.2`);
check('BH-02 (ไม่มีตัว C) ต้องไม่บวก 20%', parseProductCode('BH-02 600x150-380-4950W-PL2', book).cfg?.variant === undefined);
check('BH-03C แพงกว่า BH-03 จริง', priceOfCode('BH-03C 185x283-230-3000Wx2') > priceOfCode('BH-03 185x283-230-3000Wx2'),
  `${priceOfCode('BH-03C 185x283-230-3000Wx2')} vs ${priceOfCode('BH-03 185x283-230-3000Wx2')}`);

// ตัว C ต้องถูกอ่านว่าเป็น "ตัวเลือกของรุ่น" ไม่ใช่ตัวอักษรที่อ่านไม่ออก
const parsedC = parseProductCode('BH-02C 210-220-1400W-PL2', book);
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
// (ข้อที่ใช้ทดลองเคยเป็น MIN_OD ของชีต — แคตตาล็อกแทนด้วย MIN_ID ตั้งแต่ 2026-09-28)
const off = applyModelEdit(bh01, { ...sneaky, constraintsOff: ['MIN_ID'] });
check('ปิดข้อจำกัดจากหน้าจอได้', off.constraints.find((c) => c.id === 'MIN_ID')?.disabled === true);
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

  // เจ้าของสั่ง 2026-09-28: "รหัสที่ใช้ได้ควรเป็นตัวเลือกที่มีข้อมูลตาม Excel และ pattern การประกอบรหัสตามแคตตาล็อกเท่านั้น"
  // แล้วเคาะต่อในวันเดียวกัน: "Excel มี J แต่แคตตาล็อกไม่มี ก็ต้องใส่" · "แคตตาล็อกมี R, S แต่ Excel ไม่มีราคา ก็ต้องใส่ไว้
  // เพิ่มราคาทีหลังได้" ⇒ "ใช้กับรหัส" ของทุกรุ่น = **แคตตาล็อก ∪ Excel** · ตัวที่แคตตาล็อกมีแต่ Excel ไม่มีราคา
  // = คอลัมน์ "ยังไม่มีราคา" (`base.unpriced`) · ไม่มีทางถอยข้ามชนิดเซนเซอร์
  // ตรวจบนสำเนาที่ใช้รายชื่อจากแมป — ไม่ขึ้นกับว่าฐานเขียน --aliases ไปหรือยัง
  const maps = readdirSync('scripts/pricebook/maps').map((f) =>
    JSON.parse(readFileSync(`scripts/pricebook/maps/${f}`, 'utf8')) as
      { code: string; aliases?: string[]; base?: { unpriced?: Record<string, string[]> } });
  const strict: PriceBook = {
    ...book,
    models: Object.fromEntries(Object.entries(book.models).map(([k, m]) => {
      const mp = maps.find((x) => x.code === k);
      if (!mp) return [k, m];
      const base = m.base.kind === 'matrix' ? pruneUnpriced({ ...m.base, unpriced: mp.base?.unpriced }) : m.base;
      return [k, { ...m, aliases: mp.aliases ?? [], base }];
    })),
  };
  // ชนิดเซนเซอร์ตามหน้า "การสั่งซื้อ" ของแคตตาล็อก (backup/Catalogue · อ่าน 2026-09-28) — ข้อเท็จจริงของกระดาษ ไม่ใช่ข้อมูลในฐาน
  // TS_-12 มีสองหน้า: Thermocouple (K J) กับ RTD PT100 (P PA Z) ⇒ รวมกันที่นี่ แล้วตรวจรวมทุกตารางที่เลขเดียวกัน
  const CATALOGUE: Record<string, string[]> = {
    '01': ['K', 'J', 'T', 'P', 'PA', 'Z'], '01-0': ['K', 'J', 'T', 'P', 'PA', 'Z'], '04': ['K', 'J', 'T'], '06': ['K', 'J', 'T'],
    '08': ['P', 'PA', 'Z'], '10': ['P', 'PA', 'Z'], '11': ['K', 'J', 'T', 'P', 'PA', 'Z'], '12': ['K', 'J', 'P', 'PA', 'Z'],
    '14': ['K', 'R', 'S'], '18': ['K', 'J', 'T', 'R', 'S', 'P', 'PA', 'Z'],
    '02': ['K', 'J', 'T', 'P', 'PA', 'Z'],
  };
  // เลขรุ่นที่แมปมีแล้วแต่เล่มยังไม่มีรุ่น = ยังไม่ได้เติมลงฐาน (`importer.ts --new-models` · TS_-02 2026-10-05) — ข้าม ไม่นับว่าตก
  const inBook = new Set(Object.keys(book.models));
  const pendingNums = Object.keys(CATALOGUE).filter((n) =>
    maps.some((mp) => !inBook.has(mp.code) && new RegExp(`^TS[A-Z]*-${n}$`).test(mp.code)));
  if (pendingNums.length) console.log(`  (ข้ามเลขรุ่น ${pendingNums.join(' · ')} — แมปมีแล้วแต่เล่มนี้ยังไม่มีรุ่น · ยังไม่ได้เติมลงฐาน)`);
  const bare: string[] = [];
  const noData: string[] = [];
  const waitingOutside: string[] = [];
  const covered: Record<string, Set<string>> = {};
  for (const m of Object.values(strict.models)) {
    for (const c of [m.code, ...(m.aliases ?? [])]) {
      const hm = /^TS([A-Z]*)-(\d{2}(?:-0)?)$/.exec(c);
      if (!hm) continue;
      if (hm[1] === '') { if (c !== m.code) bare.push(`${m.code}: ${c}`); continue; }
      (covered[hm[2]!] ??= new Set()).add(hm[1]!);
      const p = parseProductCode(c, strict);
      if (p.model !== m.code || p.parts.some((x) => x.kind === 'unknown' && x.text === `TS${hm[1]}`)) { noData.push(`${m.code}: ${c}`); continue; }
      // ยืนบนคอลัมน์ "ยังไม่มีราคา" ได้เฉพาะชนิดที่แคตตาล็อกมี — ตัวที่ไม่มีทั้งในแคตตาล็อกและ Excel ห้ามเสกคอลัมน์ว่างให้
      const sensor = p.cfg?.axes?.sensor;
      const onBlank = m.base.kind === 'matrix' && !!sensor && (m.base.unpriced?.sensor ?? []).includes(sensor);
      if (onBlank && !(CATALOGUE[hm[2]!] ?? []).includes(hm[1]!)) waitingOutside.push(`${m.code}: ${c}`);
    }
  }
  const missingCat = Object.entries(CATALOGUE).filter(([n]) => !pendingNums.includes(n)).flatMap(([n, ls]) =>
    ls.filter((l) => !covered[n]?.has(l)).map((l) => `TS${l}-${n}`));
  check('ไม่มี TS-<เลข> เปล่า ๆ ใน "ใช้กับรหัส" ของรุ่นไหนเลย', bare.length === 0, bare.join(' · ') || `${maps.length} แมป`);
  check('ทุกชนิดในหน้า "การสั่งซื้อ" ของแคตตาล็อกอยู่ใน "ใช้กับรหัส" (มีราคาหรือยังไม่มีราคาก็ต้องใส่)',
    missingCat.length === 0, missingCat.join(' · '));
  check('"ใช้กับรหัส" ทุกตัวอ่านหัวรหัสออก (คอลัมน์/กฎใน Excel หรือคอลัมน์ "ยังไม่มีราคา")', noData.length === 0, noData.join(' · '));
  check('คอลัมน์ "ยังไม่มีราคา" มีเฉพาะชนิดที่แคตตาล็อกมี', waitingOutside.length === 0, waitingOutside.join(' · '));
  check('หัวตารางยังเป็น TS_-01 · TS_-01-0 (อ่านจากชื่อชีต ไม่ใช่ชื่อพ้อง TS-01)',
    modelEditorView(strict, strict.models['TSK-01']!).title === 'TS_-01' &&
    modelEditorView(strict, strict.models['TSK-01-0']!).title === 'TS_-01-0');
  for (const [code, why] of [
    ['TS-01(M6)4.8+1M', 'ไม่มีตัวอักษรชนิดเซนเซอร์'], ['TS-01-0(M5)+1M', 'ไม่มีตัวอักษรชนิดเซนเซอร์'],
    ['TS-14 6x200+150', 'ไม่มีตัวอักษรชนิดเซนเซอร์'], ['TSE-01-0(M5)+1M', 'ไม่มีชนิดเซนเซอร์ E'],
    ['TSR-04(S3)6x150+1.5M', 'ไม่มีชนิดเซนเซอร์ R'], ['TSE-06(S2)6x100', 'ไม่มีชนิดเซนเซอร์ E'],
  ] as const) {
    const p = parseProductCode(code, strict);
    check(`${code} ไม่ยืมตารางของชนิดอื่น — ขึ้นว่าตารางใช้กับรหัสไหน`,
      !p.model && p.problems.some((s) => s.includes(why) && s.includes('ใช้กับรหัส')), p.model ?? p.problems.join(' | '));
  }
  // TSE-01 = หัวรหัสนอกแคตตาล็อกของตารางที่ตั้งให้ "ขอราคา" (เจ้าของเคาะ B#6 2026-09-29) — ได้รุ่นแต่ไม่ยืมแถวของชนิดอื่น
  {
    const p = parseProductCode('TSE-01(M6)4.8+1M', strict);
    const o = p.cfg ? computePrice(p.cfg, strict) : null;
    check('TSE-01(M6)4.8+1M ได้รุ่น TSK-01 แต่ไม่ยืมแถวของชนิดอื่น — ต้องขอราคาจากฝ่ายผลิต',
      p.model === 'TSK-01' && o?.status === 'quoteOnRequest' && o.unitPrice === 0 && p.cfg?.axes?.sensor === 'TSE', `${o?.status} ${p.cfg?.axes?.sensor}`);
  }
  for (const [code, want] of [['TSK-01(M6)4.8+1M', 'TSK-01'], ['TSPA-01-0(M5)+1M', 'TSK-01-0'], ['TSK-14 6x200+150', 'TS-14'],
    ['TSJ-14 6x200+150', 'TS-14'], ['TSR-14(S4)15x100-BU', 'TS-14'], ['TST-04(S2)6x100+1M', 'TSK-04'],
    ['TSZ-11 6x100+1M', 'TSK-11'], ['TSP-18(1.5)6-6x30+20-U', 'TS-18'], ['TSN-18(1.5)6-6x100+50', 'TS-18']] as const) {
    const p = parseProductCode(code, strict);
    check(`${code} ยังได้รุ่น ${want}`, p.model === want, p.model ?? p.problems.join(' | '));
  }
  // แคตตาล็อกมี แต่ Excel ยังไม่มีราคา ⇒ อ่านออก และตอบ "ยังไม่มีราคา" ไม่ใช่ "ไม่รับผลิต" หรือ "รหัสไม่ได้บอก"
  for (const code of ['TSR-18(1.5)6-6x100+50', 'TSS-18(1.5)6-6x100+50']) {
    const p = parseProductCode(code, strict);
    const o = p.cfg ? computePrice(p.cfg, strict) : null;
    const nb = o?.violations.find((v) => v.id === 'NO_BASE_PRICE');
    check(`${code} ได้ตาราง TS-18 และขึ้น "ยังไม่มีราคา" (noRate)`,
      p.model === 'TS-18' && o?.status !== 'priced' && !!nb?.noRate && !nb.missing && nb.message.includes('ยังไม่มีราคา'),
      nb?.message ?? o?.status ?? p.problems.join(' | '));
  }
  // คอลัมน์ "ยังไม่มีราคา" ต้องรอดแม่แบบ Excel ไป-กลับ และกรอกราคาจากแม่แบบได้จริง
  const ts18 = strict.models['TS-18']!;
  if (ts18.base.kind !== 'matrix' || !ts18.base.unpriced) {
    check('TS-18 มีคอลัมน์ "ยังไม่มีราคา" (Type R/S) จากแมป', false);
  } else {
    const back = (await readUploaded(Buffer.from(makeTemplate(strict, '2026-09-28')))).book;
    const b18 = back?.models['TS-18']?.base;
    check('แม่แบบ Excel ไป-กลับ: คอลัมน์ "ยังไม่มีราคา" ของ TS-18 ยังอยู่ครบ',
      b18?.kind === 'matrix' && JSON.stringify(b18.unpriced) === JSON.stringify(ts18.base.unpriced), JSON.stringify(b18?.kind === 'matrix' ? b18.unpriced : b18));
    const v18 = modelEditorView(strict, ts18);
    check('  จอเห็นคอลัมน์ Type R/S เป็นช่องว่าง (ไม่ใช่หายไป)',
      v18.base.kind === 'matrix' && ts18.base.unpriced.sensor!.every((c) => v18.base.kind === 'matrix' && v18.base.cols.includes(c)));
    const row0 = Object.keys(ts18.base.cells)[0]!.split(' | ')[0]!;
    const filled = pruneUnpriced({ ...ts18.base, cells: { ...ts18.base.cells, [`${row0} | Type R (TSR)`]: 999 } });
    check('  กรอกราคา Type R แล้ว Type R ออกจากรายการ "ยังไม่มีราคา" · Type S ยังอยู่',
      JSON.stringify(filled.unpriced) === JSON.stringify({ sensor: ['Type S (TSS)'] }), JSON.stringify(filled.unpriced));
  }

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
        && r.violations.some((v) => v.partial && v.level === 'warn' && /ยังไม่รวม: รหัสเขียนว่า ".+" แต่ยังไม่ได้กำหนด/.test(v.message))
        && !r.breakdown.some((l) => /รหัสไม่ได้ระบุ/.test(l.detail ?? '')),
      `${r.status} ${r.unitPrice} ${r.violations.map((v) => v.message).join('|')}`);
  }
  const at1m = byCode('TSK-01(M6)4.8+1MT');
  check('  สายไม่เกิน 1 M มีตัวอักษรต่อท้าย ⇒ ยังคิดได้ 160 (ไม่มีค่าสายให้ต้องรู้ชนิด)', at1m.status === 'priced' && at1m.unitPrice === 160,
    `${at1m.status} ${at1m.unitPrice}`);
  const plain = byCode('TSK-01(M6)4.8+2M');
  check('  ไม่มีตัวอักษรต่อท้าย ⇒ ยังใช้สายตั้งต้นตาม TYPE (240)', plain.unitPrice === 240, String(plain.unitPrice));

  const realGap = q({ sensor: 'TSK/TSJ', thread: 'M99' }, 1);
  // ช่องว่าง = ยังไม่มีราคา ⇒ ขอราคา + ราคาเท่าที่คิดได้ ไม่ใช่ "ไม่รับผลิต" (เจ้าของสั่ง 2026-10-05)
  check('ช่องที่ไม่มีจริงในตาราง ⇒ "ยังไม่มีราคา" ต้องขอราคา (ไม่ใช่ missing · ไม่ใช่ไม่รับผลิต)',
    realGap.status === 'quoteOnRequest' && realGap.violations.some((v) => !v.missing && v.noRate && /ยังไม่มีราคา/.test(v.message))
      && !realGap.violations.some((v) => /ไม่รับผลิต/.test(v.message)),
    `${realGap.status} ${realGap.violations.map((v) => v.message).join('|')}`);

  check('รุ่นที่มีค่าเริ่มต้นตาม TYPE ยังเปิดแบบชีต Excel ได้', excelReady(m8));
  check('ค่าเริ่มต้นที่ขึ้นกับแกนคอลัมน์ ⇒ ไม่เปิดแบบชีต (ไม่มีที่วาง)',
    !excelReady({ ...m8, axisDefaultsBy: { cable: { ...DEF.cable, by: 'thread' } } }));
  check('ตัวตรวจรูปรับของดี', checkPriceModel(m8, 'TSK-01').length === 0, checkPriceModel(m8, 'TSK-01').join('|'));
  check('ตัวตรวจรูปปฏิเสธของเสีย (engine อ่านช่องนี้ — ต่างจาก layout)',
    checkPriceModel({ ...m8, axisDefaultsBy: { cable: { by: 1, values: 'x' } } }, 'TSK-01').length > 0);

  const v8 = modelEditorView(b8, m8);
  const df = v8.defaultsBy[0];
  // เล่มจาก Excel มี 4 ชนิด · เล่มในฐานมีสายเทปล่อนหุ้มชีลด์เพิ่ม (เจ้าของสั่ง 2026-09-25) ⇒ นับจากราคาในรุ่นเอง ไม่ใช่เลขตายตัว
  const cableKeys = Object.keys(m8.adders.find((a) => a.id === 'cable_over_1m')?.rates ?? {});
  check('จอได้คอลัมน์ค่าเริ่มต้น + ตัวเลือก = ชนิดสายที่มีราคา',
    df?.label === 'ชนิดสาย รุ่นเริ่มต้น' && df.options.length === cableKeys.length
      && ['สายสแตนเลสถัก', 'สายพีวีซี', 'สายไฟเบอร์กลาส', 'สายเทปล่อน'].every((k) => df.options.includes(k))
      && df.values.TST === 'สายเทปล่อน', JSON.stringify(df));
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
  // ราคาสายเทปล่อนหุ้มชีลด์ 160/ม. — เจ้าของสั่ง 2026-09-25 "ใส่ 160 ไปก่อน" (ถอดจากราคาขาย Odoo · Excel ไม่มีสายนี้)
  // อยู่ในฐานเท่านั้น ⇒ เล่มจาก --data ไม่มี · เติมให้เหมือนกันทั้งสองทาง ด่านจึงให้ผลเดียวกัน
  const TS_RATE = 160;
  // ความยาวแกน TS_-01 (เจ้าของสั่ง 2026-09-25 "เริ่มคิดเงินเมื่อยาวเกิน std · ยึดราคาจาก excel") — แมปอ่าน
  // TS-06!C27/C31 ⇒ เล่มจาก --data มีเอง · เล่มในฐานก่อนเขียน r7 ยังไม่มี ⇒ เติมตัวเลขเดียวกันให้
  // (หน้าตากฎมาจากไฟล์แมปเองทุกช่อง รวม `source` — ไม่มี source = แม่แบบ .xlsx อ่านกลับเป็น "กฎที่คนเพิ่มเอง")
  const lenSpec = (JSON.parse(readFileSync(new URL('../pricebook/maps/19-TS-01.map.json', import.meta.url), 'utf8')) as
    { adders: (Adder & { ratesFrom?: unknown })[] }).adders.find((a) => a.id === 'len_l1')!;
  const { ratesFrom: _rf, ...lenRest } = lenSpec;
  const LEN_L1: Adder = { ...lenRest, rates: { '4.8': 110, '6': 120 } };
  const withStd = (m: PriceModel, thread: string): PriceModel => {
    const rows = m.base.kind === 'matrix' ? [...new Set(Object.keys(m.base.cells).map((k) => k.split(' | ')[0]!))] : [];
    const needLen = m.code === 'TSK-01' && !m.adders.some((a) => a.id === 'len_l1');
    return { ...m, axisDefaults: { thread },
      ...(needLen ? { standard: { ...m.standard, L1: 5 } } : {}),
      adders: [...(needLen ? [LEN_L1] : []), ...m.adders.map(noSilicone).map((a) => (a.id === 'cable_over_1m'
        ? { ...a, rates: { ...a.rates, 'สายเทปล่อนหุ้มชีลด์': a.rates?.['สายเทปล่อนหุ้มชีลด์'] ?? TS_RATE } } : a))],
      axisDefaultsBy: { cable: { ...STD.cable, values: Object.fromEntries(rows.map((r) => [r, 'สายสแตนเลสถัก'])) } } };
  };
  const cat = loadCatalogSubcodes();
  const b9: PriceBook = {
    ...book,
    // ทุกรุ่น ไม่ใช่แค่ TSK-01 — จอของรุ่นแบบชีตดึงชื่อสายจากรุ่นอื่นในเล่มด้วย (`knownRateKeys`)
    models: { ...Object.fromEntries(Object.entries(book.models).map(([k, m]) => [k, { ...m, adders: m.adders.map(noSilicone) }])),
      'TSK-01': withStd(ts01, '1/4”'), 'TSK-01-0': withStd(ts010, 'M5') },
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
  price('TSP-01(M6)4.8+2MTSU', 1080, 'TS = เทปล่อนหุ้มชีลด์ 160 (เจ้าของสั่ง 2026-09-25) + U · ไม่มีค่าเมตรแรก (ยึด Excel)');
  price('TSK-01 4.8+3MTS', 480, 'TS ไม่มีวงเล็บ = 1/4” 160 + 160 × 2');
  const cc = run('TSK-01(M6)4.8+2MC');
  check('TSK-01(M6)4.8+2MC — C = ซิลิโคน ยังไม่มีราคา ⇒ "ยังไม่มีราคา" (noRate) ไม่ใช่ไม่รับผลิต',
    cc.r.status !== 'priced' && cc.r.violations.some((v) => v.noRate && /ซิลิโคน/.test(v.message)) && !cc.r.violations.some((v) => v.missing),
    cc.r.violations.map((v) => JSON.stringify(v)).join('|'));
  price('TSK-01(M6)4.8+1MC', 160, 'สายซิลิโคนไม่เกิน 1 M ⇒ ไม่มีค่าสายให้ต้องรู้ราคา');

  price('TSJ-01-0+2M', 240, 'TS_-01-0 ไม่มีวงเล็บ = M5 160 + สแตนเลสถัก 80');
  price('TSK-01-0(M6)+2MT', 370, 'TS_-01-0 T = เทปล่อน 190 + 180');
  price('TSP-01-0(M4)+2MPU', 1030, 'TS_-01-0 P + U = 930 + 100');
  // เจ้าของสั่ง 2026-09-25: "ให้ TS_-01-0 รับสาย C/TS ด้วยราคาเดียวกับ TS_-01" (ภาพไม่มี แต่ขายจริง 40 รหัส)
  const z = price('TSK-01-0(M6)+2MTSU', 350, 'TS_-01-0 รับ TS แล้ว = 190 + 160 · U ไม่มีราคาเพิ่ม');
  check('  อ่านเป็น TS + U (ไม่แตกเป็น T + SU) และไม่มีเตือน partial',
    z.p.parts.some((x) => x.text === 'TS') && z.p.parts.some((x) => x.text === 'U') && !z.r.violations.some((v) => v.partial),
    z.p.parts.map((x) => `${x.text}[${x.kind}]`).join(' '));
  price('TSP-01-0+3MTSU', 1240, 'TS_-01-0 ไม่มีวงเล็บ = M5 920 + 160 × 2');
  const c0 = run('TSK-01-0(M6)+2MC');
  check('TSK-01-0(M6)+2MC — รับ C แล้ว แต่ซิลิโคนยังไม่มีราคา ⇒ "ยังไม่มีราคา" เหมือน TS_-01 (ไม่ใช่อ่านไม่ออก)',
    c0.r.status !== 'priced' && c0.r.violations.some((v) => v.noRate && /ซิลิโคน/.test(v.message)) && !c0.r.violations.some((v) => v.partial),
    `${c0.r.status} ${c0.r.unitPrice} ${c0.r.violations.map((v) => v.message).join('|')}`);
  const full = run('TSK-01-0(M6)+2MT');
  check('  รหัสที่อ่านได้ครบ ⇒ ไม่มีเตือน partial', !full.r.violations.some((v) => v.partial));

  const v9 = modelEditorView(b9, b9.models['TSK-01']!);
  check('หน้าชีตรู้ค่ามาตรฐานของเกลียว', JSON.stringify(v9.axisDefaults) === JSON.stringify([{ axis: 'thread', axisTh: 'ขนาดเกลียว', value: '1/4”' }]),
    JSON.stringify(v9.axisDefaults));
  check('ยังเปิดแบบชีต Excel ได้', excelReady(b9.models['TSK-01']!) && excelReady(b9.models['TSK-01-0']!));
  check('ไฟล์ catalog-subcodes.json ผ่านตัวตรวจทุกแถว (TS_-01 12 + แกน 6 · TS_-08 5 + หัวค่าว่าง 4 + เกลียวมิล 10 · TS_-10 5 + เกลียวมิล 12 · BH ปลั๊ก PL-5 ค่าว่าง 2 ' +
    '+ แคตตาล็อก TS ชุด 2026-09-29: TS_-04 9 · 06 13 · 08 1 · 10 3 · 11 6 · 12 5 · 12 RTD 6 · 14 8 · 18 14 · TS_-02 6 ชุด 2026-10-05 · TS_-03 7 ชุด 2026-10-06 + 03L)',
    cat.length === 130, String(cat.length));

  // ── ราคาสายที่ตารางรหัสย่อยตั้งให้ ต้องมีช่องบนหน้าสมุดราคาเสมอ (เจ้าของ 2026-09-25: "ต้องสามารถแก้ไขผ่าน ui ได้")
  const rowsOf = (b: PriceBook, code: string) =>
    modelEditorView(b, b.models[code]!).adders.find((a) => a.id === 'cable_over_1m')?.rates ?? [];
  for (const code of ['TSK-01', 'TSK-01-0']) {
    const r = rowsOf(b9, code);
    check(`${code} — จอมีช่อง "สายซิลิโคน" (ว่าง) กับ "สายเทปล่อนหุ้มชีลด์" (160)`,
      r.some((x) => x.value === 'สายซิลิโคน' && x.rate === null) && r.some((x) => x.value === 'สายเทปล่อนหุ้มชีลด์' && x.rate === 160),
      JSON.stringify(r));
  }
  // ฐานมีแถวรหัสย่อย C = ซิลิโคนแล้ว (ลงพร้อมแคตตาล็อก) ⇒ ตัดแถวที่ตั้งสายซิลิโคนออกด้วย ไม่งั้นข้อนี้วัดข้อมูลในฐาน ไม่ใช่โค้ด
  const noSc: PriceBook = { ...b9, subCodes: (book.subCodes ?? []).filter((x) => !(x.effect === 'setAxis' && x.value === 'สายซิลิโคน')) };
  check('  ไม่มีแถวรหัสย่อย ⇒ ไม่มีช่องซิลิโคน (ช่องมาจากตารางรหัสย่อยจริง ไม่ได้ฝังชื่อสายไว้)',
    !rowsOf(noSc, 'TSK-01').some((x) => x.value === 'สายซิลิโคน'));
  const tsk04 = Object.values(b9.models).find((m) => !excelReady(m) && m.adders.some((a) => a.byAxis === 'cable'));
  if (tsk04) {
    const own = Object.keys(tsk04.adders.find((a) => a.byAxis === 'cable')!.rates ?? {});
    check(`  รุ่นที่รหัสย่อยไม่ได้ครอบ (${tsk04.code}) ไม่ได้ช่องเพิ่ม`,
      (modelEditorView(b9, tsk04).adders.find((a) => a.byAxis === 'cable')?.rates ?? []).length === own.length);
  }
  const setC = applyModelEdit(b9.models['TSK-01']!, { adderRates: { cable_over_1m: [{ value: 'สายซิลิโคน', rate: 120 }] } }, b9);
  check('กรอกราคาซิลิโคนจากจอ ⇒ เก็บได้ และ TSK-01(M6)4.8+3MC = 160 + 120 × 2',
    setC.adders.find((a) => a.id === 'cable_over_1m')?.rates?.['สายซิลิโคน'] === 120
      && computePrice(parseProductCode('TSK-01(M6)4.8+3MC', { ...b9, models: { ...b9.models, 'TSK-01': setC } }).cfg!,
        { ...b9, models: { ...b9.models, 'TSK-01': setC } }).unitPrice === 400);
  const dropped = applyModelEdit(b9.models['TSK-01']!, { adderRates: { cable_over_1m: [{ value: 'สายซิลิโคน', rate: 120 }] } }, noSc);
  check('  เล่มที่ไม่รวมรหัสย่อยจากฐาน ⇒ ช่องนั้นถูกทิ้ง (เหตุที่ route ต้องส่ง editorBook)',
    !('สายซิลิโคน' in (dropped.adders.find((a) => a.id === 'cable_over_1m')?.rates ?? {})));
  for (const code of ['TSK-01', 'TSK-01-0']) {
    const m = b9.models[code]!;
    const mv = modelEditorView(b9, m);
    const body = { adderRates: Object.fromEntries(mv.adders.filter((a) => a.rates).map((a) => [a.id, a.rates])) };
    check(`${code} — บันทึกจากจอโดยไม่แก้ (มีช่องว่างของซิลิโคนติดไปด้วย) ⇒ JSON เดิมทุกไบต์`,
      JSON.stringify(applyModelEdit(m, body, b9)) === JSON.stringify(m));
  }

  console.log('\n── 10. ความยาวแกน xNN ของ TS_-01 (เจ้าของสั่ง 2026-09-25: "เริ่มคิดเงินเมื่อยาวเกิน std ของแต่ละรุ่น · ยึดราคาจาก excel") ─\n');
  // std = แคตตาล็อก TS_-01 "Tube Length None 5mm." · อัตรา = TS-06 "บวกเพิ่ม 100 mm ละ" แกน 4.8 = 110 · 6 = 120 ปัดขึ้น
  const lenRule = b9.models['TSK-01']!.adders.find((a) => a.id === 'len_l1');
  check('กฎความยาวแกนของ TSK-01 = 4.8 → 110 · 6 → 120 · เกิน 5 mm · 100 mm ละ ปัดขึ้น',
    JSON.stringify(lenRule?.rates) === JSON.stringify({ '4.8': 110, '6': 120 }) && b9.models['TSK-01']!.standard.L1 === 5
      && lenRule?.step === 100 && lenRule?.round === 'ceil' && lenRule?.over === undefined,
    JSON.stringify({ rates: lenRule?.rates, std: b9.models['TSK-01']!.standard }));
  price('TSK-01(M6)4.8x5+1M', 160, 'ยาวเท่ามาตรฐาน 5 mm ⇒ ไม่บวก');
  const x10 = price('TSK-01(M6)4.8x10+1M', 270, 'เกิน 5 mm อยู่ 5 ⇒ ปัดขึ้น 1 × 110 (Excel · ไม่ใช่ราคาขาย Odoo)');
  check('  x10 อ่านเป็นความยาวแกน (ไม่ขึ้นแดง) และบรรทัดราคาบอกว่าเกิน 5mm',
    x10.p.parts.some((x) => x.text === 'x10' && x.kind === 'dim') && x10.r.breakdown.some((l) => /เกิน 5mm/.test(l.detail ?? '')),
    x10.r.breakdown.map((l) => l.detail).join('|'));
  price('TSK-01(M6)4.8x105+1M', 270, 'เกิน 100 พอดี ⇒ 1 บล็อก');
  price('TSK-01(M6)4.8x106+1M', 380, 'เกิน 101 ⇒ 2 × 110');
  price('TSK-01(M8)6x50+1M', 310, 'แกน 6 = 120 ต่อ 100 mm (190 + 120)');
  price('TSP-01(M6)4.8x50+2MTSU', 1190, 'รวมกับค่าสาย: 920 + 110 + 160');
  price('TSK-01 4.8x300+1M', 490, 'ไม่มีวงเล็บ = 1/4” 160 + 3 × 110');
  price('TSK-01(M8)6+1M', 190, 'ไม่มี x ⇒ ไม่มีค่าความยาว (เหมือนเดิม)');
  // แกน 5 ไม่มีในกฎ ⇒ ใช้อัตราของขนาดถัดขึ้นไป (6) + เตือนแกนไม่คู่กับเกลียว (เจ้าของเคาะ B#2/B#8 2026-09-29 — เดิม "ยังไม่รวม")
  const bad = price('TSK-01(M6)5x50+1M', 280, 'แกน 5 ⇒ อัตราแกน 6: 160 + 120');
  check('  และเตือนว่า M6 ใช้แกน 4.8 ตามแคตตาล็อก', bad.p.warnings.some((w) => /M6 ใช้แกน 4\.8/.test(w)), bad.p.warnings.join(' | '));
  const x0 = run('TSK-01-0(M6)x50+1M');
  check('TS_-01-0 ไม่มีแกน ⇒ ไม่ได้กฎความยาวไปด้วย · x ในรหัสขึ้นแดง (ไม่ใช่คิดเงินเงียบ ๆ)',
    !b9.models['TSK-01-0']!.adders.some((a) => a.dim === 'L1') && x0.p.parts.some((x) => /^x50/.test(x.text) && x.kind === 'unknown')
      && !x0.r.breakdown.some((l) => /L1|ความยาวแกน/.test(`${l.label} ${l.detail ?? ''}`)),
    x0.p.parts.map((x) => `${x.text}[${x.kind}]`).join(' '));

  const lenRows = modelEditorView(b9, b9.models['TSK-01']!).adders.find((a) => a.id === 'len_l1')?.rates ?? [];
  check('หน้าชีตมีแถบความยาวแกน 2 ช่อง (4.8 · 6) — ไม่ดึงขนาดแกน 36 ค่าของ TS-06 มา',
    JSON.stringify(lenRows.map((r) => [r.value, r.rate])) === JSON.stringify([['4.8', 110], ['6', 120]]), JSON.stringify(lenRows));
  check('  ยังเปิดแบบชีต Excel ได้', excelReady(b9.models['TSK-01']!));
  const cableRows = modelEditorView(b9, b9.models['TSK-01']!).adders.find((a) => a.id === 'cable_over_1m')?.rates ?? [];
  check('  ช่องราคาสายยังครบ 6 ชนิดเหมือนเดิม', cableRows.length === 6, JSON.stringify(cableRows.map((r) => r.value)));
  const set6 = applyModelEdit(b9.models['TSK-01']!, { adderRates: { len_l1: [{ value: '6', rate: 130 }] } }, b9);
  const b10 = { ...b9, models: { ...b9.models, 'TSK-01': set6 } };
  check('แก้อัตราแกน 6 จากจอเป็น 130 ⇒ TSK-01(M8)6x50+1M = 320',
    computePrice(parseProductCode('TSK-01(M8)6x50+1M', b10).cfg!, b10).unitPrice === 320);
  const blank = applyModelEdit(b9.models['TSK-01']!, { adderRates: { len_l1: [{ value: '6', rate: null }] } }, b9);
  check('  ลบเลขแกน 6 ทิ้ง ⇒ ช่องยังอยู่บนจอให้ใส่คืนได้ (คีย์มาจากกฎของตัวเองในเล่ม ไม่ใช่ TS-06)',
    !('6' in (blank.adders.find((a) => a.id === 'len_l1')?.rates ?? {}))
      && (modelEditorView({ ...b9, models: { ...b9.models, 'TSK-01': blank } }, blank).adders.find((a) => a.id === 'len_l1')?.rates ?? []).length === 1);
  const { book: back10 } = await readUploaded(Buffer.from(makeTemplate(b9, '2026-09-25')));
  // เทียบแบบเรียงคีย์ — แม่แบบเขียน `rates` ก่อน `source` (ลำดับคีย์ในกฎไม่มีผลกับราคาหรือการเรียงชีต)
  const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
  check('แม่แบบ .xlsx ไป-กลับ ⇒ กฎความยาวแกนเท่าเดิมทุกค่า (มี source · ไม่กลายเป็นกฎที่คนเพิ่มเอง)',
    canon(back10?.models['TSK-01']?.adders.find((a) => a.id === 'len_l1')) === canon(lenRule) && !!lenRule?.source,
    JSON.stringify(back10?.models['TSK-01']?.adders.find((a) => a.id === 'len_l1')));
}

console.log('\n── 11. รหัสย่อยแบบ "เปิดกฎ" + ท่อนติดกัน — TS_-08 / TS_-10 ตามแคตตาล็อก (2026-09-25) ──\n');

// แคตตาล็อก TS_-08: ท้ายรหัส = [Element]-[หัวกระโหลก][Ground] เช่น `-2-KBU` · TS_-10: หลัง M = [ชนิดสาย][Ground]
// ความหมายอยู่ในตารางรหัสย่อย (`catalog-subcodes.json`) · ราคาอยู่ในกฎเดิมของชีต (หัว R9–R11 · 2 element U)
const ts08 = book.models['TSP-08'];
const ts10 = book.models['TSP-10'];
if (!ts08 || !ts10) {
  check('สมุดมี TSP-08 และ TSP-10', false);
} else {
  const cat = loadCatalogSubcodes();
  const same = (x: { subCode: string; scope: string }, y: { subCode: string; scope: string }) =>
    x.subCode.toUpperCase() === y.subCode.toUpperCase() && x.scope === y.scope;
  // เล่มในฐานก่อนเขียนยังไม่มีค่ามาตรฐานสาย PVC ของ TS-10 (แมป 16 มีแล้ว) · ราคาสาย TS 160 ของ TS-10 (เจ้าของสั่ง
  // 2026-09-25 "ใช้ 160 เท่า TS_-01 ไปก่อน" — อยู่ในฐานเท่านั้น เล่มจาก --data ไม่มี) · ค่าสายปัดขึ้น (แมปมีแล้ว ฐานก่อน
  // `--rounding` ยังปัดลง) — เติมให้เหมือนกันทั้งสองทาง ด่านจึงให้ผลเดียวกัน
  const b11: PriceBook = {
    ...book,
    models: { ...book.models, 'TSP-10': { ...ts10, axisDefaults: { ...ts10.axisDefaults, cable: 'สายพีวีซี' },
      adders: ts10.adders.map(noSilicone).map((a) => (a.id === 'cable_over_1m'
        ? { ...a, round: 'ceil' as const, rates: { ...a.rates, 'สายเทปล่อนหุ้มชีลด์': a.rates?.['สายเทปล่อนหุ้มชีลด์'] ?? 160 } } : a)) } },
    subCodes: [...(book.subCodes ?? []).filter((x) => !cat.some((c) => same(c, x))), ...cat],
  };
  const run = (code: string, b: PriceBook = b11) => { const p = parseProductCode(code, b); return { p, r: computePrice(p.cfg!, b) }; };
  const parts = (p: ReturnType<typeof parseProductCode>) => p.parts.map((x) => `${x.text}[${x.kind}]`).join(' ');
  const price = (code: string, want: number, label: string) => {
    const { p, r } = run(code);
    const unread = p.parts.filter((x) => x.kind === 'unknown').length;
    check(`${code} = ${want.toLocaleString()} — ${label}`, r.status === 'priced' && r.unitPrice === want && unread === 0,
      `${r.status} ${r.unitPrice} ${r.violations.map((v) => v.message).join('|')} · ${parts(p)}`);
    return { p, r };
  };

  price('TSP-08(S4)6x100-U', 1680, 'U = Unground ไม่มีราคาเพิ่ม · หัวไม่ระบุ = อลูมิเนียมมาตรฐาน');
  const bu = price('TSP-08(S4)6x100-BU', 2180, 'BU = หัว B (+500 จาก TS-08!R10) + U');
  check('  BU แยกเป็นสองท่อนบนจอ (B · U)', parts(bu.p).includes('B[option] U[noPrice]'), parts(bu.p));
  price('TSP-08(S4)6x100-KBU', 2380, 'ยาวสุดก่อน: KB (+700) + U — ไม่ใช่ K + B (+920)');
  price('TSP-08(S4)6x100-KU', 2100, 'K = เบกาไลต์ +420');
  price('TSP-08(S6)8x43-2-BU', 3010, '2 element +750 + หัว B +500 (ราคาตั้งเกลียว 3/4” แกน 8 = 1,760)');
  price('TSP-08(S4)6x100-2BU', 2930, 'ไม่มีขีดคั่น 2 กับ BU ก็แยกได้');
  const e2 = run('TSP-08(S4)4x100-2-BU');
  check('TSP-08(S4)4x100-2-BU — 2 element แกน 4 mm ⇒ กฎห้ามเดิมของรุ่นทำงาน (option จากรหัสย่อยเข้าก่อน constraint)',
    e2.r.status !== 'priced' && e2.r.violations.some((v) => v.id === 'ELEM2_MIN_DIA'), e2.r.violations.map((v) => v.id).join('|'));
  // หัว S/E/SS/SB — Excel ไม่มีราคา · เจ้าของสั่ง 2026-09-25 "ใส่ค่าว่างไว้ก่อน ค่อยกำหนดภายหลังผ่าน ui"
  // ⇒ อ่านออกครบ แต่ "ยังไม่มีราคา" (ไม่ใช่ +0 และไม่ใช่ขึ้นแดง)
  const pendingOf = (r: ReturnType<typeof run>['r']) => r.violations.filter((v) => v.id.startsWith('SUBCODE_PENDING:'));
  for (const code of ['TSP-08(S4)6x100-EU', 'TSP-08(S4)6x100-SU', 'TSP-08(S4)6x100-SSU', 'TSP-08(S4)6x100-SBU']) {
    const x = run(code);
    const pend = pendingOf(x.r);
    check(`${code} — อ่านครบ · ยังไม่มีราคาหัวนี้ ⇒ ไม่ได้ราคา (noRate) ไม่ใช่คิด +0`,
      !x.p.parts.some((y) => y.kind === 'unknown') && x.r.status !== 'priced' && pend.length === 1 && pend[0]!.noRate === true
        && /ยังไม่มีราคา/.test(pend[0]!.message),
      `${x.r.status} ${x.r.violations.map((v) => v.message).join('|')} · ${parts(x.p)}`);
  }
  // แอดมินกรอกเงินที่แถว S ทีหลัง ⇒ คิดได้ทันทีโดยไม่ต้องแก้อะไรอื่น
  const filledS: PriceBook = { ...b11, subCodes: (b11.subCodes ?? []).map((x) => (x.subCode === 'S' && x.scope === 'TSP-08' ? { ...x, amount: 300 } : x)) };
  const fs = run('TSP-08(S4)6x100-SU', filledS);
  check('  กรอกราคาหัว S = 300 จากจอ ⇒ TSP-08(S4)6x100-SU = 1,680 + 300', fs.r.status === 'priced' && fs.r.unitPrice === 1980,
    `${fs.r.status} ${fs.r.unitPrice}`);
  const xu = run('TSP-08(S4)6x100-XU');
  check('  ท่อนที่อ่านได้ไม่ครบทุกตัวอักษร (XU) ⇒ ไม่ใช้ส่วนที่อ่านได้ (ไม่มี U[noPrice] ลอย)',
    xu.p.parts.some((x) => x.text === 'XU' && x.kind === 'unknown') && !xu.p.parts.some((x) => x.text === 'U'), parts(xu.p));

  price('TSP-10(S2)6x100+1MPU', 1535, 'P = พีวีซี · U = Unground · สาย 1 M = มาตรฐาน');
  price('TSP-10(S4)6x100+3MTU', 1940, 'T = เทปล่อน 180 × 2 M');
  const d = price('TSP-10(S2)6x100+2M', 1635, 'ไม่บอกชนิดสาย = พีวีซี (แคตตาล็อก Standard for RTD = TS-10!A41)');
  check('  บรรทัดค่าสายบอกว่าชนิดสายมาจากค่ามาตรฐาน', /ค่ามาตรฐาน/.test(d.r.breakdown.map((l) => l.detail ?? '').join(' ')),
    d.r.breakdown.map((l) => l.detail).join('|'));
  const tsu = run('TSP-10(S2)5x55+5MTSU');
  const tu5 = run('TSP-10(S2)5x55+5MTU');
  check('TSP-10(S2)5x55+5MTSU — TS = เทปล่อนหุ้มชีลด์ 160/ม. (เจ้าของสั่ง 2026-09-25) ⇒ ถูกกว่าเทปล่อน 180 อยู่ 4 ม. × 20',
    tsu.r.status === 'priced' && tu5.r.status === 'priced' && tsu.p.parts.some((x) => x.text === 'TS' && x.kind === 'axis')
      && tsu.r.unitPrice === tu5.r.unitPrice - 4 * 20,
    `${tsu.r.status} ${tsu.r.unitPrice} vs ${tu5.r.unitPrice} ${tsu.r.violations.map((v) => v.message).join('|')}`);
  const cu = run('TSP-10(S2)5x55+5MCU');
  check('TSP-10(S2)5x55+5MCU — สาย C ของ TS-10 ยังไม่มีราคา ⇒ ไม่ได้ราคา (ไม่ใช่คิดเป็นพีวีซี)',
    cu.r.status !== 'priced' && cu.r.violations.some((v) => v.noRate && /ซิลิโคน/.test(v.message)),
    `${cu.r.status} ${cu.r.violations.map((v) => v.message).join('|')}`);

  // ค่าสายเกินมาตรฐาน **เศษปัดขึ้นเป็นเมตรเต็ม** ทุกตระกูล — เจ้าของสั่ง 2026-10-01: "ถ้าเกินมาตรฐานไม่เต็มเมตรก็ปัดเป็นเมตรเต็มเลย
  // ใช้กับทุกตระกูล" (แทนคำสั่ง 2026-09-25 ที่นับเฉพาะเมตรเต็ม) ⇒ `round: 'ceil'` เหมือน BH
  price('TSP-10(S2)6x100+1.5MPU', 1635, 'สาย 1.5 M เกินมาตรฐาน 0.5 M ⇒ ปัดขึ้นเป็น 1 เมตร (พีวีซี 100)');
  price('TSP-10(S2)6x100+2.5MPU', 1735, 'สาย 2.5 M เกิน 1.5 M ⇒ ปัดขึ้นเป็น 2 เมตร');
  price('TSP-10(S2)6x100+2MPU', 1635, 'สาย 2 M เกินพอดี 1 M ⇒ คิด 1 เมตร');
  for (const f of readdirSync(new URL('../pricebook/maps/', import.meta.url))) {
    const spec = JSON.parse(readFileSync(new URL(`../pricebook/maps/${f}`, import.meta.url), 'utf8')) as { code: string; adders?: Adder[] };
    const cab = spec.adders?.find((a) => a.id === 'cable_over_1m');
    if (cab) check(`แมป ${f}: ค่าสายเกินมาตรฐานปัดขึ้น (เศษคิดเต็มเมตร)`, (cab.round ?? 'ceil') === 'ceil', String(cab.round));
  }

  // เกลียวมิลของ TS_-08/10 — ชีตมีแต่เกลียวนิ้ว · เจ้าของสั่ง 2026-09-25 ใส่ค่าว่างไว้ก่อน ⇒ อ่านออก "ยังไม่มีราคา"
  // และ **ห้ามมีข้อความ "รหัสไม่ได้บอกเกลียว"** (รหัสบอกแล้ว — ที่ขาดคือราคา)
  for (const code of ['TSP-08(M8)6x100-BU', 'TSP-08(M16)6x100-U', 'TSP-10(M12)6x100+1MPU', 'TSP-10(M6)6x100+2MTU']) {
    const x = run(code);
    const pend = pendingOf(x.r);
    check(`${code} — อ่านครบ · เกลียวมิลยังไม่ได้กำหนดคอลัมน์ ⇒ ยังไม่มีราคา ข้อความเดียว`,
      !x.p.parts.some((y) => y.kind === 'unknown') && x.r.status !== 'priced' && pend.length === 1 && /เกลียว/.test(pend[0]!.message)
        && !x.r.violations.some((v) => v.id === 'NO_BASE_PRICE' || v.missing),
      `${x.r.status} ${x.r.violations.map((v) => `${v.id}:${v.message}`).join('|')} · ${parts(x.p)}`);
  }
  // แอดมินเลือกคอลัมน์ให้ M8 ทีหลัง ⇒ ราคาตั้งมาจากคอลัมน์นั้นทันที (ไม่ได้พิมพ์ตัวเลขใหม่)
  const s2 = run('TSP-08(S2)6x100-BU');
  const s2Thread = s2.r.status === 'priced' ? parseProductCode('TSP-08(S2)6x100-BU', b11).cfg?.axes?.thread : undefined;
  const filledM8: PriceBook = { ...b11, subCodes: (b11.subCodes ?? []).map((x) => (x.subCode === 'M8' && x.scope === 'TSP-08' ? { ...x, value: s2Thread } : x)) };
  const m8 = run('TSP-08(M8)6x100-BU', filledM8);
  check(`  เลือกให้ M8 เทียบคอลัมน์ ${s2Thread ?? '?'} จากจอ ⇒ ราคาเท่ารหัส (S2) เป๊ะ`,
    !!s2Thread && m8.r.status === 'priced' && m8.r.unitPrice === s2.r.unitPrice, `${m8.r.status} ${m8.r.unitPrice} vs ${s2.r.unitPrice}`);

  // แถวที่เปิดกฎที่รุ่นนั้นไม่มี (ตั้งผิดรุ่น/ขอบเขตกว้างเกิน) — ต้องขึ้นแดง ไม่ใช่ "อ่านครบ" ทั้งที่ไม่ได้คิดเงิน
  const wrong: PriceBook = { ...b11, subCodes: [...(b11.subCodes ?? []),
    { subCode: 'B', match: 'exact', scope: 'TSP-10', reads: 'หัว B', effect: 'option', value: 'head:alu_l' }] };
  const w = run('TSP-10(S2)6x100+1MPU-B', wrong);
  check('แถว "เปิดกฎ" ที่รุ่นไม่มีกฎนั้น ⇒ ท่อนนั้นขึ้นแดง ราคาไม่ขยับ', w.p.parts.some((x) => x.text === 'B' && x.kind === 'unknown') && w.r.unitPrice === 1535,
    `${w.r.unitPrice} · ${parts(w.p)}`);

  check('clean(): แถว "เปิดกฎ" ที่ไม่บอกว่าเปิดกฎไหน ⇒ ปฏิเสธ', clean({ subCode: 'B', scope: 'TSP-08', effect: 'option' }) === null);
  check('clean(): แถว "เปิดกฎ" เก็บชื่อ option ไว้', clean({ subCode: 'B', scope: 'TSP-08', effect: 'option', value: 'head:alu_l' })?.value === 'head:alu_l');
  const blankFlat = clean({ subCode: 'S', scope: 'TSP-08', effect: 'flat', reads: 'หัว S' });
  check('clean(): บวกเงินที่ช่องเงินว่าง ⇒ เก็บไว้เป็น "ยังไม่มีราคา" (ไม่ใช่ 0)', !!blankFlat && blankFlat.amount === undefined, JSON.stringify(blankFlat));
  check('clean(): ราคาตั้งต้นที่ช่องเงินว่าง ⇒ ปฏิเสธ', clean({ subCode: 'Q', scope: 'TSP-08', effect: 'basePrice' }) === null);
  const blankAxis = clean({ subCode: 'M8', scope: 'TSP-08', effect: 'setAxis', axis: 'thread' });
  check('clean(): ตั้งค่าให้ช่องที่ยังไม่บอกค่า ⇒ เก็บไว้เป็น "ยังไม่มีราคา"', !!blankAxis && blankAxis.axis === 'thread' && blankAxis.value === undefined, JSON.stringify(blankAxis));
  check('clean(): ตั้งค่าให้ช่องที่ไม่บอกช่อง ⇒ ปฏิเสธ', clean({ subCode: 'M8', scope: 'TSP-08', effect: 'setAxis' }) === null);

  const { book: back11 } = await readUploaded(Buffer.from(makeTemplate(b11, '2026-09-25')));
  const bRow = back11?.subCodes?.find((x) => x.subCode === 'B' && x.scope === 'TSP-08');
  check('แม่แบบ .xlsx ไป-กลับ ⇒ แถว "เปิดกฎ" ยังเป็นเปิดกฎ head:alu_l', bRow?.effect === 'option' && bRow.value === 'head:alu_l', JSON.stringify(bRow));
  const sRow = back11?.subCodes?.find((x) => x.subCode === 'S' && x.scope === 'TSP-08');
  const m8Row = back11?.subCodes?.find((x) => x.subCode === 'M8' && x.scope === 'TSP-08');
  check('แม่แบบ .xlsx ไป-กลับ ⇒ แถวค่าว่างยังว่าง (หัว S ไม่มีเงิน · M8 ไม่มีค่า) ไม่กลายเป็น 0',
    sRow?.effect === 'flat' && sRow.amount === undefined && m8Row?.effect === 'setAxis' && m8Row.axis === 'thread' && m8Row.value === undefined,
    `${JSON.stringify(sRow)} ${JSON.stringify(m8Row)}`);
}

// ── เกลียวที่บอกมาแล้ว · สายที่เกินไม่ถึงเมตร (2026-09-25 หลัง deploy) ─────────────────────────────
// ตรวจแบบเทียบกันเองในเล่มเดียวกัน ไม่ผูกกับตัวเลขในฐาน — ราคาเปลี่ยนได้ แต่ความสัมพันธ์ต้องจริงเสมอ
console.log('\n── 12. เกลียวที่อ่านไม่ออก / เกลียวนิ้วไม่มีเครื่องหมาย · สายเกินไม่ถึงเมตร · BH ─────────\n');
{
  const run = (code: string) => { const p = parseProductCode(code, book); return { p, r: computePrice(p.cfg!, book) }; };
  const why = (x: ReturnType<typeof run>) => `${x.r.status} ${x.r.unitPrice} ${x.r.violations.map((v) => `${v.id}:${v.message}`).join('|')}`;
  if (!book.models['TSK-01'] || !book.models['TSK-01-0']) {
    console.log('  (ข้าม — สมุดไม่มี TSK-01/TSK-01-0)');
  } else {
    // เจ้าของสั่ง 2026-09-25: `(5/16)` ที่ไม่มีเครื่องหมายนิ้ว = `5/16”` · เดิมตกไปคิดเกลียวมาตรฐาน 1/4” (240 แทน 270 · 81 รหัสจริง)
    const bare = run('TSJ-01(5/16)4.8+2M');
    const inch = run('TSJ-01(5/16”)4.8+2M');
    const quarter = run('TSJ-01(1/4”)4.8+2M');
    check('TSJ-01(5/16)4.8+2M — ไม่มีเครื่องหมายนิ้ว ⇒ ราคาเท่า (5/16”) เป๊ะ',
      bare.r.status === 'priced' && inch.r.status === 'priced' && bare.r.unitPrice === inch.r.unitPrice
        && !bare.p.parts.some((x) => x.kind === 'unknown'), `${why(bare)} vs ${why(inch)}`);
    check('  และไม่ใช่ราคาของเกลียวมาตรฐาน 1/4”', quarter.r.status !== 'priced' || quarter.r.unitPrice !== bare.r.unitPrice,
      `${why(bare)} vs ${why(quarter)}`);
    // บอกเกลียวมาแล้วแต่ตารางไม่มี ⇒ ห้ามเติมเกลียวมาตรฐานของรุ่น (1/4” · M5) แล้วคิดราคาของเกลียวคนละขนาด
    // (TS_-01 เกลียวนอกแคตตาล็อก = "ต้องขอราคา" ตั้งแต่ 2026-09-29 · TS_-01-0 ตั้งแต่ 2026-10-05 — ด่าน diag:pricing-catalog-ts ข้อ 5)
    for (const code of ['TSK-01-0(M12)+2M', 'TSK-01-0(S1)+2M', 'TSK-01-0(15)+2M']) {
      const x = run(code);
      const raw = code.match(/\(([^)]*)\)/)![1]!;
      check(`${code} — ตารางไม่มี Hold Size นี้ ⇒ ไม่ได้ราคา · "ต้องขอราคาจากฝ่ายผลิต" ของ ${raw} · ไม่เติม M5 มาตรฐาน`,
        x.r.status === 'quoteOnRequest' && x.r.violations.some((v) => v.askPrice && v.message.includes(raw))
          && !x.r.breakdown.some((b) => b.step === 'base' || /ค่ามาตรฐานของรุ่น/.test(b.detail ?? '')), why(x));
    }
    const plain = run('TSK-01+2M');
    const std = run('TSK-01(1/4”)+2M');
    check('TSK-01+2M (ไม่มีวงเล็บ) ⇒ ยังคิดเกลียวมาตรฐาน 1/4” เหมือนเดิม', plain.r.status === 'priced' && plain.r.unitPrice === std.r.unitPrice,
      `${why(plain)} vs ${why(std)}`);
  }
  const ts04 = Object.keys(book.models).find((k) => k === 'TSJ-04' || k === 'TSK-04');
  if (ts04) {
    const both = run('TSJ-04(20G)7.8x5.56+1M');
    check('TSJ-04(20G)… — ขาดสองแกน ⇒ ข้อความบอกครบทั้ง "เกลียวยังไม่ได้กำหนด" และ "ไม่ได้บอกขนาดแกน"',
      both.r.violations.some((v) => v.message.includes('"(20G)"') && /ไม่ได้บอกขนาดแกน/.test(v.message)), why(both));
  }
  if (Object.keys(book.models).some((k) => /^TS.-11$/.test(k))) {
    // ค่าสายปัดขึ้น (เจ้าของ 2026-10-01) ⇒ เกินไม่ถึงเมตรก็คิด 1 เมตร · ไม่บอกชนิดสาย = ใช้ค่ามาตรฐานของเล่ม (ข้างล่าง)
    const x15 = run('TSJ-11 6x30+1.5M');
    const x1 = run('TSJ-11 6x30+1M');
    const x25 = run('TSJ-11 6x30+2.5M');
    // เล่มที่มีค่ามาตรฐานสาย (แคตตาล็อก TS ข้อ 5: TS-11 ไม่ระบุ = สแตนเลสถัก · เข้าเล่มด้วย --extras-only) คิดตามค่านั้น
    // เล่มที่ยังไม่มีต้องบล็อก — ด่านนี้รันกับเล่มในฐานจริง จึงต้องเช็กตามเล่ม ไม่ใช่สมมติว่าเล่มยังเก่า
    const m11 = Object.entries(book.models).find(([k]) => /^TS.-11$/.test(k))![1];
    const std11 = m11.axisDefaults?.cable;
    const cab11 = m11.adders.find((a) => a.id === 'cable_over_1m');
    if ((cab11?.round ?? 'ceil') !== 'ceil') {
      console.log('  (ข้ามข้อสาย TS-11 — เล่มในฐานยังนับเฉพาะเมตรเต็ม · รัน importer.ts --rounding ก่อน)');
    } else if (std11) {
      const perM = cab11?.rates?.[std11];
      check(`TSJ-11 6x30+1.5M — เกินไม่ถึงเมตร ไม่บอกชนิดสาย ⇒ ปัดขึ้น คิดสาย ${std11} 1 เมตร`,
        x15.r.status === 'priced' && perM !== undefined && x15.r.unitPrice === x1.r.unitPrice + perM, `${why(x15)} vs ${why(x1)} · ${perM}`);
      check(`  TSJ-11 6x30+2.5M — เกิน 1.5 M ⇒ ปัดขึ้น คิด 2 เมตร`,
        x25.r.status === 'priced' && perM !== undefined && x25.r.unitPrice === x1.r.unitPrice + 2 * perM, `${why(x25)} vs ${why(x1)} · ${perM}`);
    } else {
      check('  TSJ-11 6x30+1.5M — เกินแล้วต้องรู้ชนิดสาย ⇒ ยังไม่ได้ราคา (ไม่ใช่ข้ามค่าสายไปเงียบ ๆ)',
        x15.r.status !== 'priced' && x15.r.violations.some((v) => /ชนิดสาย/.test(v.message)), why(x15));
    }
  }
  if (Object.keys(book.models).some((k) => /^TS.-04$/.test(k))) {
    // ค่าสายปัดขึ้น (เจ้าของ 2026-10-01) ⇒ เกินไม่ถึงเมตรก็ต้องรู้ชนิดสาย — F อยู่ในตารางรหัสย่อยจากแคตตาล็อก (ไฟล์ในรีโป ไม่พึ่งฐาน)
    const b04 = withSubCodes(book, loadCatalogSubcodes());
    const run04 = (code: string) => { const p = parseProductCode(code, b04); return { p, r: computePrice(p.cfg!, b04) }; };
    const f = run04('TSK-04(S2)5x100+1.2MF');
    const f1 = run04('TSK-04(S2)5x100+1MF');
    const m04 = Object.entries(b04.models).find(([k]) => /^TS.-04$/.test(k))![1];
    const fiber = m04.adders.find((a) => a.id === 'cable_over_1m')?.rates?.['สายไฟเบอร์กลาส'];
    check('TSK-04(S2)5x100+1.2MF — สายเกินไม่ถึงเมตร ⇒ ปัดขึ้น คิดสายไฟเบอร์กลาส 1 เมตร ไม่มีเตือน "ยังไม่รวม"',
      f.r.status === 'priced' && !f.r.violations.some((v) => /ยังไม่รวม/.test(v.message)) && fiber !== undefined && f.r.unitPrice === f1.r.unitPrice + fiber,
      `${why(f)} vs ${why(f1)} · ${fiber}`);
  }
}
// BH ใช้กติกาเดิมของชีต: "Standard ออกสายยาว 30 CM · ถ้าความยาวสายเกิน 30 CM บวกเพิ่มเมตรละ 60 บาท (คูณ 2 เพราะใช้ 2 เส้น)"
// (`BH!A19:A20` · เจ้าของยืนยัน 2026-09-25) ⇒ **ปัดขึ้น** ไม่ใช่นับเมตรเต็มแบบ TS — ห้ามรวมเข้ากับ `--rounding` ของ TS
{
  const spec = JSON.parse(readFileSync(new URL('../pricebook/maps/01-BH-01.map.json', import.meta.url), 'utf8')) as { adders?: Adder[] };
  const cab = spec.adders?.find((a) => a.id === 'cable_over_30cm');
  check('แมป BH-01: สายเกิน 30 CM ปัดขึ้น · ทีละ 100 cm · 60 บาท × 2 เส้น',
    cab?.round === 'ceil' && cab.step === 100 && cab.rate === 60 && cab.times === 2, JSON.stringify(cab));
  const inBook = bh01?.adders.find((a) => a.id === 'cable_over_30cm');
  if (inBook) check('เล่มในฐาน BH-01: สายเกิน 30 CM ยังปัดขึ้น', (inBook.round ?? 'ceil') === 'ceil', String(inBook.round));
  // BH-03 **ไม่ใช้** กฎนี้ (เจ้าของตอบ 2026-09-28) — ชีตเขียนไว้เฉพาะบล็อก BH-01/02 (`A19:C20`) · ห้ามเติมให้ "ครบซีรีส์"
  const bh03Map = JSON.parse(readFileSync(new URL('../pricebook/maps/03-BH-03.map.json', import.meta.url), 'utf8')) as { adders?: Adder[] };
  check('BH-03 ไม่มีกฎสายเกิน 30 CM (ทั้งแมปและเล่มในฐาน)',
    !bh03Map.adders?.some((a) => a.id === 'cable_over_30cm') && !bh03?.adders.some((a) => a.id === 'cable_over_30cm'));
}

console.log('\n── 13. สมุดราคาแบบ Excel ทุกชีต (เจ้าของสั่ง 2026-09-28) — ทางบันทึกของหน้าชีต ─────────\n');
{
  const rejects = (fn: () => unknown): string | null => {
    try { fn(); return null; } catch (e) { return e instanceof EditRejected ? e.message : `ไม่ใช่ EditRejected: ${String(e)}`; }
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  // ก. หน้าชีตไม่ส่ง variant / constraintsOff — ต้องคงเดิม ไม่ใช่ลบรุ่น C หรือเปิดข้อจำกัดที่ปิดไว้คืน
  const bhOff: PriceModel = { ...bh01, constraints: bh01.constraints.map((c, i) => (i === 0 ? { ...c, disabled: true } : c)) };
  const bhKeep = applyModelEdit(bhOff, {}, withModel(bhOff));
  check('บันทึกจากหน้าชีตเปล่า ๆ (BH-01) ⇒ รุ่นเดิมทุกไบต์ — รุ่น C ไม่หาย ข้อจำกัดที่ปิดไว้ยังปิด', same(bhKeep, bhOff));
  check('  หน้าแก้ทีละรุ่นยังปิดข้อจำกัดได้เหมือนเดิม (ส่ง constraintsOff: [] = เปิดทุกข้อ)',
    applyModelEdit(bhOff, { constraintsOff: [] }, withModel(bhOff)).constraints.every((c) => !c.disabled));

  // ข. ราคาช่วงขนาด (BH) — แก้แค่ราคา หัวท้ายช่วงคงเดิม · ช่วงที่ไม่ได้ส่งเป็น object เดิม · ว่าง = ไม่รับผลิต
  if (bh01.base.kind === 'banded') {
    const bands = bh01.base.bands;
    const nb = applyModelEdit(bh01, { bandPrices: { 0: 777 } }, book);
    const out = nb.base.kind === 'banded' ? nb.base.bands : [];
    check('ราคาช่วงแรกของ BH-01 เป็น 777 · หัวท้ายช่วงเท่าเดิม',
      (out[0]?.flat ?? out[0]?.rate) === 777 && out[0]?.min === bands[0]!.min && out[0]?.max === bands[0]!.max);
    check('  ช่วงอื่นเท่าเดิมทุกไบต์', same(out.slice(1), bands.slice(1)));
    const ri = bands.findIndex((b) => b.flat === undefined && b.rate !== undefined);
    if (ri >= 0) {
      const nr = applyModelEdit(bh01, { bandPrices: { [ri]: 30 } }, book);
      const b = nr.base.kind === 'banded' ? nr.base.bands[ri] : undefined;
      check(`  ช่วงที่คิดต่อหน่วย (${bands[ri]!.label ?? ri}) ยังคิดต่อหน่วย`, b?.rate === 30 && b.flat === undefined, JSON.stringify(b));
    }
    const ne = applyModelEdit(bh01, { bandPrices: { 0: null } }, book);
    const b0 = ne.base.kind === 'banded' ? ne.base.bands[0] : undefined;
    check('  ลบราคาช่วง = ไม่รับผลิตช่วงนั้น (ไม่ใช่ 0)', b0 !== undefined && b0.flat === undefined && b0.rate === undefined);
    check('  ช่วงที่ไม่มีอยู่ถูกปฏิเสธ', !!rejects(() => applyModelEdit(bh01, { bandPrices: { 99: 1 } }, book)));
  }

  // ค. ราคาของกฎราคาเดียว — ตามชนิด · ว่างไม่ได้ · กฎที่แยกตามแกนใช้ทางนี้ไม่ได้
  const flat = bh01.adders.find((a) => a.kind === 'flat' && !a.rates && a.amount !== undefined);
  const per = bh01.adders.find((a) => a.kind === 'perUnit' && !a.rates);
  if (flat && per) {
    const na = applyModelEdit(bh01, { adderPrices: { [flat.id]: 999, [per.id]: 7 } }, book);
    const f2 = na.adders.find((a) => a.id === flat.id)!;
    const p2 = na.adders.find((a) => a.id === per.id)!;
    check(`ราคา "${flat.label}" (เหมา) = 999 · "${per.label}" (ต่อหน่วย) = 7 · ชื่อ/เงื่อนไขเท่าเดิม`,
      f2.amount === 999 && p2.rate === 7 && same(f2.when, flat.when) && f2.label === flat.label);
    check('  กฎอื่นเท่าเดิมทุกไบต์', same(na.adders.filter((a) => a.id !== flat.id && a.id !== per.id),
      bh01.adders.filter((a) => a.id !== flat.id && a.id !== per.id)));
    check('  ราคาว่างถูกปฏิเสธ (ว่าง ≠ ปิดกฎ)', /ว่างไม่ได้/.test(rejects(() => applyModelEdit(bh01, { adderPrices: { [flat.id]: null } }, book)) ?? ''));
    check('  พิมพ์ไม่ใช่ตัวเลขถูกปฏิเสธ', !!rejects(() => applyModelEdit(bh01, { adderPrices: { [flat.id]: 'abc' } }, book)));
    // กฎที่ยังไม่เคยมีราคา (PL-5 ของ BH) — ว่างต่อ = คงเดิม ไม่ใช่ข้อผิด · กรอกแล้วได้ราคา (แก้ 2026-10-05:
    // เดิมช่องว่างของ PL-5 ทำให้ชีต BH ทั้งหน้าบันทึกไม่ได้) — สร้างกฎว่างเองจากกฎที่มีราคา ไม่พึ่งข้อมูลในเล่ม
    const { amount: _drop, ...emptyRule } = flat;
    const bhEmpty = { ...bh01, adders: bh01.adders.map((a) => (a.id === flat.id ? emptyRule : a)) };
    const keep = applyModelEdit(bhEmpty, { adderPrices: { [flat.id]: null } }, book);
    check('  กฎที่ยังไม่มีราคา ส่งว่าง = คงเดิม (ไม่ถูกปฏิเสธ · ไม่กลายเป็น 0)',
      same(keep.adders.find((a) => a.id === flat.id), emptyRule));
    const filled = applyModelEdit(bhEmpty, { adderPrices: { [flat.id]: 150 } }, book);
    check('  กฎที่ยังไม่มีราคา กรอก 150 → ราคา 150', filled.adders.find((a) => a.id === flat.id)?.amount === 150);
  }
  const tsk04 = Object.values(book.models).find((m) => /^TS.-04$/.test(m.code));
  const rated = tsk04?.adders.find((a) => a.rates);
  if (tsk04 && rated) {
    check('  กฎที่แยกตามแกนแก้ผ่านราคาเดียวไม่ได้', !!rejects(() => applyModelEdit(tsk04, { adderPrices: { [rated.id]: 1 } }, book)));
  }

  // ง. รุ่น C จากหน้าชีต — % และราคาฝั่งรุ่น C · ข้อความ/ที่มาคงเดิม
  if (bh01.variant) {
    const vr = bh01.variant;
    const nv = applyModelEdit(bh01, { variant: { suffix: vr.suffix, label: vr.label, percent: 25, disabled: !!vr.disabled, adderPrices: vr.adderPrices ?? {} } }, book);
    check('รุ่น C: % เปลี่ยนเป็น 25 · ราคาฝั่งรุ่น C · ที่มา · ยืนยันแล้ว เท่าเดิม',
      nv.variant?.percent === 25 && same(nv.variant?.adderPrices, vr.adderPrices) && nv.variant?.source === vr.source && nv.variant?.confirmed === vr.confirmed);
  }

  // จ. ตารางสามแกน (TS-08 · TS-10) — จอเห็นทุกช่อง และแก้ช่องเดียวแล้วช่องอื่นเท่าเดิม
  const three = Object.values(book.models).find((m) => m.base.kind === 'matrix' && m.base.axes.length === 3);
  if (three && three.base.kind === 'matrix') {
    const view = modelEditorView(book, three);
    const vb = view.base.kind === 'matrix' ? view.base : undefined;
    const shown = vb?.cells?.flat().filter((x) => x !== null).length ?? 0;
    check(`${three.code} (สามแกน) จอเห็นราคาครบทุกช่อง`, shown === Object.keys(three.base.cells).length,
      `${shown} / ${Object.keys(three.base.cells).length}`);
    const [k0, v0] = Object.entries(three.base.cells)[0]!;
    const n3 = applyModelEdit(three, { cells: { [k0]: v0 + 5 } }, book);
    const c3 = n3.base.kind === 'matrix' ? n3.base.cells : {};
    check(`  แก้ช่อง "${k0}" แล้วช่องนั้นเปลี่ยน ช่องอื่นเท่าเดิม ลำดับคีย์เดิม`,
      c3[k0] === v0 + 5 && same(Object.keys(c3), Object.keys(three.base.cells))
      && Object.entries(three.base.cells).every(([k, v]) => k === k0 || c3[k] === v));
    check('  ช่องที่ไม่มีในตารางถูกปฏิเสธ', !!rejects(() => applyModelEdit(three, { cells: { 'ไม่มี | ไม่มี | ไม่มี': 1 } }, book)));
    check('  บันทึกเปล่าได้รุ่นเดิมทุกไบต์', same(applyModelEdit(three, {}, book), three));
  }

  // ฉ. คอลัมน์บวกเพิ่มในตารางหลัก (แยกตามแกนแถว) กรอกได้ทุกแถวที่ตารางมี — ไม่ใช่ถูกทิ้งเงียบ ๆ
  if (tsk04 && tsk04.base.kind === 'matrix') {
    const rowsOf = [...new Set(Object.keys(tsk04.base.cells).map((k) => k.split(' | ')[0]!))];
    const a = tsk04.adders.find((x) => x.rates && x.byAxis === (tsk04.base as { axes: string[] }).axes[0] && rowsOf.some((r) => !(r in x.rates!)));
    const r = a && rowsOf.find((x) => !(x in a.rates!));
    if (a && r) {
      const nr = applyModelEdit(tsk04, { adderRates: { [a.id]: [{ value: r, rate: 55 }] } }, book);
      const got = nr.adders.find((x) => x.id === a.id)?.rates?.[r];
      check(`${tsk04.code} "${a.label}" แถว ${r} ที่เคยว่าง กรอกได้ (55)`, got === 55, String(got));
      check('  หน้าแก้ทีละรุ่นไม่ได้ช่องว่างเพิ่ม (knownRateKeys ไม่ขยาย)',
        (modelEditorView(book, tsk04).adders.find((x) => x.id === a.id)?.rates?.length ?? 0) === Object.keys(a.rates!).length);
    }
  }
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`ผล: ผ่าน ${pass} · ตก ${fails.length}`);
console.log('─'.repeat(70));
process.exit(fails.length ? 1 : 0);
