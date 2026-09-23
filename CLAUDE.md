# CLAUDE.md

คู่มือสำหรับ agent ที่ทำงานในรีโปนี้ — เก็บ **สิ่งที่โค้ดไม่ได้พูดออกมาเอง**
`README.md` คือคำอธิบายโครงสร้างแบบละเอียด · `DEPLOY.md` คือ runbook ของการขึ้นระบบ ·
ไฟล์นี้คือ "ทำไมมันถึงเป็นแบบนี้" และ "อะไรที่เคยพังมาแล้ว"

**`AGENTS.md` คืออีกครึ่งหนึ่งและไม่ใช่ของเลือกอ่าน** — กฎ git, กฎเวลาหลาย session อยู่ในทรีเดียวกัน,
ขอบเขตการอนุมัติ และด่าน verify อยู่ที่นั่น
**`docs/design.md` ต้องอ่านก่อนแตะอะไรที่คนมองเห็น** — สี่พื้นผิวของแอปนี้ (Admin · LIFF · Flex · PDF)
มีกติกาคนละชุด และการเผลอเอากติกาของพื้นผิวหนึ่งไปใช้กับอีกพื้นผิวคือบั๊กที่เกิดซ้ำที่สุด

**กติกาของเอกสารชุดนี้ 3 ข้อ**

1. **เอกสารไม่ตรงโค้ด ให้เชื่อโค้ดแล้วแก้เอกสารในคอมมิตเดียวกับงาน** — "คอมมิตหน้าค่อยแก้" มาไม่ถึงจริงบ่อยกว่าที่คิด
2. **ข้ออ้างที่วัดได้ ต้องมีตัวเลขและวันที่กำกับ** ตัวเลขที่ไม่มีวันที่คือตัวเลขที่ไม่มีใครกล้าใช้
3. **หัวข้อที่ยาวเกิน ~15 บรรทัด เขียนเป็นไฟล์ใน `docs/` แล้วเหลือบรรทัดดัชนีไว้ที่นี่** — ไฟล์นี้ถูกโหลดเข้า
   context ทุกเทิร์นของทุก session ความยาวจึงเป็นต้นทุนที่ทุกงานจ่าย ไม่ใช่แค่งานที่เกี่ยวข้อง

---

## ระบบนี้คืออะไร

ระบบออกใบเสนอราคาของ Primus Co., Ltd. — **รันจริงใน production และเสถียร** ต้นทุนของ regression
สูงกว่าประโยชน์ของการปรับปรุงที่ไม่ได้ขอ ข้อมูลสินค้า/ลูกค้า/ใบสั่งขาย sync มาจาก **Odoo**

| ส่วน | เทคโนโลยี | หมายเหตุที่ผิดบ่อย |
| --- | --- | --- |
| Backend | Node.js + Express 5 + TypeScript (ESM, NodeNext) entry `index.ts` รันด้วย `tsx` | import ต้องลงท้าย `.js` แม้ไฟล์ต้นทางเป็น `.ts` |
| AI / LLM | DeepSeek ผ่าน OpenAI SDK — เรียกผ่าน `createChatCompletion()` ใน `config/clients.ts` เท่านั้น | ห้าม hardcode ชื่อโมเดล |
| Database | PostgreSQL ผ่าน `pg` — `pool` / `withTransaction` จาก `config/db.ts` เท่านั้น | ไม่มี ORM ไม่มี Supabase client |
| LINE | `@line/bot-sdk` — **`replyToken` เท่านั้น** | `grep pushMessage` = 0 จุด (วัด 2026-09-12) ตัวเลขนี้ต้องเป็น 0 ตลอดไป |
| PDF | Puppeteer ผ่าน `pdfGenerator.ts` (root) ที่เดียว | A4 · ฟอนต์ไทยต้องมีในกล่อง |
| Admin | Vite + React 19 + Tailwind 4 — build ลง `public/` ซึ่ง **commit เข้า repo** | ห้ามแก้ไฟล์ใน `public/` ตรง ๆ |
| LIFF | HTML + Vanilla JS ล้วน เสิร์ฟผ่าน Express | ห้าม React/Vite เด็ดขาด |
| ค้นหา | Fuse.js (default import) | |

ขนาดที่ควรรู้ก่อนเปิดไฟล์ (วัด 2026-09-16): `index.ts` **4,774 บรรทัด / 121 route** —
ใช้ `grep` หา route ที่ต้องการ อย่าอ่านทั้งไฟล์ · `handlers/lineHandler.ts` 101 KB ·
`services/quotationService.ts` 118 KB · `services/customerService.ts` 104 KB

---

## เส้นทางของหนึ่งข้อความ — และทำไมมันถึงต้องเร็ว

```
LINE webhook → line.middleware() (ต้องได้ raw body) → webhookQueue → handleEvent
     → quoteExtraction (LLM)  → productService/customerService (จับคู่)
     → services/rules/ + utils/pricing (ราคา)  → insertDraftQuotations (ร่าง)
     → Flex ตอบกลับด้วย replyToken  → [ยืนยัน] → confirmQuotationAtomic → เลขใบ → PDF
```

**นาฬิกาคือข้อจำกัดที่ออกแบบทุกอย่างในเส้นนี้** — `replyToken` อายุ 60 วินาทีนับจากรับ webhook
และใช้ได้ครั้งเดียว `services/webhookQueue.ts` จึงตั้ง `SAFETY_MARGIN_MS = 12_000` เผื่อ network
เหลือ **`BUDGET_MS = 48_000`** เป็นงบเวลาผลิตคำตอบ ทุกอย่างที่ช้ากว่านั้นต้องถูกตัดจบด้วยคำตอบสำรอง
ไม่ใช่ปล่อยให้ token หมดอายุเงียบ ๆ **"ack ก่อนแล้วตอบทีหลัง" ทำไม่ได้** เพราะการตอบทีหลังต้องใช้
push ซึ่งมีโควตารายเดือนและมีค่าใช้จ่าย ส่วน reply ฟรี — นี่คือเหตุผลเชิงเงิน ไม่ใช่เชิงสไตล์

**event ที่ `deliveryContext.isRedelivery === true` ต้องข้าม ไม่ใช่ประมวลผล** (ตั้งแต่ 2026-09-22) —
มันคือ **event เดิมที่เราตอบไปเรียบร้อยแล้ว** ส่งกลับมาอีกรอบ ไม่ใช่ข้อความที่ตกหล่น พิสูจน์
2026-09-22 (3/3 คู่): `webhookEventId` **และ** `replyToken` ตรงกับตัวเดิมทุกตัวอักษร · ตัวเดิม
มี `[queue] ... [replied=N]` ขึ้นแล้วก่อนหน้า ~60 วิ ⇒ **เซลส์ได้คำตอบไปแล้ว** สิ่งที่หายคือ
**200 ที่เราตอบกลับไปหา LINE** (ขาออก) ไม่ใช่ข้อความขาเข้า
⇒ การประมวลผลซ้ำมีแต่เสีย: เผา LLM + สล็อตคิวของคนที่ยังตอบทัน แล้วจบด้วย 400
`Invalid reply token` เพราะ **token ถูกใช้ไปแล้ว** (และหมดอายุด้วย — เร็วสุดที่วัดได้ยัง 62.7 วิ)
สองครั้งติดกัน เพราะ fallback ในตัว catch-all ใช้ token ตัวเดิม — นี่คือที่มาของ error
ที่ขึ้นเป็น "คู่" ในหน้าบันทึกระบบ
⚠️ อันตรายจริงคือ **งานซ้ำ ไม่ใช่ error**: เคยเจอ `action=confirm` ของใบที่ออกเลขไปแล้ว
ถูกส่งซ้ำมาให้ทำอีกรอบ (2026-09-21 ใบ `b00850ad…` / `QP-260905738`) รอบนั้นไม่เกิดใบซ้ำ
แต่เป็นเพราะโชคของลำดับ ไม่ใช่เพราะมีด่านกันไว้
· อัตราที่วัดได้ **8 จาก 128 webhook (6.3%) ใน 16 ชม.** — เป็นอาการของทางเข้า (Cloudflare
Tunnel) ที่ทำ response หาย ไม่ใช่ของโค้ด และ **ไม่ได้แปลว่ามีข้อความไหนไม่ได้รับคำตอบ**
**กลไกที่ทำให้ response หาย หาเจอแล้ว (2026-09-22)** — log ของ cloudflared ย้อนหลัง 20 วัน
(2026-09-02→2026-09-22) มี request ตก **133 ครั้ง แยกเป็นสองกลุ่มที่คนละสาเหตุ**:
**122 (92%)** = `Error shutting down control stream: context canceled` — Cloudflare edge ตัด
connection ทิ้งขณะ request ยังวิ่งอยู่ (`Lost connection with the edge` 106 ครั้ง ≈ 5 ครั้ง/วัน
ทีละ 4 connection ภายใน 2 วินาที) · **11 (8%)** = `connection refused` คือช่วงที่ app ไม่อยู่ตอน deploy
⇒ **เราตอบสำเร็จแล้วแต่คำตอบไปไม่ถึง LINE** · การมี connector หลายตัว **ไม่ได้แก้ 122 ครั้งนี้**
(request ที่วิ่งบน connection ที่กำลังตายยังไงก็ตาย) — ตัวที่แก้อาการคือด่านข้าม redelivery ข้างบน

**`express.json()` แบบ global คือสิ่งที่ห้ามเติมตลอดกาล** — `line.middleware()` ที่ `POST /callback`
ต้องได้ raw body ไปคำนวณ HMAC ของ `x-line-signature` ถ้ามีใคร parse ก่อน ลายเซ็นไม่ผ่าน =
**บอทหยุดตอบทั้งระบบ** ไม่ใช่พังเฉพาะ endpoint นั้น

**ใน `withTransaction()`** ห้ามเรียก `pool.query` (ต้องใช้ client ที่รับมา) · ห้าม `res.json()`
(return ค่าออกไปตอบหลัง COMMIT) · ห้ามยิง network ใด ๆ (LLM / LINE / puppeteer) เพราะ transaction
จะค้างคาไว้ตลอดเวลาที่รอปลายทาง และ `enrichQuotationData` ผูก pool ตรง ๆ จึง **เรียกใน transaction
ไม่ได้เลย** (self-deadlock) — enrich นอก tx เสมอ

## เส้นทางที่สอง: หน้าเว็บ "ขอใบเสนอราคา"

ตั้งแต่กลางปี 2026 วงจร "ร่าง → แก้ → ยืนยัน → PDF" มีทางเข้าสองทาง และนี่คือข้อจำกัดที่ทำให้มัน
ไม่แตกเป็นสองระบบ — แผนเต็มอยู่ใน `docs/plan-web-quote-request.md` ส่วนหัวไฟล์แต่ละตัวเขียนเหตุผล
ของตัวเองไว้แล้ว:

| เฟส | ไฟล์ | สิ่งที่มันรับผิดชอบ |
| --- | --- | --- |
| A | `services/chatChannel.ts` | ฉีด "ตัวตอบกลับ" เข้า `handleEvent` แทนการ import `lineClient` ตรง ๆ — ถอดไฟล์นี้ออกแล้วระบบเดิมกลับมาเหมือนเดิมเป๊ะ |
| B | `services/webIdentity.ts` | แถวพร็อกซี `user_id = web:<admin>:<sales>` เพราะ `quotations.user_id` มี FK ไป `salesperson` และแอดมินไม่ใช่ผู้ขาย |
| C | `services/quoteExtraction.ts` | "ข้อความดิบ → ร่างใบ" ที่ย้ายออกจากกลาง `handleEvent` |
| D | `services/webQuoteService.ts` | หลังบ้านของหน้าเว็บ — คืนข้อมูลดิบ ไม่ประกอบ Flex ไม่มี replyToken |

**กฎเดียวที่ค้ำทั้งสี่เฟส: ตรรกะธุรกิจ (ราคา · ส่วนลด · กฎบล็อก · blacklist · เครดิต) เรียกของเดิม
ห้ามก๊อปมาไว้ฝั่งเว็บ** ไม่งั้นวันหนึ่งใบที่ออกจากเว็บกับจาก LINE จะคิดเลขไม่ตรงกัน และจะไม่มีใคร
รู้ว่าฝั่งไหนถูก

**`prompt` ของ `quoteExtraction` เป็นส่วนหนึ่งของ input ที่โมเดลเห็น** — รวมช่องว่างและระดับการเยื้อง
ที่ติดมาจากตอนยังอยู่ใน `handleEvent` ห้ามจัดย่อหน้าใหม่ให้สวย ด่าน `npm run diag:line-parity`
เทียบกับ golden file ทีละตัวอักษร แก้ช่องว่างเมื่อไหร่ด่านล้มทันที

---

## คำสั่ง

```bash
npm run dev          # API (tsx watch)
npm run dev:web      # Admin SPA (Vite)
npm run dev:all      # API + admin + ngrok พร้อมกัน

npx tsc --noEmit                   # typecheck backend — ด่านหลัก ไม่มี unit test suite
npm --prefix frontend run lint     # eslint ของ admin
npm --prefix frontend run build    # typecheck + build admin (ผลลง public/)

npm run sync:products · sync:customers · sync:saleorders   # ดึงจาก Odoo
npm run db:dump · db:restore                               # ถ่ายฐานข้อมูลด้วยมือ (ต้องมี pg_dump บน host)
npm run backup:auto · backup:cron · diag:backup            # สำรองอัตโนมัติ (cron ตี 3 เก็บ 7 ชุด · รายงานอยู่ในแอดมิน) — runbook ใน DEPLOY.md
tsx scripts/runMigration.ts <path/to/file.sql>             # รัน migration "ทีละไฟล์" — ไม่มีโหมดไล่รันของที่ค้าง
npm run diag:migrations                                    # ไล่เทียบ migrations/changes/ กับฐานจริง (ต้องมีกล่อง docker)
npm run diag:data-directory                                # หน้าข้อมูลสินค้า/ลูกค้า (กฎ · ส่วนลด · ตัวกรอง)
npm run backfill:contacts · backfill:delivery-terms · backfill:print-snapshot
npm run logworker                                          # worker เขียน log แยกโปรเซส
```

`npm test` เป็น stub (`exit 1`) โดยตั้งใจ — **ด่านตรวจของโปรเจคนี้คือ typecheck + `scripts/diag/*`**
(วัด 2026-09-21: 65 รายการใน `scripts/diag/` · 46 npm script `diag:*`) ดูรายการเต็มใน `package.json`
และดูว่าตัวไหนเป็น gate ใน `AGENTS.md` ข้อ 6

---

## กับดักของข้อมูล — แต่ละข้อเคยทำให้มีคนสรุปผิดมาแล้ว

- **`sale_orders.company_id` ไม่ใช่รหัสลูกค้า** — เป็น "บริษัทผู้ขาย" ของ Odoo มีแค่ค่า `1` กับ `2`
  (PM / THT) จุดเชื่อมลูกค้าคือ **`contact_id` เท่านั้น** (+ `customer_tax_id` / `customer_reference`
  ตอนขยายนิติบุคคล) เผลอ join ด้วย `company_id` แล้วผลจะ **ดูถูกแต่ว่างเปล่า** — วัดจริง: join แบบนั้น
  ได้บริษัทที่มีออเดอร์ **1 ราย จากทั้งหมด 53,266 ราย**

- **`customers` ไม่ใช่รายชื่อลูกค้า** — `customers_data_view` (matview, 1 แถว = 1 ผู้ติดต่อ) คือ
  **source of truth เดียว** ตั้งแต่ 2026-07-23 ที่ `customers_view` / `contacts_view` ถูกปลดออกจาก DB
  เหตุผลคือ **contact 5,906 รายที่ออกใบสั่งขายจริงแต่ไม่มีแถวใน `customers`** — ค้นใน `customers`
  แล้วระบบจะรายงานลูกค้าเก่าว่าเป็นคนใหม่
  **และเพดานนี้แก้ในรีโปไม่ได้** (พิสูจน์ 2026-07-23): `TRUNCATE customers` + full sync จากปี 1970
  จบสมบูรณ์ 262 หน้า 7m13s ได้ **77,434 contact / 52,353 บริษัทพอดี** เพราะ gateway ตัด
  `active=false` ทิ้ง และ endpoint เป็น since/cursor ล้วน ไม่มี by-id ให้ขอทีละตัว (ลอง widen 8 แบบ
  ไม่รับ) ทางแก้จริงคือส่งต่อทีม gateway/Odoo
  **`payload.company_count` เป็นค่า per-page ไม่ใช่ยอดรวม** และ `payload.count` = `undefined` —
  ใช้เป็น completeness gate ไม่ได้

- **`customers_data_view` เป็น "ตารางจริง" ไม่ใช่ materialized view แล้ว** (ตั้งแต่ migration
  `2026-08-06_01_customers_data_fast_refresh.sql`) — **ห้ามสั่ง `REFRESH MATERIALIZED VIEW`
  กับมันอีก** วิธี refresh คือ **build + swap**: สร้างตารางใหม่ทั้งก้อนจาก view
  `customers_data_build` (~2.1s ไม่ล็อกใคร) แล้วสลับชื่อใน transaction เดียว (ถือ
  AccessExclusiveLock ระดับ ms) — ตรรกะทั้งหมดอยู่ที่ `scripts/sync/refreshCustomerDirectory.ts`
  ที่เดียว เรียกจากทั้ง CLI sync และ `services/syncService.ts`
  **ทำไมเลิกใช้ `REFRESH … CONCURRENTLY`:** วัดบน prod ได้ **10.0–11.5 วิ** ทั้งที่ query เองใช้
  ~3 วิ ส่วนต่างคือ Postgres ต้องสร้าง temp table 82k แถว + unique index บนมัน + FULL OUTER JOIN
  เทียบทั้งแถว 23 คอลัมน์ (เพิ่ม `work_mem` ไม่ช่วย)
  **ต้องใช้ `pg.Client` เฉพาะกิจ ไม่ใช่ pool** — pool ตั้ง `statement_timeout`/`query_timeout` = 15s
  และ build+swap ต้องไม่ไปอยู่ใน transaction ของคนอื่น · ฟังก์ชันนี้ **ห้าม throw** เพราะเป็น guard
  ท้าย sync · มัน **ข้ามรอบเองถ้าข้อมูลต้นทางไม่ขยับ** ⇒ migration ที่แก้แค่นิยาม view ต้องส่ง
  `{ force: true }` ไม่งั้นจะดูเหมือนรันแล้วแต่ไม่มีอะไรเปลี่ยน
  **ห้ามให้แอป query `customers_data_build` ตรง ๆ** (~2 วิ/ครั้ง) — แอปอ่าน `customers_data_view` เสมอ
  **ตั้งแต่ 2026-09-18 view มี Arm 3**: ผู้ติดต่อที่แอดมินเพิ่มเอง (`local_contacts`) ⇒ `source='local'`
  · `comp`/`own_last`/`own_credit`/`ent_keys` **ยังอ่าน `base` เหมือนเดิม ห้ามเปลี่ยนเป็น `all_rows`**
  ไม่งั้นผู้ติดต่อที่เพิ่งเพิ่มจะขยับค่าระดับบริษัทและคำตอบของด่านเครดิตได้ · แถวใหม่ต้องเขียนสองที่
  (`local_contacts` + `ensureDirectoryRow()` ลง `customers_data_view`) เพราะ rebuild กินเวลาถึง 10 นาที
  · ทีมขายของแถว local **สืบทอดจากบริษัทตอนอ่าน ไม่เก็บซ้ำ** และกติกาต้องตรงกันทั้งสองฝั่งเป๊ะ
  **ตั้งแต่ 2026-09-21 "เข้า Odoo แล้วหรือยัง" ระบบตอบเอง — ห้ามเพิ่มปุ่มให้คนติ๊ก** เพราะคนที่
  คีย์ชื่อผิดแล้วกดติ๊กว่าเสร็จจะทำให้ระบบเชื่อว่าพร้อม แล้วปล่อยใบเข้าไฟล์ปกติไปตกที่ Odoo
  โดยไม่มีใครรู้สาเหตุ · สองสัญญาณอยู่ที่ `reconcileLocalContactOdooLinks()` เรียกท้ายรอบ sync
  **หลัง** `refreshCustomerDataView()` และ `reconcileQuotationOdooLinks()` (A เทียบรายชื่อที่เพิ่ง
  rebuild · B อ่าน `odoo_imported_at` ที่ตัวหลังเพิ่งเขียน) · เกณฑ์ของ A ต้อง **เท่ากับ CTE
  `local_taken` ทุกตัวอักษร** ⇒ "มาร์กว่าเข้าแล้ว" กับ "หายจาก view" เป็นเรื่องเดียวกันเสมอ
  **สิทธิ์เป็นสองช่องที่ต้องไม่รวมกัน** (ตั้งแต่ก้อน I4 · 2026-09-21) —
  `quote.manage_contacts` = "ใครเพิ่มผู้ติดต่อได้ตอนออกใบ" คร่อมทั้ง router ที่จุด mount ·
  `page.odoocontacts` = "ใครเปิดหน้ารายการงานค้างได้" คร่อมเฉพาะ 3 เส้นของหน้านั้น
  (`/list` · `/export` · `/count`) **ที่ `index.ts` เหมือนกัน ไม่ใช่ในไฟล์ router**
  เพราะด่านข้อ 12 อ่านซอร์สของ `index.ts` มาเทียบ ไม่ได้อ่านไฟล์ router
  ⚠️ รวมสองช่องเป็นช่องเดียวเมื่อไหร่ วันที่เจ้าของปิดหน้ารายการให้ subadmin เขาจะเพิ่ม
  ผู้ติดต่อตอนออกใบไม่ได้ไปด้วยโดยไม่มีอะไรบอก · และ **ค่าตัวกรองตั้งต้นชื่อ `not_matched`
  ไม่ใช่ `pending`** (`pending` = เฉพาะคนที่ไม่มีชื่อใกล้เคียงใน Odoo) ⇒ ไฟล์ส่งออกต้องตกที่
  `not_matched` ไม่งั้นคนกลุ่ม "ชื่อไม่ตรง" หายจากไฟล์ทั้งที่เป็นกลุ่มที่ต้องรีบที่สุด
  · gate: `npm run diag:local-contacts` + `npm run diag:oc-ui` (เปิดหน้าจริงแล้วกดจริง)

- **`date AT TIME ZONE` ที่ไม่มี `::timestamp` เพี้ยนตาม TZ ของโปรเซส — และห้ามเดาว่าฝั่งไหนเป็น
  โซนอะไร** เพราะเคยสลับด้านกันมาแล้ว วัด 2026-09-15: **host (เครื่อง dev) = `Etc/UTC`** ส่วน
  **คอนเทนเนอร์ prod = `Asia/Bangkok`** (`TZ:` ของทั้ง app/db + postgres `-c timezone=` ใน
  `docker-compose.yml` ตั้งแต่ `49e5409` 2026-08-05) — คือ **กลับด้านกับที่เอกสารนี้เคยเขียนไว้**
  ว่า dev เป็นไทย/prod เป็น UTC ⇒ อย่าใช้ "ฝั่งไหนซ่อนบั๊ก" เป็นเหตุผลตัดสินใจ ให้ถือว่า
  **โผล่ได้ทั้งสองฝั่ง** · คอนเทนเนอร์ไม่ได้ mount `/etc/localtime` จาก host ⇒ เปลี่ยนโซนของ host
  ไม่กระทบ prod
  ต้องการ "วันไทย" ให้เรียกผ่าน `utils/thaiTime.ts` และเงื่อนไขวันที่ใน SQL มีที่เดียวคือ
  `createdAtFromThaiDayCondition` / `createdAtToThaiDayCondition` ใน `db/repositories.ts`
  ห้ามเขียน SQL ซ้ำในแต่ละ endpoint
  · gate: `npm run diag:date-filter` (เทียบ 3 โซนทั้งสองฝั่ง + assert `pg_typeof` + เรียก
  `allocateQuotationNo` จริงใต้ `TZ=UTC`) — ด่านนี้ **ตั้ง `process.env.TZ` เอง ไม่พึ่งโซนของเครื่อง**
  จึงเชื่อผลได้ไม่ว่ารันจากที่ไหน

- **ห้าม `.trim()` ชื่อลูกค้า/ผู้ติดต่อในทุกเส้นที่ส่งไป Odoo** — Odoo จับคู่ `res.partner` ด้วยการ
  เทียบชื่อ **ตรงตัวทุกอักขระ** และข้อมูลจริงมีช่องว่างหัว/ท้ายอยู่ **17,666 แถว** (`contact_name`)
  กับ **810 แถว** (`customer_name`) — `"คุณแนน "` ที่ถูก trim กลายเป็นคนละ partner แล้ว **ตกทั้งใบ**
  (8 แถวในไฟล์ export วันที่ 2026-08-03) ใช้ `cleanName()` ไม่ใช่ `clean()`
  **NBSP/ZWSP ในไฟล์ export เป็นของจริงจากต้นทาง ไม่ใช่บั๊ก** — 32 เซลล์ + 1 เซลล์ ตรงกับ master
  ทุกไบต์ ไล่ normalize ทิ้งแล้วจะไม่แมตช์แทน · gate: `npm run diag:odoo-export` (ถ้ารายงาน
  `(ตรวจ 0 ชื่อ)` แปลว่าด่านผ่านแบบว่างเปล่า อย่าเชื่อ)

- **snapshot ของรายการสินค้ามี whitelist สองชั้น ต้องเพิ่มให้ครบทั้งคู่** — ฝั่งเขียน
  `buildItemSnapshots()` และฝั่งอ่าน `legacyItems` ใน `enrichQuotationData()` (ทั้งคู่ใน
  `quotationService.ts`) เคสจริง 2026-07-24: `linked_to_product_id` มีที่ read แต่ลืมที่ write
  → snapshot เก็บไม่ครบ → อ่านกลับได้ `null` เสมอ → Flex ไม่แสดง badge สินค้าพ่วง **แต่หน้า LIFF
  แสดงปกติ** เพราะใช้ items สดที่ยังไม่ round-trip ⇒ อาการโผล่คนละที่กับสาเหตุ
  เกณฑ์ตัดสิน: field ที่ `buildItemSnapshots()` คำนวณใหม่ได้เอง **ไม่ต้องเพิ่ม** · field ที่เป็น
  ข้อเท็จจริงของบรรทัดนั้นและสร้างใหม่ไม่ได้ **ต้องเพิ่ม** ไม่งั้นหายถาวร

- **เดือนของเลขใบยึด `created_at` (วันที่ร่าง) ⇒ ห้ามเขียนทับ `created_at` ตอนยืนยัน** และ
  `getRecentConfirmedQuotations` ต้องใช้ `updated_at` — สองข้อนี้เป็นคู่กัน ผิดข้อใดข้อหนึ่ง
  แล้ว fallback ของ LIFF round-trip พังเงียบ ๆ · gate: `npm run diag:confirm-race`

- **`customer_details.payment_terms` ไม่ได้แปลว่า "เครดิตของลูกค้ารายนี้" เสมอไป** (ตั้งแต่
  2026-09-14) — หน้าเว็บขอใบเสนอราคาให้แอดมินเขียนทับเครดิต **เฉพาะใบนั้น** ได้ ⇒ ค่าในใบกับ
  `customers_data_view.customer_payment_terms` ต่างกันได้โดยไม่ใช่บั๊ก **ห้ามเอาคอลัมน์นี้ไปรวม
  เป็นยอดลูกหนี้หรือสรุปว่าลูกค้ารายไหนมีเครดิต** — ถามฐานลูกค้าเสมอ
  ตัวแยกคือ **`customer_details.payment_terms_override`**: `null` = ค่านี้มาจากลูกค้าจริง ·
  มีค่า = คนออกใบสั่งทับ (ใบจาก LINE เป็น `null` ทุกใบ)
  ⚠️ ธงนี้ไม่ใช่ของประดับ — **ทุกจุดที่บันทึกใบประกอบ `customer_details` ใหม่ทั้งก้อนจาก
  `customers_data_view`** (`insertDraftQuotations` และ `PUT /api/quotation/:id`) ใครเพิ่ม
  จุดบันทึกใหม่แล้วไม่หยิบธงนี้กลับมาใส่ เครดิตที่แอดมินตั้งจะหายเงียบ ๆ ตอนกดบันทึกครั้งถัดไป
  · เครดิตที่ทับ **มีผลกับกฎค่าบริการด้วย** (`hasCreditTerms`) แต่ **ไม่ปลดด่าน blacklist/credit
  hold** ซึ่งอ่านจากฐานลูกค้าไม่ใช่จากใบ · gate: `npm run diag:web-quote` ข้อ 7
  · ตั้งแต่ 2026-09-15 ธงนี้ยัง **ส่งใบเข้าคิว "ต้องแก้มือใน Odoo"** ด้วย (ข้อถัดไป)

- **สองคอลัมน์ jsonb ของใบที่หน้าตาคล้ายกันแต่คนละเรื่องคนละผล** (2026-09-15) — สลับกันเมื่อไหร่
  จะได้บั๊กที่ไม่มีอะไรฟ้องเลยจนกว่าจะมีของหลุดไปถึงลูกค้าหรือมีใบตกทั้งกอง
  | คอลัมน์ | แปลว่า | ผลกับไฟล์ export |
  | --- | --- | --- |
  | `quotations.rule_overrides` | ใบติดกฎ (สต็อก/MOQ/ราคาขั้นต่ำ/ระงับ/blacklist/เครดิตค้าง) แต่คนออกใบกดรับทราบแล้ว | **ไม่มีผลเลย** — ข้อมูลตรงฐาน Odoo ทุกช่อง นำเข้าได้ปกติ อยู่ในไฟล์ปกติเหมือนเดิม |
  | `quotations.odoo_manual_review` | ค่าในไฟล์ **ไม่มีอยู่ในฐาน Odoo** (เครดิตที่ตั้งทับ · วันหน้า: ผู้ติดต่อใหม่ · สินค้า custom) | **ถูกกันออกจากไฟล์ปกติ** ไปอยู่เมนู "ต้องแก้มือก่อน" |
  ⇒ **ห้ามเอา `rule_overrides` ไปกรองไฟล์ export** และห้ามนับสองคอลัมน์นี้รวมเป็นตัวเลขเดียว
  (ใบเดียวติดได้ทั้งคู่) · คิวแก้มือ = `odoo_manual_review IS NOT NULL AND odoo_exported_at IS NULL`
  ⇒ ไม่มีสถานะใหม่ให้ใครคอยกดปิด พอส่งออกชุดแยกแล้วใบออกจากคิวเอง
  **การปลดล็อกด่านตรวจผูกกับ "ใบ" ไม่ใช่ "endpoint"** เพราะ `PUT /api/quotation/:id` และ
  `/confirm` เป็นของที่ LIFF ใช้ร่วมกัน — ย้ายเงื่อนไขไปไว้ที่ endpoint เมื่อไหร่ **ใบจาก LINE
  จะทะลุกฎตามไปด้วยเงียบ ๆ** · ตรรกะทั้งหมดอยู่ที่ `blockingViolations()` / `violationKey()` /
  `buildOdooManualReview()` ใน `quotationService.ts` ที่เดียว · `SYSTEM_ERROR` ("ตรวจกฎไม่สำเร็จ")
  **ทะลุไม่ได้ทุกกรณี** เพราะมันแปลว่า *ยังไม่รู้ว่าผิดหรือไม่* ไม่ใช่ *ผิดข้อนี้*
  · gate: `npm run diag:web-quote` ข้อ 8

- **ช่อง Sales Team (คอลัมน์ I) ของไฟล์ Odoo อ่านจาก "ค่าที่ตรึงไว้ในใบ" ก่อน แล้วค่อยถอยไป join สด**
  (เฟส H · 2026-09-18) — `confirmQuotationAtomic` เขียน `quotations.customer_sales_team` ใน
  ทรานแซกชันเดียวกับการออกเลข และ export ใช้ `ODOO_EXPORT_SALES_TEAM_COL`
  (`COALESCE(q.customer_sales_team, cust.sales_team)`) ที่เดียวทั้ง endpoint และด่าน
  ⇒ **ใบที่ยืนยันแล้วจะไม่รับค่าทีมขายที่เปลี่ยนใน Odoo ทีหลังอีก** (ตั้งใจ — ตรงกับ snapshot
  ช่องอื่นของใบ) · `NULL` = ใบที่ยืนยันก่อนเฟส H ⇒ ถอยไป join สดเหมือนเดิมทุกไบต์ (พิสูจน์ด้วย
  md5 ของไฟล์ทั้งชุดก่อน–หลัง 1,931 ใบ) · **ห้ามลบท่อน `ODOO_EXPORT_SALES_TEAM_JOIN` ทิ้ง**
  มันคือทางถอยของใบเก่าทุกใบ · จำลองอาการบนเครื่อง dev ได้ด้วย `scripts/dev/seedPhaseH.ts`
  (ผู้ติดต่อหายจาก `customers_data_view` แล้วช่อง I ว่าง) · gate: `diag:confirm-race` +
  `diag:odoo-export` ก่อนและหลัง

- **ราคาต่ำกว่าขั้นต่ำจากหน้าเว็บ ติ๊กรับทราบเองไม่ได้แล้ว ต้องมีคนอนุมัติ** (2026-09-15) —
  กฎมีสามชั้นแทนสอง: ติ๊กเองได้ (ของหมด/MOQ/ระงับ/blacklist/เครดิตค้าง) · **ต้องอนุมัติ**
  (`MIN_PRICE_VIOLATION`) · ทะลุไม่ได้ (`SYSTEM_ERROR`) — ทั้งสามอยู่ที่ `blockingViolations()`
  ที่เดียวเหมือนเดิม ตัวปลดชั้นกลางคือคอลัมน์ **`quotations.price_approval`** (ใบจาก LINE เป็น
  `NULL` ⇒ **ถูกบล็อกเหมือนเดิมทุกประการ ไม่ได้เข้าคิว**)
  **คำอนุมัติผูกกับ "ราคาที่อนุมัติ" ไม่ใช่แค่ชื่อรุ่น** — `violationKey()` เป็น `type|model` ที่ไม่มี
  ตัวเลข ถ้าใช้คีย์นั้นปลดตรง ๆ คนที่อนุมัติ ฿100 จะกลายเป็นอนุมัติ ฿10 ให้ด้วย ⇒
  `approvedViolationKeys()` เทียบราคาปัจจุบันกับที่อนุมัติทุกครั้ง (ถูกลงกว่าเดิม = ต้องขอใหม่)
  ⚠️ ร่างที่รออนุมัติ **ค้างอยู่ใน DB จริง** ต่างจากร่างปกติของหน้าเว็บที่อยู่ไม่ถึงสองวินาที ⇒
  การกวาดร่างเก่าทิ้งมีที่เดียวคือ `insertDraftQuotations` (ใน transaction เดียวกับ INSERT) และ
  ต้องมี `AND price_approval IS NULL` เสมอ ไม่งั้นคำขอที่รออยู่หายทั้งใบเงียบ ๆ · และ "กลุ่มใบ" ของค่าขนส่ง
  อัตโนมัติไม่ใช่ "ร่างทั้งหมดของ user" อีกแล้ว — `applyShippingFeeToQuoteGroup()` รับ `requestId`
  มาเป็นขอบเขต ไม่งั้นยอดของชุดที่รออนุมัติกับชุดที่กำลังทำจะถูกบวกกัน
  · ออกใบหลังอนุมัติใช้ `services/quotationConfirm.ts` ตัวเดียวกับปุ่มยืนยันปกติ
  · gate: `npm run diag:price-approval`

- **สถานะ `cancelled` แปลว่า "มีคนกดยกเลิก" เสมอ — ของที่ถูกแทนที่ให้ทิ้งทั้งแถว** (เจ้าของสั่ง
  2026-09-21) ร่างที่ยังไม่มี `quotation_no` **ห้ามมาร์ก `cancelled` เพื่อบอกว่ามันเลิกใช้แล้ว**
  ให้ `DELETE` ไป ซึ่งตรงกับกติกาที่ปุ่มยกเลิกสองเส้นใช้อยู่แล้ว (`POST /api/quotation/:id/cancel`
  · ปุ่มยกเลิกใน LINE): **ไม่มีเลขที่ = ลบ · มีเลขที่ = มาร์ก**
  เคยผิดพร้อมกัน 4 จุด (แก้ 2026-09-21): ทั้งสามเส้นของ "แก้ใบ" (`reviseQuotation` ·
  `lineHandler` · `quotationAgent`) มี `UPDATE … 'cancelled'` ยืนอยู่ก่อนเรียก
  `insertDraftQuotations` **ซึ่งกวาดร่างเก่าด้วย `DELETE` ให้อยู่แล้วด้วยขอบเขตเดียวกันเป๊ะ**
  ⇒ การมาร์กก่อนทำให้ตัวกวาดหาแถวไม่เจอ (ไม่ใช่ `draft` แล้ว) เหลือแถวผีทุกครั้งที่มีคนกดแก้ใบ
  และเสียทางถอยด้วย (DELETE ใน transaction rollback คืนได้ ส่วนของที่มาร์กไปแล้วคืนไม่ได้) ·
  จุดที่สี่คือ "แก้แล้วส่งใหม่" ของคิวอนุมัติราคา — ดู `docs/plan-quote-price-approval.md` §3.5.1
  **ข้อยกเว้นข้อเดียวคือ `cancelRequest()`** (คนกดยกเลิกคำขอของตัวเอง) ซึ่งต้องเหลือแถวไว้เป็น
  หลักฐาน · gate: `npm run diag:price-approval` ข้อ 12 คู่กับข้อ 7/13
  **ตั้งแต่ 2026-09-18 "ข้อไหนอยู่ชั้นไหน" ขึ้นกับ role ของคนออกใบ ไม่ใช่ค่าคงที่ของทั้งระบบ** —
  `blockingViolations()` รับพารามิเตอร์ที่ 4 เป็นแมป `ชนิดกฎ → deny|approval|allow` ที่ผู้เรียก
  ถามมาจาก `ruleModesOf(role)` (`config/capabilities.ts`) · **ไม่ส่งมา = กติกาเดิมเป๊ะ** ซึ่งคือ
  ทุกเส้นของ LINE/LIFF ⇒ ใบจาก LINE ไม่ขยับ · `quotationService.ts` **ห้าม import
  `config/capabilities.ts` แบบ runtime** (type-only เท่านั้น) ไม่งั้นด่านตรวจกฎจะเริ่มตอบต่างกัน
  ตามผู้เรียก · คำอนุมัติผูกกับ **ตัวเลขของกฎข้อนั้น** และทิศทางไม่เหมือนกัน: ราคา = ต่ำลง ·
  ของหมด = จำนวนมากขึ้น · MOQ = จำนวน**น้อยลง** (`approvedViolationKeys`)
  **ทุก route `/api/admin/*` ต้องมีด่าน และด่านของ "หน้าจอ" คือ `requireCapability('page.*')`**
  (ตั้งแต่ 2026-09-18) — ด่านข้อ 12 อ่านซอร์ส `index.ts` มาเทียบ *ทั้งเซ็ต* ⇒ เพิ่ม route ใหม่แล้ว
  ไม่ใส่ด่าน หรือใส่ `requireRole` ในหน้าที่มีช่องอยู่แล้ว **ด่านล้มทันที** (ที่ยังเป็น `requireRole`
  ล้วนได้โดยชอบมี 5 เส้น เหตุผลอยู่ในตัวด่านเอง) · **เพิ่มเมนูใหม่ = เพิ่มช่อง + ด่านที่ route เสมอ**
  ไม่งั้นเปิดเมนูให้ใครแล้วเขาจะเห็นหน้าที่ยิง API ไม่ผ่านสักเส้น ซึ่งแย่กว่าไม่เห็นเมนูเลย
  · gate เพิ่ม: `npm run diag:role-permissions` · แผน: `docs/plan-role-permissions.md` §12.1–12.2

- **กฎระงับสต็อกเทียบ `unreserved` กับ "จำนวนที่สั่ง" ไม่ใช่ `actual_quantity <= 0`** และ
  **สินค้าที่ไม่มีแถวใน `product_stock_rules` ต้องเพิ่ม/ปรับจำนวนได้เสมอแม้ของว่าง** —
  client (`product-search.html` / `quote-edit.html`) **ห้ามบล็อกจากสต็อกดิบเด็ดขาด** เพราะ client
  ไม่รู้ว่าสินค้าไหนติดกฎ (เคยพลาดแล้วถอดออกใน `e141cea`) สต็อกบนหน้า LIFF เป็น **badge เตือน
  เท่านั้น** server เป็นด่านจริง · `PUT /api/quotation/:id` ต้องตรวจ **ทุกบรรทัด** ไม่ใช่แค่รายการ
  ที่เพิ่งเพิ่ม (เหมือนที่ min-price ทำอยู่แล้ว) · gate: `diag:stock-rule` + `diag:stock-rule-put`
  + `diag:quote-validation`

- **การจับคู่ลูกค้าแตะแล้วต้องวัด และมีสองชุดที่ตอบคนละคำถาม**
  - `npm run diag:customer-search` (`scripts/diag/customerSearchEval.ts`) — ถามว่า
    **"แก้แล้วลูกค้าที่ระบบเลือกให้ ยังเป็นคนเดิมไหม"** เทียบกับ
    `data/eval/customer_search_baseline.json` · `-- --save` บันทึก baseline ใหม่
    (ทำตอนของยังดีอยู่เท่านั้น) · `-- --refresh-corpus` ดูดคำค้นชุดใหม่ ซึ่ง **ทำให้ผลก่อน/หลัง
    เทียบกันไม่ได้** · มันสร้างสำเนาทดสอบจาก `customerService.ts` ตอนรันแล้วลบทิ้ง จึงไม่มี
    สำเนาโค้ดแช่แข็งให้ทดสอบผิดตัว และจำคำตอบ LLM ไว้ในดิสก์ตาม prompt
  - `tsx scripts/evalCustomerSearch.ts` — ชุดข้อสอบ 56 เคสที่มีเฉลย
    (`--ai` = pipeline เต็ม · ไม่ใส่ = deterministic เร็ว/ฟรี)
    baseline 2026-09-14: AI off 52/56 top-1 · **AI on 54/56** (โหมดที่ production ใช้จริง) ·
    **`wrong-auto-select` ต้องเป็น 0 ตลอด** เพราะมันแปลว่าบอทเลือกบริษัทผิดให้เงียบ ๆ
    **`--mine` ทำให้ผลเทียบกันไม่ได้** เพราะ re-mine ชุดเคสใหม่ทั้งชุด — จะเพิ่มเคสให้เติมทั้ง
    `PINNED_CASES` และไฟล์ JSON ตรง ๆ
    ⚠️ **`wrong-auto-select > 0` อาจแปลว่า "เฉลยผิด" ไม่ใช่ "โค้ดผิด"** — เกิดมาแล้วกับ
    `pin-4-person-phone` (2026-09-14): เฉลยขัดกับรหัสลูกค้าที่เซลส์พิมพ์มาเองในข้อความต้นทาง
    เกือบพาไปแก้ `stripPhoneNumbers` ทั้งที่เบอร์ในเคสนั้นไม่มีอยู่ในฐานเลยสักแถว ·
    ก่อนแก้โค้ด ให้ย้อนไปดูข้อความต้นทางใน `messages` + ออเดอร์จริงใน `sale_orders` ก่อนเสมอ
    (ที่มา: `docs/plan-web-quote-request.md` §L.5)
  - `npm run diag:web-decision` — ถามว่า **"ระบบต้องให้คนเลือกเอง หรือชี้ขาดเองได้"** ซึ่งเป็น
    *คนละชั้น* กับสองตัวบน (ทั้งคู่วัด `findCustomerCandidates` ที่ LINE กับเว็บใช้ร่วมกัน จึงมองไม่เห็น
    ความต่างของชั้นตัดสินใจ — เคยทำให้สรุปผิดว่า "เว็บกับ LINE ไม่ต่างกัน" มาแล้ว 2026-09-14)
    · **กฎ auto-select มีสองสำเนาโดยตั้งใจ** (`quotationService.ts` ของ LINE **ห้ามแตะ** ·
    `decideCustomerSelection()` ของเว็บ) ด่านนี้อ่านซอร์สมาเทียบให้ว่ายังตรงกัน · ที่มาอยู่ที่
    `docs/plan-web-quote-request.md` §L
  สองเคสที่ยังพลาดอยู่แก้ด้วยตรรกะไม่ได้ (หลักฐานเท่ากันทุกไบต์เพราะสาขาพี่น้องใช้รายชื่อผู้ติดต่อ
  ร่วมกัน) — พฤติกรรมที่ปลอดภัยคือไม่ auto-select ซึ่งเป็นสิ่งที่เกิดขึ้นอยู่แล้ว อย่าเสียเวลาไล่

- **ประวัติส่วนลดกับด่านเครดิตใช้ขอบเขต "บริษัท" คนละแบบ โดยตั้งใจ** (2026-09-17) —
  ส่วนลดในหน้า "ข้อมูลลูกค้า" นับ **เฉพาะ `company_id` เดียว** (= รหัสลูกค้าเดียว) ส่วน
  `last_order_at` ของด่านเครดิต **ขยายเป็นนิติบุคคล** (เลขภาษี/รหัสอ้างอิง/ชื่อ ตรงข้อใดข้อหนึ่ง)
  เหตุผลของเจ้าของ: *"รหัสลูกค้าไม่เหมือนกัน"* — คนละรหัสคือคนละข้อตกลงราคา สาขาที่เจรจาแยกกัน
  ได้ส่วนลดคนละอัตราจริง เอามารวมจะโชว์ตัวเลขที่ไม่มีใบไหนเคยใช้
  ⇒ **เห็นสองที่ไม่ตรงกันแล้วห้าม "แก้ให้เหมือนกัน" ต้องถามเจ้าของก่อน**
  · ตรรกะอยู่ที่ `getCompanyDiscountHistory()` ใน `db/dataDirectoryRepo.ts` ที่เดียว
  · gate: `npm run diag:data-directory` มีข้อที่พิสูจน์ว่าสองรหัสที่เลขภาษีเดียวกันไม่เห็นใบของกัน

- **`sale_orders` เป็น 1 แถว = 1 ใบ ไม่ใช่ระดับบรรทัด** ถึงจะมีคอลัมน์ `model` / `quantity` อยู่ก็ตาม
  (วัด 2026-09-17: 320,090 แถว / 320,090 `order_reference`) ⇒ ใช้ `total_discount` เป็นส่วนลดทั้งบิล
  ได้เลย ไม่ต้อง `GROUP BY` ก่อน · **ห้ามคำนวณส่วนลดใหม่จาก `total_amount − amount_after_discount`**
  เพราะมี **2,362 ใบ (0.7%)** ที่สามช่องนั้นไม่ลงตัวกันเองจากต้นทาง
  · ดึง 3 ใบล่าสุดต่อบริษัทเร็ว **1 ms** ถ้าเขียนให้ตรงกับ `idx_so_contact_latest` (กรอง `contact_id`
  ก่อนแล้วค่อย `ORDER BY order_date DESC NULLS LAST LIMIT n`) — เขียนเป็น CTE `DISTINCT ON`
  คร่อมทั้งตารางก่อนกรอง = **timeout เกิน 15 วินาที**

- **กฎบล็อกสินค้าบล็อกด้วย "แหล่งผลิต" เป็นหลัก ⇒ 77% ของแค็ตตาล็อกเสนอราคาผ่านระบบไม่ได้**
  (วัด 2026-09-17) — `product_block_rules` มี 9 แถว แต่ 4 แถวบล็อกทั้ง `production` ⇒
  **39,987 จาก 51,665 รายการถูกบล็อก** เหลือเสนอได้จริง **11,678** (`Production 2(PM)` 35,326 ·
  `Buy to Sell` 4,638 · `Buy to Sell(THT)` 6 · `Production 3(PM)`+ซีรีส์ ECM 12)
  ⇒ จอไหนที่แสดงรายการสินค้า **ต้องมีคอลัมน์ `production`** เพราะมันคือตัวทำนายว่าขายผ่านบอทได้ไหม
  · `quotation_rules.is_locked` **ถูกลบไปแล้ว** — `product_block_rules` เป็นตัวจริงตัวเดียว

- **ยอดท้ายใบบนกระดาษไม่ได้บวกลบกันอย่างที่ตาเห็น** (2026-09-17) — ใบ PDF พิมพ์
  **`รวมเงิน` = ยอดหลังหักส่วนลดแล้ว** และ **`ส่วนลด` = `0.00` เสมอ** (ส่วนลดจริงอ่านจาก
  คอลัมน์ `DISCOUNT` ของแต่ละแถว) ⇒ `รวมเงิน − ส่วนลด ≠ มูลค่าหลังหักส่วนลด` **เป็นพฤติกรรม
  เดิมของเอกสาร ไม่ใช่บั๊ก** และเจ้าของสั่งให้จอทำตามใบ · สูตรทั้งชุดอยู่ที่
  `quotationDocumentTotals()` ใน `utils/pricing.ts` **ที่เดียว** ซึ่ง `pdfGenerator` กับพรีวิว
  ของหน้าเว็บเรียกตัวเดียวกัน — ใครบวกเองบนจอเมื่อไหร่ เลขบนจอกับในไฟล์จะเริ่มไม่ตรงกัน
  · ส่วนลดที่หักไปแล้วจริงมีชื่อของมันเอง (`discount_line` → `totals.discount_total` ในผลตรวจ)
  ใช้ได้เฉพาะ **แถบสรุปของแอดมิน** ท้ายจอ **ห้ามเอาไปลงช่อง "ส่วนลด" ของใบ** · และเพราะแต่ละช่อง
  ปัดทศนิยมของตัวเอง ผลบวกคลาดได้ 1 สตางค์ (212.83 + 2.18 = 215.01 จากราคาตั้ง 215) ⇒ ห้ามแก้
  ด้วยการเลิกปัด
  · หัวกระดาษ (ชื่อ/ที่อยู่/เลขผู้เสียภาษีของ PM·THT) ก็ที่เดียวเหมือนกัน: `utils/companyProfile.ts`
  · gate: `npm run diag:web-quote` ข้อ 9

- **`customers_data_view.last_order_at` เป็นชื่อคอลัมน์ที่หลอก** — ไม่ใช่ "วันสั่งซื้อล่าสุด"
  แต่เป็นวันล่าสุดของใบที่ **ออกบิลแล้ว/รอออกบิล** ของนิติบุคคลที่บริษัทนั้นสังกัด และ
  **เฉพาะลูกค้าเครดิต/เช็คล่วงหน้าเท่านั้น** · `NULL` = ไม่เข้าข่ายตรวจ ซึ่งมาได้จาก 3 สาเหตุ
  (ไม่ใช่ลูกค้าเครดิต / เป็นเครดิตแต่ไม่มีใบเลย = ลูกค้าใหม่ / มีใบแต่ยังไม่เคยออกบิล) ทั้งสาม
  ปฏิบัติเหมือนกันคือ **ผ่าน**
  ⇒ **ห้ามเอาคอลัมน์นี้ไปแสดงเป็น "ซื้อครั้งสุดท้ายเมื่อไหร่" ที่อื่น** ลูกค้า Cash ทุกรายจะได้
  `NULL` ทั้งที่ซื้อเป็นประจำ · ขอบเขตการตรวจฝังอยู่ที่ **นิยาม view ที่เดียว** จะเปลี่ยนว่าใครอยู่
  ในขอบเขต ให้แก้ view อย่าเติมเงื่อนไขใน query ของ `creditHoldService.ts`
  · ด่านกฎเป็น **fail-closed**: DB ล่มต้องกลายเป็น "ตรวจไม่สำเร็จ ห้ามออกใบ" ไม่ใช่ "ไม่โดนบล็อก"

- **`district`/`ตำบล` ยังไม่ครบ ~26,730 แถว** ที่มี zip แต่ไม่มีอำเภอ (distinct zip 1,009) —
  อำเภอเติมจาก zip ได้ถ้า import postal table ส่วน **ตำบลเติมจาก zip ไม่ได้** (1 zip หลายตำบล)

---

## ค่าอะไรอยู่ที่ไหน — และทำไมถึงอยู่ตรงนั้น

- **`.env` = สวิตช์ของ deployment** ไม่ใช่ของร้าน — มันอยู่นอก git ดังนั้นไม่มี checkout ไหนได้มัน
  มาจากการ pull **`APP_URL` ไม่มีค่าสำรองโดยตั้งใจ** (`config/appUrl.ts`) ไม่ตั้ง = ตายตั้งแต่ boot
  เพราะทางสำรองแบบ "เดาจาก Host header" เคยทำให้ลิงก์ที่ส่งหาลูกค้าชี้ผิดเครื่องโดยไม่มีใครรู้
  · ห้ามอ่าน `process.env.APP_URL` ตรง ๆ และห้ามใส่ `|| '...'` ที่จุดเรียก
  · ตรวจด้วย `npm run diag:app-url` · บนเครื่อง dev ใช้ `APP_URL=http://localhost:3011`
  (ยอม http เฉพาะ localhost/127.0.0.1)

- **ค่าที่ร้านเปลี่ยนเองอยู่ใน DB และมีหน้าจอให้แก้** — โปรโมชัน กฎราคา MOQ กฎสต็อก กฎบล็อก
  ค่าขนส่ง เกณฑ์เครดิต บัญชีห้ามเสนอราคา ล้วนอยู่ในตารางและแก้ผ่าน Admin Portal
  **ค่าที่เปลี่ยนบ่อยแล้วไปฝังเป็นค่าคงที่ในโค้ดคือค่าที่ร้านแก้เองไม่ได้** — นั่นคือเหตุผลที่
  หลักการข้อ 2 ใน `AGENTS.md` บังคับให้มันลง DB/config

- **LIFF ID ไม่ hardcode** — ดึงจาก `/api/liff/config?page=` เสมอ (ทั้งสามหน้า) เพราะ LIFF ID
  ผูกกับ channel และเปลี่ยนตอนย้าย environment

- **ชื่อโมเดล LLM ไม่ hardcode** — `createChatCompletion()` ตั้ง `thinking: disabled` +
  `temperature: 0` มาให้แล้ว (เร็วกว่าและผลคงที่) จะ override เฉพาะจุดก็ส่ง param เข้ามา

- **ห้าม `COMMENT ON` (COLUMN/TABLE/VIEW/INDEX)** ใน migration หรือยิงเข้า DB เว้นแต่ผู้ใช้สั่งเอง —
  อธิบายด้วย `--` ในไฟล์ migration แทน

- **migration ใหม่ต้องยุบเข้า `migrations/schema.sql` ด้วย** (55 ไฟล์ใน `migrations/changes/`
  ณ 2026-09-18) ไม่งั้น schema เต็มจะค่อย ๆ ล้าสมัยจนตั้ง DB ใหม่จากศูนย์ไม่ได้ — วิธีตรวจอยู่หัวไฟล์
  **และ "อยู่ใน repo" ไม่ได้แปลว่า "ลงฐาน prod แล้ว"** — `npm run diag:migrations` คือตัวที่ตอบ
  คำถามหลัง (เกิดจริง 2026-09-15: คอลัมน์ของ `admin_users` ค้างไม่ได้รันมา 6 วัน หน้าเว็บขอ
  ใบเสนอราคาจึงขึ้น "โหลดข้อมูลผู้เสนอราคาไม่สำเร็จ" ทั้งที่โค้ดกับไฟล์ migration ขึ้น server ครบแล้ว)

- **รัน migration คนละวิธีกันระหว่าง dev กับ server — และไม่มีโหมด "ไล่รันของที่ค้าง" สักที่**
  (วัด 2026-09-18) `scripts/runMigration.ts` รับ **ไฟล์เดียวต่อครั้ง** ไม่มีตารางจำว่าไฟล์ไหนรันไปแล้ว
  | ที่ไหน | ฐานอยู่ไหน | รันยังไง | ตรวจว่าค้างไหม |
  | --- | --- | --- | --- |
  | dev (เครื่องนี้) | Postgres 18 ลงบน Windows ตรง ๆ **ไม่มี docker** | `npx tsx scripts/runMigration.ts migrations/changes/<ไฟล์>.sql` | `diag:migrations` **ใช้ไม่ได้** (มันเรียก `docker compose exec db`) → ถามฐานตรง ๆ ว่า object มีหรือยัง |
  | server | กล่อง docker `db` | `docker compose exec -T db psql … -f - < <ไฟล์>` (ขั้น 4 ของ `DEPLOY.md`) | `npm run diag:migrations` บน host |
  บน dev ไฟล์ที่นานกว่า 15 วิ (สร้าง `customers_data_view` ใหม่) ต้องใช้ psql ตรง ๆ แทน
  เพราะ pool ใน `config/db.ts` ตั้ง `statement_timeout` = 15s — psql อยู่ที่
  `C:\Program Files\PostgreSQL\18\bin\` ซึ่ง **ไม่ได้อยู่ใน PATH** (วัด 2026-09-18: psql 18.4 · server 18.4)

---

## โครงสร้าง — layer `route → handler → service → repository`

```
chatbot/
├── index.ts              # Express entry + route ทั้งหมด (4,774 บรรทัด · 121 route — ใช้ grep)
├── pdfGenerator.ts       # PDF logic ที่เดียวในระบบ
├── config/               # db · clients (LINE+LLM) · auth · jwt · apiLogger · loginRateLimit
│                         # · syncApiAuth · appUrl (ไม่มีค่าสำรอง ตั้งใจ)
├── handlers/lineHandler.ts   # รับ event LINE, คุม flow การสนทนา
├── services/             # business logic — ดูตารางแผนที่งานข้างล่าง
│   └── rules/            # rule engine โปรโมชัน/เงื่อนไข (index · quotationRules · scopeMatch · cache · types)
├── db/
│   ├── repositories.ts   # data-access layer — ทุก SQL ของระบบอยู่ที่นี่
│   ├── logRepositories.ts
│   └── companyIdentity.ts# กติกาการระบุตัวตนบริษัท/ผู้ติดต่อ (ใช้ร่วมหลายที่)
├── utils/                # pricing · promotionValidator · flexTemplates · address
│                         # · deliveryTerms · quotationLink · thaiTime · warranty
├── liff_pages/           # product-search · quote-edit · register (.html) — HTML + Vanilla JS ล้วน
├── migrations/
│   ├── schema.sql        # schema เต็ม (ตั้ง DB ใหม่จากศูนย์ได้จริง — วิธีตรวจอยู่หัวไฟล์)
│   └── changes/          # migration ทีละไฟล์ `YYYY-MM-DD_NN_*.sql`
├── scripts/              # sync/ · diag/ · dev/ (seed ทดสอบ — เครื่อง dev เท่านั้น) · logworker/
│                         # · pricebook/ (Excel ราคา → pricebook/book.json + แม่แบบ .xlsx + map รายชีต)
│                         # · runMigration · dbDump/dbRestore · backfill* · evalCustomerSearch
├── data/sale_sigs/       # ลายเซ็น — ชื่อไฟล์ต้องเป็น {salesperson_id}.png
├── frontend/             # Admin SPA (มี package.json/tsconfig/eslint ของตัวเอง)
└── public/               # build output ของ admin — commit เข้า repo · ห้ามแก้ตรง ๆ
```

**กฎ layer:** route/handler ไม่ยิง SQL เอง → เรียก service · service ดึงข้อมูลผ่าน
`db/repositories.ts` · ตรรกะราคา/สิทธิ์อยู่ใน `utils/` + `services/rules/` ไม่ใช่ใน handler
**ของใหม่ไปไว้ไหน:** SQL → `db/repositories.ts` · business logic → `services/` ·
ตัวช่วยไม่มี state → `utils/` · เงื่อนไขโปรโมชัน → `services/rules/` · ตาราง/คอลัมน์ → migration ใหม่

### แผนที่งาน → เริ่มอ่านที่ไหน

| งานเกี่ยวกับ | เริ่มที่ |
| --- | --- |
| flow การคุยใน LINE | `handlers/lineHandler.ts` |
| ความเร็ว / คิว / ตอบไม่ทัน | `services/webhookQueue.ts` · `index.ts` (`POST /callback`) |
| สกัดคำสั่งซื้อด้วย AI | `services/quoteExtraction.ts` · `config/clients.ts` |
| สร้าง/ยืนยัน/แก้ใบเสนอราคา | `services/quotationService.ts` · `services/quotationAgent.ts` (แก้ใบเดิม) |
| หน้าเว็บ "ขอใบเสนอราคา" | `services/webQuoteService.ts` · `webIdentity.ts` · `chatChannel.ts` · `salespersonPicker.ts` |
| เพิ่มผู้ติดต่อใหม่เอง (`local_contacts`) | `routes/localContacts.ts` · `services/localContacts.ts` · `db/localContactsRepo.ts` |
| ค้นหา/จับคู่สินค้า/ลูกค้า | `services/productService.ts` · `services/customerService.ts` |
| ราคา / โปรโมชัน | `utils/pricing.ts` · `utils/promotionValidator.ts` · `services/rules/` |
| ห้ามเสนอราคา / เครดิตลูกค้า | `services/blacklistService.ts` · `services/creditHoldService.ts` |
| SQL / ตาราง | `db/repositories.ts` · `migrations/schema.sql` |
| route / API / auth | `index.ts` · `config/auth.ts` · `config/syncApiAuth.ts` |
| Flex message / PDF | `utils/flexTemplates.ts` · `pdfGenerator.ts` |
| log และรายงาน | `config/apiLogger.ts` · `services/apiLogService.ts` · `db/logRepositories.ts` · `routes/logs.ts` · `scripts/logworker/` |
| ส่งออก/นำเข้า Odoo | `services/odooSaleOrderExport.ts` · `services/quotationOdooLink.ts` · `services/syncService.ts` |
| ให้ระบบภายนอกดึงข้อมูล | `services/externalSync.ts` · `docs/SYNC_API.md` |
| หน้า "ข้อมูลสินค้า" / "ข้อมูลลูกค้า" (อ่านอย่างเดียว) | `routes/dataDirectory.ts` · `services/dataDirectoryService.ts` · `db/dataDirectoryRepo.ts` · `frontend/src/admin/{Products,Customers}Directory.tsx` |

**หัวไฟล์คือเอกสารจริงของไฟล์นั้น** — `chatChannel.ts` `webIdentity.ts` `quoteExtraction.ts`
`webQuoteService.ts` `salespersonPicker.ts` `externalSync.ts` `quotationOdooLink.ts`
`frontend/src/admin/navHash.ts` ล้วนเขียน "ทำไมถึงเป็นแบบนี้ / ทางที่ไม่ได้เลือก" ไว้ในหัวไฟล์แล้ว
อ่านก่อนแก้ และเขียนต่อในรูปแบบเดียวกันเมื่อสร้างไฟล์ใหม่

---

## ดัชนีเอกสาร

หัวข้อที่ยาวอยู่ในไฟล์ของตัวเอง เปิดอ่านเฉพาะไฟล์ที่เกี่ยวกับงานตรงหน้า

- **`AGENTS.md`** — กฎ git · หลาย session ในทรีเดียว · ขอบเขตการอนุมัติ · ด่าน verify
- **`docs/design.md`** — กติกาหน้าตาของสี่พื้นผิว (Admin · LIFF · Flex · PDF)
- **`docs/agent-team.md`** — ทีม agent 7 ตัวใน `.claude/agents/` · เกณฑ์ `effort`/`isolation` · loop ของงาน
- **`DEPLOY.md`** — Docker, LINE webhook, กฎ LIFF ต้องอยู่ provider เดียวกับ Messaging API channel,
  กู้รหัสผ่านแอดมิน, พ.ร.บ.คอมพิวเตอร์ ม.26, แก้ปัญหาเบื้องต้น
- **`README.md`** — โครงสร้างละเอียด: endpoint ทั้งหมด, schema, business logic รายบริการ
- **`docs/SYNC_API.md`** — API ให้ระบบภายนอกดึงข้อมูล (3 โหมด sync และเกณฑ์เลือก)
- **`docs/plan-web-quote-request.md`** — หน้าเว็บขอใบเสนอราคา เฟส A–D (แผนยาว อ่านเฉพาะหัวข้อที่ตรงงาน)
- **`docs/plan-local-contacts.md`** — เพิ่มผู้ติดต่อใหม่ (`local_contacts` + Arm 3) เฟส I · แบบของโมดูล
- **`docs/plan-local-products.md`** — เพิ่มสินค้าใหม่ (`local_products`) เฟส J · **รูปแบบ `internal_reference` ถอดจากข้อมูลจริง + อัลกอริทึมออกรหัสต่อจากรหัสเดิม** · ยังไม่เริ่มเขียนโค้ด (เจ้าของเคาะ §2 ครบแล้ว 2026-09-21)
- **`docs/plan-quote-price-approval.md`** — คิวอนุมัติราคาต่ำกว่าขั้นต่ำ + role `approver`
- **`docs/plan-web-quote-logging.md`** — ประวัตของหน้าเว็บใน `messages` (`web_*` + `meta`) และวิธีวัด `chosen_rank`
- **`docs/plan-product-block-rules.md`** — กฎบล็อกสินค้า
- **`docs/plan-pricing-subcodes.md`** — พิมพ์รหัสสินค้าสั่งทำแล้วได้ราคา + ตารางรหัสย่อยที่แอดมินตั้งราคา/กฎเองได้ (เฟส A–C ทำแล้ว · **อยู่ในแอดมินจริงแล้วเป็นโมดูลที่ถอดออกได้** — ดู `services/pricingLab/README.md` · สมุดราคาครอบ 14 รุ่น / 11 ชีต = 80.1% ของรหัสจริง · เฟส D ยังเป็นแบบที่เสนอ)
  **ตั้งแต่ 2026-09-21 แอดมินแก้ราคาเองจากหน้าจอได้** (ปุ่มดาวน์โหลดแม่แบบ/อัปโหลด) ⇒ **ไฟล์ที่อัปผ่านจอคือตัวจริงของราคา** ส่วน `data/*.xlsx` + `npm run pricebook:import` กลายเป็นทางสำหรับลอกชีตใหม่เข้ามาเท่านั้น และการรันทับจะล้างราคาที่แอดมินแก้ไว้ (ตั้งใจ — มันคือการเริ่มเล่มใหม่) · คู่มือแอดมิน: `docs/guide-pricebook-admin.md`
  **ตั้งแต่ 2026-09-23 แก้ราคา+กฎทีละรุ่นจากหน้าจอได้ด้วย** (`GET/PUT /api/admin/pricing/model/:code` · `services/pricingLab/modelEditor.ts`) — ทางเดียวกับ Excel ทุกประการ ต่างแค่ความสะดวก
  **และ "ตัวอักษรท้ายเลขรุ่น" เป็นของจริงในสมุดราคาแล้ว** (`PriceModel.variant`) — ตัว C ของซีรีส์ BH เคยถูกแตกเป็นรุ่น `BH-01C` ต่างหาก ทำให้ **`BH-02C` (11 รายการ) กับ `BH-03C` (1 รายการ) ตกไปคิดเป็นรุ่นฐานเปล่า ๆ ไม่บวก 20% และไม่มีอะไรฟ้อง** ⇒ ย้ายมาเป็นตัวเลือกของรุ่นหลัก ตั้งที่เดียวครอบทุกรหัสที่ลงท้ายด้วยตัวนั้น · **ไม่ใช่ "+20% กับทุกอย่าง"** (ของแถม 4 อย่างคูณสอง ที่เหลือเท่าเดิม ⇒ เก็บเป็นราคารายรายการ) · gate: `npm run diag:pricing` (มี `pricingModelEdit.ts` รวมอยู่แล้ว)
  ⚠️ **`Adder.over` ที่ไม่มีค่า แปลว่า "ใช้ `standard[dim]`" ไม่ใช่ 0** — ใครเติม `?? 0` ให้มันตอนรับค่าจากหน้าจอ กฎอย่าง "สายยาวเกิน 30 CM" จะคิดเงินตั้งแต่เซนติเมตรแรก ทุกใบแพงขึ้น 120 บาทเงียบ ๆ
- **`docs/plan-pricebook-db.md`** — ย้ายสมุดราคาจาก `pricebook/book.json` เข้า DB (3 ตาราง · `json` ไม่ใช่ `jsonb` เพราะ jsonb สลับลำดับคีย์) · **แผนรอเจ้าของเคาะ §12** (2026-09-23)
- **`docs/plan-logging-audit-compliance.md`** — ระบบ log / audit / ข้อกำหนดตามกฎหมาย
- **`docs/plan-user-roles-auth.md`** — สิทธิ์ผู้ใช้และการยืนยันตัวตน
- **`docs/plan-role-permissions.md`** — เมทริกซ์สิทธิ์ต่อ role ที่ตั้งจากหน้าจอได้ + role `salesperson` + ตัวตนบนใบที่ออกจากเว็บ
