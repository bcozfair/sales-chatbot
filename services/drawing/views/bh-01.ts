// ─────────────────────────────────────────────────────────────────────────────
//  ภาพฉาย 2 มิติของ BH-01 / BH-01C (ภาพหน้าตัด + ภาพด้าน) — พอร์ตจาก Appsale `products/bh-01.js` (`ortho` ใน `makeBand`) ที่ `4dd2475` ทีละบรรทัด
//
//  ⚠️ มุมขั้วไฟของภาพนี้ **ไม่ใช่** มุมเดียวกับโมเดล 3 มิติ — ต้นฉบับใช้ `termAngle()` ของ `bh-01.js` (BH-01C = 270° หลังท่อเสมอ ·
//  BH-01 ไม่ระบุ = 152° · ระบุ = 62° + ระยะตามเส้นรอบวง) ส่วนโมเดล (`bh-01-mesh.js`) วาง BH-01C ที่ 152°/332° — ยกมาตามต้นฉบับทั้งสองที่
//  ⚠️ ห้ามจัดนิพจน์ใหม่ — ด่าน `diag:drawing-port` ส่วน จ เทียบ SVG ทั้งสตริงกับ `views.ortho()` ของต้นฉบับ
// ─────────────────────────────────────────────────────────────────────────────

import type { BandSpec } from '../types.js';
import { D2R, dimH, dimV, esc, ext, fmt, scaleLabel, viewLabel } from './draw.js';
import { terminal3d } from './symbols.js';
import type { OrthoBox, OrthoView } from './types.js';

/** `TERMS` ของ `bh-01.js` — ชนิดกล่องขั้วไฟ + คำสั้นใต้ภาพด้าน */
const TERMS: Record<BandSpec['term'], { short: string; kind: string }> = {
  NONE: { short: 'ออกสาย', kind: 'wire' },
  1: { short: 'ออกสาย', kind: 'wire' },
  2: { short: 'ออกสาย', kind: 'wire' },
  3: { short: 'ออกสาย', kind: 'wire' },
  N: { short: 'ออกน็อต', kind: 'bolt' },
  PL2: { short: 'ออกปลั๊ก', kind: 'plug' },
  PL5: { short: 'ออกปลั๊ก', kind: 'plug' },
  T: { short: 'ออกเต๋า', kind: 'ceramic' },
};
const THICKNESS_DEFAULT = 4;
/** องศาของรอยผ่า ใช้ร่วมกันทุกภาพ เพื่อให้รูเจาะใน 3D กับ 2D ตรงกัน */
const SEAM = 62;

function termAngle(v: BandSpec, OD: number, split: boolean): number {
  if (split) return 270;                                     // BH-01C ขั้วอยู่บนหลังท่อเสมอ
  if (v.termPos === null || isNaN(v.termPos)) return 152;
  return SEAM + 360*v.termPos/(Math.PI*OD);
}

export function bandOrtho(v: BandSpec, box: OrthoBox): OrthoView {
  const split = v.family === 'BH-01C';
  const t = v.t > 0 ? v.t : THICKNESS_DEFAULT, OD = v.id + 2*t;
  const term = TERMS[v.term] || TERMS['NONE'];
  const circum = Math.PI*OD;
  const q = Math.min(1, box.w/760);
  const s = Math.max(0.06, Math.min(0.33*box.w/OD, (box.h-100)/Math.max(OD, v.h), 3.2));
  const Ro = OD*s/2, Ri = v.id*s/2, hh = v.h*s;
  const fcx = box.cx - box.w*0.25, fcy = box.cy;
  const scx = box.cx + box.w*0.25;
  const sL = scx-Ro, sR = scx+Ro, sT = box.cy-hh/2, sB = box.cy+hh/2;
  let g = '';

  const ringArc = (a1: number, a2: number) => {
    const pt = (r: number, a: number) => [fcx + r*Math.cos(a*D2R), fcy + r*Math.sin(a*D2R)];
    const large = (a2-a1) > 180 ? 1 : 0;
    const [x1, y1] = pt(Ro, a1), [x2, y2] = pt(Ro, a2), [x3, y3] = pt(Ri, a2), [x4, y4] = pt(Ri, a1);
    return `<path class="part" d="M ${x1} ${y1} A ${Ro} ${Ro} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${Ri} ${Ri} 0 ${large} 0 ${x4} ${y4} Z"/>`;
  };
  const gp = split ? 8 : 5;
  if (split) {
    g += ringArc(SEAM+gp, SEAM+180-gp) + ringArc(SEAM+180+gp, SEAM+360-gp);
    [SEAM, SEAM+180].forEach((a) => {
      const px = fcx + Ro*Math.cos(a*D2R), py = fcy + Ro*Math.sin(a*D2R);
      g += `<rect class="clamp" x="${px-6}" y="${py-6}" width="12" height="12" transform="rotate(${a} ${px} ${py})"/>`;
    });
  } else {
    g += ringArc(SEAM+gp, SEAM+360-gp);
    const px = fcx + Ro*Math.cos(SEAM*D2R), py = fcy + Ro*Math.sin(SEAM*D2R);
    g += `<rect class="clamp" x="${px-5}" y="${py-8}" width="10" height="16" transform="rotate(${SEAM} ${px} ${py})"/>`;
  }
  g += `<line class="center" x1="${fcx-Ro-14}" y1="${fcy}" x2="${fcx+Ro+14}" y2="${fcy}"/>
          <line class="center" x1="${fcx}" y1="${fcy-Ro-14}" x2="${fcx}" y2="${fcy+Ro+14}"/>`;

  const ta = termAngle(v, OD, split);
  const tpx = fcx + Ro*Math.cos(ta*D2R), tpy = fcy + Ro*Math.sin(ta*D2R);
  g += terminal3d(term.kind, tpx, tpy, Math.cos(ta*D2R), Math.sin(ta*D2R), s);

  g += dimH(fcx-Ri, fcx+Ri, fcy, `&#8709;ID ${fmt(v.id)}`);
  g += `<line class="lead" x1="${fcx-Ro}" y1="${fcy-Ro*0.5}" x2="${fcx-Ro-40*q}" y2="${fcy-Ro*0.5-22}"/>
          <text class="dimtx" x="${fcx-Ro-43*q}" y="${fcy-Ro*0.5-26}" text-anchor="end">T ${fmt(t)}</text>`;
  g += viewLabel(fcx, fcy+Ro+40, 'ภาพหน้าตัด');

  g += `<rect class="part" x="${sL}" y="${sT}" width="${Ro*2}" height="${hh}"/>`;
  const fold = Math.min(6, hh*0.14);
  g += `<line class="thin" x1="${sL}" y1="${sT+fold}" x2="${sR}" y2="${sT+fold}"/>
          <line class="thin" x1="${sL}" y1="${sB-fold}" x2="${sR}" y2="${sB-fold}"/>`;
  if (split) {
    g += `<rect class="clamp" x="${sL-3}" y="${sT}" width="6" height="${hh}"/>
            <rect class="clamp" x="${sR-3}" y="${sT}" width="6" height="${hh}"/>`;
  }
  const xt = scx + Ro*Math.cos(ta*D2R);
  g += terminal3d(term.kind, xt, sT, 0, -1, s);

  g += ext(sR, sT, sR+50*q+9, sT) + ext(sR, sB, sR+50*q+9, sB);
  g += dimV(sT, sB, sR+50*q, `H ${fmt(v.h)}`);
  g += ext(sL, sB, sL, sB+40) + ext(sR, sB, sR, sB+40);
  g += dimH(sL, sR, sB+32, `&#8709;OD ${fmt(OD)}`, true);

  (v.holes||[]).forEach((hl) => {
    if (!(hl.d > 0)) return;
    const a = (SEAM + 360*hl.x/circum)*D2R;
    const rr = Math.max(1.5, hl.d*s/2);
    const mx = fcx + (Ro+Ri)/2*Math.cos(a), my = fcy + (Ro+Ri)/2*Math.sin(a);
    g += `<circle class="part" cx="${mx}" cy="${my}" r="${rr}"/>`;
    const hx = scx + Ro*Math.cos(a), hy = sT + hl.y*s;
    const front = Math.sin(a) > 0;
    const rx = Math.max(1, rr*Math.abs(Math.sin(a)));
    g += `<ellipse class="${front?'part':'hidden'}" cx="${hx}" cy="${hy}" rx="${rx}" ry="${rr}"/>`;
    const sgn = hx < scx ? -1 : 1;
    g += `<line class="lead" x1="${hx}" y1="${hy-rr}" x2="${hx+22*sgn}" y2="${hy-rr-20}"/>
            <text class="dimtx" x="${hx+25*sgn}" y="${hy-rr-23}" text-anchor="${sgn<0?'end':'start'}">&#8709;${fmt(hl.d)}</text>`;
  });

  g += viewLabel(scx, sB+70, `ภาพด้าน &#8212; ${esc(term.short)}`);
  return { svg: g, scale: scaleLabel(s) };
}
