-- ใบรับของ webhook เก็บ "ข้อความที่เซลส์พิมพ์" กับ "ผลของการตอบกลับ" เพิ่ม
-- (เจ้าของสั่ง 2026-10-02 · แผน: docs/plan-message-log-merge.md เฟส 1)
--
-- ทำไมต้องมี: outcome = 'replied' ไม่ได้แปลว่าคำตอบถึงเซลส์ — handleEvent กลืน error ของ
--   replyMessage เองในทางสำรอง (handlers/lineHandler.ts ท้าย handleEvent) แล้วคืนปกติ
--   ⇒ คิวนับว่า "ตอบแล้ว" ทั้งที่ LINE ปฏิเสธ · event ที่ไม่มีแถวใน messages (วัด 2026-10-02:
--   ~21.6 event/วัน) สอบกลับจากตารางนี้ตารางเดียวได้ว่าเซลส์พิมพ์อะไรและได้อะไรกลับไป
--
-- ความหมายของคอลัมน์ใหม่ (event ไม่มี id = ไม่มีแถวเลย · แถวที่เกิดก่อนไฟล์นี้ = NULL ทุกช่อง):
--   message_text  = ข้อความดิบของ event ชนิด text (ตัด NUL · ไม่เกิน 5000 ตัวอักษร) — เขียนตอนรับ
--                   ก่อนเข้าคิว ⇒ มีค่าแม้ event ถูก dropped หรือเป็นตัวส่งซ้ำ · NULL = ชนิดอื่น
--   reply_*       = เขียนหลังงานในคิวจบ (รอไม่เกิน 120 วิ) · NULL = ไม่ผ่านคิว (dropped ก่อนเริ่ม ·
--                   ตัวส่งซ้ำที่รอบแรกไม่เคยมาถึง — ดู redelivery_action) · image · ยังรองานอยู่
--                   · ตัวส่งซ้ำของ event ที่รอบแรกผ่านคิว = ค่าของรอบแรก
--   (ทุกช่องว่างได้ด้วยถ้าฐานสะดุดช่วงพักเขียน 10 นาที)
--   reply_status  = sent    มีอย่างน้อยหนึ่งรอบที่ส่งสำเร็จ
--                   failed  งานจบแล้ว พยายามส่งแต่ไม่สำเร็จเลยสักรอบ
--                   pending งานยังไม่จบเมื่อครบเพดาน 120 วิ หรือยังมีรอบส่งค้าง
--                           (แม้รอบที่จดได้จะล้มหมด — งานที่ยังวิ่งอยู่ยังส่งทางสำรองสำเร็จได้)
--                   none    จบโดยไม่เรียกส่งเลย
--   reply_error   = HTTP status + x-line-request-id + body ของรอบที่ล้ม (ไม่เกิน 1000)
--   reply_preview = ข้อความที่ส่งถึงจริง ชั้นบนเท่านั้น (text / altText ของ Flex · ไม่เกิน 1000)
--
-- reply_status ไม่ใช่ outcome — ห้ามใช้ตัดสินการส่งซ้ำ (services/redeliveryPolicy.ts อ่าน outcome)
--
-- nullable ไม่มี DEFAULT ⇒ แค่แก้ catalog ไม่เขียนแถวเดิม · ถือล็อกระดับ ms
-- รันก่อนหรือหลัง deploy ก็ได้: โค้ดที่เขียนคอลัมน์เหล่านี้จับ error เองแล้วพักเขียน 10 นาที
-- ไม่ใส่ public. ให้ด่านเอาตารางชั่วคราวชื่อเดียวกันมาบังได้ (แบบ 2026-09-23_02)

SET lock_timeout = '3s';

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS message_text  text,
  ADD COLUMN IF NOT EXISTS reply_status  text,
  ADD COLUMN IF NOT EXISTS reply_error   text,
  ADD COLUMN IF NOT EXISTS reply_preview text;

-- CHECK แยกออกมาใน DO เพราะ CHECK แบบ inline ที่รันซ้ำจะได้ตัวที่สองชื่อ _check1
-- กรองด้วย conrelid ด้วย ไม่ใช่ชื่ออย่างเดียว — ตารางชั่วคราวในด่านต้องได้ CHECK ของตัวเอง
DO $ck$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = to_regclass('webhook_events')
                    AND conname  = 'webhook_events_reply_status_check') THEN
    ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_reply_status_check
      CHECK (reply_status IN ('sent', 'failed', 'pending', 'none'));
  END IF;
END;
$ck$;
