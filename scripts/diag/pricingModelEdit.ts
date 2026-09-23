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
import { EditRejected, applyModelEdit, modelEditorView } from '../../services/pricingLab/modelEditor.js';
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

console.log(`\n${'─'.repeat(70)}`);
console.log(`ผล: ผ่าน ${pass} · ตก ${fails.length}`);
console.log('─'.repeat(70));
process.exit(fails.length ? 1 : 0);
