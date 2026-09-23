/**
 * ด่านวัดความครอบคลุมของสมุดราคา — **ตัวชี้วัดของเฟส C** (`docs/plan-pricing-subcodes.md` §7.1)
 *
 * มันตอบคำถามเดียว: **รหัสจริงในฐานกี่ % ที่ "รุ่นของมันมีตารางราคาอยู่ในสมุดแล้ว"**
 * ไม่ใช่ "คิดราคาออกมาได้กี่ %" — สองอย่างนี้ขยับด้วยคนละงาน และ §7.1 บันทึกไว้แล้วว่า
 * ตอนแรกเขียนด่านนี้ผิดจนงานที่สำเร็จถูกรายงานว่าแย่ลง:
 *
 *   · **มีสมุดราคา**        ← ขยับด้วยงานเฟส C (ลอกตารางราคาเพิ่ม) = ตัวที่ไฟล์นี้เฝ้า
 *   · อ่านครบทุกรหัสย่อย    ← ขยับด้วยคำตอบจากฝ่ายขาย ไม่ใช่โค้ด ⇒ **เติมรุ่นแล้วเลขนี้ลดลงได้
 *                              โดยไม่ได้แปลว่าแย่ลง** (รุ่นใหม่พารหัสย่อยที่ยังไม่ได้ตั้งค่าเข้ามาในตัวหาร)
 *
 * ทั้งสองตัวถูกพิมพ์ออกมาทั้งคู่เพื่อให้เห็นว่ามันสวนทางกันได้ แต่ **เกณฑ์ผ่าน/ตกผูกกับตัวแรกตัวเดียว**
 *
 * ⚠️ ด่านนี้อ่านฐานจริงแบบอ่านอย่างเดียว (`products.model` + สมุดราคาในฐาน · `--data <dir>` ใช้ไฟล์ Excel แทนได้)
 *    ไม่มีสมุดราคา = **ตอบไม่ได้ ไม่ใช่ตก** — บอกวิธีสร้างแล้วจบ (เหมือน diag:dead-classes
 *    ที่เจอบิลด์เก่าแล้วหยุดแทนที่จะตัดสิน) เพราะด่านที่ด่าโค้ดที่ถูก ทำให้คนเลิกเชื่อด่านทั้งชุด
 *
 * ถอนโมดูลคิดราคาออก = ลบไฟล์นี้ + 1 บรรทัดใน package.json ด้วย
 */
import { pool } from '../../config/db.js';
import { NoBook, loadBookFrom } from '../pricebook/bookSource.js';
import { parseProductCode, unknownParts } from '../../services/pricingLab/code.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';

/**
 * **พื้น ไม่ใช่เป้า** — ต่ำกว่านี้เมื่อไหร่แปลว่ามีตารางราคาหายไปจากสมุด ซึ่งเป็นสิ่งเดียว
 * ที่ด่านนี้ต้องจับให้ได้
 *
 * วัดด้วยไฟล์นี้เองเมื่อ 2026-09-21 (ไม่ใช่เลขที่ยกมาจากสคริปต์เก่าที่ไม่มีแล้ว):
 *   · สมุดก่อนเฟส C (6 รุ่น / 4 ชีต)   = **27.0%**  ⇒ เทียบได้กับ 24.7% ที่ §7.1 บันทึกไว้
 *   · สมุดหลังเฟส C (14 รุ่น / 11 ชีต) = **80.1%**
 *
 * ตั้งไว้ที่ 75 ไม่ใช่ 80.1 เพราะตัวหารคือแค็ตตาล็อกจริงที่ sync จาก Odoo ทุกวัน ⇒ ขยับเองได้
 * โดยไม่มีใครแตะโค้ด · ช่องว่าง 5 จุด ≈ 1,100 รหัส ซึ่ง **เล็กกว่าตระกูลที่เล็กที่สุดที่ลอกมาแล้ว**
 * (TS-01 = 1,210 รหัส) ⇒ ทำตารางหายไปทั้งตระกูลเมื่อไหร่ ด่านยังจับได้อยู่
 */
const BASELINE_PCT = 75;

/** ตระกูลที่เครื่องคิดราคานี้รับผิดชอบ — นอกเหนือจากนี้เป็นสินค้าสำเร็จรูป ไม่ใช่ของสั่งทำ */
const FAMILY_RE = /^(TS|BH)/;

async function main(): Promise<void> {
  console.log(`\n${BOLD}ด่านวัดความครอบคลุมของสมุดราคา${RESET}\n`);

  let book;
  try {
    const loaded = await loadBookFrom();
    book = loaded.book;
    console.log(`${DIM}สมุดราคาที่ใช้: ${loaded.label}${RESET}\n`);
  } catch (e) {
    if (!(e instanceof NoBook)) throw e;
    console.log(`${DIM}${e.message}${RESET}`);
    console.log('\nสรุป: ตอบไม่ได้ — ยังไม่มีสมุดราคาให้เทียบ\n');
    process.exitCode = 1;
    return;
  }

  const { rows } = await pool.query<{ model: string | null }>(
    `SELECT model FROM products WHERE model IS NOT NULL AND model <> ''`
  );
  const codes = rows.map((r) => (r.model ?? '').trim()).filter((m) => FAMILY_RE.test(m));

  let inBook = 0;
  let allSubCodesRead = 0;
  const missingByFamily = new Map<string, number>();

  for (const code of codes) {
    const parsed = parseProductCode(code, book);
    if (parsed.model) {
      inBook++;
      if (unknownParts(parsed).length === 0) allSubCodesRead++;
    } else {
      // ตระกูลที่ยังไม่มีตารางราคา — เรียงให้เห็นว่ารอบหน้าควรลอกชีตไหนก่อน
      const fam = code.match(/^(TS[A-Z]*-?\d{2}(?:-0)?|BH-\d{2}[A-Z]*)/)?.[1] ?? '(อ่านหัวรหัสไม่ออก)';
      missingByFamily.set(fam, (missingByFamily.get(fam) ?? 0) + 1);
    }
  }

  const pct = (n: number) => (codes.length === 0 ? 0 : Math.round((n / codes.length) * 1000) / 10);
  const sheets = [...new Set(Object.values(book.models).map((m) => m.sheet).filter(Boolean))];

  console.log(`สมุดราคา: ${Object.keys(book.models).length} รุ่น จาก ${sheets.length} ชีต ${DIM}(${book.version ?? '—'})${RESET}`);
  console.log(`รหัสจริงในฐาน (ตระกูล TS/BH): ${codes.length.toLocaleString()} รหัส\n`);

  const okCoverage = pct(inBook) >= BASELINE_PCT;
  console.log(
    `  ${okCoverage ? GREEN + '✓' : RED + '✗'}${RESET} มีสมุดราคา        ` +
      `${inBook.toLocaleString()} / ${codes.length.toLocaleString()} = ${BOLD}${pct(inBook)}%${RESET} ` +
      `${DIM}(พื้นที่ตั้งไว้ ${BASELINE_PCT}% · วัดหลังเฟส C 2026-09-21 ได้ 80.1%)${RESET}`
  );
  console.log(
    `    ${DIM}อ่านครบทุกรหัสย่อย ${allSubCodesRead.toLocaleString()} / ${codes.length.toLocaleString()} = ` +
      `${pct(allSubCodesRead)}% — ตัวนี้ขยับด้วยคำตอบจากฝ่ายขาย ไม่ใช่โค้ด จึงไม่ได้เป็นเกณฑ์ผ่าน/ตก${RESET}`
  );

  const top = [...missingByFamily.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length > 0) {
    console.log(`\n${BOLD}ตระกูลที่ยังไม่มีตารางราคา — เรียงตามจำนวนรหัสจริง${RESET}`);
    for (const [fam, n] of top) console.log(`  ${String(n).padStart(5)}  ${fam}`);
  }

  console.log(
    `\n${'─'.repeat(70)}\nสรุป: ${
      okCoverage
        ? `${GREEN}ผ่าน${RESET} — ความครอบคลุมไม่ต่ำกว่าเส้นฐาน`
        : `${RED}ตก${RESET} — ความครอบคลุมลดลงจากเส้นฐาน แปลว่ามีตารางราคาหายไปจากสมุด`
    }\n${'─'.repeat(70)}\n`
  );
  process.exitCode = okCoverage ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
