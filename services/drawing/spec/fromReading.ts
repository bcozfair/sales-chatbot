// ─────────────────────────────────────────────────────────────────────────────
//  ผลอ่านรหัสของหน้าคำนวณราคา → พารามิเตอร์ของแบบ (`DrawingSpec`) — **โมดูลแบบไม่มีตัวอ่านรหัสของตัวเอง**
//
//  ทำไม: ตัวอ่านของ Appsale อ่านรหัสจริงได้ 60.8% (BH-02 รูปแบบ Odoo 0/494) ส่วนหน้าคำนวณราคามีตัวอ่านตามแคตตาล็อก
//  ที่ครอบกว้างกว่าอยู่แล้ว ⇒ แบบรับ "ช่องตามแคตตาล็อก" (`tsForm` / `form`) จากการอ่านครั้งเดียวกับที่คิดราคา
//  ⇒ ราคากับแบบเป็นของชิ้นเดียวกันโดยโครงสร้าง (แผน §2.5 ข้อ 1)
//
//  **ห้ามเติมค่าเริ่มต้น — ทั้งของ Appsale และของหน้าคำนวณราคา** (กติกาเดียวกับตัวอ่านรหัส: รหัสไม่บอก ≠ ค่ามาตรฐาน)
//  · Appsale เติมสาย 2 M · แรงดัน 220 · การต่อ PL เมื่อรหัสไม่บอก — ที่นี่ไม่เติม
//  · `''` ที่ไม่มี issue = None ของแคตตาล็อก (สายสแตนเลสถัก · สาย 30 cm · SUS304) **ไม่ใช่ช่องว่าง** ⇒ ใช้ได้
//  · ค่าคงที่ของตระกูลที่แคตตาล็อกเขียนไว้ (BH ความหนา 4 mm) ไม่ใช่การเติมค่าจากรหัส
//
//  ไฟล์นี้ตัดสินแค่ "วาดได้ไหม" — ช่องที่กำหนดรูปทรงต้องมาจากรหัสโดยไม่เดา ไม่งั้นวาดไม่ได้
//  **แกนหักวาดไม่ได้ทุกตระกูล** (แบบวันนี้วาดแกนตรงอย่างเดียว) — อ่านสัญญาณจาก `bend:*` ทั้งในช่องที่ติ๊ก (`addons`)
//  และใน `cfg.options` ที่ตัวอ่านรหัสตั้งเองจากรหัส (ตั้งแต่ pricingLab `c80d688` ตัว L ท้ายเลขรุ่น = กฎหัก L +100)
//  ⇒ ไม่พึ่งว่า `headJunk` ยังค้างอยู่ — วันที่ฝั่งคิดราคาล้าง `headJunk` เมื่ออ่าน L ได้ แกนหัก 330 รหัสต้องไม่ถูกวาดเป็นแท่งตรง
//  ส่วน "ส่งลูกค้าได้ไหม" (ความหลวมของช่องอื่น · รูเจาะ · ไม่รับผลิต) อยู่ที่ checks.ts ที่เดียว
//
//  ทางที่ไม่ได้เลือก: วาดด้วยค่าที่หน้าคำนวณราคา "เดา" (ช่องที่มี issue ยังมีค่าใน `values` ได้) แล้วติดป้ายเตือน —
//  แบบที่ขนาดผิดแต่ดูเรียบร้อยอันตรายกว่าไม่มีแบบ เพราะคนเชื่อภาพมากกว่าป้าย
// ─────────────────────────────────────────────────────────────────────────────

import type { BandSpec, BhFormReading, Doubt, DrawingSpec, PricingReading, Ts11Spec, TsFormReading } from '../types.js';

export type FromReading =
  | { ok: true; spec: DrawingSpec }
  /** `family` = ตระกูลตามผลอ่าน (null = ไม่มีช่องตามแคตตาล็อก) · `reasons` = ทำไมวาดไม่ได้ */
  | { ok: false; family: string | null; reasons: Doubt[] };

/** ช่องของ TS_-11 ที่กำหนดรูปทรง — มี issue/ไม่ได้เขียน = วาดไม่ได้ (checks.ts ใช้แยกช่องที่เหลือ) */
export const TS11_SHAPE_SLOTS = ['probe', 'sensor', 'spring', 'd', 'l1', 'cable'] as const;

export const SLOT_LABEL: Record<string, string> = {
  probe: 'ชนิดหัววัด', sensor: 'ชนิดเซนเซอร์', spring: 'สปริง', d: 'ขนาดแกน', l1: 'ความยาวแกน', cable: 'ชนิดสาย',
  mat: 'วัสดุ', elem: 'จำนวน Element', ground: 'Ground', cl: 'ความยาวสาย',
};
export const ISSUE_TEXT: Record<string, string> = {
  off: 'เป็นค่านอกแคตตาล็อก', ask: 'เป็นค่าที่ต้องขอราคาจากฝ่ายผลิต', unread: 'มีค่าที่ระบบไม่รู้จัก', missing: 'รหัสไม่ได้บอก',
};

const SENSORS: readonly Ts11Spec['sensor'][] = ['TSK', 'TSJ', 'TST', 'TSP', 'TSPA', 'TSZ', 'N2', 'N10', 'P2', 'P10'];
const BH_TERMS: readonly BandSpec['term'][] = ['NONE', '1', '2', '3', 'N', 'PL2', 'PL5', 'T'];
/** ความหนาของ BH-01/BH-01C — แคตตาล็อก "ความหนา T Standard 4 mm." (ค่าคงที่ของตระกูล ไม่ใช่ค่าที่รหัสบอก) */
const BH_THICKNESS = 4;

const positive = (s: string | undefined): number | null => {
  if (s === undefined || !/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
};
/** `''` = None ของแคตตาล็อก → `'NONE'` · ค่าในรายการ → ตัวมันเอง · นอกนั้น → null */
function choice<T extends string>(raw: string | undefined, allowed: readonly T[]): T | null {
  const v = raw === '' ? 'NONE' : raw;
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** แกนหัก (`bend:*`) จากช่องที่ติ๊ก + จากสเปกที่ตัวอ่านรหัสตั้ง — มี = วาดไม่ได้ ทุกตระกูล */
function bendReason(reading: PricingReading): Doubt | null {
  const all = [...(reading.tsForm?.addons ?? []), ...(reading.form?.addons ?? []), ...(reading.cfg?.options ?? [])];
  return all.some((a) => a.startsWith('bend:')) ? { key: 'bend', reason: 'แกนหัก L / หักฉาก — แบบยังวาดแกนงอไม่ได้' } : null;
}

function ts11(f: TsFormReading, bend: Doubt | null): FromReading {
  const reasons: Doubt[] = [];
  const v = f.values;
  if (f.headJunk) reasons.push({ key: 'headJunk', reason: `ท่อน «${f.headJunk}» หลังเลขรุ่นไม่อยู่ในแคตตาล็อก TS_-11 (L / LP = แกนงอ TS_-11L ซึ่งยังไม่มีแบบ)` });
  if (bend) reasons.push(bend);
  for (const slot of TS11_SHAPE_SLOTS) {
    const issue = f.issues?.[slot];
    if (issue) reasons.push({ key: `issue:${slot}`, reason: `${SLOT_LABEL[slot]} ${ISSUE_TEXT[issue]} — แบบต้องรู้ค่านี้` });
    else if (f.omit?.includes(slot)) reasons.push({ key: `omit:${slot}`, reason: `รหัสไม่ได้บอก${SLOT_LABEL[slot]} — แบบต้องรู้ค่านี้ (ไม่เติมค่ามาตรฐานให้)` });
  }
  const sensor = choice(`${v.probe ?? ''}${v.sensor ?? ''}`, SENSORS);
  const spring = choice(v.spring, ['NONE', 'P'] as const);
  const dia = positive(v.d);
  const tubeLen = positive(v.l1);
  const cable = choice(v.cable, ['NONE', 'P', 'T', 'TS'] as const);
  if (reasons.length === 0) {
    // ไม่มี issue แต่ค่าใช้ไม่ได้ = ผลอ่านไม่ตรงกับที่ไฟล์นี้รู้จัก (หน้าคำนวณราคาเพิ่มตัวเลือกใหม่) — วาดไม่ได้ ไม่เดา
    if (!sensor) reasons.push({ key: 'value:sensor', reason: `ไม่รู้จักชนิดเซนเซอร์ «${v.probe ?? ''}${v.sensor ?? ''}» ในแบบ TS_-11` });
    if (!spring) reasons.push({ key: 'value:spring', reason: `ไม่รู้จักค่าสปริง «${v.spring}»` });
    if (dia === null) reasons.push({ key: 'value:d', reason: `ขนาดแกน «${v.d ?? ''}» ไม่ใช่ตัวเลข` });
    if (tubeLen === null) reasons.push({ key: 'value:l1', reason: `ความยาวแกน «${v.l1 ?? ''}» ไม่ใช่ตัวเลข` });
    if (!cable) reasons.push({ key: 'value:cable', reason: `ไม่รู้จักชนิดสาย «${v.cable}» ในแบบ TS_-11` });
  }
  if (reasons.length || !sensor || !spring || dia === null || tubeLen === null || !cable) return { ok: false, family: 'TS_-11', reasons };

  // ช่องที่ไม่มีผลกับรูปทรง: ค่าที่ใช้ไม่ได้ = null (checks.ts ปิดการส่งจาก issue ของช่องนั้นเอง)
  const unit = f.clUnit === 'cm' ? 100 : f.clUnit === 'mm' ? 1000 : 1;
  const cl = f.issues?.cl || f.omit?.includes('cl') ? null : positive(v.cl);
  return {
    ok: true,
    spec: {
      family: 'TS_-11',
      sensor,
      spring,
      dia: v.d,
      mat: f.issues?.mat ? null : choice(v.mat, ['NONE', 'A', 'T', 'TN', 'AT'] as const),
      tubeLen,
      elem: f.issues?.elem ? null : choice(v.elem, ['NONE', '2'] as const),
      cableLen: cl === null ? null : cl / unit,
      cable,
      ground: f.issues?.ground ? null : choice(v.ground, ['NONE', 'U'] as const),
    },
  };
}

function band(f: BhFormReading, family: BandSpec['family'], bend: Doubt | null): FromReading {
  const reasons: Doubt[] = [];
  if (bend) reasons.push(bend);
  if (f.sizeText !== undefined) reasons.push({ key: 'size', reason: `ขนาด «${f.sizeText}» ไม่ใช่รูปแบบ ID × H ของแคตตาล็อก — แบบต้องรู้ขนาด` });
  else if (!(typeof f.id === 'number' && f.id > 0) || !(typeof f.h === 'number' && f.h > 0)) reasons.push({ key: 'size', reason: 'รหัสไม่ได้บอกขนาด ID × H — แบบต้องรู้ขนาด' });
  const term = choice(f.term ?? '', BH_TERMS);
  if (!term) reasons.push({ key: 'value:term', reason: `ไม่รู้จักการออกขั้วไฟ «${f.term}» ในแบบ ${family}` });
  const mat = choice(f.mat ?? '', ['NONE', 'Z'] as const);
  if (!mat) reasons.push({ key: 'value:mat', reason: `ไม่รู้จักวัสดุ «${f.mat}» ในแบบ ${family}` });
  // การต่อใช้งานมีเฉพาะ BH-01C (`''` = ไม่ระบุ — แคตตาล็อกมีแค่ SE/PL แต่รหัสจริงที่ไม่ระบุมีอยู่ · ไม่เติม PL แบบ Appsale)
  const conn: BandSpec['conn'] | undefined = family === 'BH-01C' ? (f.conn === undefined || f.conn === '' ? '' : f.conn === 'PL' || f.conn === 'SE' ? f.conn : undefined) : null;
  if (conn === undefined) reasons.push({ key: 'value:conn', reason: `ไม่รู้จักการต่อใช้งาน «${f.conn}»` });
  if (reasons.length || !term || !mat || conn === undefined || f.id === undefined || f.h === undefined) return { ok: false, family, reasons };
  const fields = {
    id: f.id, h: f.h, t: BH_THICKNESS,
    // ช่องแรงดันของหน้าคำนวณราคาเป็นข้อความตามที่เขียน (`220V`) — ตัด V ท้ายตัวเลขให้เหลือค่าแบบแคตตาล็อก (ค่าเดียวกัน ไม่ใช่การเดา)
    v: f.volt === undefined ? null : f.volt.replace(/^(\d+(?:\.\d+)?)V$/i, '$1'),
    w: f.wattText !== undefined ? null : f.watt ?? null,
    term, mat,
    conn,
    // ตำแหน่งขั้วไฟไม่อยู่ในรหัส ⇒ ค่าอ้างอิงของ Appsale · รูเจาะ: รหัสรู้แค่จำนวน × ขนาด ไม่รู้ตำแหน่ง ⇒ ไม่วาดรู (checks.ts ปิดการส่ง)
    termPos: null,
    holes: [],
  };
  return { ok: true, spec: family === 'BH-01C' ? { family, ...fields } : { family, ...fields } };
}

/** ผลอ่านรหัส → spec ของแบบ หรือเหตุผลที่วาดไม่ได้ */
export function fromReading(reading: PricingReading): FromReading {
  if (reading.tsForm) {
    if (reading.tsForm.family === 'TS_-11') return ts11(reading.tsForm, bendReason(reading));
    return { ok: false, family: reading.tsForm.family, reasons: [{ key: 'noFamily', reason: `รุ่น ${reading.tsForm.family} ยังไม่มีแบบ 3 มิติ` }] };
  }
  if (reading.form) {
    const fam = reading.form.family;
    if (fam === 'BH-01' || fam === 'BH-01C') return band(reading.form, fam, bendReason(reading));
    return { ok: false, family: fam, reasons: [{ key: 'noFamily', reason: `รุ่น ${fam} ยังไม่มีแบบ 3 มิติ` }] };
  }
  return { ok: false, family: null, reasons: [{ key: 'noForm', reason: 'รหัสนี้ไม่มีช่องตามแคตตาล็อก — ยังไม่มีแบบ 3 มิติ' }] };
}
