import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  Package,
  Image as ImageIcon,
  Wallet,
  Users,
  ClipboardList,
  LogOut,
  Sun,
  Moon,
  Plus,
  Trash2,
  CreditCard,
  Camera,
  Store,
  Bell,
  Search,
  Award,
  Pencil,
  Clock,
  Download,
  Upload,
  FileSpreadsheet,
  ShoppingCart,
  BarChart3,
  Tag,
  Building2,
  FileText,
  ShieldAlert,
  Check,
  X,
  PackageMinus,
  AlertTriangle,
  RotateCcw,
  UserCheck,
  Lock,
  KeyRound,
  ChevronDown,
  Mail,
} from 'lucide-react';
import {
  addLog,
  dayKey,
  fmt,
  fullDate,
  getCustomerDebtTotals,
  getIntakeTotals,
  getLowStockProducts,
  getNextMonthKey,
  getUnreadMessagesCount,
  getUserStoreIds,
  getWithdrawalWholesaleTotal,
  isEndOfWeekDay,
  matchesQuery,
  migrateDatabase,
  monthKey,
  norm,
  num,
  sameDay,
  tm,
} from '../store';
import type {
  ApprovalStatus,
  PosDatabase,
  Product,
  Salary,
  StockIntake,
  StockIntakeItem,
  User,
  UserRole,
  Withdrawal,
} from '../types';
import { ArchiveView } from './ArchiveView';
import { DashboardView } from './DashboardView';
import {
  AddBranchModal,
  BonusModal,
  EditUserModal,
  Modal,
  RentModal,
  SalaryForm,
  StockIntakeModal,
  WithdrawForm,
} from './Modals';
import { MonthlyReportView } from './MonthlyReportView';
import { ShiftsAuditSection } from './ShiftsAuditSection';
import { SheetsSyncView } from './SheetsSyncView';
import { ManagerQuickSaleModal } from './ManagerQuickSaleModal';
import { BranchSalesReviewModal } from './BranchSalesReviewModal';
import { DiscountsView } from './DiscountsView';
import {
  InvoicePaymentsModal,
  type InvoicePaymentsFilter,
} from './InvoicePaymentsModal';
import {
  StaffWithdrawalsModal,
  type StaffWithdrawalWhoFilter,
} from './StaffWithdrawalsModal';
import { ReturnGoodsModal } from './ReturnGoodsModal';
import { CustomerDebtsView } from './CustomerDebtsView';
import { ActivityNotificationsView } from './ActivityNotificationsView';
import { InternalMailboxModal } from './InternalMailboxModal';
import { OwnerImportantAlertsModal } from './OwnerImportantAlertsModal';
import { LiveClockBadge } from './LiveClockBadge';
import { ConnectivitySyncBadge, PWAInstallButton } from './PWAControls';
import { exportMasterInventoryWorkbook } from '../services/excelWorkbook';
import { collectIncomingGoodsEntries } from '../services/sheetsSync';
import type { GoogleSheetsSyncState } from '../services/useGoogleSheetsSync';

interface PinEditProps {
  targetUser: User;
  db: PosDatabase;
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void;
  notify: (msg: string) => void;
  who: string;
  canSee: boolean;
}

const PinEdit: React.FC<PinEditProps> = ({
  targetUser,
  db,
  upd,
  notify,
  who,
  canSee,
}) => {
  const [val, setVal] = useState(canSee ? targetUser.pin : '');

  useEffect(() => {
    if (canSee) {
      setVal(targetUser.pin);
    }
  }, [targetUser.pin, canSee]);

  const save = () => {
    if (val.length < 4) {
      notify('4 خانات على الأقل');
      return;
    }
    const conflict = db.users.some(
      (x) =>
        x.id !== targetUser.id &&
        x.pin === val &&
        (x.role === 'manager') !== (targetUser.role === 'manager')
    );
    if (conflict) {
      notify('هذا الرقم مستخدم لحساب آخر');
      return;
    }
    upd((d) => {
      const found = d.users.find((x) => x.id === targetUser.id);
      const changed = found && found.pin !== val;
      if (found) found.pin = val;
      if (changed) {
        if (!Array.isArray(d.ownerAlerts)) d.ownerAlerts = [];
        d.ownerAlerts.unshift({
          id: d.nid++,
          title: 'تغيير رقم سري',
          message: `قام ${who} بتعديل الرقم السري للحساب "${targetUser.name}"`,
          by: who,
          targetUserName: targetUser.name,
          ts: Date.now(),
          read: false,
        });
      }
      addLog(d, who, 'تغيير رقم سري: ' + targetUser.name);
      return d;
    });
    notify('تم حفظ الرقم السري وإرسال إشعار للمالك');
    if (!canSee) setVal('');
  };

  return (
    <div className="flex items-center justify-center gap-1.5">
      <input
        type={canSee ? 'text' : 'password'}
        placeholder={canSee ? '' : 'كلمة سر جديدة'}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="font-num w-28 rounded border border-slate-300 bg-white px-2 py-1 text-center text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
      />
      {val && val !== targetUser.pin && (
        <button
          type="button"
          onClick={save}
          className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
        >
          حفظ
        </button>
      )}
    </div>
  );
};

interface SalaryEditProps {
  targetUser: User;
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void;
  notify: (msg: string) => void;
  who: string;
}

const SalaryEdit: React.FC<SalaryEditProps> = ({
  targetUser,
  upd,
  notify,
  who,
}) => {
  const currentSalary = targetUser.salary ?? 0;
  const [val, setVal] = useState(String(currentSalary));

  useEffect(() => {
    setVal(String(targetUser.salary ?? 0));
  }, [targetUser.salary]);

  const parsed = Math.max(0, num(val));

  const save = () => {
    upd((d) => {
      const found = d.users.find((x) => x.id === targetUser.id);
      if (found) found.salary = parsed;
      addLog(
        d,
        who,
        `تحديد الراتب المسجل لـ ${targetUser.name}: ${fmt(parsed)}`
      );
      return d;
    });
    notify(`تم حفظ راتب ${targetUser.name}`);
  };

  return (
    <div className="flex items-center justify-center gap-1.5">
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="font-num w-28 rounded border border-slate-300 bg-white px-2 py-1 text-center text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
      />
      {parsed !== currentSalary && (
        <button
          type="button"
          onClick={save}
          className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
        >
          حفظ
        </button>
      )}
    </div>
  );
};

interface CommittedCellInputProps {
  value: string | number;
  type?: 'text' | 'number';
  onCommit: (nextValue: string) => void;
  className?: string;
  ariaLabel?: string;
}

const CommittedCellInput: React.FC<CommittedCellInputProps> = ({
  value,
  type = 'text',
  onCommit,
  className = '',
  ariaLabel,
}) => {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    if (draft !== String(value)) {
      onCommit(draft);
    }
  };

  return (
    <input
      type={type}
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(String(value));
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
};

interface ManagerViewProps {
  db: PosDatabase;
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void;
  user: User;
  initialStoreId?: number;
  onLogout: () => void;
  notify: (msg: string) => void;
  dark: boolean;
  onToggleTheme: () => void;
  sheetsSync: GoogleSheetsSyncState;
}

type ManagerTab =
  | 'dash'
  | 'alerts'
  | 'monthly'
  | 'inv'
  | 'archive'
  | 'cash'
  | 'debts'
  | 'discounts'
  | 'staff'
  | 'sync'
  | 'log';

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: 'بالانتظار',
  approved: 'معتمد',
  rejected: 'مرفوض',
};

const applyIntakeToInventory = (
  d: PosDatabase,
  storeId: number,
  items: StockIntakeItem[]
) => {
  for (const item of items) {
    const existing =
      (item.productId &&
        d.products.find(
          (p) => p.id === item.productId && p.storeId === storeId
        )) ||
      d.products.find(
        (p) => p.storeId === storeId && norm(p.name) === norm(item.name)
      );

    if (existing) {
      existing.stock += item.qty;
      existing.cost = item.cost;
      existing.price = item.price;
      existing.min = item.min;
    } else {
      d.products.push({
        id: d.nid++,
        storeId,
        name: item.name,
        price: item.price,
        min: item.min,
        cost: item.cost,
        stock: item.qty,
        minStock: item.minStock ?? 3,
      });
    }
  }
};

export const ManagerView: React.FC<ManagerViewProps> = ({
  db,
  upd,
  user,
  initialStoreId,
  onLogout,
  notify,
  dark,
  onToggleTheme,
  sheetsSync,
}) => {
  const allowedStoreIds = useMemo(
    () => getUserStoreIds(user, db.stores),
    [user, db.stores]
  );
  const accessibleStores = useMemo(
    () => db.stores.filter((s) => allowedStoreIds.includes(s.id)),
    [db.stores, allowedStoreIds]
  );

  const [tab, setTab] = useState<ManagerTab>('dash');
  const [shiftsMode, setShiftsMode] = useState<'daily' | 'monthly'>('daily');
  const [shiftsFocusTick, setShiftsFocusTick] = useState(0);
  const [selectedStoreId, setSelectedStoreId] = useState<number | 'all'>(() => {
    if (user.owner || allowedStoreIds.length > 1) return 'all';
    return initialStoreId && allowedStoreIds.includes(initialStoreId)
      ? initialStoreId
      : allowedStoreIds[0] ?? 'all';
  });
  const [invQuery, setInvQuery] = useState('');
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [salaryInitialUser, setSalaryInitialUser] = useState<{
    uid: number;
    action: 'deduct' | 'defer';
  } | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawInitialMode, setWithdrawInitialMode] = useState<
    'manager_goods' | ''
  >('');
  const [staffWithdrawalsOpen, setStaffWithdrawalsOpen] = useState(false);
  const [staffWithdrawalsInitialWho, setStaffWithdrawalsInitialWho] =
    useState<StaffWithdrawalWhoFilter>('all');
  const [returnOpen, setReturnOpen] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [quickSaleOpen, setQuickSaleOpen] = useState(false);
  const [addBranchOpen, setAddBranchOpen] = useState(false);
  const [rentOpen, setRentOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [paymentsInitialFilter, setPaymentsInitialFilter] =
    useState<InvoicePaymentsFilter>('unpaid_partial');
  const [salesReviewModal, setSalesReviewModal] = useState<{
    mode: 'daily' | 'monthly';
    storeId: number | 'all';
  } | null>(null);
  const [mailboxOpen, setMailboxOpen] = useState(false);
  const [importantAlertsOpen, setImportantAlertsOpen] = useState(false);
  const [cashStaffFilter, setCashStaffFilter] = useState<string>('all');
  const [cashItemQuery, setCashItemQuery] = useState<string>('');
  const [logStaffFilter, setLogStaffFilter] = useState<string>('all');
  const [logSearchQuery, setLogSearchQuery] = useState<string>('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editingStoreId, setEditingStoreId] = useState<number | null>(null);
  const [editingStoreName, setEditingStoreName] = useState('');
  const [stockEditModal, setStockEditModal] = useState<{
    product: Product;
    newStock: string;
    ownerPin: string;
    reason: string;
  } | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const menusContainerRef = useRef<HTMLDivElement | null>(null);
  const [openMenu, setOpenMenu] = useState<
    'moreTabs' | 'withdrawals' | 'invoices' | 'reports' | null
  >(null);
  const [inlineManagerPayId, setInlineManagerPayId] = useState<number | null>(null);
  const [inlineManagerPayToCash, setInlineManagerPayToCash] = useState<boolean>(true);
  const [bonusModal, setBonusModal] = useState<{
    empName?: string;
    storeId?: number;
  } | null>(null);
  const [newStoreName, setNewStoreName] = useState('');
  const [newProd, setNewProd] = useState({
    storeId: String(accessibleStores[0]?.id ?? db.stores[0]?.id ?? 1),
    name: '',
    price: '',
    min: '',
    cost: '',
    stock: '',
    minStock: '3',
  });

  useEffect(() => {
    if (selectedStoreId !== 'all') {
      setNewProd((prev) => ({ ...prev, storeId: String(selectedStoreId) }));
    }
  }, [selectedStoreId]);

  useEffect(() => {
    if (selectedStoreId !== 'all' && !allowedStoreIds.includes(selectedStoreId)) {
      setSelectedStoreId(allowedStoreIds.length === 1 ? allowedStoreIds[0] : 'all');
    }
  }, [selectedStoreId, allowedStoreIds]);

  useEffect(() => {
    if (!openMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        menusContainerRef.current &&
        !menusContainerRef.current.contains(e.target as Node)
      ) {
        setOpenMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openMenu]);

  const [newUser, setNewUser] = useState<{
    name: string;
    pin: string;
    role: UserRole;
    storeIds: number[];
    salary: string;
  }>({
    name: '',
    pin: '',
    role: 'employee',
    storeIds: [accessibleStores[0]?.id ?? db.stores[0]?.id ?? 1],
    salary: '',
  });

  const matchStore = (id?: number) =>
    id === undefined
      ? selectedStoreId === 'all'
      : selectedStoreId === 'all'
        ? allowedStoreIds.includes(id)
        : id === selectedStoreId && allowedStoreIds.includes(id);

  const getStoreName = (id?: number) =>
    db.stores.find((s) => s.id === id)?.name ?? 'المحل الرئيسي';

  const pendingIntakes = db.stockIntakes.filter(
    (i) => i.status === 'pending' && allowedStoreIds.includes(i.storeId)
  );
  const pendingWithdrawals = db.withdrawals.filter(
    (w) => w.status === 'pending' && allowedStoreIds.includes(w.storeId)
  );
  const pendingSalaries = db.salaries.filter(
    (s) => s.status === 'pending' && allowedStoreIds.includes(s.storeId)
  );
  const pendingCount =
    pendingIntakes.length + pendingWithdrawals.length + pendingSalaries.length;

  const decideIntake = (
    intake: StockIntake,
    status: 'approved' | 'rejected'
  ) => {
    upd((d) => {
      const target = d.stockIntakes.find((x) => x.id === intake.id);
      if (target && target.status === 'pending') {
        target.status = status;
        target.approvedBy = user.name;
        target.approvedTs = Date.now();
        if (status === 'approved') {
          applyIntakeToInventory(d, target.storeId, target.items);
        }
        addLog(
          d,
          user.name,
          `[${getStoreName(target.storeId)}] ${
            status === 'approved' ? 'اعتماد وإدخال' : 'رفض'
          } فاتورة توريد #${target.id} (أدخلها: ${target.enteredBy})`,
          target.storeId
        );
      }
      return d;
    });
    notify(
      status === 'approved'
        ? 'تمت مطابقة الفاتورة وإدخال البضاعة للمخزن والأرشيف'
        : 'تم رفض طلب التوريد'
    );
  };

  const decideWithdrawal = (w: Withdrawal, status: 'approved' | 'rejected') => {
    upd((d) => {
      const target = d.withdrawals.find((y) => y.id === w.id);
      if (target) {
        target.status = status;
        if (status === 'rejected') {
          target.items.forEach((item) => {
            const prod = d.products.find((q) => q.id === item.id);
            if (prod) prod.stock += item.qty;
          });
        }
        const roleLabel =
          w.whoType === 'employee' ? 'موظف' : 'مدير / إدارة';
        const taker = w.takenBy || w.emp;
        addLog(
          d,
          user.name,
          `[${getStoreName(w.storeId)}] ${
            status === 'approved' ? 'تأكيد' : 'نفي'
          } سحب ${roleLabel} (${taker})${w.type === 'cash' ? ' ' + fmt(w.amount) : ' (أغراض)'}`,
          w.storeId
        );
      }
      return d;
    });
  };

  const decideSalary = (s: Salary, status: 'approved' | 'rejected') => {
    upd((d) => {
      const target = d.salaries.find((y) => y.id === s.id);
      if (target) {
        target.status = status;
        addLog(
          d,
          user.name,
          `[${getStoreName(s.storeId)}] ${
            status === 'approved' ? 'موافقة' : 'رفض'
          } راتب ${s.name} ${fmt(s.amount)}`,
          s.storeId
        );
      }
      return d;
    });
  };

  const lowStockAll = getLowStockProducts(db).filter((p) =>
    allowedStoreIds.includes(p.storeId)
  );
  const lowStockFiltered = getLowStockProducts(db, selectedStoreId).filter(
    (p) => allowedStoreIds.includes(p.storeId)
  );

  const updateProductField = (
    id: number,
    key: 'name' | 'price' | 'min' | 'cost' | 'minStock',
    value: string
  ) => {
    let priceChangedMsg = '';
    upd((d) => {
      const prod = d.products.find((p) => p.id === id);
      if (prod) {
        const sName = getStoreName(prod.storeId);
        if (key === 'name') {
          const nextName = value.trim() || prod.name;
          if (nextName !== prod.name) {
            const oldName = prod.name;
            prod.name = nextName;
            addLog(
              d,
              user.name,
              `[${sName}] تعديل اسم صنف "${oldName}" إلى "${nextName}"`,
              prod.storeId
            );
          }
        } else {
          const nextVal = num(value);
          const prevVal = prod[key];
          if (nextVal !== prevVal) {
            prod[key] = nextVal;
            const labelMap: Record<'price' | 'min' | 'cost' | 'minStock', string> = {
              price: 'سعر البيع',
              min: 'الحد الأدنى للبيع',
              cost: 'سعر التكلفة / الجملة',
              minStock: 'حد التنبيه',
            };
            const isPriceField = key === 'price' || key === 'min' || key === 'cost';
            const alertMsg = `[${sName}] قام ${user.name} بتعديل ${labelMap[key]} للقطعة "${prod.name}" من ${fmt(prevVal ?? 0)} إلى ${fmt(nextVal)}`;
            if (isPriceField) {
              if (!Array.isArray(d.ownerAlerts)) d.ownerAlerts = [];
              d.ownerAlerts.unshift({
                id: d.nid++,
                kind: 'price',
                title: 'تعديل سعر قطعة في المخزون',
                message: alertMsg,
                by: user.name,
                storeId: prod.storeId,
                ts: Date.now(),
                read: false,
              });
              priceChangedMsg = alertMsg;
            }
            addLog(
              d,
              user.name,
              alertMsg,
              prod.storeId,
              isPriceField
                ? {
                    category: 'price_edit',
                    title: 'تعديل سعر قطعة في المخزون',
                    important: true,
                  }
                : undefined
            );
          }
        }
      }
      return d;
    });
    if (priceChangedMsg) {
      notify('تم حفظ السعر وإرسال إشعار للإدارة بالتعديل');
    }
  };

  const handleConfirmOwnerStockEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockEditModal) return;
    if (!user.owner) {
      notify('تعديل الكمية مباشرة محصور بالمالك فقط');
      return;
    }
    const pinMatched = db.users.some(
      (u) => u.owner && u.pin === stockEditModal.ownerPin.trim()
    );
    if (!pinMatched) {
      notify('كلمة سر المالك غير صحيحة');
      return;
    }
    const nextStock = Math.max(0, Math.floor(num(stockEditModal.newStock)));
    const prod = stockEditModal.product;
    const prevStock = prod.stock;
    const reasonText = stockEditModal.reason.trim();
    const storeLabel = getStoreName(prod.storeId);

    upd((d) => {
      const target = d.products.find((p) => p.id === prod.id);
      if (target) {
        target.stock = nextStock;
        if (!Array.isArray(d.ownerAlerts)) d.ownerAlerts = [];
        d.ownerAlerts.unshift({
          id: d.nid++,
          title: 'تعديل كمية مخزون',
          message: `[${storeLabel}] قام المالك (${user.name}) بتعديل كمية "${target.name}" من ${prevStock} إلى ${nextStock}${
            reasonText ? ` · السبب: ${reasonText}` : ''
          }`,
          by: user.name,
          storeId: target.storeId,
          ts: Date.now(),
          read: false,
        });
        addLog(
          d,
          user.name,
          `[${storeLabel}] تعديل كمية "${target.name}" من ${prevStock} إلى ${nextStock}${
            reasonText ? ` (${reasonText})` : ''
          }`,
          target.storeId,
          {
            actorRole: 'owner',
            category: 'stock_edit',
            title: 'تعديل كمية مخزون (صلاحية المالك)',
            important: true,
          }
        );
      }
      return d;
    });
    setStockEditModal(null);
    notify(`تم تعديل كمية "${prod.name}" إلى ${nextStock} وتسجيله بالإشعارات`);
  };

  const updateProductStore = (id: number, nextStoreId: number) => {
    upd((d) => {
      const prod = d.products.find((p) => p.id === id);
      if (prod && prod.storeId !== nextStoreId) {
        const oldName = getStoreName(prod.storeId);
        const newName = getStoreName(nextStoreId);
        prod.storeId = nextStoreId;
        addLog(
          d,
          user.name,
          `نقل منتج "${prod.name}" من ${oldName} إلى ${newName}`,
          nextStoreId
        );
      }
      return d;
    });
    notify('تم نقل المنتج للمحل المحدد');
  };

  const addProduct = (e: React.FormEvent) => {
    e.preventDefault();
    const p = {
      name: newProd.name.trim(),
      price: num(newProd.price),
      min: num(newProd.min),
      cost: num(newProd.cost),
      stock: num(newProd.stock),
      minStock: Math.max(0, Math.floor(num(newProd.minStock || '3'))),
    };
    if (!p.name || p.price <= 0 || p.min > p.price) {
      notify('تحقق من الاسم والسعر (الحد الأدنى يجب ألا يتجاوز السعر)');
      return;
    }

    const targetStoreIds =
      newProd.storeId === 'all'
        ? db.stores.map((s) => s.id)
        : [Number(newProd.storeId) || db.stores[0]?.id || 1];

    upd((d) => {
      const nowTs = Date.now();
      targetStoreIds.forEach((sid) => {
        d.products.push({ ...p, id: d.nid++, storeId: sid });
        if (p.stock > 0) {
          if (!Array.isArray(d.stockEntries)) d.stockEntries = [];
          d.stockEntries.unshift({
            id: d.nid++,
            storeId: sid,
            name: p.name,
            qty: p.stock,
            cost: p.cost,
            price: p.price,
            min: p.min,
            enteredBy: user.name,
            approvedBy: user.name,
            source: 'manual',
            note: 'إضافة مباشرة للمخزون',
            ts: nowTs,
          });
        }
        addLog(
          d,
          user.name,
          `[${getStoreName(sid)}] إضافة منتج ${p.name}`,
          sid
        );
      });
      return d;
    });
    setNewProd({
      ...newProd,
      name: '',
      price: '',
      min: '',
      cost: '',
      stock: '',
      minStock: '3',
    });
    notify(
      targetStoreIds.length > 1
        ? `تمت إضافة المنتج إلى ${targetStoreIds.length} محلات`
        : 'تمت إضافة المنتج'
    );
  };

  const createBranchAndSheets = (rawName: string) => {
    const name = rawName.trim();
    if (!name) {
      notify('أدخل اسم المحل');
      return;
    }
    const maxExistingId = db.stores.reduce((m, s) => Math.max(m, s.id), 0);
    const nextStoreId = Math.max(db.nid, maxExistingId + 1);
    const createdStore = { id: nextStoreId, name };

    upd((d) => {
      const id = nextStoreId;
      if (d.nid <= id) d.nid = id + 1;
      d.stores.push({ id, name });
      d.openingByStore[id] = 0;
      d.lastCloseByStore[id] = 0;
      if (!user.owner) {
        const curU = d.users.find((x) => x.id === user.id);
        if (curU) {
          const prevList = Array.isArray(curU.storeIds)
            ? curU.storeIds
            : curU.storeId
              ? [curU.storeId]
              : [];
          if (!prevList.includes(id)) {
            curU.storeIds = [...prevList, id];
          }
        }
      }
      addLog(
        d,
        user.name,
        `إضافة فرع جديد: ${name} وتجهيز أوراق إكسل الخاصة به تلقائياً`,
        id
      );
      return d;
    });

    if (sheetsSync.accessToken) {
      notify(`تمت إضافة فرع "${name}" — جاري إنشاء جدول Google Sheets تلقائياً...`);
      void sheetsSync.createAndLinkBranch(nextStoreId, createdStore);
      if (
        db.masterSheetLink?.spreadsheetId &&
        db.masterSheetLink?.autoSyncEnabled
      ) {
        setTimeout(() => {
          void sheetsSync.pushMasterNow();
        }, 1200);
      }
    } else {
      notify(
        `تمت إضافة فرع "${name}" وتجهيز شيتات Excel المستقلة له تلقائياً`
      );
    }
  };

  const addStore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStoreName.trim()) {
      notify('أدخل اسم المحل');
      return;
    }
    createBranchAndSheets(newStoreName);
    setNewStoreName('');
  };

  const handleDeleteRent = (rentId: number) => {
    upd((d) => {
      const target = (d.rents ?? []).find((r) => r.id === rentId);
      d.rents = (d.rents ?? []).filter((r) => r.id !== rentId);
      if (target) {
        addLog(
          d,
          user.name,
          `[${getStoreName(target.storeId)}] حذف سجل إيجار شهر ${target.month} (${fmt(target.localAmount)})`,
          target.storeId
        );
      }
      return d;
    });
    notify('تم حذف سجل الإيجار وتحديث أرباح الشهر');
  };

  const addUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.name.trim() || newUser.pin.length < 4) {
      notify('الاسم مطلوب والرقم السري 4 خانات على الأقل');
      return;
    }
    const conflict = db.users.some(
      (x) =>
        x.pin === newUser.pin &&
        (x.role === 'manager') !== (newUser.role === 'manager')
    );
    if (conflict) {
      notify('هذا الرقم مستخدم لحساب آخر، اختر رقماً مختلفاً');
      return;
    }
    const assignedStoreIds =
      newUser.storeIds.length > 0
        ? newUser.storeIds
        : [accessibleStores[0]?.id ?? db.stores[0]?.id ?? 1];
    const primaryStoreId = assignedStoreIds[0];
    const registeredSalary = Math.max(0, num(newUser.salary));
    const branchNames = assignedStoreIds.map((id) => getStoreName(id)).join('، ');
    upd((d) => {
      d.users.push({
        id: d.nid++,
        name: newUser.name.trim(),
        role: newUser.role,
        pin: newUser.pin,
        storeId: primaryStoreId,
        storeIds: assignedStoreIds,
        salary: registeredSalary,
      });
      addLog(
        d,
        user.name,
        `إضافة ${newUser.role === 'manager' ? 'مدير' : 'موظف'} ${newUser.name.trim()} (${branchNames})${registeredSalary > 0 ? ` — راتب: ${fmt(registeredSalary)}` : ''}`,
        primaryStoreId
      );
      return d;
    });
    setNewUser({
      ...newUser,
      name: '',
      pin: '',
      role: 'employee',
      salary: '',
    });
    notify('تمت إضافة الموظف');
  };

  const openShiftsView = (mode: 'daily' | 'monthly' = 'daily') => {
    setShiftsMode(mode);
    setShiftsFocusTick((t) => t + 1);
    setTab('cash');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const updateUserStore = (targetUser: User, nextStoreId: number) => {
    if (targetUser.storeId === nextStoreId && (!targetUser.storeIds || targetUser.storeIds.length <= 1)) return;
    const oldStoreName = getStoreName(targetUser.storeId);
    const nextStoreName = getStoreName(nextStoreId);
    upd((d) => {
      const found = d.users.find((x) => x.id === targetUser.id);
      if (found) {
        found.storeId = nextStoreId;
        found.storeIds = [nextStoreId];
      }
      addLog(
        d,
        user.name,
        `تحديد فرع ${targetUser.name} من "${oldStoreName}" إلى "${nextStoreName}"`,
        nextStoreId
      );
      return d;
    });
    notify(`تم نقل ${targetUser.name} إلى ${nextStoreName}`);
  };

  const saveEditedUser = (payload: {
    userId: number;
    name: string;
    role: UserRole;
    storeIds: number[];
    salary: number;
    pin?: string;
  }) => {
    const primaryStoreId =
      payload.storeIds[0] ?? accessibleStores[0]?.id ?? db.stores[0]?.id ?? 1;
    const branchLabel = payload.storeIds.map((id) => getStoreName(id)).join('، ');
    let pinWasChanged = false;
    upd((d) => {
      const found = d.users.find((x) => x.id === payload.userId);
      if (!found) return d;
      const oldName = found.name;
      found.name = payload.name;
      if (!found.owner && user.owner) {
        found.role = payload.role;
      }
      found.storeId = primaryStoreId;
      found.storeIds = payload.storeIds;
      found.salary = payload.salary;
      if (payload.pin && payload.pin !== found.pin) {
        found.pin = payload.pin;
        pinWasChanged = true;
        if (!Array.isArray(d.ownerAlerts)) d.ownerAlerts = [];
        d.ownerAlerts.unshift({
          id: d.nid++,
          title: 'تغيير رقم سري',
          message: `قام ${user.name} بتعديل الرقم السري للحساب "${payload.name}"`,
          by: user.name,
          targetUserName: payload.name,
          ts: Date.now(),
          read: false,
        });
      }
      const details: string[] = [];
      if (oldName !== payload.name) details.push(`الاسم: ${oldName} ← ${payload.name}`);
      details.push(`الفروع: ${branchLabel}`);
      details.push(`الراتب: ${fmt(payload.salary)}`);
      if (pinWasChanged) details.push('تم تحديث الرقم السري');
      addLog(
        d,
        user.name,
        `تعديل بيانات ${payload.name} (${details.join(' · ')})`,
        primaryStoreId
      );
      return d;
    });
    notify(
      pinWasChanged
        ? `تم حفظ تعديلات ${payload.name} وإرسال إشعار بتغيير الرقم السري للمالك`
        : `تم حفظ تعديلات ${payload.name}`
    );
  };

  const saveStoreRename = (storeId: number) => {
    const trimmed = editingStoreName.trim();
    if (!trimmed) {
      notify('أدخل اسم المحل');
      return;
    }
    upd((d) => {
      const st = d.stores.find((s) => s.id === storeId);
      if (st && st.name !== trimmed) {
        const oldName = st.name;
        st.name = trimmed;
        addLog(d, user.name, `تغيير اسم فرع "${oldName}" إلى "${trimmed}"`, storeId);
      }
      return d;
    });
    setEditingStoreId(null);
    setEditingStoreName('');
    notify('تم تحديث اسم المحل');
  };

  const handleExportBackup = () => {
    try {
      const blob = new Blob([JSON.stringify(db, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pos-backup-${dayKey(Date.now())}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify('تم تحميل النسخة الاحتياطية بنجاح');
    } catch {
      notify('تعذر تصدير النسخة الاحتياطية');
    }
  };

  const handleImportBackup = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<PosDatabase>;
      if (!parsed || !Array.isArray(parsed.users) || parsed.users.length === 0) {
        notify('ملف النسخة الاحتياطية غير صالح');
        return;
      }
      const migrated = migrateDatabase(parsed);
      upd(() => {
        addLog(migrated, user.name, 'استعادة نسخة احتياطية كاملة (JSON)');
        return migrated;
      });
      notify('تمت استعادة النسخة الاحتياطية بنجاح');
    } catch {
      notify('تعذر قراءة ملف النسخة الاحتياطية');
    }
  };

  const filteredDiscounts = (db.discounts ?? []).filter((d) =>
    matchStore(d.storeId)
  );
  const openInvoicesList = db.stockIntakes.filter(
    (i) =>
      i.status !== 'rejected' &&
      matchStore(i.storeId) &&
      getIntakeTotals(i).paymentStatus !== 'paid'
  );
  const noPhotoInvoicesCount = db.stockIntakes.filter(
    (i) => i.status !== 'rejected' && matchStore(i.storeId) && !i.photoDataUrl
  ).length;
  const unreadOwnerAlerts = (db.ownerAlerts ?? []).filter((a) => {
    if (a.read) return false;
    if (user.owner) return true;
    const isBranchImportant =
      a.kind === 'price' || a.kind === 'critical' || a.title.includes('سعر');
    return (
      isBranchImportant &&
      (!a.storeId || allowedStoreIds.includes(a.storeId))
    );
  });

  const unreadMessagesCount = useMemo(
    () => getUnreadMessagesCount(db, user, allowedStoreIds),
    [db, user, allowedStoreIds]
  );

  const curMonth = monthKey(Date.now());
  const nextMonth = getNextMonthKey(curMonth);
  const isEndOfWeekNotice = isEndOfWeekDay(Date.now());
  const dueUnpaidGoodsWithdrawals = db.withdrawals
    .filter(
      (w) =>
        w.type === 'goods' &&
        w.status !== 'rejected' &&
        !w.paid &&
        w.whoType === 'employee' &&
        matchStore(w.storeId) &&
        (!w.deferredToMonth || w.deferredToMonth <= curMonth)
    )
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const dueUnpaidGoodsTotal =
    Math.round(
      dueUnpaidGoodsWithdrawals.reduce(
        (sum, w) => sum + getWithdrawalWholesaleTotal(w, db.products),
        0
      ) * 100
    ) / 100;

  const openCustomerDebtsCount = (db.customerDebts ?? []).filter(
    (cd) => matchStore(cd.storeId) && !getCustomerDebtTotals(cd).isPaid
  ).length;

  const findStaffForWithdrawal = (w: Withdrawal): User | undefined => {
    if (w.takenByUserId) {
      const byId = db.users.find((u) => u.id === w.takenByUserId);
      if (byId) return byId;
    }
    const targetName = norm(w.takenBy || w.emp);
    return db.users.find((u) => norm(u.name) === targetName);
  };

  const unreadActivityCount = useMemo(
    () =>
      (db.activityAlerts ?? []).filter((a) => {
        if (a.read) return false;
        if (a.storeId !== undefined) return allowedStoreIds.includes(a.storeId);
        return Boolean(user.owner) || (a.category !== 'security_pin' && a.category !== 'stock_edit');
      }).length,
    [db.activityAlerts, allowedStoreIds, user.owner]
  );

  const primaryTabs: { key: ManagerTab; label: string; icon: React.ReactNode }[] = [
    {
      key: 'dash',
      label: pendingCount > 0 ? `الرئيسية (${pendingCount})` : 'الرئيسية',
      icon: <LayoutDashboard className="h-4 w-4" />,
    },
    {
      key: 'inv',
      label:
        lowStockFiltered.length > 0
          ? `المخزون (${lowStockFiltered.length})`
          : 'المخزون',
      icon: <Package className="h-4 w-4" />,
    },
    {
      key: 'cash',
      label: 'الصندوق والتقارير',
      icon: <Wallet className="h-4 w-4" />,
    },
    {
      key: 'monthly',
      label: 'التقرير الشهري',
      icon: <CalendarDays className="h-4 w-4" />,
    },
    {
      key: 'alerts',
      label:
        unreadActivityCount > 0
          ? `الإشعارات (${unreadActivityCount})`
          : 'الإشعارات',
      icon: <Bell className="h-4 w-4" />,
    },
  ];

  const secondaryTabs: { key: ManagerTab; label: string; icon: React.ReactNode }[] = [
    {
      key: 'debts',
      label:
        openCustomerDebtsCount > 0
          ? `ديون زباين (${openCustomerDebtsCount})`
          : 'ديون زباين',
      icon: <UserCheck className="h-4 w-4" />,
    },
    {
      key: 'archive',
      label: `أرشيف الفواتير (${db.stockIntakes.filter((i) => matchStore(i.storeId)).length})`,
      icon: <ImageIcon className="h-4 w-4" />,
    },
    {
      key: 'discounts',
      label:
        filteredDiscounts.length > 0
          ? `الخصومات (${filteredDiscounts.length})`
          : 'الخصومات',
      icon: <Tag className="h-4 w-4" />,
    },
    { key: 'staff', label: 'الموظفون والمحلات', icon: <Users className="h-4 w-4" /> },
    {
      key: 'sync',
      label: 'جداول إكسل والمزامنة',
      icon: <FileSpreadsheet className="h-4 w-4" />,
    },
    {
      key: 'log',
      label: 'سجل التدقيق',
      icon: <ClipboardList className="h-4 w-4" />,
    },
  ];
  const activeSecondaryTab = secondaryTabs.find((t) => t.key === tab) ?? null;

  const defaultStoreForModal =
    selectedStoreId === 'all'
      ? accessibleStores[0]?.id ?? db.stores[0]?.id ?? 1
      : selectedStoreId;

  const filteredProducts = db.products.filter(
    (p) => matchStore(p.storeId) && matchesQuery(p.name, invQuery)
  );
  const filteredExpenses = db.expenses.filter((e) => matchStore(e.storeId));
  const filteredSalaries = db.salaries.filter((s) => matchStore(s.storeId));
  const filteredWithdrawals = db.withdrawals.filter((w) =>
    matchStore(w.storeId)
  );
  const filteredStaffAndCashWithdrawals = filteredWithdrawals.filter(
    (w) => !(w.type === 'goods' && w.whoType === 'manager')
  );
  const filteredManagerGoodsWithdrawals = filteredWithdrawals
    .filter(
      (w) =>
        w.type === 'goods' &&
        w.status !== 'rejected' &&
        w.whoType === 'manager'
    )
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const managerGoodsWholesaleTotal =
    Math.round(
      filteredManagerGoodsWithdrawals.reduce(
        (sum, w) => sum + getWithdrawalWholesaleTotal(w, db.products),
        0
      ) * 100
    ) / 100;
  const managerGoodsUnpaidTotal =
    Math.round(
      filteredManagerGoodsWithdrawals
        .filter((w) => !w.paid)
        .reduce(
          (sum, w) => sum + getWithdrawalWholesaleTotal(w, db.products),
          0
        ) * 100
    ) / 100;
  const managerGoodsPaidTotal =
    Math.round((managerGoodsWholesaleTotal - managerGoodsUnpaidTotal) * 100) /
    100;
  const filteredBonuses = (db.bonuses ?? []).filter((b) =>
    matchStore(b.storeId)
  );
  const filteredRents = (db.rents ?? [])
    .filter((r) => matchStore(r.storeId))
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const filteredLog = db.log.filter((l) =>
    selectedStoreId === 'all'
      ? !l.storeId || allowedStoreIds.includes(l.storeId)
      : !l.storeId || l.storeId === selectedStoreId
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-base font-bold text-[#38608f] dark:text-[#78a8de] whitespace-nowrap shrink-0">
              لوحة الإدارة
            </span>
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
              {user.name} ({user.owner ? 'مالك' : 'مدير'})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <LiveClockBadge />
            <ConnectivitySyncBadge
              isOnline={sheetsSync.isOnline}
              pendingCount={sheetsSync.pendingSyncCount}
              isSyncing={sheetsSync.isSyncing}
              hasGoogleToken={Boolean(sheetsSync.accessToken)}
              trustedEmail={sheetsSync.trustedEmail}
              onSyncNow={() => void sheetsSync.flushPendingNow()}
            />
            <PWAInstallButton notify={notify} />
            <button
              type="button"
              onClick={() => setImportantAlertsOpen(true)}
              className={`flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                unreadOwnerAlerts.length > 0
                  ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
              title={
                user.owner
                  ? 'نافذة التنبيهات المهمة للمالك (الأسعار، الكميات، الأرقام السرية)'
                  : 'نافذة تنبيهات تعديل الأسعار بالفرع'
              }
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              <span className="font-num">
                التنبيهات المهمة
                {unreadOwnerAlerts.length > 0 ? ` (${unreadOwnerAlerts.length})` : ''}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMailboxOpen(true)}
              className={`flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                unreadMessagesCount > 0
                  ? 'border-[#38608f]/40 bg-[#38608f]/10 text-[#38608f] hover:bg-[#38608f]/20 dark:border-[#78a8de]/40 dark:bg-[#38608f]/25 dark:text-[#98c1f0]'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
              title="صندوق البريد الداخلي للمراسلة مع المدراء والموظفين"
            >
              <Mail className="h-3.5 w-3.5" />
              <span className="font-num">
                البريد الداخلي{unreadMessagesCount > 0 ? ` (${unreadMessagesCount})` : ''}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTab('alerts')}
              className={`flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                unreadActivityCount > 0
                  ? 'border-[#38608f]/40 bg-[#38608f]/10 text-[#38608f] hover:bg-[#38608f]/20 dark:border-[#78a8de]/40 dark:bg-[#38608f]/25 dark:text-[#98c1f0]'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
              title="لوحة الإشعارات الشاملة لجميع حركات الموظفين والمدراء"
            >
              <Bell className="h-3.5 w-3.5" />
              <span className="font-num">
                الإشعارات{unreadActivityCount > 0 ? ` (${unreadActivityCount})` : ''}
              </span>
            </button>
            {lowStockAll.length > 0 && (
              <button
                type="button"
                onClick={() => setTab('inv')}
                className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-950 whitespace-nowrap shrink-0"
                title="عرض المنتجات التي وصلت للحد الأدنى للمخزون"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className="font-num">نقص مخزون: {lowStockAll.length}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="تبديل المظهر"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-700 whitespace-nowrap shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Compact Important Alerts Strip — Full Review Opens in Dedicated Window */}
        {unreadOwnerAlerts.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/90 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/35">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-900 dark:text-amber-200 min-w-0">
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="truncate">
                {user.owner
                  ? `لديك ${unreadOwnerAlerts.length} تنبيهات مهمة للمراجعة (أسعار، كميات، أمان): ${unreadOwnerAlerts[0].title}`
                  : `تنبيهات تعديل أسعار بالفرع (${unreadOwnerAlerts.length}): ${unreadOwnerAlerts[0].title}`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setImportantAlertsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 whitespace-nowrap shrink-0"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>مراجعة التنبيهات المهمة ({unreadOwnerAlerts.length})</span>
            </button>
          </div>
        )}

        {/* End-of-Week & Payroll Unpaid Staff Goods Withdrawals Alert Banner */}
        {dueUnpaidGoodsWithdrawals.length > 0 && (
          <section
            aria-label="تنبيه مسحوبات البضاعة غير المحاسب عليها"
            className="mb-5 rounded-xl border border-rose-300 bg-rose-50/90 p-4 dark:border-rose-800 dark:bg-rose-950/35"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-rose-900 dark:text-rose-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <h2 className="text-sm font-bold">
                  {isEndOfWeekNotice
                    ? `تنبيه نهاية الأسبوع وعند صرف الرواتب (${dueUnpaidGoodsWithdrawals.length}): مسحوبات بضاعة غير محاسب عليها`
                    : `إشعار مسحوبات بضاعة غير محاسب عليها (${dueUnpaidGoodsWithdrawals.length})`}
                </h2>
                <span className="font-num rounded bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">
                  الإجمالي بسعر الجملة: {fmt(dueUnpaidGoodsTotal)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStaffWithdrawalsInitialWho('employee');
                  setStaffWithdrawalsOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#38608f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2d4f77] whitespace-nowrap"
              >
                <Wallet className="h-3.5 w-3.5" />
                <span>فتح سجل ومحاسبة الموظفين</span>
              </button>
            </div>

            <div className="space-y-2">
              {dueUnpaidGoodsWithdrawals.slice(0, 8).map((w) => {
                const taker = w.takenBy || w.emp;
                const matchedUser = findStaffForWithdrawal(w);
                const wCost = getWithdrawalWholesaleTotal(w, db.products);
                const itemsText = w.items
                  .map((i) => `${i.name} × ${i.qty}`)
                  .join('، ');
                return (
                  <div
                    key={w.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-white px-3 py-2.5 text-xs dark:border-rose-800/70 dark:bg-slate-900"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {taker}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {getStoreName(w.storeId)}
                        </span>
                        <span className="font-num font-bold text-rose-700 dark:text-rose-400">
                          جملة: {fmt(wCost)}
                        </span>
                        <span className="font-num text-[11px] text-slate-500 dark:text-slate-400">
                          ({fullDate(w.ts)})
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">
                        الأغراض: <span className="font-semibold">{itemsText}</span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {matchedUser && (
                        <button
                          type="button"
                          onClick={() => {
                            setSalaryInitialUser({
                              uid: matchedUser.id,
                              action: 'deduct',
                            });
                            setSalaryOpen(true);
                          }}
                          className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                        >
                          خصم من الراتب
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          upd((d) => {
                            const target = d.withdrawals.find(
                              (x) => x.id === w.id
                            );
                            if (target) target.deferredToMonth = nextMonth;
                            addLog(
                              d,
                              user.name,
                              `[${getStoreName(w.storeId)}] تأجيل مسحوبات البضاعة لـ ${taker} (${fmt(wCost)}) إلى شهر ${nextMonth}`,
                              w.storeId
                            );
                            return d;
                          });
                          notify(
                            `تم تأجيل سحب ${taker} للشهر القادم (${nextMonth})`
                          );
                        }}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 whitespace-nowrap"
                      >
                        تأجيل للشهر القادم
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setStaffWithdrawalsInitialWho('employee');
                          setStaffWithdrawalsOpen(true);
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
                      >
                        محاسبة الآن
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Simplified Toolbar: Essential Navigation + Categorized Dropdown Menus */}
        <div
          ref={menusContainerRef}
          className="mb-6 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Core 5 Navigation Tabs + "المزيد ▾" Dropdown */}
            <nav className="relative flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
              {primaryTabs.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setTab(item.key);
                    setOpenMenu(null);
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    tab === item.key
                      ? 'bg-[#38608f] text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}

              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenMenu((prev) =>
                      prev === 'moreTabs' ? null : 'moreTabs'
                    )
                  }
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    activeSecondaryTab
                      ? 'bg-[#38608f] text-white'
                      : openMenu === 'moreTabs'
                        ? 'bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>
                    {activeSecondaryTab ? activeSecondaryTab.label : 'المزيد'}
                  </span>
                  {!activeSecondaryTab && openCustomerDebtsCount > 0 && (
                    <span className="font-num rounded bg-[#38608f]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#38608f] dark:bg-[#38608f]/40 dark:text-[#98c1f0]">
                      {openCustomerDebtsCount}
                    </span>
                  )}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {openMenu === 'moreTabs' && (
                  <div className="absolute right-0 top-full z-40 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    {secondaryTabs.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setTab(item.key);
                          setOpenMenu(null);
                        }}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold transition-colors ${
                          tab === item.key
                            ? 'bg-[#38608f] text-white'
                            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                        }`}
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </nav>

            {/* Primary Daily Actions + 3 Clean Dropdown Menus */}
            <div className="flex flex-wrap items-center gap-2">
              {accessibleStores.length > 1 && (
                <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-800 dark:bg-slate-900">
                  <Store className="h-3.5 w-3.5 text-slate-500" />
                  <select
                    value={selectedStoreId}
                    onChange={(e) =>
                      setSelectedStoreId(
                        e.target.value === 'all' ? 'all' : Number(e.target.value)
                      )
                    }
                    className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none dark:text-slate-200"
                  >
                    <option value="all">
                      {user.owner
                        ? 'كل المحلات'
                        : `جميع فروعي (${accessibleStores.length})`}
                    </option>
                    {accessibleStores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setOpenMenu(null);
                  setIntakeOpen(true);
                }}
                className="flex items-center gap-1.5 rounded-lg bg-[#38608f] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2d4f77] whitespace-nowrap shrink-0"
              >
                <Camera className="h-3.5 w-3.5" />
                <span>إدخال بضاعة بفاتورة</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setOpenMenu(null);
                  setQuickSaleOpen(true);
                }}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap shrink-0"
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                <span>بيع طارئ</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setOpenMenu(null);
                  setReturnOpen(true);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>ترجيع غرض</span>
              </button>

              {/* Dropdown 1: المسحوبات والرواتب */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenMenu((prev) =>
                      prev === 'withdrawals' ? null : 'withdrawals'
                    )
                  }
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    openMenu === 'withdrawals'
                      ? 'border-[#38608f] bg-[#38608f] text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <Wallet className="h-3.5 w-3.5" />
                  <span>المسحوبات والرواتب</span>
                  {dueUnpaidGoodsWithdrawals.length > 0 && (
                    <span className="font-num rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {dueUnpaidGoodsWithdrawals.length}
                    </span>
                  )}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {openMenu === 'withdrawals' && (
                  <div className="absolute left-0 top-full z-40 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        setWithdrawInitialMode('manager_goods');
                        setWithdrawOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-[#38608f] hover:bg-slate-100 dark:text-[#98c1f0] dark:hover:bg-slate-800"
                    >
                      <Package className="h-3.5 w-3.5 shrink-0" />
                      <span>سحب بضاعة (مدير / مالك)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        setStaffWithdrawalsInitialWho('manager');
                        setStaffWithdrawalsOpen(true);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-indigo-800 hover:bg-slate-100 dark:text-indigo-300 dark:hover:bg-slate-800"
                    >
                      <span className="flex items-center gap-2">
                        <ClipboardList className="h-3.5 w-3.5 shrink-0" />
                        <span>قائمة مسحوبات المدير والمالك</span>
                      </span>
                      {filteredManagerGoodsWithdrawals.length > 0 && (
                        <span className="font-num rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {filteredManagerGoodsWithdrawals.length}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        setStaffWithdrawalsInitialWho('employee');
                        setStaffWithdrawalsOpen(true);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <span className="flex items-center gap-2">
                        <PackageMinus className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <span>محاسبة مسحوبات الموظفين</span>
                      </span>
                      {dueUnpaidGoodsWithdrawals.length > 0 && (
                        <span className="font-num rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {dueUnpaidGoodsWithdrawals.length}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        setSalaryInitialUser(null);
                        setSalaryOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-emerald-700 hover:bg-slate-100 dark:text-emerald-300 dark:hover:bg-slate-800"
                    >
                      <CreditCard className="h-3.5 w-3.5 shrink-0" />
                      <span>صرف راتب</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        setBonusModal({
                          storeId:
                            selectedStoreId === 'all' ? undefined : selectedStoreId,
                        });
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-amber-800 hover:bg-slate-100 dark:text-amber-300 dark:hover:bg-slate-800"
                    >
                      <Award className="h-3.5 w-3.5 shrink-0" />
                      <span>إرسال مكافأة</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Dropdown 2: الفواتير والإيجار */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenMenu((prev) =>
                      prev === 'invoices' ? null : 'invoices'
                    )
                  }
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    openMenu === 'invoices'
                      ? 'border-[#38608f] bg-[#38608f] text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>الفواتير والإيجار</span>
                  {openInvoicesList.length > 0 && (
                    <span className="font-num rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {openInvoicesList.length}
                    </span>
                  )}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {openMenu === 'invoices' && (
                  <div className="absolute left-0 top-full z-40 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        setPaymentsInitialFilter('unpaid_partial');
                        setPaymentsOpen(true);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <span className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-rose-600" />
                        <span>دفعات الفواتير</span>
                      </span>
                      {openInvoicesList.length > 0 && (
                        <span className="font-num rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {openInvoicesList.length}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        setPaymentsInitialFilter(
                          noPhotoInvoicesCount > 0 ? 'no_photo' : 'all'
                        );
                        setPaymentsOpen(true);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <span className="flex items-center gap-2">
                        <Upload className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <span>إضافة صورة لفاتورة قديمة</span>
                      </span>
                      {noPhotoInvoicesCount > 0 && (
                        <span className="font-num rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {noPhotoInvoicesCount}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        setRentOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-[#38608f] hover:bg-slate-100 dark:text-[#78a8de] dark:hover:bg-slate-800"
                    >
                      <Building2 className="h-3.5 w-3.5 shrink-0" />
                      <span>تسجيل إيجار المحل</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Dropdown 3: تقارير وإدارة */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenMenu((prev) =>
                      prev === 'reports' ? null : 'reports'
                    )
                  }
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    openMenu === 'reports'
                      ? 'border-[#38608f] bg-[#38608f] text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  <span>تقارير وإدارة</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {openMenu === 'reports' && (
                  <div className="absolute left-0 top-full z-40 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        setSalesReviewModal({
                          mode: 'daily',
                          storeId: selectedStoreId,
                        });
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <BarChart3 className="h-3.5 w-3.5 shrink-0 text-[#38608f]" />
                      <span>مبيع الفروع اليوم</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        setSalesReviewModal({
                          mode: 'monthly',
                          storeId: selectedStoreId,
                        });
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <CalendarDays className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span>مبيع الفروع بالشهر</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        openShiftsView('daily');
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Clock className="h-3.5 w-3.5 shrink-0 text-[#38608f]" />
                      <span>جرد الدوامات</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        setAddBranchOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-emerald-700 hover:bg-slate-100 dark:text-emerald-300 dark:hover:bg-slate-800"
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0" />
                      <span>إضافة فرع جديد</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        setTab('sync');
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span>جداول إكسل و Google Sheets</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {activeSecondaryTab && (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
                <span className="text-[#38608f] dark:text-[#78a8de]">القسم الحالي:</span>
                <span>{activeSecondaryTab.label}</span>
              </div>
              <button
                type="button"
                onClick={() => setTab('dash')}
                className="font-semibold text-[#38608f] hover:underline dark:text-[#78a8de]"
              >
                العودة للرئيسية
              </button>
            </div>
          )}
        </div>

        {salaryOpen && (
          <SalaryForm
            db={db}
            currentUser={user}
            initialEmployeeId={salaryInitialUser?.uid}
            initialWithdrawalAction={salaryInitialUser?.action}
            notify={notify}
            onClose={() => {
              setSalaryOpen(false);
              setSalaryInitialUser(null);
            }}
            onSubmit={(u, netAmount, isManagerPin, settlement) => {
              const targetStore =
                selectedStoreId === 'all'
                  ? u.storeId ?? db.stores[0]?.id ?? 1
                  : selectedStoreId;
              upd((d) => {
                const salaryId = d.nid++;
                const nowTs = Date.now();
                const isDeduct =
                  settlement?.action === 'deduct' &&
                  settlement.deductionAmount > 0;
                const isDefer =
                  settlement?.action === 'defer' &&
                  settlement.targetWithdrawalIds.length > 0;

                d.salaries.unshift({
                  id: salaryId,
                  storeId: targetStore,
                  uid: u.id,
                  name: u.name,
                  amount: netAmount,
                  grossAmount: settlement?.grossAmount ?? netAmount,
                  withdrawalDeduction: isDeduct
                    ? settlement.deductionAmount
                    : 0,
                  deductedWithdrawalIds: isDeduct
                    ? settlement.targetWithdrawalIds
                    : undefined,
                  note: isDeduct
                    ? `خصم مسحوبات بضاعة بقيمة ${fmt(settlement.deductionAmount)}`
                    : isDefer
                      ? `تأجيل مسحوبات للشهر القادم (${settlement.nextMonth})`
                      : undefined,
                  by: user.name,
                  ts: nowTs,
                  status: isManagerPin ? 'approved' : 'pending',
                });

                if (settlement) {
                  for (const wid of settlement.targetWithdrawalIds) {
                    const targetW = d.withdrawals.find((x) => x.id === wid);
                    if (!targetW) continue;
                    if (isDeduct) {
                      targetW.paid = true;
                      targetW.paidAmount = getWithdrawalWholesaleTotal(
                        targetW,
                        d.products
                      );
                      targetW.paidAt = nowTs;
                      targetW.paidBy = user.name;
                      targetW.paidToCash = false;
                      targetW.settlementMethod = 'salary_deduction';
                      targetW.deductedSalaryId = salaryId;
                      targetW.deferredToMonth = undefined;
                    } else if (isDefer) {
                      targetW.deferredToMonth = settlement.nextMonth;
                    }
                  }
                }

                addLog(
                  d,
                  user.name,
                  `[${getStoreName(targetStore)}] راتب ${u.name}: ${fmt(netAmount)}${
                    isDeduct
                      ? ` (بعد خصم مسحوبات ${fmt(settlement.deductionAmount)} من ${fmt(settlement.grossAmount)})`
                      : isDefer
                        ? ` (تم تأجيل المسحوبات إلى ${settlement.nextMonth})`
                        : ''
                  }`,
                  targetStore
                );
                return d;
              });
              notify('تم تسجيل الراتب');
            }}
          />
        )}

        {withdrawOpen && (
          <WithdrawForm
            db={db}
            storeId={defaultStoreForModal}
            storeChoices={accessibleStores}
            currentUserName={user.name}
            canRecordManagerGoods={true}
            initialMode={withdrawInitialMode}
            notify={notify}
            onClose={() => {
              setWithdrawOpen(false);
              setWithdrawInitialMode('');
            }}
            onSubmit={({
              type,
              storeId: submittedStoreId,
              whoType,
              takenBy,
              takenByUserId,
              amount,
              items,
              paid,
              paidToCash,
              managerExclusive,
              note,
            }) => {
              const targetStore = submittedStoreId ?? defaultStoreForModal;
              const targetStoreName = getStoreName(targetStore);
              upd((d) => {
                const nowTs = Date.now();
                items.forEach((item) => {
                  const prod = d.products.find((p) => p.id === item.id);
                  if (prod) {
                    const prevStock = prod.stock;
                    prod.stock -= item.qty;
                    const threshold = prod.minStock ?? 3;
                    if (prevStock > threshold && prod.stock <= threshold) {
                      addLog(
                        d,
                        'النظام',
                        `[${targetStoreName}] تنبيه تلقائي: وصول "${prod.name}" إلى الحد الأدنى للمخزون (${prod.stock} / ${threshold})`,
                        targetStore
                      );
                    }
                  }
                });
                d.withdrawals.unshift({
                  id: d.nid++,
                  storeId: targetStore,
                  type,
                  whoType,
                  takenBy,
                  takenByUserId,
                  amount,
                  items,
                  paid: type === 'goods' ? Boolean(paid) : undefined,
                  paidAmount: type === 'goods' && paid ? amount : undefined,
                  paidAt: type === 'goods' && paid ? nowTs : undefined,
                  paidBy: type === 'goods' && paid ? user.name : undefined,
                  paidToCash:
                    type === 'goods' && paid ? Boolean(paidToCash) : false,
                  settlementMethod:
                    type === 'goods' && paid ? 'cash' : undefined,
                  managerExclusive: managerExclusive ? true : undefined,
                  note,
                  emp: user.name,
                  ts: nowTs,
                  status: 'approved',
                });
                const roleLabel =
                  whoType === 'employee'
                    ? 'موظف'
                    : managerExclusive
                      ? 'مسجّل خاص (مدير / مالك)'
                      : 'مدير / مالك';
                const takerText = takenBy ? ` (${takenBy})` : '';
                const goodsStatusText =
                  type === 'goods'
                    ? ` · جملة: ${fmt(amount)} · ${paid ? 'حاسب عليها (نعم)' : 'لم يحاسب عليها (لا)'}`
                    : '';
                addLog(
                  d,
                  user.name,
                  `[${targetStoreName}] سحب ${roleLabel}${takerText} (${type === 'cash' ? fmt(amount) : 'بضاعة'}${goodsStatusText})`,
                  targetStore
                );
                return d;
              });
              notify(
                managerExclusive
                  ? 'تم تسجيل سحب البضاعة في قائمة المدير والمالك'
                  : 'تم تسجيل السحب واعتماده'
              );
            }}
          />
        )}

        {staffWithdrawalsOpen && (
          <StaffWithdrawalsModal
            key={staffWithdrawalsInitialWho}
            db={db}
            upd={upd}
            user={user}
            allowedStoreIds={allowedStoreIds}
            initialStoreId={selectedStoreId}
            initialWhoFilter={staffWithdrawalsInitialWho}
            onOpenSalaryForUser={(targetUser) => {
              setStaffWithdrawalsOpen(false);
              setStaffWithdrawalsInitialWho('all');
              setSalaryInitialUser({ uid: targetUser.id, action: 'deduct' });
              setSalaryOpen(true);
            }}
            onClose={() => {
              setStaffWithdrawalsOpen(false);
              setStaffWithdrawalsInitialWho('all');
            }}
            notify={notify}
          />
        )}

        {intakeOpen && (
          <StockIntakeModal
            db={db}
            defaultStoreId={defaultStoreForModal}
            isManager={true}
            notify={notify}
            onClose={() => setIntakeOpen(false)}
            onSubmit={({
              storeId: targetStore,
              items,
              photoDataUrl,
              supplierName,
              note,
              initialPaymentAmount,
              deductFromCash,
            }) => {
              upd((d) => {
                const id = d.nid++;
                const nowTs = Date.now();
                applyIntakeToInventory(d, targetStore, items);
                const payments =
                  initialPaymentAmount > 0
                    ? [
                        {
                          id: d.nid++,
                          amount: initialPaymentAmount,
                          by: user.name,
                          role: user.role,
                          ts: nowTs,
                          note: 'دفعة أولى عند إدخال الفاتورة',
                          deductFromCash,
                        },
                      ]
                    : [];
                d.stockIntakes.unshift({
                  id,
                  storeId: targetStore,
                  items,
                  photoDataUrl: photoDataUrl || undefined,
                  supplierName: supplierName || undefined,
                  note,
                  payments,
                  enteredBy: user.name,
                  enteredRole: user.role,
                  approvedBy: user.name,
                  status: 'approved',
                  ts: nowTs,
                  approvedTs: nowTs,
                });
                addLog(
                  d,
                  user.name,
                  `[${getStoreName(targetStore)}] إدخال بضاعة وأرشفة فاتورة #${id} (${items.length} أصناف${
                    photoDataUrl ? '' : ' · بدون صورة'
                  }${
                    initialPaymentAmount > 0
                      ? ` · دفعة ${fmt(initialPaymentAmount)}`
                      : ''
                  })`,
                  targetStore
                );
                return d;
              });
              notify('تمت إضافة البضاعة للمخزن وحفظ الفاتورة وسجل سدادها');
            }}
          />
        )}

        {addBranchOpen && (
          <AddBranchModal
            sheetsConnected={Boolean(sheetsSync.accessToken)}
            notify={notify}
            onClose={() => setAddBranchOpen(false)}
            onSubmit={createBranchAndSheets}
          />
        )}

        {rentOpen && (
          <RentModal
            db={db}
            defaultStoreId={defaultStoreForModal}
            allowedStoreIds={allowedStoreIds}
            notify={notify}
            onClose={() => setRentOpen(false)}
            onSubmit={({
              storeId: targetStore,
              month,
              usdAmount,
              exchangeRate,
              localAmount,
              deductFromCash,
              note,
            }) => {
              upd((d) => {
                if (!Array.isArray(d.rents)) d.rents = [];
                d.rents.unshift({
                  id: d.nid++,
                  storeId: targetStore,
                  month,
                  usdAmount,
                  exchangeRate,
                  localAmount,
                  deductFromCash,
                  note,
                  by: user.name,
                  ts: Date.now(),
                });
                addLog(
                  d,
                  user.name,
                  `[${getStoreName(targetStore)}] تسجيل إيجار شهر ${month}: ${usdAmount}$ × ${fmt(exchangeRate)} = ${fmt(localAmount)}`,
                  targetStore
                );
                return d;
              });
              notify(
                `تم تسجيل إيجار ${getStoreName(targetStore)} (${fmt(localAmount)}) وخصمه من ربح شهر ${month}`
              );
            }}
          />
        )}

        {paymentsOpen && (
          <InvoicePaymentsModal
            db={db}
            upd={upd}
            user={user}
            allowedStoreIds={allowedStoreIds}
            initialStoreId={selectedStoreId}
            initialFilter={paymentsInitialFilter}
            onClose={() => setPaymentsOpen(false)}
            notify={notify}
          />
        )}

        {bonusModal && (
          <BonusModal
            db={db}
            initialEmpName={bonusModal.empName}
            initialStoreId={bonusModal.storeId}
            notify={notify}
            onClose={() => setBonusModal(null)}
            onSubmit={({
              empName,
              uid,
              storeId: targetStore,
              amount,
              note,
              deductFromCash,
            }) => {
              upd((d) => {
                const now = Date.now();
                const id = d.nid++;
                if (!Array.isArray(d.bonuses)) d.bonuses = [];
                d.bonuses.unshift({
                  id,
                  storeId: targetStore,
                  uid,
                  empName,
                  amount,
                  note,
                  deductFromCash,
                  by: user.name,
                  ts: now,
                });
                if (deductFromCash) {
                  d.expenses.unshift({
                    storeId: targetStore,
                    desc: `مكافأة للموظف: ${empName}`,
                    amount,
                    emp: user.name,
                    ts: now,
                  });
                }
                addLog(
                  d,
                  user.name,
                  `[${getStoreName(targetStore)}] إرسال مكافأة للموظف ${empName} بقيمة ${fmt(amount)} (${note})`,
                  targetStore
                );
                return d;
              });
              notify(`تم إرسال مكافأة بقيمة ${fmt(amount)} إلى ${empName}`);
            }}
          />
        )}

        {editingUser && (
          <EditUserModal
            db={db}
            targetUser={editingUser}
            currentUser={user}
            notify={notify}
            onClose={() => setEditingUser(null)}
            onSubmit={saveEditedUser}
          />
        )}

        {quickSaleOpen && (
          <ManagerQuickSaleModal
            db={db}
            upd={upd}
            user={user}
            defaultStoreId={defaultStoreForModal}
            notify={notify}
            onClose={() => setQuickSaleOpen(false)}
          />
        )}

        {returnOpen && (
          <ReturnGoodsModal
            db={db}
            upd={upd}
            user={user}
            storeId={defaultStoreForModal}
            storeName={getStoreName(defaultStoreForModal)}
            todaySales={db.sales.filter(
              (s) => s.storeId === defaultStoreForModal && sameDay(s.ts)
            )}
            onClose={() => setReturnOpen(false)}
            notify={notify}
          />
        )}

        {salesReviewModal && (
          <BranchSalesReviewModal
            db={db}
            initialMode={salesReviewModal.mode}
            initialStoreId={salesReviewModal.storeId}
            onClose={() => setSalesReviewModal(null)}
          />
        )}

        {/* TAB: DASHBOARD */}
        {tab === 'dash' && (
          <DashboardView
            db={db}
            selectedStoreId={selectedStoreId}
            allowedStoreIds={allowedStoreIds}
            onDecideWithdrawal={decideWithdrawal}
            onDecideSalary={decideSalary}
            onDecideIntake={decideIntake}
            onOpenInventory={() => setTab('inv')}
            onOpenIntake={() => setIntakeOpen(true)}
            onOpenMonthly={() => setTab('monthly')}
            onOpenShifts={(mode) => openShiftsView(mode ?? 'daily')}
            onSendBonus={(empName, storeId) =>
              setBonusModal({ empName, storeId })
            }
            onSelectStore={setSelectedStoreId}
            sheetsConnected={Boolean(sheetsSync.accessToken)}
            onOpenSync={() => setTab('sync')}
            onOpenBranchSalesReview={(mode, storeId) =>
              setSalesReviewModal({
                mode,
                storeId: storeId ?? selectedStoreId,
              })
            }
            onAttachIntakePhoto={(intake, photoDataUrl) => {
              const sName = getStoreName(intake.storeId);
              const hadPhoto = Boolean(intake.photoDataUrl);
              upd((d) => {
                const target = d.stockIntakes.find((x) => x.id === intake.id);
                if (target) target.photoDataUrl = photoDataUrl;
                addLog(
                  d,
                  user.name,
                  `[${sName}] ${hadPhoto ? 'تحديث' : 'إضافة'} صورة فاتورة #${intake.id}`,
                  intake.storeId
                );
                return d;
              });
              notify(
                hadPhoto
                  ? `تم تحديث صورة الفاتورة #${intake.id}`
                  : `تمت إضافة صورة للفاتورة #${intake.id}`
              );
            }}
            notify={notify}
          />
        )}

        {/* TAB: MONTHLY REPORT */}
        {tab === 'monthly' && (
          <MonthlyReportView
            db={db}
            selectedStoreId={selectedStoreId}
            allowedStoreIds={allowedStoreIds}
            onSendBonus={(empName, storeId) =>
              setBonusModal({ empName, storeId })
            }
            onDeleteRent={handleDeleteRent}
          />
        )}

        {/* TAB: INVENTORY */}
        {tab === 'inv' && (
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold">المخزون والأسعار</h3>
                  <p className="text-xs text-rose-600 dark:text-rose-400">
                    الصفوف المظللة بالأحمر = وصلت كميتها إلى حد التنبيه المحدد أو أقل
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      placeholder="بحث في المخزون..."
                      value={invQuery}
                      onChange={(e) => setInvQuery(e.target.value)}
                      className="w-48 rounded-lg border border-slate-300 bg-white py-1.5 pr-8 pl-3 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      exportMasterInventoryWorkbook(db);
                      notify('تم تصدير شيت إجمالي المخزون ودخول البضاعة (.xlsx)');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>شيت إجمالي المخزون (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('sync')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 dark:hover:bg-emerald-950 whitespace-nowrap"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    <span>مزامنة إكسل و Google Sheets</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIntakeOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#38608f] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#2d4f77] whitespace-nowrap"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <span>إدخال بضاعة بفاتورة (الصورة اختيارية)</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                      {db.stores.length > 1 && (
                        <th className="px-3 py-2.5 text-right font-semibold">
                          المحل
                        </th>
                      )}
                      <th className="px-3 py-2.5 text-right font-semibold">
                        الاسم
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        سعر البيع
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        الحد الأدنى للبيع
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        الجملة (التكلفة)
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        المخزون
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        حد التنبيه (كمية)
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        حذف
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredProducts.length === 0 ? (
                      <tr>
                        <td
                          colSpan={db.stores.length > 1 ? 8 : 7}
                          className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400"
                        >
                          لا توجد منتجات في هذا المحل حالياً
                        </td>
                      </tr>
                    ) : (
                      filteredProducts.map((p) => {
                        const isLow = p.stock <= (p.minStock ?? 3);
                        return (
                          <tr
                            key={p.id}
                            className={
                              isLow
                                ? 'bg-rose-50/90 dark:bg-rose-950/40'
                                : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                            }
                          >
                            {db.stores.length > 1 && (
                              <td className="px-2 py-2 whitespace-nowrap">
                                <select
                                  value={p.storeId}
                                  onChange={(e) =>
                                    updateProductStore(
                                      p.id,
                                      Number(e.target.value)
                                    )
                                  }
                                  className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                                >
                                  {db.stores.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            )}
                            <td className="px-2 py-2">
                              <CommittedCellInput
                                ariaLabel={`اسم ${p.name}`}
                                value={p.name}
                                onCommit={(val) =>
                                  updateProductField(p.id, 'name', val)
                                }
                                className="w-full min-w-[140px] rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                              />
                            </td>
                            {(['price', 'min', 'cost'] as const).map((k) => (
                              <td key={k} className="px-2 py-2 text-center">
                                <CommittedCellInput
                                  type="number"
                                  ariaLabel={`${k} ${p.name}`}
                                  value={p[k] ?? 0}
                                  onCommit={(val) =>
                                    updateProductField(p.id, k, val)
                                  }
                                  className="font-num w-20 rounded border border-slate-300 bg-white px-2 py-1.5 text-center text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                                />
                              </td>
                            ))}
                            {/* Locked Stock Column: direct edits restricted exclusively to Owner + PIN */}
                            <td className="px-2 py-2 text-center">
                              <div className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
                                <span
                                  className={`font-num inline-flex min-w-[44px] items-center justify-center rounded border px-2 py-1 text-sm font-bold ${
                                    isLow
                                      ? 'border-rose-300 bg-rose-100/70 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                      : 'border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                                  }`}
                                  title={
                                    user.owner
                                      ? 'الكمية مقفلة لحماية المخزون — لتعديلها استخدم كلمة سر المالك أو الفواتير'
                                      : 'مقفل للمدراء: تُضاف الكميات حصراً عبر فاتورة التوريد أو إضافة منتج، وللتعديل يلزم المالك وكلمة سره'
                                  }
                                >
                                  {fmt(p.stock)}
                                </span>
                                {user.owner ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setStockEditModal({
                                        product: p,
                                        newStock: String(p.stock),
                                        ownerPin: '',
                                        reason: '',
                                      })
                                    }
                                    className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                                    title="تعديل الكمية بكلمة سر المالك"
                                  >
                                    <KeyRound className="h-3 w-3" />
                                    <span>تعديل</span>
                                  </button>
                                ) : (
                                  <span
                                    className="inline-flex items-center text-slate-400 dark:text-slate-500"
                                    title="مقفل: لتعديل الكمية يلزم المالك بكلمة سره أو إدخال فاتورة / إضافة منتج"
                                  >
                                    <Lock className="h-3.5 w-3.5" />
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <CommittedCellInput
                                type="number"
                                ariaLabel={`حد التنبيه ${p.name}`}
                                value={p.minStock ?? 3}
                                onCommit={(val) =>
                                  updateProductField(p.id, 'minStock', val)
                                }
                                className="font-num w-20 rounded border border-slate-300 bg-white px-2 py-1.5 text-center text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                              />
                            </td>
                            <td className="px-2 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => setDeletingProduct(p)}
                                className="inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-900/50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>حذف</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <form
              onSubmit={addProduct}
              className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <h3 className="mb-4 text-base font-bold">إضافة منتج سريع للمخزون</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
                {db.stores.length > 1 && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                      المحل / الفرع
                    </label>
                    <select
                      value={newProd.storeId}
                      onChange={(e) =>
                        setNewProd({ ...newProd, storeId: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                    >
                      {db.stores.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                      <option value="all">جميع المحلات</option>
                    </select>
                  </div>
                )}
                {(
                  [
                    ['name', 'الاسم المحدد', 'text'],
                    ['price', 'سعر المبيع', 'number'],
                    ['min', 'أدنى سعر بيع', 'number'],
                    ['cost', 'سعر الجملة', 'number'],
                    ['stock', 'العدد', 'number'],
                    ['minStock', 'حد التنبيه', 'number'],
                  ] as const
                ).map(([k, label, type]) => (
                  <div key={k}>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                      {label}
                    </label>
                    <input
                      type={type}
                      placeholder={label}
                      value={newProd[k]}
                      onChange={(e) =>
                        setNewProd({ ...newProd, [k]: e.target.value })
                      }
                      className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 ${
                        type === 'number' ? 'font-num' : ''
                      }`}
                    />
                  </div>
                ))}
              </div>
              <button
                type="submit"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4" />
                <span>إضافة للمخزون</span>
              </button>
            </form>

            {/* Incoming Goods Chronological Ledger (Main Warehouse & Branches) */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold">
                    سجل دخول البضاعة حسب التاريخ (المخزن الرئيسي والفروع)
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    كل بضاعة تدخل لأي فرع تُسجّل تلقائياً هنا وبشيت إجمالي المخزون مع التاريخ واليوم والأصناف الداخلة
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    exportMasterInventoryWorkbook(db);
                    notify('تم تصدير شيت إجمالي المخزون ودخول البضاعة (.xlsx)');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>تصدير Excel حسب اليوم والشهر</span>
                </button>
              </div>
              {(() => {
                const entries = collectIncomingGoodsEntries(
                  db,
                  selectedStoreId === 'all' ? undefined : selectedStoreId
                );
                return (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                          <th className="px-3 py-2 text-right font-semibold">التاريخ والوقت</th>
                          <th className="px-3 py-2 text-right font-semibold">الفرع</th>
                          <th className="px-3 py-2 text-right font-semibold">الصنف الداخل</th>
                          <th className="px-3 py-2 text-center font-semibold">الكمية</th>
                          <th className="px-3 py-2 text-center font-semibold">سعر الجملة</th>
                          <th className="px-3 py-2 text-center font-semibold">إجمالي التكلفة</th>
                          <th className="px-3 py-2 text-right font-semibold">المصدر / المدخل</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {entries.length === 0 ? (
                          <tr>
                            <td
                              colSpan={7}
                              className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400"
                            >
                              لا توجد حركات دخول بضاعة مسجلة بعد
                            </td>
                          </tr>
                        ) : (
                          entries.slice(0, 60).map((entry, idx) => (
                            <tr
                              key={`${entry.refId}-${idx}`}
                              className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                            >
                              <td className="font-num px-3 py-2 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                {dayKey(entry.ts)} · {tm(entry.ts)}
                              </td>
                              <td className="px-3 py-2 text-xs font-semibold text-[#38608f] dark:text-[#78a8de] whitespace-nowrap">
                                {entry.storeName}
                              </td>
                              <td className="px-3 py-2 font-semibold">{entry.name}</td>
                              <td className="font-num px-3 py-2 text-center font-bold text-emerald-600 dark:text-emerald-400">
                                +{fmt(entry.qty)}
                              </td>
                              <td className="font-num px-3 py-2 text-center">
                                {fmt(entry.cost)}
                              </td>
                              <td className="font-num px-3 py-2 text-center font-semibold">
                                {fmt(entry.totalCost)}
                              </td>
                              <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                                {entry.sourceLabel} ({entry.enteredBy})
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* TAB: INVOICE PHOTO ARCHIVE */}
        {tab === 'archive' && (
          <ArchiveView
            db={db}
            upd={upd}
            userName={user.name}
            selectedStoreId={selectedStoreId}
            onOpenNewIntake={() => setIntakeOpen(true)}
            onOpenPayments={() => {
              setPaymentsInitialFilter('unpaid_partial');
              setPaymentsOpen(true);
            }}
            onOpenAttachOldPhoto={() => {
              setPaymentsInitialFilter(
                noPhotoInvoicesCount > 0 ? 'no_photo' : 'all'
              );
              setPaymentsOpen(true);
            }}
            notify={notify}
          />
        )}

        {/* TAB: CASH & REPORTS */}
        {tab === 'cash' && (() => {
          const cashSellers = Array.from(
            new Set([
              ...db.sales.filter((s) => matchStore(s.storeId)).map((s) => s.emp),
              ...filteredExpenses.map((e) => e.emp),
              ...filteredSalaries.map((s) => s.name),
            ].filter(Boolean))
          ).sort((a, b) => a.localeCompare(b, 'ar'));

          const matchCashEmp = (name: string) =>
            cashStaffFilter === 'all' || norm(name) === norm(cashStaffFilter);
          const matchCashItem = (name: string) =>
            !cashItemQuery.trim() || matchesQuery(name, cashItemQuery);

          const filteredCashSales = db.sales
            .filter(
              (s) =>
                matchStore(s.storeId) &&
                matchCashEmp(s.emp) &&
                (!cashItemQuery.trim() || s.items.some((i) => matchCashItem(i.name)))
            )
            .slice(0, cashStaffFilter !== 'all' || cashItemQuery.trim() ? 40 : 20);
          const scopedCashExpenses = filteredExpenses.filter((e) =>
            matchCashEmp(e.emp)
          );
          const scopedCashSalaries = filteredSalaries.filter(
            (s) => matchCashEmp(s.name) || matchCashEmp(s.by)
          );

          return (
          <div className="space-y-6">
            <ShiftsAuditSection
              key={`shifts-${shiftsMode}-${shiftsFocusTick}`}
              db={db}
              selectedStoreId={selectedStoreId}
              initialViewMode={shiftsMode}
            />

            {/* Quick Employee & Item Filter for Cash/Sales Tab */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    فلترة حسب الموظف:
                  </span>
                  <button
                    type="button"
                    onClick={() => setCashStaffFilter('all')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                      cashStaffFilter === 'all'
                        ? 'bg-[#38608f] text-white'
                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                    }`}
                  >
                    الكل
                  </button>
                  {cashSellers.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() =>
                        setCashStaffFilter((prev) =>
                          prev === name ? 'all' : name
                        )
                      }
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                        cashStaffFilter === name
                          ? 'bg-[#38608f] text-white'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      value={cashItemQuery}
                      onChange={(e) => setCashItemQuery(e.target.value)}
                      placeholder="فلترة باسم القطعة..."
                      className="w-48 rounded-lg border border-slate-300 bg-white py-1.5 pr-8 pl-3 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  {(cashStaffFilter !== 'all' || cashItemQuery.trim()) && (
                    <button
                      type="button"
                      onClick={() => {
                        setCashStaffFilter('all');
                        setCashItemQuery('');
                      }}
                      className="text-xs font-semibold text-[#38608f] hover:underline dark:text-[#78a8de]"
                    >
                      إلغاء
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Filtered Sales History Table */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-base font-bold">
                  فواتير المبيعات التفصيلية ({filteredCashSales.length})
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    setSalesReviewModal({
                      mode: 'daily',
                      storeId: selectedStoreId,
                    })
                  }
                  className="text-xs font-semibold text-[#38608f] hover:underline dark:text-[#78a8de]"
                >
                  مراجعة المبيع اليومي والشهري ◂
                </button>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                      <th className="px-3 py-2 text-right font-semibold">#</th>
                      <th className="px-3 py-2 text-right font-semibold">الفرع</th>
                      <th className="px-3 py-2 text-right font-semibold">البائع</th>
                      <th className="px-3 py-2 text-right font-semibold">القطعة</th>
                      <th className="px-3 py-2 text-center font-semibold">العدد</th>
                      <th className="px-3 py-2 text-center font-semibold">المبلغ</th>
                      <th className="px-3 py-2 text-left font-semibold">الوقت</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredCashSales.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-6 text-center text-slate-500 dark:text-slate-400"
                        >
                          لا توجد مبيعات مطابقة للفلتر
                        </td>
                      </tr>
                    ) : (
                      filteredCashSales.flatMap((s) =>
                        s.items
                          .filter((item) => matchCashItem(item.name))
                          .map((item, idx) => (
                            <tr key={`${s.id}-${item.id}-${idx}`}>
                              <td className="font-num px-3 py-2 font-semibold">#{s.id}</td>
                              <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                                {getStoreName(s.storeId)}
                              </td>
                              <td className="px-3 py-2 font-medium">{s.emp}</td>
                              <td className="px-3 py-2 font-medium">{item.name}</td>
                              <td className="font-num px-3 py-2 text-center">
                                {item.qty - item.ret}
                              </td>
                              <td className="font-num px-3 py-2 text-center font-bold text-emerald-600 dark:text-emerald-400">
                                {fmt(item.price * (item.qty - item.ret))}
                              </td>
                              <td className="font-num px-3 py-2 text-left text-xs text-slate-500 dark:text-slate-400">
                                {fullDate(s.ts)}
                              </td>
                            </tr>
                          ))
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="mb-3 text-base font-bold">المصاريف</h3>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                        <th className="px-3 py-2 text-right font-semibold">
                          البيان
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          المبلغ
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          الموظف
                        </th>
                        <th className="px-3 py-2 text-left font-semibold">
                          الوقت
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {scopedCashExpenses.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-4 py-6 text-center text-slate-500 dark:text-slate-400"
                          >
                            لا توجد مصاريف
                          </td>
                        </tr>
                      ) : (
                        scopedCashExpenses.slice(0, 30).map((e, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 font-medium">
                              {e.desc}
                              {selectedStoreId === 'all' && db.stores.length > 1 && (
                                <span className="mr-1.5 text-xs font-normal text-slate-400">
                                  ({getStoreName(e.storeId)})
                                </span>
                              )}
                            </td>
                            <td className="font-num px-3 py-2 text-center">
                              {fmt(e.amount)}
                            </td>
                            <td className="px-3 py-2 text-center">{e.emp}</td>
                            <td className="font-num px-3 py-2 text-left text-xs text-slate-500 dark:text-slate-400">
                              {tm(e.ts)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="mb-3 text-base font-bold">الرواتب</h3>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                        <th className="px-3 py-2 text-right font-semibold">
                          الموظف
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          المبلغ
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          سجّله
                        </th>
                        <th className="px-3 py-2 text-left font-semibold">
                          الحالة
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {scopedCashSalaries.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-4 py-6 text-center text-slate-500 dark:text-slate-400"
                          >
                            لا توجد رواتب مسجلة
                          </td>
                        </tr>
                      ) : (
                        scopedCashSalaries.slice(0, 30).map((s) => (
                          <tr key={s.id}>
                            <td className="px-3 py-2 font-medium">
                              <div>{s.name}</div>
                              {(s.withdrawalDeduction ?? 0) > 0 && (
                                <p className="font-num text-[11px] text-rose-600 dark:text-rose-400">
                                  خُصم {fmt(s.withdrawalDeduction ?? 0)} مسحوبات (الأساسي{' '}
                                  {fmt(s.grossAmount ?? s.amount + (s.withdrawalDeduction ?? 0))})
                                </p>
                              )}
                            </td>
                            <td className="font-num px-3 py-2 text-center">
                              {fmt(s.amount)}
                            </td>
                            <td className="px-3 py-2 text-center">{s.by}</td>
                            <td className="px-3 py-2 text-left text-xs font-semibold">
                              {STATUS_LABEL[s.status]}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-indigo-200 bg-white p-5 dark:border-indigo-900/60 dark:bg-slate-900">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    قائمة مسحوبات البضاعة الخاصة بالمدير والمالك فقط
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    خيار مسجّل خاص بالمدراء والمالكين فقط بسعر الجملة، مربوط تلقائياً مع ورقة «مسحوبات المدير والمالك» في Excel و Google Sheets.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStaffWithdrawalsInitialWho('manager');
                      setStaffWithdrawalsOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-900 transition-colors hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200 whitespace-nowrap"
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    <span>تصفية ومحاسبة القائمة</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWithdrawInitialMode('manager_goods');
                      setWithdrawOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#38608f] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#2d4f77] whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>تسجيل سحب بضاعة (مدير / مالك)</span>
                  </button>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    عدد عمليات السحب
                  </p>
                  <p className="font-num mt-0.5 text-base font-bold text-slate-900 dark:text-slate-100">
                    {filteredManagerGoodsWithdrawals.length}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    إجمالي الجملة المسحوبة
                  </p>
                  <p className="font-num mt-0.5 text-base font-bold text-[#38608f] dark:text-[#78a8de]">
                    {fmt(managerGoodsWholesaleTotal)}
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 dark:border-emerald-900/60 dark:bg-emerald-950/30">
                  <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                    محاسب عليها (نعم)
                  </p>
                  <p className="font-num mt-0.5 text-base font-bold text-emerald-700 dark:text-emerald-300">
                    {fmt(managerGoodsPaidTotal)}
                  </p>
                </div>
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 dark:border-indigo-900/60 dark:bg-indigo-950/30">
                  <p className="text-[11px] font-medium text-indigo-800 dark:text-indigo-200">
                    مسجّل بالقائمة (بدون دفع)
                  </p>
                  <p className="font-num mt-0.5 text-base font-bold text-[#38608f] dark:text-[#78a8de]">
                    {fmt(managerGoodsUnpaidTotal)}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                      <th className="px-3 py-2.5 text-right font-semibold">#</th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        التاريخ والوقت
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        الفرع
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        المالك / المدير
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        الأصناف المسحوبة (تحت بعض بسعر الجملة)
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        إجمالي الجملة
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        حالة الدفع / التسجيل
                      </th>
                      <th className="px-3 py-2.5 text-left font-semibold">
                        خيارات الدفع والتسجيل
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredManagerGoodsWithdrawals.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-6 text-center text-slate-500 dark:text-slate-400"
                        >
                          لا توجد مسحوبات بضاعة مسجلة للمدير أو المالك حتى الآن
                        </td>
                      </tr>
                    ) : (
                      filteredManagerGoodsWithdrawals.slice(0, 50).map((w) => {
                        const takerUser = findStaffForWithdrawal(w);
                        const wholesaleVal = getWithdrawalWholesaleTotal(
                          w,
                          db.products
                        );
                        const isInlinePaying = inlineManagerPayId === w.id;
                        return (
                          <tr key={w.id}>
                            <td className="font-num px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                              #{w.id}
                            </td>
                            <td className="font-num px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                              {fullDate(w.ts)}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                              {getStoreName(w.storeId)}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-semibold text-slate-900 dark:text-slate-100">
                                  {w.takenBy || w.emp}
                                </span>
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                                    takerUser?.owner
                                      ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300'
                                      : 'bg-[#38608f]/15 text-[#38608f] dark:bg-[#38608f]/30 dark:text-[#98c1f0]'
                                  }`}
                                >
                                  {takerUser?.owner ? 'مالك' : 'مدير'}
                                </span>
                                {w.managerExclusive && (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                                    قائمة خاصة
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-col gap-0.5 text-xs">
                                {w.items.map((item, idx) => {
                                  const unitCost =
                                    item.cost ??
                                    db.products.find((p) => p.id === item.id)
                                      ?.cost ??
                                    0;
                                  return (
                                    <div
                                      key={`${w.id}-${item.id}-${idx}`}
                                      className="font-num text-slate-700 dark:text-slate-200"
                                    >
                                      {item.name} × {item.qty}{' '}
                                      <span className="text-slate-400">
                                        ({fmt(unitCost)} للوحدة)
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="font-num px-3 py-2.5 text-center font-bold text-[#38608f] dark:text-[#78a8de]">
                              {fmt(wholesaleVal)}
                            </td>
                            <td className="px-3 py-2.5 text-center text-xs font-semibold">
                              {w.paid ? (
                                <span className="inline-block rounded bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                                  {w.settlementMethod === 'return_offset'
                                    ? 'تمت التسوية بمرتجع'
                                    : 'تم الدفع والمحاسبة'}
                                </span>
                              ) : (
                                <span className="inline-block rounded bg-[#38608f]/10 px-2 py-0.5 text-[#38608f] dark:bg-[#38608f]/30 dark:text-[#98c1f0]">
                                  مسجّل بالقائمة (بدون دفع)
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-left text-xs">
                              <div className="flex flex-col items-end gap-1.5">
                                {w.note && (
                                  <span className="text-slate-500 dark:text-slate-400">
                                    {w.note}
                                  </span>
                                )}
                                {!w.paid && !isInlinePaying && (
                                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setInlineManagerPayId(w.id);
                                        setInlineManagerPayToCash(true);
                                      }}
                                      className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                                    >
                                      <Check className="h-3 w-3" />
                                      <span>دفع الآن</span>
                                    </button>
                                    <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                      أو يبقى مسجّلاً
                                    </span>
                                  </div>
                                )}
                                {!w.paid && isInlinePaying && (
                                  <div className="flex flex-col items-end gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50/70 p-2 dark:border-emerald-800 dark:bg-emerald-950/30">
                                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200">
                                      <input
                                        type="checkbox"
                                        checked={inlineManagerPayToCash}
                                        onChange={(e) =>
                                          setInlineManagerPayToCash(e.target.checked)
                                        }
                                        className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                                      />
                                      <span>إضافة {fmt(wholesaleVal)} للصندوق</span>
                                    </label>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const sName = getStoreName(w.storeId);
                                          const taker = w.takenBy || w.emp;
                                          upd((d) => {
                                            const target = d.withdrawals.find(
                                              (x) => x.id === w.id
                                            );
                                            if (!target) return d;
                                            target.paid = true;
                                            target.paidAmount = wholesaleVal;
                                            target.paidAt = Date.now();
                                            target.paidBy = user.name;
                                            target.paidToCash = inlineManagerPayToCash;
                                            target.settlementMethod = 'cash';
                                            addLog(
                                              d,
                                              user.name,
                                              `[${sName}] دفع ومحاسبة مسحوبات قائمة المدير/المالك #${w.id} (${taker}) بسعر الجملة: ${fmt(wholesaleVal)}${
                                                inlineManagerPayToCash ? ' (أُضيف للصندوق)' : ' (دفع خارجي)'
                                              }`,
                                              w.storeId
                                            );
                                            return d;
                                          });
                                          setInlineManagerPayId(null);
                                          notify(`تم تسجيل دفع سحب ${taker} (${fmt(wholesaleVal)})`);
                                        }}
                                        className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                                      >
                                        تأكيد الدفع
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setInlineManagerPayId(null)}
                                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                      >
                                        إلغاء
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">
                    سجل مسحوبات الموظفين والمسحوبات النقدية
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    منفصل تماماً عن قائمة بضاعة المدير والمالك الخاصة
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStaffWithdrawalsInitialWho('employee');
                      setStaffWithdrawalsOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 whitespace-nowrap"
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    <span>محاسبة مسحوبات الموظفين</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWithdrawInitialMode('');
                      setWithdrawOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#38608f] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#2d4f77] whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>تسجيل سحب</span>
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                      <th className="px-3 py-2.5 text-right font-semibold">
                        المحل
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        الصفة والساحب
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        سجّله بالصندوق
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        البيان
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        المبلغ (جملة / نقدي)
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        حاسب عليها؟
                      </th>
                      <th className="px-3 py-2.5 text-left font-semibold">
                        الاعتماد
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredStaffAndCashWithdrawals.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-6 text-center text-slate-500 dark:text-slate-400"
                        >
                          لا توجد مسحوبات موظفين أو مسحوبات نقدية
                        </td>
                      </tr>
                    ) : (
                      filteredStaffAndCashWithdrawals.slice(0, 40).map((w) => {
                        const isEmp = w.whoType === 'employee';
                        const wholesaleVal =
                          w.type === 'goods'
                            ? getWithdrawalWholesaleTotal(w, db.products)
                            : w.amount;
                        return (
                          <tr key={w.id}>
                            <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                              {getStoreName(w.storeId)}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={`ml-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-bold ${
                                  isEmp
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                    : 'bg-[#38608f]/15 text-[#38608f] dark:bg-[#38608f]/30 dark:text-[#98c1f0]'
                                }`}
                              >
                                {isEmp ? 'موظف' : 'مدير / مالك'}
                              </span>
                              <span className="font-semibold">
                                {w.takenBy || w.emp}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                              {w.emp}
                            </td>
                            <td className="px-3 py-2.5">
                              {w.type === 'cash'
                                ? 'نقدي'
                                : w.items
                                    .map((i) => `${i.name} × ${i.qty}`)
                                    .join('، ')}
                            </td>
                            <td className="font-num px-3 py-2.5 text-center font-semibold">
                              {fmt(wholesaleVal)}
                            </td>
                            <td className="px-3 py-2.5 text-center text-xs font-semibold">
                              {w.type === 'cash' ? (
                                <span className="text-slate-400">—</span>
                              ) : w.paid ? (
                                <span className="inline-block rounded bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                                  {w.settlementMethod === 'salary_deduction'
                                    ? 'نعم (مخصوم من الراتب)'
                                    : w.settlementMethod === 'return_offset'
                                      ? 'نعم (مقاصة مرتجع)'
                                      : 'نعم'}
                                </span>
                              ) : w.deferredToMonth ? (
                                <span className="font-num inline-block rounded bg-amber-50 px-2 py-0.5 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                                  لا (مؤجل {w.deferredToMonth})
                                </span>
                              ) : (
                                <span className="inline-block rounded bg-rose-50 px-2 py-0.5 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                                  لا
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-left text-xs font-semibold">
                              {STATUS_LABEL[w.status]}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-3 text-base font-bold">سجل المكافآت المرسلة للموظفين</h3>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                      <th className="px-3 py-2.5 text-right font-semibold">المحل</th>
                      <th className="px-3 py-2.5 text-right font-semibold">الموظف</th>
                      <th className="px-3 py-2.5 text-right font-semibold">السبب</th>
                      <th className="px-3 py-2.5 text-center font-semibold">المبلغ</th>
                      <th className="px-3 py-2.5 text-center font-semibold">من الصندوق</th>
                      <th className="px-3 py-2.5 text-left font-semibold">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredBonuses.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-6 text-center text-slate-500 dark:text-slate-400"
                        >
                          لا توجد مكافآت مرسلة بعد
                        </td>
                      </tr>
                    ) : (
                      filteredBonuses.slice(0, 30).map((b) => (
                        <tr key={b.id}>
                          <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                            {getStoreName(b.storeId)}
                          </td>
                          <td className="px-3 py-2.5 font-semibold">{b.empName}</td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">
                            {b.note}
                          </td>
                          <td className="font-num px-3 py-2.5 text-center font-bold text-emerald-600 dark:text-emerald-400">
                            {fmt(b.amount)}
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs">
                            {b.deductFromCash ? 'نعم (مصروف)' : 'لا'}
                          </td>
                          <td className="font-num px-3 py-2.5 text-left text-xs text-slate-500 dark:text-slate-400">
                            {fullDate(b.ts)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Store Rents Ledger */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">
                    سجل إيجارات الفروع (الدولار × سعر الصرف — يُخصم من ربح الشهر)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    لكل فرع سجله وشيته الخاص بالإيجار، ويتم خصم القيمة آلياً من صافي ربح الشهر
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRentOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#38608f] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#2d4f77] whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>تسجيل إيجار فرع</span>
                </button>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                      <th className="px-3 py-2.5 text-right font-semibold">المحل</th>
                      <th className="px-3 py-2.5 text-center font-semibold">الشهر</th>
                      <th className="px-3 py-2.5 text-center font-semibold">بالدولار ($)</th>
                      <th className="px-3 py-2.5 text-center font-semibold">سعر الصرف</th>
                      <th className="px-3 py-2.5 text-center font-semibold">المبلغ المدفوع</th>
                      <th className="px-3 py-2.5 text-center font-semibold">الصندوق</th>
                      <th className="px-3 py-2.5 text-right font-semibold">ملاحظة</th>
                      <th className="px-3 py-2.5 text-center font-semibold">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredRents.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-6 text-center text-slate-500 dark:text-slate-400"
                        >
                          لا توجد إيجارات مسجلة بعد
                        </td>
                      </tr>
                    ) : (
                      filteredRents.slice(0, 40).map((r) => (
                        <tr key={r.id}>
                          <td className="px-3 py-2.5 font-semibold whitespace-nowrap">
                            {getStoreName(r.storeId)}
                          </td>
                          <td className="font-num px-3 py-2.5 text-center whitespace-nowrap">
                            {r.month}
                          </td>
                          <td className="font-num px-3 py-2.5 text-center">
                            {fmt(r.usdAmount)}$
                          </td>
                          <td className="font-num px-3 py-2.5 text-center">
                            {fmt(r.exchangeRate)}
                          </td>
                          <td className="font-num px-3 py-2.5 text-center font-bold text-rose-600 dark:text-rose-400">
                            {fmt(r.localAmount)}
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs">
                            {r.deductFromCash ? 'مخصوم' : 'لا'}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                            {r.note || '—'}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteRent(r.id)}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          );
        })()}

        {/* TAB: STAFF & STORES */}
        {tab === 'staff' && (
          <div className="space-y-6">
            {/* Stores Management */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-3 text-base font-bold">المحلات / الفروع</h3>
              <div className="mb-4 flex flex-wrap gap-2">
                {db.stores.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                  >
                    <Store className="h-4 w-4 shrink-0 text-[#38608f] dark:text-[#78a8de]" />
                    {editingStoreId === s.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          value={editingStoreName}
                          onChange={(e) => setEditingStoreName(e.target.value)}
                          className="w-36 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                        />
                        <button
                          type="button"
                          onClick={() => saveStoreRename(s.id)}
                          className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          حفظ
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingStoreId(null)}
                          className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                        >
                          إلغاء
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="font-medium">{s.name}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingStoreId(s.id);
                            setEditingStoreName(s.name);
                          }}
                          title="تعديل اسم الفرع"
                          className="rounded p-1 text-slate-400 hover:bg-slate-200/70 hover:text-[#38608f] dark:hover:bg-slate-800 dark:hover:text-[#78a8de]"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <form onSubmit={addStore} className="flex flex-wrap gap-2">
                <input
                  placeholder="اسم المحل أو الفرع الجديد..."
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#38608f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2d4f77]"
                >
                  <Plus className="h-4 w-4" />
                  <span>إضافة محل</span>
                </button>
              </form>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">
                    الموظفون والمدراء والصلاحيات والرواتب
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    يمكنك إتاحة عدة فروع للموظف أو المدير للحالات الطارئة عبر «تعديل»، ورؤية/تعديل الأرقام السرية للموظفين مع تنبيه فوري للمالك
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                      <th className="px-3 py-2.5 text-right font-semibold">
                        الاسم
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        الفروع المصرح بها
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        الدور
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        الراتب المسجل
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        الرقم السري
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">
                        إجراءات
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {db.users.map((u) => {
                      const canManageUser = !u.owner || !!user.owner;
                      const canViewOrEditPin =
                        Boolean(user.owner) || u.role === 'employee';
                      const userStores = getUserStoreIds(u, db.stores);
                      return (
                        <tr key={u.id}>
                          <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                            {u.name}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {u.owner ? (
                              <span className="inline-block rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                                جميع الفروع
                              </span>
                            ) : userStores.length > 1 ? (
                              <div className="flex flex-wrap items-center justify-center gap-1">
                                {userStores.map((sid) => (
                                  <span
                                    key={sid}
                                    className="rounded border border-[#38608f]/30 bg-[#38608f]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#38608f] dark:border-[#6aa0db]/40 dark:text-[#98c1f0]"
                                  >
                                    {getStoreName(sid)}
                                  </span>
                                ))}
                              </div>
                            ) : canManageUser && db.stores.length > 1 ? (
                              <select
                                value={userStores[0] ?? db.stores[0]?.id ?? 1}
                                onChange={(e) =>
                                  updateUserStore(u, Number(e.target.value))
                                }
                                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                              >
                                {db.stores.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {getStoreName(userStores[0])}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs font-medium text-slate-600 dark:text-slate-300">
                            {u.owner
                              ? 'مالك'
                              : u.role === 'manager'
                              ? 'مدير'
                              : 'موظف'}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {!canManageUser ? (
                              <span className="font-num text-xs text-slate-500 dark:text-slate-400">
                                {(u.salary ?? 0) > 0 ? fmt(u.salary) : '—'}
                              </span>
                            ) : (
                              <SalaryEdit
                                key={`sal-${u.id}`}
                                targetUser={u}
                                upd={upd}
                                notify={notify}
                                who={user.name}
                              />
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {!canManageUser || (!user.owner && u.role === 'manager') ? (
                              '—'
                            ) : (
                              <PinEdit
                                key={u.id}
                                targetUser={u}
                                db={db}
                                upd={upd}
                                notify={notify}
                                who={user.name}
                                canSee={canViewOrEditPin}
                              />
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <div className="inline-flex items-center justify-center gap-1">
                              {canManageUser &&
                                (user.owner || u.role !== 'manager' || u.id === user.id) && (
                                  <button
                                    type="button"
                                    onClick={() => setEditingUser(u)}
                                    className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium text-[#38608f] hover:bg-[#38608f]/10 dark:text-[#78a8de] dark:hover:bg-[#38608f]/20 whitespace-nowrap"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    <span>تعديل</span>
                                  </button>
                                )}
                              {u.id !== user.id &&
                                !u.owner &&
                                (user.owner || u.role !== 'manager') && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      upd((d) => {
                                        d.users = d.users.filter(
                                          (x) => x.id !== u.id
                                        );
                                        addLog(d, user.name, 'حذف موظف ' + u.name);
                                        return d;
                                      })
                                    }
                                    className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50 whitespace-nowrap"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    <span>حذف</span>
                                  </button>
                                )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                ملاحظة: يمكن لكل مدير ومالك عرض وتعديل الأرقام السرية للموظفين (مع إرسال إشعار تلقائي للمالك عند التغيير)، وتحديد عدة فروع للمدراء والموظفين عند الحاجة.
              </p>
            </div>

            <form
              onSubmit={addUser}
              className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <h3 className="mb-4 text-base font-bold">إضافة موظف أو مدير جديد</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    الاسم
                  </label>
                  <input
                    placeholder="الاسم"
                    value={newUser.name}
                    onChange={(e) =>
                      setNewUser({ ...newUser, name: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    الرقم السري (4 خانات+)
                  </label>
                  <input
                    placeholder="••••"
                    value={newUser.pin}
                    onChange={(e) =>
                      setNewUser({ ...newUser, pin: e.target.value })
                    }
                    className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    الصلاحية
                  </label>
                  <select
                    value={newUser.role}
                    onChange={(e) =>
                      setNewUser({
                        ...newUser,
                        role: e.target.value as UserRole,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="employee">موظف</option>
                    {user.owner && <option value="manager">مدير</option>}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    الراتب المسجل
                  </label>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder="0"
                    value={newUser.salary}
                    onChange={(e) =>
                      setNewUser({ ...newUser, salary: e.target.value })
                    }
                    className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>

              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    الفروع المتاحة للحساب (يمكن اختيار فرع واحد أو عدة فروع)
                  </label>
                  {db.stores.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setNewUser({
                          ...newUser,
                          storeIds: db.stores.map((s) => s.id),
                        })
                      }
                      className="text-xs font-semibold text-[#38608f] hover:underline dark:text-[#78a8de]"
                    >
                      تحديد جميع الفروع
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {db.stores.map((s) => {
                    const checked = newUser.storeIds.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          checked
                            ? 'border-[#38608f] bg-[#38608f]/10 text-[#38608f] dark:border-[#6aa0db] dark:text-[#98c1f0]'
                            : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const exists = newUser.storeIds.includes(s.id);
                            if (exists && newUser.storeIds.length <= 1) {
                              notify('يجب اختيار فرع واحد على الأقل');
                              return;
                            }
                            setNewUser({
                              ...newUser,
                              storeIds: exists
                                ? newUser.storeIds.filter((x) => x !== s.id)
                                : [...newUser.storeIds, s.id],
                            });
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-[#38608f]"
                        />
                        <span>{s.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4" />
                <span>إضافة</span>
              </button>
            </form>

            {/* Backup & Restore */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold">
                    النسخ الاحتياطي واستعادة البيانات
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    احفظ نسخة كاملة من المخزون والمبيعات والموظفين وأرشيف الفواتير كملف أو استعدها في أي وقت
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportBackup}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#38608f] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2d4f77] whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>تصدير نسخة احتياطية (JSON)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => backupInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>استيراد نسخة احتياطية</span>
                  </button>
                  <input
                    ref={backupInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportBackup}
                    className="hidden"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: COMPREHENSIVE ACTIVITY NOTIFICATIONS */}
        {tab === 'alerts' && (
          <ActivityNotificationsView
            db={db}
            upd={upd}
            selectedStoreId={selectedStoreId}
            allowedStoreIds={allowedStoreIds}
            isOwner={Boolean(user.owner)}
            notify={notify}
          />
        )}

        {/* TAB: CUSTOMER DEBTS */}
        {tab === 'debts' && (
          <CustomerDebtsView
            db={db}
            upd={upd}
            user={user}
            allowedStoreIds={allowedStoreIds}
            initialStoreId={selectedStoreId}
            notify={notify}
          />
        )}

        {/* TAB: DISCOUNTS */}
        {tab === 'discounts' && (
          <DiscountsView db={db} selectedStoreId={selectedStoreId} />
        )}

        {/* TAB: EXCEL & GOOGLE SHEETS SYNC */}
        {tab === 'sync' && (
          <SheetsSyncView
            db={db}
            upd={upd}
            selectedStoreId={selectedStoreId}
            sheetsSync={sheetsSync}
            notify={notify}
            userName={user.name}
            isOwner={Boolean(user.owner)}
          />
        )}

        {/* TAB: AUDIT LOG */}
        {tab === 'log' && (() => {
          const logActors = Array.from(
            new Set(filteredLog.map((e) => e.who).filter(Boolean))
          ).sort((a, b) => a.localeCompare(b, 'ar'));
          const visibleLogs = filteredLog.filter((entry) => {
            if (logStaffFilter !== 'all' && entry.who !== logStaffFilter) {
              return false;
            }
            if (
              logSearchQuery.trim() &&
              !matchesQuery(`${entry.who} ${entry.t}`, logSearchQuery)
            ) {
              return false;
            }
            return true;
          });
          return (
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-bold">سجل التدقيق</h3>
              <div className="relative">
                <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={logSearchQuery}
                  onChange={(e) => setLogSearchQuery(e.target.value)}
                  placeholder="بحث في الحدث أو القطعة..."
                  className="w-56 rounded-lg border border-slate-300 bg-white py-1.5 pr-8 pl-3 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>
            {logActors.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  تصفية بالموظف:
                </span>
                <button
                  type="button"
                  onClick={() => setLogStaffFilter('all')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                    logStaffFilter === 'all'
                      ? 'bg-[#38608f] text-white'
                      : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                  }`}
                >
                  الكل
                </button>
                {logActors.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() =>
                      setLogStaffFilter((prev) => (prev === name ? 'all' : name))
                    }
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                      logStaffFilter === name
                        ? 'bg-[#38608f] text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                    <th className="px-3 py-2.5 text-right font-semibold">
                      الوقت
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      المستخدم
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      الحدث
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {visibleLogs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                      >
                        لا توجد أحداث مسجلة مطابقة للفلتر
                      </td>
                    </tr>
                  ) : (
                    visibleLogs.slice(0, 80).map((entry, idx) => (
                      <tr key={idx}>
                        <td className="font-num px-3 py-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {fullDate(entry.ts)}
                        </td>
                        <td className="px-3 py-2 text-center font-medium whitespace-nowrap">
                          {entry.who}
                        </td>
                        <td className="px-3 py-2">{entry.t}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          );
        })()}

        {/* Owner PIN Stock Quantity Edit Modal */}
        {stockEditModal && (
          <Modal
            title="تعديل كمية المخزون (بكلمة سر المالك)"
            onClose={() => setStockEditModal(null)}
          >
            <form onSubmit={handleConfirmOwnerStockEdit} className="space-y-3.5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1 dark:border-slate-800 dark:bg-slate-950">
                <p className="font-bold text-slate-900 dark:text-slate-100">
                  {stockEditModal.product.name}
                </p>
                <p className="text-slate-500 dark:text-slate-400">
                  الفرع: {getStoreName(stockEditModal.product.storeId)} · الكمية الحالية:{' '}
                  <span className="font-num font-bold text-slate-800 dark:text-slate-200">
                    {fmt(stockEditModal.product.stock)}
                  </span>
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  الكمية الجديدة
                </label>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={stockEditModal.newStock}
                  onChange={(e) =>
                    setStockEditModal({
                      ...stockEditModal,
                      newStock: e.target.value,
                    })
                  }
                  className="font-num w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  سبب التعديل (اختياري)
                </label>
                <input
                  type="text"
                  value={stockEditModal.reason}
                  onChange={(e) =>
                    setStockEditModal({
                      ...stockEditModal,
                      reason: e.target.value,
                    })
                  }
                  placeholder="مثال: جرد فعلي / تسوية تلف"
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-amber-800 dark:text-amber-300">
                  كلمة سر المالك (إلزامي للتوثيق والإشعارات)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={stockEditModal.ownerPin}
                  onChange={(e) =>
                    setStockEditModal({
                      ...stockEditModal,
                      ownerPin: e.target.value,
                    })
                  }
                  placeholder="••••"
                  className="font-num w-full min-h-[44px] rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-amber-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  className="flex-1 min-h-[44px] rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  حفظ الكمية وتسجيل إشعار
                </button>
                <button
                  type="button"
                  onClick={() => setStockEditModal(null)}
                  className="flex-1 min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* Delete Product Confirm Modal */}
        {deletingProduct && (
          <Modal
            title="تأكيد حذف المنتج"
            onClose={() => setDeletingProduct(null)}
          >
            <div className="space-y-4">
              <p className="text-sm text-slate-700 dark:text-slate-300">
                هل أنت متأكد من حذف الصنف{' '}
                <strong>«{deletingProduct.name}»</strong> من فرع{' '}
                <strong>{getStoreName(deletingProduct.storeId)}</strong>؟
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const target = deletingProduct;
                    setDeletingProduct(null);
                    upd((d) => {
                      d.products = d.products.filter((x) => x.id !== target.id);
                      if (!Array.isArray(d.ownerAlerts)) d.ownerAlerts = [];
                      d.ownerAlerts.unshift({
                        id: d.nid++,
                        kind: 'critical',
                        title: 'حذف منتج من المخزون',
                        message: `[${getStoreName(target.storeId)}] قام ${user.name} بحذف الصنف "${target.name}" (الكمية كانت ${target.stock})`,
                        by: user.name,
                        storeId: target.storeId,
                        ts: Date.now(),
                        read: false,
                      });
                      addLog(
                        d,
                        user.name,
                        `[${getStoreName(target.storeId)}] حذف منتج ${target.name} (الكمية كانت ${target.stock})`,
                        target.storeId
                      );
                      return d;
                    });
                    notify(`تم حذف المنتج "${target.name}"`);
                  }}
                  className="flex-1 min-h-[42px] rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
                >
                  تأكيد الحذف
                </button>
                <button
                  type="button"
                  onClick={() => setDeletingProduct(null)}
                  className="flex-1 min-h-[42px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </Modal>
        )}

        {importantAlertsOpen && (
          <OwnerImportantAlertsModal
            db={db}
            upd={upd}
            user={user}
            allowedStoreIds={allowedStoreIds}
            initialStoreId={selectedStoreId}
            onClose={() => setImportantAlertsOpen(false)}
            notify={notify}
          />
        )}

        {mailboxOpen && (
          <InternalMailboxModal
            db={db}
            upd={upd}
            user={user}
            allowedStoreIds={allowedStoreIds}
            onClose={() => setMailboxOpen(false)}
            notify={notify}
          />
        )}
      </main>
    </div>
  );
};
