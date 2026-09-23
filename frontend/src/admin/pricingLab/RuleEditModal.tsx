import React, { useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { Modal } from '../Modal';
import { Button } from '../Button';
import type { EditorAdder, EditorView, Predicate } from './types';

/**
 * กล่อง "เพิ่ม / แก้กฎบวกเพิ่ม" ของหน้าแก้ราคาทีละรุ่น
 *
 * **ไม่มีช่องพิมพ์เงื่อนไขอิสระ และต้องไม่มีตลอดไป** — เหตุผลอยู่ใน
 * services/pricingLab/types.ts: "สมุดราคาถูกแก้โดยแอดมิน การเปิดให้เขียน expression
 * อิสระคือการเปิดช่องให้คนตั้งราคาเขียนโค้ดลงฐานข้อมูลโดยไม่มีใครรีวิว"
 * ⇒ ทุกช่องเป็นรายการปิดที่มาจาก `vocab` ซึ่งเซิร์ฟเวอร์เป็นคนบอกว่ามีอะไรบ้าง
 * และฝั่งรับ (`modelEditor.ts`) ประกอบเงื่อนไขขึ้นใหม่เองอีกชั้น เพราะหน้าจอไม่ใช่ด่าน
 *
 * เงื่อนไขที่ซับซ้อนกว่าสามแบบนี้ (`และ` / `หรือ` / `ไม่ใช่` ที่ติดมาจากไฟล์ราคา)
 * **แก้จากที่นี่ไม่ได้** — กล่องจะบอกไว้ก่อนว่าถ้าบันทึก เงื่อนไขเดิมจะถูกแทน
 */

type WhenMode = 'always' | 'option' | 'dim' | 'other';
type Op = 'gt' | 'gte' | 'lt' | 'lte';

const OPS: { v: Op; t: string }[] = [
  { v: 'gt', t: 'มากกว่า' },
  { v: 'gte', t: 'ตั้งแต่ … ขึ้นไป' },
  { v: 'lt', t: 'น้อยกว่า' },
  { v: 'lte', t: 'ไม่เกิน' },
];

const num = (v: string): number | null => {
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** สร้าง id จากชื่อที่พิมพ์ — ตัวอักษรไทยใช้เป็นคีย์ไม่ได้ จึงถอยไปใช้เลขลำดับ */
function makeId(label: string, used: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const stem = /^[a-z]/.test(base) ? base.slice(0, 30) : 'rule';
  let id = stem;
  let n = 1;
  while (used.includes(id)) id = `${stem}_${++n}`;
  return id;
}

function whenToText(p: Predicate | null, optLabel: (k: string) => string, dimLabel: (k: string) => string): string {
  if (!p || 'always' in p) return 'ทุกกรณี';
  if ('all' in p) return p.all.map((x) => whenToText(x, optLabel, dimLabel)).join(' และ ');
  if ('any' in p) return p.any.map((x) => whenToText(x, optLabel, dimLabel)).join(' หรือ ');
  if ('not' in p) return 'ไม่ใช่กรณี ' + whenToText(p.not, optLabel, dimLabel);
  if ('option' in p) return `ลูกค้าติ๊ก “${optLabel(p.option)}”`;
  if ('in' in p) return `${p.axis} = ${p.in.join(' หรือ ')}`;
  if ('notIn' in p) return `${p.axis} ไม่ใช่ ${p.notIn.join(' หรือ ')}`;
  const parts: string[] = [];
  if (p.gt !== undefined) parts.push(`มากกว่า ${p.gt}`);
  if (p.gte !== undefined) parts.push(`ตั้งแต่ ${p.gte} ขึ้นไป`);
  if (p.lt !== undefined) parts.push(`น้อยกว่า ${p.lt}`);
  if (p.lte !== undefined) parts.push(`ไม่เกิน ${p.lte}`);
  return parts.length ? `${dimLabel(p.dim)} ${parts.join(' และ ')}` : dimLabel(p.dim);
}

/** `sub` = บรรทัดย่อยของตัวเลือกด้านบน — เยื้องเข้าไปเท่ากับความกว้างของป้ายหลักพอดี */
const Row: React.FC<{ label: string; sub?: boolean; children: React.ReactNode }> = ({ label, sub, children }) => (
  <div className={`flex flex-wrap items-center gap-2 ${sub ? 'sm:pl-24' : ''}`}>
    <label className={`text-[11.5px] font-bold ${sub ? 'text-slate-400' : 'w-full sm:w-24 shrink-0 text-slate-500'}`}>
      {label}
    </label>
    {children}
  </div>
);

const FLD = 'rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900';
const SM = `${FLD} w-[74px] text-right tabular-nums`;

export const RuleEditModal: React.FC<{
  /** null = เพิ่มกฎใหม่ */
  adder: (EditorAdder & { uid: string }) | null;
  vocab: EditorView['vocab'];
  existingIds: string[];
  onClose: () => void;
  onSave: (a: EditorAdder & { uid: string }) => void;
}> = ({ adder, vocab, existingIds, onClose, onSave }) => {
  const optLabel = useMemo(
    () => (k: string) => vocab.options.find((o) => o.key === k)?.label ?? k,
    [vocab],
  );
  const dimLabel = useMemo(
    () => (k: string) => vocab.dims.find((o) => o.key === k)?.label ?? k,
    [vocab],
  );

  const w0 = adder?.when ?? null;
  const mode0: WhenMode = !w0 || 'always' in w0 ? 'always'
    : 'option' in w0 ? 'option'
      : 'dim' in w0 ? 'dim' : 'other';
  const op0: Op = w0 && 'dim' in w0 ? (OPS.find((o) => w0[o.v] !== undefined)?.v ?? 'lt') : 'lt';

  const [label, setLabel] = useState(adder?.label ?? '');
  const [mode, setMode] = useState<WhenMode>(mode0);
  const [option, setOption] = useState(w0 && 'option' in w0 ? w0.option : (vocab.options[0]?.key ?? ''));
  const [dim, setDim] = useState(w0 && 'dim' in w0 ? w0.dim : (vocab.dims[0]?.key ?? ''));
  const [op, setOp] = useState<Op>(op0);
  const [dimV, setDimV] = useState(w0 && 'dim' in w0 && w0[op0] !== undefined ? String(w0[op0]) : '');
  const [kind, setKind] = useState<EditorAdder['kind']>(adder?.kind ?? 'flat');
  const [amount, setAmount] = useState(adder?.amount === null || adder?.amount === undefined ? '' : String(adder.amount));
  const [percent, setPercent] = useState(adder?.percent === null || adder?.percent === undefined ? '' : String(adder.percent));
  const [pdim, setPdim] = useState(adder?.dim ?? vocab.dims[0]?.key ?? '');
  // เว้นว่าง = ใช้สเปกมาตรฐานของรุ่น (over) / ทุก 1 หน่วย (step) — ห้ามเติม 0 หรือ 1 ให้เอง
  // ใส่เลขลงไปเมื่อไหร่ก็เท่ากับทับค่ามาตรฐาน ซึ่งเปลี่ยนราคาของกฎนั้นทั้งรุ่น
  const [over, setOver] = useState(adder?.over === null || adder?.over === undefined ? '' : String(adder.over));
  const [step, setStep] = useState(adder?.step === null || adder?.step === undefined ? '' : String(adder.step));
  const [unit, setUnit] = useState(adder?.unit ?? '');
  const [rate, setRate] = useState(adder?.rate === null || adder?.rate === undefined ? '' : String(adder.rate));
  const [times, setTimes] = useState(adder?.times === null || adder?.times === undefined ? '' : String(adder.times));
  const [order, setOrder] = useState(String(adder?.order ?? 50));
  const [note, setNote] = useState(adder?.note ?? '');
  const [err, setErr] = useState('');

  const submit = () => {
    const name = label.trim();
    if (!name) { setErr('ใส่ชื่อรายการก่อนนะครับ — ชื่อนี้คือสิ่งที่ขึ้นในใบเสนอราคา'); return; }

    let when: Predicate | null = null;
    if (mode === 'option') when = { option };
    else if (mode === 'dim') {
      const n = num(dimV);
      if (n === null) { setErr('ใส่ตัวเลขเกณฑ์ของเงื่อนไขด้วยนะครับ'); return; }
      when = { dim, [op]: n } as Predicate;
    }
    if (kind === 'perUnit' && num(step) !== null && num(step)! <= 0) {
      setErr('ช่อง “ทุก ๆ” ต้องมากกว่า 0'); return;
    }

    const id = adder?.id ?? makeId(name, existingIds);
    onSave({
      ...(adder ?? {
        uid: id, id, kindTh: '', dimTh: null, byAxis: null, byAxisTh: null,
        rates: null, disabled: false, custom: true, source: '',
      }),
      uid: adder?.uid ?? id,
      id,
      label: name,
      order: num(order) ?? 50,
      kind,
      when,
      whenTh: whenToText(when, optLabel, dimLabel),
      kindTh: vocab.kinds.find((k) => k.key === kind)?.label ?? kind,
      amount: kind === 'flat' ? num(amount) : null,
      percent: kind === 'percent' ? num(percent) : null,
      rate: kind === 'perUnit' ? num(rate) : null,
      dim: kind === 'perUnit' ? pdim : null,
      dimTh: kind === 'perUnit' ? dimLabel(pdim) : null,
      over: kind === 'perUnit' ? num(over) : null,
      step: kind === 'perUnit' ? num(step) : null,
      times: kind === 'perUnit' ? num(times) : null,
      unit: kind === 'perUnit' ? unit.trim() : '',
      note: note.trim(),
    });
  };

  return (
    <Modal
      icon={Calculator}
      title={adder ? `แก้กฎ — ${adder.label}` : 'เพิ่มกฎใหม่'}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" onClick={submit}>{adder ? 'บันทึกการแก้' : 'เพิ่มกฎนี้'}</Button>
        </>
      }
    >
      <div className="space-y-2.5">
        {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</div>}

        <Row label="ชื่อรายการ">
          <input className={`${FLD} flex-1 min-w-0`} value={label} onChange={(e) => setLabel(e.target.value)}
                 placeholder="เช่น หัวกระโหลกอลูมิเนียม" />
        </Row>

        <Row label="คิดเมื่อไหร่">
          <select className={`${FLD} flex-1 min-w-0`} value={mode}
                  onChange={(e) => setMode(e.target.value as WhenMode)}>
            <option value="always">ทุกกรณี — บวกให้ทุกใบของรุ่นนี้</option>
            <option value="option">เมื่อลูกค้าติ๊กตัวเลือก</option>
            <option value="dim">เมื่อขนาด/ปริมาณถึงเกณฑ์</option>
            {mode === 'other' && <option value="other">(เงื่อนไขเดิมจากไฟล์ราคา)</option>}
          </select>
        </Row>

        {mode === 'option' && (
          <Row label="ตัวเลือกที่ติ๊ก" sub>
            <select className={`${FLD} w-[220px]`} value={option} onChange={(e) => setOption(e.target.value)}>
              {vocab.options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Row>
        )}

        {mode === 'dim' && (
          <Row label="ช่องตัวเลขที่ดู" sub>
            <select className={`${FLD} w-[200px]`} value={dim} onChange={(e) => setDim(e.target.value)}>
              {vocab.dims.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <select className={`${FLD} w-[150px]`} value={op} onChange={(e) => setOp(e.target.value as Op)}>
              {OPS.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
            </select>
            <input className={SM} inputMode="decimal" value={dimV} onChange={(e) => setDimV(e.target.value)} />
          </Row>
        )}

        {mode === 'other' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
            เงื่อนไขเดิมของกฎนี้ซับซ้อนกว่าที่จอรองรับ ({whenToText(w0, optLabel, dimLabel)}) —
            บันทึกแล้วจะถูกแทนด้วยเงื่อนไขที่เลือกข้างบน
          </div>
        )}

        <Row label="วิธีคิด">
          <select className={`${FLD} flex-1 min-w-0`} value={kind}
                  onChange={(e) => setKind(e.target.value as EditorAdder['kind'])}>
            {vocab.kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </Row>

        {kind === 'flat' && (
          <Row label="จำนวนเงิน" sub>
            <input className={SM} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="text-[11px] text-slate-400">บาท</span>
          </Row>
        )}

        {kind === 'percent' && (
          <Row label="บวกเพิ่ม" sub>
            <input className={SM} inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
            <span className="text-[11px] text-slate-400">%</span>
          </Row>
        )}

        {kind === 'perUnit' && (
          <>
            <Row label="คิดจากช่อง" sub>
              <select className={`${FLD} w-[200px]`} value={pdim} onChange={(e) => setPdim(e.target.value)}>
                {vocab.dims.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <span className="text-[11px] text-slate-400">เฉพาะส่วนที่เกิน</span>
              <input className={SM} inputMode="decimal" value={over} placeholder="มาตรฐาน"
                     title="เว้นว่าง = ใช้สเปกที่รวมในราคาตั้งแล้วของรุ่นนี้"
                     onChange={(e) => setOver(e.target.value)} />
            </Row>
            <Row label="ราคา" sub>
              <input className={SM} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
              <span className="text-[11px] text-slate-400">บาท ทุก ๆ</span>
              <input className={SM} inputMode="decimal" value={step} placeholder="1"
                     onChange={(e) => setStep(e.target.value)} />
              <input className={`${FLD} w-[74px]`} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="หน่วย" />
              <span className="text-[11px] text-slate-400">· คูณ</span>
              <input className={SM} inputMode="decimal" value={times} onChange={(e) => setTimes(e.target.value)} placeholder="1" />
            </Row>
          </>
        )}

        <Row label="ลำดับการคิด">
          <input className={SM} inputMode="decimal" value={order} onChange={(e) => setOrder(e.target.value)} />
          <span className="text-[11px] text-slate-400">
            เลขน้อยคิดก่อน — สำคัญเมื่อมีเปอร์เซ็นต์ เพราะเปอร์เซ็นต์คิดจากยอดที่บวกมาแล้ว
          </span>
        </Row>

        <Row label="หมายเหตุ">
          <input className={`${FLD} flex-1 min-w-0`} value={note} onChange={(e) => setNote(e.target.value)}
                 placeholder="เหตุผลที่ตั้งกฎนี้ (ไม่บังคับ)" />
        </Row>
      </div>
    </Modal>
  );
};
