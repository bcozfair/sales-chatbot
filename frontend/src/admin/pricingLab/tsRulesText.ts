import type { EditorAdder, EditorView, Predicate } from './types';

/**
 * คำบนจอของหน้า "กฎและเงื่อนไข" ซีรีส์ TS — แยกไฟล์เพราะทั้งหน้าจอ (`TsRulesView`) และกล่องแก้กฎ
 * (`TsRuleModal`) ต้องพูดเหมือนกันทุกคำ ไม่งั้นประโยคในแถวกับสรุปในกล่องจะเล่าคนละแบบ
 *
 * คำชุดนี้เป็นคำแสดงผลอย่างเดียว — ไม่มีอะไรถูกส่งกลับไปเซิร์ฟเวอร์ (`whenTh` ของกฎที่แก้แล้วใช้แค่
 * วาดส่วนต่างก่อนบันทึก ตัวรับประกอบเงื่อนไขจาก `when` เองเสมอ)
 */

/** ชื่อช่องตัวเลขแบบที่คนตั้งราคาเรียก (เคาะใน mockup 2026-09-29) — ไม่มีในนี้ = ใช้คำกลางของระบบ */
const DIM_NICE: Record<string, string> = {
  L1: 'แกน L1',
  L2: 'Sleeve L2',
  L_total: 'ความยาวรวม (L1 + Sleeve)',
  cable_m: 'สาย',
  teflon_mm: 'ส่วนที่หุ้มเทปล่อน',
};

export const dimNice = (key: string | null, vocab: EditorView['vocab']): string =>
  (key && DIM_NICE[key]) ?? vocab.dims.find((d) => d.key === key)?.label ?? key ?? '?';

export const optLabel = (key: string, vocab: EditorView['vocab']): string =>
  vocab.options.find((o) => o.key === key)?.label ?? key;

export const axisTh = (key: string, vocab: EditorView['vocab']): string =>
  vocab.axes.find((a) => a.key === key)?.label ?? key;

export const fmt = (n: number | null | undefined): string =>
  n === null || n === undefined ? '' : n.toLocaleString('en-US');

export const toNum = (v: string): number | null => {
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export const isAlways = (p: Predicate | null | undefined): boolean => !p || 'always' in p;

/** หน่วยของค่ามาตรฐาน — เอาจากกฎที่คิดช่องนั้น ถ้าไม่มีใครคิด เดาจากชื่อช่อง */
export function stdUnit(dim: string, adders: EditorAdder[]): string {
  const u = adders.find((a) => a.dim === dim && a.unit.trim())?.unit.trim();
  return u ?? (dim === 'cable_m' ? 'm' : 'mm');
}

const OPS: [keyof Extract<Predicate, { dim: string }>, string][] = [
  ['gt', 'มากกว่า'], ['gte', 'ตั้งแต่'], ['lt', 'น้อยกว่า'], ['lte', 'ไม่เกิน'],
];

/** เงื่อนไขเป็นภาษาคน — "เลือก “Type T”" แทน "ลูกค้าติ๊ก …" / "ชนิดเซนเซอร์ = …" */
export function predText(p: Predicate | null | undefined, vocab: EditorView['vocab']): string {
  if (!p || 'always' in p) return 'ทุกชิ้น';
  if ('all' in p) return p.all.map((x) => predText(x, vocab)).join(' และ ');
  if ('any' in p) return p.any.map((x) => predText(x, vocab)).join(' หรือ ');
  if ('not' in p) return `ไม่ใช่กรณี ${predText(p.not, vocab)}`;
  if ('option' in p) return `เลือก “${optLabel(p.option, vocab)}”`;
  if ('in' in p) return `${axisTh(p.axis, vocab)}เป็น ${p.in.map((v) => v || '(ว่าง)').join(' / ')}`;
  if ('notIn' in p) return `${axisTh(p.axis, vocab)}ไม่ใช่ ${p.notIn.map((v) => v || '(ว่าง)').join(' / ')}`;
  const parts = OPS.filter(([k]) => p[k] !== undefined).map(([k, t]) => (k === 'gte' ? `${t} ${p[k]} ขึ้นไป` : `${t} ${p[k]}`));
  return `${dimNice(p.dim, vocab)} ${parts.join(' และ ')}`.trim();
}

/** วิธีปัดของช่วง — ต้องบอกบนจอ · สาย TS เศษปัดขึ้นเป็นเมตรเต็ม (เจ้าของ 2026-10-01 · เดิมนับเฉพาะเมตรเต็ม) ส่วนแกนคิดเศษเต็มช่วง */
export function roundTh(round: EditorAdder['round'], unit: string): string {
  if (round === 'floor') return unit.trim() === 'm' ? 'นับเฉพาะเมตรเต็ม' : 'นับเฉพาะช่วงเต็ม';
  if (round === 'exact') return 'คิดตามจริง ไม่ปัด';
  return unit.trim() === 'm' ? 'เศษปัดขึ้นเป็นเมตรเต็ม' : 'เศษคิดเต็มช่วง';
}

export function applyRound(n: number, round: EditorAdder['round']): number {
  if (round === 'floor') return Math.floor(n);
  if (round === 'exact') return n;
  return Math.ceil(n);
}

/** ค่า "เกิน" ที่กฎใช้จริง — ว่าง = สเปกมาตรฐานของรุ่น (ไม่ใช่ 0) */
export const effOver = (a: Pick<EditorAdder, 'over' | 'overStd'>): number => a.over ?? a.overStd ?? 0;

/** สร้าง id จากชื่อที่พิมพ์ — ตัวอักษรไทยใช้เป็นคีย์ไม่ได้ จึงถอยไปใช้เลขลำดับ */
export function makeId(label: string, used: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const stem = /^[a-z]/.test(base) ? base.slice(0, 30) : 'rule';
  let id = stem;
  let n = 1;
  while (used.includes(id)) id = `${stem}_${++n}`;
  return id;
}

/** รุ่นที่ใช้หน้า "กฎและเงื่อนไข" แบบ TS — BH ยังใช้หน้าเดิม (เจ้าของเคาะ 2026-09-29 ข้อ 3) ·
 *  หน้า TS ไม่รู้จัก `variant` / ตารางช่วงขนาด จึงเปิดเฉพาะรุ่นที่ไม่มีสองอย่างนั้น */
export const isTsRulesModel = (v: EditorView): boolean =>
  /^TS/i.test(v.code) && v.base.kind === 'matrix' && !v.variant;
