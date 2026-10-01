/**
 * productRefPattern — ตรรกะของ `internal_reference` ล้วน ๆ **ไม่แตะฐาน** (แผน docs/plan-local-products.md §1 · §4.1)
 *
 * ── รหัส 14 อักขระ (วัด 2026-09-21: ทั้ง 51,648 รหัสยาวเท่ากันหมด) ───────────────────────
 *   F  CU  P2  TSK  04  0073
 *   │  │   │   │    └── 6 หลักท้าย = รุ่นย่อย + เลขวิ่ง **แบ่งไม่เท่ากันทุกตระกูล** (§1.3)
 *   │  │   │   └─────── ซีรีส์ 3 ตัว
 *   │  │   └─────────── แหล่งที่มา
 *   │  └─────────────── ประเภทสินค้า (CU = สั่งทำ)
 *   └────────────────── หมวด
 *
 * ── ทำไมต้องสืบทอดจากรหัสเดิม ไม่ประกอบจากคอลัมน์ ──────────────────────────────────
 * ช่อง 2–3 กับ `product_sub_category` ไม่ใช่หนึ่งต่อหนึ่ง (104 รหัส ต่อ 171 sub-category) ⇒
 * ไม่มีสูตรจากคอลัมน์ไหนประกอบ prefix ใหม่ได้ (§1.2) · ออกเลขด้วย "ต้นแบบ + พี่น้อง" เท่านั้น
 *
 * ── อัลกอริทึม 2 ชั้น (§1.4 · เจ้าของเคาะ 2026-09-21: ออกเลขให้ทุกกรณี พิมพ์ทับได้ทุกกรณี) ──
 *   ชั้น 1 `boundary`     — ขอบเลขวิ่งพิสูจน์ได้จากพี่น้อง (กลุ่มหนาแน่นพอจะเป็นตัวนับจริง)
 *   ชั้น 2 `max_plus_one` — นับต่อจากกลุ่มที่ใกล้ที่สุดให้เฉย ๆ ⇒ **จอต้องเตือนให้คนตรวจ**
 * ลำดับในโค้ดมีเหตุผลทุกข้อ (หัวข้อ "สามข้อ" ใน §1.4) — เปลี่ยนแล้วผลเปลี่ยน
 *
 * ⚠️ **max+1 เสมอ ห้ามเติมรู** (§1.5) — รูส่วนใหญ่คือสินค้าที่ถูก archive ใน Odoo ซึ่งยังถือเลขนั้นอยู่
 *    แต่ gateway ไม่ส่งมาให้เราเห็น
 *
 * ฟังก์ชันรับรายการรหัสพี่น้องเข้ามา ไม่ยิง query เอง — query อยู่ที่ db/localProductsRepo.ts ที่เดียว
 * และด่านส่งชุดข้อมูลปลอมเข้ามาได้โดยไม่ต้องมีฐาน
 */

export const REF_LENGTH = 14;
export const REF_SHAPE = /^[A-Z0-9]{14}$/;

/** L ที่สั้นที่สุด/ยาวที่สุดที่ตรึงไว้ — หัว 8 ตัว (หมวด · ประเภท · แหล่ง · ซีรีส์) ไม่ขยับเสมอ */
const MIN_L = 8;
const MAX_L = 13;

/**
 * ลำดับ L ของชั้น 2 — **10 ก่อน** เพราะอักขระ 9–10 คือช่องรุ่นย่อย/ขนาดที่ยกมาจากชื่อ model (§1.4 ข้อ 2)
 * วัด 2026-09-21: ชั้น 2 ลงที่ L=10 1,722 · 9 → 18 · 8 → 2 · 11 → 1
 */
const TIER2_ORDER = [10, 9, 8, 11, 12, 13] as const;

/** ความมั่นใจของเลขที่ออกให้ — จอต้องแสดงต่างกัน (§1.4) */
export type RefTier = 'boundary' | 'max_plus_one';

export interface RefBoundary {
  tier: RefTier;
  /** L — ความยาวส่วนที่ตรึงไว้ */
  prefixLength: number;
  /** 14 - L — จำนวนหลักของตัวนับ */
  width: number;
  /** พี่น้องที่หางเป็นเลขล้วนในกลุ่มนี้กี่ตัว */
  count: number;
  min: number;
  max: number;
}

interface GroupStat { count: number; min: number; max: number }

/**
 * ดัชนีของพี่น้อง: prefix (ยาว 8–13) → สถิติของหางที่เป็นเลขล้วน
 *
 * สร้างครั้งเดียวแล้วถามได้ทุกต้นแบบ — ด่านข้อ 1 ลองทุกรหัสในฐานเป็นต้นแบบ (5 หมื่นตัว)
 * ถ้าไล่รายการพี่น้องใหม่ทุกครั้งจะเป็นหลักร้อยล้านรอบ
 */
export type RefIndex = ReadonlyMap<string, GroupStat>;

export function buildRefIndex(refs: Iterable<string>): RefIndex {
  const index = new Map<string, GroupStat>();
  for (const ref of refs) {
    if (typeof ref !== 'string' || ref.length !== REF_LENGTH) continue;
    for (let L = MIN_L; L <= MAX_L; L++) {
      const tail = ref.slice(L);
      if (!/^\d+$/.test(tail)) continue;
      const n = Number(tail);
      const key = ref.slice(0, L);
      const s = index.get(key);
      if (s) {
        s.count++;
        if (n < s.min) s.min = n;
        if (n > s.max) s.max = n;
      } else {
        index.set(key, { count: 1, min: n, max: n });
      }
    }
  }
  return index;
}

/** max+1 ยังอยู่ในช่องของตัวนับไหม (14 - L หลัก) */
const fits = (max: number, L: number): boolean => max + 1 < 10 ** (REF_LENGTH - L);

const compose = (parentRef: string, L: number, n: number): string =>
  parentRef.slice(0, L) + String(n).padStart(REF_LENGTH - L, '0');

/**
 * ชั้น 1 — "ขอบที่พิสูจน์ได้" · คืน null เมื่อพิสูจน์ไม่ได้
 *
 * - **เอา L ที่สั้นที่สุดที่ผ่าน** ไม่ใช่ยาวที่สุด (§1.4 ข้อ 1) — กลุ่มที่ตรึงยาว ๆ หนาแน่นปลอมเสมอ
 *   แล้วได้ตัวนับกว้าง 1 หลักที่ล้นทันที
 * - หางของต้นแบบเองต้องเป็นเลข — ไม่งั้นต้นแบบไม่ได้อยู่บนตัวนับนั้น (ต้นแบบหางมีตัวอักษรไปชั้น 2)
 * - "หนาแน่น" = ช่วง ≤ max(1.5 × จำนวน, จำนวน + 5) ⇒ ตัวนับจริง ไม่ใช่เลขรุ่นที่ฝ่ายผลิตตั้ง (§1.3)
 */
export function findCounterBoundary(index: RefIndex, parentRef: string): RefBoundary | null {
  if (!REF_SHAPE.test(parentRef)) return null;
  for (let L = MIN_L; L <= MAX_L; L++) {
    if (!/^\d+$/.test(parentRef.slice(L))) continue;
    const s = index.get(parentRef.slice(0, L));
    if (!s || s.count < 2) continue;
    const span = s.max - s.min + 1;
    if (span <= Math.max(1.5 * s.count, s.count + 5) && fits(s.max, L)) {
      return { tier: 'boundary', prefixLength: L, width: REF_LENGTH - L, ...s };
    }
  }
  return null;
}

/**
 * รหัสถัดไป — ออกให้ทุกกรณีที่ข้อมูลพอ (วัด 2026-09-21: ไม่มีต้นแบบไหนในฐานที่ออกให้ไม่ได้)
 *
 * คืน null เมื่อไม่มีกลุ่มไหนนับต่อได้โดยไม่ล้นช่อง ⇒ **ผู้เรียกต้องเผื่อ** (ให้คนพิมพ์รหัสเอง)
 * เพราะข้อมูลโตแล้วอาจมีเคสใหม่ ไม่ใช่เพราะวันนี้มี
 *
 * ชั้น 2:
 * - **ไม่บังคับว่าหางของต้นแบบต้องเป็นเลข** (§1.4 ข้อ 3) — 37 รหัสมีตัวอักษรปน
 *   (`FTGP1TGM65129R`) แต่พี่น้องหางเลขล้วนมีอยู่ ⇒ นับต่อจากพี่น้องได้
 * - **ห้ามทำให้อักขระ 9–10 (รุ่นย่อย) เปลี่ยนจากของต้นแบบ** (§1.4 ข้อ 2 · ด่านข้อ 4) — L=9/8 ที่นับข้าม
 *   `069999 → 070000` คือรหัสของรุ่นอื่น ⇒ ข้าม L นั้นไปลองตัวถัดไป
 */
export function nextReferenceFromIndex(
  index: RefIndex, parentRef: string,
): { ref: string; boundary: RefBoundary } | null {
  if (!REF_SHAPE.test(parentRef)) return null;

  const b1 = findCounterBoundary(index, parentRef);
  if (b1) return { ref: compose(parentRef, b1.prefixLength, b1.max + 1), boundary: b1 };

  for (const L of TIER2_ORDER) {
    const s = index.get(parentRef.slice(0, L));
    if (!s || !fits(s.max, L)) continue;
    const ref = compose(parentRef, L, s.max + 1);
    if (ref.slice(0, 10) !== parentRef.slice(0, 10)) continue;
    return { ref, boundary: { tier: 'max_plus_one', prefixLength: L, width: REF_LENGTH - L, ...s } };
  }
  return null;
}

/** รูปที่สะดวกกว่าเมื่อมีพี่น้องชุดเดียว — สร้างดัชนีให้แล้วถาม */
export function nextReference(
  siblingRefs: readonly string[], parentRef: string,
): { ref: string; boundary: RefBoundary } | null {
  return nextReferenceFromIndex(buildRefIndex(siblingRefs), parentRef);
}

/**
 * ถอด 14 อักขระเป็นช่องที่คนอ่านได้ — **คืนรหัสดิบ ไม่แปลความหมาย** (§4.2)
 *
 * ช่องประเภท/แหล่งไม่มีตารางคำแปลในฐาน มีแต่สิ่งที่เดาจากความถี่ ⇒ หน้าจอแสดงรหัสดิบ
 * พร้อมตัวอย่างสินค้าที่ใช้รหัสเดียวกัน ไม่ใช่คำแปลที่เราแต่งขึ้น
 * ยกเว้นข้อเดียวที่มีหลักฐานชัด: `CU` = สินค้าสั่งทำ (§1.1)
 */
export function describeRef(ref: string): {
  category: string; kind: string; origin: string; series: string; tail: string; isCustom: boolean;
} | null {
  if (!REF_SHAPE.test(ref)) return null;
  return {
    category: ref.slice(0, 1),
    kind: ref.slice(1, 3),
    origin: ref.slice(3, 5),
    series: ref.slice(5, 8),
    tail: ref.slice(8),
    isCustom: ref.slice(1, 3) === 'CU',
  };
}
