-- ─────────────────────────────────────────────────────────────────────────────
--  index สำหรับให้ระบบภายนอกไล่ดึง sale_order_details ผ่าน /api/sync/v1 (เจ้าของเปิดตาราง 2026-10-10)
--
--  ทำไมต้องมี: โหมด incremental ไล่หน้าด้วย ORDER BY (updated_at, sale_order_id) — ไม่มี index คู่นี้
--    ทุกรอบที่ปลายทางถาม (ทุก 10 นาที) = Seq Scan + sort ทั้งตาราง ~319,000 แถวที่มี jsonb ของบรรทัดสินค้า
--    รูปเดียวกับ idx_sale_orders_sync_cursor ใน 2026-09-02_05 · ด่าน diag:sync-api ข้อ 8 ตรวจแผน query
--  ต้องมี pk ต่อท้ายเพราะตัว sync v3 upsert ทีละ batch → หลายร้อยแถวได้ updated_at = NOW() ค่าเดียวกัน
--
--  เพิ่ม index อย่างเดียว ไม่แตะข้อมูล · รันก่อนหรือหลัง deploy ก็ได้ (ก่อนรัน = ดึงได้ถูกต้องแต่ช้า)
--
--  ⚠️ ต้องรันผ่าน psql เท่านั้น ห้ามผ่าน scripts/runMigration.ts — CREATE INDEX CONCURRENTLY
--     อยู่ใน transaction ไม่ได้ · ที่ต้อง CONCURRENTLY เพราะ sync ใบสั่งขายเขียนตารางนี้ในเวลางาน
--     ถ้าสร้างล้มกลางทาง index ค้างเป็น INVALID และ IF NOT EXISTS จะข้ามมัน ⇒ DROP INDEX แล้วรันใหม่
--
--  รัน (server): docker compose exec -T db psql -U "$PG_USER" -d "$PG_DATABASE" -v ON_ERROR_STOP=1 \
--                  -f - < migrations/changes/2026-10-10_01_sale_order_details_sync_cursor.sql
--  รัน (dev):    & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d chatbot_primus_dev -v ON_ERROR_STOP=1 `
--                  -f migrations/changes/2026-10-10_01_sale_order_details_sync_cursor.sql
--  ไฟล์นี้ idempotent — รันซ้ำได้ผลเท่าเดิม
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sale_order_details_sync_cursor
  ON sale_order_details (updated_at, sale_order_id);
