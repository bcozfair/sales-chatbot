import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Box, Boxes, Check, Copy, Download, Hash, Printer, RotateCcw, Tag } from 'lucide-react';
import { Button } from '../Button';
import { errMsg } from '../logs/format';
// three.js (~650 KB) โหลดเฉพาะตอนการ์ดมีภาพ — import แบบ type อย่างเดียวที่นี่ ตัวจริงโหลดใน effect (หน้าอื่นของแอดมินไม่ต้องจ่าย)
import type { ViewerApi } from '../../drawing-viewer/viewer';
// ตัววาดชุดเดียวกับเซิร์ฟเวอร์ (TS ล้วน · ไม่มีตัวอ่านรหัส) — สร้างชิ้นส่วนในเบราว์เซอร์ให้ภาพยืดหดตามช่องทันที
import type { DrawingSpec } from '../../../../services/drawing/types';
import { fromReading } from '../../../../services/drawing/spec/fromReading';
import type { BhForm, TsForm } from './types';

/**
 * การ์ด "แบบ 3 มิติ" ใต้ราคาในหน้าคำนวณราคา — เฟส 1 ใช้ภายใน (docs/plan-product-drawing-3d.md §8 · mockup รอบ 4 เจ้าของเคาะ 2026-10-06)
 *
 * ถามเซิร์ฟเวอร์ด้วยรหัส + ตัวเลือกนอกรหัสชุดเดียวกับที่คิดราคา (`POST /api/admin/drawing/preview`) ⇒ แบบกับราคามาจากการอ่านเดียวกัน
 * · คำตัดสินสามชั้นมาจาก services/drawing/checks.ts — **หน้าจอไม่ตัดสินเอง** แค่แสดง:
 *     วาดไม่ได้ (ระบบต้องเดาช่องรูปทรง) = ไม่มีภาพ บอกเหตุผล · ส่งไม่ได้ = มีภาพ ปุ่มไฟล์ปิด + เหตุผลใน tooltip
 *     ส่งได้หลังยืนยัน = แถบเหลืองบอกท่อนที่แบบไม่ได้วาด + ติ๊ก "ยืนยันส่งได้" ก่อนปุ่มไฟล์เปิด
 * · ปุ่มเป็นไอคอน + คำสั้น · คำอธิบายอยู่ใน tooltip = aria-label (design.md ข้อ 8)
 * · **ภาพยืดหดตามทันที** (หัวหน้าสั่ง 2026-10-07 · แบบ Appsale): เซิร์ฟเวอร์ส่ง `spec` มา ไม่ใช่ GLB — การ์ดสร้างชิ้นส่วนเองด้วยตัววาดชุดเดียวกัน
 *   และระหว่างแก้ช่องในหน้าคำนวณราคา การ์ดแปลง "ช่องที่กำลังแก้" เป็น spec ด้วย `fromReading` ตัวเดียวกับเซิร์ฟเวอร์ (ไม่ใช่ตัวอ่านรหัสตัวที่สอง —
 *   ช่องคือผลอ่านเดียวกับที่ส่งไปคิดราคา) แล้วเปลี่ยนภาพโดยมุมกล้องคงเดิม · คำตัดสิน/ปุ่มไฟล์/STEP ยังมาจากเซิร์ฟเวอร์เท่านั้น
 *   ภาพที่สร้างจากช่องเป็นภาพชั่วคราว คำตอบของเซิร์ฟเวอร์ (รหัสที่ประกอบจากช่องเดียวกัน) มาทับเสมอ
 * · **จอ = กระดาษ** (เจ้าของ 2026-10-09 · mockup drawing-sheet-split ข้อ A): แท็บ 3 มิติ / 2 มิติ / คู่ แสดงกระดาษแบบ A4 จาก `renderSheet`
 *   ตัวเดียวกับไฟล์ (ตาม spec ที่แสดง จึงยืดหดตามช่อง) · ใบ 3 มิติบนจอ = กรอบว่าง แล้ววางตัวดูทับ `PIC_3D` พอดี (หมุน/ซูม/แยกชิ้นได้ในกรอบ)
 *   · คู่ = ใบ 3 มิติตามด้วยใบ 2 มิติ · ตั้งต้น 3 มิติ (mockup รอบ 5 ข้อ 1)
 * · ไฟล์ตามแท็บที่เปิด: PDF (เซิร์ฟเวอร์พิมพ์ · เปิดแท็บใหม่ · คู่ = 2 หน้า) · PNG (คู่ = 2 ไฟล์) · SVG (สร้างในเบราว์เซอร์ · คู่ = 2 ไฟล์) · STEP
 *   ภาพ 3 มิติในไฟล์ = ภาพนิ่งจากตัวดูตามมุม/ซูมที่เห็น (`STILL_3D` สัดส่วนเดียวกับกรอบ) · ลิงก์ลูกค้ามากับเฟส 2
 * · หมายเหตุของแบบ — **เห็นเฉพาะที่นี่** (บรรทัดใต้กระดาษ) ไม่ลงกระดาษแบบ/หน้าลูกค้า (เจ้าของเคาะ mockup รอบ 5 ข้อ 2)
 *   ตารางรายละเอียดอยู่ในกระดาษแล้ว จึงไม่มีกล่องแยก · ปุ่มคัดลอกรหัสข้างรหัส (mockup รอบ 5)
 * · แยกชิ้นค้างไว้ได้ระหว่างแก้ช่อง (ตัวดูไม่ถูกสร้างใหม่) — เดิมกลับเป็นประกอบทุกครั้ง
 */

interface Doubt { key: string; reason: string }
interface Verdict { family: string | null; canDraw: boolean; canSend: boolean; noDraw: Doubt[]; noSend: Doubt[]; confirm: Doubt[] }
interface Preview { code: string; verdict: Verdict; spec?: DrawingSpec; cfg?: { options?: string[] } }

type Picks = { amp?: string; addons?: string[]; holes?: unknown[] };

const BAND = 'flex flex-wrap items-start gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-xs border';
// ผืนภาพเป็นพื้นอ่อนคงที่ทุกธีม (viewer.css) ⇒ ปุ่มบนภาพใช้สีคงที่ ไม่ใช้โทเคน slate ที่สลับตามธีม (ธีมมืดจะได้ตัวอักษรอ่อนบนพื้นขาว)
const TOOL = 'h-8 inline-flex items-center gap-1.5 rounded-lg border px-2 text-[12px] font-semibold bg-white text-[#3D5261] border-[#c3ccd3] hover:border-[#00764A] hover:text-[#00764A]';
const TOOL_ON = 'border-[#00764A] text-[#00764A] bg-[#e9f4ee]';
/** จอสัมผัสเป็นหลัก (มือถือ/แท็บเล็ต) — คำแนะนำการเลื่อนภาพต่างจากเมาส์ */
const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** ท่อนในเครื่องหมาย «…» ของเหตุผล — ใช้ทำชิปสั้น ๆ บนแถบยืนยัน */
const tokensOf = (ds: Doubt[]) => ds.flatMap((d) => [...d.reason.matchAll(/«([^»]+)»/g)].map((m) => m[1]));

/** spec → ชิ้นส่วน + ป้าย (ตัววาด ~0.2 MB โหลดคู่กับ three.js เฉพาะตอนมีภาพ) */
async function modelOf(spec: DrawingSpec) {
  const [{ buildModel }, { annotate }] = await Promise.all([import('../../../../services/drawing/families/registry'), import('../../../../services/drawing/annotate')]);
  return { src: { parts: buildModel(spec).parts }, ann: annotate(spec) };
}

/** ตาราง/หมายเหตุ/ภาพฉาย 2 มิติ — โหลดคู่กับตัววาด (ดึงตัวสร้างรูปทรงมาด้วย ไม่ให้ก้อนหลักของแอดมินโต) */
type SheetText = typeof import('../../../../services/drawing/sheetText') & typeof import('../../../../services/drawing/views/index') & typeof import('../../../../services/drawing/sheet');
let sheetTextP: Promise<SheetText> | null = null;
const loadSheetText = () => (sheetTextP ??= Promise.all([import('../../../../services/drawing/sheetText'), import('../../../../services/drawing/views/index'), import('../../../../services/drawing/sheet')])
  .then(([a, b, c]) => ({ ...a, ...b, ...c })));

/** โลโก้ Primus ของหัวกระดาษ (= data/logo.png ที่ใบเสนอราคาใช้ · เสิร์ฟที่ /logo.png) เป็น data URL — ฝังในไฟล์ ไม่อ้างลิงก์ */
let logoP: Promise<string> | null = null;
const loadLogo = () => (logoP ??= fetch('/logo.png').then((r) => r.blob()).then((b) => new Promise<string>((ok, bad) => {
  const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = () => bad(fr.error); fr.readAsDataURL(b);
})));
/** ผู้เขียนแบบ = ผู้ใช้ที่ล็อกอิน (ชื่อที่ AuthContext เก็บไว้) */
const drawerName = (): string => { try { const u = JSON.parse(sessionStorage.getItem('admin_user') ?? 'null'); return u?.name || u?.username || ''; } catch { return ''; } };
const thaiDate = () => new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' });
const saveBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
/** ชื่อไฟล์จากรหัส — ตัดอักขระที่ระบบไฟล์ไม่รับ */
const fileBase = (code: string) => code.trim().replace(/[\\/:*?"<>|\s]+/g, '_') || 'drawing';

type ViewMode = '3d' | '2d' | 'pair';
type SheetKind = '3d' | '2d';
const VIEW_MODES: [ViewMode, string][] = [['3d', '3 มิติ'], ['2d', '2 มิติ'], ['pair', 'คู่']];
const SHEETS_OF: Record<ViewMode, SheetKind[]> = { '3d': ['3d'], '2d': ['2d'], pair: ['3d', '2d'] };
const SHEET_LABEL: Record<ViewMode, string> = { '3d': 'ใบ 3 มิติ (มุมที่เห็น)', '2d': 'ใบ 2 มิติ', pair: '2 ใบ: 3 มิติ + 2 มิติ' };
const SUFFIX: Record<SheetKind, string> = { '3d': '3D', '2d': '2D' };

/**
 * กระดาษแบบบนจอ — SVG ทั้งแผ่นจาก `renderSheet` (ตัวเดียวกับไฟล์ · พื้นขาวคงที่ทุกธีม) ย่อตามความกว้างการ์ด
 * · `children` = ผืนตัวดู 3 มิติ วางเป็นสัดส่วนของ `pic` (หน่วยกระดาษ) ⇒ ตำแหน่งตรงกรอบภาพในไฟล์ทุกขนาดจอ
 */
const Paper: React.FC<{ svg: string; kind: SheetKind; size: { w: number; h: number }; children?: React.ReactNode }> = ({ svg, kind, size, children }) => (
  <div data-testid={`drawing-sheet-${kind}`} className="relative w-full rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden" style={{ aspectRatio: `${size.w} / ${size.h}` }}>
    <div className="absolute inset-0 [&>svg]:block [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svg }} />
    {children}
  </div>
);
const pct = (n: number, of: number) => `${(n / of) * 100}%`;

/** ปุ่มบนภาพ — ไอคอน (+ คำเดียวถ้ามี) · คำอธิบายใน tooltip = aria-label */
const Tool: React.FC<{ on: boolean; tip: string; word?: string; onClick: () => void; children: React.ReactNode }> = ({ on, tip, word, onClick, children }) => (
  <button type="button" className={`${TOOL} ${on ? TOOL_ON : ''}`} aria-label={tip} title={tip} aria-pressed={on} onClick={onClick}>
    {children}{word && <span>{word}</span>}
  </button>
);

export const DrawingCard: React.FC<{ code: string; picks: Picks; headers: Record<string, string>; form?: BhForm | null; tsForm?: TsForm | null }> = ({ code, picks, headers, form, tsForm }) => {
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [labels, setLabels] = useState(true);
  const [edges, setEdges] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState<'pdf' | 'png' | null>(null);
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState<SheetText | null>(null);
  const [logo, setLogo] = useState('');
  // ภาพตั้งต้น = 3 มิติ (เจ้าของเคาะ mockup รอบ 5 ข้อ 1) · 2 มิติ/คู่ สลับเอง
  const [view, setView] = useState<ViewMode>('3d');
  const stage = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const viewer = useRef<ViewerApi | null>(null);
  const seq = useRef(0);
  const picksKey = JSON.stringify(picks);
  // ภาพชั่วคราวจากช่องที่กำลังแก้ — ล้างทุกครั้งที่เซิร์ฟเวอร์ตอบ (คำตอบนั้นคือรหัสที่ประกอบจากช่องชุดล่าสุดแล้ว)
  const [live, setLive] = useState<DrawingSpec | null>(null);
  const formKey = JSON.stringify(form ?? tsForm ?? null);
  const cfgKey = JSON.stringify(data?.cfg ?? null);
  useEffect(() => {
    const t = setTimeout(() => {
      const f: unknown = JSON.parse(formKey);
      if (!f) return;
      const r = fromReading({ ...(form ? { form: f as BhForm } : { tsForm: f as TsForm }), cfg: JSON.parse(cfgKey) ?? undefined });
      setLive(r.ok ? r.spec : null);
    }, 0);
    return () => clearTimeout(t);
    // form/tsForm อ่านผ่าน formKey — ค่าใหม่ทุก render แต่เนื้อเดิม ไม่ต้องสร้างภาพใหม่
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey, cfgKey]);

  // รหัส/ตัวเลือกเปลี่ยน → ถามคำตัดสินใหม่ · คำตอบเก่าที่มาถึงทีหลังทิ้ง
  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      if (!code.trim()) { setData(null); return; }
      try {
        const res = await fetch('/api/admin/drawing/preview', { method: 'POST', headers, body: JSON.stringify({ code, picks: JSON.parse(picksKey) }) });
        const out = await res.json();
        if (mine !== seq.current) return;
        if (!res.ok) throw new Error(out?.error ?? 'โหลดแบบไม่สำเร็จ');
        setError(''); setData(out); setLive(null); setConfirmed(false);
      } catch (e: unknown) {
        if (mine !== seq.current) return;
        setError(errMsg(e)); setData(null);
      }
    }, 150); // ภาพชั่วคราวจากช่องขึ้นก่อนแล้ว — ที่นี่รอแค่ให้รหัสนิ่ง (หน้าคำนวณราคาหน่วงช่องพิมพ์ไว้ 350 ms อยู่แล้ว)
    return () => clearTimeout(t);
  }, [code, picksKey, headers]);

  // ภาพที่แสดง = ภาพชั่วคราวจากช่อง (ถ้ามี) ไม่งั้นของเซิร์ฟเวอร์ · เทียบด้วยเนื้อ JSON — เนื้อเดิมไม่สร้างใหม่
  const canDraw = !!data?.verdict.canDraw;
  const shownKey = useMemo(() => (canDraw ? JSON.stringify(live ?? data?.spec ?? null) : 'null'), [canDraw, live, data?.spec]);
  // ตัวดูสร้างครั้งเดียวต่อผืนภาพ · โมเดลเปลี่ยน = `update()` มุมกล้องคงเดิม · ผืนภาพใหม่ (วาดไม่ได้แล้วกลับมาวาดได้ · error) = สร้างใหม่
  // ทิ้งตัวเก่าทุกครั้ง (WebGL context มีจำกัดต่อหน้า)
  const ready = useRef<{ host: HTMLElement; p: Promise<ViewerApi> } | null>(null);
  const toggles = useRef({ labels, edges });
  useEffect(() => { toggles.current = { labels, edges }; }, [labels, edges]);
  const drop = () => { const r = ready.current; ready.current = null; viewer.current = null; void r?.p.then((v) => v.dispose(), () => {}); };
  useEffect(() => {
    const spec: DrawingSpec | null = JSON.parse(shownKey);
    const host = stage.current;
    if (!spec || !host) { if (!host) drop(); return; }   // โหมด 2 มิติ = ไม่มีผืนภาพ 3 มิติ ทิ้งตัวดู (WebGL context มีจำกัด)
    let alive = true;
    void (async () => {
      try {
        const m = await modelOf(spec);
        if (!alive) return;
        if (ready.current?.host !== host) {
          drop();
          const { labels: lb, edges: ed } = toggles.current;
          const p = import('../../drawing-viewer/viewer').then(({ createViewer }) => createViewer(host, m.src, m.ann, { listEl: list.current, title: `ภาพ 3 มิติ ${code}`, labels: lb, edges: ed }));
          ready.current = { host, p };
          const v = await p;
          if (ready.current?.p === p) { viewer.current = v; setExploded(false); }
          return;
        }
        const v = await ready.current.p;
        if (alive) await v.update(m.src, m.ann);
      } catch (e: unknown) {
        if (alive) setError(`แสดงภาพ 3 มิติไม่ได้ — ${errMsg(e)}`);
      }
    })();
    return () => { alive = false; };
    // code อยู่ใน aria-label เท่านั้น — โมเดลเปลี่ยนเมื่อ spec เปลี่ยน
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, canDraw, error, view, text]);   // text: ผืนภาพอยู่ในกระดาษ ⇒ มาหลังโมดูลกระดาษโหลด
  useEffect(() => drop, []);
  useEffect(() => { if (canDraw && !text) void loadSheetText().then(setText, () => {}); }, [canDraw, text]);
  useEffect(() => { if (canDraw && !logo) void loadLogo().then(setLogo, () => {}); }, [canDraw, logo]);
  // กระดาษบนจอ = ใบที่แท็บนี้จะพิมพ์ (ใบ 3 มิติ = กรอบว่าง ตัวดูวางทับ) — สร้างใหม่เมื่อภาพ/รหัส/แท็บเปลี่ยนเท่านั้น
  const dataCode = data?.code ?? '';
  const paper = useMemo(() => {
    const spec: DrawingSpec | null = JSON.parse(shownKey);
    if (!text || !spec) return null;
    const base = { spec, code: dataCode, still: null, logo, meta: { drawer: drawerName(), date: thaiDate() } };
    return Object.fromEntries(SHEETS_OF[view].map((k) => [k, text.renderSheet({ ...base, view: k })])) as Partial<Record<SheetKind, string>>;
  }, [text, shownKey, dataCode, logo, view]);

  if (error) return <div className="bg-card border border-slate-200 rounded-2xl px-5 py-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;
  const v = data.verdict;
  // รุ่นที่ยังไม่มีแบบ — บรรทัดเดียว ไม่กินที่
  if (!v.canDraw && v.noDraw.some((d) => d.key === 'noFamily' || d.key === 'noForm')) {
    return <div className="bg-card border border-slate-200 rounded-2xl px-5 py-3 text-[12.5px] text-slate-500 flex items-center gap-2"><Box className="w-4 h-4" />แบบ 3 มิติ — {v.noDraw[0].reason}</div>;
  }

  const chips = tokensOf(v.confirm);
  const needConfirm = v.canSend && v.confirm.length > 0;
  const fileOk = v.canSend && (!needConfirm || confirmed);
  const fileWhy = !v.canDraw ? 'วาดไม่ได้' : !v.canSend ? `ส่งไม่ได้ — ${v.noSend.map((d) => d.reason).join(' · ')}` : needConfirm && !confirmed ? 'ติ๊กยืนยันก่อน' : 'ไฟล์ 3 มิติสำหรับโปรแกรม CAD';

  // clipboard API ใช้ได้เฉพาะ https/localhost — ถอยไป execCommand (ไม่ตั้ง error: error ทับทั้งการ์ด)
  const copyCode = async () => {
    let ok: boolean;
    try { await navigator.clipboard.writeText(data.code); ok = true; } catch {
      const ta = document.createElement('textarea'); ta.value = data.code; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };
  const sheetOk = fileOk && !live && !!text && !!data.spec;
  const sheetView = SHEET_LABEL[view];
  const sheetWhy = !fileOk ? fileWhy : live || !text ? 'รอแบบ' : `กระดาษแบบ A4 (เวกเตอร์) · ${sheetView}`;
  const kinds = SHEETS_OF[view];
  /** ภาพนิ่ง 3 มิติตามมุม/ซูมที่เห็น — แท็บ 2 มิติไม่ต้องใช้ · แท็บที่มีใบ 3 มิติแต่ตัวดูยังไม่พร้อม = throw (ไม่พิมพ์กรอบว่างออกไป) */
  const snap = () => {
    if (!kinds.includes('3d')) return null;
    const s = text && viewer.current?.snapshot(text.STILL_3D.w, text.STILL_3D.h);
    if (!s) throw new Error('ภาพ 3 มิติยังไม่พร้อม ลองอีกครั้ง');
    return s;
  };
  const nameOf = (k: SheetKind, ext: string) => `${fileBase(data.code)}-${SUFFIX[k]}.${ext}`;

  // กระดาษแบบ SVG — สร้างในเบราว์เซอร์ทั้งแผ่น (โมดูลเป็น TS ล้วน) · ใบตามแท็บที่เปิด (คู่ = 2 ไฟล์)
  // ใช้ spec/รหัสของคำตอบเซิร์ฟเวอร์เท่านั้น (ปุ่มปิดระหว่างแก้ช่อง — ภาพชั่วคราวยังไม่ผ่านการตัดสิน)
  const downloadSvg = async () => {
    if (!text || !data.spec) return;
    try {
      const still = snap(), lg = await loadLogo();
      for (const k of kinds) {
        const svg = text.renderSheet({ spec: data.spec, code: data.code, view: k, still: k === '3d' ? still : null, logo: lg, meta: { drawer: drawerName(), date: thaiDate() } });
        saveBlob(new Blob([svg], { type: 'image/svg+xml' }), nameOf(k, 'svg'));
      }
    } catch (e: unknown) {
      setError(`สร้างกระดาษแบบไม่สำเร็จ — ${errMsg(e)}`);
    }
  };

  // PDF/PNG — เซิร์ฟเวอร์อ่านรหัสซ้ำแล้วประกอบกระดาษเอง (กติกาเดียวกับ STEP) · ส่งไปแค่ชนิดใบ + ภาพนิ่ง 3 มิติตามมุม/ซูมที่เห็น
  //  PDF เปิดในแท็บใหม่ให้พิมพ์/บันทึกจากตัวดู PDF ของเบราว์เซอร์ แบบเดียวกับพรีวิวใบเสนอราคา (เจ้าของ 2026-10-09) · คู่ = PDF 2 หน้า
  //  PNG ยังดาวน์โหลด · คู่ = ขอทีละใบ 2 ไฟล์
  const downloadPrint = async (format: 'pdf' | 'png') => {
    setPrinting(format);
    // เปิดแท็บ "ตอนกด" ไม่ใช่หลัง await — เบราว์เซอร์บล็อก window.open ที่ไม่ได้เกิดจากการกดโดยตรง
    const tab = format === 'pdf' ? window.open('', '_blank') : null;
    try {
      const still = snap();
      const ask = async (sheet: ViewMode) => {
        const res = await fetch('/api/admin/drawing/sheet', { method: 'POST', headers, body: JSON.stringify({ code: data.code, picks, confirmed, format, view: sheet, still: sheet === '2d' ? null : still }) });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'สร้างไฟล์ไม่สำเร็จ');
        return res.blob();
      };
      if (format === 'png') {
        for (const k of kinds) saveBlob(await ask(k), nameOf(k, 'png'));
        return;
      }
      const url = URL.createObjectURL(await ask(view));
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
      // คืน objectURL ทีหลัง ไม่ใช่ทันที — คืนเร็วไปแท็บที่เพิ่งเปิดจะได้ไฟล์ว่าง
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: unknown) {
      tab?.close();
      setError(errMsg(e));
    } finally {
      setPrinting(null);
    }
  };

  const downloadStep = async () => {
    setDownloading(true);
    try {
      const res = await fetch('/api/admin/drawing/step', { method: 'POST', headers, body: JSON.stringify({ code: data.code, picks, confirmed }) });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'โหลดไฟล์ไม่สำเร็จ');
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'drawing.step';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-card border border-slate-200 rounded-2xl px-5 py-4" data-testid="drawing-card">
      <div className="flex items-center gap-2 mb-2.5">
        <Box className="w-4 h-4 text-slate-500" />
        <h3 className="text-[14px] font-bold text-slate-900">แบบ 3 มิติ</h3>
        <span className="font-mono text-[11.5px] text-slate-500 truncate min-w-0">{data.code}</span>
        <button type="button" onClick={() => void copyCode()} aria-label={copied ? 'คัดลอกแล้ว' : 'คัดลอกรหัส'} title={copied ? 'คัดลอกแล้ว' : 'คัดลอกรหัส'}
                className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-[#00764A] hover:bg-slate-100">
          {copied ? <Check className="w-3.5 h-3.5 text-[#00764A]" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        {v.canDraw && (
          <div role="tablist" aria-label="รูปแบบภาพ" className="ml-auto shrink-0 inline-flex border border-slate-300 rounded-[10px] p-0.5 bg-slate-50">
            {VIEW_MODES.map(([m, label]) => (
              <button key={m} type="button" role="tab" aria-selected={view === m} onClick={() => setView(m)}
                      className={`px-3 py-1 rounded-lg text-[12px] font-semibold whitespace-nowrap ${view === m ? 'bg-card text-[#00764A] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!v.canDraw && (
        <div className={`${BAND} bg-slate-50 border-slate-200 text-slate-700`}>
          <span className="w-full font-semibold">วาดไม่ได้</span>
          {v.noDraw.map((d) => <span key={d.key} className="w-full">· {d.reason}</span>)}
        </div>
      )}
      {v.canDraw && !v.canSend && (
        <div className={`${BAND} mb-2.5 bg-amber-50 border-amber-200 text-amber-800`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span className="flex-1"><b>ส่งลูกค้าไม่ได้</b> — {v.noSend.map((d) => d.reason).join(' · ')}</span>
        </div>
      )}
      {needConfirm && (
        <label className={`${BAND} mb-2.5 items-center ${confirmed ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}
               title={v.confirm.map((d) => d.reason).join('\n')}>
          <span className="flex-1 min-w-[200px]">
            ไม่ได้วาดในแบบ: {chips.length ? chips.map((c) => <code key={c} className="mx-0.5 px-1 rounded bg-white/70 border border-current/20">{c}</code>) : v.confirm.map((d) => d.reason).join(' · ')}
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            ยืนยันส่งได้
          </span>
        </label>
      )}

      {v.canDraw && (
        <>
          {paper && text && kinds.map((k, n) => (
            <div key={k} className={n ? 'mt-2.5' : ''}>
              <Paper svg={paper[k] ?? ''} kind={k} size={{ w: text.SHEET_W, h: text.SHEET_H }}>
                {k === '3d' && (
                  <div ref={stage} className="dv-stage" data-testid="drawing-stage"
                       style={{ position: 'absolute', left: pct(text.PIC_3D.x, text.SHEET_W), top: pct(text.PIC_3D.y, text.SHEET_H), width: pct(text.PIC_3D.w, text.SHEET_W), height: pct(text.PIC_3D.h, text.SHEET_H) }}>
                    <div className="absolute top-1.5 right-1.5 z-[3] flex gap-1.5">
                      <Tool on={exploded} tip={exploded ? 'ประกอบกลับ' : 'แยกชิ้น'} word={exploded ? 'ประกอบ' : 'แยกชิ้น'}
                            onClick={() => setExploded(viewer.current?.toggleExplode() ?? false)}>
                        {exploded ? <Box className="w-4 h-4" /> : <Boxes className="w-4 h-4" />}
                      </Tool>
                      <Tool on={labels} tip="ป้ายชื่อและขนาด" onClick={() => { viewer.current?.setLabels(!labels); setLabels(!labels); }}><Tag className="w-4 h-4" /></Tool>
                      <Tool on={edges} tip="เส้นขอบ" onClick={() => { viewer.current?.setEdges(!edges); setEdges(!edges); }}><Hash className="w-4 h-4" /></Tool>
                      <Tool on={false} tip="กลับมุมเริ่มต้น" onClick={() => viewer.current?.reset()}><RotateCcw className="w-4 h-4" /></Tool>
                    </div>
                    <span className="absolute left-1.5 bottom-1.5 z-[3] text-[11px] text-[#3D5261] bg-white/85 rounded-lg px-2 py-0.5 max-sm:hidden">{TOUCH ? 'ลาก = หมุน · สองนิ้ว = ซูม/เลื่อน' : 'ลาก = หมุน · คลิกขวาลาก = เลื่อน'}</span>
                  </div>
                )}
              </Paper>
            </div>
          ))}
          {view !== '2d' && <div ref={list} className="mt-2.5 empty:hidden" />}
          {paper && text && (
            <p className="m-0 mt-2 text-[11.5px] leading-relaxed text-slate-500" data-testid="drawing-note">
              <b className="text-slate-700">หมายเหตุของแบบ</b> (เห็นเฉพาะในระบบ ไม่อยู่ในกระดาษ) · {text.sheetNote(JSON.parse(shownKey))}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span title={sheetOk ? `แบบ A4 · ${sheetView}` : sheetWhy}>
              <Button icon={Printer} busy={printing === 'pdf'} disabled={!sheetOk || !!printing} onClick={() => void downloadPrint('pdf')} aria-label={sheetOk ? `เปิดแบบ A4 เพื่อพิมพ์ · ${sheetView}` : sheetWhy}>PDF</Button>
            </span>
            <span title={sheetOk ? `ภาพกระดาษแบบ · ${sheetView}` : sheetWhy}>
              <Button icon={Download} busy={printing === 'png'} disabled={!sheetOk || !!printing} onClick={() => void downloadPrint('png')} aria-label={sheetOk ? `ภาพกระดาษแบบ · ${sheetView}` : sheetWhy}>PNG</Button>
            </span>
            <span title={sheetWhy}>
              <Button icon={Download} disabled={!sheetOk} onClick={() => void downloadSvg()} aria-label={sheetWhy}>SVG</Button>
            </span>
            <span title={fileWhy}>
              <Button icon={Download} busy={downloading} disabled={!fileOk} onClick={() => void downloadStep()} aria-label={fileWhy}>STEP</Button>
            </span>
          </div>
        </>
      )}
    </div>
  );
};
