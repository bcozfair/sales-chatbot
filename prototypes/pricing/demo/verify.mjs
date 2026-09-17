// ─────────────────────────────────────────────────────────────────────────────
//  PROTOTYPE — ด่านตรวจหน้าตา: render จริงด้วย puppeteer ครบ 4 ความกว้าง
//
//  ความกว้าง 390 / 640 / 641 / 1280 มาจาก docs/design.md §10 — 640 กับ 641 อยู่คู่กัน
//  เพราะเบรกพอยต์ sm ของ Tailwind อยู่ตรงนั้นพอดี บั๊กของ layout จะโผล่ที่รอยต่อ ไม่ใช่ตรงกลาง
//  วัด scrollWidth - clientWidth ด้วย เพราะการล้นแนวนอนไม่ error และมองข้ามได้ง่ายบนจอใหญ่
//
//  รัน:  node prototypes/pricing/demo/verify.mjs <โฟลเดอร์ mockup> <โฟลเดอร์เก็บภาพ>
// ─────────────────────────────────────────────────────────────────────────────

import puppeteer from 'puppeteer';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const DIR = process.argv[2];
const OUT = process.argv[3];
const PAGES = ['pr-index.html', 'pr-manual.html', 'pr-calc.html'];
const WIDTHS = [390, 640, 641, 1280];

const browser = await puppeteer.launch({ headless: true });
let bad = 0;

for (const p of PAGES) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  for (const w of WIDTHS) {
    await page.setViewport({ width: w, height: w < 700 ? 900 : 1000, deviceScaleFactor: 1 });
    if (w === WIDTHS[0]) await page.goto(pathToFileURL(join(DIR, p)).href, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 350));
    const m = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sw: document.documentElement.scrollWidth,
      title: document.title,
      bg: getComputedStyle(document.body).backgroundColor,
      font: getComputedStyle(document.body).fontFamily.split(',')[0],
      wideSvg: [...document.querySelectorAll('svg')].filter((s) => s.getBoundingClientRect().width > 40).length
    }));
    const flag = m.over > 1 ? '  ← ล้นแนวนอน' : '';
    if (m.over > 1) bad++;
    console.log(`${p.padEnd(16)} ${String(w).padStart(5)}px  ล้น ${String(m.over).padStart(4)}  ${m.font}${flag}`);
    await page.screenshot({ path: join(OUT, `${p.replace('.html', '')}-${w}.png`), fullPage: w === 1280 });
  }

  // ธีมสว่าง
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await new Promise((r) => setTimeout(r, 250));
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.screenshot({ path: join(OUT, `${p.replace('.html', '')}-light.png`), fullPage: true });
  console.log(`${p.padEnd(16)} ธีมสว่าง พื้น ${light}`);

  if (errors.length) { bad++; console.log(`  ERRORS: ${errors.join(' | ')}`); }
  await page.close();
}

console.log(bad ? `\nมีปัญหา ${bad} จุด` : '\nผ่านทุกความกว้าง ไม่มี error');
await browser.close();
