/**
 * npm run diag:webhook-recorder — ด่านของตัวบันทึก webhook (เฟส 1 ของ docs/plan-message-log-merge.md)
 *   npm run diag:webhook-recorder -- --frozen-handler        + ข้อ 3ข: lineHandler.ts ต้องไม่มีบรรทัดโค้ดเปลี่ยน
 *   npm run diag:webhook-recorder -- --frozen-handler --base <ref>
 *
 * คำถามที่ด่านนี้ตอบ: **"ตัวบันทึกที่เพิ่มเข้ามา ทำให้บอทต่างไปจากเดิมไหม และบันทึกที่ได้เชื่อได้แค่ไหม"**
 * ข้อที่ห้ามล้มเด็ดขาดสองข้อ: ประวัติที่ป้อน LLM เท่าเดิมทุกแถว (ข้อ 4 · 5ง) และตัวจดคืนค่า/โยน error
 * ตัวเดิม `===` (ข้อ 1)
 *
 *   1. ตัวจด createRecordingClient (inner ปลอม · ไม่แตะ DB) — รวม **ลำดับ microtask**: การจดผลของรอบส่ง
 *      ต้องเสร็จก่อน handleEvent resolve ทั้งแบบ `return await …replyMessage()` และ `return …replyMessage()`
 *      (ไม่มี await) · Flex ที่มีข้อความเฝ้าระวังใน contents ต้องไม่หลุดเข้าบันทึก · ตารางสถานะ
 *   2. buildFillRow / waitSettled (ไม่แตะ DB)
 *   3. อ่านซอร์ส — เงื่อนไขนอกตัวมันที่การกันแถวซ้ำต้องพึ่ง (insertMessage ถูก await · handleImage ทางเดียว
 *      ที่ข้ามตัวจด) · ผู้อ่าน `messages` รายใหม่ต้องถูกตัดสินว่ากรองไหม · `'wh_'` เขียนตรงได้ที่เดียว
 *      3ข (`--frozen-handler`): git diff ของ handlers/lineHandler.ts เทียบ base มีแต่บรรทัดคอมเมนต์
 *   4. ฐานจริง **SELECT/EXPLAIN อย่างเดียว**: getRecentMessages ใหม่ = SQL เดิม ทุก user ทุกแถวทุกลำดับ
 *   5. **ตารางชั่วคราวบังของจริง + ROLLBACK เสมอ** (`webhook_events` · `messages`) — ข้อ 0 ยืนยันว่าตารางที่
 *      SQL เห็นเป็นของชั่วคราวก่อนเขียนอะไร ไม่ผ่าน = หยุดทั้งชุด · (ก) migration ใหม่สองรอบ (ข) เขียนครั้งเดียว
 *      (ค) NOT EXISTS สามกรณี (ง) ประวัติ LLM บนแถวผู้ใช้จริงที่ลอกมา (จ) **ต้องเป็นข้อสุดท้าย** — ตัวพัก
 *      เขียนของ webhookEventsRepo เป็นตัวแปรระดับโมดูล พอถูกกระตุ้นแล้วจะพักไป 10 นาทีทั้งโปรเซส
 *   6. หลัง deploy (SELECT อย่างเดียว · ข้ามเองถ้ายังไม่มีคอลัมน์/แถว)
 *
 * ── ผลข้างเคียง ────────────────────────────────────────────────────────────────────────
 * เขียนเฉพาะตารางชั่วคราว (`CREATE TEMP TABLE … ON COMMIT DROP`) ใน withTransaction ที่โยน error ทิ้ง
 * ⇒ ROLLBACK ทุกกรณี · ฆ่ากลางคัน = Postgres rollback เอง · identity ของ `messages` ชั่วคราวได้ sequence
 * ชั่วคราวของตัวเอง (ข้อ 0 ตรวจ) ⇒ ไม่กิน `messages_id_seq` ของจริง
 * ⇒ อยู่กลุ่ม "เขียนแล้ว ROLLBACK" ของ AGENTS.md B2 · รันบน PMSV ได้ · **ห้ามเปลี่ยนเป็น COMMIT**
 * ห้ามเรียก finishEventRecord (ทางที่ไม่ใช่ image) / noteEventText / noteRedeliveryReply ในไฟล์นี้ —
 * มันเขียนผ่าน pool ตัวจริง ไม่ผ่านตารางชั่วคราว
 * ข้อ 3ข เรียก `git` อ่านอย่างเดียว (rev-parse · merge-base · status · diff)
 *
 * ทุกข้อที่รอ timer ต้องมีตัวค้ำ event loop — waitSettled ใช้ timer ที่ unref() ถ้าไม่มีอะไรค้ำ
 * โปรเซสจะออกเงียบ ๆ exit 0 ก่อนถึง assert (เกิดจริงตอนเขียนด่านนี้) ⇒ `keepAlive` ด้านล่าง
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import type pg from 'pg';
import { HTTPFetchError } from '@line/bot-sdk';
import { pool, withTransaction } from '../../config/db.js';
import {
  createRecordingClient, describeReplyMessages, describeReplyError,
  type ReplyAttempt, type ReplyClient,
} from '../../services/chatChannel.js';
import {
  replyStatusOf, renderReplyContent, renderReplyPreview, waitSettled, buildFillRow, finishEventRecord,
  flushWebhookRecords, NO_REPLY_TEXT, SETTLE_CAP_MS,
} from '../../services/webhookRecorder.js';
import {
  WEBHOOK_FILL_PREFIX, webhookFillType, isWebhookFillType, excludeWebhookFillSql,
} from '../../db/messageKinds.js';
import { getRecentMessages, insertWebhookFillMessage, type WebhookFillRow } from '../../db/repositories.js';
import { recordEventText, recordReplyOutcome, REPLY_PREVIEW_MAX } from '../../db/webhookEventsRepo.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ARGV = process.argv.slice(2);
const FROZEN = ARGV.includes('--frozen-handler');
const baseIdx = ARGV.indexOf('--base');
const BASE_ARG = baseIdx >= 0 ? ARGV[baseIdx + 1] : undefined;

const ESC = String.fromCharCode(27);
const G = ESC + '[32m', R = ESC + '[31m', D = ESC + '[2m', B = ESC + '[1m', Y = ESC + '[33m', X = ESC + '[0m';

let pass = 0, fail = 0, skip = 0;
const check = (label: string, ok: boolean, detail = ''): boolean => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? `${G}✓${X}` : `${R}✗ FAIL${X}`} ${label}${detail ? `  ${D}— ${detail}${X}` : ''}`);
  return ok;
};
const skipped = (label: string, why: string): void => {
  skip++;
  console.log(`  ${Y}⏭️${X}  ${label}  ${D}— ${why}${X}`);
};
const section = (t: string) => console.log(`\n${B}${t}${X}`);
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const tick = () => new Promise<void>((r) => setImmediate(r));

/** ข้อความเฝ้าระวัง — ถ้าโผล่ในบันทึกใด ๆ แปลว่าตัวจดเปิด contents ของ Flex (ข้อมูลลูกค้า) */
const SENTINEL = 'SENTINEL_PII_0812345678_ลูกค้าลับ';
const flexMsg = (alt: string | undefined) => ({
  type: 'flex',
  ...(alt === undefined ? {} : { altText: alt }),
  contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: SENTINEL }] } },
});
const P = (messages: any[]) => ({ replyToken: 'diagwr-token', messages });

// ค้ำ event loop ตลอดทั้งด่าน (ดูหัวไฟล์) — ล้างทิ้งตอนจบ
const keepAlive = setInterval(() => {}, 1 << 30);

// ════════════════════════════════════════════════════════════════════════════════════
// 1. ตัวจด
// ════════════════════════════════════════════════════════════════════════════════════
async function part1(): Promise<void> {
  section('1) ตัวจด createRecordingClient (inner ปลอม · ไม่แตะ DB)');

  // 1a ค่าที่คืน + อาร์กิวเมนต์ที่ส่งต่อเป็นตัวเดิม
  {
    const value = { sentMessages: [{ id: '1' }] };
    let seenArg: any = null;
    const innerPromise = Promise.resolve(value);
    const rec = createRecordingClient({ replyMessage: (p) => { seenArg = p; return innerPromise; } });
    const arg = P([{ type: 'text', text: 'สวัสดี' }]);
    const ret = rec.client.replyMessage(arg);
    check('1a. คืน promise ตัวเดิมของ inner (===) และค่าที่ resolve ตัวเดิม (===)',
      ret === innerPromise && (await ret) === value);
    check('1a. ส่งอาร์กิวเมนต์ตัวเดิมให้ inner (===) — ไม่ลอก ไม่แก้', seenArg === arg);
  }

  // 1b rejection ตัวเดิม
  {
    const err = new Error('LINE ปฏิเสธ');
    const rec = createRecordingClient({ replyMessage: () => Promise.reject(err) });
    let caught: unknown = null;
    try { await rec.client.replyMessage(P([{ type: 'text', text: 'x' }])); } catch (e) { caught = e; }
    await tick();
    const a = rec.close();
    check('1b. inner reject → ผู้เรียกได้ error ตัวเดิม (===)', caught === err);
    check('1b. รอบที่ล้มถูกจด ok=false พร้อม error', a.length === 1 && a[0].ok === false && /LINE ปฏิเสธ/.test(a[0].error ?? ''),
      JSON.stringify(a.map(x => [x.ok, x.error])));
  }

  // 1c inner throw แบบ sync → throw ตัวเดิมแบบ sync
  {
    const err = new TypeError('พังแบบ sync');
    const rec = createRecordingClient({ replyMessage: () => { throw err; } });
    let syncCaught: unknown = null;
    let returned = false;
    try { rec.client.replyMessage(P([{ type: 'text', text: 'x' }])); returned = true; } catch (e) { syncCaught = e; }
    const a = rec.close();
    check('1c. inner throw แบบ sync → โยนตัวเดิมแบบ sync (ไม่กลายเป็น rejected promise)', !returned && syncCaught === err);
    check('1c. รอบนั้นถูกจด ok=false', a.length === 1 && a[0].ok === false && /TypeError: พังแบบ sync/.test(a[0].error ?? ''));
  }

  // 1d หลัง close ยังส่งได้ แต่ไม่จด
  {
    let sent = 0;
    const rec = createRecordingClient({ replyMessage: async () => { sent++; return { n: sent }; } });
    await rec.client.replyMessage(P([{ type: 'text', text: 'ก่อนปิด' }]));
    const first = rec.close();
    const r = await rec.client.replyMessage(P([{ type: 'text', text: 'หลังปิด' }]));
    const again = rec.close();
    check('1d. หลัง close() การส่งยังทำงาน (inner ถูกเรียก · ได้ค่าคืน)', sent === 2 && (r as any)?.n === 2);
    check('1d. หลัง close() ไม่จดเพิ่ม', first.length === 1 && again.length === 1, `${first.length} → ${again.length}`);
    check('1d. ผลของ close() เป็นสำเนาที่แก้ไม่ได้', Object.isFrozen(first) && Object.isFrozen(first[0]));
  }

  // 1e watch(p) === p
  {
    const rec = createRecordingClient({ replyMessage: async () => null });
    const p = Promise.resolve(42);
    const pr = Promise.reject(new Error('งานล้ม'));
    const rec2 = createRecordingClient({ replyMessage: async () => null });
    check('1e. watch(p) คืน p ตัวเดิม (===) ทั้งงานสำเร็จและงานล้ม',
      rec.watch(p) === p && rec2.watch(pr) === pr);
    await pr.catch(() => {});
    check('1e. whenSettled() = null ก่อน watch · หลัง watch resolve true แม้งานล้ม',
      createRecordingClient({ replyMessage: async () => null }).whenSettled() === null
      && (await rec.whenSettled()) === true && (await rec2.whenSettled()) === true);
  }

  // 1f inner แบบ class ที่อ่าน this
  {
    class FakeLineClient {
      private log: string[] = [];
      private readonly tag = 'line';
      replyMessage(p: { replyToken: string; messages: any[] }) {
        this.log.push(p.replyToken);                 // this ต้องเป็นตัว instance
        return Promise.resolve({ tag: this.tag, count: this.log.length });
      }
    }
    const inner = new FakeLineClient();
    const rec = createRecordingClient(inner);
    let r: any = null; let err: unknown = null;
    try { r = await rec.client.replyMessage(P([{ type: 'text', text: 'x' }])); } catch (e) { err = e; }
    check('1f. inner แบบ class ที่อ่าน this ทำงานได้ (เรียกแบบเมธอด)', err === null && r?.tag === 'line' && r?.count === 1,
      err ? String(err) : JSON.stringify(r));
  }

  // 1g การจดล้มต้องไม่กระทบการส่ง
  {
    const value = { ok: 1 };
    let called = 0;
    const rec = createRecordingClient({ replyMessage: async () => { called++; return value; } });
    const evil = { replyToken: 't', get messages(): any[] { throw new Error('getter พัง'); } };
    let r: unknown = null; let err: unknown = null;
    try { r = await rec.client.replyMessage(evil as any); } catch (e) { err = e; }
    check('1g. อ่านข้อความเพื่อจดไม่ได้ (getter โยน) → ยังส่งจริงและคืนค่าตัวเดิม', err === null && r === value && called === 1);
  }

  // 1h Flex ที่มีข้อความเฝ้าระวังใน contents ต้องไม่หลุดเข้าบันทึก
  {
    const rec = createRecordingClient({ replyMessage: async () => ({}) });
    rec.watch((async () => {
      await rec.client.replyMessage(P([{ type: 'text', text: 'ข้อความนำ' }, flexMsg('ร่างใบเสนอราคา QT-TEST'), flexMsg(undefined)]));
    })());
    await waitSettled(rec, 2_000);
    const a = rec.close();
    const parts = a.flatMap(x => x.parts);
    const row = buildFillRow({
      event: { type: 'message', replyToken: 'diagwr-flex', source: { userId: 'Udiag' }, message: { id: 'm1', type: 'text', text: 'สั่งของ' } },
      receivedAt: Date.now(), attempts: a, settled: true,
    });
    const blobs = [JSON.stringify(a), JSON.stringify(describeReplyMessages(P([flexMsg('alt')]).messages)),
      renderReplyContent(parts), renderReplyPreview(parts), JSON.stringify(row)];
    check('1h. ข้อความใน contents ของ Flex ไม่ปรากฏในบันทึกใด ๆ (attempts · reply_content · reply_preview · แถวเติม)',
      blobs.every(s => !s.includes(SENTINEL)), blobs.filter(s => s.includes(SENTINEL)).length + ' ที่หลุด');
    check('1h. Flex เก็บแค่ altText · ไม่มี altText = [flex]',
      renderReplyContent(parts) === 'ข้อความนำ\nร่างใบเสนอราคา QT-TEST\n[flex]'
      && renderReplyPreview(parts) === 'ข้อความนำ\n[flex] ร่างใบเสนอราคา QT-TEST\n[flex]',
      JSON.stringify([renderReplyContent(parts), renderReplyPreview(parts)]));
    check('1h. describeReplyMessages ไม่มีคีย์ contents ในผล', !JSON.stringify(describeReplyMessages([flexMsg('a')])).includes('contents'));
  }

  // 1i ตารางสถานะ (ฟังก์ชันบริสุทธิ์)
  {
    const att = (ok: boolean | null): ReplyAttempt =>
      ({ startedAt: 0, endedAt: ok === null ? null : 1, ok, parts: [], error: ok === false ? 'x' : null });
    const cases: [string, ReplyAttempt[], boolean, string][] = [
      ['ไม่มีรอบ · settled', [], true, 'none'],
      ['ไม่มีรอบ · ยังไม่ settled', [], false, 'pending'],
      ['สำเร็จ · settled', [att(true)], true, 'sent'],
      ['สำเร็จ · ยังไม่ settled', [att(true)], false, 'sent'],
      ['ล้ม · settled', [att(false)], true, 'failed'],
      ['ล้ม · ยังไม่ settled (งานยังวิ่ง อาจส่งทางสำรองได้)', [att(false)], false, 'pending'],
      ['ล้มสองรอบ · ยังไม่ settled', [att(false), att(false)], false, 'pending'],
      ['ล้มแล้วทางสำรองสำเร็จ · settled', [att(false), att(true)], true, 'sent'],
      ['ล้มแล้วทางสำรองสำเร็จ · ยังไม่ settled', [att(false), att(true)], false, 'sent'],
      ['ล้ม + รอบค้าง · settled', [att(false), att(null)], true, 'pending'],
      ['รอบค้าง · settled (งานไม่ await การส่ง)', [att(null)], true, 'pending'],
    ];
    const bad = cases.filter(([, a, s, want]) => replyStatusOf(a, s) !== want)
      .map(([name, a, s, want]) => `${name}: ได้ ${replyStatusOf(a, s)} ต้องเป็น ${want}`);
    check(`1i. replyStatusOf ครบ ${cases.length} กรณี (sent > pending > failed > none)`, bad.length === 0, bad.join(' · '));
  }

  // 1j ล้มแล้วทางสำรองสำเร็จ — เดินจริงผ่านตัวจด (รูปของ catch ท้าย handleEvent)
  {
    let n = 0;
    const httpErr = new HTTPFetchError('Bad Request', {
      status: 400, statusText: 'Bad Request',
      headers: new Headers({ 'x-line-request-id': 'rid-diag-0001' }),
      body: '{"message":"Invalid reply token"}',
    });
    const rec = createRecordingClient({ replyMessage: async () => { n++; if (n === 1) throw httpErr; return {}; } });
    const handler = async () => {
      try {
        return await rec.client.replyMessage(P([flexMsg('ร่างใบ')]));
      } catch {
        try { await rec.client.replyMessage(P([{ type: 'text', text: '⚠️ ขออภัย ระบบขัดข้องชั่วคราว' }])); } catch { /* กลืน */ }
      }
    };
    const p = rec.watch(handler());
    await p;
    const settled = await waitSettled(rec, 2_000);
    const a = rec.close();
    const okParts = a.filter(x => x.ok === true).flatMap(x => x.parts);
    check('1j. ล้มแล้วทางสำรองสำเร็จ → sent · preview = ข้อความทางสำรอง · error ของรอบแรกเก็บไว้',
      settled && replyStatusOf(a, settled) === 'sent'
      && renderReplyPreview(okParts) === '⚠️ ขออภัย ระบบขัดข้องชั่วคราว'
      && a[0].ok === false && /^400 Bad Request rid=rid-diag-0001 \{"message":"Invalid reply token"\}$/.test(a[0].error ?? ''),
      JSON.stringify(a.map(x => [x.ok, x.error])));
  }

  // 1k describeReplyError
  {
    const real = new HTTPFetchError('x', {
      status: 429, statusText: 'Too Many Requests',
      headers: new Headers({ 'x-line-request-id': 'abc-123' }), body: 'B'.repeat(800),
    });
    const s = describeReplyError(real);
    check('1k. HTTPFetchError จริงของ SDK → "<status> <statusText> rid=<id> <body ≤300>"',
      s.startsWith('429 Too Many Requests rid=abc-123 ') && s.length === '429 Too Many Requests rid=abc-123 '.length + 300, s.slice(0, 60));
    const noHeader = describeReplyError({ status: 500, statusText: 'ISE', headers: { get() { throw new Error('x'); } }, body: { a: 1 } });
    check('1k. headers.get พัง / body เป็นวัตถุ → rid=- · body เป็น JSON', noHeader === '500 ISE rid=- {"a":1}', noHeader);
    check('1k. error ทั่วไป → "<name>: <message>" · ค่าอื่น → String',
      describeReplyError(new RangeError('เกิน')) === 'RangeError: เกิน' && describeReplyError('ข้อความ') === 'ข้อความ');
  }

  // 1l ตัดความยาว reply_preview ไม่ทิ้งครึ่งตัวของ emoji
  {
    const long = renderReplyPreview([{ kind: 'text', text: 'ก'.repeat(REPLY_PREVIEW_MAX + 500) }]);
    const emoji = renderReplyPreview([{ kind: 'text', text: 'a'.repeat(REPLY_PREVIEW_MAX - 1) + '😀' }]);
    check(`1l. reply_preview ≤ ${REPLY_PREVIEW_MAX} · ไม่ทิ้ง surrogate ครึ่งตัว`,
      long.length === REPLY_PREVIEW_MAX && emoji.length === REPLY_PREVIEW_MAX - 1 && !/[\uD800-\uDBFF]$/.test(emoji),
      `${long.length} / ${emoji.length}`);
  }

  // 1m ลำดับ microtask — การจดผลต้องเสร็จก่อน handleEvent resolve
  //    ผู้สังเกตคนแรกของการ resolve (then ที่ผูกทันทีหลังสร้าง promise) ปิดตัวจดแล้วอ่านผล
  //    ถ้าการจดยังไม่ทัน ok จะยังเป็น null ⇒ แถวเติมได้ "[บอทไม่ได้ตอบ]" ทั้งที่ส่งสำเร็จ
  {
    const slow = (ms: number, mode: 'ok' | 'err'): ReplyClient => ({
      replyMessage: () => new Promise((res, rej) => setTimeout(() => (mode === 'ok' ? res({ ok: 1 }) : rej(new Error('ช้าแล้วล้ม'))), ms)),
    });
    const observe = async (
      label: string,
      inner: ReplyClient,
      make: (c: ReplyClient) => Promise<unknown>,
      want: boolean,
    ) => {
      const rec = createRecordingClient(inner);
      const p = make(rec.client);
      let snap: readonly ReplyAttempt[] | null = null;
      p.then(() => { snap = rec.close(); }, () => { snap = rec.close(); });   // ผู้สังเกตคนแรก
      rec.watch(p);
      await p.catch(() => {});
      await tick();
      const s = snap as readonly ReplyAttempt[] | null;
      check(label, s !== null && s.length === 1 && s[0].ok === want, JSON.stringify(s?.map(x => x.ok)));
    };
    await observe('1m. `return await replyMessage()` · inner resolve ช้า 40ms → จดเสร็จก่อนงาน resolve',
      slow(40, 'ok'), async (c) => { const r = await c.replyMessage(P([{ type: 'text', text: 'a' }])); return r; }, true);
    await observe('1m. `return replyMessage()` ไม่มี await · inner resolve ช้า 40ms → จดเสร็จก่อนงาน resolve',
      slow(40, 'ok'), async (c) => { return c.replyMessage(P([{ type: 'text', text: 'a' }])); }, true);
    await observe('1m. `return replyMessage()` ไม่มี await · inner resolve ทันที → จดเสร็จก่อนงาน resolve',
      { replyMessage: () => Promise.resolve({}) }, async (c) => { return c.replyMessage(P([{ type: 'text', text: 'a' }])); }, true);
    await observe('1m. ฟังก์ชันธรรมดา (ไม่ async) คืน promise ของ replyMessage ตรง ๆ → จดเสร็จก่อน',
      slow(40, 'ok'), (c) => c.replyMessage(P([{ type: 'text', text: 'a' }])), true);
    await observe('1m. `return replyMessage()` ไม่มี await · inner reject ช้า → จด ok=false ก่อนงาน reject',
      slow(40, 'err'), async (c) => { return c.replyMessage(P([{ type: 'text', text: 'a' }])); }, false);
    await observe('1m. `return await` ใน try/catch ที่กลืน error (รูปของทางสำรอง) → จด ok=false ก่อนงาน resolve',
      slow(40, 'err'), async (c) => { try { return await c.replyMessage(P([{ type: 'text', text: 'a' }])); } catch { return null; } }, false);
    // งานที่ "ไม่ await" การส่ง — จบก่อนส่งเสร็จ ⇒ รอบค้าง = pending (ถูกต้อง ไม่ใช่ none/failed)
    {
      const rec = createRecordingClient(slow(80, 'ok'));
      const p = rec.watch((async () => { void rec.client.replyMessage(P([{ type: 'text', text: 'a' }])); })());
      await p;
      const settled = await waitSettled(rec, 1_000);
      const a = rec.close();
      check('1m. งานที่ไม่ await การส่ง (จบก่อนส่งเสร็จ) → รอบค้าง ok=null → pending · ไม่มีแถว reply_content ปลอม',
        settled && a.length === 1 && a[0].ok === null && replyStatusOf(a, settled) === 'pending'
        && buildFillRow({ event: { type: 'postback', replyToken: 't', source: { userId: 'U' }, postback: { data: 'x' } }, receivedAt: 0, attempts: a, settled })?.reply_content === NO_REPLY_TEXT);
      await sleep(120);   // ปล่อยให้ timer ของ inner ปลอมจบ ไม่ค้างข้ามข้อ
    }
  }

  // 1n finishEventRecord เส้นทาง image (ไม่แตะ DB) และ rec null
  {
    const rec = createRecordingClient({ replyMessage: async () => ({}) });
    rec.watch(Promise.resolve());
    await rec.client.replyMessage(P([{ type: 'text', text: 'ก่อน' }]));
    finishEventRecord({ event: { type: 'message', message: { type: 'image', id: 'i' } }, webhookEventId: null, rec, receivedAt: Date.now() });
    await rec.client.replyMessage(P([{ type: 'text', text: 'หลัง' }]));
    const left = await flushWebhookRecords(1_000);
    check('1n. finishEventRecord(image) ปิดตัวจดทันที ไม่จดต่อ · ไม่ค้างในรายการ', rec.close().length === 1 && left === 0, `เหลือ ${left}`);
    let threw = false;
    try { finishEventRecord({ event: { type: 'postback' }, webhookEventId: null, rec: null, receivedAt: 0 }); } catch { threw = true; }
    check('1n. finishEventRecord(rec=null) ไม่ทำอะไร ไม่ throw', !threw && (await flushWebhookRecords(200)) === 0);
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// 2. buildFillRow / waitSettled
// ════════════════════════════════════════════════════════════════════════════════════
async function part2(): Promise<void> {
  section('2) buildFillRow · waitSettled (ไม่แตะ DB)');
  const okText: ReplyAttempt = { startedAt: 0, endedAt: 1, ok: true, parts: [{ kind: 'text', text: 'คำตอบบอท' }], error: null };
  const okFlex: ReplyAttempt = { startedAt: 0, endedAt: 1, ok: true, parts: [{ kind: 'flex', text: 'ร่างใบ' }], error: null };
  const failed: ReplyAttempt = { startedAt: 0, endedAt: 1, ok: false, parts: [{ kind: 'text', text: 'ไม่ถึง' }], error: '400' };
  const src = { userId: 'Udiag', type: 'user' };
  const base = { replyToken: 'diagwr-rt', source: src };
  const RECEIVED = 1_759_400_000_000;

  type Want = null | { type: string; content: string | RegExp; message_id: string | RegExp; reply_content: string };
  const cases: [string, any, ReplyAttempt[], boolean, Want][] = [
    ['postback', { ...base, type: 'postback', postback: { data: 'action=select_company&id=7' } }, [okFlex], true,
      { type: webhookFillType('postback'), content: '[กดปุ่ม] action=select_company&id=7',
        message_id: new RegExp(`^${webhookFillType('postback')}_\\d+$`), reply_content: 'ร่างใบ' }],
    ['postback ไม่มี data', { ...base, type: 'postback', postback: {} }, [], true,
      { type: webhookFillType('postback'), content: '[กดปุ่ม] ', message_id: /_\d+$/, reply_content: NO_REPLY_TEXT }],
    ['message text', { ...base, type: 'message', message: { id: '5551', type: 'text', text: 'ขอราคา TS-01' } }, [okText], true,
      { type: webhookFillType('text'), content: 'ขอราคา TS-01', message_id: '5551', reply_content: 'คำตอบบอท' }],
    ['message sticker', { ...base, type: 'message', message: { id: '5552', type: 'sticker' } }, [okText], true,
      { type: webhookFillType('sticker'), content: '[Received sticker message]', message_id: '5552', reply_content: 'คำตอบบอท' }],
    ['message ชนิดแปลก (ไม่ผ่าน /^[a-z_]{1,20}$/)', { ...base, type: 'message', message: { id: '5553', type: 'Weird-Type' } }, [], true,
      { type: webhookFillType('unknown'), content: '[Received Weird-Type message]', message_id: '5553', reply_content: NO_REPLY_TEXT }],
    ['ส่งล้มทุกรอบ → [บอทไม่ได้ตอบ]', { ...base, type: 'message', message: { id: '5554', type: 'text', text: 'x' } }, [failed], true,
      { type: webhookFillType('text'), content: 'x', message_id: '5554', reply_content: NO_REPLY_TEXT }],
    ['image', { ...base, type: 'message', message: { id: '1', type: 'image' } }, [okText], true, null],
    ['follow', { ...base, type: 'follow' }, [okText], true, null],
    ['unfollow', { type: 'unfollow', source: src }, [], true, null],
    ['join', { ...base, type: 'join' }, [], true, null],
    ['ไม่มี userId', { type: 'postback', replyToken: 't', source: { type: 'group' }, postback: { data: 'x' } }, [okText], true, null],
    ['ไม่มี replyToken', { type: 'postback', source: src, postback: { data: 'x' } }, [okText], true, null],
    ['ยังไม่ settled', { ...base, type: 'postback', postback: { data: 'x' } }, [okText], false, null],
  ];

  const bad: string[] = [];
  const rows: any[] = [];
  for (const [name, event, attempts, settled, want] of cases) {
    const row = buildFillRow({ event, receivedAt: RECEIVED, attempts, settled });
    if (want === null) { if (row !== null) bad.push(`${name}: ต้องไม่เขียน แต่ได้แถว`); continue; }
    if (!row) { bad.push(`${name}: ไม่ได้แถว`); continue; }
    rows.push(row);
    const mismatch =
      row.type !== want.type
      || (typeof want.content === 'string' ? row.content !== want.content : !want.content.test(row.content))
      || (typeof want.message_id === 'string' ? row.message_id !== want.message_id : !want.message_id.test(row.message_id))
      || row.reply_content !== want.reply_content
      || row.user_id !== 'Udiag' || row.created_at_ms !== RECEIVED
      || (row.reply_token !== 'diagwr-rt');
    if (mismatch) bad.push(`${name}: ${JSON.stringify(row)}`);
  }
  check(`2a. buildFillRow ครบ ${cases.length} กรณีในตาราง (เขียน ${rows.length} · ไม่เขียน ${cases.length - rows.length})`,
    bad.length === 0, bad.join(' | '));
  check('2b. type ขึ้นต้น prefix เสมอ · ไม่เคยเป็น text / postback / web_*',
    rows.every(r => isWebhookFillType(r.type) && r.type !== 'text' && r.type !== 'postback' && !r.type.startsWith('web_')));
  check('2c. แถวเติมไม่มีคีย์ meta', rows.every(r => !('meta' in r)));
  const prompts = rows.map(r => `เซลส์: ${r.content}\nบอท: ${r.reply_content}`);
  check('2d. `เซลส์: ${content}\\nบอท: ${reply_content}` ไม่มี null/undefined ทุกแถว (quoteExtraction ต่อสตริงแบบนี้)',
    rows.every(r => typeof r.content === 'string' && typeof r.reply_content === 'string' && r.reply_content !== '')
    && prompts.every(s => !/\bnull\b|\bundefined\b/.test(s)));

  // waitSettled
  const recNever = createRecordingClient({ replyMessage: async () => null });
  recNever.watch(new Promise(() => {}));
  const t0 = Date.now();
  const short = await waitSettled(recNever, 60);
  const shortMs = Date.now() - t0;
  const recSoon = createRecordingClient({ replyMessage: async () => null });
  recSoon.watch(sleep(30));
  const long = await waitSettled(recSoon, 5_000);
  const recReject = createRecordingClient({ replyMessage: async () => null });
  const pr = (async () => { await sleep(20); throw new Error('งานล้ม'); })();
  recReject.watch(pr);
  pr.catch(() => {});
  const rej = await waitSettled(recReject, 5_000);
  const unwatched = await waitSettled(createRecordingClient({ replyMessage: async () => null }), 5_000);
  check('2e. waitSettled: เพดานสั้น (งานไม่จบ) → false ตามเวลา · งานจบก่อนเพดาน → true · งานล้ม → true · ไม่เคย watch → false',
    short === false && shortMs >= 55 && shortMs < 1_000 && long === true && rej === true && unwatched === false,
    `short=${short}/${shortMs}ms long=${long} reject=${rej} unwatched=${unwatched}`);
  check(`2f. SETTLE_CAP_MS = 120 วิ (token ที่ยังไม่ใช้ตอบได้ถึง 120 วิ วัด 2026-09-23)`, SETTLE_CAP_MS === 120_000);
}

// ════════════════════════════════════════════════════════════════════════════════════
// 3. อ่านซอร์ส
// ════════════════════════════════════════════════════════════════════════════════════
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|mts|mjs|js)$/.test(name) && !/\.gen\.ts$/.test(name)) out.push(p);
  }
  return out;
}
/** ตัดคอมเมนต์ทิ้งแบบหยาบ — พลาดได้แค่ทาง "ไม่เจอ" (ตัดเกิน) ไม่ใช่ทางเจอผิด */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1');

function part3(): void {
  section('3) อ่านซอร์ส');
  const handler = read('handlers/lineHandler.ts');
  const index = read('index.ts');
  const repo = read('db/repositories.ts');

  // 3a insertMessage ทุกจุดถูก await — NOT EXISTS ของแถวเติมพึ่งข้อนี้ (แถวของ handler ต้องลงก่อน settled)
  const callLines = handler.split('\n').map((l, i) => ({ l, n: i + 1 }))
    .filter(x => /\binsertMessage\(/.test(x.l) && !/^\s*import\b/.test(x.l));
  const notAwaited = callLines.filter(x => !/\bawait\s+insertMessage\(/.test(x.l));
  check(`3a. insertMessage( ใน lineHandler ถูก await ทุกจุด (${callLines.length} จุด)`,
    callLines.length > 0 && notAwaited.length === 0, notAwaited.map(x => `บรรทัด ${x.n}`).join(', '));

  // 3b defaultLineClient มี 3 จุด: import · ค่าปริยาย · handleImage (ทางเดียวที่ข้ามตัวจด)
  const dl = [...handler.matchAll(/\bdefaultLineClient\b/g)].length;
  const imgFn = /export async function handleImage\([\s\S]*?\n}\n/.exec(handler)?.[0] ?? '';
  const sendsOutside = handler.replace(imgFn, '').match(/defaultLineClient\.replyMessage/g)?.length ?? 0;
  check('3b. defaultLineClient มี 3 จุด (import · `opts.client ?? defaultLineClient` · handleImage) และส่งตรงได้แค่ใน handleImage',
    dl === 3 && /opts\.client \?\? defaultLineClient/.test(handler) && /defaultLineClient\.replyMessage/.test(imgFn) && sendsOutside === 0,
    `พบ ${dl} จุด · ส่งตรงนอก handleImage ${sendsOutside}`);
  check('3b. handleImage ถูกเรียกเฉพาะ message ชนิด image (ตรงกับที่ finishEventRecord ข้าม)',
    /if \(event\.type === "message" && event\.message\.type === "image"\) \{\s*return handleImage\(event\);/.test(handler)
    && (handler.match(/\bhandleImage\(event\)/g)?.length ?? 0) === 1);

  // 3c index.ts ต่อสายตัวจด + ทางถอย
  check('3c. index.ts สร้างตัวจดจาก lineClient ตัวเดิม และมีทางถอยเมื่อสร้างไม่ได้ (rec = null)',
    /try \{ rec = createRecordingClient\(lineClient\); \} catch \{ rec = null; \}/.test(index));
  check('3c. ส่ง client: rec?.client (null ⇒ undefined ⇒ lineClient ตัวเดิม) · คืน rec.watch(p) / p ตัวเดิม',
    /client: rec\?\.client,/.test(index) && /return rec \? rec\.watch\(p\) : p;/.test(index));
  check('3c. finishEventRecord / noteEventText / noteRedeliveryReply ไม่ถูก await (ไม่ถ่วงเส้นตอบ/สล็อตคิว)',
    !/await\s+(finishEventRecord|noteEventText|noteRedeliveryReply)\(/.test(index)
    && /finishEventRecord\(\{ event, webhookEventId: receipt\?\.webhookEventId \?\? null, rec, receivedAt \}\)/.test(index));

  // 3d toIncomingEvent ไม่เรียกตัวช่วย (รันใน forEach นอก try)
  const tie = /function toIncomingEvent\([\s\S]*?\n}\n/.exec(index)?.[0] ?? '';
  const mt = /messageText:([\s\S]*?),\n\s*};/.exec(tie)?.[1] ?? '';
  check('3d. toIncomingEvent: ช่อง messageText ไม่เรียกฟังก์ชันใด ๆ', mt !== '' && !/[A-Za-z_$][\w$]*\s*\(/.test(stripComments(mt)),
    mt.trim().slice(0, 80));
  check('3d. recordIncomingEvent ไม่เขียน message_text (ใบรับต้องไม่ล้มเมื่อฐานยังไม่ได้รัน migration)',
    !/message_text/.test(/export async function recordIncomingEvent[\s\S]*?\n}\n/.exec(read('db/webhookEventsRepo.ts'))?.[0] ?? 'message_text'));

  // 3e 'wh_' เขียนตรงได้แค่ใน db/messageKinds.ts
  const files = [join(ROOT, 'index.ts'), join(ROOT, 'pdfGenerator.ts'),
    ...['services', 'db', 'handlers', 'utils', 'config', 'routes', 'scripts', 'integrations']
      .map(d => join(ROOT, d)).filter(d => { try { return statSync(d).isDirectory(); } catch { return false; } })
      .flatMap(d => walk(d))];
  const lit = new RegExp(`['"\`]${WEBHOOK_FILL_PREFIX}`);
  const offenders = files.filter(f => relative(ROOT, f) !== join('db', 'messageKinds.ts'))
    .filter(f => lit.test(stripComments(readFileSync(f, 'utf8'))))
    .map(f => relative(ROOT, f));
  check(`3e. prefix ของแถวเติมเขียนเป็นสตริงตรง ๆ ได้แค่ใน db/messageKinds.ts (ตรวจ ${files.length} ไฟล์)`,
    offenders.length === 0 && lit.test(read('db/messageKinds.ts')), offenders.join(', '));

  // 3f getRecentMessages + สคริปต์ 5 ตัวกรองแถวเติม
  const grm = /export async function getRecentMessages\([\s\S]*?\n}\n/.exec(repo)?.[0] ?? '';
  check('3f. getRecentMessages กรองด้วย excludeWebhookFillSql() และใช้ executor ที่ส่งเข้ามา',
    /\$\{excludeWebhookFillSql\(\)\}/.test(grm) && /await db\.query\(/.test(grm) && !/pool\.query/.test(grm));
  const qe = read('services/quoteExtraction.ts');
  check('3f. quoteExtraction อ่านประวัติผ่าน getRecentMessages ทางเดียว (ไม่ query messages เอง)',
    /getRecentMessages\(userId, 10\)/.test(qe) && !/\b(FROM|JOIN)\s+messages\b/i.test(qe));
  const five = ['scripts/diag/extractionCorpus.ts', 'scripts/diag/searchIndexEval.ts', 'scripts/diag/searchPostDeployEval.ts',
    'scripts/diag/extractionReliability.ts', 'scripts/diag/productCandidateEval.ts'];
  const missing = five.filter(f => {
    const s = read(f);
    return !/import \{ excludeWebhookFillSql \} from '\.\.\/\.\.\/db\/messageKinds\.js';/.test(s) || !/\$\{excludeWebhookFillSql\(/.test(s);
  });
  check('3f. สคริปต์วัดผล 5 ตัว import และใช้ excludeWebhookFillSql', missing.length === 0, missing.join(', '));

  // 3g ผู้อ่าน messages ฝั่งแอป — ตัวใหม่ต้องถูกตัดสินว่ากรองไหม แล้วเติมชื่อในรายการนี้
  const KNOWN_READERS = new Set([
    'db/repositories.ts',                // getRecentMessages (กรอง) · insertWebhookFillMessage · getMessageMetaById (ตาม id)
                                         // · getRetryableFailedText (นับ wh_text เป็น "ข้อความที่ใหม่กว่า" โดยตั้งใจ · ไม่ป้อน LLM)
    'services/salespersonPicker.ts',     // max(created_at) — กดปุ่ม = ใช้งานล่าสุด ถูกความหมาย (แผน B.11)
    'scripts/logworker/trafficDailyJob.ts', // นับทุกแถวตามที่เจ้าของเคาะ (แผน B.12)
    'db/logRepositories.ts',             // หน้าบันทึก เฟส 2 (listChatRowsForRequests) — ต้องเห็นแถวเติมด้วย · ไม่ป้อน LLM
  ]);
  const appFiles = files.filter(f => !relative(ROOT, f).startsWith('scripts/') || relative(ROOT, f).startsWith('scripts/logworker/'));
  const readers = appFiles.filter(f => /\b(FROM|JOIN)\s+messages\b/i.test(stripComments(readFileSync(f, 'utf8'))))
    .map(f => relative(ROOT, f));
  const unknown = readers.filter(f => !KNOWN_READERS.has(f));
  check('3g. ผู้อ่านตาราง messages ฝั่งแอปมีแค่ที่ตัดสินแล้วว่ากรอง/ไม่กรอง', unknown.length === 0,
    unknown.length ? `ตัวใหม่: ${unknown.join(', ')} — ตัดสินว่าต้อง excludeWebhookFillSql ไหม แล้วเติมใน KNOWN_READERS` : readers.join(', '));

  // 3h สำเนาข้อความของ lineHandler ที่ buildFillRow ลอกมา ยังอยู่
  check('3h. `[Received ${messageType} message]` ยังอยู่ใน lineHandler (buildFillRow ลอกรูปนี้)',
    handler.includes('`[Received ${messageType} message]`'));

  // 3i getRecentMessages ป้อน LLM — prefix คำนวณจากค่าคงที่ ไม่ใช่เลขพิมพ์มือ
  check('3i. excludeWebhookFillSql() = left(type, <ความยาว prefix>) IS DISTINCT FROM <prefix> · ใส่ alias ได้',
    excludeWebhookFillSql() === `left(type, ${WEBHOOK_FILL_PREFIX.length}) IS DISTINCT FROM '${WEBHOOK_FILL_PREFIX}'`
    && excludeWebhookFillSql('b').startsWith('left(b.type, '));
}

// ── 3ข --frozen-handler ───────────────────────────────────────────────────────────────
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }).trim();

/** กติกาเดียวกับ resolveBase ของ lineFlexParity.ts / customerCacheMemo.ts (ก๊อปมา — import ไฟล์นั้นจะรัน main ของมัน) */
function resolveBase(): { ref: string; why: string } {
  if (BASE_ARG) return { ref: BASE_ARG, why: 'ระบุเองด้วย --base' };
  const head = git('rev-parse', 'HEAD');
  const main = (() => { try { git('rev-parse', '--verify', 'main'); return 'main'; } catch { return 'origin/main'; } })();
  const mb = git('merge-base', 'HEAD', main);
  if (mb !== head) return { ref: mb, why: `จุดแยกจาก ${main}` };
  if (git('status', '--porcelain', '--untracked-files=no') !== '') return { ref: 'HEAD', why: 'HEAD (มีไฟล์แก้ค้าง)' };
  return { ref: 'HEAD^1', why: 'ก่อน commit/merge ล่าสุดบน main' };
}

function part3b(): void {
  section('3ข) --frozen-handler: handlers/lineHandler.ts ต้องไม่มีบรรทัดโค้ดเปลี่ยน');
  if (!FROZEN) { skipped('3ข', 'ไม่ได้ใส่ -- --frozen-handler (ใส่ตอนตรวจ branch ของงานนี้ก่อน merge)'); return; }
  let base: { ref: string; why: string };
  let diff: string;
  try {
    base = resolveBase();
    diff = git('diff', '--unified=0', base.ref, '--', 'handlers/lineHandler.ts');
  } catch (e: any) {
    check('3ข. อ่าน git diff ได้', false, e?.message?.split('\n')[0] ?? String(e));
    return;
  }
  const changed = diff.split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)).map(l => l.slice(1));
  const isComment = (l: string) => { const t = l.trim(); return t === '' || t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'); };
  const code = changed.filter(l => !isComment(l));
  check(`3ข. เทียบ ${base.ref.slice(0, 10)} (${base.why}): เปลี่ยน ${changed.length} บรรทัด เป็นคอมเมนต์ทั้งหมด`,
    code.length === 0, code.slice(0, 3).map(l => l.trim().slice(0, 80)).join(' | '));
}

// ════════════════════════════════════════════════════════════════════════════════════
// 4. ฐานจริง — SELECT / EXPLAIN อย่างเดียว
// ════════════════════════════════════════════════════════════════════════════════════
const OLD_SQL = `SELECT content, reply_content, created_at, type FROM messages
                  WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`;   // SQL ของ getRecentMessages ก่อนแก้ (+ type ไว้ตัดใน JS)
const key = (r: any) => JSON.stringify([r.content, r.reply_content, r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at]);

async function part4(): Promise<boolean> {
  section('4) ฐานจริง (SELECT/EXPLAIN อย่างเดียว): getRecentMessages ใหม่ = SQL เดิม ทุก user');
  let users: { user_id: string; n_fill: number }[];
  try {
    users = (await pool.query(
      `SELECT user_id, count(*) FILTER (WHERE NOT (${excludeWebhookFillSql()}))::int AS n_fill
         FROM messages WHERE user_id IS NOT NULL GROUP BY user_id`)).rows;
  } catch (e: any) {
    check('4. ต่อฐานได้ — ด่านนี้ห้ามผ่านแบบว่างเปล่า', false, e?.message ?? String(e));
    return false;
  }
  const totalFill = users.reduce((s, u) => s + u.n_fill, 0);
  console.log(`  ${D}${users.length} user · แถวเติมในฐาน ${totalFill} แถว (${totalFill === 0 ? 'ก่อน deploy — ต้องเท่า SQL เดิมเป๊ะ' : 'หลัง deploy — เทียบกับ SQL เดิมที่ตัดแถวเติมใน JS'})${X}`);
  let captured = '';
  const spy = { query: (sql: string, params?: any[]) => { captured = sql; return pool.query(sql, params); } } as any;
  const bad: string[] = [];
  let compared = 0, rowsCompared = 0;
  for (const u of users) {
    const neu = await getRecentMessages(u.user_id, 10, spy);
    const old = (await pool.query(OLD_SQL, [u.user_id, 10 + u.n_fill])).rows
      .filter((r: any) => !isWebhookFillType(r.type)).slice(0, 10);
    compared++; rowsCompared += neu.length;
    if (neu.length !== old.length || neu.some((r: any, i: number) => key(r) !== key(old[i])) ||
        neu.some((r: any) => Object.keys(r).join(',') !== 'content,reply_content,created_at')) {
      bad.push(`${u.user_id.slice(0, 10)}… (${neu.length} vs ${old.length})`);
    }
  }
  check(`4a. ทุก user (${compared} คน · ${rowsCompared} แถว) ได้ประวัติชุดเดิมทุกแถวทุกลำดับ และคอลัมน์ชุดเดิม`,
    compared > 0 && rowsCompared > 0 && bad.length === 0, bad.slice(0, 5).join(', '));

  // 4b EXPLAIN ของ SQL ที่ getRecentMessages ส่งจริง (จับจาก spy) กับ user ที่แถวเยอะที่สุด
  try {
    const top = (await pool.query(`SELECT user_id FROM messages WHERE user_id IS NOT NULL GROUP BY user_id ORDER BY count(*) DESC LIMIT 1`)).rows[0]?.user_id;
    const plan = (await pool.query(`EXPLAIN (FORMAT JSON) ${captured}`, [top, 10])).rows[0]['QUERY PLAN'][0].Plan;
    const nodes: any[] = [];
    const visit = (n: any) => { nodes.push(n); (n.Plans ?? []).forEach(visit); };
    visit(plan);
    const idx = nodes.some(n => /Index Scan/.test(n['Node Type']) && n['Index Name'] === 'idx_messages_user_created');
    const sort = nodes.some(n => /Sort/.test(n['Node Type']));
    check('4b. EXPLAIN = Index Scan idx_messages_user_created · ไม่มี Sort', idx && !sort,
      nodes.map(n => `${n['Node Type']}${n['Index Name'] ? `(${n['Index Name']})` : ''}`).join(' > '));
  } catch (e: any) {
    check('4b. EXPLAIN ได้', false, e?.message ?? String(e));
  }

  // 4c ตัวกรองไม่ทำแถวที่ type ว่าง / มี _ ปนหาย (ตารางค่าจริงของ SQL ไม่มีการเขียน)
  const truth = (await pool.query(
    `SELECT ${excludeWebhookFillSql('v')} AS keep FROM (VALUES (1, NULL::text), (2, 'text'), (3, 'postback'),
            (4, 'web_draft'), (5, 'whXpostback'), (6, $1::text), (7, $2::text), (8, 'WH_text')) v(i, type)
      ORDER BY v.i`,
    [webhookFillType('postback'), webhookFillType('text')])).rows.map((r: any) => r.keep);
  check('4c. ตัวกรองเก็บ NULL / text / postback / web_* / whXpostback / WH_text · ตัดเฉพาะแถวเติม',
    JSON.stringify(truth) === JSON.stringify([true, true, true, true, true, false, false, true]), JSON.stringify(truth));
  return true;
}

// ════════════════════════════════════════════════════════════════════════════════════
// 5. ตารางชั่วคราวบังของจริง + ROLLBACK เสมอ
// ════════════════════════════════════════════════════════════════════════════════════
class ForceRollback extends Error { constructor() { super('__ROLLBACK__'); } }

async function assertShadowed(c: pg.PoolClient): Promise<boolean> {
  const { rows } = await c.query<{ t: string; temp: boolean }>(`
    SELECT t, coalesce(to_regclass(t)::oid IN (SELECT oid FROM pg_class WHERE relpersistence = 't'), false) AS temp
      FROM unnest(ARRAY['webhook_events', 'messages']) AS t`);
  const seq = (await c.query(`SELECT pg_get_serial_sequence('messages', 'id') AS s`)).rows[0]?.s as string | null;
  const seqTemp = seq ? (await c.query(`SELECT relpersistence = 't' AS t FROM pg_class WHERE oid = to_regclass($1)`, [seq])).rows[0]?.t === true : true;
  return check('5.0 webhook_events / messages ที่ SQL เห็นเป็นตารางชั่วคราว · identity ของ messages ใช้ sequence ชั่วคราว',
    rows.every(r => r.temp) && seqTemp,
    rows.map(r => `${r.t}=${r.temp ? 'temp' : 'จริง!'}`).join(' ') + ` · seq=${seq ?? '-'}${seqTemp ? '' : ' (จริง!)'}`);
}

async function part5(): Promise<void> {
  section('5) ตารางชั่วคราวบังของจริง + ROLLBACK เสมอ');
  const REPLY_COLS = ['message_text', 'reply_status', 'reply_error', 'reply_preview'];
  try {
    await withTransaction(async (c) => {
      await c.query(`CREATE TEMP TABLE webhook_events (LIKE public.webhook_events INCLUDING ALL) ON COMMIT DROP`);
      await c.query(`CREATE TEMP TABLE messages (LIKE public.messages INCLUDING ALL) ON COMMIT DROP`);
      if (!(await assertShadowed(c))) {
        console.log(`  ${R}หยุดทั้งชุด 5 — ตารางที่ SQL เห็นไม่ใช่ของชั่วคราว ไม่เขียนอะไรเลย${X}`);
        throw new ForceRollback();
      }

      // (ก) migration ใหม่สองรอบ บนตารางที่ยังไม่มีคอลัมน์ (ถอดออกจากสำเนาชั่วคราวก่อน ถ้าฐานจริงมีแล้ว)
      await c.query(`ALTER TABLE webhook_events DROP CONSTRAINT IF EXISTS webhook_events_reply_status_check`);
      for (const col of REPLY_COLS) await c.query(`ALTER TABLE webhook_events DROP COLUMN IF EXISTS ${col}`);
      const mig = read('migrations/changes/2026-10-02_01_webhook_events_reply.sql');
      check('5ก. ไฟล์ migration ไม่ใส่ public. (ด่านเอาตารางชั่วคราวบังได้) · ไม่มี COMMENT ON',
        !/public\./.test(mig.replace(/^--.*$/gm, '')) && !/COMMENT\s+ON/i.test(mig.replace(/^--.*$/gm, '')));
      await c.query(mig);
      await c.query(mig);
      const cols = (await c.query(
        `SELECT attname FROM pg_attribute WHERE attrelid = to_regclass('webhook_events') AND attnum > 0 AND NOT attisdropped`)).rows.map((r: any) => r.attname);
      const cks = (await c.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = to_regclass('webhook_events') AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%reply_status%'`)).rows.map((r: any) => r.conname);
      check('5ก. รันสองรอบ: ได้ 4 คอลัมน์ + CHECK ของ reply_status ตัวเดียว ชื่อ webhook_events_reply_status_check',
        REPLY_COLS.every(x => cols.includes(x)) && cks.length === 1 && cks[0] === 'webhook_events_reply_status_check', cks.join(','));
      await c.query(`INSERT INTO webhook_events (webhook_event_id, event_type) VALUES ('diagwr-ev-ck', 'message')`);
      const accepted: string[] = [];
      for (const v of ['sent', 'failed', 'pending', 'none', null]) {
        await c.query('SAVEPOINT ck');
        try { await c.query(`UPDATE webhook_events SET reply_status = $1 WHERE webhook_event_id = 'diagwr-ev-ck'`, [v]); accepted.push(String(v)); }
        catch { /* ไม่ควรเกิด */ }
        await c.query('ROLLBACK TO SAVEPOINT ck');
      }
      const rejected: string[] = [];
      for (const v of ['bogus', 'SENT', 'replied', '']) {
        await c.query('SAVEPOINT ck');
        try { await c.query(`UPDATE webhook_events SET reply_status = $1 WHERE webhook_event_id = 'diagwr-ev-ck'`, [v]); }
        catch (e: any) { if (e?.code === '23514') rejected.push(v); }
        await c.query('ROLLBACK TO SAVEPOINT ck');
      }
      check('5ก. CHECK รับ sent/failed/pending/none/NULL · ปฏิเสธค่าแปลก (bogus · SENT · replied · ว่าง)',
        accepted.length === 5 && rejected.length === 4, `รับ ${accepted.join(',')} · ปฏิเสธ ${rejected.join(',') || '-'}`);
      const pubDup = (await c.query(
        `SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.webhook_events'::regclass AND conname LIKE 'webhook_events_reply_status_check_%'`)).rows[0].n;
      check('5ก. ฐานจริงไม่มี CHECK ซ้ำ (_check1 …) ของ reply_status', pubDup === 0, `${pubDup}`);

      // (ข) recordEventText / recordReplyOutcome — เขียนครั้งเดียว · ตัด NUL · ตัดความยาว
      for (const id of ['diagwr-ev-1', 'diagwr-ev-2', 'diagwr-ev-3']) {
        await c.query(`INSERT INTO webhook_events (webhook_event_id, event_type) VALUES ($1, 'message')`, [id]);
      }
      const getEv = async (id: string) => (await c.query(`SELECT * FROM webhook_events WHERE webhook_event_id = $1`, [id])).rows[0];
      await recordEventText('diagwr-ev-1', 'สวัสดี\u0000ครับ', c);
      await recordEventText('diagwr-ev-1', 'ข้อความที่สอง', c);
      await recordEventText('diagwr-ev-2', 'ก'.repeat(6000), c);
      await recordEventText('diagwr-ev-3', 'a'.repeat(4999) + '😀', c);
      await recordEventText('diagwr-ev-ไม่มี', 'x', c);
      const e1 = await getEv('diagwr-ev-1'), e2 = await getEv('diagwr-ev-2'), e3 = await getEv('diagwr-ev-3');
      check('5ข. recordEventText เขียนครั้งเดียว (รอบสองไม่ทับ) · ตัด NUL',
        e1.message_text === 'สวัสดีครับ', JSON.stringify(e1.message_text));
      check('5ข. recordEventText ตัดที่ 5000 · ไม่ทิ้ง surrogate ครึ่งตัว',
        e2.message_text.length === 5000 && e3.message_text.length === 4999, `${e2.message_text.length} / ${e3.message_text.length}`);
      await recordReplyOutcome('diagwr-ev-1', { status: 'failed', error: 'E'.repeat(1500) + '\u0000', preview: 'P\u0000'.repeat(700) }, c);
      await recordReplyOutcome('diagwr-ev-1', { status: 'sent', error: null, preview: 'ทับ' }, c);
      await recordReplyOutcome('diagwr-ev-2', { status: 'none' }, c);
      const r1 = await getEv('diagwr-ev-1'), r2 = await getEv('diagwr-ev-2');
      check('5ข. recordReplyOutcome เขียนครั้งเดียว · error ≤1000 · preview ≤1000 ไม่มี NUL',
        r1.reply_status === 'failed' && r1.reply_error.length === 1000 && r1.reply_preview === 'P'.repeat(700) && !/\u0000/.test(r1.reply_error),
        JSON.stringify([r1.reply_status, r1.reply_error?.length, r1.reply_preview?.length]));
      check('5ข. ไม่ส่ง error/preview = NULL', r2.reply_status === 'none' && r2.reply_error === null && r2.reply_preview === null);

      // (ค) insertWebhookFillMessage — NOT EXISTS สามกรณี
      const U = 'diagwr-U1';
      const now = Date.now();
      const count = async (tok: string) => (await c.query(`SELECT count(*)::int AS n FROM messages WHERE reply_token = $1`, [tok])).rows[0].n;
      await c.query(`INSERT INTO messages (user_id, message_id, type, content, reply_token, reply_content)
                     VALUES ($1, 'mh1', 'text', 'ข้อความของ handler', 'diagwr-T1', 'คำตอบของ handler')`, [U]);
      const fill = (tok: string, extra: Partial<WebhookFillRow> = {}): WebhookFillRow => ({
        created_at_ms: now - 2_000, user_id: U, message_id: `m-${tok}`, type: webhookFillType('postback'),
        content: '[กดปุ่ม] action=x', reply_token: tok, reply_content: 'ร่างใบ', ...extra,
      });
      const a1 = await insertWebhookFillMessage(fill('diagwr-T1'), c);
      check('5ค. มีแถวของ handler (token เดียวกัน) อยู่แล้ว → ไม่เขียน (null · ยังมี 1 แถว)', a1 === null && (await count('diagwr-T1')) === 1);
      const row2 = buildFillRow({
        event: { type: 'message', replyToken: 'diagwr-T2', source: { userId: U }, message: { id: 'm2', type: 'text', text: 'ขอ\u0000ราคา' } },
        receivedAt: now - 2_000, settled: true,
        attempts: [{ startedAt: 0, endedAt: 1, ok: true, parts: [{ kind: 'text', text: 'ได้ครับ' }], error: null }],
      })!;
      const a2 = await insertWebhookFillMessage(row2, c);
      const w2 = (await c.query(`SELECT *, (extract(epoch FROM created_at) * 1000)::bigint AS ms FROM messages WHERE reply_token = 'diagwr-T2'`)).rows;
      check('5ค. ไม่มีแถว → เขียน 1 แถว (id · type แถวเติม · meta NULL · created_at = เวลารับ webhook · ตัด NUL)',
        typeof a2 === 'number' && w2.length === 1 && w2[0].type === webhookFillType('text') && w2[0].meta === null
        && Math.abs(Number(w2[0].ms) - (now - 2_000)) <= 1 && w2[0].content === 'ขอราคา' && w2[0].reply_content === 'ได้ครับ',
        JSON.stringify(w2.map((r: any) => [r.type, r.meta, r.content, Number(r.ms) - (now - 2_000)])));
      const a3 = await insertWebhookFillMessage(row2, c);
      check('5ค. เขียนซ้ำ (token เดิม) → ไม่เขียน (null · ยังมี 1 แถว)', a3 === null && (await count('diagwr-T2')) === 1);
      await c.query(`INSERT INTO messages (created_at, user_id, message_id, type, content, reply_token, reply_content)
                     VALUES (now() - interval '11 minutes', $1, 'mh3', 'text', 'เก่า', 'diagwr-T3', 'เก่า')`, [U]);
      const a4 = await insertWebhookFillMessage(fill('diagwr-T3', { created_at_ms: now }), c);
      check('5ค. หน้าต่าง 10 นาที: แถวเก่ากว่า 10 นาทีไม่นับเป็นซ้ำ (ตามแบบ — แถว handler เกิดหลังรับ webhook เสมอ)',
        typeof a4 === 'number' && (await count('diagwr-T3')) === 2);
      const a5 = await insertWebhookFillMessage(fill('diagwr-T5', { type: 'text' }), c);
      check('5ค. type ไม่ขึ้นต้น prefix → ปฏิเสธ ไม่เขียน', a5 === null && (await count('diagwr-T5')) === 0);

      // (ง) ประวัติ LLM บนแถวผู้ใช้จริงที่ลอกมา + แถวเติมที่ใหม่กว่า
      const real = (await c.query(
        `SELECT user_id FROM public.messages WHERE user_id IS NOT NULL AND user_id NOT LIKE 'web:%'
          GROUP BY user_id HAVING count(*) FILTER (WHERE ${excludeWebhookFillSql()}) >= 15
          ORDER BY max(created_at) DESC LIMIT 1`)).rows[0]?.user_id as string | undefined;
      if (!real) {
        check('5ง. มีผู้ใช้จริงที่มีแถว ≥ 15 ให้ลอก', false);
      } else {
        await c.query(`INSERT INTO messages SELECT * FROM public.messages WHERE user_id = $1`, [real]);
        const before = await getRecentMessages(real, 10, c);
        const fromReal = (await c.query(
          `SELECT content, reply_content, created_at FROM public.messages WHERE user_id = $1 AND ${excludeWebhookFillSql()}
            ORDER BY created_at DESC LIMIT 10`, [real])).rows;
        const t = Date.now() + 60_000;   // ใหม่กว่าแถวจริงทุกแถว ⇒ ถ้าไม่กรองจะขึ้นหัวรายการ
        for (let i = 0; i < 5; i++) {
          await insertWebhookFillMessage({
            created_at_ms: t + i, user_id: real, message_id: `diagwr-ng-${i}`, type: webhookFillType(i % 2 ? 'text' : 'postback'),
            content: `[กดปุ่ม] diagwr-${i}`, reply_token: `diagwr-ng-${i}`, reply_content: NO_REPLY_TEXT,
          }, c);
        }
        const nFill = (await c.query(`SELECT count(*)::int AS n FROM messages WHERE user_id = $1 AND NOT (${excludeWebhookFillSql()})`, [real])).rows[0].n;
        const after = await getRecentMessages(real, 10, c);
        const control = (await c.query(
          `SELECT content, reply_content, created_at FROM messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`, [real])).rows;
        const same = (x: any[], y: any[]) => x.length === y.length && x.every((r, i) => key(r) === key(y[i]));
        check(`5ง. แทรกแถวเติม ${nFill} แถวที่ใหม่กว่า → getRecentMessages ได้ 10 แถวชุดเดิมทุกแถวทุกลำดับ`,
          nFill >= 5 && before.length === 10 && same(before, after) && same(before, fromReal));
        check('5ง. ชุดควบคุม (SQL เดิมไม่กรอง) ต้องไม่เท่า — พิสูจน์ว่าแถวเติมขึ้นหัวรายการจริง ด่านไม่ได้ผ่านเพราะมองไม่เห็น',
          !same(before, control) && control.slice(0, 5).every((r: any) => /^\[กดปุ่ม\] diagwr-/.test(r.content)));
      }

      // (จ) ข้อสุดท้าย — executor ที่พัง: ห้าม throw และพักเขียนคอลัมน์บันทึกผล
      //     ⚠️ หลังข้อนี้ recordEventText/recordReplyOutcome พักไป 10 นาทีทั้งโปรเซส ห้ามมีข้ออื่นตามหลัง
      const boomSync = { query: () => { throw new Error('diag: executor พังแบบ sync โดยตั้งใจ'); } } as any;
      const boomAsync = { query: async () => { throw new Error('diag: executor พังแบบ async โดยตั้งใจ'); } } as any;
      let calls = 0;
      const spy = { query: async () => { calls++; return { rows: [], rowCount: 0 }; } } as any;
      const threw: string[] = [];
      const tryNoThrow = async (name: string, f: () => Promise<unknown>) => { try { return await f(); } catch { threw.push(name); return undefined; } };
      console.log(`  ${D}(คาดว่าจะเห็นบรรทัด "[webhookEvents.recordEventText] พักเขียนคอลัมน์บันทึกผล 10 นาที" หนึ่งครั้ง และ [repo.*] สองบรรทัด)${X}`);
      await tryNoThrow('recordEventText', () => recordEventText('diagwr-x', 'y', boomSync));
      await tryNoThrow('recordEventText(พัก)', () => recordEventText('diagwr-x', 'y', spy));
      await tryNoThrow('recordReplyOutcome(พัก)', () => recordReplyOutcome('diagwr-x', { status: 'sent' }, spy));
      const ins = await tryNoThrow('insertWebhookFillMessage', () => insertWebhookFillMessage(fill('diagwr-boom'), boomAsync));
      const grm = await tryNoThrow('getRecentMessages', () => getRecentMessages('diagwr-x', 10, boomAsync));
      check('5จ. executor พัง → ไม่มีฟังก์ชันไหน throw (recordEventText · recordReplyOutcome · insertWebhookFillMessage → null · getRecentMessages → [])',
        threw.length === 0 && ins === null && Array.isArray(grm) && (grm as any[]).length === 0, threw.join(','));
      check('5จ. หลังล้มครั้งแรก พักเขียนทั้งสองฟังก์ชัน (ตัวพักร่วม · ไม่ยิง query เลย)', calls === 0, `ยิง ${calls} ครั้ง`);

      throw new ForceRollback();   // ห้ามเปลี่ยนเป็น COMMIT
    });
  } catch (e) {
    if (!(e instanceof ForceRollback)) {
      check('5. ชุดตารางชั่วคราวรันจบ', false, (e as any)?.message ?? String(e));
    }
  }
  // หลัง ROLLBACK: ฐานจริงต้องไม่มีร่องรอย
  try {
    const left = (await pool.query(
      `SELECT (SELECT count(*) FROM public.messages WHERE reply_token LIKE 'diagwr-%' OR message_id LIKE 'diagwr-%')
            + (SELECT count(*) FROM public.webhook_events WHERE webhook_event_id LIKE 'diagwr-%') AS n`)).rows[0].n;
    check('5. หลัง ROLLBACK ฐานจริงไม่มีแถวทดสอบ', Number(left) === 0, `${left}`);
  } catch (e: any) {
    check('5. ตรวจร่องรอยหลัง ROLLBACK ได้', false, e?.message ?? String(e));
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// 6. หลัง deploy — SELECT อย่างเดียว
// ════════════════════════════════════════════════════════════════════════════════════
async function part6(): Promise<void> {
  section('6) หลัง deploy (SELECT อย่างเดียว · ข้ามเองถ้ายังไม่มีคอลัมน์/แถว)');
  const have = new Set((await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'webhook_events'`)).rows
    .map((r: any) => r.column_name));
  const fillN = Number((await pool.query(
    `SELECT count(*) AS n FROM messages WHERE NOT (${excludeWebhookFillSql()})`)).rows[0].n);

  if (!have.has('reply_status')) {
    skipped('6a', 'ฐานจริงยังไม่ได้รัน 2026-10-02_01 (ไม่มี reply_status)');
  } else {
    const recorded = Number((await pool.query(`SELECT count(*) AS n FROM webhook_events WHERE reply_status IS NOT NULL`)).rows[0].n);
    if (recorded === 0) {
      skipped('6a', 'ยังไม่มี event ที่บันทึกผล (ยังไม่ deploy โค้ด)');
    } else {
      const { rows } = await pool.query(`
        SELECT we.webhook_event_id, we.event_type, we.message_type, we.reply_status
          FROM webhook_events we
         WHERE we.reply_status IS NOT NULL AND we.reply_status <> 'pending'
           AND (we.event_type = 'postback' OR (we.event_type = 'message' AND we.message_type IS DISTINCT FROM 'image'))
           AND we.reply_token IS NOT NULL AND we.line_user_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.reply_token = we.reply_token)
         ORDER BY we.first_seen_at DESC LIMIT 20`);
      check(`6a. event ที่จบแล้ว (message ไม่ใช่ image + postback · reply_status ≠ pending) ที่ไม่มีแถวใน messages = 0 (จาก ${recorded} ที่บันทึกผล)`,
        rows.length === 0, rows.slice(0, 5).map((r: any) => `${r.webhook_event_id.slice(0, 10)} ${r.event_type}/${r.message_type ?? '-'} ${r.reply_status}`).join(' · '));
    }
  }
  if (fillN === 0) {
    skipped('6b–6c', 'ยังไม่มีแถวเติมใน messages (ยังไม่ deploy โค้ด)');
    return;
  }
  const badShape = Number((await pool.query(`
    SELECT count(*) AS n FROM messages
     WHERE NOT (${excludeWebhookFillSql()})
       AND (content IS NULL OR content = '' OR reply_content IS NULL OR reply_content = ''
            OR meta IS NOT NULL OR user_id IS NULL OR user_id LIKE 'web:%' OR reply_token IS NULL)`)).rows[0].n);
  check(`6b. แถวเติม ${fillN} แถว: content/reply_content ไม่ว่าง · meta NULL · ไม่ใช่ user web:% = 0 แถวผิดรูป`, badShape === 0, `${badShape}`);
  const dup = Number((await pool.query(`
    SELECT count(*) AS n FROM messages a
     WHERE NOT (${excludeWebhookFillSql('a')})
       AND EXISTS (SELECT 1 FROM messages b WHERE b.reply_token = a.reply_token AND b.id <> a.id)`)).rows[0].n);
  check('6c. reply_token ของแถวเติมไม่ซ้ำกับแถวอื่น = 0', dup === 0, `${dup}`);
}

// ════════════════════════════════════════════════════════════════════════════════════
console.log(`${B}🧾 ด่านตรวจ: ตัวบันทึก webhook (webhook_events + แถวเติมใน messages)${X}`);
try {
  await part1();
  await part2();
  part3();
  part3b();
  const dbOk = await part4();
  if (dbOk) {
    await part6();   // อ่านอย่างเดียว — รันก่อนชุด 5 เพราะ (จ) ต้องเป็นข้อสุดท้ายของทั้งด่าน
    await part5();   // ⚠️ ต้องเป็นชุดสุดท้าย: ข้อ (จ) กระตุ้นตัวพักระดับโมดูล
  } else {
    console.log(`  ${R}ข้ามชุด 5–6 — ต่อฐานไม่ได้ (นับเป็นล้มที่ข้อ 4 แล้ว)${X}`);
  }
} catch (e: any) {
  check('ด่านรันจบโดยไม่มี error ที่ไม่คาดคิด', false, e?.stack?.split('\n').slice(0, 3).join(' · ') ?? String(e));
} finally {
  clearInterval(keepAlive);
  await pool.end().catch(() => {});
}

console.log(`\n${B}สรุป:${X} ${fail === 0 ? G : R}ผ่าน ${pass}${X} · ${fail > 0 ? R : D}ล้ม ${fail}${X}${skip ? ` · ${Y}ข้าม ${skip}${X}` : ''}`);
if (fail > 0) process.exit(1);
