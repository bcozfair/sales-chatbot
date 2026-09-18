-- เมทริกซ์สิทธิ์ต่อ role ที่ตั้งค่าจากหน้าจอได้ + role ที่ห้า `salesperson`
-- แบบเต็ม: docs/plan-role-permissions.md (§3 ข้อตัดสินใจ · §5 รูปของข้อมูล)
--
-- เจ้าของสั่ง 2026-09-18: "เปิด/ปิดกฎแต่ละ role ได้จาก ui เพราะอาจมีการเปลี่ยนแปลงตลอดเวลา"
-- ⇒ ค่าที่เคยเป็นค่าคงที่ในโค้ด (ใครทะลุกฎข้อไหนได้บ้าง) ย้ายมาอยู่ในตารางนี้
--
-- ไฟล์นี้ **ไม่เปลี่ยนพฤติกรรมของระบบเลยแม้แต่ข้อเดียว** — ยังไม่มีโค้ดตัวไหนอ่านตารางนี้
-- และตารางว่างคือ "ใช้ค่าเริ่มต้นในโค้ด" ซึ่งถูกเขียนให้ตรงกับพฤติกรรมวันนี้เป๊ะ (§3.2)

-- ─────────────────────────────────────────────────────────────────────────────
-- role_permissions — role × ความสามารถ → โหมด
--
-- แคตตาล็อก (มีความสามารถอะไรบ้าง · ค่าเริ่มต้นเท่าไร) อยู่ใน config/capabilities.ts
-- ตารางนี้เก็บเฉพาะ "ช่องที่ถูกแก้จากค่าเริ่มต้น" ⇒ ไม่มีแถว = ใช้ค่าเริ่มต้น
-- ตั้งใจไม่ seed ค่าเริ่มต้นลงมา เพราะ seed ที่ค้างอยู่จะกลายเป็นคำตอบเก่าในวันที่แคตตาล็อกเปลี่ยน
--
--   deny     = ทำไม่ได้ ไม่มีทางปลด
--   approval = ทำได้ถ้ามีคนอนุมัติให้ (ใช้คิวเดียวกับอนุมัติราคาต่ำกว่าขั้นต่ำ)
--   allow    = ทำได้เอง (กฎ = ติ๊กรับทราบเองได้ · ความสามารถ = ใช้ได้)
--
-- ไม่มีแถวของ `SYSTEM_ERROR` และจะต้องไม่มีตลอดไป — มันแปลว่า "ยังไม่รู้ว่าผิดหรือไม่"
-- ไม่ใช่ "ผิดข้อนี้" การมีสวิตช์ให้มันคือการเปลี่ยนด่าน fail-closed ให้เป็น fail-open (§3.3)
CREATE TABLE IF NOT EXISTS public.role_permissions (
    role character varying(20) NOT NULL,
    capability character varying(64) NOT NULL,
    mode character varying(16) NOT NULL,
    updated_by integer,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT role_permissions_pkey PRIMARY KEY (role, capability),
    CONSTRAINT role_permissions_mode_check CHECK (mode IN ('deny', 'approval', 'allow'))
);

-- ไม่ผูก FK กับ "ชื่อความสามารถ" โดยตั้งใจ — แคตตาล็อกอยู่ในโค้ด ถ้าทำเป็นตารางอ้างอิงด้วย
-- การเพิ่มความสามารถใหม่จะกลายเป็นงานสองฝั่งที่ลืมฝั่งใดฝั่งหนึ่งได้ · ชื่อที่โค้ดไม่รู้จักถูกมองข้าม
ALTER TABLE public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_updated_by_fkey;
ALTER TABLE public.role_permissions
    ADD CONSTRAINT role_permissions_updated_by_fkey FOREIGN KEY (updated_by)
    REFERENCES public.admin_users(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- role ที่ห้า: salesperson = พนักงานขายที่ออกใบเองได้ แต่ทะลุกฎเองไม่ได้
--
--   admin       = ทุกอย่าง รวมถึงตั้งค่าตารางสิทธิ์นี้เอง
--   approver    = subadmin + อนุมัติ
--   subadmin    = เหมือนเดิมทุกประการ ไฟล์นี้ไม่แตะค่าของมันสักช่อง
--   salesperson = ใหม่ · ออกใบ/แก้ใบได้ · เห็นเฉพาะใบของตัวเอง · ส่งออกไม่ได้ · ตั้งเครดิตทับไม่ได้
--   user        = บัญชีห้ามเสนอราคา (เหมือนเดิม)
--
-- constraint ผ่อนคลายกว่าเดิม (4 ค่า → 5 ค่า) ข้อมูลเดิมผ่านทั้งหมด ไม่ต้องล้างค่าก่อน
-- ต้องรันไฟล์นี้ "ก่อน" deploy โค้ดที่เปิดให้เลือก role นี้ ไม่งั้นการบันทึกจะถูก CHECK ปฏิเสธเป็น 500
ALTER TABLE public.admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE public.admin_users
    ADD CONSTRAINT admin_users_role_check
    CHECK (role IN ('admin', 'approver', 'subadmin', 'salesperson', 'user'));

-- ─────────────────────────────────────────────────────────────────────────────
-- บัญชีนี้คือเซลส์ "รหัสไหน" — ตัวนิยามของคำว่า "ใบของตัวเอง" (§3.5)
--
-- ทำไมเป็นรหัสพนักงานขาย ไม่ใช่ salesperson.user_id: เซลส์คนเดียวมีได้หลายแถวใน salesperson
-- (วัด 2026-09-18: รหัส 435 มี 129 ใบกระจายอยู่ 3 user_id · 422 → 126 ใบ/2 · 608 → 109 ใบ/2)
-- ถ้าผูกด้วย user_id เซลส์จะมองไม่เห็นใบของตัวเองที่ออกจากบัญชี LINE เก่า
--
-- ทำไมเป็นตารางเชื่อม ไม่ใช่คอลัมน์เดียว: มีคนถือสองรหัสพร้อมกันจริงและใช้อยู่ทั้งคู่
-- (วิรุณ ผ่านจังหาร — รหัส 441: 44 ใบ ล่าสุด 2026-09-14 · รหัส 688: 29 ใบ ล่าสุด 2026-09-18)
--
-- ไม่มี FK ไป salesperson เพราะ salesperson_id ไม่ unique ที่นั่น (หลายแถวใช้รหัสเดียวกัน)
-- และ **ไม่มีสิทธิ์ใดผูกกับตารางนี้** — มันตอบว่า "ใบไหนเป็นของเขา" ไม่ใช่ "เขาทำอะไรได้"
CREATE TABLE IF NOT EXISTS public.admin_user_salespersons (
    admin_user_id integer NOT NULL,
    salesperson_id character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT admin_user_salespersons_pkey PRIMARY KEY (admin_user_id, salesperson_id)
);

ALTER TABLE public.admin_user_salespersons DROP CONSTRAINT IF EXISTS admin_user_salespersons_admin_user_id_fkey;
ALTER TABLE public.admin_user_salespersons
    ADD CONSTRAINT admin_user_salespersons_admin_user_id_fkey FOREIGN KEY (admin_user_id)
    REFERENCES public.admin_users(id) ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- ครั้งล่าสุดแอดมินคนนี้ออกใบ "ในนามเซลส์รหัสไหน" (§13.4) — ย้ายมาจาก localStorage ของเบราว์เซอร์
-- เพราะแอดมินเปลี่ยนเครื่อง/ใช้หลายเครื่อง แล้วค่าที่จำไว้หายไปพร้อมเครื่องเดิม
--
-- คนละความหมายกับตารางข้างบนและไม่ใช่สิทธิ์: นี่คือ "ค่าที่เลือกไว้ครั้งก่อน" เท่านั้น
-- ⇒ ค่าที่อ่านมาต้องเทียบกับรายชื่อเซลส์จริงทุกครั้งก่อนใช้ (รหัสที่เลิกใช้แล้วต้องตกไปเอง)
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS acting_salesperson_id character varying(50);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 ชื่อผู้เสนอราคา = 1 บัญชี (เจ้าของเคาะ 2026-09-18 · §13.7 ข้อ 5)
--
-- ชื่อที่พิมพ์ลงช่อง "ผู้เสนอราคา" บนกระดาษจะมาจากบัญชีที่ล็อกอินอยู่ ไม่ใช่จากช่องที่พิมพ์เองได้
-- ⇒ ถ้าสองบัญชีถือชื่อเดียวกัน จะไม่มีทางรู้ว่าใบนั้นใครเป็นคนออกจริง
--
-- วัด 2026-09-18: ไม่มีชื่อซ้ำในตารางเลย (0 กลุ่ม) ⇒ index นี้ขึ้นได้ทันทีโดยไม่ต้องล้างค่าอะไร
-- ถ้าวันข้างหน้ามันล้มด้วย "is duplicated" **ห้ามแก้ด้วยการล้างชื่อทิ้งอัตโนมัติ** — ต้องให้คน
-- ตัดสินว่าบัญชีไหนได้ชื่อนั้นไป · ไฟล์นี้รันเป็น transaction เดียว ล้มแล้วถอยทั้งไฟล์ ไม่ค้างครึ่งทาง
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_employee_quotation_id_key
    ON public.admin_users (employee_quotation_id) WHERE employee_quotation_id IS NOT NULL;
