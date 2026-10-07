import React, { useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { List, Loader2, Search, X } from 'lucide-react';
import type { FamilyChoice } from './CatalogTemplate';
import type { CodeExample } from './types';

/**
 * ช่องรหัสของหน้าคำนวณราคา + รายการค้นรหัสจริงจากฐาน (เจ้าของเคาะ mockup `pricing-calc-redesign` รอบ 2–5 · 2026-10-07)
 *
 * พิมพ์ส่วนไหนของรหัสก็ได้ → รายการสองหมวด: **รุ่น** (จากช่อง "รุ่น" ชุดเดียวกัน กรองในเบราว์เซอร์) แล้วค่อย **รหัสในฐาน**
 * (`GET /api/admin/pricing/examples` · ขึ้นต้นตรงกันก่อน · สูงสุด 8 ตัว + บอกว่าทั้งหมดกี่ตัว) · กดรหัส = ผู้เรียกเติมทุกช่อง
 * จากรหัสนั้นแล้วคิดราคา · **ไม่บังคับให้เลือกจากรายการ** — Enter โดยยังไม่ได้ลูกศรเลือก = คิดราคาจากที่พิมพ์ (วางรหัสเต็มแล้ว
 * Enter ได้เหมือนเดิม) · ราคาในฐานโชว์ทุกแถวไว้เทียบ (เจ้าของสั่ง 2026-10-07 "ให้แสดงด้วย เอาไว้เทียบ") ไม่ใช่ราคาที่ใช้
 *
 * ค้นไม่สำเร็จ (ฐานล่ม · ด่านไม่ผ่าน) = หมวดรหัสหายไปเงียบ ๆ — ช่องค้นเป็นของช่วย การคิดราคาต้องใช้ได้เสมอ
 * กล่องลอยยึดซ้าย-ขวาตามช่องเอง (กว้างเท่าช่อง) ⇒ ไม่ล้นจอที่ 390px (กติกากล่องลอยของ docs/design.md)
 */

export interface CodeSearchHandle {
  /** เปิดรายการตัวอย่างของตารางนี้ (ลิงก์ "ดูตัวอย่างรหัส … จากฐาน") */
  openExamples: (family: string, label: string) => void;
}

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** Enter ที่ยังไม่ได้เลือกแถว = คิดราคาจากที่พิมพ์ */
  onSubmit: () => void;
  onPickCode: (row: CodeExample) => void;
  onPickFamily: (family: string) => void;
  /** ปุ่ม ✕ — ล้างรหัสและช่องทั้งหมด */
  onClear: () => void;
  families: FamilyChoice[];
  headers: Record<string, string>;
  ref?: React.Ref<CodeSearchHandle>;
}

const LIMIT = 8;

/** ค้นรุ่นด้วยหัวรหัสแบบไหนก็ได้ — `tsk-04` · `TSP-11` · `n10-04` ตรงกับตาราง `TS_-04` / `TS_-11` */
const normModel = (t: string) => t.trim().toLowerCase().replace(/^(ts[a-z]*|[np]\d{1,2})-/, 'ts_-');

/** ส่วนที่ตรงกับที่พิมพ์เป็นตัวเขียว — ตรงแบบไม่สนตัวพิมพ์เท่านั้น (รหัสที่ตรงเพราะตัดช่องว่างไม่ระบาย ไม่ผิด แค่ไม่เน้น) */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="text-[var(--brand-fg)] font-extrabold">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}

export const CodeSearchBox: React.FC<Props> = ({ value, onChange, onSubmit, onPickCode, onPickFamily, onClear, families, headers, ref }) => {
  const popId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  /** เปิดเป็นรายการตัวอย่างของตาราง — ไม่มี = ค้นตามที่พิมพ์ */
  const [examples, setExamples] = useState<{ family: string; label: string } | null>(null);
  const [active, setActive] = useState(-1);
  const [found, setFound] = useState<{ key: string; total: number; rows: CodeExample[] } | null>(null);
  const [loading, setLoading] = useState(false);

  useImperativeHandle(ref, () => ({
    openExamples: (family, label) => {
      setExamples({ family, label });
      setActive(-1);
      setOpen(true);
      inputRef.current?.focus();
    },
  }), []);

  const q = value.trim();
  const key = examples ? `f:${examples.family}` : `q:${q}`;
  const wantFetch = open && (!!examples || q !== '');

  useEffect(() => {
    if (!wantFetch) return;
    const ctl = new AbortController();
    const params = new URLSearchParams(examples ? { family: examples.family, limit: String(LIMIT) } : { q, limit: String(LIMIT) });
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/pricing/examples?${params}`, { headers, signal: ctl.signal });
        const body = await res.json().catch(() => null);
        if (res.ok && Array.isArray(body?.rows)) setFound({ key, total: Number(body.total) || 0, rows: body.rows });
        else setFound({ key, total: 0, rows: [] });
      } catch {
        if (!ctl.signal.aborted) setFound({ key, total: 0, rows: [] });
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, examples ? 0 : 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [wantFetch, key, q, examples, headers]);

  const models = useMemo(() => {
    if (examples || !q) return [];
    const t = normModel(q);
    return families.filter((f) => f.code.toLowerCase().includes(t) || f.value.toLowerCase().includes(t) || f.text.toLowerCase().includes(q.toLowerCase())).slice(0, 4);
  }, [families, q, examples]);
  const rows = found && found.key === key ? found.rows : [];
  const total = found && found.key === key ? found.total : 0;
  const settled = !!found && found.key === key && !loading;
  const options = [...models.map((m) => ({ kind: 'model' as const, m })), ...rows.map((r) => ({ kind: 'code' as const, r }))];
  const shown = open && (!!examples || q !== '');

  const close = () => { setOpen(false); setExamples(null); setActive(-1); };
  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    close();
    if (o.kind === 'model') onPickFamily(o.m.value);
    else onPickCode(o.r);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && shown && options.length) {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === 'ArrowUp' && shown && options.length) {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === 'Escape' && shown) {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown && active >= 0 && options[active]) choose(active);
      else { close(); onSubmit(); }
    }
  };

  const head = examples
    ? <><List className="w-3.5 h-3.5 shrink-0" />ตัวอย่างรหัส <b className="font-mono text-slate-700">{examples.label}</b> จากฐาน</>
    : <><Search className="w-3.5 h-3.5 shrink-0" />รหัสในฐานที่มี "<b className="font-mono text-slate-700">{q}</b>"</>;
  const count = loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
    : !settled ? null
      : total > rows.length ? `แสดง ${rows.length} จาก ${total.toLocaleString()}${examples ? ' · พิมพ์ต่อเพื่อกรอง' : ''}`
        : total ? `พบ ${total.toLocaleString()} รายการ` : '';
  const SEC = 'px-3 pt-2 pb-1 text-[10.5px] font-semibold tracking-wide text-slate-400';

  return (
    <div className="relative flex-1 min-w-0">
      <label className="sr-only" htmlFor="pl-code">รหัสสินค้า</label>
      <input
        ref={inputRef}
        id="pl-code"
        className="w-full h-11 pl-3.5 pr-10 rounded-xl bg-card border border-slate-200 text-slate-900 font-mono text-[15px] placeholder:font-sans placeholder:text-[14px] placeholder:text-slate-400 focus:outline-none focus:border-[var(--brand-border-strong)] focus:ring-2 focus:ring-[var(--brand-soft)]"
        value={value}
        spellCheck={false}
        autoComplete="off"
        role="combobox"
        aria-expanded={shown}
        aria-controls={popId}
        aria-activedescendant={shown && active >= 0 ? `${popId}-opt-${active}` : undefined}
        placeholder="พิมพ์ / วางรหัส หรือค้นรหัสในฐาน เช่น 4950W"
        onChange={(e) => { onChange(e.target.value); setExamples(null); setActive(-1); setOpen(true); }}
        onKeyDown={onKeyDown}
        onBlur={close}
      />
      {value !== '' && (
        <button type="button" onClick={() => { close(); onClear(); }}
                className="absolute right-2 top-2 w-7 h-7 grid place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                aria-label="ล้างรหัสและช่องทั้งหมด" title="ล้างรหัสและช่องทั้งหมด">
          <X className="w-4 h-4" />
        </button>
      )}
      {shown && (
        <div
          id={popId}
          role="listbox"
          aria-label="รหัสในฐาน"
          // กดที่รายการแล้วช่องต้องไม่เสียโฟกัสก่อน click (onBlur ปิดรายการทิ้ง)
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-[50px] z-30 max-h-[380px] overflow-y-auto overscroll-contain bg-card border border-slate-300 rounded-xl shadow-xl p-1.5"
        >
          {models.length > 0 && (
            <>
              <div className={SEC}>รุ่น</div>
              {models.map((m, i) => (
                <button key={m.value} id={`${popId}-opt-${i}`} role="option" aria-selected={i === active} type="button"
                        onMouseEnter={() => setActive(i)} onClick={() => choose(i)}
                        className={`w-full text-left rounded-lg px-2.5 py-2 flex items-baseline gap-3 ${i === active ? 'bg-[var(--brand-soft)]' : 'hover:bg-[var(--brand-soft)]'}`}>
                  <span className="font-mono text-[13px] font-semibold text-slate-900">{m.code}</span>
                  <span className="ml-auto text-[11px] text-slate-500 text-right">{m.text}</span>
                </button>
              ))}
              <div className={SEC}>รหัสในฐาน</div>
            </>
          )}
          {models.length === 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2.5 pt-1 pb-1.5 text-[11.5px] text-slate-500">
              <span className="inline-flex items-center gap-1.5 min-w-0">{head}</span>
              <span className="ml-auto text-slate-400 text-right">{count}</span>
            </div>
          )}
          {rows.map((r, j) => {
            const i = models.length + j;
            return (
              <button key={`${r.model}|${r.ref}`} id={`${popId}-opt-${i}`} role="option" aria-selected={i === active} type="button"
                      ref={(el) => { if (i === active) el?.scrollIntoView({ block: 'nearest' }); }}
                      onMouseEnter={() => setActive(i)} onClick={() => choose(i)}
                      className={`w-full text-left rounded-lg px-2.5 py-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-x-3.5 gap-y-0.5 ${
                        i === active ? 'bg-[var(--brand-soft)]' : 'hover:bg-[var(--brand-soft)]'}`}>
                <span className="font-mono text-[13.5px] font-semibold text-slate-900 break-all"><Highlight text={r.model} q={examples ? '' : q} /></span>
                <span className="sm:row-span-2 sm:col-start-2 sm:self-center sm:text-right text-[12px] text-slate-500 tabular-nums whitespace-nowrap">
                  {r.price > 0 ? r.price.toLocaleString() : '—'}
                  <span className="ml-1.5 sm:ml-0 sm:block text-[10px] text-slate-400">ราคาในฐาน</span>
                </span>
                <span className="text-[11px] text-slate-500 truncate"><span className="font-mono">{r.ref}</span>{r.name ? ` · ${r.name}` : ''}</span>
              </button>
            );
          })}
          {settled && rows.length === 0 && (
            <div className="px-2.5 py-2 text-[12.5px] text-slate-500 leading-relaxed">
              {models.length
                ? <>ไม่มีรหัสในฐานที่มี "{q}" — เลือกรุ่นด้านบน หรือกด Enter เพื่อคิดรหัสที่พิมพ์</>
                : examples
                  ? <>ยังไม่มีรหัสของรุ่นนี้ในฐาน</>
                  : <>ไม่มีรหัสนี้ในฐาน — กด <b>คิดราคา</b> หรือ Enter เพื่อคิดรหัสที่พิมพ์ได้เลย</>}
            </div>
          )}
          {options.length > 0 && (
            <div className="mt-1 border-t border-slate-200 px-2.5 pt-2 pb-1 text-[11px] text-slate-400">
              คลิก หรือ ↑↓ แล้ว Enter = เติมทุกช่องจากรหัสนั้น · Enter เฉย ๆ = คิดราคาจากที่พิมพ์ · Esc = ปิด
            </div>
          )}
        </div>
      )}
    </div>
  );
};
