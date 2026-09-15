import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader } from '../PageHeader';
import { DatabaseBackup, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Loader2 } from 'lucide-react';
import { useHashState } from './useHashState';
import { TAB_SLUG } from '../navHash';
import { errMsg, formatDateTime, relativeTime, formatBytes, formatMs, formatNumber, thCls, tdCls, numCls } from './format';
import { EmptyState, ErrorBox, Pagination, SkeletonRows, StatTile, TableCard, TableScroll } from './ui';

/**
 * หน้า "การสำรองข้อมูล" — ตอบคำถามเดียว: **ถ้าฐานพังตอนนี้ เสียงานกี่ชั่วโมง**
 *
 * ⚠️ ข้อมูลทั้งหน้ามาจากตาราง `backup_runs` ที่ **สคริปต์บน host เป็นคนเขียน** (cron ตี 3 →
 *   scripts/backup/autoBackup.sh) ไม่ใช่แอป — แอปอยู่ในคอนเทนเนอร์ มองไม่เห็นทั้ง backup/
 *   และ crontab · แบบเดียวกับแถบสถานะ logworker ในหน้าบันทึกระบบ ซึ่งแก้ปัญหาเดียวกัน:
 *   งานเบื้องหลังที่ตายเงียบแล้วทุกคนเข้าใจผิดว่า "ปกติดี"
 *
 * ⚠️ หน้านี้จึงต้องแยก "ไม่มีข้อมูล" ออกจาก "ปกติ" ให้ชัด — ตารางว่างไม่ใช่ข่าวดี
 *   มันแปลว่าไม่มีใครรายงาน ซึ่งอันตรายกว่ารายงานว่าล้ม
 *
 * ตั้งใจไม่มีปุ่มสามอย่าง (ตกลงกับเจ้าของ 2026-09-15):
 *   ดาวน์โหลดไฟล์ — ไฟล์เดียวมี PII ลูกค้าทั้งฐาน + bcrypt hash ของแอดมินทุกคน
 *   กู้คืน        — ท่าที่อันตรายที่สุดในระบบ ไม่ควรอยู่หลังปุ่มเดียวบนเว็บ
 *   สำรองเดี๋ยวนี้ — แอปในคอนเทนเนอร์สั่ง cron/docker บน host ไม่ได้ จะให้ได้ต้องเปิด
 *                   docker socket เข้ากล่อง = ยกสิทธิ์ระดับเครื่องให้โปรเซสที่เสิร์ฟเว็บ
 */

const BRAND = 'var(--brand-fg)';

/** ช้ากว่านี้ = ผิดนัด · รอบละวัน + เผื่อเวลารันจริงคลาดจาก cron (ตรงกับเกณฑ์ใน diag:backup) */
const FRESH_LIMIT_HOURS = 25;

interface BackupRun {
  id: string;
  started_at: string;
  finished_at: string;
  status: string;
  file_name: string | null;
  size_bytes: string | null;
  toc_entries: number | null;
  duration_ms: number | null;
  free_mb_after: number | null;
  kept_files: number | null;
  message: string | null;
}

interface Summary {
  last_run: BackupRun | null;
  last_success: BackupRun | null;
  /** รอบที่ "ล้ม" ล่าสุด — คนละตัวกับ last_run ซึ่งมักเป็นรอบที่ถูกข้าม */
  last_failed: BackupRun | null;
  failing_streak: number;
  kept_files: number | null;
  oldest_kept_at: string | null;
  last_30d: { success: number; failed: number };
}

const STATUS_LABEL: Record<string, string> = {
  success: 'สำเร็จ',
  failed: 'ล้มเหลว',
  skipped: 'ข้ามรอบ',
};

const StatusPill: React.FC<{ status: string }> = ({ status }) => {
  const cls = status === 'success' ? 'bg-emerald-50 text-emerald-700'
            : status === 'failed'  ? 'bg-red-50 text-red-700'
            : 'bg-slate-100 text-slate-500';
  return (
    <span className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
};

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

/** แถบบนสุด — สามสถานะ และแต่ละอันต้องบอก "แล้วต้องทำอะไรต่อ" ไม่ใช่แค่แจ้งว่าแย่ */
const StatusBanner: React.FC<{ installed: boolean; summary: Summary | null }> = ({ installed, summary }) => {
  if (!installed) {
    return (
      <Banner tone="err" icon={XCircle} title="ยังไม่ได้เปิดระบบสำรองอัตโนมัติ"
              detail="ตาราง backup_runs ยังไม่มีในฐาน — รัน migration 2026-09-15_03_backup_runs.sql แล้วติดตั้งตัวจับเวลาด้วย bash scripts/backup/installCron.sh บนเครื่อง" />
    );
  }
  const ageH = hoursSince(summary?.last_success?.finished_at ?? null);
  if (!summary?.last_success) {
    return (
      <Banner tone="err" icon={XCircle} title="ยังไม่เคยสำรองสำเร็จเลย"
              detail={summary?.last_run
                ? `รอบล่าสุด ${relativeTime(summary.last_run.finished_at)} จบด้วยสถานะ "${STATUS_LABEL[summary.last_run.status] ?? summary.last_run.status}" — ${summary.last_run.message ?? 'ไม่มีรายละเอียด'}`
                : 'ยังไม่มีรอบไหนรายงานเข้ามา — ตรวจว่าติดตั้ง cron แล้วหรือยัง (bash scripts/backup/installCron.sh)'} />
    );
  }
  if (summary.failing_streak > 0) {
    return (
      <Banner tone="warn" icon={AlertTriangle}
              title={`ล้มติดกัน ${summary.failing_streak} รอบ — สำรองล่าสุด ${relativeTime(summary.last_success.finished_at)}`}
              detail={summary.last_failed?.message ?? 'ดูสาเหตุในตารางด้านล่าง'} />
    );
  }
  if (ageH !== null && ageH > FRESH_LIMIT_HOURS) {
    return (
      <Banner tone="warn" icon={AlertTriangle}
              title={`ไม่ได้สำรองมา ${relativeTime(summary.last_success.finished_at)}`}
              detail="เกินกำหนดรอบวันละครั้ง — ตรวจว่า cron ยังตั้งอยู่ไหม (npm run diag:backup บนเครื่อง)" />
    );
  }
  const s = summary.last_success;
  return (
    <Banner tone="ok" icon={CheckCircle2}
            title={`สำรองล่าสุด ${relativeTime(s.finished_at)}`}
            detail={`${formatDateTime(s.finished_at)} · ${formatBytes(s.size_bytes)} · ` +
                    (s.toc_entries ? `ตรวจแล้วเปิดกู้ได้ (${formatNumber(s.toc_entries)} รายการ) · ` : '') +
                    `ใช้เวลา ${formatMs(s.duration_ms)}`} />
  );
};

const Banner: React.FC<{
  tone: 'ok' | 'warn' | 'err';
  icon: React.ElementType;
  title: string;
  detail: string;
}> = ({ tone, icon: Icon, title, detail }) => {
  const box = tone === 'ok' ? 'bg-card border-slate-200'
            : tone === 'warn' ? 'bg-amber-50 border-amber-200'
            : 'bg-red-50 border-red-200';
  const ink = tone === 'ok' ? 'text-slate-800' : tone === 'warn' ? 'text-amber-800' : 'text-red-800';
  const sub = tone === 'ok' ? 'text-slate-500' : tone === 'warn' ? 'text-amber-700' : 'text-red-700';
  const iconCls = tone === 'ok' ? 'text-emerald-500' : tone === 'warn' ? 'text-amber-600' : 'text-red-600';
  return (
    <div className={`border rounded-2xl px-4 py-3 flex items-start gap-3 ${box}`}>
      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconCls}`} />
      <div className="min-w-0">
        <div className={`text-sm font-semibold ${ink}`}>{title}</div>
        <div className={`text-xs mt-0.5 break-words ${sub}`}>{detail}</div>
      </div>
    </div>
  );
};

export const BackupReport: React.FC = () => {
  const { token } = useAuth();
  const { state, set } = useHashState(TAB_SLUG.backups, { page: '1', size: '30' });

  const [installed, setInstalled] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<BackupRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const page = Math.max(1, parseInt(state.page) || 1);
  const size = parseInt(state.size) || 30;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ limit: String(size), offset: String((page - 1) * size) });
      const res = await fetch(`/api/admin/logs/backups?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const json = await res.json();
      setInstalled(json.installed !== false);
      setSummary(json.summary ?? null);
      setRows(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (e: unknown) { setError(errMsg(e)); } finally { setLoading(false); }
  }, [token, page, size]);

  // เรียกผ่าน timer แบบเดียวกับหน้าอื่นในกลุ่มนี้ — setState ตรง ๆ ใน effect ทำให้เกิด
  // cascading render (กฎ react-hooks/set-state-in-effect ของ eslint จับได้)
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const keptText = summary?.kept_files != null ? `${summary.kept_files} ชุด` : '—';
  const freeMb = summary?.last_run?.free_mb_after ?? summary?.last_success?.free_mb_after ?? null;

  return (
    <div className="space-y-4">
      <PageHeader icon={DatabaseBackup} title="การสำรองข้อมูล"
                  description="ฐานข้อมูลถูกสำรองอัตโนมัติทุกวันตี 3 โดยตัวจับเวลาบนเครื่องเซิร์ฟเวอร์">
        <button
          onClick={() => { void load(); }}
          disabled={loading}
          aria-label="โหลดรายงานใหม่"
          className="inline-flex items-center gap-1.5 px-3 btn-h rounded-xl text-sm font-medium text-white
                     transition disabled:opacity-60"
          style={{ background: BRAND }}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="hidden sm:inline">รีเฟรช</span>
        </button>
      </PageHeader>

      <StatusBanner installed={installed} summary={summary} />

      {installed && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="เก็บไว้" value={keptText}
                    sub={summary?.oldest_kept_at ? `ย้อนถึง ${formatDateTime(summary.oldest_kept_at)}` : 'ยังไม่มีไฟล์'} />
          <StatTile label="ขนาดไฟล์ล่าสุด" value={formatBytes(summary?.last_success?.size_bytes ?? null)}
                    sub={summary?.last_success?.duration_ms != null ? `ใช้เวลา ${formatMs(summary.last_success.duration_ms)}` : undefined} />
          <StatTile label="ที่ว่างบนดิสก์" value={freeMb != null ? `${(freeMb / 1024).toFixed(1)} GB` : '—'}
                    danger={freeMb != null && freeMb < 2048}
                    sub={freeMb != null && freeMb < 2048 ? 'ใกล้เกณฑ์ที่ระบบจะหยุดสำรอง' : 'วัดหลังรอบล่าสุด'} />
          {/* มีรอบที่ล้ม → ตัวเลขหลักต้องเป็น "จำนวนที่ล้ม" ไม่ใช่จำนวนที่สำเร็จย้อมสีแดง
              ซึ่งอ่านแล้วเหมือนบอกว่าการสำเร็จเป็นเรื่องผิดปกติ (เจอตอนดูหน้าจริง 2026-09-15) */}
          <StatTile label="30 วันล่าสุด"
                    value={(summary?.last_30d.failed ?? 0) > 0
                      ? `ล้ม ${summary?.last_30d.failed} รอบ`
                      : `${summary?.last_30d.success ?? 0} สำเร็จ`}
                    danger={(summary?.last_30d.failed ?? 0) > 0}
                    sub={(summary?.last_30d.failed ?? 0) > 0
                      ? `สำเร็จ ${summary?.last_30d.success ?? 0} รอบ`
                      : 'ไม่มีรอบที่ล้มเลย'} />
        </div>
      )}

      {error && <ErrorBox message={error} onRetry={() => { void load(); }} />}

      <TableCard title="ประวัติการทำงาน"
                 hint="ทุกรอบที่ตัวจับเวลาทำงาน รวมรอบที่ล้มและรอบที่ถูกข้าม — รอบที่ล้มไม่เคยทำให้ไฟล์เก่าหาย">
        <TableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={thCls}>เวลา</th>
                <th className={thCls}>ผล</th>
                <th className={`${thCls} ${numCls}`}>ขนาด</th>
                <th className={`${thCls} ${numCls}`}>ใช้เวลา</th>
                <th className={`${thCls} ${numCls}`}>รายการใน TOC</th>
                <th className={`${thCls} ${numCls}`}>ดิสก์ว่างหลังจบ</th>
                <th className={thCls}>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && rows.length === 0 && <SkeletonRows rows={6} />}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7}>
                  <EmptyState icon={DatabaseBackup}
                              title={installed ? 'ยังไม่มีรอบไหนรายงานเข้ามา' : 'ยังไม่ได้เปิดระบบสำรองอัตโนมัติ'}
                              hint={installed
                                ? 'ตัวจับเวลายังไม่เคยทำงาน หรือยังไม่ได้ติดตั้ง — ตรวจด้วย npm run diag:backup บนเครื่อง'
                                : 'รัน migration แล้วติดตั้ง cron ตามคำแนะนำด้านบน'} />
                </td></tr>
              )}
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className={tdCls}>
                    <div className="text-slate-700 whitespace-nowrap">{formatDateTime(r.finished_at)}</div>
                    <div className="text-xs text-slate-400">{relativeTime(r.finished_at)}</div>
                  </td>
                  <td className={tdCls}><StatusPill status={r.status} /></td>
                  <td className={`${tdCls} ${numCls} whitespace-nowrap text-slate-600`}>{r.size_bytes ? formatBytes(r.size_bytes) : '—'}</td>
                  <td className={`${tdCls} ${numCls} whitespace-nowrap text-slate-600`}>{r.duration_ms != null ? formatMs(r.duration_ms) : '—'}</td>
                  <td className={`${tdCls} ${numCls} whitespace-nowrap text-slate-600`}>{r.toc_entries != null ? formatNumber(r.toc_entries) : '—'}</td>
                  <td className={`${tdCls} ${numCls} whitespace-nowrap text-slate-600`}>
                    {r.free_mb_after != null ? `${(r.free_mb_after / 1024).toFixed(1)} GB` : '—'}
                  </td>
                  {/* ให้ช่องหมายเหตุกว้างพอจะอ่านเป็นประโยค — ถูกบีบเมื่อไหร่ข้อความไทยจะแตกบรรทัด
                      ทีละคำจนแถวสูงเป็นสามเท่า (เห็นจริงที่ความกว้าง 640) */}
                  <td className={`${tdCls} min-w-[18rem] ${r.status === 'failed' ? 'text-red-600' : 'text-slate-500'} break-words`}>
                    {r.message ?? '—'}
                    {r.file_name && <div className="text-xs text-slate-400 break-all mt-0.5">{r.file_name}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        {total > size && (
          <Pagination page={page} pages={Math.max(1, Math.ceil(total / size))} size={size} total={total} unit="รอบ"
                      onPage={p => set({ page: String(p) })}
                      onSize={s => set({ size: String(s), page: '1' })} />
        )}
      </TableCard>

      <p className="text-xs text-slate-400 leading-relaxed px-1">
        รายงานนี้อ่านจากฐานข้อมูลที่ระบบสำรองเอง ⇒ ถ้าฐานล่ม หน้านี้ก็ล่มพร้อมกัน
        ตอนฉุกเฉินแหล่งความจริงคือไฟล์ <code>backup/autobackup.log</code> และคำสั่ง <code>npm run diag:backup</code> บนเครื่องเซิร์ฟเวอร์ ·
        ไฟล์สำรองเก็บอยู่บนดิสก์ลูกเดียวกับฐานข้อมูล ยังไม่มีสำเนานอกเครื่อง
      </p>
    </div>
  );
};
