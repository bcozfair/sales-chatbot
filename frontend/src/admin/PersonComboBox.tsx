// ─────────────────────────────────────────────────────────────────────────────
//  ช่อง "เลือกหนึ่งรายการจากรายชื่อ" แบบพิมพ์ค้นหา — สองชั้นในไฟล์เดียว
//
//    ComboBox        โครงกลาง: ช่องที่กดแล้วกลายเป็นช่องค้น + รายการ + คีย์บอร์ด
//    PersonComboBox  โครงกลาง + กติกาของ "คน" (รหัส · เบอร์ · คำเตือนเบอร์ว่าง)
//
//  ทำไมแยกสองชั้น (2026-09-14): เจ้าของสั่งให้ช่องบริษัท/ผู้ติดต่อในหน้าขอใบเสนอราคา
//  ใช้รูปแบบเดียวกับช่องเลือกชื่อแอดมิน — แต่บริษัทไม่มี "เบอร์" และไม่ควรถูกเตือนว่า
//  "ไม่มีเบอร์" ⇒ ถ้าก๊อปโครงไปเป็นตัวที่สอง ทุกการแก้ต้องแก้สองที่ตลอดไป และถ้ายัด
//  บริษัทลงรูปร่างของ "คน" หน้าจอจะโกหก · แยกโครงออกมาแล้วทั้งสองอย่างได้ของที่ถูกต้อง
//
//  ทำไมยังชื่อไฟล์เดิม: `docs/design.md` อ้างชื่อคอมโพเนนต์ตามไฟล์ และการเปลี่ยนชื่อไฟล์
//  ที่มีคนใช้อยู่คือ churn ที่ไฟล์นั้นเตือนไว้เอง — ค่าที่ได้ไม่คุ้มกับการที่ทุก checkout
//  ต้องตามแก้ import
//
//  กติกาของชั้น "คน" ที่ห้ามเปิดให้ call site เลือก:
//    · ค้นได้ทั้ง ชื่อ · รหัส · เบอร์ ⇒ พิมพ์อะไรที่จำได้ก็เจอ ไม่ต้องจำชื่อเต็ม
//    · ไม่มีปุ่มล้างค่า — สองช่องนั้น "ต้องมีคน" เสมอ การล้างเป็นสถานะที่ออกใบไม่ได้
//    · **"ไม่มีเบอร์" ขึ้นสีเตือนเองเสมอ** เพราะเบอร์ของทั้งสองฝั่งไปโผล่บน PDF
//      (`buildSignatureBlocksHtml`) และฝั่งพนักงานขายที่ไม่มีเบอร์จะพิมพ์คำว่า `( เบอร์โทร )`
//      ให้ลูกค้าเห็นคาใบ ⇒ เบอร์ว่างเป็นเรื่องต้องรู้ "ก่อนกดเลือก" ไม่ใช่ข้อมูลประกอบ
//      จึงเตือนทั้งในช่องและในรายชื่อ และ call site ปิดไม่ได้ เพราะลืมได้
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Search } from 'lucide-react';

/** รูปร่างขั้นต่ำที่โครงกลางต้องการ — อย่างอื่นเป็นเรื่องของคนเรียก */
export interface ComboOption {
  id: string;
  name: string;
}

export interface PersonOption extends ComboOption {
  /** รหัสพนักงาน — สิ่งที่คนในร้านใช้เรียกกันแทนชื่อ (ฝั่งผู้เสนอราคาไม่มี) */
  code?: string | null;
  /** เบอร์โทร — ขึ้นบน PDF ⇒ ว่างแล้วขึ้นสีเตือนเอง ดูเหตุผลที่หัวไฟล์ */
  phone?: string | null;
}

interface ComboProps<T extends ComboOption> {
  /**
   * รายการที่เลือกอยู่ — เป็น "ของจริงจากผู้เรียก" ไม่ใช่ค่าที่ไปค้นใน options
   * เพราะของที่บันทึกไว้แล้วอาจไม่อยู่ในรายการรอบนี้ (คนลาออก / ค้นด้วยคำอื่น)
   * ถ้าไปหาใน options แล้วไม่เจอ ช่องจะกลายเป็น "ยังไม่เลือก" ทั้งที่มีค่าอยู่
   */
  value: T | null;
  options: T[];
  onPick: (opt: T) => void;
  /** ข้อความตอนยังไม่เลือก — เขียนให้บอกด้วยว่าไม่เลือกแล้วจะเป็นอะไร */
  placeholder: string;
  /** ข้อความตอนค้นไม่เจอ — บอกด้วยว่ารายการมาจากไหน คนอ่านจะรู้ว่าต้องไปแก้ที่ไหน */
  emptyText: string;
  ariaLabel: string;
  searchPlaceholder: string;
  busy?: boolean;
  /** ยังไม่เลือกทั้งที่จำเป็น ⇒ กรอบสีเตือน (แทนป้ายเตือนแยกก้อน) */
  invalid?: boolean;
  disabled?: boolean;
  /** หมายเหตุใต้รายการ — โชว์ตอนกางเท่านั้น เพราะมันอธิบาย "รายการ" ไม่ใช่ "ค่าที่เลือก" */
  footer?: React.ReactNode;
  /**
   * แถวกดได้ท้ายรายการ — สำหรับ "ของที่ยังไม่มีในรายการนี้" เช่นปุ่มเพิ่มผู้ติดต่อใหม่
   *
   * ต่างจาก `footer` ตรงที่มัน **กดได้และเต็มความกว้าง** (ไม่มี padding ของโครงกลางมาครอบ)
   * ⇒ ผู้เรียกเป็นคนตั้งหน้าตาเอง · โครงกลางรับผิดชอบแค่ "กดแล้วกล่องต้องหุบ" ซึ่งผู้เรียก
   * ทำเองไม่ได้เพราะ `close()` เป็นของข้างใน
   *
   * รับ `query` ที่พิมพ์ค้างไว้ไปด้วย — คนที่พิมพ์ชื่อแล้วไม่เจอ ไม่ควรต้องพิมพ์ซ้ำในกล่องถัดไป
   */
  action?: (query: string) => React.ReactNode;
  /**
   * แถวกดได้ **บนสุด** ของรายการ — ทางเลือกที่ไม่ใช่รายการใดรายการหนึ่ง เช่น "ระบบเลือกอัตโนมัติ"
   * ของช่อง "ออกในนาม" (docs/plan-web-quote-auto-salesperson.md §3.4) · กดแล้วหุบเหมือน `action`
   * · **ซ่อนตอนพิมพ์ค้น** เพราะมันไม่ใช่ชื่อคน การค้นไม่ควรเจอมัน และมันจะดันผลค้นลงไป
   */
  leading?: React.ReactNode;
  /**
   * ข้อเท็จจริงท้ายบรรทัด — ตัวเดียวใช้ทั้งในช่องและในรายการ ไม่งั้นคนนึกว่าคนละชุดข้อมูล
   * `where` บอกว่ากำลังวาดที่ไหน ⇒ ผู้เรียกย่อในช่องได้โดยรายการยังครบ (ดู `badge`)
   */
  facts?: (opt: T, where: 'field' | 'list') => React.ReactNode;
  /**
   * ป้ายท้ายค่าที่เลือก (เฉพาะในช่อง ไม่ขึ้นในรายการ) — เช่น "ระบบเลือก" / "เลือกเอง" ของช่อง
   * "ออกในนาม" (docs/plan-web-quote-auto-salesperson.md §3.4) · ไม่ส่ง = หน้าตาเดิมทุกอย่าง
   */
  badge?: React.ReactNode;
  /** ข้อความที่เอาไปกรองในเครื่อง (ค่าเริ่มต้น = ชื่อ) */
  searchText?: (opt: T) => string;
  /**
   * ส่งมาเมื่อ **ผู้เรียกเป็นคนค้นเอง** (ยิง API ตามคำค้น) ⇒ โครงกลางเลิกกรองในเครื่อง
   * ไม่งั้นผลจาก server จะถูกกรองซ้ำด้วยคำเดียวกัน แล้วรายการที่ server ตั้งใจส่งมาหายไป
   * (เช่นค้น "เอเทค" แล้ว server คืนชื่อที่สะกดต่างออกไป — กรองซ้ำจะทิ้งทิ้งหมด)
   */
  onQueryChange?: (q: string) => void;
}

export function ComboBox<T extends ComboOption>({
  value,
  options,
  onPick,
  placeholder,
  emptyText,
  ariaLabel,
  searchPlaceholder,
  busy,
  invalid,
  disabled,
  footer,
  action,
  leading,
  facts,
  badge,
  searchText,
  onQueryChange,
}: ComboProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
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
  const filtered =
    onQueryChange || !q
      ? options
      : options.filter((o) => (searchText ? searchText(o) : o.name).toLowerCase().includes(q));

  // ผลค้นจาก server มาทีหลังได้ รายการจึงสั้นลงได้ใต้ดัชนีที่เลือกค้างไว้ ⇒ หนีบตอนใช้
  // แทนการ reset ใน effect (ซึ่งกฎ react-hooks/set-state-in-effect ปฏิเสธอยู่แล้ว)
  // ส่วนการกลับไปตัวแรกตอนพิมพ์ใหม่ ทำที่ onChange ของช่องค้น ซึ่งเป็นที่ที่ถูกจริง
  const activeIdx = filtered.length > 0 ? Math.min(active, filtered.length - 1) : 0;

  const close = () => { setOpen(false); setQuery(''); };
  const choose = (o: T) => { onPick(o); close(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { close(); return; }
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(activeIdx + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); }
    else if (e.key === 'Enter' && filtered[activeIdx]) { e.preventDefault(); choose(filtered[activeIdx]); }
  };

  const frame = disabled
    ? 'border-slate-200 bg-slate-100 cursor-not-allowed'
    : open
      ? 'border-[var(--brand-fg)] ring-2 ring-[var(--brand-fg)]/10 bg-card cursor-pointer'
      : invalid
        ? 'border-amber-300 bg-amber-50/60 hover:border-amber-400 cursor-pointer'
        : 'border-slate-200 bg-slate-50 hover:border-slate-300 cursor-pointer';

  return (
    <div className="relative flex-1 min-w-0" ref={boxRef}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-disabled={disabled || undefined}
        onClick={() => !disabled && setOpen(true)}
        onKeyDown={onKeyDown}
        className={`flex items-center gap-2 w-full h-10 px-3 rounded-xl border text-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-fg)]/30 ${frame}`}
      >
        {/* มีป้ายต่อท้าย + ยังไม่กาง ⇒ ซ่อนแว่นขยาย คืนที่ให้ชื่อ (ช่อง "ออกในนาม" กว้างแค่ ~196px ที่ 1280) */}
        <Search className={`w-4 h-4 text-slate-400 shrink-0 ${badge != null && value && !open ? 'hidden' : ''}`} />
        {open ? (
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              onQueryChange?.(e.target.value);
            }}
            onKeyDown={onKeyDown}
            placeholder={searchPlaceholder}
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-800 placeholder:text-slate-400"
          />
        ) : value ? (
          <span className="flex flex-1 items-center gap-2 min-w-0">
            <span className="font-semibold text-slate-800 truncate">{value.name}</span>
            {facts?.(value, 'field')}
            {badge}
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
          {/* slate-500 ไม่ใช่ slate-400: ตัวอักษร 10px บนพื้น slate-50 ของธีมสว่าง
              ที่ slate-400 ได้ contrast ~2.6:1 ซึ่งตกเกณฑ์ 4.5 ของตัวอักษรขนาดปกติ */}
          <div className="flex items-center gap-2 px-3.5 py-1 bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500">
            {busy ? 'กำลังค้นหา...' : `${filtered.length} รายการ`}
            <span className="ml-auto hidden sm:inline">↑ ↓ เลื่อน · Enter เลือก · Esc ปิด</span>
          </div>
          {leading && !query.trim() && <div onClick={close} className="border-b border-slate-200">{leading}</div>}
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-center text-xs text-slate-400">{emptyText}</p>
            ) : (
              filtered.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  ref={(el) => { if (i === activeIdx) el?.scrollIntoView({ block: 'nearest' }); }}
                  className={`w-full text-left px-3.5 py-2.5 text-sm flex items-center justify-between gap-2 ${
                    o.id === value?.id
                      ? 'bg-[var(--brand-soft)] text-[var(--brand-fg)] font-semibold'
                      : i === activeIdx
                        ? 'bg-slate-100 text-slate-700'
                        : 'text-slate-700'
                  }`}
                >
                  <span className="truncate">{o.name}</span>
                  {facts?.(o, 'list')}
                </button>
              ))
            )}
          </div>
          {footer && <div className="border-t border-slate-100 bg-slate-50 px-3.5 py-2 text-[11px] text-slate-500">{footer}</div>}
          {/* กดแล้วต้องหุบกล่องเสมอ — ตัวจัดการ mousedown ข้างบนไม่หุบให้ เพราะแถวนี้อยู่ใน boxRef
              (มันหุบเฉพาะคลิกที่ "นอก" กล่อง) ⇒ ดักที่ขาขึ้นของ onClick หลัง handler ของผู้เรียกทำงานแล้ว */}
          {action && <div onClick={close} className="border-t border-slate-100">{action(query.trim())}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * รหัส + เบอร์ ของคนคนหนึ่ง — ใช้ทั้งในช่องที่เลือกแล้วและในรายชื่อตอนกาง
 * ที่เดียวโดยตั้งใจ: ถ้าสองที่แสดงไม่เหมือนกัน คนจะนึกว่าเป็นข้อมูลคนละชุด
 *
 * `compact` = ช่องที่มีป้ายต่อท้าย ⇒ ในช่องเหลือแค่ ชื่อ + ป้าย ทุกขนาดจอ (วัด 2026-09-24: ช่อง "ออกในนาม"
 * กว้าง ~196px ที่ 1280 และ ~150px ที่ 390 — ไม่ซ่อน = ชื่อกว้าง 0px หายทั้งคำ) · **คำเตือน "ไม่มีเบอร์"
 * ไม่ถูกซ่อน** ตามกติกาหัวไฟล์ · รหัสและเบอร์ยังเห็นครบในรายการตอนกาง
 */
const PersonFacts: React.FC<{ person: PersonOption; compact?: boolean }> = ({ person, compact }) => {
  if (compact) {
    return person.phone ? null : (
      <span className="shrink-0 text-xs whitespace-nowrap text-amber-700 font-medium">ไม่มีเบอร์</span>
    );
  }
  return (
    <span className="flex items-baseline gap-2 shrink-0 text-xs whitespace-nowrap">
      {person.code && <span className="text-slate-500">{person.code}</span>}
      <span className={person.phone ? 'text-slate-500' : 'text-amber-700 font-medium'}>
        {person.phone || 'ไม่มีเบอร์'}
      </span>
    </span>
  );
};

type PersonProps = Omit<
  ComboProps<PersonOption>,
  'facts' | 'searchText' | 'searchPlaceholder' | 'onQueryChange'
>;

export const PersonComboBox: React.FC<PersonProps> = (props) => (
  <ComboBox<PersonOption>
    {...props}
    searchPlaceholder="พิมพ์ชื่อ รหัส หรือเบอร์เพื่อค้นหา..."
    searchText={(o) => `${o.name} ${o.code ?? ''} ${o.phone ?? ''}`}
    facts={(o, where) => <PersonFacts person={o} compact={where === 'field' && props.badge != null} />}
  />
);
