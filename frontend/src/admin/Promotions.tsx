import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { DateInput } from './DateInput';
import { FilterBar, FilterSearch, FilterSelect, FilterDateRange } from './FilterBar';
import { 
  Tag, 
  Plus, 
  Pencil, 
  Trash2, 
  ToggleLeft, 
  ToggleRight, 
  X, 
  Percent, 
  DollarSign, 
  Target, 
  Calendar, 
  AlertCircle, 
  Loader2, 
  CheckCircle2,
  Users,
  Building2,
  Package,
  ShoppingCart,
  Download,
  Upload,
  Info,
  Filter
} from 'lucide-react';
import { PageHeader } from './PageHeader';
import { Button } from './Button';
import { SortHeader, Pagination, RowAction, RowActions } from './logs/ui';
import { theadRowCls, thBaseCls } from './logs/format';

interface Promotion {
  id: number;
  code: string;
  name: string;
  description: string | null;
  discount_type: 'percent' | 'fixed' | 'override';
  discount_value: number;
  product_code: string | null;
  customer_type: string | null;
  customer_refs: string | null;
  min_qty: number;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface CustomerRefOption {
  reference: string;
  display_name: string;
}

// Reusable Multi-Select Search Dropdown Component (for string values)
interface MultiSelectSearchProps {
  label: string;
  placeholder: string;
  selectedValues: string[];
  onChange: (values: string[]) => void;
  searchUrl: string;
  token: string | null;
  icon: React.ReactNode;
}

const MultiSelectSearch: React.FC<MultiSelectSearchProps> = ({
  label,
  placeholder,
  selectedValues,
  onChange,
  searchUrl,
  token,
  icon
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchResults = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`${searchUrl}?q=${encodeURIComponent(query)}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          // Filter out already selected values
          setResults(data.filter((val: string) => !selectedValues.includes(val)));
        }
      } catch (err) {
        console.error("Fetch search results error:", err);
      } finally {
        setIsLoading(false);
      }
    };

    if (isOpen) {
      const timer = setTimeout(fetchResults, 200);
      return () => clearTimeout(timer);
    }
  }, [query, isOpen, selectedValues, searchUrl, token]);

  const removeValue = (val: string) => {
    onChange(selectedValues.filter(v => v !== val));
  };

  const addValue = (val: string) => {
    const trimmed = val.trim();
    if (trimmed && !selectedValues.includes(trimmed)) {
      onChange([...selectedValues, trimmed]);
    }
    setQuery('');
  };

  return (
    <div className="relative space-y-1.5">
      <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
        {label}
      </label>
      
      {/* Selected Tags list */}
      <div className="flex flex-wrap gap-1.5 p-2 bg-card border border-slate-200 rounded-xl min-h-[46px] focus-within:border-[var(--brand-fg)] focus-within:ring-2 focus-within:ring-[var(--brand-fg)]/10 transition-all">
        <span className="flex items-center text-slate-400 pl-1.5 pr-0.5">
          {icon}
        </span>
        {selectedValues.map(val => (
          <span key={val} className="inline-flex items-center gap-1 bg-slate-100 text-slate-800 text-xs px-2 py-1 rounded-lg border border-slate-200">
            {val}
            <button 
              type="button" 
              onClick={() => removeValue(val)} 
              className="text-slate-400 hover:text-red-500 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        
        {/* Search Input inside tag area */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          placeholder={selectedValues.length === 0 ? placeholder : "พิมพ์ค้นหาเพิ่ม..."}
          className="flex-1 bg-transparent text-sm text-slate-800 focus:outline-none min-w-[120px] py-0.5 px-1"
        />
      </div>

      {/* Dropdown list */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-card border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto divide-y divide-slate-100">
          {/* Custom value input add option */}
          {query.trim() && !selectedValues.includes(query.trim()) && (
            <button
              type="button"
              onMouseDown={() => addValue(query.trim())}
              className="w-full text-left px-4 py-2.5 text-xs text-[var(--brand-fg)] bg-emerald-50/30 hover:bg-emerald-50 transition-colors font-semibold flex items-center justify-between"
            >
              <span>เพิ่มค่ากำหนดเอง: "{query.trim()}"</span>
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}

          {isLoading ? (
            <div className="p-3 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 text-[var(--brand-fg)] animate-spin" />
              กำลังโหลดข้อมูล...
            </div>
          ) : results.length === 0 ? (
            !query.trim() ? (
              <div className="p-3 text-center text-xs text-slate-400">
                เริ่มพิมพ์เพื่อค้นหาตัวเลือกในฐานข้อมูล
              </div>
            ) : null
          ) : (
            results.map(val => (
              <button
                key={val}
                type="button"
                onMouseDown={() => addValue(val)}
                className="w-full text-left px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors font-medium flex items-center justify-between"
              >
                <span>{val}</span>
                <Plus className="w-3.5 h-3.5 text-slate-400" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// Customer Multi-Select Search Component (searches by reference/display_name and stores references)
interface CustomerRefSelectProps {
  label: string;
  placeholder: string;
  selectedRefs: CustomerRefOption[];
  onChange: (refs: CustomerRefOption[]) => void;
  token: string | null;
}

const CustomerRefMultiSelect: React.FC<CustomerRefSelectProps> = ({
  label,
  placeholder,
  selectedRefs,
  onChange,
  token
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerRefOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchResults = async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      setIsLoading(true);
      try {
        const response = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(query)}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const data: CustomerRefOption[] = await response.json();
          // Filter out already selected references
          const selectedRefsSet = new Set(selectedRefs.map(r => r.reference));
          setResults(data.filter(r => !selectedRefsSet.has(r.reference)));
        }
      } catch (err) {
        console.error("Fetch customer search results error:", err);
      } finally {
        setIsLoading(false);
      }
    };

    if (isOpen) {
      const timer = setTimeout(fetchResults, 200);
      return () => clearTimeout(timer);
    }
  }, [query, isOpen, selectedRefs, token]);

  const removeRef = (ref: string) => {
    onChange(selectedRefs.filter(r => r.reference !== ref));
  };

  const addRef = (option: CustomerRefOption) => {
    if (option.reference && !selectedRefs.find(r => r.reference === option.reference)) {
      onChange([...selectedRefs, option]);
    }
    setQuery('');
  };

  return (
    <div className="relative space-y-1.5">
      <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
        {label}
      </label>
      
      {/* Selected Tags list */}
      <div className="flex flex-wrap gap-1.5 p-2 bg-card border border-slate-200 rounded-xl min-h-[46px] focus-within:border-[var(--brand-fg)] focus-within:ring-2 focus-within:ring-[var(--brand-fg)]/10 transition-all">
        <span className="flex items-center text-slate-400 pl-1.5 pr-0.5">
          <Users className="w-4 h-4" />
        </span>
        {selectedRefs.map(opt => (
          <span key={opt.reference} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-lg border border-blue-200">
            {opt.reference} ({opt.display_name})
            <button 
              type="button" 
              onClick={() => removeRef(opt.reference)} 
              className="text-blue-400 hover:text-red-500 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        
        {/* Search Input inside tag area */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          placeholder={selectedRefs.length === 0 ? placeholder : "พิมพ์ค้นหาเพิ่ม..."}
          className="flex-1 bg-transparent text-sm text-slate-800 focus:outline-none min-w-[120px] py-0.5 px-1"
        />
      </div>

      {/* Dropdown list */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-card border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto divide-y divide-slate-100">
          {isLoading ? (
            <div className="p-3 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 text-[var(--brand-fg)] animate-spin" />
              กำลังโหลดข้อมูล...
            </div>
          ) : results.length === 0 ? (
            !query.trim() ? (
              <div className="p-3 text-center text-xs text-slate-400">
                เริ่มพิมพ์เพื่อค้นหาลูกค้าในฐานข้อมูล
              </div>
            ) : (
              <div className="p-3 text-center text-xs text-slate-400">
                ไม่พบลูกค้าที่ค้นหา
              </div>
            )
          ) : (
            results.map(opt => (
              <button
                key={opt.reference}
                type="button"
                onMouseDown={() => addRef(opt)}
                className="w-full text-left px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors font-medium flex items-center justify-between"
              >
                <div className="flex flex-col">
                  <span className="font-semibold">{opt.display_name}</span>
                  <span className="text-[10px] text-slate-400 font-mono">{opt.reference}</span>
                </div>
                <Plus className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return 'ไม่มีวันหมดอายุ';
  const d = new Date(dateStr);
  return d.toLocaleDateString('th-TH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const renderDateRange = (startDate: string | null, endDate: string | null) => {
  if (!startDate && !endDate) return 'ไม่จำกัด';
  const start = startDate ? formatDate(startDate) : 'เริ่มเมื่อใดก็ได้';
  const end = endDate ? formatDate(endDate) : 'ไม่จำกัด';
  
  if (start === 'ไม่มีวันหมดอายุ' && end === 'ไม่มีวันหมดอายุ') {
    return 'ไม่จำกัด';
  }
  if (start === 'ไม่มีวันหมดอายุ') return `ถึง ${end}`;
  if (end === 'ไม่มีวันหมดอายุ' || end === 'ไม่จำกัด') return `${start} - ไม่จำกัด`;
  return `${start} - ${end}`;
};


export const Promotions: React.FC = () => {
  const { token } = useAuth();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPromoForDetails, setSelectedPromoForDetails] = useState<Promotion | null>(null);
  const [sortField, setSortField] = useState<string>('id');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Filter state
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Modal & Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [promoToDelete, setPromoToDelete] = useState<Promotion | null>(null);
  const [editingPromo, setEditingPromo] = useState<Promotion | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed' | 'override'>('percent');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [selectedCustomerRefs, setSelectedCustomerRefs] = useState<CustomerRefOption[]>([]);
  const [minQty, setMinQty] = useState<number>(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isActive, setIsActive] = useState(true);

  // Fetch all promotions
  const fetchPromotions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/promotions', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error('ไม่สามารถดึงข้อมูลโปรโมชันได้');
      }
      const data = await response.json();
      setPromotions(data);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล';
      console.error(err);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      const timer = setTimeout(() => {
        fetchPromotions();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [token, fetchPromotions]);

  // Open modal for Create
  const handleCreateOpen = () => {
    setEditingPromo(null);
    setFormError(null);
    setCode('');
    setName('');
    setDescription('');
    setDiscountType('percent');
    setDiscountValue(0);
    setSelectedProducts([]);
    setSelectedCustomers([]);
    setSelectedCustomerRefs([]);
    setMinQty(0);
    setStartDate('');
    setEndDate('');
    setIsActive(true);
    setIsModalOpen(true);
  };

  // Open modal for Edit
  const handleEditOpen = (promo: Promotion) => {
    setEditingPromo(promo);
    setFormError(null);
    setCode(promo.code);
    setName(promo.name);
    setDescription(promo.description || '');
    setDiscountType(promo.discount_type);
    setDiscountValue(promo.discount_value);
    
    // Parse comma-separated strings back to arrays
    setSelectedProducts(promo.product_code ? promo.product_code.split(',').map(s => s.trim()).filter(Boolean) : []);
    setSelectedCustomers(promo.customer_type ? promo.customer_type.split(',').map(s => s.trim()).filter(Boolean) : []);
    
    // Parse customer_refs comma-separated references (we don't have display_name in DB, just references)
    // For display, we parse references and show them as tags with ref codes only
    const refs = promo.customer_refs ? promo.customer_refs.split(',').map(s => s.trim()).filter(Boolean) : [];
    setSelectedCustomerRefs(refs.map(ref => ({ reference: ref, display_name: ref })));
    
    setMinQty(promo.min_qty);
    setStartDate(promo.start_date ? promo.start_date.split('T')[0] : '');
    setEndDate(promo.end_date ? promo.end_date.split('T')[0] : '');
    setIsActive(promo.is_active);
    setIsModalOpen(true);
  };

  // Open delete confirmation
  const handleDeleteOpen = (promo: Promotion) => {
    setPromoToDelete(promo);
    setIsDeleteConfirmOpen(true);
  };

  // Form Submit (Create or Update)
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim() || discountValue === undefined) {
      setFormError('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน');
      return;
    }

    setFormError(null);
    setIsSaving(true);

    const payload = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      description: description.trim() || null,
      discount_type: discountType,
      discount_value: Number(discountValue),
      product_code: selectedProducts.join(',') || null,
      customer_type: selectedCustomers.join(',') || null,
      customer_refs: selectedCustomerRefs.map(r => r.reference).join(',') || null,
      min_qty: Number(minQty),
      start_date: startDate ? new Date(startDate).toISOString() : null,
      end_date: endDate ? new Date(endDate).toISOString() : null,
      is_active: isActive
    };

    try {
      const url = editingPromo 
        ? `/api/admin/promotions/${editingPromo.id}` 
        : '/api/admin/promotions';
      
      const method = editingPromo ? 'PUT' : 'POST';

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
      showToast(editingPromo ? 'แก้ไขโปรโมชันสำเร็จเรียบร้อย' : 'เพิ่มโปรโมชันใหม่สำเร็จเรียบร้อย');
      fetchPromotions();
    } catch (err: unknown) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล';
      setFormError(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  // Delete Promotion
  const handleDeleteConfirm = async () => {
    if (!promoToDelete) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/admin/promotions/${promoToDelete.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'ไม่สามารถลบโปรโมชันได้');
      }

      setIsDeleteConfirmOpen(false);
      setPromoToDelete(null);
      showToast('ลบโปรโมชันสำเร็จเรียบร้อย');
      fetchPromotions();
    } catch (err: unknown) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการลบโปรโมชัน';
      setError(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle active state directly from table
  const handleToggleActive = async (promo: Promotion) => {
    try {
      const response = await fetch(`/api/admin/promotions/${promo.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...promo,
          is_active: !promo.is_active,
          start_date: promo.start_date ? new Date(promo.start_date).toISOString() : null,
          end_date: promo.end_date ? new Date(promo.end_date).toISOString() : null
        })
      });

      if (!response.ok) {
        throw new Error('ไม่สามารถอัปเดตสถานะได้');
      }

      setPromotions(prev => prev.map(p => p.id === promo.id ? { ...p, is_active: !p.is_active } : p));
      showToast(`เปลี่ยนสถานะโปรโมชัน "${promo.code}" สำเร็จ`);
    } catch (err: unknown) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการแก้ไขสถานะ';
      setError(errorMessage);
    }
  };

  // Export CSV
  const handleExportCsv = async (code?: string) => {
    if (!token) return;
    try {
      showToast(code ? `กำลังเตรียมไฟล์ CSV สำหรับโปรโมชัน ${code}...` : 'กำลังเตรียมไฟล์ CSV สำหรับส่งออก...');
      const urlPath = code 
        ? `/api/admin/promotions/export?code=${encodeURIComponent(code)}`
        : '/api/admin/promotions/export';
      
      const response = await fetch(urlPath, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error('ไม่สามารถส่งออกไฟล์ได้');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = code 
        ? `promotion_${code}_export_${new Date().toISOString().split('T')[0]}.csv`
        : `promotions_export_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('ส่งออกไฟล์ CSV สำเร็จ');
    } catch (err: unknown) {
      console.error('Export CSV error:', err);
      const errMsg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการส่งออก CSV';
      setError(errMsg);
    }
  };

  // Import CSV specifically into the current editing form
  const handleModalImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setFormError(null);
      showToast('กำลังอ่านข้อมูลเงื่อนไขจาก CSV...');
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      if (lines.length < 2) {
        throw new Error('ไฟล์ CSV มีข้อมูลไม่เพียงพอ');
      }

      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      
      const newProducts: string[] = [];
      const newCustomerTypes: string[] = [];
      const newCustomerRefs: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        // Parse CSV line respecting quotes
        const values: string[] = [];
        let current = '';
        let inQuotes = false;
        for (const char of lines[i]) {
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());

        headers.forEach((header, idx) => {
          let val = values[idx] || '';
          val = val.replace(/^"|"$/g, '').trim();
          if (!val) return;

          if (header === 'product_code') {
            if (!newProducts.includes(val)) newProducts.push(val);
          } else if (header === 'customer_type') {
            if (!newCustomerTypes.includes(val)) newCustomerTypes.push(val);
          } else if (header === 'customer_refs') {
            if (!newCustomerRefs.includes(val)) newCustomerRefs.push(val);
          }
          
          // Populate main fields from first row
          if (i === 1) {
            if (header === 'name' && val) setName(val);
            if (header === 'description' && val) setDescription(val);
            if (header === 'discount_type' && val) {
              const dt = val.toLowerCase();
              if (dt === 'percent' || dt === 'fixed' || dt === 'override') {
                setDiscountType(dt as 'percent' | 'fixed' | 'override');
              }
            }
            if (header === 'discount_value' && val) setDiscountValue(parseFloat(val) || 0);
            if (header === 'min_qty' && val) setMinQty(parseInt(val, 10) || 0);
            if (header === 'start_date' && val) setStartDate(val.split('T')[0]);
            if (header === 'end_date' && val) setEndDate(val.split('T')[0]);
          }
        });
      }

      if (newProducts.length > 0) setSelectedProducts(newProducts);
      if (newCustomerTypes.length > 0) setSelectedCustomers(newCustomerTypes);
      if (newCustomerRefs.length > 0) {
        setSelectedCustomerRefs(newCustomerRefs.map(ref => ({ reference: ref, display_name: ref })));
      }

      showToast('นำเข้าข้อมูลเงื่อนไขลงฟอร์มสำเร็จเรียบร้อย');
    } catch (err: unknown) {
      console.error('Modal CSV Import error:', err);
      const errMsg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการนำเข้า CSV';
      setFormError(errMsg);
    } finally {
      e.target.value = '';
    }
  };

  // Toast handler
  const showToast = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  // Filter promotions by search query, status, and date range
  const filteredPromotions = promotions.filter((promo) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = (
      promo.code.toLowerCase().includes(q) ||
      promo.name.toLowerCase().includes(q) ||
      (promo.description && promo.description.toLowerCase().includes(q)) ||
      (promo.product_code && promo.product_code.toLowerCase().includes(q)) ||
      (promo.customer_refs && promo.customer_refs.toLowerCase().includes(q))
    );

    // Status filter
    if (statusFilter === 'active' && !promo.is_active) return false;
    if (statusFilter === 'inactive' && promo.is_active) return false;

    // Date range filter
    if (dateFrom && promo.start_date) {
      const promoStart = new Date(promo.start_date).toISOString().split('T')[0];
      if (promoStart < dateFrom) return false;
    }
    if (dateTo && promo.start_date) {
      const promoStart = new Date(promo.start_date).toISOString().split('T')[0];
      if (promoStart > dateTo) return false;
    }

    return matchesSearch;
  });

  const sortedPromotions = [...filteredPromotions].sort((a, b) => {
    let aValue: string | number | boolean | null = a[sortField as keyof Promotion];
    let bValue: string | number | boolean | null = b[sortField as keyof Promotion];

    if (sortField === 'status') {
      aValue = a.is_active ? 1 : 0;
      bValue = b.is_active ? 1 : 0;
    }

    if (aValue === null || aValue === undefined) return sortDirection === 'asc' ? 1 : -1;
    if (bValue === null || bValue === undefined) return sortDirection === 'asc' ? -1 : 1;

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortDirection === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }

    const aNum = typeof aValue === 'number' ? aValue : Number(aValue);
    const bNum = typeof bValue === 'number' ? bValue : Number(bValue);

    return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
  });

  // Pagination derived values
  const totalItems = sortedPromotions.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const paginatedPromotions = sortedPromotions.slice(startIdx, startIdx + pageSize);

  // Helpers
  const formatDiscount = (type: string, val: number) => {
    if (type === 'percent') return `${val}%`;
    if (type === 'fixed') return `฿${val.toLocaleString()}`;
    if (type === 'override') return `ราคาลดเหลือ ฿${val.toLocaleString()}`;
    return `${val}`;
  };



  return (
    <div className="space-y-4">
      {/* Success Alert (Toast) */}
      {successMsg && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 bg-card border border-slate-200 border-l-4 border-l-[var(--brand-fg)] p-4 rounded-2xl shadow-xl shadow-slate-200/50 text-slate-800 text-sm animate-fade-in">
          <CheckCircle2 className="w-5 h-5 text-[var(--brand-fg)]" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* หัวเรื่อง + ปุ่ม action ขึ้นไปอยู่บนแถบบน (ดู PageHeader.tsx) เหลือแค่การ์ดตัวกรองในเนื้อหา */}
      <PageHeader
        icon={Tag}
        title="จัดการโปรโมชันส่วนลด"
        description="สร้าง ปรับปรุง หรือระงับโปรโมชันส่วนลดพิเศษสำหรับลูกค้า"
      >
        <Button
          icon={Download}
          onClick={() => handleExportCsv()}
          aria-label="ส่งออก csv"
          className="flex-shrink-0"
        >
          <span className="hidden sm:inline">ส่งออก csv</span>
        </Button>
        <Button
          id="add-promo-btn"
          variant="primary"
          icon={Plus}
          onClick={handleCreateOpen}
          aria-label="สร้างโปรโมชันใหม่"
          className="flex-shrink-0"
        >
          <span className="hidden sm:inline">สร้างโปรโมชันใหม่</span>
        </Button>
      </PageHeader>

      {/* Filters — การ์ดร่วมชุดเดียวกับหน้าประวัติใบเสนอราคา (admin/FilterBar.tsx)
          ปฏิทินสองช่องยุบเป็นกล่องช่วงเดียวตามต้นแบบ และคอลัมน์กว้างตามของที่อยู่ข้างใน
          (ของเดิมเป็น 4 คอลัมน์เท่ากันหมด ช่องค้นหาจึงแคบเท่าช่องวันที่ทั้งที่ข้อความยาวกว่าสามเท่า) */}
      <FilterBar
        columns="grid-cols-1 sm:grid-cols-2 xl:grid-cols-[1.8fr_1fr_1.5fr]"
        active={!!(searchQuery || statusFilter || dateFrom || dateTo)}
        onClear={() => {
          setSearchQuery('');
          setStatusFilter('');
          setDateFrom('');
          setDateTo('');
          setCurrentPage(1);
        }}
      >
        <FilterSearch
          id="promo-search-input"
          placeholder="ค้นหาชื่อแคมเปญ / รหัสแคมเปญ / รหัสรุ่นสินค้า"
          value={searchQuery}
          onChange={(v) => { setSearchQuery(v); setCurrentPage(1); }}
        />

        <FilterSelect
          id="promo-status-filter"
          aria-label="กรองตามสถานะโปรโมชัน"
          icon={Filter}
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}
        >
          <option value="">สถานะทั้งหมด</option>
          <option value="active">เปิดใช้งาน</option>
          <option value="inactive">ปิดใช้งาน</option>
        </FilterSelect>

        <FilterDateRange
          icon={Calendar}
          from={dateFrom}
          to={dateTo}
          onFrom={(v) => { setDateFrom(v); setCurrentPage(1); }}
          onTo={(v) => { setDateTo(v); setCurrentPage(1); }}
        />
      </FilterBar>

      {/* Error Alert */}
      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-100 p-4 rounded-2xl text-red-800 text-sm shadow-sm">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="bg-card border border-slate-200 rounded-2xl p-10 text-center shadow-sm flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-7 h-7 text-[var(--brand-fg)] animate-spin" />
          <p className="text-slate-500 text-sm font-medium">กำลังค้นหาข้อมูล...</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && filteredPromotions.length === 0 && (
        <div className="bg-card border border-slate-200 rounded-2xl p-10 text-center shadow-sm text-slate-500 flex flex-col items-center justify-center gap-2">
          <Tag className="w-9 h-9 text-slate-300" />
          <p className="font-bold">ไม่พบรายการโปรโมชัน</p>
          <p className="text-xs">ลองปรับเปลี่ยนตัวกรองหรือค้นหาด้วยคำอื่น</p>
        </div>
      )}

      {/* Table Section */}
      {!isLoading && !error && filteredPromotions.length > 0 && (
        <div className="bg-card border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className={theadRowCls}>
                  <SortHeader label="รหัส/โปรโมชัน" col="code" active={sortField} dir={sortDirection} onSort={handleSort} pad="px-4 py-3" />
                  <SortHeader label="ส่วนลด" col="discount_value" active={sortField} dir={sortDirection} onSort={handleSort} pad="px-4 py-3" />
                  <th className={`${thBaseCls} px-4 py-3`}>เงื่อนไข</th>
                  <SortHeader label="ระยะเวลา" col="start_date" active={sortField} dir={sortDirection} onSort={handleSort} pad="px-4 py-3" />
                  <SortHeader label="สถานะ" col="status" active={sortField} dir={sortDirection} onSort={handleSort} pad="px-4 py-3" align="center" />
                  <th className={`${thBaseCls} px-4 py-3 text-right`}>การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedPromotions.map((promo) => (
                  <tr key={promo.id} className="hover:bg-slate-50/40 transition-colors">
                    {/* Code & Name */}
                    <td className="py-2.5 px-4">
                      <div className="flex flex-col gap-0.5 max-w-[200px]">
                        <span className="font-mono font-bold text-[10px] text-[var(--brand-fg)] bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded w-fit">
                          {promo.code}
                        </span>
                        <span className="font-semibold text-slate-900 text-xs truncate leading-snug" title={promo.name}>{promo.name}</span>
                        {promo.description && (
                          <span className="text-[10px] text-slate-400 truncate" title={promo.description}>
                            {promo.description}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Discount Value */}
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <div className="w-6 h-6 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-[var(--brand-fg)] shrink-0">
                          {promo.discount_type === 'percent' ? <Percent className="w-3 h-3" /> : <DollarSign className="w-3 h-3" />}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 text-xs leading-tight">{formatDiscount(promo.discount_type, promo.discount_value)}</p>
                          <p className="text-[9px] text-slate-400 uppercase tracking-wider font-medium">
                            {promo.discount_type === 'override' ? 'ราคาพิเศษ' : 'ส่วนลด'}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Targets / Conditions — redesigned */}
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => setSelectedPromoForDetails(promo)}
                        title="คลิกเพื่อดูรายละเอียดเงื่อนไขทั้งหมด"
                        className="group flex items-center gap-2 w-full text-left"
                      >
                        {/* Chips row */}
                        <div className="flex flex-wrap items-center gap-1">
                          {/* Customer Type chip */}
                          {(() => {
                            const types = promo.customer_type
                              ? promo.customer_type.split(',').map(t => t.trim()).filter(Boolean)
                              : [];
                            const label = types.length === 0 ? 'ทุกกลุ่ม' : types.length === 1 ? types[0] : `${types.length} กลุ่ม`;
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-[10px] font-semibold whitespace-nowrap">
                                <Users className="w-2.5 h-2.5" />
                                {label}
                              </span>
                            );
                          })()}
                          {/* Customer Refs chip */}
                          {promo.customer_refs && (() => {
                            const refs = promo.customer_refs.split(',').map(r => r.trim()).filter(Boolean);
                            const label = refs.length === 1 ? refs[0] : `${refs.length} บริษัท`;
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-semibold whitespace-nowrap">
                                <Building2 className="w-2.5 h-2.5" />
                                {label}
                              </span>
                            );
                          })()}
                          {/* Product chip */}
                          {(() => {
                            const products = promo.product_code
                              ? promo.product_code.split(',').map(p => p.trim()).filter(Boolean)
                              : [];
                            const label = products.length === 0 ? 'ทุกรุ่น' : products.length === 1 ? `รุ่น ${products[0]}` : `${products.length} รุ่น`;
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-semibold whitespace-nowrap">
                                <Package className="w-2.5 h-2.5" />
                                {label}
                              </span>
                            );
                          })()}
                          {/* Min Qty chip */}
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-[10px] font-semibold whitespace-nowrap">
                            <ShoppingCart className="w-2.5 h-2.5" />
                            {promo.min_qty > 0 ? `ขั้นต่ำ ${promo.min_qty} ชิ้น` : 'ไม่มีขั้นต่ำ'}
                          </span>
                        </div>
                        {/* Info icon */}
                        <Info className="w-3.5 h-3.5 text-slate-300 group-hover:text-[var(--brand-fg)] flex-shrink-0 transition-colors" />
                      </button>
                    </td>

                    {/* Date Range */}
                    <td className="py-2.5 px-4 text-slate-600 text-xs font-semibold">
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        {renderDateRange(promo.start_date, promo.end_date)}
                      </span>
                    </td>

                    {/* Active State (Toggle) */}
                    <td className="py-2.5 px-4 text-center">
                      <button
                        onClick={() => handleToggleActive(promo)}
                        className="inline-flex items-center justify-center p-0.5 rounded-xl transition-all"
                        title={promo.is_active ? 'กดเพื่อปิดใช้งาน' : 'กดเพื่อเปิดใช้งาน'}
                      >
                        {promo.is_active ? (
                          <ToggleRight className="w-8 h-8 text-[var(--brand-fg)]" />
                        ) : (
                          <ToggleLeft className="w-8 h-8 text-slate-300" />
                        )}
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-4 text-right">
                      <RowActions>
                        <RowAction icon={Download} label="ส่งออก csv แคมเปญนี้" onClick={() => handleExportCsv(promo.code)} />
                        <RowAction icon={Pencil} label="แก้ไขข้อมูล" onClick={() => handleEditOpen(promo)} />
                        <RowAction icon={Trash2} label="ลบโปรโมชัน" tone="danger" onClick={() => handleDeleteOpen(promo)} />
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

      {/* ── CREATE / EDIT MODAL ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-card border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl relative flex flex-col my-8">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-950 flex items-center gap-2">
                <Tag className="w-5 h-5 text-[var(--brand-fg)]" />
                {editingPromo ? 'แก้ไขรายละเอียดโปรโมชัน' : 'สร้างโปรโมชันส่วนลดใหม่'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body / Form */}
            <form onSubmit={handleFormSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
              {formError && (
                <div className="flex items-center gap-3 bg-red-50 border border-red-100 p-4 rounded-xl text-red-800 text-xs animate-shake">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Form Grid */}
              <div className="grid grid-cols-2 gap-4">
                {/* Code Field */}
                <div className="col-span-2 sm:col-span-1 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    รหัสโปรโมชัน/โค้ด *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="PROMO20"
                    disabled={!!editingPromo}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    className="w-full bg-card border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Name Field */}
                <div className="col-span-2 sm:col-span-1 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    ชื่อแคมเปญโปรโมชัน *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ส่วนลดพิเศษแคมเปญมิถุนายน"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-card border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/10 transition-all"
                  />
                </div>

                {/* Description Field */}
                <div className="col-span-2 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    รายละเอียดคำอธิบาย
                  </label>
                  <textarea
                    placeholder="ใส่คำอธิบายเกี่ยวกับรายละเอียดของโปรโมชันเพิ่มเติม..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    className="w-full bg-card border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/10 transition-all resize-none"
                  />
                </div>

                <hr className="col-span-2 border-slate-100 my-1" />

                {/* Discount Type */}
                <div className="col-span-2 sm:col-span-1 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    ประเภทส่วนลด *
                  </label>
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed' | 'override')}
                    className="w-full bg-card border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/10 transition-all"
                  >
                    <option value="percent">ลดเป็นเปอร์เซ็นต์ (%)</option>
                    <option value="fixed">ลดเป็นบาท (฿)</option>
                    <option value="override">ราคาพิเศษต่อชิ้น (฿)</option>
                  </select>
                </div>

                {/* Discount Value */}
                <div className="col-span-2 sm:col-span-1 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    มูลค่าที่ลด / ราคา *
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(Number(e.target.value))}
                    className="w-full bg-card border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/10 transition-all"
                  />
                </div>

                <hr className="col-span-2 border-slate-100 my-1" />

                {/* Import conditions from CSV */}
                <div className="col-span-2 py-2.5 px-4 bg-slate-50 border border-slate-200/60 rounded-2xl flex items-center justify-between gap-3 shadow-inner">
                  <div className="space-y-0.5">
                    <span className="block text-xs font-bold text-slate-800">
                      นำเข้าเงื่อนไขจากไฟล์ CSV ของแคมเปญนี้
                    </span>
                    <span className="block text-[10px] text-slate-500 font-medium leading-relaxed">
                      อัปโหลด csv เพื่อกรอกสินค้า/ลูกค้าของรายการนี้แบบอัตโนมัติ
                    </span>
                  </div>
                  <label className="flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 bg-card hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer flex-shrink-0">
                    <Upload className="w-3.5 h-3.5 text-slate-500" />
                    อัปโหลด csv
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleModalImportCsv}
                      className="hidden"
                    />
                  </label>
                </div>

                <hr className="col-span-2 border-slate-100 my-1" />

                {/* Product Multi-select Searchable Dropdown */}
                <div className="col-span-2 space-y-1.5">
                  <MultiSelectSearch
                    label="เจาะจงรหัสสินค้า / รุ่น (เว้นว่าง = ทุกรุ่น)"
                    placeholder="พิมพ์ค้นหาโมเดลสินค้า... (เช่น CM-001)"
                    selectedValues={selectedProducts}
                    onChange={setSelectedProducts}
                    searchUrl="/api/admin/products/search"
                    token={token}
                    icon={<Target className="w-4 h-4" />}
                  />
                </div>

                {/* Customer Type Multi-select Searchable Dropdown */}
                <div className="col-span-2 space-y-1.5">
                  <MultiSelectSearch
                    label="เจาะจงกลุ่มลูกค้า (เว้นว่าง = ทั้งหมด)"
                    placeholder="พิมพ์ค้นหากลุ่มลูกค้า... (เช่น เทรดดิ้ง)"
                    selectedValues={selectedCustomers}
                    onChange={setSelectedCustomers}
                    searchUrl="/api/admin/customers/types"
                    token={token}
                    icon={<Users className="w-4 h-4" />}
                  />
                </div>

                {/* Customer Refs (specific customers) Multi-select */}
                <div className="col-span-2 space-y-1.5">
                  <CustomerRefMultiSelect
                    label="เจาะจงลูกค้าเฉพาะราย (เว้นว่าง = ลูกค้าทุกคน)"
                    placeholder="พิมพ์ค้นหารหัสหรือชื่อลูกค้า..."
                    selectedRefs={selectedCustomerRefs}
                    onChange={setSelectedCustomerRefs}
                    token={token}
                  />
                </div>

                {/* Min Quantity */}
                <div className="col-span-2 sm:col-span-1 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    จำนวนสั่งซื้อขั้นต่ำ (ชิ้น)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={minQty}
                    onChange={(e) => setMinQty(Number(e.target.value))}
                    className="w-full bg-card border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[var(--brand-fg)] focus:ring-2 focus:ring-[var(--brand-fg)]/10 transition-all"
                  />
                </div>

                <hr className="col-span-2 border-slate-100 my-1" />

                {/* Start Date */}
                <div className="col-span-2 sm:col-span-1 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    วันที่เริ่มต้น
                  </label>
                  <DateInput
                    value={startDate}
                    onChange={setStartDate}
                    aria-label="วันที่เริ่มต้น"
                    className="w-full bg-card border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-800 focus-within:border-[var(--brand-fg)] focus-within:ring-2 focus-within:ring-[var(--brand-fg)]/10 transition-all"
                  />
                </div>

                {/* End Date */}
                <div className="col-span-2 sm:col-span-1 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    วันที่สิ้นสุด
                  </label>
                  <DateInput
                    value={endDate}
                    onChange={setEndDate}
                    aria-label="วันที่สิ้นสุด"
                    className="w-full bg-card border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-800 focus-within:border-[var(--brand-fg)] focus-within:ring-2 focus-within:ring-[var(--brand-fg)]/10 transition-all"
                  />
                </div>

                {/* Is Active Status checkbox style */}
                <div className="col-span-2 flex items-center gap-2.5 pt-2">
                  <input
                    type="checkbox"
                    id="promo-active-checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="w-4.5 h-4.5 text-[var(--brand-fg)] bg-card border-slate-200 rounded focus:ring-offset-card focus:ring-[var(--brand-fg)] focus:ring-2"
                  />
                  <label htmlFor="promo-active-checkbox" className="text-xs font-semibold text-slate-600 select-none">
                    เปิดใช้งานโปรโมชันทันที (Active Status)
                  </label>
                </div>
              </div>

              {/* Form Footer */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
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
                  บันทึก
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRMATION MODAL ── */}
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-slate-200 rounded-2xl w-full max-w-sm shadow-2xl p-6 relative">
            <div className="text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-red-50 border border-red-100 text-red-500 flex items-center justify-center mx-auto">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-bold text-slate-950">ยืนยันการลบโปรโมชัน?</h3>
                <p className="text-xs text-slate-500">
                  คุณต้องการที่จะลบโปรโมชันรหัส <span className="font-mono text-[var(--brand-fg)] font-bold">"{promoToDelete?.code}"</span> หรือไม่? การลบข้อมูลจะไม่สามารถย้อนกลับได้
                </p>
              </div>
              
              <div className="pt-2 flex items-center justify-center gap-3">
                <Button
                  onClick={() => setIsDeleteConfirmOpen(false)}
                  disabled={isSaving}
                  className="flex-1"
                >
                  ยกเลิก
                </Button>
                <Button
                  variant="danger"
                  onClick={handleDeleteConfirm}
                  busy={isSaving}
                  className="flex-1"
                >
                  ยืนยันลบ
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CONDITIONS DETAIL MODAL ── */}
      {selectedPromoForDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-card border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl p-6 relative animate-scale-up">
            <button
              onClick={() => setSelectedPromoForDetails(null)}
              className="absolute top-4 right-4 p-1.5 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="space-y-4">
              <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-[var(--brand-fg)] flex items-center justify-center border border-emerald-100">
                  <Info className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-950">รายละเอียดเงื่อนไขการใช้</h3>
                  <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
                    โปรโมชัน: <span className="text-[var(--brand-fg)]">{selectedPromoForDetails.name}</span> ({selectedPromoForDetails.code})
                  </p>
                </div>
              </div>

              <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
                {/* Product Codes */}
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-slate-400" /> รุ่นสินค้าที่ร่วมรายการ:
                  </h4>
                  {selectedPromoForDetails.product_code ? (
                    <div className="flex flex-wrap gap-1.5 pl-5">
                      {selectedPromoForDetails.product_code.split(',').map((code, idx) => (
                        <span key={idx} className="font-mono text-[10px] px-2 py-0.5 bg-emerald-50 text-[var(--brand-fg)] border border-emerald-100 rounded-md font-semibold">
                          {code}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="pl-5 text-[11px] text-slate-400 font-medium">ทุกรุ่นสินค้า</span>
                  )}
                </div>

                {/* Customer Types */}
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-slate-400" /> กลุ่มลูกค้าที่ร่วมรายการ:
                  </h4>
                  {selectedPromoForDetails.customer_type ? (
                    <div className="flex flex-wrap gap-1.5 pl-5">
                      {selectedPromoForDetails.customer_type.split(',').map((type, idx) => (
                        <span key={idx} className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-md font-semibold">
                          {type}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="pl-5 text-[11px] text-slate-400 font-medium">ลูกค้าทุกประเภท</span>
                  )}
                </div>

                {/* Customer Target (Refs) */}
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-slate-400" /> ลูกค้าเป้าหมาย (รายคน):
                  </h4>
                  {selectedPromoForDetails.customer_refs ? (
                    <div className="flex flex-wrap gap-1.5 pl-5">
                      {selectedPromoForDetails.customer_refs.split(',').map((ref, idx) => (
                        <span key={idx} className="text-[10px] px-2 py-0.5 bg-purple-50 text-purple-600 border border-purple-100 rounded-md font-semibold font-mono">
                          {ref}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="pl-5 text-[11px] text-slate-400 font-medium">ไม่ได้เจาะจงรายลูกค้า (ได้รับสิทธิ์ตามกลุ่มลูกค้า)</span>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end">
                <Button
                  onClick={() => setSelectedPromoForDetails(null)}
                >
                  ปิดหน้าต่าง
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};