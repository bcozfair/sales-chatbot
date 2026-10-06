// ─────────────────────────────────────────────────────────────────────────────
//  drawingGlb — ด่าน "ไฟล์ GLB ที่โมดูลแบบเขียน ถูกสเปกและถอดกลับได้เท่าต้นฉบับ" (diag:drawing-glb)
//
//  ต่อหนึ่งโมเดล: `writeGlb` → (1) ตัวถอดของด่านเอง (drawingGlbLib.ts — ไม่ใช้โค้ดของตัวเขียน) ตรวจโครง
//  แล้วเทียบกลับ: ชิ้นครบตามลำดับ · positions/normals = `Math.fround(ต้นฉบับ)` · index เท่าเดิม · สีเท่าเดิม
//  (2) **gltf-validator ของ Khronos** ต้องไม่มี error และไม่มี warning · (3) เขียนซ้ำได้ไบต์เดิม (ผลนิ่ง)
//
//  ชุดโมเดล: TS_-11 / BH-01 / BH-01C ตัวแทนทุกชนิดขั้วไฟ-สาย-สปริง (+ รูเจาะ · termPos) + ชิ้นสังเคราะห์ที่จุดเกิน 65,535
//  (บังคับทาง index uint32 ซึ่งโมเดลจริงวันนี้ไม่ถึง) · รหัสจริงทุกตัวในฐานถูกตรวจซ้ำด้วยตัวถอดเดียวกันใน diag:drawing-coverage
//
//  ไม่แตะฐาน ไม่เขียนไฟล์ ⇒ รันบน PMSV ได้
// ─────────────────────────────────────────────────────────────────────────────

import validator from 'gltf-validator';
import { buildModel } from '../../services/drawing/families/registry.js';
import type { DrawingModel, DrawingSpec, Part, Ts11Spec } from '../../services/drawing/types.js';
import { writeGlb } from '../../services/drawing/writers/glb.js';
import { decodeGlb, roundtripProblems } from './drawingGlbLib.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';

const ts = (o: Partial<Ts11Spec>): Ts11Spec => ({
  family: 'TS_-11', sensor: 'TSK', spring: 'NONE', dia: '6', mat: 'NONE', tubeLen: 100, elem: 'NONE', cableLen: 2, cable: 'NONE', ground: 'NONE', ...o,
});
const band = { t: 4, v: '220', w: 800, mat: 'NONE' as const, conn: null, termPos: null, holes: [] };

const SPECS: { label: string; spec: DrawingSpec }[] = [
  { label: 'TS_-11 TSK แกน 6 สปริง สายสแตนเลสถัก', spec: ts({}) },
  { label: 'TS_-11 TSP 3 สาย ไม่มีสปริง สาย P', spec: ts({ sensor: 'TSP', spring: 'P', cable: 'P', ground: 'U' }) },
  { label: 'TS_-11 N10 แกน 5 สาย T', spec: ts({ sensor: 'N10', dia: '5', cable: 'T', ground: 'U' }) },
  { label: 'TS_-11 แกน 2 สปริง 50 สาย TS', spec: ts({ dia: '2', tubeLen: 30, cable: 'TS' }) },
  { label: 'BH-01 120x60 สาย 2 M', spec: { family: 'BH-01', id: 120, h: 60, term: '2', ...band } },
  { label: 'BH-01 ขั้วน็อต สังกะสี', spec: { family: 'BH-01', id: 165, h: 100, term: 'N', ...band, mat: 'Z' } },
  { label: 'BH-01 เต๋าเซรามิก', spec: { family: 'BH-01', id: 180, h: 40, term: 'T', ...band } },
  { label: 'BH-01 ปลั๊ก PL2 / termPos 100', spec: { family: 'BH-01', id: 80, h: 50, term: 'PL2', ...band, termPos: 100 } },
  { label: 'BH-01 ปลั๊ก PL5 + รูเจาะ', spec: { family: 'BH-01', id: 100, h: 60, term: 'PL5', ...band, holes: [{ x: 50, y: 30, d: 8 }, { x: 2, y: 20, d: 10 }] } },
  { label: 'BH-01 สาย 30 cm 25x25', spec: { family: 'BH-01', id: 25, h: 25, term: 'NONE', ...band } },
  { label: 'BH-01C ปลั๊ก PL5', spec: { family: 'BH-01C', id: 150, h: 120, term: 'PL5', ...band, conn: 'PL' } },
  { label: 'BH-01C ขั้วน็อต SE + รูเจาะ', spec: { family: 'BH-01C', id: 100, h: 80, term: 'N', ...band, conn: 'SE', holes: [{ x: 30, y: 40, d: 12 }] } },
];

/** ชิ้นสังเคราะห์ 300 × 300 จุด (90,000 > 65,535) — ทาง index uint32 */
function bigGrid(): DrawingModel {
  const n = 300, part: Part = { name: 'grid_uint32', colour: [.5, .6, .7], positions: [], normals: [], triangles: [], edges: [] };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { part.positions.push(i * 0.5, j * 0.5, Math.sin(i / 10) * 2); part.normals.push(0, 0, 1); }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) {
    const a = i * n + j, b = a + 1, c = a + n, d = c + 1;
    part.triangles.push(a, c, b, b, c, d);
  }
  return { parts: [part], solids: [] };
}

async function main(): Promise<void> {
  console.log(`\n${BOLD}ด่านไฟล์ GLB ของโมดูลแบบ 3 มิติ${RESET} ${DIM}(gltf-validator ${validator.version()})${RESET}\n`);
  const cases: { label: string; model: DrawingModel }[] = SPECS.map((s) => ({ label: s.label, model: buildModel(s.spec) }));
  cases.push({ label: 'สังเคราะห์: 90,000 จุด (index uint32)', model: bigGrid() });

  let failed = 0;
  for (const c of cases) {
    const problems: string[] = [];
    const glb = writeGlb(c.model, c.label);
    const { parts, problems: structural } = decodeGlb(glb);
    problems.push(...structural, ...roundtripProblems(c.model, parts));
    if (!writeGlb(c.model, c.label).equals(glb)) problems.push('เขียนซ้ำได้ไบต์ไม่เท่าเดิม');
    const report = await validator.validateBytes(new Uint8Array(glb), { maxIssues: 20 });
    const { numErrors, numWarnings, numInfos, numHints, messages } = report.issues;
    if (numErrors || numWarnings) problems.push(`gltf-validator: error ${numErrors} · warning ${numWarnings} — ${messages.filter((m) => m.severity <= 1).slice(0, 3).map((m) => `${m.code} ${m.pointer ?? ''}`).join(' · ')}`);
    const ok = problems.length === 0;
    if (!ok) failed++;
    const verts = c.model.parts.reduce((s, p) => s + p.positions.length / 3, 0);
    console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${RESET} ${c.label.padEnd(40)} ${String(c.model.parts.length).padStart(3)} ชิ้น · ${verts.toLocaleString().padStart(7)} จุด · ${glb.length.toLocaleString().padStart(9)} ไบต์ ${DIM}(info ${numInfos} · hint ${numHints})${RESET}`);
    for (const p of problems.slice(0, 5)) console.log(`      ${RED}${p}${RESET}`);
  }

  const pass = failed === 0 && cases.length > 0;
  console.log(`\n${'─'.repeat(70)}\nสรุป: ${pass ? `${GREEN}ผ่าน${RESET} — ${cases.length} ไฟล์ ถูกสเปก ถอดกลับเท่าต้นฉบับ และเขียนซ้ำได้ไบต์เดิม` : `${RED}ตก${RESET} — ${failed}/${cases.length} ไฟล์มีปัญหา`}\n${'─'.repeat(70)}\n`);
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
