// ─────────────────────────────────────────────────────────────────────────────
//  สัญลักษณ์ 2 มิติที่ใช้ร่วมกันหลายรุ่น — พอร์ตจาก Appsale `engine/symbols.js` ที่ `4dd2475` ทีละบรรทัด
//  ทุกฟังก์ชันวาดโดยอ้าง "จุดอ้างอิง + ขนาดเป็น px" (คำนวณมาตราส่วนมาแล้ว)
//
//  ยกมาเฉพาะที่ TS_-11 / BH-01 / BH-01C ใช้ — ที่เหลือ (เกลียว · หัวกะโหลก · หน้าแปลน · ท่อ U …) มากับรุ่นแรกที่ใช้
//  ⚠️ ห้ามจัดนิพจน์ใหม่ — ด่าน `diag:drawing-port` ส่วน จ เทียบ SVG ทั้งสตริงกับต้นฉบับ
// ─────────────────────────────────────────────────────────────────────────────

/** ขั้วไฟแบบกล่อง 3 มิติ ปักที่ผิวจุด (px,py) ยื่นออกตามทิศ (nx,ny) */
export function terminal3d(kind: string, px: number, py: number, nx: number, ny: number, s: number): string {
  const u = Math.max(13, Math.min(30, 24*Math.min(s, 1.5)));
  const deg = Math.atan2(ny, nx)*180/Math.PI;
  const w = u, h = u*0.72, d = u*0.26, x0 = 3;
  let b = `<g transform="translate(${px} ${py}) rotate(${deg})">`;
  b += `<line class="part" x1="0" y1="0" x2="${x0}" y2="0"/>`;
  b += `<rect class="part" x="${x0}" y="${-h/2}" width="${w}" height="${h}"/>`;
  b += `<path class="thin" d="M ${x0} ${-h/2} l ${d} ${-d*0.75} l ${w} 0 l ${-d} ${d*0.75}"/>`;
  b += `<path class="thin" d="M ${x0+w} ${-h/2} l ${d} ${-d*0.75} l 0 ${h} l ${-d} ${d*0.75}"/>`;
  const e = x0 + w;
  if (kind === 'wire') {
    b += `<path class="wire" d="M ${e} ${-h*0.18} c ${u*0.5} ${-u*0.12}, ${u*0.65} ${u*0.5}, ${u*1.2} ${u*0.26}"/>
          <path class="wire" d="M ${e} ${h*0.18} c ${u*0.5} ${u*0.12}, ${u*0.75} ${-u*0.32}, ${u*1.25} ${-u*0.02}"/>`;
  } else if (kind === 'bolt') {
    b += `<line class="part" x1="${e}" y1="${-h*0.24}" x2="${e+u*0.42}" y2="${-h*0.24}"/>
          <line class="part" x1="${e}" y1="${h*0.24}" x2="${e+u*0.42}" y2="${h*0.24}"/>
          <circle class="part" cx="${e+u*0.42}" cy="${-h*0.24}" r="${u*0.12}"/>
          <circle class="part" cx="${e+u*0.42}" cy="${h*0.24}" r="${u*0.12}"/>`;
  } else if (kind === 'plug') {
    b += `<rect class="part" x="${e}" y="${-h*0.32}" width="${u*0.5}" height="${h*0.64}"/>
          <line class="part" x1="${e+u*0.5}" y1="${-h*0.15}" x2="${e+u*0.8}" y2="${-h*0.15}"/>
          <line class="part" x1="${e+u*0.5}" y1="${h*0.15}" x2="${e+u*0.8}" y2="${h*0.15}"/>`;
  } else if (kind === 'ceramic') {
    b += `<line class="part" x1="${x0}" y1="${-h*0.17}" x2="${e}" y2="${-h*0.17}"/>
          <line class="part" x1="${x0}" y1="${h*0.17}" x2="${e}" y2="${h*0.17}"/>
          <line class="part" x1="${x0+w*0.5}" y1="${-h/2}" x2="${x0+w*0.5}" y2="${h/2}"/>`;
  }
  return b + '</g>';
}

/** แกน/ท่อ ภาพด้าน (ortho) — x = ขอบซ้าย, cy = แนวศูนย์กลาง, len/dia = px · capL/capR: 'round' | 'flat' */
export function rodSide(x: number, cy: number, len: number, dia: number, opt: { capL?: 'round' | 'flat'; capR?: 'round' | 'flat' } = {}): string {
  const r = dia/2, x2 = x + len;
  const capL = opt.capL || 'flat', capR = opt.capR || 'flat';
  let d = `M ${x} ${cy-r} L ${x2} ${cy-r}`;
  d += capR === 'round' ? ` A ${r} ${r} 0 0 1 ${x2} ${cy+r}` : ` L ${x2} ${cy+r}`;
  d += ` L ${x} ${cy+r}`;
  d += capL === 'round' ? ` A ${r} ${r} 0 0 1 ${x} ${cy-r}` : ` Z`;
  return `<path class="part" d="${d}"/>`;
}

/** สปริงกันสายหัก (spring) */
export function springSide(x: number, cy: number, len: number, h: number): string {
  const n = Math.max(6, Math.round(len/5)), r = h/2, step = len/n;
  let d = `M ${x} ${cy}`;
  for (let i = 0; i < n; i++) {
    d += ` l ${step*0.5} ${-r} l ${step*0.5} ${r}`;
  }
  return `<path class="wire" d="${d}"/>` +
    `<line class="thin" x1="${x}" y1="${cy-r}" x2="${x+len}" y2="${cy-r}"/>` +
    `<line class="thin" x1="${x}" y1="${cy+r}" x2="${x+len}" y2="${cy+r}"/>`;
}
/** สายถักสแตนเลส (braid) — ลายกากบาท */
export function braidSide(x: number, cy: number, len: number, h: number): string {
  const r = h/2, n = Math.max(4, Math.round(len/6));
  let g = `<rect class="part" x="${x}" y="${cy-r}" width="${len}" height="${h}"/>`;
  for (let i = 0; i < n; i++) {
    const x1 = x + len*i/n, x2 = x + len*(i+1)/n;
    g += `<line class="thin" x1="${x1}" y1="${cy-r}" x2="${x2}" y2="${cy+r}"/>`;
    g += `<line class="thin" x1="${x1}" y1="${cy+r}" x2="${x2}" y2="${cy-r}"/>`;
  }
  return g;
}
/** สายไฟออก n เส้น พร้อมหางปลาแฉก (มาตรฐาน 1.5) */
export function leadWires(x: number, cy: number, len: number, n = 2, labels: string[] = []): string {
  const gap = n > 2 ? 13 : 10, base = -(n-1)*gap/2;
  let g = '';
  for (let i = 0; i < n; i++) {
    const y0 = cy, y1 = cy + base + i*gap;
    g += `<path class="wire" d="M ${x} ${y0} C ${x+len*0.35} ${y0}, ${x+len*0.5} ${y1}, ${x+len} ${y1}"/>`;
    g += `<path class="part" d="M ${x+len} ${y1-3.2} l 7 0 l 3 3.2 l -3 3.2 l -7 0 Z"/>`;
    g += `<line class="thin" x1="${x+len+3}" y1="${y1-1.2}" x2="${x+len+7}" y2="${y1-1.2}"/>`;
    if (labels[i]) g += `<text class="dimtx" x="${x+len+13}" y="${y1+4}" text-anchor="start">${labels[i]}</text>`;
  }
  return g;
}
/** สายไฟหุ้มฉนวน (เส้นเดียวหนา) */
export function cableSide(x: number, cy: number, len: number, h: number): string {
  const r = h/2;
  return `<rect class="part" x="${x}" y="${cy-r}" width="${len}" height="${h}"/>` +
    `<line class="thin" x1="${x}" y1="${cy}" x2="${x+len}" y2="${cy}"/>`;
}
