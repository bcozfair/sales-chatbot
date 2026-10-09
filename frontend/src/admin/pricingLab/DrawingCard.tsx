import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Box, Boxes, Download, Hash, RotateCcw, Tag } from 'lucide-react';
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
 * · วันนี้มีแค่ STEP — PDF / PNG / ลิงก์ลูกค้ามากับก้อนถัดไป (ไม่โชว์ปุ่มที่ยังทำงานไม่ได้)
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
    if (!spec || !host) return;
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
  }, [shownKey, canDraw, error]);
  useEffect(() => drop, []);

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
        <span className="font-mono text-[11.5px] text-slate-500 truncate">{data.code}</span>
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
          <div ref={stage} className="dv-stage rounded-xl border border-slate-200 h-[420px] max-sm:h-[320px]">
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
          </div>
          <div ref={list} className="mt-2.5 empty:hidden" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span title={fileWhy}>
              <Button icon={Download} busy={downloading} disabled={!fileOk} onClick={() => void downloadStep()} aria-label={fileWhy}>STEP</Button>
            </span>
          </div>
        </>
      )}
    </div>
  );
};
