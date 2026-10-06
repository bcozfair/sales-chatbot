// ─────────────────────────────────────────────────────────────────────────────
//  เขียนไฟล์ STEP (ISO 10303-21 · AP214) แบบผิวเหลี่ยมมีสี — พอร์ตจาก Appsale `engine/step.js`
//
//  หนึ่งชิ้น = หนึ่ง FACETED_BREP (solid ปิด) + สีของชิ้น · หน่วย mm · ผิวเหลี่ยมโดยตั้งใจ
//  (ไม่ใช่แบบผลิตผิวโค้งจริง — หัวหน้าเคาะ §9 ข้อ 5 ของแผน "พอสำหรับเฟส 1–3")
//
//  **พอร์ตทีละบรรทัด** — `diag:drawing-port` เทียบไฟล์ทั้งไฟล์กับต้นฉบับทุกตัวอักษร ยกเว้นบรรทัด FILE_NAME:
//    · ลำดับการเรียก `add()` คือเลข `#id` ของทั้งไฟล์ — แยกนิพจน์ที่ซ้อนกันเป็นตัวแปรเมื่อไหร่ id เพี้ยนทั้งไฟล์
//    · ตัวเลขเขียนด้วย `Number(n.toFixed(7)).toString()` แล้วเติม `.` เมื่อไม่มีจุด/ตัว e (ค่าเดียวกับต้นฉบับ)
//  ต่างจากต้นฉบับสองที่ (อยู่ในบรรทัด FILE_NAME ทั้งคู่): ชื่อระบบ "Primus Quotation System" แทน "Heater Designer"
//  และเวลาส่งเข้ามาได้ (`timestamp`) — ไม่ส่ง = เวลาปัจจุบันแบบต้นฉบับ
//
//  ทางที่ไม่ได้เลือก:
//    · ทาง `part.step` (หน้าเหลี่ยมหลายมุม — ฮีตเตอร์ครีบ/BH-02/03) — TS_-11 กับ BH-01 ไม่มีชิ้นแบบนั้น ⇒ เฟส 1
//    · `weldSolid` อยู่ที่ families/bh-01.ts ไม่ใช่ที่นี่ — มีผู้ใช้ตระกูลเดียว และเป็นการเตรียมชิ้น ไม่ใช่การเขียนไฟล์
// ─────────────────────────────────────────────────────────────────────────────

import type { StepSolid } from '../types.js';

/** ชื่อระบบในหัวไฟล์ (ช่อง originating_system / authorisation ของ FILE_NAME) */
const SYSTEM_NAME = 'Primus Quotation System';

/**
 * solids → ข้อความไฟล์ STEP · `name` = ชื่อสินค้า (รหัส) ลงทั้ง PRODUCT และ FILE_NAME
 * อักขระนอก ASCII ที่พิมพ์ได้กลายเป็น `_` (แบบต้นฉบับ — STEP เก่าหลายโปรแกรมอ่าน UTF-8 ไม่ได้)
 */
export function writeStep(solids: StepSolid[], name: string, opts: { timestamp?: string } = {}): string {
  const records: string[] = [];
  const add = (s: string): string => { records.push(`#${records.length+1}=${s};`); return `#${records.length}`; };
  const str = (s: string): string => String(s).replace(/'/g, "''").replace(/[^\x20-\x7e]/g, '_');
  const number = (n: number): string => { if (!Number.isFinite(n)) throw Error('Invalid STEP coordinate'); const s = Number(n.toFixed(7)).toString(); return /[.e]/i.test(s) ? s : s+'.'; };
  const app = add("APPLICATION_CONTEXT('automotive design')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${app})`);
  const pc = add(`PRODUCT_CONTEXT('',${app},'mechanical')`);
  const prod = add(`PRODUCT('${str(name)}','${str(name)}','Catalogue reference model',(${pc}))`);
  const formation = add(`PRODUCT_DEFINITION_FORMATION('','',${prod})`);
  const dc = add(`PRODUCT_DEFINITION_CONTEXT('part definition',${app},'design')`);
  const def = add(`PRODUCT_DEFINITION('design','',${formation},${dc})`);
  const shape = add(`PRODUCT_DEFINITION_SHAPE('','',${def})`);
  const mm = add('(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))');
  const rad = add('(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))');
  const sr = add('(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())');
  const uncertainty = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.000001),${mm},'distance_accuracy_value','')`);
  const context = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr})) REPRESENTATION_CONTEXT('',''))`);
  const solidIds: string[] = [], styles: string[] = [];
  for (const part of solids) {
    const points: string[] = [];
    for (let i = 0; i < part.positions.length; i += 3) points.push(add(`CARTESIAN_POINT('',(${part.positions.slice(i, i+3).map(number).join(',')}))`));
    const faces: string[] = [];
    for (let i = 0; i < part.triangles.length; i += 3) {
      const loop = add(`POLY_LOOP('',(${part.triangles.slice(i, i+3).map(j => points[j]).join(',')}))`);
      const bound = add(`FACE_OUTER_BOUND('',${loop},.T.)`);
      const ids = part.triangles.slice(i, i+3), xyz = ids.map(j => part.positions.slice(j*3, j*3+3));
      const u = xyz[1].map((x, k) => x-xyz[0][k]), v = xyz[2].map((x, k) => x-xyz[0][k]);
      const normal = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
      const unit = (a: number[]) => a.map(x => x/Math.hypot(...a));
      const axis = add(`DIRECTION('',(${unit(normal).map(number).join(',')}))`);
      const ref = add(`DIRECTION('',(${unit(u).map(number).join(',')}))`);
      const placement = add(`AXIS2_PLACEMENT_3D('',${points[ids[0]]},${axis},${ref})`);
      const plane = add(`PLANE('',${placement})`);
      faces.push(add(`FACE_SURFACE('',(${bound}),${plane},.T.)`));
    }
    const shell = add(`CLOSED_SHELL('',(${faces.join(',')}))`);
    const solid = add(`FACETED_BREP('${str(part.name)}',${shell})`); solidIds.push(solid);
    const colour = add(`COLOUR_RGB('',${part.colour.map(number).join(',')})`);
    const fill = add(`FILL_AREA_STYLE_COLOUR('',${colour})`);
    const area = add(`FILL_AREA_STYLE('',(${fill}))`);
    const surface = add(`SURFACE_STYLE_FILL_AREA(${area})`);
    const side = add(`SURFACE_SIDE_STYLE('',(${surface}))`);
    const usage = add(`SURFACE_STYLE_USAGE(.BOTH.,${side})`);
    const assignment = add(`PRESENTATION_STYLE_ASSIGNMENT((${usage}))`);
    styles.push(add(`STYLED_ITEM('',(${assignment}),${solid})`));
  }
  const representation = add(`FACETED_BREP_SHAPE_REPRESENTATION('',(${solidIds.join(',')}),${context})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${shape},${representation})`);
  add(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${styles.join(',')}),${context})`);
  const at = opts.timestamp ?? new Date().toISOString();
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Coloured catalogue reference; illustrative fittings; faceted geometry'),'2;1');\nFILE_NAME('${str(name)}.step','${at}',(''),(''),'${SYSTEM_NAME}','${SYSTEM_NAME}','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n${records.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
