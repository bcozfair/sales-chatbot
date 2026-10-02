/**
 * บัญชีเสนอในนาม PM (2026-09-28) — บริษัทในรายการนี้ ทุกสินค้าออกเป็นใบ Primus (PM) ใบเดียว
 * ไม่แยกใบ Themtech ทั้งจาก LINE และหน้าเว็บ · mockup ที่เจ้าของยืนยัน: mockups/customer-quote-company.html
 *
 * หน้าตาและลำดับการกดยืมจาก "บัญชีห้ามเสนอราคา" (Blacklist.tsx) เพราะเป็นรายชื่อลูกค้าที่ระบบใช้
 * ตัดสินใจแบบเดียวกัน · ต่างกันสามข้อโดยตั้งใจ:
 *   1. **ทั้งบริษัทเท่านั้น** — ไม่มีตัวเลือกเฉพาะผู้ติดต่อ (เจ้าของเลือก)
 *   2. ป้ายสีฟ้า ไม่ใช่แดง — นี่ไม่ใช่การบล็อก
 *   3. มีคอลัมน์ "ครอบคลุม" — ขอทีละแถวหลังรายการขึ้นแล้ว (นับรวมใน SQL ของรายการช้าหลายวินาที
 *      ด้วยเหตุผลเดียวกับที่ listBlacklist ไม่นับ) ⇒ รายการไม่ต้องรอ
 *
 * การแบ่งใบจริงไม่ได้อยู่ที่นี่ — อยู่ที่ decideForcedQuoteCompany (services/customerQuoteCompany.ts)
 */
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { AlertTriangle, Building2, CheckCircle2, Edit2, Layers, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { Modal } from './Modal';
import { Button } from './Button';

const MIN_SEARCH_CHARS = 2;

interface QuotePmRow {
  company_id: number;
  quote_company: 'PM' | 'THT';
  company_name: string | null;
  company_reference: string | null;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

interface RelatedCompany {
  company_id: number;
  display_name: string | null;
  reference: string | null;
  tax_id: string | null;
}

interface CompanyOption {
  id: number;
  display_name: string;
  reference: string | null;
  in_list: boolean;
}

const inputClass =
  'w-full bg-card border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/10 transition-all disabled:opacity-50';

const PM_CHIP = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-sky-50 border-sky-200 text-sky-700 whitespace-nowrap';
const GRAY_CHIP = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-slate-100 border-slate-200 text-slate-500 whitespace-nowrap';

/** แยกการยิง API ออกจาก state เพื่อให้ทุก setState เกิดหลัง await (กฎ react-hooks/set-state-in-effect) */
async function fetchJson<T>(url: string, token: string | null): Promise<T> {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await resp.json();
  if (!resp.ok) throw new Error(body.error || `เซิร์ฟเวอร์ตอบรหัส ${resp.status}`);
  return body as T;
}

async function sendJson(url: string, method: string, token: string | null, payload?: unknown): Promise<void> {
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body.error || `เซิร์ฟเวอร์ตอบรหัส ${resp.status}`);
}

/** ลูกค้าที่ถูกลบจาก Odoo จะไม่มีชื่อใน customers_data_view อีก — โชว์รหัสแทนไม่ให้แถวดูว่าง */
const companyLabel = (row: QuotePmRow) => row.company_name || `บริษัทรหัส ${row.company_id}`;
const dateTh = (iso: string) => new Date(iso).toLocaleDateString('th-TH');

const POP_WIDTH = 340;
const GUTTER = 16;

/**
 * ป้าย "ครอบคลุม" + กล่องลอยบอกว่ามีผลกับรหัสไหนบ้าง (แบบ A ที่เจ้าของยืนยัน 2026-09-28 ·
 * mockups/quote-pm-coverage-tooltip.html)
 *
 * · จอกว้าง: ชี้แล้วขึ้น · มือถือ: แตะเปิด แตะที่อื่น/Esc ปิด (มือถือไม่มี hover) · โฟกัสด้วยคีย์บอร์ดก็เปิด
 * · วาดผ่าน portal ตำแหน่ง fixed — การ์ดตารางเป็น `overflow-hidden` ถ้าวาดข้างในกล่องจะถูกตัด
 *   และบีบให้อยู่ในจอเสมอ (ชิดขอบ 16px · ล่างไม่พอก็กางขึ้นบน) ⇒ 390px ไม่มี scroll แนวนอน
 * · รหัสที่ตั้งไว้จริงขึ้นบนสุดพร้อมป้าย "ที่ตั้งไว้" ที่เหลือเรียงตามรหัส
 * · undefined = กำลังนับ · [] = ไม่พบบริษัทในฐานลูกค้าแล้ว · 1 รหัส = ไม่มีกล่อง (ไม่มีอะไรเพิ่มให้ดู)
 */
const CoverageChip: React.FC<{ companyId: number; list: RelatedCompany[] | undefined }> = ({ companyId, list }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const lastPointer = useRef('');
  const popId = useId();

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const width = Math.min(POP_WIDTH, window.innerWidth - GUTTER * 2);
    const left = Math.max(GUTTER, Math.min(b.left, window.innerWidth - width - GUTTER));
    const h = popRef.current?.offsetHeight ?? 0;
    const above = h > 0 && b.bottom + 6 + h > window.innerHeight - 8 && b.top - 6 - h > 8;
    setPos({ left, top: above ? b.top - 6 - h : b.bottom + 6, above });
  }, []);

  // วัดตำแหน่งหลังกล่องขึ้นแล้ว (ต้องรู้ความสูงจริงก่อนตัดสินว่ากางขึ้นหรือลง)
  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onMove = () => place();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, place]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  if (list === undefined) return <Loader2 className="w-3.5 h-3.5 text-slate-300 animate-spin" aria-label="กำลังนับ" />;
  if (list.length === 0) return <span className="text-slate-300">—</span>;
  if (list.length === 1) return <span className={GRAY_CHIP}>รหัสนี้รหัสเดียว</span>;

  const sorted = [...list].sort((a, b) =>
    Number(b.company_id === companyId) - Number(a.company_id === companyId)
    || String(a.reference ?? '\uffff').localeCompare(String(b.reference ?? '\uffff'))
    || a.company_id - b.company_id);
  // ชี้ = เปิด · ออกจากทั้งป้ายและกล่อง = ปิด (หน่วงนิดเดียวให้เลื่อนเมาส์จากป้ายลงไปในกล่องได้)
  // ตัดสินจาก `pointerType` ของแต่ละครั้ง ไม่ใช่ media query `(hover: hover)` — เครื่องจอสัมผัสที่มีเมาส์ด้วย
  // (และ Chrome headless ของด่าน) ตอบ media query ผิดทาง · นิ้วแตะ = สลับเปิด/ปิดด้วย click แทน
  const enter = (e: React.PointerEvent) => { if (e.pointerType !== 'mouse') return; window.clearTimeout(hoverTimer.current); setOpen(true); };
  const leave = (e: React.PointerEvent) => { if (e.pointerType !== 'mouse') return; hoverTimer.current = window.setTimeout(() => setOpen(false), 120); };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${PM_CHIP} cursor-help`}
        data-coverage-chip
        aria-expanded={open}
        aria-describedby={open ? popId : undefined}
        onPointerDown={(e) => { lastPointer.current = e.pointerType; }}
        // เมาส์เปิดไว้แล้วจากการชี้ — คลิกไม่ต้องสลับ · นิ้ว/คีย์บอร์ด (Enter) = สลับ
        onClick={() => { if (lastPointer.current !== 'mouse') setOpen((v) => !v); lastPointer.current = ''; }}
        onPointerEnter={enter}
        onPointerLeave={leave}
        // เปิดเฉพาะโฟกัสจากคีย์บอร์ด — แตะบนมือถือได้ทั้ง focus และ click ติดกัน ถ้าเปิดทั้งคู่ click จะสลับปิดทันที
        onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setOpen(true); }}
        onBlur={(e) => { if (!popRef.current?.contains(e.relatedTarget as Node)) setOpen(false); }}
      >
        {list.length} รหัสลูกค้า
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          id={popId}
          role="tooltip"
          onPointerEnter={enter}
          onPointerLeave={leave}
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: `min(${POP_WIDTH}px, calc(100vw - ${GUTTER * 2}px))` }}
          className="fixed z-50 rounded-xl border border-slate-300 bg-card shadow-2xl pt-2.5 pb-1.5 text-left"
        >
          <div className="px-3 pb-1.5 text-[11.5px] font-bold text-slate-800">
            ค่านี้มีผลกับ {list.length} รหัสลูกค้าในนิติบุคคลเดียวกัน
            <span className="block font-normal text-[10.5px] text-slate-400 mt-px">ชื่อ รหัสอ้างอิง หรือเลขผู้เสียภาษี ตรงกัน</span>
          </div>
          <div className="max-h-[288px] overflow-y-auto">
            {sorted.map((r) => {
              const me = r.company_id === companyId;
              return (
                <div key={r.company_id} className="flex items-baseline gap-2.5 px-3 py-1.5 border-t border-slate-200">
                  <span className={`shrink-0 w-[88px] font-mono text-[11.5px] break-all ${me ? 'font-bold text-sky-700' : 'text-slate-500'}`}>
                    {r.reference || '—'}
                  </span>
                  <span className="flex-1 min-w-0 text-[12px] text-slate-800">
                    {r.display_name || `บริษัทรหัส ${r.company_id}`}
                    {me && (
                      <span className="ml-1 inline-block px-1.5 rounded-full border border-sky-200 text-[10px] font-bold text-sky-700 align-middle">
                        ที่ตั้งไว้
                      </span>
                    )}
                    {r.tax_id && <span className="block font-mono text-[10.5px] text-slate-400">{r.tax_id}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export const QuotePmList: React.FC = () => {
  const { token } = useAuth();
  const [rows, setRows] = useState<QuotePmRow[]>([]);
  const [coverage, setCoverage] = useState<Record<number, RelatedCompany[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editTarget, setEditTarget] = useState<QuotePmRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuotePmRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJson<QuotePmRow[]>('/api/admin/quote-pm', token);
        if (cancelled) return;
        setRows(data);
        setLoadError('');
        // นับความครอบทีละแถวหลังรายการขึ้นแล้ว — ทีละ 3 เส้นพร้อมกัน (~85 ms ต่อแถว)
        const queue = data.map((r) => r.company_id);
        const worker = async () => {
          while (!cancelled && queue.length > 0) {
            const id = queue.shift()!;
            try {
              const rel = await fetchJson<RelatedCompany[]>(`/api/admin/quote-pm/customers/${id}/related`, token);
              if (!cancelled) setCoverage((c) => ({ ...c, [id]: rel }));
            } catch {
              if (!cancelled) setCoverage((c) => ({ ...c, [id]: [] }));
            }
          }
        };
        await Promise.all([worker(), worker(), worker()]);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'โหลดรายการไม่สำเร็จ');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, reloadKey]);

  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(''), 3000);
    return () => clearTimeout(timer);
  }, [successMsg]);

  const handleSaved = (message: string) => {
    setIsAdding(false);
    setEditTarget(null);
    setDeleteTarget(null);
    setSuccessMsg(message);
    setReloadKey((v) => v + 1);
  };

  const actions = (row: QuotePmRow) => (
    <div className="flex items-center justify-center gap-1">
      <button
        onClick={() => setEditTarget(row)}
        className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-slate-900 rounded-lg transition-colors"
        title="แก้หมายเหตุ"
        aria-label={`แก้หมายเหตุของ ${companyLabel(row)}`}
      >
        <Edit2 className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => setDeleteTarget(row)}
        className="p-1.5 hover:bg-red-50 text-slate-500 hover:text-red-600 rounded-lg transition-colors"
        title="ถอดออกจากรายการ"
        aria-label={`ถอด ${companyLabel(row)} ออกจากรายการ`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {successMsg && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-xl border animate-fade-in bg-emerald-50 border-emerald-200 text-emerald-800">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span className="text-sm font-semibold">{successMsg}</span>
        </div>
      )}

      <PageHeader
        icon={Building2}
        title="บัญชีเสนอในนาม PM"
        description="บริษัทในรายการนี้ ทุกสินค้าจะออกเป็นใบ Primus (PM) ใบเดียว ไม่แยกใบ Themtech — ทั้งจาก LINE และหน้าเว็บ"
      >
        <Button variant="primary" icon={Plus} onClick={() => setIsAdding(true)} className="flex-shrink-0">
          เพิ่มบริษัท
        </Button>
      </PageHeader>

      {isLoading && rows.length === 0 ? (
        <div className="bg-card border border-slate-200 rounded-2xl p-10 text-center shadow-sm flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-7 h-7 text-[var(--brand-fg)] animate-spin" />
          <p className="text-slate-500 text-sm font-medium">กำลังโหลดรายการ...</p>
        </div>
      ) : loadError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center text-red-800 shadow-sm flex flex-col items-center justify-center gap-2">
          <AlertTriangle className="w-9 h-9 text-red-600" />
          <p className="font-bold">โหลดรายการไม่ได้</p>
          <p className="text-xs">{loadError}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card border border-slate-200 rounded-2xl p-10 text-center shadow-sm flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-[var(--brand-soft)] text-[var(--brand-fg)]">
            <Building2 className="w-6 h-6" />
          </div>
          <p className="font-bold text-slate-900">ยังไม่มีบริษัทในรายการ</p>
          <p className="text-sm text-slate-500 max-w-md">
            ทุกใบแยก Primus / Themtech ตามสินค้า · กด "เพิ่มบริษัท" เพื่อให้บริษัทใดเสนอราคาในนาม PM ทุกสินค้า
          </p>
        </div>
      ) : (
        <div className="bg-card border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          {/* จอทำงาน = ตาราง */}
          <table className="hidden md:table w-full border-collapse text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[11px] font-semibold uppercase tracking-wider select-none">
                <th className="px-4 py-3 w-32">รหัสบริษัท</th>
                <th className="px-4 py-3">บริษัท</th>
                <th className="px-4 py-3 w-40">ครอบคลุม</th>
                <th className="px-4 py-3">หมายเหตุ</th>
                <th className="px-4 py-3 w-40">ผู้เพิ่ม</th>
                <th className="px-4 py-3 text-center w-24">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
              {rows.map((row) => (
                <tr key={row.company_id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-2.5">
                    {row.company_reference ? (
                      <span className="font-mono text-[13px] font-semibold text-slate-700">{row.company_reference}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-slate-900">{companyLabel(row)}</div>
                    {!row.company_name && <div className="text-[11px] text-amber-600">ไม่พบชื่อในฐานข้อมูลลูกค้าแล้ว</div>}
                  </td>
                  <td className="px-4 py-2.5"><CoverageChip companyId={row.company_id} list={coverage[row.company_id]} /></td>
                  <td className="px-4 py-2.5 text-slate-500">{row.note || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-[13px]">
                    {row.created_by_name || <span className="text-slate-300">—</span>}
                    <div className="text-[11px] text-slate-400">{dateTh(row.created_at)}</div>
                  </td>
                  <td className="px-4 py-2.5">{actions(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* มือถือ = การ์ด (design.md: ตารางหลายคอลัมน์บนมือถือ = การ์ด ไม่ใช่ตารางที่เล็กลง) */}
          <ul className="md:hidden divide-y divide-slate-100">
            {rows.map((row) => (
              <li key={row.company_id} className="px-4 py-3 space-y-1.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-slate-900">{companyLabel(row)}</div>
                    {!row.company_name && <div className="text-[11px] text-amber-600">ไม่พบชื่อในฐานข้อมูลลูกค้าแล้ว</div>}
                    {row.company_reference && (
                      <div className="font-mono text-[12px] text-slate-500">{row.company_reference}</div>
                    )}
                  </div>
                  {actions(row)}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                  <CoverageChip companyId={row.company_id} list={coverage[row.company_id]} />
                  <span>{row.created_by_name || '—'} · {dateTh(row.created_at)}</span>
                </div>
                {row.note && <div className="text-[12px] text-slate-500">{row.note}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isAdding && <AddModal token={token} onClose={() => setIsAdding(false)} onSaved={handleSaved} />}
      {editTarget && (
        <EditModal target={editTarget} token={token} onClose={() => setEditTarget(null)} onSaved={handleSaved} />
      )}
      {deleteTarget && (
        <RemoveModal target={deleteTarget} token={token} onClose={() => setDeleteTarget(null)} onSaved={handleSaved} />
      )}
    </div>
  );
};

/* ─────────────────────────── Modal ย่อย ─────────────────────────── */

const ErrorBox: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex items-start gap-2 bg-red-50 border border-red-200 p-3 rounded-xl text-red-700 text-xs">
    <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
    <span>{message}</span>
  </div>
);

const InfoBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800 leading-relaxed">{children}</div>
);

/**
 * กล่อง "ค่านี้ไปถึงรหัสไหนบ้าง" — กติกาเดียวกับบัญชีห้ามเสนอราคา (ชื่อ/รหัสอ้างอิง/เลขภาษี ตรงกัน)
 * โผล่เฉพาะเมื่อมากกว่า 1 รหัส เพราะมีไว้บอกว่า "ได้ผลกว้างกว่าที่เลือก"
 */
const CoveragePreview: React.FC<{ companyId: number; token: string | null }> = ({ companyId, token }) => {
  const [companies, setCompanies] = useState<RelatedCompany[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJson<RelatedCompany[]>(`/api/admin/quote-pm/customers/${companyId}/related`, token);
        if (!cancelled) setCompanies(data);
      } catch {
        if (!cancelled) setCompanies([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, token]);

  if (companies.length <= 1) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
      <div className="flex items-start gap-2 text-amber-800">
        <Layers className="w-4 h-4 shrink-0 mt-px" />
        <span className="text-xs font-semibold">
          ค่านี้จะมีผลกับ {companies.length} รหัสลูกค้าในนิติบุคคลเดียวกัน
          <span className="block font-normal text-[11px] text-amber-700 mt-0.5">
            (ชื่อ รหัสอ้างอิง หรือเลขผู้เสียภาษี ตรงกัน) ตรวจให้แน่ใจว่าไม่มีรายที่ไม่เกี่ยวข้องปนมา
          </span>
        </span>
      </div>
      <div className="max-h-32 overflow-y-auto rounded-lg border border-amber-200 bg-card divide-y divide-amber-100">
        {companies.map((r) => (
          <div key={r.company_id} className="px-2.5 py-1.5">
            <div className="text-[12px] text-slate-800 truncate">{r.display_name || `บริษัทรหัส ${r.company_id}`}</div>
            <div className="text-[10px] text-slate-400 font-mono">
              {r.reference || '—'}
              {r.tax_id ? ` · ${r.tax_id}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const FormButtons: React.FC<{ onClose: () => void; busy: boolean; disabled?: boolean; label: string; danger?: boolean }> = ({
  onClose, busy, disabled, label, danger,
}) => (
  <div className="flex gap-2 pt-1">
    <Button type="button" onClick={onClose} disabled={busy} className="flex-1">
      ยกเลิก
    </Button>
    <Button type="submit" variant={danger ? 'danger' : 'primary'} busy={busy} disabled={disabled} className="flex-1">
      {label}
    </Button>
  </div>
);

const AddModal: React.FC<{ token: string | null; onClose: () => void; onSaved: (m: string) => void }> = ({
  token, onClose, onSaved,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CompanyOption[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [company, setCompany] = useState<CompanyOption | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // ค้นหาแบบหน่วง 300ms — setState อยู่ใน callback ของ timer (กฎ react-hooks/set-state-in-effect)
  useEffect(() => {
    if (company) return;
    const q = query.trim();
    if (q.length < MIN_SEARCH_CHARS) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        setIsSearching(true);
        try {
          const data = await fetchJson<CompanyOption[]>(`/api/admin/quote-pm/customers?q=${encodeURIComponent(q)}`, token);
          if (!cancelled) setResults(data);
        } catch {
          if (!cancelled) setResults([]);
        } finally {
          if (!cancelled) setIsSearching(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, company, token]);

  const visibleResults = !company && query.trim().length >= MIN_SEARCH_CHARS ? results : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!company) {
      setError('กรุณาเลือกบริษัท');
      return;
    }
    setBusy(true);
    try {
      await sendJson('/api/admin/quote-pm', 'POST', token, { companyId: company.id, note: note.trim() || null });
      onSaved('เพิ่มเข้าบัญชีเสนอในนาม PM แล้ว');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      setBusy(false);
    }
  };

  return (
    <Modal icon={Building2} title="เพิ่มบริษัทที่เสนอราคาในนาม PM" onClose={busy ? undefined : onClose}>
      <form onSubmit={handleSubmit} className="p-5 space-y-3">
        {error && <ErrorBox message={error} />}

        <div className="space-y-1">
          <label htmlFor="qpm-company" className="block text-xs font-semibold text-slate-600">บริษัท</label>
          {company ? (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-[var(--brand-fg)] bg-[var(--brand)]/5">
              <Building2 className="w-4 h-4 text-[var(--brand-fg)] shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-slate-800 truncate">{company.display_name}</span>
                {company.reference && <span className="block font-mono text-[11px] text-slate-500">{company.reference}</span>}
              </span>
              <button
                type="button"
                onClick={() => { setCompany(null); setQuery(''); }}
                disabled={busy}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 shrink-0"
              >
                เปลี่ยน
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="qpm-company"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`พิมพ์ชื่อบริษัท หรือรหัสอ้างอิง อย่างน้อย ${MIN_SEARCH_CHARS} ตัวอักษร`}
                  className={`${inputClass} pl-10`}
                  autoComplete="off"
                />
                {isSearching && (
                  <Loader2 className="w-4 h-4 text-slate-400 animate-spin absolute right-3.5 top-1/2 -translate-y-1/2" />
                )}
              </div>
              {visibleResults.length > 0 && (
                <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {visibleResults.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setCompany(row)}
                      disabled={row.in_list}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors disabled:cursor-not-allowed disabled:hover:bg-transparent flex items-center gap-2"
                    >
                      <span className="flex-1 min-w-0">
                        <span className={`block text-sm truncate ${row.in_list ? 'text-slate-400' : 'text-slate-800'}`}>
                          {row.display_name}
                        </span>
                        {row.reference && <span className="block text-[11px] text-slate-400 font-mono">{row.reference}</span>}
                      </span>
                      {row.in_list && <span className={PM_CHIP}>อยู่ในรายการแล้ว</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {company && <CoveragePreview companyId={company.id} token={token} />}

        <div className="space-y-1">
          <label htmlFor="qpm-note" className="block text-xs font-semibold text-slate-600">
            หมายเหตุ <span className="font-normal text-slate-400">(ไม่บังคับ)</span>
          </label>
          <input
            id="qpm-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            placeholder="เช่น ลูกค้าขอรับใบจาก PM อย่างเดียว"
            className={inputClass}
          />
        </div>

        <InfoBox>ใบที่ออกเลขแล้วไม่เปลี่ยน · ร่างที่ค้างอยู่ไม่เปลี่ยน · มีผลกับใบที่สร้างหรือผูกลูกค้าหลังจากนี้</InfoBox>

        <FormButtons onClose={onClose} busy={busy} disabled={!company || company.in_list} label="เพิ่มบริษัท" />
      </form>
    </Modal>
  );
};

const EditModal: React.FC<{ target: QuotePmRow; token: string | null; onClose: () => void; onSaved: (m: string) => void }> = ({
  target, token, onClose, onSaved,
}) => {
  const [note, setNote] = useState(target.note || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await sendJson(`/api/admin/quote-pm/${target.company_id}`, 'PUT', token, { note: note.trim() || null });
      onSaved('บันทึกหมายเหตุแล้ว');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      setBusy(false);
    }
  };

  return (
    <Modal icon={Edit2} title="แก้หมายเหตุ" onClose={busy ? undefined : onClose}>
      <form onSubmit={handleSubmit} className="p-5 space-y-3">
        {error && <ErrorBox message={error} />}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-600">บริษัท</label>
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50">
            <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-slate-700 truncate">{companyLabel(target)}</span>
              {target.company_reference && <span className="block font-mono text-[11px] text-slate-500">{target.company_reference}</span>}
            </span>
          </div>
          <p className="text-[11px] text-slate-400">เปลี่ยนบริษัทไม่ได้ — ถ้าเพิ่มผิดบริษัท ให้ถอดรายการนี้แล้วเพิ่มใหม่</p>
        </div>
        <CoveragePreview companyId={target.company_id} token={token} />
        <div className="space-y-1">
          <label htmlFor="qpm-edit-note" className="block text-xs font-semibold text-slate-600">
            หมายเหตุ <span className="font-normal text-slate-400">(ไม่บังคับ)</span>
          </label>
          <input
            id="qpm-edit-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            placeholder="เช่น ลูกค้าขอรับใบจาก PM อย่างเดียว"
            className={inputClass}
          />
        </div>
        <FormButtons onClose={onClose} busy={busy} label="บันทึก" />
      </form>
    </Modal>
  );
};

const RemoveModal: React.FC<{ target: QuotePmRow; token: string | null; onClose: () => void; onSaved: (m: string) => void }> = ({
  target, token, onClose, onSaved,
}) => {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await sendJson(`/api/admin/quote-pm/${target.company_id}`, 'DELETE', token);
      onSaved('ถอดออกจากบัญชีเสนอในนาม PM แล้ว');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ถอดไม่สำเร็จ');
      setBusy(false);
    }
  };

  return (
    <Modal icon={Trash2} tone="danger" title="ถอดออกจากรายการ" onClose={busy ? undefined : onClose}>
      <form onSubmit={handleSubmit} className="p-5 space-y-3">
        {error && <ErrorBox message={error} />}
        <p className="text-sm text-slate-600">
          ถอด <span className="font-semibold text-slate-900">{companyLabel(target)}</span> ออกจากบัญชีเสนอในนาม PM ใช่หรือไม่
        </p>
        <InfoBox>ใบที่สร้างหลังจากนี้จะกลับไปแยก Primus / Themtech ตามสินค้าเหมือนเดิม · ใบที่มีอยู่แล้วไม่เปลี่ยน</InfoBox>
        <FormButtons onClose={onClose} busy={busy} label="ถอดออก" danger />
      </form>
    </Modal>
  );
};
