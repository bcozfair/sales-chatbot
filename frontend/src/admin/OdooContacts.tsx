import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { UserPlus, Download, Pencil, Trash2, Phone, Mail, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from './PageHeader';
import { DataSearch } from './DataFilterBar';
import { TableCard, TableScroll, Pagination, EmptyState, SkeletonRows, ErrorBox } from './logs/ui';
import { errMsg, formatNumber, formatDate, thCls, tdCls, inputCls, downloadCsv } from './logs/format';
import { LocalContactModal, DeleteContactModal } from './LocalContactModal';

/**
 * หน้า "ผู้ติดต่อที่ต้องคีย์เข้า Odoo" — คิวงานค้างของโมดูล `local_contacts` (แผน §5.2)
 *
 * ── หน้านี้มีอยู่เพื่ออะไร ────────────────────────────────────────────────
 *   แอดมินเพิ่มผู้ติดต่อเองได้ตั้งแต่ก้อน I3 และออกใบให้เขาได้ทันที **แต่คนคนนั้นยังไม่มีตัวตน
 *   ใน Odoo** ⇒ ใบที่อ้างถึงเขาจะตกตอนนำเข้า · ก่อนมีหน้านี้ไม่มีอะไรบอกใครเลยว่ามีกี่คนค้าง
 *   และไม่มีทางเอารายชื่อออกไปคีย์ · **ปุ่มหลักของหน้าคือปุ่มดาวน์โหลดไฟล์** ไม่ใช่ตาราง
 *
 * ── สองอย่างที่หน้านี้จงใจ "ไม่มี" ────────────────────────────────────────
 *   1. **ไม่มีปุ่มติ๊กว่า "คีย์เข้า Odoo แล้ว"** — ระบบตรวจเองท้ายรอบ sync (§6) เพราะคนที่คีย์ชื่อ
 *      ผิดแล้วกดติ๊ก จะทำให้ระบบเชื่อว่าพร้อม แล้วปล่อยใบเข้าไฟล์ปกติไปตกที่ Odoo เงียบ ๆ
 *   2. **ไม่มีสถานะ "ค้างนาน"** (เจ้าของเคาะ 2026-09-21) — "ค้าง 3 วัน" กับ "ค้าง 30 วัน"
 *      สั่งให้ทำสิ่งเดียวกันเป๊ะ คือเอาไปคีย์ · คนที่อยากไล่ของเก่าเรียงจากคอลัมน์ "เพิ่มเมื่อ" ได้
 *
 * ── ป้าย 🔴 "ชื่อไม่ตรง" คือของที่มีค่าที่สุดในหน้านี้ ──────────────────────
 *   คนกลุ่มนี้ **ถูกคีย์เข้า Odoo ไปแล้วจริง** แต่สะกดไม่เหมือนกัน ⇒ ทั้งสองสัญญาณของ
 *   `reconcileLocalContactOdooLinks()` จับคู่ไม่ได้ แถวค้างอยู่ตลอดกาล และใบของเขาตกทุกครั้ง
 *   โดยไม่มีใครเดาสาเหตุถูก · หน้านี้จึงชี้ชื่อที่ชนให้ดูตรง ๆ (`similar_odoo_name` จาก server)
 *
 * ── สิทธิ์ ────────────────────────────────────────────────────────────────
 *   `page.odoocontacts` ซึ่ง **คนละช่องกับ `quote.manage_contacts`** ที่คุมว่าใครเพิ่มผู้ติดต่อ
 *   ตอนออกใบได้ — เจ้าของปิดหน้านี้ให้ใครได้โดยไม่พรากความสามารถนั้นไปด้วย
 */

type Status = 'matched' | 'pending' | 'name_mismatch';
type Filter = 'not_matched' | 'pending' | 'name_mismatch' | 'matched' | 'all';

interface Row {
  contact_id: number;
  company_id: number;
  contact_name: string;
  job_position: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  created_at: string;
  odoo_matched_at: string | null;
  customer_name: string | null;
  customer_reference: string | null;
  customer_tax_id: string | null;
  created_by_name: string | null;
  quote_count: number;
  similar_odoo_name: string | null;
  status: Status;
  can_edit_fields: boolean;
  can_delete: boolean;
}

/** ป้ายสถานะ — ข้อความกับสีอยู่ที่เดียว ใช้ทั้งตารางและการ์ดมือถือ */
const STATUS: Record<Status, { text: string; cls: string }> = {
  // เหลืองเหมือนป้ายรอดำเนินการของใบเสนอราคา (เจ้าของเลือก 2026-09-21)
  pending: { text: 'รอนำเข้า', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  name_mismatch: { text: 'ชื่อไม่ตรง', cls: 'bg-red-50 text-red-700 border-red-200' },
  matched: { text: 'เข้า Odoo แล้ว', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

const FILTER_LABEL: { v: Filter; t: string }[] = [
  { v: 'not_matched', t: 'ยังไม่เข้า Odoo (ทุกแบบ)' },
  { v: 'pending', t: 'รอนำเข้า' },
  { v: 'name_mismatch', t: 'ชื่อไม่ตรง' },
  { v: 'matched', t: 'เข้า Odoo แล้ว' },
  { v: 'all', t: 'ทั้งหมด' },
];

const StatusTag: React.FC<{ s: Status }> = ({ s }) => (
  <span className={`inline-block px-1.5 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap ${STATUS[s].cls}`}>
    {STATUS[s].text}
  </span>
);

/** `created_at` เป็น timestamp เต็ม ส่วน formatDate รับเฉพาะ YYYY-MM-DD */
const dayOf = (iso: string | null): string => (iso ? formatDate(iso.slice(0, 10)) : '-');

export const OdooContacts: React.FC = () => {
  const { token } = useAuth();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('not_matched');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);

  /** แถวที่กำลังแก้ · แถวที่กำลังจะลบ — สองกล่องนี้ยืมมาจากหน้าขอใบเสนอราคาทั้งดุ้น */
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [delRow, setDelRow] = useState<Row | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        filter,
        limit: String(size),
        offset: String((page - 1) * size),
      });
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`/api/admin/webquote/contacts/list?${params}`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setRows(data.items ?? []);
      setTotal(Number(data.total ?? 0));
      setPending(Number(data.pending ?? 0));
    } catch (e) {
      setError(errMsg(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, filter, q, page, size]);

  // คำค้นหน่วงไว้ก่อนยิง — ไม่งั้นพิมพ์ชื่อบริษัทหนึ่งชื่อ = ยิง query ละแถวละตัวอักษร
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
        `/api/admin/webquote/contacts/export?${params}`,
        token,
        `ผู้ติดต่อใหม่-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
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
      const res = await fetch(`/api/admin/webquote/contacts/${delRow.contact_id}`, {
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
  const mismatches = rows.filter((r) => r.status === 'name_mismatch').length;

  /** ปุ่มแก้/ลบของแต่ละแถว — เหตุผลที่กดไม่ได้อยู่ใน title ไม่ใช่ปุ่มจาง ๆ ที่ไม่มีคำอธิบาย */
  const RowActions: React.FC<{ r: Row }> = ({ r }) => (
    <div className="inline-flex gap-1">
      <button
        onClick={() => setEditRow(r)}
        disabled={!r.can_edit_fields}
        aria-label={`แก้ไข ${r.contact_name}`}
        title={r.can_edit_fields ? 'แก้ไขผู้ติดต่อ' : 'เข้า Odoo แล้ว — แก้ที่ Odoo แทน'}
        className="w-7 h-7 rounded-lg border border-slate-200 bg-card text-slate-500 grid place-items-center
                   hover:border-[var(--brand-border)] hover:text-[var(--brand-fg)] disabled:opacity-30
                   disabled:cursor-not-allowed transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => { setDelError(null); setDelRow(r); }}
        disabled={!r.can_delete}
        aria-label={`ลบ ${r.contact_name}`}
        title={r.can_delete
          ? 'ลบผู้ติดต่อ'
          : r.status === 'matched' ? 'เข้า Odoo แล้ว — ลบไม่ได้' : `มีใบเสนอราคาอ้างอยู่ ${r.quote_count} ใบ`}
        className="w-7 h-7 rounded-lg border border-slate-200 bg-card text-slate-500 grid place-items-center
                   hover:border-red-200 hover:text-red-600 hover:bg-red-50 disabled:opacity-30
                   disabled:cursor-not-allowed transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon={UserPlus}
        title="ผู้ติดต่อที่ต้องคีย์เข้า Odoo"
        description={`${formatNumber(pending)} คนยังไม่มีใน Odoo · สถานะระบบตรวจให้เอง`}
      >
        <button
          onClick={() => void onExport()}
          disabled={exporting || total === 0}
          className="btn-h px-3 rounded-lg border border-slate-200 bg-card text-xs font-semibold text-slate-600
                     hover:border-[var(--brand-border)] hover:text-[var(--brand-fg)] disabled:opacity-40
                     flex items-center gap-1.5 shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          {exporting ? 'กำลังสร้างไฟล์…' : <>ดาวน์โหลด xlsx<span className="hidden sm:inline">{` (${formatNumber(total)} คน)`}</span></>}
        </button>
      </PageHeader>

      {/* วิธีใช้ — คนเปิดหน้านี้ครั้งแรกต้องรู้ว่า "แล้วยังไงต่อ" โดยไม่ต้องถามใคร */}
      <div className="flex items-start gap-2 px-4 py-3 rounded-2xl border border-blue-200 bg-blue-50 text-xs text-blue-800">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          กดดาวน์โหลดไฟล์ → เปิดแล้วคีย์เข้า Odoo ทีละคน → รอบซิงก์ถัดไประบบจะเห็นเองว่าใครเข้าไปแล้ว
          แล้วย้ายออกจากรายการนี้ให้ <span className="text-blue-600">(ไม่ต้องกลับมากดอะไรที่นี่อีก)</span>
        </p>
      </div>

      {/* ตัวกรองมีแค่สองช่อง จึงกางไว้ทั้งคู่เสมอ ไม่ใช้ DataFilterBar ที่พับตัวกรองรองบนมือถือ —
          ช่องสถานะคือตัวที่คนใช้บ่อยที่สุดของหน้านี้ ซ่อนไว้หลังปุ่ม "ตัวกรองเพิ่มเติม" ไม่ได้ */}
      <div className="bg-card border border-slate-200 rounded-2xl px-4 sm:px-5 py-3.5 shadow-sm">
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(200px,280px)]">
          <DataSearch
            value={q}
            onChange={(v) => { setQ(v); setPage(1); }}
            placeholder="ค้นหา ชื่อผู้ติดต่อ / บริษัท / รหัสลูกค้า / เลขภาษี"
          />
          <select
            aria-label="สถานะ"
            value={filter}
            onChange={(e) => { setFilter(e.target.value as Filter); setPage(1); }}
            className={inputCls}
          >
            {FILTER_LABEL.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
          </select>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      {/* แถบเตือนของกลุ่มที่ "มีคนคีย์ให้แล้วแต่ชื่อไม่ตรง" — กลุ่มเดียวที่ปล่อยไว้แล้วค้างตลอดกาล */}
      {!loading && mismatches > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-2xl border border-red-200 bg-red-50 text-xs text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <b>{mismatches} คนในหน้านี้น่าจะถูกคีย์เข้า Odoo แล้ว แต่สะกดชื่อไม่ตรงกัน</b> —
            ระบบจึงยังจับคู่ให้ไม่ได้ และใบของเขาจะยังไปตกตอนนำเข้า
            {' '}แก้ชื่อฝั่งเราให้ตรงกับ Odoo แล้วรอบซิงก์ถัดไปจะจับคู่เอง
          </p>
        </div>
      )}

      <TableCard
        title={`${formatNumber(total)} คน`}
        hint={filter === 'not_matched'
          ? 'ค่าตั้งต้น = เฉพาะคนที่ยังไม่มีใน Odoo · ไฟล์ที่ดาวน์โหลดตามตัวกรองนี้เหมือนกัน'
          : 'ไฟล์ที่ดาวน์โหลดตามตัวกรองที่เลือกอยู่'}
      >
        {loading ? (
          <SkeletonRows rows={8} />
        ) : error ? (
          <EmptyState
            icon={UserPlus}
            title="ยังไม่ได้ข้อมูลมาแสดง"
            hint="กดปุ่ม “ลองใหม่” ด้านบน — ตารางจะกลับมาเมื่อโหลดสำเร็จ"
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={q || filter !== 'not_matched' ? 'ไม่มีรายการที่ตรงกับตัวกรองนี้' : 'ไม่มีใครค้างอยู่เลย'}
            hint={q || filter !== 'not_matched'
              ? 'ลองเปลี่ยนสถานะเป็น “ทั้งหมด” หรือค้นด้วยรหัสลูกค้าแทนชื่อ'
              : 'ผู้ติดต่อที่แอดมินเพิ่มเองเข้า Odoo ครบแล้วทุกคน'}
          />
        ) : (
          <>
            {/* ── จอทำงาน: ตาราง ─────────────────────────────── */}
            <div className="hidden sm:block">
              <TableScroll>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className={thCls}>สถานะ</th>
                      <th className={thCls}>บริษัท</th>
                      <th className={thCls}>ผู้ติดต่อ</th>
                      <th className={`${thCls} hidden lg:table-cell`}>ติดต่อ</th>
                      <th className={`${thCls} hidden xl:table-cell`}>เพิ่มเมื่อ</th>
                      <th className={`${thCls} text-right`}>ใบที่อ้าง</th>
                      <th className={`${thCls} text-right`}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <tr key={r.contact_id} className="hover:bg-slate-50 transition-colors">
                        <td className={tdCls}>
                          <StatusTag s={r.status} />
                          {r.similar_odoo_name && (
                            <div className="text-[11px] text-red-600 mt-1 max-w-[150px] truncate"
                                 title={r.similar_odoo_name}>
                              คล้าย “{r.similar_odoo_name}”
                            </div>
                          )}
                        </td>
                        <td className={tdCls}>
                          <div className="font-medium text-slate-800 max-w-[240px] truncate">
                            {r.customer_name ?? <span className="text-slate-400">—</span>}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            <span className="font-mono text-[var(--brand-fg)] font-semibold">{r.customer_reference ?? '—'}</span>
                            {r.customer_tax_id && <span className="hidden xl:inline"> · <span className="font-mono">{r.customer_tax_id}</span></span>}
                          </div>
                        </td>
                        <td className={tdCls}>
                          <div className="font-medium text-slate-800">{r.contact_name}</div>
                          {r.job_position && <div className="text-[11px] text-slate-400">{r.job_position}</div>}
                        </td>
                        <td className={`${tdCls} hidden lg:table-cell`}>
                          {r.contact_phone && (
                            <div className="text-[11px] text-slate-500 flex items-center gap-1">
                              <Phone className="w-2.5 h-2.5 text-slate-400" />{r.contact_phone}
                            </div>
                          )}
                          {r.contact_email && (
                            <div className="text-[11px] text-slate-400 flex items-center gap-1">
                              <Mail className="w-2.5 h-2.5" />{r.contact_email}
                            </div>
                          )}
                          {!r.contact_phone && !r.contact_email && <span className="text-slate-400">—</span>}
                        </td>
                        <td className={`${tdCls} hidden xl:table-cell`}>
                          <div className="text-slate-600 text-xs">{dayOf(r.created_at)}</div>
                          {r.created_by_name && <div className="text-[11px] text-slate-400">{r.created_by_name}</div>}
                        </td>
                        <td className={`${tdCls} text-right tabular-nums text-slate-600`}>
                          {r.quote_count > 0 ? r.quote_count : <span className="text-slate-400">—</span>}
                        </td>
                        <td className={`${tdCls} text-right`}><RowActions r={r} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </div>

            {/* ── มือถือ: การ์ด ──────────────────────────────────
                ตาราง 7 คอลัมน์ที่ย่อลงมาเฉย ๆ คือตารางที่อ่านไม่ออก (AGENTS.md A9) */}
            <div className="sm:hidden divide-y divide-slate-100">
              {rows.map((r) => (
                <div key={r.contact_id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <StatusTag s={r.status} />
                    <span className="ml-auto text-[11px] text-slate-400">{dayOf(r.created_at)}</span>
                  </div>
                  <div className="font-medium text-slate-800 text-sm mt-1.5">{r.contact_name}</div>
                  {r.job_position && <div className="text-[11px] text-slate-400">{r.job_position}</div>}
                  <div className="text-xs text-slate-500 mt-1">
                    {r.customer_name ?? '—'}{' '}
                    <span className="font-mono text-[11px] text-[var(--brand-fg)] font-semibold">{r.customer_reference ?? ''}</span>
                  </div>
                  {r.contact_phone && (
                    <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                      <Phone className="w-2.5 h-2.5" />{r.contact_phone}
                    </div>
                  )}
                  {r.contact_email && (
                    <div className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Mail className="w-2.5 h-2.5" />{r.contact_email}
                    </div>
                  )}
                  {r.similar_odoo_name && (
                    <p className="mt-2 px-2.5 py-2 rounded-xl border border-red-200 bg-red-50 text-[11px] text-red-700 leading-relaxed">
                      ใน Odoo มีชื่อคล้ายกันว่า <b>{r.similar_odoo_name}</b> — ถ้าคนเดียวกัน ให้แก้ชื่อฝั่งเราให้ตรง
                    </p>
                  )}
                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400">
                      {r.quote_count > 0 ? `มีใบอ้างอยู่ ${r.quote_count} ใบ` : 'ยังไม่มีใบอ้างถึง'}
                    </span>
                    <RowActions r={r} />
                  </div>
                </div>
              ))}
            </div>

            <Pagination
              page={page}
              pages={pages}
              size={size}
              total={total}
              unit="คน"
              onPage={setPage}
              onSize={(s) => { setSize(s); setPage(1); }}
            />
          </>
        )}
      </TableCard>

      {editRow && (
        <LocalContactModal
          editId={editRow.contact_id}
          companyId={editRow.company_id}
          companyName={editRow.customer_name ?? ''}
          companyRef={editRow.customer_reference}
          authHeaders={authHeaders}
          onClose={() => setEditRow(null)}
          /* หน้านี้ไม่มี "ใบ" ให้เลือกคนลง — บันทึกเสร็จแค่ปิดกล่องแล้วโหลดรายการใหม่ */
          onPicked={() => { setEditRow(null); void load(); }}
        />
      )}

      {delRow && (
        <DeleteContactModal
          contactName={delRow.contact_name}
          companyName={delRow.customer_name ?? ''}
          busy={delBusy}
          error={delError}
          onCancel={() => { setDelRow(null); setDelError(null); }}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
};
