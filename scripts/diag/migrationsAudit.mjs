// ตรวจว่า migration ทุกไฟล์ใน migrations/changes/ ลงฐานครบแล้วหรือยัง
//
// ── ทำไมไฟล์นี้เป็น .mjs ไม่ใช่ .ts เหมือน diag ตัวอื่น ────────────────────────
// diag ตัวอื่นรันด้วย `docker compose exec app npx tsx …` คือรัน "ข้างใน image"
// แต่ตัวนี้ต้องรันที่ **ขั้น 4 ของ DEPLOY.md ซึ่งอยู่ก่อน rebuild** ⇒ image ที่ยังรันอยู่
// เป็นของเก่าและไม่มีไฟล์ .sql ใหม่อยู่ข้างใน (Dockerfile ใช้ `COPY . .` ตอน build)
// ถ้าเขียนเป็น .ts แล้วรันในกล่อง มันจะอ่านรายชื่อ migration ของรุ่นเก่า แล้วบอกว่า
// "ครบแล้ว" ทุกครั้ง = ด่านที่ไม่มีวันจับอะไรได้เลย
//
// จึงรันบน host อ่านไฟล์จาก working tree (ซึ่ง `git pull` มาแล้วจึงเป็นรุ่นใหม่จริง)
// แล้วถาม DB ผ่าน `docker compose exec -T db psql` — ไม่พึ่ง node_modules สักตัว
// (วัด 2026-09-15: host ไม่มี tsx และ node_modules/.bin ว่างเปล่า)
//
// ── วิธีตรวจ ────────────────────────────────────────────────────────────────
// ไล่ทุกไฟล์เรียงตามชื่อ (= วันที่) แล้ว "เล่นซ้ำ" คำสั่ง DDL ตามลำดับที่มันปรากฏจริง
// CREATE = เพิ่มเข้าชุด · DROP = เอาออก · RENAME = เปลี่ยนชื่อในชุด
// ⇒ ได้ชุด object ที่ "ควรมีอยู่ตอนนี้" แล้วค่อยเทียบกับฐานจริงทีเดียว
//
// ที่ต้องเล่นตามลำดับเพราะของที่หายไปโดยตั้งใจมีอยู่จริงหลายตัว และถ้าตรวจทีละไฟล์
// แยกกันจะขึ้นแดงหมดทั้งที่ถูกต้องแล้ว (วัด 2026-09-15: 7 จาก 10 รายการที่ขึ้นว่า
// "ไม่มี" คือของที่ตั้งใจให้ไม่มี — customers_data ถูก DROP ทิ้งใน 2026-08-06_02
// ส่วน customers_data_view_new กับ index 2 ตัวถูก RENAME เป็นชื่อจริงตอนจบ build+swap)
// การเล่นซ้ำตามลำดับทำให้ไม่ต้องมีรายการยกเว้นที่ต้องเขียนมือ ซึ่งจะล้าสมัยเองอยู่ดี
//
// ── ข้อจำกัดที่รู้ตัว ────────────────────────────────────────────────────────
// ตรวจได้เฉพาะ "ของที่มีตัวตนใน catalog" — ตาราง คอลัมน์ index view function extension
// **ไม่ตรวจ** การเปลี่ยนนิยาม view, CHECK constraint, ข้อมูลที่ UPDATE/INSERT ลงไป
// ไฟล์ที่ทำแต่เรื่องพวกนั้นจึงขึ้นว่า "ไม่มี object ให้ตรวจ" ซึ่งไม่ใช่ความล้มเหลว
// (query ในขั้น 4 ของ DEPLOY.md ยังมีข้อเฉพาะกิจของบางไฟล์อยู่ ใช้คู่กัน)

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'migrations', 'changes');

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', b: '', x: '' };

// ── อ่านไฟล์ ────────────────────────────────────────────────────────────────

/** ตัด comment ออกก่อน ไม่งั้น DDL ที่ยกมาเป็นตัวอย่างใน comment จะถูกนับด้วย */
function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const norm = (n) => String(n).trim().replace(/;$/, '').replace(/^public\./i, '').replace(/"/g, '').toLowerCase();

/** ชื่อหลายตัวคั่นด้วยคอมมา เช่น `DROP INDEX a, b;` */
const names = (s) => s.split(',').map(norm).filter(Boolean);

// ── เล่นซ้ำ DDL ตามลำดับ ────────────────────────────────────────────────────
//
// เก็บเป็น Map<key, {kind, file}> โดย key ของคอลัมน์คือ "ตาราง.คอลัมน์"
// ค่า file = ไฟล์ล่าสุดที่ทำให้ object นี้ควรมีอยู่ ใช้บอกว่าต้องไปรันไฟล์ไหน

const have = new Map();
const add = (kind, name, file) => have.set(`${kind}:${name}`, { kind, name, file });
const del = (kind, name) => have.delete(`${kind}:${name}`);

/** เปลี่ยนชื่อตาราง = คอลัมน์ทุกตัวของมันย้ายตามไปด้วย */
function renameRelation(oldName, newName, file) {
  for (const [key, v] of [...have]) {
    if (v.kind === 'column' && v.name.startsWith(oldName + '.')) {
      have.delete(key);
      add('column', newName + '.' + v.name.slice(oldName.length + 1), file);
    }
  }
  for (const kind of ['table', 'view']) {
    if (have.has(`${kind}:${oldName}`)) {
      del(kind, oldName);
      add(kind, newName, file);
    }
  }
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const perFile = new Map(files.map((f) => [f, []]));

for (const file of files) {
  const sql = stripComments(readFileSync(join(DIR, file), 'utf8'));

  // เก็บทุก DDL ที่สนใจพร้อม "ตำแหน่งในไฟล์" แล้วค่อยเรียงตามตำแหน่ง
  // เพราะหลายไฟล์เขียน DROP ... IF EXISTS ไว้ก่อน CREATE ในไฟล์เดียวกัน
  const ops = [];
  const scan = (re, fn) => {
    for (const m of sql.matchAll(re)) ops.push({ at: m.index, run: () => fn(m) });
  };

  scan(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi,
    (m) => add('index', norm(m[1]), file));
  scan(/DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([\w."\s,]+?);/gi,
    (m) => names(m[1]).forEach((n) => del('index', n)));
  scan(/ALTER\s+INDEX\s+(?:IF\s+EXISTS\s+)?([\w."]+)\s+RENAME\s+TO\s+([\w."]+)/gi,
    (m) => { del('index', norm(m[1])); add('index', norm(m[2]), file); });

  scan(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi,
    (m) => add('table', norm(m[1]), file));
  scan(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."\s,]+?)[;\s]*(?:CASCADE)?;/gi,
    (m) => names(m[1]).forEach((n) => {
      del('table', n);
      for (const [key, v] of [...have]) if (v.kind === 'column' && v.name.startsWith(n + '.')) have.delete(key);
    }));

  scan(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi,
    (m) => add('view', norm(m[1]), file));
  scan(/DROP\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+EXISTS\s+)?([\w."\s,]+?)[;\s]*(?:CASCADE)?;/gi,
    (m) => names(m[1]).forEach((n) => del('view', n)));

  scan(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)\s*\(/gi,
    (m) => add('function', norm(m[1]), file));
  scan(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([\w."]+)/gi,
    (m) => del('function', norm(m[1])));

  scan(/CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi,
    (m) => add('extension', norm(m[1]), file));

  // ALTER TABLE — ตัวเดียวทำได้หลายอย่าง จึงอ่านทั้ง statement ถึง ';' แล้วแยกทีหลัง
  scan(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."]+)([^;]*);/gi, (m) => {
    const tbl = norm(m[1]);
    const body = m[2];
    const rn = body.match(/^\s*RENAME\s+TO\s+([\w."]+)/i);
    if (rn) return renameRelation(tbl, norm(rn[1]), file);
    const rc = body.match(/RENAME\s+COLUMN\s+([\w."]+)\s+TO\s+([\w."]+)/i);
    if (rc) { del('column', `${tbl}.${norm(rc[1])}`); add('column', `${tbl}.${norm(rc[2])}`, file); return; }
    for (const c of body.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi))
      add('column', `${tbl}.${norm(c[1])}`, file);
    for (const c of body.matchAll(/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([\w."]+)/gi))
      del('column', `${tbl}.${norm(c[1])}`);
  });

  ops.sort((a, b) => a.at - b.at);
  const before = new Set(have.keys());
  for (const op of ops) op.run();
  // object ที่ไฟล์นี้เป็นคนทำให้ "ควรมี" (ใช้รายงานว่าไฟล์ไหนยังไม่ได้รัน)
  for (const [key, v] of have) if (!before.has(key) || v.file === file) perFile.get(file).push(v);
}

// ── ถามฐานจริง ─────────────────────────────────────────────────────────────

function env() {
  const out = {};
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function checkExpr(v) {
  if (v.kind === 'column') {
    const [t, c] = v.name.split('.');
    return `EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}' AND column_name='${c}')`;
  }
  if (v.kind === 'function')
    return `EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='${v.name}')`;
  if (v.kind === 'extension') return `EXISTS(SELECT 1 FROM pg_extension WHERE extname='${v.name}')`;
  // table / view / index ใช้ to_regclass ตัวเดียวจบ — ชนิดของ relation เปลี่ยนได้ตามกาลเวลา
  // (customers_data_view เคยเป็น matview แล้วกลายเป็นตารางธรรมดาตอน build+swap)
  return `(to_regclass('public.${v.name}') IS NOT NULL)`;
}

const wanted = [...have.values()];
if (wanted.length === 0) {
  console.error('ไม่พบ object ให้ตรวจเลย — โฟลเดอร์ migrations/changes/ ว่างหรือ path ผิด');
  process.exit(1);
}

const e = env();
const query = wanted
  .map((v) => `SELECT '${v.kind}:${v.name}' AS k, ${checkExpr(v)} AS present`)
  .join(' UNION ALL ') + ';';

let raw;
try {
  raw = execFileSync('docker',
    ['compose', 'exec', '-T', 'db', 'psql', '-U', e.PG_USER, '-d', e.PG_DATABASE, '-t', '-A', '-F', '|', '-c', query],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
} catch (err) {
  console.error(`${C.r}ถาม DB ไม่สำเร็จ${C.x} — กล่อง db ขึ้นอยู่หรือเปล่า (docker compose ps)`);
  console.error(String(err.stderr || err.message).trim());
  process.exit(1);
}

const present = new Map();
for (const line of raw.split('\n')) {
  const i = line.lastIndexOf('|');
  if (i > 0) present.set(line.slice(0, i).trim(), line.slice(i + 1).trim() === 't');
}

// ── รายงาน ─────────────────────────────────────────────────────────────────

const missingByFile = new Map();
for (const v of wanted) {
  if (present.get(`${v.kind}:${v.name}`) === false) {
    if (!missingByFile.has(v.file)) missingByFile.set(v.file, []);
    missingByFile.get(v.file).push(v);
  }
}

const noObjects = files.filter((f) => perFile.get(f).length === 0);

console.log(`${C.b}ตรวจ migration เทียบกับฐานจริง${C.x}  ${C.d}${files.length} ไฟล์ · ${wanted.length} object ที่ควรมีอยู่ตอนนี้${C.x}`);
console.log();

if (noObjects.length) {
  console.log(`${C.d}ไฟล์ที่ไม่มี object ให้ตรวจ (แก้นิยาม/ข้อมูลอย่างเดียว) — ต้องดูด้วยตาเอง:${C.x}`);
  for (const f of noObjects) console.log(`${C.d}   · ${f}${C.x}`);
  console.log();
}

if (missingByFile.size === 0) {
  console.log(`${C.g}✅ ครบทุกไฟล์${C.x} — ไม่มี object ไหนที่ migration สร้างไว้แล้วหายไปจากฐาน`);
  process.exit(0);
}

console.log(`${C.r}${C.b}✗ มี migration ที่ยังไม่ได้รัน ${missingByFile.size} ไฟล์${C.x}`);
console.log();
for (const [file, list] of [...missingByFile].sort()) {
  console.log(`${C.r}   ${file}${C.x}`);
  for (const v of list) console.log(`      ${C.d}ขาด ${v.kind}${C.x} ${v.name}`);
}
console.log();
console.log(`${C.y}รันเรียงตามชื่อไฟล์ ด้วย psql เท่านั้น (ห้าม runMigration.ts — ดู DEPLOY.md ขั้น 4):${C.x}`);
console.log(`   set -a; source .env; set +a`);
for (const file of [...missingByFile.keys()].sort())
  console.log(`   docker compose exec -T db psql -U "$PG_USER" -d "$PG_DATABASE" -v ON_ERROR_STOP=1 -f - < migrations/changes/${file}`);
process.exit(1);
