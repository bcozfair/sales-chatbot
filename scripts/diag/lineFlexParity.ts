// ─────────────────────────────────────────────────────────────────────────────
//  lineFlexParity — ด่าน "แก้โค้ดแล้ว ข้อความที่บอทตอบใน LINE เปลี่ยนไหม"
//  (เกิดจากเฟส C: docs/plan-web-quote-request.md §6.0 → "ด่าน LINE จริงของเฟส C")
//
//  สองส่วน:
//   1. prompt ของตัวสกัด ต้องเหมือน fixtures/extractionPrompt.golden.txt ทุกตัวอักษร
//      — ไฟล์นี้ขึ้นกับโค้ดล้วน ไม่มีข้อมูลจากฐาน ⇒ ไม่เน่าเอง แก้ prompt = ตั้งใจเสมอ
//   2. ยิง 3 เคสเข้า handleEvent ตัวจริง (lineFlexCapture.ts) บน **โค้ดก่อนแก้** และ **โค้ดปัจจุบัน**
//      ต่อกันทันทีบนฐานเดียวกัน แล้วเทียบก้อน JSON ที่จะส่งให้ LINE ทีละตัวอักษร
//
//  ทำไมไม่เทียบกับไฟล์ golden ของผลลัพธ์แล้ว (เปลี่ยน 2026-09-25): ผลของเคสขึ้นกับสต็อก/ราคา/กฎ
//  ในฐานจริง ⇒ golden ที่บันทึก 2026-09-08 เน่าเองโดยโค้ดไม่ได้เปลี่ยน — ล้มมาแล้วอย่างน้อยสองรอบ
//  (docs/plan-web-quote-logging.md: case2 · 2026-09-25: KR-Q50NW ของหมดจน case1 กลายเป็นข้อความ
//  บล็อก, KM-09N-A สต็อก 0 → 40) · การ mask ตัวเลขไม่ช่วย เพราะรูปร่างของคำตอบเปลี่ยนตามข้อมูล
//  ⇒ ให้ "โค้ดก่อนแก้ ณ วันนี้" เป็นเฉลยแทน: ข้อมูลเปลี่ยนเท่าไหร่สองฝั่งก็เห็นเหมือนกัน
//
//  โค้ดก่อนแก้ (base) เลือกเอง ไม่ต้องจำ:
//    · อยู่บน branch ที่แยกจาก main  → merge-base กับ main (ครอบทั้งที่ commit แล้วและยังไม่ commit)
//    · อยู่บน main มีไฟล์แก้ค้าง      → HEAD
//    · อยู่บน main สะอาด             → HEAD^1 (สภาพก่อน commit/merge ล่าสุด)
//    · ระบุเอง `-- --base <ref>`
//  base = โค้ดเดียวกับปัจจุบัน (ไม่มีอะไรเปลี่ยน) ⇒ ยังตรวจ "ทุกเคสได้คำตอบ ไม่ใช่ข้อความระบบขัดข้อง" ให้
//
//  รัน:  npm run diag:line-parity                  (บน host — ต้องมี git · ไม่ใช่ในกล่อง docker)
//        npm run diag:line-parity -- --base <ref>
//        npm run diag:line-parity -- --print       ดูผลดิบของโค้ดปัจจุบันที่ normalize แล้ว
//
//  ⚠️ ด่านนี้ครอบแค่ "ก้อน JSON ที่จะส่งให้ LINE" — ไม่ครอบ LINE SDK · reply token จริง ·
//     การเรนเดอร์ Flex บนมือถือ · webhook signature (ยังต้องยิงจริงที่ server ตอน deploy)
//  ผลข้างเคียง: **commit แถวจริง** salesperson/messages/quotations ของ user ทดสอบแล้วลบใน finally
//               (สองรอบต่อการรัน · ต้องขอเจ้าของก่อน — AGENTS.md) · ค่าใช้จ่าย LLM ~8-16 call
//  ต่างกันรอบแรก = รันทั้งสองฝั่งซ้ำอีก 1 รอบ (LLM ไม่ deterministic 100%) · ล้มจริง = ต่างทั้งสองรอบ
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { pool } from '../../config/db.js';
import { buildExtractionPrompt } from '../../services/quoteExtraction.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', YEL = '\x1b[33m', RESET = '\x1b[0m';

const PRINT = process.argv.includes('--print');
const baseArgIdx = process.argv.indexOf('--base');
const BASE_ARG = baseArgIdx >= 0 ? process.argv[baseArgIdx + 1] : undefined;
const PROMPT_GOLDEN_PATH = path.join(process.cwd(), 'scripts', 'diag', 'fixtures', 'extractionPrompt.golden.txt');
const CAPTURE_REL = path.join('scripts', 'diag', 'lineFlexCapture.ts');
const TEST_USER = 'U' + 'd1a9' + '0'.repeat(28); // ต้องตรงกับ lineFlexCapture.ts — ใช้ล้างตกค้างเท่านั้น
const FALLBACK_TEXT = 'ระบบขัดข้อง';

type Capture = Record<string, { output: string; kinds: string; count: number; ms: number }>;

/**
 * ตัด \r ทิ้งก่อนเทียบเสมอ — git ตั้ง `* text=auto` ไว้ ⇒ golden ของ prompt ถูกเก็บเป็น LF ในรีโป
 * แต่ตอน checkout บน Windows กลายเป็น CRLF · ถ้าเทียบดิบ ๆ ด่านจะล้มทั้งที่โค้ดไม่ได้เปลี่ยน
 */
const lf = (s: string): string => s.replace(/\r\n/g, '\n');

const git = (root: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function resolveBase(root: string): { ref: string; why: string } {
  if (BASE_ARG) return { ref: BASE_ARG, why: 'ระบุเองด้วย --base' };
  const head = git(root, 'rev-parse', 'HEAD');
  const main = (() => { try { git(root, 'rev-parse', '--verify', 'main'); return 'main'; } catch { return 'origin/main'; } })();
  const mb = git(root, 'merge-base', 'HEAD', main);
  if (mb !== head) return { ref: mb, why: `จุดแยกจาก ${main}` };
  const dirty = git(root, 'status', '--porcelain', '--untracked-files=no') !== '';
  if (dirty) return { ref: 'HEAD', why: 'HEAD (มีไฟล์แก้ค้าง)' };
  return { ref: 'HEAD^1', why: 'ก่อน commit/merge ล่าสุดบน main' };
}

/** รัน lineFlexCapture ในทรี `dir` (โปรเซสแยก — import ของแต่ละทรีจะได้ไม่ปนกัน) */
function capture(dir: string, label: string): Capture {
  const out = path.join(os.tmpdir(), `line-parity-${label}-${process.pid}-${Date.now()}.json`);
  const tsx = path.join(dir, 'node_modules', '.bin', 'tsx');
  const r = spawnSync(tsx, [CAPTURE_REL, out], { cwd: dir, env: process.env, encoding: 'utf8', timeout: 300_000 });
  if (r.status !== 0 || !fs.existsSync(out)) {
    throw new Error(`รันเคสบน${label}ไม่สำเร็จ (exit ${r.status ?? r.signal})\n${(r.stderr || r.stdout || '').slice(-2000)}`);
  }
  const data = JSON.parse(fs.readFileSync(out, 'utf8')) as Capture;
  fs.rmSync(out, { force: true });
  return data;
}

function showDiff(want: string, got: string) {
  const wl = want.split('\n'), gl = got.split('\n');
  for (let i = 0, shown = 0; i < Math.max(wl.length, gl.length) && shown < 12; i++) {
    if (wl[i] !== gl[i]) {
      console.log(`   ${DIM}บรรทัด ${i + 1}${RESET}\n   ${RED}- ${wl[i] ?? '(ไม่มี)'}${RESET}\n   ${GREEN}+ ${gl[i] ?? '(ไม่มี)'}${RESET}`);
      shown++;
    }
  }
}

async function main() {
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel');
  console.log(`${BOLD}ด่านจำลอง LINE — โค้ดก่อนแก้ vs โค้ดปัจจุบัน บนฐานเดียวกัน${RESET}  user=${DIM}${TEST_USER}${RESET}`);

  // ── ส่วนที่ 1: prompt ต้องเหมือนก่อนย้ายทุกตัวอักษร (รวมช่องว่างท้ายบรรทัด) ──
  const want = lf(fs.readFileSync(PROMPT_GOLDEN_PATH, 'utf8'));
  const got = lf(buildExtractionPrompt('<<CONTENT>>', '<<HISTORY>>'));
  const promptOk = want === got;
  if (promptOk) {
    console.log(`\n${GREEN}✓${RESET} prompt เหมือนก่อนย้ายทุกตัวอักษร (${got.length} ตัวอักษร)`);
  } else {
    console.log(`\n${RED}✗${RESET} prompt ต่างจากก่อนย้าย — ${want.length} → ${got.length} ตัวอักษร`);
    showDiff(want, got);
  }

  // ── ส่วนที่ 2: เคส handleEvent บนสองโค้ด ──
  const base = resolveBase(root);
  const baseSha = git(root, 'rev-parse', '--short', base.ref);
  console.log(`${DIM}เทียบกับ ${baseSha} (${base.why}) — ${git(root, 'log', '-1', '--format=%s', base.ref).slice(0, 80)}${RESET}\n`);

  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'line-parity-base-'));
  let pass = promptOk ? 1 : 0, fail = promptOk ? 0 : 1;
  let head: Capture = {};
  try {
    fs.rmSync(wt, { recursive: true, force: true });
    git(root, 'worktree', 'add', '--detach', wt, base.ref);
    fs.symlinkSync(fs.realpathSync(path.join(root, 'node_modules')), path.join(wt, 'node_modules'));
    if (fs.existsSync(path.join(root, '.env'))) fs.copyFileSync(path.join(root, '.env'), path.join(wt, '.env'));
    // ตัวรันเคสของ "ปัจจุบัน" ไปวางใน base ⇒ ทั้งสองฝั่งยิงเคสชุดเดียวกัน normalize แบบเดียวกัน
    fs.copyFileSync(path.join(root, CAPTURE_REL), path.join(wt, CAPTURE_REL));

    const rounds: { base: Capture; head: Capture }[] = [];
    const runRound = () => {
      const b = capture(wt, 'โค้ดก่อนแก้');
      const h = capture(root, 'โค้ดปัจจุบัน');
      rounds.push({ base: b, head: h });
      return Object.keys(h).filter((k) => b[k]?.output !== h[k]!.output);
    };
    let diffs = runRound();
    if (diffs.length) {
      console.log(`${YEL}รอบแรกต่างกัน ${diffs.length} เคส — รันทั้งสองฝั่งซ้ำอีกรอบ (LLM ไม่ deterministic 100%)${RESET}`);
      const again = runRound();
      diffs = diffs.filter((k) => again.includes(k));
    }
    head = rounds.at(-1)!.head;

    for (const [key, h] of Object.entries(head)) {
      const b = rounds.at(-1)!.base[key];
      const broken = h.count === 0 || h.output.includes(FALLBACK_TEXT);
      if (diffs.includes(key)) {
        fail++;
        console.log(`${RED}✗${RESET} ${key} — ต่างจากโค้ดก่อนแก้ทั้งสองรอบ ${DIM}(${b?.kinds} → ${h.kinds})${RESET}`);
        showDiff(b?.output ?? '', h.output);
      } else if (broken) {
        fail++;
        console.log(`${RED}✗${RESET} ${key} — ไม่ได้คำตอบที่ใช้ได้ (${h.count === 0 ? 'ไม่มีข้อความตอบกลับ' : `มีข้อความ "${FALLBACK_TEXT}"`})`);
      } else {
        pass++;
        console.log(`${GREEN}✓${RESET} ${key} — เหมือนโค้ดก่อนแก้ทุกตัวอักษร ${DIM}(${h.kinds} · ${h.output.length} ตัวอักษร · ${h.ms}ms)${RESET}`);
      }
    }
  } finally {
    try { git(root, 'worktree', 'remove', '--force', wt); } catch { fs.rmSync(wt, { recursive: true, force: true }); git(root, 'worktree', 'prune'); }
    // กันตกค้างถ้าโปรเซสลูกถูกฆ่ากลางคัน (ลูกลบเองใน finally อยู่แล้ว)
    await pool.query('DELETE FROM quotations WHERE user_id = $1', [TEST_USER]);
    await pool.query('DELETE FROM messages WHERE user_id = $1', [TEST_USER]);
    await pool.query('DELETE FROM salesperson WHERE user_id = $1', [TEST_USER]);
  }

  if (PRINT) for (const [k, h] of Object.entries(head)) console.log(`\n${BOLD}── ${k} ──${RESET}\n${h.output}`);

  console.log(`\n${BOLD}สรุป:${RESET} ${GREEN}ผ่าน ${pass}${RESET} · ${fail > 0 ? RED : DIM}ล้ม ${fail}${RESET} ${DIM}(prompt 1 + เคส ${Object.keys(head).length})${RESET}`);
  if (fail > 0) console.log(`${DIM}ต่างกันเพราะตั้งใจแก้ Flex/ข้อความ = ตรวจ diff ข้างบนว่าตรงกับที่ตั้งใจ แล้วบันทึกไว้ในคอมมิต${RESET}`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(`${RED}ด่านล้มเหลว:${RESET}`, e?.message || e);
  await pool.end().catch(() => {});
  process.exit(1);
});
