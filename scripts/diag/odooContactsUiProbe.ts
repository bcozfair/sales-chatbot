/* ─────────────────────────────────────────────────────────────────────────────
   เปิดหน้า "ผู้ติดต่อเพิ่มเอง" จริงแล้วกดจริง — ก้อน I4 ของ docs/plan-local-contacts.md

   ทำไมต้องมีด่านนี้ ทั้งที่ `build` ผ่านแล้ว: ปุ่มที่อ้างฟังก์ชันที่ไม่เคยถูกเขียน และบรรทัด
   import ที่หาย **build ผ่านทั้งคู่** (AGENTS.md A9) ⇒ "เสร็จ" แปลว่าเปิดดูที่ความกว้างจริง

   ครอบทั้งวงของหน้านี้: เมนู + ตัวเลขค้าง → ตาราง → ตัวกรองสถานะ → ป้าย 🔴 ชื่อไม่ตรง
   → แก้ไขผ่านจอ → ลบผ่านจอ → ไม่เหลือแถวค้าง · ทำซ้ำที่ 1280px และ 390px
   (390px ต้องเป็น **การ์ด** ไม่ใช่ตารางที่ย่อลง — docs/design.md)

   ต้องมี API รันอยู่ที่พอร์ตที่ส่งมาทาง LC_PORT (ค่าเริ่มต้น 3099)

   ⚠️ `/admin` ตอบ 404 เมื่อรันจาก worktree (res.sendFile ปฏิเสธ path ที่มีเซกเมนต์ขึ้นต้นด้วยจุด)
      ⇒ เข้าทาง `/admin.html` ตรง ๆ ซึ่ง static middleware เสิร์ฟให้เหมือนกันทุกไบต์
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type ElementHandle } from 'puppeteer';
import jwt from 'jsonwebtoken';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';

const PORT = process.env.LC_PORT || '3099';
const BASE = `http://localhost:${PORT}`;
const SHOTS = fileURLToPath(new URL('../../mockup/shots/', import.meta.url));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

mkdirSync(SHOTS, { recursive: true });

const { rows: admins } = await pool.query(
  `SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`
);
if (admins.length === 0) throw new Error('ไม่มีบัญชี admin บนฐานนี้');
const admin = admins[0];
const token = jwt.sign(
  { id: admin.id, username: admin.username, name: admin.name, role: admin.role },
  getJwtSecret(),
  { expiresIn: '1h' }
);
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
console.log(`ใช้บัญชี ${admin.username} (${admin.role})`);

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

/**
 * บริษัทที่ใช้ทดสอบ — เลือกจากฐานจริง ไม่ใช่ id ที่ฝังไว้
 * ต้องเป็นบริษัทที่มีผู้ติดต่อของ Odoo อยู่แล้วอย่างน้อยหนึ่งคน เพราะเคส "ชื่อไม่ตรง"
 * ต้องมีชื่อให้ชน (เกณฑ์เดียวกับ `similar_odoo_name` ใน db/localContactsRepo.ts)
 */
const { rows: hosts } = await pool.query(
  `SELECT company_id, contact_name
     FROM public.customers_data_view
    WHERE source <> 'local' AND contact_id > 0
      AND contact_name IS NOT NULL AND btrim(contact_name) <> ''
      AND length(btrim(contact_name)) BETWEEN 6 AND 40
    ORDER BY company_id
    LIMIT 1`
);
if (hosts.length === 0) throw new Error('ฐานนี้ไม่มีผู้ติดต่อของ Odoo ให้ยืมบริษัทมาทดสอบ');
const companyId = Number(hosts[0].company_id);
const odooName: string = String(hosts[0].contact_name);

/** ชื่อทดสอบสองคน: คนแรกชื่อไม่ซ้ำใคร (= "รอนำเข้า") · คนที่สองคล้ายชื่อของ Odoo (= "ชื่อไม่ตรง") */
const stamp = Date.now();
const plainName = `I4 ทดสอบ รอคีย์ ${stamp}`;
// เติม "คุณ" หน้าชื่อจริงของ Odoo — ชั้น normalized-equal จับได้เสมอ ไม่ต้องพึ่งค่า similarity
const mismatchName = `คุณ${odooName.trim()}`;

async function seed(name: string): Promise<number | null> {
  const res = await fetch(`${BASE}/api/admin/webquote/contacts`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ company_id: companyId, contact_name: name }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return Number(body?.contact?.contact_id ?? body?.contact_id ?? 0) || null;
}

/**
 * เก็บกวาดของค้างจากรอบที่ล้มกลางทาง **ก่อนเริ่ม** ไม่ใช่แค่ตอนจบ
 *
 * เหตุผล: ชื่อเคสชื่อไม่ตรงถูกคำนวณจากข้อมูลจริง ⇒ ทุกรอบได้ชื่อเดิมเป๊ะ ถ้ารอบก่อนล้มก่อนถึง
 * ขั้นลบ รอบถัดไปจะได้ 409 ตั้งแต่ขั้นเตรียมข้อมูลแล้วล้มทั้งด่านโดยที่โค้ดไม่ได้ผิดอะไรเลย
 * (เกิดจริง 2026-09-21) · ลบผ่าน endpoint จริงเพราะแถวใน customers_data_view ต้องหายด้วย
 */
const { rows: strays } = await pool.query(
  `SELECT contact_id FROM public.local_contacts
    WHERE contact_name LIKE 'I4 ทดสอบ %' OR btrim(contact_name) = btrim($1)`,
  [mismatchName]
);
for (const r of strays) {
  const res = await fetch(`${BASE}/api/admin/webquote/contacts/${r.contact_id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`  · เก็บกวาดของค้างจากรอบก่อน ${r.contact_id} · HTTP ${res.status}`);
}

const plainId = await seed(plainName);
const mismatchId = await seed(mismatchName);
ok('เตรียมข้อมูล: เพิ่มผู้ติดต่อทดสอบผ่าน endpoint จริงได้ 2 คน',
  plainId !== null && mismatchId !== null, `${plainId} · ${mismatchId}`);

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => { fail++; console.log('  ✗ หน้าพัง:', (e as Error)?.message ?? String(e)); });
page.on('console', (m) => { if (m.type() === 'error') console.log('  · console.error:', m.text()); });

await page.evaluateOnNewDocument(
  (t, u) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', u);
  },
  token,
  JSON.stringify({ id: admin.id, username: admin.username, name: admin.name, role: admin.role })
);

async function clickByText(sel: string, text: string): Promise<boolean> {
  const handles: ElementHandle<Element>[] = await page.$$(sel);
  for (const h of handles) {
    const t = (await page.evaluate((el: Element) => el.textContent || '', h)).trim();
    if (t.includes(text)) {
      await page.evaluate((el: Element) => el.scrollIntoView({ block: 'center' }), h);
      await wait(200);
      await h.click();
      return true;
    }
  }
  return false;
}

/**
 * คลิกปุ่มที่ aria-label ตรงเป๊ะ และ **มองเห็นจริง**
 *
 * ⚠️ สองเงื่อนไขนี้จำเป็นทั้งคู่ และข้อหลังคือเรื่องความปลอดภัย ไม่ใช่ความเนี้ยบ:
 *    - หน้านี้วาดปุ่มชุดเดียวกันสองชุด (ตาราง + การ์ด) โดยซ่อนชุดหนึ่งด้วย CSS
 *      ⇒ ที่ 390px ปุ่มชุดแรกใน DOM คือปุ่มของตารางที่ถูกซ่อน กดไม่ได้
 *    - และหน้านี้แสดง **ผู้ติดต่อจริงของร้านที่ค้างอยู่** ปนอยู่กับแถวของด่าน และเรียงตาม
 *      วันที่เพิ่ม ⇒ "แถวแรกที่มองเห็น" คือแถวของร้าน ไม่ใช่ของด่าน
 *      (เกิดจริง 2026-09-21: ด่านรอบที่ใช้ "แถวแรก" ไปเขียนเบอร์ทับผู้ติดต่อจริงของร้าน)
 */
async function clickExact(label: string): Promise<boolean> {
  const handles: ElementHandle<Element>[] = await page.$$('button[aria-label]');
  for (const h of handles) {
    const got = await page.evaluate((el: Element) => ({
      label: el.getAttribute('aria-label') || '',
      seen: (el as HTMLElement).offsetParent !== null,
      off: (el as HTMLButtonElement).disabled,
    }), h);
    if (got.label !== label || !got.seen || got.off) continue;
    await page.evaluate((el: Element) => el.scrollIntoView({ block: 'center' }), h);
    await wait(250);
    await h.click();
    return true;
  }
  return false;
}

/** ข้อความทั้งหน้า — ใช้ถามว่า "ชื่อนี้โผล่อยู่ไหม" โดยไม่ผูกกับ selector ของแถว */
const bodyText = (): Promise<string> =>
  page.evaluate(() => document.body.innerText || '');

for (const width of [1280, 390]) {
  console.log(`\n${width}px`);
  await page.setViewport({ width, height: 1000 });
  // ?w= ไม่ได้ถูกอ่านโดยแอป — มีไว้ให้ URL ต่างกันจริง ไม่งั้นรอบสองเป็น same-document
  // navigation แล้วหน้าไม่รีโหลด (สถานะของรอบแรกค้างมา — เจอมาแล้วกับ diag:lc-ui)
  await page.goto(`${BASE}/admin.html?w=${width}#odoocontacts`, { waitUntil: 'networkidle2' });
  await wait(2200);

  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('หน้าไม่ล้นแนวนอน', over <= 1, `${over}px`);

  const txt = await bodyText();
  ok('หน้าเรนเดอร์และขึ้นหัวเรื่องของตัวเอง', txt.includes('ผู้ติดต่อที่ต้องคีย์เข้า Odoo'));
  ok('  คนที่เพิ่งเพิ่มโผล่ในรายการ', txt.includes(plainName), plainName);
  ok('  ป้าย "รอนำเข้า" ขึ้นจริง (ไม่ใช่ "รอคีย์"/"ค้างนาน" ของเดิม)', txt.includes('รอนำเข้า'));
  ok('  ไม่มีคำว่า "ค้างนาน" หลงเหลือบนจอ', !txt.includes('ค้างนาน'));

  // ── ป้าย 🔴 ต้องชี้ชื่อที่ชนให้เห็น ไม่ใช่แค่บอกว่าผิด ──────────────────
  ok('เคสชื่อไม่ตรงขึ้นป้ายของตัวเอง', txt.includes('ชื่อไม่ตรง'));
  ok('  และบอกชื่อใน Odoo ที่ชนกันให้ดูตรง ๆ', txt.includes(odooName.trim()), odooName.trim().slice(0, 30));

  // ── ตาราง/การ์ด ต้องสลับตามความกว้าง ไม่ใช่ตารางเดียวที่ย่อลง ─────────
  // ⚠️ ห้ามประกาศฟังก์ชันย่อยใน page.evaluate — esbuild ของ tsx ห่อด้วย __name()
  //    ซึ่งไม่มีในเบราว์เซอร์ ⇒ ReferenceError กลางด่าน (เจอจริง 2026-09-21)
  const shape = await page.evaluate(() => ({
    table: (() => {
      const el = document.querySelector('table') as HTMLElement | null;
      return !!el && el.offsetParent !== null;
    })(),
    cards: document.querySelectorAll('[aria-label^="แก้ไข "]').length,
  }));
  ok(width >= 640 ? '  จอทำงานแสดงเป็นตาราง' : '  มือถือไม่แสดงตาราง (ใช้การ์ดแทน)',
    width >= 640 ? shape.table : !shape.table);
  ok('  ปุ่มแก้ไขมีครบทุกแถวที่แก้ได้', shape.cards >= 2, `${shape.cards} ปุ่ม`);

  // ── ตัวเลขข้างเมนู (มีเฉพาะตอนแถบกางอยู่ = จอกว้าง) ──────────────────
  if (width >= 1280) {
    const { rows: cnt } = await pool.query(
      'SELECT count(*)::int AS n FROM public.local_contacts WHERE odoo_matched_at IS NULL');
    const menu = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((x) => (x.textContent || '').includes('ผู้ติดต่อเพิ่มเอง'));
      return b ? (b.textContent || '').trim() : '(ไม่เจอเมนู)';
    });
    ok('มีเมนู "ผู้ติดต่อเพิ่มเอง" ในแถบซ้าย', !menu.startsWith('(ไม่เจอ'), menu.slice(0, 40));
    ok('  ตัวเลขข้างเมนูตรงกับจำนวนที่ยังไม่เข้า Odoo ในฐานจริง',
      menu.includes(String(cnt[0].n)), `จอ="${menu}" ฐาน=${cnt[0].n}`);
  }

  await page.screenshot({ path: `${SHOTS}/oc-app-${width}.png`, fullPage: false });

  // ── ตัวกรองสถานะ — เลือก "ชื่อไม่ตรง" แล้วคนที่รอคีย์ต้องหายไป ────────
  const sel = await page.$('[aria-label="สถานะ"]');
  ok('เจอช่องเลือกสถานะ', !!sel);
  if (sel) {
    await page.select('[aria-label="สถานะ"]', 'name_mismatch');
    await wait(1400);
    const t2 = await bodyText();
    ok('  กรอง "ชื่อไม่ตรง" แล้วเหลือเฉพาะกลุ่มนั้น', !t2.includes(plainName));
    await page.select('[aria-label="สถานะ"]', 'not_matched');
    await wait(1400);
    const t3 = await bodyText();
    ok('  กลับมาค่าตั้งต้นแล้วเห็นทั้งสองกลุ่มอีกครั้ง',
      t3.includes(plainName) && t3.includes('ชื่อไม่ตรง'));
  }
}

// ── แก้ไขผ่านจอจริง (รอบเดียวพอ — กล่องเดียวกับหน้าขอใบเสนอราคา) ──────────
const newPhone = '088-777-6655';
console.log('');
if (await clickExact(`แก้ไข ${plainName}`)) {
  await wait(1400);
  // ประตูชั้นสอง: ชื่อในกล่องต้องเป็นคนของเรา — ไม่งั้นหยุด ไม่พิมพ์อะไรทั้งสิ้น
  const opened = await page.evaluate(() => {
    const el = document.querySelector('#lc-name') as HTMLInputElement | null;
    return el ? el.value : '(ไม่เจอช่องชื่อ)';
  });
  ok('กดแก้ไขแล้วกล่องเปิดที่แถวของด่านเอง', opened === plainName, opened.slice(0, 40));
  if (opened === plainName) {
    await page.type('#lc-phone', newPhone);
    await wait(200);
    await clickByText('[role="dialog"] button', 'บันทึก');
    await wait(2500);
    ok('  บันทึกแล้วกล่องปิดเอง', (await page.$('[role="dialog"]')) === null);
    const { rows: after } = await pool.query(
      'SELECT contact_phone FROM public.local_contacts WHERE contact_id = $1', [plainId]);
    ok('  เบอร์ที่แก้ลงตารางจริง', after[0]?.contact_phone === newPhone, String(after[0]?.contact_phone));
    const { rows: dir } = await pool.query(
      'SELECT contact_phone FROM public.customers_data_view WHERE contact_id = $1', [plainId]);
    ok('  และแถวใน customers_data_view ตามไปด้วย (ไม่ต้องรอ rebuild)',
      dir[0]?.contact_phone === newPhone, String(dir[0]?.contact_phone));
  }
} else {
  ok('กดปุ่มแก้ไขของแถวตัวเองได้', false);
}

// ── ลบผ่านจอจริง ─────────────────────────────────────────────────────────
if (await clickExact(`ลบ ${plainName}`)) {
  await wait(1200);
  const delOpen = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return d ? (d.textContent || '').includes('ลบผู้ติดต่อที่เพิ่มเอง') : false;
  });
  ok('กดลบแล้วกล่องยืนยันเปิดขึ้นมา', delOpen);
  await clickByText('[role="dialog"] button', 'ลบ');
  await wait(2500);
  ok('  ยืนยันแล้วกล่องปิดเอง', (await page.$('[role="dialog"]')) === null);
  const { rows: gone } = await pool.query(
    'SELECT count(*)::int AS n FROM public.local_contacts WHERE contact_id = $1', [plainId]);
  ok('  แถวหายจากตารางจริงแล้ว', gone[0].n === 0, `เหลือ ${gone[0].n} แถว`);
} else {
  ok('กดปุ่มลบของแถวตัวเองได้', false);
}

await browser.close();

// ── เก็บกวาด — ยิง endpoint จริง ไม่ใช่ DELETE ตรงในฐาน เพราะแถวใน view ต้องหายด้วย ──
for (const id of [plainId, mismatchId]) {
  if (id === null) continue;
  const res = await fetch(`${BASE}/api/admin/webquote/contacts/${id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });
  // 404 = ถูกลบไปแล้วจากหน้าจอในขั้นก่อนหน้า ซึ่งเป็นผลที่ต้องการ
  if (res.status !== 200 && res.status !== 204 && res.status !== 404) {
    fail++;
    console.log(`  ✗ เก็บกวาด ${id} ไม่สำเร็จ · HTTP ${res.status}`);
  }
}
// นับจาก **contact_id ที่ด่านสร้างเองเท่านั้น** — การนับด้วย LIKE จะกวาดไปโดนแถวของร้านได้
const { rows: left } = await pool.query(
  `SELECT (SELECT count(*)::int FROM public.local_contacts      WHERE contact_id = ANY($1::bigint[])) AS t,
          (SELECT count(*)::int FROM public.customers_data_view WHERE contact_id = ANY($1::bigint[])) AS v`,
  [[plainId, mismatchId].filter((x): x is number => x !== null)]);
ok('ไม่เหลือผู้ติดต่อทดสอบในฐานเลย', left[0].t === 0 && left[0].v === 0,
  `local_contacts=${left[0].t} · view=${left[0].v}`);

await pool.end();
console.log(fail === 0 ? '\nผ่านทั้งหมด' : `\nล้ม ${fail} ข้อ`);
process.exit(fail > 0 ? 1 : 0);
