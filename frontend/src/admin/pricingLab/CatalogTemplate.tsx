import React from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { BhForm, CatalogFamilySpec, CatalogOption, CatalogSlot, HoleRow, SizeKey, TsFamilySpec, TsForm, TsSlot } from './types';

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

/** หนึ่งรายการของช่อง "รุ่น" — BH กับ TS อยู่ในรายการเดียวกัน แบ่งกลุ่ม (เจ้าของเคาะข้อ 9 · 2026-09-29) */
export interface FamilyChoice { value: string; code: string; text: string; group: string }

interface Props {
  catalog: CatalogFamilySpec[];
  families: FamilyChoice[];
  form: BhForm;
  /** `now` = ช่องแบบเลือก ส่งทันที · ไม่ใส่ = ช่องพิมพ์ ให้ผู้เรียกหน่วงก่อนส่ง */
  onChange: (next: BhForm, now?: boolean) => void;
  onFamily: (family: string) => void;
}

const INPUT =
  'h-9 rounded-lg bg-card border border-slate-200 text-slate-900 font-mono text-[14px] font-semibold ' +
  'focus:outline-none focus:border-[var(--brand-border-strong)] focus:ring-2 focus:ring-[var(--brand-soft)]';

const Slot: React.FC<{ cap: string; children: React.ReactNode; hint?: string; tone?: Tone }> = ({ cap, children, hint, tone }) => (
  <div className="flex flex-col items-center gap-1" title={hint}>
    {children}
    <span className={`text-[10.5px] text-slate-500 whitespace-nowrap ${tone ? TONE_CAP[tone] : ''}`}>{cap}</span>
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
interface CodeOption { value: string; code: string; text?: string; group?: string }

/**
 * ระดับของ "ไม่ตรงแคตตาล็อก" (เจ้าของเคาะ mockup `pricing-one-form.html` 2026-10-01): เหลือง = เตือน คิดราคาได้ ·
 * ส้ม = ต้องขอราคาจากฝ่ายผลิต · แดง = อ่านไม่ออกจนคิดราคาไม่ได้ — ช่องระบายสีแทนการ์ด "ระบบอ่านรหัสนี้ว่าอะไร"
 */
export type Tone = 'warn' | 'ask' | 'bad';
/** พื้น + ขอบ — select ใช้แค่นี้ (ตัวอักษรของ select ต้องโปร่งใสไว้ ไม่งั้นข้อความของตัวเลือกโผล่ซ้อนรหัสที่วางทับ) */
const TONE_FRAME: Record<Tone, string> = {
  warn: '!bg-amber-50 !border-2 !border-amber-300',
  ask: '!bg-orange-50 !border-2 !border-orange-500',
  bad: '!bg-red-50 !border-2 !border-red-300',
};
const TONE_TEXT: Record<Tone, string> = { warn: 'text-amber-800', ask: 'text-orange-700', bad: 'text-red-700' };
/** ช่องพิมพ์ / ชิป — พื้น ขอบ และสีตัวอักษร */
const TONE_BOX: Record<Tone, string> = {
  warn: `${TONE_FRAME.warn} !text-amber-800`,
  ask: `${TONE_FRAME.ask} !text-orange-700`,
  bad: `${TONE_FRAME.bad} !text-red-700`,
};
const TONE_CAP: Record<Tone, string> = { warn: '!text-amber-700 font-semibold', ask: '!text-orange-700 font-semibold', bad: '!text-red-700 font-semibold' };

const CodeSelect: React.FC<{
  label: string; value: string; options: CodeOption[]; placeholder?: string; onChange: (v: string) => void;
  /** ข้อความที่โชว์ในช่องแทนรหัสของตัวเลือก — ค่าตามที่รหัสเขียน (`M5` ของค่ามาตรฐาน · ค่านอกแคตตาล็อก) */
  shown?: string;
  tone?: Tone;
}> = ({ label, value, options, placeholder, onChange, shown, tone }) => {
  const cur = options.find((o) => o.value === value);
  const ch = Math.max(placeholder?.length ?? 0, shown?.length ?? 0, ...options.map((o) => o.code.length)) + 4;
  const item = (o: CodeOption) => (
    <option key={o.value} className="bg-card text-slate-900" value={o.value}>{o.text ? `${o.code} · ${o.text}` : o.code}</option>
  );
  const groups = [...new Set(options.map((o) => o.group).filter((g): g is string => !!g))];
  return (
    <div className="relative font-mono text-[14px]" style={{ width: `${ch}ch` }}>
      <select className={`${INPUT} w-full pl-2 pr-6 text-transparent appearance-none cursor-pointer ${tone ? TONE_FRAME[tone] : ''}`} value={value} aria-label={label}
              onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined && <option className="bg-card text-slate-900" value="">{placeholder}</option>}
        {groups.length
          ? groups.map((g) => <optgroup key={g} label={g} className="bg-card text-slate-500">{options.filter((o) => o.group === g).map(item)}</optgroup>)
          : options.map(item)}
      </select>
      <span aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2 font-semibold ${
              tone ? TONE_TEXT[tone] : cur || shown ? 'text-slate-900' : 'text-slate-400'}`}>
        {shown ?? cur?.code ?? placeholder}
      </span>
      {/* ลูกศรของเบราว์เซอร์ใช้สีตัวอักษร ⇒ หายไปพร้อมข้อความที่ซ่อน จึงวาดเอง */}
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
    </div>
  );
};

/**
 * ช่อง "เจาะรู" — ไม่อยู่ในรหัส (หมายเหตุแคตตาล็อก "ถ้ามีเจาะรูควรระบุขนาดและตำแหน่งเจาะรู") · เจ้าของเคาะ mockup แบบ B
 * 2026-09-29 (`mockups/pricing-bh-holes.html`): แถวละขนาด เพิ่มแถวได้ · ราคาต่อ mm อยู่ที่กฎ "เจาะรู" ของสมุดราคา
 * แถวที่ยังกรอกไม่ครบส่งขึ้นไปได้ (NaN) — เซิร์ฟเวอร์ทิ้งเอง ⇒ ผลรวมบนจอนับเฉพาะแถวที่ครบ ให้ตรงกับที่คิดเงิน
 */
const HOLE_INPUT =
  'h-8 w-16 rounded-lg bg-card border border-slate-200 px-1.5 text-center font-mono text-[13px] font-semibold text-slate-900 ' +
  'focus:outline-none focus:border-[var(--brand-border-strong)] focus:ring-2 focus:ring-[var(--brand-soft)]';
const HoleRows: React.FC<{ rows: HoleRow[]; onChange: (rows: HoleRow[], now?: boolean) => void }> = ({ rows, onChange }) => {
  const valid = rows.filter((r) => Number.isInteger(r.count) && r.count > 0 && r.mm > 0);
  // ปัดแบบเดียวกับตัวอ่านรหัส (`readHoles` ใน code.ts) — ตัวเลข "รวม" บนจอต้องเท่ากับที่คิดเงิน
  const total = Math.round(valid.reduce((t, r) => t + r.count * r.mm, 0) * 100) / 100;
  const put = (i: number, patch: Partial<HoleRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const numOf = (v: string) => (v === '' ? NaN : Number(v));
  const shown = (n: number) => (Number.isNaN(n) ? '' : String(n));
  return (
    <div className="mt-2 flex flex-col gap-1.5 text-[12.5px] text-slate-700">
      <span className="text-slate-500">เจาะรู (ไม่อยู่ในรหัส)</span>
      {rows.map((r, i) => (
        <span key={i} className="inline-flex flex-wrap items-center gap-1.5">
          <input type="number" inputMode="numeric" min={1} step={1} className={HOLE_INPUT} aria-label={`จำนวนรู แถว ${i + 1}`}
                 value={shown(r.count)} onChange={(e) => put(i, { count: numOf(e.target.value) })} />
          รู <span className="text-slate-400">×</span> Ø
          <input type="number" inputMode="decimal" min={0} className={HOLE_INPUT} aria-label={`ขนาดรู (mm) แถว ${i + 1}`}
                 value={shown(r.mm)} onChange={(e) => put(i, { mm: numOf(e.target.value) })} />
          mm
          <button type="button" className="ml-0.5 p-1 text-slate-400 hover:text-red-600 cursor-pointer" aria-label={`ลบแถวเจาะรู ${i + 1}`}
                  onClick={() => onChange(rows.filter((_, j) => j !== i), true)}>
            <X className="h-4 w-4" />
          </button>
        </span>
      ))}
      <span className="inline-flex flex-wrap items-center gap-3">
        <button type="button" className="font-medium text-[var(--brand-btn)] hover:underline cursor-pointer"
                onClick={() => onChange([...rows, { count: 1, mm: NaN }])}>
          + เพิ่มขนาดรู
        </button>
        {valid.length > 0 && <span className="text-slate-500">รวม {total} mm</span>}
      </span>
    </div>
  );
};

/** ช่อง "รุ่น" — ช่องแรกของรหัส ใช้ร่วมกันทั้ง BH และ TS (สลับข้ามซีรีส์ได้จากช่องนี้) */
const FamilySlot: React.FC<{ families: FamilyChoice[]; value: string; onFamily: (v: string) => void }> = ({ families, value, onFamily }) => (
  <Slot cap={value ? 'รุ่น' : 'ไม่พบรุ่นในสมุดราคา'} tone={value ? undefined : 'bad'}>
    <CodeSelect label="รุ่น" value={value} options={families} placeholder={value ? undefined : 'เลือกรุ่น'}
                tone={value ? undefined : 'bad'} onChange={(v) => v && v !== value && onFamily(v)} />
  </Slot>
);

/**
 * รหัสที่ระบบไม่รู้ว่าเป็นรุ่นไหนในสมุดราคา — ช่องเดียวที่มีให้คือ "รุ่น" (ว่าง · แดง) ส่วนเหตุผลอยู่ในแถบเตือนข้างล่าง
 * (mockup `pricing-one-form.html` ตัวอย่างที่ 7) · เลือกรุ่นแล้วได้ช่องของรุ่นนั้นตามค่าเริ่มต้น
 */
export const NoModelTemplate: React.FC<{ families: FamilyChoice[]; onFamily: (family: string) => void }> = ({ families, onFamily }) => (
  <div className="flex flex-wrap items-start gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 pt-3 pb-2">
    <FamilySlot families={families} value="" onFamily={onFamily} />
  </div>
);

export const CatalogTemplate: React.FC<Props> = ({ catalog, families, form, onChange, onFamily }) => {
  const spec = catalog.find((s) => s.family === form.family);
  if (!spec) return null;
  const set = (patch: Partial<BhForm>, now?: boolean) => onChange({ ...form, ...patch }, now);

  // รหัสนอกรูปแบบ (`loose`) ที่ไม่ได้บอกช่องตัวเลขนี้ — ระบายเหลือง "ไม่ได้ระบุ" (ช่องปกติที่เพิ่งลบตัวเลขไม่ระบาย)
  const missing = (key: SizeKey | 'watt') => !!form.loose && form[key] === undefined && !(key === 'watt' && form.wattText);
  const num = (key: SizeKey | 'watt', slot: CatalogSlot, ch: number) => (
    <Slot key={key} cap={missing(key) ? 'ไม่ได้ระบุ' : `${slot.label}${slot.unit && key !== 'watt' ? ` ${slot.unit}` : ''}`} hint={slot.hint}
          tone={missing(key) ? 'warn' : undefined}>
      <input
        type="number" inputMode="decimal" min={0}
        className={`${INPUT} px-1.5 text-center ${missing(key) ? TONE_BOX.warn : ''}`}
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
    <FamilySlot key="head" families={families} value={form.family} onFamily={onFamily} />,
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
      {spec.holes && (
        <HoleRows rows={form.holes ?? []} onChange={(holes, now) => set({ holes: holes.length ? holes : undefined }, now)} />
      )}
    </div>
  );
};

/**
 * ช่องกรอกตามแคตตาล็อกของซีรีส์ TS — หน้าตาเดียวกับของ BH (เจ้าของเคาะ mockup `pricing-catalogue-ts.html` 2026-09-29)
 *
 * วาดจาก `layout` ของแต่ละตารางตรง ๆ (`services/pricingLab/catalogTs.ts`) ⇒ ไม่มีโค้ดรายรุ่นฝั่งเบราว์เซอร์ · **ไม่ประกอบรหัส
 * และไม่คิดราคา** เหมือนของ BH — ส่งค่าช่องขึ้นไปให้เซิร์ฟเวอร์ประกอบ (`buildTsCode`) แล้วคิดทางเดียวกับรหัสที่พิมพ์
 * ตัวเลือกที่ Excel ยังไม่มีราคา **ไม่ติดป้ายในรายการ** โดยตั้งใจ — แอดมินกรอกราคาทีหลังได้ ผลคิดราคาข้างล่างเป็นคนบอก
 */
interface TsProps {
  spec: TsFamilySpec;
  families: FamilyChoice[];
  form: TsForm;
  onChange: (next: TsForm, now?: boolean) => void;
  onFamily: (family: string) => void;
  /** ผลคิดราคาตอนนี้ — ช่อง "อ่านไม่ออก" เป็นแดงเมื่อคิดราคาไม่ได้ · ช่องนอกแคตตาล็อกเป็นส้มเมื่อต้องขอราคา */
  status?: 'priced' | 'quoteOnRequest' | 'notManufacturable';
}

const tsOptions = (slot: TsSlot, values: Record<string, string>): CatalogOption[] =>
  slot.optionsByProbe ? slot.optionsByProbe[values.probe ?? 'TS'] ?? [] : slot.options ?? [];

/** ค่าในช่องตามที่รหัสเขียนแต่ไม่อยู่ในรายการ — ใช้ค่านี้เป็นตัวเลือกพิเศษของ select ให้ค่าที่เลือกอยู่ถูกต้อง */
const WRITTEN = '__written__';
/** ท้ายรหัสแบบงานสั่งทำ (`-S000`) = ท่อนเสริมสีฟ้าแบบเดิม · ที่เหลือ = อ่านไม่ออก (เหลือง) */
const isExtra = (t: string) => /^-[A-Z]+\d+$/i.test(t);

export const TsCatalogTemplate: React.FC<TsProps> = ({ spec, families, form, onChange, onFamily, status }) => {
  /** ค่าใหม่ในช่อง = ทิ้งของ "ตามที่รหัสเขียน" ของช่องนั้น (ค่า · ป้ายเตือน · ช่องที่รหัสไม่ได้เขียน) */
  const forget = (key: string): Partial<TsForm> => {
    const drop = <T,>(r?: Record<string, T>) => {
      if (!r || !(key in r)) return r;
      const rest = Object.fromEntries(Object.entries(r).filter(([k]) => k !== key));
      return Object.keys(rest).length ? rest : undefined;
    };
    const omit = form.omit?.filter((k) => k !== key);
    return { written: drop(form.written), issues: drop(form.issues), omit: omit?.length ? omit : undefined };
  };
  const set = (patch: Record<string, string>, now?: boolean) => {
    let next: TsForm = { ...form, values: { ...form.values, ...patch } };
    for (const k of Object.keys(patch)) next = { ...next, ...forget(k) };
    onChange(next, now);
  };
  const toneOf = (key: string): Tone | undefined => {
    const issue = form.issues?.[key];
    if (!issue) return undefined;
    if (issue === 'ask') return status === 'quoteOnRequest' ? 'ask' : 'warn';
    if (issue === 'unread') return status === 'notManufacturable' ? 'bad' : 'warn';
    return 'warn';
  };
  const capOf = (key: string, label: string): string => {
    const issue = form.issues?.[key];
    if (issue === 'ask') return status === 'quoteOnRequest' ? 'ขอราคาฝ่ายผลิต' : 'นอกแคตตาล็อก';
    if (issue === 'off') return 'ไม่อยู่ในแคตตาล็อก';
    if (issue === 'unread') return 'อ่านไม่ออก';
    if (issue === 'missing') return 'ไม่ได้ระบุ';
    return label;
  };
  const cm = form.clUnit === 'cm';
  const items: React.ReactNode[] = [<FamilySlot key="head" families={families} value={form.family} onFamily={onFamily} />];
  // ตัวคั่นวาดก่อนช่องถัดไปเสมอ แม้ช่องนั้นเป็น None — แผนผังแคตตาล็อกโชว์ทุกช่อง (รหัสจริงไม่เขียนท่อน None)
  for (const [i, it] of spec.layout.entries()) {
    if ('sep' in it) {
      // หน่วยของความยาวสายตามที่รหัสเขียน (`+30cm`) · TS_-11 ที่เขียนสายติดกับ M (`+5MPU`)
      let t = it.sep === ' ' ? '␣' : it.sep;
      if (t === 'M' || t === 'M-') t = `${cm ? 'cm' : 'M'}${t === 'M-' && !form.cableNoDash ? '-' : ''}`;
      items.push(<Sep key={`sep-${i}`} t={t} />);
      continue;
    }
    if ('fixed' in it) {
      items.push(
        <span key={`fx-${i}`} className="h-9 flex items-center px-2.5 rounded-lg bg-slate-100 font-mono text-[14px] font-bold text-slate-900">{it.fixed}</span>,
      );
      continue;
    }
    const key = it.slot;
    const slot = spec.slots[key];
    if (!slot) continue;
    const value = form.values[key] ?? '';
    const tone = toneOf(key);
    if (slot.kind === 'number') {
      const ch = Math.max(5, (slot.placeholder?.length ?? 0) + 3, value.length + 3);
      const unit = key === 'cl' && cm ? 'cm' : slot.unit;
      items.push(
        <Slot key={key} cap={capOf(key, `${slot.label}${unit ? ` (${unit})` : ''}`)} hint={slot.hint} tone={tone}>
          <input
            inputMode="decimal"
            className={`${INPUT} px-1.5 text-center placeholder:text-slate-400 placeholder:font-medium ${tone ? TONE_BOX[tone] : ''}`}
            style={{ width: `${ch}ch` }}
            value={value}
            placeholder={slot.placeholder}
            aria-label={slot.label}
            onChange={(e) => set({ [key]: e.target.value.replace(/[^0-9.]/g, '') })}
          />
        </Slot>,
      );
      continue;
    }
    const opts = tsOptions(slot, form.values);
    const written = form.written?.[key];
    // ค่าตามที่รหัสเขียน: นอกรายการ = ตัวเลือกพิเศษ (ค่าที่เลือกอยู่) · อยู่ในรายการแต่เขียนต่าง (`M5` = ค่ามาตรฐาน) = แค่ข้อความที่โชว์
    const outside = written !== undefined && !!form.issues?.[key] && !opts.some((o) => o.code === value && value !== '');
    const options = opts.map((o) => ({ value: o.code, code: o.code || 'None', text: o.label }));
    items.push(
      <Slot key={key} cap={capOf(key, slot.label)} hint={slot.hint} tone={tone}>
        <CodeSelect
          label={slot.label}
          value={outside ? WRITTEN : value}
          options={outside ? [{ value: WRITTEN, code: written!, text: 'ตามที่รหัสเขียน' }, ...options] : options}
          placeholder={form.issues?.[key] === 'missing' ? '?' : undefined}
          shown={written !== undefined && (outside || value === '') ? written : undefined}
          tone={tone}
          onChange={(v) => {
            if (v === WRITTEN) return;
            if (key !== 'probe') { set({ [key]: v }, true); return; }
            // เปลี่ยนชนิดหัววัด = ตัวเลือกของช่อง Sensor คนละชุด (TS → K J T … · N/P → 2K 10K)
            const next: Record<string, string> = { ...form.values, probe: v };
            const sensors = spec.slots.sensor ? tsOptions(spec.slots.sensor, next) : [];
            if (!sensors.some((o) => o.code === next.sensor)) next.sensor = sensors[0]?.code ?? '';
            onChange({ ...form, values: next, ...forget('probe') }, true);
          }}
        />
      </Slot>,
    );
  }
  for (const [i, e] of (form.extras ?? []).entries()) {
    items.push(<Sep key={`xs-${i}`} t="-" />);
    items.push(
      <Slot key={`x-${i}`} cap="นอกแคตตาล็อก">
        <span className="h-9 inline-flex items-center gap-1 pl-2.5 pr-1 rounded-lg font-mono text-[14px] font-bold bg-sky-50 border border-sky-200 text-sky-800">
          {e}
          <button type="button" aria-label={`เอา ${e} ออก`} title="เอาออกจากรหัส" className="p-0.5 rounded hover:bg-sky-100"
                  onClick={() => onChange({ ...form, extras: (form.extras ?? []).filter((_, j) => j !== i) }, true)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </Slot>,
    );
  }
  // ท่อนที่อ่านไม่ออก (หลังเลขรุ่น + ท้ายรหัส) ต่อท้ายแถวเป็นชิป · กด ✕ = เอาออกจากรหัส (mockup ตัวอย่างที่ 5)
  const chip = (k: string, text: string, extra: boolean, remove: () => void) => (
    <Slot key={k} cap={extra ? 'นอกแคตตาล็อก' : 'อ่านไม่ออก'} tone={extra ? undefined : 'warn'}>
      <span className={`h-9 inline-flex items-center gap-1 pl-2.5 pr-1 rounded-lg font-mono text-[14px] font-bold ${
        extra ? 'bg-sky-50 border border-sky-200 text-sky-800' : TONE_BOX.warn}`}>
        {text}
        <button type="button" aria-label={`เอา ${text} ออก`} title="เอาออกจากรหัส" className="p-0.5 rounded hover:opacity-70" onClick={remove}>
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
    </Slot>
  );
  const chips: React.ReactNode[] = [];
  if (form.headJunk) chips.push(chip('hj', form.headJunk.replace(/^-/, ''), false, () => onChange({ ...form, headJunk: undefined }, true)));
  for (const [i, t] of (form.tail ?? []).entries()) {
    const text = t.replace(/^-/, '');
    if (!text) continue;
    chips.push(chip(`t-${i}`, text, isExtra(t), () => {
      const tail = (form.tail ?? []).filter((_, j) => j !== i);
      onChange({ ...form, tail: tail.length ? tail : undefined }, true);
    }));
  }
  if (chips.length) items.push(<Sep key="chips" t="·" />, ...chips);

  return (
    <div>
      <div className="flex flex-wrap items-start gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 pt-3 pb-2">
        {items}
      </div>
      {/* ชีตมีราคาแต่แคตตาล็อกและรหัสไม่มีท่อนนี้ (หัก L · หักฉาก — ข้อ 8) ⇒ ติ๊กแยกใต้รหัส แบบเดียวกับ "บวกเพิ่ม" ของ BH */}
      {spec.addons?.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-slate-700">
          <span className="text-slate-500">บวกเพิ่ม (ไม่อยู่ในรหัส)</span>
          {spec.addons.map((a) => {
            const on = form.addons?.includes(a.code) ?? false;
            return (
              <label key={a.code} className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={on} aria-label={a.label}
                  onChange={() => {
                    const cur = form.addons ?? [];
                    onChange({ ...form, addons: on ? cur.filter((x) => x !== a.code) : [...cur, a.code] }, true);
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
