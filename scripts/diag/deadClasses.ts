/**
 * ด่าน "คลาสที่เขียนไว้ มี CSS ออกมาจริงไหม" — ช่องโหว่ที่ด่านชุดเดิมมองไม่เห็นทั้งหมด
 *
 * Tailwind v4 **ทิ้งคลาสที่ไม่รู้จักเงียบ ๆ** ไม่เตือน ไม่ล้ม ⇒ `npx tsc --noEmit` ผ่าน ·
 * `eslint` ผ่าน · `npm run build` ผ่าน แต่บนจอเป็นกล่องใส ไม่มีอะไรฟ้องจนกว่าจะมีคนเปิดดู
 * และจานสีของแอปนี้ **ทับจานของ Tailwind** (`@theme` ใน `frontend/src/index.css`) ⇒ เฉดที่ไม่ได้
 * ประกาศไว้จะเงียบเหมือนกันหมด ไม่ว่าจะเป็นเฉดมาตรฐานของ Tailwind หรือเฉดที่คิดขึ้นเอง
 *
 * เกิดจริงสองรอบ:
 *   2026-09-18  `bg-surface` 7 จุดในโมดูลคิดราคา (@theme มีแต่ `--color-card`) ⇒ ช่องกรอกใส
 *               ⇒ รายการที่กางออกของ `<select>` กลายเป็นพื้นขาวบนจอมืด
 *   2026-09-21  เฉด 55 · 105 · 150 · 450 ใน Promotions/StockRules — และสามในหกจุดนั้น
 *               **ไม่ได้แค่หาย แต่กลับด้าน**: `border` เปล่า ๆ ให้แค่ความหนา สีตกเป็น
 *               `currentColor` ส่วน `text-*` ที่หายตกไปรับสีจาก `body` = หมึกสว่างที่สุด
 *               ⇒ เส้นคั่น/คำบอกใบ้ที่ตั้งใจให้จางที่สุด กลายเป็นสว่างที่สุด
 *
 *   npm --prefix frontend run build     # ต้อง build ก่อน — ด่านนี้อ่าน CSS ที่ออกมา
 *   npm run diag:dead-classes
 *
 * ── สิ่งที่ด่านนี้ **ไม่** ตอบ (อ่านก่อนเชื่อคำว่า "ผ่าน") ────────────────────────────
 * มันไม่ได้ถามว่า "คลาสนี้ถูกต้องไหม" แต่ถามว่า **"บิลด์ล่าสุดออก CSS ให้คลาสนี้ไหม"**
 * สองอย่างนี้ตรงกันก็ต่อเมื่อบิลด์เป็นของปัจจุบัน — เฉดที่ประกาศไว้ใน `@theme` จริงแต่ยัง
 * ไม่มีใครในแอปใช้ Tailwind ก็ไม่ออก CSS ให้ (พิสูจน์ 2026-09-21: `bg-emerald-200` และ
 * `border-emerald-950` ทั้งคู่มีใน `@theme` แต่ถูกรายงานว่าตาย) ⇒ **ด่านจึงหยุดตัวเองเมื่อ
 * ซอร์สใหม่กว่าบิลด์** แล้วบอกให้ไป build ก่อน ไม่ตัดสินคนเขียน ถ้าเอาข้อนี้ออกเมื่อไหร่
 * ด่านจะเริ่มด่าโค้ดที่ถูก แล้วคนจะเลิกเชื่อด่านทั้งชุด ไม่ใช่แค่ตัวนี้
 *
 * ครอบคลุม (วัด 2026-09-21): `className=` 3,338 จุดใน `.tsx` — จับได้ 3,228 (96.7%)
 * ที่เหลือคือ `className={ตัวแปร}` ซึ่งด่านนี้ตามไปอ่านค่าคงที่ให้แล้ว (ดู `classLikeLiterals`)
 * · **ไม่ตรวจ** โทเคนที่อยู่ในนิพจน์ JS (1,446) และ arbitrary value เช่น `bg-[var(--brand)]`
 * (394) — ตัวหลังถูกต้องแล้วที่ไม่ตรวจ Tailwind ส่งผ่านตรง ๆ ไม่ต้องมีเฉด
 * ⇒ **"ผ่าน" แปลว่า "ไม่เจอในสิ่งที่ตรวจ" ไม่ใช่ "สะอาดแน่นอน"**
 *
 * ดูเฉพาะตระกูล "สี" (bg/text/border/ring/…) เพราะเป็นกลุ่มที่พลาดแล้วเห็นผลบนจอ และเป็น
 * กลุ่มเดียวที่กรองแล้วเสียงรบกวนเป็นศูนย์ — ตระกูลอื่น (`group` · `animate-*`) มีทั้งที่
 * Tailwind ไม่ออก CSS ให้โดยชอบ และที่นิยามเองใน `index.css` (รันแบบไม่กรอง = false positive ~40)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const SRC = process.argv[2] ?? 'frontend/src';
const HTML = process.argv[3] ?? 'public/admin.html';

/** ตระกูลที่ตรวจ — พลาดแล้วเห็นเป็นกล่องใส/สีกลับด้านบนจอ */
const COLOUR_FAMILY = /^(bg|text|border|ring|placeholder|divide|fill|stroke)-[a-z]/;
/** อักขระที่เป็นไปได้ในชื่อคลาส Tailwind (ตัวพิมพ์เล็กล้วน) — ใช้คัดว่าสตริงนั้นเป็น "ลิสต์คลาส" ไหม */
const CLASS_TOKEN = /^[a-z0-9:[\]/.@_-]+$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...walk(join(dir, e.name)));
    else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) out.push(join(dir, e.name));
  }
  return out;
}

/**
 * `className={fld}` โดยที่ `const fld = 'w-full … bg-card …'` อยู่คนละบรรทัด — เป็นรูปแบบที่
 * บั๊ก `bg-surface` ของ 2026-09-18 ซ่อนอยู่พอดี ⇒ เก็บสตริงที่ "หน้าตาเป็นลิสต์คลาส" ทุกตัว
 * เกณฑ์: ≥3 โทเคน และ **ทุกโทเคน** อยู่ในชุดอักขระของ Tailwind ⇒ ประโยคไทย/อังกฤษตกหมด
 */
function classLikeLiterals(text: string): string[] {
  const out: string[] = [];
  // ⚠️ ต้องแยกเป็นคนละ pass ต่อชนิดของเครื่องหมายคำพูด **ห้ามรวมเป็น alternation เดียว** —
  //    template literal คร่อมหลายบรรทัดได้ พอมันชนะ match ไปก่อน `matchAll` จะเดินต่อ
  //    หลังจุดจบของมัน แล้วสตริงเดี่ยวที่อยู่ข้างในช่วงนั้นหายไปทั้งหมด
  //    (เจอจริงตอนเขียนด่านนี้ 2026-09-21: `const fld = '…bg-surface…'` ใน SubCodeModal.tsx
  //     ถูกกลืน ⇒ ด่านรายงาน "ผ่าน" ทั้งที่จงใจใส่คลาสตายเข้าไปเอง)
  for (const re of [/'([^'\n]{12,})'/g, /"([^"\n]{12,})"/g, /`([^`]{12,})`/g]) {
    for (const m of text.matchAll(re)) {
      const parts = m[1].split(/\s+/).filter(Boolean);
      if (parts.length < 3) continue;
      if (!parts.every((p) => CLASS_TOKEN.test(p))) continue;
      out.push(m[1]);
    }
  }
  return out;
}

function classLists(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  out.push(...classLikeLiterals(text));
  return out;
}

/** หนีอักขระพิเศษของ CSS selector แบบเดียวกับที่ Tailwind ทำตอนเขียนไฟล์ */
function selectorOf(cls: string): RegExp {
  const esc = cls.replace(/[.:/[\]%#()!,+*>~&=]/g, (ch) => '\\\\?' + ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\.${esc}[\\s,:{>~+.]`);
}

function main(): void {
  console.log(`\n${BOLD}ด่านคลาสที่ไม่มี CSS ออกมา${RESET}\n`);

  // ── 1. หาไฟล์ CSS จาก admin.html ไม่ใช่เดาจากโฟลเดอร์ ────────────────────────────
  // `readdir(...).find(css)` หยิบไฟล์แรกที่เจอ ซึ่งอาจเป็นบิลด์เก่าที่ค้างอยู่ (เกิดจริง
  // 2026-09-21 ตอน `git checkout <คอมมิตเก่า> -- public/` แล้วมีสอง .css พร้อมกัน)
  let href: string | undefined;
  try {
    href = readFileSync(HTML, 'utf8').match(/href="\/?(assets\/[^"]+\.css)"/)?.[1];
  } catch {
    console.log(`  ${RED}✗${RESET} เปิด ${HTML} ไม่ได้ — สั่ง ${BOLD}npm --prefix frontend run build${RESET} ก่อน\n`);
    process.exitCode = 1;
    return;
  }
  if (!href) {
    console.log(`  ${RED}✗${RESET} ${HTML} ไม่ได้อ้างไฟล์ .css เลย — build พังหรือเปล่า\n`);
    process.exitCode = 1;
    return;
  }
  const cssPath = join('public', href);
  let cssStat;
  try {
    cssStat = statSync(cssPath);
  } catch {
    console.log(`  ${RED}✗${RESET} ${HTML} อ้าง ${cssPath} แต่ไม่มีไฟล์นั้น — build ใหม่ก่อน\n`);
    process.exitCode = 1;
    return;
  }
  const css = readFileSync(cssPath, 'utf8');

  const files = walk(SRC);

  // ── 2. ซอร์สใหม่กว่าบิลด์ = ตอบไม่ได้ ⇒ บอกวิธีแล้วหยุด ไม่ตัดสิน ──────────────────
  const newer = files
    .map((f) => ({ f, m: statSync(f).mtimeMs }))
    .filter((x) => x.m > cssStat.mtimeMs)
    .sort((a, b) => b.m - a.m);
  if (newer.length) {
    console.log(`  ${YELLOW}—${RESET} ซอร์ส ${newer.length} ไฟล์ใหม่กว่า ${cssPath}`);
    console.log(`    ${DIM}${newer.slice(0, 3).map((x) => x.f).join(' · ')}${newer.length > 3 ? ' …' : ''}${RESET}`);
    console.log(`\n${BOLD}สรุป:${RESET} ${YELLOW}ตอบไม่ได้${RESET} — CSS ที่จะเทียบเป็นของเก่า`);
    console.log(`  สั่ง ${BOLD}npm --prefix frontend run build${RESET} แล้วรันใหม่`);
    console.log(`  ${DIM}(ถ้าตัดสินไปเลยจะกลายเป็นด่านที่ด่าคลาสที่ถูกต้อง เพราะ Tailwind ออก CSS`);
    console.log(`   ให้เฉพาะคลาสที่มีคนใช้ตอน build — ดูหัวไฟล์)${RESET}\n`);
    process.exitCode = 1;
    return;
  }

  // ── 3. เทียบทีละคลาส ────────────────────────────────────────────────────────────
  const seen = new Set<string>();
  const dead: { cls: string; file: string }[] = [];
  let checked = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const list of classLists(text)) {
      for (const raw of list.split(/\s+/)) {
        const cls = raw.replace(/^\$\{.*$/, '').replace(/['"`]/g, '').trim();
        if (!cls) continue;
        if (/[${}()?:]/.test(cls)) continue; // ท่อนที่เป็นนิพจน์ JS ไม่ใช่ชื่อคลาส
        if (!COLOUR_FAMILY.test(cls)) continue;
        const key = `${cls}␟${file}`;
        if (seen.has(key)) continue;
        seen.add(key);
        checked++;
        if (!selectorOf(cls).test(css)) dead.push({ cls, file });
      }
    }
  }

  console.log(`  ${DIM}ซอร์ส ${files.length} ไฟล์ · เทียบกับ ${cssPath} · ตรวจ ${checked} คลาส${RESET}\n`);
  for (const d of dead) console.log(`  ${RED}✗${RESET} ${d.cls}  ${DIM}${d.file}${RESET}`);
  if (!dead.length) console.log(`  ${GREEN}✓${RESET} ทุกคลาสตระกูลสีมี CSS ออกมาจริง`);

  console.log(`\n${BOLD}สรุป:${RESET} ${dead.length ? `${RED}ล้ม ${dead.length} จุด${RESET}` : `${GREEN}ผ่าน${RESET}`}`);
  if (dead.length) {
    console.log(`  ${DIM}เฉดที่ใช้ได้มีเฉพาะที่ประกาศใน @theme ของ frontend/src/index.css`);
    console.log(`   ตัวเลขระหว่างขั้น (55 · 105 · 150 · 450) ไม่มีอยู่จริงสักเฉด${RESET}`);
  }
  console.log('');
  process.exitCode = dead.length ? 1 : 0;
}

main();
