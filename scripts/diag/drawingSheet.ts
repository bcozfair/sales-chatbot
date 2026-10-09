// ─────────────────────────────────────────────────────────────────────────────
//  ด่านกระดาษแบบ (PDF/PNG ฝั่งเซิร์ฟเวอร์) — docs/plan-product-drawing-3d.md §5.4 · services/drawing/README.md
//
//  พิสูจน์ด้วยของจริง (Chrome ตัวแยกของ printHtml · ไม่แตะฐาน · ไม่เปิดเซิร์ฟเวอร์แอป):
//    1. PDF หน้าเดียว A4 แนวนอน (841.89 × 595.28 pt) · ฝังฟอนต์ IBM Plex Sans Thai · **ไม่มีฟอนต์สำรอง** (Loma/Garuda/DejaVu
//       = ฟอนต์ที่ฝังไม่ทำงาน ⇒ ภาษาไทยเพี้ยนแบบเงียบ ๆ ซึ่งเป็นเหตุผลเดียวกับ diag:pdf-render)
//    2. PNG 1754 × 1240 (A4 150 dpi)
//    3. Chrome ที่พิมพ์ **ไม่ยิงเน็ตออกเลย** — ฝังลิงก์ไปเซิร์ฟเวอร์ในเครื่องตรง ๆ ใน HTML (ข้าม checkStill) แล้วนับคำขอที่เข้ามา = 0
//    4. `checkStill` ปฏิเสธภาพนิ่งที่ไม่ใช่ PNG data URL / ตัวเลขผิดรูป / ข้อความยาวเกิน · ทิ้งช่องที่ไม่รู้จัก (เช่น SVG ดิบ)
//       และข้อความในป้ายถูก escape (`<script>` ไม่หลุดเป็นแท็ก)
//    6. เส้น POST /sheet ตัวจริง (router + ตัวคิดราคาจำลองที่อ่านด้วย readTsForm จริง): PDF/PNG ได้ · ภาพนิ่งผิด = 400 ·
//       มีท่อนที่แบบไม่ได้วาดแต่ไม่ติ๊ก = 409 · ชนิดไฟล์แปลก = 400
//    5. ไม่มี ∅ ในแผ่น (ฟอนต์ไม่มี glyph) · ไม่มีหมายเหตุของแบบ/ราคา
//  รัน: `npm run diag:drawing-sheet` (~5 วิ)
// ─────────────────────────────────────────────────────────────────────────────

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { closePrintBrowser, printHtml } from '../../pdfGenerator.js';
import { checkStill, renderSheet, type SheetStill } from '../../services/drawing/sheet.js';
import { A4_LANDSCAPE, sheetHtml } from '../../services/drawing/render/sheetHtml.js';
import type { BandSpec, Ts11Spec, TsCableSpec } from '../../services/drawing/types.js';
import express from 'express';
import { createDrawingRouter } from '../../routes/drawing.js';
import { readTsForm } from '../../services/pricingLab/catalogTs.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let fail = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (!cond) fail++;
  console.log(`  ${cond ? GREEN + '✓' : RED + '✗'}${RESET} ${label}${extra ? ` ${DIM}· ${extra}${RESET}` : ''}`);
};

/** PNG 1×1 ขาว (ภาพนิ่งจำลอง — ขนาดที่ประกาศคือขนาดกรอบ ไม่ใช่ขนาดไฟล์) */
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const LOGO = PNG_1x1;
const TS: Ts11Spec = { family: 'TS_-11', sensor: 'TSK', spring: 'NONE', dia: '6', mat: 'NONE', tubeLen: 100, elem: 'NONE', cableLen: 2, cable: 'NONE', ground: 'NONE' };
const BH: BandSpec = { family: 'BH-01', id: 120, h: 60, t: 4, v: '220', w: 800, term: '2', mat: 'NONE', conn: null, termPos: null, holes: [] };
/** รุ่นออกสายที่เพิ่ม 2026-10-09 — ค่าที่ทำข้อความยาวสุดของแต่ละรุ่น (เกลียวยาวสุด · RTD · ตารางแถวมากสุด) */
const CABLE_SPECS: [TsCableSpec, string][] = [
  [{ family: 'TS_-01', sensor: 'PA', thread: 'M10x1.5', dia: '6', tubeLen: 100, mat: 'NONE', cableLen: 10, cable: 'TS', ground: 'U' }, 'TSPA-01(M10x1.5)6x100+10MTSU'],
  [{ family: 'TS_-01-0', sensor: 'Z', hold: 'M10', cableLen: 2.5, cable: 'F', ground: 'U' }, 'TSZ-01-0(M10)+2.5MFU'],
  [{ family: 'TS_-02', sensor: 'K', lock: '15.5', dia: '8', mat: 'A', tubeLen: 30, cableLen: 3, cable: 'C', ground: 'U' }, 'TSK-02(15.5)8Ax30+3MCU'],
  [{ family: 'TS_-03', sensor: 'N10', dia: '6.35', mat: 'S', tubeLen: 250, elem: '2', cableLen: 5, cable: 'T', ground: 'U' }, 'N10-03 6.35Sx250-2+5MTU'],
  [{ family: 'TS_-05', sensor: 'TSPA', lock: '14.5', dia: '6', mat: 'A', tubeLen: 20, elem: '2', cableLen: 2, cable: 'F', ground: 'U' }, 'TSPA-05(14.5)6Ax20-2+2MFU'],
];
const STILL: SheetStill = {
  png: PNG_1x1, w: 872, h: 640,
  marks: {
    dims: [{ lines: [[10, 10, 200, 10]], arrows: [{ x: 10, y: 10, dx: -1, dy: 0 }], text: { x: 90, y: 0, h: 20, s: 'L1 100 mm.' } }],
    leaders: [{ pts: [[300, 300], [320, 200], [400, 200]] }],
    labels: [{ x: 400, y: 180, w: 120, text: 'สาย <script>alert(1)</script>', sub: 'Ø 6' }],
  },
};
const meta = { drawer: 'คุณทดสอบ', date: '09/10/2569' };

const pdfFonts = (b: Buffer) => [...new Set((b.toString('latin1').match(/\/BaseFont\s*\/[A-Za-z0-9+\-]+/g) ?? []).map((s) => s.replace(/^\/BaseFont\s*\/(?:[A-Z]{6}\+)?/, '')))];
const pdfPages = (b: Buffer) => (b.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
const mediaBox = (b: Buffer) => /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(b.toString('latin1'));

try {
  console.log('\n── PDF / PNG จาก Chrome ตัวแยก ─────────────────────');
  const sheetTs = renderSheet({ spec: TS, code: 'TSK-11-6X100+2M', still: STILL, logo: LOGO, meta });
  const t0 = Date.now();
  const pdf = Buffer.from(await printHtml(sheetHtml(sheetTs), { kind: 'pdf', widthMm: A4_LANDSCAPE.w, heightMm: A4_LANDSCAPE.h }));
  const msPdf = Date.now() - t0;
  const fonts = pdfFonts(pdf), mb = mediaBox(pdf);
  ok('1 · PDF หน้าเดียว A4 แนวนอน', pdf.subarray(0, 5).toString() === '%PDF-' && pdfPages(pdf) === 1 && !!mb && Math.abs(Number(mb[1]) - 841.89) < 1 && Math.abs(Number(mb[2]) - 595.28) < 1,
     `${pdfPages(pdf)} หน้า · ${mb ? `${mb[1]} × ${mb[2]} pt` : 'ไม่มี MediaBox'} · ${(pdf.length / 1024).toFixed(0)} KB · ${msPdf} ms (รวมเปิด Chrome)`);
  ok('   ฝัง IBM Plex Sans Thai · ไม่มีฟอนต์สำรอง', fonts.some((f) => /IBMPlexSansThai/i.test(f)) && !fonts.some((f) => /Loma|Garuda|DejaVu|Kinnari|Norasi|Sawasdee|Umpush|Waree|Purisa|Tlwg|Liberation/i.test(f)), fonts.join(', '));
  const t1 = Date.now();
  const pdf2 = Buffer.from(await printHtml(sheetHtml(renderSheet({ spec: BH, code: 'BH-01-120X60-220-800W-2', still: null, logo: LOGO, meta })), { kind: 'pdf', widthMm: A4_LANDSCAPE.w, heightMm: A4_LANDSCAPE.h }));
  ok('   BH-01 ไม่มีภาพนิ่ง (ภาพฉายเต็มกรอบ) ก็หน้าเดียว', pdfPages(pdf2) === 1, `${Date.now() - t1} ms (Chrome เปิดค้างไว้แล้ว)`);
  const cablePages: string[] = [];
  for (const [spec, code] of CABLE_SPECS)
    for (const still of [STILL, null]) {
      const b = Buffer.from(await printHtml(sheetHtml(renderSheet({ spec, code, still, logo: LOGO, meta })), { kind: 'pdf', widthMm: A4_LANDSCAPE.w, heightMm: A4_LANDSCAPE.h }));
      if (pdfPages(b) !== 1) cablePages.push(`${spec.family}${still ? '' : ' (ไม่มีภาพนิ่ง)'} ${pdfPages(b)} หน้า`);
    }
  ok('   TS_-01 · 01-0 · 02 · 03 · 05 ข้อความยาวสุด ก็หน้าเดียว (มี/ไม่มีภาพนิ่ง)', cablePages.length === 0, cablePages.join(', ') || `${CABLE_SPECS.length * 2} แผ่น`);
  const png = Buffer.from(await printHtml(sheetHtml(sheetTs), { kind: 'png', widthMm: A4_LANDSCAPE.w, heightMm: A4_LANDSCAPE.h, pngWidthPx: 1754 }));
  const pw = png.readUInt32BE(16), ph = png.readUInt32BE(20);
  ok('2 · PNG 1754 × 1240', png.subarray(1, 4).toString() === 'PNG' && pw === 1754 && Math.abs(ph - 1240) <= 1, `${pw} × ${ph} · ${(png.length / 1024).toFixed(0)} KB`);

  console.log('\n── Chrome ที่พิมพ์ไม่ยิงเน็ต ─────────────────────────');
  let hits = 0;
  const srv = createServer((_q, r) => { hits++; r.end('x'); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as AddressInfo).port;
  const evil = sheetTs.replace('</svg>', `<image href="http://127.0.0.1:${port}/img.png" x="0" y="0" width="10" height="10"/><image href="file:///etc/passwd" x="0" y="0" width="10" height="10"/></svg>`)
    .replace('<rect', `<foreignObject width="1" height="1"><iframe xmlns="http://www.w3.org/1999/xhtml" src="http://127.0.0.1:${port}/frame"></iframe></foreignObject><rect`);
  const html = sheetHtml(evil).replace('</head>', `<link rel="stylesheet" href="http://127.0.0.1:${port}/x.css"></head>`);
  await printHtml(html, { kind: 'pdf', widthMm: A4_LANDSCAPE.w, heightMm: A4_LANDSCAPE.h });
  srv.close();
  ok('3 · ลิงก์ภาพ/สไตล์/iframe ที่ฝังตรง ๆ ไม่ถูกโหลด (เซิร์ฟเวอร์ในเครื่องได้คำขอ 0)', hits === 0, `${hits} คำขอ`);

  console.log('\n── ตัวตรวจภาพนิ่ง (checkStill) ───────────────────────');
  const bad: [string, unknown][] = [
    ['ลิงก์ http แทน PNG', { ...STILL, png: 'http://evil.example/x.png' }],
    ['data URL ที่ไม่ใช่ PNG', { ...STILL, png: 'data:image/svg+xml;base64,PHN2Zy8+' }],
    ['base64 มีอักขระแปลก', { ...STILL, png: `${PNG_1x1}"/><script>` }],
    ['ขนาดภาพเกิน', { ...STILL, w: 99999 }],
    ['ตัวเลขไม่ใช่ตัวเลข', { ...STILL, marks: { ...STILL.marks, labels: [{ x: '1"/><x', y: 0, w: 10, text: 'a' }] } }],
    ['ข้อความยาวเกิน', { ...STILL, marks: { ...STILL.marks, labels: [{ x: 1, y: 0, w: 10, text: 'ก'.repeat(500) }] } }],
    ['เส้นโยงจุดเกิน', { ...STILL, marks: { ...STILL.marks, leaders: [{ pts: Array.from({ length: 50 }, () => [1, 1]) }] } }],
  ];
  const rejected = bad.filter(([, v]) => typeof checkStill(v) === 'string');
  ok('4 · ปฏิเสธภาพนิ่งผิดรูปทุกแบบ', rejected.length === bad.length, bad.filter((b) => !rejected.includes(b)).map(([n]) => n).join(', ') || `${bad.length}/${bad.length}`);
  const withMarkup = checkStill({ ...STILL, overlay: '<image href="http://evil"/>', marks: { ...STILL.marks, extra: '<x/>' } });
  ok('   ทิ้งช่องที่ไม่รู้จัก (SVG ดิบไม่ผ่านเข้าแผ่น)', typeof withMarkup !== 'string' && !JSON.stringify(withMarkup).includes('evil') && !JSON.stringify(withMarkup).includes('<x/>'));
  const clean = checkStill(STILL);
  const out = typeof clean === 'string' ? '' : renderSheet({ spec: TS, code: 'TSK-11-6X100+2M', still: clean, logo: LOGO, meta });
  ok('   ข้อความในป้ายถูก escape', out.includes('สาย &lt;script&gt;alert(1)&lt;/script&gt;') && !out.includes('<script'));

  console.log('\n── เนื้อหาของแผ่น ─────────────────────────────────');
  ok('5 · ไม่มี ∅ (ฟอนต์ไม่มี glyph) — ใช้ Ø', !/&#8709;|∅/.test(sheetTs) && /&#216;D1 6/.test(sheetTs));
  ok('   ไม่มีหมายเหตุของแบบ · ไม่มีราคา · มี "ไม่ใช่แบบผลิต"', !/หมายเหตุของแบบ|สปริงลวด|บาท|฿/.test(sheetTs) && /ไม่ใช่แบบผลิต/.test(sheetTs));

  console.log('\n── เส้น POST /sheet ───────────────────────────────────');
  const app = express();
  app.use((req, _res, next) => { (req as { admin?: unknown }).admin = { id: 1, username: 'probe', name: 'คุณทดสอบ', role: 'admin' }; next(); });
  app.use('/d', createDrawingRouter({
    quote: async (code) => ({ code, parsed: { tsForm: readTsForm(code, 'TS_-11') ?? undefined, cfg: { options: [] } }, outcome: { status: 'priced' } }),
    print: printHtml,
  }));
  const http = app.listen(0, '127.0.0.1');
  await new Promise((r) => http.once('listening', r));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/d/sheet`;
  const post = (body: unknown) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const r1 = await post({ code: 'TSK-11 6x100+2M', format: 'pdf', still: STILL });
  const b1 = Buffer.from(await r1.arrayBuffer());
  ok('6 · PDF จากเส้นจริง (ภาพนิ่ง + ผู้เขียนแบบจากผู้ใช้ที่ล็อกอิน)', r1.status === 200 && r1.headers.get('content-type') === 'application/pdf' && b1.subarray(0, 5).toString() === '%PDF-' && /filename="TSK-11_6x100\+2M\.pdf"/.test(r1.headers.get('content-disposition') ?? ''), `${r1.status} · ${(b1.length / 1024).toFixed(0)} KB`);
  const r2 = await post({ code: 'TSK-11 6x100+2M', format: 'png' });
  ok('   PNG ไม่มีภาพนิ่ง (ภาพฉายเต็มกรอบ)', r2.status === 200 && r2.headers.get('content-type') === 'image/png', String(r2.status));
  const r3 = await post({ code: 'TSK-11 6x100+2M', format: 'pdf', still: { ...STILL, png: 'http://evil/x.png' } });
  ok('   ภาพนิ่งผิดรูป = 400', r3.status === 400, `${r3.status} ${(await r3.json()).error}`);
  const r4 = await post({ code: 'TSK-11 6x100+2M-S000', format: 'pdf' });
  const r4b = await post({ code: 'TSK-11 6x100+2M-S000', format: 'pdf', confirmed: true });
  ok('   มีท่อนที่แบบไม่ได้วาด: ไม่ติ๊ก = 409 · ติ๊กแล้ว = 200', r4.status === 409 && r4b.status === 200, `${r4.status} / ${r4b.status}`);
  const r5 = await post({ code: 'TSK-11 6x100+2M', format: 'exe' });
  ok('   ชนิดไฟล์แปลก = 400', r5.status === 400, String(r5.status));
  http.close();
} catch (e) {
  fail++;
  console.log(`  ${RED}✗ ด่านล้มกลางทาง:${RESET}`, e instanceof Error ? e.message : e);
} finally {
  await closePrintBrowser();
}
console.log(fail ? `\n${RED}ไม่ผ่าน ${fail} ข้อ${RESET}` : `\n${GREEN}ผ่านทุกข้อ${RESET}`);
process.exit(fail ? 1 : 0);
