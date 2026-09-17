// ─────────────────────────────────────────────────────────────────────────────
//  PROTOTYPE — ด่านตรวจหน้าตา: render จริงด้วย puppeteer ครบ 4 ความกว้าง
//
//  ความกว้าง 390 / 640 / 641 / 1280 มาจาก docs/design.md §10 — 640 กับ 641 อยู่คู่กัน
//  เพราะเบรกพอยต์ sm ของ Tailwind อยู่ตรงนั้นพอดี บั๊กของ layout จะโผล่ที่รอยต่อ ไม่ใช่ตรงกลาง
//  วัด scrollWidth - clientWidth ด้วย เพราะการล้นแนวนอนไม่ error และมองข้ามได้ง่ายบนจอใหญ่
//
//  รัน:  node prototypes/pricing/demo/verify.mjs <โฟลเดอร์ mockup> <โฟลเดอร์เก็บภาพ>
// ─────────────────────────────────────────────────────────────────────────────

import ExcelJS from 'exceljs';
import puppeteer from 'puppeteer';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const DIR = process.argv[2];
const OUT = process.argv[3];
const PAGES = ['pr-index.html', 'pr-manual.html', 'pr-calc.html', 'pr-rules.html'];
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

// ─────────────────────────────────────────────────────────────────────────────
//  ด่านที่สอง: ไฟล์ .xlsx ที่ "ผ่านมือไลบรารี Excel มาแล้ว" ต้องอ่านกลับในเบราว์เซอร์ได้
//
//  ด่านใน Node (roundtrip.ts) พิสูจน์ฝั่งเขียนไปแล้ว แต่พิสูจน์ฝั่ง **อ่านในเบราว์เซอร์** ไม่ได้
//  และสองอย่างนี้ต่างกันจริง: ไฟล์ที่เราเขียนเองเก็บแบบไม่บีบอัดและฝังข้อความไว้ในชีต
//  ส่วนไฟล์ที่ออกจาก Excel **บีบอัดด้วย deflate และย้ายข้อความไปไว้ที่ sharedStrings**
//  ⇒ ถ้าทดสอบด้วยไฟล์ของตัวเองอย่างเดียว เส้นทางที่ผู้ใช้จริงเดินจะไม่เคยถูกรันเลย
//
//  จึงให้หน้าเว็บปั้นไฟล์ → เอามาให้ exceljs บันทึกใหม่ (ได้ไฟล์แบบที่ Excel ทำ) → ส่งกลับเข้าหน้าเว็บ
// ─────────────────────────────────────────────────────────────────────────────

{
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(pathToFileURL(join(DIR, 'pr-rules.html')).href, { waitUntil: 'networkidle0' });

  const stored = await page.evaluate(() => {
    const sheets = PR_ENGINE.bookToSheets(window.PR_BOOK, { exportedAt: '2026-09-17' });
    return Array.from(PR_ENGINE.writeXlsx(sheets));
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(stored));
  const deflated = Array.from(new Uint8Array(await wb.xlsx.writeBuffer()));
  console.log(
    `\nแม่แบบที่หน้าเว็บปั้นเอง ${(stored.length / 1024).toFixed(0)} KB ` +
      `→ ให้ exceljs บันทึกใหม่ (บีบอัด + sharedStrings) ${(deflated.length / 1024).toFixed(0)} KB`
  );

  const r = await page.evaluate(async (bytes) => {
    const grids = await PR_ENGINE.readXlsxInBrowser(new Uint8Array(bytes));
    const res = PR_ENGINE.sheetsToBook(grids);
    const errs = res.issues.filter((i) => i.level === 'error');
    let diff = 0;
    for (const c of window.PR_CASES) {
      const a = PR_ENGINE.computePrice(c.cfg, window.PR_BOOK);
      const b = PR_ENGINE.computePrice(c.cfg, res.book);
      if (a.unitPrice !== b.unitPrice || a.status !== b.status) diff++;
    }
    const odoo = PR_ENGINE.bookToOdooSheets(window.PR_BOOK, { exportedAt: '2026-09-17' });
    const odooBytes = PR_ENGINE.writeXlsx(odoo.sheets);
    return {
      sheets: grids.length,
      models: res.book ? Object.keys(res.book.models).length : 0,
      errors: errs.slice(0, 5).map((e) => `${e.sheet}${e.row ? ' แถว ' + e.row : ''} — ${e.message}`),
      diff,
      cases: window.PR_CASES.length,
      odooRows: odoo.rowCount,
      odooKB: Math.round(odooBytes.length / 1024)
    };
  }, deflated);

  const ok = r.errors.length === 0 && r.diff === 0 && r.models === 6;
  if (!ok) bad++;
  console.log(`  อ่านกลับได้ ${r.sheets} ชีต · ${r.models} รุ่น · ราคาต่างจากเดิม ${r.diff}/${r.cases} เคส`);
  for (const e of r.errors) console.log(`    ✗ ${e}`);
  console.log(`  ตารางราคาสำหรับ Odoo: ${r.odooRows} รายการ · ${r.odooKB} KB`);
  if (errors.length) {
    bad++;
    console.log(`  ERRORS: ${errors.join(' | ')}`);
  }
  await page.close();
}

console.log(bad ? `\nมีปัญหา ${bad} จุด` : '\nผ่านทุกความกว้าง ไม่มี error · ไฟล์ .xlsx เดินทางไปกลับแล้วราคาไม่ขยับ');
await browser.close();
