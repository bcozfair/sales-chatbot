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
import { TS01, TS010, TS02, TS03, TS05 } from './tsCable.js';

export const FAMILIES: { [K in DrawingSpec['family']]: DrawingFamily<Extract<DrawingSpec, { family: K }>> } = {
  'TS_-11': TS11,
  'BH-01': BH01,
  'BH-01C': BH01C,
  'TS_-01': TS01,
  'TS_-01-0': TS010,
  'TS_-02': TS02,
  'TS_-03': TS03,
  'TS_-05': TS05,
};

/** โมเดลของ spec — ทางเดียวที่ส่วนอื่นเรียก (ไม่ต้องรู้ว่าตระกูลไหนอยู่ไฟล์ไหน) */
export function buildModel(spec: DrawingSpec): DrawingModel {
  const family = FAMILIES[spec.family] as DrawingFamily<DrawingSpec>;
  return family.model(spec);
}
