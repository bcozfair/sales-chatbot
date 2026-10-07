import type { BhForm, CatalogFamilySpec, SizeKey, TsFamilySpec, TsForm } from './types';

// แยกจาก CatalogTemplate.tsx เพราะไฟล์คอมโพเนนต์ export ได้แต่คอมโพเนนต์ (react-refresh/only-export-components)

/**
 * ค่าเริ่มต้นเมื่อสลับรุ่น — ท่อนที่รุ่นใหม่มีเหมือนกันใช้ค่าเดิม **ที่เหลือว่าง** (เจ้าของ 2026-10-07: "เริ่มด้วยค่าว่าง" —
 * เดิมเติม 100 / 50 / 1000 / 220 ให้เองแล้วคิดราคาทันที ซึ่งเป็นราคาของขนาดที่ไม่มีใครสั่ง) · ผู้เรียกคิดราคาเมื่อขนาดครบ (`bhSizeMissing`)
 */
export function formForFamily(spec: CatalogFamilySpec, prev?: BhForm): BhForm {
  const keep = (slot: 'term' | 'mat' | 'conn') => {
    const v = prev?.[slot];
    return v && spec.slots[slot]?.options?.some((o) => o.code === v) ? v : undefined;
  };
  return {
    family: spec.family,
    ...(spec.shapes ? { shape: '', w: prev?.w, l: prev?.l } : { id: prev?.id, h: prev?.h }),
    volt: prev?.volt ?? '',
    watt: prev?.watt,
    term: keep('term'),
    amp: keep('term') === 'T' ? prev?.amp : undefined,
    addons: prev?.addons?.filter((a) => spec.addons?.some((o) => o.code === a)),
    holes: spec.holes ? prev?.holes : undefined,
    mat: keep('mat'),
    conn: keep('conn'),
    extras: [],
  };
}


/**
 * ช่องขนาดของ BH ที่ยังว่าง (ตามรูปทรงที่เลือก) — ว่าง = ยังไม่คิดราคา แต่บอกว่าต้องกรอกอะไร (หน้าว่างของ mockup `pricing-calc-redesign`)
 * ราคาของ BH ขึ้นกับขนาดเท่านั้น (แรงดัน/กำลังไฟไม่มีผลกับราคา · วัด 2026-10-07) ⇒ ครบแค่ขนาดก็คิดได้
 * BH-02 ที่ยังไม่เลือกรูปทรง = ขนาดของรูปทรงสี่เหลี่ยม (`''`) ตามแคตตาล็อก
 */
export function bhSizeMissing(spec: CatalogFamilySpec, form: BhForm): string[] {
  if (form.sizeText !== undefined) return [];
  const dims: SizeKey[] = spec.shapes ? spec.shapes.find((s) => s.code === (form.shape ?? ''))?.dims ?? [] : ['id', 'h'];
  return dims.filter((d) => form[d] === undefined).map((d) => spec.slots[d]?.label ?? d);
}

/**
 * ค่าเริ่มต้นเมื่อสลับไปตาราง TS — ค่าตั้งต้นของตารางนั้น (รหัสจริงที่พบบ่อย) แล้วยกช่องที่ตารางใหม่มีตัวเลือกเดียวกันมาจากค่าเดิม
 * **ช่องตัวเลขเริ่มว่าง** (2026-10-07 · "เริ่มด้วยค่าว่าง") — ช่องว่างของ TS = ค่ามาตรฐานของแคตตาล็อกที่โชว์จาง ๆ ในช่องอยู่แล้ว
 * (เปลี่ยน TS_-04 → TS_-06 แล้วชนิด Sensor/เกลียว/แกน/ความยาวไม่หาย) · ของนอกรหัส (บวกเพิ่ม) ยกมาเฉพาะที่ตารางใหม่มี
 */
export function tsFormForFamily(spec: TsFamilySpec, prev?: { values?: Record<string, string>; addons?: string[]; clUnit?: 'cm' | 'mm' }): TsForm {
  const values: Record<string, string> = Object.fromEntries(
    Object.entries(spec.defaults).map(([k, v]) => [k, spec.slots[k]?.kind === 'number' ? '' : v]),
  );
  const keep = (key: string) => {
    const v = prev?.values?.[key];
    const slot = spec.slots[key];
    if (v === undefined || !slot) return;
    // ความยาวสายที่เขียนเป็น cm/mm ไม่ยกไป — ตารางใหม่เริ่มที่หน่วย M ของแคตตาล็อก (30 cm ไม่ใช่ 30 M)
    if (slot.kind === 'number') { if (v && !(key === 'cl' && prev?.clUnit)) values[key] = v; return; }
    const opts = slot.optionsByProbe ? slot.optionsByProbe[values.probe ?? 'TS'] ?? [] : slot.options ?? [];
    if (opts.some((o) => o.code === v)) values[key] = v;
  };
  for (const key of ['probe', ...Object.keys(spec.slots).filter((k) => k !== 'probe')]) keep(key);
  const addons = prev?.addons?.filter((a) => spec.addons?.some((o) => o.code === a));
  return { family: spec.family, values, ...(addons?.length ? { addons } : {}) };
}
