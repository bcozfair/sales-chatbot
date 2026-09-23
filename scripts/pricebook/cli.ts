// ─────────────────────────────────────────────────────────────────────────────
//  เครื่องคิดราคาบรรทัดคำสั่ง ไว้ลองด้วยมือ
//
//  เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md
//
//  ตัวอย่าง:
//    npm run pricebook:calc -- --list
//    npm run pricebook:calc -- TSK-04 --axis D=6 --axis "thread=1/2”" --dim L1=300
//    npm run pricebook:calc -- BH-01C --dim dia_mm=600 --dim width_mm=150 --opt conn:pl2
//    npm run pricebook:calc -- TSK-04 --options D   (ดูว่าแกน D รับค่าอะไรได้บ้าง)
//    npm run pricebook:calc -- --code "TSK-04(S2)6x300+3M"   (อ่านรหัสแล้วคิดราคาให้เลย)
//  เล่มที่ใช้ = เล่มปัจจุบันในฐาน · `--book <ไฟล์.json>` / `--data <dir>` ใช้แทนได้
// ─────────────────────────────────────────────────────────────────────────────

import { parseProductCode } from '../../services/pricingLab/code.js';
import { computePrice, formatOutcome, resolveModel } from '../../services/pricingLab/engine.js';
import type { ProductConfig } from '../../services/pricingLab/types.js';
import { NoBook, loadBookFrom } from './bookSource.js';

const argv = process.argv.slice(2);
// เล่มปัจจุบันในฐาน · `--book <ไฟล์.json>` / `--data <dir>` ใช้แทนได้ (ดู bookSource.ts)
const loaded = await loadBookFrom(argv).catch((e: unknown) => {
  if (e instanceof NoBook) { console.error(e.message); process.exit(1); }
  throw e;
});
const book = loaded.book;
console.log(`สมุดราคาที่ใช้: ${loaded.label}`);

function collect(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag && argv[i + 1]) out.push(argv[++i]!);
  return out;
}

// ── --code "<รหัสสินค้า>": อ่านรหัสแล้วคิดราคาให้เลย ─────────────────────────
//
// รหัสย่อยที่อ่านไม่ออกต้องถูกพิมพ์ออกมาให้เห็นทุกรหัสย่อย ไม่ใช่เงียบ ๆ แล้วโชว์แต่ราคา
// เพราะราคาที่ตกของไปหนึ่งรหัสย่อยหน้าตาเหมือนราคาที่ถูกต้องทุกประการ
const codeArg = collect('--code')[0];
if (codeArg) {
  const parsed = parseProductCode(codeArg, book);
  console.log('');
  console.log(`รหัสที่พิมพ์มา: ${parsed.input}`);
  console.log('');
  for (const part of parsed.parts) {
    const tag =
      part.kind === 'unknown' ? 'อ่านไม่ออก' : part.kind === 'noPrice' ? 'ไม่มีผลกับราคา' : part.guess ? 'ตีความเอง' : 'อ่านได้';
    console.log(`  ${part.text.padEnd(14)} ${`[${tag}]`.padEnd(16)} ${part.reads}`);
  }
  for (const w of parsed.warnings) console.log(`  ⚠ ${w}`);
  for (const p of parsed.problems) console.log(`  ✗ ${p}`);
  console.log('');
  if (parsed.cfg) {
    console.log(`สเปกที่อ่านได้: ${JSON.stringify(parsed.cfg)}`);
    console.log('');
    console.log(formatOutcome(computePrice(parsed.cfg, book)));
    console.log('');
  }
  process.exit(parsed.cfg ? 0 : 1);
}

// ── --subcodes: ตารางรหัสย่อยที่ตั้งค่าไว้แล้ว ────────────────────────────────
//
// เฟสนี้ยังไม่มีหน้าจอ — ตารางนี้จึงเป็นทางเดียวที่จะเห็นว่า "วันนี้ระบบรู้จักกี่ตัว"
// โดยไม่ต้องเปิดไฟล์ JSON
if (argv.includes('--subcodes')) {
  const rows = book.subCodes ?? [];
  console.log(`\nตารางรหัสย่อย — ${rows.length} แถว\n`);
  if (rows.length === 0) {
    console.log('  ยังไม่มีใครตั้งค่าสักตัว — ตัวอักษรท้ายรหัสทุกตัวจะขึ้นว่า "ยังไม่ได้ตั้งค่า"');
  }
  for (const sc of rows) {
    const money =
      sc.effect === 'flat' || sc.effect === 'basePrice'
        ? ` ${(sc.amount ?? 0).toLocaleString()} บาท`
        : sc.effect === 'percent'
          ? ` ${sc.percent}%`
          : sc.effect === 'setAxis'
            ? ` ${sc.axis} = ${sc.value}`
            : '';
    console.log(`  ${sc.subCode.padEnd(10)} ${sc.scope.padEnd(10)} ${sc.effect.padEnd(10)}${money}`);
    console.log(`  ${''.padEnd(10)} ${sc.reads}`);
    console.log(`  ${''.padEnd(10)} ที่มา: ${sc.source ?? 'คนตั้งค่าเอง'}${sc.by ? ` · ${sc.by}` : ''}${sc.at ? ` · ${sc.at}` : ''}`);
    console.log('');
  }
  process.exit(0);
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
