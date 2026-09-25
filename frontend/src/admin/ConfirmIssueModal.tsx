// ─────────────────────────────────────────────────────────────────────────────
//  ชั้นยืนยันก่อนออกใบจริง — เด้งเมื่อใบชุดนี้ "ต้องขออนุมัติราคา" · "ติดด่านตรวจ" หรือ "ต้องแก้มือใน Odoo"
//
//  ทำไมต้องมี (2026-09-15): เจ้าของสั่งให้หน้าเว็บ **ทะลุด่านตรวจได้ทุกข้อ** แต่ยังต้องเห็น
//  คำเตือนครบเหมือนเดิม ⇒ คำเตือนที่ไม่หยุดมือใครเลยคือคำเตือนที่ถูกอ่านข้ามภายในสัปดาห์แรก
//  กล่องนี้จึงเป็นที่ที่ "เห็น" กับ "ตัดสินใจ" เกิดขึ้นพร้อมกัน แล้วบันทึกไว้กับใบว่าใครกด
//
//  **สามส่วนในกล่องเดียวเป็นคนละเรื่องกันโดยสิ้นเชิง** — ส่วนที่ 1/2 คือจุดที่รอบแรกเข้าใจผิด
//  แล้วเจ้าของแก้ให้ ห้ามยุบกลับเป็นเรื่องเดียว:
//
//    ส่วนที่ 0 · ต้องขออนุมัติ   ราคาต่ำกว่าขั้นต่ำ — **ติ๊กรับทราบเองไม่ได้** (2026-09-15)
//                               ⇒ กดแล้วได้ "คำขอ" ไม่ใช่ "ใบ" · ปุ่มท้ายกล่องเปลี่ยนความหมายทั้งปุ่ม
//                               ⇒ อยู่บนสุดเพราะมันเปลี่ยนผลของการกดทั้งกล่อง ไม่ใช่รายละเอียดเสริม
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
import { AlertTriangle, Ban, BadgeCheck, CheckCircle2, Pencil, Send } from 'lucide-react';
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
  /**
   * ข้อที่ต้องให้ผู้อนุมัติตัดสิน (ราคาต่ำกว่าขั้นต่ำ) — มีข้อเดียวก็เปลี่ยนผลของปุ่มทั้งปุ่ม:
   * จาก "ออกใบเดี๋ยวนี้" เป็น "ส่งคำขอแล้วรอคนอื่น"
   */
  approvalRequired: IssueViolation[];
  /** เหตุผลที่ขอขายต่ำกว่าขั้นต่ำ — ผู้อนุมัติอ่านอันนี้ก่อนตัดสิน */
  note: string;
  onNoteChange: (v: string) => void;
  /** จำนวนใบที่จะออกจริง + ชื่อบริษัทของแต่ละใบ — คนกดต้องรู้ว่ากดครั้งนี้ออกกี่เอกสาร */
  quoteLabels: string[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmIssueModal: React.FC<Props> = ({
  violations, manualReasons, approvalRequired, note, onNoteChange, quoteLabels, busy, onCancel, onConfirm,
}) => {
  const ackId = useId();
  const noteId = useId();
  const [acked, setAcked] = useState(false);
  const needApproval = approvalRequired.length > 0;

  // ติ๊กรับทราบเฉพาะตอนที่มีกฎจะทะลุ — ใบที่แค่ต้องแก้มือไม่ได้ข้ามกติกาอะไร
  // การบังคับติ๊กในกรณีที่ไม่มีอะไรให้ยอมรับ คือการฝึกให้คนติ๊กโดยไม่อ่าน
  const needAck = violations.length > 0;
  const title = [
    needApproval ? `ต้องขออนุมัติราคา ${approvalRequired.length} รายการ` : '',
    violations.length > 0 ? `ติดด่านตรวจ ${violations.length} ข้อ` : '',
    manualReasons.length > 0 ? `ต้องแก้มือใน Odoo ${manualReasons.length} เรื่อง` : '',
  ].filter(Boolean).join(' · ');

  return (
    <Modal
      icon={AlertTriangle}
      tone="danger"
      size="lg"
      title={`${needApproval ? 'ส่งขออนุมัติราคา' : 'ยืนยันออกใบ'} — ${title}`}
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          {/* ช่องรับทราบอยู่แถวเดียวกับปุ่ม (เจ้าของสั่ง 2026-09-25) — ติ๊กแล้วกดต่อได้ทันที ไม่ต้องเลื่อนหา
              และไม่หลุดจากจอเมื่อรายการกฎยาว เพราะแถบปุ่มอยู่กับที่ · mr-auto ดันไปซ้ายสุด จอแคบตกบรรทัดเอง */}
          {needAck && (
            <label htmlFor={ackId} className="mr-auto flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
              <input
                id={ackId}
                type="checkbox"
                checked={acked}
                disabled={busy}
                onChange={(e) => setAcked(e.target.checked)}
                className="w-4 h-4 shrink-0 accent-[var(--btn-danger-bg)]"
              />
              ข้าพเจ้าอ่านครบแล้ว และยืนยันข้ามกฎ {violations.length} ข้อ
            </label>
          )}
          <Button variant="neutral" tone="soft" icon={Pencil} disabled={busy} onClick={onCancel}>
            แก้ไข
          </Button>
          <Button
            variant={needApproval ? 'warning' : 'danger'}
            size="md"
            icon={needApproval ? Send : CheckCircle2}
            busy={busy}
            disabled={needAck && !acked}
            onClick={onConfirm}
          >
            {needApproval ? 'ส่งขออนุมัติราคา' : 'ยืนยัน'}
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-4 text-xs">
        <p className="text-slate-600">
          {needApproval ? 'ใบที่จะขออนุมัติ ' : 'ใบที่จะออก '}
          <b className="text-slate-900">{quoteLabels.length} ใบ</b>
          {quoteLabels.length > 0 && <span className="text-slate-500"> ({quoteLabels.join(' · ')})</span>}
        </p>

        {needApproval && (
          <section className="space-y-1.5">
            <h4 className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-slate-500">
              <BadgeCheck className="w-3.5 h-3.5" />
              ต้องขออนุมัติราคา — ติ๊กรับทราบเองไม่ได้
            </h4>
            <ul className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-2.5 list-disc space-y-1 text-violet-800">
              {approvalRequired.map((v, i) => (
                <li key={`${v.type}-${v.model}-${i}`} className="ml-1">{v.display_message}</li>
              ))}
            </ul>
            <label htmlFor={noteId} className="block font-bold text-slate-700">
              เหตุผลที่ขอขายต่ำกว่าราคาขั้นต่ำ (ผู้อนุมัติจะอ่านข้อความนี้)
            </label>
            <textarea
              id={noteId}
              rows={2}
              value={note}
              disabled={busy}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="เช่น ลูกค้าเทียบราคากับเจ้าอื่น · ปิดยอดสิ้นเดือน · ของค้างสต็อกนาน"
              className="w-full bg-card border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/10"
            />
          </section>
        )}

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
          <p className="text-slate-600">{needApproval ? 'กดส่งแล้วจะเกิดสิ่งเหล่านี้:' : 'กดยืนยันแล้วจะเกิดสิ่งเหล่านี้:'}</p>
          <ul className="pl-5 list-disc space-y-1 text-slate-600 leading-relaxed">
            {needApproval ? (
              <>
                <li>
                  ใบชุดนี้ถูกบันทึกเป็น <b className="text-slate-900">ร่างที่รออนุมัติ</b> —
                  <b className="text-slate-900"> ยังไม่มีเลขที่ใบและยังไม่มี PDF</b>
                </li>
                <li>ผู้มีสิทธิ์อนุมัติจะเห็นคำขอในเมนู “อนุมัติราคา” — อนุมัติเมื่อไหร่ ใบจะถูกออกให้ทันที</li>
                <li>ถ้าไม่อนุมัติ คำขอจะกลับมาที่เมนูเดียวกันพร้อมเหตุผล ให้แก้แล้วส่งใหม่หรือยกเลิกได้</li>
                <li>ระหว่างรอ <b className="text-slate-900">แก้ใบชุดนี้ไม่ได้</b> — ต้องยกเลิกคำขอก่อน</li>
              </>
            ) : (
              <li>ออกเลขที่ใบจริง <b className="text-slate-900">ย้อนกลับไม่ได้</b> (แก้ได้ด้วยการทำ revision ใบใหม่เท่านั้น)</li>
            )}
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
