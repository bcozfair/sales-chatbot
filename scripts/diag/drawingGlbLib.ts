// ─────────────────────────────────────────────────────────────────────────────
//  ตัวถอดไฟล์ GLB + ตัวตรวจโครง — ใช้ร่วมกันระหว่าง diag:drawing-glb และ diag:drawing-coverage
//
//  เขียนแยกจาก `services/drawing/writers/glb.ts` โดยตั้งใจ: ตัวถอดที่ใช้โค้ดชุดเดียวกับตัวเขียนจะ "ผ่าน" ไฟล์ที่ผิด
//  แบบเดียวกันเสมอ · ที่นี่อ่านตามสเปก glTF 2.0 ตรง ๆ (header · chunk · bufferView · accessor) แล้วเทียบกลับกับโมเดลต้นฉบับ
//  ส่วนความถูกต้องตามสเปกครบชุดเป็นงานของ gltf-validator (Khronos) ใน diag:drawing-glb
//
//  ไม่แตะฐาน ไม่เขียนไฟล์ — รับไบต์ คืนรายการปัญหา
// ─────────────────────────────────────────────────────────────────────────────

import type { DrawingModel } from '../../services/drawing/types.js';

interface Accessor { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }
interface BufferView { buffer: number; byteOffset?: number; byteLength: number; target?: number }
interface Gltf {
  asset: { version: string };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: { name?: string; mesh?: number; children?: number[]; scale?: number[] }[];
  meshes: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials: { pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
  accessors: Accessor[];
  bufferViews: BufferView[];
  buffers: { byteLength: number }[];
}

/** หนึ่งชิ้นที่ถอดกลับมา */
export interface DecodedPart {
  name: string;
  colour: number[];
  positions: Float32Array;
  normals: Float32Array;
  indices: number[];
}

/**
 * ถอด + ตรวจโครง: magic/เวอร์ชัน/ความยาว · ตัวเติมของ chunk (JSON = 0x20 · BIN = 0x00) · bufferView อยู่ในขอบและหาร 4 ลงตัว
 * · min/max ของ POSITION ตรงกับค่าจริง · index < จำนวนจุด · normal ยาว 1 (±5e-4) · node ราก scale 0.001
 */
export function decodeGlb(bytes: Buffer): { parts: DecodedPart[]; problems: string[] } {
  const problems: string[] = [];
  const parts: DecodedPart[] = [];
  if (bytes.length < 28) return { parts, problems: ['ไฟล์สั้นกว่า header + chunk'] };
  if (bytes.readUInt32LE(0) !== 0x46546c67) problems.push('magic ไม่ใช่ glTF');
  if (bytes.readUInt32LE(4) !== 2) problems.push(`เวอร์ชัน ${bytes.readUInt32LE(4)} ไม่ใช่ 2`);
  if (bytes.readUInt32LE(8) !== bytes.length) problems.push(`ความยาวใน header ${bytes.readUInt32LE(8)} ≠ ขนาดไฟล์ ${bytes.length}`);
  const jsonLen = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) problems.push('chunk แรกไม่ใช่ JSON');
  if (jsonLen % 4 !== 0) problems.push('chunk JSON ยาวไม่หาร 4 ลงตัว');
  const jsonBytes = bytes.subarray(20, 20 + jsonLen);
  const binAt = 20 + jsonLen;
  if (binAt + 8 > bytes.length) return { parts, problems: [...problems, 'ไม่มี chunk BIN'] };
  const binLen = bytes.readUInt32LE(binAt);
  if (bytes.readUInt32LE(binAt + 4) !== 0x004e4942) problems.push('chunk ที่สองไม่ใช่ BIN');
  if (binLen % 4 !== 0) problems.push('chunk BIN ยาวไม่หาร 4 ลงตัว');
  if (binAt + 8 + binLen !== bytes.length) problems.push('มีไบต์เกินหลัง chunk BIN');
  const bin = bytes.subarray(binAt + 8, binAt + 8 + binLen);

  let gltf: Gltf;
  try {
    let pad = 0;
    for (let k = jsonBytes.length - 1; k >= 0 && jsonBytes[k] === 0x20; k--) pad++;
    if (pad > 3) problems.push(`ตัวเติม JSON เกิน 3 ไบต์ (${pad})`);
    gltf = JSON.parse(jsonBytes.toString('utf8')) as Gltf;
  } catch (e) {
    return { parts, problems: [...problems, `JSON อ่านไม่ได้: ${e instanceof Error ? e.message : String(e)}`] };
  }
  if (gltf.asset?.version !== '2.0') problems.push('asset.version ไม่ใช่ 2.0');
  if (gltf.buffers?.[0]?.byteLength !== binLen) problems.push(`buffers[0].byteLength ${gltf.buffers?.[0]?.byteLength} ≠ BIN ${binLen}`);

  for (const [i, v] of gltf.bufferViews.entries()) {
    const off = v.byteOffset ?? 0;
    if (off % 4 !== 0) problems.push(`bufferView ${i} เริ่มที่ ${off} ไม่หาร 4 ลงตัว`);
    if (off + v.byteLength > binLen) problems.push(`bufferView ${i} เกินขอบ BIN`);
  }
  const read = (acc: number, comps: number): number[] | Float32Array => {
    const a = gltf.accessors[acc];
    const v = gltf.bufferViews[a.bufferView];
    const off = v.byteOffset ?? 0;
    const n = a.count * comps;
    if (a.componentType === 5126) return new Float32Array(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + n * 4));
    const out: number[] = new Array(n);
    for (let k = 0; k < n; k++) out[k] = a.componentType === 5123 ? bin.readUInt16LE(off + k * 2) : bin.readUInt32LE(off + k * 4);
    return out;
  };

  const root = gltf.nodes[gltf.scenes[gltf.scene].nodes[0]];
  if (!root || JSON.stringify(root.scale) !== '[0.001,0.001,0.001]') problems.push('node รากไม่ได้ scale 0.001');
  for (const childId of root?.children ?? []) {
    const node = gltf.nodes[childId];
    const mesh = gltf.meshes[node.mesh ?? -1];
    if (!mesh || mesh.primitives.length !== 1) { problems.push(`node ${node.name}: ต้องมี mesh เดียว primitive เดียว`); continue; }
    const prim = mesh.primitives[0];
    if ((prim.mode ?? 4) !== 4) problems.push(`node ${node.name}: mode ไม่ใช่สามเหลี่ยม`);
    const pa = gltf.accessors[prim.attributes.POSITION], na = gltf.accessors[prim.attributes.NORMAL];
    if (pa.componentType !== 5126 || pa.type !== 'VEC3' || na.componentType !== 5126 || na.type !== 'VEC3') problems.push(`node ${node.name}: POSITION/NORMAL ไม่ใช่ float32 VEC3`);
    const positions = read(prim.attributes.POSITION, 3) as Float32Array;
    const normals = read(prim.attributes.NORMAL, 3) as Float32Array;
    const indices = Array.from(read(prim.indices ?? -1, 1));
    const ia = gltf.accessors[prim.indices ?? -1];
    if (ia.componentType !== (pa.count > 65535 ? 5125 : 5123)) problems.push(`node ${node.name}: ชนิด index ไม่ตรงกับจำนวนจุด`);
    // min/max ต้องเท่าค่าจริงทุกแกน (สเปกบังคับ — validator ตรวจด้วย)
    for (let ax = 0; ax < 3; ax++) {
      let mn = Infinity, mx = -Infinity;
      for (let k = ax; k < positions.length; k += 3) { mn = Math.min(mn, positions[k]); mx = Math.max(mx, positions[k]); }
      if (pa.min?.[ax] !== mn || pa.max?.[ax] !== mx) problems.push(`node ${node.name}: min/max แกน ${ax} ไม่ตรงค่าจริง`);
    }
    if (indices.some((t) => t >= pa.count)) problems.push(`node ${node.name}: index เกินจำนวนจุด`);
    for (let k = 0; k < normals.length; k += 3) {
      const len = Math.hypot(normals[k], normals[k + 1], normals[k + 2]);
      if (Math.abs(len - 1) > 5e-4) { problems.push(`node ${node.name}: normal จุดที่ ${k / 3} ยาว ${len}`); break; }
    }
    const colour = gltf.materials[prim.material ?? -1]?.pbrMetallicRoughness?.baseColorFactor ?? [];
    parts.push({ name: node.name ?? '', colour, positions, normals, indices });
  }
  return { parts, problems };
}

/** ถอดกลับแล้วต้องเท่าต้นฉบับ: ชิ้นครบตามลำดับ · positions/normals = Math.fround(ต้นฉบับ) · index เท่าเดิม · สีเท่าเดิม */
export function roundtripProblems(model: DrawingModel, decoded: DecodedPart[]): string[] {
  const out: string[] = [];
  if (decoded.length !== model.parts.length) return [`จำนวนชิ้น ${decoded.length} ≠ ${model.parts.length}`];
  model.parts.forEach((p, i) => {
    const d = decoded[i];
    if (d.name !== p.name) out.push(`ชิ้นที่ ${i}: ชื่อ ${d.name} ≠ ${p.name}`);
    if (d.colour.length !== 4 || d.colour[3] !== 1 || p.colour.some((c, k) => d.colour[k] !== c)) out.push(`ชิ้น ${p.name}: สีไม่ตรง`);
    const cmp = (name: string, a: Float32Array, b: number[]) => {
      if (a.length !== b.length) return out.push(`ชิ้น ${p.name}.${name}: ยาว ${a.length} ≠ ${b.length}`);
      for (let k = 0; k < a.length; k++) if (!Object.is(a[k], Math.fround(b[k]))) return out.push(`ชิ้น ${p.name}.${name}[${k}]: ${a[k]} ≠ fround(${b[k]})`);
    };
    cmp('positions', d.positions, p.positions);
    cmp('normals', d.normals, p.normals);
    if (d.indices.length !== p.triangles.length || d.indices.some((t, k) => t !== p.triangles[k])) out.push(`ชิ้น ${p.name}: index ไม่เท่าเดิม`);
  });
  return out;
}
