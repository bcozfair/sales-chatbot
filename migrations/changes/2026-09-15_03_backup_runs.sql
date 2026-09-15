-- ประวัติการสำรองฐานข้อมูลอัตโนมัติ — ให้หน้า "บันทึกและรายงาน" เห็นว่า backup ยังเดินอยู่ไหม
--
-- เจ้าของสั่ง 2026-09-15: ระบบ autobackup (scripts/backup/autoBackup.sh · cron ตี 3) ต้องมี
-- รายงานในหน้าแอดมิน ไม่ใช่ต้อง SSH เข้ามารัน `npm run diag:backup` ถึงจะรู้ว่ามันล้ม
--
-- ทำไมต้องเป็นตาราง ไม่ใช่ให้แอปไปอ่านโฟลเดอร์ backup/ เอง:
--   แอปอยู่ในคอนเทนเนอร์ ส่วน backup/ อยู่บน host และ **ไม่ได้ mount เข้าไป** โดยตั้งใจ —
--   ไฟล์ dump มี PII ลูกค้าทั้งฐาน + bcrypt hash ของแอดมินทุกคน การเอาไปวางในโปรเซสที่
--   เสิร์ฟเว็บสาธารณะคือความเสี่ยงที่ไม่ได้อะไรกลับมา ⇒ สคริปต์บน host เป็นฝ่าย "เล่าให้ฟัง"
--   ผ่านตารางนี้แทน (เขียนด้วย psql ในกล่อง db ซึ่งมันคุยอยู่แล้ว)
--
-- แบบเดียวกับ log_worker_state: งานเบื้องหลังบน host ที่แอปไม่รู้จัก ต้องมีที่ให้มันรายงานตัว
-- ต่างกันที่ตารางนี้เก็บ "ทีละรอบ" ไม่ใช่สถานะล่าสุดแถวเดียว เพราะคำถามที่ต้องตอบคือ
-- "ล้มครั้งเดียว หรือล้มมาสามวันแล้ว" ซึ่งสถานะล่าสุดตอบไม่ได้
--
-- status:
--   success — ได้ไฟล์ที่ผ่าน pg_restore --list แล้ว
--   failed  — ล้มกลางทาง (ของเก่ายังอยู่ครบเสมอ — ดูลำดับใน autoBackup.sh)
--   skipped — ไม่ได้ทำเพราะมีตัวอื่นทำงานอยู่ (flock)
--
-- ไม่ผูก CHECK กับ status โดยตั้งใจ: วันหน้าถ้าเพิ่มสถานะใหม่ (เช่น verified_deep) จะได้ไม่ต้อง
-- migration ตามอีกไฟล์ · ฝั่งอ่านถือว่าค่าที่ไม่รู้จัก = แสดงตามตัวอักษร ไม่ใช่ error

CREATE TABLE IF NOT EXISTS backup_runs (
  id            BIGSERIAL PRIMARY KEY,
  started_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT        NOT NULL,
  file_name     TEXT,                      -- NULL เมื่อ failed/skipped
  size_bytes    BIGINT,
  toc_entries   INTEGER,                   -- จำนวนรายการที่ pg_restore --list อ่านได้ = หลักฐานว่าไฟล์เปิดได้
  duration_ms   INTEGER,
  free_mb_after INTEGER,                   -- ที่ว่างของดิสก์หลังจบรอบ (สาเหตุอันดับหนึ่งที่จะล้ม)
  kept_files    INTEGER,                   -- เหลือไฟล์อัตโนมัติกี่ชุดหลัง retention
  message       TEXT                       -- เหตุผลตอนล้ม/ข้าม หรือหมายเหตุของรอบที่สำเร็จ
);

-- หน้าเว็บอ่านแบบ "ล่าสุดก่อน" อย่างเดียว และตารางนี้โตวันละ 1 แถว (365 แถว/ปี)
CREATE INDEX IF NOT EXISTS idx_backup_runs_finished_at ON backup_runs (finished_at DESC);
