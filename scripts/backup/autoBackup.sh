#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  autobackup — ดัมป์ฐานข้อมูลอัตโนมัติวันละครั้ง (cron เรียก · เรียกมือก็ได้)
#
#  ทำไมเป็น bash ไม่ใช่ tsx เหมือน scripts/dbDump.ts:
#    ตัวนี้ต้องทำงาน "ตอนที่อย่างอื่นพัง" — node/tsx/node_modules เจ๊ง, container app
#    ล่ม, แอปตอบไม่ได้ ⇒ backup ยังต้องเดิน สิ่งเดียวที่มันพึ่งคือ docker กับ container db
#    · และ host เครื่องนี้ **ไม่มี pg_dump/psql ติดตั้งไว้เลย** (วัด 2026-09-15)
#      ⇒ dbDump.ts ที่เรียก binary บน host ใช้บน PMSV ไม่ได้ ต้องยืม pg_dump ในกล่อง
#      ซึ่งเป็นเวอร์ชันเดียวกับเซิร์ฟเวอร์เสมอโดยไม่ต้องดูแลอะไรเพิ่ม
#
#  ลำดับที่ออกแบบมาเพื่อ "ไม่มีไฟล์ ดีกว่าไฟล์ที่กู้ไม่ได้":
#    1. ดัมป์ลง /tmp **ในกล่อง** (ไม่ผ่าน stdout pipe — pipe ที่ขาดกลางคันให้ไฟล์ครึ่งเดียว)
#    2. `pg_restore --list` อ่าน TOC ของไฟล์นั้นในกล่อง = พิสูจน์ว่าไฟล์ไม่ถูกตัดหัวตัดท้าย
#    3. ผ่านแล้วค่อย copy ออกมาที่ backup/ บน host
#    4. ลบของเก่าให้เหลือ BACKUP_KEEP ไฟล์ **หลังไฟล์ใหม่ลงที่แล้วเท่านั้น**
#  ⇒ ล้มตรงไหนก็ตาม ของเก่าที่มีอยู่ยังครบเท่าเดิม ไม่มีจังหวะไหนที่ "ลบของเก่าไปแล้ว
#    แต่ของใหม่ยังไม่มี"
#
#  ดิสก์: เครื่องนี้ใช้ไป 90% แล้ว (เหลือ ~7 GB วัด 2026-09-15) ⇒ สคริปต์ยอมล้มทั้งรอบ
#  ถ้าที่ว่างต่ำกว่า MIN_FREE_MB ดีกว่าเขียนจนดิสก์เต็มแล้วลาก postgres ของจริงล่มไปด้วย
#
#  ไฟล์ที่ได้มี PII ลูกค้า + bcrypt hash ⇒ backup/ ถูก gitignore ไว้แล้ว ห้ามให้ออกนอกเครื่อง
#  กู้คืน: ดู DEPLOY.md หัวข้อ "สำรองฐานข้อมูลอัตโนมัติ"
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

# รากของโปรเจคคำนวณจากที่อยู่ของไฟล์นี้ ไม่ใช่จาก cwd — cron รันโดยไม่มี cwd ที่แน่นอน
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backup}"
LOG_FILE="$BACKUP_DIR/autobackup.log"
LOG_MAX_BYTES=$((2 * 1024 * 1024))    # หมุน log ที่ 2MB เก็บของเก่า 1 รุ่น

KEEP="${BACKUP_KEEP:-7}"              # เก็บกี่ไฟล์ล่าสุด (นับไฟล์ ไม่ใช่นับวัน — ดูเหตุผลที่ prune)
MIN_FREE_MB="${BACKUP_MIN_FREE_MB:-1024}"   # ที่ว่างขั้นต่ำบน host ก่อนยอมดัมป์
MIN_DUMP_MB="${BACKUP_MIN_DUMP_MB:-10}"     # ไฟล์เล็กกว่านี้ = ผิดปกติ (ของจริง ~75MB)
PREFIX="auto_"                        # ไฟล์ที่สคริปต์นี้เป็นเจ้าของ — ลบได้เฉพาะไฟล์ที่ขึ้นต้นแบบนี้

mkdir -p "$BACKUP_DIR"

log() {
  local line
  line="[$(date '+%F %T')] $*"
  echo "$line"
  echo "$line" >> "$LOG_FILE"
}

die() {
  log "ล้มเหลว: $*"
  record_run failed "$*"
  exit 1
}

# ── บันทึกผลของรอบนี้ลงตาราง backup_runs — สำหรับหน้า "การสำรองข้อมูล" ในแอดมิน ─
#
# ⚠️ ห้ามทำให้สคริปต์ล้มไม่ว่ากรณีใด (เหตุผลเดียวกับ recordLogAccess ใน db/logRepositories.ts):
#   การบันทึกว่า "เกิดอะไรขึ้น" ต้องไม่มีวันทำให้สิ่งที่มันบันทึกล้มเหลว — ฐานล่ม ตารางยังไม่ถูก
#   สร้าง (ยังไม่ได้รัน migration) หรือ psql หาย ⇒ แค่ไม่มีแถวในรายงาน ไฟล์สำรองยังได้เหมือนเดิม
#   และ backup/autobackup.log ยังเป็นแหล่งความจริงสำรองอยู่
#
# ค่าที่ส่งไปใช้ `:'ตัวแปร'` ของ psql ซึ่ง quote ให้เองอย่างปลอดภัย ⇒ ข้อความไทยที่มี
# อัญประกาศหรือ % ไม่ทำ SQL พัง · ตัวเลขที่ยังไม่มีค่าส่งเป็นค่าว่างแล้วให้ NULLIF แปลงเป็น NULL
#
# ⚠️ SQL ต้องส่งทาง **stdin** ไม่ใช่ `psql -c` — `-c` ไม่ขยายตัวแปรของ psql เลย
#   (วัด 2026-09-15: `-c` ที่มี :'started' ตอบ `syntax error at or near ":"`) และความล้มเหลว
#   นั้นเงียบสนิทเพราะฟังก์ชันนี้กลืน error ตามเจตนา ⇒ จะเห็นแค่ "รายงานไม่มีแถว" เท่านั้น
RUN_FILE='' RUN_SIZE='' RUN_TOC='' RUN_FREE='' RUN_KEPT=''
START_EPOCH="$(date +%s)"
START_ISO="$(date --iso-8601=seconds)"
RUN_RECORDED=0

record_run() {
  [ "$RUN_RECORDED" = 1 ] && return 0      # กันบันทึกซ้ำเมื่อ die ถูกเรียกซ้อน
  [ -n "${PG_USER:-}" ] && [ -n "${PG_DATABASE:-}" ] || return 0
  RUN_RECORDED=1
  local status="$1" message="${2:-}"
  local dur=$(( ($(date +%s) - START_EPOCH) * 1000 ))
  printf '%s' \
    "INSERT INTO backup_runs
       (started_at, status, file_name, size_bytes, toc_entries, duration_ms, free_mb_after, kept_files, message)
     VALUES (:'started'::timestamptz, :'status', NULLIF(:'file',''), NULLIF(:'size','')::bigint,
             NULLIF(:'toc','')::int, NULLIF(:'dur','')::int, NULLIF(:'free','')::int,
             NULLIF(:'kept','')::int, NULLIF(:'msg',''));" \
  | docker compose exec -T db psql -U "$PG_USER" -d "$PG_DATABASE" -q -v ON_ERROR_STOP=1 \
      -v started="$START_ISO" -v status="$status" -v msg="$message" -v file="$RUN_FILE" \
      -v size="$RUN_SIZE" -v toc="$RUN_TOC" -v dur="$dur" -v free="$RUN_FREE" -v kept="$RUN_KEPT" \
      >/dev/null 2>&1 \
    || log "หมายเหตุ: บันทึกผลลงตาราง backup_runs ไม่สำเร็จ (ไฟล์สำรองไม่กระทบ)"
}

# หมุน log ก่อนเขียนบรรทัดแรกของรอบนี้
if [ -f "$LOG_FILE" ] && [ "$(stat -c%s "$LOG_FILE")" -gt "$LOG_MAX_BYTES" ]; then
  mv -f "$LOG_FILE" "$LOG_FILE.1"
fi

cd "$PROJECT_DIR" || die "เข้า $PROJECT_DIR ไม่ได้"

# ── อ่านค่าจาก .env แบบเจาะทีละตัว ไม่ source ทั้งไฟล์ ─────────────────────────
# source ทั้งไฟล์จะรันทุกบรรทัดใน .env (มี prompt หลายบรรทัดและอักขระพิเศษ) เป็นคำสั่ง shell
# อ่านก่อนคว้า lock เพราะรอบที่ถูกข้ามก็ต้องบันทึกลงรายงานได้ (ต้องรู้ชื่อฐานก่อน)
env_get() {
  grep -m1 "^$1=" "$PROJECT_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r'
}

PG_USER="$(env_get PG_USER)"
PG_DATABASE="$(env_get PG_DATABASE)"
[ -n "$PG_USER" ]     || die "ไม่พบ PG_USER ใน $PROJECT_DIR/.env"
[ -n "$PG_DATABASE" ] || die "ไม่พบ PG_DATABASE ใน $PROJECT_DIR/.env"

# กันรันซ้อน: รอบก่อนยังไม่จบ (ดิสก์ช้า/DB ยุ่ง) แล้ว cron รอบใหม่มาถึง = ออกเงียบ ๆ
exec 9>"$BACKUP_DIR/.autobackup.lock"
if ! flock -n 9; then
  log "ข้ามรอบนี้ — มี autobackup ตัวอื่นทำงานอยู่"
  record_run skipped "มี autobackup ตัวอื่นทำงานอยู่"
  exit 0
fi

# ── container db ต้องขึ้นอยู่จริง ────────────────────────────────────────────
if ! docker compose ps --status running --services 2>/dev/null | grep -qx db; then
  die "container db ไม่ได้รันอยู่ — ยังไม่ได้ดัมป์อะไรทั้งนั้น"
fi

# ── ที่ว่างบน host ต้องพอ ────────────────────────────────────────────────────
free_mb="$(df -Pm "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
RUN_FREE="$free_mb"
if [ "${free_mb:-0}" -lt "$MIN_FREE_MB" ]; then
  die "ที่ว่างเหลือ ${free_mb}MB ต่ำกว่าเกณฑ์ ${MIN_FREE_MB}MB — ไม่ดัมป์ (ลบไฟล์เก่าหรือขยายดิสก์ก่อน)"
fi

STAMP="$(date '+%F_%H%M')"
NAME="${PREFIX}${PG_DATABASE}_${STAMP}.dump"
IN_BOX="/tmp/autobackup_$$.dump"            # ที่พักในกล่อง ระหว่างดัมป์+ตรวจ
PART="$BACKUP_DIR/.autobackup.$$.part"      # ที่พักบน host ระหว่างตรวจขนาด

# ชื่อชั่วคราวผูกกับ PID ไม่ใช่กับเวลา และไฟล์ปลายทางเกิดขึ้นด้วย mv ท่าเดียว —
# เจอจริงตอนทดสอบ 2026-09-15: รอบที่ล้มด่านขนาดเคย `rm` ที่ "ชื่อไฟล์ปลายทาง" ซึ่ง
# ชนกับไฟล์ของรอบก่อน (STAMP ละเอียดแค่ระดับนาที) ⇒ รอบที่ล้มลบ backup ที่ดีของรอบก่อน
# ทิ้งไปด้วย ทั้งที่ log บอกว่า "ของเก่ายังอยู่ครบ" · ตอนนี้ไม่มีคำสั่งลบไหนแตะชื่อปลายทางเลย
# และไฟล์ .part ขึ้นต้นด้วยจุด ⇒ ไม่เข้า glob ของ retention ด้วย

# ของค้างจากรอบที่ถูกฆ่ากลางคัน (Ctrl-C / timeout / เครื่องดับ) — เก็บกวาดก่อนเริ่มรอบใหม่
docker compose exec -T db find /tmp -maxdepth 1 -name 'autobackup_*.dump' -delete >/dev/null 2>&1
find "$BACKUP_DIR" -maxdepth 1 -name '.autobackup.*.part' -delete 2>/dev/null

cleanup_tmp() {
  docker compose exec -T db rm -f "$IN_BOX" >/dev/null 2>&1
  rm -f "$PART"
}
trap cleanup_tmp EXIT

log "เริ่มดัมป์ \"$PG_DATABASE\" (เก็บ $KEEP ไฟล์ล่าสุด · ว่าง ${free_mb}MB)"

# ── 1. ดัมป์ในกล่อง ──────────────────────────────────────────────────────────
if ! docker compose exec -T db pg_dump -U "$PG_USER" -d "$PG_DATABASE" \
      --format=custom --no-owner --no-privileges --file "$IN_BOX" 2>>"$LOG_FILE"; then
  die "pg_dump ไม่สำเร็จ (ดูบรรทัดก่อนหน้าใน $LOG_FILE) — ของเก่ายังอยู่ครบ"
fi

# ── 2. ตรวจว่าไฟล์กู้ได้จริง ก่อนจะให้มันออกมาเป็น backup บน host ──────────────
# `pg_restore --list` อ่าน TOC ทั้งก้อน ⇒ ไฟล์ที่ถูกตัดกลางคันจะตกด่านนี้
# ไม่ใช่ไปโผล่ตอนวันที่ต้องกู้จริง
toc_entries="$(docker compose exec -T db pg_restore --list "$IN_BOX" 2>/dev/null | grep -c '^[0-9]')"
if [ "${toc_entries:-0}" -lt 1 ]; then
  die "ไฟล์ที่ได้อ่าน TOC ไม่ออก (pg_restore --list ว่าง) — ทิ้งไฟล์รอบนี้ ของเก่ายังอยู่ครบ"
fi
RUN_TOC="$toc_entries"

# ── 3. ผ่านแล้วค่อยออกมาอยู่บน host ─────────────────────────────────────────
if ! docker compose cp "db:$IN_BOX" "$PART" >/dev/null 2>>"$LOG_FILE"; then
  die "copy ไฟล์ออกจาก container ไม่สำเร็จ — ของเก่ายังอยู่ครบ"
fi

size_mb=$(( $(stat -c%s "$PART") / 1024 / 1024 ))
if [ "$size_mb" -lt "$MIN_DUMP_MB" ]; then
  die "ไฟล์ที่ได้ ${size_mb}MB เล็กกว่าเกณฑ์ ${MIN_DUMP_MB}MB — ทิ้งไฟล์รอบนี้ ของเก่ายังอยู่ครบ"
fi

# ผ่านทุกด่านแล้วจึงกลายเป็นไฟล์ backup จริง — mv ในไดเรกทอรีเดียวกันเป็น atomic
# ⇒ ไม่มีวินาทีไหนที่ backup/ มีไฟล์ชื่อจริงที่ยังเขียนไม่เสร็จให้ใครหยิบไปกู้
if ! mv -f "$PART" "$BACKUP_DIR/$NAME"; then
  die "ตั้งชื่อไฟล์ปลายทางไม่สำเร็จ — ของเก่ายังอยู่ครบ"
fi

RUN_FILE="$NAME"
RUN_SIZE="$(stat -c%s "$BACKUP_DIR/$NAME")"
log "สำเร็จ: $NAME (${size_mb}MB · $toc_entries รายการใน TOC)"

# ── 4. เก็บของเก่า — เฉพาะไฟล์ที่สคริปต์นี้สร้างเอง ──────────────────────────
# นับไฟล์ ไม่ใช่นับวัน: ถ้า cron หยุดไปหลายวัน เกณฑ์ "เก่ากว่า 7 วัน" จะลบจนไม่เหลืออะไรเลย
# ส่วนการนับไฟล์ยังเหลือ 7 ชุดล่าสุดเสมอไม่ว่าจะขาดช่วงไปนานแค่ไหน
# `$PREFIX` กันไม่ให้ไปแตะ dump ที่เจ้าของทำเองไว้ (เช่น backup-2026-09-07-block-rules.dump)
mapfile -t old_files < <(ls -1t "$BACKUP_DIR/$PREFIX"*.dump 2>/dev/null | tail -n +$((KEEP + 1)))
for f in "${old_files[@]:-}"; do
  [ -n "$f" ] || continue
  rm -f "$f" && log "ลบของเก่า: $(basename "$f")"
done

kept="$(ls -1 "$BACKUP_DIR/$PREFIX"*.dump 2>/dev/null | wc -l)"
free_after="$(df -Pm "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
log "จบรอบ — มี $kept ไฟล์อัตโนมัติใน backup/ · ที่ว่างเหลือ ${free_after}MB"

RUN_KEPT="$kept"
RUN_FREE="$free_after"
removed=${#old_files[@]}
[ -z "${old_files[0]:-}" ] && removed=0
record_run success "$([ "$removed" -gt 0 ] && echo "ลบของเก่า $removed ชุด" || echo "")"
