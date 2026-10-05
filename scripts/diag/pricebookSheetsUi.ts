/* ─────────────────────────────────────────────────────────────────────────────
   เปิดหน้า "สมุดราคา" จริงแล้วเปิดทุกชีตแบบ Excel (เจ้าของสั่ง 2026-09-28 "ปรับสมุดราคาให้เป็นสไตล์ excel ทั้งหมด")

   เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md · หัว frontend/src/admin/pricingLab/SheetEditor.tsx

   ทำไมต้องมีด่านนี้ ทั้งที่ `diag:pricing-model-edit` ข้อ 13 ผ่านแล้ว: ด่านนั้นพิสูจน์ตัวรับค่าฝั่งเซิร์ฟเวอร์
   แต่ "ทุกราคาในเล่มมีช่องบนจอ · แก้แล้วหน้าตรวจเห็นเดิม → ใหม่ · ปุ่มกฎและเงื่อนไขพาไปแล้วกลับมาชีตเดิม"
   เป็นของฝั่งจอล้วน และ **build ผ่านทั้งที่ช่องหาย/ปุ่มไม่ทำงานได้** (AGENTS.md A9) ⇒ เปิดดูที่ 1280 / 390

   **อ่านอย่างเดียว — ไม่กด "บันทึกราคาใหม่" เลย** (เปิดหน้าตรวจแล้วกด "กลับไปแก้ต่อ" · ย้อนการแก้) จึงไม่ต้องมี
   ด่านกันเครื่องแบบ `diag:pb-ui` · ใช้บัญชี admin ตัวแรกในฐานออก token ชั่วคราว 1 ชั่วโมง

   ต้องมี API ของทรีนี้รันอยู่ที่ PB_PORT (ค่าเริ่มต้น 3099 · 3098 เป็นของโปรเซสอื่นบน PMSV) — **ห้ามใช้ 5180**:
     PORT=3099 PREVIEW_MODE=1 npx tsx index.ts
     npm run diag:pricebook-sheets-ui
   ภาพหน้าจอลง tmpdir (บอก path ในผล)
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer from 'puppeteer';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { readBookState } from '../../services/pricingLab/bookStore.js';

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
const { rows: admins } = await pool.query(`SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`);
await pool.end();
if (!state) throw new Error('ยังไม่มีสมุดราคาในฐานนี้');
if (!admins.length) throw new Error('ไม่มีบัญชี admin บนฐานนี้');
const admin = admins[0];
const token = jwt.sign({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }, getJwtSecret(), { expiresIn: '1h' });

/** จำนวนราคาที่เล่มมี ต่อชีต — ทุกตัวต้องมีช่องบนจอ (ช่องที่มีเลข) */
const expected = new Map<string, number>();
for (const m of Object.values(state.book.models)) {
  let n = m.base.kind === 'matrix' ? Object.keys(m.base.cells).length
    : m.base.kind === 'banded' ? m.base.bands.filter((b) => b.flat !== undefined || b.rate !== undefined).length : 0;
  for (const a of m.adders) {
    if (a.rates) n += Object.keys(a.rates).length;
    else if ((a.kind === 'flat' ? a.amount : a.kind === 'percent' ? a.percent : a.rate) !== undefined) n++;
  }
  if (m.variant) n += 1 + Object.keys(m.variant.adderPrices ?? {}).length;
  const s = m.sheet || m.code;
  expected.set(s, (expected.get(s) ?? 0) + n);
}
const shots = mkdtempSync(join(tmpdir(), 'pb-sheets-'));
console.log(`ใช้บัญชี ${admin.username} · เซิร์ฟเวอร์ ${BASE} · สมุด ${state.token} · ${expected.size} ชีต · ภาพ ${shots}\n`);

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e instanceof Error ? e.message : String(e)));
page.on('dialog', (d) => void d.accept());

const text = () => page.evaluate(() => document.body.innerText);
/** หัวของหน้าชีต ("ชีต TS-04") — แถบบนของแอปก็เป็น h1 ("Primus Quotation") จึงเลือกตัวที่ขึ้นต้นด้วย "ชีต" */
const sheetTitle = () => page.evaluate(() =>
  ([...document.querySelectorAll('h1')].map((h) => (h as HTMLElement).innerText.trim()).find((t) => t.startsWith('ชีต')) ?? '').replace(/^ชีต\s*/, ''));
const clickButton = async (label: RegExp, scope = 'body') => {
  const done = await page.evaluate((src: string, sc: string) => {
    const re = new RegExp(src);
    const b = [...document.querySelectorAll(`${sc} button`)].find((x) => re.test((x as HTMLElement).innerText.trim()) && (x as HTMLElement).offsetParent);
    (b as HTMLButtonElement | undefined)?.click();
    return !!b;
  }, label.source, scope);
  await page.waitForNetworkIdle({ idleTime: 300, timeout: 8000 }).catch(() => {});
  await wait(150);
  return done;
};

for (const width of [1280, 390]) {
  console.log(`\n── ${width}px ──────────────────────────────────────────────`);
  await page.setViewport({ width, height: 900 });
  await page.evaluateOnNewDocument((t: string, u: string) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', u);
  }, token, JSON.stringify({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }));
  await page.goto(`${BASE}/admin.html#pricebook`, { waitUntil: 'networkidle0' });
  await wait(500);

  const openCount = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'เปิดชีต' && b.offsetParent).length);
  ok(`ทุกชีตมีปุ่ม "เปิดชีต" (${expected.size} ชีต) · ไม่มีปุ่มแก้ทีละรุ่นในรายการ`,
    openCount === expected.size && !(await text()).includes('แก้ราคา BH'), `${openCount}`);

  for (let i = 0; i < expected.size; i++) {
    await page.evaluate((k: number) => {
      const bs = [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'เปิดชีต' && b.offsetParent);
      (bs[k] as HTMLButtonElement).click();
    }, i);
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 8000 }).catch(() => {});
    await wait(200);
    const sheet = await sheetTitle();
    const want = expected.get(sheet) ?? -1;
    const filled = await page.evaluate(() =>
      [...document.querySelectorAll('section input[inputmode="decimal"]')].filter((x) => (x as HTMLInputElement).value.trim() !== '').length);
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(`ชีต ${sheet}: ทุกราคาในเล่มมีช่องบนจอ · ไม่เลื่อนซ้ายขวาทั้งหน้า`, filled === want && !hscroll, `ช่องที่มีเลข ${filled} / ราคาในเล่ม ${want}${hscroll ? ' · หน้าเลื่อนข้าง' : ''}`);
    await page.screenshot({ path: join(shots, `${width}-${sheet.replace(/[^\w.-]+/g, '_')}.png`), fullPage: true });
    // เปิดมายังไม่ได้แก้อะไร = ไม่มีช่องที่บันทึกไม่ได้ — กฎที่ยังไม่มีราคา (PL-5 ของ BH) ว่างได้
    // (เดิมช่องว่างของ PL-5 ถูกนับเป็นช่องผิด ⇒ ชีต BH ทั้งหน้ากด "ตรวจก่อนบันทึก" ไม่ได้ · แก้ 2026-10-05)
    const blockedAtOpen = await page.evaluate(() => (document.body.innerText.match(/ยังบันทึกไม่ได้[^\n]*/) ?? [''])[0]);
    ok(`  เปิดมายังไม่แก้ → ไม่มีช่องที่บันทึกไม่ได้`, blockedAtOpen === '', blockedAtOpen);

    if (width === 1280) {
      // แก้ช่องแรกที่มีเลข → หน้าตรวจเห็น 1 รายการ เดิม → ใหม่ → กลับไปแก้ต่อ → ย้อนการแก้ (ไม่กดบันทึก)
      const first = await page.evaluate(() => {
        const el = [...document.querySelectorAll('section input[inputmode="decimal"]')].find((x) => (x as HTMLInputElement).value.trim() !== '') as HTMLInputElement | undefined;
        return el ? { label: el.getAttribute('aria-label') ?? '', value: el.value } : null;
      });
      if (first) {
        const sel = `input[aria-label="${first.label.replace(/"/g, '\\"')}"]`;
        await page.click(sel);
        await page.keyboard.type(String(Number(first.value.replace(/,/g, '')) + 1));
        await wait(100);
        const btn = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('ตรวจก่อนบันทึก'))?.innerText ?? '');
        ok(`  แก้ "${first.label}" → ปุ่มตรวจก่อนบันทึกนับ 1`, /\(1\)/.test(btn), btn);
        await clickButton(/^ตรวจก่อนบันทึก/);
        const modal = await text();
        ok('  หน้าตรวจเห็นเดิม → ใหม่', modal.includes('ตรวจก่อนบันทึก — ชีต') && modal.includes(String(Number(first.value.replace(/,/g, '')) + 1).replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
        await clickButton(/^กลับไปแก้ต่อ$/);
        await clickButton(/^ย้อนการแก้$/);
        const back = await page.$eval(sel, (el) => (el as HTMLInputElement).value);
        ok('  ย้อนการแก้ → ค่าเดิม', back === first.value, back);
      }
      // ช่องที่ไม่ใช่ตัวเลข = บันทึกไม่ได้ (เดิมถูกอ่านเป็น "ว่าง" = ไม่รับผลิตเงียบ ๆ)
      if (first) {
        const sel = `input[aria-label="${first.label.replace(/"/g, '\\"')}"]`;
        await page.click(sel);
        await page.keyboard.type('12a');
        await wait(100);
        const blocked = await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('ตรวจก่อนบันทึก')) as HTMLButtonElement | undefined;
          return !!b?.disabled && document.body.innerText.includes('ยังบันทึกไม่ได้');
        });
        ok('  พิมพ์ "12a" → ขึ้นเตือนและกดตรวจก่อนบันทึกไม่ได้', blocked);
        await clickButton(/^ย้อนการแก้$/);
      }
      // กฎที่ยังไม่มีราคา (PL-5 ของ BH) — กรอกทีหลังได้ · หน้าตรวจเห็น "ว่าง (ยังไม่มีราคา) → ราคาที่กรอก" (ไม่กดบันทึก)
      const pending = await page.evaluate(() => {
        const el = [...document.querySelectorAll('section input[inputmode="decimal"]')]
          .find((x) => (x as HTMLInputElement).placeholder === 'ยังไม่มีราคา' && (x as HTMLInputElement).value === '') as HTMLInputElement | undefined;
        return el?.getAttribute('aria-label') ?? null;
      });
      if (pending) {
        await page.click(`input[aria-label="${pending.replace(/"/g, '\\"')}"]`);
        await page.keyboard.type('150');
        await wait(100);
        await clickButton(/^ตรวจก่อนบันทึก/);
        const modal = await text();
        ok(`  กฎที่ยังไม่มีราคา "${pending}" กรอก 150 → หน้าตรวจเห็นว่าง (ยังไม่มีราคา) → 150`,
          modal.includes('ตรวจก่อนบันทึก — ชีต') && modal.includes('ยังไม่มีราคา') && /\b150\b/.test(modal));
        await clickButton(/^กลับไปแก้ต่อ$/);
        await clickButton(/^ย้อนการแก้$/);
      }
    }
    await clickButton(/^กลับ$/);
  }

  if (width === 1280) {
    // ปุ่มกฎและเงื่อนไข → หน้าแก้ทีละรุ่น → กลับ = กลับมาชีตเดิม
    await clickButton(/^เปิดชีต$/);
    const sheet = await sheetTitle();
    await clickButton(/กฎและเงื่อนไข/);
    const adv = await text();
    ok(`${sheet}: ปุ่ม "กฎและเงื่อนไข" เปิดหน้าแก้กฎของรุ่น`, adv.includes('สิ่งที่ต้องบวกเพิ่ม') && adv.includes('แก้ราคา'));
    await clickButton(/^กลับ$/);
    const again = await sheetTitle();
    ok('  กด "กลับ" แล้วกลับมาที่ชีตเดิม', !!sheet && again === sheet, again);
    await clickButton(/^กลับ$/);
  }
}

ok('ไม่มี error ในหน้า', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\nผล: ผ่าน ${pass} · ตก ${fail} · ภาพหน้าจอ ${shots}`);
process.exit(fail ? 1 : 0);
