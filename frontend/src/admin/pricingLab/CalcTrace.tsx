import React, { useState } from 'react';
import { AlertTriangle, Check, ChevronRight, ChevronsUpDown, Minus } from 'lucide-react';
import { TableCard } from '../logs/ui';
import { Button } from '../Button';
import { type PriceOutcome, type PriceTrace } from './types';

/**
 * การ์ด "วิธีคำนวณราคา" ของหน้าคำนวณราคา — แบบ "ใบเสร็จ + แถบข้าง" (เจ้าของเลือกแบบ A จาก mockup 2026-10-07)
 *
 * ที่มา: เจ้าของขอ 2026-09-28 "แสดงวิธีการคำนวณอย่างละเอียดว่ามาจากส่วนไหนบ้าง จะได้ตรวจสอบได้ว่า logic ถูกไหม"
 * แล้ว 2026-10-07 บอกว่ารุ่นแรก "ดูเยอะและรก อ่านเข้าใจยาก" — กฎทุกข้อได้แถวเต็มเท่ากันทั้งที่รหัสจริงมีกฎ
 * มัธยฐาน 7 ข้อแต่คิดเงินจริงไม่เกิน 2 ข้อใน 94% ของรหัส ⇒ รุ่นนี้:
 *   · เงินแต่ละก้อนเหลือบรรทัดเดียว (ชื่อ · ประโยคสั้น · จำนวนเงิน) ขั้นตอนเต็ม + ตำแหน่งช่องในชีต **พับไว้** กดดูได้
 *   · กฎที่ไม่ได้คิด **ยังอยู่** (ข้อที่ถูกข้ามคือที่ที่ราคาผิดได้เงียบที่สุด) แต่รวมเป็นชิปบรรทัดเดียวตามกลุ่ม
 *   · ข้อห้ามที่ติดโชว์เต็ม ที่เหลือพับเป็นบรรทัดเดียว แยก "ผ่าน" ออกจาก "ไม่เกี่ยวกับใบนี้"
 *   · ที่มาในชีตโชว์แค่ตำแหน่งช่อง (`cells`) ไม่ใช่ย่อหน้าเหตุผล (เจ้าของเลือก)
 *
 * **ไฟล์นี้ไม่คิดและไม่แต่งประโยคเลย แค่จัดวาง** — ทุกประโยคมาจาก `outcome.trace` ที่เซิร์ฟเวอร์เขียนในจุดเดียวกับที่คิดเงิน
 * (`computePrice` ใน services/pricingLab/engine.ts) ถ้าหน้าจอแต่งคำอธิบายเอง วันหนึ่งคำอธิบายกับตัวเลขจะไม่ตรงกัน
 * แล้วคนตรวจจะเชื่อคำอธิบาย · ยอดรวมท้ายใบคือ `outcome.unitPrice` ไม่ได้บวกใหม่บนจอ
 * สถานะมีคำกำกับทุกจุด ไม่ใช่สีอย่างเดียว (WCAG 1.4.1)
 */

type Rule = PriceTrace['rules'][number];
type Input = PriceTrace['inputs'][number];
type TraceCheck = PriceTrace['checks'][number];

const n = (v: number) => v.toLocaleString();

interface Row {
  key: string;
  kind: 'base' | 'add' | 'wait' | 'block';
  label: string;
  why: string;
  amount?: number;
  steps: string[];
  cells?: string[];
}

/** ป้ายที่มาของค่า — ไม่มีป้าย = อ่านจากรหัส · ชี้ป้ายเห็นประโยคเต็มจากเซิร์ฟเวอร์ (`from`) */
const ORIGIN: Partial<Record<Input['origin'], { text: string; cls: string }>> = {
  default: { text: 'ค่าตั้งต้น', cls: 'bg-sky-50 border-sky-200 text-sky-700' },
  calc: { text: 'คำนวณ', cls: 'bg-violet-50 border-violet-200 text-violet-700' },
  sub: { text: 'รหัสย่อย', cls: 'bg-slate-100 border-slate-300 text-slate-600' },
  offCode: { text: 'กรอกนอกรหัส', cls: 'bg-slate-100 border-slate-300 text-slate-600' },
};

const TAG = 'inline-flex items-center whitespace-nowrap px-1.5 py-0.5 rounded-md border text-[10.5px] font-semibold leading-none';
const CHIP = 'inline-block px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[11.5px] whitespace-nowrap';
const CAP = 'text-[11px] font-semibold text-slate-400 mb-1.5';

function rowsOf(o: PriceOutcome, t: PriceTrace): Row[] {
  const baseKind: Row['kind'] = t.base.ok ? 'base' : o.status === 'notManufacturable' && !t.rules.length ? 'block' : 'wait';
  const rows: Row[] = [
    { key: 'base', kind: baseKind, label: t.base.label, why: t.base.why, amount: t.base.amount, steps: t.base.steps },
  ];
  t.rules.forEach((r, i) => {
    const kind = r.status === 'applied' ? 'add' : r.status === 'waiting' ? 'wait' : r.status === 'blocked' ? 'block' : null;
    if (!kind) return;
    rows.push({ key: `${r.id}-${i}`, kind, label: r.label, why: (kind === 'add' ? r.why : r.reason) ?? '', amount: r.amount, steps: r.steps, cells: r.cells });
  });
  return rows;
}

const ReceiptRow: React.FC<{ row: Row; open: boolean; onToggle: () => void }> = ({ row, open, onToggle }) => {
  const hasDetail = row.steps.length > 0 || !!row.cells?.length;
  const tone =
    row.kind === 'wait' ? 'bg-amber-50 rounded-lg px-2 -mx-2 text-amber-800'
      : row.kind === 'block' ? 'bg-red-50 rounded-lg px-2 -mx-2 text-red-700'
        : 'border-b border-dashed border-slate-200';
  const ink = row.kind === 'wait' ? 'text-amber-800' : row.kind === 'block' ? 'text-red-700' : 'text-slate-800';
  const amount = row.amount !== undefined ? `${row.kind === 'add' ? '+' : ''}${n(row.amount)}` : row.kind === 'wait' ? 'ยังไม่รวม' : 'คิดไม่ได้';
  return (
    <li className={tone}>
      <button
        type="button"
        onClick={hasDetail ? onToggle : undefined}
        disabled={!hasDetail}
        aria-expanded={hasDetail ? open : undefined}
        className="group w-full grid grid-cols-[1rem_minmax(0,1fr)_auto_1rem] gap-2 items-baseline py-2.5 text-left disabled:cursor-default"
      >
        <span className="text-center font-bold text-slate-400">{row.kind === 'add' || (row.kind === 'wait' && row.key !== 'base') ? '+' : ''}</span>
        <span className="min-w-0">
          <span className={`text-[13px] font-semibold ${ink} ${hasDetail ? 'group-hover:text-[var(--brand-fg)]' : ''}`}>{row.label}</span>
          {row.why && <span className="block sm:inline sm:ml-2 text-xs text-slate-500 break-words">{row.why}</span>}
        </span>
        <span className={`tabular-nums text-sm font-bold whitespace-nowrap text-right ${row.amount !== undefined ? 'text-slate-900' : ink}`}>{amount}</span>
        <span className="self-center text-slate-400">
          {hasDetail && <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />}
        </span>
      </button>
      {open && hasDetail && (
        <div className="mb-2.5 ml-6 sm:mr-6 px-3 py-2 rounded-lg bg-slate-50 text-xs text-slate-600">
          {row.steps.length > 0 && (
            <ol className="list-decimal pl-4 space-y-0.5 break-words">
              {row.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          )}
          {row.cells?.length ? <p className="mt-1.5 text-[11px] text-slate-400">ที่มาในชีต: {row.cells.join(' · ')}</p> : null}
        </div>
      )}
    </li>
  );
};

/** กฎที่ไม่ได้คิดเงิน — กลุ่มละบรรทัด · เหตุผลรายข้อพับไว้ใต้ "ดูเหตุผล" */
const Skipped: React.FC<{ rules: Rule[] }> = ({ rules }) => {
  const groups: { title: string; items: Rule[]; chip: (r: Rule) => string }[] = [
    { title: 'ไม่เกินมาตรฐาน', items: rules.filter((r) => r.skip === 'withinStd'), chip: (r: Rule) => r.reason ?? r.label },
    { title: 'ใบนี้ไม่มี', items: rules.filter((r) => r.skip === 'notInCode'), chip: (r: Rule) => r.label },
    { title: 'ไม่ตรงเงื่อนไข', items: rules.filter((r) => r.status === 'skipped' && r.skip === 'other'), chip: (r: Rule) => r.label },
    { title: 'ปิดไว้ในสมุดราคา', items: rules.filter((r) => r.status === 'off'), chip: (r: Rule) => r.label },
  ].filter((g) => g.items.length);
  if (!groups.length) return null;
  const all = groups.flatMap((g) => g.items);
  return (
    <div className="mt-4">
      <p className={CAP}>ไม่ได้คิดเงิน</p>
      <div className="space-y-1.5 text-xs">
        {groups.map((g) => (
          <div key={g.title} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-slate-600">{g.title}{g.items.length > 1 ? ` (${g.items.length})` : ''}</span>
            {g.items.map((r, i) => <span key={`${r.id}-${i}`} className={CHIP} title={r.reason}>{g.chip(r)}</span>)}
          </div>
        ))}
      </div>
      <details className="mt-1.5 text-xs">
        <summary className="cursor-pointer text-[var(--brand-fg)] font-semibold w-fit">ดูเหตุผลทีละข้อ</summary>
        <ul className="mt-1.5 space-y-1 text-slate-600">
          {all.map((r, i) => (
            <li key={`${r.id}-${i}`} className="break-words">
              <b className="font-semibold text-slate-700">{r.label}</b> — {r.reason}
              {r.steps.length > 0 && <span className="block text-[11.5px] text-slate-400">{r.steps.join(' · ')}</span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
};

const HIT: Record<TraceCheck['level'], { text: string; cls: string }> = {
  block: { text: 'ห้ามผลิต', cls: 'bg-red-50 border-red-200 text-red-700' },
  quoteOnRequest: { text: 'ต้องขอราคา', cls: 'bg-amber-50 border-amber-200 text-amber-800' },
  warn: { text: 'ข้อควรรู้', cls: 'bg-amber-50 border-amber-200 text-amber-800' },
};

const Checks: React.FC<{ checks: TraceCheck[] }> = ({ checks }) => {
  if (!checks.length) return <p className="text-xs text-slate-500">รุ่นนี้ไม่มีข้อห้าม</p>;
  const hits = checks.filter((c) => c.verdict === 'hit');
  const pass = checks.filter((c) => c.verdict === 'pass');
  const na = checks.filter((c) => c.verdict === 'na');
  const quiet = [...pass, ...na];
  return (
    <div className="space-y-2">
      {hits.map((c, i) => (
        <div key={i} className={`flex gap-1.5 items-start px-2.5 py-2 rounded-lg border text-xs ${HIT[c.level].cls}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="min-w-0 break-words"><b>{HIT[c.level].text}</b> — {c.message}</span>
        </div>
      ))}
      {quiet.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer flex items-center gap-1.5 text-slate-600">
            <Check className={`w-3.5 h-3.5 shrink-0 ${hits.length ? 'text-slate-400' : 'text-emerald-700'}`} />
            <span className="flex-1 min-w-0">
              {hits.length ? 'ข้ออื่น' : 'ข้อห้าม'} {quiet.length} ข้อ — {[pass.length ? `ผ่าน ${pass.length}` : '', na.length ? `ไม่เกี่ยวกับใบนี้ ${na.length}` : ''].filter(Boolean).join(' · ')}
            </span>
            <span className="text-[var(--brand-fg)] font-semibold">ดู</span>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {quiet.map((c, i) => (
              <li key={i} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-1.5">
                {c.verdict === 'pass'
                  ? <Check className="w-3.5 h-3.5 mt-0.5 text-emerald-700" aria-label="ผ่าน" />
                  : <Minus className="w-3.5 h-3.5 mt-0.5 text-slate-400" aria-label="ไม่เกี่ยว" />}
                <span className="min-w-0 break-words">
                  <span className="text-slate-700">{c.message}</span>
                  <span className="text-slate-400"> · {c.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

export const CalcTrace: React.FC<{ outcome: PriceOutcome }> = ({ outcome }) => {
  const t = outcome.trace;
  // แถวที่กางอยู่ผูกกับ trace ชุดนั้น — คิดรหัสใหม่แล้วพับกลับเอง (ไม่ต้องใช้ effect ล้างค่า)
  const [open, setOpen] = useState<{ of?: PriceTrace; keys: Set<string> }>({ keys: new Set() });
  if (!t) return null;
  const rows = rowsOf(outcome, t);
  const keys = open.of === t ? open.keys : new Set<string>();
  const expandable = rows.filter((r) => r.steps.length || r.cells?.length).map((r) => r.key);
  const allOpen = expandable.length > 0 && expandable.every((k) => keys.has(k));
  const toggle = (k: string) => {
    const next = new Set(keys);
    if (next.has(k)) next.delete(k); else next.add(k);
    setOpen({ of: t, keys: next });
  };

  const waiting = rows.filter((r) => r.kind === 'wait').length;
  const total =
    outcome.status === 'priced'
      ? { label: 'ราคาต่อชิ้น', sum: `${n(outcome.unitPrice)}`, cls: 'text-[var(--brand-fg)]' }
      : outcome.status === 'quoteOnRequest'
        ? { label: `ต้องขอราคา${waiting ? ` · ยังไม่รวม ${waiting} ข้อ` : ''}`, sum: outcome.unitPrice > 0 ? `${n(outcome.unitPrice)}+` : '—', cls: 'text-amber-800' }
        : { label: 'คิดราคาไม่ได้', sum: '—', cls: 'text-red-700' };

  return (
    <TableCard
      title="วิธีคำนวณราคา"
      hint="ราคานี้มาจากไหน — กดแต่ละแถวเพื่อดูวิธีคิดและที่มาในชีต"
      action={expandable.length > 0 ? (
        <Button size="sm" variant="neutral" tone="soft" icon={ChevronsUpDown}
                onClick={() => setOpen({ of: t, keys: allOpen ? new Set() : new Set(expandable) })}>
          {allOpen ? 'พับทุกแถว' : 'กางทุกแถว'}
        </Button>
      ) : undefined}
    >
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* ── ใบเสร็จ ── */}
        <div className="min-w-0 px-4 sm:px-5 pt-2.5 pb-4">
          <ol>
            {rows.map((r) => <ReceiptRow key={r.key} row={r} open={keys.has(r.key)} onToggle={() => toggle(r.key)} />)}
          </ol>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-3 pl-6 mt-px border-t-2 border-slate-300">
            <span className="text-[13px] font-bold text-slate-800">{total.label}</span>
            <span className={`ml-auto tabular-nums whitespace-nowrap font-extrabold text-xl ${total.cls}`}>
              {total.sum}{total.sum !== '—' && <small className="ml-1 text-xs font-semibold text-slate-500">บาท</small>}
            </span>
          </div>
          {t.rules.length === 0 && !t.base.ok && (
            <p className="mt-3 text-xs text-slate-500">ยังไม่ได้ตรวจกฎบวกเพิ่ม — ต้องได้ราคาตั้งก่อน</p>
          )}
          <Skipped rules={t.rules.filter((r) => r.status === 'skipped' || r.status === 'off')} />
        </div>

        {/* ── แถบข้าง: ค่าที่ใช้คิด · ข้อห้าม ── */}
        <aside className="min-w-0 px-4 py-3.5 bg-slate-50 border-t xl:border-t-0 xl:border-l border-slate-200 space-y-4">
          <section>
            <p className={CAP}>ค่าที่ใช้คิด</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 sm:gap-x-6 text-[12.5px]">
              {t.inputs.map((i) => {
                const tag = ORIGIN[i.origin];
                return (
                  <div key={`${i.kind}:${i.key}`} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-2 py-1.5 border-b border-slate-200">
                    <dt className="text-slate-500 break-words">{i.label}</dt>
                    <dd className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
                      <span className={`font-semibold break-words ${i.origin === 'missing' ? 'text-red-700' : 'text-slate-900'}`}>{i.value}</span>
                      {i.std !== undefined && <span className="text-[11.5px] text-slate-400">มาตรฐาน {i.std}</span>}
                      {tag && <span className={`${TAG} ${tag.cls}`} title={i.from}>{tag.text}</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="mt-1.5 text-[11px] text-slate-400">ไม่มีป้าย = อ่านจากรหัส · ชี้ป้ายเพื่อดูว่ามาจากไหน</p>
          </section>
          <section>
            <p className={CAP}>ข้อห้ามของรุ่น</p>
            <Checks checks={t.checks} />
          </section>
        </aside>
      </div>
    </TableCard>
  );
};
