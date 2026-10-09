// ─────────────────────────────────────────────────────────────────────────────
//  drawingPort — ด่าน "พอร์ตรูปทรงจาก Appsale แล้วเพี้ยนไหม" (diag:drawing-port · ช่วงพอร์ต)
//
//  ค่าชุดเดียวกันเข้าทั้ง **โมดูลแบบของเรา** (`services/drawing/`) และ **โค้ดต้นฉบับของ Appsale ที่คอมมิตต้นแบบ**
//  แล้วเทียบ: ทุกชิ้นตามลำดับ (ชื่อ · สี · positions · normals · triangles · edges) ด้วย `Object.is` ทีละตัว
//  + ไฟล์ STEP ทั้งไฟล์ทุกตัวอักษร ยกเว้นบรรทัด FILE_NAME (มีเวลาและชื่อระบบ — แทนที่ทั้งสองฝั่ง และยืนยันว่ามีบรรทัดเดียว)
//  ⇒ เกณฑ์คือ **ตรงทุกไบต์** · ไม่ตรงให้หาสาเหตุ ห้ามผ่อนเกณฑ์ (ทศนิยมที่เพี้ยนคือการพอร์ตที่จัดนิพจน์ใหม่)
//
//  ไม่มีไฟล์เฉลย — ต้นฉบับถูกรัน *สด* ทุกครั้ง (CLAUDE.md "ห้ามเทียบผลที่ขึ้นกับข้อมูลกับไฟล์ที่บันทึกไว้"):
//    · ต้นฉบับมาจากสองทาง เลือกตามลำดับ แล้วก๊อปลงโฟลเดอร์ชั่วคราวของเครื่องก่อน import แบบ ES module · ลบทิ้งใน `finally`
//      1. **สำเนาในโปรเจค `vendor/appsale/heater-app/`** (หรือ `$APPSALE_DIR`) — ผลของ `git archive` คอมมิตต้นแบบ
//         + `SOURCE.json` (คอมมิต + sha256 ทุกไฟล์) · **ไม่ขึ้น git** (รีโปนี้ public · asset 24 MB) ก๊อปทั้งโฟลเดอร์ไปเครื่องอื่นได้
//         · คอมมิตไม่ตรง / ไฟล์ขาด เกิน หรือถูกแก้ = ตอบไม่ได้ (สำเนาที่ถูกแตะไม่ใช่ต้นแบบแล้ว)
//      2. ไม่มีสำเนา ⇒ `git -C $APPSALE_REPO archive <คอมมิต>` **ไม่ checkout · ไม่สร้าง ref**
//    · ไม่มีทั้งสองทาง = **ตอบไม่ได้ (exit 1)** ไม่ใช่ข้ามแล้วเขียว — ด่านที่เขียวโดยไม่ได้ตรวจคือด่านที่โกหก
//
//  ค่าที่ป้อน: ค่าเริ่มต้น + ตัวอย่างของแต่ละรุ่นใน Appsale · เคสสังเคราะห์ (ขอบของรูปทรง) · **รหัสจริงในฐาน**
//  ที่ตัวอ่านของ Appsale เองอ่านได้ (`canonical → findProduct → parse` แล้ว `{...defaults, ...values}` แบบ app.js)
//  — ค่ามาจากตัวอ่านของ Appsale ไม่ผ่านหน้าคำนวณราคา เพราะด่านนี้ถามเรื่องการพอร์ต ไม่ใช่เรื่องการแปลงช่อง
//  รหัสที่รูปทรงเหมือนกันรันครั้งเดียว (คีย์เดียวกับ cache ของต้นฉบับ)
//  `-- --quick` = ไม่แตะฐาน (ค่าเริ่มต้น + ตัวอย่าง + สังเคราะห์)
//
//  **ส่วน ค** (ไม่ใช่ --quick): รหัสจริงที่ทั้งตัวอ่านของ Appsale อ่านได้โดยไม่มีคำเตือน **และ** ผลอ่านของหน้าคำนวณราคาสะอาด
//  (ไม่มีความหลวมเลย) → `fromReading` ต้องได้ค่าเท่ากับ values ของ Appsale ทุกช่อง ⇒ ตัวแปลงช่องของเราไม่ได้อ่านรหัสต่างจาก
//  ต้นแบบ · ความต่างที่ตั้งใจมีข้อเดียว: BH-01C ที่รหัสไม่บอกการต่อใช้งาน — Appsale เติม `PL` เอง เราเก็บ `''` (ไม่ระบุ ·
//  ห้ามเติมค่าเริ่มต้นของ Appsale) นับแยกไว้ ไม่ใช่ความผิด
//
//  ฐาน: SELECT อย่างเดียวใน transaction READ ONLY + statement_timeout · เขียนแค่โฟลเดอร์ชั่วคราวแล้วลบ ⇒ รันบน PMSV ได้
//  ตระกูลที่ปรับปรุงโดยตั้งใจ (เลิกเหมือนต้นฉบับ) ต้องถอดออกจากด่านนี้ในคอมมิตเดียวกับการปรับ พร้อมตัวเลขก่อน/หลัง
// ─────────────────────────────────────────────────────────────────────────────

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool } from '../../config/db.js';
import { listSubCodes } from '../../db/pricingLabRepo.js';
import { loosenessOf } from '../../services/drawing/checks.js';
import { buildModel } from '../../services/drawing/families/registry.js';
import { specRows } from '../../services/drawing/sheetText.js';
import { SHEET_BOX, orthoView } from '../../services/drawing/views/index.js';
import { fromReading } from '../../services/drawing/spec/fromReading.js';
import { withSubCodes } from '../../services/pricingLab/bookStore.js';
import { parseProductCode } from '../../services/pricingLab/code.js';
import { NoBook, loadBookFrom } from '../pricebook/bookSource.js';
import type { BandSpec, DrawingSpec, Ts11Spec } from '../../services/drawing/types.js';
import { writeStep } from '../../services/drawing/writers/step.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';
/** คอมมิตต้นแบบของการพอร์ต (Appsale · 2026-10-02 · คอมมิตล่าสุดที่แตะ heater-app) — ตัวเดียวกับใน services/drawing/README.md */
const APPSALE_COMMIT = '4dd24756282d5be91ba98bf607ddfd71dad2acaa';
const QUICK = process.argv.includes('--quick');
const REPO = process.env.APPSALE_REPO || '/home/app_sales/Appsale';
const APP_DIR = 'frontend/public/heater-app';
/** สำเนาต้นฉบับในโปรเจค (gitignore) — ทางแรกที่ด่านใช้ */
const VENDOR = process.env.APPSALE_DIR || join(dirname(fileURLToPath(import.meta.url)), '../../vendor/appsale/heater-app');
const MAX_REPORT = 5;

// ── รูปของโมดูล Appsale (JS ไม่มี type — ประกาศเท่าที่ด่านใช้ ค่าข้างในเป็น unknown) ────────────
type AppValues = Record<string, unknown>;
interface AppPart { name: string; colour: number[]; positions: number[]; normals: number[]; triangles: number[]; edges: number[] }
interface AppProduct {
  id: string;
  defaults: AppValues;
  samples: string[];
  holes?: boolean;
  parse(code: string): { ok: boolean; values: AppValues | null; msg: string };
  build(v: AppValues): string;
  modelParts(v: AppValues): AppPart[];
  exportStep(v: AppValues): string;
  specRows(v: AppValues): [string, string][];
  views: { ortho(v: AppValues, box: { cx: number; cy: number; w: number; h: number }): { svg: string; scale: string } };
}
interface AppSolid { name: string; colour: number[]; positions: number[]; triangles: number[] }
interface AppRegistry { PRODUCTS: AppProduct[]; canonical(code: string): string; findProduct(code: string): AppProduct | null }
interface AppBandMesh { buildBandMesh(v: AppValues, split: boolean): { parts: AppPart[] } }
interface Appsale { registry: AppRegistry; band: AppBandMesh }

/**
 * ตระกูลของ Appsale ที่ด่านนี้ครอบ → ตัวแปลงค่าของ Appsale เป็น spec ของเรา + คีย์รูปทรง (= cache key ของต้นฉบับ)
 * + คู่ที่ต้องเทียบ: ชิ้นดิบของต้นฉบับ ↔ `model.parts` และ (ถ้ามี) ชิ้นที่ต้นฉบับส่งเข้า STEP ↔ `model.solids`
 */
interface Coverage {
  toSpec(v: AppValues): DrawingSpec;
  shapeKey(v: AppValues): string;
  rawParts(app: Appsale, p: AppProduct, v: AppValues): AppPart[];
  /** null = STEP ใช้ชิ้นเดียวกับชิ้นดิบ (TS) */
  stepSolids: ((p: AppProduct, v: AppValues) => AppSolid[]) | null;
}

// ── ตัวแปลง (ค่าที่ไม่ใช่ของ type เรา = แปลงไม่ได้ ⇒ รายงาน ไม่เดา) ──────────────────────────
function pick<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
  throw new Error(`ช่อง ${field} = ${JSON.stringify(v)} ไม่อยู่ในชนิดของโมดูลแบบ`);
}
function num(v: unknown, field: string): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new Error(`ช่อง ${field} = ${JSON.stringify(v)} ไม่ใช่ตัวเลข`);
}

/** TS-11 ของ Appsale = TS_-11 ของเรา · `leads` คิดจาก sensor ทั้งสองฝั่ง */
const TS11_LEADS: Record<string, number> = { TSK: 2, TSJ: 2, TST: 2, TSP: 3, TSPA: 3, TSZ: 3, N2: 2, N10: 2, P2: 2, P10: 2 };
let matMapped = 0;
const TS11_COVER: Coverage = {
  toSpec(v): Ts11Spec {
    // วัสดุไม่มีผลกับรูปทรงทั้งสองฝั่ง — Appsale รับ S (Sheath 316) ซึ่งตาราง TS_-11 ของหน้าคำนวณราคาไม่มี ⇒ ใส่ NONE แล้วนับไว้
    let mat = v.mat;
    if (mat === 'S') { mat = 'NONE'; matMapped++; }
    return {
      family: 'TS_-11',
      sensor: pick(v.sensor, ['TSK', 'TSJ', 'TST', 'TSP', 'TSPA', 'TSZ', 'N2', 'N10', 'P2', 'P10'], 'sensor'),
      spring: pick(v.spring, ['NONE', 'P'], 'spring'),
      dia: typeof v.dia === 'string' ? v.dia : String(num(v.dia, 'dia')),
      mat: pick(mat, ['NONE', 'A', 'T', 'TN', 'AT'] as const, 'mat'),
      tubeLen: num(v.tubeLen, 'tubeLen'),
      elem: pick(v.elem, ['NONE', '2'] as const, 'elem'),
      cableLen: v.cableLen === undefined ? null : num(v.cableLen, 'cableLen'),
      cable: pick(v.cable, ['NONE', 'P', 'T', 'TS'], 'cable'),
      ground: pick(v.ground, ['NONE', 'U'] as const, 'ground'),
    };
  },
  shapeKey: (v) => JSON.stringify(['TS-11', v.dia, v.tubeLen, v.spring, v.cable, TS11_LEADS[String(v.sensor)]]),
  rawParts: (_app, p, v) => p.modelParts(v),
  stepSolids: null,
};

/** BH-01 / BH-01C — ชิ้นดิบจาก `buildBandMesh` · STEP จาก `modelParts` (weldSolid) */
function bandCover(family: BandSpec['family']): Coverage {
  const split = family === 'BH-01C';
  return {
    toSpec(v): BandSpec {
      const holes = Array.isArray(v.holes) ? (v.holes as Record<string, unknown>[]).map((q, i) => ({ x: num(q.x, `holes[${i}].x`), y: num(q.y, `holes[${i}].y`), d: num(q.d, `holes[${i}].d`) })) : [];
      const fields = {
        id: num(v.id, 'id'), h: num(v.h, 'h'), t: num(v.t, 't'),
        v: v.v === undefined || v.v === null ? null : String(v.v),
        w: v.w === undefined || v.w === null ? null : num(v.w, 'w'),
        term: pick(v.term, ['NONE', '1', '2', '3', 'N', 'PL2', 'PL5', 'T'], 'term'),
        mat: pick(v.mat, ['NONE', 'Z'], 'mat'),
        conn: v.conn === null || v.conn === undefined ? null : pick(v.conn, ['PL', 'SE', ''], 'conn'),
        termPos: v.termPos === null || v.termPos === undefined ? null : num(v.termPos, 'termPos'),
        holes,
      };
      return split ? { family: 'BH-01C', ...fields } : { family: 'BH-01', ...fields };
    },
    shapeKey: (v) => JSON.stringify([family, v.id, v.h, v.t, v.term, v.mat, v.termPos, v.holes]),
    rawParts: (app, _p, v) => app.band.buildBandMesh(v, split).parts,
    stepSolids: (p, v) => p.modelParts(v),
  };
}

const COVERED: Record<string, Coverage> = { 'TS-11': TS11_COVER, 'BH-01': bandCover('BH-01'), 'BH-01C': bandCover('BH-01C') };

/** เคสสังเคราะห์ — ขอบของรูปทรงที่รหัสจริงอาจไม่มี */
const SYNTHETIC: { family: string; label: string; values: AppValues }[] = [
  { family: 'TS-11', label: 'แกน 2 mm สปริง 50', values: { dia: '2', tubeLen: 100, spring: 'NONE' } },
  { family: 'TS-11', label: 'RTD 3 สาย (TSP) สาย P', values: { sensor: 'TSP', cable: 'P', ground: 'U' } },
  { family: 'TS-11', label: 'NTC (N10) สาย T', values: { sensor: 'N10', cable: 'T', ground: 'U', dia: '5' } },
  { family: 'TS-11', label: 'PT1000 สาย TS แกน 9.5', values: { sensor: 'TSZ', cable: 'TS', dia: '9.5' } },
  { family: 'TS-11', label: 'L1 = 10', values: { tubeLen: 10 } },
  { family: 'TS-11', label: 'ไม่มีสปริง (P) แกน 3.2', values: { spring: 'P', dia: '3.2', tubeLen: 40 } },
  { family: 'TS-11', label: 'แกน 4.8 L1 ทศนิยม', values: { dia: '4.8', tubeLen: 37.5 } },
  { family: 'BH-01', label: 'รูเดียวกลางแถบ', values: { holes: [{ x: 50, y: 30, d: 8 }] } },
  { family: 'BH-01', label: 'รูแตะขอบบนพอดี (ขยาย 2 ไมครอน)', values: { holes: [{ x: 100, y: 4, d: 8 }] } },
  { family: 'BH-01', label: 'รูคร่อมรอยผ่า (x ใกล้ 0 / ติดลบ)', values: { holes: [{ x: 2, y: 30, d: 10 }, { x: -5, y: 20, d: 6 }] } },
  { family: 'BH-01', label: 'สองรูแตะกัน', values: { holes: [{ x: 100, y: 30, d: 10 }, { x: 110, y: 30, d: 10 }] } },
  { family: 'BH-01', label: 'รูใหญ่ ขั้วน็อต สังกะสี', values: { holes: [{ x: 200, y: 25, d: 30 }], term: 'N', mat: 'Z' } },
  { family: 'BH-01', label: 'termPos 100', values: { termPos: 100 } },
  { family: 'BH-01', label: 'termPos 0 ขั้วเต๋า', values: { termPos: 0, term: 'T' } },
  { family: 'BH-01', label: 'ปลั๊ก PL2 สูง 100 (น็อตยึด 3 ตัว)', values: { term: 'PL2', h: 100 } },
  { family: 'BH-01', label: 'ปลั๊ก PL5', values: { term: 'PL5' } },
  { family: 'BH-01', label: 'สาย 30 cm ขนาดเล็กสุด 25x25', values: { term: 'NONE', id: 25, h: 25 } },
  { family: 'BH-01', label: 'ขนาดทศนิยม', values: { id: 66.5, h: 37.5, term: '1' } },
  { family: 'BH-01C', label: 'termPos 20 ตามแนวแกน', values: { termPos: 20 } },
  { family: 'BH-01C', label: 'รูบนแถบผ่าครึ่ง', values: { holes: [{ x: 30, y: 40, d: 12 }, { x: 300, y: 80, d: 6 }] } },
  { family: 'BH-01C', label: 'ขั้วน็อต SE สังกะสี', values: { term: 'N', conn: 'SE', mat: 'Z', h: 60 } },
  { family: 'BH-01C', label: 'ขั้วเต๋า termPos เกิน H (ถูกบีบ)', values: { term: 'T', termPos: 500 } },
];

// ── โหลดต้นฉบับ ─────────────────────────────────────────────────────────────
function run(cmd: string, args: string[]): { status: number | null; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr ?? '' };
}

/** `git archive | tar -x` โดยไม่ผ่าน shell */
function extract(dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', ['-C', REPO, 'archive', APPSALE_COMMIT, APP_DIR]);
    const tar = spawn('tar', ['-x', '-C', dest]);
    git.stdout.pipe(tar.stdin);
    let err = '';
    git.stderr.on('data', (d) => (err += d));
    tar.stderr.on('data', (d) => (err += d));
    let done = 0, failed = false;
    const finish = (code: number | null) => {
      if (code !== 0) failed = true;
      if (++done === 2) failed ? reject(new Error(err || 'git archive/tar ล้ม')) : resolve();
    };
    git.on('close', finish);
    tar.on('close', finish);
  });
}

/** ตรวจสำเนาใน vendor เทียบ SOURCE.json — คืนข้อความปัญหาแรก หรือ null */
function vendorProblem(): string | null {
  let src: { commit?: string; files?: Record<string, string> };
  try { src = JSON.parse(readFileSync(join(VENDOR, 'SOURCE.json'), 'utf8')); } catch { return 'อ่าน SOURCE.json ไม่ได้'; }
  if (src.commit !== APPSALE_COMMIT) return `SOURCE.json เป็นคอมมิต ${src.commit} ไม่ใช่ ${APPSALE_COMMIT}`;
  const want = src.files ?? {}, seen = new Set<string>();
  const walk = (d: string): string | null => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name), r = relative(VENDOR, p);
      if (e.isDirectory()) { const x = walk(p); if (x) return x; continue; }
      if (r === 'SOURCE.json') continue;
      if (!(r in want)) return `มีไฟล์เกิน ${r}`;
      if (createHash('sha256').update(readFileSync(p)).digest('hex') !== want[r]) return `ไฟล์ถูกแก้ ${r}`;
      seen.add(r);
    }
    return null;
  };
  const bad = walk(VENDOR);
  if (bad) return bad;
  const missing = Object.keys(want).find((r) => !seen.has(r));
  return missing ? `ไฟล์หาย ${missing}` : Object.keys(want).length ? null : 'SOURCE.json ไม่มีรายการไฟล์';
}

async function loadAppsale(root: string): Promise<Appsale> {
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  const registry = (await import(pathToFileURL(join(root, 'src/registry.js')).href)) as AppRegistry;
  const band = (await import(pathToFileURL(join(root, 'src/products/bh-01-mesh.js')).href)) as AppBandMesh;
  return { registry, band };
}

// ── เทียบ ───────────────────────────────────────────────────────────────────
interface Comparable { name: string; colour: readonly number[]; positions: number[]; normals?: number[]; triangles: number[]; edges?: number[] }

/** เทียบชิ้นทุกตัวตามลำดับ — คืนข้อความจุดแรกที่ต่าง หรือ null */
function diffParts(app: Comparable[], ours: Comparable[], fields: ('positions' | 'normals' | 'triangles' | 'edges')[]): string | null {
  if (app.length !== ours.length) return `จำนวนชิ้น Appsale ${app.length} · เรา ${ours.length} (${app.map((p) => p.name).join(',')} | ${ours.map((p) => p.name).join(',')})`;
  for (let i = 0; i < app.length; i++) {
    const a = app[i], b = ours[i];
    if (a.name !== b.name) return `ชิ้นที่ ${i}: ชื่อ ${a.name} ≠ ${b.name}`;
    if (a.colour.length !== b.colour.length || a.colour.some((x, k) => !Object.is(x, b.colour[k]))) return `ชิ้น ${a.name}: สี ${a.colour} ≠ ${b.colour}`;
    for (const f of fields) {
      const x = a[f] ?? [], y = b[f] ?? [];
      if (x.length !== y.length) return `ชิ้น ${a.name}.${f}: ยาว ${x.length} ≠ ${y.length}`;
      for (let k = 0; k < x.length; k++) if (!Object.is(x[k], y[k])) return `ชิ้น ${a.name}.${f}[${k}]: Appsale ${x[k]} · เรา ${y[k]}`;
    }
  }
  return null;
}

const FILE_NAME_RE = /^FILE_NAME\(.*$/gm;
/** STEP ทั้งไฟล์ ยกเว้นบรรทัด FILE_NAME — คืนข้อความจุดแรกที่ต่าง หรือ null */
function diffStep(app: string, ours: string): string | null {
  const na = app.match(FILE_NAME_RE)?.length ?? 0, nb = ours.match(FILE_NAME_RE)?.length ?? 0;
  if (na !== 1 || nb !== 1) return `บรรทัด FILE_NAME ต้องมีบรรทัดเดียว (Appsale ${na} · เรา ${nb})`;
  const a = app.replace(FILE_NAME_RE, 'FILE_NAME(…)'), b = ours.replace(FILE_NAME_RE, 'FILE_NAME(…)');
  if (a === b) return null;
  const la = a.split('\n'), lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++)
    if (la[i] !== lb[i]) return `บรรทัด ${i + 1}: Appsale «${(la[i] ?? '(ไม่มี)').slice(0, 160)}» · เรา «${(lb[i] ?? '(ไม่มี)').slice(0, 160)}»`;
  return 'ต่างกันแต่หาบรรทัดไม่เจอ';
}

// ── ค่าจากรหัสจริง ──────────────────────────────────────────────────────────
async function realCodes(): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '15s'`);
    const { rows } = await client.query<{ model: string }>(
      `SELECT DISTINCT model FROM products WHERE model IS NOT NULL AND model ~* '^\\s*(TS|N|P|BH)'`
    );
    await client.query('COMMIT');
    return rows.map((r) => r.model);
  } finally {
    client.release();
  }
}

interface Case { family: string; label: string; values: AppValues }

/** ตระกูลของ Appsale → ตระกูลตามผลอ่านของหน้าคำนวณราคา */
const FAMILY_OF: Record<string, string> = { 'TS-11': 'TS_-11', 'BH-01': 'BH-01', 'BH-01C': 'BH-01C' };
const SPEC_FIELDS: Record<string, string[]> = {
  'TS_-11': ['sensor', 'spring', 'dia', 'mat', 'tubeLen', 'elem', 'cableLen', 'cable', 'ground'],
  'BH-01': ['id', 'h', 't', 'v', 'w', 'term', 'mat', 'conn', 'termPos', 'holes'],
  'BH-01C': ['id', 'h', 't', 'v', 'w', 'term', 'mat', 'conn', 'termPos', 'holes'],
};

/** ส่วน ค — คืนบรรทัดรายงาน + จำนวนที่ต่างโดยไม่ตั้งใจ */
async function partC(clean: { raw: string; family: string; values: AppValues }[]): Promise<{ lines: string[]; fail: number; compared: number }> {
  const lines: string[] = [];
  let book;
  try {
    const loaded = await loadBookFrom();
    book = loaded.from === 'db' ? withSubCodes(loaded.book, await listSubCodes()) : loaded.book;
    lines.push(`${DIM}สมุดราคา: ${loaded.label}${RESET}`);
  } catch (e) {
    if (!(e instanceof NoBook)) throw e;
    return { lines: [`${RED}ส่วน ค ตอบไม่ได้${RESET} — ${e.message}`], fail: 1, compared: 0 };
  }
  let compared = 0, fail = 0, intended = 0, notClean = 0;
  const diffs: string[] = [];
  for (const c of clean) {
    const parsed = parseProductCode(c.raw.trim(), book);
    const conv = fromReading(parsed);
    if (!conv.ok || loosenessOf(parsed).length) { notClean++; continue; }
    compared++;
    const fam = FAMILY_OF[c.family];
    if (conv.spec.family !== fam) {
      fail++;
      if (diffs.length < MAX_REPORT) diffs.push(`${c.raw}: ตระกูล Appsale ${c.family} · หน้าคำนวณราคา ${conv.spec.family}`);
      continue;
    }
    const theirs = COVERED[c.family].toSpec(c.values) as unknown as Record<string, unknown>;
    const ours = conv.spec as unknown as Record<string, unknown>;
    const bad = SPEC_FIELDS[fam].filter((k) => JSON.stringify(ours[k]) !== JSON.stringify(theirs[k]));
    if (bad.length === 1 && bad[0] === 'conn' && fam === 'BH-01C' && ours.conn === '' && theirs.conn === 'PL') { intended++; continue; }
    if (bad.length) {
      fail++;
      if (diffs.length < MAX_REPORT) diffs.push(`${c.raw}: ${bad.map((k) => `${k} เรา ${JSON.stringify(ours[k])} · Appsale ${JSON.stringify(theirs[k])}`).join(' · ')}`);
    }
  }
  lines.push(`${fail ? RED + '✗' : GREEN + '✓'}${RESET} ส่วน ค: ผลอ่านสะอาดทั้งสองตัวอ่าน ${compared.toLocaleString()} รหัส — ต่างโดยไม่ตั้งใจ ${fail} · ต่างโดยตั้งใจ (BH-01C ไม่บอกการต่อ: Appsale เติม PL) ${intended} ${DIM}· ผลอ่านของหน้าคำนวณราคาไม่สะอาด/วาดไม่ได้ ${notClean.toLocaleString()} (ไม่อยู่ในส่วนนี้)${RESET}`);
  for (const d of diffs) lines.push(`    ${RED}${d}${RESET}`);
  return { lines, fail, compared };
}

/** HTML entity ของ Appsale → ตัวอักษรจริง (ตารางของเราเก็บตัวอักษรจริง) */
const ENTITY: Record<string, string> = { deg: '°', sup2: '²', micro: 'µ', lt: '<', gt: '>', amp: '&', quot: '"' };
const decode = (s: string): string => s.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&([a-z0-9]+);/g, (m, k: string) => ENTITY[k] ?? m);

/** ส่วน ง — ตารางรายละเอียดสินค้า (`specRows`) ภาษาไทยเท่าต้นฉบับทุกตัวอักษร · ทุกเคส (ไม่ตัดซ้ำด้วยรูปทรง — ตารางมีช่องที่ไม่ใช่รูปทรง) */
function partD(app: { byId(id: string): AppProduct }, cases: Case[]): { lines: string[]; fail: number; compared: number } {
  const seen = new Set<string>();
  let compared = 0, fail = 0, skipped = 0;
  const diffs: string[] = [];
  for (const c of cases) {
    const key = JSON.stringify([c.family, c.values]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.family === 'TS-11' && c.values.mat === 'S') { skipped++; continue; }   // วัสดุ S ไม่มีในตาราง TS_-11 ของเรา (ส่วนบน)
    compared++;
    let problem: string | null = null;
    try {
      const theirs = app.byId(c.family).specRows(c.values).map(([k, v]) => [decode(k), decode(v)]);
      const ours = specRows(COVERED[c.family].toSpec(c.values), 'th');
      const n = Math.max(theirs.length, ours.length);
      for (let i = 0; i < n && !problem; i++) {
        if (JSON.stringify(theirs[i]) !== JSON.stringify(ours[i])) problem = `แถว ${i + 1}: Appsale ${JSON.stringify(theirs[i])} · เรา ${JSON.stringify(ours[i])}`;
      }
    } catch (e) {
      problem = `โยน error: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (problem) { fail++; if (diffs.length < MAX_REPORT) diffs.push(`${c.family} · ${c.label}: ${problem}`); }
  }
  const lines = [`${fail ? RED + '✗' : GREEN + '✓'}${RESET} ส่วน ง: ตารางรายละเอียดสินค้า ${compared.toLocaleString()} ชุดค่า — ไม่ตรงต้นฉบับ ${fail}${skipped ? ` ${DIM}· ข้ามวัสดุ S ${skipped}${RESET}` : ''}`];
  for (const d of diffs) lines.push(`    ${RED}${d}${RESET}`);
  return { lines, fail, compared };
}

/** กรอบที่ส่วน จ ใช้ — สามกรอบของกระดาษ + กรอบแคบ (TS ใช้คำย่อเมื่อกว้าง < 520) */
const ORTHO_BOXES = { ...SHEET_BOX, narrow: { cx: 200, cy: 180, w: 360, h: 260 } };

/** ส่วน จ — ภาพฉาย 2 มิติ (`views/`) เท่า `views.ortho()` ของต้นฉบับทั้งสตริง (SVG + ป้ายมาตราส่วน) ทุกกรอบ · ทุกชุดค่าที่ไม่ซ้ำ */
function partE(app: { byId(id: string): AppProduct }, cases: Case[]): { lines: string[]; fail: number; compared: number } {
  const seen = new Set<string>();
  let compared = 0, fail = 0, skipped = 0;
  const diffs: string[] = [];
  for (const c of cases) {
    const key = JSON.stringify([c.family, c.values]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.family === 'TS-11' && c.values.mat === 'S') { skipped++; continue; }
    const p = app.byId(c.family);
    for (const [name, box] of Object.entries(ORTHO_BOXES)) {
      compared++;
      let problem: string | null = null;
      try {
        const theirs = p.views.ortho(c.values, box);
        const ours = orthoView(COVERED[c.family].toSpec(c.values), box, p.build(c.values));
        if (theirs.scale !== ours.scale) problem = `มาตราส่วน Appsale ${JSON.stringify(theirs.scale)} · เรา ${JSON.stringify(ours.scale)}`;
        else if (theirs.svg !== ours.svg) {
          let i = 0;
          while (i < theirs.svg.length && theirs.svg[i] === ours.svg[i]) i++;
          problem = `SVG ต่างที่ตัวที่ ${i}: Appsale …${JSON.stringify(theirs.svg.slice(Math.max(0, i - 40), i + 40))}… · เรา …${JSON.stringify(ours.svg.slice(Math.max(0, i - 40), i + 40))}…`;
        }
      } catch (e) {
        problem = `โยน error: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (problem) { fail++; if (diffs.length < MAX_REPORT) diffs.push(`${c.family} · ${c.label} · กรอบ ${name}: ${problem}`); }
    }
  }
  const lines = [`${fail ? RED + '✗' : GREEN + '✓'}${RESET} ส่วน จ: ภาพฉาย 2 มิติ ${compared.toLocaleString()} ภาพ (${Object.keys(ORTHO_BOXES).length} กรอบ) — ไม่ตรงต้นฉบับ ${fail}${skipped ? ` ${DIM}· ข้ามวัสดุ S ${skipped}${RESET}` : ''}`];
  for (const d of diffs) lines.push(`    ${RED}${d}${RESET}`);
  return { lines, fail, compared };
}

async function main(): Promise<void> {
  const useVendor = existsSync(join(VENDOR, 'SOURCE.json'));
  console.log(`\n${BOLD}ด่านพอร์ตแบบ 3 มิติจาก Appsale${RESET} ${DIM}(คอมมิต ${APPSALE_COMMIT} · ${useVendor ? `สำเนา ${VENDOR}` : `รีโป ${REPO}`})${RESET}\n`);

  if (useVendor) {
    const bad = vendorProblem();
    if (bad) {
      console.log(`${RED}ตอบไม่ได้${RESET} — สำเนาต้นฉบับที่ ${VENDOR} ไม่ตรงคอมมิตต้นแบบ: ${bad}`);
      console.log(`แตกใหม่จากรีโป Appsale (ดู vendor/appsale/README.md) แล้วรันใหม่\n`);
      process.exitCode = 1;
      return;
    }
  } else if (run('git', ['-C', REPO, 'cat-file', '-e', `${APPSALE_COMMIT}^{commit}`]).status !== 0) {
    console.log(`${RED}ตอบไม่ได้${RESET} — ไม่พบสำเนา ${VENDOR} และไม่พบรีโป Appsale หรือคอมมิตต้นแบบที่ ${REPO}`);
    console.log(`วางสำเนาที่ vendor/appsale/heater-app/ หรือตั้ง APPSALE_REPO=<path ของรีโป Appsale ที่มีคอมมิต ${APPSALE_COMMIT}> แล้วรันใหม่\n`);
    process.exitCode = 1;
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), 'drawing-port-'));
  try {
    const root = join(tmp, APP_DIR);
    if (useVendor) cpSync(VENDOR, root, { recursive: true });
    else await extract(tmp);
    const app = await loadAppsale(root);
    const byId = (id: string) => {
      const p = app.registry.PRODUCTS.find((x) => x.id === id);
      if (!p) throw new Error(`Appsale ไม่มีรุ่น ${id}`);
      return p;
    };

    // ── รวมเคส ──
    const cases: Case[] = [];
    for (const family of Object.keys(COVERED)) {
      const p = byId(family);
      cases.push({ family, label: 'ค่าเริ่มต้น', values: { ...p.defaults } });
      for (const s of p.samples) {
        const r = p.parse(app.registry.canonical(s));
        if (!r.ok || !r.values) throw new Error(`ตัวอย่าง ${s} ของ ${family} อ่านไม่ผ่านในต้นฉบับ: ${r.msg}`);
        cases.push({ family, label: `ตัวอย่าง ${s}`, values: { ...p.defaults, ...r.values } });
      }
    }
    for (const s of SYNTHETIC) cases.push({ family: s.family, label: `สังเคราะห์: ${s.label}`, values: { ...byId(s.family).defaults, ...s.values } });

    let realRead = 0, realSeen = 0;
    const cleanAppsale: { raw: string; family: string; values: AppValues }[] = [];
    if (!QUICK) {
      for (const raw of await realCodes()) {
        const code = app.registry.canonical(raw);
        const p = app.registry.findProduct(code);
        if (!p || !COVERED[p.id]) continue;
        realSeen++;
        const r = p.parse(code);
        if (!r.ok || !r.values) continue;
        realRead++;
        const values: AppValues = { ...p.defaults, ...r.values };
        if (p.holes && !Array.isArray(values.holes)) values.holes = [];
        cases.push({ family: p.id, label: `รหัส ${raw}`, values });
        if (r.msg === '') cleanAppsale.push({ raw, family: p.id, values });
      }
    }

    // ── ตัดซ้ำด้วยคีย์รูปทรง ──
    const seen = new Set<string>();
    const unique = cases.filter((c) => {
      const k = COVERED[c.family].shapeKey(c.values);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // ── เทียบ ──
    const perFamily = new Map<string, { cases: number; parts: number; stepBytes: number; fail: number }>();
    const failures: string[] = [];
    const t0 = Date.now();
    for (const c of unique) {
      const p = byId(c.family);
      const stat = perFamily.get(c.family) ?? { cases: 0, parts: 0, stepBytes: 0, fail: 0 };
      perFamily.set(c.family, stat);
      stat.cases++;
      let problem: string | null = null;
      try {
        const spec = COVERED[c.family].toSpec(c.values);
        const model = buildModel(spec);
        const name = p.build(c.values);
        const cover = COVERED[c.family];
        problem = diffParts(cover.rawParts(app, p, c.values), model.parts, ['positions', 'normals', 'triangles', 'edges']);
        if (!problem && cover.stepSolids) problem = diffParts(cover.stepSolids(p, c.values), model.solids, ['positions', 'triangles']);
        if (!problem) {
          const appStep = p.exportStep(c.values);
          const ourStep = writeStep(model.solids, name);
          problem = diffStep(appStep, ourStep);
          if (!problem) { stat.parts += model.parts.length; stat.stepBytes += Buffer.byteLength(ourStep); }
        }
      } catch (e) {
        problem = `โยน error: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (problem) {
        stat.fail++;
        if (failures.length < MAX_REPORT) failures.push(`${c.family} · ${c.label} · ${JSON.stringify(c.values)}\n      ${problem}`);
      }
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    if (!QUICK) console.log(`รหัสจริงในฐานที่ Appsale ชี้ว่าเป็นตระกูลที่ครอบ: ${realSeen.toLocaleString()} · ตัวอ่านของ Appsale อ่านผ่าน ${realRead.toLocaleString()}`);
    else console.log(`${DIM}--quick: ไม่แตะฐาน (ค่าเริ่มต้น + ตัวอย่าง + สังเคราะห์)${RESET}`);
    console.log(`เคสทั้งหมด ${cases.length.toLocaleString()} → รูปทรงไม่ซ้ำ ${unique.length.toLocaleString()} ชุด ${DIM}(${secs} วิ)${RESET}`);
    if (matMapped) console.log(`${DIM}วัสดุ S ของ Appsale แปลงเป็น NONE ${matMapped} ครั้ง (ไม่มีผลกับรูปทรง/STEP — ชื่อ STEP ใช้ build() ของ Appsale ทั้งสองฝั่ง)${RESET}`);
    console.log('');
    let totalFail = 0, total = 0;
    for (const [family, s] of perFamily) {
      total += s.cases;
      totalFail += s.fail;
      const ok = s.fail === 0;
      console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${RESET} ${family.padEnd(8)} ${s.cases - s.fail}/${s.cases} ชุดตรงทุกไบต์ · ${s.parts.toLocaleString()} ชิ้น · STEP ${s.stepBytes.toLocaleString()} ไบต์`);
    }
    for (const f of failures) console.log(`\n  ${RED}✗${RESET} ${f}`);
    if (totalFail > MAX_REPORT) console.log(`\n  ${DIM}… และอีก ${totalFail - MAX_REPORT} ชุด${RESET}`);

    const d = partD({ byId }, cases);
    console.log('');
    for (const l of d.lines) console.log(`  ${l}`);
    const dFail = d.fail + (d.compared === 0 ? 1 : 0);
    const e = partE({ byId }, cases);
    for (const l of e.lines) console.log(`  ${l}`);
    const eFail = e.fail + (e.compared === 0 ? 1 : 0);

    let cFail = 0;
    if (!QUICK) {
      const c = await partC(cleanAppsale);
      console.log('');
      for (const l of c.lines) console.log(`  ${l}`);
      cFail = c.fail + (c.compared === 0 ? 1 : 0);
      if (c.compared === 0) console.log(`  ${RED}ส่วน ค ตอบไม่ได้${RESET} — ไม่มีรหัสที่สะอาดทั้งสองฝั่ง`);
    }

    const pass = total > 0 && totalFail === 0 && cFail === 0 && dFail === 0 && eFail === 0;
    console.log(`\n${'─'.repeat(70)}\nสรุป: ${pass ? `${GREEN}ผ่าน${RESET} — ทุกชุดตรงกับต้นฉบับทุกไบต์${QUICK ? '' : ' และตัวแปลงช่องอ่านเหมือนต้นแบบ'}` : total === 0 ? `${RED}ตอบไม่ได้${RESET} — ไม่มีเคสให้ตรวจ` : `${RED}ตก${RESET} — ${totalFail} ชุดไม่ตรงกับต้นฉบับ · ส่วน ค ${cFail} · ส่วน ง ${dFail} · ส่วน จ ${eFail}`}\n${'─'.repeat(70)}\n`);
    process.exitCode = pass ? 0 : 1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
