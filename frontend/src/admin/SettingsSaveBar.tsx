import React from 'react';
import { AlertTriangle, CheckCircle2, Save, RotateCcw } from 'lucide-react';
import { Button } from './Button';

// ─────────────────────────────────────────────────────────────────────────────
//  ท้ายฟอร์มตั้งค่าที่ "แก้แล้วกดบันทึก" — แถบสถานะ + แถบปุ่ม
//
//  ที่มา: CreditPolicy.tsx กับ ShippingFee.tsx ถือโค้ดก้อนนี้คนละสำเนา ยาว 42 บรรทัด
//  และเหมือนกัน **ทุกตัวอักษร** ต่างกันแค่ชื่อตัวแปรที่ส่งให้ปุ่มย้อนกลับ (policy / config)
//  สำเนาไม่เคยพังตอนที่ก๊อป มันพังตอนที่ตัวจริงถูกปรับปรุงแล้วสำเนาไม่ได้ตามไป
//  — เช่นวันที่มีคนเปลี่ยนคำว่า "ยังไม่ได้บันทึก" หรือแก้สีเตือน แล้วแก้ไปหน้าเดียว
//
//  ⚠️ ทำไมเป็น 2 component ไม่ใช่ตัวเดียว: ในหน้าจริง แถบสถานะอยู่ **ในตัวการ์ด**
//     ส่วนแถบปุ่มอยู่ **นอกการ์ด** (ติดขอบล่าง) มี `</div>` ของการ์ดคั่นกลาง
//     component เดียวจึงครอบทั้งก้อนไม่ได้ — ไม่ใช่การแบ่งเพื่อความสวยงาม
//
//  ⚠️ ประโยค "มีผลกับใบที่บันทึก/ยืนยันหลังจากนี้ทันที" เคยฝังตายไว้ในนี้เพราะผู้ใช้สองราย
//     แรกพูดประโยคเดียวกันจริง ๆ · **วันนั้นมาถึงแล้ว (2026-09-18)**: หน้า "สิทธิ์ตามบทบาท"
//     เปลี่ยนทั้งเมนูและด่านของ API ไม่ใช่แค่ใบ ⇒ กลายเป็น prop `effect` ที่มีค่าเริ่มต้นเป็น
//     ประโยคเดิม สองหน้าแรกจึงไม่ต้องแก้อะไรเลย
//     (สิ่งที่ห้ามทำคือก๊อปไฟล์นี้ไปแก้ประโยค ซึ่งพาเรากลับไปที่เดิม)
// ─────────────────────────────────────────────────────────────────────────────

interface StatusProps {
  /** ข้อความ error — ว่าง = ไม่มี */
  error: string;
  /** เวลาที่บันทึกสำเร็จล่าสุด (จัดรูปแบบมาแล้ว) — ว่าง = ยังไม่เคยบันทึกในรอบนี้ */
  savedAt: string;
  /** มีการแก้ที่ยังไม่ได้บันทึกไหม — ใช้ซ่อนข้อความ "บันทึกแล้ว" ที่ล้าสมัยไปแล้ว */
  isDirty: boolean;
  /** ท้ายประโยค "บันทึกแล้วเมื่อ … —" · ไม่ส่ง = ประโยคของหน้าตั้งค่าที่มีผลกับใบ */
  effect?: string;
}

/** แถบสถานะท้ายเนื้อการ์ด — error และ "บันทึกแล้วเมื่อ …" */
export const SettingsStatus: React.FC<StatusProps> = ({
  error,
  savedAt,
  isDirty,
  effect = 'มีผลกับใบที่บันทึก/ยืนยันหลังจากนี้ทันที',
}) => (
  <>
    {error && (
      <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    )}
    {savedAt && !isDirty && (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span>บันทึกแล้วเมื่อ {savedAt} — {effect}</span>
      </div>
    )}
  </>
);

interface SaveBarProps {
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  /** คืนฟอร์มกลับเป็นค่าที่โหลดมา — หน้าเป็นคนรู้ว่า "ค่าที่โหลดมา" คืออะไร */
  onReset: () => void;
}

/** แถบปุ่มติดขอบล่างการ์ด — ป้ายเตือนยังไม่บันทึก + บันทึก + ย้อนกลับ */
export const SettingsSaveBar: React.FC<SaveBarProps> = ({ isDirty, isSaving, onSave, onReset }) => (
  <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-3.5 py-3">
    {isDirty && (
      <span className="mr-auto text-xs font-bold text-amber-600">⚠️ ยังไม่ได้บันทึก</span>
    )}
    <Button variant="primary" type="button" icon={Save} busy={isSaving} onClick={onSave} disabled={!isDirty}>
      บันทึก
    </Button>
    <Button type="button" icon={RotateCcw} onClick={onReset} disabled={!isDirty || isSaving}>
      ย้อนกลับ
    </Button>
  </div>
);
