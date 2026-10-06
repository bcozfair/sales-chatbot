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
//    · งานที่จะเขียน **แถวรหัสย่อยจาก catalog-subcodes.json** ด้วย (`seedCatalogSubcodes --apply` · รุ่นใหม่ TS_-02 2026-10-05)
//      ใส่ `--head-seed-subcodes` ⇒ ฝั่งปัจจุบันเติมแถวที่ฐานยังไม่มี (แถวในฐานชนะไฟล์) · ฝั่งก่อนแก้ใช้ตารางในฐานล้วนเหมือนเดิม
//
//  **เทียบราคาในฐาน** (เจ้าของสั่ง 2026-10-06 · `services/pricingLab/README.md` "รายงานผลกับรหัสจริง") — พิมพ์ต่อท้ายทุกครั้ง:
//  รหัสที่เปลี่ยนแล้ว "ได้ราคาเต็ม" เทียบกับ `products.sales_price` ของรหัสเดียวกัน · **ไม่ใช่เฉลย** (ราคายึด Excel) ไม่มีผลกับผ่าน/ตก
//  ใช้หาความผิดปกติ (`TSK-03 5x1,000+1M` ระบบ 450 / ฐาน 1,400 = อ่าน `1,000` เป็น 1 mm — diff มองไม่เห็นเพราะได้ราคาเต็ม)
//    · `--near-all`                 เทียบรหัสที่ได้ราคาเต็มทั้งชุด (ไม่ใช่แค่ที่เปลี่ยน) — ดูภาพรวมของทั้งตระกูล
//    · `--near-group <ชื่อ>=<regex>` แยกกลุ่มย่อยตามเรื่องที่แก้ (ใส่ได้หลายครั้ง) เช่น `--near-group 'ตัว L=-\d{2}L'`
//
//  รัน:  npm run diag:pricing-diff                         (บน host — ต้องมี git · ~1 นาที)
//        npm run diag:pricing-diff -- --base <ref>
//        npm run diag:pricing-diff -- --head-book <เล่ม.json> [--head-seed-subcodes] [--base HEAD]
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
const HEAD_SEED = argv.includes('--head-seed-subcodes');
const JSON_OUT = val('--json');
const EXAMPLES = Number(val('--examples') ?? 5);
const EXPECT_PRICE_CHANGE = argv.includes('--expect-price-change');
const NEAR_ALL = argv.includes('--near-all');
/** `--near-group <ชื่อ>=<regex>` (ใส่ได้หลายครั้ง) — กลุ่มย่อยของส่วนเทียบราคาในฐาน */
const NEAR_GROUPS: [string, RegExp][] = argv.flatMap((a, i) => {
  if (a !== '--near-group' || !argv[i + 1]) return [];
  const v = argv[i + 1]!;
  const eq = v.indexOf('=');
  if (eq < 1) throw new Error(`--near-group ต้องเป็น <ชื่อ>=<regex> (ได้ "${v}")`);
  return [[v.slice(0, eq), new RegExp(v.slice(eq + 1), 'i')] as [string, RegExp]];
});

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

/** ร้อยละห่างจากราคาในฐาน (ระบบ − ฐาน) ÷ ฐาน */
const pctOf = (sys: number, base: number) => (sys - base) / base;
const fmtPct = (x: number) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(x !== 0 && Math.abs(x) < 0.1 ? 1 : 0)}%`;
const isExact = (sys: number, base: number) => Math.abs(sys - base) < 0.005;

interface NearStats {
  n: number; withDb: number; noDb: number; multi: number;
  exact: number; le5: number; le20: number; over20: number; low: number; high: number; median: number | null;
}

/** สถิติความใกล้เคียงของชุดรหัสที่ได้ราคาเต็ม — นิยามเดียวกับ `services/pricingLab/README.md` "รายงานผลกับรหัสจริง" */
function nearStats(list: string[], price: (c: string) => number | null, db: Record<string, number[]>): NearStats & { pairs: [string, number, number, number][] } {
  const pairs: [string, number, number, number][] = [];
  let noDb = 0, multi = 0;
  for (const code of list) {
    const sys = price(code);
    if (sys === null) continue;
    const p = db[code] ?? [];
    if (p.length === 0) { noDb++; continue; }
    if (p.length > 1) { multi++; continue; }
    pairs.push([code, sys, p[0]!, pctOf(sys, p[0]!)]);
  }
  const ratios = pairs.map(([, s, b]) => s / b).sort((x, y) => x - y);
  const mid = ratios.length >> 1;
  return {
    pairs, n: list.length, withDb: pairs.length, noDb, multi,
    exact: pairs.filter(([, s, b]) => isExact(s, b)).length,
    le5: pairs.filter(([, s, b, x]) => !isExact(s, b) && Math.abs(x) <= 0.05).length,
    le20: pairs.filter(([, , , x]) => Math.abs(x) > 0.05 && Math.abs(x) <= 0.2).length,
    over20: pairs.filter(([, , , x]) => Math.abs(x) > 0.2).length,
    low: pairs.filter(([, , , x]) => x < -0.2).length,
    high: pairs.filter(([, , , x]) => x > 0.2).length,
    median: ratios.length ? (ratios.length % 2 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2) : null,
  };
}

/**
 * พิมพ์ส่วน "เทียบราคาในฐาน" — ขอบเขต: รหัสที่เปลี่ยนแล้วได้ราคาเต็ม (ทั้งชุดเมื่อ `--near-all`) · ขอราคา = บอกแค่จำนวน
 * (ราคาเท่าที่คิดได้ไม่ใช่ราคาทั้งชิ้น) · ราคาเดิมที่ขยับบอกว่าใกล้ฐานขึ้นหรือห่างขึ้น · คืนก้อนสรุปไว้ลงไฟล์ `--json`
 */
function reportNear(codes: string[], before: Capture, after: Capture, db: Record<string, number[]>, groups: Map<string, string[]>) {
  const changed = new Set([...groups.values()].flat());
  const inScope = (c: string) => NEAR_ALL || changed.has(c);
  const scope = codes.filter((c) => inScope(c) && after.rows[c]?.[0] === 'priced');
  const asked = codes.filter((c) => inScope(c) && after.rows[c]?.[0] === 'quoteOnRequest').length;
  const priceAfter = (c: string) => after.rows[c]?.[1] ?? null;
  console.log(`${BOLD}เทียบราคาในฐาน (products.sales_price)${RESET} ${DIM}— ไม่ใช่เฉลย (ราคายึด Excel) · ใช้หาความผิดปกติ · ไม่มีผลกับผ่าน/ตก${RESET}`);
  if (!Object.keys(db).length) {
    console.log(`  ${YEL}ตัวเก็บผลไม่ได้ส่งราคาในฐานมา — ข้าม${RESET}\n`);
    return null;
  }
  const all = nearStats(scope, priceAfter, db);
  const line = (st: NearStats) =>
    `ตรงเป๊ะ ${st.exact} · ห่าง ≤ 5% ${st.le5} · 5–20% ${st.le20} · > 20% ${st.over20} (ระบบต่ำกว่า ${st.low} / สูงกว่า ${st.high})` +
    ` · มัธยฐาน ระบบ÷ฐาน ${st.median === null ? '—' : st.median.toFixed(2)}`;
  console.log(`  ขอบเขต: ${NEAR_ALL ? 'รหัสที่ได้ราคาเต็มทั้งชุด' : 'รหัสที่เปลี่ยนแล้วได้ราคาเต็ม'} ${all.n.toLocaleString()} · มีราคาในฐาน ${all.withDb.toLocaleString()}` +
    ` (ไม่มี ${all.noDb} · หลายราคา ${all.multi}) · ขอราคา ${asked.toLocaleString()} ไม่เทียบ`);
  const { pairs, ...summary } = all;
  if (!pairs.length) { console.log(''); return { scope: NEAR_ALL ? 'all-priced' : 'changed-priced', asked, ...summary, top: [] }; }
  console.log(`  ${line(all)}`);
  // แยกกลุ่ม: ตามการเปลี่ยนสถานะ (ไม่มีรุ่น → ได้ราคา · ได้ราคา → ได้ราคา …) + กลุ่มที่ผู้รันตั้งเอง (`--near-group`)
  const sub: [string, string[]][] = [
    ...(NEAR_ALL ? [] : [...groups.entries()].filter(([k]) => k.endsWith('→ priced'))
      .map(([k, l]) => [`${TH[k.split(' → ')[0]!] ?? k} → ได้ราคา`, l] as [string, string[]])),
    ...NEAR_GROUPS.map(([name, re]) => [name, scope.filter((c) => re.test(c))] as [string, string[]]),
  ];
  if (sub.length > 1 || NEAR_GROUPS.length) {
    for (const [name, list] of sub) {
      const st = nearStats(list, priceAfter, db);
      if (st.withDb) console.log(`    ${DIM}${name}${RESET} ${st.withDb.toLocaleString()} ตัว: ${line(st)}`);
    }
  }
  // ราคาเดิมขยับ (ตั้งใจ) — การแก้ทำให้ใกล้ราคาที่ขายจริงขึ้นหรือห่างขึ้น
  const moved = pairs.filter(([c]) => before.rows[c]?.[0] === 'priced' && before.rows[c]?.[1] !== after.rows[c]?.[1]);
  if (moved.length) {
    let closer = 0, further = 0, even = 0;
    for (const [c, s, b] of moved) {
      const d0 = Math.abs((before.rows[c]![1] ?? 0) - b), d1 = Math.abs(s - b);
      if (d1 < d0) closer++; else if (d1 > d0) further++; else even++;
    }
    console.log(`  ราคาเดิมที่ขยับ ${moved.length.toLocaleString()} ตัว: ใกล้ฐานขึ้น ${closer} · ห่างขึ้น ${further} · เท่าเดิม ${even}`);
  }
  const top = [...pairs].sort((x, y) => Math.abs(y[3]) - Math.abs(x[3])).slice(0, EXAMPLES);
  console.log(`  ห่างที่สุด ${top.length} ตัว ${DIM}(ดูทุกครั้งก่อนรายงาน — ต่างโดยตั้งใจ / อ่านรหัสพลาด / ยังไม่รู้)${RESET}`);
  for (const [c, s, b, x] of top) console.log(`    ${c}  ${DIM}ระบบ${RESET} ${baht(s)} ${DIM}/ ฐาน${RESET} ${baht(b)}  ${Math.abs(x) > 0.2 ? YEL : ''}${fmtPct(x)}${RESET}`);
  console.log('');
  return { scope: NEAR_ALL ? 'all-priced' : 'changed-priced', asked, ...summary, top: top.map(([code, sys, base, pct]) => ({ code, sys, base, pct })) };
}

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
    after = capture(root, 'โค้ดปัจจุบัน', [
      ...(HEAD_BOOK ? ['--source', 'json', '--book', path.resolve(HEAD_BOOK)] : []),
      ...(HEAD_SEED ? ['--seed-subcodes'] : []),
    ]);
  } finally {
    try { git(root, 'worktree', 'remove', '--force', wt); } catch { fs.rmSync(wt, { recursive: true, force: true }); git(root, 'worktree', 'prune'); }
  }
  console.log(`${DIM}เล่มฝั่งก่อนแก้: ${before.book}${RESET}`);
  console.log(`${DIM}เล่มฝั่งปัจจุบัน: ${after.book}${HEAD_SEED ? ' + แถวรหัสย่อยจาก catalog-subcodes.json ที่ฐานยังไม่มี' : ''}${RESET}\n`);

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

  // ── เทียบราคาในฐาน (products.sales_price) — เจ้าของสั่ง 2026-10-06 · ไม่ใช่เฉลย ไม่มีผลกับผ่าน/ตก ──────────
  const db = after.db ?? before.db ?? {};
  const near = reportNear(codes, before, after, db, groups);

  if (JSON_OUT) {
    const full = Object.fromEntries([...groups.entries()].map(([k, list]) =>
      [k, list.map((code) => ({ code, before: before.rows[code] ?? null, after: after.rows[code] ?? null, db: db[code] ?? null }))]));
    fs.writeFileSync(JSON_OUT, JSON.stringify({ base: baseSha, books: { before: before.book, after: after.book }, changed: full, near }, null, 2));
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
