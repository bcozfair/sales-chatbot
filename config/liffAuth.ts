/**
 * liffAuth — ด่านของ API ฝั่ง LIFF ที่ส่ง "ข้อมูลการค้า" ออกไป (เริ่มจากส่วนลดเดิม · 2026-10-07)
 *
 * ── ทำไมต้องมี ────────────────────────────────────────────────────────────
 *   API เดิมของหน้า LIFF (`/api/customers/search` · `/api/quotations` ฯลฯ) **ไม่ตรวจตัวตนเลย** และ
 *   `userId` ที่หน้า LIFF แนบมาใน query ปลอมได้ ⇒ ถ้าเปิดส่วนลดเดิมแบบเดียวกัน คนนอกไล่เลข
 *   `customer_id` แล้วดึงส่วนลดของลูกค้าทั้งหมดได้ · เจ้าของเคาะ 2026-10-07 ให้ยืนยันตัวตนด้วย LINE
 *   **ใช้กับ route ใหม่เท่านั้น** — ไม่ย้อนไปครอบ route เดิม (B3 ข้อ 1: ห้ามทำของเดิมพัง)
 *
 * ── วิธีตรวจ ──────────────────────────────────────────────────────────────
 *   หน้า LIFF ส่ง `Authorization: Bearer <liff.getAccessToken()>` แล้วที่นี่ถาม LINE สองคำถาม
 *     1. `GET oauth2/v2.1/verify` — token ยังไม่หมดอายุ และออกให้ **channel ของ LIFF ของเรา**
 *        (`client_id` = เลขหน้าขีดของ LIFF ID · ไม่เช็กข้อนี้ = token จากแอปของคนอื่นก็ผ่าน)
 *     2. `GET v2/profile` — token นี้เป็นของ userId ไหน (ได้จาก LINE ไม่ใช่จาก query ⇒ ปลอมไม่ได้)
 *   แล้วถามฐานว่า userId นั้นเป็นเซลส์ที่ลงทะเบียนเสร็จแล้ว (`isRegisteredSalesperson`)
 *
 * ── ทางที่ไม่ได้เลือก ─────────────────────────────────────────────────────
 *   · ID token (`liff.getIDToken()`) — ต้องไปเปิดสิทธิ์ `openid` ของแอป LIFF ที่ LINE Developers
 *     Console ก่อน ไม่งั้นได้ `null` ทุกคน · access token มีให้ทุกหน้าที่ `liff.init` + login แล้ว
 *     โดยไม่ต้องตั้งอะไรเพิ่ม และตรงกับกฎ B4 ("`/api/liff/*` ตรวจ LINE access token")
 *   · เชื่อ `userId` ใน query + เช็กว่าเป็นเซลส์ — ปลอมได้ด้วยการพิมพ์ userId ของเซลส์คนไหนก็ได้
 *
 * ── สิ่งที่ต้องรู้ ─────────────────────────────────────────────────────────
 *   · LINE ล่ม/ช้า = 503 (หน้าจอขึ้น "โหลดไม่สำเร็จ" ให้ลองใหม่) **ไม่ใช่** 401/403 ที่จะบอกเซลส์ว่าไม่มีสิทธิ์
 *   · จำผลที่ผ่านไว้ 5 นาทีต่อ token — เปลี่ยนบริษัทในหน้าเดียวหลายรอบไม่ต้องถาม LINE ซ้ำ
 *     (ผลที่ไม่ผ่านไม่จำ) · ไม่ได้อยู่ในเส้นทาง webhook จึงไม่กินงบ 48 วินาที
 *   · ไม่ได้ตั้ง LIFF ID เลย = ไม่มี channel ให้เทียบ ⇒ ปฏิเสธทุกคน (fail-closed)
 */
import { isRegisteredSalesperson } from '../db/repositories.js';

export type LiffAuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 | 503; code: 'NO_TOKEN' | 'BAD_TOKEN' | 'NOT_SALESPERSON' | 'VERIFY_FAILED' };

export interface LiffVerifierDeps {
  fetchImpl: typeof fetch;
  /** channel ID ที่ยอมรับ (ส่วนหน้าขีดของ LIFF ID) */
  allowedChannelIds: () => Set<string>;
  isSalesperson: (userId: string) => Promise<boolean>;
  now: () => number;
}

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 500;
const LINE_TIMEOUT_MS = 5_000;

/** channel ID ของ LIFF ทุกหน้าที่ตั้งไว้ — LIFF ID มีรูป `<channelId>-<สุ่ม>` */
export function liffChannelIdsFromEnv(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const ids = new Set<string>();
  for (const key of ['LIFF_ID', 'LIFF_QUOTE_ID', 'LIFF_PRODUCT_SEARCH_ID']) {
    const channel = String(env[key] ?? '').trim().split('-')[0];
    if (/^\d+$/.test(channel)) ids.add(channel);
  }
  return ids;
}

/** ดึง token จาก `Authorization: Bearer …` — ไม่มี/ผิดรูป = '' */
export function bearerToken(header: unknown): string {
  const m = /^Bearer\s+(\S+)$/i.exec(String(header ?? '').trim());
  return m ? m[1] : '';
}

export function createLiffVerifier(deps: LiffVerifierDeps) {
  const cache = new Map<string, { userId: string; until: number }>();

  async function lineJson(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
    const res = await deps.fetchImpl(url, { ...init, signal: AbortSignal.timeout(LINE_TIMEOUT_MS) });
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  }

  return async function verify(token: string): Promise<LiffAuthResult> {
    if (!token) return { ok: false, status: 401, code: 'NO_TOKEN' };

    const hit = cache.get(token);
    if (hit && hit.until > deps.now()) return { ok: true, userId: hit.userId };
    if (hit) cache.delete(token);

    let userId: string;
    let expiresInSec: number;
    try {
      const v = await lineJson(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(token)}`);
      // LINE ตอบ 400 กับ token ที่หมดอายุ/ไม่มีจริง — นั่นคือ "ไม่ผ่าน" ไม่ใช่ "LINE ล่ม"
      if (v.status >= 400 && v.status < 500) return { ok: false, status: 401, code: 'BAD_TOKEN' };
      if (v.status !== 200) return { ok: false, status: 503, code: 'VERIFY_FAILED' };
      expiresInSec = Number(v.body?.expires_in);
      if (!deps.allowedChannelIds().has(String(v.body?.client_id ?? '')) || !(expiresInSec > 0)) {
        return { ok: false, status: 401, code: 'BAD_TOKEN' };
      }
      const p = await lineJson('https://api.line.me/v2/profile', { headers: { Authorization: `Bearer ${token}` } });
      if (p.status >= 400 && p.status < 500) return { ok: false, status: 401, code: 'BAD_TOKEN' };
      userId = typeof p.body?.userId === 'string' ? p.body.userId : '';
      if (p.status !== 200 || !userId) return { ok: false, status: 503, code: 'VERIFY_FAILED' };
    } catch (err: unknown) {
      console.error('[liffAuth] ถาม LINE ไม่สำเร็จ:', err instanceof Error ? err.message : err);
      return { ok: false, status: 503, code: 'VERIFY_FAILED' };
    }

    let isSales: boolean;
    try {
      isSales = await deps.isSalesperson(userId);
    } catch (err: unknown) {
      console.error('[liffAuth] อ่านตาราง salesperson ไม่สำเร็จ:', err instanceof Error ? err.message : err);
      return { ok: false, status: 503, code: 'VERIFY_FAILED' };
    }
    if (!isSales) return { ok: false, status: 403, code: 'NOT_SALESPERSON' };

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(token, { userId, until: deps.now() + Math.min(CACHE_TTL_MS, expiresInSec * 1000) });
    return { ok: true, userId };
  };
}

const verifyLiffToken = createLiffVerifier({
  fetchImpl: (...args) => fetch(...args),
  allowedChannelIds: () => liffChannelIdsFromEnv(),
  isSalesperson: isRegisteredSalesperson,
  now: () => Date.now(),
});

/**
 * Express middleware — ผ่านแล้วได้ `req.liffUserId` (userId ที่ LINE ยืนยันให้)
 * ตอบ `{ error, code }` เสมอ ให้หน้า LIFF แยก "ไม่มีสิทธิ์" (401/403) ออกจาก "ลองใหม่" (503)
 */
export async function requireLiffSalesperson(req: any, res: any, next: () => void): Promise<void> {
  const r = await verifyLiffToken(bearerToken(req.headers?.authorization));
  if (!r.ok) {
    const error = r.status === 503 ? 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ ลองใหม่อีกครั้ง' : 'ดูได้เฉพาะเซลส์ที่ลงทะเบียนแล้ว';
    res.status(r.status).json({ error, code: r.code });
    return;
  }
  req.liffUserId = r.userId;
  next();
}
