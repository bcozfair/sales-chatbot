// ─────────────────────────────────────────────────────────────────────────────
//  "การสั่งซื้อ" ของแคตตาล็อก TS — ลำดับท่อนของรหัส + ตัวเลือกของแต่ละท่อน (11 ตารางที่มีในสมุดราคา)
//
//  โมดูล "คิดราคาสินค้า" — ถอดออกได้ทั้งก้อน ดู services/pricingLab/README.md · docs/pricing-code-ts-catalog.md
//
//  ⚠️ โมดูลนี้ถูกเรียกจาก routes/pricingLab.ts เท่านั้น และ **ห้ามมีโค้ดเดิมที่ไหน import
//     โฟลเดอร์นี้** — การพึ่งพาเป็นทางเดียวคือสิ่งเดียวที่ทำให้ "ลบทิ้งเมื่อไหร่ก็ได้" เป็นจริง
//
//  **ที่มา:** แคตตาล็อก `backup/Catalogue/Catalogue_*_TS_-xx.pdf` หัวข้อ "การสั่งซื้อ" · เจ้าของสั่ง 2026-09-28
//  *"หน้าคำนวณราคาของซีรีย์ TS_ ทั้งหมด ยังไม่ใช้รูปแบบแคตตาล็อคเหมือนซีรีย์ BH"* แล้วเคาะ mockup
//  `mockups/pricing-catalogue-ts.html` + คำถาม 9 ข้อ "ตามที่แนะนำ" (2026-09-29) ⇒ ไฟล์นี้คือข้อมูลชุดเดียวที่ใช้สามที่
//  แบบเดียวกับ `catalogBh.ts`:
//    1. หน้าคำนวณราคาวาดช่องกรอกเรียงตามแคตตาล็อก (ส่งไปทาง `/overview` — ไม่มีราคาสักบาท)
//    2. `buildTsCode` ประกอบรหัสจากช่อง (รูปแบบที่รหัสจริงเขียนมากที่สุด เช่น `-2-BU` · TS_-11 `+5M-PU`)
//    3. `readTsForm` อ่านรหัสกลับเป็นช่อง — **ได้ช่องก็ต่อเมื่อประกอบกลับได้รหัสเดิมทุกตัวอักษร**
//       ไม่งั้นแก้ช่องเดียวแล้วส่วนอื่นของรหัสเปลี่ยนเงียบ ๆ (รหัสนอกรูปแบบได้หน้า "ระบบอ่านรหัสนี้ว่าอะไร" เดิม)
//
//  **ไฟล์นี้ไม่คิดราคาและไม่อ่านราคา** — ตัวอ่านรหัส (`code.ts`) กับตารางรหัสย่อยเป็นคนบอกว่าตัวอักษรไปที่กฎไหน
//  ที่นี่บอกแค่ "ท่อนไหนอยู่ตรงไหน มีตัวเลือกอะไร" · ตัวเลือกที่ Excel ยังไม่มีราคา **ไม่ติดป้ายในรายการ** โดยตั้งใจ
//  เพราะแอดมินกรอกราคาทีหลังได้จากหน้าสมุดราคา — ป้ายที่ฝังไว้ตรงนี้จะเน่าทันทีที่มีคนกรอก ผลคิดราคาเป็นคนบอกเอง
//  ข้อยกเว้นสองข้อที่ความหมายอยู่ที่นี่ (เพราะไม่ใช่ "ตัวอักษรท้ายรหัส" ที่ตารางรหัสย่อยรับได้): หัว NTC/PTC และ Spring P
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogOption } from './catalogBh.js';

export type TsFamily = 'TS_-01' | 'TS_-01-0' | 'TS_-04' | 'TS_-06' | 'TS_-08' | 'TS_-10' | 'TS_-11' | 'TS_-12' | 'TS_-12R' | 'TS_-14' | 'TS_-18';

export interface TsSlot {
  label: string;
  kind: 'choice' | 'number';
  options?: CatalogOption[];
  /** ตัวเลือกที่ขึ้นกับช่อง "ชนิดหัววัด" (TS / N / P) — TS_-04 · 06 · 11 */
  optionsByProbe?: Record<string, CatalogOption[]>;
  unit?: string;
  /** ค่าที่แคตตาล็อกเขียนว่า Standard — โชว์เป็นตัวจางในช่องว่าง */
  placeholder?: string;
  hint?: string;
  /** ช่องตัวเลขที่เว้นว่างได้ (ไม่เขียนลงรหัส = ค่ามาตรฐาน) */
  optional?: boolean;
}

/** `slot` = ช่อง · `sep` = ตัวคั่นที่วาดตามแผนผังแคตตาล็อก (`' '` = เว้นวรรคที่รหัสจริงเขียน) · `fixed` = ตัวอักษรตายตัว */
export type TsLayoutItem = { slot: string } | { sep: string } | { fixed: string };

export interface TsFamilySpec {
  family: TsFamily;
  /** ชื่อบนช่อง "รุ่น" ตามหัวหน้าแคตตาล็อก */
  head: string;
  /** คำในรายการของช่อง "รุ่น" — ชนิดเซนเซอร์บนหัวหน้า + คำในภาพประกอบ (แคตตาล็อก TS ไม่มีชื่อรุ่นแบบ BH) */
  name: string;
  /** รุ่นในสมุดราคาที่ตารางนี้คิดราคา (รหัสในฐาน — ประวัติราคาผูกกับชื่อนี้) */
  model: string;
  layout: TsLayoutItem[];
  slots: Record<string, TsSlot>;
  /** ค่าเริ่มต้นตอนสลับมารุ่นนี้ — รหัสจริงที่พบบ่อยของตารางนั้น */
  defaults: Record<string, string>;
  /** บวกเพิ่มที่ชีตมีราคาแต่แคตตาล็อก/รหัสไม่มีท่อนนี้ (หัก L · หักฉาก — ข้อ 8) · `code` = option ของกฎในสมุดราคา */
  addons?: CatalogOption[];
  /**
   * ช่องที่ **ค่านอกแคตตาล็อก = ต้องขอราคาจากฝ่ายผลิต** และแอดมินเพิ่มค่านั้นเป็นช่องในตารางของชีตได้เองจากหน้าสมุดราคา
   * (ช่องของแคตตาล็อก → แกนในสมุดราคา) — เจ้าของสั่ง 2026-09-29 (TS_-01 ก่อน · เคาะ mockup `ts01-ask-price` แบบ A):
   * *"ทุกข้อที่ต้องขอราคาจากฝ่ายผลิต ต้องมี ui รองรับให้สามารถเอาราคามาใส่ได้ภายหลังเองได้โดยไม่ต้องมาแก้โค้ดอีก"*
   *   · `sensor` — หัวรหัสที่ไม่อยู่ในรายการ (`TSE-01`) ได้รุ่นนี้ แต่คิดได้จาก **แถวของตัวเองเท่านั้น** (ไม่ยืมแถวอื่น)
   *   · `thread` — เกลียวที่ไม่อยู่ในรายการ (M12 · S1–S4 · 1/8) = คอลัมน์ของตัวเอง · ไม่แปลง "หุน" เป็นเกลียวนิ้ว
   *     (`S2` = 1/4” **NPT** ไม่ใช่ 1/4” ของตาราง — เจ้าของเคาะ B#7)
   *   · `d` — ขนาดแกนที่ไม่อยู่ในรายการ ใช้อัตราความยาวแกนของ **ขนาดถัดขึ้นไปที่มีอัตรา** (4 → 4.8 · 5 → 6 · เจ้าของเคาะ B#2)
   *     ใหญ่กว่าทุกขนาดที่มีอัตรา = ขอราคา · แอดมินเพิ่มขนาดใหม่พร้อมอัตรา = ราคาตั้งของคอลัมน์เกลียว + อัตราใหม่
   * ไม่มีช่องนี้ = รุ่นนั้นใช้กติกาเดิมทุกอย่าง (ค่าที่ตารางไม่มี = อ่านไม่ออก)
   */
  askPrice?: { sensor?: string; thread?: string; d?: string };
  /**
   * ขนาดแกน → เกลียวที่แคตตาล็อกจับคู่ไว้ (ค่าในรายการของช่อง) — ไม่คู่ = **เตือน ไม่บล็อก** และคิดราคาตามแกนในรหัส
   * (เจ้าของเคาะ B#8 2026-09-29: ราคาตั้งไม่ขึ้นกับแกน · Odoo ขาย `TSK-01(M6)5x50+1M` ที่ 160 + อัตราแกน 6)
   */
  dThreads?: Record<string, string[]>;
}

/** ค่าที่กรอกในช่อง — ตัวเดียวกันทั้งตอนอ่านรหัสออกมาและตอนประกอบกลับ */
export interface TsForm {
  family: TsFamily;
  /** ช่อง → รหัสในช่องนั้น (`''` = None ของแคตตาล็อก / ช่องตัวเลขที่เว้นว่าง) — ตัวเลขเก็บเป็นข้อความตามที่พิมพ์ */
  values: Record<string, string>;
  /** บวกเพิ่มที่ติ๊ก (ไม่อยู่ในรหัส) */
  addons?: string[];
  /** ท่อนต่อท้ายที่ไม่อยู่ในแคตตาล็อก (`S000` · `TM000` — ตัวอักษรตามด้วยตัวเลข) ตามลำดับเดิม — ประกอบกลับเป็น `-S000` */
  extras?: string[];
}

// ── ตัวเลือกของแต่ละท่อน (ตรงกับตาราง "การสั่งซื้อ" ทีละตัว) ─────────────────────────────

const o = (code: string, label: string): CatalogOption => ({ code, label });

const TC_KJT = [o('K', 'Type K'), o('J', 'Type J'), o('T', 'Type T')];
const RTD = [o('P', 'PT100 Class B'), o('PA', 'PT100 Class A'), o('Z', 'PT1000 Class B')];
const NTC_TYPES = [o('2', '2K'), o('10', '10K')];
const INCH = [o('S1', '1/8” NPT'), o('S2', '1/4” NPT'), o('S3', '3/8” NPT'), o('S4', '1/2” NPT'), o('S6', '3/4” NPT'), o('S8', '1” NPT')];
const METRIC = [o('M8', 'M8 x 1 (8 mm)'), o('M10', 'M10 x 1.25 (10 mm)'), o('M12', 'M12 x 1.25 (12 mm)')];
const mm = (list: string[], note: Record<string, string> = {}) => list.map((d) => o(d, `${d} mm${note[d] ? ` ${note[d]}` : ''}`));
const D_TC = ['2', '3', '3.2', '4', '4.8', '5', '6', '6.35', '7', '8', '9.5', '10', '12.7', '15.8', '15.97', '17.5', '19', '21.3'];
const D_RTD = ['3.2', '4', '4.8', '5', '6', '6.35', '7', '8', '9.5', '10', '12.7', '15.8', '17.5', '19', '21.3'];
const TITANIUM = { '7': '(Titanium · เฉพาะเกลียว S4)' };
const MAT_TC = [o('', 'SUS 304'), o('A', 'SUS 316L'), o('B', 'SUS 310S'), o('I', 'Inconel 600'), o('S', 'Sheath 316 (Thermocouple เท่านั้น)'),
  o('T', 'SUS 304 With Teflon Coated'), o('TN', 'Titanium'), o('AT', 'SUS 316 With Teflon Coated')];
const MAT_RTD = [o('', 'SUS 304'), o('A', 'SUS 316L'), o('T', 'SUS 304 With Teflon Coated'), o('TN', 'Titanium'), o('AT', 'SUS 316 With Teflon Coated')];
const ELEMENT = [o('', '1 Element'), o('2', '2 Element')];
const HEADS = [o('', 'Aluminium (Standard)'), o('B', 'Aluminium (Big Head)'), o('S', 'Aluminium (Small Head)'), o('E', 'Stainless Expension Proof (Big Head)'),
  o('K', 'Bakelite'), o('KB', 'Bakelite (Big Head)'), o('SS', 'Stainless'), o('SB', 'Stainless (Big Head)')];
const GROUND = [o('', 'Ground (Standard for Thermocouple)'), o('U', 'Unground')];
const GROUND_RTD = [o('', 'ไม่ระบุ'), o('U', 'Unground')];
const PROBE = [o('TS', 'Thermocouple'), o('N', 'NTC'), o('P', 'PTC')];

const L1: TsSlot = { label: 'ความยาวแกน', kind: 'number', unit: 'mm', placeholder: '100', hint: 'Standard 100 mm · ต่ำสุด 10 mm' };
const CL: TsSlot = { label: 'ความยาวสาย', kind: 'number', unit: 'M', placeholder: '1', hint: 'แคตตาล็อก 1–5 M · ระบุความยาวได้ตามต้องการ' };
const ch = (label: string, options: CatalogOption[], hint?: string): TsSlot => ({ label, kind: 'choice', options, ...(hint ? { hint } : {}) });
const sensorByProbe = (tc: CatalogOption[]): TsSlot => ({ label: 'ชนิด Sensor', kind: 'choice', optionsByProbe: { TS: tc, N: NTC_TYPES, P: NTC_TYPES } });

/** หัก L / หักฉาก — ชีต TS-06 · 08 · 10 · 11 · TSP-12 มีราคา แต่รหัสไม่มีท่อนนี้ (เจ้าของเคาะข้อ 8 · 2026-09-29) */
export const TS_ADDONS: CatalogOption[] = [o('bend:L', 'หัก L ดัดงอ'), o('bend:square', 'หักฉาก (เชื่อมฉาก)')];

/** หัว NTC/PTC ตามแคตตาล็อก TS_-04 · 06 · 11 ("N_-04/P_-04") = ชนิดหัววัด + ชนิด Sensor (2 = 2K · 10 = 10K) — เจ้าของเคาะข้อ 1 */
export const NTC_HEADS: Record<string, string> = { N2: 'NTC 2K', N10: 'NTC 10K', P2: 'PTC 2K', P10: 'PTC 10K' };
/** เลขรุ่นที่แคตตาล็อกมีหัว NTC/PTC — ตารางอื่นไม่มี (TSN-18 ของ Excel ยังพิมพ์เป็น TSN ได้เหมือนเดิม) */
export const NTC_NUMBERS = ['04', '06', '11'];

/**
 * ตัวอักษรท้ายเลขรุ่นที่แคตตาล็อกบอกความหมาย — วันนี้ตัวเดียวคือ Spring ของ TS_-11 (P = None Spring)
 * เจ้าของเคาะข้อ 4 (2026-09-29): **ไม่มีผลกับราคา** · อยู่ที่นี่ ไม่ใช่ตารางรหัสย่อย เพราะ `P` ของรุ่นเดียวกัน
 * ในตารางรหัสย่อยคือ "สายพีวีซี" แล้ว (ท่อนหลัง M) — ตัวอักษรเดียวกันคนละตำแหน่ง ตารางเดียวแยกไม่ได้
 */
export const MODEL_SUFFIX: Record<string, Record<string, string>> = {
  'TSK-11': { P: 'None Spring (ไม่มีสปริง) — ไม่มีผลกับราคา' },
};

export const TS_CATALOG: TsFamilySpec[] = [
  {
    family: 'TS_-01', head: 'TS_-01', name: 'Thermocouple / RTD · Thread + Spring + Cable', model: 'TSK-01',
    layout: [{ fixed: 'TS' }, { slot: 'sensor' }, { sep: '-01(' }, { slot: 'thread' }, { sep: ')' }, { slot: 'd' }, { slot: 'mat' },
      { sep: 'x' }, { slot: 'l1' }, { sep: '+' }, { slot: 'cl' }, { sep: 'M' }, { slot: 'cable' }, { slot: 'ground' }],
    slots: {
      sensor: ch('ชนิด Sensor', [...TC_KJT, ...RTD]),
      // M8x1.25 · M10x1.5 = ตัวหนังสือแดงใต้ตารางของชีต ("*M8x1.25" ใต้ M8x1.0) — ราคาเดียวกับคอลัมน์ข้างบน (เจ้าของสั่ง 2026-09-29)
      thread: ch('ขนาดเกลียว', [o('', '1/4 นิ้ว (Standard)'), o('5/16', '5/16 นิ้ว'), o('M6', 'M6 x 1.0'), o('M8', 'M8 x 1.0'),
        o('M8x1.25', 'M8 x 1.25 — ราคาเดียวกับ M8'), o('M10', 'M10 x 1.25'), o('M10x1.5', 'M10 x 1.5 — ราคาเดียวกับ M10')]),
      d: ch('ขนาดแกน', [o('4.8', '4.8 mm (1/4”, 5/16”, M6)'), o('6', '6 mm (M8, M10)')]),
      mat: ch('วัสดุ', [o('', 'SUS 304')]),
      l1: { ...L1, placeholder: '5', optional: true, hint: 'None = 5 mm · ระบุความยาวได้ตามต้องการ' },
      cl: CL,
      cable: ch('ชนิดสาย', [o('', 'สแตนเลสถัก (Standard)'), o('C', 'ซิลิโคน'), o('F', 'ไฟเบอร์กลาส'), o('P', 'พีวีซี'), o('T', 'เทปล่อน'), o('TS', 'เทปล่อนหุ้มชีลด์')]),
      ground: ch('Ground', GROUND),
    },
    defaults: { sensor: 'K', thread: 'M6', d: '4.8', mat: '', l1: '', cl: '1', cable: '', ground: '' },
    askPrice: { sensor: 'sensor', thread: 'thread', d: 'D' },
    dThreads: { '4.8': ['', '5/16', 'M6'], '6': ['M8', 'M8x1.25', 'M10', 'M10x1.5'] },
  },
  {
    family: 'TS_-01-0', head: 'TS_-01-0', name: 'Thermocouple / RTD · Hold Size (ID1) + Cable', model: 'TSK-01-0',
    layout: [{ fixed: 'TS' }, { slot: 'sensor' }, { sep: '-01-0(' }, { slot: 'hold' }, { sep: ')' }, { sep: '+' }, { slot: 'cl' }, { sep: 'M' }, { slot: 'cable' }, { slot: 'ground' }],
    slots: {
      sensor: ch('ชนิด Sensor', [...TC_KJT, ...RTD]),
      hold: ch('ขนาด Hold Size', [o('', 'M5 (Standard)'), o('M4', 'M4'), o('M6', 'M6'), o('M8', 'M8'), o('M10', 'M10')]),
      cl: CL,
      // C/TS ไม่อยู่ในภาพ TS_-01-0 แต่ขายจริง — เจ้าของเปิดให้ 2026-09-25 ราคาเดียวกับ TS_-01
      cable: ch('ชนิดสาย', [o('', 'สแตนเลสถัก (Standard)'), o('F', 'ไฟเบอร์กลาส'), o('P', 'พีวีซี'), o('T', 'เทปล่อน'), o('C', 'ซิลิโคน'), o('TS', 'เทปล่อนหุ้มชีลด์')]),
      ground: ch('Ground', GROUND),
    },
    defaults: { sensor: 'K', hold: '', cl: '1', cable: '', ground: '' },
  },
  {
    family: 'TS_-04', head: 'TS_-04', name: 'Thermocouple / NTC / PTC · Thread + Spring + Cable', model: 'TSK-04',
    layout: [{ slot: 'probe' }, { slot: 'sensor' }, { sep: '-04(' }, { slot: 'thread' }, { sep: ')' }, { slot: 'd' }, { slot: 'mat' }, { sep: 'x' }, { slot: 'l1' },
      { sep: '-' }, { slot: 'elem' }, { sep: '+' }, { slot: 'cl' }, { sep: 'M' }, { slot: 'cable' }, { slot: 'ground' }],
    slots: {
      probe: ch('ชนิดหัววัด', PROBE), sensor: sensorByProbe(TC_KJT),
      thread: ch('ขนาดเกลียว', [...INCH, ...METRIC]),
      d: ch('ขนาดแกน', mm(D_TC, TITANIUM), 'NTC/PTC แกน 5 mm ขึ้นไป'),
      mat: ch('วัสดุ', MAT_TC),
      l1: L1, elem: ch('จำนวน Element', ELEMENT, 'ทำ 2 Element ได้ตั้งแต่แกน 6 mm'), cl: CL,
      cable: ch('ชนิดสาย', [o('', 'สแตนเลสถัก (Standard)'), o('F', 'ไฟเบอร์กลาส'), o('P', 'พีวีซี'), o('T', 'เทปล่อน')]),
      ground: ch('Ground', GROUND, 'NTC/PTC Unground เท่านั้น'),
    },
    defaults: { probe: 'TS', sensor: 'K', thread: 'S2', d: '6', mat: '', l1: '100', elem: '', cl: '1', cable: '', ground: '' },
  },
  {
    family: 'TS_-06', head: 'TS_-06', name: 'Thermocouple / NTC / PTC · Thread + Head', model: 'TSK-06',
    layout: [{ slot: 'probe' }, { slot: 'sensor' }, { sep: '-06(' }, { slot: 'thread' }, { sep: ')' }, { slot: 'd' }, { slot: 'mat' }, { sep: 'x' }, { slot: 'l1' },
      { sep: '-' }, { slot: 'elem' }, { sep: '-' }, { slot: 'hd' }, { slot: 'ground' }],
    slots: {
      probe: ch('ชนิดของหัววัด', PROBE), sensor: sensorByProbe(TC_KJT),
      thread: ch('ขนาดเกลียว', [...INCH, ...METRIC]),
      d: ch('ขนาดแกน', mm(D_TC, TITANIUM), 'NTC/PTC แกน 5 mm ขึ้นไป'),
      mat: ch('วัสดุ', MAT_TC),
      l1: L1, elem: ch('จำนวน Element', ELEMENT, 'ทำ 2 Element ได้ตั้งแต่แกน 6 mm'),
      hd: ch('ชนิดหัวกระโหลก', HEADS), ground: ch('Ground', GROUND, 'NTC/PTC Unground เท่านั้น'),
    },
    defaults: { probe: 'TS', sensor: 'K', thread: 'S4', d: '6', mat: '', l1: '100', elem: '', hd: '', ground: '' },
    addons: TS_ADDONS,
  },
  {
    family: 'TS_-08', head: 'TS_-08', name: 'RTD · Thread + RTD Head', model: 'TSP-08',
    layout: [{ fixed: 'TS' }, { slot: 'sensor' }, { sep: '-08(' }, { slot: 'thread' }, { sep: ')' }, { slot: 'd' }, { slot: 'mat' }, { sep: 'x' }, { slot: 'l1' },
      { sep: '-' }, { slot: 'elem' }, { sep: '-' }, { slot: 'hd' }, { slot: 'ground' }],
    slots: {
      sensor: ch('ชนิดของ Sensor', RTD), thread: ch('ขนาดเกลียว', [...INCH, ...METRIC]),
      d: ch('ขนาดแกน', mm(D_RTD, TITANIUM)), mat: ch('วัสดุ', MAT_RTD),
      l1: L1, elem: ch('จำนวน Element', ELEMENT, 'ทำ 2 Element ได้ตั้งแต่แกน 6 mm'),
      hd: ch('ชนิดหัวกระโหลก', HEADS), ground: ch('Ground', GROUND_RTD),
    },
    defaults: { sensor: 'P', thread: 'S4', d: '6', mat: '', l1: '100', elem: '', hd: '', ground: 'U' },
    addons: TS_ADDONS,
  },
  {
    family: 'TS_-10', head: 'TS_-10', name: 'RTD · Thread + Spring + Cable', model: 'TSP-10',
    layout: [{ fixed: 'TS' }, { slot: 'sensor' }, { sep: '-10(' }, { slot: 'thread' }, { sep: ')' }, { slot: 'd' }, { slot: 'mat' }, { sep: 'x' }, { slot: 'l1' },
      { sep: '-' }, { slot: 'elem' }, { sep: '+' }, { slot: 'cl' }, { sep: 'M' }, { slot: 'cable' }, { slot: 'ground' }],
    slots: {
      sensor: ch('ชนิดของ RTD', RTD), thread: ch('ขนาดเกลียว', [...INCH, ...METRIC]),
      d: ch('ขนาดแกน', mm(D_RTD, TITANIUM)), mat: ch('วัสดุ', [...MAT_RTD, o('AL', 'SUS 316L (Low Carbon)')]),
      l1: L1, elem: ch('จำนวน Element', ELEMENT, 'ทำ 2 Element ได้ตั้งแต่แกน 6 mm'), cl: CL,
      cable: ch('ชนิดสาย', [o('', 'พีวีซี (Standard for RTD)'), o('P', 'พีวีซี'), o('C', 'ซิลิโคน'), o('T', 'เทปล่อน'), o('TS', 'เทปล่อนหุ้มชีลด์')]),
      ground: ch('Ground', GROUND_RTD),
    },
    defaults: { sensor: 'P', thread: 'S4', d: '6', mat: '', l1: '100', elem: '', cl: '1', cable: 'P', ground: 'U' },
    addons: TS_ADDONS,
  },
  {
    family: 'TS_-11', head: 'TS_-11', name: 'Thermocouple / RTD / NTC / PTC · Spring + Cable', model: 'TSK-11',
    layout: [{ slot: 'probe' }, { slot: 'sensor' }, { sep: '-11' }, { slot: 'spring' }, { sep: ' ' }, { slot: 'd' }, { slot: 'mat' }, { sep: 'x' }, { slot: 'l1' },
      { sep: '-' }, { slot: 'elem' }, { sep: '+' }, { slot: 'cl' }, { sep: 'M-' }, { slot: 'cable' }, { slot: 'ground' }],
    slots: {
      probe: ch('ชนิดของหัววัด', [o('TS', 'Thermocouple / RTD'), o('N', 'NTC'), o('P', 'PTC')]), sensor: sensorByProbe([...TC_KJT, ...RTD]),
      spring: ch('Spring', [o('', 'with Spring'), o('P', 'None Spring')]),
      d: ch('ขนาดแกน', mm(['2', '3', '3.2', '4', '4.8', '5', '6', '6.35', '7', '8', '9.5', '10'], { '7': '(Titanium)' }), 'NTC/PTC แกน 5 mm ขึ้นไป'),
      mat: ch('วัสดุ', MAT_RTD),
      l1: L1, elem: ch('จำนวน Element', ELEMENT, 'ทำ 2 Element ได้ตั้งแต่แกน 6 mm'), cl: CL,
      cable: ch('ชนิดสาย', [o('', 'สแตนเลสถัก (Standard)'), o('P', 'พีวีซี (Standard for RTD · แกน 5 mm ขึ้นไป)'), o('T', 'เทปล่อน'), o('TS', 'เทปล่อนหุ้มชีลด์')]),
      ground: ch('Ground', [o('', 'Ground (Standard for Thermocouple)'), o('U', 'Unground (Standard for RTD)')]),
    },
    defaults: { probe: 'TS', sensor: 'P', spring: '', d: '6', mat: '', l1: '100', elem: '', cl: '1', cable: 'P', ground: 'U' },
    addons: TS_ADDONS,
  },
  {
    family: 'TS_-12', head: 'TS_-12', name: 'Thermocouple · Sheath + Spring + Cable', model: 'TSK-12',
    layout: [{ fixed: 'TS' }, { slot: 'sensor' }, { sep: '-12' }, { sep: ' ' }, { slot: 'd' }, { sep: 'x' }, { slot: 'l1' }, { sep: '+' }, { slot: 'cl' }, { sep: 'M' }, { slot: 'cable' }, { slot: 'ground' }],
    slots: {
      sensor: ch('ชนิดของเทอร์โมคัปเปิ้ล', [o('K', 'Type K'), o('J', 'Type J')]),
      d: ch('ขนาดแกน', [o('1', '1 mm'), o('1.5', '1.5 mm (Type K Only)'), o('1.6', '1.6 mm (Type J Only)'), ...mm(['2.5', '3', '3.2', '4.8', '6', '6.35', '8'])]),
      l1: L1, cl: CL,
      cable: ch('ชนิดสาย', [o('S', 'สแตนเลสถัก (Standard)'), o('F', 'ไฟเบอร์กลาส'), o('P', 'พีวีซี'), o('T', 'เทปล่อน'), o('', 'ไม่ระบุ (= สแตนเลสถัก)')]),
      ground: ch('Ground', GROUND),
    },
    defaults: { sensor: 'K', d: '3.2', l1: '100', cl: '1', cable: 'S', ground: '' },
  },
  {
    family: 'TS_-12R', head: 'TS_-12', name: 'RTD · Spring + Cable', model: 'TSP-12',
    layout: [{ fixed: 'TS' }, { slot: 'sensor' }, { sep: '-12' }, { sep: ' ' }, { slot: 'd' }, { slot: 'mat' }, { sep: 'x' }, { slot: 'l1' },
      { sep: '-' }, { slot: 'elem' }, { sep: '+' }, { slot: 'cl' }, { sep: 'M' }, { slot: 'cable' }, { slot: 'ground' }],
    slots: {
      sensor: ch('ชนิดของ RTD', RTD),
      d: ch('ขนาดแกน', mm(['2', '3', '3.2', '4', '4.8', '5', '6', '6.35', '8', '9.5', '10'])),
      mat: ch('วัสดุ', [o('', 'SUS 304'), o('A', 'SUS 316'), o('T', 'SUS 304 With Teflon Coated'), o('AT', 'SUS 316 With Teflon Coated')]),
      l1: L1, elem: ch('จำนวน Element', ELEMENT, 'ทำ 2 Element ได้ตั้งแต่แกน 6 mm'), cl: CL,
      cable: ch('ชนิดสาย', [o('P', 'พีวีซี'), o('C', 'ซิลิโคน'), o('T', 'เทปล่อน'), o('TS', 'เทปล่อนหุ้มชีลด์')]),
      ground: ch('Ground', GROUND_RTD),
    },
    defaults: { sensor: 'P', d: '6', mat: '', l1: '100', elem: '', cl: '1', cable: 'P', ground: 'U' },
    addons: TS_ADDONS,
  },
  {
    family: 'TS_-14', head: 'TS_-14', name: 'Thermocouple · High-Temperature (Ceramic) · Sleeve + Head', model: 'TS-14',
    layout: [{ fixed: 'TS' }, { slot: 'sensor' }, { sep: '-14(' }, { slot: 'thread' }, { sep: ')' }, { slot: 'd' }, { sep: 'x' }, { slot: 'l1' }, { sep: '+' }, { slot: 'l2' },
      { sep: '-' }, { slot: 'elem' }, { slot: 'hd' }, { slot: 'ground' }],
    slots: {
      // J ไม่อยู่ในแคตตาล็อกแต่ Excel มีราคา — "แคตตาล็อก ∪ Excel" (เจ้าของ 2026-09-28)
      sensor: ch('ชนิดของเทอร์โมคัปเปิ้ล', [o('K', 'Type K'), o('J', 'Type J'), o('R', 'Type R'), o('S', 'Type S')]),
      thread: ch('ขนาดเกลียว', [o('', 'Sleeve (ไม่มีเกลียว)'), ...INCH]),
      d: ch('ขนาดแกน', [o('6', '6 mm (Sleeve 12.7)'), o('10', '10 mm (Sleeve 15.8)'), o('13', '13 mm (Sleeve 20.5)'), o('15', '15 mm (Sleeve 20.5)'),
        o('17', '17 mm (Sleeve 22.5)'), o('20', '20 mm (Sleeve 25.4)'), o('28', '28 mm (Silicon Carbide · Sleeve 38)')]),
      l1: { ...L1, hint: 'Standard 100 mm · สูงสุด 1000 mm' },
      l2: { label: 'ความยาว Sleeve', kind: 'number', unit: 'mm', placeholder: '50', optional: true, hint: 'None = 50 mm (Standard)' },
      elem: ch('จำนวน Element', ELEMENT, 'ทำ 2 Element ได้ตั้งแต่ Ø15 mm'),
      hd: ch('ชนิดหัวกระโหลก', [o('', 'Aluminium (Standard) — แกน 6 mm เท่านั้น'), ...HEADS.slice(1)]),
      ground: ch('Ground', GROUND_RTD),
    },
    defaults: { sensor: 'K', thread: '', d: '10', l1: '100', l2: '', elem: '', hd: 'B', ground: 'U' },
  },
  {
    family: 'TS_-18', head: 'TS_-18', name: 'Thermocouple / RTD · Flange + Sleeve + Head', model: 'TS-18',
    layout: [{ fixed: 'TS' }, { slot: 'sensor' }, { sep: '-18(' }, { slot: 'fl' }, { sep: ')' }, { slot: 'd1' }, { sep: '-' }, { slot: 'd2' }, { slot: 'mat' }, { sep: 'x' },
      { slot: 'l1' }, { sep: '+' }, { slot: 'l2' }, { sep: '-' }, { slot: 'elem' }, { sep: '-' }, { slot: 'hd' }, { slot: 'ground' }],
    slots: {
      // N = NTC ของ Excel ("บวกเพิ่มจาก Type K") — แคตตาล็อก TS_-18 ไม่มี แต่ Excel มีราคา
      sensor: ch('ชนิดของเซนเซอร์', [...TC_KJT, o('R', 'Type R'), o('S', 'Type S'), ...RTD, o('N', 'NTC (Excel)')]),
      fl: ch('ขนาดหน้าแปลน', [o('F1', '1/2” JIS 10K'), o('F2', '3/4” JIS 10K'), o('F3', '1” JIS 10K'), o('F4', '1 1/2” JIS 10K'), o('F5', '2” JIS 10K'),
        o('1', 'เฟอร์รูล 1 นิ้ว (Excel)'), o('1.5', 'เฟอร์รูล 1.5 นิ้ว'), o('2', 'เฟอร์รูล 2 นิ้ว'), o('2.5', 'เฟอร์รูล 2.5 นิ้ว')]),
      d1: ch('ขนาดแกน (D1)', mm(D_TC.filter((d) => d !== '7'))),
      d2: ch('แกน Sleeve (D2)', mm(D_TC.filter((d) => d !== '7')), 'ไม่ควรเล็กกว่า D1 · ตารางราคาคิดจาก D2'),
      mat: ch('วัสดุ', [o('', 'SUS 304'), o('A', 'SUS 316L'), o('B', 'SUS 310S'), o('I', 'Inconel 600'), o('S', 'Sheath 316 (Thermocouple เท่านั้น)')]),
      l1: { ...L1, hint: 'Standard 100 mm · สูงสุด 1000 mm' },
      l2: { label: 'ความยาว Sleeve', kind: 'number', unit: 'mm', placeholder: '50', optional: true, hint: 'Standard: Ferrule 20 · Flange 50' },
      elem: ch('จำนวน Element', ELEMENT, 'ทำ 2 Element ได้ตั้งแต่แกน 6 mm'),
      hd: ch('ชนิดหัวกระโหลก', HEADS), ground: ch('Ground', [o('', 'Ground (Standard for Thermocouple)'), o('U', 'Unground (Standard for RTD)')]),
    },
    defaults: { sensor: 'K', fl: '1.5', d1: '6', d2: '6', mat: '', l1: '100', l2: '20', elem: '', hd: '', ground: '' },
  },
];

export const tsSpec = (f: string): TsFamilySpec | undefined => TS_CATALOG.find((s) => s.family === f);

/** ตัวเลือกของช่องนี้ ตามค่าที่กรอกอยู่ (ช่อง Sensor ขึ้นกับชนิดหัววัด) */
export function slotOptions(slot: TsSlot, values: Record<string, string>): CatalogOption[] {
  if (slot.optionsByProbe) return slot.optionsByProbe[values.probe ?? 'TS'] ?? [];
  return slot.options ?? [];
}

// ── ประกอบรหัส ─────────────────────────────────────────────────────────────────

/** ช่องตัวเลขที่ว่าง → ค่ามาตรฐานของแคตตาล็อก (ช่องที่เว้นได้ = ไม่เขียนลงรหัส) */
function numOf(spec: TsFamilySpec, v: Record<string, string>, key: string): string {
  const raw = (v[key] ?? '').trim();
  if (raw) return raw;
  const slot = spec.slots[key];
  return slot?.optional ? '' : slot?.placeholder ?? '';
}

/** หัวรหัส — `TS` + ชนิด Sensor · NTC/PTC = `N10` / `P2` (แคตตาล็อก "N_-04/P_-04") */
function headOf(v: Record<string, string>): string {
  const probe = v.probe ?? 'TS';
  return `${probe}${v.sensor ?? ''}`;
}

/**
 * ช่องที่กรอก → รหัสสินค้า — ตัวคั่นตามแบบที่รหัสจริงเขียนมากที่สุด (วัด 2026-09-28):
 * `-2-BU` 467 รหัส เทียบ `-2BU` 14 · TS_-11 `+5M-PU` 2,651 เทียบ `+5MPU` 89 · TS_-14 `-2BU` ตามแคตตาล็อก ·
 * ไม่มีวงเล็บเกลียว (TS_-01 · 14) / TS_-11 · 12 = เว้นวรรคหลังเลขรุ่นแบบรหัสจริง · ท่อน None ไม่เขียนอะไรลงรหัส
 */
export function buildTsCode(form: TsForm): string {
  const spec = tsSpec(form.family);
  if (!spec) return '';
  const v = form.values;
  const n = (k: string) => numOf(spec, v, k);
  const s = (k: string) => v[k] ?? '';
  const elem = s('elem') ? `-${s('elem')}` : '';
  const headGround = s('hd') || s('ground') ? `-${s('hd')}${s('ground')}` : '';
  const cable = `+${n('cl')}M${s('cable')}${s('ground')}`;
  let code = '';
  switch (spec.family) {
    case 'TS_-01': {
      const l1 = n('l1');
      code = `TS${s('sensor')}-01${s('thread') ? `(${s('thread')})` : ' '}${s('d')}${s('mat')}${l1 ? `x${l1}` : ''}${cable}`;
      break;
    }
    case 'TS_-01-0':
      code = `TS${s('sensor')}-01-0${s('hold') ? `(${s('hold')})` : ''}${cable}`;
      break;
    case 'TS_-04':
      code = `${headOf(v)}-04(${s('thread')})${s('d')}${s('mat')}x${n('l1')}${elem}${cable}`;
      break;
    case 'TS_-06':
      code = `${headOf(v)}-06(${s('thread')})${s('d')}${s('mat')}x${n('l1')}${elem}${headGround}`;
      break;
    case 'TS_-08':
      code = `TS${s('sensor')}-08(${s('thread')})${s('d')}${s('mat')}x${n('l1')}${elem}${headGround}`;
      break;
    case 'TS_-10':
      code = `TS${s('sensor')}-10(${s('thread')})${s('d')}${s('mat')}x${n('l1')}${elem}${cable}`;
      break;
    case 'TS_-11': {
      const tail = s('cable') || s('ground') ? `-${s('cable')}${s('ground')}` : '';
      code = `${headOf(v)}-11${s('spring')} ${s('d')}${s('mat')}x${n('l1')}${elem}+${n('cl')}M${tail}`;
      break;
    }
    case 'TS_-12':
      code = `TS${s('sensor')}-12 ${s('d')}x${n('l1')}${cable}`;
      break;
    case 'TS_-12R':
      code = `TS${s('sensor')}-12 ${s('d')}${s('mat')}x${n('l1')}${elem}${cable}`;
      break;
    case 'TS_-14': {
      const l2 = n('l2');
      const tail = s('elem') || s('hd') || s('ground') ? `-${s('elem')}${s('hd')}${s('ground')}` : '';
      code = `TS${s('sensor')}-14${s('thread') ? `(${s('thread')})` : ' '}${s('d')}x${n('l1')}${l2 ? `+${l2}` : ''}${tail}`;
      break;
    }
    case 'TS_-18': {
      const l2 = n('l2');
      code = `TS${s('sensor')}-18(${s('fl')})${s('d1')}-${s('d2')}${s('mat')}x${n('l1')}${l2 ? `+${l2}` : ''}${elem}${headGround}`;
      break;
    }
  }
  return code + (form.extras ?? []).map((e) => `-${e}`).join('');
}

// ── อ่านรหัสกลับเป็นช่อง ─────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/**
 * ตัวเลือกของช่องเป็น regex — ยาวก่อนสั้น (`PA` ก่อน `P` · `6.35` ก่อน `6`) · ตัวว่างไม่อยู่ในรายการ (ช่องทั้งช่องเป็น optional เอง)
 * เป็นตัวพิมพ์ใหญ่เพราะรหัสถูกทำเป็นตัวพิมพ์ใหญ่ก่อนเทียบ (`M8x1.25` → `M8X1.25`) — `readTsForm` แปลงกลับเป็นรหัสในรายการ
 */
function alt(options: CatalogOption[]): string {
  return [...new Set(options.map((x) => x.code.toUpperCase()).filter(Boolean))].sort((a, b) => b.length - a.length).map(esc).join('|');
}
const NUM = '\\d+(?:\\.\\d+)?';

/**
 * ไวยากรณ์ของแต่ละตาราง — ตรวจกับรหัสที่ **ตัดช่องว่างและทำเป็นตัวพิมพ์ใหญ่แล้ว** · ผลต้องผ่านการประกอบกลับอีกชั้น
 * ⇒ regex ตรงนี้หลวมได้ (มีไว้แยกท่อน) ความถูกต้องตัดสินที่ "ประกอบกลับได้รหัสเดิม"
 */
function grammar(spec: TsFamilySpec): RegExp {
  const S = spec.slots;
  const g = (name: string, slot: string, optional = true) => `(?<${name}>${alt(S[slot]!.options ?? [])})${optional ? '?' : ''}`;
  const sensorAll = () => alt([...(S.sensor!.optionsByProbe?.TS ?? S.sensor!.options ?? []), ...(S.sensor!.optionsByProbe?.N ?? [])]);
  const head = S.probe ? `(?<probe>${alt(S.probe.options ?? [])})(?<sensor>${sensorAll()})` : `TS(?<sensor>${sensorAll()})`;
  // ท่อนนอกแคตตาล็อกต่อท้าย = รหัสงานสั่งทำ (`S000` · `TM000` — ตัวอักษรตามด้วยตัวเลข) เท่านั้น — ท่อนอื่นอย่าง `-2B`
  // (2 Element + หัว B เขียนติดกัน) ไม่ใช่ "นอกแคตตาล็อก" แต่เป็นรหัสที่เขียนนอกรูปแบบ ⇒ ไม่ได้ช่อง ไม่งั้นช่องว่างแต่ราคามีของ
  const extras = '(?<extras>(?:-[A-Z]+\\d+)*)';
  // ท่อนที่บางตารางไม่มี — ประกอบเมื่อถูกใช้เท่านั้น (ตารางที่ไม่มีช่องสายก็ไม่มีตัวเลือกสายให้อ่าน)
  const cable = () => `\\+(?<cl>${NUM})M${g('cable', 'cable')}${g('ground', 'ground')}`;
  const elem = `(?:-(?<elem>2))?`;
  const hd = () => `(?:-(?=[A-Z])${g('hd', 'hd')}${g('ground', 'ground')})?`;
  const dm = (dSlot = 'd') => `${g(dSlot, dSlot, false)}${S.mat ? g('mat', 'mat') : ''}`;
  let body = '';
  switch (spec.family) {
    case 'TS_-01': body = `${head}-01(?:\\(${g('thread', 'thread', false)}\\))?${dm()}(?:X(?<l1>${NUM}))?${cable()}`; break;
    case 'TS_-01-0': body = `${head}-01-0(?:\\(${g('hold', 'hold', false)}\\))?${cable()}`; break;
    case 'TS_-04': body = `${head}-04\\(${g('thread', 'thread', false)}\\)${dm()}X(?<l1>${NUM})${elem}${cable()}`; break;
    case 'TS_-06': body = `${head}-06\\(${g('thread', 'thread', false)}\\)${dm()}X(?<l1>${NUM})${elem}${hd()}`; break;
    case 'TS_-08': body = `${head}-08\\(${g('thread', 'thread', false)}\\)${dm()}X(?<l1>${NUM})${elem}${hd()}`; break;
    case 'TS_-10': body = `${head}-10\\(${g('thread', 'thread', false)}\\)${dm()}X(?<l1>${NUM})${elem}${cable()}`; break;
    case 'TS_-11': body = `${head}-11(?<spring>P)?${dm()}X(?<l1>${NUM})${elem}\\+(?<cl>${NUM})M(?:-(?=[A-Z])${g('cable', 'cable')}${g('ground', 'ground')})?`; break;
    case 'TS_-12': body = `${head}-12${dm()}X(?<l1>${NUM})${cable()}`; break;
    case 'TS_-12R': body = `${head}-12${dm()}X(?<l1>${NUM})${elem}${cable()}`; break;
    case 'TS_-14': body = `${head}-14(?:\\(${g('thread', 'thread', false)}\\))?${dm()}X(?<l1>${NUM})(?:\\+(?<l2>${NUM}))?(?:-(?=[A-Z0-9])(?<elem>2)?${g('hd', 'hd')}${g('ground', 'ground')})?`; break;
    case 'TS_-18': body = `${head}-18\\(${g('fl', 'fl', false)}\\)${g('d1', 'd1', false)}-${dm('d2')}X(?<l1>${NUM})(?:\\+(?<l2>${NUM}))?${elem}${hd()}`; break;
  }
  return new RegExp(`^${body}${extras}$`);
}

const GRAMMARS = new Map(TS_CATALOG.map((s) => [s.family, grammar(s)]));

/** รหัสสองตัวเป็นรหัสเดียวกันไหม **ตามที่คนอ่าน** — ไม่สนช่องว่างและตัวพิมพ์ (`x` = `X`) */
export function sameTsCode(a: string, b: string): boolean {
  const canon = (s: string) => s.toUpperCase().replace(/\s+/g, '').replace(/[”“″"]/g, '');
  return canon(a) === canon(b);
}

/**
 * รหัส → ช่องตามแคตตาล็อก ของตาราง `family` — `undefined` เมื่อรหัสเขียนนอกรูปแบบ หรือประกอบกลับแล้วไม่ได้รหัสเดิม
 * (เช่น `-2B` ที่ติดกัน · สายเป็น cm · ขนาดแกนนอกรายการ) ⇒ หน้าจอแสดงแบบเดิม ไม่ใช่ช่องที่แก้แล้วรหัสเพี้ยน
 */
export function readTsForm(input: string, family: TsFamily): TsForm | undefined {
  const spec = tsSpec(family);
  const re = GRAMMARS.get(family);
  if (!spec || !re) return undefined;
  const m = input.toUpperCase().replace(/\s+/g, '').match(re);
  if (!m?.groups) return undefined;
  const values: Record<string, string> = {};
  for (const key of Object.keys(spec.slots)) values[key] = m.groups[key] ?? '';
  if (!spec.slots.probe) delete values.probe;
  // ค่าที่อ่านได้เป็นตัวพิมพ์ใหญ่ (`M8X1.25`) → รหัสตามรายการ (`M8x1.25`) ไม่งั้นช่องเลือกบนจอหาตัวเลือกไม่เจอ · ชนิดหัววัดก่อน Sensor
  for (const key of ['probe', ...Object.keys(spec.slots).filter((k) => k !== 'probe')]) {
    const slot = spec.slots[key];
    if (slot?.kind !== 'choice' || !values[key]) continue;
    const hit = slotOptions(slot, values).find((x) => x.code.toUpperCase() === values[key]!.toUpperCase());
    if (hit) values[key] = hit.code;
  }
  // หัว NTC/PTC ต้องคู่กับ 2/10 · หัว TS ต้องคู่กับ K J T … (regex รวมทั้งสองชุดไว้ในกลุ่มเดียว)
  const sensorOk = spec.slots.sensor ? slotOptions(spec.slots.sensor, values).some((x) => x.code === values.sensor) : true;
  if (!sensorOk) return undefined;
  // ตัวเลขเก็บตามที่พิมพ์ — ตัวพิมพ์เล็กของหน่วยไม่มีในช่องตัวเลข
  const extras = (m.groups.extras ?? '').split('-').filter(Boolean);
  const form: TsForm = { family, values, ...(extras.length ? { extras } : {}) };
  return sameTsCode(buildTsCode(form), input) ? form : undefined;
}

/** ตารางของแคตตาล็อกที่รุ่นในสมุดราคานี้ใช้ — TS_-12 แยกตามชนิด Sensor (Thermocouple / RTD คนละหน้า) */
export function tsFamilyOfModel(modelCode: string): TsFamily | undefined {
  return TS_CATALOG.find((s) => s.model === modelCode)?.family;
}
