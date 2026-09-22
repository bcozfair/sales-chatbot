import { useState, useEffect } from 'react';
import { AuthProvider, useAuth, type Role } from '../context/AuthContext';
import { Login } from './Login';
import { Users } from './Users';
import { RolePermissions } from './RolePermissions';
import { Blacklist } from './Blacklist';
import { CreditPolicy } from './CreditPolicy';
import { ChangePasswordModal } from './ChangePasswordModal';
import { Promotions } from './Promotions';
import { Salespersons } from './Salespersons';
import { Quotations } from './Quotations';
import { QuoteRequest } from './QuoteRequest';
import { PriceApprovals } from './PriceApprovals';
import { PageHeaderProvider, PageHeaderOutlet } from './PageHeader';
import { ThemeToggle } from './ThemeToggle';
import { QuotationRules } from './QuotationRules';
import { OptionalLinks } from './OptionalLinks';
import { StockRules } from './StockRules';
import { ProductMoqRules } from './ProductMoqRules';
import { BlockRules } from './BlockRules';
import { ShippingFee } from './ShippingFee';
import { SyncPanel } from './SyncPanel';
import { ProductsDirectory } from './ProductsDirectory';
import { CustomersDirectory } from './CustomersDirectory';
import { OdooContacts } from './OdooContacts';
// โมดูลทดลอง "คิดราคาสินค้า" — ถอดออก = ลบ import นี้ + 1 เมนู + 1 แถวใน PAGE_TITLES + 1 สาขา render
import { PricingLab } from './pricingLab/PricingLab';
import { LogsShell } from './logs/LogsShell';
import type { LogTab } from './logs/LogsShell';
import { useAdminRoute, type MainTab, type SubTab } from './navHash';
import {
  LogOut,
  User as UserIcon,
  Shield,
  LayoutDashboard,
  Loader2,
  Tag,
  UserCheck,
  UserPlus,
  FileText,
  Sliders,
  SlidersHorizontal,
  Settings2,
  PackagePlus,
  PackageX,
  PackageMinus,
  ShieldBan,
  Truck,
  BriefcaseBusiness,
  Contact,
  Activity,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Menu,
  X,
  AlertCircle,
  Users as UsersIcon,
  KeyRound,
  Ban,
  ClipboardList,
  FilePlus2,
  BadgeCheck,
  Database,
  Package,
  ShieldCheck,
  CircleDollarSign,
} from 'lucide-react';

// MainTab / SubTab ย้ายไป navHash.ts แล้ว เพราะชื่อแท็บกลายเป็นส่วนหนึ่งของ URL (ดูเหตุผลในไฟล์นั้น)

interface AdminStats {
  quotations: number;
  promotions: number;
  salespersons: number;
  quotation_rules: number;
  optional_links: number;
  stock_rules: number;
  moq_rules: number;
  block_rules: number;
}

const BRAND = 'var(--brand-fg)';
const BRAND_SOFT = 'var(--brand-soft)';
const BRAND_SOFT_STRONG = 'var(--brand-soft-strong)';
const BRAND_BORDER = 'var(--brand-border)';

/**
 * เมนูข้างซ้าย — หนึ่งเมนูเดี่ยวบนสุด + สี่กลุ่มที่พับได้
 *
 * ทำไมถึงจัดกลุ่ม (2026-09-15): เดิมเป็นปุ่มเรียงแถวเดียว 8 ปุ่ม + หน้าตั้งค่าที่มีหัวข้อย่อย
 * อีก 6 หัวข้อ รวม 14 บรรทัดที่ไม่บอกว่าอันไหนคืองานที่ทำทุกวัน อันไหนคือค่าที่ตั้งทีเดียวแล้ว
 * ไม่แตะอีกทั้งปี · และหัวข้อย่อยของหน้าตั้งค่าเคยเป็น "ตัวอักษรล้วนไม่มีไอคอน" ⇒ พอ sidebar
 * ย่อเหลือ 76px มันหายไปทั้ง 6 หัวข้อ ต้องกางออกก่อนถึงจะกดได้ ตอนนี้ทุกตัวเลือกมีไอคอนของ
 * ตัวเอง โหมดย่อจึงกดถึงได้ทุกหน้าโดยไม่ต้องกางอะไรก่อน
 *
 * **การจัดกลุ่มเป็นเรื่องของหน้าจออย่างเดียว ไม่ได้แตะเส้นทาง** — ทั้ง `tab` และ `sub`
 * ยังเป็นค่าเดิมใน navHash.ts ทุกตัว ลิงก์ที่แชร์กันไว้ (`#promotions`, `#settings/stock`)
 * จึงเปิดได้เหมือนเดิม
 *
 * **cap = ช่องในเมทริกซ์สิทธิ์ที่ตัดสินว่าเมนูนี้โผล่ไหม** (ตั้งแต่ 2026-09-18) — ค่ามาจาก
 * `GET /api/admin/me/capabilities` ซึ่งเป็นช่องเดียวกับที่ `requireCapability()` ใช้เป็นด่านที่
 * route ของหน้านั้น ⇒ เจ้าของเปิดสิทธิ์จากหน้า "สิทธิ์ตามบทบาท" แล้วเมนูขึ้นทันที ไม่ต้อง deploy
 *
 * roles = **ค่าสำรองตอนที่ยังตอบไม่ได้ว่าใครมีสิทธิ์อะไร** (กำลังโหลด หรือเรียก API ไม่สำเร็จ) —
 * ไม่ใช่กติกาคู่ขนาน: รายชื่อในนี้ตรงกับ `defaults` ของ cap ตัวนั้นใน `config/capabilities.ts` เป๊ะ
 * และ `diag:role-permissions` ข้อ 12 อ่านไฟล์นี้มาเทียบให้ ⇒ แก้ข้างเดียวเมื่อไหร่ด่านล้มทันที
 * เมนูที่ไม่มี cap (เช่น "สิทธิ์ตามบทบาท" เอง) ใช้ roles เป็นคำตอบจริง ไม่ใช่ค่าสำรอง
 *
 * ทั้งสองอย่างเป็นแค่การซ่อน UI — ตัวบังคับจริงอยู่ที่ฝั่ง backend เสมอ
 */
type NavItem = { label: string; icon: typeof LayoutDashboard; roles: Role[]; cap?: string } & (
  | { tab: MainTab; sub?: never }
  | { sub: SubTab; tab?: never }
);

/** หน้าแรกที่ทุกคนกลับมา จึงอยู่เดี่ยวบนสุด ไม่ใช่ของที่ต้องกางกลุ่มก่อนถึงจะเห็น */
const NAV_HOME: NavItem & { tab: MainTab } = {
  tab: 'dashboard', label: 'แผงควบคุม', icon: LayoutDashboard, roles: ['admin'], cap: 'page.dashboard',
};

const NAV_GROUPS: { key: string; label: string; icon: typeof LayoutDashboard; items: NavItem[] }[] = [
  {
    key: 'work',
    label: 'งานใบเสนอราคา',
    icon: BriefcaseBusiness,
    items: [
      { tab: 'quoterequest', label: 'ขอใบเสนอราคา', icon: FilePlus2, roles: ['admin', 'approver', 'subadmin', 'salesperson'], cap: 'quote.create' },
      // subadmin เห็นเมนูนี้ด้วย แต่เห็น "คำขอของตัวเอง" เท่านั้น — server เป็นคนกรอง ไม่ใช่หน้าจอ
      { tab: 'approvals', label: 'อนุมัติราคา', icon: BadgeCheck, roles: ['admin', 'approver', 'subadmin', 'salesperson'], cap: 'page.approvals' },
      { tab: 'quotations', label: 'ประวัติใบเสนอราคา', icon: FileText, roles: ['admin', 'approver', 'subadmin', 'salesperson'], cap: 'page.quotations' },
      // เครื่องมือที่ใช้ตอนกำลังทำใบ ไม่ใช่ค่าที่ตั้งทิ้งไว้ให้ระบบใช้เอง จึงอยู่กลุ่มนี้ไม่ใช่ "เงื่อนไข & กฎ"
      // (เจ้าของเคาะ 2026-09-18) · ค่าเริ่มต้นคือ admin คนเดียว เพราะเป็นหน้าที่ยังไม่เคยมี
      // ไอคอนเคยเป็น `Calculator` แล้วเปลี่ยนเมื่อ 2026-09-19 เพราะ **เมนูในกลุ่มวาดไอคอนที่
      // 16px** (ดู `renderNavItem`: `nested = !collapsed` ⇒ ตอนกางแถบได้ `w-4 h-4` · 18px
      // เกิดเฉพาะตอนหุบแถบ) **และปุ่มกด 7 จุดของ Calculator เป็น `h.01` ⇒ หายหมดที่ขนาดนั้น
      // เหลือเป็นกล่องสี่เหลี่ยมเปล่า** — ตัวแทนต้องเป็นทรงที่ยังอ่านออกตอนย่อ
      // (เจ้าของเลือกจาก mockup/ic-index.html · ขนาดจริง 16px ยืนยันด้วย mockup/_pl-live.mjs)
      // ส่วน `Calculator` ย้ายไปอยู่บนปุ่ม "คิดราคา" ในหน้านั้นแทน ซึ่งใหญ่พอให้เห็นลายจริง
      { tab: 'pricing', label: 'คิดราคาสินค้า', icon: CircleDollarSign, roles: ['admin'], cap: 'page.pricing' },
    ],
  },
  {
    // โปรโมชันส่วนลดอยู่กลุ่มนี้เพราะมันคือ "กฎส่วนลด" เรื่องเดียวกับ MOQ / บล็อกสินค้า /
    // ค่าขนส่ง — เจ้าของเลือกให้ย้ายลงมาเมื่อ 2026-09-15 (เดิมอยู่แถวบนปนกับงานประจำวัน)
    key: 'rules',
    label: 'เงื่อนไข & กฎ',
    icon: SlidersHorizontal,
    items: [
      { sub: 'quotation', label: 'เงื่อนไขหลัก', icon: Settings2, roles: ['admin'], cap: 'page.settings_quotation' },
      { tab: 'promotions', label: 'จัดการโปรโมชันส่วนลด', icon: Tag, roles: ['admin'], cap: 'page.promotions' },
      // สามหัวข้อที่เป็นกฎของ "ตัวสินค้า" ใช้ไอคอนตระกูล Package เดียวกัน (+ พ่วง · ✕ หมด · − ขั้นต่ำ)
      { sub: 'optional', label: 'สินค้าพ่วงเสริม', icon: PackagePlus, roles: ['admin'], cap: 'page.settings_optional' },
      { sub: 'stock', label: 'ระงับเมื่อหมดสต็อก', icon: PackageX, roles: ['admin'], cap: 'page.settings_stock' },
      { sub: 'moq', label: 'ขั้นต่ำสั่งซื้อ', icon: PackageMinus, roles: ['admin'], cap: 'page.settings_moq' },
      // ShieldBan ไม่ใช่ Ban เพราะ Ban ถูกใช้กับ "บัญชีห้ามเสนอราคา" ไปแล้ว — คนละเรื่องกัน
      { sub: 'block', label: 'บล็อกสินค้า', icon: ShieldBan, roles: ['admin'], cap: 'page.settings_block' },
      { sub: 'shipping', label: 'ค่าขนส่ง & เครดิต', icon: Truck, roles: ['admin'], cap: 'page.settings_shipping' },
    ],
  },
  {
    // แยกจากกลุ่ม "จัดการข้อมูลผู้ใช้งาน" เมื่อ 2026-09-17 ตามที่เจ้าของสั่ง —
    // เส้นแบ่งคือ **ข้อมูลที่ระบบใช้ตัดสินใจ** (สินค้า/ลูกค้า/ใครห้ามเสนอราคา) อยู่กลุ่มนี้
    // ส่วน **คนที่ล็อกอินเข้าระบบ** อยู่อีกกลุ่ม — "บัญชีห้ามเสนอราคา" จึงอยู่ที่นี่ทั้งที่ชื่อ
    // ขึ้นต้นว่า "บัญชี": มันคือรายชื่อลูกค้าที่ห้ามออกใบให้ ไม่ใช่บัญชีผู้ใช้ (เจ้าของสั่งย้าย
    // 2026-09-17 หลังเห็นของจริง) · สองหน้าแรกอ่านอย่างเดียว ต้นทางคือ Odoo
    key: 'data',
    label: 'จัดการข้อมูลทั่วไป',
    icon: Database,
    items: [
      { tab: 'productsdata', label: 'ข้อมูลสินค้า', icon: Package, roles: ['admin', 'approver', 'subadmin'], cap: 'page.productsdata' },
      { tab: 'customersdata', label: 'ข้อมูลลูกค้า', icon: Contact, roles: ['admin', 'approver', 'subadmin'], cap: 'page.customersdata' },
      // คิวงานค้าง ไม่ใช่ข้อมูลอ้างอิง แต่อยู่กลุ่มนี้เพราะมันคือรายชื่อผู้ติดต่อ — คนที่มาหามันมาหาต่อจาก
      // "ข้อมูลลูกค้า" ที่อยู่เหนือมัน · ตัวเลขข้างเมนู = คนที่ยังไม่มีใน Odoo (เจ้าของเคาะ 2026-09-21)
      { tab: 'odoocontacts', label: 'ผู้ติดต่อเพิ่มเอง', icon: UserPlus, roles: ['admin', 'approver', 'subadmin'], cap: 'page.odoocontacts' },
      { tab: 'blacklist', label: 'บัญชีห้ามเสนอราคา', icon: Ban, roles: ['admin', 'user'], cap: 'page.blacklist' },
    ],
  },
  {
    // role `user` เห็นได้เมนูเดียวคือ "บัญชีห้ามเสนอราคา" ซึ่งย้ายออกไปกลุ่มบนแล้ว ⇒
    // กลุ่มนี้กลายเป็นของ admin ล้วน และถูกซ่อนทั้งกลุ่มให้เอง (`visibleGroups` ตัดกลุ่มที่ว่าง)
    key: 'people',
    label: 'จัดการข้อมูลผู้ใช้งาน',
    icon: UsersIcon,
    items: [
      { tab: 'salespersons', label: 'จัดการพนักงานขาย', icon: UserCheck, roles: ['admin'], cap: 'page.salespersons' },
      { tab: 'users', label: 'จัดการผู้ใช้งานระบบ', icon: UsersIcon, roles: ['admin'], cap: 'page.users' },
      // ไม่มี cap โดยตั้งใจ — ความสามารถที่ปิดตัวเองได้ คือความสามารถที่ล็อกคนสุดท้ายออกจากระบบได้
      { tab: 'rolepermissions', label: 'สิทธิ์ตามบทบาท', icon: ShieldCheck, roles: ['admin'] },
    ],
  },
  {
    key: 'audit',
    label: 'ตรวจสอบระบบ',
    icon: Activity,
    // เมนูเดียวในกลุ่ม — การสลับ 4 หน้าย่อยอยู่ที่แถบแท็บใน LogsShell ตามเหตุผลข้างล่าง
    items: [{ tab: 'traffic', label: 'รายงานการใช้งาน', icon: ClipboardList, roles: ['admin'], cap: 'page.traffic' }],
  },
];

/**
 * กลุ่ม "Activity Log" — 5 หน้าที่ตอบคนละคำถาม (4 หน้าแรกโยงกันด้วย request_id ตัวเดียวกัน
 * ส่วน "การสำรองข้อมูล" ไม่มี request_id เพราะคนเขียนคือ cron บน host ไม่ใช่แอป)
 *
 * เมนูข้างซ้ายเป็น "ปุ่มเดียว" ไม่มีเมนูย่อยพับได้อีกแล้ว — การสลับระหว่าง 4 หน้าอยู่ที่
 * แถบแท็บใน LogsShell ที่เดียว · เมนูย่อยกับแท็บที่ทำงานซ้ำกันคือการให้ผู้ใช้ต้องจำสองทาง
 * ไปที่เดียวกัน และทำให้ sidebar ยาวขึ้นโดยไม่ได้อะไรกลับมา
 */
const LOG_TABS = new Set<MainTab>(['traffic', 'apilogs', 'auditlogs', 'systemlogs', 'backups']);

/** แท็บที่เปิดให้เมื่อกดเมนูครั้งแรก — ตรงกับแท็บซ้ายสุดใน LogsShell */
const LOG_TAB_DEFAULT: MainTab = 'traffic';

const PAGE_TITLES: Record<MainTab, string> = {
  dashboard: 'แผงควบคุม',
  quoterequest: 'ขอใบเสนอราคา',
  approvals: 'อนุมัติราคา',
  quotations: 'ประวัติใบเสนอราคา',
  promotions: 'จัดการโปรโมชันส่วนลด',
  salespersons: 'จัดการพนักงานขาย',
  users: 'จัดการผู้ใช้งานระบบ',
  rolepermissions: 'สิทธิ์ตามบทบาท',
  blacklist: 'บัญชีห้ามเสนอราคา',
  pricing: 'คิดราคาสินค้า',
  productsdata: 'ข้อมูลสินค้า',
  customersdata: 'ข้อมูลลูกค้า & ผู้ติดต่อ',
  odoocontacts: 'ผู้ติดต่อที่ต้องคีย์เข้า Odoo',
  traffic: 'รายงานการใช้งาน',
  apilogs: 'บันทึกการเรียก API',
  auditlogs: 'บันทึกการแก้ไข',
  systemlogs: 'บันทึกระบบ',
  backups: 'การสำรองข้อมูล',
  settings: 'ตั้งค่าเงื่อนไข & กฎ',
};

function AdminContent() {
  const { isAuthenticated, isLoading, user, token, logout } = useAuth();
  // แท็บที่เปิดอยู่มาจาก URL hash — refresh แล้วต้องอยู่หน้าเดิม ไม่เด้งกลับแผงควบคุม
  const { route, navigate } = useAdminRoute();
  const activeTab = route.tab;
  const subTab = route.sub;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  /**
   * กลุ่มไหนกางอยู่ — เก็บเฉพาะกลุ่มที่ "คนกดหุบเอง" เท่านั้น
   * **ค่าเริ่มต้นคือกางทุกกลุ่ม** (เจ้าของเลือกเมื่อ 2026-09-15) — เปิดมาเห็นเมนูครบทุกบรรทัด
   * ไม่ต้องกดกางก่อนถึงจะรู้ว่ามีอะไรอยู่ข้างใน · การพับมีไว้ให้คนที่อยากเก็บกลุ่มที่ไม่ได้ใช้
   * ไม่ใช่ด่านที่ทุกคนต้องผ่านทุกครั้งที่เปิดหน้า
   */
  const [groupToggles, setGroupToggles] = useState<Record<string, boolean>>({});
  // แท็บล่าสุดในกลุ่ม Activity Log — ออกไปหน้าอื่นแล้วกดเมนูกลับมา ต้องได้แท็บเดิม
  // ไม่ใช่เด้งกลับหน้าแรกทุกครั้ง (คนที่ตามเรื่องอยู่มักวนกลับมาที่หน้าเดิมซ้ำ ๆ)
  const [lastLogTab, setLastLogTab] = useState<MainTab>(() =>
    LOG_TABS.has(route.tab) ? route.tab : LOG_TAB_DEFAULT,
  );
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const isAdmin = user?.role === 'admin';

  /**
   * ความสามารถของคนที่ล็อกอินอยู่ — `null` = ยังตอบไม่ได้ (กำลังโหลด หรือเรียกไม่สำเร็จ)
   *
   * ยิงครั้งเดียวตอนได้ token ไม่ใช่ทุกครั้งที่เปลี่ยนหน้า — ค่าจะเปลี่ยนก็ต่อเมื่อเจ้าของแก้
   * เมทริกซ์ ซึ่งคนที่เพิ่งถูกแก้สิทธิ์จะเห็นผลรอบ login ถัดไป · **ถ้าเรียกไม่สำเร็จห้ามซ่อนทุกเมนู**
   * เพราะอ่านว่า "ระบบพัง" ⇒ ถอยไปใช้ `roles` ซึ่งคือพฤติกรรมก่อนมีเมทริกซ์ (ด่านจริงอยู่ที่ server
   * อยู่แล้ว เมนูที่โผล่เกินมาจึงเปิดเข้าไปแล้วได้ 403 ไม่ใช่หลุดสิทธิ์)
   */
  const [caps, setCaps] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/me/capabilities', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.capabilities) setCaps(data.capabilities as Record<string, string>);
      } catch {
        // ปล่อยเป็น null แล้วถอยไปใช้ roles — ดูเหตุผลข้างบน
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const canSee = (item: NavItem) => {
    if (!user) return false;
    // เมนูที่ไม่มีช่องในเมทริกซ์ (หน้า "สิทธิ์ตามบทบาท" เอง) ตัดสินด้วย role ตรง ๆ
    if (!item.cap || caps === null) return item.roles.includes(user.role);
    return caps[item.cap] !== 'deny';
  };
  const homeVisible = canSee(NAV_HOME);
  /** กลุ่มที่ไม่เหลือเมนูให้ผู้ใช้คนนี้เลย ต้องหายไปทั้งกลุ่ม — หัวข้อกลุ่มเปล่า ๆ อ่านว่า "พัง" */
  const visibleGroups = NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter(canSee) }))
    .filter((group) => group.items.length > 0);
  /**
   * เหลือกลุ่มเดียว = ไม่ต้องมีหัวข้อกลุ่ม
   * หัวข้อของกลุ่มเดียวไม่ได้แยกอะไรออกจากอะไร มันแค่เพิ่มบรรทัดที่ต้องกดก่อนถึงจะใช้งานได้
   * (เกิดกับ approver/subadmin ที่เห็น 3 เมนู และ role `user` ที่เห็นเมนูเดียว)
   */
  const flatNav = visibleGroups.length <= 1;
  /** หน้าหลักทั้งหมดที่เห็น เรียงตามที่ตาเห็นบนเมนู — ตัวแรกคือหน้าที่ถอยกลับมาเมื่อสิทธิ์ไม่ถึง */
  const visibleTabs: MainTab[] = [
    ...(homeVisible ? [NAV_HOME.tab] : []),
    ...visibleGroups.flatMap((group) =>
      group.items.map((item) => item.tab).filter((tab): tab is MainTab => !!tab),
    ),
  ];

  /**
   * ตัวเลขข้างเมนู "อนุมัติราคา" — **แทนการแจ้งเตือน** เพราะระบบนี้ห้ามใช้ LINE push
   * (กฎเหล็กของ CLAUDE.md) ⇒ ถ้าไม่มีตัวเลขตรงนี้ คำขอที่รออยู่จะไม่มีอะไรบอกใครเลย
   * · ผู้อนุมัติได้ "รออนุมัติกี่ชุด" · คนขอได้ "ของฉันถูกตีกลับกี่ชุด" (server เป็นคนตัดสินว่าใครเห็นอะไร)
   */
  const [approvalBadge, setApprovalBadge] = useState(0);
  const showsApprovals = visibleTabs.includes('approvals');
  useEffect(() => {
    if (!token || !showsApprovals) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/approvals/count', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        const n = Number(data?.pending ?? 0) + Number(data?.rejected ?? 0);
        if (!cancelled) setApprovalBadge(Number.isFinite(n) ? n : 0);
      } catch {
        // นับไม่ได้ไม่ใช่เหตุให้ทั้งเมนูพัง — ไม่มีตัวเลขก็ยังกดเข้าไปดูได้
      }
    })();
    return () => { cancelled = true; };
  }, [token, showsApprovals, activeTab]);

  /**
   * ตัวเลขข้างเมนู "ผู้ติดต่อเพิ่มเอง" — จำนวนคนที่ยังไม่มีใน Odoo (เจ้าของเคาะ 2026-09-21)
   *
   * เหตุผลเดียวกับ badge ของ "อนุมัติราคา": ระบบนี้ห้ามใช้ LINE push ⇒ ถ้าไม่มีตัวเลขตรงนี้
   * งานค้างจะไม่มีอะไรบอกใครเลย · ใช้เส้น `/count` ที่นับอย่างเดียว ไม่ใช่เส้นรายการที่ต้องคำนวณชื่อคล้ายทุกแถว
   */
  const [odooContactBadge, setOdooContactBadge] = useState(0);
  const showsOdooContacts = visibleTabs.includes('odoocontacts');
  useEffect(() => {
    if (!token || !showsOdooContacts) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/webquote/contacts/count', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        const n = Number(data?.pending ?? 0);
        if (!cancelled) setOdooContactBadge(Number.isFinite(n) ? n : 0);
      } catch {
        // นับไม่ได้ไม่ใช่เหตุให้ทั้งเมนูพัง — ไม่มีตัวเลขก็ยังกดเข้าไปดูได้
      }
    })();
    return () => { cancelled = true; };
  }, [token, showsOdooContacts, activeTab]);

  // แท็บที่แสดงจริง — activeTab ตั้งต้นเป็น 'dashboard' ซึ่ง role 'user' ไม่มีสิทธิ์เห็น
  // คำนวณตอน render แทนการ setState ใน effect: ไม่มี re-render รอบพิเศษ และครอบเคสถูกลดสิทธิ์
  // ระหว่างเปิดหน้าค้างไว้ด้วย (adminAuthMiddleware อ่าน role สดจาก DB ทุก request)
  //  'settings' กับหน้าลูกของกลุ่มบันทึกไม่มีอยู่ใน visibleTabs (ตัวแรกเป็นเมนูย่อย ตัวหลังสลับ
  //  ในตัวหน้าเอง) จึงต้องถามแยก — และถามจาก **เมนูที่คนนี้เห็นจริง** ไม่ใช่ `isAdmin` ตายตัว
  //  ไม่งั้นเจ้าของเปิดหน้าตั้งค่าให้ role อื่นแล้วเขากดเข้าไม่ได้ ทั้งที่เมนูโผล่ให้เห็น
  const canOpenSettings = visibleGroups.some((g) => g.items.some((i) => !!i.sub));
  const effectiveTab: MainTab =
    visibleTabs.includes(activeTab) ||
    (activeTab === 'settings' && canOpenSettings) ||
    (LOG_TABS.has(activeTab) && visibleTabs.includes('traffic'))
      ? activeTab
      : (visibleTabs[0] ?? 'blacklist');

  useEffect(() => {
    // /api/admin/stats เปิดให้เฉพาะ admin — ยิงด้วย role อื่นจะได้ 403 แล้วขึ้น error ให้เปล่า ๆ
    if (activeTab !== 'dashboard' || !token || !isAdmin) return;
    let cancelled = false;
    const fetchStats = async () => {
      setStatsLoading(true);
      setStatsError(null);
      try {
        const res = await fetch('/api/admin/stats', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('failed');
        const data: AdminStats = await res.json();
        if (!cancelled) setStats(data);
      } catch {
        if (!cancelled) setStatsError('ไม่สามารถโหลดข้อมูลสรุปได้');
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    };
    fetchStats();
    return () => {
      cancelled = true;
    };
  }, [activeTab, token, isAdmin]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-10 h-10 animate-spin" style={{ color: BRAND }} />
        <p className="text-slate-500 text-sm font-medium">กำลังโหลดข้อมูล...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  const goTo = (tab: MainTab) => {
    navigate({ tab, sub: subTab });
    setMobileOpen(false);
    if (LOG_TABS.has(tab)) setLastLogTab(tab);
  };

  const goToSubTab = (tab: SubTab) => {
    navigate({ tab: 'settings', sub: tab });
    setMobileOpen(false);
  };

  /** เมนูหนึ่งบรรทัดกำลังเปิดอยู่หรือไม่ — หัวข้อย่อยของหน้าตั้งค่าเทียบที่ `sub` ไม่ใช่ `tab` */
  const isItemActive = (item: NavItem) => {
    if (item.tab === 'traffic') return LOG_TABS.has(effectiveTab);
    if (item.tab) return effectiveTab === item.tab;
    return effectiveTab === 'settings' && subTab === item.sub;
  };

  const goToItem = (item: NavItem) => {
    // กลุ่ม "ตรวจสอบระบบ" จำแท็บล่าสุดไว้ ไม่เด้งกลับหน้าแรกของกลุ่มทุกครั้งที่กดกลับมา
    if (item.tab) return goTo(item.tab === 'traffic' ? lastLogTab : item.tab);
    goToSubTab(item.sub);
  };

  const toggleCollapsed = () => setCollapsed((v) => !v);

  const SUMMARY_CARDS: {
    key: keyof AdminStats;
    label: string;
    unit: string;
    icon: typeof LayoutDashboard;
    onClick: () => void;
  }[] = [
    { key: 'quotations', label: 'ใบเสนอราคา', unit: 'รายการ', icon: FileText, onClick: () => goTo('quotations') },
    { key: 'promotions', label: 'โปรโมชันส่วนลด', unit: 'รายการ', icon: Tag, onClick: () => goTo('promotions') },
    { key: 'salespersons', label: 'พนักงานขาย', unit: 'คน', icon: UserCheck, onClick: () => goTo('salespersons') },
    { key: 'quotation_rules', label: 'เงื่อนไขหลัก', unit: 'รายการ', icon: Sliders, onClick: () => goToSubTab('quotation') },
    { key: 'optional_links', label: 'สินค้าพ่วงเสริม', unit: 'รายการ', icon: Sliders, onClick: () => goToSubTab('optional') },
    { key: 'stock_rules', label: 'ระงับเมื่อหมดสต็อก', unit: 'รายการ', icon: Sliders, onClick: () => goToSubTab('stock') },
    { key: 'moq_rules', label: 'ขั้นต่ำสั่งซื้อ (MOQ)', unit: 'รายการ', icon: Sliders, onClick: () => goToSubTab('moq') },
    { key: 'block_rules', label: 'บล็อกสินค้า', unit: 'รายการ', icon: Sliders, onClick: () => goToSubTab('block') },
  ];

  const sidebarWidth = collapsed ? 76 : 264;

  /**
   * ปุ่มเมนูหนึ่งบรรทัด — ใช้ทั้งเมนูเดี่ยวบนสุดและเมนูในกลุ่ม
   * `nested` = อยู่ในกลุ่มและ sidebar กางอยู่ ⇒ เล็กลงหนึ่งขั้น + มีเส้นรางด้านซ้าย
   * (ยกรูปแบบเดิมของหัวข้อย่อยหน้าตั้งค่ามาทั้งชุด ไม่ได้ตั้งของใหม่)
   * ตอน sidebar ย่อ ทุกบรรทัดกลับมาเท่ากันหมด เพราะเหลือแต่ไอคอนแล้วไม่มีลำดับชั้นให้สื่อ
   */
  const renderNavItem = (item: NavItem, nested: boolean) => {
    const Icon = item.icon;
    const active = isItemActive(item);
    // สองเมนูมีตัวเลขค้างของตัวเอง — อ่านจากแมปที่เดียว ไม่งั้นทุกจุดที่วาดป้ายต้องมี if ของตัวเอง
    const badge = item.tab === 'approvals' ? approvalBadge
      : item.tab === 'odoocontacts' ? odooContactBadge
        : 0;
    const pendingLabel = badge > 0 ? `${item.label} (${badge} รายการ)` : item.label;
    // ความมนอยู่ในบรรทัดของแต่ละแบบ ไม่ใช่ในบรรทัดฐาน — `rounded-lg` กับ `rounded-xl` ที่อยู่
    // ในคลาสเดียวกัน ตัวที่ชนะคือตัวที่ Tailwind เรียงไว้ทีหลังใน CSS ไม่ใช่ตัวที่พิมพ์ทีหลัง
    // (กับดักเดียวกับ `border-transparent` ใน docs/design.md หัวข้อ 2.1)
    const shape = collapsed
      ? 'justify-center px-3 py-2.5 rounded-xl text-sm font-semibold'
      : nested
        ? 'gap-2.5 px-3 py-2 rounded-lg border-l-2 text-[13px] font-medium'
        : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold';
    const tone = active
      ? nested
        ? 'border-current'
        : ''
      : nested
        ? 'border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50'
        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800';
    return (
      <button
        key={item.tab ?? item.sub}
        onClick={() => goToItem(item)}
        title={collapsed ? pendingLabel : undefined}
        className={`relative w-full flex items-center transition-all ${shape} ${tone}`}
        style={
          active
            ? nested
              ? { color: BRAND, borderColor: BRAND, backgroundColor: BRAND_SOFT }
              : { backgroundColor: BRAND_SOFT_STRONG, color: BRAND }
            : undefined
        }
      >
        <Icon className={nested ? 'w-4 h-4 shrink-0' : 'w-[18px] h-[18px] shrink-0'} />
        {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
        {/* ป้ายจำนวนใช้ **สีแบรนด์พื้นทึบ** (เจ้าของสั่ง 2026-09-17) ไม่ใช่ม่วงจาง ๆ ของหน้าอนุมัติ
            — ม่วงจางบนแถบเมนูได้คอนทราสต์ 2.56:1 (ธีมมืด) และ 1.02:1 (ธีมสว่าง) คือมองไม่เห็น
            ใช้คู่ `--btn-primary-bg` + `--btn-primary-ink` ซึ่งเป็นคู่ "พื้น + หมึก" ที่วัดมาแล้ว
            ในทั้งสองธีม (ดู index.css) · พื้นทึบยังอ่านออกตอนเมนูนี้ถูกเลือกอยู่ ซึ่งพื้นแถวเป็น
            เขียวจาง — ป้ายพื้นจางบนแถวพื้นจางจะกลายเป็นป้ายที่ไม่มีรูปร่าง */}
        {badge > 0 && !collapsed && (
          <span
            className="ml-auto px-1.5 min-w-5 text-center rounded-lg text-[11px] font-bold"
            style={{ backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-ink)' }}
          >
            {badge}
          </span>
        )}
        {/* ย่ออยู่แล้วตัวเลขไม่มีที่อยู่ — เหลือจุดบอกว่ามีของค้าง ส่วนจำนวนอยู่ใน title ของปุ่ม
            (ระบบนี้ห้ามใช้ LINE push ⇒ ถ้าตรงนี้ไม่บอก จะไม่มีอะไรบอกใครเลยว่ามีของรออยู่) */}
        {badge > 0 && collapsed && (
          <span
            className="absolute translate-x-3 -translate-y-2.5 w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: BRAND }}
          />
        )}
      </button>
    );
  };

  const SidebarContent = (
    <div className="h-full flex flex-col bg-card">
      {/* Brand / collapse control */}
      <div className="h-16 flex items-center gap-3 px-4 border-b border-slate-200 shrink-0">
        <img
          src="/logo.png"
          alt="Logo"
          className="w-9 h-9 object-contain bg-card p-1 rounded-lg border border-slate-200 shrink-0"
        />
        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-tight whitespace-nowrap">
              Primus <span style={{ color: BRAND }}>Admin</span>
            </h1>
            <p className="text-[10px] text-slate-400 font-medium whitespace-nowrap">Quotation Portal</p>
          </div>
        )}
        {/* mr-2 กันชนกับปุ่มย่อ sidebar ที่ลอยคร่อมขอบขวาอยู่ระดับเดียวกัน */}
        {!collapsed && (
          <ThemeToggle className="ml-auto mr-2" />
        )}
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden ml-auto flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-50 shrink-0"
          aria-label="ปิดเมนู"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
        {homeVisible && renderNavItem(NAV_HOME, false)}

        {visibleGroups.map((group, index) => {
          const GroupIcon = group.icon;
          const hasActive = group.items.some(isItemActive);
          const open = groupToggles[group.key] ?? true;
          if (flatNav) return <div key={group.key}>{group.items.map((item) => renderNavItem(item, false))}</div>;
          return (
            <div key={group.key}>
              {collapsed ? (
                /* ย่ออยู่: ไม่มีหัวข้อกลุ่มให้กด เพราะทุกตัวเลือกมีไอคอนของตัวเองแล้วจึงกดถึงได้ตรง ๆ
                   — เส้นคั่นทำหน้าที่แทนหัวข้อ · อันแรกไม่ต้องมีถ้าไม่มีอะไรอยู่ข้างบนให้คั่น */
                (index > 0 || homeVisible) && <div className="h-px bg-slate-100 my-2.5 mx-1.5" />
              ) : (
                <button
                  onClick={() => setGroupToggles((prev) => ({ ...prev, [group.key]: !open }))}
                  aria-expanded={open}
                  title={!open && hasActive ? `${group.label} — หน้าที่เปิดอยู่อยู่ในกลุ่มนี้` : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all hover:bg-slate-50 hover:text-slate-800 ${
                    hasActive ? 'text-slate-800' : 'text-slate-500'
                  }`}
                >
                  <GroupIcon className="w-[18px] h-[18px] shrink-0" />
                  <span className="whitespace-nowrap flex-1 text-left">{group.label}</span>
                  {/* หุบกลุ่มที่มีหน้าปัจจุบันอยู่ข้างในเมื่อไหร่ ต้องมีอะไรบอกว่า "ของที่เปิดอยู่อยู่ในนี้"
                      ไม่งั้นเมนูจะดูเหมือนไม่มีหน้าไหนถูกเลือกเลย (คำอธิบายเต็มอยู่ใน title ของปุ่ม) */}
                  {!open && hasActive && (
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: BRAND }} />
                  )}
                  <ChevronDown
                    className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
                  />
                </button>
              )}

              {(collapsed || open) && (
                <div className={collapsed ? 'space-y-0.5' : 'pl-4 mt-0.5 space-y-0.5'}>
                  {group.items.map((item) => renderNavItem(item, !collapsed))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User / logout — single row */}
      <div className="border-t border-slate-200 p-2.5 shrink-0">
        <div
          className={`flex items-center rounded-xl ${
            collapsed ? 'flex-col gap-1.5 py-1' : 'gap-2.5 px-2 py-2'
          }`}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: BRAND_SOFT, color: BRAND }}
          >
            <UserIcon className="w-4 h-4" />
          </div>
          {!collapsed && (
            <div className="text-left overflow-hidden flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-800 truncate">{user?.name || 'Administrator'}</p>
              <p className="text-[9px] text-slate-400 font-medium uppercase tracking-wider flex items-center gap-1">
                <Shield className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">{user?.role || 'Admin'}</span>
              </p>
            </div>
          )}
          <button
            id="admin-change-password-btn"
            onClick={() => setChangePasswordOpen(true)}
            title="เปลี่ยนรหัสผ่าน"
            aria-label="เปลี่ยนรหัสผ่าน"
            className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-[var(--brand-fg)] hover:bg-[var(--brand)]/10 transition-all active:scale-[0.95] shrink-0"
          >
            <KeyRound className="w-4 h-4" />
          </button>
          {collapsed && <ThemeToggle />}
          <button
            id="admin-logout-btn"
            onClick={() => logout()}
            title="ออกจากระบบ"
            aria-label="ออกจากระบบ"
            className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all active:scale-[0.95] shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex">
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:block relative shrink-0 border-r border-slate-200 sticky top-0 h-screen transition-[width] duration-200"
        style={{ width: sidebarWidth }}
      >
        {SidebarContent}
        <button
          onClick={toggleCollapsed}
          className="absolute z-10 flex items-center justify-center w-8 h-8 rounded-full bg-card shadow-md hover:shadow-lg transition-all active:scale-90"
          style={{ top: 18, right: -12, border: `1.5px solid var(--brand-border-strong)`, color: BRAND }}
          aria-label={collapsed ? 'ขยาย sidebar' : 'ย่อ sidebar'}
        >
          {collapsed ? <ChevronsRight className="w-3.5 h-3.5" /> : <ChevronsLeft className="w-3.5 h-3.5" />}
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-xl">{SidebarContent}</aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        {/* แถบบน = หัวเรื่องของหน้า + ปุ่ม action ของหน้านั้น (มาจาก <PageHeader /> ผ่าน portal)
            ตัดบรรทัด "PRIMUS ADMIN" ทิ้งเพราะซ้ำกับโลโก้บน sidebar และกินความสูงฟรี ๆ */}
        <header className="bg-card border-b border-slate-200 sticky top-0 z-30 min-h-14 flex items-center gap-3 px-4 sm:px-6 py-2 shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-50 border border-slate-200 shrink-0"
            aria-label="เปิดเมนู"
          >
            <Menu className="w-4 h-4" />
          </button>
          <PageHeaderOutlet fallbackTitle={PAGE_TITLES[effectiveTab]} />
        </header>

        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-6">
          {effectiveTab === 'blacklist' ? (
            /* เมนูเดียวที่ role 'user' เข้าถึงได้ — admin ก็เข้าได้เหมือนกัน */
            <div className="animate-fade-in">
              <Blacklist />
            </div>
          ) : effectiveTab === 'quoterequest' ? (
            <div className="animate-fade-in">
              <QuoteRequest />
            </div>
          ) : effectiveTab === 'approvals' ? (
            <div className="animate-fade-in">
              <PriceApprovals />
            </div>
          ) : effectiveTab === 'quotations' ? (
            <div className="animate-fade-in">
              <Quotations />
            </div>
          ) : LOG_TABS.has(effectiveTab) ? (
            /* 4 หน้าในกลุ่ม "บันทึกและรายงาน" ใช้กรอบเดียวกัน — แถบแท็บอยู่ใน LogsShell
               เมนูย่อยข้างซ้ายกับแท็บชี้ที่เดียวกัน (goTo ตัวเดียวกัน) ไม่มี state ซ้อน */
            <div className="animate-fade-in">
              <LogsShell tab={effectiveTab as LogTab} onTab={goTo} />
            </div>
          ) : effectiveTab === 'dashboard' ? (
            <div className="grid grid-cols-1 gap-6">
              {/* Welcome Card */}
              <div className="relative bg-gradient-to-br from-[var(--brand-fg)]/5 via-card to-card border border-slate-200 rounded-2xl p-4 sm:p-5 overflow-hidden shadow-sm">
                <div className="absolute top-0 right-0 w-56 h-56 bg-[var(--brand)]/5 rounded-full blur-[70px] pointer-events-none"></div>

                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 relative z-10">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: BRAND_SOFT, color: BRAND, borderColor: BRAND_BORDER, borderWidth: 1 }}
                    >
                      <LayoutDashboard className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold" style={{ color: BRAND }}>
                        ยินดีต้อนรับกลับสู่ระบบ
                      </p>
                      <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 leading-tight truncate">
                        สวัสดี, คุณ {user?.name || 'แอดมิน'} 👋
                      </h2>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 text-xs">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                      <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                      ระบบเปิดใช้งานปกติ
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-500">
                      สิทธิ์: <span className="font-semibold" style={{ color: BRAND }}>{user?.role}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Summary count cards */}
              {statsError && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{statsError}</span>
                </div>
              )}

              {/* Summary cards (left 2/3) + Sync panel (right 1/3) */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 items-start">
                <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
                  {SUMMARY_CARDS.map(({ key, label, unit, icon: Icon, onClick }) => {
                    const count = stats ? stats[key] : null;
                    return (
                      <button
                        key={key}
                        onClick={onClick}
                        className="text-left bg-card border border-slate-200 hover:border-[var(--brand-fg)]/40 rounded-2xl p-4 transition-all group cursor-pointer active:scale-[0.99] shadow-sm flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                            style={{ backgroundColor: BRAND_SOFT, color: BRAND }}
                          >
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="flex items-baseline gap-1">
                            {statsLoading || count === null ? (
                              <span className="inline-block w-10 h-7 rounded-md bg-slate-100 animate-pulse" />
                            ) : (
                              <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
                                {count.toLocaleString('th-TH')}
                              </span>
                            )}
                            <span className="text-xs font-medium text-slate-400">{unit}</span>
                          </div>
                        </div>
                        <h3 className="text-sm font-semibold text-slate-600 group-hover:text-slate-900 transition-colors">
                          {label}
                        </h3>
                      </button>
                    );
                  })}
                </div>

                {/* Sync data panel (right 1/3) */}
                <div className="lg:col-span-1">
                  <SyncPanel />
                </div>
              </div>
            </div>
          ) : effectiveTab === 'promotions' ? (
            <div className="animate-fade-in">
              <Promotions />
            </div>
          ) : effectiveTab === 'pricing' ? (
            <div className="animate-fade-in">
              <PricingLab />
            </div>
          ) : effectiveTab === 'productsdata' ? (
            <div className="animate-fade-in">
              <ProductsDirectory />
            </div>
          ) : effectiveTab === 'customersdata' ? (
            <div className="animate-fade-in">
              <CustomersDirectory />
            </div>
          ) : effectiveTab === 'odoocontacts' ? (
            <div className="animate-fade-in">
              <OdooContacts />
            </div>
          ) : effectiveTab === 'salespersons' ? (
            <div className="animate-fade-in">
              <Salespersons />
            </div>
          ) : effectiveTab === 'users' ? (
            <div className="animate-fade-in">
              <Users />
            </div>
          ) : effectiveTab === 'rolepermissions' ? (
            <div className="animate-fade-in">
              <RolePermissions />
            </div>
          ) : (
            <div className="animate-fade-in">
              {subTab === 'quotation' && <QuotationRules />}
              {subTab === 'optional' && <OptionalLinks />}
              {subTab === 'stock' && <StockRules />}
              {subTab === 'moq' && <ProductMoqRules />}
              {subTab === 'block' && <BlockRules />}
              {/* สองกฎคนละตาราง/คนละ endpoint แต่รวมหน้าเดียวกันเพราะแอดมินตั้งค่าทีเดียวจบ
                  อยากแยกหน้าเมื่อไหร่ก็ย้าย <CreditPolicy /> ไป subTab ใหม่ได้เลย
                  วางซ้าย-ขวาบนจอกว้าง (ทั้งคู่เป็นบล็อกแคบ max-w-3xl อยู่แล้ว) และเรียงบนลงล่างเมื่อจอแคบกว่า xl
                  ไม่ใส่ items-start เพื่อให้ grid ยืดสองคอลัมน์สูงเท่ากัน (ตัวหน้าเองจัดการ่วนที่ยืดด้วย flex-1) */}
              {subTab === 'shipping' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <ShippingFee />
                  <CreditPolicy />
                </div>
              )}
            </div>
          )}

        </main>
      </div>

      {changePasswordOpen && <ChangePasswordModal onClose={() => setChangePasswordOpen(false)} />}
    </div>
  );
}

export default function AdminApp() {
  return (
    <AuthProvider>
      {/* ช่องหัวเรื่องบนแถบบนเป็น state ร่วมของทั้งแอป — วางไว้เหนือ AdminContent ที่เดียว */}
      <PageHeaderProvider>
        <AdminContent />
      </PageHeaderProvider>
    </AuthProvider>
  );
}