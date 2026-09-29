/* ─────────────────────────────────────────────────────────────────────────────
   เปิดหน้า "กฎและเงื่อนไข" ของซีรีส์ TS จริงทุกตาราง (เจ้าของเคาะ mockup 2026-09-29 "ดูรกและเข้าใจยาก")

   เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md · หัว frontend/src/admin/pricingLab/TsRulesView.tsx

   สิ่งที่พิสูจน์ (build ผ่านทั้งที่ของพวกนี้พังได้ — AGENTS.md A9):
     · ทุกรุ่น TS ได้หน้าใหม่ (ไม่มีกริดราคารายขนาดแบบเดิม "ราคาแยกตาม") · ทุกกฎของรุ่นมีแถว · ทุกข้อห้ามมีสวิตช์
     · ช่องเดียวของ "ราคาเท่ากันทุกขนาด" แก้แล้ว **เปลี่ยนเฉพาะขนาดที่มีราคา** (ข้อ 2) และหน้าตรวจรวมเป็นแถวเดียว
     · กล่องแก้กฎมีสองขั้น + ตัวอย่างตัวเลข · รายการตัวเลือกไม่ปน BH จนกว่าจะกด "ซีรีส์อื่น" (ข้อ 4)
     · BH ยังได้หน้าเดิม (ข้อ 3) · จอ 390 ไม่มีเลื่อนซ้ายขวา · ไม่มี error ในหน้า

   **อ่านอย่างเดียว — ไม่กด "บันทึกราคาใหม่" เลย** (หน้าตรวจ → กลับไปแก้ต่อ → ย้อนการแก้)
   ต้องมี API ของทรีนี้รันอยู่ที่ PB_PORT (ค่าเริ่มต้น 3099) — **ห้ามใช้ 5180**:
     PORT=3099 PREVIEW_MODE=1 npx tsx index.ts
     npm run diag:pricing-rules-ts-ui
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer from 'puppeteer';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { readBookState } from '../../services/pricingLab/bookStore.js';
import { modelEditorView } from '../../services/pricingLab/modelEditor.js';

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

/** หน้าที่คาดว่าจะเห็น — จับคู่ด้วยบรรทัด "ใช้กับรหัส …" ซึ่งไม่ซ้ำกันระหว่างรุ่น */
const views = Object.values(state.book.models)
  .filter((m) => /^TS/.test(m.code))
  .map((m) => modelEditorView(state.book, m))
  .filter((v) => v.base.kind === 'matrix' && !v.variant);
const codesLine = (v: (typeof views)[number]) => `ใช้กับรหัส ${[v.name, ...v.aliases].join(', ')}`;

const shots = mkdtempSync(join(tmpdir(), 'rules-ts-'));
console.log(`ใช้บัญชี ${admin.username} · เซิร์ฟเวอร์ ${BASE} · สมุด ${state.token} · รุ่น TS ${views.length} · ภาพ ${shots}\n`);

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e instanceof Error ? e.message : String(e)));
page.on('dialog', (d) => void d.accept());

const text = () => page.evaluate(() => document.body.innerText);
const sheetTitle = () => page.evaluate(() =>
  ([...document.querySelectorAll('h1')].map((h) => (h as HTMLElement).innerText.trim()).find((t) => t.startsWith('ชีต')) ?? '').replace(/^ชีต\s*/, ''));
const settle = async () => {
  await page.waitForNetworkIdle({ idleTime: 300, timeout: 8000 }).catch(() => {});
  await wait(150);
};
/** กดปุ่มตัวที่ `nth` ที่ข้อความตรง — คืน false ถ้าไม่มี */
const clickButton = async (label: RegExp, nth = 0) => {
  const done = await page.evaluate((src: string, n: number) => {
    const re = new RegExp(src);
    const b = [...document.querySelectorAll('button')].filter((x) => re.test((x as HTMLElement).innerText.trim()) && (x as HTMLElement).offsetParent)[n];
    (b as HTMLButtonElement | undefined)?.click();
    return !!b;
  }, label.source, nth);
  await settle();
  return done;
};
const countButtons = (label: RegExp) => page.evaluate((src: string) => {
  const re = new RegExp(src);
  return [...document.querySelectorAll('button')].filter((x) => re.test((x as HTMLElement).innerText.trim()) && (x as HTMLElement).offsetParent).length;
}, label.source);
const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const seen = new Set<string>();
let checkedOne = false;
let checkedModal = false;
let checkedBh = false;

for (const width of [1280, 390]) {
  console.log(`\n── ${width}px ──────────────────────────────────────────────`);
  await page.setViewport({ width, height: 900 });
  await page.evaluateOnNewDocument((t: string, u: string) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', u);
  }, token, JSON.stringify({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }));
  await page.goto(`${BASE}/admin.html#pricebook`, { waitUntil: 'networkidle0' });
  await wait(500);

  const sheets = await countButtons(/^เปิดชีต$/);
  for (let s = 0; s < sheets; s++) {
    await clickButton(/^เปิดชีต$/, s);
    const sheet = await sheetTitle();
    const isTs = /^TS/.test(sheet);

    // ข้อ 3: BH ยังได้หน้าเดิม — ดูครั้งเดียวพอ
    if (!isTs && !checkedBh && width === 1280 && (await countButtons(/กฎและเงื่อนไข/)) > 0) {
      await clickButton(/กฎและเงื่อนไข/);
      const t = await text();
      ok(`${sheet}: BH ยังใช้หน้าเดิม`, t.includes('สิ่งที่ต้องบวกเพิ่ม') && !t.includes('คิดเพิ่มทุกชิ้น'));
      checkedBh = true;
      await clickButton(/^กลับ$/);
    }
    if (!isTs) { await clickButton(/^กลับ$/); continue; }

    const rules = await countButtons(/กฎและเงื่อนไข/);
    for (let r = 0; r < rules; r++) {
      await clickButton(/กฎและเงื่อนไข/, r);
      const t = await text();
      const v = views.find((x) => t.includes(codesLine(x)));
      if (!v) { ok(`${sheet} #${r + 1}: เปิดแล้วรู้ว่าเป็นรุ่นไหน`, false, t.slice(0, 120)); await clickButton(/^กลับไปหน้าชีต$/); continue; }
      const tag = `${v.title} (${v.code})`;
      seen.add(`${width}:${v.code}`);

      if (width === 1280) {
        const missing = v.adders.filter((a) => !t.includes(a.label)).map((a) => a.label);
        ok(`${tag}: หน้าใหม่ · ไม่มีกริดรายขนาด · ครบ ${v.adders.length} กฎ`,
          t.includes(`กฎและเงื่อนไข · ${v.title}`) && !t.includes('ราคาแยกตาม') && missing.length === 0, missing.join(', '));
        const sw = await page.evaluate(() => document.querySelectorAll('[role=switch][aria-label^="เปิดใช้กฎ"], [role=switch][aria-label^="เปิดใช้ข้อห้าม"]').length);
        ok(`  สวิตช์ครบ (กฎ ${v.adders.length} + ข้อห้าม ${v.constraints.length})`, sw === v.adders.length + v.constraints.length, `${sw}`);
      } else {
        ok(`${tag}: 390px ไม่มีเลื่อนซ้ายขวา`, await noHScroll());
      }
      await page.screenshot({ path: join(shots, `${width}-${v.code}.png`), fullPage: true });

      // ข้อ 2: ช่องเดียวของราคาเท่ากันทุกขนาด — ครั้งเดียว ที่รุ่นแรกที่มีแบบนี้
      if (width === 1280 && !checkedOne) {
        const one = await page.$('input[aria-label$="ที่มีราคา"]');
        if (one) {
          const label = await one.evaluate((e) => e.getAttribute('aria-label') ?? '');
          const adderLabel = label.replace(/ — ทุก.*$/, '');
          const a = v.adders.find((x) => x.label === adderLabel)!;
          const priced = a.rates!.filter((x) => x.rate !== null);
          const unpriced = a.rates!.length - priced.length;
          const next = priced[0]!.rate! + 7;
          await one.click();
          await one.type(String(next));
          await wait(200);
          const btn = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.startsWith('ตรวจก่อนบันทึก'))?.innerText ?? '');
          const rows = priced.length > 6 ? 1 : priced.length;
          ok(`${tag}: ช่องเดียว “${adderLabel}” → ${next} = ส่วนต่าง ${rows} แถว`, btn.includes(`(${rows})`), btn);
          await clickButton(/^ตรวจก่อนบันทึก/);
          const rv = await text();
          ok(`  หน้าตรวจรวมเป็นแถวเดียว “${priced.length} ขนาด” · ขนาดที่ไม่มีราคา ${unpriced} ขนาดไม่ถูกแตะ`,
            (priced.length <= 6 || rv.includes(`${priced.length} ขนาด (`)) && rv.includes(String(next)) && !rv.includes('ไม่มีราคา —'));
          await clickButton(/^กลับไปแก้ต่อ$/);
          await clickButton(/^ย้อนการแก้$/);
          const after = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.startsWith('ตรวจก่อนบันทึก'))?.hasAttribute('disabled'));
          ok('  ย้อนการแก้แล้วไม่เหลือส่วนต่าง', after === true);
          checkedOne = true;
        }
      }

      // กล่องแก้กฎ: กฎคิดตามความยาวตัวแรก · แล้วกล่องเพิ่มกฎ
      if (width === 1280 && !checkedModal && v.adders.some((a) => a.kind === 'perUnit' && a.rates)) {
        const a = v.adders.find((x) => x.kind === 'perUnit' && x.rates)!;
        await page.evaluate((l: string) => (document.querySelector(`button[aria-label="แก้กฎ ${l}"]`) as HTMLButtonElement)?.click(), a.label);
        await wait(250);
        const m = await text();
        ok(`${tag}: กล่องแก้ “${a.label}” มีสองขั้น + ตัวอย่างตัวเลข`, m.includes('คิดเมื่อไหร่') && m.includes('คิดเท่าไหร่') && /ตัวอย่าง.*= [\d,.]+ บาท/.test(m));
        await clickButton(/^ยกเลิก$/);
        await clickButton(/^เพิ่มกฎ$/);
        const opts = () => page.evaluate(() => [...document.querySelectorAll('select[aria-label="ตัวเลือกที่เลือก"] option')].map((o) => o.textContent ?? ''));
        const before = await opts();
        ok('  กล่องเพิ่มกฎ: ตัวเลือกไม่ปน BH', before.length > 0 && !before.some((o) => o.includes('เต๋าเซรามิค')), `${before.length} ตัว`);
        await page.select('select[aria-label="ตัวเลือกที่เลือก"]', '__more');
        await wait(150);
        const afterOpts = await opts();
        ok('  กด “แสดงตัวเลือกของซีรีส์อื่น” แล้วเห็นของซีรีส์อื่น', afterOpts.some((o) => o.includes('เต๋าเซรามิค')));
        await clickButton(/^ยกเลิก$/);
        checkedModal = true;
      }

      await clickButton(/^กลับไปหน้าชีต$/);
      const again = await sheetTitle();
      if (r === 0 && width === 1280) ok(`  กด “กลับไปหน้าชีต” แล้วอยู่ชีตเดิม`, again === sheet, again);
    }
    await clickButton(/^กลับ$/);
  }
}

for (const width of [1280, 390]) {
  const lost = views.filter((v) => !seen.has(`${width}:${v.code}`)).map((v) => v.code);
  ok(`${width}px: เปิดครบทุกรุ่น TS (${views.length})`, lost.length === 0, lost.join(', '));
}
ok('ทดสอบช่องเดียว (ข้อ 2) ได้จริง', checkedOne);
ok('ทดสอบกล่องแก้กฎได้จริง', checkedModal);
ok('ทดสอบว่า BH ยังได้หน้าเดิม', checkedBh);
ok('ไม่มี error ในหน้า', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\nผล: ผ่าน ${pass} · ตก ${fail} · ภาพหน้าจอ ${shots}`);
process.exit(fail ? 1 : 0);
