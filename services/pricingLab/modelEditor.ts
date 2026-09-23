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
import type { Adder, Band, ModelVariant, Money, Predicate, PriceBook, PriceModel } from './types.js';

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
  rates: { value: string; rate: Money }[] | null;
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
    | { kind: 'matrix'; note: string }
    | { kind: 'ref'; model: string };
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
        : {
            kind: 'matrix',
            // ซีรีส์ TS ยังไม่เปิดให้แก้จากจอนี้ (เจ้าของสั่งทำทีละซีรีส์ เริ่มที่ BH)
            note: 'ตารางราคาแบบสองแกนยังแก้จากหน้านี้ไม่ได้ — ใช้ปุ่มดาวน์โหลดแม่แบบ Excel ไปก่อน'
          };

  return {
    code: m.code,
    name: displayName(m.code, m.aliases ?? []).name,
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
        rates: a.rates ? Object.entries(a.rates).map(([value, rate]) => ({ value, rate })) : null,
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
  void book;
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
function readWhen(raw: unknown): Predicate | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (o.always === true) return undefined; // "ทุกกรณี" = ไม่เก็บเงื่อนไขเลย
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
    const out: Band = { min, max, label: text(b.label, '', 40, false) || `${min} - ${max ?? 'ขึ้นไป'}` };
    // ช่องราคาที่เว้นว่าง = ไม่รับผลิตขนาดนั้น ไม่ใช่ราคา 0 ⇒ ไม่เก็บทั้งสองช่อง
    if (price !== undefined) {
      if (b.kind === 'rate') out.rate = price;
      else out.flat = price;
    }
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

function readAdders(raw: unknown, before: Adder[]): Adder[] {
  if (!Array.isArray(raw)) reject('กฎบวกเพิ่ม: รูปแบบไม่ถูกต้อง');
  if ((raw as unknown[]).length > 100) reject('กฎบวกเพิ่ม: มากเกิน 100 ข้อ');
  const used = new Set<string>();
  const old = new Map(before.map((a) => [a.id, a]));
  return (raw as Record<string, unknown>[]).map((a) => {
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
      out.unit = text(a.unit, '', 16, false);
      out.rate = optMoney(a.rate, `กฎ ${id} — ราคาต่อหน่วย`);
      out.times = optMoney(a.times, `กฎ ${id} — ตัวคูณ`);
      out.round = prev?.round;
    }
    // อัตราตามแกนแก้ได้แค่ตัวเลขของค่าที่มีอยู่แล้ว — เพิ่ม/ลบค่าแกนต้องไปทำที่ไฟล์ Excel
    if (prev?.rates && Array.isArray(a.rates)) {
      const rates: Record<string, Money> = {};
      for (const r of a.rates as Record<string, unknown>[]) {
        const key = typeof r.value === 'string' ? r.value : '';
        if (!(key in prev.rates)) continue;
        const v = optMoney(r.rate, `กฎ ${id} — อัตราของ ${key || '(ว่าง)'}`);
        if (v !== undefined) rates[key] = v;
      }
      out.rates = rates;
      out.byAxis = prev.byAxis;
      out.skipIfNoRate = prev.skipIfNoRate;
    } else if (prev?.rates) {
      out.rates = prev.rates;
      out.byAxis = prev.byAxis;
      out.skipIfNoRate = prev.skipIfNoRate;
    }
    return out;
  });
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
export function applyModelEdit(current: PriceModel, body: unknown): PriceModel {
  const b = (body ?? {}) as Record<string, unknown>;
  const adders = readAdders(b.adders, current.adders);

  let base = current.base;
  if (b.bands !== undefined) {
    if (current.base.kind !== 'banded') reject('รุ่นนี้ไม่ได้ใช้ตารางราคาแบบช่วงขนาด');
    else base = { ...current.base, bands: readBands(b.bands) };
  }

  // สวิตช์ของข้อจำกัดเป็นสิ่งเดียวที่แก้ได้ — ข้อความและเงื่อนไขมาจากเล่มปัจจุบันเสมอ
  const offIds = new Set(
    Array.isArray(b.constraintsOff) ? (b.constraintsOff as unknown[]).filter((x): x is string => typeof x === 'string') : []
  );
  const constraints = current.constraints.map((c) => ({ ...c, disabled: offIds.has(c.id) || undefined }));

  return {
    ...current,
    base,
    adders,
    constraints,
    variant: readVariant(b.variant, adders, current.variant)
  };
}
