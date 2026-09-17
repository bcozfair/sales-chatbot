// ─────────────────────────────────────────────────────────────────────────────
//  PROTOTYPE — ออกตารางราคาเป็นไฟล์ที่ Odoo นำเข้าได้
//
//  ⚠️ ของทดลอง ไม่มีใครใน production import ไฟล์นี้ · ดู prototypes/pricing/README.md
//
//  **ของสองอย่างนี้คนละเรื่องกัน และห้ามสลับ**
//
//    แม่แบบกฎราคา (sheet.ts)   = "กฎ" — ส่งออกไปแก้ แล้วนำกลับเข้าระบบได้
//    ตารางราคาสำหรับ Odoo (ไฟล์นี้) = "ผลลัพธ์" — ส่งออกอย่างเดียว นำกลับเข้ามาไม่ได้
//
//  เพราะไฟล์นี้คือ **ภาพนิ่งของราคา ณ วันที่กด** ที่คลี่ออกมาเป็นรายการสินค้าทีละตัว
//  ใครแก้ราคาในไฟล์นี้แล้วนำเข้า Odoo จะได้ราคาที่ไม่ตรงกับสมุดราคา และไม่มีใครรู้ตัว
//  ⇒ แก้ราคาต้องแก้ที่แม่แบบกฎราคาเสมอ แล้วออกไฟล์นี้ใหม่
//
//  **ข้อจำกัดที่ต้องบอกก่อนใช้ ไม่ใช่ซ่อนไว้**
//  สินค้าพวกนี้เป็น "สินค้าสั่งทำ" ที่ราคาเกิดจากสเปก ⇒ จำนวนรหัสที่เป็นไปได้ไม่จำกัด
//  ไฟล์นี้จึงออกได้เฉพาะรุ่นที่ราคาตั้งมาเป็น **ตารางที่มีขอบเขต** (เลือกจากรายการ)
//  ส่วนรุ่นที่ราคาคิดจากตัวเลขต่อเนื่อง (เช่น Band Heater ที่คิดจากพื้นที่ผิว)
//  คลี่เป็นรายการสินค้าไม่ได้เลย — ไม่ใช่เพราะยังไม่ได้ทำ แต่เพราะมันมีค่าได้ไม่จำกัด
// ─────────────────────────────────────────────────────────────────────────────

import { computePrice } from './engine.js';
import type { CellValue, SheetTable } from './sheet.js';
import type { PriceBook, PriceModel } from './types.js';

export interface OdooOptions {
  /** ชื่อไทยของแกน เอาไว้ประกอบชื่อสินค้า — ไม่ส่งมาก็ใช้ชื่อดิบจากชีต */
  axisLabels?: Record<string, string>;
  /** หมวดสินค้าใน Odoo (ต้องมีอยู่จริงในฐาน ไม่งั้น Odoo จะสร้างใหม่ให้) */
  category?: string;
  /** หน่วยนับ — ฐานภาษาไทยอาจไม่ได้ชื่อว่า Units */
  uom?: string;
  exportedAt?: string;
}

/** คอลัมน์ต้องเป็น "ชื่อฟิลด์ทางเทคนิค" ของ Odoo เป๊ะ ๆ ไม่งั้นหน้า import จับคู่ให้ไม่ได้ */
const COLUMNS = [
  'default_code',
  'name',
  'type',
  'categ_id',
  'uom_id',
  'uom_po_id',
  'list_price',
  'sale_ok',
  'purchase_ok',
  'description_sale'
] as const;

function cleanCode(s: string): string {
  // ” (เครื่องหมายคำพูดโค้ง) มาจากไฟล์ราคาต้นฉบับ — ในรหัสสินค้าใช้ " ธรรมดาอ่านง่ายกว่า
  return s.replace(/[”“]/g, '"').replace(/\s+/g, ' ').trim();
}

function axisText(axis: string, labels?: Record<string, string>): string {
  return labels?.[axis] ?? axis;
}

/** ทุกชุดค่าแกนที่ "มีราคาอยู่จริง" ในตาราง — ช่องว่างในตารางไม่ถูกคลี่ออกมา */
function combos(model: PriceModel): Record<string, string>[] {
  if (model.base.kind !== 'matrix') return [];
  const axes = model.base.axes;
  return Object.keys(model.base.cells).map((key) => {
    const parts = key.split(' | ');
    const out: Record<string, string> = {};
    axes.forEach((a, i) => (out[a] = parts[i] ?? ''));
    return out;
  });
}

export interface OdooResult {
  sheets: SheetTable[];
  rowCount: number;
  skipped: { code: string; label: string; reason: string }[];
}

export function bookToOdooSheets(book: PriceBook, opts: OdooOptions = {}): OdooResult {
  const at = opts.exportedAt ?? new Date().toISOString().slice(0, 10);
  const category = opts.category ?? 'All';
  const uom = opts.uom ?? 'Units';

  const rows: CellValue[][] = [];
  const skipped: OdooResult['skipped'] = [];
  const notes: CellValue[][] = [];

  for (const model of Object.values(book.models)) {
    if (model.base.kind !== 'matrix') {
      const why =
        model.base.kind === 'banded'
          ? `ราคาคิดจาก ${model.base.quantity} ซึ่งเป็นตัวเลขต่อเนื่อง — ลูกค้าสั่งขนาดไหนก็ได้ จึงไม่มี "รายการสินค้า" ที่ปิดจำนวนได้`
          : `ใช้ตารางราคาของรุ่น ${model.base.model} แล้วบวกเพิ่ม — ถ้าจะออกต้องออกรุ่นต้นทางก่อน`;
      skipped.push({ code: model.code, label: model.label, reason: why });
      continue;
    }

    const axes = model.base.axes;
    for (const axisValues of combos(model)) {
      const out = computePrice({ model: model.code, axes: axisValues }, book);

      const specText = axes.map((a) => `${axisText(a, opts.axisLabels)} ${axisValues[a]}`).join(' · ');
      const codeSuffix = axes.map((a) => cleanCode(axisValues[a] ?? '')).join('-');
      const standard = Object.entries(model.standard)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');

      if (out.status !== 'priced') {
        skipped.push({
          code: `${model.code} ${specText}`,
          label: model.label,
          reason:
            out.status === 'quoteOnRequest'
              ? `ต้องขอราคาจากฝ่ายผลิตก่อน — ${out.violations.map((v) => v.message).join(' · ')}`
              : `ติดข้อห้าม — ${out.violations.map((v) => v.message).join(' · ')}`
        });
        continue;
      }

      rows.push([
        cleanCode(`${model.code}-${codeSuffix}`),
        `${model.code} ${specText}`,
        'consu',
        category,
        uom,
        uom,
        out.unitPrice,
        'True',
        'False',
        `ราคาตั้งที่สเปกมาตรฐาน (${standard || 'ไม่มีสเปกพื้นฐาน'}) · คิดจากสมุดราคา ${book.version} · ` +
          `ยังไม่รวม VAT และยังไม่หักส่วนลด · สเปกที่ต่างจากนี้ต้องคิดราคาใหม่จากสมุดราคา`
      ]);
    }
  }

  for (const s of skipped) notes.push([s.code, s.label, s.reason]);

  const readme: string[] = [
    'ตารางราคาสำหรับนำเข้า Odoo',
    '',
    `ออกเมื่อ ${at} · จากสมุดราคา ${book.version}`,
    `จำนวนรายการ ${rows.length} รายการ · ออกไม่ได้ ${skipped.length} รายการ (ดูชีต "ออกไม่ได้เพราะอะไร")`,
    '',
    '── ไฟล์นี้คืออะไร ───────────────────────────────────────────',
    'คือ "ภาพนิ่งของราคา ณ วันที่กดออกไฟล์" คลี่ออกมาเป็นรายการสินค้าทีละตัว',
    'ที่สเปกมาตรฐานของแต่ละรุ่น (ความยาว/สายที่รวมอยู่ในราคาตั้งแล้ว)',
    '',
    '── ไฟล์นี้ไม่ใช่อะไร ─────────────────────────────────────────',
    '✗ ไม่ใช่รายการสินค้าทั้งหมดที่ขายได้ — สินค้าสั่งทำมีสเปกได้ไม่จำกัด',
    '✗ ไม่ใช่ที่สำหรับแก้ราคา — แก้ในนี้แล้วนำเข้า Odoo จะได้ราคาที่ไม่ตรงกับสมุดราคา',
    '   และไม่มีใครรู้ตัว ⇒ แก้ราคาให้แก้ที่ "แม่แบบกฎราคา" แล้วออกไฟล์นี้ใหม่',
    '✗ ไม่ใช่ราคาขายสุทธิ — ยังไม่หักส่วนลดและยังไม่รวม VAT',
    '',
    '── วิธีนำเข้า Odoo ──────────────────────────────────────────',
    '1. Odoo → Sales → Products → เมนู ⚙ → Import records',
    '2. อัปโหลดไฟล์นี้ แล้วเลือกชีต "product.template"',
    '   (แถวแรกของชีตนั้นเป็นชื่อฟิลด์ของ Odoo อยู่แล้ว ไม่ต้องจับคู่เอง)',
    '3. กด Test ก่อน Import ทุกครั้ง',
    '',
    '── ตรวจ 3 อย่างก่อนกด Import ─────────────────────────────────',
    `· categ_id = "${category}" — ต้องมีหมวดนี้อยู่จริงใน Odoo ไม่งั้นมันจะสร้างหมวดใหม่ให้`,
    `· uom_id = "${uom}" — ถ้าฐาน Odoo เป็นภาษาไทย ให้แก้เป็นชื่อหน่วยที่มีจริง`,
    '· type = "consu" (สินค้าไม่นับสต็อก) — ถ้าต้องการให้นับสต็อก เปลี่ยนเป็น "product"',
    '  ทั้งสามค่านี้เป็นสิ่งที่ต้องให้หัวหน้า/ฝ่ายบัญชีเคาะ ไม่ใช่สิ่งที่ระบบเดาเองได้',
    '',
    '── ทำไมบางรุ่นไม่อยู่ในไฟล์นี้ ────────────────────────────────',
    'ดูชีต "ออกไม่ได้เพราะอะไร" — มีเหตุผลกำกับทุกแถว'
  ];

  const sheets: SheetTable[] = [
    { name: 'อ่านก่อนนำเข้า', rows: [], text: readme },
    {
      // ห้ามใส่ title — แถวแรกของชีตนี้ต้องเป็นชื่อฟิลด์ของ Odoo เท่านั้น
      name: 'product.template',
      columns: [
        { label: COLUMNS[0], width: 26 },
        { label: COLUMNS[1], width: 46 },
        { label: COLUMNS[2], width: 10 },
        { label: COLUMNS[3], width: 14 },
        { label: COLUMNS[4], width: 10 },
        { label: COLUMNS[5], width: 10 },
        { label: COLUMNS[6], width: 12 },
        { label: COLUMNS[7], width: 9 },
        { label: COLUMNS[8], width: 11 },
        { label: COLUMNS[9], width: 70 }
      ],
      rows,
      freeze: true
    },
    {
      name: 'ออกไม่ได้เพราะอะไร',
      title: 'รายการที่คลี่เป็นสินค้าใน Odoo ไม่ได้ · แถวพวกนี้ต้องคิดราคาจากสมุดราคาตอนเสนอราคา',
      columns: [
        { label: 'รุ่น / สเปก', width: 44 },
        { label: 'ชื่อรุ่น', width: 32 },
        { label: 'เหตุผล', width: 86 }
      ],
      rows: notes,
      freeze: true
    }
  ];

  return { sheets, rowCount: rows.length, skipped };
}
