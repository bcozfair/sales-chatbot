/**
 * productNamePattern — เลือกต้นแบบ + ตั้งชื่อสินค้าใหม่จาก model ล้วน ๆ **ไม่แตะฐาน**
 * (แผน docs/plan-local-products.md §13.2–13.3 · เจ้าของเคาะ 2026-10-01)
 *
 * ── ต้นแบบ (§13.2) ──────────────────────────────────────────────────────────────
 * key ของ model = ส่วนหัวตาม MODEL_KEY (`TSK-04(S2)6x50+5M` → `TSK-04(S2)`) · แยกสั่งทำ/มาตรฐานด้วย
 * `-S###` ใน model ↔ `CU` ในรหัส · ตระกูล (10 ตัวแรกของรหัส) ที่มีสมาชิกมากสุดในกลุ่มชนะ ·
 * ต้นแบบ = แถวในตระกูลนั้นที่ model ขึ้นต้นเหมือน model ใหม่ยาวที่สุด
 * วัด 2026-10-01: ตระกูลที่เลือกตรงของจริง 93.29% (ไม่ใช่ CU) · 92.54% (CU)
 * ⇒ **จอต้องแสดงต้นแบบพร้อมปุ่มเปลี่ยนเสมอ** · ไม่เจอเลย = ให้คนเลือก **ห้ามเดา**
 *
 * ── ชื่อ (§13.3) ────────────────────────────────────────────────────────────────
 * 97.5% ของชื่อ = คำนำหน้า + model ⇒ ชื่อใหม่ = คำนำหน้าของ **ต้นแบบ** + model ใหม่
 * (คำนำหน้าที่ตระกูลใช้มากสุดตรงแค่ 88.47% ⇒ เป็นแค่ทางถอย)
 * ⚠️ **ห้าม trim/normalize คำนำหน้า** — ของจริงมีเว้นวรรคสองช่องและช่องว่างแปลก ๆ ลอกตามที่เป็น
 */
import { describeRef } from './productRefPattern.js';

/**
 * ส่วนหัวของ model — **`(?:…)` ไม่ใช่ `(…)`** (ใน SQL `substring(… from …)` ที่มีกลุ่มจับจะคืนแค่กลุ่ม
 * · พลาดมาแล้วรอบวัดแรก §13.7) — ฝั่ง JS ใช้ match[0] จึงไม่โดน แต่รูปเดียวกันทั้งสองที่
 */
export const MODEL_KEY = /^[A-Za-z]+-?[0-9]*[A-Za-z]?(?:\([^)]*\))?/;
const MODEL_KEY_BARE = /^[A-Za-z]+-?[0-9]*[A-Za-z]?/;

/** สินค้าสั่งทำ — 98.5% ของรหัส `CU` มี `-S<เลข 3 หลัก>` ใน model (§1.1) */
const CUSTOM_MARK = /-S\d{3}/;

export function modelKey(model: string): string {
  return MODEL_KEY.exec(model)?.[0] ?? '';
}

/** key ที่ตัดวงเล็บออก — ทางถอยเมื่อ key เต็มไม่เจอใคร (`TSK-04(S2)` → `TSK-04`) */
export function modelKeyBare(model: string): string {
  return MODEL_KEY_BARE.exec(model)?.[0] ?? '';
}

export function isCustomModel(model: string): boolean {
  return CUSTOM_MARK.test(model);
}

export function isCustomRef(ref: string): boolean {
  return describeRef(ref)?.isCustom ?? false;
}

/** คำนำหน้าชื่อ — `null` = ชื่อไม่ได้ลงท้ายด้วย model (2.5% ของฐาน) · `''` = ชื่อเท่ากับ model */
export function namePrefix(name: string | null | undefined, model: string | null | undefined): string | null {
  if (!name || !model) return null;
  return name.endsWith(model) ? name.slice(0, name.length - model.length) : null;
}

export interface ParentCandidate {
  internal_reference: string;
  model: string;
  name: string | null;
}

export type ParentReason = 'key' | 'key_bare';

export interface ParentPick<T extends ParentCandidate> {
  parent: T;
  /** สมาชิกของตระกูลที่ชนะ (ไว้หาคำนำหน้าชื่อสำรอง) */
  family: T[];
  /** ตระกูล = 10 ตัวแรกของรหัส */
  familyPrefix: string;
  /** สมาชิกในกลุ่ม key เดียวกัน (ทุกตระกูล) — จอบอกได้ว่า "เลือกจากกี่ตัว" */
  groupSize: number;
  reason: ParentReason;
  isCustom: boolean;
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function pickFromGroup<T extends ParentCandidate>(
  model: string, group: T[],
): { parent: T; family: T[]; familyPrefix: string } | null {
  if (group.length === 0) return null;
  const families = new Map<string, T[]>();
  for (const row of group) {
    const fam = row.internal_reference.slice(0, 10);
    const list = families.get(fam);
    if (list) list.push(row); else families.set(fam, [row]);
  }
  // ใหญ่สุดชนะ · เสมอกัน ⇒ ตระกูลที่มีรหัสล่าสุดสูงกว่า (เทียบแบบสตริง — ยาวเท่ากันทุกตัว)
  let best: { prefix: string; rows: T[]; maxRef: string } | null = null;
  for (const [prefix, rows] of families) {
    const maxRef = rows.reduce((m, r) => (r.internal_reference > m ? r.internal_reference : m), '');
    if (!best || rows.length > best.rows.length || (rows.length === best.rows.length && maxRef > best.maxRef)) {
      best = { prefix, rows, maxRef };
    }
  }
  if (!best) return null;
  // model ขึ้นต้นเหมือนกันยาวสุดชนะ · เสมอกัน ⇒ รหัสล่าสุด
  let parent = best.rows[0]!;
  let bestLen = -1;
  for (const row of best.rows) {
    const len = commonPrefixLength(row.model, model);
    if (len > bestLen || (len === bestLen && row.internal_reference > parent.internal_reference)) {
      parent = row;
      bestLen = len;
    }
  }
  return { parent, family: best.rows, familyPrefix: best.prefix };
}

/**
 * เลือกต้นแบบให้ model ใหม่จากสินค้าที่ส่งมา — คืน null = ให้คนเลือกเอง
 *
 * `candidates` คือสินค้าที่ model ขึ้นต้นด้วย key แบบไม่มีวงเล็บ (ผู้เรียกกรองมาจากฐาน) — ฟังก์ชันนี้
 * กรอง key ซ้ำเองอีกชั้น เพราะ "ขึ้นต้นด้วย" กว้างกว่า "key เท่ากัน" (`TSK-04` ขึ้นต้นด้วย `TSK-0`)
 * รหัสที่ไม่เข้ารูป 14 ตัว ใช้เป็นต้นแบบไม่ได้ (ออกเลขต่อไม่ได้) ⇒ ไม่นับ
 */
export function suggestParent<T extends ParentCandidate>(
  model: string, candidates: readonly T[],
): ParentPick<T> | null {
  const key = modelKey(model);
  if (!key) return null;
  const isCustom = isCustomModel(model);
  const usable = candidates.filter((c) =>
    describeRef(c.internal_reference) !== null && isCustomRef(c.internal_reference) === isCustom && !!c.model);

  const byKey = usable.filter((c) => modelKey(c.model) === key);
  const first = pickFromGroup(model, byKey);
  if (first) return { ...first, groupSize: byKey.length, reason: 'key', isCustom };

  const bare = modelKeyBare(model);
  if (!bare || bare === key) return null;
  const byBare = usable.filter((c) => modelKeyBare(c.model) === bare);
  const second = pickFromGroup(model, byBare);
  if (second) return { ...second, groupSize: byBare.length, reason: 'key_bare', isCustom };
  return null;
}

/**
 * ชื่อที่ตั้งให้ = คำนำหน้าของต้นแบบ ?? คำนำหน้าที่ตระกูลใช้มากสุด ?? '' แล้วต่อด้วย model ใหม่
 *
 * คำนำหน้าลอกตามที่เป็นทุกไบต์ (ไม่ trim) · ต้นแบบที่ชื่อไม่เข้ารูปแบบ ⇒ ถอยไปที่ตระกูล ไม่ใช่ว่าง
 */
export function suggestName(
  model: string,
  parent: ParentCandidate | null,
  family: readonly ParentCandidate[] = [],
): string {
  const own = parent ? namePrefix(parent.name, parent.model) : null;
  if (own !== null) return own + model;

  const counts = new Map<string, number>();
  for (const row of family) {
    const p = namePrefix(row.name, row.model);
    if (p === null) continue;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let top: string | null = null;
  let topN = 0;
  for (const [p, n] of counts) {
    if (n > topN) { top = p; topN = n; }
  }
  return (top ?? '') + model;
}
