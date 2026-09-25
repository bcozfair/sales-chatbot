import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, CircleDollarSign, Download, FileSpreadsheet, Info, Pencil, Plus, Tag, Undo2, Upload } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader } from '../PageHeader';
import { Button } from '../Button';
import { TableCard, TableScroll, EmptyState, ErrorBox } from '../logs/ui';
import { errMsg, formatDateTime } from '../logs/format';
import { SubCodeModal } from './SubCodeModal';
import { BookImportModal } from './BookImportModal';
import { ModelPriceEditor } from './ModelPriceEditor';
import { SheetEditor } from './SheetEditor';
import { EFFECT_TH, subCodePending, type ModelBrief, type Overview, type SubCode } from './types';

/**
 * หน้า "สมุดราคา" — ทุกอย่างที่ **แก้ราคา** ของโมดูลคิดราคาสินค้า
 *
 * เจ้าของสั่ง 2026-09-23 ให้แยกออกจากหน้า "คิดราคาสินค้า" เป็นเมนูพร้อมสิทธิ์ของตัวเอง
 * (`page.pricebook`) — "หน้าคิดราคาก็คือคิดราคาอย่างเดียว" · ของที่ย้ายมาจากหน้านั้นทั้งก้อน:
 * การ์ดเล่มที่ใช้อยู่ + ย้อนเล่ม · ดาวน์โหลด/อัปโหลดแม่แบบ · รายชื่อรุ่น + แก้ราคาทีละรุ่น ·
 * รหัสย่อยที่ตั้งไว้ · รายการที่ยังไม่ได้ตั้ง
 *
 * ⚠️ กติกาเดิมของโมดูลยังอยู่ครบ: **ไฟล์นี้ไม่ถือราคาไว้ใน state** — `/overview` ส่งมาแค่ชื่อรุ่น
 *   กับจำนวน ราคาเดินทางมาเฉพาะตอนเปิดหน้าแก้รุ่น (`ModelPriceEditor`) หรือตอนกดดาวน์โหลดแม่แบบ
 *
 * ตารางรุ่นเป็น **ตาราง ไม่ใช่ชิปเรียงต่อกัน** (เจ้าของเลือกแบบ A 2026-09-23 หลังเห็นชิปแล้วบอกว่ารก)
 * — ชิปยาวไม่เท่ากัน ชื่อรุ่นถูกตัด และรายชื่อรหัสที่ใช้ราคาเดียวกันไม่ตรงคอลัมน์
 *
 * **1 แถว = 1 ชีตของไฟล์ราคา** (เจ้าของสั่ง 2026-09-24: "1 ชีท / 1 สมุด") — ชีต `TS-01+TS-01-0`
 * มีสองรุ่นในสมุด แต่คนดูแลราคารู้จักมันเป็นหน้าเดียวในไฟล์ ⇒ รวมเป็นแถวเดียว
 * · ชีตที่ทุกรุ่นเป็น `excel` เปิดเป็น `SheetEditor` (ตารางหน้าตาแบบชีต) ทั้งชีต
 * · ชีตอื่นยังเปิด `ModelPriceEditor` ทีละรุ่นเหมือนเดิม (ชีต BH มีสองรุ่น ⇒ ปุ่มแยกรายรุ่น)
 *   จนกว่าจะย้ายมาแบบชีตทีละชีตตามที่เจ้าของสั่ง
 */

interface SheetGroup {
  sheet: string;
  models: ModelBrief[];
  /** ทุกรุ่นในชีตเปิดแบบ Excel ได้ */
  excel: boolean;
  products: number | null;
}

/** จัดรุ่นเป็นชีตตามลำดับในสมุด — รุ่นที่ไม่รู้ชีตเป็นชีตของตัวเอง */
function groupSheets(models: ModelBrief[]): SheetGroup[] {
  const map = new Map<string, ModelBrief[]>();
  for (const m of models) {
    const k = m.sheet || m.code;
    map.set(k, [...(map.get(k) ?? []), m]);
  }
  return [...map].map(([sheet, ms]) => ({
    sheet,
    models: ms,
    excel: ms.every((m) => m.excel),
    products: ms.every((m) => typeof m.products === 'number')
      ? ms.reduce((n, m) => n + (m.products ?? 0), 0)
      : null,
  }));
}

/** `Sheet1` ไม่บอกอะไรคนอ่าน — ชีตชื่อกลาง ๆ ใช้ชื่อรุ่นในชีตแทน */
const sheetName = (g: SheetGroup) =>
  /^Sheet\d+$/i.test(g.sheet) ? g.models.map((m) => m.name).join(' + ') : g.sheet;

/**
 * `TSJ-01, TST-01, TSP-01` → `TSJ/TST/TSP-01` — ชื่ออื่นของรุ่นเดียวกันลงท้ายเลขเดียวกันเกือบทุกตัว
 * ถ้าเขียนเต็มทุกตัว คอลัมน์นี้ยาวกว่าทั้งแถว · รายชื่อเต็มอยู่ใน `title` ของช่อง
 */
function compactCodes(codes: string[]): string {
  const groups = new Map<string, string[]>();
  for (const c of codes) {
    const i = c.indexOf('-');
    const [head, tail] = i < 0 ? [c, ''] : [c.slice(0, i), c.slice(i)];
    groups.set(tail, [...(groups.get(tail) ?? []), head]);
  }
  return [...groups].map(([tail, heads]) => `${heads.join('/')}${tail}`).join(' · ');
}

interface Props {
  /** คนนี้เปิดหน้า "คำนวณราคา" ได้ไหม (มาจากเมนูที่เขาเห็นจริง = ช่อง `page.pricing`)
   *  — สองสิทธิ์แยกกัน ⇒ คนแก้ราคาได้อาจเปิดหน้าคำนวณไม่ได้ ปุ่มต้องหายไปด้วย ไม่ใช่กดแล้วเจอหน้าที่ยิง API ไม่ผ่าน */
  canQuote: boolean;
  onOpenQuote: () => void;
}

export const PriceBook: React.FC<Props> = ({ canQuote, onOpenQuote }) => {
  const { token } = useAuth();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const jsonHeaders = useMemo(
    () => ({ ...authHeaders, 'Content-Type': 'application/json' }),
    [authHeaders],
  );

  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState<{ subCode: string; editing?: SubCode } | null>(null);
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  /** รหัสรุ่นที่กำลังแก้ราคาอยู่ — หน้าแก้กินทั้งจอ ไม่ใช่กล่องซ้อน เพราะมันคือจอทำงาน ไม่ใช่คำถามสั้น ๆ */
  const [editingModel, setEditingModel] = useState<string | null>(null);
  /** ชีตที่เปิดแบบ Excel อยู่ (`SheetEditor`) */
  const [editingSheet, setEditingSheet] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/pricebook/overview', { headers: authHeaders });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'โหลดข้อมูลไม่สำเร็จ');
      setOverview(await res.json());
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  }, [authHeaders]);

  /**
   * ดาวน์โหลดแม่แบบ — ต้องผ่าน `fetch` + blob ไม่ใช่ `<a href>` เพราะเส้นนี้อยู่หลัง
   * `adminAuthMiddleware` และเบราว์เซอร์ไม่แนบ Authorization ให้กับลิงก์ธรรมดา
   * (ลิงก์ที่ "ดาวน์โหลดได้โดยไม่ต้องล็อกอิน" คือสิ่งที่ทั้งโมดูลนี้มีไว้เพื่อกัน)
   */
  const downloadTemplate = useCallback(async () => {
    setDownloading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/pricebook/template', { headers: authHeaders });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'ดาวน์โหลดไม่สำเร็จ');
      const blob = await res.blob();
      // ชื่อไฟล์ภาษาไทยมากับ Content-Disposition (RFC 5987) — ถอดออกมาใช้ ไม่ใช่ตั้งชื่อเอง
      const cd = res.headers.get('Content-Disposition') ?? '';
      const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = star ? decodeURIComponent(star[1]) : 'pricebook.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setDownloading(false);
    }
  }, [authHeaders]);

  /** ย้อนไปเล่มก่อนหน้า — ถามก่อนเสมอ เพราะราคาทั้งระบบขยับทันทีที่กด */
  const rollback = useCallback(async () => {
    const backup = overview?.shelf?.backups[0];
    if (!backup) return;
    const when = backup.at ? formatDateTime(backup.at) : backup.name;
    if (!window.confirm(`ย้อนสมุดราคากลับไปเล่มของ ${when} ?\nราคาที่ระบบคิดจะเปลี่ยนทันที (เล่มที่ใช้อยู่ตอนนี้จะถูกเก็บไว้ให้ย้อนกลับมาได้)`)) return;
    setRollingBack(true);
    setError('');
    try {
      const res = await fetch('/api/admin/pricebook/rollback', {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: backup.name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'ย้อนกลับไม่สำเร็จ');
      await loadOverview();
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setRollingBack(false);
    }
  }, [overview, jsonHeaders, loadOverview]);

  // โหลดครั้งแรก — หุ้ม setTimeout ตามท่าของทั้งแอป (eslint ปฏิเสธ setState ตรง ๆ ใน useEffect)
  useEffect(() => {
    const t = setTimeout(() => { void loadOverview(); }, 0);
    return () => clearTimeout(t);
  }, [loadOverview]);

  /** ของที่ตั้งเอง (ตาราง) มาก่อนของที่ติดมากับไฟล์ราคา — ลำดับเดียวกับที่ engine ใช้ตัดสิน */
  const allSet = useMemo(
    () => [...(overview?.subCodes ?? []), ...(overview?.fromPriceFile ?? [])],
    [overview],
  );

  /** รหัสย่อยที่ยังไม่มีใครตั้ง เรียงตามจำนวนรหัสจริงที่มีตัวอักษรนั้น — ไล่เก็บจากบนลงล่างได้ */
  const todo = useMemo(() => {
    const set = new Set(allSet.map((s) => s.subCode.toUpperCase()));
    return (overview?.census?.items ?? [])
      .filter((it) => !set.has(it.token.toUpperCase()))
      .slice(0, 16);
  }, [allSet, overview]);

  const models = useMemo(() => overview?.models ?? [], [overview]);
  const sheets = useMemo(() => groupSheets(models), [models]);
  const covered = models.reduce((n, m) => n + (m.products ?? 0), 0);
  const counted = models.some((m) => typeof m.products === 'number');
  /** กดแถว: ชีตแบบ Excel → เปิดทั้งชีต · ชีตรุ่นเดียว → หน้าแก้รุ่น · ชีตหลายรุ่นแบบเดิม → ต้องกดปุ่มรายรุ่น */
  const openRow = (g: SheetGroup) => {
    if (g.excel) setEditingSheet(g.sheet);
    else if (g.models.length === 1) setEditingModel(g.models[0]!.code);
  };

  async function removeSub(row: SubCode) {
    if (!row.id) return;
    if (!window.confirm(`ลบรหัสย่อย ${row.subCode} ของ ${row.scope} ?`)) return;
    await fetch(`/api/admin/pricebook/subcodes/${row.id}`, { method: 'DELETE', headers: authHeaders });
    await loadOverview();
  }

  async function toggleSub(row: SubCode) {
    if (!row.id) return;
    await fetch(`/api/admin/pricebook/subcodes/${row.id}`, {
      method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ ...row, disabled: !row.disabled }),
    });
    await loadOverview();
  }

  const bookMissing = overview && !overview.book.ok;

  if (editingSheet) {
    return (
      <SheetEditor
        sheet={editingSheet}
        products={Object.fromEntries(models.map((m) => [m.code, m.products]))}
        authHeaders={authHeaders}
        onBack={(wasSaved) => {
          setEditingSheet(null);
          if (wasSaved) void loadOverview();
        }}
      />
    );
  }

  if (editingModel) {
    return (
      <ModelPriceEditor
        code={editingModel}
        authHeaders={authHeaders}
        onBack={(wasSaved) => {
          setEditingModel(null);
          if (wasSaved) void loadOverview();
        }}
      />
    );
  }

  return (
    <div className="space-y-3.5">
      <PageHeader
        icon={BookOpen}
        title="สมุดราคา"
        description="ราคาตั้งของสินค้าสั่งทำ — หน้าคำนวณราคาคิดจากเล่มนี้"
      >
        {/* จอแคบใช้คำสั้น — แถบบนเป็นที่ร่วมกับชื่อหน้า สองปุ่มคำเต็มเบียดจนชื่อหน้าเหลือตัวเดียว
            (ไม่ใช้ปุ่มไอคอนล้วน เพราะ ↓ กับ ↑ สองตัวติดกันแยกไม่ออกว่าอันไหนเข้าอันไหนออก) */}
        {/* คู่กับปุ่ม "แก้ราคาในสมุดราคา" บนหน้าคำนวณราคา (เจ้าของสั่ง 2026-09-24) — แก้ราคาแล้วไปลองคิดได้ทันที
            จอแคบเหลือไอคอนล้วน: สามปุ่มมีคำเบียดชื่อหน้าเหลือ "ส" ตัวเดียว (วัดที่ 390px) · ไอคอน $
            ไม่มีคู่ที่หน้าตาเหมือนกันให้สับสนแบบ ↓/↑ และเป็นไอคอนเดียวกับเมนู */}
        {canQuote && (
          <Button icon={CircleDollarSign} onClick={onOpenQuote} aria-label="คำนวณราคา" title="คำนวณราคา">
            <span className="hidden sm:inline">คำนวณราคา</span>
          </Button>
        )}
        <Button icon={Download} busy={downloading} onClick={() => void downloadTemplate()}>
          <span className="sm:hidden">แม่แบบ</span>
          <span className="hidden sm:inline">ดาวน์โหลดแม่แบบราคา</span>
        </Button>
        <Button variant="primary" icon={Upload} onClick={() => setImporting(true)}>
          <span className="sm:hidden">อัปโหลด</span>
          <span className="hidden sm:inline">อัปโหลดราคาใหม่</span>
        </Button>
      </PageHeader>

      {bookMissing && <ErrorBox message={overview.book.message ?? 'ยังไม่มีสมุดราคาในเครื่องนี้'} />}
      {error && <ErrorBox message={error} onRetry={() => { setError(''); void loadOverview(); }} />}

      {/* ── สมุดราคาที่ระบบใช้อยู่ ───────────────────────────────────────
          มีเพราะเจ้าของเคาะว่า "ไฟล์ที่อัปผ่านจอเป็นตัวจริง" (2026-09-21)
          ⇒ ต้องตอบได้ตลอดเวลาว่าราคาที่ระบบคิดอยู่มาจากไฟล์ไหน ใครอัป เมื่อไหร่
          และต้องมีทางถอย เพราะไม่มี CLI ให้ใครไปรันซ้ำบนเซิร์ฟเวอร์อีกแล้ว */}
      {overview?.shelf && (
        <div className="bg-card border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-900">สมุดราคาที่ระบบใช้อยู่</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">ราคาทุกบาทในหน้าคำนวณราคาคิดจากเล่มนี้</p>
          </div>
          <div className="px-5 py-3.5 flex gap-4 items-start flex-wrap">
            <div className="flex gap-6 flex-wrap flex-1 min-w-[220px]">
              <Fact k="รุ่นที่มีราคา" v={`${overview.book.models ?? 0}`} sub={`รุ่น / ${overview.shelf.sheets} ชีต`} />
              <Fact k="ช่องราคา" v={overview.shelf.cells.toLocaleString('th-TH')} sub="ช่อง" />
              <Fact
                k="แก้ล่าสุด"
                v={overview.shelf.edited ? formatDateTime(overview.shelf.edited.at) : (overview.version ?? '—')}
                sub={overview.shelf.edited?.by ? `· ${overview.shelf.edited.by}` : 'จากไฟล์ Excel ต้นทาง'}
              />
              {overview.shelf.edited?.note && (
                <Fact k="จากไฟล์" v="" sub={overview.shelf.edited.note} mono />
              )}
            </div>
            <div className="flex flex-col gap-1.5 items-end">
              <Button
                icon={Undo2}
                busy={rollingBack}
                disabled={overview.shelf.backups.length === 0}
                onClick={() => void rollback()}
              >
                ย้อนไปเล่มก่อนหน้า
              </Button>
              <span className="text-[11px] text-slate-400">
                {overview.shelf.backups.length === 0
                  ? 'ยังไม่มีเล่มเก่าให้ย้อน'
                  : `เก็บย้อนหลังไว้ ${overview.shelf.keep} เล่ม (มีอยู่ ${overview.shelf.backups.length})`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── ชีตในสมุดราคา + ทางเข้าหน้าแก้ราคา ─────────────────────────
          1 แถว = 1 ชีตของไฟล์ราคา (เจ้าของสั่ง 2026-09-24 "1 ชีท / 1 สมุด") */}
      {sheets.length > 0 && (
        <TableCard
          title="ชีตในสมุดราคา"
          hint={`${sheets.length} ชีต · ${models.length} รุ่น${counted ? ` · ครอบสินค้า ${covered.toLocaleString('th-TH')} รายการ` : ''} · ชีตที่มีป้าย “แบบ Excel” เปิดเป็นตารางหน้าตาเหมือนในไฟล์`}
        >
          <TableScroll>
            <table className="w-full text-xs hidden sm:table">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="px-4 py-2 font-semibold">ชีต</th>
                  <th className="px-4 py-2 font-semibold">รุ่นในชีต</th>
                  <th className="px-4 py-2 font-semibold">ใช้ราคาเดียวกัน</th>
                  <th className="px-4 py-2 font-semibold text-right" title="จำนวนสินค้าในฐานที่หัวรหัสตกรุ่นในชีตนี้ — แก้ราคาชีตนี้แล้วกระทบรายการเหล่านี้">
                    สินค้าที่ครอบ
                  </th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {sheets.map((g) => {
                  const clickable = g.excel || g.models.length === 1;
                  return (
                    <tr key={g.sheet}
                        onClick={clickable ? () => openRow(g) : undefined}
                        className={`group border-b border-slate-50 align-top ${clickable ? 'cursor-pointer hover:bg-slate-50' : ''}`}>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="font-mono font-bold text-slate-900">{sheetName(g)}</span>
                        {g.excel && <ExcelBadge />}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {g.models.map((m) => (
                          <div key={m.code} className="leading-5">
                            <span className="font-mono font-semibold text-slate-900">{m.name}</span>
                            <span className="text-slate-500"> — {m.label}</span>
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">
                        {g.models.map((m) => (
                          <div key={m.code} className="leading-5 whitespace-nowrap" title={m.others.join(', ')}>
                            {m.others.length > 0 ? compactCodes(m.others) : <span className="text-slate-300">—</span>}
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 whitespace-nowrap">
                        <Count n={g.products} />
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {/* ปุ่มจริงไว้ให้คีย์บอร์ด/โปรแกรมอ่านจอ — คลิกทั้งแถวเป็นแค่ทางลัดของเมาส์ */}
                        {clickable ? (
                          <Button
                            icon={g.excel ? FileSpreadsheet : Pencil}
                            aria-label={`แก้ราคา ${sheetName(g)}`}
                            onClick={(e) => { e.stopPropagation(); openRow(g); }}
                            className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            {g.excel ? 'เปิดชีต' : 'แก้ราคา'}
                          </Button>
                        ) : (
                          <span className="inline-flex flex-col items-end gap-1">
                            {g.models.map((m) => (
                              <Button key={m.code} icon={Pencil} onClick={() => setEditingModel(m.code)}>
                                แก้ {m.name}
                              </Button>
                            ))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>

          {/* ตารางหลายคอลัมน์บนมือถือ = การ์ด ไม่ใช่ตารางที่เล็กลง (docs/design.md §3) */}
          <div className="sm:hidden p-3 space-y-2.5">
            {sheets.map((g) => (
              <div key={g.sheet} className="rounded-xl border border-slate-200 bg-card px-3.5 py-3">
                <div className="flex gap-2 items-baseline justify-between">
                  <span className="font-mono font-bold text-[13px] text-slate-900">
                    {sheetName(g)}{g.excel && <ExcelBadge />}
                  </span>
                  <span className="text-[11px] text-slate-500 tabular-nums"><Count n={g.products} /> รายการ</span>
                </div>
                {g.models.map((m) => (
                  <div key={m.code} className="mt-1.5">
                    <div className="text-xs text-slate-700">
                      <span className="font-mono font-semibold text-slate-900">{m.name}</span> — {m.label}
                    </div>
                    {m.others.length > 0 && (
                      <div className="text-[11px] text-slate-400">ใช้ราคาเดียวกัน: <span className="font-mono">{compactCodes(m.others)}</span></div>
                    )}
                  </div>
                ))}
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {g.excel || g.models.length === 1 ? (
                    <Button icon={g.excel ? FileSpreadsheet : Pencil} onClick={() => openRow(g)}>
                      {g.excel ? 'เปิดชีต' : 'แก้ราคา'}
                    </Button>
                  ) : (
                    g.models.map((m) => (
                      <Button key={m.code} icon={Pencil} onClick={() => setEditingModel(m.code)}>แก้ {m.name}</Button>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </TableCard>
      )}

      {importing && (
        <BookImportModal
          authHeaders={authHeaders}
          onClose={(saved) => {
            setImporting(false);
            if (saved) void loadOverview();
          }}
        />
      )}

      {/* ── รหัสย่อยที่ตั้งค่าไว้ ───────────────────────────────────────── */}
      <TableCard title="รหัสย่อยที่ตั้งค่าไว้" hint={`${allSet.length} ตัว`}>
        {allSet.length === 0 ? (
          <EmptyState icon={Tag} title="ยังไม่มีรหัสย่อยที่ตั้งไว้" hint="กดตัวอักษรในรายการ “ยังไม่ได้ตั้งค่า” ข้างล่าง หรือกด ＋ เพิ่ม จากหน้าคำนวณราคา" />
        ) : (
          <>
            {/* ตารางเต็มบนจอกว้าง */}
            <TableScroll>
              <table className="w-full text-xs hidden sm:table">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-2 font-semibold">รหัสย่อย</th>
                    <th className="px-4 py-2 font-semibold">อ่านว่า</th>
                    <th className="px-4 py-2 font-semibold">ผลกับราคา</th>
                    <th className="px-4 py-2 font-semibold">ใช้กับรุ่น</th>
                    <th className="px-4 py-2 font-semibold">ที่มา</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {allSet.map((s) => (
                    <tr key={`${s.subCode}-${s.scope}`} className={`border-b border-slate-50 ${s.disabled ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-2.5 font-mono font-bold text-slate-900">{s.subCode}</td>
                      <td className="px-4 py-2.5 text-slate-700">{s.reads || <span className="text-slate-400">—</span>}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {EFFECT_TH[s.effect]}
                        {s.amount !== undefined && ` ${s.amount.toLocaleString()} บาท`}
                        {s.percent !== undefined && ` ${s.percent}%`}
                        {s.effect === 'setAxis' && s.value && ` → ${s.value}`}
                        {subCodePending(s) && <PendingPill />}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">{s.scope}</td>
                      <td className="px-4 py-2.5 text-slate-500">
                        {s.source ? `ไฟล์ราคา · ${s.source}` : `ตั้งค่าเอง${s.by ? ` · ${s.by}` : ''}${s.at ? ` · ${s.at}` : ''}`}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {s.id ? (
                          <span className="inline-flex gap-1.5">
                            <Button onClick={() => setAdding({ subCode: s.subCode, editing: s })}>แก้</Button>
                            <Button onClick={() => void toggleSub(s)}>{s.disabled ? 'เปิด' : 'ปิดไว้'}</Button>
                            <Button variant="danger" tone="soft" onClick={() => void removeSub(s)}>ลบ</Button>
                          </span>
                        ) : (
                          <span className="text-slate-400">มาจากไฟล์ราคา</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>

            <div className="sm:hidden p-3 space-y-2.5">
              {allSet.map((s) => (
                <div key={`${s.subCode}-${s.scope}`}
                     className={`rounded-xl border border-slate-200 bg-card px-3.5 py-3 ${s.disabled ? 'opacity-50' : ''}`}>
                  <div className="flex gap-2 items-center flex-wrap">
                    <span className="font-mono font-bold text-[13px] text-slate-900">{s.subCode}</span>
                    <span className="text-[11px] text-slate-600">{EFFECT_TH[s.effect]}</span>
                    {subCodePending(s) && <PendingPill />}
                    <span className="text-[11px] text-slate-400">ใช้กับ <span className="font-mono">{s.scope}</span></span>
                  </div>
                  <div className="text-xs text-slate-700 mt-1.5">{s.reads || '—'}</div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    {s.source ? `ไฟล์ราคา · ${s.source}` : `ตั้งค่าเอง${s.by ? ` · ${s.by}` : ''}`}
                  </div>
                  {s.id && (
                    <div className="flex gap-1.5 mt-2.5">
                      <Button onClick={() => setAdding({ subCode: s.subCode, editing: s })}>แก้</Button>
                      <Button onClick={() => void toggleSub(s)}>{s.disabled ? 'เปิด' : 'ปิดไว้'}</Button>
                      <Button variant="danger" tone="soft" onClick={() => void removeSub(s)}>ลบ</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </TableCard>

      {/* ── ยังไม่ได้ตั้งค่า ──────────────────────────────────────────── */}
      {todo.length > 0 && (
        <TableCard title="ยังไม่ได้ตั้งค่า" hint="เรียงตามจำนวนรหัสจริงที่มีตัวอักษรนั้น">
          <div className="px-4 py-3.5">
            <div className="flex flex-wrap gap-1.5">
              {todo.map((it) => (
                <button key={`${it.token}-${it.where}`}
                        onClick={() => setAdding({ subCode: it.token })}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full bg-card border border-slate-200 text-slate-700 hover:border-[var(--brand-border)] hover:text-[var(--brand-fg)]">
                  <Plus className="w-3 h-3" />
                  <b className="font-mono">{it.token}</b>
                  <span className="text-[10.5px] text-slate-400 tabular-nums">{it.count.toLocaleString()} รหัส</span>
                </button>
              ))}
            </div>
            {overview?.census && (
              <div className="flex gap-2.5 rounded-xl px-3.5 py-2.5 mt-3 text-xs leading-relaxed bg-blue-50 border border-blue-200 text-blue-700">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  นับจากรหัสจริง <b className="tabular-nums">{overview.census.totalCodes.toLocaleString()}</b> รหัส
                  ในฐานสินค้า ({overview.census.measuredAt}) — ตัวที่ต่างกันแค่ตัวเลข
                  (<span className="font-mono">S000 S001 S002…</span>) ตั้งเป็น <b>แม่แบบตัวเดียว</b> ได้ทั้งชุด
                </span>
              </div>
            )}
          </div>
        </TableCard>
      )}

      {adding && (
        <SubCodeModal
          token={token ?? ''}
          subCode={adding.subCode}
          editing={adding.editing}
          modelCode={adding.editing?.scope ?? models[0]?.code ?? '*'}
          models={models}
          // หน้านี้ไม่มีช่องพิมพ์รหัส ⇒ ไม่มีพรีวิวราคา (พรีวิวอยู่ที่ปุ่ม ＋ เพิ่ม ในหน้าคิดราคาสินค้า)
          code=""
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            void loadOverview();
          }}
        />
      )}
    </div>
  );
};

/** จำนวนสินค้าที่ครอบ — `null` = นับไม่สำเร็จ (ฐานสินค้าตอบช้า) ไม่ใช่ศูนย์ */
const Count: React.FC<{ n: number | null }> = ({ n }) =>
  typeof n === 'number'
    ? <>{n.toLocaleString('th-TH')}</>
    : <span className="text-slate-300" title="นับไม่สำเร็จ — ลองเปิดหน้านี้ใหม่">—</span>;

/** รหัสย่อยที่รู้ความหมายแล้วแต่ช่องราคา/ค่าที่เทียบยังว่าง — หน้าคิดราคาขึ้น "ยังไม่มีราคา" จนกว่าจะกรอก */
const PendingPill: React.FC = () => (
  <span className="ml-1.5 inline-block whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 align-middle text-[10.5px] font-medium text-amber-700">
    ยังไม่มีราคา
  </span>
);

/** ป้าย "แบบ Excel" — ชีตนี้เปิดเป็นตารางหน้าตาเหมือนในไฟล์ราคา */
const ExcelBadge: React.FC = () => (
  <span className="ml-2 rounded px-1.5 py-0.5 align-middle font-sans text-[10px] font-bold"
        style={{ background: 'var(--brand-soft)', color: 'var(--brand-fg)' }}>
    แบบ Excel
  </span>
);

/** ช่องข้อเท็จจริงหนึ่งช่องบนการ์ดสมุดราคา — ประกาศนอกคอมโพเนนต์ (eslint: static-components) */
const Fact: React.FC<{ k: string; v: string; sub?: string; mono?: boolean }> = ({ k, v, sub, mono }) => (
  <div>
    <span className="block text-[10.5px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">{k}</span>
    <span className="block text-[15px] font-bold text-slate-900">
      {v}
      {sub && <small className={`ml-1 text-[11.5px] font-normal text-slate-500 ${mono ? 'font-mono' : ''}`}>{sub}</small>}
    </span>
  </div>
);
