// ─────────────────────────────────────────────────────────────────────────────
//  BH-01 / BH-01C — Band Heater ชิ้นเดียว / ผ่าครึ่ง 2 ชิ้น
//  ที่มา: แคตตาล็อก Primus BH-01/BH-01C หน้า 2–3 · พอร์ตจาก Appsale `products/bh-01-mesh.js` (`buildBandMesh`)
//  + `weldSolid` ของ `engine/step.js` (ทาง seal = false แบบที่ `products/bh-01.js` `modelParts` ใช้)
//
//  รูปทรง: แถบโลหะ ID × H หนา T (แคตตาล็อก "ความหนา T Standard 4 mm.") ม้วนเป็นวงแหวน เว้นรอยผ่าที่ 62°
//  (BH-01C = สองซีก หมุนทั้งชิ้น 40° ให้เห็นรอยผ่า) · แถบรัด + น็อตยึดที่รอยผ่า · ขั้วไฟตามรหัส
//  (สาย 30 cm / 1 / 2 / 3 M · น็อต N · เต๋าเซรามิก T · ปลั๊ก PL2 / PL5) · รูเจาะตัดผ่านแถบจริงเมื่อมี
//  ⚠️ รูปอ้างอิง: แถบรัด น็อต และขั้วไฟเป็นรูปทรงประมาณ (ไม่มีไฟล์ CAD ผู้ผลิต) · ID/H/T เป็นขนาดตามรหัส
//  · **ตำแหน่งขั้วไฟ 152° (BH-01) เป็นค่าอ้างอิงของ Appsale ไม่ได้มาจากแคตตาล็อก** — `termPos: null` = ค่านี้
//
//  ชุดฟังก์ชันเวกเตอร์ (`add`/`mul`/`unit`…) อยู่ในไฟล์นี้แบบต้นฉบับ — `unit` ของ BH คูณด้วย `1/n`
//  ซึ่งได้บิตไม่เท่ากับ `x/n` ของซีรีส์ TS ⇒ **ห้ามรวมกับ geometry/tsPrimitives.ts** (diag:drawing-port จะล้ม)
//  · ตัวประกอบชิ้น (`BandPart`) เก็บจุดใน "พื้นที่ของโมเดล" แล้วแปลงเป็น "พื้นที่โลก" ตอนเก็บ (`world()` หมุน BH-01C)
//
//  ทางที่ไม่ได้เลือก:
//    · เรียงตำแหน่งรูเจาะเอง — หน้าคำนวณราคารู้แค่ "กี่รู × ขนาดเท่าไหร่" ไม่รู้ตำแหน่ง ⇒ spec จากผลอ่านรหัส
//      ไม่มีรูเสมอ (`holes: []`) และ checks.ts ปิดการส่งให้ลูกค้าเมื่อรหัสมีรู (PM เคาะเฟส 0) · ตัวสร้างยังรับรู
//      พร้อมตำแหน่งได้ครบแบบต้นฉบับ (ด่าน port ครอบ) เผื่อเฟสที่มีช่องกรอกตำแหน่ง
//    · ทาง `seal` ของ weldSolid (ปิดรอยแยกระหว่างหน้า CAD) — BH-01 ไม่ใช้ (ของ TS-10)
// ─────────────────────────────────────────────────────────────────────────────

import type { BandSpec, Colour, DrawingFamily, DrawingModel, Part, StepSolid } from '../types.js';

const PI = Math.PI, TAU = 2*PI, SEAM = 62*PI/180;
const metal: Colour = [.81, .83, .86], zinc: Colour = [.74, .77, .8], ceramic: Colour = [.94, .92, .84],
      dark: Colour = [.25, .28, .31], wireGrey: Colour = [.47, .49, .51];
const add = (a: number[], b: number[]): number[] => a.map((v, i) => v+b[i]);
const mul = (v: number[], s: number): number[] => v.map(x => x*s);
const sub = (a: number[], b: number[]): number[] => a.map((v, i) => v-b[i]);
const dot = (a: number[], b: number[]): number => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a: number[], b: number[]): number[] => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = (v: number[]): number[] => mul(v, 1/(Math.hypot(...v)||1));

interface Hole { x: number; y: number; r: number }

/** ตัวประกอบชิ้น (= `Part()` ของต้นฉบับ) — `toPart()` คืนข้อมูลล้วน */
class BandPart {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly triangles: number[] = [];
  readonly edges: number[] = [];

  constructor(readonly name: string, readonly colour: Colour, private readonly world: (p: number[]) => number[]) {}

  vertex(p: number[], n: number[]): number {
    this.positions.push(...this.world(p));
    this.normals.push(...this.world(unit(n)));
    return this.positions.length/3-1;
  }

  face(points: number[][], normals: number[][] | null = null): void {
    const normal = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])));
    const ids = points.map((p, i) => this.vertex(p, normals ? normals[i] : normal));
    for (let i = 1; i < ids.length-1; i++) this.triangles.push(ids[0], ids[i], ids[i+1]);
  }

  edge(a: number[], b: number[]): void {
    this.edges.push(...this.world(a), ...this.world(b));
  }

  toPart(): Part {
    return { name: this.name, colour: this.colour, positions: this.positions, normals: this.normals, triangles: this.triangles, edges: this.edges };
  }
}

/** ชิ้นทั้งหมดของแถบฮีตเตอร์ (= `buildBandMesh(v, split).parts` ของต้นฉบับ) */
function buildBand(spec: BandSpec): Part[] {
  const split = spec.family === 'BH-01C';
  for (const [k, x] of [['ID', spec.id], ['H', spec.h], ['T', spec.t]] as const)
    if (!Number.isFinite(x) || !(x > 0)) throw new Error(`${spec.family}: ${k} ไม่ใช่ตัวเลขบวก (${x})`);
  // ต้นฉบับ: Math.max(1, Number(v.id)||25) — type บังคับเป็นตัวเลขบวกแล้ว (ตรวจข้างบน) จึงเหลือ Math.max ซึ่งต้องคงไว้ให้บิตเท่าเดิม
  const ri = Math.max(1, spec.id)/2, t = Math.max(.5, spec.t), ro = ri+t;
  const h = Math.max(1, spec.h), circum = TAU*ro;
  const shellColour = spec.mat === 'Z' ? zinc : metal;
  const rotation = 40*PI/180;
  const world = (p: number[]): number[] => split ? [Math.cos(rotation)*p[1]+Math.sin(rotation)*p[0], p[2], -Math.sin(rotation)*p[1]+Math.cos(rotation)*p[0]] : p;
  const ring = (radius: number, a: number, y: number): number[] => [radius*Math.cos(a), y, radius*Math.sin(a)];
  const builders: BandPart[] = [];

  /** ชิ้นใหม่ — ลำดับชิ้นคือลำดับที่สร้าง (ต้นฉบับ push ตอนสร้าง ก่อนเติมจุด) */
  function Part(name: string, colour: Colour): BandPart {
    const part = new BandPart(name, colour, world);
    builders.push(part);
    return part;
  }
  function box(name: string, center: number[], u: number[], w: number[], n: number[], size: number[], colour: Colour): void {
    const part = Part(name, colour), vertices: number[][] = [];
    for (const z of [-1, 1]) for (const y of [-1, 1]) for (const x of [-1, 1]) vertices.push(add(center, add(mul(u, x*size[0]/2), add(mul(w, y*size[1]/2), mul(n, z*size[2]/2)))));
    for (const ids of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) part.face(ids.map(i => vertices[i]));
    for (const [a, b] of [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) part.edge(vertices[a], vertices[b]);
  }
  function cylinder(name: string, start: number[], end: number[], radius: number, colour: Colour = metal, segments = 20): void {
    const part = Part(name, colour), axis = unit(sub(end, start));
    const u = unit(cross(axis, Math.abs(axis[1]) < .9 ? [0, 1, 0] : [1, 0, 0])), w = cross(axis, u);
    const radial = (a: number) => add(mul(u, Math.cos(a)), mul(w, Math.sin(a)));
    for (let i = 0; i < segments; i++) {
      const a = radial(TAU*i/segments), b = radial(TAU*(i+1)/segments);
      const p = add(start, mul(a, radius)), q = add(start, mul(b, radius)), r = add(end, mul(b, radius)), s = add(end, mul(a, radius));
      part.face([p, q, r, s], [a, b, b, a]); part.face([start, q, p]); part.face([end, s, r]);
      part.edge(p, q); part.edge(r, s);
    }
  }
  /** ลวดกลมกวาดตามเส้นทาง — กรอบเลื่อนขนาน (parallel transport) ไม่ให้บิด */
  function wire(name: string, path: { p: number[]; t: number[] }[], radius: number, colour: Colour, segments = 10): void {
    const part = Part(name, colour), rings: { p: number[]; n: number[] }[][] = [];
    let normal: number[] | null = null;
    path.forEach(({ p, t }) => {
      const tangent = unit(t);
      if (!normal) normal = unit(cross(tangent, Math.abs(tangent[1]) < .9 ? [0, 1, 0] : [1, 0, 0]));
      else normal = unit(sub(normal, mul(tangent, dot(normal, tangent))));
      const binormal = cross(tangent, normal);
      const nrm = normal;
      rings.push(Array.from({ length: segments }, (_, j) => {
        const a = TAU*j/segments, n = add(mul(nrm, Math.cos(a)), mul(binormal, Math.sin(a)));
        return { p: add(p, mul(n, radius)), n };
      }));
    });
    for (let i = 0; i < rings.length-1; i++) for (let j = 0; j < segments; j++) {
      const k = (j+1)%segments, A = rings[i][j], B = rings[i][k], C = rings[i+1][k], D = rings[i+1][j];
      part.face([A.p, B.p, C.p, D.p], [A.n, B.n, C.n, D.n]);
    }
    for (const [index, sign] of [[0, -1], [rings.length-1, 1]]) {
      const centre = path[index].p, rim = rings[index].map(x => x.p);
      for (let j = 0; j < segments; j++) {
        const a = rim[j], b = rim[(j+1)%segments];
        part.face(sign < 0 ? [centre, b, a] : [centre, a, b]);
      }
    }
  }

  const holes: Hole[] = spec.holes.filter(q => Number(q.d) > 0 && Number.isFinite(Number(q.x)) && Number.isFinite(Number(q.y)))
    .map(q => ({ x: ((Number(q.x)%circum)+circum)%circum, y: split ? -h/2+Number(q.y) : h/2-Number(q.y), r: Number(q.d)/2 }));
  // รูที่คร่อมรอยผ่าต้องตัดกับสำเนาข้างเคียงด้วย
  const gap = Math.min(.06, 1.2/ro), pieces = split ? 2 : 1;
  const seams = Array.from({ length: pieces }, (_, k) => [ro*(k*TAU/pieces+gap), ro*((k+1)*TAU/pieces-gap)]).flat();
  const clipHoles: Hole[] = holes.flatMap(q => [{ ...q }, { ...q, x: q.x-circum }, { ...q, x: q.x+circum }]);
  // ขอบรูที่แค่แตะขอบ/รูอื่น จะบีบ solid เหลือจุดเดียว — ขยายทะลุไม่กี่ไมครอนให้ผิวยังเป็น manifold
  const touches = (d: number, r: number) => Math.abs(d-r) < 1e-3;
  clipHoles.forEach((q, k) => {
    if ([-h/2, h/2].some(y => touches(Math.abs(q.y-y), q.r)) || seams.some(u => touches(Math.abs(q.x-u), q.r)) ||
       clipHoles.some((o, m) => m !== k && touches(Math.hypot(o.x-q.x, o.y-q.y), o.r+q.r))) q.r += 2e-3;
  });
  /** ตัดวงกลมออกจากรูปหลายเหลี่ยมเล็ก ๆ ในพื้นที่คลี่ (เส้นรอบวง, H) — คำนวณจุดตัดจากปลายเดียวกันของขอบเสมอ */
  function clipHole(poly: number[][], hole: Hole): number[][] {
    const result: number[][] = [];
    const signed = (p: number[]) => (p[0]-hole.x)**2+(p[1]-hole.y)**2-hole.r**2;
    const crossing = (a: number[], b: number[]): number[] | null => {
      const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? [a, b] : [b, a];
      const dx = q[0]-p[0], dy = q[1]-p[1], ax = p[0]-hole.x, ay = p[1]-hole.y;
      const A = dx*dx+dy*dy, B = 2*(ax*dx+ay*dy), C = signed(p);
      const root = Math.sqrt(Math.max(0, B*B-4*A*C));
      const f = [(-B-root)/(2*A), (-B+root)/(2*A)].find(f => f >= -1e-9 && f <= 1+1e-9);
      if (f === undefined) return null;
      const x = [p[0]+f*dx, p[1]+f*dy];
      // ขอบรูที่ผ่านมุมของกริดพอดี — ดูดเข้ามุมนั้น (ไม่เหลือเศษบางเป็นเส้นผม)
      return [p, q].find(e => Math.hypot(e[0]-x[0], e[1]-x[1]) < 1e-4) || x;
    };
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i+1)%poly.length], sa = signed(a), sb = signed(b);
      if (sa >= 0) result.push(a);
      if ((sa >= 0) !== (sb >= 0)) { const x = crossing(a, b); if (x) result.push(x); }
    }
    return result;
  }
  /** จุดแบ่งกริด: หยาบรอบวง ละเอียดเฉพาะตรงรู — กริดแบบผลคูณ ⇒ ช่องข้างเคียงใช้มุมร่วมกันเสมอ */
  function breaks(from: number, to: number, coarse: number, fine: number[][]): number[] {
    const list: number[] = [];
    for (let i = 0; i <= coarse; i++) list.push(from+(to-from)*i/coarse);
    for (const [centre, radius, step] of fine) {
      const n = Math.ceil((2*radius+2*step)/step);
      for (let i = 0; i <= n; i++) { const x = centre-radius-step+i*step; if (x > from && x < to) list.push(x); }
    }
    list.sort((a, b) => a-b);
    return list.filter((x, i) => i === 0 || x-list[i-1] > 1e-6);
  }
  const holeStep = (q: Hole) => Math.max(.5, q.r/2);
  const coarse = 160;
  const yBreaks = breaks(-h/2, h/2, 1, holes.map(q => [q.y, q.r, holeStep(q)]));

  for (let piece = 0; piece < pieces; piece++) {
    const a0 = piece*TAU/pieces+gap, a1 = (piece+1)*TAU/pieces-gap;
    const part = Part(pieces > 1 ? `band_half_${piece+1}` : 'band_shell', shellColour);
    const uBreaks = breaks(ro*a0, ro*a1, Math.ceil(coarse/pieces), clipHoles.map(q => [q.x, q.r, holeStep(q)]));
    // แบ่งสามเหลี่ยมบนผิวแถบ (คลี่เป็น 2 มิติ) หักรูออก
    const points: number[][] = [], ids = new Map<string, number>(), tris: number[][] = [];
    const id = (p: number[]): number => { const k = Math.round(p[0]*1e7)+','+Math.round(p[1]*1e7); if (!ids.has(k)) { ids.set(k, points.length); points.push(p); } return ids.get(k) as number; };
    const area2 = (a: number[], b: number[], c: number[]) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    for (let i = 0; i < uBreaks.length-1; i++) {
      const u0 = uBreaks[i], u1 = uBreaks[i+1];
      for (let j = 0; j < yBreaks.length-1; j++) {
        const y0 = yBreaks[j], y1 = yBreaks[j+1];
        for (const tri of [[[u0, y0], [u1, y0], [u1, y1]], [[u0, y0], [u1, y1], [u0, y1]]]) {
          let polygon = tri;
          for (const hole of clipHoles) {
            if (hole.x+hole.r < u0 || hole.x-hole.r > u1 || hole.y+hole.r < y0 || hole.y-hole.r > y1) continue;
            polygon = clipHole(polygon, hole); if (polygon.length < 3) break;
          }
          if (polygon.length < 3) continue;
          // ear clipping ใช้จุดขอบของรูปหลายเหลี่ยมเอง (ไม่มี T-junction)
          const loop = polygon.map(p => id(p)).filter((x, k, all) => x !== all[(k+1)%all.length]);
          while (loop.length >= 3) {
            let best = -1, score = -Infinity;
            for (let k = 0; k < loop.length; k++) {
              const a = points[loop[(k+loop.length-1)%loop.length]], b = points[loop[k]], c = points[loop[(k+1)%loop.length]];
              const s = area2(a, b, c); if (s > score) { score = s; best = k; }
            }
            if (score <= 1e-10) break;
            tris.push([loop[(best+loop.length-1)%loop.length], loop[best], loop[(best+1)%loop.length]]);
            loop.splice(best, 1);
          }
        }
      }
    }
    const surface = (p: number[], radius: number) => ring(radius, SEAM+p[0]/ro, p[1]);
    const radial = (p: number[]) => ring(1, SEAM+p[0]/ro, 0);
    const outer = points.map(p => part.vertex(surface(p, ro), radial(p)));
    const inner = points.map(p => part.vertex(surface(p, ri), mul(radial(p), -1)));
    // CCW ใน (u, y) หันเข้าแกนเมื่อม้วนแล้ว ⇒ ผิวนอกกลับลำดับ
    for (const [a, b, c] of tris) part.triangles.push(outer[a], outer[c], outer[b], inner[a], inner[b], inner[c]);
    // ขอบเปิดทุกเส้นของผิว 2 มิติ (บน ล่าง รอยผ่า ขอบรู) กลายเป็นผนัง
    const count = new Map<string, number>();
    for (const tri of tris) for (let k = 0; k < 3; k++) { const a = tri[k], b = tri[(k+1)%3], e = a < b ? a+'_'+b : b+'_'+a; count.set(e, (count.get(e) || 0)+1); }
    const boundary: [number, number][] = [];
    for (const tri of tris) for (let k = 0; k < 3; k++) { const a = tri[k], b = tri[(k+1)%3]; if (count.get(a < b ? a+'_'+b : b+'_'+a) === 1) boundary.push([a, b]); }
    const nextOf = new Map(boundary.map(([a, b]) => [a, b]));
    for (const [a, b] of boundary) {
      part.face([surface(points[a], ro), surface(points[b], ro), surface(points[b], ri), surface(points[a], ri)]);
      part.edge(surface(points[a], ro), surface(points[b], ro)); part.edge(surface(points[a], ri), surface(points[b], ri));
      const c = nextOf.get(b);
      if (c !== undefined) {
        const d0 = unit(sub(points[b], points[a])), d1 = unit(sub(points[c], points[b]));
        if (d0[0]*d1[0]+d0[1]*d1[1] < .7) part.edge(surface(points[b], ro), surface(points[b], ri));
      }
    }
  }
  // แถบรัดและน็อตยึดที่รอยผ่าแต่ละรอย (รูปอ้างอิง)
  for (let seam = 0; seam < pieces; seam++) {
    const a = SEAM+seam*TAU/pieces, radial = ring(1, a, 0), tangent = [-Math.sin(a), 0, Math.cos(a)], axial = [0, 1, 0];
    for (const side of [-1, 1]) box(`clamp_bar_${seam+1}${side < 0 ? 'a' : 'b'}`, add(mul(radial, ro+2), mul(tangent, side*4)), tangent, axial, radial, [3, h*.82, 4], shellColour);
    (h < 80 ? [-.3, .3] : [-.35, 0, .35]).forEach((f, k) => {
      const center = add(mul(radial, ro+3), [0, h*f, 0]);
      cylinder(`clamp_bolt_${seam+1}_${k+1}`, add(center, mul(tangent, -7)), add(center, mul(tangent, 7)), 1.7);
      cylinder(`clamp_nut_${seam+1}_${k+1}`, add(center, mul(tangent, 5)), add(center, mul(tangent, 8)), 3, metal, 6);
    });
  }
  // ขั้วไฟ — BH-01C มีสองชุดที่ 152° / 332° · BH-01 ชุดเดียวที่ 152° (ค่าอ้างอิงของ Appsale) หรือตาม termPos
  const termPos = spec.termPos;
  const terminalAngles = split ? [152*PI/180, 332*PI/180] : [(termPos === null ? 152*PI/180 : SEAM+Number(termPos)/ro)];
  terminalAngles.forEach((a, index) => {
    const tag = terminalAngles.length > 1 ? `_${index+1}` : '';
    const n = ring(1, a, 0), u = [-Math.sin(a), 0, Math.cos(a)], w = [0, 1, 0];
    const axial = split && termPos !== null ? Math.max(-h/2, Math.min(h/2, -h/2+Number(termPos))) : 0;
    const p = (x: number, y: number, z: number) => add(mul(n, ro+z), add(mul(u, x), [0, axial+y, 0]));
    const factor = Math.min(1, h/30, ro/22);
    const block = (name: string, x: number, y: number, z: number, size: number[], colour: Colour) => box(name+tag, p(x*factor, y*factor, z*factor), u, w, n, size.map(x => x*factor), colour);
    const pin = (name: string, x: number, y: number, z: number, len: number, r: number, colour: Colour, segments = 20) =>
      cylinder(name+tag, p(x*factor, y*factor, z*factor), p(x*factor, y*factor, (z+len)*factor), r*factor, colour, segments);
    block('terminal_base', 0, 0, 1, [23, 17, 2], metal);
    if (spec.term === 'N') {
      [-7, 7].forEach((x, k) => { const s = `_${k+1}`; pin('insulator'+s, x, 0, 2, 3, 5, ceramic); pin('stud'+s, x, 0, 5, 10, 2.4, metal); pin('nut'+s, x, 0, 10, 3, 4, metal, 6); });
    } else if (spec.term === 'T') {
      block('ceramic_block', 0, 0, 7, [19, 19, 12], ceramic);
      let k = 0; for (const x of [-5, 5]) for (const y of [-5, 5]) pin(`screw_${++k}`, x, y, 13, .5, 2.1, dark);
    } else if (spec.term === 'PL2' || spec.term === 'PL5') {
      const large = spec.term === 'PL5'; block(large ? 'plug_body_PL5' : 'plug_body_PL2', 0, 0, 9, [large ? 25 : 20, 19, 16], large ? dark : ceramic);
      [-5, 5].forEach((x, k) => pin(`plug_pin_${k+1}`, x, 0, 17, large ? .5 : 7, large ? 2.2 : 1.7, large ? dark : metal));
      if (large) { block('plug_cap', 0, 0, 17, [25, 19, 1], metal); [-5, 5].forEach((x, k) => pin(`plug_socket_${k+1}`, x, 0, 17.5, .5, 2.2, dark)); }
    } else {
      // ออกสาย (30 cm / 1 / 2 / 3 M) — สายวาดย่อ
      block('ceramic_bush', 0, 0, 5, [14, 13, 8], ceramic);
      [-3, 3].forEach((x, k) => {
        const at = (q: number) => p((x+q*10)*factor, q*q*28*factor, (9+q*26)*factor);
        const along = (q: number) => add(mul(u, 10*factor), add(mul(w, 2*q*28*factor), mul(n, 26*factor)));
        wire(`lead_wire_${k+1}${tag}`, Array.from({ length: 13 }, (_, i) => ({ p: at(i/12), t: along(i/12) })), 1.1*factor, wireGrey, 10);
      });
    }
  });
  return builders.map(b => b.toPart());
}

/**
 * รวมจุดที่ตรงกัน (ความคลาดเคลื่อน 1e-5 mm) · ทิ้งสามเหลี่ยมที่พื้นที่เป็นศูนย์ · หันผิวออกด้วยปริมาตรมีเครื่องหมาย
 * ⇒ ชิ้นเข้า STEP ได้เป็น solid ปิดหนึ่งชิ้น (= `weldSolid(part)` ของต้นฉบับ ทาง seal = false) · ไม่แก้ชิ้นที่รับมา
 */
function weldSolid(part: Part, tol = 1e-5): StepSolid {
  const points: number[][] = [], ids = new Map<string, number>(), map: number[] = [];
  for (let i = 0; i < part.positions.length; i += 3) {
    const key = [0, 1, 2].map(k => Math.round(part.positions[i+k]/tol)).join(',');
    if (!ids.has(key)) { ids.set(key, points.length); points.push(part.positions.slice(i, i+3)); }
    map.push(ids.get(key) as number);
  }
  const area = (a: number, b: number, c: number) => Math.hypot(...cross(sub(points[b], points[a]), sub(points[c], points[a])));
  const tris: number[][] = [];
  for (let i = 0; i < part.triangles.length; i += 3) {
    const t = part.triangles.slice(i, i+3).map(j => map[j]);
    if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2] && area(t[0], t[1], t[2]) > 1e-12) tris.push(t);
  }
  let volume = 0;
  for (const [a, b, c] of tris) {
    const [p, q, r] = [points[a], points[b], points[c]];
    volume += p[0]*(q[1]*r[2]-q[2]*r[1]) - p[1]*(q[0]*r[2]-q[2]*r[0]) + p[2]*(q[0]*r[1]-q[1]*r[0]);
  }
  const triangles = volume < 0 ? tris.flatMap(([a, b, c]) => [a, c, b]) : tris.flat();
  return { name: part.name, colour: part.colour, positions: points.flat(), triangles };
}

/** โมเดลชุดเดียว: GLB ใช้ชิ้นดิบ (มี normal) · STEP ใช้ชิ้นที่รวมจุดแล้ว (แบบ `modelParts` ของต้นฉบับ) */
function bandModel(spec: BandSpec): DrawingModel {
  const parts = buildBand(spec);
  return { parts, solids: parts.map(part => weldSolid(part)) };
}

const SOURCE = { catalog: 'BH-01/BH-01C หน้า 2-3 (ความหนา T Standard 4 mm.)', appsale: ['products/bh-01-mesh.js', 'products/bh-01.js', 'engine/step.js'] };

export const BH01: DrawingFamily<Extract<BandSpec, { family: 'BH-01' }>> = { id: 'BH-01', source: SOURCE, model: bandModel };
export const BH01C: DrawingFamily<Extract<BandSpec, { family: 'BH-01C' }>> = { id: 'BH-01C', source: SOURCE, model: bandModel };
