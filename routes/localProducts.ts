import { Router, type Request, type Response } from 'express';
import express from 'express';
import ExcelJS from 'exceljs';
import { Parser } from 'json2csv';
import type { AdminRequest } from '../config/auth.js';
import {
  suggestLocalProduct, previewNextRef, searchParents, createLocalProduct, updateLocalProductById,
  deleteLocalProductById, reissueLocalProductRef, listProducts, getLocalProductForEdit, exportProducts,
  countPending, PRODUCT_EXPORT_HEADERS, LocalProductError,
} from '../services/localProducts.js';
import type { LocalProductFilter } from '../db/localProductsRepo.js';

/**
 * API ของโมดูล "สินค้าเพิ่มเอง" — ใต้ `/api/admin/webquote/products` (แผน docs/plan-local-products.md §4.3)
 *
 * ⚠️ ไฟล์ใหม่ทั้งไฟล์ ไม่แตะ endpoint เดิมสักตัว (ท่าเดียวกับ routes/localContacts.ts)
 *    ถอนทั้งโมดูลออก = ลบไฟล์นี้ + services/localProducts.ts + db/localProductsRepo.ts
 *    + utils/productRefPattern.ts + utils/productNamePattern.ts + บรรทัด mount ใน index.ts
 *    + 1 ช่องใน capabilities.ts + 1 บรรทัดใน syncService.ts + ตัวกวาดใน scripts/sync/syncProducts.ts
 *
 * **สิทธิ์บังคับที่จุด mount ใน index.ts ไม่ใช่ในไฟล์นี้** — ช่อง `quote.manage_products`
 * (admin · approver · subadmin · เจ้าของยืนยัน 2026-10-01) · ช่องกลุ่ม `quote.` ไม่ใช่ `page.` เพราะ
 * ด่าน `diag:role-permissions` บังคับว่าทุกช่อง `page` ต้องมีเมนู — หน้ารายการมาที่ J4 พร้อม `page.odooproducts`
 * ซึ่งซ้อนเป็นด่านที่สองเฉพาะ `/list` · `/export` · `/count` (ลงแล้ว J4 · 2026-10-02) (เหตุผลที่เส้นรายการอยู่ที่ `/list` ไม่ใช่ `/`
 * เหมือนฝั่งผู้ติดต่อ: ด่านที่คร่อมบางเส้นต้องระบุ path แต่ `/` คือ path เดียวกับจุด mount)
 *
 * **ปุ่มคิดราคา (`POST /price`) ไม่อยู่ในไฟล์นี้** — mount ที่ index.ts ด้วยตัวจัดการตัวเดียวกับ
 * `POST /api/admin/pricing/quote` (§13.5) ⇒ ไฟล์นี้และ service ไม่ import `services/pricingLab/` สักบรรทัด
 *
 * **ไม่มีเส้น "ติ๊กว่าเข้า Odoo แล้ว"** — ระบบตอบเองท้ายรอบ sync (§7) · **ไม่มีเส้นที่ LIFF เรียกได้** (§2.3)
 */
export const localProductsRouter = Router();

function str(v: unknown): string | undefined {
  if (Array.isArray(v)) v = v[0];
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

/** โค้ดสถานะมาจากตัว error เอง (400 ข้อมูลไม่ผ่าน · 404 ไม่มีแถว · 409 ซ้ำ/ถูกล็อก/รหัสเปลี่ยน · 500 ที่เหลือ) */
function sendError(res: Response, where: string, err: unknown): void {
  if (err instanceof LocalProductError) {
    res.status(err.status).json({ error: err.message, code: err.code, detail: err.detail });
    return;
  }
  console.error(`${where} error:`, err);
  res.status(500).json({ error: (err as any)?.message || 'ทำรายการไม่สำเร็จ' });
}

/** ค่าตั้งต้นคือ "ยังไม่เข้า Odoo ทั้งหมด" — ไฟล์ส่งออกต้องตกที่กลุ่มนี้ (บทเรียนจากฝั่งผู้ติดต่อ) */
const FILTERS: readonly LocalProductFilter[] = ['not_matched', 'pending', 'exported', 'matched', 'all'];
function filterOf(req: Request): LocalProductFilter {
  const v = str(req.query.filter);
  return FILTERS.includes(v as LocalProductFilter) ? (v as LocalProductFilter) : 'not_matched';
}

function idOf(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new LocalProductError('BAD_REQUEST', 'id ต้องเป็นตัวเลข', 400);
  return id;
}

/** ทางหลักของฟอร์ม (§13.1) — ต้นแบบ · รหัส · ชื่อ · ช่องสืบทอด · model ซ้ำไหม · ราคาขั้นต่ำ */
localProductsRouter.get('/suggest', async (req: Request, res: Response) => {
  try {
    res.json(await suggestLocalProduct({
      model: str(req.query.model), parentRef: str(req.query.parent), salesPrice: str(req.query.sales_price),
    }));
  } catch (err) {
    sendError(res, 'GET /api/admin/webquote/products/suggest', err);
  }
});

/** พรีวิว ไม่ใช่การจอง (§1.4) */
localProductsRouter.get('/next-ref', async (req: Request, res: Response) => {
  try {
    res.json(await previewNextRef(str(req.query.parent)));
  } catch (err) {
    sendError(res, 'GET /api/admin/webquote/products/next-ref', err);
  }
});

localProductsRouter.get('/parents', async (req: Request, res: Response) => {
  try {
    res.json(await searchParents(str(req.query.q)));
  } catch (err) {
    sendError(res, 'GET /api/admin/webquote/products/parents', err);
  }
});

localProductsRouter.post('/', express.json(), async (req: AdminRequest, res: Response) => {
  try {
    res.status(201).json({ product: await createLocalProduct(req.body ?? {}, req.admin?.id ?? null) });
  } catch (err) {
    sendError(res, 'POST /api/admin/webquote/products', err);
  }
});

localProductsRouter.get('/list', async (req: Request, res: Response) => {
  try {
    res.json(await listProducts({
      filter: filterOf(req), q: str(req.query.q), limit: Number(req.query.limit), offset: Number(req.query.offset),
    }));
  } catch (err) {
    sendError(res, 'GET /api/admin/webquote/products/list', err);
  }
});

/** ไฟล์ให้แอดมินไปคีย์ Odoo + ประทับ `exported_at` — ตัวส่งงานจริงของโมดูลนี้ (§2.2) */
localProductsRouter.get('/export', async (req: Request, res: Response) => {
  try {
    const format = str(req.query.format) === 'csv' ? 'csv' : 'xlsx';
    const rows = await exportProducts({ filter: filterOf(req), q: str(req.query.q) });
    const day = new Date().toISOString().slice(0, 10);
    // ชื่อไฟล์ไทยต้องอยู่ในรูป filename* — ส่วน filename ปกติเป็น ASCII ล้วน (กติกาเดียวกับ PDF)
    const disposition = (ext: string) =>
      `attachment; filename="new-products-${day}.${ext}"; filename*=UTF-8''${encodeURIComponent(`สินค้าเพิ่มเอง-${day}.${ext}`)}`;

    if (format === 'csv') {
      const records = rows.map((r) => Object.fromEntries(PRODUCT_EXPORT_HEADERS.map((h, i) => [h, r[i]])));
      const csv = new Parser({ fields: [...PRODUCT_EXPORT_HEADERS] }).parse(records);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', disposition('csv'));
      res.send(`﻿${csv}`);   // BOM — ไม่มีแล้ว Excel อ่านภาษาไทยเป็นขยะ
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('สินค้าเพิ่มเอง');
    sheet.addRow([...PRODUCT_EXPORT_HEADERS]);
    sheet.getRow(1).font = { bold: true };
    rows.forEach((r) => sheet.addRow(r));
    PRODUCT_EXPORT_HEADERS.forEach((h, i) => {
      sheet.getColumn(i + 1).width = Math.max(14, Math.min(40, h.length + 8));
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', disposition('xlsx'));
    res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
  } catch (err) {
    sendError(res, 'GET /api/admin/webquote/products/export', err);
  }
});

/** ตัวเลขข้างเมนู (J4) — เส้นแยกเพื่อไม่ต้องคำนวณรายการทั้งก้อน · ⚠️ ต้องประกาศก่อน `/:id` */
localProductsRouter.get('/count', async (_req: Request, res: Response) => {
  try {
    res.json({ pending: await countPending() });
  } catch (err) {
    sendError(res, 'GET /api/admin/webquote/products/count', err);
  }
});

/** ⚠️ ต้องประกาศหลังเส้นชื่อคงที่ทุกเส้น — express จับคู่ตามลำดับ `/:id` จะกลืน `/export` ไป */
localProductsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    res.json({ product: await getLocalProductForEdit(idOf(req)) });
  } catch (err) {
    sendError(res, 'GET /api/admin/webquote/products/:id', err);
  }
});

localProductsRouter.put('/:id', express.json(), async (req: Request, res: Response) => {
  try {
    res.json({ product: await updateLocalProductById(idOf(req), req.body ?? {}) });
  } catch (err) {
    sendError(res, 'PUT /api/admin/webquote/products/:id', err);
  }
});

localProductsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    await deleteLocalProductById(idOf(req));
    res.json({ ok: true });
  } catch (err) {
    sendError(res, 'DELETE /api/admin/webquote/products/:id', err);
  }
});

/** Odoo ปฏิเสธรหัสเดิม → ขอเลขถัดไป (รหัสเดิมเข้า `rejected_refs` · **มีใบอ้างรหัสนี้แล้ว = 409** ระบบไม่ทับรหัสในใบ · §1.5 · §8.4) */
localProductsRouter.post('/:id/reissue-ref', express.json(), async (req: Request, res: Response) => {
  try {
    res.json(await reissueLocalProductRef(idOf(req), req.body ?? {}));
  } catch (err) {
    sendError(res, 'POST /api/admin/webquote/products/:id/reissue-ref', err);
  }
});
