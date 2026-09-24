import { pool, type DbExecutor } from '../config/db.js';
import type { SubCode, SubCodeEffect } from '../services/pricingLab/types.js';

/**
 * คำสั่ง SQL ของโมดูล "คิดราคาสินค้า" — ตาราง `pricing_subcodes` ตารางเดียว
 *
 * ⚠️ ไฟล์ใหม่แยกจาก db/repositories.ts โดยเจตนา (เหตุผลเดียวกับ db/logRepositories.ts) —
 *   ไฟล์นั้นเป็นเส้นทางที่ระบบหลักใช้ทุกวินาที การไปแทรกโค้ดของโมดูลทดลองในนั้น
 *   คือความเสี่ยงที่ไม่มีใครได้อะไรกลับมา
 *   ถอนโมดูลออก = ลบไฟล์นี้ + db/pricingBookRepo.ts + routes/pricingLab.ts + services/pricingLab/
 *   + frontend/src/admin/pricingLab/ + 4 บรรทัดในไฟล์เดิม
 *   + `DROP TABLE pricing_subcodes, pricing_model_history, pricing_models, pricing_book_revisions`
 *
 * `import type` ของ SubCode เป็น type-only โดยตั้งใจ — ไม่มีโค้ดของ services/ ถูกรันจากไฟล์นี้
 * (กติกาเดียวกับที่ quotationService.ts ห้าม import config/capabilities.ts แบบ runtime)
 * ที่ไม่นิยาม type ซ้ำที่นี่ เพราะสองนิยามจะเริ่มต่างกันวันที่มีใครเพิ่มช่องข้างเดียว
 *
 * ทุกฟังก์ชันรับ `db` เป็นพารามิเตอร์ท้าย (ค่าเริ่มต้น `pool`) — เพื่อให้ด่าน `diag:pricing` รันใน
 * transaction แล้ว ROLLBACK ได้ แทนการเขียนตารางจริงแล้วลบทิ้ง (ซึ่งเคยจะลบค่า `-BU` ของแอดมินทิ้งด้วย)
 *
 * **รูปของแถวถูกตรวจที่ `clean()` ในไฟล์นี้ที่เดียว** ทั้งขาเข้าและขาออก — jsonb ยอมรับอะไรก็ได้
 * ⇒ ถ้าไม่ตรวจตอนอ่านด้วย แถวที่ใครแก้ด้วยมือใน psql จะไหลเข้า engine แล้วราคาเพี้ยนเงียบ ๆ
 */

/** แถวที่อ่านออกมาแล้ว — `id` มีไว้ให้หน้าจออ้างตอนแก้/ลบ (SubCode ตัวมันเองไม่มี id) */
export interface StoredSubCode extends SubCode {
  id: number;
}

const EFFECTS: SubCodeEffect[] = ['none', 'basePrice', 'flat', 'percent', 'perUnit', 'setAxis'];
const ROUNDS = ['ceil', 'floor', 'exact'];

const str = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s : undefined;
};
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * ตัดฟิลด์แปลกปลอมทิ้งและบังคับชนิด — คืน `null` ถ้าแถวนี้ใช้ไม่ได้
 *
 * ช่องที่ไม่เกี่ยวกับ effect นั้นถูกตัดทิ้งโดยตั้งใจ (เช่น `percent` ของแถว flat) เพราะค่าที่
 * ค้างอยู่จากการแก้ effect ไปมาบนหน้าจอ จะกลายเป็นค่าที่ไม่มีใครเห็นแต่ engine มองเห็น
 */
export function clean(raw: unknown): SubCode | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const subCode = str(r.subCode);
  const effect = str(r.effect) as SubCodeEffect | undefined;
  if (!subCode || !effect || !EFFECTS.includes(effect)) return null;

  const out: SubCode = {
    subCode,
    match: r.match === 'pattern' ? 'pattern' : 'exact',
    scope: str(r.scope) ?? '*',
    reads: str(r.reads) ?? '',
    effect,
  };

  const order = num(r.order);
  if (order !== undefined) out.order = order;

  if (effect === 'flat' || effect === 'basePrice') {
    const amount = num(r.amount);
    if (amount === undefined) return null;
    out.amount = amount;
  }
  if (effect === 'percent') {
    const percent = num(r.percent);
    if (percent === undefined) return null;
    out.percent = percent;
  }
  if (effect === 'perUnit') {
    const rate = num(r.rate);
    const dim = str(r.dim);
    if (rate === undefined || !dim) return null;
    out.rate = rate;
    out.dim = dim;
    const over = num(r.over); if (over !== undefined) out.over = over;
    const step = num(r.step); if (step !== undefined) out.step = step;
    const times = num(r.times); if (times !== undefined) out.times = times;
    const round = str(r.round);
    if (round && ROUNDS.includes(round)) out.round = round as SubCode['round'];
    const unit = str(r.unit); if (unit) out.unit = unit;
  }
  if (effect === 'setAxis') {
    const axis = str(r.axis);
    const value = str(r.value);
    if (!axis || !value) return null;
    out.axis = axis;
    out.value = value;
  }

  if (r.disabled === true) out.disabled = true;
  out.custom = true;               // ทุกแถวในตารางนี้คือของที่คนตั้งเอง ไม่ได้มาจากไฟล์ราคา
  const note = str(r.note); if (note) out.note = note;
  const by = str(r.by); if (by) out.by = by;
  const at = str(r.at); if (at) out.at = at;
  return out;
}

type Row = { id: number; data: unknown; created_by: string | null; updated_at: Date };

/** แถวที่ `clean()` ปฏิเสธจะถูกข้ามเงียบ ๆ — หน้าจอที่ขึ้น error ทั้งหน้าเพราะแถวเดียวเสีย แย่กว่า */
function toStored(rows: Row[]): StoredSubCode[] {
  const out: StoredSubCode[] = [];
  for (const row of rows) {
    const sc = clean(row.data);
    if (!sc) continue;
    if (!sc.by && row.created_by) sc.by = row.created_by;
    if (!sc.at) sc.at = row.updated_at.toISOString().slice(0, 10);
    out.push({ ...sc, id: row.id });
  }
  return out;
}

export async function listSubCodes(db: DbExecutor = pool): Promise<StoredSubCode[]> {
  const { rows } = await db.query<Row>(
    `SELECT id, data, created_by, updated_at FROM pricing_subcodes ORDER BY sub_code, scope`
  );
  return toStored(rows);
}

/**
 * ตั้งซ้ำที่ (รหัสย่อย, ขอบเขต) เดิม = แก้ของเดิม ไม่ใช่เพิ่มแถวที่สอง
 *
 * เหตุผลอยู่ที่ unique index: สองแถวที่ขอบเขตเท่ากัน ลำดับการค้นใน subcodes.ts เลือกตัวไหนก็ได้
 * ⇒ ราคาจะเปลี่ยนไปมาโดยไม่มีใครแก้อะไร ซึ่งเป็นบั๊กที่ไล่ไม่เจอ
 */
export async function upsertSubCode(input: unknown, username: string, db: DbExecutor = pool): Promise<StoredSubCode | null> {
  const sc = clean(input);
  if (!sc) return null;
  sc.by = username;
  sc.at = new Date().toISOString().slice(0, 10);
  const { rows } = await db.query<Row>(
    `INSERT INTO pricing_subcodes (data, created_by)
          VALUES ($1::jsonb, $2)
     ON CONFLICT (sub_code, scope)
     DO UPDATE SET data = EXCLUDED.data, updated_at = now()
       RETURNING id, data, created_by, updated_at`,
    [JSON.stringify(sc), username]
  );
  return toStored(rows)[0] ?? null;
}

export async function updateSubCode(
  id: number, input: unknown, username: string, db: DbExecutor = pool,
): Promise<StoredSubCode | null> {
  const sc = clean(input);
  if (!sc) return null;
  sc.by = username;
  sc.at = new Date().toISOString().slice(0, 10);
  const { rows } = await db.query<Row>(
    `UPDATE pricing_subcodes SET data = $2::jsonb, updated_at = now()
      WHERE id = $1
      RETURNING id, data, created_by, updated_at`,
    [id, JSON.stringify(sc)]
  );
  return toStored(rows)[0] ?? null;
}

export async function deleteSubCode(id: number, db: DbExecutor = pool): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM pricing_subcodes WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * รหัสสินค้าทุกตัวที่ขึ้นต้นด้วยตระกูลที่สมุดราคารู้จัก — หน้า "สมุดราคา" ใช้นับว่าแต่ละรุ่นครอบสินค้ากี่รายการ
 *
 * กรองหยาบที่ฐานด้วยสองตัวอักษรแรก (22,297 จาก ~51k แถว · วัด 2026-09-23 ใช้ 70 ms) ส่วนการตัดสินว่า
 * ตกรุ่นไหนทำที่ `modelOfCode` ตัวเดียวกับตัวคิดราคา — ไม่เขียนกติกาชุดที่สองเป็น SQL
 */
export async function listCatalogCodes(db: DbExecutor = pool): Promise<string[]> {
  const { rows } = await db.query<{ model: string }>(
    `SELECT model FROM products WHERE model ~* '^\\s*(TS|BH)'`
  );
  return rows.map((r) => r.model);
}
