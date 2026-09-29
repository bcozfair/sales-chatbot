import React, { useMemo, useState } from 'react';
import { Eye, EyeOff, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '../Button';
import { SubCodeModal } from './SubCodeModal';
import { effectText, groupRows, isWide, matchesQuery, mergeRows, type Lookup, type MergedRow } from './subCodeText';
import { subCodePending, type ModelBrief, type SheetUnread, type SubCode, type UnreadSummary, type UnreadToken } from './types';

/**
 * "รหัสย่อย" สองที่บนหน้าสมุดราคา — เจ้าของเคาะ mockup `pricebook-subcodes-sheet` 2026-09-29
 * (ถามมาว่าตารางใหญ่หน้าแรก "มันดูซ้ำกันหลายรุ่น ควรย้ายไปไว้ในชีทของแต่ละรุ่นแทนดีมั้ย")
 *
 * `SheetSubCodes` — ใต้ตารางของหน้าชีต:
 *   · "ตัวอักษรในรหัส" จัดกลุ่มตามช่องในรหัส · ผลกับราคาเป็นประโยค · ป้าย "ยังไม่มีราคา"
 *   · ชีตที่มีสองรุ่น แถวที่ความหมายเหมือนกันทุกช่องรวมเป็นแถวเดียวพร้อมป้ายรุ่น (ข้อ 1)
 *   · แก้/เพิ่ม/ปิด **มีผลทันที** ไม่ผูกกับปุ่ม "ตรวจก่อนบันทึก" ของตาราง — บอกไว้ที่หัวส่วน (ข้อ 2)
 *   · แถวขอบเขตหลายรุ่น (`BH-0*`) อ่านอย่างเดียว แก้ที่หน้าแรก (ข้อ 4) · แถวจากไฟล์ราคาอ่านอย่างเดียว
 *   · "ยังอ่านไม่ออกในชีตนี้" นับสดจากรหัสสินค้าจริง แทนรายการที่นับไว้ครั้งเดียว (ข้อ 3)
 * `SubCodeHome` — หน้าแรก: ค้น "ตัวอักษรนี้ใช้ที่ไหน" · แถวหลายรุ่น · สรุปที่ยังอ่านไม่ออกต่อชีต
 *
 * ปุ่มแก้/ปิด/ลบเป็นไอคอน (เจ้าของสั่งตอนเคาะ mockup) — ไอคอนล้วนต้องมี `aria-label` + `title` เสมอ (design.md ข้อ 8)
 */

interface Api {
  token: string;
  authHeaders: Record<string, string>;
  /** แถวรหัสย่อยเปลี่ยน — หน้าสมุดราคาโหลดรายการ + ตัวนับใหม่ */
  onChanged: () => void;
}

/** เปิดกล่องแก้ด้วยอะไร — `row` = แก้แถวบนจอ · `token` = ตั้งท่อนที่อ่านไม่ออก · ไม่มีทั้งคู่ = เพิ่มใหม่ */
interface Editing {
  row?: MergedRow;
  token?: string;
  example?: string;
  pattern?: boolean;
}

const chip = 'inline-block rounded-md bg-slate-100 px-1.5 py-px font-mono text-[11px] text-slate-600';

const PendingPill: React.FC<{ children?: React.ReactNode }> = ({ children = 'ยังไม่มีราคา' }) => (
  <span className="ml-1 inline-block whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-1.5 py-px align-middle text-[11px] font-bold text-amber-700">
    {children}
  </span>
);

const Effect: React.FC<{ s: SubCode; lk: Lookup }> = ({ s, lk }) => {
  const e = effectText(s, lk);
  return (
    <span className={e.muted ? 'text-slate-400' : 'text-slate-700'}>
      {e.lead}
      {e.strong && <b className="font-semibold text-slate-900">{e.strong}</b>}
      {e.tail && <span className="text-slate-400">{e.tail}</span>}
      {e.pending && <PendingPill />}
    </span>
  );
};

/** ส่วนการ์ด — หน้าตาเดียวกับ `TableCard` แต่หัวส่วนต้องมีป้ายและตัวหนาในคำอธิบาย */
const Section: React.FC<{
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}> = ({ title, hint, action, children, testId }) => (
  <section data-testid={testId} className="bg-card border border-slate-200 rounded-2xl overflow-hidden">
    <div className="px-4 py-3 border-b border-slate-100 flex items-start gap-3 flex-wrap">
      <div className="min-w-[220px] flex-1">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 flex-wrap">{title}</h3>
        {hint && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{hint}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

const Count: React.FC<{ n: number }> = ({ n }) => (
  <span className="rounded-full bg-slate-100 px-2 py-px text-[11px] font-semibold text-slate-500 tabular-nums">{n.toLocaleString('en-US')}</span>
);

/** หนึ่งแถวบนจอ — `mode` บอกว่าแก้ที่นี่ได้ไหม */
const Row: React.FC<{
  m: MergedRow;
  lk: Lookup;
  names: Record<string, string>;
  showModels: boolean;
  mode: 'edit' | 'wide' | 'file';
  onEdit: () => void;
  onToggle: () => void;
  onRemove: () => void;
}> = ({ m, lk, names, showModels, mode, onEdit, onToggle, onRemove }) => {
  const s = m.row;
  const who = [s.by, s.at].filter(Boolean).join(' · ');
  return (
    <div
      data-subcode={s.subCode}
      data-models={m.models.join(',')}
      className="grid grid-cols-[52px_minmax(0,1fr)] sm:grid-cols-[64px_minmax(0,1.3fr)_minmax(0,1.2fr)_auto] gap-x-3.5 gap-y-1 items-center py-2 border-t border-slate-100 first:border-t-0"
    >
      <div className={`font-mono font-bold text-sm text-slate-900 break-all ${s.disabled ? 'opacity-40' : ''}`}
           title={s.id ? `ตั้งค่าเอง${who ? ` · ${who}` : ''}` : s.source ? `ไฟล์ราคา · ${s.source}` : undefined}>
        {s.subCode}
      </div>
      <div className="text-[13px] text-slate-800 min-w-0">
        <span className={s.disabled ? 'opacity-40' : ''}>{s.reads || <span className="text-slate-400">—</span>}</span>
        {s.disabled && <span className="ml-1.5 text-[11px] font-semibold text-slate-500">ปิดไว้</span>}
        {(showModels || isWide(s)) && (
          <div className="flex flex-wrap gap-1 mt-1">
            {isWide(s) ? (
              <span className={`${chip} bg-blue-50 text-blue-700`}>
                {s.scope.trim() === '*' || s.scope.trim() === '' ? 'ใช้กับทุกรุ่น' : `ใช้กับทุกรุ่น ${s.scope}`}
              </span>
            ) : m.models.length > 0 ? (
              m.models.map((c) => <span key={c} className={chip}>{names[c] ?? c}</span>)
            ) : (
              <span className={`${chip} bg-amber-50 text-amber-700`} title={`ขอบเขต ${s.scope} ไม่ตรงกับรุ่นไหนในสมุดราคา`}>
                ไม่ตรงกับรุ่นไหน ({s.scope})
              </span>
            )}
          </div>
        )}
      </div>
      <div className={`col-start-2 sm:col-start-auto text-[12.5px] ${s.disabled ? 'opacity-40' : ''}`}>
        <Effect s={s} lk={lk} />
      </div>
      <div className="col-span-2 sm:col-span-1 flex gap-1.5 justify-start sm:justify-end">
        {mode === 'file' && <span className="text-[11.5px] text-slate-400">มาจากไฟล์ราคา</span>}
        {mode === 'wide' && <span className="text-[11.5px] text-slate-400">แก้ที่หน้าแรกสมุดราคา</span>}
        {mode === 'edit' && (
          <>
            <Button size="icon" icon={Pencil} aria-label={`แก้ ${s.subCode}`} title="แก้" onClick={onEdit} />
            <Button
              size="icon" icon={s.disabled ? Eye : EyeOff}
              aria-label={`${s.disabled ? 'เปิดใช้' : 'ปิดไว้'} ${s.subCode}`}
              title={s.disabled ? 'เปิดใช้อีกครั้ง' : 'ปิดไว้ (ไม่ลบ — ตัวอ่านจะนับว่ายังไม่ได้ตั้งค่า)'}
              onClick={onToggle}
            />
            <Button size="icon" variant="danger" tone="soft" icon={Trash2} aria-label={`ลบ ${s.subCode}`} title="ลบ" onClick={onRemove} />
          </>
        )}
      </div>
    </div>
  );
};

const rowMode = (s: SubCode, wideReadOnly: boolean): 'edit' | 'wide' | 'file' =>
  s.id === undefined ? 'file' : wideReadOnly && isWide(s) ? 'wide' : 'edit';

/** ปิด/เปิด และลบ — ทำกับทุกแถวในฐานที่รวมอยู่ในแถวบนจอ */
async function toggleRows(api: Api, m: MergedRow) {
  for (const s of m.members) {
    if (!s.id) continue;
    await fetch(`/api/admin/pricebook/subcodes/${s.id}`, {
      method: 'PUT',
      headers: { ...api.authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...s, disabled: !m.row.disabled }),
    });
  }
  api.onChanged();
}

async function removeRows(api: Api, m: MergedRow, names: Record<string, string>) {
  const where = isWide(m.row) ? `ขอบเขต ${m.row.scope}` : m.models.map((c) => names[c] ?? c).join(' และ ') || m.row.scope;
  if (!window.confirm(`ลบรหัสย่อย ${m.row.subCode} ของ ${where} ?\nรหัสที่มีตัวอักษรนี้จะกลับไปเป็น “ยังไม่ได้ตั้งค่า” ทันที`)) return;
  for (const s of m.members) {
    if (s.id) await fetch(`/api/admin/pricebook/subcodes/${s.id}`, { method: 'DELETE', headers: api.authHeaders });
  }
  api.onChanged();
}

/**
 * ท่อนที่ควรชวนให้ตั้งเป็นรหัสย่อย — มีตัวอักษร และไม่ใช่หน้าตาของขนาด (`6Ax150` · `12.7x250` = แกน × ยาว
 * ที่ตัวอ่านไม่รู้จัก ต้องแก้ที่ตาราง) · ตัวเลขล้วน (`4` · `+20`) ก็เป็นขนาดเหมือนกัน
 */
const isLetterToken = (t: UnreadToken) =>
  t.subCode !== undefined && /[A-Z]/i.test(t.subCode) && !/x\d/i.test(t.subCode);

/** ท่อนที่ต่างกันแค่ตัวเลข (S000 · S001 …) รวมเป็นชิปเดียว — ตั้งเป็นแม่แบบตัวเดียวได้ทั้งชุด */
function letterChips(tokens: UnreadToken[]) {
  const settable = tokens.filter(isLetterToken);
  const byShape = new Map<string, UnreadToken[]>();
  for (const t of settable) {
    const shape = t.subCode!.toUpperCase().replace(/\d/g, '#');
    byShape.set(shape, [...(byShape.get(shape) ?? []), t]);
  }
  return [...byShape].map(([shape, list]) => ({
    label: list.length > 1 ? shape : list[0]!.subCode!,
    first: list[0]!,
    pattern: list.length > 1,
    count: list.reduce((n, t) => n + t.count, 0),
    title: list.length > 1 ? list.map((t) => `${t.subCode} ×${t.count}`).join(' · ') : `${list[0]!.reads} · เช่น ${list[0]!.example}`,
  })).sort((a, b) => b.count - a.count);
}

/* ── หน้าชีต ─────────────────────────────────────────────────────────────── */

export const SheetSubCodes: React.FC<Api & {
  sheet: string;
  /** รุ่นในชีตนี้ (ลำดับเดียวกับตาราง) */
  codes: string[];
  rows: SubCode[];
  models: ModelBrief[];
  axisLabels: Record<string, string>;
  /** `undefined` = กำลังนับ · `null` = นับไม่สำเร็จ */
  unread: SheetUnread | null | undefined;
}> = ({ sheet, codes, rows, models, axisLabels, unread, ...api }) => {
  void sheet;
  const [editing, setEditing] = useState<Editing | null>(null);
  const lk: Lookup = useMemo(() => ({ axisLabels, models }), [axisLabels, models]);
  const names = useMemo(() => Object.fromEntries(models.map((m) => [m.code, m.name])), [models]);

  const inSheet = useMemo(() => rows.filter((r) => (r.models ?? []).some((c) => codes.includes(c))), [rows, codes]);
  const local = useMemo(() => mergeRows(inSheet.filter((r) => !isWide(r)), codes), [inSheet, codes]);
  const wide = useMemo(() => mergeRows(inSheet.filter(isWide), codes), [inSheet, codes]);
  const groups = useMemo(() => groupRows(local, axisLabels), [local, axisLabels]);
  const pending = local.filter((m) => subCodePending(m.row)).length;
  const targets = codes.map((c) => ({ code: c, name: names[c] ?? c }));
  const siblings = inSheet.filter((r) => r.id !== undefined && !isWide(r));
  const many = codes.length > 1;

  const chips = unread ? letterChips(unread.tokens) : [];
  const others = unread ? unread.tokens.filter((t) => !isLetterToken(t)) : [];

  const rowProps = (m: MergedRow) => ({
    m, lk, names, showModels: many,
    onEdit: () => setEditing({ row: m }),
    onToggle: () => void toggleRows(api, m),
    onRemove: () => void removeRows(api, m, names),
  });

  return (
    <>
      <Section
        testId="sheet-subcodes"
        title={<>ตัวอักษรในรหัส <Count n={local.length + wide.length} />{pending > 0 && <PendingPill>{pending} ตัวยังไม่มีราคา</PendingPill>}</>}
        hint={<>ตัวอักษรท้ายรหัสของ{many ? ` ${targets.map((t) => t.name).join(' · ')}` : 'ชีตนี้'} แปลว่าอะไร และทำอะไรกับราคา ·{' '}
          <b className="text-slate-700">แก้ / เพิ่ม / ปิด มีผลทันที</b> ไม่ต้องกด “ตรวจก่อนบันทึก” ของตาราง</>}
        action={<Button icon={Plus} onClick={() => setEditing({})}>เพิ่มตัวอักษร</Button>}
      >
        {groups.length === 0 && wide.length === 0 && (
          <p className="px-4 py-3 text-xs text-slate-400">ยังไม่มีตัวอักษรที่ตั้งไว้ในชีตนี้</p>
        )}
        {groups.map((g) => (
          <div key={g.key} className="px-4 pt-2 pb-1 border-b border-slate-100 last:border-b-0">
            <h4 className="text-xs font-bold text-slate-500 flex items-center gap-1.5 mt-1">{g.label} <Count n={g.rows.length} /></h4>
            {g.rows.map((m) => <Row key={m.key} {...rowProps(m)} mode={rowMode(m.row, true)} />)}
          </div>
        ))}
        {wide.length > 0 && (
          <div className="px-4 pt-2 pb-1">
            <h4 className="text-xs font-bold text-slate-500 flex items-center gap-1.5 mt-1">ใช้กับหลายรุ่น <Count n={wide.length} /></h4>
            {wide.map((m) => <Row key={m.key} {...rowProps(m)} mode={rowMode(m.row, true)} />)}
          </div>
        )}
      </Section>

      <Section
        testId="sheet-unread"
        title={<>ยังอ่านไม่ออกในชีตนี้{unread && <Count n={unread.unread} />}</>}
        hint={unread === undefined
          ? 'กำลังนับจากรหัสสินค้าจริง…'
          : unread === null
            ? 'นับไม่สำเร็จ — ลองเปิดหน้านี้ใหม่'
            : <>นับสดจากรหัสสินค้าจริง {unread.codes.toLocaleString('en-US')} รหัสของรุ่นในชีตนี้ — {unread.unread.toLocaleString('en-US')} รหัสยังมีท่อนที่ระบบอ่านไม่ออก ·
                กดตัวอักษรเพื่อตั้งความหมาย</>}
      >
        {unread === undefined && (
          <p className="px-4 py-3 text-xs text-slate-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังนับ…</p>
        )}
        {unread && unread.unread === 0 && <p className="px-4 py-3 text-xs text-slate-500">ทุกรหัสในชีตนี้อ่านออกครบแล้ว</p>}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 py-3">
            {chips.map((c) => (
              <button
                key={c.label} type="button" title={c.title}
                onClick={() => setEditing({ token: c.first.subCode, example: c.first.example, pattern: c.pattern })}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full bg-card border border-slate-200 text-slate-700 hover:border-[var(--brand-border)] hover:text-[var(--brand-fg)]"
              >
                <Plus className="w-3 h-3" />
                <b className="font-mono">{c.label}</b>
                <span className="text-[10.5px] text-slate-400 tabular-nums">{c.count.toLocaleString('en-US')} รหัส</span>
              </button>
            ))}
          </div>
        )}
        {others.length > 0 && (
          <div className="px-4 py-2.5 border-t border-slate-100 text-[11.5px] text-slate-500 leading-relaxed">
            ท่อนอื่นที่อ่านไม่ออก — ส่วนใหญ่เป็นขนาด/ความยาวที่ตารางยังไม่มี (แก้ที่ตารางหรือแม่แบบ Excel ไม่ใช่รหัสย่อย):{' '}
            {others.map((t) => (
              <span key={t.text} className={`${chip} mr-1 mb-0.5`} title={`${t.reads} · เช่น ${t.example}`}>{t.text} ×{t.count}</span>
            ))}
          </div>
        )}
      </Section>

      {editing && (
        <SubCodeModal
          token={api.token}
          subCode={editing.row?.row.subCode ?? editing.token ?? ''}
          editing={editing.row?.row}
          members={editing.row?.members}
          siblings={siblings}
          targets={targets}
          preferPattern={editing.pattern}
          modelCode={codes[0] ?? '*'}
          models={models}
          code={editing.example ?? ''}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); api.onChanged(); }}
        />
      )}
    </>
  );
};

/* ── หน้าแรกสมุดราคา ──────────────────────────────────────────────────────── */

export const SubCodeHome: React.FC<Api & {
  rows: SubCode[];
  models: ModelBrief[];
  axisLabels: Record<string, string>;
  /** `undefined` = กำลังนับ · `null` = นับไม่สำเร็จ */
  unread: UnreadSummary | null | undefined;
  /** ชื่อชีตที่ขึ้นจอ (ชีตชื่อกลาง ๆ อย่าง Sheet1 ใช้ชื่อรุ่นแทน) */
  sheetLabel: (sheet: string) => string;
  onOpenSheet: (sheet: string) => void;
}> = ({ rows, models, axisLabels, unread, sheetLabel, onOpenSheet, ...api }) => {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const lk: Lookup = useMemo(() => ({ axisLabels, models }), [axisLabels, models]);
  const names = useMemo(() => Object.fromEntries(models.map((m) => [m.code, m.name])), [models]);
  const sheetOfModel = useMemo(() => Object.fromEntries(models.map((m) => [m.code, m.sheet || m.code])), [models]);

  // แถวที่ต้องแก้จากที่นี่: ขอบเขตหลายรุ่น + แถวที่ไม่ตรงกับรุ่นไหนเลย (ไม่งั้นจะไม่มีชีตไหนโชว์มัน)
  const wide = useMemo(
    () => mergeRows(rows.filter((r) => isWide(r) || (r.models ?? []).length === 0), models.map((m) => m.code)),
    [rows, models],
  );

  const hits = useMemo(() => {
    const byMeaning = new Map<string, SubCode[]>();
    for (const r of rows) {
      if (!matchesQuery(r, q)) continue;
      const k = `${r.reads}|${r.effect}|${r.value ?? ''}|${r.amount ?? ''}`;
      byMeaning.set(k, [...(byMeaning.get(k) ?? []), r]);
    }
    return [...byMeaning.values()];
  }, [rows, q]);
  const hitModels = new Set(hits.flat().flatMap((r) => r.models ?? []));

  return (
    <>
      <Section
        testId="subcode-search"
        title="ตัวอักษรนี้ใช้ที่ไหน"
        hint="รหัสย่อยอยู่ในหน้าชีตของแต่ละรุ่นแล้ว — พิมพ์ตัวอักษรเพื่อดูว่าแปลว่าอะไรในรุ่นไหน แล้วกดไปชีตนั้น"
      >
        <div className="px-4 py-3 flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            aria-label="ค้นตัวอักษรในรหัส" value={q} onChange={(e) => setQ(e.target.value.replace(/[()]/g, ''))}
            placeholder="เช่น U · BU · M10 · S000" autoComplete="off"
            className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-card border border-slate-200 text-sm font-mono text-slate-900"
          />
        </div>
        {q.trim() && hits.length === 0 && (
          <p className="px-4 pb-3 text-xs text-slate-500">
            ยังไม่มีรุ่นไหนตั้ง “{q.trim().toUpperCase()}” ไว้ — ตั้งได้จากหน้าชีตของรุ่นนั้น (ส่วน “ยังอ่านไม่ออกในชีตนี้”)
          </p>
        )}
        {hits.map((list) => {
          const s = list[0]!;
          const sheets = [...new Set(list.flatMap((r) => (r.models ?? []).map((c) => sheetOfModel[c] ?? c)))];
          return (
            <div key={`${s.reads}|${s.effect}|${s.value ?? ''}|${s.amount ?? ''}`}
                 className="grid grid-cols-[52px_minmax(0,1fr)] sm:grid-cols-[64px_minmax(0,1fr)] gap-x-3.5 px-4 py-2.5 border-t border-slate-100">
              <div className="font-mono font-bold text-sm text-slate-900 break-all">{s.subCode}</div>
              <div className="min-w-0">
                <div className="text-[13px] text-slate-800">
                  {s.reads} · <span className="text-[12.5px]"><Effect s={s} lk={lk} /></span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {list.some(isWide) && (
                    <span className={`${chip} bg-blue-50 text-blue-700`}>
                      ใช้กับทุกรุ่น {list.filter(isWide).map((r) => r.scope).join(' · ')}
                    </span>
                  )}
                  {sheets.map((sh) => (
                    <button key={sh} type="button" onClick={() => onOpenSheet(sh)}
                            className="rounded-lg border border-[var(--brand-border)] bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand-fg)]">
                      {sheetLabel(sh)} →
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        {q.trim() && hits.length > 0 && (
          <p className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 text-[11.5px] text-slate-500">
            “{q.trim().toUpperCase()}” ตั้งไว้ใน {hitModels.size} รุ่น · {hits.length} ความหมาย
          </p>
        )}
      </Section>

      <Section
        testId="subcode-wide"
        title={<>ใช้กับหลายรุ่น <Count n={wide.length} /></>}
        hint="แถวที่ขอบเขตครอบหลายรุ่น (เช่น BH-0* = ทุกรุ่นของ BH) — แก้ที่นี่ที่เดียว ในหน้าชีตโชว์แบบอ่านอย่างเดียว · แก้ / เพิ่ม / ปิด มีผลทันที"
        action={<Button icon={Plus} onClick={() => setEditing({})}>เพิ่ม</Button>}
      >
        {wide.length === 0 ? (
          <p className="px-4 py-3 text-xs text-slate-400">ยังไม่มีแถวที่ใช้กับหลายรุ่น</p>
        ) : (
          <div className="px-4 py-1">
            {wide.map((m) => (
              <Row
                key={m.key} m={m} lk={lk} names={names} showModels mode={rowMode(m.row, false)}
                onEdit={() => setEditing({ row: m })}
                onToggle={() => void toggleRows(api, m)}
                onRemove={() => void removeRows(api, m, names)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section
        testId="subcode-unread"
        title={<>ยังอ่านไม่ออก{unread && <><Count n={unread.unread} /><span className="text-xs font-normal text-slate-400">จาก {unread.codes.toLocaleString('en-US')} รหัส</span></>}</>}
        hint="นับสดจากรหัสสินค้าจริงด้วยตัวอ่านรหัสปัจจุบัน แยกตามชีต — กดเพื่อไปตั้งค่าในชีตนั้น"
      >
        {unread === undefined && (
          <p className="px-4 py-3 text-xs text-slate-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังนับ…</p>
        )}
        {unread === null && <p className="px-4 py-3 text-xs text-slate-400">นับไม่สำเร็จ — ลองเปิดหน้านี้ใหม่</p>}
        {unread && (
          <div className="flex flex-wrap gap-1.5 px-4 py-3">
            {unread.sheets.filter((s) => s.unread > 0).sort((a, b) => b.unread - a.unread).map((s) => (
              <button
                key={s.sheet} type="button" onClick={() => onOpenSheet(s.sheet)}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full bg-card border border-slate-200 text-slate-700 hover:border-[var(--brand-border)] hover:text-[var(--brand-fg)]"
              >
                <b className="font-mono">{sheetLabel(s.sheet)}</b>
                <span className="text-[10.5px] text-slate-400 tabular-nums">{s.unread.toLocaleString('en-US')} รหัส</span>
              </button>
            ))}
            {unread.unread === 0 && <span className="text-xs text-slate-500">ทุกรหัสอ่านออกครบแล้ว</span>}
          </div>
        )}
      </Section>

      {editing && (
        <SubCodeModal
          token={api.token}
          subCode={editing.row?.row.subCode ?? ''}
          editing={editing.row?.row}
          modelCode={editing.row?.row.scope ?? models[0]?.code ?? '*'}
          models={models}
          code=""
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); api.onChanged(); }}
        />
      )}
    </>
  );
};
