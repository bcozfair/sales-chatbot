# ย้ายสมุดราคา (โมดูล pricingLab) จาก `pricebook/book.json` เข้า PostgreSQL

> สถานะ: **แผนรอเจ้าของเคาะ — ยังไม่เริ่มเขียนโค้ด** (เขียน 2026-09-23 บน PMSV ที่ `main` @ `db222be`)
> · ตัวเลขทุกตัววัดเมื่อ **2026-09-23** และมีวิธีวัดกำกับไว้ให้วัดซ้ำได้
> · ทิศทางหลักเจ้าของเห็นชอบแล้ว (jsonb รุ่นละแถว + ประวัติแบบเขียนต่อท้าย) — แผนนี้**ไม่รื้อ**
> แต่ชี้จุดอ่อนสี่จุดพร้อมหลักฐานใน §3 ซึ่งมีหนึ่งจุดที่ต้องตัดสินก่อนลงมือ (**json หรือ jsonb** — §12 ข้อ 1)
> · ต่อจาก [`plan-pricing-subcodes.md`](plan-pricing-subcodes.md) §7.3 (ปุ่มนำเข้า/ส่งออก) และ
> `services/pricingLab/README.md`

---

## 0. สรุปสำหรับคนที่อ่านแค่หน้าแรก

สมุดราคาวันนี้เป็นไฟล์ในคอนเทนเนอร์ที่ไม่มี volume ⇒ **`docker compose up --build` ทุกครั้งทิ้งราคาที่แอดมิน
แก้และเล่มสำรองทั้งหมด** และ `backup:auto` ตีสามไม่เคยถ่ายมันไปด้วย · แผนนี้ย้ายมันเข้า DB เป็นสามตาราง

| ตาราง | หนึ่งแถว = | แทนของเดิม |
| --- | --- | --- |
| `pricing_models` | หนึ่งรุ่น (สเปกทั้งก้อน = `PriceModel`) | `book.models` |
| `pricing_model_history` | สเปกของรุ่นหนึ่งหลังการบันทึกครั้งหนึ่ง (เขียนต่อท้ายอย่างเดียว) | `pricebook/backups/` |
| `pricing_book_revisions` | **การบันทึกหนึ่งครั้ง** (แก้ทีละรุ่น / อัปแม่แบบ / นำเข้าเล่มแรก / ย้อน) + ฟิลด์ระดับเล่ม | `version` · `source` · `subCodes` · `edited` + ลายนิ้วมือ |

**ไม่แตะ engine / ตัวอ่านรหัส / หน้าจอ** — เปลี่ยนเฉพาะชั้นเก็บ (`bookStore.ts` · `bookUpdate.ts`) +
เส้น API ที่เรียกมัน + เครื่องมือ CLI + ด่าน · หน้าจอแอดมินไม่ต้องแก้สักบรรทัดเพราะรูปของ API คงเดิม

**จังหวะดีที่สุดคือตอนนี้:** production **ยังไม่มีสมุดราคาเลย** (`/app/pricebook` ไม่มีในคอนเทนเนอร์ ·
`pricing_subcodes` = 0 แถว — วัด 2026-09-23) ⇒ ไม่มีอะไรต้องย้ายข้าม และไม่มีอะไรจะหายถ้าถอยกลับ

---

## 1. ทำไมต้องย้าย

| ปัญหาวันนี้ | ที่มา |
| --- | --- |
| rebuild = ราคาที่แอดมินแก้หายทั้งเล่ม พร้อมเล่มสำรอง | `pricebook/` อยู่ใน filesystem ของกล่อง · `docker-compose.yml` มี volume แค่ `pgdata` `sig_sale` `sig_admin` (บรรทัด 33, 77–78) |
| ไม่อยู่ในสำรองอัตโนมัติ | `backup:auto` ถ่ายแค่ DB |
| บันทึกไม่ atomic | `saveBook()` ย้ายไฟล์ไปกองสำรองก่อนแล้วค่อยเขียน (`bookUpdate.ts:231–243`) — ถ้าดับกลางคันจะเหลือเล่มสำรองแต่ไม่มีเล่มปัจจุบัน |
| กันแก้ทับกันได้ไม่จริง | `/import/apply` ตรวจลายนิ้วมือที่ `routes/pricingLab.ts:223` แล้ว `await readUploaded()` (:229) ก่อนเขียนที่ :244 ⇒ อีก request แทรกเข้ามาได้ · และด่านนี้**ข้ามไปเลยถ้าไม่ได้ส่ง `fingerprint`** (:223, :325) |
| นำเข้าจาก Excel ทับเล่มเดิมแบบย้อนไม่ได้ | `importer.ts:388` `writeFileSync` ตรง ๆ ไม่ผ่าน `saveBook()` ⇒ ไม่มีเล่มสำรอง |
| สองเครื่องสองเล่ม | dev กับ PMSV ต่างคนต่างมีไฟล์ ใครแก้ที่ไหนก็อยู่ที่นั่น |

ราคาเป็น "ค่าที่ร้านแก้เอง" ⇒ ต้องอยู่ใน DB ตามหลักการข้อ 2 (`AGENTS.md` B3) เหมือนโปรโมชัน กฎราคา MOQ

---

## 2. ข้อเท็จจริงที่วัดแล้ว (2026-09-23)

วิธีวัด: `git archive HEAD` → `/tmp` ของคอนเทนเนอร์ app (symlink `node_modules`, ไม่แตะ `/app`)
→ `buildBook('<ไฟล์ Excel>', 'scripts/pricebook/maps')` ในหน่วยความจำ → ลบทิ้ง
· ลำดับคีย์ของ jsonb วัดด้วย `SELECT $$…$$::jsonb::text` ผ่าน psql (อ่านอย่างเดียว)

| เรื่อง | ค่าที่วัดได้ |
| --- | --- |
| ขนาดทั้งเล่ม | **120,848 ไบต์** (JSON เยื้อง 2 ตามที่ importer เขียน) · 74,829 ไบต์แบบไม่เยื้อง — ตัวเลข "450KB" ในหัว `bookStore.ts` เก่าแล้ว |
| จำนวนรุ่น | **13 รุ่น / 11 ชีต** — `BH-01 BH-03 TSK-04 TS-14 TS-18 TSK-06 TSK-11 TSP-08 TSP-10 TSK-12 TSP-12 TSK-01 TSK-01-0` (README ยังเขียน 14) |
| รุ่นที่ใหญ่ที่สุด | `TSP-08` **12,063 ไบต์** (336 ช่อง) · เล็กสุด `TSK-12` 1,639 ไบต์ |
| ฟิลด์ระดับเล่ม | `version` · `source` (**สตริงเดียว** ชื่อไฟล์คั่นด้วย ` · ` ไม่ใช่ `sources`) · `models` · `subCodes` (1 แถว — `-U` ของ TS-14 จาก `scripts/pricebook/subcodes.json`) · `edited` (เฉพาะเมื่อมีคนแก้) |
| เวลา build จาก Excel | 759 ms |
| ขนาดเมื่อเป็น datum | ทั้งเล่ม jsonb **99,158** ไบต์ · json **74,833** ไบต์ (`pg_column_size` ก่อนบีบอัด) |
| json เก็บข้อความตรงตัว | `($$…$$::json)::text = $$…$$` → **t** ทั้งเล่ม |
| jsonb สลับลำดับคีย์ | ใช่ — คีย์สั้นก่อนแล้วเรียงตามไบต์ (ตรงกับที่จำลองทุกตัวอักษร) · ค่าเท่าเดิมทุกตัว |
| ผลของลำดับ jsonb ต่อแม่แบบ .xlsx | ชีต **16 จาก 22** เรียงแถว/คอลัมน์ใหม่ (เช่น ขนาดเกลียว TSK-04 `1/8” 1/4” 3/8” 1/2” 3/4” 1”` → `1” 1/2” 1/4” 1/8” 3/4” 3/8”`) |
| ผลต่อรายการค่าแกน (`axisValues`) | **21 รายการ** เปลี่ยนลำดับ (ลำดับของช่องเลือกบนจอ) · ค่าที่ชนกันหลัง normalize = 0 ⇒ **ราคาไม่เปลี่ยน** เปลี่ยนแค่การแสดงผล |
| ด่านเดิมบนเล่มจาก Excel | golden **64/64** · roundtrip **30/30** · import **26/26** · modelEdit **33/33** (`pricingLab.ts` ไม่ได้รันเพราะเขียนฐาน) |
| ด่านเดิมบนเล่มที่ลำดับถูกสลับแบบ jsonb | **ผ่านครบเท่ากันทุกตัว** ⇒ ด่านชุดเดิมไม่เห็นปัญหานี้ ต้องมีด่านใหม่ (§8.2) |
| แอปเป็นโปรเซสเดียวไหม | ใช่ — ในกล่องมี `node --import tsx index.ts` ตัวเดียว (PID 7) · `Dockerfile:67` CMD เดียว · compose มี service `app` ตัวเดียว · ไม่มี cluster/pm2 · **แต่ CLI (`docker compose exec/run app npx tsx …`) เป็นอีกโปรเซส** |
| บอท LINE / ใบเสนอราคาใช้ pricingLab ไหม | **ไม่ใช้** — grep `pricingLab\|pricebook` ทั้งรีโปเจอแค่ไฟล์ของโมดูลเอง + `index.ts:161,242` (mount) + `config/capabilities.ts:407–415` · `handlers/` `quotationService.ts` `webQuoteService.ts` `utils/pricing.ts` `liff_pages/` = 0 |
| node-pg อ่าน `json` | `JSON.parse` (OID 114) ⇒ ลำดับคีย์คงเดิม · รีโปไม่มี `setTypeParser` |
| Postgres | 18.4 ทั้ง dev และ prod ⇒ ใช้ `UNIQUE NULLS NOT DISTINCT` (PG15+) ได้ |

---

## 3. จุดอ่อนของทิศทางที่เห็นชอบ (ไม่รื้อ แต่ต้องรู้ก่อนลงมือ)

### 3.1 jsonb ทำลายลำดับคีย์ และมีโค้ดสามจุดที่ใช้ลำดับนั้น

`jsonb` ไม่เก็บลำดับคีย์ของ object (เอกสาร Postgres + วัดตาม §2) · โค้ดที่ใช้ลำดับการแทรกคีย์อยู่:

- `scripts/pricebook/sheet.ts:497` — แถว/คอลัมน์ของแม่แบบ .xlsx มาจาก `Object.keys(m.base.cells)`
- `services/pricingLab/code.ts:80` — `axisValues()` ⇒ ลำดับช่องเลือก และ `matchValue` ที่หยิบตัวแรกที่ตรง
- `services/pricingLab/modelEditor.ts:174` — แถวอัตราตามแกนบนหน้าแก้ราคา

แก้ในโค้ดไม่ได้โดยไม่แตะ engine/ตัวอ่านรหัส (ต้องเก็บลำดับแกนแยก = เปลี่ยน `types.ts`) และจะทำให้ผลของเล่มเดิมเปลี่ยนไปด้วย

⇒ **แนะนำ: คอลัมน์ `spec` เป็น `json` ไม่ใช่ `jsonb`** · `json` เก็บข้อความตามที่ส่งไปทุกไบต์ ยังตรวจ syntax
ให้เหมือนเดิม ส่วนที่เสียไปคือ operator `=` และ index GIN ซึ่งโมดูลนี้ไม่ใช้เลย (อ่าน/เขียนทั้งก้อนเสมอ ·
มีแค่ 13 แถว) · `->>` ยังใช้ได้กับ `json` จึงใช้ใน CHECK/GENERATED ได้
(`pricing_subcodes.data` ที่เป็น jsonb อยู่แล้ว**ไม่ต้องเปลี่ยน** เพราะไม่มีโค้ดไหนใช้ลำดับคีย์ของ `SubCode`)

### 3.2 "ตัวตรวจใน modelEditor" ตรวจได้เฉพาะของที่มาจากหน้าจอ

`applyModelEdit()` (`modelEditor.ts:391`) ตรวจ **สิ่งที่หน้าจอส่งมาเทียบกับรุ่นเดิม** ไม่ใช่ `PriceModel` ทั้งก้อน
และ `readWhen()` (:240) **ปฏิเสธ `all`/`any`/`not` โดยตั้งใจ** ซึ่งรุ่นที่มาจาก Excel มีอยู่จริง ⇒ เอามาตรวจ
ของที่มาจากทางนำเข้าไม่ได้ · ตัวตรวจของแต่ละทางเข้ามีอยู่แล้วและยังอยู่ที่เดิม:

| ทางเข้า | ตัวตรวจเชิงธุรกิจ (ไม่ย้าย ไม่ก๊อป) |
| --- | --- |
| แก้ทีละรุ่น `PUT /model/:code` | `applyModelEdit()` |
| อัปแม่แบบ `/import/apply` | `sheetsToBook()` → `issues` ระดับ `error` หยุด (`routes/pricingLab.ts:232`) |
| นำเข้าเล่มแรกจาก Excel (CLI) | ไฟล์ map + `buildBook()` ที่ throw เมื่อหาชีต/เซลล์ไม่เจอ |
| ย้อนเล่ม | ของใน history ผ่านด่านตอนเขียนมาแล้ว |

สิ่งที่ยังขาดคือ **ด่านโครงสร้างที่ประตูเก็บ** เหมือน `clean()` ของรหัสย่อย (`db/pricingLabRepo.ts:45`) — ดู §6.5

### 3.3 ประวัติรายรุ่นอย่างเดียวบอกไม่ได้ว่า "การบันทึกหนึ่งครั้งแตะอะไร"

ปุ่ม "ย้อนไปเล่มก่อนหน้า" ย้อน**ทั้งการอัปหนึ่งครั้ง** (อาจหลายรุ่น) และการ์ดบนจอต้องรู้ `version`/`source`/`edited`
ระดับเล่ม ⇒ ต้องมีแถวหัวของการบันทึกแต่ละครั้ง = `pricing_book_revisions` (§4) ซึ่งเป็นที่อยู่ของ
ฟิลด์ระดับเล่มด้วย

### 3.4 `updated_at` หรือเลข version ต่อแถวใช้เป็นกุญแจกันทับไม่ได้ดีพอ

- เวลาใน JS ละเอียดแค่ ms แต่ Postgres ละเอียด µs ⇒ เทียบแล้วไม่ตรงเอง
- สองแถวเขียนใน µs เดียวกันได้
- ด่าน "ระดับเล่ม" ต้องการตัวเลขเดียวทั้งเล่ม

⇒ ใช้ **เลขการบันทึก (revision id) + UNIQUE บน parent** ซึ่งให้ฐานเป็นคนตัดสินเอง (§6.2)

### 3.5 `series` ยังไม่มีใครใช้

ไม่มีโค้ดตัวไหนรู้จักคำว่า series/ตระกูลในระดับรุ่น · ถ้าอยากได้ ให้เป็นคอลัมน์ GENERATED จาก `code`
(ไม่เขียนสองที่) — ดู §12 ข้อ 5

---

## 4. Schema

### 4.1 migration ใหม่ `migrations/changes/2026-09-XX_01_pricing_book_db.sql`

(ใส่วันที่จริงตอนเขียน · อธิบายด้วย `--` เท่านั้น **ห้าม `COMMENT ON`**)

```sql
-- สมุดราคาของโมดูล "คิดราคาสินค้า" ย้ายจาก pricebook/book.json เข้าฐาน (docs/plan-pricebook-db.md)
-- ถอดโมดูล = DROP ทั้งสามตารางนี้ + pricing_subcodes · ไม่มี FK ชี้เข้าจากตารางอื่นของระบบ
-- spec เป็น json ไม่ใช่ jsonb โดยตั้งใจ: jsonb สลับลำดับคีย์ แล้วแม่แบบ .xlsx เรียงแถว/คอลัมน์ใหม่
--   16 จาก 22 ชีต (วัด 2026-09-23) · โมดูลนี้อ่าน/เขียนทั้งก้อนเสมอ ไม่ต้องใช้ operator ของ jsonb
-- id เป็น IDENTITY ไม่ใช่ BIGSERIAL: ด่านที่สร้างตารางเงาด้วย LIKE … INCLUDING ALL จะได้ sequence
--   ของตัวเอง ไม่ไปกินเลขของ sequence จริง (nextval ไม่ rollback)

CREATE TABLE IF NOT EXISTS pricing_book_revisions (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- เล่มที่การบันทึกครั้งนี้ตั้งต้นจาก = ลายนิ้วมือที่หน้าจอถือมา · UNIQUE = สองคนตั้งต้นจากเล่มเดียวกัน
  -- บันทึกได้คนเดียว (คนที่สองโดน unique violation → 409) · NULL มีได้แถวเดียว (เล่มแรก)
  parent_id      BIGINT REFERENCES pricing_book_revisions (id),
  kind           TEXT NOT NULL
                 CONSTRAINT pricing_book_revisions_kind_check
                 CHECK (kind IN ('seed', 'import', 'model', 'restore')),
  restored_from  BIGINT REFERENCES pricing_book_revisions (id),
  -- ฟิลด์ระดับเล่มของ PriceBook "หลังการบันทึกครั้งนี้" — คัดต่อจากครั้งก่อนถ้าไม่เปลี่ยน
  version        TEXT NOT NULL,
  source         TEXT NOT NULL,
  book_subcodes  JSON NOT NULL DEFAULT '[]'::json,   -- PriceBook.subCodes (มาจากไฟล์ราคา ≠ pricing_subcodes)
  edited         JSON,                               -- PriceBook.edited · NULL = ยังไม่มีคนแตะ
  source_files   JSON,                               -- [{name, sha256, bytes}] ของไฟล์ที่ใช้ — ไม่เก็บตัวไฟล์
  created_by     TEXT,                               -- ใครกด (ต่างจาก edited.by ตอนย้อน) · ไม่ใช่ FK
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pricing_book_revisions_parent_key UNIQUE NULLS NOT DISTINCT (parent_id),
  CONSTRAINT pricing_book_revisions_root_check    CHECK ((kind = 'seed') = (parent_id IS NULL)),
  CONSTRAINT pricing_book_revisions_restore_check CHECK ((kind = 'restore') = (restored_from IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS pricing_models (
  code            TEXT     PRIMARY KEY,
  position        INTEGER  NOT NULL,                  -- ลำดับของรุ่นในเล่ม (= ลำดับ Object.keys เดิม)
  spec            JSON     NOT NULL,                  -- PriceModel ทั้งก้อน
  schema_version  SMALLINT NOT NULL DEFAULT 1,
  revision_id     BIGINT   NOT NULL REFERENCES pricing_book_revisions (id),
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pricing_models_spec_is_object CHECK (json_typeof(spec) = 'object'),
  CONSTRAINT pricing_models_code_matches   CHECK ((spec ->> 'code') = code)
);

-- เขียนต่อท้ายอย่างเดียว — โค้ดไม่มี UPDATE/DELETE ตารางนี้ (ด่าน §8.2 ข้อ 13 grep ให้)
CREATE TABLE IF NOT EXISTS pricing_model_history (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  revision_id     BIGINT   NOT NULL REFERENCES pricing_book_revisions (id),
  code            TEXT     NOT NULL,
  position        INTEGER,
  spec            JSON,                               -- NULL = รุ่นนี้ถูกเอาออกในครั้งนี้ (เกิดจากการย้อนเท่านั้น)
  schema_version  SMALLINT NOT NULL DEFAULT 1,
  CONSTRAINT pricing_model_history_rev_code_key UNIQUE (revision_id, code),
  CONSTRAINT pricing_model_history_code_matches CHECK (spec IS NULL OR (spec ->> 'code') = code),
  CONSTRAINT pricing_model_history_removed_check CHECK ((spec IS NULL) = (position IS NULL))
);

CREATE INDEX IF NOT EXISTS pricing_model_history_code_rev_idx
  ON pricing_model_history (code, revision_id DESC);
```

**ไม่ใส่ unique บน `position` โดยตั้งใจ** — ตอนย้อนเล่ม รุ่นที่เคยถูกเอาออกแล้วเพิ่มกลับจะได้ตำแหน่งเดิมคืน
และอาจชนกับแถวอื่นชั่วคราวระหว่าง upsert · ใช้ `ORDER BY position, code` ซึ่งได้ลำดับเดียวกันทุกครั้งอยู่แล้ว

migration นี้**สร้างตารางใหม่อย่างเดียว** ไม่ล็อกตารางเดิมสักตัว ⇒ รันได้ทุกเวลา และรันก่อน deploy โค้ดได้

### 4.2 ยุบเข้า `migrations/schema.sql`

- วางสามบล็อกต่อจากบล็อก `pricing_subcodes` (`schema.sql:1809–1842`) ในรูปแบบ pg_dump แบบเดียวกัน
  (IDENTITY จะออกมาเป็น `ALTER TABLE … ADD GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME …)`)
- วิธีที่ถูก: รัน migration บนฐาน dev → `pg_dump --schema-only` → คัดบล็อกมาวาง → ทำตามวิธีตรวจที่หัว
  `schema.sql` (สร้าง `schema_check` แล้ว diff) **บนเครื่อง dev** (ใช้ `pg_dump`/`psql` ของ Windows ตาม `CLAUDE.md`)
  · บน PMSV คำสั่งนั้นสร้าง database ใหม่บนเซิร์ฟเวอร์จริง ⇒ ต้องขอเจ้าของก่อน
- อัปเดตบรรทัด "ตรวจล่าสุด" ที่หัวไฟล์

### 4.3 ฟิลด์ระดับเล่มไปอยู่ไหน

| `PriceBook` | ที่อยู่ใหม่ | กติกา (คงพฤติกรรมเดิม) |
| --- | --- | --- |
| `models` | `pricing_models` เรียงตาม `position` | รุ่นใหม่ต่อท้าย = เท่ากับ `{ ...current.models, [code]: next }` |
| `version` | `pricing_book_revisions.version` ของแถวล่าสุด | แก้ทีละรุ่น = คัดของเดิม (วันนี้ `PUT` ไม่แตะ version) · อัปแม่แบบ = วันที่บันทึก (`applyModels`) · เล่มแรก = วันที่ build |
| `source` | `.source` | คัดต่อ · นำเข้าจาก Excel = ชื่อไฟล์ต้นทาง |
| `subCodes` | `.book_subcodes` | คัดต่อ · `withSubCodes()` ยังให้ `pricing_subcodes` (ของแอดมิน) ชนะเหมือนเดิม |
| `edited` | `.edited` | ย้อน = **คัด `edited` ของเล่มที่ย้อนไป** (การ์ดกลับเป็นสถานะเดิม — ด่าน `pb-ui` เช็กข้อนี้) · ใครเป็นคนกดย้อนอยู่ที่ `created_by` |
| — (ใหม่) | `kind` · `created_by` · `created_at` · `source_files` | บันทึกตรวจสอบ ซึ่งไฟล์ไม่เคยมี |
| `BookStatus.path` | **ตัดทิ้ง** | เป็น path ในเครื่องที่หลุดไปกับ `/overview` · หน้าจอไม่ได้ใช้ (`frontend/src/admin/pricingLab/types.ts:108`) |

---

## 5. ทุกจุดที่อ่าน/เขียน `book.json` วันนี้ → เปลี่ยนเป็นอะไร

ไล่จาก `grep -rn "BOOK_PATH|book.json|loadBook|saveBook|restoreBackup|listBackups|bookFingerprint|bookStatus|withSubCodes|applyModels"`
(ไม่รวม `node_modules` `.claude` `public` `docs`)

### 5.1 ไฟล์ที่ต้องแตะ

| ไฟล์:บรรทัด | วันนี้ | เปลี่ยนเป็น |
| --- | --- | --- |
| `services/pricingLab/bookStore.ts:24` `BOOK_PATH` | path ของไฟล์ | ตัดทิ้ง |
| `bookStore.ts:47–64` `loadBook()` (sync, cache ตาม mtime) | อ่านไฟล์ | `loadBookState()` **async**: เทียบเลขการบันทึกล่าสุดทุกครั้งที่เรียก (§6.4) → คืน `{ book, revision, token }` · มี `readBookState(db)` ที่ไม่ใช้ cache ไว้ใช้ใน transaction/ด่าน · `loadBook()` เหลือเป็นตัวห่อ async |
| `bookStore.ts:66–78` `bookStatus()` | sync + ข้อความให้รัน `pricebook:import` | async · ข้อความใหม่ (**ถ้อยคำบนจอ — ต้องให้เจ้าของเคาะ** §12 ข้อ 9) · ถ้าเจอ `42P01` (ยังไม่รัน migration) ให้ตอบว่ายังไม่มีสมุด ไม่ใช่ 500 |
| `bookStore.ts:90` `withSubCodes()` | — | **ไม่แตะ** |
| `services/pricingLab/bookUpdate.ts:25–31, 186–269` | `bookFingerprint` `listBackups` `saveBook` `restoreBackup` `KEEP_BACKUPS` บนดิสก์ | `commitBookChange()` · `restoreRevision()` · `seedBook()` · `listRestorable()` (§6) · token = `r<revision id>` · `KEEP_BACKUPS` เหลือไว้เป็น "จำนวนที่แสดงบนจอ" |
| `bookUpdate.ts:111–176` `diffBooks` `applyModels` | pure | **ไม่แตะ** |
| `db/pricingBookRepo.ts` | — | **ไฟล์ใหม่** — SQL ทั้งหมดของสามตาราง · ทุกฟังก์ชันรับ `DbExecutor` เป็นพารามิเตอร์ท้าย (ค่าเริ่มต้น `pool`) · แยกจาก `db/repositories.ts` ด้วยเหตุผลเดียวกับ `pricingLabRepo.ts` |
| `db/pricingLabRepo.ts:116, 129, 145, 159` | ผูก `pool` | เติมพารามิเตอร์ `db: DbExecutor = pool` (ใช้ที่เดิมได้เหมือนเดิม) — เพื่อให้ด่านรันใน transaction แล้ว ROLLBACK ได้ (§8.3) |
| `services/pricingLab/modelShape.ts` | — | **ไฟล์ใหม่** — ด่านโครงสร้างที่ประตูเก็บ (§6.5) |
| `routes/pricingLab.ts:116, 162, 182, 212, 265, 303, 319` | `loadBook()` | `await loadBookState()` |
| `routes/pricingLab.ts:189, 195, 246, 254, 288, 308, 352` | `bookFingerprint()` | `state.token` / token ใหม่หลังบันทึก — **ชื่อช่อง `fingerprint` คงเดิม** หน้าจอจึงไม่ต้องแก้ |
| `routes/pricingLab.ts:223–244` | ตรวจ → `await` → `saveBook` | ตรวจเร็วก่อนอ่านไฟล์ → `readUploaded` (นอก transaction) → `applyModels` → `commitBookChange({ parent: state.revision, … })` · ถ้าชน → 409 **ข้อความเดิมทุกตัวอักษร** |
| `routes/pricingLab.ts:250–255` `/rollback` | ชื่อไฟล์ `book-*.json` | ชื่อ `rev-<id>` · `restoreRevision()` · ถ้าชนหรือไม่มีเล่มนั้น → ข้อความเดิม |
| `routes/pricingLab.ts:319–352` `PUT /model/:code` | `saveBook` ทั้งเล่ม | `commitBookChange({ kind: 'model', models: [next] })` เขียนแถวเดียว |
| `routes/pricingLab.ts:283–291` `shelf` | `listBackups()` | `listRestorable(3)` → `{ name: 'rev-<id>', at, models }` **รูปเดิม** |
| `scripts/pricebook/importer.ts:23, 383–388` | ค่าเริ่มต้นอ่าน `data/` แล้วเขียน `BOOK_PATH` ทับ | **ต้องใส่ `--data` เสมอ** (ไม่มีค่าเริ่มต้น — ค่าเริ่มต้นที่ชี้ `data/` คือการชวนให้วางไฟล์ในโฟลเดอร์ที่ถูกเสิร์ฟออกเว็บ) · ไม่ใส่ธงอะไร = แสดงรายงานอย่างเดียว · `--apply` = `seedBook()` (เล่มแรก) · `--apply --replace-all` = นำเข้าทับเล่มที่มีอยู่แบบย้อนได้ · `--from-json <ไฟล์>` = ย้ายเล่มเดิมของเครื่อง dev · `--out <ไฟล์.json>` = เขียนไฟล์ (ปฏิเสธถ้า path อยู่ใต้ `public/` หรือ `data/`) |
| `scripts/pricebook/xlsx.ts:25, 30–32, 95, 105` | อ่าน `BOOK_PATH` | อ่านจากฐาน (`--book <ไฟล์.json>` ใช้แทนได้) |
| `xlsx.ts:96, 107` | ไฟล์ปลายทางตั้งต้นใน `scripts/pricebook/` ซึ่ง **git ไม่ได้ ignore** | ตั้งต้นที่ `os.tmpdir()` หรือต้องใส่ `--out` |
| `xlsx.ts:141–145` `import --save` | เขียนทับ**ทั้งเล่ม** (ลบรุ่นที่ไม่มีในไฟล์ — ขัดกับกติกาข้อ 2 ของหน้าจอ) | **ถอดออก** — ทางเขียนมีสองทางคือหน้าจอ กับ `importer --apply` (§12 ข้อ 11) · `import` ที่ไม่มี `--save` ยังเป็นตัวตรวจไฟล์ได้เหมือนเดิม |
| `scripts/pricebook/cli.ts:20, 23` | อ่าน `BOOK_PATH` | อ่านจากฐาน / `--book` |
| `scripts/diag/pricingBookSource.ts` | — | **ไฟล์ใหม่** — ที่เดียวที่ด่านทุกตัวใช้หาเล่ม: `--source db` (ค่าเริ่มต้น · SELECT อย่างเดียว) · `--source xlsx --data <dir>` · `--source json <ไฟล์>` · **พิมพ์บรรทัดแรกเสมอว่าใช้เล่มไหน revision เท่าไหร่** |
| `scripts/diag/pricingLab.ts:16, 61–69, 154` | `loadBook()` | ผ่าน `pricingBookSource` |
| `pricingLab.ts:141–167` (ข้อ 5) | **commit ลง `pricing_subcodes` จริงแล้วลบใน `finally`** | ทำใน transaction แล้ว **ROLLBACK เสมอ** (§8.3) |
| `scripts/diag/pricingGolden.ts:18–21` · `pricingRoundtrip.ts:26–31` · `pricingModelEdit.ts:13–29` | `readFileSync(BOOK_PATH)` | ผ่าน `pricingBookSource` — **ข้อตรวจเท่าเดิมทุกข้อ** |
| `scripts/diag/pricingImport.ts:24–44, 143–191` | ข้อส่วนต่าง/รวมรายรุ่น 16 ข้อ + ข้อสำรอง/ย้อนบนดิสก์ 10 ข้อ | 16 ข้อ pure คงไว้ · **10 ข้อที่ผูกกับดิสก์ย้ายไปอยู่ใน `pricingDbRoundtrip.ts`** ในรูปที่ตรงกับฐาน (ตารางจับคู่ §8.4) |
| `scripts/diag/pricingCoverage.ts:21, 46–51` | `loadBook()` | ผ่าน `pricingBookSource` |
| `scripts/diag/pricebookUiProbe.ts:13, 248, 287` | เขียน `book.json` ของ cwd · ด่านกันเครื่องดูจาก cwd | อ่านสถานะสุดท้ายจากฐาน · **ด่านกันเครื่องเปลี่ยนเป็นดูฐาน** (§8.5) |
| `scripts/diag/pricingDbRoundtrip.ts` + `package.json` `diag:pricing-db` | — | **ด่านใหม่** (§8.2) และต่อท้าย chain `diag:pricing` |
| `.gitignore:60–72` · `.dockerignore` | — | เฟส 0 (§9) |

### 5.2 ไฟล์ที่ไม่แตะ (และต้องไม่แตะ)

- `services/pricingLab/engine.ts` `code.ts` `subcodes.ts` `labels.ts` `types.ts` `modelEditor.ts` `bookFile.ts`
- `scripts/pricebook/sheet.ts` `odoo.ts` `xlsxlite.ts` `maps/*.map.json` `subcodes.json`
- **`frontend/**` ทั้งหมด** — รูปของ API คงเดิม (`fingerprint` เป็นสตริงทึบ · `shelf.backups[]` = `{name, at, models}` · `keep`)
  ⇒ ไม่ต้อง rebuild `public/` เพราะงานนี้
- `index.ts` (จุด mount + ด่าน `page.pricing` ที่ :242) · `config/capabilities.ts` · `scripts/diag/rolePermissions.ts`
- `docker-compose.yml` · `Dockerfile` — **ไม่ต้องเพิ่ม volume** ซึ่งคือเหตุผลของงานนี้
- ทุกอย่างของ LINE / ใบเสนอราคา / LIFF / PDF

---

## 6. การบันทึก

### 6.1 ทุกทางเขียนผ่านฟังก์ชันเดียว

```
หน้าจอ PUT /model  ─┐
หน้าจอ /import/apply ┼─► commitBookChange()  ─┐
CLI importer --apply ┘   restoreRevision()    ├─► withTransaction(client => repo…)
หน้าจอ /rollback ────────► ─────────────────── ┘
```

ทางเขียนมีสองแบบ (หน้าจอกับ CLI) และตรรกะ "ลายนิ้วมือ · ประวัติ · ด่านโครงสร้าง" ต้องมีที่เดียว
**CLI ห้ามยิง SQL เอง** — ถ้าก๊อปเมื่อไหร่ วันหนึ่งเล่มที่เข้าทาง CLI จะไม่มีประวัติ หรือข้ามด่านกันทับไป

การบันทึกหนึ่งครั้ง = **transaction เดียว**:

1. `INSERT pricing_book_revisions` (`parent_id` = token ที่ถือมา) `RETURNING id` → N
2. upsert `pricing_models` เฉพาะรุ่นที่เปลี่ยน — รุ่นเดิมคง `position` · รุ่นใหม่ได้ `max(position)+1` ตามลำดับที่ติ๊ก
3. `INSERT pricing_model_history (N, code, position, spec)` ทุกรุ่นที่แตะ

แก้ทีละรุ่น = 1 + 1 + 1 แถว · อัปแม่แบบ k รุ่น = 1 + k + k แถว · เล่มแรก = 1 + 13 + 13 แถว
ล้มตรงไหนก็ ROLLBACK ทั้งก้อน ⇒ ไม่มีสถานะ "มีเล่มสำรองแต่ไม่มีเล่มปัจจุบัน" แบบ `saveBook()`

### 6.2 กันเขียนทับกัน — ให้ฐานเป็นคนตัดสิน

- token ที่หน้าจอถือ = `r<id>` ของการบันทึกล่าสุด ณ ตอนเปิดหน้า (ส่งกลับมาในช่อง `fingerprint` ช่องเดิม)
- **ตรวจเร็ว:** `max(id) ≠ token` → 409 ทันที (ไม่ต้องอ่านไฟล์ที่อัปมา)
- **ด่านจริง:** `UNIQUE NULLS NOT DISTINCT (parent_id)` — มีได้แค่การบันทึกเดียวที่ตั้งต้นจากเล่ม X

| สถานการณ์ | ผล |
| --- | --- |
| A ถือ r7 · หัวเล่มเลื่อนไป r8 แล้ว | ตรวจเร็วไม่ผ่าน → 409 |
| A กับ B ถือ r7 กดพร้อมกัน | คนแรก INSERT parent=7 ได้ · คนที่สองรอ lock ของ index แล้วโดน `23505` → 409 |
| ตรวจเร็วผ่าน แต่มีคนเขียนแทรกก่อน INSERT (ช่องโหว่แบบเดียวกับ `:223→:244` วันนี้) | unique violation → 409 |
| นำเข้าเล่มแรกซ้ำ (parent NULL สองแถว) | `NULLS NOT DISTINCT` ปฏิเสธ → CLI บอกให้ใช้ `--replace-all` |

map `23505` + ชื่อ constraint `pricing_book_revisions_parent_key` → `BookConflict` → route ตอบ 409 ด้วยข้อความเดิม
**ไม่ใช้ advisory lock** เพราะ `logworker` ใช้ key แบบ bigint อยู่แล้ว (`scripts/logworker/index.ts:24`) และด่านที่มาจาก constraint อธิบายตัวเองได้

**ช่องโหว่ที่ต้องปิดไปพร้อมกัน:** วันนี้ถ้าไม่ส่ง `fingerprint` ด่านจะข้ามไปเลย (`:223`, `:325`) · หน้าจอส่งทุกครั้ง
(`BookImportModal.tsx:136` · `ModelPriceEditor.tsx:341`) ⇒ แนะนำให้**บังคับส่ง** (§12 ข้อ 8)

**ระดับของ token:** เฟสนี้ใช้**ระดับเล่ม**เหมือนเดิมทุกประการ (ใครบันทึกรุ่นไหนก็ตาม คนที่เปิดหน้าค้างไว้จะโดน 409)
ส่วน token ระดับรุ่นเป็นทางเลือกทีหลัง (§12 ข้อ 7)

### 6.3 ประวัติ และการย้อน

- **สถานะของเล่ม ณ การบันทึก R:**
  ```sql
  SELECT DISTINCT ON (code) code, position, spec, schema_version
    FROM pricing_model_history WHERE revision_id <= $1
   ORDER BY code, revision_id DESC
  ```
  ตัดแถว `spec IS NULL` ทิ้ง แล้วเรียง `position, code` · ฟิลด์ระดับเล่มอ่านจากแถว R ของ `pricing_book_revisions`
  (ใช้ได้เพราะเล่มแรกเขียนประวัติครบทุกรุ่น)
- **ย้อนไป R** = การบันทึกใหม่ `kind='restore'` · `restored_from=R` · `parent` = หัวเล่ม ณ ตอนกด — ทั้งหมดใน transaction เดียว:
  1. อ่านสถานะ ณ R + `pricing_models … FOR UPDATE` ผ่าน client
  2. รุ่นที่ไม่มีใน R → `DELETE` + ประวัติ `spec NULL`
  3. รุ่นที่ `spec::text` ต่างจาก R → upsert + ประวัติ
  4. คัด `version/source/book_subcodes/edited` ของ R ลงแถวใหม่

  **ไม่มีอะไรถูกลบจากประวัติ** ⇒ ย้อนผิดก็ย้อนกลับได้ ตรงกับสัญญาบนจอวันนี้ ("เล่มที่ใช้อยู่ตอนนี้จะถูกเก็บไว้")
- **รายการ "ย้อนไปเล่มก่อนหน้า"** = การบันทึก 3 ครั้งล่าสุดก่อนหัวเล่ม → `{name: 'rev-<id>', at: edited?.at ?? version, models: <จำนวน ณ ครั้งนั้น>}`
  — ค่า `at` คิดแบบเดียวกับ `listBackups()` ของเดิม · หน้าจอกดตัวแรกเหมือนเดิม
- **ย้อนไปหัวเล่มเอง / id ที่ไม่มี** → ปฏิเสธโดยไม่เขียนอะไร
- **ขนาด:** การบันทึกทีละรุ่น ≤ 12 KB · อัปทั้งเล่ม ≤ 75 KB (ข้อความ json ก่อนบีบอัด) · TOAST บีบค่าที่เกิน 2 KB ให้เอง
  ⇒ เก็บทั้งหมดตลอดไปก็ยังเล็กกว่า dump รายวันหนึ่งไฟล์ (77 MB) หลายเท่า (§12 ข้อ 2)

### 6.4 cache — เทียบเลขการบันทึกทุกครั้งที่เรียก

- cache ในโปรเซส `{ revision, book }` + promise ที่กำลังโหลด (กันหลาย request โหลดซ้ำพร้อมกัน)
- ทุกครั้งที่เรียก: `SELECT max(id) FROM pricing_book_revisions` (อ่านจาก PK) — ตรงกัน = ใช้ cache · ไม่ตรง = โหลดใหม่ 2 query
  (หัวเล่ม 1 แถว + `pricing_models ORDER BY position, code` 13 แถว)
- **ทำไมไม่ invalidate แค่ในโปรเซส:** แอปเป็นโปรเซสเดียวก็จริง (§2) แต่ CLI นำเข้าเล่มเป็นอีกโปรเซส
  ⇒ ถ้า invalidate เฉพาะตอนเขียนในโปรเซส หน้าจอจะเห็นเล่มเก่าจนกว่าจะรีสตาร์ต · วิธีนี้คือของคู่กับ `statSync` ต่อ request ของเดิม
- **ห้าม import `services/rules/cache.ts`** — โมดูลนี้ต้องไม่พึ่งของระบบหลัก (README "การพึ่งพาเป็นทางเดียว") ⇒ เขียนตัวเล็กของตัวเอง
- **ไม่แก้ object ใน cache** — `withSubCodes()` คืนก้อนใหม่อยู่แล้ว (`bookStore.ts:87–88`) ด่าน `pricingLab.ts:154` เฝ้าข้อนี้อยู่
- ทางเขียนต้องไม่ตั้งต้นจาก cache ที่ไม่รู้ revision — `commitBookChange()` รับ `parent` ที่มากับ state ที่ใช้คำนวณเสมอ
  ถ้า state เก่า unique constraint จะปัดตก

### 6.5 ด่านโครงสร้างที่ประตูเก็บ (`services/pricingLab/modelShape.ts`)

`checkPriceModel(spec): string[]` — เป็น pure function เรียกจาก `commitBookChange`/`seedBook` ก่อน BEGIN
(ถ้ามีปัญหาก็ปฏิเสธทั้งการบันทึก) และจาก loader ตอนอ่าน (ข้ามรุ่นนั้น แล้วพิมพ์ลง log / `bookStatus` — แบบเดียวกับ `toStored()` ของรหัสย่อย)

**ตรวจเฉพาะรูป ไม่ตรวจกติกาธุรกิจ:**
- ชนิดของทุกช่อง · ตัวเลข finite · `base.kind`/`adder.kind`/`level`/`formula`/`round` อยู่ในรายการปิด
- `Predicate` ครบไวยากรณ์รวม `all/any/not` (**ต่างจาก `readWhen` โดยตั้งใจ**)
- `id` ของกฎไม่ซ้ำในรุ่นเดียวกัน · `spec.code === code`

กติกาธุรกิจ (ช่วงทับกัน · ของแถมราคาติดลบ ฯลฯ) ยังอยู่ที่ `modelEditor.ts` / `sheet.ts` ที่เดียว
⚠️ ตัวนี้คือ "คนที่สองที่รู้ไวยากรณ์ Predicate" ต่อจากตัวประเมินใน engine ⇒ ด่าน §8.2 ข้อ 12 ต้องพิสูจน์ว่า **รับทุกรุ่นของเล่มจริงโดยไม่ปฏิเสธผิด**

`schema_version` ≠ 1 → loader ข้ามรุ่นนั้นพร้อมเหตุผล (ไม่ป้อนเข้า engine)

---

## 7. ความเสี่ยงต่อระบบที่รันอยู่

| เรื่อง | คำตอบ |
| --- | --- |
| บอท LINE / ใบเสนอราคา | **ไม่พึ่งโมดูลนี้** (§2) · migration สร้างตารางใหม่ล้วน ไม่ล็อกตารางที่บอทใช้ |
| งบเวลา 48 วินาที (`BUDGET_MS`) | ไม่อยู่ในเส้น webhook · ของที่ใช้ event loop ร่วมกันคือ parse .xlsx ตอนอัป (มีอยู่แล้ว ไม่เพิ่ม) + `JSON.parse` 75 KB ตอนโหลด cache ใหม่ (ไม่ถึงมิลลิวินาที) |
| pool 40 ช่องใช้ร่วมกับ webhook | ทุก request ของหน้านี้ใช้ ≤ 1 ช่องแป๊บเดียว · เพิ่ม query ละ < 1 ms ต่อการคิดราคาหนึ่งครั้ง (เทียบหัวเล่ม) |
| `statement_timeout`/`query_timeout` 15 s | query ใหญ่สุดคือ `DISTINCT ON` บนประวัติที่มี index · เล่มแรก = 27 INSERT ⇒ ระดับ ms · ไม่ต้องใช้ `pg.Client` แยกเหมือน `refreshCustomerDirectory` |
| ขนาดข้อมูล | รุ่นใหญ่สุด 12,063 ไบต์ · ทั้งเล่ม 74,829 ไบต์ — ไกลจากเพดานทุกตัว |
| **`withTransaction()` เขตห้าม 4 อย่าง** | ① ห้าม `pool.query` ⇒ repo รับ `client` · **ห้ามเรียก `loadBookState()` ใน transaction** (มันใช้ pool) ให้ใช้ `readBookState(client)` ② ห้าม `res.json` ⇒ route ตอบหลังฟังก์ชันคืนค่า ③ ห้ามยิง network ⇒ โมดูลนี้ไม่มีอยู่แล้ว และ **`readUploaded()` (exceljs) ต้องจบก่อน BEGIN** ④ `enrichQuotationData` ไม่เกี่ยว |
| การพึ่งพาทางเดียวของโมดูล | `services/pricingLab/*` พึ่ง `config/db.ts` ผ่าน repo เท่านั้น · ห้าม import `quotationService`/`utils/pricing`/`services/rules` |
| ถอดโมดูล | เพิ่มในตาราง "ถอนออกยังไง" ของ README: `db/pricingBookRepo.ts` + `DROP TABLE pricing_model_history, pricing_models, pricing_book_revisions` |
| ราคาหลุด | ตารางใหม่ **ห้ามลงทะเบียนใน `services/externalSync.ts`** (ตารางที่ไม่อยู่ในทะเบียนตอบ 404 อยู่แล้ว) · ไม่มีอะไรไปอยู่ใน `public/` `data/` หรือ bundle |
| สำรอง/กู้ | ราคาเข้า dump ตีสามเองโดยอัตโนมัติ · ⚠️ `db:restore` จะพาราคาย้อนไปด้วย (สอดคล้องกัน ต้องบอกไว้ใน DEPLOY) |
| สิทธิ์ของตาราง | แอปใช้ superuser ⇒ `REVOKE UPDATE, DELETE` บนประวัติเป็นแค่ป้าย ไม่ใช่กำแพง · ของจริงคือ "ไม่มีโค้ดที่ UPDATE/DELETE" + ด่าน grep |

**กฎเหล็ก `AGENTS.md` B4 ที่งานนี้แตะ:** migration + `schema.sql` · ห้าม `COMMENT ON` · ข้อห้ามใน `withTransaction`
· parameterized ทุก query · `/api/admin/*` ผ่าน JWT (mount เดิม) · ด่านที่จบด้วย ROLLBACK ห้ามเปลี่ยนเป็น COMMIT (ด่านใหม่อยู่ในกลุ่มนี้)
· **ไม่แตะ:** LINE (push/replyToken/`express.json` global) · PDF · LIFF · `public/`

---

## 8. ด่านพิสูจน์

ไม่มีด่านในตาราง B5 ตัวไหนพิสูจน์ "ชั้นเก็บของสมุดราคาใน DB" ได้ ⇒ **ต้องให้ qa-tester เขียนตัวใหม่ (§8.2)**
และต้องแก้ของเดิมสามตัวที่เขียนฐานหรือดิสก์

### 8.1 ก่อน–หลัง (ด่านเดิมต้องได้ผลเท่าเดิม)

| ด่าน | ก่อน (วัด 2026-09-23 · เล่มจาก Excel · `db222be`) | หลัง (อ่านจากฐานหลังนำเข้าไฟล์ Excel ชุดเดียวกัน) |
| --- | --- | --- |
| `pricingGolden.ts` | 64/64 | **64/64** |
| `pricingRoundtrip.ts` | 30/30 | **30/30** |
| `pricingModelEdit.ts` | 33/33 | **33/33** |
| `pricingImport.ts` | 26/26 | **16/16** + อีก 10 ข้อย้ายไป `pricing-db` (§8.4) |
| `pricingLab.ts` | ยังไม่ได้วัด (เขียนฐาน) — วัดบนเครื่อง dev ก่อนแก้ | จำนวนเท่ากับ "ก่อน" · ข้อ 5 อยู่ใน ROLLBACK |
| `diag:pricing-coverage` | 80.1% (2026-09-21 · พื้น 75%) | ≥ 75% และเท่ากับค่าก่อนเมื่อวัดวันเดียวกัน |

⚠️ เมื่อแอดมินเริ่มแก้ราคาแล้ว golden อาจตกเพราะ "ราคาในสมุดไม่เท่าตัวอย่างในชีตแล้ว" ซึ่งไม่ใช่บั๊ก ⇒ `pricingBookSource`
ต้องพิมพ์ว่าใช้เล่ม `r<id>` ใครแก้ล่าสุด · และยังรัน `--source xlsx --data <dir>` เพื่อตรวจ engine บนตัวเลขของชีตได้เสมอ

### 8.2 ด่านใหม่ `npm run diag:pricing-db` (`scripts/diag/pricingDbRoundtrip.ts`)

**รูปแบบ:** อ่านเล่มปัจจุบันจากฐาน (SELECT) หรือจาก `--data`/`--from-json` → เปิด client → `BEGIN`
→ `CREATE TEMP TABLE pricing_* (LIKE public.pricing_* INCLUDING ALL) ON COMMIT DROP` (ตารางชั่วคราวบังตารางจริง
เพราะ `pg_temp` ถูกค้นก่อน) → ทำทุกข้อผ่าน **ฟังก์ชันเดียวกับที่แอปใช้** โดยส่ง client เข้าไป → **`ROLLBACK` ใน `finally` เสมอ**
⇒ ไม่มีอะไรลงตารางจริง และไม่กินเลข sequence จริง (IDENTITY ได้ sequence ของตัวเอง) · ฆ่ากลางคัน = Postgres rollback ให้เอง
⇒ อยู่กลุ่ม "เขียนแล้ว ROLLBACK" ของ B2 **รันบน PMSV ได้**

| # | ข้อ | ทำไม |
| --- | --- | --- |
| 0 | `to_regclass('pricing_models')::text` ต้องขึ้นต้นด้วย `pg_temp` **ไม่งั้นหยุดก่อนเขียน** | ถ้าวันหนึ่งมีคนใส่ `public.` ใน SQL ของ repo ด่านจะเผลอไปเขียนตารางจริง |
| 1 | เขียนเล่ม → อ่านกลับ → `JSON.stringify(x, null, 2)` **เท่ากันทุกไบต์** (ลำดับรุ่น · ลำดับคีย์ · ฟิลด์ระดับเล่ม) | คำถามหลักของงานนี้ |
| 2 | เทียบรายรุ่น บอกชื่อรุ่นที่ต่าง | ล้มแล้วรู้ทันทีว่าที่ไหน |
| 3 | `bookToSheets(อ่านกลับ)` เท่ากับ `bookToSheets(ต้นฉบับ)` | ตรงกับอาการใน §3.1 |
| 4 | ราคาเท่ากัน: `parseProductCode`+`computePrice` ผลเท่ากันทุกรหัสของ `fixtures/pricingCases.json` + `SELECT DISTINCT model FROM products` (อ่านอย่างเดียว) · **จำนวนรหัสที่ตรวจต้อง > 0** | "ตรวจ 0 รหัส" แปลว่าผ่านแบบว่างเปล่า ต้องนับเป็นล้ม |
| 5 | **ชุดควบคุมกลับด้าน:** สำเนาที่สลับลำดับแบบ jsonb ต้อง**ล้ม**ข้อ 1 และ 3 | พิสูจน์ว่าด่านจับสิ่งที่ด่านเดิมจับไม่ได้ (§2) |
| 6 | แก้ทีละรุ่น (`applyModelEdit` บนรุ่น BH) → การบันทึกใหม่มี parent ถูก · ประวัติ 1 แถว · **รุ่นอื่นเท่าเดิมทุกไบต์** · `version` ไม่ขยับ | กติกาของ `PUT` |
| 7 | token เก่า → `BookConflict` · INSERT parent ซ้ำ → `BookConflict` · นำเข้าเล่มแรกซ้ำ → ปฏิเสธ | §6.2 |
| 8 | อัปแม่แบบที่แก้ 1 ช่องของรุ่น A และติ๊ก A เท่านั้น → A เปลี่ยน · รุ่นที่ไม่ติ๊กเท่าเดิมทุกไบต์ · `edited.by` ถูก | กติกาข้อ 1–2 ของหน้าจอ |
| 9 | ย้อนไปเล่มแรก → เล่มเท่ากับตอนเริ่มทุกไบต์ · `edited` = null · ประวัติ**เพิ่ม ไม่ลด** · ย้อนอีกครั้ง → กลับไปเป็นผลของข้อ 8 | สัญญา "ย้อนผิดก็ย้อนกลับได้" |
| 10 | ย้อนไป id ที่ไม่มี / ย้อนไปหัวเล่ม → ปฏิเสธ ไม่มีแถวใหม่ | แทน "ย้อนไปเล่มที่ไม่มีแล้ว" + "ชื่อพาออกนอกโฟลเดอร์" |
| 11 | อัปรุ่นใหม่ Z แล้วย้อน → Z หายจาก `pricing_models` (ประวัติ `spec NULL`) · ย้อนกลับ → Z กลับมาที่ `position` เดิม | ทางเดียวที่รุ่นหายได้ |
| 12 | `checkPriceModel` รับทุกรุ่นของเล่มจริง · ปฏิเสธ spec ที่ `code` ไม่ตรง / ตัวเลข `NaN` / `kind` แปลก · แถวเสียที่ INSERT ตรงด้วย SQL ถูก loader ข้ามแล้วรายงาน | §6.5 |
| 13 | grep ซอร์สของ repo: `UPDATE pricing_model_history` / `DELETE FROM pricing_model_history` / `… pricing_book_revisions` = **0** | "เขียนต่อท้ายอย่างเดียว" ต้องเป็นข้อเท็จจริง ไม่ใช่ความตั้งใจ |
| 14 | cache: เรียกซ้ำไม่โหลดใหม่ · มีการบันทึกจาก "อีกโปรเซส" (INSERT ตรงใน session) → โหลดใหม่ | §6.4 |
| 15 | หลัง ROLLBACK: `count(*)` ของ `public.pricing_*` เท่ากับก่อนเริ่ม (อ่านด้วย connection อื่น) | พิสูจน์ว่าไม่แตะของจริง |

### 8.3 แก้ `diag:pricing` ให้ไม่เขียนฐานจริง

`scripts/diag/pricingLab.ts:144` เรียก `upsertSubCode({ subCode: 'BU', scope: 'TS-14' })` ซึ่ง `ON CONFLICT … DO UPDATE`
(`pricingLabRepo.ts:137–138`) **แล้วคืน id ของแถวจริงถ้ามีอยู่ก่อน** จากนั้น `finally` ลบด้วย id นั้น (`:166`)
⇒ วันที่แอดมินตั้งค่า `-BU` ของ TS-14 (รหัสย่อยที่เจอบ่อยอันดับสอง — 1,856 รหัส) การรันด่านนี้บนฐานจริง
**จะเขียนทับค่าของเขาแล้วลบทิ้ง** · วันนี้ยังไม่เสียหายเพราะตารางว่าง (0 แถว วัด 2026-09-23)

**ทางแก้:** ข้อ 5 ทั้งข้อทำใน `BEGIN … ROLLBACK` ผ่าน client (repo รับ executor ตาม §5.1) · ใช้ตารางจริงได้เพราะ ROLLBACK
คืนแถวของแอดมินให้เอง (ถือ row lock ไม่ถึงวินาที) · id ของ `pricing_subcodes` (BIGSERIAL) อาจกระโดดเพราะ sequence ไม่ rollback
แต่ไม่มีผลกับข้อมูล · แล้วเอาสองบรรทัด `cleanupTestRows()` ออกเพราะไม่ต้องใช้แล้ว

### 8.4 ข้อของ `pricingImport.ts` ที่ผูกกับดิสก์ → ข้อใน `pricing-db`

| เดิม (`pricingImport.ts`) | ใหม่ (`pricing-db`) |
| --- | --- |
| บันทึก 5 รอบแล้วเหลือเล่มสำรอง 3 เล่ม · เรียงใหม่ไปเก่า | `listRestorable(3)` คืน 3 รายการ เรียง id มากไปน้อย (ประวัติไม่ถูกตัด) |
| ลายนิ้วมือเปลี่ยนหลังบันทึก | token เปลี่ยนหลังบันทึก (ข้อ 6) |
| ย้อนได้ · ย้อนแล้วเปลี่ยนจริง · เล่มปัจจุบันถูกเก็บไว้ย้อนกลับ | ข้อ 9 |
| ย้อนไปเล่มที่ไม่มีแล้ว → ปฏิเสธ · ชื่อพาออกนอกโฟลเดอร์ → ปฏิเสธ | ข้อ 10 (`rev-<ตัวเลข>` เท่านั้น) |
| เล่มที่ย้อนมาอ่านได้และรุ่นครบ | ข้อ 9 |
| `book.json` ของจริงไม่ถูกแตะ | ข้อ 15 |

### 8.5 `diag:pb-ui` (เปิดหน้าจริงกดจริง)

หลังย้าย ปุ่มบนจอเขียน**ฐานที่เซิร์ฟเวอร์ต่ออยู่** ไม่ใช่ไฟล์ใน cwd ⇒ ด่านกันเครื่องแบบเดิม (ดูว่าเซิร์ฟเวอร์อยู่ใต้ `.claude/worktrees/`)
**กันไม่ได้แล้ว** เพราะเซิร์ฟเวอร์ใน worktree บน PMSV ต่อฐานจริง ⇒ เปลี่ยนเป็นแบบของ `scripts/dev/seedPhaseH.ts`:
`PG_HOST` เป็น localhost · `NODE_ENV ≠ production` · และต้องตั้ง `PB_UI_WRITE_OK=1` เอง
(ในกล่อง prod `PG_HOST=db` `NODE_ENV=production` จึงโดนกันสองชั้น) · สถานะสุดท้ายอ่านจากฐาน
· **รันบนเครื่อง dev เท่านั้น** · สคริปต์ `mockup/_pl-*.mjs` (git-ignore ไว้) ก็เขียนฐานผ่าน API เหมือนกัน

### 8.6 ด่านพื้นของทุกเฟส

- `npx tsc --noEmit` — บน PMSV ต้องรันในคอนเทนเนอร์:
  ```bash
  docker run --rm -v "$PWD":/src:ro --entrypoint sh primus-chatbot-app -c \
    'cp -r /src /work && cd /work && ln -s /app/node_modules node_modules && ./node_modules/.bin/tsc --noEmit; echo EXIT=$?'
  ```
- ด่านที่ต่อฐานก่อน deploy บน PMSV: `git archive HEAD | docker exec -i primus-chatbot-app-1 tar -x -C /tmp/<ชื่อ>` + symlink `node_modules`
  · **ห้าม `pkill -f 'tsx index.ts'`** · ลบ `/tmp/<ชื่อ>` เมื่อเสร็จ
- `npm --prefix frontend run build`/`lint` — **ไม่ต้อง** เพราะไม่แตะ frontend (ถ้าจำเป็นต้องแตะเมื่อไหร่ แปลว่ารูปของ API เปลี่ยน ⇒ กลับมาทบทวนแผน)
- `npm run diag:migrations` (บน host) หลังรัน migration

---

## 9. เฟส — แต่ละเฟส deploy ได้เองและถอยได้

| เฟส | ทำอะไร | ด่าน | ถอยยังไง |
| --- | --- | --- | --- |
| **0** | กันไฟล์ราคาเข้า image/git ซ้ำ: `.gitignore` เพิ่ม `*.xlsx` (วันนี้ไม่มี `.xlsx` ที่ track อยู่แล้ว) · `.dockerignore` เพิ่ม `*.xlsx` `/pricebook` `.claude/worktrees` · `xlsx.ts` ไม่เขียนไฟล์ลง `scripts/pricebook/` เป็นค่าตั้งต้น | หลัง deploy ขอไฟล์ Excel เดิมใต้ `/data/` ผ่านโดเมนจริงด้วย `curl -4 -sI` ต้องได้ **404** · `git check-ignore -v "scripts/pricebook/x.xlsx"` ต้องติด | revert |
| **1** | migration §4.1 + ยุบเข้า `schema.sql` | `diag:migrations` ✅ · วิธีตรวจที่หัว `schema.sql` (dev) | `DROP TABLE pricing_model_history, pricing_models, pricing_book_revisions;` (ยังว่างอยู่) |
| **2** | โค้ด §5.1 ทั้งชุด + ด่าน §8 + เอกสาร §10 ใน**คอมมิตเดียวกับโค้ด** · loader ทนตารางที่ยังไม่มี (`42P01` → "ยังไม่มีสมุด") ⇒ **ลำดับเฟส 1/2 สลับกันได้** | §8.1–8.6 บนเครื่อง dev หลังนำเข้าเล่มในฐาน dev · `diag:pricing-db` ในกล่องจาก `/tmp` บน PMSV | deploy image ก่อนหน้า (prune เก็บไว้ 24 ชม.) — โค้ดเก่าตอบ "ยังไม่มีสมุดราคา" เท่ากับวันนี้ · แถวในฐานไม่ถูกแตะ |
| **2.5** (dev) | เครื่อง dev ที่มี `pricebook/book.json` อยู่: `importer --from-json pricebook/book.json --apply` (เก็บที่แก้ไว้ · ข้อ 1 ของ §8.2 ต้องเท่ากับไฟล์ทุกไบต์) · `backups/` เดิมไม่ย้าย | `diag:pricing-db --from-json pricebook/book.json` | `TRUNCATE` สามตารางบนฐาน dev |
| **3** (PMSV) | นำเข้าเล่มแรก — **ต้องได้คำสั่งเจ้าของ** (B2) · runbook §9.1 | §9.1 ขั้น 5 | `TRUNCATE pricing_model_history, pricing_models, pricing_book_revisions;` (หลัง dump) |
| **4** (ทางเลือก) | ตามคำตอบ §12: token ระดับรุ่น · ปุ่มย้อนรายรุ่น · ข้อความบนจอ | ตามงาน | ตามงาน |

### 9.1 นำเข้าเล่มแรกบน PMSV (อิง `DEPLOY.md` ขั้น 2, 4, 5)

ไฟล์ Excel อยู่ที่ `backup/` บน host ซึ่ง `.dockerignore` กันไว้ ⇒ image ไม่มีไฟล์นี้ **โดยตั้งใจ**
ใช้คอนเทนเนอร์ครั้งเดียว (`run --rm`) ที่เห็นโฟลเดอร์นั้นแบบอ่านอย่างเดียว ⇒ ไม่มีสำเนาค้างในกล่องที่รันอยู่

```bash
cd /home/app_sales/salechatbot/chatbot
set -a; source .env; set +a
# 1. สำรองก่อน (DEPLOY ขั้น 2)
docker compose exec -T db pg_dump -U "$PG_USER" -d "$PG_DATABASE" -Fc > backup-$(date +%F-%H%M)-before-pricebook.dump
# 2. migration (ถ้ายังไม่ได้รันในเฟส 1) — รันได้ทุกเวลา ไม่ล็อกตารางเดิม
docker compose exec -T db psql -U "$PG_USER" -d "$PG_DATABASE" -v ON_ERROR_STOP=1 -f - < migrations/changes/2026-09-XX_01_pricing_book_db.sql
npm run diag:migrations
# 3. ดูรายงานก่อน (ไม่เขียนอะไร) — ต้องได้ 13 รุ่น 11 ชีต ตาม §2
docker compose run --rm --no-deps -v "$PWD/backup:/seed:ro" app \
  npx tsx scripts/pricebook/importer.ts --data /seed
# 4. เขียนจริง
docker compose run --rm --no-deps -v "$PWD/backup:/seed:ro" app \
  npx tsx scripts/pricebook/importer.ts --data /seed --apply --by <username ของเจ้าของ>
# 5. ตรวจ
docker compose exec app npx tsx scripts/diag/pricingDbRoundtrip.ts
docker compose exec app npm run diag:pricing          # หลังแก้ §8.3 แล้วเท่านั้น
docker compose exec app npm run diag:pricing-coverage # ≥ 75%
```

แล้วเปิดหน้า "คิดราคาสินค้า" การ์ดต้องขึ้น 13 รุ่น และคิดราคา `TSK-14 6x200+150-BU` ได้ (เฉลยของชีต)
· เช้าวันถัดไป `npm run diag:backup -- --deep` ต้องเห็นตาราง `pricing_*` ใน TOC ของ dump

ตัวคอนเทนเนอร์ครั้งเดียวเห็น `backup/` ทั้งโฟลเดอร์ (รวม dump) แบบอ่านอย่างเดียวแล้วจบไป
ถ้าไม่อยากให้เห็น dump: `install -d -m 700 /tmp/pbseed && cp backup/*.xlsx /tmp/pbseed/` → mount `/tmp/pbseed` → `rm -rf /tmp/pbseed`

---

## 10. เอกสารที่ต้องแก้ (คอมมิตเดียวกับโค้ดเฟส 2)

| ไฟล์ | จุด |
| --- | --- |
| `services/pricingLab/README.md` | §"สมุดราคาอยู่ที่ไหน" (:37–47 — ตัดวิธี `scp`) · กติกาข้อ 3 (:96–97 เล่มสำรองอยู่ในฐาน) · :135–138 (`data/` + `pricebook:import` → `--data` + `--apply`) · ตารางไฟล์ (:150–152 + `modelShape.ts`) · ตารางด่าน (:162–169 เลิกพูดถึง `book.json` + แถว `diag:pricing-db` + ด่านกันเครื่องใหม่ของ `pb-ui`) · ตาราง "ถอนออกยังไง" (+ repo ใหม่ + DROP สามตาราง) · ":193 14 รุ่น" → 13 |
| หัวไฟล์ `bookStore.ts` `bookUpdate.ts` `routes/pricingLab.ts` `importer.ts` `xlsx.ts` | เขียนเหตุผลใหม่ในรูปแบบเดิม ("ทางที่ไม่ได้เลือก" ยกจาก §11) |
| `docs/guide-pricebook-admin.md` | :117–120 "เก็บเล่มเก่า 3 เล่ม" (ตามคำตอบ §12 ข้อ 2) · FAQ "จะทับกันไหม" (ตาม §12 ข้อ 7) |
| `CLAUDE.md` | :459 คอมเมนต์ต้นไม้ (`→ ฐานข้อมูล ไม่ใช่ pricebook/book.json`) · :517 บรรทัดดัชนี |
| `AGENTS.md` | B5 :592–594 (เลิกพูดถึง `book.json` · golden 62→64 · roundtrip 26→30 · แถวใหม่ `diag:pricing-db`) · B2 ตารางกลุ่ม ROLLBACK: เพิ่ม `pricingDbRoundtrip` + `pricingLab` (หลังแก้) · B4 บรรทัด "`*Smoke.ts` ที่จบด้วย ROLLBACK ห้ามเปลี่ยนเป็น COMMIT" ให้ครอบสองตัวนี้ด้วย |
| `DEPLOY.md` | เพิ่ม migration ในรายการ "ข้อยกเว้น: รันได้ทุกเวลา" · เพิ่ม `to_regclass('public.pricing_models') AS pricing_models` ในคำสั่งตรวจขั้น 4 · ขั้นใหม่ "4.11 นำเข้าสมุดราคาเล่มแรก (ครั้งเดียวต่อ DB)" = §9.1 · 6.3 เพิ่ม `pricingDbRoundtrip.ts` · หมายเหตุ `db:restore` พาราคาย้อนด้วย |
| `docs/plan-pricing-subcodes.md` | §7.3 แถว "เก็บเล่มเก่ากี่เล่ม — `pricebook/backups/`" → หมายเหตุว่าแทนด้วยแผนนี้ |
| `.gitignore:60–69` | คงบรรทัด `/pricebook/` ไว้กันไฟล์ `--out` หลุด แต่เขียนคอมเมนต์ใหม่ |

---

## 11. ทางที่ไม่ได้เลือก

1. **เพิ่ม volume ให้ `pricebook/`** — แก้เร็วที่สุดสำหรับอาการ rebuild แต่ไม่เข้าสำรองอัตโนมัติ ไม่มี transaction
   ช่องทับกันเดิมยังอยู่ และ dev/prod ยังเป็นสองเล่ม · เจ้าของเลือก DB แล้ว
2. **jsonb** — สลับลำดับคีย์ (§3.1, พิสูจน์แล้ว) ⇒ `json`
3. **แตกเป็นตาราง relational / ตารางต่อ series / EAV** — เจ้าของปัดตก · engine รับ `PriceModel` ทั้งก้อนอยู่แล้ว
4. **ทั้งเล่มเป็นแถวเดียว** — ง่ายสุด แต่ประวัติและ token ต้องหยาบระดับเล่มตลอดไป · เจ้าของเลือกแถวละรุ่น
5. **`updated_at` เป็น token** — เวลา JS ละเอียดแค่ ms ส่วน PG ละเอียด µs · ⇒ ใช้ revision chain + UNIQUE
6. **advisory lock** — `logworker` ใช้ key ของตัวเองอยู่แล้ว และ constraint อธิบายตัวเองได้ดีกว่า
7. **LISTEN/NOTIFY ล้าง cache** — ต้องมี connection ถาวรนอก pool + จัดการตอนหลุด · เทียบหัวเล่มต่อ request ครอบ CLI ได้โดยไม่มีสถานะเพิ่ม
8. **cache แบบ TTL ของ `services/rules/cache.ts`** — มีช่วงที่ค้างอยู่ + ทำให้โมดูลต้องพึ่งของระบบหลัก
9. **ประวัติเก็บเป็นส่วนต่าง (patch)** — ประหยัดที่แต่การย้อนต้องเล่นซ้ำ · snapshot ≤ 75 KB ต่อครั้งจึงไม่คุ้มที่จะซับซ้อน
10. **สวิตช์ `PRICEBOOK_STORE=file|db`** — เป็นความจริงสองแหล่ง · prod ไม่มีไฟล์ให้ถอยไปหาอยู่แล้ว
11. **คัด Excel เข้า `/tmp` ของกล่องที่รันอยู่แล้วนำเข้า** — ลืมลบเมื่อไหร่ก็ค้างอยู่ในกล่อง production · `run --rm` + ro mount ไม่ทิ้งอะไรไว้
12. **ย้าย `subCodes` ระดับเล่ม (1 แถว) ไปไว้ใน `pricing_subcodes`** — เปลี่ยนความหมาย (`clean()` ตีธง `custom=true` · หน้าจอแยก `fromPriceFile`)
13. **เปิดให้หน้าจอบูตเล่มแรกด้วยการอัปแม่แบบ** — แม่แบบเกิดจากเล่มที่มีอยู่ ส่วนไฟล์ Excel ต้นทางต้องอ่านผ่านไฟล์ map ⇒ เล่มแรกต้องมาทาง CLI

---

## 12. คำถามให้เจ้าของตัดสิน (**ตัวหนา** = ที่แนะนำ)

| # | คำถาม | ตัวเลือก | บล็อกเฟส |
| --- | --- | --- | --- |
| 1 | คอลัมน์ `spec` เป็นชนิดไหน | **`json` — เก็บทุกไบต์ แม่แบบ/ช่องเลือกเรียงเหมือนเดิม** · `jsonb` ตามที่เห็นชอบไว้ (แม่แบบเรียงใหม่ 16/22 ชีต · ช่องเลือก 21 รายการเปลี่ยนลำดับ · ราคาไม่เปลี่ยน) | 1 |
| 2 | เก็บประวัตินานแค่ไหน | **เก็บทุกครั้งตลอดไป (≤ 75 KB ต่อการอัปทั้งเล่ม) · จอยังโชว์ให้ย้อนได้ 3 เล่มล่าสุดเหมือนเดิม** · ตัดเหลือ N ครั้ง (ต้องมีโค้ด DELETE ⇒ ขัดกับ "เขียนต่อท้ายอย่างเดียว") | 2 |
| 3 | ใครกดย้อนเล่มได้ | **`page.pricing` เดิม (เจ้าของเคาะไว้ 2026-09-21 · การย้อนก็ย้อนกลับได้)** · ช่องสิทธิ์ใหม่ `pricing.restore` (+1 ช่องใน capabilities + `diag:role-permissions`) | 2 |
| 4 | เก็บไฟล์ Excel ต้นฉบับ/ไฟล์ที่อัปไว้ในฐานไหม | **เก็บแค่ชื่อ + sha256 + ขนาด (`source_files`) · ตัวไฟล์อยู่ที่ `backup/` บน host** · เก็บไบต์ในตาราง `pricing_source_files` (กู้จากฐานได้ที่เดียว แต่ dump โตขึ้นราว 1.2 MB ต่อชุด) | 2 |
| 5 | คอลัมน์ `series` | **ยังไม่ใส่จนกว่าจะมีจอที่ใช้** · ใส่เป็น `GENERATED ALWAYS AS (split_part(code,'-',1)) STORED` (ได้ BH / TSK / TS / TSP) · ถ้าตั้งใจให้เป็น "BH กับ TS" ต้องบอกกติกา | 1 |
| 6 | การ์ดบนจอหลังกดย้อน | **แสดงสถานะของเล่มที่ย้อนไป (เหมือนวันนี้ · `pb-ui` เช็กข้อนี้)** · แสดง "ย้อนโดย X เมื่อ Y" (ต้องแก้ถ้อยคำบนจอ ⇒ A9) | 2 |
| 7 | token กันทับ | **ระดับเล่มเหมือนเดิมในเฟส 2** แล้วค่อยพิจารณา · ระดับรุ่น (แก้ BH-01 ไม่ทำให้คนที่เปิด TSK-04 ค้างไว้โดน 409) | 4 |
| 8 | บังคับให้ส่ง `fingerprint` | **บังคับ (หน้าจอส่งอยู่แล้วทุกครั้ง · ไม่ส่ง = 400)** · คงแบบเดิมที่ไม่ส่งก็ข้ามด่าน | 2 |
| 9 | ข้อความบนจอตอนยังไม่มีสมุด (แทน "สร้างด้วย npm run pricebook:import …") | **"ยังไม่มีสมุดราคาในระบบ — ให้ผู้ดูแลระบบนำเข้าเล่มแรก"** · ข้อความอื่น | 2 |
| 10 | นำเข้าจาก Excel ทับเล่มที่มีอยู่ (`--replace-all`) | **แทนทุกรุ่นด้วยของจาก Excel เป็นการบันทึกหนึ่งครั้งที่ย้อนได้ (วันนี้ทับแล้วย้อนไม่ได้)** · รวมเฉพาะรุ่นใน Excel แบบเดียวกับหน้าจอ · ข้ามรุ่นที่มีกฎที่แอดมินเพิ่มเอง (`custom`) | 3 |
| 11 | ถอด `pricebook:xlsx -- import --save` | **ถอด — ให้เหลือทางเขียนสองทาง (หน้าจอ · `importer --apply`)** · เก็บไว้แต่เปลี่ยนให้เรียก `commitBookChange` แบบรวมรายรุ่น | 2 |
| 12 | ปุ่ม "ย้อนเฉพาะรุ่นนี้" ในหน้าแก้ราคา | **ยังไม่ทำ (ข้อมูลรองรับแล้ว)** · ทำในเฟส 4 (UI ใหม่ ⇒ mockup ก่อนตาม A9) | 4 |
| 13 | ใครเป็นคนรันเฟส 3 บน PMSV และเมื่อไหร่ | เจ้าของสั่ง · **ช่วง 20:00–06:00 ตาม DEPLOY** (จริง ๆ แล้วไม่กระทบบอท แต่ใช้ช่วงเดียวกับ deploy เฟส 2) | 3 |
