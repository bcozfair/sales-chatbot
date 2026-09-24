# พรีวิวร่วมบนเครื่อง PMSV — ดูโค้ดล่าสุดก่อน deploy ที่ `localhost:5180`

> เจ้าของสั่ง 2026-09-24: *"พรีวิวตอน dev ก่อน deploy บนเครื่อง PMSV ให้ใช้พอร์ตทดสอบเดียวกัน
> ทุก session เห็นได้ทั้ง backend และ frontend ตรงกับ code ล่าสุด เปลี่ยนทันทีเมื่อ code เปลี่ยน
> ไม่ต้อง refresh"*

## สรุปสั้น

| | |
| --- | --- |
| ลิงก์ | **`http://localhost:5180/admin.html`** (เปิดผ่าน port forwarding ของ VSCode — ลิงก์ IP วงแลนเปิดไม่ได้) |
| รันโค้ดจาก | working tree หลัก **`/home/app_sales/salechatbot/chatbot` (= main)** |
| แก้หน้าจอ (`frontend/src`) | จอเปลี่ยนเองทันที (Vite HMR) — state บนจอยังอยู่ |
| แก้ backend (`*.ts` นอก frontend) | กล่อง api รีสตาร์ตเอง (`tsx watch`) ขึ้นเสร็จแล้ว **หน้าเว็บรีโหลดเอง** ไม่ต้องกด |
| ฐานข้อมูล | **ตัวจริง** — ฐานเดียวบนเครื่องนี้ (ดู "ข้อควรระวัง") |
| ไฟล์ | `docker-compose.preview.yml` · `scripts/preview/vite.config.mjs` · `PREVIEW_MODE` ใน `index.ts` |

```bash
cd /home/app_sales/salechatbot/chatbot          # ต้องเป็นทรีหลักเท่านั้น
docker compose -f docker-compose.preview.yml up -d            # เปิด (ค้างไว้ถาวร · รีบูตแล้วขึ้นเอง)
docker compose -f docker-compose.preview.yml ps
docker compose -f docker-compose.preview.yml logs -f api      # log ของ backend พรีวิว
docker compose -f docker-compose.preview.yml logs -f web      # log ของ Vite
docker compose -f docker-compose.preview.yml down             # ปิด (ไม่แตะตัวจริง)
```

## ทำไมถึงเป็น "main" ไม่ใช่ worktree ของแต่ละ session

ทุก session ทำงานใน worktree ของตัวเองแล้ว merge เข้า main เองได้โดยไม่ต้องถาม (กติกาเจ้าของ
2026-09-03) ⇒ **"โค้ดล่าสุดก่อน deploy" = main** และ merge เมื่อไหร่พรีวิวเปลี่ยนตามทันที
โดยไม่มีใครต้องสั่งอะไร

ทางที่ไม่ได้เลือก: ให้แต่ละ session ชี้ 5180 ไปที่ worktree ของตัวเอง — เกิดมาแล้ว 2026-09-24
session หนึ่งเปิด Vite+backend ชั่วคราวค้างไว้ อีก session ต้องฆ่าทิ้งเพื่อแย่งพอร์ต และ backend
ชั่วคราวตัวนั้นรัน auto sync ซ้อนกับตัวจริงอยู่ครึ่งวันโดยไม่มีใครรู้

⇒ **session ไหนอยากให้เจ้าของดูงาน = merge เข้า main** แล้วส่งลิงก์ 5180
งานที่ยังไม่พร้อม merge ให้ทำ mockup ที่ 5174 ตาม `docs/design.md` แทน

## ห้าม

- **ห้ามเปิด Vite / backend ชั่วคราวของตัวเองบน 5180** (`npm run dev:web` บนโฮสต์ก็ใช่)
  — `strictPort` ทำให้ตัวที่มาทีหลังตายเสียงดัง ซึ่งเป็นสิ่งที่ต้องการ อย่าไปฆ่ากล่อง web ทิ้งเพื่อเปิดของตัวเอง
- **ห้ามสั่ง `docker compose -f docker-compose.preview.yml up` จาก worktree** — `./` ของไฟล์ compose
  คือโค้ดที่จะรัน สั่งจาก worktree ไหน พรีวิวก็กลายเป็นของ worktree นั้นสำหรับทุกคน
- **ห้ามชี้ proxy ไปที่ตัวจริง (3011) แทนกล่อง api** — ตัวจริงรันโค้ดของ deploy ล่าสุด ไม่ใช่ main
  ⇒ ส่วนที่ต้องใช้ backend ใหม่จะดูเหมือนพังทั้งที่ไม่ได้พัง

## ข้อควรระวัง — พรีวิวใช้ฐานตัวจริง

- กดยืนยันใบ = ออกเลขใบจริง · แก้กฎราคา/ผู้ใช้/สมุดราคา = แก้ของจริง · อัปลายเซ็น = volume จริง
  (กล่อง api เมานต์ `primus-chatbot_sig_sale` / `_sig_admin` ตัวเดียวกับตัวจริง เพราะแถวในฐาน
  ชี้ไฟล์ในนั้น)
- **migration ที่ยังไม่ได้รันบนฐาน** ⇒ ส่วนที่ต้องใช้คอลัมน์ใหม่จะ error ในพรีวิวด้วย —
  รัน migration ก็คือแก้ฐานจริง ต้องได้คำสั่งเจ้าของเหมือนตอน deploy
- **auto sync ปิดในพรีวิว** (`PREVIEW_MODE=1`) เพราะตัวล็อกกัน sync ซ้อนอยู่ในโปรเซสใครโปรเซสมัน
  แต่ **ปุ่ม sync เองในหน้าแอดมินของพรีวิวยังกดได้** และจะวิ่งซ้อนกับรอบของตัวจริงได้ — ไม่ต้องกดในพรีวิว
- การใช้งานผ่านพรีวิวลง `api_logs` เหมือนตัวจริง (เป็นการกระทำจริงกับข้อมูลจริง จึงต้องมีร่องรอย)
  ส่วนตัวถามรหัส `/__preview/boot` ทุกวินาทีอยู่ก่อน `apiLogMiddleware` จึงไม่ลงตาราง
- ไม่มี webhook LINE เข้ากล่อง api (ไม่มีทางเข้า) ⇒ พรีวิวไม่แย่ง replyToken กับตัวจริง

## เมื่อ dependency เปลี่ยน

| เปลี่ยนที่ | ทำอะไร |
| --- | --- |
| `frontend/package.json` | `npm --prefix frontend install` บนโฮสต์ แล้ว `docker compose -f docker-compose.preview.yml restart web` |
| `package.json` (backend) | node_modules ของกล่อง api มาจากอิมเมจตัวจริง ⇒ **ได้ของใหม่หลัง deploy เท่านั้น** (deploy build อิมเมจให้) แล้วค่อย `docker compose -f docker-compose.preview.yml up -d --force-recreate -V api` · ห้าม `docker compose build app` เองเพื่อพรีวิว — มันเขียนทับแท็กอิมเมจของตัวจริง `up -d` ครั้งถัดไปของใครก็ตามจะกลายเป็น deploy |
| `docker-compose.preview.yml` / `scripts/preview/vite.config.mjs` | `docker compose -f docker-compose.preview.yml up -d --force-recreate` |

## กลไก (เผื่อต้องแก้)

- **api** = อิมเมจ `primus-chatbot-app:latest` ตัวเดียวกับตัวจริง · เมานต์รีโปแบบอ่านอย่างเดียว ·
  `node_modules` เป็น anonymous volume ที่ก๊อปจากอิมเมจตอนสร้างกล่อง (ของรีโปบนโฮสต์ว่าง) ·
  ต่อ network `primus-chatbot_default` เพื่อคุยกับ `db` (db ไม่ publish พอร์ต) · ไม่ publish พอร์ตเอง
- **web** = `node:22-bookworm-slim` รันด้วย uid 1000 · ใช้ `frontend/node_modules` ของโฮสต์ ·
  config ต่อจาก `frontend/vite.config.ts` ทั้งก้อน (พอร์ต 5180 · strictPort) เปลี่ยนแค่ proxy →
  `http://api:3011` · cacheDir → `/tmp` · และ plugin รีโหลดเมื่อ backend รีสตาร์ต
- **รีโหลดเมื่อ backend รีสตาร์ต** ตัดสินจากรหัสโปรเซสที่ `/__preview/boot` ตอบ ไม่ใช่จากเวลาไฟล์เปลี่ยน
  — ตอนไฟล์เปลี่ยน backend ตัวเก่ายังตอบอยู่ รีโหลดตอนนั้นจะได้ของเก่า
- เป็น compose project แยก (`primus-chatbot-preview`) ⇒ deploy (`docker compose up -d --build`)
  ไม่แตะพรีวิว และ `down` ของพรีวิวไม่แตะตัวจริง
  ⚠️ ข้อยกเว้นข้อเดียว: **`docker compose down` ของตัวจริงจะลบ network ไม่ได้** ระหว่างที่พรีวิวยังต่ออยู่
  (กล่องของตัวจริงหยุดครบตามปกติ แค่มีข้อความ error เรื่อง network) — ถ้าต้อง `down` ตัวจริงจริง ๆ
  ให้ `down` พรีวิวก่อน
