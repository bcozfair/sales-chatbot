// ─────────────────────────────────────────────────────────────────────────────
//  ตารางรายละเอียดสินค้า + หมายเหตุของแบบ ต่อตระกูล (แผน §2.6 A5 · A6) — ข้อความล้วนจาก spec
//
//  **ตารางพอร์ตจาก `specRows(v)` ของ Appsale ที่ `4dd2475`** (`products/ts-11.js` · `products/bh-01.js` · คำจาก `ts-common.js`)
//  ⇒ ภาษาไทยต้องเท่าต้นฉบับทุกตัวอักษรหลังถอด entity — ด่าน `diag:drawing-port` ส่วน ง เทียบให้ทุกรหัส
//  ต่างจากต้นฉบับโดยตั้งใจ 2 ข้อ: (1) ค่าที่ผลอ่านรหัสไม่ได้บอก (`null`) ขึ้น `-` — Appsale ไม่มีค่าว่างเพราะเติมค่าเริ่มต้นเอง
//  (2) BH-01C ที่รหัสไม่บอกการต่อ (`conn: ''`) ขึ้น "ไม่ระบุ" — Appsale เติม `PL` เอง (ข้อเดียวกับส่วน ค ของด่าน)
//  · ใช้ตัวอักษรจริง (∅ × ° ² ±) ไม่ใช่ HTML entity — คนเรียกเป็นคน escape ตามพื้นผิวของตัวเอง (React · SVG · PDF)
//
//  **หมายเหตุของแบบ = ภาษาช่าง/ภายใน เห็นเฉพาะการ์ดแอดมิน** (เจ้าของเคาะ mockup รอบ 5 ข้อ 2 · 2026-10-09) —
//  ไม่ลงกระดาษแบบ/หน้าลูกค้า (กระดาษมีบรรทัด "ไม่ใช่แบบผลิต" อยู่แล้ว) ⇒ มีภาษาไทยภาษาเดียว
//  ข้อความตาม mockup รอบ 5 (ย่อจาก `sheetNote` ของ Appsale) + ค่าที่ Appsale เลือกเองซึ่งไม่ได้อยู่ในแคตตาล็อก (README "ตำแหน่งขั้วไฟ")
//
//  คำภาษาอังกฤษเป็นร่าง รอฝ่ายขายตรวจก่อนเฟส 2 (§5.4 ข้อ 8) · คำชนิดสาย/วัสดุซ้ำกับฝั่งคิดราคาโดยตั้งใจ (คำบนกระดาษ ไม่ใช่ตรรกะ ·
//  โมดูลนี้ห้าม import pricingLab)
// ─────────────────────────────────────────────────────────────────────────────

import type { BandSpec, DrawingSpec, Ts11Spec } from './types.js';
import { springLength } from './families/ts-11.js';

export type SheetLang = 'th' | 'en';
/** หนึ่งแถวของตาราง: [หัวข้อ, ค่า] */
export type SpecRow = [string, string];
interface Text2 { th: string; en: string }

/** `fmt()` ของ Appsale (`engine/draw.js`) — ปัด 2 ตำแหน่ง ไม่เติมศูนย์ */
const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();
const fmtOr = (n: number | null): string => (n === null ? '-' : fmt(n));

// ── TS_-11 ──────────────────────────────────────────────────────────────────

const TC_RANGE: Text2 = { th: '0-350 °C (ขึ้นกับชนิดสาย)', en: '0-350 °C (depends on cable)' };
const RTD_RANGE: Text2 = { th: '-200 ถึง 400 °C', en: '-200 to 400 °C' };
const NTC_PTC_RANGE: Text2 = { th: '-30 ถึง 130 °C', en: '-30 to 130 °C' };
/** `SENSORS_11` ของ Appsale (`ts-11.js`) — ชื่อ + ย่านการวัด */
const TS11_SENSOR: Record<Ts11Spec['sensor'], { label: string; range: Text2 }> = {
  TSK: { label: 'Thermocouple Type K', range: TC_RANGE },
  TSJ: { label: 'Thermocouple Type J', range: TC_RANGE },
  TST: { label: 'Thermocouple Type T', range: TC_RANGE },
  TSP: { label: 'PT100 Class B', range: RTD_RANGE },
  TSPA: { label: 'PT100 Class A', range: RTD_RANGE },
  TSZ: { label: 'PT1000 Class B', range: RTD_RANGE },
  N2: { label: 'NTC 2K', range: NTC_PTC_RANGE },
  N10: { label: 'NTC 10K', range: NTC_PTC_RANGE },
  P2: { label: 'PTC 2K', range: NTC_PTC_RANGE },
  P10: { label: 'PTC 10K', range: NTC_PTC_RANGE },
};
/** `MATERIALS_TS` (`ts-common.js`) เฉพาะที่ TS_-11 ของหน้าคำนวณราคามี */
const TS_MAT: Record<NonNullable<Ts11Spec['mat']>, Text2> = {
  NONE: { th: 'SUS 304', en: 'SUS 304' },
  A: { th: 'SUS 316L', en: 'SUS 316L' },
  T: { th: 'SUS 304 เคลือบเทปล่อน', en: 'SUS 304, PTFE coated' },
  TN: { th: 'Titanium', en: 'Titanium' },
  AT: { th: 'SUS 316 เคลือบเทปล่อน', en: 'SUS 316, PTFE coated' },
};
/** `ELEMENTS` (`ts-common.js`) */
const TS_ELEM: Record<NonNullable<Ts11Spec['elem']>, string> = { NONE: '1 Element', 2: '2 Element' };
/** `CABLES` (`ts-common.js`) เฉพาะที่ TS_-11 มี */
const TS_CABLE: Record<Ts11Spec['cable'], Text2> = {
  NONE: { th: 'สแตนเลสถัก (0-350 °C)', en: 'SS braided (0-350 °C)' },
  P: { th: 'พีวีซี (0-105 °C)', en: 'PVC (0-105 °C)' },
  T: { th: 'เทปล่อน (0-250 °C)', en: 'PTFE (0-250 °C)' },
  TS: { th: 'เทปล่อนหุ้มชีลด์ (0-250 °C)', en: 'Shielded PTFE (0-250 °C)' },
};

const TS11_HEAD: Record<string, Text2> = {
  model: { th: 'รุ่น', en: 'Model' },
  probe: { th: 'แกนวัด', en: 'Probe' },
  mat: { th: 'วัสดุแกน', en: 'Sheath material' },
  elem: { th: 'จำนวน Element', en: 'Elements' },
  spring: { th: 'สปริงกันสายหัก', en: 'Strain relief spring' },
  cable: { th: 'สาย', en: 'Cable' },
  ground: { th: 'Ground', en: 'Ground' },
  range: { th: 'ย่านการวัด', en: 'Range' },
};

function ts11Rows(s: Ts11Spec, lang: SheetLang): SpecRow[] {
  const H = (k: string) => TS11_HEAD[k][lang];
  const sen = TS11_SENSOR[s.sensor], springLen = springLength(s);
  return [
    [H('model'), `TS_-11 — ${sen.label}`],
    [H('probe'), lang === 'th' ? `∅${s.dia} mm. × ยาว ${fmt(s.tubeLen)} mm.` : `∅${s.dia} mm. × L ${fmt(s.tubeLen)} mm.`],
    [H('mat'), s.mat === null ? '-' : TS_MAT[s.mat][lang]],
    [H('elem'), s.elem === null ? '-' : TS_ELEM[s.elem]],
    [H('spring'), springLen ? `${fmt(springLen)} mm.` : lang === 'th' ? 'ไม่มี (None Spring)' : 'None (None Spring)'],
    [H('cable'), `${fmtOr(s.cableLen)} M. — ${TS_CABLE[s.cable][lang]}`],
    [H('ground'), s.ground === null ? '-' : s.ground === 'U' ? 'U — Unground' : 'Ground'],
    [H('range'), sen.range[lang]],
  ];
}

// ── BH-01 / BH-01C ──────────────────────────────────────────────────────────

/** `SPECS` ของ `bh-01.js` — ค่าตามแคตตาล็อก BH-01 */
const BH_SPECS = { maxWattDensity: 5, maxTemp: 450, resistanceTolerance: 5, thicknessDefault: 4 };
/** `TERMS[].label` ของ `bh-01.js` */
const BH_TERM: Record<BandSpec['term'], Text2> = {
  NONE: { th: 'ออกสาย 30 cm.', en: 'Lead wire 30 cm.' },
  1: { th: 'ออกสาย 1 M.', en: 'Lead wire 1 M.' },
  2: { th: 'ออกสาย 2 M.', en: 'Lead wire 2 M.' },
  3: { th: 'ออกสาย 3 M.', en: 'Lead wire 3 M.' },
  N: { th: 'ขั้วน็อต', en: 'Screw terminal' },
  PL2: { th: 'ปลั๊ก PL-2', en: 'Plug PL-2' },
  PL5: { th: 'ปลั๊ก PL-5', en: 'Plug PL-5' },
  T: { th: 'เต๋าเซรามิก', en: 'Ceramic terminal block' },
};
const BH_HEAD: Record<string, Text2> = {
  model: { th: 'รุ่น', en: 'Model' },
  size: { th: 'ขนาด', en: 'Size' },
  elec: { th: 'ไฟฟ้า', en: 'Electrical' },
  wd: { th: 'Watt Density', en: 'Watt density' },
  term: { th: 'การออกขั้วไฟ', en: 'Termination' },
  mat: { th: 'วัสดุ', en: 'Material' },
  conn: { th: 'การต่อใช้งาน', en: 'Connection' },
  holes: { th: 'รูเจาะ', en: 'Holes' },
  temp: { th: 'อุณหภูมิใช้งาน', en: 'Max. temperature' },
  tol: { th: 'ค่าความคลาดเคลื่อนความต้านทาน', en: 'Resistance tolerance' },
};

function bandRows(s: BandSpec, lang: SheetLang): SpecRow[] {
  const H = (k: string) => BH_HEAD[k][lang];
  const th = lang === 'th', split = s.family === 'BH-01C';
  const t = s.t > 0 ? s.t : BH_SPECS.thicknessDefault;
  const areaCm2 = Math.PI * s.id * s.h / 100;
  const wd = s.w !== null && s.w > 0 && areaCm2 > 0 ? (s.w / areaCm2).toFixed(2) : '-';
  const amp = s.w !== null && s.w > 0 && s.v ? (s.w / Number(s.v)).toFixed(2) : '-';
  const rows: SpecRow[] = [
    [H('model'), `${s.family} — ${split ? '2 Piece Band Heater' : 'Band Heater'}`],
    [H('size'), `∅ID ${fmt(s.id)} × H ${fmt(s.h)} × T ${fmt(t)} mm.`],
    [H('elec'), `${fmtOr(s.w)} W / ${s.v ?? '-'} VAC (${amp} A)`],
    [H('wd'), `${wd} W/cm² (${th ? 'สูงสุด' : 'max.'} ${BH_SPECS.maxWattDensity})`],
    [H('term'), BH_TERM[s.term][lang]],
    [H('mat'), s.mat === 'Z' ? (th ? 'Zinc (สังกะสี)' : 'Zinc') : 'SUS304'],
  ];
  if (split) {
    rows.push([H('conn'), s.conn === 'SE' ? (th ? 'SE — อนุกรม' : 'SE — Series')
      : s.conn === 'PL' ? (th ? 'PL — ขนาน' : 'PL — Parallel')
      : th ? 'ไม่ระบุ' : 'Not specified']);
  }
  const hs = s.holes.filter((h) => h.d > 0);
  if (hs.length) {
    rows.push([H('holes'), hs.map((h) => (th
      ? `∅${fmt(h.d)} (รอบวง ${fmt(h.x)} / แนว H ${fmt(h.y)})`
      : `∅${fmt(h.d)} (around ${fmt(h.x)} / along H ${fmt(h.y)})`)).join('   ')]);
  }
  rows.push([H('temp'), `${th ? 'สูงสุด' : 'max.'} ${BH_SPECS.maxTemp} °C`]);
  rows.push([H('tol'), `± ${BH_SPECS.resistanceTolerance}%`]);
  return rows;
}

/** ตารางรายละเอียดสินค้าของ spec — ใช้ทั้งการ์ด กระดาษแบบ และหน้าลูกค้า */
export function specRows(spec: DrawingSpec, lang: SheetLang = 'th'): SpecRow[] {
  switch (spec.family) {
    case 'TS_-11': return ts11Rows(spec, lang);
    case 'BH-01':
    case 'BH-01C': return bandRows(spec, lang);
  }
}

// ── หมายเหตุของแบบ (ภายใน) ──────────────────────────────────────────────────

const TS_TAIL = 'หางปลาแฉกมาตรฐาน (1.5) และท้ายสายตามไฟล์ CAD ของผู้ผลิต · สปริงลวด ∅0.7 พันชิดบนสายเป็นรูปอ้างอิง · สายวาดย่อ ไม่ใช่มาตราส่วนจริง';
const BH_NOTE = 'รูปทรงอ้างอิงจากแคตตาล็อก · ID/H/T ตามค่าที่ระบุ · ชุดรัดและขั้วไฟเป็นรูปทรงประมาณ สายแสดงย่อ · ความหนามาตรฐาน 4 mm. อุณหภูมิใช้งานสูงสุด 450°C กำลังไฟไม่เกิน 5 W/cm² ตามแคตตาล็อก Primus · ถ้ามีเจาะรูต้องระบุขนาดและตำแหน่งให้ฝ่ายผลิต';

/** หมายเหตุของแบบ — เห็นเฉพาะการ์ดแอดมิน (ไม่ลงกระดาษแบบ/หน้าลูกค้า) */
export function sheetNote(spec: DrawingSpec): string {
  switch (spec.family) {
    case 'TS_-11':
      return `สปริงกันสายหัก 50 mm. เมื่อแกนเล็กกว่า 5 mm. และ 130 mm. ตั้งแต่ 5 mm. ขึ้นไป · Spring P = ไม่มีสปริง · ${TS_TAIL}`;
    case 'BH-01':
      return spec.termPos === null ? `${BH_NOTE} · ตำแหน่งขั้วไฟ (152° จากรอยผ่า) เป็นรูปอ้างอิง รหัสสินค้าไม่ได้บอก` : BH_NOTE;
    case 'BH-01C':
      return spec.termPos === null ? `${BH_NOTE} · ตำแหน่งขั้วไฟ (กลางแนวแกน) เป็นรูปอ้างอิง รหัสสินค้าไม่ได้บอก` : BH_NOTE;
  }
}
