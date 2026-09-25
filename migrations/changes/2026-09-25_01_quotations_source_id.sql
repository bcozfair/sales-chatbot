-- source_id ของไฟล์นำเข้า Odoo (คอลัมน์ K) เลือกได้รายใบจากหน้าขอใบเสนอราคา — เจ้าของสั่ง 2026-09-25
--
-- ก่อนหน้านี้ช่อง K เป็นค่าคงที่ของทั้งไฟล์ (ODOO_EXPORT_SOURCE = "Sales") ⇒ ใบที่มาจาก
-- Inside Sales / แอดมินรับทาง LINE-โทร-อีเมล / Marketing ลง Odoo เป็น Sales หมด
-- ตอนนี้คนออกใบเลือกจาก dropdown (ค่าตั้งต้น Sales) แล้วบันทึกลงใบ · ใบ PM/THT ในชุดเดียวกันได้ค่าเดียวกัน
--
--   NULL   = ใบจาก LINE ทุกใบ + ใบที่ออกก่อนไฟล์นี้ ⇒ export ใช้ค่าตั้งต้นเหมือนเดิม **ทุกบิต**
--   มีค่า  = ค่าที่เลือกจากหน้าเว็บ — ตัวเลือกอยู่ที่ ODOO_SOURCE_OPTIONS (services/odooSaleOrderExport.ts)
--
-- ⚠️ ไม่ตั้ง CHECK ของรายการค่าโดยตั้งใจ — รายการเปลี่ยนได้ตามชื่อ Source ใน Odoo และ server ตรวจค่า
--    ก่อนบันทึกอยู่แล้ว (parseSourceId) · ถ้าผูกไว้ที่ constraint การเพิ่มตัวเลือกหนึ่งตัวต้องมี migration
-- ⚠️ ห้ามตั้ง NOT NULL / DEFAULT — NULL คือคำตอบที่ถูกของทุกใบเดิม และทำให้ไฟล์นี้ขึ้นก่อนโค้ดได้
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS source_id text;

-- ไม่มี index — ไม่มี query ไหนกรอง/เรียงด้วยคอลัมน์นี้ อ่านเป็นค่าของแถวตอน export เท่านั้น
