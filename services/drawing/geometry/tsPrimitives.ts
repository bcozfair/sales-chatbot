// ─────────────────────────────────────────────────────────────────────────────
//  รูปทรงพื้นฐานของซีรีส์ TS — พอร์ตจาก Appsale `products/ts-series-model.js` (คอมมิตใน README)
//
//  หน่วย mm · แกนหมุนคือแกน X · ปลายหัววัดอยู่ทาง −X · ทุกชิ้นเป็น solid ปิด
//  (STEP คิด normal จากลำดับจุด ⇒ `tri()` รับ "ทิศที่ควรหันออก" แล้วสลับลำดับจุดเองเมื่อพลิกด้าน)
//
//  **พอร์ตทีละบรรทัด ห้ามจัดนิพจน์ใหม่** — `diag:drawing-port` เทียบทุกบิตกับต้นฉบับ:
//  ห้ามเปลี่ยน `Math.hypot(...v)` เป็น sqrt · ห้ามสลับลำดับการบวก/คูณ · ห้ามย่อ `TAU*j/seg`
//  · `unit` ของไฟล์นี้หารด้วย n (`x/n`) ซึ่ง **ต่างจาก** ของ BH (`x*(1/n)`) — อย่ารวมสองชุด
//
//  ทางที่ไม่ได้เลือก:
//    · ยก `Solid` ของ Appsale มาแบบแปะเมธอดบนชิ้น — ชิ้นที่ส่งออกจากโมดูลนี้เป็นข้อมูลล้วน (`Part`)
//      ตัวสร้าง (`SolidBuilder`) อยู่แค่ระหว่างประกอบ ⇒ GLB/STEP/ด่าน ไม่ต้องรู้จักเมธอด
//    · `prism` / `threadedCylinder` ยกมาพร้อม TS_-01/02/05 (2026-10-09 · หกเหลี่ยม · วงหัวจับเขี้ยวล็อค · เกลียว)
// ─────────────────────────────────────────────────────────────────────────────

import type { Colour, Part } from '../types.js';

const TAU = Math.PI * 2;

/** สีใช้แยกวัสดุให้ดูออกในโปรแกรม CAD — ไม่ใช่สีจริงของสินค้า (ค่าเดียวกับ Appsale ทุกตัว) */
export const COLOURS = {
  steel:  [.792, .820, .933],   // SUS 304 / 316L
  alu:    [.706, .722, .749],   // หัวกะโหลกอะลูมิเนียม
  brass:  [.780, .655, .360],   // เขี้ยวล็อค / คอสาย
  jacket: [.270, .290, .320],   // สายพีวีซี / ไฟเบอร์กลาส / เทปล่อน
  braid:  [.620, .645, .685],   // สายสแตนเลสถัก
  wire:   [.680, .700, .740],   // แกนสายที่แยกออกมา
  lug:    [.800, .820, .860],   // หางปลาแฉก
  black:  [.120, .125, .135],   // ปลอกหุ้มหางปลา
} as const satisfies Record<string, Colour>;

/** กรอบพิกัด: แกน u v w + จุดกำเนิด o */
export interface Frame {
  o: number[];
  u: number[];
  v: number[];
  w: number[];
}

const IDENT: Frame = { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] };

/** กรอบพิกัด: หมุนแกน u ไปทางทิศ direction แล้วย้ายจุดกำเนิดไปที่ origin */
export function frameAt(origin: number[], direction: number[], upHint: number[] = [0, 0, 1]): Frame {
  const u = unit(direction);
  const ref = Math.abs(dot(u, upHint)) > .95 ? [0, 1, 0] : upHint;
  const w = unit(cross(u, ref)), v = unit(cross(w, u));
  return { o: origin, u, v, w };
}

const dot = (a: number[], b: number[]): number => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a: number[], b: number[]): number[] => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = (v: number[]): number[] => { const n = Math.hypot(...v) || 1; return v.map(x => x/n); };
const at = (f: Frame, u: number, v: number, w: number): number[] => [0, 1, 2].map(k => f.o[k] + u*f.u[k] + v*f.v[k] + w*f.w[k]);
const dir = (f: Frame, u: number, v: number, w: number): number[] => [0, 1, 2].map(k => u*f.u[k] + v*f.v[k] + w*f.w[k]);

/**
 * ตัวประกอบ solid หนึ่งชิ้น (= `Solid()` ของ Appsale) — เก็บจุด สามเหลี่ยม normal และเส้นขอบ
 * `part()` คืนข้อมูลล้วนตอนประกอบเสร็จ
 */
class SolidBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly triangles: number[] = [];
  readonly edges: number[] = [];

  readonly name: string;
  readonly colour: Colour;
  // ไม่ใช้ parameter property — การ์ดแอดมินคอมไพล์ไฟล์นี้ด้วย (`erasableSyntaxOnly` ของ frontend)
  constructor(name: string, colour: Colour) { this.name = name; this.colour = colour; }

  add(p: number[], n: number[]): number {
    this.positions.push(...p);
    this.normals.push(...unit(n));
    return this.positions.length/3 - 1;
  }

  tri(a: number, b: number, c: number, outward?: number[]): void {
    const P = (i: number) => this.positions.slice(i*3, i*3+3);
    const [pa, pb, pc] = [P(a), P(b), P(c)];
    const n = cross(pb.map((x, k) => x-pa[k]), pc.map((x, k) => x-pa[k]));
    if (Math.hypot(...n) < 1e-9) return;                    // สามเหลี่ยมแบน — ทิ้ง
    if (outward && dot(n, outward) < 0) this.triangles.push(a, c, b);
    else this.triangles.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number, outward?: number[]): void {
    this.tri(a, b, c, outward);
    this.tri(a, c, d, outward);
  }

  /** เส้นขอบวงกลม/รูปหลายเหลี่ยม — ภาพลายเส้นใช้วาดเส้นคมทับผิว */
  ring(ids: number[]): void {
    for (let j = 0; j < ids.length; j++) {
      const a = ids[j], b = ids[(j+1)%ids.length];
      this.edges.push(...this.positions.slice(a*3, a*3+3), ...this.positions.slice(b*3, b*3+3));
    }
  }

  part(): Part {
    return { name: this.name, colour: this.colour, positions: this.positions, normals: this.normals, triangles: this.triangles, edges: this.edges };
  }
}

/**
 * หมุนโปรไฟล์ `[[u, รัศมี], …]` รอบแกน u ของกรอบพิกัด
 * จุดที่รัศมี 0 กลายเป็นยอดแหลม · ค่าที่ 3 = ความชัน (วงแหวนนั้นถูกตัดเป็นระนาบเอียง)
 */
export function revolve(parts: Part[], name: string, profile: number[][], colour: Colour, opts: { seg?: number; frame?: Frame } = {}): void {
  const { seg = 40, frame = IDENT } = opts;
  const s = new SolidBuilder(name, colour);
  const rings = profile.filter(p => p[1] > 1e-6);
  if (rings.length < 2) return;
  const ringIds = rings.map(([u, r, slope = 0], i) => {
    const [pu, pr] = rings[Math.max(0, i-1)], [qu, qr] = rings[Math.min(rings.length-1, i+1)];
    const edge = unit([-(qr-pr), qu-pu]);                    // normal ในระนาบ (u, รัศมี)
    return Array.from({ length: seg }, (_, j) => {
      const a = TAU*j/seg, c = Math.cos(a), sn = Math.sin(a);
      return s.add(at(frame, u + slope*r*c, r*c, r*sn), dir(frame, edge[0], edge[1]*c, edge[1]*sn));
    });
  });
  for (let i = 0; i < rings.length-1; i++) {
    const [u0, r0] = rings[i], [u1, r1] = rings[i+1];
    if (Math.abs(u1-u0) < 1e-9 && Math.abs(r1-r0) < 1e-9) continue;
    // ทิศ "หันออก" ของแถบ = normal ของเส้นโปรไฟล์ ไม่ใช่แนวรัศมีเฉย ๆ
    const [nu, nr] = unit([-(r1-r0), u1-u0]);
    for (let j = 0; j < seg; j++) {
      const k = (j+1)%seg, a = TAU*(j+.5)/seg;
      const out = dir(frame, nu, nr*Math.cos(a), nr*Math.sin(a));
      s.quad(ringIds[i][j], ringIds[i][k], ringIds[i+1][k], ringIds[i+1][j], out);
    }
  }
  // เส้นขอบที่รอยหักของโปรไฟล์
  for (let i = 0; i < rings.length; i++) {
    const prev = rings[Math.max(0, i-1)], next = rings[Math.min(rings.length-1, i+1)];
    const before = unit([rings[i][0]-prev[0], rings[i][1]-prev[1], 0]);
    const after = unit([next[0]-rings[i][0], next[1]-rings[i][1], 0]);
    if (i === 0 || i === rings.length-1 || before[0]*after[0] + before[1]*after[1] < .94) s.ring(ringIds[i]);
  }

  // ปิดหัวและท้าย: ถ้าโปรไฟล์เริ่ม/จบที่รัศมี 0 จุดศูนย์กลางคือปลายแหลมนั้นเอง
  const ends: [number, number[]][] = [[0, ringIds[0]], [1, ringIds[ringIds.length-1]]];
  for (const [end, ring] of ends) {
    const edgePoint = end ? profile[profile.length-1] : profile[0];
    const ringU = end ? rings[rings.length-1][0] : rings[0][0];
    const centreU = edgePoint[1] <= 1e-6 ? edgePoint[0] : ringU;
    const out = dir(frame, end ? 1 : -1, 0, 0);
    const c = s.add(at(frame, centreU, 0, 0), out);
    for (let j = 0; j < seg; j++) s.tri(c, ring[j], ring[(j+1)%seg], out);
  }
  parts.push(s.part());
}

/** กล่องสี่เหลี่ยม — หางปลาแฉก */
export function box(parts: Part[], name: string, centre: number[], size: number[], colour: Colour, opts: { frame?: Frame } = {}): void {
  const { frame = IDENT } = opts;
  const s = new SolidBuilder(name, colour), h = size.map(x => x/2);
  const faces: [number, number][] = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  for (const [axis, sign] of faces) {
    const n = [0, 0, 0]; n[axis] = sign;
    const [a, b] = [(axis+1)%3, (axis+2)%3];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => {
      const local = [0, 0, 0];
      local[axis] = sign*h[axis]; local[a] = p*h[a]; local[b] = q*h[b];
      return s.add(at(frame, centre[0]+local[0], centre[1]+local[1], centre[2]+local[2]), dir(frame, n[0], n[1], n[2]));
    });
    s.quad(corners[0], corners[1], corners[2], corners[3], dir(frame, n[0], n[1], n[2]));
    s.ring(corners);
  }
  parts.push(s.part());
}

/** หนึ่งจุดบนเส้นทาง: ตำแหน่ง + ทิศสัมผัส */
export interface PathNode {
  p: number[];
  t: number[];
}

/** ท่อกลมวิ่งตามเส้นทางอิสระ — สปริงและสายที่แยกเส้น */
export function tube(parts: Part[], name: string, path: PathNode[], radius: number, colour: Colour, seg = 8): void {
  const s = new SolidBuilder(name, colour), rings: number[][] = [];
  path.forEach(({ p, t }) => {
    const tangent = unit(t);
    const ref = Math.abs(tangent[0]) > .9 ? [0, 1, 0] : [1, 0, 0];
    const n1 = unit(cross(tangent, ref)), n2 = unit(cross(tangent, n1));
    rings.push(Array.from({ length: seg }, (_, j) => {
      const a = TAU*j/seg, n = [0, 1, 2].map(k => n1[k]*Math.cos(a) + n2[k]*Math.sin(a));
      return s.add(p.map((x, k) => x + radius*n[k]), n);
    }));
  });
  for (let i = 0; i < rings.length-1; i++) for (let j = 0; j < seg; j++) {
    const k = (j+1)%seg;
    const out = s.positions.slice(rings[i][j]*3, rings[i][j]*3+3).map((x, m) => x - path[i].p[m]);
    s.quad(rings[i][j], rings[i][k], rings[i+1][k], rings[i+1][j], out);
  }
  const ends: [number, number[]][] = [[0, rings[0]], [1, rings[rings.length-1]]];
  for (const [end, ring] of ends) {
    const node = path[end ? path.length-1 : 0];
    const out = unit(node.t).map(x => x*(end ? 1 : -1));
    const c = s.add(node.p, out);
    for (let j = 0; j < seg; j++) s.tri(c, ring[j], ring[(j+1)%seg], out);
  }
  parts.push(s.part());
}

/** สปริง: ลวดกลมพันรอบแกนจาก u0 ยาว length */
export function spring(parts: Part[], name: string, u0: number, length: number, helixR: number, wireR: number, colour: Colour,
                       opts: { pitch?: number; perTurn?: number; frame?: Frame } = {}): void {
  const { pitch = 3.4, perTurn = 6, frame = IDENT } = opts;
  const turns = Math.max(1, length/pitch), steps = Math.max(12, Math.round(turns*perTurn)), path: PathNode[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i/steps, a = TAU*turns*t;
    path.push({ p: at(frame, u0 + length*t, helixR*Math.cos(a), helixR*Math.sin(a)),
                t: dir(frame, pitch/TAU, -helixR*Math.sin(a), helixR*Math.cos(a)) });
  }
  tube(parts, name, path, wireR, colour, 5);
}

/** แท่งเหลี่ยม (หัวหกเหลี่ยม · วงหัวจับลายเฟืองของเขี้ยวล็อค) — acrossFlats คือระยะประกบปากประแจ */
export function prism(parts: Part[], name: string, u0: number, u1: number, acrossFlats: number, sides: number, colour: Colour,
                      opts: { frame?: Frame; twist?: number } = {}): void {
  const { frame = IDENT, twist = 0 } = opts;
  const s = new SolidBuilder(name, colour), r = acrossFlats/2/Math.cos(Math.PI/sides);
  const ends = [u0, u1].map(u => Array.from({ length: sides }, (_, j) => {
    const a = TAU*j/sides + twist;
    return s.add(at(frame, u, r*Math.cos(a), r*Math.sin(a)), dir(frame, 0, Math.cos(a), Math.sin(a)));
  }));
  for (let j = 0; j < sides; j++) {
    const k = (j+1)%sides, a = TAU*(j+.5)/sides + twist;
    s.quad(ends[0][j], ends[0][k], ends[1][k], ends[1][j], dir(frame, 0, Math.cos(a), Math.sin(a)));
    s.edges.push(...s.positions.slice(ends[0][j]*3, ends[0][j]*3+3), ...s.positions.slice(ends[1][j]*3, ends[1][j]*3+3));
  }
  ends.forEach(ring => s.ring(ring));
  const caps: [number, number[]][] = [[0, ends[0]], [1, ends[1]]];
  for (const [end, ring] of caps) {
    const out = dir(frame, end ? 1 : -1, 0, 0);
    const c = s.add(at(frame, end ? u1 : u0, 0, 0), out);
    for (let j = 0; j < sides; j++) s.tri(c, ring[j], ring[(j+1)%sides], out);
  }
  parts.push(s.part());
}

/**
 * ผิวเกลียวขวาแบบปิด — ร่องเกลียวเป็นรูปทรงจริง (ลง STEP ด้วย) · pitch หน่วย mm · taper = รัศมีที่โตต่อ 1 mm ตามแกน (NPT: 1/32)
 * หน้าตัด V ตัดยอด + ช่วงหมดเกลียวเป็นรูปอ้างอิง ไม่ใช่พิกัดผลิต (คำของต้นฉบับ)
 */
export function threadedCylinder(parts: Part[], name: string, length: number, diameter: number, pitch: number, colour: Colour, taper = 0): void {
  const s = new SolidBuilder(name, colour), seg = 64, steps = Math.ceil(length/pitch*24);
  const depth = pitch*.6, fade = Math.min(pitch*.65, length/4);
  const radius = (x: number, a: number): number => {
    const phase = ((x/pitch - a/TAU)%1 + 1)%1;
    const groove = Math.max(0, Math.min(1, (Math.abs(phase-.5)-.08)/.34));
    const runout = Math.min(1, x/fade, (length-x)/fade);
    const chamfer = Math.max(0, 1-x/fade)*depth*.5;
    return diameter/2 - (length-x)*taper - depth*groove*runout - chamfer;
  };
  const point = (x: number, a: number): number[] => { const r = radius(x, a); return [x, r*Math.cos(a), r*Math.sin(a)]; };
  const rings: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const x = length*i/steps;
    rings.push(Array.from({ length: seg }, (_, j) => {
      const a = TAU*j/seg, r = radius(x, a), e = .0001;
      const dx = (radius(Math.min(length, x+e), a)-radius(Math.max(0, x-e), a))/(Math.min(length, x+e)-Math.max(0, x-e));
      const da = (radius(x, a+e)-radius(x, a-e))/(2*e);
      return s.add(point(x, a), [-r*dx, r*Math.cos(a)+da*Math.sin(a), r*Math.sin(a)-da*Math.cos(a)]);
    }));
  }
  for (let i = 0; i < steps; i++) for (let j = 0; j < seg; j++) {
    const k = (j+1)%seg, a = TAU*(j+.5)/seg;
    s.quad(rings[i][j], rings[i][k], rings[i+1][k], rings[i+1][j], [0, Math.cos(a), Math.sin(a)]);
  }
  for (const end of [0, 1]) {
    const out = [end ? 1 : -1, 0, 0], ring = rings[end ? steps : 0];
    // ฝาปิดมี normal ของตัวเอง ⇒ ขอบบ่าคม · พิกัดยังเชื่อมกันใน CAD
    const cap = ring.map(id => s.add(s.positions.slice(id*3, id*3+3), out));
    const c = s.add([end ? length : 0, 0, 0], out);
    for (let j = 0; j < seg; j++) s.tri(c, cap[j], cap[(j+1)%seg], out);
    s.ring(cap);
  }
  // เส้นยอดเกลียวสองขอบตามแนวเกลียว — ภาพลายเส้น
  for (const phase of [.42, .58]) for (let turn = -1; turn < length/pitch; turn++) {
    let prev: number[] | null = null;
    for (let j = 0; j <= seg; j++) {
      const a = TAU*j/seg, x = pitch*(turn+j/seg+phase);
      if (x < fade || x > length-fade) { prev = null; continue; }
      const p = point(x, a);
      if (prev) s.edges.push(...prev, ...p);
      prev = p;
    }
  }
  parts.push(s.part());
}
