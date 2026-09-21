// ─────────────────────────────────────────────────────────────────────────────
//  กล่อง "เพิ่มผู้ติดต่อใหม่" — ก้อน I3 ของ docs/plan-local-contacts.md
//
//  ปัญหาที่แก้: ลูกค้าเก่าส่งคนใหม่มาคุย แล้วออกใบให้เขาไม่ได้เลย ต้องรอให้มีคนไปคีย์ใน Odoo
//  แล้วรอบ sync ดึงกลับมาก่อน ซึ่งอาจเป็นวันถัดไป · หลังบ้านเสร็จตั้งแต่ก้อน I2 (5 เส้นใต้
//  /api/admin/webquote/contacts) กล่องนี้คือทางเข้าแรกที่ทำให้มันใช้ได้จริง
//
//  ── ข้อตัดสินของเจ้าของ 2026-09-21 (จาก mockup ชุด lc-*) ────────────────────
//  · ทางเข้า = **ท้ายรายการในกล่องเลือกผู้ติดต่อ** (ไม่ใช่ปุ่มข้างช่อง — ช่องบนใบกว้างแค่ 320px
//    และหัวใบตั้งใจให้อ่านเหมือนเอกสาร ไม่ใช่ฟอร์ม)
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
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { describeApiError } from './apiError';

/** แถวที่ server คืนกลับมาหลังเพิ่มสำเร็จ — เท่าที่หน้าจอใช้ */
interface CreatedContact {
  contact_id: number;
  contact_name: string;
}

interface Props {
  companyId: number;
  companyName: string;
  /** รหัสลูกค้า — มีไว้ยืนยันว่ากำลังเพิ่มใต้บริษัทที่ตั้งใจจริง (ชื่อบริษัทซ้ำกันได้) */
  companyRef?: string | null;
  /** ชื่อที่พิมพ์ค้างไว้ในช่องค้นหาตอนกด — ไม่ต้องพิมพ์ซ้ำ */
  initialName?: string;
  authHeaders: Record<string, string>;
  onClose: () => void;
  /** เพิ่มสำเร็จ หรือกด "ใช้คนเดิม" — ทั้งสองทางจบที่ "เลือกคนนี้ในใบ" เหมือนกัน */
  onPicked: (contactId: number, contactName: string) => void;
}

const MAX = { contact_name: 120, job_position: 120, contact_phone: 60, contact_email: 160 };

export const AddContactModal: React.FC<Props> = ({
  companyId, companyName, companyRef, initialName = '', authHeaders, onClose, onPicked,
}) => {
  const [name, setName] = useState(initialName);
  const [job, setJob] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** แถวเดิมที่ชื่อชนกัน — `null` = ยังไม่ชน · มีค่า = เสนอ "ใช้คนเดิม" */
  const [clash, setClash] = useState<CreatedContact | null>(null);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !busy;

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
      const res = await fetch('/api/admin/webquote/contacts', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          contact_name: trimmedName,
          job_position: job.trim() || null,
          contact_phone: phone.trim() || null,
          contact_email: email.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 409 && body?.detail?.existing) {
        const ex = body.detail.existing;
        setClash({ contact_id: Number(ex.contact_id), contact_name: String(ex.contact_name) });
        return;
      }
      if (!res.ok) {
        setError(describeApiError(body, 'เพิ่มผู้ติดต่อไม่สำเร็จ'));
        return;
      }
      const created: CreatedContact = body.contact;
      onPicked(Number(created.contact_id), String(created.contact_name));
    } catch {
      setError('ติดต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่อีกครั้ง');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      icon={UserPlus}
      title="เพิ่มผู้ติดต่อใหม่"
      size="lg"
      // กำลังเขียนอยู่ = ปิดกลางคันไม่ได้ (กติกาเดียวกับอีก 4 กล่องที่ใช้ Modal.tsx)
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="neutral" size="md" disabled={busy} onClick={onClose}>
            ยกเลิก
          </Button>
          <Button variant="primary" size="md" icon={UserPlus} busy={busy} disabled={!canSubmit} onClick={submit}>
            เพิ่มผู้ติดต่อ
          </Button>
        </>
      }
    >
      {/* Modal.tsx ไม่ใส่ padding ให้เนื้อใน — ลืมแล้วสระบนของภาษาไทยจะโดนเฉือนที่ขอบ */}
      <div className="p-5 space-y-4">
        {/* บริษัท = อ่านอย่างเดียว · นี่คือขอบเขตของทั้งฟีเจอร์ ไม่ใช่ช่องที่ลืมทำ */}
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs">
          <span className="text-slate-400 shrink-0">เพิ่มใต้บริษัท</span>
          <span className="font-bold text-slate-800 min-w-0 break-words">{companyName}</span>
          {companyRef && <span className="ml-auto shrink-0 text-slate-400">{companyRef}</span>}
        </div>

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
            autoFocus
            value={name}
            maxLength={MAX.contact_name}
            disabled={busy}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="เช่น คุณมานี รักดี"
            className={`w-full h-9 px-3 rounded-xl border text-sm bg-card text-slate-800 outline-none focus:ring-2 focus:ring-[var(--brand-fg)]/20 ${
              clash ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 focus:border-[var(--brand-fg)]'
            }`}
          />
          <p className="text-[11px] text-slate-400">
            พิมพ์ให้ตรงกับที่จะคีย์ใน Odoo — ชื่อที่ไม่ตรงกันทำให้ใบนำเข้าไม่ได้
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
              disabled={busy}
              onChange={(e) => setJob(e.target.value)}
              placeholder="เช่น ฝ่ายจัดซื้อ"
              className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-card text-sm text-slate-800 outline-none focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/20"
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
              disabled={busy}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="เช่น 081-234-5678"
              className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-card text-sm text-slate-800 outline-none focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/20"
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
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="เช่น purchase@example.co.th"
            className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-card text-sm text-slate-800 outline-none focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/20"
          />
        </div>

        <p className="text-[11px] text-slate-400">
          ผู้ติดต่อนี้จะเข้าคิว “ต้องคีย์เข้า Odoo” ให้เอง — ไม่มีใครต้องมากดปิดสถานะทีหลัง
        </p>
      </div>
    </Modal>
  );
};
