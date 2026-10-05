import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, CircleDollarSign, AlertTriangle, BookOpen, Plus, Check } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader } from '../PageHeader';
import { Button } from '../Button';
import { ErrorBox } from '../logs/ui';
import { errMsg, formatDateTime } from '../logs/format';
import { LocalProductModal, type FromPricing } from '../LocalProductModal';
import { isFullPrice } from '../localProducts';
import { SubCodeModal } from './SubCodeModal';
import { CalcTrace } from './CalcTrace';
import { CatalogTemplate, NoModelTemplate, TsCatalogTemplate, type FamilyChoice } from './CatalogTemplate';
import { formForFamily, tsFormForFamily } from './catalogForm';
import {
  type BhForm, type CatalogFamilySpec, type HoleRow, type QuoteOverview, type ParsedCode, type PriceOutcome, type TsFamilySpec, type TsForm,
} from './types';

/**
 * หน้า "คิดราคาสินค้า" — โมดูลทดลองที่ถอดออกได้ทั้งก้อน
 *
 * เจ้าของสั่ง 2026-09-18 · เคาะหน้าตาจาก mockup/pl-pricing.html วันเดียวกัน
 * เฟสแรกคิดราคาให้ดูอย่างเดียว · **ตั้งแต่ 2026-10-02 รหัสที่คิดได้ "เพิ่มเป็นสินค้าใหม่" ได้** (`ProductAddRow` ข้างล่าง)
 * แล้วใช้ในใบเสนอราคาได้ทันที — คำว่า "ยังไม่ต่อกับใบเสนอราคา" บนหัวหน้าจึงเอาออก
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
 *
 * **ตั้งแต่ 2026-10-01 ทุกรหัสใช้ช่องกรอกแบบเดียว — การ์ด "ระบบอ่านรหัสนี้ว่าอะไร" เลิกใช้** (เจ้าของ: "ผมอยากให้ใช้
 * หน้าตา ui เป็นมาตรฐานเดียวกัน อะไรไม่ตรงก็แค่แจ้งเตือน" · เคาะ mockup `pricing-one-form.html`) — รหัสนอกรูปแบบได้ช่อง
 * ที่ระบายสีตาม `TsForm.issues` (เหลือง = เตือน · ส้ม = ขอราคา · แดง = คิดไม่ได้) · ท่อนที่อ่านไม่ออกเป็นชิปท้ายแถว
 * และปุ่ม "＋ เพิ่ม" ย้ายมาอยู่ในแถบเตือน (`CatalogResult`) · รหัสที่ไม่รู้รุ่น = ช่อง "รุ่น" ว่างช่องเดียว + เหตุผล
 * · รหัสบนสุด **ไม่ถูกเขียนทับจนกว่าคนแก้ช่อง** และแก้แล้วคงรูปที่เขียนมา (`written` · `clUnit` · ชิป)
 * · ต้องขอราคาจากฝ่ายผลิต = โชว์ "ราคาเท่าที่คิดได้" ไปก่อน (เจ้าของสั่งตอนเคาะ mockup)
 */

const HELP = 'ตัวอย่างในชีต — กดเพื่อลอง';
const EXAMPLES = ['BH-01C-600x150-380-4950W-PL-PL2', 'BH-02C 210-220-1400W-N-Z', 'BH-03 170x110-220-2700W-T', 'TSK-14 6x200+150-BU', 'TSK-04(S2)6Ax300+3MP', 'TSP-11P 6x50+5M-PU'];

interface QuoteResult {
  /** รหัสที่เซิร์ฟเวอร์คิดราคาจริง — ตอนส่งช่องกรอกไป คือรหัสที่เซิร์ฟเวอร์ประกอบให้ */
  code?: string;
  parsed: ParsedCode;
  outcome: PriceOutcome | null;
  /** เล่มที่คิด — สินค้าที่เพิ่มจากหน้านี้เก็บเป็นที่มาของราคา (`price_book_revision`) */
  revision?: number | null;
}

/** ท่อนที่ยังไม่มีใครบอกว่าแปลว่าอะไร — ตัวเดียวที่ได้ปุ่ม "＋ เพิ่ม" */
const isUnknown = (kind: string) => kind === 'unknown';
/** ท่อนที่ยังไม่รวมในราคา — อ่านไม่ออก หรืออ่านออกแต่ต้องเลือกเพิ่ม (ขนาดเต๋า T) */
const notInPrice = (kind: string) => kind === 'unknown' || kind === 'choose';

/** สิ่งที่ยังไม่รวมในราคา · `add` = รหัสย่อยที่กด "＋ เพิ่ม" ได้ (ท่อนที่อ่านไม่ออก) */
interface Missing { text: string; add?: string }

/** "ไม่รับผลิต" ≠ "รหัสบอกไม่ครบ" ≠ "ยังไม่มีราคา" — คนละคำตอบกับลูกค้า (เดิมรวมกันหมด 2026-09-24) */
function notPricedTitle(o: PriceOutcome | null): string {
  if (o?.status === 'quoteOnRequest') return 'ต้องขอราคาจากฝ่ายผลิต';
  if (o?.violations.some((v) => v.level === 'block' && !v.missing && !v.noRate)) return 'ไม่รับผลิตขนาดนี้';
  if (o?.violations.some((v) => v.missing)) return 'รหัสยังบอกข้อมูลไม่ครบ';
  if (o?.violations.some((v) => v.noRate)) return 'ยังไม่มีราคาในสมุดราคา';
  return 'ยังคิดราคาไม่ได้';
}

interface Props {
  /** คนนี้เปิดหน้า "สมุดราคา" ได้ไหม (มาจากเมนูที่เขาเห็นจริง = ช่อง `page.pricebook`) */
  canEditBook: boolean;
  /** `at` = เปิดชีตของรุ่นนี้ตรงกล่อง "ต้องขอราคา" (ปุ่มของผลที่ต้องขอราคา) · ไม่ส่ง = หน้าแรกของสมุด */
  onOpenBook: (at?: { sheet: string; model: string }) => void;
  /** ช่อง `quote.manage_products` (ช่องเดียวกับปุ่มเพิ่มสินค้าในหน้าขอใบ) — ไม่มี = ไม่เห็นปุ่ม "เพิ่มเป็นสินค้าใหม่" */
  canAddProduct?: boolean;
  /** เปิดหน้า "สินค้าเพิ่มเอง" ได้ไหม (`page.odooproducts`) — ไม่ได้ = ไม่มีลิงก์ไปหน้านั้น */
  canOpenLocalProducts?: boolean;
  onOpenLocalProducts?: () => void;
}

/** แถวที่ model ชน — รูปของ `duplicate[]` ใน `GET /webquote/products/suggest` เท่าที่ใช้ */
interface DupRow { internal_reference: string; name: string; source?: string }

/**
 * ตัวเลือกนอกรหัส (ขนาดเต๋า · สาย/ท่อที่ติ๊ก · เจาะรู) → ข้อความลงช่อง Description ของสินค้าที่เพิ่ม
 * อยู่ในราคาแต่ไม่อยู่ใน model ⇒ ไม่เขียนไว้ = สินค้ามีราคารวมของที่ไม่มีใครรู้ว่าคืออะไร (mockup ข้อ 4)
 * คำมาจากแคตตาล็อกชุดเดียวกับช่องกรอก ไม่ได้แต่งเอง · รูที่กรอกไม่ครบไม่นับ (เซิร์ฟเวอร์ก็ทิ้งเหมือนกัน)
 */
function offCodeText(form: BhForm | null, tsForm: TsForm | null, catalog: CatalogFamilySpec[], catalogTs: TsFamilySpec[]): string {
  const out: string[] = [];
  if (form) {
    const spec = catalog.find((c) => c.family === form.family);
    if (form.amp) out.push(`ขนาดเต๋า ${spec?.slots.amp?.options?.find((o) => o.code === form.amp)?.label ?? form.amp}`);
    for (const a of form.addons ?? []) out.push(spec?.addons?.find((o) => o.code === a)?.label ?? a);
    for (const h of form.holes ?? []) if (h.count > 0 && h.mm > 0) out.push(`เจาะรู ${h.count} รู Ø${h.mm} mm`);
  } else if (tsForm) {
    const spec = catalogTs.find((c) => c.family === tsForm.family);
    for (const a of tsForm.addons ?? []) out.push(spec?.addons?.find((o) => o.code === a)?.label ?? a);
  }
  return out.length ? `ตัวเลือกนอกรหัส (จากหน้าคำนวณราคา): ${out.join(' · ')}` : '';
}

export const PricingLab: React.FC<Props> = ({
  canEditBook, onOpenBook, canAddProduct = false, canOpenLocalProducts = false, onOpenLocalProducts,
}) => {
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
  /** หน้าต่าง "เพิ่มสินค้าใหม่" เปิดอยู่ */
  const [addOpen, setAddOpen] = useState(false);
  /** ผลตรวจ "รหัสนี้มีในระบบแล้วหรือยัง" ของรหัสล่าสุด — รหัสไม่ตรงกับผลปัจจุบัน = ยังตรวจไม่เสร็จ */
  const [dup, setDup] = useState<{ code: string; rows: DupRow[] } | null>(null);
  /** เพิ่มสำเร็จแล้วจากหน้านี้ — แถบเขียวขึ้นแทนปุ่มจนกว่ารหัสจะเปลี่ยน */
  const [saved, setSaved] = useState<{ code: string; ref: string } | null>(null);
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
      // แก้ช่องอยู่ = ค่าในช่องเป็นของคนกรอก (ไม่ดีดกลับ) · รับเฉพาะสิ่งที่เซิร์ฟเวอร์ตัดสินใหม่: ป้ายเตือนรายช่อง / ธงนอกรูปแบบ
      if (!body.form) setForm(out.parsed?.form ?? null);
      else setForm((cur) => (cur ? { ...cur, loose: out.parsed?.form?.loose } : cur));
      if (!body.tsForm) setTsForm(out.parsed?.tsForm ?? null);
      else setTsForm((cur) => (cur ? { ...cur, issues: out.parsed?.tsForm?.issues } : cur));
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
  /** ตัวเลือกนอกรหัสที่ส่งไปคิดคู่กับรหัส — ชุดเดียวกันส่งต่อให้ปุ่มคิดราคาในหน้าต่างเพิ่มสินค้า */
  const picks = useMemo(
    () => ({ ...(amp ? { amp } : {}), ...(addons?.length ? { addons } : {}), ...(holes?.length ? { holes } : {}) }),
    [amp, addons, holes],
  );
  const quote = useCallback((input: string) => {
    if (!input.trim()) return;
    if (typing.current) clearTimeout(typing.current);
    void send({ code: input, picks });
  }, [send, picks]);

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

  const bookMissing = overview && !overview.book.ok;
  /** สิ่งที่ยังไม่ได้รวมในราคา: กฎที่ข้ามเพราะอ่านค่าในรหัสไม่ออก + ท่อนที่อ่านไม่ออก/ยังต้องเลือก */
  const notIncluded: Missing[] = result
    ? [
        ...(result.outcome?.violations ?? []).filter((v) => v.partial).map((v) => ({ text: v.message })),
        ...result.parsed.parts.filter((p) => notInPrice(p.kind))
          .map((p) => ({ text: `${p.text} — ${p.reads}`, ...(isUnknown(p.kind) && canEditBook && p.text ? { add: p.subCode || p.text } : {}) })),
      ]
    : [];
  const catalog = overview?.catalog ?? [];
  const catalogTs = overview?.catalogTs ?? [];
  const tsSpec = tsForm ? catalogTs.find((c) => c.family === tsForm.family) : undefined;
  const bhMode = !!form && catalog.some((c) => c.family === form.family);
  const catalogMode = bhMode || !!tsSpec || !!result;
  /** ช่อง "รุ่น" ช่องเดียวรวมสองซีรีส์ (เจ้าของเคาะข้อ 9) — TS_-12 มีสองรายการตามแคตตาล็อกสองหน้า */
  const families: FamilyChoice[] = useMemo(() => [
    ...(overview?.catalogTs ?? []).map((c) => ({ value: c.family, code: c.head, text: c.name, group: 'TS — Temperature Sensor' })),
    ...(overview?.catalog ?? []).map((c) => ({ value: c.family, code: c.head, text: c.name, group: 'BH — Heater' })),
  ], [overview]);
  // ── เพิ่มเป็นสินค้าใหม่ (mockup `pricing-add-product` รอบ 3 · เจ้าของยืนยัน 2026-10-02) ─────────────
  const o = result?.outcome ?? null;
  const addCode = result?.code?.trim() ?? '';
  /** ราคาครบ = เติมราคาให้ · คิดได้บางส่วน = เปิดได้แต่ไม่เติมราคา (ราคาครึ่งเดียวห้ามหลุดเข้าใบ) · คิดไม่ได้เลย = ปุ่มปิด */
  //  "ครบ" = `isFullPrice` ตัวเดียวกับปุ่มคิดราคาในหน้าต่างเพิ่มสินค้า (เท่ากับ notIncluded ว่าง + ไม่ติดบล็อก + ไม่มีปัญหาของรหัส)
  const addPriced: 'full' | 'partial' | 'none' = !o || !(o.unitPrice > 0) ? 'none'
    : isFullPrice(result) ? 'full'
      : o.status === 'priced' || (o.status === 'quoteOnRequest' && o.breakdown.length > 0) ? 'partial' : 'none';
  const canCheckDup = canAddProduct && addPriced !== 'none' && addCode !== '';
  // รหัสที่มีในระบบแล้ว ⇒ เตือนตั้งแต่ยังไม่กด (เจ้าของสั่งตอนเคาะ mockup) — ถาม `/suggest` ตัวเดียวกับหน้าต่างเพิ่มสินค้า
  // จึงใช้เกณฑ์เดียวกับด่านตอนบันทึก (`findProductsByModel`) · ตรวจไม่สำเร็จ = ไม่บล็อก เพราะหน้าต่างกับ server ตรวจซ้ำ
  useEffect(() => {
    if (!canCheckDup) return;
    let cancelled = false;
    (async () => {
      let rows: DupRow[] = [];
      try {
        const res = await fetch(`/api/admin/webquote/products/suggest?${new URLSearchParams({ model: addCode })}`, { headers: authHeaders });
        const body = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(body?.duplicate)) rows = body.duplicate;
      } catch {
        // ปล่อยว่าง — ดูเหตุผลข้างบน
      }
      if (!cancelled) setDup({ code: addCode, rows });
    })();
    return () => { cancelled = true; };
  }, [canCheckDup, addCode, authHeaders]);
  const dupRows = dup && dup.code === addCode ? dup.rows : [];
  // แถวที่ model ชนมีได้หลายแถว (สินค้าเพิ่มเองที่ Odoo ส่งกลับมาแล้ว) — บอกตัวของ Odoo ก่อน
  const dupRow = dupRows.find((r) => r.source !== 'local') ?? dupRows[0] ?? null;
  const fromPricing: FromPricing = {
    price: addPriced === 'full' && o ? { price: o.unitPrice, revision: result?.revision ?? null } : null,
    description: offCodeText(form, tsForm, catalog, catalogTs),
    picks,
  };

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
            ? `สมุดราคา ${overview.book.models} รุ่น · ${overview.edited ? `แก้ล่าสุด ${formatDateTime(overview.edited.at)}` : (overview.version ?? '')}`
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
          <Button variant="primary" icon={Calculator} busy={busy}
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

        {/* ── 2. ช่องกรอกตามแคตตาล็อก + ราคา — ทุกรหัสหน้าตาเดียวกัน (2026-10-01) ──────────── */}
        {catalogMode && (
          <div className="mt-3.5 pt-3.5 border-t border-slate-100">
            {bhMode && form ? (
              <CatalogTemplate catalog={catalog} families={families} form={form} onChange={editForm} onFamily={pickFamily} />
            ) : tsSpec && tsForm ? (
              <TsCatalogTemplate spec={tsSpec} families={families} form={tsForm} onChange={editTsForm} onFamily={pickFamily}
                                 status={result?.outcome?.status} />
            ) : (
              <NoModelTemplate families={families} onFamily={pickFamily} />
            )}
            {result && (
              <CatalogResult result={result} notIncluded={notIncluded} onAdd={setAdding} canEditBook={canEditBook}
                             askSheet={resultSheet} onAsk={openAsk} />
            )}
            {result && canAddProduct && (
              <ProductAddRow
                code={addCode}
                priced={addPriced}
                dup={dupRow}
                savedRef={saved && saved.code === addCode ? saved.ref : null}
                canOpenLocalProducts={canOpenLocalProducts}
                onOpenLocalProducts={onOpenLocalProducts}
                onAdd={() => setAddOpen(true)}
              />
            )}
          </div>
        )}
      </div>

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

      {addOpen && (
        <LocalProductModal
          initialModel={addCode}
          fromPricing={fromPricing}
          saveLabel="เพิ่มสินค้า"
          authHeaders={authHeaders}
          onClose={() => setAddOpen(false)}
          onSaved={(p, ref) => {
            setAddOpen(false);
            // คนแก้ model ในหน้าต่างได้ — แถบเขียวผูกกับรหัสที่หน้านี้คิด เฉพาะเมื่อเพิ่มด้วย model เดียวกัน
            if (p.model.trim() === addCode) setSaved({ code: addCode, ref });
          }}
        />
      )}
    </div>
  );
};

const BAND = 'flex flex-wrap items-start gap-x-2 gap-y-1.5 rounded-lg px-3 py-2 text-xs border';
const TAG = 'inline-block px-1.5 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap align-middle';
const LINK = 'font-semibold text-[11.5px] text-[var(--brand-fg)] hover:underline';

/**
 * ปุ่ม "เพิ่มเป็นสินค้าใหม่" ใต้ราคา (mockup `pricing-add-product` รอบ 3 · เจ้าของยืนยัน 2026-10-02)
 * โผล่เฉพาะคนที่มี `quote.manage_products` (ผู้เรียกกันไว้) · ปุ่มรองสีน้ำเงิน + ไอคอนบวก เหมือน "เพิ่มค่าบริการ"
 *
 * ปุ่มกดไม่ได้สองกรณี และบอกเหตุผลข้างปุ่มเสมอ (ปุ่มจางที่ไม่บอกเหตุผล = คนสรุปว่าระบบพัง):
 *   · คิดราคาไม่ได้เลย / ไม่รับผลิต
 *   · **รหัสนี้มีในระบบแล้ว** — แถบเหลืองเตือนตั้งแต่ยังไม่กด และไม่เปิดหน้าต่าง (เจ้าของ: "ไม่ต้องมี modal")
 * ระหว่างที่ยังตรวจรหัสซ้ำไม่เสร็จ ปุ่มยังกดได้ — ไม่ให้ปุ่มกะพริบเทาทุกครั้งที่แก้ช่อง · กดทันก่อนตรวจเสร็จ
 * หน้าต่างก็ตรวจเองและ server ปฏิเสธ model ซ้ำอีกชั้น
 */
const ProductAddRow: React.FC<{
  code: string;
  priced: 'full' | 'partial' | 'none';
  dup: DupRow | null;
  /** รหัสของสินค้าที่เพิ่งเพิ่มจากรหัสนี้ — มี = แถบเขียวแทนปุ่ม */
  savedRef: string | null;
  canOpenLocalProducts: boolean;
  onOpenLocalProducts?: () => void;
  onAdd: () => void;
}> = ({ code, priced, dup, savedRef, canOpenLocalProducts, onOpenLocalProducts, onAdd }) => {
  const toLocal = canOpenLocalProducts && onOpenLocalProducts
    ? <button type="button" className={LINK} onClick={onOpenLocalProducts}>ไปหน้าสินค้าเพิ่มเอง ›</button>
    : null;
  if (savedRef !== null) {
    return (
      <div className={`${BAND} mt-2.5 items-center bg-emerald-50 border-emerald-200 text-emerald-800`}>
        <Check className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span className="flex-1 min-w-[200px]">
          <b>เพิ่มสินค้าแล้ว</b> · <span className="font-mono">{savedRef}</span> {code} — ใช้ในใบเสนอราคาได้ทันที
        </span>
        {toLocal}
      </div>
    );
  }
  const why = priced === 'none' ? 'คิดราคาไม่ได้ — แก้รหัสให้คิดราคาได้ก่อน'
    : dup ? 'มีในระบบแล้ว — เพิ่มซ้ำไม่ได้'
      : priced === 'partial' ? 'ราคายังไม่ครบ — ในหน้าต่างจะให้กรอกราคาเอง' : '';
  const local = dup?.source === 'local';
  return (
    <>
      {dup && (
        <div className={`${BAND} mt-2.5 items-center bg-amber-50 border-amber-200 text-amber-800`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span className="flex-1 min-w-[200px]">
            <b>รหัสนี้มีในระบบแล้ว</b> — <span className="font-mono">{dup.internal_reference}</span> {dup.name}{' '}
            {local
              ? <span className={`${TAG} bg-amber-100 text-amber-800 border-amber-300`}>สินค้าเพิ่มเอง · ยังไม่เข้า Odoo</span>
              : <span className={`${TAG} bg-emerald-50 text-emerald-700 border-emerald-200`}>Odoo</span>}
            {' '}· ใช้สินค้าตัวนี้ในใบได้เลย ไม่ต้องเพิ่มซ้ำ
          </span>
          {local && toLocal}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
        {why && <span className="text-[11px] text-slate-400">{why}</span>}
        <Button variant="secondary" icon={Plus} disabled={priced === 'none' || !!dup} onClick={onAdd}>
          เพิ่มเป็นสินค้าใหม่
        </Button>
      </div>
    </>
  );
};

/**
 * ราคาใต้ช่องกรอก (mockup แบบ A) — เงินแต่ละก้อนเป็นชิปต่อกันด้วย "+" แล้วยอดรวมด้านขวา
 * ของที่ไม่มีผลกับราคารวมเป็นบรรทัดจางบรรทัดเดียว · ป้ายเตือนขึ้นเฉพาะตอนมีเรื่องจริง
 * ที่มาละเอียดทุกบาทอยู่ในการ์ด "วิธีคำนวณทีละขั้น" ข้างล่างเหมือนเดิม
 *
 * แถบเตือนเรียงตามความหนัก (mockup `pricing-one-form.html`): แดง = คิดไม่ได้ · ส้ม = ต้องขอราคาจากฝ่ายผลิต (+ ปุ่มไปใส่ราคา
 * ที่หน้าชีต) · เหลือง = ยังไม่รวมในราคา (+ ปุ่ม "＋ เพิ่ม" ของท่อนที่อ่านไม่ออก — เดิมอยู่ในการ์ด "ระบบอ่านรหัสนี้ว่าอะไร") · ฟ้า = แจ้งให้รู้
 * ต้องขอราคาแต่คิดบางส่วนได้ = โชว์ "ราคาเท่าที่คิดได้" (เจ้าของสั่ง 2026-10-01 ตอนเคาะ mockup)
 */
const CatalogResult: React.FC<{
  result: QuoteResult; notIncluded: Missing[]; onAdd: (subCode: string) => void; canEditBook: boolean;
  /** ชีตของรุ่น — ปุ่ม "ใส่ราคาที่หน้าชีต" ของค่าที่ต้องขอราคา (ขึ้นเฉพาะคนที่เปิดสมุดราคาได้) */
  askSheet?: string; onAsk: () => void;
}> = ({ result, notIncluded, onAdd, canEditBook, askSheet, onAsk }) => {
  const o = result.outcome;
  const priced = o?.status === 'priced';
  const partialAsk = o?.status === 'quoteOnRequest' && o.breakdown.length > 0;
  const free = result.parsed.parts.filter((p) => p.kind === 'noPrice').map((p) => p.reads.split(' — ')[0]);
  const blocks = [...(o?.violations ?? []).filter((v) => v.level === 'block').map((v) => v.message), ...result.parsed.problems];
  const asks = (o?.violations ?? []).filter((v) => v.level === 'quoteOnRequest');
  const infos = [...(o?.violations ?? []).filter((v) => v.level === 'warn' && !v.partial).map((v) => v.message), ...result.parsed.warnings];
  // ปุ่มไปใส่ราคาขึ้นที่แถบส้มแถบแรกที่มาจากค่านอกแคตตาล็อกเท่านั้น (ทุกแถบพาไปหน้าชีตเดียวกัน)
  const askBtnAt = canEditBook && askSheet ? asks.findIndex((v) => v.askPrice) : -1;
  const band = BAND;
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
          <div className={`text-[11.5px] ${partialAsk ? 'text-orange-700 font-semibold' : priced && notIncluded.length ? 'text-amber-700 font-semibold' : 'text-slate-500'}`}>
            {partialAsk ? 'ราคาเท่าที่คิดได้ — ยังไม่รวมส่วนที่ต้องขอราคา'
              : !priced ? '' : notIncluded.length ? 'ราคาเฉพาะส่วนที่คำนวณได้' : 'ราคาตั้งต่อหน่วย (ยังไม่รวมส่วนลด)'}
          </div>
          <div className="text-[26px] font-extrabold text-slate-900 tabular-nums leading-tight">
            {priced || partialAsk
              ? <>{o!.unitPrice.toLocaleString()}<span className="text-[13px] font-semibold text-slate-500 ml-1.5">บาท</span></>
              : <span className="text-[17px] text-red-700">{notPricedTitle(o)}</span>}
          </div>
        </div>
      </div>
      {(blocks.length + asks.length + notIncluded.length + infos.length) > 0 && (
        <div className="mt-2.5 grid gap-1.5">
          {blocks.map((t) => (
            <div key={`b-${t}`} className={`${band} bg-red-50 border-red-200 text-red-700`}>{t}</div>
          ))}
          {asks.map((v, i) => {
            const btn = i === askBtnAt;
            return (
              <div key={`a-${v.id}`} className={`${band} items-center bg-orange-50 border-orange-200 text-orange-700`}>
                <span className="flex-1 min-w-[220px]"><b>{v.message}</b>{btn && ' · ได้ราคาแล้ว ใส่ได้ที่'}</span>
                {btn && <Button size="sm" icon={BookOpen} onClick={onAsk}>สมุดราคา › {askSheet} › ต้องขอราคา</Button>}
              </div>
            );
          })}
          {notIncluded.map((m) => (
            <div key={`n-${m.text}`} className={`${band} items-center bg-amber-50 border-amber-200 text-amber-800`}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span className="flex-1 min-w-[200px]"><b>ยังไม่รวมในราคา</b> — {m.text}</span>
              {m.add && (
                <Button variant="primary" onClick={() => onAdd(m.add!)}
                        title="ยังไม่รู้ว่าแปลว่าอะไร ห้ามเดา — ตั้งค่าแล้วรหัสอื่นทั้งหมดที่มีตัวอักษรนี้จะคิดตามทันที">
                  ＋ เพิ่ม {m.add}
                </Button>
              )}
            </div>
          ))}
          {infos.map((t) => (
            <div key={`i-${t}`} className={`${band} bg-sky-50 border-sky-200 text-sky-800`}>{t}</div>
          ))}
        </div>
      )}
    </div>
  );
};
