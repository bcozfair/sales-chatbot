// ─────────────────────────────────────────────────────────────────────────────
//  หน้าต่าง "เพิ่มสินค้าใหม่" / "แก้ไขสินค้าเพิ่มเอง" — เฟส J6 ของ docs/plan-local-products.md (§13)
//
//  **หน้าต่างเดียว สองทางเข้า** (ไม่มีฟอร์มสองชุด):
//    1. หน้าขอใบเสนอราคา — แถว "+ เพิ่มสินค้าใหม่" ท้ายรายการผลค้นสินค้า ⇒ เพิ่มเสร็จ = ใส่ลงแถวนั้นทันที
//    2. หน้า "สินค้าเพิ่มเอง" — ปุ่ม "เพิ่มสินค้าใหม่" + ไอคอนแก้ไขในแถว
//  หน้าตาตาม mockup `local-product-add` ที่เจ้าของยืนยัน 2026-10-02 (+ ช่อง % ราคาขั้นต่ำ รอบเดียวกัน)
//
//  ── กรอกจริงสองช่อง: model + ราคาขาย ───────────────────────────────────────
//  ต้นแบบ · รหัส · ชื่อ · หมวดหมู่ มาจาก `GET /suggest` ทั้งหมด — **ไม่มีตรรกะเลือกต้นแบบ/ออกรหัส/ตั้งชื่อในไฟล์นี้**
//  และ `POST /` คำนวณซ้ำฝั่ง server เสมอ (หน้าจอคือคนเสนอ server คือคนตัดสิน §13.1)
//  · ราคาขั้นต่ำ = ราคาขาย × % (ค่าตั้งต้นจาก server `min_price_ratio`) — เลขที่ส่งไปคือบาท ไม่ใช่ %
//  · ที่มาของราคา (สมุดราคา/กำหนดเอง) **server ตัดสิน** จาก `pricebook_price` ที่ส่งไปคู่กัน (ด่านข้อ 17)
//    ป้ายบนจอเป็นแค่การบอกล่วงหน้าด้วยกติกาเดียวกัน (ราคาเท่ากันทุกสตางค์)
//
//  ── สิ่งที่หน้าต่างนี้ห้ามตัดทิ้ง ─────────────────────────────────────────────
//  · **คำเตือน "ระบบไม่แน่ใจรหัสนี้" + ช่องติ๊ก "ตรวจรหัสแล้ว"** (tier `max_plus_one`) — เจ้าของเอาป้ายเตือนออกจาก
//    หน้ารายการเพราะ "คนต้องตรวจก่อนกดยืนยันก่อนเพิ่มสินค้าอยู่แล้ว" ⇒ ที่นี่คือจุดเดียวที่เหลือ (แผน §4.1)
//  · **ต้นแบบที่เลือกให้ต้องโชว์ชื่อ + รหัส + ปุ่ม "เปลี่ยน" เสมอ** — ตระกูลรวมอย่าง Buy to Sell เลือกพลาดได้ (§13.2)
//  · **ราคา 0 ใช้ไม่ได้** — ผลคิดราคาที่ไม่ใช่ `priced` หรือได้ 0 ไม่มีปุ่ม "ใช้ราคานี้" (§13.5)
//
//  ── สิ่งที่จงใจไม่มี ──────────────────────────────────────────────────────────
//  · ช่อง `production` — ปล่อยว่างตามข้อตัดสิน §2.1 (ไม่งั้นติดกฎบล็อกทันที)
//  · การลอก `sales_description` จากต้นแบบ — ของต้นแบบเป็นสเปกของรุ่นนั้น (§13.4)
//  · ปุ่มคิดราคาไม่ import `pricingLab` — ยิง `POST /price` ซึ่งเป็นตัวจัดการเดียวกับหน้าคำนวณราคา (§13.5)
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Calculator, Loader2, Lock, Search, ChevronRight } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { describeApiError } from './apiError';
import type { PickedProduct } from './localProducts';

interface ParentBrief {
  product_template_id: number;
  internal_reference: string;
  model: string;
  name: string;
}

interface RefSuggestion {
  internal_reference: string;
  tier: 'boundary' | 'max_plus_one';
  prefix_length: number;
  siblings: number;
  warning: string | null;
}

/** ก้อนของ `GET /suggest` — เท่าที่จอใช้ (ตัวเต็ม: `suggestLocalProduct()` ใน services/localProducts.ts) */
interface Suggestion {
  model: string;
  duplicate: ParentBrief[];
  is_custom: boolean;
  parent: ParentBrief | null;
  parent_reason: 'key' | 'key_bare' | 'chosen' | null;
  group_size: number;
  group_key: string | null;
  ref: RefSuggestion | null;
  ref_message: string | null;
  name: string;
  inherited: Record<string, string | null>;
  min_price_ratio: number;
}

/** แถวที่ `GET /:id` คืน — โหมดแก้ไข */
interface EditRow {
  product_template_id: number;
  internal_reference: string;
  ref_tier: 'boundary' | 'max_plus_one' | 'manual';
  model: string;
  name: string;
  sales_description: string | null;
  sales_price: number;
  minimum_sales_price: number;
  price_source: 'pricebook' | 'manual';
  pricebook_price: number | null;
  odoo_matched_at: string | null;
  quotation_count: number;
  parent: ParentBrief | null;
  min_price_ratio: number;
  brand: string | null;
  series: string | null;
  product_group: string | null;
  product_category: string | null;
  product_sub_category: string | null;
  unit_of_measure: string | null;
}

/** ผลของปุ่มคิดราคา — ย่อจาก `{ parsed, outcome, revision }` ของ `POST /price` */
type PriceResult =
  | { kind: 'priced'; price: number; lines: { text: string; amount: number }[]; revision: number | null }
  | { kind: 'partial'; price: number; notes: string[] }
  | { kind: 'none'; why: string }
  | { kind: 'error'; message: string };

interface Props {
  /** `null` = เพิ่มใหม่ · มีค่า = แก้ไข (product_template_id ของแถว local) */
  editId?: number | null;
  /** คำที่พิมพ์ค้างในช่องค้น — เป็น model ตั้งต้น (โหมดเพิ่ม) */
  initialModel?: string;
  /** คำบนปุ่มบันทึกของโหมดเพิ่ม — ในใบ = "เพิ่มและใส่ลงใบ" · หน้ารายการ = "เพิ่มสินค้า" */
  saveLabel?: string;
  authHeaders: Record<string, string>;
  onClose: () => void;
  /** บันทึกสำเร็จ — ในใบ: ใส่ลงแถว · หน้ารายการ: โหลดใหม่ */
  onSaved: (p: PickedProduct) => void;
  /** model ซ้ำกับสินค้าที่มีอยู่ ⇒ "ใช้สินค้านี้ในใบ" (มีเฉพาะทางเข้าจากใบ) */
  onUseExisting?: (p: PickedProduct) => void;
}

const MAX = { model: 200, name: 300, sales_description: 2000 };

const INPUT_CLS =
  'w-full h-9 px-3 rounded-xl border border-slate-200 bg-card text-sm text-slate-800 outline-none ' +
  'focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/20 ' +
  'disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed';
const LABEL_CLS = 'flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1.5';
const HINT_CLS = 'text-[11px] text-slate-400 mt-1';
const TAG = 'inline-block px-1.5 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap';
const BOX = 'rounded-xl border px-3 py-2 text-xs leading-relaxed';

/** "1,234.5" → 1234.5 · ว่าง/อ่านไม่ออก = NaN */
const toNum = (s: string): number => (s.trim() === '' ? NaN : Number(s.replace(/,/g, '')));
const money2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** ปัดเป็นสตางค์ — ตรงกับ `money()` ฝั่ง server */
const satang = (n: number) => Math.round(n * 100) / 100;

const INHERITED_LABEL: [string, string][] = [
  ['brand', 'แบรนด์'], ['series', 'ซีรีส์'], ['product_group', 'กลุ่ม'],
  ['product_category', 'หมวด'], ['product_sub_category', 'หมวดย่อย'], ['unit_of_measure', 'หน่วย'],
];

/** แปลงคำตอบของ `POST /price` เป็นสิ่งที่จอโชว์ — ไม่คิดเลขเอง แค่หยิบของที่ตัวคิดราคาคืนมา */
function toPriceResult(body: {
  parsed?: { problems?: string[] };
  outcome?: {
    status: string;
    unitPrice: number;
    breakdown?: { label: string; detail?: string; amount: number }[];
    violations?: { message: string }[];
  } | null;
  revision?: number | null;
}): PriceResult {
  const o = body.outcome;
  if (!o) {
    return { kind: 'none', why: (body.parsed?.problems ?? []).join(' · ') };
  }
  if (o.status === 'priced' && o.unitPrice > 0) {
    return {
      kind: 'priced',
      price: o.unitPrice,
      lines: (o.breakdown ?? []).map((b) => ({ text: b.detail ? `${b.label} · ${b.detail}` : b.label, amount: b.amount })),
      revision: body.revision ?? null,
    };
  }
  return { kind: 'partial', price: o.unitPrice, notes: (o.violations ?? []).map((v) => v.message) };
}

export const LocalProductModal: React.FC<Props> = ({
  editId = null, initialModel = '', saveLabel = 'เพิ่มสินค้า', authHeaders, onClose, onSaved, onUseExisting,
}) => {
  const editing = editId !== null;

  const [model, setModel] = useState(editing ? '' : initialModel.trim());
  const [sug, setSug] = useState<Suggestion | null>(null);
  const [sugLoading, setSugLoading] = useState(!editing && initialModel.trim() !== '');
  const [sugError, setSugError] = useState<string | null>(null);

  /** คนเลือกต้นแบบเอง — `null` = ใช้ตัวที่ระบบเลือก */
  const [chosenParent, setChosenParent] = useState<string | null>(null);
  const [pickingParent, setPickingParent] = useState(false);
  const [parentQ, setParentQ] = useState('');
  const [parentHits, setParentHits] = useState<ParentBrief[]>([]);
  const [parentLoading, setParentLoading] = useState(false);

  const [manualRef, setManualRef] = useState(false);
  const [refText, setRefText] = useState('');
  const [refChecked, setRefChecked] = useState(false);

  const [nameEdited, setNameEdited] = useState(false);
  const [name, setName] = useState('');

  const [price, setPrice] = useState('');
  const [pct, setPct] = useState('');
  /** คนพิมพ์ราคาขั้นต่ำเป็นบาทเอง — `null` = คิดจาก % */
  const [minManual, setMinManual] = useState<string | null>(null);
  const [quote, setQuote] = useState<PriceResult | null>(null);
  const [quoting, setQuoting] = useState(false);
  /** ราคาจากสมุดที่ได้ล่าสุด — ส่งให้ server ตัดสินที่มาของราคา · `undefined` (โหมดแก้ไข) = ไม่แตะของเดิม */
  const [bookPrice, setBookPrice] = useState<{ price: number; revision: number | null } | null | undefined>(
    editing ? undefined : null,
  );

  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [row, setRow] = useState<EditRow | null>(null);
  const [loading, setLoading] = useState(editing);

  // ── โหมดแก้ไข: โหลดแถวเดิม ─────────────────────────────────────────────────
  useEffect(() => {
    if (editId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/webquote/products/${editId}`, { headers: authHeaders });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(describeApiError(body, 'โหลดข้อมูลสินค้าไม่สำเร็จ'));
          return;
        }
        const p: EditRow = body.product;
        setRow(p);
        setModel(p.model);
        setName(p.name);
        setNameEdited(true);
        setPrice(String(p.sales_price));
        setDesc(p.sales_description ?? '');
        // % ของแถวเดิม = ขั้นต่ำ ÷ ราคาขาย (ทศนิยมหนึ่งตำแหน่ง) · ราคาขั้นต่ำที่โชว์คือค่าที่เก็บไว้จริง
        setPct(String(p.sales_price > 0 ? Math.round((p.minimum_sales_price / p.sales_price) * 1000) / 10 : p.min_price_ratio * 100));
        setMinManual(money2(p.minimum_sales_price));
      } catch {
        if (!cancelled) setError('ติดต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่อีกครั้ง');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editId, authHeaders]);

  // ── โหมดเพิ่ม: ขอคำแนะนำทุกครั้งที่ model/ต้นแบบเปลี่ยน (หน่วงไว้ ไม่ยิงทุกตัวอักษร) ─────────
  useEffect(() => {
    if (editing) return;
    const m = model.trim();
    if (!m) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ model: m });
        if (chosenParent) params.set('parent', chosenParent);
        const res = await fetch(`/api/admin/webquote/products/suggest?${params}`, { headers: authHeaders });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setSug(null);
          setSugError(describeApiError(body, 'หาข้อมูลตั้งต้นไม่สำเร็จ'));
          return;
        }
        const s: Suggestion = body;
        setSug(s);
        setSugError(null);
        setPct((p) => (p === '' ? String(Math.round(s.min_price_ratio * 1000) / 10) : p));
        // ระบบออกรหัสให้ไม่ได้ ⇒ เปิดช่องพิมพ์เองให้เลย ไม่ปล่อยให้กดบันทึกแล้วค่อยเจอ 409
        if (!s.ref) setManualRef(true);
      } catch {
        if (!cancelled) setSugError('ติดต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่อีกครั้ง');
      } finally {
        if (!cancelled) setSugLoading(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [editing, model, chosenParent, authHeaders]);

  // ── ค้นต้นแบบเอง ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pickingParent) return;
    const q = parentQ.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/webquote/products/parents?q=${encodeURIComponent(q)}`, { headers: authHeaders });
        const body = await res.json().catch(() => ({}));
        if (!cancelled) setParentHits(res.ok && Array.isArray(body.items) ? body.items.slice(0, 8) : []);
      } finally {
        if (!cancelled) setParentLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [pickingParent, parentQ, authHeaders]);

  // ── ค่าที่คำนวณจาก state ─────────────────────────────────────────────────────
  const priceNum = toNum(price);
  const pctNum = toNum(pct);
  const minText = minManual ?? (priceNum > 0 && pctNum >= 0 ? money2(satang((priceNum * pctNum) / 100)) : '');
  const minNum = toNum(minText);
  const lockedByOdoo = !!row?.odoo_matched_at;
  // แถวเดิมยังไม่โหลด = ยังไม่รู้ว่ามีใบอ้างไหม ⇒ ถือว่าล็อกไว้ก่อน
  const modelLocked = editing && (row === null || row.quotation_count > 0);
  const shownName = editing || nameEdited ? name : sug?.name ?? model.trim();
  const refTyped = refText.trim().toUpperCase();
  const refTypedOk = /^[A-Z0-9]{14}$/.test(refTyped);
  const needCheck = !editing && !manualRef && sug?.ref?.tier === 'max_plus_one';
  const dup = !editing && sug && sug.duplicate.length > 0 ? sug.duplicate[0] : null;
  const sugFresh = !editing && !!sug && sug.model === model.trim();

  /** ป้ายที่มาของราคา — กติกาเดียวกับ `decidePriceSource()` ฝั่ง server (เท่ากันทุกสตางค์ = สมุดราคา) */
  const priceTag = useMemo(() => {
    if (!(priceNum > 0)) return null;
    const book = bookPrice === undefined ? (row?.pricebook_price ?? null) : bookPrice?.price ?? null;
    return book !== null && Math.round(book * 100) === Math.round(priceNum * 100) ? 'book' : 'manual';
  }, [priceNum, bookPrice, row]);

  /** เหตุผลที่ปุ่มบันทึกยังกดไม่ได้ — ปุ่มจางที่ไม่บอกเหตุผลคือปุ่มที่คนสรุปว่าระบบพัง */
  const blockedBecause = ((): string | null => {
    if (loading) return 'กำลังโหลด…';
    if (lockedByOdoo) return 'สินค้านี้เข้า Odoo แล้ว — แก้ที่ Odoo แทน';
    if (!model.trim()) return 'ต้องกรอก model';
    if (!editing) {
      if (sugLoading || !sugFresh) return 'กำลังหาข้อมูลตั้งต้น…';
      if (dup) return 'model นี้มีอยู่แล้ว';
      if (manualRef ? !refTypedOk : !sug?.ref) return 'รหัสสินค้าต้องเป็นตัวอักษร A–Z หรือตัวเลข 14 ตัว';
      if (!manualRef && !sug?.parent) return 'ต้องเลือกต้นแบบ หรือพิมพ์รหัสเอง';
      if (needCheck && !refChecked) return 'ติ๊ก “ตรวจรหัสแล้ว” ก่อน';
    }
    if (!shownName.trim()) return 'ชื่อสินค้าว่างไม่ได้';
    if (!(priceNum > 0)) return 'กรอกราคาขายก่อน';
    if (!(minNum >= 0)) return 'ราคาขั้นต่ำไม่ถูกต้อง';
    return null;
  })();

  // ── เหตุการณ์ ──────────────────────────────────────────────────────────────
  const onModelChange = (v: string) => {
    setModel(v);
    setError(null);
    // model เปลี่ยน = ผลคิดราคาเดิมไม่ใช่ของรุ่นนี้แล้ว · ราคาที่กรอกไว้คงไว้ (คนตั้งใจพิมพ์)
    setQuote(null);
    if (!editing) {
      setBookPrice(null);
      setRefChecked(false);
      setChosenParent(null);
      setSugLoading(v.trim() !== '');
    }
  };

  const chooseParent = (p: ParentBrief) => {
    setChosenParent(p.internal_reference);
    setPickingParent(false);
    setParentQ('');
    setParentHits([]);
    setManualRef(false);
    setRefChecked(false);
    setSugLoading(true);
  };

  const onPriceChange = (v: string) => {
    setPrice(v);
    // พิมพ์ราคาขายใหม่ ⇒ ราคาขั้นต่ำกลับไปคิดจาก % (บาทที่พิมพ์ไว้ผูกกับราคาเดิม · % ตามบาทนั้นไปแล้ว)
    setMinManual(null);
  };

  const onPctChange = (v: string) => {
    setPct(v);
    setMinManual(null);
  };

  const onMinChange = (v: string) => {
    setMinManual(v);
    const m = toNum(v);
    if (priceNum > 0 && m >= 0) setPct(String(Math.round((m / priceNum) * 1000) / 10));
  };

  const runQuote = async () => {
    setQuoting(true);
    setQuote(null);
    try {
      const res = await fetch('/api/admin/webquote/products/price', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: model.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setQuote({ kind: 'error', message: describeApiError(body, 'คิดราคาไม่สำเร็จ') });
        return;
      }
      const r = toPriceResult(body);
      setQuote(r);
      setBookPrice(r.kind === 'priced' ? { price: r.price, revision: r.revision } : null);
    } catch {
      setQuote({ kind: 'error', message: 'ติดต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่อีกครั้ง' });
    } finally {
      setQuoting(false);
    }
  };

  const applyBookPrice = () => {
    if (quote?.kind !== 'priced') return;
    setPrice(String(quote.price));
    setMinManual(null);
  };

  /** model ซ้ำ ⇒ หาแถวเดิมจากช่องค้นตัวเดียวกับใบ (ได้ราคา/สต็อกครบ) แล้วส่งให้ใบใช้ */
  const pickExisting = async () => {
    if (!dup || !onUseExisting) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(dup.model)}&limit=12`);
      const hits: PickedProduct[] = res.ok ? await res.json() : [];
      const hit = Array.isArray(hits) ? hits.find((h) => h.product_id === dup.product_template_id) ?? hits.find((h) => h.model === dup.model) : null;
      if (hit) onUseExisting(hit);
      else setError('หาสินค้าเดิมในรายการค้นหาไม่เจอ — ลองพิมพ์ค้นในช่องสินค้าอีกครั้ง');
    } catch {
      setError('ติดต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่อีกครั้ง');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (blockedBecause) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: shownName,
        sales_price: satang(priceNum),
        minimum_sales_price: satang(minNum),
        sales_description: desc.trim() || null,
      };
      if (bookPrice !== undefined) {
        payload.pricebook_price = bookPrice?.price ?? null;
        payload.price_book_revision = bookPrice?.revision ?? null;
      }
      if (editing) {
        if (!modelLocked) payload.model = model.trim();
      } else {
        payload.model = model.trim();
        if (manualRef) {
          payload.ref_manual = true;
          payload.internal_reference = refTyped;
        } else {
          payload.internal_reference = sug!.ref!.internal_reference;
        }
        if (sug?.parent) payload.parent_reference = sug.parent.internal_reference;
      }
      const res = await fetch(
        editing ? `/api/admin/webquote/products/${editId}` : '/api/admin/webquote/products',
        { method: editing ? 'PUT' : 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      );
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body?.code === 'REF_CHANGED' && body?.detail?.ref && sug) {
        // มีคนเพิ่มสินค้าตระกูลเดียวกันแทรกไปก่อน — พรีวิวไม่ใช่การจอง (§1.4) ⇒ เปลี่ยนเป็นรหัสใหม่ให้คนดูก่อนกดซ้ำ
        setSug({ ...sug, ref: body.detail.ref });
        setRefChecked(false);
        setError(`${body.error} — เปลี่ยนรหัสให้แล้ว ตรวจแล้วกดบันทึกอีกครั้ง`);
        return;
      }
      if (res.status === 409 && body?.code === 'DUPLICATE_MODEL' && Array.isArray(body?.detail?.rows) && sug) {
        setSug({ ...sug, duplicate: body.detail.rows });
        return;
      }
      if (!res.ok) {
        setError(describeApiError(body, editing ? 'บันทึกไม่สำเร็จ' : 'เพิ่มสินค้าไม่สำเร็จ'));
        return;
      }
      const p = body.product;
      onSaved({ product_id: Number(p.product_template_id), model: String(p.model), name: String(p.name), price: Number(p.sales_price), stock: 0 });
    } catch {
      setError('ติดต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่อีกครั้ง');
    } finally {
      setBusy(false);
    }
  };

  // ── ชิ้นส่วนของหน้าต่าง ────────────────────────────────────────────────────
  const parent = editing ? row?.parent ?? null : sug?.parent ?? null;
  const parentWhy = (() => {
    if (!sug || editing) return null;
    if (sug.parent_reason === 'chosen') return 'คุณเลือกเอง';
    const head = sug.group_key ? `เลือกให้จาก ${sug.group_size.toLocaleString('en-US')} สินค้าที่ขึ้นต้น ${sug.group_key}` : 'ระบบเลือกให้';
    return sug.is_custom ? `${head} · แบบสั่งทำ (model มี -S)` : head;
  })();

  const inherited: [string, string][] = INHERITED_LABEL
    .map(([k, label]) => [label, (editing ? (row as unknown as Record<string, string | null> | null)?.[k] : sug?.inherited?.[k]) ?? ''] as [string, string])
    .filter(([, v]) => v);

  const parentSection = (
    <div>
      <div className={LABEL_CLS}>ต้นแบบ</div>
      {!pickingParent && parent ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-slate-800 truncate" title={parent.name}>{parent.name}</div>
            <div className="text-[11px] text-slate-500 truncate" title={parentWhy ?? undefined}>
              <span className="font-mono">{parent.internal_reference}</span>
              {parentWhy && <> · {parentWhy}</>}
            </div>
          </div>
          {!editing && (
            <Button variant="neutral" onClick={() => { setPickingParent(true); setParentQ(''); setParentHits([]); }}>
              เปลี่ยน
            </Button>
          )}
        </div>
      ) : editing ? (
        <p className="text-xs text-slate-400">—</p>
      ) : (
        <div className="space-y-1.5">
          {!parent && sugFresh && (
            <div className={`${BOX} border-amber-200 bg-amber-50 text-amber-800`}>
              ระบบหาสินค้าที่ใกล้เคียงไม่เจอ — ค้นต้นแบบเองด้วยรหัส ชื่อ หรือ model
            </div>
          )}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus={pickingParent}
              value={parentQ}
              onChange={(e) => {
                setParentQ(e.target.value);
                if (!pickingParent) setPickingParent(true);
                setParentLoading(e.target.value.trim().length >= 2);
                if (e.target.value.trim().length < 2) setParentHits([]);
              }}
              placeholder="พิมพ์รหัส ชื่อ หรือ model ของสินค้าที่ใกล้เคียง"
              aria-label="ค้นต้นแบบ"
              className={`${INPUT_CLS} pl-8`}
            />
          </div>
          {(parentLoading || parentHits.length > 0) && (
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden max-h-56 overflow-y-auto">
              {parentLoading && parentHits.length === 0 ? (
                <p className="flex items-center gap-2 px-3 py-2.5 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังค้นหา…</p>
              ) : parentHits.map((h) => (
                <button key={h.product_template_id} type="button" onClick={() => chooseParent(h)}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-slate-800 truncate">{h.model}</span>
                    <span className="block text-[11px] text-slate-500 truncate">{h.name}</span>
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 shrink-0">{h.internal_reference}</span>
                </button>
              ))}
            </div>
          )}
          <p className={HINT_CLS}>
            ต้นแบบใช้ตั้งรหัส ชื่อ และหมวดหมู่ให้
            {parent && <> · <button type="button" className="font-semibold text-[var(--brand-fg)]" onClick={() => setPickingParent(false)}>ใช้ตัวที่ระบบเลือก</button></>}
            {!parent && !manualRef && <> — หรือ <button type="button" className="font-semibold text-[var(--brand-fg)]" onClick={() => setManualRef(true)}>ข้ามไปพิมพ์รหัสเอง</button></>}
          </p>
        </div>
      )}
    </div>
  );

  const refSection = (
    <div>
      <div className={LABEL_CLS}>รหัสสินค้า</div>
      {editing ? (
        <div className="flex items-center gap-2 h-9 px-3 rounded-xl border border-slate-200 bg-slate-50">
          <span className="font-mono text-[13px] font-semibold text-[var(--brand-fg)]">{row?.internal_reference}</span>
          {row && (row.ref_tier === 'manual'
            ? <span className={`${TAG} bg-blue-50 text-blue-700 border-blue-200`}>กำหนดเอง</span>
            : <span className={`${TAG} bg-emerald-50 text-emerald-700 border-emerald-200`}>อัตโนมัติ</span>)}
          <span className="ml-auto text-[11px] text-slate-400 truncate">เปลี่ยนรหัสใช้ปุ่ม “ออกรหัสใหม่”</span>
        </div>
      ) : manualRef || !sug?.ref ? (
        <>
          {sugFresh && sug?.parent && !sug.ref && sug.ref_message && (
            <div className={`${BOX} border-amber-200 bg-amber-50 text-amber-800 mb-1.5`}>{sug.ref_message}</div>
          )}
          <input
            value={refText}
            onChange={(e) => setRefText(e.target.value)}
            maxLength={20}
            placeholder="14 ตัว เช่น FTGP1TGM66011S"
            aria-label="รหัสสินค้า (พิมพ์เอง)"
            className={`${INPUT_CLS} font-mono uppercase`}
          />
          <p className={HINT_CLS}>
            ตัวอักษร A–Z และตัวเลข 14 ตัว · ระบบตรวจว่าไม่ซ้ำตอนบันทึก
            {sug?.ref && <> · <button type="button" className="font-semibold text-[var(--brand-fg)]" onClick={() => setManualRef(false)}>ใช้รหัสที่ระบบตั้ง</button></>}
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 h-9 px-3 rounded-xl border border-slate-200 bg-slate-50">
            <span className="font-mono text-[13px] font-semibold text-[var(--brand-fg)]">{sug.ref.internal_reference}</span>
            <span className={`${TAG} bg-emerald-50 text-emerald-700 border-emerald-200`}>อัตโนมัติ</span>
            <button type="button" className="ml-auto text-[11.5px] font-semibold text-[var(--brand-fg)]"
                    onClick={() => { setManualRef(true); setRefText(''); }}>
              พิมพ์เอง
            </button>
          </div>
          {sug.ref.tier === 'max_plus_one' ? (
            <div className={`${BOX} border-amber-200 bg-amber-50 text-amber-800 mt-1.5`}
                 title={`นับต่อจากกลุ่ม ${sug.ref.internal_reference.slice(0, sug.ref.prefix_length)}`}>
              <b>ระบบไม่แน่ใจรหัสนี้</b> — {sug.ref.warning}
              <label className="flex items-center gap-2 mt-1.5 font-semibold cursor-pointer">
                <input type="checkbox" checked={refChecked} onChange={(e) => setRefChecked(e.target.checked)} />
                ตรวจรหัสแล้ว ใช้รหัสนี้
              </label>
            </div>
          ) : (
            <p className={HINT_CLS}>ต่อจากเลขล่าสุดของตระกูลนี้ ({sug.ref.siblings.toLocaleString('en-US')} ตัว)</p>
          )}
        </>
      )}
    </div>
  );

  const quoteBox = quote && (
    quote.kind === 'priced' ? (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-emerald-800">ราคาจากสมุดราคา</span>
          <span className="text-base font-bold text-emerald-700 tabular-nums">฿{money2(quote.price)}</span>
          <span className="ml-auto">
            {Math.round(priceNum * 100) === Math.round(quote.price * 100)
              ? <span className="text-[11px] text-emerald-700">ใช้แล้ว</span>
              : <Button variant="primary" onClick={applyBookPrice}>ใช้ราคานี้</Button>}
          </span>
        </div>
        <div className="mt-1.5 pt-1.5 border-t border-dashed border-emerald-200 space-y-0.5">
          {quote.lines.map((l, i) => (
            <div key={i} className="flex justify-between gap-3 text-[11.5px] text-slate-600">
              <span className="truncate min-w-0" title={l.text}>{l.text}</span>
              <span className="tabular-nums whitespace-nowrap">{money2(l.amount)}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          {quote.revision ? `สมุดราคาเล่ม r${quote.revision} · ` : ''}ราคาเดียวกับหน้า “คำนวณราคา”
        </p>
      </div>
    ) : quote.kind === 'partial' ? (
      <div className={`${BOX} border-amber-200 bg-amber-50 text-amber-800`}>
        <b>คิดราคาจากสมุดราคาไม่ครบ</b>{quote.price > 0 ? ` (คิดได้ ฿${money2(quote.price)})` : ''} — กรอกราคาเอง
        {quote.notes.length > 0 && <ul className="list-disc pl-4 mt-1">{quote.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </div>
    ) : quote.kind === 'none' ? (
      <div className={`${BOX} border-sky-200 bg-sky-50 text-sky-800`} title={quote.why}>
        สมุดราคายังไม่มีรุ่นนี้ — กรอกราคาเอง
      </div>
    ) : (
      <div className={`${BOX} border-red-200 bg-red-50 text-red-700`}>{quote.message}</div>
    )
  );

  return (
    <Modal
      icon={editing ? Pencil : Plus}
      title={editing ? 'แก้ไขสินค้าเพิ่มเอง' : 'เพิ่มสินค้าใหม่'}
      size="lg"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="neutral" disabled={busy} onClick={onClose}>{lockedByOdoo ? 'ปิด' : 'ยกเลิก'}</Button>
          {!lockedByOdoo && !dup && (
            <span title={blockedBecause ?? undefined}>
              <Button variant="primary" icon={editing ? Pencil : Plus} busy={busy}
                      disabled={!!blockedBecause} onClick={() => void submit()}>
                {editing ? 'บันทึก' : saveLabel}
              </Button>
            </span>
          )}
        </>
      }
    >
      <div className="p-5 space-y-4">
        <p className="text-xs text-slate-500 -mt-1">
          {editing
            ? (row?.quotation_count ?? 0) > 0
              ? `มีใบเสนอราคาอ้างสินค้านี้ ${row!.quotation_count} ใบ — แก้ชื่อและราคาได้ แต่ model ล็อกแล้ว`
              : 'ยังไม่มีใบเสนอราคาอ้างสินค้านี้ — แก้ได้ทุกช่องยกเว้นรหัส'
            : 'ยังไม่อยู่ใน Odoo · ใบที่มีสินค้านี้จะไปกลุ่ม “ต้องแก้มือก่อน” จนกว่าจะคีย์เข้า Odoo'}
        </p>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลด…</p>
        ) : (
          <>
            <div>
              <label className={LABEL_CLS} htmlFor="lp-model">
                Model <span className="text-red-500">*</span>
                {modelLocked && <span className="ml-auto flex items-center gap-1 font-normal text-slate-400"><Lock className="w-3 h-3" /> มีใบอ้างแล้ว</span>}
                {!editing && sugLoading && <Loader2 className="ml-auto w-3.5 h-3.5 animate-spin text-slate-400" />}
              </label>
              <input id="lp-model" autoFocus={!editing} value={model} maxLength={MAX.model}
                     onChange={(e) => onModelChange(e.target.value)} disabled={modelLocked || lockedByOdoo}
                     className={INPUT_CLS} />
              {sugError && <p className="text-[11px] text-red-600 mt-1">{sugError}</p>}
              {dup && sugFresh && (
                <div className={`${BOX} border-red-200 bg-red-50 text-red-700 mt-1.5`}>
                  <b>model นี้มีอยู่แล้ว</b> — <span className="font-mono">{dup.internal_reference}</span> {dup.name}
                  {onUseExisting && (
                    <div className="mt-1.5">
                      <Button variant="neutral" busy={busy} icon={ChevronRight} onClick={() => void pickExisting()}>ใช้สินค้านี้ในใบ</Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {(editing || (model.trim() && !dup)) && (
              <>
                {parentSection}
                {refSection}

                <div>
                  <label className={LABEL_CLS} htmlFor="lp-name">
                    ชื่อสินค้า
                    {!editing && (nameEdited
                      ? <button type="button" className="ml-auto font-semibold text-[11.5px] text-[var(--brand-fg)]"
                                onClick={() => { setNameEdited(false); setName(''); }}>ตั้งชื่อให้ใหม่</button>
                      : <span className="ml-auto font-normal text-[11px] text-slate-400">ตั้งให้จาก model · แก้ได้</span>)}
                  </label>
                  <input id="lp-name" value={shownName} maxLength={MAX.name} disabled={lockedByOdoo}
                         onChange={(e) => { setName(e.target.value); setNameEdited(true); }} className={INPUT_CLS} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLS} htmlFor="lp-price">
                      ราคาขาย <span className="text-red-500">*</span>
                      {priceTag === 'book' && <span className={`ml-auto ${TAG} bg-emerald-50 text-emerald-700 border-emerald-200`}>จากสมุดราคา</span>}
                      {priceTag === 'manual' && <span className={`ml-auto ${TAG} bg-blue-50 text-blue-700 border-blue-200`}>กำหนดเอง</span>}
                    </label>
                    <div className="flex gap-2">
                      <input id="lp-price" inputMode="decimal" placeholder="0.00" value={price} disabled={lockedByOdoo}
                             onChange={(e) => onPriceChange(e.target.value)} className={`${INPUT_CLS} tabular-nums`} />
                      <Button variant="neutral" icon={Calculator} busy={quoting} disabled={!model.trim() || lockedByOdoo}
                              onClick={() => void runQuote()} className="shrink-0">
                        คิดราคา
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className={LABEL_CLS} htmlFor="lp-min">
                      ราคาขั้นต่ำ
                      <span className="ml-auto font-normal text-[11px] text-slate-400">แก้ได้ทั้งสองช่อง</span>
                    </label>
                    <div className="flex gap-2">
                      <span className="relative w-[84px] shrink-0">
                        <input inputMode="decimal" value={pct} onChange={(e) => onPctChange(e.target.value)} disabled={lockedByOdoo}
                               aria-label="ราคาขั้นต่ำ เป็นเปอร์เซ็นต์ของราคาขาย" className={`${INPUT_CLS} pr-7 text-right tabular-nums`} />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                      </span>
                      <input id="lp-min" inputMode="decimal" value={minText} disabled={lockedByOdoo}
                             placeholder="ตั้งให้เมื่อกรอกราคาขาย"
                             onChange={(e) => onMinChange(e.target.value)} className={`${INPUT_CLS} tabular-nums`} />
                    </div>
                  </div>
                </div>

                {quoteBox}

                <details className="rounded-xl border border-slate-200" open={desc.trim() !== ''}>
                  <summary className="cursor-pointer list-none flex items-center gap-2 px-3 py-2 text-xs text-slate-600">
                    <Plus className="w-3.5 h-3.5 shrink-0" /> รายละเอียดบนใบ <span className="ml-auto text-[11px] text-slate-400">ไม่บังคับ · ไม่ลอกจากต้นแบบ</span>
                  </summary>
                  <div className="px-3 pb-3">
                    <textarea value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={MAX.sales_description} rows={3}
                              disabled={lockedByOdoo} placeholder="สเปกเพิ่มเติมที่อยากให้ขึ้นใต้ชื่อสินค้าในใบ"
                              className={`${INPUT_CLS} h-auto py-2 resize-y`} />
                  </div>
                </details>

                {inherited.length > 0 && (
                  <details className="rounded-xl border border-slate-200">
                    <summary className="cursor-pointer list-none flex items-center gap-2 px-3 py-2 text-xs text-slate-600">
                      ข้อมูลที่ลอกจากต้นแบบ
                      <span className="ml-auto min-w-0 truncate text-[11px] text-slate-400">{inherited.map(([, v]) => v).join(' · ')}</span>
                    </summary>
                    <dl className="px-3 pb-3 grid grid-cols-[96px_1fr] gap-x-3 gap-y-0.5 text-xs">
                      {inherited.map(([k, v]) => (
                        <React.Fragment key={k}><dt className="text-slate-400">{k}</dt><dd className="text-slate-700">{v}</dd></React.Fragment>
                      ))}
                    </dl>
                  </details>
                )}
              </>
            )}
          </>
        )}

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 whitespace-pre-wrap">{error}</p>
        )}
      </div>
    </Modal>
  );
};
