// ─────────────────────────────────────────────────────────────────────────────
//  กระดาษแบบ A4 แนวนอน แผ่นละหน้า (แผน §5.4 · แบบ C2 · mockup รอบ 5 แท็บ C ที่เจ้าของเคาะ) — คืน SVG ทั้งแผ่น
//
//  โครงยกจาก Appsale `engine/sheet.js` ที่ `4dd2475` (กรอบ · โลโก้ · ตาราง · title block · คลาสสไตล์) แล้วปรับตามที่เคาะ:
//  · ความสูง 693 = สัดส่วน A4 จริง (980 × 693 ≈ √2) ไม่ใช่ 640 ของ Appsale · **ใบละอย่าง** (`view` · เจ้าของ 2026-10-09):
//    ใบ 3 มิติ = ภาพนิ่งเต็มกรอบ `PIC_3D` · ใบ 2 มิติ = ภาพฉายเต็มกรอบ · ใบคู่ = สองแผ่นต่อกัน (คนเรียกเรียกสองครั้ง) · ไม่มีภาพแยกชิ้น
//    การ์ดแอดมินแสดงใบ 3 มิติที่ไม่มีภาพนิ่ง (กรอบว่าง) เป็นพื้น แล้ววางตัวดูทับ `PIC_3D` พอดี ⇒ ภาพบนจอ = ภาพในไฟล์
//  · title block 9 ช่อง (เพิ่ม "เลขที่แบบ") · บรรทัดกำกับ "แบบอ้างอิงตามแคตตาล็อก … ไม่ใช่แบบผลิต" · **ไม่มีราคา · ไม่มีหมายเหตุของแบบ**
//    (หมายเหตุเห็นเฉพาะการ์ดแอดมิน — เจ้าของเคาะ mockup รอบ 5 ข้อ 2)
//  · ระยะบรรทัดตารางขั้นต่ำ 15 (สระบน-ล่างภาษาไทยชนกันที่ 14) · ข้อความยาวบีบด้วย `textLength` ไม่ให้ล้นกรอบ
//
//  ภาพ 3 มิติไม่ได้สร้างที่นี่ — คนเรียกส่ง "ภาพนิ่ง" มา (`still`: PNG + ป้ายชื่อ/ขนาดเป็น SVG ในพิกัดของภาพ) จากตัวดูชุดเดียวกับจอ
//  ⇒ มุมกล้อง/ซูมที่ผู้ใช้ตั้งบนจอติดไปกับไฟล์ (A12–A13) · ไม่ส่ง `view` = ใบ 3 มิติเมื่อมีภาพนิ่ง ไม่งั้นใบ 2 มิติ
//  · ขนาดตัวอักษรที่ต้องการทับคลาสเขียนเป็น `style=` (CSS ของคลาสชนะ attribute `font-size` — ใน Appsale ค่าเหล่านั้นไม่เคยมีผล)
//  · ใช้ numeric entity เท่านั้นใน SVG (Appsale เคยพังทั้งไฟล์เพราะ named entity) · ข้อความจากผู้ใช้ผ่าน `esc()` ทุกตัว
// ─────────────────────────────────────────────────────────────────────────────

import type { DrawingSpec } from './types.js';
import { specRows } from './sheetText.js';
import { SW, esc } from './views/draw.js';
import { SHEET_BOX, orthoView } from './views/index.js';
import { SHEET_DEFS, SHEET_FONT } from './views/style.js';

/** ความสูงกระดาษ — สัดส่วน A4 แนวนอน */
export const SHEET_H = 693;
/** ความกว้างกระดาษ (หน่วยกระดาษ) — การ์ดใช้ตั้งสัดส่วนกระดาษบนจอ */
export const SHEET_W = SW;

/**
 * ป้ายบนภาพนิ่ง (พิกัดพิกเซลของภาพ) — **ตัวเลข + ข้อความ ไม่ใช่ SVG** · โมดูลสร้าง SVG เองแล้ว escape ทุกข้อความ
 * เพราะภาพนิ่งมาจากเบราว์เซอร์ของผู้ใช้แล้วเซิร์ฟเวอร์เอาไปพิมพ์ใน Chrome — รับ markup = เปิดทางฝังลิงก์ไปที่อื่น
 */
export interface StillMarks {
  /** เส้นบอกขนาด: เส้น [x1 y1 x2 y2] · หัวลูกศร (ปลาย + ทิศ) · ตัวเลข (มุมซ้ายบน + สูง) */
  dims: { lines: [number, number, number, number][]; arrows: { x: number; y: number; dx: number; dy: number }[]; text: { x: number; y: number; h: number; s: string } }[];
  /** เส้นโยงป้าย (จุดแรกติดชิ้น) */
  leaders: { pts: [number, number][] }[];
  /** ป้ายชื่อชิ้น: กล่อง (มุมซ้ายบน + กว้าง) · บรรทัดรอง */
  labels: { x: number; y: number; w: number; text: string; sub?: string }[];
}
/** ภาพ 3 มิติจากตัวดู: PNG (data URL) ขนาด w × h px + ป้าย */
export interface SheetStill { png: string; w: number; h: number; marks: StillMarks }

/** หัวลูกศรของเส้นบอกขนาด (สูตรเดียวกับตัวดู `arrowPts`) */
const arrowPts = (a: { x: number; y: number; dx: number; dy: number }, sz: number) => {
  const bx = a.x - a.dx * sz, by = a.y - a.dy * sz, px = -a.dy * sz * 0.38, py = a.dx * sz * 0.38;
  return `${a.x},${a.y} ${bx + px},${by + py} ${bx - px},${by - py}`;
};
/** ป้ายบนภาพนิ่ง → เนื้อ SVG (คลาส `st*` ใน style.ts · หน่วยพิกเซลของภาพนิ่ง) */
function stillOverlay(m: StillMarks): string {
  let svg = '';
  for (const d of m.dims) {
    for (const [x1, y1, x2, y2] of d.lines) svg += `<line class="stdm" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    for (const a of d.arrows) svg += `<polygon class="stah" points="${arrowPts(a, 11)}"/>`;
    svg += `<text class="stdt" x="${d.text.x + 2}" y="${d.text.y + d.text.h * 0.78}">${esc(d.text.s)}</text>`;
  }
  for (const ld of m.leaders) {
    if (!ld.pts.length) continue;
    svg += `<polyline class="stld" points="${ld.pts.map(([x, y]) => `${x},${y}`).join(' ')}"/><circle class="stdot" cx="${ld.pts[0][0]}" cy="${ld.pts[0][1]}" r="3"/>`;
  }
  for (const l of m.labels) {
    const cx = l.x + l.w / 2;
    svg += `<text class="stlb" x="${cx}" y="${l.y + 17}">${esc(l.text)}</text>`;
    if (l.sub) svg += `<text class="stsb" x="${cx}" y="${l.y + 37}">${esc(l.sub)}</text>`;
  }
  return svg;
}

/** ขนาดภาพนิ่งที่รับ (หน่วยภาพ) — กระดาษวางในกรอบ 436 กว้าง */
const STILL_MAX = { w: 2000, h: 2000, png: 6_000_000, items: 200, text: 120 };
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e6;
const isText = (s: unknown): s is string => typeof s === 'string' && s.length <= STILL_MAX.text;
/**
 * ตรวจภาพนิ่งที่มาจากหน้าจอก่อนเซิร์ฟเวอร์เอาไปพิมพ์ — คืน `SheetStill` ที่สร้างใหม่จากช่องที่รู้จักเท่านั้น หรือข้อความว่าผิดตรงไหน
 * PNG ต้องเป็น data URL base64 ที่ขึ้นต้นด้วยลายเซ็น PNG (ไม่รับลิงก์ภายนอก) · ตัวเลขต้องจำกัด · ข้อความจำกัดความยาว
 */
export function checkStill(x: unknown): SheetStill | string {
  if (!x || typeof x !== 'object') return 'ไม่มีภาพนิ่ง';
  const o = x as Record<string, unknown>;
  if (!isNum(o.w) || !isNum(o.h) || o.w < 50 || o.h < 50 || o.w > STILL_MAX.w || o.h > STILL_MAX.h) return 'ขนาดภาพนิ่งผิด';
  if (typeof o.png !== 'string' || o.png.length > STILL_MAX.png || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(o.png)) return 'ภาพนิ่งไม่ใช่ PNG';
  const m = o.marks as Record<string, unknown> | undefined;
  if (!m || !Array.isArray(m.dims) || !Array.isArray(m.leaders) || !Array.isArray(m.labels)) return 'ป้ายของภาพนิ่งผิดรูป';
  if (m.dims.length + m.leaders.length + m.labels.length > STILL_MAX.items) return 'ป้ายของภาพนิ่งมากเกิน';
  const marks: StillMarks = { dims: [], leaders: [], labels: [] };
  for (const d of m.dims as Record<string, unknown>[]) {
    const t = d?.text as Record<string, unknown> | undefined;
    if (!Array.isArray(d?.lines) || !Array.isArray(d?.arrows) || !t || !isNum(t.x) || !isNum(t.y) || !isNum(t.h) || !isText(t.s)) return 'เส้นบอกขนาดผิดรูป';
    const lines = (d.lines as unknown[]).filter((l): l is [number, number, number, number] => Array.isArray(l) && l.length === 4 && l.every(isNum));
    const arrows = (d.arrows as Record<string, unknown>[]).filter((a) => a && isNum(a.x) && isNum(a.y) && isNum(a.dx) && isNum(a.dy))
      .map((a) => ({ x: a.x as number, y: a.y as number, dx: a.dx as number, dy: a.dy as number }));
    if (lines.length !== d.lines.length || arrows.length !== d.arrows.length) return 'เส้นบอกขนาดผิดรูป';
    marks.dims.push({ lines: lines.map((l) => [l[0], l[1], l[2], l[3]]), arrows, text: { x: t.x, y: t.y, h: t.h, s: t.s } });
  }
  for (const ld of m.leaders as Record<string, unknown>[]) {
    const pts = Array.isArray(ld?.pts) ? (ld.pts as unknown[]) : null;
    if (!pts || pts.length > 8 || !pts.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNum))) return 'เส้นโยงผิดรูป';
    marks.leaders.push({ pts: (pts as [number, number][]).map(([a, b]) => [a, b]) });
  }
  for (const l of m.labels as Record<string, unknown>[]) {
    if (!l || !isNum(l.x) || !isNum(l.y) || !isNum(l.w) || !isText(l.text) || (l.sub !== undefined && !isText(l.sub))) return 'ป้ายชื่อผิดรูป';
    marks.labels.push({ x: l.x, y: l.y, w: l.w, text: l.text, ...(typeof l.sub === 'string' ? { sub: l.sub } : {}) });
  }
  return { png: o.png, w: o.w, h: o.h, marks };
}

export interface SheetMeta {
  /** เลขที่แบบ (รหัสสั้นของลิงก์ · เฟส 2) — ว่าง = "—" */
  drawNo?: string | null;
  customer?: string | null;
  qty?: number | null;
  /** ผู้เขียนแบบ */
  drawer?: string | null;
  /** วันที่ตามที่จะพิมพ์ (วันไทย — คนเรียกจัดรูปเอง) */
  date?: string | null;
}

/** กรอบภาพ 3 มิติบนกระดาษแบบ 3 มิติ (หน่วยกระดาษ) — การ์ดวางตัวดูทับกรอบนี้พอดี ⇒ ภาพบนจอ = ภาพในไฟล์ */
export const PIC_3D = { x: 64, y: 78, w: 852, h: 352 } as const;
/** ขนาดภาพนิ่งที่การ์ดถ่าย (= กรอบ × 2) */
export const STILL_3D = { w: PIC_3D.w * 2, h: PIC_3D.h * 2 } as const;

/** ชนิดกระดาษ: ภาพ 3 มิติ หรือภาพฉาย 2 มิติ — ใบละอย่าง (เจ้าของ 2026-10-09) */
export type SheetView = '3d' | '2d';

export interface SheetInput {
  spec: DrawingSpec;
  /** รหัสสินค้าที่คิดราคา */
  code: string;
  /** ไม่ส่ง = 3 มิติเมื่อมีภาพนิ่ง ไม่งั้น 2 มิติ */
  view?: SheetView;
  /** ภาพนิ่ง 3 มิติ · กระดาษ 3 มิติที่ไม่มีภาพนิ่ง = กรอบว่าง (พื้นของการ์ดบนจอ ซึ่งวางตัวดูทับ) */
  still: SheetStill | null;
  meta: SheetMeta;
  /** โลโก้ Primus (data URL) — ใบของ THT ก็ใช้หัว Primus (เจ้าของเคาะ 2026-10-06) */
  logo: string;
}

/** หัวกระดาษของรุ่น (`product.title` ของ Appsale) */
function titleOf(spec: DrawingSpec): string {
  switch (spec.family) {
    case 'TS_-11': return 'หัววัดแกนตรง + สปริง (TS_-11) &#8212; แบบเสนอราคา';
    case 'BH-01':
    case 'BH-01C': return 'BAND HEATER &#8212; แบบเสนอราคา';
    case 'TS_-01': return 'THERMOCOUPLE / RTD (TS_-01)';
    case 'TS_-01-0': return 'Thermocouple / RTD (TS_-01-0) &#8212; แบบเสนอราคา';
    case 'TS_-02': return 'Thermocouple / RTD (TS_-02) &#8212; แบบเสนอราคา';
    case 'TS_-03': return 'Thermocouple / NTC / PTC (TS_-03) &#8212; แบบเสนอราคา';
    case 'TS_-05': return 'Thermocouple / NTC / PTC (TS_-05) &#8212; แบบเสนอราคา';
  }
}

/** ความยาวที่ใช้ตัดสินว่าต้องบีบข้อความ — entity นับหนึ่งตัว · สระ/วรรณยุกต์บน-ล่างไม่กินที่ */
const visLen = (s: string) => s.replace(/&#\d+;/g, 'x').replace(/[ัิ-ฺ็-๎]/g, '').length;
const DASH = '&#8212;';
/** ข้อความผู้ใช้ → SVG (escape · ว่าง = ขีด) */
const field = (s: string | null | undefined) => (s && s.trim() ? esc(s) : DASH);

export function renderSheet(input: SheetInput): string {
  const { spec, code, still, meta, logo } = input;
  const H = SHEET_H;
  const view: SheetView = input.view ?? (still ? '3d' : '2d');
  let g: string, scale: string, mode: string;
  if (view === '3d') {
    const P = PIC_3D;
    g = still ? `<svg x="${P.x}" y="${P.y}" width="${P.w}" height="${P.h}" viewBox="0 0 ${still.w} ${still.h}" preserveAspectRatio="xMidYMid meet" overflow="visible">`
      + `<image href="${still.png}" x="0" y="0" width="${still.w}" height="${still.h}" preserveAspectRatio="xMidYMid meet"/>${stillOverlay(still.marks)}</svg>` : '';
    g += `<text class="viewtx" x="490" y="444" text-anchor="middle">ภาพ 3 มิติ ${DASH} ไม่ตามมาตราส่วน</text>`;
    scale = 'ไม่ตามมาตราส่วน';
    mode = 'ภาพ 3 มิติ';
  } else {
    const ortho = orthoView(spec, SHEET_BOX.single, code);
    g = ortho.svg;
    scale = ortho.scale;
    mode = 'ภาพฉาย 2 มิติ';
  }

  /* ---- ตารางรายละเอียดสินค้า ---- */
  const specs = specRows(spec, 'th');
  const rowH = Math.max(15, Math.min(19, 132 / Math.max(1, specs.length)));
  const fsz = rowH < 16 ? 11 : 12;
  let specSvg = `<text class="h3" x="34" y="499">รายละเอียดสินค้า</text>`;
  specs.forEach(([k, v], i) => {
    const y = 518 + i * rowH, val = esc(v), long = visLen(val) > 58;
    specSvg += `<text class="lbl" x="34" y="${y}" style="font-size:${fsz}px">${esc(k)}</text>`
      + `<text class="val" x="215" y="${y}" style="font-size:${fsz}px" ${long ? 'textLength="400" lengthAdjust="spacingAndGlyphs"' : ''}>${val}</text>`;
  });

  /* ---- หัวกระดาษ (title block) ---- */
  const rows: [string, string][] = [
    ['เลขที่แบบ', field(meta.drawNo)],
    ['ลูกค้า', field(meta.customer)],
    ['รหัสสินค้า', esc(code)],
    ['จำนวน', meta.qty != null && meta.qty > 0 ? `${meta.qty} ตัว` : DASH],
    ['มาตราส่วน', scale],
    ['รูปแบบภาพ', mode],
    ['หน่วย', 'มิลลิเมตร (mm.)'],
    ['ผู้เขียนแบบ', field(meta.drawer)],
    ['วันที่', field(meta.date)],
  ];
  const tbRowH = 17.5, tb = { x: 640, y: 490, w: 306 };
  const title = titleOf(spec);
  let tbSvg = `<rect class="tb" x="${tb.x}" y="${tb.y}" width="${tb.w}" height="${24 + rows.length * tbRowH}"/><rect class="tbhead" x="${tb.x}" y="${tb.y}" width="${tb.w}" height="24"/>
    <text class="tbtitle" x="${tb.x + 10}" y="${tb.y + 17}" ${visLen(title) > 30 ? 'style="font-size:10.5px"' : ''}>${title}</text>`;
  rows.forEach(([k, v], i) => {
    const y = tb.y + 24 + i * tbRowH, len = visLen(v);
    tbSvg += `<line class="tbline" x1="${tb.x}" y1="${y}" x2="${tb.x + tb.w}" y2="${y}"/><line class="tbline" x1="${tb.x + 96}" y1="${y}" x2="${tb.x + 96}" y2="${y + tbRowH}"/>
      <text class="lbl" x="${tb.x + 9}" y="${y + tbRowH - 5}">${k}</text>
      <text class="val" x="${tb.x + 101}" y="${y + tbRowH - 5}" ${len > 34 ? 'style="font-size:10px" textLength="198" lengthAdjust="spacingAndGlyphs"' : len > 24 ? 'style="font-size:11px"' : ''}>${v}</text>`;
  });

  const codeTxt = esc(code), codeLong = visLen(codeTxt) > 58;
  return withDiameterSign(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${H}" font-family="${SHEET_FONT}" role="img" aria-label="แบบ A4 ${codeTxt}">${SHEET_DEFS}
  <rect width="${SW}" height="${H}" fill="#FFFFFF"/><rect class="frame" x="14" y="14" width="${SW - 28}" height="${H - 28}"/>
  <line class="tbline" x1="14" y1="476" x2="${SW - 14}" y2="476"/>
  <image href="${logo}" x="34" y="22" width="48" height="48" preserveAspectRatio="xMidYMid meet"/>
  ${g}
  <text x="490" y="464" text-anchor="middle" font-size="18" font-weight="700" fill="#12212B" ${codeLong ? 'textLength="820" lengthAdjust="spacingAndGlyphs"' : ''}>รหัสสินค้า ${codeTxt}</text>
  ${specSvg}
  <text class="disc" x="34" y="668">แบบอ้างอิงตามแคตตาล็อก ${DASH} ชิ้นส่วนประกอบบางชิ้นเป็นรูปทรงอ้างอิง <tspan font-weight="700" fill="#12212B">ไม่ใช่แบบผลิต</tspan></text>
  ${tbSvg}
</svg>`);
}

/**
 * ∅ (U+2205) → Ø (U+00D8) ทั้งแผ่น — ฟอนต์ที่ฝังในไฟล์ (IBM Plex Sans Thai ชุด latin) และฟอนต์ในกล่อง prod ไม่มี ∅
 * (วัด 2026-10-06 · ขึ้นเป็นกล่องสี่เหลี่ยม · แผน §5.4 ข้อ 5) · Ø เป็นสัญลักษณ์เส้นผ่านศูนย์กลางที่แบบงานช่างใช้แทนกันทั่วไป
 * · ทำที่นี่ที่เดียว ⇒ SVG/PDF/PNG เหมือนกัน · ตัววาด 2 มิติที่พอร์ตมายังพิมพ์ ∅ ตามต้นฉบับ (ด่าน port เทียบทั้งสตริง)
 */
const withDiameterSign = (svg: string) => svg.replace(/&#8709;|\u2205/g, '&#216;');
