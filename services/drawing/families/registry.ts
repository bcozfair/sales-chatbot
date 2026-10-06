// ─────────────────────────────────────────────────────────────────────────────
//  ทะเบียนตระกูลที่มีแบบ (= `registry.js` ของ Appsale) — เพิ่มตระกูล = ไฟล์ใหม่ใน families/ + 1 บรรทัดที่นี่
//
//  type ของ `FAMILIES` ผูกกับ `DrawingSpec` ⇒ เพิ่มตระกูลใน union แล้วลืมลงทะเบียน = **typecheck ล้ม**
//  (ไม่ใช่ "รุ่นนี้ยังไม่มีแบบ" เงียบ ๆ) · ต่างจาก Appsale ที่เรียงลำดับเพื่อให้ prefix ยาวชนะ —
//  ที่นี่ไม่มีตัวอ่านรหัส ตระกูลมาจากผลอ่านของหน้าคำนวณราคาตรง ๆ จึงไม่มีเรื่องลำดับ
// ─────────────────────────────────────────────────────────────────────────────

import type { DrawingFamily, DrawingModel, DrawingSpec } from '../types.js';
import { BH01, BH01C } from './bh-01.js';
import { TS11 } from './ts-11.js';

export const FAMILIES: { [K in DrawingSpec['family']]: DrawingFamily<Extract<DrawingSpec, { family: K }>> } = {
  'TS_-11': TS11,
  'BH-01': BH01,
  'BH-01C': BH01C,
};

/** โมเดลของ spec — ทางเดียวที่ส่วนอื่นเรียก (ไม่ต้องรู้ว่าตระกูลไหนอยู่ไฟล์ไหน) */
export function buildModel(spec: DrawingSpec): DrawingModel {
  const family = FAMILIES[spec.family] as DrawingFamily<DrawingSpec>;
  return family.model(spec);
}
