// ─────────────────────────────────────────────────────────────────────────────
//  TS_-11 — หัววัดแกนตรง + สปริงคลุมสาย + ออกสาย (Thermocouple / RTD / NTC / PTC)
//  ที่มา: แคตตาล็อก Primus TS-SERIES หน้า 15 · พอร์ตจาก Appsale `products/ts-11-model.js` (`BUILDERS['11']`)
//  + จำนวนสายต่อชนิดเซนเซอร์จาก `products/ts-11.js` / `ts-common.js`
//
//  รูปทรง: แกน D1 × L1 ปลายมน → สปริงลวดพันชิดบนสาย (50 / 130 ตามตาราง Diameter Tube · P = ไม่มีสปริง)
//  → สาย (สีปลอกตามชนิดสาย) → ปลอกถักท้าย → ลวดแยก + หางปลาแฉก
//  ⚠️ รูปอ้างอิง (แคตตาล็อกไม่ให้มิติ): สปริงลวด ⌀0.7 พิตช์ 1.5 (เทียบสปริง TS_-01 จาก CAD) · สายวาดย่อ 120 mm
//
//  **ช่องที่ไม่มีผลกับรูปทรง** (วัสดุ · Element · Ground · ความยาวสาย) อยู่ใน spec เพื่อให้ spec เป็นสินค้าทั้งชิ้น
//  แต่ `model()` ไม่อ่าน — ต้นฉบับก็ไม่อ่าน (cache key ของ Appsale = dia · tubeLen · spring · cable · leads)
//
//  ทางที่ไม่ได้เลือก: ยก `'11L'` (แกนงอ) และ `'12'` (ปลอกคอ) ที่อยู่ไฟล์เดียวกันมาด้วย — หน้าคำนวณราคาไม่มีตาราง
//  TS_-11L (อ่านรหัส 11L เป็น TS_-11 + `headJunk`) และ TS-12 ของ Appsale คือ TS_-12R ของหน้าคำนวณราคา ⇒ เฟส 1
//  ⚠️ ตั้งแต่ pricingLab `c80d688` ตัว L ท้ายเลขรุ่นถูกคิดเป็นกฎหัก L (`bend:L` ใน `cfg.options` · +100) ⇒ ไฟล์นี้วาดแกนตรงเท่านั้น
//     และ `spec/fromReading.ts` กันแกนหักจากสัญญาณนั้นก่อนถึงที่นี่ (ไม่พึ่ง `headJunk`) — ห้ามเรียก `model()` กับรหัสแกนหัก
// ─────────────────────────────────────────────────────────────────────────────

import type { DrawingFamily, Part, Ts11Spec } from '../types.js';
import { COLOURS as C, spring } from '../geometry/tsPrimitives.js';
import { JACKETS, SPRING_TS03, cableRadius, cableTail, probe } from './tsParts.js';

/** จำนวนสายตามชนิดเซนเซอร์ — Thermocouple / NTC / PTC = 2 (+ −) · RTD = 3 (A B b) */
export const SENSOR_LEADS: Record<Ts11Spec['sensor'], number> = {
  TSK: 2, TSJ: 2, TST: 2, TSP: 3, TSPA: 3, TSZ: 3, N2: 2, N10: 2, P2: 2, P10: 2,
};

/** สปริงกันสายหักแบบลวดเล็กพันชิดบนสาย (รูปอ้างอิง ตามสปริง TS_-01 ใน CAD: ลวด ⌀0.7 · พิตช์ 1.5) */
const THIN_SPRING = { wireR: .35, pitch: 1.5, clearance: .05 };
const springHelix = (cableR: number): number => cableR + THIN_SPRING.wireR + THIN_SPRING.clearance;

/** ความยาวสปริง (mm) — `P` = None Spring */
export const springLength = (spec: Ts11Spec): number => (spec.spring === 'P' ? 0 : SPRING_TS03(spec.dia));

export const TS11: DrawingFamily<Ts11Spec> = {
  id: 'TS_-11',
  source: { catalog: 'TS-SERIES TS_-11 หน้า 15', appsale: ['products/ts-11-model.js', 'products/ts-11.js', 'products/ts-series-parts.js', 'products/ts-series-model.js'] },
  model(spec) {
    const dia = Number(spec.dia);
    if (!Number.isFinite(dia) || !(dia > 0) || !Number.isFinite(spec.tubeLen) || !(spec.tubeLen > 0))
      throw new Error(`TS_-11: ขนาดแกน/ความยาวแกนไม่ใช่ตัวเลขบวก (${spec.dia} × ${spec.tubeLen})`);
    const parts: Part[] = [], tubeLen = spec.tubeLen, leads = SENSOR_LEADS[spec.sensor];
    const cableR = cableRadius(dia), springLen = springLength(spec);
    probe(parts, dia, tubeLen);
    // springAndCable() ของต้นฉบับ (x0 = 0)
    if (springLen > 0)
      spring(parts, 'strain_spring', 0, springLen, springHelix(cableR), THIN_SPRING.wireR, C.steel,
             { pitch: THIN_SPRING.pitch, perTurn: 8 });
    const runFrom = 0 + springLen;
    cableTail(parts, runFrom, cableR, JACKETS[spec.cable], leads, 0);
    return { parts, solids: parts };
  },
};
