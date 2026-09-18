import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './jwt.js';
import { pool } from './db.js';
import { can, type Capability } from './capabilities.js';

/**
 * สิทธิ์ของผู้ใช้ Admin Portal — ตรงกับ CHECK constraint admin_users_role_check
 *   admin    = เข้าถึงและจัดการได้ทุกอย่าง รวมถึงจัดการผู้ใช้คนอื่น
 *   approver = ทำได้ทุกอย่างของ subadmin **บวก** อนุมัติราคาที่ต่ำกว่าขั้นต่ำ · อนุมัติใบที่ตัวเอง
 *              เป็นคนขอได้ และแก้จำนวน/ราคา/ส่วนลดในร่างที่รออนุมัติได้เอง
 *              (docs/plan-quote-price-approval.md §3.4 · §3.6)
 *   subadmin = ขอใบเสนอราคา + ประวัติใบเสนอราคา (ดู/กรอง/ส่งออก/ถอยเครื่องหมายส่งออก)
 *   salesperson = พนักงานขายที่ออกใบ/แก้ใบเองได้ แต่ทะลุกฎเองไม่ได้ · เห็นเฉพาะใบของรหัสตัวเอง
 *              · ส่งออกไฟล์ไม่ได้ · ตั้งเครดิตทับไม่ได้ (docs/plan-role-permissions.md)
 *   user     = สิทธิ์จำกัด เข้าได้เฉพาะเมนูที่เปิดให้ชัดเจน (ตอนนี้คือบัญชีห้ามเสนอราคา)
 * เพิ่ม role ใหม่ต้องแก้ทั้งที่นี่และ CHECK constraint ใน DB ให้ตรงกัน
 */
export type Role = 'admin' | 'approver' | 'subadmin' | 'salesperson' | 'user';

export interface AdminIdentity {
  id: number;
  username: string;
  name: string;
  role: Role;
}

export interface AdminRequest extends Request {
  admin?: AdminIdentity;
}

/**
 * ตรวจ JWT แล้วโหลดข้อมูลผู้ใช้สดจาก DB มาแปะไว้ที่ req.admin
 *
 * ที่ต้องอ่านจาก DB ทุกครั้งแทนการเชื่อ payload ใน token: token อายุ 24 ชม. และไม่มีระบบเพิกถอน
 * ถ้าเชื่อค่าใน token คนที่เพิ่งถูกลบหรือถูกลดสิทธิ์จาก admin เป็น user จะยังใช้สิทธิ์เดิมได้ต่ออีกถึง 24 ชม.
 * ซึ่งทำให้หน้าจัดการผู้ใช้กลายเป็นของหลอก — query นี้เป็น lookup ด้วย primary key ตัวเดียว ราคาถูกกว่าช่องโหว่นั้นมาก
 */
export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Unauthorized: Token format is Bearer <token>' });
  }

  const token = parts[1];

  jwt.verify(token, getJwtSecret(), async (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }

    const payloadId = (decoded as jwt.JwtPayload | undefined)?.id;
    if (typeof payloadId !== 'number') {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }

    try {
      const result = await pool.query(
        'SELECT id, username, name, role FROM admin_users WHERE id = $1',
        [payloadId]
      );

      // ไม่เจอ = ผู้ใช้ถูกลบไปหลัง token ถูกออก → ตัดสิทธิ์ทันที ไม่รอ token หมดอายุ
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Unauthorized: User no longer exists' });
      }

      (req as AdminRequest).admin = result.rows[0] as AdminIdentity;
      next();
    } catch (dbErr) {
      console.error('adminAuthMiddleware DB error:', dbErr);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
}

/**
 * จำกัดให้เฉพาะ role ที่ระบุเท่านั้นผ่านได้ — ต้องวางต่อจาก adminAuthMiddleware เสมอ
 * (อ่าน req.admin ที่ตัวนั้นเซ็ตไว้ ถ้าวางเดี่ยว ๆ จะตอบ 401 ทุกครั้ง)
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const admin = (req as AdminRequest).admin;
    if (!admin) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    if (!roles.includes(admin.role)) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' });
    }

    next();
  };
}

/**
 * จำกัดด้วย "ความสามารถ" แทนรายชื่อ role — ต้องวางต่อจาก adminAuthMiddleware เหมือน requireRole
 *
 * ต่างจาก `requireRole(...)` ตรงที่คำตอบมาจากตาราง `role_permissions` ซึ่งเจ้าของแก้ได้จากหน้าจอ
 * ⇒ route ที่เปลี่ยนมาใช้ตัวนี้จะเปลี่ยนพฤติกรรมตามค่าที่ตั้งไว้ทันที โดยไม่ต้อง deploy ใหม่
 * ตารางว่าง = ค่าเริ่มต้นในแคตตาล็อก ซึ่งถูกเขียนให้ตรงกับรายชื่อ role เดิมของ route นั้นเป๊ะ
 *
 * ⚠️ ใช้ได้เฉพาะความสามารถที่เป็น **สวิตช์** (quote.* / approval.* / users.*) เท่านั้น
 *    ความสามารถกลุ่ม `rule.*` มีโหมด `approval` ซึ่งแปลว่า "ทำได้ถ้ามีคนอนุมัติ" — ความหมายนั้น
 *    ไม่มีทางแสดงออกมาเป็น "ผ่าน/ไม่ผ่าน" ที่ประตู และการปลดกฎต้องผูกกับ *ใบ* ไม่ใช่ *endpoint*
 *    (ถ้าย้ายไปไว้ที่ประตู ใบที่ออกจาก LINE จะเปลี่ยนพฤติกรรมตามไปเงียบ ๆ — CLAUDE.md)
 */
export function requireCapability(capability: Capability) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const admin = (req as AdminRequest).admin;
    if (!admin) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    try {
      if (!(await can(admin.role, capability))) {
        return res.status(403).json({ error: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' });
      }
      next();
    } catch (err) {
      // อ่านตารางสิทธิ์ไม่ได้ = ตอบไม่ได้ว่าคนนี้ทำได้ไหม ⇒ ปฏิเสธ ไม่ใช่ปล่อยผ่าน
      console.error('requireCapability error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}
