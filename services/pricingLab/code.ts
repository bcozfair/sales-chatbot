// ─────────────────────────────────────────────────────────────────────────────
//  "รหัสสินค้า → สเปก" (อ่านรหัสที่คนพิมพ์มา แล้วแปลงเป็น ProductConfig)
//
//  โมดูล "คิดราคาสินค้า" — ถอดออกได้ทั้งก้อน ดู services/pricingLab/README.md
//
//  ⚠️ โมดูลนี้ถูกเรียกจาก routes/pricingLab.ts เท่านั้น และ **ห้ามมีโค้ดเดิมที่ไหน import
//     โฟลเดอร์นี้** — การพึ่งพาเป็นทางเดียวคือสิ่งเดียวที่ทำให้ "ลบทิ้งเมื่อไหร่ก็ได้" เป็นจริง
//     ไม่ใช่แค่ความตั้งใจ · เฟสแรกยังไม่ต่อกับใบเสนอราคา คิดราคาให้ดูอย่างเดียว
//  ด่านตรวจของไฟล์กลุ่มนี้อยู่ที่ scripts/diag/ (pricingGolden.ts · pricingRoundtrip.ts)
//  ซึ่ง import ตัวจริงจากที่นี่ ⇒ แก้โค้ดตรงนี้แล้วด่านเห็นทันที ไม่ใช่ด่านที่เฝ้าสำเนา
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
import { AMP, BH_CATALOG, SHAPE_AXIS, bhSpec, buildBhCode, sameBhCode, type BhFamily, type BhForm, type SizeKey } from './catalogBh.js';

/** หนึ่งรหัสย่อยในรหัสสินค้า พร้อมคำอธิบายว่าระบบอ่านมันว่าอะไร — ใช้โชว์ให้คนตรวจก่อนเชื่อราคา */
export interface CodePart {
  /** ข้อความตามที่อยู่ในรหัส */
  text: string;
  /** อ่านได้ว่าอะไร (ภาษาคน) */
  reads: string;
  /**
   * `choose` = อ่านออกแล้ว แต่ **รหัสไม่พอให้รู้ราคา** ต้องให้คนเลือกเพิ่ม — ตัวเดียววันนี้คือ `T` ของ BH
   * (ชีตมีเต๋าสองราคา 10A/30A แต่แคตตาล็อกเขียนแค่ `T` · เจ้าของสั่ง 2026-09-28 "ต้องเลือกได้ทั้ง 2 แบบ")
   * ยังไม่เลือก = ยังไม่รวมในราคา (แบบเดียวกับ `unknown`) แต่ **ไม่ใช่ของที่ต้องไปตั้งค่าในตารางรหัสย่อย**
   */
  kind: 'model' | 'axis' | 'dim' | 'option' | 'noPrice' | 'unknown' | 'choose';
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
  /**
   * ช่องตามแคตตาล็อก "การสั่งซื้อ" — มีเฉพาะรุ่นที่มีแคตตาล็อกแล้ว (วันนี้ BH-01 · BH-01C · BH-02 · BH-03)
   * หน้าคำนวณราคาใช้วาดช่องกรอก และ `buildBhCode(form)` ต้องได้รหัสเดิมกลับมา (ด่าน `diag:pricing-catalog`)
   */
  form?: BhForm;
}

/** ตัวเลือกที่ **รหัสไม่ได้บอก** แต่คนเลือกมาจากช่องกรอก — วันนี้มีตัวเดียวคือขนาดเต๋า 10A/30A ของ BH */
export interface CodePicks {
  amp?: string;
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
  return [
    ...new Set([
      ...Object.keys(model.base.cells).map((k) => k.split(' | ')[i] ?? ''),
      // ค่าที่ตั้งไว้แต่ยังไม่มีราคา — ต้องอ่านออก ไม่งั้นรหัส TSR-18 จะขึ้น "รหัสไม่ได้บอกชนิดเซนเซอร์"
      ...(model.base.unpriced?.[axis] ?? [])
    ])
  ];
}

/** จับคู่ค่าที่พิมพ์มากับค่าที่ตารางใช้จริง — เทียบแบบไม่สนตัวพิมพ์เล็กใหญ่และรูปแบบเครื่องหมายนิ้ว */
function matchValue(values: string[], raw: string): string | undefined {
  const want = norm(raw).toLowerCase();
  return values.find((v) => norm(v).toLowerCase() === want);
}

/**
 * เกลียวมิล: รหัสเขียนแค่ `M6` แต่หัวคอลัมน์เขียนระยะพิตช์ด้วย (`M6x1.0`)
 * และ TS-01!C16:D16 เขียนกำกับเองว่าพิตช์อีกแบบ (`*M8x1.25` `*M10x1.5`) **ใช้ราคาเดียวกัน**
 * ⇒ จับคู่ด้วยเลขหลัง M เท่านั้น และ **ต้องเหลือค่าเดียว** ไม่งั้นถือว่าอ่านไม่ออก
 */
function matchMetricThread(values: string[], raw: string): string | undefined {
  const m = norm(raw).match(/^M(\d+(?:\.\d+)?)/i);
  if (!m) return undefined;
  const hits = values.filter((v) => norm(v).toUpperCase().match(/^M(\d+(?:\.\d+)?)/)?.[1] === m[1]);
  return hits.length === 1 ? hits[0] : undefined;
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
  const P = prefix.toUpperCase();
  const tokens = (v: string) => v.toUpperCase().split(/[^A-Z0-9]+/);

  // ⚠️ ลำดับนี้สลับไม่ได้: **เจาะจงกว่าต้องมาก่อน** ไม่งั้น `TSPA` จะไปตรงกับคอลัมน์ `TSP`
  // แล้ว PT100 Class A จะถูกคิดราคาเป็น Class B เงียบ ๆ (ต่างกันจริง 500 บาทขึ้นไปทุกขนาด)
  const byParen = values.find((v) => v.toUpperCase().includes(`(${P})`));
  if (byParen) return byParen;
  // ชีต RTD (TS-08 · TS-10) เขียนรหัสตระกูลเป็นหัวคอลัมน์ตรง ๆ ไม่มีวงเล็บ: `TSP` `TSPA` `TSZ`
  const whole = values.find((v) => v.toUpperCase() === P);
  if (whole) return whole;
  // TS-01 เขียนรวมสองตระกูลไว้ช่องเดียว: `TSK/TSJ`
  const byToken = values.find((v) => tokens(v).includes(P));
  if (byToken) return byToken;
  // ชีตที่เรียกด้วยชื่อหัววัดแทนรหัสตระกูล (TSP-12!E10 = `PT1000` เฉย ๆ ไม่มี `(TSZ)` กำกับ)
  // — ใช้ได้ **ต่อเมื่อตรงกับค่าเดียวเท่านั้น** ถ้ากำกวมให้ถือว่าอ่านไม่ออก
  for (const alias of SENSOR_ALIAS[P] ?? []) {
    const hits = values.filter((v) => tokens(v).includes(alias));
    if (hits.length === 1) return hits[0];
  }
  const exact = values.find((v) => v.toUpperCase() === letter.toUpperCase());
  if (exact) return exact;
  // 'Type K/J' — ชีตรวม K กับ J ไว้ช่องเดียวเพราะราคาเท่ากัน
  return values.find((v) => tokens(v).includes(letter.toUpperCase()));
}

/**
 * ชื่อหัววัดที่ชีตใช้แทนรหัสตระกูล — ใช้เป็นทางสุดท้ายและเฉพาะตอนที่ตรงกับค่าเดียว
 * (`PT100` ใส่ไม่ได้ เพราะทุกชีตมีทั้ง Class A และ Class B ⇒ กำกวมเสมอ)
 */
const SENSOR_ALIAS: Record<string, string[]> = {
  TSZ: ['PT1000'],
  TSN: ['NTC', 'PTC']
};

/**
 * หัววัดที่ชีต **ไม่ได้ทำคอลัมน์ราคาตั้งของตัวเองไว้** แต่เขียนกำกับว่า "บวกเพิ่มจาก" คอลัมน์ไหน
 *
 * ตารางนี้เป็น **ไวยากรณ์ของรหัส** ชุดเดียวกับ `threadFromHun` ไม่ใช่ราคา — ราคายังอยู่ใน
 * สมุดราคาทั้งหมด ตารางนี้บอกแค่ว่า "รหัสขึ้นต้นแบบนี้ ให้ยืนอยู่บนคอลัมน์ไหนแล้วติ๊กอะไรเพิ่ม"
 * และจะถูกใช้ **ต่อเมื่อรุ่นนั้นมีกฎบวกเพิ่มของ option นั้นจริง** ⇒ รุ่นที่ชีตไม่ได้เขียนไว้
 * จะออกมาเป็น "อ่านไม่ออก" ไม่ใช่เงียบ ๆ คิดราคาให้
 */
const SENSOR_ADDON: Record<
  string,
  { option: string; basePrefix: string; baseLetter: string; reads: string; guess?: string }
> = {
  TST: { option: 'sensor:T', basePrefix: 'TST', baseLetter: 'K', reads: 'Type T (บวกเพิ่มจาก Type K/J)' },
  TSN: { option: 'sensor:NTC', basePrefix: 'TSN', baseLetter: 'K', reads: 'NTC / PTC (บวกเพิ่มจาก Type K/J)' },
  TSZ: {
    option: 'sensor:PT1000',
    basePrefix: 'TSP',
    baseLetter: 'P',
    reads: 'PT1000 (บวกเพิ่มจาก PT100)',
    // TS-11!H10 เขียนว่า "PT 1000 บวกเพิ่มจาก PT100" เฉย ๆ ทั้งที่ชีตเดียวกันมี PT100 สองคลาส
    // ⇒ ระบบยืนบน Class B (TSP) แล้ว **ติดป้ายว่าตีความเอง** ไม่ใช่ตอบเหมือนของที่ชีตเขียนชัด
    guess: 'ชีตไม่ได้บอกว่าบวกจาก PT100 คลาสไหน — ระบบใช้ Class B (TSP) เป็นฐาน'
  }
};

/** รุ่นนี้มีกฎบวกเพิ่มที่ติ๊กด้วย option นี้จริงไหม */
function hasOptionAdder(model: PriceModel, option: string): boolean {
  return model.adders.some((a) => a.when !== undefined && 'option' in a.when && a.when.option === option);
}

/**
 * ตัวอักษรหลัง `TS` → ชนิดหัววัด — ใช้ได้กับทุกชีตที่วางหัววัดไว้สองแบบ:
 * เป็น **คอลัมน์ของตารางราคาตั้ง** (TS-01 · TS-08 · TS-10 · TS-11) หรือเป็น **กฎบวกเพิ่ม**
 * (TS-04 · TS-06) — ตัวอ่านดูจากสมุดราคาว่าเป็นแบบไหน ไม่ได้ผูกกับรหัสรุ่นในโค้ด
 */
function readSensor(c: Ctx, prefix: string, letter: string): void {
  const values = axisValues(c.model, 'sensor');

  if (values.length > 0) {
    const hit = matchSensor(values, prefix, letter);
    if (hit) {
      c.cfg.axes = { ...c.cfg.axes, sensor: hit };
      add(c, { text: prefix, reads: `หัววัด ${hit}`, kind: 'axis' });
      return;
    }
    const addon = SENSOR_ADDON[prefix];
    const base = addon ? matchSensor(values, addon.basePrefix, addon.baseLetter) : undefined;
    if (addon && base && hasOptionAdder(c.model, addon.option)) {
      c.cfg.axes = { ...c.cfg.axes, sensor: base };
      c.cfg.options = [...(c.cfg.options ?? []), addon.option];
      add(c, {
        text: prefix,
        reads: addon.guess ? `${addon.reads} — ${addon.guess}` : `${addon.reads} · ฐานคือ ${base}`,
        kind: 'axis',
        guess: addon.guess !== undefined
      });
      return;
    }
    add(c, { text: prefix, reads: `ไม่มีหัววัดชนิด ${prefix} ในตารางราคา ${c.model.sheet ?? c.model.code}`, kind: 'unknown' });
    return;
  }

  // ชีตนี้มีราคาตั้งชุดเดียว (Type K/J) — หัววัดอื่นเป็นกฎบวกเพิ่ม
  if (letter === '' || 'KJ'.includes(letter)) return;
  const addon = SENSOR_ADDON[prefix];
  if (addon && hasOptionAdder(c.model, addon.option)) {
    c.cfg.options = [...(c.cfg.options ?? []), addon.option];
    add(c, { text: prefix, reads: addon.reads, kind: 'option' });
    return;
  }
  add(c, {
    text: prefix,
    reads: `ตารางราคา ${c.model.sheet ?? c.model.code} ไม่มีราคาของหัววัดชนิด ${prefix}`,
    kind: 'unknown'
  });
}

// ── ตัวอ่านของแต่ละตระกูล ────────────────────────────────────────────────────

interface Ctx {
  /** รหัสหลังเตรียมแล้ว (ช่องว่างระหว่างตัวเลขของ BH = ขีด) — ของที่ช่องกรอกต้องประกอบกลับให้ได้ */
  input: string;
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
  if (sc.effect === 'option' && !hasOptionAdder(c.model, sc.value ?? '')) {
    // แถวที่ตั้งขอบเขตกว้าง (ทั้งตระกูล/ทุกรุ่น) ให้ไปเปิดกฎที่รุ่นนี้ไม่มี — ปล่อยผ่านเท่ากับบอกว่า
    // "อ่านครบ" ทั้งที่ไม่ได้คิดเงินส่วนนั้นเลย ⇒ ขึ้นแดง
    add(c, { text, reads: `${sc.reads} — ตั้งให้เปิดกฎ ${sc.value ?? '—'} แต่ ${c.model.sheet ?? c.model.code} ไม่มีกฎนี้`, kind: 'unknown' });
    return true;
  }
  c.cfg.options = [...(c.cfg.options ?? []), subCodeOption(token)];
  const kind: CodePart['kind'] =
    sc.effect === 'none' ? 'noPrice' : sc.effect === 'setAxis' ? 'axis' : 'option';
  add(c, { text, reads: sc.reads, kind });
  return true;
}

/**
 * ตัดข้อความเป็นท่อนที่ตารางรหัสย่อยรู้จัก **ยาวสุดก่อน** — คืน `undefined` ถ้าเหลือตัวอักษรที่ไม่รู้จัก
 *
 * แคตตาล็อกเขียนหลายช่องติดกันโดยไม่มีตัวคั่น: สาย `TSU` = ชนิดสาย TS + Ground U ·
 * ท้าย TS_-08 `KBU` = หัวกระโหลก KB + Ground U ⇒ ตั้งตารางทีละช่องแล้วให้ตรงนี้ประกอบเอง
 * ไม่ต้องตั้งทุกคู่ผสม (TS_-08 มีหัว 8 แบบ × Ground 2 แบบ)
 * **อ่านได้ครบทุกตัวอักษรเท่านั้นถึงจะใช้** — `TSU` ของรุ่นที่ไม่มี `TS` จะกลายเป็น `T` + `SU`
 * แล้วได้ราคาผิดชนิด เดาแบบนั้นแย่กว่าบอกว่าอ่านไม่ออก
 */
function splitKnown(c: Ctx, text: string): { pieces: string[]; rest: string } {
  const pieces: string[] = [];
  let rest = text.toUpperCase();
  while (rest) {
    let len = rest.length;
    while (len > 0 && !findSubCode(c.book, c.model, rest.slice(0, len))) len--;
    if (len === 0) break;
    pieces.push(rest.slice(0, len));
    rest = rest.slice(len);
  }
  return { pieces, rest };
}

/** รหัสย่อยที่เหลือจากรหัส ตัดด้วย `-` แล้วยังไม่มีใครอ่าน */
function leftovers(c: Ctx, rest: string): string[] {
  return rest
    .split('-')
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

/**
 * ส่วนสายของ TC: `+1M` `+3M` `+1.5M` `+30cm` — ตัวอักษรที่ตามหลัง M คือ **ชนิดสาย + Ground**
 * ตามแคตตาล็อก (`docs/pricing-code-ts-01.md` · เจ้าของส่งภาพ TS_-01 และ TS_-01-0 มา 2026-09-24)
 *
 * **ความหมายของตัวอักษรอยู่ในตารางรหัสย่อย ไม่ใช่ในไฟล์นี้** — `T` = เทปล่อน ของรุ่นหนึ่ง อาจไม่มี
 * ในอีกรุ่น (TS_-01-0 ไม่มี C/TS) และร้านต้องแก้เองได้ ⇒ ที่นี่แค่ตัดท้ายเป็นท่อนที่ตารางรู้จัก
 * แบบ **ยาวสุดก่อน** (`TSU` = `TS` + `U` ถ้ารุ่นนั้นมี `TS` · ไม่มี = `T` + `SU`)
 * · ท่อนที่ตารางไม่รู้จัก → ขึ้นแดง และถ้ายังไม่มีท่อนไหนบอกชนิดสาย ต้องบอก engine ว่ารหัสพูดถึงสาย
 *   แล้ว (`cfg.unread`) ไม่งั้นมันเติมสายตั้งต้นให้แล้วคิดเงินผิดชนิดเงียบ ๆ (เกือบหลุดมาแล้ว 2026-09-24)
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
  if (!tail) return true;
  // ตัดเป็นท่อนที่ตารางรู้จัก ยาวสุดก่อน — **อ่านได้ครบทุกตัวอักษรเท่านั้นถึงจะใช้** ไม่งั้นทิ้งทั้งท่อน:
  // `TSU` ของ TS_-01-0 (แคตตาล็อกไม่มี TS) จะกลายเป็น `T` + `SU` แล้วได้ราคาสายเทปล่อนทั้งที่
  // อาจเป็นเทปล่อนหุ้มชีลด์ — เดาแบบนั้นแย่กว่าบอกว่าอ่านไม่ออก
  const { pieces, rest } = splitKnown(c, tail);
  if (!rest) {
    for (const p of pieces) readFromTable(c, p);
    return true;
  }
  add(c, {
    text: tail,
    reads: pieces.length
      ? `ชนิดสาย/Ground — ตารางรหัสย่อยของรุ่นนี้อ่านได้ไม่ครบ (รู้จัก ${pieces.join(' + ')} · ไม่รู้จัก ${rest})`
      : 'ชนิดสาย/Ground ที่ตารางรหัสย่อยของรุ่นนี้ยังไม่รู้จัก',
    kind: 'unknown'
  });
  if (c.model.adders.some((a) => a.byAxis === 'cable')) c.cfg.unread = { ...c.cfg.unread, cable: tail.toUpperCase() };
  return true;
}

/**
 * ไวยากรณ์ร่วมของ TC แบบ "แกน × เกลียว" — `TS_-04(S_) 6x100+1M` (TS-04!A7)
 * วงเล็บ = ขนาดเกลียว · ก่อน x = แกน D · หลัง x = ความยาว L1 · +NM = ความยาวสาย
 *
 * ใช้ร่วมกันหลายชีตเพราะหัวตารางเขียนรหัสมาตรฐานไว้เป็นแบบเดียวกัน (TS-04 · TS-06 · TS-08 ·
 * TS-10 · TS-11 · TS-12 · TS-01) — **ส่วนไหนอ่านหรือไม่อ่าน ดูจากแกนที่รุ่นนั้นมีจริงในสมุดราคา**
 * ไม่ใช่จากรหัสรุ่นที่เขียนไว้ในโค้ด: TS-11/TS-12 ไม่มีเกลียวจึงไม่มีวงเล็บ · TS-01 ไม่มีแกน D
 * ในตารางราคาตั้ง (ราคาตามเกลียว) แต่ค่าความยาวแกนแยกราคาตาม D ⇒ อ่าน D ไว้ให้กฎนั้น
 * ⇒ เตือนว่า "ไม่มีวงเล็บ" เฉพาะรุ่นที่มีแกนเกลียวจริงเท่านั้น
 */
function readTsGeneric(c: Ctx, rest: string, prefix: string): void {
  const hasThread = axisValues(c.model, 'thread').length > 0;
  const hasD = axisValues(c.model, 'D').length > 0;
  const dRates = hasD ? [] : [...new Set(c.model.adders.filter((a) => a.byAxis === 'D').flatMap((a) => Object.keys(a.rates ?? {})))];

  const paren = rest.match(/^\(([^)]*)\)/);
  if (paren && !hasThread) {
    // รุ่นที่ไม่มีแกนเกลียว แต่รหัสมีวงเล็บมา — ลองตารางรหัสย่อยก่อน ไม่งั้นบอกว่าอ่านไม่ออก
    const raw = paren[1] ?? '';
    if (!readFromTable(c, raw, `(${raw})`)) {
      add(c, { text: `(${raw})`, reads: `ตารางราคา ${c.model.sheet ?? c.model.code} ไม่มีแกนเกลียว — ยังไม่ได้ตั้งค่าว่าวงเล็บนี้แปลว่าอะไร`, kind: 'unknown' });
    }
    rest = rest.slice(paren[0].length);
  } else if (paren) {
    const raw = paren[1] ?? '';
    const threads = axisValues(c.model, 'thread');
    const hun = raw.match(/^S(\d+)$/i);
    let hit: string | undefined;
    if (hun) {
      for (const cand of threadFromHun(Number(hun[1]))) {
        hit = hit ?? matchValue(threads, cand);
      }
    } else {
      hit = matchValue(threads, raw) ?? matchMetricThread(threads, raw);
    }
    if (hit) {
      c.cfg.axes = { ...c.cfg.axes, thread: hit };
      add(c, { text: `(${raw})`, reads: `เกลียว ${hit}${hun ? ` (${hun[1]} หุน)` : ''}`, kind: 'axis' });
    } else if (readFromTable(c, raw, `(${raw})`)) {
      // มีแถวในตารางรหัสย่อยแล้ว — จบตรงนี้
    } else if (/^M\d/i.test(raw)) {
      add(c, {
        text: `(${raw})`,
        reads: `เกลียวมิล ${raw.toUpperCase()} — ตารางราคา ${c.model.sheet ?? c.model.code} มีแต่เกลียวนิ้ว ยังไม่ได้ตั้งค่าว่าคิดเท่าไหร่`,
        kind: 'unknown'
      });
    } else {
      add(c, { text: `(${raw})`, reads: 'อ่านไม่ออกว่าเป็นเกลียวขนาดไหน', kind: 'unknown' });
    }
    rest = rest.slice(paren[0].length);
  } else if (hasThread && !c.model.axisDefaults?.thread) {
    // รุ่นที่มีเกลียวมาตรฐาน (TS_-01 = 1/4” · TS_-01-0 = M5 ตามแคตตาล็อก) ไม่ต้องเตือน — engine ใช้ค่านั้นแล้วบอกบนบรรทัดราคา
    c.warnings.push('รหัสนี้ไม่มีวงเล็บบอกขนาดเกลียว — ใส่เกลียวต่อท้ายเลขรุ่นแล้วคิดใหม่ เช่น TSK-01(M6)');
  }

  const core = rest.match(/^([0-9.]+[A-WYZ]*)(?:x([0-9.]+))?/i);
  if (core) {
    const dText = core[1] ?? '';
    if (hasD) {
      const dHit = matchValue(axisValues(c.model, 'D'), dText);
      if (dHit) {
        c.cfg.axes = { ...c.cfg.axes, D: dHit };
        add(c, { text: dText, reads: `แกน D = ${dHit} mm`, kind: 'axis' });
      } else {
        add(c, { text: dText, reads: `ไม่มีแกน ${dText} ในตารางราคา ${c.model.sheet ?? c.model.code}`, kind: 'unknown' });
      }
    } else if (dRates.length && matchValue(dRates, dText)) {
      // ขนาดแกนไม่ได้อยู่ในตารางราคาตั้ง แต่กฎบวกเพิ่มแยกราคาตามแกน — TS_-01 ความยาวแกน 4.8 = 110 · 6 = 120
      // ต่อ 100 mm (เจ้าของสั่ง 2026-09-25) ⇒ ต้องจำไว้ ไม่งั้นรหัสที่มี `x` จะขึ้น "รหัสไม่ได้บอกขนาดแกน"
      const hit = matchValue(dRates, dText)!;
      c.cfg.axes = { ...c.cfg.axes, D: hit };
      add(c, { text: dText, reads: `แกน D = ${hit} mm`, kind: 'axis' });
    } else if (Number(dText) === c.model.standard.dia_mm) {
      // TS-01 ทั้งรุ่นใช้แกนขนาดเดียว (ชีตเขียนไว้ในรหัสมาตรฐานเอง) ⇒ ตัวเลขนี้ไม่ได้เลือกอะไร
      add(c, { text: dText, reads: `แกน ${dText} mm — ขนาดเดียวของรุ่นนี้ ไม่มีผลกับราคา`, kind: 'noPrice' });
    } else if (readFromTable(c, dText)) {
      // ขนาดแกนที่แคตตาล็อกบอกความหมายไว้ (TS_-01: 6 mm คู่กับเกลียว M8/M10) — ตั้งในตารางรหัสย่อย
    } else {
      add(c, {
        text: dText,
        reads: `ตารางราคา ${c.model.sheet ?? c.model.code} มีขนาดแกนเดียวคือ ${c.model.standard.dia_mm ?? '—'} mm — ยังไม่ได้ตั้งค่าว่า ${dText} คิดเท่าไหร่`,
        kind: 'unknown'
      });
      // รหัสบอกขนาดแกนมาแล้วแต่อ่านไม่ออก — กฎความยาวแกนต้องขึ้น "ยังไม่รวม" ไม่ใช่ "รหัสไม่ได้บอก"
      if (dRates.length) c.cfg.unread = { ...c.cfg.unread, D: dText };
    }
    if (core[2]) {
      // ความยาวแกนคิดเงินได้ก็ต่อเมื่อชีตมีคอลัมน์ "บวกเพิ่ม 100 mm ละ" ของรุ่นนั้น
      if (c.model.adders.some((a) => a.dim === 'L1')) {
        c.cfg.dims = { ...c.cfg.dims, L1: Number(core[2]) };
        add(c, { text: `x${core[2]}`, reads: `ความยาวแกน L1 = ${core[2]} mm`, kind: 'dim' });
      } else {
        add(c, {
          text: `x${core[2]}`,
          reads: `ตารางราคา ${c.model.sheet ?? c.model.code} ไม่มีราคาส่วนต่างความยาว — ยังไม่ได้ตั้งค่าว่า ${core[2]} mm คิดเท่าไหร่`,
          kind: 'unknown'
        });
      }
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
  // ตัวอ่านหัววัดตัวกลาง — ชีต TS-18 มีกฎ "Type T บวกเพิ่มจาก Type K" (แคตตาล็อก TS_-18 มี T) ซึ่งตัวอ่านเดิม
  // ของรุ่นนี้ดูแค่คอลัมน์ ⇒ `TST-18` ขึ้น "ไม่มีหัววัด" ทั้งที่ Excel มีราคา (เจอ 2026-09-28 ตอนตั้ง "ใช้กับรหัส" ตามแคตตาล็อก)
  readSensor(c, prefix, letter);

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
 * BH — ท่อนเรียงตามแคตตาล็อก "การสั่งซื้อ" (`catalogBh.ts`):
 *   `BH-01 [ID]x[H]-[V]-[W]W-[ขั้วไฟ]-[วัสดุ]` · `BH-01C-[ID]x[H]-[V]-[W]W-[การต่อ]-[ขั้วไฟ]-[วัสดุ]`
 *   `BH-02[Shape] [Size]-[V]-[W]W-[ขั้วไฟ]-[วัสดุ]` · `BH-03 [ID]x[H]-[V]-[W]W-[ขั้วไฟ]`
 * ตัวอย่างที่ฝ่ายขายเขียนเองในชีต: `BH-01C-600x150-380-4950W-PL-PL2` (BH!E19)
 *
 * ความหมายของตัวอักษรมาจากแคตตาล็อก ส่วน **เงินอยู่ที่กฎของสมุดราคา** ตามเดิม (N → `nut` · PL2 → `conn_pl2` ·
 * 1/2/3 → ความยาวสาย → `cable_over_30cm`) · ของที่ชีตยังไม่มีราคา (PL5) ถามตารางรหัสย่อย · ท่อนที่ไม่อยู่ใน
 * แคตตาล็อก (`S000` · `(HPT)` · `2P`) ไปทางเดิมทุกอย่าง (ตารางรหัสย่อย → อ่านไม่ออก) แล้วจำตำแหน่งไว้ใน `form.extras`
 */
function readBh(c: Ctx, num: string, suffix: string, rest: string, picks: CodePicks): BhForm | undefined {
  const family: BhFamily | undefined =
    num === '01' ? (suffix === '' ? 'BH-01' : suffix === 'C' ? 'BH-01C' : undefined)
    : num === '02' ? (suffix in SHAPE_AXIS ? 'BH-02' : undefined)
    : num === '03' ? (suffix === '' ? 'BH-03' : undefined)
    : undefined;
  const spec = family ? bhSpec(family) : undefined;
  const form: BhForm = { family: family ?? 'BH-01', extras: [] };
  let last = 'head';
  let noForm = false;
  const extra = (text: string, glue = false) => form.extras!.push({ text, after: last, ...(glue ? { glue } : {}) });

  // ── ตัวอักษรท้ายเลขรุ่น ────────────────────────────────────────────────────
  if (family === 'BH-02') {
    // BH-02 ใช้ตัวอักษรท้ายเลขรุ่นเป็น "รูปทรง" (Shape ของแคตตาล็อก) · ตัว C ยัง **บวก 20% ตามชีต** ด้วย
    // (เจ้าของเคาะ 2026-09-28 "BH-02C ให้บวก 20% เหมือนเดิมตาม excel") ⇒ C = วงกลม + ตัวเลือก C ของรุ่น
    form.shape = suffix;
    c.cfg.axes = { ...c.cfg.axes, shape: SHAPE_AXIS[suffix]! };
    const shape = spec!.shapes!.find((x) => x.code === suffix)!;
    const v = suffix !== '' ? readModelSuffix(c, suffix, true) : undefined;
    add(c, {
      text: suffix,
      reads: `รูปทรง${shape.label}${suffix === '' ? ' (ไม่มีตัวอักษร = None ของแคตตาล็อก)' : ''}${v ? ` · ${v}` : ''}`,
      kind: 'axis',
    });
    if (suffix === 'S') c.warnings.push('Special Shape — แคตตาล็อกไม่มีสูตรพื้นที่ ต้องขอราคาจากฝ่ายผลิต');
  } else {
    readModelSuffix(c, suffix);
  }

  // ── ขนาด ───────────────────────────────────────────────────────────────────
  const size = rest.match(/^-?([0-9.]+)(?:x([0-9.]+))?(?:x([0-9.]+))?/i);
  if (family === 'BH-02') {
    const want: SizeKey[] = spec!.shapes!.find((x) => x.code === suffix)!.dims;
    const got = size ? [size[1], size[2], size[3]].filter((x): x is string => x !== undefined) : [];
    const dimKey: Record<SizeKey, string> = { id: 'dia_mm', h: 'width_mm', w: 'w_mm', l: 'l_mm', d1: 'd1_mm', d2: 'd2_mm' };
    const text = size ? size[0].replace(/^-/, '') : '';
    if (size && got.length === want.length) {
      want.forEach((k, i) => {
        form[k] = Number(got[i]);
        c.cfg.dims = { ...c.cfg.dims, [dimKey[k]]: Number(got[i]) };
      });
      add(c, { text, reads: want.map((k, i) => `${spec!.slots[k]!.label} ${got[i]} mm`).join(' × '), kind: 'dim' });
    } else if (size) {
      form.sizeText = text;
      add(c, {
        text,
        reads: `ขนาดไม่ตรงแคตตาล็อกของรูปทรงนี้ (ต้องเป็น ${want.map((k) => spec!.slots[k]!.label).join(' × ')}) — ยังคิดพื้นที่ไม่ได้`,
        kind: 'unknown',
      });
    } else {
      c.warnings.push(`อ่านขนาดจากรหัสไม่ได้ — ใส่ขนาดต่อท้ายเลขรุ่น เช่น BH-02 120x345`);
    }
    if (size) rest = rest.slice(size[0].length);
  } else if (size && size[2] !== undefined && size[3] === undefined) {
    c.cfg.dims = { ...c.cfg.dims, dia_mm: Number(size[1]), width_mm: Number(size[2]) };
    form.id = Number(size[1]);
    form.h = Number(size[2]);
    add(c, { text: `${size[1]}x${size[2]}`, reads: `เส้นผ่านศูนย์กลาง (ID) ${size[1]} mm × ความสูง (H) ${size[2]} mm`, kind: 'dim' });
    rest = rest.slice(size[0].length);
  } else {
    c.warnings.push('อ่านขนาด (ID × H) จากรหัสไม่ได้ — ใส่ขนาดต่อท้ายเลขรุ่นแล้วคิดใหม่ เช่น BH-01 600x150');
    noForm = true; // ไม่มีขนาด = ประกอบรหัสกลับไม่ได้ ⇒ ไม่มีช่องให้กรอก (ท่อนอื่นยังอ่านต่อตามเดิม)
  }
  last = 'size';

  // ── ท่อนที่เหลือ ───────────────────────────────────────────────────────────
  const strip = num === '01' || num === '02';           // BH-01 · BH-01C · BH-02 ใช้รายการขั้วไฟชุดเดียวกัน
  const hasMat = strip;
  const hasConn = num === '01' && suffix === 'C';
  const termCodes = new Set((num === '03' ? BH_CATALOG[3]! : BH_CATALOG[0]!).slots.term!.options!.map((o) => o.code).filter(Boolean));

  // ท่อนแรกที่ไม่มีขีดนำหน้า (`216x200+160`) ติดกับขนาด — ต้องจำไว้ ไม่งั้นประกอบกลับแล้วได้ขีดเกินมา
  const firstGlued = rest !== '' && !rest.startsWith('-');
  leftovers(c, rest).forEach((raw, i) => {
    // สิ่งที่ติดท้ายท่อนโดยไม่มีขีด (`T(HPT)` · `240W+1.5M`) — ตัวท่อนอ่านตามแคตตาล็อก ส่วนที่ติดท้ายเป็นท่อนนอกแคตตาล็อก
    const pieces = raw.match(/\([^)]*\)|\+[^(+]*|[^(+]+/g) ?? [raw];
    const core = /^[(+]/.test(pieces[0]!) ? '' : pieces.shift()!;
    if (core !== '') {
      if (i === 0 && firstGlued) readOther(core, true);
      else readBhToken(core);
    }
    pieces.forEach((p, j) => readOther(p, core !== '' || j > 0 || (i === 0 && firstGlued)));
  });

  // BH-03: ไม่ระบุการออกขั้วไฟ = "ออกน็อต + ฝาครอบ" (มาตรฐานของแคตตาล็อก) และ **คิดเพิ่มตามปกติ**
  // (เจ้าของตอบ 2026-09-28: "มาตรฐานคือออกน็อต + ฝาครอบ ใช่ครับ แต่คิดเพิ่มปกติครับ") ⇒ เปิดกฎ `nut` ของรุ่น
  if (num === '03' && form.term === undefined && c.model.adders.some((a) => a.when && 'option' in a.when && a.when.option === 'nut')) {
    c.cfg.options = [...(c.cfg.options ?? []), 'nut'];
    add(c, { text: '', reads: 'การออกขั้วไฟไม่ระบุ = ออกน็อต + ฝาครอบ (มาตรฐานของ BH-03) — คิดค่าออกน็อตตามปกติ', kind: 'option' });
  }

  // ช่องกรอกต้องประกอบกลับเป็นรหัสเดิมเป๊ะ — ไม่งั้นแก้ช่องเดียวแล้วรหัสส่วนอื่นเปลี่ยนตามเงียบ ๆ
  // (รหัสที่เขียนนอกรูปแบบ เช่น `BH-02-S` · ไม่มีหน่วย W · `220x800W`) ⇒ ไม่มีช่อง หน้าจอแสดงแบบอ่านทีละท่อนเหมือนเดิม
  if (!spec || noForm || (form.watt === undefined && form.wattText === undefined)) return undefined;
  return sameBhCode(buildBhCode(form), c.input) ? form : undefined;

  function readBhToken(token: string): void {
    const T = token.toUpperCase();
    // `220V` · `230/400` ก็เป็นแรงดัน (รหัสจริงเขียนแบบนี้หลายสิบตัว) — เก็บตามที่พิมพ์ ประกอบกลับได้เหมือนเดิม
    if (form.volt === undefined && form.watt === undefined && /^\d{2,3}(?:\/\d{2,3})?V?$/.test(T)) {
      form.volt = token;
      last = 'volt';
      add(c, { text: token, reads: `แรงดันไฟ ${token} V — ชีตไม่ได้คิดราคาตามแรงดัน`, kind: 'noPrice' });
      return;
    }
    const watt = T.match(/^(\d+(?:\.\d+)?)W(.*)$/);
    if (form.watt === undefined && form.wattText === undefined && watt) {
      last = 'watt';
      const hasWatt = c.model.standard.watt !== undefined;
      if (watt[2]) {
        form.wattText = token;
        // `800Wx2` ของรุ่นที่ชีตไม่คิดตามกำลังไฟ = ไม่มีผลกับราคา (เหมือนก่อนมีแคตตาล็อก) · `500Wx2P` · `900W,1300W` = อ่านไม่ออก
        const noWattPrice = !hasWatt && /^X\d+$/.test(watt[2]);
        add(c, {
          text: token,
          reads: noWattPrice
            ? `กำลังไฟ ${watt[1]} W คูณ ${watt[2].slice(1)} — รุ่นนี้ชีตไม่ได้คิดราคาตามกำลังไฟ`
            : `กำลังไฟ ${watt[1]} W ตามด้วย "${token.slice(watt[1]!.length + 1)}" — ยังไม่รู้ว่าคิดราคายังไง`,
          kind: noWattPrice ? 'noPrice' : 'unknown',
        });
        return;
      }
      form.watt = Number(watt[1]);
      if (hasWatt) {
        c.cfg.dims = { ...c.cfg.dims, watt: Number(watt[1]) };
        add(c, { text: token, reads: `กำลังไฟ ${watt[1]} W`, kind: 'dim' });
      } else {
        add(c, { text: token, reads: `กำลังไฟ ${watt[1]} W — รุ่นนี้ชีตไม่ได้คิดราคาตามกำลังไฟ`, kind: 'noPrice' });
      }
      return;
    }
    if (hasConn && form.conn === undefined && form.term === undefined && (T === 'SE' || T === 'PL')) {
      form.conn = T;
      last = 'conn';
      add(c, { text: token, reads: `การต่อใช้งานแบบ${T === 'SE' ? 'อนุกรม' : 'ขนาน'} — ไม่มีผลกับราคา`, kind: 'noPrice' });
      return;
    }
    if (form.term === undefined && form.mat === undefined && termCodes.has(T) && (strip || !/^[123]$/.test(T))) {
      form.term = T;
      last = 'term';
      readTerm(T);
      return;
    }
    if (hasMat && form.mat === undefined && T === 'Z') {
      form.mat = 'Z';
      last = 'mat';
      add(c, { text: token, reads: 'วัสดุ Zinc — ชีตคิดราคาเดียวกับสแตนเลส ("สแตนเลส+Zinc")', kind: 'noPrice' });
      return;
    }
    // ตัวเลข 2–3 หลักนอกตำแหน่งแรงดัน (`-210-420-` · `-400W-50`) — ก่อนมีแคตตาล็อกอ่านเป็นแรงดัน "ไม่มีผลกับราคา"
    // ⇒ คงไว้แบบเดิม (ไม่ทำให้รหัสที่เคยคิดครบกลายเป็นไม่ครบ) แต่ไม่ใช่ท่อนของแคตตาล็อก จึงเก็บเป็นท่อนนอกแคตตาล็อก
    if (/^\d{2,3}$/.test(T)) {
      extra(token);
      add(c, { text: token, reads: `แรงดันไฟ ${token} V — ชีตไม่ได้คิดราคาตามแรงดัน`, kind: 'noPrice' });
      return;
    }
    readOther(token, false);
  }

  /** ท่อนนอกแคตตาล็อก — ทางเดิมทุกอย่าง (สาย `+1M`/`50CM` · PL2 · ตารางรหัสย่อย · อ่านไม่ออก) แล้วจำตำแหน่งไว้ */
  function readOther(token: string, glue: boolean): void {
    extra(token, glue);
    if (token.startsWith('(')) {
      if (!readFromTable(c, token.slice(1, -1), token)) add(c, { text: token, reads: 'ยังไม่ได้ตั้งค่าว่าแปลว่าอะไร', kind: 'unknown' });
      return;
    }
    if (readCableBh(c, token)) return;
    if (readCommonToken(c, token)) return;
    if (readFromTable(c, token)) return;
    // หลายช่องติดกันไม่มีตัวคั่น (`BU` = หัว B + Ground U ของ TS_-08) — ครบทุกตัวอักษรถึงจะใช้
    const split = splitKnown(c, token);
    if (split.pieces.length > 1 && !split.rest) {
      for (const p of split.pieces) readFromTable(c, p);
      return;
    }
    add(c, { text: token, reads: 'ยังไม่ได้ตั้งค่าว่าแปลว่าอะไร', kind: 'unknown' });
  }

  function readTerm(T: string): void {
    if (/^[123]$/.test(T)) {
      // "1 = สายยาว 1 M." ของแคตตาล็อก ⇒ ความยาวสายเข้ากฎ "สายยาวเกิน 30 CM" ของชีตตามเดิม
      const cm = Number(T) * 100;
      c.cfg.dims = { ...c.cfg.dims, cable_cm: cm };
      add(c, { text: T, reads: `ออกสายยาว ${T} M (มาตรฐาน ${c.model.standard.cable_cm ?? '—'} CM)`, kind: 'dim' });
      return;
    }
    if (T === 'N') {
      c.cfg.options = [...(c.cfg.options ?? []), 'nut'];
      add(c, { text: T, reads: 'ออกน็อต', kind: 'option' });
      return;
    }
    if (T === 'PL2') {
      if (!readCommonToken(c, T)) add(c, { text: T, reads: `ปลั๊ก PL-2 — ${c.model.sheet ?? c.model.code} ไม่มีราคาปลั๊ก PL-2`, kind: 'unknown' });
      return;
    }
    if (T === 'PL5') {
      // ชีตยังไม่มีราคาปลั๊ก PL-5 — ราคารออยู่ที่ตารางรหัสย่อย (แถวค่าว่าง = "ยังไม่มีราคา") · option ไว้ให้ข้อห้ามความสูงอ่าน
      c.cfg.options = [...(c.cfg.options ?? []), 'conn:pl5'];
      if (!readFromTable(c, T)) {
        add(c, { text: T, reads: 'ปลั๊ก PL-5 — ชีตยังไม่มีราคา และยังไม่ได้ตั้งในตารางรหัสย่อย', kind: 'unknown' });
      }
      return;
    }
    // T = เต๋าเซรามิก — ชีตมีสองราคา (ตัวเล็ก 10A · 30A) แต่รหัสไม่ได้บอก ⇒ ต้องให้คนเลือก ห้ามเดา
    const amp = AMP.find((a) => a.code === picks.amp?.toUpperCase());
    if (amp) {
      form.amp = amp.code;
      c.cfg.options = [...(c.cfg.options ?? []), `term:${amp.code.toLowerCase()}`];
      add(c, { text: T, reads: `เต๋าเซรามิก ${amp.label} (เลือกในช่องขนาดเต๋า — รหัสไม่ได้บอก)`, kind: 'option' });
    } else {
      add(c, { text: T, reads: 'เต๋าเซรามิก — ชีตมีสองราคา (10A · 30A) แต่รหัสไม่ได้บอก ต้องเลือกขนาดเต๋าก่อน ยังไม่รวมในราคา', kind: 'choose' });
    }
  }
}

/**
 * ตัวอักษรท้ายเลขรุ่น สามทางที่ต่างกันคนละเรื่อง:
 *   1. อยู่ในชื่อรุ่นอยู่แล้ว (`TS-01-0`)            ⇒ ไม่ต้องพูดถึง
 *   2. เป็น "ตัวเลือกของรุ่นหลัก" ที่ตั้งราคาไว้แล้ว  ⇒ เปิดใช้แล้วบอกว่าคิดเพิ่มยังไง
 *   3. ไม่มีใครตั้งค่าให้                            ⇒ **ห้ามกลืนทิ้ง**
 * ข้อ 3 เคยกลืนข้อ 2 ไปด้วย: `BH-02C`/`BH-03C` (12 รหัสที่ขายจริง) ตกไปคิดเป็นรุ่นฐาน
 * เปล่า ๆ ไม่บวก 20% แล้วคืนราคาหน้าตาปกติออกมา ไม่มีอะไรฟ้อง (เจอ 2026-09-22)
 * ส่วนข้อ 3 ของจริงยังมีอยู่: `11P` 1,465 รหัส · `11L` 211 · `11LP` 112
 *
 * `quiet` = คืนคำอธิบายของข้อ 2 ให้ผู้เรียกรวมเข้าท่อนของตัวเอง แทนการเพิ่มท่อนใหม่ (C ของ BH-02 คือทั้ง
 * รูปทรงและตัวเลือก — ขึ้นสองท่อนชื่อ C ซ้ำกันคนอ่านจะงง)
 */
function readModelSuffix(c: Ctx, suffix: string, quiet = false): string | undefined {
  const model = c.model;
  const variant =
    suffix !== '' && model.variant && !model.variant.disabled &&
    suffix === model.variant.suffix.toUpperCase()
      ? model.variant
      : undefined;
  if (variant) {
    c.cfg.variant = variant.suffix;
    const pct = variant.percent ?? 0;
    const extra = Object.keys(variant.adderPrices ?? {}).length;
    const reads =
      `${variant.label} — ` +
      (pct ? `บวกเพิ่มจากราคาตั้งอีก ${pct}%` : 'ไม่บวกเพิ่มจากราคาตั้ง') +
      (extra ? ` · ของแถม ${extra} รายการคิดคนละราคากับรุ่นปกติ` : '');
    if (quiet) return reads;
    add(c, { text: suffix, reads, kind: 'model' });
  } else if (suffix !== '' && !model.code.toUpperCase().endsWith(suffix) && !quiet) {
    add(c, {
      text: suffix,
      reads: `ตัวอักษรท้ายเลขรุ่น — สมุดราคามีแต่ตารางของ ${model.code} ยังไม่ได้ตั้งค่าว่า ${suffix} ต่างจากรุ่นฐานยังไง`,
      kind: 'unknown'
    });
  }
  return undefined;
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
    // หลายช่องติดกันไม่มีตัวคั่น (`BU` = หัว B + Ground U ของ TS_-08) — ครบทุกตัวอักษรถึงจะใช้
    const split = splitKnown(c, token);
    if (split.pieces.length > 1 && !split.rest) {
      for (const p of split.pieces) readFromTable(c, p);
      continue;
    }

    add(c, { text: token, reads: 'ยังไม่ได้ตั้งค่าว่าแปลว่าอะไร', kind: 'unknown' });
  }
  void prefix;
}

// ── ตัวหลัก ──────────────────────────────────────────────────────────────────

/**
 * หารุ่นในสมุดราคาจากหัวรหัส — **ต้องเป็นรหัสที่รุ่นนั้นเขียนไว้ใน "ใช้กับรหัส" (`code` + `aliases`) เท่านั้น**
 *
 * เจ้าของสั่ง 2026-09-28: *"รหัสที่ใช้ได้ควรเป็นตัวเลือกที่มีข้อมูลตาม Excel และ pattern การประกอบรหัสตามแคตตาล็อกเท่านั้น"*
 * ⇒ `aliases` ของแต่ละรุ่น = ชนิดเซนเซอร์ที่แคตตาล็อก TS_-xx มี **และ** ชีต Excel มีราคา (แมปรายชีต) ·
 * เดิมมีทางถอย "ตรงตัว → TSK → TSP → ไม่มีตัวอักษร" ทำให้รหัสนอกแคตตาล็อกยืมตารางของตัวอื่นแล้วได้ราคาเงียบ ๆ
 * (`TSR-04` ได้ราคา Type K ทั้งที่ TS_-04 มีแค่ K/J/T · `TSE-06` · `TSZA-08` ฯลฯ) — ถอดทิ้งทั้งหมด
 * · `TS-<เลข>` ที่ไม่มีตัวอักษรชนิดเซนเซอร์ไม่ใช่รหัสตามแคตตาล็อกของรุ่นไหนเลย (`_` ของ TS_-xx ต้องมีเสมอ)
 *   แม้รุ่นในสมุดจะชื่อ `TS-14` / `TS-18` (ชื่อรุ่นในฐานเปลี่ยนไม่ได้ — ประวัติราคาผูกกับชื่อนั้น)
 * · ⚠️ ห้ามเติมทางถอยข้ามตระกูล — เดิมไล่ `BH-<เลข>` ให้ทุกรหัส ⇒ `TSK-01` 1,210 รหัสตกไปใช้ตารางของ
 *   Band Heater แล้วคืนราคาออกมาเป็นปกติ ไม่มีอะไรฟ้อง (เจอ 2026-09-21)
 */
function findModel(book: PriceBook, prefix: string, num: string, suffix: string): PriceModel | undefined {
  if (prefix === 'TS') return undefined;
  return resolveModel(book, `${prefix}-${num}${suffix}`) ?? resolveModel(book, `${prefix}-${num}`);
}

/** รุ่นที่ใช้เลขรุ่นนี้ (ไว้บอกคนพิมพ์ว่าตารางนั้นใช้กับรหัสไหน เมื่อหัวรหัสไม่อยู่ในรายชื่อ) */
function modelsOfNumber(book: PriceBook, num: string): PriceModel[] {
  const tail = new RegExp(`^TS[A-Z]*-${num}$`);
  return Object.values(book.models).filter((m) => [m.code, ...(m.aliases ?? [])].some((c) => tail.test(c)));
}

/**
 * หัวรหัส = ตระกูล + เลขรุ่น + ตัวอักษรท้ายเลขรุ่น
 *
 * `(-0)?` มีไว้สำหรับ `TS_-01-0` ซึ่งเป็น **ตารางราคาคนละตารางในชีตเดียวกัน** (เกลียว M4–M10
 * แทน M6–5/16") ไม่ใช่รหัสย่อยต่อท้าย — 377 จาก 1,210 รหัสของตระกูล 01 เป็นแบบนี้
 */
const HEAD_RE = /^(BH|TS[A-Z]*)-?(\d{2})(-0)?([A-Z]*)/i;

function readHead(normalized: string) {
  const head = normalized.match(HEAD_RE);
  if (!head) return null;
  return {
    text: head[0],
    prefix: (head[1] ?? '').toUpperCase(),
    num: (head[2] ?? '') + (head[3] ?? ''),
    suffix: (head[4] ?? '').toUpperCase(),
  };
}

/**
 * รหัสนี้คิดราคาจากรุ่นไหนในสมุด — **อ่านแค่หัวรหัส** ไม่อ่านขนาด/รหัสย่อย
 *
 * มีไว้ให้หน้า "สมุดราคา" นับว่าแต่ละรุ่นครอบสินค้ากี่รายการ: `parseProductCode` ทั้งตัวกับ
 * สินค้า 22,297 รหัสใช้ **9.8 วินาที** (วัดบน prod 2026-09-23) ส่วนตัวนี้ใช้ไม่กี่ ms
 * ⇒ ใช้ `readHead` + `findModel` ตัวเดียวกับ `parseProductCode` เป๊ะ สองทางจึงตอบรุ่นเดียวกันเสมอ
 */
export function modelOfCode(input: string, book: PriceBook): PriceModel | undefined {
  const h = readHead(norm(input));
  return h ? findModel(book, h.prefix, h.num, h.suffix) : undefined;
}

export function parseProductCode(input: string, book: PriceBook, picks: CodePicks = {}): ParsedCode {
  // BH: ช่องว่างระหว่างตัวเลขสองตัวคือตัวคั่นท่อน (`BH-01 101x150 220-2000W`) — `norm` ลบช่องว่างทิ้งหมด
  // ทำให้ขนาดกับแรงดันติดกันเป็น "101x150220" แล้วได้ราคาของความสูง 150,220 mm เงียบ ๆ (เจอ 2026-09-28 · 23 รหัสจริง)
  const prepared = /^\s*BH/i.test(input) ? input.replace(/(\d)\s+(?=\d)/g, '$1-') : input;
  const normalized = norm(prepared);
  const out: ParsedCode = { input, normalized, parts: [], problems: [], warnings: [] };
  if (normalized === '') {
    out.problems.push('ยังไม่ได้พิมพ์รหัส');
    return out;
  }

  const head = readHead(normalized);
  if (!head) {
    out.problems.push('อ่านไม่ออกว่ารหัสนี้เป็นรุ่นอะไร — รหัสต้องขึ้นต้นด้วยตระกูลและเลขรุ่น เช่น TSK-04 หรือ BH-01');
    return out;
  }

  const { prefix, num, suffix } = head;
  const model = findModel(book, prefix, num, suffix);
  if (!model) {
    // หัวรหัสไม่อยู่ในรายชื่อ แต่เลขรุ่นนี้มีตาราง ⇒ บอกว่าตารางนั้นใช้กับรหัสไหน (ไม่ใช่ "ยังไม่มีสมุดราคา")
    const siblings = prefix === 'BH' ? [] : modelsOfNumber(book, num);
    if (siblings.length) {
      out.problems.push(
        `รหัส ${prefix}-${num}${suffix} ไม่อยู่ในรูปแบบของแคตตาล็อก` +
          (prefix === 'TS' ? ' (ไม่มีตัวอักษรชนิดเซนเซอร์)' : ` (ไม่มีชนิดเซนเซอร์ ${prefix.slice(2)} ในตารางนี้)`) +
          ' — ' + siblings.map((m) => `ตาราง ${m.label} ใช้กับรหัส ${[m.code, ...(m.aliases ?? [])].filter((c) => /^(TS[A-Z]+|BH)-/.test(c)).join(', ')} เท่านั้น`).join(' · ')
      );
      return out;
    }
    out.problems.push(
      `ยังไม่มีสมุดราคาของรุ่น ${prefix}-${num}${suffix} — สมุดเล่มนี้แปลงมาจากชีต ${Object.values(book.models)
        .map((m) => m.sheet)
        .filter((s, i, a) => s && a.indexOf(s) === i)
        .join(' · ')} เท่านั้น`
    );
    return out;
  }

  out.model = model.code;
  const c: Ctx = { input: prepared, book, model, cfg: { model: model.code }, parts: [], warnings: out.warnings };
  add(c, { text: normalized.slice(0, head.text.length), reads: `รุ่น ${model.code} — ${model.label}`, kind: 'model' });

  const rest = normalized.slice(head.text.length);
  // ตัวอักษรตัวแรกหลัง TS บอกชนิดหัววัด (TSK → K) · BH ไม่มีชนิดหัววัด
  const letter = prefix.startsWith('TS') ? prefix.slice(2, 3) : '';

  if (prefix === 'BH') out.form = readBh(c, num, suffix, rest, picks);
  else if (model.code === 'TS-14') { readModelSuffix(c, suffix); readTs14(c, rest, prefix, letter); }
  else if (model.code === 'TS-18') { readModelSuffix(c, suffix); readTs18(c, rest, prefix, letter); }
  else {
    readModelSuffix(c, suffix);
    readTsGeneric(c, rest, prefix);
    // หัววัดอ่านหลังส่วนขนาด เพราะบางชีตคิดมันเป็น "คอลัมน์ของตารางราคาตั้ง" (ต้องรู้แกนอื่นก่อน)
    // และบางชีตคิดเป็น "กฎบวกเพิ่ม" — `readSensor` ดูจากสมุดราคาเองว่าเป็นแบบไหน
    readSensor(c, prefix, letter);
  }

  out.parts = c.parts;
  out.cfg = c.cfg;
  return out;
}

/** จำนวนรหัสย่อยที่อ่านไม่ออก — หน้าจอใช้ตัดสินว่าจะขึ้นธงเตือนไหม */
export function unknownParts(p: ParsedCode): CodePart[] {
  return p.parts.filter((x) => x.kind === 'unknown');
}

/** ท่อนที่ **ยังไม่ได้รวมในราคา** — อ่านไม่ออก หรืออ่านออกแต่ต้องให้คนเลือกเพิ่ม (`choose`) */
export function notInPriceParts(p: ParsedCode): CodePart[] {
  return p.parts.filter((x) => x.kind === 'unknown' || x.kind === 'choose');
}
