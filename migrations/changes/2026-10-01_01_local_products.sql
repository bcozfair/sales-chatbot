-- สินค้าที่แอดมินเพิ่มเอง — ตาราง local_products + products.source + audit
-- เฟส J ก้อน J1 ของ docs/plan-local-products.md §3.2–§3.3 (+ คอลัมน์ราคาของ §13.5 · 2026-10-01)
--
-- ปัญหา: สินค้าที่ยังไม่มีใน Odoo เสนอราคาผ่านระบบไม่ได้เลย ต้องรอคนไปคีย์ใน Odoo แล้ว sync กลับมา
--
-- ทางแก้ (ต่างจาก local_contacts): สินค้า **ไม่มีประตูเดียว** แบบ customers_data_view — products ถูก
-- SELECT ตรงจากหลายสิบจุด ⇒ แถว local เป็น "แถวจริงใน products" (source = 'local') แล้ว
-- local_products ทำหน้าที่เป็นทะเบียน (ใครเพิ่ม · สืบทอดจากไหน · ส่งออกแล้วหรือยัง · เข้า Odoo หรือยัง)
--
-- ⚠️ ไฟล์นี้ต้องขึ้นฐาน **ก่อน** มีใครสร้างสินค้า local ได้ (J1 ก่อน J2 อย่างเคร่งครัด · แผน §9)
--    ตัวกวาดใน scripts/sync/syncProducts.ts ข้ามเงียบ ๆ เมื่อยังไม่มีคอลัมน์ products.source
--    ⇒ ขึ้นโค้ดก่อนไฟล์นี้ได้ ไม่พัง
--
-- ⚠️ ALTER TABLE products ถือ AccessExclusiveLock — ADD COLUMN ที่มีค่า DEFAULT คงที่เป็นแค่ metadata
--    (ไม่ rewrite ตาราง · Postgres ≥ 11) จึงสั้นระดับ ms แต่ยังรอคิวหลัง query ที่ค้างอยู่ได้
--    ⇒ lock_timeout กันไม่ให้ไปขวาง LINE ทั้งระบบ · ล้ม = รันใหม่ ไม่มีอะไรค้างครึ่งทาง
SET lock_timeout = '3s';

-- ─────────────────────────────────────────────────────────────────────────────
--  1. ทะเบียน
-- ─────────────────────────────────────────────────────────────────────────────

-- product_template_id ของ Odoo อยู่ในช่วง -1 ถึง 180,985 (วัด 2026-10-01 บนฐานจริง)
-- เริ่มที่ 900,000,001 ด้วยเหตุผลเดียวกับ local_contact_id_seq: เป็นเลข "บวก" จึงรอดตัวกรอง > 0
-- ที่มีหลายที่ · ห่างช่วงของ Odoo มาก · และไม่ใช่เลขลบซึ่งบรรทัดค่าบริการจองความหมายไปแล้ว (-1)
-- AS integer — products.product_template_id เป็น integer (เพดาน 2,147,483,647)
CREATE SEQUENCE IF NOT EXISTS public.local_product_template_id_seq
  AS integer START WITH 900000001 INCREMENT BY 1 MINVALUE 900000001 MAXVALUE 2147483647;

CREATE TABLE IF NOT EXISTS public.local_products (
  product_template_id integer     PRIMARY KEY
                                  DEFAULT nextval('public.local_product_template_id_seq'),

  -- ตรงกับ products.internal_reference ของแถวคู่กัน
  internal_reference  text        NOT NULL,
  -- รหัสต้นแบบที่สืบทอดมา · หลักฐาน ไม่ใช่ FK (ต้นแบบถูก archive ใน Odoo แล้วหายได้)
  parent_reference    text,
  -- boundary = ขอบเลขวิ่งพิสูจน์ได้ · max_plus_one = นับต่อให้เฉย ๆ (จอต้องเตือน) · manual = พิมพ์ทับเอง
  ref_tier            text        NOT NULL DEFAULT 'boundary',
  -- รหัสที่ Odoo ปฏิเสธไปแล้ว (ซ้ำกับของที่ archive) — ประวัติ ห้ามทับทิ้ง (แผน §1.5)
  rejected_refs       text[]      NOT NULL DEFAULT '{}',

  model               text        NOT NULL,   -- ไม่ซ้ำกับ products.model ทั้งตาราง — ตรวจที่ server (§5)
  name                text        NOT NULL,
  sales_description   text,
  brand               text,
  series              text,
  product_group       text,
  product_category    text,
  product_sub_category text,
  -- ⚠️ ไม่มี production โดยตั้งใจ (แผน §2.1 ทางเลือก ก) — ว่างไว้จนกว่า Odoo เติมให้ ไม่งั้นติดกฎบล็อกทันที
  unit_of_measure     text,
  sales_price         numeric     NOT NULL DEFAULT 0,
  minimum_sales_price numeric     NOT NULL DEFAULT 0,
  -- ราคามาจากไหน (§13.5) — server ตั้งเอง: pricebook เฉพาะเมื่อ sales_price = pricebook_price
  price_source        text        NOT NULL DEFAULT 'manual',
  -- เล่มของสมุดราคาที่คิด (pricing_book_revisions.id) · ไม่มี FK — โมดูลคิดราคาต้องถอดได้ทั้งก้อน
  price_book_revision bigint,
  pricebook_price     numeric,

  created_by          integer,                -- admin_users.id · ไม่มี FK (ลบแอดมินแล้วหลักฐานต้องอยู่)
  created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  exported_at         timestamptz,            -- ดาวน์โหลดไฟล์ไปคีย์ Odoo ครั้งล่าสุด

  -- ── สี่คอลัมน์นี้ "ระบบเขียน" เท่านั้น ไม่มี endpoint ให้คนกด (แผน §7) ──
  -- ยืนยันจากตาราง products อย่างเดียว (เจ้าของ 2026-10-01): แถวของ Odoo ที่ internal_reference
  -- หรือ model ตรงกัน
  odoo_matched_at          timestamptz,
  odoo_matched_template_id integer,           -- product_template_id ของแถว Odoo ที่จับคู่ได้
  -- รหัสฝั่ง Odoo — ต่างจาก internal_reference ได้เมื่อจับคู่ด้วย model (แอดมินคีย์ด้วยรหัสอื่น)
  odoo_matched_reference   text,
  odoo_matched_by          text,               -- reference | model

  -- วัด 2026-09-21: ทั้ง 51,648 รหัสยาว 14 ตัว [A-Z0-9] เท่ากันหมด ⇒ เป็น CHECK ได้ ไม่ใช่การเดา
  CONSTRAINT local_products_ref_shape CHECK (internal_reference ~ '^[A-Z0-9]{14}$'),
  CONSTRAINT local_products_ref_tier_check CHECK (
    ref_tier IN ('boundary', 'max_plus_one', 'manual')),
  CONSTRAINT local_products_price_source_check CHECK (price_source IN ('pricebook', 'manual')),
  CONSTRAINT local_products_model_not_blank CHECK (btrim(model) <> ''),
  CONSTRAINT local_products_name_not_blank CHECK (btrim(name) <> ''),
  -- ช่วงเลขเป็นข้อตกลงที่ตัวกวาดตอน sync พึ่งพา ⇒ บังคับที่ฐาน ไม่ใช่แค่ที่ sequence
  CONSTRAINT local_products_id_range CHECK (product_template_id >= 900000000),
  CONSTRAINT local_products_matched_by_check CHECK (
    odoo_matched_by IS NULL OR odoo_matched_by IN ('reference', 'model'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_local_products_ref
  ON public.local_products (internal_reference);
CREATE INDEX IF NOT EXISTS idx_local_products_pending
  ON public.local_products (created_at) WHERE odoo_matched_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
--  2. products.source — "ความหมาย" ที่ทุกคนอ่าน (ช่วงเลข 900 ล้านเป็นแค่กลไก · แผน §3.3)
--
--  ⚠️ sync:products ห้ามเขียนคอลัมน์นี้ — upsertProductRows() ระบุ 24 คอลัมน์ไว้ครบ และ source ไม่อยู่
--     ในนั้น ⇒ INSERT ได้ 'odoo' จาก DEFAULT · ON CONFLICT DO UPDATE ไม่แตะ
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'odoo';

DO $ck$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_source_check') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_source_check CHECK (source IN ('odoo', 'local'));
  END IF;
END;
$ck$;

-- ตัวกวาดตอน sync ถามด้วย internal_reference = ANY(...) AND source = 'local' ทุกหน้า
-- partial index มีแต่แถว local (หลักสิบ) ⇒ ไม่เพิ่มภาระให้การเขียนแถวของ Odoo
CREATE INDEX IF NOT EXISTS idx_products_source_local
  ON public.products (internal_reference) WHERE source = 'local';

-- ─────────────────────────────────────────────────────────────────────────────
--  3. audit — ชุดเดียวกับ 2026-09-03_04_audit_logs.sql (3 ตัวต่อตาราง)
-- ─────────────────────────────────────────────────────────────────────────────
DO $mk$
BEGIN
  IF to_regproc('public.audit_stmt') IS NULL THEN
    RAISE NOTICE '[audit] ข้าม local_products — ยังไม่มี public.audit_stmt บนฐานนี้';
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS trg_audit_ins ON public.local_products;
  DROP TRIGGER IF EXISTS trg_audit_upd ON public.local_products;
  DROP TRIGGER IF EXISTS trg_audit_del ON public.local_products;

  CREATE TRIGGER trg_audit_ins AFTER INSERT ON public.local_products
    REFERENCING NEW TABLE AS audit_new
    FOR EACH STATEMENT EXECUTE FUNCTION public.audit_stmt('local_product', 'name', 'product_template_id');
  CREATE TRIGGER trg_audit_upd AFTER UPDATE ON public.local_products
    REFERENCING OLD TABLE AS audit_old NEW TABLE AS audit_new
    FOR EACH STATEMENT EXECUTE FUNCTION public.audit_stmt('local_product', 'name', 'product_template_id');
  CREATE TRIGGER trg_audit_del AFTER DELETE ON public.local_products
    REFERENCING OLD TABLE AS audit_old
    FOR EACH STATEMENT EXECUTE FUNCTION public.audit_stmt('local_product', 'name', 'product_template_id');
END;
$mk$;
