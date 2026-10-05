# รวมประวัติแชทให้ครบ — `messages` + `webhook_events`

> สถานะ (2026-10-05): **เฟส 1 อยู่ใน main แล้ว (merge `b2d7aa3`) · migration `2026-10-02_01` ลงฐานจริงแล้ว
> 2026-10-05 · โค้ดตัวบันทึกยังไม่ deploy** (วัด 2026-10-05: `reply_status` / `message_text` ยังว่างทุกแถว · แถว `wh_*` = 0)
> · **เฟส 2 ลงโค้ดแล้วบน branch `log-chat-ui`** (ยังไม่ merge ยังไม่ deploy) · เฟส 3 ยังเป็นแบบที่เสนอ
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

`webhook_events.reply_status` (คำนวณหลังงานจบหรือครบเพดาน 120 วิ · `replyStatusOf()` ลำดับเงื่อนไขคือความหมาย):
`sent` มีรอบส่งสำเร็จ → `pending` งานยังไม่จบ หรือยังมีรอบค้าง (**แม้รอบที่จดได้จะล้มหมด** — งานที่ยังวิ่งยังส่ง
ทางสำรองสำเร็จได้) → `failed` งานจบแล้วและล้มทุกรอบ → `none` งานจบแล้วไม่ได้เรียกส่งเลย

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

gate: `npm run diag:webhook-recorder` + `npm run diag:redelivery` · ก่อน merge ใส่ `npm run diag:webhook-recorder -- --frozen-handler`
(ข้อ 3ข: `handlers/lineHandler.ts` เทียบจุดแยกจาก main ต้องเปลี่ยนแค่คอมเมนต์) · ชุด 6 ข้ามเองจนกว่าจะรัน migration + deploy

**ลำดับ deploy (รอเจ้าของสั่ง):** merge → `db:dump` + migration ผ่าน psql (`DEPLOY.md` ขั้น 4 · `we_reply` ต้องเป็น `t`)
→ `diag:redelivery` ข้อ 7 ไม่มี ⏭️ → build + up + prune → `diag:webhook-recorder` (ชุดหลัง deploy) + `diag:redelivery`

## เฟส 2 — หน้าจอ (ลงโค้ดแล้ว 2026-10-05 · branch `log-chat-ui` · ยังไม่ deploy)

แบบ: mockup `mockups/log-chat-messages.html` (gitignore) — **เจ้าของเลือกทาง ก ทั้ง 4 ข้อ ("ตามที่แนะนำ" 2026-10-05)**

| ข้อ | ที่เลือก | ลงที่ |
| --- | --- | --- |
| 1 · กล่อง "ทุกอย่างของ request นี้" | ก้อนบทสนทนา **ปักบนสุด** + หมุดสั้น "รับข้อความ" / "ส่งคำตอบ" ในเส้นเวลาตามเวลาจริง (หมุดส่ง = `handled_at`) ไม่พิมพ์เนื้อซ้ำ | `frontend/src/admin/logs/RequestTimeline.tsx` |
| 2 · ชิปในตาราง API logs | แยกตามหน้าที่ของแถว: `/callback` = ขาเข้า · `TASK` = คำตอบ + ผลการส่ง · แถวหน้าเว็บ = ก้อนของ request นั้น · โหลด **ครั้งเดียวต่อหน้า** (`GET /api/admin/logs/chat?ids=` ≤200 id) | `ApiLogs.tsx` · `logs/ChatExchange.tsx` |
| 3 · คนไม่ใช่ admin | เห็นแม่กุญแจ + ชนิดข้อความ + ผลการส่ง + `reply_error` · **server ไม่ส่งเนื้อเลย** | `services/chatLogService.ts` |
| 4 · ตัวกรอง | ติ๊ก "เฉพาะที่บอทส่งไม่ถึง" ข้าง "เฉพาะที่ช้า" → `?undelivered=1` = แถว `TASK` ของ request ที่มี event `failed`/`pending`/`none` หรือ `warn_failed` | `buildApiLogWhere` + `UNDELIVERED_EVENT_SQL` (`db/logRepositories.ts`) |

**ไม่ทำ:** แท็บ C (บทสนทนาของเซลส์หนึ่งคน) — ก้อนบทสนทนาเป็นของร่วมไว้รอแล้ว

### การผูกข้อความกับ request — ห้ามจับคู่ด้วยเวลา

- **LINE** = `webhook_events.request_id` → `reply_token` → `messages.reply_token` (+ `user_id` เดียวกัน · ช่วงเวลา
  −10 นาที…+1 ชม. จากรับ webhook มีไว้ให้ใช้ index ได้ ไม่ใช่ตัวจับคู่) · ตรวจแล้ว 100% ของแถวตั้งแต่ 23/9 มี `request_id`
  · วัด 2026-10-05: แถวของ handler ลงหลังรับ 0.004–9.0 วิ
- **หน้าเว็บ** = `messages.meta->>'api_request_id'` **เริ่มเขียน 2026-10-05 (วันที่ขึ้นจอ · เจ้าของสั่ง)** ที่ทุกจุดเขียนแถว
  `web_*`: `logWebEvent` (propose · draft · revise) · `confirmQuotationById` (web_confirm) · `logApprovalEvent` (4 ชนิด)
  — id มาจาก `getRequestId(req)` ส่งลงไปทางพารามิเตอร์ `apiRequestId` · **แถวเว็บที่เกิดก่อนหน้านั้นไม่ขึ้น (ยอมรับ)**
  · ชื่อคีย์ **ไม่ใช่ `request_id`** เพราะแถว `web_approval_*` ใช้คีย์นั้นเก็บเลขคำขออนุมัติราคาอยู่แล้ว
  (ใช้ชื่อเดียวกัน = คีย์เดียวสองความหมาย และแถวอนุมัติจะผูกกับ request ไม่ได้)

### สิทธิ์ (เปลี่ยนจากแบบเดิมที่เขียนไว้ว่า `requireRole('admin')` ที่ index.ts — ทาง ก ข้อ 3 ให้ role อื่นเห็น metadata)

- route อยู่ใน `logsRouter` ซึ่ง mount ด้วย `adminAuthMiddleware` + `requireCapability('page.traffic')` ที่ `index.ts` อยู่แล้ว
- **ตัดเนื้อตาม role ที่ server ที่เดียว**: `canReadChatContent(role)` = `role === 'admin'` ·
  `getChatForRequests(ids, viewerRole(req))` → ไม่ใช่ admin = repository **ไม่ SELECT** `message_text` / `postback_data` /
  `reply_preview` / `content` / `reply_content` และไม่อ่านแถวของ LINE ใน `messages` เลย · ก้อนไม่มีคีย์ `content`
- เนื้อ = ข้อความที่พิมพ์ · data ปุ่ม + คำแปล · คำตอบบอท · สิ่งที่ LINE รับไป · ข้อความในหน้าเว็บ ·
  ไม่ใช่เนื้อ (ทุกคนเห็น) = ชนิด · ผลการส่ง · `reply_error` / note ของ `warn_failed` · ชื่อ/รหัสเซลส์ · เวลา
- **ไม่ใส่เนื้อแชทในไฟล์ CSV ที่ส่งออก** (`/export` ไม่แตะบทสนทนาเลย)
- เปิดดูเนื้อ (admin และมีอย่างน้อยหนึ่งก้อน) เขียน audit `log.view` entity `message` — ทั้ง `/chat` และ `/request/:id`
  (ตาราง API logs = 1 แถว audit ต่อการโหลดหนึ่งหน้า เหมือน `/audit` · `/system`)

### ผลการส่ง — `deliveryOf()` ลำดับเงื่อนไขคือความหมาย

`warn_failed` (redelivery_action) → `reply_status` (sent/failed/pending/none) → `warned` → `nodata` ·
**ไม่อ่าน `outcome`** (`replied` ≠ ส่งถึง) · แถวของ handler = "คำตอบที่บอทเตรียมไว้ · บันทึกก่อนส่ง" ·
แถวเติม = "สิ่งที่ส่งถึงจริง" (การ์ด = altText) · `[บอทไม่ได้ตอบ]` แสดงเป็นประโยค · คำแปลปุ่ม = `utils/postbackLabel.ts`
ฟังก์ชันเดียว (เฟส 3 ต้องเรียกตัวนี้)

### ตัวเลข (ฐานจริง · READ ONLY · วัด 2026-10-05)

| query | แผน | เวลา |
| --- | --- | --- |
| event ของ 200 request (`webhook_events` 1,380 แถว) | Seq Scan + Hash Left Join `salesperson` | 0.7 ms |
| ข้อความ LINE ของ 200 event (`messages` 8,994 แถว · ได้ 177 แถว) | Hash Join · Seq Scan `messages` | 3.7–8.8 ms |
| แถวหน้าเว็บด้วย `meta->>'api_request_id'` | Seq Scan `messages` (กรอง `web:%`) | 2.8 ms |
| ตัวกรองส่งไม่ถึง (7 วัน) | Seq Scan `webhook_events` → Index Scan `idx_api_logs_request_id` | 0.4 ms |
| `getChatForRequests` 200 id ครบวง (admin / subadmin) | 3 / 2 คำสั่งใน READ ONLY เดียว | 40 / 12 ms |

**ยังไม่ต้องสร้าง index** — โตเชิงเส้นตาม `messages` (~150 แถว/วัน + แถวเติม ~17%) ⇒ ราว 60k แถวในหนึ่งปี ≈ 30–50 ms
ถ้าวันหนึ่งช้า ตัวเลือกคือ `messages (reply_token)` และ partial `messages ((meta->>'api_request_id')) WHERE meta ? 'api_request_id'`
(query เขียน `meta ? 'api_request_id'` ไว้แล้วให้ planner ใช้ partial index ได้) · `webhook_events (request_id)` ยังไม่จำเป็น

gate: `npm run diag:log-chat` (ข้อ 2 = การรั่วของเนื้อแชท ห้ามล้ม) + `npm run diag:log-chat-ui` (จอจริง · API จำลอง) +
`diag:role-permissions` (ข้อ 12 ตรวจว่าทุกเส้นใน logsRouter ที่คืนบทสนทนาผ่านตัวตัดตาม role)

## เฟส 3 — ทดลองให้บอทจำปุ่ม (หลังสะสม 3–4 สัปดาห์)

- เปิดแถว `wh_*` ให้ประวัติของ LLM ใน **ทางทดลอง** ไม่ใช่ทาง production ก่อน
- วัดด้วย `extractionEval` + ชุดเฉลย "งานหลายขั้น" ที่เจ้าของเคาะ (ผลสำรวจ 2026-10-02: corpus เดิมมีเคสที่ prompt
  เปลี่ยนแค่ 4/384 ⇒ ชุดเดิมวัดผลของเรื่องนี้ไม่ได้ ต้องมีชุดใหม่)
- คำแปลปุ่มใช้ `utils/postbackLabel.ts` ตัวเดียวกับหน้าจอเฟส 2
- ระวัง: หน้าต่าง 10 แถวจะเปลี่ยน · แถวปุ่มอาจชนคำตัดประวัติใน `quoteExtraction` ("ยืนยันสำเร็จ" / "ยกเลิก…")
  ⇒ เป็นงานแยก ต้องผ่าน `diag:line-parity` (prompt เปลี่ยน = golden เปลี่ยน ต้องให้เจ้าของเคาะ)
