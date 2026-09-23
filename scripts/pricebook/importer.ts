// ─────────────────────────────────────────────────────────────────────────────
//  ตัวนำเข้า: ไฟล์ Excel ของฝ่ายขาย → สมุดราคา JSON
//
//  เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md
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
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Adder, Band, Constraint, DerivedDim, ModelVariant, PriceBook, PriceModel, SubCode } from '../../services/pricingLab/types.js';
import { BOOK_PATH } from '../../services/pricingLab/bookStore.js';

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
  ratesFrom?: CellRange & { keyCol: string; sheet?: string };
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
        if (src === ws) countNoise(r, ratesFrom.col);
        const v = cellMoney(src, r, ratesFrom.col);
        if (v === undefined) continue; // ช่องว่าง = ไม่รับทำตัวเลือกนี้กับค่าแกนนี้
        rates[key] = v;
        report.adderRates++;
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

  const model: PriceModel & { importStats?: ImportReport } = {
    code: map.code,
    label: map.label,
    sheet: map.sheet,
    aliases: map.aliases,
    standard: map.standard,
    axisDefaults: map.axisDefaults,
    derivedDims: map.derivedDims,
    base,
    adders,
    constraints: map.constraints,
    variant,
    // ติดสถิติการนำเข้าไปกับสมุดราคาเลย เพราะหน้าเดโมนับเองจากคีย์ไม่ได้:
    // แถวที่ว่างทั้งแถว (เช่น D = "7TN" ของ TS-04) ไม่โผล่ในคีย์ของ cells สักตัว
    // นับจากคีย์จึงได้ช่องว่าง 46 ขณะที่ของจริงคือ 52 — ตัวเลขที่เอาไปให้คนดูต้องมาจากที่เดียว
    importStats: report
  };

  return { model, report };
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

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const dataArg = process.argv.indexOf('--data');
  const dataDir = dataArg > -1 ? process.argv[dataArg + 1]! : resolve(HERE, '../../data');
  const mapDir = join(HERE, 'maps');
  const outFile = BOOK_PATH;

  const { book, reports } = await buildBook(dataDir, mapDir);
  writeFileSync(outFile, JSON.stringify(book, null, 2), 'utf8');

  console.log(`สมุดราคา → ${outFile}`);
  console.log(`ต้นทาง: ${book.source}`);
  console.log(`ตารางรหัสย่อยที่ตั้งค่าไว้: ${(book.subCodes ?? []).length} ตัว`);
  console.log('');
  console.log('รุ่น              ชีต            ช่องมีราคา  ช่องว่าง(ไม่รับผลิต)  ราคา adder  float noise ที่ปัดทิ้ง');
  for (const r of reports) {
    console.log(
      `${r.code.padEnd(16)} ${r.sheet.padEnd(14)} ${String(r.baseCells).padStart(9)} ${String(r.emptyCells).padStart(20)} ${String(r.adderRates).padStart(11)} ${String(r.floatNoiseFixed).padStart(22)}`
    );
  }
}
