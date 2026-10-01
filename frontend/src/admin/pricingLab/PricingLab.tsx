import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, CircleDollarSign, AlertTriangle, BookOpen } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader } from '../PageHeader';
import { Button } from '../Button';
import { TableCard, EmptyState, ErrorBox } from '../logs/ui';
import { errMsg, formatDateTime } from '../logs/format';
import { SubCodeModal } from './SubCodeModal';
import { CalcTrace } from './CalcTrace';
import { CatalogTemplate, TsCatalogTemplate, type FamilyChoice } from './CatalogTemplate';
import { formForFamily, tsFormForFamily } from './catalogForm';
import { type BhForm, type HoleRow, type QuoteOverview, type ParsedCode, type PriceOutcome, type TsForm } from './types';

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
 *
 * **ตั้งแต่ 2026-09-28 รหัสที่มีแคตตาล็อก (ซีรีส์ BH) ได้ช่องกรอกเรียงตามแคตตาล็อกแทนการ์ด "ระบบอ่านรหัสนี้ว่าอะไร"**
 * (เจ้าของเคาะ mockup แบบ A "กรอกในรหัส" + ขอช่องคำนวณจากรหัสแบบเดิมไว้ด้วย) — ช่องรหัสด้านบนกับช่องกรอกตามกันเสมอ:
 * พิมพ์รหัส → เซิร์ฟเวอร์อ่านเป็นช่อง · แก้ช่อง → เซิร์ฟเวอร์ประกอบรหัสให้ (`/quote` รับ `form`) ⇒ ไม่มีตัวประกอบรหัส
 * ฝั่งเบราว์เซอร์ที่จะเขียนไม่ตรงกับตัวอ่าน · รหัสที่ไม่มีแคตตาล็อก/เขียนนอกรูปแบบ ยังเห็นหน้าเดิมทุกอย่าง
 *
 * **ตั้งแต่ 2026-09-29 ซีรีส์ TS ทั้ง 11 ตารางได้ช่องกรอกแบบเดียวกัน** (เจ้าของ: "หน้าคำนวณราคาของซีรีย์ TS_ ทั้งหมด
 * ยังไม่ใช้รูปแบบแคตตาล็อคเหมือนซีรีย์ BH" · เคาะ mockup `pricing-catalogue-ts.html` + คำถาม 9 ข้อ "ตามที่แนะนำ")
 * — ช่อง "รุ่น" ช่องเดียวรวม BH กับ TS สลับข้ามซีรีส์ได้ · ช่องของ TS ส่งไปเป็น `tsForm` (`catalogTs.ts`)
 */

const HELP = 'ตัวอย่างในชีต — กดเพื่อลอง';
const EXAMPLES = ['BH-01C-600x150-380-4950W-PL-PL2', 'BH-02C 210-220-1400W-N-Z', 'BH-03 170x110-220-2700W-T', 'TSK-14 6x200+150-BU', 'TSK-04(S2)6Ax300+3MP', 'TSP-11P 6x50+5M-PU'];

interface QuoteResult {
  /** รหัสที่เซิร์ฟเวอร์คิดราคาจริง — ตอนส่งช่องกรอกไป คือรหัสที่เซิร์ฟเวอร์ประกอบให้ */
  code?: string;
  parsed: ParsedCode;
  outcome: PriceOutcome | null;
}

/** ท่อนที่ยังไม่มีใครบอกว่าแปลว่าอะไร — ตัวเดียวที่ได้ปุ่ม "＋ เพิ่ม" */
const isUnknown = (kind: string) => kind === 'unknown';
/** ท่อนที่ยังไม่รวมในราคา — อ่านไม่ออก หรืออ่านออกแต่ต้องเลือกเพิ่ม (ขนาดเต๋า T) */
const notInPrice = (kind: string) => kind === 'unknown' || kind === 'choose';

/** "ไม่รับผลิต" ≠ "รหัสบอกไม่ครบ" ≠ "ยังไม่มีราคา" — คนละคำตอบกับลูกค้า (เดิมรวมกันหมด 2026-09-24) */
function notPricedTitle(o: PriceOutcome | null): string {
  if (o?.status === 'quoteOnRequest') return 'ต้องขอราคาจากฝ่ายผลิต';
  if (o?.violations.some((v) => v.level === 'block' && !v.missing && !v.noRate)) return 'ไม่รับผลิตขนาดนี้';
  if (o?.violations.some((v) => v.missing)) return 'รหัสยังบอกข้อมูลไม่ครบ';
  if (o?.violations.some((v) => v.noRate)) return 'ยังไม่มีราคาในสมุดราคา';
  return 'ยังคิดราคาไม่ได้';
}

/**
 * "ต้องขอราคาจากฝ่ายผลิต" ที่มาจากค่านอกแคตตาล็อก (`Violation.askPrice`) — ได้ราคาแล้วแอดมินใส่เองได้ที่หน้าชีต
 * (เจ้าของสั่ง 2026-09-29 · mockup `ts01-ask-price` ตัวอย่างที่ 1) · ปุ่มขึ้นเฉพาะคนที่เปิดหน้าสมุดราคาได้
 */
const AskPriceLink: React.FC<{ outcome: PriceOutcome | null; sheet?: string; canEditBook: boolean; onOpen: () => void }> = ({ outcome, sheet, canEditBook, onOpen }) => {
  if (!canEditBook || !sheet || !outcome?.violations.some((v) => v.askPrice && v.level === 'quoteOnRequest')) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
      <span>ได้ราคาแล้ว ใส่ได้ที่</span>
      <Button size="sm" icon={BookOpen} onClick={onOpen}>สมุดราคา › {sheet} › ต้องขอราคา</Button>
    </div>
  );
};

interface Props {
  /** คนนี้เปิดหน้า "สมุดราคา" ได้ไหม (มาจากเมนูที่เขาเห็นจริง = ช่อง `page.pricebook`) */
  canEditBook: boolean;
  /** `at` = เปิดชีตของรุ่นนี้ตรงกล่อง "ต้องขอราคา" (ปุ่มของผลที่ต้องขอราคา) · ไม่ส่ง = หน้าแรกของสมุด */
  onOpenBook: (at?: { sheet: string; model: string }) => void;
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
  /** ช่องตามแคตตาล็อก — null = รหัสนี้ไม่มีแคตตาล็อก (หรือเขียนนอกรูปแบบ) ⇒ หน้าเดิม */
  const [form, setForm] = useState<BhForm | null>(null);
  /** ช่องตามแคตตาล็อกของซีรีส์ TS — null = รหัสนี้ไม่ใช่ TS หรือเขียนนอกรูปแบบ */
  const [tsForm, setTsForm] = useState<TsForm | null>(null);
  /** คำขอล่าสุด — คำตอบของคำขอเก่าที่มาถึงทีหลังต้องทิ้ง ไม่งั้นพิมพ์ 150 แล้วช่องเด้งกลับเป็น 15 */
  const seq = useRef(0);
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/pricing/overview', { headers: authHeaders });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'โหลดข้อมูลไม่สำเร็จ');
      setOverview(await res.json());
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  }, [authHeaders]);

  /**
   * คิดราคา — จากรหัสที่พิมพ์ (`code`) หรือจากช่องกรอก (`form`)
   * ขนาดเต๋า · สิ่งที่ต้องบวกเพิ่ม · รูที่เจาะ ส่งไปกับรหัสด้วย (`picks`) เพราะมันไม่อยู่ในรหัส — พิมพ์รหัสเดิมซ้ำแล้วค่าที่เลือกต้องไม่หาย
   */
  const send = useCallback(async (body: { code?: string; form?: BhForm; tsForm?: TsForm; picks?: { amp?: string; addons?: string[]; holes?: HoleRow[] } }) => {
    const mine = ++seq.current;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/pricing/quote', {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify(body),
      });
      const out = await res.json();
      if (mine !== seq.current) return;
      if (!res.ok) throw new Error(out?.error ?? 'คิดราคาไม่สำเร็จ');
      setResult(out);
      if (body.form || body.tsForm) setCode(out.code ?? '');
      if (!body.form) setForm(out.parsed?.form ?? null);
      if (!body.tsForm) setTsForm(out.parsed?.tsForm ?? null);
    } catch (e: unknown) {
      if (mine !== seq.current) return;
      setError(errMsg(e));
      setResult(null);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }, [jsonHeaders]);

  const amp = form?.amp;
  const addons = form?.addons ?? tsForm?.addons;
  const holes = form?.holes;
  const quote = useCallback((input: string) => {
    if (!input.trim()) return;
    if (typing.current) clearTimeout(typing.current);
    void send({ code: input, picks: { ...(amp ? { amp } : {}), ...(addons?.length ? { addons } : {}), ...(holes?.length ? { holes } : {}) } });
  }, [send, amp, addons, holes]);

  /** แก้ช่องกรอก — ช่องเลือกส่งทันที · ช่องพิมพ์หน่วงไว้ให้พิมพ์จบก่อน */
  const editForm = useCallback((next: BhForm, now?: boolean) => {
    setForm(next);
    if (typing.current) clearTimeout(typing.current);
    if (now) void send({ form: next });
    else typing.current = setTimeout(() => { void send({ form: next }); }, 350);
  }, [send]);

  /** ช่องกรอกของ TS — กติกาเดียวกับของ BH (ช่องเลือกส่งทันที · ช่องพิมพ์หน่วง) */
  const editTsForm = useCallback((next: TsForm, now?: boolean) => {
    setTsForm(next);
    setForm(null);
    if (typing.current) clearTimeout(typing.current);
    if (now) void send({ tsForm: next });
    else typing.current = setTimeout(() => { void send({ tsForm: next }); }, 350);
  }, [send]);

  useEffect(() => () => { if (typing.current) clearTimeout(typing.current); }, []);

  // โหลดครั้งแรก — หุ้ม setTimeout ตามท่าของทั้งแอป (eslint ปฏิเสธ setState ตรง ๆ ใน useEffect)
  useEffect(() => {
    const t = setTimeout(() => { void loadOverview(); }, 0);
    return () => clearTimeout(t);
  }, [loadOverview]);

  const modelCode = result?.parsed.model ?? overview?.models[0]?.code ?? '*';
  const resultSheet = overview?.models.find((m) => m.code === result?.outcome?.model)?.sheet;
  const openAsk = () => { if (resultSheet && result?.outcome) onOpenBook({ sheet: resultSheet, model: result.outcome.model }); };
  /** ราคาที่ได้มาจากช่องนอกแคตตาล็อกที่แอดมินใส่เอง — บอกไว้ใต้ราคา (ไม่ใช่ราคาของ Excel) */
  const askSet = (result?.outcome?.violations ?? []).filter((v) => v.askPrice && v.level === 'warn').map((v) => v.message);
  /** ชื่อรุ่นที่ขึ้นจอ (`BH-01` → `BH-01,02`) — ตัวคิดราคาตอบเป็นรหัสในฐาน */
  const modelName = (c?: string) => overview?.models.find((m) => m.code === c)?.name ?? c;

  const bookMissing = overview && !overview.book.ok;
  /** สิ่งที่ยังไม่ได้รวมในราคา: กฎที่ข้ามเพราะอ่านค่าในรหัสไม่ออก + ท่อนที่อ่านไม่ออก/ยังต้องเลือก */
  const notIncluded = result
    ? [
        ...(result.outcome?.violations ?? []).filter((v) => v.partial).map((v) => v.message),
        ...result.parsed.parts.filter((p) => notInPrice(p.kind)).map((p) => `${p.text} — ${p.reads}`),
      ]
    : [];
  const catalog = overview?.catalog ?? [];
  const catalogTs = overview?.catalogTs ?? [];
  const tsSpec = tsForm ? catalogTs.find((c) => c.family === tsForm.family) : undefined;
  const bhMode = !!form && catalog.some((c) => c.family === form.family);
  const catalogMode = bhMode || !!tsSpec;
  /** ช่อง "รุ่น" ช่องเดียวรวมสองซีรีส์ (เจ้าของเคาะข้อ 9) — TS_-12 มีสองรายการตามแคตตาล็อกสองหน้า */
  const families: FamilyChoice[] = useMemo(() => [
    ...(overview?.catalogTs ?? []).map((c) => ({ value: c.family, code: c.head, text: c.name, group: 'TS — Temperature Sensor' })),
    ...(overview?.catalog ?? []).map((c) => ({ value: c.family, code: c.head, text: c.name, group: 'BH — Heater' })),
  ], [overview]);
  const pickFamily = (f: string) => {
    const bh = catalog.find((c) => c.family === f);
    if (bh) { setTsForm(null); editForm(formForFamily(bh, form ?? undefined), true); return; }
    const ts = catalogTs.find((c) => c.family === f);
    if (ts) editTsForm(tsFormForFamily(ts, tsForm ?? undefined), true);
  };

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
          <Button icon={BookOpen} onClick={() => onOpenBook()}>
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

        {/* ── 1b. ช่องกรอกตามแคตตาล็อก + ราคา (เฉพาะรหัสที่มีแคตตาล็อก) ──────────── */}
        {catalogMode && (
          <div className="mt-3.5 pt-3.5 border-t border-slate-100">
            {bhMode && form ? (
              <CatalogTemplate catalog={catalog} families={families} form={form} onChange={editForm} onFamily={pickFamily} />
            ) : tsSpec && tsForm ? (
              <TsCatalogTemplate spec={tsSpec} families={families} form={tsForm} onChange={editTsForm} onFamily={pickFamily} />
            ) : null}
            {result && <CatalogResult result={result} notIncluded={notIncluded} />}
            {result && <AskPriceLink outcome={result.outcome} sheet={resultSheet} canEditBook={canEditBook} onOpen={openAsk} />}
          </div>
        )}
      </div>

      {result && !catalogMode && (
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
                      notInPrice(p.kind)
                        ? 'bg-red-50 border-red-200 text-red-700'
                        : 'bg-card border-slate-200 text-slate-900'
                    }`}>
                      {p.text}
                    </span>
                    <span className={`text-xs flex-1 min-w-[140px] ${notInPrice(p.kind) ? 'text-red-700 font-semibold' : 'text-slate-700'}`}>
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
                    {/* ท่อนที่อ่านไม่ออกไม่ได้ทำให้คิดราคาไม่ได้ — คิดเฉพาะส่วนที่คำนวณได้แล้วบอกให้ชัดว่ายังไม่ครบ
                        (เจ้าของสั่ง 2026-09-25) · ห้ามโชว์เหมือนราคาเต็ม ไม่งั้นคนจะเอาไปเสนอลูกค้าทั้งที่ขาดบางส่วน */}
                    <div className={`text-[11px] ${notIncluded.length ? 'text-amber-700 font-semibold' : 'text-slate-500'}`}>
                      {notIncluded.length ? 'ราคาเฉพาะส่วนที่คำนวณได้ (ยังไม่รวมส่วนลด)' : 'ราคาตั้ง (ยังไม่รวมส่วนลด)'}
                    </div>
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
                      <span>{notIncluded.length ? 'รวมเฉพาะส่วนที่คำนวณได้' : 'รวมต่อหน่วย'}</span>
                      <span className="tabular-nums">{result.outcome.unitPrice.toLocaleString()} บาท</span>
                    </div>
                  </div>
                  {askSet.map((t) => (
                    <div key={t} className="mt-3 rounded-lg px-3 py-2 text-xs border bg-sky-50 border-sky-200 text-sky-800">{t}</div>
                  ))}
                  {notIncluded.length > 0 && (
                    <div className="flex gap-2.5 rounded-xl px-3.5 py-2.5 mt-3 text-xs leading-relaxed bg-amber-50 border border-amber-200 text-amber-800">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        <b>ราคานี้ยังไม่ครบ</b> — ส่วนที่อ่านไม่ออกยังไม่ได้รวม ต้องถามฝ่ายขายก่อนเสนอราคา
                        <ul className="mt-1 list-disc pl-4">
                          {notIncluded.map((t) => <li key={t}>{t}</li>)}
                        </ul>
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <EmptyState
                  icon={AlertTriangle}
                  // "รหัสบอกไม่ครบ" ≠ "ไม่รับผลิต" — เดิมขึ้นอย่างหลังกับ TSJ-01 4.8+2M ที่แค่ไม่มีวงเล็บเกลียว (2026-09-24)
                  title={notPricedTitle(result.outcome)}
                  hint={
                    result.outcome?.violations.map((v) => v.message).join(' · ')
                    || result.parsed.problems.join(' · ')
                    || 'ตารางราคาเว้นช่องนี้ว่างไว้ — ต้องถามฝ่ายขาย'
                  }
                />
              )}
              {result.outcome?.status !== 'priced' && (
                <AskPriceLink outcome={result.outcome} sheet={resultSheet} canEditBook={canEditBook} onOpen={openAsk} />
              )}
            </div>
          </TableCard>
        </div>
      )}

      {/* ── 4. วิธีคำนวณทีละขั้น — เต็มความกว้าง เพราะบรรทัดสูตรยาว ────────── */}
      {result?.outcome && <CalcTrace outcome={result.outcome} />}

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

/**
 * ราคาใต้ช่องกรอก (mockup แบบ A) — เงินแต่ละก้อนเป็นชิปต่อกันด้วย "+" แล้วยอดรวมด้านขวา
 * ของที่ไม่มีผลกับราคารวมเป็นบรรทัดจางบรรทัดเดียว · ป้ายเตือนขึ้นเฉพาะตอนมีเรื่องจริง
 * ที่มาละเอียดทุกบาทอยู่ในการ์ด "วิธีคำนวณทีละขั้น" ข้างล่างเหมือนเดิม
 */
const CatalogResult: React.FC<{ result: QuoteResult; notIncluded: string[] }> = ({ result, notIncluded }) => {
  const o = result.outcome;
  const priced = o?.status === 'priced';
  const free = result.parsed.parts.filter((p) => p.kind === 'noPrice').map((p) => p.reads.split(' — ')[0]);
  const warns = [
    ...(o?.violations ?? []).filter((v) => !v.partial).map((v) => v.message),
    ...result.parsed.problems,
    ...result.parsed.warnings,
  ];
  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
            {(o?.breakdown ?? []).map((b, i) => (
              <React.Fragment key={`${b.step}-${i}`}>
                {i > 0 && <span className="text-slate-400 font-bold">+</span>}
                <span className="px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-700" title={b.detail}>
                  {b.label}<b className="ml-1.5 text-slate-900 tabular-nums">{b.amount?.toLocaleString()}</b>
                </span>
              </React.Fragment>
            ))}
          </div>
          {free.length > 0 && (
            <div className="mt-1.5 text-[11.5px] text-slate-400">ไม่มีผลกับราคา: {free.join(' · ')}</div>
          )}
        </div>
        <div className="text-right">
          <div className={`text-[11.5px] ${priced && notIncluded.length ? 'text-amber-700 font-semibold' : 'text-slate-500'}`}>
            {!priced ? '' : notIncluded.length ? 'ราคาเฉพาะส่วนที่คำนวณได้' : 'ราคาตั้งต่อหน่วย (ยังไม่รวมส่วนลด)'}
          </div>
          <div className="text-[26px] font-extrabold text-slate-900 tabular-nums leading-tight">
            {priced
              ? <>{o!.unitPrice.toLocaleString()}<span className="text-[13px] font-semibold text-slate-500 ml-1.5">บาท</span></>
              : <span className="text-[17px] text-red-700">{notPricedTitle(o)}</span>}
          </div>
        </div>
      </div>
      {(notIncluded.length > 0 || warns.length > 0) && (
        <div className="mt-2.5 grid gap-1.5">
          {notIncluded.map((t) => (
            <div key={t} className="flex gap-2 rounded-lg px-3 py-2 text-xs bg-amber-50 border border-amber-200 text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /><span><b>ยังไม่รวมในราคา</b> — {t}</span>
            </div>
          ))}
          {warns.map((t) => (
            <div key={t} className={`rounded-lg px-3 py-2 text-xs border ${
              priced ? 'bg-sky-50 border-sky-200 text-sky-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{t}</div>
          ))}
        </div>
      )}
    </div>
  );
};
