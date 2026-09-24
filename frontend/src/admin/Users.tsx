import React, { useState, useEffect, useMemo } from 'react';
import { useAuth, type Role } from '../context/AuthContext';
import {
  Users as UsersIcon,
  Plus,
  Edit2,
  Trash2,
  KeyRound,
  Shield,
  ShieldCheck,
  BadgeCheck,
  FileText,
  UserCheck,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Search,
  X,
} from 'lucide-react';
import { PageHeader } from './PageHeader';
import { FilterBar, FilterSearch, FilterSelect } from './FilterBar';
import { EmptyState, Pagination } from './logs/ui';
import { ROLE_ORDER, ROLE_LABEL, ROLE_DESCRIPTION } from './roles';
import { IssuerNameField, type IssuerNameOption } from './IssuerNameField';

const BRAND = 'var(--brand-fg)';
const MIN_PASSWORD_LENGTH = 8;

/** role ที่ "ชื่อผู้เสนอราคาบนใบ" มีความหมาย — เซลส์/บัญชีทั่วไปเดินเส้นอื่น (§13.3/§13.5) */
const ISSUER_IDENTITY_ROLES: Role[] = ['admin', 'approver', 'subadmin'];

/**
 * role ที่ช่อง "ชื่อ-นามสกุล" กางรายชื่อจาก Odoo ให้เลือก — `user` เป็นช่องพิมพ์ล้วน
 * เพราะบัญชีกลุ่มนั้นตั้งชื่อเป็นสาขา ไม่ใช่ชื่อคน (วัด 2026-09-23: "สาขาปทุมธานี" ฯลฯ 4 บัญชี)
 */
const NAME_FROM_LIST_ROLES: Role[] = ['admin', 'approver', 'subadmin', 'salesperson'];

/** คำอธิบายใต้ช่องชื่อ — ช่องเดียวทำงานคนละอย่างตาม role จึงต้องบอกให้ตรงว่าอันนี้ไปไหนต่อ */
const NAME_HINT: Record<Role, string> = {
  admin: 'ถ้าชื่อตรงกับรายชื่อจาก Odoo ระบบจะใช้เป็นชื่อผู้เสนอราคาบนใบให้ด้วย',
  approver: 'ชื่อนี้จะพิมพ์ลงช่องผู้เสนอราคาของใบและไฟล์ export',
  subadmin: 'ชื่อนี้จะพิมพ์ลงช่องผู้เสนอราคาของใบและไฟล์ export',
  salesperson: 'รหัสพนักงานขายจะผูกให้อัตโนมัติจากชื่อที่เลือก',
  user: 'ชื่อที่แสดงในระบบ — บัญชีนี้ไม่ออกใบจึงไม่ต้องมีชื่อบนใบ',
};

/** ส่วนต่อท้ายป้ายชื่อช่อง — บอกว่าช่องนี้ทำหน้าที่ที่สองอะไรอยู่ */
const NAME_LABEL_SUFFIX: Partial<Record<Role, string>> = {
  approver: 'ใช้เป็นชื่อผู้เสนอราคาบนใบด้วย',
  subadmin: 'ใช้เป็นชื่อผู้เสนอราคาบนใบด้วย',
  salesperson: 'เลือกจากพนักงานขายในระบบ',
};

/** รหัสผ่านตั้งต้นที่เติมให้ตอนเปิดกล่อง — เปิดบัญชีทีละหลายสิบใบจะได้ไม่ต้องพิมพ์ซ้ำ */
const DEFAULT_PASSWORD = '@primus123';

interface AdminUserRow {
  id: number;
  username: string;
  name: string;
  role: Role;
  employee_quotation_id: string | null;
  employee_quotation_phone: string | null;
  salesperson_ids: string[];
  created_at: string;
  updated_at: string;
}

// ชื่อ/คำอธิบาย/ลำดับของ role อยู่ที่ roles.ts ที่เดียว — หน้านี้กับหน้า "สิทธิ์ตามบทบาท"
// ต้องเรียก role ด้วยคำเดียวกัน ไม่งั้นคนใช้จะนึกว่าเป็นคนละอย่างกัน (docs/design.md ข้อ 4)

/** สีและไอคอนของป้ายสิทธิ์ในตาราง — แยกเป็น map เพื่อไม่ต้องไล่แก้ ternary ทุกครั้งที่เพิ่ม role */
const ROLE_BADGE: Record<Role, { className: string; Icon: typeof Shield }> = {
  admin: { className: 'bg-emerald-50 border-emerald-200 text-emerald-700', Icon: ShieldCheck },
  approver: { className: 'bg-violet-50 border-violet-200 text-violet-700', Icon: BadgeCheck },
  subadmin: { className: 'bg-sky-50 border-sky-200 text-sky-700', Icon: FileText },
  // amber วัดแล้ว 9.72 (มืด) / 4.84 (สว่าง) — ผ่านเกณฑ์ 4.5 ทั้งสองธีม และไม่ชนสีของ role อื่น
  salesperson: { className: 'bg-amber-50 border-amber-200 text-amber-700', Icon: UserCheck },
  user: { className: 'bg-slate-50 border-slate-200 text-slate-500', Icon: Shield },
};

/**
 * ชิปรหัสพนักงานขาย — ใช้ทั้งใต้ชื่อในตารางและในกล่องฟอร์ม
 * ยกออกมาเป็นค่าเดียวตอนที่จุดที่สองเกิดขึ้นจริง (2026-09-24) ไม่ใช่ตอนเดาว่าจะมี
 * (docs/design.md ข้อ 11) — รหัสเดียวกันที่หน้าตาต่างกันสองแบบ คือของสองอย่างในหัวคนใช้
 */
const SALES_CODE_CHIP =
  'inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[var(--brand)]/8 border border-[var(--brand-fg)]/20 text-[var(--brand-fg)] font-semibold';

type FormMode = { kind: 'create' } | { kind: 'edit'; target: AdminUserRow };

const inputClass =
  'w-full bg-card border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/10 transition-all disabled:opacity-50';

/** แยกการยิง API ออกจาก state เพื่อให้ทุก setState เกิดหลัง await (กฎ react-hooks/set-state-in-effect) */
async function fetchUsers(token: string): Promise<AdminUserRow[]> {
  const resp = await fetch('/api/admin/users', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(body.error || `เซิร์ฟเวอร์ตอบรหัส ${resp.status}`);
  return body;
}

export const Users: React.FC = () => {
  const { token, user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<AdminUserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null);
  // บวกค่านี้ = สั่งให้ effect โหลดรายชื่อใหม่ ใช้หลังเพิ่ม/แก้/ลบสำเร็จ
  const [reloadKey, setReloadKey] = useState(0);

  // ── ตัวกรองและการแบ่งหน้า — ทำในเครื่องทั้งหมด ────────────────────────────
  // `GET /api/admin/users` คืนมาครบทุกแถวอยู่แล้วตั้งแต่โหลดครั้งแรก (45 บัญชี · วัด 2026-09-24)
  // การกรองจึงไม่ต้องยิง API ใหม่ และไม่ต้อง debounce ช่องค้นหาเหมือนหน้าที่แบ่งหน้าจาก server
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchUsers(token);
        if (cancelled) return;
        setUsers(rows);
        setLoadError('');
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'โหลดรายชื่อผู้ใช้ไม่สำเร็จ');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, reloadKey]);

  // ข้อความแจ้งสำเร็จหายเองใน 3 วิ ไม่ต้องให้ผู้ใช้กดปิด
  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(''), 3000);
    return () => clearTimeout(timer);
  }, [successMsg]);

  /**
   * จำนวนบัญชีต่อสิทธิ์ — ตัวเลือกใน dropdown มาจาก **แถวที่โหลดมาแล้ว** ไม่ใช่ `ROLE_ORDER` ทั้งชุด
   * (docs/design.md ข้อ 3: ตัวเลือกที่เลือกแล้วได้ตารางว่างทุกครั้ง คือตัวเลือกที่ไม่ควรมี)
   */
  const roleCounts = useMemo(() => {
    const counts = new Map<Role, number>();
    users.forEach((u) => counts.set(u.role, (counts.get(u.role) ?? 0) + 1));
    return counts;
  }, [users]);

  // ค้นด้วยรหัสพนักงานขายได้ด้วย เพราะรหัสคือตัวที่ผูก "ใบของฉัน" ให้แต่ละคน และมันอยู่บนจอแล้ว
  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (!needle) return true;
      return u.username.toLowerCase().includes(needle)
        || u.name.toLowerCase().includes(needle)
        || u.salesperson_ids.some((code) => code.toLowerCase().includes(needle));
    });
  }, [users, query, roleFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  // หนีบค่าตอนคำนวณ ไม่ใช่ setState ใน effect — ลบบัญชีสุดท้ายของหน้าสุดท้ายแล้วต้องไม่ค้างหน้าว่าง
  // (และ `react-hooks/set-state-in-effect` ห้ามท่าหลังอยู่แล้ว — docs/design.md ข้อ 3)
  const currentPage = Math.min(page, totalPages);
  const pagedUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const hasFilter = query !== '' || roleFilter !== '';

  const handleSaved = (message: string) => {
    setFormMode(null);
    setPasswordTarget(null);
    setDeleteTarget(null);
    setSuccessMsg(message);
    setReloadKey((v) => v + 1);
  };

  return (
    <div className="space-y-4">
      {successMsg && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-xl border animate-fade-in bg-emerald-50 border-emerald-200 text-emerald-800">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span className="text-sm font-semibold">{successMsg}</span>
        </div>
      )}

      <PageHeader
        icon={UsersIcon}
        title="ผู้ใช้งานระบบหลังบ้าน"
        description="เพิ่ม ลบ แก้ไข และกำหนดสิทธิ์ผู้เข้าใช้ Admin Portal"
      >
        <button
          onClick={() => setFormMode({ kind: 'create' })}
          className="flex items-center justify-center gap-1.5 px-3.5 btn-h bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white text-sm font-bold rounded-xl shadow-sm transition-all active:scale-95 flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>เพิ่มผู้ใช้</span>
        </button>
      </PageHeader>

      {isLoading ? (
        <div className="bg-card border border-slate-200 rounded-2xl p-10 text-center shadow-sm flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-7 h-7 text-[var(--brand-fg)] animate-spin" />
          <p className="text-slate-500 text-sm font-medium">กำลังโหลดรายชื่อผู้ใช้...</p>
        </div>
      ) : loadError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center text-red-800 shadow-sm flex flex-col items-center justify-center gap-2">
          <AlertTriangle className="w-9 h-9 text-red-600" />
          <p className="font-bold">โหลดรายชื่อผู้ใช้ไม่ได้</p>
          <p className="text-xs">{loadError}</p>
        </div>
      ) : (
        <>
        <FilterBar
          columns="grid-cols-1 sm:grid-cols-[2.4fr_1fr]"
          active={hasFilter}
          onClear={() => { setQuery(''); setRoleFilter(''); setPage(1); }}
        >
          <FilterSearch
            value={query}
            onChange={(v) => { setQuery(v); setPage(1); }}
            placeholder="ค้นหาชื่อผู้ใช้งาน ชื่อ-นามสกุล หรือรหัสเซลส์"
          />
          <FilterSelect
            value={roleFilter}
            onChange={(v) => { setRoleFilter(v as Role | ''); setPage(1); }}
            icon={Shield}
            aria-label="กรองตามสิทธิ์"
          >
            <option value="">สิทธิ์ — ทั้งหมด</option>
            {ROLE_ORDER.filter((r) => roleCounts.has(r)).map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]} ({roleCounts.get(r)})</option>
            ))}
          </FilterSelect>
        </FilterBar>

        <div className="bg-card border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[11px] font-semibold uppercase tracking-wider select-none">
                  <th className="px-4 py-3">ชื่อผู้ใช้งาน</th>
                  <th className="px-4 py-3">ชื่อ-นามสกุล</th>
                  <th className="px-4 py-3 w-48">สิทธิ์</th>
                  <th className="px-4 py-3 text-center w-32">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                {pagedUsers.map((row) => {
                  const isSelf = row.id === currentUser?.id;
                  const badge = ROLE_BADGE[row.role];
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900 font-mono text-[13px]">{row.username}</div>
                        {isSelf && <div className="text-[11px] text-slate-400">บัญชีของคุณ</div>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div>{row.name}</div>
                        {row.salesperson_ids.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {row.salesperson_ids.map((code) => (
                              <span key={code} className={`${SALES_CODE_CHIP} text-[11px]`}>
                                เซลส์<span className="font-mono">{code}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${badge.className}`}
                        >
                          <badge.Icon className="w-3 h-3" />
                          {ROLE_LABEL[row.role]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setFormMode({ kind: 'edit', target: row })}
                            className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-slate-900 rounded-lg transition-colors"
                            title="แก้ไขชื่อและสิทธิ์"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setPasswordTarget(row)}
                            className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-slate-900 rounded-lg transition-colors"
                            title="ตั้งรหัสผ่านใหม่"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(row)}
                            disabled={isSelf}
                            className="p-1.5 hover:bg-red-50 text-slate-500 hover:text-red-600 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-500 disabled:cursor-not-allowed"
                            title={isSelf ? 'ลบบัญชีของตัวเองไม่ได้' : 'ลบผู้ใช้'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredUsers.length === 0 && (
            <EmptyState
              icon={Search}
              title="ไม่พบผู้ใช้ที่ตรงกับตัวกรอง"
              hint="ลองลบคำค้น หรือเลือกสิทธิ์เป็น “ทั้งหมด”"
            />
          )}

          <Pagination
            page={currentPage}
            pages={totalPages}
            size={pageSize}
            total={filteredUsers.length}
            unit="บัญชี"
            onPage={setPage}
            onSize={(s) => { setPageSize(s); setPage(1); }}
          />
        </div>
        </>
      )}

      {formMode && (
        <UserFormModal
          mode={formMode}
          isSelf={formMode.kind === 'edit' && formMode.target.id === currentUser?.id}
          token={token}
          onClose={() => setFormMode(null)}
          onSaved={handleSaved}
        />
      )}

      {passwordTarget && (
        <ResetPasswordModal
          target={passwordTarget}
          token={token}
          onClose={() => setPasswordTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {deleteTarget && (
        <DeleteUserModal
          target={deleteTarget}
          token={token}
          onClose={() => setDeleteTarget(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
};

/* ─────────────────────────── Modal ย่อย ─────────────────────────── */

const ModalShell: React.FC<{
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** กล่องฟอร์มผู้ใช้เป็นสองคอลัมน์ จึงกว้างกว่ากล่องยืนยัน/ตั้งรหัสผ่านที่เหลือ */
  wide?: boolean;
}> = ({ title, icon, onClose, children, wide }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
    <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto bg-card rounded-2xl shadow-2xl border border-slate-200`}>
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'var(--brand-soft)', color: BRAND }}
        >
          {icon}
        </div>
        <h3 className="text-sm font-bold text-slate-900 flex-1">{title}</h3>
        <button
          onClick={onClose}
          aria-label="ปิด"
          className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

const ErrorBox: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex items-start gap-2 bg-red-50 border border-red-200 p-3 rounded-xl text-red-700 text-xs">
    <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
    <span>{message}</span>
  </div>
);

const SubmitRow: React.FC<{
  onClose: () => void;
  isSubmitting: boolean;
  label: string;
  danger?: boolean;
}> = ({ onClose, isSubmitting, label, danger }) => (
  <div className="flex gap-2 pt-1">
    <button
      type="button"
      onClick={onClose}
      disabled={isSubmitting}
      className="flex-1 btn-h px-4 border border-slate-200 text-slate-600 text-sm font-semibold rounded-xl hover:bg-slate-50 transition-all disabled:opacity-50"
    >
      ยกเลิก
    </button>
    <button
      type="submit"
      disabled={isSubmitting}
      className="flex-1 btn-h px-4 text-white text-sm font-semibold rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
      style={{ backgroundColor: danger ? 'var(--color-red-600)' : 'var(--brand)' }}
    >
      {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
      {label}
    </button>
  </div>
);

const RoleSelect: React.FC<{
  value: Role;
  onChange: (role: Role) => void;
  disabled: boolean;
  disabledHint?: string;
}> = ({ value, onChange, disabled, disabledHint }) => (
  <div className="space-y-1">
    <label className="block text-xs font-semibold text-slate-600">สิทธิ์การใช้งาน</label>
    <div className="grid grid-cols-1 gap-1.5">
      {ROLE_ORDER.map((role) => (
        <label
          key={role}
          className={`flex items-start gap-2 px-2.5 py-2 rounded-xl border transition-colors ${
            value === role ? 'border-[var(--brand-fg)] bg-[var(--brand)]/5' : 'border-slate-200'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-50'}`}
        >
          <input
            type="radio"
            name="role"
            checked={value === role}
            disabled={disabled}
            onChange={() => onChange(role)}
            className="mt-0.5 accent-[var(--brand-fg)] shrink-0"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-800">{ROLE_LABEL[role]}</span>
            <span className="block text-[11px] leading-snug text-slate-500">{ROLE_DESCRIPTION[role]}</span>
          </span>
        </label>
      ))}
    </div>
    {disabled && disabledHint && <p className="text-[11px] text-amber-600">{disabledHint}</p>}
  </div>
);

/**
 * รหัสพนักงานขายที่ระบบผูกให้จาก **ชื่อที่เลือก** — อ่านอย่างเดียว ไม่มีช่องให้พิมพ์
 *
 * ของเดิมให้พิมพ์รหัสทีละอันแล้วกด Enter ซึ่งพลาดได้ในแบบที่ไม่มีอะไรฟ้อง: คนที่ถือสองรหัส
 * แล้วใส่ไปรหัสเดียว จะมองไม่เห็นใบของตัวเองอีกก้อนโดยไม่มีใครรู้ (คุณวิรุณ = 441 + 688)
 * ⇒ ผูกจากชื่อแทน รหัสมาครบเองเสมอ และรหัสที่เพิ่มทีหลังก็ตามมาเองตอนเลือกชื่อใหม่
 */
const BoundSalespersonIds: React.FC<{ codes: string[]; unknownName: boolean }> = ({ codes, unknownName }) => {
  if (unknownName) {
    return (
      <div className="flex items-start gap-2 bg-red-50 border border-red-200 p-2.5 rounded-xl text-red-700 text-[11px] leading-relaxed">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>ชื่อนี้ไม่มีรหัสพนักงานขายในระบบ — บัญชีพนักงานขายต้องผูกรหัสอย่างน้อย 1 รหัส จึงบันทึกไม่ได้</span>
      </div>
    );
  }
  if (codes.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
      <span>ผูกรหัสพนักงานขายให้อัตโนมัติ:</span>
      {codes.map((c) => (
        <span
          key={c}
          className={`${SALES_CODE_CHIP} font-mono`}
        >
          {c}
        </span>
      ))}
      {codes.length > 1 && <span>— คนนี้มีหลายรหัส ผูกให้ครบทุกอัน</span>}
    </div>
  );
};

const UserFormModal: React.FC<{
  mode: FormMode;
  isSelf: boolean;
  token: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}> = ({ mode, isSelf, token, onClose, onSaved }) => {
  const isEdit = mode.kind === 'edit';
  const [username, setUsername] = useState(isEdit ? mode.target.username : '');
  // ช่องชื่อเป็นช่องเดียวที่ถือทั้ง "ชื่อในระบบ" และ "ชื่อบนใบ" ⇒ ตอนแก้ไขให้ขึ้นชื่อบนใบก่อน
  // ถ้ามี เพราะนั่นคือค่าที่มีผลกับเอกสารจริง ส่วนชื่อในระบบเป็นแค่สิ่งที่แสดงในตาราง
  const [name, setName] = useState(
    isEdit
      ? (ISSUER_IDENTITY_ROLES.includes(mode.target.role)
          ? (mode.target.employee_quotation_id ?? mode.target.name)
          : mode.target.name)
      : ''
  );
  const [role, setRole] = useState<Role>(isEdit ? mode.target.role : 'user');
  const [password, setPassword] = useState(isEdit ? '' : DEFAULT_PASSWORD);
  const [makers, setMakers] = useState<IssuerNameOption[]>([]);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // รายชื่อผู้จัดทำ + รหัสพนักงานขายของแต่ละชื่อ — เส้นของหน้านี้เอง (คร่อม page.users)
  // ไม่ใช่เส้นของหน้าออกใบที่คร่อม quote.create ซึ่งเป็นคนละสิทธิ์กัน
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch('/api/admin/users/quotation-makers', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { makers: [] }))
      .then((body) => { if (!cancelled) setMakers(Array.isArray(body.makers) ? body.makers : []); })
      .catch(() => { /* โหลดไม่ได้ — ช่องยังพิมพ์เองได้ แค่ไม่มีรายการให้เลือก */ });
    return () => { cancelled = true; };
  }, [token]);

  // ── ทุกอย่างที่ตามมาจากชื่อ คำนวณสด ไม่เก็บเป็น state ─────────────────────
  // เก็บเป็น state เมื่อไหร่จะมีช่วงที่ "ชื่อเปลี่ยนแล้วแต่รหัสยังเป็นของชื่อเก่า" ซึ่งเป็น
  // ความผิดพลาดที่มองไม่เห็นบนจอเลย
  const trimmedName = name.trim();
  const matchedMaker = makers.find((m) => m.name === trimmedName) ?? null;
  const boundCodes = matchedMaker?.salesperson_ids ?? [];
  const nameIsUnknown = trimmedName !== '' && makers.length > 0 && matchedMaker === null;
  // รายการที่กางให้เลือก — role พนักงานขายเห็นเฉพาะชื่อที่มีรหัสจริง เลือกชื่ออื่นไปก็บันทึกไม่ได้
  const nameOptions = role === 'salesperson'
    ? makers.filter((m) => m.salesperson_ids.length > 0)
    : makers;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('กรุณากรอกชื่อ-นามสกุล');
      return;
    }
    if (!isEdit) {
      if (!username.trim()) {
        setError('กรุณากรอกชื่อผู้ใช้งาน');
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`);
        return;
      }
    }
    if (role === 'salesperson' && boundCodes.length === 0) {
      setError('บัญชีพนักงานขายต้องเลือกชื่อที่มีรหัสพนักงานขายในระบบ — ชื่อที่เลือกไว้ยังไม่มีรหัส');
      return;
    }

    setIsSubmitting(true);
    try {
      const url = isEdit ? `/api/admin/users/${mode.target.id}` : '/api/admin/users';
      const resp = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          isEdit
            ? { name: trimmedName, role, salesperson_ids: boundCodes }
            : { username: username.trim(), password, name: trimmedName, role, salesperson_ids: boundCodes }
        ),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error || `เซิร์ฟเวอร์ตอบรหัส ${resp.status}`);

      // ชื่อบนใบเป็นคนละ endpoint (คร่อมด้วย users.set_issuer_identity + ผ่าน isValidQuotationMaker)
      // ⇒ ยิงต่อเมื่อชื่อที่เลือก **มีอยู่ในรายชื่อจาก Odoo จริง** เท่านั้น
      // ชื่อที่พิมพ์เองซึ่งไม่อยู่ในรายชื่อจะถูก server ปฏิเสธด้วย 400 อยู่ดี — ยิงไปก็ได้แค่
      // ข้อความ "บันทึกบัญชีสำเร็จ แต่ตั้งชื่อผู้เสนอราคาไม่สำเร็จ" ที่ทำให้คนงงว่าตกลงสำเร็จไหม
      // บัญชีจึงถูกสร้างพร้อมชื่อในระบบ แล้วไปขึ้นการ์ด "ยังไม่ได้ตั้งชื่อผู้เสนอราคา" ตาม §13.5
      const targetId = isEdit ? mode.target.id : body.id;
      const makerChanged = ISSUER_IDENTITY_ROLES.includes(role) && matchedMaker !== null
        && trimmedName !== (isEdit ? mode.target.employee_quotation_id ?? '' : '');
      if (makerChanged) {
        const mResp = await fetch(`/api/admin/users/${targetId}/quotation-maker`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ employee_quotation_id: trimmedName }),
        });
        const mBody = await mResp.json().catch(() => ({}));
        if (!mResp.ok) throw new Error(mBody.error || 'บันทึกบัญชีสำเร็จ แต่ตั้งชื่อผู้เสนอราคาไม่สำเร็จ');
      }

      onSaved(isEdit ? 'บันทึกข้อมูลผู้ใช้แล้ว' : 'เพิ่มผู้ใช้ใหม่แล้ว');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={isEdit ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}
      icon={<UsersIcon className="w-4 h-4" />}
      onClose={onClose}
      wide
    >
      <form onSubmit={handleSubmit} className="p-5">
        {error && <div className="mb-3"><ErrorBox message={error} /></div>}

        {/*
          สองคอลัมน์ตั้งแต่ sm ขึ้นไป — ข้อมูลบัญชีซ้าย สิทธิ์ขวา (เจ้าของเคาะลำดับนี้ 2026-09-23)
          ต่ำกว่านั้นซ้อนเป็นคอลัมน์เดียวตามลำดับเดิม
        */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">

          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="user-username" className="block text-xs font-semibold text-slate-600">
                ชื่อผู้ใช้งาน (Username)
              </label>
              <input
                id="user-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                // แก้ username ทีหลังไม่รองรับ เพราะเป็นตัวระบุที่ผูกกับการเข้าสู่ระบบ
                disabled={isEdit || isSubmitting}
                placeholder="เช่น THT0073"
                className={`${inputClass} font-mono`}
              />
              <p className="text-[11px] text-slate-400">
                {isEdit ? 'แก้ไขภายหลังไม่ได้' : 'ตั้งแล้วแก้ทีหลังไม่ได้ — ระบบไม่มีเส้นแก้ชื่อผู้ใช้งาน'}
              </p>
            </div>

            {!isEdit && (
              <div className="space-y-1">
                <label htmlFor="user-password" className="block text-xs font-semibold text-slate-600">
                  รหัสผ่านเริ่มต้น{' '}
                  <span className="font-normal text-slate-400">— อย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร</span>
                </label>
                <input
                  id="user-password"
                  type="text"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  className={inputClass}
                />
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  เติมค่าตั้งต้นให้แล้ว แก้ทับได้ — แจ้งให้เจ้าตัวเปลี่ยนเองหลังเข้าสู่ระบบ
                </p>
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="user-name" className="block text-xs font-semibold text-slate-600">
                ชื่อ-นามสกุล
                {NAME_LABEL_SUFFIX[role] && (
                  <span className="font-normal text-slate-400"> — {NAME_LABEL_SUFFIX[role]}</span>
                )}
              </label>

              {NAME_FROM_LIST_ROLES.includes(role) ? (
                <IssuerNameField
                  id="user-name"
                  value={name}
                  onChange={setName}
                  options={nameOptions}
                  placeholder={role === 'salesperson' ? 'เลือกชื่อพนักงานขาย' : 'เลือกหรือพิมพ์ชื่อ'}
                  showCodes={role === 'salesperson'}
                  disabled={isSubmitting}
                  ariaLabel="ชื่อ-นามสกุล"
                />
              ) : (
                <input
                  id="user-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="เช่น สาขาปทุมธานี"
                  className={inputClass}
                />
              )}

              {role === 'salesperson' && (
                <BoundSalespersonIds codes={boundCodes} unknownName={nameIsUnknown} />
              )}

              {ISSUER_IDENTITY_ROLES.includes(role) && nameIsUnknown && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 p-2.5 rounded-xl text-amber-700 text-[11px] leading-relaxed">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>
                    ชื่อนี้ไม่มีในรายชื่อจาก Odoo — บัญชีจะถูกสร้าง แต่ยังออกใบเสนอราคาไม่ได้
                    จนกว่าจะเลือกชื่อที่ตรง
                  </span>
                </div>
              )}

              <p className="text-[11px] text-slate-400 leading-relaxed">{NAME_HINT[role]}</p>
            </div>
          </div>

          <RoleSelect
            value={role}
            onChange={setRole}
            disabled={isSubmitting || isSelf}
            disabledHint={isSelf ? 'แก้ไขสิทธิ์ของบัญชีตัวเองไม่ได้ เพื่อไม่ให้ล็อกตัวเองออกจากระบบ' : undefined}
          />
        </div>

        <div className="mt-4">
          <SubmitRow onClose={onClose} isSubmitting={isSubmitting} label="บันทึก" />
        </div>
      </form>
    </ModalShell>
  );
};

const ResetPasswordModal: React.FC<{
  target: AdminUserRow;
  token: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}> = ({ target, token, onClose, onSaved }) => {
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`);
      return;
    }

    setIsSubmitting(true);
    try {
      const resp = await fetch(`/api/admin/users/${target.id}/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newPassword }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error || `เซิร์ฟเวอร์ตอบรหัส ${resp.status}`);
      onSaved(`ตั้งรหัสผ่านใหม่ให้ ${target.username} แล้ว`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ตั้งรหัสผ่านไม่สำเร็จ');
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell title="ตั้งรหัสผ่านใหม่" icon={<KeyRound className="w-4 h-4" />} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {error && <ErrorBox message={error} />}

        <p className="text-xs text-slate-500">
          ตั้งรหัสผ่านใหม่ให้{' '}
          <span className="font-semibold text-slate-800 font-mono">{target.username}</span> ({target.name})
          โดยไม่ต้องรู้รหัสผ่านเดิม
        </p>

        <div className="space-y-1.5">
          <label htmlFor="reset-password" className="block text-xs font-semibold text-slate-600">
            รหัสผ่านใหม่{' '}
            <span className="font-normal text-slate-400">(อย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร)</span>
          </label>
          <input
            id="reset-password"
            type="text"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={isSubmitting}
            className={inputClass}
          />
        </div>

        <SubmitRow onClose={onClose} isSubmitting={isSubmitting} label="ตั้งรหัสผ่าน" />
      </form>
    </ModalShell>
  );
};

const DeleteUserModal: React.FC<{
  target: AdminUserRow;
  token: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}> = ({ target, token, onClose, onSaved }) => {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const resp = await fetch(`/api/admin/users/${target.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error || `เซิร์ฟเวอร์ตอบรหัส ${resp.status}`);
      onSaved(`ลบผู้ใช้ ${target.username} แล้ว`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ลบไม่สำเร็จ');
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell title="ลบผู้ใช้" icon={<Trash2 className="w-4 h-4" />} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {error && <ErrorBox message={error} />}

        <p className="text-sm text-slate-600">
          ต้องการลบผู้ใช้{' '}
          <span className="font-semibold text-slate-900 font-mono">{target.username}</span> ({target.name})
          ใช่หรือไม่ ผู้ใช้จะออกจากระบบทันทีและเข้าใช้งานไม่ได้อีก
        </p>

        <SubmitRow onClose={onClose} isSubmitting={isSubmitting} label="ลบผู้ใช้" danger />
      </form>
    </ModalShell>
  );
};
