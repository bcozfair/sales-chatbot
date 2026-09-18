// ─────────────────────────────────────────────────────────────────────────────
//  PROTOTYPE — ด่านตรวจ: เทียบผลของ engine กับ "ตัวอย่างการคิดราคา" ที่เขียนอยู่ในชีตเอง
//
//  ⚠️ ของทดลอง ไม่มีใครใน production import ไฟล์นี้ · ดู prototypes/pricing/README.md
//
//  ชีตแถมข้อสอบพร้อมเฉลยมาให้แล้ว — ฝ่ายขายเขียน "วิธีคิดราคา" ไว้ข้าง ๆ ตาราง
//  นี่คือ golden case ที่ดีที่สุดที่หาได้ เพราะมันคือสิ่งที่ "คนที่รู้เรื่องจริง" บอกว่าถูก
//
//  รัน:  npx tsx prototypes/pricing/golden.ts
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProductCode } from './code.js';
import { computePrice, formatOutcome } from './engine.js';
import type { PriceBook, ProductConfig } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const book = JSON.parse(readFileSync(join(HERE, 'book.json'), 'utf8')) as PriceBook;

interface Case {
  name: string;
  /** ที่มาของเฉลย — เซลล์ในชีต */
  source: string;
  kind: string;
  cfg: ProductConfig;
  /** รหัสสินค้าที่ต้องอ่านแล้วได้ `cfg` ข้างบนนี้เป๊ะ — มีเฉพาะเคสที่เขียนเป็นรหัสจริงได้ */
  code?: string;
  expectPrice?: number;
  expectStatus?: 'priced' | 'quoteOnRequest' | 'notManufacturable';
  /** พิมพ์ breakdown เต็มออกมาด้วย */
  show?: boolean;
}

// เคสอยู่ในไฟล์ JSON ไฟล์เดียว เพราะหน้าเดโม (demo/) ใช้ชุดเดียวกันนี้
// ถ้าปล่อยให้ต่างคนต่างถือรายการ วันหนึ่งด่านกับหน้าที่เอาไปให้คนดูจะเล่าคนละเรื่อง
const CASES = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8')) as Case[];

// ── รัน ──────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

console.log(`\nสมุดราคา: ${book.source}`);
console.log(`นำเข้าเมื่อ: ${book.version}   รุ่นในสมุด: ${Object.keys(book.models).join(', ')}\n`);

for (const c of CASES) {
  const out = computePrice(c.cfg, book);
  const okPrice = c.expectPrice === undefined || out.unitPrice === c.expectPrice;
  const okStatus = c.expectStatus === undefined || out.status === c.expectStatus;
  const ok = okPrice && okStatus;
  ok ? pass++ : fail++;

  console.log(`${ok ? '✓' : '✗ FAIL'}  ${c.name}`);
  console.log(`   ที่มาของเฉลย: ${c.source}`);
  if (c.expectPrice !== undefined) {
    console.log(`   คาดหวัง ${c.expectPrice.toLocaleString()} · ได้ ${out.unitPrice.toLocaleString()}`);
  }
  if (c.expectStatus !== undefined) {
    console.log(`   คาดหวังสถานะ ${c.expectStatus} · ได้ ${out.status}`);
  }
  if (c.show || !ok) {
    console.log('');
    console.log(
      formatOutcome(out)
        .split('\n')
        .map((l) => '   ' + l)
        .join('\n')
    );
  }
  console.log('');
}

// ── ตรวจความสอดคล้องของตัวอย่างในชีต (รายงานอย่างเดียว ไม่ใช่ด่าน) ───────────
//
// ไม่ใช่ทุกตัวอย่างในชีตจะยังตรงกับตารางของตัวเอง — ตัวอย่างถูกเขียนครั้งเดียว
// แต่ตารางราคาถูกแก้เรื่อย ๆ ⇒ ต้องแยก "เฉลยที่เชื่อได้" ออกจาก "เฉลยที่ค้างมาจากราคาเก่า"
// ก่อนเอาไปใช้เป็น golden ไม่งั้นจะไปแก้ engine ให้ตรงกับหมายเหตุที่ล้าสมัย

// ── ด่านตรวจตัวอ่านรหัส ──────────────────────────────────────────────────────
//
// เทียบ "สเปกที่อ่านได้จากรหัส" กับ "สเปกที่คนเขียนไว้ในเคส" ทีละคีย์
// เทียบราคาอย่างเดียวไม่พอ เพราะอ่านผิดคนละท่อนแล้วบังเอิญได้ราคาเท่ากันเป็นไปได้
// (เช่น อ่านความยาวไม่เจอ แล้วไปเจอส่วนบวกเพิ่มอีกตัวที่บังเอิญเท่ากัน)

const sortKeys = (o: unknown): unknown => {
  if (Array.isArray(o)) return [...o].sort();
  if (o && typeof o === 'object') {
    return Object.fromEntries(
      Object.entries(o as Record<string, unknown>)
        .filter(([, v]) => !(v && typeof v === 'object' && Object.keys(v).length === 0))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)])
    );
  }
  return o;
};
const same = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

console.log('─'.repeat(70));
console.log('ด่านตรวจตัวอ่านรหัส — รหัสต้องแปลงเป็นสเปกเดียวกับที่เขียนไว้ในเคส');
console.log('─'.repeat(70));
for (const c of CASES.filter((x) => x.code)) {
  const parsed = parseProductCode(c.code!, book);
  const ok = parsed.cfg !== undefined && same(parsed.cfg, c.cfg);
  ok ? pass++ : fail++;
  const unknown = parsed.parts.filter((p) => p.kind === 'unknown').map((p) => p.text);
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${c.code}`);
  if (!ok) {
    console.log(`   คาดหวัง ${JSON.stringify(sortKeys(c.cfg))}`);
    console.log(`   อ่านได้ ${JSON.stringify(sortKeys(parsed.cfg))}`);
    if (parsed.problems.length) console.log(`   ปัญหา: ${parsed.problems.join(' · ')}`);
  } else if (unknown.length) {
    console.log(`   (มีท่อนที่อ่านไม่ออกและถูกรายงานไว้: ${unknown.join(' · ')})`);
  }
}
console.log('');

console.log('─'.repeat(70));
console.log('ตรวจตัวอย่างในชีตที่ "ไม่ควรเชื่อ" — TS-18');
console.log('─'.repeat(70));
const ts18Note = computePrice(
  {
    model: 'TS-18',
    axes: { D: '6', sensor: 'Type K/J', flange: '2  นิ้ว' },
    dims: { L1: 100, L2: 50 },
    options: ['element:2']
  },
  book
);
console.log('  ชีตเขียนไว้ที่ TS-18!L4 ว่า:');
console.log('     "เช่น TSK-18(2) 6-6x100+50 = 800+650+(5x25) = 1525"');
console.log('  แต่ตัวอย่างนั้นไม่ตรงกับตารางของตัวเองอยู่แล้ว:');
console.log('     · 800 + 650 + 125 = 1,575 ไม่ใช่ 1,525 (เลขในหมายเหตุบวกกันเองยังไม่ลงตัว)');
console.log(`     · ราคาตั้ง D=6 Type K/J ในตารางปัจจุบัน (TS-18!D25) = 880 ไม่ใช่ 800`);
console.log(`  engine คิดจากตารางปัจจุบันได้ = ${ts18Note.unitPrice.toLocaleString()}`);
console.log('  ⇒ หมายเหตุนี้ค้างมาจากราคาเก่า **ห้ามใช้เป็น golden** และห้ามแก้ engine ให้ตรงกับมัน');
console.log('');

console.log('─'.repeat(70));
console.log(`ผล: ผ่าน ${pass} · ตก ${fail}`);
console.log('─'.repeat(70));
process.exit(fail > 0 ? 1 : 0);
