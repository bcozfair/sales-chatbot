// ─────────────────────────────────────────────────────────────────────────────
//  หัวกระดาษของสองบริษัทผู้ขาย (PM = ไพรมัส · THT = เดมเทค) — **ที่เดียวของทั้งระบบ**
//
//  เดิมข้อความชุดนี้ฝังอยู่ใน pdfGenerator.ts ที่เดียว ซึ่งถูกต้องตอนที่มีแต่ PDF ที่ใช้มัน
//  ตั้งแต่ 2026-09-17 หน้าจอ "ใบร่าง" ของหน้าขอใบเสนอราคาก็โชว์หัวใบด้วย ⇒ ถ้าปล่อยให้
//  ฝั่งหน้าเว็บพิมพ์ที่อยู่/เลขผู้เสียภาษีของตัวเอง วันที่บริษัทย้ายที่อยู่จะมีสองที่ต้องแก้
//  และจะไม่มีอะไรฟ้องว่าลืมแก้ที่หนึ่ง — จอบอกที่อยู่หนึ่ง ใบที่ลูกค้าได้รับบอกอีกที่อยู่
//
//  ⚠️ ข้อความทุกบรรทัดคัดมาจากของเดิมตรงตัว รวม `&nbsp;` ที่ใช้จัดระยะบนกระดาษ
//     แก้เมื่อไหร่ = เอกสารที่ลูกค้าได้รับเปลี่ยน ⇒ ต้องเป็นคำสั่งจากเจ้าของเท่านั้น
// ─────────────────────────────────────────────────────────────────────────────

export type QuoteCompanyKey = 'PM' | 'THT';

export interface CompanyProfile {
  key: QuoteCompanyKey;
  /** ชื่อไฟล์โลโก้ใน `data/` — PDF อ่านเป็น base64 · หน้าเว็บอ้างผ่าน `/data/<ไฟล์>` */
  logo_file: string;
  name_th: string;
  name_en: string;
  /** บรรทัดที่อยู่ใต้ชื่อบริษัท (อาจมี `&nbsp;` เพื่อจัดระยะ — ห้าม normalize) */
  address_lines: string[];
  tax_id: string;
  /** สามบรรทัดปิดท้ายมุมขวาล่างของใบ */
  closing_lines: string[];
}

export const COMPANY_PROFILES: Record<QuoteCompanyKey, CompanyProfile> = {
  PM: {
    key: 'PM',
    logo_file: 'logo.png',
    name_th: 'บริษัท ไพรมัส จํากัด (สาขาที่ 00012)',
    name_en: 'Primus Co.,Ltd',
    address_lines: [
      '118/60 &nbsp;หมู่ 18 &nbsp;ตำบลคลองหนึ่ง &nbsp;อำเภอคลองหลวง &nbsp;จังหวัด ปทุมธานี &nbsp;12120',
      '118/60 MOO 18 , KHLONG NUENG , KHLONG LUANG , PATHUM THANI 12120',
      'Tel: 0-2693-7005 (Auto lines) &nbsp; Fax:Sale : 0-2277-3565 , 0-2277-1146 &nbsp; FaxAccount : 0-2276-7221, 0-2275-1912',
      'https://www.primus.co.th &nbsp; E-mail: sales@primus.co.th &nbsp; Tax ID: 0105536011803',
    ],
    tax_id: '0105536011803',
    closing_lines: [
      'ทางบริษัทฯ หวังเป็นอย่างยิ่งว่าจะได้บริการท่านในเร็ววันนี้',
      'We look forward to give you our best service',
      'บริษัท ไพรมัส จำกัด',
    ],
  },
  THT: {
    key: 'THT',
    logo_file: 'logo2.png',
    name_th: 'บริษัท เดมเทค จำกัด (สาขาที่ 00002)',
    name_en: 'Themtech Co., Ltd.',
    address_lines: [
      '118/60 อาคาร PRIMUS ชั้น 2 หมู่ที่ 18 ตำบลคลองหนึ่ง อำเภอคลองหลวง จังหวัด ปทุมธานี 12120',
      '118/60 PRIMUS BUILDING, 2ND FLOOR MOO 18 , KHLONG NUENG , KHLONG LUANG , PATHUM THANI 12120',
      'Tel: 0-2693-7005 (Auto lines) &nbsp; Fax:Sale:0-2277-3565 , 0-2277-1146 &nbsp; FaxAccount: 0-2276-7221, 0-2275-1912',
      'https://www.themtech.co.th &nbsp; E-mail: sales_tht@themtech.co.th &nbsp; Tax ID: 0105542030032',
    ],
    tax_id: '0105542030032',
    closing_lines: [
      'ทางบริษัทฯ หวังเป็นอย่างยิ่งว่าจะได้บริการท่านในเร็ววันนี้',
      'We look forward to give you our best service',
      'บริษัท เดมเทค จำกัด',
    ],
  },
};

export function companyProfileOf(isThemtech: boolean): CompanyProfile {
  return isThemtech ? COMPANY_PROFILES.THT : COMPANY_PROFILES.PM;
}

/** สองบรรทัดชื่อบริษัทบนหัวกระดาษ */
export function companyNameHtml(p: CompanyProfile): string {
  return `
      <div>${p.name_th}</div>
      <div>${p.name_en}</div>
    `;
}

/** บล็อกที่อยู่ใต้ชื่อบริษัท */
export function companyAddressHtml(p: CompanyProfile): string {
  return p.address_lines.join('<br />');
}

/** ข้อความปิดท้ายมุมขวาล่าง */
export function companyClosingHtml(p: CompanyProfile): string {
  return p.closing_lines.join('<br>');
}
