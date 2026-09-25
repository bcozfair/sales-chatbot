// ─────────────────────────────────────────────────────────────────────────────
//  thaiSuffixVariant — รุ่นที่ต่างกันแค่ "คำไทยท้ายชื่อ" (เช่น `PMV12.00220` กับ `PMV12.00220 ดูดออก`)
//
//  ปัญหา (แจ้งเข้ามา 2026-09-25): เซลส์พิมพ์ `Pmv12.220 ดูดออก` ถูกแล้ว แต่ใบออกเป็นรุ่นธรรมดา
//  สาเหตุคือ LLM ตัดคำไทยทิ้งจาก `model` ที่สกัดได้ ⇒ findProduct ไม่เคยเห็นคำว่า "ดูดออก" เลย
//  และกลับด้านก็เกิด: stage 1.5 (ค้นด้วยเลขท้าย) หยิบรุ่น "ดูดออก" มาให้ทั้งที่เซลส์ไม่ได้พิมพ์
//
//  ทำไมแก้ตรงนี้ ไม่แก้ที่ prompt: prompt เป็นส่วนหนึ่งของ input ที่โมเดลเห็นและถูกด่าน
//  `diag:line-parity` ล็อกไว้ทีละตัวอักษร (หัวไฟล์ quoteExtraction.ts) — และต่อให้แก้ prompt
//  ก็ยังพึ่งความสม่ำเสมอของ LLM ⇒ ขั้นนี้ย้อนไปอ่าน "ข้อความจริงที่เซลส์พิมพ์" แทน ซึ่งไม่สุ่ม
//  ทำงานหลัง findProduct ก่อนประกอบ slots ⇒ ครอบทั้ง LINE และหน้าเว็บในจุดเดียว
//
//  กติกา (ทดลองกับข้อความจริง 381 ข้อความ + ชุดจำลอง 306 รายการ ก่อนเขียนไฟล์นี้ — 2026-09-25:
//  ถูก 150/306 → 297/306 · ไม่มีรายการไหนแย่ลง · รุ่นธรรมดาจากข้อความจริงไม่ถูกเปลี่ยนเลยสักรายการ):
//    1. คำหลังรหัสตรงกับท้ายชื่อรุ่นพี่น้องเป๊ะ       → เลือกรุ่นพี่น้องให้เลย
//    2. คำหลังรหัส "ใกล้เคียง" (`ดูดลมออก` `แบบดูดออก`) → **ไม่เดา** เปลี่ยนเป็นให้เซลส์เลือก
//                                                       รุ่นพี่น้องมาก่อน รุ่นฐานตามหลัง
//    3. มีรายการให้เลือกอยู่แล้ว                       → ดันรุ่นพี่น้องที่ตรงขึ้นหน้ารุ่นฐาน (เติมถ้าไม่มี)
//                                                       ไม่มีคำไทยที่ตรง = รุ่นฐานมาก่อน
//    4. ระบบหยิบรุ่นพี่น้องมาเองทั้งที่ไม่มีคำไทยที่ตรง   → ถอยกลับเป็นรุ่นฐาน
//
//  "ตัดสินไม่ได้ = ไม่แตะ" เสมอ: รหัสไม่อยู่ในข้อความ · รหัสเดียวกันหลายบรรทัดแต่จับคู่ลำดับไม่ได้ ·
//  DB ล่ม (catch แล้วคืนผลเดิม) — ขั้นนี้เป็นของเสริม ต้องไม่ทำให้เส้นเดิมพังได้
//
//  ⚠️ ไม่ได้แก้ "หาผิดซีรีส์" ของ findProduct เอง (เช่น `PMV25.01.024` → `PMV12.00024`) —
//  ขั้นนี้แก้ได้แค่คำไทยท้ายชื่อของรุ่นที่ findProduct ส่งมา ไม่ได้ค้นรุ่นใหม่
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from '../config/db.js';
import {
  normalizeProductCode as normalize,
  candidateReport,
  CANDIDATE_LIMIT,
  type FindProductResult,
  type Product,
} from './productService.js';

/** 1 รายการที่ AI สกัดมา + ผลของ findProduct — รูปเดียวกับ productResults ใน quoteExtraction */
export interface ProductLookup {
  item: any;
  result: FindProductResult;
}

type Sibling = Product & { suffix: string };

const THAI = /[฀-๿]/;
// ต้องตรงกับนิพจน์ของ index `idx_products_model_norm*` ทุกตัวอักษร ไม่งั้น index ไม่ถูกใช้
const MODEL_NORM_SQL = `LOWER(REGEXP_REPLACE(COALESCE(model, ''), '[\\s,\\(\\)]', '', 'g'))`;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);
const sameModel = (a: string, b: string) => normalize(a) === normalize(b);

/**
 * ปรับผลของ findProduct ตามคำไทยที่เซลส์พิมพ์ตามหลังรหัส — **แก้ `rows` ในที่** (แบบเดียวกับการรวม
 * รหัสที่ถูกตัดบรรทัดข้างบนมัน) · ล้มเหลวด้วยเหตุใดก็ตาม = ไม่แตะอะไรเลย
 */
export async function applyThaiSuffixVariants(rows: ProductLookup[], content: string): Promise<void> {
  try {
    const next = await resolveAll(rows, content);
    for (let i = 0; i < rows.length; i++) rows[i] = next[i]!;
  } catch (e: any) {
    console.warn('[thai-variant] ข้าม — ใช้ผลของ findProduct ตามเดิม:', e?.message || e);
  }
}

async function resolveAll(rows: ProductLookup[], content: string): Promise<ProductLookup[]> {
  // แคชต่อหนึ่งข้อความ — ข้อมูลสินค้า sync เข้ามาเรื่อย ๆ จึงไม่แคชข้ามข้อความ
  const siblingCache = new Map<string, Sibling[]>();
  const baseCache = new Map<string, Product | null>();

  /** รุ่นที่ขึ้นต้นด้วยรุ่นนี้แล้วต่อด้วยคำไทย (ท้ายชื่อยาวสุดก่อน) */
  async function siblingsOf(model: string): Promise<Sibling[]> {
    const base = normalize(model);
    if (!base || THAI.test(base.slice(-1))) return [];
    const hit = siblingCache.get(base);
    if (hit) return hit;
    const { rows: found } = await pool.query<Product>(
      `SELECT * FROM products
        WHERE is_system_item = false
          AND ${MODEL_NORM_SQL} LIKE $1 ESCAPE '\\'
          AND SUBSTR(${MODEL_NORM_SQL}, $2 + 1, 1) ~ '[ก-๙]'
        ORDER BY quantity_on_hand_unreserved DESC`,
      [escapeLike(base) + '_%', base.length]
    );
    const seen = new Set<string>();
    const sibs: Sibling[] = [];
    for (const p of found) {
      const n = normalize(p.model || '');
      if (!n.startsWith(base) || seen.has(n)) continue;   // รุ่นซ้ำใน Odoo — เก็บตัวที่ของเหลือมากสุด
      const suffix = n.slice(base.length);
      if (!THAI.test(suffix[0] ?? '')) continue;
      seen.add(n);
      sibs.push({ ...p, suffix });
    }
    sibs.sort((a, b) => b.suffix.length - a.suffix.length);
    siblingCache.set(base, sibs);
    return sibs;
  }

  /** รุ่นฐานของรุ่นที่มีคำไทยต่อท้าย = รุ่นที่ยาวที่สุดในฐานที่เป็นส่วนหน้า (ตัดก่อนอักษรไทย) · ไม่มี = null */
  async function baseOf(model: string): Promise<Product | null> {
    const n = normalize(model);
    if (baseCache.has(n)) return baseCache.get(n)!;
    const prefixes: string[] = [];
    for (let p = 1; p < n.length; p++) if (THAI.test(n[p]!) && !THAI.test(n[p - 1]!)) prefixes.push(n.slice(0, p));
    let base: Product | null = null;
    if (prefixes.length) {
      const { rows: found } = await pool.query<Product>(
        `SELECT * FROM products
          WHERE is_system_item = false AND ${MODEL_NORM_SQL} = ANY($1)
          ORDER BY quantity_on_hand_unreserved DESC`,
        [prefixes]
      );
      for (const p of found) if (!base || normalize(p.model).length > normalize(base.model).length) base = p;
    }
    baseCache.set(n, base);
    return base;
  }

  const codeOf = (r: ProductLookup) => String(r.item?.model || r.item?.product_code || '').trim();
  const codes = rows.map((r) => thaiPartOfCode(codeOf(r)).code);
  const sameCodeCount = new Map<string, number>();
  for (const c of codes) sameCodeCount.set(c, (sameCodeCount.get(c) ?? 0) + 1);
  const ordinal = new Map<string, number>();

  const out: ProductLookup[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const codeRaw = codeOf(row);
    const code = codes[i]!;
    const k = ordinal.get(code) ?? 0;
    ordinal.set(code, k + 1);
    const count = sameCodeCount.get(code) ?? 1;
    const { item, result } = row;

    if (result.found && result.product) {
      const current = result.product;
      const base = (await baseOf(current.model)) ?? current;
      const onVariant = !sameModel(base.model, current.model);
      const sibs = await siblingsOf(base.model);
      const tail = sibs.length ? tailFor(codeRaw, content, k, count, sibs) : null;
      if (tail == null) { out.push(row); continue; }

      const pick = (target: Product, why: string): ProductLookup => {
        if (sameModel(target.model, current.model)) return row;
        console.log(`[thai-variant] ${why}: "${codeRaw}" ${current.model} → ${target.model}`);
        return { item, result: { ...result, product: stripSuffix(target) } };
      };

      const exact = sibs.find((s) => matchTail(tail, s.suffix) === 'exact');
      if (exact) { out.push(pick(exact, 'ตรงเป๊ะ')); continue; }

      const fuzzy = sibs.filter((s) => matchTail(tail, s.suffix) === 'fuzzy');
      if (fuzzy.length) {
        if (fuzzy.some((s) => sameModel(s.model, current.model))) { out.push(row); continue; }
        const candidates = [...fuzzy.map(stripSuffix), base].slice(0, CANDIDATE_LIMIT);
        console.log(`[thai-variant] ใกล้เคียง → ให้เลือก: "${codeRaw}" ${candidates.map((c) => c.model).join(' | ')}`);
        out.push({
          item,
          result: {
            found: false,
            candidates,
            report: candidateReport(`⚠️ พบหลายรุ่นที่ตรงกับ "${codeRaw}" กรุณาระบุเพิ่มเติม`, candidates),
          },
        });
        continue;
      }

      // มีคำไทยตามหลังรหัส แต่ไม่ตรงกับรุ่นพี่น้องตัวไหนเลย ⇒ ต้องเป็นรุ่นฐาน
      out.push(onVariant ? pick(base, 'ถอยเป็นรุ่นฐาน') : row);
      continue;
    }

    if (!result.candidates?.length) { out.push(row); continue; }

    // ── เรียงรายการให้เลือก ──
    const original = result.candidates;
    const list: Product[] = [...original];
    const at = (model: string) => list.findIndex((c) => sameModel(c.model, model));
    let changed = false;
    for (const base of original) {
      const sibs = await siblingsOf(base.model);
      if (!sibs.length) continue;
      const tail = tailFor(codeRaw, content, k, count, sibs);
      const hits = tail ? sibs.filter((s) => matchTail(tail, s.suffix)) : [];
      if (hits.length) {
        // วางรุ่นพี่น้องที่ตรงไว้หน้ารุ่นฐาน (เติมเข้ามาถ้า findProduct ไม่ได้ส่งมา)
        for (const h of [...hits].reverse()) {
          const hi = at(h.model);
          if (hi !== -1 && hi < at(base.model)) continue;
          const moved = hi !== -1 ? list.splice(hi, 1)[0]! : stripSuffix(h);
          list.splice(at(base.model), 0, moved);
          changed = true;
        }
      } else {
        // ไม่มีคำไทยที่ตรง ⇒ รุ่นฐานต้องมาก่อนรุ่นพี่น้องของมัน
        const bi = at(base.model);
        for (const s of sibs) {
          const si = at(s.model);
          if (si !== -1 && si < bi) {
            list.splice(si, 0, list.splice(bi, 1)[0]!);
            changed = true;
            break;
          }
        }
      }
    }
    if (!changed) { out.push(row); continue; }
    const candidates = list.slice(0, CANDIDATE_LIMIT);
    console.log(`[thai-variant] เรียงรายการใหม่: "${codeRaw}" ${candidates.map((c) => c.model).join(' | ')}`);
    const header = result.report.split('\n')[0] || `⚠️ รุ่นใกล้เคียง "${codeRaw}"`;
    out.push({ item, result: { ...result, candidates, report: candidateReport(header, candidates) } });
  }
  return out;
}

function stripSuffix(p: Product | Sibling): Product {
  const { suffix: _suffix, ...rest } = p as Sibling;
  return rest;
}

/** AI บางครั้งเก็บคำไทยไว้ในรหัสเอง — แยกเป็น "ตัวรหัส" กับ "คำไทยที่ติดมา" */
function thaiPartOfCode(codeRaw: string): { code: string; tail: string } {
  const n = normalize(codeRaw);
  const i = n.search(THAI);
  return i > 0 ? { code: n.slice(0, i), tail: n.slice(i) } : { code: n, tail: '' };
}

/** ข้อความที่ตามหลังรหัสนี้ทุกจุดในข้อความ (normalize แล้ว · ตัดที่ท้ายบรรทัด) */
function occurrencesAfter(content: string, code: string): string[] {
  const out: string[] = [];
  if (!code) return out;
  for (const line of content.split(/\r?\n/)) {
    const n = normalize(line);
    let i = n.indexOf(code);
    while (i !== -1) {
      out.push(n.slice(i + code.length));
      i = n.indexOf(code, i + code.length);
    }
  }
  return out;
}

function isSubsequence(needle: string, hay: string): boolean {
  let j = 0;
  for (const ch of hay) {
    if (ch === needle[j]) j++;
    if (j === needle.length) return true;
  }
  return j === needle.length;
}

/**
 * exact = คำหลังรหัสขึ้นต้นด้วยท้ายชื่อรุ่นเป๊ะ
 * fuzzy = ขึ้นต้นด้วยไทย และมีตัวอักษรของท้ายชื่อรุ่นเรียงครบในช่วงสั้น ๆ (`ดูดลมออก` ⊇ `ดูดออก`)
 *         หรือขึ้นต้นเหมือนกันตั้งแต่ 3 ตัว (`หนา5มิล` กับ `หนา5mm.`) — ใกล้เคียงแต่ไม่พอจะเดา
 */
function matchTail(after: string, suffix: string): 'exact' | 'fuzzy' | null {
  if (!after || !suffix) return null;
  if (after.startsWith(suffix)) return 'exact';
  if (!THAI.test(after[0]!)) return null;
  if (isSubsequence(suffix, after.slice(0, suffix.length * 2))) return 'fuzzy';
  let common = 0;
  while (common < after.length && common < suffix.length && after[common] === suffix[common]) common++;
  return common >= 3 ? 'fuzzy' : null;
}

/**
 * คำที่ตามหลังรหัสของรายการลำดับที่ k (นับเฉพาะรายการที่รหัสเดียวกัน) · null = ตัดสินไม่ได้
 * ลำดับการหา: คำไทยที่ AI เก็บไว้ในรหัส → จุดที่ k ในข้อความ (จำนวนจุดเท่ากับจำนวนรายการ) →
 * ทุกจุดให้ผลเดียวกันกับรุ่นพี่น้องทุกตัว
 */
function tailFor(codeRaw: string, content: string, k: number, sameCodeCount: number, sibs: Sibling[]): string | null {
  const own = thaiPartOfCode(codeRaw);
  if (own.tail) return own.tail;
  const afters = occurrencesAfter(content, own.code);
  if (afters.length === 0) return null;
  if (afters.length === sameCodeCount) return afters[k] ?? null;
  const signature = (a: string) => sibs.map((s) => matchTail(a, s.suffix)).join('|');
  const first = signature(afters[0]!);
  return afters.every((a) => signature(a) === first) ? afters[0]! : null;
}
