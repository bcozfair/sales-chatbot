/* ─────────────────────────────────────────────────────────────────────────────
   เปิดหน้า "สมุดราคา" จริงแล้วกดปุ่มนำเข้า/ส่งออกจริง

   เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md

   ทำไมต้องมีด่านนี้ ทั้งที่ `build` ผ่านแล้ว: ปุ่มที่อ้างฟังก์ชันที่ไม่เคยถูกเขียน และบรรทัด
   import ที่หาย **build ผ่านทั้งคู่** (AGENTS.md A9) ⇒ "เสร็จ" แปลว่าเปิดดูที่ความกว้างจริง

   ครอบทั้งวง: ปุ่มบนหัวเรื่อง → ดาวน์โหลดแม่แบบ → อัปไฟล์เดิมกลับ (ต้องไม่มีอะไรเปลี่ยน)
   → อัปไฟล์ที่แก้แล้ว → ติ๊กรุ่น → บันทึก → การ์ดอัปเดต → ย้อนเล่ม
   ทำซ้ำที่ 1280px และ 390px (390px ต้องเป็น **การ์ด** ไม่ใช่ตารางที่ย่อลง — docs/design.md)

   ⚠️ **ปุ่มบนจอเขียนสมุดราคาในฐานที่เซิร์ฟเวอร์ต่ออยู่** (ตั้งแต่ 2026-09-23 สมุดราคาอยู่ในฐาน ไม่ใช่
      `pricebook/book.json` ของ cwd) ⇒ ด่านกันเครื่องแบบเดิม "เซิร์ฟเวอร์ต้องอยู่ใต้ .claude/worktrees/"
      **กันไม่ได้แล้ว** เพราะเซิร์ฟเวอร์ใน worktree บน PMSV ต่อฐานจริง · ด่านนี้จึงปฏิเสธเอง เว้นแต่ครบสามข้อ
      (ท่าเดียวกับ scripts/dev/seedPhaseH.ts): PG_HOST เป็น localhost · NODE_ENV ≠ production ·
      ตั้ง PB_UI_WRITE_OK=1 เอง — ในกล่อง prod PG_HOST=db และ NODE_ENV=production จึงโดนกันสองชั้น
      **รันบนเครื่อง dev เท่านั้น** · เซิร์ฟเวอร์กับด่านต้องอ่าน .env ชุดเดียวกัน (ด่านอ่านผลสุดท้ายจากฐานเอง)
      สคริปต์ `mockup/_pl-*.mjs` ก็เขียนฐานผ่าน API แบบเดียวกัน

   ต้องมี API รันอยู่ที่พอร์ตที่ส่งมาทาง PB_PORT (ค่าเริ่มต้น 3098)
     PORT=3098 npm run dev      (ในทรีของงานนี้)
     PB_UI_WRITE_OK=1 npm run diag:pb-ui

   ⚠️ `/admin` ตอบ 404 เมื่อรันจาก worktree (res.sendFile ปฏิเสธ path ที่มีเซกเมนต์ขึ้นต้น
      ด้วยจุด) ⇒ เข้าทาง `/admin.html` ตรง ๆ ซึ่ง static middleware เสิร์ฟให้เหมือนกันทุกไบต์
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer from 'puppeteer';
import jwt from 'jsonwebtoken';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { readUploaded } from '../../services/pricingLab/bookFile.js';
import { readBookState } from '../../services/pricingLab/bookStore.js';
import { writeXlsx } from '../pricebook/xlsxlite.js';
import { bookToSheets } from '../pricebook/sheet.js';

// ── ด่านกันเครื่อง: ปุ่มบนจอเขียนสมุดราคาในฐานจริงของเซิร์ฟเวอร์ ────────────
{
  const host = String(process.env.PG_HOST || '').trim().toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!local || process.env.NODE_ENV === 'production' || process.env.PB_UI_WRITE_OK !== '1') {
    console.error('ไม่รัน — ด่านนี้กดบันทึก/ย้อนสมุดราคาจริงในฐานที่เซิร์ฟเวอร์ต่ออยู่');
    console.error(`   ต้องครบสามข้อ: PG_HOST เป็น localhost · NODE_ENV ≠ production · PB_UI_WRITE_OK=1`);
    console.error(`   ตอนนี้ PG_HOST="${process.env.PG_HOST ?? ''}" NODE_ENV="${process.env.NODE_ENV ?? ''}" PB_UI_WRITE_OK="${process.env.PB_UI_WRITE_OK ?? ''}"`);
    process.exit(1);
  }
}

const PORT = process.env.PB_PORT || '3098';
const BASE = `http://localhost:${PORT}`;
const SHOTS = fileURLToPath(new URL('../../mockup/shots/', import.meta.url));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SHOTS, { recursive: true });

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

// ── เซิร์ฟเวอร์ที่ยิงต้องไม่ใช่ทรีหลัก ───────────────────────────────────────

// `/admin.html` เป็นตัวที่ยืนยันทั้ง "เซิร์ฟเวอร์ขึ้น" และ "build ของหน้าแอดมินมีอยู่จริง"
const health = await fetch(`${BASE}/admin.html`).catch(() => null);
if (!health?.ok) {
  console.error(`ไม่มีเซิร์ฟเวอร์ที่ ${BASE} — เปิดด้วย  PORT=${PORT} npm run dev  ในทรีของงานนี้ก่อน`);
  process.exit(1);
}

const { rows: admins } = await pool.query(
  `SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`,
);
if (admins.length === 0) throw new Error('ไม่มีบัญชี admin บนฐานนี้');
const admin = admins[0];
const token = jwt.sign(
  { id: admin.id, username: admin.username, name: admin.name, role: admin.role },
  getJwtSecret(),
  { expiresIn: '1h' },
);
console.log(`ใช้บัญชี ${admin.username} · เซิร์ฟเวอร์ ${BASE}\n`);

// ── เตรียมไฟล์สองใบไว้อัป: "เหมือนเดิม" กับ "แก้ราคาแล้ว" ────────────────────

const auth = { Authorization: `Bearer ${token}` };
const tRes = await fetch(`${BASE}/api/admin/pricebook/template`, { headers: auth });
ok('ดาวน์โหลดแม่แบบผ่าน API ได้', tRes.ok, `${tRes.status}`);
ok('ไฟล์ที่ได้เป็น .xlsx',
  (tRes.headers.get('Content-Type') ?? '').includes('spreadsheetml'),
  tRes.headers.get('Content-Type') ?? '(ไม่มี)');
ok('ชื่อไฟล์ภาษาไทยเดินทางมาถึง (RFC 5987)',
  (tRes.headers.get('Content-Disposition') ?? '').includes("filename*=UTF-8''"));

const templateBytes = Buffer.from(await tRes.arrayBuffer());
ok('แม่แบบมีเนื้อจริง', templateBytes.length > 10_000, `${(templateBytes.length / 1024).toFixed(0)} KB`);

const tmp = join(tmpdir(), `pb-ui-${Date.now()}`);
mkdirSync(tmp, { recursive: true });
const sameFile = join(tmp, 'แม่แบบราคา-เหมือนเดิม.xlsx');
const editedFile = join(tmp, 'แม่แบบราคา-แก้แล้ว.xlsx');
writeFileSync(sameFile, templateBytes);

/** แก้ราคาหนึ่งช่องของรุ่นแรกที่เป็นตาราง แล้วเขียนเป็นไฟล์ใหม่ — เหมือนที่แอดมินแก้ใน Excel */
const { book: parsed } = await readUploaded(templateBytes);
if (!parsed) throw new Error('อ่านแม่แบบที่เพิ่งดาวน์โหลดกลับไม่ได้');
const target = Object.values(parsed.models).find((m) => m.base.kind === 'matrix');
if (!target) throw new Error('ไม่มีรุ่นที่ฐานเป็นตารางให้ทดสอบ');
const cells = (target.base as { cells: Record<string, number> }).cells;
const cellKey = Object.keys(cells)[0]!;
const before = cells[cellKey]!;
cells[cellKey] = before + 100;
writeFileSync(editedFile, Buffer.from(writeXlsx(bookToSheets(parsed, { exportedAt: '2026-09-22' }))));
console.log(`  · ไฟล์ทดสอบ: ${target.code} "${cellKey}" ${before} → ${before + 100}\n`);

// ── เปิดหน้าจริง ─────────────────────────────────────────────────────────────

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e: unknown) => { errors.push(e instanceof Error ? e.message : String(e)); });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const overflow = () => page.evaluate(() => Math.max(
  document.documentElement.scrollWidth - document.documentElement.clientWidth,
  document.body.scrollWidth - document.body.clientWidth,
));

/** ปุ่มที่มีข้อความนี้ — หน้านี้ไม่มี test-id และการเติมเข้าไปคือการแก้จอเพื่อด่าน */
const clickText = async (text: string): Promise<boolean> => {
  const hit = await page.evaluateHandle(
    (t: string) => [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes(t)) ?? null,
    text,
  );
  const el = hit.asElement() as import('puppeteer').ElementHandle<HTMLButtonElement> | null;
  if (!el) return false;
  await el.click();
  await wait(350);
  return true;
};

const textOf = (sel: string) => page.evaluate((s: string) => {
  const el = document.querySelector(s);
  return el ? (el.textContent ?? '') : '';
}, sel);

async function openPage(width: number): Promise<void> {
  await page.setViewport({ width, height: 900 });
  // ยัด session ให้เหมือนเพิ่งล็อกอิน — `AuthContext` อ่านสองคีย์นี้ตอนบูต (sessionStorage ไม่ใช่ local)
  await page.evaluateOnNewDocument((t: string, u: string) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', u);
  }, token, JSON.stringify({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }));
  await page.goto(`${BASE}/admin.html#pricebook`, { waitUntil: 'networkidle0' });
  await wait(900);
}

for (const width of [1280, 390]) {
  console.log(`\n── ${width}px ──────────────────────────────────────────────`);
  await openPage(width);

  const body = await page.evaluate(() => document.body.innerText);
  ok(`${width}px — เข้าหน้าสมุดราคาได้`, body.includes('สมุดราคาที่ระบบใช้อยู่'), body.slice(0, 60).replace(/\n/g, ' '));
  ok(`${width}px — การ์ด "สมุดราคาที่ระบบใช้อยู่" ขึ้น`, body.includes('สมุดราคาที่ระบบใช้อยู่'));
  ok(`${width}px — มีปุ่มดาวน์โหลดแม่แบบ`, body.includes('แม่แบบ'));
  ok(`${width}px — มีปุ่มอัปโหลดราคาใหม่`, body.includes('อัปโหลด'));
  ok(`${width}px — หน้าไม่เลื่อนแนวนอน`, (await overflow()) <= 0, `เกิน ${await overflow()}px`);

  // ปุ่มสองปุ่มบนแถบบนต้องไม่เบียดชื่อหน้าจนอ่านไม่ออก — แถบบนเป็นที่ร่วมกับชื่อหน้า
  const titleFits = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((x) => (x.textContent ?? '').includes('คิดราคา'));
    return h ? h.scrollWidth <= h.clientWidth + 1 : false;
  });
  ok(`${width}px — ชื่อหน้าไม่ถูกปุ่มเบียดจนขาด`, titleFits);
  await page.screenshot({ path: `${SHOTS}/pb-real-page-${width}.png`, fullPage: true });

  // ── กดอัปโหลด → ขั้นที่ 1 ────────────────────────────────────────────────
  ok(`${width}px — กดปุ่มอัปโหลดแล้วกล่องเปิด`, await clickText('อัปโหลดราคาใหม่'));
  const step1 = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '');
  ok(`${width}px — ขั้นแรกบอกว่ายังไม่บันทึกอะไร`, step1.includes('ยังไม่มีอะไรถูกบันทึกในขั้นนี้'));
  ok(`${width}px — ขั้นแรกยังกดบันทึกไม่ได้`, !step1.includes('บันทึก ') || step1.includes('ถัดไป'));

  // ── อัปไฟล์เดิมกลับ = ต้องไม่มีอะไรเปลี่ยน ───────────────────────────────
  const input = await page.$('[role="dialog"] input[type="file"]');
  ok(`${width}px — มีช่องเลือกไฟล์`, input !== null);
  if (input) {
    await input.uploadFile(sameFile);
    await wait(2500);
    const review = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '');
    ok(`${width}px — อัปไฟล์เดิมกลับ แล้วเข้าหน้าตรวจ`, review.includes('ตรวจก่อนบันทึก'));
    ok(`${width}px — ไฟล์เดิม = ไม่มีช่องไหนเปลี่ยน`, review.includes('รุ่นที่ติ๊กไว้ไม่มีช่องไหนเปลี่ยน'));
    ok(`${width}px — เตือนว่ายังไม่บันทึกจนกว่าจะกด`, review.includes('ยังไม่บันทึกจนกว่าจะกดปุ่มขวา'));
    ok(`${width}px — คำเตือน "ไม่ติ๊ก = คงราคาเดิม" อยู่บนจอ`, review.includes('คงราคาเดิม'));
    ok(`${width}px — กล่องไม่ล้นแนวนอน`, (await overflow()) <= 0, `เกิน ${await overflow()}px`);

    const fit = await page.evaluate(() => {
      const box = document.querySelector('[role="dialog"]')!.getBoundingClientRect();
      const btns = [...document.querySelectorAll('[role="dialog"] button')];
      const save = btns.find((b) => (b.textContent ?? '').includes('บันทึก'));
      return {
        h: Math.round(box.height),
        over: Math.round(Math.max(0, box.bottom - window.innerHeight)),
        btnOver: save ? Math.round(Math.max(0, save.getBoundingClientRect().bottom - window.innerHeight)) : -1,
      };
    });
    ok(`${width}px — กล่องไม่ล้นความสูงจอ`, fit.over === 0, `สูง ${fit.h}px เกิน ${fit.over}px`);
    ok(`${width}px — ปุ่มบันทึกอยู่ในจอ`, fit.btnOver === 0, `เกิน ${fit.btnOver}px`);
    await page.screenshot({ path: `${SHOTS}/pb-real-same-${width}.png` });
  }

  // ── อัปไฟล์ที่แก้แล้ว → ตารางส่วนต่าง ────────────────────────────────────
  await clickText('ยกเลิก');
  await clickText('อัปโหลดราคาใหม่');
  const input2 = await page.$('[role="dialog"] input[type="file"]');
  if (input2) {
    await input2.uploadFile(editedFile);
    await wait(2500);
    const review = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '');
    ok(`${width}px — เห็นราคาเดิมกับราคาใหม่`,
      review.includes(before.toLocaleString('th-TH')) && review.includes((before + 100).toLocaleString('th-TH')),
      `${before} → ${before + 100}`);
    ok(`${width}px — บอกส่วนต่างเป็น +100`, review.includes('+100'));

    // จอแคบต้องเป็นการ์ด จอกว้างเป็นตาราง — ห้ามเป็นตารางที่ย่อลง (docs/design.md ข้อ 3)
    const mode = await page.evaluate(() => {
      const t = document.querySelector('[role="dialog"] table');
      return t && getComputedStyle(t).display !== 'none' ? 'ตาราง' : 'การ์ด';
    });
    ok(`${width}px — ใช้แบบ ${width >= 640 ? 'ตาราง' : 'การ์ด'}`, mode === (width >= 640 ? 'ตาราง' : 'การ์ด'), mode);
    ok(`${width}px — กล่องส่วนต่างไม่ล้นแนวนอน`, (await overflow()) <= 0, `เกิน ${await overflow()}px`);
    await page.screenshot({ path: `${SHOTS}/pb-real-diff-${width}.png` });

    // ── ติ๊กรุ่นออก แล้วตัวเลขบนปุ่มต้องขยับ ───────────────────────────────
    const labelAll = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => (x.textContent ?? '').includes('รุ่นที่เลือก'));
      return b?.textContent ?? '';
    });
    ok(`${width}px — กดไม่เลือกเลยได้`, await clickText('ไม่เลือกเลย'));
    const labelNone = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => (x.textContent ?? '').includes('รุ่นที่เลือก'));
      return { text: b?.textContent ?? '', disabled: (b as HTMLButtonElement | undefined)?.disabled ?? false };
    });
    ok(`${width}px — ไม่เลือกรุ่นไหนเลย = กดบันทึกไม่ได้`, labelNone.disabled, labelNone.text);
    ok(`${width}px — ปุ่มบอกจำนวนรุ่นที่จะบันทึกจริง`, labelAll.includes('บันทึก') && labelAll !== labelNone.text,
      `${labelAll.trim()} → ${labelNone.text.trim()}`);
    await clickText('เลือกทั้งหมด');
  }

  // ปิดกล่องโดยไม่บันทึก — การกดยกเลิกต้องไม่ทำให้ราคาขยับ (ตรวจด้วย API ข้างล่าง)
  await clickText('ยกเลิก');
}

// ── ยกเลิกแล้วต้องไม่มีอะไรถูกบันทึก ─────────────────────────────────────────

const ov = async () => (await (await fetch(`${BASE}/api/admin/pricebook/overview`, { headers: auth })).json());
const beforeSave = await ov();
ok('กดยกเลิกแล้วสมุดราคาไม่ขยับ', beforeSave.shelf.edited === null || beforeSave.shelf.edited === undefined,
  JSON.stringify(beforeSave.shelf.edited));

// ── บันทึกจริงหนึ่งรอบ แล้วย้อนกลับ ──────────────────────────────────────────
//
// เขียนลงฐานของเครื่อง dev (ด่านกันเครื่องข้างบน) แล้วคืนค่าเดิมด้วยการกดย้อนบนจอจริง
// ซึ่งคือทางถอยเดียวกับที่แอดมินจะใช้ — การย้อนเป็นการบันทึกใหม่ ประวัติในฐานจึงเพิ่มขึ้นสองแถวต่อรอบ

console.log('\n── บันทึกจริงแล้วย้อนกลับ ───────────────────────────────');
await openPage(1280);
await clickText('อัปโหลดราคาใหม่');
const input3 = await page.$('[role="dialog"] input[type="file"]');
if (input3) {
  await input3.uploadFile(editedFile);
  await wait(2500);
  ok('กดบันทึกได้', await clickText('รุ่นที่เลือก'));
  await wait(1500);
  const done = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '');
  ok('ขึ้นจอ "บันทึกแล้ว"', done.includes('บันทึกสมุดราคาเล่มใหม่แล้ว'), done.slice(0, 70).replace(/\n/g, ' '));
  ok('บอกว่ารุ่นที่ไม่ได้เลือกยังใช้ราคาเดิม', done.includes('รุ่นที่ไม่ได้เลือกยังใช้ราคาเดิม'));
  await page.screenshot({ path: `${SHOTS}/pb-real-done-1280.png` });
  await clickText('เสร็จสิ้น');
  await wait(900);

  const afterSave = await ov();
  ok('การ์ดรู้ว่าใครแก้เมื่อไหร่', afterSave.shelf?.edited?.by === admin.username, JSON.stringify(afterSave.shelf?.edited));
  ok('มีเล่มเก่าให้ย้อนแล้ว', (afterSave.shelf?.backups?.length ?? 0) >= 1, `${afterSave.shelf?.backups?.length} เล่ม`);

  const card = await textOf('body');
  ok('การ์ดบนจอแสดงชื่อไฟล์ที่อัป', card.includes('แก้แล้ว.xlsx'), '');

  // ย้อนกลับ — window.confirm ต้องถูกตอบรับก่อน
  page.on('dialog', (d) => { void d.accept(); });
  ok('กดย้อนไปเล่มก่อนหน้าได้', await clickText('ย้อนไปเล่มก่อนหน้า'));
  await wait(1800);
  const afterBack = await ov();
  ok('ย้อนแล้วสมุดกลับเป็นเล่มก่อนหน้า',
    (afterBack.shelf?.edited ?? null) === null,
    JSON.stringify(afterBack.shelf?.edited ?? null));
  await page.screenshot({ path: `${SHOTS}/pb-real-rolledback-1280.png` });
}

// ── ราคาต้องกลับมาเท่าเดิมทุกบาท ────────────────────────────────────────────

const finalBook = (await readBookState())?.book;
if (!finalBook) throw new Error('อ่านสมุดราคาจากฐานไม่ได้หลังจบด่าน');
const finalCells = (finalBook.models[target.code]!.base as { cells: Record<string, number> }).cells;
ok('ราคาที่ด่านนี้แก้ไป ถูกย้อนกลับครบ', finalCells[cellKey] === before, `${finalCells[cellKey]} (ควรเป็น ${before})`);

ok('ไม่มี JS error บนหน้าจอ', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
await pool.end();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${fail ? `ล้ม ${fail} ข้อ` : 'ผ่านทั้งหมด'}  ·  ภาพอยู่ที่ mockup/shots/`);
process.exit(fail ? 1 : 0);
