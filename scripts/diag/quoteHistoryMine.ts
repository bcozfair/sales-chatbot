/* ─────────────────────────────────────────────────────────────────────────────
   หน้าประวัติใบเสนอราคา — ปุ่ม "ใบของฉัน / ทั้งหมด" · บรรทัดที่มา (LINE/หน้าเว็บ) · ป้ายต่อท้ายผู้ติดต่อ
   (เจ้าของเคาะ mockup `qh` 2026-10-01: ชื่อตามใบ PDF · ส่งออกตามปุ่ม · ทุก role มีปุ่ม ต่างกันแค่ค่าตอนเปิดหน้า)

   สิ่งที่พิสูจน์:
     ก. ตัวตัดสินขอบเขต (ในโปรเซสนี้ อ่านอย่างเดียว)
        · role ที่ถูกปิด quote.view_all ขอ "ทั้งหมด" แล้วยังได้เฉพาะใบตัวเอง (สิทธิ์ชนะปุ่ม)
        · role ที่เห็นทั้งหมด: ไม่กด = null (เหมือนเดิมทุกไบต์) · กด = ขอบเขตเดียวกับตอนถูกปิดสิทธิ์
        · ทั้งสาม endpoint (รายการ · ส่งออก · ตัวเลขในเมนูส่งออก) ถามตัวเดียวกันด้วย `mine` ตัวเดียวกัน (อ่านซอร์ส)
          — ไม่ยิง export จริงเพราะมันมาร์กใบว่าส่งออกแล้ว
        · ตัวเลขในเมนูส่งออก (`/export-counts`) = ใบที่ตารางเห็นภายใต้ตัวกรองเดียวกัน คัดตามกติกาของไฟล์
          · ยอดค้างของคิวแก้มือไม่ขึ้นกับตัวกรอง (2026-10-01)
     ข. API (ต้องมี API ของทรีนี้ที่ QH_PORT)
        · ไม่ส่ง mine = ผลเท่าเดิม (ยอดเท่าการนับสดทั้งตาราง) · mine=1 ยอด = mine_total ของรอบไม่กด = นับสด
        · channel = 'web' ⇔ user_id ขึ้นต้น web: ทุกแถวที่ได้
        · ตัวนับคิวแก้มือของ "ใบของฉัน" ไม่เกินของทั้งหมด
     ค. หน้าจอ
        · admin เปิดมาเจอ "ทั้งหมด" · subadmin เปิดมาเจอ "ใบของฉัน" · กดสลับแล้วตารางเปลี่ยน
        · ทุกแถวมีบรรทัดที่มา · ป้ายทะลุกฎ/แก้มืออยู่แถวเดียวกับ "ติดต่อ:"
        · ข้อความในเมนูส่งออกขึ้นเฉพาะตอนเลือก "ใบของฉัน" · ตารางว่างมีปุ่ม "ดูใบทั้งหมด"
        · 390px ไม่มีเลื่อนซ้ายขวา · ไม่มี error ในหน้า

   **ไม่เขียนฐานเลย** — ทุกคำขอที่ไม่ใช่ GET ถูกดักในเบราว์เซอร์แล้วตอบปลอม
   ต้องมี API ของทรีนี้รันอยู่ที่ QH_PORT (ค่าเริ่มต้น 3099) — **ห้ามใช้ 5180**:
     PORT=3099 PREVIEW_MODE=1 npx tsx index.ts
     npm run diag:quote-history-mine           (QH_SHOTS=<โฟลเดอร์> = เก็บภาพหน้าจอไว้ดูด้วยตา)
   ───────────────────────────────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
import puppeteer, { type HTTPRequest, type Page } from 'puppeteer';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';
import { can, quoteViewScopeOf } from '../../config/capabilities.js';
import { formatPersonNameWithSuffix } from '../../pdfGenerator.js';

const PORT = Number(process.env.QH_PORT ?? 3099);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.QH_SHOTS;
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail?: string) => {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? GREEN + '✓' : RED + '✗'}${RESET}  ${label}${detail ? `${DIM}  —  ${detail}${RESET}` : ''}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── ก. ตัวตัดสินขอบเขต ──────────────────────────────────────────────────── */
console.log('\n── ตัวตัดสินขอบเขต ─────────────────────────────────────');
{
  const spForced = !(await can('salesperson', 'quote.view_all'));
  const r = await quoteViewScopeOf({ id: 999_999, role: 'salesperson' }, false);
  if (spForced) {
    ok('role ที่ถูกปิด quote.view_all กด "ทั้งหมด" แล้วยังได้เฉพาะใบตัวเอง', r.viewAll === false && r.scope?.adminId === 999_999,
      `salesperson · viewAll=${r.viewAll}`);
  } else {
    ok('(ข้าม) salesperson เปิด quote.view_all อยู่บนฐานนี้ — ไม่มี role ไว้ทดสอบกรณีบังคับ', true);
  }
  const all = await quoteViewScopeOf({ id: 999_999, role: 'admin' }, false);
  const mine = await quoteViewScopeOf({ id: 999_999, role: 'admin' }, true);
  ok('admin ไม่กดปุ่ม = ขอบเขต null (เหมือนก่อนมีปุ่ม)', all.scope === null && all.viewAll === true);
  ok('admin กด "ใบของฉัน" = ขอบเขตของบัญชีตัวเอง', mine.scope?.adminId === 999_999 && mine.viewAll === true);

  const src = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');
  // รายการถามเองหนึ่งจุด · ส่งออกกับตัวเลขในเมนูถามผ่าน odooExportFilterOf ตัวเดียวกัน (อีกหนึ่งจุด)
  const calls = src.match(/quoteViewScopeOf\(req\.admin, req\.query\.mine === '1'\)/g)?.length ?? 0;
  const viaFilter = src.match(/await odooExportFilterOf\(req\)/g)?.length ?? 0;
  ok('รายการ · ส่งออก · ตัวเลขในเมนูส่งออก ถามขอบเขตด้วยปุ่มเดียวกัน', calls === 2 && viaFilter === 2,
    `ถามตรง ${calls} จุด · ผ่านตัวกรองของไฟล์ ${viaFilter} จุด`);
  ok('ไม่มี endpoint ไหนถามสิทธิ์ตรง ๆ แล้วลืมปุ่ม', !/quoteScopeOf\(req\.admin\)/.test(src));
  const fe = readFileSync(new URL('../../frontend/src/admin/Quotations.tsx', import.meta.url), 'utf8');
  const feMine = fe.match(/if \(mineOnly\) params\.set\('mine', '1'\)/g)?.length ?? 0;
  const feUses = fe.match(/= filterParams\(\)|\$\{filterParams\(\)\.toString\(\)\}/g)?.length ?? 0;
  ok('หน้าจอส่ง mine=1 จากตัวประกอบตัวกรองตัวเดียว · ตาราง ส่งออก ตัวเลขในเมนู ใช้ตัวนั้นครบ',
    feMine === 1 && feUses === 3, `mine ${feMine} จุด · ใช้ตัวประกอบ ${feUses} จุด`);
}

const { rows: admins } = await pool.query(`SELECT id, username, name, role FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1`);
const { rows: subs } = await pool.query(
  `SELECT a.id, a.username, a.name, a.role,
          (SELECT COUNT(*)::int FROM quotations q WHERE q.user_id LIKE 'web:' || a.id || ':%') AS own
     FROM admin_users a
    WHERE a.role = 'subadmin'
      AND NOT EXISTS (SELECT 1 FROM admin_user_salespersons x WHERE x.admin_user_id = a.id)
    ORDER BY own DESC, a.id`
);
const { rows: [all] } = await pool.query(`SELECT COUNT(*)::int AS n FROM quotations`);
await pool.end();
if (!admins.length) throw new Error('ไม่มีบัญชี admin บนฐานนี้');
if (!subs.length) throw new Error('ไม่มีบัญชี subadmin ที่ไม่ได้ผูกรหัสเซลส์บนฐานนี้');
const subWith = subs.find((s) => s.own > 0) ?? null;
const subNone = subs.find((s) => s.own === 0) ?? null;

/* ── ข. API ─────────────────────────────────────────────────────────────── */
console.log('\n── API ─────────────────────────────────────────────────');
try {
  await fetch(`${BASE}/admin.html`);
} catch {
  console.error(`ไม่มีเซิร์ฟเวอร์ที่ ${BASE} — เปิดด้วย  PORT=${PORT} PREVIEW_MODE=1 npx tsx index.ts  ในทรีของงานนี้ก่อน`);
  process.exit(1);
}
const tokenOf = (a: any) => jwt.sign({ id: a.id, username: a.username, name: a.name, role: a.role }, getJwtSecret(), { expiresIn: '1h' });
const api = async (a: any, path: string) => (await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${tokenOf(a)}` } })).json();

const admin = admins[0];
{
  const r = await api(admin, '/api/admin/quotations?exported=all&limit=200');
  ok('ไม่ส่ง mine = ทุกใบเหมือนเดิม', r.total === all.n && r.scope === 'all' && r.view_all === true, `${r.total} / นับสด ${all.n}`);
  const bad = r.data.filter((q: any) => q.channel !== (String(q.user_id ?? '').startsWith('web:') ? 'web' : 'line'));
  ok('channel ตรงกับ user_id ทุกแถว', bad.length === 0 && r.data.length > 0, `${r.data.length} แถว · ผิด ${bad.length}`);
  const m = await api(admin, '/api/admin/quotations?exported=all&mine=1&limit=1');
  ok('admin กด "ใบของฉัน" ยอดเท่าตัวเลขบนปุ่ม', m.total === r.mine_total && m.scope === 'own', `${m.total} = ${r.mine_total}`);

  // ชื่อผู้เสนอราคา = ที่ใบ PDF พิมพ์ทุกตัวอักษร (เจ้าของสั่ง 2026-10-01) — เทียบกับฟังก์ชันของ PDF ตรง ๆ
  // ไม่ใช่สำเนากติกา ⇒ วันที่ PDF เปลี่ยนวิธีจัดชื่อ ข้อนี้ตามไปเอง
  const issued = r.data.filter((q: any) => q.quotation_no);
  // ไม่ห้อย (PM)/(THT) บนจอ (เจ้าของสั่ง 2026-10-01 รอบสอง) ⇒ เทียบกับชื่อของ PDF ที่ถอดวงเล็บท้ายออก
  const pdfName = (q: any) => formatPersonNameWithSuffix(q.issuer_name || q.salesperson_name, String(q.quotation_no).toUpperCase().startsWith('QT'))
    .replace(/ \((PM|THT)\)$/, '');
  const wrong = issued.filter((q: any) => q.issuer_display !== pdfName(q));
  ok('ใบที่มีเลขที่: ชื่อผู้เสนอราคาตรงกับ PDF (ไม่นับวงเล็บบริษัท)', issued.length > 0 && wrong.length === 0,
    `${issued.length} ใบ · ผิด ${wrong.length}${wrong[0] ? ` เช่น "${wrong[0].issuer_display}" ≠ "${pdfName(wrong[0])}"` : ''}`);
  ok('ไม่มีชื่อผู้เสนอราคาขึ้นต้นด้วย "คุณ"', r.data.every((q: any) => !String(q.issuer_display ?? '').startsWith('คุณ')));
  const suffixed = r.data.filter((q: any) => /\((PM|THT)\)\s*$/i.test(q.issuer_display ?? ''));
  ok('ไม่มีชื่อผู้เสนอราคาห้อย (PM)/(THT) ทั้งใบร่างและใบที่ออกเลข', suffixed.length === 0,
    `${r.data.length} ใบ · ห้อย ${suffixed.length}`);
}

// ตัวเลขในเมนูส่งออก = จำนวนใบที่ตารางเห็นภายใต้ตัวกรองเดียวกัน แล้วคัดตามกติกาของไฟล์
// (มีเลขที่ · มีรายการ · อักษรนำ QP/QT · ไฟล์ปกติไม่มีใบแก้มือ) — นับเองจากรายการ ไม่ใช่ถามตัวนับซ้ำ
// เกิดจริง 2026-10-01: เมนูขึ้น "ต้องแก้มือ 1 ใบ" ตอนกรอง "รอนำเข้า" ทั้งที่ตารางว่าง
{
  const listAll = async (qs: string) => {
    const out: any[] = [];
    for (let off = 0; ; off += 200) {
      const r = await api(admin, `/api/admin/quotations?${qs}&limit=200&offset=${off}`);
      out.push(...r.data);
      if (out.length >= r.total || r.data.length === 0) return out;
    }
  };
  const KINDS = ['new_contact', 'custom_product', 'payment_terms_override'];
  const bucketOf = (q: any) => {
    const kinds = (q.odoo_manual_review?.reasons ?? []).map((r: any) => r.kind);
    return KINDS.find((k) => kinds.includes(k)) ?? 'other';
  };
  for (const qs of ['exported=no', 'exported=pending', 'exported=imported', 'exported=all', 'exported=all&flag=manual', 'exported=yes&flag=clean']) {
    const rows = (await listAll(qs)).filter((q: any) =>
      String(q.quotation_no ?? '').trim() !== '' && Array.isArray(q.item_details) && q.item_details.length > 0);
    const want = (p: string) => rows.filter((q: any) => String(q.quotation_no).toUpperCase().startsWith(p));
    const wantNormal = { QP: want('QP').filter((q: any) => !q.odoo_manual_review).length, QT: want('QT').filter((q: any) => !q.odoo_manual_review).length };
    const wantManual = rows.filter((q: any) => q.odoo_manual_review && KINDS.includes(bucketOf(q))
      && /^(QP|QT)/i.test(String(q.quotation_no))).length;
    const c = await api(admin, `/api/admin/quotations/export-counts?${qs}`);
    ok(`ตัวเลขในเมนูตรงกับตาราง · ${qs}`,
      c.normal.QP === wantNormal.QP && c.normal.QT === wantNormal.QT && c.manual.total === wantManual,
      `PM ${c.normal.QP}/${wantNormal.QP} · THT ${c.normal.QT}/${wantNormal.QT} · แก้มือ ${c.manual.total}/${wantManual}`);
  }
  // ยอดค้างไม่ฟังตัวกรอง — ตัวกรองไหนก็ได้ยอดเดียวกัน · และ "นอกตัวกรอง" ของตัวกรองตั้งต้นต้องเป็น 0
  // ถ้าไม่มีใบค้างที่ไม่มีรายการ/อักษรนำแปลก ๆ (ตัวกรองตั้งต้น = นิยามของคิวพอดี)
  const q1 = await api(admin, '/api/admin/quotations/export-counts?exported=no');
  const q2 = await api(admin, '/api/admin/quotations/export-counts?exported=imported');
  ok('ยอดค้างของคิวแก้มือไม่ขึ้นกับตัวกรอง', q1.queue.total === q2.queue.total, `${q1.queue.total} = ${q2.queue.total}`);
  ok('ตัวกรองตั้งต้น ("ยังไม่ส่งออก") เห็นคิวแก้มือครบ', q1.queue.outside === 0, `นอกตัวกรอง ${q1.queue.outside}`);
  ok('ตัวกรอง "นำเข้า Odoo แล้ว" มองไม่เห็นใบค้างเลย ⇒ นอกตัวกรอง = ยอดค้างทั้งหมด', q2.queue.outside === q2.queue.total,
    `${q2.queue.outside} = ${q2.queue.total}`);
}
for (const s of [subWith, subNone].filter(Boolean)) {
  const r = await api(s, '/api/admin/quotations?exported=all&limit=1');
  const m = await api(s, '/api/admin/quotations?exported=all&mine=1&limit=200');
  ok(`subadmin #${s.id} "ใบของฉัน" = ใบที่ออกจากบัญชีตัวเอง`, m.total === s.own && r.mine_total === s.own, `${m.total} ใบ · นับสด ${s.own}`);
  ok(`subadmin #${s.id} ทุกแถวใน "ใบของฉัน" เป็นของบัญชีนี้`, m.data.every((q: any) => String(q.user_id).startsWith(`web:${s.id}:`)));
  const ca = await api(s, '/api/admin/quotations/export-counts?exported=all');
  const cm = await api(s, '/api/admin/quotations/export-counts?exported=all&mine=1');
  ok(`subadmin #${s.id} ตัวนับคิวแก้มือของ "ใบของฉัน" ไม่เกินทั้งหมด`, cm.queue.total <= ca.queue.total, `${cm.queue.total} ≤ ${ca.queue.total}`);
}

/* ── ค. หน้าจอ ─────────────────────────────────────────────────────────── */
console.log('\n── หน้าจอ ──────────────────────────────────────────────');
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
let writes = 0;
/**
 * `inject` = ใส่ป้ายทะลุกฎ/แก้มือลงคำตอบรายการใบในเบราว์เซอร์ — ฐาน dev ไม่มีใบติดป้ายเลยสักใบ
 * (วัด 2026-10-01: 0 / 0) ข้อตรวจตำแหน่งป้ายจะผ่านแบบว่างเปล่าถ้าพึ่งข้อมูลจริง · ไม่แตะฐาน
 */
const injectBadges = (body: any) => {
  const rows = body?.data ?? [];
  if (rows[0]) Object.assign(rows[0], { contact_name: rows[0].contact_name || 'คุณทดสอบ', rule_overrides: { violations: [{ display_message: 'ทดสอบ' }, { display_message: 'ทดสอบ' }] } });
  if (rows[1]) Object.assign(rows[1], { contact_name: rows[1].contact_name || 'คุณทดสอบ', odoo_manual_review: { reasons: [{ kind: 'payment_terms', display_message: 'ทดสอบ' }] } });
  if (rows[2]) Object.assign(rows[2], { contact_name: '', rule_overrides: { violations: [{ display_message: 'ทดสอบ' }] }, odoo_manual_review: { reasons: [{ kind: 'payment_terms', display_message: 'ทดสอบ' }] } });
  return body;
};
const open = async (a: any, width: number, inject = false): Promise<{ page: Page; errors: string[] }> => {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e instanceof Error ? e.message : String(e)));
  await page.setRequestInterception(true);
  page.on('request', (r: HTTPRequest) => {
    if (r.method() !== 'GET' && r.url().includes('/api/')) {
      writes++;
      return void r.respond({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (inject && /\/api\/admin\/quotations\?/.test(r.url())) {
      void fetch(r.url(), { headers: r.headers() })
        .then((x) => x.json())
        .then((b) => r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(injectBadges(b)) }));
      return;
    }
    void r.continue();
  });
  await page.evaluateOnNewDocument((t: string, u: string) => {
    sessionStorage.setItem('admin_token', t);
    sessionStorage.setItem('admin_user', u);
  }, tokenOf(a), JSON.stringify({ id: a.id, username: a.username, name: a.name, role: a.role }));
  await page.setViewport({ width, height: 900 });
  await page.goto(`${BASE}/admin.html#quotations`, { waitUntil: 'networkidle0' });
  await wait(400);
  return { page, errors };
};
const settle = async (page: Page) => {
  await wait(300);
  await page.waitForNetworkIdle({ idleTime: 250, timeout: 15000 }).catch(() => {});
  await wait(100);
};
const pressed = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
const clickText = (page: Page, text: string) => page.evaluate((t: string) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim().includes(t) && (x as HTMLElement).offsetParent) as HTMLButtonElement | undefined;
  b?.click();
  return !!b;
}, text);
const rowInfo = (page: Page) => page.$$eval('table tbody tr', (trs) => trs
  .filter((tr) => tr.querySelectorAll('td').length >= 7)
  .map((tr) => {
    const tds = tr.querySelectorAll('td');
    const issuer = (tds[2] as HTMLElement).innerText.split('\n').map((s) => s.trim()).filter(Boolean);
    const badge = [...tds[1].querySelectorAll('span')].find((s) => /ทะลุกฎ|แก้มือ/.test(s.textContent ?? ''));
    const contact = [...tds[1].querySelectorAll('span')].find((s) => (s.textContent ?? '').startsWith('ติดต่อ:'));
    return {
      name: issuer[0] ?? '',
      source: issuer[1] ?? '',
      hasBadge: !!badge,
      hasContact: !!contact,
      // ป้ายกับผู้ติดต่ออยู่บรรทัดเดียวกัน = กล่องพ่อเดียวกัน
      badgeInline: !badge || !contact || badge.parentElement === contact.parentElement,
    };
  }));

{
  const { page, errors } = await open(admin, 1280);
  ok('admin เปิดหน้ามาเจอ "ทั้งหมด"', (await pressed(page)).some((t) => t.startsWith('ทั้งหมด')));
  await page.select('#quotation-exported-filter', 'all');
  await settle(page);
  const rows = await rowInfo(page);
  ok('ทุกแถวมีบรรทัดที่มา (LINE / หน้าเว็บ)', rows.length > 0 && rows.every((r) => r.source === 'LINE' || r.source === 'หน้าเว็บ'),
    `${rows.length} แถว`);
  ok('จอไม่แสดง "คุณ" หน้าชื่อผู้เสนอราคา (ตาม PDF)', rows.every((r) => !r.name.startsWith('คุณ')), rows.slice(0, 3).map((r) => r.name).join(' · '));
  await clickText(page, 'ส่งออก Odoo');
  await wait(150);
  const noteAll = await page.evaluate(() => document.body.innerText.includes('ไฟล์จะมีเฉพาะใบที่คุณเสนอราคา'));
  ok('ดู "ทั้งหมด" อยู่ เมนูส่งออกไม่มีข้อความเตือน', !noteAll);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/qh-admin-1280.png` });
  ok('admin ไม่มี error ในหน้า', errors.length === 0, errors.join(' | '));
  await page.close();
}
for (const width of [1280, 390]) {
  const { page, errors } = await open(admin, width, true);
  const rows = await rowInfo(page);
  const withContact = rows.filter((r) => r.hasBadge && r.hasContact);
  ok(`${width}px ป้ายทะลุกฎ/แก้มืออยู่บรรทัดเดียวกับ "ติดต่อ:"`,
    withContact.length >= 2 && withContact.every((r) => r.badgeInline), `ตรวจ ${withContact.length} แถว`);
  ok(`${width}px ใบที่ไม่มีผู้ติดต่อยังแสดงป้าย`, rows.some((r) => r.hasBadge && !r.hasContact));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/qh-badges-${width}.png`, fullPage: width === 390 });
  ok(`${width}px ไม่มี error ในหน้า (ป้ายจำลอง)`, errors.length === 0, errors.join(' | '));
  await page.close();
}
if (subWith) {
  const { page, errors } = await open(subWith, 1280);
  ok(`subadmin #${subWith.id} เปิดหน้ามาเจอ "ใบของฉัน"`, (await pressed(page)).some((t) => t.startsWith('ใบของฉัน')));
  await page.select('#quotation-exported-filter', 'all');
  await settle(page);
  const mineRows = (await rowInfo(page)).length;
  ok('"ใบของฉัน" แสดงเฉพาะใบเว็บของตัวเอง', mineRows === Math.min(subWith.own, 10) && (await rowInfo(page)).every((r) => r.source === 'หน้าเว็บ'),
    `${mineRows} แถว`);
  await clickText(page, 'ส่งออก Odoo');
  await wait(150);
  ok('เลือก "ใบของฉัน" อยู่ เมนูส่งออกบอกว่าไฟล์มีเฉพาะใบของคุณ',
    await page.evaluate(() => document.body.innerText.includes('ไฟล์จะมีเฉพาะใบที่คุณเสนอราคา')));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/qh-sub-1280.png` });
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 880);
  await clickText(page, 'ทั้งหมด');
  await settle(page);
  ok('กด "ทั้งหมด" แล้วตารางขยายเป็นใบของทุกคน', (await pressed(page)).some((t) => t.startsWith('ทั้งหมด')) && (await rowInfo(page)).length >= mineRows);
  ok('subadmin ไม่มี error ในหน้า', errors.length === 0, errors.join(' | '));
  await page.close();
}
if (subNone) {
  const { page, errors } = await open(subNone, 390);
  const empty = await page.evaluate(() => document.body.innerText.includes('ไม่พบใบเสนอราคาของคุณ'));
  ok(`subadmin #${subNone.id} ที่ยังไม่มีใบ เห็นตารางว่างพร้อมเหตุผล`, empty);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('390px ไม่มีเลื่อนซ้ายขวา', overflow <= 0, `${overflow}px`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/qh-sub-empty-390.png`, fullPage: true });
  ok('มีปุ่ม "ดูใบทั้งหมด" และกดแล้วมีแถว', await clickText(page, 'ดูใบทั้งหมด') && (await settle(page), (await page.$$('table tbody tr')).length > 0));
  ok('subadmin (ไม่มีใบ) ไม่มี error ในหน้า', errors.length === 0, errors.join(' | '));
  await page.close();
}
await browser.close();
ok('ไม่มีคำขอเขียนหลุดออกจากเบราว์เซอร์', true, `ดักไว้ ${writes} ครั้ง`);

console.log(`\nสรุป: ${GREEN}ผ่าน ${pass}${RESET} · ${fail ? RED : DIM}ล้ม ${fail}${RESET}`);
process.exit(fail ? 1 : 0);
