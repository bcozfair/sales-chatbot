// ─────────────────────────────────────────────────────────────────────────────
//  "ใช้สมุดราคาเล่มไหน" — ที่เดียวที่ CLI และด่านทุกตัวของสมุดราคาใช้หาเล่ม
//
//  เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md
//
//    (ไม่ใส่อะไร) · --source db        เล่มปัจจุบันในฐาน (SELECT อย่างเดียว)
//    --data <dir> · --source xlsx      สร้างจากไฟล์ Excel ในหน่วยความจำ (ไม่แตะฐาน)
//    --book <ไฟล์> · --source json     อ่านจากไฟล์ .json (เล่มของยุคไฟล์ หรือที่ importer --out เขียนไว้)
//
//  **พิมพ์บรรทัดแรกเสมอว่าใช้เล่มไหน** — ตั้งแต่แอดมินแก้ราคาจากหน้าจอได้ ด่าน golden อาจตกเพราะ
//  "ราคาในสมุดไม่เท่าตัวอย่างในชีตแล้ว" ซึ่งไม่ใช่บั๊ก ⇒ คนอ่านผลต้องรู้ว่าเทียบกับเล่ม `r<id>` ที่ใครแก้
//  และยังรัน `--data <dir>` เพื่อตรวจ engine บนตัวเลขของชีตได้เสมอ
//
//  แผนเขียนไว้ที่ `scripts/diag/pricingBookSource.ts` — ย้ายมาอยู่ข้าง importer เพราะ CLI
//  (`pricebook:xlsx` · `pricebook:calc`) ก็ต้องใช้ตัวเดียวกัน ไม่ใช่แค่ด่าน
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBookState } from '../../services/pricingLab/bookStore.js';
import type { PriceBook } from '../../services/pricingLab/types.js';
import { buildBook } from './importer.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface LoadedBook {
  book: PriceBook;
  /** บรรทัดที่พิมพ์ให้คนอ่านรู้ว่าใช้เล่มไหน */
  label: string;
  from: 'db' | 'xlsx' | 'json';
  /** เลขการบันทึก — มีเฉพาะเล่มจากฐาน */
  revision: number | null;
}

export class NoBook extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoBook';
  }
}

/**
 * อ่านธงจาก argv แล้วคืนเล่ม · ไม่มีเล่มให้ใช้ = โยน `NoBook` พร้อมข้อความบอกว่าต้องทำอะไร
 * (ผู้เรียกตัดสินเองว่า "ไม่มีสมุด" = ตก หรือ = ตอบไม่ได้)
 */
export async function loadBookFrom(argv: string[] = process.argv.slice(2)): Promise<LoadedBook> {
  const val = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i > -1 ? argv[i + 1] : undefined;
  };
  const source = val('--source') ?? (val('--data') ? 'xlsx' : val('--book') ? 'json' : 'db');

  if (source === 'xlsx') {
    const dir = val('--data');
    if (!dir) throw new NoBook('--source xlsx ต้องมี --data <โฟลเดอร์ที่มีไฟล์ Excel ราคา>');
    const { book } = await buildBook(resolve(dir), join(HERE, 'maps'));
    return { book, from: 'xlsx', revision: null, label: `ไฟล์ Excel ใน ${dir} (สร้างในหน่วยความจำ · ${book.source})` };
  }

  if (source === 'json') {
    const file = val('--book') ?? argv[argv.indexOf('--source') + 2];
    if (!file) throw new NoBook('--source json ต้องมี --book <ไฟล์ .json>');
    const book = JSON.parse(readFileSync(resolve(file), 'utf8')) as PriceBook;
    if (!book?.models) throw new NoBook(`${file} ไม่ใช่สมุดราคา (ไม่มีช่อง models)`);
    return { book, from: 'json', revision: null, label: `ไฟล์ ${file}` };
  }

  if (source !== 'db') throw new NoBook(`ไม่รู้จัก --source ${source} (db · xlsx · json)`);
  let state;
  try {
    state = await readBookState();
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') {
      throw new NoBook('ฐานนี้ยังไม่มีตารางสมุดราคา — รัน migration 2026-09-23_01_pricing_book_db.sql ก่อน');
    }
    throw e;
  }
  if (!state) {
    throw new NoBook('ยังไม่มีสมุดราคาในฐาน — นำเข้าเล่มแรกด้วย  npx tsx scripts/pricebook/importer.ts --data <dir> --apply' +
      '  (หรือใช้ --data <dir> กับคำสั่งนี้เพื่อตรวจกับไฟล์ Excel ตรง ๆ)');
  }
  const e = state.book.edited;
  const skipped = state.skipped.length ? ` · ⚠ ข้าม ${state.skipped.length} รุ่นที่อ่านไม่ได้` : '';
  return {
    book: state.book,
    from: 'db',
    revision: state.revision,
    label: `ฐานข้อมูล ${state.token} · ${state.book.version}` +
      (e ? ` · แก้ล่าสุดโดย ${e.by ?? '?'} ${e.at}` : ' · ยังไม่มีใครแก้') + skipped,
  };
}
