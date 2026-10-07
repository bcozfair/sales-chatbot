-- ตัวนับ "API ของหน้า LIFF ถูกเรียกด้วยตัวตนแบบไหน" — ขั้น 0 ของการยืนยันตัวตน LIFF (เจ้าของสั่ง 2026-10-07)
--
-- ทำไมต้องมี: API ของ LIFF เชื่อ userId ที่หน้าเว็บส่งมา (ปลอมได้) ก่อนจะบังคับ access token ของ LINE
--   ต้องรู้ก่อนว่าบังคับแล้วจะกระทบคนใช้งานจริงไหม ⇒ ช่วงนี้ "ตรวจแล้วนับ ไม่บล็อก" (config/liffAuthObserve.ts)
--   log ของ docker หายทุกครั้งที่ deploy จึงเก็บเป็นตัวนับรายวันในฐานแทน
--
-- 1 แถว = 1 วัน (วันไทย) × 1 เส้น API × 1 ผลการตรวจ · n = จำนวนครั้ง
--   outcome: none          ไม่มี Authorization เลย
--            admin         token แอดมินที่ถูกต้อง (หน้าแอดมินใช้เส้นร่วมกับ LIFF)
--            match         token ของ LINE ถูกต้อง และ userId ตรงกับที่หน้าเว็บส่งมา
--            mismatch      token ถูกต้อง แต่ userId ไม่ตรง (ลิงก์ที่ส่งต่อ / LIFF กับบอทคนละ provider)
--            no_claim      token ถูกต้อง หน้าเว็บไม่ได้ส่ง userId มา
--            bad_token     token เสีย/หมดอายุ/ของ channel อื่น
--            verify_failed ถาม LINE ไม่สำเร็จ
--   last_claimed_user / last_token_user = คู่ล่าสุดของแถว mismatch เท่านั้น (ไว้สอบกลับ) · แถวอื่นเป็น NULL
--
-- เพิ่มตารางใหม่อย่างเดียว ไม่แตะของเดิม · รันก่อนหรือหลัง deploy ก็ได้ (โค้ดเขียนไม่ได้ = ข้ามเงียบ ๆ)
-- ไม่ใส่ public. ให้ด่านเอาตารางชั่วคราวชื่อเดียวกันมาบังได้ (แบบ 2026-09-23_02)

CREATE TABLE IF NOT EXISTS liff_auth_observations (
    day date NOT NULL,
    route character varying(60) NOT NULL,
    outcome character varying(20) NOT NULL,
    n integer DEFAULT 0 NOT NULL,
    last_at timestamp with time zone DEFAULT now() NOT NULL,
    last_claimed_user character varying(64),
    last_token_user character varying(64),
    CONSTRAINT liff_auth_observations_pkey PRIMARY KEY (day, route, outcome)
);
