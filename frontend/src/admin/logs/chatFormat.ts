import {
  Check, CircleMinus, CircleX, Clock, Info, MessageSquare, Monitor,
  MousePointerClick, Repeat, Smile, Image as ImageIcon,
} from 'lucide-react';

/**
 * ชนิดข้อมูล + ตัวช่วยแสดงผลของ "ก้อนบทสนทนา" (ChatExchange.tsx) — แยกไฟล์เพราะไฟล์คอมโพเนนต์
 * export ได้แค่คอมโพเนนต์ (react-refresh) · รูปข้อมูลตรงกับ `ChatExchange` ของ services/chatLogService.ts
 * (คนละ tsconfig — แก้ฝั่ง server แล้วต้องแก้ที่นี่ด้วย)
 */

export type ChatDelivery =
  | 'sent' | 'failed' | 'pending' | 'none' | 'warned' | 'warn_failed' | 'web' | 'nodata';

export interface ChatReply {
  source: 'handler' | 'fill' | 'web';
  text: string;
  no_reply: boolean;
  at: string;
}

export interface ChatExchange {
  key: string;
  request_id: string;
  channel: 'line' | 'web';
  kind: 'text' | 'postback' | 'sticker' | 'image' | 'other' | 'event' | 'web';
  subtype: string | null;
  at: string;
  done_at: string | null;
  sender: { line_user_id: string | null; name: string | null; code: string | null; admin: string | null };
  redelivery: { count: number; action: string | null; delay_ms: number | null } | null;
  delivery: { status: ChatDelivery; problem: boolean; error: string | null };
  /** มีเฉพาะผู้ดูที่เป็น admin */
  content?: {
    in_text: string | null;
    raw: string | null;
    replies: ChatReply[];
    preview: string | null;
  };
}

export type IconT = typeof Check;

/** ผลการส่ง = คำ + ไอคอน + สี ทุกครั้ง (ห้ามสื่อด้วยสีอย่างเดียว — design.md ข้อ 8) */
const DELIVERY: Record<ChatDelivery, { label: string; icon: IconT; pill: string; ink: string }> = {
  sent:        { label: 'ส่งถึง', icon: Check, pill: 'bg-emerald-50 border-emerald-200 text-emerald-700', ink: 'text-emerald-700' },
  failed:      { label: 'ส่งไม่ถึง', icon: CircleX, pill: 'bg-red-50 border-red-200 text-red-700', ink: 'text-red-700' },
  pending:     { label: 'ยังไม่รู้ผล', icon: Clock, pill: 'bg-amber-50 border-amber-200 text-amber-700', ink: 'text-amber-700' },
  none:        { label: 'บอทไม่ได้ตอบ', icon: CircleMinus, pill: 'bg-slate-50 border-slate-200 text-slate-600', ink: 'text-slate-500' },
  warned:      { label: 'LINE ส่งซ้ำ · แจ้งให้ส่งใหม่', icon: Repeat, pill: 'bg-amber-50 border-amber-200 text-amber-700', ink: 'text-amber-700' },
  warn_failed: { label: 'LINE ส่งซ้ำ · แจ้งเซลส์ไม่สำเร็จ', icon: Repeat, pill: 'bg-red-50 border-red-200 text-red-700', ink: 'text-red-700' },
  web:         { label: 'แสดงบนหน้าเว็บ', icon: Monitor, pill: 'bg-sky-50 border-sky-200 text-sky-700', ink: 'text-sky-700' },
  nodata:      { label: 'ไม่มีข้อมูลผลการส่ง', icon: CircleMinus, pill: 'border-dashed border-slate-300 text-slate-500 font-medium', ink: 'text-slate-500' },
};

export function deliveryMeta(s: ChatDelivery) {
  return DELIVERY[s] ?? DELIVERY.nodata;
}

/** คำอธิบายใต้ป้ายผลการส่ง — ทุกคนเห็น (ไม่มีเนื้อแชท) */
export const DELIVERY_EXPLAIN: Partial<Record<ChatDelivery, string>> = {
  failed: 'LINE ไม่รับคำตอบ — เซลส์ไม่เห็นข้อความของบอทในครั้งนี้',
  pending: 'งานยังไม่จบเมื่อครบเพดาน 120 วิ หรือยังมีรอบส่งค้างอยู่ — บอกไม่ได้ว่าถึงเซลส์หรือไม่',
  none: 'งานจบแล้วโดยไม่ได้เรียกส่งเลย (เช่น สติกเกอร์ ซึ่งบอทไม่ตอบโดยตั้งใจ)',
  warn_failed: 'LINE ส่งซ้ำ และแจ้งเซลส์ให้ส่งใหม่ไม่สำเร็จ — ต้องมีคนทักเซลส์เอง',
  web: 'หน้าเว็บไม่ผ่าน LINE — ไม่มีขั้นส่ง',
  nodata: 'ไม่มีบันทึกผลการส่ง จึงบอกไม่ได้ว่าถึงเซลส์หรือไม่ (ข้อความก่อนเริ่มบันทึกผลการส่ง · งานที่ไม่ผ่านคิว · รูปภาพ · หรือยังรอผลไม่เกิน 2 นาที)',
};

const WEB_KIND: Record<string, string> = {
  web_propose: 'หน้าเว็บ · ตรวจคำขอ',
  web_draft: 'หน้าเว็บ · สร้างร่าง',
  web_confirm: 'หน้าเว็บ · ยืนยันใบ',
  web_revise: 'หน้าเว็บ · แก้ใบเดิม',
  web_approval_approved: 'หน้าเว็บ · อนุมัติราคา',
  web_approval_rejected: 'หน้าเว็บ · ไม่อนุมัติราคา',
  web_approval_edited: 'หน้าเว็บ · แก้คำขออนุมัติ',
  web_approval_cancelled: 'หน้าเว็บ · ยกเลิกคำขออนุมัติ',
};

const LINE_EVENT: Record<string, string> = {
  follow: 'เพิ่มเพื่อนบอท',
  unfollow: 'เลิกติดตามบอท',
  join: 'เชิญบอทเข้ากลุ่ม',
  leave: 'บอทออกจากกลุ่ม',
};

/** ชนิดของข้อความ — เป็นข้อมูลประกอบ (ไม่ใช่เนื้อ) ทุกคนเห็นได้ */
export function kindMeta(ex: ChatExchange): { label: string; icon: IconT } {
  switch (ex.kind) {
    case 'web': return { label: WEB_KIND[ex.subtype ?? ''] ?? 'หน้าเว็บ', icon: Monitor };
    case 'postback': return { label: 'กดปุ่ม', icon: MousePointerClick };
    case 'sticker': return { label: 'สติกเกอร์', icon: Smile };
    case 'image': return { label: 'รูปภาพ', icon: ImageIcon };
    case 'text': return { label: 'พิมพ์ข้อความ', icon: MessageSquare };
    case 'event': return { label: LINE_EVENT[ex.subtype ?? ''] ?? `เหตุการณ์ ${ex.subtype ?? ''}`.trim(), icon: Info };
    default: return { label: `ข้อความชนิด ${ex.subtype ?? 'อื่น'}`, icon: MessageSquare };
  }
}

/** ขาเข้าแบบสั้น (admin เท่านั้น — ผู้เรียกต้องเช็ก content ก่อน) */
export function inSummary(ex: ChatExchange): string {
  const t = ex.content?.in_text;
  if (t) return t;
  if (ex.kind === 'sticker') return 'ส่งสติกเกอร์';
  if (ex.kind === 'image') return 'ส่งรูปภาพ';
  if (ex.kind === 'event' || ex.kind === 'other') return kindMeta(ex).label;
  return 'ไม่มีบันทึกข้อความ';
}

/** บรรทัดเดียว ตัดที่ n ตัวอักษร — ข้อความเต็มอยู่ใน title */
export function oneLine(s: string, n = 60): string {
  const one = s.replace(/\s*\n\s*/g, ' · ');
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

/** ผลที่แย่สุดของหลายก้อน (request เดียวมีหลาย event ได้) — ปัญหามาก่อน */
const SEVERITY: ChatDelivery[] = ['warn_failed', 'failed', 'pending', 'none', 'warned', 'nodata', 'sent', 'web'];
export function worstDelivery(list: ChatExchange[]): ChatDelivery {
  for (const s of SEVERITY) if (list.some(x => x.delivery.status === s)) return s;
  return 'nodata';
}

