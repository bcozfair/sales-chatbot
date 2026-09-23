// ─────────────────────────────────────────────────────────────────────────────
//  P4 — เปิดบัญชี Admin Portal ให้พนักงานขาย 29 คน (role = 'salesperson')
//  แผน: docs/plan-role-permissions.md §14
//
//  รัน:  npm run create:salesperson-accounts               (dry-run — รายงานอย่างเดียว)
//        SEED_PASSWORD='…' npm run create:salesperson-accounts -- --apply
//
//  ⚠️ **รหัสผ่านตั้งต้นรับจาก env `SEED_PASSWORD` เท่านั้น ห้ามเขียนลงไฟล์นี้**
//     รีโปนี้เป็น public โดยตั้งใจ ⇒ อะไรที่ commit ลงมาคือของสาธารณะถาวร แม้จะลบทีหลัง
//     (ลบแล้วยังอยู่ใน git history และใน mirror ที่คนอื่นโคลนไปแล้ว)
//
//  ─── ทำไมตารางข้างล่างถึงตรึงไว้ ไม่ใช่จับคู่สดตอนรัน ────────────────────────
//  `admin_users.username` = รหัสพนักงาน ซึ่งต้นทางอยู่ที่ `primus_ot.employees`
//  (MongoDB ของอีกโปรเจค · อ่านอย่างเดียว) และ **จับคู่อัตโนมัติล้วนไม่ได้** — ชื่อบนใบ
//  กับทะเบียนพนักงานสะกดนามสกุลต่างกันจริง 4 คน (§14.3 ข้อ 5: จูฑะพันธ์/จูฑะพันธุ์ ·
//  คำสุข/คำสุก · กิมะพันธ์/กิมิพันธ์ · เกตมุติ/เกษมุติ) ซึ่งเจ้าของเป็นคนยืนยันเองว่าเป็นคนเดียวกัน
//  ⇒ ผลการจับคู่ที่คนเคาะแล้วต้องถูกตรึงไว้ ไม่ใช่ให้ fuzzy matching ตัดสินใหม่ตอนเขียนฐาน
//  และ **`username` แก้ทีหลังไม่ได้ทั้งระบบ** (§14.1) ตั้งผิดต้องลบสร้างใหม่ ซึ่งทำให้
//  `admin_users.id` เปลี่ยน แล้ว `audit_logs` กับแถวพร็อกซี `web:<id>:…` ชี้ไปหาบัญชีที่ไม่มีแล้ว
//
//  ─── แต่ "รหัสเซลส์ของแต่ละคน" ไม่ตรึง ───────────────────────────────────────
//  ตารางเก็บแค่ `issuer` (ชื่อผู้จัดทำ) แล้วให้ `getSalespersonCodesByIssuerName()`
//  เป็นคนแปลงเป็นรหัส — **ฟังก์ชันเดียวกับที่หน้า "จัดการผู้ใช้งานระบบ" ใช้** ⇒ ผลจากสคริปต์
//  กับจากหน้าจอตรงกันเสมอ และคนที่ถือหลายรหัสได้ครบเองโดยไม่มีใครต้องจำ
//  (คุณวิรุณ = 441 + 688 — ผูกได้รหัสเดียวเมื่อไหร่ เขาจะมองไม่เห็นใบของตัวเอง §14.3 ข้อ 1)
//
//  ─── ใครไม่อยู่ในรายการนี้ ───────────────────────────────────────────────────
//  * คุณฉลองบุญ (เซลส์ 415 · PM00206) — เป็น `subadmin` อยู่แล้วและเจ้าของสั่งให้คงบัญชีเดิม (§14.3 ข้อ 3)
//  * คุณธัญสุดา (เซลส์ 428 · THT0103) — ชื่อบนใบ "สุทธิประภา" แต่ทะเบียน "คุ้มสา"
//    คนละนามสกุลเลย ไม่ใช่สะกดต่าง ⇒ เจ้าของสั่งพักไว้ (§14.3 ข้อ 4)
//  ⇒ 32 รหัสเซลส์ − 2 = 30 รหัส · 31 คน − 2 = **29 บัญชี**
//
//  ─── ปลอดภัยยังไง ──────────────────────────────────────────────────────────
//  * INSERT อย่างเดียว ไม่ UPDATE/DELETE แถวเดิมสักแถว
//  * ทั้ง 29 บัญชีอยู่ใน transaction เดียว — ผิดข้อเดียว rollback ทั้งชุด ไม่เหลือบัญชีครึ่ง ๆ
//  * idempotent: username ที่มีบัญชีแล้วถูกข้าม (รันซ้ำได้ ไม่สร้างซ้ำ)
//  * `employee_quotation_id` ปล่อย NULL **โดยตั้งใจ** ให้ตรงกับที่หน้าจอสร้าง —
//    บัญชี salesperson ไม่มีแนวคิด "ชื่อผู้จัดทำของตัวเอง" (services/webIdentity.ts
//    คืน null เสมอสำหรับ role นี้ แม้ช่องจะมีค่า) ช่อง J ของใบก๊อปจาก `salesperson` ของเซลส์เอง
// ─────────────────────────────────────────────────────────────────────────────
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../config/db.js';
import { getSalespersonCodesByIssuerName, replaceAdminSalespersonIds } from '../db/repositories.js';

/** ต้องตรงกับ `BCRYPT_COST` ใน index.ts ไม่งั้นบัญชีชุดนี้จะแข็งแรงคนละระดับกับที่สร้างจากหน้าจอ */
const BCRYPT_COST = 10;
/** ต้องตรงกับ `MIN_PASSWORD_LENGTH` ใน index.ts — ด่านเดียวกับที่หน้าจอใช้ */
const MIN_PASSWORD_LENGTH = 8;

/**
 * `username` = รหัสพนักงานจาก `primus_ot.employees.code`
 * `name`     = ชื่อในทะเบียนพนักงาน **ตัดคำนำหน้าออก** (ตรงกับที่ 10 บัญชี subadmin ใช้อยู่ ครบ 10/10)
 * `issuer`   = `salesperson.employee_quotation_id` **ตรงตัวทุกอักขระ** รวมช่องว่างซ้ำกลางชื่อ
 *              ⚠️ ห้าม normalize ช่องว่างในนี้ — มันคือคีย์ที่ใช้เทียบกับของจริงในฐาน
 */
const ACCOUNTS: ReadonlyArray<{ username: string; name: string; issuer: string }> = [
  { username: "PM00017", name: "ดุลยภาพ ขันคำ", issuer: "ดุลยภาพ ขันคำ" },  // เซลส์ 430
  { username: "PM00018", name: "อุดมพร อยู่แสง", issuer: "อุดมพร อยู่แสง" },  // เซลส์ 608
  { username: "PM00028", name: "กิตติศักดิ์ เอี่ยวอ่องพันธ์", issuer: "กิตติศักดิ์ เอี่ยวอ่องพันธ์" },  // เซลส์ 420
  { username: "PM00030", name: "ธีรยุทธ ทับทิมดง", issuer: "ธีรยุทธ  ทับทิมดง" },  // เซลส์ 451
  { username: "PM00041", name: "อาณัฐชัย ทองพรม", issuer: "อาณัฐชัย ทองพรม" },  // เซลส์ 440
  { username: "PM00092", name: "บัณฑิต บุษบงค์", issuer: "บัณฑิต บุษบงค์" },  // เซลส์ 414
  { username: "PM00207", name: "ทนงศักดิ์ จัดเขตรกรรม", issuer: "ทนงศักดิ์ จัดเขตรกรรม" },  // เซลส์ 438
  { username: "THT0002", name: "คัมภีร์ แก้วบัลลัง", issuer: "คัมภีร์ แก้วบัลลัง" },  // เซลส์ 431
  { username: "THT0005", name: "กวินภพ เขียววงษ์", issuer: "กวินภพ เขียววงษ์" },  // เซลส์ 434
  { username: "THT0007", name: "นิติพนธิ์ มณีรุ่ง", issuer: "นิติพนธิ์ มณีรุ่ง" },  // เซลส์ 426
  { username: "THT0011", name: "สถาพร รัตนประเสริฐ", issuer: "สถาพร  รัตนประเสริฐ" },  // เซลส์ 421
  { username: "THT0013", name: "พิทักษ์ชัย พิทักษ์สุวรา", issuer: "พิทักษ์ชัย พิทักษ์สุวรา" },  // เซลส์ 423
  { username: "THT0014", name: "นฤเบศร์ สุขสุถ้อย", issuer: "นฤเบศร์ สุขสุถ้อย" },  // เซลส์ 435
  { username: "THT0015", name: "วิรุณ ผ่านจังหาร", issuer: "วิรุณ ผ่านจังหาร" },  // เซลส์ 441 + 688
  { username: "THT0054", name: "นิภาภรณ์ แสงวงค์", issuer: "นิภาภรณ์ แสงวงค์" },  // เซลส์ 410
  { username: "THT0055", name: "สมพงษ์ ทรัพย์ประเสริฐ", issuer: "สมพงษ์ ทรัพย์ประเสริฐ" },  // เซลส์ 449
  { username: "THT0060", name: "อิทธิพล จูฑะพันธุ์", issuer: "อิทธิพล จูฑะพันธ์" },  // เซลส์ 442
  { username: "THT0064", name: "อรัญญา จำรัสฉาย", issuer: "อรัญญา จำรัสฉาย" },  // เซลส์ 433
  { username: "THT0069", name: "จิรายุ เกตุสุวรรณ์", issuer: "จิรายุ  เกตุสุวรรณ์" },  // เซลส์ 422
  { username: "THT0075", name: "นัฐดนัย บำรุงรักษ์", issuer: "นัฐดนัย  บำรุงรักษ์" },  // เซลส์ 432
  { username: "THT0080", name: "นพดล คำสุก", issuer: "นพดล คำสุข" },  // เซลส์ 443
  { username: "THT0081", name: "วิรัช กิมิพันธ์", issuer: "วิรัช กิมะพันธ์" },  // เซลส์ 447
  { username: "THT0088", name: "ภานุพัฒน์ เกษมุติ", issuer: "ภานุพัฒน์ เกตมุติ" },  // เซลส์ 427
  { username: "THT0090", name: "วีรศักดิ์ ทองหมู่", issuer: "วีรศักดิ์ ทองหมู่" },  // เซลส์ 453
  { username: "THT0092", name: "ภาณุวัฒน์ สงวนดิษ", issuer: "ภาณุวัฒน์ สงวนดิษ" },  // เซลส์ 455
  { username: "THT0095", name: "เดชา แดงอ่อน", issuer: "เดชา แดงอ่อน" },  // เซลส์ 424
  { username: "THT0097", name: "พสธร บูลวิบูรณ์", issuer: "พสธร  บูลวิบูรณ์" },  // เซลส์ 444
  { username: "THT0099", name: "อดิศร มาตรพันธ์นา", issuer: "อดิศร มาตรพันธ์นา" },  // เซลส์ 417
  { username: "THT0114", name: "ปภาวินท์ ภิรมย์ชลทรัพย์", issuer: "ปภาวินท์ ภิรมย์ชลทรัพย์" },  // เซลส์ 690
];

function fail(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const password = process.env.SEED_PASSWORD ?? '';

  console.log(`\n=== P4 · เปิดบัญชีพนักงานขาย ${ACCOUNTS.length} คน ===`);
  console.log(apply ? '   โหมด: เขียนจริง (--apply)' : '   โหมด: dry-run (ไม่เขียนอะไรทั้งนั้น)');

  // ── ด่าน 1: รหัสผ่าน ──────────────────────────────────────────────────────
  if (apply && password.length < MIN_PASSWORD_LENGTH) {
    fail(`ต้องส่งรหัสผ่านตั้งต้นทาง env SEED_PASSWORD และต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`);
  }

  // ── ด่าน 2: ตารางต้องไม่มี username ซ้ำกันเอง ──────────────────────────────
  const dup = ACCOUNTS.map(a => a.username).filter((u, i, arr) => arr.indexOf(u) !== i);
  if (dup.length) fail(`ตารางในสคริปต์มี username ซ้ำ: ${[...new Set(dup)].join(', ')}`);

  // ── ด่าน 3: ชื่อผู้จัดทำทุกชื่อต้องแปลงเป็นรหัสเซลส์ได้ ─────────────────────
  //    แปลงจากฐานจริงด้วยฟังก์ชันเดียวกับหน้าจอ — ชื่อไหนหาไม่เจอแปลว่าตารางกับฐานไม่ตรงกันแล้ว
  //    (เซลส์ถูกปิด / เปลี่ยนชื่อ) ⇒ หยุดทั้งชุด ดีกว่าสร้างบัญชีที่มองไม่เห็นใบของตัวเอง
  const codeMap = await getSalespersonCodesByIssuerName();
  const resolved = ACCOUNTS.map(a => ({ ...a, codes: codeMap.get(a.issuer) ?? [] }));
  const missing = resolved.filter(r => r.codes.length === 0);
  if (missing.length) {
    fail(`หารหัสเซลส์ไม่เจอ ${missing.length} คน — ตารางกับฐานไม่ตรงกันแล้ว:\n` +
      missing.map(m => `   ${m.username}  ชื่อผู้จัดทำ ${JSON.stringify(m.issuer)}`).join('\n'));
  }

  // ── ด่าน 4: username ที่มีบัญชีแล้ว ────────────────────────────────────────
  const { rows: existing } = await pool.query(
    `SELECT username, role FROM admin_users WHERE username = ANY($1::varchar[])`,
    [ACCOUNTS.map(a => a.username)]
  );
  const taken = new Map<string, string>(existing.map((r: any) => [String(r.username), String(r.role)]));
  const todo = resolved.filter(r => !taken.has(r.username));

  // ── รายงาน ────────────────────────────────────────────────────────────────
  console.log(`\n   รหัสเซลส์ที่จะครอบคลุม: ${resolved.reduce((n, r) => n + r.codes.length, 0)} รหัส`);
  for (const r of resolved) {
    const mark = taken.has(r.username) ? `ข้าม (มีบัญชีแล้ว role=${taken.get(r.username)})` : 'สร้าง';
    console.log(`   ${r.username.padEnd(9)} ${r.name.padEnd(26)} เซลส์ ${r.codes.join(' + ').padEnd(12)} ${mark}`);
  }
  console.log(`\n   สร้าง ${todo.length} บัญชี · ข้าม ${resolved.length - todo.length} บัญชี`);

  if (!apply) {
    console.log('\n   (dry-run — ใส่ --apply พร้อม SEED_PASSWORD เพื่อเขียนจริง)\n');
    return;
  }
  if (todo.length === 0) {
    console.log('\n   ไม่มีอะไรต้องสร้าง\n');
    return;
  }

  // ── เขียน ─────────────────────────────────────────────────────────────────
  // hash ทีละคนเพราะ bcrypt มี salt ของตัวเอง ⇒ hash เดียวกันใช้ซ้ำไม่ได้ และไม่ควรใช้ซ้ำด้วย
  const hashes = await Promise.all(todo.map(() => bcrypt.hash(password, BCRYPT_COST)));

  const created = await withTransaction(async (client) => {
    const out: Array<{ id: number; username: string; codes: string[] }> = [];
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      const { rows } = await client.query(
        `INSERT INTO admin_users (username, password_hash, name, role)
         VALUES ($1, $2, $3, 'salesperson')
         RETURNING id`,
        [r.username, hashes[i], r.name]
      );
      const id = Number(rows[0].id);
      await replaceAdminSalespersonIds(client, id, r.codes);
      out.push({ id, username: r.username, codes: r.codes });
    }
    return out;
  });

  console.log(`\n   ✅ สร้างแล้ว ${created.length} บัญชี`);
  for (const c of created) console.log(`   id=${String(c.id).padEnd(4)} ${c.username.padEnd(9)} เซลส์ ${c.codes.join(' + ')}`);
  console.log('\n   ⚠️ ทุกบัญชีใช้รหัสผ่านเดียวกัน — ให้ทุกคนเปลี่ยนรหัสผ่านของตัวเองทันทีที่เข้าครั้งแรก\n');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
