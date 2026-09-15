#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  ติดตั้ง/อัปเดตบรรทัด cron ของ autobackup — รันซ้ำกี่ครั้งก็ได้ ผลเหมือนเดิม
#
#      bash scripts/backup/installCron.sh            # ตี 3 ทุกวัน (ค่าเริ่มต้น)
#      bash scripts/backup/installCron.sh 04:30      # เปลี่ยนเวลา
#      bash scripts/backup/installCron.sh --remove   # ถอดออก
#
#  ทำไมต้องมีสคริปต์แทนที่จะให้คนแก้ `crontab -e` เอง: crontab ของ app_sales มีงานของ
#  โปรเจคอื่นอยู่ด้วย (collect-logs, appsale dev-changelog) การแก้ด้วยมือบนเครื่อง
#  production คือจังหวะที่บรรทัดของคนอื่นหายโดยไม่มีใครรู้ ตัวนี้แตะเฉพาะบรรทัดที่มี
#  MARKER ของตัวเองและคัดลอกบรรทัดอื่นกลับมาครบทุกบรรทัดเสมอ
#
#  เวลา 03:00 เลือกเพราะอะไร: auto-sync ของ Odoo ตั้งไว้ จ.–ศ. 07:10–17:50 (ตาราง
#  sync_settings วัด 2026-09-15) ⇒ ตี 3 ไม่ทับรอบ sync ซึ่งจบด้วยการ build+swap
#  ตาราง customers_data_view ที่ต้องการ AccessExclusiveLock — pg_dump ถือ AccessShareLock
#  ค้างไว้ตลอดการดัมป์ ถ้าสองอย่างชนกัน swap จะรอจน sync ดูเหมือนค้าง
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
MARKER="# primus-chatbot autobackup"
TARGET="$PROJECT_DIR/scripts/backup/autoBackup.sh"
CRON_ERR_LOG="$PROJECT_DIR/backup/autobackup.cron.log"

current_crontab() { crontab -l 2>/dev/null; }

# ทุกบรรทัดที่ไม่ใช่ของเรา — นี่คือส่วนที่ต้องรอดกลับไปครบทุกครั้ง
without_ours() { current_crontab | grep -vF "$MARKER"; }

if [ "${1:-}" = "--remove" ]; then
  if ! current_crontab | grep -qF "$MARKER"; then
    echo "ไม่มีบรรทัด autobackup ใน crontab อยู่แล้ว — ไม่ต้องทำอะไร"
    exit 0
  fi
  without_ours | crontab - || { echo "เขียน crontab ไม่สำเร็จ"; exit 1; }
  echo "ถอดบรรทัด autobackup ออกจาก crontab แล้ว (ไฟล์ใน backup/ ไม่ถูกแตะ)"
  exit 0
fi

AT="${1:-03:00}"
if ! [[ "$AT" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]]; then
  echo "เวลาต้องเป็นรูปแบบ HH:MM (00:00–23:59) — ได้รับ: $AT"
  exit 1
fi
HH="${BASH_REMATCH[1]#0}"; HH="${HH:-0}"
MM="${BASH_REMATCH[2]#0}"; MM="${MM:-0}"

[ -f "$TARGET" ] || { echo "ไม่พบ $TARGET"; exit 1; }
chmod +x "$TARGET"

# stdout ทิ้งได้ — autoBackup.sh เขียนทุกบรรทัดลง backup/autobackup.log เองอยู่แล้ว
# ส่วน stderr เก็บไว้ เพราะนั่นคือที่เดียวที่ความล้มเหลว "ก่อนสคริปต์เริ่มทำงาน"
# (ไฟล์หาย, ไม่มีสิทธิ์รัน, bash พัง) จะโผล่ให้เห็น
LINE="$MM $HH * * * $TARGET >/dev/null 2>>$CRON_ERR_LOG  $MARKER"

{ without_ours; echo "$LINE"; } | crontab - || { echo "เขียน crontab ไม่สำเร็จ"; exit 1; }

echo "ติดตั้งแล้ว — autobackup จะทำงานทุกวันเวลา $AT"
echo "  $LINE"
echo
echo "ตรวจว่าได้ผลจริง: npm run diag:backup"
