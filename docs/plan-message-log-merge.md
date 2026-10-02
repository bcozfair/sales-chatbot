# รวมประวัติแชทให้ครบ — `messages` + `webhook_events`

> สถานะ (2026-10-02): **เฟส 1 ลงโค้ดแล้วบน branch `msg-gap-capture` · ยังไม่ merge ยังไม่ deploy
> migration `2026-10-02_01` ยังไม่ได้รันบนฐานจริง** · เฟส 2–3 ยังเป็นแบบที่เสนอ
> เจ้าของอนุมัติทิศทาง 2026-10-02

## คำสั่งเจ้าของ (2026-10-02)

- ของที่ยังเก็บไม่ครบ เก็บเพิ่มใน **"ตารางเดิมของมัน"**: เรื่องของ event → `webhook_events` · ข้อความ → `messages`
- แถวใหม่ใน `messages` **ต้องไม่เข้าประวัติที่ป้อน LLM** — บอทต้องเหมือนเดิม 100%
- จะทดลองให้บอท "จำปุ่ม" ทีหลัง เมื่อสะสมข้อมูลได้ 3–4 สัปดาห์ ⇒ แถวใหม่ต้องมีหน้าตาพร้อมป้อน LLM ได้
  (ห้ามมี `reply_content` เป็น NULL — `quoteExtraction` ต่อสตริง `บอท: ${reply_content}` จะได้ "บอท: null")
- เนื้อแชทดูได้เฉพาะ admin · ยังไม่ deploy

## ตัวเลขที่ใช้ตัดสินใจ (ฐานจริง · อ่านอย่างเดียว · วัด 2026-10-02)

| เรื่อง | ค่า |
| --- | --- |
| `messages` ทั้งตาราง | 8,895 แถว — text 5,514 · postback 3,262 · `web_*` 109 · file 4 · audio 2 · sticker 1 |
| `webhook_events` | 1,274 แถว (2026-09-23 16:07 → 2026-10-02 15:51) |
| event ที่ `outcome = 'replied'` แต่ไม่มีแถวใน `messages` | select_product 77 · select_contact 44 · text 32 · select_company 22 · edit_menu 13 · confirm 4 · cancel 2 (+ กลุ่ม B ของการส่งซ้ำ 12) |
| แถวเติมที่คาดไว้ | ~21.6 แถว/วัน เทียบ `messages` 129.7 แถว/วัน (~+17%) |
| ปุ่มยืนยันที่มี `reply_token` ซ้ำ 2 แถว | 8 event (ชุด PM+THT เขียนแถวต่อใบ) ⇒ ทำ UNIQUE บน `reply_token` ไม่ได้ |
| `created_at` ของแถว handler เทียบ `first_seen_at` | p50 0.68 วิ · p95 3.9 วิ · max 9.0 วิ |
| `getRecentMessages` + ตัวกรอง | Index Scan `idx_messages_user_created` + Filter ไม่มี Sort · 0.10 ms |
| `salespersonPicker` จำลองย้อน 9 วันเมื่อมีแถวเติม | ตัวเลือกสลับ 0/5 |
| ผลสำรวจ corpus ของ extractionEval | เคสที่ prompt จะเปลี่ยนถ้าเปิดแถวเติมให้ LLM: 4/384 |

## เฟส 1 — เก็บส่วนที่ขาด (ลงโค้ดแล้ว)

| ชั้น | ไฟล์ | หน้าที่ |
| --- | --- | --- |
| schema | `migrations/changes/2026-10-02_01_webhook_events_reply.sql` | `webhook_events` + `message_text` · `reply_status` · `reply_error` · `reply_preview` (nullable ไม่มี DEFAULT · ยุบเข้า `schema.sql` แล้ว) |
| SQL | `db/webhookEventsRepo.ts` | `recordEventText` · `recordReplyOutcome` — เขียนครั้งเดียว (`IS NULL`) · error ใด ๆ = พักสองตัวนี้ 10 นาที · ห้าม throw |
| SQL | `db/repositories.ts` | `insertWebhookFillMessage` (NOT EXISTS ตาม `user_id` + `reply_token` ย้อน 10 นาที) · `getRecentMessages` กรองแถวเติม |
| ชนิดแถว | `db/messageKinds.ts` | prefix `wh_` ที่เดียว · `excludeWebhookFillSql()` = `left(type, 3) IS DISTINCT FROM 'wh_'` (ไม่ใช้ LIKE เพราะ `_` เป็น wildcard และ NULL หาย) |
| ตัวจด | `services/chatChannel.ts` | `createRecordingClient(lineClient)` — ส่งจริงตามเดิมทุกบิต คืนค่า/โยน error ตัวเดิม `===` แล้วจดชั้นบนของข้อความ (ไม่เปิด contents ของ Flex) |
| ตัวคุมลำดับ | `services/webhookRecorder.ts` | รองานจบ (≤120 วิ) → ปิดตัวจด → `reply_*` → แถวเติม · ไม่ await บนเส้นรอตอบ · `flushWebhookRecords` ตอนปิดโปรเซส (≤3 วิ) |
| ต่อสาย | `index.ts` | `toIncomingEvent` (`messageText`) · `/callback` · งานในคิว · `handleRedelivery` (กลุ่ม B) · shutdown |

แถวเติมใน `messages`:

| event | `type` | `content` | `message_id` |
| --- | --- | --- | --- |
| postback | `wh_postback` | `[กดปุ่ม] <postback.data>` (ดิบ — แปลงตอนอ่าน) | `wh_postback_<ms>` |
| message text | `wh_text` | ข้อความดิบ | `message.id` |
| message ชนิดอื่น (ไม่ใช่ image) | `wh_<ชนิด>` | `[Received <ชนิด> message]` | `message.id` |

`reply_content` = ข้อความที่ส่งสำเร็จ (text ตรงตัว · Flex = altText) · ไม่มีรอบไหนสำเร็จ = `[บอทไม่ได้ตอบ]`
· `meta` NULL · `created_at` = เวลารับ webhook · เขียนเฉพาะ event ที่ handleEvent ไม่ได้เขียนแถวเอง

**จงใจไม่ทำ:** เติม insertMessage ในทุกทางตอบของ lineHandler (~50 จุด) · แปลง postback เป็นชื่อตอนเขียน ·
backfill 185 event เก่า · แถวเติมของ image / follow / unfollow / join / dropped / ตัวส่งซ้ำที่รอบแรกเคยมาถึง /
งานผีเกิน 120 วิ · UNIQUE บน `reply_token` · ใช้ `reply_status` ตัดสิน outcome หรือการส่งซ้ำ ·
แก้ `salespersonPicker.ts` (กดปุ่ม = ใช้งานล่าสุด ถูกความหมาย) · แก้ `trafficDailyJob.ts` (นับทุกแถวตามที่เจ้าของเคาะ)
· แก้ `externalSync.ts`

**ความเสี่ยงที่เหลือ:** งานผีเกิน 120 วิไม่ได้แถวเติม (`reply_status` = pending) · ค้างตอน restart เกิน 3 วิหาย ·
ผู้ถือกุญแจ Sync API เห็น `wh_*` · `traffic_daily.messages_in` กระโดด ~+17% วัน deploy · คำตอบในแถวเติมเป็น
altText (น้อยกว่า summary ของแถว handler) · แถว handler เก็บ "คำตอบที่ตั้งใจส่ง" แม้ส่งไม่ถึง ⇒ ต้องดูคู่กับ
`reply_status`/`reply_preview` · `message_text` ซ้ำ `messages.content` (PII สองตาราง ถาวร)
· การกันแถวซ้ำพึ่งสองเงื่อนไขนอกตัวมัน (insertMessage ใน lineHandler ถูก await ทุกจุด · handleImage เป็นทางเดียว
ที่ไม่ผ่านตัวจด) — ด่านอ่านซอร์สคุม

gate: `npm run diag:webhook-recorder` + `npm run diag:redelivery`

**ลำดับ deploy (รอเจ้าของสั่ง):** merge → `db:dump` + migration ผ่าน psql (`DEPLOY.md` ขั้น 4 · `we_reply` ต้องเป็น `t`)
→ `diag:redelivery` ข้อ 7 ไม่มี ⏭️ → build + up + prune → `diag:webhook-recorder` (ชุดหลัง deploy) + `diag:redelivery`

## เฟส 2 — หน้าจอ (ยังไม่เริ่ม)

- **A · ไทม์ไลน์ของ request** — ในหน้าบันทึกระบบ เปิด request หนึ่งแล้วเห็น event · ข้อความที่พิมพ์ · คำตอบที่ส่งถึง
  (`webhook_events` ผูกกับ `api_logs` ด้วย `request_id`)
- **B · ชิป 💬 ในตาราง API logs** — แถว `/callback` ที่มีข้อความ กดแล้วเปิด A
- **C · แท็บบทสนทนา** (ภายหลัง) — ไล่แชทของเซลส์หนึ่งคนตามเวลา รวม `messages` ทุกชนิด
- ตัวแสดง postback เป็นชื่อ **ฟังก์ชันเดียว** ใช้ร่วมกับเฟส 3

กติกาสิทธิ์ (ต้องจริงก่อนมีหน้าจอแรก):
- ทุก route ที่คืนเนื้อแชท (`messages.content` / `reply_content` · `webhook_events.message_text` / `reply_preview` /
  `postback_data`) = `adminAuthMiddleware` + `requireCapability('page.traffic')` + `requireRole('admin')` **ที่ `index.ts`**
  (บรรทัดที่มี `requireCapability` ผ่านด่าน `diag:role-permissions` ข้อ 12 อยู่แล้ว)
- **ไม่ใส่เนื้อแชทในไฟล์ CSV ที่ส่งออก**
- การเปิดดูเนื้อแชทเขียน audit `log.view` แบบเดียวกับหน้าบันทึกระบบ

## เฟส 3 — ทดลองให้บอทจำปุ่ม (หลังสะสม 3–4 สัปดาห์)

- เปิดแถว `wh_*` ให้ประวัติของ LLM ใน **ทางทดลอง** ไม่ใช่ทาง production ก่อน
- วัดด้วย `extractionEval` + ชุดเฉลย "งานหลายขั้น" ที่เจ้าของเคาะ (ผลสำรวจ 2026-10-02: corpus เดิมมีเคสที่ prompt
  เปลี่ยนแค่ 4/384 ⇒ ชุดเดิมวัดผลของเรื่องนี้ไม่ได้ ต้องมีชุดใหม่)
- ระวัง: หน้าต่าง 10 แถวจะเปลี่ยน · แถวปุ่มอาจชนคำตัดประวัติใน `quoteExtraction` ("ยืนยันสำเร็จ" / "ยกเลิก…")
  ⇒ เป็นงานแยก ต้องผ่าน `diag:line-parity` (prompt เปลี่ยน = golden เปลี่ยน ต้องให้เจ้าของเคาะ)
