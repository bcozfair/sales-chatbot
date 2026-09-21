// ─────────────────────────────────────────────────────────────────────────────
//  หน้า "อนุมัติราคา" — คิวคำขอขายต่ำกว่าราคาขั้นต่ำ (docs/plan-quote-price-approval.md)
//
//  **หน้าเดียว สองบทบาท** — ไม่ได้แยกเป็นสองหน้าเพราะมันคือรายการเดียวกัน ต่างกันแค่ว่า
//  ใครมองอยู่ (server เป็นคนกรองให้ ไม่ใช่หน้าจอ):
//
//    ผู้อนุมัติ (admin/approver) → เห็นทุกคำขอ · กดอนุมัติ/ไม่อนุมัติได้
//    คนขอ (subadmin)            → เห็นเฉพาะของตัวเอง · แก้/ยกเลิกคำขอที่ถูกตีกลับได้
//
//  ทำไมต้องมีจอนี้แทนที่จะแจ้งเตือน: ห้ามใช้ LINE push (กฎเหล็กของ CLAUDE.md) และการอนุมัติ
//  เป็นงานที่ต้องเห็นรายละเอียดทั้งใบก่อนตัดสิน ไม่ใช่กดจากในแจ้งเตือนบรรทัดเดียว
//
//  ถ้อยคำของกฎแต่ละข้อมาจาก server (`display_message`) เหมือนทุกจอในระบบ — หน้าจอไม่ประกอบเอง
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BadgeCheck, Ban, CheckCircle2, ChevronDown, ChevronUp,
  FileText, Pencil, RotateCcw, Save, Send, XCircle,
} from 'lucide-react';
import { useAuth, type Role } from '../context/AuthContext';
import { PageHeader } from './PageHeader';
import { Button } from './Button';
import { Modal } from './Modal';
import { EmptyState, ErrorBox, SkeletonRows, TableCard } from './logs/ui';
import { APPROVAL_RELOAD_KEY, type ApprovalReloadPayload } from './QuoteRequest';
import { TAB_SLUG } from './navHash';
import { describeApiError } from './apiError';

type ApprovalStatus = 'pending' | 'approved' | 'rejected';

interface ApprovalItem {
  model: string;
  name: string;
  quantity: number;
  price: number;
  min_price: number;
}

interface ApprovalRequest {
  request_id: string;
  status: ApprovalStatus;
  requested_by_id: number | null;
  requested_by: string | null;
  requested_by_name: string | null;
  requested_at: string | null;
  note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  customer_name: string | null;
  contact_name: string | null;
  salesperson_name: string | null;
  total_sum: number;
  quote_ids: string[];
  items: ApprovalItem[];
  line_count: number;
}

/** บรรทัดในใบตามที่ enrichQuotationData คืนมา — ใช้เฉพาะฟิลด์ที่จอนี้ต้องแสดง/แก้ */
interface DetailItem {
  model: string;
  name: string;
  quantity: number;
  price: number;
  discount_1: number;
  discount_2: number;
  is_optional?: boolean;
  is_shipping_fee?: boolean;
  is_manual_service?: boolean;
}

interface ApprovalDetail extends ApprovalRequest {
  quotes: { id: string; company: 'PM' | 'THT'; total_sum: number; items: DetailItem[] }[];
  current_violations: { type: string; model: string; display_message: string }[];
}

/** ตัวเลขที่กำลังพิมพ์อยู่ — เก็บเป็นสตริงเพื่อให้ลบทั้งช่องแล้วพิมพ์ใหม่ได้ ไม่เด้งเป็น 0 ทันที */
type LineDraft = { quantity: string; price: string; discount_1: string; discount_2: string };

const money = (n: number) =>
  Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** วันเวลาแบบไทยสั้น ๆ — คิวนี้ดูกันในวันเดียว วันที่เต็มกินที่โดยไม่ได้ช่วยตัดสินใจ */
const when = (iso: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '-'
    : d.toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** ส่วนต่างจากราคาขั้นต่ำเป็น % — ตัวเลขที่ผู้อนุมัติดูก่อนอย่างอื่นเสมอ */
const gapPct = (it: ApprovalItem) =>
  it.min_price > 0 ? ((it.min_price - it.price) / it.min_price) * 100 : 0;

const STATUS_BADGE: Record<ApprovalStatus, { label: string; className: string }> = {
  pending: { label: 'รออนุมัติ', className: 'bg-violet-50 border-violet-200 text-violet-700' },
  approved: { label: 'อนุมัติแล้ว', className: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  rejected: { label: 'ไม่อนุมัติ', className: 'bg-red-50 border-red-200 text-red-700' },
};

const canDecide = (role: Role) => role === 'admin' || role === 'approver';

/**
 * บรรทัดที่คนแก้ตัวเลขได้ — บรรทัดที่ "กฎ" เป็นคนเติม (สินค้าพ่วง · ค่าบริการอัตโนมัติ)
 * ถูกคำนวณใหม่ทุกครั้งที่บันทึก ให้แก้ไปก็ถูกเขียนทับอยู่ดี · กติกาเดียวกับฝั่ง server
 */
const isEditableLine = (it: DetailItem) =>
  !it.is_optional && (!it.is_shipping_fee || it.is_manual_service === true);

const initialDrafts = (d: ApprovalDetail): Record<string, LineDraft> => {
  const out: Record<string, LineDraft> = {};
  for (const q of d.quotes ?? []) {
    (q.items ?? []).forEach((it, index) => {
      out[`${q.id}:${index}`] = {
        quantity: String(it.quantity ?? 0),
        price: String(it.price ?? 0),
        discount_1: String(it.discount_1 ?? 0),
        discount_2: String(it.discount_2 ?? 0),
      };
    });
  }
  return out;
};

/**
 * มีตัวเลขที่พิมพ์ค้างแต่ยังไม่กดบันทึกไหม
 *
 * ต้องรู้ เพราะปุ่ม "อนุมัติและออกใบ" ออกใบจาก **ของที่อยู่ในฐาน** ไม่ใช่ของที่อยู่บนจอ —
 * ถ้าปล่อยให้กดได้ ตัวเลขที่เพิ่งพิมพ์จะหายเงียบ ๆ แล้วใบออกไปด้วยราคาเดิม
 */
const hasUnsaved = (d: ApprovalDetail | null, drafts: Record<string, LineDraft>): boolean => {
  if (!d) return false;
  for (const q of d.quotes ?? []) {
    for (let i = 0; i < (q.items ?? []).length; i++) {
      const it = q.items[i];
      const draft = drafts[`${q.id}:${i}`];
      if (!draft) continue;
      if (Number(draft.quantity) !== Number(it.quantity)) return true;
      if (Number(draft.price) !== Number(it.price)) return true;
      if (Number(draft.discount_1) !== Number(it.discount_1)) return true;
      if (Number(draft.discount_2) !== Number(it.discount_2)) return true;
    }
  }
  return false;
};

/** ยอดของบรรทัดตามตัวเลขที่กำลังพิมพ์อยู่ — ให้เห็นผลก่อนกดบันทึก (server คิดใหม่อยู่ดี) */
const lineTotal = (d: LineDraft | undefined, it: DetailItem): number => {
  const qty = Number(d?.quantity ?? it.quantity) || 0;
  const price = Number(d?.price ?? it.price) || 0;
  const d1 = Number(d?.discount_1 ?? it.discount_1) || 0;
  const d2 = Number(d?.discount_2 ?? it.discount_2) || 0;
  return qty * price * (1 - d1 / 100) * (1 - d2 / 100);
};

export const PriceApprovals: React.FC = () => {
  const { token, user } = useAuth();
  const role = (user?.role ?? 'user') as Role;
  const decider = canDecide(role);

  const [rows, setRows] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<ApprovalStatus>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** คำขอที่กำลังจะถูกปฏิเสธ — เหตุผลบังคับ จึงต้องมีกล่องถามก่อนเสมอ */
  const [rejecting, setRejecting] = useState<ApprovalRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [issued, setIssued] = useState<{ quotation_no: string; pdf_link: string }[]>([]);
  /** รายละเอียดของคำขอที่กางอยู่ — โหลดตอนกางเท่านั้น คิวยาว ๆ จะได้ไม่ยิงทีเดียวทั้งหน้า */
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  /** ตัวเลขที่ผู้อนุมัติกำลังแก้ · คีย์ = `<quote_id>:<index ของบรรทัด>` */
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  /**
   * ยิง API อย่างเดียว ไม่แตะ state — เพื่อให้ทุก `setState` เกิด **หลัง** `await`
   * (กฎ `react-hooks/set-state-in-effect` ของ eslint ในรีโปนี้ · แบบเดียวกับ `fetchUsers` ใน Users.tsx)
   */
  const fetchRequests = useCallback(async (status: ApprovalStatus): Promise<ApprovalRequest[]> => {
    const res = await fetch(`/api/admin/approvals?status=${status}`, { headers: authHeaders });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(data?.error || 'โหลดคิวอนุมัติไม่สำเร็จ'));
    return (data.requests ?? []) as ApprovalRequest[];
  }, [authHeaders]);

  const load = useCallback(async () => {
    try {
      const list = await fetchRequests(filter);
      setRows(list);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดคิวอนุมัติไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [fetchRequests, filter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchRequests(filter);
        if (cancelled) return;
        setRows(list);
        setError('');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'โหลดคิวอนุมัติไม่สำเร็จ');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchRequests, filter]);

  const act = async (req: ApprovalRequest, path: string, body?: unknown) => {
    setBusyId(req.request_id);
    setError('');
    try {
      const res = await fetch(`/api/admin/approvals/${req.request_id}/${path}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || 'ทำรายการไม่สำเร็จ'));
      return data;
    } finally {
      setBusyId(null);
    }
  };

  /** กาง/ยุบคำขอ — กางเมื่อไหร่ถึงค่อยโหลดรายละเอียด (คิวยาวไม่ควรยิงทั้งหน้าเผื่อไว้) */
  const toggleOpen = async (req: ApprovalRequest) => {
    if (openId === req.request_id) {
      setOpenId(null);
      setDetail(null);
      setDrafts({});
      return;
    }
    setOpenId(req.request_id);
    setDetail(null);
    setDrafts({});
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/approvals/${req.request_id}`, { headers: authHeaders });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || 'เปิดรายละเอียดไม่สำเร็จ'));
      setDetail(data as ApprovalDetail);
      setDrafts(initialDrafts(data as ApprovalDetail));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เปิดรายละเอียดไม่สำเร็จ');
    } finally {
      setDetailLoading(false);
    }
  };

  /** บันทึกตัวเลขที่ผู้อนุมัติแก้ — server ตรวจกฎใหม่ทั้งใบ ไม่ใช่เชื่อค่าที่ส่งมา */
  const saveEdits = async () => {
    if (!detail) return;
    setSavingEdit(true);
    setError('');
    try {
      const payload = {
        quotes: detail.quotes.map((q) => ({
          quote_id: q.id,
          items: q.items
            .map((it, index) => ({ it, index }))
            .filter(({ it }) => isEditableLine(it))
            .map(({ it, index }) => {
              const d = drafts[`${q.id}:${index}`];
              return {
                index,
                model: it.model,
                quantity: Number(d?.quantity ?? it.quantity),
                price: Number(d?.price ?? it.price),
                discount_1: Number(d?.discount_1 ?? it.discount_1),
                discount_2: Number(d?.discount_2 ?? it.discount_2),
              };
            }),
        })),
      };
      const res = await fetch(`/api/admin/approvals/${detail.request_id}/items`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || 'บันทึกการแก้ไขไม่สำเร็จ'));
      // โหลดของจริงกลับมาใหม่ทั้งชุด — ค่าบริการอัตโนมัติและยอดรวมถูกคิดใหม่ฝั่ง server
      const fresh = await fetch(`/api/admin/approvals/${detail.request_id}`, { headers: authHeaders });
      if (fresh.ok) {
        const d = (await fresh.json()) as ApprovalDetail;
        setDetail(d);
        setDrafts(initialDrafts(d));
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกการแก้ไขไม่สำเร็จ');
    } finally {
      setSavingEdit(false);
    }
  };

  const approve = async (req: ApprovalRequest) => {
    try {
      const data = await act(req, 'approve');
      setIssued((data.issued ?? []) as { quotation_no: string; pdf_link: string }[]);
      // ใบหนึ่งในชุดออกไม่ได้ ไม่ใช่เหตุให้เงียบ — คนอนุมัติต้องรู้ว่าเหลือใบค้างอยู่
      // แต่ละใบส่ง violations มาด้วย ⇒ ใช้ประโยคไทยของกฎที่ติด ไม่ใช่รหัส "VALIDATION_ERROR"
      // (describeApiError ตัวเดียวกับหน้า "ขอใบเสนอราคา" — เจ้าของสั่งแก้ 2026-09-18)
      const failed = (data.failed ?? []) as { quote_id: string; error: string; violations?: unknown }[];
      if (failed.length > 0) {
        // ต่อด้วย " · " ไม่ใช่ขึ้นบรรทัดใหม่ — ErrorBox ของหน้านี้ไม่ได้ตั้ง whitespace-pre-wrap
        // (ต่างจากกล่องแดงของหน้า "ขอใบเสนอราคา") การขึ้นบรรทัดจะถูกยุบเป็นช่องว่างเฉย ๆ
        const detail = failed.map((f) => describeApiError(f, 'ออกใบไม่สำเร็จ')).join(' · ');
        setError(`อนุมัติแล้ว แต่ออกใบไม่สำเร็จ ${failed.length} ใบ: ${detail}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'อนุมัติไม่สำเร็จ');
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    try {
      await act(rejecting, 'reject', { reason: rejectReason });
      setRejecting(null);
      setRejectReason('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกการไม่อนุมัติไม่สำเร็จ');
    }
  };

  const cancel = async (req: ApprovalRequest) => {
    try {
      await act(req, 'cancel');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ยกเลิกคำขอไม่สำเร็จ');
    }
  };

  /** เปิดคำขอที่ถูกตีกลับกลับเข้าฟอร์ม — ส่งของผ่าน sessionStorage แล้วเปลี่ยนแท็บ */
  const editInForm = async (req: ApprovalRequest) => {
    setBusyId(req.request_id);
    setError('');
    try {
      const res = await fetch(`/api/admin/approvals/${req.request_id}/form`, { headers: authHeaders });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || 'เปิดคำขอเข้าฟอร์มไม่สำเร็จ'));
      const payload: ApprovalReloadPayload = {
        request_id: req.request_id,
        customer_id: data.customer_id ?? null,
        contact_id: data.contact_id ?? null,
        company_name: data.company_name ?? null,
        payment_terms_override: data.payment_terms_override ?? null,
        note: data.note ?? null,
        items: data.items ?? [],
      };
      sessionStorage.setItem(APPROVAL_RELOAD_KEY, JSON.stringify(payload));
      // เปลี่ยนแท็บด้วย hash — ตัวอ่าน hash ของ AdminApp รับช่วงต่อเอง (navHash.ts)
      window.location.hash = `#${TAB_SLUG.quoterequest}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เปิดคำขอเข้าฟอร์มไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };

  const tabs: { key: ApprovalStatus; label: string }[] = [
    { key: 'pending', label: decider ? 'รออนุมัติ' : 'คำขอที่รออยู่' },
    { key: 'rejected', label: 'ไม่อนุมัติ' },
    { key: 'approved', label: 'อนุมัติแล้ว' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={BadgeCheck}
        title="อนุมัติราคา"
        description={decider
          ? 'คำขอขายต่ำกว่าราคาขั้นต่ำ — แก้ตัวเลขเองได้ก่อนอนุมัติ · อนุมัติแล้วระบบออกใบให้ทันที'
          : 'คำขอขายต่ำกว่าราคาขั้นต่ำของคุณ — รอผู้อนุมัติตัดสิน'}
      >
        <Button variant="neutral" tone="soft" icon={RotateCcw} onClick={() => void load()}>
          รีเฟรช
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setFilter(t.key); setOpenId(null); setIssued([]); }}
            className={`px-3 h-8 rounded-xl border text-xs font-semibold transition-colors ${
              filter === t.key
                ? 'bg-[var(--brand-soft)] border-[var(--brand-border)] text-[var(--brand-fg)]'
                : 'bg-card border-slate-200 text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {issued.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-2">
          <p className="text-sm font-bold text-emerald-800">อนุมัติแล้ว — ออกใบเสนอราคา {issued.length} ใบ</p>
          {issued.map((r) => (
            <div key={r.quotation_no} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold text-slate-800 tabular-nums">{r.quotation_no}</span>
              <a
                href={r.pdf_link}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-800 hover:bg-emerald-100"
              >
                <FileText className="w-3.5 h-3.5" />
                เปิดไฟล์ PDF
              </a>
            </div>
          ))}
        </div>
      )}

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      <TableCard>
        {loading ? (
          <SkeletonRows rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={BadgeCheck}
            title={filter === 'pending' ? 'ไม่มีคำขอรออนุมัติ' : 'ไม่มีรายการในสถานะนี้'}
            hint="คำขอจะเกิดขึ้นเมื่อมีคนออกใบเสนอราคาผ่านหน้าเว็บ แล้วมีรายการที่ราคาต่ำกว่าขั้นต่ำ"
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((req) => {
              const open = openId === req.request_id;
              const badge = STATUS_BADGE[req.status];
              const busy = busyId === req.request_id;
              const mine = req.requested_by_id === user?.id;
              /**
               * ผู้อนุมัติแก้ตัวเลขในร่างได้เองเฉพาะตอนที่คำขอยังรออยู่ — คำขอที่ตัดสินไปแล้ว
               * ใบอาจออกเลขไปแล้ว (แก้ไม่ได้อยู่ดี) หรือกำลังรอผู้ขอแก้ ซึ่งเป็นคิวของเขา
               */
              const canEdit = decider && req.status === 'pending';
              /** พิมพ์ค้างไว้แต่ยังไม่บันทึก — ห้ามให้กดอนุมัติทับ ไม่งั้นตัวเลขที่พิมพ์หายเงียบ ๆ */
              const unsaved = open && detail?.request_id === req.request_id && hasUnsaved(detail, drafts);
              return (
                <div key={req.request_id} className="px-4 py-3 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className={`px-2 py-0.5 rounded-lg border text-[11px] font-bold ${badge.className}`}>
                      {badge.label}
                    </span>
                    <span className="text-sm font-semibold text-slate-900">{req.customer_name ?? '-'}</span>
                    <span className="text-xs text-slate-500">{req.contact_name ?? '-'}</span>
                    <span className="text-xs text-slate-400">
                      ต่ำกว่าขั้นต่ำ {req.items.length} จาก {req.line_count} รายการ
                    </span>
                    {/* ตัวเลขที่ผู้อนุมัติดูก่อนอย่างอื่นเสมอ — ห่างจากขั้นต่ำมากที่สุดกี่เปอร์เซ็นต์ */}
                    {req.items.length > 0 && (
                      <span className="text-xs font-semibold text-red-700 tabular-nums">
                        ต่ำสุด -{Math.max(...req.items.map(gapPct)).toFixed(1)}%
                      </span>
                    )}
                    <span className="text-xs text-slate-500 tabular-nums">฿{money(req.total_sum)}</span>
                    <span className="ml-auto text-xs text-slate-400">
                      {req.requested_by_name || req.requested_by || '-'} · {when(req.requested_at)}
                    </span>
                    <Button
                      variant="neutral"
                      tone="soft"
                      size="icon-sm"
                      aria-label={open ? 'ย่อรายละเอียด' : 'ดูรายละเอียด'}
                      icon={open ? ChevronUp : ChevronDown}
                      onClick={() => void toggleOpen(req)}
                    />
                  </div>

                  {req.note && (
                    <p className="text-xs text-slate-600">
                      <span className="text-slate-400">เหตุผลที่ขอ: </span>{req.note}
                    </p>
                  )}

                  {req.status === 'rejected' && req.decision_note && (
                    <p className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                      <XCircle className="w-4 h-4 shrink-0 mt-px" />
                      <span>
                        <b>ไม่อนุมัติ</b> โดย {req.decided_by ?? '-'} · {when(req.decided_at)} — {req.decision_note}
                      </span>
                    </p>
                  )}

                  {open && (
                    <div className="space-y-3">
                      {detailLoading && <p className="text-xs text-slate-400">กำลังโหลดรายละเอียด...</p>}

                      {/* ผู้อนุมัติแก้ตัวเลขเองได้ก่อนกดอนุมัติ — เคสจริงคือ "ลดได้แค่นี้"
                          ซึ่งถ้าต้องตีกลับไปให้ผู้ขอพิมพ์ใหม่ คือการเดินสองรอบเพื่อแก้เลขตัวเดียว */}
                      {detail?.request_id === req.request_id && detail.quotes.map((q) => (
                        <div key={q.id} className="space-y-1">
                          <p className="text-[11px] font-bold text-slate-500">
                            ใบ {q.company} · ยอด ฿{money(q.total_sum)}
                          </p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-slate-400 text-left">
                                  <th className="py-1.5 pr-3 font-semibold">รหัส</th>
                                  <th className="py-1.5 pr-3 font-semibold">ชื่อสินค้า</th>
                                  <th className="py-1.5 pr-3 font-semibold text-right">จำนวน</th>
                                  <th className="py-1.5 pr-3 font-semibold text-right">ราคา</th>
                                  <th className="py-1.5 pr-3 font-semibold text-right">ลด 1 (%)</th>
                                  <th className="py-1.5 pr-3 font-semibold text-right">ลด 2 (%)</th>
                                  <th className="py-1.5 pr-3 font-semibold text-right">ขั้นต่ำ</th>
                                  <th className="py-1.5 font-semibold text-right">รวม</th>
                                </tr>
                              </thead>
                              <tbody className="text-slate-700">
                                {q.items.map((it, index) => {
                                  const key = `${q.id}:${index}`;
                                  const d = drafts[key];
                                  const editable = canEdit && isEditableLine(it);
                                  const minPrice = req.items.find((a) => a.model === it.model)?.min_price ?? 0;
                                  const under = minPrice > 0 && Number(d?.price ?? it.price) < minPrice;
                                  const cell = (field: keyof LineDraft, max?: number) => (
                                    <input
                                      type="number"
                                      min={0}
                                      max={max}
                                      value={d?.[field] ?? ''}
                                      disabled={savingEdit}
                                      onChange={(e) =>
                                        setDrafts((prev) => ({
                                          ...prev,
                                          [key]: { ...prev[key], [field]: e.target.value },
                                        }))
                                      }
                                      className="w-20 bg-card border border-slate-200 rounded-lg px-2 py-1 text-right tabular-nums text-slate-900 focus:outline-none focus:border-[var(--brand-fg)]"
                                    />
                                  );
                                  return (
                                    <tr key={key} className="border-t border-slate-100">
                                      <td className="py-1.5 pr-3 font-semibold text-slate-900">{it.model}</td>
                                      <td className="py-1.5 pr-3">
                                        {it.name}
                                        {!isEditableLine(it) && (
                                          <span className="ml-1.5 text-[10px] text-slate-400">(ระบบเติมให้)</span>
                                        )}
                                      </td>
                                      <td className="py-1.5 pr-3 text-right tabular-nums">
                                        {editable ? cell('quantity') : it.quantity}
                                      </td>
                                      <td className={`py-1.5 pr-3 text-right tabular-nums ${under ? 'font-semibold text-red-700' : ''}`}>
                                        {editable ? cell('price') : `฿${money(it.price)}`}
                                      </td>
                                      <td className="py-1.5 pr-3 text-right tabular-nums">
                                        {editable ? cell('discount_1', 100) : it.discount_1}
                                      </td>
                                      <td className="py-1.5 pr-3 text-right tabular-nums">
                                        {editable ? cell('discount_2', 100) : it.discount_2}
                                      </td>
                                      <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">
                                        {minPrice > 0 ? `฿${money(minPrice)}` : '-'}
                                      </td>
                                      <td className="py-1.5 text-right tabular-nums">฿{money(lineTotal(d, it))}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}

                      {canEdit && detail?.request_id === req.request_id && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="secondary" icon={Save} busy={savingEdit} onClick={() => void saveEdits()}>
                            บันทึกการแก้ไข
                          </Button>
                          <span className="text-xs text-slate-500">
                            แก้ได้เฉพาะจำนวน · ราคา · ส่วนลด — ต้องการเพิ่ม/ลบสินค้าหรือเปลี่ยนลูกค้า ให้กด
                            “เปิดในฟอร์ม” หรือตีกลับให้ผู้ขอแก้
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {req.status === 'pending' && decider && (
                      <>
                        <Button
                          variant="primary"
                          icon={CheckCircle2}
                          busy={busy}
                          disabled={savingEdit || unsaved}
                          onClick={() => void approve(req)}
                        >
                          อนุมัติและออกใบ
                        </Button>
                        <Button
                          variant="danger"
                          tone="soft"
                          icon={XCircle}
                          disabled={busy || savingEdit}
                          onClick={() => { setRejecting(req); setRejectReason(''); }}
                        >
                          ไม่อนุมัติ
                        </Button>
                        {/* เพิ่ม/ลบสินค้า หรือเปลี่ยนลูกค้า — งานของฟอร์มเต็ม ไม่ใช่ของตารางตัวเลขข้างบน
                            ส่งกลับเข้าฟอร์มแล้วส่งคำขอใหม่ (ร่างเดิมถูกทิ้งหลังใบใหม่สำเร็จ) */}
                        <Button variant="neutral" tone="soft" icon={Pencil} busy={busy} disabled={unsaved} onClick={() => void editInForm(req)}>
                          เปิดในฟอร์ม
                        </Button>
                        {unsaved && (
                          <span className="text-xs text-amber-700">
                            มีตัวเลขที่แก้แล้วยังไม่ได้บันทึก — กด “บันทึกการแก้ไข” ก่อน
                          </span>
                        )}
                      </>
                    )}
                    {req.status === 'rejected' && (mine || role === 'admin') && (
                      <>
                        <Button variant="secondary" icon={Pencil} busy={busy} onClick={() => void editInForm(req)}>
                          แก้ไขแล้วส่งใหม่
                        </Button>
                        <Button variant="danger" tone="soft" icon={Ban} disabled={busy} onClick={() => void cancel(req)}>
                          ยกเลิกคำขอ
                        </Button>
                      </>
                    )}
                    {req.status === 'pending' && !decider && (
                      <>
                        <span className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Send className="w-3.5 h-3.5" />
                          ส่งไปแล้ว รอผู้อนุมัติ — ระหว่างรอแก้ใบชุดนี้ไม่ได้
                        </span>
                        <Button variant="danger" tone="soft" icon={Ban} disabled={busy} onClick={() => void cancel(req)}>
                          ยกเลิกคำขอ
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </TableCard>

      {rejecting && (
        <Modal
          icon={AlertTriangle}
          tone="danger"
          title="ไม่อนุมัติราคา"
          onClose={() => setRejecting(null)}
          footer={
            <>
              <Button variant="neutral" tone="soft" onClick={() => setRejecting(null)}>
                ปิด
              </Button>
              <Button
                variant="danger"
                size="md"
                icon={XCircle}
                busy={busyId === rejecting.request_id}
                disabled={rejectReason.trim() === ''}
                onClick={() => void reject()}
              >
                ยืนยันไม่อนุมัติ
              </Button>
            </>
          }
        >
          <div className="p-5 space-y-3 text-xs">
            <p className="text-slate-600">
              คำขอของ <b className="text-slate-900">{rejecting.customer_name ?? '-'}</b> จะถูกส่งกลับไปให้
              {' '}{rejecting.requested_by_name || rejecting.requested_by || 'ผู้ขอ'} แก้ไขหรือยกเลิก —
              ใบยังไม่ถูกออกและยังไม่ถูกลบ
            </p>
            {/* เหตุผลบังคับ เพราะคนที่รับใบกลับไปต้องรู้ว่าจะแก้อะไร — "ไม่อนุมัติ" เฉย ๆ
                ทำให้เขาส่งกลับมาเหมือนเดิม แล้ววนอยู่อย่างนั้น */}
            <label className="block font-bold text-slate-700">เหตุผลที่ไม่อนุมัติ (บังคับ)</label>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="เช่น ลดได้ไม่เกิน 5% จากราคาขั้นต่ำ · ให้เสนอรุ่นรองแทน"
              className="w-full bg-card border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/10"
            />
          </div>
        </Modal>
      )}
    </div>
  );
};
