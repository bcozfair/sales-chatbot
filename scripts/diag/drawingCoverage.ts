// ─────────────────────────────────────────────────────────────────────────────
//  drawingCoverage — ด่านถาวรของโมดูลแบบ 3 มิติกับ "รหัสจริงทุกตัวในฐาน" (diag:drawing-coverage)
//
//  ทุกรหัสจริงตระกูล TS/N/P/BH → อ่าน + คิดราคาแบบหน้าคำนวณราคา (`parseProductCode` + `computePrice` + ตารางรหัสย่อย
//  ในฐาน — ทางเดียวกับ `pricingQuoteHandler`) → `judge()` ของโมดูลแบบ → โมเดล/GLB/STEP ครั้งเดียวต่อรูปทรงที่ไม่ซ้ำ
//
//  (ก) **รายงาน** ต่อตระกูล: ทั้งหมด · วาดได้ · ส่งได้ทันที · ส่งได้หลังผู้เสนอราคายืนยัน · เหตุผล · ตระกูลที่ยังไม่มีแบบ — **ไม่มีเกณฑ์ขั้นต่ำ**
//      (ตัวเลขขยับตามแค็ตตาล็อกที่ sync ทุกวัน · CLAUDE.md ห้ามเทียบผลที่ขึ้นกับข้อมูลกับไฟล์ที่บันทึกไว้)
//  (ข) **สิ่งที่ต้องจริงเสมอ** — ล้มทันทีแม้รหัสเดียว:
//      1. วาดได้ ⇒ โมเดลไม่ throw · ตัวเลข finite · normal ยาวเท่า positions · index อยู่ในขอบ
//      2. STEP เขียนได้ · จำนวน FACETED_BREP = จำนวน solids · จบด้วย END-ISO-10303-21;
//      3. GLB ถอดกลับได้ตรงต้นฉบับ (ตัวถอดของ drawingGlbLib — ไม่ใช้โค้ดตัวเขียน)
//      4. **สามทางตรงกัน**: ค่าที่วัดจาก mesh = ช่องของหน้าคำนวณราคา = ค่าที่คิดเงิน (`cfg`)
//         TS_-11: รัศมีแกน = D/2 = axes.D/2 · ปลายแกน −x = L1 = dims.L1 · ความยาวสาย = dims.cable_m · จำนวนสายตามชนิด
//                 · มี/ไม่มีสปริงตามช่อง · สีปลอกตามชนิดสาย
//         BH-01/01C: รัศมีใน = ID/2 = dims.dia_mm/2 · หนา 4 · สูงตามแกน = H = dims.width_mm · ชิ้นขั้วไฟตามช่อง · ผ่าครึ่งตามตระกูล
//      5. ช่องรูปทรงมี issue/ไม่ได้เขียน · ท่อนหลังเลขรุ่น · แกนหัก ⇒ ต้อง "วาดไม่ได้" (ตรวจซ้ำจากผลอ่านเอง ไม่ใช้ checks.ts)
//         · แกนหักอ่านจาก **`parsed.cfg.options` ตรง ๆ** (`bend:*` ที่ตัวอ่านรหัสตั้งจากตัว L ท้ายเลขรุ่น — pricingLab `c80d688`)
//           ไม่ผ่าน `PricingReading` และไม่พึ่ง `headJunk` (QA 2026-10-06: ล้าง headJunk แล้วแกนหัก 330 รหัสถูกวาดเป็นแท่งตรงโดยด่านเดิมยังผ่าน)
//         · ท่อนท้ายที่ทับตำแหน่งช่องรูปทรงที่เป็น None (`''`): TS_-11 สาย `''` + `tail` ที่ขึ้นต้นด้วยตัวอักษร (ไม่ใช่ `S###`) ·
//           BH ขั้วไฟ `''` + ท่อนที่ขึ้นต้นด้วย PL/N/T/1-3+ตัวอักษร — ตัดสินจาก `tail`/`extras` + ค่าช่องเอง ไม่เรียกโมดูล
//           (QA รอบ 2: `+3M-CU` ถูกวาดเป็นสายสแตนเลสถักแล้วไปอยู่ชั้น "ส่งได้หลังยืนยัน" 93 รหัส)
//      6. (ก) ความหลวมที่ไม่ใช่ "วิธีเขียน" และไม่ใช่ "ส่วนท้ายที่ยืนยันได้" (issue · ไม่ได้เขียน · ท่อนหลังเลขรุ่น · สิ่งบวกเพิ่ม ·
//             BH loose/รู/กำลังไฟนอกรูปแบบ) ⇒ ต้องส่งไม่ได้ · ส่งได้ ⇒ คิดราคาได้และไม่ใช่ "ไม่รับผลิต"
//             + **ท่อนท้ายที่เป็นค่าของช่องที่ปล่อยว่าง** (TS Ground/วัสดุ/Element/ความยาวสาย · BH แรงดัน/กำลังไฟค่าที่สอง ·
//               ความยาวสายที่ไม่ตรงกับขั้วไฟแบบออกสาย) = ระบบเดา ⇒ ต้องส่งไม่ได้ (รอบแก้ 3 · ตัวตัดสินของด่านเอง ไม่เรียก checks.ts)
//             + ท่อนตัวอักษรต่อท้ายสาย TS_-11 ที่ระบุแล้ว (`-MP` · `-SP`) ⇒ ต้องส่งไม่ได้ จนกว่าเจ้าของบอกความหมาย (รอบแก้ 4)
//               ⚠️ เจ้าของตอบว่าท่อนไหนไม่เปลี่ยนปลายสาย = แก้ `CABLE_END_HARMLESS` ใน checks.ts **และ** ยกเว้นท่อนนั้นที่นี่ด้วย
//         (ข) ส่วนท้ายที่ยืนยันได้ (TS ท้ายรหัส/`S###` · BH ท่อนนอกแคตตาล็อก) ⇒ ต้องอยู่ใน `confirm` ครบทุกชนิด และ `confirm`
//             มีของได้เฉพาะเมื่อผลอ่านมีส่วนนั้นจริง — ห้ามหลุดเป็น "ส่งได้" โดยไม่มีอะไรให้ผู้เสนอราคาติ๊ก (เจ้าของเคาะ 2026-10-06)
//      7. ทุกรหัสของตระกูลที่มีแบบได้คำตัดสิน · ตรวจ 0 รหัส = **ตอบไม่ได้** (ไม่ใช่ผ่าน)
//      8. ทิศการพึ่งพา: services/drawing/** ไม่ import pricingLab / pdfGenerator / puppeteer / routes และไม่มีโค้ดเดิม import มัน
//         + ตัวยืนยัน keyof สองทางระหว่าง type ที่โมดูลแบบประกาศเอง กับ TsForm / BhForm (บรรทัดล่าง — ล้มที่ tsc)
//
//  ฐาน: SELECT อย่างเดียว (READ ONLY + statement_timeout) · ไม่เขียนไฟล์ ⇒ รันบน PMSV ได้ · `--data <dir>` ใช้สมุดจากไฟล์ได้
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../../config/db.js';
import { listSubCodes } from '../../db/pricingLabRepo.js';
import { withSubCodes } from '../../services/pricingLab/bookStore.js';
import type { BhForm } from '../../services/pricingLab/catalogBh.js';
import type { TsForm } from '../../services/pricingLab/catalogTs.js';
import { parseProductCode } from '../../services/pricingLab/code.js';
import { computePrice } from '../../services/pricingLab/engine.js';
import { judge } from '../../services/drawing/checks.js';
import { buildModel } from '../../services/drawing/families/registry.js';
import { JACKETS } from '../../services/drawing/families/tsParts.js';
import { SENSOR_LEADS } from '../../services/drawing/families/ts-11.js';
import type { ProductConfig } from '../../services/pricingLab/types.js';
import type { BhFormReading, DrawingModel, DrawingSpec, PricingReading, TsFormReading } from '../../services/drawing/types.js';
import { writeGlb } from '../../services/drawing/writers/glb.js';
import { writeStep } from '../../services/drawing/writers/step.js';
import { NoBook, loadBookFrom } from '../pricebook/bookSource.js';
import { decodeGlb, roundtripProblems } from './drawingGlbLib.js';

// ── ข้อ 8 (ส่วน typecheck): type ที่โมดูลแบบประกาศเองต้องมีช่องเท่ากับของหน้าคำนวณราคา **สองทาง** ──────────────
//    หน้าคำนวณราคาเพิ่มธงความหลวมใหม่ใน TsForm/BhForm แล้วไม่มีใครบอกโมดูลแบบ = tsc ล้มที่บรรทัดนี้
type SameKeys<A, B> = [Exclude<keyof A, keyof B>, Exclude<keyof B, keyof A>] extends [never, never] ? true : { missing: Exclude<keyof B, keyof A>; extra: Exclude<keyof A, keyof B> };
const TS_FORM_KEYS_MATCH: SameKeys<TsFormReading, TsForm> = true;
const BH_FORM_KEYS_MATCH: SameKeys<BhFormReading, BhForm> = true;
// สัญญาณแกนหัก: `PricingReading.cfg.options` ต้องเป็นช่องที่มีอยู่จริงใน `ProductConfig` ชนิดเดียวกัน — เปลี่ยนชื่อ = tsc ล้มที่นี่
type CfgReading = NonNullable<PricingReading['cfg']>;
const CFG_KEYS_IN_PRODUCT_CONFIG: Exclude<keyof CfgReading, keyof ProductConfig> extends never ? true : { notInProductConfig: Exclude<keyof CfgReading, keyof ProductConfig> } = true;
const CFG_OPTIONS_TYPE: CfgReading = {} as Pick<ProductConfig, 'options'>;
void TS_FORM_KEYS_MATCH; void BH_FORM_KEYS_MATCH; void CFG_KEYS_IN_PRODUCT_CONFIG; void CFG_OPTIONS_TYPE;

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX_REPORT = 8;
const EPS = 1e-9;

// ── ข้อ 8: ทิศการพึ่งพา (อ่านซอร์ส) ────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', '.claude', 'frontend', 'public', 'dist', 'backup', 'data'].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|mts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
function importsOf(file: string): string[] {
  // `import … from '…'` (ข้ามบรรทัดได้) · `export … from '…'` · `import '…'` · `import('…')`
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/\b(?:import|export)\s[^'";]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((m) => m[1] ?? m[2] ?? m[3]);
}
function dependencyProblems(): string[] {
  const out: string[] = [];
  const mod = join(ROOT, 'services', 'drawing');
  for (const f of walk(mod))
    for (const spec of importsOf(f))
      if (/pricingLab|pdfGenerator|puppeteer|(^|\/)routes\//.test(spec)) out.push(`${relative(ROOT, f)} import ${spec}`);
  for (const f of walk(ROOT)) {
    const rel = relative(ROOT, f);
    if (rel.startsWith(join('services', 'drawing')) || rel.startsWith(join('scripts', 'diag'))) continue;
    for (const spec of importsOf(f)) if (/services\/drawing\//.test(spec)) out.push(`${rel} import ${spec} (โค้ดเดิมห้ามพึ่งโมดูลแบบในเฟส 0)`);
  }
  return out;
}

// ── รหัสจริง ──────────────────────────────────────────────────────────────
async function realCodes(): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '15s'`);
    const { rows } = await client.query<{ model: string }>(
      `SELECT DISTINCT btrim(model) AS model FROM products WHERE model IS NOT NULL AND btrim(model) ~ '^(TS|N|P|BH)'`
    );
    await client.query('COMMIT');
    return rows.map((r) => r.model);
  } finally {
    client.release();
  }
}

// ── ข้อ 1–4 ต่อรูปทรง (วัดครั้งเดียว ใช้ทุกรหัสที่รูปทรงเดียวกัน) ─────────────────────────
interface Measured {
  problems: string[];
  model: DrawingModel | null;
  /** TS: รัศมีแกนสูงสุด · ปลายแกน (−min x) · จำนวนสาย · มีสปริง · สีปลอก */
  ts?: { radius: number; tip: number; leads: number; spring: boolean; jacket: readonly number[] | null };
  /** BH: รัศมีใน/นอก · ความสูงตามแกน · ชื่อชิ้นทั้งหมด */
  bh?: { ri: number; ro: number; height: number; names: Set<string> };
}

function structural(model: DrawingModel): string[] {
  const out: string[] = [];
  for (const p of model.parts) {
    const n = p.positions.length / 3;
    if (!Number.isInteger(n) || n === 0) out.push(`ชิ้น ${p.name}: จำนวนจุดไม่ใช่จำนวนเต็มบวก`);
    if (p.normals.length !== p.positions.length) out.push(`ชิ้น ${p.name}: normal ${p.normals.length} ≠ positions ${p.positions.length}`);
    if ([...p.positions, ...p.normals, ...p.edges].some((x) => !Number.isFinite(x))) out.push(`ชิ้น ${p.name}: มีค่าที่ไม่ใช่ตัวเลข`);
    if (p.triangles.length % 3 !== 0 || p.triangles.some((t) => !Number.isInteger(t) || t < 0 || t >= n)) out.push(`ชิ้น ${p.name}: index นอกขอบ`);
  }
  for (const s of model.solids) {
    const n = s.positions.length / 3;
    if (s.positions.some((x) => !Number.isFinite(x))) out.push(`solid ${s.name}: มีค่าที่ไม่ใช่ตัวเลข`);
    if (s.triangles.length % 3 !== 0 || s.triangles.some((t) => !Number.isInteger(t) || t < 0 || t >= n)) out.push(`solid ${s.name}: index นอกขอบ`);
  }
  return out;
}

function measure(spec: DrawingSpec, name: string): Measured {
  let model: DrawingModel;
  try {
    model = buildModel(spec);
  } catch (e) {
    return { problems: [`ข้อ 1: โมเดลโยน error — ${e instanceof Error ? e.message : String(e)}`], model: null };
  }
  const problems = structural(model).map((p) => `ข้อ 1: ${p}`);
  try {
    const step = writeStep(model.solids, name, { timestamp: '2000-01-01T00:00:00.000Z' });
    const breps = step.match(/=FACETED_BREP\('/g)?.length ?? 0;
    if (breps !== model.solids.length) problems.push(`ข้อ 2: FACETED_BREP ${breps} ≠ solids ${model.solids.length}`);
    if (!step.endsWith('END-ISO-10303-21;\n')) problems.push('ข้อ 2: STEP ไม่จบด้วย END-ISO-10303-21;');
  } catch (e) {
    problems.push(`ข้อ 2: เขียน STEP ไม่ได้ — ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const { parts, problems: g } = decodeGlb(writeGlb(model, name));
    problems.push(...[...g, ...roundtripProblems(model, parts)].map((p) => `ข้อ 3: ${p}`));
  } catch (e) {
    problems.push(`ข้อ 3: เขียน GLB ไม่ได้ — ${e instanceof Error ? e.message : String(e)}`);
  }
  const out: Measured = { problems, model };
  if (spec.family === 'TS_-11') {
    const tube = model.parts.find((p) => p.name === 'probe_tube');
    let radius = 0, tip = 0;
    for (let k = 0; tube && k < tube.positions.length; k += 3) {
      radius = Math.max(radius, Math.hypot(tube.positions[k + 1], tube.positions[k + 2]));
      tip = Math.max(tip, -tube.positions[k]);
    }
    out.ts = {
      radius, tip,
      leads: model.parts.filter((p) => /^lead_\d+$/.test(p.name)).length,
      spring: model.parts.some((p) => p.name === 'strain_spring'),
      jacket: model.parts.find((p) => p.name === 'cable')?.colour ?? null,
    };
  } else {
    // แกนของวงแหวน = แกน Y ของโมเดล · BH-01C ถูกหมุนทั้งชิ้น 40° (world() ของต้นแบบ) ⇒ แกนเอียงตาม
    const r = 40 * Math.PI / 180;
    const axis = spec.family === 'BH-01C' ? [Math.cos(r), 0, -Math.sin(r)] : [0, 1, 0];
    let ri = Infinity, ro = 0, lo = Infinity, hi = -Infinity;
    for (const p of model.parts.filter((x) => /^band_(shell|half_\d)$/.test(x.name)))
      for (let k = 0; k < p.positions.length; k += 3) {
        const v = [p.positions[k], p.positions[k + 1], p.positions[k + 2]];
        const a = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
        const rad = Math.hypot(v[0] - a * axis[0], v[1] - a * axis[1], v[2] - a * axis[2]);
        ri = Math.min(ri, rad); ro = Math.max(ro, rad); lo = Math.min(lo, a); hi = Math.max(hi, a);
      }
    out.bh = { ri, ro, height: hi - lo, names: new Set(model.parts.map((p) => p.name)) };
  }
  return out;
}

const near = (a: number, b: number, tol = EPS * Math.max(1, Math.abs(b))) => Math.abs(a - b) <= tol;

/** ข้อ 4: ค่าที่วัดได้ = ช่องของหน้าคำนวณราคา = ค่าที่คิดเงิน */
function threeWay(spec: DrawingSpec, m: Measured, cfg: { axes?: Record<string, string>; dims?: Record<string, number> } | undefined, ts?: TsForm, bh?: BhForm): string[] {
  const out: string[] = [];
  if (spec.family === 'TS_-11' && m.ts && ts) {
    const d = Number(ts.values.d), l1 = Number(ts.values.l1);
    const cfgD = cfg?.axes?.D !== undefined ? parseFloat(cfg.axes.D) : NaN;
    if (!near(m.ts.radius, d / 2, 1e-9) || !near(cfgD / 2, d / 2, 1e-12)) out.push(`ข้อ 4: รัศมีแกน mesh ${m.ts.radius} · ช่อง ${d / 2} · cfg.axes.D ${cfg?.axes?.D}`);
    if (!near(m.ts.tip, l1, 1e-9) || cfg?.dims?.L1 !== l1) out.push(`ข้อ 4: ความยาวแกน mesh ${m.ts.tip} · ช่อง ${l1} · cfg.dims.L1 ${cfg?.dims?.L1}`);
    if (spec.cableLen !== null && !near(spec.cableLen, cfg?.dims?.cable_m ?? NaN, 1e-9)) out.push(`ข้อ 4: ความยาวสาย spec ${spec.cableLen} · cfg.dims.cable_m ${cfg?.dims?.cable_m}`);
    const rtd = ['P', 'PA', 'Z'].includes(ts.values.sensor) && ts.values.probe === 'TS';
    if (m.ts.leads !== SENSOR_LEADS[spec.sensor] || m.ts.leads !== (rtd ? 3 : 2)) out.push(`ข้อ 4: จำนวนสาย mesh ${m.ts.leads} · ชนิด ${ts.values.probe}${ts.values.sensor}`);
    if (m.ts.spring !== (ts.values.spring === '')) out.push(`ข้อ 4: สปริงใน mesh ${m.ts.spring} · ช่อง spring «${ts.values.spring}»`);
    const want = JACKETS[spec.cable];
    if (!m.ts.jacket || m.ts.jacket.some((c, k) => c !== want[k])) out.push(`ข้อ 4: สีปลอกสายไม่ตรงชนิดสาย «${ts.values.cable}»`);
  }
  if ((spec.family === 'BH-01' || spec.family === 'BH-01C') && m.bh && bh) {
    const id = bh.id ?? NaN, h = bh.h ?? NaN;
    if (!near(m.bh.ri, id / 2, 1e-6) || cfg?.dims?.dia_mm !== id) out.push(`ข้อ 4: รัศมีใน mesh ${m.bh.ri} · ช่อง ID/2 ${id / 2} · cfg.dims.dia_mm ${cfg?.dims?.dia_mm}`);
    if (!near(m.bh.ro - m.bh.ri, 4, 1e-6)) out.push(`ข้อ 4: ความหนา mesh ${m.bh.ro - m.bh.ri} ≠ 4`);
    if (!near(m.bh.height, h, 1e-6) || cfg?.dims?.width_mm !== h) out.push(`ข้อ 4: ความสูง mesh ${m.bh.height} · ช่อง H ${h} · cfg.dims.width_mm ${cfg?.dims?.width_mm}`);
    const split = spec.family === 'BH-01C';
    if (split !== (m.bh.names.has('band_half_1') && m.bh.names.has('band_half_2') && !m.bh.names.has('band_shell'))) out.push('ข้อ 4: การผ่าครึ่งไม่ตรงตระกูล');
    const term = bh.term ?? '';
    const body = term === 'N' ? 'stud_1' : term === 'T' ? 'ceramic_block' : term === 'PL2' ? 'plug_body_PL2' : term === 'PL5' ? 'plug_body_PL5' : 'ceramic_bush';
    const tags = split ? ['_1', '_2'] : [''];
    for (const tag of tags) if (!m.bh.names.has(body + tag)) out.push(`ข้อ 4: ไม่มีชิ้นขั้วไฟ ${body + tag} สำหรับการออกขั้ว «${term}»`);
  }
  return out;
}

/** ข้อ 5 และ 6 — ตรวจจากผลอ่านเอง (ไม่เรียก checks.ts) */
function mustNotDraw(ts?: TsForm, bh?: BhForm, cfg?: ProductConfig): string | null {
  // แกนหักทุกตระกูล — สัญญาณอิสระจากสเปกที่ส่งเข้าตัวคิดราคา + ช่องที่ติ๊ก
  if ([...(cfg?.options ?? []), ...(ts?.addons ?? []), ...(bh?.addons ?? [])].some((a) => a.startsWith('bend:'))) return 'แกนหัก (bend:* ใน cfg.options/addons)';
  if (ts?.family === 'TS_-11') {
    const shape = ['probe', 'sensor', 'spring', 'd', 'l1', 'cable'];
    if (ts.headJunk) return `ท่อนหลังเลขรุ่น ${ts.headJunk}`;
    const bad = shape.find((s) => ts.issues?.[s] || ts.omit?.includes(s));
    if (bad) return `ช่องรูปทรง ${bad} มี issue/ไม่ได้เขียน`;
    if (ts.values.cable === '') {
      const t = (ts.tail ?? []).map((x) => x.replace(/^[-+]+/, '')).find((x) => /^[A-Z]/i.test(x) && !/^S\d+$/i.test(x));
      if (t) return `สาย '' แต่ท้ายรหัสมี «${t}» ตรงตำแหน่งสาย`;
    }
  }
  if (bh && (bh.family === 'BH-01' || bh.family === 'BH-01C')) {
    if (bh.sizeText !== undefined || bh.id === undefined || bh.h === undefined) return 'ขนาดไม่ครบ/เขียนนอกรูปแบบ';
    if ((bh.term ?? '') === '') {
      // ความยาวสาย (`1M` · `30cm`) ไม่ใช่ขั้วไฟ — ทุกแบบออกสายวาดเหมือนกัน
      const t = (bh.extras ?? []).map((e) => e.text.replace(/^[-+]+/, '')).find((x) => /^(PL|N|T|[123][A-Z])/i.test(x) && !/^\d+(\.\d+)?(M|CM|MM)$/i.test(x));
      if (t) return `ขั้วไฟ '' แต่มีท่อน «${t}» ที่อาจเป็นขั้วไฟ`;
    }
  }
  return null;
}
/** ข้อ 6 (ก) — ความหลวมที่ต้องปิดการส่ง (ไม่ใช่วิธีเขียน · ไม่ใช่ส่วนท้ายที่ยืนยันได้) */
function blockingLooseness(ts?: TsForm, bh?: BhForm): string | null {
  if (ts) {
    if (Object.keys(ts.issues ?? {}).length) return 'มี issue';
    if (ts.omit?.length) return 'มีช่องที่ไม่ได้เขียน';
    if (ts.headJunk || ts.addons?.length) return 'มีท่อนหลังเลขรุ่น/สิ่งบวกเพิ่ม';
  }
  if (bh) {
    if (bh.loose || bh.addons?.length || bh.holes?.length || bh.wattText !== undefined) return 'ผลอ่าน BH หลวม/มีรู/มีสิ่งบวกเพิ่ม/กำลังไฟนอกรูปแบบ';
  }
  return guessedEmptyField(ts, bh);
}
/** ท่อนท้ายที่เป็นค่าของช่องที่ตัวอ่านปล่อยว่าง — ตัดสินเองจากผลอ่าน (สำเนาโดยตั้งใจ · เป็นสัญญาณอิสระจาก checks.ts) */
function guessedEmptyField(ts?: TsForm, bh?: BhForm): string | null {
  if (ts) {
    const v = ts.values;
    for (const t of (ts.tail ?? []).map((x) => x.replace(/^[-+]+/, ''))) {
      if (v.ground === '' && /^U/i.test(t)) return `ท้ายรหัส ${t} = Ground แต่ช่องว่าง`;
      if (v.mat === '' && /^(A|T)/i.test(t)) return `ท้ายรหัส ${t} = วัสดุ แต่ช่องว่าง`;
      if (v.elem === '' && /^2(?![\d.])/.test(t)) return `ท้ายรหัส ${t} = Element แต่ช่องว่าง`;
      if (v.cl === '' && /^\d+(\.\d+)?(M|CM|MM)$/i.test(t)) return `ท้ายรหัส ${t} = ความยาวสาย แต่ช่องว่าง`;
      // ท่อนตัวอักษรต่อท้ายสายที่ระบุแล้ว (`-T-MP` · `-PU-SP`) — ยังไม่รู้ว่าเปลี่ยนปลายสายไหม (ถามเจ้าของ 2026-10-06)
      if (ts.family === 'TS_-11' && v.cable !== '' && /^[A-Z]/i.test(t) && !/^S\d+$/i.test(t)) return `ท่อน ${t} ต่อท้ายสายที่ระบุแล้ว — ยังไม่รู้ความหมาย`;
    }
  }
  if (bh) {
    const wire = ({ '': 0.3, '1': 1, '2': 2, '3': 3 } as Record<string, number>)[bh.term ?? ''];
    for (const e of bh.extras ?? []) {
      const t = e.text.replace(/^[-+]+/, '');
      if (e.after === 'volt' && /^\d+(\.\d+)?$/.test(t)) return `ตัวเลขที่สองต่อจากแรงดัน ${t}`;
      if (e.after === 'watt' && /^\d+(\.\d+)?W$/i.test(t)) return `วัตต์ที่สอง ${t}`;
      const m = t.match(/^(\d+(?:\.\d+)?)(M|CM|MM)?$/i);
      if (m && wire !== undefined && e.after !== 'volt') {
        const u = (m[2] ?? 'M').toUpperCase();
        const metres = Number(m[1]) / (u === 'CM' ? 100 : u === 'MM' ? 1000 : 1);
        if (Math.abs(metres - wire) > 1e-9) return `ความยาวสาย ${t} ไม่ตรงกับขั้วไฟ (${wire} ม.)`;
      }
    }
  }
  return null;
}
/** ข้อ 6 (ข) — ส่วนท้ายที่ยืนยันได้ซึ่งผลอ่านมีจริง → คีย์ที่ต้องเจอใน `confirm` */
function confirmableKeys(ts?: TsForm, bh?: BhForm): string[] {
  const keys: string[] = [];
  if (ts?.tail?.length) keys.push('tail');
  if (ts?.extras?.length || bh?.extras?.length) keys.push('extras');
  return keys;
}

async function main(): Promise<void> {
  console.log(`\n${BOLD}ด่านแบบ 3 มิติกับรหัสจริงทุกตัว${RESET}\n`);
  const failures: string[] = [];
  let failCount = 0;
  const fail = (msg: string) => { failCount++; if (failures.length < MAX_REPORT) failures.push(msg); };

  const deps = dependencyProblems();
  for (const d of deps) fail(`ข้อ 8: ${d}`);

  let book;
  try {
    const loaded = await loadBookFrom();
    book = loaded.from === 'db' ? withSubCodes(loaded.book, await listSubCodes()) : loaded.book;
    console.log(`${DIM}สมุดราคาที่ใช้: ${loaded.label}${loaded.from === 'db' ? ' + ตารางรหัสย่อยในฐาน' : ''}${RESET}`);
  } catch (e) {
    if (!(e instanceof NoBook)) throw e;
    console.log(`${e.message}\n\nสรุป: ${RED}ตอบไม่ได้${RESET} — ยังไม่มีสมุดราคา (แบบต้องอ่านรหัสผ่านหน้าคำนวณราคา)\n`);
    process.exitCode = 1;
    return;
  }

  const codes = await realCodes();
  const t0 = Date.now();
  interface FamilyStat { total: number; draw: number; sendNow: number; sendConfirm: number; noDraw: Map<string, { n: number; sample: string }>; noSend: Map<string, { n: number; sample: string }>; confirm: Map<string, { n: number; sample: string }> }
  const stats = new Map<string, FamilyStat>();
  const noDrawingFamilies = new Map<string, number>();
  const cache = new Map<string, Measured>();
  let shapes = 0;
  const bump = (m: Map<string, { n: number; sample: string }>, key: string, reason: string) => {
    const x = m.get(key);
    if (x) x.n++; else m.set(key, { n: 1, sample: reason });
  };

  for (const code of codes) {
    const parsed = parseProductCode(code, book);
    const outcome = parsed.cfg ? computePrice(parsed.cfg, book) : null;
    const v = judge(parsed, outcome);
    const ts = parsed.tsForm, bh = parsed.form;
    const fam = ts?.family ?? bh?.family ?? null;
    const hasDrawing = fam === 'TS_-11' || fam === 'BH-01' || fam === 'BH-01C';
    if (!hasDrawing) {
      const label = fam ?? (parsed.model ? `${parsed.model} (ไม่มีช่องตามแคตตาล็อก)` : '(ไม่มีรุ่นในสมุดราคา)');
      noDrawingFamilies.set(label, (noDrawingFamilies.get(label) ?? 0) + 1);
      if (v.canDraw) fail(`${code}: ตระกูล ${label} ไม่มีแบบแต่ได้คำตัดสินว่าวาดได้`);
      continue;
    }
    const st = stats.get(fam) ?? { total: 0, draw: 0, sendNow: 0, sendConfirm: 0, noDraw: new Map(), noSend: new Map(), confirm: new Map() };
    stats.set(fam, st);
    st.total++;

    // ข้อ 5
    const why = mustNotDraw(ts, bh, parsed.cfg);
    if (why && v.canDraw) fail(`${code}: ข้อ 5 — ${why} แต่ได้คำตัดสินว่าวาดได้`);
    if (!v.canDraw) { for (const d of v.noDraw) bump(st.noDraw, d.key, d.reason); continue; }
    st.draw++;
    // ข้อ 6 (ข) — ทุกรหัสที่วาดได้ ไม่ว่าส่งได้หรือไม่
    const want = confirmableKeys(ts, bh), got = new Set(v.confirm.map((d) => d.key));
    for (const k of want) if (!got.has(k)) fail(`${code}: ข้อ 6 (ข) — มีส่วนท้ายที่ระบบไม่รู้จัก (${k}) แต่ไม่อยู่ในรายการให้ผู้เสนอราคายืนยัน`);
    for (const k of got) if (!want.includes(k)) fail(`${code}: ข้อ 6 (ข) — รายการยืนยันมี ${k} ทั้งที่ผลอ่านไม่มีส่วนนั้น`);
    for (const d of v.confirm) bump(st.confirm, d.key, d.reason);
    if (v.canSend) {
      if (v.confirm.length) st.sendConfirm++; else st.sendNow++;
      // ข้อ 6 (ก)
      const loose = blockingLooseness(ts, bh);
      if (loose) fail(`${code}: ข้อ 6 (ก) — ${loose} แต่ได้คำตัดสินว่าส่งได้`);
      if (!outcome || outcome.status === 'notManufacturable') fail(`${code}: ข้อ 6 (ก) — ผลคิดราคา ${outcome?.status ?? 'ว่าง'} แต่ส่งได้`);
    } else for (const d of v.noSend) bump(st.noSend, d.key, d.reason);

    // ข้อ 1–4
    const spec = v.spec as DrawingSpec;
    const key = spec.family === 'TS_-11'
      ? JSON.stringify([spec.family, spec.sensor, spec.spring, spec.dia, spec.tubeLen, spec.cable])
      : JSON.stringify([spec.family, spec.id, spec.h, spec.term, spec.mat]);
    let m = cache.get(key);
    if (!m) {
      m = measure(spec, code);
      cache.set(key, m);
      shapes++;
      for (const p of m.problems) fail(`${code}: ${p}`);
    }
    if (m.model) for (const p of threeWay(spec, m, parsed.cfg, ts, bh)) fail(`${code}: ${p}`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  // ── รายงาน ──
  let judged = 0;
  console.log(`รหัสจริงตระกูล TS/N/P/BH ในฐาน: ${codes.length.toLocaleString()} · รูปทรงไม่ซ้ำที่สร้างโมเดล/GLB/STEP: ${shapes.toLocaleString()} ${DIM}(${secs} วิ)${RESET}\n`);
  console.log(`${BOLD}ตระกูลที่มีแบบ${RESET}`);
  const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
  for (const [fam, s] of stats) {
    judged += s.total;
    console.log(`  ${fam.padEnd(8)} ${s.total.toLocaleString().padStart(6)} รหัส · วาดได้ ${s.draw.toLocaleString().padStart(6)} (${pct(s.draw, s.total)}) · ส่งได้ทันที ${s.sendNow.toLocaleString().padStart(6)} (${pct(s.sendNow, s.total)}) · ส่งได้หลังยืนยัน ${s.sendConfirm.toLocaleString().padStart(5)} (${pct(s.sendConfirm, s.total)})`);
    const list = (title: string, m: Map<string, { n: number; sample: string }>) => {
      if (!m.size) return;
      console.log(`    ${DIM}${title}${RESET}`);
      for (const [k, x] of [...m.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`      ${String(x.n).padStart(5)}  ${k.padEnd(18)} ${DIM}${x.sample}${RESET}`);
    };
    list('วาดไม่ได้ (รหัสหนึ่งนับได้หลายเหตุผล)', s.noDraw);
    list('วาดได้แต่ส่งไม่ได้', s.noSend);
    list('ต้องให้ผู้เสนอราคายืนยัน (แบบไม่ได้วาดส่วนนี้ · นับทั้งรหัสที่ส่งได้และไม่ได้)', s.confirm);
  }
  console.log(`\n${BOLD}ตระกูลที่ยังไม่มีแบบ${RESET} ${DIM}(เรียงตามจำนวนรหัสจริง)${RESET}`);
  for (const [fam, n] of [...noDrawingFamilies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(6)}  ${fam}`);
  if (noDrawingFamilies.size > 25) console.log(`  ${DIM}… อีก ${noDrawingFamilies.size - 25} กลุ่ม${RESET}`);

  console.log(`\n${BOLD}สิ่งที่ต้องจริงเสมอ${RESET}`);
  console.log(`  ${deps.length ? RED + '✗' : GREEN + '✓'}${RESET} ข้อ 8 ทิศการพึ่งพา (keyof สองทางตรวจตอน tsc แล้ว)`);
  for (const f of failures) console.log(`  ${RED}✗${RESET} ${f}`);
  if (failCount > MAX_REPORT) console.log(`  ${DIM}… และอีก ${failCount - MAX_REPORT} ข้อ${RESET}`);
  if (failCount === 0) console.log(`  ${GREEN}✓${RESET} ข้อ 1–7 ครบทุกรหัส (${judged.toLocaleString()} รหัสของตระกูลที่มีแบบ)`);

  const pass = failCount === 0 && judged > 0;
  console.log(`\n${'─'.repeat(70)}\nสรุป: ${pass ? `${GREEN}ผ่าน${RESET} — ทุกรหัสของตระกูลที่มีแบบได้คำตัดสิน และสิ่งที่ต้องจริงเสมอจริงทุกรหัส` : judged === 0 ? `${RED}ตอบไม่ได้${RESET} — ไม่มีรหัสของตระกูลที่มีแบบให้ตรวจ` : `${RED}ตก${RESET} — ${failCount} ข้อไม่จริง`}\n${'─'.repeat(70)}\n`);
  process.exitCode = pass ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
