// ─────────────────────────────────────────────────────────────────────────────
//  pricingDiff — ด่าน "แก้การคิดราคาแล้ว รหัสจริงตัวไหนเปลี่ยนบ้าง" (diag:pricing-diff)
//
//  คิดราคารหัสจริงทุกตัวในฐาน (products.model ตระกูล TS/BH) ด้วย **โค้ดก่อนแก้** กับ **โค้ดปัจจุบัน**
//  ต่อกันทันทีบนฐานเดียวกัน แล้วเทียบทีละรหัส — แบบเดียวกับ diag:line-parity
//  ไม่มีไฟล์เฉลย ⇒ ไม่เน่าตามข้อมูล (ฐานเปลี่ยนเท่าไหร่สองฝั่งก็เห็นเหมือนกัน · CLAUDE.md "ห้ามเพิ่มด่าน
//  ที่เทียบผลซึ่งขึ้นกับข้อมูลในฐานกับไฟล์ที่บันทึกไว้") · ที่มา: 2026-10-05 งาน "ไม่มีราคา ≠ ไม่รับผลิต"
//  วัดด้วยสคริปต์ชั่วคราวแล้วลบทิ้ง ⇒ งานซีรีส์ถัดไปต้องเขียนใหม่และนิยาม "เปลี่ยน" กันคนละแบบ
//
//  เกณฑ์ตก (exit 1) มีข้อเดียว: **รหัสที่โค้ดก่อนแก้ได้ราคาเต็ม (priced) แล้วโค้ดปัจจุบันได้ราคาอื่น
//  หรือไม่ได้ราคาเต็มแล้ว** — "ราคาเดิมห้ามขยับ" คือสิ่งที่เจ้าของถามทุกงาน
//  การเปลี่ยนอื่นทั้งหมด (ไม่รับผลิต → ขอราคา · ไม่มีรุ่น → ได้ราคา …) พิมพ์เป็นตารางให้อ่าน ไม่ตัดสิน
//  ตั้งใจให้ราคาเดิมเปลี่ยน (เช่นเจ้าของสั่งเปลี่ยนวิธีปัด) ⇒ `--expect-price-change` แล้วอ่านรายการเอง
//
//  โค้ดก่อนแก้ (base) เลือกเองแบบเดียวกับ diag:line-parity:
//    · อยู่บน branch ที่แยกจาก main  → merge-base กับ main (ครอบทั้งที่ commit แล้วและยังไม่ commit)
//    · อยู่บน main มีไฟล์แก้ค้าง      → HEAD
//    · อยู่บน main สะอาด             → HEAD^1 (สภาพก่อน commit/merge ล่าสุด)
//    · ระบุเอง `-- --base <ref>`
//
//  สมุดราคา: ทั้งสองฝั่งอ่านเล่มในฐาน + ตารางรหัสย่อยในฐาน (เหมือนหน้าคำนวณราคา)
//    · งานที่จะ **เขียนสมุดราคาลงฐาน** ด้วย (importer --catalog/--new-rules …) ให้สร้างเล่มใหม่เป็นไฟล์ก่อน
//      (`importer.ts … --out <ไฟล์.json>`) แล้ว `-- --head-book <ไฟล์.json>` ⇒ ฝั่งปัจจุบันคิดด้วยเล่มนั้น
//      ได้ผลกระทบก่อนเขียนฐานจริง · เปลี่ยนแค่เล่ม ไม่ได้แก้โค้ด ⇒ ใส่ `--base HEAD` คู่กัน
//
//  รัน:  npm run diag:pricing-diff                         (บน host — ต้องมี git · ~1 นาที)
//        npm run diag:pricing-diff -- --base <ref>
//        npm run diag:pricing-diff -- --head-book <เล่ม.json> [--base HEAD]
//        npm run diag:pricing-diff -- --examples 20         ตัวอย่างต่อกลุ่ม (ตั้งต้น 5)
//        npm run diag:pricing-diff -- --json <ไฟล์>         เขียนรายการเปลี่ยนทั้งหมดลงไฟล์
//        npm run diag:pricing-diff -- --expect-price-change ไม่ตกเมื่อราคาเดิมขยับ (ยังพิมพ์ครบ)
//
//  อ่านฐานอย่างเดียว · สร้าง worktree ชั่วคราวใน /tmp แล้วลบใน finally
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import type { Capture, Row } from './pricingDiffCapture.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', YEL = '\x1b[33m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';
const CAPTURE_REL = 'scripts/diag/pricingDiffCapture.ts';

const argv = process.argv.slice(2);
const val = (flag: string): string | undefined => { const i = argv.indexOf(flag); return i > -1 ? argv[i + 1] : undefined; };
const BASE_ARG = val('--base');
const HEAD_BOOK = val('--head-book');
const JSON_OUT = val('--json');
const EXAMPLES = Number(val('--examples') ?? 5);
const EXPECT_PRICE_CHANGE = argv.includes('--expect-price-change');

const git = (root: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function resolveBase(root: string): { ref: string; why: string } {
  if (BASE_ARG) return { ref: BASE_ARG, why: 'ระบุเองด้วย --base' };
  const head = git(root, 'rev-parse', 'HEAD');
  const main = (() => { try { git(root, 'rev-parse', '--verify', 'main'); return 'main'; } catch { return 'origin/main'; } })();
  const mb = git(root, 'merge-base', 'HEAD', main);
  if (mb !== head) return { ref: mb, why: `จุดแยกจาก ${main}` };
  if (git(root, 'status', '--porcelain', '--untracked-files=no') !== '') return { ref: 'HEAD', why: 'HEAD (มีไฟล์แก้ค้าง)' };
  return { ref: 'HEAD^1', why: 'ก่อน commit/merge ล่าสุดบน main' };
}

/** รันตัวเก็บผลในทรี `dir` เป็นโปรเซสแยก — import ของสองทรีจะได้ไม่ปนกัน */
function capture(dir: string, label: string, extra: string[] = []): Capture {
  const out = path.join(os.tmpdir(), `pricing-diff-${process.pid}-${Date.now()}.json`);
  const tsx = path.join(dir, 'node_modules', '.bin', 'tsx');
  const r = spawnSync(tsx, [CAPTURE_REL, out, ...extra], { cwd: dir, env: process.env, encoding: 'utf8', timeout: 600_000 });
  if (r.status !== 0 || !fs.existsSync(out)) {
    throw new Error(`คิดราคาบน${label}ไม่สำเร็จ (exit ${r.status ?? r.signal})\n${(r.stderr || r.stdout || '').slice(-2000)}`);
  }
  const data = JSON.parse(fs.readFileSync(out, 'utf8')) as Capture;
  fs.rmSync(out, { force: true });
  return data;
}

const TH: Record<string, string> = {
  priced: 'ได้ราคา', quoteOnRequest: 'ต้องขอราคา', notManufacturable: 'ไม่รับผลิต', noModel: 'ไม่มีรุ่นในสมุด', throw: 'โค้ดโยน error',
  missing: 'ไม่มีในฝั่งนี้',
};
const baht = (n: number | null) => (n === null ? '—' : n.toLocaleString());
const show = (r: Row | undefined) => (r ? `${TH[r[0]] ?? r[0]} ${baht(r[1])}${r[2] ? ` ${DIM}[${r[2]}]${RESET}` : ''}` : TH.missing);

async function main(): Promise<void> {
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel');
  const base = resolveBase(root);
  const baseSha = git(root, 'rev-parse', '--short', base.ref);
  console.log(`${BOLD}ด่านผลกระทบการคิดราคา — โค้ดก่อนแก้ vs โค้ดปัจจุบัน บนรหัสจริงทุกตัว${RESET}`);
  console.log(`${DIM}เทียบกับ ${baseSha} (${base.why}) — ${git(root, 'log', '-1', '--format=%s', base.ref).slice(0, 80)}${RESET}`);
  if (HEAD_BOOK && !fs.existsSync(HEAD_BOOK)) throw new Error(`ไม่พบไฟล์เล่ม ${HEAD_BOOK}`);

  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-diff-base-'));
  let before: Capture, after: Capture;
  try {
    fs.rmSync(wt, { recursive: true, force: true });
    git(root, 'worktree', 'add', '--detach', wt, base.ref);
    fs.symlinkSync(fs.realpathSync(path.join(root, 'node_modules')), path.join(wt, 'node_modules'));
    if (fs.existsSync(path.join(root, '.env'))) fs.copyFileSync(path.join(root, '.env'), path.join(wt, '.env'));
    // ตัวเก็บผลของ "ปัจจุบัน" ไปวางใน base ⇒ ย่อผลแบบเดียวกันทั้งสองฝั่ง
    fs.copyFileSync(path.join(root, CAPTURE_REL), path.join(wt, CAPTURE_REL));
    before = capture(wt, 'โค้ดก่อนแก้');
    after = capture(root, 'โค้ดปัจจุบัน', HEAD_BOOK ? ['--source', 'json', '--book', path.resolve(HEAD_BOOK)] : []);
  } finally {
    try { git(root, 'worktree', 'remove', '--force', wt); } catch { fs.rmSync(wt, { recursive: true, force: true }); git(root, 'worktree', 'prune'); }
  }
  console.log(`${DIM}เล่มฝั่งก่อนแก้: ${before.book}${RESET}`);
  console.log(`${DIM}เล่มฝั่งปัจจุบัน: ${after.book}${RESET}\n`);

  const codes = [...new Set([...Object.keys(before.rows), ...Object.keys(after.rows)])].sort();
  const groups = new Map<string, string[]>();
  const priceMoved: string[] = [];
  let same = 0;
  for (const code of codes) {
    const b = before.rows[code], a = after.rows[code];
    if (b && a && b[0] === a[0] && b[1] === a[1] && b[2] === a[2]) { same++; continue; }
    if (b?.[0] === 'priced' && !(a?.[0] === 'priced' && a[1] === b[1])) priceMoved.push(code);
    const key = `${b?.[0] ?? 'missing'} → ${a?.[0] ?? 'missing'}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(code);
  }

  const count = (c: Capture, s: string) => Object.values(c.rows).filter((r) => r[0] === s).length;
  console.log(`${BOLD}ภาพรวม${RESET} (รหัสจริง ${codes.length.toLocaleString()} ตัว)`);
  console.log(`  ${'สถานะ'.padEnd(18)}${'ก่อนแก้'.padStart(10)}${'ปัจจุบัน'.padStart(10)}`);
  for (const s of ['priced', 'quoteOnRequest', 'notManufacturable', 'noModel', 'throw']) {
    const x = count(before, s), y = count(after, s);
    if (x || y) console.log(`  ${(TH[s] ?? s).padEnd(18)}${x.toLocaleString().padStart(10)}${y.toLocaleString().padStart(10)}${x !== y ? `  ${YEL}${y - x > 0 ? '+' : ''}${(y - x).toLocaleString()}${RESET}` : ''}`);
  }
  console.log(`\n  เหมือนเดิมทุกช่อง ${same.toLocaleString()} · เปลี่ยน ${(codes.length - same).toLocaleString()}\n`);

  if (groups.size) {
    console.log(`${BOLD}รหัสที่เปลี่ยน แยกตามสถานะ${RESET} ${DIM}(ราคา · [ข้อติด]) — ตัวอย่างกลุ่มละ ${EXAMPLES}${RESET}`);
    for (const [key, list] of [...groups.entries()].sort((x, y) => y[1].length - x[1].length)) {
      const [f, t] = key.split(' → ');
      console.log(`\n  ${BOLD}${TH[f!] ?? f} → ${TH[t!] ?? t}${RESET}  ${list.length.toLocaleString()} รหัส`);
      for (const code of list.slice(0, EXAMPLES)) {
        console.log(`    ${code}\n      ${DIM}ก่อน${RESET} ${show(before.rows[code])}\n      ${DIM}หลัง${RESET} ${show(after.rows[code])}`);
      }
    }
    console.log('');
  }

  if (JSON_OUT) {
    const full = Object.fromEntries([...groups.entries()].map(([k, list]) =>
      [k, list.map((code) => ({ code, before: before.rows[code] ?? null, after: after.rows[code] ?? null }))]));
    fs.writeFileSync(JSON_OUT, JSON.stringify({ base: baseSha, books: { before: before.book, after: after.book }, changed: full }, null, 2));
    console.log(`${DIM}รายการเปลี่ยนทั้งหมดเขียนลง ${JSON_OUT}${RESET}\n`);
  }

  const bar = '─'.repeat(70);
  if (priceMoved.length === 0) {
    console.log(`${bar}\nสรุป: ${GREEN}ผ่าน${RESET} — รหัสที่เคยได้ราคาเต็ม ${count(before, 'priced').toLocaleString()} ตัว ราคาไม่ขยับสักตัว\n${bar}`);
  } else if (EXPECT_PRICE_CHANGE) {
    console.log(`${bar}\nสรุป: ${YEL}ราคาเดิมขยับ ${priceMoved.length.toLocaleString()} รหัส (ตั้งใจ · --expect-price-change)${RESET} — อ่านรายการข้างบนให้ครบก่อนสรุปกับเจ้าของ\n${bar}`);
  } else {
    console.log(`${bar}\nสรุป: ${RED}ตก${RESET} — รหัสที่เคยได้ราคาเต็ม ${priceMoved.length.toLocaleString()} ตัว ราคาเปลี่ยนหรือไม่ได้ราคาแล้ว` +
      `\n  ${DIM}ตั้งใจ (เจ้าของสั่งเปลี่ยนราคา) ⇒ รันซ้ำด้วย --expect-price-change${RESET}\n${bar}`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(`${RED}${(e as Error)?.message ?? e}${RESET}`); process.exitCode = 1; });
