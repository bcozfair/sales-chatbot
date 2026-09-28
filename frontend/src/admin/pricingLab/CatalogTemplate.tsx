import React from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { BhForm, CatalogFamilySpec, CatalogSlot, SizeKey } from './types';

/**
 * ช่องกรอก "ตามแคตตาล็อก" — แต่ละช่องคือท่อนหนึ่งของรหัส เรียงตามตาราง "การสั่งซื้อ" ของแคตตาล็อก
 *
 * เจ้าของเคาะหน้าตา 2026-09-28 จาก mockup แบบ A "กรอกในรหัส" (`mockups/pricing-catalogue-options.html`)
 * หลังเห็นว่าแบบเดิม (ฟอร์มแยก + ป้ายทุกช่อง) "ดูรกและเข้าใจยาก" — ตัวช่องคือรหัสเอง ไม่ต้องมีคำอธิบายเพิ่ม
 *
 * **คอมโพเนนต์นี้ไม่ประกอบรหัสและไม่คิดราคา** — มันแค่เก็บค่าที่กรอกแล้วส่งขึ้นไป เซิร์ฟเวอร์ประกอบรหัส
 * (`buildBhCode`) แล้วคิดราคาทางเดียวกับรหัสที่พิมพ์ ⇒ รหัสบนจอกับรหัสที่คิดราคาเป็นตัวเดียวกันเสมอ
 * และสมุดราคาไม่ต้องมาถึงเบราว์เซอร์ (กฎที่หัว `PricingLab.tsx`)
 */

interface Props {
  catalog: CatalogFamilySpec[];
  form: BhForm;
  /** `now` = ช่องแบบเลือก ส่งทันที · ไม่ใส่ = ช่องพิมพ์ ให้ผู้เรียกหน่วงก่อนส่ง */
  onChange: (next: BhForm, now?: boolean) => void;
  onFamily: (family: BhForm['family']) => void;
}

const INPUT =
  'h-9 rounded-lg bg-card border border-slate-200 text-slate-900 font-mono text-[14px] font-semibold ' +
  'focus:outline-none focus:border-[var(--brand-border-strong)] focus:ring-2 focus:ring-[var(--brand-soft)]';

const Slot: React.FC<{ cap: string; children: React.ReactNode; hint?: string }> = ({ cap, children, hint }) => (
  <div className="flex flex-col items-center gap-1" title={hint}>
    {children}
    <span className="text-[10.5px] text-slate-500 whitespace-nowrap">{cap}</span>
  </div>
);

const Sep: React.FC<{ t: string }> = ({ t }) => (
  <span className="h-9 flex items-center font-mono text-[14px] font-bold text-slate-500">{t}</span>
);

/**
 * dropdown ที่ตอนปิดโชว์ **แค่รหัส** ส่วนคำอธิบายโผล่เฉพาะในรายการ (เจ้าของสั่ง 2026-09-28)
 * `<select>` ของเบราว์เซอร์โชว์ข้อความของตัวเลือกเดียวกับในรายการเสมอ ⇒ ซ่อนตัวอักษรของ select แล้ววางรหัสทับ
 * (select ตัวจริงยังรับคลิก/คีย์บอร์ด และ aria อ่านข้อความเต็มได้ตามเดิม) · กว้างตามรหัสที่ยาวสุด ไม่ใช่คำอธิบาย
 */
interface CodeOption { value: string; code: string; text?: string }
const CodeSelect: React.FC<{
  label: string; value: string; options: CodeOption[]; placeholder?: string; onChange: (v: string) => void;
}> = ({ label, value, options, placeholder, onChange }) => {
  const cur = options.find((o) => o.value === value);
  const ch = Math.max(placeholder?.length ?? 0, ...options.map((o) => o.code.length)) + 4;
  return (
    <div className="relative font-mono text-[14px]" style={{ width: `${ch}ch` }}>
      <select className={`${INPUT} w-full pl-2 pr-6 text-transparent appearance-none cursor-pointer`} value={value} aria-label={label}
              onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined && <option className="bg-card text-slate-900" value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} className="bg-card text-slate-900" value={o.value}>{o.text ? `${o.code} · ${o.text}` : o.code}</option>
        ))}
      </select>
      <span aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2 font-semibold ${cur ? 'text-slate-900' : 'text-slate-400'}`}>
        {cur?.code ?? placeholder}
      </span>
      {/* ลูกศรของเบราว์เซอร์ใช้สีตัวอักษร ⇒ หายไปพร้อมข้อความที่ซ่อน จึงวาดเอง */}
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
    </div>
  );
};

export const CatalogTemplate: React.FC<Props> = ({ catalog, form, onChange, onFamily }) => {
  const spec = catalog.find((s) => s.family === form.family);
  if (!spec) return null;
  const set = (patch: Partial<BhForm>, now?: boolean) => onChange({ ...form, ...patch }, now);

  const num = (key: SizeKey | 'watt', slot: CatalogSlot, ch: number) => (
    <Slot key={key} cap={`${slot.label}${slot.unit && key !== 'watt' ? ` ${slot.unit}` : ''}`} hint={slot.hint}>
      <input
        type="number" inputMode="decimal" min={0}
        className={`${INPUT} px-1.5 text-center`}
        style={{ width: `${ch}ch` }}
        value={form[key] ?? ''}
        aria-label={slot.label}
        onChange={(e) => set({ [key]: e.target.value === '' ? undefined : Number(e.target.value), ...(key === 'watt' ? { wattText: undefined } : { sizeText: undefined }) })}
      />
    </Slot>
  );

  const choice = (key: 'shape' | 'term' | 'mat' | 'conn' | 'amp', slot: CatalogSlot) => (
    <Slot key={key} cap={slot.label} hint={slot.hint}>
      <CodeSelect
        label={slot.label}
        value={form[key] ?? ''}
        placeholder={key === 'amp' ? '— เลือก —' : undefined}
        options={(slot.options ?? []).map((o) => (key === 'amp'
          ? { value: o.code, code: o.label }
          : { value: o.code, code: o.code || 'None', text: o.label }))}
        onChange={(v) => {
          if (key === 'shape') {
            // เปลี่ยนรูปทรง = ขนาดคนละชุด (W×L · D1 · D1×D2) — เติมค่าที่ยังไม่มีให้คิดราคาได้ทันที
            const dims = spec.shapes?.find((s) => s.code === v)?.dims ?? [];
            const fill: Partial<BhForm> = { sizeText: undefined };
            for (const d of dims) if (form[d] === undefined) fill[d] = d === 'd2' ? 100 : d === 'd1' ? 200 : 100;
            set({ shape: v, ...fill }, true);
          } else {
            set({ [key]: v || undefined, ...(key === 'term' && v !== 'T' ? { amp: undefined } : {}) }, true);
          }
        }}
      />
    </Slot>
  );

  const items: React.ReactNode[] = [];
  const extrasAfter = (slot: string) => {
    for (const [i, e] of (form.extras ?? []).entries()) {
      if (e.after !== slot) continue;
      if (!e.glue) items.push(<Sep key={`xs-${i}`} t="-" />);
      items.push(
        <Slot key={`x-${i}`} cap="นอกแคตตาล็อก">
          <span className="h-9 inline-flex items-center gap-1 pl-2.5 pr-1 rounded-lg font-mono text-[14px] font-bold bg-sky-50 border border-sky-200 text-sky-800">
            {e.text}
            <button type="button" aria-label={`เอา ${e.text} ออก`} title="เอาออกจากรหัส"
                    className="p-0.5 rounded hover:bg-sky-100"
                    onClick={() => set({ extras: (form.extras ?? []).filter((_, j) => j !== i) }, true)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        </Slot>,
      );
    }
  };

  items.push(
    // เจ้าของสั่ง 2026-09-28: ย้ายการ์ดเลือกรุ่นมาเป็น dropdown ในช่อง "รุ่น" — หัวรหัสก็คือช่องแรกของรหัสอยู่แล้ว
    <Slot key="head" cap="รุ่น">
      <CodeSelect
        label="รุ่น"
        value={form.family}
        options={catalog.map((s) => ({ value: s.family, code: s.head, text: s.name }))}
        onChange={(v) => v !== form.family && onFamily(v as BhForm['family'])}
      />
    </Slot>,
  );
  // BH-02: ท่อนที่ติดหลังหัวรหัสอยู่หลังช่อง Shape (ตัวอักษรรูปทรงเป็นส่วนหนึ่งของหัวรหัส)
  if (!spec.shapes) extrasAfter('head');
  // ตัวคั่นวาดก่อนช่องถัดไปเสมอ แม้ช่องนั้นเป็น None — แผนผังแคตตาล็อกโชว์ทุกช่อง (รหัสจริงไม่เขียนท่อน None)
  let pendingSep: string | null = null;
  for (const it of spec.layout) {
    if ('sep' in it) {
      if (it.sep === 'W') items.push(<Sep key={`sep-${items.length}`} t="W" />);
      else pendingSep = it.sep;
      continue;
    }
    const sep = pendingSep;
    pendingSep = null;
    if (sep) items.push(<Sep key={`sep-${items.length}`} t={sep} />);
    const slot = spec.slots[it.slot];
    if (it.slot === 'size') {
      if (form.sizeText !== undefined) {
        items.push(
          <Slot key="size" cap="ขนาด (ไม่ตรงแคตตาล็อก)">
            <span className="h-9 flex items-center px-2.5 rounded-lg font-mono text-[14px] font-bold bg-amber-50 border border-amber-200 text-amber-800">{form.sizeText}</span>
          </Slot>,
        );
      } else {
        const dims = spec.shapes?.find((s) => s.code === (form.shape ?? ''))?.dims ?? [];
        dims.forEach((d, i) => {
          if (i) items.push(<Sep key={`sx-${d}`} t="x" />);
          items.push(num(d, spec.slots[d]!, 8));
        });
      }
      extrasAfter('size');
      continue;
    }
    if (!slot) continue;
    if (it.slot === 'id' || it.slot === 'h') {
      items.push(num(it.slot, slot, it.slot === 'id' ? 8 : 7));
      if (it.slot === 'h') extrasAfter('size');
    } else if (it.slot === 'watt') {
      items.push(num('watt', slot, 9));
      extrasAfter('watt');
    } else if (it.slot === 'volt') {
      items.push(
        <Slot key="volt" cap={slot.label} hint={slot.hint}>
          <input
            className={`${INPUT} px-1.5 text-center`}
            style={{ width: '8ch' }}
            list="catalog-volts"
            value={form.volt ?? ''}
            aria-label={slot.label}
            onChange={(e) => set({ volt: e.target.value.replace(/\s/g, '') })}
          />
          <datalist id="catalog-volts">{slot.suggest?.map((v) => <option key={v} value={v} />)}</datalist>
        </Slot>,
      );
      extrasAfter('volt');
    } else if (it.slot === 'shape') {
      items.push(choice('shape', slot));
      extrasAfter('head');
    } else if (it.slot === 'term' || it.slot === 'mat' || it.slot === 'conn') {
      items.push(choice(it.slot, slot));
      // ขนาดเต๋าไม่อยู่ในรหัส — โผล่ข้างช่องขั้วไฟเฉพาะตอนเลือก T และเขียนบอกไว้ใต้ช่องว่าไม่ถูกพิมพ์ลงรหัส
      if (it.slot === 'term' && form.term === 'T' && spec.slots.amp) {
        items.push(
          <div key="amp" className="pl-1 border-l border-dashed border-slate-300 ml-1">
            {choice('amp', { ...spec.slots.amp, label: 'ขนาดเต๋า (ไม่อยู่ในรหัส)' })}
          </div>,
        );
      }
      extrasAfter(it.slot);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 pt-3 pb-2">
        {items}
      </div>
      {/* ชีตมีราคาเมตรละ แต่แคตตาล็อกและรหัสไม่มีท่อนนี้ ⇒ ติ๊กแยกใต้รหัส และบอกว่าไม่ถูกพิมพ์ลงรหัส (แบบเดียวกับขนาดเต๋า) */}
      {spec.addons?.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-slate-700">
          <span className="text-slate-500">บวกเพิ่ม (ไม่อยู่ในรหัส · คิดเมตรละตามสายส่วนที่เกินมาตรฐาน)</span>
          {spec.addons.map((a) => {
            const on = form.addons?.includes(a.code) ?? false;
            return (
              <label key={a.code} className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={on} aria-label={a.label}
                  onChange={() => {
                    const cur = form.addons ?? [];
                    set({ addons: on ? cur.filter((x) => x !== a.code) : [...cur, a.code] }, true);
                  }}
                />
                {a.label}
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
