// ─────────────────────────────────────────────────────────────────────────────
//  PROTOTYPE — ยุบหน้าตัวอย่างทั้งชุดเป็น **ไฟล์ HTML ไฟล์เดียว**
//
//  **ทำไมต้องมีตัวนี้ทั้งที่มี build.mjs อยู่แล้ว**
//  `build.mjs` ออกเป็น 7 ไฟล์ที่ต้องอยู่ด้วยกันและต้องเปิดผ่าน http-server — ดีตอนพัฒนา
//  แต่ส่งให้คนอื่นดูไม่ได้ ตัวนี้ยัดทุกอย่าง (ธีม · labels · ui · engine · สมุดราคา · ทั้ง 4 หน้า)
//  ลงไฟล์เดียว **ดับเบิลคลิกเปิดได้เลย ไม่ต้องมีเซิร์ฟเวอร์ ไม่ต้องต่อเน็ต**
//
//  ⚠️ ไฟล์ที่ออกมามี **ราคาจริงของบริษัทฝังอยู่ข้างใน** เหมือน mockup/ ทุกประการ
//     ⇒ ส่งเป็นไฟล์ให้คนที่ควรเห็นเท่านั้น **ห้ามเอาขึ้นโฮสต์สาธารณะ** (กติกาเจ้าของ 2026-09-17)
//     ปลายทางจึงเป็น `mockup/` ซึ่ง gitignore ไว้ — ไฟล์ที่มีราคาไม่ถูก commit และไม่ถูก push
//
//  **ทำไมสลับหน้าด้วยการเปลี่ยน DOM ไม่ใช่ iframe**
//  หน้าพวกนี้เก็บกฎที่แก้แล้วไว้ใน localStorage — iframe ที่เกิดจาก srcdoc บน `file://`
//  ได้ origin แบบทึบ ⇒ localStorage เข้าไม่ถึง แก้กฎแล้วไม่จำ ซึ่งเป็นสิ่งที่ต้องโชว์พอดี
//  การสลับ DOM ปลอดภัยเพราะทุกหน้าเขียนมาเป็น IIFE อยู่แล้ว และมีหน้าเดียวอยู่ใน DOM
//  ต่อครั้ง ⇒ id ที่ชื่อชนกันระหว่างหน้าไม่มีทางเจอกัน
//
//  รัน:  node prototypes/pricing/demo/pack.mjs
//  ได้:  mockup/pr-all-in-one.html   (เปลี่ยนชื่อไฟล์ได้ตามใจ ไม่มีอะไรอ้างชื่อมัน)
// ─────────────────────────────────────────────────────────────────────────────

import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRICING = resolve(HERE, '..');

const outArg = process.argv.indexOf('--out');
const REPO = outArg > -1 ? resolve(process.argv[outArg + 1]) : resolve(HERE, '../../..');
const MOCKUP = join(REPO, 'mockup');
const OUT = join(MOCKUP, 'pr-all-in-one.html');

if (!existsSync(MOCKUP)) mkdirSync(MOCKUP, { recursive: true });
for (const need of [join(MOCKUP, '_theme.css'), join(PRICING, 'book.json')]) {
  if (!existsSync(need)) {
    console.error(`ไม่พบ ${need}`);
    console.error('book.json สร้างด้วย: npx tsx prototypes/pricing/importer.ts');
    process.exit(1);
  }
}

// ── สองกับดักของการยัด JS ลง <script> ในหน้า HTML ───────────────────────────
//
// 1. `</script` ปิดแท็กที่ครอบมันอยู่ ไม่ว่าจะอยู่ในสตริงหรือไม่
//
// 2. **ตัวอักษร NUL (U+0000) ดิบ ๆ ถูก HTML parser แปลงเป็น U+FFFD** ตามสเปก —
//    esbuild ปล่อย NUL ดิบออกมาจริงในคลาสอักขระของ regex ตัวหนึ่งของ xlsxlite
//    (คลาสที่กวาดอักขระควบคุมทิ้งก่อนเขียนลง XML) ⇒ พอยัดลงหน้า ขอบล่างของช่วง
//    กลายเป็น U+FFFD แล้วทั้งไฟล์ engine ตายด้วย "Range out of order in character class"
//    **อาการโผล่คนละที่กับสาเหตุ**: หน้าจอขึ้นว่า PR_ENGINE is not defined
//    ⇒ ไฟล์แยกไม่เจอปัญหานี้เลยเพราะ `<script src>` ไม่ผ่าน HTML parser
//    แปลงอักขระควบคุมทุกตัวเป็น \uXXXX ซึ่งมีค่าเท่าเดิมทั้งในสตริงและใน regex literal
//
// เขียนวนทีละตัวแทน regex โดยตั้งใจ — คลาสอักขระที่ต้องใช้ตรงนี้ประกอบด้วยอักขระควบคุม
// ซึ่งเขียนลงไฟล์เมื่อไหร่ ไฟล์ตัวเองก็กลายเป็นไฟล์ที่มีอักขระควบคุมตามไปด้วย (git มองเป็น binary)
const isCtrl = (c) => c < 9 || c === 11 || c === 12 || (c >= 14 && c < 32);
const safe = (s) => {
  let out = '';
  for (const ch of s.replace(/<\/script/gi, '<\\/script')) {
    const c = ch.charCodeAt(0);
    out += isCtrl(c) ? '\\u' + c.toString(16).padStart(4, '0') : ch;
  }
  return out;
};
const lit = (s) => safe(JSON.stringify(s));

// ── 1. engine ตัวจริง + สมุดราคา + เคสทดสอบ ─────────────────────────────────
const bundled = await build({
  entryPoints: [join(HERE, 'browser.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'PR_ENGINE',
  write: false,
  logLevel: 'warning',
});

const engineJs =
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

// ธีมเป็นก้อนเดียวที่ลง <style> ดิบ ๆ — ถ้ามีของที่ปิดแท็กได้ปนมา ให้ตายดังกว่าออกไฟล์เสีย
const themeCss = readFileSync(join(MOCKUP, '_theme.css'), 'utf8');
if (themeCss.toLowerCase().includes('</style') || [...themeCss].some((ch) => isCtrl(ch.charCodeAt(0)))) {
  console.error('_theme.css มี `</style` หรือ NUL ปนอยู่ — ยัดลงหน้าเดียวไม่ได้');
  process.exit(1);
}
const labelsJs = readFileSync(join(HERE, 'labels.js'), 'utf8');
const uiJs = readFileSync(join(HERE, 'ui.js'), 'utf8');

// ── 2. แยกแต่ละหน้าออกเป็น 3 ก้อน: css ของหน้า · body · สคริปต์ของหน้า ────────
//
// ทุกหน้าเขียนด้วยโครงเดียวกัน (head: link+3 script+style · body: เนื้อ + script เดียวปิดท้าย)
// ถ้าวันหนึ่งมีหน้าที่ไม่ตามโครงนี้ ให้ตัวนี้ตายดังกว่าปล่อยไฟล์ที่ขาดของออกไป
const PAGES = ['index', 'manual', 'calc', 'rules'];
const pages = PAGES.map((key) => {
  const raw = readFileSync(join(HERE, `${key}.html`), 'utf8');
  const title = raw.match(/<title>([\s\S]*?)<\/title>/);
  const css = raw.match(/<style>([\s\S]*?)<\/style>/);
  const bodyOpen = raw.indexOf('<body>');
  const scriptOpen = raw.indexOf('<script>', bodyOpen);
  const scriptClose = raw.indexOf('</script>', scriptOpen);
  if (!title || !css || bodyOpen < 0 || scriptOpen < 0) {
    console.error(`${key}.html ไม่ได้อยู่ในโครงที่ pack.mjs รู้จัก — ดูหัวไฟล์นี้ก่อนแก้`);
    process.exit(1);
  }
  return {
    key,
    title: title[1].trim(),
    css: css[1],
    html: raw.slice(bodyOpen + '<body>'.length, scriptOpen),
    js: raw.slice(scriptOpen + '<script>'.length, scriptClose),
  };
});

// ── 3. ประกอบ ───────────────────────────────────────────────────────────────
const shell = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ตัวอย่าง · เครื่องคิดราคาสินค้าสั่งทำ</title>
<style>
${themeCss}
</style>
<style id="pr-page-css"></style>
<script>
${safe(labelsJs)}
</script>
<script>
${safe(uiJs)}
</script>
<script>
${safe(engineJs)}
</script>
</head>
<body>
<div id="pr-page"></div>
<script>
(function () {
  var PAGES = {
${pages.map((p) => `    ${p.key}: { title: ${lit(p.title)}, css: ${lit(p.css)}, html: ${lit(p.html)}, js: ${lit(p.js)} }`).join(',\n')}
  };
  var ORDER = ${JSON.stringify(PAGES)};
  var host = document.getElementById('pr-page');
  var pageCss = document.getElementById('pr-page-css');
  var current = null;

  function show(key) {
    var p = PAGES[key] || PAGES.index;
    if (current === key) return;
    current = key;

    // แถบบนถูก prepend เข้า body โดย PR_UI.bar() ของหน้าที่แล้ว — เก็บทิ้งก่อน ไม่งั้นซ้อนกัน
    var bars = document.querySelectorAll('body > .mock-bar');
    for (var i = 0; i < bars.length; i++) bars[i].remove();

    pageCss.textContent = p.css;
    document.title = p.title;
    host.innerHTML = p.html;

    // สคริปต์ที่ยัดมากับ innerHTML ไม่ทำงาน ต้องสร้าง <script> ใหม่ให้เบราว์เซอร์รัน
    // ทุกหน้าเขียนเป็น IIFE อยู่แล้ว การรันซ้ำจึงไม่ชนกันเอง
    var s = document.createElement('script');
    s.textContent = p.js;
    host.appendChild(s);
    window.scrollTo(0, 0);
  }

  // ลิงก์ข้ามหน้าในแถบบน (pr-calc.html ฯลฯ) ไม่มีไฟล์ให้ไปแล้ว — แปลงเป็นการสลับหน้าในไฟล์นี้
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var m = /^pr-([a-z]+)\\.html$/.exec(a.getAttribute('href') || '');
    if (!m || !PAGES[m[1]]) return;
    e.preventDefault();
    location.hash = m[1];
  });

  function fromHash() {
    var k = (location.hash || '').replace('#', '');
    show(PAGES[k] ? k : ORDER[0]);
  }
  window.addEventListener('hashchange', fromHash);
  fromHash();
})();
</script>
</body>
</html>
`;

writeFileSync(OUT, shell, 'utf8');
const kb = (statSync(OUT).size / 1024).toFixed(0);
console.log(`ไฟล์เดียวจบ → ${OUT}  (${kb} KB)`);
console.log('ดับเบิลคลิกเปิดได้เลย · เปลี่ยนชื่อไฟล์ได้ตามใจ');
console.log('⚠️ มีราคาจริงฝังอยู่ข้างใน — ส่งเป็นไฟล์ ห้ามเอาขึ้นโฮสต์สาธารณะ');
