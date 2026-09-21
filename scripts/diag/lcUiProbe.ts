/* ─────────────────────────────────────────────────────────────────────────────
   เปิดหน้า "ขอใบเสนอราคา" จริงแล้วกดจริง — ไม่ใช่เชื่อว่า build ผ่านแปลว่าจอไม่ขาว
   (AGENTS.md A9: ปุ่มที่อ้างฟังก์ชันที่ไม่มีอยู่ และ import ที่หาย build ผ่านทั้งคู่)

   ใช้ชั่วคราวตอนทำก้อน I3 — ต้องมี API รันอยู่ที่พอร์ตที่ส่งมาทาง LC_PORT (ค่าเริ่มต้น 3099)

   ⚠️ `/admin` ตอบ 404 เมื่อรันจาก worktree เพราะ res.sendFile() ปฏิเสธ path ที่มีเซกเมนต์
      ขึ้นต้นด้วยจุด (`.claude/worktrees/...`) — ไม่ใช่บั๊กของโค้ด ⇒ เข้าทาง /admin.html ตรง ๆ
      ซึ่ง static middleware เสิร์ฟให้เหมือนกันทุกไบต์
   ───────────────────────────────────────────────────────────────────────────── */
import puppeteer, { type ElementHandle } from 'puppeteer';
import jwt from 'jsonwebtoken';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';

const PORT = process.env.LC_PORT || '3099';
const BASE = `http://localhost:${PORT}`;
// ภาพลงที่ mockup/shots ซึ่ง gitignore ไว้ — เขียนเป็น path สัมพัทธ์ ไม่ใช่ path ของเครื่องใครเครื่องหนึ่ง
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
console.log(`ใช้บัญชี ${admin.username} (${admin.role})`);

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  ✗ หน้าพัง:', (e as Error)?.message ?? String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('  · console.error:', m.text()); });

// ยัด token ก่อนแอปบูต ไม่ใช่หลัง — AuthProvider อ่าน sessionStorage ตอน useState initializer
await page.evaluateOnNewDocument(
  (t, u) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', u);
  },
  token,
  JSON.stringify({ id: admin.id, username: admin.username, name: admin.name, role: admin.role })
);

let fail = 0;
const ok = (msg: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? ' · ' + extra : ''}`);
  else { fail++; console.log(`  ✗ ${msg}${extra ? ' · ' + extra : ''}`); }
};

async function clickByText(sel: string, text: string): Promise<boolean> {
  const handles: ElementHandle<Element>[] = await page.$$(sel);
  for (const h of handles) {
    const t = (await page.evaluate((el: Element) => el.textContent || '', h)).trim();
    if (t.includes(text)) { await h.click(); return true; }
  }
  return false;
}

for (const width of [1280, 390]) {
  console.log(`\n${width}px`);
  await page.setViewport({ width, height: 1000 });
  // ?w= ไม่ได้ถูกอ่านโดยแอป — มีไว้ให้ URL ต่างกันจริงเท่านั้น
  // goto ไป URL เดิมที่ต่างแค่ hash = same-document navigation ⇒ **ไม่รีโหลด**
  // แล้วรอบที่สองจะได้สถานะค้างของรอบแรก (เจอจริง: กล่องยังเปิดค้างอยู่จากรอบ 1280px)
  await page.goto(`${BASE}/admin.html?w=${width}#quoterequest`, { waitUntil: 'networkidle2' });
  await wait(1800);

  // 1. เลือกบริษัท — ช่องผู้ติดต่อ disabled จนกว่าจะเลือก
  const custBox = await page.$('[aria-label="บริษัท / ลูกค้า"]');
  ok('หน้าขอใบเสนอราคาเรนเดอร์และเจอช่องบริษัท', !!custBox);
  if (!custBox) break;
  // เลื่อนให้อยู่กลางจอก่อนคลิกเสมอ — ที่ 390px ท้ายฟอร์มมีแถบสรุปแบบ sticky ทับอยู่
  // ถ้าคลิกดิบ ๆ จุดกึ่งกลางของช่องจะตกใต้แถบนั้นแล้วคลิกไปโดนแถบแทน (ไม่ใช่บั๊กของช่อง)
  await page.evaluate((el: Element) => el.scrollIntoView({ block: 'center' }), custBox);
  await wait(300);
  await custBox.click();
  await wait(300);
  await page.keyboard.type('บริษัท');
  await wait(2000);
  // เลือกด้วยคีย์บอร์ด ไม่ใช่คลิก — Enter วิ่งผ่าน onKeyDown ของ ComboBox ตรง ๆ
  // (การเดา selector ของแถวในกล่องเปราะกว่า และคลิกผิดปุ่มแล้วเงียบ ไม่ฟ้องอะไร)
  await page.keyboard.press('Enter');
  await wait(1500);
  const picked = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="บริษัท / ลูกค้า"]');
    return el ? (el.textContent || '').trim().slice(0, 40) : '';
  });
  ok('เลือกบริษัทได้', picked.length > 0 && !picked.includes('เลือกบริษัท'), picked);

  // 2. กางช่องผู้ติดต่อ → ต้องเห็นแถว "เพิ่มผู้ติดต่อใหม่" ท้ายรายการ
  const contactBox = await page.$('[aria-label="ผู้ติดต่อ"]');
  ok('เจอช่องผู้ติดต่อ', !!contactBox);
  if (contactBox) {
    const isDisabled = await page.evaluate((el: Element) => el.getAttribute('aria-disabled') === 'true', contactBox);
    ok('เลือกบริษัทแล้ว ช่องผู้ติดต่อกดได้', !isDisabled);
    await page.evaluate((el: Element) => el.scrollIntoView({ block: 'center' }), contactBox);
    await wait(300);
    await contactBox.click();
    await wait(900);
    await page.screenshot({ path: `${SHOTS}/lc-app-combo-${width}.png`, fullPage: false });
    const panelOpen = await page.evaluate(() => {
      const el = document.querySelector('[aria-label="ผู้ติดต่อ"]');
      return el ? el.getAttribute('aria-expanded') : 'ไม่เจอช่อง';
    });
    ok('  กล่องผู้ติดต่อกางออก', panelOpen === 'true', `aria-expanded=${panelOpen}`);
    const addRow = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).some((b) => (b.textContent || '').trim() === 'เพิ่มผู้ติดต่อใหม่')
    );
    ok('มีแถว "เพิ่มผู้ติดต่อใหม่" ท้ายรายการในกล่อง', addRow);

    // 3. กดแล้วกล่องต้องเปิด และรายการต้องหุบ
    if (addRow) {
      await clickByText('button', 'เพิ่มผู้ติดต่อใหม่');
      await wait(700);
      const modal = await page.$('[role="dialog"]');
      ok('กดแล้วกล่องเพิ่มผู้ติดต่อเปิดขึ้นมา', !!modal);
      const listGone = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).filter((b) => (b.textContent || '').trim() === 'เพิ่มผู้ติดต่อใหม่').length === 0
      );
      ok('  และรายการหุบไปแล้ว (ไม่ค้างซ้อนหลังกล่อง)', listGone);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok('ไม่ล้นแนวนอน', overflow <= 1, `${overflow}px`);
      await page.screenshot({ path: `${SHOTS}/lc-app-modal-${width}.png`, fullPage: false });

      // 4. ปุ่ม "เพิ่มผู้ติดต่อ" ต้องกดไม่ได้ตอนชื่อว่าง
      const submitDisabled = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
          (x) => (x.textContent || '').trim() === 'เพิ่มผู้ติดต่อ'
        );
        return b ? b.disabled : null;
      });
      ok('ชื่อว่าง ⇒ ปุ่ม "เพิ่มผู้ติดต่อ" กดไม่ได้', submitDisabled === true, `disabled=${submitDisabled}`);

      // ── เส้นทางจริงตั้งแต่ต้นจนจบ (ทำรอบเดียวที่ 1280px เพราะมันเขียนฐานจริง) ──
      if (width === 1280) {
        const probeName = `I3 ทดสอบ ${Date.now()}`;
        await page.type('#lc-name', probeName);
        await wait(200);
        await clickByText('[role="dialog"] button', 'เพิ่มผู้ติดต่อ');
        await wait(2500);

        const closed = (await page.$('[role="dialog"]')) === null;
        ok('เพิ่มสำเร็จ ⇒ กล่องปิดเอง', closed);

        const shown = await page.evaluate(() => {
          const el = document.querySelector('[aria-label="ผู้ติดต่อ"]');
          return el ? (el.textContent || '').trim() : '';
        });
        ok('  และช่องผู้ติดต่อในใบเลือกคนที่เพิ่งเพิ่มให้ทันที', shown.includes(probeName), shown.slice(0, 50));
        await page.screenshot({ path: `${SHOTS}/lc-app-picked-1280.png`, fullPage: false });

        // เก็บกวาด — ห้ามทิ้งผู้ติดต่อทดสอบไว้ในฐาน (กติกาเดียวกับ diag:local-contacts)
        const { rows: made } = await pool.query(
          'SELECT contact_id FROM public.local_contacts WHERE contact_name = $1', [probeName]);
        ok('  เขียนลง local_contacts จริง 1 แถว', made.length === 1, `${made.length} แถว`);
        for (const r of made) {
          const del = await fetch(`${BASE}/api/admin/webquote/contacts/${r.contact_id}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
          });
          ok(`  ลบผู้ติดต่อทดสอบผ่าน endpoint จริง (${r.contact_id})`, del.ok, `HTTP ${del.status}`);
        }
        const { rows: left } = await pool.query(
          `SELECT (SELECT count(*)::int FROM public.local_contacts      WHERE contact_name LIKE 'I3 ทดสอบ %') AS t,
                  (SELECT count(*)::int FROM public.customers_data_view WHERE contact_name LIKE 'I3 ทดสอบ %') AS v`);
        ok('  ไม่เหลือผู้ติดต่อทดสอบในฐานเลย', left[0].t === 0 && left[0].v === 0,
          `local_contacts=${left[0].t} · view=${left[0].v}`);
      }
    }
  }
}

await browser.close();
await pool.end();
console.log(fail === 0 ? '\nผ่านทั้งหมด' : `\nล้ม ${fail} ข้อ`);
process.exit(fail > 0 ? 1 : 0);
