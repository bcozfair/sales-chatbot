/**
 * ออก token ของแอดมินคนแรกที่เป็น superadmin — **เครื่อง dev เท่านั้น**
 *
 * มีไว้ให้ด่านที่ต้องเปิดหน้าแอดมินจริงด้วยเบราว์เซอร์ (puppeteer) ไม่ต้องรู้รหัสผ่านใคร
 * ⇒ ไม่มีอะไรใน `index.ts` เรียกไฟล์นี้ และมันไม่เคยถูก import จากโค้ดที่รันบน prod
 */
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { getJwtSecret } from '../../config/jwt.js';

const { rows } = await pool.query(
  `select id, username, name, role from admin_users
    order by case when role = 'superadmin' then 0 else 1 end, id
    limit 1`
);
const admin = rows[0];
if (!admin) {
  console.error('ไม่มีแอดมินที่เปิดใช้อยู่ในฐานนี้');
  process.exit(1);
}
console.log(jwt.sign(admin, getJwtSecret(), { expiresIn: '2h' }));
console.error(`(ใช้บัญชี ${admin.username} · role ${admin.role})`);
await pool.end();
