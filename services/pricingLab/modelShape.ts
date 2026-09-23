// ─────────────────────────────────────────────────────────────────────────────
//  ด่านรูปของรุ่นหนึ่งรุ่นที่ประตูเก็บ — "สิ่งนี้เป็น PriceModel จริงไหม"
//
//  โมดูล "คิดราคาสินค้า" — ถอดออกได้ทั้งก้อน ดู services/pricingLab/README.md
//
//  มีเพราะสมุดราคาย้ายเข้าฐานแล้ว (docs/plan-pricebook-db.md §6.5) — คอลัมน์ json รับอะไรก็ได้
//  ⇒ ถ้าไม่ตรวจตอนอ่านด้วย แถวที่ใครแก้มือใน psql จะไหลเข้า engine แล้วราคาเพี้ยนเงียบ ๆ
//  (เหตุผลเดียวกับ `clean()` ของรหัสย่อยใน db/pricingLabRepo.ts)
//
//  **ตรวจเฉพาะรูป ไม่ตรวจกติกาธุรกิจ** — ช่วงทับกัน / ของแถมติดลบ / แกนที่ไม่มีคำไทย ยังอยู่ที่
//  `modelEditor.ts` · `scripts/pricebook/sheet.ts` ที่เดียว (ตัวตรวจของแต่ละทางเข้า) · ถ้าย้ายมาไว้ที่นี่
//  จะมีสองที่ที่ตัดสินเรื่องเดียวกัน และวันหนึ่งจะตอบไม่ตรงกัน
//
//  ⚠️ ไฟล์นี้คือ "คนที่สองที่รู้ไวยากรณ์ Predicate" ต่อจากตัวประเมินใน engine — และรับ `all`/`any`/`not`
//     **ต่างจาก `readWhen()` ของหน้าแก้ราคาโดยตั้งใจ** (หน้าจอสร้างเงื่อนไขพวกนั้นไม่ได้ แต่รุ่นที่มาจาก
//     Excel มีอยู่จริง) · ด่าน `diag:pricing-db` ข้อ 12 พิสูจน์ว่ารับทุกรุ่นของเล่มจริงโดยไม่ปฏิเสธผิด
//     ⇒ เพิ่มรูปใหม่ใน `types.ts` เมื่อไหร่ ต้องเพิ่มที่นี่ด้วย ไม่งั้นรุ่นนั้นจะถูกข้ามตอนโหลด
//  ช่องที่ไม่รู้จักถูกปล่อยผ่านโดยตั้งใจ — engine ไม่อ่านมันอยู่แล้ว และการปฏิเสธจะทำให้ช่องใหม่ที่เพิ่ม
//  ใน `types.ts` ทีหลังกลายเป็นเหตุให้ทั้งรุ่นหายจากจอ
// ─────────────────────────────────────────────────────────────────────────────

/** ชนิดโครงสร้างที่ประตูเก็บรู้จัก — รุ่นที่ `schema_version` ไม่ตรงถูกข้ามตอนโหลด ไม่ป้อนเข้า engine */
export const PRICE_MODEL_SCHEMA_VERSION = 1;

const BASE_KINDS = ['matrix', 'banded', 'ref'];
const ADDER_KINDS = ['flat', 'percent', 'perUnit'];
const LEVELS = ['block', 'quoteOnRequest', 'warn'];
const FORMULAS = ['sum', 'cylinderAreaIn2'];
const ROUNDS = ['ceil', 'floor', 'exact'];

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

class Problems {
  readonly list: string[] = [];
  add(path: string, what: string): void {
    // รุ่นที่เสียทั้งก้อนผลิตปัญหาได้เป็นร้อย — เก็บแค่พอให้คนอ่านรู้ว่าต้องไปดูตรงไหน
    if (this.list.length < 20) this.list.push(`${path}: ${what}`);
  }
  str(o: Obj, key: string, path: string, required = false): void {
    if (o[key] === undefined) { if (required) this.add(`${path}.${key}`, 'ต้องมี'); return; }
    if (typeof o[key] !== 'string') this.add(`${path}.${key}`, 'ต้องเป็นข้อความ');
  }
  num(o: Obj, key: string, path: string, required = false): void {
    if (o[key] === undefined) { if (required) this.add(`${path}.${key}`, 'ต้องมี'); return; }
    if (!isNum(o[key])) this.add(`${path}.${key}`, 'ต้องเป็นตัวเลขจริง');
  }
  bool(o: Obj, key: string, path: string): void {
    if (o[key] !== undefined && typeof o[key] !== 'boolean') this.add(`${path}.${key}`, 'ต้องเป็น true/false');
  }
  oneOf(o: Obj, key: string, allowed: string[], path: string, required = false): void {
    if (o[key] === undefined) { if (required) this.add(`${path}.${key}`, 'ต้องมี'); return; }
    if (typeof o[key] !== 'string' || !allowed.includes(o[key] as string)) {
      this.add(`${path}.${key}`, `ต้องเป็นหนึ่งใน ${allowed.join('/')}`);
    }
  }
  numMap(o: Obj, key: string, path: string, required = false): void {
    const v = o[key];
    if (v === undefined) { if (required) this.add(`${path}.${key}`, 'ต้องมี'); return; }
    if (!isObj(v)) { this.add(`${path}.${key}`, 'ต้องเป็นตาราง ชื่อ → ตัวเลข'); return; }
    for (const [k, x] of Object.entries(v)) if (!isNum(x)) this.add(`${path}.${key}[${k}]`, 'ต้องเป็นตัวเลขจริง');
  }
  strMap(o: Obj, key: string, path: string): void {
    const v = o[key];
    if (v === undefined) return;
    if (!isObj(v)) { this.add(`${path}.${key}`, 'ต้องเป็นตาราง ชื่อ → ข้อความ'); return; }
    for (const [k, x] of Object.entries(v)) if (typeof x !== 'string') this.add(`${path}.${key}[${k}]`, 'ต้องเป็นข้อความ');
  }
  strArr(o: Obj, key: string, path: string, required = false): void {
    if (o[key] === undefined) { if (required) this.add(`${path}.${key}`, 'ต้องมี'); return; }
    if (!isStrArr(o[key])) this.add(`${path}.${key}`, 'ต้องเป็นรายการข้อความ');
  }
}

/** ไวยากรณ์ของ `Predicate` ใน types.ts ทุกแบบ — ลึกเกิน 20 ชั้นถือว่าเสีย (กันวงวนจากข้อมูลมั่ว) */
function checkPredicate(p: unknown, path: string, out: Problems, depth = 0): void {
  if (depth > 20) { out.add(path, 'เงื่อนไขซ้อนลึกเกินไป'); return; }
  if (!isObj(p)) { out.add(path, 'เงื่อนไขต้องเป็น object'); return; }
  if ('always' in p) { if (p.always !== true) out.add(`${path}.always`, 'ต้องเป็น true'); return; }
  if ('all' in p || 'any' in p) {
    const key = 'all' in p ? 'all' : 'any';
    const list = p[key];
    if (!Array.isArray(list)) { out.add(`${path}.${key}`, 'ต้องเป็นรายการเงื่อนไข'); return; }
    list.forEach((q, i) => checkPredicate(q, `${path}.${key}[${i}]`, out, depth + 1));
    return;
  }
  if ('not' in p) { checkPredicate(p.not, `${path}.not`, out, depth + 1); return; }
  if ('option' in p) { out.str(p, 'option', path, true); return; }
  if ('axis' in p) {
    out.str(p, 'axis', path, true);
    const hasIn = p.in !== undefined;
    const hasNotIn = p.notIn !== undefined;
    if (hasIn === hasNotIn) { out.add(path, 'เงื่อนไขแกนต้องมี in หรือ notIn อย่างใดอย่างหนึ่ง'); return; }
    out.strArr(p, hasIn ? 'in' : 'notIn', path, true);
    return;
  }
  if ('dim' in p) {
    out.str(p, 'dim', path, true);
    for (const k of ['gt', 'gte', 'lt', 'lte']) out.num(p, k, path);
    return;
  }
  out.add(path, 'ไม่รู้จักรูปเงื่อนไขนี้');
}

function checkBase(b: unknown, out: Problems): void {
  if (!isObj(b)) { out.add('base', 'ต้องมี'); return; }
  out.oneOf(b, 'kind', BASE_KINDS, 'base', true);
  if (b.kind === 'matrix') {
    out.strArr(b, 'axes', 'base', true);
    out.numMap(b, 'cells', 'base', true);
  } else if (b.kind === 'banded') {
    out.str(b, 'quantity', 'base', true);
    if (!Array.isArray(b.bands)) { out.add('base.bands', 'ต้องเป็นรายการ'); return; }
    b.bands.forEach((band, i) => {
      const path = `base.bands[${i}]`;
      if (!isObj(band)) { out.add(path, 'ต้องเป็น object'); return; }
      out.num(band, 'min', path, true);
      if (band.max !== null) out.num(band, 'max', path, true);
      out.num(band, 'flat', path);
      out.num(band, 'rate', path);
      out.str(band, 'label', path);
    });
  } else if (b.kind === 'ref') {
    out.str(b, 'model', 'base', true);
  }
}

function checkAdder(a: unknown, path: string, out: Problems): void {
  if (!isObj(a)) { out.add(path, 'ต้องเป็น object'); return; }
  out.str(a, 'id', path, true);
  out.str(a, 'label', path, true);
  out.num(a, 'order', path, true);
  out.oneOf(a, 'kind', ADDER_KINDS, path, true);
  if (a.when !== undefined) checkPredicate(a.when, `${path}.when`, out);
  for (const k of ['amount', 'percent', 'over', 'step', 'times', 'rate']) out.num(a, k, path);
  for (const k of ['dim', 'byAxis', 'unit', 'source', 'note']) out.str(a, k, path);
  out.oneOf(a, 'round', ROUNDS, path);
  out.numMap(a, 'rates', path);
  for (const k of ['skipIfNoRate', 'disabled', 'custom']) out.bool(a, k, path);
}

function checkConstraint(c: unknown, path: string, out: Problems): void {
  if (!isObj(c)) { out.add(path, 'ต้องเป็น object'); return; }
  out.str(c, 'id', path, true);
  checkPredicate(c.when, `${path}.when`, out);
  out.oneOf(c, 'level', LEVELS, path, true);
  out.str(c, 'message', path, true);
  for (const k of ['source', 'note']) out.str(c, k, path);
  for (const k of ['disabled', 'custom']) out.bool(c, k, path);
}

function checkDerived(d: unknown, path: string, out: Problems): void {
  if (!isObj(d)) { out.add(path, 'ต้องเป็น object'); return; }
  out.str(d, 'name', path, true);
  out.str(d, 'label', path, true);
  out.oneOf(d, 'formula', FORMULAS, path, true);
  out.strArr(d, 'args', path, true);
  out.numMap(d, 'consts', path);
  out.oneOf(d, 'round', ROUNDS, path);
}

function checkVariant(v: unknown, out: Problems): void {
  if (!isObj(v)) { out.add('variant', 'ต้องเป็น object'); return; }
  out.str(v, 'suffix', 'variant', true);
  out.str(v, 'label', 'variant', true);
  out.num(v, 'percent', 'variant');
  out.num(v, 'order', 'variant');
  out.numMap(v, 'adderPrices', 'variant');
  for (const k of ['disabled', 'confirmed', 'custom']) out.bool(v, k, 'variant');
  for (const k of ['source', 'note', 'by', 'at']) out.str(v, k, 'variant');
}

function checkUniqueIds(list: unknown[], path: string, out: Problems): void {
  const seen = new Set<string>();
  for (const x of list) {
    const id = isObj(x) && typeof x.id === 'string' ? x.id : undefined;
    if (id === undefined) continue;
    if (seen.has(id)) out.add(path, `id "${id}" ซ้ำกันในรุ่นเดียว`);
    seen.add(id);
  }
}

/**
 * คืนรายการปัญหา — ว่าง = ใช้ได้ · `code` คือคีย์ที่รุ่นนี้จะถูกเก็บไว้ (ต้องตรงกับ `spec.code`
 * เพราะ engine หา `book.models[code]` แล้วเชื่อ `.code` ข้างในต่อ)
 */
export function checkPriceModel(spec: unknown, code?: string): string[] {
  const out = new Problems();
  if (!isObj(spec)) return ['สเปกของรุ่นต้องเป็น object'];

  out.str(spec, 'code', 'code', true);
  if (typeof spec.code === 'string' && !spec.code.trim()) out.add('code', 'ว่างไม่ได้');
  if (code !== undefined && spec.code !== code) out.add('code', `ไม่ตรงกับคีย์ของรุ่น (${code})`);
  out.str(spec, 'label', 'label', true);
  out.str(spec, 'sheet', 'sheet');
  out.strArr(spec, 'aliases', 'aliases');
  out.numMap(spec, 'standard', 'standard', true);
  out.strMap(spec, 'axisDefaults', 'axisDefaults');
  if (spec.importStats !== undefined && !isObj(spec.importStats)) out.add('importStats', 'ต้องเป็น object');

  if (spec.derivedDims !== undefined) {
    if (!Array.isArray(spec.derivedDims)) out.add('derivedDims', 'ต้องเป็นรายการ');
    else spec.derivedDims.forEach((d, i) => checkDerived(d, `derivedDims[${i}]`, out));
  }

  checkBase(spec.base, out);

  if (!Array.isArray(spec.adders)) out.add('adders', 'ต้องเป็นรายการ');
  else {
    spec.adders.forEach((a, i) => checkAdder(a, `adders[${i}]`, out));
    checkUniqueIds(spec.adders, 'adders', out);
  }

  if (!Array.isArray(spec.constraints)) out.add('constraints', 'ต้องเป็นรายการ');
  else {
    spec.constraints.forEach((c, i) => checkConstraint(c, `constraints[${i}]`, out));
    checkUniqueIds(spec.constraints, 'constraints', out);
  }

  if (spec.variant !== undefined) checkVariant(spec.variant, out);

  return out.list;
}
