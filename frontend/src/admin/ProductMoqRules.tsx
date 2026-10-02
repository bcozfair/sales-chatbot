import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  Plus, 
  Filter, 
  Pencil, 
  Trash2, 
  X, 
  Loader2, 
  CheckCircle2, 
  AlertTriangle, 
  ShoppingCart
} from 'lucide-react';
import { PageHeader } from './PageHeader';
import { Button } from './Button';
import { SortHeader, Pagination, RowAction, RowActions } from './logs/ui';
import { theadRowCls, thBaseCls } from './logs/format';
import { FilterBar, FilterSearch, FilterSelect } from './FilterBar';
import { ProductComboBox } from './ProductComboBox';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

interface ProductMoqRule {
  product_id: number;
  min_order_qty: number;
  sale_line_warn_msg: string;
  is_active: boolean;
  model: string;
  name: string;
  created_at: string;
  updated_at: string;
  internal_reference: string;
}

export const ProductMoqRules: React.FC = () => {
  const { token } = useAuth();
  const [rules, setRules] = useState<ProductMoqRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  /** '' = ทุกสถานะ · 'active' / 'inactive' ตรงกับคอลัมน์สถานะในตาราง */
  const [statusFilter, setStatusFilter] = useState('');

  // Sort State
  const [sortField, setSortField] = useState<string>('internal_reference');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modal / Form States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<ProductMoqRule | null>(null);
  const [editingRule, setEditingRule] = useState<ProductMoqRule | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [selectedProduct, setSelectedProduct] = useState<{ id: number; model: string; name: string; internal_reference?: string } | null>(null);
  const [minOrderQty, setMinOrderQty] = useState<number | ''>('');
  const [warnMsg, setWarnMsg] = useState('');
  const [isActive, setIsActive] = useState(true);

  // Fetch MOQ rules
  const fetchRules = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/moq-rules', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error('ไม่สามารถโหลดข้อมูลกฎ MOQ สินค้าได้');
      }
      const data = await response.json();
      setRules(data);
    } catch (err: unknown) {
      console.error("Fetch MOQ rules error:", err);
      const errMsg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล';
      setError(errMsg);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      const timer = setTimeout(() => {
        fetchRules();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [token, fetchRules]);

  // Toast helper
  const showToast = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  // Sort handler
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  // Open modal for Create
  const handleCreateOpen = () => {
    setEditingRule(null);
    setFormError(null);
    setSelectedProduct(null);
    setMinOrderQty('');
    setWarnMsg('');
    setIsActive(true);
    setIsModalOpen(true);
  };

  // Open modal for Edit
  const handleEditOpen = (rule: ProductMoqRule) => {
    setEditingRule(rule);
    setFormError(null);
    setSelectedProduct({
      id: rule.product_id,
      model: rule.model,
      name: rule.name,
      internal_reference: rule.internal_reference
    });
    setMinOrderQty(rule.min_order_qty);
    setWarnMsg(rule.sale_line_warn_msg);
    setIsActive(rule.is_active);
    setIsModalOpen(true);
  };

  // Open delete confirmation
  const handleDeleteOpen = (rule: ProductMoqRule) => {
    setRuleToDelete(rule);
    setIsDeleteConfirmOpen(true);
  };

  // Form Submit (Create or Update)
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct || minOrderQty === '' || !warnMsg.trim()) {
      setFormError('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน');
      return;
    }
    if (Number(minOrderQty) <= 0) {
      setFormError('จำนวนสั่งซื้อขั้นต่ำ (MOQ) ต้องมีค่ามากกว่า 0');
      return;
    }
    if (!selectedProduct.internal_reference || selectedProduct.internal_reference.trim() === '' || selectedProduct.internal_reference === 'N/A') {
      setFormError('สินค้านี้ไม่มีรหัสอ้างอิงภายใน (Internal Reference) ที่ถูกต้อง ไม่สามารถตั้งกฎ MOQ ได้');
      return;
    }

    setFormError(null);
    setIsSaving(true);

    const payload = {
      internal_reference: selectedProduct.internal_reference,
      min_order_qty: Number(minOrderQty),
      sale_line_warn_msg: warnMsg.trim(),
      is_active: isActive
    };

    try {
      const url = editingRule 
        ? `/api/admin/moq-rules/${editingRule.internal_reference}` 
        : '/api/admin/moq-rules';
      
      const method = editingRule ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
      }

      setIsModalOpen(false);
      showToast(editingRule ? 'แก้ไขข้อมูลกฎ MOQ สำเร็จ' : 'สร้างกฎ MOQ สำหรับสินค้าสำเร็จ');
      fetchRules();
    } catch (err: unknown) {
      console.error("Save MOQ rule error:", err);
      const errMsg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล';
      setFormError(errMsg);
    } finally {
      setIsSaving(false);
    }
  };

  // Confirm delete
  const handleDeleteConfirm = async () => {
    if (!ruleToDelete) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/admin/moq-rules/${ruleToDelete.internal_reference}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'ไม่สามารถลบกฎนี้ได้');
      }

      setIsDeleteConfirmOpen(false);
      setRuleToDelete(null);
      showToast('ลบกฎ MOQ สินค้าสำเร็จเรียบร้อย');
      fetchRules();
    } catch (err: unknown) {
      console.error("Delete MOQ rule error:", err);
      const errMsg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการลบข้อมูล';
      setError(errMsg);
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle active status directly
  const handleToggleActive = async (rule: ProductMoqRule) => {
    try {
      const response = await fetch(`/api/admin/moq-rules/${rule.internal_reference}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          min_order_qty: rule.min_order_qty,
          sale_line_warn_msg: rule.sale_line_warn_msg,
          is_active: !rule.is_active
        })
      });

      if (!response.ok) {
        throw new Error('ไม่สามารถแก้ไขสถานะการใช้งานได้');
      }

      setRules(prev => prev.map(r => r.internal_reference === rule.internal_reference ? { ...r, is_active: !r.is_active } : r));
      showToast(`แก้ไขสถานะกฎ MOQ ของรุ่น "${rule.model}" สำเร็จ`);
    } catch (err: unknown) {
      console.error("Toggle active MOQ error:", err);
      const errMsg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการแก้ไขสถานะ';
      setError(errMsg);
    }
  };

  // Filter and Sort rules
  const filteredRules = rules.filter(rule => {
    if (statusFilter && (statusFilter === 'active') !== rule.is_active) return false;
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      rule.model.toLowerCase().includes(q) ||
      rule.name.toLowerCase().includes(q) ||
      (rule.internal_reference && rule.internal_reference.toLowerCase().includes(q)) ||
      rule.sale_line_warn_msg.toLowerCase().includes(q)
    );
  });

  const sortedRules = [...filteredRules].sort((a, b) => {
    let aVal: string | number = '';
    let bVal: string | number = '';

    if (sortField === 'internal_reference') {
      aVal = a.internal_reference || '';
      bVal = b.internal_reference || '';
    } else if (sortField === 'model') {
      aVal = a.model;
      bVal = b.model;
    } else if (sortField === 'name') {
      aVal = a.name;
      bVal = b.name;
    } else if (sortField === 'moq') {
      aVal = a.min_order_qty;
      bVal = b.min_order_qty;
    } else if (sortField === 'warn_msg') {
      aVal = a.sale_line_warn_msg;
      bVal = b.sale_line_warn_msg;
    } else if (sortField === 'is_active') {
      aVal = a.is_active ? 1 : 0;
      bVal = b.is_active ? 1 : 0;
    }

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortDirection === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  // Pagination derived values
  const totalItems = sortedRules.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const paginatedRules = sortedRules.slice(startIdx, startIdx + pageSize);

  return (
    <div className="space-y-4">
      {/* Toast popup alert */}
      {successMsg && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-xl transition-all border animate-fade-in bg-emerald-50 border-emerald-200 text-emerald-800">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span className="text-sm font-semibold">{successMsg}</span>
        </div>
      )}

      <PageHeader
        icon={ShoppingCart}
        title="กฎสั่งซื้อขั้นต่ำรายสินค้า (MOQ)"
        description="กำหนดจำนวนขั้นต่ำและข้อความเตือนรายชิ้น"
      >
        <Button
          variant="primary"
          icon={Plus}
          onClick={handleCreateOpen}
          aria-label="สร้างกฎใหม่"
          className="flex-shrink-0"
        >
          <span className="hidden sm:inline">สร้างกฎใหม่</span>
        </Button>
      </PageHeader>

      <FilterBar
        columns="grid-cols-1 sm:grid-cols-[2.4fr_1fr]"
        active={!!(searchQuery || statusFilter)}
        onClear={() => { setSearchQuery(''); setStatusFilter(''); setCurrentPage(1); }}
      >
        <FilterSearch
          placeholder="ค้นหารหัส / รุ่น / ชื่อสินค้า / ข้อความเตือน"
          value={searchQuery}
          onChange={(v) => { setSearchQuery(v); setCurrentPage(1); }}
        />
        <FilterSelect
          aria-label="กรองตามสถานะของกฎ"
          icon={Filter}
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}
        >
          <option value="">สถานะทั้งหมด</option>
          <option value="active">เปิดใช้งาน</option>
          <option value="inactive">ปิดใช้งาน</option>
        </FilterSelect>
      </FilterBar>

      {/* Loading & Empty States */}
      {isLoading ? (
        <div className="bg-card border border-slate-200 rounded-2xl p-10 text-center shadow-sm flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-7 h-7 text-[var(--brand-fg)] animate-spin" />
          <p className="text-slate-500 text-sm font-medium">กำลังโหลดกฎสั่งซื้อขั้นต่ำ MOQ...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center text-red-800 shadow-sm flex flex-col items-center justify-center gap-2">
          <AlertTriangle className="w-9 h-9 text-red-600" />
          <p className="font-bold">เกิดข้อผิดพลาดในการดึงข้อมูล</p>
          <p className="text-sm text-red-600">{error}</p>
        </div>
      ) : sortedRules.length === 0 ? (
        <div className="bg-card border border-slate-200 rounded-2xl p-10 text-center shadow-sm text-slate-500 flex flex-col items-center justify-center gap-2">
          <ShoppingCart className="w-9 h-9 text-slate-300" />
          <p className="font-bold">ไม่พบกฎ MOQ ของสินค้า</p>
          <p className="text-xs">สินค้าที่ไม่มีในตารางนี้จะสามารถสั่งซื้อในจำนวนเท่าใดก็ได้ตามปกติ</p>
        </div>
      ) : (
        /* Rules Table */
        <div className="bg-card border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10">
                <tr className={theadRowCls}>
                  <SortHeader label="รหัส (Internal Ref.)" col="internal_reference" active={sortField} dir={sortDirection} onSort={handleSort} pad="px-4 py-3" />
                  <SortHeader label="ชื่อสินค้า" col="name" active={sortField} dir={sortDirection} onSort={handleSort} pad="px-4 py-3" />
                  <SortHeader label="ขั้นต่ำ (MOQ)" col="moq" active={sortField} dir={sortDirection} onSort={handleSort} pad="px-4 py-3" align="center" className="w-36" />
                  <SortHeader label="ข้อความแจ้งเตือน" col="warn_msg" active={sortField} dir={sortDirection} onSort={handleSort} pad="px-4 py-3" align="center" />
                  <SortHeader label="สถานะ" col="is_active" active={sortField} dir={sortDirection} onSort={handleSort} pad="px-4 py-3" align="center" className="w-28" />
                  <th className={`${thBaseCls} px-4 py-3 text-right w-20`}>การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                {paginatedRules.map((rule) => (
                  <tr key={rule.internal_reference} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-2.5 font-mono font-bold text-slate-800">{rule.internal_reference}</td>
                    <td className="px-4 py-2.5 align-top">
                      <div className="font-semibold text-slate-900 text-[13px] font-mono">{rule.model}</div>
                      <div className="text-[11px] text-slate-500 line-clamp-1">{rule.name}</div>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-flex items-center px-2.5 py-0.5 bg-sky-50 border border-sky-200 text-sky-700 rounded-full text-[11px] font-bold whitespace-nowrap">
                        {rule.min_order_qty.toLocaleString()} ชิ้น
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-block px-2 py-0.5 bg-yellow-50 border border-yellow-200 text-yellow-800 text-[11px] font-semibold rounded-full max-w-[220px] truncate" title={rule.sale_line_warn_msg}>
                        {rule.sale_line_warn_msg}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => handleToggleActive(rule)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all ${
                          rule.is_active
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-slate-50 border-slate-200 text-slate-400'
                        }`}
                      >
                        {rule.is_active ? 'เปิด' : 'ปิด'}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <RowActions>
                        <RowAction icon={Pencil} label="แก้ไขข้อมูลกฎ MOQ" onClick={() => handleEditOpen(rule)} />
                        <RowAction icon={Trash2} label="ลบกฎ MOQ" tone="danger" onClick={() => handleDeleteOpen(rule)} />
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={safePage}
            pages={totalPages}
            size={pageSize}
            total={totalItems}
            sizes={PAGE_SIZE_OPTIONS}
            onPage={setCurrentPage}
            onSize={n => { setPageSize(n); setCurrentPage(1); }}
          />
        </div>
      )}

      {/* Edit/Create Modal Form */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-slate-200 w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  {editingRule ? 'แก้ไขกฎ MOQ รายสินค้า' : 'สร้างกฎ MOQ สินค้าใหม่'}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">กำหนดจำนวนสั่งซื้อขั้นต่ำและข้อความเตือน</p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {formError && (
                  <div className="bg-red-50 border border-red-100 text-red-700 p-3.5 rounded-xl flex items-start gap-2.5 text-xs">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                {/* Product ComboBox */}
                <ProductComboBox
                  label="เลือกสินค้าที่จะกำหนดขั้นต่ำ (MOQ)"
                  placeholder={editingRule ? "รุ่นสินค้าเป้าหมาย" : "เลือกสินค้าเป้าหมาย..."}
                  value={selectedProduct}
                  onChange={setSelectedProduct}
                  error={!!formError && !selectedProduct}
                  disabled={!!editingRule}
                />

                {/* MOQ Quantity Input */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    จำนวนสั่งซื้อขั้นต่ำ (Minimum Order Quantity)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={minOrderQty}
                    onChange={(e) => setMinOrderQty(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="เช่น 10, 50, 100..."
                    className="w-full h-9 px-3 bg-card border border-slate-200 focus:border-[var(--brand-fg)] rounded-xl text-sm text-slate-800 outline-none transition-all focus:ring-2 focus:ring-[var(--brand-fg)]/10"
                  />
                </div>

                {/* Warning message text input */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    ข้อความเตือนเมื่อสั่งซื้อไม่ถึงขั้นต่ำ (Warning Message)
                  </label>
                  <input
                    type="text"
                    value={warnMsg}
                    onChange={(e) => setWarnMsg(e.target.value)}
                    placeholder="เช่น *** สั่งซื้อขั้นต่ำ 10 ชิ้นขึ้นไป ***"
                    className="w-full h-9 px-3 bg-card border border-slate-200 focus:border-[var(--brand-fg)] rounded-xl text-sm text-slate-800 outline-none transition-all focus:ring-2 focus:ring-[var(--brand-fg)]/10"
                  />
                </div>

                {/* Active toggle */}
                <label className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border cursor-pointer transition-all bg-slate-50 border-slate-200 hover:border-slate-300">
                  <div>
                    <p className="text-xs font-bold text-slate-700">สถานะเปิดใช้งานกฎนี้</p>
                    <p className="text-[10px] text-slate-400">บอท LINE จะปฏิเสธการเสนอขายหากสั่งสินค้าชิ้นนี้ต่ำกว่าขั้นต่ำ</p>
                  </div>
                  <div className={`relative w-9 h-5 rounded-full flex-shrink-0 transition-colors ${isActive ? 'bg-[var(--brand)]' : 'bg-slate-300'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-card rounded-full shadow-sm transition-all ${isActive ? 'left-4' : 'left-0.5'}`} />
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={e => setIsActive(e.target.checked)}
                      className="sr-only"
                    />
                  </div>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl">
                <Button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                >
                  ยกเลิก
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  busy={isSaving}
                >
                  {editingRule ? 'บันทึกการแก้ไข' : 'บันทึกข้อมูล'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {isDeleteConfirmOpen && ruleToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-slate-200 w-full max-w-sm shadow-2xl">
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
                <Trash2 className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">ยืนยันการลบกฎ MOQ</h3>
              <p className="text-xs text-slate-500 mt-1">
                ต้องการลบกฎสั่งซื้อขั้นต่ำของสินค้า <span className="font-bold text-slate-800">"{ruleToDelete.model}"</span> หรือไม่?
                การลบจะทำให้เซลส์ทำรายการสินค้านี้ในจำนวนใดก็ได้ตามปกติโดยไม่มีขั้นต่ำกำกับ
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl">
              <Button
                type="button"
                onClick={() => setIsDeleteConfirmOpen(false)}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                onClick={handleDeleteConfirm}
                variant="danger"
                busy={isSaving}
              >
                ยืนยันการลบ
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
