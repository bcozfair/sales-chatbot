// ─────────────────────────────────────────────────────────────────────────────
//  PROTOTYPE — เครื่องคิดราคาบรรทัดคำสั่ง ไว้ลองด้วยมือ
//
//  ⚠️ ของทดลอง ไม่มีใครใน production import ไฟล์นี้ · ดู prototypes/pricing/README.md
//
//  ตัวอย่าง:
//    npx tsx prototypes/pricing/cli.ts --list
//    npx tsx prototypes/pricing/cli.ts TSK-04 --axis D=6 --axis "thread=1/2”" --dim L1=300
//    npx tsx prototypes/pricing/cli.ts BH-01C --dim dia_mm=600 --dim width_mm=150 --opt conn:pl2
//    npx tsx prototypes/pricing/cli.ts TSK-04 --options D   (ดูว่าแกน D รับค่าอะไรได้บ้าง)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePrice, formatOutcome, resolveModel } from './engine.js';
import type { PriceBook, ProductConfig } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const book = JSON.parse(readFileSync(join(HERE, 'book.json'), 'utf8')) as PriceBook;
const argv = process.argv.slice(2);

function collect(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag && argv[i + 1]) out.push(argv[++i]!);
  return out;
}

// ── --list: รุ่นทั้งหมดในสมุดราคา ─────────────────────────────────────────────
if (argv.includes('--list') || argv.length === 0) {
  console.log(`\nสมุดราคา ${book.version} — ${book.source}\n`);
  for (const m of Object.values(book.models)) {
    const base =
      m.base.kind === 'matrix'
        ? `ตาราง ${m.base.axes.join(' × ')} (${Object.keys(m.base.cells).length} ช่อง)`
        : m.base.kind === 'banded'
          ? `แถบราคาตาม ${m.base.quantity} (${m.base.bands.length} ช่วง)`
          : `ใช้ฐานของ ${m.base.model}`;
    const alias = m.aliases?.length ? ` [= ${m.aliases.join(', ')}]` : '';
    console.log(`  ${m.code.padEnd(10)}${alias.padEnd(22)} ${m.label}`);
    console.log(`  ${''.padEnd(10)}  ฐาน: ${base}`);
    console.log(`  ${''.padEnd(10)}  Standard: ${JSON.stringify(m.standard)}`);
    console.log(
      `  ${''.padEnd(10)}  ตัวเลือก: ${m.adders.map((a) => a.id).join(', ') || '—'}`
    );
    console.log('');
  }
  process.exit(0);
}

const modelCode = argv[0]!;
const model = resolveModel(book, modelCode);
if (!model) {
  console.error(`ไม่มีรุ่น ${modelCode} — ดูรายการด้วย --list`);
  process.exit(1);
}

// ── --options <แกน>: ค่าที่แกนนั้นรับได้ ─────────────────────────────────────
const askAxis = collect('--options')[0];
if (askAxis) {
  if (model.base.kind !== 'matrix') {
    console.error(`รุ่น ${model.code} ไม่ได้ใช้ตารางแบบแกน`);
    process.exit(1);
  }
  const idx = model.base.axes.indexOf(askAxis);
  if (idx < 0) {
    console.error(`รุ่น ${model.code} ไม่มีแกน "${askAxis}" — มีแต่ ${model.base.axes.join(', ')}`);
    process.exit(1);
  }
  const values = [...new Set(Object.keys(model.base.cells).map((k) => k.split(' | ')[idx]!))];
  console.log(`แกน ${askAxis} ของ ${model.code} รับค่า ${values.length} ค่า:`);
  console.log(values.map((v) => `  ${v}`).join('\n'));
  process.exit(0);
}

// ── คิดราคา ──────────────────────────────────────────────────────────────────
const cfg: ProductConfig = { model: modelCode, axes: {}, dims: {}, options: collect('--opt') };
for (const kv of collect('--axis')) {
  const i = kv.indexOf('=');
  cfg.axes![kv.slice(0, i)] = kv.slice(i + 1);
}
for (const kv of collect('--dim')) {
  const i = kv.indexOf('=');
  cfg.dims![kv.slice(0, i)] = Number(kv.slice(i + 1));
}

console.log('');
console.log(`สเปกที่ขอ: ${JSON.stringify(cfg)}`);
console.log('');
console.log(formatOutcome(computePrice(cfg, book)));
console.log('');
