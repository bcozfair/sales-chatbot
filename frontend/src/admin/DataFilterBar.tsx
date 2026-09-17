import React from 'react';
import { Search, X } from 'lucide-react';
import { ComboBox, type ComboOption } from './PersonComboBox';

/**
 * แถบตัวกรองของหน้า "ข้อมูลสินค้า" / "ข้อมูลลูกค้า" — สองแถว ทุก dropdown พิมพ์ค้นหาได้
 *
 * ทำไมไม่ใช้ FilterBar.tsx ที่มีอยู่:
 *   ชุดนั้นเป็นแถวเดียวและ dropdown เป็น <select> ธรรมดา ซึ่งใช้กับหน้านี้ไม่ไหว —
 *   ตัวเลือกจริงมี "จังหวัด 157 · แบรนด์ 86 · เงื่อนไขชำระ 18" (วัด 2026-09-17)
 *   <select> ที่มี 157 ตัวเลือกคือรายการที่หาไม่เจอ ⇒ เจ้าของสั่งให้ทุกช่องพิมพ์ค้นหาได้
 *
 * ทำไมไม่สร้าง dropdown ใหม่เอง:
 *   ใช้ `ComboBox` ตัวเดียวกับช่องบริษัท/ผู้ติดต่อในหน้า "ขอใบเสนอราคา" (PersonComboBox.tsx)
 *   ⇒ คีย์บอร์ด ↑↓ Enter Esc · แถบนับรายการ · การปิดเมื่อคลิกนอกกล่อง เป็นพฤติกรรมเดียวกัน
 *   ทั้งแอป และถ้าวันหนึ่งมีคนปรับ ComboBox หน้านี้ได้ตามไปเอง
 *
 * รูปแบบสองแถวมาจากที่เจ้าของสั่งบน mockup (2026-09-17):
 *   แถวบน = ช่องค้นหา (กว้างสุด) + ตัวกรองที่ชี้ขาดที่สุดของจอนั้น
 *   แถวล่าง = ตัวกรองที่เหลือ กว้างเท่ากันหมด
 */

/** ตัวเลือกของตัวกรอง — `id` คือค่าที่ส่งไป API, `''` = ไม่กรอง */
export interface FilterOption extends ComboOption {
  /** จำนวนแถวที่ตรงกับตัวเลือกนี้ — ช่วยให้รู้ก่อนกดว่ากรองแล้วจะเหลือเท่าไร */
  count?: number;
}

/**
 * ตัวกรองแบบพิมพ์ค้นหา
 *
 * ต่างจาก ComboBox ตอนใช้เป็น "ช่องเลือกที่ต้องมีค่า" ตรงที่ตัวนี้ **มีตัวเลือกล้างค่าเสมอ**
 * (ของเดิมจงใจไม่มีปุ่มล้าง เพราะสองช่องนั้นออกใบไม่ได้ถ้าไม่เลือกคน — คนละเรื่องกับตัวกรอง)
 */
export const FilterCombo: React.FC<{
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (v: string) => void;
  /** ข้อความตอนค้นไม่เจอ — บอกด้วยว่ารายการมาจากไหน */
  emptyText?: string;
}> = ({ label, value, options, onChange, emptyText }) => {
  const CLEAR_ID = '';
  const all: FilterOption[] = React.useMemo(
    () => [{ id: CLEAR_ID, name: 'ทั้งหมด' }, ...options],
    [options],
  );
  const selected = all.find((o) => o.id === value) ?? null;

  return (
    <ComboBox<FilterOption>
      /* ค่าว่าง = ยังไม่กรอง ⇒ ให้ช่องโชว์ชื่อฟิลด์เป็น placeholder แทนคำว่า "ทั้งหมด"
         (ที่ 1280 ช่องกว้างราว 190px — ถ้าเขียน "แหล่งผลิต — ทั้งหมด" จะโดนตัดท้ายทุกช่อง) */
      value={value === CLEAR_ID ? null : selected}
      options={all}
      onPick={(o) => onChange(o.id)}
      placeholder={label}
      ariaLabel={label}
      searchPlaceholder={`พิมพ์เพื่อค้น${label}`}
      emptyText={emptyText ?? `ไม่มี${label}ที่ตรงกับคำค้น`}
      facts={(o) =>
        o.count != null ? (
          <span className="text-[11px] tabular-nums text-slate-400 shrink-0">
            {o.count.toLocaleString('th-TH')}
          </span>
        ) : null
      }
    />
  );
};

/** ช่องค้นหา — รูปแบบเดียวกับ FilterSearch ของ FilterBar.tsx เพื่อให้ทั้งแอปหน้าตาเหมือนกัน */
export const DataSearch: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}> = ({ value, onChange, placeholder }) => (
  <div className="relative">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="w-full h-10 bg-card border border-slate-200 rounded-xl pl-10 pr-3 text-sm text-slate-800
                 placeholder-slate-400 transition-all focus:outline-none focus:border-[var(--brand-fg)]
                 focus:ring-2 focus:ring-[var(--brand-fg)]/10"
    />
  </div>
);

/**
 * เปลือกของแถบตัวกรอง
 *
 * `primary` = ตัวกรองที่อยู่แถวบนคู่กับช่องค้นหา · `rest` = ที่เหลือ
 * บนมือถือทั้งหมดยุบเป็นคอลัมน์เดียว และ **พับเก็บได้** เพราะถ้ากางไว้
 * ผู้ใช้ต้องเลื่อนผ่านช่องกรอง 6 ช่องก่อนจะเห็นข้อมูลแถวแรก
 */
export const DataFilterBar: React.FC<{
  search: React.ReactNode;
  primary: React.ReactNode;
  rest: React.ReactNode;
  /** จำนวนตัวกรองที่ยังทำงานอยู่ — โชว์บนปุ่มพับของมือถือ */
  activeCount: number;
  onClear: () => void;
}> = ({ search, primary, rest, activeCount, onClear }) => {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="bg-card border border-slate-200 rounded-2xl px-4 sm:px-5 py-3.5 shadow-sm space-y-3">
      {/* แถวบน: ค้นหา + ตัวกรองหลัก */}
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(200px,300px)]">
        {search}
        <div className="hidden lg:block">{primary}</div>
      </div>

      {/* แถวล่าง: ตัวกรองที่เหลือ — จอทำงานกางเสมอ, มือถือพับไว้ */}
      <div className={`${open ? 'grid' : 'hidden'} lg:grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5`}>
        <div className="lg:hidden">{primary}</div>
        {rest}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="lg:hidden flex items-center gap-1.5 text-xs font-semibold text-slate-500
                     hover:text-slate-700 transition-colors"
        >
          {open ? 'ซ่อนตัวกรอง' : 'ตัวกรองเพิ่มเติม'}
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-[var(--brand-soft)] text-[var(--brand-fg)] tabular-nums">
              {activeCount}
            </span>
          )}
        </button>

        {activeCount > 0 && (
          <button
            onClick={onClear}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600
                       transition-colors font-semibold"
          >
            <X className="w-3.5 h-3.5" />
            ล้างตัวกรองทั้งหมด
          </button>
        )}
      </div>
    </div>
  );
};
