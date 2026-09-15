import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search, X } from 'lucide-react';
import { DateInput } from './DateInput';

/**
 * แถบตัวกรองเหนือตาราง — การ์ดใบเดียวที่ทุกหน้าที่มีตารางใช้ร่วมกัน
 *
 * ทำไมถึงยกออกมาเป็นไฟล์กลาง ไม่ใช่ก๊อปจาก Quotations.tsx ไปวางทีละหน้า:
 *   ของชุดนี้เกิดที่หน้า "ประวัติใบเสนอราคา" ก่อน แล้วเจ้าของสั่งให้หน้ากลุ่ม "เงื่อนไข & กฎ"
 *   ใช้สไตล์เดียวกัน (2026-09-15) — สำเนา 7 ชุดคือของที่จะไม่ถูกแก้พร้อมกันในวันที่ต้นแบบถูกปรับ
 *   (AGENTS.md ข้อ A9 "สืบทอดก่อนประดิษฐ์") ⇒ หน้าประวัติใบเสนอราคาเองก็ย้ายมาใช้ตัวนี้ด้วย
 *   ไม่มีหน้าไหนถือสำเนาต้นแบบไว้คนเดียว
 *
 * ทำไมไม่ใช้ FilterCard/FilterField ของ admin/logs/ui.tsx:
 *   ชุดนั้นวาง "ป้ายกำกับเหนือช่อง" โดยตั้งใจ (placeholder หายตอนพิมพ์) ซึ่งเป็นกติกาของหน้ากลุ่มบันทึก
 *   ส่วนชุดนี้เป็นแถวเดียวไม่มีป้าย — เจ้าของเลือกหน้าตาแบบหลังให้กับหน้าตารางกฎ คนละแบบโดยตั้งใจ
 *   ไม่ใช่เพราะยังไม่ได้ไปรวมกัน
 *
 * ความสูงของช่องในแถบนี้ไม่ใช่ความสูงของปุ่มสั่งงาน (36px / `btn-h`) — มันคือความสูงของ "ช่องกรอก"
 * ตาม docs/design.md หัวข้อ 2.2 ห้ามไปจับให้เท่ากัน
 */

/** คลาสร่วมของทุกช่องในแถบ — กรอบ/พื้น/ความมน/สีโฟกัสต้องเป็นก้อนเดียว ไม่งั้นช่องใดช่องหนึ่งจะหลุดชุด */
const CONTROL =
  'w-full bg-card border border-slate-200 focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/10 focus:outline-none rounded-xl py-2.5 text-sm text-slate-800 transition-all';

interface FilterBarProps {
  /**
   * คลาสกริดของแถว — ส่งเป็นสตริงตรง ๆ จากหน้าที่เรียก (Tailwind สแกนจากซอร์ส จึงต้องเป็นค่าคงที่)
   * ตั้งต้น: มือถือ 1 คอลัมน์ → sm 2 → lg 3 ตามบันไดเบรกพอยต์เดิมของแอป
   */
  columns?: string;
  /** มีตัวกรองค้างอยู่หรือไม่ — ใช้ตัดสินว่าจะโชว์ปุ่ม "ล้างตัวกรองทั้งหมด" ไหม */
  active?: boolean;
  onClear?: () => void;
  children: React.ReactNode;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  columns = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  active,
  onClear,
  children,
}) => (
  <div className="bg-card border border-slate-200 rounded-2xl px-5 py-3.5 shadow-sm space-y-4">
    <div className={`grid gap-3 ${columns}`}>{children}</div>

    {active && onClear && (
      <button
        onClick={onClear}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 transition-colors font-semibold"
      >
        <X className="w-3.5 h-3.5" />
        ล้างตัวกรองทั้งหมด
      </button>
    )}
  </div>
);

/** ช่องค้นหา — ไอคอนแว่นอยู่ในช่องทางซ้ายเสมอ รูปแบบเดียวกันทุกหน้า */
export const FilterSearch: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  id?: string;
}> = ({ value, onChange, placeholder, id }) => (
  <div className="relative">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
    <input
      id={id}
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${CONTROL} pl-10 pr-3 placeholder-slate-400`}
    />
  </div>
);

/**
 * ช่องเลือก — ไอคอนบอก "ชนิดของตัวกรอง" อยู่ทางขวา ไม่ใช่ลูกศรลง
 * เพราะในแถวที่มีหลาย dropdown ลูกศรเหมือนกันหมดไม่ได้บอกอะไรเลยว่าช่องไหนกรองอะไร
 */
export const FilterSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  icon: LucideIcon;
  id?: string;
  'aria-label'?: string;
  children: React.ReactNode;
}> = ({ value, onChange, icon: Icon, id, 'aria-label': ariaLabel, children }) => (
  <div className="relative">
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${CONTROL} pl-3 pr-9 appearance-none cursor-pointer truncate`}
    >
      {children}
    </select>
    <Icon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
  </div>
);

/**
 * ช่วงวันที่ — "ตั้งแต่" กับ "ถึง" เป็นค่าคู่กันอยู่แล้ว จึงอยู่ในกรอบเดียว
 * ปฏิทินยังเป็น DateInput สองตัวแยกกัน กดเลือกทีละข้างได้ · โฟกัสเรืองทั้งกล่องด้วย focus-within
 */
export const FilterDateRange: React.FC<{
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  icon: LucideIcon;
  fromLabel?: string;
  toLabel?: string;
}> = ({ from, to, onFrom, onTo, icon: Icon, fromLabel = 'กรองตั้งแต่วันที่', toLabel = 'กรองถึงวันที่' }) => (
  <div className="flex items-center gap-1.5 bg-card border border-slate-200 focus-within:border-[var(--brand-fg)] focus-within:ring-2 focus-within:ring-[var(--brand-fg)]/10 rounded-xl pl-3 pr-2 py-2.5 text-sm text-slate-800 transition-all">
    <Icon className="w-4 h-4 shrink-0 text-slate-400 pointer-events-none" />
    <DateInput value={from} onChange={onFrom} aria-label={fromLabel} className="flex-1 min-w-0 overflow-hidden" />
    <span className="shrink-0 text-slate-400 select-none" aria-hidden="true">–</span>
    <DateInput value={to} onChange={onTo} aria-label={toLabel} className="flex-1 min-w-0 overflow-hidden" />
  </div>
);
