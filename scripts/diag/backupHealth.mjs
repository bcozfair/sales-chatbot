// ─────────────────────────────────────────────────────────────────────────────
//  ด่านตรวจของระบบสำรองฐานข้อมูลอัตโนมัติ — ตอบคำถามเดียว:
//  **"ถ้าฐานพังตอนนี้ มีไฟล์ที่กู้ได้จริงอยู่กี่ชั่วโมงที่แล้ว"**
//
//  ระบบ backup ที่ล้มเงียบเป็นสิ่งที่แย่กว่าไม่มี backup เพราะทุกคนเชื่อว่ามีอยู่ —
//  ด่านนี้จึงไม่ได้ถามแค่ "ไฟล์มีไหม" แต่ถามครบทั้งสาย: cron ยังตั้งอยู่ไหม ·
//  ไฟล์ล่าสุดสดพอไหม · ขนาดสมเหตุผลไหม · retention ทำงานไหม · ดิสก์พอรอบหน้าไหม
//  และ `--deep` เปิด TOC ของไฟล์ล่าสุดจริง ๆ ว่ากู้ได้
//
//  ไม่แตะฐานข้อมูลเลย (อ่านไฟล์ + crontab + df เท่านั้น · `--deep` ยืม pg_restore
//  ในกล่องมาอ่าน "ไฟล์" ไม่ใช่ฐาน) → รันบน production ได้ปลอดภัย
//
//  ── ทำไมเป็น .mjs ไม่ใช่ .ts เหมือน diag ส่วนใหญ่ (เหตุผลเดียวกับ migrationsAudit.mjs) ──
//  สิ่งที่ต้องตรวจอยู่บน **host** ทั้งหมด: crontab ของ app_sales · ไฟล์ใน backup/ ·
//  ที่ว่างของดิสก์ — ในกล่องไม่มีสักอย่าง (backup/ ไม่ได้ mount เข้าไป)
//  และ host เครื่องนี้ไม่มี node_modules เลย (วัด 2026-09-15) ⇒ tsx รันไม่ได้
//  ไฟล์นี้จึงใช้เฉพาะ builtin ของ node ล้วน ๆ
//
//  รัน:  npm run diag:backup          ตรวจเร็ว (ไม่ถึงวินาที)
//        npm run diag:backup -- --deep  ตรวจว่าไฟล์ล่าสุดกู้ได้จริง (+~2 วิ)
//
//  ค่าเกณฑ์ (KEEP ฯลฯ) **อ่านออกมาจาก scripts/backup/autoBackup.sh ตอนรัน**
//  ไม่ได้ก๊อปมาไว้ที่นี่ — ค่าที่มีสองสำเนาคือค่าที่เพี้ยนกันในวันที่ใครสักคนแก้ที่เดียว
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BACKUP_DIR = path.join(PROJECT_DIR, 'backup');
const SCRIPT_PATH = path.join(PROJECT_DIR, 'scripts/backup/autoBackup.sh');
const CRON_MARKER = '# primus-chatbot autobackup';
const PREFIX = 'auto_';
const deep = process.argv.includes('--deep');

let failures = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const note = (label) => console.log(`   ${label}`);

/** ดึงค่า default ของตัวแปรจากสคริปต์ bash: KEEP="${BACKUP_KEEP:-7}" → 7 */
function shDefault(varName, fallback) {
  try {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const m = new RegExp(`^\\s*\\w+="\\$\\{${varName}:-(\\d+)\\}"`, 'm').exec(src);
    return m ? Number(m[1]) : fallback;
  } catch {
    return fallback;
  }
}

console.log('── 1. สคริปต์ที่ cron ต้องเรียก ──');
ok('มี scripts/backup/autoBackup.sh', fs.existsSync(SCRIPT_PATH));
if (!fs.existsSync(SCRIPT_PATH)) {
  console.log('\n❌ ไม่มีสคริปต์ให้ตรวจ — หยุดตรงนี้');
  process.exit(1);
}
const mode = fs.statSync(SCRIPT_PATH).mode;
ok('สคริปต์รันได้ (มี execute bit)', (mode & 0o111) !== 0,
  (mode & 0o111) !== 0 ? '' : 'แก้ด้วย: chmod +x scripts/backup/autoBackup.sh');

const KEEP = shDefault('BACKUP_KEEP', 7);
const MIN_DUMP_MB = shDefault('BACKUP_MIN_DUMP_MB', 10);
const MIN_FREE_MB = shDefault('BACKUP_MIN_FREE_MB', 1024);
note(`เกณฑ์ที่อ่านจากสคริปต์: เก็บ ${KEEP} ไฟล์ · ไฟล์ต้อง ≥ ${MIN_DUMP_MB}MB · ที่ว่างต้อง ≥ ${MIN_FREE_MB}MB`);

console.log('\n── 2. cron ยังตั้งอยู่ไหม ──');
let cronLine = '';
try {
  const crontab = execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  cronLine = crontab.split('\n').find(l => l.includes(CRON_MARKER) && !l.trim().startsWith('#')) ?? '';
} catch {
  // crontab -l คืน exit 1 เมื่อไม่มี crontab เลย — ปล่อยให้ตกด่านข้างล่าง
}
ok('มีบรรทัด autobackup ใน crontab', cronLine !== '',
  cronLine !== '' ? '' : 'ติดตั้งด้วย: bash scripts/backup/installCron.sh');
if (cronLine) {
  note(cronLine.trim());
  const [mm, hh] = cronLine.trim().split(/\s+/);
  ok('บรรทัด cron ชี้ไปที่สคริปต์ที่มีอยู่จริง', cronLine.includes(SCRIPT_PATH),
    cronLine.includes(SCRIPT_PATH) ? `ทำงานเวลา ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ทุกวัน` : 'path ในบรรทัด cron ไม่ตรงกับสคริปต์ในรีโปนี้');
}

console.log('\n── 3. ไฟล์สำรองที่มีอยู่จริง ──');
ok('มีโฟลเดอร์ backup/', fs.existsSync(BACKUP_DIR));
const files = fs.existsSync(BACKUP_DIR)
  ? fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith(PREFIX) && f.endsWith('.dump'))
      .map(f => ({ name: f, ...fs.statSync(path.join(BACKUP_DIR, f)) }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
  : [];

ok('มีไฟล์สำรองอัตโนมัติอย่างน้อย 1 ไฟล์', files.length > 0,
  files.length > 0 ? `พบ ${files.length} ไฟล์` : 'ยังไม่เคยทำงานสำเร็จเลย — ลองสั่ง npm run backup:auto');

if (files.length > 0) {
  const latest = files[0];
  const ageH = (Date.now() - latest.mtimeMs) / 3_600_000;
  const sizeMb = latest.size / 1024 / 1024;
  note(`ล่าสุด: ${latest.name} (${sizeMb.toFixed(1)}MB · ${ageH.toFixed(1)} ชม.ที่แล้ว)`);

  // 25 ชม. = รอบวันละครั้ง + เผื่อเวลารันจริงคลาดจาก cron เล็กน้อย
  ok('ไฟล์ล่าสุดสดพอ (≤ 25 ชม.)', ageH <= 25,
    ageH <= 25 ? '' : `เก่าไป ${ageH.toFixed(1)} ชม. — ดูสาเหตุใน backup/autobackup.log`);
  ok(`ไฟล์ล่าสุดขนาดสมเหตุผล (≥ ${MIN_DUMP_MB}MB)`, sizeMb >= MIN_DUMP_MB, `${sizeMb.toFixed(1)}MB`);
  ok(`retention ทำงาน (ไม่เกิน ${KEEP} ไฟล์)`, files.length <= KEEP, `มี ${files.length} ไฟล์`);

  const totalMb = files.reduce((s, f) => s + f.size, 0) / 1024 / 1024;
  note(`ไฟล์อัตโนมัติทั้งหมดกินพื้นที่ ${totalMb.toFixed(0)}MB`);
}

console.log('\n── 4. ดิสก์ยังพอให้รอบหน้าไหม ──');
try {
  const out = execFileSync('df', ['-Pm', BACKUP_DIR], { encoding: 'utf8' });
  const freeMb = Number(out.trim().split('\n')[1].split(/\s+/)[3]);
  const latestMb = files.length > 0 ? files[0].size / 1024 / 1024 : 0;
  note(`ที่ว่าง ${freeMb}MB`);
  ok(`ที่ว่างเหนือเกณฑ์ที่สคริปต์ยอมทำงาน (≥ ${MIN_FREE_MB}MB)`, freeMb >= MIN_FREE_MB,
    freeMb >= MIN_FREE_MB ? '' : 'รอบถัดไปจะถูกปฏิเสธเพื่อไม่ให้ดิสก์เต็ม');
  if (latestMb > 0) {
    ok('พอสำหรับอีกอย่างน้อย 2 รอบ', freeMb >= latestMb * 2,
      `ต้องการ ~${(latestMb * 2).toFixed(0)}MB`);
  }
} catch (e) {
  failures++;
  console.log(`✗ FAIL  อ่านพื้นที่ว่างไม่ได้: ${e?.message ?? e}`);
}

console.log('\n── 5. ร่องรอยความล้มเหลวใน log ──');
const logFile = path.join(BACKUP_DIR, 'autobackup.log');
if (fs.existsSync(logFile)) {
  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
  const recentFails = lines.slice(-40).filter(l => l.includes('ล้มเหลว:'));
  ok('40 บรรทัดล่าสุดไม่มีรอบที่ล้มเหลว', recentFails.length === 0,
    recentFails.length === 0 ? '' : `พบ ${recentFails.length} บรรทัด`);
  recentFails.slice(-3).forEach(l => note(l));
  note(`บรรทัดล่าสุด: ${lines[lines.length - 1]}`);
} else {
  note('ยังไม่มี backup/autobackup.log — สคริปต์ยังไม่เคยถูกเรียก');
}

if (deep) {
  console.log('\n── 6. ไฟล์ล่าสุดกู้ได้จริงไหม (--deep) ──');
  if (files.length === 0) {
    ok('มีไฟล์ให้ตรวจ', false, 'ไม่มีไฟล์');
  } else {
    const latest = path.join(BACKUP_DIR, files[0].name);
    const inBox = '/tmp/diag_backup_verify.dump';
    try {
      // อ่านอย่างเดียวทั้งหมด: ยืม pg_restore ในกล่องมาเปิด TOC ของไฟล์ ไม่ได้แตะฐาน
      execFileSync('docker', ['compose', 'cp', latest, `db:${inBox}`], { cwd: PROJECT_DIR, stdio: 'ignore' });
      const toc = execFileSync('docker', ['compose', 'exec', '-T', 'db', 'pg_restore', '--list', inBox],
        { cwd: PROJECT_DIR, encoding: 'utf8' });
      const entries = toc.split('\n').filter(l => /^\d/.test(l)).length;
      ok('pg_restore อ่าน TOC ของไฟล์ล่าสุดได้', entries > 0, `${entries} รายการ`);
      const dbName = /dbname:\s*(\S+)/.exec(toc)?.[1];
      note(`ไฟล์นี้เป็นของฐาน "${dbName ?? 'ไม่ทราบ'}" · ${/Archive created at (.+)/.exec(toc)?.[1] ?? ''}`);
    } catch (e) {
      failures++;
      console.log(`✗ FAIL  ตรวจไฟล์ล่าสุดไม่ผ่าน: ${e?.message ?? e}`);
    } finally {
      try {
        execFileSync('docker', ['compose', 'exec', '-T', 'db', 'rm', '-f', inBox], { cwd: PROJECT_DIR, stdio: 'ignore' });
      } catch { /* container ไม่ขึ้นก็ไม่มีอะไรให้ลบ */ }
    }
  }
} else {
  console.log('\n(ข้ามการเปิดไฟล์จริง — สั่ง npm run diag:backup -- --deep เพื่อพิสูจน์ว่าไฟล์ล่าสุดกู้ได้)');
}

console.log(failures === 0 ? '\n✅ ผ่านทั้งหมด' : `\n❌ ไม่ผ่าน ${failures} ข้อ`);
process.exit(failures === 0 ? 0 : 1);
