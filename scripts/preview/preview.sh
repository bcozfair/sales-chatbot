#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  พรีวิวร่วมของเครื่อง PMSV — เปิด/ปิดเองด้วยมือ (docs/dev-preview.md)
#
#    npm run preview:start    # เปิด backend :3098 + Vite :5180 เป็นเบื้องหลัง แล้วรอจนพร้อม
#    npm run preview:stop     # ปิดทั้งคู่
#    npm run preview:status   # เปิดอยู่ไหม
#    npm run preview:logs     # ดู log ทั้งสองตัว (Ctrl-C เพื่อออก — พรีวิวยังรันต่อ)
#
#  ทำไม systemd-run --user (transient unit) ไม่ใช่ไฟล์ .service:
#  เจ้าของสั่ง 2026-09-24 ว่า "ไม่ต้องการให้ server พรีวิวรันค้างไว้ ต้อง start และ stop เองได้"
#  ⇒ ไม่มีไฟล์ unit ติดตั้งไว้ในเครื่อง = ไม่มีทางเผลอ enable ให้ขึ้นเองตอนบูต · รีบูตแล้วหายเอง
#  แต่ยังได้ของที่ดีของ systemd: รันต่อหลังปิด terminal · log อยู่ใน journal · ชื่อตายตัว
#  ทำให้ start ซ้ำสองครั้งไม่ได้สองชุด (ชนพอร์ตกันเองไม่ได้)
#
#  ⚠️ รันโค้ดจาก **ทรีหลัก (= main) เสมอ** แม้สั่งจาก worktree — ดู "ทำไมถึงเป็น main" ในคู่มือ
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

API_UNIT=primus-preview-api
WEB_UNIT=primus-preview-web
API_PORT=3098
URL=http://localhost:5180/admin.html

# ทรีหลัก = แถวแรกของ `git worktree list` ⇒ สั่งจาก worktree ไหนก็ได้ผลเหมือนกัน
ROOT=$(git -C "$(dirname "$0")" worktree list --porcelain | sed -n '1s/^worktree //p')
NODE=$(command -v node)
NODE_DIR=$(dirname "$NODE")

is_active() { systemctl --user is-active --quiet "$1"; }

start() {
  if is_active "$API_UNIT" || is_active "$WEB_UNIT"; then
    echo "พรีวิวเปิดอยู่แล้ว → $URL   (ปิด: npm run preview:stop)"
    return 0
  fi
  systemctl --user reset-failed "$API_UNIT" "$WEB_UNIT" 2>/dev/null || true
  [ -d "$ROOT/node_modules/tsx" ] || { echo "❌ ไม่มี node_modules ของ backend ที่ $ROOT — ดูหัวข้อ \"ติดตั้ง\" ใน docs/dev-preview.md"; exit 1; }

  # 143 = ตายด้วย SIGTERM ตอน stop — เป็นการปิดปกติ ไม่ใช่ failed
  local common=(--user --collect --quiet -p "SuccessExitStatus=143 SIGTERM"
                -E "PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin" -E TZ=Asia/Bangkok)

  systemd-run "${common[@]}" --unit="$API_UNIT" --working-directory="$ROOT" \
    -E PREVIEW_MODE=1 -E PORT=$API_PORT \
    "$NODE" node_modules/.bin/tsx watch --clear-screen=false index.ts

  systemd-run "${common[@]}" --unit="$WEB_UNIT" --working-directory="$ROOT/frontend" \
    -E PREVIEW_API=http://127.0.0.1:$API_PORT \
    "$NODE" node_modules/.bin/vite --config ../scripts/preview/vite.config.mjs --host 127.0.0.1

  printf 'กำลังเปิดพรีวิว (โค้ดจาก %s) ' "$ROOT"
  for _ in $(seq 1 60); do
    if curl -fs -o /dev/null "http://127.0.0.1:$API_PORT/__preview/boot" && curl -fs -o /dev/null "$URL"; then
      echo; echo "✅ พร้อมแล้ว → $URL   (ปิด: npm run preview:stop)"; return 0
    fi
    if ! is_active "$API_UNIT" || ! is_active "$WEB_UNIT"; then break; fi
    printf '.'; sleep 1
  done
  echo; echo "❌ เปิดไม่สำเร็จ — log ล่าสุด:"
  journalctl --user -u "$API_UNIT" -u "$WEB_UNIT" -n 30 --no-pager || true
  stop >/dev/null; exit 1
}

stop() {
  systemctl --user stop "$WEB_UNIT" "$API_UNIT" 2>/dev/null || true
  systemctl --user reset-failed "$API_UNIT" "$WEB_UNIT" 2>/dev/null || true
  echo "ปิดพรีวิวแล้ว"
}

status() {
  for u in "$API_UNIT" "$WEB_UNIT"; do
    printf '%-20s %s\n' "$u" "$(systemctl --user is-active "$u" 2>/dev/null || true)"
  done
  if is_active "$WEB_UNIT"; then echo "→ $URL"; fi
}

logs() { exec journalctl --user -f -n 50 -u "$API_UNIT" -u "$WEB_UNIT"; }

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  logs) logs ;;
  *) echo "ใช้: $0 start|stop|status|logs"; exit 2 ;;
esac
