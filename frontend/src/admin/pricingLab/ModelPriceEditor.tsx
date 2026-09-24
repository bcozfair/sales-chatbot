import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, Calculator, ChevronLeft, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { Button } from '../Button';
import { TableCard, ErrorBox } from '../logs/ui';
import { errMsg } from '../logs/format';
import { RuleEditModal } from './RuleEditModal';
import type { EditorAdder, EditorBand, EditorView } from './types';

/**
 * หน้า "แก้ราคาทีละรุ่น" — เคาะหน้าตาจาก mockup ชุด pe-* เมื่อ 2026-09-22/23
 *
 * คนที่ใช้จอนี้คือพนักงานออฟฟิศ ไม่ใช่คนรู้โปรแกรม ⇒ กติกาที่ถูกเคาะไว้แล้ว อย่าแก้กลับ:
 *   · **ช่องว่างในคอลัมน์ราคา = ไม่รับผลิตขนาดนั้น ไม่ใช่ราคา 0** — ลบเลขออกได้ แต่ต้องขึ้นเตือน
 *   · **ก่อนบันทึกต้องเห็นส่วนต่าง (เดิม → ใหม่) ทุกช่องที่แก้** ไม่ใช่กดเซฟแล้วจบ
 *   · **ช่องโหว่ระหว่างช่วงขนาดต้องคำนวณให้** — 0-5 แล้วข้ามไป 11-15 ดูเรียบร้อยดีในตาราง
 *     แต่ขนาดที่ตกช่องนั้นคิดราคาไม่ออก ไม่มีทางเห็นด้วยตา
 *   · **เงื่อนไขเลือกจากรายการ ไม่มีช่องพิมพ์สูตร** (เหตุผลอยู่ใน services/pricingLab/types.ts)
 *   · **ปิดสวิตช์ = พักไว้ ยังย้อนได้ · ถังขยะ = ลบทิ้ง** — สองอย่างนี้ห้ามยุบเป็นปุ่มเดียว
 *
 * ⚠️ ต่างจาก `PricingLab.tsx` ตรงที่ **จอนี้ถือราคาไว้ใน state จริง** — จำเป็น เพราะมันคือจอแก้
 *   สิ่งที่ยังต้องเป็นจริงอยู่คือ "ไม่มีราคาอยู่ใน bundle" · ราคาเดินทางมาตอนเปิดรุ่นเท่านั้น
 *   และเส้น API ที่ส่งมาอยู่หลังด่าน `page.pricebook` ของหน้าสมุดราคา (ดูหัว routes/pricingLab.ts)
 */

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : n.toLocaleString('en-US');

const toNum = (v: string): number | null => {
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** สวิตช์เปล่า ๆ สำหรับในแถวตาราง — `SettingToggle` เป็นแบบเต็มบรรทัดพร้อมป้าย ใช้ในตารางไม่ได้ */
const Sw: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({
  checked, onChange, label,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    title={label}
    onClick={() => onChange(!checked)}
    className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
    style={{ backgroundColor: checked ? 'var(--brand)' : 'var(--c-line-strong)' }}
  >
    <span
      className={`inline-block h-4 w-4 rounded-full bg-card shadow transition-transform ${
        checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
      }`}
    />
  </button>
);

/** ช่องตัวเลขในตาราง — ไฮไลต์เหลืองเมื่อค่าต่างจากตอนเปิดหน้า */
const Cell: React.FC<{
  value: string;
  was: string;
  onChange: (v: string) => void;
  label: string;
  width?: string;
  align?: 'right' | 'center';
  placeholder?: string;
}> = ({ value, was, onChange, label, width = 'w-24', align = 'right', placeholder = '—' }) => {
  const changed = value.trim() !== was.trim();
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${width} rounded-lg border px-2 py-1 text-[13px] tabular-nums ${
        align === 'right' ? 'text-right' : 'text-center'
      } ${
        changed
          ? 'border-amber-300 bg-amber-50 font-bold text-amber-800'
          : 'border-slate-200 bg-card text-slate-900'
      }`}
    />
  );
};

/** เรียงค่าแกนแบบคนอ่าน: 2 · 2.5S · 3 · 3A · 3S · 3.2 … (ในชีตเรียงตามลำดับที่ลอกมา ปนกันจนหาไม่เจอ) */
const byNatural = (x: string, y: string) => {
  const nx = parseFloat(x);
  const ny = parseFloat(y);
  if (Number.isFinite(nx) && Number.isFinite(ny) && nx !== ny) return nx - ny;
  return x.localeCompare(y, 'en', { numeric: true });
};

/**
 * ราคาแยกตามค่าแกน (เช่น "ความยาวแกน L1" ที่ราคาต่อ 100 mm ต่างกันตามขนาดแกน) — แถวย่อยเต็มความกว้าง
 *
 * หัวบรรทัดบอกว่าเลขเหล่านี้แยกตามอะไร และหน่วยคืออะไร · ทุกช่องมีป้ายค่าแกนอยู่ข้างบน
 * ⚠️ **ช่องว่าง ≠ 0** — ลบเลขทิ้ง = "ขนาดนี้ไม่มีราคา ต้องขอราคา" · ใส่ 0 = "ไม่คิดเงินเพิ่ม"
 *   เดิมช่องที่ลบทิ้งถูกบันทึกเป็น 0 ⇒ ขนาดนั้นกลายเป็นของแถมเงียบ ๆ (บั๊กที่เจอ 2026-09-23)
 */
const RatesGrid: React.FC<{
  a: EditorAdder;
  orig: EditorAdder | undefined;
  onChange: (value: string, rate: number | null) => void;
}> = ({ a, orig, onChange }) => {
  const unit = a.kind === 'perUnit'
    ? `บาท / ${a.step && a.step !== 1 ? `${a.step} ` : ''}${a.unit.trim()}`
    : a.kind === 'percent' ? '%' : 'บาท';
  const rows = [...(a.rates ?? [])].sort((x, y) => byNatural(x.value, y.value));
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <div className="text-[11px] text-slate-500 mb-2">
        ราคาแยกตาม <b className="text-slate-700">{a.byAxisTh ?? 'ค่าแกน'}</b> · หน่วย {unit}
        <span className="text-slate-400"> · เว้นว่าง = ขนาดนั้นต้องขอราคา (ไม่ใช่ฟรี)</span>
      </div>
      <div className="grid gap-x-2 gap-y-1.5 grid-cols-[repeat(auto-fill,minmax(84px,1fr))]">
        {rows.map((r) => {
          const was = orig?.rates?.find((x) => x.value === r.value)?.rate;
          return (
            <label key={r.value} className="flex flex-col gap-0.5">
              <span className="text-[10.5px] font-semibold text-slate-500 truncate" title={r.value}>{r.value || '(ว่าง)'}</span>
              <Cell label={`${a.label} — ${a.byAxisTh ?? ''} ${r.value}`} width="w-full"
                    value={r.rate === null ? '' : String(r.rate)}
                    was={was === null || was === undefined ? '' : String(was)}
                    onChange={(val) => onChange(r.value, toNum(val))} />
            </label>
          );
        })}
      </div>
    </div>
  );
};

/* ── สำเนาทำงาน ─────────────────────────────────────────────────────────────
   แถวถูกเพิ่ม/ลบได้ ⇒ เทียบ "เดิม → ใหม่" ด้วยตำแหน่งในอาเรย์ไม่ได้ ต้องมีกุญแจของแถวเอง */

interface WBand extends EditorBand { uid: string }
interface WAdder extends EditorAdder { uid: string }

interface Working {
  bands: WBand[];
  adders: WAdder[];
  variantOn: boolean;
  variantPercent: string;
  /** id ของกฎ → ราคาฝั่งตัวเลือก (เป็นข้อความเพราะกำลังพิมพ์อยู่) */
  variantPrices: Record<string, string>;
  constraintsOff: Set<string>;
}

let SEQ = 0;
const uid = (p: string) => `${p}${++SEQ}`;

function toWorking(v: EditorView): Working {
  return {
    // กุญแจของแถวเดิมต้องคงที่และตรงกับที่ `buildDiff` ใช้ค้น ⇒ ผูกกับตำแหน่งในเล่มที่โหลดมา
    // (ห้ามใช้ `uid()` ที่เดินหน้าเรื่อย ๆ ไม่งั้นพอบันทึกแล้วโหลดใหม่ ทุกแถวจะกลายเป็น "เพิ่มใหม่")
    bands: v.base.kind === 'banded' ? v.base.bands.map((b, i) => ({ ...b, uid: `b${i + 1}` })) : [],
    adders: v.adders.map((a) => ({ ...a, uid: a.id })),
    variantOn: !!v.variant && !v.variant.disabled,
    variantPercent: String(v.variant?.percent ?? 0),
    variantPrices: Object.fromEntries(
      Object.entries(v.variant?.adderPrices ?? {}).map(([k, n]) => [k, String(n)]),
    ),
    constraintsOff: new Set(v.constraints.filter((c) => c.disabled).map((c) => c.id)),
  };
}

/* ── ช่องโหว่ของช่วงขนาด ────────────────────────────────────────────────────
   ต้องคิดฝั่งจอด้วย ไม่ใช่รอให้ฝั่งเซิร์ฟเวอร์ปฏิเสธตอนกดบันทึก — คนแก้ต้องเห็นตอนที่ยังแก้อยู่
   (ฝั่งเซิร์ฟเวอร์ก็ยังตรวจซ้ำ เพราะหน้าจอไม่ใช่ด่าน) */

const rangeText = (b: WBand) => `${b.min ?? '?'} - ${b.max === null ? 'ขึ้นไป' : b.max}`;

function bandProblems(bands: WBand[]): string[] {
  const out: string[] = [];
  const sorted = [...bands].sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
  sorted.forEach((c, i) => {
    if (i === 0) return;
    const p = sorted[i - 1]!;
    if (p.max === null) out.push(`ช่วง “${rangeText(p)}” ไม่มีขอบบน แต่ยังมีช่วงอื่นต่อท้าย`);
    else if (c.min <= p.max) out.push(`ช่วง “${rangeText(p)}” กับ “${rangeText(c)}” ทับกัน`);
    else if (c.min > p.max + 1) out.push(`ขนาด ${fmt(p.max + 1)} ถึง ${fmt(c.min - 1)} ไม่มีช่วงไหนรับ`);
  });
  const last = sorted[sorted.length - 1];
  if (last && last.max !== null) {
    out.push(`ขนาดที่ใหญ่กว่า ${fmt(last.max)} ยังไม่มีราคา — ช่วงสุดท้ายควรเว้นช่อง “ถึง” ไว้`);
  }
  return [...new Set(out)];
}

/* ── ส่วนต่าง ───────────────────────────────────────────────────────────────
   สรุปเป็นแถว "เดิม → ใหม่" แบบเดียวกับที่จอตรวจสมุดราคาใช้ · `struct` = เพิ่ม/ลบแถว
   ซึ่งต้องแยกให้เห็น เพราะการลบกฎทิ้งกับการขยับตัวเลขคนละน้ำหนักกันมาก */

interface DiffRow { what: string; was: string; now: string; struct?: boolean; warn?: boolean }

function priceOf(a: EditorAdder): string {
  if (a.kind === 'percent') return a.percent === null ? '' : `${a.percent}%`;
  if (a.kind === 'flat') return a.amount === null ? '' : `${fmt(a.amount)} บาท`;
  return a.rate === null ? '' : `${fmt(a.rate)} บาท / ${a.step && a.step !== 1 ? `${a.step} ` : ''}${a.unit}`;
}

function buildDiff(orig: EditorView, w: Working): DiffRow[] {
  const rows: DiffRow[] = [];

  // ช่วงขนาด
  if (orig.base.kind === 'banded') {
    const before = new Map(orig.base.bands.map((b, i) => [`b${i + 1}`, b]));
    const seen = new Set<string>();
    for (const b of w.bands) {
      const o = before.get(b.uid);
      if (!o) {
        rows.push({ what: `ช่วงขนาด ${rangeText(b)}`, was: 'ไม่มี', now: 'เพิ่มใหม่', struct: true });
        continue;
      }
      seen.add(b.uid);
      if (o.min !== b.min || o.max !== b.max) {
        rows.push({ what: 'หัวท้ายช่วงขนาด', was: `${o.min} - ${o.max ?? 'ขึ้นไป'}`, now: rangeText(b) });
      }
      if (o.price !== b.price) {
        rows.push({
          what: `ราคาตั้ง ช่วง ${rangeText(b)}`,
          was: o.price === null ? 'ไม่รับผลิต' : fmt(o.price),
          now: b.price === null ? 'ไม่รับผลิต' : fmt(b.price),
          warn: b.price === null,
        });
      }
      if (o.kind !== b.kind) {
        const th = (k: string) => (k === 'rate' ? 'คิดต่อหน่วย' : 'เหมาทั้งช่วง');
        rows.push({ what: `วิธีคิดราคา ช่วง ${rangeText(b)}`, was: th(o.kind), now: th(b.kind) });
      }
    }
    for (const [k, o] of before) {
      if (!seen.has(k)) {
        rows.push({
          what: `ช่วงขนาด ${o.min} - ${o.max ?? 'ขึ้นไป'}`, was: 'มีอยู่', now: 'ลบออก', struct: true, warn: true,
        });
      }
    }
  }

  // ตัวเลือกท้ายรหัส
  if (orig.variant) {
    const v = orig.variant;
    const onBefore = !v.disabled;
    if (onBefore !== w.variantOn) {
      rows.push({
        what: `${v.label} — เปิดใช้กับ ${orig.code}`, was: onBefore ? 'เปิดใช้' : 'ปิดไว้',
        now: w.variantOn ? 'เปิดใช้' : 'ปิดไว้', warn: !w.variantOn,
      });
    }
    const pctNow = toNum(w.variantPercent) ?? 0;
    if ((v.percent ?? 0) !== pctNow) {
      rows.push({ what: `${v.label} — บวกเพิ่มจากราคาตั้ง`, was: `${v.percent ?? 0}%`, now: `${pctNow}%` });
    }
    const beforePrices = v.adderPrices ?? {};
    const ids = new Set([...Object.keys(beforePrices), ...Object.keys(w.variantPrices)]);
    for (const id of ids) {
      const name = orig.adders.find((a) => a.id === id)?.label ?? id;
      const o = beforePrices[id];
      const n = w.variantPrices[id] === undefined ? undefined : toNum(w.variantPrices[id]!) ?? undefined;
      if (o === n) continue;
      if (o === undefined) rows.push({ what: `${v.label} — ${name}`, was: 'คิดเท่ารุ่นปกติ', now: `${fmt(n!)}`, struct: true });
      else if (n === undefined) rows.push({ what: `${v.label} — ${name}`, was: fmt(o), now: 'กลับไปคิดเท่ารุ่นปกติ', struct: true });
      else rows.push({ what: `${v.label} — ${name}`, was: fmt(o), now: fmt(n) });
    }
  }

  // กฎบวกเพิ่ม
  const oldAdders = new Map(orig.adders.map((a) => [a.id, a]));
  const keep = new Set<string>();
  for (const a of w.adders) {
    const o = oldAdders.get(a.uid);
    if (!o) {
      rows.push({ what: `กฎบวกเพิ่ม “${a.label}”`, was: 'ไม่มี', now: 'เพิ่มใหม่', struct: true });
      continue;
    }
    keep.add(a.uid);
    if (o.disabled !== a.disabled) {
      rows.push({
        what: `กฎ ${a.label}`, was: o.disabled ? 'ปิดไว้' : 'เปิดใช้',
        now: a.disabled ? 'ปิดไว้' : 'เปิดใช้', warn: a.disabled,
      });
    }
    if (o.label !== a.label) rows.push({ what: 'ชื่อรายการ', was: o.label, now: a.label });
    if (o.whenTh !== a.whenTh) rows.push({ what: `กฎ ${a.label} — คิดเมื่อไหร่`, was: o.whenTh, now: a.whenTh });
    if (o.kind !== a.kind) rows.push({ what: `กฎ ${a.label} — วิธีคิด`, was: o.kindTh, now: a.kindTh });
    else if (priceOf(o) !== priceOf(a)) {
      rows.push({ what: `กฎ ${a.label} — ราคา`, was: priceOf(o) || 'ไม่มีราคา', now: priceOf(a) || 'ไม่มีราคา' });
    }
    if (o.rates && a.rates) {
      for (const r of a.rates) {
        const b = o.rates.find((x) => x.value === r.value);
        if (b && b.rate !== r.rate) {
          rows.push({
            what: `กฎ ${a.label} — ${a.byAxisTh ?? ''} ${r.value || '(ว่าง)'}`.replace(/\s+/g, ' '),
            was: b.rate === null ? 'ไม่มีราคา' : fmt(b.rate),
            now: r.rate === null ? 'ไม่มีราคา — ขนาดนี้ต้องขอราคา' : fmt(r.rate),
            warn: r.rate === null,
          });
        }
      }
    }
  }
  for (const [id, o] of oldAdders) {
    if (!keep.has(id)) rows.push({ what: `กฎ ${o.label}`, was: priceOf(o) || 'มีอยู่', now: 'ลบออก', struct: true, warn: true });
  }

  // ข้อจำกัด
  for (const c of orig.constraints) {
    const offNow = w.constraintsOff.has(c.id);
    if (c.disabled !== offNow) {
      rows.push({
        what: `ข้อจำกัด: ${c.message}`, was: c.disabled ? 'ปิดไว้' : 'เปิดใช้',
        now: offNow ? 'ปิดไว้' : 'เปิดใช้', warn: offNow,
      });
    }
  }

  return rows;
}

/* ── หน้าจอ ─────────────────────────────────────────────────────────────── */

export const ModelPriceEditor: React.FC<{
  code: string;
  authHeaders: Record<string, string>;
  onBack: (saved: boolean) => void;
}> = ({ code, authHeaders, onBack }) => {
  const jsonHeaders = useMemo(
    () => ({ ...authHeaders, 'Content-Type': 'application/json' }),
    [authHeaders],
  );

  const [orig, setOrig] = useState<EditorView | null>(null);
  const [fingerprint, setFingerprint] = useState('');
  const [w, setW] = useState<Working | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [editing, setEditing] = useState<{ adder: WAdder | null } | null>(null);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const savedOnce = useRef(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`/api/admin/pricebook/model/${encodeURIComponent(code)}`, { headers: authHeaders });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'โหลดราคาของรุ่นนี้ไม่สำเร็จ');
      setOrig(body.model);
      setFingerprint(body.fingerprint);
      setW(toWorking(body.model));
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  }, [authHeaders, code]);

  // โหลดครั้งแรก — หุ้ม setTimeout ตามท่าของทั้งแอป (eslint ปฏิเสธ setState ตรง ๆ ใน useEffect)
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const diff = useMemo(() => (orig && w ? buildDiff(orig, w) : []), [orig, w]);
  const problems = useMemo(() => (w ? bandProblems(w.bands) : []), [w]);
  const dirty = diff.length > 0;

  const patch = (fn: (draft: Working) => void) => {
    setW((prev) => {
      if (!prev) return prev;
      const next: Working = {
        ...prev,
        bands: [...prev.bands],
        adders: [...prev.adders],
        variantPrices: { ...prev.variantPrices },
        constraintsOff: new Set(prev.constraintsOff),
      };
      fn(next);
      return next;
    });
  };

  const save = async () => {
    if (!orig || !w) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/pricebook/model/${encodeURIComponent(orig.code)}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({
          fingerprint,
          note,
          bands: orig.base.kind === 'banded'
            ? w.bands.map((b) => ({ min: b.min, max: b.max, kind: b.kind, price: b.price, label: '' }))
            : undefined,
          adders: w.adders.map((a) => ({
            id: a.id, label: a.label, order: a.order, kind: a.kind, when: a.when ?? { always: true },
            amount: a.amount, percent: a.percent, rate: a.rate, dim: a.dim, over: a.over,
            step: a.step, times: a.times, unit: a.unit, rates: a.rates, disabled: a.disabled, note: a.note,
          })),
          variant: orig.variant
            ? {
                suffix: orig.variant.suffix,
                label: orig.variant.label,
                percent: toNum(w.variantPercent) ?? 0,
                disabled: !w.variantOn,
                adderPrices: Object.fromEntries(
                  Object.entries(w.variantPrices)
                    .map(([k, v]) => [k, toNum(v)])
                    .filter(([, v]) => v !== null),
                ),
              }
            : undefined,
          constraintsOff: [...w.constraintsOff],
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'บันทึกไม่สำเร็จ');
      setOrig(body.model);
      setFingerprint(body.fingerprint);
      setW(toWorking(body.model));
      setNote('');
      savedOnce.current = true;
      setSaved(true);
    } catch (e: unknown) {
      setError(errMsg(e));
      setReview(false);
    } finally {
      setBusy(false);
    }
  };

  if (error && !orig) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!orig || !w) return <div className="text-sm text-slate-400 px-1 py-8">กำลังโหลดราคาของรุ่น {code} …</div>;

  const v = orig.variant;
  const keeps = v ? w.adders.filter((a) => w.variantPrices[a.id] === undefined) : [];

  return (
    <div className="space-y-3.5">
      {/* ── หัวเรื่อง ─────────────────────────────────────────────────── */}
      {/* จอแคบ: ปุ่มสองตัวท้ายแถวต้องตกลงบรรทัดใหม่ ไม่ใช่บีบชื่อรุ่นจนเหลือตัวอักษรละบรรทัด
          (`min-w-0 flex-1` อย่างเดียวยอมให้หดจนเหลือศูนย์ — ต้องมีพื้นขั้นต่ำด้วย) */}
      <div className="flex items-start gap-2.5 flex-wrap">
        <Button icon={ChevronLeft} onClick={() => onBack(savedOnce.current)}>กลับ</Button>
        <div className="min-w-[180px] flex-1">
          <h1 className="text-lg font-bold text-slate-900 truncate">
            แก้ราคา {orig.name ?? orig.code} — {orig.label}
          </h1>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {orig.standardTh && <>รวมในราคาตั้งแล้ว: {orig.standardTh} · </>}
            {orig.sheet && <>ที่มา: ชีต {orig.sheet}</>}
            {orig.aliases.length > 0 && <> · ใช้กับรหัส {orig.aliases.join(', ')} ด้วย</>}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button icon={Undo2} disabled={!dirty} onClick={() => setW(toWorking(orig))}>ย้อนการแก้</Button>
          <Button variant="primary" icon={BookOpen} disabled={!dirty} onClick={() => setReview(true)}>
            ตรวจก่อนบันทึก
          </Button>
        </div>
      </div>

      {error && <ErrorBox message={error} />}

      {/* ── ราคาตั้ง ──────────────────────────────────────────────────── */}
      {orig.base.kind === 'banded' && (
        <TableCard
          title="ราคาตั้ง"
          hint={`คิดตาม${orig.base.quantityTh} (ระบบคำนวณให้จากขนาดที่ลูกค้าสั่ง) · ช่องว่างในคอลัมน์ราคา = ไม่รับผลิตขนาดนั้น ไม่ใช่ราคา 0`}
        >
          <div className="px-4 py-3">
            <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[380px]">
              <thead>
                <tr className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
                  <th className="text-left py-1.5">Size ({orig.base.unit})</th>
                  <th className="text-right py-1.5">Price (บาท)</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {w.bands.map((b, i) => (
                  <tr key={b.uid} className="border-t border-slate-100">
                    <td className="py-1 pr-2">
                      <span className="inline-flex items-center gap-1">
                        <Cell
                          label={`ช่วงที่ ${i + 1} ตั้งแต่`} width="w-16" align="center"
                          value={b.min === null ? '' : String(b.min)}
                          was={String(orig.base.kind === 'banded' ? (orig.base.bands.find((_, j) => `b${j + 1}` === b.uid)?.min ?? '') : '')}
                          onChange={(val) => patch((d) => { d.bands[i] = { ...b, min: toNum(val) ?? 0 }; })}
                        />
                        <span className="text-slate-300 text-xs">–</span>
                        <Cell
                          label={`ช่วงที่ ${i + 1} ถึง`} width="w-16" align="center" placeholder="ขึ้นไป"
                          value={b.max === null ? '' : String(b.max)}
                          was={String(orig.base.kind === 'banded' ? (orig.base.bands.find((_, j) => `b${j + 1}` === b.uid)?.max ?? '') : '')}
                          onChange={(val) => patch((d) => { d.bands[i] = { ...b, max: toNum(val) }; })}
                        />
                      </span>
                    </td>
                    <td className="py-1 text-right whitespace-nowrap">
                      <Cell
                        label={`ราคาช่วง ${rangeText(b)}`} width="w-24"
                        value={b.price === null ? '' : String(b.price)}
                        was={String(orig.base.kind === 'banded' ? (orig.base.bands.find((_, j) => `b${j + 1}` === b.uid)?.price ?? '') : '')}
                        onChange={(val) => patch((d) => { d.bands[i] = { ...b, price: toNum(val) }; })}
                      />
                      <select
                        aria-label={`วิธีคิดราคา ช่วง ${rangeText(b)}`}
                        value={b.kind}
                        onChange={(e) => patch((d) => { d.bands[i] = { ...b, kind: e.target.value as 'flat' | 'rate' }; })}
                        className="ml-1.5 rounded-lg border border-slate-200 bg-card px-1.5 py-1 text-[10.5px] text-slate-500"
                      >
                        <option value="flat">บาท เหมาทั้งช่วง</option>
                        <option value="rate">บาท / {orig.base.kind === 'banded' ? orig.base.unit : ''}</option>
                      </select>
                    </td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        aria-label={`ลบช่วง ${rangeText(b)}`}
                        title={`ลบช่วง ${rangeText(b)}`}
                        onClick={() => {
                          if (!confirm(`ลบช่วง ${rangeText(b)} ออกจากตารางราคาตั้ง?\n\nขนาดที่เคยตกในช่วงนี้จะไม่มีราคา จนกว่าจะมีช่วงอื่นมารับ`)) return;
                          patch((d) => { d.bands.splice(i, 1); });
                        }}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            <div className="mt-2.5">
              <Button
                icon={Plus}
                size="sm"
                onClick={() => patch((d) => {
                  const last = d.bands[d.bands.length - 1];
                  d.bands.push({
                    uid: uid('n'),
                    min: last && last.max !== null ? last.max + 1 : 0,
                    max: null, kind: 'flat', price: null, label: '',
                  });
                })}
              >
                เพิ่มช่วงขนาด
              </Button>
            </div>

            {problems.length > 0 ? (
              <div className="mt-2.5 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
                <span><b>ช่วงขนาดยังไม่ครบ</b> — {problems.join(' · ')}</span>
              </div>
            ) : (
              <p className="mt-2.5 text-[11px] text-slate-400">ช่วงขนาดต่อกันครบ ไม่มีขนาดไหนตกหล่น</p>
            )}
          </div>
        </TableCard>
      )}

      {orig.base.kind !== 'banded' && (
        <TableCard title="ราคาตั้ง">
          <div className="px-4 py-3 text-[13px] text-slate-500">
            {orig.base.kind === 'ref'
              ? <>รุ่นนี้ใช้ตารางราคาของรุ่น <b className="text-slate-800">{orig.base.model}</b> แล้วบวกเพิ่มตามรายการข้างล่าง</>
              : orig.base.note}
          </div>
        </TableCard>
      )}

      {/* ── ตัวเลือกท้ายรหัส ───────────────────────────────────────────── */}
      {v && (
        <TableCard
          title={v.label}
          hint={`ครอบรหัส ${v.covers.join(' · ')}${v.source ? ` · ที่มา: ${v.source}` : ''}`}
        >
          <div className="px-4 py-3 space-y-2.5">
            <div className="flex items-center gap-3 flex-wrap rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Sw checked={w.variantOn} label={`เปิดใช้ ${v.label} กับ ${orig.name ?? orig.code}`}
                  onChange={(on) => patch((d) => { d.variantOn = on; })} />
              <span className="text-[12.5px] font-bold text-slate-800">เปิดใช้ {v.label} กับ {orig.name ?? orig.code}</span>
              <span className="h-5 w-px bg-slate-200" />
              <span className="text-xs text-slate-500">ราคาตั้ง บวกเพิ่มจากราคาปกติ</span>
              <Cell label={`${v.label} บวกเพิ่มจากราคาตั้ง`} width="w-20"
                    value={w.variantPercent} was={String(v.percent ?? 0)}
                    onChange={(val) => patch((d) => { d.variantPercent = val; })} />
              <span className="text-[10.5px] text-slate-400">%</span>
              {(toNum(w.variantPercent) ?? 0) === 0 && (
                <span className="text-[11.5px] font-bold text-amber-700">= ไม่บวกเพิ่ม</span>
              )}
            </div>

            <div className={w.variantOn ? '' : 'opacity-45'}>
              {v.confirmed === false && (
                <div className="mb-2 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
                  <span>
                    ตัวเลขชุดนี้<b>ยังไม่ได้ยืนยันกับฝ่ายขาย</b> — ไฟล์ราคาไม่ได้เขียนไว้ว่า{' '}
                    {orig.code}{v.suffix} คิดเพิ่มเท่าไหร่ · ไม่บวกเพิ่มให้ใส่ <b>0</b> ในช่อง %
                    และลบรายการที่คิดเท่ารุ่นปกติออก
                  </span>
                </div>
              )}

              <p className="text-xs text-slate-500 mb-1.5">
                ราคาของแถมที่<b className="text-slate-800">ต่างจากรุ่นปกติ</b> — กดถังขยะ = กลับไปคิดเท่ารุ่นปกติ
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                {Object.keys(w.variantPrices).length === 0 && (
                  <span className="text-[11.5px] text-slate-400">ยังไม่มีรายการไหนคิดต่างจากรุ่นปกติ</span>
                )}
                {w.adders.filter((a) => w.variantPrices[a.id] !== undefined).map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-xs text-slate-600 min-w-0">
                    <span className="flex-1 truncate">{a.label}</span>
                    <span className="text-[11px] text-slate-400 whitespace-nowrap">
                      {fmt(a.amount ?? a.rate)}{a.unit ? ` /${a.unit}` : ''} &rarr;
                    </span>
                    <Cell label={`${v.label} — ราคา ${a.label}`} width="w-[74px]"
                          value={w.variantPrices[a.id] ?? ''}
                          was={String(v.adderPrices?.[a.id] ?? '')}
                          onChange={(val) => patch((d) => { d.variantPrices[a.id] = val; })} />
                    <button
                      type="button"
                      aria-label={`ลบ ${a.label} ออก — กลับไปคิดเท่ารุ่นปกติ`}
                      title={`ลบ ${a.label} ออก — กลับไปคิดเท่ารุ่นปกติ`}
                      onClick={() => patch((d) => { delete d.variantPrices[a.id]; })}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11px] text-slate-400">
                <span className="text-slate-500">คิดเท่ารุ่นปกติอยู่แล้ว — กดเพื่อตั้งราคาต่าง:</span>
                {keeps.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => patch((d) => { d.variantPrices[a.id] = String((a.amount ?? a.rate ?? 0) * 2); })}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-[var(--brand-border)] hover:text-[var(--brand-fg)]"
                  >
                    <Plus className="h-3 w-3" />{a.label}
                    {(a.amount ?? a.rate) !== null && (
                      <span className="font-normal text-slate-400">{fmt(a.amount ?? a.rate)}{a.unit ? ` /${a.unit}` : ''}</span>
                    )}
                  </button>
                ))}
                {keeps.length === 0 && <span>(ทุกรายการถูกตั้งราคาต่างไว้หมดแล้ว)</span>}
              </div>
            </div>
          </div>
        </TableCard>
      )}

      {/* ── กฎบวกเพิ่ม ─────────────────────────────────────────────────── */}
      <TableCard
        title="สิ่งที่ต้องบวกเพิ่ม"
        hint="แก้ตัวเลขได้ทุกช่อง · ปิดสวิตช์ = พักกฎไว้โดยไม่ลบ (ย้อนได้ ประวัติยังอยู่) · ปุ่มดินสอ = เปลี่ยนชื่อ/เงื่อนไข/วิธีคิด · ถังขยะ = ลบทิ้ง"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[720px]">
            <thead>
              <tr className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="text-left px-4 py-2 w-14">เปิดใช้</th>
                <th className="text-left px-2 py-2">รายการ</th>
                <th className="text-left px-2 py-2 w-[22%]">คิดเมื่อไหร่</th>
                <th className="text-left px-2 py-2 w-[14%]">วิธีคิด</th>
                <th className="text-right px-2 py-2 w-[22%]">ราคา</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {w.adders.map((a, i) => (
                <React.Fragment key={a.uid}>
                <tr className={`${a.rates ? '' : 'border-b border-slate-50'} ${a.disabled ? 'opacity-55' : ''}`}>
                  <td className="px-4 py-2">
                    <Sw checked={!a.disabled} label={`เปิดใช้กฎ ${a.label}`}
                        onChange={(on) => patch((d) => { d.adders[i] = { ...a, disabled: !on }; })} />
                  </td>
                  <td className="px-2 py-2 font-bold text-slate-800">
                    {a.label}
                    {a.custom && (
                      <span className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold"
                            style={{ background: 'var(--brand-soft)', color: 'var(--brand-fg)' }}>
                        เพิ่มเอง
                      </span>
                    )}
                    {a.note && <small className="block font-medium text-[10.5px] text-slate-400 mt-0.5">{a.note}</small>}
                  </td>
                  <td className="px-2 py-2 text-[10.5px] text-slate-500">{a.whenTh}</td>
                  <td className="px-2 py-2 text-[10.5px] text-slate-500">
                    {a.kindTh}{a.times ? ` ×${a.times}` : ''}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {a.rates ? (
                      // ราคาแยกตามค่าแกนวาดเป็นแถวย่อยเต็มความกว้างข้างล่าง — ช่องนี้บอกแค่ว่า "ดูข้างล่าง"
                      // (เดิมอัดช่องกรอก 36 ช่องไว้ในคอลัมน์นี้ แถวเดียวสูงเกินจอและไม่มีป้ายบอกว่าเลขคืออะไร)
                      <span className="text-[11px] text-slate-500">
                        แยกตาม{a.byAxisTh ?? 'ค่าแกน'} {a.rates.length} ค่า ↓
                      </span>                    ) : (
                      <>
                        <Cell
                          label={`ราคาของกฎ ${a.label}`} width="w-24"
                          value={String((a.kind === 'percent' ? a.percent : a.kind === 'flat' ? a.amount : a.rate) ?? '')}
                          was={String((() => {
                            const o = orig.adders.find((x) => x.id === a.id);
                            if (!o) return '';
                            return (o.kind === 'percent' ? o.percent : o.kind === 'flat' ? o.amount : o.rate) ?? '';
                          })())}
                          onChange={(val) => patch((d) => {
                            const n = toNum(val);
                            d.adders[i] = a.kind === 'percent' ? { ...a, percent: n }
                              : a.kind === 'flat' ? { ...a, amount: n } : { ...a, rate: n };
                          })}
                        />
                        <span className="ml-1 text-[10.5px] text-slate-400">
                          {a.kind === 'percent' ? '%' : a.kind === 'flat' ? 'บาท'
                            : `บาท / ${a.step && a.step !== 1 ? `${a.step} ` : ''}${a.unit}`}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <button
                      type="button" aria-label={`แก้กฎ ${a.label}`} title={`แก้ชื่อ / เงื่อนไข / วิธีคิดของ ${a.label}`}
                      onClick={() => setEditing({ adder: a })}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[var(--brand-fg)]"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button" aria-label={`ลบกฎ ${a.label}`} title={`ลบกฎ ${a.label}`}
                      onClick={() => {
                        if (!confirm(`ลบกฎ “${a.label}” ออกจาก ${orig.name ?? orig.code}?\n\nถ้าแค่อยากหยุดใช้ชั่วคราว ให้ปิดสวิตช์แทน — ปิดแล้วย้อนกลับได้ และยังเห็นว่าเมื่อก่อนคิดเท่าไหร่`)) return;
                        patch((d) => { d.adders.splice(i, 1); delete d.variantPrices[a.id]; });
                      }}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
                {a.rates && (
                  <tr className={`border-b border-slate-50 ${a.disabled ? 'opacity-55' : ''}`}>
                    <td />
                    <td colSpan={5} className="px-2 pb-3">
                      <RatesGrid a={a} orig={orig.adders.find((x) => x.id === a.id)}
                                 onChange={(value, rate) => patch((d) => {
                                   d.adders[i] = {
                                     ...a,
                                     rates: (a.rates ?? []).map((r) => (r.value === value ? { ...r, rate } : r)),
                                   };
                                 })} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
          <Button icon={Plus} size="sm" onClick={() => setEditing({ adder: null })}>เพิ่มกฎใหม่</Button>
          <span className="text-[11px] text-slate-400">
            กฎที่เพิ่มเองจะติดป้าย “เพิ่มเอง” ไว้ เพื่อให้รู้ว่าไม่ได้มาจากไฟล์ราคา
          </span>
        </div>
      </TableCard>

      {/* ── ข้อจำกัด (เปิด/ปิดได้อย่างเดียว) ───────────────────────────── */}
      {orig.constraints.length > 0 && (
        <TableCard
          title="หมายเหตุ / ข้อจำกัด"
          hint="ระบบใช้กันเสนอราคาของที่ผลิตไม่ได้ — เป็นด่านความปลอดภัย จึงยังแก้ข้อความ/เงื่อนไขจากจอนี้ไม่ได้ ปิดสวิตช์ได้ถ้าเลิกใช้ข้อนั้น"
        >
          <div className="px-4 py-2">
            {orig.constraints.map((c) => (
              <div key={c.id} className="flex items-start gap-3 py-1.5 border-b border-slate-50 last:border-0">
                <Sw checked={!w.constraintsOff.has(c.id)} label={`เปิดใช้ข้อจำกัด: ${c.message}`}
                    onChange={(on) => patch((d) => {
                      if (on) d.constraintsOff.delete(c.id); else d.constraintsOff.add(c.id);
                    })} />
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-600">{c.levelTh}</span>
                <span className="text-[12.5px] text-slate-800 min-w-0">
                  {c.message}
                  <small className="block text-[10.5px] text-slate-400">เมื่อ {c.whenTh}</small>
                </span>
              </div>
            ))}
          </div>
        </TableCard>
      )}

      {/* ── สูตรที่ระบบคิดเอง (อ่านอย่างเดียว) ─────────────────────────── */}
      {orig.derived.length > 0 && (
        <TableCard
          title="ค่าที่ระบบคิดให้เอง"
          hint="อ่านอย่างเดียว — สูตรพวกนี้พังแล้วทั้งรุ่นคิดราคาไม่ออก จึงไม่เปิดให้แก้จากจอ"
        >
          <div className="px-4 py-3 space-y-1.5">
            {orig.derived.map((d) => (
              <div key={d.name} className="flex gap-2 text-[12.5px] text-slate-600">
                <Calculator className="h-4 w-4 shrink-0 mt-px text-slate-400" />
                <span><b className="text-slate-800">{d.label}</b> — คิดจาก {d.argsTh}
                  {d.consts && <span className="text-slate-400"> (ค่าคงที่ {d.consts})</span>}
                </span>
              </div>
            ))}
          </div>
        </TableCard>
      )}

      {editing && (
        <RuleEditModal
          adder={editing.adder}
          vocab={orig.vocab}
          existingIds={w.adders.map((a) => a.id)}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            patch((d) => {
              const i = d.adders.findIndex((x) => x.uid === next.uid);
              if (i >= 0) d.adders[i] = next; else d.adders.push(next);
              d.adders.sort((x, y) => x.order - y.order);
            });
            setEditing(null);
          }}
        />
      )}

      {review && (
        <ReviewModal
          code={orig.code}
          rows={diff}
          problems={problems}
          note={note}
          saved={saved}
          busy={busy}
          onNote={setNote}
          onBack={() => setReview(false)}
          onSave={() => void save()}
          onDone={() => { setReview(false); setSaved(false); }}
        />
      )}
    </div>
  );
};

/* ── กล่องตรวจก่อนบันทึก ───────────────────────────────────────────────── */

const ReviewModal: React.FC<{
  code: string;
  rows: DiffRow[];
  problems: string[];
  note: string;
  saved: boolean;
  busy: boolean;
  onNote: (v: string) => void;
  onBack: () => void;
  onSave: () => void;
  onDone: () => void;
}> = ({ code, rows, problems, note, saved, busy, onNote, onBack, onSave, onDone }) => {
  const warns = rows.filter((r) => r.warn).length;
  const structs = rows.filter((r) => r.struct).length;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[min(90vh,560px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-card">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <BookOpen className="h-5 w-5" style={{ color: 'var(--brand-fg)' }} />
          <h3 className="flex-1 text-sm font-bold text-slate-900">
            {saved ? 'บันทึกแล้ว' : `ตรวจก่อนบันทึก — ${code}`}
          </h3>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3">
          {saved ? (
            <div className="rounded-xl border px-3 py-2 text-[12.5px]"
                 style={{ borderColor: 'var(--brand-border)', background: 'var(--brand-soft)', color: 'var(--brand-fg)' }}>
              <b>บันทึกราคาใหม่ของ {code} แล้ว</b> — มีผลกับการคิดราคาทันที ·
              เล่มก่อนหน้าถูกเก็บไว้ กด “ย้อนไปเล่มก่อนหน้า” บนหน้าคิดราคาสินค้าได้ทุกเมื่อ
            </div>
          ) : (
            <>
              {problems.length > 0 && (
                <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
                  <span><b>ช่วงขนาดยังไม่ครบ</b> — {problems.join(' · ')} · บันทึกได้ แต่ขนาดที่ตกช่องโหว่จะคิดราคาไม่ออก</span>
                </div>
              )}
              {warns > 0 && (
                <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
                  <span><b>{warns} รายการถูกลบหรือปิดไว้</b> — ช่องราคาที่ลบเลขออก = เลิกรับผลิตขนาดนั้น ถ้าตั้งใจให้ฟรีต้องใส่เลข 0 ไม่ใช่ลบทิ้ง</span>
                </div>
              )}
              {structs > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] text-slate-600">
                  มีการแก้<b>โครง {structs} รายการ</b> (เพิ่ม/ลบช่วงหรือกฎ) — แถวที่ติดป้าย “โครง” ข้างล่างคือรายการพวกนั้น
                </div>
              )}
              <div className="min-h-[96px] flex-1 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
                      <th className="sticky top-0 bg-slate-50 px-3 py-1.5 text-left">ที่แก้</th>
                      <th className="sticky top-0 bg-slate-50 px-3 py-1.5 text-left">เดิม</th>
                      <th className="sticky top-0 bg-slate-50 px-3 py-1.5 text-left">ใหม่</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 text-slate-700">
                          {r.struct && (
                            <span className="mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold"
                                  style={{ background: 'var(--brand-soft)', color: 'var(--brand-fg)' }}>โครง</span>
                          )}
                          {r.what}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-slate-400 line-through">{r.was || '—'}</td>
                        <td className={`whitespace-nowrap px-3 py-1.5 font-bold ${r.warn ? 'text-amber-700' : 'text-slate-900'}`}>
                          {r.now || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <input
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                value={note}
                onChange={(e) => onNote(e.target.value)}
                placeholder="แก้อะไรไป เช่น ปรับตามต้นทุนใหม่ (ไม่บังคับ — โชว์ในการ์ดสมุดราคา)"
              />
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          {saved ? (
            <Button variant="primary" onClick={onDone}>ปิด</Button>
          ) : (
            <>
              <span className="mr-auto text-[11px] text-slate-500">
                มีผลกับการคิดราคาทันที · เล่มก่อนหน้าเก็บให้ 3 เล่ม ย้อนได้
              </span>
              <Button onClick={onBack}>กลับไปแก้ต่อ</Button>
              <Button variant="primary" icon={BookOpen} busy={busy} onClick={onSave}>บันทึกราคาใหม่</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export type { WAdder };
