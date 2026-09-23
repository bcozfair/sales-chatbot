// ─────────────────────────────────────────────────────────────────────────────
//  แม่แบบ Excel ของสมุดราคา: สมุดราคา ⇄ ตารางที่คนแก้เองได้
//
//  เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md
//
//  **ไฟล์นี้ไม่รู้จัก .xlsx** — มันแปลงระหว่าง `PriceBook` กับ "ตารางเป็นแถว ๆ" เท่านั้น
//  ส่วนการห่อเป็นไฟล์ .xlsx จริงอยู่ที่ `xlsxlite.ts` (เขียน) และ `xlsx.ts` / เบราว์เซอร์ (อ่าน)
//  แยกกันเพราะ **ฝั่งเบราว์เซอร์กับฝั่ง Node อ่านไฟล์คนละวิธี** (DecompressionStream vs exceljs)
//  แต่ "เนื้อในตารางต้องเป็นชุดเดียวกันเป๊ะ" ไม่งั้นไฟล์ที่ดาวน์โหลดจากหน้าเว็บกับที่ออกจาก CLI
//  จะคนละแม่แบบ แล้วนำเข้ากลับข้ามฝั่งไม่ได้
//
//  ── กติกาสองข้อที่ทำให้ไฟล์ที่แอดมินแก้แล้วยัง "อ่านกลับได้" ──────────────────
//
//  1. **โครงสร้างต้องอ่านออกจากตัวชีตเอง ไม่ใช่จำจากตอนส่งออก** — ชื่อแกนอยู่ในหัวตาราง
//     (`D \ thread`) ชื่อปริมาณอยู่ในหัวคอลัมน์ (`ช่วงของ area_in2 ตั้งแต่`) เพราะไฟล์ที่ส่งกลับมา
//     อาจถูกบันทึกใหม่ ถูกก๊อปข้ามเครื่อง หรือถูกส่งต่อจากคนที่ไม่เคยเห็นไฟล์เดิม
//  2. **หาคอลัมน์จาก "ข้อความหัวตาราง" ไม่ใช่จากตำแหน่ง** — แอดมินสลับคอลัมน์/แทรกคอลัมน์
//     ในชีตตัวเองเป็นเรื่องปกติ และชีตราคาจริงที่รับมาก็ทำแบบนั้นทุกไฟล์
//
//  ชีตที่ไม่รู้จักจะถูก **ข้ามเงียบ ๆ** โดยตั้งใจ — แอดมินเพิ่มชีตคิดเลขของตัวเองได้ ไม่พัง
// ─────────────────────────────────────────────────────────────────────────────

import { matrixKey } from '../../services/pricingLab/engine.js';
import type {
  Adder,
  Band,
  Constraint,
  DerivedDim,
  Money,
  Predicate,
  PriceBook,
  PriceModel,
  RoundMode,
  SubCode,
  SubCodeEffect
} from '../../services/pricingLab/types.js';

export type CellValue = string | number | null;

export interface SheetColumn {
  label: string;
  /** ความกว้างคอลัมน์ (หน่วยเดียวกับ Excel) — ไม่ได้มีไว้สวย แต่ 20 คอลัมน์ที่กว้างเท่ากันอ่านไม่ออก */
  width?: number;
}

export interface SheetTable {
  name: string;
  /** บรรทัดบนสุด (A1) — คำอธิบายสำหรับคนที่เปิดชีตนี้ ตอนอ่านกลับจะถูกข้าม */
  title?: string;
  columns?: SheetColumn[];
  rows: CellValue[][];
  /** ชีตคำอธิบายล้วน (ไม่มีหัวตาราง) */
  text?: string[];
  /** ตรึงแถวหัวตารางไว้ตอนเลื่อน */
  freeze?: boolean;
}

/** ตารางดิบที่อ่านกลับมาจากไฟล์ — ยังไม่รู้ว่าคอลัมน์ไหนคืออะไร */
export interface RawSheet {
  name: string;
  rows: CellValue[][];
}

export interface ImportIssue {
  sheet: string;
  /** เลขแถวในไฟล์ (เริ่มที่ 1 เหมือนที่ Excel แสดง) — ไม่มี = ปัญหาระดับชีต */
  row?: number;
  level: 'error' | 'warn';
  message: string;
}

// ── คำศัพท์ที่ปรากฏในไฟล์ ────────────────────────────────────────────────────
//
// ทุกค่าที่แอดมินจะเห็นและพิมพ์เองเป็น **ภาษาไทย** ไม่ใช่ 'percent' / 'block'
// เพราะคนกรอกคือคนตั้งราคา ไม่ใช่โปรแกรมเมอร์ · ตารางนี้คือที่เดียวที่แปลสองทาง

const KIND_TH: Record<Adder['kind'], string> = {
  percent: 'เปอร์เซ็นต์',
  flat: 'เงินคงที่',
  perUnit: 'ตามส่วนที่เกิน'
};

const LEVEL_TH: Record<Constraint['level'], string> = {
  block: 'ไม่รับผลิต',
  quoteOnRequest: 'ต้องขอราคา',
  warn: 'เตือน'
};

const ROUND_TH: Record<RoundMode, string> = {
  ceil: 'ปัดขึ้น',
  floor: 'ปัดลง',
  exact: 'ไม่ปัด'
};

const FORMULA_TH: Record<DerivedDim['formula'], string> = {
  sum: 'บวกกัน',
  cylinderAreaIn2: 'พื้นที่ผิวทรงกระบอก'
};

/**
 * ผลของรหัสย่อยต่อราคา — คำที่แอดมินจะเห็นและพิมพ์เอง
 * ต้องอ่านแล้วรู้ว่า "เงินขยับยังไง" โดยไม่ต้องเปิดคู่มือ
 */
const EFFECT_TH: Record<SubCodeEffect, string> = {
  none: 'ไม่มีผลกับราคา',
  basePrice: 'ราคาตั้งต้นของตัวเอง',
  flat: 'บวกเงินคงที่',
  percent: 'บวกเปอร์เซ็นต์',
  perUnit: 'บวกตามส่วนที่เกิน',
  setAxis: 'ตั้งค่าให้ช่อง'
};

const MATCH_TH: Record<SubCode['match'], string> = {
  exact: 'ตรงตัว',
  pattern: 'แม่แบบ'
};

const ON = 'ใช้';
const OFF = 'ปิดไว้';
const SKIP_YES = 'ข้าม';
const SKIP_NO = 'ไม่รับทำ';
/** ค่าแกนที่เป็นสตริงว่าง — ต้องมีคำแทน ไม่งั้นช่องว่างในไฟล์แยกไม่ออกจาก "ไม่ได้กรอก" */
const BLANK_TOKEN = '(ว่าง)';

const SHEET = {
  readme: 'อ่านก่อนแก้',
  meta: 'สมุดราคา',
  models: 'รุ่น',
  adders: 'กฎบวกเพิ่ม',
  rates: 'อัตราตามแกน',
  constraints: 'เงื่อนไขและข้อห้าม',
  variants: 'ตัวเลือกท้ายรหัส',
  derived: 'ค่าที่คำนวณเอง',
  subCodes: 'รหัสย่อย',
  basePrefix: 'ฐาน-'
} as const;

function flip<T extends string>(m: Record<T, string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(m) as T[]) out[m[k]] = k;
  return out;
}
const KIND_FROM = flip(KIND_TH);
const LEVEL_FROM = flip(LEVEL_TH);
const ROUND_FROM = flip(ROUND_TH);
const FORMULA_FROM = flip(FORMULA_TH);
const EFFECT_FROM = flip(EFFECT_TH);
const MATCH_FROM = flip(MATCH_TH);

// ── เงื่อนไข: โครงสร้าง ⇄ ข้อความที่คนพิมพ์เองได้ ────────────────────────────
//
// ไวยากรณ์ตั้งใจให้เล็กและปิด (เหตุผลเดียวกับที่ `Predicate` ใน types.ts เป็น union ปิด):
//
//     ทุกกรณี
//     ติ๊ก[conn:pl2]                 ← ลูกค้าสั่งตัวเลือกนี้
//     แกน[D]=6|6A|6S                 ← ค่าแกนเป็นหนึ่งใน…  (คั่นด้วย | ไม่ใช่ลูกน้ำ
//     แกน[D]≠6|8                        เพราะค่าจริงมีลูกน้ำอยู่ข้างใน: '3/4" , 1/2"')
//     ขนาด[L1]>100                   ← ตัวเลข: > >= < <=
//     และ(A , B)   หรือ(A , B)   ไม่(A)
//
// ค่าแกนบางตัวมีวงเล็บอยู่ข้างใน ('PT100 Class B (TSP)') ⇒ ตัวตัดคำต้องนับความลึกวงเล็บ
// ไม่ใช่ตัดที่ลูกน้ำตัวแรกที่เจอ

export function predicateToText(p: Predicate): string {
  if ('always' in p) return 'ทุกกรณี';
  if ('all' in p) return `และ(${p.all.map(predicateToText).join(' , ')})`;
  if ('any' in p) return `หรือ(${p.any.map(predicateToText).join(' , ')})`;
  if ('not' in p) return `ไม่(${predicateToText(p.not)})`;
  if ('option' in p) return `ติ๊ก[${p.option}]`;
  if ('in' in p) return `แกน[${p.axis}]=${p.in.map((v) => v || BLANK_TOKEN).join('|')}`;
  if ('notIn' in p) return `แกน[${p.axis}]≠${p.notIn.map((v) => v || BLANK_TOKEN).join('|')}`;

  const parts: string[] = [];
  if (p.gt !== undefined) parts.push(`ขนาด[${p.dim}]>${p.gt}`);
  if (p.gte !== undefined) parts.push(`ขนาด[${p.dim}]>=${p.gte}`);
  if (p.lt !== undefined) parts.push(`ขนาด[${p.dim}]<${p.lt}`);
  if (p.lte !== undefined) parts.push(`ขนาด[${p.dim}]<=${p.lte}`);
  if (parts.length === 0) return `ขนาด[${p.dim}]`;
  return parts.length === 1 ? parts[0]! : `และ(${parts.join(' , ')})`;
}

/** ตัดข้อความที่ลูกน้ำระดับบนสุด — ข้ามลูกน้ำที่อยู่ในวงเล็บ/วงเล็บเหลี่ยม */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
    } else buf += ch;
  }
  out.push(buf);
  return out.map((x) => x.trim()).filter((x) => x !== '');
}

/** ถ้า s ขึ้นต้นด้วย `<head>(` และวงเล็บปิดที่ตัวท้ายพอดี คืนข้างใน */
function unwrap(s: string, head: string): string | undefined {
  if (!s.startsWith(head + '(') || !s.endsWith(')')) return undefined;
  const inner = s.slice(head.length + 1, -1);
  let depth = 0;
  for (const ch of inner) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth < 0) return undefined; // วงเล็บปิดก่อนจบ ⇒ ไม่ใช่ก้อนเดียวกัน
  }
  return depth === 0 ? inner : undefined;
}

export type ParseResult = { ok: true; value: Predicate } | { ok: false; reason: string };

export function parsePredicate(raw: string): ParseResult {
  const s = String(raw ?? '').trim();
  if (s === '' || s === 'ทุกกรณี') return { ok: true, value: { always: true } };

  for (const [head, key] of [
    ['และ', 'all'],
    ['หรือ', 'any']
  ] as const) {
    const inner = unwrap(s, head);
    if (inner !== undefined) {
      const parts = splitTop(inner);
      if (parts.length === 0) return { ok: false, reason: `${head}( ) ว่างเปล่า` };
      const kids: Predicate[] = [];
      for (const part of parts) {
        const r = parsePredicate(part);
        if (!r.ok) return r;
        kids.push(r.value);
      }
      return { ok: true, value: key === 'all' ? { all: kids } : { any: kids } };
    }
  }

  const notInner = unwrap(s, 'ไม่');
  if (notInner !== undefined) {
    const r = parsePredicate(notInner);
    return r.ok ? { ok: true, value: { not: r.value } } : r;
  }

  const opt = /^ติ๊ก\[(.+)\]$/.exec(s);
  if (opt) return { ok: true, value: { option: opt[1]!.trim() } };

  const ax = /^แกน\[([^\]]+)\]\s*(≠|!=|=)\s*([\s\S]*)$/.exec(s);
  if (ax) {
    const axis = ax[1]!.trim();
    const values = ax[3]!
      .split('|')
      .map((v) => v.trim())
      .map((v) => (v === BLANK_TOKEN ? '' : v));
    if (values.length === 0) return { ok: false, reason: `แกน[${axis}] ไม่ได้ระบุค่า` };
    return ax[2] === '=' ? { ok: true, value: { axis, in: values } } : { ok: true, value: { axis, notIn: values } };
  }

  const dm = /^ขนาด\[([^\]]+)\]\s*(>=|<=|≥|≤|>|<)\s*(-?[\d.,]+)$/.exec(s);
  if (dm) {
    const dim = dm[1]!.trim();
    const n = toNumber(dm[3]!);
    if (n === undefined) return { ok: false, reason: `ขนาด[${dim}] ต้องตามด้วยตัวเลข` };
    const op = dm[2]!;
    if (op === '>') return { ok: true, value: { dim, gt: n } };
    if (op === '<') return { ok: true, value: { dim, lt: n } };
    if (op === '>=' || op === '≥') return { ok: true, value: { dim, gte: n } };
    return { ok: true, value: { dim, lte: n } };
  }

  return {
    ok: false,
    reason:
      `อ่านเงื่อนไข "${s}" ไม่ออก — ใช้ได้แค่: ทุกกรณี · ติ๊ก[ชื่อตัวเลือก] · ` +
      `แกน[ชื่อแกน]=ค่า1|ค่า2 · แกน[ชื่อแกน]≠ค่า · ขนาด[ชื่อขนาด]>ตัวเลข · และ( ) · หรือ( ) · ไม่( )`
  };
}

// ── ตัวช่วยอ่านค่าจากเซลล์ ───────────────────────────────────────────────────
//
// เซลล์ที่คนแก้เองกลับมาเป็นอะไรก็ได้ — "1,200" ที่มีลูกน้ำ · " 700 " ที่มีช่องว่าง ·
// ตัวเลขที่กลายเป็นข้อความเพราะถูกวางมาจากที่อื่น ⇒ แปลงให้หมดตรงนี้ที่เดียว

export function toNumber(v: CellValue): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const cleaned = String(v).replace(/[,\s฿]/g, '');
  if (cleaned === '') return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function toText(v: CellValue): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** `L1=100; cable_m=1` ⇄ { L1: 100, cable_m: 1 } */
function pairsToText(m: Record<string, number> | undefined): string {
  if (!m) return '';
  return Object.entries(m)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/** เหมือน pairsToText แต่ค่าเป็นข้อความ (ชื่อตัวเลือกของแกน เช่น ชนิดสาย) */
function strPairsToText(m: Record<string, string> | undefined): string {
  if (!m) return String();
  return Object.entries(m)
    .map(([k, v]) => k + String.fromCharCode(61) + v)
    .join('; ');
}

function textToStrPairs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k !== '' && v !== '') out[k] = v;
  }
  return out;
}

function textToPairs(s: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of s.split(';')) {
    const [k, v] = part.split('=');
    if (!k || v === undefined) continue;
    const n = toNumber(v);
    if (k.trim() !== '' && n !== undefined) out[k.trim()] = n;
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
//  สมุดราคา → ตาราง
// ═════════════════════════════════════════════════════════════════════════════

const README_LINES = [
  'แม่แบบสมุดราคา — แก้ไฟล์นี้แล้วนำกลับเข้าระบบได้',
  '',
  'ไฟล์นี้คือ "กฎการคิดราคา" ทั้งหมดที่ระบบใช้ ไม่ใช่รายงาน — แก้ตัวเลขในนี้',
  'แล้วนำเข้ากลับ ราคาที่ระบบคิดจะเปลี่ยนตามทันที โดยไม่ต้องให้ใครไปแก้โปรแกรม',
  '',
  '── ชีตในไฟล์นี้ ──────────────────────────────────────────────',
  `${SHEET.meta}            ชื่อและวันที่ของสมุดราคา + ช่องให้เขียนว่าแก้อะไรไป`,
  `${SHEET.models}                  รายชื่อรุ่น และ "สเปกที่รวมอยู่ในราคาตั้งแล้ว"`,
  `${SHEET.basePrefix}<รหัสรุ่น>       ราคาตั้งของรุ่นนั้น (หนึ่งรุ่นหนึ่งชีต)`,
  `${SHEET.adders}           กฎบวกเพิ่ม — เปอร์เซ็นต์ · เงินคงที่ · ตามส่วนที่เกิน`,
  `${SHEET.rates}           อัตราที่ต่างกันตามขนาดแกน (กฎเดียวแต่คนละราคาตามแกน)`,
  `${SHEET.constraints}    ข้อห้าม/ข้อควรระวัง — ไม่รับผลิต · ต้องขอราคา · เตือน`,
  `${SHEET.variants}        ตัวอักษรท้ายเลขรุ่นที่คิดเพิ่มจากรุ่นหลัก (ซีรีส์ BH = ตัว C)`,
  `${SHEET.derived}       ค่าที่ระบบคิดให้เอง เช่น พื้นที่ผิว`,
  `${SHEET.subCodes}                ความหมายของตัวอักษรในรหัสสินค้า และผลกับราคา`,
  '',
  '── กติกา 5 ข้อ ตอนแก้ ────────────────────────────────────────',
  '1. ห้ามเปลี่ยนข้อความในแถวหัวตาราง — ระบบหาคอลัมน์จากข้อความนั้น',
  '   (สลับตำแหน่งคอลัมน์ได้ · แทรกคอลัมน์ของตัวเองได้ · แค่อย่าแก้ชื่อหัว)',
  '2. เพิ่มแถวใหม่ได้เลย ลบแถวได้เลย — แต่ "รหัสรุ่น" ต้องตรงกับชีต รุ่น',
  '3. ช่องราคาที่เว้นว่าง = ไม่รับผลิตขนาดนั้น ไม่ใช่ราคา 0',
  '   ถ้าตั้งใจให้ฟรีจริง ๆ ให้ใส่เลข 0',
  '4. กฎที่ยังไม่อยากให้มีผล ให้ใส่ ' + OFF + ' ที่คอลัมน์ "เปิดใช้" แทนการลบแถว',
  '   ลบแล้วจะตามไม่ได้ว่าเมื่อก่อนคิดยังไง',
  '5. เพิ่มชีตของตัวเองได้ ระบบจะข้ามชีตที่ไม่รู้จัก ไม่พัง',
  '',
  '── เขียนเงื่อนไขยังไง ───────────────────────────────────────',
  'ช่อง "เงื่อนไข" คือคำตอบของ "กฎนี้จะมีผลเมื่อไหร่" เว้นว่าง = ทุกกรณี',
  '',
  '   ทุกกรณี                    มีผลเสมอ',
  '   ติ๊ก[conn:pl2]             เมื่อลูกค้าสั่งตัวเลือกนั้น',
  '   แกน[D]=6|6A|6S             เมื่อค่าแกนเป็นค่าใดค่าหนึ่ง (คั่นด้วย | )',
  '   แกน[D]≠6|8                 เมื่อค่าแกนไม่ใช่ค่าเหล่านี้',
  '   ขนาด[L1]>100               เทียบตัวเลข ใช้ได้ทั้ง > >= < <=',
  '   และ(ก , ข)                 ต้องจริงทั้งคู่',
  '   หรือ(ก , ข)                จริงข้อใดข้อหนึ่ง',
  '   ไม่(ก)                     กลับเงื่อนไข',
  '',
  'ตัวอย่างจริงจากไฟล์นี้: และ(ติ๊ก[element:2] , แกน[sensor]=Type K/J)',
  '',
  '── ลำดับมีผลกับเงิน ─────────────────────────────────────────',
  'กฎถูกคิดเรียงตามเลขใน "ลำดับ" จากน้อยไปมาก และเปอร์เซ็นต์คิดจาก',
  '"ยอดสะสม ณ ตอนนั้น" ⇒ สลับลำดับแล้วยอดเปลี่ยน',
  '',
  '   10,975 → +20% = 13,170 → +320 = 13,490   (ลำดับที่ชีตราคาใช้จริง)',
  '   10,975 → +320 → +20%  = 13,554           (สลับลำดับ ผิดไป 64 บาท)',
  '',
  'เว้นเลขลำดับห่าง ๆ (10, 20, 30) จะได้แทรกกฎใหม่ตรงกลางได้โดยไม่ต้องแก้ทั้งชีต',
  '',
  `── ชีต ${SHEET.subCodes} ─────────────────────────────────────────────`,
  'รหัสสินค้าหนึ่งตัวประกอบด้วยหลายท่อน เช่น BH-01 230x32-240-650W-N-S000',
  'ตัวเลข (ขนาด · กำลังไฟ · ความยาว) ระบบอ่านจากตารางราคาได้เองอยู่แล้ว',
  'แต่ "ตัวอักษร" อย่าง N หรือ S000 ไม่มีที่ไหนในไฟล์ราคาบอกว่าแปลว่าอะไร',
  'ชีตนี้คือที่ที่คุณบอกระบบเอง — หนึ่งแถวต่อหนึ่งรหัสย่อย',
  '',
  '   ใช้กับรุ่น      TS-14        เฉพาะรุ่นนี้',
  '                  TS-18*       ทั้งตระกูล (ขึ้นต้นด้วย TS-18)',
  '                  *            ทุกรุ่น   ← รุ่นที่เขียนเจาะจงไว้ ชนะเสมอ',
  '   แบบจับคู่       ตรงตัว       ต้องพิมพ์มาเหมือนกันเป๊ะ',
  '                  แม่แบบ       # แทนตัวเลขหนึ่งหลัก (S### จับได้ทั้ง S000 S001 S002)',
  `   ผลกับราคา      ${Object.values(EFFECT_TH).join(' · ')}`,
  '',
  'รหัสย่อยที่ยังไม่มีแถวในชีตนี้ ระบบจะขึ้นเตือนว่า "ยังไม่ได้ตั้งค่า" และไม่เดาให้',
  'เพราะราคาที่ตกของไปหนึ่งท่อน หน้าตาเหมือนราคาที่ถูกต้องทุกประการ'
];

function metaSheet(book: PriceBook, exportedAt: string): SheetTable {
  return {
    name: SHEET.meta,
    title: 'ข้อมูลของสมุดราคาเล่มนี้ — ช่องค่าแก้ได้',
    columns: [
      { label: 'หัวข้อ', width: 26 },
      { label: 'ค่า', width: 78 }
    ],
    rows: [
      ['เวอร์ชัน', book.version],
      ['ไฟล์ต้นทาง', book.source],
      ['ส่งออกเมื่อ', exportedAt],
      ['คนแก้', book.edited?.by ?? ''],
      ['แก้อะไรไป', book.edited?.note ?? '']
    ]
  };
}

function modelsSheet(book: PriceBook): SheetTable {
  const rows: CellValue[][] = [];
  for (const m of Object.values(book.models)) {
    rows.push([
      m.code,
      m.label,
      m.sheet ?? '',
      (m.aliases ?? []).join(', '),
      pairsToText(m.standard),
      strPairsToText(m.axisDefaults),
      m.base.kind === 'matrix' ? 'ตาราง' : m.base.kind === 'banded' ? 'ช่วง' : `ใช้ฐานของ ${m.base.model}`
    ]);
  }
  return {
    name: SHEET.models,
    title: 'รุ่นที่อยู่ในสมุดราคาเล่มนี้ · ราคาตั้งของแต่ละรุ่นอยู่ในชีต ' + SHEET.basePrefix + '<รหัสรุ่น>',
    columns: [
      { label: 'รหัสรุ่น', width: 12 },
      { label: 'ชื่อรุ่น', width: 36 },
      { label: 'ชีตต้นทาง', width: 12 },
      { label: 'รหัสอื่นที่ใช้ตารางเดียวกัน', width: 24 },
      { label: 'สเปกที่รวมในราคาตั้งแล้ว', width: 30 },
      { label: 'ตัวเลือกที่ใช้เมื่อไม่ได้ระบุ', width: 28 },
      { label: 'แบบของราคาตั้ง', width: 18 }
    ],
    rows,
    freeze: true
  };
}

/** หนึ่งรุ่นหนึ่งชีต — วางเป็นตารางสองแกนเหมือนในไฟล์ราคาต้นฉบับ ไม่ใช่รายการยาว ๆ */
function baseSheet(m: PriceModel): SheetTable {
  const name = SHEET.basePrefix + m.code;

  if (m.base.kind === 'ref') {
    return {
      name,
      title: `${m.code} ไม่มีตารางราคาของตัวเอง — ใช้ของรุ่นอื่นแล้วค่อยบวกเพิ่มด้วยกฎในชีต ${SHEET.adders}`,
      columns: [{ label: 'ใช้ฐานราคาของรุ่น', width: 24 }],
      rows: [[m.base.model]]
    };
  }

  if (m.base.kind === 'banded') {
    return {
      name,
      title: `ราคาตั้ง ${m.code} — คิดตามช่วงของ ${m.base.quantity} · ใส่ได้ช่องเดียวต่อแถว: ราคาเหมา หรือ ราคาต่อหน่วย`,
      columns: [
        { label: `ช่วงของ ${m.base.quantity} ตั้งแต่`, width: 22 },
        { label: 'ถึง', width: 12 },
        { label: 'ราคาเหมา', width: 12 },
        { label: 'ราคาต่อหน่วย', width: 14 },
        { label: 'ชื่อช่วงในไฟล์เดิม', width: 20 }
      ],
      rows: m.base.bands.map((b) => [
        b.min,
        b.max === null ? '' : b.max,
        b.flat ?? '',
        b.rate ?? '',
        b.label ?? ''
      ]),
      freeze: true
    };
  }

  // matrix — แกนแรกเป็นแถว **แกนที่เหลือทั้งหมดเป็นคอลัมน์** (ถ้ามีแกนเดียวก็เหลือคอลัมน์ราคาเดียว)
  //
  // รุ่น RTD (TS-08 · TS-10) มีสามแกน: ขนาดแกน × ขนาดเกลียว × ชนิดหัววัด ⇒ หัวคอลัมน์เป็น
  // ค่าของสองแกนต่อกันด้วย ` | ` ซึ่งเป็น **ตัวคั่นเดียวกับ `matrixKey`** จึงตัดกลับเป็นคีย์เดิมได้
  // โดยไม่ต้องจำอะไรจากตอนส่งออก · ช่องซ้ายบนบอกชื่อแกนครบทุกแกน คั่นด้วย backslash
  const rowAxis = m.base.axes[0];
  const colAxes = m.base.axes.slice(1);
  const rowValues: string[] = [];
  const colValues: string[] = [];
  for (const key of Object.keys(m.base.cells)) {
    const parts = key.split(' | ');
    if (!rowValues.includes(parts[0]!)) rowValues.push(parts[0]!);
    const c = parts.slice(1).join(' | ');
    if (colAxes.length > 0 && !colValues.includes(c)) colValues.push(c);
  }

  const header = [rowAxis, ...colAxes].join(' \\ ');
  const columns: SheetColumn[] = [{ label: header, width: 16 }];
  if (colAxes.length > 0) for (const c of colValues) columns.push({ label: c || BLANK_TOKEN, width: 11 });
  else columns.push({ label: 'ราคา', width: 12 });

  const rows: CellValue[][] = rowValues.map((rv) => {
    const line: CellValue[] = [rv];
    if (colAxes.length > 0) {
      for (const cv of colValues) {
        const cell = m.base.kind === 'matrix' ? m.base.cells[`${rv} | ${cv}`] : undefined;
        line.push(cell === undefined ? '' : cell);
      }
    } else {
      const cell = m.base.kind === 'matrix' ? m.base.cells[matrixKey(m.base.axes, { [rowAxis!]: rv })] : undefined;
      line.push(cell === undefined ? '' : cell);
    }
    return line;
  });

  return {
    name,
    title: `ราคาตั้ง ${m.code} (${m.label}) · ช่องว่าง = ไม่รับผลิตขนาดนั้น ไม่ใช่ราคา 0 · สเปกที่รวมในราคานี้แล้ว: ${pairsToText(m.standard) || '—'}`,
    columns,
    rows,
    freeze: true
  };
}

const ADDER_COLS: SheetColumn[] = [
  { label: 'รหัสรุ่น', width: 12 },
  { label: 'ลำดับ', width: 8 },
  { label: 'รหัสกฎ', width: 18 },
  { label: 'ชื่อที่แสดง', width: 32 },
  { label: 'วิธีคิด', width: 16 },
  { label: 'เงื่อนไข', width: 40 },
  { label: 'เปอร์เซ็นต์', width: 11 },
  { label: 'จำนวนเงิน', width: 11 },
  { label: 'อัตราต่อหน่วย', width: 13 },
  { label: 'อัตราตามแกน', width: 12 },
  { label: 'คิดจากขนาด', width: 13 },
  { label: 'เกินกว่า', width: 10 },
  { label: 'ทีละ', width: 8 },
  { label: 'ปัดเศษ', width: 10 },
  { label: 'คูณ', width: 7 },
  { label: 'หน่วย', width: 8 },
  { label: 'ถ้าไม่มีอัตรา', width: 12 },
  { label: 'เปิดใช้', width: 9 },
  { label: 'ที่มาในไฟล์ราคา', width: 34 },
  { label: 'หมายเหตุ', width: 30 }
];

function adderRow(code: string, a: Adder): CellValue[] {
  return [
    code,
    a.order,
    a.id,
    a.label,
    KIND_TH[a.kind],
    a.when ? predicateToText(a.when) : 'ทุกกรณี',
    a.percent ?? '',
    a.amount ?? '',
    a.rate ?? '',
    a.byAxis ?? '',
    a.dim ?? '',
    a.over ?? '',
    a.step ?? '',
    a.round ? ROUND_TH[a.round] : '',
    a.times ?? '',
    a.unit ?? '',
    a.byAxis ? (a.skipIfNoRate ? SKIP_YES : SKIP_NO) : '',
    a.disabled ? OFF : ON,
    a.source ?? '',
    a.note ?? ''
  ];
}

function addersSheet(book: PriceBook): SheetTable {
  const rows: CellValue[][] = [];
  for (const m of Object.values(book.models)) {
    for (const a of [...m.adders].sort((x, y) => x.order - y.order)) rows.push(adderRow(m.code, a));
  }
  return {
    name: SHEET.adders,
    title:
      'กฎบวกเพิ่มทั้งหมด · คิดเรียงตาม "ลำดับ" จากน้อยไปมาก และเปอร์เซ็นต์คิดจากยอดสะสม ณ ตอนนั้น ⇒ สลับลำดับแล้วยอดเปลี่ยน',
    columns: ADDER_COLS,
    rows,
    freeze: true
  };
}

const SUBCODE_COLS: SheetColumn[] = [
  { label: 'รหัสย่อย', width: 12 },
  { label: 'แบบจับคู่', width: 10 },
  { label: 'ใช้กับรุ่น', width: 12 },
  { label: 'อ่านว่า', width: 34 },
  { label: 'ผลกับราคา', width: 20 },
  { label: 'ลำดับ', width: 8 },
  { label: 'จำนวนเงิน', width: 11 },
  { label: 'เปอร์เซ็นต์', width: 11 },
  { label: 'คิดจากขนาด', width: 13 },
  { label: 'เกินกว่า', width: 10 },
  { label: 'ทีละ', width: 8 },
  { label: 'ปัดเศษ', width: 10 },
  { label: 'อัตราต่อหน่วย', width: 13 },
  { label: 'คูณ', width: 7 },
  { label: 'หน่วย', width: 8 },
  { label: 'ตั้งค่าช่อง', width: 12 },
  { label: 'เป็นค่า', width: 16 },
  { label: 'เปิดใช้', width: 9 },
  { label: 'ที่มาในไฟล์ราคา', width: 34 },
  { label: 'ใครตั้งค่า', width: 14 },
  { label: 'เมื่อไหร่', width: 12 },
  { label: 'หมายเหตุ', width: 30 }
];

/**
 * ชีตนี้คือของใหม่ทั้งหมดของรอบ "พิมพ์รหัสแล้วได้ราคา" — ที่เหลือในไฟล์เหมือนเดิมทุกชีต
 * วางไว้ให้แอดมินเติมเองได้ทีละแถว และ **ส่งออก/นำเข้าได้เหมือนกฎอื่น** เพราะการตั้งค่า
 * 30 ตัวรวดใน Excel เร็วกว่าจิ้มทีละตัวบนหน้าจอมาก
 */
function subCodesSheet(book: PriceBook): SheetTable {
  const rows: CellValue[][] = [];
  for (const sc of [...(book.subCodes ?? [])].sort(
    (x, y) => x.scope.localeCompare(y.scope) || x.subCode.localeCompare(y.subCode)
  )) {
    rows.push([
      sc.subCode,
      MATCH_TH[sc.match] ?? MATCH_TH.exact,
      sc.scope,
      sc.reads,
      EFFECT_TH[sc.effect],
      sc.order ?? '',
      sc.amount ?? '',
      sc.percent ?? '',
      sc.dim ?? '',
      sc.over ?? '',
      sc.step ?? '',
      sc.round ? ROUND_TH[sc.round] : '',
      sc.rate ?? '',
      sc.times ?? '',
      sc.unit ?? '',
      sc.axis ?? '',
      sc.value ?? '',
      sc.disabled ? OFF : ON,
      sc.source ?? '',
      sc.by ?? '',
      sc.at ?? '',
      sc.note ?? ''
    ]);
  }
  return {
    name: SHEET.subCodes,
    title:
      'ความหมายของตัวอักษรในรหัสสินค้า · หนึ่งแถว = หนึ่งรหัสย่อย · รหัสย่อยที่ไม่มีในชีตนี้ ระบบจะเตือนว่า "ยังไม่ได้ตั้งค่า" ไม่เดาให้',
    columns: SUBCODE_COLS,
    rows,
    freeze: true
  };
}

function ratesSheet(book: PriceBook): SheetTable {
  const rows: CellValue[][] = [];
  for (const m of Object.values(book.models)) {
    for (const a of m.adders) {
      if (!a.rates) continue;
      for (const [value, rate] of Object.entries(a.rates)) {
        rows.push([m.code, a.id, value || BLANK_TOKEN, rate]);
      }
    }
  }
  return {
    name: SHEET.rates,
    title:
      'กฎที่คิดคนละราคาตามค่าแกน (เช่น "บวกเพิ่ม 100 mm ละ" ของ TS-04 ที่ราคาไม่เท่ากันในแต่ละขนาดแกน) · ค่าแกนที่ไม่มีแถวในนี้ = ไม่รับทำ',
    columns: [
      { label: 'รหัสรุ่น', width: 12 },
      { label: 'รหัสกฎ', width: 18 },
      { label: 'ค่าแกน', width: 22 },
      { label: 'อัตรา', width: 12 }
    ],
    rows,
    freeze: true
  };
}

function constraintsSheet(book: PriceBook): SheetTable {
  const rows: CellValue[][] = [];
  for (const m of Object.values(book.models)) {
    for (const c of m.constraints) {
      rows.push([
        m.code,
        c.id,
        LEVEL_TH[c.level],
        predicateToText(c.when),
        c.message,
        c.disabled ? OFF : ON,
        c.source ?? '',
        c.note ?? ''
      ]);
    }
  }
  return {
    name: SHEET.constraints,
    title: `ข้อห้ามและข้อควรระวัง · ${LEVEL_TH.block} = ห้ามเสนอ · ${LEVEL_TH.quoteOnRequest} = ต้องถามฝ่ายผลิตก่อน · ${LEVEL_TH.warn} = เสนอได้แต่ต้องบอกลูกค้า`,
    columns: [
      { label: 'รหัสรุ่น', width: 12 },
      { label: 'รหัสกฎ', width: 22 },
      { label: 'ระดับ', width: 14 },
      { label: 'เงื่อนไข', width: 52 },
      { label: 'ข้อความที่จะขึ้น', width: 56 },
      { label: 'เปิดใช้', width: 9 },
      { label: 'ที่มาในไฟล์ราคา', width: 30 },
      { label: 'หมายเหตุ', width: 24 }
    ],
    rows,
    freeze: true
  };
}

/**
 * ตัวอักษรท้ายเลขรุ่น — หนึ่งรุ่นหนึ่งแถว
 *
 * **ทำไมราคาของแถมอยู่ในช่องเดียว ไม่ใช่ชีตของตัวเอง:** ของจริงมีอย่างมากไม่กี่รายการต่อรุ่น
 * (ซีรีส์ BH = 4) และคนที่แก้ต้องเห็น "20% กับของสี่อย่างนี้" พร้อมกันในสายตาเดียว
 * แยกเป็นชีตที่สองแล้วจะมีคนแก้ % โดยไม่รู้ว่ายังมีของแถมค้างอยู่อีกชีต
 */
function variantsSheet(book: PriceBook): SheetTable {
  const rows: CellValue[][] = [];
  for (const m of Object.values(book.models)) {
    const v = m.variant;
    if (!v) continue;
    rows.push([
      m.code,
      v.suffix,
      v.label,
      v.percent ?? 0,
      v.order ?? 10,
      v.disabled ? OFF : ON,
      v.confirmed === false ? OFF : ON,
      pairsToText(v.adderPrices),
      v.source ?? '',
      v.note ?? ''
    ]);
  }
  return {
    name: SHEET.variants,
    title:
      'ตัวอักษรท้ายเลขรุ่นที่ไม่ได้เปลี่ยนตารางราคา แค่คิดเพิ่มจากรุ่นหลัก · ' +
      'ช่อง "บวกเพิ่ม" ใส่ 0 = ไม่บวกเพิ่ม (ต่างจากปิดใช้) · ' +
      'ของแถมที่ไม่มีชื่อในช่องสุดท้าย = คิดเท่ารุ่นหลัก',
    columns: [
      { label: 'รหัสรุ่น', width: 12 },
      { label: 'ตัวอักษรท้ายรหัส', width: 16 },
      { label: 'ชื่อตัวเลือก', width: 18 },
      { label: 'บวกเพิ่มจากราคาตั้ง (%)', width: 22 },
      { label: 'ลำดับการคิด', width: 12 },
      { label: 'เปิดใช้', width: 9 },
      { label: 'ยืนยันกับฝ่ายขายแล้ว', width: 20 },
      { label: 'ราคาของแถมที่ต่างจากรุ่นหลัก', width: 46 },
      { label: 'ที่มาในไฟล์ราคา', width: 36 },
      { label: 'หมายเหตุ', width: 30 }
    ],
    rows,
    freeze: true
  };
}

function derivedSheet(book: PriceBook): SheetTable {
  const rows: CellValue[][] = [];
  for (const m of Object.values(book.models)) {
    for (const d of m.derivedDims ?? []) {
      rows.push([
        m.code,
        d.name,
        d.label,
        FORMULA_TH[d.formula],
        d.args.join(', '),
        pairsToText(d.consts),
        d.round ? ROUND_TH[d.round] : ''
      ]);
    }
  }
  return {
    name: SHEET.derived,
    title:
      'ค่าที่ระบบคิดให้เองจากค่าอื่น แล้วเอาไปใช้ต่อได้เหมือนขนาดที่กรอกเอง · ค่าคงที่ของสูตรอยู่ในคอลัมน์ "ค่าคงที่" ไม่ได้ฝังในโปรแกรม',
    columns: [
      { label: 'รหัสรุ่น', width: 12 },
      { label: 'ชื่อค่า', width: 14 },
      { label: 'ชื่อที่แสดง', width: 28 },
      { label: 'สูตร', width: 22 },
      { label: 'ใช้ค่าจาก', width: 24 },
      { label: 'ค่าคงที่', width: 26 },
      { label: 'ปัดเศษ', width: 10 }
    ],
    rows,
    freeze: true
  };
}

export function bookToSheets(book: PriceBook, opts?: { exportedAt?: string }): SheetTable[] {
  const at = opts?.exportedAt ?? new Date().toISOString().slice(0, 10);
  return [
    { name: SHEET.readme, rows: [], text: README_LINES },
    metaSheet(book, at),
    modelsSheet(book),
    addersSheet(book),
    ratesSheet(book),
    constraintsSheet(book),
    variantsSheet(book),
    derivedSheet(book),
    subCodesSheet(book),
    ...Object.values(book.models).map(baseSheet)
  ];
}

// ═════════════════════════════════════════════════════════════════════════════
//  ตาราง → สมุดราคา
// ═════════════════════════════════════════════════════════════════════════════

/**
 * หาแถวหัวตาราง โดยดูจาก "ข้อความที่ต้องมี" ไม่ใช่ตำแหน่งแถว
 * เผื่อคนแทรกแถวคำอธิบายของตัวเองไว้ข้างบน ซึ่งเป็นสิ่งที่ไฟล์ราคาจริงทำทุกไฟล์
 */
function findHeader(
  grid: CellValue[][],
  must: string[]
): { at: number; index: Record<string, number> } | undefined {
  const limit = Math.min(grid.length, 12);
  for (let r = 0; r < limit; r++) {
    const labels = (grid[r] ?? []).map(toText);
    if (!must.every((m) => labels.includes(m))) continue;
    const index: Record<string, number> = {};
    labels.forEach((l, i) => {
      if (l !== '' && !(l in index)) index[l] = i;
    });
    return { at: r, index };
  }
  return undefined;
}

class Reader {
  issues: ImportIssue[] = [];

  err(sheet: string, message: string, row?: number) {
    this.issues.push({ sheet, row, level: 'error', message });
  }
  warn(sheet: string, message: string, row?: number) {
    this.issues.push({ sheet, row, level: 'warn', message });
  }
}

function cell(row: CellValue[], index: Record<string, number>, label: string): CellValue {
  const i = index[label];
  return i === undefined ? null : row[i] ?? null;
}

function isEmptyRow(row: CellValue[]): boolean {
  return row.every((c) => toText(c) === '');
}

/**
 * อ่านตารางกลับเป็นสมุดราคา
 *
 * คืน `book: null` เฉพาะตอนที่ไฟล์ขาดชีตที่ขาดไม่ได้ (รุ่น / ฐานราคา) —
 * กรณีอื่นคืนสมุดที่อ่านได้ **พร้อมรายการปัญหา** เสมอ เพราะไฟล์ที่คนแก้มามักผิดทีละจุด
 * การล้มทั้งไฟล์เพราะแถวเดียวผิดแปลว่าคนแก้ต้องเดาเองว่าแถวไหน
 */
export function sheetsToBook(grids: RawSheet[]): { book: PriceBook | null; issues: ImportIssue[] } {
  const R = new Reader();
  const by = new Map<string, CellValue[][]>();
  for (const g of grids) by.set(g.name.trim(), g.rows);

  // ── รุ่น ───────────────────────────────────────────────────────────────────
  const modelGrid = by.get(SHEET.models);
  if (!modelGrid) {
    R.err(SHEET.models, `ไม่พบชีต "${SHEET.models}" — ไฟล์นี้ไม่ใช่แม่แบบสมุดราคา`);
    return { book: null, issues: R.issues };
  }
  const mh = findHeader(modelGrid, ['รหัสรุ่น', 'ชื่อรุ่น']);
  if (!mh) {
    R.err(SHEET.models, 'ไม่พบแถวหัวตาราง (ต้องมีคอลัมน์ "รหัสรุ่น" และ "ชื่อรุ่น")');
    return { book: null, issues: R.issues };
  }

  const models: Record<string, PriceModel> = {};
  const order: string[] = [];
  for (let r = mh.at + 1; r < modelGrid.length; r++) {
    const row = modelGrid[r] ?? [];
    if (isEmptyRow(row)) continue;
    const code = toText(cell(row, mh.index, 'รหัสรุ่น'));
    if (code === '') {
      R.warn(SHEET.models, 'แถวนี้ไม่มีรหัสรุ่น — ข้ามไป', r + 1);
      continue;
    }
    if (models[code]) {
      R.err(SHEET.models, `รหัสรุ่น ${code} ซ้ำกับแถวก่อนหน้า — ใช้แถวแรก`, r + 1);
      continue;
    }
    const aliases = toText(cell(row, mh.index, 'รหัสอื่นที่ใช้ตารางเดียวกัน'))
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    models[code] = {
      code,
      label: toText(cell(row, mh.index, 'ชื่อรุ่น')) || code,
      sheet: toText(cell(row, mh.index, 'ชีตต้นทาง')) || undefined,
      aliases: aliases.length ? aliases : undefined,
      standard: textToPairs(toText(cell(row, mh.index, 'สเปกที่รวมในราคาตั้งแล้ว'))),
      axisDefaults: (() => {
        const d = textToStrPairs(toText(cell(row, mh.index, 'ตัวเลือกที่ใช้เมื่อไม่ได้ระบุ')));
        return Object.keys(d).length ? d : undefined;
      })(),
      base: { kind: 'matrix', axes: [], cells: {} }, // ถูกแทนด้วยของจริงจากชีต ฐาน-* ข้างล่าง
      adders: [],
      constraints: []
    };
    order.push(code);
  }

  if (order.length === 0) {
    R.err(SHEET.models, 'ไม่มีรุ่นสักแถวในชีตนี้');
    return { book: null, issues: R.issues };
  }

  // ── ราคาตั้ง (ชีตละรุ่น) ───────────────────────────────────────────────────
  for (const code of order) {
    const name = SHEET.basePrefix + code;
    const grid = by.get(name);
    if (!grid) {
      R.err(name, `ไม่พบชีต "${name}" — รุ่น ${code} จะไม่มีราคาตั้ง`);
      continue;
    }
    readBase(models[code]!, name, grid, R);
  }

  // ── กฎบวกเพิ่ม ─────────────────────────────────────────────────────────────
  readAdders(by.get(SHEET.adders), models, R);
  readRates(by.get(SHEET.rates), models, R);
  readConstraints(by.get(SHEET.constraints), models, R);
  readVariants(by.get(SHEET.variants), models, R);
  readDerived(by.get(SHEET.derived), models, R);
  const subCodes = readSubCodes(by.get(SHEET.subCodes), R);

  // ── หัวสมุด ────────────────────────────────────────────────────────────────
  let version = 'นำเข้าจากไฟล์ Excel';
  let source = '(ไม่ได้ระบุไฟล์ต้นทาง)';
  let note = '';
  let bywhom = '';
  const metaGrid = by.get(SHEET.meta);
  if (metaGrid) {
    const mhh = findHeader(metaGrid, ['หัวข้อ', 'ค่า']);
    if (mhh) {
      for (let r = mhh.at + 1; r < metaGrid.length; r++) {
        const row = metaGrid[r] ?? [];
        const k = toText(cell(row, mhh.index, 'หัวข้อ'));
        const v = toText(cell(row, mhh.index, 'ค่า'));
        if (k === 'เวอร์ชัน' && v) version = v;
        if (k === 'ไฟล์ต้นทาง' && v) source = v;
        if (k === 'แก้อะไรไป') note = v;
        if (k === 'คนแก้') bywhom = v;
      }
    }
  }

  const book: PriceBook = {
    version,
    source,
    models,
    subCodes,
    edited: {
      at: new Date().toISOString().slice(0, 16).replace('T', ' '),
      by: bywhom || undefined,
      note: note || 'นำเข้าจากไฟล์ Excel'
    }
  };

  return { book, issues: R.issues };
}

/**
 * อ่านชีตรหัสย่อยกลับเป็นข้อมูล
 *
 * **ไม่มีชีตนี้ ไม่ใช่ความผิดพลาด** — ไฟล์ที่ส่งออกก่อนรอบนี้ยังไม่มีชีตนี้ และสมุดที่
 * ยังไม่มีใครตั้งค่ารหัสย่อยสักตัวก็ถูกต้องอยู่แล้ว ⇒ คืนรายการว่าง ไม่ต้องเตือน
 */
function readSubCodes(grid: CellValue[][] | undefined, R: Reader): SubCode[] {
  const name = SHEET.subCodes;
  if (!grid) return [];
  const h = findHeader(grid, ['รหัสย่อย', 'ผลกับราคา']);
  if (!h) {
    R.err(name, 'ไม่พบแถวหัวตาราง (ต้องมี "รหัสย่อย" และ "ผลกับราคา")');
    return [];
  }

  const out: SubCode[] = [];
  for (let r = h.at + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (isEmptyRow(row)) continue;
    const line = r + 1;

    const token = toText(cell(row, h.index, 'รหัสย่อย'));
    if (token === '') {
      R.warn(name, 'แถวนี้ไม่มีรหัสย่อย — ข้ามไป', line);
      continue;
    }

    const effectTh = toText(cell(row, h.index, 'ผลกับราคา'));
    const effect = EFFECT_FROM[effectTh];
    if (!effect) {
      R.err(name, `ผลกับราคา "${effectTh}" ไม่รู้จัก — ใช้ได้แค่ ${Object.values(EFFECT_TH).join(' · ')}`, line);
      continue;
    }

    const matchTh = toText(cell(row, h.index, 'แบบจับคู่'));
    const match = matchTh === '' ? 'exact' : MATCH_FROM[matchTh];
    if (!match) {
      R.err(name, `แบบจับคู่ "${matchTh}" ไม่รู้จัก — ใช้ได้แค่ ${Object.values(MATCH_TH).join(' · ')}`, line);
      continue;
    }

    const scope = toText(cell(row, h.index, 'ใช้กับรุ่น')) || '*';
    if (out.some((s) => s.subCode.toUpperCase() === token.toUpperCase() && s.scope === scope)) {
      R.err(name, `รหัสย่อย "${token}" ของรุ่น ${scope} ซ้ำกับแถวก่อนหน้า — ใช้แถวแรก`, line);
      continue;
    }

    const roundTh = toText(cell(row, h.index, 'ปัดเศษ'));
    const round = roundTh === '' ? undefined : ROUND_FROM[roundTh];
    if (roundTh !== '' && !round) R.warn(name, `ปัดเศษ "${roundTh}" ไม่รู้จัก — ใช้ปัดขึ้น`, line);

    const sc: SubCode = {
      subCode: token,
      match,
      scope,
      reads: toText(cell(row, h.index, 'อ่านว่า')),
      effect,
      order: toNumber(cell(row, h.index, 'ลำดับ')),
      amount: toNumber(cell(row, h.index, 'จำนวนเงิน')),
      percent: toNumber(cell(row, h.index, 'เปอร์เซ็นต์')),
      dim: toText(cell(row, h.index, 'คิดจากขนาด')) || undefined,
      over: toNumber(cell(row, h.index, 'เกินกว่า')),
      step: toNumber(cell(row, h.index, 'ทีละ')),
      round,
      rate: toNumber(cell(row, h.index, 'อัตราต่อหน่วย')),
      times: toNumber(cell(row, h.index, 'คูณ')),
      unit: toText(cell(row, h.index, 'หน่วย')) || undefined,
      axis: toText(cell(row, h.index, 'ตั้งค่าช่อง')) || undefined,
      value: toText(cell(row, h.index, 'เป็นค่า')) || undefined,
      disabled: toText(cell(row, h.index, 'เปิดใช้')) === OFF ? true : undefined,
      source: toText(cell(row, h.index, 'ที่มาในไฟล์ราคา')) || undefined,
      by: toText(cell(row, h.index, 'ใครตั้งค่า')) || undefined,
      at: toText(cell(row, h.index, 'เมื่อไหร่')) || undefined,
      note: toText(cell(row, h.index, 'หมายเหตุ')) || undefined
    };

    // แถวที่ "ไม่มีที่มาในไฟล์ราคา" = คนเพิ่มเอง — ต้องแยกให้ออก เพราะไฟล์ราคารอบใหม่
    // ห้ามทับของที่แอดมินตั้งค่าไว้เอง (กติกาเดียวกับกฎบวกเพิ่มที่เพิ่มเอง)
    if (!sc.source) sc.custom = true;

    for (const k of Object.keys(sc) as (keyof SubCode)[]) {
      if (sc[k] === undefined) delete sc[k];
    }
    out.push(sc);
  }
  return out;
}

function readBase(model: PriceModel, name: string, grid: CellValue[][], R: Reader): void {
  // ก) ใช้ฐานของรุ่นอื่น
  const refH = findHeader(grid, ['ใช้ฐานราคาของรุ่น']);
  if (refH) {
    const target = toText(cell(grid[refH.at + 1] ?? [], refH.index, 'ใช้ฐานราคาของรุ่น'));
    if (target === '') R.err(name, 'ไม่ได้ระบุว่าใช้ฐานราคาของรุ่นไหน', refH.at + 2);
    else model.base = { kind: 'ref', model: target };
    return;
  }

  // ข) ช่วงราคา — ชื่อปริมาณซ่อนอยู่ในหัวคอลัมน์แรก ("ช่วงของ area_in2 ตั้งแต่")
  const bandLabel = (grid.slice(0, 12).flat().map(toText).find((t) => /^ช่วงของ .+ ตั้งแต่$/.test(t)) ?? '');
  if (bandLabel) {
    const quantity = /^ช่วงของ (.+) ตั้งแต่$/.exec(bandLabel)![1]!.trim();
    const h = findHeader(grid, [bandLabel, 'ถึง']);
    if (!h) {
      R.err(name, 'ไม่พบแถวหัวตารางของช่วงราคา');
      return;
    }
    const bands: Band[] = [];
    for (let r = h.at + 1; r < grid.length; r++) {
      const row = grid[r] ?? [];
      if (isEmptyRow(row)) continue;
      const min = toNumber(cell(row, h.index, bandLabel));
      if (min === undefined) {
        R.warn(name, 'ช่อง "ตั้งแต่" ไม่ใช่ตัวเลข — ข้ามแถวนี้', r + 1);
        continue;
      }
      const maxRaw = cell(row, h.index, 'ถึง');
      const max = toText(maxRaw) === '' ? null : toNumber(maxRaw);
      if (max === undefined) {
        R.warn(name, 'ช่อง "ถึง" ไม่ใช่ตัวเลข — ถือว่าไม่มีขอบบน', r + 1);
      }
      const flat = toNumber(cell(row, h.index, 'ราคาเหมา'));
      const rate = toNumber(cell(row, h.index, 'ราคาต่อหน่วย'));
      if (flat === undefined && rate === undefined) {
        R.err(name, 'แถวนี้ไม่มีทั้งราคาเหมาและราคาต่อหน่วย — ช่วงนี้จะคิดราคาไม่ได้', r + 1);
        continue;
      }
      if (flat !== undefined && rate !== undefined) {
        R.warn(name, 'แถวนี้ใส่ทั้งราคาเหมาและราคาต่อหน่วย — ระบบจะใช้ราคาเหมา', r + 1);
      }
      bands.push({
        min,
        max: max === undefined ? null : max,
        ...(flat !== undefined ? { flat } : { rate }),
        label: toText(cell(row, h.index, 'ชื่อช่วงในไฟล์เดิม')) || undefined
      });
    }
    if (bands.length === 0) R.err(name, 'ไม่มีช่วงราคาสักแถว');
    model.base = { kind: 'banded', quantity, bands };
    return;
  }

  // ค) ตารางสองแกน — หัวคอลัมน์แรกคือ "แกนแถว \ แกนคอลัมน์"
  let headAt = -1;
  let axisCell = '';
  for (let r = 0; r < Math.min(grid.length, 12); r++) {
    const first = (grid[r] ?? []).map(toText).find((t) => t !== '') ?? '';
    if (/\\/.test(first) || (first !== '' && (grid[r] ?? []).map(toText).includes('ราคา'))) {
      headAt = r;
      axisCell = first;
      break;
    }
  }
  if (headAt < 0) {
    R.err(name, 'ไม่พบหัวตารางราคา — ช่องซ้ายบนต้องเขียนว่า "ชื่อแกนแถว \\ ชื่อแกนคอลัมน์"');
    return;
  }

  const headRow = (grid[headAt] ?? []).map(toText);
  const firstCol = headRow.findIndex((t) => t === axisCell);
  // ช่องซ้ายบนบอกชื่อแกนครบทุกแกน — สองแกนเป็น `D \ เกลียว` สามแกนเป็น `D \ เกลียว \ หัววัด`
  const parts = axisCell.split('\\').map((s) => s.trim());
  const rowAxis = parts[0] ?? '';
  const colAxes = parts.slice(1).filter((p) => p !== '');
  if (rowAxis === '') {
    R.err(name, 'อ่านชื่อแกนจากช่องซ้ายบนไม่ออก', headAt + 1);
    return;
  }

  const axes = [rowAxis, ...colAxes];
  const cells: Record<string, Money> = {};
  let filled = 0;
  let blank = 0;

  for (let r = headAt + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (isEmptyRow(row)) continue;
    const rv = toText(row[firstCol] ?? '');
    if (rv === '') continue;

    if (colAxes.length === 0) {
      const priceCol = headRow.findIndex((t) => t === 'ราคา');
      const v = toNumber(row[priceCol] ?? null);
      if (v === undefined) blank++;
      else {
        cells[matrixKey(axes, { [rowAxis]: rv })] = v;
        filled++;
      }
      continue;
    }

    for (let c = firstCol + 1; c < headRow.length; c++) {
      const cv = headRow[c] === BLANK_TOKEN ? '' : headRow[c] ?? '';
      if (headRow[c] === '' || headRow[c] === undefined) continue;
      const v = toNumber(row[c] ?? null);
      // ช่องว่าง = ไม่รับผลิตขนาดนั้น ⇒ ไม่ใส่คีย์ ไม่ใช่ใส่ 0
      if (v === undefined) {
        blank++;
        continue;
      }
      // `cv` เป็นค่าของแกนคอลัมน์ทุกแกนต่อกันอยู่แล้ว ⇒ ต่อท้ายแกนแถวได้ตรง ๆ
      cells[`${rv} | ${cv}`] = v;
      filled++;
    }
  }

  if (filled === 0) R.err(name, 'อ่านราคาไม่ได้สักช่อง — ตรวจว่าช่องราคาเป็นตัวเลข ไม่ใช่ข้อความ');
  model.base = { kind: 'matrix', axes, cells };
  model.importStats = {
    code: model.code,
    sheet: name,
    baseCells: filled,
    emptyCells: blank,
    adderRates: 0,
    floatNoiseFixed: 0
  };
}

function readAdders(grid: CellValue[][] | undefined, models: Record<string, PriceModel>, R: Reader): void {
  const name = SHEET.adders;
  if (!grid) {
    R.warn(name, `ไม่พบชีต "${name}" — สมุดราคานี้จะไม่มีกฎบวกเพิ่มเลย`);
    return;
  }
  const h = findHeader(grid, ['รหัสรุ่น', 'รหัสกฎ', 'วิธีคิด']);
  if (!h) {
    R.err(name, 'ไม่พบแถวหัวตาราง (ต้องมี "รหัสรุ่น" · "รหัสกฎ" · "วิธีคิด")');
    return;
  }

  for (let r = h.at + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (isEmptyRow(row)) continue;
    const line = r + 1;

    const code = toText(cell(row, h.index, 'รหัสรุ่น'));
    const model = models[code];
    if (!model) {
      R.err(name, `ไม่รู้จักรุ่น "${code}" — เพิ่มรุ่นนี้ในชีต ${SHEET.models} ก่อน`, line);
      continue;
    }

    const id = toText(cell(row, h.index, 'รหัสกฎ'));
    if (id === '') {
      R.err(name, 'แถวนี้ไม่มีรหัสกฎ', line);
      continue;
    }
    if (model.adders.some((a) => a.id === id)) {
      R.err(name, `รหัสกฎ "${id}" ซ้ำในรุ่น ${code} — ใช้แถวแรก`, line);
      continue;
    }

    const kindTh = toText(cell(row, h.index, 'วิธีคิด'));
    const kind = KIND_FROM[kindTh];
    if (!kind) {
      R.err(
        name,
        `วิธีคิด "${kindTh}" ไม่รู้จัก — ใช้ได้แค่ ${Object.values(KIND_TH).join(' · ')}`,
        line
      );
      continue;
    }

    const whenText = toText(cell(row, h.index, 'เงื่อนไข'));
    const parsed = parsePredicate(whenText);
    if (!parsed.ok) {
      R.err(name, `${parsed.reason} (กฎ ${id})`, line);
      continue;
    }

    const order = toNumber(cell(row, h.index, 'ลำดับ'));
    if (order === undefined) R.warn(name, `กฎ ${id} ไม่มีเลขลำดับ — ใช้ 999 ไปก่อน (จะถูกคิดท้ายสุด)`, line);

    const roundTh = toText(cell(row, h.index, 'ปัดเศษ'));
    const round = roundTh === '' ? undefined : ROUND_FROM[roundTh];
    if (roundTh !== '' && !round) R.warn(name, `ปัดเศษ "${roundTh}" ไม่รู้จัก — ใช้ปัดขึ้น`, line);

    const byAxis = toText(cell(row, h.index, 'อัตราตามแกน'));
    const skipTh = toText(cell(row, h.index, 'ถ้าไม่มีอัตรา'));
    const enabled = toText(cell(row, h.index, 'เปิดใช้'));

    const a: Adder = {
      id,
      label: toText(cell(row, h.index, 'ชื่อที่แสดง')) || id,
      order: order ?? 999,
      kind,
      ...(whenText === '' || whenText === 'ทุกกรณี' ? {} : { when: parsed.value })
    };

    const percent = toNumber(cell(row, h.index, 'เปอร์เซ็นต์'));
    const amount = toNumber(cell(row, h.index, 'จำนวนเงิน'));
    const rate = toNumber(cell(row, h.index, 'อัตราต่อหน่วย'));
    const dim = toText(cell(row, h.index, 'คิดจากขนาด'));
    const over = toNumber(cell(row, h.index, 'เกินกว่า'));
    const step = toNumber(cell(row, h.index, 'ทีละ'));
    const times = toNumber(cell(row, h.index, 'คูณ'));
    const unit = toText(cell(row, h.index, 'หน่วย'));

    if (kind === 'percent') {
      if (percent === undefined) {
        R.err(name, `กฎ ${id} เป็นแบบเปอร์เซ็นต์ แต่ช่อง "เปอร์เซ็นต์" ว่าง`, line);
        continue;
      }
      a.percent = percent;
    } else if (kind === 'flat') {
      if (amount === undefined && rate === undefined && byAxis === '') {
        R.err(name, `กฎ ${id} เป็นแบบเงินคงที่ แต่ไม่ได้ใส่จำนวนเงิน`, line);
        continue;
      }
      if (amount !== undefined) a.amount = amount;
      if (rate !== undefined) a.rate = rate;
    } else {
      if (dim === '') {
        R.err(name, `กฎ ${id} คิดตามส่วนที่เกิน แต่ไม่ได้บอกว่าคิดจากขนาดไหน`, line);
        continue;
      }
      a.dim = dim;
      if (over !== undefined) a.over = over;
      if (step !== undefined) a.step = step;
      if (rate !== undefined) a.rate = rate;
      if (times !== undefined) a.times = times;
      if (round) a.round = round;
      if (unit !== '') a.unit = unit;
      if (rate === undefined && byAxis === '') {
        R.err(name, `กฎ ${id} ไม่มีทั้ง "อัตราต่อหน่วย" และ "อัตราตามแกน" — คิดเงินไม่ได้`, line);
        continue;
      }
    }

    if (byAxis !== '') {
      a.byAxis = byAxis;
      a.rates = {};
      if (skipTh === SKIP_YES) a.skipIfNoRate = true;
      else if (skipTh !== '' && skipTh !== SKIP_NO) {
        R.warn(name, `"ถ้าไม่มีอัตรา" = "${skipTh}" ไม่รู้จัก — ใช้ "${SKIP_NO}"`, line);
      }
    }

    if (enabled === OFF) a.disabled = true;
    else if (enabled !== '' && enabled !== ON) {
      R.warn(name, `"เปิดใช้" = "${enabled}" ไม่รู้จัก — ถือว่า "${ON}"`, line);
    }

    const source = toText(cell(row, h.index, 'ที่มาในไฟล์ราคา'));
    const note = toText(cell(row, h.index, 'หมายเหตุ'));
    if (source !== '') a.source = source;
    if (note !== '') a.note = note;
    if (source === '') a.custom = true;

    model.adders.push(a);
  }
}

function readRates(grid: CellValue[][] | undefined, models: Record<string, PriceModel>, R: Reader): void {
  const name = SHEET.rates;
  if (!grid) return;
  const h = findHeader(grid, ['รหัสรุ่น', 'รหัสกฎ', 'ค่าแกน', 'อัตรา']);
  if (!h) {
    R.err(name, 'ไม่พบแถวหัวตาราง (ต้องมี "รหัสรุ่น" · "รหัสกฎ" · "ค่าแกน" · "อัตรา")');
    return;
  }

  for (let r = h.at + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (isEmptyRow(row)) continue;
    const line = r + 1;
    const code = toText(cell(row, h.index, 'รหัสรุ่น'));
    const id = toText(cell(row, h.index, 'รหัสกฎ'));
    const model = models[code];
    if (!model) {
      R.err(name, `ไม่รู้จักรุ่น "${code}"`, line);
      continue;
    }
    const a = model.adders.find((x) => x.id === id);
    if (!a) {
      R.err(name, `รุ่น ${code} ไม่มีกฎรหัส "${id}" ในชีต ${SHEET.adders}`, line);
      continue;
    }
    if (!a.byAxis) {
      R.err(name, `กฎ ${id} ไม่ได้ตั้งว่าคิดอัตราตามแกนไหน — เติมคอลัมน์ "อัตราตามแกน" ในชีต ${SHEET.adders}`, line);
      continue;
    }
    const value = toText(cell(row, h.index, 'ค่าแกน'));
    const rate = toNumber(cell(row, h.index, 'อัตรา'));
    if (rate === undefined) {
      // ตั้งใจเว้นว่าง = ไม่รับทำค่าแกนนั้น ⇒ ไม่ต้องเตือน แต่ก็ไม่ใส่คีย์
      continue;
    }
    a.rates = a.rates ?? {};
    a.rates[value === BLANK_TOKEN ? '' : value] = rate;
  }

  for (const m of Object.values(models)) {
    for (const a of m.adders) {
      if (a.byAxis && Object.keys(a.rates ?? {}).length === 0) {
        R.warn(name, `กฎ ${a.id} ของรุ่น ${m.code} ตั้งว่าคิดตามแกน ${a.byAxis} แต่ไม่มีอัตราสักแถว`);
      }
      if (a.rates) {
        m.importStats = m.importStats ?? {
          code: m.code,
          sheet: '',
          baseCells: 0,
          emptyCells: 0,
          adderRates: 0,
          floatNoiseFixed: 0
        };
        m.importStats.adderRates += Object.keys(a.rates).length;
      }
    }
  }
}

function readConstraints(grid: CellValue[][] | undefined, models: Record<string, PriceModel>, R: Reader): void {
  const name = SHEET.constraints;
  if (!grid) return;
  const h = findHeader(grid, ['รหัสรุ่น', 'รหัสกฎ', 'ระดับ', 'เงื่อนไข']);
  if (!h) {
    R.err(name, 'ไม่พบแถวหัวตาราง (ต้องมี "รหัสรุ่น" · "รหัสกฎ" · "ระดับ" · "เงื่อนไข")');
    return;
  }

  for (let r = h.at + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (isEmptyRow(row)) continue;
    const line = r + 1;
    const code = toText(cell(row, h.index, 'รหัสรุ่น'));
    const model = models[code];
    if (!model) {
      R.err(name, `ไม่รู้จักรุ่น "${code}"`, line);
      continue;
    }
    const id = toText(cell(row, h.index, 'รหัสกฎ'));
    if (id === '') {
      R.err(name, 'แถวนี้ไม่มีรหัสกฎ', line);
      continue;
    }
    const levelTh = toText(cell(row, h.index, 'ระดับ'));
    const level = LEVEL_FROM[levelTh];
    if (!level) {
      R.err(name, `ระดับ "${levelTh}" ไม่รู้จัก — ใช้ได้แค่ ${Object.values(LEVEL_TH).join(' · ')}`, line);
      continue;
    }
    const parsed = parsePredicate(toText(cell(row, h.index, 'เงื่อนไข')));
    if (!parsed.ok) {
      R.err(name, `${parsed.reason} (กฎ ${id})`, line);
      continue;
    }
    const message = toText(cell(row, h.index, 'ข้อความที่จะขึ้น'));
    if (message === '') {
      R.warn(name, `กฎ ${id} ไม่มีข้อความที่จะขึ้น — คนใช้จะไม่รู้ว่าติดอะไร`, line);
    }
    const enabled = toText(cell(row, h.index, 'เปิดใช้'));
    const source = toText(cell(row, h.index, 'ที่มาในไฟล์ราคา'));
    const note = toText(cell(row, h.index, 'หมายเหตุ'));

    const c: Constraint = { id, when: parsed.value, level, message };
    if (enabled === OFF) c.disabled = true;
    if (source !== '') c.source = source;
    else c.custom = true;
    if (note !== '') c.note = note;
    model.constraints.push(c);
  }
}

/**
 * อ่านชีตตัวเลือกท้ายรหัสกลับเป็นข้อมูล
 *
 * **ไม่มีชีตนี้ ไม่ใช่ความผิดพลาด** เหมือนชีตรหัสย่อย — ไฟล์ที่ส่งออกก่อน 2026-09-23
 * ยังไม่มีชีตนี้ · แต่ "มีชีตแล้วรุ่นนั้นไม่มีแถว" **แปลว่าไม่มีตัวเลือก** ซึ่งต่างกัน
 * ⇒ ต้องล้าง `variant` ของรุ่นที่ไม่มีแถวทิ้ง ไม่งั้นลบแถวในไฟล์แล้วตัวเลือกไม่หาย
 */
function readVariants(grid: CellValue[][] | undefined, models: Record<string, PriceModel>, R: Reader): void {
  if (!grid) return;
  const name = SHEET.variants;
  const h = findHeader(grid, ['รหัสรุ่น', 'ตัวอักษรท้ายรหัส', 'บวกเพิ่มจากราคาตั้ง (%)']);
  if (!h) {
    R.err(name, 'หาแถวหัวตารางไม่เจอ — ต้องมีคำว่า "รหัสรุ่น" และ "ตัวอักษรท้ายรหัส"');
    return;
  }
  for (const m of Object.values(models)) delete m.variant;

  for (let r = h.at + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (isEmptyRow(row)) continue;
    const code = toText(cell(row, h.index, 'รหัสรุ่น'));
    if (code === '') continue;
    const m = models[code];
    if (!m) {
      R.err(name, `ไม่มีรุ่น "${code}" ในชีต ${SHEET.models}`, r + 1);
      continue;
    }
    const suffix = toText(cell(row, h.index, 'ตัวอักษรท้ายรหัส')).toUpperCase();
    if (suffix === '') {
      R.err(name, `รุ่น ${code} ไม่ได้ใส่ตัวอักษรท้ายรหัส`, r + 1);
      continue;
    }
    const prices = textToPairs(toText(cell(row, h.index, 'ราคาของแถมที่ต่างจากรุ่นหลัก')));
    for (const id of Object.keys(prices)) {
      if (!m.adders.some((a) => a.id === id)) {
        R.err(name, `รุ่น ${code} ไม่มีกฎบวกเพิ่มชื่อ "${id}" — ราคาช่องนี้จะไม่มีผลกับอะไรเลย`, r + 1);
      }
    }
    m.variant = {
      suffix,
      label: toText(cell(row, h.index, 'ชื่อตัวเลือก')) || `รุ่น ${suffix}`,
      percent: toNumber(cell(row, h.index, 'บวกเพิ่มจากราคาตั้ง (%)')) ?? 0,
      order: toNumber(cell(row, h.index, 'ลำดับการคิด')) ?? 10,
      disabled: toText(cell(row, h.index, 'เปิดใช้')) === OFF || undefined,
      confirmed: toText(cell(row, h.index, 'ยืนยันกับฝ่ายขายแล้ว')) === OFF ? false : undefined,
      adderPrices: Object.keys(prices).length ? prices : undefined,
      source: toText(cell(row, h.index, 'ที่มาในไฟล์ราคา')) || undefined,
      note: toText(cell(row, h.index, 'หมายเหตุ')) || undefined
    };
  }
}

function readDerived(grid: CellValue[][] | undefined, models: Record<string, PriceModel>, R: Reader): void {
  const name = SHEET.derived;
  if (!grid) return;
  const h = findHeader(grid, ['รหัสรุ่น', 'ชื่อค่า', 'สูตร']);
  if (!h) {
    R.err(name, 'ไม่พบแถวหัวตาราง (ต้องมี "รหัสรุ่น" · "ชื่อค่า" · "สูตร")');
    return;
  }

  for (let r = h.at + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (isEmptyRow(row)) continue;
    const line = r + 1;
    const code = toText(cell(row, h.index, 'รหัสรุ่น'));
    const model = models[code];
    if (!model) {
      R.err(name, `ไม่รู้จักรุ่น "${code}"`, line);
      continue;
    }
    const nm = toText(cell(row, h.index, 'ชื่อค่า'));
    const formulaTh = toText(cell(row, h.index, 'สูตร'));
    const formula = FORMULA_FROM[formulaTh];
    if (nm === '' || !formula) {
      R.err(name, `สูตร "${formulaTh}" ไม่รู้จัก — ใช้ได้แค่ ${Object.values(FORMULA_TH).join(' · ')}`, line);
      continue;
    }
    const args = toText(cell(row, h.index, 'ใช้ค่าจาก'))
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    if (args.length === 0) {
      R.err(name, `ค่า ${nm} ไม่ได้บอกว่าคิดจากค่าไหน`, line);
      continue;
    }
    const roundTh = toText(cell(row, h.index, 'ปัดเศษ'));
    const d: DerivedDim = {
      name: nm,
      label: toText(cell(row, h.index, 'ชื่อที่แสดง')) || nm,
      formula,
      args
    };
    const consts = textToPairs(toText(cell(row, h.index, 'ค่าคงที่')));
    if (Object.keys(consts).length) d.consts = consts;
    if (roundTh !== '' && ROUND_FROM[roundTh]) d.round = ROUND_FROM[roundTh];
    model.derivedDims = model.derivedDims ?? [];
    model.derivedDims.push(d);
  }
}

// ── ชื่อชีตที่ใช้ภายนอก (หน้าเว็บอ้างถึงตอนอธิบายให้คนอ่าน) ────────────────────
export const SHEET_NAMES = SHEET;
export const VOCAB = { KIND_TH, LEVEL_TH, ROUND_TH, FORMULA_TH, EFFECT_TH, MATCH_TH, ON, OFF, SKIP_YES, SKIP_NO, BLANK_TOKEN };
