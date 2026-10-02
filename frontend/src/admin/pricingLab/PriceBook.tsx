import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, CircleDollarSign, Download, FileSpreadsheet, Undo2, Upload } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader } from '../PageHeader';
import { Button } from '../Button';
import { TableCard, TableScroll, ErrorBox } from '../logs/ui';
import { errMsg, formatDateTime, theadRowCls, thBaseCls } from '../logs/format';
import { BookImportModal } from './BookImportModal';
import { ModelPriceEditor } from './ModelPriceEditor';
import { SheetEditor } from './SheetEditor';
import { SheetSubCodes, SubCodeHome } from './SubCodePanels';
import type { ModelBrief, Overview, UnreadSummary } from './types';

/**
 * หน้า "สมุดราคา" — ทุกอย่างที่ **แก้ราคา** ของโมดูลคิดราคาสินค้า
 *
 * เจ้าของสั่ง 2026-09-23 ให้แยกออกจากหน้า "คิดราคาสินค้า" เป็นเมนูพร้อมสิทธิ์ของตัวเอง
 * (`page.pricebook`) — "หน้าคิดราคาก็คือคิดราคาอย่างเดียว" · ของที่ย้ายมาจากหน้านั้นทั้งก้อน:
 * การ์ดเล่มที่ใช้อยู่ + ย้อนเล่ม · ดาวน์โหลด/อัปโหลดแม่แบบ · รายชื่อรุ่น + แก้ราคาทีละรุ่น ·
 * รหัสย่อยที่ตั้งไว้ · รายการที่ยังไม่ได้ตั้ง
 *
 * **รหัสย่อยย้ายไปอยู่ในหน้าชีตแล้ว** (เจ้าของเคาะ 2026-09-29 — ตารางใหญ่หน้าแรก "ดูซ้ำกันหลายรุ่น") ⇒ หน้านี้เหลือ
 * ค้น "ตัวอักษรนี้ใช้ที่ไหน" · แถวขอบเขตหลายรุ่น · สรุป "ยังอ่านไม่ออก" ต่อชีต (`SubCodePanels.tsx`)
 * รายการ "ยังไม่ได้ตั้งค่า" เดิม (census นับครั้งเดียว 2026-09-18) ถูกแทนด้วยตัวนับสด `GET /unread`
 *
 * ⚠️ กติกาเดิมของโมดูลยังอยู่ครบ: **ไฟล์นี้ไม่ถือราคาไว้ใน state** — `/overview` ส่งมาแค่ชื่อรุ่น
 *   กับจำนวน ราคาเดินทางมาเฉพาะตอนเปิดหน้าแก้รุ่น (`ModelPriceEditor`) หรือตอนกดดาวน์โหลดแม่แบบ
 *
 * ตารางรุ่นเป็น **ตาราง ไม่ใช่ชิปเรียงต่อกัน** (เจ้าของเลือกแบบ A 2026-09-23 หลังเห็นชิปแล้วบอกว่ารก)
 * — ชิปยาวไม่เท่ากัน ชื่อรุ่นถูกตัด และรายชื่อรหัสที่ใช้ราคาเดียวกันไม่ตรงคอลัมน์
 *
 * **1 แถว = 1 ชีตของไฟล์ราคา** (เจ้าของสั่ง 2026-09-24: "1 ชีท / 1 สมุด") — ชีต `TS-01+TS-01-0`
 * มีสองรุ่นในสมุด แต่คนดูแลราคารู้จักมันเป็นหน้าเดียวในไฟล์ ⇒ รวมเป็นแถวเดียว
 * · **ทุกชีตเปิดเป็น `SheetEditor`** (ตารางหน้าตาแบบชีต · เจ้าของสั่ง 2026-09-28 "ให้เป็นสไตล์ excel ทั้งหมด")
 * · `ModelPriceEditor` (เพิ่ม/ลบกฎ · เงื่อนไข · สวิตช์ข้อจำกัด · หัวท้ายช่วงขนาด) เข้าจากปุ่ม "กฎและเงื่อนไข"
 *   ของแต่ละตารางในหน้าชีตเท่านั้น — กด "กลับ" แล้วกลับมาหน้าชีตเดิม (เจ้าของเคาะข้อ 1–2 ของ mockup)
 */

interface SheetGroup {
  sheet: string;
  models: ModelBrief[];
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
  /** มาจากปุ่ม "ต้องขอราคา" ของหน้าคำนวณราคา — เปิดชีตนี้เลยแล้วเลื่อนไปที่กล่องขอราคาของรุ่น */
  openAt?: { sheet: string; model: string } | null;
}

export const PriceBook: React.FC<Props> = ({ canQuote, onOpenQuote, openAt }) => {
  const { token } = useAuth();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const jsonHeaders = useMemo(
    () => ({ ...authHeaders, 'Content-Type': 'application/json' }),
    [authHeaders],
  );

  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  /** ตัวนับ "ยังอ่านไม่ออก" — `undefined` = กำลังนับ · `null` = นับไม่สำเร็จ (ซ่อนตัวเลข ไม่ใช่ error ทั้งหน้า) */
  const [unread, setUnread] = useState<UnreadSummary | null | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  /** รหัสรุ่นที่กำลังแก้ราคาอยู่ — หน้าแก้กินทั้งจอ ไม่ใช่กล่องซ้อน เพราะมันคือจอทำงาน ไม่ใช่คำถามสั้น ๆ */
  const [editingModel, setEditingModel] = useState<string | null>(null);
  /** ชีตที่เปิดแบบ Excel อยู่ (`SheetEditor`) */
  const [editingSheet, setEditingSheet] = useState<string | null>(openAt?.sheet ?? null);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/pricebook/overview', { headers: authHeaders });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'โหลดข้อมูลไม่สำเร็จ');
      setOverview(await res.json());
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  }, [authHeaders]);

  /** นับสดที่เซิร์ฟเวอร์ (~2 วินาทีรอบแรกหลังเล่ม/รหัสย่อยเปลี่ยน) — แยกจาก overview เพื่อไม่ให้หน้าแรกรอ */
  const loadUnread = useCallback(async () => {
    setUnread(undefined);
    try {
      const res = await fetch('/api/admin/pricebook/unread', { headers: authHeaders });
      setUnread(res.ok ? ((await res.json())?.summary ?? null) : null);
    } catch {
      setUnread(null);
    }
  }, [authHeaders]);

  /** แถวรหัสย่อยเปลี่ยน (มีผลทันที) — รายการกับตัวนับต้องตามทัน */
  const subCodesChanged = useCallback(() => {
    void loadOverview();
    void loadUnread();
  }, [loadOverview, loadUnread]);

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
      if (!res.ok) throw new Error((await res.json())?.error ?? 'ส่งออกไม่สำเร็จ');
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
    const t = setTimeout(() => { void loadOverview(); void loadUnread(); }, 0);
    return () => clearTimeout(t);
  }, [loadOverview, loadUnread]);

  /** ของที่ตั้งเอง (ตาราง) มาก่อนของที่ติดมากับไฟล์ราคา — ลำดับเดียวกับที่ engine ใช้ตัดสิน */
  const allSet = useMemo(
    () => [...(overview?.subCodes ?? []), ...(overview?.fromPriceFile ?? [])],
    [overview],
  );
  const axisLabels = useMemo(() => overview?.axisLabels ?? {}, [overview]);

  const models = useMemo(() => overview?.models ?? [], [overview]);
  const sheets = useMemo(() => groupSheets(models), [models]);
  const covered = models.reduce((n, m) => n + (m.products ?? 0), 0);
  const counted = models.some((m) => typeof m.products === 'number');
  const openRow = (g: SheetGroup) => setEditingSheet(g.sheet);
  const labelOfSheet = (sheet: string) => {
    const g = sheets.find((x) => x.sheet === sheet);
    return g ? sheetName(g) : sheet;
  };

  const bookMissing = overview && !overview.book.ok;

  if (editingModel) {
    return (
      <ModelPriceEditor
        code={editingModel}
        authHeaders={authHeaders}
        onBack={(wasSaved) => {
          // กลับไปหน้าชีตที่เปิดค้างไว้ (ถ้ามี) — หน้าชีตโหลดใหม่เอง จึงเห็นกฎที่เพิ่งแก้
          setEditingModel(null);
          if (wasSaved) void loadOverview();
        }}
      />
    );
  }

  if (editingSheet) {
    const codes = sheets.find((g) => g.sheet === editingSheet)?.models.map((m) => m.code) ?? [];
    const sheetUnread = unread === undefined ? undefined : unread === null ? null : (unread.sheets.find((s) => s.sheet === editingSheet) ?? null);
    return (
      <SheetEditor
        sheet={editingSheet}
        askFound={sheetUnread === undefined ? undefined : sheetUnread?.askPrice ?? null}
        focusAsk={openAt?.sheet === editingSheet ? openAt.model : null}
        products={Object.fromEntries(models.map((m) => [m.code, m.products]))}
        authHeaders={authHeaders}
        onAdvanced={setEditingModel}
        onBack={(wasSaved) => {
          setEditingSheet(null);
          // ราคาในตารางเปลี่ยน = ตัวอ่านรหัสอาจอ่านขนาดใหม่ออก ⇒ นับใหม่ด้วย
          if (wasSaved) subCodesChanged();
        }}
      >
        <SheetSubCodes
          sheet={editingSheet}
          codes={codes}
          rows={allSet}
          models={models}
          axisLabels={axisLabels}
          unread={sheetUnread}
          token={token ?? ''}
          authHeaders={authHeaders}
          onChanged={subCodesChanged}
        />
      </SheetEditor>
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
          <span className="hidden sm:inline">ส่งออกแม่แบบราคา</span>
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
          hint={`${sheets.length} ชีต · ${models.length} รุ่น${counted ? ` · ครอบสินค้า ${covered.toLocaleString('th-TH')} รายการ` : ''} · ทุกชีตเปิดเป็นตารางหน้าตาเหมือนในไฟล์ Excel`}
        >
          <TableScroll>
            <table className="w-full text-xs hidden sm:table">
              <thead>
                <tr className={theadRowCls}>
                  <th className={`${thBaseCls} px-4 py-3`}>ชีต</th>
                  <th className={`${thBaseCls} px-4 py-3`}>รุ่นในชีต</th>
                  <th className={`${thBaseCls} px-4 py-3`}>ใช้ราคาเดียวกัน</th>
                  <th className={`${thBaseCls} px-4 py-3 text-right`} title="จำนวนสินค้าในฐานที่หัวรหัสตกรุ่นในชีตนี้ — แก้ราคาชีตนี้แล้วกระทบรายการเหล่านี้">
                    สินค้าที่ครอบ
                  </th>
                  <th className={`${thBaseCls} px-4 py-3 text-right`}>การจัดการ</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((g) => {
                  return (
                    <tr key={g.sheet}
                        onClick={() => openRow(g)}
                        className="group border-b border-slate-50 align-top cursor-pointer hover:bg-slate-50">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="font-mono font-bold text-slate-900">{sheetName(g)}</span>
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
                        <Button
                          icon={FileSpreadsheet}
                          aria-label={`แก้ราคา ${sheetName(g)}`}
                          data-sheet={g.sheet}
                          onClick={(e) => { e.stopPropagation(); openRow(g); }}
                          className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          เปิดชีต
                        </Button>
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
                    {sheetName(g)}
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
                  <Button icon={FileSpreadsheet} aria-label={`แก้ราคา ${sheetName(g)}`} data-sheet={g.sheet} onClick={() => openRow(g)}>เปิดชีต</Button>
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

      {/* ── รหัสย่อย — ย้ายไปหน้าชีตแล้ว หน้าแรกเหลือค้น · แถวหลายรุ่น · สรุปที่อ่านไม่ออก ── */}
      {overview && (
        <SubCodeHome
          rows={allSet}
          models={models}
          axisLabels={axisLabels}
          unread={unread}
          sheetLabel={labelOfSheet}
          onOpenSheet={setEditingSheet}
          token={token ?? ''}
          authHeaders={authHeaders}
          onChanged={subCodesChanged}
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
