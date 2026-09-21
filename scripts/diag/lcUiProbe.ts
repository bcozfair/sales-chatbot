/* ─────────────────────────────────────────────────────────────────────────────
   เปิดหน้า "ขอใบเสนอราคา" จริงแล้วกดจริง — ไม่ใช่เชื่อว่า build ผ่านแปลว่าจอไม่ขาว
   (AGENTS.md A9: ปุ่มที่อ้างฟังก์ชันที่ไม่มีอยู่ และ import ที่หาย build ผ่านทั้งคู่)

   ครอบทั้งวง: เลือกบริษัท → กางกล่อง → เพิ่ม → **หัวใบต้องติดทั้งที่ใบยังว่าง** → แก้ → ลบ
   ทำซ้ำที่ 1280px และ 390px โดยแต่ละรอบสร้างคนของตัวเองแล้วลบเอง

   ต้องมี API รันอยู่ที่พอร์ตที่ส่งมาทาง LC_PORT (ค่าเริ่มต้น 3099)

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

/**
 * อ่านค่าของช่องในหัวใบตามคำที่อยู่หน้าช่อง (`DocField` ไม่มี test id และไม่ควรมี —
 * โครงของมันคือ `<span>label</span><span>value</span>` ซึ่งเสถียรพอสำหรับด่านนี้)
 */
function docField(label: string): Promise<string> {
  return page.evaluate((lb: string) => {
    for (const row of Array.from(document.querySelectorAll('div.flex.gap-2'))) {
      const spans = row.querySelectorAll(':scope > span');
      if (spans.length >= 2 && (spans[0].textContent || '').trim() === lb) {
        return (spans[1].textContent || '').trim();
      }
    }
    return '';
  }, label);
}

/** คลิกด้วย selector โดยเลื่อนเข้ากลางจอก่อนเสมอ (เหตุผลเดียวกับที่เขียนไว้ที่ช่องบริษัท) */
async function clickSel(sel: string): Promise<boolean> {
  const h = await page.$(sel);
  if (!h) return false;
  await page.evaluate((el: Element) => el.scrollIntoView({ block: 'center' }), h);
  await wait(250);
  await h.click();
  return true;
}

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

      // ── เส้นทางจริงตั้งแต่ต้นจนจบ: เพิ่ม → หัวใบต้องติด → แก้ → ลบ ──────────────
      //
      // ทำ **ทั้งสองความกว้าง** (เดิมทำรอบเดียวที่ 1280px) เพราะปุ่มแก้/ลบโผล่เฉพาะตอนที่
      // คนที่เลือกอยู่เป็นคนที่เราเพิ่มเอง ⇒ ถ้าไม่เพิ่มคนที่ 390px ด้วย จะไม่มีอะไรให้วัดว่า
      // ไอคอนสองตัวที่เบียดเข้าไปในช่องกว้าง 320px ทำให้ล้นแนวนอนไหม
      //
      // แต่ละรอบสร้างคนของตัวเองแล้วลบเอง ⇒ ไม่มีสถานะข้ามรอบ (ไฟล์นี้เคยโดนมาแล้วเรื่อง
      // goto ที่ไม่รีโหลด) · มีตาข่ายเก็บกวาดท้ายไฟล์อีกชั้นเผื่อล้มกลางทาง
      const probeName = `I3 ทดสอบ ${width} ${Date.now()}`;
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
      await page.screenshot({ path: `${SHOTS}/lc-app-picked-${width}.png`, fullPage: false });

      const { rows: made } = await pool.query(
        'SELECT contact_id, company_id FROM public.local_contacts WHERE contact_name = $1', [probeName]);
      ok('  เขียนลง local_contacts จริง 1 แถว', made.length === 1, `${made.length} แถว`);
      const madeId: number | null = made.length === 1 ? Number(made[0].contact_id) : null;

      // ── หัวใบต้องติดตั้งแต่ยังไม่มีสินค้าในใบ (อาการที่เจ้าของรายงาน 2026-09-21) ──
      //
      // ใบตอนนี้ **ว่างเปล่า** ⇒ `/preview` ยังไม่เคยถูกเรียก (มันบังคับว่าต้องมี items)
      // ค่าที่เห็นจึงมาจาก `/party` ล้วน ๆ ซึ่งคือเส้นที่เพิ่งเพิ่มเข้ามา
      //
      // เทียบกับ **ฐานจริงของผู้ติดต่อคนนั้น** ไม่ใช่กับค่าคงที่ที่เดาไว้ — บริษัทที่ได้จากการ
      // ค้นคำว่า "บริษัท" เปลี่ยนได้ตามข้อมูล และบางบริษัทไม่มีเลขภาษี/ที่อยู่จริง ๆ
      // ⇒ ข้อไหนฐานว่าง ข้อนั้นไม่ตัดสิน (ไม่งั้นด่านจะล้มเพราะข้อมูล ไม่ใช่เพราะโค้ด)
      if (madeId !== null) {
        const { rows: dir } = await pool.query(
          `SELECT customer_reference, customer_tax_id, customer_payment_terms, invoice_street
             FROM public.customers_data_view WHERE contact_id = $1`, [madeId]);
        ok('  แถวของเขาอยู่ใน customers_data_view แล้ว', dir.length === 1, `${dir.length} แถว`);
        const d = dir[0] ?? {};
        const idLine = await docField('รหัสลูกค้า');
        const addrLine = await docField('ที่อยู่');
        if (d.customer_reference) {
          ok('  หัวใบขึ้นรหัสลูกค้าแล้ว (ยังไม่มีสินค้าในใบ)',
            idLine.includes(String(d.customer_reference)), idLine.slice(0, 60));
        }
        if (d.customer_tax_id) {
          ok('  หัวใบขึ้นเลขผู้เสียภาษีแล้ว',
            idLine.includes(String(d.customer_tax_id)), idLine.slice(0, 60));
        }
        if (d.invoice_street) {
          ok('  หัวใบขึ้นที่อยู่แล้ว', addrLine !== '' && addrLine !== '—', addrLine.slice(0, 60));
        }
        if (d.customer_payment_terms) {
          // ยังไม่มีใครตั้งทับ ⇒ select.value เป็น '' โดยตั้งใจ และค่าของลูกค้าอยู่ใน **ข้อความ**
          // ของตัวเลือกแรก (`{customerValue || 'ไม่มีข้อมูล'} (ของลูกค้า)`) ⇒ ต้องอ่านข้อความ ไม่ใช่ value
          const credit = await page.evaluate(() => {
            const sel = document.querySelector<HTMLSelectElement>('[aria-label="เครดิตของใบนี้"]');
            return sel ? (sel.selectedOptions[0]?.textContent || '').trim() : '(ไม่เจอช่องเครดิต)';
          });
          ok('  ช่องเครดิตขึ้นค่าของลูกค้าแล้ว',
            credit.includes(String(d.customer_payment_terms)), `จอ="${credit}" ฐาน="${d.customer_payment_terms}"`);
        }
      }

      // ── ปุ่มแก้/ลบ ต้องโผล่เฉพาะคนที่เราเพิ่มเอง ──
      const editBtn = '[aria-label="แก้ไขผู้ติดต่อที่เพิ่มเอง"]';
      const delBtn = '[aria-label="ลบผู้ติดต่อที่เพิ่มเอง"]';
      ok('มีปุ่มแก้ไขข้างช่องผู้ติดต่อ', (await page.$(editBtn)) !== null);
      ok('มีปุ่มลบข้างช่องผู้ติดต่อ', (await page.$(delBtn)) !== null);
      const ovAfterIcons = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok('  ไอคอนสองตัวไม่ทำให้ล้นแนวนอน', ovAfterIcons <= 1, `${ovAfterIcons}px`);

      // ── แก้ไข: เติมเบอร์ที่ตอนเพิ่มไม่ได้กรอก ──
      const newPhone = '099-000-1234';
      if (await clickSel(editBtn)) {
        await wait(1200);
        const title = await page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"]');
          return dlg ? (dlg.textContent || '').slice(0, 40) : '';
        });
        ok('กดแก้ไขแล้วกล่องเปิดในโหมดแก้ไข', title.includes('แก้ไขผู้ติดต่อ'), title.trim().slice(0, 30));
        const prefilled = await page.evaluate(() => {
          const el = document.querySelector<HTMLInputElement>('#lc-name');
          return el ? el.value : '';
        });
        ok('  ชื่อเดิมถูกเติมมาให้แล้ว', prefilled === probeName, prefilled.slice(0, 40));

        await page.type('#lc-phone', newPhone);
        await wait(200);
        await clickByText('[role="dialog"] button', 'บันทึก');
        await wait(2500);
        ok('  บันทึกแล้วกล่องปิดเอง', (await page.$('[role="dialog"]')) === null);

        if (madeId !== null) {
          const { rows: after } = await pool.query(
            'SELECT contact_phone FROM public.local_contacts WHERE contact_id = $1', [madeId]);
          ok('  เบอร์ที่แก้ลงฐานจริง', after[0]?.contact_phone === newPhone, String(after[0]?.contact_phone));
          const { rows: dirAfter } = await pool.query(
            'SELECT contact_phone FROM public.customers_data_view WHERE contact_id = $1', [madeId]);
          ok('  และแถวใน customers_data_view ตามไปด้วย (ไม่ต้องรอ rebuild)',
            dirAfter[0]?.contact_phone === newPhone, String(dirAfter[0]?.contact_phone));
        }
        const shownAfter = await page.evaluate(() => {
          const el = document.querySelector('[aria-label="ผู้ติดต่อ"]');
          return el ? (el.textContent || '').trim() : '';
        });
        ok('  และช่องในใบยังเป็นคนเดิม พร้อมเบอร์ใหม่',
          shownAfter.includes(probeName) && shownAfter.includes(newPhone), shownAfter.slice(0, 60));
      } else {
        ok('กดปุ่มแก้ไขได้', false);
      }

      // ── ลบผ่านจอจริง (ไม่ใช่ยิง API ตรง) ──
      if (await clickSel(delBtn)) {
        await wait(1000);
        const delOpen = await page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"]');
          return dlg ? (dlg.textContent || '').includes('ลบผู้ติดต่อที่เพิ่มเอง') : false;
        });
        ok('กดลบแล้วกล่องยืนยันเปิดขึ้นมา', delOpen);
        await page.screenshot({ path: `${SHOTS}/lc-app-delete-${width}.png`, fullPage: false });
        await clickByText('[role="dialog"] button', 'ลบ');
        await wait(2500);
        ok('  ยืนยันแล้วกล่องปิดเอง', (await page.$('[role="dialog"]')) === null);
        const emptied = await page.evaluate(() => {
          const el = document.querySelector('[aria-label="ผู้ติดต่อ"]');
          return el ? (el.textContent || '').trim() : '';
        });
        ok('  ช่องผู้ติดต่อในใบว่างลง (ไม่ค้างชื่อคนที่ไม่มีตัวตนแล้ว)',
          !emptied.includes(probeName), emptied.slice(0, 40));
      } else {
        ok('กดปุ่มลบได้', false);
      }

      const { rows: left } = await pool.query(
        `SELECT (SELECT count(*)::int FROM public.local_contacts      WHERE contact_name = $1) AS t,
                (SELECT count(*)::int FROM public.customers_data_view WHERE contact_name = $1) AS v`,
        [probeName]);
      ok('  ไม่เหลือผู้ติดต่อทดสอบในฐานเลย', left[0].t === 0 && left[0].v === 0,
        `local_contacts=${left[0].t} · view=${left[0].v}`);
    }
  }
}

await browser.close();

// ตาข่ายชั้นสุดท้าย — รอบไหนล้มกลางทางก่อนถึงขั้นลบ จะมีแถวค้างอยู่ ⇒ เก็บให้หมดก่อนจบ
// (ยิง endpoint จริง ไม่ใช่ DELETE ตรงในฐาน เพราะแถวใน customers_data_view ต้องหายไปด้วย)
const { rows: strays } = await pool.query(
  `SELECT contact_id FROM public.local_contacts WHERE contact_name LIKE 'I3 ทดสอบ %'`);
for (const r of strays) {
  const res = await fetch(`${BASE}/api/admin/webquote/contacts/${r.contact_id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`  · เก็บกวาดแถวค้าง ${r.contact_id} · HTTP ${res.status}`);
}
if (strays.length > 0) { fail++; console.log(`  ✗ มีแถวค้างจากรอบที่ล้ม ${strays.length} แถว`); }

await pool.end();
console.log(fail === 0 ? '\nผ่านทั้งหมด' : `\nล้ม ${fail} ข้อ`);
process.exit(fail > 0 ? 1 : 0);
