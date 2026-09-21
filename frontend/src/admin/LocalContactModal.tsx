// ─────────────────────────────────────────────────────────────────────────────
//  กล่อง "เพิ่ม / แก้ไข ผู้ติดต่อที่แอดมินเพิ่มเอง" + กล่องยืนยันก่อนลบ
//  ก้อน I3 ของ docs/plan-local-contacts.md (เพิ่ม) · ส่วนแก้ไข/ลบเพิ่มเข้ามา 2026-09-21
//
//  ปัญหาที่แก้: ลูกค้าเก่าส่งคนใหม่มาคุย แล้วออกใบให้เขาไม่ได้เลย ต้องรอให้มีคนไปคีย์ใน Odoo
//  แล้วรอบ sync ดึงกลับมาก่อน ซึ่งอาจเป็นวันถัดไป · หลังบ้านเสร็จตั้งแต่ก้อน I2 (6 เส้นใต้
//  /api/admin/webquote/contacts) กล่องนี้คือทางเข้าที่ทำให้มันใช้ได้จริง
//
//  ── ข้อตัดสินของเจ้าของ 2026-09-21 (จาก mockup ชุด lc-*) ────────────────────
//  · ทางเข้า "เพิ่ม" = **ท้ายรายการในกล่องเลือกผู้ติดต่อ** (ไม่ใช่ปุ่มข้างช่อง — ช่องบนใบกว้าง
//    แค่ 320px และหัวใบตั้งใจให้อ่านเหมือนเอกสาร ไม่ใช่ฟอร์ม)
//  · ทางเข้า "แก้ไข/ลบ" = **ไอคอนข้างช่องผู้ติดต่อ โผล่เฉพาะตอนที่คนที่เลือกอยู่เป็นคนที่เพิ่มเอง**
//    (เจ้าของเคาะรอบสอง 2026-09-21) — อยู่ตรงจังหวะที่เพิ่งเพิ่มแล้วพิมพ์ผิด แก้ได้ทันทีโดย
//    ไม่ต้องออกจากใบ
//  · เพิ่มเสร็จแล้ว **เลือกคนนั้นในใบให้ทันที** — คนกดเพิ่มเพราะกำลังจะออกใบให้เขาอยู่แล้ว
//  · **เก็บช่อง "ตำแหน่งงาน" ไว้** ถึงมันจะไม่ขึ้นบนใบและไม่ขึ้นใน PDF — ปลายทางเดียวของมันคือ
//    ไฟล์ที่แอดมินเอาไปคีย์ใน Odoo และคนคีย์ต้องกรอกช่อง Job Position ให้ครบ
//  · คำบนปุ่ม = "เพิ่มผู้ติดต่อใหม่"
//
//  ── สิ่งที่กล่องนี้จงใจไม่มี ─────────────────────────────────────────────────
//  · **ช่องบริษัท** — เพิ่มได้เฉพาะผู้ติดต่อใต้บริษัทที่มีอยู่แล้ว สร้างบริษัทใหม่ไม่ได้
//    (server ตรวจซ้ำด้วย `companyExistsInDirectory()` ⇒ ไม่ใช่แค่การซ่อนช่อง)
//  · **ช่องทีมขาย** — สืบทอดจากบริษัทตอนอ่าน ไม่มีใครส่งค่ามา (แผน §3.5)
//  · **ปุ่ม "คีย์เข้า Odoo แล้ว"** — ระบบตรวจเองจากของที่ Odoo ส่งกลับมา · ปุ่มติ๊กมือจะกลบ
//    กับดัก §7.4 ทั้งหมด: คนที่คีย์ชื่อผิดแล้วติ๊กว่าเสร็จ ทำให้ใบหลุดไปตกที่ปลายทางเงียบ ๆ
//
//  ⚠️ ชื่อซ้ำไม่ใช่ทางตัน — server คืน **แถวเดิม** มาใน `detail.existing` เพราะสิ่งที่คนกำลังจะทำ
//     คือ "ออกใบให้คนนี้" ไม่ใช่ "สร้างแถวใหม่" ⇒ กล่องเสนอปุ่ม "ใช้คนเดิม" ให้จบในคลิกเดียว
//
//  ⚠️ **สองข้อห้ามของโหมดแก้ไขเป็นของ server ไม่ใช่ของจอ** (§5.5) จอแค่บอกล่วงหน้าเพื่อไม่ให้
//     คนกดแล้วไปเจอ 409 เปล่า ๆ:
//       · เข้า Odoo แล้ว (`odoo_matched_at`) ⇒ แก้/ลบไม่ได้เลย ต้องไปแก้ที่ Odoo
//       · มีใบอ้างอยู่ (`quote_count > 0`) ⇒ **แก้ชื่อ**ไม่ได้และลบไม่ได้ แต่เบอร์/อีเมล/ตำแหน่ง
//         ยังแก้ได้ เพราะชื่อคือช่องเดียวที่ถูกตรึงลง snapshot ของใบและคอลัมน์ C ของไฟล์ไปแล้ว
//
//  ⚠️ โหลดแถวเดิมผ่าน `GET /contacts/:id` ไม่ใช่จากรายการในหน้าใบ — `/api/customer/:id/contacts`
//     คืนแค่ ชื่อ/เบอร์/อีเมล ไม่มี `job_position` ⇒ เติมจากตรงนั้นแล้วกดบันทึก ตำแหน่งงานจะถูก
//     เขียนทับเป็นว่างโดยที่คนแก้ไม่ได้ตั้งใจ
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { UserPlus, Pencil, Trash2, Lock, Loader2 } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { describeApiError } from './apiError';

/** แถวที่ server คืนกลับมา — เท่าที่หน้าจอใช้ */
interface ContactBrief {
  contact_id: number;
  contact_name: string;
}

interface EditRow extends ContactBrief {
  job_position: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  odoo_matched_at: string | null;
  quote_count: number;
}

interface Props {
  /** `null` = เพิ่มคนใหม่ · มีค่า = แก้ไขแถวเดิม (contact_id ของแถว local) */
  editId?: number | null;
  companyId: number;
  companyName: string;
  /** รหัสลูกค้า — มีไว้ยืนยันว่ากำลังเพิ่มใต้บริษัทที่ตั้งใจจริง (ชื่อบริษัทซ้ำกันได้) */
  companyRef?: string | null;
  /** ชื่อที่พิมพ์ค้างไว้ในช่องค้นหาตอนกด — ไม่ต้องพิมพ์ซ้ำ (โหมดเพิ่มเท่านั้น) */
  initialName?: string;
  authHeaders: Record<string, string>;
  onClose: () => void;
  /** เพิ่มสำเร็จ · บันทึกการแก้ไขสำเร็จ · หรือกด "ใช้คนเดิม" — ทั้งสามจบที่ "เลือกคนนี้ในใบ" */
  onPicked: (contactId: number, contactName: string) => void;
}

const MAX = { contact_name: 120, job_position: 120, contact_phone: 60, contact_email: 160 };

const INPUT_CLS =
  'w-full h-9 px-3 rounded-xl border border-slate-200 bg-card text-sm text-slate-800 outline-none ' +
  'focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/20 ' +
  'disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed';

export const LocalContactModal: React.FC<Props> = ({
  editId = null, companyId, companyName, companyRef, initialName = '', authHeaders, onClose, onPicked,
}) => {
  const editing = editId !== null;
  const [name, setName] = useState(editing ? '' : initialName);
  const [job, setJob] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** แถวเดิมที่ชื่อชนกัน — `null` = ยังไม่ชน · มีค่า = เสนอ "ใช้คนเดิม" */
  const [clash, setClash] = useState<ContactBrief | null>(null);
  /** โหมดแก้ไข: แถวที่โหลดมา — `null` ระหว่างยังโหลดไม่เสร็จ */
  const [row, setRow] = useState<EditRow | null>(null);
  const [loading, setLoading] = useState(editing);

  useEffect(() => {
    if (editId === null) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/webquote/contacts/${editId}`, { headers: authHeaders });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(describeApiError(body, 'โหลดข้อมูลผู้ติดต่อไม่สำเร็จ'));
          return;
        }
        const c: EditRow = body.contact;
        setRow(c);
        setName(String(c.contact_name ?? ''));
        setJob(String(c.job_position ?? ''));
        setPhone(String(c.contact_phone ?? ''));
        setEmail(String(c.contact_email ?? ''));
      } catch {
        if (!cancelled) setError('ติดต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่อีกครั้ง');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editId, authHeaders]);

  /** เข้า Odoo แล้ว = ทั้งกล่องอ่านอย่างเดียว (server ตอบ 409 อยู่แล้ว จอแค่ไม่พาไปชน) */
  const lockedByOdoo = !!row?.odoo_matched_at;
  /** ชื่อถูกตรึงลงใบไปแล้ว — ช่องอื่นยังแก้ได้ */
  const nameLocked = lockedByOdoo || (row?.quote_count ?? 0) > 0;
  const readOnly = lockedByOdoo || loading;

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !busy && !readOnly;

  /** แก้ชื่อเมื่อไหร่ คำเตือน "ชื่อซ้ำ" ของชื่อเก่าต้องหายไปด้วย ไม่งั้นมันค้างอยู่ผิดเรื่อง */
  const onNameChange = (v: string) => {
    setName(v);
    if (clash) setClash(null);
    if (error) setError(null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setClash(null);
    try {
      // โหมดแก้ไขไม่ส่ง company_id — ย้ายผู้ติดต่อข้ามบริษัทไม่ใช่สิ่งที่กล่องนี้ทำ
      const payload: Record<string, unknown> = {
        contact_name: trimmedName,
        job_position: job.trim() || null,
        contact_phone: phone.trim() || null,
        contact_email: email.trim() || null,
      };
      if (!editing) payload.company_id = companyId;

      const res = await fetch(
        editing ? `/api/admin/webquote/contacts/${editId}` : '/api/admin/webquote/contacts',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const body = await res.json().catch(() => ({}));

      if (res.status === 409 && body?.detail?.existing) {
        const ex = body.detail.existing;
        setClash({ contact_id: Number(ex.contact_id), contact_name: String(ex.contact_name) });
        return;
      }
      if (!res.ok) {
        setError(describeApiError(body, editing ? 'บันทึกไม่สำเร็จ' : 'เพิ่มผู้ติดต่อไม่สำเร็จ'));
        return;
      }
      const saved: ContactBrief = body.contact;
      onPicked(Number(saved.contact_id), String(saved.contact_name));
    } catch {
      setError('ติดต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่อีกครั้ง');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      icon={editing ? Pencil : UserPlus}
      title={editing ? 'แก้ไขผู้ติดต่อ' : 'เพิ่มผู้ติดต่อใหม่'}
      size="lg"
      // กำลังเขียนอยู่ = ปิดกลางคันไม่ได้ (กติกาเดียวกับอีก 4 กล่องที่ใช้ Modal.tsx)
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="neutral" size="md" disabled={busy} onClick={onClose}>
            {lockedByOdoo ? 'ปิด' : 'ยกเลิก'}
          </Button>
          {!lockedByOdoo && (
            <Button
              variant="primary"
              size="md"
              icon={editing ? Pencil : UserPlus}
              busy={busy}
              disabled={!canSubmit}
              onClick={submit}
            >
              {editing ? 'บันทึก' : 'เพิ่มผู้ติดต่อ'}
            </Button>
          )}
        </>
      }
    >
      {/* Modal.tsx ไม่ใส่ padding ให้เนื้อใน — ลืมแล้วสระบนของภาษาไทยจะโดนเฉือนที่ขอบ */}
      <div className="p-5 space-y-4">
        {/* บริษัท = อ่านอย่างเดียว · นี่คือขอบเขตของทั้งฟีเจอร์ ไม่ใช่ช่องที่ลืมทำ */}
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs">
          <span className="text-slate-400 shrink-0">{editing ? 'ใต้บริษัท' : 'เพิ่มใต้บริษัท'}</span>
          <span className="font-bold text-slate-800 min-w-0 break-words">{companyName}</span>
          {companyRef && <span className="ml-auto shrink-0 text-slate-400">{companyRef}</span>}
        </div>

        {loading && (
          <p className="flex items-center gap-2 px-1 py-4 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            กำลังโหลดข้อมูลผู้ติดต่อ…
          </p>
        )}

        {lockedByOdoo && (
          <div className="flex items-start gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
            <Lock className="w-3.5 h-3.5 shrink-0 mt-[2px]" />
            <span>
              <b className="text-slate-800">ผู้ติดต่อคนนี้มีอยู่ใน Odoo แล้ว</b> — แก้ที่ Odoo แทน
              <br />
              ระบบตรวจเจอเองจากรอบ sync จึงไม่ต้องมีใครมากดปิดสถานะ
            </span>
          </div>
        )}

        {clash && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            <p className="font-bold text-amber-900">บริษัทนี้มีผู้ติดต่อชื่อนี้อยู่แล้ว</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-800">{clash.contact_name}</span>
              <span className="ml-auto">
                <Button
                  variant="warning"
                  size="sm"
                  onClick={() => onPicked(clash.contact_id, clash.contact_name)}
                >
                  ใช้คนเดิม
                </Button>
              </span>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 whitespace-pre-wrap">
            {error}
          </p>
        )}

        <div className="space-y-1">
          <label htmlFor="lc-name" className="block text-[11.5px] font-semibold text-slate-500">
            ชื่อผู้ติดต่อ <span className="text-red-500">*</span>
          </label>
          <input
            id="lc-name"
            autoFocus={!editing}
            value={name}
            maxLength={MAX.contact_name}
            disabled={busy || readOnly || nameLocked}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="เช่น คุณมานี รักดี"
            className={
              clash
                ? INPUT_CLS.replace('border-slate-200', 'border-amber-300') + ' bg-amber-50/60'
                : INPUT_CLS
            }
          />
          <p className="text-[11px] text-slate-400">
            {nameLocked && !lockedByOdoo
              ? `แก้ชื่อไม่ได้ — มีใบเสนอราคาอ้างชื่อนี้อยู่ ${row?.quote_count} ใบ และชื่อถูกตรึงลงใบไปแล้ว`
              : 'พิมพ์ให้ตรงกับที่จะคีย์ใน Odoo — ชื่อที่ไม่ตรงกันทำให้ใบนำเข้าไม่ได้'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="lc-job" className="block text-[11.5px] font-semibold text-slate-500">
              ตำแหน่งงาน
            </label>
            <input
              id="lc-job"
              value={job}
              maxLength={MAX.job_position}
              disabled={busy || readOnly}
              onChange={(e) => setJob(e.target.value)}
              placeholder="เช่น ฝ่ายจัดซื้อ"
              className={INPUT_CLS}
            />
            <p className="text-[11px] text-slate-400">ไว้ให้คนคีย์กรอกช่อง Job Position</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="lc-phone" className="block text-[11.5px] font-semibold text-slate-500">
              โทรศัพท์
            </label>
            <input
              id="lc-phone"
              value={phone}
              maxLength={MAX.contact_phone}
              disabled={busy || readOnly}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="เช่น 081-234-5678"
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="lc-email" className="block text-[11.5px] font-semibold text-slate-500">
            อีเมล
          </label>
          <input
            id="lc-email"
            value={email}
            maxLength={MAX.contact_email}
            disabled={busy || readOnly}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="เช่น purchase@example.co.th"
            className={INPUT_CLS}
          />
        </div>

        <p className="text-[11px] text-slate-400">
          ผู้ติดต่อนี้จะเข้าคิว “ต้องคีย์เข้า Odoo” ให้เอง — ไม่มีใครต้องมากดปิดสถานะทีหลัง
        </p>
      </div>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
//  ยืนยันก่อนลบ
//
//  ไม่ต้องพิมพ์ชื่อยืนยันแบบกล่องลบใบเสนอราคา เพราะของสองอย่างนี้ต่างกันที่ความเสียหาย:
//  ใบที่ลบคือเอกสารที่ออกไปถึงลูกค้าแล้ว ส่วนแถวนี้คือชื่อที่เพิ่งพิมพ์เข้ามาเองและยังไม่มีใบไหน
//  อ้างถึง (server ปฏิเสธด้วย 409 ถ้ามี) ⇒ พิมพ์ยืนยันจะเป็นพิธีกรรมที่ไม่ได้กันอะไร
//
//  ⚠️ ด่านจริงทั้งสองข้ออยู่ที่ `deleteLocalContactById()` ฝั่ง server — กล่องนี้แค่แสดงคำตอบ
//     ของมันให้อ่านออก ไม่ได้ตัดสินเอง
// ─────────────────────────────────────────────────────────────────────────────
interface DeleteProps {
  contactName: string;
  companyName: string;
  busy: boolean;
  /** ข้อความจาก server (เช่น "มีใบเสนอราคาอ้างผู้ติดต่อคนนี้อยู่ 2 ใบ") */
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export const DeleteContactModal: React.FC<DeleteProps> = ({
  contactName, companyName, busy, error, onCancel, onConfirm,
}) => (
  <Modal
    icon={Trash2}
    tone="danger"
    title="ลบผู้ติดต่อที่เพิ่มเอง"
    onClose={busy ? undefined : onCancel}
    footer={
      <>
        <Button variant="neutral" size="md" disabled={busy} onClick={onCancel}>
          ยกเลิก
        </Button>
        <Button variant="danger" size="md" icon={Trash2} busy={busy} onClick={onConfirm}>
          ลบ
        </Button>
      </>
    }
  >
    <div className="p-5 space-y-3">
      <p className="text-sm text-slate-700">
        ลบ <b className="text-slate-900">{contactName}</b> ออกจากรายชื่อผู้ติดต่อของ{' '}
        <b className="text-slate-900">{companyName}</b> ใช่ไหม
      </p>
      <p className="text-xs text-slate-500">
        เขาจะหายจากทุกที่ที่ค้นหาผู้ติดต่อได้ รวมฝั่ง LINE และหายจากคิว “ต้องคีย์เข้า Odoo” ด้วย
        <br />
        ถ้ามีใบเสนอราคาอ้างเขาอยู่ ระบบจะไม่ยอมให้ลบ
      </p>
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 whitespace-pre-wrap">
          {error}
        </p>
      )}
    </div>
  </Modal>
);
