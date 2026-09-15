-- อนุมัติราคาต่ำกว่าขั้นต่ำ ก่อนออกใบจากหน้าเว็บ (docs/plan-quote-price-approval.md)
--
-- เจ้าของสั่ง 2026-09-15: ใบที่ออกจากหน้าเว็บแล้วติดกฎ "ห้ามขายต่ำกว่าราคาขั้นต่ำ"
-- จะติ๊กรับทราบเองเหมือนกฎข้ออื่นไม่ได้อีกต่อไป — ต้องมีคนอนุมัติราคาให้ก่อน
--
--   rule_overrides  (ของเดิม) = "คนออกใบรับทราบเองแล้ว"  ⇒ ใช้กับกฎข้ออื่นทั้งหมดตามเดิม
--   price_approval  (ใหม่)     = "มีคนอื่นอนุมัติราคาให้"  ⇒ ใช้กับ MIN_PRICE_VIOLATION เท่านั้น
--
-- ทำไมต้องเป็นคอลัมน์บนใบ ไม่ใช่เงื่อนไขที่ endpoint: `PUT /api/quotation/:id` และ
-- `POST /api/quotation/:id/confirm` เป็นของที่ LIFF ของเซลส์ใช้ร่วมกับหน้าเว็บ ถ้าไปปลด/บล็อก
-- ที่ endpoint ใบจาก LINE จะเปลี่ยนพฤติกรรมตามไปเงียบ ๆ (เหตุผลเต็ม: plan-web-quote-request.md §N.2)
-- ⇒ ใบจาก LINE เป็น NULL เสมอ = ไม่มีคำขอ = ราคาขั้นต่ำบล็อกเหมือนเดิมทุกประการ
--
-- รูปร่างข้างใน (ไม่ผูกเป็น constraint โดยตั้งใจ — จะเติมฟิลด์ใหม่โดยไม่ต้อง migration):
--   price_approval = {
--     "request_id":       "uuid",        -- ใบทั้งชุด (PM+THT) ของการกดหนึ่งครั้งใช้ค่าเดียวกัน
--     "status":           "pending | approved | rejected",
--     "requested_by_id":  3, "requested_by": "nan", "requested_by_name": "…",
--     "requested_at":     "2026-09-15T10:22:41+07:00",
--     "note":             "เหตุผลที่ขอลดราคา (ผู้ขอพิมพ์)",
--     "items":            [ { "model": "…", "name": "…", "quantity": 5,
--                             "price": 95.00, "min_price": 120.00 } ],
--     "violations":       [ …Violation ที่ server คำนวณเอง ไม่ใช่ที่หน้าจอส่งมา… ],
--     "decided_by_id":    7, "decided_by": "boss", "decided_at": "…",
--     "decision_note":    "เหตุผลตอนไม่อนุมัติ (บังคับ)"
--   }
--
-- `items` คือ **ราคาที่ถูกอนุมัติจริง** ไม่ใช่แค่รายชื่อรุ่น — เพราะคีย์ของกฎ (`type|model`)
-- ไม่มีตัวเลขอยู่ในนั้น ถ้าใช้คีย์เป็นตัวปลดตรง ๆ คนที่อนุมัติ ฿100 จะกลายเป็นอนุมัติ ฿10 ให้ด้วย
--
-- ⚠️ ห้ามตั้ง NOT NULL และห้ามตั้ง DEFAULT — NULL คือคำตอบที่ถูกของใบเกือบทั้งตาราง
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS price_approval jsonb;

-- หน้าคิว = "ใบที่มีคำขอ" เรียงใหม่ก่อน — ใบส่วนใหญ่ของตารางไม่มีคำขอเลย จึงเป็น partial index
-- ที่เล็กมาก · **ไม่ผูกกับ status** เพราะคำขอที่อนุมัติแล้วกลายเป็นใบจริง (confirmed) ทันที
-- ถ้าดักไว้แค่ร่าง แท็บ "อนุมัติแล้ว" จะว่างตลอดกาล
CREATE INDEX IF NOT EXISTS idx_quotations_price_approval_pending
    ON public.quotations (created_at DESC)
    WHERE price_approval IS NOT NULL;

-- ค้นคำขอด้วย request_id (เปิดรายละเอียด / อนุมัติทั้งชุด) — ใบในชุดเดียวกันมีได้ 2 ใบ (PM/THT)
CREATE INDEX IF NOT EXISTS idx_quotations_price_approval_request
    ON public.quotations ((price_approval->>'request_id'))
    WHERE price_approval IS NOT NULL;

-- role ที่ 4 ของ Admin Portal: approver = "ผู้อนุมัติใบเสนอราคา"
--
--   admin    = ทุกอย่าง (อนุมัติได้ด้วย รวมถึงใบของตัวเอง — เขาแก้ราคาขั้นต่ำเองได้อยู่แล้ว
--              การห้ามอนุมัติใบตัวเองจึงเพิ่มแค่ขั้นตอน ไม่ได้เพิ่มการควบคุม)
--   approver = ทำได้ทุกอย่างของ subadmin **บวก** อนุมัติราคา — แต่อนุมัติใบที่ตัวเองขอไม่ได้
--   subadmin = ประวัติใบเสนอราคา + หน้าขอใบเสนอราคา (เหมือนเดิม)
--   user     = บัญชีห้ามเสนอราคา (เหมือนเดิม)
--
-- constraint ผ่อนคลายกว่าเดิม (3 ค่า -> 4 ค่า) ข้อมูลเดิมผ่านทั้งหมด จึงไม่ต้อง UPDATE ล้างค่าก่อน
-- ต้องรันไฟล์นี้ "ก่อน" deploy โค้ด ไม่งั้นแอดมินที่เลือกสิทธิ์ approver จะโดน CHECK ปฏิเสธเป็น 500
ALTER TABLE public.admin_users
  DROP CONSTRAINT IF EXISTS admin_users_role_check;

ALTER TABLE public.admin_users
  ADD CONSTRAINT admin_users_role_check CHECK (role IN ('admin', 'approver', 'subadmin', 'user'));
