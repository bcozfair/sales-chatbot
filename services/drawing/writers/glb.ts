// ─────────────────────────────────────────────────────────────────────────────
//  เขียนไฟล์ GLB (glTF 2.0 แบบไบนารี) จากโมเดล — ไฟล์ 3 มิติที่หน้าเว็บหมุน/ซูมได้ (เฟส 1–2)
//
//  เขียนเองใน Node ไม่ใช้ three.js ฝั่งเซิร์ฟเวอร์ — รูปแบบไฟล์เล็กและตายตัว (สเปก Khronos glTF 2.0 §4.4 GLB):
//    header 12 ไบต์ (magic `glTF` · version 2 · ความยาวทั้งไฟล์) → chunk JSON (เติม 0x20 ให้ครบ 4 ไบต์)
//    → chunk BIN (เติม 0x00) · little-endian ทั้งไฟล์
//  โครงฉาก: node รากหนึ่งตัว `scale = 0.001` (ข้อมูลเก็บเป็น mm แบบโมเดล · glTF นับเป็นเมตร) → ลูกหนึ่ง node ต่อชิ้น
//  = หนึ่ง mesh = หนึ่ง primitive สามเหลี่ยม (mode 4) ชื่อ = ชื่อชิ้น ⇒ ตัวดูเลือก/ซ่อนชิ้นตามชื่อได้
//  · POSITION / NORMAL เป็น float32 (POSITION มี min/max ตามสเปก) · index เป็น uint16 เมื่อจุดไม่เกิน 65,535 ไม่งั้น uint32
//  · ทุก bufferView เริ่มที่ไบต์หาร 4 ลงตัว · **ผลนิ่ง** — ไม่มีเวลา/สุ่มในไฟล์ (โมเดลเดิม = ไบต์เดิม เก็บแคช/เทียบได้)
//
//  วัสดุต่อชิ้นผ่าน `materialFor()` ที่เดียว — เฟส 0 = สีของชิ้น ไม่เงา ด้านสุด (metallic 0 · roughness 1)
//  ⚠️ สีของ Appsale เป็นค่า sRGB แต่ `baseColorFactor` ของ glTF เป็น linear ⇒ ภาพในตัวดูจะซีดกว่าภาพของ Appsale เล็กน้อย
//     ตั้งใจยังไม่แปลง — ตัดสินพร้อมวัสดุ PBR ต่อชนิดชิ้น (โลหะ/เทฟลอน/เซรามิก) ในเฟส 1 ที่จุดนี้จุดเดียว
//
//  ทางที่ไม่ได้เลือก:
//    · รวมทุกชิ้นเป็น mesh เดียว — เล็กกว่านิดเดียว แต่ตัวดูแยกวัสดุ/ซ่อนชิ้นไม่ได้
//    · ใช้ `solids` (จุดรวมแล้วของ BH) — ไม่มี normal ต่อจุด และขอบคมจะกลายเป็นมน ⇒ GLB ใช้ `parts` เสมอ
// ─────────────────────────────────────────────────────────────────────────────

import type { DrawingModel, Part } from '../types.js';

const GLB_MAGIC = 0x46546c67;      // 'glTF'
const CHUNK_JSON = 0x4e4f534a;     // 'JSON'
const CHUNK_BIN = 0x004e4942;      // 'BIN\0'
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126, UNSIGNED_SHORT = 5123, UNSIGNED_INT = 5125;
const TRIANGLES = 4;

/** วัสดุของชิ้น — จุดเดียวที่ตัดสินหน้าตาผิว (เฟส 1 แยกตามชนิดชิ้น) */
function materialFor(part: Part): { name: string; pbrMetallicRoughness: { baseColorFactor: number[]; metallicFactor: number; roughnessFactor: number } } {
  return {
    name: part.name,
    pbrMetallicRoughness: { baseColorFactor: [part.colour[0], part.colour[1], part.colour[2], 1], metallicFactor: 0, roughnessFactor: 1 },
  };
}

const pad4 = (n: number): number => (n + 3) & ~3;

/** โมเดล → ไบต์ของไฟล์ .glb · `name` = ชื่อ node ราก (รหัสสินค้า) */
export function writeGlb(model: DrawingModel, name: string): Buffer {
  if (model.parts.length === 0) throw new Error('GLB: โมเดลไม่มีชิ้น');
  const views: { byteOffset: number; byteLength: number; target: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const materials: ReturnType<typeof materialFor>[] = [];
  const nodes: Record<string, unknown>[] = [{ name, scale: [0.001, 0.001, 0.001], children: model.parts.map((_, i) => i + 1) }];
  const chunks: Buffer[] = [];
  let offset = 0;

  const addView = (bytes: Buffer, target: number): number => {
    views.push({ byteOffset: offset, byteLength: bytes.length, target });
    const padded = pad4(bytes.length);
    chunks.push(bytes);
    if (padded > bytes.length) chunks.push(Buffer.alloc(padded - bytes.length));
    offset += padded;
    return views.length - 1;
  };

  model.parts.forEach((part, i) => {
    const count = part.positions.length / 3;
    if (!Number.isInteger(count) || count === 0 || part.normals.length !== part.positions.length || part.triangles.length === 0 || part.triangles.length % 3 !== 0)
      throw new Error(`GLB: ชิ้น ${part.name} ข้อมูลไม่ครบ (จุด ${part.positions.length} · normal ${part.normals.length} · สามเหลี่ยม ${part.triangles.length})`);

    const pos = Buffer.alloc(count * 12), nrm = Buffer.alloc(count * 12);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < part.positions.length; k++) {
      const v = Math.fround(part.positions[k]);
      if (!Number.isFinite(v) || !Number.isFinite(part.normals[k])) throw new Error(`GLB: ชิ้น ${part.name} มีค่าที่ไม่ใช่ตัวเลข`);
      pos.writeFloatLE(v, k * 4);
      nrm.writeFloatLE(part.normals[k], k * 4);
      if (v < min[k % 3]) min[k % 3] = v;
      if (v > max[k % 3]) max[k % 3] = v;
    }
    const wide = count > 65535;
    const idx = Buffer.alloc(part.triangles.length * (wide ? 4 : 2));
    for (let k = 0; k < part.triangles.length; k++) {
      const t = part.triangles[k];
      if (!Number.isInteger(t) || t < 0 || t >= count) throw new Error(`GLB: ชิ้น ${part.name} index ${t} อยู่นอกจำนวนจุด ${count}`);
      if (wide) idx.writeUInt32LE(t, k * 4); else idx.writeUInt16LE(t, k * 2);
    }

    const pv = addView(pos, ARRAY_BUFFER), nv = addView(nrm, ARRAY_BUFFER), iv = addView(idx, ELEMENT_ARRAY_BUFFER);
    accessors.push({ bufferView: pv, componentType: FLOAT, count, type: 'VEC3', min, max });
    accessors.push({ bufferView: nv, componentType: FLOAT, count, type: 'VEC3' });
    accessors.push({ bufferView: iv, componentType: wide ? UNSIGNED_INT : UNSIGNED_SHORT, count: part.triangles.length, type: 'SCALAR' });
    materials.push(materialFor(part));
    meshes.push({ name: part.name, primitives: [{ attributes: { POSITION: i * 3, NORMAL: i * 3 + 1 }, indices: i * 3 + 2, material: i, mode: TRIANGLES }] });
    nodes.push({ name: part.name, mesh: i });
  });

  const bin = Buffer.concat(chunks, offset);
  const gltf = {
    asset: { version: '2.0', generator: 'Primus Quotation System (services/drawing)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews: views.map((v) => ({ buffer: 0, ...v })),
    buffers: [{ byteLength: bin.length }],
  };
  const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8');
  const json = Buffer.concat([jsonRaw, Buffer.alloc(pad4(jsonRaw.length) - jsonRaw.length, 0x20)]);

  const total = 12 + 8 + json.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(json.length, 12);
  out.writeUInt32LE(CHUNK_JSON, 16);
  json.copy(out, 20);
  const binAt = 20 + json.length;
  out.writeUInt32LE(bin.length, binAt);
  out.writeUInt32LE(CHUNK_BIN, binAt + 4);
  bin.copy(out, binAt + 8);
  return out;
}
