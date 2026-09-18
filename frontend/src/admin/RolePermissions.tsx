import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, type Role } from '../context/AuthContext';
import { ShieldCheck, Check, Clock, X, Loader2, AlertTriangle, RotateCcw, Lock } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { SettingsStatus, SettingsSaveBar } from './SettingsSaveBar';
import { ROLE_LABEL } from './roles';

// ─────────────────────────────────────────────────────────────────────────────
//  สิทธิ์ตามบทบาท — จอเดียวที่ตั้งเมทริกซ์ role × ความสามารถ (docs/plan-role-permissions.md)
//
//  **หน้านี้ไม่ถือแคตตาล็อกสำเนาของตัวเอง** ทั้งรายชื่อความสามารถ ชื่อที่แสดง โหมดที่แต่ละช่อง
//  รับได้ และค่าเริ่มต้น มาจาก `GET /api/admin/role-permissions` ก้อนเดียว (ต้นทางคือ
//  `config/capabilities.ts`) ⇒ เพิ่มความสามารถใหม่ที่ฝั่ง server แล้วหน้านี้ขึ้นให้เอง
//  ไม่ต้องแก้ไฟล์นี้ — และไม่มีวันที่ตารางบนจอกับด่านจริงพูดกันคนละเรื่อง
//
//  สองกติกาที่มองเห็นได้บนจอ และทั้งคู่ถูกบังคับที่ฝั่ง server ด้วย ไม่ใช่แค่ตรงนี้:
//   1. **คอลัมน์ผู้ดูแลระบบถูกล็อก** — ระบบที่ล็อกคนสุดท้ายออกจากตัวเองได้ คือระบบที่ต้อง
//      แก้ด้วย psql ตอนตีสอง (`PUT` ปฏิเสธแถว admin ด้วย 400 ไม่ใช่แค่มองข้าม)
//   2. **"ตรวจกฎไม่สำเร็จ" ไม่มีในตาราง** — มันแปลว่า *ยังไม่รู้ว่าผิดหรือไม่* ไม่ใช่ *ผิดข้อนี้*
//      จึงต้องห้ามออกใบเสมอ และของที่ไม่ควรมีใครทะลุได้ ไม่ควรมีสวิตช์ เพราะสวิตช์คือคำเชิญให้เปิด
//
//  ส่ง **เฉพาะช่องที่ต่างจากค่าเริ่มต้น** ขึ้นไป และส่งทั้งเมทริกซ์ในครั้งเดียว ⇒ "คืนค่าเริ่มต้น"
//  คือการไม่ส่งช่องนั้น ไม่ใช่คำสั่งลบแยก และไม่มีสถานะกลางที่บันทึกไปครึ่งหนึ่งแล้วค้าง
// ─────────────────────────────────────────────────────────────────────────────

type PermissionMode = 'deny' | 'approval' | 'allow';
type CapGroup = 'rule' | 'quote' | 'page';

interface CapabilityDto {
  key: string;
  group: CapGroup;
  label: string;
  modes: PermissionMode[];
  defaults: Record<Role, PermissionMode>;
}

interface MatrixDto {
  roles: Role[];
  capabilities: CapabilityDto[];
  /** ค่าที่ใช้จริง (ค่าเริ่มต้นทับด้วยค่าใน DB แล้ว) — role → ความสามารถ → โหมด */
  effective: Record<string, Record<string, PermissionMode>>;
}

/** ค่าบนจอ: ความสามารถ → role → โหมด (กลับด้านกับ `effective` เพราะจอวาดทีละแถว) */
type Matrix = Record<string, Record<Role, PermissionMode>>;

/** แก้ไม่ได้ทั้งคอลัมน์ — ดูเหตุผลที่หัวไฟล์ */
const LOCKED_ROLE: Role = 'admin';

// เรียงกลุ่มจากกว้างไปแคบ: เห็นหน้าอะไรบ้าง → ในหน้านั้นทะลุกฎอะไรได้ → ฟังก์ชันย่อยรายอย่าง
const GROUP_ORDER: CapGroup[] = ['page', 'rule', 'quote'];
const GROUP_LABEL: Record<CapGroup, string> = {
  page: 'หน้าจอที่เข้าถึงได้ — เมนูไหนโผล่ให้ใครบ้าง (ปิดแล้ว API ของหน้านั้นตอบ 403 ด้วย)',
  rule: 'การทะลุกฎ — ติดกฎข้อนี้แล้วออกใบต่อได้แค่ไหน',
  quote: 'การทำงานกับใบ — เปิด/ปิดฟังก์ชันย่อย',
};

/**
 * ปุ่มของแต่ละโหมดเป็น **ไอคอน** ไม่ใช่คำ เพราะตารางมี 5 คอลัมน์ × 3 ปุ่ม บนจอโน้ตบุ๊ก
 * ⇒ ทุกปุ่มมี `title` + `aria-label` เป็นคำเต็ม และแถบคำอธิบายด้านบนเป็นกุญแจถาวร
 * (ไอคอนที่ไม่มีคำอธิบายคือคำถามที่ผู้ใช้ต้องเดาทุกครั้งที่กลับมาหน้านี้)
 */
const MODE_META: Record<PermissionMode, { label: string; hint: string; Icon: typeof Check; on: string }> = {
  deny: { label: 'ห้าม', hint: 'ห้าม — ออกใบไม่ได้ ต้องแก้ใบก่อน', Icon: X, on: 'bg-red-100 text-red-700' },
  approval: { label: 'ต้องอนุมัติ', hint: 'ต้องอนุมัติ — ส่งเข้าคิวให้ผู้อนุมัติตัดสิน', Icon: Clock, on: 'bg-violet-100 text-violet-700' },
  allow: { label: 'ทำได้เอง', hint: 'ทำได้เอง — ติ๊กรับทราบแล้วออกใบต่อได้', Icon: Check, on: 'bg-emerald-100 text-emerald-700' },
};

/** ช่องที่เป็นสวิตช์ 2 ค่า (`deny`/`allow`) พูดคนละภาษากับกฎ 3 ชั้น — คำจึงต่างกันด้วย */
const SWITCH_TEXT: Record<'deny' | 'allow', string> = { deny: 'ปิด — เข้าไม่ได้', allow: 'เปิด — เข้าได้' };
const modeHint = (cap: CapabilityDto, mode: PermissionMode) =>
  cap.modes.length === 2 ? SWITCH_TEXT[mode as 'deny' | 'allow'] : MODE_META[mode].hint;

function buildMatrix(dto: MatrixDto): Matrix {
  const out: Matrix = {};
  for (const cap of dto.capabilities) {
    out[cap.key] = {} as Record<Role, PermissionMode>;
    for (const role of dto.roles) {
      out[cap.key][role] = dto.effective[role]?.[cap.key] ?? cap.defaults[role];
    }
  }
  return out;
}

/** แยกการยิง API ออกจาก state เพื่อให้ทุก setState เกิดหลัง await (กฎ react-hooks/set-state-in-effect) */
async function fetchMatrix(token: string): Promise<MatrixDto> {
  const resp = await fetch('/api/admin/role-permissions', { headers: { Authorization: `Bearer ${token}` } });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    // 503 = อ่านตารางไม่ได้ (ยังไม่ได้รัน migration) ซึ่ง **ไม่ใช่** "ไม่มีใครแก้ค่าเริ่มต้น" —
    // ถ้าวาดตารางเปล่าให้ดู คนจะกดบันทึกทับของจริงที่ตั้งไว้ทิ้งทั้งตาราง
    throw new Error(body.hint ? `${body.error} · ${body.hint}` : body.error || `เซิร์ฟเวอร์ตอบรหัส ${resp.status}`);
  }
  return body as MatrixDto;
}

interface CellProps {
  cap: CapabilityDto;
  role: Role;
  value: PermissionMode;
  locked: boolean;
  dirty: boolean;
  disabled: boolean;
  onPick: (mode: PermissionMode) => void;
}

const ModeCell: React.FC<CellProps> = ({ cap, role, value, locked, dirty, disabled, onPick }) => (
  <>
    <span className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5">
      {cap.modes.map((mode) => {
        const { Icon, on } = MODE_META[mode];
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            disabled={locked || disabled}
            onClick={() => onPick(mode)}
            title={`${ROLE_LABEL[role]}: ${modeHint(cap, mode)}`}
            aria-label={`${cap.label} — ${ROLE_LABEL[role]} — ${modeHint(cap, mode)}`}
            aria-pressed={active}
            className={`inline-flex h-6 w-7 items-center justify-center rounded-md transition-colors ${
              active ? on : 'text-slate-400'
            } ${locked || disabled ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        );
      })}
    </span>
    {dirty && (
      <span
        className="ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
        style={{ backgroundColor: 'var(--brand)' }}
        title="ต่างจากค่าเริ่มต้น"
      />
    )}
  </>
);

export function RolePermissions() {
  const { token } = useAuth();
  const [dto, setDto] = useState<MatrixDto | null>(null);
  const [matrix, setMatrix] = useState<Matrix>({});
  /** ค่าที่โหลดมาครั้งล่าสุด — "ย้อนกลับ" คืนมาที่นี่ ส่วน "คืนค่าเริ่มต้น" ไปที่ defaults */
  const [loaded, setLoaded] = useState<Matrix>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState('');

  /**
   * โหลดเมทริกซ์ — **ไม่มี setState ก่อน await สักตัว** (กฎ react-hooks/set-state-in-effect)
   * ธงกำลังโหลดจึงเป็นค่าตั้งต้นของ state ตั้งแต่แรก และปุ่ม "ลองใหม่" เป็นคนตั้งมันเองก่อนเรียก
   */
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await fetchMatrix(token);
      const next = buildMatrix(data);
      setDto(data);
      setMatrix(next);
      setLoaded(next);
      setError('');
    } catch (err) {
      setDto(null);
      setError(err instanceof Error ? err.message : 'โหลดตารางสิทธิ์ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // หุ้มด้วย setTimeout ตามแบบเดียวกับ CustomersDirectory / ApiLogs — กติกา
  // react-hooks/set-state-in-effect ห้ามเรียก setState ตรง ๆ ใน effect แม้จะอยู่หลัง await
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const caps = useMemo(
    () => (dto ? [...dto.capabilities].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)) : []),
    [dto],
  );
  /** role ที่แก้ได้ — คอลัมน์ผู้ดูแลระบบยังแสดงอยู่ (ให้เห็นว่าเทียบกับอะไร) แต่กดไม่ได้ */
  const editableRoles = useMemo(() => (dto?.roles ?? []).filter((r) => r !== LOCKED_ROLE), [dto]);

  const isCellOverridden = useCallback(
    (cap: CapabilityDto, role: Role) => role !== LOCKED_ROLE && matrix[cap.key]?.[role] !== cap.defaults[role],
    [matrix],
  );
  const isRowOverridden = useCallback(
    (cap: CapabilityDto) => editableRoles.some((r) => isCellOverridden(cap, r)),
    [editableRoles, isCellOverridden],
  );
  const hasOverrides = caps.some(isRowOverridden);

  const isDirty = useMemo(
    () => caps.some((cap) => (dto?.roles ?? []).some((r) => matrix[cap.key]?.[r] !== loaded[cap.key]?.[r])),
    [caps, dto, matrix, loaded],
  );

  const pick = (capKey: string, role: Role, mode: PermissionMode) => {
    setSavedAt('');
    setMatrix((prev) => ({ ...prev, [capKey]: { ...prev[capKey], [role]: mode } }));
  };

  const resetRow = (cap: CapabilityDto) => {
    setSavedAt('');
    setMatrix((prev) => ({ ...prev, [cap.key]: { ...prev[cap.key], ...cap.defaults } }));
  };

  const resetAll = () => {
    setSavedAt('');
    setMatrix(Object.fromEntries(caps.map((c) => [c.key, { ...c.defaults }])) as Matrix);
  };

  const save = async () => {
    if (!token || !dto) return;
    setSaving(true);
    setError('');
    setSavedAt('');
    try {
      // ส่งเฉพาะช่องที่ต่างจากค่าเริ่มต้น — แถวที่เท่ากับค่าเริ่มต้นไม่ถูกเก็บเป็นข้อมูล
      // มันจะกลายเป็นคำตอบเก่าในวันที่ค่าเริ่มต้นในแคตตาล็อกเปลี่ยน
      const overrides = caps.flatMap((cap) =>
        editableRoles
          .filter((role) => matrix[cap.key]?.[role] !== cap.defaults[role])
          .map((role) => ({ role, capability: cap.key, mode: matrix[cap.key][role] })),
      );
      const resp = await fetch('/api/admin/role-permissions', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error || `เซิร์ฟเวอร์ตอบรหัส ${resp.status}`);
      setLoaded(matrix);
      setSavedAt(new Date().toLocaleTimeString('th-TH'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกสิทธิ์ไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <PageHeader icon={ShieldCheck} title="สิทธิ์ตามบทบาท" description="กำหนดว่าแต่ละบทบาททำอะไรได้บ้าง">
      <button
        type="button"
        onClick={resetAll}
        disabled={!hasOverrides || saving || loading}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 btn-h text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <RotateCcw className="w-4 h-4" />
        คืนค่าเริ่มต้นทั้งหมด
      </button>
    </PageHeader>
  );

  if (loading) {
    return (
      <>
        {header}
        <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-card p-10 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          กำลังโหลดตารางสิทธิ์…
        </div>
      </>
    );
  }

  if (!dto) {
    return (
      <>
        {header}
        <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => { setLoading(true); void load(); }}
            className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 btn-h text-sm font-bold"
          >
            <RotateCcw className="w-4 h-4" />
            ลองใหม่
          </button>
        </div>
      </>
    );
  }

  /** หัวข้อคั่นกลุ่ม — เรนเดอร์เมื่อกลุ่มเปลี่ยนเท่านั้น ทั้งในตารางและในการ์ด */
  const groupOf = (index: number): CapGroup | null =>
    index === 0 || caps[index].group !== caps[index - 1].group ? caps[index].group : null;

  return (
    <>
      {header}
      <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-card">

        <div className="flex items-start gap-3 border-b border-slate-100 bg-slate-50/60 p-3.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: 'var(--brand-soft)' }}
          >
            <ShieldCheck className="h-4 w-4" style={{ color: 'var(--brand)' }} />
          </div>
          <div className="text-[13px] leading-relaxed text-slate-600">
            <span className="font-bold text-slate-900">ค่าเริ่มต้นคือพฤติกรรมของระบบวันนี้</span> —
            ช่องที่ยังไม่เคยแก้จะไม่ถูกบันทึกเป็นข้อมูล จึง <b>กด “คืนค่าเริ่มต้นทั้งหมด” แล้วระบบกลับไปเป็นเหมือนก่อนมีหน้านี้ทุกข้อ</b> ·
            การแก้มีผล <b>กับใบที่ออกหลังจากกดบันทึก</b> ไม่ย้อนหลังกับใบที่ออกไปแล้ว ·
            <b> “ตรวจกฎไม่สำเร็จ” ไม่มีในตารางนี้โดยตั้งใจ</b> — มันแปลว่าระบบยังไม่รู้ว่าผิดหรือไม่ จึงต้องห้ามออกใบเสมอ
          </div>
        </div>

        {/* กุญแจของไอคอน — ถาวร ไม่ใช่ tooltip เพราะคนกลับมาหน้านี้นาน ๆ ครั้ง */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-100 px-3.5 py-2.5">
          <span className="text-[11px] font-bold text-slate-500">ความหมายของปุ่ม</span>
          {(Object.keys(MODE_META) as PermissionMode[]).map((mode) => {
            const { Icon, on, hint } = MODE_META[mode];
            return (
              <span key={mode} className="flex items-center gap-1.5 text-[12px] text-slate-600">
                <span className={`inline-flex h-6 w-7 items-center justify-center rounded-md ${on}`} aria-hidden="true">
                  <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
                {hint}
              </span>
            );
          })}
          <span className="flex items-center gap-1.5 text-[12px] text-slate-600">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--brand)' }} />
            = ต่างจากค่าเริ่มต้น
          </span>
        </div>

        {/* ── ตาราง (จอทำงาน) ─────────────────────────────────────────────── */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60">
                <th className="px-3.5 py-2.5 text-left text-xs font-bold text-slate-600">ความสามารถ</th>
                {dto.roles.map((role) => (
                  <th
                    key={role}
                    className={`w-[132px] px-2 py-2.5 text-center text-xs font-bold ${
                      role === LOCKED_ROLE ? 'text-slate-400' : 'text-slate-600'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {role === LOCKED_ROLE && <Lock className="h-3 w-3" />}
                      {ROLE_LABEL[role]}
                    </span>
                  </th>
                ))}
                <th className="w-[92px] px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {caps.map((cap, i) => {
                const group = groupOf(i);
                return (
                  <React.Fragment key={cap.key}>
                    {group && (
                      <tr>
                        <td
                          colSpan={dto.roles.length + 2}
                          className="border-y border-slate-100 bg-slate-50/60 px-3.5 py-2 text-[11px] font-bold tracking-wide text-slate-500"
                        >
                          {GROUP_LABEL[group]}
                        </td>
                      </tr>
                    )}
                    <tr className="border-b border-slate-100">
                      <td className="px-3.5 py-2.5 text-[13px] text-slate-700">{cap.label}</td>
                      {dto.roles.map((role) => (
                        <td key={role} className="px-2 py-2.5 text-center">
                          <ModeCell
                            cap={cap}
                            role={role}
                            value={matrix[cap.key]?.[role] ?? cap.defaults[role]}
                            locked={role === LOCKED_ROLE}
                            dirty={isCellOverridden(cap, role)}
                            disabled={saving}
                            onPick={(mode) => pick(cap.key, role, mode)}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-2.5 text-right">
                        {isRowOverridden(cap) && (
                          <button
                            type="button"
                            onClick={() => resetRow(cap)}
                            disabled={saving}
                            className="rounded-md px-2 py-1 text-[11px] font-bold text-slate-500 underline disabled:opacity-40"
                          >
                            คืนค่าเริ่มต้น
                          </button>
                        )}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── การ์ด (มือถือ) — ตารางย่อส่วนอ่านไม่ออกบนจอแคบ (docs/design.md) ── */}
        <div className="divide-y divide-slate-100 sm:hidden">
          {caps.map((cap, i) => {
            const group = groupOf(i);
            return (
              <React.Fragment key={cap.key}>
                {group && (
                  <div className="bg-slate-50/60 px-3.5 py-2 text-[11px] font-bold text-slate-500">
                    {GROUP_LABEL[group]}
                  </div>
                )}
                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-bold text-slate-700">{cap.label}</span>
                    {isRowOverridden(cap) && (
                      <button
                        type="button"
                        onClick={() => resetRow(cap)}
                        disabled={saving}
                        className="shrink-0 text-[11px] font-bold text-slate-500 underline disabled:opacity-40"
                      >
                        คืนค่าเริ่มต้น
                      </button>
                    )}
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {dto.roles.map((role) => (
                      <div key={role} className="flex items-center justify-between gap-2">
                        <span className={`text-[12px] ${role === LOCKED_ROLE ? 'text-slate-400' : 'text-slate-600'}`}>
                          {ROLE_LABEL[role]}{role === LOCKED_ROLE ? ' (ล็อก)' : ''}
                        </span>
                        <span className="shrink-0">
                          <ModeCell
                            cap={cap}
                            role={role}
                            value={matrix[cap.key]?.[role] ?? cap.defaults[role]}
                            locked={role === LOCKED_ROLE}
                            dirty={isCellOverridden(cap, role)}
                            disabled={saving}
                            onPick={(mode) => pick(cap.key, role, mode)}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <div className="space-y-3 p-3.5">
          <SettingsStatus
            error={error}
            savedAt={savedAt}
            isDirty={isDirty}
            effect="มีผลกับเมนูและ API ของทุกคนทันที (ใบที่ออกไปแล้วไม่เปลี่ยน)"
          />
        </div>

        <SettingsSaveBar isDirty={isDirty} isSaving={saving} onSave={() => void save()} onReset={() => setMatrix(loaded)} />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        คอลัมน์ <b>{ROLE_LABEL[LOCKED_ROLE]}</b> ถูกล็อกและแก้ไม่ได้ —
        ระบบที่ล็อกคนสุดท้ายออกจากตัวเองได้ คือระบบที่ต้องแก้ด้วย psql ตอนตีสอง ·
        หน้านี้เองไม่มีอยู่ในตาราง ด้วยเหตุผลเดียวกัน
      </p>
    </>
  );
}
