import React from 'react';
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { Button } from '../Button';
import { formatMs, formatNumber, inputCls, PAGE_SIZE_OPTIONS, thBaseCls, thPadCls } from './format';

/**
 * ชิ้นส่วนหน้าตาที่ใช้ร่วมกันทั้งกลุ่ม "บันทึกและรายงาน"
 *
 * ทำไมต้องมี: ก่อนหน้านี้ 4 หน้าต่างคนต่างเขียนกล่องตัวกรอง / กล่อง error / แถบแบ่งหน้า
 * ของตัวเอง ด้วยคลาสที่ใกล้เคียงแต่ไม่เท่ากัน (บ้าง p-4 บ้าง p-5, ปุ่มเปลี่ยนหน้าเป็นเลขหน้าบ้าง
 * เป็นลูกศรอย่างเดียวบ้าง) พอสลับแท็บดูทีละหน้าจะรู้สึกว่าเป็นคนละระบบ ทั้งที่เป็นเรื่องเดียวกัน
 * ไฟล์นี้จึงเป็นที่เดียวที่ตัดสินว่าองค์ประกอบเหล่านั้นหน้าตายังไง
 *
 * ⚠️ ไฟล์นี้ export ได้เฉพาะคอมโพเนนต์ — ค่าคงที่/คลาสไปไว้ที่ format.ts
 *    (react-refresh/only-export-components)
 */

/* ── ตัวกรอง ─────────────────────────────────────────────────────────────── */

/** การ์ดครอบตัวกรองทั้งชุด */
export const FilterCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-card border border-slate-200 rounded-2xl px-4 py-3.5 space-y-3">{children}</div>
);

/** แถวของช่องกรอง — ช่องที่ยาวไม่พอจะตกบรรทัดเองโดยยังชิดฐานเดียวกัน */
export const FilterRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-wrap items-end gap-2.5">{children}</div>
);

/**
 * ช่องกรอง 1 ช่อง — กำหนดแค่ความกว้างในแถว **ไม่มีป้ายเหนือช่องแล้ว**
 *
 * เดิมช่องนี้วางป้ายเหนือช่องโดยตั้งใจ (placeholder หายตอนพิมพ์) แต่เจ้าของสั่ง 2026-10-07
 * ให้ทั้งแอปใช้แบบเดียวกับ FilterBar.tsx คือแถวเดียวไม่มีป้าย ⇒ ชื่อของตัวกรองต้องอยู่ในตัวควบคุมเอง:
 * ช่องพิมพ์ = placeholder + aria-label · dropdown = ตัวเลือกแรกบอกชื่อ ("ทุกสถานะ") + ไอคอน + aria-label
 * ใครเพิ่มช่องใหม่แล้วไม่ใส่สองอย่างนี้ ช่องนั้นจะไม่มีอะไรบอกว่ากรองอะไรเลย
 */
export const FilterField: React.FC<{
  /** กินพื้นที่ว่างที่เหลือในแถว — ใช้กับช่องค้นหาช่องเดียวต่อแถว */
  grow?: boolean;
  /** ความกว้าง (คลาส tailwind) — ช่องวันที่/dropdown ที่ไม่ควรหดจนอ่านไม่ออก */
  width?: string;
  children: React.ReactNode;
}> = ({ grow, width = 'w-40', children }) => (
  <div className={grow ? 'flex-1 min-w-56' : width}>{children}</div>
);

/** ช่องค้นหาพร้อมไอคอนแว่น — รูปแบบเดียวกันทุกหน้า (ทุกหน้ากด / เพื่อโฟกัสได้เหมือนกัน) */
export const SearchField = React.forwardRef<HTMLInputElement, {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  'aria-label'?: string;
}>(({ value, onChange, placeholder, 'aria-label': ariaLabel }, ref) => (
  <div className="relative">
    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
    <input
      ref={ref}
      className={inputCls + ' pl-10'}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
));
SearchField.displayName = 'SearchField';

/* dropdown ของตัวกรองใช้ FilterSelect ของ FilterBar.tsx (ไอคอนบอกชนิดตัวกรองทางขวา) ตัวเดียวทั้งแอป
   — SelectField เดิมของไฟล์นี้ถูกลบเมื่อ 2026-10-07 ตอนเลิกใช้ป้ายเหนือช่อง */

/** ช่องติ๊ก 1 บรรทัด — ใช้กับตัวกรองแบบเปิด/ปิด เช่น "เฉพาะที่ช้า" */
export const CheckField: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}> = ({ checked, onChange, label, hint }) => (
  <label
    className="inline-flex items-center gap-2 h-[42px] text-xs text-slate-600 cursor-pointer select-none
               border border-slate-200 rounded-xl px-3 hover:border-slate-300 transition-colors"
    title={hint}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="rounded border-slate-300 accent-[var(--brand)]"
    />
    {label}
  </label>
);

/**
 * แถวล่างของการ์ดตัวกรอง — ชิปบอกว่ากรองอะไรค้างอยู่ + ปุ่มล้าง + จำนวนผลลัพธ์
 *
 * ชิปสำคัญกว่าที่คิด: ตัวกรองขั้นสูงถูกพับไว้ ถ้าไม่มีอะไรบอกว่ายังกรองค้างอยู่
 * ผู้ใช้จะเห็นตารางว่างแล้วเข้าใจว่า "ไม่มีข้อมูล" ทั้งที่จริงคือกรองแคบเกินไป
 */
export const FilterFooter: React.FC<{
  children?: React.ReactNode;
  onReset?: () => void;
  loading?: boolean;
  total?: number;
  unit?: string;
}> = ({ children, onReset, loading, total, unit = 'รายการ' }) => (
  <div className="flex flex-wrap items-center gap-2 text-xs border-t border-slate-100 pt-3">
    {children}
    {onReset && (
      <button onClick={onReset} className="text-slate-400 hover:text-slate-600 underline underline-offset-2">
        ล้างตัวกรอง
      </button>
    )}
    <span className="ml-auto text-slate-500 tabular-nums">
      {loading ? 'กำลังโหลด…' : total === undefined ? '' : formatNumber(total) + ' ' + unit}
    </span>
  </div>
);

/** ชิปตัวกรองที่ค้างอยู่ — กดที่ตัวชิปเพื่อเอาเงื่อนไขนั้นออก */
export const FilterChip: React.FC<{ label: string; value: string; onRemove: () => void }> = ({
  label, value, onRemove,
}) => (
  <button
    onClick={onRemove}
    title={'เอาตัวกรอง ' + label + ' ออก'}
    className="inline-flex items-center gap-1.5 max-w-64 px-2 py-1 rounded-lg border transition-opacity hover:opacity-80"
    style={{ backgroundColor: 'var(--brand-soft)', borderColor: 'var(--brand-border)', color: 'var(--brand-fg)' }}
  >
    <span className="opacity-70 shrink-0">{label}</span>
    <span className="font-medium truncate">{value}</span>
    <X className="w-3 h-3 shrink-0 opacity-70" />
  </button>
);

/* ── สถานะของหน้า ────────────────────────────────────────────────────────── */

export const ErrorBox: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-2">
    <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium text-red-800">โหลดข้อมูลไม่สำเร็จ</div>
      <div className="text-xs text-red-600 mt-0.5 break-words">{message}</div>
    </div>
    {onRetry && (
      <Button variant="danger" tone="soft" onClick={onRetry} className="shrink-0">
        ลองใหม่
      </Button>
    )}
  </div>
);

/**
 * ไม่มีข้อมูล — ต้องบอก "ทำไมถึงว่าง" ด้วยเสมอ ไม่ใช่แค่คำว่าไม่พบข้อมูล
 * ตารางว่างเพราะไม่มีเหตุการณ์จริง กับว่างเพราะกรองแคบไป ต้องแยกออกจากกันให้ได้
 */
export const EmptyState: React.FC<{
  icon: React.ElementType;
  title: string;
  hint?: React.ReactNode;
}> = ({ icon: Icon, title, hint }) => (
  <div className="py-16 text-center px-6">
    <Icon className="w-9 h-9 text-slate-300 mx-auto" />
    <div className="mt-2 text-sm text-slate-500">{title}</div>
    {hint && <div className="mt-1 text-xs text-slate-400 max-w-md mx-auto">{hint}</div>}
  </div>
);

/** โครงกระดูกตอนโหลดครั้งแรก — กันหน้ากระโดดตอนข้อมูลมาถึง */
export const SkeletonRows: React.FC<{ rows?: number }> = ({ rows = 8 }) => (
  <div className="divide-y divide-slate-100">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="px-4 py-3 animate-pulse flex items-center gap-4">
        <div className="h-3.5 w-28 bg-slate-200 rounded" />
        <div className="h-3.5 flex-1 bg-slate-100 rounded" />
        <div className="h-3.5 w-16 bg-slate-100 rounded" />
      </div>
    ))}
  </div>
);

/* ── ตาราง ──────────────────────────────────────────────────────────────── */

/** การ์ดครอบผลลัพธ์ — หัวข้อ (ถ้ามี) + เนื้อ + แถบแบ่งหน้า อยู่ในกรอบเดียวกันเสมอ */
export const TableCard: React.FC<{
  title?: string;
  hint?: string;
  /**
   * หัวการ์ดบรรทัดเดียว — คำอธิบายต่อท้ายหัวข้อ ยาวเกินจอแล้วตัดด้วย … (ชี้ดูข้อความเต็มได้)
   * ใช้กับหัวที่เป็นแค่ "จำนวนแถว" ซึ่งไม่ควรกินสองบรรทัด (เจ้าของสั่ง 2026-10-02) · ปกติไม่ต้องส่ง
   */
  inline?: boolean;
  action?: React.ReactNode;
  /** ใช้ตอนวางในกริดที่ต้องการให้การ์ดสูงเท่ากัน (h-full) — ปกติไม่ต้องส่ง */
  className?: string;
  children: React.ReactNode;
}> = ({ title, hint, inline = false, action, className = '', children }) => (
  <div className={`bg-card border border-slate-200 rounded-2xl overflow-hidden shadow-sm ${className}`}>
    {title && (
      <div className={`px-4 border-b border-slate-100 flex gap-3 ${inline ? 'py-2.5 items-center' : 'py-3 items-start'}`}>
        {inline ? (
          <div className="min-w-0 flex-1 flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-slate-800 shrink-0">{title}</h3>
            {hint && <p className="text-xs text-slate-400 truncate" title={hint}>· {hint}</p>}
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
            {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
          </div>
        )}
        {action}
      </div>
    )}
    {children}
  </div>
);

/**
 * หัวคอลัมน์ที่กดเพื่อเรียงลำดับได้ — หน้าตาตามตารางหน้าโปรโมชัน (ต้นแบบที่เจ้าของชี้ 2026-10-02)
 *
 * ลูกศรของคอลัมน์ที่ "ไม่ได้เรียงอยู่" (⇅ จาง) ยังอยู่ ไม่ได้ซ่อนจนโผล่ตอน hover เท่านั้น
 * — บนจอสัมผัสไม่มี hover ถ้าซ่อนไว้ผู้ใช้จะไม่มีทางรู้เลยว่าหัวตารางกดได้
 * · ทั้งช่องเป็นปุ่ม (ปุ่มยืดเต็มช่อง ระยะขอบอยู่ที่ปุ่ม) ⇒ กดตรงไหนของหัวก็เรียงได้ และกด Tab ถึง
 */
export const SortHeader: React.FC<{
  label: string;
  /** คีย์ของคอลัมน์นี้ — ต้องตรงกับคีย์ใน accessors หรือรายชื่อขาวฝั่ง SQL */
  col: string;
  active: string;
  dir: 'asc' | 'desc';
  onSort: (col: string) => void;
  align?: 'left' | 'right' | 'center';
  /** ระยะขอบ — ต้องเท่ากับช่องข้อมูลของตารางนั้น (ค่าตั้งต้นคู่กับ `tdCls`) */
  pad?: string;
  className?: string;
  title?: string;
}> = ({ label, col, active, dir, onSort, align = 'left', pad = thPadCls, className = '', title }) => {
  const on = active === col;
  const justify = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <th className={`${thBaseCls} p-0 ${className}`} aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(col)}
        title={title ?? `เรียงตาม ${label}`}
        className={`w-full flex items-center gap-1.5 ${pad} ${justify} uppercase tracking-wider
                    hover:bg-slate-100 transition-colors focus:outline-none
                    focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-fg)]`}
      >
        <span className="truncate">{label}</span>
        {on
          ? (dir === 'asc'
              ? <ArrowUp className="w-3.5 h-3.5 shrink-0 text-[var(--brand-fg)]" />
              : <ArrowDown className="w-3.5 h-3.5 shrink-0 text-[var(--brand-fg)]" />)
          : <ArrowUpDown className="w-3.5 h-3.5 shrink-0 text-slate-300" />}
      </button>
    </th>
  );
};

/**
 * สลับทิศการเรียงเวลาของหน้าที่แสดงผลเป็น "รายการ" ไม่ใช่ตาราง (บันทึกการแก้ไข / บันทึกระบบ)
 *
 * สองหน้านั้นไม่มีหัวคอลัมน์ให้กด เพราะแต่ละแถวเป็นข้อความยาวไม่เท่ากัน ไม่ได้แบ่งเป็นช่อง
 * สิ่งเดียวที่เรียงแล้วมีความหมายจริงคือเวลา จึงให้ปุ่มเดียวแทนหัวคอลัมน์ทั้งแถว
 * และต้องเรียงที่ SQL เพราะทั้งสองหน้าแบ่งหน้าจาก server เหมือนกัน
 */
export const TimeSortToggle: React.FC<{
  dir: 'asc' | 'desc';
  onChange: (dir: 'asc' | 'desc') => void;
}> = ({ dir, onChange }) => (
  <button
    onClick={() => onChange(dir === 'desc' ? 'asc' : 'desc')}
    title="สลับลำดับเวลาของทั้งรายการ"
    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-200
               text-slate-500 hover:text-slate-700 hover:border-slate-300 transition-colors"
  >
    {dir === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}
    {dir === 'desc' ? 'ใหม่ → เก่า' : 'เก่า → ใหม่'}
  </button>
);

/** กล่องเลื่อนแนวนอนของตาราง — ตารางกว้างต้องเลื่อนในกล่องตัวเอง ห้ามดันทั้งหน้าให้เลื่อน */
export const TableScroll: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="overflow-x-auto">{children}</div>
);

/* ── แบ่งหน้า ────────────────────────────────────────────────────────────── */

function pageWindow(total: number, current: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | 'gap')[] = [1];
  if (current > 3) out.push('gap');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) out.push(i);
  if (current < total - 2) out.push('gap');
  out.push(total);
  return out;
}

/**
 * ท้ายตาราง (แถบแบ่งหน้า) — **แบบเดียวทั้งแอป** หน้าตาตามตารางหน้าโปรโมชัน (เจ้าของชี้ 2026-10-02)
 * ซ้าย = กำลังดูช่วงไหนของทั้งหมด + จำนวนต่อหน้า (ตัวเลขนี้สำคัญกว่าปุ่ม — คนใช้ดูว่าเหลืออีกเท่าไร)
 * ขวา = ปุ่มเดินหน้าถอยหลัง + เลขหน้า (กล่องมีขอบทุกปุ่ม หน้าปัจจุบันพื้นเขียวแบรนด์)
 * · หน้าที่แบ่งหน้าเองฝั่ง client ก็ใช้ตัวนี้ — ห้ามเขียนแถบท้ายตารางเองอีก
 */
const pagerBtnCls =
  'w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 bg-card text-slate-500 ' +
  'hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card transition-colors';

export const Pagination: React.FC<{
  page: number;
  pages: number;
  size: number;
  total: number;
  unit?: string;
  /** ตัวเลือกจำนวนต่อหน้า — ไม่ส่ง = ชุดกลาง `PAGE_SIZE_OPTIONS` (หน้าที่แบ่งเองฝั่ง client ส่งชุดของตัวเองได้) */
  sizes?: readonly number[];
  onPage: (p: number) => void;
  onSize: (s: number) => void;
}> = ({ page, pages, size, total, unit = 'รายการ', sizes = PAGE_SIZE_OPTIONS, onPage, onSize }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span className="tabular-nums">
        แสดง <span className="font-semibold text-slate-700">
          {total === 0 ? 0 : formatNumber((page - 1) * size + 1)}-{formatNumber(Math.min(page * size, total))}
        </span> จาก <span className="font-semibold text-slate-700">{formatNumber(total)}</span> {unit}
      </span>
      <span className="text-slate-300" aria-hidden>|</span>
      <label className="flex items-center gap-1.5">
        ต่อหน้า
        <select
          className="h-7 px-2 rounded-lg border border-slate-200 bg-card text-xs font-semibold text-slate-700 cursor-pointer outline-none focus:border-[var(--brand-fg)]"
          value={size}
          onChange={(e) => onSize(Number(e.target.value))}
        >
          {sizes.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
    </div>

    <div className="flex items-center gap-1">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className={pagerBtnCls} aria-label="หน้าก่อนหน้า">
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      {pageWindow(Math.max(1, pages), page).map((p, i) =>
        p === 'gap' ? (
          <span key={'gap' + i} className="w-7 h-7 flex items-center justify-center text-xs text-slate-400">…</span>
        ) : (
          <button
            type="button"
            key={p}
            onClick={() => onPage(p)}
            aria-current={p === page ? 'page' : undefined}
            className={`min-w-7 h-7 px-1.5 flex items-center justify-center rounded-lg text-xs font-bold tabular-nums transition-colors ${
              p === page
                ? 'bg-[var(--brand)] text-white border border-[var(--brand)]'
                : 'bg-card border border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {p}
          </button>
        )
      )}
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className={pagerBtnCls} aria-label="หน้าถัดไป">
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  </div>
);

/* ── ปุ่มจัดการในแถว ─────────────────────────────────────────────────────── */

/**
 * ปุ่มไอคอนในคอลัมน์ "การจัดการ" — **แบบเดียวทั้งแอป** (ต้นแบบ: ส่งออก/แก้ไข/ลบ ของหน้าโปรโมชัน
 * เจ้าของชี้ 2026-10-02) · กล่องขาวมีขอบ ไอคอนเทา ชี้แล้วเป็นเขียวแบรนด์ (`danger` ชี้แล้วเป็นแดง)
 * ⇒ แถวยาว ๆ ไม่มีสีแย่งสายตา สีโผล่เฉพาะปุ่มที่กำลังจะกด
 * · `label` บังคับ — ใช้เป็นทั้ง `title` (ชี้แล้วเห็น) และ `aria-label` (ปุ่มไม่มีข้อความ design.md ข้อ 8)
 * · ปุ่มที่ต้องมีข้อความ (เช่น "อนุมัติ") ใช้ `<Button>` ปกติ ไม่ใช่ตัวนี้
 */
const rowActionCls = (tone: 'neutral' | 'danger') =>
  'w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-card text-slate-500 ' +
  'shadow-[var(--shadow-btn)] transition-all enabled:active:scale-95 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none ' +
  (tone === 'danger'
    ? 'enabled:hover:bg-red-50 enabled:hover:text-red-600 enabled:hover:border-red-200'
    : 'enabled:hover:bg-[var(--brand-soft)] enabled:hover:text-[var(--brand-fg)] enabled:hover:border-[var(--brand-fg)]');

export const RowAction: React.FC<Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: 'neutral' | 'danger';
}> = ({ icon: Icon, label, tone = 'neutral', className = '', type = 'button', ...rest }) => (
  <button type={type} title={label} aria-label={label} className={`${rowActionCls(tone)} ${className}`} {...rest}>
    <Icon className="w-3.5 h-3.5" />
  </button>
);

/**
 * ปุ่มจัดการที่เป็น "ลิงก์" (เปิดไฟล์/แท็บใหม่ เช่น PDF ของใบ) — หน้าตาเดียวกับ `RowAction` ทุกพิกเซล
 * แยกตัวเพราะ `<a>` ไม่มีสถานะ `disabled` (`enabled:` ไม่ match) ⇒ ใช้ hover ตรง ๆ
 */
export const RowActionLink: React.FC<Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> & {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}> = ({ icon: Icon, label, className = '', ...rest }) => (
  <a title={label} aria-label={label}
     className={`${rowActionCls('neutral').replace(/enabled:/g, '')} ${className}`} {...rest}>
    <Icon className="w-3.5 h-3.5" />
  </a>
);

/** แถวปุ่มของคอลัมน์ "การจัดการ" — ชิดขวาเสมอ ระยะห่างเท่ากันทุกหน้า */
export const RowActions: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`flex items-center justify-end gap-1.5 ${className}`}>{children}</div>
);

/* ── ป้ายค่าในตาราง ──────────────────────────────────────────────────────── */

function statusTone(code: number): { cls: string; dot: string } {
  if (code >= 500) return { cls: 'bg-red-50 border-red-200 text-red-700', dot: 'bg-red-500' };
  if (code >= 400) return { cls: 'bg-amber-50 border-amber-200 text-amber-700', dot: 'bg-amber-500' };
  if (code >= 300) return { cls: 'bg-blue-50 border-blue-200 text-blue-700', dot: 'bg-blue-400' };
  return { cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', dot: 'bg-emerald-500' };
}

/**
 * รหัสสถานะ HTTP — มีจุดสีนำหน้า แต่ "ตัวเลขคือของจริง" สีเป็นแค่ตัวช่วย
 * (WCAG 1.4.1 ห้ามสื่อความหมายด้วยสีอย่างเดียว)
 */
export const StatusPill: React.FC<{ code: number }> = ({ code }) => {
  const t = statusTone(code);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs tabular-nums ${t.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
      {code}
    </span>
  );
};

/** method ของ request — ความกว้างคงที่เพื่อให้ path ของทุกแถวเริ่มตรงกัน */
export const MethodTag: React.FC<{ method: string }> = ({ method }) => (
  <span className="inline-block w-11 shrink-0 font-mono text-[11px] font-semibold text-slate-400 uppercase">
    {method}
  </span>
);

/** เวลาที่ใช้ — ยิ่งช้ายิ่งเข้ม เพื่อให้กวาดตาหาแถวที่ช้าได้โดยไม่ต้องอ่านตัวเลขทุกแถว */
export const Duration: React.FC<{ ms: number }> = ({ ms }) => {
  const cls =
    ms >= 10_000 ? 'text-red-600 font-semibold'
      : ms >= 3_000 ? 'text-amber-600 font-medium'
        : ms >= 1_000 ? 'text-slate-700'
          : 'text-slate-500';
  return <span className={'tabular-nums ' + cls}>{formatMs(ms)}</span>;
};

/* ── การ์ดตัวเลขสรุป ─────────────────────────────────────────────────────── */

export const StatTile: React.FC<{
  label: string;
  value: string;
  sub?: React.ReactNode;
  danger?: boolean;
}> = ({ label, value, sub, danger }) => (
  <div className={`bg-card rounded-2xl border p-3.5 ${danger ? 'border-red-200' : 'border-slate-200'}`}>
    <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</div>
    <div className={`text-2xl font-semibold mt-1 tabular-nums ${danger ? 'text-red-600' : 'text-slate-800'}`}>
      {value}
    </div>
    {sub && <div className={`text-[11px] mt-1 ${danger ? 'text-red-500' : 'text-slate-400'}`}>{sub}</div>}
  </div>
);
