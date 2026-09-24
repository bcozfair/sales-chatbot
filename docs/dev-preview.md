# พรีวิวร่วมบนเครื่อง PMSV — ดูโค้ดล่าสุดก่อน deploy ที่ `localhost:5180`

> เจ้าของสั่ง 2026-09-24: *"พรีวิวตอน dev ก่อน deploy บนเครื่อง PMSV ให้ใช้พอร์ตทดสอบเดียวกัน
> ทุก session เห็นได้ทั้ง backend และ frontend ตรงกับ code ล่าสุด เปลี่ยนทันทีเมื่อ code เปลี่ยน
> ไม่ต้อง refresh"* · และในวันเดียวกัน *"อยากรัน local มากกว่า"* (ไม่ใช่ docker — ดู "ทางที่ไม่ได้เลือก")
> และ *"ไม่ต้องการให้ server พรีวิวรันค้างไว้ ต้อง start และ stop เองได้"*

## สรุปสั้น

| | |
| --- | --- |
| ลิงก์ | **`http://localhost:5180/admin.html`** (เปิดผ่าน port forwarding ของ VSCode — ลิงก์ IP วงแลนเปิดไม่ได้) |
| รันโค้ดจาก | working tree หลัก **`/home/app_sales/salechatbot/chatbot` (= main)** |
| แก้หน้าจอ (`frontend/src`) | จอเปลี่ยนเองทันที (Vite HMR) — state บนจอยังอยู่ |
| แก้ backend (`*.ts` นอก frontend) | backend รีสตาร์ตเอง (`tsx watch`) ขึ้นเสร็จแล้ว **หน้าเว็บรีโหลดเอง** ไม่ต้องกด |
| ฐานข้อมูล | **ตัวจริง** — ฐานเดียวบนเครื่องนี้ (ดู "ข้อควรระวัง") |
| เปิด/ปิด | **เจ้าของสั่งเอง** — ไม่รันค้าง ไม่ขึ้นเองตอนบูต (รีบูตแล้วหาย) |
| ไฟล์ | `scripts/preview/preview.sh` · `scripts/preview/vite.config.mjs` · `PREVIEW_MODE` ใน `index.ts` |

```bash
npm run preview:start    # เปิด แล้วรอจนพร้อม (~5 วิ) · รันเบื้องหลัง ปิด terminal ได้
npm run preview:stop     # ปิด (ไม่แตะตัวจริง)
npm run preview:status   # เปิดอยู่ไหม
npm run preview:logs     # log ทั้งสองตัว (Ctrl-C ออก — พรีวิวยังรันต่อ)
```
สั่งจากทรีหลักหรือจาก worktree ไหนก็ได้ — สคริปต์หาทรีหลักจาก `git worktree list` เอง
start ซ้ำตอนเปิดอยู่แล้ว = บอกว่าเปิดอยู่ ไม่เปิดชุดที่สอง

| ตัว (transient unit ของ `systemd-run --user`) | ทำอะไร | พอร์ต |
| --- | --- | --- |
| `primus-preview-api` | `tsx watch index.ts` + `PREVIEW_MODE=1` · อ่าน `.env` ของทรีหลัก | `127.0.0.1:3098` |
| `primus-preview-web` | Vite + HMR · proxy `/api` `/data` `/download-pdf` ไป 3098 | `127.0.0.1:5180` |

ทำไม `systemd-run` ไม่ใช่ไฟล์ `.service`: ไม่มีไฟล์ unit ติดตั้งไว้ในเครื่อง = ไม่มีทางเผลอ `enable`
ให้ขึ้นเองตอนบูต (ตามที่เจ้าของสั่ง) แต่ยังได้การรันต่อหลังปิด terminal · log ใน journal ·
ชื่อตายตัวกันเปิดซ้ำสองชุด · ทางที่ไม่ได้เลือก: `concurrently` แบบ `dev:all` — ปิด terminal แล้วตาย
และถ้าลืมปิด ตัวที่สองจะชนพอร์ตแบบอ่านยาก

**agent:** พรีวิวเป็นของเจ้าของเปิด/ปิด — ถ้าต้องเปิดเพื่อทดสอบเอง ให้ **ปิดคืนเมื่อเสร็จ ถ้าก่อนเริ่มมันปิดอยู่**
(เช็กด้วย `npm run preview:status` ก่อน) · ถ้าเจ้าของเปิดไว้อยู่แล้ว ห้ามปิดของเขา

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
  — `strictPort` ทำให้ตัวที่มาทีหลังตายเสียงดัง ซึ่งเป็นสิ่งที่ต้องการ อย่าไปหยุดพรีวิวเพื่อเปิดของตัวเอง
- **ห้ามแก้ `preview.sh` ให้รันโค้ดจาก worktree** — พรีวิวจะกลายเป็นโค้ดของ worktree นั้นสำหรับทุกคน
- **ห้ามชี้ proxy ไปที่ตัวจริง (3011) แทน 3098** — ตัวจริงรันโค้ดของ deploy ล่าสุด ไม่ใช่ main
  ⇒ ส่วนที่ต้องใช้ backend ใหม่จะดูเหมือนพังทั้งที่ไม่ได้พัง

## ข้อควรระวัง — พรีวิวใช้ฐานตัวจริง

- กดยืนยันใบ = ออกเลขใบจริง · แก้กฎราคา/ผู้ใช้/สมุดราคา = แก้ของจริง
- **ลายเซ็นในพรีวิวไม่ใช่ชุดเดียวกับตัวจริง** — พรีวิวอ่าน `data/sale_sigs` · `data/admin_sigs` ในรีโป
  (ไฟล์ที่ commit ไว้) ส่วนตัวจริงอ่าน docker volume · วัด 2026-09-24: รีโป 37 ไฟล์ / volume 35
  ต่างกัน 4 ไฟล์ ⇒ PDF ในพรีวิวอาจขาดหรือได้ลายเซ็นคนละรูปกับของจริง
  **`PREVIEW_MODE` จึงปิดการอัป/ลบลายเซ็น** (503) — อัปในพรีวิวแล้วฐานจริงจะชี้ไฟล์ที่ตัวจริงไม่มี
- **migration ที่ยังไม่ได้รันบนฐาน** ⇒ ส่วนที่ต้องใช้คอลัมน์ใหม่จะ error ในพรีวิวด้วย —
  รัน migration ก็คือแก้ฐานจริง ต้องได้คำสั่งเจ้าของเหมือนตอน deploy
- **auto sync ปิดในพรีวิว** (`PREVIEW_MODE=1`) เพราะตัวล็อกกัน sync ซ้อนอยู่ในโปรเซสใครโปรเซสมัน
  แต่ **ปุ่ม sync เองในหน้าแอดมินของพรีวิวยังกดได้** และจะวิ่งซ้อนกับรอบของตัวจริงได้ — ไม่ต้องกดในพรีวิว
- การใช้งานผ่านพรีวิวลง `api_logs` เหมือนตัวจริง (เป็นการกระทำจริงกับข้อมูลจริง จึงต้องมีร่องรอย)
  ส่วนตัวถามรหัส `/__preview/boot` ทุกวินาทีอยู่ก่อน `apiLogMiddleware` จึงไม่ลงตาราง
- ไม่มี webhook LINE เข้าพรีวิว (ไม่มีทางเข้า) ⇒ ไม่แย่ง replyToken กับตัวจริง
- **ผลพลอยได้ที่ต้องระวัง:** ทรีหลักมี `node_modules` ของ backend บนโฮสต์แล้ว ⇒ `npx tsc --noEmit`
  รันบนโฮสต์ได้ แต่ **สคริปต์ sync / diag / backfill ก็รันบนโฮสต์ได้ด้วย และ `.env` ชี้ฐานตัวจริง**
  (`PG_HOST=localhost:5432`) — ก่อนหน้านี้รันไม่ได้เพราะไม่มีแพ็กเกจ ตอนนี้ต้องระวังเอง

## PDF บนโฮสต์ — Chrome และฟอนต์ไทย

puppeteer หา Chrome ที่ `~/.cache/puppeteer/chrome/linux-<เวอร์ชัน>/` เอง (ไม่ต้องตั้ง env)
- เครื่องนี้ไม่มี `unzip` ⇒ `npm ci` โหลด Chrome เองไม่สำเร็จ ต้อง `PUPPETEER_SKIP_DOWNLOAD=true npm ci`
  แล้วโหลด `chrome-linux64.zip` ของเวอร์ชันใน `node_modules/puppeteer-core/lib/puppeteer/revisions.js`
  จาก `storage.googleapis.com/chrome-for-testing-public/<ver>/linux64/` แล้วแตกด้วย python `zipfile`
  (ต้องคืน permission ของไฟล์เอง — `zipfile` ไม่คืนให้)
- library ของระบบที่ Chrome ต้องใช้ + ฟอนต์ไทย ต้องลงด้วย sudo (วัด 2026-09-24 · Ubuntu 24.04):
  ```bash
  sudo apt-get install -y libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libasound2t64 \
    libcairo2 libpango-1.0-0 libxdamage1 libatspi2.0-0t64 fonts-thai-tlwg
  ```
  ตรวจ: `ldd ~/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome | grep "not found"` ต้องว่าง
- Chrome/ฟอนต์บนโฮสต์ **ไม่ใช่ชุดเดียวกับในอิมเมจ** (อิมเมจใช้ `chromium` ของ Debian) ⇒ การตัดบรรทัด/
  ตัดหน้าของ PDF อาจต่างจากของจริงเล็กน้อย — ตัดสินหน้าตา PDF สุดท้ายจากตัวจริงหลัง deploy
  · วัด 2026-09-24: ใบ `QT-260905398` จากพรีวิว (Chrome 148 บนโฮสต์ · 1.4 วิ) เทียบกับตัวจริง
  **หน้าตาตรงกันทุกจุด** ทั้งตัวหนังสือไทย ตำแหน่ง และการตัดบรรทัด (ไฟล์ 153 KB กับ 156 KB)

## ติดตั้ง (ครั้งเดียวต่อเครื่อง — ทำแล้วบน PMSV 2026-09-24)

```bash
cd /home/app_sales/salechatbot/chatbot
PUPPETEER_SKIP_DOWNLOAD=true npm ci --include=dev         # node_modules ของ backend บนโฮสต์
# Chrome + library + ฟอนต์ไทย: หัวข้อข้างบน
```
ไม่มีขั้น systemd — `preview:start` สร้างตัวรันชั่วคราวให้เองทุกครั้ง

## เมื่อ dependency เปลี่ยน

| เปลี่ยนที่ | ทำอะไร |
| --- | --- |
| `package.json` (backend) | `PUPPETEER_SKIP_DOWNLOAD=true npm ci --include=dev` ที่ทรีหลัก แล้ว stop/start (ถ้า puppeteer ขยับเวอร์ชัน ต้องโหลด Chrome เวอร์ชันใหม่ด้วย) |
| `frontend/package.json` | `npm --prefix frontend install` แล้ว stop/start |
| `scripts/preview/*` | stop/start |
| เวอร์ชัน node ของ nvm | ไม่ต้องทำอะไร — สคริปต์ใช้ `node` ตัวที่อยู่ใน PATH ตอนสั่ง start |

## กลไก (เผื่อต้องแก้)

- **รีโหลดเมื่อ backend รีสตาร์ต** ตัดสินจากรหัสโปรเซสที่ `/__preview/boot` ตอบ ไม่ใช่จากเวลาไฟล์เปลี่ยน
  — ตอนไฟล์เปลี่ยน backend ตัวเก่ายังตอบอยู่ รีโหลดตอนนั้นจะได้ของเก่า
- Vite ของพรีวิวต่อจาก `frontend/vite.config.ts` ทั้งก้อน (พอร์ต 5180 · strictPort) เปลี่ยนแค่ proxy
  กับเพิ่ม plugin รีโหลด

**ทดสอบด้วย Chromium จริง 2026-09-24** (ตอนยังเป็นกล่อง docker · กลไกเดียวกัน):
แก้ข้อความปุ่มใน `Login.tsx` ⇒ จอเปลี่ยนใน < 1 วิ **ไม่มีการโหลดหน้าใหม่** (ตัวแปรที่ตั้งไว้ใน
`window` ยังอยู่) · `touch index.ts` ⇒ `tsx watch` รีสตาร์ต แล้วหน้าเว็บรีโหลดเอง **~3 วิ** หลังไฟล์เปลี่ยน

**ทดสอบซ้ำหลังย้ายมาโฮสต์ 2026-09-24** (ต่อ websocket HMR ของ Vite ตรง ๆ — ช่องเดียวกับที่หน้าเว็บฟัง):
แก้ `Login.tsx` ⇒ `update` ในวินาทีเดียวกัน · `touch index.ts` ⇒ backend ขึ้นใหม่ใน 3 วิ แล้ว
`full-reload` ที่ 4 วิ · POST/DELETE ลายเซ็นที่ 3098 ได้ 503 ส่วนตัวจริง (3011) ไม่โดนกัน ·
หลังลง library ด้วย apt: เปิดหน้าด้วย Chrome จริงบนโฮสต์ แก้ `Login.tsx` ⇒ จอเปลี่ยนใน 0.2 วิ
ไม่โหลดหน้าใหม่ · `touch index.ts` ⇒ หน้าเว็บรีโหลดเอง

## ทางที่ไม่ได้เลือก: กล่อง docker (ใช้อยู่ครึ่งวัน 2026-09-24 · `084b487`–`ebcb3a7`)

อิมเมจเดียวกับตัวจริงให้ PDF/ลายเซ็นตรงของจริงเป๊ะ แต่เจ้าของเลือกรันบนโฮสต์ — ข้อแลกที่รู้อยู่แล้ว
คือ PDF/ลายเซ็นอาจไม่ตรงของจริง (ข้างบน) · ถ้าจะกลับไปใช้ ดูไฟล์ `docker-compose.preview.yml`
ใน `ebcb3a7` (ต้องวาง tmpfs ทับ `/app/node_modules` ให้ Vite เขียน `.vite-temp` ได้ และต้องต่อ network
`primus-chatbot_default` ซึ่งทำให้ `docker compose down` ของตัวจริงลบ network ไม่ได้ระหว่างพรีวิวเปิด)
