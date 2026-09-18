// ─────────────────────────────────────────────────────────────────────────────
//  PROTOTYPE — ประกอบหน้าตัวอย่างลงโฟลเดอร์ `mockup/` ที่รากรีโป
//
//  **ทำไมออกไปที่ `mockup/` ไม่ใช่เก็บไว้ใน prototypes/**
//  กติกาของเจ้าของ (2026-09-17): ตัวอย่าง/mockup ส่งเป็น **ลิงก์ local เท่านั้น**
//  เพราะข้อมูลข้างในเป็นราคาจริงของบริษัท จึงไม่ควรออกนอกเครื่อง · `mockup/` ถูก
//  gitignore ไว้ด้วยเหตุผลเดียวกัน ⇒ ไฟล์ที่มีราคาฝังอยู่ไม่ถูก commit และไม่ถูก push
//  ส่วน "ต้นฉบับ" (เทมเพลต + คู่มือ) อยู่ใน prototypes/ ซึ่ง commit ไว้ จึงไม่หาย
//
//  หน้าตัวอย่างรัน engine.ts **ตัวเดียวกับที่รันในเครื่อง** (ผ่าน esbuild) ไม่ได้เขียน JS ใหม่
//  ถ้าเขียนใหม่ วันหนึ่งสองตัวจะคิดเลขไม่ตรงกัน แล้วหน้าที่เอาไปให้คนดูจะโชว์ราคาที่ระบบจริงไม่ได้คิด
//
//  รัน:  node prototypes/pricing/demo/build.mjs
//  ดู:   npx http-server . -p 4173 -c-1   แล้วเปิด http://localhost:4173/mockup/pr-index.html
// ─────────────────────────────────────────────────────────────────────────────

import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRICING = resolve(HERE, '..');

// รากรีโปของ "ทรีที่ให้บริการ" — ค่าเริ่มต้นคือทรีที่ไฟล์นี้อยู่
// ส่ง --out <path> ได้ ถ้าจะให้ไปลงทรีหลักที่เปิด http-server ค้างไว้
const outArg = process.argv.indexOf('--out');
const REPO = outArg > -1 ? resolve(process.argv[outArg + 1]) : resolve(HERE, '../../..');
const MOCKUP = join(REPO, 'mockup');

if (!existsSync(MOCKUP)) mkdirSync(MOCKUP, { recursive: true });
if (!existsSync(join(MOCKUP, '_theme.css'))) {
  console.error(`ไม่พบ ${join(MOCKUP, '_theme.css')} — หน้าตัวอย่างต้องใช้โทเคนสีชุดเดียวกับแอปจริง`);
  console.error('ชี้ไปที่ทรีที่มี mockup/_theme.css ด้วย --out <path ของรากรีโป>');
  process.exit(1);
}

// ── 1. engine (ตัวจริง) + สมุดราคา + เคสทดสอบ → _pr-engine.js ───────────────
//
// entry เป็น demo/browser.ts ไม่ใช่ engine.ts เพราะหน้าแก้กฎต้องใช้ตัวอ่าน/เขียน .xlsx
// และตัวแปลงสมุดราคา ⇄ ตาราง ด้วย — ทั้งหมดต้องเป็น "ตัวเดียวกับที่ด่านตรวจใน Node รัน"
const bundled = await build({
  entryPoints: [join(HERE, 'browser.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'PR_ENGINE',
  write: false,
  logLevel: 'warning'
});

const engineJs =
  '/* สร้างจาก prototypes/pricing/demo/browser.ts ด้วย esbuild — ห้ามแก้ไฟล์นี้ตรง ๆ */\n' +
  bundled.outputFiles[0].text +
  '\nwindow.PR_BOOK = ' +
  readFileSync(join(PRICING, 'book.json'), 'utf8').trim() +
  ';\nwindow.PR_CASES = ' +
  readFileSync(join(PRICING, 'cases.json'), 'utf8').trim() +
  // ความถี่ของรหัสย่อยในรหัสสินค้าจริง — หน้าจอใช้เรียงว่า "ควรตั้งค่าตัวไหนก่อน"
  // นับไว้ล่วงหน้าเป็นไฟล์ เพราะหน้าตัวอย่างต่อฐานข้อมูลไม่ได้ (และไม่ควรต่อ)
  ';\nwindow.PR_CENSUS = ' +
  readFileSync(join(PRICING, '../../services/pricingLab/subcode-census.json'), 'utf8').trim() +
  ';\n';

writeFileSync(join(MOCKUP, '_pr-engine.js'), engineJs, 'utf8');

// ── 2. ไฟล์ร่วมที่เขียนมือ ─────────────────────────────────────────────────
copyFileSync(join(HERE, 'labels.js'), join(MOCKUP, '_pr-labels.js'));
copyFileSync(join(HERE, 'ui.js'), join(MOCKUP, '_pr-ui.js'));

// ── 3. หน้า ────────────────────────────────────────────────────────────────
const PAGES = ['index', 'manual', 'calc', 'rules'];
for (const p of PAGES) {
  copyFileSync(join(HERE, `${p}.html`), join(MOCKUP, `pr-${p}.html`));
}

const size = (f) => (Buffer.byteLength(readFileSync(join(MOCKUP, f))) / 1024).toFixed(0) + ' KB';
console.log(`หน้าตัวอย่าง → ${MOCKUP}`);
for (const f of ['_pr-engine.js', '_pr-labels.js', '_pr-ui.js', ...PAGES.map((p) => `pr-${p}.html`)]) {
  console.log(`  ${f.padEnd(20)} ${size(f)}`);
}
console.log('');
console.log('เปิดดู:  npx http-server . -p 4173 -c-1');
console.log('        http://localhost:4173/mockup/pr-index.html');
