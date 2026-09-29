import React, { useState } from 'react';
import { BookOpen, Calculator, ChevronLeft, Pencil, Plus, Table2, Trash2, Undo2 } from 'lucide-react';
import { Button } from '../Button';
import { ErrorBox } from '../logs/ui';
import type { EditorAdder, EditorView, Predicate } from './types';
import { axisTh, dimNice, effOver, fmt, isAlways, optLabel, predText, roundTh, stdUnit, toNum } from './tsRulesText';

/**
 * หน้า "กฎและเงื่อนไข" ของซีรีส์ TS — เจ้าของเคาะ mockup `pricing-rules-ts.html` 2026-09-29
 * ("ดูรกและเข้าใจยาก" · ตอบ 4 ข้อตามที่แนะนำ)
 *
 * **ทำไมไม่มีตารางราคารายขนาดแล้ว:** ตัวเลขชุดเดียวกันแก้ได้ครบที่หน้าชีตอยู่แล้ว (`SheetEditor` วางอัตราตามขนาดแกน
 * เป็นคอลัมน์ในตารางหลัก) · หน้านี้เคยโชว์ซ้ำเป็นกริด 36 ช่องต่อกฎ TS-18 มี 11 กริดต่อกัน ⇒ ตอบแค่
 * "คิดเมื่อไหร่ · คิดยังไง · ราคาประมาณเท่าไหร่" แล้วส่งไปแก้ตัวเลขรายขนาดที่หน้าชีต (ข้อ 1)
 *
 * ช่องราคาของกฎที่แยกตามค่าแกน มีสามแบบ ตัดสินจาก **ค่าตอนเปิดหน้า** (ไม่ใช่ค่าที่กำลังพิมพ์ — ไม่งั้นช่องเปลี่ยน
 * หน้าตาใต้มือคนพิมพ์):
 *   · ≤ 6 ค่า (ชนิดสาย · หน้าแปลน · เทปล่อน) = ช่องเล็กเรียงในบรรทัด
 *   · ราคาเท่ากันทุกขนาด = ช่องเดียว — **แก้แล้วเปลี่ยนเฉพาะขนาดที่มีราคาอยู่แล้ว** ขนาดที่ยังไม่มีราคาคงเดิม (ข้อ 2)
 *   · ราคาต่างกัน = ช่วงราคา + ปุ่มไปหน้าชีต (ข้อ 1)
 *
 * กติกาที่ยกมาจากหน้าเดิมทั้งหมด (หัว ModelPriceEditor.tsx): ว่าง ≠ 0 · เห็นส่วนต่างก่อนบันทึก ·
 * เงื่อนไขเลือกจากรายการ · สวิตช์ = พัก / ถังขยะ = ลบ ห้ามรวมเป็นปุ่มเดียว
 * BH ยังใช้หน้าเดิม (ข้อ 3) — ใครได้หน้านี้ตัดสินที่ `isTsRulesModel` (tsRulesText.ts)
 */

/** ช่องตัวเลข — จำข้อความที่พิมพ์ไว้ (ไม่งั้น "12." เด้งกลับเป็น "12") · เหลืองเมื่อต่างจากตอนเปิดหน้า */
const NumBox: React.FC<{
  value: number | null;
  was: number | null | undefined;
  label: string;
  onChange: (n: number | null) => void;
  placeholder?: string;
  width?: string;
}> = ({ value, was, label, onChange, placeholder = '—', width = 'w-[78px]' }) => {
  const [text, setText] = useState(value === null ? '' : String(value));
  // ค่าจากข้างนอกเปลี่ยน (ย้อนการแก้ · ช่องเดียวที่คุมหลายขนาด) ⇒ ข้อความที่จำไว้ไม่ตรงแล้ว ใช้ค่าจริงแทน
  const shown = toNum(text) === value && (text.trim() !== '' || value === null) ? text : value === null ? '' : String(value);
  const bad = text.trim() !== '' && !Number.isFinite(Number(text.trim())) && shown === text;
  const changed = value !== (was ?? null);
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      title={label}
      value={shown}
      placeholder={placeholder}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === '' || Number.isFinite(Number(t.trim()))) onChange(toNum(t));
      }}
      className={`${width} rounded-lg border px-2 py-1 text-right text-[13px] tabular-nums placeholder:text-[11px] ${
        bad ? 'border-rose-300 bg-rose-50 text-rose-700'
          : changed ? 'border-amber-300 bg-amber-50 font-bold text-amber-800'
            : 'border-slate-200 bg-card text-slate-900 placeholder:text-amber-700'
      }`}
    />
  );
};

const Sw: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <button
    type="button" role="switch" aria-checked={checked} aria-label={label} title={label}
    onClick={() => onChange(!checked)}
    className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
    style={{ backgroundColor: checked ? 'var(--brand)' : 'var(--c-line-strong)' }}
  >
    <span className={`inline-block h-4 w-4 rounded-full bg-card shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
  </button>
);

const unitOf = (a: EditorAdder) =>
  a.kind === 'perUnit' ? `บาท / ${a.step && a.step !== 1 ? `${a.step} ` : ''}${a.unit.trim()}` : a.kind === 'percent' ? '%' : 'บาท';

/** ประโยคของกฎ: "<ใคร> → <คิดยังไง> (ปัดยังไง)" */
const Sentence: React.FC<{ a: EditorAdder; vocab: EditorView['vocab'] }> = ({ a, vocab }) => {
  const who = <b className="text-slate-900">{isAlways(a.when) ? 'ทุกชิ้น' : predText(a.when, vocab)}</b>;
  if (a.kind === 'perUnit') {
    const u = a.unit.trim();
    const over = effOver(a);
    const times = a.times && a.times !== 1 ? ` × ${a.times}` : '';
    const round = <span className="text-slate-400"> ({roundTh(a.round, a.unit)})</span>;
    const dim = <b className="text-slate-900">{dimNice(a.dim, vocab)}</b>;
    return over === 0
      ? <>{who} → คิด{dim}ทุก ๆ {a.step ?? 1} {u} ตั้งแต่ {u} แรก{times}{round}</>
      : <>{who} → {dim} ยาวเกิน <b className="text-slate-900">{fmt(over)} {u}</b> คิดส่วนที่เกินทุก ๆ {a.step ?? 1} {u}{times}{round}</>;
  }
  if (a.kind === 'percent') return <>{who} → บวกเพิ่มเป็นเปอร์เซ็นต์ของยอดที่คิดมาถึงตอนนั้น</>;
  return <>{who} → บวกเงินก้อนเดียว{a.rates && <> ตาม<b className="text-slate-900">{a.byAxisTh}</b></>}</>;
};

type RateMode = 'single' | 'mini' | 'one' | 'range' | 'none';

/** แบบของช่องราคา — ตัดสินจากค่าตอนเปิดหน้า (`o`) · กฎที่เพิ่งเพิ่มไม่มี `o` ใช้ของปัจจุบัน */
function rateMode(a: EditorAdder, o: EditorAdder | undefined): RateMode {
  const src = o?.rates ?? a.rates;
  if (!src) return 'single';
  if (src.length <= 6) return 'mini';
  const priced = [...new Set(src.map((r) => r.rate).filter((x): x is number => x !== null))];
  if (priced.length === 0) return 'none';
  return priced.length === 1 ? 'one' : 'range';
}

const PriceCell: React.FC<{
  a: EditorAdder;
  o: EditorAdder | undefined;
  onChange: (next: EditorAdder) => void;
  onSheet: () => void;
}> = ({ a, o, onChange, onSheet }) => {
  const mode = rateMode(a, o);
  const unit = <span className="ml-1 text-[11px] text-slate-500">{unitOf(a)}</span>;

  if (mode === 'single') {
    const val = a.kind === 'percent' ? a.percent : a.kind === 'flat' ? a.amount : a.rate;
    const was = !o ? undefined : o.kind === 'percent' ? o.percent : o.kind === 'flat' ? o.amount : o.rate;
    return (
      <span className="inline-flex items-center">
        <NumBox
          label={`ราคาของกฎ ${a.label}`} value={val} was={was}
          // กฎแบบเหมาที่ช่องเงินว่าง = "ยังไม่มีราคา" ไม่ใช่ +0 (engine · เจ้าของ 2026-09-29)
          placeholder={a.kind === 'percent' ? '—' : 'ยังไม่มีราคา'}
          onChange={(n) => onChange(a.kind === 'percent' ? { ...a, percent: n } : a.kind === 'flat' ? { ...a, amount: n } : { ...a, rate: n })}
        />
        {unit}
      </span>
    );
  }

  const rates = a.rates ?? [];
  if (mode === 'mini') {
    return (
      <div>
        <div className="flex flex-wrap gap-x-2.5 gap-y-1.5 sm:justify-end">
          {rates.map((r) => (
            <label key={r.value} className="flex flex-col items-start gap-0.5 text-[10.5px] text-slate-500 sm:items-end">
              <span className="max-w-[80px] truncate" title={r.value}>{r.value.replace(/^สาย/, '') || '(ว่าง)'}</span>
              <NumBox
                width="w-[70px]" label={`${a.label} — ${a.byAxisTh ?? ''} ${r.value}`} value={r.rate}
                was={o?.rates?.find((x) => x.value === r.value)?.rate}
                placeholder={a.skipIfNoRate ? 'ไม่คิด' : 'ยังไม่มี'}
                onChange={(n) => onChange({ ...a, rates: rates.map((x) => (x.value === r.value ? { ...x, rate: n } : x)) })}
              />
            </label>
          ))}
        </div>
        <div className="mt-0.5 text-[11px] text-slate-500 sm:text-right">{unitOf(a)}</div>
      </div>
    );
  }

  if (mode === 'one') {
    // ข้อ 2: เปลี่ยนเฉพาะขนาดที่มีราคาตอนเปิดหน้า — ขนาดที่ยังไม่มีราคาคงเป็น "ยังไม่มีราคา"
    const priced = new Set((o?.rates ?? rates).filter((r) => r.rate !== null).map((r) => r.value));
    const first = rates.find((r) => priced.has(r.value));
    const wasVal = (o?.rates ?? rates).find((r) => r.rate !== null)?.rate;
    return (
      <div>
        <span className="inline-flex items-center">
          <NumBox
            label={`${a.label} — ทุก${a.byAxisTh ?? 'ค่าแกน'}ที่มีราคา`} value={first?.rate ?? null} was={wasVal}
            onChange={(n) => onChange({ ...a, rates: rates.map((x) => (priced.has(x.value) ? { ...x, rate: n } : x)) })}
          />
          {unit}
        </span>
        <div className="mt-0.5 text-[11px] text-slate-500">เท่ากันทุก{a.byAxisTh} · {priced.size} ขนาด</div>
      </div>
    );
  }

  const vals = rates.map((r) => r.rate).filter((x): x is number => x !== null);
  return (
    <div>
      {vals.length > 0 ? (
        <div className="text-[13.5px] font-bold tabular-nums text-slate-900">
          {fmt(Math.min(...vals))}{Math.min(...vals) !== Math.max(...vals) && <> – {fmt(Math.max(...vals))}</>}
          {unit}
          <span className="block text-[11px] font-normal text-slate-500">ต่างกันตาม{a.byAxisTh} · {rates.length} ขนาด</span>
        </div>
      ) : (
        <div className="text-[12.5px] font-semibold text-amber-700">ยังไม่มีราคาสักขนาด</div>
      )}
      <button type="button" onClick={onSheet}
              className="text-[11.5px] underline underline-offset-2" style={{ color: 'var(--brand-fg)' }}>
        แก้รายขนาดที่หน้าชีต →
      </button>
    </div>
  );
};

/**
 * ขนาดที่ยังไม่มีราคา พับไว้เป็นบรรทัดเดียว — กฎที่คิดตามขนาดแกน (แกนแถวของตาราง) เทียบกับ **ทุกขนาดในตาราง**
 * เพราะ `rates` ที่ส่งมามีแค่ค่าแกนที่สมุดรู้จักของกฎนั้น ขนาดที่ตารางมีแต่กฎไม่มีคีย์ก็ตอบ "ยังไม่มีราคา" เหมือนกัน
 * (engine: ไม่มีอัตรา = noRate) · กฎแกนอื่นที่ ≤ 6 ค่าเห็นช่องว่างในบรรทัดอยู่แล้ว ไม่ต้องบอกซ้ำ
 */
const Missing: React.FC<{ a: EditorAdder; rows: string[] | null }> = ({ a, rows }) => {
  const [open, setOpen] = useState(false);
  if (!a.rates) return null;
  const priced = new Set(a.rates.filter((r) => r.rate !== null).map((r) => r.value));
  const all = rows ? [...new Set([...rows, ...a.rates.map((r) => r.value)])] : a.rates.length > 6 ? a.rates.map((r) => r.value) : [];
  const miss = all.filter((v) => !priced.has(v));
  if (miss.length === 0) return null;
  return (
    <div className="mt-1 text-[11.5px] text-slate-500">
      มีราคา {priced.size} ขนาด · อีก {miss.length} ขนาด
      {a.skipIfNoRate ? 'ไม่คิดเพิ่ม (ตั้งไว้ให้ข้าม)' : 'ระบบตอบ “ยังไม่มีราคา”'}{' '}
      <button type="button" onClick={() => setOpen(!open)}
              className="underline underline-offset-2" style={{ color: 'var(--brand-fg)' }}>
        {open ? 'ซ่อน' : 'ดูขนาด'}
      </button>
      {open && <Chips values={miss} />}
    </div>
  );
};

const Chips: React.FC<{ values: string[] }> = ({ values }) => (
  <div className="mt-1 flex flex-wrap gap-1">
    {values.map((v) => (
      <span key={v} className="rounded-md bg-slate-100 px-1.5 py-px font-mono text-[11px] text-slate-600">{v || '(ว่าง)'}</span>
    ))}
  </div>
);

const Section: React.FC<{ title: string; count?: number; hint: string; children: React.ReactNode; foot?: React.ReactNode }> = ({
  title, count, hint, children, foot,
}) => (
  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-card">
    <header className="border-b border-slate-100 px-4 py-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
        {title}
        {count !== undefined && <span className="rounded-full bg-slate-100 px-2 py-px text-[11px] font-semibold text-slate-500">{count}</span>}
      </h3>
      <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
    </header>
    {children}
    {foot && <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-[11.5px] text-slate-500">{foot}</div>}
  </section>
);

/* ── ข้อห้าม: จัดกลุ่มตาม "อะไรทำให้เกิด" แล้วแตกรายการขนาดเป็นป้าย ──────────────── */

interface ConsItem { c: EditorView['constraints'][number]; lead: string; sizes: string[] }

function consGroups(v: EditorView): [string, ConsItem[]][] {
  const groups = new Map<string, ConsItem[]>();
  for (const c of v.constraints) {
    const p = c.when;
    let trig = 'ทุกใบของรุ่นนี้';
    let rest: Predicate | null = null;
    if (p && 'option' in p) trig = `เมื่อเลือก “${optLabel(p.option, v.vocab)}”`;
    else if (p && 'all' in p && p.all.some((x) => 'option' in x)) {
      const opt = p.all.find((x) => 'option' in x) as { option: string };
      trig = `เมื่อเลือก “${optLabel(opt.option, v.vocab)}”`;
      const others = p.all.filter((x) => x !== opt);
      rest = others.length === 1 ? others[0]! : others.length ? { all: others } : null;
    } else if (!isAlways(p)) {
      trig = 'ตามขนาดที่รหัสบอก';
      rest = p;
    }
    let lead = rest ? predText(rest, v.vocab) : '';
    let sizes: string[] = [];
    if (rest && 'in' in rest) { lead = `ใช้กับ${axisTh(rest.axis, v.vocab)}:`; sizes = rest.in; }
    else if (rest && 'notIn' in rest) { lead = `ใช้เมื่อ${axisTh(rest.axis, v.vocab)}ไม่ใช่:`; sizes = rest.notIn; }
    const list = groups.get(trig) ?? [];
    list.push({ c, lead, sizes });
    groups.set(trig, list);
  }
  return [...groups];
}

const LEVEL_CLS: Record<string, string> = {
  block: 'border-rose-200 bg-rose-50 text-rose-700',
  quoteOnRequest: 'border-amber-200 bg-amber-50 text-amber-800',
};

/* ── หน้าจอ ─────────────────────────────────────────────────────────────── */

export const TsRulesView: React.FC<{
  orig: EditorView;
  adders: (EditorAdder & { uid: string })[];
  constraintsOff: Set<string>;
  changes: number;
  error: string;
  onBack: () => void;
  onUndo: () => void;
  onReview: () => void;
  onAdder: (i: number, next: EditorAdder & { uid: string }) => void;
  onRemove: (i: number) => void;
  onEdit: (a: (EditorAdder & { uid: string }) | null) => void;
  onConstraint: (id: string, on: boolean) => void;
}> = ({ orig, adders, constraintsOff, changes, error, onBack, onUndo, onReview, onAdder, onRemove, onEdit, onConstraint }) => {
  const { vocab } = orig;
  const toSheet = () => {
    if (changes > 0 && !confirm('ยังไม่ได้บันทึกสิ่งที่แก้ในหน้านี้ — ออกไปหน้าชีตแล้วที่แก้ไว้จะหาย\n\nออกเลยไหม?')) return;
    onBack();
  };

  const row = (a: EditorAdder & { uid: string }) => {
    const i = adders.indexOf(a);
    const o = orig.adders.find((x) => x.id === a.id);
    return (
      <div key={a.uid}
           className="grid grid-cols-[40px_minmax(0,1fr)_56px] items-center gap-x-3 gap-y-1.5 border-b border-slate-100 px-4 py-3 last:border-b-0 sm:grid-cols-[40px_minmax(0,1fr)_auto_64px]">
        <div className="col-start-1 row-start-1">
          <Sw checked={!a.disabled} label={`เปิดใช้กฎ ${a.label}`} onChange={(on) => onAdder(i, { ...a, disabled: !on })} />
        </div>
        <div className={`col-start-2 row-start-1 min-w-0 ${a.disabled ? 'opacity-45' : ''}`}>
          <div className="text-[13.5px] font-bold text-slate-900">
            {a.label}
            {a.custom && (
              <span className="ml-1.5 rounded px-1.5 py-px text-[10.5px] font-bold"
                    style={{ background: 'var(--brand-soft)', color: 'var(--brand-fg)' }}>เพิ่มเอง</span>
            )}
            {a.disabled && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-px text-[10.5px] font-bold text-slate-500">พักไว้</span>}
          </div>
          <div className="mt-px text-[12.5px] text-slate-600"><Sentence a={a} vocab={vocab} /></div>
          {a.note && <div className="mt-0.5 text-[11px] text-slate-400">{a.note}</div>}
          <Missing a={a} rows={orig.base.kind === 'matrix' && orig.base.rows.length > 0 && a.byAxis === orig.base.axes[0] ? orig.base.rows : null} />
        </div>
        <div className={`col-span-2 col-start-2 row-start-2 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:text-right sm:whitespace-nowrap ${a.disabled ? 'opacity-45' : ''}`}>
          <PriceCell a={a} o={o} onChange={(n) => onAdder(i, { ...a, ...n })} onSheet={toSheet} />
        </div>
        <div className="col-start-3 row-start-1 flex justify-end gap-0.5 sm:col-start-4">
          <button type="button" aria-label={`แก้กฎ ${a.label}`} title="แก้เงื่อนไข / วิธีคิด" onClick={() => onEdit(a)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[var(--brand-fg)]">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button" aria-label={`ลบกฎ ${a.label}`} title="ลบกฎนี้"
            onClick={() => {
              if (!confirm(`ลบกฎ “${a.label}” ออกจาก ${orig.title}?\n\nถ้าแค่อยากหยุดใช้ชั่วคราว ให้ปิดสวิตช์แทน — ปิดแล้วย้อนกลับได้ และยังเห็นว่าเมื่อก่อนคิดเท่าไหร่`)) return;
              onRemove(i);
            }}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  };

  const always = adders.filter((a) => isAlways(a.when));
  const picked = adders.filter((a) => !isAlways(a.when));
  const groups = consGroups(orig);

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-start gap-2.5">
        <Button icon={ChevronLeft} onClick={toSheet}>กลับไปหน้าชีต</Button>
        <div className="min-w-[180px] flex-1">
          <h1 className="truncate text-lg font-bold text-slate-900">กฎและเงื่อนไข · {orig.title}</h1>
          <p className="mt-0.5 text-[11.5px] text-slate-500">
            {orig.label} · ใช้กับรหัส {[orig.name, ...orig.aliases].join(', ')}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button icon={Undo2} disabled={changes === 0} onClick={onUndo} className="flex-1 sm:flex-none">ย้อนการแก้</Button>
          <Button variant="primary" icon={BookOpen} disabled={changes === 0} onClick={onReview} className="flex-1 sm:flex-none">
            ตรวจก่อนบันทึก{changes > 0 && ` (${changes})`}
          </Button>
        </div>
      </div>

      {error && <ErrorBox message={error} />}

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-xl border px-3 py-2 text-[12.5px] text-slate-700"
           style={{ borderColor: 'var(--brand-border)', background: 'var(--brand-soft)' }}>
        <span>ราคาตั้งในชีตรวมแล้ว:</span>
        {orig.standard.length === 0 && <span className="rounded-full border border-slate-200 bg-card px-2 py-px text-[12px]">—</span>}
        {orig.standard.map((s) => (
          <span key={s.dim} className="rounded-full border bg-card px-2 py-px text-[12px]" style={{ borderColor: 'var(--brand-border)' }}>
            {dimNice(s.dim, vocab)} {fmt(s.value)} {stdUnit(s.dim, orig.adders)}
          </span>
        ))}
        <span className="text-slate-500">· ราคาตั้งและราคารายขนาดแก้ที่หน้าชีต</span>
        <Button size="sm" icon={Table2} onClick={toSheet} className="sm:ml-auto">เปิดหน้าชีต {orig.sheet}</Button>
      </div>

      <Section title="คิดเพิ่มทุกชิ้น" count={always.length}
               hint="บวกให้เองทุกใบ ไม่ต้องมีใครเลือก — ส่วนใหญ่คือความยาวที่เกินจากราคาตั้ง">
        {always.length ? always.map(row) : <div className="px-4 py-3 text-xs text-slate-500">ไม่มี</div>}
      </Section>

      <Section
        title="คิดเพิ่มเมื่อเลือกตัวเลือก" count={picked.length}
        hint="บวกเมื่อรหัสหรือลูกค้าเลือกตัวเลือกนั้น (Type T · หัวกระโหลก · หุ้มเทปล่อน · หัก L …)"
        foot={<>
          <Button size="sm" icon={Plus} onClick={() => onEdit(null)}>เพิ่มกฎ</Button>
          <span>กฎที่เพิ่มเองจะติดป้าย “เพิ่มเอง” เพื่อให้รู้ว่าไม่ได้มาจากไฟล์ราคา</span>
        </>}
      >
        {picked.length ? picked.map(row) : <div className="px-4 py-3 text-xs text-slate-500">รุ่นนี้ไม่มีตัวเลือกที่คิดเงินเพิ่ม</div>}
      </Section>

      {orig.constraints.length > 0 && (
        <Section title="ข้อห้าม / ต้องขอราคา" count={orig.constraints.length}
                 hint="ระบบใช้ข้อพวกนี้กันเสนอราคาของที่ผลิตไม่ได้ · ปิดสวิตช์ได้ถ้าเลิกใช้ข้อนั้น แก้ข้อความจากจอนี้ไม่ได้">
          {groups.map(([trig, items]) => (
            <div key={trig} className="border-b border-slate-100 px-4 py-2.5 last:border-b-0">
              <h4 className="mb-1.5 text-[12.5px] font-bold text-slate-800">{trig}</h4>
              {items.map(({ c, lead, sizes }) => {
                const off = constraintsOff.has(c.id);
                return (
                  <div key={c.id} className="grid grid-cols-[40px_auto_minmax(0,1fr)] items-start gap-2.5 py-1">
                    <Sw checked={!off} label={`เปิดใช้ข้อห้าม: ${c.message}`} onChange={(on) => onConstraint(c.id, on)} />
                    <span className={`whitespace-nowrap rounded-md border px-1.5 py-px text-[11px] font-bold ${LEVEL_CLS[c.level] ?? 'border-slate-200 bg-slate-100 text-slate-500'} ${off ? 'opacity-45' : ''}`}>
                      {c.levelTh}
                    </span>
                    <div className={`min-w-0 text-[12.5px] text-slate-800 ${off ? 'opacity-45' : ''}`}>
                      {c.message}
                      {lead && <div className="text-[11.5px] text-slate-500">{lead}</div>}
                      {sizes.length > 0 && <Chips values={sizes} />}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </Section>
      )}

      {orig.derived.length > 0 && (
        <Section title="ค่าที่ระบบคิดให้เอง" hint="อ่านอย่างเดียว — สูตรพวกนี้พังแล้วทั้งรุ่นคิดราคาไม่ออก จึงไม่เปิดให้แก้จากจอ">
          <div className="space-y-1.5 px-4 py-3">
            {orig.derived.map((d, i) => (
              <div key={`${d.name}-${i}`} className="flex gap-2 text-[12.5px] text-slate-600">
                <Calculator className="mt-px h-4 w-4 shrink-0 text-slate-400" />
                <span><b className="text-slate-800">{d.label}</b> = {d.argsTh} <span className="text-slate-400">({d.formulaTh})</span>
                  {d.whenTh && <span className="block text-[11.5px] text-slate-500">ใช้เมื่อ {d.whenTh}</span>}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
};
