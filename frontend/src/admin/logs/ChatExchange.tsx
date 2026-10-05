import React, { useState } from 'react';
import {
  Bot, Check, CircleX, Copy, Info, Lock, MessageSquare, Monitor,
  MousePointerClick, Repeat, Send, User, ChevronDown, ChevronUp,
} from 'lucide-react';
import { formatDateTime } from './format';
import {
  DELIVERY_EXPLAIN, deliveryMeta, inSummary, kindMeta, oneLine, worstDelivery,
  type ChatExchange, type ChatReply, type IconT,
} from './chatFormat';

/**
 * "ก้อนบทสนทนา" — 1 ก้อน = 1 event ของ LINE หรือ 1 แถว `web_*` ของหน้าเว็บ
 * (mockup `log-chat-messages` ทาง ก ที่เจ้าของเลือก 2026-10-05 · docs/plan-message-log-merge.md เฟส 2)
 *
 * ใช้ร่วมสองที่: กล่อง "ทุกอย่างของ request นี้" (RequestTimeline) กับแถวที่กางในตาราง API logs
 * ส่วนชิปในตารางคือ `ChatChip` ข้างล่าง · แท็บ "บทสนทนา" ในอนาคตต้องใช้ก้อนนี้ ห้ามเขียนใหม่
 *
 * ⚠️ เนื้อแชทมาจาก server เฉพาะ admin (`content` ของแต่ละก้อน) — ไม่ใช่ admin จะไม่มีคีย์นั้นมาเลย
 *   หน้านี้แค่แสดงแม่กุญแจแทน · **ห้ามย้ายการตัดสิทธิ์มาไว้ที่จอ** (services/chatLogService.ts)
 * ⚠️ "ผลการส่ง" อ่านจาก `delivery` ที่ server คำนวณจาก reply_status เท่านั้น — แถวของ handler
 *   บันทึก **ก่อนส่ง** จึงติดป้าย "บันทึกก่อนส่ง" ทุกครั้ง และขีดเส้นประแดงเมื่อส่งไม่ถึง
 */

const LOCK_HINT = 'เนื้อข้อความดูได้เฉพาะผู้ดูแลระบบ (admin)';

const REPLY_SOURCE: Record<ChatReply['source'], { label: string; hint: string }> = {
  handler: {
    label: 'คำตอบที่บอทเตรียมไว้ · บันทึกก่อนส่ง',
    hint: 'แถวนี้ถูกบันทึกก่อนเรียก LINE จึงไม่ใช่หลักฐานว่าส่งถึง — ดูบรรทัด "ผลการส่ง"',
  },
  fill: {
    label: 'สิ่งที่ส่งถึงจริง · ถ้าเป็นการ์ดจะเห็นแค่ข้อความแทนการ์ด',
    hint: 'บันทึกหลังส่งสำเร็จ · การ์ด (Flex) เก็บได้แค่ข้อความแทนการ์ด ไม่ใช่สรุปเต็ม',
  },
  web: { label: 'ผลที่หน้าเว็บแสดงให้แอดมิน', hint: 'หน้าเว็บไม่ผ่าน LINE' },
};

const chanCls = 'inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-px rounded-md border';

/* ── ชิ้นย่อย ────────────────────────────────────────────────────────────── */

const Locked: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-center gap-1.5 text-[12.5px] text-slate-500">
    <Lock className="w-3 h-3 shrink-0" /> {text}
  </div>
);

/** ป้าย "เห็นเฉพาะ admin" ข้างหัวข้อของส่วนบทสนทนา */
export const AdminOnlyBadge: React.FC = () => (
  <span className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-px rounded-full border border-slate-200 text-slate-500">
    <Lock className="w-2.5 h-2.5" /> เห็นเฉพาะ admin
  </span>
);

const LONG_LINES = 6;

const ReplyBox: React.FC<{ reply: ChatReply; index: number; total: number; failed: boolean }> = ({
  reply, index, total, failed,
}) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (reply.no_reply) {
    return <div className="text-[13px] italic text-slate-500">ไม่มีคำตอบ — งานจบโดยบอทไม่ได้ส่งอะไรกลับ</div>;
  }
  const long = reply.text.split('\n').length > LONG_LINES || reply.text.length > 480;
  const src = REPLY_SOURCE[reply.source];
  const copy = () => {
    void navigator.clipboard?.writeText(reply.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className={`border-l-2 pl-2.5 ${failed ? 'border-dashed border-red-600' : 'border-slate-300'} ${index ? 'mt-2.5' : ''}`}>
      {total > 1 && <div className="text-[11px] font-semibold text-slate-600 mb-0.5">คำตอบที่ {index + 1} จาก {total}</div>}
      <div className={`text-[13px] whitespace-pre-wrap break-words leading-relaxed ${failed ? 'text-slate-600' : 'text-slate-800'} ${long && !open ? 'line-clamp-6' : ''}`}>
        {reply.text}
      </div>
      {long && (
        <button onClick={() => setOpen(v => !v)}
                className="mt-1 inline-flex items-center gap-1 text-xs hover:underline" style={{ color: 'var(--brand-fg)' }}>
          {open ? 'ย่อ' : `แสดงทั้งหมด (${reply.text.length.toLocaleString('th-TH')} ตัวอักษร)`}
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1" title={src.hint}><Info className="w-2.5 h-2.5" />{src.label}</span>
        {failed && <span className="inline-flex items-center gap-1 font-semibold text-red-700"><CircleX className="w-2.5 h-2.5" />ไม่ถึงเซลส์</span>}
        <button onClick={copy} aria-label="คัดลอกคำตอบนี้" title="คัดลอก"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100">
          {copied ? <Check className="w-3 h-3 text-emerald-700" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
    </div>
  );
};

/** แถวหนึ่งของก้อน: ป้ายซ้าย (เซลส์ / บอท / ผลการส่ง) + เนื้อขวา · มือถือเรียงบนลงล่าง */
const Row: React.FC<{ icon: IconT; label: string; sub?: string; first: boolean; children: React.ReactNode }> = ({
  icon: Icon, label, sub, first, children,
}) => (
  <div className={`grid grid-cols-1 sm:grid-cols-[92px_minmax(0,1fr)] gap-1 sm:gap-2.5 px-3 py-2.5 ${first ? '' : 'border-t border-slate-100'}`}>
    <div className="flex items-start gap-1.5 text-xs text-slate-500">
      <Icon className="w-3 h-3 mt-[3px] shrink-0" />
      <div>{label}{sub && <small className="block text-[10.5px] text-slate-400 leading-snug mt-px">{sub}</small>}</div>
    </div>
    <div className="min-w-0">{children}</div>
  </div>
);

function shortLineId(id: string | null): string | null {
  if (!id) return null;
  return id.length > 14 ? `${id.slice(0, 5)}…${id.slice(-4)}` : id;
}

export type ChatPart = 'head' | 'in' | 'out' | 'del';
const ALL_PARTS: ChatPart[] = ['head', 'in', 'out', 'del'];

/* ── ก้อนบทสนทนา ─────────────────────────────────────────────────────────── */

export const ChatExchangeCard: React.FC<{ ex: ChatExchange; parts?: ChatPart[] }> = ({ ex, parts = ALL_PARTS }) => {
  const k = kindMeta(ex);
  const d = deliveryMeta(ex.delivery.status);
  const c = ex.content;
  const failed = ex.delivery.status === 'failed';
  const KindIcon = k.icon;
  const DIcon = d.icon;
  const web = ex.channel === 'web';
  const explain = DELIVERY_EXPLAIN[ex.delivery.status];
  const rd = ex.redelivery;
  // แถวแรกไม่มีเส้นบน — หัวก้อน/แถบส่งซ้ำมีเส้นล่างของตัวเองอยู่แล้ว
  const firstRow = (['in', 'out', 'del'] as const).find(p => parts.includes(p));

  return (
    <div className="bg-card border border-slate-200 rounded-xl overflow-hidden max-w-[880px]">
      {parts.includes('head') && (
        <>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3 py-2 border-b border-slate-200 text-xs text-slate-500">
            <span className={`${chanCls} ${web ? 'bg-sky-50 border-sky-200 text-sky-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
              {web ? <Monitor className="w-2.5 h-2.5" /> : <MessageSquare className="w-2.5 h-2.5" />}
              {web ? 'หน้าเว็บ' : 'LINE'}
            </span>
            <span className={`${chanCls} bg-slate-50 border-slate-200 text-slate-600`}>
              <KindIcon className="w-2.5 h-2.5" />{k.label}
            </span>
            <span className="min-w-0">
              {web && ex.sender.admin && (
                <><span className="text-slate-800 font-medium">{ex.sender.admin}</span>{' '}<span className="text-slate-400">ในนาม</span>{' '}</>
              )}
              <span className="text-slate-800 font-medium">{ex.sender.name ?? (web ? 'ยังไม่เลือกเซลส์' : 'ไม่รู้จักผู้ใช้')}</span>
              {ex.sender.code && <span className="text-slate-400"> ({ex.sender.code})</span>}
              {!web && ex.sender.line_user_id && (
                <span className="font-mono text-[11px] text-slate-400 ml-1.5" title={ex.sender.line_user_id}>{shortLineId(ex.sender.line_user_id)}</span>
              )}
            </span>
            <span className="ml-auto tabular-nums" title="เวลาที่รับ (เวลาไทย)">{formatDateTime(ex.at)}</span>
          </div>
          {rd && (
            <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-[12.5px] leading-relaxed">
              <Repeat className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
              <div>
                <b>LINE ส่งซ้ำ</b> (รอบที่ {rd.count}
                {rd.delay_ms !== null && <> · มาถึงช้ากว่าตอนส่ง {Math.round(rd.delay_ms / 1000)} วิ</>})
                {rd.action === 'warned' || rd.action === 'warn_failed'
                  ? <> — ระบบ <b>ไม่ได้ทำตามคำสั่งนี้ซ้ำ</b> แค่แจ้งเซลส์ให้ส่งใหม่</>
                  : rd.action === 'skipped_duplicate'
                    ? <> — รอบแรกตอบไปแล้ว ระบบทิ้งตัวซ้ำ</>
                    : null}
              </div>
            </div>
          )}
        </>
      )}

      {parts.includes('in') && (
        <Row icon={User} label="เซลส์" sub={web ? 'วางในหน้าเว็บ' : undefined} first={firstRow === 'in'}>
          {!c ? <Locked text={LOCK_HINT} />
            : ex.kind === 'postback' ? (
              <>
                <div className="text-[13px] text-slate-800 whitespace-pre-wrap break-words">{inSummary(ex)}</div>
                {c.raw && (
                  <details className="mt-1 text-[11px]">
                    <summary className="text-slate-400 cursor-pointer">ข้อมูลดิบของปุ่ม</summary>
                    <code className="text-[11px] bg-slate-50 border border-slate-200 rounded-md px-1.5 py-px text-slate-600 break-all">{c.raw}</code>
                  </details>
                )}
              </>
            )
            : c.in_text
              ? <div className="text-[13px] text-slate-800 whitespace-pre-wrap break-words leading-relaxed">{c.in_text}</div>
              : (
                <div className="text-[13px] italic text-slate-500">
                  {ex.kind === 'sticker' ? 'ส่งสติกเกอร์ — ระบบไม่ได้เก็บภาพ'
                    : ex.kind === 'image' ? 'ส่งรูปภาพ — ระบบไม่ได้เก็บภาพไว้ในประวัติแชท'
                      : ex.kind === 'event' || ex.kind === 'other' ? k.label
                        : 'ระบบไม่ได้บันทึกข้อความนี้'}
                </div>
              )}
        </Row>
      )}

      {parts.includes('out') && (
        <Row icon={Bot} label="บอท" sub={c && c.replies.length > 1 ? `${c.replies.length} แถว จากครั้งเดียว` : undefined}
             first={firstRow === 'out'}>
          {!c ? <Locked text="ซ่อน" />
            : c.replies.length === 0
              ? <div className="text-[13px] italic text-slate-500">ไม่มีบันทึกคำตอบในประวัติแชท</div>
              : c.replies.map((r, i) => (
                <ReplyBox key={`${r.at}-${i}`} reply={r} index={i} total={c.replies.length} failed={failed} />
              ))}
        </Row>
      )}

      {parts.includes('del') && (
        <Row icon={Send} label="ผลการส่ง" first={firstRow === 'del'}>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-slate-500">
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-md border ${d.pill}`}>
              <DIcon className="w-3 h-3" />{d.label}
            </span>
            {ex.done_at && <span className="tabular-nums text-slate-400" title="เวลาที่งานจบ (เวลาไทย)">{formatDateTime(ex.done_at)}</span>}
            {c?.preview && (ex.delivery.status === 'sent' || ex.delivery.status === 'warned') && (
              <div className="basis-full text-xs text-slate-600">
                สิ่งที่ LINE รับไป:{' '}
                <code className="text-[11.5px] text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-1.5 py-px break-words">{c.preview}</code>
              </div>
            )}
            {explain && (
              <div className={`basis-full text-xs leading-relaxed ${failed || ex.delivery.status === 'warn_failed' ? 'text-red-800' : 'text-slate-600'}`}>
                {explain}
              </div>
            )}
            {ex.delivery.error && (
              <div className="basis-full font-mono text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1 break-all">
                {ex.delivery.error}
              </div>
            )}
          </div>
        </Row>
      )}
    </div>
  );
};

/* ── ชิปในตาราง API logs ─────────────────────────────────────────────────── */

/**
 * ชิปบรรทัดเดียวใต้ path (ทาง ก ข้อ 2): `/callback` = ขาเข้า · `TASK` = คำตอบ + ผลการส่ง ·
 * แถวหน้าเว็บ = ก้อนของ request นั้น · ไม่ใช่ admin = แม่กุญแจ + ชนิด + ผลการส่ง
 */
export const ChatChip: React.FC<{ list: ChatExchange[]; side: 'in' | 'out' | 'web' }> = ({ list, side }) => {
  if (list.length === 0) return null;
  const ex = list[0];
  const more = list.length > 1 ? list.length - 1 : 0;
  const locked = !ex.content;
  const showStatus = side !== 'in';
  const status = worstDelivery(list);
  const d = deliveryMeta(status);
  const tone = !showStatus ? 'border-slate-200 bg-slate-50'
    : status === 'failed' || status === 'warn_failed' ? 'border-red-200 bg-red-50'
      : status === 'pending' || status === 'warned' ? 'border-amber-200 bg-amber-50'
        : 'border-slate-200 bg-slate-50';

  let Icon: IconT;
  let text: string;
  let title: string;
  if (locked) {
    Icon = Lock;
    text = `มีข้อความ · ${kindMeta(ex).label}`;
    title = `${text} — ${LOCK_HINT}`;
  } else if (side === 'out') {
    Icon = Send;
    const replies = ex.content?.replies ?? [];
    const first = replies.length === 0 ? 'ไม่มีบันทึกคำตอบ'
      : replies[0].no_reply ? 'ไม่มีคำตอบ' : oneLine(replies[0].text, 48);
    text = replies.length > 1 ? `${replies.length} คำตอบ · ${first}` : first;
    title = replies.map(r => r.text).join('\n\n') || text;
  } else {
    Icon = ex.channel === 'web' ? Monitor : ex.kind === 'postback' ? MousePointerClick : MessageSquare;
    text = oneLine(inSummary(ex));
    title = inSummary(ex);
  }
  const DIcon = d.icon;
  const redelivered = side === 'in' && list.some(x => x.redelivery);

  return (
    // w-0 + min-w-full = ชิปไม่ดันความกว้างคอลัมน์ (ตารางกว้างเท่าเดิม) แค่กินที่ที่ path เปิดไว้แล้วตัดด้วย …
    <div className="w-0 min-w-full">
    <div className={`flex items-center gap-1.5 mt-1.5 sm:ml-[3.125rem] w-fit max-w-full sm:max-w-[min(520px,calc(100%_-_3.125rem))] min-w-0
                     px-2 py-0.5 rounded-[7px] border text-xs text-slate-600 ${tone}`}
         title={title}>
      <Icon className={`w-3 h-3 shrink-0 ${ex.channel === 'web' ? 'text-sky-700' : 'text-slate-400'}`} />
      <span className={`min-w-0 flex-1 truncate ${locked ? 'text-slate-400' : ''}`}>{text}</span>
      {more > 0 && <span className="shrink-0 text-slate-400 tabular-nums">+{more}</span>}
      {showStatus && (
        <span className={`shrink-0 inline-flex items-center gap-1 font-semibold pl-1.5 border-l border-slate-200 whitespace-nowrap ${d.ink}`}>
          <DIcon className="w-3 h-3" />{d.label}
        </span>
      )}
      {redelivered && (
        <span className="shrink-0 inline-flex items-center gap-1 font-semibold pl-1.5 border-l border-slate-200 whitespace-nowrap text-amber-700">
          <Repeat className="w-3 h-3" />ส่งซ้ำ
        </span>
      )}
    </div>
    </div>
  );
};
