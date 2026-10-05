/**
 * "แถวไหนในบันทึกการแก้ไขคือการแก้ข้อมูลจริง" — ฝั่ง SQL ของกติกาเดียวกับ `isRealChange()`
 * ใน `frontend/src/admin/logs/auditMeaning.ts` (หัวไฟล์นั้นเล่าที่มาเต็ม)
 *
 * ใช้ที่ตัวนับ `traffic_daily.audit_changes` ("การแก้ไข" ในหน้ารายงานการใช้งาน) — เจ้าของเคาะ
 * 2026-10-05 ให้นับเฉพาะการแก้จริง เพราะเดิมนับทุกแถวรวมการเข้าดู log (30 วันล่าสุด 304 จาก 1,149)
 *
 * ไม่ใช่การแก้จริง:
 *   · `log.view` — การเปิดดูหน้า log (เก็บเพราะข้อบังคับเรื่องตรวจสอบการเข้าถึง)
 *   · แถวพร็อกซีของหน้าเว็บ `salesperson.user_id = 'web:…'` (services/webIdentity.ts)
 *   · บอทสลับ `salesperson.status` ระหว่าง active ↔ edit_quote_number (กดเมนูแก้ใบ / จบขั้นตอน)
 *
 * ⚠️ แก้ที่นี่ต้องแก้ `isRealChange()` ด้วย — `npm run diag:audit-wording` ไล่แถวจริงทั้งตารางเทียบสองฝั่ง
 * · ไม่แตะ `audit_digest` (ลายนิ้วมือกันแก้ log ยังคิดจากทุกแถวเหมือนเดิม)
 *
 * ไฟล์นี้ไม่ import อะไรเลย ⇒ logworker และสคริปต์ใน scripts/diag/ ดึงไปใช้ได้โดยไม่ลาก pool มาด้วย
 */

/**
 * เงื่อนไข "เป็นการแก้จริง" — ต่อท้าย WHERE ด้วย `AND`
 * @param alias ชื่อตารางใน query (`'a'` → `a.action …`) · ไม่ส่ง = ไม่ใส่ alias
 * ค่าในเงื่อนไขเป็นค่าคงที่ของไฟล์นี้ ไม่ใช่ input ⇒ ต่อสตริงได้โดยไม่เปิดช่อง injection
 * COALESCE ครอบทั้งก้อน — คอลัมน์ว่าง (NULL) ต้องได้ "แก้จริง" ไม่ใช่หลุดจากการนับเงียบ ๆ
 */
export function realAuditChangeSql(alias?: string): string {
  const c = (col: string) => (alias ? `${alias}.${col}` : col);
  const cols = `array_remove(${c('changed_cols')}, 'updated_at')`;
  const flip = `('active', 'edit_quote_number')`;
  return `NOT COALESCE(
    ${c('action')} = 'log.view'
    OR (${c('entity_type')} = 'salesperson' AND left(${c('entity_id')}, 4) = 'web:')
    OR (${c('entity_type')} = 'salesperson' AND ${c('action')} = 'salesperson.update'
        AND ${cols} = ARRAY['status']::text[]
        AND ${c('"before"')}->>'status' IN ${flip}
        AND ${c('"after"')}->>'status' IN ${flip}),
    false)`;
}
