import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import { X, Loader2, AlertCircle, Globe, History, Terminal, MessageSquare, Send, Clock, Info, Lock } from 'lucide-react';
import { errMsg, formatDateTime, formatMs, levelStyle, actionLabel } from './format';
import { AdminOnlyBadge, ChatExchangeCard } from './ChatExchange';
import { deliveryMeta, inSummary, kindMeta, oneLine, type ChatExchange } from './chatFormat';

/**
 * "ดูทุกอย่างของ request นี้" — ไทม์ไลน์รวมของ api_logs + audit_logs + system_logs + ข้อความแชท
 *
 * นี่คือผลตอบแทนหลักของทั้งแผน log · ก่อนหน้านี้ถ้าผู้ใช้บอกว่า "ตอนบ่ายสองกดแล้วมันพัง"
 * ต้องไล่ 3 ที่ด้วยมือแล้วเทียบเวลาเอาเอง ซึ่งพลาดง่ายและเสียเวลาทั้งวัน
 * ตอนนี้ทุกตารางมี request_id เดียวกัน ⇒ กดปุ่มเดียวเห็นครบทั้งเส้น
 *
 * ข้อความแชท (เฟส 2 · ทาง ก ข้อ 1): **ก้อนบทสนทนาปักบนสุด** ตอบ "เกิดอะไรขึ้น" ในจอแรก ·
 * เส้นเวลามีแค่ **หมุดสั้น** "รับข้อความ" / "ส่งคำตอบ" ณ เวลาจริง ไม่พิมพ์เนื้อซ้ำ (คำตอบยาวได้ ~3,000
 * ตัวอักษร ถ้าวางกลางเส้นจะดันบันทึกระบบออกไปไกล) · ไม่ใช่ admin = server ไม่ส่งเนื้อมา จอแสดงแม่กุญแจ
 */

interface TimelineRow {
  kind: 'api' | 'audit' | 'system';
  id: string;
  at: string;
  title: string;
  detail: string | null;
  duration_ms: number | null;
}

interface TimelineResponse {
  data: TimelineRow[];
  messages?: ChatExchange[];
  content?: boolean;
  chat_error?: string | null;
}

const KIND_META: Record<TimelineRow['kind'], { label: string; icon: typeof Globe; cls: string }> = {
  api:    { label: 'การเรียก API', icon: Globe,    cls: 'bg-sky-50 border-sky-200 text-sky-700' },
  audit:  { label: 'การแก้ไข',     icon: History,  cls: 'bg-violet-50 border-violet-200 text-violet-700' },
  system: { label: 'บันทึกระบบ',   icon: Terminal, cls: 'bg-slate-50 border-slate-200 text-slate-600' },
};

const MSG_KIND_CLS = 'bg-emerald-50 border-emerald-200 text-emerald-700';

/** หมุดหนึ่งจุดบนเส้นเวลา — แถวเดิมของสามตาราง หรือหมุดข้อความ */
type Item =
  | { type: 'row'; at: string; row: TimelineRow }
  | { type: 'msg'; at: string; key: string; icon: typeof Globe; title: React.ReactNode };

const lockIcon = <Lock className="inline w-3 h-3 text-slate-400 align-[-2px]" aria-label="ซ่อนเนื้อ" />;

/** หมุดของหนึ่งก้อน: LINE = รับ + ส่งคำตอบ · หน้าเว็บ = จุดเดียว (ไม่มีช่วงรอส่ง) */
function messagePins(ex: ChatExchange): Item[] {
  const shown = !!ex.content;
  if (ex.channel === 'web') {
    return [{
      type: 'msg', at: ex.at, key: `${ex.key}-web`, icon: MessageSquare,
      title: shown
        ? <>ข้อความจากหน้าเว็บ · <span className="text-slate-600">{oneLine(inSummary(ex))}</span></>
        : <>{kindMeta(ex).label} {lockIcon}</>,
    }];
  }
  const what = ex.kind === 'postback' ? 'การกดปุ่ม' : ex.kind === 'sticker' ? 'สติกเกอร์'
    : ex.kind === 'event' ? 'เหตุการณ์' : 'ข้อความ';
  const d = deliveryMeta(ex.delivery.status);
  const DIcon = d.icon;
  return [
    {
      type: 'msg', at: ex.at, key: `${ex.key}-in`, icon: MessageSquare,
      title: shown
        ? <>รับ{what}จากเซลส์ · <span className="text-slate-600">{oneLine(inSummary(ex))}</span></>
        : <>รับ{what}จากเซลส์ {lockIcon}</>,
    },
    {
      type: 'msg', at: ex.done_at ?? ex.at, key: `${ex.key}-out`, icon: Send,
      title: <>ส่งคำตอบ · <span className={`inline-flex items-center gap-1 font-semibold ${d.ink}`}><DIcon className="w-3 h-3" />{d.label}</span></>,
    },
  ];
}

export const RequestTimeline: React.FC<{ requestId: string; onClose: () => void }> = ({
  requestId, onClose,
}) => {
  const { token } = useAuth();
  const [res, setRes] = useState<TimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      void fetch(`/api/admin/logs/request/${requestId}`,
        { headers: { Authorization: `Bearer ${token}` } })
        .then(async r => {
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
          return r.json() as Promise<TimelineResponse>;
        })
        .then(j => { if (!cancelled) setRes(j); })
        .catch((e: unknown) => { if (!cancelled) setError(errMsg(e)); });
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [requestId, token]);

  // Esc ปิด — เป็นกติกาเดียวกันทั้ง 3 หน้าใหม่
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = res?.data ?? null;
  const messages = res?.messages ?? [];
  const hasChat = messages.length > 0;
  const items: Item[] = rows
    ? [
        ...rows.map(r => ({ type: 'row' as const, at: r.at, row: r })),
        ...messages.flatMap(messagePins),
      ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    : [];
  // ของสามตารางหมดอายุไปแล้ว (เก็บ 30 วัน) แต่ข้อความแชทเก็บถาวร — ก้อนข้างบนบอกครบ ไม่ต้องมีเส้นเวลาจุดเดียว
  const logsGone = !!rows && rows.length === 0 && hasChat;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`ไทม์ไลน์ของ request ${requestId}`}
    >
      <div
        className="bg-card border border-slate-200 rounded-2xl shadow-xl w-full max-w-3xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3.5 sm:px-5 py-3 sm:py-3.5 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-800">ทุกอย่างของ request นี้</h3>
            <div className="text-xs text-slate-400 font-mono truncate">{requestId}</div>
          </div>
          <button onClick={onClose} aria-label="ปิด"
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3.5 sm:p-5">
          {!res && !error && (
            <div className="py-10 flex items-center justify-center gap-2 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลด
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {logsGone && (
            <div className="flex items-start gap-2 text-xs text-slate-500 border border-dashed border-slate-300 rounded-[10px] px-3 py-2 mb-3.5 leading-relaxed">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <div>บันทึกการเรียก API · การแก้ไข · บันทึกระบบ ของ request นี้หมดอายุไปแล้ว (เก็บตามที่ตั้งไว้ ค่าเริ่ม 30 วัน)
                — ข้อความแชทเก็บถาวร จึงยังเหลือให้ดู</div>
            </div>
          )}

          {res?.chat_error && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {res.chat_error} — ส่วนอื่นของไทม์ไลน์ยังครบ
            </div>
          )}

          {hasChat && (
            <div className="mb-5 space-y-2">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <MessageSquare className="w-3 h-3" />
                <b className="text-slate-600 font-semibold text-[12.5px]">บทสนทนา</b>
                {res?.content && <AdminOnlyBadge />}
              </div>
              {messages.map(ex => <ChatExchangeCard key={ex.key} ex={ex} />)}
            </div>
          )}

          {rows && rows.length === 0 && !hasChat && (
            <div className="py-10 text-center text-sm text-slate-400">
              ไม่พบข้อมูลของ request นี้
              <div className="mt-1 text-xs">อาจถูกลบไปแล้วตามอายุการเก็บของแต่ละตาราง</div>
            </div>
          )}

          {rows && rows.length > 0 && (
            <>
              {hasChat && (
                <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
                  <Clock className="w-3 h-3" />
                  <b className="text-slate-600 font-semibold text-[12.5px]">ลำดับเวลา</b>
                </div>
              )}
              <ol className="relative border-l border-slate-200 ml-2 space-y-4">
                {items.map(it => {
                  if (it.type === 'msg') {
                    const Icon = it.icon;
                    return (
                      <li key={it.key} className="ml-5 min-w-0">
                        <span className="absolute -left-[9px] flex items-center justify-center w-[18px] h-[18px]
                                         rounded-full bg-card border border-emerald-200">
                          <Icon className="w-2.5 h-2.5 text-emerald-700" />
                        </span>
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${MSG_KIND_CLS}`}>ข้อความ</span>
                          <span className="text-sm text-slate-800 min-w-0 [overflow-wrap:anywhere]">{it.title}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400 tabular-nums">{formatDateTime(it.at)}</div>
                      </li>
                    );
                  }
                  const r = it.row;
                  const m = KIND_META[r.kind];
                  const Icon = m.icon;
                  // แถว system ใช้สีตามระดับความรุนแรง ส่วนแถวอื่นใช้สีประจำชนิด
                  const lvl = r.kind === 'system' ? levelStyle(r.title.split(' ')[0]) : null;
                  return (
                    <li key={`${r.kind}-${r.id}`} className="ml-5">
                      <span className="absolute -left-[9px] flex items-center justify-center w-[18px] h-[18px]
                                       rounded-full bg-card border border-slate-200">
                        <Icon className="w-2.5 h-2.5 text-slate-400" />
                      </span>
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${lvl?.cls ?? m.cls}`}>
                          {lvl?.label ?? m.label}
                        </span>
                        <span className="text-sm text-slate-800 break-all">
                          {r.kind === 'audit' ? actionLabel(r.title) : r.title}
                        </span>
                        {r.duration_ms !== null && (
                          <span className="text-xs text-slate-400 tabular-nums">{formatMs(r.duration_ms)}</span>
                        )}
                      </div>
                      {r.detail && (
                        <div className="mt-0.5 text-xs text-slate-500 break-all whitespace-pre-wrap">{r.detail}</div>
                      )}
                      <div className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                        {formatDateTime(r.at)}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
