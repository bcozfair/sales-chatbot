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
//  ถ้อยคำ: ทุกส่วนใช้บรรทัดสั้นของหน้าเว็บ (ส่วนที่ 0 ย่อตามเจ้าของสั่ง 2026-09-25 เช่นกัน)
//  (`line` — `ruleLine()` ใน QuoteRequest.tsx · แบบ A ที่เจ้าของเลือก 2026-09-25) เพราะประโยคของ server
//  เป็นของ LINE ("…กรุณาติดต่อแอดมิน") ซึ่งไม่มีความหมายกับคนที่เป็นแอดมิน · ส่วนสินค้าของ `line` ใช้คำ
//  ชุดเดียวกับป้ายที่แถว ⇒ modal กับแถวยังพูดคำเดียวกัน
//
//  modal นี้เปิดเฉพาะ role ที่ **ข้ามได้** — ข้อที่ role นี้ข้ามไม่ได้ (blocked_keys) ปุ่มยืนยันจางตั้งแต่บนจอ
// ─────────────────────────────────────────────────────────────────────────────
import React, { useId, useState } from 'react';
import { AlertTriangle, CheckCircle2, Pencil, Send } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

export interface IssueViolation {
  type: string;
  model: string;
  display_message: string;
  /** บรรทัดสั้นของหน้าเว็บ (กลุ่ม · ข้อความ) — ไม่มี = ใช้ display_message */
  line?: { group: string; text: string };
}

export interface IssueManualReason {
  kind: string;
  value?: string | null;
  display_message: string;
}

/** เรื่องแก้มือหนึ่งเรื่องแบบสั้น — เครดิตที่ตั้งเองพูดด้วยค่าจริง ชนิดอื่นยังใช้ประโยคของ server */
const manualShort = (r: IssueManualReason) =>
  r.kind === 'payment_terms_override' && r.value ? `เครดิต “${r.value}” ตั้งเอง` : r.display_message;

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
    needApproval ? `ราคา ${approvalRequired.length} รายการ` : '',
    violations.length > 0 ? `ข้ามกฎ ${violations.length} ข้อ` : '',
    manualReasons.length > 0 ? 'แก้มือใน Odoo' : '',
  ].filter(Boolean).join(' · ');

  return (
    <Modal
      icon={AlertTriangle}
      tone="danger"
      size="lg"
      title={`${needApproval ? 'ขออนุมัติ' : 'ยืนยันออกใบ'} · ${title}`}
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
            {needApproval ? 'ขออนุมัติ' : 'ยืนยัน'}
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-3 text-xs">
        {/* ข้อเท็จจริงของการกด — บรรทัดเดียวทั้งสองกรณี (เจ้าของสั่ง 2026-09-25 · เดิมขออนุมัติเป็นรายการ 4 ข้อ) */}
        <p className="text-slate-600 leading-relaxed">
          {needApproval ? 'ขออนุมัติ ' : 'ออก '}
          <b className="text-slate-900">{quoteLabels.length} ใบ</b>
          {quoteLabels.length > 0 && <span className="text-slate-500"> ({quoteLabels.join(' · ')})</span>}
          {needApproval ? (
            <>
              {' · '}ได้เป็น<b className="text-slate-900">ร่างรออนุมัติ</b> ยังไม่มีเลขที่ใบ/PDF · อนุมัติแล้วออกใบให้ทันที ·
              ระหว่างรอแก้ใบไม่ได้
            </>
          ) : (
            <>
              {' · '}ออกเลขแล้ว<b className="text-slate-900">ย้อนกลับไม่ได้</b>
            </>
          )}
          {violations.length > 0 && ' · ชื่อผู้ข้ามกฎถูกบันทึกไว้กับใบ'}
        </p>

        {/* ราคาที่ต้องให้ผู้อนุมัติตัดสิน — รูปเดียวกับรายการกฎ (หนึ่งบรรทัดต่อข้อ) แต่สีม่วง เพราะจบคนละแบบ:
            ข้อนี้ติ๊กเองไม่ได้ ส่วนรายการแดงข้างล่างติ๊กรับทราบแล้วข้ามได้ */}
        {needApproval && (
          <ul aria-label="ราคาที่ต้องขออนุมัติ" className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-1.5 text-violet-800 divide-y divide-dashed divide-violet-200">
            {approvalRequired.map((v, i) => (
              <li key={`${v.type}-${v.model}-${i}`} className="grid grid-cols-[3.25rem_1fr] gap-2 py-1">
                <span className="text-[10.5px] font-bold text-slate-500 pt-px">{v.line?.group ?? 'ราคา'}</span>
                <span className="min-w-0 break-words">{v.line?.text ?? v.display_message}</span>
              </li>
            ))}
          </ul>
        )}

        {/* กฎที่จะข้าม — หนึ่งบรรทัดต่อข้อ มีคอลัมน์กลุ่ม (ลูกค้า/สินค้า) ให้กวาดตาได้ไว */}
        {violations.length > 0 && (
          <ul aria-label="กฎที่จะข้าม" className="bg-red-50 border border-red-200 rounded-xl px-3 py-1.5 text-red-700 divide-y divide-dashed divide-red-200">
            {violations.map((v, i) => (
              <li key={`${v.type}-${v.model}-${i}`} className="grid grid-cols-[3.25rem_1fr] gap-2 py-1">
                <span className="text-[10.5px] font-bold text-slate-500 pt-px">{v.line?.group ?? 'กฎ'}</span>
                <span className="min-w-0 break-words">{v.line?.text ?? v.display_message}</span>
              </li>
            ))}
          </ul>
        )}

        {/* คนละแกนกับกฎ: ใบยังนำเข้า Odoo ได้หรือไม่ — ไม่ต้องติ๊ก แค่บอกให้รู้ว่าใบจะไปอยู่ไหน */}
        {manualReasons.length > 0 && (
          <p className="flex items-start gap-1.5 text-amber-800 leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              {manualReasons.map(manualShort).join(' · ')} ⇒ ใบไปอยู่คิว <b>“ต้องแก้มือก่อน”</b> ไม่อยู่ในไฟล์ Odoo ชุดปกติ
            </span>
          </p>
        )}

        {/* เหตุผลอยู่ท้ายสุด ติดกับแถบปุ่ม — อ่านรายการครบแล้วค่อยพิมพ์ แล้วกดต่อได้เลย */}
        {needApproval && (
          <div className="space-y-1">
            <label htmlFor={noteId} className="block font-bold text-slate-700">
              เหตุผลที่ขอ <span className="font-normal text-slate-500">(ผู้อนุมัติจะอ่านข้อความนี้)</span>
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
          </div>
        )}
      </div>
    </Modal>
  );
};
