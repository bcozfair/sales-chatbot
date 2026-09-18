// ─────────────────────────────────────────────────────────────────────────────
//  PROTOTYPE — "รหัสสินค้า → สเปก" (อ่านรหัสที่คนพิมพ์มา แล้วแปลงเป็น ProductConfig)
//
//  ⚠️ ของทดลอง ไม่มีใครใน production import ไฟล์นี้ · ดู prototypes/pricing/README.md
//
//  **ทำไมถึงมีไฟล์นี้:** แอดมินมีรหัสอยู่ในมืออยู่แล้ว (จากใบสั่งซื้อ · จาก Odoo · จากแชท)
//  การให้ไล่กดเลือกทีละช่องทั้งที่รหัสบอกครบแล้วคือการพิมพ์ข้อมูลเดิมซ้ำ
//
//  **ไวยากรณ์ของรหัสไม่ได้ถูกประดิษฐ์ขึ้นที่นี่ — ชีตราคาเขียนไว้เองที่หัวตารางทุกชีต:**
//    TS-04!A7   `ราคาตั้ง Standard TS_- 04(S_) 6x100+1M`
//    TS-14!A10  `ราคาตั้ง Standard TS_- 14 D x100-U`
//    TS-18!A13  `ราคาตั้ง Standard TS_- 18 (F_) D1-D2 x100+50`
//    BH!E19     `ตัวอย่างการคิดราคา BH-01C (BH-01C-600x150-380-4950W-PL-PL2)`
//  ⇒ ตัวอ่านนี้อ่าน "ภาษาเดียวกับที่ฝ่ายขายเขียนอยู่แล้ว" ไม่ใช่ภาษาใหม่ที่ต้องสอนใคร
//
//  **กฎเหล็กของไฟล์นี้: รหัสย่อยที่ไม่มีหลักฐานว่าแปลว่าอะไร ต้องออกมาเป็น `unknown`**
//  ห้ามเดาแล้วปล่อยผ่านเงียบ ๆ เพราะราคาที่ "ดูเหมือนคิดครบ" แต่ตกของไป 1 รหัสย่อย
//  คือใบเสนอราคาที่ต่ำกว่าความจริงโดยไม่มีใครรู้ — ผิดแบบที่ไม่มีอะไรฟ้อง
//  (เคสจริงที่ยังอ่านไม่ออกวันนี้: `-BU` · `-U` ของ TS-18 · `(F4)` · `+5MP` · `-S000`)
//
//  **ตารางรหัสย่อยมาก่อนคำว่า "อ่านไม่ออก"** — ทุกจุดที่เคยตอบว่าอ่านไม่ออก จะถามตาราง
//  ที่แอดมินตั้งค่าไว้ก่อนเสมอ (`subcodes.ts`) ⇒ ของที่ไฟล์ราคาไม่ได้เขียนไว้ แอดมินเติมเองได้
//  โดยไม่ต้องแก้ไฟล์นี้ · ที่ยังไม่มีใครตั้งค่า ยังคงออกมาเป็น `unknown` เหมือนเดิม
//
//  ไฟล์นี้ **ไม่รู้จักราคา** เลยสักบาท — หน้าที่มันคือแปลงรหัสเป็นสเปก แล้วส่งต่อให้
//  `engine.ts` คิดราคา ⇒ แก้ตัวอ่านรหัสไม่กระทบตัวเลข และแก้ราคาไม่กระทบตัวอ่าน
// ─────────────────────────────────────────────────────────────────────────────

import type { PriceBook, PriceModel, ProductConfig } from './types.js';
import { resolveModel } from './engine.js';
import { findSubCode, subCodeOption } from './subcodes.js';

/** หนึ่งรหัสย่อยในรหัสสินค้า พร้อมคำอธิบายว่าระบบอ่านมันว่าอะไร — ใช้โชว์ให้คนตรวจก่อนเชื่อราคา */
export interface CodePart {
  /** ข้อความตามที่อยู่ในรหัส */
  text: string;
  /** อ่านได้ว่าอะไร (ภาษาคน) */
  reads: string;
  kind: 'model' | 'axis' | 'dim' | 'option' | 'noPrice' | 'unknown';
  /** true = ตีความเอาเอง ยังไม่มีใครยืนยัน — หน้าจอต้องแสดงต่างจากของที่ชีตเขียนไว้ตรง ๆ */
  guess?: boolean;
}

export interface ParsedCode {
  input: string;
  /** รหัสหลังตัดช่องว่าง/ทำให้เครื่องหมายคำพูดเป็นแบบเดียว */
  normalized: string;
  /** รหัสรุ่นในสมุดราคา (undefined = ไม่มีรุ่นนี้ในสมุด) */
  model?: string;
  /** สเปกที่พร้อมส่งเข้า computePrice — undefined เมื่ออ่านรุ่นไม่ออก */
  cfg?: ProductConfig;
  parts: CodePart[];
  /** เหตุผลที่แปลงเป็นสเปกไม่ได้เลย */
  problems: string[];
  /** อ่านได้แต่ต้องให้คนดูก่อน */
  warnings: string[];
}

// ── ตัวช่วยเล็ก ๆ ────────────────────────────────────────────────────────────

/** ทำให้เครื่องหมายนิ้วทุกแบบ (” “ ″ ') เทียบกันได้ และตัดช่องว่างทิ้งทั้งหมด */
function norm(s: string): string {
  return s
    .replace(/[\u201C\u201D\u2033\u00A0]/g, '"')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/\s+/g, '')
}

/** ค่าที่เป็นไปได้ของแกนหนึ่งในตารางราคาตั้ง */
export function axisValues(model: PriceModel, axis: string): string[] {
  if (model.base.kind !== 'matrix') return [];
  const i = model.base.axes.indexOf(axis);
  if (i < 0) return [];
  return [...new Set(Object.keys(model.base.cells).map((k) => k.split(' | ')[i] ?? ''))];
}

/** จับคู่ค่าที่พิมพ์มากับค่าที่ตารางใช้จริง — เทียบแบบไม่สนตัวพิมพ์เล็กใหญ่และรูปแบบเครื่องหมายนิ้ว */
function matchValue(values: string[], raw: string): string | undefined {
  const want = norm(raw).toLowerCase();
  return values.find((v) => norm(v).toLowerCase() === want);
}

/**
 * `S2` `S4` ในรหัส = ขนาดเกลียวเป็น "หุน" (1 หุน = 1/8 นิ้ว)
 * พิสูจน์ด้วยราคาจริงใน Odoo เทียบกับตาราง TS-04 (วัด 2026-09-18):
 *   `TSK-04(S2)6x100+1M` = 615 = TS-04!D25 (แกน 6 · เกลียว 1/4") ตรงเป๊ะ
 *   `TSK-04(S4)6x100+1M` = 770 = TS-04!F25 (แกน 6 · เกลียว 1/2") ตรงเป๊ะ
 * `M6` `M8` `M10` `M12` = เกลียวมิล ซึ่ง **ไม่มีอยู่ในตารางราคาของชีตนี้เลย**
 * (ของจริงมีขายและราคาต่างกันจริง: M8 = 630 · M10 = 640 · M12 = 650) ⇒ ต้องตีเป็น
 * "อ่านออกแต่ไม่มีราคา" ไม่ใช่เดาว่าเท่ากับเกลียวนิ้วขนาดใกล้เคียง
 */
function threadFromHun(hun: number): string[] {
  const eighths: Record<number, string[]> = {
    1: ['1/8"'],
    2: ['1/4"', '2/8"'],
    3: ['3/8"'],
    4: ['1/2"', '4/8"'],
    5: ['5/8"'],
    6: ['3/4"', '6/8"'],
    7: ['7/8"'],
    8: ['1"', '8/8"']
  };
  return eighths[hun] ?? [];
}

/**
 * ตัวอักษรหลัง `TS` บอกชนิดหัววัด และ **ชื่อค่าแกนในชีตเขียนรหัสนั้นกำกับไว้เอง**
 * (`PT100 Class B (TSP)` · `PT100 Class A (TSPA)` · `PT1000 (TSZ)` ที่ TS-18!G14:I14)
 * ⇒ จับคู่จากข้อความในวงเล็บของค่าแกน ไม่ต้องมีตารางแปลแยกที่จะลืมแก้ตามกัน
 */
function matchSensor(values: string[], prefix: string, letter: string): string | undefined {
  const byPrefix = values.find((v) => v.toUpperCase().includes(`(${prefix.toUpperCase()})`));
  if (byPrefix) return byPrefix;
  const exact = values.find((v) => v.toUpperCase() === letter.toUpperCase());
  if (exact) return exact;
  // 'Type K/J' — ชีตรวม K กับ J ไว้ช่องเดียวเพราะราคาเท่ากัน
  return values.find((v) => v.toUpperCase().split(/[^A-Z0-9]+/).includes(letter.toUpperCase()));
}

// ── ตัวอ่านของแต่ละตระกูล ────────────────────────────────────────────────────

interface Ctx {
  book: PriceBook;
  model: PriceModel;
  cfg: ProductConfig;
  parts: CodePart[];
  warnings: string[];
}

const add = (c: Ctx, part: CodePart) => c.parts.push(part);

/**
 * ลองอ่านจาก "ตารางรหัสย่อย" ที่แอดมินตั้งค่าไว้ — คืน true เมื่อมีแถวรองรับ
 *
 * ตัวอ่านนี้ **ไม่ดูเลยว่าแถวนั้นคิดเงินเท่าไหร่** มันแค่แปะป้ายว่าอ่านออกแล้ว และหย่อน
 * ชื่อรหัสย่อยลง options ให้ engine ไปคิดต่อ — คนละหน้าที่กัน และทำให้แก้ราคาในตาราง
 * แล้วตัวอ่านไม่ต้องรู้เรื่องด้วยเลย
 *
 * `text` แยกจาก `token` เพราะสิ่งที่โชว์บนจอต้องเป็นสิ่งที่คนพิมพ์มาจริง ๆ (มีวงเล็บ)
 * ส่วนสิ่งที่เอาไปค้นตารางคือเนื้อในวงเล็บ
 */
function readFromTable(c: Ctx, token: string, text: string = token): boolean {
  const sc = findSubCode(c.book, c.model, token);
  if (!sc) return false;
  c.cfg.options = [...(c.cfg.options ?? []), subCodeOption(token)];
  const kind: CodePart['kind'] =
    sc.effect === 'none' ? 'noPrice' : sc.effect === 'setAxis' ? 'axis' : 'option';
  add(c, { text, reads: sc.reads, kind });
  return true;
}

/** รหัสย่อยที่เหลือจากรหัส ตัดด้วย `-` แล้วยังไม่มีใครอ่าน */
function leftovers(c: Ctx, rest: string): string[] {
  return rest
    .split('-')
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

/**
 * ส่วนสายของ TC: `+1M` `+3M` `+1.5M` `+30cm` — ตัวอักษรที่ตามหลัง M (P/T/C/U/F ฯลฯ)
 * ยังไม่มีหลักฐานว่าคืออะไร จึงถูกแยกออกมาเป็นรหัสย่อยที่อ่านไม่ออกต่างหาก ไม่กลืนทิ้ง
 */
function readCable(c: Ctx, token: string): boolean {
  const m = token.match(/^\+?(\d+(?:\.\d+)?)(M|CM)([A-Z]*)$/i);
  if (!m) return false;
  const n = Number(m[1]);
  const unit = m[2]!.toUpperCase();
  const tail = m[3] ?? '';
  const meters = unit === 'M' ? n : n / 100;
  c.cfg.dims = { ...c.cfg.dims, cable_m: meters };
  add(c, {
    text: m[0].replace(tail, ''),
    reads: `สายยาว ${meters} เมตร (มาตรฐานของรุ่นนี้คือ ${c.model.standard.cable_m ?? '—'} เมตร)`,
    kind: 'dim'
  });
  if (tail) {
    add(c, { text: tail, reads: 'ตัวอักษรท้ายส่วนสาย — ยังไม่มีในชีตราคาว่าแปลว่าอะไร', kind: 'unknown' });
  }
  return true;
}

/**
 * TS-04 — `TS_-04(S_) 6x100+1M` (TS-04!A7)
 * วงเล็บ = ขนาดเกลียว · ก่อน x = แกน D · หลัง x = ความยาว L1 · +NM = ความยาวสาย
 */
function readTs04(c: Ctx, rest: string, prefix: string): void {
  const paren = rest.match(/^\(([^)]*)\)/);
  if (paren) {
    const raw = paren[1] ?? '';
    const threads = axisValues(c.model, 'thread');
    const hun = raw.match(/^S(\d+)$/i);
    let hit: string | undefined;
    if (hun) {
      for (const cand of threadFromHun(Number(hun[1]))) {
        hit = hit ?? matchValue(threads, cand);
      }
    } else {
      hit = matchValue(threads, raw);
    }
    if (hit) {
      c.cfg.axes = { ...c.cfg.axes, thread: hit };
      add(c, { text: `(${raw})`, reads: `เกลียว ${hit}${hun ? ` (${hun[1]} หุน)` : ''}`, kind: 'axis' });
    } else if (readFromTable(c, raw, `(${raw})`)) {
      // มีแถวในตารางรหัสย่อยแล้ว — จบตรงนี้
    } else if (/^M\d+$/i.test(raw)) {
      add(c, {
        text: `(${raw})`,
        reads: `เกลียวมิล ${raw.toUpperCase()} — ตารางราคา TS-04 มีแต่เกลียวนิ้ว ยังไม่ได้ตั้งค่าว่าคิดเท่าไหร่`,
        kind: 'unknown'
      });
    } else {
      add(c, { text: `(${raw})`, reads: 'อ่านไม่ออกว่าเป็นเกลียวขนาดไหน', kind: 'unknown' });
    }
    rest = rest.slice(paren[0].length);
  } else {
    c.warnings.push('รหัสนี้ไม่มีวงเล็บบอกขนาดเกลียว — ต้องเลือกเกลียวเองในช่องข้างล่าง');
  }

  const core = rest.match(/^([0-9.]+[A-WYZ]*)(?:x([0-9.]+))?/i);
  if (core) {
    const dHit = matchValue(axisValues(c.model, 'D'), core[1] ?? '');
    if (dHit) {
      c.cfg.axes = { ...c.cfg.axes, D: dHit };
      add(c, { text: core[1] ?? '', reads: `แกน D = ${dHit} mm`, kind: 'axis' });
    } else {
      add(c, { text: core[1] ?? '', reads: `ไม่มีแกน ${core[1]} ในตารางราคา TS-04`, kind: 'unknown' });
    }
    if (core[2]) {
      c.cfg.dims = { ...c.cfg.dims, L1: Number(core[2]) };
      add(c, { text: `x${core[2]}`, reads: `ความยาวแกน L1 = ${core[2]} mm`, kind: 'dim' });
    }
    rest = rest.slice(core[0].length);
  }

  readTail(c, rest, prefix);
}

/**
 * TS-14 — `TS_-14 D x100-U` (TS-14!A10)
 * ตัวอักษรหลัง TS = TYPE (K/J/R/S) · ก่อน x = เส้นผ่านศูนย์กลางที่ใช้เลือก "กลุ่มขนาด"
 * · หลัง x = L1 · `+N` = Sleeve (L2) · `(S_)` = รุ่นมีเกลียว (ชีตคิดเพิ่ม 900 ทุกขนาด)
 */
function readTs14(c: Ctx, rest: string, prefix: string, letter: string): void {
  const sensors = axisValues(c.model, 'sensor');
  const sHit = matchSensor(sensors, prefix, letter);
  if (sHit) {
    c.cfg.axes = { ...c.cfg.axes, sensor: sHit };
    add(c, { text: prefix, reads: `หัววัด Type ${sHit}`, kind: 'axis' });
  } else {
    add(c, { text: prefix, reads: `ไม่มีหัววัดชนิด ${letter} ในตารางราคา TS-14`, kind: 'unknown' });
  }

  const paren = rest.match(/^\(([^)]*)\)/);
  if (paren) {
    const raw = paren[1] ?? '';
    if (/^S\d+$/i.test(raw)) {
      c.cfg.options = [...(c.cfg.options ?? []), 'thread'];
      add(c, { text: `(${raw})`, reads: 'รุ่นมีเกลียว (ชีตคิดเพิ่มราคาเดียวทุกขนาดเกลียว)', kind: 'option' });
    } else if (!readFromTable(c, raw, `(${raw})`)) {
      add(c, { text: `(${raw})`, reads: 'ยังไม่ได้ตั้งค่าว่าแปลว่าอะไร', kind: 'unknown' });
    }
    rest = rest.slice(paren[0].length);
  }

  const core = rest.match(/^([0-9.]+)x([0-9.]+)(?:\+([0-9.]+))?/i);
  if (core) {
    const groups = axisValues(c.model, 'dia_group');
    // ป้ายกลุ่มเขียนเป็น `Ø6mm./12.7mm.` — ตัวแรกคือขนาดที่รหัสอ้างถึง
    const want = Number(core[1]);
    const hit = groups.find((g) => Number((g.match(/[\d.]+/) ?? [])[0]) === want);
    if (hit) {
      c.cfg.axes = { ...c.cfg.axes, dia_group: hit };
      add(c, { text: core[1] ?? '', reads: `กลุ่มขนาด ${hit}`, kind: 'axis' });
    } else {
      add(c, {
        text: core[1] ?? '',
        reads: `ขนาด ${core[1]} ไม่ตรงกับกลุ่มขนาดไหนในตาราง (ตารางแบ่งเป็นกลุ่ม ไม่ใช่ทีละขนาด)`,
        kind: 'unknown'
      });
    }
    c.cfg.dims = { ...c.cfg.dims, L1: Number(core[2]) };
    add(c, { text: `x${core[2]}`, reads: `ความยาว L1 = ${core[2]} mm`, kind: 'dim' });
    if (core[3]) {
      c.cfg.dims = { ...c.cfg.dims, L2: Number(core[3]) };
      add(c, { text: `+${core[3]}`, reads: `Sleeve L2 = ${core[3]} mm`, kind: 'dim' });
    }
    rest = rest.slice(core[0].length);
  }

  readTail(c, rest, prefix);
}

/**
 * TS-18 — `TS_-18 (F_) D1-D2 x100+50` (TS-18!A13)
 * วงเล็บ = หน้าแปลน · `D1-D2` = แกนใน-แกนนอก แต่ **ตารางราคามีแถวเดียวชื่อ `D1/D2 (mm)`**
 * ⇒ ใช้ D2 (ตัวที่มีสร้อย A/S ติดอยู่จริงในรหัสของจริง) แล้วเตือนเมื่อสองตัวไม่เท่ากัน
 */
function readTs18(c: Ctx, rest: string, prefix: string, letter: string): void {
  const sensors = axisValues(c.model, 'sensor');
  const sHit = matchSensor(sensors, prefix, letter);
  if (sHit) {
    c.cfg.axes = { ...c.cfg.axes, sensor: sHit };
    add(c, { text: prefix, reads: `หัววัด ${sHit}`, kind: 'axis' });
  } else {
    add(c, { text: prefix, reads: `ไม่มีหัววัดชนิด ${letter} ในตารางราคา TS-18`, kind: 'unknown' });
  }

  const paren = rest.match(/^\(([^)]*)\)/);
  if (paren) {
    const raw = paren[1] ?? '';
    // ค่าหน้าแปลนที่ชีตมีราคาให้ อยู่ในคีย์ของ adder ที่คิดตามแกน flange
    const flanges = [...new Set(c.model.adders.filter((a) => a.byAxis === 'flange').flatMap((a) => Object.keys(a.rates ?? {})))];
    const hit =
      matchValue(flanges, raw) ??
      flanges.find((f) => Number((f.match(/[\d.]+/) ?? [])[0]) === Number(raw) && /นิ้ว/.test(f));
    if (hit) {
      c.cfg.axes = { ...c.cfg.axes, flange: hit };
      add(c, { text: `(${raw})`, reads: `หน้าแปลน ${hit}`, kind: 'axis', guess: true });
    } else {
      // ใส่ค่าดิบลงแกนหน้าแปลนทั้งที่อ่านไม่ออก **โดยตั้งใจ** — ชีตมีกฎอยู่แล้วว่า
      // หน้าแปลนนอกรายการต้องขอราคาจากผลิต 2 (TW!L34) ⇒ ปล่อยว่างไว้จะกลายเป็น
      // "ใบที่ไม่มีหน้าแปลน" ซึ่งคิดราคาออกมาต่ำกว่าจริงโดยไม่มีอะไรเตือน
      c.cfg.axes = { ...c.cfg.axes, flange: raw };
      add(c, {
        text: `(${raw})`,
        reads: 'หน้าแปลน — ไม่ตรงกับรายการที่ชีตมีราคาให้ ต้องขอราคาจากผลิต 2',
        kind: 'unknown'
      });
    }
    rest = rest.slice(paren[0].length);
  }

  const core = rest.match(/^([0-9.]+[A-WYZ]*)-([0-9.]+[A-WYZ]*)x([0-9.]+)(?:\+([0-9.]+))?/i);
  if (core) {
    const ds = axisValues(c.model, 'D');
    const d2 = matchValue(ds, core[2] ?? '');
    if (d2) {
      c.cfg.axes = { ...c.cfg.axes, D: d2 };
      add(c, { text: `${core[1]}-${core[2]}`, reads: `แกน D1 ${core[1]} / D2 ${d2} — ตารางคิดราคาจาก ${d2}`, kind: 'axis' });
      if (norm(core[1] ?? '').toLowerCase() !== norm(d2).toLowerCase()) {
        c.warnings.push(`รหัสนี้ D1 (${core[1]}) กับ D2 (${d2}) ไม่เท่ากัน — ชีตมีราคาแถวเดียวชื่อ "D1/D2" ระบบจึงคิดจาก D2`);
      }
    } else {
      add(c, { text: `${core[1]}-${core[2]}`, reads: `ไม่มีแกน ${core[2]} ในตารางราคา TS-18`, kind: 'unknown' });
    }
    c.cfg.dims = { ...c.cfg.dims, L1: Number(core[3]) };
    add(c, { text: `x${core[3]}`, reads: `ความยาวแกน L1 = ${core[3]} mm`, kind: 'dim' });
    if (core[4]) {
      c.cfg.dims = { ...c.cfg.dims, L2: Number(core[4]) };
      add(c, { text: `+${core[4]}`, reads: `ความยาว Sleeve L2 = ${core[4]} mm`, kind: 'dim' });
    }
    rest = rest.slice(core[0].length);
  }

  readTail(c, rest, prefix);
}

/**
 * BH — `BH-01C-600x150-380-4950W-PL-PL2` (BH!E19 ตัวอย่างการคิดราคาที่ฝ่ายขายเขียนเอง)
 * `600x150` = เส้นผ่านศูนย์กลาง × ความกว้าง · `380` = แรงดันไฟ (ไม่มีผลกับราคา)
 * · `4950W` = กำลังไฟ (มีผลเฉพาะ BH-03) · `PL2` = Male Connector PL-2
 */
function readBh(c: Ctx, rest: string): void {
  const core = rest.match(/^-?([0-9.]+)x([0-9.]+)/i);
  if (core) {
    c.cfg.dims = { ...c.cfg.dims, dia_mm: Number(core[1]), width_mm: Number(core[2]) };
    add(c, { text: `${core[1]}x${core[2]}`, reads: `เส้นผ่านศูนย์กลาง ${core[1]} mm × ความกว้าง ${core[2]} mm`, kind: 'dim' });
    rest = rest.slice(core[0].length);
  } else {
    c.warnings.push('อ่านขนาด (กว้าง × ยาว) จากรหัสไม่ได้ — กรอกเองในช่องข้างล่าง');
  }

  for (const token of leftovers(c, rest)) {
    if (readCableBh(c, token)) continue;
    if (readCommonToken(c, token)) continue;

    const watt = token.match(/^(\d+(?:\.\d+)?)W(x\d+)?$/i);
    if (watt) {
      const hasWatt = c.model.standard.watt !== undefined;
      if (hasWatt && !watt[2]) {
        c.cfg.dims = { ...c.cfg.dims, watt: Number(watt[1]) };
        add(c, { text: token, reads: `กำลังไฟ ${watt[1]} W`, kind: 'dim' });
      } else if (hasWatt) {
        add(c, { text: token, reads: `กำลังไฟ ${watt[1]} W คูณ ${watt[2]} — ยังไม่รู้ว่าคิดราคายังไง`, kind: 'unknown' });
      } else {
        add(c, { text: token, reads: `กำลังไฟ ${watt[1]} W — รุ่นนี้ชีตไม่ได้คิดราคาตามกำลังไฟ`, kind: 'noPrice' });
      }
      continue;
    }

    if (/^\d{2,3}$/.test(token)) {
      add(c, { text: token, reads: `แรงดันไฟ ${token} V — ชีตไม่ได้คิดราคาตามแรงดัน`, kind: 'noPrice' });
      continue;
    }
    if (readFromTable(c, token)) continue;

    add(c, { text: token, reads: 'ยังไม่ได้ตั้งค่าว่าแปลว่าอะไร', kind: 'unknown' });
  }
}

/** สายของ BH นับเป็นเซนติเมตร (มาตรฐาน 30 CM ตาม BH!A19) */
function readCableBh(c: Ctx, token: string): boolean {
  const m = token.match(/^\+?(\d+(?:\.\d+)?)(M|CM)$/i);
  if (!m) return false;
  const cm = m[2]!.toUpperCase() === 'M' ? Number(m[1]) * 100 : Number(m[1]);
  c.cfg.dims = { ...c.cfg.dims, cable_cm: cm };
  add(c, { text: token, reads: `สายยาว ${cm} CM (มาตรฐาน ${c.model.standard.cable_cm ?? '—'} CM)`, kind: 'dim' });
  return true;
}

/** รหัสย่อยที่ทุกตระกูลใช้เหมือนกัน — วันนี้มีตัวเดียวที่ชีตเขียนราคาไว้ตรง ๆ คือ PL-2 */
function readCommonToken(c: Ctx, token: string): boolean {
  if (/^PL2$/i.test(token) && c.model.adders.some((a) => a.id === 'conn_pl2')) {
    c.cfg.options = [...(c.cfg.options ?? []), 'conn:pl2'];
    add(c, { text: token, reads: 'Male Connector PL-2', kind: 'option' });
    return true;
  }
  return false;
}

/** รหัสย่อยต่อท้ายของรหัส TC หลังส่วนขนาด */
function readTail(c: Ctx, rest: string, prefix: string): void {
  for (const token of leftovers(c, rest)) {
    if (readCable(c, token)) continue;
    if (readCommonToken(c, token)) continue;
    // `-U` ของ TS-14 เคยเป็นเงื่อนไขฝังในโค้ดตรงนี้ ตอนนี้ย้ายไปเป็นแถวในตารางรหัสย่อยแล้ว
    // (มาจากรหัสมาตรฐานที่ชีตเขียนเอง `TS_- 14 D x100-U`) ⇒ แอดมินเห็นและแก้ได้
    if (readFromTable(c, token)) continue;

    add(c, { text: token, reads: 'ยังไม่ได้ตั้งค่าว่าแปลว่าอะไร', kind: 'unknown' });
  }
  void prefix;
}

// ── ตัวหลัก ──────────────────────────────────────────────────────────────────

/**
 * หารุ่นในสมุดราคาจากหัวรหัส — ลองตามลำดับ "ตรงตัว → ตระกูล K → ไม่มีตัวอักษร"
 * เพราะชีตเดียวใช้กับหลายตัวอักษร (TS-04 ใช้กับทั้ง TSK-04 และ TSJ-04 ราคาเท่ากัน)
 */
function findModel(book: PriceBook, prefix: string, num: string, suffix: string): PriceModel | undefined {
  const cands = [
    `${prefix}-${num}${suffix}`,
    `${prefix}-${num}`,
    `TSK-${num}`,
    `TS-${num}`,
    `BH-${num}${suffix}`,
    `BH-${num}`
  ];
  for (const c of cands) {
    const m = resolveModel(book, c);
    if (m) return m;
  }
  return undefined;
}

export function parseProductCode(input: string, book: PriceBook): ParsedCode {
  const normalized = norm(input);
  const out: ParsedCode = { input, normalized, parts: [], problems: [], warnings: [] };
  if (normalized === '') {
    out.problems.push('ยังไม่ได้พิมพ์รหัส');
    return out;
  }

  const head = normalized.match(/^(BH|TS[A-Z]*)-?(\d{2})([A-Z]*)/i);
  if (!head) {
    out.problems.push('อ่านไม่ออกว่ารหัสนี้เป็นรุ่นอะไร — รหัสต้องขึ้นต้นด้วยตระกูลและเลขรุ่น เช่น TSK-04 หรือ BH-01');
    return out;
  }

  const prefix = (head[1] ?? '').toUpperCase();
  const num = head[2] ?? '';
  const suffix = (head[3] ?? '').toUpperCase();
  const model = findModel(book, prefix, num, suffix);
  if (!model) {
    out.problems.push(
      `ยังไม่มีสมุดราคาของรุ่น ${prefix}-${num}${suffix} — สมุดเล่มนี้แปลงมาจากชีต ${Object.values(book.models)
        .map((m) => m.sheet)
        .filter((s, i, a) => s && a.indexOf(s) === i)
        .join(' · ')} เท่านั้น`
    );
    return out;
  }

  out.model = model.code;
  const c: Ctx = { book, model, cfg: { model: model.code }, parts: [], warnings: out.warnings };
  add(c, { text: normalized.slice(0, head[0].length), reads: `รุ่น ${model.code} — ${model.label}`, kind: 'model' });

  const rest = normalized.slice(head[0].length);
  // ตัวอักษรตัวแรกหลัง TS บอกชนิดหัววัด (TSK → K) · BH ไม่มีชนิดหัววัด
  const letter = prefix.startsWith('TS') ? prefix.slice(2, 3) : '';

  if (prefix === 'BH') readBh(c, rest);
  else if (model.code === 'TS-14') readTs14(c, rest, prefix, letter);
  else if (model.code === 'TS-18') readTs18(c, rest, prefix, letter);
  else readTs04(c, rest, prefix);

  // TS-04 คิดราคา Type K/J เป็นราคาตั้ง ส่วน T กับ NTC เป็นตัวเลือกที่บวกเพิ่ม
  if (model.code === 'TSK-04' && letter && !'KJ'.includes(letter)) {
    const opt = letter === 'T' ? 'sensor:T' : letter === 'N' ? 'sensor:NTC' : '';
    if (opt) {
      c.cfg.options = [...(c.cfg.options ?? []), opt];
      add(c, { text: prefix, reads: `หัววัด ${letter === 'T' ? 'Type T' : 'NTC / PTC'} (บวกเพิ่มจาก Type K/J)`, kind: 'option' });
    } else {
      add(c, { text: prefix, reads: `ไม่รู้จักหัววัดชนิด ${letter} ของตระกูล TS-04`, kind: 'unknown' });
    }
  }

  out.parts = c.parts;
  out.cfg = c.cfg;
  return out;
}

/** จำนวนรหัสย่อยที่อ่านไม่ออก — หน้าจอใช้ตัดสินว่าจะขึ้นธงเตือนไหม */
export function unknownParts(p: ParsedCode): CodePart[] {
  return p.parts.filter((x) => x.kind === 'unknown');
}
