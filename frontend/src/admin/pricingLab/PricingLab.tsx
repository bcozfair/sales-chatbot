import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, CircleDollarSign, AlertTriangle, Download, Info, Pencil, Plus, Tag, Undo2, Upload } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader } from '../PageHeader';
import { Button } from '../Button';
import { TableCard, TableScroll, EmptyState, ErrorBox } from '../logs/ui';
import { errMsg, formatDateTime } from '../logs/format';
import { SubCodeModal } from './SubCodeModal';
import { BookImportModal } from './BookImportModal';
import { ModelPriceEditor } from './ModelPriceEditor';
import { EFFECT_TH, type Overview, type ParsedCode, type PriceOutcome, type SubCode } from './types';

/**
 * หน้า "คิดราคาสินค้า" — โมดูลทดลองที่ถอดออกได้ทั้งก้อน
 *
 * เจ้าของสั่ง 2026-09-18 · เคาะหน้าตาจาก mockup/pl-pricing.html วันเดียวกัน
 * **เฟสแรกยังไม่ต่อกับใบเสนอราคา — คิดราคาให้ดูอย่างเดียว**
 *
 * ⚠️ **สมุดราคาไม่เคยมาถึงไฟล์นี้** และต้องเป็นแบบนั้นตลอดไป — หน้าแอดมินเป็นไฟล์สาธารณะ
 *   (`express.static` ที่ `public/`) การล็อกอินเกิดในเบราว์เซอร์แล้วค่อยเอา token ไปยิง API
 *   ⇒ อะไรที่ build รวมมากับหน้าจอ หรือถูกส่งมาทาง API แล้วเก็บไว้ทั้งก้อน คือของที่หลุดได้
 *   หน้านี้จึงส่ง "รหัสที่พิมพ์" ไปให้เซิร์ฟเวอร์คิด แล้วรับกลับมาเฉพาะผลของรหัสนั้น
 *   ห้ามเพิ่มการโหลดตารางราคาลงมาคิดฝั่งเบราว์เซอร์ไม่ว่าจะเร็วกว่าแค่ไหน
 *
 * ทำไมปุ่ม "＋ เพิ่ม <รหัสย่อย>" อยู่ในแถวของตัวที่อ่านไม่ออก ไม่ใช่ในเมนูตั้งค่า:
 *   คนที่รู้ว่า `S000` แปลว่าอะไร คือคนที่กำลังออกใบอยู่ตอนนั้น ถ้าต้องจำไว้ไปแก้ทีหลัง
 *   มันจะไม่ถูกแก้ · และปุ่มเขียนตัวอักษรจริงลงไป ไม่ใช่คำว่า "อันนี้" เพราะบรรทัดเดียว
 *   มีตัวที่อ่านไม่ออกได้หลายตัว ถ้าทุกปุ่มเขียนเหมือนกันหมด คนกดต้องไล่สายตาหาว่าปุ่มไหนของตัวไหน
 */

const HELP = 'ตัวอย่างในชีต — กดเพื่อลอง';
const EXAMPLES = ['TSK-14 6x200+150-BU', 'TSJ-04(S8) 6x100+1M', 'BH-01C-600x150-380-4950W'];

interface QuoteResult {
  parsed: ParsedCode;
  outcome: PriceOutcome | null;
}

/** ท่อนที่ยังไม่มีใครบอกว่าแปลว่าอะไร — ตัวเดียวที่ได้ปุ่ม "＋ เพิ่ม" */
const isUnknown = (kind: string) => kind === 'unknown';

export const PricingLab: React.FC = () => {
  const { token } = useAuth();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const jsonHeaders = useMemo(
    () => ({ ...authHeaders, 'Content-Type': 'application/json' }),
    [authHeaders],
  );

  const [overview, setOverview] = useState<Overview | null>(null);
  const [code, setCode] = useState(EXAMPLES[0]);
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState<{ subCode: string; editing?: SubCode } | null>(null);
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  /** รหัสรุ่นที่กำลังแก้ราคาอยู่ — หน้าแก้กินทั้งจอ ไม่ใช่กล่องซ้อน เพราะมันคือจอทำงาน ไม่ใช่คำถามสั้น ๆ */
  const [editingModel, setEditingModel] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/pricing/overview', { headers: authHeaders });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'โหลดข้อมูลไม่สำเร็จ');
      setOverview(await res.json());
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  }, [authHeaders]);

  const quote = useCallback(async (input: string) => {
    if (!input.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/pricing/quote', {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code: input }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'คิดราคาไม่สำเร็จ');
      setResult(body);
    } catch (e: unknown) {
      setError(errMsg(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [jsonHeaders]);

  /**
   * ดาวน์โหลดแม่แบบ — ต้องผ่าน `fetch` + blob ไม่ใช่ `<a href>` เพราะเส้นนี้อยู่หลัง
   * `adminAuthMiddleware` และเบราว์เซอร์ไม่แนบ Authorization ให้กับลิงก์ธรรมดา
   * (ลิงก์ที่ "ดาวน์โหลดได้โดยไม่ต้องล็อกอิน" คือสิ่งที่ทั้งโมดูลนี้มีไว้เพื่อกัน)
   */
  const downloadTemplate = useCallback(async () => {
    setDownloading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/pricing/template', { headers: authHeaders });
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
      const res = await fetch('/api/admin/pricing/rollback', {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: backup.name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'ย้อนกลับไม่สำเร็จ');
      await loadOverview();
      if (result) await quote(code);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setRollingBack(false);
    }
  }, [overview, jsonHeaders, loadOverview, result, quote, code]);

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
  const modelCode = result?.parsed.model ?? overview?.models[0]?.code ?? '*';

  /** รหัสย่อยที่ยังไม่มีใครตั้ง เรียงตามจำนวนรหัสจริงที่มีตัวอักษรนั้น — ไล่เก็บจากบนลงล่างได้ */
  const todo = useMemo(() => {
    const set = new Set(allSet.map((s) => s.subCode.toUpperCase()));
    return (overview?.census?.items ?? [])
      .filter((it) => !set.has(it.token.toUpperCase()))
      .slice(0, 16);
  }, [allSet, overview]);

  async function removeSub(row: SubCode) {
    if (!row.id) return;
    if (!window.confirm(`ลบรหัสย่อย ${row.subCode} ของ ${row.scope} ?`)) return;
    await fetch(`/api/admin/pricing/subcodes/${row.id}`, { method: 'DELETE', headers: authHeaders });
    await loadOverview();
    if (result) await quote(code);
  }

  async function toggleSub(row: SubCode) {
    if (!row.id) return;
    await fetch(`/api/admin/pricing/subcodes/${row.id}`, {
      method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ ...row, disabled: !row.disabled }),
    });
    await loadOverview();
    if (result) await quote(code);
  }

  const bookMissing = overview && !overview.book.ok;

  if (editingModel) {
    return (
      <ModelPriceEditor
        code={editingModel}
        authHeaders={authHeaders}
        onBack={(wasSaved) => {
          setEditingModel(null);
          if (wasSaved) { void loadOverview(); if (result) void quote(code); }
        }}
      />
    );
  }

  return (
    <div className="space-y-3.5">
      <PageHeader
        icon={CircleDollarSign}
        title="คิดราคาสินค้า"
        description={
          overview?.book.ok
            ? `สมุดราคา ${overview.book.models} รุ่น · ${overview.version ?? ''} · ยังไม่ต่อกับใบเสนอราคา`
            : 'พิมพ์รหัสสินค้าแล้วได้ราคาพร้อมที่มาของทุกบาท'
        }
      >
        {/* จอแคบใช้คำสั้น — แถบบนเป็นที่ร่วมกับชื่อหน้า สองปุ่มคำเต็มเบียดจนชื่อหน้าเหลือตัวเดียว
            (ไม่ใช้ปุ่มไอคอนล้วน เพราะ ↓ กับ ↑ สองตัวติดกันแยกไม่ออกว่าอันไหนเข้าอันไหนออก) */}
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
      {error && <ErrorBox message={error} onRetry={() => void quote(code)} />}

      {/* ── สมุดราคาที่ระบบใช้อยู่ ───────────────────────────────────────
          มีเพราะเจ้าของเคาะว่า "ไฟล์ที่อัปผ่านจอเป็นตัวจริง" (2026-09-21)
          ⇒ ต้องตอบได้ตลอดเวลาว่าราคาที่ระบบคิดอยู่มาจากไฟล์ไหน ใครอัป เมื่อไหร่
          และต้องมีทางถอย เพราะไม่มี CLI ให้ใครไปรันซ้ำบนเซิร์ฟเวอร์อีกแล้ว */}
      {overview?.shelf && (
        <div className="bg-card border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-900">สมุดราคาที่ระบบใช้อยู่</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">ราคาทุกบาทบนหน้านี้คิดจากเล่มนี้</p>
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

      {/* ── รุ่นที่มีราคา + ทางเข้าหน้าแก้ราคา ──────────────────────────
          เจ้าของสั่ง 2026-09-23: แก้ราคาจากหน้าจอได้ทีละรุ่น ไม่ต้องโหลด Excel ออกไปแก้
          ⇒ ทางเข้าอยู่ตรงรายชื่อรุ่น ไม่ใช่เมนูแยก เพราะคนหาจาก "รุ่นไหน" ไม่ใช่จาก "ทำอะไร" */}
      {(overview?.models.length ?? 0) > 0 && (
        <TableCard title="รุ่นที่มีราคาในสมุด" hint="กดปุ่มแก้ราคาเพื่อแก้ตารางราคาและกฎของรุ่นนั้น">
          <div className="px-4 py-3 flex flex-wrap gap-2">
            {overview!.models.map((m) => (
              <div key={m.code}
                   className="flex items-center gap-2 rounded-xl border border-slate-200 bg-card px-3 py-1.5">
                <span className="text-[12.5px] font-bold text-slate-900">{m.code}</span>
                <span className="text-[11px] text-slate-400 max-w-[180px] truncate">{m.label}</span>
                {m.aliases.length > 0 && (
                  <span className="text-[10.5px] text-slate-400">+ {m.aliases.join(', ')}</span>
                )}
                <button
                  type="button"
                  aria-label={`แก้ราคารุ่น ${m.code}`}
                  title={`แก้ราคารุ่น ${m.code}`}
                  onClick={() => setEditingModel(m.code)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[var(--brand-fg)]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
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
            if (saved) { void loadOverview(); if (result) void quote(code); }
          }}
        />
      )}

      {/* ── 1. พิมพ์รหัส ───────────────────────────────────────────────── */}
      <div className="bg-card border border-slate-200 rounded-2xl px-5 py-4">
        <div className="flex gap-2.5 items-stretch flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <label className="sr-only" htmlFor="pl-code">รหัสสินค้า</label>
            <input
              id="pl-code"
              className="w-full h-11 px-3.5 rounded-xl bg-card border border-slate-200 text-slate-900 font-mono text-[15px]"
              value={code}
              spellCheck={false}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void quote(code); }}
              placeholder="เช่น TSK-14 6x200+150-BU"
            />
          </div>
          <Button variant="primary" size="md" icon={Calculator} busy={busy}
                  onClick={() => void quote(code)} disabled={!!bookMissing}>
            คิดราคา
          </Button>
        </div>
        <div className="flex gap-1.5 flex-wrap items-center mt-2.5">
          <span className="text-[11px] text-slate-400">{HELP}</span>
          {EXAMPLES.map((eg) => (
            <button key={eg} onClick={() => { setCode(eg); void quote(eg); }}
                    className="font-mono text-[11px] px-2 py-1 rounded-md bg-card border border-slate-200 text-slate-600 hover:border-[var(--brand-border)] hover:text-[var(--brand-fg)]">
              {eg}
            </button>
          ))}
        </div>
      </div>

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-3.5 items-start">
          {/* ── 2. ระบบอ่านรหัสนี้ว่าอะไร ──────────────────────────────── */}
          <TableCard title="ระบบอ่านรหัสนี้ว่าอะไร" hint="ตรวจให้ครบก่อนเชื่อราคา">
            <div className="px-4 py-3.5">
              {result.parsed.parts.length === 0 && (
                <p className="text-xs text-slate-500">อ่านรหัสนี้ไม่ออกเลย — {result.parsed.problems.join(' · ')}</p>
              )}
              <ul className="divide-y divide-slate-100">
                {result.parsed.parts.map((p, i) => (
                  <li key={`${p.text}-${i}`} className="flex gap-3 items-center py-2.5 flex-wrap">
                    <span className={`font-mono font-bold text-xs px-2 py-1 rounded-md border shrink-0 ${
                      isUnknown(p.kind)
                        ? 'bg-red-50 border-red-200 text-red-700'
                        : 'bg-card border-slate-200 text-slate-900'
                    }`}>
                      {p.text}
                    </span>
                    <span className={`text-xs flex-1 min-w-[140px] ${isUnknown(p.kind) ? 'text-red-700 font-semibold' : 'text-slate-700'}`}>
                      {p.reads}
                      {p.guess && <span className="block text-[11px] text-slate-400 mt-0.5">ตีความเอาเอง ยังไม่มีใครยืนยัน</span>}
                    </span>
                    {isUnknown(p.kind) && (
                      <Button variant="primary" onClick={() => setAdding({ subCode: p.text })}>
                        ＋ เพิ่ม {p.text}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>

              {result.parsed.parts.some((p) => isUnknown(p.kind)) && (
                <div className="flex gap-2.5 rounded-xl px-3.5 py-2.5 mt-3 text-xs leading-relaxed bg-amber-50 border border-amber-200 text-amber-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <b>ยังไม่รู้ว่ามันคืออะไร ห้ามเดา</b> — ปล่อยให้ขึ้นแดงไว้แล้วไปถามฝ่ายขาย
                    ดีกว่าใส่ตัวเลขมั่ว เพราะพอตั้งค่าแล้ว <b>รหัสอื่นทั้งหมดที่มีตัวอักษรนี้จะคิดตามทันที</b>
                    และราคาที่ผิดจะดูเหมือนราคาที่ถูกทุกประการ
                  </span>
                </div>
              )}
              {result.parsed.warnings.map((w) => (
                <p key={w} className="text-[11px] text-slate-500 mt-2">{w}</p>
              ))}
            </div>
          </TableCard>

          {/* ── 3. ราคา ────────────────────────────────────────────────── */}
          <TableCard title="ราคาต่อหน่วย" hint={result.parsed.model ? `รุ่น ${result.parsed.model}` : undefined}>
            <div className="px-4 py-3">
              {result.outcome?.status === 'priced' ? (
                <>
                  <div className="text-center py-1.5">
                    <div className="text-[11px] text-slate-500">ราคาตั้ง (ยังไม่รวมส่วนลด)</div>
                    <div className="text-3xl font-extrabold text-slate-900 tabular-nums leading-tight">
                      {result.outcome.unitPrice.toLocaleString()}
                      <span className="text-sm font-semibold text-slate-500 ml-1.5">บาท</span>
                    </div>
                  </div>
                  <div className="border-t border-slate-100 pt-2.5 mt-2">
                    {result.outcome.breakdown.map((b, i) => (
                      <div key={`${b.step}-${i}`} className="flex gap-2.5 justify-between py-1 text-xs">
                        <span className="text-slate-600 min-w-0">
                          {/* `label` คือคำที่คนอ่าน · `step` เป็นชื่อชนิดของกฎที่โปรแกรมใช้ ไม่ใช่คำบนจอ */}
                          {b.label}
                          {b.detail && <small className="block text-[10.5px] text-slate-400">{b.detail}</small>}
                        </span>
                        <span className="tabular-nums font-semibold text-slate-800 whitespace-nowrap">
                          {b.amount === undefined ? '' : b.amount.toLocaleString()}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-slate-100 mt-1.5 pt-2 text-[13px] font-extrabold text-slate-900">
                      <span>รวมต่อหน่วย</span>
                      <span className="tabular-nums">{result.outcome.unitPrice.toLocaleString()} บาท</span>
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={AlertTriangle}
                  title={result.outcome?.status === 'notManufacturable' ? 'ไม่รับผลิตขนาดนี้' : 'ยังคิดราคาไม่ได้'}
                  hint={
                    result.outcome?.violations.map((v) => v.message).join(' · ')
                    || result.parsed.problems.join(' · ')
                    || 'ตารางราคาเว้นช่องนี้ว่างไว้ — ต้องถามฝ่ายขาย'
                  }
                />
              )}
            </div>
          </TableCard>
        </div>
      )}

      {/* ── 4. รหัสย่อยที่ตั้งค่าไว้ ─────────────────────────────────────── */}
      <TableCard title="รหัสย่อยที่ตั้งค่าไว้" hint={`${allSet.length} ตัว`}>
        {allSet.length === 0 ? (
          <EmptyState icon={Tag} title="ยังไม่มีรหัสย่อยที่ตั้งไว้" hint="เจอตัวที่อ่านไม่ออกแล้วกดปุ่ม ＋ เพิ่ม ข้าง ๆ ได้เลย" />
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

            {/* ตารางหลายคอลัมน์บนมือถือ = การ์ด ไม่ใช่ตารางที่เล็กลง (docs/design.md §3) */}
            <div className="sm:hidden p-3 space-y-2.5">
              {allSet.map((s) => (
                <div key={`${s.subCode}-${s.scope}`}
                     className={`rounded-xl border border-slate-200 bg-card px-3.5 py-3 ${s.disabled ? 'opacity-50' : ''}`}>
                  <div className="flex gap-2 items-center flex-wrap">
                    <span className="font-mono font-bold text-[13px] text-slate-900">{s.subCode}</span>
                    <span className="text-[11px] text-slate-600">{EFFECT_TH[s.effect]}</span>
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

      {/* ── 5. ยังไม่ได้ตั้งค่า ──────────────────────────────────────────── */}
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
          modelCode={adding.editing?.scope ?? modelCode}
          models={overview?.models ?? []}
          code={code}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            void loadOverview();
            void quote(code);
          }}
        />
      )}
    </div>
  );
};

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
