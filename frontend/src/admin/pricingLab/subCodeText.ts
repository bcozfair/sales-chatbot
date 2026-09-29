import { subCodePending, type ModelBrief, type SubCode } from './types';

/**
 * คำบนจอของ "รหัสย่อย" ในหน้าชีต (`SheetSubCodes`) และหน้าแรกสมุดราคา (`SubCodeHome`) — แยกไฟล์เพราะสองที่
 * ต้องเล่าแถวเดียวกันด้วยประโยคเดียวกัน (เจ้าของเคาะ mockup `pricebook-subcodes-sheet` 2026-09-29)
 *
 * ทุกอย่างในไฟล์นี้ **แสดงผลอย่างเดียว** — ขอบเขตว่าแถวไหนมีผลกับรุ่นไหนมาจากเซิร์ฟเวอร์ (`SubCode.models`)
 * ไม่ได้คิดที่นี่ ไฟล์นี้แค่จัดกลุ่มและเขียนเป็นภาษาคน
 */

/** แถวที่ขอบเขตครอบหลายรุ่น (`BH-0*` · `*`) — แก้ที่หน้าแรกที่เดียว ในหน้าชีตอ่านอย่างเดียว (เจ้าของเคาะข้อ 4) */
export const isWide = (s: SubCode): boolean => {
  const scope = s.scope.trim();
  return scope === '' || scope.endsWith('*');
};

/** ประโยค "ทำอะไรกับราคา" แยกเป็นท่อน เพื่อให้หน้าจอทำตัวหนา/จางบางท่อนได้ */
export interface EffectText {
  lead: string;
  strong?: string;
  tail?: string;
  muted?: boolean;
  pending: boolean;
}

export interface Lookup {
  axisLabels: Record<string, string>;
  models: ModelBrief[];
}

const money = (n: number) => n.toLocaleString('en-US');

/** ชื่อกฎที่รหัสย่อยแบบ "เปิดกฎ" ชี้ไป — ของรุ่นแรกที่แถวนี้มีผล (ชื่อกฎมาจากสมุดราคา ไม่ใช่ราคา) */
function ruleLabel(s: SubCode, lk: Lookup): string {
  for (const code of s.models ?? []) {
    const hit = lk.models.find((m) => m.code === code)?.options?.find((o) => o.key === s.value);
    if (hit) return hit.label;
  }
  return s.value ?? '—';
}

export function effectText(s: SubCode, lk: Lookup): EffectText {
  const pending = subCodePending(s);
  const axis = lk.axisLabels[s.axis ?? ''] ?? s.axis ?? '';
  switch (s.effect) {
    case 'none':
      return { lead: 'ไม่มีผลกับราคา', muted: true, pending };
    case 'option':
      return { lead: 'บวกตามกฎ ', strong: `“${ruleLabel(s, lk)}”`, pending };
    case 'flat':
      return s.amount === undefined
        ? { lead: 'บวกเงินก้อนเดียว', pending }
        : { lead: 'บวก ', strong: `${money(s.amount)} บาท`, pending };
    case 'percent':
      return { lead: 'บวก ', strong: `${s.percent ?? 0}%`, pending };
    case 'basePrice':
      return { lead: 'ราคาตั้งต้นของตัวเอง ', strong: `${money(s.amount ?? 0)} บาท`, pending };
    case 'perUnit':
      return { lead: 'บวก ', strong: `${money(s.rate ?? 0)} บาท`, tail: ` ต่อหน่วยของ ${s.dim ?? '—'} ที่เกินมาตรฐาน`, pending };
    case 'setAxis':
      if (!s.value) return { lead: `ยังไม่ได้เลือกว่าคิดเท่า${axis}ไหน`, pending };
      if (s.axis === 'cable') return { lead: 'ใช้ราคา', strong: s.value, tail: ' (แถบราคาสายในชีต)', pending };
      return { lead: `คิดเท่า${axis} `, strong: s.value, pending };
  }
}

/** แถวบนจอหนึ่งแถว — อาจมาจากหลายแถวในฐานที่ความหมายเหมือนกันทุกช่อง (ชีตที่มีสองรุ่น · เจ้าของเคาะข้อ 1) */
export interface MergedRow {
  key: string;
  row: SubCode;
  /** แถวจริงทุกแถวที่รวมอยู่ — แก้/ปิด/ลบ ทำกับทุกแถวในนี้ */
  members: SubCode[];
  /** รุ่นในชีตที่แถวนี้มีผล */
  models: string[];
}

/** ช่องที่ต้องเท่ากันทุกช่องถึงจะรวม — ราคาต่างกันแม้บาทเดียวต้องแยกแถว */
const meaning = (s: SubCode) => JSON.stringify([
  s.subCode.toUpperCase(), s.match, s.reads, s.effect, s.amount, s.percent, s.dim, s.rate, s.axis, s.value,
  !!s.disabled, s.id === undefined, isWide(s) ? s.scope : '',
]);

export function mergeRows(rows: SubCode[], inSheet: string[]): MergedRow[] {
  const map = new Map<string, MergedRow>();
  for (const s of rows) {
    const k = meaning(s);
    let m = map.get(k);
    if (!m) map.set(k, (m = { key: k, row: s, members: [], models: [] }));
    m.members.push(s);
    for (const code of s.models ?? []) if (inSheet.includes(code) && !m.models.includes(code)) m.models.push(code);
  }
  return [...map.values()];
}

/** กลุ่มตามช่องในรหัส — ลำดับเดียวกับที่รหัสเขียน (สาย → Ground → หัว → Element → เกลียว → วัสดุ → หน้าแปลน) */
const GROUPS: { key: string; label: string; test: (s: SubCode) => boolean }[] = [
  { key: 'cable', label: 'ชนิดสาย', test: (s) => s.effect === 'setAxis' && s.axis === 'cable' },
  { key: 'ground', label: 'Ground', test: (s) => /ground/i.test(s.reads) },
  { key: 'head', label: 'หัวกระโหลก', test: (s) => /หัวกระโหลก/.test(s.reads) },
  { key: 'elem', label: 'Element', test: (s) => /element/i.test(s.reads) },
  { key: 'thread', label: 'เกลียว', test: (s) => s.effect === 'setAxis' && s.axis === 'thread' },
  { key: 'mat', label: 'วัสดุ', test: (s) => /วัสดุ/.test(s.reads) },
  { key: 'flange', label: 'หน้าแปลน', test: (s) => s.effect === 'setAxis' && s.axis === 'flange' },
];

export function groupRows(rows: MergedRow[], axisLabels: Record<string, string>): { key: string; label: string; rows: MergedRow[] }[] {
  const out = new Map<string, { key: string; label: string; rows: MergedRow[] }>();
  for (const g of GROUPS) out.set(g.key, { key: g.key, label: g.label, rows: [] });
  const other: MergedRow[] = [];
  for (const r of rows) {
    const g = GROUPS.find((x) => x.test(r.row));
    if (g) { out.get(g.key)!.rows.push(r); continue; }
    // ช่องอื่นที่ตั้งค่าให้ (ขนาดแกน · ชนิดเซนเซอร์) ได้กลุ่มตามชื่อช่อง
    if (r.row.effect === 'setAxis' && r.row.axis) {
      const k = `axis:${r.row.axis}`;
      if (!out.has(k)) out.set(k, { key: k, label: axisLabels[r.row.axis] ?? r.row.axis, rows: [] });
      out.get(k)!.rows.push(r);
      continue;
    }
    other.push(r);
  }
  const list = [...out.values()].filter((g) => g.rows.length > 0);
  if (other.length) list.push({ key: 'other', label: 'อื่น ๆ', rows: other });
  for (const g of list) g.rows.sort((a, b) => a.row.subCode.localeCompare(b.row.subCode, 'en', { numeric: true }));
  return list;
}

/** ตรงกับที่ค้นไหม — `#` ของแม่แบบ = ตัวเลขหนึ่งหลัก (กติกาเดียวกับ `subCodeMatches` ฝั่ง backend) */
export function matchesQuery(s: SubCode, q: string): boolean {
  const want = q.trim().toUpperCase();
  if (!want) return false;
  if (s.match !== 'pattern') return s.subCode.toUpperCase() === want;
  const re = new RegExp(`^${s.subCode.toUpperCase().split('').map((c) => (c === '#' ? '[0-9]' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`);
  return re.test(want) || s.subCode.toUpperCase() === want;
}
