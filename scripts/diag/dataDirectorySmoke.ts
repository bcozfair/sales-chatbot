/**
 * diag:data-directory — ด่านตรวจของหน้า "ข้อมูลสินค้า" / "ข้อมูลลูกค้า"
 *
 * อ่านอย่างเดียวทั้งไฟล์ ไม่เขียนฐาน รันบนเครื่อง dev ได้ตลอด
 *
 * สิ่งที่ด่านนี้พิสูจน์ (ไม่ใช่แค่ "ไม่ error"):
 *   1. กฎบล็อกที่หน้าจอโชว์ ตรงกับ engine ตัวเดียวกับที่ใช้ตอนออกใบจริง
 *   2. ส่วนลดดึงจาก company_id เดียว **ไม่ขยายนิติบุคคล** (เจ้าของตัดสิน 2026-09-17)
 *      — ถ้าวันหนึ่งมีคนแก้ให้ขยาย ข้อนี้จะล้มทันที
 *   3. total_discount ถูกส่งต่อตรง ๆ ไม่ถูกคำนวณใหม่ (มี 0.7% ของใบที่คำนวณใหม่แล้วไม่ตรง)
 *   4. ตัวกรองทุกตัวคืนผลที่ "ตรงกับที่กรอง" จริง ไม่ใช่แค่ไม่ล้ม
 *   5. query ของหน้าไม่ช้าเกินงบ (เขียนผิดท่าเดียวกลายเป็น timeout 15 วิ — เคยเกิดแล้ว)
 */
import { pool } from '../../config/db.js';
import {
  getProductDirectory, getProductDirectorySummary, getProductFacets,
  getCompanyDirectory, getContactDirectory, getCompanyDetail, getCustomerFacets,
  summarizeDiscounts,
} from '../../services/dataDirectoryService.js';
import { loadProductBlockRules, findBlockingRule, normalizeProductScope } from '../../services/rules/index.js';

let failed = 0;
function ok(label: string, pass: boolean, detail = '') {
  console.log((pass ? '  ✓ ' : '  ✗ ') + label + (detail ? '  — ' + detail : ''));
  if (!pass) failed++;
}
function section(t: string) { console.log('\n' + t); }

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const v = await fn();
  return [v, Date.now() - t];
}

async function main() {
  console.log('diag:data-directory — หน้าข้อมูลสินค้า / ข้อมูลลูกค้า');

  // ── 1. สินค้า: โครงและตัวกรอง ────────────────────────────────
  section('1) หน้าสินค้า — โครงข้อมูลและตัวกรอง');
  const [page1, ms1] = await timed(() => getProductDirectory({ limit: 50 }));
  ok('ดึงหน้าแรกได้', page1.items.length > 0, `${page1.items.length} แถว จาก ${page1.total.toLocaleString()} · ${ms1} ms`);
  ok('ทุกแถวมีก้อน rules ครบ', page1.items.every((p: any) =>
    p.rules && typeof p.rules.stockRule === 'boolean' && Array.isArray(p.rules.optional) && p.rules.block));
  // งบเวลา: หน้านี้เป็นหน้าจอแอดมิน ไม่ได้อยู่ในเส้น replyToken 48 วิ แต่เกิน 2 วิ = ใช้งานไม่ได้
  ok('หน้าแรกเร็วพอ (< 2,000 ms)', ms1 < 2000, `${ms1} ms`);

  const [blocked] = await timed(() => getProductDirectory({ limit: 20, production: 'Production 2(PM)' }));
  ok('กรองแหล่งผลิตแล้วได้เฉพาะแหล่งนั้น',
    blocked.items.length > 0 && blocked.items.every((p: any) => p.production === 'Production 2(PM)'));

  const [noPrice] = await timed(() => getProductDirectory({ limit: 20, flag: 'noprice' }));
  ok('ตัวกรอง "ยังไม่ตั้งราคาขาย" ได้เฉพาะราคา 0',
    noPrice.items.length > 0 && noPrice.items.every((p: any) => Number(p.sales_price ?? 0) === 0));

  const [hasStock] = await timed(() => getProductDirectory({ limit: 20, stock: 'has' }));
  ok('ตัวกรอง "มีของพร้อมขาย" เทียบ unreserved ไม่ใช่ on_hand',
    hasStock.items.length > 0 && hasStock.items.every((p: any) => Number(p.quantity_on_hand_unreserved) > 0));

  const [searched] = await timed(() => getProductDirectory({ limit: 10, q: 'Klemsan' }));
  ok('ค้นหาข้ามช่องได้', searched.items.length > 0, `${searched.total} แถว`);

  // ตัวกรอง "ซีรีส์" มาแทน "กลุ่มสินค้า" (เจ้าของสั่ง 2026-09-21) — สองข้อนี้คู่กันเสมอ:
  // ถ้าเหลือแต่ dropdown แต่ช่องค้นหาไม่รู้จักซีรีส์ คนที่จำชื่อซีรีส์ได้จะพิมพ์แล้วไม่เจอ
  const topSeries = (await getProductFacets()).series
    .reduce((a, b) => (b.n > a.n ? b : a), { value: '', n: 0 });
  const [bySeries] = await timed(() => getProductDirectory({ limit: 20, series: topSeries.value }));
  ok('ตัวกรองซีรีส์เทียบตรงตัว ไม่ใช่คำค้นคลุม',
    bySeries.total > 0 && bySeries.items.every((p: any) => p.series === topSeries.value),
    `${topSeries.value} · ${bySeries.total.toLocaleString()} แถว`);

  const [qSeries] = await timed(() => getProductDirectory({ limit: 5, q: topSeries.value }));
  ok('ช่องค้นหาหาจากซีรีส์ได้ด้วย', qSeries.total > 0,
    `พิมพ์ "${topSeries.value}" ได้ ${qSeries.total.toLocaleString()} แถว`);

  // ── 2. กฎบล็อกต้องตรงกับ engine ตัวจริง ──────────────────────
  section('2) กฎบล็อก — ต้องตรงกับ engine ที่ใช้ตอนออกใบจริง');
  const blockRules = await loadProductBlockRules();
  ok('โหลดกฎบล็อกได้', blockRules.length > 0, `${blockRules.length} ข้อ`);
  const [sample] = await timed(() => getProductDirectory({ limit: 200 }));
  let mismatch = 0;
  for (const p of sample.items as any[]) {
    const expected = findBlockingRule(blockRules, normalizeProductScope(p));
    if (!!expected !== p.rules.block.blocked) mismatch++;
  }
  ok('ผลบล็อกที่หน้าจอ ตรงกับ findBlockingRule ทุกแถว', mismatch === 0,
    mismatch ? `ไม่ตรง ${mismatch} แถว` : `ตรวจ ${sample.items.length} แถว`);

  const summary = await getProductDirectorySummary();
  ok('ตัวเลขสรุปสมเหตุสมผล',
    summary.total > 0 && summary.blocked >= 0 && summary.quotable === summary.total - summary.blocked,
    `ทั้งหมด ${summary.total.toLocaleString()} · ถูกบล็อก ${summary.blocked.toLocaleString()} · เสนอได้ ${summary.quotable.toLocaleString()}`);

  const facets = await getProductFacets();
  ok('ตัวเลือก dropdown มาจากค่าที่มีจริง',
    facets.productions.length > 0 && facets.series.length > 0,
    `แหล่งผลิต ${facets.productions.length} · ซีรีส์ ${facets.series.length} · แบรนด์ ${facets.brands.length}`);

  // ── 3. ลูกค้า: สองมุมมอง ─────────────────────────────────────
  section('3) หน้าลูกค้า — มุมมองบริษัท / ผู้ติดต่อ');
  const [co, msCo] = await timed(() => getCompanyDirectory({ limit: 50 }));
  ok('มุมมองบริษัทดึงได้', co.items.length > 0, `${co.items.length} แถว จาก ${co.total.toLocaleString()} บริษัท · ${msCo} ms`);
  ok('มุมมองบริษัทไม่มี company_id ซ้ำ',
    new Set(co.items.map((r: any) => r.company_id)).size === co.items.length);
  ok('มุมมองบริษัทเร็วพอ (< 2,000 ms)', msCo < 2000, `${msCo} ms`);

  const [ct, msCt] = await timed(() => getContactDirectory({ limit: 50 }));
  ok('มุมมองผู้ติดต่อดึงได้', ct.items.length > 0, `${ct.items.length} แถว จาก ${ct.total.toLocaleString()} ผู้ติดต่อ · ${msCt} ms`);
  ok('ผู้ติดต่อมากกว่าบริษัทเสมอ (1 บริษัทมีได้หลายคน)', ct.total > co.total,
    `${ct.total.toLocaleString()} > ${co.total.toLocaleString()}`);

  const [gate] = await timed(() => getCompanyDirectory({ limit: 20, gate: 'na' }));
  ok('ตัวกรอง "ไม่เข้าข่ายตรวจ" ได้เฉพาะ last_order_at ว่าง',
    gate.items.length > 0 && gate.items.every((r: any) => r.last_order_at == null));

  const [credit] = await timed(() => getCompanyDirectory({ limit: 20, pay: '__credit' }));
  ok('ตัวกรอง "เครดิตทุกแบบ" ตรงนิยามเดียวกับ customers_data_build',
    credit.items.length > 0 && credit.items.every((r: any) =>
      /^[0-9]+ Days$/.test(r.customer_payment_terms ?? '') || (r.customer_payment_terms ?? '').startsWith('เช็คล่วงหน้า')));

  const cf = await getCustomerFacets();
  ok('ตัวเลือก dropdown ของลูกค้ามาจากค่าจริง',
    cf.types.length > 0 && cf.states.length > 0 && cf.payTerms.length > 0,
    `ประเภท ${cf.types.length} · จังหวัด ${cf.states.length} · เงื่อนไขชำระ ${cf.payTerms.length}`);

  // ── 4. ส่วนลด — ขอบเขตและความถูกต้องของตัวเลข ────────────────
  section('4) ประวัติส่วนลด — ขอบเขต company_id เดียว (เจ้าของตัดสิน 2026-09-17)');
  const withDiscount = (co.items as any[]).find((r) => r.discount && r.discount.rows.length >= 2);
  ok('มีบริษัทที่มีประวัติส่วนลดในหน้าแรก', !!withDiscount,
    withDiscount ? `${withDiscount.customer_reference} · ${withDiscount.discount.rows.length} ใบ` : 'ไม่เจอในหน้าแรก');

  if (withDiscount) {
    const d = withDiscount.discount;
    ok('ไม่เกิน 3 ใบต่อบริษัท', d.rows.length <= 3, `${d.rows.length} ใบ`);
    ok('เรียงจากใบล่าสุดก่อน', d.rows.every((r: any, i: number) =>
      i === 0 || !r.date || !d.rows[i - 1].date || new Date(d.rows[i - 1].date) >= new Date(r.date)));

    // ข้อ 3 ของหัวไฟล์: ตัวเลขต้องเป็นค่าจากฐานตรง ๆ
    const first = d.rows[0];
    const { rows: raw } = await pool.query(
      `SELECT total_discount, total_amount FROM sale_orders WHERE order_reference = $1 LIMIT 1`,
      [first.ref],
    );
    ok('ส่วนลดตรงกับ total_discount ในฐาน (ไม่ได้คำนวณใหม่)',
      raw.length > 0 && Math.abs(Number(raw[0].total_discount) - first.discount) < 0.005,
      `ฐาน ${raw[0]?.total_discount} · ที่ส่งออก ${first.discount}`);
    ok('ยอดก่อนลดตรงกับ total_amount ในฐาน',
      raw.length > 0 && Math.abs(Number(raw[0].total_amount) - first.amount) < 0.005);
  }

  // ขอบเขต: ต้องไม่ดึงใบของสาขาอื่นที่เลขภาษีเดียวกัน
  const { rows: pair } = await pool.query(
    `SELECT a.company_id AS a, b.company_id AS b, a.customer_tax_id
       FROM (SELECT DISTINCT company_id, customer_tax_id FROM customers_data_view WHERE customer_tax_id IS NOT NULL) a
       JOIN (SELECT DISTINCT company_id, customer_tax_id FROM customers_data_view WHERE customer_tax_id IS NOT NULL) b
         ON a.customer_tax_id = b.customer_tax_id AND a.company_id < b.company_id
      LIMIT 1`,
  );
  if (pair.length) {
    const { a, b } = pair[0];
    const [da, db] = await Promise.all([getCompanyDetail(a), getCompanyDetail(b)]);
    const refsA = new Set((da?.discount?.rows ?? []).map((r) => r.ref));
    const refsB = new Set((db?.discount?.rows ?? []).map((r) => r.ref));
    const shared = [...refsA].filter((r) => refsB.has(r));
    // สองรหัสที่เลขภาษีเดียวกันต้อง "ไม่" เห็นใบของกันและกัน — ถ้าเห็น แปลว่ามีคนไปขยายนิติบุคคล
    ok('ส่วนลดไม่ขยายข้ามรหัสลูกค้าที่เลขภาษีเดียวกัน', shared.length === 0,
      `เลขภาษี ${pair[0].customer_tax_id} · company ${a} vs ${b}` + (shared.length ? ` · ใบซ้ำ ${shared.join(',')}` : ''));
  } else {
    ok('ส่วนลดไม่ขยายข้ามรหัสลูกค้า (ไม่มีคู่ให้ทดสอบ)', true, 'ข้าม');
  }

  ok('ไม่มีใบ → คืน null ไม่ใช่ก้อนว่าง', summarizeDiscounts([]) === null);

  // ── 5. แผงรายละเอียด ─────────────────────────────────────────
  section('5) แผงรายละเอียดบริษัท');
  const target = (co.items as any[])[0];
  const [detail, msD] = await timed(() => getCompanyDetail(target.company_id));
  ok('เปิดรายละเอียดได้', !!detail, `company_id ${target.company_id} · ${msD} ms`);
  ok('ผู้ติดต่อในแผงตรงกับตัวนับในตาราง',
    (detail?.contacts.length ?? -1) === target.contact_count,
    `${detail?.contacts.length} vs ${target.contact_count}`);
  ok('แผงรายละเอียดเร็วพอ (< 500 ms)', msD < 500, `${msD} ms`);
  ok('company_id ที่ไม่มีอยู่ → คืน null', (await getCompanyDetail(-1)) === null);

  console.log('\n' + (failed === 0 ? 'ผ่านทั้งหมด' : `ไม่ผ่าน ${failed} ข้อ`));
  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
