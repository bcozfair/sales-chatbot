// ─────────────────────────────────────────────────────────────────────────────
//  ตารางรายละเอียดสินค้า + หมายเหตุของแบบ ต่อตระกูล (แผน §2.6 A5 · A6) — ข้อความล้วนจาก spec
//
//  **ตารางพอร์ตจาก `specRows(v)` ของ Appsale ที่ `4dd2475`** (`products/ts-11.js` · `ts-01.js` · `ts-03.js` · `bh-01.js` · คำจาก `ts-common.js`)
//  ⇒ ภาษาไทยต้องเท่าต้นฉบับทุกตัวอักษรหลังถอด entity — ด่าน `diag:drawing-port` ส่วน ง เทียบให้ทุกรหัส
//  ต่างจากต้นฉบับโดยตั้งใจ 2 ข้อ: (1) ค่าที่ผลอ่านรหัสไม่ได้บอก (`null`) ขึ้น `-` — Appsale ไม่มีค่าว่างเพราะเติมค่าเริ่มต้นเอง
//  (2) BH-01C ที่รหัสไม่บอกการต่อ (`conn: ''`) ขึ้น "ไม่ระบุ" — Appsale เติม `PL` เอง (ข้อเดียวกับส่วน ค ของด่าน)
//  (3) แถว "รุ่น" ของ TS_-01-0/02/03/05 = ชื่อรุ่นล้วน (`TSK-03`) — ต้นฉบับตัดจากรหัสเต็มที่ `(`/`X` แรก จึงติดขนาดแกนมาด้วย
//      (`TSK-03-6`) หรือติดสายทั้งท่อนเมื่อไม่มีวงเล็บ (`TSK-01-0+2MP`) · ด่านส่วน ง ตัดของต้นฉบับให้เหลือชื่อรุ่นก่อนเทียบ
//  (4) TS_-05 ที่เป็น RTD (TSP/TSPA/TSZ — หน้าคำนวณราคามี แต่หน้า 8 ของ Appsale ไม่มี) ใช้ชื่อ/ย่านของ RTD · ต้นฉบับถอยไปเป็น Type K
//  · ใช้ตัวอักษรจริง (∅ × ° ² ±) ไม่ใช่ HTML entity — คนเรียกเป็นคน escape ตามพื้นผิวของตัวเอง (React · SVG · PDF)
//
//  **หมายเหตุของแบบ = ภาษาช่าง/ภายใน เห็นเฉพาะการ์ดแอดมิน** (เจ้าของเคาะ mockup รอบ 5 ข้อ 2 · 2026-10-09) —
//  ไม่ลงกระดาษแบบ/หน้าลูกค้า (กระดาษมีบรรทัด "ไม่ใช่แบบผลิต" อยู่แล้ว) ⇒ มีภาษาไทยภาษาเดียว
//  ข้อความตาม mockup รอบ 5 (ย่อจาก `sheetNote` ของ Appsale) + ค่าที่ Appsale เลือกเองซึ่งไม่ได้อยู่ในแคตตาล็อก (README "ตำแหน่งขั้วไฟ")
//
//  คำภาษาอังกฤษเป็นร่าง รอฝ่ายขายตรวจก่อนเฟส 2 (§5.4 ข้อ 8) · คำชนิดสาย/วัสดุซ้ำกับฝั่งคิดราคาโดยตั้งใจ (คำบนกระดาษ ไม่ใช่ตรรกะ ·
//  โมดูลนี้ห้าม import pricingLab)
// ─────────────────────────────────────────────────────────────────────────────

import type { BandSpec, DrawingSpec, Ts11Spec, TsCable, TsCableSpec } from './types.js';
import { springLength } from './families/ts-11.js';
import { CABLE_LEADS, THREADS_01, tsCableBuild } from './families/tsCable.js';
import { HOLDS } from './families/tsParts.js';

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

// ── TS_-01 · TS_-01-0 · TS_-02 · TS_-03 · TS_-05 ────────────────────────────

/** `SENSORS_TC/RTD/TCNP` (`ts-common.js`) — ชื่อ + ย่านการวัด · NTC/PTC ของหน้าเหล่านี้ "แคตตาล็อกไม่ระบุ" (ต่างจาก TS_-11) */
const UNSTATED: Text2 = { th: 'แคตตาล็อกไม่ระบุ', en: 'Not stated in catalog' };
const CABLE_SENSOR: Record<TsCableSpec['sensor'], { label: string; range: Text2 }> = {
  K: { label: 'Thermocouple Type K', range: TC_RANGE }, J: { label: 'Thermocouple Type J', range: TC_RANGE },
  T: { label: 'Thermocouple Type T', range: TC_RANGE }, P: { label: 'PT100 Class B', range: RTD_RANGE },
  PA: { label: 'PT100 Class A', range: RTD_RANGE }, Z: { label: 'PT1000 Class B', range: RTD_RANGE },
  TSK: { label: 'Thermocouple Type K', range: TC_RANGE }, TSJ: { label: 'Thermocouple Type J', range: TC_RANGE },
  TST: { label: 'Thermocouple Type T', range: TC_RANGE },
  P2: { label: 'PTC 2K', range: UNSTATED }, P10: { label: 'PTC 10K', range: UNSTATED },
  N2: { label: 'NTC 2K', range: UNSTATED }, N10: { label: 'NTC 10K', range: UNSTATED },
  TSP: { label: 'PT100 Class B', range: RTD_RANGE }, TSPA: { label: 'PT100 Class A', range: RTD_RANGE },
  TSZ: { label: 'PT1000 Class B', range: RTD_RANGE },
};
/** `MATERIALS_TS` ที่ห้ารุ่นนี้ใช้ */
const CABLE_MAT: Record<'NONE' | 'A' | 'S' | 'T' | 'AT', Text2> = {
  NONE: TS_MAT.NONE, A: TS_MAT.A, T: TS_MAT.T, AT: TS_MAT.AT,
  S: { th: 'Shealth 316 (เฉพาะ Thermocouple)', en: 'Sheath 316 (Thermocouple only)' },
};
/** `CABLES` (`ts-common.js`) ทั้งชุด */
const CABLE_TYPE: Record<TsCable, Text2> = {
  ...TS_CABLE,
  C: { th: 'ซิลิโคน (0-105 °C)', en: 'Silicone (0-105 °C)' },
  F: { th: 'ไฟเบอร์กลาส (0-350 °C)', en: 'Fiberglass (0-350 °C)' },
};
const CABLE_HEAD: Record<string, Text2> = {
  ...TS11_HEAD,
  thread: { th: 'เกลียว', en: 'Thread' },
  hold: { th: 'Hold size (ID1)', en: 'Hold size (ID1)' },
  lock: { th: 'เขี้ยวล็อค (ID)', en: 'Bayonet lock (ID)' },
};
/** ชื่อรุ่นตามรหัส — หน้า 2–4 ขึ้นต้น "TS" + ชนิด · หน้า 6/8 ชนิดหัววัดอยู่ในชื่อเซนเซอร์แล้ว */
const CODE_OF: Record<TsCableSpec['family'], string> = { 'TS_-01': '01', 'TS_-01-0': '01-0', 'TS_-02': '02', 'TS_-03': '03', 'TS_-05': '05' };
const modelName = (s: TsCableSpec): string =>
  `${s.family === 'TS_-03' || s.family === 'TS_-05' ? s.sensor : `TS${s.sensor}`}-${CODE_OF[s.family]}`;

function tsCableRows(s: TsCableSpec, lang: SheetLang): SpecRow[] {
  const H = (k: string) => CABLE_HEAD[k][lang];
  const th = lang === 'th', sen = CABLE_SENSOR[s.sensor];
  const cable: SpecRow = [H('cable'), `${fmtOr(s.cableLen)} M. — ${CABLE_TYPE[s.cable][lang]}`];
  const probe = (dia: string, len: number) => (th ? `∅${dia} mm. × ยาว ${fmt(len)} mm.` : `∅${dia} mm. × L ${fmt(len)} mm.`);
  if (s.family === 'TS_-01') {
    const t = THREADS_01[s.thread];
    return [
      [H('model'), `${modelName(s)} — ${sen.label}`],
      [H('thread'), `${s.thread === 'NONE' ? '(None)' : s.thread} — ${t.label} (${th ? 'ยาว' : 'L'} ${t.len} mm.)`],
      [H('probe'), `${probe(s.dia, s.tubeLen)} · SUS 304`],
      cable,
      [H('ground'), s.ground === null ? '-' : s.ground === 'U'
        ? (th ? 'Unground (มาตรฐานของ RTD)' : 'Unground (RTD standard)')
        : (th ? 'Ground (มาตรฐานของ Thermocouple)' : 'Ground (Thermocouple standard)')],
      [H('range'), sen.range[lang]],
      [H('spring'), th ? '100 mm. (มาตรฐาน)' : '100 mm. (standard)'],
    ];
  }
  const rows: SpecRow[] = [[H('model'), `${modelName(s)} — ${sen.label}`]];
  if (s.family === 'TS_-01-0') {
    const h = HOLDS[s.hold];
    rows.push([H('hold'), `${h.label} × ${th ? 'ยาว' : 'L'} ${fmt(h.len)} mm.`]);
  }
  if (s.family === 'TS_-02' || s.family === 'TS_-05') rows.push([H('lock'), `${fmt(Number(s.lock))} mm.`]);
  if (s.family !== 'TS_-01-0') {
    rows.push([H('probe'), probe(s.dia, s.tubeLen)]);
    rows.push([H('mat'), s.mat === null ? '-' : CABLE_MAT[s.mat][lang]]);
  }
  if (s.family === 'TS_-03' || s.family === 'TS_-05') rows.push([H('elem'), s.elem === null ? '-' : TS_ELEM[s.elem]]);
  rows.push([H('spring'), `${fmt(tsCableBuild(s).springLen)} mm.`]);
  rows.push(cable);
  rows.push([H('ground'), s.ground === null ? '-' : s.ground === 'U' ? 'U — Unground' : 'Ground']);
  rows.push([H('range'), sen.range[lang]]);
  return rows;
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
    case 'TS_-01':
    case 'TS_-01-0':
    case 'TS_-02':
    case 'TS_-03':
    case 'TS_-05': return tsCableRows(spec, lang);
  }
}

// ── หมายเหตุของแบบ (ภายใน) ──────────────────────────────────────────────────

const TS_TAIL = 'หางปลาแฉกมาตรฐาน (1.5) และท้ายสายตามไฟล์ CAD ของผู้ผลิต · สปริงลวด ∅0.7 พันชิดบนสายเป็นรูปอ้างอิง · สายวาดย่อ ไม่ใช่มาตราส่วนจริง';
const TS_TAIL_SHORT = 'สายวาดย่อ ไม่ใช่มาตราส่วนจริง';
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
    // `sheetNote` ของ Appsale ต่อรุ่น (`ts-01.js` · `ts-03.js`)
    case 'TS_-01':
      return 'หัวเซ็นเซอร์และเกลียวเป็น SUS 304 · เกลียวหมุนปรับได้ · Tube Length = ปลายแกนที่ยื่นพ้นเกลียว (None = 5 mm.) · รูปทรงหกเหลี่ยม สปริง และหางปลาตามไฟล์ CAD ของผู้ผลิต (ขนาดหกเหลี่ยมของเกลียวอื่นขยายตามสัดส่วน) · ' + TS_TAIL_SHORT;
    case 'TS_-01-0':
      return 'หูแหวนยึดด้วยรู ID1 ตามตาราง Hold size · ช่อง Length ในแคตตาล็อกตีความเป็นความยาวหูทั้งชิ้น · รูปทรงหูแหวน สปริง 100 mm. และหางปลาแฉกตามไฟล์ CAD ของผู้ผลิต · ' + TS_TAIL_SHORT;
    case 'TS_-02':
      return 'สปริงคลุมแกน 300 mm. ตามแคตตาล็อก · รูปทรงเขี้ยวล็อค (ร่องตัว J + วงจับลายเฟือง) สปริง และหางปลาแฉกตามไฟล์ CAD ของผู้ผลิต · ID อื่นขยายตามสัดส่วน · ' + TS_TAIL_SHORT;
    case 'TS_-03':
      return 'สปริงกันสายหัก 50 mm. เมื่อแกนเล็กกว่า 5 mm. และ 130 mm. ตั้งแต่ 5 mm. ขึ้นไป · แกน 4-10 mm. แถมหน้าแปลนปีกนก (ไม่ได้วาดในแบบ) · รูปทรง Sleeve สปริง และหางปลาแฉกตามไฟล์ CAD ของผู้ผลิต (แกน ∅5) · ' + TS_TAIL_SHORT;
    case 'TS_-05':
      return `สปริงกันสายหัก 100 mm. ทุกขนาดแกน · ระยะจากเขี้ยวล็อคถึง Sleeve 50 mm. ตามแบบในแคตตาล็อก · รูปทรงเขี้ยวล็อค Sleeve สปริง และหางปลาแฉกตามไฟล์ CAD ของผู้ผลิต · ${CABLE_LEADS[spec.sensor] === 3 ? 'RTD (3 สาย) ไม่อยู่ในแคตตาล็อกหน้านี้ — ใช้ตามมาตรฐาน Type for RTD · ' : ''}${TS_TAIL_SHORT}`;
  }
}
