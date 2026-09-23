/**
 * IssuerNameField — ช่อง "ชื่อผู้เสนอราคา" ที่เลือกจากรายชื่อ Odoo ได้และพิมพ์เองก็ได้
 *
 * ทำไมไม่ใช้ `ComboBox` ของ `PersonComboBox.tsx`: ตัวนั้นเป็น **รายการปิด** — ค่าที่ได้ต้องเป็น
 * option เท่านั้น ส่วนช่องนี้ต้องยอมให้พิมพ์ชื่อที่ยังไม่มีในรายชื่อได้ (แล้วผู้เรียกเตือนเอง)
 * เพราะรายชื่อมาจาก `sale_orders` ⇒ คนที่ยังไม่เคยมีใบสั่งขายจะไม่มีชื่อ และการบล็อกไม่ให้
 * สร้างบัญชีเพราะเหตุนี้แรงเกินกว่าที่ปัญหาเป็นจริง
 *
 * ⚠️ **ห้าม normalize ค่าที่พิมพ์** (ไม่ trim ไม่ยุบช่องว่าง) — ค่านี้ถูกเทียบ *ตรงตัวทุกอักขระ*
 * กับรายชื่อฝั่ง Odoo ทั้งที่ server (`isValidQuotationMaker`) และตอนนำเข้าไฟล์ export
 * ชื่อจริงหลายชื่อมีเว้นวรรคซ้อน (`ยุพาทิพย์  ผลรัก`) ซึ่งต้องรอดไปถึงปลายทางเหมือนเดิม
 *
 * ต้นแบบของหน้าตานี้คือช่อง `employee_name` ใน `Salespersons.tsx` ซึ่งยังถือสำเนาของตัวเองอยู่ —
 * การย้ายหน้านั้นมาใช้ไฟล์นี้เป็นงานของตัวเอง ไม่ใช่ผลข้างเคียงของงานที่ทำให้ไฟล์นี้เกิด
 * (`docs/design.md` ข้อ 3)
 */
import React, { useState } from 'react';
import { X } from 'lucide-react';

export interface IssuerNameOption {
  name: string;
  phone: string | null;
  /** รหัสพนักงานขายของชื่อนี้ — ว่าง = ชื่อนี้ไม่ใช่พนักงานขาย */
  salesperson_ids: string[];
}

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: IssuerNameOption[];
  placeholder: string;
  disabled?: boolean;
  /** โชว์รหัสพนักงานขายท้ายแต่ละแถวแทนเบอร์โทร — ใช้ตอนช่องนี้ทำหน้าที่ "เลือกตัวพนักงานขาย" */
  showCodes?: boolean;
  ariaLabel: string;
}

const MAX_SUGGESTIONS = 50;

export const IssuerNameField: React.FC<Props> = ({
  id, value, onChange, options, placeholder, disabled, showCodes, ariaLabel,
}) => {
  const [open, setOpen] = useState(false);

  const q = value.trim().toLowerCase();
  const suggestions = options
    .filter((o) => q === '' || o.name.toLowerCase().includes(q))
    .slice(0, MAX_SUGGESTIONS);

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        autoComplete="off"
        maxLength={255}
        value={value}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // หน่วงก่อนหุบ ไม่งั้น blur ชนะ click ของแถวในรายการแล้วเลือกไม่ติด
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full bg-card border border-slate-200 rounded-xl pl-4 pr-9 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/10 transition-all disabled:opacity-50"
      />

      {value !== '' && !disabled && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
          aria-label="ล้างชื่อ"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-52 overflow-y-auto bg-card border border-slate-200 rounded-xl shadow-lg">
          {suggestions.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-slate-400 italic">
              ไม่พบชื่อนี้ในรายชื่อจาก Odoo — พิมพ์เองได้ตามปกติ
            </div>
          ) : (
            suggestions.map((o) => (
              <button
                key={o.name}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onChange(o.name); setOpen(false); }}
                className="w-full flex items-center justify-between gap-3 text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 transition-colors"
              >
                <span className="text-sm text-slate-800 min-w-0 truncate">{o.name}</span>
                {showCodes ? (
                  <span className="text-[11px] font-mono font-semibold text-[var(--brand-fg)] shrink-0">
                    {o.salesperson_ids.join(' · ') || '—'}
                  </span>
                ) : (
                  <span className="text-[11px] font-mono text-slate-400 shrink-0">{o.phone || 'ไม่มีเบอร์'}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
