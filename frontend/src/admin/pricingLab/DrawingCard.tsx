import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Box, Boxes, Check, ChevronDown, Copy, Download, Hash, RotateCcw, Tag } from 'lucide-react';
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
 * · ไฟล์วันนี้: SVG (กระดาษแบบ A4 · ภาพ 3 มิติตามมุม/ซูมที่เห็น) · STEP — PDF / PNG / ลิงก์ลูกค้ามากับก้อนถัดไป (ไม่โชว์ปุ่มที่ยังทำงานไม่ได้)
 * · ภาพ 3 มิติ / 2 มิติ / คู่ (ตั้งต้น 3 มิติ · mockup รอบ 5 ข้อ 1) — 2 มิติ = ภาพฉายของโมดูล (`views/`) ตาม spec ที่แสดง
 * · ตารางรายละเอียดสินค้า (`specRows` · ตามภาพที่แสดง จึงยืดหดตามช่องเหมือนภาพ) + หมายเหตุของแบบ — **หมายเหตุเห็นเฉพาะที่นี่**
 *   ไม่ลงกระดาษแบบ/หน้าลูกค้า (เจ้าของเคาะ mockup รอบ 5 ข้อ 2 · 2026-10-09) · ปุ่มคัดลอกรหัสข้างรหัส (mockup รอบ 5)
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
/** ภาพนิ่ง 3 มิติของกระดาษ: 872 × 640 (= กรอบ 436 × 320 ของกระดาษ × 2) */
const STILL = { w: 872, h: 640 };
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
const VIEW_MODES: [ViewMode, string][] = [['3d', '3 มิติ'], ['2d', '2 มิติ'], ['pair', 'คู่']];

/**
 * ภาพฉาย 2 มิติ (SVG จากโมดูล · พื้นขาวคงที่ทุกธีม) — ตัดกรอบตามเนื้อภาพจริงด้วย getBBox
 * (viewBox ของกระดาษทั้งแผ่นเหลือขอบว่างครึ่งกรอบ ⇒ ตัวหนังสือเล็กจนอ่านไม่ออก · mockup รอบ 5)
 */
const Ortho2D: React.FC<{ svg: string; pair: boolean }> = ({ svg, pair }) => {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current?.querySelector('svg');
    if (!el) return;
    let b: DOMRect;
    try { b = el.getBBox(); } catch { return; }
    if (!b.width || !b.height) return;
    const pad = Math.max(b.width, b.height) * 0.04;
    el.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`);
  }, [svg]);
  return <div ref={box} data-testid="drawing-2d" className={`rounded-xl border border-slate-200 bg-white overflow-hidden [&>svg]:block [&>svg]:w-full ${pair ? '[&>svg]:h-auto [&>svg]:max-h-[380px]' : 'h-[420px] max-sm:h-[320px] [&>svg]:h-full'}`}
              dangerouslySetInnerHTML={{ __html: svg }} />;
};

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
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState<SheetText | null>(null);
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
  }, [shownKey, canDraw, error, view]);
  useEffect(() => drop, []);
  useEffect(() => { if (canDraw && !text) void loadSheetText().then(setText, () => {}); }, [canDraw, text]);

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
  const shownSpec: DrawingSpec | null = v.canDraw ? JSON.parse(shownKey) : null;
  const sheetOk = fileOk && !live && !!text && !!data.spec;
  const sheetWhy = !fileOk ? fileWhy : live || !text ? 'รอแบบ' : `กระดาษแบบ A4 (เวกเตอร์) · ${view === '2d' ? 'ภาพฉาย 2 มิติ' : 'ภาพ 3 มิติใช้มุมที่เห็น + ภาพฉาย'}`;

  // กระดาษแบบ SVG — สร้างในเบราว์เซอร์ทั้งแผ่น (โมดูลเป็น TS ล้วน) · ภาพ 3 มิติ = ภาพนิ่งจากตัวดูตามมุม/ซูมที่เห็น
  // ใช้ spec/รหัสของคำตอบเซิร์ฟเวอร์เท่านั้น (ปุ่มปิดระหว่างแก้ช่อง — ภาพชั่วคราวยังไม่ผ่านการตัดสิน) · โหมด 2 มิติ = กระดาษภาพฉายเต็มกรอบ
  const downloadSvg = async () => {
    if (!text || !data.spec) return;
    try {
      const still = view !== '2d' ? viewer.current?.snapshot(STILL.w, STILL.h) ?? null : null;
      const svg = text.renderSheet({ spec: data.spec, code: data.code, still, logo: await loadLogo(), meta: { drawer: drawerName(), date: thaiDate() } });
      saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase(data.code)}.svg`);
    } catch (e: unknown) {
      setError(`สร้างกระดาษแบบไม่สำเร็จ — ${errMsg(e)}`);
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
          {view !== '2d' && <div ref={stage} className={`dv-stage rounded-xl border border-slate-200 ${view === 'pair' ? 'h-[400px] max-sm:h-[300px]' : 'h-[420px] max-sm:h-[320px]'}`}>
            <div className="absolute top-2.5 right-2.5 z-[3] flex gap-1.5">
              <Tool on={exploded} tip={exploded ? 'ประกอบกลับ' : 'แยกชิ้น'} word={exploded ? 'ประกอบ' : 'แยกชิ้น'}
                    onClick={() => setExploded(viewer.current?.toggleExplode() ?? false)}>
                {exploded ? <Box className="w-4 h-4" /> : <Boxes className="w-4 h-4" />}
              </Tool>
              <Tool on={labels} tip="ป้ายชื่อและขนาด" onClick={() => { viewer.current?.setLabels(!labels); setLabels(!labels); }}><Tag className="w-4 h-4" /></Tool>
              <Tool on={edges} tip="เส้นขอบ" onClick={() => { viewer.current?.setEdges(!edges); setEdges(!edges); }}><Hash className="w-4 h-4" /></Tool>
              <Tool on={false} tip="กลับมุมเริ่มต้น" onClick={() => viewer.current?.reset()}><RotateCcw className="w-4 h-4" /></Tool>
            </div>
            <span className="absolute left-2.5 bottom-2.5 z-[3] text-[11px] text-[#3D5261] bg-white/85 rounded-lg px-2 py-0.5">{TOUCH ? 'ลาก = หมุน · สองนิ้ว = ซูม/เลื่อน' : 'ลาก = หมุน · คลิกขวาลาก = เลื่อน'}</span>
          </div>}
          {view !== '3d' && shownSpec && text && <div className={view === 'pair' ? 'mt-2.5' : ''}><Ortho2D svg={text.orthoSvg(shownSpec, data.code)} pair={view === 'pair'} /></div>}
          {view !== '2d' && <div ref={list} className="mt-2.5 empty:hidden" />}
          {shownSpec && text && (
            <details open className="group mt-2.5 border border-slate-200 rounded-xl bg-slate-50" data-testid="drawing-spec">
              <summary className="cursor-pointer list-none flex items-center gap-2 px-3 py-2 text-[12.5px] font-bold text-slate-900 [&::-webkit-details-marker]:hidden">
                รายละเอียดสินค้า
                <ChevronDown className="w-3.5 h-3.5 ml-auto text-slate-500 transition-transform group-open:rotate-180" />
              </summary>
              <dl className="m-0 px-3 pb-2 grid grid-cols-[max-content_minmax(0,1fr)] max-sm:grid-cols-1 gap-x-4 gap-y-0.5 text-[12.5px]">
                {text.specRows(shownSpec).map(([k, val]) => (
                  <React.Fragment key={k}>
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="m-0 text-slate-900 [overflow-wrap:anywhere] max-sm:mb-1">{val}</dd>
                  </React.Fragment>
                ))}
              </dl>
              <p className="m-0 px-3 pb-2.5 text-[11.5px] leading-relaxed text-slate-500" data-testid="drawing-note">
                <b className="text-slate-700">หมายเหตุของแบบ</b> (เห็นเฉพาะในระบบ) · {text.sheetNote(shownSpec)}
              </p>
            </details>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
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
