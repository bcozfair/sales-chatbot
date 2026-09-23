import { pool, type DbExecutor } from '../config/db.js';
import type { PriceBook, PriceModel, SubCode } from '../services/pricingLab/types.js';

/**
 * คำสั่ง SQL ของสมุดราคา — ตาราง `pricing_book_revisions` · `pricing_models` · `pricing_model_history`
 * (migration 2026-09-23_01 · แบบอยู่ที่ docs/plan-pricebook-db.md)
 *
 * แยกจาก db/repositories.ts ด้วยเหตุผลเดียวกับ `pricingLabRepo.ts` — ไฟล์นั้นเป็นเส้นทางที่ระบบหลัก
 * ใช้ทุกวินาที · ถอนโมดูลออก = ลบไฟล์นี้ด้วย + DROP สามตาราง
 *
 * **ทุกฟังก์ชันรับ `db` เป็นพารามิเตอร์ท้าย (ค่าเริ่มต้น `pool`)** เพราะการบันทึกหนึ่งครั้งเขียนสามตาราง
 * ใน transaction เดียว (`withTransaction` ส่ง client มา) และด่าน `diag:pricing-db` ต้องส่ง client
 * ของตัวเองที่ ROLLBACK ทิ้งท้ายเข้ามาได้ — ห้ามเรียก `pool.query` ตรง ๆ ในไฟล์นี้
 *
 * **ชื่อตารางไม่ใส่ `public.`** โดยตั้งใจ — ด่านสร้างตารางชั่วคราวชื่อเดียวกันมาบังของจริง
 * (`pg_temp` ถูกค้นก่อน) ใส่ `public.` เมื่อไหร่ ด่านจะเขียนตารางจริงแทน (ด่านข้อ 0 เฝ้าอยู่)
 *
 * **json ไม่ใช่ jsonb** — node-pg อ่าน json ด้วย `JSON.parse` ลำดับคีย์จึงเท่ากับตอนเขียนทุกตัว
 * ⇒ ขาเข้าต้องส่ง `JSON.stringify(...)` พร้อม `::json` เสมอ ห้ามปล่อยให้ driver แปลงเอง
 *
 * ⚠️ `pricing_model_history` **เขียนต่อท้ายอย่างเดียว** — ไฟล์นี้ไม่มี UPDATE/DELETE ของตารางนั้น
 *   และของ `pricing_book_revisions` และต้องไม่มีตลอดไป (ด่านข้อ 13 grep ทั้งรีโปให้)
 */

export type RevisionKind = 'seed' | 'import' | 'model' | 'restore';

export interface SourceFile {
  name: string;
  sha256: string;
  bytes: number;
}

export interface RevisionRow {
  id: number;
  parentId: number | null;
  kind: RevisionKind;
  restoredFrom: number | null;
  version: string;
  source: string;
  bookSubCodes: SubCode[];
  edited: PriceBook['edited'] | null;
  sourceFiles: SourceFile[] | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface ModelRow {
  code: string;
  position: number;
  /** ยังไม่ผ่านด่านรูป — ผู้เรียกต้องตรวจเอง (`checkPriceModel`) ก่อนป้อนเข้า engine */
  spec: unknown;
  schemaVersion: number;
}

type RawRevision = {
  id: string; parent_id: string | null; kind: RevisionKind; restored_from: string | null;
  version: string; source: string; book_subcodes: SubCode[] | null; edited: PriceBook['edited'] | null;
  source_files: SourceFile[] | null; created_by: string | null; created_at: Date;
};

// BIGINT มาเป็นสตริงจาก node-pg — แปลงเป็น number ได้ปลอดภัยเพราะเลขการบันทึกไม่มีวันเกิน 2^53
function toRevision(r: RawRevision): RevisionRow {
  return {
    id: Number(r.id),
    parentId: r.parent_id === null ? null : Number(r.parent_id),
    kind: r.kind,
    restoredFrom: r.restored_from === null ? null : Number(r.restored_from),
    version: r.version,
    source: r.source,
    bookSubCodes: Array.isArray(r.book_subcodes) ? r.book_subcodes : [],
    edited: r.edited ?? null,
    sourceFiles: r.source_files ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

const REVISION_COLS = `id, parent_id, kind, restored_from, version, source, book_subcodes, edited,
                       source_files, created_by, created_at`;

/** เลขการบันทึกล่าสุด — query เดียวที่วิ่งทุก request (อ่านจาก PK) · `null` = ยังไม่มีเล่มเลย */
export async function headRevisionId(db: DbExecutor = pool): Promise<number | null> {
  const { rows } = await db.query<{ id: string | null }>(`SELECT max(id) AS id FROM pricing_book_revisions`);
  return rows[0]?.id == null ? null : Number(rows[0].id);
}

export async function readHeadRevision(db: DbExecutor = pool): Promise<RevisionRow | null> {
  const { rows } = await db.query<RawRevision>(
    `SELECT ${REVISION_COLS} FROM pricing_book_revisions ORDER BY id DESC LIMIT 1`,
  );
  return rows[0] ? toRevision(rows[0]) : null;
}

export async function readRevision(id: number, db: DbExecutor = pool): Promise<RevisionRow | null> {
  const { rows } = await db.query<RawRevision>(
    `SELECT ${REVISION_COLS} FROM pricing_book_revisions WHERE id = $1`, [id],
  );
  return rows[0] ? toRevision(rows[0]) : null;
}

/** การบันทึกก่อนหัวเล่ม เรียงใหม่ไปเก่า — รายการ "ย้อนไปเล่มก่อนหน้า" บนจอ */
export async function listRevisionsBefore(headId: number, limit: number, db: DbExecutor = pool): Promise<RevisionRow[]> {
  const { rows } = await db.query<RawRevision>(
    `SELECT ${REVISION_COLS} FROM pricing_book_revisions WHERE id < $1 ORDER BY id DESC LIMIT $2`,
    [headId, limit],
  );
  return rows.map(toRevision);
}

type RawModel = { code: string; position: number; spec: unknown; schema_version: number };
const toModel = (r: RawModel): ModelRow => ({
  code: r.code, position: r.position, spec: r.spec, schemaVersion: r.schema_version,
});

/** รุ่นทั้งหมดของเล่มปัจจุบัน ตามลำดับในเล่ม · `forUpdate` = ล็อกแถวไว้ใน transaction ของการย้อน */
export async function readModels(db: DbExecutor = pool, opts: { forUpdate?: boolean } = {}): Promise<ModelRow[]> {
  const { rows } = await db.query<RawModel>(
    `SELECT code, position, spec, schema_version FROM pricing_models
      ORDER BY position, code${opts.forUpdate ? ' FOR UPDATE' : ''}`,
  );
  return rows.map(toModel);
}

/**
 * รุ่นทั้งหมด "ณ การบันทึกครั้งที่ R" จากประวัติ — ใช้ได้เพราะเล่มแรกเขียนประวัติครบทุกรุ่น
 * แถว `spec IS NULL` (รุ่นที่ถูกเอาออกก่อนถึง R) ถูกตัดทิ้งที่นี่
 */
export async function readModelsAt(revisionId: number, db: DbExecutor = pool): Promise<ModelRow[]> {
  const { rows } = await db.query<RawModel>(
    `SELECT code, position, spec, schema_version FROM (
       SELECT DISTINCT ON (code) code, position, spec, schema_version
         FROM pricing_model_history
        WHERE revision_id <= $1
        ORDER BY code, revision_id DESC
     ) s
     WHERE spec IS NOT NULL
     ORDER BY position, code`,
    [revisionId],
  );
  return rows.map(toModel);
}

export async function countModelsAt(revisionId: number, db: DbExecutor = pool): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM (
       SELECT DISTINCT ON (code) spec IS NOT NULL AS alive
         FROM pricing_model_history
        WHERE revision_id <= $1
        ORDER BY code, revision_id DESC
     ) s WHERE alive`,
    [revisionId],
  );
  return Number(rows[0]?.n ?? 0);
}

export interface NewRevision {
  parentId: number | null;
  kind: RevisionKind;
  restoredFrom?: number | null;
  version: string;
  source: string;
  bookSubCodes: SubCode[];
  edited: PriceBook['edited'] | null;
  sourceFiles?: SourceFile[] | null;
  createdBy?: string | null;
}

/** แถวหัวของการบันทึก — ชน `pricing_book_revisions_parent_key` = มีคนบันทึกจากเล่มเดียวกันไปก่อนแล้ว */
export async function insertRevision(r: NewRevision, db: DbExecutor = pool): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO pricing_book_revisions
       (parent_id, kind, restored_from, version, source, book_subcodes, edited, source_files, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::json, $7::json, $8::json, $9)
     RETURNING id`,
    [
      r.parentId, r.kind, r.restoredFrom ?? null, r.version, r.source,
      JSON.stringify(r.bookSubCodes ?? []),
      r.edited ? JSON.stringify(r.edited) : null,
      r.sourceFiles ? JSON.stringify(r.sourceFiles) : null,
      r.createdBy ?? null,
    ],
  );
  return Number(rows[0]!.id);
}

/** เขียนรุ่นหนึ่งลงเล่มปัจจุบัน — แทนทั้งก้อน (spec เป็นหน่วยเล็กที่สุดของการบันทึก) */
export async function upsertModel(
  m: { code: string; position: number; spec: PriceModel; schemaVersion?: number },
  revisionId: number,
  by: string | null,
  db: DbExecutor = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO pricing_models (code, position, spec, schema_version, revision_id, updated_by)
     VALUES ($1, $2, $3::json, $4, $5, $6)
     ON CONFLICT (code) DO UPDATE
       SET position = EXCLUDED.position, spec = EXCLUDED.spec, schema_version = EXCLUDED.schema_version,
           revision_id = EXCLUDED.revision_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [m.code, m.position, JSON.stringify(m.spec), m.schemaVersion ?? 1, revisionId, by],
  );
}

/** เอารุ่นออกจากเล่มปัจจุบัน — เกิดจากการย้อนหรือการนำเข้าแบบแทนทั้งเล่มเท่านั้น (ประวัติยังเก็บไว้) */
export async function deleteModel(code: string, db: DbExecutor = pool): Promise<void> {
  await db.query(`DELETE FROM pricing_models WHERE code = $1`, [code]);
}

/** แถวประวัติ — `spec: null` = รุ่นนี้ถูกเอาออกในการบันทึกครั้งนี้ */
export async function insertHistory(
  revisionId: number,
  m: { code: string; position: number | null; spec: PriceModel | null; schemaVersion?: number },
  db: DbExecutor = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO pricing_model_history (revision_id, code, position, spec, schema_version)
     VALUES ($1, $2, $3, $4::json, $5)`,
    [revisionId, m.code, m.position, m.spec === null ? null : JSON.stringify(m.spec), m.schemaVersion ?? 1],
  );
}
