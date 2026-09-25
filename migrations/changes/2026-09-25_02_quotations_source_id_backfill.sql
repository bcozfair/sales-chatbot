-- ต่อจาก 2026-09-25_01: ใบเก่าทุกใบได้ source_id = 'Sales' และแถวใหม่ที่ไม่ระบุก็ได้ 'Sales' (เจ้าของสั่ง 2026-09-25)
--
-- _01 ตั้งใจให้ NULL แปลว่า "ไม่ได้ระบุ ⇒ export ใช้ค่าตั้งต้น" — เจ้าของขอให้ทุกแถวมีค่าจริงแทน
-- ผลกับไฟล์ export **เท่าเดิมทุกบิต** (ค่าตั้งต้นของ export ก็คือ Sales) เปลี่ยนแค่ว่าค่าอยู่ในแถวแล้ว
--
-- · UPDATE แตะแค่ source_id — quotations ไม่มี trigger (ตรวจ 2026-09-25) ⇒ updated_at ไม่ขยับ
--   (สำคัญ: updated_at คือ date_order ของไฟล์ Odoo และเป็นตัวเรียงของ getRecentConfirmedQuotations)
-- · DEFAULT ครอบเส้นที่ INSERT โดยไม่ระบุคอลัมน์ (เช่นแถว pending_product ของ lineHandler)
--   ส่วน insertDraftQuotations ส่ง 'Sales' เองเมื่อไม่ได้เลือก (ส่ง NULL ตรง ๆ DEFAULT จะไม่ทำงาน)
-- · ยังไม่ตั้ง NOT NULL — โค้ดเก่าที่ยังรันอยู่ระหว่าง deploy ส่ง NULL ตรง ๆ ได้ และ export ถอยให้อยู่แล้ว
-- · รันซ้ำได้ (idempotent)
ALTER TABLE public.quotations ALTER COLUMN source_id SET DEFAULT 'Sales';
UPDATE public.quotations SET source_id = 'Sales' WHERE source_id IS NULL;
