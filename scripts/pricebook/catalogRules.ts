// ─────────────────────────────────────────────────────────────────────────────
//  "กติกาของแคตตาล็อก" จากแมป → เล่มที่มีอยู่แล้วในฐาน (สูตรที่ระบบคิดเอง + ข้อห้าม)
//
//  เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md · docs/pricing-code-bh.md
//
//  ใช้สองที่: `importer.ts --catalog` (เขียนจริง) และ `diag/pricingCatalogBh.ts` (ประกอบเล่ม "หลังแก้"
//  ในหน่วยความจำเพื่อเทียบราคาก่อน–หลังกับสินค้าจริงทั้งหมด **โดยไม่เขียนฐาน**) ⇒ ฟังก์ชันนี้ห้ามแตะ DB
//
//  **แตะแค่สองช่อง:** `derivedDims` (สูตรพื้นที่ตามรูปทรงของ BH-02) กับ `constraints` (ขนาดเล็กสุดตามแคตตาล็อก)
//  ราคาตั้ง · กฎบวกเพิ่ม · อัตรา · ตัวเลือก C **คงเดิมทุกไบต์** — แยกเป็นธงของตัวเองเพราะข้อห้ามตัดสินว่ารหัสไหน
//  ได้ราคา (คนละคำสัญญากับ `--extras-only` ที่ "ไม่เปลี่ยนราคาของรหัสที่คิดได้อยู่แล้ว")
//  · ข้อห้ามที่คนเพิ่มเองจากจอ (`custom`) เก็บไว้ต่อท้าย · ข้อห้ามที่คนปิดไว้ (`disabled`) id เดิม = ยังปิดอยู่
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Constraint, PriceBook, PriceModel } from '../../services/pricingLab/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface CatalogRulesChange {
  code: string;
  model: PriceModel;
  notes: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

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
 * กติกาแคตตาล็อกจากไฟล์แมปตรง ๆ — สองช่องที่ `catalogRulesChanges` ใช้ (`derivedDims` · `constraints`) คัดมาจากแมป
 * ทุกไบต์อยู่แล้ว (importer ไม่ได้อ่านสองช่องนี้จาก Excel) ⇒ **ไม่ต้องมีไฟล์ Excel** เหมาะกับด่านที่รันกับเล่มในฐาน
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
