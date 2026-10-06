# โมดูล "แบบ 3 มิติ" — ถอดออกได้ทั้งก้อน

สร้างโมเดล 3 มิติของสินค้าสั่งทำจากพารามิเตอร์ตามแคตตาล็อก แล้วเขียนเป็นไฟล์ STEP (ส่งลูกค้า/เปิดใน CAD)
แผนรวมและเหตุผลทั้งหมด: `docs/plan-product-drawing-3d.md`

**สถานะ (2026-10-06): เฟส 0 — หลังบ้านล้วน** ไม่มีหน้าจอ ไม่มี route ไม่มีตาราง · ยังไม่มีใครในระบบเรียกโมดูลนี้
นอกจากด่านใน `scripts/diag/` · เฟส 1 จะต่อเข้าหน้าคำนวณราคาผ่านการฉีดที่ `index.ts` (แผน §4.3)

---

## ถอนออกยังไง

| ลบ | อะไร |
| --- | --- |
| `services/drawing/` | โฟลเดอร์นี้ |
| `scripts/diag/drawingPort.ts` | ด่านเทียบกับต้นฉบับ Appsale |
| 1 บรรทัดใน `package.json` | `diag:drawing-port` |

**สิ่งที่ทำให้ตารางนี้จริง: การพึ่งพาเป็นทางเดียว** — ไม่มีโค้ดเดิมตัวไหน import โฟลเดอร์นี้ และโฟลเดอร์นี้
**ไม่ import** `services/pricingLab/` · `routes/` · `pdfGenerator.ts` · `puppeteer` (ผลอ่านรหัสของหน้าคำนวณราคา
เข้ามาเป็น type ที่ประกาศเองใน `types.ts` · เฟส 1 ฉีดตัวคิดราคาและฟังก์ชันพิมพ์เข้ามาที่ `index.ts`)

## ทิศการพึ่งพาภายใน

```
types.ts  ←  geometry/tsPrimitives.ts  ←  families/tsParts.ts  ←  families/ts-11.ts  ←  families/registry.ts
                                                                                        ↑
writers/step.ts  (รับ StepSolid[] — ไม่รู้จักตระกูล)                                      ด่าน / เฟส 1
```

`registry.ts` คือทางเดียวที่ส่วนอื่นได้โมเดล (`buildModel(spec)`) · type ของ `FAMILIES` ผูกกับ union `DrawingSpec`
⇒ เพิ่มตระกูลใน union แล้วลืมลงทะเบียน = typecheck ล้ม

## ที่มา — พอร์ตจาก Appsale

ต้นแบบ: รีโป Appsale (`/home/app_sales/Appsale` · `frontend/public/heater-app/`) คอมมิต
**`4dd24756282d5be91ba98bf607ddfd71dad2acaa`** (2026-10-02 · คอมมิตล่าสุดที่แตะ heater-app)

หลังพอร์ต **chatbot เป็นเจ้าของโค้ดชุดนี้** (หัวหน้าเคาะ 2026-10-06) — ไม่ดึงของใหม่จาก Appsale · ไม่เรียก Appsale
ขณะรัน · รีโป Appsale ใช้แค่ในด่าน `diag:drawing-port` (`git archive` ลงโฟลเดอร์ชั่วคราว ไม่ checkout ไม่แตกลงรีโปนี้)

**กติกาการพอร์ต: ทีละบรรทัด ห้ามจัดนิพจน์ใหม่** — ด่านเทียบทุกบิตของทศนิยม · ห้ามเปลี่ยน `Math.hypot(...v)` เป็น
sqrt · ห้ามสลับลำดับบวก/คูณ · ห้ามรวมชุดฟังก์ชันพื้นฐานของ TS (`unit = x/n`) กับของ BH (`x*(1/n)`) ·
ใน STEP ลำดับการเรียก `add()` คือเลข `#id` ของทั้งไฟล์

### ตารางพอร์ตรายตระกูล

| ตระกูล | ไฟล์ต้นทาง (ที่ `4dd2475`) | สถานะ | ด่านครอบ |
| --- | --- | --- | --- |
| TS_-11 | `products/ts-11-model.js` (`BUILDERS['11']`) · `ts-series-model.js` · `ts-series-parts.js` · `cableRadius` ของ `ts-series-assembly.js` · จำนวนสายจาก `ts-11.js`/`ts-common.js` | **exact** — ทุกชิ้น + STEP ตรงต้นฉบับทุกไบต์ | `diag:drawing-port` |
| writers/step | `engine/step.js` `colouredStep` (ทางสามเหลี่ยม) | **exact** ยกเว้นบรรทัด FILE_NAME (ชื่อระบบ "Primus Quotation System" · เวลา) | `diag:drawing-port` |

`exact` = ยังเหมือนต้นฉบับทุกไบต์และด่านยังครอบ · `improved` = ปรับปรุงโดยตั้งใจแล้ว (ต้องถอดออกจากด่าน port
ในคอมมิตเดียวกับการปรับ พร้อมตัวเลขก่อน/หลัง)

### ที่ไม่ได้ยกมา (และทำไม)

- **ตัวอ่านรหัสของ Appsale** (`parse`/`build`/`code.js`) — แบบรับผลอ่านของหน้าคำนวณราคาแทน (แผน §2.5 ข้อ 1)
- **ภาพ 2 มิติ/กระดาษแบบ** (`*-drawing.js` · `sheet.js` · `cad-camera.js` · `symbols.js` · `draw.js`) — เฟส 1
  (`symbols.js`/`draw.js` เป็นงาน 2D ทั้งหมด ไม่ใช่ geometry ของโมเดล)
- **`solids.js`** — TS_-11 ไม่ได้ใช้ (BH-02/03 ใช้ · เฟส 1)
- **TS_-11L และ TS-12 ที่อยู่ไฟล์เดียวกับ TS_-11** — หน้าคำนวณราคาไม่มีตาราง TS_-11L (อ่านรหัส 11L/LP/LPS
  เป็น TS_-11 + `headJunk`) · TS-12 ของ Appsale ตรงกับ TS_-12R ของหน้าคำนวณราคา ไม่ใช่ TS_-12
- **`head()` หัวกะโหลกจาก CAD** — import mesh ~15 MB ทั้งก้อน ⇒ ทำพร้อมตัวแปลง mesh เป็นไบนารีในเฟส 1
- `assemble`/`tailAnchors` (จุดยึดเส้นบอกขนาด 2D) · cache ระดับโมดูล

## ด่าน

| ด่าน | พิสูจน์อะไร | ฐาน |
| --- | --- | --- |
| `npm run diag:drawing-port` | ค่าชุดเดียวกันเข้าโมดูลเรากับต้นฉบับ Appsale ที่คอมมิตต้นแบบ → ทุกชิ้น (ชื่อ/สี/positions/normals/triangles/edges) `Object.is` ทีละตัว + STEP ทั้งไฟล์ (ยกเว้น FILE_NAME) · ไม่มีรีโป/คอมมิต = **ตอบไม่ได้ exit 1** · `-- --quick` ไม่แตะฐาน | SELECT อย่างเดียว (READ ONLY + statement_timeout) · เขียนแค่ tmpdir แล้วลบ |

ผลวัด 2026-10-06 (`diag:drawing-port` เต็ม): TS_-11 รหัสจริงที่ตัวอ่าน Appsale อ่านผ่าน 2,378 + ค่าเริ่มต้น/ตัวอย่าง/สังเคราะห์
→ รูปทรงไม่ซ้ำ **814 ชุด ตรงทุกไบต์** (13,078 ชิ้น · STEP 1.01 GB) ~110 วิ
