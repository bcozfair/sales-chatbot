// ─────────────────────────────────────────────────────────────────────────────
//  ส่วน "แก้ไขใบที่ออกไปแล้ว (revise)" ของหน้าขอใบเสนอราคา — เลือกใบจากรายการแทนการจำเลขที่
//  (เจ้าของเคาะแบบ A จาก mockup 2026-10-01 · mockups/quote-revise-picker.html)
//
//  ทำไมเป็นช่องค้นหาเดียว ไม่ใช่กล่องตาราง/การ์ดใบล่าสุด: ใบที่เคยถูกแก้มีแค่ 81 จาก 2,717 ใบ (3%
//  · วัด 2026-10-01) ⇒ ส่วนนี้ต้องไม่กินพื้นที่หน้าเพิ่ม แต่คลิกช่องแล้วต้องเห็น "ใบล่าสุดของฉัน"
//  ทันทีโดยไม่ต้องพิมพ์ (เซลส์หนึ่งคนออก ~26 ใบ/เดือน ใบที่จะแก้ส่วนใหญ่อยู่ในหน้าแรกของรายการ)
//
//  กติกาที่ห้ามหลุด:
//    · รายการคือ **ฉบับล่าสุดที่ยังไม่ยกเลิกของแต่ละเลข** — server เลือกให้ด้วยกติกาเดียวกับ
//      loadActiveQuotation() ที่ revise ใช้จริง (searchRevisableQuotations ใน db/repositories.ts)
//    · ขอบเขต "ใบของฉัน / ทั้งหมด" ถามตัวเดียวกับหน้าประวัติ เริ่มที่ "ใบของฉัน" (เจ้าของเคาะ)
//      · ถูกปิด quote.view_all = ไม่มีปุ่มสลับ
//    · **ยังพิมพ์เลขที่ตรง ๆ ได้เหมือนเดิม** (แถวท้ายรายการ "ใช้เลขที่ตามที่พิมพ์") — เดิมใครพิมพ์เลขที่
//      ของใบไหนก็แก้ได้ ถ้ารายการเป็นทางเดียว คนที่เห็นแค่ใบตัวเองจะเสียทางที่เคยมี
//    · ใบที่ส่งออก Odoo แล้ว = ป้ายเหลือง "เข้า Odoo แล้ว" อย่างเดียว ไม่เตือน — ใบแก้ไขออกเป็นเลขใหม่อยู่แล้ว (เจ้าของ)
//    · ในหน้ามีรายการค้างอยู่ = เตือนก่อนกดว่าจะถูกแทนที่ (เดิมแทนที่เงียบ ๆ)
//    · การ์ดสรุปไม่มีเงินรายบรรทัด — สูตรเงินมีที่เดียว (utils/pricing) ยอดรวมอ่านจากใบตรง ๆ
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, RotateCcw, User, Users } from 'lucide-react';
import { Button } from './Button';
import { ComboBox, type ComboOption } from './PersonComboBox';

const BRAND = 'var(--brand-fg)';
/** รูปแบบเลขที่ใบ (ฐาน หรือ ฐาน-revision) — ตรงกับที่ loadActiveQuotation() แยกฐานออก */
const QUOTE_NO_RE = /^(QP|QT)-\d+(-\d+)?$/i;

/** แถวจาก GET /api/admin/webquote/revisable (RevisableQuotation ใน db/repositories.ts) */
interface RevisableQuote {
  id: string;
  quotation_no: string;
  revision: number;
  created_at: string;
  total_sum: number;
  customer_name: string;
  contact_name: string;
  salesperson_name: string;
  channel: 'web' | 'line';
  odoo_exported_at: string | null;
  odoo_imported_at: string | null;
  lines: { label: string; quantity: number }[];
}

/** ตัวเลือกในช่อง — `row = null` คือเลขที่ที่คนพิมพ์เองและไม่อยู่ในรายการที่เขาเห็น */
interface PickOption extends ComboOption {
  row: RevisableQuote | null;
}

const toOption = (row: RevisableQuote): PickOption => ({ id: row.id, name: row.quotation_no, row });

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thaiDate = (iso: string) =>
  new Date(iso).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' });

const Badges: React.FC<{ row: RevisableQuote }> = ({ row }) => (
  <>
    {row.revision > 0 && (
      <span className="shrink-0 text-[10px] font-semibold px-1.5 rounded-md border bg-sky-50 border-sky-200 text-sky-700">
        R{String(row.revision).padStart(2, '0')}
      </span>
    )}
    {row.odoo_exported_at && (
      <span
        className="shrink-0 text-[10px] font-semibold px-1.5 rounded-md border bg-amber-50 border-amber-200 text-amber-700"
        title={row.odoo_imported_at ? 'พบใบนี้ใน Odoo แล้ว' : 'ส่งออกไฟล์ Odoo แล้ว ยังไม่พบใน Odoo'}
      >
        เข้า Odoo แล้ว
      </span>
    )}
  </>
);

interface Props {
  authHeaders: Record<string, string>;
  /** จำนวนบรรทัดที่อยู่ในใบตอนนี้ — มีแล้วต้องเตือนว่าจะถูกแทนที่ */
  lineCount: number;
  busy: boolean;
  /** เงื่อนไขของหน้า (ยังไม่มีเซลส์ ฯลฯ) ที่ทำให้กดเตรียมใบแก้ไขไม่ได้ */
  submitDisabled: boolean;
  error: string;
  /** คืน true เมื่อเตรียมใบสำเร็จ ⇒ ช่องล้างตัวเอง (แถบ "revision ของ …" ด้านบนรับช่วงต่อ) */
  onRevise: (quotationNo: string) => Promise<boolean>;
  /** ทั้งส่วนกดไม่ได้ระหว่างโปรไฟล์ยังไม่พร้อม — กติกาเดียวกับส่วนอื่นของหน้า */
  blocked: boolean;
}

export const RevisePicker: React.FC<Props> = ({ authHeaders, lineCount, busy, submitDisabled, error, onRevise, blocked }) => {
  const [mine, setMine] = useState(true);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<RevisableQuote[]>([]);
  const [total, setTotal] = useState(0);
  const [mineTotal, setMineTotal] = useState<number | null>(null);
  const [viewAll, setViewAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [pick, setPick] = useState<PickOption | null>(null);
  /** ทุกครั้งที่ออกใบแก้ไขสำเร็จ ให้รายการโหลดใหม่ (ใบเดิมถูกแทนด้วยฉบับใหม่แล้ว) */
  const [nonce, setNonce] = useState(0);

  // setTimeout แทน setState ตรงใน effect (react-hooks/set-state-in-effect) และได้ debounce ของช่องค้นไปด้วย
  useEffect(() => {
    const t = setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const qs = new URLSearchParams({ q: query.trim(), mine: mine ? '1' : '0', limit: '20' });
          const res = await fetch(`/api/admin/webquote/revisable?${qs}`, { headers: authHeaders });
          if (!res.ok) {
            setRows([]);
            setLoadError(res.status === 403 ? 'บัญชีนี้ไม่มีสิทธิ์แก้ใบเดิม' : 'โหลดรายการใบไม่สำเร็จ');
            return;
          }
          const data = await res.json();
          setRows(data.data ?? []);
          setTotal(Number(data.total) || 0);
          setMineTotal(data.mine_total ?? null);
          setViewAll(data.view_all === true);
          setLoadError('');
        } catch {
          setRows([]);
          setLoadError('โหลดรายการใบไม่สำเร็จ');
        } finally {
          setLoading(false);
        }
      })();
    }, 300);
    return () => clearTimeout(t);
  }, [query, mine, authHeaders, nonce]);

  const clearQuery = useCallback(() => setQuery(''), []);
  const typedNo = query.trim().toUpperCase();
  const typedIsNo = QUOTE_NO_RE.test(typedNo) && !rows.some((r) => r.quotation_no === typedNo);

  const submit = async () => {
    if (!pick) return;
    if (await onRevise(pick.name)) {
      setPick(null);
      setNonce((n) => n + 1);
    }
  };

  const row = pick?.row ?? null;

  return (
    <div className={`bg-card border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3 ${blocked ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="flex items-center gap-2">
        <RotateCcw className="w-[18px] h-[18px]" style={{ color: BRAND }} />
        <h3 className="text-sm font-bold text-slate-800">แก้ไขใบที่ออกไปแล้ว (revise)</h3>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* ทรงเดียวกับปุ่ม "ใบของฉัน / ทั้งหมด" ของหน้าประวัติ — ตัวเลข = จำนวนที่จะเห็นถ้ากด */}
        {viewAll && (
          <div className="inline-flex bg-slate-100 border border-slate-200 rounded-xl p-0.5 gap-0.5 shrink-0">
            {([[true, 'ใบของฉัน', User], [false, 'ทั้งหมด', Users]] as const).map(([m, label, Icon]) => (
              <button
                key={label}
                type="button"
                onClick={() => setMine(m)}
                aria-pressed={mine === m}
                className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all
                  ${mine === m ? 'bg-card text-[var(--brand-fg)] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
                {m && mineTotal !== null && (
                  <span className={`px-1.5 rounded-full text-[10px] font-extrabold ${
                    mine ? 'bg-[var(--brand)]/10 text-[var(--brand-fg)]' : 'bg-slate-200 text-slate-500'
                  }`}>
                    {mineTotal.toLocaleString('en-US')}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 min-w-[260px] flex">
          <ComboBox<PickOption>
            value={pick}
            options={rows.map(toOption)}
            onPick={setPick}
            onQueryChange={setQuery}
            onClose={clearQuery}
            busy={loading}
            ariaLabel="เลือกใบที่จะแก้ไข"
            placeholder="ค้นเลขที่ใบ ชื่อบริษัท หรือผู้ติดต่อ — หรือคลิกเพื่อดูใบล่าสุด"
            searchPlaceholder="พิมพ์เลขที่ใบ ชื่อบริษัท ผู้ติดต่อ หรือเซลส์..."
            emptyText={loadError || (query.trim()
              ? `ไม่พบใบที่ยืนยันแล้วที่ตรงกับ "${query.trim()}"${mine && viewAll ? ' ในใบของฉัน — ลองกด "ทั้งหมด"' : ''}`
              : 'ยังไม่มีใบที่ยืนยันแล้ว')}
            facts={(o, where) => (where === 'field' && o.row ? (
              <span className="flex items-center gap-1.5 min-w-0 text-xs text-slate-500">
                <Badges row={o.row} />
                <span className="truncate">{o.row.customer_name}</span>
              </span>
            ) : null)}
            renderOption={(o) => o.row && (
              <span className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 min-w-0">
                {/* เลขที่ห้ามถูกตัด (มันคือสิ่งที่คนมองหา) — จอแคบให้ป้ายตกบรรทัดแทน */}
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0 font-semibold text-slate-800">
                  <span className="tabular-nums">{o.row.quotation_no}</span>
                  <Badges row={o.row} />
                </span>
                <span className="text-right font-semibold text-slate-700 tabular-nums">฿{baht(o.row.total_sum)}</span>
                <span className="truncate text-xs text-slate-500">
                  {o.row.customer_name}{o.row.contact_name ? ` · ${o.row.contact_name}` : ''}
                </span>
                <span className="text-right text-[11px] text-slate-500 whitespace-nowrap">
                  {thaiDate(o.row.created_at)}{!mine ? ` · ${o.row.salesperson_name}` : ''}
                </span>
              </span>
            )}
            footer={
              <>
                เฉพาะใบที่ยืนยันแล้ว · ฉบับล่าสุดของแต่ละเลข
                {total > rows.length && ` · แสดง ${rows.length} จาก ${total.toLocaleString('en-US')} ใบล่าสุด — พิมพ์เพิ่มเพื่อกรอง`}
              </>
            }
            action={typedIsNo ? () => (
              <button
                type="button"
                onClick={() => setPick({ id: `typed:${typedNo}`, name: typedNo, row: null })}
                className="w-full text-left px-3.5 py-2.5 text-sm text-slate-700 hover:bg-[var(--brand-soft)] hover:text-[var(--brand-fg)]"
              >
                ใช้เลขที่ <span className="font-semibold">{typedNo}</span> ตามที่พิมพ์
              </button>
            ) : undefined}
          />
        </div>
      </div>

      {pick && (
        <div className="rounded-xl border border-[var(--brand-border)] bg-[var(--brand-soft)] px-3.5 py-3 space-y-2.5">
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex-1 min-w-[220px]">
              <div className="flex flex-wrap items-center gap-1.5 text-[15px] font-bold text-slate-800">
                <span className="tabular-nums">{pick.name}</span>
                {row && <Badges row={row} />}
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                {row
                  ? <>
                      {row.customer_name}{row.contact_name ? ` · ${row.contact_name}` : ''}
                      {' · '}เซลส์ {row.salesperson_name || '-'} · {thaiDate(row.created_at)} · ยอดรวม ฿{baht(row.total_sum)}
                    </>
                  : 'ไม่อยู่ในรายการที่คุณเห็น — ระบบจะหาใบตามเลขที่นี้ตอนกดเตรียมใบแก้ไข'}
              </p>
            </div>
            <Button variant="neutral" tone="soft" onClick={() => setPick(null)} disabled={busy}>
              เปลี่ยนใบ
            </Button>
            <Button variant="primary" icon={ArrowRight} busy={busy} disabled={submitDisabled} onClick={submit}>
              เตรียมใบแก้ไข
            </Button>
          </div>
          {row && row.lines.length > 0 && (
            <div className="border-t border-dashed border-[var(--brand-border)] pt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs text-slate-600">
              {row.lines.map((l, i) => (
                <React.Fragment key={i}>
                  <span className="truncate">{l.label}</span>
                  <span className="text-right tabular-nums">× {l.quantity.toLocaleString('en-US')}</span>
                </React.Fragment>
              ))}
            </div>
          )}
          {lineCount > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 text-xs text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>รายการ {lineCount} บรรทัดที่อยู่ในใบตอนนี้จะถูกแทนที่ด้วยรายการของใบนี้</span>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
