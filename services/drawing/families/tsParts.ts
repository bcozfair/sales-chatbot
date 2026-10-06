// ─────────────────────────────────────────────────────────────────────────────
//  ชิ้นส่วนร่วมของซีรีส์ TS — แกนวัดปลายมน · สาย + ปลอกถักท้าย + หางปลาแฉก
//  พอร์ตจาก Appsale `products/ts-series-parts.js` + `cableRadius` ของ `ts-series-assembly.js`
//  + ตาราง `JACKETS` (สองไฟล์นั้นมีชุดเดียวกันซ้ำ — ที่นี่เหลือชุดเดียว)
//
//  ที่มาของมิติ: ส่วนท้ายสายตามไฟล์ CAD ของผู้ผลิต (`ts-01-05 step.zip` · ทุกรุ่นใช้ชิ้นชุดเดียวกัน):
//  สาย 120 → ปลอกถักท้าย 40 → ลวด ⌀1 แยก ±20° วิ่งตามแกน 14.5 → ปลอกย้ำ ⌀3 ยาว 7 → หางปลาแฉก (รู ⌀1.6)
//  · **ความยาวสายในแบบเป็นระยะวาดย่อ** สายจริงยาวเป็นเมตรตามรหัส
//
//  ทางที่ไม่ได้เลือก: ยก `head()` (หัวกะโหลกจาก CAD) มาด้วย — ต้นฉบับ import mesh ~15 MB ทั้งก้อนตั้งแต่บรรทัดแรก
//  ⇒ แยกไว้ทำพร้อมตัวแปลง mesh เป็นไบนารีในเฟส 1 · ยก `strainRelief`/`bayonetLock`/`ringTerminal`/`threadFitting`
//  และตาราง THREADS/LOCKS/HOLDS — ไม่ใช่ชิ้นของ TS_-11 (เฟส 1 พร้อมตระกูลของมัน)
// ─────────────────────────────────────────────────────────────────────────────

import type { Colour, Part } from '../types.js';
import { COLOURS as C, box, frameAt, revolve, tube, type Frame } from '../geometry/tsPrimitives.js';

/** สีปลอกสายตามชนิดสายในแคตตาล็อก (`NONE` = สแตนเลสถัก) — ชุดเดียวของซีรีส์ TS */
export const JACKETS = {
  NONE: C.braid, C: [.74, .20, .18], F: [.86, .84, .78], P: C.jacket, T: [.93, .93, .90], TS: [.86, .87, .89],
} as const satisfies Record<string, Colour>;

/** สายในไฟล์ CAD ของผู้ผลิตเป็น ⌀5 (แกน ⌀5) · แกนใหญ่กว่านั้นขยายตามแกน */
export const cableRadius = (d: string | number): number => Math.max(2.5, Number(d)/2);

/** ความยาวสปริงตามขนาดแกน (TS_-03/11 · ตาราง Diameter Tube): แกน < 5 → 50 · ≥ 5 → 130 */
export const SPRING_TS03 = (d: string | number): number => (Number(d) < 5 ? 50 : 130);

/** ระยะที่ "วาดย่อ" — สายจริงยาวเป็นเมตร */
const CABLE_SHOWN = 120, BRAID_SHOWN = 40, LEAD_SHOWN = 14.5;
const LEAD_ANGLE = 20*Math.PI/180, BARREL_LEN = 7, BARREL_R = 1.5, LUG_LEN = 10.5;

/** แกนวัด: ปลายมนตามรูปในแคตตาล็อก ยาว L1 จบที่ x = 0 */
export function probe(parts: Part[], d: string | number, l1: number, colour: Colour = C.steel, name = 'probe_tube'): void {
  const r = Number(d)/2, tip: number[][] = [];
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI/2 * i/8;
    tip.push([-l1 + r - r*Math.cos(a), r*Math.sin(a)]);
  }
  revolve(parts, name, [...tip, [0, r], [0, 0]], colour, { seg: 36 });
}

/**
 * สาย + หางปลาแฉก · leads = 2 (Thermocouple/NTC/PTC) หรือ 3 (RTD)
 * x0 = จุดเริ่มช่วงสายที่วาดย่อ · jacketFrom = จุดที่ตัวสายเริ่มจริง (มักอยู่ใต้สปริง)
 */
export function cableTail(parts: Part[], x0: number, cableR: number, jacket: Colour, leads: number, jacketFrom = x0): void {
  const runEnd = x0 + CABLE_SHOWN, split = runEnd + BRAID_SHOWN;
  revolve(parts, 'cable', [[jacketFrom, 0], [jacketFrom, cableR], [runEnd, cableR], [runEnd, 0]], jacket, { seg: 28 });
  revolve(parts, 'braid_end', [[runEnd, 0], [runEnd, cableR + .1], [split, cableR + .1], [split, 0]],
          C.braid, { seg: 28 });
  for (let i = 0; i < leads; i++) {
    const a = LEAD_ANGLE*(i - (leads-1)/2), u = [Math.cos(a), Math.sin(a), 0];
    const wireLen = LEAD_SHOWN/Math.cos(a), along = (d: number) => [split + u[0]*d, u[1]*d, 0];
    tube(parts, `lead_${i+1}`, [{ p: along(0), t: u }, { p: along(wireLen), t: u }], .5, C.wire, 8);
    const frame = frameAt(along(wireLen), u);
    revolve(parts, `lead_sleeve_${i+1}`, [[0, 0], [0, BARREL_R], [BARREL_LEN, BARREL_R], [BARREL_LEN, 0]],
            i === 0 ? C.black : C.lug, { seg: 16, frame });
    forkLug(parts, `spade_lug_${i+1}`, frameAt(along(wireLen + BARREL_LEN), u));
  }
}

/**
 * หางปลาแฉก (แคตตาล็อก "Standard หางปลาแฉก 1.5") — แผ่นบาง 0.8 วางในระนาบที่สายแยก
 * โคน 4.2 × 5 แล้วแยกเป็น 2 ขา ยาว 5.5 · ช่องกลางกว้าง 1.6 (= รูสกรู ⌀1.6 ในไฟล์ CAD)
 */
function forkLug(parts: Part[], name: string, frame: Frame): void {
  const t = .8, w = 4.2, base = 5, prong = LUG_LEN - base, gap = 1.6, pw = (w - gap)/2;
  box(parts, `${name}_base`, [base/2, 0, 0], [base, t, w], C.lug, { frame });
  for (const side of [-1, 1])
    box(parts, `${name}_prong_${side > 0 ? 'a' : 'b'}`, [base + prong/2, 0, side*(gap + pw)/2], [prong, t, pw], C.lug, { frame });
}
