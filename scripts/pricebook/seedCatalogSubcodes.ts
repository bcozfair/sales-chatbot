// ─────────────────────────────────────────────────────────────────────────────
//  รหัสย่อยจากแคตตาล็อก → ตารางรหัสย่อยในฐาน (`pricing_subcodes`)
//
//  เครื่องมือของสมุดราคา — ดู services/pricingLab/README.md · docs/pricing-code-ts-01.md
//
//    npx tsx scripts/pricebook/seedCatalogSubcodes.ts                       รายงานอย่างเดียว ไม่เขียนอะไร
//    … --apply --by <username>                                            เขียนแถวที่ยังไม่มี
//
//  **ทำไมเป็นแถวในตารางรหัสย่อย ไม่ใช่ตารางแปลในโค้ด** — ตัวอักษรหลัง M ของ TS_-01 / TS_-01-0
//  คือชนิดสาย + Ground ตามภาพ "การสั่งซื้อ" ที่เจ้าของส่งมา (2026-09-24) · แต่ละรุ่นมีไม่เท่ากัน
//  (ภาพ TS_-01-0 ไม่มี C/TS — เจ้าของสั่งเพิ่มให้ 2026-09-25 เพราะขายจริง) และร้านต้องแก้เองได้จากหน้าสมุดราคา ⇒ ที่อยู่ที่ถูกคือตารางเดียวกับที่
//  แอดมินกด "＋ เพิ่ม" (`services/pricingLab/bookUpdate.ts` ข้อ 3: ตารางนี้มีเจ้าของคือฐานข้อมูล)
//  ไฟล์ `catalog-subcodes.json` จึงเป็นแค่ "ค่าตั้งต้น" สำหรับฐานใหม่ / ฐานที่ยังไม่มี
//
//  **แถวที่มีอยู่แล้วแต่ค่าไม่ตรงกับไฟล์ = ข้าม ไม่เขียนทับ** — แปลว่ามีคนแก้จากหน้าจอหลังจากนี้
//  ค่าของคนชนะไฟล์เสมอ (เหตุผลเดียวกับ `withSubCodes`) · การเขียนเรียก `upsertSubCode`
//  ตัวเดียวกับหน้าจอ **ห้ามยิง SQL เองในไฟล์นี้**
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from '../../config/db.js';
import { clean, listSubCodes, upsertSubCode } from '../../db/pricingLabRepo.js';
import type { SubCode } from '../../services/pricingLab/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** ช่องที่มีผลกับการอ่านรหัส/ราคา — `by`/`at`/`id` เป็นของบันทึก ไม่ใช่ความหมาย */
const meaning = (sc: SubCode) => JSON.stringify([sc.match, sc.effect, sc.axis ?? null, sc.value ?? null, sc.reads, !!sc.disabled]);

export function loadCatalogSubcodes(file = join(HERE, 'catalog-subcodes.json')): SubCode[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown[];
  return raw.map((r, i) => {
    const sc = clean(r);
    if (!sc) throw new Error(`${file} แถว ${i + 1}: รูปแบบไม่ถูก (${JSON.stringify(r)})`);
    return sc;
  });
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const i = args.indexOf('--by');
  const by = i > -1 ? args[i + 1] : undefined;
  if (apply && !by) {
    console.error('--apply ต้องบอก --by <username> ด้วย');
    return 1;
  }

  const wanted = loadCatalogSubcodes();
  const have = new Map((await listSubCodes()).map((sc) => [JSON.stringify([sc.subCode.toUpperCase(), sc.scope]), sc]));
  const toWrite: SubCode[] = [];
  for (const sc of wanted) {
    const cur = have.get(JSON.stringify([sc.subCode.toUpperCase(), sc.scope]));
    const what = `${sc.scope.padEnd(9)} ${sc.subCode.padEnd(3)} ${sc.reads}`;
    if (!cur) { toWrite.push(sc); console.log(`  + ${what}`); continue; }
    if (meaning(cur) === meaning(sc)) { console.log(`  = ${what}`); continue; }
    console.log(`  ! ${what} — ข้าม: ในฐานตั้งไว้เป็น "${cur.reads}" (${cur.by ?? '?'} ${cur.at ?? ''}) ค่าของคนชนะไฟล์`);
  }
  if (!toWrite.length) {
    console.log('\nตารางรหัสย่อยมีครบแล้ว — ไม่มีอะไรต้องเขียน');
    return 0;
  }
  if (!apply) {
    console.log(`\n(ยังไม่ได้เขียนลงฐาน — ${toWrite.length} แถว · ใส่ --apply --by <username> เพื่อบันทึก)`);
    return 0;
  }
  await withTransaction(async (client) => {
    for (const sc of toWrite) {
      if (!(await upsertSubCode(sc, by!, client))) throw new Error(`เขียน ${sc.subCode}/${sc.scope} ไม่สำเร็จ`);
    }
  });
  console.log(`\nบันทึกแล้ว ${toWrite.length} แถว`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  let code = 1;
  try {
    code = await main();
  } finally {
    await pool.end();
  }
  process.exit(code);
}
