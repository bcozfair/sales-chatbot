-- หน้าเว็บขอใบเสนอราคา: ทะลุด่านตรวจได้ + คิวใบที่ต้องแก้มือใน Odoo
-- (docs/plan-web-quote-request.md §M)
--
-- **สองคอลัมน์ ไม่ใช่คอลัมน์เดียว** เพราะเป็นคนละเรื่องและมีผลคนละอย่าง —
-- เจ้าของแยกให้ชัดเมื่อ 2026-09-15 หลังจากรอบแรกเอามารวมกันแล้วเข้าใจผิด:
--
--   rule_overrides      = ใบนี้ติดกฎ (สต็อก/MOQ/ราคาขั้นต่ำ/ระงับ/blacklist/เครดิตค้าง)
--                         แต่คนออกใบรับทราบแล้วและยืนยันจะออก
--                         ⇒ **ข้อมูลในไฟล์ยังตรงกับฐาน Odoo ทุกช่อง นำเข้าได้เลย**
--                         ⇒ ห้ามมีผลกับไฟล์ export เด็ดขาด มีไว้กรอง/ติดป้ายในหน้าประวัติ
--
--   odoo_manual_review  = ข้อมูลในไฟล์ export **ไม่ตรง** กับฐานลูกค้า/สินค้าของ Odoo
--                         (วันนี้: เครดิตที่แอดมินตั้งทับ · วันหน้า: ผู้ติดต่อใหม่ · สินค้า custom)
--                         ⇒ นำเข้าตรง ๆ แล้วใบตก ต้องไปสร้าง/แก้ใน Odoo ก่อน
--                         ⇒ **กันออกจากไฟล์ปกติ** แล้วส่งออกจากเมนูแยก
--
-- ยัดรวมเป็นคอลัมน์เดียวเมื่อไหร่ วันหนึ่งจะมีคนเขียน query ที่กัน "ใบทะลุกฎ" ออกจาก
-- ไฟล์ export โดยไม่ได้ตั้งใจ ทั้งที่ใบพวกนั้นนำเข้า Odoo ได้ปกติ · ใบเดียวติดได้ทั้งสองคอลัมน์
--
-- รูปร่างข้างใน (ไม่ผูกเป็น constraint โดยตั้งใจ — จะเพิ่มชนิดเหตุใหม่โดยไม่ต้อง migration):
--   rule_overrides = {
--     "acknowledged_by":   "admin:<username>",
--     "acknowledged_at":   "2026-09-15T10:22:41+07:00",
--     "acknowledged_keys": ["MIN_PRICE_VIOLATION|PE-1000", "CUSTOMER_CREDIT_HOLD|-"],
--     "violations":        [ …Violation ที่ server คำนวณเอง ไม่ใช่ที่หน้าจอส่งมา… ]
--   }
--   odoo_manual_review = {
--     "reasons": [ { "kind": "payment_terms_override", "field": "payment_term_id",
--                    "value": "45 วัน" } ]
--   }
--   (`field` = ชื่อคอลัมน์ในไฟล์ Odoo ที่จะไม่ตรง — คนที่รับใบไปแก้จะได้รู้ว่าต้องไปดูช่องไหน)
--
-- ⚠️ ห้ามตั้ง NOT NULL และห้ามตั้ง DEFAULT — NULL คือคำตอบที่ถูกของใบส่วนใหญ่
--    (ใบจาก LINE เป็น NULL ทั้งสองคอลัมน์เสมอ) และ `IS NULL` คือตัวกรองที่ทั้งฟีเจอร์ใช้
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS rule_overrides jsonb;
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS odoo_manual_review jsonb;

-- index บางส่วน: คิวแก้มือคือ "มีค่า และยังไม่ถูกส่งออก" ซึ่งเป็น query ที่เมนูส่งออก
-- เรียกทุกครั้งที่เปิดหน้าประวัติ (นับใบค้างต่อเหตุ × บริษัท) — ส่วนที่เหลือของตาราง
-- (ใบปกติทั้งหมด) ไม่ต้องอยู่ใน index เลยเพราะไม่เคยถูกถามถึงด้วยเงื่อนไขนี้
CREATE INDEX IF NOT EXISTS idx_quotations_manual_review_pending
    ON public.quotations (odoo_exported_at)
    WHERE odoo_manual_review IS NOT NULL AND odoo_exported_at IS NULL;

-- ตัวกรอง "เฉพาะใบที่ทะลุกฎ" ในหน้าประวัติ — ใบที่ทะลุกฎเป็นส่วนน้อยของตาราง
-- partial index จึงเล็กกว่า index เต็มคอลัมน์มาก และตอบคำถามเดียวที่หน้าจอถามจริง
CREATE INDEX IF NOT EXISTS idx_quotations_rule_overrides
    ON public.quotations (created_at DESC)
    WHERE rule_overrides IS NOT NULL;
