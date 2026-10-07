/* ─────────────────────────────────────────────────────────────────────────────
   กล่อง "ประวัติการส่งออก Odoo" — แบ่งหน้า · เลื่อนในกล่อง · ตัวกรอง 4 ช่องแถวเดียว
   (เจ้าของเคาะ mockup `odoo-export-history` 2026-09-29 · หัวไฟล์ frontend/src/admin/ExportHistoryModal.tsx)

   สิ่งที่พิสูจน์:
     ก. SQL (ในโปรเซสนี้ อ่านอย่างเดียว)
        · ไม่กรอง = ผลเท่าคำสั่งเดิมก่อนมีตัวกรองทุกแถวทุกช่อง (คำสั่งเดิมยกมาไว้ในไฟล์นี้เป็นตัวเทียบ)
        · ทุกตัวกรอง: ยอดรวม = นับเองจากตารางสด · ค้นเลขที่ใบได้ทั้งตัวเล็ก/ไม่มีขีด · `%` ไม่ใช่ wildcard
        · วันที่เป็น "วันไทย" ของ exported_at · หน้า 1 กับหน้า 2 ไม่ซ้ำกัน
     ข. หน้าจอ (ต้องมี API ของทรีนี้ที่ EH_PORT)
        · เปิดจากเมนู "ส่งออก Odoo" · กล่องสูงคงที่ 90% ของจอ · เริ่ม 10 ชุดต่อหน้า (ตัวเลือก 10/20/50/100)
        · รายการเลื่อนในกล่อง หน้าเว็บไม่เลื่อน · หัวคอลัมน์ติดบนสุดตอนเลื่อน · เปลี่ยนหน้าได้
        · ตัวกรอง 4 ช่อง + ปุ่มล้าง อยู่แถวเดียวที่ 1280 · กรองแล้วตรงกับ API · ไม่เจอ = ข้อความ "ไม่พบ…"
        · Esc ปิดได้ · คลิกนอกกล่องไม่ปิด (เจ้าของรับแล้ว) · 390px ไม่มีเลื่อนซ้ายขวา + เป็นการ์ด
        · ไม่มี error ในหน้า

   **ไม่เขียนฐานเลย** — ทุกคำขอที่ไม่ใช่ GET ถูกดักในเบราว์เซอร์แล้วตอบปลอม (กล่องเป็นแบบดูอย่างเดียวตั้งแต่ 2026-10-07)
   ต้องมี API ของทรีนี้รันอยู่ที่ EH_PORT (ค่าเริ่มต้น 3099) — **ห้ามใช้ 5180**:
     PORT=3099 PREVIEW_MODE=1 npx tsx index.ts
     npm run diag:export-history-ui            (EH_SHOTS=<โฟลเดอร์> = เก็บภาพหน้าจอไว้ดูด้วยตา)
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type HTTPRequest } from 'puppeteer';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { countExportBatches, getExportBatches, getExportBatchExporters } from '../../db/repositories.js';

const PORT = Number(process.env.EH_PORT ?? 3099);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.EH_SHOTS;
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail?: string) => {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? GREEN + '✓' : RED + '✗'}${RESET}  ${label}${detail ? `${DIM}  —  ${detail}${RESET}` : ''}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const thaiDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d);

if (PORT === 5180) {
  console.error('ไม่รันกับ 5180 — พอร์ตนั้นเป็นพรีวิวร่วมที่เจ้าของเปิด/ปิดเอง');
  process.exit(1);
}

await pool.query('SET statement_timeout = 15000');

/* ── ก. SQL ─────────────────────────────────────────────────────────────── */
console.log('── SQL ─────────────────────────────────────────────────');
// คำสั่งเดิมก่อนมีตัวกรอง (ถึง ee6282f) — ตัวเทียบว่า "ไม่กรอง" ยังได้ผลเดิมทุกไบต์
const BEFORE = `SELECT b.id, b.exported_at, b.exported_by_id, b.exported_by_username, b.format,
                       b.quotation_count, b.row_count, b.filters,
                       COUNT(l.id) FILTER (WHERE l.reverted_at IS NULL)::int AS active_count
                  FROM quotation_export_batches b
                  LEFT JOIN quotation_export_log l ON l.batch_id = b.id
                 GROUP BY b.id
                 ORDER BY b.exported_at DESC
                 LIMIT $1 OFFSET $2`;
const all = (await pool.query(BEFORE, [100000, 0])).rows;
{
  const now = await getExportBatches(100, 0);
  ok('ไม่กรอง = ผลเท่าคำสั่งเดิมทุกแถวทุกช่อง', JSON.stringify(now) === JSON.stringify(all.slice(0, 100)), `${now.length} แถว`);
  ok('ยอดรวมไม่กรอง = จำนวนแถวทั้งตาราง', (await countExportBatches()) === all.length, `${all.length} ชุด`);
  const exps = await getExportBatchExporters();
  const truth = [...new Set(all.map((r) => r.exported_by_username).filter(Boolean))];
  ok('ตัวเลือกผู้ส่งออก = คนที่มีในตารางจริง ไม่ขาดไม่เกิน', exps.length === truth.length && truth.every((u) => exps.includes(u)), exps.join(' · '));
  for (const company of ['QP', 'QT']) {
    const rows = await getExportBatches(100000, 0, { company });
    ok(`บริษัท ${company}: ยอด = นับเอง และทุกแถวเป็น ${company}`,
      (await countExportBatches({ company })) === all.filter((r) => r.filters?.company === company).length && rows.every((r) => r.filters?.company === company),
      `${rows.length} ชุด`);
  }
  for (const u of exps) {
    ok(`ผู้ส่งออก ${u}: ยอด = นับเอง`, (await countExportBatches({ exportedBy: u })) === all.filter((r) => r.exported_by_username === u).length);
  }
  if (all.length) {
    const day = thaiDay(all[Math.min(5, all.length - 1)].exported_at);
    ok(`วันเดียว ${day}: ยอด = นับเองตามวันไทย`,
      (await countExportBatches({ dateFrom: day, dateTo: day })) === all.filter((r) => thaiDay(r.exported_at) === day).length);
    ok(`ถึงวันที่ ${day}: ยอด = นับเองตามวันไทย`,
      (await countExportBatches({ dateTo: day })) === all.filter((r) => thaiDay(r.exported_at) <= day).length);
  }
  const { rows: [sample] } = await pool.query(
    `SELECT quotation_no FROM quotation_export_log WHERE quotation_no LIKE '%-%' ORDER BY id DESC LIMIT 1`);
  if (sample) {
    const no: string = sample.quotation_no;
    const { rows: truthB } = await pool.query(`SELECT DISTINCT batch_id FROM quotation_export_log WHERE quotation_no = $1`, [no]);
    for (const q of [no, no.toLowerCase(), no.replace(/-/g, '')]) {
      const rows = await getExportBatches(100, 0, { quotationNo: q });
      ok(`ค้น "${q}": ได้ทุกชุดที่มีใบนั้น + ป้ายชี้เลขนั้น`,
        rows.length === truthB.length && rows.every((r) => truthB.some((t) => t.batch_id === r.id) && r.matched_no === no),
        `${rows.length} ชุด`);
    }
  } else {
    ok('มีเลขที่ใบใน quotation_export_log ให้ลองค้น', false, 'ตารางว่าง — ข้อค้นเลขที่ใบตรวจไม่ได้');
  }
  ok('คำค้น "%" ไม่ถูกตีเป็น wildcard', (await countExportBatches({ quotationNo: '%' })) === 0);
  const p1 = await getExportBatches(10, 0), p2 = await getExportBatches(10, 10);
  ok('หน้า 1 กับหน้า 2 ไม่มีชุดซ้ำกัน', p1.every((a) => !p2.some((b) => b.id === a.id)));
}

const { rows: admins } = await pool.query(`SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`);
const { rows: [sampleNo] } = await pool.query(`SELECT quotation_no FROM quotation_export_log WHERE quotation_no IS NOT NULL ORDER BY id DESC LIMIT 1`);
await pool.end();

/* ── ข. หน้าจอ ─────────────────────────────────────────────────────────── */
console.log('\n── หน้าจอ ──────────────────────────────────────────────');
try {
  await fetch(`${BASE}/admin.html`);
} catch {
  console.error(`ไม่มีเซิร์ฟเวอร์ที่ ${BASE} — เปิดด้วย  PORT=${PORT} PREVIEW_MODE=1 npx tsx index.ts  ในทรีของงานนี้ก่อน`);
  process.exit(1);
}
if (!admins.length) throw new Error('ไม่มีบัญชี admin บนฐานนี้');
const admin = admins[0];
const token = jwt.sign({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }, getJwtSecret(), { expiresIn: '1h' });
const apiTotal = async (qs = '') => (await (await fetch(`${BASE}/api/admin/quotations/export-batches?limit=1${qs}`, {
  headers: { Authorization: `Bearer ${token}` },
})).json()).total as number;

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e instanceof Error ? e.message : String(e)));
page.on('dialog', (d) => void d.dismiss());
let writes = 0;
await page.setRequestInterception(true);
page.on('request', (r: HTTPRequest) => {
  if (r.method() !== 'GET' && r.url().includes('/api/')) {
    writes++;
    return void r.respond({ status: 200, contentType: 'application/json', body: '{}' });
  }
  void r.continue();
});
await page.evaluateOnNewDocument((t: string, u: string) => {
  sessionStorage.setItem('admin_token', t);
  sessionStorage.setItem('admin_user', u);
}, token, JSON.stringify({ id: admin.id, username: admin.username, name: admin.name, role: admin.role }));

const settle = async () => {
  await wait(400); // ตัวกรองหน่วง 300 ms ก่อนยิง
  await page.waitForNetworkIdle({ idleTime: 250, timeout: 15000 }).catch(() => {});
  await wait(100);
};
const D = '[role="dialog"]';
const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const clickText = async (text: string) => page.evaluate((t: string) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim().includes(t) && (x as HTMLElement).offsetParent) as HTMLButtonElement | undefined;
  b?.click();
  return !!b;
}, text);
const openHistory = async () => {
  // มือถือซ่อนคำ "ส่งออก Odoo" เหลือแต่ไอคอน ⇒ หาปุ่มจากไอคอน Excel + ลูกศรลงแทน
  if (!(await clickText('ส่งออก Odoo'))) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        x.querySelector('svg[class*="file-spreadsheet"]') && x.querySelector('svg[class*="chevron-down"]') && (x as HTMLElement).offsetParent) as HTMLButtonElement | undefined;
      b?.click();
    });
  }
  await wait(150);
  const done = await clickText('ประวัติการส่งออก');
  await settle();
  return done;
};
const dialogOpen = () => page.$(D).then((e) => !!e);
const rangeText = () => page.$$eval(`${D} span`, (els) => els.map((e) => (e as HTMLElement).innerText).find((t) => /^\d+–\d+ จาก/.test(t)) ?? '');
const tableRows = () => page.$$eval(`${D} table tbody tr`, (trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td as HTMLElement).innerText.trim())));
const setSelect = async (label: string, value: string) => {
  await page.select(`${D} select[aria-label="${label}"]`, value);
  await settle();
};
const typeSearch = async (text: string) => {
  const sel = `${D} input[placeholder="ค้นเลขที่ใบ"]`;
  await page.click(sel);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (text) await page.type(sel, text);
  await settle();
};
/** ช่องวันที่เป็น native input โปร่งใสทับ (DateInput) — ตั้งค่าผ่าน setter ของ DOM ให้ React เห็น */
const setDate = async (label: string, iso: string) => {
  await page.evaluate((l: string, v: string) => {
    const el = document.querySelector(`[role="dialog"] input[aria-label="${l}"]`) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, label, iso);
  await settle();
};

await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/admin.html#quotations`, { waitUntil: 'networkidle0' });
await wait(300);

const total = await apiTotal();
ok('เปิดกล่องจากเมนู "ส่งออก Odoo" ได้', await openHistory() && await dialogOpen());
await shot('eh-1280');
{
  const g = await page.evaluate((sel: string) => {
    const d = document.querySelector(sel)!.getBoundingClientRect();
    return { h: d.height, vh: window.innerHeight, bottom: d.bottom };
  }, D);
  ok('กล่องสูงคงที่ 90% ของจอ', Math.abs(g.h - g.vh * 0.9) <= 2, `${Math.round(g.h)} / ${g.vh}px`);
  ok('เริ่มที่ 10 ชุดต่อหน้า', (await tableRows()).length === Math.min(10, total), `${(await tableRows()).length} แถว`);
  ok('แถบแบ่งหน้าบอกช่วงถูก', (await rangeText()) === `1–${Math.min(10, total)} จาก ${total.toLocaleString()} ชุด`, await rangeText());
  const opts = await page.$$eval(`${D} select[aria-label="จำนวนต่อหน้า"] option`, (os) => os.map((o) => (o as HTMLOptionElement).value));
  ok('ตัวเลือกจำนวนต่อหน้า 10 · 20 · 50 · 100', opts.join(',') === '10,20,50,100', opts.join(','));

  // ตัวกรองแถวเดียว: ทุกช่องในกริดอยู่ระดับเดียวกัน
  const tops = await page.evaluate((sel: string) => {
    const grid = document.querySelector(`${sel} input[placeholder="ค้นเลขที่ใบ"]`)!.closest('.grid')!;
    return [...grid.children].map((c) => Math.round(c.getBoundingClientRect().top));
  }, D);
  ok('ตัวกรอง 4 ช่อง + ปุ่มล้าง อยู่แถวเดียว (1280)', tops.length === 5 && new Set(tops).size === 1, `top = ${[...new Set(tops)].join(',')}`);
  ok('ปุ่มล้างจางไว้ตอนยังไม่กรอง', await page.$eval(`${D} button[aria-label="ล้างตัวกรองทั้งหมด"]`, (b) => (b as HTMLButtonElement).disabled));
}

console.log('\n── เลื่อน / แบ่งหน้า ─────────────────────────────────');
{
  const firstP1 = (await tableRows())[0]?.[0];
  await page.click(`${D} button[aria-label="หน้าถัดไป"]`);
  await settle();
  if (total > 10) {
    ok('หน้า 2 เป็นชุดถัดไป', (await rangeText()).startsWith('11–') && (await tableRows())[0]?.[0] !== firstP1, await rangeText());
  }
  await setSelect('จำนวนต่อหน้า', '50');
  ok('เปลี่ยนจำนวนต่อหน้าแล้วกลับหน้า 1', (await rangeText()).startsWith('1–'), await rangeText());
  await page.evaluate((sel: string) => { (document.querySelector(`${sel} .overflow-y-auto`) as HTMLElement).scrollTop = 400; }, D);
  await wait(250);
  const s = await page.evaluate((sel: string) => {
    const box = document.querySelector(`${sel} .overflow-y-auto`) as HTMLElement;
    return {
      sh: box.scrollHeight, ch: box.clientHeight, st: box.scrollTop,
      thTop: Math.round(box.querySelector('th')!.getBoundingClientRect().top),
      row1Top: Math.round(box.querySelector('tbody tr')!.getBoundingClientRect().top),
      boxTop: Math.round(box.getBoundingClientRect().top), winScroll: window.scrollY,
    };
  }, D);
  if (total > 12) {
    ok('รายการยาวเลื่อนในกล่อง (มี scrollbar ในกล่อง)', s.sh > s.ch && s.st > 0, `${s.sh} > ${s.ch}px · เลื่อนไป ${s.st}px`);
    // ต้องพิสูจน์ว่าเลื่อนจริงก่อน (แถวแรกขึ้นไปพ้นกล่องแล้ว) ไม่งั้น "หัวอยู่บนสุด" ก็จริงตั้งแต่ยังไม่เลื่อน
    ok('หัวคอลัมน์ติดอยู่บนสุดของกล่องตอนเลื่อน', s.row1Top < s.boxTop && Math.abs(s.thTop - s.boxTop) <= 1,
      `th ${s.thTop} · กล่อง ${s.boxTop} · แถวแรก ${s.row1Top}`);
  }
  ok('หน้าเว็บด้านหลังไม่เลื่อน', s.winScroll === 0);
  await shot('eh-1280-scrolled');
  await setSelect('จำนวนต่อหน้า', '10');
}

console.log('\n── ตัวกรอง ───────────────────────────────────────────');
{
  await setSelect('บริษัท', 'QT');
  const rows = await tableRows();
  const qt = await apiTotal('&company=QT');
  ok('บริษัท QT: ทุกแถวเป็น QT และยอดตรง API', rows.every((r) => r[2] === 'QT') && (await rangeText()).endsWith(`จาก ${qt.toLocaleString()} ชุด`), await rangeText());
  ok('มีตัวกรองแล้วปุ่มล้างกดได้', !(await page.$eval(`${D} button[aria-label="ล้างตัวกรองทั้งหมด"]`, (b) => (b as HTMLButtonElement).disabled)));
  await page.click(`${D} button[aria-label="ล้างตัวกรองทั้งหมด"]`);
  await settle();
  ok('ล้างตัวกรองแล้วกลับเป็นทั้งหมด', (await rangeText()).endsWith(`จาก ${total.toLocaleString()} ชุด`), await rangeText());

  const exporters = await page.$$eval(`${D} select[aria-label="ผู้ส่งออก"] option`, (os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  if (exporters.length) {
    const u = exporters[exporters.length - 1];
    await setSelect('ผู้ส่งออก', u);
    const rows2 = await tableRows();
    ok(`ผู้ส่งออก ${u}: ทุกแถวเป็นคนนั้น`, rows2.length > 0 && rows2.every((r) => r[1] === u), `${rows2.length} แถว`);
    await setSelect('ผู้ส่งออก', '');
  }

  if (sampleNo?.quotation_no) {
    await typeSearch(sampleNo.quotation_no.replace(/-/g, '').toLowerCase());
    const chips = await page.$$eval(`${D} table tbody tr td:first-child span`, (els) => els.map((e) => (e as HTMLElement).innerText));
    ok('ค้นเลขที่ใบ (ตัวเล็ก ไม่มีขีด) เจอชุด + ป้ายเลขที่ใบ', chips.length > 0 && chips.every((c) => c.startsWith(sampleNo.quotation_no)), chips.join(' · '));
    await shot('eh-1280-search');
  }
  await typeSearch('ไม่มีเลขนี้แน่นอน');
  ok('ไม่เจอ = บอกว่าไม่พบตามตัวกรอง', (await page.$eval(D, (e) => (e as HTMLElement).innerText)).includes('ไม่พบชุดที่ตรงกับตัวกรอง'));
  await shot('eh-1280-empty');
  const g = await page.evaluate((sel: string) => document.querySelector(sel)!.getBoundingClientRect().height, D);
  ok('กรองจนว่างแล้วกล่องไม่หด', Math.abs(g - 900 * 0.9) <= 2, `${Math.round(g)}px`);
  await typeSearch('');

  if (total) {
    const firstTime = (await tableRows())[0]?.[0] ?? '';
    const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(firstTime);
    if (m) {
      const iso = `${Number(m[3]) - 543}-${m[2]}-${m[1]}`;
      await setDate('ส่งออกตั้งแต่วันที่', iso);
      await setDate('ส่งออกถึงวันที่', iso);
      const n = await apiTotal(`&dateFrom=${iso}&dateTo=${iso}`);
      const rows3 = await tableRows();
      ok(`ช่วงวันที่ ${iso}: ยอดตรง API และทุกแถวเป็นวันนั้น`,
        (await rangeText()).endsWith(`จาก ${n.toLocaleString()} ชุด`) && rows3.every((r) => r[0].startsWith(`${m[1]}/${m[2]}/${m[3]}`)), await rangeText());
      await page.click(`${D} button[aria-label="ล้างตัวกรองทั้งหมด"]`);
      await settle();
    }
  }
}

console.log('\n── ปิดกล่อง ──────────────────────────────────────────');
{
  await page.mouse.click(12, 12); // ฉากหลังมุมซ้ายบน
  await wait(200);
  ok('คลิกนอกกล่องไม่ปิด', await dialogOpen());
  await page.keyboard.press('Escape');
  await wait(200);
  ok('Esc ปิดกล่อง', !(await dialogOpen()));
}

console.log('\n── มือถือ 390px ─────────────────────────────────────');
{
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/admin.html#quotations`, { waitUntil: 'networkidle0' });
  await wait(300);
  await openHistory();
  await shot('eh-390');
  const m = await page.evaluate((sel: string) => {
    const d = document.querySelector(sel)!;
    const table = d.querySelector('table') as HTMLElement | null;
    return {
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      dialogOverflow: (d as HTMLElement).scrollWidth - (d as HTMLElement).clientWidth,
      tableHidden: !table || getComputedStyle(table).display === 'none',
      cards: d.querySelectorAll('.sm\\:hidden > div').length,
    };
  }, D);
  ok('390px: หน้าเว็บไม่มีเลื่อนซ้ายขวา', m.overflowX <= 0, `${m.overflowX}px`);
  ok('390px: กล่องไม่ล้นแนวนอน', m.dialogOverflow <= 0, `${m.dialogOverflow}px`);
  ok('390px: ตารางซ่อน เหลือการ์ด', m.tableHidden && m.cards === Math.min(10, total), `${m.cards} การ์ด`);
}

ok('ไม่มี error ในหน้า', errors.length === 0, errors.slice(0, 3).join(' | '));
ok('ไม่มีคำขอเขียนหลุดออกจากเบราว์เซอร์', writes === 0, `${writes} คำขอ`);
await browser.close();

console.log(`\nสรุป: ${pass} ผ่าน · ${fail} ล้ม`);
process.exit(fail ? 1 : 0);
