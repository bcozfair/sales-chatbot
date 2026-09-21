// ─────────────────────────────────────────────────────────────────────────────
//  localContactsSmoke — ด่านของโมดูล "เพิ่มผู้ติดต่อเอง" (`local_contacts`)
//  รัน:  npm run diag:local-contacts          (ไม่ต้องเปิดเซิร์ฟเวอร์ — ยิงฐานตรง)
//  แผน: docs/plan-local-contacts.md §8 — ก้อน I1 ปิดข้อ 1–3 · ก้อน I2 ปิดข้อ 4–9
//
//  1. **ตารางว่าง ⇒ customers_data_build ให้ผลเท่าเดิมทุกบิต** และเมื่อมีแถว local แล้ว
//     แถวของ Odoo ทุกแถวทุกคอลัมน์ต้อง **ไม่ขยับแม้แต่บิตเดียว** (เทียบสองทางด้วย EXCEPT ALL
//     ไม่ใช่นับแถว — นับแถวมองไม่เห็นค่าที่เปลี่ยนในคอลัมน์)
//  2. **เวลา build ไม่ถอย** แม้มีผู้ติดต่อ local เยอะ — ตัวจับ `LATERAL ... LIMIT 1` ต่อแถว
//     ที่แผนใหญ่ร่างไว้ ซึ่งจะกลายเป็น seq scan 82,721 แถว **ต่อผู้ติดต่อ local หนึ่งคน**
//     (อาการ: ยิ่งเพิ่มคน ยิ่งช้าเป็นเส้นตรง ⇒ sync ทั้งระบบพลอยช้าตาม)
//  3. **แถวที่ dual-write เขียน = แถวที่ Arm 3 สร้างตอน rebuild — ทีละคอลัมน์ทั้ง 24 ช่อง**
//     ตัวจับอาการ "ค่า propagate ไม่ครบ" · "last_order_at ไม่ตรงกับพี่น้อง" · "ทีมขายสองฝั่ง
//     คนละกติกา" ซึ่งทั้งสามไม่มีอะไรฟ้องจนกว่าจะออกใบผิด
//  4. **ทีมขายสืบทอดถูกทั้งสองทาง** — (ก) ได้ค่าของพี่น้อง ไม่ใช่ค่าว่างของแถวตัวแทน
//     (ข) บริษัทที่ไม่มีทีมขายเลยต้องได้ `NULL` **และ INSERT ต้องผ่าน ไม่ใช่ล้ม**
//  5. **โผล่ในฟังก์ชันจริงที่ทั้งระบบใช้อ่านผู้ติดต่อทันที** — ข้อที่พิสูจน์ว่า "ต่อท่อเข้า
//     customers_data_view" ได้ผลจริง (LIFF picker · แชท · reverse lookup เห็นหมดโดยไม่ต้องแก้โค้ด)
//  6. **สัญญาของ endpoint** — ชื่อซ้ำ → `409` **พร้อมแถวเดิม** · บริษัทไม่มีจริง → `400`
//  7. **`odoo_matched_at` ถูกเขียน ⟺ แถว local ถูกซ่อนจาก view** (สัญญาณ A ≡ CTE `local_taken`)
//  8. **สัญญาณ B ยิงจากใบที่นำเข้าแล้ว และ *ไม่ยิง* เมื่อชื่อในใบไม่ตรง** — ตรวจทั้งสองด้าน
//     เพราะด้านที่ "ต้องไม่ยิง" คือด้านที่พังแล้วของหลุดไปถึงปลายทาง
//  9. **คีย์ชื่อใน Odoo ไม่ตรงเป๊ะ → ได้ 2 แถว + ป้าย 🔴 ชี้ชื่อที่ชน** (กับดัก §7.4 ที่ทำให้มองเห็น)
//
//  ⚠️ **ทุกข้ออยู่ใน transaction เดียวที่ ROLLBACK เสมอ** ตามแบบ diag:quote-delete —
//     ห้ามทิ้งผู้ติดต่อทดสอบไว้ในฐาน และห้ามเปลี่ยนเป็น COMMIT · ข้อ 3 เขียนลง
//     customers_data_view ซึ่งเป็น **ตารางจริง** จึงต้องอยู่ใน tx เดียวกันด้วย
//
//  ⚠️ ใช้ pg.Client เฉพาะกิจ ไม่ใช่ pool — pool ตั้ง statement_timeout = 15s แต่การ build
//     view ทั้งก้อนใช้ ~6 วิ และด่านนี้ build สามรอบ (เหตุผลเดียวกับ refreshCustomerDirectory)
// ─────────────────────────────────────────────────────────────────────────────
import dotenv from 'dotenv';
import pg from 'pg';
import { pool } from '../../config/db.js';
import {
  ensureDirectoryRow, listLocalContacts, markMatchedByContactSync, markMatchedByImportedOrder,
} from '../../db/localContactsRepo.js';
import {
  getContactsByCustomerId, getContactById, getRelatedContactsByCustomerId,
} from '../../db/repositories.js';
import {
  createLocalContact, updateLocalContactById, deleteLocalContactById, decorate,
  LocalContactError,
} from '../../services/localContacts.js';
dotenv.config();

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';

let pass = 0, fail = 0;

function ok(label: string, detail = ''): void {
  pass++;
  console.log(`${GREEN}✓${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`);
}

function bad(label: string, detail = ''): void {
  fail++;
  console.log(`${RED}✗ ${label}${RESET}${detail ? ` ${detail}` : ''}`);
}

/** ชื่อทดสอบต้องชนกับของจริงไม่ได้ และต้องมองออกทันทีว่าเป็นของด่าน */
const TAG = 'DIAG ผู้ติดต่อทดสอบ';

async function timedBuild(client: pg.Client, table: string): Promise<number> {
  const t0 = Date.now();
  await client.query(`CREATE TEMP TABLE ${table} AS SELECT * FROM public.customers_data_build`);
  return Date.now() - t0;
}

/**
 * วัดเวลา build หนึ่งรอบแล้วทิ้งตารางชั่วคราวทันที
 *
 * ⚠️ **ห้ามวัดโดยปล่อยให้ temp table ค้างไว้หลายก้อน** — ก้อนละ 82,721 แถว พอค้างสามก้อน
 * รอบหลัง ๆ ช้าลงเองเท่าตัวโดยไม่เกี่ยวกับสิ่งที่กำลังวัด (เจอจริงตอนเขียนด่านนี้ 2026-09-18:
 * 2,935 ms → 8,093 ms ทั้งที่นิยาม view เหมือนกันเป๊ะ) ⇒ ตัวเลขที่ได้จะกล่าวหา Arm 3 ผิด ๆ
 */
async function probeBuild(client: pg.Client): Promise<number> {
  const ms = await timedBuild(client, 'cdv_probe');
  await client.query('DROP TABLE cdv_probe');
  return ms;
}

/** บริษัทที่มีแถวของ Odoo อย่างน้อย 1 แถว — ใช้เป็นเจ้าบ้านของผู้ติดต่อทดสอบ */
async function pickCompanies(client: pg.Client, n: number): Promise<number[]> {
  const { rows } = await client.query(
    `SELECT company_id
       FROM public.customers_data_view
      WHERE source <> 'local' AND contact_id > 0
      GROUP BY company_id
      ORDER BY company_id
      LIMIT $1`,
    [n]
  );
  return rows.map((r) => Number(r.company_id));
}

/**
 * บริษัทที่ **แถวตัวแทนมีทีมขายว่าง แต่พี่น้องมีค่า** (วัด 2026-09-17: 663 บริษัท)
 * — เคสที่แยก "สืบทอดจากบริษัท" ออกจาก "ยืมจากแถวตัวแทนดื้อ ๆ" ได้จริง
 * คืน null ถ้าฐานนี้ไม่มีเคสแบบนั้น (ด่านจะข้ามไป ไม่ล้ม)
 */
async function pickInheritCompany(client: pg.Client): Promise<number | null> {
  const { rows } = await client.query(
    `SELECT company_id
       FROM (
         SELECT company_id,
                (array_agg(sales_team ORDER BY contact_id))[1]                        AS anchor_team,
                (array_remove(array_agg(sales_team ORDER BY contact_id), NULL))[1]    AS inherited_team
           FROM public.customers_data_view
          WHERE source <> 'local'
          GROUP BY company_id
       ) x
      WHERE anchor_team IS NULL AND inherited_team IS NOT NULL
      ORDER BY company_id
      LIMIT 1`
  );
  return rows[0] ? Number(rows[0].company_id) : null;
}

/**
 * บริษัทที่ **ไม่มีทีมขายเลยสักแถว** (วัด 2026-09-17: 31,605 จาก 53,490 = 59.1%)
 * — เคสที่ผู้ติดต่อใหม่ต้องได้ `NULL` แล้ว `INSERT` ยังต้องผ่าน (§3.5 ข้อ 3)
 */
async function pickNoTeamCompany(client: pg.Client): Promise<number | null> {
  const { rows } = await client.query(
    `SELECT company_id
       FROM public.customers_data_view
      WHERE source <> 'local' AND contact_id > 0
      GROUP BY company_id
     HAVING count(sales_team) = 0
      ORDER BY company_id
      LIMIT 1`
  );
  return rows[0] ? Number(rows[0].company_id) : null;
}

/**
 * เตรียมเคสของสัญญาณ B: ใบที่นำเข้า Odoo แล้ว 2 ใบ ชี้ไปที่ `sale_orders` แถวเดียวกัน
 * ใบหนึ่งผู้ติดต่อชื่อ **ตรง** กับชื่อในใบนั้น อีกใบ **ไม่ตรง**
 *
 * ⚠️ ใช้ท่า `UPDATE` ใบที่มีอยู่แล้วแทนการ `INSERT` ใบใหม่ — ตารางใบมีคอลัมน์บังคับหลายตัวและ
 *    `user_id` มี FK ไป `salesperson` ⇒ การประกอบใบปลอมขึ้นมาทั้งใบคือการทดสอบว่า "เราเขียน
 *    INSERT ถูกไหม" ไม่ใช่ "สัญญาณ B ตัดสินถูกไหม" · ทุกอย่างอยู่ใน tx ที่ ROLLBACK อยู่แล้ว
 */
async function seedImportedOrderCase(
  client: pg.Client
): Promise<{ matchId: number; mismatchId: number } | null> {
  const { rows: so } = await client.query(
    `SELECT sale_order_id, contact_name
       FROM public.sale_orders
      WHERE contact_id > 0 AND contact_name IS NOT NULL AND btrim(contact_name) <> ''
        AND sale_order_id IS NOT NULL
      ORDER BY sale_order_id
      LIMIT 1`
  );
  const { rows: quotes } = await client.query(
    'SELECT id FROM public.quotations ORDER BY created_at LIMIT 2'
  );
  if (so.length === 0 || quotes.length < 2) return null;

  const [company] = await pickCompanies(client, 1);
  const { rows: a } = await client.query(
    `INSERT INTO public.local_contacts (company_id, contact_name) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING contact_id`,
    [company, so[0].contact_name]
  );
  const { rows: b } = await client.query(
    `INSERT INTO public.local_contacts (company_id, contact_name) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING contact_id`,
    [company, `${TAG} ชื่อไม่ตรงกับใบ ${company}`]
  );
  if (a.length === 0 || b.length === 0) return null;

  const matchId = Number(a[0].contact_id);
  const mismatchId = Number(b[0].contact_id);
  await client.query(
    `UPDATE public.quotations
        SET contact_id = $2, odoo_imported_at = NOW(), odoo_so_id = $3
      WHERE id = $1`,
    [quotes[0].id, matchId, so[0].sale_order_id]
  );
  await client.query(
    `UPDATE public.quotations
        SET contact_id = $2, odoo_imported_at = NOW(), odoo_so_id = $3
      WHERE id = $1`,
    [quotes[1].id, mismatchId, so[0].sale_order_id]
  );
  return { matchId, mismatchId };
}

/**
 * เตรียมเคสกับดัก §7.4: ผู้ติดต่อ local ที่ชื่อ "เกือบ" ตรงกับของ Odoo (เติม `คุณ` นำหน้า)
 *
 * เลือกเฉพาะชื่อที่ **ยังไม่มีคำนำหน้า** — ถ้าต้นทางเป็น `คุณสมชาย` อยู่แล้ว การเติมอีกชั้นจะได้
 * `คุณคุณสมชาย` ซึ่งตัดคำนำหน้าชั้นเดียวแล้วยังเหลือ `คุณสมชาย` ⇒ ไม่เท่ากัน และเคสจะกลายเป็น
 * การทดสอบ similarity ล้วน ๆ แทนที่จะทดสอบชั้น normalized-equal ที่ตั้งใจจะทดสอบ
 */
async function seedNameMismatchCase(
  client: pg.Client
): Promise<{ companyId: number; localId: number; localName: string; odooName: string } | null> {
  const { rows } = await client.query(
    `SELECT company_id, contact_name
       FROM public.customers_data_view
      WHERE source <> 'local' AND contact_id > 0
        AND contact_name IS NOT NULL AND length(btrim(contact_name)) BETWEEN 4 AND 60
        AND btrim(contact_name) !~ '^(คุณ|นางสาว|นาง|นาย)'
      ORDER BY company_id, contact_id
      LIMIT 1`
  );
  if (rows.length === 0) return null;

  const companyId = Number(rows[0].company_id);
  const odooName: string = String(rows[0].contact_name).trim();
  const localName = `คุณ${odooName}`;
  const { rows: ins } = await client.query(
    `INSERT INTO public.local_contacts (company_id, contact_name) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING contact_id`,
    [companyId, localName]
  );
  if (ins.length === 0) return null;

  const localId = Number(ins[0].contact_id);
  await ensureDirectoryRow(
    { contact_id: localId, company_id: companyId, contact_name: localName, contact_phone: null, contact_email: null },
    client
  );
  return { companyId, localId, localName, odooName };
}

/**
 * ข้อ 6 — สัญญาของ endpoint: ชื่อซ้ำ → `409` พร้อมแถวเดิม · บริษัทไม่มีจริง → `400`
 *
 * ⚠️ ส่วนนี้ **ยิงฐานจริงผ่าน pool ไม่ใช่ใน tx ที่ ROLLBACK** เพราะ `createLocalContact()`
 *    เปิด `withTransaction()` ของตัวเองบน pool ⇒ ถ้าเรียกจากใน tx ของด่าน สองฝั่งจะมองไม่เห็นกัน
 *    และสิ่งที่ได้ทดสอบจะเป็นสำเนาของตรรกะ ไม่ใช่ทางที่ endpoint เดินจริง
 *    ท่านี้เหมือน `diag:pricing` ทุกประการ: **เขียนของจริงแล้วลบทิ้งใน `finally`** แล้ว
 *    **ยืนยันซ้ำตอนจบว่าไม่เหลือแถวของด่านอยู่เลย** — ถ้าเหลือ ด่านนี้ล้มเอง
 */
async function serviceContract(): Promise<void> {
  console.log(`\n${BOLD}สัญญาของ endpoint (ยิงฐานจริง แล้วลบทิ้ง)${RESET}`);
  const name = `${TAG} สัญญา ${Date.now()}`;
  let createdId: number | null = null;

  try {
    const { rows: pick } = await pool.query(
      `SELECT company_id FROM public.customers_data_view
        WHERE source <> 'local' AND contact_id > 0
        GROUP BY company_id ORDER BY company_id LIMIT 1`
    );
    if (pick.length === 0) {
      console.log(`${DIM}ข้าม: ฐานนี้ไม่มีบริษัทให้ใช้ทดสอบ${RESET}`);
      return;
    }
    const companyId = Number(pick[0].company_id);

    const created = await createLocalContact({ company_id: companyId, contact_name: name }, null);
    createdId = created.contact_id;
    const inView = await getContactById(created.contact_id);
    if (createdId >= 900000000 && inView) {
      ok('เพิ่มผู้ติดต่อสำเร็จ — ได้เลขในช่วง local และโผล่ใน view ทันที', `(contact_id ${createdId})`);
    } else {
      bad('เพิ่มผู้ติดต่อแล้วผลไม่ถูก', `id=${createdId} · อยู่ใน view=${!!inView}`);
    }

    // ชื่อซ้ำ → 409 **พร้อมแถวเดิม** ให้หน้าจอเสนอ "ใช้คนเดิม" ได้ (ไม่ใช่แค่บอกว่าซ้ำแล้วจบ)
    try {
      await createLocalContact({ company_id: companyId, contact_name: ` ${name} ` }, null);
      bad('ชื่อซ้ำแล้วยังเพิ่มได้ (ควรเป็น 409)');
    } catch (err) {
      const e = err as LocalContactError;
      const back = (e.detail as any)?.existing;
      if (e.status === 409 && e.code === 'DUPLICATE' && Number(back?.contact_id) === createdId) {
        ok('ชื่อซ้ำ (เทียบแบบ btrim) → 409 และคืนแถวเดิมมาให้เลือก', `("${back.contact_name}")`);
      } else {
        bad('ชื่อซ้ำแล้วได้ผลไม่ถูก', `status=${e.status} code=${e.code} existing=${JSON.stringify(back)}`);
      }
    }

    // บริษัทไม่มีจริง → 400 · นี่คือการบังคับ "ห้ามสร้างบริษัทใหม่" ซึ่งเป็นขอบเขตของทั้งโมดูล
    try {
      await createLocalContact({ company_id: 2147480000, contact_name: `${name} ผี` }, null);
      bad('บริษัทที่ไม่มีจริงแล้วยังเพิ่มได้ (ควรเป็น 400)');
    } catch (err) {
      const e = err as LocalContactError;
      if (e.status === 400 && e.code === 'BAD_REQUEST') ok('บริษัทไม่มีจริง → 400 (ห้ามสร้างบริษัทใหม่)');
      else bad('บริษัทไม่มีจริงแล้วได้ผลไม่ถูก', `status=${e.status} code=${e.code}`);
    }

    // ชื่อว่างหลัง trim → 400 (ไม่ใช่ไปตายที่ CHECK local_contacts_name_not_blank)
    try {
      await createLocalContact({ company_id: companyId, contact_name: '   ' }, null);
      bad('ชื่อว่างแล้วยังเพิ่มได้ (ควรเป็น 400)');
    } catch (err) {
      const e = err as LocalContactError;
      if (e.status === 400) ok('ชื่อว่างหลัง trim → 400 ตั้งแต่ปากทาง ไม่ใช่ไปตายที่ CHECK ของฐาน');
      else bad('ชื่อว่างแล้วได้ผลไม่ถูก', `status=${e.status} code=${e.code}`);
    }

    // แก้ไขได้ตอนยังไม่มีใบอ้างถึง — และแถวใน view ต้องเดินตามทันที ไม่ใช่รอ rebuild
    const renamed = `${name} แก้แล้ว`;
    await updateLocalContactById(createdId, { contact_name: renamed, contact_phone: '02-111-2222' });
    const after = await getContactById(createdId);
    if (after && String(after.name) === renamed && String(after.phone) === '02-111-2222') {
      ok('แก้ชื่อ/เบอร์แล้วแถวใน customers_data_view เดินตามทันที');
    } else {
      bad('แก้แล้วแถวใน view ไม่ตาม', `name=${after?.name} phone=${after?.phone}`);
    }

    await deleteLocalContactById(createdId);
    const gone = await getContactById(createdId);
    if (!gone) { ok('ลบแล้วหายทั้งสองที่ (ตารางจริง + แถวใน view)'); createdId = null; }
    else bad('ลบแล้วแถวใน view ยังอยู่');
  } catch (err) {
    fail++;
    console.error(`${RED}สัญญาของ endpoint ล้มกลางคัน:${RESET}`, err);
  } finally {
    // ⚠️ ส่วนนี้เขียนของจริง จึงต้องเก็บกวาดเองและ **พิสูจน์ว่าเก็บครบ** ไม่ใช่เชื่อว่าเก็บแล้ว
    await pool.query(`DELETE FROM public.customers_data_view WHERE contact_name LIKE $1`, [`${TAG}%`]);
    await pool.query(`DELETE FROM public.local_contacts WHERE contact_name LIKE $1`, [`${TAG}%`]);
    const { rows: left } = await pool.query(
      `SELECT (SELECT count(*)::int FROM public.local_contacts     WHERE contact_name LIKE $1) AS t,
              (SELECT count(*)::int FROM public.customers_data_view WHERE contact_name LIKE $1) AS v`,
      [`${TAG}%`]
    );
    if (left[0].t === 0 && left[0].v === 0) ok('เก็บกวาดครบ — ไม่เหลือผู้ติดต่อของด่านในฐานเลย');
    else bad('เหลือผู้ติดต่อของด่านค้างในฐาน', `local_contacts=${left[0].t} · view=${left[0].v}`);
    await pool.end();
  }
}

async function main(): Promise<void> {
  const client = new pg.Client({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT ? parseInt(process.env.PG_PORT) : undefined,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
  });

  await client.connect();
  await client.query('BEGIN');

  try {
    const { rows: leftover } = await client.query('SELECT count(*)::int AS n FROM public.local_contacts');
    if (leftover[0].n > 0) {
      console.log(`${DIM}หมายเหตุ: ฐานนี้มีผู้ติดต่อ local อยู่แล้ว ${leftover[0].n} คน — ด่านนับส่วนต่างเอา${RESET}`);
    }

    // ── ข้อ 2 (ครึ่งแรก) + ฐานอ้างอิงของข้อ 1 ──────────────────────────────
    const msEmpty = await timedBuild(client, 'cdv_before');
    const { rows: beforeCount } = await client.query('SELECT count(*)::int AS n FROM cdv_before');
    console.log(`${DIM}build ก่อนเพิ่มใคร: ${msEmpty} ms · ${beforeCount[0].n} แถว${RESET}`);

    // ── เพิ่มผู้ติดต่อทดสอบ 2 คน: บริษัทธรรมดา 1 + บริษัทที่ต้องสืบทอดทีมขาย 1 ──
    const [plainCompany] = await pickCompanies(client, 1);
    const inheritCompany = await pickInheritCompany(client);
    const seedCompanies = inheritCompany ? [plainCompany, inheritCompany] : [plainCompany];

    const seeded: Array<{ contact_id: number; company_id: number; contact_name: string }> = [];
    for (const companyId of seedCompanies) {
      const { rows } = await client.query(
        `INSERT INTO public.local_contacts (company_id, contact_name, job_position, contact_phone, contact_email)
         VALUES ($1, $2, 'ตำแหน่งทดสอบ', '02-000-0000', 'diag@example.com')
         RETURNING contact_id, company_id, contact_name`,
        [companyId, `${TAG} ${companyId}`]
      );
      seeded.push(rows[0]);
    }

    const msSeeded = await timedBuild(client, 'cdv_after');

    // ── ข้อ 1: แถวของ Odoo ต้องไม่ขยับแม้แต่บิตเดียว ───────────────────────
    const { rows: drift } = await client.query(
      `SELECT
         (SELECT count(*)::int FROM (TABLE cdv_before EXCEPT ALL SELECT * FROM cdv_after WHERE source <> 'local') a) AS lost,
         (SELECT count(*)::int FROM (SELECT * FROM cdv_after WHERE source <> 'local' EXCEPT ALL TABLE cdv_before) b)  AS gained`
    );
    if (drift[0].lost === 0 && drift[0].gained === 0) {
      ok('แถวของ Odoo ไม่ขยับสักบิตหลังมีแถว local', `(เทียบสองทาง ${beforeCount[0].n} แถว × 24 คอลัมน์)`);
    } else {
      bad('แถวของ Odoo เปลี่ยนไปหลังเพิ่ม Arm 3', `หาย ${drift[0].lost} · เกิน ${drift[0].gained}`);
    }

    const { rows: added } = await client.query(
      `SELECT count(*)::int AS n FROM cdv_after WHERE source = 'local' AND contact_name LIKE $1`,
      [`${TAG}%`]
    );
    if (added[0].n === seeded.length) {
      ok('ผู้ติดต่อที่เพิ่ง INSERT โผล่ใน view ครบ', `(${added[0].n} คน)`);
    } else {
      bad('จำนวนแถว local ใน view ไม่ตรงกับที่ INSERT', `คาด ${seeded.length} ได้ ${added[0].n}`);
    }

    // ── ข้อ 3: dual-write เทียบ Arm 3 ทีละคอลัมน์ ──────────────────────────
    const { rows: cols } = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'customers_data_view'
        ORDER BY ordinal_position`
    );
    const columnNames: string[] = cols.map((c) => c.column_name);

    for (const row of seeded) {
      const { rows: full } = await client.query(
        'SELECT contact_phone, contact_email FROM public.local_contacts WHERE contact_id = $1',
        [row.contact_id]
      );
      const wrote = await ensureDirectoryRow(
        {
          contact_id: row.contact_id,
          company_id: row.company_id,
          contact_name: row.contact_name,
          contact_phone: full[0].contact_phone,
          contact_email: full[0].contact_email,
        },
        client
      );
      if (!wrote) {
        bad('dual-write ไม่ได้สร้างแถวให้', `contact_id ${row.contact_id}`);
        continue;
      }

      const diffs: string[] = [];
      for (const col of columnNames) {
        const { rows: cmp } = await client.query(
          `SELECT (SELECT ${col}::text FROM public.customers_data_view WHERE contact_id = $1) AS dual,
                  (SELECT ${col}::text FROM cdv_after                  WHERE contact_id = $1) AS arm3`
          , [row.contact_id]
        );
        if (cmp[0].dual !== cmp[0].arm3) diffs.push(`${col}: dual=${cmp[0].dual} arm3=${cmp[0].arm3}`);
      }
      if (diffs.length === 0) {
        ok(`dual-write = Arm 3 ครบทั้ง ${columnNames.length} คอลัมน์`, `(บริษัท ${row.company_id})`);
      } else {
        bad(`dual-write ไม่ตรงกับ Arm 3 ${diffs.length} คอลัมน์`, `\n    ${diffs.join('\n    ')}`);
      }
    }

    // ทีมขายของเคสสืบทอด: ต้องได้ค่าของพี่น้อง ไม่ใช่ค่าว่างของแถวตัวแทน
    if (inheritCompany) {
      const target = seeded.find((s) => s.company_id === inheritCompany)!;
      const { rows: team } = await client.query(
        `SELECT (SELECT sales_team FROM cdv_after WHERE contact_id = $1) AS got,
                (SELECT (array_remove(array_agg(sales_team ORDER BY contact_id), NULL))[1]
                   FROM cdv_after WHERE company_id = $2 AND source <> 'local') AS expected`,
        [target.contact_id, inheritCompany]
      );
      if (team[0].got && team[0].got === team[0].expected) {
        ok('ทีมขายสืบทอดจากพี่น้อง ไม่ใช่ค่าว่างของแถวตัวแทน', `(บริษัท ${inheritCompany} → ${team[0].got})`);
      } else {
        bad('ทีมขายที่สืบทอดมาไม่ถูก', `ได้ ${team[0].got} · ควรเป็น ${team[0].expected}`);
      }
    } else {
      console.log(`${DIM}ข้าม: ฐานนี้ไม่มีบริษัทที่แถวตัวแทนทีมขายว่างแต่พี่น้องมีค่า${RESET}`);
    }


    // ═══════════════════════════════════════════════════════════════════════
    //  ข้อ 4 (ข) — บริษัทที่ไม่มีทีมขายเลย ต้องได้ NULL และ INSERT ต้องผ่าน
    //
    //  ตัวจับคนที่เผลอใส่ NOT NULL หรือหาค่า default มาเติมให้ "ดูดีขึ้น" — 59.1% ของบริษัท
    //  (31,605 จาก 53,490 วัด 2026-09-17) ไม่มีทีมขายเลย ⇒ ผู้ติดต่อใหม่ของกลุ่มนี้ต้องได้
    //  ทีมขายว่าง **และนั่นคือค่าที่ถูกต้อง ไม่ใช่ข้อมูลขาด** (เจ้าของเคาะ 2026-09-17 · §3.5 ข้อ 3)
    // ═══════════════════════════════════════════════════════════════════════
    const noTeamCompany = await pickNoTeamCompany(client);
    if (noTeamCompany !== null) {
      const { rows: ins } = await client.query(
        `INSERT INTO public.local_contacts (company_id, contact_name)
         VALUES ($1, $2) RETURNING contact_id`,
        [noTeamCompany, `${TAG} ไร้ทีม ${noTeamCompany}`]
      );
      const noTeamId = Number(ins[0].contact_id);
      const wrote = await ensureDirectoryRow(
        { contact_id: noTeamId, company_id: noTeamCompany, contact_name: `${TAG} ไร้ทีม ${noTeamCompany}`,
          contact_phone: null, contact_email: null },
        client
      );
      const { rows: t } = await client.query(
        'SELECT sales_team FROM public.customers_data_view WHERE contact_id = $1', [noTeamId]);
      if (wrote && t.length === 1 && t[0].sales_team === null) {
        ok('บริษัทที่ไม่มีทีมขายเลย → เพิ่มผ่าน และได้ NULL (ไม่ใช่ค่าที่หามาเติมให้)',
          `(บริษัท ${noTeamCompany})`);
      } else {
        bad('ผู้ติดต่อของบริษัทที่ไม่มีทีมขาย ผลไม่ถูก',
          `เขียนแถว=${wrote} · แถวใน view=${t.length} · sales_team=${t[0]?.sales_team}`);
      }
    } else {
      console.log(`${DIM}ข้าม: ฐานนี้ไม่มีบริษัทที่ไม่มีทีมขายเลยสักแถว${RESET}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ข้อ 5 — โผล่ในฟังก์ชันจริงที่ทั้งระบบใช้อ่านผู้ติดต่อ ทันทีที่เพิ่ม
    //
    //  นี่คือข้อที่พิสูจน์ว่า "ต่อท่อเข้า customers_data_view" ได้ผลจริง — ถ้าข้อนี้ผ่าน แปลว่า
    //  picker ของ LIFF · findContactCandidates ของแชท · และ reverse lookup เห็นคนใหม่หมด
    //  โดยไม่มีใครต้องแก้โค้ดที่อ่านลูกค้าสักบรรทัด (ซึ่งเป็นเหตุผลทั้งหมดของทางที่เลือก)
    // ═══════════════════════════════════════════════════════════════════════
    const probe = seeded[0];
    const listed = await getContactsByCustomerId(probe.company_id, client);
    const one = await getContactById(probe.contact_id, client);
    const related = await getRelatedContactsByCustomerId(probe.company_id, client);

    const inList = listed.some((c: any) => Number(c.id) === probe.contact_id);
    const inRelated = related.some((c: any) => Number(c.id) === probe.contact_id);
    if (inList && one && Number(one.id) === probe.contact_id && inRelated) {
      ok('ผู้ติดต่อใหม่โผล่ครบทั้ง 3 ทาง (รายการบริษัท · รายตัว · นิติบุคคลเดียวกัน)',
        `(customer_id ที่คืนมา = ${one.customer_id})`);
    } else {
      bad('ผู้ติดต่อใหม่ไม่โผล่ในฟังก์ชันอ่านผู้ติดต่อ',
        `รายการบริษัท=${inList} · รายตัว=${!!one} · พี่น้อง=${inRelated}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ข้อ 7 — odoo_matched_at ถูกเขียน ⟺ แถว local ถูกซ่อนจาก view
    //
    //  สัญญาณ A ใช้เกณฑ์เดียวกับ CTE local_taken ของ Arm 3 ทุกตัวอักษร ⇒ ความเท่ากันนี้
    //  ต้องเป็นจริงเสมอ ไม่ใช่บังเอิญ · ถ้าวันหนึ่งมีคนแก้ฝั่งเดียว จะเกิดสถานะที่อธิบายไม่ได้:
    //  "ระบบบอกว่าเข้า Odoo แล้ว แต่ยังโผล่ซ้ำสองแถวใน picker" หรือกลับกัน
    // ═══════════════════════════════════════════════════════════════════════
    const twinCompany = (await pickCompanies(client, 1))[0];
    const { rows: twin } = await client.query(
      `SELECT contact_name FROM public.customers_data_view
        WHERE company_id = $1 AND source <> 'local' AND contact_id > 0
          AND contact_name IS NOT NULL AND btrim(contact_name) <> ''
        ORDER BY contact_id LIMIT 1`,
      [twinCompany]
    );
    if (twin.length === 1) {
      // เพิ่มผู้ติดต่อ local ที่ชื่อ **ตรงเป๊ะ** กับคนที่ Odoo มีอยู่แล้ว = สถานะ "คีย์เข้า Odoo สำเร็จ"
      const odooName: string = twin[0].contact_name;
      const { rows: ins } = await client.query(
        `INSERT INTO public.local_contacts (company_id, contact_name)
         VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING contact_id`,
        [twinCompany, odooName]
      );
      if (ins.length === 1) {
        const twinId = Number(ins[0].contact_id);
        const marked = await markMatchedByContactSync(client);
        const { rows: after } = await client.query(
          'SELECT odoo_matched_at, odoo_matched_by FROM public.local_contacts WHERE contact_id = $1', [twinId]);
        await client.query('CREATE TEMP TABLE cdv_twin AS SELECT * FROM public.customers_data_build');
        const { rows: hidden } = await client.query(
          'SELECT count(*)::int AS n FROM cdv_twin WHERE contact_id = $1', [twinId]);
        await client.query('DROP TABLE cdv_twin');

        const wasMarked = after[0]?.odoo_matched_at !== null;
        const isHidden = hidden[0].n === 0;
        if (wasMarked && isHidden && after[0].odoo_matched_by === 'contact_sync') {
          ok('สัญญาณ A: มาร์กว่าเข้า Odoo แล้ว ⟺ แถว local หายจาก view', `(มาร์ก ${marked} แถว)`);
        } else {
          bad('สัญญาณ A กับ local_taken ไม่ตรงกัน',
            `มาร์ก=${wasMarked} (${after[0]?.odoo_matched_by}) · ซ่อนจาก view=${isHidden}`);
        }
      } else {
        console.log(`${DIM}ข้าม ข้อ 7: ชื่อนี้มีแถว local อยู่แล้วบนฐานนี้${RESET}`);
      }
    } else {
      console.log(`${DIM}ข้าม ข้อ 7: บริษัทตัวอย่างไม่มีผู้ติดต่อที่มีชื่อ${RESET}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ข้อ 8 — สัญญาณ B ยิงจากใบที่นำเข้าแล้ว · และ **ไม่ยิง** เมื่อชื่อในใบไม่ตรงกับชื่อเรา
    //
    //  เงื่อนไข btrim(s.contact_name) = btrim(l.contact_name) ไม่ใช่ของประดับ — ถ้าไม่มี
    //  เงื่อนไขนี้จะไปคว้า partner ระดับ *บริษัท* ของใบมาเป็น "ผู้ติดต่อ" แล้วมาร์กว่าเข้า Odoo
    //  แล้วทั้งที่ยังไม่มีคนนั้นอยู่จริง ⇒ ใบถัดไปหลุดเข้าไฟล์ปกติแล้วไปตกที่ปลายทาง
    //  ด่านนี้จึงตรวจ **ทั้งด้านที่ควรยิงและด้านที่ต้องไม่ยิง** ไม่ใช่ด้านเดียว
    // ═══════════════════════════════════════════════════════════════════════
    const soCase = await seedImportedOrderCase(client);
    if (soCase) {
      const fired = await markMatchedByImportedOrder(client);
      const { rows: chk } = await client.query(
        `SELECT contact_id, odoo_matched_by FROM public.local_contacts
          WHERE contact_id = ANY($1::int[]) AND odoo_matched_at IS NOT NULL`,
        [[soCase.matchId, soCase.mismatchId]]
      );
      const matchedIds = chk.map((r) => Number(r.contact_id));
      const hitRight = matchedIds.includes(soCase.matchId);
      const hitWrong = matchedIds.includes(soCase.mismatchId);
      if (hitRight && !hitWrong && chk.every((r) => r.odoo_matched_by === 'imported_order')) {
        ok('สัญญาณ B: ชื่อในใบที่นำเข้าแล้วตรงกัน ⇒ ยิง', `(ยิง ${fired} แถว)`);
        ok('  และชื่อไม่ตรง ⇒ **ไม่ยิง** (กันหยิบ partner ของบริษัทมาเป็นผู้ติดต่อ)');
      } else {
        bad('สัญญาณ B ยิงผิดด้าน', `ตรงกัน=${hitRight} · ไม่ตรงแต่ยิง=${hitWrong}`);
      }
    } else {
      console.log(`${DIM}ข้าม ข้อ 8: ฐานนี้ไม่มี sale_orders ที่ใช้เป็นตัวอย่างได้${RESET}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ข้อ 9 — คีย์ชื่อใน Odoo ไม่ตรงเป๊ะ → ได้ 2 แถว + ป้าย 🔴 ชี้ชื่อที่ชน
    //
    //  นี่คือกับดัก §7.4 ที่ทำให้ "มองเห็น" แทนที่จะปล่อยให้เงียบ: เว้นวรรคเกิน · เติม "คุณ"
    //  นำหน้า · สะกดต่าง → ทั้งสัญญาณ A และ B ไม่ยิง → แถว local ไม่ยอมหลบ → โผล่ซ้ำสองแถว
    //  ด่านนี้ยืนยันว่า **สองแถวเป็นพฤติกรรมที่รู้ตัว** และรายการชี้ชื่อที่ชนให้ดูได้
    // ═══════════════════════════════════════════════════════════════════════
    const mismatch = await seedNameMismatchCase(client);
    if (mismatch) {
      await client.query('CREATE TEMP TABLE cdv_mismatch AS SELECT * FROM public.customers_data_build');
      const { rows: both } = await client.query(
        `SELECT count(*)::int AS n FROM cdv_mismatch
          WHERE company_id = $1 AND contact_id > 0
            AND (contact_id = $2 OR btrim(contact_name) = btrim($3))`,
        [mismatch.companyId, mismatch.localId, mismatch.odooName]
      );
      await client.query('DROP TABLE cdv_mismatch');

      const { items } = await listLocalContacts({ filter: 'pending' }, client);
      const row = items.find((r) => Number(r.contact_id) === mismatch.localId);
      const view = row ? decorate(row) : null;

      if (both[0].n === 2 && view?.status === 'name_mismatch' && view.similar_odoo_name) {
        ok('ชื่อไม่ตรงเป๊ะ → โผล่ 2 แถว และป้าย 🔴 ชี้ชื่อที่ชนให้',
          `("${mismatch.localName}" ชนกับ "${view.similar_odoo_name}")`);
      } else {
        bad('เคสชื่อไม่ตรงไม่ได้ผลอย่างที่ควรเป็น',
          `แถวใน view=${both[0].n} (ควรเป็น 2) · สถานะ=${view?.status} · ชื่อที่ชน=${view?.similar_odoo_name}`);
      }
    } else {
      console.log(`${DIM}ข้าม ข้อ 9: ฐานนี้ไม่มีผู้ติดต่อที่เอามาทำเคสชื่อเพี้ยนได้${RESET}`);
    }

    // ── ข้อ 2: เพิ่มคนเยอะแล้วเวลา build ต้องไม่วิ่งตามจำนวนคน ─────────────
    //
    // ตารางของข้อ 1/3 ต้องถูกทิ้งก่อน ไม่งั้นมันกินที่ temp จนรอบวัดทั้งคู่เพี้ยน
    await client.query('DROP TABLE cdv_before');
    await client.query('DROP TABLE cdv_after');

    const manyCompanies = await pickCompanies(client, 200);
    const bulkNames = manyCompanies.map((c) => `${TAG} โหลด ${c}`);

    // สลับ "ว่าง ↔ เยอะ" สองรอบแล้วเอาค่าต่ำสุดของแต่ละฝั่ง — ค่าต่ำสุดทนต่อจังหวะที่เครื่อง
    // ไปทำอย่างอื่นพอดี ส่วนค่าเฉลี่ยไม่ทน (รอบเดียวที่สะดุดลากทั้งชุด)
    const emptyRuns: number[] = [];
    const bulkRuns: number[] = [];
    for (let i = 0; i < 2; i++) {
      await client.query('DELETE FROM public.local_contacts WHERE contact_name LIKE $1', [`${TAG} โหลด %`]);
      emptyRuns.push(await probeBuild(client));
      await client.query(
        `INSERT INTO public.local_contacts (company_id, contact_name)
         SELECT c, n FROM unnest($1::int[], $2::text[]) AS t(c, n)
         ON CONFLICT DO NOTHING`,
        [manyCompanies, bulkNames]
      );
      bulkRuns.push(await probeBuild(client));
    }
    const { rows: bulk } = await client.query('SELECT count(*)::int AS n FROM public.local_contacts');
    const msEmptyBest = Math.min(...emptyRuns);
    const msBulkBest = Math.min(...bulkRuns);

    // เพดาน: ช้าลงได้ไม่เกินครึ่งเท่า + 1 วิ · LATERAL ต่อแถวจะทะลุเพดานนี้หลายสิบเท่า
    // (seq scan 82,721 แถว × จำนวนผู้ติดต่อ local)
    const ceiling = Math.round(msEmptyBest * 1.5) + 1000;
    const detail = `${bulk[0].n} คน: ${msBulkBest} ms (${bulkRuns.join('/')}) · ว่าง ${msEmptyBest} ms (${emptyRuns.join('/')}) · เพดาน ${ceiling} ms`;
    if (msBulkBest <= ceiling) {
      ok('เวลา build ไม่วิ่งตามจำนวนผู้ติดต่อ local', `(${detail})`);
    } else {
      bad('build ช้าลงผิดปกติเมื่อมีผู้ติดต่อ local เยอะ', detail);
    }
  } catch (err) {
    fail++;
    console.error(`\n${RED}ด่านล้มกลางคัน:${RESET}`, err);
  } finally {
    // ⚠️ ห้ามเปลี่ยนเป็น COMMIT — ด่านนี้เขียน local_contacts และ customers_data_view ของจริง
    await client.query('ROLLBACK');
    await client.end();
  }

  // ต้องอยู่ **หลัง** ROLLBACK เสมอ — ส่วนนี้ยิง pool ซึ่งเป็นคนละ connection กับ tx ข้างบน
  // ถ้ารันคร่อมกัน มันจะรอ lock ของแถวที่ tx ข้างบนถืออยู่แล้วค้างจนหมดเวลา
  await serviceContract();

  console.log(`\n${BOLD}สรุป:${RESET} ${GREEN}ผ่าน ${pass}${RESET} · ${fail > 0 ? RED : DIM}ล้ม ${fail}${RESET}`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
