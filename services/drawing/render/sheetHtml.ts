// ─────────────────────────────────────────────────────────────────────────────
//  หน้า HTML สำหรับพิมพ์กระดาษแบบเป็น PDF/PNG (แผน §5.4 ข้อ 5) — **ฝั่งเซิร์ฟเวอร์เท่านั้น** (อ่านไฟล์ฟอนต์ด้วย node:fs ·
//  หน้าเว็บไม่ import ไฟล์นี้ — การ์ดสร้าง SVG เองจาก sheet.ts)
//
//  ฟอนต์ IBM Plex Sans Thai ฝังเป็น data URL ในหน้า (`fonts/` · @fontsource/ibm-plex-sans-thai 5.3.0 · OFL-1.1 ดู `fonts/OFL.txt`)
//  เพราะ (1) กล่อง prod ไม่มีฟอนต์นี้ — Chrome จะตกไป Loma ของ fonts-thai-tlwg แบบเงียบ ๆ · (2) Chrome ที่พิมพ์ถูกบล็อกเน็ตทั้งหมด
//  (Google Fonts ใช้ไม่ได้ตั้งใจ) · ชุด thai + latin น้ำหนัก 400–700 = 8 ไฟล์ ~120 KB · ไม่มี ∅ ⇒ sheet.ts ใช้ Ø แทน
//  · unicode-range ตามไฟล์ CSS ของแพ็กเกจ (ชุดไหนครอบอักขระไหน)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FONT_DIR = fileURLToPath(new URL('./fonts/', import.meta.url));
const RANGES = {
  thai: 'U+02D7,U+0303,U+0331,U+0E01-0E5B,U+200C-200D,U+25CC',
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
} as const;
const WEIGHTS = [400, 500, 600, 700] as const;

let fontCss: string | null = null;
function fonts(): string {
  if (fontCss) return fontCss;
  let css = '';
  for (const w of WEIGHTS) for (const [sub, range] of Object.entries(RANGES)) {
    const b64 = readFileSync(`${FONT_DIR}ibm-plex-sans-thai-${sub}-${w}-normal.woff2`).toString('base64');
    css += `@font-face{font-family:'IBM Plex Sans Thai';font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range}}\n`;
  }
  return (fontCss = css);
}

/** ขนาดกระดาษ A4 แนวนอน (mm) — กระดาษแบบ 980 × 693 มีสัดส่วนเดียวกัน */
export const A4_LANDSCAPE = { w: 297, h: 210 } as const;

/** SVG ของกระดาษแบบทั้งแผ่น → หน้า HTML ที่พิมพ์ได้หน้าเดียวพอดี A4 แนวนอน */
export function sheetHtml(svg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fonts()}@page{size:${A4_LANDSCAPE.w}mm ${A4_LANDSCAPE.h}mm;margin:0}
html,body{margin:0;padding:0;background:#fff}
body>svg{display:block;width:${A4_LANDSCAPE.w}mm;height:${A4_LANDSCAPE.h}mm}
</style></head><body>${svg}</body></html>`;
}
