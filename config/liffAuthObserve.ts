/**
 * liffAuthObserve — ขั้น 0 ของการยืนยันตัวตน LIFF: "ตรวจแล้วนับ ไม่บล็อก" (เจ้าของสั่ง 2026-10-07)
 *
 * ── ทำไมต้องมี ────────────────────────────────────────────────────────────
 *   API ของหน้า LIFF เชื่อ `userId` ที่หน้าเว็บส่งมา ซึ่งปลอมได้ ทางแก้คือบังคับ access token ของ LINE
 *   (config/liffAuth.ts) แต่ก่อนบังคับต้องรู้ว่าจะกระทบคนใช้งานจริงไหม สองคำถาม:
 *     ① userId จาก token ตรงกับ userId ของบอทไหม (LIFF กับบอทต้องอยู่ provider เดียวกัน)
 *     ② มีคนเปิดลิงก์ที่เป็นของคนอื่นไหม (ลิงก์แก้ใบที่ส่งต่อกัน)
 *   ไฟล์นี้นับคำตอบจากการใช้งานจริงลงตาราง `liff_auth_observations` · ดูผล: `npm run diag:liff-auth-report`
 *
 * ── กติกาที่ห้ามหลุด ────────────────────────────────────────────────────────
 *   · **ไม่บล็อก ไม่หน่วง ไม่เปลี่ยนคำตอบ** — ขาเข้าแค่ผูก res.once('finish') แล้ว next() ทันที
 *     การถาม LINE และการเขียนฐานเกิดหลังคำตอบออกไปแล้ว (แบบเดียวกับ api_logs)
 *   · ไม่อ่าน/parse body เอง — อ่าน req.body ตอน finish ซึ่ง express.json() ของ route นั้น parse ไว้แล้ว
 *     (⚠️ ห้ามเติม body parser แบบ global — POST /callback ต้องได้ raw body)
 *   · ห้าม throw ออกไปไหน · ฐานเขียนไม่ได้ (เช่น ยังไม่รัน migration) = พักเขียน 10 นาที ไม่พ่น log ทุก request
 *
 * ── สิ่งที่นับ ────────────────────────────────────────────────────────────
 *   เฉพาะเส้นใน OBSERVED_ROUTES = ทุกเส้นที่หน้า LIFF สามหน้าเรียก (+ confirm ที่หน้าแอดมินเรียกด้วย userId ใน body)
 *   เส้นที่บังคับแล้ว (`/api/liff/discount-history`) ไม่อยู่ในรายการ · ผลแต่ละแบบอธิบายไว้หัวไฟล์ migration
 *   ห้าม log token เด็ดขาด — เก็บแค่คู่ userId ของแถว mismatch ไว้สอบกลับ
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { getJwtSecret } from './jwt.js';
import { bearerToken, identifyLiffToken, type LiffIdentity } from './liffAuth.js';
import { extractLineUserId } from './apiLogger.js';
import { recordLiffAuthObservation } from '../db/liffAuthObservationsRepo.js';

export type ObserveOutcome = 'none' | 'admin' | 'match' | 'mismatch' | 'no_claim' | 'bad_token' | 'verify_failed';

/** เส้นที่สังเกต — label เป็นรูปแม่แบบ (ไม่มีเลขใบ/รหัส) เพราะตารางนับต่อเส้น ไม่ใช่ต่อ URL */
export const OBSERVED_ROUTES: readonly { method: string; re: RegExp; label: string }[] = [
  { method: 'GET', re: /^\/api\/quotations$/, label: 'GET /api/quotations' },
  { method: 'POST', re: /^\/api\/quotations$/, label: 'POST /api/quotations' },
  { method: 'POST', re: /^\/api\/quotations\/delivery-preview$/, label: 'POST /api/quotations/delivery-preview' },
  { method: 'GET', re: /^\/api\/shipping-fee\/config$/, label: 'GET /api/shipping-fee/config' },
  { method: 'GET', re: /^\/api\/products\/search$/, label: 'GET /api/products/search' },
  { method: 'GET', re: /^\/api\/products\/[^/]+\/blocked$/, label: 'GET /api/products/:code/blocked' },
  { method: 'GET', re: /^\/api\/customers\/search$/, label: 'GET /api/customers/search' },
  { method: 'GET', re: /^\/api\/customer\/[^/]+\/contacts$/, label: 'GET /api/customer/:id/contacts' },
  { method: 'POST', re: /^\/api\/quotation\/draft-cart$/, label: 'POST /api/quotation/draft-cart' },
  { method: 'PUT', re: /^\/api\/quotation\/[^/]+$/, label: 'PUT /api/quotation/:id' },
  { method: 'POST', re: /^\/api\/quotation\/[^/]+\/cancel$/, label: 'POST /api/quotation/:id/cancel' },
  { method: 'POST', re: /^\/api\/quotation\/[^/]+\/confirm$/, label: 'POST /api/quotation/:id/confirm' },
  { method: 'GET', re: /^\/api\/salespeople$/, label: 'GET /api/salespeople' },
  { method: 'GET', re: /^\/api\/branches$/, label: 'GET /api/branches' },
  { method: 'GET', re: /^\/api\/salesperson\/[^/]+$/, label: 'GET /api/salesperson/:userId' },
  { method: 'POST', re: /^\/api\/salesperson\/update-branches$/, label: 'POST /api/salesperson/update-branches' },
];

export function observedRouteLabel(method: string, path: string): string | null {
  for (const r of OBSERVED_ROUTES) if (r.method === method && r.re.test(path)) return r.label;
  return null;
}

/** token แอดมินของเราเองไหม — ตรวจลายเซ็นในเครื่อง ไม่ถามฐาน (แค่นับ ไม่ได้ให้สิทธิ์อะไร) */
export function isAdminJwt(token: string, secret: string = getJwtSecret()): boolean {
  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    return typeof payload?.id === 'number';
  } catch {
    return false;
  }
}

/**
 * ตัดสินผล — ฟังก์ชันบริสุทธิ์ (ด่านเทสได้โดยไม่ต้องยิง LINE)
 * `identity` = ผลของ identifyLiffToken (null เมื่อไม่ได้ถามเพราะไม่มี token หรือเป็น token แอดมิน)
 */
export function classifyObservation(
  token: string, adminToken: boolean, claimed: string | null, identity: LiffIdentity | null,
): { outcome: ObserveOutcome; claimedUser: string | null; tokenUser: string | null } {
  const none = { claimedUser: null, tokenUser: null };
  if (!token) return { outcome: 'none', ...none };
  if (adminToken) return { outcome: 'admin', ...none };
  if (!identity || !identity.ok) {
    return { outcome: identity && !identity.ok && identity.code === 'VERIFY_FAILED' ? 'verify_failed' : 'bad_token', ...none };
  }
  if (!claimed) return { outcome: 'no_claim', ...none };
  if (claimed === identity.userId) return { outcome: 'match', ...none };
  return { outcome: 'mismatch', claimedUser: claimed, tokenUser: identity.userId };
}

const PAUSE_MS = 10 * 60_000;
let pausedUntil = 0;

async function observe(req: Request, label: string): Promise<void> {
  if (Date.now() < pausedUntil) return;
  const token = bearerToken(req.headers?.authorization);
  const admin = token ? isAdminJwt(token) : false;
  const identity = token && !admin ? await identifyLiffToken(token) : null;
  const claimed = extractLineUserId(req.body, req.query, req.params);
  const r = classifyObservation(token, admin, claimed, identity);
  try {
    await recordLiffAuthObservation(label, r.outcome, r.claimedUser, r.tokenUser);
  } catch (err: unknown) {
    pausedUntil = Date.now() + PAUSE_MS;
    console.error('[liff-auth-observe] เขียนตัวนับไม่สำเร็จ — พัก 10 นาที:', err instanceof Error ? err.message : err);
  }
}

/** วางต่อจาก apiLogMiddleware · ไม่บล็อก ไม่หน่วง (ดูหัวไฟล์) */
export function observeLiffIdentity(req: Request, res: Response, next: NextFunction): void {
  try {
    const label = observedRouteLabel(req.method, req.path);
    if (label) {
      res.once('finish', () => {
        observe(req, label).catch((err: unknown) => {
          console.error('[liff-auth-observe] ล้มเหลว:', err instanceof Error ? err.message : err);
        });
      });
    }
  } catch (err: unknown) {
    console.error('[liff-auth-observe] middleware ล้มเหลว:', err instanceof Error ? err.message : err);
  }
  next();
}
