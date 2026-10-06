// ─────────────────────────────────────────────────────────────────────────────
//  กติกา "วาดได้ไหม / ส่งให้ลูกค้าได้ไหม" — ที่เดียวของโมดูลแบบ (แผน §4.5 ข้อ 1–3)
//
//  สามชั้น (เจ้าของเคาะ 2026-10-06):
//    · **วาดไม่ได้** — ไม่มีแบบของตระกูล · ช่องที่กำหนดรูปทรงเดา/ไม่บอก · แกนหัก (`fromReading`)
//    · **ส่งไม่ได้** (`noSend`) — ความหลวมของช่องอื่น (issue/ไม่บอก) · `loose` ของ BH · สิ่งบวกเพิ่ม · รูเจาะ (ไม่รู้ตำแหน่ง
//      ห้ามเรียงเอง) · กำลังไฟนอกรูปแบบ · คิดราคาไม่ได้ · "ไม่รับผลิต" — **ไม่มีทางยืนยันข้าม** (ข้อ 3 ของเจ้าของ: "ตอนระบบเดา
//      บางช่อง ให้ปิดปุ่ม" · ไม่มีปุ่มข้ามด่าน §9 ข้อ 2)
//    · **ส่งได้หลังผู้เสนอราคายืนยัน** (`confirm`) — ส่วนท้ายที่ระบบไม่รู้จัก (`CONFIRMABLE`: ท้ายรหัส · `S###` · ท่อนนอก
//      แคตตาล็อกของ BH เช่น `(HPT)`) เจ้าของ: *"ส่งได้ เพราะผู้เสนอราคาเป็นคนยืนยันเอง"* ⇒ `canSend` = ไม่มีตัวปิด แต่หน้าจอ
//      (เฟส 1) **ต้องบังคับติ๊ก** เมื่อ `confirm` ไม่ว่าง พร้อมโชว์ว่าแบบไม่ได้วาดท่อนไหน
//  **ท่อนท้ายที่เป็นค่าของช่องที่ตัวอ่านปล่อยว่าง = ระบบเดาช่องนั้น ⇒ ส่งไม่ได้** ไม่ว่าช่องรูปทรงหรือไม่ (ข้อ 3 ของเจ้าของ "ตอนระบบ
//  เดาบางช่อง ให้ปิดปุ่ม" · รอบแก้ 3 · 2026-10-06) — ช่องรูปทรง = วาดไม่ได้ (`fromReading`) · ช่องอื่น = `guessedField` ที่นี่
//  เพราะตารางสเปกของกระดาษแบบจะพิมพ์ค่าว่างนั้นผิด (`+1.5MT-U` → Ground ว่างทั้งที่รหัสบอก U · `210-420` แรงดันสองค่า ·
//  `-1.5` ความยาวสายที่ไม่ตรงกับขั้วไฟ "สาย 30 cm") · ไม่ใช่ "ของที่แบบไม่ได้แสดง" จึงยืนยันข้ามไม่ได้
//  ความหลวมที่เป็นแค่ "วิธีเขียนคนละแบบ" (`WRITING_STYLE`) ไม่อยู่ชั้นไหนเลย — เจ้าของยืนยันแนวนี้แล้ว 2026-10-06 (ข้อ 3)
//  · ตัวตรวจสเปกของ Appsale (§4.5 ข้อ 4) = เฟส 1 · "ต้องขอราคา" (`quoteOnRequest`) **ไม่ปิด** การส่ง — ราคายังไม่ครบ ≠ รูปทรงผิด
//  · ด่าน diag:drawing-coverage อ่านผลจากฟังก์ชันนี้ ไม่มีสำเนาของรายการ — เปลี่ยนชั้นของความหลวมชนิดไหน แก้ที่นี่ที่เดียว
//
//  ทางที่ไม่ได้เลือก: "ส่งได้ถ้าช่องที่หลวมไม่ใช่ช่องรูปทรง" โดยไม่ต้องยืนยัน — ลูกค้าได้แบบที่ป้ายรหัสบอกของที่แบบไม่ได้วาด
//  (เช่น `-S000` งานสั่งทำ) ซึ่งเขาจะเข้าใจว่าแบบครบแล้ว ⇒ ต้องมีคนยืนยันว่ารู้ตัว
// ─────────────────────────────────────────────────────────────────────────────

import type { Doubt, DrawingSpec, PricingOutcome, PricingReading } from './types.js';
import { ISSUE_TEXT, SLOT_LABEL, TS11_SHAPE_SLOTS, fromReading } from './spec/fromReading.js';

/** ชนิดของความหลวมในผลอ่านรหัส */
export type LooseKind =
  | 'issue' | 'omit' | 'tail' | 'extras' | 'written' | 'clUnit' | 'cableNoDash'
  | 'bhLoose' | 'bhExtras' | 'bhAddons' | 'bhHoles' | 'bhWattText'
  /** ท่อนท้ายที่เป็นค่าของช่องที่ตัวอ่านปล่อยว่าง = ระบบเดาช่องนั้น (ตารางสเปกจะพิมพ์ผิด) — ส่งไม่ได้เสมอ */
  | 'guessedField';

/**
 * ความหลวมที่เป็นแค่ "วิธีเขียนคนละแบบ" — ไม่ปิดการส่ง
 *   · `cableNoDash` — `+5MPU` แทน `+5M-PU`
 *   · `clUnit` — ความยาวสายเป็น cm / mm (`+30cm`) · แปลงเป็นเมตรแล้วค่าเดียวกัน
 *   · `written` ที่ช่องนั้น **ไม่มี issue** — ค่าในรายการแต่เขียนต่างตัว (`M5` ที่เป็นค่ามาตรฐาน · `5/16"`)
 * (เจ้าของเคาะ 2026-10-06)
 */
export const WRITING_STYLE: readonly LooseKind[] = ['cableNoDash', 'clUnit', 'written'];

/**
 * ส่วนท้ายที่ระบบไม่รู้จัก — ส่งได้ **หลังผู้เสนอราคายืนยัน** (เจ้าของเคาะ 2026-10-06 · แบบไม่ได้วาดส่วนนี้)
 *   · `tail` — ท้ายรหัส TS นอกแคตตาล็อก (`-S000` · `+MP`)
 *   · `extras` — ท่อนงานสั่งทำของ TS (`S###` · `TM###`)
 *   · `bhExtras` — ท่อนนอกแคตตาล็อกของ BH (`(HPT)` · `S000` · `30cm` · `(MQ)`)
 * ความหลวมชนิดอื่นที่ไม่อยู่ในนี้และไม่ใช่ `WRITING_STYLE` = ส่งไม่ได้
 */
export const CONFIRMABLE: readonly LooseKind[] = ['tail', 'extras', 'bhExtras'];

export interface Looseness extends Doubt {
  kind: LooseKind;
}

/** ท่อน `1.5` · `2M` · `50cm` · `500mm` → เมตร (ตัวเลขเปล่า = เมตร ตามตัวอ่านรหัส) · ไม่ใช่ความยาว → null */
function lengthMetres(text: string): number | null {
  const m = text.replace(/^[-+]+/, '').match(/^(\d+(?:\.\d+)?)(M|CM|MM)?$/i);
  if (!m) return null;
  const unit = (m[2] ?? 'M').toUpperCase();
  return Number(m[1]) / (unit === 'CM' ? 100 : unit === 'MM' ? 1000 : 1);
}

/**
 * ช่องที่ไม่ใช่รูปทรงของ TS ที่ตัวอ่านปล่อยว่าง → รูปของค่าที่ช่องนั้นรับได้ตามแคตตาล็อก (เทียบกับท่อนท้ายรหัส)
 * Ground = U · วัสดุ = A/AT/T/TN · Element = 2 · ความยาวสาย = ตัวเลข(+หน่วย)
 */
const TS_EMPTY_FIELD: { slot: string; looksLike: (token: string) => boolean }[] = [
  { slot: 'ground', looksLike: (t) => /^U/i.test(t) },
  { slot: 'mat', looksLike: (t) => /^(A|T)/i.test(t) },
  { slot: 'elem', looksLike: (t) => /^2(?![\d.])/.test(t) },
  { slot: 'cl', looksLike: (t) => /^\d+(\.\d+)?(M|CM|MM)$/i.test(t) },
];
/** ความยาวสายที่ขั้วไฟแบบออกสายของ BH หมายถึง (เมตร) — `''` = สาย 30 cm */
const BH_WIRE_METRES: Record<string, number> = { '': 0.3, '1': 1, '2': 2, '3': 3 };

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
    for (const raw of ts.tail ?? []) {
      const token = raw.replace(/^[-+]+/, '');
      const hit = TS_EMPTY_FIELD.find((f) => f.slot in ts.values && ts.values[f.slot] === '' && !ts.issues?.[f.slot] && !shape.includes(f.slot) && f.looksLike(token));
      if (hit) out.push({ kind: 'guessedField', key: `guessed:${hit.slot}`, reason: `ท้ายรหัส «${raw}» น่าจะเป็น${SLOT_LABEL[hit.slot] ?? hit.slot} แต่ช่องนั้นว่าง — ตารางสเปกจะพิมพ์ผิด` });
    }
  }
  const bh = reading.form;
  if (bh) {
    if (bh.loose) out.push({ kind: 'bhLoose', key: 'loose', reason: 'รหัสเขียนนอกรูปแบบแคตตาล็อก' });
    if (bh.extras?.length) out.push({ kind: 'bhExtras', key: 'extras', reason: `ท่อน ${bh.extras.map((e) => `«${e.text}»`).join(' ')} อยู่นอกแคตตาล็อก — แบบไม่ได้วาดส่วนนี้` });
    if (bh.addons?.length) out.push({ kind: 'bhAddons', key: 'addons', reason: 'มีสิ่งที่บวกเพิ่ม (สาย Silicone / สายถัก / ท่อเฟ็กส์) — แบบไม่ได้วาด' });
    if (bh.holes?.length) out.push({ kind: 'bhHoles', key: 'holes', reason: 'มีรูเจาะ — ระบบไม่รู้ตำแหน่งรู แบบนี้วาดแบบไม่มีรู' });
    if (bh.wattText !== undefined) out.push({ kind: 'bhWattText', key: 'wattText', reason: `กำลังไฟ «${bh.wattText}» ไม่ใช่ตัวเลขวัตต์เดียว` });
    const wire = BH_WIRE_METRES[bh.term ?? ''];
    for (const e of bh.extras ?? []) {
      const token = e.text.replace(/^[-+]+/, '');
      // ตัวเลขที่สองต่อจากแรงดัน = แรงดันสองค่า / วัตต์ที่ไม่มี W · วัตต์ที่สองต่อจากกำลังไฟ — ช่องพิมพ์ได้ค่าเดียว
      if ((e.after === 'volt' && /^\d+(\.\d+)?$/.test(token)) || (e.after === 'watt' && /^\d+(\.\d+)?W$/i.test(token)))
        out.push({ kind: 'guessedField', key: e.after === 'volt' ? 'guessed:volt' : 'guessed:watt', reason: `ท่อน «${e.text}» ต่อจาก${e.after === 'volt' ? 'แรงดัน' : 'กำลังไฟ'} — ช่องนั้นพิมพ์ได้ค่าเดียว ตารางสเปกจะไม่ครบ` });
      // ความยาวสายในรหัสที่ไม่ตรงกับขั้วไฟแบบออกสาย (`''` = 30 cm · 1/2/3 = เมตร)
      const len = lengthMetres(token);
      if (wire !== undefined && len !== null && e.after !== 'volt' && Math.abs(len - wire) > 1e-9)
        out.push({ kind: 'guessedField', key: 'guessed:term', reason: `ท่อน «${e.text}» เป็นความยาวสาย ${len} ม. แต่ช่องขั้วไฟบอกสาย ${wire} ม. — ตารางสเปกจะพิมพ์ผิด` });
    }
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
  /** ส่วนที่แบบไม่ได้วาด — ส่งได้เมื่อผู้เสนอราคาติ๊กยืนยัน (หน้าจอบังคับเมื่อไม่ว่าง) */
  confirm: Doubt[];
}

/** คำตัดสินของหนึ่งรหัส จากผลอ่าน + ผลคิดราคาของการเรียกครั้งเดียวกัน */
export function judge(reading: PricingReading, outcome: PricingOutcome | null): DrawingVerdict {
  const conv = fromReading(reading);
  if (!conv.ok) return { family: conv.family, spec: null, canDraw: false, canSend: false, noDraw: conv.reasons, noSend: [], confirm: [] };
  const noSend: Doubt[] = [], confirm: Doubt[] = [];
  for (const { kind, key, reason } of loosenessOf(reading)) {
    if (WRITING_STYLE.includes(kind)) continue;
    (CONFIRMABLE.includes(kind) ? confirm : noSend).push({ key, reason });
  }
  if (!outcome) noSend.push({ key: 'noPrice', reason: 'คิดราคาไม่ได้ — แบบต้องคู่กับราคา' });
  else if (outcome.status === 'notManufacturable') noSend.push({ key: 'notManufacturable', reason: 'หน้าคำนวณราคาตอบว่าไม่รับผลิต' });
  return { family: conv.spec.family, spec: conv.spec, canDraw: true, canSend: noSend.length === 0, noDraw: [], noSend, confirm };
}
