// ─────────────────────────────────────────────────────────────────────────────
//  ชั้นยืนยันก่อนออกใบจริง — เด้งเมื่อใบชุดนี้ "ติดด่านตรวจ" หรือ "ต้องแก้มือใน Odoo"
//
//  ทำไมต้องมี (2026-09-15): เจ้าของสั่งให้หน้าเว็บ **ทะลุด่านตรวจได้ทุกข้อ** แต่ยังต้องเห็น
//  คำเตือนครบเหมือนเดิม ⇒ คำเตือนที่ไม่หยุดมือใครเลยคือคำเตือนที่ถูกอ่านข้ามภายในสัปดาห์แรก
//  กล่องนี้จึงเป็นที่ที่ "เห็น" กับ "ตัดสินใจ" เกิดขึ้นพร้อมกัน แล้วบันทึกไว้กับใบว่าใครกด
//
//  **สองส่วนในกล่องเดียวเป็นคนละเรื่องกันโดยสิ้นเชิง** — นี่คือจุดที่รอบแรกเข้าใจผิดแล้วเจ้าของ
//  แก้ให้ ห้ามยุบกลับเป็นเรื่องเดียว:
//
//    ส่วนที่ 1 · กฎที่จะทะลุ     ผิดกติกาของร้าน แต่ข้อมูลตรงฐาน Odoo ทุกช่อง
//                               ⇒ นำเข้าได้เลย **ยังอยู่ในไฟล์ส่งออกปกติ**
//                               ⇒ ต้องติ๊กรับทราบ เพราะคนกดกำลังข้ามกติกาที่ร้านตั้งไว้เอง
//
//    ส่วนที่ 2 · ต้องแก้มือ      ค่าในไฟล์ไม่มีอยู่ในฐาน Odoo (เครดิตที่ตั้งเอง ฯลฯ)
//                               ⇒ **ถูกกันออกจากไฟล์ปกติ** ไปอยู่เมนู "ต้องแก้มือก่อน"
//                               ⇒ ไม่ต้องติ๊ก เพราะไม่ได้ขออนุญาตข้ามอะไร แค่บอกให้รู้ว่าจะเกิดอะไร
//
//  ถ้อยคำของแต่ละบรรทัดมาจาก server ทั้งหมด (`display_message`) — หน้าจอไม่ประกอบประโยคเอง
//  ด้วยเหตุผลเดียวกับที่ `buildViolationDisplay` มีอยู่: สองที่ที่พูดคนละคำคือสองที่ที่ต้องแก้คนละรอบ
// ─────────────────────────────────────────────────────────────────────────────
import React, { useId, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Pencil } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

export interface IssueViolation {
  type: string;
  model: string;
  display_message: string;
}

export interface IssueManualReason {
  kind: string;
  display_message: string;
}

interface Props {
  violations: IssueViolation[];
  manualReasons: IssueManualReason[];
  /** จำนวนใบที่จะออกจริง + ชื่อบริษัทของแต่ละใบ — คนกดต้องรู้ว่ากดครั้งนี้ออกกี่เอกสาร */
  quoteLabels: string[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmIssueModal: React.FC<Props> = ({
  violations, manualReasons, quoteLabels, busy, onCancel, onConfirm,
}) => {
  const ackId = useId();
  const [acked, setAcked] = useState(false);

  // ติ๊กรับทราบเฉพาะตอนที่มีกฎจะทะลุ — ใบที่แค่ต้องแก้มือไม่ได้ข้ามกติกาอะไร
  // การบังคับติ๊กในกรณีที่ไม่มีอะไรให้ยอมรับ คือการฝึกให้คนติ๊กโดยไม่อ่าน
  const needAck = violations.length > 0;
  const title = [
    violations.length > 0 ? `ติดด่านตรวจ ${violations.length} ข้อ` : '',
    manualReasons.length > 0 ? `ต้องแก้มือใน Odoo ${manualReasons.length} เรื่อง` : '',
  ].filter(Boolean).join(' · ');

  return (
    <Modal
      icon={AlertTriangle}
      tone="danger"
      size="lg"
      title={`ยืนยันออกใบ — ${title}`}
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <Button variant="neutral" tone="soft" icon={Pencil} disabled={busy} onClick={onCancel}>
            กลับไปแก้
          </Button>
          <Button
            variant="danger"
            size="md"
            icon={CheckCircle2}
            busy={busy}
            disabled={needAck && !acked}
            onClick={onConfirm}
          >
            ยืนยันออกใบ
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-4 text-xs">
        <p className="text-slate-600">
          ใบที่จะออก <b className="text-slate-900">{quoteLabels.length} ใบ</b>
          {quoteLabels.length > 0 && <span className="text-slate-500"> ({quoteLabels.join(' · ')})</span>}
        </p>

        {violations.length > 0 && (
          <section className="space-y-1.5">
            {/* ไม่ใช้ `uppercase` เพราะหัวข้อฝั่งล่างมีคำว่า Odoo อยู่ — มันจะกลายเป็น "ODOO"
                ซึ่งเป็นคนละคำกับชื่อระบบที่ทุกจอในแอปเรียก (docs/design.md หัวข้อ 4) */}
            <h4 className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-slate-500">
              <Ban className="w-3.5 h-3.5" />
              ส่วนที่ 1 · กฎที่จะทะลุ — ต้องรับทราบ
            </h4>
            <ul className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 list-disc space-y-1 text-red-700">
              {violations.map((v, i) => (
                <li key={`${v.type}-${v.model}-${i}`} className="ml-1">{v.display_message}</li>
              ))}
            </ul>
            <label
              htmlFor={ackId}
              className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-slate-300 bg-slate-50 cursor-pointer"
            >
              <input
                id={ackId}
                type="checkbox"
                checked={acked}
                disabled={busy}
                onChange={(e) => setAcked(e.target.checked)}
                className="mt-px w-4 h-4 shrink-0 accent-[var(--btn-danger-bg)]"
              />
              <span className="font-bold text-slate-700">
                ข้าพเจ้าอ่านครบทุกข้อแล้ว และยืนยันออกใบทั้งที่ติดด่านตรวจ {violations.length} ข้อ
              </span>
            </label>
          </section>
        )}

        {manualReasons.length > 0 && (
          <section className="space-y-1.5">
            <h4 className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-slate-500">
              <AlertTriangle className="w-3.5 h-3.5" />
              ส่วนที่ 2 · ต้องแก้มือใน Odoo — แค่บอกให้รู้
            </h4>
            <ul className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 list-disc space-y-1 text-amber-800">
              {manualReasons.map((r, i) => (
                <li key={`${r.kind}-${i}`} className="ml-1">{r.display_message}</li>
              ))}
            </ul>
          </section>
        )}

        <div className="space-y-1.5">
          <p className="text-slate-600">กดยืนยันแล้วจะเกิดสิ่งเหล่านี้:</p>
          <ul className="pl-5 list-disc space-y-1 text-slate-600 leading-relaxed">
            <li>ออกเลขที่ใบจริง <b className="text-slate-900">ย้อนกลับไม่ได้</b> (แก้ได้ด้วยการทำ revision ใบใหม่เท่านั้น)</li>
            {violations.length > 0 && (
              <li>บันทึกชื่อผู้ยืนยัน เวลา และรายการกฎที่ทะลุครบทุกข้อไว้กับใบ — กรองดูย้อนหลังได้ที่หน้าประวัติ</li>
            )}
            {manualReasons.length > 0 && (
              <li>
                ใบชุดนี้ <b className="text-slate-900">จะไม่อยู่ในไฟล์ส่งออก Odoo ชุดปกติ</b> —
                ต้องแก้ใน Odoo ก่อน แล้วส่งออกจากเมนู “ต้องแก้มือก่อน”
              </li>
            )}
          </ul>
        </div>
      </div>
    </Modal>
  );
};
