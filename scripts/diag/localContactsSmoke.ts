// ─────────────────────────────────────────────────────────────────────────────
//  localContactsSmoke — ด่านของโมดูล "เพิ่มผู้ติดต่อเอง" (`local_contacts`)
//  รัน:  npm run diag:local-contacts          (ไม่ต้องเปิดเซิร์ฟเวอร์ — ยิงฐานตรง)
//  แผน: docs/plan-local-contacts.md §8 — ก้อน I1 ปิดข้อ 1–3 ส่วนข้อ 4–9 ตามมาที่ I2
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
import { ensureDirectoryRow } from '../../db/localContactsRepo.js';
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

  console.log(`\n${BOLD}สรุป:${RESET} ${GREEN}ผ่าน ${pass}${RESET} · ${fail > 0 ? RED : DIM}ล้ม ${fail}${RESET}`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
