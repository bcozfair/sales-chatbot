/**
 * services/quotationConfirm.ts — "ร่าง → ใบเสนอราคาจริง" ที่เดียวของทั้งระบบ
 *
 * ## ทำไมไฟล์นี้ถึงมี (2026-09-15)
 *
 * ตรรกะทั้งก้อนนี้เคยอยู่ในตัว route `POST /api/quotation/:id/confirm` ใน `index.ts` ซึ่งใช้ได้
 * ตราบใดที่ "การออกใบ" เกิดจากคนกดผ่าน HTTP เส้นนั้นเท่านั้น — พอมีคิวอนุมัติราคา
 * (docs/plan-quote-price-approval.md) **ผู้อนุมัติกลายเป็นคนที่ทำให้ใบออก** และเขากดจาก
 * endpoint คนละเส้น ⇒ มีผู้เรียกสองราย
 *
 * ทางเลือกคือก๊อปลำดับขั้นไปไว้ฝั่งอนุมัติ ซึ่งผิดกฎเหล็กของ `AGENTS.md` B4 ตรง ๆ
 * ("ตรรกะที่มีที่เดียว ห้ามก๊อปไปเขียนซ้ำ") และผลของการก๊อปในที่นี้ไม่ใช่โค้ดซ้ำเฉย ๆ แต่คือ
 * **ใบที่ออกจากคิวอนุมัติจะค่อย ๆ ต่างจากใบที่ออกจากปุ่มปกติ** โดยไม่มีอะไรฟ้อง
 * (ลำดับ enrich → expand → ตรวจกฎ → ออกเลข ต้องเหมือนกันทุกไบต์)
 *
 * เนื้อในย้ายมาทั้งดุ้นโดยไม่เปลี่ยนลำดับหรือเงื่อนไขใด ๆ — route เหลือหน้าที่เดียวคือแปลงผลลัพธ์
 * เป็น HTTP status · ด่านที่พิสูจน์ว่าไม่เพี้ยน: `npm run diag:confirm-race` · `diag:web-quote`
 *
 * ## ข้อจำกัดที่ยังอยู่เหมือนเดิม
 *
 * * **ห้ามเรียกจากใน `withTransaction()`** — `enrichQuotationData` ผูก pool ตรง ๆ (self-deadlock)
 * * `confirmQuotationAtomic` เป็นตัวที่ออกเลข + เปลี่ยนสถานะแบบ atomic/idempotent ⇒ เรียกซ้ำ
 *   ด้วยใบเดิมได้ผลเดิม ไม่ได้เลขใหม่
 * * ด่านตรวจกฎเป็น fail-closed และ **อ่านคำรับทราบ/คำอนุมัติจากแถวของใบ ไม่ใช่จากผู้เรียก** —
 *   ใบจาก LINE มีสองคอลัมน์นั้นเป็น NULL จึงติดกฎเหมือนเดิมทุกประการ
 */

import { pool } from '../config/db.js';
import { insertMessage } from '../db/repositories.js';
import { getAcknowledgedViolationKeys, getPriceApproval } from '../db/repositories.js';
import {
  enrichQuotationData,
  confirmQuotationAtomic,
  validateQuotationItems,
  blockingViolations,
  approvedViolationKeys,
  type Violation,
} from './quotationService.js';
import { parseWebUserId } from './webIdentity.js';
import { isCustomerInfoIncomplete } from '../utils/flexTemplates.js';

/**
 * ข้อความที่แอดมินเห็นบนจอเมื่อ `confirmQuotationAtomic` โยน error (เจ้าของเลือกแบบนี้ 2026-09-18)
 *
 * error ที่มาถึงตรงนี้เป็นข้อความดิบของไดรเวอร์ฐานข้อมูล เช่น `Query read timeout` ซึ่งบอกคนอ่าน
 * ไม่ได้สักอย่างว่าเกิดอะไรและต้องทำอะไรต่อ — ทั้งที่คำตอบมีแค่ "กดยืนยันอีกครั้ง"
 *
 * **ทั้งก้อนอยู่ในทรานแซกชันเดียว ⇒ ล้มแล้วใบยังเป็นร่าง ยังไม่มีเลขที่ใบ ตัวนับไม่ขยับ**
 * (วัดจริง 2026-09-18: ล็อก customers_data_view ค้างไว้แล้วกดยืนยัน → ล้มที่ 15 วิ · ใบยัง draft ·
 *  counter ยัง 0 · กดใหม่ได้เลขปกติ) ประโยคนี้จึงพูดได้เต็มปากว่ายังไม่ได้ออกเลขที่ใบ
 *
 * ข้อความดิบต่อท้ายในวงเล็บ เพื่อให้แอดมินส่งต่อให้คนดูแลระบบได้โดยไม่ต้องไปงม log —
 * ตัดเหลือบรรทัดเดียวและไม่เกิน 160 ตัวอักษร เพราะกล่องแดงบนจอเป็นตัวหนังสือขนาดเล็ก
 * และ error ของ Postgres บางตัวยาวหลายบรรทัด (log ยังเก็บของเต็มไว้ครบด้วย console.error ข้างบน)
 *
 * ⚠️ ใช้เฉพาะกับ error ของ **ขั้นออกเลข** เท่านั้น — ขั้นอื่นที่ล้มหลังใบออกไปแล้วห้ามใช้ประโยคนี้
 */
export function confirmFailureMessage(err: unknown): string {
  const raw = String((err as any)?.message ?? err ?? '').replace(/\s+/g, ' ').trim();
  const shown = raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
  const base = 'ระบบขัดข้องชั่วคราว ยังไม่ได้ออกเลขที่ใบ กรุณากดยืนยันอีกครั้ง';
  return shown ? `${base} (${shown})` : base;
}
import { buildPdfLink } from '../utils/quotationLink.js';
import { getAppUrl } from '../config/appUrl.js';

export type ConfirmQuotationResult =
  | { ok: true; quotationNo: string; pdfLink: string; outcome: string }
  | { ok: false; status: number; error: string; violations?: Violation[] };

/**
 * ยืนยันใบเสนอราคาหนึ่งใบ
 *
 * `userId` ใช้ตรวจความเป็นเจ้าของแบบเดียวกับที่ route เคยทำ (`isQuotationOwner`) — ฝั่งคิว
 * อนุมัติส่ง `user_id` ของแถวเข้ามาเอง เพราะสิทธิ์ของผู้อนุมัติถูกตรวจไปแล้วที่ชั้น role
 * ไม่ใช่ที่ความเป็นเจ้าของใบ (ผู้อนุมัติไม่ใช่เจ้าของใบโดยนิยาม)
 */
export async function confirmQuotationById(params: {
  quoteId: string;
  userId?: string;
  /** ผู้เรียกตรวจสิทธิ์มาแล้วด้วยวิธีอื่น (คิวอนุมัติ) — ข้ามการเทียบเจ้าของใบ */
  skipOwnerCheck?: boolean;
}): Promise<ConfirmQuotationResult> {
  const { quoteId, userId } = params;

  const quoteRes = await pool.query('SELECT * FROM quotations WHERE id = $1', [quoteId]);
  const quoteRaw = quoteRes.rows[0];

  if (!quoteRaw) return { ok: false, status: 404, error: 'Quotation not found' };

  // คืน true ถ้าใบไม่มีเจ้าของ (user_id หลุดเพราะ FK ON DELETE SET NULL = ข้อมูลเก่า)
  const isOwner = !quoteRaw.user_id || (!!userId && quoteRaw.user_id === userId);
  if (!params.skipOwnerCheck && !isOwner) {
    return { ok: false, status: 403, error: 'ไม่มีสิทธิ์เข้าถึงใบเสนอราคานี้' };
  }

  if (quoteRaw.status === 'cancelled') {
    return { ok: false, status: 400, error: 'Cannot confirm a cancelled quotation' };
  }

  // ค่าขนส่งอัตโนมัติ — กันเหนียวก่อนออกเลขจริง เผื่อยอดเปลี่ยนหลังบันทึกครั้งสุดท้าย
  // ไม่แตะใบที่ยืนยัน/ยกเลิกไปแล้ว จึงไม่กระทบ idempotency ของเส้นนี้
  // ขอบเขตกลุ่ม = ชุดของใบนี้เอง — แอดมินคนเดียวมีได้หลายชุดค้างพร้อมกันตั้งแต่มีคิวอนุมัติ
  // (ใบที่ไม่ได้อยู่ในคำขอส่ง null ⇒ กลุ่มเดิมทุกประการ เหมือนที่ LINE/LIFF เป็นมาตลอด)
  const { applyShippingFeeToQuoteGroup } = await import('./shippingFee.js');
  await applyShippingFeeToQuoteGroup(
    quoteRaw.user_id, undefined, quoteRaw.price_approval?.request_id ?? null
  );
  const refreshedRes = await pool.query('SELECT * FROM quotations WHERE id = $1', [quoteId]);
  const quoteAfterFee = refreshedRes.rows[0] || quoteRaw;

  // Enrich ก่อนเพื่อให้ quote.items มีข้อมูลสำหรับตรวจราคาขั้นต่ำและ allocateQuotationNo
  const quote = await enrichQuotationData(quoteAfterFee);

  // กันการยืนยันใบเสนอราคาที่ไม่มีสินค้า (defense-in-depth เผื่อ frontend ถูก bypass)
  if (!quote.items || !Array.isArray(quote.items) || quote.items.length === 0) {
    return { ok: false, status: 400, error: 'ไม่สามารถยืนยันใบเสนอราคาที่ไม่มีสินค้าได้' };
  }

  // พ่วงสินค้าเสริม (optional) ก่อน validate — กันเคสร่างที่ยังไม่เคยผ่าน expand (เช่น chat revise เก่า)
  // expandOptionalProducts มี de-dupe อยู่แล้ว จึงรันซ้ำกับใบที่พ่วงมาแล้วได้ ไม่เพิ่มซ้ำ
  // ใช้ผลนี้กับทั้ง check ราคาขั้นต่ำ/สต็อก และ allocateQuotationNo (items[0]=หลัก คงเดิม พ่วงต่อท้าย)
  // หมายเหตุ: confirmQuotationAtomic ไม่เขียน items ลง DB (แค่ออกเลข+เปลี่ยน status) จึงเป็น validation-only
  try {
    const { expandOptionalProducts } = await import('./productService.js');
    quote.items = await expandOptionalProducts(quote.items);
  } catch (expandErr) {
    console.error('Error expanding optional products on confirm:', expandErr);
    // ล้มเหลว → ใช้ items เดิมต่อ ไม่ปิดกั้นการยืนยัน (ยังตรวจกฎด้วยรายการที่มี)
  }

  // กันการยืนยันใบที่ยังไม่ได้ผูกลูกค้า — เลขที่เอกสารเดินหน้าแล้วย้อนคืนไม่ได้
  // (ใบที่ยืนยันไปแล้วต้องปล่อยผ่านเพื่อคง idempotency ของเส้นนี้)
  if (quote.status !== 'confirmed' && isCustomerInfoIncomplete(quote)) {
    return {
      ok: false, status: 400,
      error: 'ไม่สามารถยืนยันใบเสนอราคาที่ยังไม่ได้ระบุลูกค้าได้ กรุณาเลือกบริษัทและผู้ติดต่อก่อน',
    };
  }

  // ด่านตรวจกฎรวมก่อนออกเลข (fail-closed) — blocked/stock/MOQ/min-price
  const { violations: confirmViolations } = await validateQuotationItems(quote.items, {
    customerName: quote.customer_name, stage: 'confirm',
    customerId: quote.customer_id, contactId: quote.contact_id,
  });
  // คำรับทราบและคำอนุมัติผูกกับ **ใบ** (คอลัมน์ rule_overrides / price_approval) ไม่ใช่กับ endpoint
  // — เส้นนี้หน้า LIFF ใช้ร่วมกับหน้าเว็บอยู่ · ข้อที่ **เพิ่งโผล่** หลังคนกดรับทราบ (ของหมดระหว่างทาง)
  // ยังตอบ 422 เหมือนเดิม เพราะเจ้าของเลือกไว้ว่า "ปฏิเสธและให้ดูใหม่" ไม่ใช่ปล่อยผ่านเพราะกดมาแล้ว
  const confirmBlockers = blockingViolations(
    confirmViolations,
    await getAcknowledgedViolationKeys(pool, quoteId),
    approvedViolationKeys(await getPriceApproval(pool, quoteId), confirmViolations)
  );
  if (confirmBlockers.length > 0) {
    return { ok: false, status: 422, error: 'VALIDATION_ERROR', violations: confirmBlockers };
  }

  // ห้ามกลับไปเดาจาก req.get('host') — ดูเหตุผลที่ /callback และ config/appUrl.ts
  const reqUrl = getAppUrl();
  // ยืนยันแบบ atomic + idempotent (ออกเลข + เปลี่ยน status ใน transaction เดียวพร้อม row lock
  // cancelOldRevision กรณี revision อยู่ใน tx เดียวกัน และไม่เขียนทับ created_at เพราะเลขคำนวณจากมัน)
  let confirmResult;
  try {
    confirmResult = await confirmQuotationAtomic(quoteId, quote);
  } catch (updateError: any) {
    console.error('Confirm quotation error:', updateError);
    return { ok: false, status: 500, error: confirmFailureMessage(updateError) };
  }

  if (confirmResult.outcome === 'not_found') {
    return { ok: false, status: 404, error: 'Quotation not found' };
  }
  if (confirmResult.outcome === 'cancelled') {
    return { ok: false, status: 400, error: 'Cannot confirm a cancelled quotation' };
  }

  // confirmed / already_confirmed → success เหมือนกัน (idempotent)
  // ลิงก์ต้องสร้างหลังตรงนี้ เพราะเลขใบเสนอราคาเพิ่งถูกออกใน confirmQuotationAtomic
  const pdfLink = buildPdfLink(reqUrl, quoteId, confirmResult.quotationNo);
  console.log(`[Push Disabled] Confirm quotation no: ${confirmResult.quotationNo} for user: ${quoteRaw.user_id}`);

  // ประวัติของหน้าเว็บแอดมิน — docs/plan-web-quote-logging.md §4
  //
  // เส้นนี้ใช้ร่วมกับ LIFF ของเซลส์ ⇒ เขียนเฉพาะขา `web:%` เท่านั้น ถ้าเขียนทุกขา
  // ใบที่เซลส์ยืนยันผ่าน LIFF จะเริ่มมีแถวใหม่ใน messages ซึ่งไปเปลี่ยนความหมายของประวัติ
  // ที่ quoteExtraction อ่านอยู่ (ตัดหน้าต่าง 15 นาทีด้วยคำว่า "ยืนยันสำเร็จ")
  //
  // อยู่หลัง confirmQuotationAtomic ที่ COMMIT ไปแล้ว — ห้ามขยับขึ้นไปอยู่ในทรานแซกชัน
  const webOwner = parseWebUserId(quoteRaw.user_id);
  if (webOwner) {
    await insertMessage({
      user_id: quoteRaw.user_id,
      message_id: `web_confirm_${Date.now()}`,
      type: 'web_confirm',
      content: 'ยืนยัน',
      reply_token: null,
      reply_content: `✅ ยืนยันสำเร็จ!\n📄 ใบเสนอราคาเลขที่: ${confirmResult.quotationNo}`,
      meta: {
        quotation_no: confirmResult.quotationNo,
        quotation_id: String(quoteId),
        outcome: confirmResult.outcome,
      },
    });
  }

  return { ok: true, quotationNo: confirmResult.quotationNo, pdfLink, outcome: confirmResult.outcome };
}
