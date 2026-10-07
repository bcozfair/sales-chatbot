/**
 * liffAuthObservationsRepo — SQL ของตัวนับขั้น 0 ของการยืนยันตัวตน LIFF (ตาราง liff_auth_observations)
 *
 * ตัวสังเกตการณ์อยู่ที่ config/liffAuthObserve.ts · ความหมายของคอลัมน์อยู่หัวไฟล์ migration
 * `2026-10-07_01_liff_auth_observations.sql` · ไม่ใส่ `public.` ให้ด่านเอาตารางชั่วคราวมาบังได้
 */
import { pool, type DbExecutor } from '../config/db.js';

/**
 * +1 ให้แถวของวันนี้ (วันไทย) — คู่ userId เก็บเฉพาะเมื่อผู้เรียกส่งมา (แถว mismatch) และไม่ลบคู่เดิมทิ้ง
 * `now() AT TIME ZONE 'Asia/Bangkok'` = เวลาตามนาฬิกาไทย ⇒ ::date ไม่ขึ้นกับ TZ ของโปรเซส
 * **throw ได้** — ผู้เรียกเป็นคนตัดสินว่าจะพักเขียนหรือไม่
 */
export async function recordLiffAuthObservation(
  route: string,
  outcome: string,
  claimedUser: string | null,
  tokenUser: string | null,
  db: DbExecutor = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO liff_auth_observations (day, route, outcome, n, last_at, last_claimed_user, last_token_user)
     VALUES ((now() AT TIME ZONE 'Asia/Bangkok')::date, $1, $2, 1, now(), $3, $4)
     ON CONFLICT (day, route, outcome) DO UPDATE
       SET n = liff_auth_observations.n + 1,
           last_at = now(),
           last_claimed_user = COALESCE(EXCLUDED.last_claimed_user, liff_auth_observations.last_claimed_user),
           last_token_user = COALESCE(EXCLUDED.last_token_user, liff_auth_observations.last_token_user)`,
    [route.slice(0, 60), outcome.slice(0, 20), claimedUser?.slice(0, 64) ?? null, tokenUser?.slice(0, 64) ?? null],
  );
}

export interface LiffAuthObservationTotal {
  route: string;
  outcome: string;
  n: number;
  first_day: string;
  last_day: string;
  last_claimed_user: string | null;
  last_token_user: string | null;
}

/** รวมยอดย้อนหลัง N วัน (รวมวันนี้) ต่อเส้น × ผล — ใช้ในรายงาน `npm run diag:liff-auth-report` */
export async function listLiffAuthObservationTotals(days: number, db: DbExecutor = pool): Promise<LiffAuthObservationTotal[]> {
  const { rows } = await db.query(
    `SELECT route, outcome, sum(n)::int AS n,
            to_char(min(day), 'YYYY-MM-DD') AS first_day, to_char(max(day), 'YYYY-MM-DD') AS last_day,
            (array_agg(last_claimed_user ORDER BY last_at DESC) FILTER (WHERE last_claimed_user IS NOT NULL))[1] AS last_claimed_user,
            (array_agg(last_token_user ORDER BY last_at DESC) FILTER (WHERE last_token_user IS NOT NULL))[1] AS last_token_user
       FROM liff_auth_observations
      WHERE day > (now() AT TIME ZONE 'Asia/Bangkok')::date - $1::int
      GROUP BY route, outcome
      ORDER BY route, outcome`,
    [Math.max(1, Math.floor(days))],
  );
  return rows as LiffAuthObservationTotal[];
}
