import React, { useEffect, useMemo, useState } from 'react';
import { Tag, AlertTriangle } from 'lucide-react';
import { Modal } from '../Modal';
import { Button } from '../Button';
import { EFFECT_TH, EFFECT_HINT, type ModelBrief, type SubCode, type SubCodeEffect } from './types';

/**
 * กล่องตั้งค่ารหัสย่อย — กล่องเดียวจบ ทั้งตอนเพิ่มใหม่และตอนแก้ของเดิม
 *
 * สามอย่างที่ตั้งใจทำแบบนี้ (เจ้าของเคาะจาก mockup 2026-09-18):
 *
 * 1. **ช่อง "ใช้กับรุ่นไหน" ตั้งต้นที่รุ่นเดียวเสมอ** — ของจริงมีตัวอักษรเดียวกันที่คนละรุ่น
 *    คิดคนละราคา (หน้าแปลน JIS 10K 1": ชีต TS-18 คิด 650 · ชีต TW คิด 800) การตั้งต้นที่
 *    "ทุกรุ่น" จะทำให้คนที่กดผ่าน ๆ เผลอเปลี่ยนราคาของรุ่นที่เขาไม่ได้กำลังดูอยู่
 * 2. **บอกราคาใหม่ก่อนกดบันทึก** — พอบันทึกแล้ว รหัสอื่นทุกตัวที่มีตัวอักษรนี้คิดตามทันที
 *    ถ้ารู้ว่าพิมพ์ผิดหลังกด ก็แปลว่าคิดผิดไปแล้วทั้งชุด · พรีวิวคิดที่เซิร์ฟเวอร์ด้วยโค้ดชุด
 *    เดียวกับตอนบันทึกจริง ไม่ใช่สูตรที่สองบนหน้าจอ ⇒ เลขที่เห็นก่อนกดคือเลขที่จะได้จริงเสมอ
 * 3. **ช่องที่ไม่เกี่ยวกับผลที่เลือกจะหายไป ไม่ใช่จางลง** — ช่องที่เห็นแต่กรอกไม่ได้ทำให้คนเดาว่า
 *    ต้องปลดล็อกยังไง ส่วนช่องที่ไม่อยู่ ไม่มีใครถาม
 */

interface Props {
  token: string;
  /** รหัสย่อยที่กำลังตั้ง — มาจากปุ่มข้างตัวที่อ่านไม่ออก หรือจากรายการ "ยังไม่ได้ตั้งค่า" */
  subCode: string;
  /** รุ่นที่กำลังคิดราคาอยู่ — ใช้เป็นค่าตั้งต้นของขอบเขต */
  modelCode: string;
  models: ModelBrief[];
  /** รหัสที่พิมพ์ไว้ในช่องด้านบน — ใช้ขอพรีวิวราคา (ไม่มี = ไม่โชว์พรีวิว) */
  code: string;
  /** แก้ของเดิม — ไม่ส่ง = เพิ่มใหม่ */
  editing?: SubCode;
  onClose: () => void;
  onSaved: () => void;
}

const EFFECTS: SubCodeEffect[] = ['none', 'flat', 'percent', 'perUnit', 'basePrice', 'setAxis'];

/** ตระกูลของรุ่น: `TS-14` → `TS*` — ตัวเลือกกลางระหว่าง "รุ่นเดียว" กับ "ทุกรุ่น" */
function familyOf(code: string): string | null {
  const m = /^([A-Za-z]+)/.exec(code);
  return m ? `${m[1]}*` : null;
}

export const SubCodeModal: React.FC<Props> = ({
  token, subCode, modelCode, models, code, editing, onClose, onSaved,
}) => {
  const [reads, setReads] = useState(editing?.reads ?? '');
  const [effect, setEffect] = useState<SubCodeEffect>(editing?.effect ?? 'flat');
  const [amount, setAmount] = useState(String(editing?.amount ?? ''));
  const [percent, setPercent] = useState(String(editing?.percent ?? ''));
  const [dim, setDim] = useState(editing?.dim ?? '');
  const [rate, setRate] = useState(String(editing?.rate ?? ''));
  const [axis, setAxis] = useState(editing?.axis ?? '');
  const [value, setValue] = useState(editing?.value ?? '');
  const [scope, setScope] = useState(editing?.scope ?? modelCode);
  const [pattern, setPattern] = useState((editing?.match ?? 'exact') === 'pattern');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<{ before: number | null; after: number | null } | null>(null);

  const family = familyOf(modelCode);
  /** ตัวที่ลงท้ายด้วยตัวเลข (S000) ตั้งเป็นแม่แบบตัวเดียวครอบได้ทั้งชุด S000–S999 */
  const digits = /\d/.test(subCode);
  const asPattern = pattern ? subCode.replace(/\d/g, '#') : subCode;

  const draft: SubCode = useMemo(() => {
    const d: SubCode = { subCode: asPattern, match: pattern ? 'pattern' : 'exact', scope, reads, effect };
    if (effect === 'flat' || effect === 'basePrice') d.amount = Number(amount) || 0;
    if (effect === 'percent') d.percent = Number(percent) || 0;
    if (effect === 'perUnit') { d.rate = Number(rate) || 0; d.dim = dim; }
    if (effect === 'setAxis') { d.axis = axis; d.value = value; }
    return d;
  }, [asPattern, pattern, scope, reads, effect, amount, percent, rate, dim, axis, value]);

  // พรีวิวราคา — debounce 250ms เพราะทุกตัวอักษรที่พิมพ์ในช่องจำนวนเงินจะยิงหนึ่งครั้ง
  // (ท่าเดียวกับที่ ApiLogs.tsx ใช้ — setState ตรง ๆ ใน useEffect ถูก eslint ปฏิเสธ)
  useEffect(() => {
    if (!code) return;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const [plain, withDraft] = await Promise.all([
            fetch('/api/admin/pricing/quote', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ code }),
            }).then((r) => r.json()),
            fetch('/api/admin/pricing/quote', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ code, draft }),
            }).then((r) => r.json()),
          ]);
          setPreview({
            before: plain?.outcome?.unitPrice ?? null,
            after: withDraft?.outcome?.unitPrice ?? null,
          });
        } catch {
          setPreview(null);
        }
      })();
    }, 250);
    return () => clearTimeout(t);
  }, [code, draft, token]);

  async function save() {
    setBusy(true);
    setErr('');
    try {
      const url = editing?.id ? `/api/admin/pricing/subcodes/${editing.id}` : '/api/admin/pricing/subcodes';
      const res = await fetch(url, {
        method: editing?.id ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'บันทึกไม่สำเร็จ');
      onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
      setBusy(false);
    }
  }

  // `bg-card` ไม่ใช่ `bg-surface` — ตัวหลังไม่มีอยู่จริง (มีแต่ `--color-card` ใน @theme)
  // และ Tailwind v4 **ทิ้งคลาสที่ไม่รู้จักเงียบ ๆ** ⇒ build ผ่าน eslint ผ่าน แต่ช่องไม่มีพื้นหลัง
  // ผลที่ตามมาคือรายการของ <select> ที่กางออกเป็นพื้นขาวบนหน้าจอมืด เพราะเบราว์เซอร์
  // ใช้พื้นหลังของ <select> มาวาดรายการ ไม่มีให้ก็ตกไปเป็นค่าตั้งต้นของระบบ (บั๊ก 2026-09-18)
  const fld = 'w-full h-10 px-3 rounded-lg bg-card border border-slate-200 text-sm text-slate-900';
  const lab = 'block text-xs font-bold text-slate-600 mb-1.5';

  return (
    <Modal
      icon={Tag}
      title={editing ? `แก้รหัสย่อย ${editing.subCode}` : `เพิ่มรหัสย่อย ${subCode}`}
      size="lg"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="neutral" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button variant="primary" onClick={() => void save()} busy={busy} disabled={!reads.trim()}>
            บันทึก
          </Button>
        </>
      }
    >
      {/* `p-5` เป็นหน้าที่ของเนื้อกล่อง ไม่ใช่ของ Modal — กล่องอื่นทุกใบก็ใส่เอง (ดูหัว Modal.tsx)
          ลืมใส่แล้วเนื้อจะชนขอบ และบรรทัดแรกโดนขอบบนของกรอบที่เลื่อนได้เฉือนสระบนทิ้ง */}
      <div className="p-5 space-y-3.5">
        <p className="text-xs text-slate-500">ตั้งครั้งเดียว รหัสอื่นที่มีตัวอักษรนี้คิดตามทั้งหมด</p>

        <div>
          <label className={lab} htmlFor="sc-reads">
            อ่านว่าอะไร <span className="font-normal text-slate-400">— เขียนให้คนที่ไม่เคยเห็นรหัสนี้เข้าใจ</span>
          </label>
          <input
            id="sc-reads" className={fld} value={reads} onChange={(e) => setReads(e.target.value)}
            placeholder="เช่น หัวกระโหลก Blacklite ใหญ่" autoFocus
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className={lab} htmlFor="sc-effect">ทำอะไรกับราคา</label>
            <select id="sc-effect" className={fld} value={effect}
                    onChange={(e) => setEffect(e.target.value as SubCodeEffect)}>
              {EFFECTS.map((k) => <option key={k} value={k}>{EFFECT_TH[k]}</option>)}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">{EFFECT_HINT[effect]}</p>
          </div>

          {(effect === 'flat' || effect === 'basePrice') && (
            <div>
              <label className={lab} htmlFor="sc-amount">
                {effect === 'flat' ? 'บวกเพิ่ม (บาท)' : 'ราคาตั้งต้น (บาท)'}
              </label>
              <input id="sc-amount" className={fld} type="number" value={amount}
                     onChange={(e) => setAmount(e.target.value)} />
            </div>
          )}
          {effect === 'percent' && (
            <div>
              <label className={lab} htmlFor="sc-percent">บวก (%)</label>
              <input id="sc-percent" className={fld} type="number" value={percent}
                     onChange={(e) => setPercent(e.target.value)} />
            </div>
          )}
          {effect === 'perUnit' && (
            <>
              <div>
                <label className={lab} htmlFor="sc-rate">ราคาต่อหน่วย (บาท)</label>
                <input id="sc-rate" className={fld} type="number" value={rate}
                       onChange={(e) => setRate(e.target.value)} />
              </div>
              <div>
                <label className={lab} htmlFor="sc-dim">คิดจากช่องไหน</label>
                <input id="sc-dim" className={fld} value={dim} onChange={(e) => setDim(e.target.value)}
                       placeholder="เช่น L1" />
              </div>
            </>
          )}
          {effect === 'setAxis' && (
            <>
              <div>
                <label className={lab} htmlFor="sc-axis">ช่องไหน</label>
                <input id="sc-axis" className={fld} value={axis} onChange={(e) => setAxis(e.target.value)} />
              </div>
              <div>
                <label className={lab} htmlFor="sc-value">ตั้งเป็นค่าอะไร</label>
                <input id="sc-value" className={fld} value={value} onChange={(e) => setValue(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <div>
          <label className={lab} htmlFor="sc-scope">ใช้กับรุ่นไหน</label>
          <select id="sc-scope" className={fld} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value={modelCode}>เฉพาะรุ่น {modelCode} (ที่กำลังคิดอยู่)</option>
            {family && <option value={family}>ทั้งตระกูล {family}</option>}
            <option value="*">ทุกรุ่นในสมุดราคา</option>
            {models.filter((m) => m.code !== modelCode).map((m) => (
              <option key={m.code} value={m.code}>เฉพาะรุ่น {m.code}</option>
            ))}
          </select>
        </div>

        {digits && (
          <label className="flex gap-2.5 items-start text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5 w-4 h-4 shrink-0"
                   checked={pattern} onChange={(e) => setPattern(e.target.checked)} />
            <span>
              ใช้กับตัวที่เลขต่างกันด้วย — <b className="font-mono">{subCode.replace(/\d/g, '#')}</b>
              <span className="block text-slate-400 mt-0.5">
                ครอบทุกตัวที่หน้าตาเหมือนกันแต่ตัวเลขต่าง ตั้งครั้งเดียวได้ทั้งชุด
              </span>
            </span>
          </label>
        )}

        <div className="flex gap-2.5 rounded-xl px-3.5 py-2.5 text-xs leading-relaxed bg-amber-50 border border-amber-200 text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            ค่าเริ่มต้นคือ <b>รุ่นเดียว</b> เพราะของจริงมีตัวอักษรเดียวกันที่คนละรุ่นคิดคนละราคา —
            หน้าแปลน 1 นิ้ว: <b>TS-18 คิด 650</b> · <b>TW คิด 800</b>
          </span>
        </div>

        {preview && preview.after !== null && (
          <div className="rounded-xl px-3.5 py-2.5 text-xs bg-card border border-slate-200 text-slate-700">
            {preview.after === preview.before ? (
              <>ราคาไม่เปลี่ยน — ยังเป็น <b className="text-sm">{preview.before?.toLocaleString()} บาท</b></>
            ) : (
              <>
                ถ้ากดบันทึก ราคาของรหัสนี้จะเป็น{' '}
                <b className="text-sm text-[var(--brand-fg)]">{preview.after.toLocaleString()} บาท</b>{' '}
                {preview.before !== null && (
                  <span className="text-slate-400 line-through">เดิม {preview.before.toLocaleString()}</span>
                )}
              </>
            )}
          </div>
        )}

        {err && <p className="text-xs text-red-700">{err}</p>}
      </div>
    </Modal>
  );
};
