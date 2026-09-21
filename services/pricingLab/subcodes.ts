// ─────────────────────────────────────────────────────────────────────────────
//  "ตารางรหัสย่อย": ให้แอดมินบอกเองว่าตัวอักษรในรหัสสินค้าแปลว่าอะไร
//
//  โมดูล "คิดราคาสินค้า" — ถอดออกได้ทั้งก้อน ดู services/pricingLab/README.md
//
//  ⚠️ โมดูลนี้ถูกเรียกจาก routes/pricingLab.ts เท่านั้น และ **ห้ามมีโค้ดเดิมที่ไหน import
//     โฟลเดอร์นี้** — การพึ่งพาเป็นทางเดียวคือสิ่งเดียวที่ทำให้ "ลบทิ้งเมื่อไหร่ก็ได้" เป็นจริง
//     ไม่ใช่แค่ความตั้งใจ · เฟสแรกยังไม่ต่อกับใบเสนอราคา คิดราคาให้ดูอย่างเดียว
//  ด่านตรวจของไฟล์กลุ่มนี้อยู่ที่ scripts/diag/ (pricingGolden.ts · pricingRoundtrip.ts)
//  ซึ่ง import ตัวจริงจากที่นี่ ⇒ แก้โค้ดตรงนี้แล้วด่านเห็นทันที ไม่ใช่ด่านที่เฝ้าสำเนา
//
//  **ปัญหาที่ไฟล์นี้แก้** (วัดจากรหัสจริง 22,061 รหัสในตาราง products เมื่อ 2026-09-18):
//  ตัวเลขในรหัสมีตารางราคารองรับครบทุกตัว แต่ **ตัวอักษรแทบไม่มีที่ไหนในไฟล์ราคาบอกว่า
//  แปลว่าอะไรและคิดเงินเท่าไหร่** หลักฐานอยู่ในชีต TS-14 เอง: ตัวอย่างที่ฝ่ายขายเขียนคือ
//  `TSK-14 6x200+150-BU` แล้วบรรทัดถัดมาคิด `4000+(3*300)+(1*130) = 5,030` —
//  ไม่มีบรรทัดไหนคิดค่า `-BU` เลย ทั้งที่ชีตเดียวกันมีคอลัมน์ "หัวกระโหลก Blacklite ใหญ่ +700"
//  ⇒ ความหมายอยู่ในหัวคนออกใบ ไม่ได้อยู่ในไฟล์ ⇒ **ต้องให้คนกรอก ไม่ใช่ให้ระบบเดา**
//
//  **ทำไมเป็นข้อมูลในสมุดราคา ไม่ใช่ตารางแปลในโค้ด:** เหตุผลเดียวกับทุกอย่างในโฟลเดอร์นี้ —
//  ร้านต้องแก้เองได้โดยไม่ต้องรอ deploy (หลักการข้อ 2 ของ AGENTS.md) ⇒ แถวในตารางนี้
//  เดินทางไปกลับผ่านแม่แบบ .xlsx ได้เหมือนกฎบวกเพิ่ม
//
//  **ไฟล์นี้ไม่คิดเงินเอง** — มันแค่ตอบว่า "รหัสย่อยนี้คือแถวไหนในตาราง" ส่วนการคิดเงิน
//  อยู่ที่ `engine.ts` ที่เดียวเหมือนเดิม (ราคาห้ามคิดสองที่)
// ─────────────────────────────────────────────────────────────────────────────

import type { PriceBook, PriceModel, SubCode } from './types.js';

/**
 * รหัสย่อยที่จับคู่ได้ ถูกเก็บลง `ProductConfig.options` ด้วยคำนำหน้านี้
 * เพื่อให้ **โครงของสเปกไม่เปลี่ยน** — engine เดิมรับ options อยู่แล้ว และเคสทดสอบเก่า
 * ทุกเคสยังใช้ได้เหมือนเดิม
 */
export const SUBCODE_PREFIX = 'sub:';

/** ชื่อ option ของรหัสย่อยหนึ่งตัว (เก็บข้อความตามที่พิมพ์มา ไม่แปลงตัวพิมพ์) */
export function subCodeOption(token: string): string {
  return SUBCODE_PREFIX + token.toUpperCase();
}

/** `#` ในแม่แบบ = ตัวเลขหนึ่งหลัก — ตัวอักษรอื่นต้องตรงตัว */
function patternToRegExp(pattern: string): RegExp {
  const body = pattern
    .split('')
    .map((ch) => (ch === '#' ? '[0-9]' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp('^' + body + '$', 'i');
}

/** รหัสย่อยแถวนี้ ตรงกับข้อความที่พิมพ์มาไหม */
export function subCodeMatches(sc: SubCode, token: string): boolean {
  if (sc.match === 'pattern') return patternToRegExp(sc.subCode).test(token);
  return sc.subCode.toUpperCase() === token.toUpperCase();
}

/**
 * ขอบเขตของแถวนี้ ครอบคลุมรุ่นนี้ไหม — สามชั้น เรียงจากแคบไปกว้าง
 *   0 = รุ่นนี้ตรง ๆ (รวมรหัสอื่นที่ใช้ตารางเดียวกัน)
 *   1 = ทั้งตระกูล เขียนลงท้ายด้วย `*` เช่น `TS-18*` ครอบ TS-18 · TS-18S
 *   2 = ทุกรุ่น (`*`)
 * คืน `undefined` เมื่อไม่ครอบคลุม
 *
 * **ชั้นมีอยู่เพราะคำเดียวกันข้ามรุ่นราคาไม่เท่ากันจริง** — หน้าแปลน JIS 10K ขนาด 1"
 * ชีต TS-18 คิด 650 แต่ชีต TW คิด 800 ⇒ ตั้งค่ากลางไว้ได้ โดยรุ่นที่ต่างเขียนทับของตัวเอง
 */
export function scopeRank(sc: SubCode, model: PriceModel): number | undefined {
  const scope = sc.scope.trim();
  if (scope === '' || scope === '*') return 2;
  if (scope.endsWith('*')) {
    const head = scope.slice(0, -1).toUpperCase();
    const hit = [model.code, ...(model.aliases ?? [])].some((c) => c.toUpperCase().startsWith(head));
    return hit ? 1 : undefined;
  }
  const same = [model.code, ...(model.aliases ?? [])].some((c) => c.toUpperCase() === scope.toUpperCase());
  return same ? 0 : undefined;
}

/**
 * หาแถวที่ใช้กับรหัสย่อยนี้ — **แคบชนะกว้าง และตรงตัวชนะแม่แบบเสมอ**
 * ถ้าไม่เจอ คืน `undefined` ซึ่งแปลว่า "ยังไม่ได้ตั้งค่า" ไม่ใช่ "ไม่มีผลกับราคา"
 * (ความต่างนี้คือทั้งเรื่องของโมดูลนี้ — ดูกฎเหล็กใน `code.ts`)
 */
export function findSubCode(book: PriceBook, model: PriceModel, token: string): SubCode | undefined {
  let best: SubCode | undefined;
  let bestKey = 9;
  for (const sc of book.subCodes ?? []) {
    if (sc.disabled) continue;
    if (!subCodeMatches(sc, token)) continue;
    const rank = scopeRank(sc, model);
    if (rank === undefined) continue;
    const key = rank * 2 + (sc.match === 'exact' ? 0 : 1);
    if (key < bestKey) {
      best = sc;
      bestKey = key;
    }
  }
  return best;
}

/** แถวที่ถูกใช้จริงในสเปกหนึ่งชุด — engine เรียกตัวนี้ตัวเดียว */
export function matchedSubCodes(book: PriceBook, model: PriceModel, options: Iterable<string>): SubCode[] {
  const out: SubCode[] = [];
  for (const o of options) {
    if (!o.startsWith(SUBCODE_PREFIX)) continue;
    const sc = findSubCode(book, model, o.slice(SUBCODE_PREFIX.length));
    if (sc) out.push(sc);
  }
  return out;
}

/** รหัสย่อยที่อยู่ใน options แต่ **ไม่มีแถวในตาราง** — ราคาที่ได้จึงยังไม่ครบ */
export function unsetSubCodes(book: PriceBook, model: PriceModel, options: Iterable<string>): string[] {
  const out: string[] = [];
  for (const o of options) {
    if (!o.startsWith(SUBCODE_PREFIX)) continue;
    const token = o.slice(SUBCODE_PREFIX.length);
    if (!findSubCode(book, model, token)) out.push(token);
  }
  return out;
}
