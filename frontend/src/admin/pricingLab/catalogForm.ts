import type { BhForm, CatalogFamilySpec } from './types';

// แยกจาก CatalogTemplate.tsx เพราะไฟล์คอมโพเนนต์ export ได้แต่คอมโพเนนต์ (react-refresh/only-export-components)

/** ค่าเริ่มต้นเมื่อสลับรุ่น — ท่อนที่รุ่นใหม่มีเหมือนกันใช้ค่าเดิม ที่เหลือใช้ขนาดกลาง ๆ ให้คิดราคาได้ทันที */
export function formForFamily(spec: CatalogFamilySpec, prev?: BhForm): BhForm {
  const keep = (slot: 'term' | 'mat' | 'conn') => {
    const v = prev?.[slot];
    return v && spec.slots[slot]?.options?.some((o) => o.code === v) ? v : undefined;
  };
  return {
    family: spec.family,
    ...(spec.shapes ? { shape: '', w: prev?.w ?? 100, l: prev?.l ?? 300 } : { id: prev?.id ?? 100, h: prev?.h ?? 50 }),
    volt: prev?.volt ?? '220',
    watt: prev?.watt ?? 1000,
    term: keep('term'),
    amp: keep('term') === 'T' ? prev?.amp : undefined,
    mat: keep('mat'),
    conn: keep('conn'),
    extras: [],
  };
}

