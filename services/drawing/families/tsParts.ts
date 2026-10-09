// ─────────────────────────────────────────────────────────────────────────────
//  ชิ้นส่วนร่วมของซีรีส์ TS — แกนวัดปลายมน · สาย + ปลอกถักท้าย + หางปลาแฉก
//  พอร์ตจาก Appsale `products/ts-series-parts.js` + `cableRadius` ของ `ts-series-assembly.js`
//  + ตาราง `JACKETS` (สองไฟล์นั้นมีชุดเดียวกันซ้ำ — ที่นี่เหลือชุดเดียว)
//
//  ที่มาของมิติ: ส่วนท้ายสายตามไฟล์ CAD ของผู้ผลิต (`ts-01-05 step.zip` · ทุกรุ่นใช้ชิ้นชุดเดียวกัน):
//  สาย 120 → ปลอกถักท้าย 40 → ลวด ⌀1 แยก ±20° วิ่งตามแกน 14.5 → ปลอกย้ำ ⌀3 ยาว 7 → หางปลาแฉก (รู ⌀1.6)
//  · **ความยาวสายในแบบเป็นระยะวาดย่อ** สายจริงยาวเป็นเมตรตามรหัส
//
//  `strainRelief` · `bayonetLock` · `ringTerminal` + ตาราง LOCKS / HOLDS / SLEEVE ยกมาพร้อม TS_-01-0/02/03/05 (2026-10-09)
//  ทางที่ไม่ได้เลือก: ยก `head()` (หัวกะโหลกจาก CAD) กับ `threadFitting` มาด้วย — ต้นฉบับ import mesh ~15 MB ทั้งก้อนตั้งแต่บรรทัดแรก
//  ⇒ แยกไว้ทำพร้อมตัวแปลง mesh เป็นไบนารี (TS_-06/08)
// ─────────────────────────────────────────────────────────────────────────────

import type { Colour, Part } from '../types.js';
import { COLOURS as C, box, frameAt, prism, revolve, spring, tube, type Frame } from '../geometry/tsPrimitives.js';

/** สีปลอกสายตามชนิดสายในแคตตาล็อก (`NONE` = สแตนเลสถัก) — ชุดเดียวของซีรีส์ TS */
export const JACKETS = {
  NONE: C.braid, C: [.74, .20, .18], F: [.86, .84, .78], P: C.jacket, T: [.93, .93, .90], TS: [.86, .87, .89],
} as const satisfies Record<string, Colour>;

/** สายในไฟล์ CAD ของผู้ผลิตเป็น ⌀5 (แกน ⌀5) · แกนใหญ่กว่านั้นขยายตามแกน */
export const cableRadius = (d: string | number): number => Math.max(2.5, Number(d)/2);

/** ความยาวสปริงตามขนาดแกน (TS_-03/11 · ตาราง Diameter Tube): แกน < 5 → 50 · ≥ 5 → 130 */
export const SPRING_TS03 = (d: string | number): number => (Number(d) < 5 ? 50 : 130);

/** ระยะที่ "วาดย่อ" — สายจริงยาวเป็นเมตร (export ให้จุดยึดของภาพ 2 มิติ · `tailAnchors` ของต้นฉบับ) */
export const CABLE_SHOWN = 120, BRAID_SHOWN = 40;
const LEAD_SHOWN = 14.5;
/** ความยาวสายที่วาด (ปลอกสาย + ปลายถัก) นับจากจุดเริ่มสาย — ป้าย CL ของ annotate.ts ใช้ ⇒ ต้องตามรูปทรงจริง ห้ามใส่ตัวเลขเอง */
export const CABLE_TAIL_SHOWN = CABLE_SHOWN + BRAID_SHOWN;
const LEAD_ANGLE = 20*Math.PI/180, BARREL_LEN = 7, BARREL_R = 1.5, LUG_LEN = 10.5;
/** ระยะตามแกนจากจุดแยกสายถึงปลายหางปลา (`TAIL_AFTER_SPLIT` ของ `ts-series-parts.js`) */
export const TAIL_AFTER_SPLIT = (LEAD_SHOWN/Math.cos(LEAD_ANGLE) + BARREL_LEN + LUG_LEN)*Math.cos(LEAD_ANGLE);
/** ระยะแยกด้านข้างของปลายหางปลาเส้นที่ i (จุดยึดของภาพ) */
export const leadSpread = (i: number, leads: number): number => Math.tan(LEAD_ANGLE*(i - (leads-1)/2))*TAIL_AFTER_SPLIT;

/** เขี้ยวล็อค (TS_-02 · TS_-05) — แคตตาล็อกให้แค่ ID กับช่วงขนาดแกนที่ใช้ด้วยกันได้ */
export const LOCKS = {
  '12'  : { id: 12,   tubes: ['4', '4.8', '5', '6'] },
  '12.7': { id: 12.7, tubes: ['4', '4.8', '5', '6'] },
  '14.5': { id: 14.5, tubes: ['6', '6.35', '8'] },
  '15.5': { id: 15.5, tubes: ['6', '6.35', '8'] },
} as const;

/** Hold size ของ TS_-01-0 — `id` = รูยึด ID1 · `len` = ช่อง Length ในตาราง (ความยาวหูทั้งชิ้น) */
export const HOLDS = {
  NONE: { label: '5 mm.',        id: 5,  len: 13 },
  M4  : { label: 'M4 (4 mm.)',   id: 4,  len: 18 },
  M6  : { label: 'M6 (6 mm.)',   id: 6,  len: 17 },
  M8  : { label: 'M8 (8 mm.)',   id: 8,  len: 18 },
  M10 : { label: 'M10 (10 mm.)', id: 10, len: 12 },
} as const;

/**
 * ปลอกคอ (Sleeve) ของ TS_-03 / TS_-05 — CAD: ต่อจากแกน ⌀(D1+4) ยาว 9.5 → กรวย 24° → ⌀15 ยาว 33.7
 * แล้วมีคอ ⌀สาย ยาว 20 ยื่นเข้าไปในสปริง · ไฟล์ CAD มีแต่แกน ⌀5 ⇒ แกนใหญ่ขยายปลอกตามสัดส่วนเดิม
 */
export const SLEEVE = { step: 9.5, cone: 24, len: 33.7, stub: 20 };
export const sleeveRadius = (d: string | number): number => Math.max(7.5, Number(d)/2 + 3.5);
/** สปริงกันสายหักแบบพันชิด (TS_-03 / TS_-05) — CAD: ⌀นอก 16 · ลวด ⌀1 · ระยะพิตช์ 1.5 */
export const BIG_SPRING = { wireR: .5, pitch: 1.5 };

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

/**
 * ปลอกคอ + สปริงกันสายหัก (TS_-03 / TS_-05) — รูปทรงตาม CAD ของผู้ผลิต (ดู SLEEVE) · ความยาวสปริงเป็นค่าตามแคตตาล็อก
 */
export function strainRelief(parts: Part[], x0: number, d: string | number, springLen: number, cableR: number) {
  const r = Number(d)/2, rs = r + 2, rc = sleeveRadius(d);
  const coneLen = (rc - rs)/Math.tan(SLEEVE.cone*Math.PI/180);
  const a = x0 + SLEEVE.step, b = a + coneLen, end = b + SLEEVE.len;
  revolve(parts, 'sleeve', [[x0, 0], [x0, rs], [a, rs], [b, rc], [end, rc], [end, 0]], C.steel, { seg: 36 });
  revolve(parts, 'sleeve_stub', [[end, 0], [end, cableR], [end + SLEEVE.stub, cableR], [end + SLEEVE.stub, 0]],
          C.steel, { seg: 24 });
  spring(parts, 'strain_spring', end, springLen, rc, BIG_SPRING.wireR, C.steel,
         { pitch: BIG_SPRING.pitch, perTurn: 8 });
  return { sleeveEnd: end, springStart: end, springEnd: end + springLen, cableFrom: end + SLEEVE.stub };
}

/**
 * เขี้ยวล็อค (bayonet lock) — รูปทรงตาม CAD ของผู้ผลิต (TS-02 / TS-05): ด้านปลายแกน = ปลอก ⌀(ID+1) ยาว 10.5 มีร่องตัว J 2 ฝั่ง
 * · ด้านสาย = วงหัวจับลายเฟือง ⌀(ID+2.2) ยาว 5.5 · x0 = ขอบหน้า · CAD มีแต่ ID ~14 ⇒ ID อื่นขยายตามสัดส่วนเดิม
 * ⚠️ ร่องตัว J เป็นแผ่นสีเข้มบนผิว (ไม่ได้เจาะจริง) — รูปอ้างอิง
 */
export function bayonetLock(parts: Part[], x0: number, id: number, colour: Colour = C.brass): number {
  const r = Number(id)/2, body = 10.5, knurl = 5.5, rb = r + .5, rk = r + 1.1;
  revolve(parts, 'lock_body', [[x0, 0], [x0, rb], [x0 + body, rb], [x0 + body, 0]], colour, { seg: 36 });
  prism(parts, 'lock_knurl', x0 + body, x0 + body + knurl, rk*2*Math.cos(Math.PI/36), 36, colour);
  revolve(parts, 'lock_back', [[x0 + body + knurl, 0], [x0 + body + knurl, r*.55], [x0 + body + knurl + .5, r*.55],
                               [x0 + body + knurl + .5, 0]], colour, { seg: 24 });
  /* ร่อง J: ตามแนวแกนจากขอบหน้าลึก 6 แล้วเลี้ยวรอบวง 3.5 · กว้าง 2 */
  for (const side of [1, -1]) {
    box(parts, `lock_slot_${side > 0 ? 'a' : 'b'}`, [x0 + 3, side*(rb - .05), 0], [6, .2, 2], C.black);
    box(parts, `lock_slot_turn_${side > 0 ? 'a' : 'b'}`, [x0 + 5, side*(rb - .05), side*1.75], [2, .2, 3.5], C.black);
  }
  return x0 + body + knurl + .5;
}

/** หูแหวน (ring terminal) ของ TS_-01-0 — `id` = รูยึด ID1 · `len` = ความยาวหูตามตาราง */
export function ringTerminal(parts: Part[], x0: number, id: number, len: number, _cableR: number): number {   // ต้นฉบับรับ cableR แต่ไม่ใช้
  const hole = Number(id)/2, outer = hole + 2.5, t = 1.0, seg = 40;   // CAD: ⌀นอก 10 · รู ⌀5 · หนา 1
  /* แผ่นวงแหวนบาง: solid ปิดจากวงใน-วงนอก 2 หน้า + ผิวข้างทั้งในและนอก (ต้นฉบับประกอบเองโดยไม่ผ่าน Solid) */
  const centre = [x0 + outer, 0, 0];
  const ring: Part = { name: 'ring_terminal', colour: C.lug, positions: [], normals: [], triangles: [], edges: [] };
  const idx: number[][] = [];
  for (const z of [-t/2, t/2]) for (const rr of [hole, outer]) {
    idx.push(Array.from({ length: seg }, (_, j) => {
      const a = 2*Math.PI*j/seg;
      ring.positions.push(centre[0] + rr*Math.cos(a), centre[1] + rr*Math.sin(a), z);
      ring.normals.push(0, 0, Math.sign(z));
      return ring.positions.length/3 - 1;
    }));
  }
  const [innerBack, outerBack, innerFront, outerFront] = idx;
  for (let j = 0; j < seg; j++) {
    const k = (j+1)%seg;
    ring.triangles.push(innerBack[j], outerBack[j], outerBack[k], innerBack[j], outerBack[k], innerBack[k]);
    ring.triangles.push(innerFront[j], outerFront[k], outerFront[j], innerFront[j], innerFront[k], outerFront[k]);
    ring.triangles.push(outerBack[j], outerFront[j], outerFront[k], outerBack[j], outerFront[k], outerBack[k]);
    ring.triangles.push(innerBack[j], innerBack[k], innerFront[k], innerBack[j], innerFront[k], innerFront[j]);
  }
  parts.push(ring);
  /* คอหู + ปลอกย้ำสาย ยาวรวมเท่ากับช่อง Length ในตาราง */
  const neck = x0 + outer*2;
  box(parts, 'ring_neck', [(neck + x0 + len)/2, 0, 0], [Math.max(2, x0 + len - neck), outer*1.1, t], C.lug);
  /* ปลอกย้ำหัวมน ⌀5 (CAD) — ต่อเข้าแกนเซ็นเซอร์ ⌀5 */
  const br = 2.5, u0 = x0 + len - 4 - br, dome: number[][] = [];
  for (let i = 0; i <= 6; i++) { const a = Math.PI/2*i/6; dome.push([u0 + br - br*Math.cos(a), br*Math.sin(a)]); }
  revolve(parts, 'ring_barrel', [...dome, [x0 + len, br], [x0 + len, 0]], C.lug, { seg: 20 });
  return x0 + len;
}
