// ─────────────────────────────────────────────────────────────────────────────
//  หน้าจอ "แก้ราคาทีละรุ่น" — แปลงรุ่นหนึ่งไป-กลับระหว่างสมุดราคากับหน้าจอ
//
//  โมดูล "คิดราคาสินค้า" — ถอดออกได้ทั้งก้อน ดู services/pricingLab/README.md
//
//  เจ้าของสั่ง 2026-09-23: เอาแบบที่เคาะไว้ใน mockup ชุด pe-* มาใส่ของจริง — เริ่มที่ซีรีส์ BH
//  แอดมินต้องแก้ได้ทั้ง "ตัวเลข" และ "โครง" (เพิ่ม/ลบช่วงขนาด · เพิ่ม/ลบของแถมฝั่งตัวเลือก
//  · เพิ่ม/แก้เงื่อนไข/ลบกฎบวกเพิ่ม) จากหน้าจอ โดยไม่ต้องดาวน์โหลด Excel
//
//  ── สองอย่างที่ไฟล์นี้ตั้งใจไม่ให้แก้จากหน้าจอ ────────────────────────────────
//   · `derivedDims` (สูตรพื้นที่ผิว ฯลฯ) — พังแล้วทั้งรุ่นคิดราคาไม่ออก ไม่ใช่แค่ราคาเพี้ยน
//   · `constraints` แก้ได้แค่ "เปิด/ปิด" — มันคือด่านกันเสนอของที่ผลิตไม่ได้
//     เปิดให้แก้ข้อความ/เงื่อนไขเมื่อไหร่ ด่านความปลอดภัยจะกลายเป็นช่องพิมพ์อิสระ
//
//  ── ทำไม `when` ที่รับจากหน้าจอถึงต้องถูกตรวจทีละแบบ ─────────────────────────
//  `Predicate` ตั้งใจให้เล็กและปิด (ดู types.ts) หน้าจอจึงมีแค่ช่องเลือก ไม่มีช่องพิมพ์สูตร
//  แต่ **หน้าจอไม่ใช่ด่าน** — ใครยิง API ตรงได้ก็ส่งอะไรมาก็ได้ ⇒ ตัวรับต้องประกอบเงื่อนไข
//  ขึ้นใหม่จากค่าที่รู้จักเท่านั้น ไม่ใช่ `JSON.parse` แล้วยัดลงสมุดราคา
// ─────────────────────────────────────────────────────────────────────────────

import { AXIS_TH, DIM_TH, KIND_TH, OPTION_TH, axisLabel, dimLabel, displayName } from './labels.js';
import type { Adder, Band, ModelVariant, Money, Predicate, PriceBook, PriceModel, SheetLayout } from './types.js';

// ── ที่หน้าจออ่าน ────────────────────────────────────────────────────────────

export interface EditorBand {
  min: number;
  max: number | null;
  /** 'flat' = เหมาทั้งช่วง · 'rate' = ต่อหนึ่งหน่วยของปริมาณนั้น */
  kind: 'flat' | 'rate';
  price: Money | null;
  label: string;
}

export interface EditorAdder {
  id: string;
  label: string;
  order: number;
  kind: Adder['kind'];
  kindTh: string;
  when: Predicate | null;
  whenTh: string;
  amount: Money | null;
  percent: number | null;
  rate: Money | null;
  dim: string | null;
  dimTh: string | null;
  over: number | null;
  step: number | null;
  times: number | null;
  unit: string;
  /** อัตราที่ต่างกันตามค่าแกน — หน้าจอแก้ได้ทีละค่า แต่เพิ่ม/ลบค่าแกนไม่ได้ */
  byAxis: string | null;
  byAxisTh: string | null;
  /** `rate: null` = ค่าแกนที่สมุดรู้จักแต่ยังไม่มีราคา (ช่องว่างในชีต) — ใส่เลขแล้วบันทึกได้ */
  rates: { value: string; rate: Money | null }[] | null;
  disabled: boolean;
  custom: boolean;
  note: string;
  source: string;
}

export interface EditorView {
  code: string;
  /** ชื่อที่ขึ้นจอ (`BH-01` → `BH-01,02`) — `code` ยังเป็นตัวที่ส่งกลับมาตอนบันทึก */
  name: string;
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
        /** ค่าแกนแรก (แถว) / แกนที่สอง (คอลัมน์) ตามลำดับในชีต — มีเฉพาะตารางสองแกน */
        rows: string[];
        cols: string[];
        /** `cells[แถว][คอลัมน์]` · `null` = ช่องว่างในชีต = ไม่รับผลิต (ไม่ใช่ 0) · ตารางสามแกน = `null` ทั้งก้อน */
        cells: (Money | null)[][] | null;
      }
    | { kind: 'ref'; model: string };
  /**
   * ชื่อหัวตารางแบบที่ชีตเขียน (`TS_-01`) — ชีตใช้ `_` แทนตัวอักษรหัววัด เพราะหนึ่งตารางครอบ TSK/TSJ/TST/…
   * ไม่มีชื่อพ้องแบบนั้น = ใช้ `name`
   */
  title: string;
  /**
   * true = รุ่นนี้วางบนจอแบบชีต Excel ได้ครบทุกช่อง (หน้า "สมุดรายชีต" · `SheetEditor.tsx`)
   * เกณฑ์อยู่ที่ `excelReady()` ที่เดียว
   */
  excel: boolean;
  /**
   * หน้าตาของชีตรอบตาราง (แสดงผลอย่างเดียว ไม่มีราคา) — อ่านแบบกันพังเสมอ เพราะ `modelShape.ts`
   * ปล่อยช่องนี้ผ่านโดยไม่ตรวจ (engine ไม่อ่าน) ⇒ ของเสียในฐานต้องไม่ทำให้จอพัง
   */
  layout: { rowNote: { label: string; values: Record<string, string> } | null; colNotes: Record<string, string>; highlightCols: string[] };
  /**
   * ค่าเริ่มต้นที่ขึ้นกับอีกแกน (`axisDefaultsBy`) — **มีผลกับราคา** · หน้าสมุดรายชีตวางเป็นคอลัมน์ท้ายตาราง
   * `options` = ค่าที่เลือกได้ (คีย์ของอัตราตามแกนนั้น) — เลือกนอกรายการไม่ได้ เพราะเติมแล้วจะหาราคาไม่เจอ
   */
  defaultsBy: { axis: string; axisTh: string; by: string; label: string; values: Record<string, string>; options: string[] }[];
  variant: (ModelVariant & { covers: string[] }) | null;
  adders: EditorAdder[];
  constraints: { id: string; level: string; levelTh: string; message: string; whenTh: string; disabled: boolean }[];
  derived: { name: string; label: string; argsTh: string; consts: string }[];
  /** คำศัพท์ให้ช่องเลือกในกล่อง "แก้กฎ" — รายการปิด ไม่ใช่ช่องพิมพ์อิสระ */
  vocab: {
    options: { key: string; label: string }[];
    dims: { key: string; label: string }[];
    axes: { key: string; label: string }[];
    kinds: { key: string; label: string }[];
  };
}

const LEVEL_TH: Record<string, string> = {
  block: 'ไม่รับผลิต',
  quoteOnRequest: 'ต้องขอราคา',
  warn: 'เตือน'
};

/**
 * หน่วยของปริมาณที่ตารางช่วงใช้ — ชีต BH เขียนหัวคอลัมน์ไว้เองว่า `Size (Inch)`
 * ไม่ได้เดาจากชื่อคีย์ แต่ก็ไม่ได้เก็บไว้ในสมุดราคา ⇒ แปลจากชื่อ dim ที่รู้จักเท่านั้น
 * ไม่รู้จัก = คืนคำกลาง ไม่ใช่ค่าว่าง (เหตุผลเดียวกับ labels.ts)
 */
const QUANTITY_UNIT: Record<string, string> = { area_in2: 'Inch' };

function whenToText(p: Predicate | undefined): string {
  if (!p || 'always' in p) return 'ทุกกรณี';
  if ('all' in p) return p.all.map(whenToText).join(' และ ');
  if ('any' in p) return p.any.map(whenToText).join(' หรือ ');
  if ('not' in p) return 'ไม่ใช่กรณี ' + whenToText(p.not);
  if ('option' in p) return `ลูกค้าติ๊ก “${OPTION_TH[p.option] ?? p.option}”`;
  if ('in' in p) return `${axisLabel(p.axis)} = ${p.in.map((v) => v || '(ว่าง)').join(' หรือ ')}`;
  if ('notIn' in p) return `${axisLabel(p.axis)} ไม่ใช่ ${p.notIn.map((v) => v || '(ว่าง)').join(' หรือ ')}`;
  const parts: string[] = [];
  if (p.gt !== undefined) parts.push(`มากกว่า ${p.gt}`);
  if (p.gte !== undefined) parts.push(`ตั้งแต่ ${p.gte} ขึ้นไป`);
  if (p.lt !== undefined) parts.push(`น้อยกว่า ${p.lt}`);
  if (p.lte !== undefined) parts.push(`ไม่เกิน ${p.lte}`);
  return parts.length ? `${dimLabel(p.dim)} ${parts.join(' และ ')}` : dimLabel(p.dim);
}

/** ทุกรหัสที่ตัวเลือกนี้ครอบ = (รหัสรุ่น + ชื่อพ้อง) × ตัวอักษรท้ายรหัส */
function variantCovers(m: PriceModel, v: ModelVariant): string[] {
  return [m.code, ...(m.aliases ?? [])].map((c) => c + v.suffix);
}

// ── ตารางสองแกน (ซีรีส์ TS) ─────────────────────────────────────────────────

/** ตัวคั่นคีย์ของ `cells` — ต้องเป็นตัวเดียวกับที่ engine.ts ประกอบคีย์ */
const SEP = ' | ';

/**
 * ค่าของแต่ละแกนตามลำดับที่ปรากฏในคีย์ — คอลัมน์ `spec` เป็น `json` (ไม่ใช่ jsonb) ลำดับคีย์จึงเป็น
 * ลำดับที่ตัวนำเข้าอ่านจากชีต (ซ้ายไปขวา บนลงล่าง)
 * ⚠️ แถวที่ว่างทั้งแถวในชีต (เช่น D = "7TN" ของ TS-04) ไม่มีคีย์สักตัว ⇒ ไม่โผล่ที่นี่ และเพิ่มจากจอไม่ได้
 *    (ต้องไปทางแม่แบบ Excel) ซึ่งตรงกับกติกาเดิมว่า "เพิ่ม/ลบค่าแกนไม่ใช่งานของหน้าจอ"
 */
function matrixValues(cells: Record<string, Money>, axisCount: number): string[][] {
  const out: string[][] = Array.from({ length: axisCount }, () => []);
  const seen = out.map(() => new Set<string>());
  for (const k of Object.keys(cells)) {
    const parts = k.split(SEP);
    parts.forEach((v, i) => {
      if (i < axisCount && !seen[i]!.has(v)) {
        seen[i]!.add(v);
        out[i]!.push(v);
      }
    });
  }
  return out;
}

/**
 * ค่าแกนที่ "ช่องราคาแยกตามแกน" ของกฎหนึ่งข้อควรมี — ใช้ทั้งตอนแสดง (ช่องว่างให้กรอก) และตอนรับ
 *
 * เหตุที่ต้องมี: ช่องที่ลบเลขทิ้งแล้วบันทึก = คีย์หายจากสมุด (ถูก — ว่าง ≠ 0) แต่ถ้ารับเฉพาะคีย์ที่
 * "มีอยู่แล้ว" ช่องนั้นจะหายจากจอถาวร ใส่ราคาคืนไม่ได้อีกเลย ⇒ รุ่นที่เปิดแบบชีต (`excelReady`)
 * รู้จักค่าแกนจากกฎที่แยกตามแกนเดียวกันทั้งเล่ม (ชนิดสาย 4 ชนิดของ TS-21+22+25 ใช้ร่วมกันทุกรุ่น)
 *
 * **รุ่นอื่นยังรู้จักแค่คีย์ของตัวเอง** — ลองขยายแบบเดียวกันแล้ว (2026-09-24) กฎที่ใช้กับบางขนาดแกน
 * อย่าง "เคลือบเทฟลอน" ได้ช่องว่างเพิ่มถึง 32 ช่อง และหน้าแปลนสองมาตรฐานของ TS-18 ปนกัน
 * ⇒ จอยาวขึ้นและอ่านยากขึ้น ซึ่งคือสิ่งที่เจ้าของเพิ่งบอกว่า "งง"
 */
function knownRateKeys(book: PriceBook | undefined, m: PriceModel, a: Adder): string[] {
  const own = Object.keys(a.rates ?? {});
  if (!a.byAxis || !book || !excelReady(m)) return own;
  const keys = new Set(own);
  for (const other of Object.values(book.models)) {
    for (const x of other.adders) {
      if (x.byAxis === a.byAxis) for (const k of Object.keys(x.rates ?? {})) keys.add(k);
    }
  }
  return [...keys];
}

/**
 * รุ่นที่หน้า "สมุดรายชีต" วางแบบ Excel ได้ครบ — **ทุกอย่างที่รุ่นมีต้องมีที่อยู่บนจอนั้น**
 * ไม่งั้นจอจะดูครบทั้งที่มีกฎซ่อนอยู่ที่แก้ไม่ได้และมองไม่เห็น
 *   · ราคาตั้งเป็นตารางสองแกน
 *   · กฎบวกเพิ่มทุกข้อเป็น "ตามส่วนที่เกิน + ราคาแยกตามแกนที่ไม่ใช่แกนของตาราง" ไม่มีเงื่อนไข
 *     (= แถบหมายเหตุ "สายยาวกว่า 1 M บวกเพิ่มตามราคาสาย" ใต้ตาราง)
 *   · ไม่มีข้อจำกัด / ตัวเลือกท้ายรหัส / สูตรคำนวณ
 * เจ้าของสั่ง 2026-09-24 ให้เริ่มที่ชีต TS-01+TS-01-0 — ชีตอื่นขยายเกณฑ์นี้ทีละแบบ
 */
export function excelReady(m: PriceModel): boolean {
  if (m.base.kind !== 'matrix' || m.base.axes.length !== 2) return false;
  const axes = m.base.axes;
  if (m.constraints.length || m.variant || m.derivedDims?.length) return false;
  // ค่าเริ่มต้นตามแกน = คอลัมน์ท้ายตาราง ⇒ ต้องขึ้นกับแกนแถวเท่านั้น (ไม่งั้นไม่มีที่วางบนจอ)
  if (Object.values(m.axisDefaultsBy ?? {}).some((d) => d.by !== axes[0])) return false;
  return m.adders.every(
    (a) => a.kind === 'perUnit' && !a.when && !!a.byAxis && !axes.includes(a.byAxis) && !!a.rates,
  );
}

const strMap = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string') as [string, string][])
    : {};

function layoutView(L: SheetLayout | undefined): EditorView['layout'] {
  const rn = L?.rowNote;
  return {
    rowNote: rn && typeof rn === 'object'
      ? { label: typeof rn.label === 'string' ? rn.label : 'หมายเหตุ', values: strMap(rn.values) }
      : null,
    colNotes: strMap(L?.colNotes),
    highlightCols: Array.isArray(L?.highlightCols) ? L!.highlightCols.filter((x) => typeof x === 'string') : []
  };
}

/** ค่าที่ `axisDefaultsBy[axis]` เลือกได้ = คีย์ของอัตราในกฎที่แยกตามแกนนั้น (รุ่นแบบชีตรวมทั้งเล่ม — ดู `knownRateKeys`) */
function defaultOptions(book: PriceBook | undefined, m: PriceModel, axis: string): string[] {
  return [...new Set(m.adders.filter((a) => a.byAxis === axis).flatMap((a) => knownRateKeys(book, m, a)))];
}

/** `TSK-01` + ชื่อพ้อง `TS-01` → `TS_-01` (แบบที่หัวชีตเขียน) */
function sheetTitle(m: PriceModel, name: string): string {
  const generic = (m.aliases ?? []).find((a) => /^TS-/.test(a));
  return generic ? generic.replace(/^TS-/, 'TS_-') : name;
}

export function modelEditorView(book: PriceBook, m: PriceModel): EditorView {
  const base: EditorView['base'] =
    m.base.kind === 'banded'
      ? {
          kind: 'banded',
          quantity: m.base.quantity,
          quantityTh: dimLabel(m.base.quantity),
          unit: QUANTITY_UNIT[m.base.quantity] ?? 'หน่วย',
          bands: m.base.bands.map((b) => ({
            min: b.min,
            max: b.max,
            kind: b.flat === undefined && b.rate !== undefined ? ('rate' as const) : ('flat' as const),
            price: (b.flat ?? b.rate) ?? null,
            label: b.label ?? `${b.min} - ${b.max ?? 'ขึ้นไป'}`
          }))
        }
      : m.base.kind === 'ref'
        ? { kind: 'ref', model: m.base.model }
        : (() => {
            const { axes, cells } = m.base;
            const vals = matrixValues(cells, axes.length);
            const two = axes.length === 2;
            return {
              kind: 'matrix' as const,
              // หน้าแก้ทีละรุ่นยังไม่แก้ตารางนี้ — ชีตที่ `excel` เป็นจริงแก้ได้ที่หน้าสมุดรายชีต
              note: 'ตารางราคาแบบสองแกนยังแก้จากหน้านี้ไม่ได้ — ใช้ปุ่มดาวน์โหลดแม่แบบ Excel ไปก่อน',
              axes,
              axesTh: axes.map(axisLabel),
              rows: two ? vals[0]! : [],
              cols: two ? vals[1]! : [],
              cells: two
                ? vals[0]!.map((r) => vals[1]!.map((c) => cells[r + SEP + c] ?? null))
                : null
            };
          })();
  const name = displayName(m.code, m.aliases ?? []).name;

  return {
    code: m.code,
    name,
    title: sheetTitle(m, name),
    excel: excelReady(m),
    layout: layoutView(m.layout),
    defaultsBy: Object.entries(m.axisDefaultsBy ?? {}).map(([axis, d]) => ({
      axis,
      axisTh: axisLabel(axis),
      by: d.by,
      label: d.label ?? `${axisLabel(axis)}เริ่มต้น`,
      values: { ...d.values },
      options: defaultOptions(book, m, axis)
    })),
    label: m.label,
    sheet: m.sheet ?? '',
    aliases: m.aliases ?? [],
    standardTh: Object.entries(m.standard ?? {})
      .map(([k, v]) => `${dimLabel(k)} ${v}`)
      .join(' · '),
    base,
    variant: m.variant ? { ...m.variant, covers: variantCovers(m, m.variant) } : null,
    adders: [...m.adders]
      .sort((a, b) => a.order - b.order)
      .map((a) => ({
        id: a.id,
        label: a.label,
        order: a.order,
        kind: a.kind,
        kindTh: KIND_TH[a.kind] ?? a.kind,
        when: a.when ?? null,
        whenTh: whenToText(a.when),
        amount: a.amount ?? null,
        percent: a.percent ?? null,
        rate: a.rate ?? null,
        dim: a.dim ?? null,
        dimTh: a.dim ? dimLabel(a.dim) : null,
        over: a.over ?? null,
        step: a.step ?? null,
        times: a.times ?? null,
        unit: a.unit ?? '',
        byAxis: a.byAxis ?? null,
        byAxisTh: a.byAxis ? axisLabel(a.byAxis) : null,
        rates: a.rates
          ? knownRateKeys(book, m, a).map((value) => ({ value, rate: a.rates![value] ?? null }))
          : null,
        disabled: !!a.disabled,
        custom: !!a.custom,
        note: a.note ?? '',
        source: a.source ?? ''
      })),
    constraints: m.constraints.map((c) => ({
      id: c.id,
      level: c.level,
      levelTh: LEVEL_TH[c.level] ?? c.level,
      message: c.message,
      whenTh: whenToText(c.when),
      disabled: !!c.disabled
    })),
    derived: (m.derivedDims ?? []).map((d) => ({
      name: dimLabel(d.name),
      label: d.label,
      argsTh: d.args.map(dimLabel).join(' + '),
      consts: Object.entries(d.consts ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join(' · ')
    })),
    vocab: {
      options: Object.entries(OPTION_TH).map(([key, label]) => ({ key, label })),
      dims: Object.entries(DIM_TH).map(([key, label]) => ({ key, label })),
      axes: Object.entries(AXIS_TH).map(([key, label]) => ({ key, label })),
      kinds: (['flat', 'percent', 'perUnit'] as const).map((key) => ({ key, label: KIND_TH[key] ?? key }))
    }
  };
}

// ── ที่หน้าจอส่งกลับมา ───────────────────────────────────────────────────────

export class EditRejected extends Error {}

const reject = (msg: string): never => {
  throw new EditRejected(msg);
};

function money(v: unknown, what: string): Money {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) reject(`${what}: ต้องเป็นตัวเลข`);
  // 9 หลักก็เกินราคาสินค้าที่แพงที่สุดในสมุดไปมาก — เลขที่ใหญ่กว่านี้คือพิมพ์ผิดหรือยิงมั่ว
  if (Math.abs(n) > 1e9) reject(`${what}: ตัวเลขใหญ่เกินจริง`);
  return Math.round(n * 100) / 100;
}

function optMoney(v: unknown, what: string): Money | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  return money(v, what);
}

function text(v: unknown, what: string, max: number, required = true): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s === '' && required) reject(`${what}: ยังไม่ได้กรอก`);
  if (s.length > max) reject(`${what}: ยาวเกิน ${max} ตัวอักษร`);
  return s;
}

/**
 * ประกอบเงื่อนไขขึ้นใหม่จากค่าที่รู้จัก — **ไม่ใช่รับ JSON มาทั้งก้อน**
 * ที่รับมีแค่สามแบบที่หน้าจอสร้างได้จริง ส่วน `all`/`any`/`not` ที่มาจากไฟล์ราคาถูก
 * ส่งกลับมาทั้งก้อนไม่ได้ ⇒ กฎที่เงื่อนไขซับซ้อนกว่านี้ แก้ได้แค่ตัวเลขกับชื่อ
 * (หน้าจอบอกไว้ก่อนแล้วว่าบันทึกแล้วเงื่อนไขจะถูกแทน)
 */
/**
 * เงื่อนไขของกฎ — ไวยากรณ์ปิด ไม่ใช่ expression อิสระ (เหตุผลที่หัว RuleEditModal.tsx)
 *
 * รับเงื่อนไขประกอบ (`all` / `any` / `not`) และ "ค่าแกนอยู่/ไม่อยู่ในรายการ" (`axis` + `in`/`notIn`) ด้วย
 * **เพราะกฎที่ลอกมาจากชีตมีแบบนี้อยู่จริง** — เดิมรับแค่ `option` กับ `dim` ⇒ หน้า TS-18 (กฎ 2 element
 * ที่แยก Thermocouple กับ RTD) บันทึกไม่ได้เลยสักครั้ง แม้แก้แค่ตัวเลขช่องเดียวที่ไม่เกี่ยวกัน
 * เพราะหน้าจอส่งเงื่อนไขเดิมกลับมาทั้งก้อน (เจอ 2026-09-23 จากด่านบันทึกเปล่าทุกรุ่น)
 * ทุกใบของต้นไม้ยังต้องชี้ไปยังคำในรายการปิด (OPTION_TH · DIM_TH · AXIS_TH) เหมือนเดิม และลึกได้ไม่เกิน 4 ชั้น
 */
function readWhen(raw: unknown, depth = 0): Predicate | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (depth > 4) reject('เงื่อนไข: ซ้อนกันลึกเกินไป');
  const o = raw as Record<string, unknown>;
  if (o.always === true) return depth === 0 ? undefined : { always: true }; // "ทุกกรณี" = ไม่เก็บเงื่อนไขเลย
  if (typeof o.option === 'string') {
    const key = o.option;
    if (!(key in OPTION_TH)) reject(`เงื่อนไข: ไม่รู้จักตัวเลือก "${key}"`);
    return { option: key };
  }
  if (typeof o.dim === 'string') {
    const dim = o.dim;
    if (!(dim in DIM_TH)) reject(`เงื่อนไข: ไม่รู้จักช่องตัวเลข "${dim}"`);
    const out: Predicate = { dim };
    let n = 0;
    for (const op of ['gt', 'gte', 'lt', 'lte'] as const) {
      if (o[op] === undefined || o[op] === null || o[op] === '') continue;
      (out as Record<string, unknown>)[op] = money(o[op], `เงื่อนไข ${dim}`);
      n++;
    }
    if (n === 0) reject('เงื่อนไข: ยังไม่ได้ใส่ตัวเลขเกณฑ์');
    return out;
  }
  if (typeof o.axis === 'string' && (Array.isArray(o.in) || Array.isArray(o.notIn))) {
    const axis = o.axis;
    if (!(axis in AXIS_TH)) reject(`เงื่อนไข: ไม่รู้จักแกน "${axis}"`);
    const list = (Array.isArray(o.in) ? o.in : o.notIn) as unknown[];
    if (list.length === 0 || list.length > 200) reject(`เงื่อนไข ${axis}: รายการค่าต้องมี 1–200 ค่า`);
    const values = list.map((v) => text(v, `เงื่อนไข ${axis} — ค่า`, 40));
    return Array.isArray(o.in) ? { axis, in: values } : { axis, notIn: values };
  }
  for (const k of ['all', 'any'] as const) {
    if (Array.isArray(o[k])) {
      const list = o[k] as unknown[];
      if (list.length === 0 || list.length > 10) reject('เงื่อนไข: เงื่อนไขย่อยต้องมี 1–10 ข้อ');
      const parts = list.map((x) => readWhen(x, depth + 1) ?? reject('เงื่อนไข: เงื่อนไขย่อยว่าง'));
      return (k === 'all' ? { all: parts } : { any: parts }) as Predicate;
    }
  }
  if (o.not && typeof o.not === 'object') {
    const inner = readWhen(o.not, depth + 1);
    if (!inner) reject('เงื่อนไข: "ไม่ใช่" ต้องมีเงื่อนไขข้างใน');
    return { not: inner! };
  }
  reject('เงื่อนไข: อ่านไม่ออกว่าเป็นแบบไหน');
  return undefined;
}

function readBands(raw: unknown): Band[] {
  if (!Array.isArray(raw) || raw.length === 0) reject('ตารางราคาตั้ง: ต้องมีอย่างน้อยหนึ่งช่วง');
  const bands = (raw as Record<string, unknown>[]).map((b, i) => {
    const min = money(b.min, `ช่วงที่ ${i + 1} — ตั้งแต่`);
    const max = b.max === null || b.max === undefined || b.max === '' ? null : money(b.max, `ช่วงที่ ${i + 1} — ถึง`);
    if (max !== null && max < min) reject(`ช่วงที่ ${i + 1}: "ถึง" น้อยกว่า "ตั้งแต่"`);
    const price = optMoney(b.price, `ช่วงที่ ${i + 1} — ราคา`);
    // ลำดับคีย์ = ลำดับเดียวกับที่ตัวนำเข้าเขียน (min · max · ราคา · label) ⇒ บันทึกโดยไม่แตะอะไร
    // ได้ JSON เดิมทุกไบต์ ไม่งั้นประวัติจะบันทึกว่า "เปลี่ยน" ทั้งที่ไม่มีราคาไหนขยับ (คอลัมน์เป็น json ไม่ใช่ jsonb)
    const out: Band = { min, max };
    // ช่องราคาที่เว้นว่าง = ไม่รับผลิตขนาดนั้น ไม่ใช่ราคา 0 ⇒ ไม่เก็บทั้งสองช่อง
    if (price !== undefined) {
      if (b.kind === 'rate') out.rate = price;
      else out.flat = price;
    }
    out.label = text(b.label, '', 40, false) || `${min} - ${max ?? 'ขึ้นไป'}`;
    return out;
  });
  bands.sort((a, b) => a.min - b.min);
  for (let i = 1; i < bands.length; i++) {
    const p = bands[i - 1]!;
    const top = p.max;
    if (top === null) reject(`ช่วง "${p.label}" ไม่มีขอบบน แต่ยังมีช่วงอื่นต่อท้าย`);
    else if (bands[i]!.min <= top) reject(`ช่วง "${p.label}" กับ "${bands[i]!.label}" ทับกัน`);
  }
  return bands;
}

/** id ของกฎที่หน้าจอสร้างเอง — ต้องเป็นคีย์ที่ปลอดภัยเพราะมันไปเป็นชื่อคอลัมน์ในไฟล์ Excel ด้วย */
function readId(raw: unknown, used: Set<string>): string {
  const s = text(raw, 'รหัสกฎ', 40);
  if (!/^[a-z][a-z0-9_:]*$/i.test(s)) reject(`รหัสกฎ "${s}": ใช้ได้แค่ a-z 0-9 _ : และต้องขึ้นต้นด้วยตัวอักษร`);
  if (used.has(s)) reject(`รหัสกฎ "${s}" ซ้ำกับกฎอื่นในรุ่นเดียวกัน`);
  used.add(s);
  return s;
}

function readAdders(raw: unknown, before: Adder[], known: (a: Adder) => Set<string>): Adder[] {
  if (!Array.isArray(raw)) reject('กฎบวกเพิ่ม: รูปแบบไม่ถูกต้อง');
  if ((raw as unknown[]).length > 100) reject('กฎบวกเพิ่ม: มากเกิน 100 ข้อ');
  const used = new Set<string>();
  const old = new Map(before.map((a) => [a.id, a]));
  const out = (raw as Record<string, unknown>[]).map((a) => {
    const id = readId(a.id, used);
    const prev = old.get(id);
    const kind = a.kind === 'percent' || a.kind === 'perUnit' ? a.kind : 'flat';
    const out: Adder = {
      id,
      label: text(a.label, `กฎ ${id} — ชื่อรายการ`, 120),
      order: Math.round(money(a.order ?? 50, `กฎ ${id} — ลำดับ`)),
      kind,
      when: readWhen(a.when),
      disabled: a.disabled === true || undefined,
      note: text(a.note, '', 300, false) || undefined,
      // `source` คือที่มาในชีต ห้ามให้หน้าจอตั้งเอง — ของเดิมพกต่อ ของใหม่ไม่มี
      source: prev?.source,
      // กฎที่ไม่เคยมีในสมุด = คนเพิ่มเอง ⇒ ไฟล์ราคารอบใหม่ต้องรู้ว่าไม่ได้มาจากชีต
      custom: prev ? prev.custom : true
    };
    if (kind === 'percent') out.percent = money(a.percent, `กฎ ${id} — เปอร์เซ็นต์`);
    else if (kind === 'flat') out.amount = optMoney(a.amount, `กฎ ${id} — จำนวนเงิน`);
    else {
      const dim = text(a.dim, `กฎ ${id} — ช่องตัวเลขที่ดู`, 40);
      if (!(dim in DIM_TH)) reject(`กฎ ${id}: ไม่รู้จักช่องตัวเลข "${dim}"`);
      out.dim = dim;
      // ⚠️ `over`/`step` ที่ "ไม่มีค่า" ไม่ใช่ 0 และไม่ใช่ 1 — engine อ่านว่า
      //    over = `standard[dim]` (สเปกที่รวมในราคาตั้งแล้ว) · step = 1
      //    เผลอเติม `?? 0` ให้ `over` เมื่อไหร่ กฎอย่าง "สายยาวเกิน 30 CM" จะเริ่มคิดเงิน
      //    ตั้งแต่เซนติเมตรแรก ⇒ ทุกใบแพงขึ้น 120 บาทโดยไม่มีอะไรฟ้อง (เจอจากด่านนี้ 2026-09-23)
      out.over = optMoney(a.over, `กฎ ${id} — ส่วนที่เกิน`);
      out.step = optMoney(a.step, `กฎ ${id} — ทุก ๆ`);
      if (out.step !== undefined && out.step <= 0) reject(`กฎ ${id}: ช่อง "ทุก ๆ" ต้องมากกว่า 0`);
      // หน่วยจากชีตบางตัวมีช่องว่างนำหน้า (" m") และมันไปอยู่ในข้อความที่มาของราคา ⇒ ถ้าคนไม่ได้แก้ เก็บของเดิม
      const unit = text(a.unit, '', 16, false);
      out.unit = prev?.unit !== undefined && prev.unit.trim() === unit ? prev.unit : unit;
      out.rate = optMoney(a.rate, `กฎ ${id} — ราคาต่อหน่วย`);
      out.times = optMoney(a.times, `กฎ ${id} — ตัวคูณ`);
      out.round = prev?.round;
    }
    // อัตราตามแกนแก้ได้แค่ตัวเลขของค่าแกนที่สมุดรู้จัก (`knownRateKeys`) — เพิ่มค่าแกนใหม่ต้องไปทำที่ไฟล์ Excel
    if (prev?.rates && Array.isArray(a.rates)) {
      out.rates = readRates(a.rates, known(prev), `กฎ ${id}`);
      out.byAxis = prev.byAxis;
      out.skipIfNoRate = prev.skipIfNoRate;
    } else if (prev?.rates) {
      out.rates = prev.rates;
      out.byAxis = prev.byAxis;
      out.skipIfNoRate = prev.skipIfNoRate;
    }
    return out;
  });
  // หน้าจอเรียงกฎตาม `order` ส่วนสมุดเก็บตามลำดับในชีต — engine เรียงเองตอนคิดอยู่แล้ว ลำดับจึงไม่กระทบราคา
  // แต่ถ้าเขียนตามลำดับของจอ บันทึกครั้งแรกของทุกรุ่นจะเรียงสมุดใหม่ทั้งรุ่น ⇒ ประวัติเห็นเป็น "เปลี่ยน"
  // และแม่แบบ .xlsx สลับแถว ⇒ กฎเดิมคงตำแหน่งเดิม · กฎใหม่ต่อท้ายตามลำดับที่หน้าจอส่งมา
  const pos = new Map(before.map((a, i) => [a.id, i]));
  return out
    .map((a, i) => ({ a, k: pos.get(a.id) ?? before.length + i }))
    .sort((x, y) => x.k - y.k)
    .map((x) => x.a);
}

/**
 * `[{ value, rate }]` → `{ ค่าแกน: ราคา }` · ช่องว่าง = ไม่เก็บคีย์ (ไม่มีราคา = ต้องขอราคา ไม่ใช่ 0)
 * ค่าแกนที่ไม่อยู่ใน `allowed` ถูกทิ้ง — ยิง API ตรงก็สร้างค่าแกนใหม่ไม่ได้
 */
function readRates(raw: unknown[], allowed: Set<string>, what: string): Record<string, Money> {
  const rates: Record<string, Money> = {};
  for (const r of raw as Record<string, unknown>[]) {
    const key = typeof r?.value === 'string' ? r.value : '';
    if (!allowed.has(key)) continue;
    const v = optMoney(r.rate, `${what} — อัตราของ ${key || '(ว่าง)'}`);
    if (v !== undefined) rates[key] = v;
  }
  return rates;
}

/**
 * ตารางราคาตั้งสองแกน — รับ `{ "แถว | คอลัมน์": ราคา | null }` เฉพาะช่องที่จอแก้
 *
 * · ช่องที่ไม่ได้ส่งมา = คงเดิม · `null`/ว่าง = ลบช่องนั้น (ไม่รับผลิต — **ไม่ใช่ราคา 0** กติกาเดียวกับชีต)
 * · คีย์ต้องอยู่ในตาราง แถว × คอลัมน์ ที่มีอยู่แล้ว — เพิ่มแถว/คอลัมน์ใหม่ไม่ใช่งานของหน้าจอ
 * · **ลำดับคีย์เดิมคงที่** ช่องที่เพิ่งกรอกต่อท้าย ⇒ บันทึกโดยไม่แก้อะไรได้สมุดเดิมทุกไบต์
 *   (คอลัมน์ `spec` เป็น json ลำดับคีย์คือลำดับของแม่แบบ .xlsx — เหตุผลเดียวกับ `readBands`)
 */
function readCells(raw: unknown, base: Extract<PriceModel['base'], { kind: 'matrix' }>): Record<string, Money> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) reject('ตารางราคาตั้ง: รูปแบบไม่ถูกต้อง');
  if (base.axes.length !== 2) reject('ตารางราคาตั้งของรุ่นนี้มีมากกว่าสองแกน — แก้ผ่านแม่แบบ Excel');
  const [rows, cols] = matrixValues(base.cells, 2) as [string[], string[]];
  const grid = new Set(rows.flatMap((r) => cols.map((c) => r + SEP + c)));
  const edits = raw as Record<string, unknown>;
  for (const k of Object.keys(edits)) {
    if (!grid.has(k)) reject(`ตารางราคาตั้ง: ไม่มีช่อง "${k}" ในตาราง`);
  }
  // เขียนตามลำดับเดิมของคีย์ — ช่องที่เคยมีอยู่ในตำแหน่งเดิม ช่องใหม่ต่อท้ายตามลำดับ แถว → คอลัมน์
  const ordered: Record<string, Money> = {};
  const read = (k: string) => optMoney(edits[k], `ราคาตั้ง ${k.split(SEP).join(' × ')}`);
  for (const [k, was] of Object.entries(base.cells)) {
    const v = k in edits ? read(k) : was;
    if (v !== undefined) ordered[k] = v;
  }
  for (const r of rows) {
    for (const c of cols) {
      const k = r + SEP + c;
      if (k in base.cells || !(k in edits)) continue;
      const v = read(k);
      if (v !== undefined) ordered[k] = v;
    }
  }
  if (Object.keys(ordered).length === 0) reject('ตารางราคาตั้ง: ว่างทั้งตาราง — รุ่นนี้จะคิดราคาไม่ได้เลย');
  return ordered;
}

/**
 * หน้าตาของชีต (`SheetLayout`) จากหน้าสมุดรายชีต — `{ rowNote: {แถว: ข้อความ}, colNotes: {คอลัมน์: ข้อความ}, highlightCols: [คอลัมน์] }`
 * · คีย์ต้องเป็นแถว/คอลัมน์ที่ตารางมีอยู่ · ข้อความว่าง = ไม่มี · หัวคอลัมน์ท้ายตารางคงของเดิม (มาจากชีต)
 * · เรียงตามลำดับแถว/คอลัมน์ของตาราง = ลำดับเดียวกับที่ตัวนำเข้าเขียน ⇒ บันทึกเปล่าได้ JSON เดิมทุกไบต์
 */
function readLayout(raw: unknown, current: PriceModel): SheetLayout | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) reject('หน้าตาของชีต: รูปแบบไม่ถูกต้อง');
  if (current.base.kind !== 'matrix' || current.base.axes.length !== 2) reject('หน้าตาของชีตใช้ได้กับตารางสองแกนเท่านั้น');
  const base = current.base as Extract<PriceModel['base'], { kind: 'matrix' }>;
  const [rows, cols] = matrixValues(base.cells, 2) as [string[], string[]];
  const o = raw as Record<string, unknown>;
  const texts = (v: unknown, keys: string[], what: string): Record<string, string> => {
    const m = (v ?? {}) as Record<string, unknown>;
    if (typeof m !== 'object' || Array.isArray(m)) reject(`${what}: รูปแบบไม่ถูกต้อง`);
    for (const k of Object.keys(m)) if (!keys.includes(k)) reject(`${what}: ไม่มี "${k}" ในตาราง`);
    const out: Record<string, string> = {};
    for (const k of keys) {
      const t = text(m[k], `${what} ${k}`, 60, false);
      if (t) out[k] = t;
    }
    return out;
  };
  const L: SheetLayout = {};
  const rn = texts(o.rowNote, rows, 'ข้อความท้ายแถว');
  if (Object.keys(rn).length) L.rowNote = { label: current.layout?.rowNote?.label ?? 'หมายเหตุ', values: rn };
  const cn = texts(o.colNotes, cols, 'ข้อความใต้คอลัมน์');
  if (Object.keys(cn).length) L.colNotes = cn;
  if (o.highlightCols !== undefined && !Array.isArray(o.highlightCols)) reject('คอลัมน์ไฮไลต์: รูปแบบไม่ถูกต้อง');
  const hl = (o.highlightCols ?? []) as unknown[];
  for (const k of hl) if (typeof k !== 'string' || !cols.includes(k)) reject(`คอลัมน์ไฮไลต์: ไม่มี "${String(k)}" ในตาราง`);
  const hcols = cols.filter((c) => hl.includes(c));
  if (hcols.length) L.highlightCols = hcols;
  return Object.keys(L).length ? L : undefined;
}

function readVariant(raw: unknown, adders: Adder[], prev?: ModelVariant): ModelVariant | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const suffix = text(o.suffix, 'ตัวเลือกท้ายรหัส', 4).toUpperCase();
  if (!/^[A-Z]+$/.test(suffix)) reject('ตัวเลือกท้ายรหัส: ใช้ได้แค่ตัวอักษร A-Z');
  const prices: Record<string, Money> = {};
  for (const [id, v] of Object.entries((o.adderPrices ?? {}) as Record<string, unknown>)) {
    if (!adders.some((a) => a.id === id)) reject(`ราคาฝั่งรุ่น ${suffix}: ไม่มีกฎชื่อ "${id}" แล้ว`);
    const n = optMoney(v, `ราคาฝั่งรุ่น ${suffix} ของ ${id}`);
    if (n !== undefined) prices[id] = n;
  }
  return {
    suffix,
    label: text(o.label, 'ชื่อตัวเลือก', 60),
    percent: money(o.percent ?? 0, 'บวกเพิ่มจากราคาตั้ง'),
    order: prev?.order ?? 10,
    adderPrices: Object.keys(prices).length ? prices : undefined,
    disabled: o.disabled === true || undefined,
    confirmed: o.confirmed === true ? true : prev?.confirmed,
    source: prev?.source,
    note: text(o.note, '', 300, false) || prev?.note,
    custom: prev ? prev.custom : true
  };
}

/**
 * รวมสิ่งที่หน้าจอส่งมาเข้ากับรุ่นเดิม — **ต่อจากของเดิมเสมอ ไม่ใช่แทนที่ทั้งก้อน**
 * ช่องที่หน้าจอไม่ได้เปิดให้แก้ (`standard` · `derivedDims` · `aliases` · ข้อความของ
 * `constraints`) ต้องเดินทางมาจากเล่มปัจจุบัน ไม่ใช่จาก body ⇒ ยิง API ตรงก็ลบมันไม่ได้
 */
export function applyModelEdit(current: PriceModel, body: unknown, book?: PriceBook): PriceModel {
  const b = (body ?? {}) as Record<string, unknown>;
  const known = (a: Adder) => new Set(knownRateKeys(book, current, a));

  // ไม่ส่ง `adders` มา = กฎคงเดิมทั้งชุด แก้ได้แค่ตัวเลขใน `adderRates` (หน้าสมุดรายชีตใช้ทางนี้ —
  // จอนั้นไม่มีช่องชื่อ/เงื่อนไข/วิธีคิด จึงไม่ควรต้องส่งของที่ตัวเองไม่ได้แสดงกลับมาทั้งก้อน)
  let adders: Adder[];
  if (b.adders === undefined) {
    const patch = (b.adderRates ?? {}) as Record<string, unknown>;
    if (typeof patch !== 'object' || Array.isArray(patch)) reject('ราคาแยกตามแกน: รูปแบบไม่ถูกต้อง');
    for (const id of Object.keys(patch)) {
      if (!current.adders.some((a) => a.id === id && a.rates)) reject(`ไม่มีกฎ "${id}" ที่ราคาแยกตามแกนในรุ่นนี้`);
    }
    adders = current.adders.map((a) => {
      const p = patch[a.id];
      if (!a.rates || !Array.isArray(p)) return a;
      // ค่าที่ไม่ได้ส่งมาคงเดิม · ลำดับ = คีย์เดิมก่อน แล้วค่าแกนที่เพิ่งกรอกต่อท้าย (เหตุผลเดียวกับ `readCells`)
      const sent = new Map((p as Record<string, unknown>[]).map((r) => [typeof r?.value === 'string' ? r.value : '', r]));
      const allowed = known(a);
      const merged = [...new Set([...Object.keys(a.rates), ...allowed])]
        .map((k) => sent.get(k) ?? (k in a.rates! ? { value: k, rate: a.rates![k] } : undefined))
        .filter((r): r is Record<string, unknown> => !!r);
      return { ...a, rates: readRates(merged, allowed, `กฎ ${a.id}`) };
    });
  } else {
    adders = readAdders(b.adders, current.adders, known);
  }

  let base = current.base;
  if (b.bands !== undefined) {
    if (current.base.kind !== 'banded') reject('รุ่นนี้ไม่ได้ใช้ตารางราคาแบบช่วงขนาด');
    else base = { ...current.base, bands: readBands(b.bands) };
  }
  if (b.cells !== undefined) {
    if (current.base.kind !== 'matrix') reject('รุ่นนี้ไม่ได้ใช้ตารางราคาแบบสองแกน');
    else base = { ...current.base, cells: readCells(b.cells, current.base) };
  }

  // สวิตช์ของข้อจำกัดเป็นสิ่งเดียวที่แก้ได้ — ข้อความและเงื่อนไขมาจากเล่มปัจจุบันเสมอ
  const offIds = new Set(
    Array.isArray(b.constraintsOff) ? (b.constraintsOff as unknown[]).filter((x): x is string => typeof x === 'string') : []
  );
  const constraints = current.constraints.map((c) => ({ ...c, disabled: offIds.has(c.id) || undefined }));

  const next: PriceModel = {
    ...current,
    base,
    adders,
    constraints,
    variant: readVariant(b.variant, adders, current.variant)
  };
  // ค่าเริ่มต้นตามแกน — แก้ได้แค่ "ค่าไหนใช้อะไร" ของแกนที่มีอยู่แล้ว (เพิ่มแกนใหม่ทางแม่แบบ Excel)
  if (b.defaultsBy !== undefined) {
    const raw = b.defaultsBy as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) reject('ค่าเริ่มต้นตามแกน: รูปแบบไม่ถูกต้อง');
    const cur = current.axisDefaultsBy ?? {};
    const out: Record<string, NonNullable<PriceModel['axisDefaultsBy']>[string]> = {};
    for (const axis of Object.keys(raw)) if (!(axis in cur)) reject(`ค่าเริ่มต้นตามแกน: รุ่นนี้ไม่มีค่าเริ่มต้นของ "${axis}"`);
    for (const [axis, d] of Object.entries(cur)) {
      const sent = raw[axis];
      if (sent === undefined) { out[axis] = d; continue; }
      if (!sent || typeof sent !== 'object' || Array.isArray(sent)) reject(`ค่าเริ่มต้นของ ${axis}: รูปแบบไม่ถูกต้อง`);
      const opts = new Set(defaultOptions(book, current, axis));
      const byValues = current.base.kind === 'matrix' && current.base.axes[0] === d.by
        ? matrixValues(current.base.cells, current.base.axes.length)[0]!
        : Object.keys(d.values);
      const m = sent as Record<string, unknown>;
      for (const k of Object.keys(m)) if (!byValues.includes(k)) reject(`ค่าเริ่มต้นของ ${axis}: ไม่มี "${k}" ในตาราง`);
      const values: Record<string, string> = {};
      for (const k of byValues) {
        const v = text(m[k], `ค่าเริ่มต้นของ ${axis} ${k}`, 60, false);
        if (!v) continue; // ว่าง = ไม่มีค่าเริ่มต้น ⇒ รหัสที่ไม่บอกค่านี้คิดไม่ได้ (ไม่ใช่เดา)
        if (!opts.has(v)) reject(`ค่าเริ่มต้นของ ${axis} ${k}: "${v}" ไม่มีในราคา (${[...opts].join(' · ')})`);
        values[k] = v;
      }
      out[axis] = { ...d, values };
    }
    if (Object.keys(out).length) next.axisDefaultsBy = out;
    else delete next.axisDefaultsBy;
  }
  // ไม่ส่ง `layout` มา = คงเดิม (หน้าแก้ทีละรุ่นไม่มีช่องพวกนี้) · ส่งมาแล้วว่างทั้งหมด = ลบ
  if (b.layout !== undefined) {
    const layout = readLayout(b.layout, current);
    if (layout) next.layout = layout;
    else delete next.layout;
  }
  return next;
}

/**
 * "สมุดรายชีต" — แก้ทุกรุ่นของชีตเดียวพร้อมกัน (`PUT /api/admin/pricebook/sheet/:sheet`)
 *
 * แยกออกมาจาก route เพื่อให้ด่าน (`diag:pricing-db`) เรียกตัวเดียวกับที่ API ใช้ ไม่ใช่สำเนา
 * · รุ่นที่ไม่ได้อยู่ในชีตนั้นถูกปฏิเสธ — ยิง API ตรงแล้วแก้รุ่นอื่นผ่านเส้นของชีตไม่ได้
 * · `changed` = รุ่นที่ JSON เปลี่ยนจริง ⇒ บันทึกเปล่าไม่เพิ่มแถวประวัติ
 */
export function sheetModels(book: PriceBook, sheet: string): PriceModel[] {
  return Object.values(book.models).filter((m) => (m.sheet ?? '') === sheet);
}

export function applySheetEdit(
  book: PriceBook,
  sheet: string,
  edits: unknown,
): { models: Record<string, PriceModel>; changed: string[] } {
  const inSheet = new Map(sheetModels(book, sheet).map((m) => [m.code, m]));
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) reject('ไม่มีรุ่นที่จะบันทึก');
  const models = { ...book.models };
  const changed: string[] = [];
  for (const [code, body] of Object.entries(edits as Record<string, unknown>)) {
    const current = inSheet.get(code);
    if (!current) reject(`รุ่น ${code} ไม่ได้อยู่ในชีต ${sheet}`);
    const next = applyModelEdit(current!, body, book);
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      models[code] = next;
      changed.push(code);
    }
  }
  return { models, changed };
}
