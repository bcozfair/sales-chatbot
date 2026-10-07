/* ─────────────────────────────────────────────────────────────────────────────
   รายงานขั้น 0 ของการยืนยันตัวตน LIFF — อ่านอย่างเดียว (ตาราง liff_auth_observations)

   ตอบสองคำถามก่อนตัดสินใจบังคับ token (ขั้น 1):
     ① userId จาก token ตรงกับ userId ของบอทไหม  → ดู match / mismatch
     ② มีคนเปิดลิงก์ที่เป็นของคนอื่นไหม          → mismatch ที่ userId ทั้งสองเป็นเซลส์คนละคน
   ประกอบ: none (ยังไม่มี token — หน้าเก่าที่ค้างในเครื่อง / หน้าแอดมินเวอร์ชันเก่า) · admin · bad_token · verify_failed

   รัน: npm run diag:liff-auth-report [-- --days 7]
   บน server: docker compose exec app npm run diag:liff-auth-report
   ───────────────────────────────────────────────────────────────────────────── */
import { pool } from '../../config/db.js';
import { listLiffAuthObservationTotals } from '../../db/liffAuthObservationsRepo.js';

const i = process.argv.indexOf('--days');
const DAYS = i > 0 ? Math.max(1, Number(process.argv[i + 1]) || 7) : 7;
const OUTCOMES = ['match', 'mismatch', 'no_claim', 'bad_token', 'verify_failed', 'none', 'admin'] as const;

try {
  const rows = await listLiffAuthObservationTotals(DAYS);
  if (!rows.length) {
    console.log(`ยังไม่มีข้อมูลใน ${DAYS} วันล่าสุด — ขึ้นระบบแล้วหรือยัง / รัน migration 2026-10-07_01 แล้วหรือยัง`);
  } else {
    const days = [...new Set(rows.flatMap((r) => [r.first_day, r.last_day]))].sort();
    console.log(`ช่วงที่มีข้อมูล ${days[0]} ถึง ${days.at(-1)} (ขอดู ${DAYS} วันล่าสุด)\n`);
    const byRoute = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const m = byRoute.get(r.route) ?? {};
      m[r.outcome] = (m[r.outcome] ?? 0) + r.n;
      byRoute.set(r.route, m);
    }
    console.table([...byRoute].map(([route, m]) => ({ route, ...Object.fromEntries(OUTCOMES.map((o) => [o, m[o] ?? 0])) })));

    const sum = (o: string) => rows.filter((r) => r.outcome === o).reduce((s, r) => s + r.n, 0);
    const liffOk = sum('match') + sum('mismatch') + sum('no_claim');
    console.log(`\n① token ของ LINE ที่ถูกต้อง ${liffOk} ครั้ง: ตรง ${sum('match')} · ไม่ตรง ${sum('mismatch')} · หน้าไม่ได้ส่ง userId ${sum('no_claim')}`);
    if (liffOk === 0) console.log('   ยังสรุปไม่ได้ — ยังไม่มีคำขอที่แนบ token');
    else if (sum('mismatch') === 0) console.log('   ✓ userId จาก token ตรงกับของบอททุกครั้ง');
    else {
      console.log('   ✗ มีไม่ตรง — ดูคู่ล่าสุดของแต่ละเส้นข้างล่าง ถ้าไม่ตรงแทบทุกครั้ง = LIFF กับบอทอยู่คนละ provider');
      for (const r of rows.filter((x) => x.outcome === 'mismatch')) {
        console.log(`     ${r.route}: ${r.n} ครั้ง · ล่าสุด หน้าส่ง ${r.last_claimed_user} / token เป็น ${r.last_token_user}`);
      }
    }
    console.log(`② token เสีย ${sum('bad_token')} · ถาม LINE ไม่ได้ ${sum('verify_failed')} · ไม่มี token ${sum('none')} · แอดมิน ${sum('admin')}`);
    console.log('   (ไม่มี token = หน้าเก่าที่ยังค้างในเครื่อง / หน้าแอดมินที่ยังไม่โหลดใหม่ — ควรลดลงจนเหลือ 0 หลังขึ้นระบบไม่กี่วัน)');
  }
} catch (err: unknown) {
  console.error('อ่านตาราง liff_auth_observations ไม่ได้:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
