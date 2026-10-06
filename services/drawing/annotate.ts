// ─────────────────────────────────────────────────────────────────────────────
//  ป้ายชื่อชิ้น · ระยะแยกชิ้น · ป้ายขนาด ต่อตระกูล — ข้อมูลที่ตัวดู 3 มิติใช้ (แผน §4.7 · mockup รอบ 4 เจ้าของเคาะ 2026-10-06)
//
//  ตัวดูไม่รู้จักตระกูลเลย — รู้แค่ "ชิ้นชื่อแบบนี้อยู่กลุ่มไหน ป้ายว่าอะไร แยกไปทางไหน" ⇒ เพิ่มตระกูล = เพิ่มฟังก์ชันที่นี่ ไม่แตะตัวดู
//  · **ตัวเลขบนป้ายมาจาก spec** (ค่าเดียวกับที่คิดราคา) ไม่วัดจาก mesh — สายวาดย่อ แต่ป้ายบอกความยาวจริง
//  · ชิ้นที่ซ้ำกัน (สกรู ×4) รวมเป็นป้ายเดียว: ตัวดูนับจาก `count` (ส่วนในวงเล็บของ regex = เลขชิ้น)
//  · ป้ายตอนประกอบ (`asm`) มีเฉพาะชิ้นที่ภาพฉาย 2 มิติของแคตตาล็อกเขียนไว้ · ตอนแยกชิ้นทุกกลุ่มมีป้าย · ป้ายขนาดซ่อนตอนแยกชิ้น (ตัวดูทำ)
//
//  ทางที่ไม่ได้เลือก: ใส่ข้อมูลนี้ไว้ใน `extras` ของ GLB — ไฟล์ GLB ต้องนิ่งต่อรูปทรง (เก็บ/เทียบไบต์ได้) แต่ป้ายมีสองภาษาและอาจแก้คำบ่อย
//  ⇒ ส่งคู่กับ GLB เป็น JSON แยก (พอร์ตจาก mockup `SAMPLES` · คำแปลอังกฤษยังเป็นร่าง รอฝ่ายขายตรวจ §5.4 ข้อ 8)
// ─────────────────────────────────────────────────────────────────────────────

import type { BandSpec, DrawingSpec, Ts11Spec } from './types.js';
import { springLength } from './families/ts-11.js';

type Vec3 = [number, number, number];
interface Text2 { th: string; en: string }

export interface LabelGroup {
  /** regex (source) ของชื่อชิ้นในกลุ่ม — ชิ้นแรกที่ตรงชนะ (เรียงจากเจาะจงไปกว้าง) */
  match: string;
  label: Text2;
  /** ทิศแยกชิ้น · `'radial'` = จากกลางโมเดลออกไปทางกลางกลุ่ม (ชิ้นรอบวงของ BH) */
  dir: Vec3 | 'radial';
  /** ระยะแยก เป็นสัดส่วนของขนาดชิ้นงาน · 0 = อยู่กับที่ */
  d: number;
  /** ป้ายตอนประกอบ (ตามภาพฉาย 2 มิติ) · `sub` = บรรทัดรองตัวเล็ก */
  asm?: Text2 & { sub?: string };
  /** regex ที่วงเล็บแรกคือเลขชิ้น — นับชิ้นซ้ำเป็น "×n" */
  count?: string;
}

export type DimSpec =
  /** เส้นบอกความยาว a→b (mm ของโมเดล) เลื่อนออกด้าน `side` จนพ้นตัวสินค้า */
  | { k: 'len'; a: Vec3; b: Vec3; side: 'down' | 'up'; text: string }
  /** ความสูงของวงแหวนรัศมี r ตามแกน y จาก y0 ถึง y1 — ตัวดูวางที่ขอบขวาตามมุมกล้อง */
  | { k: 'ringLen'; r: number; y0: number; y1: number; text: string }
  /** เส้นผ่านศูนย์กลาง: วงกลมจุดกลาง c แกน axis รัศมี r */
  | { k: 'dia'; c: Vec3; axis: Vec3; r: number; text: string; above?: boolean };

export interface Annotations {
  /** ทิศกล้องเริ่มต้น (จากจุดกลางไปหากล้อง) */
  view: Vec3;
  groups: LabelGroup[];
  dims: DimSpec[];
}

const num = (n: number): string => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));
/** ความยาวสายเป็นคำบนป้าย: < 1 m เป็น cm */
const cableText = (m: number): Text2 => (m < 1 ? { th: `${num(m * 100)} cm`, en: `${num(m * 100)} cm` } : { th: `${num(m)} M.`, en: `${num(m)} M.` });

/** ชนิดสาย TS_-11 ตามแคตตาล็อก (catalogTs.ts ช่อง cable) — ไม่ import pricingLab ⇒ คำซ้ำที่นี่ (คำบนป้าย ไม่ใช่ตรรกะ) */
const TS_CABLE: Record<Ts11Spec['cable'], Text2> = {
  NONE: { th: 'สแตนเลสถัก', en: 'SS braided' },
  P: { th: 'พีวีซี', en: 'PVC' },
  T: { th: 'เทปล่อน', en: 'Teflon' },
  TS: { th: 'เทปล่อนหุ้มชีลด์', en: 'Shielded Teflon' },
};

function ts11(spec: Ts11Spec): Annotations {
  const L = spec.tubeLen, d = spec.dia, spring = springLength(spec);
  const cable = TS_CABLE[spec.cable];
  const len = spec.cableLen === null ? null : cableText(spec.cableLen);
  const groups: LabelGroup[] = [
    { match: '^probe_tube', label: { th: `แกนวัด Ø${d}×${num(L)}`, en: `Probe Ø${d}×${num(L)}` }, dir: [-1, 0, 0], d: 0.08 },
    { match: '^strain_spring', label: { th: 'สปริง', en: 'Spring' }, dir: [0, 1, 0], d: 0.035,
      asm: { th: `สปริงกันสายหัก ${num(spring)} mm.`, en: `Strain relief spring ${num(spring)} mm.` } },
    { match: '^cable', label: { th: `สาย${cable.th}`, en: `${cable.en} cable` }, dir: [0, 0, 0], d: 0,
      asm: { th: `สาย ${cable.th}`, en: `${cable.en} cable` } },
    { match: '^braid_end', label: { th: 'ปลายสาย', en: 'Cable end' }, dir: [1, 0, 0], d: 0.05 },
    { match: '^lead_sleeve', label: { th: 'ปลอกสาย', en: 'Sleeve' }, dir: [1, 0, 0], d: 0.12, count: 'lead_sleeve_(\\d+)' },
    { match: '^spade_lug', label: { th: 'หางปลา', en: 'Spade lug' }, dir: [1, 0, 0], d: 0.15, count: 'spade_lug_(\\d+)' },
    { match: '^lead_\\d', label: { th: 'สายไฟ', en: 'Lead wire' }, dir: [1, 0, 0], d: 0.09, count: 'lead_(\\d+)' },
  ];
  const dims: DimSpec[] = [
    { k: 'len', a: [-L, 0, 0], b: [0, 0, 0], side: 'down', text: `L1 ${num(L)} mm.` },
    { k: 'dia', c: [-L, 0, 0], axis: [1, 0, 0], r: Number(d) / 2, text: `∅D1 ${d}` },
  ];
  // สายวาดย่อ (0 → ปลายสาย 290 mm) แต่ป้ายบอกความยาวจริงจากรหัส · ไม่บอกความยาว = ไม่มีป้าย (ไม่เดา)
  if (len) dims.splice(1, 0, { k: 'len', a: [0, 0, 0], b: [290, 0, 0], side: 'down', text: `CL1 ${len.th}` });
  return { view: [0.4, 0.55, 1], groups, dims };
}

/** การออกขั้วไฟของ BH ตามแคตตาล็อก (TERM_STRIP ของ catalogBh.ts) */
function termText(spec: BandSpec): Text2 {
  switch (spec.term) {
    case 'NONE': return { th: 'ออกสาย 30 cm', en: 'Lead wire 30 cm' };
    case '1': case '2': case '3': return { th: `ออกสาย ${spec.term} M.`, en: `Lead wire ${spec.term} M.` };
    case 'N': return { th: 'ขั้วน็อต', en: 'Stud terminal' };
    case 'PL2': return { th: 'ปลั๊ก PL-2', en: 'Plug PL-2' };
    case 'PL5': return { th: 'ปลั๊ก PL-5', en: 'Plug PL-5' };
    case 'T': return { th: 'เต๋าเซรามิก', en: 'Ceramic terminal block' };
  }
}

function band(spec: BandSpec): Annotations {
  const term = termText(spec);
  const groups: LabelGroup[] = [
    { match: '^band_(shell|half)', label: { th: 'ตัวฮีตเตอร์', en: 'Band' }, dir: 'radial', d: spec.family === 'BH-01C' ? 0.12 : 0 },
    { match: '^clamp_bar', label: { th: 'แผ่นรัด', en: 'Clamp bar' }, dir: 'radial', d: 0.15 },
    { match: '^clamp_bolt', label: { th: 'สกรู', en: 'Bolt' }, dir: 'radial', d: 0.3, count: 'clamp_bolt_(\\d+_\\d+)' },
    { match: '^clamp_nut', label: { th: 'น็อต', en: 'Nut' }, dir: 'radial', d: 0.42, count: 'clamp_nut_(\\d+_\\d+)' },
    { match: '^terminal_base', label: { th: 'ฐานขั้ว', en: 'Terminal base' }, dir: 'radial', d: 0.12 },
    { match: '^ceramic_bush', label: { th: 'บุชเซรามิก', en: 'Ceramic bush' }, dir: 'radial', d: 0.22 },
    { match: '^ceramic_block', label: { th: 'เต๋าเซรามิก', en: 'Ceramic block' }, dir: 'radial', d: 0.22, asm: term },
    { match: '^(insulator|stud|nut)_', label: { th: 'ขั้วน็อต', en: 'Stud terminal' }, dir: 'radial', d: 0.3, asm: term },
    { match: '^plug_', label: { th: term.th, en: term.en }, dir: 'radial', d: 0.3, asm: term },
    { match: '^screw', label: { th: 'สกรูขั้ว', en: 'Terminal screw' }, dir: 'radial', d: 0.36 },
    { match: '^lead_wire', label: { th: 'สายไฟ', en: 'Lead wire' }, dir: 'radial', d: 0.38, asm: term },
  ];
  // ป้ายขนาดเฉพาะ BH-01 (แกนวงแหวน = y) · BH-01C โมเดลวางเอียงตามแบบของ Appsale ⇒ ยังไม่มีป้ายขนาด (เฟส 1 ก้อนถัดไป)
  const dims: DimSpec[] = spec.family === 'BH-01'
    ? [
        { k: 'ringLen', r: spec.id / 2 + spec.t, y0: -spec.h / 2, y1: spec.h / 2, text: `H ${num(spec.h)}` },
        { k: 'dia', c: [0, spec.h / 2, 0], axis: [0, 1, 0], r: spec.id / 2, text: `∅ID ${num(spec.id)}`, above: true },
      ]
    : [];
  return { view: [1, 0.85, 1.15], groups, dims };
}

/** ป้าย + ระยะแยก + ป้ายขนาดของ spec — ทางเดียวที่ตัวดูได้ข้อมูลตระกูล */
export function annotate(spec: DrawingSpec): Annotations {
  return spec.family === 'TS_-11' ? ts11(spec) : band(spec);
}
