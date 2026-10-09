// ─────────────────────────────────────────────────────────────────────────────
//  ภาพฉาย 2 มิติของ TS_-11 (แกนตรง) — พอร์ตจาก Appsale `products/ts-11-drawing.js` (`orthoStraight` · kind '11') ที่ `4dd2475` ทีละบรรทัด
//  ตำแหน่งทุกชิ้นมาจากจุดยึดของโมเดลตัวเดียวกับ STEP (`ts11Anchors`) · ⚠️ สายวาดย่อ — ความยาวจริงบอกด้วยตัวเลข CL1 จึงติดป้าย "ไม่ตามมาตราส่วน"
//
//  ต่างจากต้นฉบับโดยตั้งใจ: ความยาวสายที่รหัสไม่ได้บอก (`null`) พิมพ์ `-` แทน `?` ของ `fmt()` (Appsale ไม่มีค่าว่าง)
//  ⚠️ ห้ามจัดนิพจน์ใหม่ — ด่าน `diag:drawing-port` ส่วน จ เทียบ SVG ทั้งสตริงกับ `views.ortho()` ของต้นฉบับ
// ─────────────────────────────────────────────────────────────────────────────

import type { Ts11Spec } from '../types.js';
import { ts11Anchors } from '../families/ts-11.js';
import { centerH, dimHFull, dimVFull, esc, fmt, viewLabel, zoneLabel } from './draw.js';
import { braidSide, cableSide, leadWires, rodSide, springSide } from './symbols.js';
import type { OrthoBox, OrthoView } from './types.js';

const BRAIDED: Partial<Record<Ts11Spec['cable'], true>> = { NONE: true, TS: true };
/** `CABLES[].label` ของ `ts-common.js` (ป้ายโซนสาย) */
const CABLE_LABEL: Record<Ts11Spec['cable'], string> = {
  NONE: 'สแตนเลสถัก (0-350 °C)', P: 'พีวีซี (0-105 °C)', T: 'เทปล่อน (0-250 °C)', TS: 'เทปล่อนหุ้มชีลด์ (0-250 °C)',
};
/** ชื่อขั้วสายตามชนิดเซนเซอร์ (`leads` ของ `SENSORS_11`) — Thermocouple/NTC/PTC = + − · RTD = A B b */
const LEAD_LABELS: Record<Ts11Spec['sensor'], string[]> = {
  TSK: ['+', '−'], TSJ: ['+', '−'], TST: ['+', '−'], N2: ['+', '−'], N10: ['+', '−'], P2: ['+', '−'], P10: ['+', '−'],
  TSP: ['A', 'B', 'b'], TSPA: ['A', 'B', 'b'], TSZ: ['A', 'B', 'b'],
};

type Anchors = ReturnType<typeof ts11Anchors>;

/** กรอบวาด: top / bottom = ระยะเหนือ / ใต้แนวแกน (mm.) */
function frame(box: OrthoBox, left: number, right: number, top: number, bottom: number) {
  const s = Math.min(2.6, (box.w - 184)/(right - left), (box.h - 150)/(top + bottom));
  const ox = box.cx - (left + right)*s/2 + 12;
  const cy = box.cy - 14 - (bottom - top)*s/2;
  return { s, cy, X: (mm: number) => ox + mm*s };
}

/** ท้ายสาย: สปริง (ถ้ามี) → สาย (วาดย่อ) → ปลอกถักท้าย → ลวดแยก → หางปลา */
function tail(model: Anchors, spec: Ts11Spec, cy: number, s: number, X: (mm: number) => number, leads: number, compact: boolean) {
  const cableHPx = Math.max(5, model.cableR*2*s), springHPx = Math.max(8, model.springOD*s);
  const springStart = X(model.springStart[0]), springPx = model.springLen*s;
  let g = '';
  const runStart = X(model.cableStart[0]), runEnd = X(model.cableEnd[0]), splitX = X(model.braidEnd[0]);
  g += (BRAIDED[spec.cable] ? braidSide : cableSide)(runStart, cy, runEnd - runStart, cableHPx);
  if (springPx > 0) g += springSide(springStart, cy, springPx, springHPx);
  g += braidSide(runEnd, cy, splitX - runEnd, cableHPx);
  g += leadWires(splitX, cy, X(model.leadEnd[0]) - splitX, leads, LEAD_LABELS[spec.sensor]);
  if (springPx > 0) g += zoneLabel(springStart + springPx/2, cy - springHPx/2 - 12, compact ? 'สปริง' : 'สปริงกันสายหัก');
  const cableFrom = springPx > 0 ? X(model.springEnd[0]) : runStart;
  g += zoneLabel((cableFrom + runEnd)/2, cy - cableHPx/2 - 12,
                 compact ? `สาย ${esc(spec.cable === 'NONE' ? 'ถัก' : spec.cable)}` : `สาย ${esc(CABLE_LABEL[spec.cable])}`);
  return { svg: g, springStart, springPx, springHPx, cableHPx };
}

/** ภาพฉาย 2 มิติ: แกนตรง — `code` = รหัสที่พิมพ์ใต้ภาพ */
export function ts11Ortho(spec: Ts11Spec, box: OrthoBox, code: string): OrthoView {
  const model = ts11Anchors(spec);
  const leads = LEAD_LABELS[spec.sensor].length;
  const dia = model.tubeDia, r = dia/2;
  const left = model.tip[0], right = model.leadEnd[0] + 22;
  const half = Math.max(r, model.cableR + 4, model.springOD/2, 0, 9) + 12;
  const { s, cy, X } = frame(box, left, right, half, half);
  const rPx = Math.max(2, r*s);
  let g = '<g data-view="ortho">';
  g += rodSide(X(left), cy, model.tubeLen*s, rPx*2, { capL: 'round' });
  const t = tail(model, spec, cy, s, X, leads, box.w < 520);
  g += t.svg;
  g += centerH(X(left) - 14, X(model.braidEnd[0]), cy);

  /* เส้นบอกขนาด — ใส่เฉพาะค่าที่แคตตาล็อกกำหนดไว้จริง */
  const base = cy + Math.max(rPx, t.springHPx/2, 0*s) + 34;
  g += dimVFull(cy - rPx, cy + rPx, X(left) - 26, X(left), `&#8709;D1 ${fmt(dia)}`, true);
  g += dimHFull(X(left), X(0), base, cy + rPx, `L1 ${fmt(model.tubeLen)} mm.`, true);
  /* L1 สั้นจนป้ายล้นช่วงตัวเอง → สปริงลงแถว 2 และ CL1 ลงแถว 3 */
  const tight = model.tubeLen*s < 80;
  const springRow = tight ? base + 26 : base;
  if (t.springPx > 0)
    g += dimHFull(t.springStart, t.springStart + t.springPx, springRow, cy + t.springHPx/2,
                  `${fmt(model.springLen)} mm.`, true);
  const cl1From = X(0);
  g += dimHFull(cl1From, X(model.leadEnd[0]), springRow + 26, cy + t.cableHPx/2, `CL1 ${spec.cableLen === null ? '-' : fmt(spec.cableLen)} M.`, true);
  g += viewLabel(box.cx, box.cy + box.h/2 - 6, `ภาพฉาย 2 มิติ &#8212; ${esc(code || '')}`);
  g += '</g>';
  return { svg: g, scale: 'ไม่ตามมาตราส่วน' };
}
