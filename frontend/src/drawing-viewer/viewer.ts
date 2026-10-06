// ─────────────────────────────────────────────────────────────────────────────
//  ตัวดูแบบ 3 มิติชุดเดียว (docs/plan-product-drawing-3d.md §4.6–4.7) — การ์ดแอดมินใช้วันนี้ · หน้าลูกค้าและภาพในกระดาษแบบใช้ตัวนี้ในเฟสถัดไป
//
//  **ไม่มี React ในไฟล์นี้** (หน้าลูกค้าเป็น Vite + TS ไม่มี React — หัวหน้าเคาะ §4.6) · รับ GLB + ป้ายต่อตระกูล (`annotations` จาก
//  services/drawing/annotate.ts) แล้ววาดเองทั้งหมด: วัสดุ PBR · RoomEnvironment + ACES · เงา · แยกชิ้นแบบลื่น · ป้ายชื่อ + ป้ายขนาด
//
//  กติกาป้าย (เจ้าของเคาะ mockup รอบ 4 · 2026-10-06 — พอร์ตจาก mockups/drawing-3d.html):
//    · ป้ายเป็นตัวหนังสือไม่มีกรอบ เรียงแถวเหนือ/ใต้ตัวสินค้า · เส้นโยงสองท่อน = ท่อนตรงออกจากป้าย + ท่อนทะแยงเข้าหาชิ้น (เริ่ม 60°)
//    · เส้นห้ามทับตัวสินค้า/ไขว้กัน/ผ่านป้ายอื่น — ตรวจกับ "หน้ากากชิ้นงาน" (วาดทุกชิ้นเป็นสีของกลุ่มแล้วอ่านพิกเซลกลับ)
//      ลากไม่ได้จริง (ชิ้นถูกบังจากมุมนั้น) = ไม่วาดป้ายนั้น ดีกว่าลากทับสินค้า
//    · ป้ายขนาดมีเฉพาะตอนประกอบ (ซ่อนตอนแยกชิ้น) · จอแคบ (< 560 px) ใช้เลขในวงกลม + รายการชื่อใต้ภาพ
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import './viewer.css';

export type Lang = 'th' | 'en';
type Vec3 = [number, number, number];
interface Text2 { th: string; en: string }

/** รูปเดียวกับ `Annotations` ของ services/drawing/annotate.ts (ส่งมาเป็น JSON) */
export interface Annotations {
  view: Vec3;
  groups: { match: string; label: Text2; dir: Vec3 | 'radial'; d: number; asm?: Text2 & { sub?: string }; count?: string }[];
  dims: (
    | { k: 'len'; a: Vec3; b: Vec3; side: 'down' | 'up'; text: string }
    | { k: 'ringLen'; r: number; y0: number; y1: number; text: string }
    | { k: 'dia'; c: Vec3; axis: Vec3; r: number; text: string; above?: boolean }
  )[];
}

export interface ViewerApi {
  toggleExplode(): boolean;
  setLabels(on: boolean): void;
  setEdges(on: boolean): void;
  setLang(lang: Lang): void;
  reset(): void;
  /** ผลตรวจการวางป้ายล่าสุด (ด่าน UI ใช้) */
  checks(): LayoutCheck | null;
  dispose(): void;
}

export interface LayoutCheck {
  mode: 'assembled' | 'exploded';
  narrow: boolean;
  labels: number;
  dims: number;
  dropped: number;
  leaderHits: number;
  overlap: number;
  crossings: number;
  outOfFrame: number;
}

// ── โมเดล ─────────────────────────────────────────────────────────────────

interface Group {
  label: Text2;
  asm?: Text2 & { sub?: string };
  re: RegExp;
  count?: RegExp;
  meshes: THREE.Mesh[];
  edges: THREE.LineSegments[];
  ids: Set<string>;
  box: THREE.Box3;
  dirV: THREE.Vector3;
  dist: number;
  text: Text2;
  idMat: THREE.MeshBasicMaterial;
  rawDir: Vec3 | 'radial';
  d: number;
}
interface Model {
  root: THREE.Group;
  edgeRoot: THREE.Group;
  box: THREE.Box3;
  groups: Group[];
  R: number;
}

/** วัสดุต่อชนิดชิ้น — จุดเดียวที่ตัดสินหน้าตาผิว (ภาพสมจริงมาจาก PBR + แสงสภาพแวดล้อม ไม่ใช่จาก React · §4.6) */
function materialFor(name: string): THREE.MeshPhysicalMaterial {
  const metal = (hex: number, rough: number) => new THREE.MeshPhysicalMaterial({ color: hex, metalness: 1, roughness: rough });
  if (/gland/.test(name)) return metal(0xd2a85a, 0.3);
  if (/head_body|head_cover/.test(name)) return new THREE.MeshPhysicalMaterial({ color: 0xc4c9ce, metalness: 0.85, roughness: 0.5 });
  if (/^cable|braid/.test(name)) return metal(0xb5bcc4, 0.48);
  if (/spade/.test(name)) return metal(0xd9dde2, 0.32);
  if (/ceramic/.test(name)) return new THREE.MeshPhysicalMaterial({ color: 0xf1ead6, metalness: 0, roughness: 0.7, clearcoat: 0.3 });
  if (/lead_wire/.test(name)) return new THREE.MeshPhysicalMaterial({ color: 0x8b8f92, metalness: 0, roughness: 0.9 });
  if (/lead_sleeve/.test(name)) return new THREE.MeshPhysicalMaterial({ color: 0x1f2022, metalness: 0, roughness: 0.55, clearcoat: 0.2 });
  if (/^lead_\d/.test(name)) return new THREE.MeshPhysicalMaterial({ color: 0xb87333, metalness: 0.6, roughness: 0.45 });
  if (/plug_body|plug_cap/.test(name)) return new THREE.MeshPhysicalMaterial({ color: 0x2b2d30, metalness: 0.2, roughness: 0.6 });
  return metal(0xcfd3d8, 0.26);
}

async function buildModel(glb: ArrayBuffer, ann: Annotations): Promise<Model> {
  const gltf = await new GLTFLoader().parseAsync(glb, '');
  // GLB เก็บเป็นเมตร (node ราก scale 0.001) — ตัวดูทำงานเป็น mm เหมือนป้าย (`annotations` หน่วย mm)
  gltf.scene.traverse((o) => { if (o.scale.x === 0.001) o.scale.set(1, 1, 1); });
  gltf.scene.updateMatrixWorld(true);
  const root = new THREE.Group(), edgeRoot = new THREE.Group();
  const groups: Group[] = ann.groups.map((g) => ({
    label: g.label, asm: g.asm, re: new RegExp(g.match), count: g.count ? new RegExp(g.count) : undefined,
    meshes: [], edges: [], ids: new Set(), box: new THREE.Box3(), dirV: new THREE.Vector3(), dist: 0,
    text: g.label, idMat: new THREE.MeshBasicMaterial(), rawDir: g.dir, d: g.d,
  }));
  const parts: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) parts.push(o as THREE.Mesh); });
  for (const src of parts) {
    const name = src.name || src.parent?.name || '';
    const gi = groups.findIndex((G) => G.re.test(name));
    if (gi < 0) continue; // ชิ้นที่ไม่มีกลุ่ม = ข้อมูลป้ายไม่ครบ — ไม่วาดดีกว่าวาดชิ้นลอยไม่มีชื่อ (annotate.ts ต้องครอบทุกชิ้น)
    const geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
    const m = new THREE.Mesh(geo, materialFor(name));
    m.castShadow = true; m.userData.gi = gi;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 28), new THREE.LineBasicMaterial({ color: 0x1b2730, transparent: true, opacity: 0.55 }));
    const G = groups[gi];
    G.meshes.push(m); G.edges.push(e);
    G.ids.add(G.count ? (name.match(G.count)?.[1] ?? name) : name);
    geo.computeBoundingBox(); G.box.union(geo.boundingBox!);
    root.add(m); edgeRoot.add(e);
  }
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center); edgeRoot.position.sub(center);
  box.translate(center.clone().negate());
  const R = Math.max(...box.getSize(new THREE.Vector3()).toArray());
  groups.forEach((G, i) => {
    const n = G.ids.size;
    G.text = { th: n > 1 ? `${G.label.th} ×${n}` : G.label.th, en: n > 1 ? `${G.label.en} ×${n}` : G.label.en };
    if (G.rawDir === 'radial') {
      const c = G.box.isEmpty() ? new THREE.Vector3() : G.box.getCenter(new THREE.Vector3()).sub(center);
      G.dirV = c.lengthSq() > 1e-6 ? c.normalize() : new THREE.Vector3();
    } else G.dirV = new THREE.Vector3(...G.rawDir);
    G.dist = G.d * R;
    G.idMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB((i + 1) * 16 / 255, 0, 0, THREE.LinearSRGBColorSpace), toneMapped: false });
  });
  return { root, edgeRoot, box, groups, R };
}
function setExplode(model: Model, t: number) {
  for (const G of model.groups) { const off = G.dirV.clone().multiplyScalar(G.dist * t); for (const o of [...G.meshes, ...G.edges]) o.position.copy(off); }
}
function explodedBox(model: Model) {
  const b = new THREE.Box3();
  for (const G of model.groups) if (!G.box.isEmpty()) b.union(G.box.clone().translate(G.dirV.clone().multiplyScalar(G.dist)));
  return b.translate(model.root.position.clone());
}

// ── ฉาก ─────────────────────────────────────────────────────────────────

function makeRenderer(canvas: HTMLCanvasElement) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.setClearColor(0x000000, 0);
  return r;
}
function buildScene(renderer: THREE.WebGLRenderer, model: Model) {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.95;
  scene.add(model.root, model.edgeRoot);
  const R = model.R, ebox = explodedBox(model);
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.28 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(R * 10, R * 10), shadowMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = Math.min(model.box.min.y, ebox.min.y) - R * 0.004; ground.receiveShadow = true;
  scene.add(ground);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(R * 0.35, R * 2.2, R * 0.6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -R * 1.4, right: R * 1.4, top: R * 1.4, bottom: -R * 1.4, near: R * 0.1, far: R * 5 });
  sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0004;
  scene.add(sun);
  return { scene, ebox, pmrem, ground, shadowMat };
}
/** ระยะกล้องให้ชิ้นงานกินแนวนอน 1/mX และแนวตั้ง 1/mY ของกรอบ — เหลือที่เหนือ/ใต้ไว้วางแถวป้าย */
function fitDist(camera: THREE.PerspectiveCamera, box: THREE.Box3, dir: Vec3, aspect: number, mX: number, mY: number) {
  camera.aspect = aspect; camera.updateProjectionMatrix();
  const d = new THREE.Vector3(...dir).normalize();
  const ctr = box.getCenter(new THREE.Vector3());
  let dist = box.getBoundingSphere(new THREE.Sphere()).radius * 3;
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z).sub(ctr));
  for (let i = 0; i < 10; i++) {
    camera.position.copy(d).multiplyScalar(dist); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    let mx = 0; for (const c of corners) { const p = c.clone().project(camera); mx = Math.max(mx, Math.abs(p.x) * mX, Math.abs(p.y) * mY); }
    dist *= mx;
  }
  return { dist, ctr };
}
const FIT = { wide: [1.12, 1.6], narrow: [1.06, 1.3] } as const;

// ── หน้ากากชิ้นงาน (ID buffer) ───────────────────────────────────────────────

interface IdMap { id: Int16Array; W: number; H: number; top: Int32Array; topId: Int16Array; bot: Int32Array; botId: Int16Array; pTop: number; pBot: number }
interface Pt { x: number; y: number }
interface Box { x: number; y: number; w: number; h: number }

function renderIds(renderer: THREE.WebGLRenderer, scene: THREE.Scene, model: Model, camera: THREE.PerspectiveCamera, W: number, H: number, ground: THREE.Object3D): IdMap {
  const rt = new THREE.WebGLRenderTarget(W, H);
  const keep: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
  for (const G of model.groups) for (const m of G.meshes) { keep.push([m, m.material]); m.material = G.idMat; }
  const ev = model.edgeRoot.visible, gv = ground.visible, env = scene.environment, au = renderer.shadowMap.autoUpdate;
  model.edgeRoot.visible = false; ground.visible = false; scene.environment = null; renderer.shadowMap.autoUpdate = false;
  const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
  const asp = camera.aspect; camera.aspect = W / H; camera.updateProjectionMatrix();
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, camera);
  const buf = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  renderer.setRenderTarget(null); renderer.setClearColor(cc, ca); camera.aspect = asp; camera.updateProjectionMatrix();
  for (const [m, mat] of keep) m.material = mat;
  model.edgeRoot.visible = ev; ground.visible = gv; scene.environment = env; renderer.shadowMap.autoUpdate = au; renderer.shadowMap.needsUpdate = true;
  rt.dispose();
  const id = new Int16Array(W * H).fill(-1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const r = buf[((H - 1 - y) * W + x) * 4]; if (r > 8) id[y * W + x] = Math.round(r / 16) - 1; }
  const top = new Int32Array(W).fill(-1), topId = new Int16Array(W).fill(-1), bot = new Int32Array(W).fill(-1), botId = new Int16Array(W).fill(-1);
  let pTop = H, pBot = -1;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) if (id[y * W + x] >= 0) { top[x] = y; topId[x] = id[y * W + x]; break; }
    for (let y = H - 1; y >= 0; y--) if (id[y * W + x] >= 0) { bot[x] = y; botId[x] = id[y * W + x]; break; }
    if (top[x] >= 0) { pTop = Math.min(pTop, top[x]); pBot = Math.max(pBot, bot[x]); }
  }
  return { id, W, H, top, topId, bot, botId, pTop, pBot };
}
const idAt = (I: IdMap, x: number, y: number) => { x = Math.round(x); y = Math.round(y); return (x < 0 || y < 0 || x >= I.W || y >= I.H) ? -1 : I.id[y * I.W + x]; };
type Side = 'up' | 'down';
/** จุดยึด = ขอบบน (หรือล่าง) ของชิ้นในคอลัมน์ที่ชิ้นนี้อยู่บนสุดจริง ⇒ ช่วงแรกของเส้นไม่ผ่านชิ้นอื่น */
function anchorFor(I: IdMap, gi: number, dir: Side): Pt | null {
  const ok = (x: number) => (dir === 'up' ? I.topId[x] : I.botId[x]) === gi;
  let best: { a: number; b: number } | null = null, cur: { a: number; b: number } | null = null;
  for (let x = 2; x < I.W - 2; x++) {
    if (ok(x)) { if (!cur) cur = { a: x, b: x }; else cur.b = x; }
    else if (cur) { if (!best || cur.b - cur.a > best.b - best.a) best = cur; cur = null; }
  }
  if (cur && (!best || cur.b - cur.a > best.b - best.a)) best = cur;
  if (!best) return null;
  const x = Math.round((best.a + best.b) / 2);
  return { x, y: dir === 'up' ? I.top[x] : I.bot[x] };
}
/** ทุกคอลัมน์ที่ชิ้นนี้อยู่บน/ล่างสุด (ทุก 3 px · ไม่เอาพิกเซลขอบช่วง) เรียงจากใกล้กึ่งกลางป้ายไปไกล */
function anchorsNear(I: IdMap, gi: number, dir: Side, ex: number): Pt[] {
  const ok = (x: number) => x >= 0 && x < I.W && (dir === 'up' ? I.topId[x] : I.botId[x]) === gi;
  const out: number[] = [];
  for (let x = 1; x < I.W - 1; x++) if (ok(x) && ok(x - 1) && ok(x + 1)) out.push(x);
  out.sort((a, b) => Math.abs(a - ex) - Math.abs(b - ex));
  const pick: number[] = []; for (const x of out) if (!pick.some((q) => Math.abs(q - x) < 3)) { pick.push(x); if (pick.length >= 40) break; }
  return pick.map((x) => ({ x, y: dir === 'up' ? I.top[x] : I.bot[x] }));
}
const segCross = (p: Pt, q: Pt, r: Pt, s: Pt) => { const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x); if (Math.abs(d) < 1e-9) return false; const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d, u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d; return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999; };
const segBox = (p: Pt, q: Pt, b: Box) => { for (let k = 0; k <= 20; k++) { const x = p.x + (q.x - p.x) * k / 20, y = p.y + (q.y - p.y) * k / 20; if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true; } return false; };

// ── ความกว้างตัวอักษร: วัดด้วย SVG จริง (canvas วัดฟอนต์ไทยกว้างเกินจริง) ─────────────────
let mtext: SVGTextElement | null = null;
const wcache = new Map<string, number>();
function textW(s: string, px: number, wgt = 600): number {
  const key = `${s}|${px}|${wgt}`; const hit = wcache.get(key); if (hit !== undefined) return hit;
  if (!mtext) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('style', 'position:absolute;left:-9999px;top:0;width:10px;height:10px;visibility:hidden');
    mtext = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    mtext.setAttribute('font-family', 'IBM Plex Sans Thai, Sarabun, sans-serif'); svg.appendChild(mtext); document.body.appendChild(svg);
  }
  mtext.setAttribute('font-size', String(px)); mtext.setAttribute('font-weight', String(wgt)); mtext.textContent = s;
  const w = mtext.getComputedTextLength(); wcache.set(key, w); return w;
}

// ── ป้ายขนาด ────────────────────────────────────────────────────────────────

interface Settings { narrow: boolean; pad: number; gap: number; margin: number; lgap: number; stub: number; lblPx: number; dimPx: number; dimGap: number }
interface Arrow { x: number; y: number; dx: number; dy: number }
interface Dim { lines: [Pt, Pt][]; arrows: Arrow[]; text: Box & { s: string } }

function makeDims(I: IdMap, ann: Annotations, model: Model, camera: THREE.PerspectiveCamera, S: Settings): Dim[] {
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const W = I.W, H = I.H, out: Dim[] = [];
  const P = (v: Vec3): Pt => { const p = new THREE.Vector3(...v).add(model.root.position).project(camera); return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H }; };
  for (const raw of ann.dims) {
    // ความสูงของวงแหวน: วางที่ขอบขวาของภาพตามมุมกล้อง
    const d = raw.k === 'ringLen'
      ? (() => { const th = Math.atan2(right.z, right.x); return { k: 'len' as const, a: [raw.r * Math.cos(th), raw.y0, raw.r * Math.sin(th)] as Vec3, b: [raw.r * Math.cos(th), raw.y1, raw.r * Math.sin(th)] as Vec3, side: 'right' as const, text: raw.text }; })()
      : raw;
    const tw = textW(d.text, S.dimPx) + 4, th = S.dimPx * 1.3;
    if (d.k === 'len') {
      const A = P(d.a), B = P(d.b); let ux = B.x - A.x, uy = B.y - A.y; const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
      let nx = -uy, ny = ux; const sv = ({ down: [0, 1], up: [0, -1], right: [1, 0] } as const)[d.side];
      if (nx * sv[0] + ny * sv[1] < 0) { nx = -nx; ny = -ny; }
      let off = 4;
      for (; off < 260; off += 2) { let clear = true; for (let s = 0; s <= L; s += 2) if (idAt(I, A.x + ux * s + nx * off, A.y + uy * s + ny * off) >= 0) { clear = false; break; } if (clear) break; }
      off += S.dimGap;
      const A2 = { x: A.x + nx * off, y: A.y + ny * off }, B2 = { x: B.x + nx * off, y: B.y + ny * off };
      const ext = (Q: Pt): [Pt, Pt] => { let s = 0; while (s < off && idAt(I, Q.x + nx * s, Q.y + ny * s) >= 0) s++; return [{ x: Q.x + nx * (s + 2), y: Q.y + ny * (s + 2) }, { x: Q.x + nx * (off + 5), y: Q.y + ny * (off + 5) }]; };
      const mid = { x: (A2.x + B2.x) / 2, y: (A2.y + B2.y) / 2 };
      const along = Math.abs(nx) < 0.7;
      const cx = along ? mid.x : mid.x + nx * (tw / 2 + 6), cy = along ? mid.y + ny * (th / 2 + 3) : mid.y;
      out.push({ lines: [[A2, B2], ext(A), ext(B)], arrows: [{ x: A2.x, y: A2.y, dx: -ux, dy: -uy }, { x: B2.x, y: B2.y, dx: ux, dy: uy }], text: { x: cx - tw / 2, y: cy - th / 2, w: tw, h: th, s: d.text } });
    } else {
      const c = new THREE.Vector3(...d.c).add(model.root.position);
      const view = camera.position.clone().sub(c).normalize();
      const p = new THREE.Vector3(...d.axis).cross(view).normalize().multiplyScalar(d.r);
      const pr = (v: THREE.Vector3): Pt => { const q = v.clone().project(camera); return { x: (q.x + 1) / 2 * W, y: (1 - q.y) / 2 * H }; };
      const P1 = pr(c.clone().add(p)), P2 = pr(c.clone().sub(p));
      let ux = P2.x - P1.x, uy = P2.y - P1.y; const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
      const ext = 12;
      const lines: [Pt, Pt][] = [[{ x: P1.x - ux * ext, y: P1.y - uy * ext }, { x: P2.x + ux * ext, y: P2.y + uy * ext }]];
      const arrows = L > 18 ? [{ x: P1.x, y: P1.y, dx: -ux, dy: -uy }, { x: P2.x, y: P2.y, dx: ux, dy: uy }] : [{ x: P1.x, y: P1.y, dx: ux, dy: uy }, { x: P2.x, y: P2.y, dx: -ux, dy: -uy }];
      const minx = Math.min(P1.x, P2.x) - (Math.abs(ux) > 0.5 ? ext : 0), miny = Math.min(P1.y, P2.y) - (Math.abs(uy) > 0.5 ? ext : 0);
      let tx: number, ty: number;
      if (d.above || minx - 6 - tw < S.pad) { tx = (P1.x + P2.x) / 2 - tw / 2; ty = miny - 4 - th; }
      else { tx = minx - 6 - tw; ty = (P1.y + P2.y) / 2 - th / 2; }
      out.push({ lines, arrows, text: { x: tx, y: ty, w: tw, h: th, s: d.text } });
    }
  }
  for (const d of out) { d.text.x = Math.max(S.pad, Math.min(W - S.pad - d.text.w, d.text.x)); d.text.y = Math.max(S.pad, Math.min(H - S.pad - d.text.h, d.text.y)); }
  return out;
}

// ── วางป้าย ────────────────────────────────────────────────────────────────

interface Item { gi: number; text: string; sub?: string; w: number; h: number; au?: Pt | null; ad?: Pt | null; side?: Side; failed?: boolean }
interface Label extends Box { text: string; sub?: string; gi: number }
interface Leader { pts: Pt[]; gi: number }
interface Balloon { x: number; y: number; bx: number; by: number; n: number; gi: number; text: string; sub?: string }
interface Layout { labels: Label[]; leaders: Leader[]; dims: Dim[]; balloons: Balloon[]; dropped: number }

function layoutLabels(I: IdMap, items: Item[], dims: Dim[], S: Settings) {
  const W = I.W, H = I.H;
  let up = Math.min(I.pTop, ...dims.flatMap((d) => [d.text.y, ...d.lines.flat().map((p) => p.y)]));
  let dn = Math.max(I.pBot, ...dims.flatMap((d) => [d.text.y + d.text.h, ...d.lines.flat().map((p) => p.y)]));
  if (!dims.length) { up = I.pTop; dn = I.pBot; }
  for (const it of items) { it.au = anchorFor(I, it.gi, 'up'); it.ad = anchorFor(I, it.gi, 'down'); }
  const live = items.filter((it) => it.au || it.ad);
  const dropped = items.length - live.length;
  for (const it of live) it.side = it.au ? 'up' : 'down';
  const fit = (side: Side) => live.filter((i) => i.side === side).reduce((s, i) => s + i.w + S.gap, 0) <= W - 2 * S.pad;
  for (const side of ['up', 'down'] as const) {
    const other: Side = side === 'up' ? 'down' : 'up';
    while (!fit(side)) {
      const mv = live.filter((i) => i.side === side && (other === 'up' ? i.au : i.ad)).sort((a, b) => b.w - a.w)[0];
      if (!mv) break; mv.side = other; if (!fit(other)) { mv.side = side; break; }
    }
  }
  // เส้นโยงสองท่อน: ท่อนตรงออกจากป้าย → ท่อนทะแยงเข้าหาจุดบนชิ้น · มุมเริ่ม 60° ถอยได้ 52–68 → 45–75 → 38–82
  const THETA = [60, 52, 68, 45, 75, 38, 82];
  const place = (lift: Record<Side, number>) => {
    const labels: Label[] = [], leaders: Leader[] = [], fail = { up: false, down: false };
    const placed: Pt[][] = [];
    for (const side of ['up', 'down'] as const) {
      const row = live.filter((i) => i.side === side).map((i) => ({ ...i, src: i, a: (side === 'up' ? i.au : i.ad)!, x: 0 })).sort((p, q) => p.a.x - q.a.x);
      if (!row.length) continue;
      row.forEach((r) => { r.x = r.a.x - r.w / 2; });
      for (let i = 0; i < row.length; i++) row[i].x = Math.max(row[i].x, S.pad, i ? row[i - 1].x + row[i - 1].w + S.gap : S.pad);
      for (let i = row.length - 1; i >= 0; i--) row[i].x = Math.min(row[i].x, (i < row.length - 1 ? row[i + 1].x - S.gap : W - S.pad) - row[i].w);
      const sgn = side === 'up' ? -1 : 1, base = side === 'up' ? up : dn;
      const rowH = Math.max(...row.map((r) => r.h));
      let edge = base + sgn * (S.margin + lift[side]);
      edge = side === 'up' ? Math.max(edge, S.pad + rowH) : Math.min(edge, H - S.pad - rowH);
      const boxes: Box[] = row.map((r) => ({ x: r.x, y: side === 'up' ? edge - r.h : edge, w: r.w, h: r.h }));
      const clear = (pts: Pt[], self: number) => {
        let walked = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
          for (let t = 0; t <= len; t += 1) { walked++; if (walked <= 3) continue; if (idAt(I, a.x + (b.x - a.x) * t / (len || 1), a.y + (b.y - a.y) * t / (len || 1)) >= 0) return false; }
          for (let k = 0; k < boxes.length; k++) if (k !== self && segBox(a, b, boxes[k])) return false;
          for (const q of placed) for (let j = 0; j < q.length - 1; j++) if (segCross(a, b, q[j], q[j + 1])) return false;
        }
        return true;
      };
      const order = row.map((_, k) => k).sort((p, q) => Math.abs(row[p].a.x - (row[p].x + row[p].w / 2)) - Math.abs(row[q].a.x - (row[q].x + row[q].w / 2)));
      const out: (Leader | null)[] = new Array(row.length).fill(null);
      for (const k of order) {
        const r = row[k], bx = boxes[k];
        const ex = bx.x + bx.w / 2, ey = side === 'up' ? bx.y + bx.h + S.lgap : bx.y - S.lgap;
        const cands = anchorsNear(I, r.gi, side, ex); if (!cands.length) cands.push(r.a);
        let pts: Pt[] | null = null;
        for (const a of cands) {
          const dx = a.x - ex, V = Math.abs(a.y - ey);
          if (Math.abs(dx) < 2) { const c = [{ x: a.x, y: a.y }, { x: a.x, y: ey }]; if (clear(c, k)) { pts = c; break; } continue; }
          for (const th of THETA) {
            const need = Math.abs(dx) * Math.tan(th * Math.PI / 180);
            if (need > V - S.stub) continue;
            const c = [{ x: a.x, y: a.y }, { x: ex, y: a.y + sgn * need }, { x: ex, y: ey }];
            if (clear(c, k)) { pts = c; break; }
          }
          if (pts) break;
        }
        if (!pts) { fail[side] = true; r.src.failed = true; continue; }
        placed.push(pts);
        out[k] = { pts, gi: r.gi };
      }
      row.forEach((r, k) => { const ld = out[k]; if (!ld) return; labels.push({ x: boxes[k].x, y: boxes[k].y, w: r.w, h: r.h, text: r.text, sub: r.sub, gi: r.gi }); leaders.push(ld); });
    }
    return { labels, leaders, fail };
  };
  const lift: Record<Side, number> = { up: 0, down: 0 };
  const run = () => { live.forEach((i) => { i.failed = false; }); return place(lift); };
  let res = run();
  for (let swap = 0; swap < 6 && (res.fail.up || res.fail.down); swap++) {
    for (let round = 0; round < 8 && (res.fail.up || res.fail.down); round++) {
      if (res.fail.up) lift.up += 10;
      if (res.fail.down) lift.down += 10;
      res = run();
    }
    if (!(res.fail.up || res.fail.down)) break;
    const mv = live.find((i) => i.failed && (i.side === 'up' ? i.ad : i.au));
    if (!mv) break;
    mv.side = mv.side === 'up' ? 'down' : 'up'; lift.up = 0; lift.down = 0;
    res = run();
  }
  return { labels: res.labels, leaders: res.leaders, dropped: dropped + (live.length - res.labels.length) };
}

function checkLayout(I: IdMap, L: Layout, mode: LayoutCheck['mode']): LayoutCheck {
  let hits = 0;
  for (const ld of L.leaders) {
    let walked = 0;
    for (let i = 0; i < ld.pts.length - 1; i++) {
      const a = ld.pts[i], b = ld.pts[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
      for (let s = 0; s <= len; s += 1) { walked += 1; if (walked <= 3) continue; if (idAt(I, a.x + (b.x - a.x) * s / (len || 1), a.y + (b.y - a.y) * s / (len || 1)) >= 0) hits++; }
    }
  }
  const boxes: Box[] = [...L.labels, ...L.dims.map((d) => d.text)];
  let overlap = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap++; }
  const segs = L.leaders.map((ld) => ld.pts.slice(1).map((p, i) => [ld.pts[i], p] as [Pt, Pt]));
  let crossings = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) for (const s1 of segs[i]) for (const s2 of segs[j]) if (segCross(s1[0], s1[1], s2[0], s2[1])) crossings++;
  const outOfFrame = boxes.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > I.W || b.y + b.h > I.H).length;
  return { mode, narrow: false, labels: L.labels.length, dims: L.dims.length, dropped: L.dropped, leaderHits: hits, overlap, crossings, outOfFrame };
}

function labelItems(model: Model, t: number, lang: Lang, S: Settings): Item[] {
  const out: Item[] = [];
  model.groups.forEach((G, gi) => {
    if (!G.meshes.length) return;
    const L = t > 0.5 ? { text: G.text[lang], sub: undefined } : (G.asm ? { text: G.asm[lang], sub: G.asm.sub } : null);
    if (!L) return;
    const w = Math.ceil(Math.max(textW(L.text, S.lblPx), L.sub ? textW(L.sub, S.lblPx * 0.92, 500) : 0)) + 4;
    const h = Math.ceil(S.lblPx * 1.25 * (L.sub ? 2 : 1) + 4);
    out.push({ gi, text: L.text, sub: L.sub, w, h });
  });
  return out;
}
function computeLayout(I: IdMap, ann: Annotations, model: Model, camera: THREE.PerspectiveCamera, t: number, lang: Lang, S: Settings): Layout {
  const dims = t < 0.5 ? makeDims(I, ann, model, camera, S) : [];
  const items = labelItems(model, t, lang, S);
  if (S.narrow) {
    const balloons: Balloon[] = [];
    items.forEach((it, k) => { const a = anchorFor(I, it.gi, 'up') || anchorFor(I, it.gi, 'down'); if (a) balloons.push({ x: a.x, y: a.y, bx: a.x, by: a.y - 12, n: k + 1, gi: it.gi, text: it.text, sub: it.sub }); });
    // วงกลมที่ชิดกัน ดันออกจากกัน (เส้นสั้นกลับไปที่ชิ้น)
    // วงกลมต้องอยู่ในกรอบทั้งวง (รัศมี 11 px + ขอบ) — บีบทุกรอบของการดัน ไม่งั้นวงที่ถูกดันกลับเข้ากรอบทีหลังจะทับกันอีก
    const inFrame = () => { for (const b of balloons) { b.bx = Math.max(13, Math.min(I.W - 13, b.bx)); b.by = Math.max(13, Math.min(I.H - 13, b.by)); } };
    for (let r = 0; r < 24; r++, inFrame()) for (let i = 0; i < balloons.length; i++) for (let j = i + 1; j < balloons.length; j++) {
      const P = balloons[i], Q = balloons[j];
      const dx = Q.bx - P.bx, dy = Q.by - P.by, d = Math.hypot(dx, dy) || 0.01;
      if (d < 26) { const m = (26 - d) / 2, ux = (dx || 0.7) / d, uy = (dy || 0.7) / d; P.bx -= ux * m; P.by -= uy * m; Q.bx += ux * m; Q.by += uy * m; }
    }
    return { labels: [], leaders: [], dims, balloons, dropped: items.length - balloons.length };
  }
  const { labels, leaders, dropped } = layoutLabels(I, items, dims, S);
  return { labels, leaders, dims, balloons: [], dropped };
}
const arrowPts = (a: Arrow, sz: number) => { const bx = a.x - a.dx * sz, by = a.y - a.dy * sz, px = -a.dy * sz * 0.38, py = a.dx * sz * 0.38; return `${a.x},${a.y} ${bx + px},${by + py} ${bx - px},${by - py}`; };
const polyStr = (pts: Pt[]) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// ── ตัวดู ─────────────────────────────────────────────────────────────────

export interface ViewerOptions {
  lang?: Lang;
  labels?: boolean;
  edges?: boolean;
  /** ที่วางรายการชื่อชิ้น (จอแคบ — เลขในวงกลม) */
  listEl?: HTMLElement | null;
  /** ชื่อบนผืนภาพ (aria-label) */
  title?: string;
}

/** สร้างตัวดูใน `host` (ต้องมีขนาด · position relative) — โหลด GLB แล้วคืนตัวควบคุม */
export async function createViewer(host: HTMLElement, glb: ArrayBuffer, ann: Annotations, opts: ViewerOptions = {}): Promise<ViewerApi> {
  const model = await buildModel(glb, ann);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', opts.title ?? 'ภาพ 3 มิติ');
  host.prepend(canvas);
  const renderer = makeRenderer(canvas);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const { scene, ebox, pmrem, ground, shadowMat } = buildScene(renderer, model);
  model.edgeRoot.visible = !!opts.edges;
  const camera = new THREE.PerspectiveCamera(28, 1, 1, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.09; controls.screenSpacePanning = true;
  const ov = document.createElement('div'); ov.className = 'dv-lbls'; host.appendChild(ov);
  const listEl = opts.listEl ?? null;
  let lang: Lang = opts.lang ?? 'th';
  let t = 0, T = 0, labelsOn = opts.labels ?? true, hl = -1, need = true, alive = true, kE = 1;
  let anim: { t0: number; from: number; to: number } | null = null;
  let home: THREE.Vector3 | null = null, ectr = new THREE.Vector3();
  let settleTimer: ReturnType<typeof setTimeout> | undefined, lastCheck: LayoutCheck | null = null;
  const dirN = new THREE.Vector3(...ann.view).normalize();
  const tgt = (x: number) => ectr.clone().multiplyScalar(x);
  const k = (x: number) => 1 + (kE - 1) * x;
  const narrow = () => host.clientWidth < 560;
  const shadowAt = (x: number) => { shadowMat.opacity = 0.28 * (1 - 0.8 * x); };
  const S0 = (): Settings => ({ narrow: narrow(), pad: 8, gap: 14, margin: 14, lgap: 3, stub: 8, lblPx: 12, dimPx: 12, dimGap: 8 });

  function dirty() { ov.style.opacity = '0'; clearTimeout(settleTimer); settleTimer = setTimeout(() => { if (!anim) layout(); }, 160); }
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false);
    if (!home) {
      const [mX, mY] = narrow() ? FIT.narrow : FIT.wide;
      const a = fitDist(camera, model.box, ann.view, w / h, mX, mY);
      const e = fitDist(camera, ebox, ann.view, w / h, mX, mY);
      kE = Math.max(1, e.dist / a.dist); ectr = e.ctr;
      home = dirN.clone().multiplyScalar(a.dist);
      controls.target.copy(tgt(t)); camera.position.copy(home).multiplyScalar(k(t)).add(controls.target);
      camera.near = a.dist / 50; camera.far = a.dist * 30; camera.updateProjectionMatrix(); controls.update();
    } else { camera.aspect = w / h; camera.updateProjectionMatrix(); }
    need = true; dirty();
  }
  function layout() {
    if (!alive) return;
    const W = host.clientWidth, H = host.clientHeight; if (!W || !H) return;
    controls.update(); camera.updateMatrixWorld();
    if (!labelsOn) { ov.innerHTML = ''; if (listEl) listEl.innerHTML = ''; lastCheck = null; return; }
    const S = S0();
    const I = renderIds(renderer, scene, model, camera, W, H, ground);
    const L = computeLayout(I, ann, model, camera, t, lang, S);
    const mode = t > 0.5 ? 'exploded' : 'assembled';
    lastCheck = S.narrow
      ? { mode, narrow: true, labels: L.balloons.length, dims: L.dims.length, dropped: L.dropped, leaderHits: 0, overlap: 0, crossings: 0, outOfFrame: 0 }
      : checkLayout(I, L, mode);
    let svg = '';
    for (const d of L.dims) {
      for (const [a, b] of d.lines) svg += `<line class="dm" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
      for (const a of d.arrows) svg += `<polygon class="ah" points="${arrowPts(a, 7)}"/>`;
      svg += `<text class="dt" x="${d.text.x + 2}" y="${d.text.y + d.text.h * 0.78}">${esc(d.text.s)}</text>`;
    }
    for (const ld of L.leaders) svg += `<polyline class="ld" data-gi="${ld.gi}" points="${polyStr(ld.pts)}"/><circle class="dot" cx="${ld.pts[0].x}" cy="${ld.pts[0].y}" r="2.4"/>`;
    for (const b of L.balloons) if (Math.hypot(b.bx - b.x, b.by - b.y) > 13) svg += `<line class="ld" x1="${b.x}" y1="${b.y}" x2="${b.bx}" y2="${b.by}"/><circle class="dot" cx="${b.x}" cy="${b.y}" r="2"/>`;
    let html = `<svg>${svg}</svg>`;
    for (const l of L.labels) html += `<div class="lb" data-gi="${l.gi}" style="transform:translate(${l.x}px,${l.y}px);width:${l.w}px">${esc(l.text)}${l.sub ? `<small>${esc(l.sub)}</small>` : ''}</div>`;
    for (const b of L.balloons) html += `<div class="bl" data-gi="${b.gi}" style="transform:translate(${b.bx}px,${b.by}px)">${b.n}</div>`;
    ov.innerHTML = html; ov.style.opacity = '1';
    if (listEl) listEl.innerHTML = L.balloons.length ? `<ol class="dv-plist">${L.balloons.map((b) => `<li data-gi="${b.gi}"><span class="n">${b.n}</span><span>${esc(b.text)}${b.sub ? ` <small>${esc(b.sub)}</small>` : ''}</span></li>`).join('')}</ol>` : '';
    applyHL();
  }
  function applyHL() {
    model.groups.forEach((G, gi) => G.meshes.forEach((m) => {
      const mat = m.material as THREE.MeshPhysicalMaterial;
      mat.emissive.set(gi === hl ? 0x00764a : 0x000000); mat.emissiveIntensity = gi === hl ? 0.55 : 0;
    }));
    [ov, listEl].forEach((r) => r?.querySelectorAll<HTMLElement>('[data-gi]').forEach((el) => el.classList.toggle('hl', Number(el.dataset.gi) === hl)));
    need = true;
  }
  const setHL = (i: number) => { if (i !== hl) { hl = i; applyHL(); } };
  const ro = new ResizeObserver(resize); ro.observe(host); resize();
  controls.addEventListener('change', () => { need = true; dirty(); });
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  const pick = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(model.root, true)[0]; return hit ? (hit.object.userData.gi as number) : -1;
  };
  let pend: PointerEvent | null = null, down: [number, number] | null = null;
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !e.buttons) pend = e; });
  canvas.addEventListener('pointerleave', () => { pend = null; setHL(-1); });
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' || !down) return; if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) { const g = pick(e); setHL(g === hl ? -1 : g); } });
  const hov = (root: HTMLElement | null) => root?.addEventListener('pointerover', (e) => { const el = (e.target as HTMLElement).closest<HTMLElement>('[data-gi]'); if (el) setHL(Number(el.dataset.gi)); });
  hov(ov); hov(listEl); ov.addEventListener('pointerleave', () => setHL(-1)); listEl?.addEventListener('pointerleave', () => setHL(-1));
  const loop = (now: number) => {
    if (!alive) return;
    if (anim) {
      const p = Math.min(1, (now - anim.t0) / 650); const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const nt = anim.from + (anim.to - anim.from) * e;
      const off = camera.position.clone().sub(controls.target).multiplyScalar(k(nt) / k(t));
      controls.target.copy(tgt(nt)); camera.position.copy(controls.target).add(off);
      t = nt; setExplode(model, t); shadowAt(t); need = true; if (p >= 1) { anim = null; dirty(); }
    }
    if (pend) { setHL(pick(pend)); pend = null; }
    if (controls.update() || need) { renderer.render(scene, camera); need = false; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return {
    toggleExplode() { T = T ? 0 : 1; anim = { t0: performance.now(), from: t, to: T }; ov.style.opacity = '0'; return !!T; },
    setLabels(on) { labelsOn = on; layout(); },
    setEdges(on) { model.edgeRoot.visible = on; need = true; },
    setLang(l) { lang = l; layout(); },
    reset() { if (home) { controls.target.copy(tgt(t)); camera.position.copy(home).multiplyScalar(k(t)).add(controls.target); controls.update(); need = true; dirty(); } },
    checks: () => lastCheck,
    dispose() {
      alive = false; clearTimeout(settleTimer); ro.disconnect(); controls.dispose(); pmrem.dispose();
      scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mat = m.material; if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose(); });
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); ov.remove();
    },
  };
}
