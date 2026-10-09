// ─────────────────────────────────────────────────────────────────────────────
//  ซีรีส์ TS แบบ "ออกสาย" — TS_-01 · TS_-01-0 · TS_-02 · TS_-03 · TS_-05 (แคตตาล็อก TS-SERIES หน้า 2 · 3 · 4 · 6 · 8)
//  พอร์ตจาก Appsale `products/ts-series-assembly.js` (`BUILDERS['01' | '01-0' | '02' | '03' | '05']` + `assemble` + `tailAnchors`)
//  · จำนวนสายต่อชนิดเซนเซอร์จาก `ts-common.js` (`SENSORS_TC/RTD/TCNP[].leads`)
//
//  ทั้งห้ารุ่นใช้ชิ้นส่วนชุดเดียวกัน ต่างกันที่ต้นสาย: เกลียว+หกเหลี่ยม (01) · หูแหวน (01-0) · เขี้ยวล็อค+สปริงคลุมแกน (02) ·
//  ปลอกคอ (03) · เขี้ยวล็อค+แกนต่อ+ปลอกคอ (05) — รูปทรงตามไฟล์ CAD ของผู้ผลิต (`ts-01-05 step.zip`) ส่วนความยาวตามแคตตาล็อก
//  ⚠️ สายวาดย่อ 120 mm เสมอ — ความยาวจริงอยู่ในรหัส
//
//  `tsCableBuild(spec)` คืนชิ้นส่วน + จุดยึด (= `assemble(parts, anchors)` ของต้นฉบับ) — ภาพฉาย 2 มิติใช้จุดยึดชุดเดียวกับ STEP
//  **ช่องที่ไม่มีผลกับรูปทรง** (วัสดุ · Element · Ground · ความยาวสาย) อยู่ใน spec แต่ตัวสร้างไม่อ่าน (cache key ของต้นฉบับก็ไม่มี)
//
//  ต่างจากต้นฉบับโดยตั้งใจ: เกลียว `M8x1.25` / `M10x1.5` ของ TS_-01 (ตัวเลือกในชีตที่ Appsale ไม่มี) ใช้ขนาด/ความยาวของ M8 / M10
//  กับระยะพิตช์ตามชื่อ — ด่าน port เทียบไม่ได้ (ตัวอ่านของ Appsale ไม่รับ) แต่ผ่านโค้ดเส้นเดียวกันทุกบรรทัด
//  ⚠️ พอร์ตทีละบรรทัด — `diag:drawing-port` เทียบทุกบิตกับต้นฉบับ · ห้ามเปลี่ยนลำดับการเรียกชิ้น (= ลำดับ #id ใน STEP)
// ─────────────────────────────────────────────────────────────────────────────

import type { DrawingFamily, Part, Ts010Spec, Ts01Spec, Ts02Spec, Ts03Spec, Ts05Spec, TsCableSpec } from '../types.js';
import { COLOURS as C, prism, revolve, spring, threadedCylinder } from '../geometry/tsPrimitives.js';
import {
  BIG_SPRING, BRAID_SHOWN, CABLE_SHOWN, HOLDS, JACKETS, LOCKS, SPRING_TS03, TAIL_AFTER_SPLIT,
  bayonetLock, cableRadius, cableTail, leadSpread, probe, ringTerminal, sleeveRadius, strainRelief,
} from './tsParts.js';

/** จำนวนสายตามชนิดเซนเซอร์ — Thermocouple / NTC / PTC = 2 (+ −) · RTD = 3 (A B b) */
export const CABLE_LEADS: Record<TsCableSpec['sensor'], number> = {
  K: 2, J: 2, T: 2, P: 3, PA: 3, Z: 3,
  TSK: 2, TSJ: 2, TST: 2, N2: 2, N10: 2, P2: 2, P10: 2, TSP: 3, TSPA: 3, TSZ: 3,
};

/** เกลียวของ TS_-01 (`THREADS_01` ของ `ts-common.js` · Length Thread จากตารางแคตตาล็อก) + สองตัวของชีต (ดูหัวไฟล์) */
export const THREADS_01: Record<Ts01Spec['thread'], { label: string; len: number; dia: number }> = {
  NONE: { label: '1/4” (6.35 mm.)', len: 11, dia: 6.35 },
  '5/16': { label: '5/16” (7.95 mm.)', len: 15, dia: 7.95 },
  M6: { label: 'M6 x 1.0 (6 mm.)', len: 11, dia: 6 },
  M8: { label: 'M8 x 1.0 (8 mm.)', len: 15, dia: 8 },
  'M8x1.25': { label: 'M8 x 1.25 (8 mm.)', len: 15, dia: 8 },
  M10: { label: 'M10 x 1.25 (10 mm.)', len: 15, dia: 10 },
  'M10x1.5': { label: 'M10 x 1.5 (10 mm.)', len: 15, dia: 10 },
};

/* TS_-02: สปริงละเอียดพันคลุมแกนตั้งแต่ปลาย L1 ยาว 300 mm. (แคตตาล็อกหน้า 4 · CAD ⌀นอก 6.5 ลวด ⌀0.5)
           เขี้ยวล็อคสวมอยู่บนสปริง ขอบหน้าห่างปลาย L1 56 mm. (CAD) */
const SPRING_TS02 = 300, TS02_LOCK_AT = 56;
/* TS_-05: สปริง 100 mm. ทุกขนาดแกน · ระยะจากเขี้ยวล็อคถึงปลอกคอ 50 mm. ตามแบบในแคตตาล็อก
           สปริงเล็กหน้าเขี้ยวล็อค (CAD ⌀นอก 6 ลวด ⌀0.5) เว้นปลายแกนเปล่า 9 mm. */
const SPRING_TS05 = 100, TS05_EXTENSION = 50, TS05_BARE_TIP = 9;
/* TS_-01: ปลายแกน (Tube Length · มาตรฐาน 5) → เกลียว (ยาวตามตาราง 11/15) → หกเหลี่ยม → สปริง 100 (แคตตาล็อกหน้า 2)
           CAD (M8): หกเหลี่ยม AF 14 หนา 7.5 · สปริง ⌀นอก 6.4 · แกนเซ็นเซอร์ ⌀5 ยาว 75 ใต้สปริง
           ⇒ หกเหลี่ยมขยายตามขนาดเกลียว (AF ≈ 1.75 × ⌀เกลียว · หนา ≈ 0.94 × ⌀เกลียว)
           ระยะพิตช์: M6/M8 1.0 · M10 1.25 · 1/4" 1.27 · 5/16" 1.41 (UNC — แคตตาล็อกไม่ระบุชนิดเกลียวนิ้ว) */
const SPRING_TS01 = 100, TS01_SENSOR = 75;
const PITCH_01: Record<Ts01Spec['thread'], number> = { NONE: 1.27, '5/16': 1.41, M6: 1, M8: 1, 'M8x1.25': 1.25, M10: 1.25, 'M10x1.5': 1.5 };
/* TS_-01-0: แกนเซ็นเซอร์ ⌀5 ยาว 80 ต่อจากหูแหวน + สปริง 100 mm. (CAD · แคตตาล็อกไม่ระบุ) */
const SPRING_TS010 = 100, TS010_SENSOR = 80;

type Vec = number[];
/** จุดยึดของภาพ 2 มิติ (mm ตามแกน x) — ช่องที่รุ่นนั้นไม่มีเป็น undefined แบบต้นฉบับ */
export interface TsCableAnchors {
  tubeDia?: number; tubeLen?: number; tip: Vec; shoulder: Vec;
  threadLen?: number; threadDia?: number; threadStart?: Vec; threadEnd?: Vec; threadPoint?: Vec;
  hexLen?: number; hexAF?: number; hexEnd?: Vec;
  springLen: number; springOD: number; springStart: Vec; springEnd: Vec;
  lock?: Vec; lockStart?: Vec; extension?: number; tipSpring?: Vec; extensionStart?: Vec; extensionEnd?: Vec;
  sleeveStart?: Vec; sleeveEnd?: Vec;
  cableStart: Vec; cableEnd: Vec; braidEnd: Vec; leadEnd: Vec; leadTips: Vec[];
}
export type TsCableModel = TsCableAnchors & { parts: Part[] };

/** จุดอ้างอิงของหางสาย ใช้ร่วมกันทุกรุ่นที่ออกสาย (ต้องตรงกับ cableTail ใน tsParts.ts) */
function tailAnchors(x0: number, _cableR: number, leads: number, jacketFrom: number) {
  const split = x0 + CABLE_SHOWN + BRAID_SHOWN, end = split + TAIL_AFTER_SPLIT;
  return {
    cableStart: [jacketFrom, 0, 0],
    cableEnd: [x0 + CABLE_SHOWN, 0, 0],
    braidEnd: [split, 0, 0],
    leadEnd: [end, 0, 0],
    leadTips: Array.from({ length: leads }, (_, i) => [end, leadSpread(i, leads), 0]),
  };
}

function ts01(v: Ts01Spec): TsCableModel {
  const parts: Part[] = [], dia = Number(v.dia), tubeLen = v.tubeLen, leads = CABLE_LEADS[v.sensor];
  const th = THREADS_01[v.thread], pitch = PITCH_01[v.thread];
  const cableR = cableRadius(5), af = th.dia*1.75, nutLen = th.dia*.94;
  probe(parts, dia, tubeLen);
  threadedCylinder(parts, 'process_thread', th.len, th.dia, pitch, C.steel);
  const hexEnd = th.len + nutLen, sensorEnd = hexEnd + TS01_SENSOR, springEnd = hexEnd + SPRING_TS01;
  prism(parts, 'hex', th.len, hexEnd, af, 6, C.steel);
  revolve(parts, 'sensor_tube', [[hexEnd, 0], [hexEnd, 2.5], [sensorEnd, 2.5], [sensorEnd, 0]], C.steel, { seg: 28 });
  spring(parts, 'strain_spring', hexEnd, SPRING_TS01, 2.85, .35, C.steel, { pitch: 1.5, perTurn: 8 });
  cableTail(parts, springEnd, cableR, JACKETS[v.cable], leads, sensorEnd);
  return {
    parts,
    tubeDia: dia, tubeLen, tip: [-tubeLen, 0, 0], shoulder: [0, 0, 0],
    threadLen: th.len, threadDia: th.dia, threadStart: [0, 0, 0], threadEnd: [th.len, 0, 0],
    threadPoint: [th.len/2, th.dia/2, 0], hexLen: nutLen, hexAF: af, hexEnd: [hexEnd, 0, 0],
    springLen: SPRING_TS01, springOD: 6.4, springStart: [hexEnd, 0, 0], springEnd: [springEnd, 0, 0],
    ...tailAnchors(springEnd, cableR, leads, sensorEnd),
  };
}

function ts010(v: Ts010Spec): TsCableModel {
  const parts: Part[] = [], cableR = cableRadius(5), leads = CABLE_LEADS[v.sensor];
  const hold = HOLDS[v.hold], holdLen = hold.len;
  const ringEnd = ringTerminal(parts, 0, hold.id, holdLen, cableR);
  const sensorEnd = ringEnd + TS010_SENSOR, springEnd = ringEnd + SPRING_TS010;
  revolve(parts, 'sensor_tube', [[ringEnd, 0], [ringEnd, 2.5], [sensorEnd, 2.5], [sensorEnd, 0]], C.steel, { seg: 28 });
  spring(parts, 'strain_spring', ringEnd, SPRING_TS010, 3.0, .35, C.steel, { pitch: 1.5, perTurn: 8 });
  cableTail(parts, springEnd, cableR, JACKETS[v.cable], leads, sensorEnd);
  return {
    parts,
    tip: [0, 0, 0], shoulder: [ringEnd, 0, 0], springLen: SPRING_TS010, springOD: 6.7,
    springStart: [ringEnd, 0, 0], springEnd: [springEnd, 0, 0],
    ...tailAnchors(springEnd, cableR, leads, sensorEnd),
  };
}

function ts02(v: Ts02Spec): TsCableModel {
  const parts: Part[] = [], dia = Number(v.dia), tubeLen = v.tubeLen, r = dia/2;
  const cableR = cableRadius(dia), leads = CABLE_LEADS[v.sensor];
  probe(parts, dia, tubeLen);
  revolve(parts, 'probe_tube_covered', [[0, 0], [0, r], [SPRING_TS02, r], [SPRING_TS02, 0]], C.steel, { seg: 28 });
  /* ⚡ ระยะพิตช์ 1.0 (CAD พันชิดกว่านี้) — สปริงยาว 300 พันชิดจริงทำไฟล์ STEP โตเป็น 8 MB · ภาพยังดูเป็นสปริงละเอียด */
  spring(parts, 'cover_spring', 0, SPRING_TS02, r + .5, .25, C.steel, { pitch: 1.0, perTurn: 4 });
  bayonetLock(parts, TS02_LOCK_AT, LOCKS[v.lock].id);
  cableTail(parts, SPRING_TS02, cableR, JACKETS[v.cable], leads, SPRING_TS02);
  return {
    parts,
    tubeDia: dia, tubeLen, tip: [-tubeLen, 0, 0], shoulder: [0, 0, 0], springLen: SPRING_TS02, springOD: dia + 1.5,
    springStart: [0, 0, 0], springEnd: [SPRING_TS02, 0, 0], lock: [TS02_LOCK_AT + 8, 0, 0],
    lockStart: [TS02_LOCK_AT, 0, 0],
    ...tailAnchors(SPRING_TS02, cableR, leads, SPRING_TS02),
  };
}

function ts03(v: Ts03Spec): TsCableModel {
  const parts: Part[] = [], dia = Number(v.dia), tubeLen = v.tubeLen;
  const cableR = cableRadius(dia), leads = CABLE_LEADS[v.sensor], springLen = SPRING_TS03(dia);
  probe(parts, dia, tubeLen);
  const rel = strainRelief(parts, 0, dia, springLen, cableR);
  cableTail(parts, rel.springEnd, cableR, JACKETS[v.cable], leads, rel.cableFrom);
  return {
    parts,
    tubeDia: dia, tubeLen, tip: [-tubeLen, 0, 0], shoulder: [0, 0, 0], springLen,
    springOD: 2*(sleeveRadius(dia) + BIG_SPRING.wireR), sleeveStart: [0, 0, 0], sleeveEnd: [rel.sleeveEnd, 0, 0],
    springStart: [rel.springStart, 0, 0], springEnd: [rel.springEnd, 0, 0],
    ...tailAnchors(rel.springEnd, cableR, leads, rel.cableFrom),
  };
}

function ts05(v: Ts05Spec): TsCableModel {
  const parts: Part[] = [], dia = Number(v.dia), tubeLen = v.tubeLen, r = dia/2;
  const cableR = cableRadius(dia), leads = CABLE_LEADS[v.sensor];
  probe(parts, dia, tubeLen);
  const bare = Math.min(TS05_BARE_TIP, tubeLen*.5);
  spring(parts, 'tip_spring', -(tubeLen - bare), tubeLen - bare + 5, r + .25, .25, C.steel, { pitch: 2, perTurn: 8 });
  const lockEnd = bayonetLock(parts, 0, LOCKS[v.lock].id);
  const extEnd = lockEnd + TS05_EXTENSION;
  revolve(parts, 'extension_tube', [[lockEnd, 0], [lockEnd, r], [extEnd, r], [extEnd, 0]], C.steel, { seg: 32 });
  const rel = strainRelief(parts, extEnd, dia, SPRING_TS05, cableR);
  cableTail(parts, rel.springEnd, cableR, JACKETS[v.cable], leads, rel.cableFrom);
  return {
    parts,
    tubeDia: dia, tubeLen, tip: [-tubeLen, 0, 0], shoulder: [0, 0, 0],
    springLen: SPRING_TS05, extension: TS05_EXTENSION, lock: [8, 0, 0], lockStart: [0, 0, 0],
    springOD: 2*(sleeveRadius(dia) + BIG_SPRING.wireR), tipSpring: [-(tubeLen - bare), 0, 0],
    extensionStart: [lockEnd, 0, 0], extensionEnd: [extEnd, 0, 0],
    sleeveStart: [extEnd, 0, 0], sleeveEnd: [rel.sleeveEnd, 0, 0],
    springStart: [rel.springStart, 0, 0], springEnd: [rel.springEnd, 0, 0],
    ...tailAnchors(rel.springEnd, cableR, leads, rel.cableFrom),
  };
}

/** ตรวจตัวเลขรูปทรงก่อนสร้าง — ค่าที่ไม่ใช่ตัวเลขบวกมาถึงที่นี่ไม่ได้ (fromReading กันไว้แล้ว) ถ้ามาถึง = บั๊ก */
function assertShape(spec: TsCableSpec): void {
  if (spec.family === 'TS_-01-0') return;
  const dia = Number(spec.dia);
  if (!Number.isFinite(dia) || !(dia > 0) || !Number.isFinite(spec.tubeLen) || !(spec.tubeLen > 0))
    throw new Error(`${spec.family}: ขนาดแกน/ความยาวแกนไม่ใช่ตัวเลขบวก (${spec.dia} × ${spec.tubeLen})`);
}

/** ชิ้นส่วน + จุดยึดของหนึ่ง spec (= `buildTSModel(kind, v)` ของต้นฉบับ ไม่มี cache) */
export function tsCableBuild(spec: TsCableSpec): TsCableModel {
  assertShape(spec);
  switch (spec.family) {
    case 'TS_-01': return ts01(spec);
    case 'TS_-01-0': return ts010(spec);
    case 'TS_-02': return ts02(spec);
    case 'TS_-03': return ts03(spec);
    case 'TS_-05': return ts05(spec);
  }
}

const APPSALE = ['products/ts-series-assembly.js', 'products/ts-series-parts.js', 'products/ts-series-model.js', 'products/ts-common.js'];
const family = <S extends TsCableSpec>(id: S['family'], catalog: string, file: string): DrawingFamily<S> => ({
  id,
  source: { catalog, appsale: [file, ...APPSALE] },
  model(spec) { const parts = tsCableBuild(spec).parts; return { parts, solids: parts }; },
});

export const TS01 = family<Ts01Spec>('TS_-01', 'TS-SERIES TS_-01 หน้า 2', 'products/ts-01.js');
export const TS010 = family<Ts010Spec>('TS_-01-0', 'TS-SERIES TS_-01-0 หน้า 3', 'products/ts-03.js');
export const TS02 = family<Ts02Spec>('TS_-02', 'TS-SERIES TS_-02 หน้า 4', 'products/ts-03.js');
export const TS03 = family<Ts03Spec>('TS_-03', 'TS-SERIES TS_-03 หน้า 6', 'products/ts-03.js');
export const TS05 = family<Ts05Spec>('TS_-05', 'TS-SERIES TS_-05 หน้า 8', 'products/ts-03.js');
