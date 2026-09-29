import type { BhForm, CatalogFamilySpec, TsFamilySpec, TsForm } from './types';

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
    addons: prev?.addons?.filter((a) => spec.addons?.some((o) => o.code === a)),
    mat: keep('mat'),
    conn: keep('conn'),
    extras: [],
  };
}


/**
 * ค่าเริ่มต้นเมื่อสลับไปตาราง TS — ค่าตั้งต้นของตารางนั้น (รหัสจริงที่พบบ่อย) แล้วยกช่องที่ตารางใหม่มีตัวเลือกเดียวกันมาจากค่าเดิม
 * (เปลี่ยน TS_-04 → TS_-06 แล้วชนิด Sensor/เกลียว/แกน/ความยาวไม่หาย) · ของนอกรหัส (บวกเพิ่ม) ยกมาเฉพาะที่ตารางใหม่มี
 */
export function tsFormForFamily(spec: TsFamilySpec, prev?: { values?: Record<string, string>; addons?: string[] }): TsForm {
  const values: Record<string, string> = { ...spec.defaults };
  const keep = (key: string) => {
    const v = prev?.values?.[key];
    const slot = spec.slots[key];
    if (v === undefined || !slot) return;
    if (slot.kind === 'number') { if (v) values[key] = v; return; }
    const opts = slot.optionsByProbe ? slot.optionsByProbe[values.probe ?? 'TS'] ?? [] : slot.options ?? [];
    if (opts.some((o) => o.code === v)) values[key] = v;
  };
  for (const key of ['probe', ...Object.keys(spec.slots).filter((k) => k !== 'probe')]) keep(key);
  const addons = prev?.addons?.filter((a) => spec.addons?.some((o) => o.code === a));
  return { family: spec.family, values, ...(addons?.length ? { addons } : {}) };
}
