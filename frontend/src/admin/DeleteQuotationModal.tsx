// ─────────────────────────────────────────────────────────────────────────────
//  ชั้นยืนยันก่อนลบใบเสนอราคาถาวร — กล่องที่สี่ที่ใช้เปลือก `Modal` ร่วมกัน
//
//  ทำไมต้องพิมพ์เลขที่ใบ ไม่ใช่แค่กด "ยืนยัน" (เจ้าของสั่ง 2026-09-16): ปุ่มยืนยันในกล่อง
//  ที่หน้าตาเหมือนกันทุกกล่องถูกกดด้วยความเคยชินภายในสัปดาห์แรก — และกล่องนี้ต่างจากกล่องอื่น
//  ตรงที่กดพลาดแล้ว **ไม่มีทางกดกลับ** การพิมพ์เลขที่บังคับให้ตาไปอ่านว่ากำลังลบใบไหนอยู่จริง ๆ
//  ⇒ ถ้าวันหนึ่งมีคนเสนอให้ "ตัดขั้นตอนพิมพ์ออกเพราะเสียเวลา" นั่นคือการถอดสิ่งเดียวที่กล่องนี้มี
//
//  **ช่องพิมพ์นี้ไม่ใช่ด่านจริง** ด่านจริงอยู่ในเงื่อนไข SQL ของ `deleteQuotationByNo()` ฝั่ง server
//  ที่นี่คือความสะดวกของคนกด (ปลดล็อกปุ่มให้เห็นว่าพิมพ์ตรงแล้ว) — ยิง API ตรงโดยข้ามจอนี้
//  ก็ยังต้องส่งเลขที่ที่ตรงกับในฐานมาอยู่ดี
//
//  **ไม่ trim ค่าที่พิมพ์** ด้วยเหตุผลเดียวกับที่ server ไม่ทำ: ด่านนี้มีไว้ให้ "พิมพ์ผิดแล้วไม่ลบ"
//  การเก็บกวาดช่องว่างให้ผู้ใช้คือการทำให้ด่านหลวมลงโดยไม่ได้อะไรกลับมา
//
//  ใบที่ยังไม่มีเลขที่ไม่มีทางมาถึงกล่องนี้ — หน้าประวัติไม่แสดงปุ่มลบในแถวแบบนั้น
//  (เจ้าของเลือกเมื่อ 2026-09-16: ไม่มีอะไรให้พิมพ์ยืนยันก็ไม่มีด่าน และร่างพวกนั้นถูกกวาดทิ้งเอง
//   อยู่แล้วเมื่อผู้ขายเริ่มใบใหม่)
// ─────────────────────────────────────────────────────────────────────────────
import React, { useId, useState } from 'react';
import { AlertTriangle, Info, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

interface Props {
  /** ใบที่จะลบ — ต้องมีเลขที่เสมอ (แถวที่ไม่มีเลขที่ไม่มีปุ่มให้กด) */
  quotationNo: string;
  customerName: string;
  salespersonName: string;
  /** ยอดรวมที่จัดรูปแบบมาแล้วจากหน้าเรียก — กล่องนี้ไม่ถือกติกาการแสดงตัวเลขของตัวเอง */
  totalText: string;
  createdAtText: string;
  status: string;
  /** เคยลงไฟล์ส่งออก Odoo แล้วหรือยัง — มีผลแค่ "เตือน" ไม่ได้บล็อก */
  exported: boolean;
  /** รอบ sync เห็นใบนี้ในฐาน Odoo แล้ว — เตือนหนักกว่า exported เพราะของอยู่ปลายทางจริง */
  imported: boolean;
  odooSoId?: number | null;
  busy: boolean;
  /** ข้อความผิดพลาดจาก server (เช่น เลขที่ไม่ตรง / ใบถูกลบไปแล้ว) */
  error: string | null;
  onCancel: () => void;
  onConfirm: (typed: string) => void;
}

export const DeleteQuotationModal: React.FC<Props> = ({
  quotationNo, customerName, salespersonName, totalText, createdAtText, status,
  exported, imported, odooSoId, busy, error, onCancel, onConfirm,
}) => {
  const inputId = useId();
  const [typed, setTyped] = useState('');
  const matched = typed === quotationNo;

  return (
    <Modal
      icon={Trash2}
      tone="danger"
      title="ลบใบเสนอราคาถาวร"
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <Button variant="neutral" size="md" disabled={busy} onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button
            variant="danger"
            size="md"
            icon={Trash2}
            busy={busy}
            disabled={!matched}
            onClick={() => onConfirm(typed)}
          >
            ลบถาวร
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-4 text-xs">
        {/* สรุปใบอยู่บนสุด — คนต้องอ่านว่ากำลังลบใบไหนก่อนจะเห็นช่องพิมพ์ */}
        <dl className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-1.5">
          {[
            ['เลขที่', quotationNo],
            ['ลูกค้า', customerName || '-'],
            ['ผู้ขาย', salespersonName || '-'],
            ['ยอดรวม', `${totalText} บาท`],
            ['วันที่ออก', createdAtText],
            ['สถานะ', status],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4">
              <dt className="text-slate-500 shrink-0">{label}</dt>
              <dd className="font-bold text-slate-900 text-right break-all">{value}</dd>
            </div>
          ))}
        </dl>

        <section className="flex gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
          <div className="space-y-1">
            <p className="font-bold">ลบแล้วเอากลับมาไม่ได้</p>
            <ul className="pl-4 list-disc space-y-1 leading-relaxed">
              <li>ใบนี้จะหายจากหน้าประวัติ และดาวน์โหลด PDF ไม่ได้อีก</li>
              <li>เลขที่ <b>{quotationNo}</b> จะไม่ถูกนำกลับมาใช้ซ้ำ</li>
              <li>ระบบบันทึกไว้ว่าใครลบเมื่อไหร่ พร้อมสำเนาทั้งใบ — ดูได้ที่ “บันทึกการแก้ไข”</li>
            </ul>
          </div>
        </section>

        {/* เตือนเรื่อง Odoo แยกกล่อง เพราะเป็นคนละเรื่องกับ "ลบแล้วไม่คืน" —
            อันบนคือผลกับระบบนี้ อันนี้คือของที่อยู่นอกระบบนี้และเราตามไปลบให้ไม่ได้ */}
        {(exported || imported) && (
          <section className="flex gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-800">
            <Info className="w-4 h-4 shrink-0 mt-px" />
            <div className="space-y-1">
              <p className="font-bold">
                {imported
                  ? `ใบนี้ถูกนำเข้า Odoo แล้ว${odooSoId ? ` (เอกสาร ${odooSoId})` : ''}`
                  : 'ใบนี้ลงไฟล์ส่งออก Odoo ไปแล้ว'}
              </p>
              <p className="leading-relaxed">
                การลบที่นี่ <b>ไม่ได้ลบเอกสารฝั่ง Odoo</b> ถ้าใบนั้นเข้าไปแล้วต้องไปจัดการใน Odoo เอง
                {' '}ส่วนประวัติว่าใบนี้เคยอยู่ในไฟล์ส่งออกชุดไหน ยังตรวจย้อนหลังได้เหมือนเดิม
              </p>
            </div>
          </section>
        )}

        <div>
          <label htmlFor={inputId} className="block font-bold text-slate-700 mb-1.5">
            พิมพ์ <span className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-red-700">{quotationNo}</span> เพื่อยืนยันการลบ
          </label>
          <input
            id={inputId}
            value={typed}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            placeholder="เลขที่ใบเสนอราคา"
            onChange={(e) => setTyped(e.target.value)}
            className={`w-full bg-card border rounded-xl px-3 py-2.5 text-sm tracking-wide text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 ${
              !typed
                ? 'border-slate-300 focus:border-[var(--brand-fg)] focus:ring-[var(--brand-fg)]/10'
                : matched
                  ? 'border-emerald-200 focus:border-emerald-500 focus:ring-emerald-500/10'
                  : 'border-red-300 focus:border-red-500 focus:ring-red-500/10'
            }`}
          />
          {/* สถานะบอกด้วยข้อความ ไม่ใช่สีขอบอย่างเดียว (docs/design.md ข้อ 10) */}
          <p className={`mt-1.5 min-h-4 ${!typed ? 'text-slate-400' : matched ? 'text-emerald-700' : 'text-red-600'}`}>
            {!typed
              ? 'พิมพ์ให้ตรงทุกตัวอักษร ปุ่มลบจึงจะกดได้'
              : matched
                ? 'ตรงแล้ว — กดปุ่มลบถาวรได้'
                : 'ยังไม่ตรงกับเลขที่ใบนี้'}
          </p>
        </div>

        {error && (
          <p className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-red-700 font-semibold">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};
