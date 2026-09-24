import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, Undo2 } from 'lucide-react';
import { Button } from '../Button';
import { ErrorBox } from '../logs/ui';
import { errMsg } from '../logs/format';
import { ReviewModal, type DiffRow } from './ModelPriceEditor';
import type { EditorAdder, EditorView } from './types';

/**
 * หน้า "สมุดรายชีต" — หนึ่งชีตของไฟล์ราคา Excel = หนึ่งหน้า วางตารางแบบเดียวกับในชีต
 *
 * เจ้าของสั่ง 2026-09-24 หลังเห็นหน้าแก้ทีละรุ่นของซีรีส์ TS แล้วบอกว่า "งงกว่าเดิม":
 *   **"ให้ปรับให้ใกล้เคียง format เดิมใน excel มากที่สุด · เริ่มที่ชีท TS-01+TS-01-0 ก่อน · 1 ชีท / 1 สมุด"**
 * ⇒ คนที่ใช้จอนี้คือคนที่ดูแลไฟล์ราคามาตลอด ตาของเขาคุ้นกับชีต ไม่ใช่กับ "กฎบวกเพิ่ม"
 *   จอจึงวาง: หัวตาราง "ราคาตั้ง Standard …" → ตาราง แถว × คอลัมน์ ตามลำดับในชีต → แถบหมายเหตุใต้ตาราง
 *   และชีตที่มีสองตาราง (TS-01 กับ TS-01-0) อยู่หน้าเดียวกัน เรียงบนลงล่างเหมือนในไฟล์
 *
 * กติกาเดียวกับหน้าแก้ทีละรุ่น (อย่าแก้กลับ):
 *   · **ช่องว่าง = ไม่รับผลิต / ต้องขอราคา ไม่ใช่ 0** — ลบเลขได้ แต่ขึ้นเตือนในหน้าตรวจ
 *   · **ก่อนบันทึกต้องเห็นส่วนต่าง (เดิม → ใหม่) ทุกช่อง** — ใช้ `ReviewModal` ตัวเดียวกัน
 *   · สามอย่างที่ไฟล์เขียน/ระบายรอบตาราง (คอลัมน์ "ชนิดสาย รุ่นเริ่มต้น" · ตัวหนังสือแดงใต้คอลัมน์ · คอลัมน์
 *     พื้นเหลือง) มาจาก `PriceModel.layout` — แสดงผลอย่างเดียว ไม่มีผลกับราคา (เจ้าของสั่งเพิ่ม 2026-09-24)
 *   · เพิ่ม/ลบแถวหรือคอลัมน์ไม่ได้จากจอนี้ (แม่แบบ Excel) — จอแก้ได้แค่ตัวเลขในช่องที่ชีตมี
 * บันทึกทั้งชีตเป็นครั้งเดียว (`PUT /api/admin/pricebook/sheet/:sheet`) — เหตุผลที่หัว routes/pricingLab.ts
 *
 * ⚠️ ราคาอยู่ใน state ของจอนี้เท่านั้น (โหลดตอนเปิด) — ไม่มีอะไรอยู่ใน bundle ดูหัว ModelPriceEditor.tsx
 */

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : n.toLocaleString('en-US');

const toNum = (v: string): number | null => {
  const s = v.replace(/,/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** คีย์ของช่องในสมุด — ต้องตรงกับที่ engine.ts ประกอบ (`แถว | คอลัมน์`) */
const cellKey = (r: string, c: string) => `${r} | ${c}`;

/** หนึ่งรุ่นในชีต ระหว่างที่กำลังแก้ — เก็บเป็นข้อความเพราะคนกำลังพิมพ์อยู่ */
interface Draft {
  cells: string[][];
  /** id ของกฎ → ค่าแกน → ราคา */
  rates: Record<string, Record<string, string>>;
  /** หน้าตาของชีต — ข้อความท้ายแถว (ตามลำดับแถว) · ข้อความใต้คอลัมน์ · ไฮไลต์ (ตามลำดับคอลัมน์) */
  rowNote: string[];
  colNotes: string[];
  highlight: boolean[];
}

function toDraft(v: EditorView): Draft {
  const rows = v.base.kind === 'matrix' ? v.base.rows : [];
  const cols = v.base.kind === 'matrix' ? v.base.cols : [];
  const L = v.layout;
  return {
    rowNote: rows.map((r) => L.rowNote?.values[r] ?? ''),
    colNotes: cols.map((c) => L.colNotes[c] ?? ''),
    highlight: cols.map((c) => L.highlightCols.includes(c)),
    cells: v.base.kind === 'matrix' && v.base.cells ? v.base.cells.map((row) => row.map(str)) : [],
    rates: Object.fromEntries(
      v.adders.filter((a) => a.rates).map((a) => [a.id, Object.fromEntries(a.rates!.map((r) => [r.value, str(r.rate)]))]),
    ),
  };
}

/**
 * เลขที่เปลี่ยนเกิน 3 เท่า (ขึ้นหรือลง) = น่าจะพิมพ์ผิด (ศูนย์เกิน/ขาดหนึ่งตัว) — เตือนในหน้าตรวจ ไม่บล็อก
 * เพราะราคาที่ขึ้นจริงแรง ๆ ก็มีได้ แต่คนกดบันทึกต้องเห็นก่อน
 */
const suspicious = (was: number | null, now: number | null) =>
  was !== null && now !== null && was > 0 && (now > was * 3 || now * 3 < was);
const JUMP = ' ⚠ เปลี่ยนเกิน 3 เท่า — พิมพ์ผิดหรือเปล่า?';

const unitOf = (a: EditorAdder) =>
  `บาท / ${a.step && a.step !== 1 ? `${a.step} ` : ''}${a.unit.trim() || 'หน่วย'}`;

function buildDiff(models: EditorView[], drafts: Record<string, Draft>): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const v of models) {
    const d = drafts[v.code];
    if (!d) continue;
    if (v.base.kind === 'matrix' && v.base.cells) {
      const { rows: rs, cols, cells } = v.base;
      rs.forEach((r, i) => cols.forEach((c, j) => {
        const was = cells[i]![j] ?? null;
        const now = toNum(d.cells[i]![j]!);
        if (was === now) return;
        rows.push({
          what: `${v.title} · ราคาตั้ง ${r} × ${c}`,
          was: was === null ? 'ว่าง (ไม่รับผลิต)' : fmt(was),
          now: now === null ? 'ว่าง — ไม่รับผลิต' : fmt(now) + (suspicious(was, now) ? JUMP : ''),
          warn: now === null || suspicious(was, now),
        });
      }));
    }
    if (v.base.kind === 'matrix') {
      const { rows: rs, cols } = v.base;
      const L = v.layout;
      rs.forEach((r, i) => {
        const was = L.rowNote?.values[r] ?? '';
        const now = d.rowNote[i]!.trim();
        if (was !== now) rows.push({ what: `${v.title} · ${L.rowNote?.label ?? 'หมายเหตุ'} ${r}`, was: was || 'ว่าง', now: now || 'ว่าง' });
      });
      cols.forEach((c, j) => {
        const was = L.colNotes[c] ?? '';
        const now = d.colNotes[j]!.trim();
        if (was !== now) rows.push({ what: `${v.title} · ข้อความใต้คอลัมน์ ${c}`, was: was || 'ว่าง', now: now || 'ว่าง' });
        const hw = L.highlightCols.includes(c);
        if (hw !== d.highlight[j]) {
          rows.push({ what: `${v.title} · ไฮไลต์เหลืองคอลัมน์ ${c}`, was: hw ? 'ไฮไลต์' : 'ไม่ไฮไลต์', now: d.highlight[j] ? 'ไฮไลต์' : 'ไม่ไฮไลต์' });
        }
      });
    }
    for (const a of v.adders) {
      if (!a.rates) continue;
      for (const r of a.rates) {
        const now = toNum(d.rates[a.id]?.[r.value] ?? '');
        if (r.rate === now) continue;
        rows.push({
          what: `${v.title} · ${a.byAxisTh ?? ''} ${r.value}`.replace(/\s+/g, ' '),
          was: r.rate === null ? 'ว่าง (ต้องขอราคา)' : `${fmt(r.rate)} ${unitOf(a)}`,
          now: now === null ? 'ว่าง — ต้องขอราคา' : `${fmt(now)} ${unitOf(a)}${suspicious(r.rate, now) ? JUMP : ''}`,
          warn: now === null || suspicious(r.rate, now),
        });
      }
    }
  }
  return rows;
}

/** ส่งเฉพาะช่องที่เปลี่ยน — ช่องที่ไม่ได้ส่ง backend คงค่าเดิมให้ */
function buildBody(models: EditorView[], drafts: Record<string, Draft>) {
  type Layout = { rowNote: Record<string, string>; colNotes: Record<string, string>; highlightCols: string[] };
  const out: Record<string, {
    cells: Record<string, number | null>;
    adderRates: Record<string, { value: string; rate: number | null }[]>;
    layout?: Layout;
  }> = {};
  for (const v of models) {
    const d = drafts[v.code];
    if (!d) continue;
    const cells: Record<string, number | null> = {};
    if (v.base.kind === 'matrix' && v.base.cells) {
      const { rows: rs, cols, cells: was } = v.base;
      rs.forEach((r, i) => cols.forEach((c, j) => {
        const now = toNum(d.cells[i]![j]!);
        if ((was[i]![j] ?? null) !== now) cells[cellKey(r, c)] = now;
      }));
    }
    const adderRates: Record<string, { value: string; rate: number | null }[]> = {};
    for (const a of v.adders) {
      const changed = (a.rates ?? [])
        .map((r) => ({ value: r.value, rate: toNum(d.rates[a.id]?.[r.value] ?? '') }))
        .filter((r, i) => r.rate !== a.rates![i]!.rate);
      if (changed.length) adderRates[a.id] = changed;
    }
    // หน้าตาของชีตส่งทั้งชุดเมื่อมีอะไรเปลี่ยน (ชุดเล็ก — backend เรียงตามลำดับแถว/คอลัมน์ให้เอง)
    let layout: Layout | undefined;
    if (v.base.kind === 'matrix') {
      const { rows: rs, cols } = v.base;
      const next: Layout = {
        rowNote: Object.fromEntries(rs.map((r, i) => [r, d.rowNote[i]!.trim()]).filter(([, t]) => t)),
        colNotes: Object.fromEntries(cols.map((c, j) => [c, d.colNotes[j]!.trim()]).filter(([, t]) => t)),
        highlightCols: cols.filter((_, j) => d.highlight[j]),
      };
      const L = v.layout;
      const same = JSON.stringify(next.rowNote) === JSON.stringify(L.rowNote?.values ?? {})
        && JSON.stringify(next.colNotes) === JSON.stringify(L.colNotes)
        && JSON.stringify(next.highlightCols) === JSON.stringify(L.highlightCols);
      if (!same) layout = next;
    }
    if (Object.keys(cells).length || Object.keys(adderRates).length || layout) {
      out[v.code] = { cells, adderRates, ...(layout ? { layout } : {}) };
    }
  }
  return out;
}

/* ── ช่องราคาในตาราง ─────────────────────────────────────────────────────────
   หน้าตาแบบเซลล์ของชีต: ตัวช่องคือเส้นตาราง ไม่ใช่กล่องกรอกลอยอยู่ในช่อง · แก้แล้วพื้นเหลือง */

/*  สองสีที่ต้องไม่ปนกัน: **เหลือง = คอลัมน์ที่ไฟล์ราคาไฮไลต์ไว้** (สีเดียวกับในไฟล์) ·
    **ฟ้า = ช่องที่แก้แล้วยังไม่บันทึก** (หน้านี้เท่านั้นที่ไม่ใช้เหลืองแบบหน้าแก้ทีละรุ่น เพราะเหลืองมีความหมายแล้ว) */
const GridInput: React.FC<{
  value: string;
  was: string;
  label: string;
  highlight?: boolean;
  onChange: (v: string) => void;
}> = ({ value, was, label, highlight, onChange }) => {
  const changed = toNum(value) !== toNum(was);
  const empty = value.trim() === '';
  return (
    <td className={`border border-slate-200 p-0 ${changed ? 'bg-blue-50' : highlight ? 'bg-yellow-200' : ''}`}>
      <input
        inputMode="decimal"
        aria-label={label}
        title={empty ? `${label} — ว่าง = ไม่รับผลิต (ไม่ใช่ราคา 0)` : label}
        value={value}
        placeholder="—"
        onChange={(e) => onChange(e.target.value)}
        // แบบ Excel: คลิกช่องแล้วพิมพ์ทับได้เลย — ไม่งั้นเลขใหม่ไปต่อท้ายเลขเดิม (250 → 250260)
        onFocus={(e) => e.currentTarget.select()}
        className={`block w-full min-w-[76px] bg-transparent px-2.5 py-2 text-center text-[13.5px] tabular-nums outline-none focus:bg-card focus:ring-2 focus:ring-inset focus:ring-[var(--brand-border-strong)] ${
          changed ? 'font-bold text-blue-700' : 'text-slate-900'
        }`}
      />
    </td>
  );
};

/* ── หนึ่งตารางของชีต (= หนึ่งรุ่นในสมุด) ──────────────────────────────────── */

const SheetTable: React.FC<{
  v: EditorView;
  d: Draft;
  products: number | null | undefined;
  onCell: (i: number, j: number, val: string) => void;
  onRate: (adderId: string, value: string, val: string) => void;
  onRowNote: (i: number, val: string) => void;
  onColNote: (j: number, val: string) => void;
  onHighlight: (j: number) => void;
}> = ({ v, d, products, onCell, onRate, onRowNote, onColNote, onHighlight }) => {
  if (v.base.kind !== 'matrix' || !v.base.cells) return null;
  const { rows, cols, cells, axes, axesTh } = v.base;
  const L = v.layout;
  /** แถวข้อความใต้ตาราง (ตัวหนังสือแดง) — โผล่เฉพาะชีตที่มี เพิ่มใหม่ทำผ่านแม่แบบ Excel */
  const hasColNotes = Object.keys(L.colNotes).length > 0;
  const head = (i: number) => `${axesTh[i] ?? axes[i]} (${(axes[i] ?? '').toUpperCase()})`;

  return (
    <section className="bg-card border border-slate-200 rounded-2xl overflow-hidden">
      {/* ชื่อตารางแบบที่ชีตเขียนไว้มุมซ้ายบน (TS_ - 01) */}
      <div className="px-5 pt-4 pb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[17px] font-bold text-slate-900 font-mono">{v.title}</h2>
        <span className="text-[13px] text-slate-600">{v.label}</span>
        {typeof products === 'number' && (
          <span className="ml-auto text-[11.5px] text-slate-500 tabular-nums">
            ครอบสินค้า {products.toLocaleString('th-TH')} รายการ
          </span>
        )}
        <p className="basis-full text-[11px] text-slate-400">
          ใช้กับรหัส <span className="font-mono">{[v.code, ...v.aliases].join(', ')}</span>
        </p>
      </div>

      <div className="px-5 pb-4">
        <div className="text-[14px] font-bold text-slate-900 mb-2">
          ราคาตั้ง Standard <span className="font-mono">{v.title}</span>
          {v.standardTh && <span className="ml-2 text-[12px] font-normal text-slate-500">· รวมในราคาแล้ว: {v.standardTh}</span>}
        </div>

        <div className="overflow-x-auto">
          <table className="border-collapse text-[13px]">
            <thead>
              <tr>
                <th rowSpan={2}
                    className="sticky left-0 z-10 border border-slate-200 bg-emerald-100 px-3 py-2 text-left font-bold text-emerald-800 min-w-[104px]">
                  {head(0)}
                </th>
                <th colSpan={cols.length}
                    className="border border-slate-200 bg-emerald-100 px-3 py-1.5 text-center font-bold text-emerald-800">
                  {head(1)}
                </th>
                {L.rowNote && (
                  <th rowSpan={2}
                      className="border border-slate-200 bg-emerald-100 px-3 py-2 text-center font-bold text-emerald-800 min-w-[150px]">
                    {L.rowNote.label}
                  </th>
                )}
              </tr>
              <tr>
                {cols.map((c, j) => (
                  <th key={c} className="border border-slate-200 bg-emerald-100 p-0 text-center font-bold text-emerald-800 whitespace-nowrap">
                    {/* คลิกหัวคอลัมน์ = สลับไฮไลต์เหลืองของคอลัมน์นั้น (แบบที่ไฟล์ระบายไว้) */}
                    <button
                      type="button"
                      onClick={() => onHighlight(j)}
                      aria-pressed={d.highlight[j]}
                      title={d.highlight[j] ? `คอลัมน์ ${c} ไฮไลต์เหลืองอยู่ — คลิกเพื่อเลิกไฮไลต์` : `คลิกเพื่อไฮไลต์คอลัมน์ ${c} สีเหลือง`}
                      className="w-full px-3 py-1.5 hover:underline"
                    >
                      {c}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r}>
                  <th scope="row"
                      className="sticky left-0 z-10 border border-slate-200 bg-emerald-50 px-3 py-2 text-left font-bold text-emerald-800 whitespace-nowrap">
                    {r}
                  </th>
                  {cols.map((c, j) => (
                    <GridInput
                      key={c}
                      label={`${v.title} ราคาตั้ง ${r} × ${c}`}
                      value={d.cells[i]![j]!}
                      was={str(cells[i]![j])}
                      highlight={d.highlight[j]}
                      onChange={(val) => onCell(i, j, val)}
                    />
                  ))}
                  {L.rowNote && (
                    <td className={`border border-slate-200 p-0 ${d.rowNote[i]!.trim() !== (L.rowNote.values[r] ?? '') ? 'bg-blue-50' : ''}`}>
                      <input
                        aria-label={`${v.title} ${L.rowNote.label} ${r}`}
                        value={d.rowNote[i]}
                        onChange={(e) => onRowNote(i, e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        className="block w-full bg-transparent px-3 py-2 text-[13px] text-slate-700 outline-none focus:bg-card focus:ring-2 focus:ring-inset focus:ring-[var(--brand-border-strong)]"
                      />
                    </td>
                  )}
                </tr>
              ))}
              {hasColNotes && (
                <tr>
                  <td className="sticky left-0 z-10 bg-card" />
                  {cols.map((c, j) => (
                    <td key={c} className="p-0">
                      <input
                        aria-label={`${v.title} ข้อความใต้คอลัมน์ ${c}`}
                        title="ข้อความใต้คอลัมน์ (ตัวหนังสือแดงแบบในไฟล์) — แสดงผลอย่างเดียว"
                        value={d.colNotes[j]}
                        onChange={(e) => onColNote(j, e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        className={`block w-full bg-transparent px-2 py-1.5 text-center text-[13px] text-red-600 outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--brand-border-strong)] ${
                          d.colNotes[j]!.trim() !== (L.colNotes[c] ?? '') ? 'bg-blue-50 font-bold' : ''
                        }`}
                      />
                    </td>
                  ))}
                  {L.rowNote && <td />}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">
          หน่วย บาท · ช่องว่าง = ไม่รับผลิตแบบนั้น (ไม่ใช่ราคา 0) · พื้นเหลือง = คอลัมน์ที่ไฟล์ราคาไฮไลต์ไว้
          (คลิกหัวคอลัมน์เพื่อเปลี่ยน) · พื้นฟ้า = ช่องที่แก้แล้วยังไม่บันทึก
          {(L.rowNote || hasColNotes) && <> · {[L.rowNote && `คอลัมน์ “${L.rowNote.label}”`, hasColNotes && 'ตัวหนังสือแดง'].filter(Boolean).join(' และ ')} เป็นข้อความกำกับ ไม่มีผลกับราคา</>}
        </p>

        {/* แถบหมายเหตุใต้ตาราง — ในชีตเป็นแถบสีส้ม "สายยาวกว่า 1 M บวกเพิ่มตามราคาสาย"
            ราคาสายจริงอยู่อีกชีต (TS-21+22+25) ซึ่งสมุดลอกมาไว้ในกฎของแต่ละรุ่น ⇒ วางให้แก้ตรงนี้เลย */}
        {v.adders.filter((a) => a.rates).map((a) => (
          <div key={a.id} className="mt-3.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="text-[13px] font-bold text-amber-800">หมายเหตุ : {a.label}</div>
            <div className="mt-2 overflow-x-auto">
              <table className="border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="border border-amber-200 bg-card px-3 py-1.5 text-left font-bold text-slate-700 whitespace-nowrap">
                      {a.byAxisTh ?? 'ชนิด'}
                    </th>
                    {a.rates!.map((r) => (
                      <th key={r.value} className="border border-amber-200 bg-card px-3 py-1.5 text-center font-semibold text-slate-700 whitespace-nowrap">
                        {r.value || '(ว่าง)'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" className="border border-amber-200 bg-card px-3 py-1.5 text-left font-normal text-slate-500 whitespace-nowrap">
                      {unitOf(a)}
                    </th>
                    {a.rates!.map((r) => (
                      <GridInput
                        key={r.value}
                        label={`${v.title} ${a.label} — ${r.value}`}
                        value={d.rates[a.id]?.[r.value] ?? ''}
                        was={str(r.rate)}
                        onChange={(val) => onRate(a.id, r.value, val)}
                      />
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[11px] text-amber-700">
              ช่องว่าง = สายชนิดนั้นต้องขอราคา (ไม่ใช่ฟรี)
              {a.source?.includes('TS-21+22+25') && <> · ราคาสายลอกมาจากชีต <span className="font-mono">TS-21+22+25</span> — แก้ตรงนี้มีผลกับ {v.title} เท่านั้น</>}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
};

/* ── หน้าจอ ─────────────────────────────────────────────────────────────── */

export const SheetEditor: React.FC<{
  sheet: string;
  /** จำนวนสินค้าที่ครอบของแต่ละรุ่น (จากตารางหน้าสมุดราคา) */
  products: Record<string, number | null | undefined>;
  authHeaders: Record<string, string>;
  onBack: (saved: boolean) => void;
}> = ({ sheet, products, authHeaders, onBack }) => {
  const jsonHeaders = useMemo(
    () => ({ ...authHeaders, 'Content-Type': 'application/json' }),
    [authHeaders],
  );
  const url = `/api/admin/pricebook/sheet/${encodeURIComponent(sheet)}`;

  const [models, setModels] = useState<EditorView[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [fingerprint, setFingerprint] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const savedOnce = useRef(false);

  const reset = (list: EditorView[]) => {
    setModels(list);
    setDrafts(Object.fromEntries(list.map((v) => [v.code, toDraft(v)])));
  };

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(url, { headers: authHeaders });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'โหลดชีตนี้ไม่สำเร็จ');
      setFingerprint(body.fingerprint);
      setModels(body.models);
      setDrafts(Object.fromEntries((body.models as EditorView[]).map((v) => [v.code, toDraft(v)])));
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  }, [authHeaders, url]);

  // โหลดครั้งแรก — หุ้ม setTimeout ตามท่าของทั้งแอป (eslint ปฏิเสธ setState ตรง ๆ ใน useEffect)
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const diff = useMemo(() => (models ? buildDiff(models, drafts) : []), [models, drafts]);
  const dirty = diff.length > 0;

  const patch = (code: string, fn: (d: Draft) => Draft) =>
    setDrafts((prev) => (prev[code] ? { ...prev, [code]: fn(prev[code]!) } : prev));

  const save = async () => {
    if (!models) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ fingerprint, note, models: buildBody(models, drafts) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'บันทึกไม่สำเร็จ');
      setFingerprint(body.fingerprint);
      reset(body.models);
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

  if (error && !models) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!models) return <div className="text-sm text-slate-400 px-1 py-8">กำลังโหลดชีต {sheet} …</div>;

  return (
    <div className="space-y-3.5">
      <div className="flex items-start gap-2.5 flex-wrap">
        <Button icon={ChevronLeft} onClick={() => onBack(savedOnce.current)}>กลับ</Button>
        <div className="min-w-[180px] flex-1">
          <h1 className="text-lg font-bold text-slate-900">
            ชีต <span className="font-mono">{sheet}</span>
          </h1>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {models.length} ตาราง · แก้ตัวเลขในช่องได้เลย แล้วกด “ตรวจก่อนบันทึก” ·
            เพิ่ม/ลบแถวหรือคอลัมน์ใช้แม่แบบ Excel
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button icon={Undo2} disabled={!dirty} onClick={() => reset(models)}>ย้อนการแก้</Button>
          <Button variant="primary" icon={BookOpen} disabled={!dirty} onClick={() => setReview(true)}>
            ตรวจก่อนบันทึก{dirty ? ` (${diff.length})` : ''}
          </Button>
        </div>
      </div>

      {error && <ErrorBox message={error} />}

      {models.map((v) => (
        <SheetTable
          key={v.code}
          v={v}
          d={drafts[v.code] ?? toDraft(v)}
          products={products[v.code]}
          onCell={(i, j, val) => patch(v.code, (d) => ({
            ...d,
            cells: d.cells.map((row, ri) => (ri === i ? row.map((c, ci) => (ci === j ? val : c)) : row)),
          }))}
          onRate={(id, value, val) => patch(v.code, (d) => ({
            ...d,
            rates: { ...d.rates, [id]: { ...d.rates[id], [value]: val } },
          }))}
          onRowNote={(i, val) => patch(v.code, (d) => ({ ...d, rowNote: d.rowNote.map((t, k) => (k === i ? val : t)) }))}
          onColNote={(j, val) => patch(v.code, (d) => ({ ...d, colNotes: d.colNotes.map((t, k) => (k === j ? val : t)) }))}
          onHighlight={(j) => patch(v.code, (d) => ({ ...d, highlight: d.highlight.map((h, k) => (k === j ? !h : h)) }))}
        />
      ))}

      {review && (
        <ReviewModal
          code={`ชีต ${sheet}`}
          rows={diff}
          problems={[]}
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
