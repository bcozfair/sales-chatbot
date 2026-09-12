// ─────────────────────────────────────────────────────────────────────────────
//  ช่องเลือก "คน" แบบพิมพ์ค้นหา — ใช้ร่วมกันทั้งฝั่งผู้เสนอราคาและฝั่งพนักงานขาย
//
//  ทำไมแยกไฟล์: เดิมฝั่งผู้เสนอราคาเป็น combobox ค้นหาได้ (70 ชื่อ) แต่ฝั่งพนักงานขาย
//  เป็น <select> ธรรมดา — คนละพฤติกรรมทั้งที่เป็นงานเดียวกัน (เลือกคนจากรายชื่อยาว)
//  เจ้าของสั่งให้ใช้ตัวเดียวกัน (2026-09-12) ถ้าก๊อปเป็นตัวที่สองไว้ในไฟล์เดิม
//  ทุกการแก้ต้องแก้สองที่ตลอดไป — เหมือนเหตุผลของ ProductComboBox / ScopeComboBox
//
//  กติกาของตัวนี้ที่ต่างจาก ScopeComboBox (ซึ่งเลือก "ค่า" ไม่ใช่ "คน"):
//    · ปุ่มโชว์ ชื่อ + รหัส + เบอร์ ในบรรทัดเดียว ⇒ ไม่ต้องมีบรรทัดเบอร์แยกใต้ช่อง
//    · ค้นได้ทั้ง ชื่อ · รหัส · เบอร์ ⇒ พิมพ์อะไรที่จำได้ก็เจอ ไม่ต้องจำชื่อเต็ม
//    · ไม่มีปุ่มล้างค่า — สองช่องนี้ "ต้องมีคน" เสมอ การล้างเป็นสถานะที่ออกใบไม่ได้
//
//  ทำไม "ไม่มีเบอร์" ขึ้นสีเตือนเองโดยไม่ต้องมี prop สั่ง: เบอร์ของทั้งสองฝั่งไปโผล่บน PDF
//  (`buildSignatureBlocksHtml`) และฝั่งพนักงานขายที่ไม่มีเบอร์จะพิมพ์คำว่า `( เบอร์โทร )`
//  ให้ลูกค้าเห็นคาใบ ⇒ เบอร์ว่างเป็นเรื่องต้องรู้ "ก่อนกดเลือก" เสมอ ไม่ใช่ข้อมูลประกอบ
//  จึงเตือนทั้งในช่องและในรายชื่อ — เลิกเปิดให้ call site เลือกว่าจะเตือนไหม เพราะลืมได้
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Search } from 'lucide-react';

export interface PersonOption {
  /** ค่าที่ส่งกลับเวลาเลือก */
  id: string;
  name: string;
  /** รหัสพนักงาน — สิ่งที่คนในร้านใช้เรียกกันแทนชื่อ (ฝั่งผู้เสนอราคาไม่มี) */
  code?: string | null;
  /** เบอร์โทร — ขึ้นบน PDF ⇒ ว่างแล้วขึ้นสีเตือนเอง ดูเหตุผลที่หัวไฟล์ */
  phone?: string | null;
}

interface Props {
  /**
   * คนที่เลือกอยู่ — เป็น "ของจริงจาก server" ไม่ใช่ค่าที่ไปค้นใน options
   * เพราะชื่อที่บันทึกไว้แล้วอาจไม่อยู่ในรายชื่อรอบนี้ (คนลาออก/Odoo ไม่ส่งมา)
   * ถ้าไปหาใน options แล้วไม่เจอ ช่องจะกลายเป็น "ยังไม่เลือก" ทั้งที่ใบมีชื่อคนนี้อยู่
   */
  value: PersonOption | null;
  options: PersonOption[];
  onPick: (opt: PersonOption) => void;
  /** ข้อความตอนยังไม่เลือก — เขียนให้บอกด้วยว่าไม่เลือกแล้วจะเป็นอะไร */
  placeholder: string;
  /** ข้อความตอนค้นไม่เจอ — บอกด้วยว่ารายชื่อมาจากไหน คนอ่านจะรู้ว่าต้องไปแก้ที่ไหน */
  emptyText: string;
  ariaLabel: string;
  busy?: boolean;
  /** ยังไม่เลือกทั้งที่จำเป็น ⇒ กรอบสีเตือน (แทนป้ายเตือนแยกก้อน) */
  invalid?: boolean;
  /** หมายเหตุใต้รายการ — โชว์ตอนกางเท่านั้น เพราะมันอธิบาย "รายชื่อ" ไม่ใช่ "ค่าที่เลือก" */
  footer?: React.ReactNode;
}

/**
 * รหัส + เบอร์ ของคนคนหนึ่ง — ใช้ทั้งในช่องที่เลือกแล้วและในรายชื่อตอนกาง
 * ที่เดียวโดยตั้งใจ: ถ้าสองที่แสดงไม่เหมือนกัน คนจะนึกว่าเป็นข้อมูลคนละชุด
 */
const PersonFacts: React.FC<{ person: PersonOption }> = ({ person }) => (
  <span className="flex items-baseline gap-2 shrink-0 text-xs whitespace-nowrap">
    {person.code && <span className="text-slate-500">{person.code}</span>}
    <span className={person.phone ? 'text-slate-500' : 'text-amber-700 font-medium'}>
      {person.phone || 'ไม่มีเบอร์'}
    </span>
  </span>
);

export const PersonComboBox: React.FC<Props> = ({
  value,
  options,
  onPick,
  placeholder,
  emptyText,
  ariaLabel,
  busy,
  invalid,
  footer,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => `${o.name} ${o.code ?? ''} ${o.phone ?? ''}`.toLowerCase().includes(q))
    : options;

  const frame = open
    ? 'border-[var(--brand-fg)] ring-2 ring-[var(--brand-fg)]/10 bg-card'
    : invalid
      ? 'border-amber-300 bg-amber-50/60 hover:border-amber-400'
      : 'border-slate-200 bg-slate-50 hover:border-slate-300';

  return (
    <div className="relative flex-1 min-w-0" ref={boxRef}>
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
          }
        }}
        className={`flex items-center gap-2 w-full h-10 px-3 rounded-xl border text-sm cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-fg)]/30 ${frame}`}
      >
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        {open ? (
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setOpen(false);
                setQuery('');
              }
            }}
            placeholder="พิมพ์ชื่อ รหัส หรือเบอร์เพื่อค้นหา..."
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-800 placeholder:text-slate-400"
          />
        ) : value ? (
          <span className="flex flex-1 items-baseline gap-2 min-w-0">
            <span className="font-semibold text-slate-800 truncate">{value.name}</span>
            <PersonFacts person={value} />
          </span>
        ) : (
          <span className={`flex-1 truncate ${invalid ? 'text-amber-700' : 'text-slate-400'}`}>{placeholder}</span>
        )}
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0" />
        ) : (
          <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full min-w-[260px] bg-card border border-slate-200 rounded-xl shadow-xl overflow-hidden">
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-center text-xs text-slate-400">{emptyText}</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onPick(o);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={`w-full text-left px-3.5 py-2.5 text-sm flex items-center justify-between gap-2 ${
                    o.id === value?.id ? 'bg-emerald-50 text-[var(--brand-fg)] font-semibold' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="truncate">{o.name}</span>
                  <PersonFacts person={o} />
                </button>
              ))
            )}
          </div>
          {footer && <div className="border-t border-slate-100 bg-slate-50 px-3.5 py-2 text-[11px] text-slate-500">{footer}</div>}
        </div>
      )}
    </div>
  );
};
