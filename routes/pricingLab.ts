import { Router, json, type Response } from 'express';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdminRequest } from '../config/auth.js';
import {
  NO_BOOK_MESSAGE, bookStatus, loadBookState, tokenOf, withSubCodes, type BookState,
} from '../services/pricingLab/bookStore.js';
import { computePrice } from '../services/pricingLab/engine.js';
import { parseProductCode } from '../services/pricingLab/code.js';
import { displayName } from '../services/pricingLab/labels.js';
import { productsPerModel } from '../services/pricingLab/bookCoverage.js';
import {
  EditRejected, applyModelEdit, applySheetEdit, excelReady, modelEditorView, sheetModels,
} from '../services/pricingLab/modelEditor.js';
import { makeTemplate, readUploaded, templateFileName } from '../services/pricingLab/bookFile.js';
import {
  BookConflict, BookRejected, RevisionNotFound, KEEP_BACKUPS,
  applyModels, commitBookChange, diffBooks, listRestorable, parseRestoreName, restoreRevision,
} from '../services/pricingLab/bookUpdate.js';
import type { PriceBook } from '../services/pricingLab/types.js';
import {
  listSubCodes, upsertSubCode, updateSubCode, deleteSubCode, clean,
} from '../db/pricingLabRepo.js';

/**
 * API ของหน้า "คิดราคาสินค้า" + หน้า "สมุดราคา" — โมดูลที่ถอดออกได้ทั้งก้อน
 *
 * เจ้าของสั่ง 2026-09-18: เอาเครื่องคิดราคาเข้าหน้าแอดมินจริงเพื่อให้ทดลองใช้หลังล็อกอิน
 * **เฟสแรกยังไม่ต่อกับใบเสนอราคา คิดราคาให้ดูอย่างเดียว** ⇒ ไฟล์นี้ไม่ import
 * quotationService / utils/pricing / services/rules แม้แต่ตัวเดียว และต้องเป็นแบบนั้นต่อไป
 * จนกว่าจะมีคนสั่งให้ต่อ
 *
 * ถอนโมดูลออก = ลบไฟล์นี้ + db/pricingLabRepo.ts + db/pricingBookRepo.ts + services/pricingLab/
 * + frontend/src/admin/pricingLab/ + 4 บรรทัดในไฟล์เดิม (index.ts 2 · capabilities.ts 1
 * · AdminApp.tsx 1) + `DROP TABLE pricing_subcodes, pricing_model_history, pricing_models,
 * pricing_book_revisions` — ไม่มีของเดิมตัวไหน import โฟลเดอร์นี้
 *
 * **สมุดราคาอยู่ในฐานตั้งแต่ 2026-09-23** (docs/plan-pricebook-db.md) — ทุกเส้นที่เขียนเรียก
 * `commitBookChange` / `restoreRevision` ใน bookUpdate.ts ที่เดียว ไม่มีเส้นไหนยิง SQL เอง
 * ช่อง `fingerprint` ที่หน้าจอถือ = `r<เลขการบันทึก>` (ชื่อช่องเดิม ทึบเหมือนเดิม ⇒ frontend ไม่ต้องแก้)
 * และ **ต้องส่งมาทุกครั้งที่บันทึก** (เจ้าของเคาะ 2026-09-23 · แผน §12 ข้อ 8) — ยุคไฟล์ไม่ส่งก็ข้ามด่านไปเลย
 *
 * **สอง router สองสิทธิ์** (เจ้าของสั่งแยกเมนู 2026-09-23 — "หน้าคิดราคาก็คือคิดราคาอย่างเดียว")
 *   `pricingLabRouter` → `/api/admin/pricing`   ด่าน `page.pricing`   = คิดราคาอย่างเดียว **เขียนอะไรไม่ได้เลย**
 *   `pricebookRouter`  → `/api/admin/pricebook` ด่าน `page.pricebook` = ทุกเส้นที่แก้ราคา/อ่านราคาทั้งรุ่น
 * ⇒ เจ้าของเปิดหน้าคิดราคาให้เซลส์ได้โดยไม่ต้องยกสิทธิ์แก้ราคาไปด้วย · ก่อนแยก ใครคิดราคาได้ = แก้ราคาได้
 * ⚠️ **เส้นที่เขียนหรือคืนราคาเกินกว่า "ผลของรหัสที่พิมพ์" ห้ามอยู่ใน `pricingLabRouter`** — ใส่ผิดตัว
 *   เมื่อไหร่ สิทธิ์ที่แยกไว้กลายเป็นของประดับทันทีโดยไม่มีอะไรฟ้อง
 *
 * สิทธิ์เข้าถึงถูกบังคับที่จุด mount ใน index.ts (adminAuthMiddleware + requireCapability) ไม่ใช่ในไฟล์นี้
 * ⇒ ไม่มีทางที่ route ใหม่จะหลุดออกไปโดยไม่มีการตรวจสิทธิ์
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
 *     1. **ผ่านด่านของ router** (`adminAuthMiddleware` + `page.pricebook` ที่ index.ts)
 *        ⇒ คนที่ไม่ได้ล็อกอินโหลดไม่ได้ · ต่างจาก bundle ที่ไม่มีด่านอะไรเลย
 *     2. **ไม่มีอะไรถูก build รวมไปกับหน้าจอ** — ไฟล์เดินทางตอนกดปุ่มแล้วจบ
 *        `PricingLab.tsx` ไม่เก็บสมุดราคาไว้ใน state สักช่อง
 *     3. **ส่วนต่างที่ส่งกลับ เป็นของไฟล์ที่คนนั้นอัปเข้ามาเอง** ⇒ ไม่ได้บอกอะไรที่เขายังไม่มี
 *        (และตัดเหลือ `MAX_DIFF_ROWS` แถวอยู่ดี)
 *   **เส้นที่สาม เพิ่ม 2026-09-23** — `GET/PUT /model/:code` (หน้า "แก้ราคาทีละรุ่น")
 *   เจ้าของสั่งให้เอาแบบที่เคาะใน mockup มาใส่ของจริง: แก้ราคา+โครงกฎทีละรุ่นจากหน้าจอ
 *   โดยไม่ต้องดาวน์โหลด Excel ⇒ เส้นนี้ **คืนราคาของรุ่นเดียวให้คนที่ไม่ได้เป็นคนอัปมันเข้ามา**
 *   ซึ่งขัดกับบรรทัดที่เคยเขียนไว้ตรงนี้ ⇒ เขียนเงื่อนไขใหม่ให้ตรงกับของจริง:
 *     · สามข้อข้างบนยังครบทุกข้อ (ด่านเดียวกัน · ไม่มีอะไรอยู่ใน bundle · โหลดตอนกดเท่านั้น)
 *     · และ `GET /template` ที่มีอยู่แล้ว **คืนทั้งเล่ม** ให้คนกลุ่มเดียวกันนี้อยู่ก่อนแล้ว
 *       ⇒ เส้นนี้ให้น้อยกว่าเส้นที่มีอยู่ ไม่ได้เปิดอะไรใหม่ให้ใคร
 *   ⇒ เส้นที่ยัง **ห้ามเพิ่ม** คือเส้นที่คืนสมุดราคาให้ **คนที่ไม่ได้ผ่านด่าน `page.pricebook`**
 *     หรือเส้นที่ทำให้ราคาไปอยู่ใน bundle ของหน้าแอดมิน (ซึ่งไม่มีด่านอะไรเลย)
 */
export const pricingLabRouter = Router();
export const pricebookRouter = Router();

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

pricingLabRouter.use(smallJson);
pricebookRouter.use((req, res, next) => (UPLOAD_PATHS.has(req.path) ? uploadJson : smallJson)(req, res, next));

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

/** สมุดราคา + รหัสย่อยจากตาราง — ทุก endpoint ที่คิดเลขต้องผ่านตัวนี้ ไม่ใช่ `loadBookState()` ตรง ๆ */
async function bookWithDb(): Promise<PriceBook | undefined> {
  const state = await loadBookState();
  if (!state) return undefined;
  return withSubCodes(state.book, await listSubCodes());
}

/**
 * เล่มสำหรับ **หน้าแก้ราคา** — รวมรหัสย่อยจากฐานเพื่อให้รู้ว่าช่องราคาแยกตามแกนช่องไหนควรมี
 * (ชนิดสายที่ตั้งผ่านตารางรหัสย่อย · ดู `knownRateKeys`) · **ห้ามส่งตัวนี้ไป `commitBookChange`**
 * — ตอนบันทึกใช้ `{ ...book, models }` ของเล่มเดิม ไม่งั้นแถวรหัสย่อยในฐานจะถูกคัดลอกลงสมุดราคา
 * แล้วกลายเป็นสองที่ที่ต้องแก้คู่กัน
 */
async function editorBook(book: PriceBook): Promise<PriceBook> {
  return withSubCodes(book, await listSubCodes());
}

function noBook(res: Response) {
  return res.status(503).json({ error: NO_BOOK_MESSAGE });
}

/**
 * ด่านเร็วก่อนบันทึก: ไม่ส่ง token = 400 · token ไม่ใช่หัวเล่มแล้ว = 409 (ไม่ต้องอ่านไฟล์ที่อัปมาเลย)
 * **ด่านจริงอยู่ที่ฐาน** (UNIQUE ของ parent_id ใน commitBookChange) — ตัวนี้แค่ตอบเร็ว
 * คืน `true` เมื่อตอบไปแล้ว
 */
function staleToken(req: AdminRequest, res: Response, state: BookState, conflictMessage: string): boolean {
  const fp = req.body?.fingerprint;
  if (typeof fp !== 'string' || !fp) {
    res.status(400).json({ error: 'ไม่พบเลขอ้างอิงของสมุดราคาที่เปิดอยู่ — เปิดหน้านี้ใหม่แล้วลองอีกครั้ง' });
    return true;
  }
  if (fp !== state.token) {
    res.status(409).json({ error: conflictMessage });
    return true;
  }
  return false;
}

const IMPORT_CONFLICT = 'สมุดราคาเพิ่งถูกบันทึกโดยคนอื่นระหว่างที่คุณกำลังตรวจอยู่ — กรุณาอัปโหลดไฟล์ใหม่อีกครั้งเพื่อดูส่วนต่างที่ตรงกับเล่มล่าสุด';
const MODEL_CONFLICT = 'สมุดราคาเพิ่งถูกบันทึกโดยคนอื่นระหว่างที่คุณกำลังแก้อยู่ — เปิดหน้านี้ใหม่แล้วแก้อีกครั้ง เพื่อไม่ให้ทับงานของเขา';

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
pricebookRouter.get('/template', async (_req: AdminRequest, res: Response) => {
  const book = (await loadBookState())?.book;
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
pricebookRouter.post('/import/preview', async (req: AdminRequest, res: Response) => {
  const state = await loadBookState();
  if (!state) return noBook(res);

  const bytes = decodeUpload(req.body?.file);
  if (!bytes) return res.status(400).json({ error: 'ยังไม่ได้แนบไฟล์ หรือไฟล์ที่แนบมาว่างเปล่า' });

  const { book: incoming, issues } = await readUploaded(bytes);
  if (!incoming) return res.json({ ok: false, issues, fingerprint: state.token });

  const diff = diffBooks(state.book, incoming);
  res.json({
    ok: true,
    issues,
    fingerprint: state.token,
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
pricebookRouter.post('/import/apply', async (req: AdminRequest, res: Response) => {
  const state = await loadBookState();
  if (!state) return noBook(res);

  const bytes = decodeUpload(req.body?.file);
  if (!bytes) return res.status(400).json({ error: 'ยังไม่ได้แนบไฟล์ หรือไฟล์ที่แนบมาว่างเปล่า' });

  const picked: string[] = Array.isArray(req.body?.models)
    ? req.body.models.filter((m: unknown): m is string => typeof m === 'string')
    : [];
  if (picked.length === 0) return res.status(400).json({ error: 'ยังไม่ได้เลือกรุ่นที่จะบันทึก' });

  if (staleToken(req, res, state, IMPORT_CONFLICT)) return;

  // อ่าน .xlsx ให้จบก่อน BEGIN — exceljs ห้ามอยู่ใน transaction (กฎของ withTransaction)
  const { book: incoming, issues } = await readUploaded(bytes);
  if (!incoming) return res.status(400).json({ error: 'ไฟล์นี้บันทึกไม่ได้', issues });
  // ปล่อยผ่านไปตอนนี้ = ราคาของช่องที่อ่านไม่ออกหายไปเงียบ ๆ ⇒ หยุดที่นี่ ไม่ใช่เตือนแล้วเขียนต่อ
  const stops = issues.filter((i) => i.level === 'error');
  if (stops.length > 0) return res.status(400).json({ error: 'ไฟล์นี้บันทึกไม่ได้', issues });

  const unknown = picked.filter((m) => !(m in incoming.models));
  if (unknown.length > 0) return res.status(400).json({ error: `ไฟล์นี้ไม่มีรุ่น ${unknown.join(' · ')}` });

  const at = nowIso();
  const fileName = typeof req.body?.name === 'string' ? req.body.name.slice(0, 120) : undefined;
  const next = applyModels(state.book, incoming, picked, { at, by: req.admin?.username, file: fileName });

  let revision: number;
  try {
    revision = await commitBookChange({
      parent: state.revision,
      kind: 'import',
      next,
      changed: picked,
      by: req.admin?.username ?? null,
      // เก็บแค่ชื่อ + sha256 + ขนาดของไฟล์ที่อัป ไม่เก็บตัวไฟล์ (เจ้าของเคาะ 2026-09-23 · แผน §12 ข้อ 4)
      sourceFiles: [{
        name: fileName ?? '(ไม่มีชื่อ)',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
      }],
    });
  } catch (e) {
    if (e instanceof BookConflict) return res.status(409).json({ error: IMPORT_CONFLICT });
    if (e instanceof BookRejected) return res.status(400).json({ error: 'ไฟล์นี้บันทึกไม่ได้', issues: e.problems.map((m) => ({ level: 'error', sheet: '', message: m })) });
    throw e;
  }

  res.json({ ok: true, saved: picked.length, at, fingerprint: tokenOf(revision), issues });
});

/**
 * ย้อนไปเล่มก่อนหน้า — ทางถอยทางเดียวของเครื่องที่ไม่มีใครไปรัน CLI ได้
 *
 * ชื่อที่ส่งมาคือ `rev-<เลข>` จากรายการใน `/overview` · การย้อนคือการบันทึกใหม่ ⇒ ย้อนผิดก็ย้อนกลับได้
 * สิทธิ์เท่ากับทั้งหน้าสมุดราคา (`page.pricebook`) — เจ้าของเคาะ 2026-09-23 (แผน §12 ข้อ 3)
 */
pricebookRouter.post('/rollback', async (req: AdminRequest, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  if (!name) return res.status(400).json({ error: 'ยังไม่ได้เลือกเล่มที่จะย้อนไป' });
  const target = parseRestoreName(name);
  const gone = () => res.status(404).json({ error: 'ไม่พบเล่มนี้แล้ว — อาจมีคนย้อนไปก่อนหน้านี้' });
  if (target === null) return gone();

  let revision: number;
  try {
    revision = await restoreRevision(target, req.admin?.username ?? null);
  } catch (e) {
    if (e instanceof RevisionNotFound) return gone();
    if (e instanceof BookConflict) {
      return res.status(409).json({ error: 'สมุดราคาเพิ่งถูกบันทึกโดยคนอื่น — เปิดหน้านี้ใหม่แล้วลองอีกครั้ง' });
    }
    throw e;
  }
  res.json({ ok: true, fingerprint: tokenOf(revision) });
});

/** รายชื่อรุ่นที่ส่งให้หน้าจอ — `code` คือรหัสในฐาน · `name` คือชื่อที่ขึ้นจอ (ดู `displayName`) */
function modelBriefs(book: PriceBook | undefined) {
  if (!book) return [];
  return Object.values(book.models).map((m) => {
    const { name, others } = displayName(m.code, m.aliases ?? []);
    // `excel` = รุ่นนี้เปิดแบบชีต Excel ได้ (หน้าสมุดรายชีต) — เป็นธงจริง/เท็จ ไม่มีราคาติดไปด้วย
    // `options` = กฎที่รหัสย่อยแบบ "เปิดกฎ" เลือกได้ — ชื่อกฎกับชื่อ option เท่านั้น ไม่มีจำนวนเงิน
    const options = [...new Map(
      m.adders.flatMap((a) => (a.when && 'option' in a.when ? [[a.when.option, a.label] as const] : []))
    )].map(([key, label]) => ({ key, label }));
    // `axes` = ค่าที่แต่ละแกนรับได้ (ชื่อหัวแถว/หัวคอลัมน์ · ค่าของราคาแยกตามแกน) — ชื่ออย่างเดียว ไม่มีราคา
    // ให้ช่อง "ตั้งเป็นค่าอะไร" ของรหัสย่อยเป็นตัวเลือก (เกลียวมิล M8 → คอลัมน์เกลียวไหน · เจ้าของสั่ง 2026-09-25)
    const axes: Record<string, Set<string>> = {};
    const put = (axis: string, v: string) => { if (v !== '') (axes[axis] ??= new Set()).add(v); };
    if (m.base.kind === 'matrix') {
      const names = m.base.axes;
      for (const key of Object.keys(m.base.cells)) key.split(' | ').forEach((v, i) => put(names[i]!, v));
    }
    for (const a of m.adders) if (a.byAxis) for (const k of Object.keys(a.rates ?? {})) put(a.byAxis, k);
    return {
      code: m.code, name, label: m.label, sheet: m.sheet, aliases: m.aliases ?? [], others, excel: excelReady(m), options,
      axes: Object.fromEntries(Object.entries(axes).map(([k, v]) => [k, [...v]])),
    };
  });
}

/**
 * หน้า "คิดราคาสินค้า" ตอนเปิด — แค่พอให้รู้ว่าใช้เล่มไหนอยู่ และอ่านชื่อรุ่นในผลคิดราคาได้
 *
 * ไม่มีรหัสย่อย · census · เล่มสำรอง · จำนวนช่องราคา — ของพวกนั้นเป็นของงานแก้ราคา
 * อยู่ที่ `GET /api/admin/pricebook/overview` หลังด่าน `page.pricebook`
 */
pricingLabRouter.get('/overview', async (_req: AdminRequest, res: Response) => {
  const state = await loadBookState();
  const book = state?.book;
  res.json({
    book: await bookStatus(state),
    version: book?.version ?? null,
    models: modelBriefs(book),
    edited: book?.edited ?? null,
  });
});

/**
 * หน้า "สมุดราคา" ตอนเปิด — ทุกอย่าง **ยกเว้นราคา**
 *
 * รายชื่อรุ่นส่งไปแค่ชื่อ/ชื่ออื่น/จำนวนสินค้าที่ครอบ ไม่ส่ง `cells` `adders` `base` ตามกฎที่หัวไฟล์
 * (สามช่องนั้นคือราคาจริงทั้งหมดของบริษัท)
 */
pricebookRouter.get('/overview', async (_req: AdminRequest, res: Response) => {
  const state = await loadBookState();
  const status = await bookStatus(state);
  const book = state?.book;
  const coverage = state ? await productsPerModel(state) : null;
  res.json({
    book: status,
    version: book?.version ?? null,
    models: modelBriefs(book).map((m) => ({ ...m, products: coverage?.counts[m.code] ?? null })),
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
          fingerprint: state.token,
          backups: await listRestorable(KEEP_BACKUPS),
          keep: KEEP_BACKUPS,
        }
      : null,
  });
});

/**
 * ── หน้า "แก้ราคาทีละรุ่น" ──────────────────────────────────────────────────
 *
 * `GET` คืนทุกอย่างของรุ่นเดียวที่หน้าจอต้องใช้ (ตารางราคา · กฎ · ตัวเลือกท้ายรหัส ·
 * คำศัพท์ให้ช่องเลือก) — เหตุผลที่เส้นนี้คืนราคาได้อยู่ที่หัวไฟล์ อย่าลบทิ้งเพราะเห็นว่าขัดกฎ
 */
pricebookRouter.get('/model/:code', async (req: AdminRequest, res: Response) => {
  const state = await loadBookState();
  if (!state) return noBook(res);
  const { book } = state;
  const code = String(req.params.code ?? '');
  const m = book.models[code];
  if (!m) return res.status(404).json({ error: `ไม่มีรุ่น ${code} ในสมุดราคา` });
  res.json({ model: modelEditorView(await editorBook(book), m), fingerprint: state.token, version: book.version });
});

/**
 * `PUT` บันทึกรุ่นเดียว — **รวมเข้าเล่มเดิม ไม่ใช่เขียนทับทั้งไฟล์**
 *
 * `fingerprint` คือด่านกันสองคนแก้ทับกัน: แอดมิน A เปิดหน้าไว้ · B อัปไฟล์ใหม่ทั้งเล่ม ·
 * A กดบันทึก ⇒ ถ้าไม่ตรวจ งานของ B หายไปทั้งเล่มด้วยหน้าจอที่ A เปิดค้างไว้ตั้งแต่เช้า
 * (ท่าเดียวกับ `/import/apply` — เส้นนี้เพิ่งมาทีหลัง จึงต้องใช้ด่านเดียวกัน ไม่ใช่ด่านที่สอง)
 */
pricebookRouter.put('/model/:code', async (req: AdminRequest, res: Response) => {
  const state = await loadBookState();
  if (!state) return noBook(res);
  const { book } = state;
  const code = String(req.params.code ?? '');
  const current = book.models[code];
  if (!current) return res.status(404).json({ error: `ไม่มีรุ่น ${code} ในสมุดราคา` });

  if (staleToken(req, res, state, MODEL_CONFLICT)) return;

  const eb = await editorBook(book);
  let next;
  try {
    next = applyModelEdit(current, req.body, eb);
  } catch (e) {
    if (e instanceof EditRejected) return res.status(400).json({ error: e.message });
    throw e;
  }

  const at = nowIso();
  // `version` ไม่ขยับ — แก้ทีละรุ่นไม่ใช่เล่มใหม่ (พฤติกรรมเดิมของยุคไฟล์) · เขียนแค่รุ่นนี้แถวเดียว
  let revision: number;
  try {
    revision = await commitBookChange({
      parent: state.revision,
      kind: 'model',
      next: {
        ...book,
        models: { ...book.models, [code]: next },
        edited: {
          at,
          by: req.admin?.username,
          note: typeof req.body?.note === 'string' && req.body.note.trim()
            ? `แก้ ${code}: ${req.body.note.trim().slice(0, 200)}`
            : `แก้ราคารุ่น ${code} จากหน้าจอ`,
        },
      },
      changed: [code],
      by: req.admin?.username ?? null,
    });
  } catch (e) {
    if (e instanceof BookConflict) return res.status(409).json({ error: MODEL_CONFLICT });
    if (e instanceof BookRejected) return res.status(400).json({ error: e.message });
    throw e;
  }

  res.json({ ok: true, at, fingerprint: tokenOf(revision), model: modelEditorView(eb, next) });
});

/**
 * "สมุดรายชีต" — ทุกรุ่นที่มาจากชีต Excel เดียวกัน เปิด/บันทึกพร้อมกัน
 *
 * เจ้าของสั่ง 2026-09-24: **"1 ชีท / 1 สมุด"** และหน้าแก้ต้อง "ใกล้เคียง format เดิมใน excel มากที่สุด"
 * ชีต `TS-01+TS-01-0` มีสองตารางในหน้าเดียว (สองรุ่นในสมุด) ⇒ คนแก้ต้องเห็นทั้งสองตารางเรียงกัน
 * เหมือนในไฟล์ ไม่ใช่เปิดทีละรุ่น
 *
 * บันทึกทั้งชีตเป็น **การบันทึกครั้งเดียว** (ประวัติหนึ่งแถว · ย้อนทีเดียวกลับครบ) — ถ้ายิง
 * `PUT /model/:code` ทีละรุ่น รุ่นที่สองจะชนด่าน `fingerprint` ของรุ่นแรกเสมอ และถ้าพังกลางทาง
 * ชีตจะค้างครึ่งเดียว
 * ใช้ `applyModelEdit` ตัวเดียวกับหน้าแก้ทีละรุ่น (ผ่าน `applySheetEdit`) — ด่านตรวจค่าจึงมีชุดเดียว
 */

pricebookRouter.get('/sheet/:sheet', async (req: AdminRequest, res: Response) => {
  const state = await loadBookState();
  if (!state) return noBook(res);
  const sheet = String(req.params.sheet ?? '');
  const models = sheetModels(state.book, sheet);
  if (models.length === 0) return res.status(404).json({ error: `ไม่มีชีต ${sheet} ในสมุดราคา` });
  const eb = await editorBook(state.book);
  res.json({
    sheet,
    models: models.map((m) => modelEditorView(eb, m)),
    fingerprint: state.token,
    version: state.book.version,
  });
});

pricebookRouter.put('/sheet/:sheet', async (req: AdminRequest, res: Response) => {
  const state = await loadBookState();
  if (!state) return noBook(res);
  const { book } = state;
  const sheet = String(req.params.sheet ?? '');
  if (sheetModels(book, sheet).length === 0) return res.status(404).json({ error: `ไม่มีชีต ${sheet} ในสมุดราคา` });

  if (staleToken(req, res, state, MODEL_CONFLICT)) return;

  const eb = await editorBook(book);
  let nextModels: PriceBook['models'];
  let changed: string[];
  try {
    ({ models: nextModels, changed } = applySheetEdit(eb, sheet, req.body?.models));
  } catch (e) {
    if (e instanceof EditRejected) return res.status(400).json({ error: e.message });
    throw e;
  }
  if (changed.length === 0) return res.status(400).json({ error: 'ไม่มีราคาไหนเปลี่ยน — ไม่ได้บันทึก' });

  const at = nowIso();
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 200) : '';
  let revision: number;
  try {
    revision = await commitBookChange({
      parent: state.revision,
      kind: 'model',
      next: {
        ...book,
        models: nextModels,
        edited: { at, by: req.admin?.username, note: note ? `แก้ชีต ${sheet}: ${note}` : `แก้ราคาชีต ${sheet} จากหน้าจอ` },
      },
      changed,
      by: req.admin?.username ?? null,
    });
  } catch (e) {
    if (e instanceof BookConflict) return res.status(409).json({ error: MODEL_CONFLICT });
    if (e instanceof BookRejected) return res.status(400).json({ error: e.message });
    throw e;
  }

  const saved = { ...eb, models: nextModels };
  res.json({
    ok: true,
    at,
    changed,
    fingerprint: tokenOf(revision),
    models: sheetModels(saved, sheet).map((m) => modelEditorView(saved, m)),
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

pricebookRouter.get('/subcodes', async (_req: AdminRequest, res: Response) => {
  res.json({ rows: await listSubCodes() });
});

pricebookRouter.post('/subcodes', async (req: AdminRequest, res: Response) => {
  const row = await upsertSubCode(req.body, req.admin?.username ?? '');
  if (!row) return res.status(400).json({ error: 'กรอกไม่ครบ — ต้องมีรหัสย่อย ผลกับราคา และค่าของผลนั้น' });
  res.json({ row });
});

pricebookRouter.put('/subcodes/:id', async (req: AdminRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });
  const row = await updateSubCode(id, req.body, req.admin?.username ?? '');
  if (!row) return res.status(400).json({ error: 'กรอกไม่ครบ หรือไม่พบแถวนี้แล้ว' });
  res.json({ row });
});

pricebookRouter.delete('/subcodes/:id', async (req: AdminRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });
  const ok = await deleteSubCode(id);
  if (!ok) return res.status(404).json({ error: 'ไม่พบแถวนี้แล้ว' });
  res.json({ ok: true });
});
