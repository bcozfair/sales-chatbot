// ─────────────────────────────────────────────────────────────────────────────
//  กล่อง "ประวัติการส่งออก Odoo" ของหน้าประวัติใบเสนอราคา — 1 แถว = 1 ครั้งที่กดส่งออก (ชุด)
//
//  แยกออกจาก Quotations.tsx เมื่อ 2026-09-29 ตอนเจ้าของขอ "แบ่งหน้า · scrollbar ในกล่อง · ตัวกรอง"
//  (mockup `mockups/odoo-export-history.html` · เคาะ: เริ่ม 10 ชุดต่อหน้า · ตัวกรอง 4 ช่องแถวเดียว ·
//  คลิกนอกกล่องไม่ปิดแล้ว) — กล่องมี state ของตัวเองครบชุด (ตัวกรอง · หน้า · โหลด) ซึ่งไม่เกี่ยวกับตาราง
//  ใบเสนอราคาของหน้าแม่เลย จึงอยู่ไฟล์ของตัวเอง ส่วนหน้าแม่ถือแค่ "เปิดอยู่ไหม"
//
//  ประกอบจากของร่วมทั้งหมด ไม่มีชิ้นไหนเขียนใหม่ (docs/design.md หัวข้อ 3):
//    เปลือก `Modal` (โหมด `fill` = สูงคงที่ เลื่อนเฉพาะรายการ) · ช่องกรองของ `FilterBar.tsx` ·
//    `Pagination` / `EmptyState` / `ErrorBox` ของ `logs/ui.tsx`
//  ไม่ใช้การ์ด `FilterBar` ทั้งก้อน เพราะมันวางปุ่มล้างไว้ใต้แถว (= สองแถว) และกรอบการ์ดซ้อนในกล่อง
//  เจ้าของสั่ง "ให้แสดงได้ทั้งหมดในแถวเดียว" ⇒ ปุ่มล้างเป็นไอคอน ✕ ท้ายแถวแทน
//
//  ตัวกรองทำที่ SQL ไม่ใช่ที่จอ — ชุดแบ่งหน้าจาก server การกรองเฉพาะ 10 แถวที่เห็นจะได้ผลที่ผิด
//  โดยดูเหมือนถูก · ช่องวันที่ตีความเป็น "วันไทย" ของเวลาส่งออก ด้วยเงื่อนไขชุดเดียวกับหน้าประวัติใบเสนอราคา
//
//  **ดูอย่างเดียว** (ตั้งแต่ 2026-10-07 · เจ้าของสั่ง) — ปุ่ม "ยกเลิกทั้งชุด" ถูกถอดพร้อมปุ่มถอยรายใบในตาราง
//  เพราะระบบรู้เองแล้วว่าใบไหนเข้า Odoo (`odoo_imported_at`) และปุ่มนั้นพาใบที่นำเข้าแล้วกลับเข้าไฟล์ถัดไป
//  ได้ (= ใบซ้ำใน Odoo) · จะส่งไฟล์ใหม่ ให้เลือกสถานะ Odoo "รอนำเข้า" ที่ตารางแล้วกดส่งออกตามปกติ
//  (ใช้จริงครั้งเดียวตลอด 177 ชุด / 5,187 ใบ ตั้งแต่ 2026-08-05 · วัด 2026-10-07)
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Calendar, FileSpreadsheet, Filter, History, Loader2, User, X } from 'lucide-react';
import { Modal } from './Modal';
import { FilterDateRange, FilterSearch, FilterSelect } from './FilterBar';
import { EmptyState, ErrorBox, Pagination } from './logs/ui';
import { errMsg, theadRowCls, thBaseCls } from './logs/format';

/** หัวตารางติดบนสุดของกล่องเลื่อน — พื้นอยู่ที่ช่อง (พื้นของแถวไม่ติดตาม) */
const stickyThCls = `${thBaseCls} px-4 py-3 sticky top-0 z-10 bg-slate-50 shadow-[inset_0_-1px_0_var(--c-line)]`;

/** 1 ครั้งที่กดปุ่มส่งออก (GET /api/admin/quotations/export-batches) */
interface ExportBatch {
  id: string;
  exported_at: string;
  exported_by_username: string | null;
  format: string;
  quotation_count: number;
  row_count: number;
  /** ใบในชุดที่ยังนับว่า "ส่งออกแล้ว" — น้อยกว่า quotation_count แปลว่าถูกถอยไปบางส่วน (ชุดก่อน 2026-10-07) */
  active_count: number;
  /** ตัวกรองที่ใช้ตอนกดส่งออก — ชุดที่ส่งออกก่อนแยก QP/QT จะไม่มีคีย์ company */
  filters?: { company?: string } | null;
  /** มีเฉพาะตอนค้นด้วยเลขที่ใบ — เลขแรกที่เจอในชุดนี้ + จำนวนที่เจอทั้งหมด */
  matched_no?: string | null;
  matched_count?: number;
}

/** เริ่มที่ 10 ตามที่เจ้าของเคาะ · เพดาน 100 = เพดานของ endpoint */
const PAGE_SIZES = [10, 20, 50, 100] as const;

interface Props {
  token: string | null;
  /** ตัวจัดรูปเวลาของหน้าแม่ — ให้เวลาในกล่องหน้าตาเดียวกับคอลัมน์วันที่ของตารางใบเสนอราคา */
  formatTime: (iso: string) => string;
  onClose: () => void;
}

/** จำนวนใบของชุด — ต่างจาก quotation_count แปลว่าบางใบถูกถอยเครื่องหมายไปแล้ว */
const BatchCount: React.FC<{ b: ExportBatch }> = ({ b }) => (
  <>
    {b.active_count}
    {b.active_count !== b.quotation_count && <span className="text-slate-400"> / {b.quotation_count}</span>}
  </>
);

/** ป้ายบอกว่าชุดนี้ติดมาเพราะใบไหน — โผล่เฉพาะตอนค้นด้วยเลขที่ใบ */
const MatchedChip: React.FC<{ b: ExportBatch }> = ({ b }) =>
  b.matched_no ? (
    <span className="inline-flex mt-1 px-2 py-0.5 rounded-full border border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-fg)] font-mono text-[10.5px] font-bold">
      {b.matched_no}
      {(b.matched_count ?? 1) > 1 && ` +${(b.matched_count ?? 1) - 1}`}
    </span>
  ) : null;

export const ExportHistoryModal: React.FC<Props> = ({ token, formatTime, onClose }) => {
  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [company, setCompany] = useState('');
  const [exportedBy, setExportedBy] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(PAGE_SIZES[0]);

  const [rows, setRows] = useState<ExportBatch[]>([]);
  const [total, setTotal] = useState(0);
  const [exporters, setExporters] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** เลขลำดับคำขอ — พิมพ์รัวแล้วคำตอบกลับมาสลับลำดับ ต้องทิ้งคำตอบเก่า ไม่งั้นตารางแสดงผลของคำค้นก่อนหน้า */
  const seq = useRef(0);

  const filtered = !!(q.trim() || dateFrom || dateTo || company || exportedBy);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams({ limit: String(size), offset: String((page - 1) * size) });
      if (q.trim()) qs.set('q', q.trim());
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo) qs.set('dateTo', dateTo);
      if (company) qs.set('company', company);
      if (exportedBy) qs.set('exportedBy', exportedBy);
      const res = await fetch(`/api/admin/quotations/export-batches?${qs}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('ไม่สามารถดึงประวัติการส่งออกได้');
      const json: { data: ExportBatch[]; total: number; exporters?: string[] } = await res.json();
      if (mine !== seq.current) return;
      setRows(json.data || []);
      setTotal(json.total || 0);
      setExporters(json.exporters || []);
      setLoaded(true);
    } catch (e: unknown) {
      if (mine === seq.current) setLoadError(errMsg(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [token, page, size, q, dateFrom, dateTo, company, exportedBy]);

  // ยิงผ่าน setTimeout ไม่เรียก setState ตรง ๆ ในตัว effect (react-hooks/set-state-in-effect)
  // · 300 ms = รวบการพิมพ์รัวในช่องค้นเลขที่ใบไปในตัว (pattern เดียวกับ ApiLogs.tsx)
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 300);
    return () => clearTimeout(t);
  }, [load]);

  /** เปลี่ยนตัวกรองแล้วกลับหน้า 1 เสมอ — หน้า 4 ของผลกรองใหม่อาจไม่มีอยู่จริง */
  const withReset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const clearAll = () => {
    setQ(''); setDateFrom(''); setDateTo(''); setCompany(''); setExportedBy(''); setPage(1);
  };
  const goPage = (p: number) => {
    setPage(p);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const pages = Math.max(1, Math.ceil(total / size));

  return (
    <Modal icon={History} title="ประวัติการส่งออก Odoo" onClose={onClose} size="xl" fill>
      {/* ── ตัวกรอง: แถวเดียวตั้งแต่ md · มือถือตัดเป็น 3 แถว (ค้น · ช่วงวันที่ · บริษัท/ผู้ส่งออก/ล้าง) ── */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-100 bg-slate-50">
        <div className="grid gap-2 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.625rem] md:grid-cols-[minmax(0,1fr)_14.5rem_7.25rem_9.375rem_2.625rem]">
          <div className="col-span-3 md:col-span-1" title="ค้นเลขที่ใบ เช่น QP-260905987 — พิมพ์บางส่วนได้ ไม่ต้องมีขีด">
            <FilterSearch value={q} onChange={withReset(setQ)} placeholder="ค้นเลขที่ใบ" />
          </div>
          <div className="col-span-3 md:col-span-1">
            <FilterDateRange
              from={dateFrom}
              to={dateTo}
              onFrom={withReset(setDateFrom)}
              onTo={withReset(setDateTo)}
              icon={Calendar}
              fromLabel="ส่งออกตั้งแต่วันที่"
              toLabel="ส่งออกถึงวันที่"
            />
          </div>
          <FilterSelect value={company} onChange={withReset(setCompany)} icon={Building2} aria-label="บริษัท">
            <option value="">ทุกบริษัท</option>
            <option value="QP">QP</option>
            <option value="QT">QT</option>
          </FilterSelect>
          <FilterSelect value={exportedBy} onChange={withReset(setExportedBy)} icon={User} aria-label="ผู้ส่งออก">
            <option value="">ผู้ส่งออกทุกคน</option>
            {exporters.map((u) => <option key={u} value={u}>{u}</option>)}
          </FilterSelect>
          {/* จางไว้ตอนไม่มีอะไรให้ล้าง แทนการซ่อน — ช่องค้นจะได้ไม่ยืด/หดตอนปุ่มโผล่ */}
          <button
            type="button"
            onClick={clearAll}
            disabled={!filtered}
            title="ล้างตัวกรองทั้งหมด"
            aria-label="ล้างตัวกรองทั้งหมด"
            className="flex items-center justify-center rounded-xl border border-slate-200 bg-card text-slate-500 enabled:hover:text-red-600 enabled:hover:border-red-200 transition-colors disabled:opacity-40 disabled:cursor-default"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── รายการ: ส่วนเดียวที่เลื่อน · หัวคอลัมน์ติดอยู่บนสุดของกล่องเลื่อน ── */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        {loadError ? (
          <div className="p-4"><ErrorBox message={loadError} onRetry={() => { void load(); }} /></div>
        ) : !loaded ? (
          <div className="p-10 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-7 h-7 text-[var(--brand-fg)] animate-spin" />
            <p className="text-slate-500 text-sm font-medium">กำลังโหลดประวัติ...</p>
          </div>
        ) : rows.length === 0 ? (
          filtered
            ? <EmptyState icon={Filter} title="ไม่พบชุดที่ตรงกับตัวกรอง" hint="ลองขยายช่วงวันที่ หรือกดปุ่ม ✕ ท้ายแถวตัวกรองเพื่อล้างทั้งหมด" />
            : <EmptyState icon={FileSpreadsheet} title="ยังไม่มีประวัติการส่งออก" />
        ) : (
          <div className={`transition-opacity ${loading ? 'opacity-60' : ''}`}>
            <table className="hidden sm:table w-full text-left text-sm border-collapse">
              <thead>
                <tr className={theadRowCls}>
                  {/* เส้นใต้หัวเป็นเงาด้านใน ไม่ใช่ border — border ของแถวไม่เลื่อนตามหัวที่ติดอยู่ */}
                  <th className={stickyThCls}>เวลา</th>
                  <th className={stickyThCls}>ผู้ส่งออก</th>
                  <th className={`${stickyThCls} text-center`}>บริษัท</th>
                  <th className={`${stickyThCls} text-center`}>ไฟล์</th>
                  <th className={`${stickyThCls} text-right`}>จำนวนใบ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/40 transition-colors">
                    <td className="px-4 py-2.5 text-slate-700">
                      {formatTime(b.exported_at)}
                      {b.matched_no && <><br /><MatchedChip b={b} /></>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{b.exported_by_username || '-'}</td>
                    {/* ชุดที่ส่งออกก่อนแยก QP/QT ไม่มีคีย์นี้ — ตอนนั้นไฟล์เดียวมีทั้งสองบริษัทปนกัน */}
                    <td className="px-4 py-2.5 text-center text-slate-700 font-semibold">{b.filters?.company || '-'}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-slate-50 border-slate-200 text-slate-600">
                        {b.format}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-800">
                      <BatchCount b={b} />
                      <span className="block text-[10px] text-slate-400">{b.row_count} แถว</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* มือถือ = การ์ด ไม่ใช่ตารางที่เล็กลง (docs/design.md) · ตัดคอลัมน์ "ไฟล์" เพราะทุกชุดเป็น XLSX */}
            <div className="sm:hidden divide-y divide-slate-100">
              {rows.map((b) => (
                <div key={b.id} className="px-4 py-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center">
                  <div className="text-sm font-semibold text-slate-800">{formatTime(b.exported_at)}</div>
                  <div className="justify-self-end text-sm font-bold text-slate-800">{b.filters?.company || '-'}</div>
                  <div className="col-span-2 text-xs text-slate-500 min-w-0">
                    {b.exported_by_username || '-'} · <span className="font-mono font-semibold text-slate-800"><BatchCount b={b} /></span> ใบ · {b.row_count} แถว
                    {b.matched_no && <div><MatchedChip b={b} /></div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0">
        <Pagination
          page={Math.min(page, pages)}
          pages={pages}
          size={size}
          total={total}
          unit="ชุด"
          sizes={PAGE_SIZES}
          onPage={goPage}
          onSize={(s) => { setSize(s); goPage(1); }}
        />
      </div>
    </Modal>
  );
};
