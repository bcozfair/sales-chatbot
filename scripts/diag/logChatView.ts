/**
 * npm run diag:log-chat — ด่านของ "บทสนทนาในหน้าบันทึก" (เฟส 2 ของ docs/plan-message-log-merge.md)
 *
 * คำถามที่ด่านนี้ตอบ: **"คนที่ไม่ใช่ admin ได้เนื้อแชทออกไปจาก server ได้ทางไหนบ้าง"** และ
 * "ผลการส่ง/ตัวกรองส่งไม่ถึงเชื่อได้ไหม" · ข้อที่ห้ามล้มเด็ดขาด: ข้อ 2 (ไม่มีเนื้อหลุด) และข้อ 3 (สองฝั่งตรงกัน)
 *
 *   1. postbackLabel — ทุก action ที่ lineHandler/flexTemplates สร้าง · prefix `[กดปุ่ม]` · หลายใบ · ไม่รู้จัก
 *   2. **การตัดเนื้อแชทตาม role** — ฟังก์ชันบริสุทธิ์ (แถวสังเคราะห์ที่มีเนื้อติดมาด้วย) + ทุก role ใน
 *      config/capabilities.ts ผ่าน `getChatForRequests` บนตารางชั่วคราว: ไม่ใช่ admin = ไม่มีคีย์ `content` ·
 *      ไม่มีข้อความเฝ้าระวังใน JSON · **SQL ที่ยิงไม่มีคอลัมน์เนื้อเลย** (จับจาก executor ตัวสอดแนม)
 *   3. ผลการส่ง: `deliveryOf` ทุกชุดค่า · "บอทส่งไม่ถึง" ฝั่ง SQL (UNDELIVERED_EVENT_SQL) = ฝั่ง JS
 *      (isDeliveryProblem) ทุกชุดค่าบนตารางชั่วคราว และทุกแถวบนฐานจริง
 *   4. การผูกกับ request บนตารางชั่วคราว: LINE ผ่าน reply_token (ชุด PM+THT = 2 คำตอบ · แถวเติม
 *      `[บอทไม่ได้ตอบ]` · token เดียวกันแต่คนละ user ไม่ติดมา) · หน้าเว็บผ่าน meta.api_request_id เท่านั้น
 *   5. อ่านซอร์ส — route ที่คืนบทสนทนาส่ง role ของคนเรียกเสมอ · /export ไม่มีบทสนทนา · audit `log.view`
 *      entity `message` · จุด mount ยังเป็น page.traffic · ทุกจุดที่เขียนแถว web_* ส่ง api_request_id ·
 *      ตัวกรองส่งไม่ถึงใน buildApiLogWhere · หน้าจอไม่ตัดสินสิทธิ์เอง
 *   6. ฐานจริง **SELECT อย่างเดียว** (READ ONLY): admin กับ role อื่นได้ก้อนชุดเดียวกัน ต่างแค่เนื้อ ·
 *      ตัวกรองส่งไม่ถึงของ api_logs นับเท่าการนับตรง ๆ · เวลา
 *
 * ── ผลข้างเคียง ────────────────────────────────────────────────────────────────────────
 * ข้อ 2–4 เขียนเฉพาะตารางชั่วคราว (`CREATE TEMP TABLE … ON COMMIT DROP`) ใน transaction ที่โยน error ทิ้ง
 * ⇒ ROLLBACK ทุกกรณี · ข้อ 0 ยืนยันว่าตารางที่ SQL เห็นเป็นของชั่วคราวก่อนเขียนอะไร ไม่ผ่าน = หยุดชุดนั้น
 * ข้อ 6 อ่านอย่างเดียว · **ไม่เรียก route** (route เขียน audit_logs ของจริง) — ข้อ 5 อ่านซอร์สแทน
 * ⇒ อยู่กลุ่ม "เขียนแล้ว ROLLBACK" ของ AGENTS.md B2 · รันบน PMSV ได้ · **ห้ามเปลี่ยนเป็น COMMIT**
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { pool, withTransaction } from '../../config/db.js';
import { ROLES } from '../../config/capabilities.js';
import {
  UNDELIVERED_EVENT_SQL, type ChatEventRow, type ChatRows,
} from '../../db/logRepositories.js';
import { countApiLogs } from '../../db/repositories.js';
import { webhookFillType } from '../../db/messageKinds.js';
import { NO_REPLY_TEXT } from '../../services/webhookRecorder.js';
import {
  buildChatExchanges, canReadChatContent, deliveryOf, getChatForRequests, isDeliveryProblem, parseRequestIds,
  type ChatDelivery,
} from '../../services/chatLogService.js';
import { postbackLabel } from '../../utils/postbackLabel.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
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

/** ข้อความเฝ้าระวัง — ถ้าโผล่ใน JSON ของคนที่ไม่ใช่ admin = เนื้อแชทรั่ว */
const S = {
  typed: 'DIAGLC-พิมพ์-ขอราคา-7f3a',
  postback: 'action=confirm&id=DIAGLC-pb-1,DIAGLC-pb-2',
  reply1: 'DIAGLC-คำตอบใบ-PM',
  reply2: 'DIAGLC-คำตอบใบ-THT',
  preview: 'DIAGLC-preview-flex-alt',
  webIn: 'DIAGLC-วางในหน้าเว็บ',
  webOut: 'DIAGLC-ผลหน้าเว็บ',
  handlerPb: 'DIAGLC-ยืนยันออกใบ',
};
const SENTINELS = Object.values(S).concat([postbackLabel(S.postback)]);
/** คีย์/คอลัมน์ของเนื้อแชท — ต้องไม่อยู่ใน SQL ที่ยิงให้คนไม่ใช่ admin */
const CONTENT_COLS = /\b(message_text|postback_data|reply_preview|content|reply_content)\b/;

const leaks = (json: string): string[] => SENTINELS.filter(s => json.includes(s));

// ════════════════════════════════════════════════════════════════════════════════════
// 1. postbackLabel
// ════════════════════════════════════════════════════════════════════════════════════
function part1(): void {
  section('1) postbackLabel — ฟังก์ชันเดียวของคำแปลปุ่ม');
  const cases: [string, string][] = [
    ['action=select_company&custId=650577', 'กดเลือกบริษัท'],
    ['action=select_contact&contactId=972833', 'กดเลือกผู้ติดต่อ'],
    ['action=select_product&slot=0&pick=1', 'กดเลือกสินค้า (รายการที่ 1 · ตัวเลือกที่ 2)'],
    ['action=select_product', 'กดเลือกสินค้า'],
    ['action=confirm&id=45ec5c39-fd47-4ed8-9c60-7c17757ceb08', 'กดยืนยันใบเสนอราคา'],
    ['action=confirm&id=a,b', 'กดยืนยันใบเสนอราคา (2 ใบ)'],
    ['action=cancel&id=a,b,c', 'กดยกเลิกใบเสนอราคา (3 ใบ)'],
    ['action=cancel_pending', 'กดยกเลิกการออกใบที่ค้างอยู่'],
    ['action=edit_menu&sub=quotation', 'กดเมนูแก้ไขใบเสนอราคา'],
    ['action=edit_menu&sub=branches', 'กดเมนูแก้ไขสาขา'],
    ['action=edit_btn&target=salesperson&field=phone', 'กดแก้ไขข้อมูลเซลส์ (เบอร์โทร)'],
    ['action=edit_profile', 'กดแก้ไขข้อมูลส่วนตัว'],
    ['action=confirm_profile', 'กดยืนยันข้อมูลลงทะเบียน'],
    ['action=retry_text&mid=msg-1', 'กดลองอีกครั้ง (หลัง AI ขัดข้อง)'],
    ['[กดปุ่ม] action=select_company&custId=1', 'กดเลือกบริษัท'],
    ['action=something_new&x=1', 'กดปุ่ม (action=something_new)'],
    ['', 'กดปุ่ม (action=?)'],
  ];
  const bad = cases.filter(([i, o]) => postbackLabel(i) !== o).map(([i]) => `${i} → ${postbackLabel(i)}`);
  check(`1a. ${cases.length} กรณีได้คำที่ตั้งใจ`, bad.length === 0, bad.join(' | '));

  // ทุก action ที่โค้ดสร้างจริงต้องรู้จัก (ไม่ตกไปที่ "กดปุ่ม (action=…)")
  const src = read('handlers/lineHandler.ts') + read('utils/flexTemplates.ts');
  const actions = [...new Set([...src.matchAll(/action=([a-z_]+)/g)].map(m => m[1]))];
  const unknown = actions.filter(a => postbackLabel(`action=${a}`).startsWith('กดปุ่ม (action='));
  check(`1b. action ที่ lineHandler/flexTemplates สร้าง (${actions.length} ตัว) รู้จักครบ`, actions.length >= 8 && unknown.length === 0,
    unknown.join(', ') || actions.join(' · '));
}

// ════════════════════════════════════════════════════════════════════════════════════
// 2–4 ข้อมูลสังเคราะห์
// ════════════════════════════════════════════════════════════════════════════════════
const RID = { line: 'dddd000000000001', web: 'dddd000000000002', none: 'dddd000000000003', redeliv: 'dddd000000000004' };

function syntheticRows(): ChatRows {
  const now = new Date();
  const ev = (o: Partial<ChatEventRow>): ChatEventRow => ({
    request_id: RID.line, webhook_event_id: 'diaglc-ev', first_seen_at: now, handled_at: now,
    event_type: 'postback', message_type: null, line_user_id: 'Udiag', delivery_count: 1, last_delay_ms: 10,
    redelivery_action: null, outcome: 'replied', reply_status: 'failed', reply_error: '400 Invalid reply token',
    warn_error: null, sender_name: 'คนทดสอบ', sender_code: '999',
    message_text: S.typed, postback_data: S.postback, reply_preview: S.preview, ...o,
  });
  return {
    events: [ev({}), ev({ webhook_event_id: 'diaglc-ev2', event_type: 'message', message_type: 'text', reply_status: 'sent' })],
    lineMessages: [
      { webhook_event_id: 'diaglc-ev', id: '1', created_at: now, type: 'postback', content: S.handlerPb, reply_content: S.reply1 },
      { webhook_event_id: 'diaglc-ev2', id: '2', created_at: now, type: 'text', content: S.typed, reply_content: S.reply2 },
    ],
    webMessages: [{ request_id: RID.web, id: '3', created_at: now, type: 'web_propose',
      admin_username: 'admin01', sender_name: 'คนทดสอบ', sender_code: '999', content: S.webIn, reply_content: S.webOut }],
  };
}

function part2pure(): void {
  section('2) การตัดเนื้อแชทตาม role — ฟังก์ชันบริสุทธิ์');
  const roles = [...ROLES];
  check(`2a. canReadChatContent: เฉพาะ admin (${roles.join(' · ')}) · role ว่าง/ไม่รู้จัก = ไม่เห็น`,
    roles.every(r => canReadChatContent(r) === (r === 'admin'))
      && !canReadChatContent(null) && !canReadChatContent(undefined) && !canReadChatContent('ADMIN') && !canReadChatContent(''));

  // แถวที่ส่งเข้ามา "มีเนื้อติดมา" แต่ withContent = false — ชั้นประกอบต้องไม่พาออกไปเอง
  const meta = buildChatExchanges(syntheticRows(), false);
  const flat = Object.values(meta).flat();
  const json = JSON.stringify(meta);
  check('2b. withContent=false: ไม่มีคีย์ content ในก้อนไหน · ไม่มีข้อความเฝ้าระวังใน JSON',
    flat.length === 3 && flat.every(x => !('content' in x)) && leaks(json).length === 0, leaks(json).join(', '));
  check('2c. withContent=false: ยังเห็นชนิด · ผลการส่ง · error ของ LINE (ทาง ก ข้อ 3)',
    flat.some(x => x.kind === 'postback' && x.delivery.status === 'failed' && x.delivery.error === '400 Invalid reply token')
      && flat.some(x => x.kind === 'web' && x.delivery.status === 'web'));
  const full = JSON.stringify(buildChatExchanges(syntheticRows(), true));
  const missing = SENTINELS.filter(s => s !== S.handlerPb && s !== S.postback && !full.includes(s));
  check('2d. withContent=true: เนื้อครบ (ข้อความ · คำแปลปุ่ม · คำตอบ · preview · หน้าเว็บ) — ชุดควบคุมของ 2b',
    missing.length === 0, missing.join(', '));

  check('2e. parseRequestIds: รูปผิด/เกิน 200 = null · ซ้ำถูกยุบ',
    parseRequestIds('dddd000000000001,dddd000000000001')?.length === 1
      && parseRequestIds("dddd000000000001,x' OR 1=1") === null
      && parseRequestIds(Array.from({ length: 201 }, (_, i) => i.toString(16).padStart(16, '0')).join(',')) === null
      && parseRequestIds('')?.length === 0);
}

// ════════════════════════════════════════════════════════════════════════════════════
// ตารางชั่วคราว
// ════════════════════════════════════════════════════════════════════════════════════
class ForceRollback extends Error { constructor() { super('__ROLLBACK__'); } }

async function assertShadowed(c: pg.PoolClient): Promise<boolean> {
  const { rows } = await c.query<{ t: string; temp: boolean }>(`
    SELECT t, coalesce(to_regclass(t)::oid IN (SELECT oid FROM pg_class WHERE relpersistence = 't'), false) AS temp
      FROM unnest(ARRAY['webhook_events', 'messages']) AS t`);
  const seq = (await c.query(`SELECT pg_get_serial_sequence('messages', 'id') AS s`)).rows[0]?.s as string | null;
  const seqTemp = seq ? (await c.query(`SELECT relpersistence = 't' AS t FROM pg_class WHERE oid = to_regclass($1)`, [seq])).rows[0]?.t === true : true;
  return check('0. webhook_events / messages ที่ SQL เห็นเป็นตารางชั่วคราว · identity ของ messages ใช้ sequence ชั่วคราว',
    rows.every(r => r.temp) && seqTemp,
    rows.map(r => `${r.t}=${r.temp ? 'temp' : 'จริง!'}`).join(' ') + ` · seq=${seq ?? '-'}${seqTemp ? '' : ' (จริง!)'}`);
}

/** executor ที่จด SQL ทุกคำสั่ง — พิสูจน์ว่าคนไม่ใช่ admin ไม่ทำให้ฐานส่งคอลัมน์เนื้อออกมาเลย */
function spyOn(c: pg.PoolClient): { ex: pg.PoolClient; sqls: string[] } {
  const sqls: string[] = [];
  const ex = { query: (sql: string, params?: unknown[]) => { sqls.push(sql); return c.query(sql, params as any[]); } } as unknown as pg.PoolClient;
  return { ex, sqls };
}

const RS = [null, 'sent', 'failed', 'pending', 'none'] as const;
const RA = [null, 'skipped_duplicate', 'warned', 'warn_failed'] as const;

async function seed(c: pg.PoolClient): Promise<void> {
  const ins = (id: string, o: Record<string, unknown>) => {
    const cols = ['webhook_event_id', ...Object.keys(o)];
    const vals = [id, ...Object.values(o)];
    return c.query(`INSERT INTO webhook_events (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
  };
  // ชุดหลัก: ปุ่มยืนยัน PM+THT ที่ส่งไม่ถึง
  await ins('diaglc-confirm', {
    event_type: 'postback', postback_data: S.postback, line_user_id: 'Udiaglc1', reply_token: 'tok-diaglc-1',
    request_id: RID.line, reply_status: 'failed', reply_error: '400 Invalid reply token', reply_preview: null,
    outcome: 'replied', first_seen_at: new Date(Date.now() - 60_000), handled_at: new Date(Date.now() - 58_000),
  });
  await ins('diaglc-text', {
    event_type: 'message', message_type: 'text', message_text: S.typed, line_user_id: 'Udiaglc1', reply_token: 'tok-diaglc-2',
    request_id: RID.line, reply_status: 'sent', reply_preview: S.preview, outcome: 'replied',
  });
  await ins('diaglc-sticker', {
    event_type: 'message', message_type: 'sticker', line_user_id: 'Udiaglc1', reply_token: 'tok-diaglc-3',
    request_id: RID.none, reply_status: 'none', outcome: 'replied',
  });
  await ins('diaglc-redeliv', {
    event_type: 'postback', postback_data: 'action=confirm&id=x', line_user_id: 'Udiaglc1', reply_token: 'tok-diaglc-4',
    request_id: RID.redeliv, delivery_count: 2, last_delay_ms: 74_000, redelivery_action: 'warn_failed', note: '400 DIAG note',
  });
  // ทุกชุดค่าของสองคอลัมน์ (ข้อ 3)
  for (const rs of RS) for (const ra of RA) {
    await ins(`diaglc-m-${rs ?? 'null'}-${ra ?? 'null'}`, {
      event_type: 'message', message_type: 'text', request_id: 'dddd00000000ffff', reply_status: rs, redelivery_action: ra,
    });
  }

  const msg = (o: Record<string, unknown>) => {
    const cols = Object.keys(o);
    return c.query(`INSERT INTO messages (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(o));
  };
  // PM+THT: สองแถวของ handler ต่อ token เดียว
  await msg({ user_id: 'Udiaglc1', message_id: 'd1', type: 'postback', content: S.handlerPb, reply_token: 'tok-diaglc-1', reply_content: S.reply1, created_at: new Date(Date.now() - 59_000) });
  await msg({ user_id: 'Udiaglc1', message_id: 'd2', type: 'postback', content: S.handlerPb, reply_token: 'tok-diaglc-1', reply_content: S.reply2, created_at: new Date(Date.now() - 59_000) });
  // token เดียวกันแต่คนละ user — ต้องไม่ติดมา
  await msg({ user_id: 'Uother', message_id: 'd3', type: 'text', content: 'DIAGLC-ไม่ควรเห็น', reply_token: 'tok-diaglc-1', reply_content: 'x' });
  // แถวเติมของสติกเกอร์ = บอทไม่ได้ตอบ
  await msg({ user_id: 'Udiaglc1', message_id: 'd4', type: webhookFillType('sticker'), content: '[Received sticker message]', reply_token: 'tok-diaglc-3', reply_content: NO_REPLY_TEXT });
  // หน้าเว็บ: มีคีย์ (ติด) · ไม่มีคีย์ (ไม่ติด) · คีย์ของ request อื่น (ไม่ติด)
  await msg({ user_id: 'web:1:Udiaglc1', message_id: 'w1', type: 'web_propose', content: S.webIn, reply_content: S.webOut, meta: JSON.stringify({ api_request_id: RID.web }) });
  await msg({ user_id: 'web:1:Udiaglc1', message_id: 'w2', type: 'web_draft', content: 'DIAGLC-ไม่มีคีย์', reply_content: 'x', meta: JSON.stringify({ outcome: 'ok' }) });
  await msg({ user_id: 'web:1:Udiaglc1', message_id: 'w3', type: 'web_confirm', content: 'DIAGLC-คนละ request', reply_content: 'x', meta: JSON.stringify({ api_request_id: 'dddd0000000000ee' }) });
}

async function partTemp(): Promise<void> {
  section('2–4) ตารางชั่วคราวบังของจริง + ROLLBACK เสมอ');
  try {
    await withTransaction(async (c) => {
      await c.query(`CREATE TEMP TABLE webhook_events (LIKE public.webhook_events INCLUDING ALL) ON COMMIT DROP`);
      await c.query(`CREATE TEMP TABLE messages (LIKE public.messages INCLUDING ALL) ON COMMIT DROP`);
      if (!(await assertShadowed(c))) {
        console.log(`  ${R}หยุดชุดนี้ — ตารางที่ SQL เห็นไม่ใช่ของชั่วคราว ไม่เขียนอะไรเลย${X}`);
        throw new ForceRollback();
      }
      await seed(c);
      const ids = [RID.line, RID.web, RID.none, RID.redeliv];

      // ── 2. ทุก role ──────────────────────────────────────────────
      for (const role of ROLES) {
        const { ex, sqls } = spyOn(c);
        const r = await getChatForRequests(ids, role, ex);
        const json = JSON.stringify(r);
        const flat = Object.values(r.byRequest).flat();
        if (role === 'admin') {
          check(`2f. ${role}: content = true · ก้อนมีเนื้อ (ชุดควบคุม)`,
            r.content && flat.every(x => 'content' in x) && json.includes(S.typed) && json.includes(S.reply1) && json.includes(S.webIn));
        } else {
          const usedContentCols = sqls.filter(s => CONTENT_COLS.test(s));
          check(`2g. ${role}: content = false · ไม่มีคีย์ content · ไม่มีข้อความเฝ้าระวัง · SQL ไม่ขอคอลัมน์เนื้อ (${sqls.length} คำสั่ง)`,
            !r.content && flat.length > 0 && flat.every(x => !('content' in x)) && leaks(json).length === 0
              && !json.includes('DIAGLC-') && usedContentCols.length === 0,
            [...leaks(json), ...usedContentCols.map(s => s.replace(/\s+/g, ' ').slice(0, 60))].join(' | '));
        }
      }
      const { ex: exNull } = spyOn(c);
      const anon = await getChatForRequests(ids, undefined, exNull);
      check('2h. ไม่รู้ role (undefined) = ไม่เห็นเนื้อ', !anon.content && !JSON.stringify(anon).includes('DIAGLC-'));

      // ── 3. SQL = JS ทุกชุดค่า ─────────────────────────────────────
      const all = (await c.query(`SELECT webhook_event_id, reply_status, redelivery_action,
                                         (${UNDELIVERED_EVENT_SQL}) AS sql_problem FROM webhook_events`)).rows;
      const mismatch = all.filter((r: any) => (r.sql_problem === true) !== isDeliveryProblem(deliveryOf(r)));
      check(`3a. "บอทส่งไม่ถึง" ฝั่ง SQL = ฝั่ง JS ทุกชุดค่า (${all.length} แถว · ${RS.length}×${RA.length} ชุด)`,
        all.length >= RS.length * RA.length && mismatch.length === 0,
        mismatch.map((r: any) => `${r.reply_status}/${r.redelivery_action}`).join(', '));

      // ── 4. การผูกกับ request ──────────────────────────────────────
      const { ex } = spyOn(c);
      const a = await getChatForRequests(ids, 'admin', ex);
      const line = a.byRequest[RID.line] ?? [];
      const confirm = line.find(x => x.key === 'diaglc-confirm');
      check('4a. ปุ่มยืนยันชุด PM+THT = ก้อนเดียว 2 คำตอบ (แถวของ handler) · คำแปลปุ่ม · ข้อมูลดิบ',
        confirm?.content?.replies.length === 2 && confirm.content.replies.every(r => r.source === 'handler')
          && confirm.content.in_text === 'กดยืนยันใบเสนอราคา (2 ใบ)' && confirm.content.raw === S.postback,
        JSON.stringify(confirm?.content?.replies.map(r => r.text)));
      check('4b. token เดียวกันแต่คนละ user ไม่ติดมา', !JSON.stringify(a).includes('DIAGLC-ไม่ควรเห็น'));
      check('4c. ส่งไม่ถึง: status failed · problem · error ของ LINE · เวลาจบงาน',
        confirm?.delivery.status === 'failed' && confirm.delivery.problem && confirm.delivery.error === '400 Invalid reply token' && !!confirm.done_at);
      const text = line.find(x => x.key === 'diaglc-text');
      check('4d. ข้อความพิมพ์: in_text จาก message_text · ไม่มีแถวใน messages = replies ว่าง · preview',
        text?.content?.in_text === S.typed && text.content.replies.length === 0 && text.content.preview === S.preview
          && text.delivery.status === 'sent' && !text.delivery.problem);
      const sticker = (a.byRequest[RID.none] ?? [])[0];
      check('4e. สติกเกอร์: แถวเติม [บอทไม่ได้ตอบ] = no_reply · source fill · status none (problem)',
        sticker?.kind === 'sticker' && sticker.content?.replies[0]?.no_reply === true && sticker.content.replies[0].source === 'fill'
          && sticker.delivery.status === 'none' && sticker.delivery.problem);
      const rd = (a.byRequest[RID.redeliv] ?? [])[0];
      check('4f. ส่งซ้ำแล้วแจ้งเซลส์ไม่สำเร็จ: warn_failed · error = note · ข้อมูลส่งซ้ำ (รอบ 2 · 74 วิ)',
        rd?.delivery.status === 'warn_failed' && rd.delivery.error === '400 DIAG note'
          && rd.redelivery?.count === 2 && rd.redelivery.delay_ms === 74_000);
      const web = a.byRequest[RID.web] ?? [];
      check('4g. หน้าเว็บ: ผูกด้วย meta.api_request_id เท่านั้น (ไม่มีคีย์/คีย์ของ request อื่น ไม่ติด)',
        web.length === 1 && web[0].content?.in_text === S.webIn && web[0].delivery.status === 'web'
          && !JSON.stringify(a).includes('DIAGLC-ไม่มีคีย์') && !JSON.stringify(a).includes('DIAGLC-คนละ request'));
      check('4h. request ที่ไม่มีข้อความไม่มีคีย์ · count = จำนวนก้อน',
        !('dddd0000000000ee' in a.byRequest) && a.count === Object.values(a.byRequest).flat().length);

      throw new ForceRollback();   // ห้ามเปลี่ยนเป็น COMMIT
    });
  } catch (e) {
    if (!(e instanceof ForceRollback)) throw e;
  }
  const left = Number((await pool.query(
    `SELECT (SELECT count(*) FROM webhook_events WHERE webhook_event_id LIKE 'diaglc-%')
          + (SELECT count(*) FROM messages WHERE content LIKE 'DIAGLC-%') AS n`)).rows[0].n);
  check('หลัง ROLLBACK ฐานจริงไม่มีแถวทดสอบ', left === 0, `${left}`);
}

// ════════════════════════════════════════════════════════════════════════════════════
// 3 (ต่อ) — deliveryOf ตารางความจริง
// ════════════════════════════════════════════════════════════════════════════════════
function part3pure(): void {
  section('3) ผลการส่ง — ตารางความจริงของ deliveryOf');
  const expect = (rs: string | null, ra: string | null): ChatDelivery => {
    if (ra === 'warn_failed') return 'warn_failed';
    if (rs) return rs as ChatDelivery;
    if (ra === 'warned') return 'warned';
    return 'nodata';
  };
  const bad: string[] = [];
  for (const rs of RS) for (const ra of RA) {
    const got = deliveryOf({ reply_status: rs, redelivery_action: ra });
    if (got !== expect(rs, ra)) bad.push(`${rs}/${ra} → ${got}`);
  }
  check(`3b. ${RS.length * RA.length} ชุดค่าได้ตามลำดับเงื่อนไขในหัวไฟล์ chatLogService`, bad.length === 0, bad.join(', '));
  check('3c. outcome ไม่มีผลกับผลการส่ง (replied ≠ ส่งถึง)',
    deliveryOf({ reply_status: null, redelivery_action: null, outcome: 'replied' } as any) === 'nodata'
      && deliveryOf({ reply_status: 'failed', redelivery_action: null, outcome: 'replied' } as any) === 'failed');
}

// ════════════════════════════════════════════════════════════════════════════════════
// 5. อ่านซอร์ส
// ════════════════════════════════════════════════════════════════════════════════════
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1');

function part5(): void {
  section('5) อ่านซอร์ส');
  const logs = stripComments(read('routes/logs.ts'));
  const index = read('index.ts');

  const calls = (logs.match(/getChatForRequests\(/g) ?? []).length;
  const withRole = (logs.match(/getChatForRequests\([^;()]*, viewerRole\(req\)\)/g) ?? []).length;
  check(`5a. ทุกจุดใน routes/logs.ts ที่เรียก getChatForRequests ส่ง viewerRole(req) (${calls} จุด)`,
    calls >= 2 && withRole === calls, `ส่ง role ${withRole}/${calls}`);
  check('5a. viewerRole อ่าน role จากตัวตนที่ adminAuthMiddleware ใส่ (ไม่ใช่จาก query/body)',
    /function viewerRole\(req: Request\)[^{]*\{\s*return \(req as AdminRequest\)\.admin\?\.role \?\? null;\s*\}/.test(logs));

  // repository ของบทสนทนาถูกเรียกจาก service ตัวเดียว — route/index เรียกตรงไม่ได้ (ข้ามการตัด role)
  const direct = ['routes/logs.ts', 'index.ts'].filter(f => /listChatRowsForRequests/.test(stripComments(read(f))));
  check('5b. listChatRowsForRequests ถูกเรียกผ่าน services/chatLogService.ts เท่านั้น', direct.length === 0, direct.join(', '));

  const exportFn = /logsRouter\.get\('\/export\/:kind'[\s\S]*?\n\}\)\);/.exec(logs)?.[0] ?? '';
  check('5c. /export ไม่มีบทสนทนา (CSV ส่งต่อออกนอกระบบได้)',
    exportFn !== '' && !/getChatForRequests|listChatRows|messages|webhook_events/.test(exportFn));

  const audits = (logs.match(/audit\(req, 'log\.view', 'message'/g) ?? []).length;
  check('5d. เปิดดูเนื้อแชทเขียน audit log.view entity message ทั้งสองเส้น (เฉพาะตอน content)', audits === 2
    && /if \(chat\?\.content && chat\.count > 0\) audit\(req, 'log\.view', 'message'/.test(logs)
    && /if \(chat\.content && chat\.count > 0\) \{\s*audit\(req, 'log\.view', 'message'/.test(logs), `${audits} จุด`);

  check('5e. จุด mount ของ logsRouter ยังเป็น adminAuthMiddleware + page.traffic',
    /app\.use\('\/api\/admin\/logs', adminAuthMiddleware, requireCapability\('page\.traffic'\), logsRouter\);/.test(index));

  // แถว web_* ทุกจุดส่ง api_request_id
  const wq = read('services/webQuoteService.ts');
  const lwe = [...wq.matchAll(/await logWebEvent\(\{([\s\S]*?)type: '(web_\w+)'/g)];
  check(`5f. webQuoteService: logWebEvent ทั้ง ${lwe.length} จุดส่ง apiRequestId · ลง meta.api_request_id`,
    lwe.length === 3 && lwe.every(m => /apiRequestId: params\.apiRequestId/.test(m[1]))
      && /api_request_id: params\.apiRequestId/.test(wq), lwe.map(m => m[2]).join(' · '));
  check('5f. quotationConfirm: web_confirm ลง api_request_id',
    /\.\.\.\(params\.apiRequestId \? \{ api_request_id: params\.apiRequestId \} : \{\}\)/.test(read('services/quotationConfirm.ts')));
  const pa = read('services/priceApprovalService.ts');
  const lae = (pa.match(/params\.apiRequestId\);/g) ?? []).length;
  check('5f. priceApprovalService: logApprovalEvent 4 จุด + confirm ของการอนุมัติส่งต่อ apiRequestId',
    lae === 4 && /skipOwnerCheck: true,\s*apiRequestId: params\.apiRequestId,/.test(pa)
      && /api_request_id: apiRequestId/.test(pa), `${lae} จุด`);
  const routesPass = (index.match(/apiRequestId: getRequestId\(req\)/g) ?? []).length;
  check('5f. index.ts ส่ง getRequestId(req) ครบ 8 เส้น (propose · drafts · revise · confirm · approvals ×4)', routesPass === 8, `${routesPass}`);

  const repo = read('db/repositories.ts');
  check('5g. buildApiLogWhere: undelivered = แถว TASK ของ request ใน UNDELIVERED_REQUEST_IDS_SQL',
    /if \(f\.undelivered\) conds\.push\(`method = 'TASK' AND request_id IN \(\$\{UNDELIVERED_REQUEST_IDS_SQL\}\)`\);/.test(repo)
      && /undelivered: q\.undelivered === '1',/.test(index));

  // หน้าจอไม่ตัดสินสิทธิ์เอง — เห็นเนื้อหรือไม่ดูจากสิ่งที่ server ส่งมาเท่านั้น
  const fe = ['frontend/src/admin/logs/ChatExchange.tsx', 'frontend/src/admin/logs/chatFormat.ts',
    'frontend/src/admin/logs/RequestTimeline.tsx', 'frontend/src/admin/ApiLogs.tsx'];
  const roleCheck = fe.filter(f => /role\s*===|isAdmin|useAuth\(\)\.\w*role/.test(stripComments(read(f))));
  check('5h. หน้าจอไม่อ่าน role มาตัดสินว่าเห็นเนื้อ (ใช้ content ที่ server ส่งมา)', roleCheck.length === 0, roleCheck.join(', '));
}

// ════════════════════════════════════════════════════════════════════════════════════
// 6. ฐานจริง — READ ONLY
// ════════════════════════════════════════════════════════════════════════════════════
async function part6(): Promise<void> {
  section('6) ฐานจริง (READ ONLY)');
  const c = await pool.connect();
  try {
    await c.query('BEGIN READ ONLY');
    await c.query("SET LOCAL statement_timeout = '20s'");
    const ids = (await c.query(
      `SELECT request_id FROM api_logs WHERE path = '/callback' AND request_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 200`)).rows.map((r: any) => r.request_id as string);
    if (ids.length === 0) { skipped('6a–6b', 'ไม่มีแถว /callback ใน api_logs'); await c.query('ROLLBACK'); return; }
    let t = Date.now();
    const a = await getChatForRequests(ids, 'admin', c);
    const msAdmin = Date.now() - t;
    t = Date.now();
    const s = await getChatForRequests(ids, 'subadmin', c);
    const msOther = Date.now() - t;
    const keys = (r: typeof a) => Object.values(r.byRequest).flat().map(x => `${x.key}:${x.delivery.status}`).sort().join('|');
    // ข้อความยาว ≥ 8 ตัวอักษรจากฝั่ง admin ต้องไม่โผล่ฝั่ง subadmin (ชื่อคน/รหัสสั้น ๆ ซ้ำกันได้โดยชอบ)
    const texts = Object.values(a.byRequest).flat().flatMap(x => [
      x.content?.in_text, x.content?.raw, x.content?.preview, ...(x.content?.replies ?? []).map(r => r.text),
    ]).filter((v): v is string => typeof v === 'string' && v.length >= 8);
    const sJson = JSON.stringify(s);
    const leaked = texts.filter(v => sJson.includes(v));
    check(`6a. ${ids.length} request ล่าสุด: admin ${a.count} ก้อน (${msAdmin} ms) · subadmin ${s.count} ก้อน (${msOther} ms) — ชุดเดียวกัน ต่างแค่เนื้อ`,
      a.count > 0 && keys(a) === keys(s) && a.content && !s.content, `เนื้อของ admin ${texts.length} ชิ้น`);
    check('6a. ไม่มีเนื้อของ admin โผล่ในผลของ subadmin', leaked.length === 0, leaked.slice(0, 3).join(' | '));

    const from = (await c.query(`SELECT to_char((now() AT TIME ZONE 'Asia/Bangkok')::date - 6, 'YYYY-MM-DD') AS d`)).rows[0].d;
    const to = (await c.query(`SELECT to_char((now() AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS d`)).rows[0].d;
    const viaFilter = await countApiLogs({ dateFrom: from, dateTo: to, undelivered: true });
    const direct = Number((await c.query(
      `SELECT count(*) AS n FROM api_logs al
        WHERE al.method = 'TASK'
          AND al.created_at >= ($1::date)::timestamp AT TIME ZONE 'Asia/Bangkok'
          AND al.created_at <  ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'
          AND EXISTS (SELECT 1 FROM webhook_events we WHERE we.request_id = al.request_id AND
                      (we.reply_status IN ('failed', 'pending', 'none') OR we.redelivery_action = 'warn_failed'))`,
      [from, to])).rows[0].n);
    const problems = Number((await c.query(`SELECT count(*) AS n FROM webhook_events WHERE ${UNDELIVERED_EVENT_SQL}`)).rows[0].n);
    check(`6b. ตัวกรอง "บอทส่งไม่ถึง" ของ api_logs (${from}..${to}) = นับตรง ๆ`, viaFilter === direct,
      `ตัวกรอง ${viaFilter} · นับตรง ${direct} · event ที่ส่งไม่ถึงทั้งตาราง ${problems}${problems === 0 ? ' (ยังไม่มีผลการส่งในฐาน — ข้อนี้พิสูจน์แค่ว่า SQL ใช้ได้)' : ''}`);

    const all = (await c.query(`SELECT reply_status, redelivery_action, (${UNDELIVERED_EVENT_SQL}) AS p FROM webhook_events`)).rows;
    const mm = all.filter((r: any) => (r.p === true) !== isDeliveryProblem(deliveryOf(r))).length;
    check(`6c. ทุกแถวของ webhook_events จริง (${all.length}) — SQL = JS`, mm === 0, `${mm} แถวไม่ตรง`);
    await c.query('ROLLBACK');
  } finally {
    c.release();
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
console.log(`${B}💬 ด่านตรวจ: บทสนทนาในหน้าบันทึก (เฟส 2)${X}`);
try {
  part1();
  part2pure();
  part3pure();
  part5();
  await partTemp();
  await part6();
} catch (e: any) {
  check('ด่านรันจบโดยไม่มี error ที่ไม่คาดคิด', false, e?.stack?.split('\n').slice(0, 3).join(' · ') ?? String(e));
} finally {
  await pool.end().catch(() => {});
}

console.log(`\n${B}สรุป:${X} ${fail === 0 ? G : R}ผ่าน ${pass}${X} · ${fail > 0 ? R : D}ล้ม ${fail}${X}${skip ? ` · ${Y}ข้าม ${skip}${X}` : ''}`);
if (fail > 0) process.exit(1);
