import React, { useState } from 'react';
import { Calculator } from 'lucide-react';
import { Modal } from '../Modal';
import { Button } from '../Button';
import type { EditorAdder, EditorView, Predicate } from './types';
import { applyRound, dimNice, fmt, makeId, optLabel, predText, roundTh, toNum } from './tsRulesText';

/**
 * กล่อง "เพิ่ม / แก้กฎ" ของหน้ากฎและเงื่อนไขซีรีส์ TS — mockup `pricing-rules-ts.html` (เจ้าของเคาะ 2026-09-29)
 *
 * สองขั้น ① คิดเมื่อไหร่ ② คิดเท่าไหร่ + สรุปพร้อม **ตัวอย่างตัวเลขจริง** ("แกน L1 ยาว 350 mm → เกิน 250 =
 * 3 ช่วง × 110 = 330 บาท") — คนตั้งราคาตรวจกฎด้วยการดูตัวอย่าง ไม่ใช่ประกอบประโยคเองจากหกช่อง
 * ช่องที่ใช้น้อย (ลำดับการคิด · คูณจำนวนเส้น · หมายเหตุ) พับไว้
 *
 * ตัวเลือกโชว์ **เฉพาะของซีรีส์เดียวกัน** (`vocab.series`) + "แสดงตัวเลือกของซีรีส์อื่น…" ท้ายรายการ (ข้อ 4)
 * — เป็นแค่ลำดับการโชว์ ตัวรับที่เซิร์ฟเวอร์ยังรับทุกคีย์ใน `OPTION_TH` เหมือนเดิม
 *
 * กติกาเดียวกับ `RuleEditModal` (กล่องของ BH): **ไม่มีช่องพิมพ์เงื่อนไขอิสระ ตลอดไป** · ช่อง "ยาวเกิน" เว้นว่าง =
 * สเปกมาตรฐานของรุ่น **ห้ามเติมค่ามาตรฐานลงช่องให้เอง** — ใส่เลขแล้วกฎเลิกตามมาตรฐาน (ดู CLAUDE.md `Adder.over`)
 */

type WhenMode = 'always' | 'option' | 'dim' | 'other';
type Op = 'gt' | 'gte' | 'lt' | 'lte';
const OPS: { v: Op; t: string }[] = [
  { v: 'gt', t: 'มากกว่า' }, { v: 'gte', t: 'ตั้งแต่ (ขึ้นไป)' }, { v: 'lt', t: 'น้อยกว่า' }, { v: 'lte', t: 'ไม่เกิน' },
];
const MORE = '__more';

const FLD = 'rounded-lg border border-slate-200 bg-card px-2 py-1 text-[13px] text-slate-900';
const NUM = `${FLD} w-[72px] text-right tabular-nums`;
const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

const Radio: React.FC<{ name: string; checked: boolean; onChange: () => void; children: React.ReactNode }> = ({
  name, checked, onChange, children,
}) => (
  <label className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-[13px] ${checked ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
    <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-[3px]" />
    <div className="min-w-0 flex-1">{children}</div>
  </label>
);

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <div className="rounded-xl border border-slate-200 px-3 py-2.5">
    <div className="mb-1 text-[12px] font-bold text-slate-500">
      <b className="mr-1" style={{ color: 'var(--brand-fg)' }}>{n}</b>{title}
    </div>
    {children}
  </div>
);

export const TsRuleModal: React.FC<{
  /** null = เพิ่มกฎใหม่ */
  adder: (EditorAdder & { uid: string }) | null;
  view: EditorView;
  existingIds: string[];
  onClose: () => void;
  onSave: (a: EditorAdder & { uid: string }) => void;
}> = ({ adder, view, existingIds, onClose, onSave }) => {
  const { vocab } = view;
  const w0 = adder?.when ?? null;
  const mode0: WhenMode = !w0 || 'always' in w0 ? 'always' : 'option' in w0 ? 'option' : 'dim' in w0 ? 'dim' : 'other';
  const op0: Op = w0 && 'dim' in w0 ? (OPS.find((o) => w0[o.v] !== undefined)?.v ?? 'gt') : 'gt';
  const seriesOpts = vocab.series.options.length ? vocab.series.options : vocab.options.map((o) => o.key);
  const seriesDims = vocab.series.dims.length ? vocab.series.dims : vocab.dims.map((d) => d.key);
  const std = (dim: string) => view.standard.find((s) => s.dim === dim)?.value ?? null;

  const [label, setLabel] = useState(adder?.label ?? '');
  const [mode, setMode] = useState<WhenMode>(adder ? mode0 : 'option');
  const [option, setOption] = useState(w0 && 'option' in w0 ? w0.option : seriesOpts[0] ?? '');
  const [allOpts, setAllOpts] = useState(!!(w0 && 'option' in w0 && !seriesOpts.includes(w0.option)));
  const [wdim, setWdim] = useState(w0 && 'dim' in w0 ? w0.dim : seriesDims[0] ?? '');
  const [op, setOp] = useState<Op>(op0);
  const [wval, setWval] = useState(w0 && 'dim' in w0 ? str(w0[op0]) : '');
  const [kind, setKind] = useState<EditorAdder['kind']>(adder?.kind ?? 'flat');
  const [amount, setAmount] = useState(str(adder?.amount));
  const [percent, setPercent] = useState(str(adder?.percent));
  const [pdim, setPdim] = useState(adder?.dim ?? seriesDims[0] ?? '');
  const [over, setOver] = useState(str(adder?.over));
  const [step, setStep] = useState(str(adder?.step));
  const [unit, setUnit] = useState(adder?.unit.trim() || 'mm');
  const [rate, setRate] = useState(str(adder?.rate));
  const [times, setTimes] = useState(str(adder?.times));
  const [order, setOrder] = useState(str(adder?.order ?? 50));
  const [note, setNote] = useState(adder?.note ?? '');
  const [err, setErr] = useState('');

  const byAxis = !!adder?.rates;
  const sample = adder?.rates?.find((r) => r.rate !== null) ?? null;
  const round = adder?.round ?? 'ceil';

  const when: Predicate | null | undefined =
    mode === 'always' ? null
      : mode === 'option' ? { option }
        : mode === 'dim' ? (toNum(wval) === null ? undefined : ({ dim: wdim, [op]: toNum(wval) } as Predicate))
          : w0;

  /* ── สรุป + ตัวอย่าง ── */
  const u = unit.trim() || 'หน่วย';
  const who = mode === 'always' ? 'ทุกชิ้น' : when === undefined ? 'เมื่อ … (ยังไม่ได้ใส่เกณฑ์)' : predText(when, vocab);
  let how: string;
  let ex: React.ReactNode;
  if (kind === 'flat') {
    how = byAxis ? `บวกเงินก้อนเดียว ราคาตาม${adder?.byAxisTh}` : `บวก ${amount.trim() || '?'} บาท`;
    ex = byAxis
      ? sample && <>ตัวอย่าง: {adder?.byAxisTh} {sample.value} → +{fmt(sample.rate)} บาท</>
      : toNum(amount) === null
        ? <>ยังไม่ใส่จำนวนเงิน = ระบบตอบ “ยังไม่มีราคา” (ไม่ใช่ 0 บาท)</>
        : <>ตัวอย่าง: สั่ง 1 ชิ้น → +{fmt(toNum(amount))} บาท</>;
  } else if (kind === 'percent') {
    const p = toNum(percent);
    how = `บวก ${percent.trim() || '?'}% ของยอดที่คิดมาถึงตอนนั้น`;
    ex = p !== null && <>ตัวอย่าง: ยอดถึงตอนนั้น 1,000 บาท → +{fmt(Math.round(p * 1000) / 100)} บาท</>;
  } else {
    const o = toNum(over) ?? std(pdim) ?? 0;
    const s = toNum(step) ?? 1;
    const r = byAxis ? sample?.rate ?? null : toNum(rate);
    const t = toNum(times) ?? 1;
    const dn = dimNice(pdim, vocab);
    how = `${dn} ยาวเกิน ${fmt(o)} ${u} คิดส่วนที่เกินทุก ๆ ${fmt(s)} ${u} ${byAxis ? `ราคาตาม${adder?.byAxisTh}` : `ละ ${rate.trim() || '?'} บาท`}${t !== 1 ? ` × ${t}` : ''} (${roundTh(round, u)})`;
    const len = o + s * 2.5;
    const n = applyRound((len - o) / s, round);
    ex = r !== null && (
      <>
        ตัวอย่าง{byAxis && sample && ` (${adder?.byAxisTh} ${sample.value})`}: {dn} ยาว {fmt(len)} {u} → เกิน {fmt(len - o)} {u} = {fmt(n)} ช่วง
        {' '}× {fmt(r)}{t !== 1 && ` × ${t}`} = <b>{fmt(Math.round(n * r * t * 100) / 100)} บาท</b>
      </>
    );
  }

  const submit = () => {
    const name = label.trim();
    if (!name) { setErr('ใส่ชื่อรายการก่อนนะครับ — ชื่อนี้คือสิ่งที่ขึ้นในใบเสนอราคา'); return; }
    if (when === undefined) { setErr('ใส่ตัวเลขเกณฑ์ของเงื่อนไขด้วยนะครับ'); return; }
    if (kind === 'perUnit' && toNum(step) !== null && toNum(step)! <= 0) { setErr('ช่อง “ทุก ๆ” ต้องมากกว่า 0'); return; }
    if (kind === 'percent' && toNum(percent) === null) { setErr('ใส่เปอร์เซ็นต์ด้วยนะครับ'); return; }
    const id = adder?.id ?? makeId(name, existingIds);
    // เงื่อนไขเดิมไม่ได้เปลี่ยน ⇒ คงข้อความเดิมของเซิร์ฟเวอร์ ไม่งั้นจอตรวจก่อนบันทึกขึ้นว่า "คิดเมื่อไหร่" เปลี่ยน
    // ทั้งที่แค่ถ้อยคำต่างกัน
    const sameWhen = JSON.stringify(when ?? null) === JSON.stringify(w0);
    onSave({
      ...(adder ?? {
        uid: id, id, kindTh: '', dimTh: null, byAxis: null, byAxisTh: null, rates: null,
        disabled: false, custom: true, source: '', overStd: null, round: null, skipIfNoRate: false,
      }),
      uid: adder?.uid ?? id,
      id,
      label: name,
      order: toNum(order) ?? 50,
      kind,
      when,
      whenTh: sameWhen && adder ? adder.whenTh : predText(when, vocab),
      kindTh: vocab.kinds.find((k) => k.key === kind)?.label ?? kind,
      amount: kind === 'flat' ? toNum(amount) : null,
      percent: kind === 'percent' ? toNum(percent) : null,
      rate: kind === 'perUnit' ? toNum(rate) : null,
      dim: kind === 'perUnit' ? pdim : null,
      dimTh: kind === 'perUnit' ? vocab.dims.find((d) => d.key === pdim)?.label ?? pdim : null,
      over: kind === 'perUnit' ? toNum(over) : null,
      overStd: kind === 'perUnit' ? std(pdim) : null,
      step: kind === 'perUnit' ? toNum(step) : null,
      times: kind === 'perUnit' ? toNum(times) : null,
      unit: kind === 'perUnit' ? (adder?.unit.trim() === unit.trim() ? adder.unit : unit.trim()) : '',
      round: kind === 'perUnit' ? round : null,
      note: note.trim(),
    });
  };

  const optionSelect = (
    <select
      className={`${FLD} max-w-full`} value={option} aria-label="ตัวเลือกที่เลือก"
      onChange={(e) => { if (e.target.value === MORE) setAllOpts(true); else setOption(e.target.value); }}
    >
      {!allOpts ? (
        <>
          {seriesOpts.map((k) => <option key={k} value={k}>{optLabel(k, vocab)}</option>)}
          <option disabled>──────────</option>
          <option value={MORE}>แสดงตัวเลือกของซีรีส์อื่น…</option>
        </>
      ) : (
        <>
          <optgroup label="ซีรีส์เดียวกัน">
            {seriesOpts.map((k) => <option key={k} value={k}>{optLabel(k, vocab)}</option>)}
          </optgroup>
          <optgroup label="ซีรีส์อื่น">
            {vocab.options.filter((o) => !seriesOpts.includes(o.key)).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </optgroup>
        </>
      )}
    </select>
  );

  const dimOptions = (
    <>
      {seriesDims.map((k) => <option key={k} value={k}>{dimNice(k, vocab)}</option>)}
      {vocab.dims.some((d) => !seriesDims.includes(d.key)) && (
        <optgroup label="ช่องของซีรีส์อื่น">
          {vocab.dims.filter((d) => !seriesDims.includes(d.key)).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </optgroup>
      )}
    </>
  );

  return (
    <Modal
      icon={Calculator}
      title={adder ? `แก้กฎ — ${adder.label}` : 'เพิ่มกฎใหม่'}
      size="lg"
      onClose={onClose}
      footer={<>
        <Button onClick={onClose}>ยกเลิก</Button>
        <Button variant="primary" onClick={submit}>{adder ? 'ใช้การแก้นี้' : 'เพิ่มกฎนี้'}</Button>
      </>}
    >
      <div className="space-y-3 px-5 py-4">
        {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</div>}

        <div>
          <div className="mb-1 text-[12px] font-bold text-slate-500">ชื่อที่ขึ้นในใบเสนอราคา</div>
          <input className={`${FLD} w-full`} value={label} onChange={(e) => setLabel(e.target.value)}
                 placeholder="เช่น หัวกระโหลก Blacklite เล็ก" />
        </div>

        <Step n={1} title="คิดเมื่อไหร่">
          <Radio name="when" checked={mode === 'always'} onChange={() => setMode('always')}>ทุกชิ้น — ไม่ต้องมีใครเลือก</Radio>
          <Radio name="when" checked={mode === 'option'} onChange={() => setMode('option')}>
            เมื่อเลือกตัวเลือก
            {mode === 'option' && <div className="mt-1">{optionSelect}</div>}
          </Radio>
          <Radio name="when" checked={mode === 'dim'} onChange={() => setMode('dim')}>
            เมื่อขนาดถึงเกณฑ์
            {mode === 'dim' && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <select className={FLD} value={wdim} aria-label="ช่องตัวเลขที่ดู" onChange={(e) => setWdim(e.target.value)}>{dimOptions}</select>
                <select className={FLD} value={op} aria-label="เทียบแบบ" onChange={(e) => setOp(e.target.value as Op)}>
                  {OPS.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
                </select>
                <input className={NUM} inputMode="decimal" value={wval} aria-label="เกณฑ์" onChange={(e) => setWval(e.target.value)} />
              </div>
            )}
          </Radio>
          {mode0 === 'other' && adder && (
            <Radio name="when" checked={mode === 'other'} onChange={() => setMode('other')}>
              เงื่อนไขเดิมจากไฟล์ราคา: <b>{predText(w0, vocab)}</b>
              <div className="text-[11.5px] text-slate-500">เลือกแบบอื่นแล้วบันทึก = เงื่อนไขเดิมถูกแทน</div>
            </Radio>
          )}
        </Step>

        <Step n={2} title="คิดเท่าไหร่">
          <Radio name="kind" checked={kind === 'flat'} onChange={() => setKind('flat')}>
            เงินก้อนเดียว
            {kind === 'flat' && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-slate-600">
                {byAxis
                  ? <>ราคาตาม{adder?.byAxisTh} — แก้ในหน้ากฎ / หน้าชีต</>
                  : <><input className={NUM} inputMode="decimal" value={amount} placeholder="ยังไม่มี" aria-label="จำนวนเงิน"
                             onChange={(e) => setAmount(e.target.value)} /> บาท</>}
              </div>
            )}
          </Radio>
          <Radio name="kind" checked={kind === 'perUnit'} onChange={() => setKind('perUnit')}>
            ตามความยาวที่เกิน
            {kind === 'perUnit' && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-slate-600">
                ดูที่
                <select className={FLD} value={pdim} aria-label="คิดจากช่อง" onChange={(e) => setPdim(e.target.value)}>{dimOptions}</select>
                ยาวเกิน
                <input className={NUM} inputMode="decimal" value={over} aria-label="ยาวเกิน"
                       placeholder={std(pdim) !== null ? `มาตรฐาน ${fmt(std(pdim))}` : '0'}
                       title="เว้นว่าง = ใช้สเปกที่รวมในราคาตั้งแล้วของรุ่นนี้" onChange={(e) => setOver(e.target.value)} />
                คิดทุก ๆ
                <input className={NUM} inputMode="decimal" value={step} placeholder="1" aria-label="ทุก ๆ"
                       onChange={(e) => setStep(e.target.value)} />
                <input className={`${FLD} w-[56px]`} value={unit} aria-label="หน่วย" onChange={(e) => setUnit(e.target.value)} />
                {byAxis
                  ? <>· ราคาตาม{adder?.byAxisTh}</>
                  : <>ละ <input className={NUM} inputMode="decimal" value={rate} placeholder="ยังไม่มี" aria-label="บาทต่อช่วง"
                                onChange={(e) => setRate(e.target.value)} /> บาท</>}
              </div>
            )}
          </Radio>
          <Radio name="kind" checked={kind === 'percent'} onChange={() => setKind('percent')}>
            เปอร์เซ็นต์ของยอดที่คิดมาแล้ว
            {kind === 'percent' && (
              <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-slate-600">
                <input className={NUM} inputMode="decimal" value={percent} aria-label="เปอร์เซ็นต์"
                       onChange={(e) => setPercent(e.target.value)} /> %
              </div>
            )}
          </Radio>
        </Step>

        <div className="rounded-xl border px-3 py-2 text-[12.5px] leading-relaxed text-slate-700"
             style={{ borderColor: 'var(--brand-border)', background: 'var(--brand-soft)' }}>
          <b style={{ color: 'var(--brand-fg)' }}>สรุป:</b> {who} → {how}
          {ex && <div>{ex}</div>}
        </div>

        <details className="text-[12px] text-slate-500">
          <summary className="cursor-pointer">ตั้งค่าเพิ่มเติม (ลำดับการคิด · คูณจำนวนเส้น · หมายเหตุ)</summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            ลำดับการคิด
            <input className={NUM} inputMode="decimal" value={order} aria-label="ลำดับการคิด" onChange={(e) => setOrder(e.target.value)} />
            <span>เลขน้อยคิดก่อน — มีผลเฉพาะเมื่อมีกฎแบบเปอร์เซ็นต์</span>
          </div>
          {kind === 'perUnit' && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              คูณ
              <input className={NUM} inputMode="decimal" value={times} placeholder="1" aria-label="คูณจำนวนเท่า"
                     onChange={(e) => setTimes(e.target.value)} />
              เท่า <span>เช่น สายสองเส้น = 2</span>
            </div>
          )}
          <input className={`${FLD} mt-1.5 w-full`} value={note} onChange={(e) => setNote(e.target.value)}
                 placeholder="หมายเหตุ เหตุผลที่ตั้งกฎนี้ (ไม่บังคับ)" />
        </details>
      </div>
    </Modal>
  );
};
