// ─────────────────────────────────────────────────────────────────────────────
//  ชิ้นพื้นฐานของภาพ 2 มิติ (เส้นบอกขนาด · เส้นศูนย์กลาง · ป้าย) — พอร์ตจาก Appsale `engine/draw.js` ที่ `4dd2475` ทีละบรรทัด
//
//  ⚠️ ห้ามมีความรู้เรื่องรุ่นสินค้าในไฟล์นี้ · ทุกฟังก์ชันคืนสตริง SVG · ใช้ numeric entity เท่านั้น (`&#8709;` ไม่ใช่ `&oslash;`)
//  ⚠️ ห้ามจัดนิพจน์ใหม่ — ด่าน `diag:drawing-port` ส่วน จ เทียบ SVG ทั้งสตริงกับต้นฉบับ (ตัวเลขทศนิยมพิมพ์ตรงตัว)
// ─────────────────────────────────────────────────────────────────────────────

/** กระดาษแบบ ใช้ viewBox เดียวกันทุกรุ่น */
export const SW = 980, SH = 640;
export const D2R = Math.PI / 180;

export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '?';
  return (Math.round(n*100)/100).toString();
}
export function scaleLabel(s: number): string { return s >= 1 ? `${Math.round(s*10)/10} : 1` : `1 : ${Math.round(1/s)}`; }

export function ext(x1: number, y1: number, x2: number, y2: number): string { return `<line class="ext" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }

export function dimH(x1: number, x2: number, y: number, label: string, flip?: boolean): string {
  const mid = (x1+x2)/2;
  return `<line class="dim" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" marker-start="url(#ar)" marker-end="url(#ar)"/>
  <text class="dimtx" x="${mid}" y="${flip ? y+14 : y-6}" text-anchor="middle">${label}</text>`;
}
export function dimV(y1: number, y2: number, x: number, label: string, left?: boolean): string {
  const mid = (y1+y2)/2;
  return `<line class="dim" x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" marker-start="url(#ar)" marker-end="url(#ar)"/>
  <text class="dimtx" x="${left ? x-7 : x+7}" y="${mid+4}" text-anchor="${left ? 'end' : 'start'}">${label}</text>`;
}
/** เส้นบอกขนาดพร้อมเส้นต่อขอบ (extension line) — ใช้บ่อยสุด */
export function dimHFull(x1: number, x2: number, y: number, fromY: number, label: string, flip?: boolean): string {
  return ext(x1, fromY, x1, y + (flip?6:-6)) + ext(x2, fromY, x2, y + (flip?6:-6)) + dimH(x1, x2, y, label, flip);
}
export function dimVFull(y1: number, y2: number, x: number, fromX: number, label: string, left?: boolean): string {
  return ext(fromX, y1, x + (left?-6:6), y1) + ext(fromX, y2, x + (left?-6:6), y2) + dimV(y1, y2, x, label, left);
}
export function leader(x: number, y: number, tx: number, ty: number, label: string, anchor?: 'start' | 'end'): string {
  return `<line class="lead" x1="${x}" y1="${y}" x2="${tx}" y2="${ty}"/>
  <text class="dimtx" x="${tx + (anchor==='end' ? -3 : 3)}" y="${ty-3}" text-anchor="${anchor||'start'}">${label}</text>`;
}
export function centerH(x1: number, x2: number, y: number): string { return `<line class="center" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>`; }
export function centerV(y1: number, y2: number, x: number): string { return `<line class="center" x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/>`; }
export function viewLabel(x: number, y: number, text: string): string { return `<text class="viewtx" x="${x}" y="${y}" text-anchor="middle">${text}</text>`; }
export function zoneLabel(x: number, y: number, text: string): string { return `<text class="zonetx" x="${x}" y="${y}" text-anchor="middle">${text}</text>`; }
