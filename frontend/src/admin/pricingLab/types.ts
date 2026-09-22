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

export type SubCodeEffect = 'none' | 'basePrice' | 'flat' | 'percent' | 'perUnit' | 'setAxis';

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
}

export interface ModelBrief {
  code: string;
  label: string;
  sheet?: string;
  aliases: string[];
}

export interface CodePart {
  text: string;
  reads: string;
  kind: 'model' | 'axis' | 'dim' | 'option' | 'noPrice' | 'unknown';
  guess?: boolean;
}

export interface ParsedCode {
  input: string;
  normalized: string;
  model?: string;
  parts: CodePart[];
  problems: string[];
  warnings: string[];
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
  violations: { type: string; message: string }[];
  bookVersion: string;
}

export interface CensusItem {
  token: string;
  where: 'paren' | 'tail';
  count: number;
  models: string[];
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

export interface Overview {
  book: { ok: boolean; message?: string; models?: number; version?: string };
  version: string | null;
  models: ModelBrief[];
  subCodes: SubCode[];
  fromPriceFile: SubCode[];
  census: { measuredAt: string; totalCodes: number; items: CensusItem[] } | null;
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
}

export interface ImportPreview {
  ok: boolean;
  issues: ImportIssue[];
  fingerprint: string;
  summary?: { changed: number; added: number; removed: number; same: number };
  models?: DiffModel[];
  untouched?: string[];
  rows?: DiffRow[];
  totalRows?: number;
}

/** คำไทยของ "ผลกับราคา" — ต้องตรงกับ VOCAB.EFFECT_TH ฝั่ง backend (ชีต .xlsx ใช้คำชุดเดียวกัน) */
export const EFFECT_TH: Record<SubCodeEffect, string> = {
  none: 'ไม่มีผลกับราคา',
  basePrice: 'ราคาตั้งต้นของตัวเอง',
  flat: 'บวกเงินคงที่',
  percent: 'บวกเปอร์เซ็นต์',
  perUnit: 'บวกตามส่วนที่เกิน',
  setAxis: 'ตั้งค่าให้ช่อง',
};

/** คำอธิบายสั้น ๆ ใต้ตัวเลือก — คนที่ไม่ได้อ่านสเปรดชีตมาก่อนต้องเลือกถูกจากบรรทัดนี้ */
export const EFFECT_HINT: Record<SubCodeEffect, string> = {
  none: 'อยู่ในราคาตั้งแล้ว หรือเป็นแค่รหัสกำกับ',
  basePrice: 'ตัวนี้เป็นตัวกำหนดราคาตั้งเอง ไม่ได้บวกจากของเดิม',
  flat: 'บวกจำนวนเงินเท่ากันทุกครั้ง',
  percent: 'บวกเป็นสัดส่วนของยอดก่อนหน้า',
  perUnit: 'คิดตามส่วนที่เกินมาตรฐาน เช่น ความยาว',
  setAxis: 'ไม่ได้บวกเงิน แต่ไปเปลี่ยนตัวเลือกที่ใช้เปิดตารางราคา',
};
