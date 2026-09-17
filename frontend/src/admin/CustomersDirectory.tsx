import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Contact, Building2, Users as UsersIcon, Download, X, ChevronRight, Phone, Mail,
  CheckCircle2, AlertTriangle, Info, TrendingUp, TrendingDown,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from './PageHeader';
import { DataFilterBar, DataSearch, FilterCombo, type FilterOption } from './DataFilterBar';
import {
  TableCard, TableScroll, SortHeader, Pagination, EmptyState, SkeletonRows, ErrorBox,
} from './logs/ui';
import { errMsg, formatNumber, formatDate, thCls, tdCls, downloadCsv } from './logs/format';

/**
 * หน้า "ข้อมูลลูกค้า & ผู้ติดต่อ" — อ่านอย่างเดียว ต้นทางคือ Odoo
 *
 * ── สองมุมมองในหน้าเดียว (เจ้าของเลือก "บริษัท" เป็นค่าเริ่มต้น 2026-09-17) ──
 *   customers_data_view เป็น **1 แถว = 1 ผู้ติดต่อ** และฟิลด์ระดับบริษัทซ้ำทุกแถว
 *   43,395 จาก 53,490 บริษัทมีผู้ติดต่อคนเดียว แต่ที่เหลือมีได้ถึง 12 คน ⇒ ตารางแบบแบน
 *   จะซ้ำชื่อบริษัทเดิม 12 แถวติดกัน · แต่เซลส์ก็ค้นจาก "ชื่อคน" จริง ๆ เหมือนกัน
 *   ⇒ เก็บไว้ทั้งสองมุมมอง สลับได้ ไม่แยกเป็นสองหน้า
 *
 * ── กับดักที่หน้าจอนี้ต้องกันไว้ ───────────────────────────────────────
 *   `last_order_at` **ไม่ใช่ "ซื้อครั้งสุดท้ายเมื่อไหร่"** — นับเฉพาะใบที่ออกบิลแล้ว/รอออกบิล
 *   และเฉพาะลูกค้าเครดิต/เช็คล่วงหน้า ⇒ ลูกค้า Cash ที่ซื้อทุกเดือนก็ได้ NULL
 *   คอลัมน์จึงชื่อ **"ด่านเครดิต"** และ NULL แสดงว่า "ไม่เข้าข่ายตรวจ" (= ผ่าน)
 *   ไม่ใช่ขีดกลางเปล่า ๆ ที่อ่านว่าโหลดไม่สำเร็จ (57,827 จาก 82,721 แถวเป็น NULL)
 *
 *   **ประวัติส่วนลดนับแยกตาม `company_id` ไม่ขยายเป็นนิติบุคคล** (เจ้าของตัดสิน 2026-09-17
 *   เหตุผล: "รหัสลูกค้าไม่เหมือนกัน") ⇒ **ต่างจากด่านเครดิตโดยตั้งใจ** ไม่ใช่ของค้างที่รอเก็บ
 *   ให้เหมือนกัน — ใครจะแก้ให้ตรงกัน ต้องกลับไปถามเจ้าของก่อน
 */

interface DiscountRow {
  ref: string; date: string | null; amount: number; discount: number;
  pct: number | null; invoiceStatus: string | null;
}
interface DiscountSummary {
  rows: DiscountRow[]; latestPct: number | null; same: boolean; trend: 1 | 0 | -1;
}

interface CustomerRow {
  company_id: number;
  contact_id: number;
  source: string | null;
  customer_name: string | null;
  customer_reference: string | null;
  customer_tax_id: string | null;
  customer_payment_terms: string | null;
  customer_sale_area: string | null;
  salesperson: string | null;
  sales_team: string | null;
  customer_type: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  contact_name: string | null;
  contact_mobile: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  invoice_street: string | null;
  invoice_district: string | null;
  invoice_sub_district: string | null;
  invoice_state: string | null;
  invoice_zip: string | null;
  last_order_at: string | null;
  contact_count?: number;
  blacklisted?: boolean;
  discount?: DiscountSummary | null;
}

interface Facets {
  types: { value: string; n: number }[];
  teams: { value: string; n: number }[];
  states: { value: string; n: number }[];
  payTerms: { value: string; n: number }[];
}

const GATE_OPTIONS: FilterOption[] = [
  { id: 'stale', name: 'เกิน 1 ปี (ถูกบล็อก)' },
  { id: 'ok', name: 'อยู่ในเกณฑ์' },
  { id: 'na', name: 'ไม่เข้าข่ายตรวจ' },
];

/** นิยามเดียวกับ customers_data_build — ค่าใหม่ที่ Odoo เพิ่มแล้วไม่เข้าสองรูปแบบนี้จะไม่นับว่าเครดิต */
const isCredit = (t: string | null) => !!t && (/^[0-9]+ Days$/.test(t) || t.startsWith('เช็คล่วงหน้า'));

const PayTag: React.FC<{ terms: string | null }> = ({ terms }) => {
  if (!terms) return <span className="inline-block px-2 py-0.5 rounded-md border text-[11px] bg-slate-50 text-slate-500 border-slate-200">ไม่ได้ระบุ</span>;
  const cls = terms === 'Cash' || terms === 'Immediate Payment'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : isCredit(terms) ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-500 border-slate-200';
  return <span className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-medium whitespace-nowrap ${cls}`}>{terms}</span>;
};

/** ด่านเครดิต — NULL = ไม่เข้าข่ายตรวจ (ผ่าน) ไม่ใช่ "ไม่มีข้อมูล" */
function gateOf(iso: string | null): { key: 'na' | 'ok' | 'stale'; text: string; cls: string } {
  if (!iso) return { key: 'na', text: 'ไม่เข้าข่ายตรวจ', cls: 'bg-slate-50 text-slate-500 border-slate-200' };
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days > 365
    ? { key: 'stale', text: 'เกิน 1 ปี', cls: 'bg-red-50 text-red-700 border-red-200' }
    : { key: 'ok', text: 'อยู่ในเกณฑ์', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
}

const GateCell: React.FC<{ iso: string | null }> = ({ iso }) => {
  const g = gateOf(iso);
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-medium whitespace-nowrap ${g.cls}`}>{g.text}</span>
      {iso && <span className="text-[10px] text-slate-400 tabular-nums">{formatDate(iso)}</span>}
    </div>
  );
};

const pctText = (v: number) => `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}%`;

/**
 * ส่วนลดในหนึ่งเซลล์
 * 83% ของบริษัทได้ส่วนลดเท่ากันทั้ง 3 ใบ ⇒ ตัวเลขเดียวพอ · ที่เหลือต้องเห็นว่า "ขยับ"
 * ทิศทางบอกด้วยไอคอน + ตัวเลขใบก่อนหน้า ไม่ใช่สีอย่างเดียว
 */
const DiscountCell: React.FC<{ d: DiscountSummary | null | undefined }> = ({ d }) => {
  if (!d || !d.rows.length) {
    return (
      <div className="text-slate-400">
        —<div className="text-[10px]">ยังไม่เคยมีใบสั่งขาย</div>
      </div>
    );
  }
  if (d.latestPct == null) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <b className={`tabular-nums text-sm ${d.latestPct > 0 ? 'text-slate-800' : 'text-slate-400 font-medium'}`}>
        {pctText(d.latestPct)}
      </b>
      {d.same ? (
        <span className="text-[10px] text-slate-400">คงที่ {d.rows.length} ใบล่าสุด</span>
      ) : (
        <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${d.trend > 0 ? 'text-amber-600' : 'text-sky-600'}`}>
          {d.trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          ใบก่อนหน้า {d.rows[1]?.pct != null ? pctText(d.rows[1].pct as number) : '—'}
        </span>
      )}
    </div>
  );
};

/** ชื่อบริษัทมีสาขาในวงเล็บเสมอ — แยกให้อ่านง่าย แต่ห้ามตัดทิ้ง (Odoo จับคู่ด้วยชื่อตรงตัว) */
function splitName(n: string | null): { base: string; branch: string } {
  const m = /^(.*?)\s*(\((?:สำนักงานใหญ่|สาขา[^)]*)\))\s*$/.exec(n ?? '');
  return m ? { base: m[1], branch: m[2] } : { base: n ?? '', branch: '' };
}

const province = (s: string | null) => (s ? s.replace(/\s*\(TH\)$/, '') : null);

export const CustomersDirectory: React.FC = () => {
  const { token } = useAuth();
  const [view, setView] = useState<'company' | 'contact'>('company');
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Facets>({ types: [], teams: [], states: [], payTerms: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openCompany, setOpenCompany] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [pay, setPay] = useState('');
  const [team, setTeam] = useState('');
  const [state, setState] = useState('');
  const [gate, setGate] = useState('');
  const [sort, setSort] = useState('customer_name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (type) p.set('type', type);
    if (pay) p.set('pay', pay);
    if (team) p.set('team', team);
    if (state) p.set('state', state);
    if (gate) p.set('gate', gate);
    p.set('view', view);
    p.set('sort', sort);
    p.set('dir', dir);
    return p;
  }, [q, type, pay, team, state, gate, view, sort, dir]);

  const activeCount = [q.trim(), type, pay, team, state, gate].filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams(params);
      p.set('limit', String(size));
      p.set('offset', String((page - 1) * size));
      const res = await fetch(`/api/admin/data/customers?${p}`, { headers: authHeaders });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(errMsg(e));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [params, page, size, authHeaders]);

  // หุ้มด้วย setTimeout ตามแบบเดียวกับหน้ากลุ่มบันทึก (ApiLogs) — กติกา react-hooks/set-state-in-effect
  // ห้าม setState ตรง ๆ ใน effect · 300 ms ยังได้ debounce ของช่องค้นหาแถมมาด้วย
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 300);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => void (async () => {
      try {
        const f = await fetch('/api/admin/data/customers/facets', { headers: authHeaders }).then((r) => r.json());
        setFacets(f);
      } catch { /* ตัวเลือกตัวกรองหายไม่ได้ทำให้ตารางใช้ไม่ได้ */ }
    })(), 0);
    return () => clearTimeout(t);
  }, [authHeaders]);

  const clearAll = () => {
    setQ(''); setType(''); setPay(''); setTeam(''); setState(''); setGate(''); setPage(1);
  };

  const onSort = (col: string) => {
    if (sort === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(col); setDir('asc'); }
    setPage(1);
  };

  const switchView = (v: 'company' | 'contact') => {
    setView(v);
    setSort(v === 'company' ? 'customer_name' : 'contact_name');
    setDir('asc');
    setPage(1);
  };

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadCsv(
        `/api/admin/data/customers/export/csv?${params}`,
        token,
        `customers-${view}-${new Date().toISOString().slice(0, 10)}.csv`,
      );
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setExporting(false);
    }
  };

  const opt = (list: { value: string; n: number }[]): FilterOption[] =>
    list.map((v) => ({ id: v.value, name: v.value, count: v.n }));

  // "เครดิตทุกแบบ" ไม่ใช่ค่าใดค่าหนึ่งในคอลัมน์ จึงต้องประกอบเอง
  const payOptions: FilterOption[] = useMemo(() => [
    { id: '__credit', name: 'เครดิต (ทุกแบบ)' },
    ...facets.payTerms.map((v) => ({ id: v.value, name: v.value, count: v.n })),
    { id: '__null', name: 'ไม่ได้ระบุใน Odoo' },
  ], [facets.payTerms]);

  const pages = Math.max(1, Math.ceil(total / size));
  const unit = view === 'company' ? 'บริษัท' : 'ผู้ติดต่อ';

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Contact}
        title="ข้อมูลลูกค้า & ผู้ติดต่อ"
        description={`${formatNumber(total)} ${unit}ที่ตรงกับตัวกรอง · อ่านอย่างเดียว แก้ที่ Odoo`}
      >
        <div className="inline-flex bg-slate-100 border border-slate-200 rounded-xl p-0.5 gap-0.5">
          {([['company', 'มองเป็นบริษัท', Building2], ['contact', 'มองเป็นผู้ติดต่อ', Contact]] as const).map(
            ([v, label, Icon]) => (
              <button
                key={v}
                onClick={() => switchView(v)}
                aria-pressed={view === v}
                className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all
                  ${view === v ? 'bg-card text-[var(--brand-fg)] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ),
          )}
        </div>
      </PageHeader>

      <DataFilterBar
        activeCount={activeCount}
        onClear={clearAll}
        search={<DataSearch value={q} onChange={(v) => { setQ(v); setPage(1); }}
          placeholder="ค้นหา ชื่อบริษัท / ผู้ติดต่อ / รหัส / เลขภาษี / เบอร์" />}
        primary={<FilterCombo label="ด่านเครดิต" value={gate} options={GATE_OPTIONS} onChange={(v) => { setGate(v); setPage(1); }} />}
        rest={<>
          <FilterCombo label="ประเภทลูกค้า" value={type} options={opt(facets.types)} onChange={(v) => { setType(v); setPage(1); }} />
          <FilterCombo label="เงื่อนไขชำระเงิน" value={pay} options={payOptions} onChange={(v) => { setPay(v); setPage(1); }} />
          <FilterCombo label="ทีมขาย" value={team} options={opt(facets.teams)} onChange={(v) => { setTeam(v); setPage(1); }} />
          <FilterCombo label="จังหวัด" value={state} options={opt(facets.states)} onChange={(v) => { setState(v); setPage(1); }} />
        </>}
      />

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      <TableCard
        title={`${unit} · ${formatNumber(total)} ราย`}
        hint={view === 'company'
          ? 'หนึ่งแถว = หนึ่งบริษัท (company_id) · คลิกแถวเพื่อดูผู้ติดต่อทั้งหมดและประวัติส่วนลด'
          : 'หนึ่งแถว = หนึ่งผู้ติดต่อ (ตรงกับตารางจริง) · ชื่อบริษัทซ้ำได้สูงสุด 12 แถว'}
        action={
          <button
            onClick={() => void onExport()}
            disabled={exporting || total === 0}
            className="btn-h px-3 rounded-lg border border-slate-200 bg-card text-xs font-semibold text-slate-600
                       hover:border-[var(--brand-border)] hover:text-[var(--brand-fg)] disabled:opacity-40
                       flex items-center gap-1.5 shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            {exporting ? 'กำลังส่งออก…' : <>ส่งออก CSV<span className="hidden sm:inline">{` (${formatNumber(total)} ${unit}ที่กรองอยู่)`}</span></>}
          </button>
        }
      >
        {loading ? (
          <SkeletonRows rows={8} />
        ) : error ? (
          /* มี ErrorBox อยู่เหนือการ์ดแล้ว — ตรงนี้ห้ามขึ้นข้อความ "ยังไม่มีข้อมูล"
             เพราะจะพาไปตรวจการซิงก์ทั้งที่ปัญหาคือโหลดไม่สำเร็จ */
          <EmptyState
            icon={Contact}
            title="ยังไม่ได้ข้อมูลมาแสดง"
            hint="กดปุ่ม “ลองใหม่” ด้านบน — ตารางจะกลับมาเมื่อโหลดสำเร็จ"
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Contact}
            title={activeCount ? 'ไม่มีรายการที่ตรงกับตัวกรองนี้' : 'ยังไม่มีข้อมูลลูกค้า'}
            hint={activeCount
              ? 'ลองล้างตัวกรองบางตัวออก หรือค้นด้วยรหัสลูกค้าแทนชื่อ'
              : 'ข้อมูลลูกค้าซิงก์มาจาก Odoo — ถ้าว่างทั้งตาราง ให้ตรวจการซิงก์ที่หน้า “ซิงก์ข้อมูล”'}
          />
        ) : (
          <>
            {/* ── จอทำงาน: ตาราง ─────────────────────────────── */}
            <div className="hidden sm:block">
              <TableScroll>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {view === 'contact' && <SortHeader label="ผู้ติดต่อ" col="contact_name" active={sort} dir={dir} onSort={onSort} />}
                      <SortHeader label="บริษัท" col="customer_name" active={sort} dir={dir} onSort={onSort} />
                      <SortHeader label="ประเภท" col="customer_type" active={sort} dir={dir} onSort={onSort} className="hidden lg:table-cell" />
                      <SortHeader label="เงื่อนไขชำระ" col="customer_payment_terms" active={sort} dir={dir} onSort={onSort} />
                      {view === 'company' && <th className={thCls}>ส่วนลดล่าสุด</th>}
                      {view === 'company' && <th className={thCls}>ผู้ติดต่อ</th>}
                      <SortHeader label="ทีมขาย" col="sales_team" active={sort} dir={dir} onSort={onSort} className="hidden lg:table-cell" />
                      <SortHeader label="จังหวัด" col="invoice_state" active={sort} dir={dir} onSort={onSort} className="hidden xl:table-cell" />
                      <th className={thCls}>ด่านเครดิต</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => {
                      const nm = splitName(r.customer_name);
                      return (
                        <tr
                          key={view === 'company' ? r.company_id : r.contact_id}
                          onClick={() => setOpenCompany(r.company_id)}
                          className="cursor-pointer hover:bg-slate-50 transition-colors"
                        >
                          {view === 'contact' && (
                            <td className={tdCls}>
                              <div className="font-medium text-slate-800 flex items-center gap-1.5 flex-wrap">
                                {r.contact_name?.trimEnd() || <span className="text-slate-400">—</span>}
                                {r.blacklisted && <span className="px-1.5 py-0.5 rounded-md border text-[10px] font-semibold bg-red-50 text-red-700 border-red-200">ห้ามเสนอราคา</span>}
                                {r.source === 'saleorder' && <span className="px-1.5 py-0.5 rounded-md border text-[10px] font-semibold bg-amber-50 text-amber-700 border-amber-200">ใบสั่งขาย</span>}
                              </div>
                              <div className="flex gap-2.5 flex-wrap text-[11px] text-slate-400 mt-0.5">
                                {r.contact_mobile && <span className="flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{r.contact_mobile}</span>}
                                {r.contact_phone && <span className="flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{r.contact_phone}</span>}
                              </div>
                            </td>
                          )}
                          <td className={tdCls}>
                            <div className="flex items-start gap-1.5">
                              {view === 'company' && <ChevronRight className="w-3.5 h-3.5 text-slate-300 mt-0.5 shrink-0" />}
                              <div className="min-w-0">
                                <div className="font-medium text-slate-800 max-w-[280px] truncate">
                                  {nm.base}{nm.branch && <span className="text-slate-400 font-normal"> {nm.branch}</span>}
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  <span className="font-mono text-[var(--brand-fg)] font-semibold">{r.customer_reference ?? '—'}</span>
                                  {r.customer_tax_id && <span className="hidden xl:inline"> · เลขภาษี <span className="font-mono">{r.customer_tax_id}</span></span>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className={`${tdCls} hidden lg:table-cell text-slate-600`}>{r.customer_type ?? <span className="text-slate-400">—</span>}</td>
                          <td className={tdCls}><PayTag terms={r.customer_payment_terms} /></td>
                          {view === 'company' && <td className={tdCls}><DiscountCell d={r.discount} /></td>}
                          {view === 'company' && (
                            <td className={tdCls}>
                              <span className="inline-flex items-center gap-1 font-semibold text-slate-700 tabular-nums">
                                <UsersIcon className="w-3 h-3 text-slate-400" />{r.contact_count ?? 0}
                              </span>
                            </td>
                          )}
                          <td className={`${tdCls} hidden lg:table-cell`}>
                            <div className="text-slate-600">{r.sales_team ?? <span className="text-slate-400">—</span>}</div>
                            {r.salesperson && <div className="text-[11px] text-slate-400">{r.salesperson}</div>}
                          </td>
                          <td className={`${tdCls} hidden xl:table-cell`}>
                            <div className="text-slate-600">{province(r.invoice_state) ?? <span className="text-slate-400">—</span>}</div>
                            {r.invoice_district && <div className="text-[11px] text-slate-400">{r.invoice_district}</div>}
                          </td>
                          <td className={tdCls}><GateCell iso={r.last_order_at} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            </div>

            {/* ── มือถือ: การ์ด ──────────────────────────────────
                ตาราง 8 คอลัมน์ที่ย่อลงมาเฉย ๆ คือตารางที่อ่านไม่ออก (AGENTS.md A9) */}
            <div className="sm:hidden divide-y divide-slate-100">
              {rows.map((r) => {
                const nm = splitName(r.customer_name);
                return (
                  <button
                    key={view === 'company' ? r.company_id : r.contact_id}
                    onClick={() => setOpenCompany(r.company_id)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
                  >
                    {view === 'contact' && (
                      <div className="font-medium text-slate-800 text-sm flex items-center gap-1.5 flex-wrap">
                        {r.contact_name?.trimEnd() || '—'}
                        {r.blacklisted && <span className="px-1.5 py-0.5 rounded-md border text-[10px] font-semibold bg-red-50 text-red-700 border-red-200">ห้ามเสนอราคา</span>}
                      </div>
                    )}
                    <div className={view === 'contact' ? 'text-xs text-slate-500 mt-0.5' : 'font-medium text-slate-800 text-sm'}>
                      {nm.base}{nm.branch && <span className="text-slate-400 font-normal"> {nm.branch}</span>}
                    </div>
                    <div className="font-mono text-[11px] text-[var(--brand-fg)] font-semibold mt-0.5">
                      {r.customer_reference ?? '—'}
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs items-center">
                      <dt className="text-slate-400">เงื่อนไขชำระ</dt>
                      <dd className="text-right"><PayTag terms={r.customer_payment_terms} /></dd>
                      {view === 'company' && <>
                        <dt className="text-slate-400">ส่วนลดล่าสุด</dt>
                        <dd className="flex justify-end"><DiscountCell d={r.discount} /></dd>
                        <dt className="text-slate-400">ผู้ติดต่อ</dt>
                        <dd className="text-right tabular-nums text-slate-600">{r.contact_count ?? 0} คน</dd>
                      </>}
                      <dt className="text-slate-400">ด่านเครดิต</dt>
                      <dd className="flex justify-end"><GateCell iso={r.last_order_at} /></dd>
                      <dt className="text-slate-400">จังหวัด</dt>
                      <dd className="text-right text-slate-600">{province(r.invoice_state) ?? '—'}</dd>
                    </dl>
                  </button>
                );
              })}
            </div>

            <Pagination
              page={page} pages={pages} size={size} total={total} unit={unit}
              onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }}
            />
          </>
        )}
      </TableCard>

      <div className="flex items-start gap-2 text-xs text-slate-500 px-1">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          คอลัมน์ <b>“ด่านเครดิต”</b> ไม่ใช่ “ซื้อครั้งสุดท้ายเมื่อไหร่” — <code>last_order_at</code>{' '}
          นับเฉพาะใบที่ออกบิลแล้ว/รอออกบิล และเฉพาะลูกค้าเครดิต/เช็คล่วงหน้า ⇒ ลูกค้า Cash
          ที่ซื้อทุกเดือนก็ยังขึ้นว่า “ไม่เข้าข่ายตรวจ” ซึ่งแปลว่า <b>ผ่าน</b>
        </span>
      </div>

      {openCompany != null && (
        <CompanyDetail companyId={openCompany} token={token} onClose={() => setOpenCompany(null)} />
      )}
    </div>
  );
};

/** แผงรายละเอียดบริษัท — บริษัทเป็นแกน ผู้ติดต่อเป็นรายการในนั้น */
const CompanyDetail: React.FC<{ companyId: number; token: string | null; onClose: () => void }> = ({
  companyId, token, onClose,
}) => {
  const [data, setData] = useState<{ company: CustomerRow; contacts: CustomerRow[]; discount: DiscountSummary | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/data/customers/${companyId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [companyId, token]);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const c = data?.company;
  const nm = splitName(c?.customer_name ?? null);
  const d = data?.discount ?? null;
  const gate = gateOf(c?.last_order_at ?? null);
  const address = [c?.invoice_street, c?.invoice_sub_district, c?.invoice_district, province(c?.invoice_state ?? null), c?.invoice_zip]
    .filter(Boolean).join(' ');

  return (
    <>
      <div className="fixed inset-0 bg-black/45 z-40" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="รายละเอียดบริษัท"
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[460px] max-w-[94vw] z-50 bg-card
                   border-l border-slate-200 shadow-2xl flex flex-col"
      >
        <div className="px-4 py-3.5 border-b border-slate-100 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-800 break-words">
              {nm.base}{nm.branch && <span className="text-slate-400 font-normal"> {nm.branch}</span>}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              <span className="font-mono text-[var(--brand-fg)] font-semibold">{c?.customer_reference ?? '—'}</span>
              {' · '}company_id {companyId}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="ปิดแผงรายละเอียด"
            className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600
                       hover:border-red-200 grid place-items-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-5 flex-1">
          {loading ? (
            <SkeletonRows rows={5} />
          ) : error ? (
            <ErrorBox message={error} onRetry={() => void load()} />
          ) : !data ? (
            <EmptyState icon={Contact} title="ไม่พบบริษัทนี้" />
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                <PayTag terms={c?.customer_payment_terms ?? null} />
                {c?.customer_type && <span className="px-2 py-0.5 rounded-md border text-[11px] bg-slate-50 text-slate-500 border-slate-200">{c.customer_type}</span>}
                <span className={`px-2 py-0.5 rounded-md border text-[11px] font-medium ${gate.cls}`}>ด่านเครดิต: {gate.text}</span>
                {c?.source === 'saleorder' && <span className="px-2 py-0.5 rounded-md border text-[11px] bg-amber-50 text-amber-700 border-amber-200">ไม่มีใน customers</span>}
              </div>

              <section>
                <h4 className="text-[10px] font-bold tracking-wider uppercase text-slate-400 border-b border-slate-100 pb-1.5 mb-2">ด่านตรวจเครดิต</h4>
                {gate.key === 'na' ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800 flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      <b>ไม่เข้าข่ายตรวจ → ผ่าน</b> · <code>last_order_at</code> เป็น NULL ซึ่งมาได้ 3 ทาง
                      และทั้งสามปฏิบัติเหมือนกัน: ไม่ใช่ลูกค้าเครดิต · เป็นเครดิตแต่ยังไม่มีใบเลย (ลูกค้าใหม่) ·
                      มีใบแต่ยังไม่เคยออกบิล — <b>NULL ไม่ได้แปลว่าไม่เคยซื้อ</b>
                    </span>
                  </div>
                ) : gate.key === 'stale' ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span><b>เงียบเกิน 1 ปี → ถูกบล็อก</b> · วันอ้างอิง {formatDate(c?.last_order_at ?? null)} ·
                      นับรวมทุกรหัสสาขาที่เป็นนิติบุคคลเดียวกัน ไม่ใช่แค่ company_id นี้</span>
                  </div>
                ) : (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800 flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span><b>อยู่ในเกณฑ์</b> · วันอ้างอิง {formatDate(c?.last_order_at ?? null)}</span>
                  </div>
                )}
              </section>

              <section>
                <h4 className="text-[10px] font-bold tracking-wider uppercase text-slate-400 border-b border-slate-100 pb-1.5 mb-2">
                  ส่วนลดทั้งบิล · 3 ใบล่าสุด
                </h4>
                {!d || !d.rows.length ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
                    บริษัทนี้<b>ยังไม่เคยมีใบสั่งขาย</b>ในระบบ — ไม่ใช่ความผิดพลาด
                    มีบริษัทที่เคยมีใบจริงแค่ <b>19,059 จาก 53,490</b> ราย
                  </div>
                ) : (
                  <>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                          <th className="text-left pb-1.5 font-bold">เลขที่ใบ</th>
                          <th className="text-right pb-1.5 font-bold">วันที่</th>
                          <th className="text-right pb-1.5 font-bold">ยอดก่อนลด</th>
                          <th className="text-right pb-1.5 font-bold">ส่วนลด</th>
                          <th className="text-right pb-1.5 font-bold">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {d.rows.map((o) => (
                          <tr key={o.ref}>
                            <td className="py-1.5 font-mono text-[11px] text-[var(--brand-fg)]">{o.ref}</td>
                            <td className="py-1.5 text-right text-slate-400">{formatDate(o.date)}</td>
                            <td className="py-1.5 text-right tabular-nums">{formatNumber(o.amount)}</td>
                            <td className={`py-1.5 text-right tabular-nums ${o.discount > 0 ? '' : 'text-slate-400'}`}>{formatNumber(o.discount)}</td>
                            <td className={`py-1.5 text-right tabular-nums font-bold ${o.pct ? 'text-slate-800' : 'text-slate-400 font-medium'}`}>
                              {o.pct != null ? pctText(o.pct) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {d.same ? (
                      <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800">
                        ส่วนลด<b>คงที่ที่ {d.latestPct != null ? pctText(d.latestPct) : '—'}</b> ทั้ง {d.rows.length} ใบ ·
                        ค่ามาตรฐานของร้านคือ <b>30%</b> (มัธยฐานทั้งฐาน)
                      </div>
                    ) : (
                      <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                        ส่วนลด<b>ไม่เท่ากันทั้ง {d.rows.length} ใบ</b> — มีบริษัทแบบนี้ <b>3,228 จาก 19,059</b> ราย
                      </div>
                    )}
                    <div className="mt-2 bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
                      นับ<b>เฉพาะใบของรหัสลูกค้านี้</b> (<span className="font-mono">{c?.customer_reference ?? '—'}</span>)
                      ไม่รวมสาขาอื่นที่ใช้เลขภาษีเดียวกัน — <b>ต่างจากด่านเครดิตโดยตั้งใจ</b>
                      เพราะส่วนลดผูกกับรหัสลูกค้า ส่วนด่านเครดิตผูกกับนิติบุคคล
                    </div>
                  </>
                )}
              </section>

              <section>
                <h4 className="text-[10px] font-bold tracking-wider uppercase text-slate-400 border-b border-slate-100 pb-1.5 mb-2">
                  ผู้ติดต่อ {data.contacts.length} คน
                </h4>
                <div className="space-y-2">
                  {data.contacts.map((k) => (
                    <div key={k.contact_id} className="border border-slate-200 rounded-xl p-2.5 bg-slate-50">
                      <div className="font-semibold text-xs text-slate-800 flex items-center gap-1.5 flex-wrap">
                        {k.contact_name?.trimEnd() || <span className="text-slate-400 font-normal">—</span>}
                        {k.source === 'saleorder' && <span className="px-1.5 py-0.5 rounded-md border text-[10px] bg-amber-50 text-amber-700 border-amber-200">มาจากใบสั่งขาย</span>}
                        <span className="ml-auto font-mono text-[10px] text-slate-400">{k.contact_id}</span>
                      </div>
                      {k.contact_mobile && <div className="text-[11px] text-slate-600 flex items-center gap-1.5 mt-1"><Phone className="w-2.5 h-2.5 text-slate-400" />{k.contact_mobile}</div>}
                      {k.contact_phone && <div className="text-[11px] text-slate-600 flex items-center gap-1.5 mt-0.5"><Phone className="w-2.5 h-2.5 text-slate-400" />{k.contact_phone}</div>}
                      {k.contact_email && <div className="text-[11px] text-slate-600 flex items-center gap-1.5 mt-0.5 break-all"><Mail className="w-2.5 h-2.5 text-slate-400 shrink-0" />{k.contact_email}</div>}
                      {!k.contact_mobile && !k.contact_phone && !k.contact_email && (
                        <div className="text-[11px] text-slate-400 mt-1">ไม่มีช่องทางติดต่อของคนนี้</div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h4 className="text-[10px] font-bold tracking-wider uppercase text-slate-400 border-b border-slate-100 pb-1.5 mb-2">ที่อยู่ออกบิล</h4>
                <div className="text-xs text-slate-700 leading-relaxed">{address || <span className="text-slate-400">—</span>}</div>
                {!c?.invoice_district && c?.invoice_zip && (
                  <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                    ไม่มีอำเภอ ทั้งที่มีรหัสไปรษณีย์ — มีแบบนี้ <b>28,836</b> แถว
                    (เติมอำเภอจาก zip ได้ แต่ตำบลเติมไม่ได้ เพราะ 1 zip มีหลายตำบล)
                  </div>
                )}
              </section>

              <section>
                <h4 className="text-[10px] font-bold tracking-wider uppercase text-slate-400 border-b border-slate-100 pb-1.5 mb-2">การจัดกลุ่ม &amp; รหัสอ้างอิง</h4>
                <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 gap-x-3 items-baseline text-sm">
                  <dt className="text-xs text-slate-400">ทีมขาย</dt><dd className="text-slate-700">{c?.sales_team ?? '—'}</dd>
                  <dt className="text-xs text-slate-400">ผู้ดูแล</dt><dd className="text-slate-700">{c?.salesperson ?? '—'}</dd>
                  <dt className="text-xs text-slate-400">เขตการขาย</dt><dd className="text-slate-700">{c?.customer_sale_area ?? '—'}</dd>
                  <dt className="text-xs text-slate-400">เลขภาษี</dt><dd className="text-slate-700 font-mono text-xs">{c?.customer_tax_id ?? '—'}</dd>
                  <dt className="text-xs text-slate-400">โทรศัพท์</dt><dd className="text-slate-700">{c?.phone ?? '—'}</dd>
                  <dt className="text-xs text-slate-400">อีเมล</dt><dd className="text-slate-700 break-all">{c?.email ?? '—'}</dd>
                </dl>
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
};
