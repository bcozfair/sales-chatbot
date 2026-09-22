// ─────────────────────────────────────────────────────────────────────────────
//  salespersonPicker — ยุบเซลส์ที่ "ชื่อ/รหัสซ้ำกัน" ให้เหลือคนละ 1 ตัวเลือก
//  ใช้ที่เดียว: dropdown "ออกใบในนาม (พนักงานขาย)" ของหน้าเว็บขอใบเสนอราคา
//  แผน: docs/plan-web-quote-request.md §2 (ตัวตนของใบที่ออกจากเว็บ)
//
//  ทำไมเป็นไฟล์แยก ไม่ไปแก้ listActingSalespersons() ใน webIdentity.ts:
//     listActingSalespersons() คือ "แถวดิบใน salesperson ที่ออกใบในนามได้" — เป็นคำตอบของ
//     คำถามเรื่อง *สิทธิ์* (active · ไม่ใช่แถวพร็อกซี) และมีด่าน diag:pdf-issuer เคส 7 ยืนกันอยู่
//     ส่วนการยุบซ้ำเป็นคำถามเรื่อง *ความสะดวกของ dropdown* ซึ่งเกณฑ์จะถูกขอแก้เรื่อย ๆ
//     ⇒ แยกไฟล์ไว้ ถอดทิ้ง/เปลี่ยนเกณฑ์ได้โดยไม่แตะโค้ดตัวตนเลยแม้แต่บรรทัดเดียว
//
//  ⚠️ ไม่แก้ข้อมูลใน DB สักแถว — ไม่ merge ไม่ลบ ไม่ตั้ง status
//     แถวที่ถูกซ่อนยังออกใบได้ทางเดิม (LINE) เหมือนเดิมทุกอย่าง · นี่เป็นแค่ชั้นแสดงผล
//     (ถ้าลบแถวร้างทิ้ง ใบเสนอราคาเก่าที่ผูกกับ user_id นั้นจะหาเจ้าของไม่ได้)
// ─────────────────────────────────────────────────────────────────────────────
import { pool, type DbExecutor } from '../config/db.js';
import type { ActingSalesperson } from './webIdentity.js';
import { saleSignatureUrl } from './webIdentity.js';
import { getAdminSalespersonIds } from '../db/repositories.js';

export interface PickedSalesperson extends ActingSalesperson {
  /** จำนวนแถวซ้ำที่ถูกยุบเข้าแถวนี้ (0 = ไม่มีซ้ำ) */
  merged_count: number;
  /** user_id ของแถวที่ถูกซ่อน — ไว้ไล่ที่มาเวลาสงสัยว่าทำไมบัญชีหนึ่งหายจาก dropdown */
  merged_user_ids: string[];
  /** ใช้งานล่าสุดเมื่อไหร่ (ISO · null = ไม่เคยเลย) — เกณฑ์ที่เลือกแถวตัวแทน */
  last_active_at: string | null;
}

/** สัญญาณว่าแถวไหน "ยังใช้งานอยู่จริง" — อ่านอย่างเดียว ไม่เขียนอะไร */
export interface SalespersonActivity {
  user_id: string;
  /** เวลาที่มีความเคลื่อนไหวล่าสุด (ใบเสนอราคา · ข้อความ · การแก้แถว) */
  last_active_at: Date | null;
  quote_count: number;
}

/**
 * กุญแจของ "คนเดียวกัน"
 *
 * รหัสพนักงานมาก่อนชื่อ เพราะรหัสคือตัวตนจริงฝั่ง Odoo (ช่อง H ของไฟล์นำเข้า) ส่วนชื่อเป็น
 * ข้อความที่พิมพ์เองได้ · ถ้ายังไม่มีรหัสจึงค่อยถอยไปใช้ชื่อ
 *
 * **จงใจไม่ยุบ "ชื่อเดียวกันแต่รหัสต่างกัน"** — นั่นคือคนละคนที่ชื่อเล่นพ้องกัน ถ้ายุบจะมีคน
 * หนึ่งเลือกไม่ได้เลยตลอดกาล · กรณีนั้น dropdown แยกให้เห็นด้วยรหัสในวงเล็บอยู่แล้ว
 *
 * normalize เฉพาะการเทียบ (trim + ยุบช่องว่างซ้อน) **ไม่ได้เขียนทับค่าที่เก็บไว้** — ต่างจาก
 * กฎห้าม trim ชื่อลูกค้าก่อนส่ง Odoo ซึ่งพูดถึงค่าที่ *ส่งออก* ไม่ใช่กุญแจที่ใช้จับกลุ่มในหน่วยความจำ
 */
function groupKey(sp: ActingSalesperson): string {
  const code = (sp.salesperson_id ?? '').trim();
  if (code !== '') return `code:${code}`;
  return `name:${(sp.name ?? '').trim().replace(/\s+/g, ' ')}`;
}

/** วันเวลาที่มากกว่า (null = ไม่มี) */
function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * อ่านสัญญาณการใช้งานของ user_id ที่ระบุ — **เรียกเฉพาะแถวที่ซ้ำ** ไม่ใช่ทั้งตาราง
 *
 * ทั้งสอง subquery วิ่งบน index ที่มีอยู่แล้ว (`quotations(user_id)` · `messages(user_id, created_at)`)
 * และจำนวน user_id ที่ส่งเข้ามาคือ "เฉพาะคนที่มีบัญชีซ้ำ" ⇒ ไม่มีซ้ำเลย = ไม่ยิง query นี้เลย
 */
export async function loadSalespersonActivity(
  userIds: string[],
  db: DbExecutor = pool
): Promise<Map<string, SalespersonActivity>> {
  const out = new Map<string, SalespersonActivity>();
  if (userIds.length === 0) return out;

  const { rows } = await db.query(
    `SELECT s.user_id,
            s.updated_at,
            s.created_at,
            (SELECT max(q.created_at) FROM quotations q WHERE q.user_id = s.user_id) AS last_quote,
            (SELECT count(*)::int    FROM quotations q WHERE q.user_id = s.user_id) AS quote_count,
            (SELECT max(m.created_at) FROM messages   m WHERE m.user_id = s.user_id) AS last_message
       FROM salesperson s
      WHERE s.user_id = ANY($1::text[])`,
    [userIds]
  );

  for (const r of rows) {
    out.set(String(r.user_id), {
      user_id: String(r.user_id),
      // updated_at/created_at เป็นตัวสำรองท้ายสุด — แถวที่ไม่เคยออกใบและไม่เคยคุยเลย
      // ยังต้องเทียบกันได้ ไม่ใช่เสมอกันแล้วสุ่มผู้ชนะ
      last_active_at: laterOf(
        laterOf(r.last_quote ?? null, r.last_message ?? null),
        laterOf(r.updated_at ?? null, r.created_at ?? null)
      ),
      quote_count: Number(r.quote_count ?? 0),
    });
  }
  return out;
}

/**
 * เลือกแถวตัวแทนของแต่ละกลุ่ม — ฟังก์ชันบริสุทธิ์ ไม่แตะ DB (ด่านจึงทดสอบได้ตรง ๆ)
 *
 * เกณฑ์เรียงตามลำดับ:
 *   1. ใช้งานล่าสุดใหม่กว่า — สัญญาณที่ตรงที่สุดว่า "บัญชีนี้คือบัญชีที่เขาใช้อยู่"
 *   2. ออกใบมากกว่า — กันเคสที่เวลาเท่ากันเพราะ import ชุดเดียวกัน
 *   3. มีลายเซ็น — ใบที่ออกจะสมบูรณ์กว่า
 *   4. user_id น้อยกว่า (เรียงตัวอักษร) — ตัวตัดสินสุดท้ายให้ผลนิ่งทุกครั้งที่เรียก
 *
 * ลำดับของผลลัพธ์ = ลำดับที่แถวตัวแทนโผล่มาใน `rows` (ซึ่งเรียงตามชื่อมาแล้วจาก SQL)
 * ⇒ dropdown ไม่กระโดดสลับตำแหน่งเวลาใครออกใบเพิ่ม
 */
export function pickRepresentatives(
  rows: ActingSalesperson[],
  activity: Map<string, SalespersonActivity>
): PickedSalesperson[] {
  const groups = new Map<string, ActingSalesperson[]>();
  for (const sp of rows) {
    const key = groupKey(sp);
    const bucket = groups.get(key);
    if (bucket) bucket.push(sp);
    else groups.set(key, [sp]);
  }

  const better = (a: ActingSalesperson, b: ActingSalesperson): number => {
    const ra = activity.get(a.user_id);
    const rb = activity.get(b.user_id);
    const ta = ra?.last_active_at ? ra.last_active_at.getTime() : -1;
    const tb = rb?.last_active_at ? rb.last_active_at.getTime() : -1;
    if (ta !== tb) return tb - ta;
    const qa = ra?.quote_count ?? 0;
    const qb = rb?.quote_count ?? 0;
    if (qa !== qb) return qb - qa;
    if (a.has_sale_sig !== b.has_sale_sig) return a.has_sale_sig ? -1 : 1;
    return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0;
  };

  const picked = new Map<string, PickedSalesperson>();
  for (const [key, bucket] of groups) {
    const sorted = [...bucket].sort(better);
    const win = sorted[0];
    const act = activity.get(win.user_id);
    picked.set(key, {
      ...win,
      merged_count: sorted.length - 1,
      merged_user_ids: sorted.slice(1).map((s) => s.user_id),
      last_active_at: act?.last_active_at ? act.last_active_at.toISOString() : null,
    });
  }

  // คืนตามลำดับเดิมของ rows โดยหยิบตัวแทนของกลุ่มมาแทนที่ตำแหน่งแรกที่กลุ่มนั้นปรากฏ
  const seen = new Set<string>();
  const out: PickedSalesperson[] = [];
  for (const sp of rows) {
    const key = groupKey(sp);
    if (seen.has(key)) continue;
    seen.add(key);
    const rep = picked.get(key);
    if (rep) out.push(rep);
  }
  return out;
}

/**
 * รายชื่อสำหรับ dropdown — ยุบซ้ำแล้ว
 *
 * ไม่มีซ้ำ = ไม่ยิง query เพิ่มเลย (คืนของเดิมห่อ field ว่าง) ⇒ ต้นทุนเป็นศูนย์ในกรณีปกติ
 */
export async function dedupeActingSalespersons(
  rows: ActingSalesperson[],
  db: DbExecutor = pool
): Promise<PickedSalesperson[]> {
  const counts = new Map<string, number>();
  for (const sp of rows) counts.set(groupKey(sp), (counts.get(groupKey(sp)) ?? 0) + 1);

  const dupUserIds = rows.filter((sp) => (counts.get(groupKey(sp)) ?? 0) > 1).map((sp) => sp.user_id);
  const activity = dupUserIds.length > 0 ? await loadSalespersonActivity(dupUserIds, db) : new Map();
  return pickRepresentatives(rows, activity);
}

/**
 * แถวเซลส์ "ตัวแทน" ของบัญชี role='salesperson' — ใช้ตอนเซลส์ล็อกอินเว็บออกใบของตัวเอง
 * (§13.2 · §13.7 ข้อ 6 ของ docs/plan-role-permissions.md)
 *
 * ต่างจาก `dedupeActingSalespersons()` ตรงที่บัญชีเดียวต้องได้คำตอบ **เดียว** เสมอ (ไม่มี dropdown
 * ให้เลือก) แม้บัญชีนั้นจะผูกไว้มากกว่าหนึ่งรหัส (เกิดขึ้นจริง — วัด 2026-09-18) ⇒ รวมทุกแถวของ
 * ทุกรหัสที่ผูกไว้เป็นกลุ่มเดียว แล้วเลือกด้วยเกณฑ์เดียวกับ `pickRepresentatives()`
 * (ใช้งานล่าสุด → ออกใบมากกว่า → มีลายเซ็น → user_id เรียงตัวอักษร)
 *
 * คืน `null` เมื่อบัญชีนี้ไม่ได้ผูกรหัสไว้เลย หรือรหัสที่ผูกไว้ไม่มีแถว `salesperson` ที่ active
 * (ทั้งสองเคสคือ "ยังไม่พร้อมออกใบ" ตาม §13.5 — ผู้เรียกใช้ผลนี้ตัดสินด่านความพร้อม)
 */
export async function pickOwnActingSalesperson(
  adminId: number,
  db: DbExecutor = pool
): Promise<PickedSalesperson | null> {
  const codes = await getAdminSalespersonIds(adminId);
  if (codes.length === 0) return null;

  const { rows } = await db.query(
    `SELECT user_id, name, salesperson_id, phone
       FROM salesperson
      WHERE status = 'active' AND user_id NOT LIKE 'web:%' AND salesperson_id = ANY($1::text[])
      ORDER BY name ASC`,
    [codes]
  );
  if (rows.length === 0) return null;

  const candidates: ActingSalesperson[] = rows.map((r: any) => {
    const sigUrl = saleSignatureUrl(r.salesperson_id);
    return {
      user_id: r.user_id,
      name: r.name,
      salesperson_id: r.salesperson_id ? String(r.salesperson_id) : null,
      phone: r.phone ?? null,
      has_sale_sig: sigUrl !== null,
      sig_url: sigUrl,
    };
  });

  const activity = await loadSalespersonActivity(candidates.map((c) => c.user_id), db);
  // ยุบเป็นกลุ่มเดียวเสมอ (ไม่ตามรหัส/ชื่อแบบ groupKey) — ใส่ทุกแถวเข้า pickRepresentatives()
  // ด้วย ActingSalesperson ที่ทำให้ groupKey เท่ากันหมด (ปลอม salesperson_id ให้ว่างแต่ชื่อเดียวกัน
  // ไม่ได้ เพราะชื่ออาจต่างกันจริงถ้าสองรหัสเป็นคนละสาขา) ⇒ เรียก pickRepresentatives ต่อคีย์เดียว
  // ด้วยการยัดทุกแถวเป็นกลุ่มเดียวกันตรง ๆ แทน
  const picked = pickRepresentatives(
    candidates.map((c) => ({ ...c, salesperson_id: '__own__', name: '__own__' })),
    activity
  );
  const winner = picked[0];
  if (!winner) return null;
  // คืนค่าจริงของแถวที่ชนะ (ไม่ใช่ชื่อ/รหัสปลอมที่ยัดเข้าไปเพื่อยุบกลุ่ม)
  const real = candidates.find((c) => c.user_id === winner.user_id);
  if (!real) return null;
  return { ...real, merged_count: candidates.length - 1, merged_user_ids: candidates.filter((c) => c.user_id !== real.user_id).map((c) => c.user_id), last_active_at: winner.last_active_at };
}
