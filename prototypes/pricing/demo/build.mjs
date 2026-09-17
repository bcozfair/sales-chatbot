// ─────────────────────────────────────────────────────────────────────────────
//  PROTOTYPE — ประกอบหน้าเดโมเป็นไฟล์ HTML ไฟล์เดียว
//
//  หน้าเดโมรัน engine.ts **ตัวเดียวกับที่รันในเครื่อง** โดยผ่าน esbuild ไม่ใช่เขียนใหม่ด้วย JS
//  เหตุผล: ถ้าเขียนใหม่ วันหนึ่งสองตัวจะคิดเลขไม่ตรงกัน แล้วหน้าที่เอาไปให้หัวหน้าดู
//  จะโชว์ราคาที่ระบบจริงไม่ได้คิด — ซึ่งแย่กว่าไม่มีหน้าเดโมเลย
//
//  รัน:  node prototypes/pricing/demo/build.mjs
// ─────────────────────────────────────────────────────────────────────────────

// เรียก esbuild ผ่าน JS API ไม่ใช่ spawn `npx` — node บน Windows ปฏิเสธ .cmd
// ถ้าไม่ผ่าน shell (EINVAL) และการเปิด shell เพื่อเรื่องเท่านี้ไม่คุ้ม
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const result = await build({
  entryPoints: [join(HERE, '../engine.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  logLevel: 'warning'
});

// esbuild ปิดท้ายด้วย `export { ... };` ซึ่งใน inline module ไม่มีใครรับ — ตัดทิ้ง
// เพื่อให้ฟังก์ชันอยู่ใน scope เดียวกับโค้ดของหน้าเว็บตรง ๆ
const engine = result.outputFiles[0].text.replace(/export\s*\{[\s\S]*?\};\s*$/, '');

const book = readFileSync(join(HERE, '../book.json'), 'utf8');
const cases = readFileSync(join(HERE, '../cases.json'), 'utf8');

const html = readFileSync(join(HERE, 'template.html'), 'utf8')
  .replace('/*__ENGINE__*/', () => engine)
  .replace('/*__BOOK__*/', () => book)
  .replace('/*__CASES__*/', () => cases);

const out = join(HERE, 'index.html');
writeFileSync(out, html, 'utf8');
console.log(`หน้าเดโม → ${out}  (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
