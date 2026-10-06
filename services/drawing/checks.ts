// ─────────────────────────────────────────────────────────────────────────────
//  กติกา "วาดได้ไหม / ส่งให้ลูกค้าได้ไหม" — ที่เดียวของโมดูลแบบ (แผน §4.5 ข้อ 1–3)
//
//  ส่งได้เมื่อครบทุกข้อ:
//    1. มีแบบของตระกูลนี้ และช่องที่กำหนดรูปทรงแปลงได้ครบโดยไม่เดา (`fromReading` — ไม่ผ่าน = วาดไม่ได้)
//    2. ผลอ่านรหัส **ไม่หลวม** — ยกเว้นแค่ "วิธีเขียนคนละแบบ" (`WRITING_STYLE` ข้างล่าง) · BH ที่มีรูเจาะ = ส่งไม่ได้
//       (แบบไม่มีรู เพราะไม่รู้ตำแหน่ง — ห้ามเรียงเอง)
//    3. หน้าคำนวณราคาไม่ได้ตอบ "ไม่รับผลิต" และคิดราคาได้ (ผลคิดราคาไม่ว่าง)
//  ข้อ 4 (ตัวตรวจสเปกของ Appsale) = เฟส 1 · "ต้องขอราคา" (`quoteOnRequest`) **ไม่ปิด** การส่ง — ราคายังไม่ครบ ≠ รูปทรงผิด
//  · ไม่มีปุ่มข้ามด่าน (หัวหน้าเคาะ §9 ข้อ 2)
//
//  ⚠️ `WRITING_STYLE` คือการตัดสินของ PM เฟส 0 (ข้อ 12.2 ของแผน architect · "ตามข้อแนะนำ") **ยังรอเจ้าของยืนยัน**
//     — เจ้าของเคาะต่างเมื่อไหร่ แก้รายการนี้ที่เดียว (ด่าน diag:drawing-coverage อ่านผลจากฟังก์ชันนี้ ไม่ได้มีสำเนา)
//
//  ทางที่ไม่ได้เลือก: "ส่งได้ถ้าช่องที่หลวมไม่ใช่ช่องรูปทรง" — ลูกค้าได้แบบที่ป้ายรหัสบอกของที่แบบไม่ได้วาด
//  (เช่น `-S000` งานสั่งทำ · สาย Silicone) ซึ่งเขาจะเข้าใจว่าแบบครบแล้ว
// ─────────────────────────────────────────────────────────────────────────────

import type { Doubt, DrawingSpec, PricingOutcome, PricingReading } from './types.js';
import { ISSUE_TEXT, SLOT_LABEL, TS11_SHAPE_SLOTS, fromReading } from './spec/fromReading.js';

/** ชนิดของความหลวมในผลอ่านรหัส */
export type LooseKind =
  | 'issue' | 'omit' | 'tail' | 'extras' | 'written' | 'clUnit' | 'cableNoDash'
  | 'bhLoose' | 'bhExtras' | 'bhAddons' | 'bhHoles' | 'bhWattText';

/**
 * ความหลวมที่เป็นแค่ "วิธีเขียนคนละแบบ" — ไม่ปิดการส่ง
 *   · `cableNoDash` — `+5MPU` แทน `+5M-PU`
 *   · `clUnit` — ความยาวสายเป็น cm / mm (`+30cm`) · แปลงเป็นเมตรแล้วค่าเดียวกัน
 *   · `written` ที่ช่องนั้น **ไม่มี issue** — ค่าในรายการแต่เขียนต่างตัว (`M5` ที่เป็นค่ามาตรฐาน · `5/16"`)
 * ที่เหลือทั้งหมดปิดการส่ง (PM เฟส 0 · รอเจ้าของยืนยัน)
 */
export const WRITING_STYLE: readonly LooseKind[] = ['cableNoDash', 'clUnit', 'written'];

export interface Looseness extends Doubt {
  kind: LooseKind;
}

/** ทุกความหลวมของผลอ่าน (รวมที่ได้รับยกเว้น) — ช่องรูปทรงของ TS_-11 ไม่อยู่ในนี้ (fromReading ตัดสินเป็น "วาดไม่ได้" แล้ว) */
export function loosenessOf(reading: PricingReading): Looseness[] {
  const out: Looseness[] = [];
  const ts = reading.tsForm;
  if (ts) {
    const shape = ts.family === 'TS_-11' ? (TS11_SHAPE_SLOTS as readonly string[]) : [];
    for (const [slot, issue] of Object.entries(ts.issues ?? {}))
      if (!shape.includes(slot)) out.push({ kind: 'issue', key: `issue:${slot}`, reason: `${SLOT_LABEL[slot] ?? slot} ${ISSUE_TEXT[issue] ?? issue}` });
    for (const slot of ts.omit ?? [])
      if (!shape.includes(slot)) out.push({ kind: 'omit', key: `omit:${slot}`, reason: `รหัสไม่ได้บอก${SLOT_LABEL[slot] ?? slot}` });
    if (ts.tail?.length) out.push({ kind: 'tail', key: 'tail', reason: `ท้ายรหัส «${ts.tail.join('')}» อยู่นอกแคตตาล็อก — แบบไม่ได้วาดส่วนนี้` });
    if (ts.extras?.length) out.push({ kind: 'extras', key: 'extras', reason: `ท่อน ${ts.extras.map((e) => `«${e}»`).join(' ')} เป็นงานสั่งทำนอกแคตตาล็อก — ไม่รู้ว่าเปลี่ยนอะไรในแบบ` });
    for (const slot of Object.keys(ts.written ?? {}))
      if (!ts.issues?.[slot]) out.push({ kind: 'written', key: `written:${slot}`, reason: `${SLOT_LABEL[slot] ?? slot} เขียนต่างจากแคตตาล็อก (ค่าเดียวกัน)` });
    if (ts.clUnit) out.push({ kind: 'clUnit', key: 'clUnit', reason: `ความยาวสายเขียนเป็น ${ts.clUnit}` });
    if (ts.cableNoDash) out.push({ kind: 'cableNoDash', key: 'cableNoDash', reason: 'ชนิดสายเขียนติดกับ M' });
  }
  const bh = reading.form;
  if (bh) {
    if (bh.loose) out.push({ kind: 'bhLoose', key: 'loose', reason: 'รหัสเขียนนอกรูปแบบแคตตาล็อก' });
    if (bh.extras?.length) out.push({ kind: 'bhExtras', key: 'extras', reason: `ท่อน ${bh.extras.map((e) => `«${e.text}»`).join(' ')} อยู่นอกแคตตาล็อก — แบบไม่ได้วาดส่วนนี้` });
    if (bh.addons?.length) out.push({ kind: 'bhAddons', key: 'addons', reason: 'มีสิ่งที่บวกเพิ่ม (สาย Silicone / สายถัก / ท่อเฟ็กส์) — แบบไม่ได้วาด' });
    if (bh.holes?.length) out.push({ kind: 'bhHoles', key: 'holes', reason: 'มีรูเจาะ — ระบบไม่รู้ตำแหน่งรู แบบนี้วาดแบบไม่มีรู' });
    if (bh.wattText !== undefined) out.push({ kind: 'bhWattText', key: 'wattText', reason: `กำลังไฟ «${bh.wattText}» ไม่ใช่ตัวเลขวัตต์เดียว` });
  }
  return out;
}

export interface DrawingVerdict {
  /** ตระกูลตามผลอ่าน (null = รหัสไม่มีช่องตามแคตตาล็อก) */
  family: string | null;
  /** มีเมื่อวาดได้ */
  spec: DrawingSpec | null;
  canDraw: boolean;
  canSend: boolean;
  /** ทำไมวาดไม่ได้ */
  noDraw: Doubt[];
  /** ทำไมส่งลูกค้าไม่ได้ (วาดไม่ได้ = ส่งไม่ได้ ไม่ซ้ำเหตุผลที่นี่) */
  noSend: Doubt[];
}

/** คำตัดสินของหนึ่งรหัส จากผลอ่าน + ผลคิดราคาของการเรียกครั้งเดียวกัน */
export function judge(reading: PricingReading, outcome: PricingOutcome | null): DrawingVerdict {
  const conv = fromReading(reading);
  if (!conv.ok) return { family: conv.family, spec: null, canDraw: false, canSend: false, noDraw: conv.reasons, noSend: [] };
  const noSend: Doubt[] = loosenessOf(reading)
    .filter((l) => !WRITING_STYLE.includes(l.kind))
    .map(({ key, reason }) => ({ key, reason }));
  if (!outcome) noSend.push({ key: 'noPrice', reason: 'คิดราคาไม่ได้ — แบบต้องคู่กับราคา' });
  else if (outcome.status === 'notManufacturable') noSend.push({ key: 'notManufacturable', reason: 'หน้าคำนวณราคาตอบว่าไม่รับผลิต' });
  return { family: conv.spec.family, spec: conv.spec, canDraw: true, canSend: noSend.length === 0, noDraw: [], noSend };
}
