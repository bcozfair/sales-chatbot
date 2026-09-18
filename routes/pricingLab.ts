import { Router, json, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdminRequest } from '../config/auth.js';
import { loadBook, bookStatus, withSubCodes } from '../services/pricingLab/bookStore.js';
import { computePrice } from '../services/pricingLab/engine.js';
import { parseProductCode } from '../services/pricingLab/code.js';
import type { PriceBook } from '../services/pricingLab/types.js';
import {
  listSubCodes, upsertSubCode, updateSubCode, deleteSubCode, clean,
} from '../db/pricingLabRepo.js';

/**
 * API ของหน้า "คิดราคาสินค้าสั่งทำ" — โมดูลที่ถอดออกได้ทั้งก้อน
 *
 * เจ้าของสั่ง 2026-09-18: เอาเครื่องคิดราคาเข้าหน้าแอดมินจริงเพื่อให้ทดลองใช้หลังล็อกอิน
 * **เฟสแรกยังไม่ต่อกับใบเสนอราคา คิดราคาให้ดูอย่างเดียว** ⇒ ไฟล์นี้ไม่ import
 * quotationService / utils/pricing / services/rules แม้แต่ตัวเดียว และต้องเป็นแบบนั้นต่อไป
 * จนกว่าจะมีคนสั่งให้ต่อ
 *
 * ถอนโมดูลออก = ลบไฟล์นี้ + db/pricingLabRepo.ts + services/pricingLab/
 * + frontend/src/admin/pricingLab/ + 4 บรรทัดในไฟล์เดิม (index.ts 2 · capabilities.ts 1
 * · AdminApp.tsx 1) + `DROP TABLE pricing_subcodes` — ไม่มีของเดิมตัวไหน import โฟลเดอร์นี้
 *
 * สิทธิ์เข้าถึงถูกบังคับที่จุด mount ใน index.ts (adminAuthMiddleware + requireCapability('page.pricing'))
 * ไม่ใช่ในไฟล์นี้ ⇒ ไม่มีทางที่ route ใหม่จะหลุดออกไปโดยไม่มีการตรวจสิทธิ์
 *
 * ⚠️ **ราคาถูกคิดที่นี่ ไม่ได้ส่งสมุดราคาไปให้เบราว์เซอร์คิดเอง** — หน้าแอดมินเป็นไฟล์สาธารณะ
 *   (express.static ที่ public/) การล็อกอินเกิดในเบราว์เซอร์ ⇒ อะไรที่ build รวมไปกับหน้าจอ
 *   ใครก็โหลดได้โดยไม่ต้องล็อกอิน · เบราว์เซอร์จึงเห็นแค่ "ผลของรหัสที่ตัวเองพิมพ์" เท่านั้น
 *   ห้ามเพิ่ม endpoint ที่คืนสมุดราคาทั้งเล่ม และห้ามส่ง `book.models[x].cells` ออกไป
 */
export const pricingLabRouter = Router();

/**
 * body parser ผูกกับ router ตัวนี้ตัวเดียว ไม่ใช่ทั้งแอป
 *
 * กฎเหล็กของรีโปคือ **ห้ามมี `express.json()` แบบ global** เพราะ `line.middleware()` ที่
 * `POST /callback` ต้องได้ raw body ไปคำนวณ HMAC — มีใคร parse ก่อน = บอทหยุดตอบทั้งระบบ
 * `router.use()` ทำงานเฉพาะ request ที่เข้ามาที่ mount path ของ router นี้ จึงไม่แตะ /callback
 * (ท่าเดียวกับที่ index.ts ใส่ `express.json()` ทีละ route)
 */
pricingLabRouter.use(json({ limit: '64kb' }));

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * จำนวนรหัสจริงที่มีรหัสย่อยแต่ละตัว — ภาพนิ่ง ไม่ได้ต่อฐานตอนรัน (ดูหัวไฟล์ census)
 *
 * **ตัดท่อนที่เป็นตัวเลขล้วนทิ้ง** — `(11.5)` `(12.7)` `(1.5)` ในรหัสจริงคือ *ขนาด* ไม่ใช่
 * รหัสย่อยที่ต้องตั้งราคา (ตัวอ่านรหัสจัดการให้แล้วจากแม่แบบของรุ่น) · วัด 2026-09-18:
 * 8 จาก 60 รายการในไฟล์เป็นแบบนี้ และสองตัวแรกขึ้นติดอันดับบนสุดของรายการ "ยังไม่ได้ตั้งค่า"
 * ⇒ ถ้าไม่กรอง หน้าจอจะสั่งให้แอดมินไปตั้งค่าของที่ตั้งไม่ได้ ซึ่งทำให้ทั้งรายการดูเชื่อไม่ได้
 *
 * กรองที่นี่ ไม่ใช่ที่หน้าจอ เพราะมันเป็นข้อเท็จจริงของข้อมูล ไม่ใช่รสนิยมการแสดงผล
 */
const IS_NUMBER_ONLY = /^[\d.]+$/;

const census: unknown = (() => {
  try {
    const raw = JSON.parse(readFileSync(join(HERE, '../services/pricingLab/subcode-census.json'), 'utf8'));
    if (!raw || !Array.isArray(raw.items)) return raw;
    return { ...raw, items: raw.items.filter((it: { token?: string }) => !IS_NUMBER_ONLY.test(it.token ?? '')) };
  } catch {
    return null;
  }
})();

/** สมุดราคา + รหัสย่อยจากตาราง — ทุก endpoint ที่คิดเลขต้องผ่านตัวนี้ ไม่ใช่ `loadBook()` ตรง ๆ */
async function bookWithDb(): Promise<PriceBook | undefined> {
  const book = loadBook();
  if (!book) return undefined;
  return withSubCodes(book, await listSubCodes());
}

function noBook(res: Response) {
  return res.status(503).json({ error: bookStatus().message });
}

/**
 * ทุกอย่างที่หน้าจอต้องใช้ตอนเปิด — **ยกเว้นราคา**
 *
 * รายชื่อรุ่นส่งไปแค่ `code` / `label` / `aliases` ไม่ส่ง `cells` `adders` `base` ตามกฎที่หัวไฟล์
 * (สามช่องนั้นคือราคาจริงทั้งหมดของบริษัท)
 */
pricingLabRouter.get('/overview', async (_req: AdminRequest, res: Response) => {
  const status = bookStatus();
  const book = loadBook();
  const models = book
    ? Object.values(book.models).map((m) => ({
        code: m.code,
        label: m.label,
        sheet: m.sheet,
        aliases: m.aliases ?? [],
      }))
    : [];
  res.json({
    book: status,
    version: book?.version ?? null,
    models,
    subCodes: book ? await listSubCodes() : [],
    fromPriceFile: book?.subCodes ?? [],
    census,
  });
});

/**
 * คิดราคาจากรหัสที่พิมพ์มา · `draft` = รหัสย่อยที่ยังไม่ได้บันทึก
 *
 * `draft` คือทั้งเหตุผลที่ endpoint นี้เป็น POST ไม่ใช่ GET — หน้าจอต้องบอกได้ว่า
 * "ถ้ากดบันทึก ราคาจะกลายเป็นเท่าไหร่" **ก่อน** ที่จะเขียนอะไรลงฐาน ไม่ใช่ให้กดบันทึกไปก่อน
 * แล้วค่อยรู้ว่าพิมพ์ผิด (ซึ่งแปลว่ารหัสอื่นทุกตัวที่มีตัวอักษรนี้คิดผิดตามไปแล้ว)
 */
pricingLabRouter.post('/quote', async (req: AdminRequest, res: Response) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!code) return res.status(400).json({ error: 'ยังไม่ได้ใส่รหัสสินค้า' });
  if (code.length > 200) return res.status(400).json({ error: 'รหัสยาวเกินไป' });

  let book = await bookWithDb();
  if (!book) return noBook(res);

  if (req.body?.draft) {
    const draft = clean(req.body.draft);
    if (!draft) return res.status(400).json({ error: 'รหัสย่อยที่ส่งมายังกรอกไม่ครบ' });
    book = withSubCodes(book, [draft]);
  }

  const parsed = parseProductCode(code, book);
  const outcome = parsed.cfg ? computePrice(parsed.cfg, book) : null;
  res.json({ parsed, outcome });
});

pricingLabRouter.get('/subcodes', async (_req: AdminRequest, res: Response) => {
  res.json({ rows: await listSubCodes() });
});

pricingLabRouter.post('/subcodes', async (req: AdminRequest, res: Response) => {
  const row = await upsertSubCode(req.body, req.admin?.username ?? '');
  if (!row) return res.status(400).json({ error: 'กรอกไม่ครบ — ต้องมีรหัสย่อย ผลกับราคา และค่าของผลนั้น' });
  res.json({ row });
});

pricingLabRouter.put('/subcodes/:id', async (req: AdminRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });
  const row = await updateSubCode(id, req.body, req.admin?.username ?? '');
  if (!row) return res.status(400).json({ error: 'กรอกไม่ครบ หรือไม่พบแถวนี้แล้ว' });
  res.json({ row });
});

pricingLabRouter.delete('/subcodes/:id', async (req: AdminRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });
  const ok = await deleteSubCode(id);
  if (!ok) return res.status(404).json({ error: 'ไม่พบแถวนี้แล้ว' });
  res.json({ ok: true });
});
