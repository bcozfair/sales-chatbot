import { Router, json, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdminRequest } from '../config/auth.js';
import type { PricingOutcome, PricingReading } from '../services/drawing/types.js';
import { judge, type DrawingVerdict } from '../services/drawing/checks.js';
import { buildModel } from '../services/drawing/families/registry.js';
import { writeStep } from '../services/drawing/writers/step.js';
import { checkStill, renderSheet } from '../services/drawing/sheet.js';
import { A4_LANDSCAPE, sheetHtml } from '../services/drawing/render/sheetHtml.js';
import { thaiDateDMY } from '../utils/thaiTime.js';

/**
 * API ของ "แบบ 3 มิติ" (เฟส 1 · ใช้ภายใน) — การ์ดในหน้าคำนวณราคา · docs/plan-product-drawing-3d.md §4.3 · §8
 *
 * **ไฟล์นี้ไม่ import ตัวคิดราคา** — `quote` ถูกฉีดเข้ามาที่ index.ts (`quoteForCode` ของ routes/pricingLab.ts)
 * ⇒ แบบกับราคามาจากการอ่านรหัสครั้งเดียวกัน และถอดโมดูลคิดราคา = ถอดบรรทัด mount ของไฟล์นี้ด้วย
 *
 * เส้นทาง (mount ใต้ `/api/admin/drawing` · สิทธิ์ `page.pricing` ที่ index.ts):
 *   POST /preview  { code, picks? } → คำตัดสิน (วาดได้/ส่งได้/ต้องยืนยัน + เหตุผลภาษาคน) + `spec` + `cfg` เมื่อวาดได้
 *                  **การ์ดสร้างชิ้นส่วน/ป้ายเองในเบราว์เซอร์จาก `spec`** (ภาพยืดหดตามทันที · หัวหน้าสั่ง 2026-10-07) — ตัววาดเป็น TS ล้วน
 *                  ชุดเดียวกับที่ STEP ใช้ จึงได้รูปทรงเดียวกัน · `cfg` = สัญญาณแกนหักของผลอ่าน ให้การ์ดใช้คู่กับช่องที่กำลังแก้
 *                  (เดิมส่ง GLB base64 — TS_-11 ~0.1 MB ต่อการแก้หนึ่งครั้ง · สเปกไม่กี่ร้อยไบต์)
 *   POST /step     { code, picks?, confirmed? } → ไฟล์ .step — **เฉพาะที่ส่งได้** (เจ้าของ: ระบบเดาบางช่อง = ปิดปุ่มไฟล์)
 *                  และถ้ามีท่อนที่แบบไม่ได้วาด (`confirm`) ต้องส่ง `confirmed: true` มา (ผู้เสนอราคาติ๊กแล้ว)
 *   POST /sheet    { code, picks?, confirmed?, format: 'pdf'|'png', still? } → กระดาษแบบ A4 (กติกาเดียวกับ /step)
 *                  spec/รหัส/ภาพฉาย/ตาราง มาจากการอ่านของเซิร์ฟเวอร์ · `still` = ภาพนิ่ง 3 มิติจากตัวดูของผู้ใช้ (มุม/ซูมที่เห็น · A12–A13)
 *                  ผ่าน `checkStill` (PNG data URL + ป้ายเป็นตัวเลข/ข้อความ ไม่รับ markup) · ไม่ส่ง = ภาพฉาย 2 มิติเต็มกรอบ
 *                  ผู้เขียนแบบ = ผู้ใช้ที่ล็อกอิน · วันที่ = วันไทยวันนี้ · ลูกค้า/จำนวน/เลขที่แบบ = เฟส 2 (ตอนสร้างลิงก์)
 *                  พิมพ์ด้วย `print` ที่ฉีดเข้ามา (= printHtml ของ pdfGenerator.ts · Chrome ตัวแยก · บล็อกเน็ต)
 * สร้างไฟล์สดทุกครั้ง ไม่เก็บ — โมเดลสามตระกูลแรกสร้างไม่ถึงร้อยมิลลิวินาที · การเก็บไฟล์ 7 วันเป็นของเฟส 2 (ลิงก์ลูกค้า)
 */

/** ผลของ "อ่านรหัส + คิดราคา" ที่ฉีดเข้ามา — รูปส่วนที่ใช้ของผล `quoteForCode` */
export interface CodeQuote {
  code: string;
  parsed: PricingReading;
  outcome: PricingOutcome | null;
}
export type QuoteFn = (code: string, picks?: unknown) => Promise<CodeQuote | null>;
/** พิมพ์หน้า HTML เป็น PDF/PNG (= `printHtml` ของ pdfGenerator.ts — ฉีดเข้ามา ไฟล์นี้ไม่ import puppeteer) */
export type PrintFn = (html: string, opts: { kind: 'pdf' | 'png'; widthMm: number; heightMm: number; pngWidthPx?: number }) => Promise<Uint8Array>;

/** คำตัดสินฉบับที่ส่งให้หน้าจอ — `spec` ส่งแยกเฉพาะเมื่อวาดได้ (ดู /preview) */
function verdictView(v: DrawingVerdict) {
  return { family: v.family, canDraw: v.canDraw, canSend: v.canSend, noDraw: v.noDraw, noSend: v.noSend, confirm: v.confirm };
}

/** ชื่อไฟล์จากรหัส — ตัวอักษรที่ใช้ในชื่อไฟล์ไม่ได้กลายเป็น `_` */
const fileName = (code: string, ext: string): string => `${code.replace(/[^A-Za-z0-9.()+-]+/g, '_').slice(0, 80) || 'drawing'}.${ext}`;

/** โลโก้ Primus ของหัวกระดาษ (ไฟล์เดียวกับใบเสนอราคา PM · ใบ THT ก็ใช้หัว Primus — เจ้าของเคาะ 2026-10-06) */
let logoCache: string | null = null;
const logo = (): string => (logoCache ??= `data:image/png;base64,${readFileSync(join(process.cwd(), 'data', 'logo.png')).toString('base64')}`);

export function createDrawingRouter({ quote, print }: { quote: QuoteFn; print: PrintFn }): Router {
  const router = Router();
  // /sheet รับภาพนิ่ง PNG (~0.5–2 MB เป็น base64) — เส้นอื่นเล็กเท่าเดิม
  const small = json({ limit: '64kb' }), big = json({ limit: '8mb' });

  /** อ่าน + ตัดสินหนึ่งรหัส · ตอบ error เองแล้วคืน null เมื่อใช้ต่อไม่ได้ */
  async function judgeCode(req: AdminRequest, res: Response) {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code) { res.status(400).json({ error: 'ยังไม่ได้ใส่รหัสสินค้า' }); return null; }
    if (code.length > 200) { res.status(400).json({ error: 'รหัสยาวเกินไป' }); return null; }
    const q = await quote(code, req.body?.picks);
    if (!q) { res.status(503).json({ error: 'ยังไม่มีสมุดราคา' }); return null; }
    return { code: q.code, verdict: judge(q.parsed, q.outcome), cfg: { options: q.parsed.cfg?.options ?? [] } };
  }

  router.post('/preview', small, async (req: AdminRequest, res: Response) => {
    const j = await judgeCode(req, res);
    if (!j) return;
    const { code, verdict, cfg } = j;
    if (!verdict.spec) return res.json({ code, verdict: verdictView(verdict) });
    res.json({ code, verdict: verdictView(verdict), spec: verdict.spec, cfg });
  });

  router.post('/step', small, async (req: AdminRequest, res: Response) => {
    const j = await judgeCode(req, res);
    if (!j) return;
    const { code, verdict } = j;
    if (!verdict.spec || !verdict.canSend) return res.status(409).json({ error: 'รหัสนี้ยังโหลดไฟล์แบบไม่ได้', verdict: verdictView(verdict) });
    if (verdict.confirm.length && req.body?.confirmed !== true) return res.status(409).json({ error: 'ติ๊กยืนยันก่อน', verdict: verdictView(verdict) });
    const step = writeStep(buildModel(verdict.spec).solids, code);
    res.setHeader('Content-Type', 'application/step');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName(code, 'step')}"`);
    res.send(step);
  });

  router.post('/sheet', big, async (req: AdminRequest, res: Response) => {
    const format = req.body?.format === 'png' ? 'png' : req.body?.format === 'pdf' ? 'pdf' : null;
    if (!format) return res.status(400).json({ error: 'ไม่รู้จักชนิดไฟล์' });
    let still = null;
    if (req.body?.still != null) {
      const c = checkStill(req.body.still);
      if (typeof c === 'string') return res.status(400).json({ error: `ภาพ 3 มิติใช้ไม่ได้ — ${c}` });
      still = c;
    }
    const j = await judgeCode(req, res);
    if (!j) return;
    const { code, verdict } = j;
    if (!verdict.spec || !verdict.canSend) return res.status(409).json({ error: 'รหัสนี้ยังโหลดไฟล์แบบไม่ได้', verdict: verdictView(verdict) });
    if (verdict.confirm.length && req.body?.confirmed !== true) return res.status(409).json({ error: 'ติ๊กยืนยันก่อน', verdict: verdictView(verdict) });
    const svg = renderSheet({ spec: verdict.spec, code, still, logo: logo(), meta: { drawer: req.admin?.name || req.admin?.username || null, date: thaiDateDMY() } });
    const file = await print(sheetHtml(svg), { kind: format, widthMm: A4_LANDSCAPE.w, heightMm: A4_LANDSCAPE.h, pngWidthPx: 1754 });
    res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName(code, format)}"`);
    res.send(Buffer.from(file));
  });

  return router;
}
