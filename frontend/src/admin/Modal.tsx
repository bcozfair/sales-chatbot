// ─────────────────────────────────────────────────────────────────────────────
//  เปลือกของกล่องโต้ตอบ (modal) ของ Admin — ที่เดียวที่รู้ว่ากล่องแบบนี้หน้าตายังไง
//
//  เกิดขึ้นตอนที่ของซ้ำจริงแล้ว ไม่ใช่ตอนเดาว่าจะซ้ำ (docs/design.md หัวข้อ 11):
//  2026-09-15 มีกล่องที่สองเกิดขึ้น (`ConfirmIssueModal` — ยืนยันออกใบทั้งที่ติดด่านตรวจ)
//  ⇒ ยุบเปลือกของ `ChangePasswordModal` ที่มีอยู่เดิมขึ้นมาเป็นของกลางในรอบเดียวกัน
//  ตามรูปแบบเดียวกับตอนที่ท้ายฟอร์มตั้งค่าซ้ำสองที่แล้วยุบเป็น `SettingsSaveBar` (2026-09-12)
//  **คลาสทุกตัวยกมาจากของเดิมทั้งดุ้น** — หน้าจอเปลี่ยนรหัสผ่านจึงหน้าตาเท่าเดิมทุกพิกเซล
//
//  สิ่งที่ไฟล์นี้ **ไม่** รับผิดชอบ: เนื้อข้างใน · ปุ่ม · การยิง API — ของพวกนั้นเป็นของแต่ละกล่อง
//  เพราะนั่นคือส่วนที่สองผู้ใช้ไม่เหมือนกันเลย (ฟอร์มเปลี่ยนรหัส กับ รายการกฎที่ทะลุ)
//
//  `onClose` = ปิดโดยที่ยังไม่ได้ตัดสินใจ (กากบาท · Esc) ⇒ กล่องไหนที่ปิดกลางคันไม่ได้
//  ส่ง `undefined` มาแล้วทั้งปุ่มกากบาทและ Esc จะหายไปพร้อมกัน ไม่ใช่ปิดได้ทางเดียวแต่อีกทางไม่ได้
//  · **ไม่ปิดเมื่อคลิกฉากหลังโดยตั้งใจ** — กล่องพวกนี้ถามคำถามที่กดพลาดแล้วเสียของ
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export type ModalTone = 'brand' | 'danger';

interface Props {
  /** ไอคอนหัวกล่อง — ส่ง component มา ไม่ใช่ element (แบบเดียวกับ prop `icon` ของ Button) */
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  /** สีของกรอบไอคอน — `danger` สำหรับกล่องที่ผลลัพธ์ย้อนยาก */
  tone?: ModalTone;
  /** ไม่ส่ง = ปิดกลางคันไม่ได้ (ไม่มีกากบาท และ Esc ไม่ทำงาน) */
  onClose?: () => void;
  /** แถบปุ่มท้ายกล่อง — ไม่ส่ง = กล่องนี้เอาปุ่มไว้ในเนื้อเอง (เช่นฟอร์มที่มีปุ่ม submit ของตัวเอง) */
  footer?: React.ReactNode;
  /** `md` = กล่องคำถามสั้น ๆ · `lg` = กล่องที่มีรายการให้อ่านก่อนตัดสินใจ */
  size?: 'md' | 'lg';
  children: React.ReactNode;
}

/** สีของกรอบไอคอน — คลาสของ Tailwind ทั้งคู่ ⇒ สลับตามธีมให้เองโดยไม่มี hex ใน .tsx */
const TONE: Record<ModalTone, string> = {
  brand: 'bg-[var(--brand-soft)] text-[var(--brand-fg)]',
  danger: 'bg-red-100 text-red-700',
};

export const Modal: React.FC<Props> = ({
  icon: Icon, title, tone = 'brand', onClose, footer, size = 'md', children,
}) => {
  // Esc ต้องปิดได้ทุกกล่องที่ปิดได้ — คนที่ใช้คีย์บอร์ดล้วนไม่มีทางอื่นถ้าไม่มีอันนี้
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${size === 'lg' ? 'max-w-lg' : 'max-w-md'} max-h-[90vh] flex flex-col bg-card rounded-2xl shadow-2xl border border-slate-200 overflow-hidden`}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 shrink-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${TONE[tone]}`}>
            <Icon className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 flex-1">{title}</h3>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="ปิด"
              className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* เนื้อเลื่อนได้ ส่วนหัวกับแถบปุ่มอยู่กับที่ — รายการกฎยาว ๆ บนจอเตี้ยต้องยังกดปุ่มได้ */}
        <div className="overflow-y-auto">{children}</div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
