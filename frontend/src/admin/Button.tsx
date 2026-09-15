// ─────────────────────────────────────────────────────────────────────────────
//  ปุ่มของ Admin — ที่เดียวที่รู้ว่า "บทบาทไหนใช้สีอะไร"
//
//  ทำไมถึงมีไฟล์นี้ (2026-09-14): แอปมีปุ่ม 227 จุดใน 29 ไฟล์ และ "สีของปุ่ม" ถูกตัดสินใหม่
//  ทุกครั้งที่มีคนเขียนปุ่ม ⇒ ปุ่มที่ทำงานเหมือนกันหน้าตาไม่เหมือนกัน และของที่ตกเกณฑ์
//  contrast ก็ไม่มีใครเห็น — วัดจริงก่อนทำไฟล์นี้: ปุ่มพื้นสีในธีมมืดตกเกณฑ์ **ทุกตัว**
//  (ยืนยัน 2.04:1 · น้ำเงิน 3.68 · แดง 3.37 เทียบเกณฑ์ 4.5 ของตัวอักษรขนาดปกติ)
//
//  **สีจริงไม่ได้อยู่ในไฟล์นี้** — อยู่ที่ `index.css` เป็นคู่ `--btn-<บทบาท>-bg` / `-ink`
//  ไฟล์นี้แค่แปล "บทบาท" เป็นคู่โทเคนนั้น ⇒ ปรับโทนทั้งแอปยังทำได้จาก CSS ไฟล์เดียวตามเดิม
//
//  ตารางบทบาท (เหตุผลเต็มอยู่ใน docs/design.md หัวข้อ "สีปุ่ม"):
//    primary   เขียวแบรนด์ — เป้าหมายของจอนั้น ยืนยัน/ออกใบ · หนึ่งปุ่มต่อหนึ่งจอ
//    secondary น้ำเงิน     — สำคัญรองลงมาที่ยังเป็นการ "เพิ่ม/ทำ"
//    danger    แดง        — ยกเลิก/ลบ/ห้าม ของที่ย้อนยาก
//    warning   เหลือง     — ของที่ต้องทำเพราะมีอะไรไม่ปกติ
//    neutral   ขาว/การ์ด  — ทางเลือกปกติ ไม่เด่นและไม่อันตราย
//  ส่วน "สีเทา" ไม่ใช่บทบาท แต่เป็น **สถานะ disabled ของทุกบทบาท** — ปุ่มที่กดไม่ได้
//  ต้องหน้าตาเหมือนกันหมดไม่ว่าเดิมจะเป็นสีอะไร ไม่งั้นคนอ่านว่า "ปุ่มแดงจาง ๆ" = อันตราย
//
//  `tone` แยกจาก `variant` เพราะบทบาทเดียวกันมีสองน้ำหนัก: `solid` คือปุ่มหลักของกล่องนั้น
//  `soft` คือปุ่มสีเดียวกันที่อยู่ในแถบแจ้งเตือน/ข้าง ๆ ของอื่น ซึ่งถ้าใช้พื้นทึบจะแย่งสายตา
//  กับปุ่มหลักของจอ — สองอันนี้เป็นคนละงาน ไม่ใช่รสนิยม
//
//  **ความลึกไม่ใช่ของรายบทบาท** (2026-09-15) — เงา/การยก/การยุบอยู่ใน `ELEVATION` ก้อนเดียว
//  และเท่ากันทุกปุ่ม ถ้าปล่อยให้บางบทบาทลอยกว่า ความลึกจะกลายเป็นสัญญาณที่สองว่า "ปุ่มไหน
//  สำคัญกว่า" ซึ่งเป็นงานของสีตามบทบาทอยู่แล้ว แล้วสองสัญญาณนั้นจะขัดกันเองในวันที่ไม่ตรงกัน
//  · `size: 'icon' | 'icon-sm'` คือปุ่มไอคอนล้วนแบบจัตุรัส มีเพื่อให้ปุ่ม ↺ เลิกเขียน class เอง
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning' | 'neutral';
export type ButtonTone = 'solid' | 'soft';

/**
 * พื้นทึบ — ตัวอักษรมาจากโทเคน `-ink` ของบทบาทนั้น ไม่ใช่ `text-white` ตายตัว
 *
 * **สีขอบต้องอยู่ในตารางนี้ทุกบทบาท รวมบทบาทที่ไม่อยากมีขอบ** (แก้ 2026-09-15) — เดิมบรรทัดฐาน
 * ถือ `border-transparent` ไว้แล้วหวังให้ตารางนี้ทับ แต่ Tailwind เรียง `.border-transparent`
 * ไว้ **หลัง** `.border-slate-300` / `.border-blue-200` / … ในไฟล์ CSS ที่ build ออกมา
 * ⇒ transparent ชนะทุกครั้งโดยไม่เกี่ยวกับลำดับตัวอักษรใน className
 * ผลที่วัดได้: ปุ่ม `soft` ทุกตัว (และ `neutral`) **ไม่มีเส้นขอบเลย** ทั้งที่ตั้งใจให้มี
 */
const SOLID: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-ink)] border-transparent hover:bg-[var(--btn-primary-bg-hover)]',
  secondary:
    'bg-[var(--btn-secondary-bg)] text-[var(--btn-secondary-ink)] border-transparent hover:bg-[var(--btn-secondary-bg-hover)]',
  danger:
    'bg-[var(--btn-danger-bg)] text-[var(--btn-danger-ink)] border-transparent hover:bg-[var(--btn-danger-bg-hover)]',
  warning:
    'bg-[var(--btn-warning-bg)] text-[var(--btn-warning-ink)] border-transparent hover:bg-[var(--btn-warning-bg-hover)]',
  // neutral ชี้แล้วเป็นเขียวแบรนด์ทั้งขอบ/ตัวอักษร/พื้น — ยกมาจากปุ่ม Excel/CSV ในเมนู "ส่งออก Odoo"
  // (พื้นเทาอ่อนขึ้นเฉย ๆ บนธีมมืดแทบแยกไม่ออกว่าชี้โดนแล้วหรือยัง)
  neutral:
    'bg-card text-slate-700 border border-slate-300 enabled:hover:bg-[var(--brand-soft)] enabled:hover:text-[var(--brand-fg)] enabled:hover:border-[var(--brand-fg)]',
};

/** พื้นอ่อน + เส้นขอบ — ระดับ 50/200/700 ของจานสถานะ ซึ่งสลับตามธีมให้เองอยู่แล้ว */
const SOFT: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--brand-soft)] text-[var(--brand-fg)] border border-[var(--brand-border)] hover:bg-[var(--brand-soft-strong)]',
  secondary: 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100',
  danger: 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100',
  warning: 'bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100',
  neutral:
    'bg-card text-slate-700 border border-slate-200 enabled:hover:bg-[var(--brand-soft)] enabled:hover:text-[var(--brand-fg)] enabled:hover:border-[var(--brand-fg)]',
};

/** สถานะกดไม่ได้ — เหมือนกันทุกบทบาทโดยตั้งใจ ดูเหตุผลที่หัวไฟล์ */
const DISABLED = 'disabled:bg-slate-100 disabled:text-slate-500 disabled:border-slate-200 disabled:cursor-not-allowed';

/**
 * ชั้นความลึก — เงา/การยกตอนชี้/การยุบตอนกด อยู่ที่นี่ที่เดียว (2026-09-15)
 *
 * ยกรูปแบบมาจากปุ่ม "ส่งออก Odoo" ใน `Quotations.tsx` ซึ่งเจ้าของชี้เป็นต้นแบบ แต่ **ไม่ได้ก๊อป
 * `shadow-sm` มาตรง ๆ** เพราะเงาสำเร็จรูปของ Tailwind เป็นดำโปร่ง 10% ที่หายไปทั้งดวงบนธีมมืด
 * ⇒ ค่าเงามาจากโทเคน `--shadow-btn*` ใน `index.css` ที่แยกค่าคนละชุดต่อธีม
 *
 * `enabled:` ไม่ใช่ของประดับ — `:hover` ยัง match ปุ่มที่ `disabled` อยู่ (เบราว์เซอร์ไม่ตัด
 * pointer-events ให้เอง) ปุ่มที่กดไม่ได้จึงจะลอยขึ้นตอนเอาเมาส์ไปชี้ ทั้งที่กดไม่ได้จริง
 * · `motion-reduce:` สำหรับคนที่ตั้งเครื่องให้ลดการเคลื่อนไหว — เหลือเงาอย่างเดียว ไม่มีการขยับ
 * · ปุ่มที่กดไม่ได้ **ไม่มีเงา** ⇒ "แบน = กดไม่ได้" เป็นสัญญาณที่ไม่ต้องอ่านจากสี (design.md ข้อ 8)
 */
const ELEVATION = [
  'transition-all shadow-[var(--shadow-btn)]',
  'enabled:hover:shadow-[var(--shadow-btn-hover)] enabled:hover:-translate-y-px',
  'enabled:active:shadow-[var(--shadow-btn-press)] enabled:active:translate-y-0 enabled:active:scale-[0.97]',
  'disabled:shadow-none',
  'motion-reduce:transition-colors motion-reduce:enabled:hover:translate-y-0 motion-reduce:enabled:active:scale-100',
].join(' ');

/**
 * ขนาด — **ความสูงไม่ได้อยู่ในนี้** `sm` กับ `md` ใช้ `btn-h` (36px) จาก `index.css` ทั้งคู่
 * เพราะมันคือความสูงเดียวกับปุ่มสั่งงานที่เหลือทั้งแอป (ต้นแบบคือปุ่ม "ส่งออก CSV" ที่เจ้าของ
 * ชี้เมื่อ 2026-09-15) · สองขนาดนี้ต่างกันที่ **ขนาดตัวอักษร ระยะห่างซ้ายขวา และความมน**
 * ไม่ใช่ความสูง — ปุ่มที่สูงไม่เท่ากันในแถบเดียวกันคือสิ่งที่ `btn-h` มีไว้เพื่อกันตั้งแต่แรก
 * · ห้ามเติม `py-*` หรือ `h-*` กลับเข้ามาที่นี่ ตัวเลขอยู่ที่ `--btn-h` ใน `index.css` ที่เดียว
 */
const SIZE = {
  sm: 'text-xs font-semibold px-3 btn-h rounded-lg gap-1.5',
  md: 'text-sm font-semibold px-4 btn-h rounded-xl gap-2',
  // ปุ่มไอคอนล้วน — สี่เหลี่ยมจัตุรัสที่ไม่มีข้อความ ต้องส่ง `aria-label` มาด้วยเสมอ
  icon: 'w-8 h-8 rounded-lg',
  'icon-sm': 'w-7 h-7 rounded-lg',
} as const;

const ICON = { sm: 'w-3.5 h-3.5', md: 'w-4 h-4', icon: 'w-3.5 h-3.5', 'icon-sm': 'w-3 h-3' } as const;

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  tone?: ButtonTone;
  size?: keyof typeof SIZE;
  /** กำลังทำงานอยู่ — เปลี่ยนไอคอนเป็นสปินเนอร์และกดซ้ำไม่ได้ (กันยิงสองครั้ง) */
  busy?: boolean;
  /** ไอคอนนำหน้าข้อความ · ปุ่มที่มีแต่ไอคอนต้องส่ง `aria-label` มาด้วยเสมอ (design.md ข้อ 8) */
  icon?: React.ComponentType<{ className?: string }>;
}

export const Button: React.FC<Props> = ({
  variant = 'neutral',
  tone = 'solid',
  size = 'sm',
  busy,
  icon: Icon,
  disabled,
  className = '',
  children,
  ...rest
}) => {
  const palette = tone === 'solid' ? SOLID[variant] : SOFT[variant];
  // `border` (ความหนา) ค้างไว้เสมอ ไม่ใช่เฉพาะบทบาทที่มีขอบ — ไม่งั้นปุ่มสองแบบที่วางเรียงกัน
  // จะสูงไม่เท่ากัน 2px แล้วแถวปุ่มดูเบี้ยวโดยไม่รู้สาเหตุ · **สีขอบไม่อยู่ตรงนี้** ดูเหตุผลที่ SOLID
  return (
    <button
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center border leading-tight ${ELEVATION} ${SIZE[size]} ${palette} ${DISABLED} ${className}`}
      {...rest}
    >
      {busy ? <Loader2 className={`${ICON[size]} shrink-0 animate-spin`} /> : Icon ? <Icon className={`${ICON[size]} shrink-0`} /> : null}
      {children}
    </button>
  );
};
