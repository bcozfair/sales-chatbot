// ─────────────────────────────────────────────────────────────────────────────
//  ตัวนำเข้า: ไฟล์ Excel ของฝ่ายขาย → สมุดราคา (ในฐานข้อมูล)
//
//  เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md
//
//    npx tsx scripts/pricebook/importer.ts --data <โฟลเดอร์ Excel>               รายงานอย่างเดียว ไม่เขียนอะไร
//    … --data <dir> --apply --by <username>                                    เล่มแรกของฐาน
//    … --data <dir> --apply --replace-all --by <username>                      แทนทั้งเล่ม (ย้อนได้จากหน้าจอ)
//    … --from-json pricebook/book.json --apply [--replace-all]                  ย้ายเล่มของยุคไฟล์เข้าฐาน
//    … --data <dir> --extras-only [--apply --by <username>]                      เติมของรอบตาราง (ค่ามาตรฐานเมื่อรหัสไม่ระบุ · หน้าตา) ลงเล่มปัจจุบัน ไม่แตะตัวเลขราคา
//    … --data <dir> --new-rules [--apply --by <username>]                        เติม "กฎบวกเพิ่มที่แมปเพิ่งมี" ลงเล่มปัจจุบัน ไม่แก้กฎ/ราคาเดิมสักช่อง
//    … --data <dir> --out <ไฟล์.json>                                           เขียนเป็นไฟล์ (ไม่แตะฐาน)
//
//  **`--data` ไม่มีค่าเริ่มต้นโดยตั้งใจ** — ยุคไฟล์ตั้งต้นที่ `data/` ซึ่งถูกเสิร์ฟออกเว็บโดยไม่ตรวจสิทธิ์
//  (express.static ที่ index.ts) ⇒ ค่าเริ่มต้นนั้นคือการชวนให้วางไฟล์ราคาไว้ในที่ที่ใครก็โหลดได้
//  **ไม่ใส่ `--apply` = ไม่เขียนอะไรเลย** — ของที่ย้อนยากต้องขอตรง ๆ ไม่ใช่เป็นผลข้างเคียงของการดูรายงาน
//  การเขียนเรียก `seedBook`/`commitBookChange` ตัวเดียวกับหน้าจอ **ห้ามยิง SQL เองในไฟล์นี้**
//
//  **ทำไมต้องมีไฟล์ map เขียนมือ ไม่ใช่ auto-detect**
//  30 ชีตวางหัวตารางคนละแบบ และ "ชนิดเซนเซอร์" ปรากฏ 3 รูปแบบข้ามชีต (เป็น prefix ของรุ่น ·
//  เป็นคอลัมน์ · เป็น adder) auto-detect จะเดาผิดเงียบ ๆ แล้วไม่มีใครรู้จนของหลุดถึงลูกค้า
//  map เขียนมือน่าเบื่อแต่ตรวจสอบได้ และพอไฟล์รอบหน้ามาโดย layout เดิม แค่สั่ง import ใหม่จบ
//
//  **ห้าม reimplement สูตรในชีต** — อ่านค่าที่ Excel คำนวณไว้แล้ว (cached result)
//  วัด 2026-09-17: 1,055 เซลล์เป็นสูตร และ **ขาด cached result 0 เซลล์**
//  เหตุผลที่ต้องอ่านผลไม่ใช่สูตร: ชีตเองไม่สม่ำเสมอ — TS-08 แถว "3.2A" เป็นสูตร
//  ROUNDUP(C16*1.35/5,0)*5 → 1825 แต่แถว "4A" เป็นเลขดิบ 1825 ที่พิมพ์ทับ
//  ถ้าเขียนสูตร 1.35 ลงโค้ด วันหนึ่งฝ่ายขายแก้เลขดิบแล้วระบบจะไม่ตาม
// ─────────────────────────────────────────────────────────────────────────────

import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Adder, Band, Constraint, DerivedDim, ModelVariant, PriceBook, PriceModel, SheetLayout, SubCode, AxisDefaultBy } from '../../services/pricingLab/types.js';
import { pool } from '../../config/db.js';
import { readBookState } from '../../services/pricingLab/bookStore.js';
import { BookConflict, BookRejected, commitBookChange, seedBook } from '../../services/pricingLab/bookUpdate.js';
import type { SourceFile } from '../../db/pricingBookRepo.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── ชนิดของไฟล์ map ──────────────────────────────────────────────────────────

interface CellRange {
  col: string;
  rows: [number, number];
}

interface MatrixSpec {
  kind: 'matrix';
  axes: string[];
  rowHeaderCol: string;
  rows: [number, number];
  /**
   * แถวหัวคอลัมน์ — **ใส่หลายแถวได้** เพราะชีต RTD (TS-08 · TS-10) ซ้อนหัวสองชั้น:
   * แถวบนเป็นขนาดเกลียว แถวล่างเป็นชนิดหัววัด (`1/8" / TSP` · `1/8" / TSPA` · ...)
   * ⇒ หนึ่งคอลัมน์ = ค่าของสองแกนพร้อมกัน ถ้าอ่านแถวเดียวจะได้ 6 คอลัมน์ที่ชื่อซ้ำกันสามรอบ
   * แล้วราคาของ TSPA/TSZ จะทับราคาของ TSP เงียบ ๆ (ตารางเหลือ 1 ใน 3 โดยไม่มีอะไรฟ้อง)
   *
   * จำนวนแถวหัวต้องเท่ากับ `axes.length - 1` เสมอ (แกนแรกคือแกนแถว) — ตัวนำเข้าตรวจให้
   */
  colHeaderRow: number | number[];
  cols: string[];
}

interface BandedSpec {
  kind: 'banded';
  quantity: string;
  labelCol: string;
  priceCol: string;
  rows: [number, number];
}

interface RefSpec {
  kind: 'ref';
  model: string;
}

interface AdderSpec extends Omit<Adder, 'rates' | 'amount'> {
  amount?: number;
  /** ดึงราคาต่อหน่วยจากคอลัมน์หนึ่ง โดยใช้ค่าในคอลัมน์ key เป็นกุญแจ */
  /**
   * `sheet` มีไว้เพราะราคาบางอย่างไม่ได้อยู่ในชีตของรุ่นตัวเอง — ราคาสายต่อเมตรของ TC
   * ทุกรุ่นอยู่ที่ `TS-21+22+25` ที่เดียว และชีตนั้นเขียนกำกับไว้เองว่า "สายType ไหน
   * ให้เอาราคาสายType นั้นมาบวกเพิ่มกรณีเกิน 1 เมตร"
   * ⇒ ก๊อปตัวเลขมาไว้ในแมปของแต่ละรุ่น = วันที่ราคาสายขยับจะมีรุ่นที่ลืมแก้
   */
  /**
   * `keys` = เลือกเฉพาะบางแถวในช่วงนั้น — TS_-01 ไม่มีคอลัมน์ "บวกเพิ่ม 100 mm ละ" ในชีตตัวเอง
   * เลยอ่านจากชีตพี่น้อง (TS-06) เฉพาะขนาดแกนที่แคตตาล็อก TS_-01 มีจริง (4.8 · 6) ไม่เอาทั้ง 36 ขนาด
   * · กุญแจที่ขอแต่หาไม่เจอ = นำเข้าล้ม (แถวในชีตขยับแล้วจะได้รู้ ไม่ใช่ได้กฎว่าง ๆ)
   */
  ratesFrom?: CellRange & { keyCol: string; sheet?: string; keys?: string[] };
  /** ดึงจำนวนคงที่จากเซลล์เดียว เช่น "B16" */
  amountFrom?: string;
}

/**
 * "ตัวเลือกท้ายรหัส" ในไฟล์แมป — ราคาฝั่งตัวเลือกยังต้อง **ถอดจากชีต** ไม่ใช่พิมพ์เอง
 * สองทางที่ชีตจริงเขียนไว้ และมีแค่สองทางโดยตั้งใจ:
 *   `adderPricesFrom`  = ชีตมีคอลัมน์ของตัวเลือกนั้นอยู่จริง (BH-01 คอลัมน์ C) ⇒ อ่านเซลล์
 *   `adderPricesTimes` = ชีตเขียนเป็น "คูณสอง" ไม่ได้เขียนตัวเลข ⇒ คูณจากราคาของรุ่นหลักเอง
 * ห้ามมีทางที่สามที่แปลว่า "พิมพ์ตัวเลขลงแมป" เพราะวันที่ราคาในชีตขยับ แมปจะค้างอยู่เงียบ ๆ
 */
interface VariantSpec extends Omit<ModelVariant, 'adderPrices'> {
  /** id ของกฎ → เซลล์ในชีตนี้ เช่น { "conn_pl2": "C12" } */
  adderPricesFrom?: Record<string, string>;
  /** id ของกฎ → ตัวคูณจากราคาของรุ่นหลัก เช่น { "conn_pl2": 2 } */
  adderPricesTimes?: Record<string, number>;
}

/**
 * หน้าตาของชีตรอบตารางราคาตั้ง (`SheetLayout`) — แสดงผลอย่างเดียว ไม่มีผลกับราคา
 * อ่านได้เฉพาะตารางสองแกน (หัวคอลัมน์แถวเดียว)
 */
interface LayoutSpec {
  /** คอลัมน์ข้อความท้ายตาราง เช่น "G" — หัวอ่านจากแถวหัวคอลัมน์ ข้อความอ่านจากแถวเดียวกับราคา */
  rowNoteCol?: string;
  /** แถวข้อความใต้ตาราง เช่น 16 (ตัวหนังสือแดง `*M8x1.25`) */
  colNotesRow?: number;
  /** true = หาคอลัมน์ที่ระบายเหลืองทุกช่องของตาราง (อ่านสีจากไฟล์ ไม่ได้พิมพ์ลงแมป) */
  highlight?: boolean;
}

/**
 * ค่าเริ่มต้นที่ขึ้นกับแกนแถว (`PriceModel.axisDefaultsBy`) — อ่านจากคอลัมน์ข้อความข้างตาราง
 * เช่น TS-01!G "ชนิดสาย รุ่นเริ่มต้น": แถว TSK/TSJ เขียน "สาย ถักสแตนเลส"
 * `names` แปลข้อความในชีตเป็นคีย์ที่กฎราคาใช้ (`สายสแตนเลสถัก` ใน TS-21+22+25) — เทียบแบบตัดช่องว่างและคำว่า "สาย"
 * นำหน้า เพราะชีตเขียนสองแบบในไฟล์เดียว ("สาย ถักสแตนเลส" · "สายถักสแตนเลส")
 * **ข้อความที่ `names` ไม่รู้จัก = นำเข้าล้ม** ไม่ใช่ข้ามเงียบ ๆ — ข้ามแล้วรหัสแถวนั้นจะกลับไปคิดไม่ได้โดยไม่มีใครรู้
 */
interface AxisDefaultBySpec {
  col?: string;
  names?: Record<string, string>;
  /**
   * ค่าเดียวกันทุกแถว ไม่อ่านจากชีต — ใช้เมื่อที่มาของค่าไม่ใช่คอลัมน์ในไฟล์ราคา
   * (TS_-01 · TS_-01-0: แคตตาล็อกบอก "ชนิดสาย None = สแตนเลสถัก" ทุก TYPE และเจ้าของสั่ง 2026-09-24
   * ให้ยึดแคตตาล็อก ไม่ใช่คอลัมน์ G "ชนิดสาย รุ่นเริ่มต้น" ที่บอก TST = เทปล่อน · TSP = PVC)
   * ยังเก็บเป็นรายแถว เพื่อให้หน้าชีตมีช่องให้แก้ต่อ TYPE ได้เหมือนเดิม
   */
  fill?: string;
  label?: string;
  source?: string;
}

interface SheetMap {
  file: string;
  sheet: string;
  code: string;
  label: string;
  aliases?: string[];
  variant?: VariantSpec;
  standard: Record<string, number>;
  axisDefaults?: Record<string, string>;
  derivedDims?: DerivedDim[];
  base: MatrixSpec | BandedSpec | RefSpec;
  adders: AdderSpec[];
  constraints: Constraint[];
  layout?: LayoutSpec;
  /** แกนที่เติม → คอลัมน์ในชีต (แกนที่ตัดสินคือแกนแถวของตารางเสมอ) */
  axisDefaultsBy?: Record<string, AxisDefaultBySpec>;
}

// ── ตัวช่วยอ่านเซลล์ ─────────────────────────────────────────────────────────

function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** ค่าที่ Excel คำนวณไว้แล้ว — ไม่ประเมินสูตรเอง (ดูหัวไฟล์) */
function cellValue(ws: ExcelJS.Worksheet, row: number, col: string): unknown {
  const v = ws.getRow(row).getCell(colToIndex(col)).value;
  if (v && typeof v === 'object') {
    if ('result' in v) return (v as { result: unknown }).result;
    if ('richText' in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
    if ('text' in v) return (v as { text: string }).text;
  }
  return v;
}

function cellText(ws: ExcelJS.Worksheet, row: number, col: string): string {
  const v = cellValue(ws, row, col);
  return v == null ? '' : String(v).trim();
}

/**
 * ตัวเลขเงินจากเซลล์ — คืน undefined ถ้าช่องว่างหรือเป็นข้อความ
 * **ปัดเป็นสตางค์เสมอ** เพราะไฟล์จริงมี float noise 182 เซลล์ (110.00000000000001 ·
 * 1595.0000000000002) ถ้าเก็บดิบ PDF จะพิมพ์ทศนิยม 13 ตำแหน่งออกไปหาลูกค้า
 */
/** สีพื้นเหลืองล้วนแบบที่ฝ่ายขายใช้ไฮไลต์ (FFFF00) — เทียบตรงตัว ไม่เดาเฉดใกล้เคียง */
function isYellow(ws: ExcelJS.Worksheet, row: number, col: string): boolean {
  const fill = ws.getRow(row).getCell(colToIndex(col)).fill as { fgColor?: { argb?: string } } | undefined;
  return (fill?.fgColor?.argb ?? '').toUpperCase() === 'FFFFFF00';
}

function cellMoney(ws: ExcelJS.Worksheet, row: number, col: string): number | undefined {
  const v = cellValue(ws, row, col);
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  return undefined;
}

// ── ตัวแปลข้อความของ BH ("0 - 5" · "> 41" · "25฿ / Inch") ────────────────────

function parseBandLabel(label: string): { min: number; max: number | null } | undefined {
  const t = label.replace(/\s+/g, ' ').trim();
  const gt = t.match(/^>\s*(\d+(?:\.\d+)?)/);
  if (gt) return { min: Number(gt[1]), max: null };
  // "101 - ขึ้นไป" — [^\d\s] ไม่ใช่ \D เพราะ \s* จะ backtrack ให้ \D ไปแมตช์ช่องว่างเอง
  // ทำให้ "0 - 5" กลายเป็นช่วงไม่มีขอบบน แล้วกลืนทุกขนาดไปที่ราคาต่ำสุด (เจอจริงตอนรันครั้งแรก)
  const openEnd = t.match(/^(\d+(?:\.\d+)?)\s*-\s*[^\d\s]/);
  if (openEnd) return { min: Number(openEnd[1]), max: null };
  const range = t.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  return undefined;
}

function parseBandPrice(raw: unknown): { flat?: number; rate?: number } | undefined {
  if (typeof raw === 'number') return { flat: Math.round(raw * 100) / 100 };
  if (typeof raw !== 'string') return undefined;
  // "25฿ / Inch" · "75฿ / Inch"
  const perUnit = raw.match(/(\d+(?:\.\d+)?)\s*฿?\s*\/\s*\w+/);
  if (perUnit) return { rate: Number(perUnit[1]) };
  return undefined;
}

// ── นำเข้าชีตเดียว ───────────────────────────────────────────────────────────

export interface ImportReport {
  code: string;
  sheet: string;
  baseCells: number;
  emptyCells: number;
  adderRates: number;
  floatNoiseFixed: number;
}

function importSheet(
  map: SheetMap,
  ws: ExcelJS.Worksheet,
  wb: ExcelJS.Workbook
): { model: PriceModel; report: ImportReport } {
  const report: ImportReport = {
    code: map.code,
    sheet: map.sheet,
    baseCells: 0,
    emptyCells: 0,
    adderRates: 0,
    floatNoiseFixed: 0
  };

  const countNoise = (row: number, col: string) => {
    const v = cellValue(ws, row, col);
    if (typeof v === 'number' && Math.abs(v - Math.round(v)) > 0 && Math.abs(v - Math.round(v)) < 0.001) {
      report.floatNoiseFixed++;
    }
  };

  // ── ฐานราคา ───────────────────────────────────────────────────────────────
  let base: PriceModel['base'];
  let layout: SheetLayout | undefined;
  let defaultsBy: Record<string, AxisDefaultBy> | undefined;

  if (map.base.kind === 'matrix') {
    const spec = map.base;
    const cells: Record<string, number> = {};
    const headerRows = Array.isArray(spec.colHeaderRow) ? spec.colHeaderRow : [spec.colHeaderRow];
    if (headerRows.length !== spec.axes.length - 1) {
      throw new Error(
        `${map.code}: มีแกน ${spec.axes.length} แกน (${spec.axes.join(' · ')}) แต่บอกแถวหัวคอลัมน์มา ` +
          `${headerRows.length} แถว — ต้องเท่ากับจำนวนแกนลบหนึ่ง (แกนแรกคือแกนแถว)`
      );
    }
    // หัวของคอลัมน์หนึ่ง = ค่าของทุกแกนคอลัมน์ ต่อกันด้วยตัวคั่นเดียวกับ matrixKey
    const colHeaders = spec.cols.map((c) => headerRows.map((hr) => cellText(ws, hr, c)).join(' | '));
    for (let r = spec.rows[0]; r <= spec.rows[1]; r++) {
      const rowKey = cellText(ws, r, spec.rowHeaderCol);
      if (!rowKey) continue;
      spec.cols.forEach((c, i) => {
        countNoise(r, c);
        const v = cellMoney(ws, r, c);
        if (v === undefined) {
          // ช่องว่างในชีต = ไม่รับผลิตขนาดนี้ — **ไม่เขียนลงสมุดราคา** และไม่ใส่ 0
          report.emptyCells++;
          return;
        }
        cells[`${rowKey} | ${colHeaders[i]}`] = v;
        report.baseCells++;
      });
    }
    base = { kind: 'matrix', axes: spec.axes, cells };
    layout = readLayout(map, ws, spec, colHeaders);
    defaultsBy = readDefaultsBy(map, ws, spec);
  } else if (map.base.kind === 'banded') {
    const spec = map.base;
    const bands: Band[] = [];
    for (let r = spec.rows[0]; r <= spec.rows[1]; r++) {
      const label = cellText(ws, r, spec.labelCol);
      const range = parseBandLabel(label);
      if (!range) continue;
      const price = parseBandPrice(cellValue(ws, r, spec.priceCol));
      if (!price) continue;
      bands.push({ ...range, ...price, label });
      report.baseCells++;
    }
    base = { kind: 'banded', quantity: spec.quantity, bands };
  } else {
    base = { kind: 'ref', model: map.base.model };
  }

  // ── ส่วนที่บวกเพิ่ม ────────────────────────────────────────────────────────
  const adders: Adder[] = map.adders.map((spec) => {
    const { ratesFrom, amountFrom, ...rest } = spec;
    const a: Adder = { ...rest } as Adder;

    if (amountFrom) {
      const m = amountFrom.match(/^([A-Z]+)(\d+)$/);
      if (m) {
        countNoise(Number(m[2]), m[1]!);
        a.amount = cellMoney(ws, Number(m[2]), m[1]!);
      }
    }

    if (ratesFrom) {
      const rates: Record<string, number> = {};
      const src = ratesFrom.sheet ? wb.getWorksheet(ratesFrom.sheet) : ws;
      if (!src) throw new Error(`ไม่พบชีต "${ratesFrom.sheet}" ที่ ${map.code} อ้างถึงใน adder ${spec.id}`);
      for (let r = ratesFrom.rows[0]; r <= ratesFrom.rows[1]; r++) {
        const key = cellText(src, r, ratesFrom.keyCol);
        if (!key) continue;
        if (ratesFrom.keys && !ratesFrom.keys.includes(key)) continue;
        if (src === ws) countNoise(r, ratesFrom.col);
        const v = cellMoney(src, r, ratesFrom.col);
        if (v === undefined) continue; // ช่องว่าง = ไม่รับทำตัวเลือกนี้กับค่าแกนนี้
        rates[key] = v;
        report.adderRates++;
      }
      const lost = (ratesFrom.keys ?? []).filter((k) => !(k in rates));
      if (lost.length) {
        throw new Error(`${map.code} adder ${spec.id}: ไม่พบ ${lost.join(' · ')} ในคอลัมน์ ${ratesFrom.keyCol} แถว ${ratesFrom.rows.join('–')} ของชีต ${ratesFrom.sheet ?? map.sheet}`);
      }
      a.rates = rates;
    }

    return a;
  });

  // ── ตัวเลือกท้ายรหัส ──────────────────────────────────────────────────────
  let variant: ModelVariant | undefined;
  if (map.variant) {
    const { adderPricesFrom, adderPricesTimes, ...rest } = map.variant;
    const prices: Record<string, number> = {};
    for (const [id, cell] of Object.entries(adderPricesFrom ?? {})) {
      const m = cell.match(/^([A-Z]+)(\d+)$/);
      if (!m) throw new Error(`${map.code} ตัวเลือก ${rest.suffix}: อ่านเซลล์ "${cell}" ไม่ออก`);
      countNoise(Number(m[2]), m[1]!);
      const v = cellMoney(ws, Number(m[2]), m[1]!);
      // ช่องว่างในชีต = ไม่รับทำ ไม่ใช่ราคา 0 ⇒ ปล่อยให้ไม่มีค่า = คิดเท่ารุ่นหลัก
      if (v !== undefined) prices[id] = v;
    }
    for (const [id, times] of Object.entries(adderPricesTimes ?? {})) {
      const own = adders.find((a) => a.id === id);
      const b = own?.amount ?? own?.rate;
      if (b === undefined) {
        throw new Error(`${map.code} ตัวเลือก ${rest.suffix}: กฎ "${id}" ไม่มีราคาของตัวเองให้คูณ`);
      }
      prices[id] = Math.round(b * times * 100) / 100;
    }
    variant = { ...rest, adderPrices: prices };
  }

  // ค่าที่เติมต้องเป็นคีย์ที่กฎราคาใช้จริง — ไม่งั้นเติมแล้วก็ยังหาราคาไม่เจอ (เงียบ ๆ)
  for (const [axis, d] of Object.entries(defaultsBy ?? {})) {
    const keys = new Set(adders.filter((a) => a.byAxis === axis).flatMap((a) => Object.keys(a.rates ?? {})));
    for (const v of Object.values(d.values)) {
      if (!keys.has(v)) throw new Error(`${map.code}: ค่าเริ่มต้นของ ${axis} = "${v}" ไม่มีในราคาของกฎที่แยกตาม ${axis} (${[...keys].join(' · ')})`);
    }
  }

  // ค่ามาตรฐานของแกนในตาราง ต้องเป็นหัวแถว/หัวคอลัมน์ที่มีจริง — `1/4"` กับ `1/4”` คนละคีย์
  // พิมพ์ผิดแล้วรหัสที่ไม่มีวงเล็บจะกลับไปคิดไม่ได้เงียบ ๆ ⇒ นำเข้าล้มแทน
  if (base.kind === 'matrix') {
    for (const [axis, v] of Object.entries(map.axisDefaults ?? {})) {
      const i = base.axes.indexOf(axis);
      if (i < 0) continue;
      const have = new Set(Object.keys(base.cells).map((k) => k.split(' | ')[i]));
      if (!have.has(v)) throw new Error(`${map.code}: axisDefaults.${axis} = "${v}" ไม่มีในตาราง (${[...have].join(' · ')})`);
    }
  }

  const model: PriceModel & { importStats?: ImportReport } = {
    code: map.code,
    label: map.label,
    sheet: map.sheet,
    aliases: map.aliases,
    standard: map.standard,
    axisDefaults: map.axisDefaults,
    axisDefaultsBy: defaultsBy,
    derivedDims: map.derivedDims,
    base,
    adders,
    constraints: map.constraints,
    variant,
    layout,
    // ติดสถิติการนำเข้าไปกับสมุดราคาเลย เพราะหน้าเดโมนับเองจากคีย์ไม่ได้:
    // แถวที่ว่างทั้งแถว (เช่น D = "7TN" ของ TS-04) ไม่โผล่ในคีย์ของ cells สักตัว
    // นับจากคีย์จึงได้ช่องว่าง 46 ขณะที่ของจริงคือ 52 — ตัวเลขที่เอาไปให้คนดูต้องมาจากที่เดียว
    importStats: report
  };

  return { model, report };
}

function readDefaultsBy(map: SheetMap, ws: ExcelJS.Worksheet, spec: MatrixSpec): Record<string, AxisDefaultBy> | undefined {
  if (!map.axisDefaultsBy) return undefined;
  const norm = (t: string) => t.replace(/\s+/g, '').replace(/^สาย/, '');
  const headerRows = Array.isArray(spec.colHeaderRow) ? spec.colHeaderRow : [spec.colHeaderRow];
  const out: Record<string, AxisDefaultBy> = {};
  for (const [axis, d] of Object.entries(map.axisDefaultsBy)) {
    if (d.fill) {
      const values: Record<string, string> = {};
      for (let r = spec.rows[0]; r <= spec.rows[1]; r++) {
        const key = cellText(ws, r, spec.rowHeaderCol);
        if (key) values[key] = d.fill;
      }
      out[axis] = { ...(d.label ? { label: d.label } : {}), by: spec.axes[0]!, values, ...(d.source ? { source: d.source } : {}) };
      continue;
    }
    if (!d.col || !d.names) throw new Error(`${map.code}: axisDefaultsBy.${axis} ต้องมี fill หรือ col + names`);
    const names = new Map(Object.entries(d.names).map(([k, v]) => [norm(k), v]));
    const values: Record<string, string> = {};
    for (let r = spec.rows[0]; r <= spec.rows[1]; r++) {
      const key = cellText(ws, r, spec.rowHeaderCol);
      const text = cellText(ws, r, d.col);
      if (!key || !text) continue;
      const v = names.get(norm(text));
      if (!v) throw new Error(`${map.code}: ${map.sheet}!${d.col}${r} "${text}" — แมปไม่รู้ว่าคือค่าไหนของ ${axis} (เพิ่มใน names)`);
      values[key] = v;
    }
    if (!Object.keys(values).length) continue;
    const label = d.label ?? cellText(ws, headerRows[headerRows.length - 1]!, d.col);
    out[axis] = {
      ...(label ? { label } : {}),
      by: spec.axes[0]!,
      values,
      source: d.source ?? `${map.sheet}!${d.col}${spec.rows[0]}:${d.col}${spec.rows[1]}`
    };
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * `SheetLayout` จากชีต — ลำดับคีย์ = ลำดับแถว/คอลัมน์ในชีต (ตรงกับลำดับคีย์ของ `cells`)
 * ⇒ หน้าจอบันทึกเปล่าแล้วได้ JSON เดิมทุกไบต์ (ดู `readLayout` ใน modelEditor.ts)
 */
function readLayout(map: SheetMap, ws: ExcelJS.Worksheet, spec: MatrixSpec, colHeaders: string[]): SheetLayout | undefined {
  const L = map.layout;
  if (!L) return undefined;
  const headerRows = Array.isArray(spec.colHeaderRow) ? spec.colHeaderRow : [spec.colHeaderRow];
  if (headerRows.length !== 1) throw new Error(`${map.code}: layout อ่านได้เฉพาะตารางสองแกน`);
  const rowKeys: { r: number; key: string }[] = [];
  for (let r = spec.rows[0]; r <= spec.rows[1]; r++) {
    const key = cellText(ws, r, spec.rowHeaderCol);
    if (key) rowKeys.push({ r, key });
  }
  const out: SheetLayout = {};
  if (L.rowNoteCol) {
    const values: Record<string, string> = {};
    for (const { r, key } of rowKeys) {
      const t = cellText(ws, r, L.rowNoteCol);
      if (t) values[key] = t;
    }
    const label = cellText(ws, headerRows[headerRows.length - 1]!, L.rowNoteCol) || 'หมายเหตุ';
    if (Object.keys(values).length) out.rowNote = { label, values };
  }
  if (L.colNotesRow) {
    const notes: Record<string, string> = {};
    spec.cols.forEach((c, i) => {
      const t = cellText(ws, L.colNotesRow!, c);
      if (t) notes[colHeaders[i]!] = t;
    });
    if (Object.keys(notes).length) out.colNotes = notes;
  }
  if (L.highlight) {
    const cols = spec.cols
      .map((c, i) => ({ c, h: colHeaders[i]! }))
      .filter(({ c }) => rowKeys.length > 0 && rowKeys.every(({ r }) => isYellow(ws, r, c)))
      .map(({ h }) => h);
    if (cols.length) out.highlightCols = cols;
  }
  return Object.keys(out).length ? out : undefined;
}

// ── ตัวหลัก ──────────────────────────────────────────────────────────────────

/**
 * ตารางรหัสย่อยไม่ได้อยู่ในไฟล์ Excel ของฝ่ายขาย — ไฟล์ราคาไม่เคยเขียนไว้ว่าตัวอักษร
 * ท้ายรหัสแปลว่าอะไร (ดูหัวไฟล์ `subcodes.ts`) ⇒ มันเป็นของที่ "คนกรอก" และเดินทาง
 * มากับสมุดราคาในไฟล์แยก · ไม่มีไฟล์ = สมุดที่ยังไม่มีใครตั้งค่ารหัสย่อยสักตัว ซึ่งถูกต้อง
 * และไม่ควรพัง
 */
function readSubCodes(file: string): SubCode[] {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as SubCode[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export async function buildBook(dataDir: string, mapDir: string): Promise<{ book: PriceBook; reports: ImportReport[] }> {
  const mapFiles = readdirSync(mapDir).filter((f) => f.endsWith('.map.json')).sort();
  const workbooks = new Map<string, ExcelJS.Workbook>();
  const models: Record<string, PriceModel> = {};
  const reports: ImportReport[] = [];
  const sources = new Set<string>();

  for (const f of mapFiles) {
    const map = JSON.parse(readFileSync(join(mapDir, f), 'utf8')) as SheetMap;
    sources.add(map.file);

    let wb = workbooks.get(map.file);
    if (!wb) {
      wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(resolve(dataDir, map.file));
      workbooks.set(map.file, wb);
    }

    // ชีตของรุ่นที่อ้างฐานจากรุ่นอื่น (BH-01C) ไม่ต้องมีตารางของตัวเอง
    const ws = wb.getWorksheet(map.sheet);
    if (!ws) throw new Error(`ไม่พบชีต "${map.sheet}" ในไฟล์ ${map.file}`);

    const { model, report } = importSheet(map, ws, wb);
    models[model.code] = model;
    reports.push(report);
  }

  return {
    book: {
      version: new Date().toISOString().slice(0, 10),
      source: [...sources].join(' · '),
      models,
      subCodes: readSubCodes(join(HERE, 'subcodes.json'))
    },
    reports
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

/** ชื่อ + sha256 + ขนาดของไฟล์ต้นทาง — เก็บในแถวหัวของการบันทึก ไม่เก็บตัวไฟล์ (แผน §12 ข้อ 4) */
function fingerprintFile(path: string): SourceFile {
  const bytes = readFileSync(path);
  return { name: basename(path), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

/** ปฏิเสธ `--out` ที่ชี้เข้า `public/` หรือ `data/` — สองโฟลเดอร์ที่ถูกเสิร์ฟออกเว็บโดยไม่ตรวจสิทธิ์ */
function servedPath(out: string): boolean {
  const rel = relative(resolve(HERE, '../..'), resolve(out));
  return ['public', 'data'].some((d) => rel === d || rel.startsWith(d + sep));
}

/** ใส่ช่องหนึ่งไว้ตำแหน่งเดียวกับที่ `importSheet` เขียน — ลำดับคีย์คือลำดับในแม่แบบ */
const FIELD_ORDER = ['code', 'label', 'sheet', 'aliases', 'standard', 'axisDefaults', 'axisDefaultsBy', 'derivedDims',
  'base', 'adders', 'constraints', 'variant', 'layout', 'importStats'];
function withFields(m: PriceModel, patch: Partial<PriceModel>): PriceModel {
  const merged: Record<string, unknown> = { ...m, ...patch };
  const out: Record<string, unknown> = {};
  for (const k of FIELD_ORDER) if (merged[k] !== undefined) out[k] = merged[k];
  for (const k of Object.keys(merged)) if (!(k in out) && merged[k] !== undefined) out[k] = merged[k];
  return out as unknown as PriceModel;
}

/**
 * `--extras-only` (ชื่อเดิม `--layout-only` ยังใช้ได้) — เติม "ของรอบตาราง" จากไฟล์ Excel ลงเล่มปัจจุบันในฐาน
 * **โดยไม่แตะตัวเลขราคาสักช่อง** (ราคาตั้ง · อัตรา · จำนวนเงิน · เงื่อนไข คงเดิมทุกไบต์):
 *   · `layout`          ตัวหนังสือแดงใต้คอลัมน์ · คอลัมน์ไฮไลต์เหลือง (แสดงผลอย่างเดียว)
 *   · `axisDefaultsBy`  ชนิดสายรุ่นเริ่มต้นตาม TYPE — รหัสที่ไม่บอกชนิดสายจึงคิดได้ (ไม่เปลี่ยนราคาของรหัสที่คิดได้อยู่แล้ว)
 *   · ชื่อ/ที่มาของกฎบวกเพิ่ม (`label` · `source`) ของกฎ id เดิม — ข้อความ ไม่ใช่ตัวเลข
 *
 * มีเพราะเล่มในฐานบูตก่อนที่ตัวนำเข้าจะอ่านของพวกนี้ และ `--replace-all` จะทับราคาที่แอดมินแก้จากจอไปแล้ว
 * แตะเฉพาะรุ่นที่แมปมีของพวกนี้ · ไม่ใส่ `--apply` = รายงานอย่างเดียว · ใส่ = การบันทึกหนึ่งครั้ง (ย้อนได้จากจอ)
 */
async function applyExtrasOnly(fromFile: PriceBook, opts: { apply: boolean; by: string | null }): Promise<number> {
  const state = await readBookState();
  if (!state) {
    console.error('ยังไม่มีสมุดราคาในฐาน — --extras-only เติมได้เฉพาะเล่มที่มีอยู่แล้ว');
    return 1;
  }
  const models = { ...state.book.models };
  const changed: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const [code, m] of Object.entries(state.book.models)) {
    const f = fromFile.models[code];
    if (!f || (!f.layout && !f.axisDefaultsBy && !f.axisDefaults)) continue; // แมปของรุ่นนี้ไม่ได้บอกให้อ่าน ⇒ ไม่แตะ
    const patch: Partial<PriceModel> = {};
    const notes: string[] = [];
    // ค่ามาตรฐานเมื่อรหัสไม่ระบุ (เกลียว None = 1/4” ของ TS_-01 ตามแคตตาล็อก) — แตะเฉพาะเมื่อแมปบอกมา
    if (f.axisDefaults && !same(m.axisDefaults, f.axisDefaults)) {
      patch.axisDefaults = f.axisDefaults;
      notes.push(`ค่ามาตรฐานเมื่อรหัสไม่ระบุ: ${Object.entries(f.axisDefaults).map(([k, v]) => `${k} = ${v}`).join(' · ')}`);
    }
    if (!same(m.layout, f.layout)) { patch.layout = f.layout; notes.push(`หน้าตา: ${JSON.stringify(f.layout ?? null)}`); }
    if (!same(m.axisDefaultsBy, f.axisDefaultsBy)) {
      patch.axisDefaultsBy = f.axisDefaultsBy;
      for (const [axis, d] of Object.entries(f.axisDefaultsBy ?? {})) {
        notes.push(`${d.label ?? axis} (ตาม ${d.by}): ${Object.entries(d.values).map(([k, v]) => `${k} → ${v}`).join(' · ')}`);
      }
    }
    // ข้อความของกฎเดิม — ตัวเลขทุกช่องของกฎต้องตรงกันก่อน ไม่งั้นไม่แตะ (กันเอาข้อความไปแปะกฎที่ถูกแก้ไปแล้ว)
    const priceOf = (a: Adder) => JSON.stringify({ ...a, label: undefined, source: undefined });
    let textChanged = false;
    const adders = m.adders.map((a) => {
      const g = f.adders.find((x) => x.id === a.id);
      if (!g || priceOf(g) !== priceOf(a) || (g.label === a.label && g.source === a.source)) return a;
      textChanged = true;
      notes.push(`ชื่อกฎ ${a.id}: "${a.label}" → "${g.label}"`);
      return { ...a, label: g.label, ...(g.source !== undefined ? { source: g.source } : {}) };
    });
    if (textChanged) patch.adders = adders;
    if (!Object.keys(patch).length) continue;
    models[code] = withFields(m, patch);
    changed.push(code);
    console.log(`\n${code}:`);
    for (const n of notes) console.log(`  ${n}`);
  }
  if (changed.length === 0) {
    console.log('\nเล่มในฐานตรงกับไฟล์ทุกรุ่นแล้ว — ไม่มีอะไรต้องเขียน');
    return 0;
  }
  if (!opts.apply) {
    console.log(`\n(ยังไม่ได้เขียนลงฐาน — ${changed.length} รุ่น · ใส่ --apply --by <username> เพื่อบันทึก · ไม่แตะตัวเลขราคา)`);
    return 0;
  }
  const at = new Date().toISOString();
  const revision = await commitBookChange({
    parent: state.revision,
    kind: 'model',
    next: { ...state.book, models, edited: { at, by: opts.by ?? undefined, note: 'เติมของรอบตารางจากไฟล์ราคา/แคตตาล็อก (ค่ามาตรฐานเมื่อรหัสไม่ระบุ · หน้าตา) — ไม่แตะตัวเลขราคา' } },
    changed,
    by: opts.by,
  });
  console.log(`\nบันทึกแล้ว — การบันทึกครั้งที่ ${revision} (${changed.join(', ')})`);
  return 0;
}

/**
 * `--new-rules` — เติม **กฎบวกเพิ่มที่แมปเพิ่งมี** (id ที่รุ่นในฐานยังไม่มี) พร้อมค่ามาตรฐานของมิติที่กฎนั้นใช้
 * ลงเล่มปัจจุบันในฐาน · กฎเดิม · ราคาตั้ง · อัตราที่แอดมินแก้จากจอ **คงเดิมทุกไบต์**
 *
 * มีเพราะ `--extras-only` สัญญาว่าไม่แตะตัวเลขราคา (กฎใหม่คือการเปลี่ยนราคา — คนละคำสัญญา) และ
 * `--replace-all` จะทับราคาที่แก้จากจอไป (เช่นสาย TS 160 ที่อยู่ในฐานเท่านั้น) · ครั้งแรกที่ใช้:
 * ความยาวแกน `xNN` ของ TS_-01 (เจ้าของสั่ง 2026-09-25 — `DEPLOY.md` 4.11ข)
 * · `standard` เติมเฉพาะคีย์ที่ฐานยังไม่มี **ไม่ทับค่าเดิม** · ค่าเดิมต่างจากแมป = หยุด ไม่เขียน (ให้คนดู)
 */
async function applyNewRules(fromFile: PriceBook, opts: { apply: boolean; by: string | null }): Promise<number> {
  const state = await readBookState();
  if (!state) {
    console.error('ยังไม่มีสมุดราคาในฐาน — --new-rules เติมได้เฉพาะเล่มที่มีอยู่แล้ว (เล่มแรกใช้ --apply ธรรมดา)');
    return 1;
  }
  const models = { ...state.book.models };
  const changed: string[] = [];
  for (const [code, m] of Object.entries(state.book.models)) {
    const f = fromFile.models[code];
    if (!f) continue;
    const have = new Set(m.adders.map((a) => a.id));
    const added = f.adders.filter((a) => !have.has(a.id));
    if (!added.length) continue;
    const standard = { ...m.standard };
    for (const a of added) {
      const dim = a.dim;
      if (!dim || f.standard[dim] === undefined) continue;
      if (standard[dim] === undefined) standard[dim] = f.standard[dim]!;
      else if (standard[dim] !== f.standard[dim]) {
        console.error(`${code}: ค่ามาตรฐาน ${dim} ในฐาน = ${standard[dim]} แต่แมป = ${f.standard[dim]} — ไม่เขียน ให้คนตัดสินก่อน`);
        return 1;
      }
    }
    // เรียงตาม order เหมือนที่ตัวนำเข้าเรียง — กฎเดิมไม่ขยับตำแหน่งกันเอง
    const adders = [...m.adders, ...added].sort((x, y) => x.order - y.order);
    models[code] = withFields(m, { standard, adders });
    changed.push(code);
    console.log(`\n${code}:`);
    for (const a of added) {
      console.log(`  + ${a.id} "${a.label}" — ${a.dim ? `เกิน ${a.over ?? standard[a.dim] ?? 0} ${a.unit ?? ''} · ` : ''}` +
        `${a.rates ? Object.entries(a.rates).map(([k, v]) => `${k} = ${v}`).join(' · ') : (a.amount ?? a.rate ?? a.percent)}`);
    }
  }
  if (changed.length === 0) {
    console.log('\nเล่มในฐานมีกฎครบตามแมปแล้ว — ไม่มีอะไรต้องเขียน');
    return 0;
  }
  if (!opts.apply) {
    console.log(`\n(ยังไม่ได้เขียนลงฐาน — ${changed.length} รุ่น · ใส่ --apply --by <username> เพื่อบันทึก)`);
    return 0;
  }
  const at = new Date().toISOString();
  const revision = await commitBookChange({
    parent: state.revision,
    kind: 'model',
    next: { ...state.book, models, edited: { at, by: opts.by ?? undefined, note: 'เติมกฎบวกเพิ่มที่แมปเพิ่งมี (กฎ/ราคาเดิมคงเดิม)' } },
    changed,
    by: opts.by,
  });
  console.log(`\nบันทึกแล้ว — การบันทึกครั้งที่ ${revision} (${changed.join(', ')})`);
  return 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const val = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i > -1 ? args[i + 1] : undefined;
  };
  const dataDir = val('--data');
  const fromJson = val('--from-json');
  const outFile = val('--out');
  const by = val('--by') ?? null;
  const apply = args.includes('--apply');
  const replaceAll = args.includes('--replace-all');
  const extrasOnly = args.includes('--extras-only') || args.includes('--layout-only');
  const newRules = args.includes('--new-rules');

  if (!dataDir === !fromJson) {
    console.error('ต้องบอกที่มาของสมุดราคาอย่างใดอย่างหนึ่ง:');
    console.error('  --data <โฟลเดอร์ที่มีไฟล์ Excel ราคา>   หรือ   --from-json <book.json ของยุคไฟล์>');
    console.error('ไม่ใส่ --apply = แสดงรายงานอย่างเดียว ไม่เขียนอะไร');
    return 1;
  }
  if (outFile && servedPath(outFile)) {
    console.error(`ไม่เขียน ${outFile} — public/ กับ data/ ถูกเสิร์ฟออกเว็บโดยไม่ตรวจสิทธิ์ ใครก็โหลดสมุดราคาไปได้`);
    return 1;
  }

  let book: PriceBook;
  let reports: ImportReport[] = [];
  let sourceFiles: SourceFile[];
  if (fromJson) {
    book = JSON.parse(readFileSync(resolve(fromJson), 'utf8')) as PriceBook;
    if (!book || typeof book !== 'object' || !book.models) {
      console.error(`${fromJson} ไม่ใช่สมุดราคา (ไม่มีช่อง models)`);
      return 1;
    }
    sourceFiles = [fingerprintFile(resolve(fromJson))];
  } else {
    const built = await buildBook(resolve(dataDir!), join(HERE, 'maps'));
    book = built.book;
    reports = built.reports;
    sourceFiles = book.source.split(' · ').map((name) => fingerprintFile(resolve(dataDir!, name)));
  }

  console.log(`ต้นทาง: ${book.source}`);
  console.log(`รุ่น ${Object.keys(book.models).length} รุ่น · ตารางรหัสย่อยที่ติดมากับไฟล์ ${(book.subCodes ?? []).length} ตัว`);
  if (reports.length > 0) {
    console.log('');
    console.log('รุ่น              ชีต            ช่องมีราคา  ช่องว่าง(ไม่รับผลิต)  ราคา adder  float noise ที่ปัดทิ้ง');
    for (const r of reports) {
      console.log(
        `${r.code.padEnd(16)} ${r.sheet.padEnd(14)} ${String(r.baseCells).padStart(9)} ${String(r.emptyCells).padStart(20)} ${String(r.adderRates).padStart(11)} ${String(r.floatNoiseFixed).padStart(22)}`
      );
    }
  }

  if (extrasOnly) return applyExtrasOnly(book, { apply, by });
  if (newRules) return applyNewRules(book, { apply, by });

  if (outFile) {
    writeFileSync(resolve(outFile), JSON.stringify(book, null, 2), 'utf8');
    console.log(`\nเขียนไฟล์ → ${resolve(outFile)} (ไม่แตะฐาน)`);
  }

  if (!apply) {
    console.log('\n(ยังไม่ได้เขียนลงฐาน — ใส่ --apply เพื่อนำเข้าเป็นเล่มแรก หรือ --apply --replace-all เพื่อแทนทั้งเล่ม)');
    return 0;
  }

  try {
    const current = replaceAll ? await readBookState() : undefined;
    const revision = current
      ? await commitBookChange({
          parent: current.revision, kind: 'import', next: book, changed: Object.keys(book.models),
          replaceAll: true, by, sourceFiles,
        })
      : await seedBook(book, { by, sourceFiles });
    console.log(`\nบันทึกลงฐานแล้ว — การบันทึกครั้งที่ ${revision}` +
      (current ? ` (แทนเล่ม r${current.revision} · ย้อนกลับได้จากปุ่ม "ย้อนไปเล่มก่อนหน้า")` : ' (เล่มแรก)'));
    console.log('ตรวจต่อ:  npx tsx scripts/diag/pricingDbRoundtrip.ts  ·  npm run diag:pricing');
    return 0;
  } catch (e) {
    if (e instanceof BookConflict) {
      console.error(replaceAll
        ? '\nมีคนบันทึกสมุดราคาแทรกเข้ามาระหว่างนี้ — รันคำสั่งเดิมอีกครั้ง'
        : '\nในฐานมีสมุดราคาอยู่แล้ว — ถ้าตั้งใจแทนทั้งเล่มด้วยของชุดนี้ ให้ใส่ --replace-all ' +
          '(เป็นการบันทึกครั้งใหม่ ย้อนกลับได้ แต่ราคาที่แอดมินแก้ไว้จะถูกแทนด้วยของจากไฟล์)');
      return 1;
    }
    if (e instanceof BookRejected) {
      console.error(`\n${e.message}`);
      for (const p of e.problems) console.error(`  ✗ ${p}`);
      return 1;
    }
    throw e;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  let code = 1;
  try {
    code = await main();
  } finally {
    await pool.end();
  }
  process.exit(code);
}
