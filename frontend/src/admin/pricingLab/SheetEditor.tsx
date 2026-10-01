import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, ChevronLeft, Settings2, Undo2 } from 'lucide-react';
import { Button } from '../Button';
import { ErrorBox } from '../logs/ui';
import { errMsg } from '../logs/format';
import { ReviewModal, type DiffRow } from './ModelPriceEditor';
import type { AskValue, EditorAdder, EditorView } from './types';

/**
 * หน้า "สมุดรายชีต" — หนึ่งชีตของไฟล์ราคา Excel = หนึ่งหน้า วางตารางแบบเดียวกับในชีต
 *
 * เจ้าของสั่ง 2026-09-24 หลังเห็นหน้าแก้ทีละรุ่นของซีรีส์ TS แล้วบอกว่า "งงกว่าเดิม":
 *   **"ให้ปรับให้ใกล้เคียง format เดิมใน excel มากที่สุด · เริ่มที่ชีท TS-01+TS-01-0 ก่อน · 1 ชีท / 1 สมุด"**
 * แล้ว 2026-09-28 **"ปรับสมุดราคาให้เป็นสไตล์ excel ทั้งหมด"** — เคาะจาก mockup `pricebook-excel-all` (ข้อมูลจริงทั้ง 11 ชีต)
 * ⇒ คนที่ใช้จอนี้คือคนที่ดูแลไฟล์ราคามาตลอด ตาของเขาคุ้นกับชีต ไม่ใช่กับ "กฎบวกเพิ่ม" · วางตามไฟล์:
 *   · **ตารางหลัก** แถว = แกนแรก (D / TYPE) · คอลัมน์ "บวกเพิ่ม 100 mm ละ" (กฎต่อหน่วยที่แยกตามแถว ไม่มีเงื่อนไข) อยู่ซ้าย
 *     · คอลัมน์ "Type T บวกเพิ่ม / 2 element / หุ้มเทปล่อน" (กฎที่แยกตามแถวแบบอื่น) อยู่ขวาในแถวเดียวกัน
 *     · ตารางสามแกน (TS-08 · TS-10) = หัวคอลัมน์สองชั้น เกลียว → TSP/TSPA/TSZ
 *     · แถวที่ชีตมีแค่ราคาบวกเพิ่ม (7TN ของ TS-04/06/08 — ตัวแดงในไฟล์) โผล่ตรงตำแหน่งเดิม ช่องราคาตั้งกรอกไม่ได้
 *   · **สิ่งที่ต้องบวกเพิ่ม** ที่ราคาเดียว (หัวกระโหลก · หัก L · น็อต · ปลั๊ก) = ตารางเล็กพื้นเหลือง
 *     ชีต TS อยู่เหนือตารางหลัก · BH อยู่ใต้ตาราง (ตามไฟล์ของแต่ละไฟล์ — เจ้าของเคาะข้อ 3)
 *     กฎที่แยกตามแกนอื่น (หน้าแปลน TS-18) = ตารางเล็กแยกตามค่า · ราคาสาย = แถบส้มใต้ตาราง (แบบ TS-01 เดิม)
 *   · **BH** = ตารางช่วงขนาด + คอลัมน์ "BH-01C บวกเพิ่มอีก __%" + ตารางสิ่งที่ต้องบวกเพิ่มมีคอลัมน์ราคารุ่น C
 *   · ข้อจำกัด / สูตร / ค่ามาตรฐาน = ตัวหนังสือใต้ตาราง (แสดงอย่างเดียว)
 *
 * **จอนี้แก้ตัวเลขอย่างเดียว** (เจ้าของเคาะข้อ 1–2): เพิ่ม/ลบกฎ · เงื่อนไข · สวิตช์ข้อจำกัด · หัวท้ายช่วงขนาด
 * อยู่หลังปุ่ม "กฎและเงื่อนไข" (`onAdvanced` → `ModelPriceEditor`) — ยัดช่องพวกนั้นลงตารางคือทางที่ทำให้ "งง" มาแล้ว
 * · backend ไม่ส่ง `variant`/`constraintsOff` มา = คงเดิม (ดู `applyModelEdit`) ⇒ บันทึกจากจอนี้ไม่ลบรุ่น C
 *   และไม่เปิดข้อจำกัดที่คนปิดไว้คืนมา
 *
 * กติกาเดียวกับหน้าแก้ทีละรุ่น (อย่าแก้กลับ):
 *   · **ช่องว่าง = ไม่รับผลิต / ต้องขอราคา ไม่ใช่ 0** — ลบเลขได้ แต่ขึ้นเตือนในหน้าตรวจ
 *     ยกเว้นราคาของสิ่งที่ต้องบวกเพิ่ม (ราคาเดียว) ซึ่งว่างไม่ได้ — จะเลิกคิดต้องปิดกฎ ไม่ใช่ลบเลข
 *   · **ก่อนบันทึกต้องเห็นส่วนต่าง (เดิม → ใหม่) ทุกช่อง** — ใช้ `ReviewModal` ตัวเดียวกัน
 *   · ช่องที่พิมพ์ไม่ใช่ตัวเลข = บันทึกไม่ได้ (เดิมถูกอ่านเป็น "ว่าง" = ไม่รับผลิตเงียบ ๆ)
 *   · ของรอบตาราง (เจ้าของสั่งเพิ่ม 2026-09-24):
 *       คอลัมน์ "ชนิดสาย รุ่นเริ่มต้น" = `axisDefaultsBy` — **มีผลกับราคา** (สายของรหัสที่ไม่บอกชนิดสาย · เจ้าของยืนยัน)
 *       ตัวหนังสือแดงใต้คอลัมน์ · คอลัมน์พื้นเหลือง = `layout` — แสดงผลอย่างเดียว (ตารางสองแกนเท่านั้น)
 *   · เพิ่ม/ลบแถวหรือคอลัมน์ไม่ได้จากจอนี้ (แม่แบบ Excel) — จอแก้ได้แค่ตัวเลขในช่องที่ชีตมี
 *     **ยกเว้นค่านอกแคตตาล็อกของรุ่นที่ตั้ง `askPrice`** (TS_-01 · 2026-09-29) — กล่อง "ต้องขอราคาจากฝ่ายผลิต" ใต้ตาราง (ดู `AskCard`)
 * บันทึกทั้งชีตเป็นครั้งเดียว (`PUT /api/admin/pricebook/sheet/:sheet`) — เหตุผลที่หัว routes/pricingLab.ts
 *
 * ⚠️ ราคาอยู่ใน state ของจอนี้เท่านั้น (โหลดตอนเปิด) — ไม่มีอะไรอยู่ใน bundle ดูหัว ModelPriceEditor.tsx
 */

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : n.toLocaleString('en-US');

/** `undefined` = พิมพ์อะไรที่ไม่ใช่ตัวเลข · `null` = ว่าง */
const parse = (v: string): number | null | undefined => {
  const s = v.replace(/,/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const toNum = (v: string): number | null => parse(v) ?? null;

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** ตัวคั่นคีย์ของช่องในสมุด — ต้องตรงกับที่ engine.ts ประกอบ (`แถว | คอลัมน์` · สามแกน `แถว | เกลียว | ชนิด`) */
const SEP = ' | ';
const cellKey = (r: string, c: string) => `${r}${SEP}${c}`;

const unitOf = (a: EditorAdder) =>
  `บาท / ${a.step && a.step !== 1 ? `${a.step} ` : ''}${a.unit.trim() || 'หน่วย'}`;
/** ช่องราคาของกฎราคาเดียวตามชนิด (เหมา = amount · % = percent · ต่อหน่วย = rate) */
const priceOf = (a: EditorAdder) => (a.kind === 'flat' ? a.amount : a.kind === 'percent' ? a.percent : a.rate);
const unitTxt = (a: EditorAdder) => (a.kind === 'flat' ? 'บาท' : a.kind === 'percent' ? '%' : unitOf(a));
/** เงื่อนไขที่ต้องบอกบนจอ — "ลูกค้าติ๊กตัวเลือก X" ไม่ต้อง (ชื่อรายการบอกอยู่แล้ว) */
const condTh = (a: EditorAdder) => (a.when && !('option' in a.when) ? a.whenTh : '');

/** หนึ่งรุ่นในชีต ระหว่างที่กำลังแก้ — เก็บเป็นข้อความเพราะคนกำลังพิมพ์อยู่ */
interface Draft {
  cells: string[][];
  /** id ของกฎ → ค่าแกน → ราคา */
  rates: Record<string, Record<string, string>>;
  /** id ของกฎราคาเดียว → ราคา */
  prices: Record<string, string>;
  /** ราคาของช่วงขนาด (BH) ตามลำดับช่วง */
  bands: string[];
  /** รุ่น C: % และราคาฝั่งรุ่น C ของกฎ ('' = เท่ารุ่นหลัก) */
  variantPct: string;
  variantPrices: Record<string, string>;
  /** หน้าตาของชีต — ข้อความท้ายแถว (ตามลำดับแถว) · ข้อความใต้คอลัมน์ · ไฮไลต์ (ตามลำดับคอลัมน์) */
  rowNote: string[];
  colNotes: string[];
  highlight: boolean[];
  /** แกนที่เติม → ค่าของแต่ละแถว (ตามลำดับแถว) · '' = ไม่มีค่าเริ่มต้น */
  defaults: Record<string, string[]>;
  /**
   * ค่านอกแคตตาล็อกที่กด "+ เพิ่ม" แล้วยังไม่บันทึก (แกน → ค่า) — แถว/คอลัมน์ใหม่ต่อท้ายของเดิม
   * ⇒ ตำแหน่งใน `cells` / `rowNote` / `defaults` / `colNotes` / `highlight` = ของเดิมก่อน แล้วค่าที่เพิ่มตามลำดับ (`allRows`/`allCols`)
   */
  added: Record<string, string[]>;
  /** ค่านอกแคตตาล็อกที่บันทึกไว้แล้วแต่กด ✕ เอาออก — ยังอยู่ใน `cells` (ตำแหน่งไม่ขยับ) แค่ไม่วาด */
  removed: Record<string, string[]>;
}

/* ── ค่านอกแคตตาล็อก = ต้องขอราคาจากฝ่ายผลิต (`EditorView.askPrice` · เจ้าของเคาะ mockup `ts01-ask-price` แบบ A 2026-09-29) ──
   "ทุกข้อที่ต้องขอราคาจากฝ่ายผลิต ต้องมี ui รองรับให้สามารถเอาราคามาใส่ได้ภายหลังเองได้โดยไม่ต้องมาแก้โค้ดอีก"
   · ตารางหน้าตาเดิม · กล่องแดงใต้ตาราง = ค่านอกแคตตาล็อกที่พบในรหัสจริง (นับสดที่ `GET /unread`) กด "+ เพิ่ม" = ช่องใหม่สีส้ม
   · **ช่องส้มที่ว่าง = ยังขอราคาอยู่** (ไม่ใช่ 0 และไม่ใช่ไม่รับผลิต) · ขนาดแกนใหม่ต้องกรอกอัตราพร้อมกัน (ว่าง = ไม่ถูกเพิ่ม)
   · ตัวรับฝั่งเซิร์ฟเวอร์ตรวจทุกค่าซ้ำด้วยกติกาเดียวกับตัวอ่านรหัส (`askValueProblem`) — จอนี้ไม่ใช่ด่าน */

type AskSlot = NonNullable<EditorView['askPrice']>['slots'][number];

/**
 * ค่าที่พิมพ์เอง → รูปที่ใช้เป็นชื่อช่อง — **ต้องตรงกับ `canonicalAskValue` ฝั่งเซิร์ฟเวอร์ทุกข้อ** (เซิร์ฟเวอร์ปฏิเสธค่าที่ไม่ใช่รูปนี้
 * แทนการแปลงให้เงียบ ๆ เพราะช่องราคาที่กรอกไว้อ้างชื่อนี้) · `1/8` → `1/8”` · `m12x1.5` → `M12x1.5` · `E` → `TSE` · `5.0` → `5`
 */
function canonAsk(slot: AskSlot['slot'], raw: string): string | undefined {
  const s = raw.replace(/[\u201C\u201D\u2033\u00A0]/g, '"').replace(/[\u2018\u2019\u2032]/g, "'").replace(/\s+/g, '');
  if (slot === 'd') {
    if (!/^\d+(\.\d+)?$/.test(s) || Number(s) <= 0 || Number(s) >= 1000) return undefined;
    return String(Number(s));
  }
  if (slot === 'sensor') {
    const u = s.toUpperCase();
    if (u.startsWith('TS')) return /^TS[A-Z]{1,3}$/.test(u) ? u : undefined;
    return /^[A-Z]{1,3}$/.test(u) ? `TS${u}` : undefined;
  }
  const t = s.replace(/"$/, '');
  if (/^\d+\/\d+$/.test(t)) return `${t}”`;
  const m = t.match(/^M(\d+(?:\.\d+)?)(?:X(\d+(?:\.\d+)?))?$/i);
  if (m) return `M${m[1]}${m[2] ? `x${m[2]}` : ''}`;
  return /^[A-Z0-9][A-Z0-9./-]{0,11}$/i.test(t) ? t.toUpperCase() : undefined;
}

const PLACE_TH: Record<AskSlot['place'], string> = { col: 'คอลัมน์ใหม่', row: 'แถวใหม่', rate: 'ช่องในตารางความยาวแกน' };

const rowAxisOf = (v: EditorView) => (v.base.kind === 'matrix' ? v.base.axes[0] : undefined);
const colAxisOf = (v: EditorView) => (v.base.kind === 'matrix' && v.base.axes.length === 2 ? v.base.axes[1] : undefined);
/** แถว/คอลัมน์ทั้งหมดของร่าง (ของเดิม + ที่เพิ่ง "+ เพิ่ม") — ตำแหน่งตรงกับ `d.cells` ทุกช่อง */
const allRows = (v: EditorView, d: Draft) =>
  v.base.kind === 'matrix' ? [...v.base.rows, ...(d.added[rowAxisOf(v)!] ?? [])] : [];
const allCols = (v: EditorView, d: Draft) =>
  v.base.kind === 'matrix' ? [...v.base.cols, ...(colAxisOf(v) ? d.added[colAxisOf(v)!] ?? [] : [])] : [];
const gone = (d: Draft, axis: string | undefined, value: string) => !!axis && (d.removed[axis] ?? []).includes(value);
/** ค่านอกแคตตาล็อก (บันทึกแล้ว หรือเพิ่งเพิ่ม) — ระบายส้ม */
const offCat = (v: EditorView, d: Draft, axis: string | undefined, value: string) =>
  !!axis && ((v.askPrice?.off[axis] ?? []).includes(value) || (d.added[axis] ?? []).includes(value));
/** ช่องของแกนนี้ในกล่องขอราคา */
const slotOfAxis = (v: EditorView, axis: string | null | undefined) => v.askPrice?.slots.find((s) => s.axis === axis);

/** "+ เพิ่ม" — แถว/คอลัมน์ใหม่ว่างทั้งแถว · ขนาดแกนใหม่ได้ช่องอัตราว่าง · ค่าที่เพิ่ง ✕ ไปแค่เอากลับมา */
function addAsk(v: EditorView, d: Draft, slot: AskSlot, value: string): Draft {
  if (gone(d, slot.axis, value)) return { ...d, removed: { ...d.removed, [slot.axis]: d.removed[slot.axis]!.filter((x) => x !== value) } };
  const added = { ...d.added, [slot.axis]: [...(d.added[slot.axis] ?? []), value] };
  if (slot.place === 'rate') {
    return { ...d, added, rates: { ...d.rates, [slot.adder!]: { ...d.rates[slot.adder!], [value]: '' } } };
  }
  const width = allCols(v, d).length;
  if (slot.place === 'row') {
    // ค่าเริ่มต้นตามแถว (ชนิดสายมาตรฐาน) — ใช้ค่าที่แถวเดิมใช้มากที่สุด แก้ได้ในคอลัมน์นั้นก่อนบันทึก
    const common = (vals: string[]) => {
      const n = new Map<string, number>();
      for (const x of vals) if (x) n.set(x, (n.get(x) ?? 0) + 1);
      return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    };
    return {
      ...d,
      added,
      cells: [...d.cells, Array.from({ length: width }, () => '')],
      rowNote: [...d.rowNote, ''],
      defaults: Object.fromEntries(Object.entries(d.defaults).map(([k, vals]) => [k, [...vals, common(vals)]])),
    };
  }
  return { ...d, added, cells: d.cells.map((row) => [...row, '']), colNotes: [...d.colNotes, ''], highlight: [...d.highlight, false] };
}

/** ✕ — ค่าที่เพิ่งเพิ่มหายไปทั้งแถว/คอลัมน์ · ค่าที่บันทึกแล้วจำไว้ว่าเอาออก (ขนาดแกน = ล้างอัตรา = คีย์หายตอนบันทึก) */
function removeAsk(v: EditorView, d: Draft, slot: AskSlot, value: string): Draft {
  const mine = d.added[slot.axis] ?? [];
  const k = mine.indexOf(value);
  if (k < 0) {
    const removed = { ...d.removed, [slot.axis]: [...(d.removed[slot.axis] ?? []), value] };
    if (slot.place === 'rate') return { ...d, removed, rates: { ...d.rates, [slot.adder!]: { ...d.rates[slot.adder!], [value]: '' } } };
    return { ...d, removed };
  }
  const added = { ...d.added, [slot.axis]: mine.filter((x) => x !== value) };
  if (slot.place === 'rate') {
    const rest = { ...(d.rates[slot.adder!] ?? {}) };
    delete rest[value];
    return { ...d, added, rates: { ...d.rates, [slot.adder!]: rest } };
  }
  const base = v.base.kind === 'matrix' ? (slot.place === 'row' ? v.base.rows.length : v.base.cols.length) : 0;
  const at = base + k;
  const cut = <T,>(list: T[]) => list.filter((_, i) => i !== at);
  if (slot.place === 'row') {
    return {
      ...d,
      added,
      cells: cut(d.cells),
      rowNote: cut(d.rowNote),
      defaults: Object.fromEntries(Object.entries(d.defaults).map(([key, vals]) => [key, cut(vals)])),
    };
  }
  return { ...d, added, cells: d.cells.map(cut), colNotes: cut(d.colNotes), highlight: cut(d.highlight) };
}

/** กฎที่เป็นคอลัมน์ในตารางหลัก (แยกตามแกนแถว) — ซ้าย = "บวกเพิ่ม 100 mm ละ" · ขวา = ที่เหลือ */
function rowAdders(v: EditorView) {
  if (v.base.kind !== 'matrix') return { left: [] as EditorAdder[], right: [] as EditorAdder[] };
  const rowAx = v.base.axes[0];
  const byRow = v.adders.filter((a) => a.rates && a.byAxis === rowAx);
  const left = byRow.filter((a) => a.kind === 'perUnit' && !a.when);
  return { left, right: byRow.filter((a) => !left.includes(a)) };
}

/**
 * แถวของตารางหลัก = แถวของราคาตั้ง + ค่าที่มีแค่ในคอลัมน์บวกเพิ่ม (7TN) แทรกต่อจากค่าก่อนหน้าในลำดับของกฎ
 * — ไม่งั้นราคาบวกเพิ่มของแถวนั้นมองไม่เห็นบนจอทั้งที่คิดเงินอยู่
 */
function gridRows(v: EditorView): { rows: string[]; extra: Set<string> } {
  if (v.base.kind !== 'matrix') return { rows: [], extra: new Set() };
  const rows = [...v.base.rows];
  const extra = new Set<string>();
  const { left, right } = rowAdders(v);
  for (const a of [...left, ...right]) {
    let prev: string | undefined;
    for (const { value } of a.rates!) {
      if (!rows.includes(value)) {
        rows.splice(prev === undefined ? 0 : rows.indexOf(prev) + 1, 0, value);
        extra.add(value);
      }
      prev = value;
    }
  }
  return { rows, extra };
}

function toDraft(v: EditorView): Draft {
  const rows = v.base.kind === 'matrix' ? v.base.rows : [];
  const cols = v.base.kind === 'matrix' ? v.base.cols : [];
  const L = v.layout;
  return {
    rowNote: rows.map((r) => L.rowNote?.values[r] ?? ''),
    colNotes: cols.map((c) => L.colNotes[c] ?? ''),
    highlight: cols.map((c) => L.highlightCols.includes(c)),
    defaults: Object.fromEntries(v.defaultsBy.map((d) => [d.axis, rows.map((r) => d.values[r] ?? '')])),
    cells: v.base.kind === 'matrix' && v.base.cells ? v.base.cells.map((row) => row.map(str)) : [],
    rates: Object.fromEntries(
      v.adders.filter((a) => a.rates).map((a) => [a.id, Object.fromEntries(a.rates!.map((r) => [r.value, str(r.rate)]))]),
    ),
    prices: Object.fromEntries(v.adders.filter((a) => !a.rates).map((a) => [a.id, str(priceOf(a))])),
    bands: v.base.kind === 'banded' ? v.base.bands.map((b) => str(b.price)) : [],
    variantPct: str(v.variant?.percent ?? 0),
    variantPrices: Object.fromEntries(
      v.adders.filter((a) => !a.rates).map((a) => [a.id, str(v.variant?.adderPrices?.[a.id])]),
    ),
    added: {},
    removed: {},
  };
}

/**
 * ค่าแกนของกฎหนึ่งข้อที่จอมีช่องให้ — กฎในตารางหลัก = ทุกแถวของตาราง · ที่เหลือ = ค่าที่สมุดรู้จัก
 * + ขนาดนอกแคตตาล็อกที่เพิ่งกด "+ เพิ่ม" ของกฎที่เป็นช่องของกล่องขอราคา (ขนาดแกนของ TS_-01)
 */
function rateKeys(v: EditorView, a: EditorAdder, d?: Draft): string[] {
  const own = a.rates!.map((r) => r.value);
  const slot = slotOfAxis(v, a.byAxis);
  const extra = d && slot?.place === 'rate' && slot.adder === a.id ? d.added[slot.axis] ?? [] : [];
  if (v.base.kind !== 'matrix' || a.byAxis !== v.base.axes[0]) return [...own, ...extra.filter((x) => !own.includes(x))];
  return [...new Set([...gridRows(v).rows, ...own])];
}
const rateWas = (a: EditorAdder, k: string) => a.rates!.find((r) => r.value === k)?.rate ?? null;

/**
 * เลขที่เปลี่ยนเกิน 3 เท่า (ขึ้นหรือลง) = น่าจะพิมพ์ผิด (ศูนย์เกิน/ขาดหนึ่งตัว) — เตือนในหน้าตรวจ ไม่บล็อก
 * เพราะราคาที่ขึ้นจริงแรง ๆ ก็มีได้ แต่คนกดบันทึกต้องเห็นก่อน
 */
const suspicious = (was: number | null, now: number | null) =>
  was !== null && now !== null && was > 0 && (now > was * 3 || now * 3 < was);
const JUMP = ' ⚠ เปลี่ยนเกิน 3 เท่า — พิมพ์ผิดหรือเปล่า?';

/** ช่องที่บันทึกไม่ได้ — ไม่ใช่ตัวเลข หรือราคาของสิ่งที่ต้องบวกเพิ่มที่ถูกลบจนว่าง */
function invalidCells(models: EditorView[], drafts: Record<string, Draft>): string[] {
  const out: string[] = [];
  const bad = (what: string, s: string | undefined) => { if (s !== undefined && parse(s) === undefined) out.push(`${what} “${s}” ไม่ใช่ตัวเลข`); };
  for (const v of models) {
    const d = drafts[v.code];
    if (!d) continue;
    if (v.base.kind === 'matrix') {
      const rows = allRows(v, d);
      const cols = allCols(v, d);
      rows.forEach((r, i) => cols.forEach((c, j) => bad(`${v.title} ${r} × ${c.split(SEP).join(' ')}`, d.cells[i]?.[j])));
    }
    if (v.base.kind === 'banded') v.base.bands.forEach((b, i) => bad(`${v.title} ช่วง ${b.label}`, d.bands[i]));
    for (const a of v.adders) {
      if (a.rates) {
        for (const k of rateKeys(v, a, d)) bad(`${v.title} ${a.label} ${k}`, d.rates[a.id]?.[k]);
      } else {
        const s = d.prices[a.id] ?? '';
        if (parse(s) === null) out.push(`${v.title} ${a.label} — ราคาว่างไม่ได้ (จะเลิกคิดรายการนี้ ให้ปิดกฎที่ปุ่ม “กฎและเงื่อนไข”)`);
        else bad(`${v.title} ${a.label}`, s);
        if (v.variant) bad(`${v.title} ${a.label} รุ่น ${v.variant.suffix}`, d.variantPrices[a.id]);
      }
    }
    if (v.variant) {
      if (parse(d.variantPct) === null) out.push(`${v.title} รุ่น ${v.variant.suffix} — ช่อง % ว่างไม่ได้ (ไม่บวกเพิ่มให้ใส่ 0)`);
      else bad(`${v.title} รุ่น ${v.variant.suffix} %`, d.variantPct);
    }
  }
  return out;
}

function buildDiff(models: EditorView[], drafts: Record<string, Draft>): DiffRow[] {
  const rows: DiffRow[] = [];
  const priceRow = (what: string, was: number | null, now: number | null, emptyTh: string, unit = '') => {
    if (was === now) return;
    rows.push({
      what,
      was: was === null ? `ว่าง (${emptyTh})` : `${fmt(was)}${unit}`,
      now: now === null ? `ว่าง — ${emptyTh}` : `${fmt(now)}${unit}${suspicious(was, now) ? JUMP : ''}`,
      warn: now === null || suspicious(was, now),
    });
  };
  for (const v of models) {
    const d = drafts[v.code];
    if (!d) continue;
    if (v.base.kind === 'matrix' && v.base.cells) {
      const { cells } = v.base;
      const rA = rowAxisOf(v);
      const cA = colAxisOf(v);
      // ค่านอกแคตตาล็อกที่เพิ่ม/เอาออก — บอกเป็นบรรทัดของตัวเองก่อนตัวเลข
      for (const s of v.askPrice?.slots ?? []) {
        for (const x of d.added[s.axis] ?? []) {
          const rate = s.place === 'rate' ? toNum(d.rates[s.adder!]?.[x] ?? '') : undefined;
          rows.push({
            what: `${v.title} · เพิ่ม${s.axisTh} ${x} (นอกแคตตาล็อก)`,
            was: '—',
            now: s.place !== 'rate' ? `${PLACE_TH[s.place]} — ช่องที่ยังว่าง = ต้องขอราคา`
              : rate === null ? 'ไม่ถูกเพิ่ม — ยังไม่ได้กรอกอัตรา' : 'เพิ่มพร้อมอัตรา',
            warn: rate === null,
          });
        }
        for (const x of d.removed[s.axis] ?? []) {
          rows.push({ what: `${v.title} · เอา${s.axisTh} ${x} ออก`, was: 'นอกแคตตาล็อก', now: 'เอาออก — รหัสที่ใช้ค่านี้กลับไปขึ้น “ต้องขอราคา”' });
        }
      }
      const rs = allRows(v, d);
      const cols = allCols(v, d);
      rs.forEach((r, i) => cols.forEach((c, j) => {
        if (gone(d, rA, r) || gone(d, cA, c)) return;
        const ask = offCat(v, d, rA, r) || offCat(v, d, cA, c);
        priceRow(`${v.title} · ราคาตั้ง ${r} × ${c.split(SEP).join(' ')}`, cells[i]?.[j] ?? null, toNum(d.cells[i]![j]!), ask ? 'ต้องขอราคา' : 'ไม่รับผลิต');
      }));
    }
    if (v.base.kind === 'banded') {
      const b = v.base;
      b.bands.forEach((bd, i) => {
        priceRow(`${v.title} · ราคาตั้ง ช่วง ${bd.label} ${b.unit}`, bd.price, toNum(d.bands[i] ?? ''), 'ไม่รับผลิต',
          bd.kind === 'rate' ? ` บาท / ${b.unit}` : '');
      });
    }
    if (v.base.kind === 'matrix') {
      const rs = allRows(v, d);
      const cols = allCols(v, d);
      const L = v.layout;
      for (const df of v.defaultsBy) {
        rs.forEach((r, i) => {
          if (gone(d, rowAxisOf(v), r)) return;
          const was = df.values[r] ?? '';
          const now = d.defaults[df.axis]?.[i] ?? '';
          if (was !== now) {
            rows.push({
              what: `${v.title} · ${df.label} ${r} (มีผลกับราคา)`,
              was: was || 'ไม่มี',
              now: now || 'ไม่มี — รหัสที่ไม่บอกต้องระบุเอง',
              warn: !now,
            });
          }
        });
      }
      rs.forEach((r, i) => {
        if (gone(d, rowAxisOf(v), r)) return;
        const was = L.rowNote?.values[r] ?? '';
        const now = d.rowNote[i]!.trim();
        if (was !== now) rows.push({ what: `${v.title} · ${L.rowNote?.label ?? 'หมายเหตุ'} ${r}`, was: was || 'ว่าง', now: now || 'ว่าง' });
      });
      cols.forEach((c, j) => {
        if (gone(d, colAxisOf(v), c)) return;
        const was = L.colNotes[c] ?? '';
        const now = d.colNotes[j]!.trim();
        if (was !== now) rows.push({ what: `${v.title} · ข้อความใต้คอลัมน์ ${c}`, was: was || 'ว่าง', now: now || 'ว่าง' });
        const hw = L.highlightCols.includes(c);
        if (hw !== d.highlight[j]) {
          rows.push({ what: `${v.title} · ไฮไลต์เหลืองคอลัมน์ ${c}`, was: hw ? 'ไฮไลต์' : 'ไม่ไฮไลต์', now: d.highlight[j] ? 'ไฮไลต์' : 'ไม่ไฮไลต์' });
        }
      });
    }
    for (const a of v.adders) {
      if (a.rates) {
        for (const k of rateKeys(v, a, d)) {
          priceRow(`${v.title} · ${a.label} · ${a.byAxisTh ?? ''} ${k || '(ว่าง)'}`.replace(/\s+/g, ' '),
            rateWas(a, k), toNum(d.rates[a.id]?.[k] ?? ''), 'ต้องขอราคา', ` ${unitOf(a)}`);
        }
      } else {
        priceRow(`${v.title} · ${a.label}`, priceOf(a), toNum(d.prices[a.id] ?? ''), priceOf(a) === null ? 'ยังไม่มีราคา' : 'บันทึกไม่ได้', ` ${unitTxt(a)}`);
      }
    }
    if (v.variant) {
      const vr = v.variant;
      const pct = toNum(d.variantPct);
      if ((vr.percent ?? 0) !== pct) {
        rows.push({ what: `${v.title} · ${v.code}${vr.suffix} บวกเพิ่มจากราคาตั้ง`, was: `${vr.percent ?? 0}%`, now: `${pct ?? '—'}%` });
      }
      for (const a of v.adders.filter((x) => !x.rates)) {
        const was = vr.adderPrices?.[a.id] ?? null;
        const now = toNum(d.variantPrices[a.id] ?? '');
        if (was === now) continue;
        rows.push({
          what: `${v.title} · ${v.code}${vr.suffix} ${a.label}`,
          was: was === null ? 'เท่ารุ่นหลัก' : fmt(was),
          now: now === null ? 'กลับไปคิดเท่ารุ่นหลัก' : fmt(now),
        });
      }
    }
  }
  return rows;
}

/** ส่งเฉพาะช่องที่เปลี่ยน — ช่องที่ไม่ได้ส่ง backend คงค่าเดิมให้ */
function buildBody(models: EditorView[], drafts: Record<string, Draft>) {
  type Layout = { rowNote: Record<string, string>; colNotes: Record<string, string>; highlightCols: string[] };
  const out: Record<string, Record<string, unknown>> = {};
  for (const v of models) {
    const d = drafts[v.code];
    if (!d) continue;
    const body: Record<string, unknown> = {};
    const cells: Record<string, number | null> = {};
    if (v.base.kind === 'matrix' && v.base.cells) {
      const { cells: was } = v.base;
      // รวมแถว/คอลัมน์ที่เพิ่งเพิ่ม (ช่องใหม่ส่งเฉพาะที่กรอก) และที่กด ✕ (ตัวเลขที่ล้างไปต้องส่ง null ไปด้วย)
      allRows(v, d).forEach((r, i) => allCols(v, d).forEach((c, j) => {
        const now = toNum(d.cells[i]![j]!);
        if ((was[i]?.[j] ?? null) !== now) cells[cellKey(r, c)] = now;
      }));
    }
    if (Object.keys(cells).length) body.cells = cells;
    // ค่านอกแคตตาล็อก (แถว/คอลัมน์) — ขนาดแกนไปกับอัตราใน `adderRates` (ว่าง = ไม่ถูกเพิ่ม)
    const addValues: Record<string, string[]> = {};
    const removeValues: Record<string, string[]> = {};
    for (const s of v.askPrice?.slots ?? []) {
      if (s.place === 'rate') continue;
      if (d.added[s.axis]?.length) addValues[s.axis] = d.added[s.axis]!;
      if (d.removed[s.axis]?.length) removeValues[s.axis] = d.removed[s.axis]!;
    }
    if (Object.keys(addValues).length) body.addValues = addValues;
    if (Object.keys(removeValues).length) body.removeValues = removeValues;
    if (v.base.kind === 'banded') {
      const bandPrices: Record<string, number | null> = {};
      v.base.bands.forEach((b, i) => {
        const now = toNum(d.bands[i] ?? '');
        if (b.price !== now) bandPrices[String(i)] = now;
      });
      if (Object.keys(bandPrices).length) body.bandPrices = bandPrices;
    }
    const adderRates: Record<string, { value: string; rate: number | null }[]> = {};
    const adderPrices: Record<string, number | null> = {};
    for (const a of v.adders) {
      if (a.rates) {
        const changed = rateKeys(v, a, d)
          .map((k) => ({ value: k, rate: toNum(d.rates[a.id]?.[k] ?? '') }))
          .filter((r) => r.rate !== rateWas(a, r.value));
        if (changed.length) adderRates[a.id] = changed;
      } else {
        const now = toNum(d.prices[a.id] ?? '');
        if (now !== priceOf(a)) adderPrices[a.id] = now;
      }
    }
    if (Object.keys(adderRates).length) body.adderRates = adderRates;
    if (Object.keys(adderPrices).length) body.adderPrices = adderPrices;
    // รุ่น C ส่งทั้งก้อนเมื่อมีอะไรเปลี่ยน (รูปเดียวกับหน้าแก้ทีละรุ่น) — ราคาของกฎที่จอนี้ไม่ได้แสดงคงเดิม
    if (v.variant) {
      const vr = v.variant;
      const prices: Record<string, number> = { ...(vr.adderPrices ?? {}) };
      for (const a of v.adders.filter((x) => !x.rates)) {
        const n = toNum(d.variantPrices[a.id] ?? '');
        if (n === null) delete prices[a.id];
        else prices[a.id] = n;
      }
      const pct = toNum(d.variantPct) ?? 0;
      if (pct !== (vr.percent ?? 0) || JSON.stringify(prices) !== JSON.stringify(vr.adderPrices ?? {})) {
        body.variant = { suffix: vr.suffix, label: vr.label, percent: pct, disabled: !!vr.disabled, adderPrices: prices };
      }
    }
    // หน้าตาของชีตส่งทั้งชุดเมื่อมีอะไรเปลี่ยน (ชุดเล็ก — backend เรียงตามลำดับแถว/คอลัมน์ให้เอง)
    if (v.base.kind === 'matrix' && v.base.axes.length === 2) {
      const rs = allRows(v, d);
      const cols = allCols(v, d);
      const next: Layout = {
        rowNote: Object.fromEntries(rs.map((r, i) => [r, d.rowNote[i]!.trim()]).filter(([, t]) => t)),
        colNotes: Object.fromEntries(cols.map((c, j) => [c, d.colNotes[j]!.trim()]).filter(([, t]) => t)),
        highlightCols: cols.filter((_, j) => d.highlight[j]),
      };
      const L = v.layout;
      const same = JSON.stringify(next.rowNote) === JSON.stringify(L.rowNote?.values ?? {})
        && JSON.stringify(next.colNotes) === JSON.stringify(L.colNotes)
        && JSON.stringify(next.highlightCols) === JSON.stringify(L.highlightCols);
      if (!same) body.layout = next;
    }
    if (v.base.kind === 'matrix') {
      const rs = allRows(v, d);
      const keep = (r: string) => !gone(d, rowAxisOf(v), r);
      let defaultsBy: Record<string, Record<string, string>> | undefined;
      for (const df of v.defaultsBy) {
        const now = d.defaults[df.axis] ?? [];
        if (rs.some((r, i) => keep(r) && (df.values[r] ?? '') !== (now[i] ?? ''))) {
          defaultsBy = { ...defaultsBy, [df.axis]: Object.fromEntries(rs.map((r, i) => [r, now[i] ?? '']).filter(([r]) => keep(r!))) };
        }
      }
      if (defaultsBy) body.defaultsBy = defaultsBy;
    }
    if (Object.keys(body).length) out[v.code] = body;
  }
  return out;
}

/* ── ช่องราคาในตาราง ─────────────────────────────────────────────────────────
   หน้าตาแบบเซลล์ของชีต: ตัวช่องคือเส้นตาราง ไม่ใช่กล่องกรอกลอยอยู่ในช่อง */

/*  สีที่ต้องไม่ปนกัน: **เหลือง = คอลัมน์ที่ไฟล์ราคาไฮไลต์ไว้** (สีเดียวกับในไฟล์) ·
    **ฟ้า = ช่องที่แก้แล้วยังไม่บันทึก** (หน้านี้เท่านั้นที่ไม่ใช้เหลืองแบบหน้าแก้ทีละรุ่น เพราะเหลืองมีความหมายแล้ว) ·
    **แดง = พิมพ์ไม่ใช่ตัวเลข / ว่างไม่ได้** · เขียวอ่อน = คอลัมน์ "บวกเพิ่ม 100 mm ละ" (พื้นเดียวกับในไฟล์) */
const GridInput: React.FC<{
  value: string;
  was: string;
  label: string;
  highlight?: boolean;
  tint?: boolean;
  required?: boolean;
  /** ช่องที่ยังไม่มีราคาโดยตั้งใจ (กฎที่ตั้งโครงไว้ก่อน เช่น PL-5 ของ BH) — ว่างได้ และทาสีเหลืองให้เห็นว่ารอกรอก */
  pending?: boolean;
  /** ช่องของค่านอกแคตตาล็อก — ว่าง = ต้องขอราคาจากฝ่ายผลิต · ทาสีส้ม (สีเดียวกับหัวคอลัมน์/แถวที่เพิ่ม) */
  ask?: boolean;
  placeholder?: string;
  emptyTitle?: string;
  onChange: (v: string) => void;
}> = ({ value, was, label, highlight, tint, required, pending, ask, placeholder = '—', emptyTitle = 'ว่าง = ไม่รับผลิต (ไม่ใช่ราคา 0)', onChange }) => {
  const p = parse(value);
  const invalid = p === undefined || (required && p === null);
  const changed = toNum(value) !== toNum(was) || invalid;
  const empty = value.trim() === '';
  return (
    <td className={`border border-slate-200 p-0 ${invalid ? 'bg-red-50' : changed ? 'bg-blue-50' : ask ? 'bg-orange-50' : pending && empty ? 'bg-amber-50' : highlight ? 'bg-yellow-200' : tint ? 'bg-emerald-50/60' : ''}`}>
      <input
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid || undefined}
        title={empty ? `${label} — ${emptyTitle}` : label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        // แบบ Excel: คลิกช่องแล้วพิมพ์ทับได้เลย — ไม่งั้นเลขใหม่ไปต่อท้ายเลขเดิม (250 → 250260)
        onFocus={(e) => e.currentTarget.select()}
        className={`block w-full min-w-[68px] bg-transparent px-2.5 py-2 text-center text-[13.5px] tabular-nums outline-none ${ask && empty ? 'placeholder:text-orange-700 placeholder:text-[12px]' : pending && empty ? 'placeholder:text-amber-700 placeholder:text-[12px]' : 'placeholder:text-slate-300'} focus:bg-card focus:ring-2 focus:ring-inset focus:ring-[var(--brand-border-strong)] ${
          invalid ? 'font-bold text-red-700' : changed ? 'font-bold text-blue-700' : 'text-slate-900'
        }`}
      />
    </td>
  );
};

/** ช่องในแถวที่ตารางราคาตั้งไม่มี (7TN) — เพิ่มแถวทำผ่านแม่แบบ Excel */
const NoCell: React.FC = () => (
  <td className="border border-slate-200 bg-slate-50" title="แถวนี้ไม่มีในตารางราคาตั้ง — เพิ่มผ่านแม่แบบ Excel" />
);

const TH_HEAD = 'border border-slate-200 bg-emerald-100 px-3 py-1.5 text-center font-bold text-emerald-800';

/* ── ของรอบตาราง ─────────────────────────────────────────────────────────── */

type Patch = (fn: (d: Draft) => Draft) => void;

/** "สิ่งที่ต้องบวกเพิ่ม" ราคาเดียว — ตารางเล็กพื้นเหลืองแบบในชีต · รุ่นที่มีตัวเลือกท้ายรหัสมีคอลัมน์ราคารุ่น C */
const ExtrasBox: React.FC<{ v: EditorView; d: Draft; patch: Patch }> = ({ v, d, patch }) => {
  const list = v.adders.filter((a) => !a.rates);
  if (!list.length) return null;
  const vr = v.variant;
  return (
    <div className="max-w-full overflow-x-auto rounded-xl border border-amber-300">
      <table className="border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="border border-amber-300 bg-yellow-200 px-3 py-1.5 text-left font-bold text-slate-800 whitespace-nowrap">สิ่งที่ต้องบวกเพิ่ม</th>
            <th className="border border-amber-300 bg-yellow-200 px-3 py-1.5 text-center font-bold text-slate-800">ราคาตั้ง</th>
            <th className="border border-amber-300 bg-yellow-200 px-3 py-1.5 text-center font-bold text-slate-800">หน่วย</th>
            {vr && (
              <th className="border border-amber-300 bg-yellow-200 px-3 py-1.5 text-center font-bold text-slate-800 whitespace-nowrap">
                {v.code}{vr.suffix}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.id}>
              <th scope="row" className={`border border-slate-200 bg-card px-3 py-1.5 text-left font-semibold min-w-[150px] max-w-[260px] ${a.disabled ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                {a.label}
                {a.disabled && <span className="ml-1.5 text-[10.5px] font-normal no-underline text-slate-400">(ปิดอยู่)</span>}
                {condTh(a) && <span className="block text-[11px] font-normal text-slate-500">เมื่อ {condTh(a)}</span>}
              </th>
              {/* กฎที่ยังไม่เคยมีราคา (PL-5 ของ BH · เจ้าของ 2026-09-29 "ทำโครงไว้ให้พิมพ์ค่าภายหลัง") ว่างได้ = ยังไม่มีราคา ·
                  กรอกแล้วกลับเป็นช่องห้ามว่างเหมือนแถวอื่น (backend ปฏิเสธการลบราคาที่เคยมี) */}
              <GridInput
                label={`${v.title} ${a.label}`}
                value={d.prices[a.id] ?? ''}
                was={str(priceOf(a))}
                required={priceOf(a) !== null}
                pending={priceOf(a) === null}
                placeholder={priceOf(a) === null ? 'ยังไม่มีราคา' : undefined}
                emptyTitle={priceOf(a) === null ? 'ว่าง = ยังไม่มีราคา (ไม่ใช่ 0) — กรอกเมื่อได้ราคา' : 'ว่างไม่ได้ — จะเลิกคิดให้ปิดกฎที่ปุ่ม “กฎและเงื่อนไข”'}
                onChange={(val) => patch((x) => ({ ...x, prices: { ...x.prices, [a.id]: val } }))}
              />
              <td className="border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-500 whitespace-nowrap">{unitTxt(a)}</td>
              {vr && (
                <GridInput
                  label={`${v.title} ${v.code}${vr.suffix} ${a.label}`}
                  value={d.variantPrices[a.id] ?? ''}
                  was={str(vr.adderPrices?.[a.id])}
                  pending={toNum(d.prices[a.id] ?? '') === null}
                  placeholder={toNum(d.prices[a.id] ?? '') === null ? 'ยังไม่มีราคา' : fmt(toNum(d.prices[a.id] ?? ''))}
                  emptyTitle="ว่าง = ราคาเท่ารุ่นหลัก"
                  onChange={(val) => patch((x) => ({ ...x, variantPrices: { ...x.variantPrices, [a.id]: val } }))}
                />
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {vr && (
        <p className="border-t border-amber-200 bg-yellow-50 px-3 py-1 text-[11px] text-slate-500">
          ช่อง {v.code}{vr.suffix} ว่าง (เลขจาง) = ราคาเท่ารุ่นหลัก
        </p>
      )}
    </div>
  );
};

/**
 * กฎที่แยกตามแกนที่ไม่ใช่ของตาราง (หน้าแปลน TS-18 · ความยาวแกนของ TS_-01) — ตารางเล็กแยกตามค่า แบบ "ราคาหน้าแปลน" ในชีต
 * กฎที่เป็นช่องของกล่องขอราคา (ขนาดแกน TS_-01) มีแถวนอกแคตตาล็อกสีส้ม + ✕ และแถวที่เพิ่งเพิ่มต้องกรอกอัตรา (ว่าง = ไม่ถูกเพิ่ม)
 */
const AxisBox: React.FC<{ v: EditorView; a: EditorAdder; d: Draft; patch: Patch }> = ({ v, a, d, patch }) => {
  const slot = slotOfAxis(v, a.byAxis);
  const mine = slot?.place === 'rate' && slot.adder === a.id ? slot : undefined;
  const keys = rateKeys(v, a, d).filter((k) => !mine || !gone(d, mine.axis, k));
  const was = (k: string) => a.rates!.find((r) => r.value === k)?.rate ?? null;
  return (
  <div className="max-w-full overflow-x-auto rounded-xl border border-amber-300">
    <table className="border-collapse text-[13px]">
      <thead>
        <tr>
          <th colSpan={2} className="border border-amber-300 bg-yellow-200 px-3 py-1.5 text-center font-bold text-slate-800">
            {a.label}{condTh(a) && <span className="block text-[11px] font-normal text-slate-500">เมื่อ {condTh(a)}</span>}
          </th>
        </tr>
        <tr>
          <th className="border border-amber-300 bg-yellow-50 px-3 py-1 text-left font-semibold text-slate-700">{a.byAxisTh ?? 'ชนิด'}</th>
          <th className="border border-amber-300 bg-yellow-50 px-3 py-1 text-center font-semibold text-slate-700">{unitTxt(a)}</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const off = !!mine && offCat(v, d, mine.axis, k);
          const fresh = !!mine && (d.added[mine.axis] ?? []).includes(k);
          return (
            <tr key={k}>
              <th scope="row" className={`border border-slate-200 px-3 py-1.5 text-left font-semibold whitespace-nowrap ${off ? 'bg-orange-50 text-orange-800' : 'bg-card text-slate-800'}`}>
                {k || '(ว่าง)'}
                {off && <span className="ml-1.5 text-[10px] font-normal">นอกแคตตาล็อก</span>}
                {off && (
                  <button type="button" onClick={() => patch((x) => removeAsk(v, x, mine!, k))}
                          aria-label={`เอา${mine!.axisTh} ${k} ออก`} title={`เอา${mine!.axisTh} ${k} ออก`}
                          className="ml-1 text-[12px] text-slate-500 hover:text-red-600">✕</button>
                )}
              </th>
              <GridInput
                label={`${v.title} ${a.label} — ${k}`}
                value={d.rates[a.id]?.[k] ?? ''}
                was={str(was(k))}
                ask={off && !(d.rates[a.id]?.[k] ?? '').trim()}
                placeholder={fresh ? 'กรอกอัตรา' : undefined}
                emptyTitle={fresh ? 'ต้องกรอกอัตราพร้อมกัน — ว่างแล้วบันทึก = ไม่ถูกเพิ่ม' : 'ว่าง = ต้องขอราคา (ไม่ใช่ฟรี)'}
                onChange={(val) => patch((x) => ({ ...x, rates: { ...x.rates, [a.id]: { ...x.rates[a.id], [k]: val } } }))}
              />
            </tr>
          );
        })}
      </tbody>
    </table>
    {mine && (
      <p className="border-t border-amber-200 bg-yellow-50 px-3 py-1 text-[11px] leading-relaxed text-slate-500 max-w-[320px]">
        {mine.axisTh}ที่ไม่มีในตาราง: เล็กกว่า = ใช้อัตราของขนาดถัดขึ้นไป · ใหญ่กว่าขนาดที่มีอัตรา = ต้องขอราคา ·
        ขนาดที่เพิ่มใหม่ต้องกรอกอัตราพร้อมกัน แล้วคิดราคาตั้งของคอลัมน์เกลียวเดิม + อัตรานี้
      </p>
    )}
  </div>
  );
};

/** แถบหมายเหตุใต้ตาราง — ในชีตเป็นแถบสีส้ม "สายยาวกว่า 1 M บวกเพิ่มตามราคาสาย"
    ราคาสายจริงอยู่อีกชีต (TS-21+22+25) ซึ่งสมุดลอกมาไว้ในกฎของแต่ละรุ่น ⇒ วางให้แก้ตรงนี้เลย */
const CableBar: React.FC<{ v: EditorView; a: EditorAdder; d: Draft; patch: Patch }> = ({ v, a, d, patch }) => (
  <div className="mt-3.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
    <div className="text-[13px] font-bold text-amber-800">หมายเหตุ : {a.label}</div>
    <div className="mt-2 overflow-x-auto">
      <table className="border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="border border-amber-200 bg-card px-3 py-1.5 text-left font-bold text-slate-700 whitespace-nowrap">
              {a.byAxisTh ?? 'ชนิด'}
            </th>
            {a.rates!.map((r) => (
              <th key={r.value} className="border border-amber-200 bg-card px-3 py-1.5 text-center font-semibold text-slate-700 whitespace-nowrap">
                {r.value || '(ว่าง)'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="border border-amber-200 bg-card px-3 py-1.5 text-left font-normal text-slate-500 whitespace-nowrap">
              {unitOf(a)}
            </th>
            {a.rates!.map((r) => (
              <GridInput
                key={r.value}
                label={`${v.title} ${a.label} — ${r.value}`}
                value={d.rates[a.id]?.[r.value] ?? ''}
                was={str(r.rate)}
                emptyTitle="ว่าง = ต้องขอราคา (ไม่ใช่ฟรี)"
                onChange={(val) => patch((x) => ({ ...x, rates: { ...x.rates, [a.id]: { ...x.rates[a.id], [r.value]: val } } }))}
              />
            ))}
          </tr>
        </tbody>
      </table>
    </div>
    <p className="mt-1.5 text-[11px] text-amber-700">
      ช่องว่าง = สายชนิดนั้นต้องขอราคา (ไม่ใช่ฟรี)
      {a.source?.includes('TS-21+22+25') && <> · ราคาสายลอกมาจากชีต <span className="font-mono">TS-21+22+25</span> — แก้ตรงนี้มีผลกับ {v.title} เท่านั้น</>}
    </p>
  </div>
);

/** ข้อจำกัด · สูตร · ค่ามาตรฐาน — ตัวหนังสือใต้ตาราง (แสดงอย่างเดียว · แก้ที่ "กฎและเงื่อนไข") */
const Notes: React.FC<{ v: EditorView }> = ({ v }) => {
  const items: React.ReactNode[] = [];
  for (const c of v.constraints) {
    items.push(
      <li key={`c-${c.id}`} className={c.disabled ? 'text-slate-400 line-through' : c.level === 'warn' ? 'text-slate-700' : 'text-red-600'}>
        <b>{c.levelTh}</b> — {c.message}{c.disabled && <span className="no-underline"> (ปิดอยู่)</span>}
      </li>,
    );
  }
  v.derived.forEach((dv, i) => {
    items.push(
      <li key={`d-${i}`} className="text-slate-700">
        {dv.label} = {dv.formulaTh} ({dv.argsTh}){dv.consts && <> · {dv.consts}</>}{dv.whenTh && <> · เมื่อ {dv.whenTh}</>}
      </li>,
    );
  });
  for (const ad of v.axisDefaults ?? []) {
    items.push(<li key={`a-${ad.axis}`} className="text-slate-700">รหัสที่ไม่ได้บอก{ad.axisTh} คิดด้วย <b>{ad.value}</b> (ค่ามาตรฐานของรุ่น)</li>);
  }
  if (!items.length) return null;
  return <ul className="mt-3 list-disc space-y-0.5 pl-5 text-[13px] leading-relaxed">{items}</ul>;
};

/* ── ตารางราคาตั้ง ───────────────────────────────────────────────────────── */

const MatrixGrid: React.FC<{
  v: EditorView;
  d: Draft;
  patch: Patch;
}> = ({ v, d, patch }) => {
  if (v.base.kind !== 'matrix' || !v.base.cells) return null;
  const { cells, axes, axesTh } = v.base;
  const three = axes.length === 3;
  const L = v.layout;
  const { left, right } = rowAdders(v);
  const rA = rowAxisOf(v);
  const cA = colAxisOf(v);
  // แถว/คอลัมน์ของร่าง = ของเดิม + ค่านอกแคตตาล็อกที่เพิ่งเพิ่ม (ตำแหน่งใน `d.cells`) · ที่กด ✕ ไม่วาด
  const baseRows = allRows(v, d);
  const colsAll = allCols(v, d);
  const cols = colsAll.filter((c) => !gone(d, cA, c));
  const grid = gridRows(v);
  const extra = grid.extra;
  const rows = [...grid.rows, ...(rA ? d.added[rA] ?? [] : [])].filter((r) => !gone(d, rA, r));
  const rowSlot = slotOfAxis(v, rA);
  const colSlot = slotOfAxis(v, cA);
  /** ✕ ได้เมื่อยังไม่มีตัวเลขสักช่อง (ค่าที่เพิ่งเพิ่มเอาออกได้เสมอ — ยังไม่ได้บันทึก) */
  const emptyCol = (j: number) => d.cells.every((row) => !(row[j] ?? '').trim());
  const emptyRow = (i: number) => (d.cells[i] ?? []).every((x) => !x.trim());
  const xBtn = (what: string, onClick: () => void) => (
    <button type="button" onClick={onClick} aria-label={`เอา${what} ออก`} title={`เอา${what} ออก (ยังไม่มีตัวเลขในช่อง)`}
            className="ml-1 font-normal text-slate-500 hover:text-red-600">✕</button>
  );
  /** แถวข้อความใต้ตาราง (ตัวหนังสือแดง) — โผล่เฉพาะชีตที่มี เพิ่มใหม่ทำผ่านแม่แบบ Excel */
  const hasColNotes = !three && Object.keys(L.colNotes).length > 0;
  const head = (i: number) => `${axesTh[i] ?? axes[i]} (${(axes[i] ?? '').toUpperCase()})`;
  /** คอลัมน์ที่รหัสไม่ระบุแล้วใช้คิด (ค่ามาตรฐานของแกนคอลัมน์) — ติดป้ายไว้ใต้หัวคอลัมน์ */
  const stdCol = v.axisDefaults?.find((ad) => ad.axis === axes[1])?.value;
  const nHead = three ? 3 : 2;
  /** หัวชั้นบนของตารางสามแกน — ค่าแกนสองที่ติดกัน (1/8” × 3 ชนิด) รวมเป็นหัวเดียว */
  const groups: { name: string; span: number }[] = [];
  if (three) {
    for (const c of cols) {
      const g = c.split(SEP)[0]!;
      const last = groups[groups.length - 1];
      if (last && last.name === g) last.span++;
      else groups.push({ name: g, span: 1 });
    }
  }
  const adderHead = (a: EditorAdder, side: 'l' | 'r') => (
    <th key={a.id} rowSpan={nHead}
        className={`border border-slate-200 bg-emerald-100 px-2.5 py-1.5 text-center font-bold text-emerald-800 ${side === 'l' ? 'min-w-[88px] max-w-[120px]' : 'min-w-[88px] max-w-[132px]'} ${a.disabled ? 'opacity-50' : ''}`}>
      {a.label}
      <span className="block text-[10.5px] font-normal opacity-80">
        {a.kind === 'flat' ? 'บาท' : unitOf(a)}{condTh(a) && <> · เมื่อ {condTh(a)}</>}{a.disabled && ' · ปิดอยู่'}
      </span>
    </th>
  );
  const rateCell = (a: EditorAdder, r: string, tint: boolean) => (
    <GridInput
      key={a.id}
      label={`${v.title} ${a.label} ${r}`}
      value={d.rates[a.id]?.[r] ?? ''}
      was={str(rateWas(a, r))}
      tint={tint}
      emptyTitle="ว่าง = ขนาดนี้ต้องขอราคา / ทำไม่ได้"
      onChange={(val) => patch((x) => ({ ...x, rates: { ...x.rates, [a.id]: { ...x.rates[a.id], [r]: val } } }))}
    />
  );

  return (
    <>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[13px]">
          <thead>
            <tr>
              <th rowSpan={nHead}
                  className="sticky left-0 z-10 border border-slate-200 bg-emerald-100 px-3 py-2 text-left font-bold text-emerald-800 min-w-[84px]">
                {head(0)}
              </th>
              {left.map((a) => adderHead(a, 'l'))}
              <th colSpan={cols.length} className={TH_HEAD}>
                {head(1)}{three && <> / {head(2)}</>}
              </th>
              {right.map((a) => adderHead(a, 'r'))}
              {v.defaultsBy.map((df) => (
                <th key={df.axis} rowSpan={nHead}
                    title={`มีผลกับราคา — รหัสที่ไม่ได้บอก${df.axisTh} ใช้ค่าในคอลัมน์นี้`}
                    className="border border-slate-200 bg-emerald-100 px-3 py-2 text-center font-bold text-emerald-800 min-w-[160px]">
                  {df.label}
                </th>
              ))}
              {L.rowNote && (
                <th rowSpan={nHead}
                    className="border border-slate-200 bg-emerald-100 px-3 py-2 text-center font-bold text-emerald-800 min-w-[150px]">
                  {L.rowNote.label}
                </th>
              )}
            </tr>
            {three && (
              <tr>
                {groups.map((g, k) => (
                  <th key={`${g.name}-${k}`} colSpan={g.span} className={`${TH_HEAD} whitespace-nowrap`}>{g.name}</th>
                ))}
              </tr>
            )}
            <tr>
              {cols.map((c) => {
                const j = colsAll.indexOf(c);
                if (!three && colSlot && offCat(v, d, cA, c)) {
                  return (
                    <th key={c} className="border-2 border-orange-300 bg-orange-50 px-3 py-1.5 text-center font-bold text-orange-800 whitespace-nowrap">
                      {c}
                      {(d.added[cA!] ?? []).includes(c) || emptyCol(j) ? xBtn(`${colSlot.axisTh} ${c}`, () => patch((x) => removeAsk(v, x, colSlot, c))) : null}
                      <span className="block text-[10px] font-normal">นอกแคตตาล็อก</span>
                    </th>
                  );
                }
                return three ? (
                  <th key={c} className={`${TH_HEAD} whitespace-nowrap`}>{c.split(SEP)[1]}</th>
                ) : (
                  <th key={c} className="border border-slate-200 bg-emerald-100 p-0 text-center font-bold text-emerald-800 whitespace-nowrap">
                    {/* คลิกหัวคอลัมน์ = สลับไฮไลต์เหลืองของคอลัมน์นั้น (แบบที่ไฟล์ระบายไว้) */}
                    <button
                      type="button"
                      onClick={() => patch((x) => ({ ...x, highlight: x.highlight.map((h, k) => (k === j ? !h : h)) }))}
                      aria-pressed={d.highlight[j]}
                      title={d.highlight[j] ? `คอลัมน์ ${c} ไฮไลต์เหลืองอยู่ — คลิกเพื่อเลิกไฮไลต์` : `คลิกเพื่อไฮไลต์คอลัมน์ ${c} สีเหลือง`}
                      className="w-full px-3 py-1.5 hover:underline"
                    >
                      {c}
                      {stdCol === c && <span className="block text-[10px] font-semibold text-emerald-700">มาตรฐาน</span>}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const i = baseRows.indexOf(r);
              const only = extra.has(r);
              const offRow = !!rowSlot && offCat(v, d, rA, r);
              /** แถวที่เพิ่งเพิ่ม — คอลัมน์บวกเพิ่มตามแถวยังไม่มีช่องให้ (บันทึกแล้วค่อยกรอก) */
              const fresh = !!rA && (d.added[rA] ?? []).includes(r);
              return (
                <tr key={r}>
                  <th scope="row"
                      title={only ? 'แถวนี้มีแค่ราคาบวกเพิ่ม ไม่มีราคาตั้ง (ตัวแดงในไฟล์)' : undefined}
                      className={`sticky left-0 z-10 border border-slate-200 px-3 py-2 text-left font-bold whitespace-nowrap ${
                        offRow ? 'bg-orange-50 text-orange-800' : `bg-emerald-50 ${only ? 'text-red-600' : 'text-emerald-800'}`}`}>
                    {r}
                    {offRow && (fresh || emptyRow(i)) && xBtn(`${rowSlot!.axisTh} ${r}`, () => patch((x) => removeAsk(v, x, rowSlot!, r)))}
                    {offRow && <span className="block text-[10px] font-normal">นอกแคตตาล็อก</span>}
                  </th>
                  {left.map((a) => (fresh ? <NoCell key={a.id} /> : rateCell(a, r, true)))}
                  {cols.map((c) => {
                    const j = colsAll.indexOf(c);
                    if (only) return <NoCell key={c} />;
                    const ask = offRow || (!!colSlot && offCat(v, d, cA, c));
                    const now = d.cells[i]?.[j] ?? '';
                    return (
                      <GridInput
                        key={c}
                        label={`${v.title} ราคาตั้ง ${r} × ${c.split(SEP).join(' ')}`}
                        value={now}
                        was={str(cells[i]?.[j])}
                        highlight={!three && d.highlight[j]}
                        ask={ask && !now.trim()}
                        placeholder={ask ? 'ขอราคา' : undefined}
                        emptyTitle={ask ? 'ว่าง = ต้องขอราคาจากฝ่ายผลิต (ไม่ใช่ราคา 0 และไม่ใช่ไม่รับผลิต)' : undefined}
                        onChange={(val) => patch((x) => ({
                          ...x,
                          cells: x.cells.map((row, ri) => (ri === i ? row.map((cc, ci) => (ci === j ? val : cc)) : row)),
                        }))}
                      />
                    );
                  })}
                  {right.map((a) => (fresh ? <NoCell key={a.id} /> : rateCell(a, r, false)))}
                  {v.defaultsBy.map((df) => {
                    if (only) return <NoCell key={df.axis} />;
                    const cur = d.defaults[df.axis]?.[i] ?? '';
                    const changed = cur !== (df.values[r] ?? '');
                    return (
                      <td key={df.axis} className={`border border-slate-200 p-0 ${changed ? 'bg-blue-50' : ''}`}>
                        <select
                          aria-label={`${v.title} ${df.label} ${r}`}
                          value={cur}
                          onChange={(e) => {
                            const val = e.target.value;
                            patch((x) => ({ ...x, defaults: { ...x.defaults, [df.axis]: (x.defaults[df.axis] ?? []).map((y, k) => (k === i ? val : y)) } }));
                          }}
                          className={`block w-full bg-transparent px-2.5 py-2 text-[13px] outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--brand-border-strong)] ${
                            changed ? 'font-bold text-blue-700' : cur ? 'text-slate-800' : 'text-amber-700'
                          }`}
                        >
                          <option value="">— ไม่มี (รหัสต้องระบุเอง) —</option>
                          {df.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                    );
                  })}
                  {L.rowNote && (only ? <NoCell /> : (
                    <td className={`border border-slate-200 p-0 ${d.rowNote[i]!.trim() !== (L.rowNote.values[r] ?? '') ? 'bg-blue-50' : ''}`}>
                      <input
                        aria-label={`${v.title} ${L.rowNote.label} ${r}`}
                        value={d.rowNote[i]}
                        onChange={(e) => {
                          const val = e.target.value;
                          patch((x) => ({ ...x, rowNote: x.rowNote.map((t, k) => (k === i ? val : t)) }));
                        }}
                        onFocus={(e) => e.currentTarget.select()}
                        className="block w-full bg-transparent px-3 py-2 text-[13px] text-slate-700 outline-none focus:bg-card focus:ring-2 focus:ring-inset focus:ring-[var(--brand-border-strong)]"
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
            {hasColNotes && (
              <tr>
                <td className="sticky left-0 z-10 bg-card" />
                {left.map((a) => <td key={a.id} />)}
                {cols.map((c) => { const j = colsAll.indexOf(c); return (
                  <td key={c} className="p-0">
                    <input
                      aria-label={`${v.title} ข้อความใต้คอลัมน์ ${c}`}
                      title="ข้อความใต้คอลัมน์ (ตัวหนังสือแดงแบบในไฟล์) — แสดงผลอย่างเดียว"
                      value={d.colNotes[j]}
                      onChange={(e) => {
                        const val = e.target.value;
                        patch((x) => ({ ...x, colNotes: x.colNotes.map((t, k) => (k === j ? val : t)) }));
                      }}
                      onFocus={(e) => e.currentTarget.select()}
                      className={`block w-full bg-transparent px-2 py-1.5 text-center text-[13px] text-red-600 outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--brand-border-strong)] ${
                        d.colNotes[j]!.trim() !== (L.colNotes[c] ?? '') ? 'bg-blue-50 font-bold' : ''
                      }`}
                    />
                  </td>
                ); })}
                {right.map((a) => <td key={a.id} />)}
                {v.defaultsBy.map((df) => <td key={df.axis} />)}
                {L.rowNote && <td />}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">
        หน่วย บาท · ช่องว่าง = ไม่รับผลิตแบบนั้น (ไม่ใช่ราคา 0) · พื้นฟ้า = ช่องที่แก้แล้วยังไม่บันทึก
        {!three && <> · พื้นเหลือง = คอลัมน์ที่ไฟล์ราคาไฮไลต์ไว้ (คลิกหัวคอลัมน์เพื่อเปลี่ยน)</>}
        {extra.size > 0 && <> · แถวตัวแดง = มีแค่ราคาบวกเพิ่ม ไม่มีราคาตั้ง (เพิ่มราคาตั้งผ่านแม่แบบ Excel)</>}
        {v.askPrice && <> · <b className="text-orange-700">ช่องสีส้ม = ค่านอกแคตตาล็อกที่รอใส่ราคา (ว่าง = ต้องขอราคาจากฝ่ายผลิต)</b></>}
        {v.defaultsBy.map((df) => (
          <React.Fragment key={df.axis}>
            {' · '}<b className="text-slate-600">คอลัมน์ “{df.label}” มีผลกับราคา</b> — รหัสที่ไม่ได้บอก{df.axisTh} ใช้ค่าในคอลัมน์นี้คิด
          </React.Fragment>
        ))}
        {(L.rowNote || hasColNotes) && <> · {[L.rowNote && `คอลัมน์ “${L.rowNote.label}”`, hasColNotes && 'ตัวหนังสือแดง'].filter(Boolean).join(' และ ')} เป็นข้อความกำกับ ไม่มีผลกับราคา</>}
      </p>
    </>
  );
};

/** ตารางช่วงขนาด (BH) — Size (Inch) | Price แบบในชีต + คอลัมน์ "บวกเพิ่มจากราคา BH-01 อีก __%" ของรุ่น C */
const BandGrid: React.FC<{ v: EditorView; d: Draft; patch: Patch }> = ({ v, d, patch }) => {
  if (v.base.kind !== 'banded') return null;
  const b = v.base;
  const vr = v.variant;
  const pctChanged = vr ? toNum(d.variantPct) !== (vr.percent ?? 0) || parse(d.variantPct) === undefined : false;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={`${TH_HEAD} text-left`}>{b.quantityTh} ({b.unit})</th>
              <th className={TH_HEAD}>ราคาตั้ง (บาท)</th>
              <th className={TH_HEAD}>หน่วย</th>
              {vr && <th className={`${TH_HEAD} whitespace-nowrap`}>{v.code}{vr.suffix}</th>}
            </tr>
          </thead>
          <tbody>
            {b.bands.map((bd, i) => (
              <tr key={i}>
                <th scope="row" className="border border-slate-200 bg-emerald-50 px-3 py-2 text-left font-bold text-emerald-800 whitespace-nowrap">
                  {bd.label}
                </th>
                <GridInput
                  label={`${v.title} ราคาตั้ง ช่วง ${bd.label}`}
                  value={d.bands[i] ?? ''}
                  was={str(bd.price)}
                  onChange={(val) => patch((x) => ({ ...x, bands: x.bands.map((y, k) => (k === i ? val : y)) }))}
                />
                <td className="border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-500 whitespace-nowrap">
                  {bd.kind === 'rate' ? `บาท / ${b.unit}` : 'บาท'}
                </td>
                {vr && i === 0 && (
                  <td rowSpan={b.bands.length}
                      className={`border border-slate-200 px-3 py-2 text-center font-semibold text-red-600 min-w-[150px] ${vr.disabled ? 'opacity-50' : ''}`}>
                    บวกเพิ่มจากราคา {v.name} อีก
                    <span className="mt-1 flex items-center justify-center gap-1">
                      <input
                        inputMode="decimal"
                        aria-label={`${v.code}${vr.suffix} บวกเพิ่มจากราคาตั้ง (%)`}
                        value={d.variantPct}
                        onChange={(e) => {
                          const val = e.target.value;
                          patch((x) => ({ ...x, variantPct: val }));
                        }}
                        onFocus={(e) => e.currentTarget.select()}
                        className={`w-14 rounded-md border px-1.5 py-1 text-center tabular-nums outline-none focus:ring-2 focus:ring-[var(--brand-border-strong)] ${
                          pctChanged ? 'border-blue-300 bg-blue-50 font-bold text-blue-700' : 'border-slate-200 bg-card text-slate-900'
                        }`}
                      />
                      %
                    </span>
                    {vr.confirmed === false && (
                      <span className="mt-1.5 block text-[11px] font-semibold text-amber-700">ยังไม่ได้ยืนยันกับฝ่ายขาย</span>
                    )}
                    {vr.disabled && <span className="mt-1.5 block text-[11px] font-normal text-slate-500">ปิดอยู่ — รหัส {v.code}{vr.suffix} คิดเท่ารุ่นหลัก</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">
        หน่วย บาท · ช่องว่าง = ไม่รับผลิตขนาดนั้น (ไม่ใช่ราคา 0) · พื้นฟ้า = ช่องที่แก้แล้วยังไม่บันทึก ·
        หัวท้ายช่วงขนาดแก้ที่ปุ่ม “กฎและเงื่อนไข”
      </p>
    </>
  );
};

/* ── กล่อง "ต้องขอราคาจากฝ่ายผลิต" (แบบ A) ─────────────────────────────────── */

/**
 * ค่านอกแคตตาล็อกที่พบในรหัสจริงของรุ่นนี้ (นับสด) — กด "+ เพิ่ม" = ช่องใหม่สีส้มในตาราง (ยังไม่บันทึกจนกด "ตรวจก่อนบันทึก")
 * + ช่องพิมพ์ค่าที่ยังไม่เคยเจอ · ค่าที่อยู่ในตารางแล้วขึ้น "อยู่ในตารางแล้ว" (ดูจากร่าง ไม่ใช่จากตัวนับ)
 */
const AskCard: React.FC<{
  v: EditorView;
  d: Draft;
  patch: Patch;
  /** `undefined` = กำลังนับ · `null` = นับไม่สำเร็จ */
  found: AskValue[] | null | undefined;
}> = ({ v, d, patch, found }) => {
  const slots = v.askPrice?.slots ?? [];
  const [slotAxis, setSlotAxis] = useState(slots[0]?.axis ?? '');
  const [text, setText] = useState('');
  const [why, setWhy] = useState('');
  if (!v.askPrice || !slots.length) return null;
  /** ค่านี้อยู่ในตาราง (ร่าง) แล้วไหม */
  const inTable = (s: AskSlot, value: string) => {
    if (gone(d, s.axis, value)) return false;
    if ((d.added[s.axis] ?? []).includes(value)) return true;
    if (s.place === 'row') return allRows(v, d).includes(value);
    if (s.place === 'col') return allCols(v, d).includes(value);
    const a = v.adders.find((x) => x.id === s.adder);
    return !!a?.rates?.some((r) => Number(r.value) === Number(value));
  };
  const add = (s: AskSlot, value: string) => patch((x) => addAsk(v, x, s, value));
  const addOwn = () => {
    const s = slots.find((x) => x.axis === slotAxis) ?? slots[0]!;
    const value = canonAsk(s.slot, text);
    if (!value) { setWhy(`“${text.trim()}” ไม่ใช่${s.axisTh}ที่ใช้ได้`); return; }
    if (inTable(s, value)) { setWhy(`${s.axisTh} ${value} อยู่ในตารางแล้ว`); return; }
    setWhy('');
    setText('');
    add(s, value);
  };
  return (
    <div id={`ask-${v.code}`} data-testid="ask-price" className="mt-3.5 overflow-hidden rounded-2xl border border-red-200 bg-red-50 scroll-mt-4">
      <div className="border-b border-red-200 px-4 py-2.5">
        <h3 className="text-[14px] font-bold text-red-700">ต้องขอราคาจากฝ่ายผลิต — ค่านอกแคตตาล็อกที่พบในรหัสสินค้าจริง</h3>
        <p className="mt-0.5 text-[12px] text-slate-700">
          รหัสที่มีค่าเหล่านี้ตอนนี้ขึ้น “ต้องขอราคาจากฝ่ายผลิต” · ได้ราคาแล้วกด <b>+ เพิ่ม</b> ให้เป็นช่องในตาราง แล้วกรอกตัวเลข →
          คิดราคาได้เองทันทีหลังบันทึก
        </p>
      </div>
      {slots.map((s) => {
        const list = (found ?? []).filter((f) => f.model === v.code && f.axis === s.axis);
        return (
          <div key={s.axis} className="grid gap-x-3 gap-y-1.5 border-b border-red-100 bg-card px-4 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)]">
            <div className="pt-1 text-[12px] font-bold text-slate-700">{s.axisTh} → {PLACE_TH[s.place]}</div>
            <div className="flex flex-wrap gap-1.5">
              {found === undefined && <span className="text-[12px] text-slate-400">กำลังนับจากรหัสสินค้าจริง …</span>}
              {found === null && <span className="text-[12px] text-slate-400">นับไม่สำเร็จ — ยังเพิ่มเองได้ที่แถว “ค่าอื่น”</span>}
              {found && list.length === 0 && <span className="text-[12px] text-slate-400">ไม่พบในรหัสสินค้าจริง</span>}
              {list.map((f) => {
                const done = inTable(s, f.value);
                return (
                  <button
                    key={f.value}
                    type="button"
                    disabled={done}
                    onClick={() => add(s, f.value)}
                    title={`ตัวอย่าง: ${f.example}`}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] ${
                      done ? 'border-orange-300 bg-orange-50 text-orange-800' : 'border-slate-200 bg-card text-slate-800 hover:border-[var(--brand-border)]'}`}
                  >
                    <b className="font-mono">{f.value}{s.slot === 'd' ? ' mm' : ''}</b>
                    <span className="text-[11px] text-slate-400">{f.count.toLocaleString('en-US')} รหัส</span>
                    <span className={`font-bold ${done ? 'text-orange-700' : 'text-[var(--brand-fg)]'}`}>{done ? '✓ อยู่ในตารางแล้ว' : '+ เพิ่ม'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="grid gap-x-3 gap-y-1.5 bg-card px-4 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)]">
        <div className="pt-1 text-[12px] font-bold text-slate-700">ค่าอื่น</div>
        <div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
            <span>พิมพ์ค่าที่ยังไม่เคยเจอ</span>
            <select aria-label="ช่องที่จะเพิ่ม" value={slotAxis} onChange={(e) => { setSlotAxis(e.target.value); setWhy(''); }}
                    className="rounded-lg border border-slate-200 bg-card px-2 py-1 text-[12px] text-slate-800">
              {slots.map((s) => <option key={s.axis} value={s.axis}>{s.axisTh}</option>)}
            </select>
            <input aria-label="ค่าที่จะเพิ่ม" value={text} onChange={(e) => { setText(e.target.value); setWhy(''); }}
                   onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) addOwn(); }}
                   placeholder={slots.find((x) => x.axis === slotAxis)?.slot === 'd' ? 'เช่น 8' : slots.find((x) => x.axis === slotAxis)?.slot === 'sensor' ? 'เช่น TSE' : 'เช่น M12'}
                   className="w-[110px] rounded-lg border border-slate-200 bg-card px-2 py-1 font-mono text-[12px] text-slate-900" />
            <Button size="sm" disabled={!text.trim()} onClick={addOwn}>+ เพิ่ม</Button>
          </div>
          {why && <p role="alert" className="mt-1 text-[11.5px] text-red-700">{why}</p>}
        </div>
      </div>
      <p className="border-t border-red-100 bg-card px-4 py-2 text-[11.5px] leading-relaxed text-slate-500">
        ช่องสีส้มที่ปล่อยว่าง = <b>ยังขอราคาอยู่</b> (ไม่ใช่ราคา 0 และไม่ใช่ไม่รับผลิต) ·
        ขนาดแกนที่เพิ่มต้องกรอกอัตราพร้อมกัน (ว่าง = ไม่ถูกเพิ่ม) · เอาคอลัมน์/แถวที่เพิ่มออกได้ด้วยปุ่ม ✕ ถ้ายังไม่มีตัวเลขในช่องนั้น
      </p>
    </div>
  );
};

/* ── หนึ่งตารางของชีต (= หนึ่งรุ่นในสมุด) ──────────────────────────────────── */

const SheetTable: React.FC<{
  v: EditorView;
  d: Draft;
  products: number | null | undefined;
  patch: Patch;
  onAdvanced: () => void;
  /** ค่านอกแคตตาล็อกที่พบในรหัสจริง (ทั้งชีต — กรองตามรุ่นในกล่องเอง) */
  askFound: AskValue[] | null | undefined;
}> = ({ v, d, products, patch, onAdvanced, askFound }) => {
  const rowAx = v.base.kind === 'matrix' ? v.base.axes[0] : null;
  const axisAdders = v.adders.filter((a) => a.rates && a.byAxis !== rowAx);
  const cables = axisAdders.filter((a) => a.byAxis === 'cable');
  const sides = axisAdders.filter((a) => a.byAxis !== 'cable');
  const boxes = (
    <>
      <ExtrasBox v={v} d={d} patch={patch} />
      {sides.map((a) => <AxisBox key={a.id} v={v} a={a} d={d} patch={patch} />)}
    </>
  );
  const hasBoxes = v.adders.some((a) => !a.rates) || sides.length > 0;

  return (
    <section className="min-w-0 bg-card border border-slate-200 rounded-2xl overflow-hidden">
      {/* ชื่อตารางแบบที่ชีตเขียนไว้มุมซ้ายบน (TS_ - 01) */}
      <div className="px-5 pt-4 pb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[17px] font-bold text-slate-900 font-mono">{v.title}</h2>
        <span className="text-[13px] text-slate-600">{v.label}</span>
        <span className="ml-auto flex items-baseline gap-3">
          {typeof products === 'number' && (
            <span className="text-[11.5px] text-slate-500 tabular-nums">
              ครอบสินค้า {products.toLocaleString('th-TH')} รายการ
            </span>
          )}
          <Button size="sm" icon={Settings2} onClick={onAdvanced}
                  title="เพิ่ม/ลบกฎ · เปลี่ยนเงื่อนไข · เปิดปิดข้อจำกัด · หัวท้ายช่วงขนาด">
            กฎและเงื่อนไข
          </Button>
        </span>
        <p className="basis-full text-[11px] text-slate-400">
          ใช้กับรหัส <span className="font-mono">{[v.code, ...v.aliases].join(', ')}</span>
          {/* หัววัดนอกแคตตาล็อกที่เพิ่มเป็นแถว (TSE) — รหัสของมันคิดจากตารางนี้ด้วย */}
          {(() => {
            const rA = rowAxisOf(v);
            const own = slotOfAxis(v, rA)?.slot === 'sensor'
              ? allRows(v, d).filter((r) => offCat(v, d, rA, r) && !gone(d, rA, r)).map((r) => `${r}${v.code.replace(/^[A-Z]+/, '')}`)
              : [];
            return own.length ? <span className="font-mono text-orange-700">, {own.join(', ')} (นอกแคตตาล็อก)</span> : null;
          })()}
        </p>
      </div>

      <div className="px-5 pb-4">
        {v.base.kind === 'matrix' && hasBoxes && <div className="mb-3 flex flex-wrap items-start gap-3">{boxes}</div>}

        <div className="text-[14px] font-bold text-slate-900 mb-2">
          ราคาตั้ง Standard <span className="font-mono">{v.title}</span>
          {v.standardTh && <span className="ml-2 text-[12px] font-normal text-slate-500">· รวมในราคาแล้ว: {v.standardTh}</span>}
        </div>

        {v.base.kind === 'matrix' && <MatrixGrid v={v} d={d} patch={patch} />}
        {v.base.kind === 'matrix' && <AskCard v={v} d={d} patch={patch} found={askFound} />}
        {v.base.kind === 'banded' && <BandGrid v={v} d={d} patch={patch} />}
        {v.base.kind === 'ref' && (
          <p className="text-[13px] text-slate-600">ใช้ตารางราคาตั้งของรุ่น <b className="font-mono">{v.base.model}</b></p>
        )}

        {v.base.kind !== 'matrix' && hasBoxes && <div className="mt-3.5 flex flex-wrap items-start gap-3">{boxes}</div>}

        {cables.map((a) => <CableBar key={a.id} v={v} a={a} d={d} patch={patch} />)}

        <Notes v={v} />
      </div>
    </section>
  );
};

/* ── หน้าจอ ─────────────────────────────────────────────────────────────── */

export const SheetEditor: React.FC<{
  sheet: string;
  /** จำนวนสินค้าที่ครอบของแต่ละรุ่น (จากตารางหน้าสมุดราคา) */
  products: Record<string, number | null | undefined>;
  authHeaders: Record<string, string>;
  /** ปุ่ม "กฎและเงื่อนไข" ของตาราง — เปิดหน้าแก้ทีละรุ่น (โครงของกฎ) */
  onAdvanced: (code: string) => void;
  onBack: (saved: boolean) => void;
  /** ส่วนใต้ตาราง — "ตัวอักษรในรหัส" / "ยังอ่านไม่ออกในชีตนี้" (`SheetSubCodes` · แก้แล้วมีผลทันที ไม่ผูกกับปุ่มตรวจของตาราง) */
  children?: React.ReactNode;
  /** ค่านอกแคตตาล็อกที่พบในรหัสจริงของชีตนี้ (`GET /unread`) — `undefined` = กำลังนับ · `null` = นับไม่สำเร็จ */
  askFound?: AskValue[] | null;
  /** เปิดมาจากปุ่ม "ต้องขอราคา" ของหน้าคำนวณราคา — เลื่อนไปที่กล่องขอราคาของรุ่นนี้ */
  focusAsk?: string | null;
}> = ({ sheet, products, authHeaders, onAdvanced, onBack, children, askFound, focusAsk }) => {
  const jsonHeaders = useMemo(
    () => ({ ...authHeaders, 'Content-Type': 'application/json' }),
    [authHeaders],
  );
  const url = `/api/admin/pricebook/sheet/${encodeURIComponent(sheet)}`;

  const [models, setModels] = useState<EditorView[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [fingerprint, setFingerprint] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const savedOnce = useRef(false);

  const reset = (list: EditorView[]) => {
    setModels(list);
    setDrafts(Object.fromEntries(list.map((v) => [v.code, toDraft(v)])));
  };

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(url, { headers: authHeaders });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'โหลดชีตนี้ไม่สำเร็จ');
      setFingerprint(body.fingerprint);
      setModels(body.models);
      setDrafts(Object.fromEntries((body.models as EditorView[]).map((v) => [v.code, toDraft(v)])));
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  }, [authHeaders, url]);

  // โหลดครั้งแรก — หุ้ม setTimeout ตามท่าของทั้งแอป (eslint ปฏิเสธ setState ตรง ๆ ใน useEffect)
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  // มาจากปุ่มของหน้าคำนวณราคา — เลื่อนไปที่กล่อง "ต้องขอราคา" ครั้งเดียวหลังโหลดชีตเสร็จ
  const focused = useRef(false);
  useEffect(() => {
    if (!models || !focusAsk || focused.current) return;
    focused.current = true;
    const t = setTimeout(() => document.getElementById(`ask-${focusAsk}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    return () => clearTimeout(t);
  }, [models, focusAsk]);

  const diff = useMemo(() => (models ? buildDiff(models, drafts) : []), [models, drafts]);
  const invalid = useMemo(() => (models ? invalidCells(models, drafts) : []), [models, drafts]);
  const dirty = diff.length > 0 || invalid.length > 0;

  const patchOf = (code: string): Patch => (fn) =>
    setDrafts((prev) => (prev[code] ? { ...prev, [code]: fn(prev[code]!) } : prev));

  /** ไปหน้ากฎของรุ่น — ตัวเลขที่ยังไม่บันทึกจะหาย จึงถามก่อน */
  const advanced = (code: string) => {
    if (dirty && !window.confirm('มีตัวเลขที่แก้แล้วยังไม่บันทึก — ไปหน้ากฎและเงื่อนไขแล้วตัวเลขพวกนี้จะหาย ไปต่อไหม?')) return;
    onAdvanced(code);
  };

  const save = async () => {
    if (!models) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ fingerprint, note, models: buildBody(models, drafts) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'บันทึกไม่สำเร็จ');
      setFingerprint(body.fingerprint);
      reset(body.models);
      setNote('');
      savedOnce.current = true;
      setSaved(true);
    } catch (e: unknown) {
      setError(errMsg(e));
      setReview(false);
    } finally {
      setBusy(false);
    }
  };

  if (error && !models) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!models) return <div className="text-sm text-slate-400 px-1 py-8">กำลังโหลดชีต {sheet} …</div>;

  /** ชีตที่ทุกตารางเป็นช่วงขนาด (BH) วางคู่กันแบบในไฟล์ บนจอกว้าง */
  const duo = models.length > 1 && models.every((v) => v.base.kind === 'banded');

  return (
    <div className="space-y-3.5">
      <div className="flex items-start gap-2.5 flex-wrap">
        <Button icon={ChevronLeft} onClick={() => onBack(savedOnce.current)}>กลับ</Button>
        <div className="min-w-[180px] flex-1">
          <h1 className="text-lg font-bold text-slate-900">
            ชีต <span className="font-mono">{sheet}</span>
          </h1>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {models.length} ตาราง · แก้ตัวเลขในช่องได้เลย แล้วกด “ตรวจก่อนบันทึก” ·
            เพิ่ม/ลบแถวหรือคอลัมน์ใช้แม่แบบ Excel{models.some((v) => v.askPrice) && <> (ค่านอกแคตตาล็อกเพิ่มได้ที่กล่อง “ต้องขอราคาจากฝ่ายผลิต” ใต้ตาราง)</>} ·
            เพิ่ม/ลบกฎใช้ปุ่ม “กฎและเงื่อนไข”
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button icon={Undo2} disabled={!dirty} onClick={() => reset(models)}>ย้อนการแก้</Button>
          <Button variant="primary" icon={BookOpen} disabled={diff.length === 0 || invalid.length > 0} onClick={() => setReview(true)}>
            ตรวจก่อนบันทึก{diff.length ? ` (${diff.length})` : ''}
          </Button>
        </div>
      </div>

      {error && <ErrorBox message={error} />}

      {invalid.length > 0 && (
        <div role="alert" className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
          <span><b>ยังบันทึกไม่ได้ {invalid.length} ช่อง</b> (พื้นแดง) — {invalid.slice(0, 3).join(' · ')}{invalid.length > 3 ? ' · …' : ''}</span>
        </div>
      )}

      <div className={duo ? 'grid gap-3.5 xl:grid-cols-2 items-start' : 'space-y-3.5'}>
        {models.map((v) => (
          <SheetTable
            key={v.code}
            v={v}
            d={drafts[v.code] ?? toDraft(v)}
            products={products[v.code]}
            patch={patchOf(v.code)}
            onAdvanced={() => advanced(v.code)}
            askFound={askFound}
          />
        ))}
      </div>

      {children}

      {review && (
        <ReviewModal
          code={`ชีต ${sheet}`}
          rows={diff}
          problems={[]}
          note={note}
          saved={saved}
          busy={busy}
          onNote={setNote}
          onBack={() => setReview(false)}
          onSave={() => void save()}
          onDone={() => { setReview(false); setSaved(false); }}
        />
      )}
    </div>
  );
};
