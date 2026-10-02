/* ─────────────────────────────────────────────────────────────────────────────
   "ต้องขอราคาจากฝ่ายผลิต" ของ TS_-01 — เปิดหน้าจริงแล้วกดจริง (เจ้าของเคาะ mockup `ts01-ask-price` แบบ A 2026-09-29)

   เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md · docs/pricing-code-ts-01.md §7

   ทำไมต้องมีด่านนี้: ตัวรับค่าฝั่งเซิร์ฟเวอร์ (`addValues`/`removeValues`/ขนาดแกนใหม่) พิสูจน์ใน `diag:pricing-catalog-ts`
   แต่ "กดชิปแล้วมีคอลัมน์ส้ม · ✕ แล้วหาย · หน้าตรวจบอกว่าเพิ่มอะไร · ปุ่มจากหน้าคำนวณราคาพาไปถึงกล่อง" เป็นของจอล้วน
   และ **build ผ่านทั้งที่ปุ่มไม่ทำงานได้** (AGENTS.md A9) ⇒ เปิดดูที่ 1280 / 390

   **ไม่กดบันทึกเลย** (เปิดหน้าตรวจแล้ว "กลับไปแก้ต่อ" · ย้อนการแก้) · ค่าที่ใช้ทดสอบหาเองจากสมุด (ค่าที่ตารางยังไม่มี)
   ไม่ผูกกับตัวเลขในฐาน — ด่านนี้ตรวจแค่สิ่งที่ต้องจริงเสมอ (CLAUDE.md: ห้ามเทียบผลที่ขึ้นกับข้อมูลกับ golden)

   ต้องมี API ของทรีนี้รันอยู่ที่ PB_PORT (ค่าเริ่มต้น 3099) — **ห้ามใช้ 5180**:
     npm --prefix frontend run build && PORT=3099 PREVIEW_MODE=1 npx tsx index.ts
     npm run diag:pricebook-ask-ui
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer from 'puppeteer';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { readBookState } from '../../services/pricingLab/bookStore.js';
import { axisValues } from '../../services/pricingLab/code.js';

const PORT = Number(process.env.PB_PORT ?? 3099);
const BASE = `http://localhost:${PORT}`;
const SHEET = 'TS-01+TS-01-0';
const MODEL = 'TSK-01';
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
const model = state.book.models[MODEL];
if (!model) throw new Error(`ไม่มีรุ่น ${MODEL} ในสมุด`);
const admin = admins[0];
const token = jwt.sign({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }, getJwtSecret(), { expiresIn: '1h' });

// ค่าทดสอบ = ค่าที่ตารางยังไม่มี (หาเอง ไม่ผูกกับข้อมูลวันนี้)
const threads = axisValues(model, 'thread');
const freeThread = ['M97', 'M93', 'M89', 'M83'].find((t) => !threads.some((v) => v.toUpperCase().startsWith(t)))!;
const sensors = axisValues(model, 'sensor');
const freeSensor = ['TSQ', 'TSW', 'TSY'].find((s) => !sensors.includes(s))!;
const dKeys = Object.keys(model.adders.find((a) => a.byAxis === 'D')?.rates ?? {});
const freeD = ['97', '93', '89'].find((d) => !dKeys.includes(d))!;
const shots = mkdtempSync(join(tmpdir(), 'pb-ask-'));
console.log(`ใช้บัญชี ${admin.username} · เซิร์ฟเวอร์ ${BASE} · สมุด ${state.token} · ค่าทดสอบ ${freeThread} / ${freeSensor} / ${freeD} mm · ภาพ ${shots}\n`);

const unreadRes = await fetch(`${BASE}/api/admin/pricebook/unread`, { headers: { Authorization: `Bearer ${token}` } });
const unread = (await unreadRes.json())?.summary;
const found = ((unread?.sheets ?? []).find((s: { sheet: string }) => s.sheet === SHEET)?.askPrice ?? []) as { model: string; axis: string; value: string }[];
const foundHere = found.filter((f) => f.model === MODEL);

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e instanceof Error ? e.message : String(e)));
page.on('dialog', (d) => void d.accept());

const text = () => page.evaluate(() => document.body.innerText);
const clickButton = async (label: RegExp, scope = 'body') => {
  const done = await page.evaluate((src: string, sc: string) => {
    const re = new RegExp(src);
    const b = [...document.querySelectorAll(`${sc} button`)].find((x) => re.test((x as HTMLElement).innerText.trim()) && (x as HTMLElement).offsetParent && !(x as HTMLButtonElement).disabled);
    (b as HTMLButtonElement | undefined)?.click();
    return !!b;
  }, label.source, scope);
  await page.waitForNetworkIdle({ idleTime: 300, timeout: 8000 }).catch(() => {});
  await wait(150);
  return done;
};
const reviewCount = () => page.evaluate(() => {
  const t = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('ตรวจก่อนบันทึก'))?.innerText ?? '';
  return Number(t.match(/\((\d+)\)/)?.[1] ?? 0);
});
/** หัวคอลัมน์/แถวสีส้ม (นอกแคตตาล็อก) ที่ชื่อนี้ */
const orangeHead = (name: string) => page.evaluate((n: string) =>
  [...document.querySelectorAll(`#ask-${'TSK-01'}`)].length > 0 &&
  [...document.querySelectorAll('section th')].some((th) => th.className.includes('orange') && (th as HTMLElement).innerText.split('\n')[0]!.replace('✕', '').trim() === n), name);
const addOwn = async (slotLabel: string, value: string) => {
  await page.select('#ask-TSK-01 select[aria-label="ช่องที่จะเพิ่ม"]', await page.evaluate((lab: string) =>
    ([...document.querySelectorAll('#ask-TSK-01 select[aria-label="ช่องที่จะเพิ่ม"] option')] as HTMLOptionElement[]).find((o) => o.text === lab)?.value ?? '', slotLabel));
  await page.focus('#ask-TSK-01 input[aria-label="ค่าที่จะเพิ่ม"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type('#ask-TSK-01 input[aria-label="ค่าที่จะเพิ่ม"]', value);
  await clickButton(/^เพิ่ม$/, '#ask-TSK-01');
};
/** ช่องรหัสของหน้าคำนวณราคา — ล้างด้วยคีย์บอร์ด (คลิกสามครั้งไม่เลือกทั้งช่องเสมอ) แล้วกด Enter */
const typeCode = async (code: string) => {
  await page.focus('#pl-code');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type('#pl-code', code);
  await page.keyboard.press('Enter');
};
const openSheet = async () => {
  await page.goto(`${BASE}/admin.html#pricebook`, { waitUntil: 'networkidle0' });
  await wait(400);
  await page.evaluate((sheet: string) => {
    const row = [...document.querySelectorAll('tr')].find((tr) => (tr as HTMLElement).innerText.includes(sheet));
    ([...(row?.querySelectorAll('button') ?? [])].find((b) => b.innerText.trim() === 'เปิดชีต') as HTMLButtonElement | undefined)?.click();
  }, SHEET);
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 10000 }).catch(() => {});
  await wait(300);
};

for (const width of [1280, 390]) {
  console.log(`\n── ${width}px ──────────────────────────────────────────────`);
  await page.setViewport({ width, height: 900 });
  await page.evaluateOnNewDocument((t: string, u: string) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', u);
  }, token, JSON.stringify({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }));
  await openSheet();

  const boxes = await page.evaluate(() => [...document.querySelectorAll('[data-testid="ask-price"]')].map((x) => x.id));
  ok('กล่อง "ต้องขอราคาจากฝ่ายผลิต" มีเฉพาะ TS_-01 (TS_-01-0 ไม่เปลี่ยน)', boxes.length === 1 && boxes[0] === 'ask-TSK-01', boxes.join(','));
  const chips = await page.evaluate(() => [...document.querySelectorAll('#ask-TSK-01 button.rounded-full')].map((b) => (b as HTMLElement).innerText.replace(/\s+/g, ' ')));
  ok('ชิปตรงกับที่ /unread นับจากรหัสจริง', chips.length === foundHere.length, `จอ ${chips.length} · API ${foundHere.length}`);
  const hscroll0 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('ไม่เลื่อนซ้ายขวาทั้งหน้า', !hscroll0);

  // ชิปตัวแรกที่ยังไม่อยู่ในตาราง (ถ้ามี) → คอลัมน์/แถวส้ม
  const firstFree = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#ask-TSK-01 button.rounded-full')].find((x) => !(x as HTMLButtonElement).disabled) as HTMLElement | undefined;
    return b?.querySelector('b')?.textContent?.replace(/ mm$/, '') ?? null;
  });
  if (firstFree) {
    await page.evaluate(() => ([...document.querySelectorAll('#ask-TSK-01 button.rounded-full')].find((x) => !(x as HTMLButtonElement).disabled) as HTMLButtonElement).click());
    await wait(150);
    const chipNow = await page.evaluate((v: string) => [...document.querySelectorAll('#ask-TSK-01 button.rounded-full')].some((b) => b.querySelector('b')?.textContent?.replace(/ mm$/, '') === v && (b as HTMLButtonElement).disabled && (b as HTMLElement).innerText.includes('อยู่ในตารางแล้ว')), firstFree);
    ok(`กดชิป ${firstFree} → ชิปเปลี่ยนเป็น "อยู่ในตารางแล้ว" · นับเป็นการแก้ 1 รายการ`, chipNow && (await reviewCount()) >= 1, `${await reviewCount()}`);
    await clickButton(/^ย้อนการแก้$/);
  }

  // พิมพ์เอง: เกลียว (คอลัมน์) · หัววัด (แถว) · ขนาดแกน (อัตรา)
  await addOwn('ขนาดเกลียว', freeThread.toLowerCase());
  ok(`พิมพ์ "${freeThread.toLowerCase()}" → คอลัมน์ส้ม ${freeThread} (ชื่อตามรูปของตาราง)`, await orangeHead(freeThread));
  await addOwn('ชนิดเซนเซอร์', freeSensor.slice(2));
  ok(`พิมพ์ "${freeSensor.slice(2)}" → แถวส้ม ${freeSensor} · "ใช้กับรหัส" มี ${freeSensor}-01`, await orangeHead(freeSensor) && (await text()).includes(`${freeSensor}-01`));
  await addOwn('ขนาดแกน', freeD);
  const dRow = await page.evaluate((d: string) => [...document.querySelectorAll('section th')].some((th) => th.className.includes('orange') && (th as HTMLElement).innerText.startsWith(d)) &&
    !!document.querySelector(`input[placeholder="กรอกอัตรา"]`), freeD);
  ok(`พิมพ์ "${freeD}" → แถวขนาดแกนส้มพร้อมช่อง "กรอกอัตรา"`, dRow);
  await addOwn('ขนาดเกลียว', 'M 8 x 1 ขนาดยาวเกินไปมาก');
  ok('ค่าที่ไม่ใช่รูปแบบ → ขึ้นเตือน ไม่เพิ่ม', (await text()).includes('ไม่ใช่ขนาดเกลียวที่ใช้ได้'));

  // ช่องส้มว่าง = ขอราคา · กรอกช่องหนึ่งของคอลัมน์ใหม่
  const cellLabel = `TS_-01 ราคาตั้ง TSK/TSJ × ${freeThread}`;
  const hasCell = await page.$(`input[aria-label="${cellLabel}"]`);
  ok('ช่องของคอลัมน์ใหม่ว่างอยู่ = placeholder "ขอราคา"', !!hasCell && (await page.$eval(`input[aria-label="${cellLabel}"]`, (el) => (el as HTMLInputElement).placeholder)) === 'ขอราคา');
  if (hasCell) {
    await page.click(`input[aria-label="${cellLabel}"]`);
    await page.keyboard.type('250');
  }
  await clickButton(/^ตรวจก่อนบันทึก/);
  const modal = await text();
  ok('หน้าตรวจบอกว่าเพิ่มอะไร (คอลัมน์ · แถว · ขนาดแกนที่ยังไม่กรอกอัตรา) + ช่องที่กรอก',
    modal.includes(`เพิ่มขนาดเกลียว ${freeThread} (นอกแคตตาล็อก)`) && modal.includes(`เพิ่มชนิดเซนเซอร์ ${freeSensor} (นอกแคตตาล็อก)`)
      && modal.includes('ไม่ถูกเพิ่ม — ยังไม่ได้กรอกอัตรา') && modal.includes(`TSK/TSJ × ${freeThread}`));
  await page.screenshot({ path: join(shots, `${width}-review.png`), fullPage: true });
  await clickButton(/^กลับไปแก้ต่อ$/);
  await page.screenshot({ path: join(shots, `${width}-added.png`), fullPage: true });
  const hscroll1 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('หลังเพิ่มคอลัมน์/แถว — ไม่เลื่อนซ้ายขวาทั้งหน้า (ตารางเลื่อนในกรอบของมันเอง)', !hscroll1);

  // ✕: คอลัมน์ที่มีตัวเลขเอาออกได้ (ยังไม่บันทึก) · แถวหัววัด · ขนาดแกน
  const xs = async (what: string) => page.evaluate((w: string) => {
    const b = document.querySelector(`button[aria-label="เอา${w} ออก"]`) as HTMLButtonElement | null;
    b?.click();
    return !!b;
  }, what);
  await xs(`ขนาดเกลียว ${freeThread}`);
  await xs(`ชนิดเซนเซอร์ ${freeSensor}`);
  await xs(`ขนาดแกน ${freeD}`);
  await wait(150);
  const left = await reviewCount();
  let leftWhat = '';
  if (left) {
    await clickButton(/^ตรวจก่อนบันทึก/);
    leftWhat = (await text()).split('\n').filter((l) => l.includes('TS_-01')).slice(0, 4).join(' | ');
    await clickButton(/^กลับไปแก้ต่อ$/);
  }
  ok('✕ ทั้งสามช่องที่เพิ่ม → หายจากตาราง · ไม่มีอะไรรอบันทึก', !(await orangeHead(freeThread)) && !(await orangeHead(freeSensor)) && left === 0, `${left} ${leftWhat}`);
  await clickButton(/^ย้อนการแก้$/);

  // หน้าคำนวณราคา → ขอราคา + ปุ่มไปกล่อง
  await page.goto(`${BASE}/admin.html#pricing`, { waitUntil: 'networkidle0' });
  await wait(300);
  const code = `TSK-01(${freeThread})4.8+1M`;
  await typeCode(code);
  await page.waitForNetworkIdle({ idleTime: 300, timeout: 8000 }).catch(() => {});
  await wait(200);
  const calc = await text();
  ok(`คำนวณ ${code} → "ต้องขอราคาจากฝ่ายผลิต" + ปุ่มไปใส่ราคา`, calc.includes('ต้องขอราคาจากฝ่ายผลิต') && calc.includes(`สมุดราคา › ${SHEET} › ต้องขอราคา`));
  await page.screenshot({ path: join(shots, `${width}-calc-ask.png`), fullPage: true });
  await clickButton(new RegExp(`^สมุดราคา › ${SHEET.replace(/[+]/g, '\\+')} › ต้องขอราคา$`));
  await wait(900);
  const landed = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h1')].map((x) => (x as HTMLElement).innerText).find((t) => t.startsWith('ชีต')) ?? '';
    const box = document.getElementById('ask-TSK-01')?.getBoundingClientRect();
    return { h, inView: !!box && box.top < window.innerHeight && box.bottom > 0 };
  });
  ok('กดปุ่ม → เปิดชีตนั้นและเลื่อนมาที่กล่องขอราคา', landed.h.includes(SHEET) && landed.inView, `${landed.h} · ${landed.inView ? 'เห็นกล่อง' : 'ไม่เห็นกล่อง'}`);

  // ช่องขนาดเกลียวมี M8 x 1.25 / M10 x 1.5 (หมายเหตุใต้ตาราง)
  await page.goto(`${BASE}/admin.html#pricing`, { waitUntil: 'networkidle0' });
  await wait(300);
  await typeCode('TSK-01(M8x1.25)6+1M');
  await page.waitForNetworkIdle({ idleTime: 300, timeout: 8000 }).catch(() => {});
  await wait(200);
  const threadSel = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.text.includes('M8 x 1.25'))) as HTMLSelectElement | undefined;
    return sel ? { value: sel.value, has15: [...sel.options].some((o) => o.text.includes('M10 x 1.5')) } : null;
  });
  ok('รหัส (M8x1.25) ได้ช่องกรอก · ช่องเกลียวเลือก M8 x 1.25 · มี M10 x 1.5', threadSel?.value === 'M8x1.25' && !!threadSel.has15, JSON.stringify(threadSel));
}

ok('ไม่มี error ในหน้า', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\nผล: ผ่าน ${pass} · ตก ${fail} · ภาพหน้าจอ ${shots}`);
process.exit(fail ? 1 : 0);
