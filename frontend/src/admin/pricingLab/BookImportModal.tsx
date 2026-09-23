// ─────────────────────────────────────────────────────────────────────────────
//  กล่อง "อัปโหลดราคาใหม่" — สามขั้น: เลือกไฟล์ → ตรวจก่อนบันทึก → บันทึกแล้ว
//
//  โมดูล "คิดราคาสินค้า" — ถอดออกได้ทั้งก้อน ดู services/pricingLab/README.md
//  เคาะหน้าตาจาก mockup ชุด pb-* เมื่อ 2026-09-21
//
//  **ขั้นกลางคือทั้งเหตุผลที่ปุ่มนี้ปลอดภัยพอจะให้ใครก็ได้ที่เปิดหน้านี้กด** — เจ้าของเคาะว่า
//  ใครเปิดหน้าคิดราคาได้ก็กดได้ (ไม่มีช่องสิทธิ์ใหม่) ⇒ ของที่ย้อนยากต้องถูกคั่นด้วยจอที่
//  **บันทึกอะไรไม่ได้เลย** คนที่อัปไฟล์ผิดจึงรู้ตัวก่อนที่ราคาจะขยับ ไม่ใช่หลังจากนั้น
//
//  ⚠️ สามข้อที่ถ้อยคำบนจอสัญญาไว้ และโค้ดต้องทำให้จริง:
//    1. **"ไม่ติ๊ก = คงราคาเดิม ไม่ได้ลบทิ้ง"** — ฝั่ง server รวมรายรุ่น ไม่ได้เขียนทับทั้งเล่ม
//    2. **ช่องที่ "หายไป" ไม่ใช่ราคา 0** — แสดงเป็นขีด + ป้ายแดง ห้ามแสดงเป็นเลข 0
//    3. **ยังไม่บันทึกจนกว่าจะกดปุ่มขวา** — ขั้นนี้ไม่ยิง `/import/apply` ไม่ว่ากรณีใด
//
//  ⚠️ **สมุดราคาไม่ถูกเก็บไว้ใน state ของหน้าจอ** — ไฟล์ที่แอดมินเลือกถูกถือไว้เป็น base64
//  เพื่อส่งกลับตอนกดบันทึก (ดูเหตุผลที่ `routes/pricingLab.ts`) และหายไปพร้อมกล่องตอนปิด
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, FileSpreadsheet, Info, Undo2, Upload } from 'lucide-react';
import { Modal } from '../Modal';
import { Button } from '../Button';
import { errMsg } from '../logs/format';
import type { DiffModel, DiffRow, ImportIssue, ImportPreview } from './types';

interface Props {
  authHeaders: Record<string, string>;
  /** ปิดกล่อง — ส่ง `saved` มาเมื่อมีการบันทึกจริง เพื่อให้หน้าหลักโหลดข้อมูลใหม่ */
  onClose: (saved: boolean) => void;
}

const money = (v: number) => v.toLocaleString('th-TH');

/** ป้ายของแถวหนึ่ง — สีมาจาก "ทิศของราคา" ไม่ใช่จากความรู้สึก */
const DiffTag: React.FC<{ row: DiffRow }> = ({ row }) => {
  if (row.now === null) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 text-[11px] font-bold">
        <AlertTriangle className="w-3 h-3" />หายไป
      </span>
    );
  }
  if (row.was === null) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--brand-soft)] text-[var(--brand-fg)] border border-[var(--brand-border)] text-[11px] font-bold">
        <Check className="w-3 h-3" />เพิ่มใหม่
      </span>
    );
  }
  const d = row.now - row.was;
  const pct = row.was === 0 ? '' : ` (${d > 0 ? '+' : ''}${((d / row.was) * 100).toFixed(1)}%)`;
  return (
    <span className={`text-[12px] font-bold ${d > 0 ? 'text-amber-800' : 'text-[var(--brand-fg)]'}`}>
      {d > 0 ? '+' : ''}{money(d)}
      <span className="font-normal text-slate-500">{pct}</span>
    </span>
  );
};

const IssueRow: React.FC<{ issue: ImportIssue }> = ({ issue }) => (
  <li className="flex gap-2 items-start text-xs text-slate-700 leading-relaxed">
    <span
      className={`shrink-0 mt-px inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-bold border ${
        issue.level === 'error'
          ? 'bg-red-50 text-red-700 border-red-200'
          : 'bg-slate-100 text-slate-600 border-slate-200'
      }`}
    >
      {issue.level === 'error' ? <AlertTriangle className="w-3 h-3" /> : <Info className="w-3 h-3" />}
      {issue.level === 'error' ? 'หยุด' : 'ข้าม'}
    </span>
    <span>
      {issue.sheet}
      {issue.row ? ` แถว ${issue.row}` : ''} · {issue.message}
    </span>
  </li>
);

export const BookImportModal: React.FC<Props> = ({ authHeaders, onClose }) => {
  const [file, setFile] = useState<{ name: string; b64: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ models: number } | null>(null);

  const jsonHeaders = useMemo(
    () => ({ ...authHeaders, 'Content-Type': 'application/json' }),
    [authHeaders],
  );

  const stops = useMemo(
    () => (preview?.issues ?? []).filter((i) => i.level === 'error'),
    [preview],
  );
  const blocked = !preview?.ok || stops.length > 0;

  /** อ่านไฟล์เป็น base64 — ท่าเดียวกับหน้าอัปลายเซ็น (รีโปนี้ไม่มีไลบรารี multipart) */
  const onPick = useCallback(async (f: File) => {
    setError('');
    setBusy(true);
    setPreview(null);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
        reader.readAsDataURL(f);
      });
      const res = await fetch('/api/admin/pricebook/import/preview', {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify({ file: b64, name: f.name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'อ่านไฟล์ไม่สำเร็จ');
      setFile({ name: f.name, b64 });
      setPreview(body as ImportPreview);
      // เริ่มที่ติ๊กครบทุกรุ่น เพราะกรณีที่พบบ่อยคืออัปทั้งเล่ม
      setPicked(new Set(((body as ImportPreview).models ?? []).map((m) => m.model)));
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [jsonHeaders]);

  const save = useCallback(async () => {
    if (!file || !preview) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/pricebook/import/apply', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          file: file.b64, name: file.name,
          models: [...picked], fingerprint: preview.fingerprint,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'บันทึกไม่สำเร็จ');
      setSaved({ models: body.saved ?? picked.size });
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [file, preview, picked, jsonHeaders]);

  const toggle = (code: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  // ── ขั้นที่ 3 · บันทึกแล้ว ─────────────────────────────────────────────────
  if (saved) {
    return (
      <Modal
        icon={CheckCircle2}
        title="บันทึกแล้ว"
        footer={<Button variant="primary" onClick={() => onClose(true)}>เสร็จสิ้น</Button>}
      >
        <div className="px-5 py-5 space-y-3.5">
          <div className="text-center">
            <div className="w-13 h-13 mx-auto mb-2.5 rounded-full flex items-center justify-center bg-[var(--brand-soft)] text-[var(--brand-fg)] border border-[var(--brand-border)]">
              <Check className="w-6 h-6" />
            </div>
            <b className="block text-[15px] text-slate-900">บันทึกสมุดราคาเล่มใหม่แล้ว</b>
            <span className="block text-xs text-slate-500 mt-1">
              อัปเดต {saved.models} รุ่น · มีผลกับการคิดราคาทันที · รุ่นที่ไม่ได้เลือกยังใช้ราคาเดิม
            </span>
          </div>
          <div className="flex gap-2 items-start rounded-xl px-3 py-2.5 text-xs leading-relaxed bg-[var(--brand-soft)] text-[var(--brand-fg)] border border-[var(--brand-border)]">
            <Undo2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              เล่มก่อนหน้าถูกเก็บไว้ให้แล้ว — กด <b>ย้อนไปเล่มก่อนหน้า</b> บนการ์ด
              “สมุดราคาที่ระบบใช้อยู่” เพื่อกลับได้ทุกเมื่อ
            </span>
          </div>
        </div>
      </Modal>
    );
  }

  // ── ขั้นที่ 1 · เลือกไฟล์ ───────────────────────────────────────────────────
  if (!preview) {
    return (
      <Modal
        icon={Upload}
        title="อัปโหลดราคาใหม่"
        onClose={busy ? undefined : () => onClose(false)}
        footer={
          <>
            <Button onClick={() => onClose(false)} disabled={busy}>ยกเลิก</Button>
            <Button variant="primary" disabled>ถัดไป</Button>
          </>
        }
      >
        <div className="px-5 py-5 space-y-3.5">
          <label className="block cursor-pointer rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:border-[var(--brand-fg)]">
            <input
              type="file"
              accept=".xlsx"
              className="sr-only"
              disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPick(f); }}
            />
            <span className="w-11 h-11 mx-auto mb-2.5 rounded-2xl flex items-center justify-center bg-[var(--brand-soft)] text-[var(--brand-fg)]">
              <FileSpreadsheet className="w-5 h-5" />
            </span>
            <b className="block text-sm text-slate-900">
              {busy ? 'กำลังอ่านไฟล์…' : 'กดเพื่อเลือกไฟล์ .xlsx'}
            </b>
            <span className="block text-xs text-slate-500 mt-1">
              ต้องเป็นไฟล์ที่ได้จากปุ่ม “ดาวน์โหลดแม่แบบราคา” แล้วแก้ตัวเลขใน Excel
            </span>
          </label>

          {error && (
            <div className="flex gap-2 items-start rounded-xl px-3 py-2.5 text-xs leading-relaxed bg-red-50 text-red-700 border border-red-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2 items-start rounded-xl px-3 py-2.5 text-xs leading-relaxed bg-blue-50 text-blue-700 border border-blue-200">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              ยังไม่มีอะไรถูกบันทึกในขั้นนี้ — ระบบจะอ่านไฟล์มาเทียบกับเล่มที่ใช้อยู่ แล้ว
              <b>ให้ดูก่อนว่าราคาช่องไหนจะเปลี่ยนบ้าง</b> ก่อนถามว่าจะบันทึกไหม
            </span>
          </div>
        </div>
      </Modal>
    );
  }

  // ── ขั้นที่ 2ข · ไฟล์มีปัญหา ───────────────────────────────────────────────
  //
  // **ไม่แสดงตารางส่วนต่างและไม่ให้เลือกรุ่น** — สองอย่างนั้นกดต่อไม่ได้อยู่แล้ว
  // มีไว้ก็แค่ดันรายการปัญหา (สิ่งเดียวที่ทำอะไรต่อได้) ให้ตกไปอยู่ท้ายจอ
  if (blocked) {
    return (
      <Modal
        icon={AlertTriangle}
        tone="danger"
        title={<>ตรวจก่อนบันทึก <span className="font-normal text-slate-400 font-mono text-[11px]">{file?.name}</span></>}
        onClose={busy ? undefined : () => onClose(false)}
        size="lg"
        footer={
          <>
            <span className="mr-auto text-[11px] text-slate-500">แก้ไฟล์แล้วอัปใหม่</span>
            <Button onClick={() => onClose(false)} disabled={busy}>ยกเลิก</Button>
            <Button icon={Upload} onClick={() => { setPreview(null); setFile(null); }} disabled={busy}>
              เลือกไฟล์ใหม่
            </Button>
            <Button variant="primary" disabled>บันทึก</Button>
          </>
        }
      >
        <div className="px-5 py-4 space-y-2.5">
          <div className="flex gap-2 items-start rounded-xl px-3 py-2.5 text-xs leading-relaxed bg-red-50 text-red-700 border border-red-200">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <b>ไฟล์นี้บันทึกไม่ได้</b> — {stops.length} จุดข้างล่างระบบอ่านไม่ออก
              ถ้าปล่อยผ่าน ราคาของช่องนั้นจะหายไปเงียบ ๆ โดยไม่มีอะไรฟ้อง
            </span>
          </div>
          <ul className="space-y-1.5">
            {preview.issues.map((i, n) => <IssueRow key={n} issue={i} />)}
          </ul>
          {preview.summary && (
            <>
              <p className="text-[11px] text-slate-400">
                ที่เหลือในไฟล์อ่านได้ปกติ — แก้ {stops.length} จุดนี้แล้วอัปใหม่ จะได้
              </p>
              <Summary summary={preview.summary} />
            </>
          )}
        </div>
      </Modal>
    );
  }

  // ── ขั้นที่ 2ก · ตรวจก่อนบันทึก ────────────────────────────────────────────
  const models = preview.models ?? [];
  const rows = preview.rows ?? [];
  const visible = rows.filter((r) => picked.has(r.model));
  const none = picked.size === 0;

  return (
    <Modal
      icon={FileSpreadsheet}
      title={<>ตรวจก่อนบันทึก <span className="font-normal text-slate-400 font-mono text-[11px]">{file?.name}</span></>}
      onClose={busy ? undefined : () => onClose(false)}
      size="xl"
      footer={
        <>
          <span className="mr-auto text-[11px] text-slate-500">
            {none ? 'ยังไม่ได้เลือกรุ่นไหนเลย' : 'ยังไม่บันทึกจนกว่าจะกดปุ่มขวา'}
          </span>
          <Button onClick={() => onClose(false)} disabled={busy}>ยกเลิก</Button>
          <Button variant="primary" icon={Check} busy={busy} disabled={none} onClick={() => void save()}>
            บันทึก {picked.size} รุ่นที่เลือก
          </Button>
        </>
      }
    >
      <div className="px-5 py-4 space-y-2">
        {error && (
          <div className="flex gap-2 items-start rounded-xl px-3 py-2.5 text-xs leading-relaxed bg-red-50 text-red-700 border border-red-200">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* เลือกรุ่น — เจ้าของเคาะว่าต้องเลือกเฉพาะบางรุ่นได้ (2026-09-21) */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="flex items-baseline gap-2 flex-wrap mb-2">
            <b className="text-xs text-slate-900">รุ่นที่จะบันทึก</b>
            {/* คำเตือนอยู่ติดหัวข้อ ไม่ใช่ใต้ชิป — สายตาต้องผ่านมันก่อนไปแตะชิป */}
            <span className="text-[11px] text-slate-500">
              {picked.size} จาก {models.length} รุ่นที่ไฟล์นี้แตะ · ไม่ติ๊ก = <b className="text-slate-700">คงราคาเดิม</b> ไม่ได้ลบทิ้ง
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setPicked(new Set(models.map((m) => m.model)))}
              className="text-[11px] font-bold text-[var(--brand-fg)]"
            >
              เลือกทั้งหมด
            </button>
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className="text-[11px] font-bold text-[var(--brand-fg)]"
            >
              ไม่เลือกเลย
            </button>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {models.map((m) => <ModelChip key={m.model} model={m} on={picked.has(m.model)} onClick={() => toggle(m.model)} />)}
          </div>
        </div>

        {preview.summary && <Summary summary={preview.summary} />}

        {(preview.summary?.removed ?? 0) > 0 && (
          <div className="flex gap-2 items-start rounded-xl px-3 py-2 text-xs leading-relaxed bg-amber-50 text-amber-800 border border-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              ช่องที่ <b>“หายไป”</b> คือแถวที่ถูกเว้นว่างในไฟล์ — ระบบแปลว่า <b>ไม่รับผลิต</b> ไม่ใช่ราคา 0
            </span>
          </div>
        )}

        {/* ตารางบนจอกว้าง · การ์ดบนจอแคบ (docs/design.md หัวข้อ 3) */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="max-h-[clamp(7.5rem,28vh,13.75rem)] overflow-y-auto">
            <table className="w-full text-xs hidden sm:table">
              <thead className="sticky top-0 bg-card">
                <tr className="text-[10.5px] uppercase tracking-wide text-slate-400">
                  <th className="text-left font-semibold px-2.5 py-1.5 border-b border-slate-200">รุ่น</th>
                  <th className="text-left font-semibold px-2.5 py-1.5 border-b border-slate-200">ช่องราคา</th>
                  <th className="text-right font-semibold px-2.5 py-1.5 border-b border-slate-200 whitespace-nowrap">เดิม</th>
                  <th className="text-right font-semibold px-2.5 py-1.5 border-b border-slate-200 whitespace-nowrap">ใหม่</th>
                  <th className="text-right font-semibold px-2.5 py-1.5 border-b border-slate-200 whitespace-nowrap">ส่วนต่าง</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, n) => (
                  <tr key={n} className={r.now === null ? 'bg-red-50' : ''}>
                    <td className="px-2.5 py-1.5 border-b border-slate-100 font-mono text-slate-700 whitespace-nowrap">{r.model}</td>
                    <td className="px-2.5 py-1.5 border-b border-slate-100 text-slate-600 max-w-[240px] truncate" title={r.what}>{r.what}</td>
                    <td className="px-2.5 py-1.5 border-b border-slate-100 text-right text-slate-700 tabular-nums">{r.was === null ? '—' : money(r.was)}</td>
                    <td className="px-2.5 py-1.5 border-b border-slate-100 text-right text-slate-900 font-semibold tabular-nums">{r.now === null ? '—' : money(r.now)}</td>
                    <td className="px-2.5 py-1.5 border-b border-slate-100 text-right"><DiffTag row={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="sm:hidden p-2 space-y-2">
              {visible.map((r, n) => (
                <div key={n} className={`rounded-lg border px-2.5 py-2 ${r.now === null ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-slate-700">{r.model}</span>
                    <DiffTag row={r} />
                  </div>
                  <div className="text-[12px] text-slate-600 mt-0.5">{r.what}</div>
                  <div className="text-[12px] text-slate-600 mt-0.5 tabular-nums">
                    {r.was === null ? '—' : money(r.was)} → <b className="text-slate-900">{r.now === null ? 'ไม่รับผลิต' : money(r.now)}</b>
                  </div>
                </div>
              ))}
            </div>

            {visible.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-slate-400">รุ่นที่ติ๊กไว้ไม่มีช่องไหนเปลี่ยน</p>
            )}
          </div>
        </div>

        <p className="text-[11px] text-slate-400">
          แสดง {visible.length} จาก {preview.totalRows ?? rows.length} ช่องที่ไม่เท่าเดิม · เลื่อนดูได้ทั้งหมด
          {(preview.untouched?.length ?? 0) > 0 && ` · ไฟล์นี้ไม่ได้แตะอีก ${preview.untouched!.length} รุ่นในสมุด`}
        </p>

        {preview.issues.length > 0 && (
          <ul className="space-y-1.5">{preview.issues.map((i, n) => <IssueRow key={n} issue={i} />)}</ul>
        )}
      </div>
    </Modal>
  );
};

/** แถบสรุปสี่ตัวเลข — แถวเดียว ไม่ใช่การ์ดสี่ใบ (ความสูง 70px ไม่คุ้มบนจอเตี้ย) */
const Summary: React.FC<{ summary: { changed: number; added: number; removed: number; same: number } }> = ({ summary }) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
    {([
      ['ราคาเปลี่ยน', summary.changed, 'text-slate-900'],
      ['เพิ่มใหม่', summary.added, 'text-[var(--brand-fg)]'],
      ['หายไป', summary.removed, 'text-red-700'],
      ['เท่าเดิม', summary.same, 'text-slate-900'],
    ] as const).map(([label, n, ink], i) => (
      <div key={label} className={`flex items-baseline gap-1.5 px-2.5 py-1.5 ${i % 2 === 1 ? 'sm:border-l' : ''} ${i > 0 ? 'sm:border-l' : ''} ${i > 1 ? 'border-t sm:border-t-0' : ''} border-slate-200`}>
        <span className={`text-base font-bold tabular-nums ${ink}`}>{n.toLocaleString('th-TH')}</span>
        <span className="text-[11px] text-slate-500">{label}</span>
      </div>
    ))}
  </div>
);

/** ชิปรุ่น — บอกด้วยว่ารุ่นนั้นมีอะไรเปลี่ยนบ้าง ไม่ใช่แค่ชื่อรุ่น */
const ModelChip: React.FC<{ model: DiffModel; on: boolean; onClick: () => void }> = ({ model, on, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border text-xs ${
      on
        ? 'bg-[var(--brand-soft)] text-[var(--brand-fg)] border-[var(--brand-border)]'
        : 'bg-card text-slate-500 border-slate-200'
    }`}
  >
    <span className={`w-3.5 h-3.5 shrink-0 rounded flex items-center justify-center border ${
      on ? 'bg-[var(--brand-fg)] border-[var(--brand-fg)] text-white' : 'bg-slate-100 border-slate-300'
    }`}
    >
      {on && <Check className="w-2.5 h-2.5" />}
    </span>
    <b>{model.model}</b>
    {model.removed > 0 && <span className="text-red-700 font-bold">หาย {model.removed}</span>}
    {model.removed === 0 && model.changed > 0 && <span className="text-slate-500">{model.changed} เปลี่ยน</span>}
    {model.removed === 0 && model.changed === 0 && model.added > 0 && <span className="text-slate-500">+{model.added}</span>}
  </button>
);
