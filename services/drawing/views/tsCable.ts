// ─────────────────────────────────────────────────────────────────────────────
//  ภาพฉาย 2 มิติของ TS_-01 · TS_-01-0 · TS_-02 · TS_-03 · TS_-05 — พอร์ตจาก Appsale `products/ts-series-drawing.js` (`drawTSCable`)
//  ที่ `4dd2475` ทีละบรรทัด · ตำแหน่งทุกชิ้นมาจากจุดยึดของโมเดลตัวเดียวกับ STEP (`tsCableBuild`)
//  ⚠️ สายวาดย่อ — ความยาวจริงบอกด้วยตัวเลข CL1 จึงติดป้าย "ไม่ตามมาตราส่วน"
//
//  ต่างจากต้นฉบับโดยตั้งใจ: ความยาวสายที่รหัสไม่ได้บอก (`null`) พิมพ์ `-` แทน `?` ของ `fmt()` (Appsale ไม่มีค่าว่าง · แบบเดียวกับ TS_-11)
//  ⚠️ ห้ามจัดนิพจน์ใหม่ — ด่าน `diag:drawing-port` ส่วน จ เทียบ SVG ทั้งสตริงกับ `views.ortho()` ของต้นฉบับ
// ─────────────────────────────────────────────────────────────────────────────

import type { TsCable, TsCableSpec } from '../types.js';
import { CABLE_LEADS, tsCableBuild } from '../families/tsCable.js';
import { HOLDS, LOCKS, SLEEVE, cableRadius, sleeveRadius } from '../families/tsParts.js';
import { centerH, dimHFull, dimVFull, esc, fmt, leader, viewLabel, zoneLabel } from './draw.js';
import { braidSide, cableSide, hexSide, leadWires, rodSide, springSide, threadSide } from './symbols.js';
import type { OrthoBox, OrthoView } from './types.js';

const BRAIDED: Partial<Record<TsCable, true>> = { NONE: true, TS: true };
/** `CABLES[].label` ของ `ts-common.js` (ป้ายโซนสาย) */
export const TS_CABLE_LABEL: Record<TsCable, string> = {
  NONE: 'สแตนเลสถัก (0-350 °C)', C: 'ซิลิโคน (0-105 °C)', F: 'ไฟเบอร์กลาส (0-350 °C)',
  P: 'พีวีซี (0-105 °C)', T: 'เทปล่อน (0-250 °C)', TS: 'เทปล่อนหุ้มชีลด์ (0-250 °C)',
};
/** ชื่อขั้วสาย (`leads` ของ `SENSORS_*`) — 2 สาย = + − · RTD = A B b */
const leadLabels = (spec: TsCableSpec): string[] => (CABLE_LEADS[spec.sensor] === 3 ? ['A', 'B', 'b'] : ['+', '−']);

/* กรอบวาด: หา scale ที่พอดีกับกล่อง แล้วคืนตัวแปลง mm → px
   เว้นซ้ายมากกว่าขวา 12 px — ป้าย "∅D1 4.8" อยู่ซ้ายสุดของภาพ เคยถูกตัดเหลือ "D1 4.8" */
function frame(box: OrthoBox, left: number, right: number, halfHeight: number) {
  const s = Math.min(2.6, (box.w - 184)/(right - left), (box.h - 150)/(halfHeight*2));
  const ox = box.cx - (left + right)*s/2 + 12;
  const cy = box.cy - 14;
  return { s, cy, X: (mm: number) => ox + mm*s };
}

/** ภาพฉาย 2 มิติของรุ่นที่ออกสาย — `code` = รหัสที่พิมพ์ใต้ภาพ */
export function tsCableOrtho(spec: TsCableSpec, box: OrthoBox, code: string): OrthoView {
  const leads = CABLE_LEADS[spec.sensor];
  const model = tsCableBuild(spec);
  const dia = model.tubeDia || 0, r = dia/2;
  const cableR = cableRadius(dia || 4);
  const left = model.tip[0], right = model.leadEnd[0] + 22;
  const cableH = Math.max(5, cableR*2), springH = model.springOD || cableH + 5;
  const { s, cy, X } = frame(box, left, right, Math.max(r, cableR + 4, springH/2, 9) + 12);
  const rPx = Math.max(2, r*s), cableHPx = Math.max(5, cableH*s), springHPx = Math.max(8, springH*s);
  let g = '<g data-view="ortho">';

  if (spec.family === 'TS_-01-0') {
    /* หูแหวน: วงแหวนรูยึด ID1 + คอหู */
    const hold = HOLDS[spec.hold];
    const outer = (hold.id/2 + 2.5)*s, hole = hold.id/2*s, cx = X(0) + outer;
    g += `<circle class="part" cx="${cx}" cy="${cy}" r="${outer}"/>`;
    g += `<rect class="part" x="${cx}" y="${cy - outer*.55}" width="${X(model.shoulder[0]) - cx}" height="${outer*1.1}"/>`;
    g += `<circle class="part" cx="${cx}" cy="${cy}" r="${hole}" fill="#fff"/>`;   // รูยึดวาดทับท้ายสุด
    g += leader(cx, cy - outer, cx + 6, cy - outer - 34, `Hold ${esc(hold.label)}`, 'start');   // ต้นแบบชิดซ้าย → วางขวา
  } else {
    g += rodSide(X(left), cy, model.tubeLen!*s, rPx*2, { capL: 'round' });
  }
  if (spec.family === 'TS_-01') {
    /* เกลียว (ยาวตามตาราง) + หกเหลี่ยม — ขนาดจากโมเดล */
    g += threadSide(X(model.threadStart![0]), cy, model.threadLen!*s, model.threadDia!*s);
    g += hexSide(X(model.threadEnd![0]), cy, model.hexLen!*s, model.hexAF!*s);
  }
  if (spec.family === 'TS_-05') {
    /* สปริงเล็กบนแกนหน้าเขี้ยวล็อค (CAD: ⌀นอก D1+1 · เว้นปลายแกนเปล่า) */
    g += springSide(X(model.tipSpring![0]), cy, -model.tipSpring![0]*s, rPx*2 + s);
  }
  if (spec.family === 'TS_-02' || spec.family === 'TS_-05') {
    /* เขี้ยวล็อค (CAD): ปลอก ⌀(ID+1) ยาว 10.5 มีร่องตัว J ด้านปลายแกน + วงหัวจับ ⌀(ID+2.2) ยาว 5.5 ด้านสาย */
    const lock = LOCKS[spec.lock], bodyR = (lock.id/2 + .5)*s, knurlR = (lock.id/2 + 1.1)*s;
    const lockX = X(model.lockStart![0]), bodyW = 10.5*s, knurlW = 5.5*s;
    g += `<rect class="part" x="${lockX}" y="${cy - bodyR}" width="${bodyW}" height="${bodyR*2}"/>`;
    g += `<rect class="part" x="${lockX + bodyW}" y="${cy - knurlR}" width="${knurlW}" height="${knurlR*2}"/>`;
    g += `<path class="part" d="M ${lockX} ${cy - bodyR + 1} h ${6*s} v ${3.5*s} h ${-2*s} v ${-3.5*s + 2*s}" fill="none"/>`;
    /* ป้าย: วางซ้ายบนตามเดิม ถ้าไม่พอที่ (เขี้ยวล็อคชิดต้นแบบ) ให้วางขวาบน */
    const lx = lockX + (bodyW + knurlW)/2, label = `เขี้ยวล็อค ID ${fmt(lock.id)}`;
    const toRight = lx - 10 - label.length*6.6 < box.cx - box.w/2 + 8;
    g += leader(lx, cy - knurlR, lx + (toRight ? 10 : -10), cy - knurlR - 36, label, toRight ? 'start' : 'end');
  }
  if (spec.family === 'TS_-05')
    g += rodSide(X(model.extensionStart![0]), cy, (model.extensionEnd![0] - model.extensionStart![0])*s, rPx*2);
  if (spec.family === 'TS_-03' || spec.family === 'TS_-05') {
    /* ปลอกคอ (Sleeve · CAD): ⌀(D1+4) ยาว 9.5 → กรวย 24° → ⌀15 จนถึงต้นสปริง */
    const x0 = model.sleeveStart![0], rs = (dia/2 + 2)*s, rc = sleeveRadius(dia)*s;
    const a = X(x0 + SLEEVE.step), c = X(model.sleeveEnd![0]);
    const b = a + (rc - rs)/Math.tan(SLEEVE.cone*Math.PI/180);
    g += `<path class="part" d="M ${X(x0)} ${cy - rs} L ${a} ${cy - rs} L ${b} ${cy - rc} L ${c} ${cy - rc}
          L ${c} ${cy + rc} L ${b} ${cy + rc} L ${a} ${cy + rs} L ${X(x0)} ${cy + rs} Z"/>`;
    g += zoneLabel((X(x0) + c)/2, cy - rc - 12, 'Sleeve');
  }

  /* ท้ายสาย (CAD): สปริง → สาย (วาดย่อ) → ปลอกถักท้าย 40 → ลวดแยก → หางปลาแฉก */
  const springStart = X(model.springStart[0]), springPx = model.springLen*s;
  g += springSide(springStart, cy, springPx, springHPx);
  const runStart = X(model.springEnd[0]), runEnd = X(model.cableEnd[0]);
  g += (BRAIDED[spec.cable] ? braidSide : cableSide)(runStart, cy, runEnd - runStart, cableHPx);
  const splitX = X(model.braidEnd[0]);
  g += braidSide(runEnd, cy, splitX - runEnd, cableHPx);
  g += leadWires(splitX, cy, X(model.leadEnd[0]) - splitX, leads, leadLabels(spec));
  g += centerH(X(left) - 14, splitX, cy);

  /* เส้นบอกขนาด — ใส่เฉพาะค่าที่แคตตาล็อกกำหนดไว้จริง */
  const base = cy + Math.max(rPx, springHPx/2) + 34;
  if (spec.family !== 'TS_-01-0') {
    g += dimVFull(cy - rPx, cy + rPx, X(left) - 26, X(left), `&#8709;D1 ${fmt(dia)}`, true);
    g += dimHFull(X(left), X(model.shoulder[0]), base, cy + rPx, `L1 ${fmt(model.tubeLen!)} mm.`, true);
  }
  /* TS_-01: L1 มาตรฐานสั้นแค่ 5 mm. ป้ายล้นช่วงตัวเอง → สปริงลงแถว 2 · เกลียวลงแถว 3 */
  const springRow = spec.family === 'TS_-01' ? base + 26 : base;
  if (spec.family === 'TS_-01')
    g += dimHFull(X(model.threadStart![0]), X(model.threadEnd![0]), base + 52, cy + model.threadDia!*s/2,
                  `เกลียว ${fmt(model.threadLen!)} mm.`, true);
  if (spec.family === 'TS_-05')   // แถวที่ 2 — แถวแรกชน L1 ที่อยู่ติดกัน
    g += dimHFull(X(model.extensionStart![0]), X(model.extensionEnd![0]), base + 26, cy + rPx,
                  `${fmt(model.extension!)} mm.`, true);
  g += dimHFull(springStart, springStart + springPx, springRow, cy + springHPx/2, `${fmt(model.springLen)} mm.`, true);
  g += dimHFull(runStart, runEnd, base + 26, cy + cableHPx/2, `CL1 ${spec.cableLen === null ? '-' : fmt(spec.cableLen)} M.`, true);
  g += zoneLabel(springStart + springPx/2, cy - springHPx/2 - 12,
                 box.w < 520 ? 'สปริง' : 'สปริงกันสายหัก');
  g += zoneLabel((runStart + runEnd)/2, cy - cableHPx/2 - 12,
                 box.w < 520 ? `สาย ${esc(spec.cable === 'NONE' ? 'ถัก' : spec.cable)}` : `สาย ${esc(TS_CABLE_LABEL[spec.cable])}`);
  g += viewLabel(box.cx, box.cy + box.h/2 - 6, `ภาพฉาย 2 มิติ &#8212; ${esc(code || '')}`);
  g += '</g>';
  return { svg: g, scale: 'ไม่ตามมาตราส่วน' };
}
