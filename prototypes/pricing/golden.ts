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
import { computePrice, formatOutcome } from './engine.js';
import type { PriceBook, ProductConfig } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const book = JSON.parse(readFileSync(join(HERE, 'book.json'), 'utf8')) as PriceBook;

interface Case {
  name: string;
  /** ที่มาของเฉลย — เซลล์ในชีต */
  source: string;
  cfg: ProductConfig;
  expectPrice?: number;
  expectStatus?: 'priced' | 'quoteOnRequest' | 'notManufacturable';
  /** พิมพ์ breakdown เต็มออกมาด้วย */
  show?: boolean;
}

const CASES: Case[] = [
  {
    name: 'BH-01C 600×150 + Male Connector PL-2',
    source: 'BH!E19:E22 — "= 600x3.14x150/645 = 438.14 ปัดเป็น 439x25 = 10,975" → "+20% = 13,170" → "+320 = 13,490"',
    cfg: {
      model: 'BH-01C',
      dims: { dia_mm: 600, width_mm: 150 },
      options: ['conn:pl2']
    },
    expectPrice: 13490,
    show: true
  },
  {
    name: 'TSK-14 6x200+150-BU',
    source: 'TS-14!A21:A23 — "4000+(200+150-100=250 mm.)+(150-50=100 mm.)" → "= 4000+(3*300)+(1*130) = 5,030"',
    cfg: {
      model: 'TS-14',
      axes: { sensor: 'K', dia_group: 'Ø6mm./12.7mm.' },
      dims: { L1: 200, L2: 150 }
    },
    expectPrice: 5030,
    show: true
  },
  {
    name: 'TSK-04 แกน 6 เกลียว 1/2" ยาว 300 mm',
    source: 'TS-04!F25 = 770 (ราคาตั้ง Standard 6x100) · B25 = 120 (บวกเพิ่ม 100 mm ละ)',
    cfg: {
      model: 'TSK-04',
      axes: { D: '6', thread: '1/2”' },
      dims: { L1: 300 }
    },
    expectPrice: 1010,
    show: true
  },
  {
    name: 'TSK-04 สเปกตรง Standard เป๊ะ (ไม่ต้องบวกอะไรเลย)',
    source: 'TS-04!C11 = 430',
    cfg: { model: 'TSK-04', axes: { D: '2', thread: '1/8”' } },
    expectPrice: 430
  },
  {
    name: 'TSJ-04 (alias ของ TSK-04) ต้องได้ราคาเดียวกัน',
    source: 'TS-04!A1 "TS_-04" — TSK/TSJ ใช้ตารางเดียวกัน',
    cfg: { model: 'TSJ-04', axes: { D: '2', thread: '1/8”' } },
    expectPrice: 430
  },
  {
    name: '⚠️ ช่องว่างในตาราง = ไม่รับผลิต ไม่ใช่ราคา 0 (D=19 มีแค่ 3/4" กับ 1")',
    source: 'TS-04 แถว 44: คอลัมน์ C-F ว่าง เหลือแค่ G,H',
    cfg: { model: 'TSK-04', axes: { D: '19', thread: '1/8”' }, dims: { L1: 100 } },
    expectStatus: 'notManufacturable',
    show: true
  },
  {
    name: '⚠️ 2 element กับแกนสำเร็จ (S) ต้องถูกบล็อก',
    source: 'TS-04!K11 "รุ่นแกนสำเร็จ ทำ 2 element ไม่ได้"',
    cfg: { model: 'TSK-04', axes: { D: '6S', thread: '1/8”' }, options: ['element:2'] },
    expectStatus: 'notManufacturable'
  },
  {
    name: '⚠️ หน้าแปลนนอกรายการ → ต้องขอราคา ไม่ใช่ error และไม่ใช่ราคา 0',
    source: 'TW!L34 "หน้าแปลนนอกเหนือจากนี้ให้ขอราคาจากผลิต 2"',
    cfg: {
      model: 'TS-18',
      axes: { D: '6', sensor: 'Type K/J', flange: 'ANSI 150# 3"' },
      dims: { L1: 100, L2: 50 }
    },
    expectStatus: 'quoteOnRequest',
    show: true
  },
  {
    name: 'TS-18 สองมิติความยาวคนละ step (L1 ทีละ 100 · L2 ทีละ 10)',
    source: 'TS-18!B15 (D=6 → 120/100mm) · C15 (D=6 → 25/10mm) · D25 = 880',
    cfg: {
      model: 'TS-18',
      axes: { D: '6', sensor: 'Type K/J' },
      dims: { L1: 250, L2: 80 }
    },
    // 880 + ceil(150/100)=2 × 120 = 240 + ceil(30/10)=3 × 25 = 75  →  1,195
    expectPrice: 1195,
    show: true
  },
  {
    name: '⚠️ BH-03 Ceramic 300×80 @ 2000W — ค่ากำลังไฟ "หายไป" อย่างถูกต้อง',
    source: 'BH!E8 ช่วง "101 - ขึ้นไป" = 65฿/in² · G8 เว้นว่าง (ช่วงอื่น G3:G7 = 10)',
    // 300 × 3.14 × 80 / 645 = 116.8 → ปัดขึ้น 117 → ตกช่วง "101 ขึ้นไป" → 117 × 65 = 7,605
    // ค่ากำลังไฟเกิน 100W **ไม่ถูกคิด** เพราะชีตเว้นช่อง G8 ของช่วงนั้นไว้
    // ⇒ adder ผูกกับ "ช่วงราคา" ไม่ใช่ผูกกับรุ่นลอย ๆ — ถ้าคิดรวมทุกช่วงจะเกินจริง 1,900 บาท
    cfg: { model: 'BH-03', dims: { dia_mm: 300, width_mm: 80, watt: 2000 } },
    expectPrice: 7605,
    show: true
  },
  {
    name: '⚠️ BH ขนาดต่ำกว่าที่ทำได้ ต้องถูกบล็อก',
    source: 'BH!H3 "ขนาดเล็กสุดที่ทำได้ OD = 65mm"',
    cfg: { model: 'BH-01', dims: { dia_mm: 50, width_mm: 40 } },
    expectStatus: 'notManufacturable'
  }
];

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
