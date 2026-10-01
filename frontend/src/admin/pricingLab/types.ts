// ─────────────────────────────────────────────────────────────────────────────
//  รูปของสิ่งที่ API ของโมดูลส่งมา — สำเนาที่ **ตั้งใจให้เป็นสำเนา**
//
//  ฝั่ง backend นิยามไว้ที่ services/pricingLab/types.ts แต่ `frontend/` เป็น npm project
//  คนละตัวที่ไม่ได้ compile ไฟล์นอกโฟลเดอร์ตัวเอง ⇒ import ข้ามมาไม่ได้
//  ที่นี่จึงเก็บ **เฉพาะช่องที่หน้าจอใช้จริง** ไม่ใช่ทั้งรูป — สำเนาที่เล็กกว่าพังยากกว่า
//
//  ⚠️ ห้ามเติมช่องที่เป็นราคาทั้งเล่ม (`cells` · `adders` · `base`) ลงที่นี่เด็ดขาด
//     ไม่ใช่เพราะพิมพ์เพิ่มไม่ได้ แต่เพราะการมีช่องรออยู่คือคำเชิญให้ใครสักคนส่งมันมาจริง
//     หน้าแอดมินเป็นไฟล์สาธารณะ ของที่ส่งมาถึงเบราว์เซอร์ = ของที่โหลดได้โดยไม่ต้องล็อกอิน
// ─────────────────────────────────────────────────────────────────────────────

export type SubCodeEffect = 'none' | 'basePrice' | 'flat' | 'percent' | 'perUnit' | 'setAxis' | 'option';

export interface SubCode {
  id?: number;
  subCode: string;
  match: 'exact' | 'pattern';
  scope: string;
  reads: string;
  effect: SubCodeEffect;
  amount?: number;
  percent?: number;
  dim?: string;
  rate?: number;
  over?: number;
  step?: number;
  axis?: string;
  value?: string;
  disabled?: boolean;
  custom?: boolean;
  source?: string;
  by?: string;
  at?: string;
  note?: string;
  /** รุ่นที่แถวนี้มีผลจริง — `/overview` เติมให้ด้วย `scopeRank` ตัวเดียวกับตัวอ่านรหัส (หน้าจอห้ามเดาขอบเขตเอง) */
  models?: string[];
}

/**
 * แถวที่ "รู้ความหมายแล้วแต่ยังไม่มีราคา" — `flat` ที่ไม่มีจำนวนเงิน / `setAxis` ที่ยังไม่ได้บอกค่า
 * (กติกาเดียวกับ engine ฝั่ง backend · เจ้าของสั่ง 2026-09-25 ให้ใส่ค่าว่างไว้แล้วกำหนดทีหลังจากจอ)
 */
export const subCodePending = (s: SubCode): boolean =>
  (s.effect === 'flat' && s.amount === undefined) || (s.effect === 'setAxis' && !s.value);

export interface ModelBrief {
  /** รหัสรุ่นในฐาน — ตัวที่ส่งกลับไปตอนแก้/บันทึก */
  code: string;
  /** ชื่อที่ขึ้นจอ: รุ่นหลักรวมกับชื่ออื่นที่ต่างแค่เลขรุ่น (`BH-01` → `BH-01,02`) — ดู `displayName` ฝั่ง backend */
  name: string;
  label: string;
  sheet?: string;
  aliases: string[];
  /** ชื่ออื่นที่ไม่ได้รวมเข้า `name` — คอลัมน์ "ใช้ราคาเดียวกัน" */
  others: string[];
  /** จำนวนสินค้าในฐานที่หัวรหัสตกรุ่นนี้ · `null` = นับไม่สำเร็จ · ไม่มีช่องนี้ = หน้าคิดราคา (ไม่ได้นับ) */
  products?: number | null;
  /** กฎของรุ่นที่รหัสย่อยแบบ "เปิดกฎ" เลือกได้ — ชื่ออย่างเดียว ไม่มีราคา (`modelBriefs` ฝั่ง backend) */
  options?: { key: string; label: string }[];
  /** ค่าที่แต่ละแกนรับได้ (หัวแถว/หัวคอลัมน์ของตารางราคาตั้ง · ค่าของราคาแยกตามแกน) — ชื่ออย่างเดียว ไม่มีราคา
   *  ใช้เป็นตัวเลือกของรหัสย่อยแบบ "ตั้งค่าให้ช่อง" เช่นเกลียวมิล M8 → คอลัมน์เกลียวไหน */
  axes?: Record<string, string[]>;
}

/** `GET /api/admin/pricing/overview` — หน้าคิดราคาได้แค่นี้ ของงานแก้ราคาอยู่ที่ `Overview` */
export interface QuoteOverview {
  book: { ok: boolean; message?: string; models?: number; version?: string };
  version: string | null;
  models: ModelBrief[];
  edited: { at: string; by?: string; note?: string } | null;
  /** ลำดับท่อน + ตัวเลือกของแคตตาล็อก "การสั่งซื้อ" (ไม่มีราคา) — ดู `services/pricingLab/catalogBh.ts` */
  catalog?: CatalogFamilySpec[];
  /** ซีรีส์ TS — ดู `services/pricingLab/catalogTs.ts` (ไม่มีราคาเช่นกัน) */
  catalogTs?: TsFamilySpec[];
}

// ── แคตตาล็อก "การสั่งซื้อ" (สำเนาชนิดข้อมูลของ services/pricingLab/catalogBh.ts) ──────────────
export type BhFamily = 'BH-01' | 'BH-01C' | 'BH-02' | 'BH-03';
export type SizeKey = 'id' | 'h' | 'w' | 'l' | 'd1' | 'd2';
export interface CatalogOption { code: string; label: string }
export interface CatalogSlot {
  label: string;
  kind: 'number' | 'choice' | 'text';
  unit?: string;
  options?: CatalogOption[];
  suggest?: string[];
  hint?: string;
  /** ช่องนี้ไม่อยู่ในรหัส (ขนาดเต๋า 10A/30A) */
  offCode?: boolean;
}
export type CatalogLayoutItem = { slot: string } | { sep: string };
export interface CatalogFamilySpec {
  family: BhFamily;
  head: string;
  name: string;
  layout: CatalogLayoutItem[];
  slots: Record<string, CatalogSlot>;
  shapes?: { code: string; label: string; dims: SizeKey[] }[];
  /** สิ่งที่ต้องบวกเพิ่ม (ไม่อยู่ในรหัส) — `code` คือค่าที่ส่งกลับไปใน `BhForm.addons` */
  addons?: CatalogOption[];
  /** มีช่อง "เจาะรู" (ไม่อยู่ในรหัส) */
  holes?: boolean;
}
/** รูที่เจาะหนึ่งแถว — ช่องที่ยังว่างเป็น NaN ระหว่างพิมพ์ (เซิร์ฟเวอร์ทิ้งแถวที่ไม่ครบ) */
export interface HoleRow { count: number; mm: number }
export interface BhForm {
  family: BhFamily;
  shape?: string;
  id?: number; h?: number; w?: number; l?: number; d1?: number; d2?: number;
  sizeText?: string;
  volt?: string;
  watt?: number;
  wattText?: string;
  conn?: string;
  term?: string;
  amp?: string;
  /** สิ่งที่ต้องบวกเพิ่มที่ติ๊กไว้ — ไม่อยู่ในรหัส */
  addons?: string[];
  /** รูที่เจาะ — ไม่อยู่ในรหัส */
  holes?: HoleRow[];
  mat?: string;
  extras?: { text: string; after: string; glue?: boolean }[];
}

// ── แคตตาล็อก TS (สำเนาชนิดข้อมูลของ services/pricingLab/catalogTs.ts) ──────────────────────────
export type TsFamily = 'TS_-01' | 'TS_-01-0' | 'TS_-04' | 'TS_-06' | 'TS_-08' | 'TS_-10' | 'TS_-11' | 'TS_-12' | 'TS_-12R' | 'TS_-14' | 'TS_-18';
export interface TsSlot {
  label: string;
  kind: 'choice' | 'number';
  options?: CatalogOption[];
  /** ตัวเลือกที่ขึ้นกับช่อง "ชนิดหัววัด" (TS / N / P) */
  optionsByProbe?: Record<string, CatalogOption[]>;
  unit?: string;
  placeholder?: string;
  hint?: string;
  optional?: boolean;
}
export type TsLayoutItem = { slot: string } | { sep: string } | { fixed: string };
export interface TsFamilySpec {
  family: TsFamily;
  head: string;
  name: string;
  model: string;
  layout: TsLayoutItem[];
  slots: Record<string, TsSlot>;
  defaults: Record<string, string>;
  addons?: CatalogOption[];
}
export interface TsForm {
  family: TsFamily;
  /** ช่อง → รหัสในช่อง (`''` = None / ช่องตัวเลขว่าง) */
  values: Record<string, string>;
  addons?: string[];
  /** ท่อนต่อท้ายที่ไม่อยู่ในแคตตาล็อก (`S000`) */
  extras?: string[];
}

export interface CodePart {
  text: string;
  reads: string;
  /** `choose` = อ่านออกแต่ต้องให้คนเลือกเพิ่มก่อนรวมในราคา (ขนาดเต๋า T ของ BH) — ไม่ใช่ของที่ต้องไปตั้งในตารางรหัสย่อย */
  kind: 'model' | 'axis' | 'dim' | 'option' | 'noPrice' | 'unknown' | 'choose';
  guess?: boolean;
}

export interface ParsedCode {
  input: string;
  normalized: string;
  model?: string;
  parts: CodePart[];
  problems: string[];
  warnings: string[];
  /** ช่องตามแคตตาล็อก — มีเฉพาะรหัสที่เขียนตามรูปแบบของแคตตาล็อก (วันนี้ซีรีส์ BH) */
  form?: BhForm;
  /** ช่องตามแคตตาล็อกของซีรีส์ TS — มีเฉพาะรหัสที่ประกอบกลับจากช่องได้รหัสเดิม */
  tsForm?: TsForm;
}

export interface BreakdownLine {
  /** ชนิดของกฎ (base · flat · percent · perUnit) — ชื่อที่โปรแกรมใช้ ไม่ใช่คำที่ขึ้นจอ */
  step: string;
  /** คำที่คนอ่าน — ตัวนี้คือตัวที่ต้องขึ้นจอ */
  label: string;
  detail?: string;
  amount?: number;
  running?: number;
  source?: string;
}

export interface PriceOutcome {
  status: 'priced' | 'quoteOnRequest' | 'notManufacturable';
  model: string;
  unitPrice: number;
  breakdown: BreakdownLine[];
  /** `missing` = คิดไม่ได้เพราะรหัสไม่ได้บอกค่า (ไม่ใช่ไม่รับผลิต) — ดู `Violation` ฝั่ง backend */
  /** `noRate` = รหัสบอกค่าแล้วแต่กฎบวกเพิ่มยังไม่มีราคาของค่านั้น (ไม่ใช่ไม่รับผลิตเหมือนกัน) */
  /** `partial` = กฎข้อนั้นยังไม่รวมในราคา เพราะอ่านค่าในรหัสไม่ออก (ราคาเฉพาะส่วนที่คำนวณได้) */
  /** `askPrice` = มาจากค่านอกแคตตาล็อก (ขอราคา / ใช้ราคาที่แอดมินเพิ่ม) — จอโชว์ปุ่มไปใส่ราคาที่หน้าสมุดราคา */
  violations: { id: string; level: 'block' | 'quoteOnRequest' | 'warn'; message: string; missing?: boolean; noRate?: boolean; partial?: boolean; askPrice?: boolean }[];
  bookVersion: string;
  /** วิธีคิดทีละขั้น — ข้อความทุกบรรทัดเขียนมาจากเซิร์ฟเวอร์ในจุดเดียวกับที่คิดเงิน ดู `PriceTrace` ฝั่ง backend */
  trace?: PriceTrace;
}

export interface PriceTrace {
  inputs: { kind: 'axis' | 'dim' | 'option'; key: string; label: string; value: string; from: string }[];
  base: { ok: boolean; label: string; steps: string[]; amount?: number };
  rules: {
    id: string;
    label: string;
    status: 'applied' | 'skipped' | 'blocked' | 'waiting' | 'off';
    reason?: string;
    steps: string[];
    amount?: number;
    running?: number;
    source?: string;
  }[];
  checks: { message: string; hit: boolean; level: 'block' | 'quoteOnRequest' | 'warn'; condition: string; source?: string }[];
}

/** `GET /api/admin/pricebook/unread` — ท่อนที่ตัวอ่านรหัสยังอ่านไม่ออก นับสดจากรหัสสินค้าจริง (`subcodeView.ts`) */
export interface UnreadToken {
  text: string;
  /** มี = เพิ่มแถวรหัสย่อยด้วยคำนี้แล้วอ่านออก · ไม่มี = แก้ที่ตาราง/ตัวอ่าน */
  subCode?: string;
  count: number;
  example: string;
  reads: string;
}

/** ค่านอกแคตตาล็อกที่พบในรหัสจริง — ชิปของกล่อง "ต้องขอราคาจากฝ่ายผลิต" (`subcodeView.ts` · รวมค่าที่อยู่ในตารางแล้ว) */
export interface AskValue {
  model: string;
  axis: string;
  value: string;
  count: number;
  example: string;
}
export interface SheetUnread {
  sheet: string;
  codes: number;
  unread: number;
  tokens: UnreadToken[];
  /** เซิร์ฟเวอร์รุ่นก่อนไม่มีช่องนี้ */
  askPrice?: AskValue[];
}

export interface UnreadSummary {
  measuredAt: string;
  codes: number;
  unread: number;
  sheets: SheetUnread[];
}

/** เล่มเก่าที่เก็บไว้ให้ย้อนกลับ — ชื่อไฟล์คือสิ่งเดียวที่ส่งกลับไปตอนกดย้อน */
export interface BookBackup {
  name: string;
  at: string;
  models: number;
}

/**
 * การ์ด "สมุดราคาที่ระบบใช้อยู่" — ตอบว่าราคาที่ระบบคิดอยู่ตอนนี้มาจากไหน ใครอัป เมื่อไหร่
 * `cells` เป็น **จำนวนช่อง** ไม่ใช่ราคา · `fingerprint` ใช้กันสองคนอัปทับกัน
 */
export interface BookShelf {
  cells: number;
  sheets: number;
  edited: { at: string; by?: string; note?: string } | null;
  fingerprint: string;
  backups: BookBackup[];
  keep: number;
}

/** `GET /api/admin/pricebook/overview` — หน้าสมุดราคา */
export interface Overview {
  book: { ok: boolean; message?: string; models?: number; version?: string };
  version: string | null;
  models: ModelBrief[];
  subCodes: SubCode[];
  fromPriceFile: SubCode[];
  /** ชื่อไทยของแกน (`cable` → ชนิดสาย) — ชื่ออย่างเดียว */
  axisLabels: Record<string, string>;
  shelf: BookShelf | null;
}

/** ปัญหาที่ตัวอ่านไฟล์เจอ — `error` = บันทึกไม่ได้ · `warn` = ข้ามแล้วบันทึกต่อได้ */
export interface ImportIssue {
  sheet: string;
  row?: number;
  level: 'error' | 'warn';
  message: string;
}

/**
 * หนึ่งแถวของตาราง "ตรวจก่อนบันทึก"
 *
 * `was === null` = เพิ่งมีราคาครั้งแรก · `now === null` = **ไม่รับผลิตแล้ว**
 * ⚠️ `null` กับ `0` ห้ามแสดงเหมือนกัน — ราคา 0 คือ "ขายฟรี" ซึ่งไม่ใช่สิ่งที่ชีตตั้งใจจะบอก
 */
export interface DiffRow {
  model: string;
  what: string;
  kind: 'cell' | 'band' | 'adder' | 'rate';
  was: number | null;
  now: number | null;
}

export interface DiffModel {
  model: string;
  label: string;
  changed: number;
  added: number;
  removed: number;
  /** จำนวนแถวที่เปลี่ยนนอกช่องราคา (`ruleRows`) — เซิร์ฟเวอร์ก่อน 2026-09-28 ไม่ส่ง ⇒ อ่านด้วย `?? 0` */
  rules?: number;
}

/**
 * หนึ่งแถวของ "กฎที่เปลี่ยน" — ตัวเลขราคาเท่าเดิมแต่ **ราคาที่คิดออกมาเปลี่ยนได้**
 * (วิธีปัด · ค่ามาตรฐาน · ใช้กับรหัส …) · ค่าเป็นข้อความพร้อมแสดง ไม่มีส่วนต่างเป็นเงิน
 * รูปเดียวกับ `BookDiffRuleRow` ใน `services/pricingLab/bookUpdate.ts`
 */
export interface DiffRuleRow {
  model: string;
  what: string;
  was: string;
  now: string;
}

export interface ImportPreview {
  ok: boolean;
  issues: ImportIssue[];
  fingerprint: string;
  summary?: { changed: number; added: number; removed: number; same: number; rules?: number };
  models?: DiffModel[];
  untouched?: string[];
  rows?: DiffRow[];
  totalRows?: number;
  /** ตัดที่โควตาเดียวกับ `rows` แต่นับแยกกัน — ยอดจริงอยู่ที่ `totalRuleRows` */
  ruleRows?: DiffRuleRow[];
  totalRuleRows?: number;
}

/** คำไทยของ "ผลกับราคา" — ต้องตรงกับ VOCAB.EFFECT_TH ฝั่ง backend (ชีต .xlsx ใช้คำชุดเดียวกัน) */
export const EFFECT_TH: Record<SubCodeEffect, string> = {
  none: 'ไม่มีผลกับราคา',
  basePrice: 'ราคาตั้งต้นของตัวเอง',
  flat: 'บวกเงินคงที่',
  percent: 'บวกเปอร์เซ็นต์',
  perUnit: 'บวกตามส่วนที่เกิน',
  setAxis: 'ตั้งค่าให้ช่อง',
  option: 'เปิดกฎบวกเพิ่มของรุ่น',
};

/** คำอธิบายสั้น ๆ ใต้ตัวเลือก — คนที่ไม่ได้อ่านสเปรดชีตมาก่อนต้องเลือกถูกจากบรรทัดนี้ */
export const EFFECT_HINT: Record<SubCodeEffect, string> = {
  none: 'อยู่ในราคาตั้งแล้ว หรือเป็นแค่รหัสกำกับ',
  basePrice: 'ตัวนี้เป็นตัวกำหนดราคาตั้งเอง ไม่ได้บวกจากของเดิม',
  flat: 'บวกจำนวนเงินเท่ากันทุกครั้ง',
  percent: 'บวกเป็นสัดส่วนของยอดก่อนหน้า',
  perUnit: 'คิดตามส่วนที่เกินมาตรฐาน เช่น ความยาว',
  setAxis: 'ไม่ได้บวกเงิน แต่ไปเปลี่ยนตัวเลือกที่ใช้เปิดตารางราคา',
  option: 'ใช้ราคาของกฎที่รุ่นนี้มีอยู่แล้ว — แก้ราคาที่กฎ ไม่ใช่ที่รหัสย่อย',
};


/* ── หน้า "แก้ราคาทีละรุ่น" ─────────────────────────────────────────────────
   รูปร่างเดียวกับ `EditorView` ใน services/pricingLab/modelEditor.ts — ที่นั่นคือต้นฉบับ
   แก้ที่นี่ที่เดียวไม่พอ ต้องแก้ทั้งคู่ (ไม่มี codegen และไม่ควรมี เพราะโมดูลนี้ถอดออกได้) */

export type Predicate =
  | { always: true }
  | { axis: string; in: string[] }
  | { axis: string; notIn: string[] }
  | { option: string }
  | { dim: string; gt?: number; gte?: number; lt?: number; lte?: number }
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate };

export interface EditorBand {
  min: number;
  max: number | null;
  kind: 'flat' | 'rate';
  price: number | null;
  label: string;
}

export interface EditorAdder {
  id: string;
  label: string;
  order: number;
  kind: 'flat' | 'percent' | 'perUnit';
  kindTh: string;
  when: Predicate | null;
  whenTh: string;
  amount: number | null;
  percent: number | null;
  rate: number | null;
  dim: string | null;
  dimTh: string | null;
  over: number | null;
  /** ค่าที่ `over: null` หมายถึง (สเปกมาตรฐานของรุ่น) — อ่านอย่างเดียว ห้ามส่งกลับเป็น `over` */
  overStd: number | null;
  step: number | null;
  times: number | null;
  unit: string;
  /** วิธีปัดเศษของช่วง — อ่านอย่างเดียว (ไม่ใช่ perUnit = null) */
  round: 'ceil' | 'floor' | 'exact' | null;
  /** ค่าแกนที่ไม่มีอัตรา: true = ข้ามกฎ · false = "ยังไม่มีราคา" — อ่านอย่างเดียว */
  skipIfNoRate: boolean;
  byAxis: string | null;
  byAxisTh: string | null;
  /** `rate: null` = ค่าแกนนี้ไม่มีราคา (ต้องขอราคา) — ไม่ใช่ 0 */
  rates: { value: string; rate: number | null }[] | null;
  disabled: boolean;
  custom: boolean;
  note: string;
  source: string;
}

export interface EditorVariant {
  suffix: string;
  label: string;
  percent?: number;
  order?: number;
  adderPrices?: Record<string, number>;
  disabled?: boolean;
  confirmed?: boolean;
  source?: string;
  note?: string;
  custom?: boolean;
  covers: string[];
}

export interface EditorView {
  code: string;
  /** ชื่อที่ขึ้นจอ (`BH-01,02`) */
  name: string;
  /** หัวตารางแบบที่ชีตเขียน (`TS_-01`) */
  title: string;
  /** หน้าตาของชีตรอบตาราง (แสดงผลอย่างเดียว ไม่มีผลกับราคา) — คีย์ = ค่าแกนแถว/คอลัมน์ */
  layout: {
    rowNote: { label: string; values: Record<string, string> } | null;
    colNotes: Record<string, string>;
    highlightCols: string[];
  };
  /** ค่าเริ่มต้นที่ขึ้นกับอีกแกน (ชนิดสายตาม TYPE) — **มีผลกับราคา** · `options` = ค่าที่เลือกได้ */
  defaultsBy: { axis: string; axisTh: string; by: string; label: string; values: Record<string, string>; options: string[] }[];
  /** ค่ามาตรฐานเมื่อรหัสไม่ระบุ (`axisDefaults`) — มีผลกับราคา · หน้าจอแสดงอย่างเดียว */
  axisDefaults?: { axis: string; axisTh: string; value: string }[];
  label: string;
  sheet: string;
  aliases: string[];
  standardTh: string;
  base:
    | { kind: 'banded'; quantity: string; quantityTh: string; unit: string; bands: EditorBand[] }
    | {
        kind: 'matrix';
        note: string;
        axes: string[];
        axesTh: string[];
        rows: string[];
        /** ตารางสามแกน (TS-08 · TS-10) = "เกลียว | ชนิด" — หน้าชีตแตกเป็นหัวคอลัมน์สองชั้น */
        cols: string[];
        /** `cells[แถว][คอลัมน์]` · `null` = ช่องว่าง = ไม่รับผลิต · ตารางแกนเดียว = `null` */
        cells: (number | null)[][] | null;
      }
    | { kind: 'ref'; model: string };
  variant: EditorVariant | null;
  adders: EditorAdder[];
  constraints: { id: string; level: string; levelTh: string; message: string; whenTh: string; when: Predicate | null; disabled: boolean }[];
  derived: { name: string; label: string; argsTh: string; consts: string; formulaTh: string; whenTh: string }[];
  /** ค่ามาตรฐานที่รวมในราคาตั้งแล้ว */
  standard: { dim: string; dimTh: string; value: number }[];
  /**
   * ช่องที่เพิ่ม "ค่านอกแคตตาล็อก" ได้จากจอ (ต้องขอราคาจากฝ่ายผลิต) — `null`/ไม่มี = รุ่นนี้ไม่ได้ตั้ง
   * `place`: row = แถวของตาราง · col = คอลัมน์ · rate = ขนาดในกฎ `adder` · `off` = ค่านอกแคตตาล็อกที่อยู่ในตารางแล้ว
   */
  askPrice?: {
    head: string;
    slots: { slot: 'sensor' | 'thread' | 'd'; axis: string; axisTh: string; place: 'row' | 'col' | 'rate'; adder?: string }[];
    off: Record<string, string[]>;
  } | null;
  vocab: {
    options: { key: string; label: string }[];
    dims: { key: string; label: string }[];
    axes: { key: string; label: string }[];
    kinds: { key: string; label: string }[];
    /** คีย์ที่ซีรีส์เดียวกันใช้อยู่ — กล่องแก้กฎของ TS โชว์ชุดนี้ก่อน */
    series: { options: string[]; dims: string[] };
  };
}
