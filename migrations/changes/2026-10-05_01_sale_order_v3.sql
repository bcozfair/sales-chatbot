-- 2026-10-05_01 — ย้าย sync ใบสั่งขายไป sale_order_updated_records_v3 (docs/plan-saleorder-v3.md ข้อ 4.1)
--
-- additive ล้วน: ไม่แก้/ไม่ลบคอลัมน์เดิม · โค้ด v2 ที่ยังรันอยู่ไม่เห็นความต่าง
-- ADD COLUMN ที่ไม่มี DEFAULT เป็นการแก้ catalog อย่างเดียว (ไม่เขียนทั้งตาราง) แต่ยังต้องได้
-- ACCESS EXCLUSIVE lock ชั่วขณะ ⇒ lock_timeout กันไปต่อคิวหลัง query ยาว ๆ แล้วทำให้ทุกคนที่อ่าน
-- sale_orders ต่อคิวหลังเราอีกที · ล้มเพราะ timeout = รันใหม่ได้ (IF NOT EXISTS ทุกบรรทัด)
SET lock_timeout = '5s';

-- source_updated_at = "V3 Updated At" ของ gateway — ตัวกันของเก่าทับของใหม่ (ตัวเขียนเทียบก่อนอัปเดต)
-- order_* = ยอดทั้งใบ รวมจากทุกบรรทัด (คอลัมน์ total_amount ฯลฯ เดิมเป็นของบรรทัดแรก และยังแปลว่าแบบนั้นต่อไป)
-- NULL = ใบนี้ยังไม่เคยถูก v3 เขียน (ยังไม่ backfill / ใบไม่มีบรรทัด)
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS source_updated_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS order_total_amount numeric,
  ADD COLUMN IF NOT EXISTS order_total_discount numeric,
  ADD COLUMN IF NOT EXISTS order_amount_after_discount numeric,
  ADD COLUMN IF NOT EXISTS order_vat numeric,
  ADD COLUMN IF NOT EXISTS order_net_amount numeric,
  ADD COLUMN IF NOT EXISTS order_line_count integer;

-- รายละเอียดบรรทัด/ใบแจ้งหนี้/MO ของ 1 ใบ เป็น jsonb ก้อนเดียว (รูปอยู่ในแผนข้อ 4.3)
-- คีย์ sale_order_id ไม่ใช่ order_reference เพราะ Odoo เปลี่ยนชื่อเอกสารตอนยืนยัน (Q* → OP*)
-- แยกตารางจาก sale_orders เพราะ jsonb ~0.7–0.8 KB ต่ำกว่าเกณฑ์ TOAST จะอยู่ในแถวแล้วทำให้ตารางหลักอ้วน
CREATE TABLE IF NOT EXISTS public.sale_order_details (
    sale_order_id integer NOT NULL,
    order_reference character varying(255) NOT NULL,
    source_updated_at timestamp with time zone NOT NULL,
    lines jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT sale_order_details_pkey PRIMARY KEY (sale_order_id)
);

CREATE INDEX IF NOT EXISTS idx_sale_order_details_ref ON public.sale_order_details (order_reference);
