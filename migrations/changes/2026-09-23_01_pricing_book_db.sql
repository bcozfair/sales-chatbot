-- สมุดราคาของโมดูล "คิดราคาสินค้า" ย้ายจาก pricebook/book.json เข้าฐาน (docs/plan-pricebook-db.md)
--
-- ทำไม: ไฟล์อยู่ในคอนเทนเนอร์ที่ไม่มี volume ⇒ `docker compose up --build` ทุกครั้งทิ้งราคาที่แอดมินแก้
--   พร้อมเล่มสำรองทั้งหมด และ backup:auto ตีสามไม่เคยถ่ายมันไปด้วย
--
-- ถอดโมดูล = DROP ทั้งสามตารางนี้ + pricing_subcodes · ไม่มี FK ชี้เข้าจากตารางอื่นของระบบ
--
-- spec เป็น json ไม่ใช่ jsonb โดยตั้งใจ (เจ้าของเคาะ 2026-09-23): jsonb สลับลำดับคีย์ แล้วแม่แบบ .xlsx
--   เรียงแถว/คอลัมน์ใหม่ 16 จาก 22 ชีต และช่องเลือกบนจอเปลี่ยนลำดับ 21 รายการ (วัด 2026-09-23)
--   โมดูลนี้อ่าน/เขียนทั้งก้อนเสมอ ไม่ต้องใช้ operator ของ jsonb · `->>` ยังใช้กับ json ได้
-- id เป็น IDENTITY ไม่ใช่ BIGSERIAL: ด่านที่สร้างตารางเงาด้วย LIKE … INCLUDING ALL จะได้ sequence
--   ของตัวเอง ไม่ไปกินเลขของ sequence จริง (nextval ไม่ rollback)
--
-- สร้างตารางใหม่อย่างเดียว ไม่ล็อกตารางเดิมสักตัว ⇒ รันได้ทุกเวลา และรันก่อน deploy โค้ดได้
-- (โค้ดที่ยังไม่มีตารางตอบ "ยังไม่มีสมุดราคา" — ลำดับ migration/deploy สลับกันได้)

CREATE TABLE IF NOT EXISTS pricing_book_revisions (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- เล่มที่การบันทึกครั้งนี้ตั้งต้นจาก = token ที่หน้าจอถือมา · UNIQUE = สองคนตั้งต้นจากเล่มเดียวกัน
  -- บันทึกได้คนเดียว (คนที่สองโดน unique violation → 409) · NULL มีได้แถวเดียว (เล่มแรก)
  -- ⇒ ประวัติเป็นเส้นตรงเสมอ: ทุกแถวยกเว้นหัวเล่มมีลูกหนึ่งตัว จึงมีแค่หัวเล่มที่ต่อได้
  parent_id      BIGINT REFERENCES pricing_book_revisions (id),
  kind           TEXT NOT NULL
                 CONSTRAINT pricing_book_revisions_kind_check
                 CHECK (kind IN ('seed', 'import', 'model', 'restore')),
  restored_from  BIGINT REFERENCES pricing_book_revisions (id),
  -- ฟิลด์ระดับเล่มของ PriceBook "หลังการบันทึกครั้งนี้" — คัดต่อจากครั้งก่อนถ้าไม่เปลี่ยน
  version        TEXT NOT NULL,
  source         TEXT NOT NULL,
  book_subcodes  JSON NOT NULL DEFAULT '[]'::json,   -- PriceBook.subCodes (มาจากไฟล์ราคา ≠ pricing_subcodes)
  edited         JSON,                               -- PriceBook.edited · NULL = ยังไม่มีคนแตะ
  source_files   JSON,                               -- [{name, sha256, bytes}] ของไฟล์ที่ใช้ — ไม่เก็บตัวไฟล์
  created_by     TEXT,                               -- ใครกด (ต่างจาก edited.by ตอนย้อน) · ไม่ใช่ FK
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pricing_book_revisions_parent_key UNIQUE NULLS NOT DISTINCT (parent_id),
  CONSTRAINT pricing_book_revisions_root_check    CHECK ((kind = 'seed') = (parent_id IS NULL)),
  CONSTRAINT pricing_book_revisions_restore_check CHECK ((kind = 'restore') = (restored_from IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS pricing_models (
  code            TEXT     PRIMARY KEY,
  -- ลำดับของรุ่นในเล่ม (= ลำดับ Object.keys ของ book.models เดิม) · ไม่ unique โดยตั้งใจ:
  -- ตอนย้อนเล่ม รุ่นที่กลับมาได้ตำแหน่งเดิมคืนและอาจชนชั่วคราว ⇒ อ่านด้วย ORDER BY position, code
  position        INTEGER  NOT NULL,
  spec            JSON     NOT NULL,                  -- PriceModel ทั้งก้อน
  schema_version  SMALLINT NOT NULL DEFAULT 1,
  revision_id     BIGINT   NOT NULL REFERENCES pricing_book_revisions (id),
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pricing_models_spec_is_object CHECK (json_typeof(spec) = 'object'),
  CONSTRAINT pricing_models_code_matches   CHECK ((spec ->> 'code') = code)
);

-- เขียนต่อท้ายอย่างเดียว — โค้ดไม่มี UPDATE/DELETE ตารางนี้ (ด่าน diag:pricing-db ข้อ 13 grep ให้)
CREATE TABLE IF NOT EXISTS pricing_model_history (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  revision_id     BIGINT   NOT NULL REFERENCES pricing_book_revisions (id),
  code            TEXT     NOT NULL,
  position        INTEGER,
  spec            JSON,                               -- NULL = รุ่นนี้ถูกเอาออกในครั้งนี้
  schema_version  SMALLINT NOT NULL DEFAULT 1,
  CONSTRAINT pricing_model_history_rev_code_key UNIQUE (revision_id, code),
  CONSTRAINT pricing_model_history_code_matches CHECK (spec IS NULL OR (spec ->> 'code') = code),
  CONSTRAINT pricing_model_history_removed_check CHECK ((spec IS NULL) = (position IS NULL))
);

CREATE INDEX IF NOT EXISTS pricing_model_history_code_rev_idx
  ON pricing_model_history (code, revision_id DESC);
