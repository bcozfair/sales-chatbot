import { Router, type Request, type Response } from 'express';
import express from 'express';
import ExcelJS from 'exceljs';
import { Parser } from 'json2csv';
import type { AdminRequest } from '../config/auth.js';
import {
  createLocalContact, updateLocalContactById, deleteLocalContactById, getLocalContactForEdit,
  listContacts, toExportRows, EXPORT_HEADERS, LocalContactError,
} from '../services/localContacts.js';

/**
 * API ของโมดูล "เพิ่มผู้ติดต่อใหม่เอง" — 5 เส้นใต้ `/api/admin/webquote/contacts` (§4.1)
 *
 * ⚠️ ไฟล์ใหม่ทั้งไฟล์ ไม่แตะ endpoint เดิมสักตัว (ท่าเดียวกับ routes/dataDirectory.ts)
 *    ถอนทั้งโมดูลออก = ลบไฟล์นี้ + services/localContacts.ts + db/localContactsRepo.ts
 *    + 2 บรรทัดใน index.ts + 1 บรรทัดใน syncService.ts
 *
 * **สิทธิ์บังคับที่จุด mount ใน index.ts ไม่ใช่ในไฟล์นี้** — ช่อง `quote.manage_contacts`
 * (admin · approver · subadmin ตามที่เจ้าของเคาะ 2026-09-17 ข้อ 1) ⇒ ไม่มีทางที่เส้นใดเส้นหนึ่ง
 * จะหลุดออกไปโดยไม่มีด่าน
 *
 * ทำไมเป็นช่องกลุ่ม `quote.` ไม่ใช่ `page.odoocontacts`: ด่าน `diag:role-permissions` ข้อ 12
 * บังคับว่า **ทุกช่องกลุ่ม `page` ต้องมีเมนูของตัวเองใน AdminApp.tsx** — หน้าจอมาที่ก้อน I4
 * การเปิดช่อง `page` ไว้ล่วงหน้าโดยยังไม่มีเมนูจะทำให้ด่านนั้นล้มทั้งที่ไม่มีอะไรผิด
 * ⇒ I4 เพิ่ม `page.odoocontacts` พร้อมเมนูของมัน แล้วซ้อนเป็นด่านที่สองที่จุด mount เดียวกันนี้
 *
 * **ไม่มีเส้นของทีมขาย** — สืบทอดตอนอ่าน ไม่มีใครส่งค่ามา (§3.5)
 * **ไม่มีเส้น "ติ๊กว่าเพิ่มใน Odoo แล้ว"** — ระบบเขียน `odoo_matched_at` เอง (§6)
 * **ไม่มีเส้นไหนที่ LIFF เรียกได้** — `/api/customer/:id/contacts` ของ LIFF ยังอ่านอย่างเดียว
 * เหมือนเดิมทุกประการ (เจ้าของเคาะ: ใน LINE คือเซลส์ ไม่ใช่แอดมิน จึงไม่เปิดให้เพิ่ม)
 */
export const localContactsRouter = Router();

/** อ่านค่าจาก query string ให้เป็นสตริงเสมอ (express คืน array ได้ถ้าส่งซ้ำ) */
function str(v: unknown): string | undefined {
  if (Array.isArray(v)) v = v[0];
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

/**
 * แปลง error ของ service เป็น HTTP — โค้ดสถานะมาจากตัว error เอง ไม่ใช่เดาที่ route
 * (400 ข้อมูลไม่ผ่าน · 404 ไม่มีแถว · 409 ชื่อซ้ำ/ถูกล็อก · 500 ที่เหลือ)
 */
function sendError(res: Response, where: string, err: unknown): void {
  if (err instanceof LocalContactError) {
    res.status(err.status).json({ error: err.message, code: err.code, detail: err.detail });
    return;
  }
  console.error(`${where} error:`, err);
  res.status(500).json({ error: (err as any)?.message || 'ทำรายการไม่สำเร็จ' });
}

function contactIdOf(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new LocalContactError('BAD_REQUEST', 'id ต้องเป็นตัวเลข', 400);
  }
  return id;
}

localContactsRouter.post('/', express.json(), async (req: AdminRequest, res: Response) => {
  try {
    const row = await createLocalContact(req.body ?? {}, req.admin?.id ?? null);
    res.status(201).json({ contact: row });
  } catch (err) {
    sendError(res, 'POST /api/admin/webquote/contacts', err);
  }
});

localContactsRouter.put('/:id', express.json(), async (req: Request, res: Response) => {
  try {
    res.json({ contact: await updateLocalContactById(contactIdOf(req), req.body ?? {}) });
  } catch (err) {
    sendError(res, 'PUT /api/admin/webquote/contacts/:id', err);
  }
});

localContactsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    await deleteLocalContactById(contactIdOf(req));
    res.json({ ok: true });
  } catch (err) {
    sendError(res, 'DELETE /api/admin/webquote/contacts/:id', err);
  }
});

localContactsRouter.get('/', async (req: Request, res: Response) => {
  try {
    res.json(await listContacts({
      filter: str(req.query.filter) === 'all' ? 'all' : 'pending',
      q: str(req.query.q),
      limit: Number(req.query.limit),
      offset: Number(req.query.offset),
    }));
  } catch (err) {
    sendError(res, 'GET /api/admin/webquote/contacts', err);
  }
});

/**
 * ไฟล์รายชื่อให้แอดมินเอาไปคีย์ใน Odoo — **ตัวส่งงานจริงของโมดูลนี้** (§5.3)
 * ค่าตั้งต้นคือเฉพาะที่ยังไม่เข้า Odoo (ส่งออกทั้งหมดได้ด้วย `filter=all`)
 */
localContactsRouter.get('/export', async (req: Request, res: Response) => {
  try {
    const format = str(req.query.format) === 'csv' ? 'csv' : 'xlsx';
    const { items } = await listContacts({
      filter: str(req.query.filter) === 'all' ? 'all' : 'pending',
      q: str(req.query.q),
      limit: 500,
    });
    const rows = toExportRows(items);
    const baseName = `ผู้ติดต่อใหม่-${new Date().toISOString().slice(0, 10)}`;
    // ชื่อไฟล์ไทยต้องอยู่ในรูป filename* — ส่วน filename ปกติเป็น ASCII ล้วน (กติกาเดียวกับ PDF)
    const asciiName = `new-contacts-${new Date().toISOString().slice(0, 10)}`;
    const disposition = (ext: string) =>
      `attachment; filename="${asciiName}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${baseName}.${ext}`)}`;

    if (format === 'csv') {
      const records = rows.map((r) => Object.fromEntries(EXPORT_HEADERS.map((h, i) => [h, r[i]])));
      const csv = new Parser({ fields: [...EXPORT_HEADERS] }).parse(records);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', disposition('csv'));
      res.send(`﻿${csv}`);   // BOM — ไม่มีแล้ว Excel อ่านภาษาไทยเป็นขยะ
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('ผู้ติดต่อใหม่');
    sheet.addRow([...EXPORT_HEADERS]);
    sheet.getRow(1).font = { bold: true };
    rows.forEach((r) => sheet.addRow(r));
    EXPORT_HEADERS.forEach((h, i) => {
      sheet.getColumn(i + 1).width = Math.max(14, Math.min(38, h.length + 8));
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', disposition('xlsx'));
    res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
  } catch (err) {
    sendError(res, 'GET /api/admin/webquote/contacts/export', err);
  }
});

/**
 * แถวเดียวสำหรับกล่องแก้ไข — **ต้องประกาศหลัง `/export`** ไม่งั้น `/:id` กลืนเส้นนั้นไป
 * (express จับคู่ตามลำดับที่ประกาศ)
 */
localContactsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    res.json({ contact: await getLocalContactForEdit(contactIdOf(req)) });
  } catch (err) {
    sendError(res, 'GET /api/admin/webquote/contacts/:id', err);
  }
});
