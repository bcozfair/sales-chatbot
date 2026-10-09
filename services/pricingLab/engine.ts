// ─────────────────────────────────────────────────────────────────────────────
//  เครื่องคิดราคา (pure function ล้วน)
//
//  โมดูล "คิดราคาสินค้า" — ถอดออกได้ทั้งก้อน ดู services/pricingLab/README.md
//
//  ⚠️ โมดูลนี้ถูกเรียกจาก routes/pricingLab.ts เท่านั้น และ **ห้ามมีโค้ดเดิมที่ไหน import
//     โฟลเดอร์นี้** — การพึ่งพาเป็นทางเดียวคือสิ่งเดียวที่ทำให้ "ลบทิ้งเมื่อไหร่ก็ได้" เป็นจริง
//     ไม่ใช่แค่ความตั้งใจ · เฟสแรกยังไม่ต่อกับใบเสนอราคา คิดราคาให้ดูอย่างเดียว
//  ด่านตรวจของไฟล์กลุ่มนี้อยู่ที่ scripts/diag/ (pricingGolden.ts · pricingRoundtrip.ts)
//  ซึ่ง import ตัวจริงจากที่นี่ ⇒ แก้โค้ดตรงนี้แล้วด่านเห็นทันที ไม่ใช่ด่านที่เฝ้าสำเนา
//
//  **ห้ามมี import ของ DB / network / LLM ในไฟล์นี้เด็ดขาด** เหตุผลสามข้อ:
//
//  1. ทดสอบได้ฟรี — ชีตแถมตัวอย่างคิดราคามาให้แล้ว ใช้เป็น golden test ได้โดยไม่ต้องมีฐาน
//  2. เรียกได้ทุกพื้นผิว — LIFF ต้องคิดราคาสดขณะผู้ใช้เลื่อนตัวเลือก ถ้าผูก DB จะยิง API
//     ทุกครั้งที่ขยับ
//  3. งบเวลา 48 วินาทีของ webhookQueue — ถ้า engine ยิง DB สิบครั้งต่อหนึ่งบรรทัด
//     ใบที่มี 10 รายการจะกินงบหมด · ผู้เรียกโหลดสมุดราคาก้อนเดียวแล้ว cache ไว้
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Adder,
  Band,
  BreakdownLine,
  DerivedDim,
  ModelVariant,
  Money,
  Predicate,
  PriceBook,
  PriceModel,
  PriceOutcome,
  ProductConfig,
  RoundMode,
  SubCode,
  TraceBase,
  TraceCheck,
  TraceInput,
  TraceRule,
  TraceOrigin,
  Violation
} from './types.js';
import { SUBCODE_PREFIX, matchedSubCodes } from './subcodes.js';
import { axisLabel, dimLabel, optionLabel } from './labels.js';

/**
 * ชื่อ option ที่ engine ใส่ให้เองเมื่อใบนี้ใช้ตัวเลือกท้ายเลขรุ่น (`variant:C`) — ใช้ในเงื่อนไขของข้อห้าม/กฎได้
 * ไม่มีใครพิมพ์มันในรหัส ⇒ ตัวอ่านรหัสไม่ต้องรู้จัก
 */
export const VARIANT_OPTION_PREFIX = 'variant:';

/** ปัดเป็นสตางค์ — ตัวเลขในไฟล์ Excel มี float noise จริง 182 เซลล์ (วัด 2026-09-17) */
function money(n: number): Money {
  return Math.round(n * 100) / 100;
}

function applyRound(n: number, mode: RoundMode = 'ceil'): number {
  if (mode === 'ceil') return Math.ceil(n);
  if (mode === 'floor') return Math.floor(n);
  return n;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** คำอธิบายการปัดเศษ — ต้องขึ้นจอทุกครั้ง เพราะ "2.5 ช่วง" คิด 2 หรือ 3 คือคำถามแรกของคนตรวจ */
const ROUND_TH: Record<RoundMode, string> = {
  ceil: 'ปัดขึ้น (เศษก็คิดเต็มช่วง)',
  floor: 'ปัดลง (นับเฉพาะเต็มช่วง)',
  exact: 'ไม่ปัด',
};

/** คำสั้นของการปัด สำหรับบรรทัด "คิดทีละ 100 mm เศษปัดขึ้น" ในการ์ดวิธีคำนวณ (2026-10-07) */
const ROUND_SHORT: Record<RoundMode, string> = {
  ceil: 'เศษปัดขึ้น',
  floor: 'ตัดเศษทิ้ง',
  exact: 'ไม่ปัด',
};

/** ตัวเลขพร้อมหน่วย เว้นวรรคแบบที่คนเขียน ("150 mm" ไม่ใช่ "150mm") */
function withUnit(n: number, unit: string): string {
  return unit.trim() ? `${fmt(n)} ${unit.trim()}` : fmt(n);
}

/**
 * ตำแหน่งช่องในชีตจาก `source` ("TS-03!B11 'บวกเพิ่ม…' — เหตุผล…" → ["TS-03!B11"])
 * การ์ดวิธีคำนวณโชว์แค่ตำแหน่ง (เจ้าของเลือก 2026-10-07) · เหตุผลยาวของการตั้งกฎอยู่ที่หน้าสมุดราคาและ CLI
 */
function sheetCells(source?: string): string[] | undefined {
  const found = source?.match(/[A-Za-z0-9_.+-]+![A-Z]{1,3}\d+(?::[A-Z]{1,3}\d+)?/g);
  return found?.length ? [...new Set(found)] : undefined;
}

// ── การหาแถวในตาราง ──────────────────────────────────────────────────────────

/** คีย์ของ matrix — ค่าแกนเป็น string ดิบจากชีต ไม่ normalize (ดู README ข้อ "แกน D") */
export function matrixKey(axes: string[], values: Record<string, string>): string {
  return axes.map((a) => values[a] ?? '').join(' | ');
}

// ── เงื่อนไข ─────────────────────────────────────────────────────────────────

export function evalPredicate(
  p: Predicate,
  axes: Record<string, string>,
  dims: Record<string, number>,
  options: Set<string>
): boolean {
  if ('always' in p) return p.always;
  if ('all' in p) return p.all.every((q) => evalPredicate(q, axes, dims, options));
  if ('any' in p) return p.any.some((q) => evalPredicate(q, axes, dims, options));
  if ('not' in p) return !evalPredicate(p.not, axes, dims, options);
  if ('option' in p) return options.has(p.option);
  if ('in' in p) return p.in.includes(axes[p.axis] ?? '');
  if ('notIn' in p) return !p.notIn.includes(axes[p.axis] ?? '');
  if ('dim' in p) {
    const v = dims[p.dim];
    if (v === undefined) return false;
    if (p.gt !== undefined && !(v > p.gt)) return false;
    if (p.gte !== undefined && !(v >= p.gte)) return false;
    if (p.lt !== undefined && !(v < p.lt)) return false;
    if (p.lte !== undefined && !(v <= p.lte)) return false;
    return true;
  }
  return false;
}

/**
 * เงื่อนไขเป็นภาษาคน **พร้อมค่าจริงของใบนี้** — "ความยาวรวม > 1000 (ใบนี้ 350)" ตรวจได้ด้วยตา
 * ส่วน "ความยาวรวม > 1000" เฉย ๆ คนตรวจต้องไปไล่หาค่าเองอีกรอบ
 */
export function describePredicate(
  p: Predicate,
  axes: Record<string, string>,
  dims: Record<string, number>,
  options: Set<string>
): string {
  const d = (q: Predicate) => describePredicate(q, axes, dims, options);
  if ('always' in p) return p.always ? 'ทุกกรณี' : 'ไม่มีกรณีไหน';
  if ('all' in p) return p.all.map(d).join(' และ ');
  if ('any' in p) return `(${p.any.map(d).join(' หรือ ')})`;
  if ('not' in p) return `ไม่ใช่ [${d(p.not)}]`;
  if ('option' in p) return `มี "${optionLabel(p.option)}" (ใบนี้${options.has(p.option) ? 'มี' : 'ไม่มี'})`;
  if ('in' in p || 'notIn' in p) {
    const list = 'in' in p ? p.in : p.notIn;
    return `${axisLabel(p.axis)}${'in' in p ? 'เป็น' : 'ไม่ใช่'} ${list.join(' / ')} (ใบนี้ ${axes[p.axis] || 'ไม่ได้ระบุ'})`;
  }
  if ('dim' in p) {
    const ops = [
      p.gt !== undefined ? `> ${fmt(p.gt)}` : '',
      p.gte !== undefined ? `≥ ${fmt(p.gte)}` : '',
      p.lt !== undefined ? `< ${fmt(p.lt)}` : '',
      p.lte !== undefined ? `≤ ${fmt(p.lte)}` : '',
    ].filter(Boolean).join(' และ ');
    const v = dims[p.dim];
    return `${dimLabel(p.dim)} ${ops} (ใบนี้ ${v === undefined ? 'ไม่มีค่า' : fmt(v)})`;
  }
  return 'เงื่อนไขที่ระบบไม่รู้จัก';
}

/** เงื่อนไขที่พูดถึงแต่ "มี/ไม่มีตัวเลือก" — ไม่ตรง = รหัสไม่มีของสิ่งนั้น (ไม่เกี่ยวกับใบนี้) */
function optionOnly(p: Predicate): boolean {
  if ('option' in p) return true;
  if ('not' in p) return optionOnly(p.not);
  if ('any' in p) return p.any.length > 0 && p.any.every(optionOnly);
  if ('all' in p) return p.all.length > 0 && p.all.every(optionOnly);
  return false;
}

/** ประโยคสั้นของเงื่อนไขตัวเลือกที่ไม่ตรง — "ใบนี้ไม่มี 2 element" · "ใบนี้มี ตัวเลือก C ท้ายเลขรุ่น" */
function optionMiss(p: Predicate, axes: Record<string, string>, dims: Record<string, number>, options: Set<string>): string {
  if ('option' in p) return `ใบนี้ไม่มี ${optionLabel(p.option)}`;
  if ('not' in p && 'option' in p.not) return `ใบนี้มี ${optionLabel(p.not.option)}`;
  if ('any' in p && p.any.every((q) => 'option' in q)) return `ใบนี้ไม่มี ${p.any.map((q) => optionLabel((q as { option: string }).option)).join(' / ')}`;
  return describePredicate(p, axes, dims, options);
}

/** ค่าจริงของใบนี้ในเงื่อนไขหนึ่งท่อน — "ใบนี้ ความกว้างแผ่น 120" */
function valueOf(p: Predicate, axes: Record<string, string>, dims: Record<string, number>, options: Set<string>): string {
  if ('dim' in p) return `ใบนี้ ${dimLabel(p.dim)} ${dims[p.dim] === undefined ? 'ไม่มีค่า' : fmt(dims[p.dim]!)}`;
  if ('in' in p || 'notIn' in p) return `ใบนี้ ${axisLabel(p.axis)} ${axes[p.axis] || 'ไม่ได้ระบุ'}`;
  return describePredicate(p, axes, dims, options);
}

/**
 * ข้อห้ามที่ไม่ติด — "ไม่เกี่ยว" (ใบนี้ไม่มีตัวเลือกที่ข้อห้ามพูดถึง) หรือ "ผ่าน" (อยู่ในขอบเขตแต่ค่าไม่เข้าข่าย)
 * เดิมขึ้น "ผ่าน" ทั้งคู่ — "ผ่าน 7 ข้อ" ที่จริงตรวจค่าจริงแค่ 3 ข้อ ทำให้คนตรวจเชื่อเกินกว่าที่ระบบทำ
 */
function checkVerdict(
  p: Predicate,
  axes: Record<string, string>,
  dims: Record<string, number>,
  options: Set<string>
): { verdict: TraceCheck['verdict']; note: string } {
  if (evalPredicate(p, axes, dims, options)) return { verdict: 'hit', note: describePredicate(p, axes, dims, options) };
  const parts = 'all' in p ? p.all : [p];
  const scope = parts.find((q) => optionOnly(q) && !evalPredicate(q, axes, dims, options));
  if (scope) return { verdict: 'na', note: optionMiss(scope, axes, dims, options) };
  const failing = parts.filter((q) => !evalPredicate(q, axes, dims, options));
  return { verdict: 'pass', note: [...new Set(failing.map((q) => valueOf(q, axes, dims, options)))].join(' · ') };
}

// ── ค่าที่คำนวณมาจากค่าอื่น ───────────────────────────────────────────────────

/** `text` = สูตรพร้อมตัวเลขจริง เขียนจากตัวแปรเดียวกับที่คิด (ดู `PriceTrace`) */
function computeDerived(d: DerivedDim, dims: Record<string, number>): { value: number; text: string } | undefined {
  const args = d.args.map((a) => dims[a]);
  if (args.some((v) => typeof v !== 'number' || Number.isNaN(v))) return undefined;

  let raw: number;
  let text: string;
  if (d.formula === 'sum') {
    raw = args.reduce((s, v) => s + v, 0);
    text = d.args.map((a, i) => `${dimLabel(a)} ${fmt(args[i]!)}`).join(' + ');
  } else {
    // พื้นที่เป็น "ตารางนิ้ว" — π และตัวหาร 645 (mm² ต่อ 1 in²) อยู่ใน consts ของสมุดราคา ไม่ใช่ในโค้ดนี้
    // ⚠️ ชีตใช้ 3.14 ไม่ใช่ Math.PI — ใช้ Math.PI แทนได้ผลต่างในหลักทศนิยม
    //    ซึ่งพอปัดขึ้นแล้วอาจข้ามหลักได้ จึงต้องยึดค่าที่เขาเขียน
    const pi = d.consts?.pi ?? 3.14;
    const per = d.consts?.mm2PerIn2 ?? 645;
    const a = (i: number) => `${dimLabel(d.args[i]!)} ${fmt(args[i]!)}`;
    if (d.formula === 'cylinderAreaIn2') {
      // ฮีตเตอร์รัดท่อ — สูตรในชีต BH เขียนไว้ตรง ๆ ว่า 600 x 3.14 x 150 / 645 = 438.14 ปัดเป็น 439
      raw = (args[0]! * pi * args[1]!) / per;
      text = `${a(0)} × ${pi} × ${a(1)} ÷ ${per}`;
    } else if (d.formula === 'rectAreaIn2') {
      raw = (args[0]! * args[1]!) / per;
      text = `${a(0)} × ${a(1)} ÷ ${per}`;
    } else if (d.formula === 'circleAreaIn2') {
      raw = (pi * args[0]! * args[0]!) / 4 / per;
      text = `${pi} × ${a(0)}² ÷ 4 ÷ ${per}`;
    } else if (d.formula === 'ringAreaIn2') {
      raw = (pi * (args[0]! * args[0]! - args[1]! * args[1]!)) / 4 / per;
      text = `${pi} × (${a(0)}² − ${a(1)}²) ÷ 4 ÷ ${per}`;
    } else {
      return undefined;
    }
  }
  const value = applyRound(raw, d.round ?? 'exact');
  text += ` = ${fmt(raw)}`;
  if (value !== raw) text += ` → ${ROUND_TH[d.round ?? 'exact']} = ${fmt(value)}`;
  return { value, text };
}

// ── ฐานราคา ─────────────────────────────────────────────────────────────────

function findBand(bands: Band[], q: number): Band | undefined {
  return bands.find((b) => q >= b.min && (b.max === null || q <= b.max));
}

interface BaseResult {
  ok: boolean;
  amount: Money;
  label: string;
  detail?: string;
  reason?: string;
  /** คิดไม่ได้เพราะรหัสไม่ได้บอกค่าแกนของตาราง (ไม่ใช่ไม่รับผลิต) */
  missing?: boolean;
  /** คิดไม่ได้เพราะค่าแกนนั้น "ตั้งไว้แต่ยังไม่มีราคา" (`unpriced`) — ไม่ใช่ไม่รับผลิต */
  noRate?: boolean;
  /** คิดไม่ได้เพราะค่าแกนอยู่นอกแคตตาล็อกและตารางยังไม่มีราคา (`ProductConfig.askPrice`) — ต้องขอราคาจากฝ่ายผลิต */
  quote?: boolean;
  /** ประโยคเดียวว่าราคาตั้งมาจากไหน (เมื่อ ok) — `TraceBase.why` */
  why?: string;
  /** วิธีหาราคาตั้งทีละขั้น (ดู `PriceTrace`) */
  steps: string[];
}

function computeBase(
  model: PriceModel,
  book: PriceBook,
  axes: Record<string, string>,
  dims: Record<string, number>,
  seen: Set<string>,
  unread: Record<string, string> = {},
  catalogOnly: Record<string, string> = {},
  askPrice: Record<string, string> = {}
): BaseResult {
  const base = model.base;

  if (base.kind === 'ref') {
    if (seen.has(base.model)) {
      return { ok: false, amount: 0, label: 'ฐานราคา', reason: `สมุดราคาวนกลับมาที่ ${base.model}`, steps: [] };
    }
    seen.add(base.model);
    const parent = resolveModel(book, base.model);
    if (!parent) {
      return { ok: false, amount: 0, label: 'ฐานราคา', reason: `ไม่มีรุ่น ${base.model} ในสมุดราคา`, steps: [] };
    }
    const r = computeBase(parent, book, axes, dims, seen, unread, catalogOnly, askPrice);
    return {
      ...r,
      label: `${r.label} (ฐานของ ${parent.code})`,
      steps: [`${model.code} ไม่มีตารางราคาตั้งของตัวเอง — ใช้ของรุ่น ${parent.code}`, ...r.steps],
    };
  }

  if (base.kind === 'matrix') {
    const key = matrixKey(base.axes, axes);
    const cell = base.cells[key];
    const where = `ตารางราคาตั้ง${model.sheet ? `ในชีต ${model.sheet}` : `ของ ${model.code}`} ดูจาก${base.axes.map(axisLabel).join(' × ')}`;
    const at = `ช่องของใบนี้ ${base.axes.map((a) => `${axisLabel(a)} = ${axes[a] || '(ไม่ได้ระบุ)'}`).join(' · ')}`;
    const steps = [`${where} → ${at}`];
    if (cell === undefined) {
      // รหัสไม่ได้บอกค่าของแกนในตาราง (เช่นไม่มีวงเล็บเกลียว) ≠ ชีตเว้นช่องไว้ — คนละคำตอบกับลูกค้า
      const unknown = base.axes.filter((a) => !axes[a]);
      // บอกมาแล้วแต่อ่านไม่ออก (`(M12)` บนรุ่นที่มีแต่เกลียวนิ้ว) ≠ ไม่ได้บอก — คนอ่านต้องรู้ว่าต้องแก้รหัส ไม่ใช่เติมรหัส
      const unreadable = unknown.filter((a) => unread[a] !== undefined);
      if (unreadable.length) {
        const unsaid = unknown.filter((a) => unread[a] === undefined);
        const said = unreadable.map((a) => `รหัสเขียนว่า "${unread[a]}" แต่ยังไม่ได้กำหนดว่าเป็น${axisLabel(a)}อะไร`);
        const notSaid = unsaid.length ? [`รหัสไม่ได้บอก${unsaid.map(axisLabel).join(' และ ')}`] : [];
        return {
          ok: false,
          amount: 0,
          label: 'ฐานราคา',
          missing: true,
          reason: `${[...said, ...notSaid].join(' · ')} — ตารางราคาตั้งต้องรู้ค่านี้ก่อน`,
          steps,
        };
      }
      if (unknown.length) {
        return {
          ok: false,
          amount: 0,
          label: 'ฐานราคา',
          missing: true,
          reason: `รหัสไม่ได้บอก${unknown.map(axisLabel).join(' และ ')} — ตารางราคาตั้งต้องรู้ค่านี้ก่อน`,
          steps,
        };
      }
      // ขนาดที่แคตตาล็อกมีแต่ตาราง Excel ไม่มีแถวเลย (TS_-18 แกน 2/3 mm · TS_-14 แกน 28 mm) — "ยังไม่มีราคา" ตาม mockup ที่เจ้าของ
      // เคาะ 2026-09-29 ไม่ใช่ "ไม่รับผลิต" (แคตตาล็อกขายขนาดนี้) และไม่ใช่ "รหัสไม่ได้บอก" (รหัสบอกแล้ว)
      const listedOnly = base.axes.filter((a) => catalogOnly[a] !== undefined && catalogOnly[a] === axes[a]);
      if (listedOnly.length) {
        return {
          ok: false,
          amount: 0,
          label: 'ฐานราคา',
          noRate: true,
          reason: `ตารางราคาตั้งของ ${model.code} ยังไม่มี${listedOnly.map((a) => `${axisLabel(a)} ${axes[a]}`).join(' · ')} — แคตตาล็อกมีค่านี้แต่ชีต Excel ยังไม่มีราคา`,
          steps: [...steps, `${listedOnly.map((a) => `${axisLabel(a)} ${axes[a]}`).join(' · ')} อยู่ในแคตตาล็อก แต่ตารางราคาไม่มีแถวนี้ (ยังไม่มีราคา ไม่ใช่ไม่รับผลิต)`],
        };
      }
      // ค่านอกแคตตาล็อก (เกลียว M12 · หัววัด TSE ของ TS_-01) ที่ตารางยังไม่มีราคา — "ต้องขอราคาจากฝ่ายผลิต" ตามที่เจ้าของเคาะ
      // 2026-09-29 ไม่ใช่ "ไม่รับผลิต" · มาก่อน `unpriced` เพราะคอลัมน์ที่แอดมินเพิ่มแล้วยังว่างก็ยังเป็นการขอราคาอยู่
      const asked = base.axes.filter((a) => askPrice[a] !== undefined && askPrice[a] === axes[a]);
      if (asked.length) {
        const what = asked.map((a) => `${axisLabel(a)} ${axes[a]}`).join(' · ');
        return {
          ok: false,
          amount: 0,
          label: 'ฐานราคา',
          quote: true,
          reason: `${what} ไม่อยู่ในแคตตาล็อก — ต้องขอราคาจากฝ่ายผลิต`,
          steps: [...steps, `${what} ไม่อยู่ในแคตตาล็อก และตารางราคาตั้งยังไม่มีราคาของช่องนี้ — ได้ราคาแล้วเพิ่มในตารางของชีต${model.sheet ? ` ${model.sheet}` : ''} ที่หน้าสมุดราคา`],
        };
      }
      // ค่าที่ตั้งไว้ให้กรอกราคาทีหลัง ≠ ช่องที่ชีตเว้นไว้ — อย่างแรก "ยังไม่มีราคา" อย่างหลัง "ไม่รับผลิต"
      const waiting = base.axes.filter((a) => base.unpriced?.[a]?.includes(axes[a]!));
      if (waiting.length) {
        return {
          ok: false,
          amount: 0,
          label: 'ฐานราคา',
          noRate: true,
          reason: `ตารางราคาตั้งของ ${model.code} ยังไม่มีราคาของ${waiting.map((a) => `${axisLabel(a)} ${axes[a]}`).join(' · ')} — ใส่ราคาได้ที่หน้าสมุดราคา`,
          steps: [...steps, `${waiting.map((a) => `${axisLabel(a)} ${axes[a]}`).join(' · ')} ตั้งไว้ในตารางแล้วแต่ยังไม่ได้ใส่ราคา (ไม่ใช่ไม่รับผลิต)`],
        };
      }
      return {
        ok: false,
        amount: 0,
        label: 'ฐานราคา',
        // ชีตเว้นช่องนี้ไว้ = ยังไม่มีราคา ไม่ใช่ราคา 0 และ **ไม่ใช่ "ไม่รับผลิต"** (เจ้าของสั่ง 2026-10-05: "ถ้าไม่มีราคา
        // ให้แสดงเฉพาะเท่าที่คิดราคาได้ ไม่ต้องแจ้งว่าไม่รับผลิต") ⇒ กฎบวกเพิ่มคิดต่อเป็นราคาเท่าที่คิดได้
        // คนอ่านบรรทัดนี้คือแอดมินที่กำลังจะตอบลูกค้า ไม่ใช่คนที่เปิดชีตราคาอยู่
        noRate: true,
        reason: `ยังไม่มีราคาสำหรับ ${base.axes.map((a) => `${axisLabel(a)} ${axes[a] ?? '-'}`).join(' · ')} — ต้องขอราคาจากฝ่ายผลิต`,
        steps: [...steps, 'ช่องนี้ในตารางว่าง = ยังไม่มีราคา (ไม่ใช่ราคา 0)'],
      };
    }
    return {
      ok: true,
      amount: money(cell),
      label: `ราคาตั้ง ${model.code}`,
      // ชื่อแกนต้องเป็นคำไทย — คนอ่านบรรทัดนี้คือแอดมินที่ไม่เคยเปิดชีต Excel มาก่อน
      detail: base.axes.map((a) => `${axisLabel(a)} ${axes[a]}`).join(' · '),
      why: `ช่อง ${base.axes.map((a) => axes[a]).join(' × ')}`,
      steps: [`${steps[0]} = ${fmt(money(cell))} บาท`],
    };
  }

  // banded
  const q = dims[base.quantity];
  if (q === undefined) {
    return { ok: false, amount: 0, label: 'ฐานราคา', reason: `คำนวณ ${base.quantity} ไม่ได้ — ข้อมูลไม่ครบ`, steps: [] };
  }
  const band = findBand(base.bands, q);
  if (!band) {
    return {
      ok: false,
      amount: 0,
      label: 'ฐานราคา',
      // นอกทุกช่วง = ยังไม่มีราคา ไม่ใช่ไม่รับผลิต (เจ้าของสั่ง 2026-10-05 · ดูช่องว่างของตารางข้างบน)
      noRate: true,
      reason: `${dimLabel(base.quantity)} ${fmt(q)} อยู่นอกทุกช่วงราคาของ ${model.code} — ต้องขอราคาจากฝ่ายผลิต`,
      steps: [],
    };
  }
  const bandName = band.label ?? `${band.min}-${band.max ?? '∞'}`;
  const bandSteps = [
    `ตารางช่วงราคา${model.sheet ? `ในชีต ${model.sheet}` : `ของ ${model.code}`} คิดตาม${dimLabel(base.quantity)} → ${fmt(q)} อยู่ช่วง ${bandName.trim().replace(/\s+/g, ' ')}`,
  ];
  if (band.flat !== undefined) {
    return {
      ok: true,
      amount: money(band.flat),
      label: `ราคาตั้ง ${model.code}`,
      detail: `${base.quantity} ${fmt(q)} → ช่วง ${bandName} เหมา`,
      why: `${dimLabel(base.quantity)} ${fmt(q)} — ราคาเหมาของช่วงนี้`,
      steps: [...bandSteps, `ช่วงนี้ราคาเหมา = ${fmt(money(band.flat))} บาท`],
    };
  }
  return {
    ok: true,
    amount: money(band.rate! * q),
    label: `ราคาตั้ง ${model.code}`,
    detail: `${base.quantity} ${fmt(q)} × ${fmt(band.rate!)} (ช่วง ${bandName})`,
    why: `${dimLabel(base.quantity)} ${fmt(q)} × ${fmt(band.rate!)} บาท`,
    steps: [...bandSteps, `${fmt(q)} × อัตรา ${fmt(band.rate!)} บาท = ${fmt(money(band.rate! * q))} บาท`],
  };
}

// ── ส่วนที่บวกเพิ่ม ──────────────────────────────────────────────────────────

interface AdderResult {
  amount: Money;
  detail?: string;
  /** ชีตเว้นราคาของแกนนี้ไว้ = ไม่รับทำ */
  blocked?: string;
  /** `blocked` เพราะรหัสไม่ได้บอกค่าแกน ไม่ใช่เพราะไม่รับทำ */
  missing?: boolean;
  /** `blocked` เพราะค่าที่รหัสบอกยังไม่มีราคาในกฎนี้ */
  noRate?: boolean;
  /** ข้ามกฎนี้ไปก่อนเพราะอ่านค่าในรหัสไม่ออก — ราคาที่เหลือยังคิดต่อ (ข้อความเตือนอยู่ในนี้) */
  partial?: string;
  skip?: boolean;
  /** ทำไมถึงข้าม (คู่กับ `skip`) — ขึ้นจอในวิธีคิดทีละขั้น */
  why?: string;
  /** ข้ามเพราะไม่เกินมาตรฐาน (คู่กับ `skip`) — การ์ดรวมไว้กลุ่ม "ไม่เกินมาตรฐาน" */
  withinStd?: boolean;
  /** ประโยคเดียวว่าเงินก้อนนี้คิดยังไง (เมื่อคิดเงินจริง) — `TraceRule.why` */
  summary?: string;
  /** วิธีคิดทีละขั้น (ดู `PriceTrace`) — เขียนจากตัวแปรเดียวกับที่คิดเงิน */
  steps: string[];
}

function computeAdder(
  a: Adder,
  model: PriceModel,
  subtotal: Money,
  axes: Record<string, string>,
  dims: Record<string, number>,
  unread: Record<string, string> = {},
  /** ชื่อของยอดที่กฎ % คิดจาก — "ราคาตั้ง" ถ้ายังไม่มีกฎไหนบวกก่อนหน้า ไม่งั้น "ยอดก่อนหน้า" */
  subtotalName = 'ยอดก่อนหน้า'
): AdderResult {
  const steps: string[] = [];
  if (a.kind === 'percent') {
    const amount = money((subtotal * (a.percent ?? 0)) / 100);
    steps.push(`${subtotalName} ${fmt(subtotal)} × ${fmt(a.percent ?? 0)}% = ${fmt(amount)} บาท`);
    return { amount, detail: `${a.percent}% ของ ${fmt(subtotal)}`, summary: `${fmt(a.percent ?? 0)}% ของ${subtotalName} ${fmt(subtotal)}`, steps };
  }

  const unit = a.unit ?? '';
  // ── perUnit: ตัดสินว่า "ต้องคิดเงินไหม" ก่อนไปหาราคา ────────────────────────
  // ลำดับนี้สลับไม่ได้ — ถ้าไปหาราคาก่อน สินค้าที่สเปกตรง Standard เป๊ะ (ไม่ต้องบวกอะไรเลย)
  // จะถูกบล็อกเพียงเพราะชีตเว้นช่อง "บวกเพิ่ม 100 mm ละ" ของขนาดนั้นไว้
  let excess = 0;
  let over = 0;
  const step = a.step ?? 1;
  const round = a.round ?? 'ceil';
  let rawUnits = 0;
  let units = 0;
  if (a.kind === 'perUnit') {
    const dimName = a.dim ?? '';
    const value = dims[dimName];
    if (value === undefined) {
      return { amount: 0, skip: true, why: `ใบนี้ไม่มีค่า${dimLabel(dimName)}`, steps };
    }
    over = a.over ?? model.standard[dimName] ?? 0;
    // `over` ที่ไม่ได้ตั้งในกฎ = มาตรฐานของรุ่น (ไม่ใช่ 0 — ดู CLAUDE.md เรื่อง `Adder.over`)
    const overFrom = a.over !== undefined ? 'เกณฑ์ของกฎนี้' : model.standard[dimName] !== undefined ? 'มาตรฐานของรุ่น' : 'ไม่มีมาตรฐาน';
    excess = value - over;
    steps.push(`${dimLabel(dimName)} ${withUnit(value, unit)} − ${overFrom} ${withUnit(over, unit)} = เกิน ${withUnit(excess, unit)}`);
    if (excess <= 0) {
      const std = a.over !== undefined ? 'เกณฑ์' : 'มาตรฐาน';
      return {
        amount: 0, skip: true, withinStd: true, steps,
        why: `${dimLabel(dimName)} ${withUnit(value, unit)} ${excess === 0 ? `เท่ากับ${std}` : `ไม่เกิน${std} ${withUnit(over, unit)}`}`,
      };
    }
    // ปัดก่อนไปหาอัตรา — กฎที่ปัดลงได้ 0 ช่วงเมื่อเกินไม่ถึงช่วง ⇒ ไม่ต้องคิดเงินจึงไม่ต้องรู้อัตรา
    // (ค่าสาย TS เคยปัดลงช่วง 2026-09-25 – 10-01 · ตอนนี้ปัดขึ้นทุกตระกูล แต่ลำดับนี้ยังถูกสำหรับกฎปัดลงอื่น)
    rawUnits = excess / step;
    units = applyRound(rawUnits, round);
    if (units <= 0) {
      steps.push(`คิดทีละ ${withUnit(step, unit)} ${ROUND_SHORT[round]}: ${fmt(excess)} ÷ ${fmt(step)} = ${fmt(rawUnits)} → 0 ช่วง`);
      return { amount: 0, skip: true, why: `เกินไม่ถึง ${withUnit(step, unit)} — กฎนี้นับเฉพาะช่วงเต็ม จึงไม่คิดเงิน`, steps };
    }
  }

  // หาราคาต่อหน่วย: คงที่ หรือขึ้นกับค่าแกน
  let rate = a.rate;
  if (a.byAxis) {
    const axisValue = axes[a.byAxis] ?? '';
    rate = a.rates?.[axisValue];
    if (rate === undefined) {
      if (a.skipIfNoRate) {
        return { amount: 0, skip: true, why: `กฎนี้ไม่มีอัตราของ${axisLabel(a.byAxis)} ${axisValue || '(ไม่ได้ระบุ)'} และตั้งไว้ให้ข้าม`, steps };
      }
      // ไม่มีค่าแกนเลย = รหัสไม่ได้บอก (ต่างจาก "บอกแล้วแต่ไม่มีราคา" ซึ่งแปลว่าไม่รับทำ)
      // รหัสบอกมาแต่อ่านไม่ออก ⇒ ข้ามกฎนี้แล้วคิดส่วนที่เหลือต่อ พร้อมเตือนว่ายังไม่รวม (เจ้าของสั่ง 2026-09-25:
      // "รหัสที่อ่านไม่ออกให้ขึ้นเตือนไว้ แต่คำนวณเฉพาะส่วนที่คำนวณได้ไปก่อน") · ห้ามเติมค่าตั้งต้นแทน — นั่นคือการเดา
      if (!axisValue && unread[a.byAxis] !== undefined) {
        return { amount: 0, partial: `${a.label} — ยังไม่รวม: รหัสเขียนว่า "${unread[a.byAxis]}" แต่ยังไม่ได้กำหนดว่าเป็น${axisLabel(a.byAxis)}อะไร`, steps };
      }
      if (!axisValue) return { amount: 0, missing: true, blocked: `${a.label}: รหัสไม่ได้บอก${axisLabel(a.byAxis)}`, steps };
      return { amount: 0, noRate: true, blocked: `${a.label}: ยังไม่มีราคาสำหรับ ${axisLabel(a.byAxis)} ${axisValue}`, steps };
    }
  }
  const rateFrom = a.byAxis ? `อัตราของ${axisLabel(a.byAxis)} ${axes[a.byAxis]}` : 'อัตราเดียวทุกกรณี';
  const rateOf = a.byAxis ? `${axisLabel(a.byAxis)} ${axes[a.byAxis]}` : 'อัตราเดียวทุกขนาด';

  if (a.kind === 'flat') {
    // ว่าง ≠ 0 เหมือนช่องราคาทุกที่ในสมุด — กฎที่ตั้งโครงไว้ก่อนมีราคา (PL-5 ของ BH · เจ้าของ 2026-09-29
    // "ทำโครงสร้างไว้ให้พิมพ์ค่าภายหลังได้") ต้องขึ้น "ยังไม่มีราคา" ไม่ใช่บวก 0 บาทแล้วคืนราคาหน้าตาปกติ
    if (a.amount === undefined && rate === undefined) {
      steps.push('ยังไม่ได้กรอกจำนวนเงินของกฎนี้');
      return { amount: 0, noRate: true, blocked: `${a.label}: ยังไม่มีราคา — กรอกที่หน้าสมุดราคา`, steps };
    }
    const amt = a.amount ?? rate ?? 0;
    steps.push(a.amount !== undefined ? `บวกเงินคงที่ ${fmt(money(amt))} บาท` : `บวกเงินคงที่ตาม${rateFrom} = ${fmt(money(amt))} บาท`);
    return { amount: money(amt), steps, ...(a.amount === undefined ? { summary: rateFrom } : {}) };
  }

  // ปัดขึ้นทั้งบล็อกเป็นค่าตั้งต้นตามที่ชีตทำ — ตัวอย่าง TS-14: ส่วนต่าง 250 mm → 3 บล็อก ไม่ใช่ 2.5
  // (`units` คิดไว้แล้วข้างบน ก่อนหาอัตรา)
  const times = a.times ?? 1;
  const amount = money(units * (rate ?? 0) * times);
  const timesNote = times !== 1 ? ` × ${times}` : '';
  // ช่วงละ 1 หน่วยที่ลงตัว (สาย 5 m = 5 ช่วง) ไม่ต้องมีบรรทัดหารให้อ่าน — มันไม่ได้บอกอะไรเพิ่ม
  const plain = step === 1 && units === rawUnits;
  if (!plain) {
    steps.push(
      `คิดทีละ ${withUnit(step, unit)}${round === 'exact' ? '' : ` ${ROUND_SHORT[round]}`}: ${fmt(excess)} ÷ ${fmt(step)} = ${fmt(rawUnits)}` +
        (units === rawUnits ? ' ช่วงพอดี' : ` → ${fmt(units)} ช่วง`)
    );
  }
  steps.push(
    `${rateOf}: ${withUnit(step, unit)} ละ ${fmt(rate ?? 0)} บาท${times !== 1 ? ` · คูณ ${times} ตามกฎ` : ''}` +
      ` → ${fmt(units)} × ${fmt(rate ?? 0)}${timesNote} = ${fmt(amount)} บาท`
  );
  return {
    amount,
    detail: `เกิน ${fmt(over)}${unit} อยู่ ${fmt(excess)}${unit} → ${units} × ${fmt(step)}${unit} @${fmt(rate ?? 0)}${timesNote}`,
    summary: plain
      ? `เกิน ${withUnit(excess, unit)} × ${fmt(rate ?? 0)} บาท${timesNote}`
      : `เกิน ${withUnit(excess, unit)} → ${fmt(units)} ช่วง × ${fmt(rate ?? 0)}${timesNote}`,
    steps,
  };
}

/**
 * แถวในตารางรหัสย่อยที่คิดเงิน ถูกแปลงเป็น "กฎบวกเพิ่ม" ชั่วคราวแล้วเข้าคิวเดียวกับกฎอื่น
 * **ตั้งใจให้เป็นทางเดียวกัน** — ถ้าเขียนสูตรแยก วันหนึ่งการปัดเศษหรือลำดับของสองทางจะต่างกัน
 * แล้วไม่มีใครรู้ว่าทางไหนถูก (ราคาห้ามคิดสองที่)
 */
function subCodeAsAdder(sc: SubCode): Adder {
  return {
    id: 'sub:' + sc.subCode,
    // เขียนตัวรหัสย่อยไว้ในชื่อด้วย เพราะ breakdown ต้องตอบได้ว่า "เงินก้อนนี้มาจากตัวไหนในรหัส"
    label: `${sc.reads || sc.subCode} (${sc.subCode})`,
    order: sc.order ?? 50,
    kind: sc.effect as Adder['kind'],
    amount: sc.amount,
    percent: sc.percent,
    dim: sc.dim,
    over: sc.over,
    step: sc.step,
    round: sc.round,
    rate: sc.rate,
    times: sc.times,
    unit: sc.unit,
    source: sc.source,
    note: sc.note
  };
}

// ── ตัวเลือกท้ายรหัส ─────────────────────────────────────────────────────────

/**
 * ตัวเลือกที่ใช้กับใบนี้ — ไม่มี / ปิดไว้ / ตัวอักษรไม่ตรง = คิดเป็นรุ่นหลักเปล่า ๆ
 * เทียบแบบไม่สนตัวพิมพ์ เพราะรหัสที่เซลส์พิมพ์มามีทั้ง `BH-02C` และ `bh-02c`
 */
function pickVariant(model: PriceModel, suffix?: string): ModelVariant | undefined {
  const v = model.variant;
  if (!v || v.disabled || !suffix) return undefined;
  return suffix.toUpperCase() === v.suffix.toUpperCase() ? v : undefined;
}

/**
 * ราคาฝั่งตัวเลือก — ทับ **เฉพาะช่องราคา** ไม่แตะเงื่อนไข/ลำดับ/หน่วย
 * ⇒ ของแถมที่ไม่ได้ระบุราคาไว้คิดเหมือนรุ่นหลักทุกบาทโดยไม่ต้องคัดลอกกฎมาทั้งชุด
 */
function withVariantPrice(a: Adder, v?: ModelVariant): Adder {
  const p = v?.adderPrices?.[a.id];
  if (p === undefined) return a;
  if (a.kind === 'percent') return { ...a, percent: p };
  if (a.kind === 'flat') return { ...a, amount: p };
  return { ...a, rate: p };
}

/**
 * เปอร์เซ็นต์ที่บวกเพิ่มถูกทำเป็น "กฎบวกเพิ่ม" ตัวหนึ่งแล้วเข้าคิวเดียวกับกฎอื่น
 * **ตั้งใจให้เป็นทางเดียวกัน** เหมือนที่รหัสย่อยทำ — คิดแยกเมื่อไหร่ การปัดเศษกับลำดับ
 * ของสองทางจะต่างกันวันหนึ่ง แล้วไม่มีใครรู้ว่าทางไหนถูก (ราคาห้ามคิดสองที่)
 * percent = 0 ได้เงิน 0 แล้วถูกข้ามเองในลูปหลัก ⇒ ไม่ต้องมีเงื่อนไขพิเศษให้ "ไม่บวกเพิ่ม"
 */
function variantAdder(v: ModelVariant): Adder {
  return {
    id: 'variant:' + v.suffix,
    label: `${v.label} — บวกเพิ่มจากราคาตั้ง`,
    order: v.order ?? 10,
    kind: 'percent',
    percent: v.percent ?? 0,
    source: v.source,
    note: v.note
  };
}

// ── ตัวหลัก ──────────────────────────────────────────────────────────────────

export function resolveModel(book: PriceBook, code: string): PriceModel | undefined {
  const direct = book.models[code];
  if (direct) return direct;
  for (const m of Object.values(book.models)) {
    if (m.aliases?.includes(code)) return m;
  }
  return undefined;
}

/** ที่มาของค่าที่กรอกในช่องนอกรหัส (`ProductConfig.offCode`) */
const OFF_CODE = 'กรอกในช่องนอกรหัส (รหัสไม่ได้บอก)';

/** รุ่นนี้มีกฎ/ข้อห้ามที่อ่านตัวเลือกนี้ไหม — ใช้ตอนคิดตามรุ่นอื่น (`ProductConfig.priceAs`) */
function mentionsOption(model: PriceModel, option: string): boolean {
  const uses = (p?: Predicate): boolean =>
    !!p && ('option' in p ? p.option === option : 'all' in p ? p.all.some(uses) : 'any' in p ? p.any.some(uses) : 'not' in p ? uses(p.not) : false);
  return model.adders.some((a) => uses(a.when)) || model.constraints.some((c) => uses(c.when));
}

export function computePrice(cfg: ProductConfig, book: PriceBook): PriceOutcome {
  const own = resolveModel(book, cfg.model);
  if (!own) {
    return {
      status: 'notManufacturable',
      model: cfg.model,
      unitPrice: 0,
      breakdown: [],
      violations: [{ id: 'UNKNOWN_MODEL', level: 'block', message: `ไม่มีรุ่น ${cfg.model} ในสมุดราคา` }],
      bookVersion: book.version
    };
  }
  // วัสดุที่ชีตสั่งให้คิดราคาตามรุ่นอื่นทั้งชิ้น (S ของ TS_-03 → TSK-12 · `ProductConfig.priceAs`) — ตาราง กฎ ข้อห้าม ค่ามาตรฐาน
  // มาจากรุ่นนั้นทั้งหมด · `own` (รุ่นของรหัส) ใช้ที่เดียวคือจับคู่ตารางรหัสย่อย (ชนิดสาย · Ground ตั้งไว้ที่รุ่นของรหัส)
  const model = cfg.priceAs ? resolveModel(book, cfg.priceAs.model) : own;
  if (!model) {
    return {
      status: 'quoteOnRequest',
      model: own.code,
      unitPrice: 0,
      breakdown: [],
      violations: [{ id: 'PRICE_AS_MODEL', level: 'quoteOnRequest', noRate: true, message: `${cfg.priceAs!.why} — แต่สมุดราคาไม่มีรุ่น ${cfg.priceAs!.model} ⇒ ต้องขอราคาจากฝ่ายผลิต` }],
      bookVersion: book.version
    };
  }

  const variant = pickVariant(model, cfg.variant);

  // ค่าว่างใน cfg.axes แปลว่า "ไม่ได้ระบุ" ไม่ใช่ "เลือกค่าว่าง" ⇒ กรองทิ้งก่อนเติมค่าเริ่มต้น
  // ไม่งั้นช่อง "— ไม่มี —" บนหน้าจอจะลบค่ามาตรฐานของแกนนั้นไปเงียบ ๆ
  const given = Object.fromEntries(Object.entries(cfg.axes ?? {}).filter(([, v]) => v !== ''));
  const staticDefaults = Object.fromEntries(
    Object.entries(model.axisDefaults ?? {}).filter(([k]) => cfg.unread?.[k] === undefined)
  );
  const axes = { ...staticDefaults, ...given };
  // แกนไหนได้ค่ามาจากค่าเริ่มต้น (ไม่ใช่จากรหัส) — บอกบนบรรทัดราคา เพราะ "ทำไมคิดเกลียว 1/4”"
  // ต้องตอบได้จากหน้าจอ (TS_-01: รหัสไม่มีวงเล็บ = 1/4” ตามแคตตาล็อก · 2026-09-24)
  const defaultedBy: Record<string, string> = {};
  for (const a of Object.keys(staticDefaults)) if (!(a in given)) defaultedBy[a] = 'ค่ามาตรฐานของรุ่น';
  // ค่าเริ่มต้นที่ขึ้นกับอีกแกน (สายของ TS-01 ขึ้นกับ TYPE) — แพ้ค่าที่รหัสบอกเอง ชนะ `axisDefaults`
  for (const [axis, d] of Object.entries(model.axisDefaultsBy ?? {})) {
    // รหัสบอกมาแล้วแต่อ่านไม่ออก ≠ รหัสไม่ได้บอก — เติมค่าเริ่มต้นตรงนี้ = คิดเงินผิดชนิดโดยไม่มีอะไรฟ้อง
    if (axis in given || cfg.unread?.[axis] !== undefined) continue;
    const v = d.values[axes[d.by] ?? ''];
    if (v === undefined) continue;
    axes[axis] = v;
    defaultedBy[axis] = `${d.label ?? axisLabel(axis)}ของ ${axes[d.by]}`;
  }
  // รหัสย่อยที่ "เซ็ตค่าให้ช่อง" ต้องมีผลก่อนหาราคาตั้ง ไม่งั้นตารางจะถูกค้นด้วยค่าเก่า
  const subCodes = matchedSubCodes(book, own, cfg.options ?? []);
  // รหัสย่อยที่ "รู้ความหมายแล้วแต่ยังไม่มีราคา" — ช่องเงินของ `flat` ว่าง / ค่าที่ `setAxis` จะตั้งว่าง
  // (เจ้าของสั่ง 2026-09-25: หัว S/E/SS/SB และเกลียวมิลของ TS_-08/10 "ใส่ค่าว่างไว้ก่อน ค่อยกำหนดภายหลังผ่าน ui")
  // ⇒ ขึ้น "ยังไม่มีราคา" แบบเดียวกับอัตราที่ขาด · **ห้ามคิดเป็น +0** และห้ามปล่อยให้ค่ามาตรฐานของแกนนั้นมาแทน
  // (เกลียวมิลที่ถูกเติมเป็นเกลียวมาตรฐานเงียบ ๆ = ราคาผิดที่ดูเหมือนถูก)
  const pending = subCodes.filter((s) => (s.effect === 'flat' && s.amount === undefined) || (s.effect === 'setAxis' && !s.value));
  const pendingAxes = new Set(pending.flatMap((s) => (s.effect === 'setAxis' && s.axis ? [s.axis] : [])));
  /** แกนไหนถูกรหัสย่อยตัวไหนตั้งค่า — ขึ้นในวิธีคิดทีละขั้น */
  const setBy: Record<string, string> = {};
  for (const sc of subCodes) {
    if (sc.effect === 'setAxis' && sc.axis) {
      if (sc.value) axes[sc.axis] = sc.value;
      else delete axes[sc.axis];
      delete defaultedBy[sc.axis];
      setBy[sc.axis] = sc.subCode;
    }
  }
  // standard คือสเปกที่รวมอยู่ในราคาตั้งแล้ว ⇒ เป็นค่าตั้งต้นของทุก dim ที่ผู้ใช้ไม่ได้ระบุ
  const dims: Record<string, number> = { ...model.standard, ...(cfg.dims ?? {}) };
  const options = new Set(cfg.options ?? []);
  // ตัวเลือกท้ายเลขรุ่นที่ใช้จริง ให้เงื่อนไขอ่านได้ — ขนาดเล็กสุดของแคตตาล็อกต่างกันระหว่าง BH-01 (ID 25) กับ BH-01C (ID 60)
  // ทั้งที่อยู่ในรุ่นเดียวกันของสมุด (เจ้าของเคาะ 2026-09-28) ⇒ ข้อห้ามต้องแยกได้ว่าใบนี้เป็นตัวเลือก C หรือไม่
  if (variant) options.add(VARIANT_OPTION_PREFIX + variant.suffix.toUpperCase());
  // รหัสย่อยที่ "เปิดกฎของรุ่น" (`B` ของ TS_-08 = หัวอลูมิเนียมใหญ่) — ต้องเข้า options ก่อน constraint
  // เพราะกฎห้ามอย่าง "2 element ต้องแกน 6 mm ขึ้นไป" อ่าน option ตัวเดียวกัน · เงินมาจากกฎเดิม ไม่ใช่จากแถวนี้
  for (const sc of subCodes) if (sc.effect === 'option' && sc.value) options.add(sc.value);
  // คิดตามรุ่นอื่น แต่รุ่นนั้นไม่มีกฎของตัวเลือกนี้ (Type T · NTC · หัก L ของ TS_-03 วัสดุ S → TSK-12) — ปล่อยไว้ = ราคาขาดส่วนนั้น
  // เงียบ ๆ ⇒ ยังไม่มีราคา (ขอราคา) · รุ่นของรหัสเองไม่ต้องตรวจ: ตัวอ่านรหัสเปิดเฉพาะตัวเลือกที่รุ่นมีกฎอยู่แล้ว (`hasOptionAdder`)
  const orphanOptions = model === own ? [] : [...options].filter(
    (o) => !o.startsWith(SUBCODE_PREFIX) && !o.startsWith(VARIANT_OPTION_PREFIX) && !mentionsOption(model, o)
  );

  // ค่าที่คำนวณจากค่าอื่น ต้องมาก่อน constraint และก่อน adder เพราะทั้งคู่อ่านมันได้
  const derivedText: Record<string, string> = {};
  /** ค่าที่มีแถวสูตรตรงเงื่อนไขของใบนี้ (แม้ขนาดจะไม่ครบ) — ไว้แยก "สมุดยังไม่มีสูตร" ออกจาก "รหัสไม่บอกขนาด" */
  const derivedMatched = new Set<string>();
  for (const d of model.derivedDims ?? []) {
    // แถวที่มีเงื่อนไข (สูตรพื้นที่ตามรูปทรงของ BH-02) — ไม่ตรง = ไม่ใช่สูตรของใบนี้ ข้ามทั้งแถว
    if (d.when && !evalPredicate(d.when, axes, dims, options)) continue;
    // แถวไม่มีเงื่อนไขนับว่า "เป็นสูตรของใบนี้" ก็ต่อเมื่อใบนี้มีขนาดที่มันใช้ — สูตรทรงกระบอกของ BH-01 ไม่ใช่สูตรของแผ่น BH-02
    if (d.when || d.args.every((a) => dims[a] !== undefined)) derivedMatched.add(d.name);
    const v = computeDerived(d, dims);
    if (v === undefined) continue;
    dims[d.name] = v.value;
    derivedText[d.name] = v.text;
  }

  // ── วิธีคิดทีละขั้น ①: ค่าที่ใช้คิด และมาจากไหน ──────────────────────────────
  const inputs: TraceInput[] = [];
  const axisKeys = new Set([
    ...(model.base.kind === 'matrix' ? model.base.axes : []),
    ...Object.keys(axes),
    ...pendingAxes,
    ...Object.keys(cfg.unread ?? {}),
  ]);
  for (const k of axisKeys) {
    const waiting = pending.find((s) => s.effect === 'setAxis' && s.axis === k);
    const unreadText = cfg.unread?.[k];
    const origin: TraceOrigin = waiting ? 'missing' : setBy[k] ? 'sub' : k in given ? 'code' : defaultedBy[k] ? 'default' : 'missing';
    inputs.push({
      origin,
      kind: 'axis',
      key: k,
      label: axisLabel(k),
      value: waiting ? 'ยังไม่กำหนด' : axes[k] ?? (unreadText !== undefined ? `"${unreadText}" — ยังไม่ได้กำหนด` : 'ไม่ได้ระบุ'),
      from: waiting
        ? `รหัสย่อย ${waiting.subCode} — ยังไม่ได้กำหนดว่าเท่ากับค่าไหน`
        : setBy[k]
          ? `รหัสย่อย ${setBy[k]}`
          : k in given
            ? cfg.askPrice?.[k] !== undefined && cfg.askPrice[k] === axes[k] ? 'ระบุในรหัส — นอกแคตตาล็อก' : 'ระบุในรหัส'
            : defaultedBy[k]
              ? `${defaultedBy[k]} — รหัสไม่ได้ระบุ`
              : unreadText !== undefined ? 'รหัสเขียนมาแต่ยังไม่ได้กำหนดว่าหมายถึงอะไร' : 'รหัสไม่ได้ระบุ',
    });
  }
  for (const [k, v] of Object.entries(dims)) {
    const std = model.standard[k];
    const typed = !!cfg.dims && k in cfg.dims;
    inputs.push({
      origin: derivedText[k] ? 'calc' : typed ? (cfg.offCode?.includes(k) ? 'offCode' : 'code') : 'default',
      ...(typed && !derivedText[k] && std !== undefined ? { std: fmt(std) } : {}),
      kind: 'dim',
      key: k,
      label: dimLabel(k),
      value: fmt(v),
      from: derivedText[k]
        ? `คำนวณ: ${derivedText[k]}`
        : cfg.dims && k in cfg.dims
          ? `${cfg.offCode?.includes(k) ? OFF_CODE : 'ระบุในรหัส'}${std !== undefined ? ` (มาตรฐานของรุ่น ${fmt(std)})` : ''}`
          : 'มาตรฐานของรุ่น — รหัสไม่ได้ระบุ (รวมอยู่ในราคาตั้งแล้ว)',
    });
  }
  for (const o of options) {
    if (o.startsWith(SUBCODE_PREFIX)) continue;
    const by = subCodes.find((sc) => sc.effect === 'option' && sc.value === o);
    const off = !by && !!cfg.offCode?.includes(o);
    inputs.push({
      kind: 'option', key: o, label: optionLabel(o), value: 'มี',
      from: by ? `รหัสย่อย ${by.subCode}` : off ? OFF_CODE : 'ระบุในรหัส',
      origin: by ? 'sub' : off ? 'offCode' : 'code',
    });
  }

  // ยังไม่มีราคา = ต้องขอราคา ไม่ใช่บล็อก — ราคาที่เหลือยังคิดต่อ (เจ้าของสั่ง 2026-10-05)
  const violations: Violation[] = pending.map((s) => ({
    id: 'SUBCODE_PENDING:' + s.subCode,
    level: 'quoteOnRequest' as const,
    noRate: true,
    message: `${s.reads || s.subCode} (${s.subCode}): ยังไม่มีราคา — ${
      s.effect === 'setAxis' ? `ยังไม่ได้กำหนดว่าคิดราคาเท่า${axisLabel(s.axis ?? '')}ไหน` : 'ยังไม่ได้ใส่จำนวนเงิน'
    } (ตั้งที่ตารางรหัสย่อย)`,
  }));
  for (const o of orphanOptions) {
    violations.push({
      id: 'PRICE_AS_OPTION:' + o,
      level: 'quoteOnRequest',
      noRate: true,
      message: `${optionLabel(o)}: ยังไม่มีราคา — ใบนี้คิดตามตาราง ${model.code} ซึ่งไม่มีราคาส่วนนี้ (ต้องขอราคาจากฝ่ายผลิต)`,
    });
  }
  const checks: TraceCheck[] = [];
  for (const c of model.constraints) {
    if (c.disabled) continue;
    const hit = evalPredicate(c.when, axes, dims, options);
    checks.push({
      message: c.message, hit, level: c.level, condition: describePredicate(c.when, axes, dims, options),
      ...checkVerdict(c.when, axes, dims, options), source: c.source,
    });
    if (hit) {
      violations.push({ id: c.id, level: c.level, message: c.message });
    }
  }

  // ข้อจำกัดที่แคตตาล็อกเขียนเป็นประโยค (Titanium เฉพาะ S4 …) — ต้องขอราคา ราคาเท่าที่คิดได้คิดต่อ (เจ้าของ 2026-10-09)
  // `level: 'warn'` = เตือนอย่างเดียว ราคาคิดตามปกติ (Excel มีราคาให้ · เจ้าของ 2026-10-09)
  for (const l of cfg.catalogLimits ?? []) {
    const level = l.level ?? 'quoteOnRequest';
    const message = level === 'warn'
      ? `${l.message} — รหัสนี้อยู่นอกที่แคตตาล็อกเขียนไว้ คิดราคาตาม Excel ควรยืนยันกับฝ่ายผลิต`
      : `${l.message} — รหัสนี้อยู่นอกข้อจำกัดของแคตตาล็อก ต้องขอราคาจากฝ่ายผลิต`;
    checks.push({
      message, hit: true, level, condition: 'อ่านจากช่องของรหัส',
      verdict: 'hit', note: 'อ่านจากช่องของรหัส', source: l.source,
    });
    violations.push({ id: 'CATALOG_LIMIT:' + l.id, level, message });
  }

  const breakdown: BreakdownLine[] = [];
  let running = 0;

  // "ราคาตั้งต้นของตัวเอง" — รุ่นพิเศษที่ราคาไม่ได้อิงตาราง ⇒ ทิ้งตารางไปเลย ไม่ใช่บวกทับ
  const ownBase = subCodes
    .filter((s) => s.effect === 'basePrice')
    .sort((x, y) => (x.order ?? 50) - (y.order ?? 50));
  if (ownBase.length > 1) {
    violations.push({
      id: 'SUBCODE_BASE_CONFLICT',
      level: 'warn',
      message: `รหัสย่อยที่ตั้งราคาตั้งต้นมีมากกว่าหนึ่งตัว (${ownBase.map((s) => s.subCode).join(' · ')}) — ใช้ตัวที่ลำดับน้อยที่สุด`
    });
  }
  const base: BaseResult = ownBase[0]
    ? {
        ok: true,
        amount: money(ownBase[0].amount ?? 0),
        label: `ราคาตั้งต้นจากรหัสย่อย ${ownBase[0].subCode}`,
        detail: ownBase[0].reads,
        why: `รหัสย่อย ${ownBase[0].subCode} ตั้งราคาเอง — ไม่ใช้ตารางราคาตั้ง`,
        steps: [
          `รหัสย่อย ${ownBase[0].subCode} (${ownBase[0].reads}) ตั้งราคาตั้งต้นเอง = ${fmt(money(ownBase[0].amount ?? 0))} บาท — ไม่ใช้ตารางราคาตั้ง`,
        ],
      }
    : computeBase(model, book, axes, dims, new Set([model.code]), cfg.unread, cfg.catalogOnly, cfg.askPrice);
  const baseWaits = model.base.kind === 'matrix' && model.base.axes.some((a) => pendingAxes.has(a));
  const traceBase: TraceBase = {
    // หาไม่ได้ = computeBase ตั้งชื่อกลาง ๆ ว่า "ฐานราคา" — การ์ดเรียกแถวนี้ว่าราคาตั้งเหมือนตอนหาได้ (คนอ่านไม่ต้องรู้สองชื่อ)
    ok: base.ok, label: base.ok ? base.label : `ราคาตั้ง ${model.code}`, why: base.why ?? '',
    steps: [...(model !== own ? [cfg.priceAs!.why] : []), ...base.steps],
  };
  if (!base.ok && baseWaits) {
    // ราคาตั้งหาไม่ได้เพราะรหัสย่อยยังไม่ได้บอกค่าของแกนตาราง — ข้อความ "ยังไม่มีราคา" ข้างบนบอกครบแล้ว
    traceBase.why = 'รอรหัสย่อยกำหนดค่าของแกนในตาราง';
    traceBase.steps.push('ยังหาราคาตั้งไม่ได้ — รอรหัสย่อยกำหนดค่าของแกนในตาราง (ดู "ค่าที่ใช้คิด")');
  } else if (!base.ok) {
    // ปริมาณที่ตารางช่วงราคาต้องใช้ (พื้นที่) คิดไม่ได้ — สองสาเหตุที่คนละคำตอบกับลูกค้า และ **ไม่ใช่ "ไม่รับผลิต"**:
    // ไม่มีแถวสูตรที่ตรงกับใบนี้เลย (เช่นรูปทรงที่สมุดยังไม่มีสูตร) = ยังไม่มีราคา · มีสูตรแต่ขนาดไม่ครบ = รหัสบอกไม่ครบ
    const q = model.base.kind === 'banded' ? model.base.quantity : '';
    if (q && dims[q] === undefined && (model.derivedDims ?? []).some((d) => d.name === q)) {
      const shape = axes.shape ? ` (${axisLabel('shape')} ${axes.shape})` : '';
      if (!derivedMatched.has(q)) {
        base.noRate = true;
        base.reason = `สมุดราคายังไม่มีสูตร${dimLabel(q)}ของใบนี้${shape} — ตั้งที่ "ค่าที่ระบบคิดให้เอง" ของรุ่น ${model.code}`;
      } else {
        base.missing = true;
        base.reason = `รหัสไม่ได้บอกขนาดที่ใช้คิด${dimLabel(q)}${shape}`;
      }
    }
    traceBase.why = base.reason ?? 'ไม่มีราคาฐาน';
    traceBase.steps.push(`หาราคาตั้งไม่ได้: ${base.reason ?? 'ไม่มีราคาฐาน'}`);
    violations.push({
      id: base.quote ? 'ASK_PRICE' : 'NO_BASE_PRICE',
      level: base.quote || base.noRate ? 'quoteOnRequest' : 'block',
      message: base.reason ?? 'ไม่มีราคาฐาน',
      ...(base.missing ? { missing: true } : {}),
      ...(base.noRate ? { noRate: true } : {}),
      ...(base.quote ? { askPrice: true } : {}),
    });
  } else {
    running = base.amount;
    const baseAxes = !ownBase[0] && model.base.kind === 'matrix' ? model.base.axes : [];
    const fromDefault = baseAxes.filter((a) => defaultedBy[a])
      .map((a) => `${axisLabel(a)} ${axes[a]} = ${defaultedBy[a]} — รหัสไม่ได้ระบุ`);
    // คิดตามรุ่นอื่น — บรรทัดราคาตั้งต้องบอกเอง (หมายเหตุใน PDF/จอเห็นแค่บรรทัดนี้ ไม่เห็นวิธีคิดทีละขั้น)
    const plain = fromDefault.length ? [base.detail, `(${fromDefault.join(' · ')})`].filter(Boolean).join(' ') : base.detail;
    const detail = model !== own ? [plain, `(รหัส ${own.code} — คิดตามตาราง ${model.code})`].filter(Boolean).join(' ') : plain;
    breakdown.push({ step: 'base', label: base.label, detail, amount: base.amount, running });
    traceBase.amount = base.amount;
    // ช่องที่แอดมินเพิ่มเอง (นอกแคตตาล็อก) มีราคาแล้ว — คิดได้ แต่ต้องบอกว่าราคามาจากไหน (ไม่ใช่ของ Excel)
    for (const a of baseAxes.filter((x) => cfg.askPrice?.[x] !== undefined && cfg.askPrice[x] === axes[x])) {
      violations.push({ id: `ASK_PRICE_SET:${a}`, level: 'warn', askPrice: true, message: `${axisLabel(a)} ${axes[a]} ไม่อยู่ในแคตตาล็อก — ใช้ราคาที่แอดมินใส่ในสมุดราคา` });
    }
    const std = Object.entries(model.standard);
    if (std.length && !ownBase[0]) {
      traceBase.steps.push(
        `ราคาตั้งรวมสเปกมาตรฐานไว้แล้ว: ${std.map(([k, v]) => `${dimLabel(k)} ${fmt(v)}`).join(' · ')} — ส่วนที่เกินคิดเพิ่มในแถวถัดไป`
      );
    }
  }

  // ค่านอกแคตตาล็อกของแกนที่ไม่ใช่แกนของตารางราคาตั้ง (ขนาดแกนของ TS_-01 = อัตราของกฎความยาวแกน) — ยังไม่มีอัตรา
  // = ทั้งชิ้นต้องขอราคา แม้ใบนี้จะไม่ยาวเกินมาตรฐาน (เจ้าของเคาะ B#2: "แกนขนาดอื่นให้ขอราคา") · มีอัตราที่แอดมินเพิ่มแล้ว = เตือน
  const baseAxisSet = new Set(model.base.kind === 'matrix' ? model.base.axes : []);
  for (const [a, v] of Object.entries(cfg.askPrice ?? {})) {
    if (baseAxisSet.has(a) || axes[a] !== v) continue;
    const rated = model.adders.some((x) => !x.disabled && x.byAxis === a && x.rates?.[v] !== undefined);
    violations.push(rated
      ? { id: `ASK_PRICE_SET:${a}`, level: 'warn', askPrice: true, message: `${axisLabel(a)} ${v} ไม่อยู่ในแคตตาล็อก — ใช้อัตราที่แอดมินใส่ในสมุดราคา` }
      : { id: `ASK_PRICE:${a}`, level: 'quoteOnRequest', askPrice: true, message: `${axisLabel(a)} ${v} ไม่อยู่ในแคตตาล็อก — ต้องขอราคาจากฝ่ายผลิต` });
  }

  // ── วิธีคิดทีละขั้น ③: กฎบวกเพิ่มทุกข้อ รวมข้อที่ไม่ได้คิด ────────────────────
  const rules: TraceRule[] = [];

  // ราคาตั้งต้องขอจากฝ่ายผลิต (ค่านอกแคตตาล็อก) — กฎบวกเพิ่มยังคิดต่อ ให้หน้าจอแสดง "ราคาเท่าที่คิดได้" ไปก่อน
  // (เจ้าของสั่ง 2026-10-01) · สถานะยังเป็น `quoteOnRequest` · กฎแบบ % รอราคาตั้ง (คิดจากยอดสะสมไม่ได้)
  // ตารางยังไม่มีราคา (`noRate`) ก็ทางเดียวกัน (เจ้าของสั่ง 2026-10-05) · รหัสบอกไม่ครบ ยังไม่คิดกฎเหมือนเดิม
  const askBase = !base.ok && (!!base.quote || !!base.noRate) && !base.missing;
  if (base.ok || askBase) {
    // `disabled` ถูกกรองทิ้งตรงนี้ ไม่ใช่ตอนโหลดสมุดราคา — เพื่อให้กฎที่ปิดไว้ยังอยู่ในสมุด
    // (ส่งออกไป Excel แล้วยังเห็น เปิดกลับมาใช้ได้) แค่ไม่มีผลกับราคา
    const fromSubCodes = subCodes
      .filter((s) => s.effect === 'flat' || s.effect === 'percent' || s.effect === 'perUnit')
      .filter((s) => !pending.includes(s))
      .map(subCodeAsAdder);
    // กฎที่ปิดไว้ยังเข้าคิว — แค่เพื่อให้วิธีคิดทีละขั้นบอกได้ว่า "มีกฎนี้ แต่ปิดอยู่" (ไม่มีผลกับเงิน)
    const ordered = [
      ...model.adders.map((a) => withVariantPrice(a, variant)),
      ...fromSubCodes,
      ...(variant ? [variantAdder(variant)] : [])
    ]
      .sort((x, y) => x.order - y.order);
    for (const a of ordered) {
      const cells = sheetCells(a.source);
      const tr: TraceRule = { id: a.id, label: a.label, status: 'applied', steps: [], ...(a.source ? { source: a.source } : {}), ...(cells ? { cells } : {}) };
      rules.push(tr);
      if (a.disabled) {
        tr.status = 'off';
        tr.reason = 'ปิดไว้ในสมุดราคา — ไม่มีผลกับราคา';
        continue;
      }
      if (a.when) {
        const hit = evalPredicate(a.when, axes, dims, options);
        tr.steps.push(`${hit ? 'ใช้กฎนี้เพราะ' : 'ไม่ใช้กฎนี้เพราะไม่ตรงเงื่อนไข'}: ${describePredicate(a.when, axes, dims, options)}`);
        if (!hit) {
          tr.status = 'skipped';
          // ตัวเลือกที่ใบนี้ไม่มี (หัก L · Type T · ออกน็อต) คือการข้ามส่วนใหญ่ — การ์ดรวมเป็นชิปบรรทัดเดียว
          const optionMissOnly = optionOnly(a.when);
          tr.skip = optionMissOnly ? 'notInCode' : 'other';
          tr.reason = optionMissOnly ? optionMiss(a.when, axes, dims, options) : 'ไม่ตรงเงื่อนไขของกฎนี้';
          continue;
        }
      }
      if (askBase && a.kind === 'percent') {
        tr.status = 'waiting';
        tr.reason = 'คิดเป็นเปอร์เซ็นต์ของยอดสะสม — รอราคาตั้งจากฝ่ายผลิต';
        continue;
      }
      if (variant?.adderPrices?.[a.id] !== undefined) {
        tr.steps.push(`ใช้ราคาของตัวเลือก ${variant.suffix} (${variant.label}) แทนราคาของรุ่นหลัก`);
      }
      const r = computeAdder(a, model, running, axes, dims, cfg.unread, rules.some((x) => x !== tr && x.status === 'applied') ? 'ยอดก่อนหน้า' : 'ราคาตั้ง');
      tr.steps.push(...r.steps);
      if (r.partial) {
        violations.push({ id: a.id, level: 'warn', message: r.partial, partial: true });
        tr.status = 'waiting';
        tr.reason = r.partial;
        continue;
      }
      // ค่านอกแคตตาล็อกที่กฎนี้ยังไม่มีอัตรา — ฟ้อง "ต้องขอราคา" ไปแล้วข้างบน ไม่ใช่ "ไม่รับผลิต/ยังไม่มีราคา"
      if (r.noRate && a.byAxis && cfg.askPrice?.[a.byAxis] !== undefined && cfg.askPrice[a.byAxis] === axes[a.byAxis]) {
        tr.status = 'waiting';
        tr.reason = `${axisLabel(a.byAxis)} ${axes[a.byAxis]} ไม่อยู่ในแคตตาล็อก — ต้องขอราคาจากฝ่ายผลิต`;
        continue;
      }
      // แกนที่รอรหัสย่อยกำหนดค่า — ฟ้องไปแล้วครั้งเดียวข้างบน ไม่ต้องขึ้น "รหัสไม่ได้บอก" ซ้ำ
      if (r.missing && a.byAxis && pendingAxes.has(a.byAxis)) {
        tr.status = 'waiting';
        tr.reason = `รอรหัสย่อยกำหนด${axisLabel(a.byAxis)}`;
        continue;
      }
      // ราคาตั้งรอฝ่ายผลิตอยู่แล้ว — กฎที่คิดไม่ได้ (เช่นสายตั้งต้นที่ขึ้นกับหัววัดนอกแคตตาล็อก) ห้ามเปลี่ยนผลเป็น "ไม่รับผลิต"
      // เดิมกฎไม่ถูกคิดเลยในกรณีนี้ ⇒ เหลือแค่บอกว่ายังไม่รวม
      if (r.blocked && askBase) {
        violations.push({ id: a.id, level: 'warn', message: r.blocked, partial: true });
        tr.status = 'waiting';
        tr.reason = r.blocked;
        continue;
      }
      // กฎนี้ยังไม่มีอัตรา/จำนวนเงิน = ต้องขอราคา ไม่ใช่บล็อก — ข้ามข้อนี้แล้วคิดข้อที่เหลือต่อ (เจ้าของสั่ง 2026-10-05)
      if (r.blocked && r.noRate) {
        violations.push({ id: a.id, level: 'quoteOnRequest', message: r.blocked, noRate: true });
        tr.status = 'waiting';
        tr.reason = r.blocked;
        continue;
      }
      if (r.blocked) {
        violations.push({
          id: a.id, level: 'block', message: r.blocked,
          ...(r.missing ? { missing: true } : {}), ...(r.noRate ? { noRate: true } : {}),
        });
        tr.status = 'blocked';
        tr.reason = r.blocked;
        continue;
      }
      if (r.skip || r.amount === 0) {
        tr.status = 'skipped';
        tr.skip = r.withinStd ? 'withinStd' : 'other';
        tr.reason = r.why ?? 'คิดได้ 0 บาท';
        continue;
      }
      running = money(running + r.amount);
      tr.amount = r.amount;
      tr.running = running;
      // ราคาของตัวเลือกท้ายเลขรุ่นที่ทับราคารุ่นหลัก — บอกในบรรทัดเดียวด้วย ไม่งั้น "ทำไมออกน็อตแพงกว่ารุ่นหลัก" ต้องกางดู
      const viaVariant = variant?.adderPrices?.[a.id] !== undefined ? `ราคาของ${variant.label}` : '';
      const summary = [r.summary, viaVariant].filter(Boolean).join(' · ');
      if (summary) tr.why = summary;
      // บอกให้เห็นว่าอัตรานี้มาจากค่าเริ่มต้น ไม่ใช่จากรหัส — "ทำไมคิดสายสแตนเลส" ต้องตอบได้จากหน้าจอ
      const from = a.byAxis && defaultedBy[a.byAxis]
        ? `${axes[a.byAxis]} (${defaultedBy[a.byAxis]} — รหัสไม่ได้ระบุ)`
        : '';
      const detail = from ? [r.detail, from].filter(Boolean).join(' · ') : r.detail;
      breakdown.push({ step: a.kind, label: a.label, detail, amount: r.amount, running });
    }
  }
  // แถวรหัสย่อยที่ยังไม่มีเงิน ไม่ได้เข้าคิวคิดเงิน (ห้ามเป็น +0) — แต่ต้องโผล่ในวิธีคิดให้เห็นว่ารออยู่
  for (const sc of pending) {
    if (sc.effect !== 'flat') continue;
    rules.push({
      id: 'sub:' + sc.subCode,
      label: `${sc.reads || sc.subCode} (${sc.subCode})`,
      status: 'waiting',
      reason: 'ยังไม่ได้ใส่จำนวนเงินในตารางรหัสย่อย',
      steps: [],
    });
  }

  const blocked = violations.some((v) => v.level === 'block');
  const needsQuote = violations.some((v) => v.level === 'quoteOnRequest');

  return {
    status: blocked ? 'notManufacturable' : needsQuote ? 'quoteOnRequest' : 'priced',
    model: model.code,
    variant: variant?.suffix,
    unitPrice: blocked ? 0 : running,
    breakdown,
    violations,
    bookVersion: book.version,
    trace: { inputs, base: traceBase, rules, checks },
  };
}

// ── แสดงผลเป็นข้อความ (ใช้ได้ทั้ง CLI · หมายเหตุ PDF · หน้าจอ) ───────────────

export function formatOutcome(o: PriceOutcome): string {
  const lines: string[] = [];
  const width = 62;
  lines.push(`รุ่น ${o.model}${o.variant ? ` (ตัวเลือก ${o.variant})` : ''}   [สมุดราคา ${o.bookVersion}]`);
  lines.push('─'.repeat(width));
  for (const b of o.breakdown) {
    const amt = fmt(b.amount).padStart(11);
    lines.push(`  ${b.label.padEnd(34).slice(0, 34)} ${amt}`);
    if (b.detail) lines.push(`    ↳ ${b.detail}`);
  }
  lines.push('─'.repeat(width));
  const status =
    o.status === 'priced' ? '' : o.status === 'quoteOnRequest' ? '  ← ต้องขอราคา' : '  ← ไม่รับผลิต';
  lines.push(`  ${'ราคาตั้งต่อหน่วย'.padEnd(34)} ${fmt(o.unitPrice).padStart(11)}${status}`);
  for (const v of o.violations) {
    const tag = v.level === 'block' ? '✗' : v.level === 'quoteOnRequest' ? '?' : '!';
    lines.push(`  ${tag} ${v.message}`);
  }
  return lines.join('\n');
}

/** วิธีคิดทีละขั้นเป็นข้อความ — ให้ CLI (`pricebook:calc --code`) พิมพ์ชุดเดียวกับที่หน้าจอเห็น */
export function formatTrace(o: PriceOutcome): string {
  const t = o.trace;
  if (!t) return '';
  const STATUS: Record<string, string> = {
    applied: 'คิด', skipped: 'ไม่คิด', blocked: 'คิดไม่ได้', waiting: 'ยังไม่รวม', off: 'ปิดไว้',
  };
  const lines: string[] = ['วิธีคำนวณราคา', '', '① ค่าที่ใช้คิด'];
  for (const i of t.inputs) lines.push(`   ${i.label} = ${i.value}   ← ${i.from}`);
  lines.push('', `② ${t.base.label}${t.base.amount !== undefined ? ` = ${fmt(t.base.amount)}` : ''}${t.base.why ? `   (${t.base.why})` : ''}`);
  for (const s of t.base.steps) lines.push(`   · ${s}`);
  lines.push('', '③ กฎบวกเพิ่ม (ตามลำดับที่คิด)');
  if (!t.rules.length) lines.push('   (ไม่ได้ตรวจ — ยังหาราคาตั้งไม่ได้)');
  t.rules.forEach((r, n) => {
    const money = r.amount !== undefined ? `  +${fmt(r.amount)} → ยอดสะสม ${fmt(r.running ?? 0)}` : '';
    lines.push(`   ${n + 1}. [${STATUS[r.status]}] ${r.label}${money}`);
    for (const s of r.steps) lines.push(`        · ${s}`);
    if (r.reason) lines.push(`        ⇒ ${r.reason}`);
    if (r.source) lines.push(`        ที่มา: ${r.source}`);
  });
  if (t.checks.length) {
    lines.push('', '④ ข้อห้ามที่ตรวจ');
    const MARK = { hit: '✗ ติด', pass: '✓ ผ่าน', na: '– ไม่เกี่ยว' } as const;
    for (const c of t.checks) lines.push(`   ${MARK[c.verdict]} ${c.message} — ${c.verdict === 'hit' ? c.condition : c.note}`);
  }
  return lines.join('\n');
}
