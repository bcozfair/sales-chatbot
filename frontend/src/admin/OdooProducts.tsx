import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PackageOpen, Download, RefreshCw, Trash2, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from './PageHeader';
import { DataSearch } from './DataFilterBar';
import { TableCard, TableScroll, Pagination, EmptyState, SkeletonRows, ErrorBox, RowAction, RowActions } from './logs/ui';
import { errMsg, formatNumber, formatDate, thCls, theadRowCls, tdCls, inputCls, downloadCsv } from './logs/format';
import { Modal } from './Modal';
import { Button } from './Button';

/**
 * หน้า "สินค้าเพิ่มเอง" — คิวงานค้างของโมดูล `local_products` (docs/plan-local-products.md J4)
 *
 * ── ฝาแฝดของหน้า "ผู้ติดต่อเพิ่มเอง" (`OdooContacts.tsx`) ─────────────────────
 *   โครงเดียวกันทุกชิ้น (หัวหน้า · ปุ่มส่งออก · ตัวกรองสองช่อง · ตาราง/การ์ดมือถือ) ต่างแค่คอลัมน์
 *   **งานหลักของหน้าคือปุ่มส่งออกไฟล์** ให้แอดมินเอาไปคีย์ใน Odoo · หน้าตาตาม mockup
 *   `local-products-list` ที่เจ้าของยืนยัน 2026-10-02 (รอบ 4 · ตัวกรองรอบ 5)
 *
 * ── สี่กลุ่มที่ไม่ทับกัน (เจ้าของสั่ง 2026-10-02 รอบ 5) ─────────────────────────
 *   ยังไม่ส่งออก · รอนำเข้า · รหัสซ้ำ/ไม่ตรง · นำเข้าแล้ว — สินค้าหนึ่งตัวอยู่กลุ่มเดียว และป้ายในคอลัมน์สถานะ
 *   ใช้คำเดียวกับตัวกรอง ⇒ เห็นป้ายอะไรก็หาเจอในกลุ่มชื่อนั้น · ตัวตัดสินกลุ่มจริงอยู่ที่ server (`FILTER_SQL`)
 *   `groupOf` ข้างล่างเป็นแค่ตัวเลือกป้าย ใช้กติกาลำดับเดียวกัน (นำเข้าแล้ว > ซ้ำ > ส่งออกแล้ว > ยังไม่ส่งออก)
 *
 * ── สิ่งที่หน้านี้จงใจ "ไม่มี" ────────────────────────────────────────────────
 *   1. **ไม่มีปุ่มติ๊กว่า "คีย์เข้า Odoo แล้ว"** — ระบบตรวจเองท้ายรอบ sync จาก `internal_reference`
 *      ที่ตรงกันเท่านั้น (เจ้าของเคาะ 2026-10-01 · แผน §7)
 *   2. **ยังไม่มีปุ่มเพิ่ม/แก้ไข** — ใช้หน้าต่างตัวเดียวกับตอนเพิ่มกลางหน้าขอใบ ซึ่งมากับ J6
 *      (เจ้าของเคาะ 2026-10-02) ⇒ ไม่มีฟอร์มสองชุด
 *   3. **ป้ายรหัสมีสองแบบเท่านั้น** "อัตโนมัติ" (เขียวทุกระดับความมั่นใจ) / "กำหนดเอง" — เจ้าของสั่ง
 *      2026-10-02 ว่าคนต้องตรวจรหัสในหน้าต่างเพิ่มสินค้าก่อนกดยืนยันอยู่แล้ว ⇒ คำเตือน `max_plus_one`
 *      ไปอยู่ที่หน้าต่างนั้น (J6) ไม่ใช่หน้ารายการ
 *
 * ── ทุกแถวไม่เกินสองบรรทัด (เจ้าของสั่ง 2026-10-02) ──────────────────────────
 *   ข้อความยาวถูกตัดด้วย … และอ่านเต็มได้จาก title · แถว model ซ้ำกับ Odoo ใช้บรรทัดที่สองของสถานะ
 *   แสดงรหัสใน Odoo ที่ซ้ำ **แทน** วันที่ส่งออก (วันที่ไปอยู่ใน title) เพราะรหัสนั้นคือของที่ต้องเอาไปแก้
 *
 * ── สิทธิ์ ────────────────────────────────────────────────────────────────
 *   `page.odooproducts` ซึ่ง **คนละช่องกับ `quote.manage_products`** (ใครเพิ่มสินค้าได้ตอนออกใบ)
 *   ⇒ ปิดหน้านี้ให้ใครได้โดยไม่พรากความสามารถนั้นไปด้วย · ด่านจริงอยู่ที่ index.ts
 */

type Status = 'imported' | 'not_imported';
type Group = 'pending' | 'exported' | 'conflict' | 'matched';

interface Row {
  product_template_id: number;
  internal_reference: string;
  parent_reference: string | null;
  ref_tier: 'boundary' | 'max_plus_one' | 'manual';
  rejected_refs: string[];
  model: string;
  name: string;
  sales_price: number;
  minimum_sales_price: number;
  price_source: 'pricebook' | 'manual';
  created_at: string;
  created_by_name: string | null;
  exported_at: string | null;
  odoo_matched_at: string | null;
  status: Status;
  quotation_count: number;
  odoo_model_conflicts: { internal_reference: string | null; name: string | null }[];
}

/**
 * ค่า (`v`) ตรงกับ `LocalProductFilter` ของ server — ห้ามเปลี่ยน · ลำดับ = ลำดับในตัวกรอง · `pending` คือค่าตั้งต้น
 * คำบนจอตามที่เจ้าของสั่ง 2026-10-02 (รอบ 5) ใช้ทั้งตัวกรองและป้ายสถานะ
 */
const GROUPS: { v: Group; t: string; cls: string }[] = [
  { v: 'pending', t: 'ยังไม่ส่งออก', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  { v: 'exported', t: 'รอนำเข้า', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  { v: 'conflict', t: 'รหัสซ้ำ/ไม่ตรง', cls: 'bg-red-50 text-red-700 border-red-200' },
  { v: 'matched', t: 'นำเข้าแล้ว', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
];

const TAG = 'inline-block px-1.5 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap';

/** ป้ายรหัส — สองแบบตามที่เจ้าของสั่ง + ป้ายเหลืองเมื่อ Odoo เคยไม่รับรหัสเดิม (คนละเรื่องกับความมั่นใจ) */
const RefTags: React.FC<{ r: Row }> = ({ r }) => (
  <span className="inline-flex gap-1 align-middle">
    {r.ref_tier === 'manual' ? (
      <span className={`${TAG} bg-blue-50 text-blue-700 border-blue-200`} title="คนกำหนดรหัสนี้เอง">กำหนดเอง</span>
    ) : (
      <span className={`${TAG} bg-emerald-50 text-emerald-700 border-emerald-200`}
            title="ระบบออกรหัสต่อจากรหัสของสินค้ากลุ่มเดียวกันให้">อัตโนมัติ</span>
    )}
    {r.rejected_refs.length > 0 && (
      <span className={`${TAG} bg-amber-50 text-amber-700 border-amber-200`}
            title={`Odoo ไม่ยอมรับรหัสเดิม: ${r.rejected_refs.join(', ')}`}>เคยเปลี่ยนรหัส</span>
    )}
  </span>
);

/** `created_at` เป็น timestamp เต็ม ส่วน formatDate รับเฉพาะ YYYY-MM-DD */
const dayOf = (iso: string | null): string => (iso ? formatDate(iso.slice(0, 10)) : '-');
const baht = (n: number) => `฿${Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** รหัสใน Odoo ที่ model ชนกัน — ไม่มีป้าย = null · แถว Odoo ที่ไม่มีรหัสก็ยังเป็นป้าย (ชนจริง แค่บอกรหัสไม่ได้) */
const conflictOf = (r: Row): string | null => {
  if (r.odoo_matched_at || r.odoo_model_conflicts.length === 0) return null;
  const c = r.odoo_model_conflicts.find((x) => x.internal_reference) ?? r.odoo_model_conflicts[0];
  return c.internal_reference ?? `(ไม่มีรหัส) ${c.name ?? ''}`.trim();
};

/** กลุ่มของแถว — ลำดับเดียวกับ `FILTER_SQL` ฝั่ง server (นำเข้าแล้ว > ซ้ำ > ส่งออกแล้ว > ยังไม่ส่งออก) */
const groupOf = (r: Row): Group =>
  r.odoo_matched_at ? 'matched' : conflictOf(r) ? 'conflict' : r.exported_at ? 'exported' : 'pending';

const StatusTag: React.FC<{ r: Row }> = ({ r }) => {
  const g = GROUPS.find((x) => x.v === groupOf(r))!;
  return <span className={`${TAG} ${g.cls}`}>{g.t}</span>;
};

/** บรรทัดที่สองของสถานะ — วันที่ของกลุ่มนั้น · กลุ่มซ้ำบอกรหัสที่ Odoo ใช้แทน (ของที่ต้องเอาไปแก้) */
const StatusLine2: React.FC<{ r: Row }> = ({ r }) => {
  const line = 'text-[11px] text-slate-400 whitespace-nowrap';
  if (r.odoo_matched_at) return <div className={line}>นำเข้าเมื่อ {dayOf(r.odoo_matched_at)}</div>;
  const c = conflictOf(r);
  if (c) {
    const when = r.exported_at ? `ส่งออกเมื่อ ${dayOf(r.exported_at)}` : 'ยังไม่เคยส่งออก';
    return (
      <div className="text-[11px] text-red-600 whitespace-nowrap" title={`model นี้ซ้ำกับ ${c} ใน Odoo · ${when}`}>
        Odoo ใช้ <span className="font-mono">{c}</span>
      </div>
    );
  }
  if (r.exported_at) return <div className={line}>ส่งออกเมื่อ {dayOf(r.exported_at)}</div>;
  return <div className={line}>เพิ่มเมื่อ {dayOf(r.created_at)}</div>;
};

export const OdooProducts: React.FC = () => {
  const { token } = useAuth();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Group>('pending');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);

  const [delRow, setDelRow] = useState<Row | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const [reissueRow, setReissueRow] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ filter, limit: String(size), offset: String((page - 1) * size) });
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`/api/admin/webquote/products/list?${params}`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setRows(data.items ?? []);
      setTotal(Number(data.total ?? 0));
      setPending(Number(data.pending ?? 0));
      setConflicts(Number(data.conflicts ?? 0));
    } catch (e) {
      setError(errMsg(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, filter, q, page, size]);

  // คำค้นหน่วงไว้ก่อนยิง — ไม่งั้นพิมพ์ model หนึ่งตัว = ยิง query ละตัวอักษร
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(t);
  }, [load]);

  const onExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({ filter, format: 'xlsx' });
      if (q.trim()) params.set('q', q.trim());
      await downloadCsv(
        `/api/admin/webquote/products/export?${params}`,
        token,
        `สินค้าเพิ่มเอง-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      // ส่งออกแล้ว server ประทับ `exported_at` ⇒ โหลดใหม่ให้บรรทัด "ส่งออกไฟล์แล้ว" ตรงความจริง
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setExporting(false);
    }
  };

  const confirmDelete = async () => {
    if (!delRow) return;
    setDelBusy(true);
    setDelError(null);
    try {
      const res = await fetch(`/api/admin/webquote/products/${delRow.product_template_id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // 409 = "มีใบเสนอราคาอ้างอยู่" / "เข้า Odoo แล้ว" — ข้อความของ server อ่านออกอยู่แล้ว
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setDelRow(null);
      await load();
    } catch (e) {
      setDelError(errMsg(e));
    } finally {
      setDelBusy(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / size));

  /** ปุ่มของแต่ละแถว — เหตุผลที่กดไม่ได้อยู่ใน title (กติกาเดียวกับหน้าผู้ติดต่อ) · กติกาจริงอยู่ที่ server */
  const ProductActions: React.FC<{ r: Row }> = ({ r }) => {
    const locked = !!r.odoo_matched_at;
    const used = r.quotation_count > 0;
    const why = locked ? 'นำเข้าแล้ว — ' : used ? `มีใบเสนอราคาใช้สินค้านี้ ${r.quotation_count} ใบ — ` : '';
    return (
      <RowActions>
        <RowAction icon={RefreshCw} label={`ออกรหัสใหม่ ${r.model}`} onClick={() => setReissueRow(r)} disabled={locked || used}
                   title={locked || used ? `${why}ออกรหัสใหม่ไม่ได้` : 'Odoo ไม่ยอมรับรหัสนี้ → ออกรหัสใหม่'} />
        <RowAction icon={Trash2} label={`ลบ ${r.model}`} tone="danger" onClick={() => { setDelError(null); setDelRow(r); }}
                   disabled={locked || used} title={locked || used ? `${why}ลบไม่ได้` : 'ลบสินค้า'} />
      </RowActions>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={PackageOpen}
        title="สินค้าเพิ่มเอง"
        description={`${formatNumber(pending)} รายการยังไม่มีใน Odoo · สถานะระบบตรวจให้เอง`}
      >
        <Button
          icon={Download}
          onClick={() => void onExport()}
          disabled={exporting || total === 0}
          aria-label={`ส่งออก xlsx ${formatNumber(total)} รายการ`}
          className="shrink-0"
        >
          {exporting ? 'กำลังสร้างไฟล์…' : <span className="hidden sm:inline">{`ส่งออก xlsx (${formatNumber(total)} รายการ)`}</span>}
        </Button>
      </PageHeader>

      {/* แถบแจ้งเตือนอยู่เหนือตัวกรองด้วยกันทั้งหมด และบรรทัดเดียว (เจ้าของสั่ง 2026-10-02) —
          จอแคบตัดด้วย … แล้วอ่านเต็มจาก title */}
      <div className="space-y-2">
        <div
          className="flex items-center gap-2 px-4 py-2 rounded-2xl border border-blue-200 bg-blue-50 text-xs text-blue-800"
          title="ส่งออกไฟล์ → คีย์เข้า Odoo ด้วยรหัสตามไฟล์ → ระบบเปลี่ยนเป็น “นำเข้าแล้ว” ให้เองในรอบดึงข้อมูลถัดไป"
        >
          <Info className="w-4 h-4 shrink-0" />
          <p className="truncate min-w-0">
            ส่งออกไฟล์ → คีย์เข้า Odoo <b>ด้วยรหัสตามไฟล์</b> → ระบบเปลี่ยนเป็น “นำเข้าแล้ว” ให้เองในรอบดึงข้อมูลถัดไป
          </p>
        </div>
        {/* model ซ้ำกับ Odoo ที่รหัสอื่น — กลุ่มเดียวที่ปล่อยไว้แล้วค้างตลอดกาล (แผน §8.4: เตือนอย่างเดียว ไม่แปลงอะไร)
            นับจาก server ทุกกลุ่ม (แถวพวกนี้อยู่แต่ในกลุ่มของตัวเอง) · กดแล้วเปิดกลุ่มนั้น · ซ่อนเมื่อเปิดกลุ่มนั้นอยู่แล้ว */}
        {conflicts > 0 && filter !== 'conflict' && (
          <button
            type="button"
            onClick={() => { setFilter('conflict'); setPage(1); }}
            className="w-full flex items-center gap-2 px-4 py-2 rounded-2xl border border-red-200 bg-red-50 text-xs text-red-700 text-left hover:bg-red-100 transition-colors"
            title="model ซ้ำกับสินค้าใน Odoo แต่รหัสไม่ตรง — น่าจะคีย์เข้าไปด้วยรหัสอื่น แก้รหัสใน Odoo ให้ตรงกับหน้านี้"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="truncate min-w-0">
              <b>{formatNumber(conflicts)} รายการ model ซ้ำกับ Odoo แต่รหัสไม่ตรง</b> — แก้รหัสใน Odoo ให้ตรงกับหน้านี้ · <u>ดูรายการ</u>
            </span>
          </button>
        )}
      </div>

      <div className="bg-card border border-slate-200 rounded-2xl px-4 sm:px-5 py-3.5 shadow-sm">
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(200px,280px)]">
          <DataSearch
            value={q}
            onChange={(v) => { setQ(v); setPage(1); }}
            placeholder="ค้นหา รหัสสินค้า / model / ชื่อสินค้า"
          />
          <select
            aria-label="สถานะ"
            value={filter}
            onChange={(e) => { setFilter(e.target.value as Group); setPage(1); }}
            className={inputCls}
          >
            {GROUPS.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
          </select>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      <TableCard
        title={`${formatNumber(total)} รายการ`}
        hint="ไฟล์ที่ส่งออก = รายการในกลุ่มที่เลือกอยู่"
      >
        {loading ? (
          <SkeletonRows rows={8} />
        ) : error ? (
          <EmptyState
            icon={PackageOpen}
            title="ยังไม่ได้ข้อมูลมาแสดง"
            hint="กดปุ่ม “ลองใหม่” ด้านบน — ตารางจะกลับมาเมื่อโหลดสำเร็จ"
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={q ? 'ไม่มีรายการที่ตรงกับคำค้นในกลุ่มนี้' : `ไม่มีสินค้าในกลุ่ม “${GROUPS.find((g) => g.v === filter)!.t}”`}
            hint={q ? 'คำค้นหาเฉพาะในกลุ่มที่เลือก — ลองเปลี่ยนกลุ่ม หรือค้นด้วยรหัสสินค้าแทน model' : 'ลองเปลี่ยนกลุ่มที่ตัวกรองด้านบน'}
          />
        ) : (
          <>
            {/* ── จอทำงาน: ตาราง · ทุกแถวไม่เกินสองบรรทัด ───────────── */}
            <div className="hidden sm:block">
              <TableScroll>
                <table className="w-full text-sm">
                  <thead>
                    <tr className={theadRowCls}>
                      {/* รหัสสินค้าเป็นคอลัมน์แรก · สถานะอยู่ชิดปุ่มจัดการ (เจ้าของสั่ง 2026-10-02) */}
                      <th className={thCls}>รหัสสินค้า</th>
                      <th className={thCls}>สินค้า</th>
                      <th className={`${thCls} text-right`}>ราคาขาย</th>
                      <th className={`${thCls} hidden xl:table-cell`}>เพิ่มเมื่อ</th>
                      <th className={`${thCls} text-right`}>ใบ</th>
                      <th className={thCls}>สถานะ</th>
                      <th className={`${thCls} text-right`}>การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <tr key={r.product_template_id} className="hover:bg-slate-50 transition-colors">
                        <td className={tdCls}>
                          <div className="font-mono text-xs font-semibold text-[var(--brand-fg)] whitespace-nowrap">
                            {r.internal_reference}
                          </div>
                          <div className="whitespace-nowrap"><RefTags r={r} /></div>
                        </td>
                        <td className={tdCls}>
                          <div className="font-medium text-slate-800 max-w-[220px] truncate" title={r.model}>{r.model}</div>
                          <div className="text-[11px] text-slate-400 max-w-[220px] truncate" title={r.name}>{r.name}</div>
                        </td>
                        <td className={`${tdCls} text-right whitespace-nowrap`}>
                          <div className="font-semibold text-slate-800 tabular-nums">{baht(r.sales_price)}</div>
                          <div className="text-[11px] text-slate-400 tabular-nums">
                            ขั้นต่ำ {baht(r.minimum_sales_price)} · {r.price_source === 'pricebook' ? 'สมุดราคา' : 'ตั้งเอง'}
                          </div>
                        </td>
                        <td className={`${tdCls} hidden xl:table-cell whitespace-nowrap`}>
                          <div className="text-slate-600 text-xs">{dayOf(r.created_at)}</div>
                          <div className="text-[11px] text-slate-400">{r.created_by_name ?? '—'}</div>
                        </td>
                        <td className={`${tdCls} text-right tabular-nums text-slate-600`}>
                          {r.quotation_count > 0 ? r.quotation_count : <span className="text-slate-400">—</span>}
                        </td>
                        <td className={tdCls}>
                          <StatusTag r={r} />
                          <StatusLine2 r={r} />
                        </td>
                        <td className={`${tdCls} text-right`}><ProductActions r={r} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </div>

            {/* ── มือถือ: การ์ดสองบรรทัด — ปุ่มอยู่ขวาคร่อมทั้งสองบรรทัด ─────── */}
            <div className="sm:hidden divide-y divide-slate-100">
              {rows.map((r) => (
                <div key={r.product_template_id}
                     className="px-4 py-2.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-1 items-center">
                  <div className="truncate">
                    <span className="font-mono text-xs font-semibold text-[var(--brand-fg)]">{r.internal_reference}</span>{' '}
                    <RefTags r={r} />
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <span title={conflictOf(r) ? `model นี้ซ้ำกับ ${conflictOf(r)} ใน Odoo` : undefined}><StatusTag r={r} /></span>
                  </div>
                  <div className="truncate text-[13px] text-slate-800" title={r.name}>
                    {r.model} <span className="text-[11px] text-slate-400">· {baht(r.sales_price)}</span>
                  </div>
                  <div className="text-right"><ProductActions r={r} /></div>
                </div>
              ))}
            </div>

            <Pagination
              page={page}
              pages={pages}
              size={size}
              total={total}
              unit="รายการ"
              onPage={setPage}
              onSize={(s) => { setSize(s); setPage(1); }}
            />
          </>
        )}
      </TableCard>

      {reissueRow && (
        <ReissueRefModal
          row={reissueRow}
          authHeaders={authHeaders}
          onClose={() => setReissueRow(null)}
          onDone={() => { setReissueRow(null); void load(); }}
        />
      )}

      {delRow && (
        <Modal
          icon={Trash2}
          tone="danger"
          title="ลบสินค้าที่เพิ่มเอง"
          onClose={delBusy ? undefined : () => { setDelRow(null); setDelError(null); }}
          footer={
            <>
              <Button variant="neutral" disabled={delBusy} onClick={() => { setDelRow(null); setDelError(null); }}>
                ยกเลิก
              </Button>
              <Button variant="danger" icon={Trash2} busy={delBusy} onClick={() => void confirmDelete()}>
                ลบ
              </Button>
            </>
          }
        >
          <div className="p-5 space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="font-medium text-slate-800 text-sm">{delRow.model}</div>
              <div className="font-mono text-xs text-[var(--brand-fg)] font-semibold">{delRow.internal_reference}</div>
            </div>
            <p className="text-xs text-slate-500">
              สินค้าจะหายจากการค้นหาตอนออกใบทันที รวมฝั่ง LINE และรหัสนี้จะว่างให้ใช้ใหม่ได้
              <br />
              ถ้ามีใบเสนอราคาใช้สินค้านี้อยู่ ระบบจะไม่ยอมให้ลบ
            </p>
            {delError && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 whitespace-pre-wrap">
                {delError}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

/**
 * กล่อง "ออกรหัสใหม่" — ใช้เมื่อ Odoo ไม่ยอมรับรหัสเดิมตอนคีย์ (ชนกับสินค้าที่ archive ซึ่งเรามองไม่เห็น · แผน §1.5)
 *
 * รหัสที่โชว์เป็น **พรีวิวจาก `GET /next-ref` ไม่ใช่การจอง** — server คำนวณใหม่อีกรอบใต้ล็อกตอนกดยืนยัน
 * ⇒ รหัสที่ได้จริงอยู่ในคำตอบของ `POST /:id/reissue-ref` · พรีวิวใช้ฐานเดียวกับ server
 * (`parent_reference ?? internal_reference`) และรหัสปัจจุบันนับเป็นพี่น้องอยู่แล้วจึงไม่มีทางได้ตัวเดิม
 */
const ReissueRefModal: React.FC<{
  row: Row;
  authHeaders: Record<string, string>;
  onClose: () => void;
  onDone: () => void;
}> = ({ row, authHeaders, onClose, onDone }) => {
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [manual, setManual] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = row.parent_reference ?? row.internal_reference;
        const res = await fetch(`/api/admin/webquote/products/next-ref?parent=${encodeURIComponent(base)}`, { headers: authHeaders });
        const data = await res.json().catch(() => ({}));
        const ref: string | null = res.ok ? (data?.ref?.internal_reference ?? null) : null;
        if (cancelled) return;
        setPreview(ref);
        // ระบบออกให้ไม่ได้ (เลขท้ายคือเลขรุ่น) ⇒ เปิดช่องพิมพ์เองให้เลย ไม่ปล่อยให้กดยืนยันแล้วค่อยเจอ 409
        if (!ref) setManual(true);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [row, authHeaders]);

  const cleaned = typed.trim().toUpperCase();
  const typedOk = /^[A-Z0-9]{14}$/.test(cleaned);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/webquote/products/${row.product_template_id}/reissue-ref`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(manual ? { ref_manual: true, internal_reference: cleaned } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      icon={RefreshCw}
      title={<>ออกรหัสใหม่ให้ <span className="font-mono">{row.model}</span></>}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="neutral" disabled={busy} onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" icon={RefreshCw} busy={busy}
                  disabled={previewLoading || (manual ? !typedOk : !preview)}
                  onClick={() => void submit()}>
            ออกรหัสใหม่
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-3 text-sm text-slate-700">
        <p className="text-xs text-slate-500">
          ใช้เมื่อคีย์เข้า Odoo แล้ว <b className="text-slate-700">Odoo ไม่ยอมรับรหัสนี้</b> เช่นมีสินค้าเก่าที่ถูกซ่อนไว้ใช้รหัสนี้อยู่แล้ว
          ระบบจะจำไว้ว่ารหัสเดิมห้ามใช้อีก
        </p>

        <label className={`flex items-start gap-2 ${preview ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
          <input type="radio" name="reissue" className="mt-1" checked={!manual} disabled={!preview}
                 onChange={() => setManual(false)} />
          <span className="min-w-0">
            ให้ระบบออกรหัสถัดไปให้
            <span className="mt-1.5 flex items-center gap-2 flex-wrap font-mono text-xs">
              <span className="line-through text-slate-400">{row.internal_reference}</span>
              <span className="text-slate-400">→</span>
              {previewLoading ? <span className="text-slate-400">กำลังหา…</span>
                : preview ? <span className="font-semibold text-[var(--brand-fg)]">{preview}</span>
                  : <span className="font-sans text-amber-700">ระบบออกรหัสถัดไปให้ไม่ได้ — กรุณากำหนดรหัสเอง</span>}
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input type="radio" name="reissue" className="mt-1" checked={manual} onChange={() => setManual(true)} />
          <span className="min-w-0 flex-1">
            กำหนดรหัสเอง <span className="text-xs text-slate-400">(ตัวอักษร A–Z หรือตัวเลข รวม 14 ตัว)</span>
            {manual && (
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                maxLength={20}
                placeholder={row.internal_reference}
                className={`${inputCls} mt-1.5 font-mono uppercase`}
                aria-label="รหัสสินค้าใหม่"
              />
            )}
          </span>
        </label>

        <p className="text-xs text-slate-500">
          สินค้านี้จะกลับไปอยู่กลุ่ม “ยังไม่ส่งออก” เพราะต้องเอารหัสใหม่ไปคีย์อีกรอบ
        </p>
        {err && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 whitespace-pre-wrap">{err}</p>
        )}
      </div>
    </Modal>
  );
};
