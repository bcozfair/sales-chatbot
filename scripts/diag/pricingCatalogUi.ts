/* ─────────────────────────────────────────────────────────────────────────────
   เปิดหน้า "คำนวณราคา" จริงแล้วกรอกตามแคตตาล็อก BH และ TS (ช่องกรอก ↔ ช่องรหัส ตามกันจริงไหม)

   เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md · docs/pricing-code-bh.md

   ทำไมต้องมีด่านนี้ ทั้งที่ `diag:pricing-catalog` ผ่านแล้ว: ด่านนั้นพิสูจน์ตัวอ่าน/ตัวประกอบรหัสฝั่งเซิร์ฟเวอร์
   แต่ "แก้ช่องแล้วรหัสด้านบนเปลี่ยนตาม · คำตอบเก่ามาถึงทีหลังแล้วช่องเด้งกลับ · สลับรุ่นแล้วช่องเปลี่ยน"
   เป็นของฝั่งจอล้วน และ **build ผ่านทั้งที่ปุ่มไม่ทำงานได้** (AGENTS.md A9) ⇒ เปิดดูที่ความกว้างจริง 1280 / 390

   ตั้งแต่ 2026-10-07 (mockup `pricing-calc-redesign`): หน้าเปิดมาว่าง · ช่องรหัสค้นรหัสจริงจากฐาน · ช่อง "รุ่น" เป็นปุ่มเปิดรายการ
   (ไม่ใช่ `<select>`) · สลับไปรุ่นที่ขนาดยังไม่ครบ = ไม่คิดราคาจนกรอก ⇒ ข้อที่เกี่ยวข้องข้างล่างปรับตาม

   **อ่านอย่างเดียว** — หน้านี้ยิงแค่ `GET /overview` · `GET /examples` · `POST /quote` (ไม่มีทางเขียนสมุดราคา) จึงไม่ต้องมีด่านกันเครื่อง
   แบบ `diag:pb-ui` · ใช้บัญชี admin ตัวแรกในฐานออก token ชั่วคราว 1 ชั่วโมง

   ต้องมี API ของทรีนี้รันอยู่ที่ PB_PORT (ค่าเริ่มต้น 3099 · 3098 เป็นของโปรเซสอื่นบน PMSV) — **ห้ามใช้ 5180** (พรีวิวร่วมที่เจ้าของเปิด/ปิดเอง):
     PORT=3099 PREVIEW_MODE=1 npx tsx index.ts        (PREVIEW_MODE = ไม่เริ่มตัวตั้งเวลา sync)
     npm run diag:pricing-catalog-ui
   ⚠️ ผลขึ้นกับเล่มในฐาน: ก่อนรัน `importer.ts --catalog` รหัส BH-02 คิดพื้นที่ไม่ได้ (ด่านบอกไว้ในผล ไม่นับตก)
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer from 'puppeteer';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { readBookState } from '../../services/pricingLab/bookStore.js';
import { catalogRulesChanges, catalogRulesFromMaps } from '../pricebook/catalogRules.js';

const PORT = Number(process.env.PB_PORT ?? 3099);
const BASE = `http://localhost:${PORT}`;
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail?: string) => {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? GREEN + '✓' : RED + '✗'}${RESET}  ${label}${detail ? `${DIM}  —  ${detail}${RESET}` : ''}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (PORT === 5180) {
  console.error('ไม่รันกับ 5180 — พอร์ตนั้นเป็นพรีวิวร่วมที่เจ้าของเปิด/ปิดเอง');
  process.exit(1);
}
try {
  await fetch(`${BASE}/admin.html`);
} catch {
  console.error(`ไม่มีเซิร์ฟเวอร์ที่ ${BASE} — เปิดด้วย  PORT=${PORT} PREVIEW_MODE=1 npx tsx index.ts  ในทรีของงานนี้ก่อน`);
  process.exit(1);
}

const state = await readBookState();
const bookHasCatalog = !!state && catalogRulesChanges(state.book, catalogRulesFromMaps()).length === 0;
const { rows: admins } = await pool.query(`SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`);
await pool.end();
if (!admins.length) throw new Error('ไม่มีบัญชี admin บนฐานนี้');
const admin = admins[0];
const token = jwt.sign({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }, getJwtSecret(), { expiresIn: '1h' });
console.log(`ใช้บัญชี ${admin.username} · เซิร์ฟเวอร์ ${BASE} · เล่มในฐาน${bookHasCatalog ? 'มีกติกาแคตตาล็อกแล้ว' : 'ยังไม่ได้รัน importer --catalog'}\n`);

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e instanceof Error ? e.message : String(e)));

const codeValue = () => page.$eval('#pl-code', (el) => (el as HTMLInputElement).value);
const text = () => page.evaluate(() => document.body.innerText);
/** รอให้คำตอบของ /quote กลับมาและหน้าจอวาดเสร็จ */
async function settle(): Promise<void> {
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 8000 }).catch(() => {});
  await wait(150);
}
/** ล้างช่องแบบที่คนทำ (Ctrl+A แล้วลบ) — คลิกสามครั้งไม่เลือกทั้งช่องใน input ตัวเลข ของเก่าจะค้างต่อท้าย */
async function clear(sel: string): Promise<void> {
  await page.focus(sel);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
}
async function typeCode(code: string): Promise<void> {
  await clear('#pl-code');
  await page.type('#pl-code', code);
  await page.keyboard.press('Enter');
  await settle();
}
async function setNumber(label: string, value: string): Promise<void> {
  const sel = `input[aria-label="${label}"]`;
  await clear(sel);
  await page.type(sel, value, { delay: 30 });
  await settle();
}
/** ช่อง "รุ่น" เป็นปุ่มเปิดรายการ (2026-10-07) — ช่องอื่นยังเป็น `<select>` */
const FAMILY_LIST = '[role="listbox"][aria-label="รุ่นทั้งหมดในสมุดราคา"]';
async function choose(label: string, value: string): Promise<void> {
  if (label === 'รุ่น') {
    await page.click('button[aria-label="รุ่น"]');
    await page.waitForSelector(FAMILY_LIST);
    await page.click(`${FAMILY_LIST} [data-value="${value}"]`);
  } else {
    await page.select(`select[aria-label="${label}"]`, value);
  }
  await settle();
}
/** รายการในช่อง "รุ่น" — [กลุ่ม, ค่า][] ตามลำดับบนจอ (เปิดแล้วปิดคืน) */
async function familyRows(): Promise<{ group: string; value: string; text: string }[]> {
  await page.click('button[aria-label="รุ่น"]');
  await page.waitForSelector(FAMILY_LIST);
  const rows = await page.$eval(FAMILY_LIST, (box) => {
    const out: { group: string; value: string; text: string }[] = [];
    let group = '';
    for (const el of [...box.children]) {
      const v = el.getAttribute('data-value');
      if (v === null) { if (el.tagName === 'DIV' && !el.querySelector('span')) group = el.textContent ?? ''; continue; }
      out.push({ group, value: v, text: el.textContent ?? '' });
    }
    return out;
  });
  await page.keyboard.press('Escape');
  await wait(100);
  return rows;
}
const familyFace = () => page.$eval('button[aria-label="รุ่น"]', (el) => el.textContent ?? '');

for (const width of [1280, 390]) {
  console.log(`\n── ${width}px ──────────────────────────────────────────────`);
  await page.setViewport({ width, height: 900 });
  await page.evaluateOnNewDocument((t: string, u: string) => {
    // about:blank (ใช้บังคับโหลดหน้าใหม่ในรอบ 390) อ่าน storage ไม่ได้ — ข้ามเงียบ ๆ ไม่ให้นับเป็น error ของหน้า
    try {
      sessionStorage.setItem('admin_token', t);
      sessionStorage.setItem('admin_user', u);
      // รุ่นที่ใช้ล่าสุดจำในเบราว์เซอร์ — ล้างทุกรอบให้หน้าตอนเปิดเริ่มที่รุ่นแรกในสมุดเสมอ
      localStorage.removeItem('pricingLab.family');
    } catch { /* about:blank */ }
  }, token, JSON.stringify({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }));
  await page.goto('about:blank');
  await page.goto(`${BASE}/admin.html#pricing`, { waitUntil: 'networkidle0' });
  await wait(600);

  // ── หน้าตอนเปิด + ค้นรหัสจากฐาน (mockup `pricing-calc-redesign` · 2026-10-07) ─────────────────────
  let body = await text();
  ok('เปิดหน้ามาว่าง: ช่องรหัสว่าง · ราคา "—" · บอกว่าต้องกรอกอะไร · ไม่มีแถว "ตัวอย่างในชีต"',
    (await codeValue()) === '' && body.includes('—') && /กรอก[\s\S]{0,40}เพื่อดูราคา/.test(body) && !body.includes('ตัวอย่างในชีต'));
  ok('เปิดมาเห็นช่องของรุ่นเลย (ช่อง "รุ่น" + ช่องตัวเลขว่าง) และปุ่มเพิ่มสินค้าบอกเหตุผล',
    (await page.$('button[aria-label="รุ่น"]')) !== null && body.includes('ยังไม่มีราคา'));
  await page.click('#pl-code');
  await page.type('#pl-code', 'BH-01C-600x150-380', { delay: 15 });
  await settle();
  const sugg = await page.$$eval('[role="listbox"][aria-label="รหัสในฐาน"] [role="option"]', (els) => els.map((e) => e.textContent ?? ''));
  ok('พิมพ์ส่วนของรหัส → รายการรหัสในฐานพร้อมราคาในฐาน', sugg.some((t) => t.includes('BH-01C-600x150-380-4950W-PL-PL2') && t.includes('ราคาในฐาน')), `${sugg.length} แถว`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await settle();
  body = await text();
  ok('เลือกแถวด้วย ↓ + Enter → เติมรหัส คิดราคา 13,490 และเทียบราคาในฐาน (ตรงกัน)',
    (await codeValue()) === 'BH-01C-600x150-380-4950W-PL-PL2' && body.includes('13,490') && body.includes('ในฐาน') && body.includes('ตรงกัน'), await codeValue());
  await setNumber('ID', '610');
  body = await text();
  ok('แก้ ID → รหัสเปลี่ยน · บรรทัด "ดัดแปลงจาก" บอก ID 600 → 610',
    (await codeValue()) === 'BH-01C-610x150-380-4950W-PL-PL2' && /ดัดแปลงจาก[\s\S]{0,80}600 → 610/.test(body), await codeValue());
  await page.click('button[aria-label="ล้างรหัสและช่องทั้งหมด"]');
  await settle();
  ok('ปุ่ม ✕ → กลับเป็นหน้าว่าง (รหัสว่าง · ราคา "—" · ไม่มี "ดัดแปลงจาก")',
    (await codeValue()) === '' && (await text()).includes('ยังไม่มีราคา') && !(await text()).includes('ดัดแปลงจาก'));

  await typeCode('BH-01C-600x150-380-4950W-PL-PL2');
  body = await text();
  ok('พิมพ์รหัส BH → ขึ้นช่องตามแคตตาล็อก (ไม่ใช่การ์ด "ระบบอ่านรหัสนี้ว่าอะไร")',
    (await page.$('select[aria-label="การออกขั้วไฟ"]')) !== null && !body.includes('ระบบอ่านรหัสนี้ว่าอะไร'));
  ok('ช่องได้ค่าจากรหัส (การต่อ PL · ขั้วไฟ PL2)',
    (await page.$eval('select[aria-label="การต่อใช้งาน"]', (el) => (el as HTMLSelectElement).value)) === 'PL'
    && (await page.$eval('select[aria-label="การออกขั้วไฟ"]', (el) => (el as HTMLSelectElement).value)) === 'PL2');
  // ปิดอยู่โชว์แค่รหัส · คำอธิบายอยู่ในรายการ · ชื่อรุ่นเป็นอังกฤษตามแคตตาล็อก (เจ้าของสั่ง 2026-09-28)
  const shown = (label: string) => page.$eval(`select[aria-label="${label}"]`, (el) => {
    const sel = el as HTMLSelectElement;
    return { face: el.nextElementSibling?.textContent ?? '', color: getComputedStyle(sel).color, opt: sel.selectedOptions[0]?.textContent ?? '' };
  });
  const t = await shown('การออกขั้วไฟ');
  const famRows = await familyRows();
  const famFace = await familyFace();
  ok('dropdown ปิดอยู่โชว์แค่รหัส · รายการมีคำอธิบาย · ชื่อรุ่นอังกฤษตามแคตตาล็อก',
    famFace === 'BH-01C' && t.face === 'PL2' && /rgba\(0, 0, 0, 0\)|transparent/.test(t.color)
      && famRows.some((r) => r.value === 'BH-01C' && r.text.includes('2 Piece Band Heater')) && t.opt.startsWith('PL2 · '), `${famFace} | ${t.face}`);
  ok('ราคาตรงตัวอย่างในชีต 13,490', body.includes('13,490'));

  await setNumber('ความสูง H', '200');
  ok('แก้ความสูง → รหัสด้านบนเปลี่ยนตาม', (await codeValue()) === 'BH-01C-600x200-380-4950W-PL-PL2', await codeValue());
  body = await text();
  ok('แก้ความสูง → ราคาเปลี่ยน', !body.includes('13,490'));

  await choose('การออกขั้วไฟ', 'T');
  body = await text();
  ok('เลือกเต๋า T → ขึ้นช่องขนาดเต๋า และเตือนว่ายังไม่รวมในราคา',
    (await page.$('select[aria-label="ขนาดเต๋า (ไม่อยู่ในรหัส)"]')) !== null && body.includes('ยังไม่รวมในราคา'));
  await choose('ขนาดเต๋า (ไม่อยู่ในรหัส)', '30A');
  body = await text();
  ok('เลือก 30A → รวมในราคาแล้ว รหัสยังลงท้าย -T', !body.includes('ยังไม่รวมในราคา') && (await codeValue()).endsWith('-T'), await codeValue());

  // สิ่งที่ต้องบวกเพิ่ม — ติ๊กแล้วราคาเปลี่ยน รหัสไม่เปลี่ยน · พิมพ์รหัสเดิมซ้ำแล้วค่าที่ติ๊กไม่หาย
  await choose('การออกขั้วไฟ', '2');
  const before = await text();
  const codeBefore = await codeValue();
  await page.click('input[aria-label="สายถักสแตนเลส"]');
  await settle();
  body = await text();
  ok('ติ๊กสายถักสแตนเลส → ราคาเปลี่ยน รหัสไม่เปลี่ยน · การ์ดคำนวณมีบรรทัดสายถัก',
    body !== before && (await codeValue()) === codeBefore && body.includes('สายถักสแตนเลส'), await codeValue());
  await typeCode(await codeValue());
  ok('พิมพ์รหัสเดิมซ้ำ → ช่องติ๊กยังติ๊กอยู่',
    await page.$eval('input[aria-label="สายถักสแตนเลส"]', (el) => (el as HTMLInputElement).checked));
  await page.click('input[aria-label="สายถักสแตนเลส"]');
  await settle();

  // เจาะรู (ไม่อยู่ในรหัส · mockup แบบ B 2026-09-29) — เพิ่มแถวได้ · รวม mm ตามแถวที่ครบ · ราคาเปลี่ยน รหัสไม่เปลี่ยน
  // ยังไม่มีแถว = ปุ่ม "เจาะรู" ในแถว "นอกรหัส" · มีแถวแล้ว = "เพิ่มขนาดรู" ใต้แถว (2026-10-07)
  const addHole = async () => {
    const btn = (await page.$('xpath/.//button[contains(., "เพิ่มขนาดรู")]')) ?? (await page.$('xpath/.//button[normalize-space(.)="เจาะรู"]'));
    await btn!.click();
    await settle();
  };
  const holeCode = await codeValue();
  const noHoles = await text();
  await addHole();
  await setNumber('ขนาดรู (mm) แถว 1', '20');
  await setNumber('จำนวนรู แถว 1', '2');
  body = await text();
  ok('เจาะรู 2 รู × Ø20 → รวม 40 mm · ราคาเปลี่ยน · รหัสไม่เปลี่ยน', body.includes('รวม 40 mm') && body !== noHoles && (await codeValue()) === holeCode, await codeValue());
  await addHole();
  await setNumber('ขนาดรู (mm) แถว 2', '12');
  ok('เพิ่มแถวที่สอง 1 รู × Ø12 → รวม 52 mm', (await text()).includes('รวม 52 mm'));
  await page.screenshot({ path: join(tmpdir(), `pricing-holes-${width}.png`), fullPage: true });
  await page.click('button[aria-label="ลบแถวเจาะรู 2"]');
  await settle();
  ok('ลบแถวที่สอง → กลับเป็นรวม 40 mm', (await text()).includes('รวม 40 mm') && (await page.$('input[aria-label="ขนาดรู (mm) แถว 2"]')) === null);
  await typeCode(await codeValue());
  ok('พิมพ์รหัสเดิมซ้ำ → ช่องเจาะรูยังอยู่', (await page.$eval('input[aria-label="ขนาดรู (mm) แถว 1"]', (el) => (el as HTMLInputElement).value)) === '20');
  await page.click('button[aria-label="ลบแถวเจาะรู 1"]');
  await settle();
  ok('ลบแถวสุดท้าย → ไม่มีค่าเจาะรู ราคากลับเท่าเดิม', (await page.$('input[aria-label="ขนาดรู (mm) แถว 1"]')) === null && !(await text()).includes('รวม 40 mm'));

  // ช่อง "รุ่น" ช่องเดียวรวม BH กับ TS แบ่งกลุ่ม (เจ้าของเคาะข้อ 9 · 2026-09-29) — TS 11 ตาราง (TS_-12 สองหน้า) + BH 4 รุ่น
  // + TS_-02 กับ TS_-02-SI (แคตตาล็อกคนละหน้า · รุ่นเดียวกัน) เมื่อเล่มในฐานมี TSK-02 แล้ว (ฐาน PMSV เขียน 2026-10-05) — เงื่อนไขเดียวกับขั้น TS_-02 ข้างล่าง
  // + TS_-03 เมื่อเล่มมี TSK-03 แล้ว (ฐาน PMSV เขียน 2026-10-06) · + TS_-05 เมื่อเล่มมี TSK-05 แล้ว · + TS_-07 เมื่อเล่มมี TSK-07 แล้ว · + TS_-09 เมื่อเล่มมี TSP-09 แล้ว
  // ตั้งแต่ 2026-10-07 BH ขึ้นก่อน TS (mockup `pricing-calc-redesign` รอบ 4)
  const fam = await familyRows();
  const groupsOf = [...new Set(fam.map((r) => r.group))].map((g) => `${g}:${fam.filter((r) => r.group === g).length}`);
  const hasTable = async (v: string) => fam.some((r) => r.value === v);
  const tsTables = 11 + ((await hasTable('TS_-02')) ? 2 : 0) + ((await hasTable('TS_-03')) ? 1 : 0) + ((await hasTable('TS_-05')) ? 1 : 0)
    + ((await hasTable('TS_-07')) ? 1 : 0) + ((await hasTable('TS_-09')) ? 1 : 0);
  ok(`เลือกรุ่นจาก dropdown ในช่อง "รุ่น" (ไม่มีการ์ดแยกแล้ว) · กลุ่ม BH 4 + TS ${tsTables}`,
    JSON.stringify(groupsOf) === JSON.stringify(['HEATER · BH:4', `TEMPERATURE SENSOR · TS:${tsTables}`])
      && (await page.$$('xpath/.//button[.//b[text()="BH-03"]]')).length === 0, groupsOf.join(' · '));
  await choose('รุ่น', 'BH-03');
  await choose('การออกขั้วไฟ', '1');
  ok('BH-03 เลือกออกสาย 1 M ได้ → รหัสลงท้าย -1', (await codeValue()).endsWith('-1') && !(await text()).includes('ระบบอ่านรหัสนี้ว่าอะไร'), await codeValue());

  await choose('รุ่น', 'BH-02');
  ok('สลับเป็น BH-02 → มีช่อง Shape', (await page.$('select[aria-label="Shape"]')) !== null);
  await choose('Shape', 'C');
  // ช่องที่ยังไม่มีค่าเริ่มว่าง (2026-10-07 · ไม่เติม 200 ให้เอง) ⇒ ยังไม่คิดจนกรอก D1
  ok('Shape C → เหลือช่อง D1 ช่องเดียว · ว่างอยู่ ยังไม่คิดราคา บอกให้กรอก D1',
    (await page.$('input[aria-label="D1"]')) !== null && (await page.$('input[aria-label="ยาว L"]')) === null
    && (await codeValue()) === '' && /กรอก[\s\S]{0,20}D1/.test(await text()), await codeValue());

  // พิมพ์เร็ว ๆ แล้วคำตอบของตัวเลขก่อนหน้าต้องไม่ทับค่าล่าสุด
  await clear('input[aria-label="D1"]');
  await page.type('input[aria-label="D1"]', '215', { delay: 0 });
  await settle();
  ok('พิมพ์ต่อกันเร็ว ๆ แล้วช่องไม่เด้งกลับเป็นค่าเก่า · รหัสขึ้นต้น BH-02C',
    (await page.$eval('input[aria-label="D1"]', (el) => (el as HTMLInputElement).value)) === '215' && (await codeValue()).startsWith('BH-02C 215-'),
    await codeValue());
  body = await text();
  if (bookHasCatalog) ok('BH-02C คิดราคาได้ (สูตรวงกลม)', /\d,?\d{3}\s*บาท/.test(body) && !body.includes('ยังคิดราคาไม่ได้'));
  else console.log(`  ${DIM}·  ข้ามราคา BH-02C — เล่มในฐานยังไม่มีสูตรพื้นที่ตามรูปทรง (DEPLOY.md 4.11ข)${RESET}`);

  // ── ซีรีส์ TS (เจ้าของเคาะ mockup pricing-catalogue-ts 2026-09-29) ──────────────────────────
  const val = (label: string) => page.$eval(`select[aria-label="${label}"]`, (el) => (el as HTMLSelectElement).value);
  await typeCode('TSK-14 6x200+150-BU');
  body = await text();
  ok('พิมพ์รหัส TS → ขึ้นช่องตามแคตตาล็อก (ไม่ใช่การ์ด "ระบบอ่านรหัสนี้ว่าอะไร")',
    !body.includes('ระบบอ่านรหัสนี้ว่าอะไร') && (await val('ชนิดหัวกระโหลก')) === 'B' && (await val('Ground')) === 'U'
      && (await familyFace()) === 'TS_-14');
  await typeCode('TSK-04(S2)6Ax300+3MP');
  ok('TS_-04 ช่องได้ค่าจากรหัส (หัววัด TS · Sensor K · เกลียว S2 · แกน 6 · วัสดุ A · สาย P)',
    (await val('ชนิดหัววัด')) === 'TS' && (await val('ชนิด Sensor')) === 'K' && (await val('ขนาดเกลียว')) === 'S2'
      && (await val('ขนาดแกน')) === '6' && (await val('วัสดุ')) === 'A' && (await val('ชนิดสาย')) === 'P');
  await choose('ขนาดเกลียว', 'S4');
  ok('แก้เกลียว → รหัสด้านบนเปลี่ยนตาม', (await codeValue()) === 'TSK-04(S4)6Ax300+3MP', await codeValue());
  await setNumber('ความยาวแกน', '250');
  ok('แก้ความยาวแกน → รหัสเปลี่ยน', (await codeValue()) === 'TSK-04(S4)6Ax250+3MP', await codeValue());
  await choose('ชนิดหัววัด', 'N');
  ok('เปลี่ยนหัววัดเป็น NTC → ช่อง Sensor เหลือ 2K/10K · รหัสขึ้นต้น N2-04',
    (await val('ชนิด Sensor')) === '2' && (await codeValue()).startsWith('N2-04('), await codeValue());
  body = await text();
  ok('NTC คิดราคาได้ (กฎ NTC/PTC ของชีต)', body.includes('NTC') && /\d,?\d{3}\s*บาท/.test(body));
  await choose('รุ่น', 'TS_-06');
  ok('สลับเป็น TS_-06 → มีช่องหัวกระโหลก · ยกหัววัด/แกนเดิมมา', (await page.$('select[aria-label="ชนิดหัวกระโหลก"]')) !== null
    && (await codeValue()).startsWith('N2-06(') && (await val('ขนาดแกน')) === '6', await codeValue());
  await choose('ชนิดหัวกระโหลก', 'KB');
  ok('เลือกหัว KB → รหัสลงท้าย -KB', (await codeValue()).endsWith('-KB'), await codeValue());
  await choose('รุ่น', 'TS_-08');
  const before08 = await text();
  const code08 = await codeValue();
  await page.click('input[aria-label="หัก L ดัดงอ"]');
  await settle();
  body = await text();
  ok('TS_-08 ติ๊ก "หัก L" → ราคาเปลี่ยน รหัสไม่เปลี่ยน', body !== before08 && (await codeValue()) === code08 && body.includes('หัก L'), code08);
  await typeCode('TSP-11P 6x50+5M-PU-S000');
  ok('TS_-11 Spring P · ท่อนนอกแคตตาล็อก -S000 ขึ้นเป็นป้ายท้ายรหัส',
    (await val('Spring')) === 'P' && (await page.$('button[aria-label="เอา S000 ออก"]')) !== null);
  await page.click('button[aria-label="เอา S000 ออก"]');
  await settle();
  ok('กดเอา S000 ออก → รหัสไม่มี -S000', (await codeValue()) === 'TSP-11P 6x50+5M-PU', await codeValue());
  // TS_-02 / TS_-02-SI (2026-10-05) — อยู่ในช่อง "รุ่น" ต่อเมื่อเล่มในฐานมี TSK-02 แล้ว (`importer.ts --new-models`)
  const has02 = await hasTable('TS_-02');
  if (!has02) {
    console.log(`  ${DIM}… ช่อง "รุ่น" ยังไม่มี TS_-02 — เล่มในฐานยังไม่มี TSK-02 (ยังไม่ได้เติมลงฐาน) · ข้าม${RESET}`);
  } else {
    // แคตตาล็อก TS_-02-SI เป็นหน้าของตัวเอง (เจ้าของส่งมา 2026-10-05 "แก้ไข pattern ให้ตรงตามเอกสาร") — `-02-SI(` เป็นตัวอักษรตายตัว ไม่ใช่ช่องเลือก
    await typeCode('TSK-02-SI(11.5)5x10+2M');
    ok('TS_-02-SI เป็นรุ่นของตัวเองในช่อง "รุ่น" · ช่องได้ค่าจากรหัส (เขี้ยวล็อค 11.5 · แกน 5) · ไม่มีช่องรุ่นย่อย',
      (await familyFace()) === 'TS_-02-SI' && (await val('ขนาดเขี้ยวล็อค')) === '11.5' && (await val('ขนาดแกน')) === '5'
        && (await page.$('select[aria-label="รุ่นย่อย"]')) === null && (await text()).includes('-02-SI('));
    const priceSi = await text();
    await choose('รุ่น', 'TS_-02');
    body = await text();
    ok('สลับเป็น TS_-02 → รหัสไม่มี -SI · เขี้ยวล็อค 11.5 (ไม่มีในหน้า TS_-02) กลับเป็นค่าตั้งต้น 12 · ราคาเปลี่ยน',
      (await codeValue()) === 'TSK-02(12)5x10+2M' && body !== priceSi && !body.includes('เฉพาะ TS-02-SI'), await codeValue());
    await typeCode('TSK-02(11.5)5x10+2M');
    ok('พิมพ์ TS_-02 ธรรมดากับเขี้ยวล็อค 11.5 → เตือนว่าทำได้เฉพาะ TS-02-SI (ราคาเท่าเดิม)',
      (await familyFace()) === 'TS_-02' && (await text()).includes('เฉพาะ TS-02-SI'));
    // ขนาดแกนที่ตารางไม่มีแถว = ขอราคา + ช่องสีส้มบนหน้าสมุดราคา (เจ้าของสั่ง 2026-10-05) — เดิมขึ้น "รหัสไม่ได้บอกขนาดแกน"
    await typeCode('TSK-02(12.7)3.2x200+5M');
    body = await text();
    ok('แกน 3.2 (นอกแคตตาล็อก) → ต้องขอราคาจากฝ่ายผลิต · ไม่ขึ้น "รหัสไม่ได้บอกขนาดแกน"',
      body.includes('ต้องขอราคาจากฝ่ายผลิต') && !body.includes('รหัสไม่ได้บอกขนาดแกน') && body.includes('ขอราคาฝ่ายผลิต'));
    // ตัว S หลังเลขรุ่น = นอกแคตตาล็อก คิดตามรุ่นฐาน + เตือนบนจอ (เจ้าของเคาะ 2026-10-05)
    await typeCode('TSJ-02S(12)5x10+1.5M');
    ok('TSJ-02S → คิดราคาได้ + เตือนว่าตัว S นอกแคตตาล็อก ยังไม่รวมส่วนนี้', (await text()).includes('ยังไม่รวมส่วนของตัว S'));
    // สายเขียนเป็น mm (`+400mm` = 0.4 เมตร) — เดิมอ่านเป็น 400 เมตร ได้ราคา 65,160 บาท
    await typeCode('TSP-02(12)5x11+400mm.-TSU');
    body = await text();
    // ตัวอ่านรหัสพิสูจน์ 0.4 เมตรแล้วใน diag:pricing-catalog-ts — ที่นี่ดูแค่ที่จอแสดง: หน่วย mm ของช่องสาย · ไม่มีเลขหลักหมื่นเดิม
    ok('สาย +400mm → ช่องความยาวสายขึ้นหน่วย mm · ไม่มีค่าสาย 63,840 / ราคา 65,160 แบบเดิม',
      !body.includes('63,840') && !body.includes('65,160') && body.includes('ความยาวสาย (mm)') && (await codeValue()) === 'TSP-02(12)5x11+400mm.-TSU', await codeValue());
  }
  await choose('รุ่น', 'BH-01');
  // มาจาก TS = ไม่มีขนาดให้ยก ⇒ ช่องว่าง ยังไม่คิดจนกรอก ID / ความสูง H (2026-10-07)
  ok('สลับจาก TS กลับไป BH ได้จากช่องเดียวกัน · ช่องว่างรอกรอก', (await page.$('select[aria-label="การออกขั้วไฟ"]')) !== null
    && (await codeValue()) === '' && /กรอก[\s\S]{0,20}ID/.test(await text()), await codeValue());
  // ── ตั้งแต่ 2026-10-01 ทุกรหัสใช้ช่องกรอกแบบเดียว อะไรไม่ตรงแค่แจ้งเตือน (mockup `pricing-one-form.html`) ──
  await typeCode('TSK-06(S4)12.7x110-2B');
  body = await text();
  ok('รหัส TS ที่เขียนนอกรูปแบบ (-2B ติดกัน) → ยังเป็นช่องกรอก ไม่มีการ์ดเดิม · รหัสไม่ถูกเขียนทับ',
    !body.includes('ระบบอ่านรหัสนี้ว่าอะไร') && (await page.$('select[aria-label="ขนาดเกลียว"]')) !== null && (await codeValue()) === 'TSK-06(S4)12.7x110-2B',
    await codeValue());

  await typeCode('BH-02-S 406x330-220-2500W');
  body = await text();
  ok('รหัส BH ที่เขียนนอกรูปแบบ → ยังเป็นช่องกรอก + แถบ "ยังไม่รวมในราคา" · รหัสไม่ถูกเขียนทับ',
    !body.includes('ระบบอ่านรหัสนี้ว่าอะไร') && (await page.$('button[aria-label="รุ่น"]')) !== null && body.includes('ยังไม่รวมในราคา')
      && (await codeValue()) === 'BH-02-S 406x330-220-2500W', await codeValue());

  await typeCode('TSP-01-0(M5)+3MTU-S000');
  body = await text();
  ok('ตัวอย่าง 1: TSP-01-0(M5)… ได้ช่อง Hold โชว์ M5 ไม่มีป้ายเตือนที่ช่องนั้น',
    (await val('ขนาด Hold Size')) === '' && !body.includes('ไม่อยู่ในแคตตาล็อก') && body.includes('M5'));

  await typeCode('TSK-01 4.8+30cm');
  ok('ตัวอย่าง 2: สายเป็น cm → ช่องสายบอกหน่วย cm', (await text()).includes('ความยาวสาย (cm)'));
  await choose('ชนิดสาย', 'T');
  ok('แก้ชนิดสายแล้วรหัสคงรูปเดิม (ยังเป็น cm)', /\+30cmT$/i.test(await codeValue()), await codeValue());

  await typeCode('TSK-01(M6)4+1.5M');
  ok('ตัวอย่าง 3: แกน 4 → ช่องแกนขึ้น "ไม่อยู่ในแคตตาล็อก" แต่ยังมีราคา',
    (await text()).includes('ไม่อยู่ในแคตตาล็อก') && (await text()).includes('ราคาตั้งต่อหน่วย'));

  await typeCode('TSK-01(M13)4.8x50+2MT');
  body = await text();
  ok('ตัวอย่าง 4: ต้องขอราคา → ช่องเกลียว "ขอราคาฝ่ายผลิต" + โชว์ราคาเท่าที่คิดได้',
    body.includes('ขอราคาฝ่ายผลิต') && body.includes('ราคาเท่าที่คิดได้'));

  await typeCode('TSK-01-L(M6)4.8+1M');
  body = await text();
  ok('ตัวอย่าง 5: ท่อนที่ยังไม่ได้กำหนด → ชิป L ป้าย "ยังไม่ได้กำหนด" · ไม่มีคำว่า "อ่านไม่ออก" บนจอ (เจ้าของสั่ง 2026-10-05)',
    (await page.$('button[aria-label="เอา L ออก"]')) !== null && body.includes('ยังไม่ได้กำหนด') && !/อ่าน\S{0,20}ไม่ออก/.test(body));

  // เลข 99 ไม่มีในแคตตาล็อก — เดิมใช้ TSK-02 ซึ่งมีรุ่นแล้วตั้งแต่ 2026-10-05 (ห้ามใช้ซีรีส์ที่รอเติม เช่น TSK-03 ไม่งั้นตกอีกรอบ)
  await typeCode('TSK-99(12)5x10+2M');
  ok('ตัวอย่าง 7: รุ่นที่ไม่มีในสมุดราคา → ช่อง "รุ่น" ว่าง + เหตุผล', (await text()).includes('ไม่พบรุ่นในสมุดราคา'));

  await typeCode('BH-02C 210-220-1400W-N-Z');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('ไม่มีเลื่อนซ้ายขวาทั้งหน้า', overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: join(tmpdir(), `pricing-catalog-${width}.png`), fullPage: true });
}

ok('ไม่มี error ในหน้า', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
console.log(`\n${fail ? RED : GREEN}${pass} ผ่าน · ${fail} ตก${RESET}   (ภาพ: ${join(tmpdir(), 'pricing-catalog-1280.png')} · -390.png)`);
process.exit(fail ? 1 : 0);
