// ─────────────────────────────────────────────────────────────────────────────
//  ชนิดข้อมูลของโมดูล "แบบ 3 มิติ" — ดู services/drawing/README.md · docs/plan-product-drawing-3d.md
//
//  **ไฟล์นี้ไม่ import อะไรเลย** — โมดูลแบบรู้จักโลกภายนอกผ่าน type ที่ประกาศเองตรงนี้เท่านั้น
//  (ผลอ่านรหัสของหน้าคำนวณราคา = `PricingReading` · ไม่ import services/pricingLab)
//  ⇒ ถอดโมดูลคิดราคาออก โมดูลนี้ยัง typecheck ผ่าน · เปลี่ยนชื่อช่องฝั่งคิดราคา ด่าน
//  `diag:drawing-coverage` จับได้ด้วยตัวยืนยัน keyof สองทาง (ไม่ใช่ที่ไฟล์นี้)
//
//  **ทำไมตัวสร้างรูปทรงใช้ `number[]` ไม่ใช่ tuple:** พอร์ตจาก JS ของ Appsale ทีละบรรทัด
//  การ cast เป็น tuple ชวนให้เขียนนิพจน์ใหม่ ซึ่งอาจสลับลำดับการคำนวณแล้วบิตทศนิยมเปลี่ยน
//  (ด่าน `diag:drawing-port` เทียบทุกบิต) · type ของ "ข้อมูลที่ส่งออก" (Part) จึงเป็น array ธรรมดา
// ─────────────────────────────────────────────────────────────────────────────

/** สี RGB 0–1 ตามที่ Appsale ใช้ (sRGB · ไม่ใช่สีจริงของสินค้า — แยกวัสดุให้ดูออกใน CAD) */
export type Colour = readonly [number, number, number];

/** หนึ่งชิ้นของโมเดล — solid ปิด หน่วย mm · ข้อมูลล้วน ไม่มีเมธอด */
export interface Part {
  name: string;
  colour: Colour;
  /** x y z ต่อจุด */
  positions: number[];
  /** normal ต่อจุด (ยาว 1) — ภาพบนจอและ GLB ใช้ · STEP คิด normal จากลำดับจุดเอง */
  normals: number[];
  /** สามเหลี่ยม (index ของจุด ทีละ 3) */
  triangles: number[];
  /** เส้นขอบสำหรับภาพลายเส้น — คู่จุด x y z ต่อเส้น */
  edges: number[];
}

/** ชิ้นสำหรับเขียน STEP — จุดที่ซ้ำกันถูกรวมแล้ว (BH) หรือชิ้นเดิม (TS) */
export interface StepSolid {
  name: string;
  colour: Colour;
  positions: number[];
  triangles: number[];
}

/** โมเดลชุดเดียวของหนึ่งสินค้า — GLB ใช้ `parts` · STEP ใช้ `solids` */
export interface DrawingModel {
  parts: Part[];
  /** TS: ชิ้นเดียวกับ `parts` · BH: `weldSolid(parts)` (แบบที่ Appsale ส่งออก STEP) */
  solids: StepSolid[];
}

// ── พารามิเตอร์ของแบบ ต่อตระกูล ─────────────────────────────────────────────

/**
 * TS_-11 (แคตตาล็อก TS-SERIES หน้า 15) — ช่องตามแคตตาล็อก · `'NONE'` = None ของแคตตาล็อก
 * ค่ามาจากผลอ่านของหน้าคำนวณราคาเท่านั้น (`spec/fromReading.ts`) — **ไม่มีค่าเริ่มต้น**
 */
export interface Ts11Spec {
  family: 'TS_-11';
  /** ชนิดหัววัด + Sensor ต่อกัน (TS + K = TSK · N + 10 = N10) — กำหนดจำนวนสาย */
  sensor: 'TSK' | 'TSJ' | 'TST' | 'TSP' | 'TSPA' | 'TSZ' | 'N2' | 'N10' | 'P2' | 'P10';
  /** `NONE` = with Spring · `P` = None Spring */
  spring: 'NONE' | 'P';
  /** ขนาดแกน D1 (mm) ตามที่เขียน เช่น `'3.2'` — เก็บเป็นข้อความแบบแคตตาล็อก */
  dia: string;
  /** วัสดุแกน — ไม่มีผลกับรูปทรง */
  mat: 'NONE' | 'A' | 'T' | 'TN' | 'AT';
  /** ความยาวแกน L1 (mm) */
  tubeLen: number;
  /** จำนวน Element — ไม่มีผลกับรูปทรง */
  elem: 'NONE' | '2';
  /** ความยาวสาย (เมตร) · `null` = รหัสไม่ได้บอก — ไม่มีผลกับรูปทรง (สายวาดย่อ 120 mm) */
  cableLen: number | null;
  /** ชนิดสาย — กำหนดสีปลอก · `NONE` = สแตนเลสถัก */
  cable: 'NONE' | 'P' | 'T' | 'TS';
  /** `NONE` = Ground · `U` = Unground — ไม่มีผลกับรูปทรง */
  ground: 'NONE' | 'U';
}

/** union ของทุกตระกูลที่มีแบบ — เพิ่มตระกูล = เพิ่มที่นี่ แล้ว registry บังคับให้ลงทะเบียน */
export type DrawingSpec = Ts11Spec;

/** หนึ่งตระกูลของแบบ */
export interface DrawingFamily<S extends DrawingSpec> {
  id: S['family'];
  /** ที่มาของรูปทรง — หน้าแคตตาล็อก + ไฟล์ของ Appsale ที่พอร์ตมา (คอมมิตอยู่ใน README) */
  source: { catalog: string; appsale: string[] };
  model(spec: S): DrawingModel;
}
