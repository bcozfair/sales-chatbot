import { spawn, type ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import readline from 'readline';
import { cfg, pool, log, logErr, levelRank, type Level } from './config.js';
import { getCursor, markOk, markError } from './state.js';
import {
  splitTimestamp, isContinuation, parseEntry, MAX_STACK, type ParsedEntry,
} from './parseLine.js';
import { redact, redactObject } from './redact.js';

/**
 * งานที่ 1 ของ logworker — เก็บ `docker logs` ลงตาราง system_logs
 *
 * มาตรฐาน 12-Factor §XI บอกไว้ตรง ๆ ว่าแอปควรเขียน log ลง stdout แล้วจบ ห้ามให้แอปรู้เรื่องปลายทาง
 * แล้วให้ "ตัวเก็บภายนอก" ไปจัดการต่อ — แอปนี้ทำครึ่งแรกถูกอยู่แล้ว (console.* 821 จุด) ขาดแค่ตัวเก็บ
 * ⇒ ไฟล์นี้คือตัวเก็บนั้น และเป็นเหตุผลที่ทั้งเฟสนี้ไม่ต้องแตะโค้ดแอปแม้แต่บรรทัดเดียว
 *
 * ของที่วิธีอื่นให้ไม่ได้และวิธีนี้ได้ฟรี:
 *   - stack trace ตอน crash · ข้อความจาก Node เอง · log ตอน boot ก่อนโค้ดเราทำงาน
 *   - แยก stdout/stderr ได้ ⇒ รู้ระดับความรุนแรงโดยไม่ต้องเดาจากคำในข้อความ
 */

const FLUSH_INTERVAL_MS = 2_000;
const FLUSH_BATCH       = 200;
const MAX_BUFFER        = 5_000;   // เกินแล้วทิ้งของใหม่ — เหมือน apiLogService: ของเก่าใกล้ต้นเหตุกว่า
/** เริ่มอ่านย้อนหลังเท่านี้เมื่อยังไม่เคยมี checkpoint (ครั้งแรกสุด) */
const FIRST_RUN_LOOKBACK_MIN = 15;
/** รอเท่านี้ก่อน spawn ใหม่เมื่อ docker logs ตาย (คอนเทนเนอร์ restart ระหว่าง deploy) */
const RESPAWN_DELAY_MS = 5_000;
/**
 * บรรทัดที่ถูกพักไว้รอ stack trace ต้องถูกปล่อยเองเมื่อเงียบเกินเท่านี้
 *
 * เดิมมันถูกปล่อยก็ต่อเมื่อ "บรรทัดแม่ตัวถัดไปของสตรีมเดียวกัน" มาถึง ⇒ error ล่าสุดของระบบ
 * ค้างอยู่ใน memory เสมอจนกว่าจะมี error ตัวถัดไป ซึ่งคือตอนที่คนเปิดหน้าบันทึกระบบมาดูพอดี
 * (2026-09-21: บรรทัด 17:07:48.899 ค้างข้ามคืนเพราะตัวถัดไปถูกด่านกันซ้ำตีตกไปทั้งหมด)
 * ต้องยาวกว่าระยะที่ stack trace ของบรรทัดเดียวกันตามมา (วัดจริง < 1 ms) อยู่หลายเท่า
 */
const HOLD_IDLE_MS = 1_500;

interface Pending {
  createdAt: Date;
  container: string;
  stream: 'stdout' | 'stderr';
  entry: ParsedEntry;
  stack: string[];
}

interface Row {
  createdAt: Date;
  container: string;
  stream: string;
  level: Level;
  source: string | null;
  event: string | null;
  message: string;
  requestId: string | null;
  ctx: unknown | null;
  errStack: string | null;
}

const buffer: Row[] = [];
let dropped = 0;
let flushing = false;
let stopped = false;
/** ตัวปล่อยบรรทัดที่พักไว้นานเกินของแต่ละคอนเทนเนอร์ — ตัวจับเวลา flush เรียกให้ทุกครั้ง */
const idleReleasers: (() => void)[] = [];
/** stdio ของเราคือ ['ignore','pipe','pipe'] ⇒ ไม่มี stdin แต่มี stdout/stderr ที่อ่านได้แน่นอน */
type LogsChild = ChildProcessByStdio<null, Readable, Readable>;
const children = new Set<LogsChild>();

function toRow(p: Pending): Row {
  return {
    createdAt: p.createdAt,
    container: p.container,
    stream: p.stream,
    level: p.entry.level,
    source: p.entry.source,
    event: p.entry.event,
    message: redact(p.entry.message),
    requestId: p.entry.requestId,
    ctx: p.entry.ctx ? redactObject(p.entry.ctx) : null,
    errStack: p.stack.length > 0
      ? redact(p.stack.join('\n')).slice(0, MAX_STACK)
      : null,
  };
}

function push(p: Pending): void {
  // กรองด้วยระดับ "ตอนจะเขียน" ไม่ใช่ตอนอ่าน — บรรทัดที่ถูกกรองทิ้งยังอยู่ใน docker logs ตามเดิม
  if (levelRank(p.entry.level) > levelRank(cfg.dbLevel)) return;
  if (buffer.length >= MAX_BUFFER) {
    dropped++;
    if (dropped % 500 === 1) logErr(`buffer เต็ม (${MAX_BUFFER}) — ทิ้งแถวใหม่ · สะสม ${dropped}`);
    return;
  }
  buffer.push(toRow(p));
}

/**
 * เขียนก้อนเดียวด้วย INSERT หลายแถว — สร้าง placeholder เป็น ($1,$2,...),($11,$12,...)
 * เลียนแบบ insertApiLogRows ใน db/repositories.ts เพื่อให้คนอ่านโค้ดเจอรูปแบบเดียวกันทั้งโปรเจกต์
 */
const COLS = 10;
async function insertRows(rows: Row[]): Promise<void> {
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    const b = i * COLS;
    values.push(r.createdAt, r.container, r.stream, r.level, r.source,
                r.event, r.message, r.requestId, r.ctx === null ? null : JSON.stringify(r.ctx),
                r.errStack);
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9}::jsonb,$${b + 10})`;
  });
  await pool.query(
    `INSERT INTO system_logs
       (created_at, container, stream, level, source, event, message, request_id, ctx, err_stack)
     VALUES ${tuples.join(',')}`,
    values);
}

async function flushOnce(): Promise<void> {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  try {
    while (buffer.length > 0) {
      const batch = buffer.splice(0, FLUSH_BATCH);
      // จัดกลุ่มตาม container เพราะ checkpoint เป็นของแต่ละคอนเทนเนอร์ ไม่ใช่ของ batch
      const perContainer = new Map<string, Date>();
      for (const r of batch) {
        const cur = perContainer.get(r.container);
        if (!cur || r.createdAt > cur) perContainer.set(r.container, r.createdAt);
      }
      try {
        await insertRows(batch);
        // ขยับ checkpoint "หลัง" เขียนสำเร็จเท่านั้น — ถ้าล้มตรงกลาง รอบหน้าจะอ่านซ้ำจากจุดเดิม
        // ซึ่งดีกว่าข้ามหาย (ซ้ำถูกกันด้วยการเทียบ ts > cursor ตอนอ่าน)
        for (const [c, ts] of perContainer) {
          await markOk(`system_log:${c}`, ts, batch.filter(r => r.container === c).length);
        }
      } catch (err) {
        // ทิ้งก้อนนี้ ไม่ requeue — DB ล่มยาวแล้ว requeue จะวนพังไม่จบและกิน memory จนโปรเซสตาย
        // (เหตุผลเดียวกับ services/apiLogService.ts) · ของที่หายยังอยู่ใน docker logs อีก ~50 MB
        logErr(`flush ล้มเหลว ทิ้ง ${batch.length} แถว:`, err instanceof Error ? err.message : err);
        await markError(`system_log:${[...perContainer.keys()][0] ?? 'unknown'}`, err);
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

/**
 * เริ่มอ่านคอนเทนเนอร์หนึ่งตัว แล้วอ่านต่อไปเรื่อย ๆ (docker logs -f)
 *
 * เรื่อง "ไม่ซ้ำ ไม่ขาด" ทำสองชั้น:
 *   1. --since <checkpoint>  ให้ docker คัดให้ก่อน (ถูกและเร็ว)
 *   2. เทียบ ts > "ตัวชี้ของสตรีมนั้น" อีกครั้งฝั่งเรา เพราะ --since ของ docker เป็นแบบ "ตั้งแต่"
 *      (inclusive) และเวลาระดับนาโนวินาทีทำให้บรรทัดต่างกันมี ts ชนกันแทบเป็นไปไม่ได้
 */
async function followContainer(container: string): Promise<void> {
  const job = `system_log:${container}`;
  const saved = await getCursor(job);
  const cursor = saved ?? new Date(Date.now() - FIRST_RUN_LOOKBACK_MIN * 60_000);
  if (!saved) log(`${container}: ไม่มี checkpoint — เริ่มจาก ${FIRST_RUN_LOOKBACK_MIN} นาทีที่แล้ว`);

  // "อ่านถึงไหนแล้ว" ต้องแยกต่อสตรีม — stdout กับ stderr มาคนละท่อ ลำดับที่อ่านเจอไม่การันตี
  // เคยใช้ตัวเดียวร่วมกัน: แอปพิมพ์ console.log แล้ว console.error ติดกัน (ห่างกัน 36 µs) ถ้าอ่าน
  // ฝั่ง stdout ก่อน ตัวชี้ก็เลยไปแล้ว บรรทัด stderr ที่ตามมาถูกตีเป็นของซ้ำแล้วทิ้ง
  // (วัด 2026-09-22: บรรทัด error 8 จาก 12 หายจาก system_logs ทั้งที่อยู่ครบใน docker logs
  //  และเมื่อ stdout นำไปแล้วมันไม่กลับมาเอง — การเก็บ error หยุดยาว 15 ชม. จนกว่าจะ restart)
  // ต้องอยู่นอก spawnOnce เพื่อให้ค่าข้าม respawn ได้ ไม่งั้นสตรีมที่นำอยู่จะถูกดึงถอยไปอ่านซ้ำ
  const seen: Record<'stdout' | 'stderr', Date> = { stdout: cursor, stderr: cursor };
  /** จุดที่ปลอดภัยสำหรับ --since คือตัวที่ "ช้ากว่า" ของสองสตรีม — เร็วกว่านั้นจะข้ามของที่ยังไม่ได้อ่าน */
  const resumeFrom = (): Date => (seen.stdout < seen.stderr ? seen.stdout : seen.stderr);

  // บรรทัดค้างแยกต่อสตรีม เพราะ stack trace ของ stderr ต้องไม่ไปต่อท้ายบรรทัดของ stdout
  // อยู่นอก spawnOnce เพื่อให้ตัวจับเวลาปล่อยของค้างเข้าถึงได้ และไม่หายไปตอน respawn
  const held: Record<'stdout' | 'stderr', Pending | null> = { stdout: null, stderr: null };
  const releaseIdle = (): void => {
    const deadline = Date.now() - HOLD_IDLE_MS;
    for (const s of ['stdout', 'stderr'] as const) {
      const h = held[s];
      if (h && h.createdAt.getTime() < deadline) { push(h); held[s] = null; }
    }
  };
  idleReleasers.push(releaseIdle);

  const spawnOnce = (): void => {
    if (stopped) return;
    const since = resumeFrom().toISOString();
    const child = spawn('docker',
      ['logs', '--timestamps', '--follow', '--since', since, container],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);

    const handle = (stream: 'stdout' | 'stderr') => (line: string) => {
      const t = splitTimestamp(line);
      if (!t) return;
      if (t.ts <= seen[stream]) return;                 // ชั้นที่ 2 ของการกันซ้ำ (ต่อสตรีม)

      if (isContinuation(t.text)) {
        const h = held[stream];
        // ไม่มีบรรทัดแม่ให้เกาะ = เศษ stack trace ของแถวที่เขียนลง DB ไปแล้วก่อน restart
        // (checkpoint ชี้ที่บรรทัดแม่ ส่วนบรรทัดต่อเนื่องมี ts มากกว่า จึงถูกอ่านซ้ำมา) ⇒ ทิ้ง
        if (!h) return;
        if (h.stack.join('\n').length < MAX_STACK) h.stack.push(t.text);
        return;
      }
      if (held[stream]) push(held[stream]!);
      held[stream] = {
        createdAt: t.ts, container, stream,
        entry: parseEntry(t.text, stream), stack: [],
      };
      seen[stream] = t.ts;
    };

    readline.createInterface({ input: child.stdout }).on('line', handle('stdout'));
    readline.createInterface({ input: child.stderr }).on('line', handle('stderr'));

    const finish = (why: string) => {
      children.delete(child);
      for (const s of ['stdout', 'stderr'] as const) {
        if (held[s]) { push(held[s]!); held[s] = null; }
      }
      if (stopped) return;
      logErr(`${container}: docker logs จบ (${why}) — ต่อใหม่ใน ${RESPAWN_DELAY_MS / 1000} วินาที`);
      setTimeout(spawnOnce, RESPAWN_DELAY_MS).unref();
    };

    child.on('close', code => finish(`exit ${code}`));
    child.on('error', err => finish(err.message));
  };

  spawnOnce();
}

let flushTimer: NodeJS.Timeout | null = null;

export async function startSystemLogJob(): Promise<void> {
  for (const c of cfg.containers) {
    try {
      await followContainer(c);
      log(`เริ่มอ่าน docker logs ของ ${c} (เขียนลง DB ตั้งแต่ระดับ ${cfg.dbLevel} ขึ้นไป)`);
    } catch (err) {
      logErr(`เริ่มอ่าน ${c} ไม่สำเร็จ:`, err instanceof Error ? err.message : err);
      await markError(`system_log:${c}`, err);
    }
  }
  flushTimer = setInterval(() => {
    for (const release of idleReleasers) release();
    void flushOnce();
  }, FLUSH_INTERVAL_MS);
}

/** ปิดให้เรียบร้อย: หยุด docker logs ก่อน แล้วค่อยเขียนของที่ค้างให้หมด */
export async function stopSystemLogJob(): Promise<void> {
  stopped = true;
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  for (const c of children) c.kill('SIGTERM');
  children.clear();
  await flushOnce();
}
