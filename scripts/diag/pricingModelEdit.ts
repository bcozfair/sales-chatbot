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
import type { PriceBook, PriceModel } from '../../services/pricingLab/types.js';

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

console.log(`\n${'─'.repeat(70)}`);
console.log(`ผล: ผ่าน ${pass} · ตก ${fails.length}`);
console.log('─'.repeat(70));
process.exit(fails.length ? 1 : 0);
