// ─────────────────────────────────────────────────────────────────────────────
//  "กติกาของแคตตาล็อก" จากแมป → เล่มที่มีอยู่แล้วในฐาน (สูตรที่ระบบคิดเอง + ข้อห้าม)
//
//  เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md · docs/pricing-code-bh.md
//
//  ใช้สองที่: `importer.ts --catalog` (เขียนจริง) และ `diag/pricingCatalogBh.ts` (ประกอบเล่ม "หลังแก้"
//  ในหน่วยความจำเพื่อเทียบราคาก่อน–หลังกับสินค้าจริงทั้งหมด **โดยไม่เขียนฐาน**) ⇒ ฟังก์ชันนี้ห้ามแตะ DB
//
//  **แตะสองช่องเต็ม ๆ:** `derivedDims` (สูตรพื้นที่ตามรูปทรงของ BH-02) กับ `constraints` (ขนาดเล็กสุดตามแคตตาล็อก)
//  แยกเป็นธงของตัวเองเพราะข้อห้ามตัดสินว่ารหัสไหนได้ราคา (คนละคำสัญญากับ `--extras-only` ที่ "ไม่เปลี่ยนราคาของรหัส
//  ที่คิดได้อยู่แล้ว") · ข้อห้ามที่คนเพิ่มเองจากจอ (`custom`) เก็บไว้ต่อท้าย · ข้อห้ามที่คนปิดไว้ (`disabled`) id เดิม = ยังปิดอยู่
//  **บวกรายการปิดใน `ADDER_SYNC` / `ADDER_ADD` / `VARIANT_SYNC`** — คำตอบของเจ้าของที่แตะกฎบวกเพิ่มหรือตัวเลือก C
//  ทีละช่องที่ระบุ (ไม่ไล่ทับทั้งกฎ ⇒ ตัวเลขราคาที่แอดมินแก้จากจอไม่ถูกแตะ) · ตัวเลขราคา · อัตรา **คงเดิมทุกไบต์**
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Adder, Constraint, ModelVariant, PriceBook, PriceModel } from '../../services/pricingLab/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface CatalogRulesChange {
  code: string;
  model: PriceModel;
  notes: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * ช่องของกฎบวกเพิ่มเดิมที่ต้องตามแมป — เฉพาะที่ระบุ (เจ้าของตอบ 2026-09-29 · docs/pricing-code-bh.md)
 *   · `watt_over_100` ของ BH-03: ถอดเงื่อนไข "พื้นที่ ≤ 100" ⇒ คิดค่ากำลังไฟทุกขนาด
 *   · `hold` ของ BH-01/03: ชื่อ "เจาะรู" (= หมายเหตุเจาะรูในแคตตาล็อก)
 * ช่องที่ไม่อยู่ในรายการ (ราคา · อัตรา · ลำดับ) ไม่ถูกแตะ แม้แมปกับฐานจะต่างกัน
 */
const ADDER_SYNC: Record<string, Record<string, (keyof Adder)[]>> = {
  'BH-01': { hold: ['label', 'source'] },
  'BH-03': { hold: ['label', 'source'], watt_over_100: ['when', 'source'] },
};
/** กฎที่แมปเพิ่งมีและต้องเติมลงเล่ม (ไม่มีราคาในชีต = ว่าง = "ยังไม่มีราคา" · แอดมินกรอกทีหลังที่หน้าสมุดราคา) */
const ADDER_ADD: Record<string, string[]> = {
  'BH-01': ['conn_pl5'],
  'BH-03': ['conn_pl5'],
};
/** ช่องของตัวเลือก C ที่ต้องตามแมป — BH-03C เจ้าของยืนยันตัวเลขที่ลอกมาจาก BH-01C ("ยืนยันครับ ทำเผื่อไว้") */
const VARIANT_SYNC: Record<string, (keyof ModelVariant)[]> = {
  'BH-03': ['confirmed', 'source', 'note'],
};

/** สำเนากฎที่ช่องใน `keys` เป็นของแมป — ช่องที่แมปไม่มี (เช่นถอดเงื่อนไข) ถูกลบ */
function takeFields<T extends object>(cur: T, from: T, keys: (keyof T)[]): T {
  const out = { ...cur };
  for (const k of keys) {
    if (from[k] === undefined) delete out[k];
    else out[k] = from[k];
  }
  return out;
}

/** รุ่นที่ต้องเปลี่ยน พร้อมคำอธิบาย — ว่าง = เล่มในฐานตรงกับแมปแล้ว */
export function catalogRulesChanges(inDb: PriceBook, fromFile: PriceBook): CatalogRulesChange[] {
  const out: CatalogRulesChange[] = [];
  for (const [code, m] of Object.entries(inDb.models)) {
    const f = fromFile.models[code];
    if (!f) continue;
    const notes: string[] = [];
    const next: PriceModel = { ...m };

    if (!same(m.derivedDims, f.derivedDims)) {
      next.derivedDims = f.derivedDims;
      const was = (m.derivedDims ?? []).map((d) => `${d.name}:${d.formula}`);
      const now = (f.derivedDims ?? []).map((d) => `${d.name}:${d.formula}`);
      notes.push(`สูตรที่ระบบคิดเอง: [${was.join(', ')}] → [${now.join(', ')}]`);
    }

    const fileIds = new Set(f.constraints.map((c) => c.id));
    const wasById = new Map(m.constraints.map((c) => [c.id, c]));
    const fromMap: Constraint[] = f.constraints.map((c) => {
      const cur = wasById.get(c.id);
      return cur?.disabled ? { ...c, disabled: true } : c;
    });
    const kept = m.constraints.filter((c) => c.custom && !fileIds.has(c.id));
    const constraints = [...fromMap, ...kept];
    if (!same(m.constraints, constraints)) {
      next.constraints = constraints;
      for (const c of m.constraints) {
        if (!fileIds.has(c.id) && !c.custom) notes.push(`ถอดข้อห้าม ${c.id}: ${c.message}`);
      }
      for (const c of fromMap) {
        const cur = wasById.get(c.id);
        if (!cur) notes.push(`เพิ่มข้อห้าม ${c.id}: ${c.message}`);
        else if (!same(cur, c)) notes.push(`แก้ข้อห้าม ${c.id}: ${c.message}`);
      }
    }

    const sync = ADDER_SYNC[code] ?? {};
    const add = (ADDER_ADD[code] ?? []).filter((id) => !m.adders.some((a) => a.id === id));
    let adders = m.adders.map((a) => {
      const keys = sync[a.id];
      const fa = keys && f.adders.find((x) => x.id === a.id);
      if (!keys || !fa || a.custom) return a;
      const nextA = takeFields(a, fa, keys);
      if (!same(a, nextA)) notes.push(`แก้กฎ ${a.id} (${keys.join(' · ')}): ${nextA.label}${a.when && !nextA.when ? ' — ถอดเงื่อนไข' : ''}`);
      return nextA;
    });
    for (const id of add) {
      const fa = f.adders.find((x) => x.id === id);
      if (!fa) continue;
      // วางต่อจากกฎที่อยู่ก่อนหน้าในแมป — หน้าสมุดราคาเรียงแถวตามลำดับในเล่ม (PL-5 ใต้ PL-2)
      const prevId = f.adders[f.adders.indexOf(fa) - 1]?.id;
      const at = adders.findIndex((a) => a.id === prevId);
      adders = at > -1 ? [...adders.slice(0, at + 1), fa, ...adders.slice(at + 1)] : [...adders, fa];
      notes.push(`เพิ่มกฎ ${id}: ${fa.label}${fa.kind === 'flat' && fa.amount === undefined ? ' (ยังไม่มีราคา — กรอกที่หน้าสมุดราคา)' : ''}`);
    }
    if (!same(m.adders, adders)) next.adders = adders;

    const vkeys = VARIANT_SYNC[code];
    if (vkeys && m.variant && f.variant) {
      const v = takeFields(m.variant, f.variant, vkeys);
      if (!same(m.variant, v)) {
        next.variant = v;
        notes.push(`ตัวเลือก ${v.suffix}: ${vkeys.map((k) => `${k} = ${JSON.stringify(v[k] ?? null)}`).join(' · ')}`);
      }
    }

    if (notes.length) out.push({ code, model: next, notes });
  }
  return out;
}

/** เล่ม "หลังเติมกติกาแคตตาล็อก" — ไว้ให้ด่านเทียบราคาก่อน–หลังโดยไม่เขียนฐาน */
export function withCatalogRules(inDb: PriceBook, fromFile: PriceBook): PriceBook {
  const models = { ...inDb.models };
  for (const ch of catalogRulesChanges(inDb, fromFile)) models[ch.code] = ch.model;
  return { ...inDb, models };
}

/**
 * กติกาแคตตาล็อกจากไฟล์แมปตรง ๆ — ช่องที่ `catalogRulesChanges` ใช้ (`derivedDims` · `constraints` · ช่องที่ระบุใน
 * `ADDER_SYNC`/`VARIANT_SYNC` · กฎใน `ADDER_ADD` ซึ่งไม่มีเซลล์ราคา) คัดมาจากแมปทุกไบต์อยู่แล้ว (importer ไม่ได้อ่านจาก
 * Excel) ⇒ **ไม่ต้องมีไฟล์ Excel** เหมาะกับด่านที่รันกับเล่มในฐาน
 */
export function catalogRulesFromMaps(dir = join(HERE, 'maps')): PriceBook {
  const models: Record<string, PriceModel> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.map.json'))) {
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8')) as PriceModel;
    models[m.code] = m;
  }
  return { version: 'maps', source: 'maps', models };
}

/**
 * ด่านที่รันกับเล่มในฐาน: ถ้าเล่มยังไม่ได้รัน `importer.ts --catalog` ให้เติมกติกาจากแมปในหน่วยความจำ แล้ว **บอกออกมา**
 *
 * มีเพราะโค้ดขึ้นก่อนเขียนฐานเสมอ (โค้ดเก่าข้ามรุ่นที่มีสูตรที่มันไม่รู้จัก — DEPLOY.md 4.11ข) ⇒ ระหว่างสองจังหวะนั้น
 * เคสของ BH-02 ในด่านจะตกเพราะ "เล่มยังเก่า" ไม่ใช่เพราะโค้ดผิด · หลังรันคำสั่งแล้วไม่มีอะไรต้องเติม = ตรวจเล่มในฐานล้วน
 */
export function withPendingCatalogRules(book: PriceBook): { book: PriceBook; note: string } {
  const pending = catalogRulesChanges(book, catalogRulesFromMaps());
  if (!pending.length) return { book, note: '' };
  return {
    book: withCatalogRules(book, catalogRulesFromMaps()),
    note: `⚠ เล่มนี้ยังไม่ได้รัน importer.ts --catalog (${pending.map((c) => c.code).join(', ')}) — ด่านเติมกติกาแคตตาล็อกจากแมปในหน่วยความจำ ไม่เขียนฐาน`,
  };
}
