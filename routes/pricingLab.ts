import { Router, json, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdminRequest } from '../config/auth.js';
import { loadBook, bookStatus, withSubCodes } from '../services/pricingLab/bookStore.js';
import { computePrice } from '../services/pricingLab/engine.js';
import { parseProductCode } from '../services/pricingLab/code.js';
import { makeTemplate, readUploaded, templateFileName } from '../services/pricingLab/bookFile.js';
import {
  applyModels, bookFingerprint, diffBooks, listBackups, restoreBackup, saveBook, KEEP_BACKUPS,
} from '../services/pricingLab/bookUpdate.js';
import type { PriceBook } from '../services/pricingLab/types.js';
import {
  listSubCodes, upsertSubCode, updateSubCode, deleteSubCode, clean,
} from '../db/pricingLabRepo.js';

/**
 * API ของหน้า "คิดราคาสินค้า" — โมดูลที่ถอดออกได้ทั้งก้อน
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
 *   **ห้ามส่ง `book.models[x].cells` ออกไปกับ endpoint ที่ใครเปิดหน้าก็เรียกได้**
 *
 *   **ข้อยกเว้นสองเส้น ที่เจ้าของเคาะเมื่อ 2026-09-21 — อย่า "แก้กลับ"**
 *   `GET /template` กับ `POST /import/*` แตะสมุดราคาทั้งเล่มโดยตั้งใจ เพราะเจ้าของสั่งว่า
 *   **แอดมินต้องแก้ราคาเองได้จากหน้าจอ ไม่ต้องให้ใครไปรัน CLI บนเซิร์ฟเวอร์**
 *   ถ้าลบสองเส้นนี้ทิ้งเพราะเห็นว่าขัดกฎข้างบน ปุ่มบนหน้าจอจะตายโดยไม่มีอะไรฟ้อง
 *   สิ่งที่ทำให้มันไม่ขัดกฎจริง ๆ มีสามข้อ และต้องอยู่ครบทั้งสาม:
 *     1. **ผ่านด่านเดียวกับทั้ง router** (`adminAuthMiddleware` + `page.pricing` ที่ index.ts)
 *        ⇒ คนที่ไม่ได้ล็อกอินโหลดไม่ได้ · ต่างจาก bundle ที่ไม่มีด่านอะไรเลย
 *     2. **ไม่มีอะไรถูก build รวมไปกับหน้าจอ** — ไฟล์เดินทางตอนกดปุ่มแล้วจบ
 *        `PricingLab.tsx` ไม่เก็บสมุดราคาไว้ใน state สักช่อง
 *     3. **ส่วนต่างที่ส่งกลับ เป็นของไฟล์ที่คนนั้นอัปเข้ามาเอง** ⇒ ไม่ได้บอกอะไรที่เขายังไม่มี
 *        (และตัดเหลือ `MAX_DIFF_ROWS` แถวอยู่ดี)
 *   ⇒ เส้นที่ยัง **ห้ามเพิ่ม** คือเส้นที่คืนสมุดราคาให้ **โดยที่ผู้เรียกไม่ได้เป็นคนเอาเข้ามา**
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
const smallJson = json({ limit: '64kb' });

/**
 * เส้นที่รับไฟล์ .xlsx ต้องใหญ่กว่านั้น — แม่แบบราคาเต็มเล่มหนักหลักร้อย KB และ base64
 * ทำให้บวมอีก 1.33 เท่า · **ตั้งเพดานใหญ่เฉพาะสองเส้นนี้ ไม่ใช่ทั้ง router** เพราะเพดานที่ใหญ่
 * คือจำนวนหน่วยความจำที่คนยิง request มั่ว ๆ สั่งให้เครื่องนี้จองได้ และอีก 6 เส้นที่เหลือ
 * รับแค่รหัสสินค้ากับแถวรหัสย่อย ซึ่งไม่มีเหตุผลให้เกิน 64kb เลยสักกรณี
 */
const uploadJson = json({ limit: '12mb' });
const UPLOAD_PATHS = new Set(['/import/preview', '/import/apply']);

pricingLabRouter.use((req, res, next) => (UPLOAD_PATHS.has(req.path) ? uploadJson : smallJson)(req, res, next));

/**
 * ส่งส่วนต่างกลับไม่เกินกี่แถว — กันสองอย่างพร้อมกัน: payload ที่บวมจนหน้าค้าง
 * และตารางที่ยาวจนไม่มีใครอ่าน (แถวที่ "หายไป" ถูกเรียงขึ้นก่อนแล้วใน `diffBooks`
 * ⇒ ของที่อันตรายที่สุดอยู่ในโควตาเสมอ ไม่ใช่ของที่ถูกตัดทิ้ง)
 */
const MAX_DIFF_ROWS = 300;

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

/** จำนวนช่องที่มีตัวเลขอยู่ทั้งเล่ม — นับ ไม่ใช่ส่งราคาออกไป */
function countCells(book: PriceBook): number {
  let n = 0;
  for (const m of Object.values(book.models)) {
    if (m.base.kind === 'matrix') n += Object.keys(m.base.cells).length;
    if (m.base.kind === 'banded') n += m.base.bands.length;
    for (const a of m.adders) n += Object.keys(a.rates ?? {}).length + (a.amount === undefined ? 0 : 1);
  }
  return n;
}

/**
 * `data:…;base64,xxx` หรือ base64 เปล่า ๆ → ไบต์
 *
 * ท่าเดียวกับที่หน้าอัปลายเซ็นใช้ (`FileReader.readAsDataURL` → JSON POST) เพราะรีโปนี้
 * **ไม่มีไลบรารี multipart** และการเพิ่มเข้ามาเพื่อปุ่มเดียวคือการเพิ่มพื้นผิวให้ทั้งแอป
 * คืน `null` เมื่อไม่ใช่ base64 จริง — ปล่อยให้ `Buffer.from` เดาเองจะได้ไฟล์ขยะที่ error ทีหลัง
 * ในที่ที่ไกลจากสาเหตุ
 */
function decodeUpload(raw: unknown): Buffer | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const b64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  if (!/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(b64)) return null;
  const buf = Buffer.from(b64, 'base64');
  return buf.length > 0 ? buf : null;
}

/** วันที่/เวลาแบบ ISO ของ "ตอนนี้" — แยกออกมาเพื่อให้ด่านตรวจส่งเวลาปลอมเข้าไปได้ */
const nowIso = () => new Date().toISOString();

/**
 * ดาวน์โหลดแม่แบบ — ไฟล์เดียวที่ปุ่ม "ส่งออก" ผลิต (เจ้าของเคาะ: ออกไฟล์เดียว ไม่ให้เลือก)
 *
 * ส่งเป็นไบต์ตรง ๆ ไม่ใช่ base64 เพราะขาไปฝั่งเบราว์เซอร์ใช้ `fetch` + `blob` อยู่แล้ว
 * (ต้องแนบ Authorization ⇒ `<a href>` ธรรมดาใช้ไม่ได้ เพราะเบราว์เซอร์ไม่แนบ header ให้)
 */
pricingLabRouter.get('/template', async (_req: AdminRequest, res: Response) => {
  const book = loadBook();
  if (!book) return noBook(res);

  const today = nowIso().slice(0, 10);
  const name = templateFileName(today);
  const bytes = makeTemplate(book, today);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  // ชื่อไฟล์เป็นภาษาไทย ⇒ ต้องมี filename* (RFC 5987) ไม่งั้นเบราว์เซอร์ได้ชื่อเป็นเครื่องหมายคำถาม
  res.setHeader('Content-Disposition', `attachment; filename="pricebook-${today}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(Buffer.from(bytes));
});

/**
 * อ่านไฟล์ที่อัปมา แล้วบอกว่า "ถ้าบันทึก ราคาช่องไหนจะเปลี่ยน" — **ไม่เขียนอะไรทั้งสิ้น**
 *
 * ขั้นนี้คือทั้งเหตุผลที่ปุ่มอัปโหลดปลอดภัยพอจะให้ใครก็ได้ที่เปิดหน้านี้กด: ของที่ย้อนยาก
 * ถูกคั่นด้วยจอที่บันทึกไม่ได้เสมอ ⇒ คนที่อัปไฟล์ผิดรู้ตัวก่อนที่ราคาจะขยับ ไม่ใช่หลังจากนั้น
 */
pricingLabRouter.post('/import/preview', async (req: AdminRequest, res: Response) => {
  const current = loadBook();
  if (!current) return noBook(res);

  const bytes = decodeUpload(req.body?.file);
  if (!bytes) return res.status(400).json({ error: 'ยังไม่ได้แนบไฟล์ หรือไฟล์ที่แนบมาว่างเปล่า' });

  const { book: incoming, issues } = await readUploaded(bytes);
  if (!incoming) return res.json({ ok: false, issues, fingerprint: bookFingerprint() });

  const diff = diffBooks(current, incoming);
  res.json({
    ok: true,
    issues,
    fingerprint: bookFingerprint(),
    summary: diff.summary,
    models: diff.models,
    untouched: diff.untouched,
    rows: diff.rows.slice(0, MAX_DIFF_ROWS),
    totalRows: diff.rows.length,
  });
});

/**
 * บันทึกจริง — **เฉพาะรุ่นที่ติ๊ก** และเฉพาะเมื่อเล่มที่ใช้อยู่ยังเป็นเล่มเดิมกับตอนดูส่วนต่าง
 *
 * ไฟล์ถูกส่งมาใหม่ทั้งก้อนแทนที่จะให้เซิร์ฟเวอร์จำของที่เพิ่งอ่านไว้ โดยตั้งใจ:
 * การจำแปลว่ามีสถานะค้างในหน่วยความจำที่ต้องมีอายุ ต้องเก็บกวาด และหายไปตอน restart
 * ทั้งที่การอ่าน .xlsx ซ้ำใช้เวลาไม่ถึงวินาที ⇒ แลกความเร็วที่ไม่มีใครรู้สึก กับสถานะที่ไม่มีเลย
 */
pricingLabRouter.post('/import/apply', async (req: AdminRequest, res: Response) => {
  const current = loadBook();
  if (!current) return noBook(res);

  const bytes = decodeUpload(req.body?.file);
  if (!bytes) return res.status(400).json({ error: 'ยังไม่ได้แนบไฟล์ หรือไฟล์ที่แนบมาว่างเปล่า' });

  const picked: string[] = Array.isArray(req.body?.models)
    ? req.body.models.filter((m: unknown): m is string => typeof m === 'string')
    : [];
  if (picked.length === 0) return res.status(400).json({ error: 'ยังไม่ได้เลือกรุ่นที่จะบันทึก' });

  if (typeof req.body?.fingerprint === 'string' && req.body.fingerprint !== bookFingerprint()) {
    return res.status(409).json({
      error: 'สมุดราคาเพิ่งถูกบันทึกโดยคนอื่นระหว่างที่คุณกำลังตรวจอยู่ — กรุณาอัปโหลดไฟล์ใหม่อีกครั้งเพื่อดูส่วนต่างที่ตรงกับเล่มล่าสุด',
    });
  }

  const { book: incoming, issues } = await readUploaded(bytes);
  if (!incoming) return res.status(400).json({ error: 'ไฟล์นี้บันทึกไม่ได้', issues });
  // ปล่อยผ่านไปตอนนี้ = ราคาของช่องที่อ่านไม่ออกหายไปเงียบ ๆ ⇒ หยุดที่นี่ ไม่ใช่เตือนแล้วเขียนต่อ
  const stops = issues.filter((i) => i.level === 'error');
  if (stops.length > 0) return res.status(400).json({ error: 'ไฟล์นี้บันทึกไม่ได้', issues });

  const unknown = picked.filter((m) => !(m in incoming.models));
  if (unknown.length > 0) return res.status(400).json({ error: `ไฟล์นี้ไม่มีรุ่น ${unknown.join(' · ')}` });

  const at = nowIso();
  const next = applyModels(current, incoming, picked, {
    at,
    by: req.admin?.username,
    file: typeof req.body?.name === 'string' ? req.body.name.slice(0, 120) : undefined,
  });
  saveBook(next);

  res.json({ ok: true, saved: picked.length, at, fingerprint: bookFingerprint(), issues });
});

/** ย้อนไปเล่มก่อนหน้า — ทางถอยทางเดียวของเครื่องที่ไม่มีใครไปรัน CLI ได้ */
pricingLabRouter.post('/rollback', async (req: AdminRequest, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  if (!name) return res.status(400).json({ error: 'ยังไม่ได้เลือกเล่มที่จะย้อนไป' });
  if (!restoreBackup(name)) return res.status(404).json({ error: 'ไม่พบเล่มนี้แล้ว — อาจมีคนย้อนไปก่อนหน้านี้' });
  res.json({ ok: true, fingerprint: bookFingerprint() });
});

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
    // การ์ด "สมุดราคาที่ระบบใช้อยู่" — ตอบคำถาม "ราคาที่ระบบคิดอยู่ตอนนี้มาจากไหน ใครอัป เมื่อไหร่"
    // จำนวนช่องเป็น **จำนวน** ไม่ใช่ราคา ⇒ ไม่ขัดกฎที่หัวไฟล์
    shelf: book
      ? {
          cells: countCells(book),
          sheets: new Set(Object.values(book.models).map((m) => m.sheet).filter(Boolean)).size,
          edited: book.edited ?? null,
          fingerprint: bookFingerprint(),
          backups: listBackups(),
          keep: KEEP_BACKUPS,
        }
      : null,
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
