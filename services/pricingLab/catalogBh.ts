// ─────────────────────────────────────────────────────────────────────────────
//  "การสั่งซื้อ" ของแคตตาล็อก BH — ลำดับท่อนของรหัส + ตัวเลือกของแต่ละท่อน
//
//  โมดูล "คิดราคาสินค้า" — ถอดออกได้ทั้งก้อน ดู services/pricingLab/README.md · docs/pricing-code-bh.md
//
//  ⚠️ โมดูลนี้ถูกเรียกจาก routes/pricingLab.ts เท่านั้น และ **ห้ามมีโค้ดเดิมที่ไหน import
//     โฟลเดอร์นี้** — การพึ่งพาเป็นทางเดียวคือสิ่งเดียวที่ทำให้ "ลบทิ้งเมื่อไหร่ก็ได้" เป็นจริง
//
//  **ที่มา:** แคตตาล็อก `backup/Catalogue/BH-01,BH-01C.pdf` · `BH-02.pdf` · `BH-03.pdf` หัวข้อ "การสั่งซื้อ"
//  (เจ้าของสั่ง 2026-09-28: *"ออกแบบการระบุรายละเอียด และการคำนวณ ตาม pattern การประกอบรหัสจากแคตตาล็อก"*
//  แล้วเคาะหน้าตาจาก mockup แบบ A "กรอกในรหัส") ⇒ ไฟล์นี้คือ **ข้อมูลชุดเดียว** ที่ใช้สามที่:
//    1. หน้าคำนวณราคาวาดช่องกรอกเรียงตามแคตตาล็อก (ส่งไปทาง `/overview` — ไม่มีราคาสักบาท)
//    2. `buildBhCode` ประกอบรหัสจากช่องที่กรอก (รูปแบบเดียวกับ Odoo: `BH-01 …` เว้นวรรค · `BH-01C-…` ขีด)
//    3. `readBh` ใน code.ts อ่านรหัสกลับเป็นช่อง ⇒ `diag:pricing-catalog` พิสูจน์ว่าสองทางนี้กลับกันได้พอดี
//
//  **ไฟล์นี้ไม่รู้จักราคา** — มันบอกแค่ว่าตัวอักษรในรหัสแปลว่าอะไร ส่วน "แปลว่าอะไร → คิดเงินเท่าไหร่"
//  อยู่ที่กฎของสมุดราคา (N → กฎ `nut` · PL2 → `conn_pl2` · 1/2/3 → ความยาวสายเข้ากฎ `cable_over_30cm`)
//  และตัวที่ชีตยังไม่มีราคา (PL5) อยู่ในตารางรหัสย่อยเป็นแถวค่าว่าง ⇒ แก้ราคาที่เดิมทุกอย่าง ไม่ต้องแตะไฟล์นี้
// ─────────────────────────────────────────────────────────────────────────────

export type BhFamily = 'BH-01' | 'BH-01C' | 'BH-02' | 'BH-03';

/** ค่าหนึ่งตัวของท่อนแบบเลือก — `code` ว่าง = "None" ของแคตตาล็อก (ไม่เขียนอะไรลงรหัส) */
export interface CatalogOption {
  code: string;
  label: string;
}

/** ขนาดในรหัส — BH-01/03 = ID × H · BH-02 ตามรูปทรง */
export type SizeKey = 'id' | 'h' | 'w' | 'l' | 'd1' | 'd2';

export interface CatalogShape {
  /** ตัวอักษรท้าย `BH-02` — ว่าง = สี่เหลี่ยม */
  code: string;
  label: string;
  dims: SizeKey[];
}

export interface CatalogSlot {
  label: string;
  kind: 'number' | 'choice' | 'text';
  unit?: string;
  options?: CatalogOption[];
  /** ค่าที่แนะนำ (ช่องแบบพิมพ์เองที่แคตตาล็อกมีรายการให้ เช่นแรงดัน) */
  suggest?: string[];
  /** ข้อความใต้ช่องจากแคตตาล็อก เช่น "เล็กสุด 25 mm" */
  hint?: string;
  /** true = ช่องนี้ **ไม่อยู่ในรหัส** (ขนาดเต๋า 10A/30A) — จอต้องบอกคนกรอกว่ามันไม่ถูกพิมพ์ลงรหัส */
  offCode?: boolean;
}

/** ท่อนตามลำดับแคตตาล็อก — `sep` คือตัวคั่นที่ **พิมพ์ลงรหัสจริง** (ไม่ใช่ตัวที่วาดในแผนผัง) */
export type CatalogLayoutItem = { slot: string } | { sep: string };

export interface CatalogFamilySpec {
  family: BhFamily;
  /** ตัวหน้าที่ตายตัวของรหัส */
  head: string;
  /** ชื่อรุ่นตามแคตตาล็อก (อังกฤษ ไม่แปล — เจ้าของสั่ง 2026-09-28) · โผล่เฉพาะในรายการของ dropdown "รุ่น" */
  name: string;
  layout: CatalogLayoutItem[];
  slots: Record<string, CatalogSlot>;
  /** มีเฉพาะ BH-02 — ท่อน `size` วาดตามขนาดของรูปทรงที่เลือก */
  shapes?: CatalogShape[];
  /**
   * "สิ่งที่ต้องบวกเพิ่ม" ที่ **ไม่อยู่ในรหัสและไม่อยู่ในแคตตาล็อก** แต่ชีตมีราคา (สาย Silicone · สายถักสแตนเลส · ท่อเฟ็กส์)
   * `code` = ตัวเลือก (`option`) ที่กฎของสมุดราคาใช้เปิด ⇒ ราคาอยู่ที่สมุดราคาที่เดียว ที่นี่มีแค่ชื่อ
   */
  addons?: CatalogOption[];
  /**
   * true = มีช่อง "เจาะรู" นอกรหัส (หมายเหตุของแคตตาล็อกทั้งสามเล่ม: "ถ้ามีเจาะรูควรระบุขนาดและตำแหน่งเจาะรู")
   * ราคาอยู่ที่กฎ `hold` ของสมุดราคา (ชีต "Hold (OD-mm) 5฿ / mm.") — ที่นี่มีแค่ว่ารุ่นนี้กรอกได้
   */
  holes?: boolean;
}

/**
 * รูที่เจาะ หนึ่งแถว = รูขนาดเดียวกัน `count` รู เส้นผ่านศูนย์กลาง `mm` — **ไม่อยู่ในรหัส** (รหัสจริงไม่มีท่อนนี้)
 * เจ้าของตอบ 2026-09-29: คิดต่อรู × ขนาด mm · เลือก mockup แบบ B (หลายขนาดได้ เพิ่มแถว)
 */
export interface HoleSpec {
  count: number;
  mm: number;
}

/** เพดานของช่องเจาะรู — กันค่าหลุดจากหน้าจอ ไม่ใช่ข้อจำกัดการผลิต */
export const HOLE_LIMITS = { rows: 8, count: 99, mm: 1000 } as const;

/** ค่าที่กรอกในช่อง — ตัวเดียวกันทั้งตอนอ่านรหัสออกมาและตอนประกอบรหัสกลับ */
export interface BhForm {
  family: BhFamily;
  shape?: string;
  id?: number;
  h?: number;
  w?: number;
  l?: number;
  d1?: number;
  d2?: number;
  /**
   * ขนาดที่อ่านได้แต่ **ไม่ตรงรูปแบบของรูปทรง** (เช่น `BH-02C 100x100x80` — วงกลมมีแค่ D1)
   * เก็บข้อความดิบไว้ให้ประกอบรหัสกลับได้เหมือนเดิม — ไม่ใช่ขนาดที่เอาไปคิดราคา
   */
  sizeText?: string;
  volt?: string;
  watt?: number;
  /** ข้อความท่อนกำลังไฟตามที่พิมพ์มา เมื่อไม่ใช่ `<ตัวเลข>W` ธรรมดา (เช่น `600Wx2`) */
  wattText?: string;
  conn?: string;
  term?: string;
  /** ขนาดเต๋าเซรามิก — **ไม่อยู่ในรหัส** ชีตมีสองราคา (เจ้าของสั่ง 2026-09-28 "ต้องเลือกได้ทั้ง 2 แบบ") */
  amp?: string;
  /** สิ่งที่ต้องบวกเพิ่มที่ติ๊กไว้ (`CatalogFamilySpec.addons[].code`) — **ไม่อยู่ในรหัส** เหมือนขนาดเต๋า */
  addons?: string[];
  /** รูที่เจาะ (ไม่อยู่ในรหัส เหมือนขนาดเต๋า) */
  holes?: HoleSpec[];
  mat?: string;
  /**
   * ท่อนที่อยู่นอกแคตตาล็อก (`S000` · `(HPT)` · `50CM` · `2P`) ตามตำแหน่งที่มันอยู่ในรหัส
   * `after` = ท่อนของแคตตาล็อกที่มันต่อท้าย ⇒ ประกอบกลับได้ที่เดิม · `text` เก็บแบบที่พิมพ์มา
   * · `glue` = ติดกับท่อนก่อนหน้าโดยไม่มีขีดคั่น (`T(HPT)` · `240W+1.5M` · `216x200+160`)
   */
  extras?: { text: string; after: string; glue?: boolean }[];
}

// ── ตัวเลือกของแต่ละท่อน (ตรงกับตาราง "การสั่งซื้อ" ในแคตตาล็อกทีละตัว) ──────────────

const VOLT: CatalogSlot = { label: 'แรงดัน (V)', kind: 'text', suggest: ['110', '220', '380'], hint: 'แคตตาล็อก 110 / 220 / 380 · ค่าอื่นพิมพ์เองได้' };
const WATT: CatalogSlot = { label: 'กำลังไฟฟ้า (W)', kind: 'number', unit: 'W' };

/** การออกขั้วไฟของ BH-01 / BH-01C / BH-02 — สามแคตตาล็อกเขียนรายการเดียวกันทุกตัว */
const TERM_STRIP: CatalogOption[] = [
  { code: '', label: 'สายยาว 30 cm' },
  { code: '1', label: 'สายยาว 1 M' },
  { code: '2', label: 'สายยาว 2 M' },
  { code: '3', label: 'สายยาว 3 M' },
  { code: 'N', label: 'น็อต' },
  { code: 'PL2', label: 'ปลั๊ก PL-2' },
  { code: 'PL5', label: 'ปลั๊ก PL-5' },
  { code: 'T', label: 'เต๋าเซรามิก' },
];
/**
 * BH-03 — แคตตาล็อกมี None/T/PL2/PL5 · `1` `2` `3` (สายยาว 1/2/3 M) **ไม่อยู่ในตารางการสั่งซื้อ** แต่ขายจริง 13 รหัส
 * (`BH-03 150x40-220-1000W-1(HPT)` = "สาย 1 M.+หุ้มปลอกถักสแตนเลส") ⇒ เจ้าของสั่งเปิดให้ 2026-09-28
 * · BH-03 ไม่มีค่าสายเกิน (เจ้าของ 2026-09-25/28) ความยาวสายมีผลแค่กับของบวกเพิ่มที่คิดตามเมตร
 */
const TERM_BH03: CatalogOption[] = [
  { code: '', label: 'ออกน็อต + ฝาครอบ' },
  { code: '1', label: 'สายยาว 1 M' },
  { code: '2', label: 'สายยาว 2 M' },
  { code: '3', label: 'สายยาว 3 M' },
  { code: 'T', label: 'ออกเต๋าเซรามิก' },
  { code: 'PL2', label: 'ออกปลั๊ก PL-2 (Aluminium Body)' },
  { code: 'PL5', label: 'ออกปลั๊ก PL-5 (Stainless Body)' },
];
const MAT: CatalogOption[] = [
  { code: '', label: 'SUS304' },
  { code: 'Z', label: 'Zinc' },
];
/** การต่อใช้งานของ BH-01C — แคตตาล็อกมีแค่ SE/PL แต่รหัสจริงที่ไม่ระบุมีอยู่ (`BH-01C-635x200-380-10000W-T`) */
const CONN: CatalogOption[] = [
  { code: '', label: 'ไม่ระบุ' },
  { code: 'SE', label: 'อนุกรม' },
  { code: 'PL', label: 'ขนาน' },
];
/** ขนาดเต๋า — ไม่อยู่ในรหัส ⇒ ค่าว่าง = ยังไม่เลือก (ไม่ใช่ค่าตั้งต้น) */
export const AMP: CatalogOption[] = [
  { code: '10A', label: '10A' },
  { code: '30A', label: '30A' },
];

/**
 * "สิ่งที่ต้องบวกเพิ่ม" ของชีต BH แถว 16–18 (เมตรละ) — แคตตาล็อกและรหัสไม่มีท่อนนี้ (รหัสจริงเขียนไว้ในคำอธิบายสินค้า)
 * เจ้าของตอบ 2026-09-28: เป็นตัวเลือกคิดเพิ่ม **ติ๊กได้พร้อมกัน** · คูณตามความยาว **เฉพาะส่วนที่เกินสายมาตรฐาน 30 cm
 * ปัดขึ้นเป็นเมตรเต็ม** · เลือกได้ทุกการออกขั้วไฟ (ขั้วไฟที่ไม่มีสาย = ไม่เกินมาตรฐาน = 0 บาท)
 */
export const ADDONS: CatalogOption[] = [
  { code: 'cable:silicone', label: 'สาย Silicone' },
  { code: 'cable:ss_braid', label: 'สายถักสแตนเลส' },
  { code: 'flex_tube', label: 'ท่อเฟ็กส์' },
];

const AMP_SLOT: CatalogSlot = { label: 'ขนาดเต๋า', kind: 'choice', options: AMP, offCode: true, hint: 'ไม่อยู่ในรหัส — ชีตมีสองราคา' };

const SHAPES: CatalogShape[] = [
  { code: '', label: 'สี่เหลี่ยม', dims: ['w', 'l'] },
  { code: 'C', label: 'วงกลม', dims: ['d1'] },
  { code: 'D', label: 'โดนัท', dims: ['d1', 'd2'] },
  { code: 'S', label: 'Special Shape', dims: ['w', 'l'] },
];

/**
 * รูปทรง → ค่าของแกน `shape` ในสมุดราคา — **สูตรพื้นที่อยู่ที่สมุดราคา** (`derivedDims[].when`) ไม่ใช่ที่นี่
 * ⇒ แอดมินแก้ค่าคงที่ของสูตรได้โดยไม่ต้องแตะโค้ด (เจ้าของสั่ง 2026-09-28)
 */
export const SHAPE_AXIS: Record<string, string> = { '': 'สี่เหลี่ยม', C: 'วงกลม', D: 'โดนัท', S: 'Special' };

const SIZE_SLOTS: Record<SizeKey, CatalogSlot> = {
  id: { label: 'ID', kind: 'number', unit: 'mm' },
  h: { label: 'ความสูง H', kind: 'number', unit: 'mm' },
  w: { label: 'กว้าง W', kind: 'number', unit: 'mm' },
  l: { label: 'ยาว L', kind: 'number', unit: 'mm' },
  d1: { label: 'D1', kind: 'number', unit: 'mm' },
  d2: { label: 'D2', kind: 'number', unit: 'mm' },
};

const ELECTRIC: CatalogLayoutItem[] = [{ sep: '-' }, { slot: 'volt' }, { sep: '-' }, { slot: 'watt' }, { sep: 'W' }];

export const BH_CATALOG: CatalogFamilySpec[] = [
  {
    family: 'BH-01', head: 'BH-01', name: 'Band Heater',
    layout: [{ slot: 'id' }, { sep: 'x' }, { slot: 'h' }, ...ELECTRIC, { sep: '-' }, { slot: 'term' }, { sep: '-' }, { slot: 'mat' }],
    slots: {
      id: { ...SIZE_SLOTS.id, hint: 'เล็กสุด 25 mm' },
      h: { ...SIZE_SLOTS.h, hint: 'เล็กสุด: สาย/เต๋าเล็ก 25 · ปลั๊ก 30 · น็อต 40 mm' },
      volt: VOLT, watt: WATT,
      term: { label: 'การออกขั้วไฟ', kind: 'choice', options: TERM_STRIP },
      amp: AMP_SLOT,
      mat: { label: 'วัสดุ', kind: 'choice', options: MAT },
    },
    addons: ADDONS,
    holes: true,
  },
  {
    family: 'BH-01C', head: 'BH-01C', name: '2 Piece Band Heater',
    layout: [{ slot: 'id' }, { sep: 'x' }, { slot: 'h' }, ...ELECTRIC, { sep: '-' }, { slot: 'conn' }, { sep: '-' }, { slot: 'term' }, { sep: '-' }, { slot: 'mat' }],
    slots: {
      id: { ...SIZE_SLOTS.id, hint: 'เล็กสุด 60 mm' },
      h: SIZE_SLOTS.h,
      volt: VOLT, watt: { ...WATT, label: 'กำลังไฟฟ้ารวม (W)' },
      conn: { label: 'การต่อใช้งาน', kind: 'choice', options: CONN },
      term: { label: 'การออกขั้วไฟ', kind: 'choice', options: TERM_STRIP },
      amp: AMP_SLOT,
      mat: { label: 'วัสดุ', kind: 'choice', options: MAT },
    },
    addons: ADDONS,
    holes: true,
  },
  {
    family: 'BH-02', head: 'BH-02', name: 'Strip Heater',
    layout: [{ slot: 'shape' }, { slot: 'size' }, ...ELECTRIC, { sep: '-' }, { slot: 'term' }, { sep: '-' }, { slot: 'mat' }],
    shapes: SHAPES,
    slots: {
      shape: { label: 'Shape', kind: 'choice', options: SHAPES.map((s) => ({ code: s.code, label: s.label })) },
      w: SIZE_SLOTS.w, l: SIZE_SLOTS.l, d1: SIZE_SLOTS.d1, d2: SIZE_SLOTS.d2,
      volt: VOLT, watt: WATT,
      term: { label: 'การออกขั้วไฟ', kind: 'choice', options: TERM_STRIP },
      amp: AMP_SLOT,
      mat: { label: 'วัสดุ', kind: 'choice', options: MAT },
    },
    addons: ADDONS,
    holes: true,
  },
  {
    family: 'BH-03', head: 'BH-03', name: 'Ceramic Band Heater',
    layout: [{ slot: 'id' }, { sep: 'x' }, { slot: 'h' }, ...ELECTRIC, { sep: '-' }, { slot: 'term' }],
    slots: {
      id: { ...SIZE_SLOTS.id, hint: 'เล็กสุด 65 mm' },
      h: SIZE_SLOTS.h,
      volt: VOLT, watt: WATT,
      term: { label: 'การออกขั้วไฟ', kind: 'choice', options: TERM_BH03 },
      amp: AMP_SLOT,
    },
    addons: ADDONS,
    holes: true,
  },
];

export const bhSpec = (f: string): CatalogFamilySpec | undefined => BH_CATALOG.find((s) => s.family === f);

/** ขนาดที่รูปทรงนี้ใช้ (BH-02) หรือ ID × H */
export function sizeKeys(form: Pick<BhForm, 'family' | 'shape'>): SizeKey[] {
  if (form.family !== 'BH-02') return ['id', 'h'];
  return (SHAPES.find((s) => s.code === (form.shape ?? '')) ?? SHAPES[0]!).dims;
}

const num = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? '' : String(n));

/**
 * ช่องที่กรอก → รหัสสินค้า — รูปแบบเดียวกับที่ใช้ใน Odoo:
 *   `BH-01 180x110-240-2540W-N` · `BH-01C-600x150-380-4950W-PL-PL2` · `BH-02C 210-220-1400W-N-Z` · `BH-03 170x110-220-2700W-T`
 * หัวรหัสของ BH-01C ตามด้วย **ขีด** ตัวอื่นเว้นวรรค (ตามแคตตาล็อกและรหัสจริง) · ท่อนที่เป็น None ไม่เขียนอะไรเลย
 * ⇒ ไม่มีช่องว่างที่พิมพ์ลงรหัส ยกเว้นหลังหัวรหัส · ท่อนนอกแคตตาล็อกกลับไปอยู่ตำแหน่งเดิม
 */
export function buildBhCode(form: BhForm): string {
  const spec = bhSpec(form.family);
  if (!spec) return '';
  const out: string[] = [];
  const extrasAfter = (slot: string) => {
    for (const e of form.extras ?? []) {
      if (e.after !== slot) continue;
      out.push(e.glue ? e.text : '-' + e.text);
    }
  };
  const head = form.family === 'BH-02' ? 'BH-02' + (form.shape ?? '') : spec.head;
  out.push(head, form.family === 'BH-01C' ? '-' : ' ');
  extrasAfter('head');
  const size = form.sizeText ?? sizeKeys(form).map((k) => num(form[k])).join('x');
  out.push(size);
  extrasAfter('size');
  out.push('-', form.volt ?? '');
  extrasAfter('volt');
  out.push('-', form.wattText ?? `${num(form.watt)}W`);
  extrasAfter('watt');
  for (const slot of ['conn', 'term', 'mat'] as const) {
    const v = form[slot];
    if (v) out.push('-', v);
    extrasAfter(slot);
  }
  return out.join('');
}

/**
 * รหัสสองตัวเป็นรหัสเดียวกันไหม **ตามที่คนอ่าน** — ไม่สนช่องว่าง ตัวพิมพ์ และขีด/ช่องว่างหลังหัวรหัส
 * (`BH-01-600x150` = `BH-01 600x150` — รหัสจริงเขียนทั้งสองแบบ ตัวอ่านรับทั้งคู่)
 */
export function sameBhCode(a: string, b: string): boolean {
  const canon = (s: string) => s.toUpperCase().replace(/\s+/g, '').replace(/^(BH-0\d[A-Z]?)-/, '$1');
  return canon(a) === canon(b);
}
