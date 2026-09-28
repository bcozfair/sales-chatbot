// ─────────────────────────────────────────────────────────────────────────────
//  customerCacheMemo — ด่านของ memo ใน cache ค้นหาลูกค้า (startCustomerCacheLoad · 2026-09-28)
//
//  ตอบคำถามเดียว: "cache ที่โหลดซ้ำโดยยืม norm_name/trigrams ของรอบก่อน เหมือน cache ที่โหลดสด
//  จากศูนย์ด้วยโค้ดก่อนแก้ ทุกแถวทุก field ไหม — และค้นหาได้ผลเดียวกันไหม"
//
//  เทียบกับ **โค้ดก่อนแก้บนข้อมูลชุดเดียวกัน** ไม่ใช่ golden file (CLAUDE.md: golden ของผลที่ขึ้นกับ
//  ข้อมูลในฐานเน่าเอง) — สร้างสำเนาทดสอบสองตัวจาก services/customerService.ts ตอนรันแล้วลบทิ้ง:
//    BASE = โค้ดก่อนแก้ (git show <base>:services/customerService.ts)
//    HEAD = ไฟล์ในทรีตอนนี้ (รวมที่ยังไม่ commit)
//  สำเนาต่างจากของจริงแค่ (1) สลับแหล่งแถวได้ (ป้อนแถวจากหน่วยความจำแทน pool.query)
//  (2) เปิดช่องดูสถานะ cache · หาจุดแปลงไม่เจอ = โยน error (ดีกว่าเงียบ ๆ แล้วทดสอบโค้ดผิดตัว)
//
//  base เลือกเองแบบเดียวกับ diag:line-parity:
//    · อยู่บน branch ที่แยกจาก main → merge-base กับ main
//    · อยู่บน main มีไฟล์แก้ค้าง     → HEAD
//    · อยู่บน main สะอาด            → HEAD^1
//    · ระบุเอง `-- --base <ref>`
//  base = โค้ดเดียวกับปัจจุบัน ⇒ ยังตรวจ "โหลดซ้ำ (ใช้ memo) = โหลดสด (ไม่ใช้ memo)" ของโค้ดเดียวกันให้
//
//  ฉาก (แก้แถวในหน่วยความจำเท่านั้น): ไม่เปลี่ยน · ชื่อเปลี่ยน/ชนกัน/หาย/null→มีชื่อ · ฟิลด์อื่นเปลี่ยน
//  ชื่อเดิม · บริษัทหาย · บริษัทใหม่ (ชื่อซ้ำของเดิมด้วย) · กลับเหมือนเดิม · แล้วอ่านฐานจริงอีกรอบ
//  + พฤติกรรม cache (gen · loadedAt · โหลดซ้อน · TTL หมดแล้ว clear กลางคัน · โหลดล้ม) ต้องเหมือน BASE
//
//  รัน:  npm run diag:customer-cache-memo              (บน host — ต้องมี git)
//        npm run diag:customer-cache-memo -- --base <ref>
//  ผลข้างเคียง: **อ่านฐานอย่างเดียว** (SELECT จาก customers_data_view 2 ครั้ง) · เขียนไฟล์ชั่วคราว
//  services/__cacheMemo{Base,Head}.gen.ts แล้วลบใน finally · รอให้พ้นช่วง sync (:x9:50–:x0:50) ก่อนอ่าน
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool } from '../../config/db.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_REL = 'services/customerService.ts';
const BASE_GEN = join(ROOT, 'services', '__cacheMemoBase.gen.ts');
const HEAD_GEN = join(ROOT, 'services', '__cacheMemoHead.gen.ts');

const ESC = String.fromCharCode(27);
const G = ESC + '[32m', R = ESC + '[31m', D = ESC + '[2m', B = ESC + '[1m', X = ESC + '[0m';

const argIdx = process.argv.indexOf('--base');
const BASE_ARG = argIdx >= 0 ? process.argv[argIdx + 1] : undefined;

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }).trim();

function resolveBase(): { ref: string; why: string } {
  if (BASE_ARG) return { ref: BASE_ARG, why: 'ระบุเองด้วย --base' };
  const head = git('rev-parse', 'HEAD');
  const main = (() => { try { git('rev-parse', '--verify', 'main'); return 'main'; } catch { return 'origin/main'; } })();
  const mb = git('merge-base', 'HEAD', main);
  if (mb !== head) return { ref: mb, why: `จุดแยกจาก ${main}` };
  if (git('status', '--porcelain', '--untracked-files=no') !== '') return { ref: 'HEAD', why: 'HEAD (มีไฟล์แก้ค้าง)' };
  return { ref: 'HEAD^1', why: 'ก่อน commit/merge ล่าสุดบน main' };
}

// ─── สำเนาทดสอบ: แปลงเหมือนกันทั้งสองตัว ───
const IMPORT_LINE = "import { buildAddressParts } from '../utils/address.js';";
const QUERY_LINE = 'const { rows } = await pool.query(`';
const CLEAR_FN = [
  'export function clearCustomerSearchCache(): void {',
  '  customerCacheGen++;',
  '  customerCache = null;',
  '  customerCacheLoading = null;',
  '}',
].join('\n');
const HOOK_SRC = `
// ─── [DIAG ONLY · scripts/diag/customerCacheMemo.ts] แหล่งแถวที่สลับได้ ───
let __diagRows: null | (() => Promise<any[]>) = null;
export function __setRowSource(fn: null | (() => Promise<any[]>)) { __diagRows = fn; }
const __diagQuery = async (sql: string) => (__diagRows ? { rows: await __diagRows() } : pool.query(sql));`;
const HOOK_STATE = `
export function __loadCache(): Promise<any[]> { return loadCustomerSearchCache(); }
export function __expire(ageMs = 11 * 60 * 1000): void { if (customerCache) customerCache.loadedAt = Date.now() - ageMs; }
export function __state() {
  return { has: !!customerCache, rows: customerCache?.rows ?? null, loadedAt: customerCache?.loadedAt ?? -1,
           loading: !!customerCacheLoading, gen: customerCacheGen };
}`;

function transform(src: string, label: string): string {
  let s = src.replace(/\r\n/g, '\n');
  const need = (needle: string) => {
    const got = s.split(needle).length - 1;
    if (got !== 1) throw new Error(`${label}: "${needle.slice(0, 40)}" เจอ ${got} ที่ ต้องเจอ 1 — โครงสร้าง customerService.ts เปลี่ยน ให้แก้ตัวแปลงในด่านนี้`);
  };
  need(IMPORT_LINE); s = s.replace(IMPORT_LINE, IMPORT_LINE + HOOK_SRC);
  need(QUERY_LINE); s = s.replace(QUERY_LINE, 'const { rows } = await __diagQuery(`');
  need(CLEAR_FN); s = s.replace(CLEAR_FN, CLEAR_FN + '\n' + HOOK_STATE);
  return s;
}
function cleanup(): void {
  for (const f of [BASE_GEN, HEAD_GEN]) if (existsSync(f)) unlinkSync(f);
}

/** หลีกช่วง sync + rebuild customers_data_view (:x0:00–:x0:45) — เผื่อเป็น :x9:50–:x0:50 */
async function waitSafeWindow(): Promise<void> {
  for (;;) {
    const d = new Date();
    const s = (d.getMinutes() % 10) * 60 + d.getSeconds();
    if (s >= 50 && s <= 585) return;
    const wait = s > 585 ? 600 - s + 50 : 50 - s;
    console.log(`${D}  รอ ${wait} วิ ให้พ้นช่วง sync${X}`);
    await new Promise(r => setTimeout(r, wait * 1000));
  }
}

const SQL = `
      SELECT DISTINCT ON (company_id)
        company_id AS id,
        TRIM(customer_name) AS display_name,
        TRIM(customer_reference) AS reference,
        TRIM(customer_sale_area) AS branch_code,
        TRIM(salesperson) AS salesperson
      FROM customers_data_view
      ORDER BY company_id, contact_id`;

type Row = Record<string, any>;
let fails = 0, passes = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) passes++; else fails++;
  console.log(`  ${pass ? G + '✓' : R + '✗'}${X} ${label}${detail ? `  ${D}${detail}${X}` : ''}`);
};

/** serialize แบบเข้มงวด: ลำดับคีย์ของทุก entry + typeof + Set ตามลำดับ iteration */
function ser(v: unknown): string {
  if (v instanceof Set) return 'Set[' + Array.from(v).map(x => JSON.stringify(x)).join(',') + ']';
  if (v === null || typeof v !== 'object') return typeof v + ':' + JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(ser).join(',') + ']';
  const o = v as Row;
  return '{' + Object.keys(o).map(k => JSON.stringify(k) + '=' + ser(o[k])).join(',') + '}';
}
function compareCache(a: Row[], b: Row[]): { equal: boolean; detail: string } {
  if (a.length !== b.length) return { equal: false, detail: `จำนวน ${a.length} ≠ ${b.length}` };
  const ha = createHash('sha1'), hb = createHash('sha1');
  for (let i = 0; i < a.length; i++) {
    const sa = ser(a[i]), sb = ser(b[i]);
    if (sa !== sb) return { equal: false, detail: `แถว ${i}: ${sa.slice(0, 160)} ≠ ${sb.slice(0, 160)}` };
    if (!(a[i].trigrams instanceof Set) || !(b[i].trigrams instanceof Set)) return { equal: false, detail: `แถว ${i} trigrams ไม่ใช่ Set` };
    ha.update(sa); hb.update(sb);
  }
  const x = ha.digest('hex').slice(0, 12), y = hb.digest('hex').slice(0, 12);
  return { equal: x === y, detail: `${a.length} แถว · sha1 ${x} = ${y}` };
}

// PRNG คงที่ — ฉากและคำค้นเดิมทุกครั้งที่รันบนข้อมูลชุดเดิม
let seed = 20260928;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const pick = (n: number) => Math.floor(rnd() * n);
const clone = (rows: Row[]) => rows.map(r => ({ ...r }));

/** คำค้น: สุ่มจากชื่อจริงในฐาน (+ ตัดคำ/ครึ่งชื่อ) + เคสที่มีเฉลยใน data/eval ถ้ามีในทรีนี้ */
function buildQueries(R0: Row[], extra: string[]): string[] {
  const qs = new Set<string>();
  for (let k = 0; k < 60; k++) {
    const n: string | null = R0[pick(R0.length)].display_name;
    if (!n) continue;
    qs.add(n);
    const core = n.replace(/บริษัท|จำกัด|\(มหาชน\)|ห้างหุ้นส่วน|หจก\.?|บจก\.?/g, ' ').replace(/\s+/g, ' ').trim();
    if (core) qs.add(core);
    if (n.length >= 6) qs.add(n.slice(0, Math.ceil(n.length / 2)));
  }
  for (const f of ['customer_search_cases.json', 'customer_search_corpus.json']) {
    const p = join(ROOT, 'data', 'eval', f);
    if (!existsSync(p)) continue;
    try {
      for (const c of JSON.parse(readFileSync(p, 'utf8')) as Row[]) if (c?.customerQuery) qs.add(String(c.customerQuery));
    } catch { /* ไฟล์เสียก็ข้าม — คำค้นจากฐานพอแล้ว */ }
  }
  for (const e of extra) qs.add(e);
  qs.add('ปียะ'); qs.add('ปิยะ');
  return [...qs];
}

async function main() {
  const base = resolveBase();
  const baseSha = git('rev-parse', '--short', base.ref);
  const baseSrc = git('show', `${base.ref}:${SRC_REL}`);
  const headSrc = readFileSync(join(ROOT, SRC_REL), 'utf8');
  console.log(`${B}ด่าน memo ของ cache ค้นหาลูกค้า — โหลดซ้ำ (HEAD) vs โหลดสด (โค้ดก่อนแก้)${X}`);
  console.log(`${D}base = ${baseSha} (${base.why})${baseSrc.replace(/\r\n/g, '\n') === headSrc.replace(/\r\n/g, '\n') ? ' · customerService.ts ไม่ต่างจาก HEAD — เทียบ memo กับโหลดสดของโค้ดเดียวกัน' : ''}${X}\n`);

  writeFileSync(BASE_GEN, transform(baseSrc, 'BASE'));
  writeFileSync(HEAD_GEN, transform(headSrc, 'HEAD'));
  const O: any = await import(pathToFileURL(BASE_GEN).href);
  const P: any = await import(pathToFileURL(HEAD_GEN).href);

  await waitSafeWindow();
  const R0: Row[] = (await pool.query(SQL)).rows;
  console.log(`${D}R0 = ${R0.length} บริษัทจากฐานจริง · display_name ว่าง ${R0.filter(r => r.display_name == null).length}${X}`);
  if (R0.length < 1000) throw new Error(`ได้แถวแค่ ${R0.length} — ฐานนี้ไม่ใช่ข้อมูลจริงพอจะตัดสิน (ด่านที่ผ่านแบบว่างเปล่าคือด่านที่หลอกคน)`);

  // ── ฉากข้อมูล (แก้ในหน่วยความจำเท่านั้น) ──
  const R1 = clone(R0);
  const R2 = clone(R0);
  const changed: string[] = [];
  for (let k = 0; k < 8; k++) { const r = R2[pick(R2.length)]; r.display_name = `${r.display_name ?? ''} ทดลองเปลี่ยน${k} จำกัด`; changed.push(r.display_name); }
  for (let k = 0; k < 4; k++) { R2[pick(R2.length)].display_name = R2[pick(R2.length)].display_name; }   // ชื่อชนกับบริษัทอื่น
  for (let k = 0; k < 2; k++) { R2[pick(R2.length)].display_name = null; }                               // ชื่อหาย
  for (const i of R2.map((r, i) => (r.display_name == null ? i : -1)).filter(i => i >= 0).slice(0, 2)) {
    R2[i].display_name = `บริษัท เดิมไม่มีชื่อ ${i}`; changed.push(R2[i].display_name);                   // null → มีชื่อ
  }
  for (let k = 0; k < 4; k++) { const r = R2[pick(R2.length)]; r.reference = 'REF-X' + k; r.salesperson = 'คุณทดลอง'; r.branch_code = null; }
  { const r = R2[pick(R2.length)]; r.display_name = (r.display_name || 'บริษัท ปิยะ').replace(/ิ/g, 'ี') + ' '; changed.push(r.display_name); } // raw ต่าง norm อาจเท่า
  const R3 = clone(R2).filter(() => rnd() > 0.001);                                                        // บริษัทหาย ~0.1%
  const maxId = Math.max(...R3.map(r => Number(r.id)));
  const fresh: string[] = [];
  const R4 = clone(R3);
  for (let k = 0; k < 20; k++) { const n = `บริษัท ใหม่เอี่ยม ทดสอบ${k} จำกัด`; fresh.push(n); R4.push({ id: maxId + 1 + k, display_name: n, reference: null, branch_code: null, salesperson: null }); }
  const r3ids = new Set(R3.map(r => r.id));
  for (const id of R2.map(r => r.id).filter(id => !r3ids.has(id)).slice(0, 3)) {
    const n = `บริษัท กลับมาใหม่ ${id} จำกัด`; fresh.push(n); R4.push({ id, display_name: n, reference: null, branch_code: null, salesperson: null });
  }
  for (let k = 0; k < 5; k++) R4.push({ id: maxId + 100 + k, display_name: R0[pick(R0.length)].display_name, reference: 'N' + k, branch_code: null, salesperson: null });
  R4.sort((a, b) => Number(a.id) - Number(b.id));
  const R5 = clone(R0);
  console.log(`${D}R3 = ${R3.length} (หาย ${R2.length - R3.length}) · R4 = ${R4.length} (ใหม่ ${R4.length - R3.length})${X}`);

  const queries = buildQueries(R0, [...changed, ...fresh, 'บริษัท เดิมไม่มีชื่อ']);
  const variantsOf = (q: string): string[] => q.split('\n').filter(Boolean).flatMap(l => {
    const np = P.stripPhoneNumbers(l); return [l, np, P.cleanCompanyName(np)];
  });

  // เงียบ log ของ customerService ระหว่างรัน (บรรทัด "loaded N companies" ต่อฉาก)
  const realLog = console.log; let depth = 0;
  const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
    depth++; console.log = () => {};
    try { return await fn(); } finally { if (--depth === 0) console.log = realLog; }
  };
  const src = (rows: Row[], delayMs = 5) => async () => { await new Promise(r => setTimeout(r, delayMs)); return clone(rows); };

  async function compareSearch(label: string) {
    let same = 0, nonEmpty = 0, firstDiff = '';
    for (const q of queries) {
      const v = variantsOf(q);
      const a = await quiet<Row[]>(() => O.searchCustomersNormalized(v, 1e9));
      const b = await quiet<Row[]>(() => P.searchCustomersNormalized(v, 1e9));
      if (a.length) nonEmpty++;
      if (JSON.stringify(a) === JSON.stringify(b)) same++; else if (!firstDiff) firstDiff = q;
    }
    ok(`${label}: ผลค้นหาเหมือนกันทุกคำค้น`, same === queries.length && nonEmpty > queries.length / 2,
      `${same}/${queries.length} เท่ากัน · มีผล ${nonEmpty} คำค้น${firstDiff ? ' · ต่างที่ ' + firstDiff.slice(0, 40) : ''}`);
  }

  console.log(`\n${B}1) โหลดซ้ำของ HEAD (ใช้ memo) = โหลดสดของ base ทุกฉาก${X}`);
  P.__setRowSource(src(R0)); P.clearCustomerSearchCache(); await quiet(() => P.__loadCache());
  O.__setRowSource(src(R0)); O.clearCustomerSearchCache(); await quiet(() => O.__loadCache());
  { const c = compareCache(P.__state().rows, O.__state().rows); ok('R0 โหลดแรก (cache ว่าง ไม่มี memo)', c.equal, c.detail); }
  const scenes: [string, Row[]][] = [['R1 ไม่เปลี่ยน', R1], ['R2 บางรายเปลี่ยน', R2], ['R3 บริษัทหาย', R3], ['R4 บริษัทใหม่', R4], ['R5 กลับเหมือน R0', R5]];
  for (const [label, rows] of scenes) {
    const prevSets = new Set((P.__state().rows as Row[]).map(r => r.trigrams));
    P.__setRowSource(src(rows)); await quiet(() => P.reloadCustomerSearchCache());
    O.__setRowSource(src(rows)); O.clearCustomerSearchCache(); await quiet(() => O.__loadCache());
    const pr = P.__state().rows as Row[];
    const reused = pr.filter(r => prevSets.has(r.trigrams)).length;
    const c = compareCache(pr, O.__state().rows);
    ok(`${label}: deep-equal`, c.equal, `${c.detail} · ยืม Set ของรอบก่อน ${reused}/${pr.length}`);
    // กันด่านลม: memo ต้องทำงานจริง (ถ้าถอด memo ออกจาก customerService.ts ให้ถอดด่านนี้ด้วย)
    ok(`${label}: memo ทำงานจริง (ยืม > 99%)`, reused > pr.length * 0.99);
    await compareSearch(label);
  }

  console.log(`\n${B}2) ฐานจริง — reload จาก pool.query จริงทั้งคู่${X}`);
  await waitSafeWindow();
  P.__setRowSource(src(R0)); P.clearCustomerSearchCache(); await quiet(() => P.__loadCache()); P.__setRowSource(null);
  await quiet(() => P.reloadCustomerSearchCache());
  O.__setRowSource(null); O.clearCustomerSearchCache(); await quiet(() => O.__loadCache());
  { const c = compareCache(P.__state().rows, O.__state().rows); ok('live: deep-equal', c.equal, c.detail); }
  await compareSearch('live');

  console.log(`\n${B}3) พฤติกรรม cache ต้องเหมือน base — gen / loadedAt / โหลดซ้อน / clear กลางคัน / โหลดล้ม${X}`);
  async function behave(M: any) {
    const obs: Record<string, unknown> = {};
    M.__setRowSource(src(R0)); M.clearCustomerSearchCache(); await quiet(() => M.__loadCache());
    const g0 = M.__state().gen;
    const tBefore = Date.now();
    await quiet(() => M.reloadCustomerSearchCache());
    const s1 = M.__state();
    obs.genAfterReload = s1.gen - g0;
    obs.loadedAtFresh = s1.loadedAt >= tBefore && s1.loadedAt <= Date.now();
    // โหลดซ้อน: A (ช้า R2) ค้าง แล้ว B (เร็ว R3) มาทีหลัง ⇒ ต้องเหลือ R3 · A ห้ามทับ
    M.__setRowSource(src(R2, 300)); const A = quiet(() => M.reloadCustomerSearchCache());
    M.__setRowSource(src(R3, 5)); const Bp = quiet(() => M.reloadCustomerSearchCache());
    obs.servedDuring = ((await M.__loadCache()) as Row[]).length;                  // ระหว่างโหลดต้องได้ของเดิมทันที
    await Promise.all([A, Bp]);
    const s2 = M.__state();
    obs.afterRaceIsR3 = s2.rows.length === R3.length;
    obs.genAfterRace = s2.gen - g0;
    const raceRows = s2.rows;
    // TTL หมด → โหลดเบื้องหลัง → clear กลางคัน ⇒ ผลค้างต้องไม่กลับมานั่งใน cache
    M.__setRowSource(src(R4, 200)); M.__expire(); await M.__loadCache(); M.clearCustomerSearchCache();
    await new Promise(r => setTimeout(r, 400));
    obs.staleWon = M.__state().has;
    // ล้ม: reload โยน error ⇒ reject + cache เดิมยังอยู่ · clear ⇒ has=false · โหลดถัดไปสำเร็จ
    M.__setRowSource(src(R0)); await quiet(() => M.__loadCache());
    const before = M.__state().rows;
    M.__setRowSource(async () => { await new Promise(r => setTimeout(r, 5)); throw new Error('boom'); });
    let rejected = false;
    try { await quiet(() => M.reloadCustomerSearchCache()); } catch { rejected = true; }
    obs.failRejected = rejected; obs.failKeptOld = M.__state().rows === before; obs.failLoadingCleared = !M.__state().loading;
    M.clearCustomerSearchCache(); obs.clearHas = M.__state().has;
    M.__setRowSource(src(R1)); const after = await quiet<Row[]>(() => M.__loadCache());
    obs.afterFailLen = after.length;
    const oldSets = new Set((before as Row[]).map(b => b.trigrams));
    const sharesOld = (after as Row[]).some(r => oldSets.has(r.trigrams));
    return { obs, after, raceRows, sharesOld };
  }
  const bo = await behave(O), bp = await behave(P);
  for (const k of Object.keys(bo.obs)) {
    const a = JSON.stringify(bo.obs[k]), b = JSON.stringify(bp.obs[k]);
    ok(`${k}: base=${a} head=${b}`, a === b);
  }
  ok('หลัง clear แล้ว HEAD คำนวณใหม่ทั้งหมด (ไม่ยืม Set จาก cache ก่อน clear)', bp.sharesOld === false);
  { const c = compareCache(bp.raceRows, bo.raceRows); ok('หลังโหลดซ้อน: deep-equal', c.equal, c.detail); }
  { const c = compareCache(bp.after, bo.after); ok('หลังล้ม + clear: deep-equal', c.equal, c.detail); }
}

// Ctrl-C กลางทาง = ไฟล์สำเนาต้องไม่ค้างในทรี (ไม่มีอะไรในฐานให้เก็บกวาด — ด่านนี้ไม่เขียนฐาน)
process.on('SIGINT', () => { cleanup(); process.exit(130); });

let exitCode = 1;
try {
  await main();
  exitCode = fails === 0 ? 0 : 1;
} catch (e: unknown) {
  console.error(`${R}ด่านรันไม่จบ:${X}`, e instanceof Error ? e.message : e);
} finally {
  cleanup();
  await pool.end().catch(() => {});
}
console.log(`\n${B}สรุป:${X} ${fails === 0 && exitCode === 0 ? G : R}ผ่าน ${passes} · ล้ม ${fails}${X}`);
process.exit(exitCode);
