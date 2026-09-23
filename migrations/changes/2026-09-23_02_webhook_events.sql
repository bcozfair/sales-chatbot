-- ใบรับของ webhook ทุก event ที่ LINE ยิงเข้ามา — ตัวกันซ้ำ + หลักฐานสอบกลับ
-- (docs/line-webhook-redelivery.md)
--
-- ทำไมต้องมี: LINE ส่ง event ซ้ำเมื่อไม่ได้ 2xx (สวิตช์ webhook redelivery เปิดไว้ตั้งแต่ ~2026-09-16)
--   โค้ดเดิมข้าม `isRedelivery` ทุกตัวโดยถือว่า "เราตอบไปแล้วแน่ ๆ" ซึ่ง **จริงแค่ 5 ใน 7 ครั้ง**
--   (วัด 2026-09-23) อีก 2 ครั้งรอบแรกไม่เคยมาถึงแอปเลย ⇒ คำสั่งของเซลส์หายเงียบ
--   เกิดจริง: ใบ 4ae3ef39 กดยืนยันแล้วค้างเป็นร่าง เซลส์ต้องสังเกตเองแล้วกดใหม่
--   ตารางนี้ทำให้แยกสองกลุ่มนั้นออกจากกันได้ด้วยข้อเท็จจริง ไม่ใช่การเดา
--
-- ทำไมไม่เก็บใน `messages`: `messages` คือ **ความจำการสนทนาของบอท** — quoteExtraction อ่าน
--   10 แถวล่าสุดของเซลส์คนนั้นยัดเข้า prompt ของ LLM (services/quoteExtraction.ts) การเพิ่มแถว
--   ต่อทุก postback จะเบียดบทสนทนาจริงออกจากหน้าต่าง 10 แถว ⇒ บอทอ่านคำสั่งแย่ลงโดยไม่มีอะไรฟ้อง
--   และมีสคริปต์วัดผล 8 ตัวที่ขุดตารางนั้นไปทำชุดข้อสอบ แถวปุ่มจะปนเข้าไปเป็นคำค้นปลอม
--
-- ไม่ลบทิ้ง (เจ้าของสั่ง 2026-09-23) — ~170 แถว/วัน ≈ 62,000 แถว/ปี ≈ 10 MB/ปี
--
-- สร้างตารางใหม่อย่างเดียว ไม่ล็อกตารางเดิมสักตัว ⇒ รันได้ทุกเวลา และรันก่อน deploy โค้ดได้
-- (โค้ดฝั่งแอปจับ error ของทุก query ในตารางนี้แล้วตกกลับไปพฤติกรรมเดิม ⇒ ลำดับสลับกันได้)

CREATE TABLE IF NOT EXISTS webhook_events (
  -- ULID ที่ LINE ออกให้ต่อ 1 event · **ตัวส่งซ้ำใช้ค่าเดิมทุกตัวอักษร** จึงเป็น PK ที่กันซ้ำได้เอง
  -- ⇒ การรับ event เดียวกันซ้ำ = UPDATE แถวเดิม ไม่ใช่แถวใหม่ (ดู delivery_count)
  webhook_event_id  TEXT PRIMARY KEY,

  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- จำนวนครั้งที่ LINE ยิง event นี้มา (1 = มาครั้งเดียว) · วัดได้สูงสุด 5 ครั้ง กินเวลา 244 วิ
  -- (2026-09-21) ⇒ ตัวเลขนี้คือคำตอบตรง ๆ ว่า "ตัวไหนถูกส่งซ้ำกี่รอบ" โดยไม่ต้องไปไล่ log
  delivery_count    SMALLINT NOT NULL DEFAULT 1,

  event_type        TEXT NOT NULL,        -- message | postback | follow | join | ...
  message_type      TEXT,                 -- text | image | sticker | ... (เฉพาะ event_type=message)
  -- `action=confirm&id=<uuid>` — หัวใจของการสอบกลับ: บอกได้ว่าปุ่มที่หายไปสั่งอะไรกับใบไหน
  -- เก็บดิบทั้งสตริง ไม่แยกเป็นคอลัมน์ เพราะรูปแบบ postback เปลี่ยนได้ตามฟีเจอร์ที่เพิ่มทีหลัง
  postback_data     TEXT,

  line_user_id      TEXT,
  source_type       TEXT,                 -- user | group | room

  -- เวลาที่ LINE บอกว่า event เกิดขึ้นจริง (event.timestamp) — ไม่ใช่เวลาที่เรารับ
  event_at          TIMESTAMPTZ,
  -- ช่องว่างระหว่าง event_at กับตอนที่เรารับ · ของตัวส่งซ้ำคือ "อายุ replyToken ณ ตอนที่มาถึง"
  -- ซึ่งเป็นตัวเลขที่ต้องใช้ตัดสินใจว่ายังตอบทันไหม (วัดเอง 2026-09-23: token อยู่ได้ ≥120 วิ)
  first_delay_ms    INTEGER,
  last_delay_ms     INTEGER,

  -- เก็บไว้ผูกกับ messages.reply_token และกับบรรทัดใน log ตอนสอบกลับ
  -- หมดอายุเองในไม่กี่นาที จึงไม่ใช่ความลับที่ต้องกัน — และ messages ก็เก็บค่าเดียวกันอยู่แล้ว
  reply_token       TEXT,
  -- ผูกกับ api_logs.request_id ⇒ กระโดดไปดู duration / llm_ms / สถานะของ event นั้นได้
  request_id        TEXT,

  -- ผลของการประมวลผลรอบแรก — NULL = ยังไม่จบ (หรือไม่เคยเริ่ม)
  handled_at        TIMESTAMPTZ,
  outcome           TEXT
                    CONSTRAINT webhook_events_outcome_check
                    CHECK (outcome IN ('replied', 'timeout', 'dropped', 'failed')),

  -- สิ่งที่เราทำกับ "ตัวที่ถูกส่งซ้ำ" — NULL = event นี้ไม่เคยถูกส่งซ้ำ
  --   skipped_duplicate = รอบแรกตอบไปแล้ว ทิ้งเงียบ (ถูกต้อง)
  --   warned            = รอบแรกไม่เคยมาถึง/ทำไม่จบ ⇒ แจ้งเซลส์ให้สั่งใหม่ สำเร็จ
  --   warn_failed       = แจ้งไม่สำเร็จ (token ใช้ไม่ได้แล้ว) ⇒ ต้องมีคนตามต่อ · ดู note
  redelivery_action TEXT
                    CONSTRAINT webhook_events_redelivery_action_check
                    CHECK (redelivery_action IN ('skipped_duplicate', 'warned', 'warn_failed')),
  note              TEXT
);

-- ไล่ดูตามเวลาในหน้าสอบกลับ
CREATE INDEX IF NOT EXISTS idx_webhook_events_seen
  ON webhook_events (first_seen_at DESC);

-- "เซลส์คนนี้มี event อะไรหายไปบ้าง" — คำถามแรกที่ถูกถามเสมอเวลามีคนแจ้งว่าบอทไม่ตอบ
CREATE INDEX IF NOT EXISTS idx_webhook_events_user
  ON webhook_events (line_user_id, first_seen_at DESC);

-- เฉพาะตัวที่ถูกส่งซ้ำจริง (ส่วนน้อยมาก ~4% ของทั้งหมด) — index บางส่วนจึงเล็กและตรงคำถาม
CREATE INDEX IF NOT EXISTS idx_webhook_events_redelivered
  ON webhook_events (first_seen_at DESC)
  WHERE delivery_count > 1;
