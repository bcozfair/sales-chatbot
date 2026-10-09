// ─────────────────────────────────────────────────────────────────────────────
//  ภาพฉาย 2 มิติของ spec — ทางเดียวที่ส่วนอื่นเรียก (ไม่ต้องรู้ว่าตระกูลไหนอยู่ไฟล์ไหน)
//
//  **พอร์ตตัววาด 2 มิติของ Appsale ทีละตระกูล (`views.ortho`) ไม่ใช่ฉายจากโมเดลอัตโนมัติ** (เปลี่ยนจากแผน §2.6 A2 ฉบับแรก · 2026-10-09)
//  เหตุผล: (1) ภาพที่เจ้าของเคาะใน mockup รอบ 2–5 คือผลของตัววาดชุดนี้ · (2) สัญลักษณ์แบบแคตตาล็อก (ลายสายถัก · สปริงซิกแซก ·
//  หางปลา · กล่องขั้วไฟ) ฉายจาก mesh ไม่ได้ · (3) ตำแหน่งยังมาจากจุดยึดของโมเดลชุดเดียวกับ STEP (TS) / สูตรเดียวกับโมเดล (BH)
//  จึงไม่ขัดกับภาพ 3 มิติ · ด่าน `diag:drawing-port` ส่วน จ เทียบ SVG ทั้งสตริงกับต้นฉบับ
//  · ภาษาไทยภาษาเดียวตามต้นฉบับ — ภาษาอังกฤษของกระดาษมากับเฟส 2 (ภาษาเลือกตอนสร้างลิงก์ §5.4 ข้อ 8)
// ─────────────────────────────────────────────────────────────────────────────

import type { DrawingSpec } from '../types.js';
import { SW, SH } from './draw.js';
import { SHEET_DEFS, SHEET_FONT } from './style.js';
import { bandOrtho } from './bh-01.js';
import { ts11Ortho } from './ts-11.js';
import type { OrthoBox, OrthoView } from './types.js';

export type { OrthoBox, OrthoView } from './types.js';

/** กรอบภาพของกระดาษแบบ (`BOX` ของ `engine/sheet.js`) — ภาพเดียว / ซ้าย / ขวา ของโหมดคู่ */
export const SHEET_BOX = {
  single: { cx: 470, cy: 244, w: 880, h: 292 },
  left: { cx: 252, cy: 244, w: 432, h: 292 },
  right: { cx: 688, cy: 244, w: 440, h: 292 },
} as const satisfies Record<string, OrthoBox>;

/** ภาพฉาย 2 มิติ — `code` = รหัสที่พิมพ์ใต้ภาพ (TS) */
export function orthoView(spec: DrawingSpec, box: OrthoBox, code: string): OrthoView {
  switch (spec.family) {
    case 'TS_-11': return ts11Ortho(spec, box, code);
    case 'BH-01':
    case 'BH-01C': return bandOrtho(spec, box);
  }
}

/** ภาพฉาย 2 มิติเป็น `<svg>` ทั้งชิ้นสำหรับแสดงบนจอ — viewBox ของกระดาษทั้งแผ่น (หน้าจอตัดกรอบตามเนื้อภาพเองด้วย getBBox) */
export function orthoSvg(spec: DrawingSpec, code: string): string {
  const v = orthoView(spec, SHEET_BOX.single, code);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${SH}" font-family="${SHEET_FONT}" role="img" aria-label="ภาพฉาย 2 มิติ">${SHEET_DEFS}${v.svg}</svg>`;
}
