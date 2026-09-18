// ─────────────────────────────────────────────────────────────────────────────
//  เครื่องคิดราคา (pure function ล้วน)
//
//  โมดูล "คิดราคาสินค้าสั่งทำ" — ถอดออกได้ทั้งก้อน ดู services/pricingLab/README.md
//
//  ⚠️ โมดูลนี้ถูกเรียกจาก routes/pricingLab.ts เท่านั้น และ **ห้ามมีโค้ดเดิมที่ไหน import
//     โฟลเดอร์นี้** — การพึ่งพาเป็นทางเดียวคือสิ่งเดียวที่ทำให้ "ลบทิ้งเมื่อไหร่ก็ได้" เป็นจริง
//     ไม่ใช่แค่ความตั้งใจ · เฟสแรกยังไม่ต่อกับใบเสนอราคา คิดราคาให้ดูอย่างเดียว
//  ด่านตรวจของไฟล์กลุ่มนี้ยังอยู่ที่ prototypes/pricing/ (golden.ts · roundtrip.ts)
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
  Money,
  Predicate,
  PriceBook,
  PriceModel,
  PriceOutcome,
  ProductConfig,
  RoundMode,
  SubCode,
  Violation
} from './types.js';
import { matchedSubCodes } from './subcodes.js';
import { axisLabel } from './labels.js';

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

// ── ค่าที่คำนวณมาจากค่าอื่น ───────────────────────────────────────────────────

function computeDerived(d: DerivedDim, dims: Record<string, number>): number | undefined {
  const args = d.args.map((a) => dims[a]);
  if (args.some((v) => typeof v !== 'number' || Number.isNaN(v))) return undefined;

  let raw: number;
  if (d.formula === 'sum') {
    raw = args.reduce((s, v) => s + v, 0);
  } else if (d.formula === 'cylinderAreaIn2') {
    // พื้นที่ผิวทรงกระบอกเป็น "ตารางนิ้ว" — สูตรในชีต BH เขียนไว้ตรง ๆ ว่า
    //   600 x 3.14 x 150 / 645 = 438.14 ปัดเป็น 439
    // π และตัวหาร 645 (mm² ต่อ 1 in²) อยู่ใน consts ของสมุดราคา ไม่ใช่ในโค้ดนี้
    // ⚠️ ชีตใช้ 3.14 ไม่ใช่ Math.PI — ใช้ Math.PI แทนได้ผลต่างในหลักทศนิยม
    //    ซึ่งพอปัดขึ้นแล้วอาจข้ามหลักได้ จึงต้องยึดค่าที่เขาเขียน
    const pi = d.consts?.pi ?? 3.14;
    const per = d.consts?.mm2PerIn2 ?? 645;
    raw = (args[0]! * pi * args[1]!) / per;
  } else {
    return undefined;
  }
  return applyRound(raw, d.round ?? 'exact');
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
}

function computeBase(
  model: PriceModel,
  book: PriceBook,
  axes: Record<string, string>,
  dims: Record<string, number>,
  seen: Set<string>
): BaseResult {
  const base = model.base;

  if (base.kind === 'ref') {
    if (seen.has(base.model)) {
      return { ok: false, amount: 0, label: 'ฐานราคา', reason: `สมุดราคาวนกลับมาที่ ${base.model}` };
    }
    seen.add(base.model);
    const parent = resolveModel(book, base.model);
    if (!parent) {
      return { ok: false, amount: 0, label: 'ฐานราคา', reason: `ไม่มีรุ่น ${base.model} ในสมุดราคา` };
    }
    const r = computeBase(parent, book, axes, dims, seen);
    return { ...r, label: `${r.label} (ฐานของ ${parent.code})` };
  }

  if (base.kind === 'matrix') {
    const key = matrixKey(base.axes, axes);
    const cell = base.cells[key];
    if (cell === undefined) {
      return {
        ok: false,
        amount: 0,
        label: 'ฐานราคา',
        // ชีตเว้นช่องนี้ไว้ = ไม่รับผลิต ไม่ใช่ราคา 0
        // คนอ่านบรรทัดนี้คือแอดมินที่กำลังจะตอบลูกค้า ไม่ใช่คนที่เปิดชีตราคาอยู่
        reason: `ไม่มีราคาสำหรับ ${base.axes.map((a) => `${axisLabel(a)} ${axes[a] ?? '-'}`).join(' · ')} — ไม่รับผลิตขนาดนี้`
      };
    }
    return {
      ok: true,
      amount: money(cell),
      label: `ราคาตั้ง ${model.code}`,
      // ชื่อแกนต้องเป็นคำไทย — คนอ่านบรรทัดนี้คือแอดมินที่ไม่เคยเปิดชีต Excel มาก่อน
      detail: base.axes.map((a) => `${axisLabel(a)} ${axes[a]}`).join(' · ')
    };
  }

  // banded
  const q = dims[base.quantity];
  if (q === undefined) {
    return { ok: false, amount: 0, label: 'ฐานราคา', reason: `คำนวณ ${base.quantity} ไม่ได้ — ข้อมูลไม่ครบ` };
  }
  const band = findBand(base.bands, q);
  if (!band) {
    return {
      ok: false,
      amount: 0,
      label: 'ฐานราคา',
      reason: `${base.quantity} = ${fmt(q)} อยู่นอกทุกช่วงราคาของ ${model.code}`
    };
  }
  if (band.flat !== undefined) {
    return {
      ok: true,
      amount: money(band.flat),
      label: `ราคาตั้ง ${model.code}`,
      detail: `${base.quantity} ${fmt(q)} → ช่วง ${band.label ?? `${band.min}-${band.max ?? '∞'}`} เหมา`
    };
  }
  return {
    ok: true,
    amount: money(band.rate! * q),
    label: `ราคาตั้ง ${model.code}`,
    detail: `${base.quantity} ${fmt(q)} × ${fmt(band.rate!)} (ช่วง ${band.label ?? `${band.min}-${band.max ?? '∞'}`})`
  };
}

// ── ส่วนที่บวกเพิ่ม ──────────────────────────────────────────────────────────

interface AdderResult {
  amount: Money;
  detail?: string;
  /** ชีตเว้นราคาของแกนนี้ไว้ = ไม่รับทำ */
  blocked?: string;
  skip?: boolean;
}

function computeAdder(
  a: Adder,
  model: PriceModel,
  subtotal: Money,
  axes: Record<string, string>,
  dims: Record<string, number>
): AdderResult {
  if (a.kind === 'percent') {
    return { amount: money((subtotal * (a.percent ?? 0)) / 100), detail: `${a.percent}% ของ ${fmt(subtotal)}` };
  }

  // ── perUnit: ตัดสินว่า "ต้องคิดเงินไหม" ก่อนไปหาราคา ────────────────────────
  // ลำดับนี้สลับไม่ได้ — ถ้าไปหาราคาก่อน สินค้าที่สเปกตรง Standard เป๊ะ (ไม่ต้องบวกอะไรเลย)
  // จะถูกบล็อกเพียงเพราะชีตเว้นช่อง "บวกเพิ่ม 100 mm ละ" ของขนาดนั้นไว้
  let excess = 0;
  let over = 0;
  if (a.kind === 'perUnit') {
    const dimName = a.dim ?? '';
    const value = dims[dimName];
    if (value === undefined) return { amount: 0, skip: true };
    over = a.over ?? model.standard[dimName] ?? 0;
    excess = value - over;
    if (excess <= 0) return { amount: 0, skip: true };
  }

  // หาราคาต่อหน่วย: คงที่ หรือขึ้นกับค่าแกน
  let rate = a.rate;
  if (a.byAxis) {
    const axisValue = axes[a.byAxis] ?? '';
    rate = a.rates?.[axisValue];
    if (rate === undefined) {
      if (a.skipIfNoRate) return { amount: 0, skip: true };
      return { amount: 0, blocked: `${a.label}: ไม่มีราคาสำหรับ ${a.byAxis}=${axisValue || '-'}` };
    }
  }

  if (a.kind === 'flat') {
    const amt = a.amount ?? rate ?? 0;
    return { amount: money(amt) };
  }

  const step = a.step ?? 1;
  // ปัดขึ้นทั้งบล็อกเสมอตามที่ชีตทำ — ตัวอย่าง TS-14: ส่วนต่าง 250 mm → 3 บล็อก ไม่ใช่ 2.5
  const units = applyRound(excess / step, a.round ?? 'ceil');
  const times = a.times ?? 1;
  const amount = money(units * (rate ?? 0) * times);
  const unit = a.unit ?? '';
  const timesNote = times !== 1 ? ` × ${times}` : '';
  return {
    amount,
    detail: `เกิน ${fmt(over)}${unit} อยู่ ${fmt(excess)}${unit} → ${units} × ${fmt(step)}${unit} @${fmt(rate ?? 0)}${timesNote}`
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

// ── ตัวหลัก ──────────────────────────────────────────────────────────────────

export function resolveModel(book: PriceBook, code: string): PriceModel | undefined {
  const direct = book.models[code];
  if (direct) return direct;
  for (const m of Object.values(book.models)) {
    if (m.aliases?.includes(code)) return m;
  }
  return undefined;
}

export function computePrice(cfg: ProductConfig, book: PriceBook): PriceOutcome {
  const model = resolveModel(book, cfg.model);
  if (!model) {
    return {
      status: 'notManufacturable',
      model: cfg.model,
      unitPrice: 0,
      breakdown: [],
      violations: [{ id: 'UNKNOWN_MODEL', level: 'block', message: `ไม่มีรุ่น ${cfg.model} ในสมุดราคา` }],
      bookVersion: book.version
    };
  }

  // ค่าว่างใน cfg.axes แปลว่า "ไม่ได้ระบุ" ไม่ใช่ "เลือกค่าว่าง" ⇒ กรองทิ้งก่อนเติมค่าเริ่มต้น
  // ไม่งั้นช่อง "— ไม่มี —" บนหน้าจอจะลบค่ามาตรฐานของแกนนั้นไปเงียบ ๆ
  const given = Object.fromEntries(Object.entries(cfg.axes ?? {}).filter(([, v]) => v !== ''));
  const axes = { ...(model.axisDefaults ?? {}), ...given };
  // รหัสย่อยที่ "เซ็ตค่าให้ช่อง" ต้องมีผลก่อนหาราคาตั้ง ไม่งั้นตารางจะถูกค้นด้วยค่าเก่า
  const subCodes = matchedSubCodes(book, model, cfg.options ?? []);
  for (const sc of subCodes) {
    if (sc.effect === 'setAxis' && sc.axis) axes[sc.axis] = sc.value ?? '';
  }
  // standard คือสเปกที่รวมอยู่ในราคาตั้งแล้ว ⇒ เป็นค่าตั้งต้นของทุก dim ที่ผู้ใช้ไม่ได้ระบุ
  const dims: Record<string, number> = { ...model.standard, ...(cfg.dims ?? {}) };
  const options = new Set(cfg.options ?? []);

  // ค่าที่คำนวณจากค่าอื่น ต้องมาก่อน constraint และก่อน adder เพราะทั้งคู่อ่านมันได้
  for (const d of model.derivedDims ?? []) {
    const v = computeDerived(d, dims);
    if (v !== undefined) dims[d.name] = v;
  }

  const violations: Violation[] = [];
  for (const c of model.constraints) {
    if (c.disabled) continue;
    if (evalPredicate(c.when, axes, dims, options)) {
      violations.push({ id: c.id, level: c.level, message: c.message });
    }
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
  const base = ownBase[0]
    ? {
        ok: true,
        amount: money(ownBase[0].amount ?? 0),
        label: `ราคาตั้งต้นจากรหัสย่อย ${ownBase[0].subCode}`,
        detail: ownBase[0].reads
      }
    : computeBase(model, book, axes, dims, new Set([model.code]));
  if (!base.ok) {
    violations.push({ id: 'NO_BASE_PRICE', level: 'block', message: base.reason ?? 'ไม่มีราคาฐาน' });
  } else {
    running = base.amount;
    breakdown.push({ step: 'base', label: base.label, detail: base.detail, amount: base.amount, running });
  }

  if (base.ok) {
    // `disabled` ถูกกรองทิ้งตรงนี้ ไม่ใช่ตอนโหลดสมุดราคา — เพื่อให้กฎที่ปิดไว้ยังอยู่ในสมุด
    // (ส่งออกไป Excel แล้วยังเห็น เปิดกลับมาใช้ได้) แค่ไม่มีผลกับราคา
    const fromSubCodes = subCodes
      .filter((s) => s.effect === 'flat' || s.effect === 'percent' || s.effect === 'perUnit')
      .map(subCodeAsAdder);
    const ordered = [...model.adders, ...fromSubCodes]
      .filter((a) => !a.disabled)
      .sort((x, y) => x.order - y.order);
    for (const a of ordered) {
      if (a.when && !evalPredicate(a.when, axes, dims, options)) continue;
      const r = computeAdder(a, model, running, axes, dims);
      if (r.blocked) {
        violations.push({ id: a.id, level: 'block', message: r.blocked });
        continue;
      }
      if (r.skip || r.amount === 0) continue;
      running = money(running + r.amount);
      breakdown.push({ step: a.kind, label: a.label, detail: r.detail, amount: r.amount, running });
    }
  }

  const blocked = violations.some((v) => v.level === 'block');
  const needsQuote = violations.some((v) => v.level === 'quoteOnRequest');

  return {
    status: blocked ? 'notManufacturable' : needsQuote ? 'quoteOnRequest' : 'priced',
    model: model.code,
    unitPrice: blocked ? 0 : running,
    breakdown,
    violations,
    bookVersion: book.version
  };
}

// ── แสดงผลเป็นข้อความ (ใช้ได้ทั้ง CLI · หมายเหตุ PDF · หน้าจอ) ───────────────

export function formatOutcome(o: PriceOutcome): string {
  const lines: string[] = [];
  const width = 62;
  lines.push(`รุ่น ${o.model}   [สมุดราคา ${o.bookVersion}]`);
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
