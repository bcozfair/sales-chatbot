// ─────────────────────────────────────────────────────────────────────────────
//  PROTOTYPE — ตัวนำเข้า: ไฟล์ Excel ของฝ่ายขาย → สมุดราคา JSON
//
//  ⚠️ ของทดลอง ไม่มีใครใน production import ไฟล์นี้ · ดู prototypes/pricing/README.md
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
import type { Adder, Band, Constraint, DerivedDim, PriceBook, PriceModel } from './types.js';

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
  colHeaderRow: number;
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
  ratesFrom?: CellRange & { keyCol: string };
  /** ดึงจำนวนคงที่จากเซลล์เดียว เช่น "B16" */
  amountFrom?: string;
}

interface SheetMap {
  file: string;
  sheet: string;
  code: string;
  label: string;
  aliases?: string[];
  standard: Record<string, number>;
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

function importSheet(map: SheetMap, ws: ExcelJS.Worksheet): { model: PriceModel; report: ImportReport } {
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
    const colHeaders = spec.cols.map((c) => cellText(ws, spec.colHeaderRow, c));
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
      for (let r = ratesFrom.rows[0]; r <= ratesFrom.rows[1]; r++) {
        const key = cellText(ws, r, ratesFrom.keyCol);
        if (!key) continue;
        countNoise(r, ratesFrom.col);
        const v = cellMoney(ws, r, ratesFrom.col);
        if (v === undefined) continue; // ช่องว่าง = ไม่รับทำตัวเลือกนี้กับค่าแกนนี้
        rates[key] = v;
        report.adderRates++;
      }
      a.rates = rates;
    }

    return a;
  });

  const model: PriceModel = {
    code: map.code,
    label: map.label,
    sheet: map.sheet,
    aliases: map.aliases,
    standard: map.standard,
    derivedDims: map.derivedDims,
    base,
    adders,
    constraints: map.constraints
  };

  return { model, report };
}

// ── ตัวหลัก ──────────────────────────────────────────────────────────────────

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

    const { model, report } = importSheet(map, ws);
    models[model.code] = model;
    reports.push(report);
  }

  return {
    book: {
      version: new Date().toISOString().slice(0, 10),
      source: [...sources].join(' · '),
      models
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
  const outFile = join(HERE, 'book.json');

  const { book, reports } = await buildBook(dataDir, mapDir);
  writeFileSync(outFile, JSON.stringify(book, null, 2), 'utf8');

  console.log(`สมุดราคา → ${outFile}`);
  console.log(`ต้นทาง: ${book.source}`);
  console.log('');
  console.log('รุ่น              ชีต            ช่องมีราคา  ช่องว่าง(ไม่รับผลิต)  ราคา adder  float noise ที่ปัดทิ้ง');
  for (const r of reports) {
    console.log(
      `${r.code.padEnd(16)} ${r.sheet.padEnd(14)} ${String(r.baseCells).padStart(9)} ${String(r.emptyCells).padStart(20)} ${String(r.adderRates).padStart(11)} ${String(r.floatNoiseFixed).padStart(22)}`
    );
  }
}
