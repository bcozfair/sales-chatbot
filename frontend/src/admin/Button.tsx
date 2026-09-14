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
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning' | 'neutral';
export type ButtonTone = 'solid' | 'soft';

/** พื้นทึบ — ตัวอักษรมาจากโทเคน `-ink` ของบทบาทนั้น ไม่ใช่ `text-white` ตายตัว */
const SOLID: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-ink)] hover:bg-[var(--btn-primary-bg-hover)]',
  secondary:
    'bg-[var(--btn-secondary-bg)] text-[var(--btn-secondary-ink)] hover:bg-[var(--btn-secondary-bg-hover)]',
  danger:
    'bg-[var(--btn-danger-bg)] text-[var(--btn-danger-ink)] hover:bg-[var(--btn-danger-bg-hover)]',
  warning:
    'bg-[var(--btn-warning-bg)] text-[var(--btn-warning-ink)] hover:bg-[var(--btn-warning-bg-hover)]',
  neutral: 'bg-card text-slate-700 border border-slate-300 hover:bg-slate-50',
};

/** พื้นอ่อน + เส้นขอบ — ระดับ 50/200/700 ของจานสถานะ ซึ่งสลับตามธีมให้เองอยู่แล้ว */
const SOFT: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--brand-soft)] text-[var(--brand-fg)] border border-[var(--brand-border)] hover:bg-[var(--brand-soft-strong)]',
  secondary: 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100',
  danger: 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100',
  warning: 'bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100',
  neutral: 'bg-card text-slate-700 border border-slate-200 hover:bg-slate-50',
};

/** สถานะกดไม่ได้ — เหมือนกันทุกบทบาทโดยตั้งใจ ดูเหตุผลที่หัวไฟล์ */
const DISABLED = 'disabled:bg-slate-100 disabled:text-slate-500 disabled:border-slate-200 disabled:cursor-not-allowed';

const SIZE = {
  sm: 'text-xs font-semibold px-3 py-2 rounded-lg gap-1.5',
  md: 'text-sm font-semibold px-4 py-2.5 rounded-xl gap-2',
} as const;

const ICON = { sm: 'w-3.5 h-3.5', md: 'w-4 h-4' } as const;

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
  // `border border-transparent` ค้างไว้เสมอ ไม่ใช่เฉพาะ tone ที่มีขอบ — ไม่งั้นปุ่มสองแบบ
  // ที่วางเรียงกันจะสูงไม่เท่ากัน 2px แล้วแถวปุ่มดูเบี้ยวโดยไม่รู้สาเหตุ
  return (
    <button
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center border border-transparent leading-tight transition-colors ${SIZE[size]} ${palette} ${DISABLED} ${className}`}
      {...rest}
    >
      {busy ? <Loader2 className={`${ICON[size]} shrink-0 animate-spin`} /> : Icon ? <Icon className={`${ICON[size]} shrink-0`} /> : null}
      {children}
    </button>
  );
};
