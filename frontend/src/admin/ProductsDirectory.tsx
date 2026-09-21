import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, PackageX, Ban, AlertTriangle, CheckCircle2, Download, X, Database, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from './PageHeader';
import { DataFilterBar, DataSearch, FilterCombo, type FilterOption } from './DataFilterBar';
import {
  TableCard, TableScroll, SortHeader, Pagination, EmptyState, SkeletonRows, ErrorBox,
} from './logs/ui';
import { errMsg, formatNumber, formatDateTime, tdCls, numCls, downloadCsv } from './logs/format';

/**
 * หน้า "ข้อมูลสินค้า" — อ่านอย่างเดียว ต้นทางคือ Odoo
 *
 * ทำไมคอลัมน์ "แหล่งผลิต" ถึงสำคัญกว่าที่ชื่อมันฟัง (วัด 2026-09-17):
 *   กฎบล็อกที่เปิดอยู่มี 9 ข้อ แต่ 4 ข้อบล็อกด้วย `production` ทั้งกลุ่ม ⇒ สินค้า
 *   **39,987 จาก 51,665 ตัว (77%) เสนอราคาผ่าน LINE ไม่ได้** และเหลือที่เสนอได้จริง 11,678 ตัว
 *   คอลัมน์นี้จึงเป็น "ตัวทำนายว่าสินค้าตัวนั้นขายผ่านบอทได้ไหม" ไม่ใช่ข้อมูลประกอบ
 *   — ค่าจึงถูกย้อมแดงเมื่อกลุ่มนั้นถูกบล็อก
 *
 * ทำไมทุกถ้อยคำบนจอนี้เขียนว่า "LINE" ไม่ใช่ "ระบบ" (เจ้าของสั่ง 2026-09-17):
 *   กฎบล็อกเดินเส้นทั้งสองทางจริง แต่**ผลไม่เหมือนกัน** — `BLOCKED` ไม่ใช่ `SYSTEM_ERROR`
 *   จึงเป็นข้อที่ `isBypassableViolation()` ยอมให้ทะลุได้ ⇒ **หน้าเว็บขอใบเสนอราคา
 *   ติ๊กรับทราบแล้วออกใบต่อได้** ส่วนใบจาก LINE มี `rule_overrides` เป็น NULL เสมอ
 *   ⇒ **บล็อกจริงทางเดียวคือ LINE** ตัวเลข 11,678 จึงแปลว่า "เสนอผ่าน LINE ได้"
 *   เห็นแล้วอย่าแก้กลับเป็น "ระบบ" ด้วยเหตุผลว่ากฎถูกเรียกจากสองทาง
 *
 * ทำไมไม่มีคอลัมน์ `incoming` / `outgoing`:
 *   ทั้งสองช่องเป็น 0 ทั้ง 51,665 แถว (gateway ยังไม่ส่งมา) ⇒ ขึ้นจอแล้วอ่านว่า
 *   "ไม่มีของเข้า" ซึ่งไม่จริง · เหตุผลเดียวกับที่ `product_category` ไม่ได้เป็นตัวกรอง
 *   (FinishGoods 51,664 / Service 1 — ตัวเลือกที่กรองแล้วได้ทุกแถวคือตัวเลือกที่ไม่ควรมี)
 *
 * ทำไมตัวกรองเป็น "ซีรีส์" ไม่ใช่ "กลุ่มสินค้า" (เจ้าของสั่ง 2026-09-21 · วัดวันเดียวกัน):
 *   `product_group` มี 20 ค่า และ **35,269 จาก 51,665 แถว (68%) กองอยู่ใน `Inst 1` ค่าเดียว**
 *   ⇒ กรองแล้วยังเหลือสามหมื่นกว่าแถว คือตัวกรองที่กดแล้วไม่ได้อะไร
 *   `series` มี 859 ค่า เป็นรหัสที่เซลส์เรียกกันจริง (TSP 9,853 · TSK 9,078 · LP 3,279)
 *   และเป็นช่องเดียวกับที่ `product_block_rules` ใช้ตั้ง scope ⇒ ตรงกับวิธีที่คนคิดถึงสินค้าอยู่แล้ว
 *   คอลัมน์ "กลุ่ม / หมวดย่อย" ยังอยู่ในตารางและยังเรียงได้ — ที่ถอดออกคือ dropdown เท่านั้น
 *   ช่องค้นหาครอบ `series` มาตั้งแต่แรก (repo) — 2026-09-21 แค่เขียนชื่อมันลงใน placeholder
 *   ให้คนรู้ว่าพิมพ์ "TSP" ตรง ๆ ได้ · gate: `npm run diag:data-directory`
 */

interface ProductRules {
  moq: { qty: number; warn: string } | null;
  stockRule: boolean;
  optional: string[];
  block: { blocked: boolean; warn: string | null; scope: string | null };
}

interface ProductRow {
  product_template_id: number;
  internal_reference: string | null;
  name: string | null;
  brand: string | null;
  series: string | null;
  model: string | null;
  sales_price: string | null;
  minimum_sales_price: string | null;
  product_group: string | null;
  product_category: string | null;
  product_sub_category: string | null;
  production: string | null;
  quantity_on_hand: string | null;
  quantity_on_hand_unreserved: string | null;
  unit_of_measure: string | null;
  sales_description: string | null;
  is_system_item: boolean;
  sync_updated_at: string | null;
  rules: ProductRules;
}

interface Summary {
  total: number; withStock: number; priceZero: number; minGe: number;
  blocked: number; quotable: number;
}

interface Facets {
  series: { value: string; n: number }[];
  brands: { value: string; n: number }[];
  productions: { value: string; n: number }[];
}

const STOCK_OPTIONS: FilterOption[] = [
  { id: 'has', name: 'มีของพร้อมขาย' },
  { id: 'none', name: 'ไม่มีของพร้อมขาย' },
  { id: 'resv', name: 'มีของแต่ถูกจองบางส่วน' },
];

const FLAG_OPTIONS: FilterOption[] = [
  { id: 'noprice', name: 'ยังไม่ตั้งราคาขาย' },
  { id: 'minge', name: 'ราคาต่ำสุด ≥ ราคาขาย' },
  { id: 'nobrand', name: 'ไม่มีแบรนด์' },
  { id: 'nodesc', name: 'ไม่มีคำอธิบาย' },
];

const RULE_OPTIONS: FilterOption[] = [
  { id: 'block', name: 'ห้ามเสนอราคา (ถูกบล็อก)' },
  { id: 'free', name: 'เสนอราคาผ่าน LINE ได้' },
];

/** ราคา 0 ไม่ใช่ "ยังไม่โหลด" — 9,444 รายการเป็นแบบนี้จริง และทุกใบที่เสนอจะติด MIN_PRICE_VIOLATION */
const Price: React.FC<{ value: string | null; min?: boolean }> = ({ value, min }) => {
  const n = Number(value ?? 0);
  if (!min && n === 0) return <span className="text-red-600 font-semibold">ยังไม่ตั้ง</span>;
  return <span className={min ? 'text-slate-500' : 'font-semibold text-slate-800'}>{n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
};

/** ป้ายกฎ — ทุกป้ายมีข้อความกำกับ ไม่สื่อความหมายด้วยสีอย่างเดียว */
const RuleTags: React.FC<{ rules: ProductRules }> = ({ rules }) => {
  const tags: { text: string; cls: string }[] = [];
  if (rules.block.blocked) tags.push({ text: 'ห้ามเสนอราคา', cls: 'bg-red-50 text-red-700 border-red-200' });
  if (rules.moq) tags.push({ text: `ขั้นต่ำ ${rules.moq.qty}`, cls: 'bg-amber-50 text-amber-700 border-amber-200' });
  if (rules.stockRule) tags.push({ text: 'ของหมดห้ามเสนอ', cls: 'bg-blue-50 text-blue-700 border-blue-200' });
  if (rules.optional.length) tags.push({ text: 'มีสินค้าพ่วง', cls: 'bg-violet-50 text-violet-700 border-violet-200' });
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {tags.map((t) => (
        <span key={t.text} className={`inline-block px-1.5 py-0.5 rounded-md border text-[10px] font-semibold ${t.cls}`}>
          {t.text}
        </span>
      ))}
    </div>
  );
};

const StatTile: React.FC<{
  icon: React.ElementType; label: string; value: string; tone?: string;
  active?: boolean; onClick?: () => void;
}> = ({ icon: Icon, label, value, tone = 'text-slate-800', active, onClick }) => (
  <button
    onClick={onClick}
    aria-pressed={active}
    className={`text-left bg-card border rounded-2xl px-3.5 py-2.5 transition-all
      ${active ? 'border-[var(--brand-fg)] bg-[var(--brand-soft)]' : 'border-slate-200 hover:border-[var(--brand-border)]'}`}
  >
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
    <div className={`text-lg font-bold tabular-nums mt-0.5 ${tone}`}>{value}</div>
  </button>
);

export const ProductsDirectory: React.FC = () => {
  const { token } = useAuth();
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [facets, setFacets] = useState<Facets>({ series: [], brands: [], productions: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProductRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const [q, setQ] = useState('');
  const [series, setSeries] = useState('');
  const [brand, setBrand] = useState('');
  const [production, setProduction] = useState('');
  const [stock, setStock] = useState('');
  const [flag, setFlag] = useState('');
  const [rule, setRule] = useState('');
  const [sort, setSort] = useState('internal_reference');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  /** ตัวกรองทั้งหมดในรูป query string — ใช้ทั้งตอนโหลดตารางและตอนส่งออก CSV */
  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (series) p.set('series', series);
    if (brand) p.set('brand', brand);
    if (production) p.set('production', production);
    if (stock) p.set('stock', stock);
    if (flag) p.set('flag', flag);
    p.set('sort', sort);
    p.set('dir', dir);
    return p;
  }, [q, series, brand, production, stock, flag, sort, dir]);

  const activeCount = [q.trim(), series, brand, production, stock, flag, rule].filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams(params);
      p.set('limit', String(size));
      p.set('offset', String((page - 1) * size));
      const res = await fetch(`/api/admin/data/products?${p}`, { headers: authHeaders });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(errMsg(e));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [params, page, size, authHeaders]);

  // หุ้มด้วย setTimeout ตามแบบเดียวกับหน้ากลุ่มบันทึก (ApiLogs) — กติกา react-hooks/set-state-in-effect
  // ห้าม setState ตรง ๆ ใน effect · 300 ms ยังได้ debounce ของช่องค้นหาแถมมาด้วย
  // (ไม่งั้นพิมพ์ 1 ตัวอักษร = ยิง 1 request ไปที่ตาราง 51,665 แถว)
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 300);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    // ตัวเลขสรุปกับตัวเลือกตัวกรองไม่ขึ้นกับตัวกรองที่เลือกอยู่ ⇒ โหลดครั้งเดียวพอ
    const t = setTimeout(() => void (async () => {
      try {
        const [s, f] = await Promise.all([
          fetch('/api/admin/data/products/summary', { headers: authHeaders }).then((r) => r.json()),
          fetch('/api/admin/data/products/facets', { headers: authHeaders }).then((r) => r.json()),
        ]);
        setSummary(s);
        setFacets(f);
      } catch {
        /* ตัวเลขสรุปหายไม่ได้ทำให้ตารางใช้ไม่ได้ — ปล่อยให้หน้าทำงานต่อ */
      }
    })(), 0);
    return () => clearTimeout(t);
  }, [authHeaders]);

  /**
   * ตัวกรอง "กฎที่ติดอยู่" กรองฝั่ง client เพราะการจับคู่กฎ scope ทำใน TS ไม่ใช่ SQL
   * ⇒ กรองได้เฉพาะภายในหน้าที่โหลดมาแล้ว และต้องบอกผู้ใช้ตรง ๆ ว่าเป็นแบบนั้น
   * (ทางเลือกอื่นคือย้ายการจับคู่ลง SQL ซึ่งจะกลายเป็นตรรกะกฎสำเนาที่สองทันที — ห้ามตาม CLAUDE.md)
   */
  const visible = useMemo(() => {
    if (!rule) return rows;
    return rows.filter((r) => (rule === 'block' ? r.rules.block.blocked : !r.rules.block.blocked));
  }, [rows, rule]);

  const clearAll = () => {
    setQ(''); setSeries(''); setBrand(''); setProduction('');
    setStock(''); setFlag(''); setRule(''); setPage(1);
  };

  const onSort = (col: string) => {
    if (sort === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(col); setDir('asc'); }
    setPage(1);
  };

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadCsv(`/api/admin/data/products/export?${params}`, token, `products-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setExporting(false);
    }
  };

  const opt = (list: { value: string; n: number }[]): FilterOption[] =>
    list.map((v) => ({ id: v.value, name: v.value, count: v.n }));

  const pages = Math.max(1, Math.ceil(total / size));

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Package}
        title="ข้อมูลสินค้า"
        description={summary
          ? `${formatNumber(summary.total)} รายการ · เสนอราคาผ่าน LINE ได้ ${formatNumber(summary.quotable)} · อ่านอย่างเดียว แก้ที่ Odoo`
          : 'อ่านอย่างเดียว แก้ที่ Odoo'}
      />

      {/* ตัวเลขสี่ตัวนี้เป็นตัวกรองที่กดได้จริง ไม่ใช่ป้ายประดับ */}
      <div className="grid gap-2.5 grid-cols-2 xl:grid-cols-4">
        <StatTile icon={Database} label="ทั้งหมดในตาราง" value={summary ? formatNumber(summary.total) : '—'}
          active={!rule && !flag} onClick={() => { setRule(''); setFlag(''); setPage(1); }} />
        <StatTile icon={CheckCircle2} label="เสนอราคาผ่าน LINE ได้" value={summary ? formatNumber(summary.quotable) : '—'}
          tone="text-emerald-600" active={rule === 'free'}
          onClick={() => { setFlag(''); setRule(rule === 'free' ? '' : 'free'); setPage(1); }} />
        <StatTile icon={Ban} label="ถูกกฎบล็อกไว้" value={summary ? formatNumber(summary.blocked) : '—'}
          tone="text-red-600" active={rule === 'block'}
          onClick={() => { setFlag(''); setRule(rule === 'block' ? '' : 'block'); setPage(1); }} />
        <StatTile icon={AlertTriangle} label="ยังไม่ตั้งราคาขาย" value={summary ? formatNumber(summary.priceZero) : '—'}
          tone="text-amber-600" active={flag === 'noprice'}
          onClick={() => { setRule(''); setFlag(flag === 'noprice' ? '' : 'noprice'); setPage(1); }} />
      </div>

      <DataFilterBar
        activeCount={activeCount}
        onClear={clearAll}
        search={<DataSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="ค้นหา รหัส / ชื่อ / รุ่น / แบรนด์ / ซีรีส์" />}
        primary={<FilterCombo label="กฎที่ติดอยู่" value={rule} options={RULE_OPTIONS} onChange={(v) => { setRule(v); setPage(1); }} />}
        rest={<>
          <FilterCombo label="ซีรีส์" value={series} options={opt(facets.series)} onChange={(v) => { setSeries(v); setPage(1); }} />
          <FilterCombo label="แบรนด์" value={brand} options={opt(facets.brands)} onChange={(v) => { setBrand(v); setPage(1); }} />
          <FilterCombo label="แหล่งผลิต" value={production} options={opt(facets.productions)} onChange={(v) => { setProduction(v); setPage(1); }} />
          <FilterCombo label="สต็อก" value={stock} options={STOCK_OPTIONS} onChange={(v) => { setStock(v); setPage(1); }} />
          <FilterCombo label="ข้อมูลที่ต้องดู" value={flag} options={FLAG_OPTIONS} onChange={(v) => { setFlag(v); setPage(1); }} />
        </>}
      />

      {rule && (
        <div className="flex items-start gap-2 text-xs text-slate-500 px-1">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            ตัวกรอง “กฎที่ติดอยู่” กรองเฉพาะ {formatNumber(rows.length)} แถวในหน้านี้ —
            ตัวเลขรวมทั้งฐานดูได้ที่การ์ดด้านบน
          </span>
        </div>
      )}

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      <TableCard
        title={`รายการสินค้า · ${formatNumber(total)} รายการ`}
        hint="คลิกแถวเพื่อดูข้อมูลทั้งหมด · หัวคอลัมน์กดเรียงได้"
        action={
          <button
            onClick={() => void onExport()}
            disabled={exporting || total === 0}
            className="btn-h px-3 rounded-lg border border-slate-200 bg-card text-xs font-semibold text-slate-600
                       hover:border-[var(--brand-border)] hover:text-[var(--brand-fg)] disabled:opacity-40
                       flex items-center gap-1.5 shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            {exporting ? 'กำลังส่งออก…' : <>ส่งออก CSV<span className="hidden sm:inline">{` (${formatNumber(total)} แถวที่กรองอยู่)`}</span></>}
          </button>
        }
      >
        {loading ? (
          <SkeletonRows rows={8} />
        ) : error ? (
          /* มี ErrorBox อยู่เหนือการ์ดแล้ว — ตรงนี้ห้ามขึ้นข้อความ "ยังไม่มีข้อมูล"
             เพราะจะพาไปตรวจการซิงก์ทั้งที่ปัญหาคือโหลดไม่สำเร็จ */
          <EmptyState
            icon={Package}
            title="ยังไม่ได้ข้อมูลมาแสดง"
            hint="กดปุ่ม “ลองใหม่” ด้านบน — ตารางจะกลับมาเมื่อโหลดสำเร็จ"
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Package}
            title={activeCount ? 'ไม่มีสินค้าที่ตรงกับตัวกรองนี้' : 'ยังไม่มีข้อมูลสินค้า'}
            hint={activeCount
              ? 'ลองล้างตัวกรองบางตัวออก หรือใช้คำค้นที่สั้นลง'
              : 'ข้อมูลสินค้าซิงก์มาจาก Odoo — ถ้าว่างทั้งตาราง ให้ตรวจการซิงก์ที่หน้า “ซิงก์ข้อมูล”'}
          />
        ) : (
          <>
            {/* ── จอทำงาน: ตาราง ─────────────────────────────── */}
            <div className="hidden sm:block">
              <TableScroll>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <SortHeader label="รหัสสินค้า" col="internal_reference" active={sort} dir={dir} onSort={onSort} />
                      <SortHeader label="ชื่อสินค้า / รุ่น" col="name" active={sort} dir={dir} onSort={onSort} />
                      <SortHeader label="แบรนด์ / ซีรีส์" col="brand" active={sort} dir={dir} onSort={onSort} />
                      <SortHeader label="แหล่งผลิต" col="production" active={sort} dir={dir} onSort={onSort} />
                      <SortHeader label="กลุ่ม / หมวดย่อย" col="product_group" active={sort} dir={dir} onSort={onSort} className="hidden lg:table-cell" />
                      <SortHeader label="ราคาขาย" col="sales_price" active={sort} dir={dir} onSort={onSort} align="right" />
                      <SortHeader label="ราคาต่ำสุด" col="minimum_sales_price" active={sort} dir={dir} onSort={onSort} align="right" />
                      <SortHeader label="พร้อมขาย" col="quantity_on_hand_unreserved" active={sort} dir={dir} onSort={onSort} align="right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((p) => {
                      const avail = Number(p.quantity_on_hand_unreserved ?? 0);
                      const onHand = Number(p.quantity_on_hand ?? 0);
                      const groupBlocked = p.rules.block.blocked && !p.rules.block.scope?.startsWith('รหัสสินค้า');
                      return (
                        <tr
                          key={p.product_template_id}
                          onClick={() => setSelected(p)}
                          className="cursor-pointer hover:bg-slate-50 transition-colors"
                        >
                          <td className={`${tdCls} font-mono text-xs text-[var(--brand-fg)] font-semibold whitespace-nowrap`}>
                            {p.internal_reference ?? '—'}
                          </td>
                          <td className={tdCls}>
                            <div className="font-medium text-slate-800 max-w-[250px] truncate">{p.name}</div>
                            <div className="font-mono text-[11px] text-slate-400 max-w-[250px] truncate">{p.model}</div>
                            <RuleTags rules={p.rules} />
                          </td>
                          <td className={tdCls}>
                            <div className="text-slate-700">{p.brand ?? <span className="text-slate-400">—</span>}</div>
                            {p.series && <div className="text-[11px] text-slate-400">{p.series}</div>}
                          </td>
                          <td className={tdCls}>
                            {p.production
                              ? <span className={groupBlocked ? 'text-red-600 font-semibold' : 'text-slate-700'}>{p.production}</span>
                              : <span className="text-slate-400">—</span>}
                          </td>
                          <td className={`${tdCls} hidden lg:table-cell`}>
                            <div className="text-slate-700">{p.product_group ?? <span className="text-slate-400">—</span>}</div>
                            {p.product_sub_category && <div className="text-[11px] text-slate-400">{p.product_sub_category}</div>}
                          </td>
                          <td className={`${tdCls} ${numCls}`}><Price value={p.sales_price} /></td>
                          <td className={`${tdCls} ${numCls}`}><Price value={p.minimum_sales_price} min /></td>
                          <td className={`${tdCls} ${numCls}`}>
                            <span className={avail > 0 ? 'font-semibold text-emerald-600' : 'text-slate-400'}>
                              {formatNumber(avail)}
                            </span>
                            <span className="text-slate-400 text-xs ml-1">{p.unit_of_measure}</span>
                            {onHand > avail && (
                              <div className="text-[10px] text-amber-600">จองไว้ {formatNumber(onHand - avail)}</div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            </div>

            {/* ── มือถือ: การ์ด ──────────────────────────────────
                ตาราง 9 คอลัมน์ที่ย่อลงมาเฉย ๆ คือตารางที่อ่านไม่ออก (AGENTS.md A9)
                ⇒ เหลือเฉพาะช่องที่ตอบคำถาม "ตัวไหน ราคาเท่าไร ขายได้ไหม มีของไหม"
                กลุ่ม/หมวดย่อย กับหน่วยไปอยู่ในแผงรายละเอียดแทน */}
            <div className="sm:hidden divide-y divide-slate-100">
              {visible.map((p) => {
                const avail = Number(p.quantity_on_hand_unreserved ?? 0);
                const groupBlocked = p.rules.block.blocked && !p.rules.block.scope?.startsWith('รหัสสินค้า');
                return (
                  <button
                    key={p.product_template_id}
                    onClick={() => setSelected(p)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="font-mono text-[11px] text-[var(--brand-fg)] font-semibold">
                      {p.internal_reference ?? '—'}
                    </div>
                    <div className="font-medium text-slate-800 text-sm mt-0.5">{p.name}</div>
                    <RuleTags rules={p.rules} />
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt className="text-slate-400">แหล่งผลิต</dt>
                      <dd className={`text-right ${groupBlocked ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>
                        {p.production ?? '—'}
                      </dd>
                      <dt className="text-slate-400">ราคาขาย</dt>
                      <dd className="text-right tabular-nums"><Price value={p.sales_price} /></dd>
                      <dt className="text-slate-400">ราคาต่ำสุด</dt>
                      <dd className="text-right tabular-nums"><Price value={p.minimum_sales_price} min /></dd>
                      <dt className="text-slate-400">พร้อมขาย</dt>
                      <dd className={`text-right tabular-nums ${avail > 0 ? 'font-semibold text-emerald-600' : 'text-slate-400'}`}>
                        {formatNumber(avail)} {p.unit_of_measure}
                      </dd>
                    </dl>
                  </button>
                );
              })}
            </div>

            <Pagination
              page={page} pages={pages} size={size} total={total} unit="รายการ"
              onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }}
            />
          </>
        )}
      </TableCard>

      {selected && <ProductDetail product={selected} onClose={() => setSelected(null)} />}
    </div>
  );
};

/** คู่ป้าย-ค่าในแผงรายละเอียด — ประกาศนอก component เพราะ React สร้าง component ใหม่ทุก render ไม่ได้ */
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="text-sm text-slate-700 break-words">{children}</dd>
  </>
);

/** แผงรายละเอียด — จัดกลุ่มตาม "คำถามที่คนเปิดมาถาม" ไม่ใช่ตามลำดับคอลัมน์ใน DDL */
const ProductDetail: React.FC<{ product: ProductRow; onClose: () => void }> = ({ product: p, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const avail = Number(p.quantity_on_hand_unreserved ?? 0);
  const onHand = Number(p.quantity_on_hand ?? 0);
  const priceZero = Number(p.sales_price ?? 0) === 0;
  const minGe = !priceZero && Number(p.minimum_sales_price ?? 0) >= Number(p.sales_price ?? 0);

  return (
    <>
      <div className="fixed inset-0 bg-black/45 z-40" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={`รายละเอียดสินค้า ${p.internal_reference ?? ''}`}
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[460px] max-w-[94vw] z-50 bg-card
                   border-l border-slate-200 shadow-2xl flex flex-col"
      >
        <div className="px-4 py-3.5 border-b border-slate-100 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-800 break-words">{p.name}</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              <span className="font-mono text-[var(--brand-fg)] font-semibold">{p.internal_reference}</span>
              {' · '}product_template_id {p.product_template_id}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="ปิดแผงรายละเอียด"
            className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600
                       hover:border-red-200 grid place-items-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-5 flex-1">
          <section>
            <h4 className="text-[10px] font-bold tracking-wider uppercase text-slate-400 border-b border-slate-100 pb-1.5 mb-2">
              กฎที่ผูกกับสินค้านี้
            </h4>
            {p.rules.block.blocked ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800 space-y-1">
                <div className="font-bold flex items-center gap-1.5"><Ban className="w-3.5 h-3.5" /> ห้ามเสนอราคาผ่าน LINE</div>
                <div>กฎตั้งไว้ที่ <b>{p.rules.block.scope}</b></div>
                {p.rules.block.warn && <div className="text-red-600">ข้อความที่เซลส์จะเห็น: “{p.rules.block.warn}”</div>}
              </div>
            ) : (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> เสนอราคาผ่าน LINE ได้ ไม่ติดกฎบล็อก
              </div>
            )}
            {p.rules.moq && (
              <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                <div className="font-bold">ขั้นต่ำสั่งซื้อ {p.rules.moq.qty} {p.unit_of_measure}</div>
                <div className="text-amber-700 mt-0.5">{p.rules.moq.warn}</div>
              </div>
            )}
            {p.rules.stockRule && (
              <div className="mt-2 bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
                <b>ของหมดแล้วห้ามเสนอ</b> — รหัสที่ไม่มีแถวในกฎนี้ เสนอราคาได้เสมอแม้ของว่าง
              </div>
            )}
            {p.rules.optional.length > 0 && (
              <div className="mt-2 bg-violet-50 border border-violet-200 rounded-xl p-3 text-xs text-violet-800">
                <b>สินค้าพ่วง:</b> <span className="font-mono">{p.rules.optional.join(' · ')}</span>
              </div>
            )}
          </section>

          <section>
            <h4 className="text-[10px] font-bold tracking-wider uppercase text-slate-400 border-b border-slate-100 pb-1.5 mb-2">ราคา</h4>
            {(priceZero || minGe) && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 mb-2">
                {priceZero ? 'ราคาขายเป็น 0 แต่ราคาต่ำสุดไม่ใช่' : 'ราคาต่ำสุดไม่ต่ำกว่าราคาขาย'} ⇒
                ทุกใบที่เสนอสินค้านี้จะติด <b>MIN_PRICE_VIOLATION</b> และต้องรอผู้มีสิทธิ์อนุมัติ ·
                แก้ที่ Odoo แล้วรอรอบซิงก์ถัดไป
              </div>
            )}
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 gap-x-3 items-baseline">
              <Row label="ราคาขาย"><Price value={p.sales_price} /></Row>
              <Row label="ราคาต่ำสุด"><Price value={p.minimum_sales_price} min /></Row>
            </dl>
          </section>

          <section>
            <h4 className="text-[10px] font-bold tracking-wider uppercase text-slate-400 border-b border-slate-100 pb-1.5 mb-2">สต็อก</h4>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 gap-x-3 items-baseline">
              <Row label="พร้อมขาย (unreserved)">
                <span className={avail > 0 ? 'font-semibold text-emerald-600' : 'text-slate-400'}>
                  {formatNumber(avail)} {p.unit_of_measure}
                </span>
              </Row>
              <Row label="ยอดคงคลัง (on hand)">{formatNumber(onHand)} {p.unit_of_measure}</Row>
              <Row label="ถูกจองไว้">{onHand > avail ? formatNumber(onHand - avail) : '0'}</Row>
            </dl>
            <div className="mt-2 bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
              ด่านระงับสินค้าหมดเทียบ <b>พร้อมขาย</b> กับ <b>จำนวนที่สั่ง</b> ไม่ใช่ยอดคงคลัง ·
              <code className="ml-1">incoming</code>/<code>outgoing</code> ไม่ได้แสดงเพราะเป็น 0 ทั้งตาราง
              (gateway ยังไม่ส่งมา) ไม่ใช่เพราะไม่มีของเข้า
            </div>
          </section>

          <section>
            <h4 className="text-[10px] font-bold tracking-wider uppercase text-slate-400 border-b border-slate-100 pb-1.5 mb-2">การจัดหมวด</h4>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 gap-x-3 items-baseline">
              <Row label="แบรนด์">{p.brand ?? '—'}</Row>
              <Row label="ซีรีส์">{p.series ?? '—'}</Row>
              <Row label="รุ่น"><span className="font-mono text-xs">{p.model}</span></Row>
              <Row label="กลุ่มสินค้า">{p.product_group ?? '—'}</Row>
              <Row label="หมวดย่อย">{p.product_sub_category ?? '—'}</Row>
              <Row label="แหล่งผลิต">{p.production ?? '—'}</Row>
              <Row label="หน่วยนับ">{p.unit_of_measure ?? '—'}</Row>
            </dl>
          </section>

          <section>
            <h4 className="text-[10px] font-bold tracking-wider uppercase text-slate-400 border-b border-slate-100 pb-1.5 mb-2">คำอธิบายขาย</h4>
            {p.sales_description ? (
              <div className="whitespace-pre-wrap text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3">
                {p.sales_description.trim()}
              </div>
            ) : (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex items-start gap-1.5">
                <PackageX className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>ไม่มีคำอธิบาย — ข้อความนี้คือสิ่งที่ลูกค้าเห็นบน PDF ⇒ ว่าง = PDF โชว์แค่ชื่อรุ่น</span>
              </div>
            )}
          </section>

          <section>
            <h4 className="text-[10px] font-bold tracking-wider uppercase text-slate-400 border-b border-slate-100 pb-1.5 mb-2">ที่มาของข้อมูล</h4>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 gap-x-3 items-baseline">
              <Row label="หมวดใหญ่ (Odoo)">{p.product_category ?? '—'}</Row>
              <Row label="ซิงก์ล่าสุด">{formatDateTime(p.sync_updated_at)}</Row>
              <Row label="รายการของระบบ">{p.is_system_item ? 'ใช่ — ไม่ได้มาจาก Odoo' : 'ไม่ใช่'}</Row>
            </dl>
          </section>
        </div>
      </aside>
    </>
  );
};
