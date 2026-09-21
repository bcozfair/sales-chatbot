// ─────────────────────────────────────────────────────────────────────────────
//  ⚠️⚠️  ไฟล์นี้ใช้ได้เฉพาะ "เครื่อง dev" เท่านั้น — ห้ามรันบน PMSV / production ทุกกรณี  ⚠️⚠️
//
//  มันเขียนข้อมูลปลอมลงฐานจริงและ **commit** (ไม่ได้อยู่ในทรานแซกชันที่ ROLLBACK เหมือน
//  scripts/diag/*Smoke.ts บางตัว) สิ่งที่มันแตะ:
//     · quotations            — เพิ่มใบทดสอบ 4 ใบ (ทั้งหมดติดธง customer_details.seed_tag)
//     · salesperson           — เพิ่มเซลส์ปลอม 1 คน (quotations.user_id เป็น FK ไปตารางนี้)
//     · customers_data_view   — **เพิ่ม/ลบแถวผู้ติดต่อปลอม** ในตารางที่ทั้งระบบใช้อ่านลูกค้า
//     · quotation_counters    — ตัวนับของเดือนปลอม 2098-11 (ไม่แตะเลขเดือนจริง)
//
//  ฐานของ production คือฐานลูกค้าจริงและไม่มี staging (AGENTS.md B2) การรันไฟล์นี้ที่นั่น
//  = ใส่ลูกค้าปลอมเข้าฐานจริง และ **ทำให้ผู้ติดต่อจริงหายไปได้** ⇒ ตัวไฟล์เองจึงกัน 3 ชั้น:
//     1) PG_HOST ต้องเป็น localhost/127.0.0.1 (ในกล่อง prod ชื่อโฮสต์คือ `db`)
//     2) ชื่อฐานต้องไม่มีคำว่า prod
//     3) NODE_ENV ต้องไม่ใช่ production
//  ผิดข้อใดข้อหนึ่ง = ออกทันทีโดยไม่เขียนอะไรเลย
//
//  ทำไมต้องมี: เฟส H (ตรึงทีมขายลงใบตอนยืนยัน · docs/plan-web-quote-request.md §5.7) แก้อาการ
//  ที่ **เกิดจากเวลาผ่านไป** — ผู้ติดต่อหายจาก customers_data_view หลังใบออกไปแล้ว แล้วช่อง
//  Sales Team (คอลัมน์ I) ของไฟล์นำเข้า Odoo กลายเป็นว่างเงียบ ๆ บน production อาการนี้ต้องรอ
//  รอบ sync (~10 นาที) มาทำให้เกิดเอง ควบคุมไม่ได้ · ที่นี่สร้างสถานการณ์นั้นตรง ๆ ได้ใน 2 วินาที
//
//  รัน:
//    npx tsx scripts/dev/seedPhaseH.ts            # สร้างข้อมูลทดสอบ + พิมพ์ตารางผลที่ควรได้
//    npx tsx scripts/dev/seedPhaseH.ts --clean    # ลบทุกอย่างที่ไฟล์นี้สร้าง (ต้องรันทุกครั้งที่ทดสอบเสร็จ)
//
//  หลัง seed ให้ตรวจด้วย:  npm run diag:odoo-export -- --limit 50
//  (ใบทดสอบ created_at เป็นปี 2098 จึงลอยขึ้นหัวรายการ ORDER BY created_at DESC เสมอ)
//
//  ⚠️ ข้อมูลที่ seed ลง customers_data_view จะหายเองถ้ามีใครสั่ง sync ลูกค้าระหว่างนั้น
//     (refreshCustomerDirectory สร้างตารางใหม่ทั้งก้อนแล้วสลับชื่อ) — ไม่ใช่บั๊ก และ `--clean`
//     ยังใช้ได้ตามปกติ
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from '../../config/db.js';
import { confirmQuotationAtomic } from '../../services/quotationService.js';

// ── ด่านกัน production 3 ชั้น ────────────────────────────────────────────────
const host = String(process.env.PG_HOST || '').trim().toLowerCase();
const dbName = String(process.env.PG_DATABASE || '').trim().toLowerCase();
const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
if (!isLocalHost || dbName.includes('prod') || process.env.NODE_ENV === 'production') {
  console.error('✗ ปฏิเสธ: สคริปต์นี้รันได้เฉพาะฐานบนเครื่อง dev เท่านั้น');
  console.error(`   PG_HOST="${process.env.PG_HOST ?? ''}" PG_DATABASE="${process.env.PG_DATABASE ?? ''}" NODE_ENV="${process.env.NODE_ENV ?? ''}"`);
  process.exit(1);
}

const SEED_TAG = 'phase-h-seed';
const USER_ID = 'Useedphaseh00000001';        // เซลส์ปลอม — FK ของ quotations.user_id
const COMPANY_ID = 995000001;                  // ช่วง 995 ล้าน: ไม่ชนทั้งเลขของ Odoo (~1.03 ล้าน)
const CONTACT_STAYS = 995000101;               // และไม่ชนช่วง 900 ล้านที่เฟส I จองไว้ให้ local_contacts
const CONTACT_VANISHES = 995000102;
const TEAM_STAYS = 'ทีมทดสอบเฟส H (อยู่ในฐาน)';
const TEAM_VANISHES = 'ทีมทดสอบเฟส H (หายจากฐาน)';
// เดือนปลอม 2098-11 → counter key 'QP:9811' ไม่ไปดันเลขของเดือนจริง (ท่าเดียวกับ confirmRaceDiag)
const CREATED_AT = '2098-11-01T00:00:00+07:00';
const COUNTER_KEY = 'QP:9811';

const clean = process.argv.includes('--clean');

async function removeSeed(): Promise<void> {
  const q = await pool.query(
    `DELETE FROM quotations WHERE customer_details->>'seed_tag' = $1`, [SEED_TAG]);
  const cdv = await pool.query(
    `DELETE FROM customers_data_view WHERE company_id = $1`, [COMPANY_ID]);
  await pool.query(`DELETE FROM salesperson WHERE user_id = $1`, [USER_ID]);
  await pool.query(`DELETE FROM quotation_counters WHERE counter_key = $1`, [COUNTER_KEY]);
  console.log(`   ลบใบทดสอบ ${q.rowCount} ใบ · แถวผู้ติดต่อปลอมใน customers_data_view ${cdv.rowCount} แถว · เซลส์ปลอม 1 คน · counter ${COUNTER_KEY}`);
}

/** แถวผู้ติดต่อปลอมใน customers_data_view — คอลัมน์ที่เหลือปล่อย NULL ได้ (ตารางนี้ไม่มี NOT NULL) */
async function upsertDirectoryRow(contactId: number, contactName: string, team: string): Promise<void> {
  await pool.query(
    `INSERT INTO customers_data_view
       (company_id, contact_id, source, customer_name, contact_name, sales_team, customer_payment_terms)
     VALUES ($1, $2, 'odoo', $3, $4, $5, 'Cash')
     ON CONFLICT (company_id, contact_id) DO UPDATE
        SET contact_name = EXCLUDED.contact_name, sales_team = EXCLUDED.sales_team`,
    [COMPANY_ID, contactId, 'บริษัท ทดสอบเฟส H จำกัด', contactName, team]
  );
}

/** ใบทดสอบ 1 ใบ — คืน id · confirmed=true คือ "ใบที่ยืนยันไปก่อนเฟส H" (เขียน status ตรง ๆ ไม่ผ่านโค้ด) */
async function insertQuote(
  label: string, contactId: number, opts: { preConfirmedNo?: string } = {}
): Promise<string> {
  const item = {
    model: 'SEED-PHASE-H',              // ไม่มีใน products → ไม่ติดกฎราคาขั้นต่ำ/สต็อก
    internal_reference: 'SEED-PHASE-H',
    name: 'สินค้าทดสอบเฟส H',
    price: 1000,
    quantity: 1,
    discount_1: 0,
    discount_2: 0,
    production: 'Local',                // ไม่ใช่ Import(PM) → เลขขึ้นต้น QP
  };
  const customer = {
    seed_tag: SEED_TAG,
    seed_label: label,
    customer_name: 'บริษัท ทดสอบเฟส H จำกัด',
    contact_name: contactId === CONTACT_STAYS ? 'คุณอยู่ครบ ทดสอบ' : 'คุณหายไป ทดสอบ',
    payment_terms: 'Cash',
  };
  const employee = { name: 'Seed Sales', saleperson: 'Seed Sales', salesperson_id: 'SEED01' };
  const { rows } = await pool.query(
    `INSERT INTO quotations
       (user_id, status, quotation_no, total_sum, customer_id, contact_id,
        customer_details, item_details, employee_details, created_at, updated_at)
     VALUES ($1, $2, $3, 1000, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
    [USER_ID, opts.preConfirmedNo ? 'confirmed' : 'draft', opts.preConfirmedNo ?? null,
     COMPANY_ID, contactId,
     JSON.stringify(customer), JSON.stringify([item]), JSON.stringify(employee), CREATED_AT]
  );
  return rows[0].id;
}

async function main(): Promise<void> {
  console.log(`ฐานเป้าหมาย: ${process.env.PG_DATABASE}@${process.env.PG_HOST} (ผ่านด่านกัน production แล้ว)\n`);

  if (clean) {
    console.log('── ลบข้อมูลทดสอบของเฟส H ──');
    await removeSeed();
    console.log('เสร็จ');
    return;
  }

  console.log('── ล้างของรอบก่อน (ถ้ามี) ──');
  await removeSeed();

  console.log('\n── สร้างข้อมูลทดสอบ ──');
  await pool.query(
    `INSERT INTO salesperson (user_id, salesperson_id, name) VALUES ($1, 'SEED01', 'Seed Sales')
     ON CONFLICT (user_id) DO NOTHING`, [USER_ID]);
  await upsertDirectoryRow(CONTACT_STAYS, 'คุณอยู่ครบ ทดสอบ', TEAM_STAYS);
  await upsertDirectoryRow(CONTACT_VANISHES, 'คุณหายไป ทดสอบ', TEAM_VANISHES);
  console.log(`   ผู้ติดต่อปลอม 2 คนใน customers_data_view (บริษัท ${COMPANY_ID})`);

  // 1) ใบที่ "ยืนยันไปก่อนเฟส H" — เขียน status/เลขที่ใบตรง ๆ ⇒ customer_sales_team เป็น NULL
  //    กลุ่มนี้คือหลักฐานว่าทางถอย (join สด) ยังทำงานเหมือนเดิมทุกบิต
  await insertQuote('เก่า-ผู้ติดต่อยังอยู่', CONTACT_STAYS, { preConfirmedNo: 'QP-981105901' });
  await insertQuote('เก่า-ผู้ติดต่อหายทีหลัง', CONTACT_VANISHES, { preConfirmedNo: 'QP-981105902' });

  // 2) ใบที่ยืนยัน "ด้วยโค้ดจริง" ผ่าน confirmQuotationAtomic ⇒ ต้องได้ค่าตรึง
  //    enrichedQuote ปลอมพอสำหรับการออกเลข (ใช้แค่ items/customer_name/created_at) — ทางเดียวกับที่
  //    quotationConfirm.ts เรียก แต่ข้ามขั้น enrich ที่ต้องมีสินค้าจริงในตาราง products
  const stayId = await insertQuote('ใหม่-ผู้ติดต่อยังอยู่', CONTACT_STAYS);
  const vanishId = await insertQuote('ใหม่-ผู้ติดต่อหายทีหลัง', CONTACT_VANISHES);
  for (const id of [stayId, vanishId]) {
    const { rows } = await pool.query(
      `SELECT customer_details, item_details, created_at FROM quotations WHERE id = $1`, [id]);
    const res = await confirmQuotationAtomic(id, {
      items: rows[0].item_details,
      customer_name: rows[0].customer_details?.customer_name,
      created_at: rows[0].created_at,
    });
    console.log(`   ยืนยันด้วยโค้ดจริง → ${res.outcome === 'confirmed' ? res.quotationNo : res.outcome}`);
  }

  // 3) จำลอง "ผู้ติดต่อหายจาก customers_data_view" — บน production เกิดเองตอน Odoo มีผู้ติดต่อจริง
  //    แล้ว sync กลับมา (เฟส I: Arm 3 ถอยแถว local ให้แถวจริง) ที่นี่สั่งให้เกิดเดี๋ยวนี้
  const gone = await pool.query(
    `DELETE FROM customers_data_view WHERE company_id = $1 AND contact_id = $2`,
    [COMPANY_ID, CONTACT_VANISHES]);
  console.log(`   ลบผู้ติดต่อ ${CONTACT_VANISHES} ออกจาก customers_data_view แล้ว (${gone.rowCount} แถว) = จำลองรอบ sync`);

  // ── ผลที่ควรได้ ─────────────────────────────────────────────────────────
  const { rows: check } = await pool.query(
    `SELECT q.quotation_no,
            q.customer_details->>'seed_label' AS label,
            q.customer_sales_team             AS frozen,
            cust.sales_team                   AS live
       FROM quotations q
       LEFT JOIN LATERAL (
         SELECT cd.sales_team FROM customers_data_view cd
          WHERE cd.contact_id = q.contact_id AND q.contact_id > 0
          ORDER BY (cd.company_id = q.customer_id) DESC NULLS LAST, cd.company_id LIMIT 1
       ) cust ON TRUE
      WHERE q.customer_details->>'seed_tag' = $1
      ORDER BY q.quotation_no`, [SEED_TAG]);

  console.log('\n── ผลที่ควรได้ในช่อง Sales Team (คอลัมน์ I) ──');
  for (const r of check) {
    const expect = r.frozen || r.live || '(ว่าง)';
    console.log(`   ${String(r.quotation_no).padEnd(14)} ${String(r.label).padEnd(26)} ตรึง=${r.frozen || '—'} · สด=${r.live || '—'} ⇒ ไฟล์ต้องได้ "${expect}"`);
  }
  console.log('\n   แถวที่พิสูจน์เฟส H คือ "ใหม่-ผู้ติดต่อหายทีหลัง": ตรึงมีค่า · สดว่าง ⇒ ไฟล์ต้องยังมีทีมขาย');
  console.log('   ส่วน "เก่า-ผู้ติดต่อหายทีหลัง" คืออาการก่อนเฟส H: ไม่มีค่าตรึง · สดว่าง ⇒ ไฟล์ได้ช่องว่าง\n');
  console.log('ตรวจต่อ:  npm run diag:odoo-export -- --limit 50');
  console.log('เสร็จแล้วล้างด้วย:  npx tsx scripts/dev/seedPhaseH.ts --clean');
}

try {
  await main();
} finally {
  await pool.end();
}
