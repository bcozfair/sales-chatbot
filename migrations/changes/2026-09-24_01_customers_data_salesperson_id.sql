-- customers_data_view.salesperson_id — รหัสพนักงานขายของลูกค้า (ต่อท้ายสุดของ view)
-- แผน: docs/plan-web-quote-auto-salesperson.md §3
--
-- ปัญหา: หน้าเว็บขอใบเสนอราคาต้องการเติม "ออกในนาม" ให้เองจากเซลส์เจ้าของลูกค้า แต่คอลัมน์
-- salesperson เป็นชื่อรูป 'คุณจิรายุ(PM)' ซึ่งไม่ตรงกับชื่อในตาราง salesperson ('คุณจิรายุ') สักชื่อ
-- (0/123 · วัด 2026-09-24) ⇒ ต้องมี "รหัส" ที่ใช้จับคู่กับตาราง salesperson ได้ตรง ๆ
--
-- ทางแก้: หารหัสจากชื่อผ่าน sale_orders (ชื่อรูปเดียวกัน + salesperson_id) ใน view ที่เดียว
-- แล้วต่อคอลัมน์ salesperson_id ไว้ **ท้ายสุด** — ไม่มีคอลัมน์เดิมขยับตำแหน่งแม้แต่ตัวเดียว
--
-- ⚠️ ไฟล์นี้ **แก้นิยาม view** ⇒ หลังรันต้อง refresh ด้วย { force: true } ไม่งั้นรอบถัดไปจะข้ามเพราะ
--    ข้อมูลต้นทางไม่ขยับ แล้วตารางจริงยังไม่มีคอลัมน์ใหม่ (CLAUDE.md เตือนไว้)
--      npx tsx -e "import('./scripts/sync/refreshCustomerDirectory.js').then(m=>m.refreshCustomerDataView({force:true}).then(console.log))"
-- ⚠️ ต้อง deploy โค้ด ensureDirectoryRow() ที่เติมคอลัมน์นี้ **พร้อมกัน** — ตัวเก่า INSERT
--    ตามตำแหน่งโดยไม่มีคอลัมน์นี้ ซึ่ง Postgres ยอม (เติม NULL ให้) จึงไม่พัง แต่ผู้ติดต่อที่เพิ่งเพิ่ม
--    จะไม่มีรหัสเซลส์จนกว่าจะ rebuild รอบหน้า
-- ⚠️ ต้นทุน: CTE sp_code ใช้ ~255ms ต่อรอบ build (index-only scan บน idx_so_salesperson_cover ·
--    วัด 2026-09-24) บน build เดิม ~2.1 วิ
--
-- ⚠️ ท่อน CREATE OR REPLACE VIEW ข้างล่างคัดมาจาก migrations/schema.sql ทั้งดุ้นด้วยสคริปต์
--    ไม่ได้พิมพ์ใหม่ · ที่เปลี่ยนมีสามจุดเท่านั้น: (ก) CTE sp_code ต่อท้าย ent_last
--    (ข) คอลัมน์ salesperson_id ท้าย SELECT (ค) LEFT JOIN sp_code ท้ายสุด

CREATE OR REPLACE VIEW public.customers_data_build AS
WITH latest_so AS (
  -- ยุบ sale_orders -> 1 แถว/contact (ใบล่าสุด)
  -- แยก 2 ขั้น: ขั้นแรกหา key ด้วย index-only scan (ไม่แตะ heap 366MB) แล้วค่อย join กลับด้วย PK
  SELECT
    k.contact_id, s.customer_name, s.customer_reference, s.customer_tax_id,
    s.contact_name, s.contact_mobile, s.contact_phone, s.customer_sale_area, s.salesperson, s.sales_team,
    s.invoice_street, s.invoice_district, s.invoice_sub_district, s.invoice_state, s.invoice_zip
  FROM (
    SELECT DISTINCT ON (contact_id) contact_id, order_reference
    FROM public.sale_orders
    WHERE contact_id > 0
    ORDER BY contact_id, order_date DESC NULLS LAST, order_reference DESC
  ) k
  JOIN public.sale_orders s ON s.order_reference = k.order_reference
),
base AS (
  -- ── Arm 1: ผู้ติดต่อหลักจาก customers (contact_id>=0 → รวมบริษัทที่ไม่มีผู้ติดต่อด้วย)
  --          address + sales_team blend customers -> latest sale_order ──
  SELECT
    c.company_id,
    c.contact_id,
    'odoo'::text                                 AS source,
    public.clean_text(c.customer_name)           AS customer_name,
    public.clean_text(c.customer_reference)      AS customer_reference,
    public.clean_text(c.customer_tax_id)         AS customer_tax_id,
    public.clean_text(c.customer_payment_terms)  AS customer_payment_terms,
    public.clean_text(c.customer_sale_area)      AS customer_sale_area,
    public.clean_text(c.salesperson)             AS salesperson,
    COALESCE(public.clean_text(c.sales_team),           public.clean_text(so.sales_team))          AS sales_team,
    public.clean_text(c.customer_type)           AS customer_type,
    public.clean_text(c.phone)                   AS phone,
    public.clean_text(c.mobile)                  AS mobile,
    public.clean_text(c.email)                   AS email,
    public.clean_text(c.contact_name)            AS contact_name,
    public.clean_text(c.contact_mobile)          AS contact_mobile,
    public.clean_text(c.contact_phone)           AS contact_phone,
    public.clean_text(c.contact_email)           AS contact_email,
    COALESCE(public.clean_text(c.invoice_street),       public.clean_text(so.invoice_street))       AS invoice_street,
    COALESCE(public.clean_text(c.invoice_district),     public.clean_text(so.invoice_district))     AS invoice_district,
    COALESCE(public.clean_text(c.invoice_sub_district), public.clean_text(so.invoice_sub_district)) AS invoice_sub_district,
    COALESCE(public.clean_text(c.invoice_state),        public.clean_text(so.invoice_state))        AS invoice_state,
    COALESCE(public.clean_text(c.invoice_zip),          public.clean_text(so.invoice_zip))          AS invoice_zip
  FROM public.customers c
  LEFT JOIN latest_so so ON so.contact_id = c.contact_id
  WHERE c.contact_id >= 0

  UNION ALL

  -- ── Arm 2: contact ที่มีเฉพาะใน sale_orders + enrich field บริษัท (payment/type/phone/mobile/email) จากบริษัทจริง via tax_id ──
  SELECT
    COALESCE(comp.company_id, s.contact_id)      AS company_id,
    s.contact_id,
    'saleorder'::text                            AS source,
    public.clean_text(s.customer_name)           AS customer_name,
    public.clean_text(s.customer_reference)      AS customer_reference,
    public.clean_text(s.customer_tax_id)         AS customer_tax_id,
    comp.customer_payment_terms                  AS customer_payment_terms,
    public.clean_text(s.customer_sale_area)      AS customer_sale_area,
    public.clean_text(s.salesperson)             AS salesperson,
    public.clean_text(s.sales_team)              AS sales_team,
    comp.customer_type                           AS customer_type,
    comp.phone                                   AS phone,
    comp.mobile                                  AS mobile,
    comp.email                                   AS email,
    public.clean_text(s.contact_name)            AS contact_name,
    public.clean_text(s.contact_mobile)          AS contact_mobile,
    public.clean_text(s.contact_phone)           AS contact_phone,
    NULL::text                                   AS contact_email,
    public.clean_text(s.invoice_street)          AS invoice_street,
    public.clean_text(s.invoice_district)        AS invoice_district,
    public.clean_text(s.invoice_sub_district)    AS invoice_sub_district,
    public.clean_text(s.invoice_state)           AS invoice_state,
    public.clean_text(s.invoice_zip)             AS invoice_zip
  FROM latest_so s
  LEFT JOIN LATERAL (
    SELECT c2.company_id,
      (array_remove(array_agg(public.clean_text(c2.customer_payment_terms) ORDER BY c2.contact_id), NULL))[1] AS customer_payment_terms,
      (array_remove(array_agg(public.clean_text(c2.customer_type)          ORDER BY c2.contact_id), NULL))[1] AS customer_type,
      (array_remove(array_agg(public.clean_text(c2.phone)                  ORDER BY c2.contact_id), NULL))[1] AS phone,
      (array_remove(array_agg(public.clean_text(c2.mobile)                 ORDER BY c2.contact_id), NULL))[1] AS mobile,
      (array_remove(array_agg(public.clean_text(c2.email)                  ORDER BY c2.contact_id), NULL))[1] AS email
    FROM public.customers c2
    WHERE c2.customer_tax_id = s.customer_tax_id
      AND s.customer_tax_id IS NOT NULL AND btrim(s.customer_tax_id) <> ''
    GROUP BY c2.company_id
    ORDER BY c2.company_id
    LIMIT 1
  ) comp ON true
  WHERE NOT EXISTS (SELECT 1 FROM public.customers c3 WHERE c3.contact_id = s.contact_id)
),
-- ── แถวตัวแทนของบริษัทที่มีผู้ติดต่อ local (ค่าระดับบริษัทยืมจากแถวนี้) ──
-- เขียนเป็น DISTINCT ON ครั้งเดียว ไม่ใช่ LATERAL ... LIMIT 1 ต่อแถว:
-- base ถูกอ้าง 6 ที่ ⇒ Postgres materialize มัน ⇒ LATERAL จะกลายเป็น seq scan 82,721 แถว
-- **ต่อผู้ติดต่อ local หนึ่งคน** ส่วนรูปนี้สแกนรอบเดียวแล้ว hash join
local_anchor AS (
  SELECT DISTINCT ON (b.company_id) b.*
    FROM base b
   WHERE b.company_id IN (SELECT company_id FROM public.local_contacts)
   ORDER BY b.company_id, b.contact_id
),
-- ── ทีมขาย: สืบทอดจาก "บริษัท" ไม่ใช่จากแถวตัวแทนดื้อ ๆ (เจ้าของเคาะ 2026-09-17) ──
-- หยิบค่าแรกที่ไม่ว่างเรียงตาม contact_id = กติกาเดียวกับ CTE comp ของคอลัมน์อื่น
-- วัด 2026-09-17: 663 จาก 53,490 บริษัท (1.2%) แถวตัวแทนมีทีมขายว่างทั้งที่พี่น้องมีค่า
--   ⇒ ถ้าใช้ค่าของแถวตัวแทนตรง ๆ ผู้ติดต่อใหม่ของ 663 บริษัทนี้จะได้ทีมขายว่างโดยไม่จำเป็น
--   · 320 บริษัท (0.6%) มีมากกว่าหนึ่งทีม ⇒ หยิบของ contact_id น้อยสุดที่ไม่ว่าง ให้ผลคงที่
-- ⚠️ บริษัทที่ไม่มีทีมขายเลย (59.1%) จะได้ NULL — ปล่อย NULL ไว้อย่างนั้น ไม่ต้องหาค่ามาเติม
-- ⚠️ ห้ามย้าย sales_team เข้า CTE comp เพื่อ "ให้เหมือนกัน" — comp มีคอมเมนต์กำกับว่าทีมขาย
--    ไม่ใช่คุณสมบัติของบริษัท (ผู้ติดต่อคนละคนอาจคนละทีม) การสืบทอดนี้ใช้ได้เฉพาะกับคนใหม่
--    ที่ไม่มีประวัติเท่านั้น ส่วนคนเดิมที่ Odoo ระบุทีมมาแล้ว ห้ามไปทับ
local_team AS (
  SELECT b.company_id,
         (array_remove(array_agg(b.sales_team ORDER BY b.contact_id), NULL))[1] AS sales_team
    FROM base b
   WHERE b.company_id IN (SELECT company_id FROM public.local_contacts)
   GROUP BY b.company_id
),
-- ── ผู้ติดต่อที่ Odoo สร้างให้แล้ว (ชื่อตรงกัน) — แถว local ต้องหลบให้ ──
-- anti-join แทน NOT EXISTS ต่อแถว ด้วยเหตุผลเดียวกับ local_anchor
-- นี่คือ "สัญญาณ A" ของ §6: แถวไหนหลบแล้ว = Odoo มีตัวจริงแล้ว
local_taken AS (
  SELECT DISTINCT l.contact_id
    FROM public.local_contacts l
    JOIN base b3 ON b3.company_id = l.company_id
                AND btrim(b3.contact_name) = btrim(l.contact_name)
),
-- ── Arm 3: ผู้ติดต่อที่แอดมินเพิ่มเองจากหน้าเว็บ (ยังไม่มีใน Odoo) ──
-- ลำดับคอลัมน์ต้องตรงกับ base เป๊ะ — UNION ALL จับคู่ตามตำแหน่ง ไม่ใช่ตามชื่อ
local_rows AS (
  SELECT
    l.company_id, l.contact_id, 'local'::text AS source,
    a.customer_name, a.customer_reference, a.customer_tax_id, a.customer_payment_terms,
    a.customer_sale_area, a.salesperson,
    t.sales_team,                       -- ← ค่าระดับบริษัท ไม่ใช่ a.sales_team ของแถวตัวแทน
    a.customer_type, a.phone, a.mobile, a.email,
    public.clean_text(l.contact_name)  AS contact_name,
    public.clean_text(l.contact_phone) AS contact_mobile,
    public.clean_text(l.contact_phone) AS contact_phone,
    public.clean_text(l.contact_email) AS contact_email,
    a.invoice_street, a.invoice_district, a.invoice_sub_district, a.invoice_state, a.invoice_zip
  FROM public.local_contacts l
  JOIN local_anchor a ON a.company_id = l.company_id
  JOIN local_team   t ON t.company_id = l.company_id
  WHERE l.contact_id NOT IN (SELECT contact_id FROM local_taken)
),
-- ⚠️ แถว local ต้องผ่าน SELECT ท้ายตัวเดียวกับคนอื่น ไม่ใช่ UNION ALL ต่อท้ายทั้ง view —
--    SELECT ท้ายคือที่ที่ COALESCE(b.customer_sale_area, comp.customer_sale_area) และคู่แฝด
--    (invoice_district / invoice_sub_district) ทำงาน ถ้าไม่ผ่านตรงนี้ ผู้ติดต่อใหม่จะมีที่อยู่
--    ไม่ครบทั้งที่คนอื่นในบริษัทเดียวกันครบ · และ last_order_at ก็มาจาก join ชุดนั้น
--    ⇒ ผู้ติดต่อใหม่ของลูกค้าที่ติดเครดิตค้างจะ **หลุดด่าน** ถ้าไม่ผ่าน
all_rows AS (SELECT * FROM base UNION ALL SELECT * FROM local_rows),
comp AS (
  -- company-level propagation: หยิบค่าที่ไม่ null ของ contact_id น้อยสุดในบริษัท
  -- (สาขา = คนละ company_id จึงไม่ปนสาขา · ORDER BY contact_id = ตัวที่ทำให้ผลคงที่)
  -- ⚠️ sales_team ไม่อยู่ในนี้โดยตั้งใจ — ทีมขายไม่ใช่คุณสมบัติของบริษัท ผู้ติดต่อคนละคนอาจคนละทีม
  SELECT company_id,
    (array_remove(array_agg(customer_sale_area   ORDER BY contact_id), NULL))[1] AS customer_sale_area,
    (array_remove(array_agg(invoice_district     ORDER BY contact_id), NULL))[1] AS invoice_district,
    (array_remove(array_agg(invoice_sub_district ORDER BY contact_id), NULL))[1] AS invoice_sub_district
  FROM base GROUP BY company_id
),
-- ════════════════════════════════════════════════════════════════════
-- last_order_at — "วันอ้างอิงของด่านตรวจเครดิต" ไม่ใช่วันสั่งซื้อล่าสุดตามชื่อ
--
-- ⚠️⚠️ ชื่อคอลัมน์หลอก อ่านนิยามให้จบก่อนเอาไปใช้ที่อื่น ⚠️⚠️
--   ค่าที่ได้ = วันที่ล่าสุดของใบที่ "ออกบิลแล้ว/รอออกบิล" ของนิติบุคคลนี้
--               และเฉพาะเมื่อนิติบุคคลนี้เป็นลูกค้าเครดิต/เช็คล่วงหน้าเท่านั้น
--   NULL     = ไม่เข้าข่ายตรวจ ซึ่งมีได้ 3 สาเหตุและด่านปฏิบัติเหมือนกันหมด (= ผ่าน):
--                1. ไม่ใช่ลูกค้าเครดิต (Cash / Immediate Payment / ไม่ได้ระบุใน Odoo)
--                2. เป็นเครดิต แต่ไม่มีใบสั่งซื้อเลยสักใบ  ← ลูกค้าใหม่ ต้องเสนอราคาได้
--                3. เป็นเครดิต มีใบ แต่ไม่เคยมีใบที่ออกบิลเลย (452 บริษัท ณ 2026-08-25)
--   ⇒ ห้ามเอาคอลัมน์นี้ไปแสดงเป็น "ลูกค้ารายนี้ซื้อครั้งสุดท้ายเมื่อไหร่" เด็ดขาด
--     ลูกค้า Cash ทุกรายจะได้ NULL ทั้งที่ซื้อประจำ
--   ตัวเลข ณ 2026-08-25: 42,640 บริษัทไม่ใช่เครดิต · 10,718 เป็นเครดิต · เข้าเกณฑ์ 1,656
--
-- ⚠️ sale_orders.company_id ไม่ใช่รหัสลูกค้า — เป็นบริษัทผู้ขาย (มีแค่ค่า 1 กับ 2)
--    จุดเชื่อมลูกค้าคือ contact_id เท่านั้น ห้ามเผลอ join ด้วย company_id
--
-- ⚠️ นิยาม "นิติบุคคลเดียวกัน" ตรงนี้ต้องตรงกับ db/companyIdentity.ts เสมอ
--    (เลขภาษี / รหัสอ้างอิง / ชื่อ ตรงข้อใดข้อหนึ่ง = รายเดียวกัน — 1 ชั้น ไม่ไล่ต่อเป็นทอด)
--    ถ้าแยกกันเมื่อไหร่ ด่านตรวจกับป้ายเตือนจะให้คำตอบคนละอย่าง
--    → scripts/diag/creditHoldSmoke.ts เทียบผลของสองที่นี้ทุกครั้งที่รัน
--
-- ทำไมต้องขยายเป็นนิติบุคคล ไม่ดูแค่ company_id ตัวเอง: Odoo แตกบริษัทเดียวเป็นหลายรหัส
-- วัดบนข้อมูลจริง 2026-08-20 — ถ้าไม่ขยาย จะมี 1,259 บริษัทที่ซื้อจริงใต้รหัสสาขาอื่น
-- ถูกนับเป็น "เงียบเกิน 1 ปี" ผิด ๆ (13% ของกลุ่มที่ยัง active อยู่)
-- ประเภทการชำระเงินก็ต้องขยายด้วยเหตุผลเดียวกัน: 579 นิติบุคคล (จาก 2,031 ที่มีหลายรหัส)
-- มีรหัสที่ประเภทไม่ตรงกัน ถ้าดูแค่รหัสที่เซลล์เลือก ลูกค้าเครดิตจะหลุดด่านได้ด้วยการ
-- เลือกรหัสสาขาที่เป็น Cash (ต่างกัน 215 บริษัท วัด 2026-08-25)
--
-- ทำไมคำนวณตรงนี้แทนที่จะถามตอนออกใบ: ถามทีละบริษัทตอนใช้งานจริงราคา ~190ms และ
-- ติดป้ายในผลค้นหา 30 รายพร้อมกันราคา 2.2 วิ (ใช้ไม่ได้) — ยุบมาคำนวณทั้งตารางรอบเดียว
-- ด้วย hash aggregate ล้วนราคา 1.5 วิ ต่อรอบ build แล้วตอนใช้งานเหลือ index lookup
-- ════════════════════════════════════════════════════════════════════
so_last AS (
  -- ใบล่าสุดต่อผู้ติดต่อ นับเฉพาะที่ออกบิลแล้ว/รอออกบิล
  --
  -- 'no' = Odoo บอกว่า "ไม่มีอะไรต้องวางบิล" ครอบทั้งใบที่ยกเลิก ใบร่าง และใบที่ยังไม่ส่งของ
  -- จึงไม่ใช่หลักฐานว่าลูกค้าจ่ายเงินจริง — ด่านเครดิตต้องดูเฉพาะใบที่กลายเป็นเงิน
  -- ถ้าใบล่าสุดของบริษัทเป็น 'no' ค่าจะตกไปใช้ใบที่ออกบิลของรหัสอื่นในนิติบุคคลเดียวกัน
  -- และถ้าทั้งนิติบุคคลไม่มีใบที่ออกบิลเลย ก็คืน NULL (= ผ่านด่าน)
  --
  -- ⚠️ ตัวกรองนี้ทำให้ใช้ idx_so_contact_latest แบบ index-only ไม่ได้แล้ว (invoice_status
  --    ไม่อยู่ใน index) กลายเป็น seq scan — วัด 2026-08-25: 90ms → 333ms บน build 2.1 วิ
  --    ยังไม่คุ้มสร้าง index เพิ่ม ถ้าวันไหน build ช้าขึ้นจนสะดุด ค่อยมาดูตรงนี้
  SELECT contact_id, max(order_date) AS d
    FROM public.sale_orders
   WHERE contact_id > 0
     AND invoice_status IN ('invoiced', 'to invoice')
   GROUP BY contact_id
),
own_last AS (
  -- ยุบขึ้นมาระดับ company_id ของตัวเองก่อน
  SELECT b.company_id, max(so.d) AS d
    FROM base b
    LEFT JOIN so_last so ON so.contact_id = b.contact_id
   GROUP BY b.company_id
),
own_credit AS (
  -- บริษัทนี้เป็นลูกค้าเครดิต/เช็คล่วงหน้าหรือไม่ (ยังไม่ขยายนิติบุคคล)
  --
  -- รูปแบบที่นับว่าเป็นเครดิต — ค่าที่มีจริงใน Odoo ณ 2026-08-25:
  --   '7/14/15/20/30/40/45/60/65/90 Days'  → ตรง regex
  --   'เช็คล่วงหน้า7/15/30/45วัน'              → ตรง LIKE
  -- ที่เหลือไม่นับ: 'Cash', 'Immediate Payment', และ NULL (28,241 บริษัทไม่ได้ตั้งค่าใน Odoo)
  --
  -- ⚠️ COALESCE จำเป็น ไม่ใช่ของแถม — bool_or() บนบริษัทที่ payment terms เป็น NULL ทุกแถว
  --    คืน NULL ไม่ใช่ false แล้วเงื่อนไขที่เขียนกลับด้าน (NOT credit) จะกินบริษัทกลุ่มนี้
  --    หายไปเงียบ ๆ ทั้ง 28,241 ราย
  --
  -- ⚠️ ค่าใหม่ที่ Odoo เพิ่มมาทีหลัง (เช่น '2 Months' / 'เครดิต 30 วัน') จะไม่ตรงสักรูปแบบ
  --    แล้วลูกค้ากลุ่มนั้นหลุดด่านโดยไม่มีใครรู้ → creditHoldSmoke.ts มีข้อที่ลิสต์ค่าที่
  --    ไม่เข้าทั้งสองรูปแบบออกมาให้เห็นทุกครั้งที่รัน ห้ามลบทิ้ง
  SELECT b.company_id,
         COALESCE(bool_or(b.customer_payment_terms ~ '^[0-9]+ Days$'
                       OR b.customer_payment_terms LIKE 'เช็คล่วงหน้า%'), false) AS c
    FROM base b
   GROUP BY b.company_id
),
ent_keys AS (
  -- (บริษัท → คีย์บ่งชี้นิติบุคคล) หนึ่งแถวต่อคีย์ · base ผ่าน clean_text มาแล้ว
  -- จึงไม่ต้อง NULLIF(TRIM(...)) ซ้ำเหมือนฝั่ง companyIdentity ที่รับค่าดิบ
           SELECT DISTINCT company_id, 't'::text AS kind, customer_tax_id    AS k FROM base WHERE customer_tax_id    IS NOT NULL
  UNION ALL SELECT DISTINCT company_id, 'r'::text,        customer_reference       FROM base WHERE customer_reference IS NOT NULL
  UNION ALL SELECT DISTINCT company_id, 'n'::text,        customer_name            FROM base WHERE customer_name      IS NOT NULL
),
key_last AS (
  -- คีย์แต่ละตัวถูกซื้อล่าสุดเมื่อไหร่ + เป็นเครดิตไหม (รวมทุกบริษัทที่ถือคีย์นี้)
  SELECT ek.kind, ek.k, max(ol.d) AS d, bool_or(oc.c) AS c
    FROM ent_keys ek
    JOIN own_last   ol ON ol.company_id = ek.company_id
    JOIN own_credit oc ON oc.company_id = ek.company_id
   GROUP BY ek.kind, ek.k
),
ent_last AS (
  -- แล้วกระจายกลับ: บริษัทหนึ่งได้วันล่าสุด/สถานะเครดิตของคีย์ที่ตัวเองถืออยู่ทุกตัว
  SELECT ek.company_id, max(kl.d) AS d, COALESCE(bool_or(kl.c), false) AS c
    FROM ent_keys ek
    JOIN key_last kl ON kl.kind = ek.kind AND kl.k = ek.k
   GROUP BY ek.company_id
),
-- ════════════════════════════════════════════════════════════════════
-- salesperson_id — รหัสพนักงานขายของชื่อในคอลัมน์ salesperson (2026-09-24)
--
-- มีเพราะชื่อที่ Odoo ส่งมากับลูกค้าเป็นรูป 'คุณจิรายุ(PM)' ส่วนตาราง salesperson เก็บ
-- 'คุณจิรายุ' ⇒ เทียบชื่อตรงตัวได้ 0 จาก 123 ชื่อ (วัด 2026-09-24) · ตัด '(PM)' ทิ้งแล้วเทียบก็ไม่ได้
-- เพราะคนเดียวกันมีรหัสฝั่ง PM กับ THT คนละตัว (คุณสมิตานันท์ 671/672) และตรงได้แค่ 63/123
-- ⇒ ใช้ sale_orders ซึ่งเก็บ "ชื่อรูปเดียวกัน" คู่กับ salesperson_id (= รหัสในตาราง salesperson)
--   วัด 2026-09-24: 132 ชื่อ ทุกชื่อมีรหัสเดียว · ถ้าวันหน้าชื่อหนึ่งมีสองรหัส ใช้รหัสของใบล่าสุด
--
-- ⚠️ customers ที่ sync จาก Odoo ไม่มีรหัสเซลส์มาให้ (gateway ส่งแค่ชื่อ) — ถ้าวันหนึ่ง gateway
--    ส่งรหัสมา ให้เปลี่ยนต้นทางที่นี่ที่เดียว คนอ่านคอลัมน์นี้ไม่ต้องรู้
-- ⚠️ ขั้นในสุดต้องเรียง/DISTINCT ด้วยค่าดิบ ไม่ใช่ clean_text() — ไม่งั้นใช้ลำดับของ
--    idx_so_salesperson_cover ไม่ได้ (วัด 2026-09-24: index-only scan 255ms) · clean_text ทำที่ชั้นนอก
--    กับแค่ ~132 แถวแทน
-- ⚠️ ผู้อ่านคอลัมน์นี้เพื่อ "เลือกเซลส์ของบริษัท" ต้องยึดแถวแรกที่ salesperson ไม่ว่าง เรียงตาม
--    contact_id (เจ้าของเคาะ 2026-09-24) — ดู services/customerSalesOwner.ts
-- ════════════════════════════════════════════════════════════════════
sp_code AS (
  SELECT DISTINCT ON (public.clean_text(r.salesperson))
         public.clean_text(r.salesperson) AS salesperson,
         r.salesperson_id::text           AS salesperson_id
    FROM (
      SELECT DISTINCT ON (salesperson) salesperson, salesperson_id, order_date
        FROM public.sale_orders
       WHERE salesperson IS NOT NULL AND salesperson_id IS NOT NULL
       ORDER BY salesperson, order_date DESC NULLS LAST
    ) r
   WHERE public.clean_text(r.salesperson) IS NOT NULL
   ORDER BY public.clean_text(r.salesperson), r.order_date DESC NULLS LAST
)
SELECT
  b.company_id, b.contact_id, b.source,
  b.customer_name, b.customer_reference, b.customer_tax_id, b.customer_payment_terms,
  COALESCE(b.customer_sale_area, comp.customer_sale_area)         AS customer_sale_area,
  b.salesperson, b.sales_team, b.customer_type, b.phone, b.mobile, b.email,
  b.contact_name, b.contact_mobile, b.contact_phone, b.contact_email,
  b.invoice_street,
  COALESCE(b.invoice_district, comp.invoice_district)            AS invoice_district,
  COALESCE(b.invoice_sub_district, comp.invoice_sub_district)    AS invoice_sub_district,
  b.invoice_state, b.invoice_zip,
  -- ไม่ใช่ลูกค้าเครดิต → NULL ตั้งแต่ต้นทาง ด่านจึงไม่ต้องรู้เรื่องเงื่อนไขการชำระเงินเลย
  -- (own_credit/own_last เผื่อบริษัทที่ไม่มีคีย์เลยสักตัว = ไม่มีแถวใน ent_last)
  -- GREATEST ข้าม NULL ให้เอง
  CASE WHEN COALESCE(ent_last.c, own_credit.c, false)
       THEN GREATEST(own_last.d, ent_last.d)
  END                                                            AS last_order_at,
  -- ⚠️ ต้องอยู่ท้ายสุดเสมอ — CREATE OR REPLACE VIEW เพิ่มคอลัมน์ได้แค่ต่อท้าย และ
  --    ensureDirectoryRow() (db/localContactsRepo.ts) INSERT ตามตำแหน่งโดยไม่ระบุชื่อคอลัมน์
  sp_code.salesperson_id                                         AS salesperson_id
FROM all_rows b
LEFT JOIN comp       ON comp.company_id       = b.company_id
LEFT JOIN own_last   ON own_last.company_id   = b.company_id
LEFT JOIN own_credit ON own_credit.company_id = b.company_id
LEFT JOIN ent_last   ON ent_last.company_id   = b.company_id
LEFT JOIN sp_code    ON sp_code.salesperson   = b.salesperson;
