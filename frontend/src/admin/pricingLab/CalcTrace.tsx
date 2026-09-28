import React from 'react';
import { TableCard } from '../logs/ui';
import { type PriceOutcome, type PriceTrace } from './types';

/**
 * การ์ด "วิธีคำนวณทีละขั้น" ของหน้าคำนวณราคา
 *
 * เจ้าของขอ 2026-09-28: "แสดงวิธีการคำนวณอย่างละเอียดว่ามาจากส่วนไหนบ้าง จะได้ตรวจสอบได้ว่า logic ถูกไหม"
 *
 * **ไฟล์นี้ไม่คิดอะไรเลย แค่วาด** — ทุกบรรทัดมาจาก `outcome.trace` ที่เซิร์ฟเวอร์เขียนในจุดเดียวกับที่คิดเงิน
 * (`computePrice` ใน services/pricingLab/engine.ts) ถ้าหน้าจอคิดสูตรเองเพื่ออธิบาย วันหนึ่งคำอธิบายกับตัวเลข
 * จะไม่ตรงกัน แล้วคนตรวจจะเชื่อคำอธิบาย · แถวสรุปท้ายการ์ดก็แค่เรียงตัวเลขของ `breakdown` ต่อกัน ไม่ได้บวกใหม่
 *
 * **กฎที่ไม่ได้คิดก็ขึ้นด้วยโดยตั้งใจ** — ราคาที่ผิดเงียบที่สุดคือกฎที่ควรคิดแต่ถูกข้าม (เงื่อนไขไม่ตรง ·
 * ไม่เกินมาตรฐาน) ซึ่ง `breakdown` ไม่มีทางแสดง เพราะมันเก็บแต่ก้อนที่บวกจริง
 * สถานะมีคำกำกับทุกป้าย ไม่ใช่สีอย่างเดียว (WCAG 1.4.1)
 */

type Rule = PriceTrace['rules'][number];

const STATUS: Record<Rule['status'], { text: string; cls: string }> = {
  applied: { text: 'คิด', cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  skipped: { text: 'ไม่คิด', cls: 'bg-slate-100 border-slate-200 text-slate-500' },
  off: { text: 'ปิดไว้', cls: 'bg-slate-100 border-slate-200 text-slate-500' },
  waiting: { text: 'ยังไม่รวม', cls: 'bg-amber-50 border-amber-200 text-amber-700' },
  blocked: { text: 'คิดไม่ได้', cls: 'bg-red-50 border-red-200 text-red-700' },
};

const n = (v: number) => v.toLocaleString();

const Section: React.FC<{ no: string; title: string; hint?: string; children: React.ReactNode }> = ({ no, title, hint, children }) => (
  <section className="py-3 first:pt-0">
    <h3 className="text-xs font-bold text-slate-900 mb-2">
      <span className="text-slate-400 mr-1.5">{no}</span>{title}
      {hint && <span className="font-normal text-slate-400 ml-2">{hint}</span>}
    </h3>
    {children}
  </section>
);

const Steps: React.FC<{ steps: string[] }> = ({ steps }) =>
  steps.length ? (
    <ul className="mt-1 space-y-0.5 text-[11.5px] text-slate-600 leading-relaxed">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-1.5">
          <span className="text-slate-400 shrink-0">•</span>
          <span className="min-w-0 break-words">{s}</span>
        </li>
      ))}
    </ul>
  ) : null;

const Source: React.FC<{ text?: string }> = ({ text }) =>
  text ? <p className="mt-1 text-[10.5px] text-slate-400 break-words">ที่มาในชีต: {text}</p> : null;

export const CalcTrace: React.FC<{ outcome: PriceOutcome }> = ({ outcome }) => {
  const t = outcome.trace;
  if (!t) return null;
  const priced = outcome.status === 'priced';

  return (
    <TableCard title="วิธีคำนวณทีละขั้น" hint="ทุกบาทมาจากไหน — ใช้ตรวจว่าตรรกะการคิดถูกไหม">
      <div className="px-4 py-3.5 divide-y divide-slate-100">
        {/* ① ค่าที่ใช้คิด */}
        <Section no="①" title="ค่าที่ใช้คิด" hint="ค่าไหนมาจากรหัส ค่าไหนระบบเติมให้">
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,9rem)_minmax(0,1fr)] gap-x-3 text-xs">
            <div className="hidden sm:contents text-[10.5px] font-semibold text-slate-400">
              <span className="pb-1">รายการ</span><span className="pb-1">ค่า</span><span className="pb-1">มาจาก</span>
            </div>
            {t.inputs.map((i) => (
              <div key={`${i.kind}:${i.key}`} className="contents">
                <span className="text-slate-600 pt-1.5 sm:border-t border-slate-100">{i.label}</span>
                <span className="font-semibold text-slate-900 tabular-nums sm:pt-1.5 sm:border-t border-slate-100 break-words">{i.value}</span>
                <span className="text-slate-500 pb-1.5 sm:pt-1.5 sm:pb-0 sm:border-t border-slate-100 break-words">{i.from}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ② ราคาตั้ง */}
        <Section no="②" title="ราคาตั้ง">
          <div className="flex justify-between gap-3 text-xs">
            <span className="font-semibold text-slate-800">{t.base.label}</span>
            <span className="tabular-nums font-semibold text-slate-900 whitespace-nowrap">
              {t.base.amount !== undefined ? `${n(t.base.amount)} บาท` : '—'}
            </span>
          </div>
          <Steps steps={t.base.steps} />
        </Section>

        {/* ③ กฎบวกเพิ่ม */}
        <Section no="③" title="กฎบวกเพิ่ม" hint="ตามลำดับที่คิด · รวมข้อที่ไม่ได้คิดและเหตุผล">
          {t.rules.length === 0 ? (
            <p className="text-xs text-slate-500">ยังไม่ได้ตรวจ — ต้องหาราคาตั้งให้ได้ก่อน</p>
          ) : (
            <ol className="space-y-2.5">
              {t.rules.map((r, i) => {
                const st = STATUS[r.status];
                const muted = r.status === 'skipped' || r.status === 'off';
                return (
                  <li key={`${r.id}-${i}`} className="text-xs">
                    <div className="flex gap-2 items-start">
                      <span className="text-slate-400 tabular-nums w-5 shrink-0 text-right">{i + 1}.</span>
                      <span className={`inline-block whitespace-nowrap px-1.5 py-px rounded-md border text-[10.5px] font-semibold shrink-0 ${st.cls}`}>
                        {st.text}
                      </span>
                      <span className={`flex-1 min-w-0 ${muted ? 'text-slate-500' : 'font-semibold text-slate-800'}`}>{r.label}</span>
                      {r.amount !== undefined && (
                        <span className="text-right whitespace-nowrap">
                          <span className="block tabular-nums font-semibold text-slate-900">+{n(r.amount)}</span>
                          <span className="block tabular-nums text-[10.5px] text-slate-400">ยอดสะสม {n(r.running ?? 0)}</span>
                        </span>
                      )}
                    </div>
                    <div className="pl-7">
                      <Steps steps={r.steps} />
                      {r.reason && (
                        <p className={`mt-0.5 text-[11.5px] ${r.status === 'blocked' ? 'text-red-700' : r.status === 'waiting' ? 'text-amber-700' : 'text-slate-500'}`}>
                          ⇒ {r.reason}
                        </p>
                      )}
                      <Source text={r.source} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Section>

        {/* ④ ข้อห้าม */}
        {t.checks.length > 0 && (
          <Section no="④" title="ข้อห้ามที่ตรวจ">
            <ul className="space-y-1.5 text-xs">
              {t.checks.map((c, i) => (
                <li key={i} className="flex gap-2 items-start">
                  <span className={`inline-block whitespace-nowrap px-1.5 py-px rounded-md border text-[10.5px] font-semibold shrink-0 ${
                    c.hit ? STATUS.blocked.cls : STATUS.applied.cls
                  }`}>
                    {c.hit ? 'ติด' : 'ผ่าน'}
                  </span>
                  <span className="min-w-0">
                    <span className="text-slate-800">{c.message}</span>
                    <span className="block text-[11.5px] text-slate-500 break-words">เงื่อนไขที่ห้าม: {c.condition}</span>
                    <Source text={c.source} />
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* สรุป — เรียงตัวเลขของ breakdown ต่อกันเท่านั้น ไม่ได้บวกใหม่บนจอ */}
        {priced && outcome.breakdown.length > 0 && (
          <Section no="=" title="สรุป">
            <p className="text-xs text-slate-700 tabular-nums break-words">
              {outcome.breakdown.map((b) => n(b.amount ?? 0)).join(' + ')}
              {' = '}
              <b className="text-slate-900">{n(outcome.unitPrice)} บาท</b>
            </p>
          </Section>
        )}
      </div>
    </TableCard>
  );
};
