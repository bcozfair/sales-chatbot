import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, CircleDollarSign, AlertTriangle, BookOpen } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader } from '../PageHeader';
import { Button } from '../Button';
import { TableCard, EmptyState, ErrorBox } from '../logs/ui';
import { errMsg, formatDateTime } from '../logs/format';
import { SubCodeModal } from './SubCodeModal';
import { type QuoteOverview, type ParsedCode, type PriceOutcome } from './types';

/**
 * หน้า "คิดราคาสินค้า" — โมดูลทดลองที่ถอดออกได้ทั้งก้อน
 *
 * เจ้าของสั่ง 2026-09-18 · เคาะหน้าตาจาก mockup/pl-pricing.html วันเดียวกัน
 * **เฟสแรกยังไม่ต่อกับใบเสนอราคา — คิดราคาให้ดูอย่างเดียว**
 *
 * **ตั้งแต่ 2026-09-23 หน้านี้คิดราคาอย่างเดียว** (เจ้าของสั่ง) — ของที่แก้ราคาทั้งหมด (เล่มที่ใช้อยู่ ·
 * แม่แบบ Excel · รายชื่อรุ่น + แก้ทีละรุ่น · ตารางรหัสย่อย) ย้ายไปหน้า "สมุดราคา" (`PriceBook.tsx`)
 * พร้อมสิทธิ์ของตัวเอง `page.pricebook` ⇒ เปิดหน้านี้ให้ใครได้โดยไม่ต้องยกสิทธิ์แก้ราคาไปด้วย
 * ของที่ยังเหลือไว้ที่นี่ข้อเดียวคือปุ่ม "＋ เพิ่ม" ข้างรหัสย่อยที่อ่านไม่ออก (เหตุผลข้างล่าง) และมัน
 * **โผล่เฉพาะคนที่มีสิทธิ์สมุดราคา** — คนอื่นเห็นแถบแดงกับคำเตือนเหมือนเดิม แต่ไม่มีปุ่ม
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

interface Props {
  /** คนนี้เปิดหน้า "สมุดราคา" ได้ไหม (มาจากเมนูที่เขาเห็นจริง = ช่อง `page.pricebook`) */
  canEditBook: boolean;
  onOpenBook: () => void;
}

export const PricingLab: React.FC<Props> = ({ canEditBook, onOpenBook }) => {
  const { token } = useAuth();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const jsonHeaders = useMemo(
    () => ({ ...authHeaders, 'Content-Type': 'application/json' }),
    [authHeaders],
  );

  const [overview, setOverview] = useState<QuoteOverview | null>(null);
  const [code, setCode] = useState(EXAMPLES[0]);
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState<string | null>(null);

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

  // โหลดครั้งแรก — หุ้ม setTimeout ตามท่าของทั้งแอป (eslint ปฏิเสธ setState ตรง ๆ ใน useEffect)
  useEffect(() => {
    const t = setTimeout(() => { void loadOverview(); }, 0);
    return () => clearTimeout(t);
  }, [loadOverview]);

  const modelCode = result?.parsed.model ?? overview?.models[0]?.code ?? '*';
  /** ชื่อรุ่นที่ขึ้นจอ (`BH-01` → `BH-01,02`) — ตัวคิดราคาตอบเป็นรหัสในฐาน */
  const modelName = (c?: string) => overview?.models.find((m) => m.code === c)?.name ?? c;

  const bookMissing = overview && !overview.book.ok;

  return (
    <div className="space-y-3.5">
      <PageHeader
        icon={CircleDollarSign}
        title="คำนวณราคา"
        description={
          overview?.book.ok
            ? `สมุดราคา ${overview.book.models} รุ่น · ${overview.edited ? `แก้ล่าสุด ${formatDateTime(overview.edited.at)}` : (overview.version ?? '')} · ยังไม่ต่อกับใบเสนอราคา`
            : 'พิมพ์รหัสสินค้าแล้วได้ราคาพร้อมที่มาของทุกบาท'
        }
      >
        {canEditBook && (
          <Button icon={BookOpen} onClick={onOpenBook}>
            <span className="sm:hidden">สมุดราคา</span>
            <span className="hidden sm:inline">แก้ราคาในสมุดราคา</span>
          </Button>
        )}
      </PageHeader>

      {bookMissing && <ErrorBox message={overview.book.message ?? 'ยังไม่มีสมุดราคาในเครื่องนี้'} />}
      {error && <ErrorBox message={error} onRetry={() => void quote(code)} />}

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
                    {isUnknown(p.kind) && canEditBook && (
                      <Button variant="primary" onClick={() => setAdding(p.text)}>
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
                    {!canEditBook && <> · ตั้งค่าได้เฉพาะคนที่มีสิทธิ์หน้า <b>สมุดราคา</b></>}
                  </span>
                </div>
              )}
              {result.parsed.warnings.map((w) => (
                <p key={w} className="text-[11px] text-slate-500 mt-2">{w}</p>
              ))}
            </div>
          </TableCard>

          {/* ── 3. ราคา ────────────────────────────────────────────────── */}
          <TableCard title="ราคาต่อหน่วย" hint={result.parsed.model ? `รุ่น ${modelName(result.parsed.model)}` : undefined}>
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
                  // "รหัสบอกไม่ครบ" ≠ "ไม่รับผลิต" — เดิมขึ้นอย่างหลังกับ TSJ-01 4.8+2M ที่แค่ไม่มีวงเล็บเกลียว (2026-09-24)
                  title={
                    result.outcome?.violations.some((v) => v.level === 'block' && !v.missing)
                      ? 'ไม่รับผลิตขนาดนี้'
                      : result.outcome?.violations.some((v) => v.missing)
                        ? 'รหัสยังบอกข้อมูลไม่ครบ'
                        : 'ยังคิดราคาไม่ได้'
                  }
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

      {adding && (
        <SubCodeModal
          token={token ?? ''}
          subCode={adding}
          modelCode={modelCode}
          models={overview?.models ?? []}
          code={code}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            void quote(code);
          }}
        />
      )}
    </div>
  );
};
