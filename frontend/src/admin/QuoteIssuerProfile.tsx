// ─────────────────────────────────────────────────────────────────────────────
//  แถบตั้งค่าตัวตนของใบที่ออกจากหน้าเว็บ (เฟส E · ขั้น 9′ ส่วนที่ 0 → §13 ของ
//  docs/plan-role-permissions.md เฟส "ตัวตนบนใบที่ออกจากเว็บ — ล็อกชื่อ + ลายเซ็นขึ้นเอง")
//
//  ใบที่ออกจากหน้านี้มี "คนสองคน" อยู่บนกระดาษใบเดียวกัน:
//    · พนักงานขาย        = เซลส์ที่ออกใบ (ตัวเองถ้า role='salesperson' · เลือกได้ถ้าเป็นแอดมิน)
//    · ผู้เสนอราคา/ผู้จัดทำ = คนคีย์ใบ (ตัวเองถ้า role='salesperson' · แอดมินถ้าเป็น admin/subadmin/approver)
//
//  ตั้งแต่ 2026-09-22 (§13) **ทั้งสองชื่อ "ล็อกขึ้นเองตามบัญชี" ไม่มีช่องให้พิมพ์/เลือกชื่อตัวเองอีก**
//  เหตุผล: ช่องเลือกชื่อของตัวเองคือช่องที่ทำให้แอบอ้างเป็นคนอื่นได้ (ตั้งชื่อใหม่ก่อนออกใบแต่ละครั้ง)
//  ⇒ ชื่อผู้เสนอราคาของแอดมินตั้งได้ที่เดียวคือหน้า "จัดการผู้ใช้งานระบบ" (ต้องมี
//  `users.set_issuer_identity`) ส่วนเซลส์ไม่มีช่องให้ตั้งเลย — ชื่อคือชื่อในระบบเสมอ
//
//  สิ่งที่ยังเลือกได้เหมือนเดิม:
//    · แอดมิน/subadmin/approver ยังเลือก "ออกในนาม" (พนักงานขาย) ได้อิสระ — combobox เดิม
//      ตั้งแต่ 2026-09-24 **ช่องเริ่มต้นว่าง** แล้วหน้าแม่ (QuoteRequest) เติมให้เองจากเซลส์ของลูกค้า
//      (docs/plan-web-quote-auto-salesperson.md) · เลิกเติม "คนที่เลือกครั้งก่อน" จาก
//      `admin_users.acting_salesperson_id` แล้ว — ลูกค้าคนละรายมีเซลส์คนละคน การเติมคนเดิมให้ทุกใบ
//      คือการออกใบในนามคนผิดโดยไม่มีใครสังเกต
//    · ลายเซ็นของแอดมินเอง (ใต้ชื่อผู้เสนอราคา) ยังอัป/ลบเองได้ — ไม่ใช่การอ้างชื่อคนอื่น (§13.3)
//
//  role='salesperson' ไม่มี combobox เลยสักช่อง (ไม่มีใครให้เลือก เป็นตัวเอง) ⇒ แถวเดียว ล็อกทั้งแถว
//  ทั้งสองกล่องบน PDF เป็นชื่อ+ลายเซ็นเดียวกันจาก `sale_sigs` (ดู services/webIdentity.ts
//  getIssuerSnapshot — คืน null เสมอสำหรับ role นี้ ⇒ PDF เดินเส้นเดิมของใบ LINE ทุกตัวอักษร)
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { PersonComboBox, type PersonOption } from './PersonComboBox';
import { AlertTriangle, Lock, Loader2, Trash2, Upload, User, UserCog } from 'lucide-react';

const BRAND = 'var(--brand-fg)';

interface IssuerProfile {
  admin_id: number;
  name: string;
  role: string;
  employee_quotation_id: string | null;
  employee_quotation_phone: string | null;
  has_signature: boolean;
  signature_url: string | null;
  is_ready: boolean;
  own_salesperson: OwnSalesperson | null;
}

interface OwnSalesperson {
  user_id: string;
  name: string;
  salesperson_id: string | null;
  phone: string | null;
  has_sale_sig: boolean;
  sig_url: string | null;
}

interface ActingSalesperson {
  user_id: string;
  name: string;
  salesperson_id: string | null;
  phone: string | null;
  has_sale_sig: boolean;
  sig_url: string | null;
  /** จำนวนบัญชี LINE ซ้ำที่ถูกยุบเข้าแถวนี้ (0 = ไม่มีซ้ำ) — ฝั่ง server ยุบมาให้แล้ว */
  merged_count?: number;
  /** ใช้งานล่าสุด (ISO) — เกณฑ์ที่ server ใช้เลือกบัญชีตัวแทน */
  last_active_at?: string | null;
}

/**
 * ตัวตนสองคนที่จะไป**ขึ้นบนกระดาษ** (ช่องลงนามกลางและขวาของใบ)
 *
 * หน้าแม่ต้องใช้ตอนเรนเดอร์ขั้นใบร่างให้เหมือนใบจริง — ข้อมูลชุดนี้โหลดอยู่แล้วในคอมโพเนนต์นี้
 * ⇒ ส่งต่อขึ้นไป **ไม่ใช่ให้หน้าแม่ยิง API ซ้ำ** ไม่งั้นจะมีสองแหล่งที่ตอบคนละค่าได้
 */
export interface QuoteIssuerIdentity {
  salesperson: { name: string; phone: string | null; sig_url: string | null } | null;
  issuer: { name: string | null; phone: string | null; sig_url: string | null };
}

/** ป้ายในช่อง "ออกในนาม" — เจ้าของเคาะ 2026-09-24 ว่ามีแค่สองคำนี้ (แบบ A ของ mockup) */
export type SpBadge = 'system' | 'manual';

interface Props {
  /** เซลส์ที่เลือก "ออกในนาม" — ว่าง = ยังไม่เลือก (หน้าแม่ใช้บล็อกปุ่มสร้างร่าง) */
  spUserId: string;
  onSpUserIdChange: (userId: string) => void;
  /** คนกดเลือกเองจาก combobox — แยกจาก onSpUserIdChange เพราะหน้าแม่ต้องรู้ว่า "คนเลือก" ไม่ใช่ระบบ */
  onSpPick?: (userId: string) => void;
  /** `system` = ระบบเลือก (เติมจากลูกค้า/ใบเดิม) · `manual` = เลือกเอง · null = ไม่มีป้าย */
  spBadge?: SpBadge | null;
  /** เหตุผลที่ระบบเติมให้ไม่ได้ — ขึ้นเป็นกล่องเหลืองใต้แถบ ให้คนรู้ว่าต้องเลือกเอง */
  spNotice?: string | null;
  /** true เมื่อบัญชีพร้อมออกใบ (ดูเกณฑ์แยกตาม role ที่หัวไฟล์) — หน้าแม่ใช้บล็อกทั้งหน้าเมื่อยังไม่พร้อม */
  onReadyChange: (ready: boolean) => void;
  /** ตัวตนที่จะขึ้นบนใบ — เปลี่ยนเมื่อเลือกเซลส์คนใหม่ หรือโปรไฟล์โหลดเสร็จ */
  onIdentityChange?: (identity: QuoteIssuerIdentity) => void;
}

/**
 * กรอบลายเซ็นในแถว — ย่อจากช่องบน PDF (180×50) ลง 80% **โดยคงอัตราส่วน 3.6:1 เป๊ะ**
 * ⇒ สัดส่วนที่เห็นตรงกับบนกระดาษ รูปที่ยาวเกินจนจะถูกย่อจนอ่านไม่ออกดูออกตั้งแต่ตอนอัป
 * ทั้งสองฝั่งต้องใช้ค่าเดียวกัน เพราะนี่คือจุดที่ตาใช้เทียบซ้าย–ขวา
 */
//
// จอแคบกว่า sm ย่อเหลือ 80×22 (ยังเป็น 3.6:1) — วัดที่ 390px: กรอบ 144px เหลือที่ให้ช่อง "ออกในนาม"
// จนชื่อเซลส์กว้าง 0px เมื่อมีป้าย "ระบบเลือก"/"เลือกเอง" ต่อท้าย (2026-09-24 · ตรงกับ mockup ที่เจ้าของเลือก)
const SIG_FRAME =
  'relative w-[80px] h-[22px] sm:w-[144px] sm:h-[40px] shrink-0 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden';
const SIG_BOX = 'max-h-[18px] max-w-[74px] sm:max-h-[36px] sm:max-w-[138px] object-contain';

/** กล่องล็อก (อ่านอย่างเดียว) แทนที่ PersonComboBox ของฝั่งที่แก้เองไม่ได้แล้ว (§13.3/§13.2) */
const LockedField: React.FC<{
  icon: React.ReactNode;
  name: string | null;
  phone: string | null;
  invalid?: boolean;
}> = ({ icon, name, phone, invalid }) => (
  <div
    className={`flex-1 min-w-0 flex items-center gap-2 h-10 px-3 rounded-xl border text-sm ${
      invalid ? 'border-red-200 bg-red-50/40 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-700'
    }`}
    title="ตั้งค่าจากหน้า “จัดการผู้ใช้งานระบบ” เท่านั้น"
  >
    <Lock className="w-3.5 h-3.5 shrink-0 text-slate-400" aria-hidden="true" />
    {icon}
    {name ? (
      <span className="min-w-0 flex-1 flex items-baseline gap-1.5">
        <span className="truncate font-semibold">{name}</span>
        <span className={`text-xs shrink-0 ${phone ? 'text-slate-400' : 'text-amber-600 font-semibold'}`}>
          {phone || 'ไม่มีเบอร์'}
        </span>
      </span>
    ) : (
      <span className="text-slate-400 truncate">ยังไม่ได้ตั้งค่า</span>
    )}
  </div>
);

/** การ์ด "ยังไม่พร้อมออกใบ" — ข้อความแยกตาม role แต่ปิดท้ายเหมือนกันเสมอ: ติดต่อผู้ดูแลระบบ (§13.5) */
const NotReadyCard: React.FC<{ role: string }> = ({ role }) => (
  <div className="flex items-start gap-2.5 px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800">
    <AlertTriangle className="w-4.5 h-4.5 shrink-0 mt-0.5" />
    <div className="text-xs leading-relaxed">
      <p className="font-bold mb-0.5">ยังออกใบเสนอราคาจากหน้านี้ไม่ได้</p>
      {role === 'salesperson' ? (
        <p>
          บัญชีนี้ยังไม่ได้ผูกกับรหัสพนักงานขายที่ใช้งานอยู่ (หรือรหัสที่ผูกไว้ยังไม่มีแถวพนักงานขาย
          ที่เปิดใช้งานในระบบ) — ติดต่อผู้ดูแลระบบ
        </p>
      ) : (
        <p>
          บัญชีนี้ยังไม่ได้ตั้งชื่อผู้เสนอราคา (ที่จะพิมพ์ลงใบ/ไฟล์ export) — ติดต่อผู้ดูแลระบบ
        </p>
      )}
    </div>
  </div>
);

export const QuoteIssuerProfile: React.FC<Props> = ({
  spUserId, onSpUserIdChange, onSpPick, spBadge, spNotice, onReadyChange, onIdentityChange,
}) => {
  const { token, user } = useAuth();
  const role = user?.role ?? 'admin';
  const isSelfIssueRole = role === 'salesperson';

  const [profile, setProfile] = useState<IssuerProfile | null>(null);
  const [salespersons, setSalespersons] = useState<ActingSalesperson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const loadAll = useCallback(async () => {
    // เซลส์ไม่ต้องรู้จักรายชื่อผู้จัดทำ (ไม่มีช่องให้เลือก) และไม่ต้องรู้รายชื่อเซลส์คนอื่น
    // (ไม่มี combobox ให้เลือกใคร) ⇒ ยิงแค่ /me ก็พอ ลดงานเซิร์ฟเวอร์โดยไม่มีผลต่อหน้าจอ
    if (isSelfIssueRole) {
      const meRes = await fetch('/api/admin/webquote/me', { headers: authHeaders });
      if (!meRes.ok) throw new Error('โหลดข้อมูลผู้เสนอราคาไม่สำเร็จ');
      const me: IssuerProfile = await meRes.json();
      return { me, salespersons: [] as ActingSalesperson[] };
    }
    const [meRes, spRes] = await Promise.all([
      fetch('/api/admin/webquote/me', { headers: authHeaders }),
      fetch('/api/admin/webquote/salespersons', { headers: authHeaders }),
    ]);
    if (!meRes.ok || !spRes.ok) throw new Error('โหลดข้อมูลผู้เสนอราคาไม่สำเร็จ');
    const me: IssuerProfile = await meRes.json();
    const sp = await spRes.json();
    return { me, salespersons: (sp.salespersons ?? []) as ActingSalesperson[] };
  }, [authHeaders, isSelfIssueRole]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await loadAll();
        if (cancelled) return;
        setProfile(data.me);
        setSalespersons(data.salespersons);
        onReadyChange(data.me.is_ready);

        // เซลส์ไม่มีอะไรให้เลือก — ตัวตนคือ own_salesperson เสมอ (ถ้ามี)
        // role อื่นเริ่มว่าง (2026-09-24) — หน้าแม่เติมให้เมื่อรู้ลูกค้า ดูหัวไฟล์
        if (isSelfIssueRole && data.me.own_salesperson) onSpUserIdChange(data.me.own_salesperson.user_id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, loadAll, onReadyChange, onSpUserIdChange, isSelfIssueRole]);

  const selectedSp = isSelfIssueRole
    ? null
    : salespersons.find((s) => s.user_id === spUserId) ?? null;
  const own = profile?.own_salesperson ?? null;

  // ส่งตัวตนขึ้นไปให้หน้าแม่ทุกครั้งที่มันเปลี่ยน — ขั้นใบร่างวาดช่องลงนามจากค่าชุดนี้
  useEffect(() => {
    if (isSelfIssueRole) {
      // เซลส์: สองช่องบนใบเป็นคนเดียวกันเสมอ (ตัวเอง) — ตรงกับที่ getIssuerSnapshot คืน null
      // ให้ PDF เดินเส้นเดิม (ช่องขวาซ้ำชื่อ/ลายเซ็นของช่องกลาง) ⇒ ใบร่างต้องซ้ำให้เหมือนกัน
      // ไม่งั้นช่อง "ผู้เสนอราคา" บนจอว่างทั้งที่ไฟล์จริงมีชื่อ
      const identity = own
        ? { name: own.name, phone: own.phone ?? null, sig_url: own.sig_url ?? null }
        : null;
      onIdentityChange?.({
        salesperson: identity,
        issuer: identity ?? { name: null, phone: null, sig_url: null },
      });
      return;
    }
    onIdentityChange?.({
      salesperson: selectedSp
        ? { name: selectedSp.name, phone: selectedSp.phone ?? null, sig_url: selectedSp.sig_url ?? null }
        : null,
      issuer: {
        name: profile?.employee_quotation_id ?? null,
        phone: profile?.employee_quotation_phone ?? null,
        sig_url: profile?.signature_url ?? null,
      },
    });
  }, [isSelfIssueRole, own, selectedSp, profile, onIdentityChange]);

  /** รวมจำนวนบัญชีซ้ำที่ถูกยุบทิ้ง — อธิบายว่าทำไมรายชื่อสั้นกว่าที่เคยเห็น จึงไปอยู่ใต้รายชื่อ */
  const mergedTotal = salespersons.reduce((sum, s) => sum + (s.merged_count ?? 0), 0);

  // โชว์ทั้งรหัสและเบอร์: รหัสคือสิ่งที่คนในร้านใช้เรียกกัน แต่เบอร์คือสิ่งที่ไปอยู่บนใบ
  // (ไม่มีเบอร์ = ใบพิมพ์คำว่า `( เบอร์โทร )` ให้ลูกค้าเห็น) ⇒ ต้องเห็นก่อนกดเลือก
  const spOptions: PersonOption[] = useMemo(
    () => salespersons.map((s) => ({ id: s.user_id, name: s.name, code: s.salesperson_id, phone: s.phone })),
    [salespersons],
  );

  // ป้ายในช่อง: เขียว = ระบบเลือก · น้ำเงินขอบ = เลือกเอง (ภาษาเดียวกับป้าย "ตั้งเอง" ของเครดิต/กำหนดส่ง
  // — docs/design.md §8 · สื่อด้วยคำ ไม่ใช่สีอย่างเดียว)
  const badge =
    spBadge === 'system' ? (
      <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-[var(--brand-fg)]/40 bg-[var(--brand-soft)] text-[var(--brand-fg)]">
        ระบบเลือก
      </span>
    ) : spBadge === 'manual' ? (
      <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-blue-600 text-blue-700">
        เลือกเอง
      </span>
    ) : null;

  const uploadSignature = async (file: File) => {
    setSaving(true);
    setError('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'));
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/admin/webquote/me/signature', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'อัปโหลดลายเซ็นไม่สำเร็จ');
      // อัปทับใช้ key เดิม ⇒ URL เท่าเดิม ต้องต่อ cache-buster ไม่งั้นเบราว์เซอร์โชว์รูปเก่า
      setProfile((p) => (p ? { ...p, has_signature: true, signature_url: `${body.signature_url}?t=${Date.now()}` } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'อัปโหลดไม่สำเร็จ');
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const deleteSignature = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/webquote/me/signature', { method: 'DELETE', headers: authHeaders });
      if (!res.ok) throw new Error('ลบลายเซ็นไม่สำเร็จ');
      setProfile((p) => (p ? { ...p, has_signature: false, signature_url: null } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ลบไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-card border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: BRAND }} />
        กำลังโหลดโปรไฟล์ผู้เสนอราคา...
      </div>
    );
  }

  if (profile && !profile.is_ready) {
    return <NotReadyCard role={role} />;
  }

  const issuerName = profile?.employee_quotation_id ?? null;
  const issuerPhone = profile?.employee_quotation_phone ?? null;

  // ── role='salesperson': แถวเดียว ล็อกทั้งแถว (§13.2) ────────────────────────
  if (isSelfIssueRole) {
    return (
      <div className="bg-card border border-slate-200 rounded-2xl shadow-sm px-4 py-3 flex items-center gap-2.5">
        <User className="w-[18px] h-[18px] shrink-0 text-slate-400" />
        <span className="text-xs text-slate-400 shrink-0 hidden sm:block">ออกใบในนามตัวเอง</span>
        <LockedField icon={null} name={own?.name ?? null} phone={own?.phone ?? null} invalid={!own} />
        <div className={SIG_FRAME} title={own && !own.sig_url ? 'ใบที่ออกจะไม่มีลายเซ็น (ทั้งสองช่อง)' : undefined}>
          {own?.sig_url ? (
            <img src={own.sig_url} alt="ลายเซ็นของฉัน" className={SIG_BOX} />
          ) : (
            <span className="text-[11px] text-amber-700">ไม่มีลายเซ็น</span>
          )}
        </div>
        {error && (
          <div className="flex items-start gap-2 text-xs text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
        )}
      </div>
    );
  }

  // ── admin / subadmin / approver: สองฝั่ง — ผู้เสนอราคา (ล็อก) + ออกในนาม (เลือกได้) ──
  return (
    // ห้ามใส่ overflow-hidden — dropdown ของฝั่ง "ออกในนาม" สูงกว่าการ์ด ถ้าคลิปจะเลือกชื่อท้าย ๆ ไม่ได้
    <div className="bg-card border border-slate-200 rounded-2xl shadow-sm">
      {/*
        สองฝั่ง = คนสองคนที่จะขึ้นกระดาษใบเดียวกัน (ล้อกับ PDF ที่มีช่องเซ็น 2 ช่องคู่กัน)
        เรียง "ผู้เสนอราคา → ออกในนาม" ลำดับเดียวกับบนใบ · จอแคบกว่า lg ซ้อนเป็นสองแถว
      */}
      <div className="grid grid-cols-1 lg:grid-cols-2">
        {/* ── ผู้เสนอราคา = ตัวแอดมินเอง — ชื่อล็อก ตั้งได้ที่หน้า "จัดการผู้ใช้งานระบบ" เท่านั้น ── */}
        <div className="flex items-center gap-2.5 px-4 py-3 min-w-0">
          <UserCog className="w-[18px] h-[18px] shrink-0" style={{ color: BRAND }} />
          <span className="text-xs text-slate-400 shrink-0 hidden xl:block">ผู้เสนอราคา</span>

          <LockedField icon={null} name={issuerName} phone={issuerPhone} invalid={!issuerName} />

          {/* ลายเซ็น: กรอบคือปุ่มอัปโหลดในตัว ⇒ ไม่ต้องมีปุ่มข้อความและคำอธิบายใต้กรอบ */}
          <div className={SIG_FRAME}>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadSignature(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={saving}
              title={profile?.has_signature ? 'เปลี่ยนลายเซ็น (PNG/JPG)' : 'อัปโหลดลายเซ็น (PNG/JPG)'}
              aria-label={profile?.has_signature ? 'เปลี่ยนลายเซ็น' : 'อัปโหลดลายเซ็น'}
              className="w-full h-full flex items-center justify-center rounded-xl hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-fg)]/30 disabled:opacity-50"
            >
              {profile?.signature_url ? (
                <img src={profile.signature_url} alt="ลายเซ็นของฉัน" className={SIG_BOX} />
              ) : (
                <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Upload className="w-3.5 h-3.5" />
                  ลายเซ็น
                </span>
              )}
            </button>
            {profile?.has_signature && (
              <button
                type="button"
                onClick={deleteSignature}
                disabled={saving}
                title="ลบลายเซ็น"
                aria-label="ลบลายเซ็น"
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-md flex items-center justify-center text-slate-400 bg-card/80 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* ── พนักงานขายที่ออกในนาม (ลายเซ็นของเขาแก้ที่นี่ไม่ได้ จึงเป็นกรอบอ่านอย่างเดียว) ── */}
        <div className="flex items-center gap-2.5 px-4 py-3 min-w-0 border-t lg:border-t-0 lg:border-l border-slate-100">
          <User className="w-[18px] h-[18px] shrink-0 text-slate-400" />
          <span className="text-xs text-slate-400 shrink-0 hidden xl:block">ออกในนาม</span>

          <PersonComboBox
            value={
              selectedSp
                ? { id: selectedSp.user_id, name: selectedSp.name, code: selectedSp.salesperson_id, phone: selectedSp.phone }
                : null
            }
            options={spOptions}
            onPick={(o) => (onSpPick ?? onSpUserIdChange)(o.id)}
            badge={selectedSp ? badge : undefined}
            placeholder="เลือกพนักงานขายที่จะออกใบในนาม"
            emptyText="ไม่พบพนักงานขายชื่อ รหัส หรือเบอร์นี้"
            ariaLabel="พนักงานขายที่จะออกใบในนาม"
            invalid={!spUserId}
            footer={
              mergedTotal > 0 ? (
                <span>ยุบบัญชี LINE ที่ชื่อ/รหัสซ้ำกันออก {mergedTotal} บัญชี — เหลือบัญชีที่ใช้งานล่าสุด</span>
              ) : undefined
            }
          />

          <div className={SIG_FRAME} title={selectedSp && !selectedSp.sig_url ? 'ใบที่ออกจะไม่มีลายเซ็นช่อง “พนักงานขาย”' : undefined}>
            {selectedSp?.sig_url ? (
              <img src={selectedSp.sig_url} alt="ลายเซ็นพนักงานขาย" className={SIG_BOX} />
            ) : selectedSp ? (
              <span className="text-[11px] text-amber-700">ไม่มีลายเซ็น</span>
            ) : (
              <span className="text-[11px] text-slate-300">ลายเซ็น</span>
            )}
          </div>
        </div>
      </div>

      {spNotice && !spUserId && (
        <div className="mx-4 mb-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
          <span>{spNotice}</span>
        </div>
      )}

      <div className="mx-4 mb-3 text-[11px] text-slate-400">
        ชื่อผู้เสนอราคาตั้งที่หน้า “จัดการผู้ใช้งานระบบ” — แก้ไม่ได้จากหน้านี้
      </div>

      {error && (
        <div className="mx-4 mb-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
