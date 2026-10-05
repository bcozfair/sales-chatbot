// ─────────────────────────────────────────────────────────────────────────────
//  pricingDiffCapture — ตัวเก็บผลของ diag:pricing-diff (ไม่ได้ตั้งใจให้รันตรง ๆ)
//
//  คิดราคา "รหัสจริงทุกตัวในฐาน" (products.model ตระกูล TS/BH ไม่ซ้ำ) ด้วยโค้ดของทรีที่มันอยู่
//  แล้วเขียนผลลงไฟล์ JSON · pricingDiff.ts รันไฟล์นี้สองครั้ง: ในทรีโค้ดก่อนแก้ (คัดลอกตัวนี้ไปวางทับ)
//  กับในทรีปัจจุบัน ⇒ ทั้งสองฝั่งใช้ตัวเก็บผลตัวเดียวกัน ย่อผลแบบเดียวกัน ต่างกันแค่โค้ดคิดราคา
//
//  ต้อง import เฉพาะของที่อยู่มานานใน pricingLab (parseProductCode · computePrice · withSubCodes ·
//  listSubCodes · loadBookFrom) — ตัวนี้ถูกวางลงทรีเก่าด้วย ใช้ของใหม่เมื่อไหร่ฝั่งเก่ารันไม่ขึ้น
//
//  รัน:  tsx scripts/diag/pricingDiffCapture.ts <ไฟล์ผล.json> [--source json --book <เล่ม.json>] [--seed-subcodes]
//  อ่านฐานอย่างเดียว (SELECT products + สมุดราคา + ตารางรหัสย่อย)
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from 'node:fs';
import { pool } from '../../config/db.js';
import { loadBookFrom } from '../pricebook/bookSource.js';
import { listSubCodes } from '../../db/pricingLabRepo.js';
import { loadCatalogSubcodes } from '../pricebook/seedCatalogSubcodes.js';
import { withSubCodes } from '../../services/pricingLab/bookStore.js';
import { parseProductCode } from '../../services/pricingLab/code.js';
import { computePrice } from '../../services/pricingLab/engine.js';

/** ตระกูลที่เครื่องคิดราคารับผิดชอบ — ตรงกับ diag:pricing-coverage */
const FAMILY_RE = /^(TS|BH)/;

/** ผลย่อของหนึ่งรหัส: [สถานะ, ราคา, ลายเซ็นของข้อติด] · `noModel` = ไม่มีรุ่นในสมุด (ไม่ได้คิด) */
export type Row = [status: string, price: number | null, sig: string];
export interface Capture {
  book: string;
  rows: Record<string, Row>;
}

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) throw new Error('ต้องบอกไฟล์ผล: tsx scripts/diag/pricingDiffCapture.ts <out.json>');
  const loaded = await loadBookFrom(process.argv.slice(3));
  // เล่มใดก็ตาม รวมตารางรหัสย่อยในฐานแบบเดียวกับหน้าคำนวณราคา (pricingQuoteHandler)
  // `--seed-subcodes` (pricingDiff ส่งให้ฝั่งปัจจุบันเมื่อสั่ง `--head-seed-subcodes`) = เติมแถวจาก catalog-subcodes.json ที่ฐานยังไม่มี
  // = ผลของ `seedCatalogSubcodes --apply` ก่อนเขียนจริง · แถวที่มีในฐานแล้วชนะไฟล์เสมอ (กติกาเดียวกับตัวเขียน)
  const dbSubs = await listSubCodes();
  const key = (s: { subCode: string; scope: string }) => `${s.subCode.toUpperCase()}|${s.scope}`;
  const have = new Set(dbSubs.map(key));
  const subs = process.argv.includes('--seed-subcodes') ? [...dbSubs, ...loadCatalogSubcodes().filter((s) => !have.has(key(s)))] : dbSubs;
  const book = withSubCodes(loaded.book, subs);

  const { rows } = await pool.query<{ model: string }>(
    `SELECT DISTINCT btrim(model) AS model FROM products WHERE model IS NOT NULL AND btrim(model) <> ''`,
  );
  const codes = rows.map((r) => r.model).filter((m) => FAMILY_RE.test(m)).sort();

  const res: Record<string, Row> = {};
  for (const code of codes) {
    try {
      const p = parseProductCode(code, book);
      if (!p.cfg) { res[code] = ['noModel', null, '']; continue; }
      const o = computePrice(p.cfg, book);
      const sig = o.violations
        .map((v) => {
          const f = v as { level: string; missing?: boolean; noRate?: boolean; partial?: boolean };
          return `${f.level}${f.missing ? '+missing' : ''}${f.noRate ? '+noRate' : ''}${f.partial ? '+partial' : ''}`;
        })
        .sort()
        .join(',');
      // ราคามีความหมายเฉพาะได้ราคาเต็ม หรือขอราคาที่มี "ราคาเท่าที่คิดได้" (จอแสดงแบบเดียวกัน) — ไม่รับผลิตไม่มีราคา
      const shown = o.status === 'priced' || (o.status === 'quoteOnRequest' && o.breakdown.length > 0);
      res[code] = [o.status, shown ? o.unitPrice : null, sig];
    } catch (e) {
      // โค้ดคิดราคาโยน = ผลอย่างหนึ่งที่ต้องเห็น ไม่ใช่เหตุให้ด่านทั้งตัวล้ม
      res[code] = ['throw', null, String((e as Error)?.message ?? e).slice(0, 120)];
    }
  }
  const capture: Capture = { book: loaded.label, rows: res };
  writeFileSync(out, JSON.stringify(capture));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => void pool.end());
