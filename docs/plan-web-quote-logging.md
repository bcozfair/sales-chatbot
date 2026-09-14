# แผนงาน: เก็บประวัติการขอใบเสนอราคาจากหน้าเว็บลง `messages` (ตารางเดียว)

> **สถานะ: v2 — ✅ เขียนครบและด่านผ่านบนเครื่อง dev 2026-09-14**
> v1 ออกแบบ + เจ้าของเคาะครบ 3 ข้อ 2026-09-14 · สำรวจโค้ด + วัดกับ DB dev จริง 2026-09-13
>
> **เป้าหมายมีสองชั้น อย่าอ่านข้ามชั้นที่สอง**
> 1. เส้นทางเว็บต้องมีประวัติ `content` + `reply_content` เหมือน LINE — ใช้พัฒนาระบบต่อ
> 2. ประวัตินั้นต้อง **วัดได้ว่าระบบเรียงบริษัทถูกหรือเปล่า** เพื่อเอาไปตัดสินงานอีกชิ้น
>    (ความต่างของการจับคู่ลูกค้าระหว่าง LINE กับเว็บ — ยังไม่มีแผนของตัวเอง) ว่าจะย้ายกฎ
>    auto-select ของ LINE มาใช้บนเว็บได้ไหม **โดยไม่ต้องเดาเกณฑ์**

---

## §-1 ผลที่วัดได้จริงหลังเขียนเสร็จ (dev box, 2026-09-14)

| ด่าน | ก่อน | หลัง |
| --- | --- | --- |
| `npx tsc --noEmit` | ผ่าน | ผ่าน |
| `npm --prefix frontend run lint` · `build` | ผ่าน | ผ่าน |
| `npm run diag:web-quote` | ผ่าน 24 · ล้ม 0 | **ผ่าน 42 · ล้ม 0** (+18 ข้อจากข้อ 5 ที่เพิ่มใหม่) |
| `npm run diag:line-parity` | prompt ✓ · case1 ✓ · case2 ✗ · case3 ✓ | **เอาต์พุตเหมือนเดิมทุกบรรทัด** |
| `tsx scripts/evalCustomerSearch.ts` | 53/56 top-1 · `wrong-auto-select` 0 | **53/56 · 0** |

`case2_ambiguous` ของ line-parity **ล้มอยู่ก่อนเริ่มงานนี้แล้ว** และหลังแก้ล้มด้วยเนื้อหาเดิมทุกไบต์
(เทียบไฟล์เอาต์พุตก่อน/หลังต่างกันแค่บรรทัดโฆษณาสุ่มของ dotenvx) — สาเหตุคือสต็อกจริงและลำดับ
สินค้าที่ขยับไปจากตอนเก็บ golden ไม่ใช่ผลของงานนี้
บรรทัดที่เป็นด่านของงานนี้จริง ๆ คือ `prompt เหมือนก่อนย้ายทุกตัวอักษร` ซึ่ง ✓ ทั้งสองรอบ

---

## §0 สิ่งที่เจ้าของเคาะแล้ว (2026-09-14)

| คำถาม | คำตอบ |
| --- | --- |
| ตารางเดียวหรือสองตาราง | **ตารางเดียว** — `messages` + คอลัมน์ `meta jsonb` ตัวเดียว |
| `traffic_daily.messages` | **นับรวมแถวเว็บ** — ไม่แก้ `trafficDailyJob.ts` เลย |
| ประวัติเว็บป้อน LLM | **ปิดไว้ก่อน** — เขียน log แต่ยังไม่ให้ `historyContext` ใช้ |

---

## §1 ทำไมตารางเดียวถึงทำได้จริง — หลักฐานที่วัดมา

**วัด DB dev 2026-09-13:** `messages` มี **5,227 แถว / 4,184 kB** ช่วง 16 มิ.ย.–6 ก.ย. 2026
(~58 แถว/วัน) · `type`: `text` 3,353 · `postback` 1,868 · `file` 3 · `audio` 2 · `sticker` 1
· `content` / `reply_content` / `reply_token` / `message_id` **ไม่ NULL เลยสักแถว แต่ไม่มี
NOT NULL constraint สักคอลัมน์** · แถว `user_id LIKE 'web:%'` = **0**
· index: `messages_pkey` + `idx_messages_user_created (user_id, created_at DESC)`

**เงื่อนไขที่ทำให้คอลัมน์ใหม่ปลอดภัย — ตรวจแล้ว 2026-09-13:**
**ไม่มี query ไหนในรีโปใช้ `SELECT *` กับ `messages` เลยสักจุด** ทั้ง 13 จุดที่แตะตารางนี้
ระบุคอลัมน์เองทั้งหมด (`repositories.ts` · 8 diag script · `evalCustomerSearch` ·
`trafficDailyJob` · `salespersonPicker`) ⇒ คอลัมน์ `meta` **มองไม่เห็น** สำหรับของเดิมทั้งหมด

และเพราะ jsonb ที่ใหญ่เกิน ~2 KB ถูก Postgres ย้ายไป TOAST อัตโนมัติ + ไม่มี query เดิมตัวไหน
SELECT คอลัมน์นี้ ⇒ เส้นทางเดิม **ไม่อ่านมันจากดิสก์เลยแม้แต่ไบต์เดียว** ต้นทุนเป็นศูนย์จริง
ไม่ใช่ "น้อย"

### ทำไมไม่แยกตาราง (เหตุผลที่หนักที่สุด — ไม่ใช่เรื่องความสวยงาม)

`services/quoteExtraction.ts` เรียก `getRecentMessages(userId, 10)` โดยเส้นเว็บส่ง
`userId = web:<admin>:<sp>` เข้าไป และ **ได้ 0 แถวทุกครั้งมาตลอด** เพราะไม่เคยมีใครเขียนแถว
`web:%` ⇒ LLM ฝั่งเว็บทำงานโดยไม่มีประวัติ ส่วนฝั่ง LINE มี
**แยกตารางเมื่อไหร่ รูนี้ไม่มีวันปิดเองโดยไม่เขียน read path ที่สอง**

### ความสมมาตรที่ทำให้ "1 แถว = 1 เหตุการณ์" ยังอยู่ครบ

บน LINE ตอนเซลส์กดปุ่มเลือกบริษัทใน Flex picker → เป็น postback → **แถวใหม่ใน `messages`**
(`handlers/lineHandler.ts`) การที่แอดมินเลือก dropdown แล้วกด "สร้างร่าง" คือการกระทำเดียวกันเป๊ะ
⇒ **เป็นแถวใหม่เหมือนกัน ไม่ต้อง UPDATE แถวเดิม** ตารางนี้จึงยังเป็น append-only
ไม่มีเส้นทางไหนแก้แถวที่เขียนไปแล้ว

---

## §2 การเปลี่ยน schema

`migrations/changes/2026-09-14_01_messages_meta.sql` — `ALTER TABLE messages ADD COLUMN meta jsonb`
(ยุบเข้า `migrations/schema.sql` แล้วในคอมมิตเดียวกัน ตามกฎใน CLAUDE.md)

**ห้ามตั้ง NOT NULL และห้ามตั้ง DEFAULT** — "มี meta หรือไม่มี" คือสิ่งที่แยกแถวของเว็บออกจาก
แถวของ LINE ได้โดยไม่ต้องเพิ่มคอลัมน์ช่องทางมาซ้ำกับ prefix `web:` ใน `user_id` ซึ่ง
`services/webIdentity.ts` ประกาศไว้แล้วว่าเป็นสวิตช์เดียวของทั้งแผน

**ยังไม่ทำ index บน `meta`** — query เชิงพัฒนาบนหลักพันแถวใช้ seq scan พอ ค่อยเติม GIN
ตอนที่วัดแล้วว่าช้าจริง (เขียนไว้ที่นี่เพื่อไม่ให้ใครเติมโดยไม่มีตัวเลข)

---

## §3 รูปแบบแถว — 4 ชนิด

**การ map ฟิลด์ที่เป็นของ LINE ล้วน:**

| คอลัมน์ | LINE | เว็บ |
| --- | --- | --- |
| `user_id` | `U` + hex 32 | `web:<admin_id>:<sp_user_id>` ← **สวิตช์ช่องทางที่มีอยู่แล้ว ห้ามเพิ่มคอลัมน์ซ้ำ** |
| `message_id` | LINE messageId | `web_<step>_<epoch_ms>` — ธรรมเนียมเดียวกับ postback ที่ `lineHandler.ts` ใช้อยู่ |
| `type` | `text` / `postback` / … | `web_propose` · `web_draft` · `web_confirm` · `web_revise` |
| `reply_token` | token | **NULL** — ไม่ใช่ "ยังไม่ได้ใส่" แต่คือ "ไม่มีและจะไม่มีวันมี" |

| `type` | `content` | `reply_content` | `meta` |
| --- | --- | --- | --- |
| `web_propose` | ข้อความที่แอดมินวาง (ดิบ) | สรุปผลเป็นข้อความ ขึ้น `🏢` รูปแบบเดียวกับ LINE | `{intent, outcome, extracted, cust_candidates, contact_candidates, duration_ms}` |
| `web_draft` | `เลือก <บริษัท> / <ผู้ติดต่อ>` | `📝 ร่างใบเสนอราคา` + `🏢` + `👤` + รหัสร่าง | `{propose_msg_id, chosen_customer_id, chosen_contact_id, chosen_rank, quote_ids, outcome, duration_ms}` |
| `web_confirm` | `ยืนยัน` | `✅ ยืนยันสำเร็จ! …` | `{quotation_no, quotation_id, outcome}` |
| `web_revise` | `แก้ไข <เลขใบ>` | `📝 ร่างใบเสนอราคา` + `🏢` + รหัสร่าง | `{revise_from, draft_quote_id, chosen_customer_id, chosen_contact_id, …}` |

### §3.1 ทำไม `type` ต้องเป็น namespace ใหม่ ห้ามใช้ `'text'`

ด่านขุด corpus **ทุกตัว** กรอง `type = 'text'` ถ้าใช้ `'text'` แถวเว็บจะไหลเข้า 6 corpus เงียบ ๆ
และ `scripts/diag/customerSearchEval.ts` จะ resolve `user_id` ไปเจอ **แถวพร็อกซีที่ `branch`
เป็น NULL โดยตั้งใจ** (`services/webIdentity.ts`) ⇒ ให้คะแนนด้วยสาขาที่ไม่ตรงกับ production
แล้วผลก่อน/หลังเทียบกันไม่ได้

prefix `web_` แปลว่า **ค่าตั้งต้นคือถูกกันออก** จะเอาเข้า corpus เมื่อไหร่ค่อยแก้ filter เป็น
`type IN ('text','web_propose')` แบบตั้งใจ พร้อมแก้ `resolveSp` ให้ใช้เซลส์ตัวจริงจาก
`parseWebUserId()` ไม่ใช่แถวพร็อกซี

### §3.2 ทำไม `reply_content` ต้องเป็นข้อความ ห้ามยัด JSON

`scripts/evalCustomerSearch.ts` ขุดเฉลยด้วย `reply_content LIKE '%ร่างใบเสนอราคา%'` แล้ว
`match(/🏢 (.+)/)` — **แถว `web_draft` จึงขึ้นรูปแบบเดียวกับสรุปร่างของ LINE เป๊ะ** เพื่อให้
ใช้เป็นเฉลยได้ทันทีในวันที่เราตัดสินใจเปิดให้มันเข้า corpus โดยไม่ต้องแก้โค้ด eval สักบรรทัด
ยัด JSON ลง `reply_content` เมื่อไหร่ คุณสมบัตินี้หายทันที ⇒ **โครงสร้างไปอยู่ที่ `meta` เท่านั้น**

`reply_content` ของ `web_confirm` มีคำว่า `ยืนยันสำเร็จ` ตรงตัว เพราะ `quoteExtraction.ts` ใช้
สตริงนี้ตัดหน้าต่างประวัติ — ตอนนี้ยังไม่ได้ใช้ (history ปิดอยู่ §5.2) แต่เขียนให้ถูกตั้งแต่แรก
จะได้ไม่ต้องแก้ข้อมูลเก่าตอนพลิกสวิตช์

### §3.3 สิ่งที่ **ไม่** เก็บลง `meta`

`slimCustomerCandidates()` เก็บแค่ `rank · id · display_name · reference · score ·
matched_contacts · partial_contacts` — **ไม่ก๊อปแถวลูกค้าทั้งแถวมา** ที่อยู่/เบอร์/อีเมล
ไม่ได้ช่วยตอบคำถาม "ทำไมระบบเรียงแบบนี้" และการไม่ก๊อปมันมาไว้อีกที่คือการไม่เพิ่มจุดที่ PII รั่ว
เก็บ `LOG_CANDIDATE_LIMIT = 12` เท่ากับที่ picker ของ LINE slice ไว้

ขนาดประเมิน: candidates 12 ตัว ≈ 2.5 KB/แถว ที่ 50 propose/วัน ≈ **45 MB/ปี** — ไม่ต้องตั้ง
retention ในเฟสนี้

---

## §4 จุดแทรกโค้ด (ทำแล้วทั้งหมด)

| ไฟล์ | สิ่งที่ทำ |
| --- | --- |
| `db/repositories.ts` | `insertMessage()` รับ `meta` + **คืน `id`** (เดิมคืน `void`) · เพิ่ม `getMessageMetaById()` |
| `services/quoteExtraction.ts` | เพิ่มพารามิเตอร์ `useHistory` (ค่าปริยาย `true` = LINE ไม่ขยับ) |
| `services/webQuoteService.ts` | `logWebEvent()` + `slimCustomerCandidates()` / `slimContactCandidates()` + `buildProposeReplyText()` + `resolveChosenRank()` · เขียน log ที่ `proposeFromText` / `createDraft` / `reviseQuotation` |
| `index.ts` | route `/webquote/drafts` ส่ง `propose_msg_id` ต่อ · route `POST /api/quotation/:id/confirm` เขียน `web_confirm` |
| `frontend/src/admin/QuoteRequest.tsx` | เก็บ `propose_msg_id` จาก propose แล้วส่งกลับตอนสร้างร่าง (**ไม่มีอะไรเปลี่ยนบนหน้าจอ**) |
| `scripts/diag/webQuoteSmoke.ts` | ข้อ 5 — 18 ข้อตรวจใหม่ |

**ข้อห้ามที่ต้องรักษาไว้ตลอดไป:**
- **log ห้ามทำให้เส้นทางหลักล้ม** — `insertMessage()` กลืน error ด้วย `logErr` และคืน `null`
  ห้ามเปลี่ยนให้ throw
- **ห้ามอยู่ในทรานแซกชัน** — `logWebEvent()` ใช้ `pool` ⇒ ใน `createDraft` / `reviseQuotation`
  ต้องเรียก **หลัง** `insertDraftQuotations()` คืนค่าแล้วเท่านั้น (ฟังก์ชันนั้นมี `withTransaction`
  อยู่ข้างใน) และใน route confirm ต้องอยู่หลัง `confirmQuotationAtomic` ที่ COMMIT แล้ว
- **route `confirm` ใช้ร่วมกับ LIFF/LINE** — เขียนเฉพาะเมื่อ `parseWebUserId(userId)` ไม่ใช่ null
  ห้ามทำให้ใบที่เซลส์ยืนยันจาก LIFF เริ่มมีแถวใหม่ใน `messages`

---

## §5 `chosen_rank` — เครื่องมือวัดของงานอีกชิ้น

คำนวณตอนเขียนแถว `web_draft`: เปิดแถว `propose_msg_id` (SELECT by pk ตัวเดียว) แล้วหาอันดับของ
บริษัทที่เลือกใน `meta.cust_candidates`
· เทียบทั้ง `resolvedCustomerId` (บริษัทของผู้ติดต่อที่เลือกจริง ซึ่งอาจเป็นสาขาพี่น้อง) และ
บริษัทที่กดใน dropdown — เจอค่าใดค่าหนึ่งถือว่าระบบเสนอถูกแล้ว
· ไม่เจอ (แอดมินค้นเพิ่มเองจากช่อง "ค้นหาบริษัทเพิ่มเติม…") ⇒ `chosen_rank = null`
ซึ่งเป็น**ข้อมูลที่มีค่าที่สุด** เพราะแปลว่าระบบค้นไม่เจอคำตอบที่ถูกเลย

**คำถามที่ตารางนี้จะตอบ:** ในเคสที่ `cust_candidates[0].score <= 0.05` และห่างอันดับ 2 เกิน `0.05`
(เกณฑ์เดียวกับ `services/quotationService.ts` ที่ LINE ใช้ auto-select อยู่แล้ว) แอดมินเคาะ
อันดับ 1 กี่เปอร์เซ็นต์ ⇒ เกิน 95% เมื่อไหร่ = **พิสูจน์แล้วด้วยข้อมูลของเว็บเอง** ว่าย้ายกฎนั้น
มาใช้ได้ ไม่ใช่ยืมสมมติฐานจาก LINE มาใช้

### §5.1 ข้อจำกัดที่ต้องรู้ตอนอ่านตัวเลข

`webQuoteService.ts` เรียก `findContactCandidates` **เฉพาะตอนบริษัทเหลือตัวเดียว** ⇒
`contact_candidates` จะเป็น `[]` ในเคสที่บริษัทกำกวม ซึ่งเป็นเคสที่เราสนใจที่สุดพอดี
**นี่คือข้อจำกัดของเส้นทางที่มีอยู่ ไม่ใช่บั๊กของ log** — ห้ามแก้จุดนั้นในเฟสนี้ เพราะมันคือหนึ่งใน
สิ่งที่งานแก้ parity จะเปลี่ยน และถ้าแก้ไปพร้อมกัน ตัวเลขก่อน/หลังจะเทียบกันไม่ได้

### §5.2 ทำไม history ยังปิด

พอเขียน `messages` แล้ว `getRecentMessages` จะเริ่มคืนแถวให้เส้นเว็บทันที = **พฤติกรรมการสกัด
เปลี่ยนโดยไม่ได้ตั้งใจเพราะงาน log** และหน้าต่าง 15 นาทีจะไม่ถูกตัดจนกว่าจะมีแถว `web_confirm`
⇒ แอดมินวางใบที่ 2 ของลูกค้าคนละรายภายใน 15 นาที จะได้ลูกค้าของใบแรกติดมา

**วิธีปิด:** `proposeFromText()` ส่ง `useHistory: false` เข้า `extractQuoteFromText()` —
**ไม่แตะตัว `getRecentMessages`** เพื่อให้ฝั่ง LINE ไม่มีอะไรเปลี่ยนเลยแม้แต่บรรทัดเดียว
การเปิดสวิตช์นี้เป็น **งานคนละชิ้น** ที่ต้องมีตัวเลขของตัวเอง

---

## §6 ผลกระทบกับของเดิม — ตรวจครบทุกจุดแล้ว

| จุด | ผล | ทำอะไรไป |
| --- | --- | --- |
| `scripts/logworker/trafficDailyJob.ts` `count(*) FROM messages` | ตัวเลขจะรวมแถวเว็บ | **ไม่แก้** ตามที่เจ้าของเคาะ — **ตั้งแต่ 2026-09-14 `traffic_daily.messages` หมายถึง "ทุกช่องทาง" ไม่ใช่ LINE อย่างเดียว** กราฟที่ดูเหมือนกระโดดตรงวันนั้นคือสาเหตุนี้ ไม่ใช่ทราฟฟิกเพิ่ม |
| `services/salespersonPicker.ts` `max(m.created_at)` | **ไม่กระทบ** — join กับ `salesperson.user_id` ของคนจริง ไม่ใช่ `web:%` | ไม่ต้องทำ · **ข้อนี้พังทันทีถ้าเผลอ log ด้วย `sp_user_id` ตัวจริงแทนพร็อกซี** เซลส์จะดูเหมือนเพิ่งคุยใน LINE ทั้งที่ไม่ได้คุย |
| eval 6 ตัวที่กรอง `type='text'` | **ไม่กระทบ** เพราะ prefix `web_` | ยืนยันด้วย `evalCustomerSearch` = 53/56 เท่าเดิม |
| `scripts/diag/webQuoteSmoke.ts` · `lineFlexParity.ts` | ลบ `messages` ของ user ทดสอบอยู่แล้ว | teardown รองรับล่วงหน้าพอดี |
| `npm run db:dump` | โตขึ้นตามขนาด jsonb | ไม่ต้องทำ |

---

## §7 ด่านตรวจของงานนี้

1. `npx tsc --noEmit` + `npm --prefix frontend run lint` + `build`
2. `npm run diag:web-quote` — **ข้อ 5 เป็นด่านของงานนี้** (18 ข้อ) ครอบ: propose เขียนแถวจริง ·
   `content` เก็บข้อความดิบ · `reply_token IS NULL` · `meta.cust_candidates` ไม่ว่างและมี rank/score ·
   `web_draft` คงรูปแบบที่ eval ขุดเฉลยได้ · `web_confirm` มีคำว่า "ยืนยันสำเร็จ" · `web_revise` มีจริง ·
   `insertMessage` คืน id · `propose_msg_id` ผูกกลับถูกแถว · **`chosen_rank` ถูกต้อง** (ปลูก
   candidate สังเคราะห์ไว้ที่อันดับ 2 แล้ววัด — deterministic ไม่พึ่ง LLM) ·
   **แถวที่ไม่ใช่ของเว็บต้องมี `meta IS NULL` ทุกแถว** · **แถวของเว็บต้องไม่ใช้ `type` ของ LINE**
   สองข้อสุดท้ายตรวจทั้งตารางจริง ไม่ใช่แค่ข้อมูลทดสอบ ⇒ ถ้าวันไหนมีใครเผลอ log ข้ามช่องทาง
   ด่านนี้จะจับได้เอง
3. `npm run diag:line-parity` — บรรทัด `prompt เหมือนก่อนย้ายทุกตัวอักษร` ต้อง ✓
4. `tsx scripts/evalCustomerSearch.ts` (ไม่ใส่ `--ai`) — ต้องได้ **53/56 top-1** เท่าเดิม และ
   `wrong-auto-select = 0` · ขยับเมื่อไหร่แปลว่าแถวเว็บรั่วเข้า corpus = §3.1 พัง

---

## §8 สิ่งที่จงใจไม่ทำ

- **ไม่ log ช่อง "ค้นหาบริษัทเพิ่มเติม…"** ที่ยิงทุกตัวอักษร — ไม่ใช่บทสนทนา จะกลายเป็นแถวขยะ
  ในประวัติ เส้นนั้นเก็บที่ `api_logs` ตามเดิม
- **ไม่แตะตรรกะการค้นหา/การเลือกลูกค้าสักบรรทัด** — งานนี้คือเครื่องมือวัด ถ้าแก้ของที่จะวัด
  ไปพร้อมกัน ตัวเลขก่อน/หลังจะไม่มีความหมาย
- **ไม่ทำหน้าจอดูประวัติใน Admin Portal** — เฟสนี้เก็บข้อมูลอย่างเดียว ดูด้วย SQL ไปก่อน
- **ไม่ตั้ง retention / ไม่ทำ index** — ยังไม่มีตัวเลขที่บอกว่าจำเป็น

### query ที่จะใช้ตอนอ่านผล

```sql
-- แอดมินเคาะอันดับไหนบ้าง (null = ระบบไม่ได้เสนอบริษัทนั้นมาเลย)
SELECT meta->>'chosen_rank' AS rank, count(*)
  FROM messages WHERE type = 'web_draft' GROUP BY 1 ORDER BY 1 NULLS LAST;

-- เคสที่ LINE จะ auto-select ให้ แต่เว็บปล่อยว่าง — หัวใจของงานถัดไป
SELECT created_at, content,
       meta->'cust_candidates'->0->>'display_name' AS top1,
       (meta->'cust_candidates'->0->>'score')::float AS s1,
       (meta->'cust_candidates'->1->>'score')::float AS s2
  FROM messages
 WHERE type = 'web_propose' AND jsonb_array_length(meta->'cust_candidates') > 1
   AND (meta->'cust_candidates'->0->>'score')::float <= 0.05
   AND (meta->'cust_candidates'->1->>'score')::float
     - (meta->'cust_candidates'->0->>'score')::float > 0.05;
```
