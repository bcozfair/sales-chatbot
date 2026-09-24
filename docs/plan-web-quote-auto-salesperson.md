# เติม "ออกในนาม (พนักงานขาย)" ให้เองจากลูกค้า — หน้าเว็บขอใบเสนอราคา

สถานะ: หลังบ้าน + migration เขียนแล้ว (2026-09-24) · **migration ยังไม่ได้รันบนฐานจริง** ·
หน้าจอรอเจ้าของยืนยัน mockup (AGENTS.md A9)

## 1. ที่มา

role ที่เลือกเซลส์ได้ทุกคน (admin · subadmin · approver = ช่อง `quote.act_as_any_salesperson`)
ต้องเลือก "ออกในนาม" เองทุกใบ แต่ **จำไม่ได้ว่าลูกค้ารายไหนเป็นของเซลส์คนไหน** (เจ้าของ 2026-09-24)

สิ่งที่เจ้าของเคาะ (2026-09-24):

1. ช่อง "ออกในนาม" **เริ่มต้นว่าง** — ไม่เอาคนที่เลือกครั้งก่อนมาใส่
2. รู้ลูกค้าเมื่อไหร่ ระบบเติมเซลส์ของลูกค้าให้ · ผู้ใช้เลือกทับเองได้
3. เซลส์ของลูกค้า = ระดับ **บริษัท** จาก `customers_data_view` · บริษัทที่ผู้ติดต่อแต่ละคนผูกกับ
   เซลส์ต่างกัน ใช้ **คนแรกที่ไม่ว่าง เรียงตาม `contact_id`**
4. **แก้ใบเดิม = คงเซลส์ของใบเดิม** ไม่ใช่เซลส์ของลูกค้าในวันนี้
5. เพิ่มคอลัมน์ `salesperson_id` ใน `customers_data_view`

role `salesperson` ไม่เปลี่ยนอะไร (ออกในนามตัวเองเสมอ)

## 2. ข้อมูลที่วัด (2026-09-24 · SELECT อย่างเดียว)

- ชื่อใน `customers_data_view.salesperson` เป็นรูป `คุณจิรายุ(PM)` · ตาราง `salesperson` เก็บ
  `คุณจิรายุ` ⇒ เทียบตรงตัวได้ **0/123 ชื่อ** · ตัด `(PM)` ทิ้งแล้วได้แค่ 63/123 และคนเดียวกันมีรหัส
  ฝั่ง PM กับ THT คนละตัว (คุณสมิตานันท์ 671/672 · คุณคัมภีร์ 431/566) ⇒ ตัดท้ายไม่ได้
- `sale_orders` เก็บชื่อรูปเดียวกันคู่กับ `salesperson_id` (= รหัสในตาราง `salesperson`) ·
  **132 ชื่อ ทุกชื่อมีรหัสเดียว**
- ความครอบคลุม (เซลส์คนแรกที่ไม่ว่าง → รหัส → คนที่ออกในนามได้):

  | กลุ่ม | บริษัท | มีชื่อเซลส์ | มีรหัส | เติมให้ได้ |
  | --- | --- | --- | --- | --- |
  | ทั้งหมด | 53,554 | 19,333 | 18,052 | **14,567** |
  | มีออเดอร์ใน 365 วัน | 8,238 | 6,791 | — | **~6,239 (76%)** |

  ที่เติมไม่ได้ = Odoo ไม่ได้ใส่เซลส์ หรือใส่เป็นบัญชีระบบ/คนที่ไม่ active แล้ว
  (`purchase_user_1` 658 · `purchase_manager` 439 · `sale_marketing` · `sale_admin` …) —
  **แก้ในรีโปไม่ได้** ต้องแก้ข้อมูลใน Odoo
- ใบที่ยืนยันแล้วใน 180 วัน: เจ้าของใบ 35 ราย หาเซลส์ได้ **35/35**

## 3. การออกแบบ

### 3.1 `customers_data_view.salesperson_id` (migration `2026-09-24_01`)

- CTE `sp_code` ใน `customers_data_build`: ชื่อ → รหัสของใบล่าสุดใน `sale_orders`
  (index-only scan บน `idx_so_salesperson_cover` ~255ms ต่อรอบ build)
- คอลัมน์ต่อ **ท้ายสุด** — `CREATE OR REPLACE VIEW` เพิ่มได้แค่ท้าย และ `ensureDirectoryRow()`
  INSERT ตามตำแหน่ง ⇒ แก้ให้ลอก `v.salesperson_id` ท้ายสุดด้วย
- วัดกับข้อมูลจริง (อ่านอย่างเดียว): แถว 82,906 เท่าเดิม · **คอลัมน์เดิม 24 ตัวต่างกัน 0 แถว**
- ⚠️ `customers` ที่ sync จาก Odoo ไม่มีรหัสเซลส์ — ถ้าวันหน้า gateway ส่งมา แก้ต้นทางใน `sp_code` ที่เดียว

### 3.2 `services/customerSalesOwner.ts`

- `resolveCustomerSalesOwner(companyId, options)` — ใบใหม่
- `resolveQuotationSalesOwner(quoteUserId, options)` — แก้ใบเดิม: ใบจาก LINE ตามด้วย user_id ·
  ใบจากเว็บ (แถวพร็อกซี `web:<admin>:<sp>`) ตามด้วยรหัสที่พร็อกซีลอกมา
- `options` = รายชื่อ dropdown ที่ยุบซ้ำแล้ว (`listSalespersonsForWeb()`) ⇒ คำตอบเป็นตัวเลือกที่มีอยู่จริงเสมอ
- ผลมีสามแบบ: `resolved` · `inactive` (รู้ชื่อแต่ออกในนามไม่ได้) · `none` — **ไม่เดาแทน** ไม่ throw
- ไม่ใช่ด่านสิทธิ์ — การออกในนามใครได้ยังตัดสินที่ `assertMayActAs()` ตามเดิม

### 3.3 API

| เส้น | เปลี่ยนอะไร |
| --- | --- |
| `GET /api/admin/webquote/sales-owner?customer_id=` | **ใหม่** · คร่อม `quote.create` + `quote.act_as_any_salesperson` |
| `POST /propose` | `sp_user_id` ว่างได้ (เฉพาะคนที่มีช่อง `act_as_any`) ⇒ ไม่สร้างแถวพร็อกซี · คิว/ประวัติใช้คีย์ `web:<admin>:auto` (`buildWebProposeKey`) ซึ่งไม่มีทางเป็น `quotations.user_id` |
| `POST /revise` | `sp_user_id` ว่างได้ ⇒ ใช้เซลส์ของใบต้นทาง · หาไม่ได้ตอบ 400 `SALESPERSON_REQUIRED` ให้เลือกเอง · คืน `sp_user_id` ที่ใช้จริง |
| `/drafts` · `/preview` · `/preview-pdf` · `/confirm` | **ไม่เปลี่ยน** — หน้าจอยังส่ง `sp_user_id` ที่เติมแล้วเหมือนเดิม |

### 3.4 หน้าจอ (รอ mockup)

`QuoteIssuerProfile.tsx` + `QuoteRequest.tsx`: ช่องว่างตอนเปิดหน้า · วางข้อความได้โดยไม่ต้องเลือกก่อน ·
`customerId` เปลี่ยน → เรียก `/sales-owner` แล้วเติม (ถ้าผู้ใช้ยังไม่ได้เลือกทับเองในใบนี้) ·
หาไม่ได้ = บอกเหตุผล + บังคับเลือกเองก่อนสร้างใบ · แก้ใบเดิม = ตั้งช่องจาก `sp_user_id` ที่ `/revise` คืนมา ·
เลิกเอา `acting_salesperson_id` มาเติมให้ role ที่เลือกได้ทุกคน (คอลัมน์ยังอยู่ ไม่ลบ)

## 4. ผลกับการค้นหาลูกค้า

propose แบบไม่มีเซลส์ ส่ง `null` เข้า `findCustomerCandidates` ⇒ สัญญาณ "เซลส์เจ้าของลูกค้าตรงกับ
ผู้ส่ง" ใน prompt จัดอันดับของ AI เป็น "ไม่" ทุกราย ซึ่ง **เท่ากับที่ด่าน eval วัดอยู่แล้ว**:
`evalCustomerSearch.ts` และ `webDecisionParity.ts` ใช้เซลส์ปลอมชื่อ `EVAL` ที่ไม่ตรงกับลูกค้ารายไหน
และ `branch_code` ของเซลส์ใช้แค่พิมพ์ log ⇒ baseline 54/56 (`wrong-auto-select` 0) คือตัวเลขของโหมดนี้
`customerService.ts` ไม่ถูกแก้สักบรรทัด ⇒ เส้น LINE ไม่ขยับ

## 5. ด่าน

- `npm run diag:web-sales-owner` (ใหม่ · อ่านอย่างเดียว) — ยังไม่ได้รัน migration จะล้มพร้อมบอกวิธี
- `npm run diag:local-contacts` (แตะ `ensureDirectoryRow` + นิยาม view) + `diag:credit-hold` ·
  `diag:data-directory` · `diag:customer-search` ตามตาราง AGENTS.md B5
- `npm run diag:role-permissions` (route ใหม่ใน `index.ts`) · `diag:sp-dedupe`
- `diag:web-quote` เขียนฐานจริงแล้วลบทิ้ง ⇒ บน PMSV ต้องขอเจ้าของก่อน

## 6. ลำดับขึ้นระบบ

1. `npm run db:dump`
2. รัน migration `2026-09-24_01` (แก้แค่ catalog ของ view · รันได้ทุกเวลา)
3. refresh `customers_data_view` ด้วย `{ force: true }` (build+swap ~2.5 วิ ไม่มีช่วงค้นหาพัง)
4. `npm run diag:web-sales-owner` ต้องเขียวหมด
5. แล้วค่อย deploy โค้ด — **ห้ามสลับ**: โค้ดใหม่ก่อนตารางมีคอลัมน์ ⇒ `ensureDirectoryRow()` INSERT
   เกินจำนวนคอลัมน์ = **เพิ่มผู้ติดต่อใหม่ไม่ได้** · กลับกัน (ตารางมีคอลัมน์แต่โค้ดเก่า) ปลอดภัย
   เพราะ INSERT ขาดท้ายได้ NULL
