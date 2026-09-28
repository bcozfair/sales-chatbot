-- บัญชีเสนอในนาม PM — ลูกค้าที่ตั้งไว้ ทุกสินค้าออกเป็นใบ Primus (PM) ใบเดียว ไม่แยกใบ Themtech
-- เจ้าของสั่ง 2026-09-28 · แผน: docs/plan-customer-quote-company.md
--
-- ── ตาราง 1: ค่าตั้งรายบริษัท ─────────────────────────────────────────────────
--  ขอบเขตแบบเดียวกับบัญชีห้ามเสนอราคา: เก็บ company_id เดียว แต่ "มีผล" กับทุกรหัสในนิติบุคคล
--  เดียวกัน (เลขภาษี/รหัสอ้างอิง/ชื่อ — db/companyIdentity.ts) · **ทั้งบริษัทเท่านั้น** ไม่มีระดับ
--  ผู้ติดต่อ (เจ้าของเลือก — บริษัทเดียวกันต้องได้ใบแบบเดียวกันไม่ว่าใครเป็นคนขอ)
--  ไม่มี FK ไป customers/customers_data_view เพราะสองตารางนั้นถูก sync/rebuild ทับทั้งก้อน
--  quote_company รับ THT ได้ด้วยเผื่อวันหน้า — วันนี้หน้าจอตั้งได้แค่ PM (ไม่ต้องมี migration ใหม่ถ้าจะเปิด)
CREATE TABLE IF NOT EXISTS public.customer_quote_company (
    company_id    integer PRIMARY KEY,
    quote_company text NOT NULL DEFAULT 'PM',
    note          text,
    created_by    integer,
    created_at    timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at    timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT customer_quote_company_company_id_check CHECK (company_id > 0),
    CONSTRAINT customer_quote_company_quote_company_check CHECK (quote_company IN ('PM', 'THT'))
);

-- ── คอลัมน์: บริษัทที่ "ใบนี้" ถูกบังคับให้เป็น ─────────────────────────────────
--  คัดลอกจากตารางข้างบนตอนใบผูกกับลูกค้า (สร้างร่าง / LINE เลือกบริษัทเสร็จ) แล้วตรึงไว้กับใบ
--  ⇒ ทุกจุดที่ตัดสินว่าใบเป็น PM/THT (ออกเลข · หัว PDF · Flex · ค่าขนส่ง) อ่านคอลัมน์นี้ก่อน
--  ไม่งั้นใบรวมที่สินค้ารายการแรกเป็นของ THT จะได้เลข QT · และแก้ค่าตั้งทีหลังแล้วใบเดิมไม่สลับหัว
--    NULL = แบ่งตามสินค้าเหมือนเดิม (resolveQuoteCompany) — ใบเก่าทุกใบ ⇒ ไม่ต้อง backfill
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS quote_company_override text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotations_quote_company_override_check') THEN
    ALTER TABLE public.quotations
      ADD CONSTRAINT quotations_quote_company_override_check
      CHECK (quote_company_override IS NULL OR quote_company_override IN ('PM', 'THT'));
  END IF;
END $$;

-- ไม่มี index บนคอลัมน์ใบ — อ่านเป็นค่าของแถวเท่านั้น ไม่มี query ไหนกรองด้วยมัน

-- ── audit — ใครเพิ่ม/ถอดบริษัทไหนเมื่อไหร่ (รูปเดียวกับ local_contacts ใน 2026-09-18_04) ──
--  ค่าตั้งนี้เปลี่ยนบริษัทผู้ขายของใบ ⇒ ต้องมีร่องรอยเหมือนบัญชีห้ามเสนอราคา
--  audit_stmt กลืน error ของตัวเองอยู่แล้ว ⇒ audit หายดีกว่าทำให้คนบันทึกไม่ได้
DO $mk$
BEGIN
  IF to_regproc('public.audit_stmt') IS NULL THEN
    RAISE NOTICE '[audit] ข้าม customer_quote_company — ยังไม่มี public.audit_stmt บนฐานนี้';
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS trg_audit_ins ON public.customer_quote_company;
  DROP TRIGGER IF EXISTS trg_audit_upd ON public.customer_quote_company;
  DROP TRIGGER IF EXISTS trg_audit_del ON public.customer_quote_company;

  CREATE TRIGGER trg_audit_ins AFTER INSERT ON public.customer_quote_company
    REFERENCING NEW TABLE AS audit_new
    FOR EACH STATEMENT EXECUTE FUNCTION public.audit_stmt('quote_pm', 'company_id', 'company_id');
  CREATE TRIGGER trg_audit_upd AFTER UPDATE ON public.customer_quote_company
    REFERENCING OLD TABLE AS audit_old NEW TABLE AS audit_new
    FOR EACH STATEMENT EXECUTE FUNCTION public.audit_stmt('quote_pm', 'company_id', 'company_id');
  CREATE TRIGGER trg_audit_del AFTER DELETE ON public.customer_quote_company
    REFERENCING OLD TABLE AS audit_old
    FOR EACH STATEMENT EXECUTE FUNCTION public.audit_stmt('quote_pm', 'company_id', 'company_id');
END;
$mk$;
