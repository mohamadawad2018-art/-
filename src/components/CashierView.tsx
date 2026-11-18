import React, { useEffect, useState } from 'react';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Receipt,
  Wallet,
  CreditCard,
  PackageMinus,
  RotateCcw,
  LogOut,
  Sun,
  Moon,
  Camera,
  X,
  AlertCircle,
  Award,
  FileText,
  Upload,
  UserCheck,
  Coffee,
  CheckCircle2,
  BellRing,
  Mail,
  ChevronLeft,
} from 'lucide-react';
import {
  addLog,
  buildDiscountedSaleItems,
  expectedCashForStore,
  fmt,
  fullDate,
  getBranchDailyDrawerMovements,
  getCustomerDebtTotals,
  getDrawerCarryoverSummary,
  getIntakeTotals,
  getUnreadMessagesCount,
  getUserStoreIds,
  getWithdrawalWholesaleTotal,
  matchesQuery,
  monthKey,
  norm,
  num,
  sameDay,
  tm,
} from '../store';
import type { CartItem, PosDatabase, Product, Sale, User } from '../types';
import {
  ExpenseForm,
  InvoiceModal,
  Modal,
  SalaryForm,
  StockIntakeModal,
  WithdrawForm,
} from './Modals';
import { SaleConfirmModal } from './SaleConfirmModal';
import { LiveClockBadge } from './LiveClockBadge';
import { ConnectivitySyncBadge, PWAInstallButton } from './PWAControls';
import type { GoogleSheetsSyncState } from '../services/useGoogleSheetsSync';
import {
  InvoicePaymentsModal,
  type InvoicePaymentsFilter,
} from './InvoicePaymentsModal';
import { StaffWithdrawalsModal } from './StaffWithdrawalsModal';
import { ReturnGoodsModal } from './ReturnGoodsModal';
import { CustomerDebtsView } from './CustomerDebtsView';
import { InternalMailboxModal } from './InternalMailboxModal';
import { BranchDrawerLedgerModal } from './BranchDrawerLedgerModal';

interface CashierViewProps {
  db: PosDatabase;
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void;
  user: User;
  storeId: number;
  onSwitchStore?: (nextStoreId: number) => void;
  onTemporaryLogout: () => void;
  onLogout: () => void;
  notify: (msg: string) => void;
  dark: boolean;
  onToggleTheme: () => void;
  sheetsSync?: GoogleSheetsSyncState;
}

type CashierModal =
  | 'exp'
  | 'sal'
  | 'wd'
  | 'staff_wd'
  | 'debts'
  | 'ret'
  | 'logout_choice'
  | 'close'
  | 'intake'
  | 'payments'
  | 'mailbox'
  | 'branch_ledger'
  | null;

const getCartDraftKey = (storeId: number, userId: number) =>
  `pos_v4_cart_${storeId}_${userId}`;

const loadCartDraft = (storeId: number, userId: number): CartItem[] => {
  try {
    const raw = localStorage.getItem(getCartDraftKey(storeId, userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const CashierView: React.FC<CashierViewProps> = ({
  db,
  upd,
  user,
  storeId,
  onSwitchStore,
  onTemporaryLogout,
  onLogout,
  notify,
  dark,
  onToggleTheme,
  sheetsSync,
}) => {
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>(() =>
    loadCartDraft(storeId, user.id)
  );
  const [mobilePane, setMobilePane] = useState<'pos' | 'ops'>('pos');
  const [draftPrices, setDraftPrices] = useState<Record<number, string>>({});
  const [modal, setModal] = useState<CashierModal>(null);
  const [paymentsInitialFilter, setPaymentsInitialFilter] =
    useState<InvoicePaymentsFilter>('unpaid_partial');
  const [confirmSaleOpen, setConfirmSaleOpen] = useState(false);
  const [invoice, setInvoice] = useState<Sale | null>(null);
  const [cashCount, setCashCount] = useState('');
  const [tries, setTries] = useState(0);
  const [salesEmpFilter, setSalesEmpFilter] = useState<string>('all');
  const [salesItemQuery, setSalesItemQuery] = useState<string>('');

  useEffect(() => {
    setCart(loadCartDraft(storeId, user.id));
  }, [storeId, user.id]);

  useEffect(() => {
    try {
      const key = getCartDraftKey(storeId, user.id);
      if (cart.length === 0) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(cart));
      }
    } catch {
      // Ignore storage errors
    }
  }, [cart, storeId, user.id]);

  const storeName =
    db.stores.find((s) => s.id === storeId)?.name ?? 'المحل الرئيسي';
  const getStoreName = (id: number) =>
    db.stores.find((s) => s.id === id)?.name ?? 'المحل الرئيسي';

  const storeProducts = db.products.filter((p) => p.storeId === storeId);
  const filteredProducts = storeProducts.filter((p) =>
    matchesQuery(p.name, query)
  );
  const otherBranchMatches = query.trim()
    ? db.products.filter(
        (p) => p.storeId !== storeId && matchesQuery(p.name, query)
      )
    : [];
  const storePendingIntakes = db.stockIntakes.filter(
    (i) => i.storeId === storeId && i.status === 'pending'
  );
  const matchingPendingItems = query.trim()
    ? storePendingIntakes.flatMap((intake) =>
        intake.items
          .filter((item) => matchesQuery(item.name, query))
          .map((item) => ({ intakeId: intake.id, item }))
      )
    : [];

  const stockOf = (id: number) =>
    storeProducts.find((p) => p.id === id)?.stock ?? 0;

  const addToCart = (p: Product) => {
    const existing = cart.find((x) => x.id === p.id);
    const nextQty = existing ? existing.qty + 1 : 1;
    if (nextQty > p.stock) {
      notify('الكمية المتوفرة بالمخزون: ' + p.stock);
      return;
    }
    setCart(
      existing
        ? cart.map((x) => (x.id === p.id ? { ...x, qty: nextQty } : x))
        : [
            ...cart,
            {
              id: p.id,
              name: p.name,
              min: p.min,
              cost: p.cost,
              qty: 1,
              price: p.price,
            },
          ]
    );
  };

  const changeQty = (id: number, delta: number) => {
    const existing = cart.find((x) => x.id === id);
    if (!existing) return;
    const nextQty = existing.qty + delta;
    if (nextQty > stockOf(id)) {
      notify('لا يوجد مخزون كافٍ');
      return;
    }
    setCart(
      nextQty <= 0
        ? cart.filter((x) => x.id !== id)
        : cart.map((x) => (x.id === id ? { ...x, qty: nextQty } : x))
    );
  };

  const commitPriceBlur = (c: CartItem) => {
    const raw = draftPrices[c.id];
    if (raw === undefined) return;
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed) || parsed < c.min) {
      notify('لا يمكن البيع بأقل من الحد الأدنى (' + fmt(c.min) + ')');
    } else {
      setCart(cart.map((x) => (x.id === c.id ? { ...x, price: parsed } : x)));
    }
    setDraftPrices(({ [c.id]: _, ...rest }) => rest);
  };

  const total = cart.reduce((acc, c) => acc + c.qty * c.price, 0);

  const finalizeSale = (discountAmount: number, discountNote: string) => {
    const nowTs = Date.now();
    const { items, subtotalBeforeDiscount, discount, netTotal } =
      buildDiscountedSaleItems(cart, discountAmount);

    const sale: Sale = {
      id: db.nid,
      storeId,
      emp: user.name,
      items,
      total: netTotal,
      discount: discount > 0 ? discount : undefined,
      subtotalBeforeDiscount: discount > 0 ? subtotalBeforeDiscount : undefined,
      ts: nowTs,
    };
    upd((d) => {
      sale.items.forEach((item) => {
        const prod = d.products.find((p) => p.id === item.id);
        if (prod) {
          const prevStock = prod.stock;
          prod.stock -= item.qty;
          const threshold = prod.minStock ?? 3;
          if (prevStock > threshold && prod.stock <= threshold) {
            addLog(
              d,
              'النظام',
              `[${storeName}] تنبيه تلقائي: وصول "${prod.name}" إلى الحد الأدنى للمخزون (${prod.stock} / ${threshold})`,
              storeId
            );
          }
        }
      });
      d.sales.unshift(sale);
      d.nid++;

      if (discount > 0) {
        if (!Array.isArray(d.discounts)) d.discounts = [];
        const totalUnits = sale.items.reduce((a, i) => a + i.qty, 0);
        d.discounts.unshift({
          id: d.nid++,
          saleId: sale.id,
          storeId,
          emp: user.name,
          role: user.role,
          amount: discount,
          subtotalBefore: subtotalBeforeDiscount,
          netTotal,
          itemCount: totalUnits,
          note: discountNote || undefined,
          ts: nowTs,
        });
      }

      sale.items.forEach((item) => {
        addLog(
          d,
          user.name,
          `[${storeName}] فاتورة #${sale.id} — ${item.name} × ${item.qty} (${fmt(item.qty * item.price)})${
            item.discountShare ? ` [خصم: ${fmt(item.discountShare)}]` : ''
          }`,
          storeId
        );
      });
      return d;
    });
    setCart([]);
    setDraftPrices({});
    setConfirmSaleOpen(false);
    setInvoice(sale);
  };

  const handleCloseShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (cashCount.trim() === '') {
      notify('أدخل المبلغ الفعلي الموجود في الدرج');
      return;
    }
    const exp = expectedCashForStore(db, storeId);
    const actual = num(cashCount);
    const prevOpening = db.openingByStore[storeId] ?? 0;
    if (actual === exp || tries >= 2) {
      const diff = Math.round((actual - exp) * 100) / 100;
      const nowTs = Date.now();
      upd((d) => {
        d.shifts.unshift({
          storeId,
          emp: user.name,
          openingCash: prevOpening,
          expected: exp,
          actual,
          diff,
          ts: nowTs,
          tries: tries + 1,
        });
        d.openingByStore[storeId] = actual;
        d.lastCloseByStore[storeId] = nowTs;
        delete d.activeHolders[storeId];
        if (diff !== 0) {
          if (!Array.isArray(d.ownerAlerts)) d.ownerAlerts = [];
          d.ownerAlerts.unshift({
            id: d.nid++,
            kind: 'critical',
            title: 'فرق في جرد الصندوق عند إغلاق الدوام',
            message: `[${storeName}] أغلق ${user.name} الدوام بفرق نقدي قدره ${fmt(diff)} (الفعلي ${fmt(actual)} مقابل المتوقع ${fmt(exp)})`,
            by: user.name,
            storeId,
            ts: nowTs,
            read: false,
          });
        }
        addLog(
          d,
          user.name,
          `[${storeName}] إنهاء الدوام النهائي (مسلّم: ${fmt(actual)} · متوقع: ${fmt(exp)})${
            diff ? ` - فرق ${fmt(diff)}` : ' - مطابق'
          }`,
          storeId
        );
        return d;
      });
      notify(diff ? 'سُجّل الفرق وترحيل الصندوق لليوم التالي' : 'تم تقفيل الدوام والصندوق مطابق');
      onLogout();
    } else {
      setTries((t) => t + 1);
      notify('الرقم غير مطابق (' + (tries + 1) + '/3)');
      setCashCount('');
    }
  };

  const carryover = getDrawerCarryoverSummary(db, storeId);

  const allowedStoreIds = getUserStoreIds(user, db.stores);
  const allowedStores = db.stores.filter((s) => allowedStoreIds.includes(s.id));
  const openStoreIntakes = db.stockIntakes
    .filter((i) => i.storeId === storeId && i.status !== 'rejected')
    .map((i) => getIntakeTotals(i))
    .filter((t) => t.remainingAmount > 0);
  const noPhotoStoreIntakesCount = db.stockIntakes.filter(
    (i) => i.storeId === storeId && i.status !== 'rejected' && !i.photoDataUrl
  ).length;
  const openIntakesRemainingTotal = openStoreIntakes.reduce(
    (sum, t) => sum + t.remainingAmount,
    0
  );
  const curMonth = monthKey(Date.now());
  const unpaidGoodsWithdrawals = db.withdrawals.filter(
    (w) =>
      w.storeId === storeId &&
      w.type === 'goods' &&
      w.whoType === 'employee' &&
      w.status !== 'rejected' &&
      !w.paid &&
      (!w.deferredToMonth || w.deferredToMonth <= curMonth)
  );
  const unpaidGoodsTotal = Math.round(
    unpaidGoodsWithdrawals.reduce(
      (sum, w) => sum + getWithdrawalWholesaleTotal(w, db.products),
      0
    ) * 100
  ) / 100;

  const openBranchDebts = (db.customerDebts ?? [])
    .filter((cd) => cd.storeId === storeId)
    .map((cd) => ({ cd, totals: getCustomerDebtTotals(cd) }))
    .filter((x) => !x.totals.isPaid);
  const openBranchDebtsTotal =
    Math.round(
      openBranchDebts.reduce((sum, x) => sum + x.totals.remainingAmount, 0) *
        100
    ) / 100;

  const myPendingWithdrawals = db.withdrawals.filter(
    (w) => w.storeId === storeId && w.emp === user.name && w.status === 'pending'
  ).length;
  const myPendingIntakes = db.stockIntakes.filter(
    (i) =>
      i.storeId === storeId &&
      i.enteredBy === user.name &&
      i.status === 'pending'
  ).length;
  const allTodayBranchSales = db.sales
    .filter((s) => s.storeId === storeId && sameDay(s.ts))
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const todaySales = allTodayBranchSales;
  const todaySalesSellers = Array.from(
    new Set(allTodayBranchSales.map((s) => s.emp.trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'ar'));
  const filteredTodayBranchSales = allTodayBranchSales.filter((s) => {
    if (salesEmpFilter !== 'all' && norm(s.emp) !== norm(salesEmpFilter)) {
      return false;
    }
    if (
      salesItemQuery.trim() &&
      !s.items.some((i) => matchesQuery(i.name, salesItemQuery))
    ) {
      return false;
    }
    return true;
  });

  const unreadMessagesCount = getUnreadMessagesCount(db, user, allowedStoreIds);
  const branchMovements = getBranchDailyDrawerMovements(db, storeId);
  const branchFeedSeenAt = db.branchFeedSeenAt?.[`${user.id}_${storeId}`] ?? 0;
  const unreadBranchActions = branchMovements.filter(
    (m) => norm(m.actor) !== norm(user.name) && m.ts > branchFeedSeenAt
  );

  const myBonuses = (db.bonuses ?? [])
    .filter((b) => b.empName === user.name)
    .sort((a, b) => b.ts - a.ts);
  const totalMyBonuses = myBonuses.reduce((acc, b) => acc + b.amount, 0);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            {allowedStores.length > 1 && onSwitchStore ? (
              <select
                aria-label="تبديل الفرع"
                value={storeId}
                onChange={(e) => {
                  const nextId = Number(e.target.value);
                  if (nextId === storeId) return;
                  if (cart.length > 0) {
                    notify('أفرغ الفاتورة الحالية أو أكمل البيع قبل تبديل الفرع');
                    return;
                  }
                  onSwitchStore(nextId);
                }}
                className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-sm font-bold text-[#38608f] focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-[#78a8de]"
              >
                {allowedStores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-base font-bold text-[#38608f] dark:text-[#78a8de] whitespace-nowrap shrink-0">
                {storeName}
              </span>
            )}
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
              مستلم الصندوق: {user.name}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <LiveClockBadge />
            {sheetsSync && (
              <ConnectivitySyncBadge
                isOnline={sheetsSync.isOnline}
                pendingCount={sheetsSync.pendingSyncCount}
                isSyncing={sheetsSync.isSyncing}
                hasGoogleToken={Boolean(sheetsSync.accessToken)}
                trustedEmail={sheetsSync.trustedEmail}
                onSyncNow={() => void sheetsSync.flushPendingNow()}
              />
            )}
            <PWAInstallButton notify={notify} />
            <button
              type="button"
              onClick={() => setModal('branch_ledger')}
              className={`flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                unreadBranchActions.length > 0
                  ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
              title="متابعة حركات الدرج والعمليات داخل الفرع لمطابقة الصندوق"
            >
              <BellRing className="h-3.5 w-3.5" />
              <span className="font-num">
                حركات الدرج
                {unreadBranchActions.length > 0
                  ? ` (${unreadBranchActions.length})`
                  : ''}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setModal('mailbox')}
              className={`flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                unreadMessagesCount > 0
                  ? 'border-[#38608f]/50 bg-[#38608f]/10 text-[#38608f] hover:bg-[#38608f]/20 dark:border-[#78a8de]/40 dark:bg-[#38608f]/25 dark:text-[#98c1f0]'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
              title="صندوق الرسائل والبريد الداخلي مع الإدارة والموظفين"
            >
              <Mail className="h-3.5 w-3.5" />
              <span className="font-num">
                الرسائل{unreadMessagesCount > 0 ? ` (${unreadMessagesCount})` : ''}
              </span>
            </button>
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
              onClick={() => setModal('logout_choice')}
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-700 whitespace-nowrap shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>تسجيل خروج / إنهاء الدوام</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        {/* Live Coworker & Management Activity Notification Strip for Same-Branch Drawer Matching */}
        {unreadBranchActions.length > 0 && (
          <section
            aria-label="إشعارات حركات الفرع والدرج"
            className="mb-4 rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 dark:border-amber-800/80 dark:bg-amber-950/30"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
                <BellRing className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="font-num text-xs font-bold">
                  حركات جديدة في {storeName} تمت عبر الإدارة أو زميل آخر ({unreadBranchActions.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setModal('branch_ledger')}
                className="inline-flex items-center gap-1 rounded-lg bg-[#38608f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2d4f77] whitespace-nowrap"
              >
                <span>فتح كشف الدرج ومراجعتها</span>
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-1">
              {unreadBranchActions.slice(0, 3).map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200/80 bg-white px-3 py-1.5 text-xs dark:border-amber-900/50 dark:bg-slate-900"
                >
                  <div className="min-w-0 truncate text-slate-800 dark:text-slate-200">
                    <span className="font-bold text-[#38608f] dark:text-[#78a8de]">
                      {m.actor} ({m.actorRoleLabel})
                    </span>
                    <span className="mx-1.5 text-slate-400">·</span>
                    <span>{m.title}: {m.details}</span>
                  </div>
                  <div className="font-num flex items-center gap-2 shrink-0 text-xs font-bold">
                    {m.cashDelta !== 0 && (
                      <span
                        className={
                          m.cashDelta > 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-700 dark:text-rose-400'
                        }
                      >
                        {m.cashDelta > 0 ? `+${fmt(m.cashDelta)}` : fmt(m.cashDelta)} للدرج
                      </span>
                    )}
                    <span className="text-[11px] font-normal text-slate-400">
                      {tm(m.ts)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Next-Day Opening Drawer & Live Expected Cash Summary */}
        <section
          aria-label="ملخص الصندوق المرحّل والحالي"
          className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3"
        >
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              الرصيد المرحّل من اليوم / الدوام السابق
            </p>
            <p className="font-num mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">
              {fmt(carryover.openingCash)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {carryover.lastShift
                ? `آخر إغلاق: ${carryover.lastShift.emp} (${fullDate(carryover.lastShift.ts)})`
                : 'بداية التشغيل المسجلة بالفرع'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              صافي حركة الصندوق خلال الدوام الحالي
            </p>
            <p
              className={`font-num mt-1 text-lg font-bold ${
                carryover.todayNetMovement >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {carryover.todayNetMovement >= 0
                ? `+${fmt(carryover.todayNetMovement)}`
                : fmt(carryover.todayNetMovement)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              بعد المبيعات والمصروفات والمسحوبات والرواتب
            </p>
          </div>

          <div className="rounded-xl border border-[#38608f]/30 bg-[#38608f]/5 px-4 py-3 dark:border-[#4f7fb5]/40 dark:bg-[#38608f]/15">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-[#38608f] dark:text-[#78a8de]">
                المبلغ المتوقع بالدرج حالياً ({storeName})
              </p>
              <button
                type="button"
                onClick={() => setModal('branch_ledger')}
                className="text-[11px] font-bold text-[#38608f] hover:underline dark:text-[#98c1f0] whitespace-nowrap"
              >
                كشف المسحوب والوارد
              </button>
            </div>
            <p className="font-num mt-1 text-lg font-bold text-[#38608f] dark:text-[#98c1f0]">
              {fmt(carryover.expectedCash)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              يُرحّل الرصيد الفعلي عند إنهاء الدوام النهائي
            </p>
          </div>
        </section>

        {/* Mobile Quick Pane Switcher (Thumb Ergonomics) */}
        <div className="mb-4 grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200 bg-white p-1 lg:hidden dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setMobilePane('pos')}
            className={`min-h-[44px] rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
              mobilePane === 'pos'
                ? 'bg-[#38608f] text-white'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            نقطة البيع ({cart.length})
          </button>
          <button
            type="button"
            onClick={() => setMobilePane('ops')}
            className={`min-h-[44px] rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
              mobilePane === 'ops'
                ? 'bg-[#38608f] text-white'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            عمليات الصندوق والفواتير
          </button>
        </div>

        {myBonuses.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-800/80 dark:bg-amber-950/30">
            <div className="flex items-start gap-3">
              <Award className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  تهانينا {user.name}! تم إرسال مكافأة لك من الإدارة بقيمة{' '}
                  <span className="font-num text-emerald-700 dark:text-emerald-400">
                    {fmt(myBonuses[0].amount)}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                  {myBonuses[0].note} · من {myBonuses[0].by} ({fullDate(myBonuses[0].ts)})
                </p>
              </div>
            </div>
            {myBonuses.length > 1 && (
              <span className="font-num text-xs font-semibold text-amber-800 dark:text-amber-300">
                إجمالي مكافآتك ({myBonuses.length}): {fmt(totalMyBonuses)}
              </span>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Primary POS Area */}
          <section
            className={`lg:col-span-8 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 ${
              mobilePane === 'pos' ? 'block' : 'hidden lg:block'
            }`}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-bold">فاتورة المبيع</h2>
              <span className="font-num text-xs text-slate-500 dark:text-slate-400">
                رقم الفاتورة التالي #{db.nid}
              </span>
            </div>

            <div className="relative mb-3">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="اكتب اسم المنتج أو أول حروفه لعرض الخيارات والأسعار والعدد..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && query.trim()) {
                    e.preventDefault();
                    const firstAvailable = filteredProducts.find(
                      (p) => p.stock > 0
                    );
                    if (firstAvailable) {
                      addToCart(firstAvailable);
                      setQuery('');
                    }
                  }
                }}
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-9 pl-9 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="مسح البحث"
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Instant Autocomplete / Product Options */}
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>
                  {query.trim()
                    ? `خيارات البحث المطابقة في ${storeName}`
                    : `الأصناف المتوفرة في ${storeName}`}
                </span>
                <span className="font-num font-semibold">
                  {filteredProducts.length} صنف
                </span>
              </div>

              {filteredProducts.length > 0 ? (
                <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                  {filteredProducts.map((p) => {
                    const outOfStock = p.stock <= 0;
                    const isLow = p.stock > 0 && p.stock <= (p.minStock ?? 3);
                    const inCartQty =
                      cart.find((item) => item.id === p.id)?.qty ?? 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={outOfStock}
                        onClick={() => addToCart(p)}
                        className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-right transition-colors ${
                          outOfStock
                            ? 'cursor-not-allowed border-slate-200 bg-slate-100/70 text-slate-400 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-500'
                            : 'border-slate-200 bg-slate-50/70 hover:border-emerald-500 hover:bg-emerald-50/60 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/30'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                              {p.name}
                            </span>
                            {inCartQty > 0 && (
                              <span className="font-num rounded bg-[#38608f] px-1.5 py-0.5 text-[11px] font-semibold text-white whitespace-nowrap">
                                بالفاتورة: {inCartQty}
                              </span>
                            )}
                          </div>
                          <div className="font-num mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                              السعر: {fmt(p.price)}
                            </span>
                            <span className="text-slate-500 dark:text-slate-400">
                              الأدنى: {fmt(p.min)}
                            </span>
                            <span
                              className={`font-semibold ${
                                outOfStock
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : isLow
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {outOfStock ? 'نفد (0)' : `العدد: ${fmt(p.stock)}`}
                            </span>
                          </div>
                        </div>

                        <span
                          className={`flex h-8 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs font-semibold whitespace-nowrap ${
                            outOfStock
                              ? 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-500'
                              : 'bg-emerald-600 text-white'
                          }`}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>{outOfStock ? 'نفد' : 'إضافة'}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex items-start gap-2 text-slate-600 dark:text-slate-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div>
                      <p className="font-semibold">
                        {storeProducts.length === 0
                          ? `مخزون "${storeName}" فارغ حالياً — لا توجد منتجات مدخلة في هذا المحل`
                          : `لا توجد نتائج مطابقة لـ "${query}" في مخزون ${storeName}`}
                      </p>
                      {storePendingIntakes.length > 0 && (
                        <p className="mt-1 text-amber-700 dark:text-amber-400">
                          يوجد {storePendingIntakes.length} طلب توريد بضاعة لهذا المحل بانتظار موافقة المدير لتظهر في المخزن
                          {matchingPendingItems.length > 0 &&
                            ` (منها: ${matchingPendingItems
                              .map((x) => `${x.item.name} × ${x.item.qty}`)
                              .join('، ')})`}
                          .
                        </p>
                      )}
                    </div>
                  </div>

                  {otherBranchMatches.length > 0 && (
                    <div className="border-t border-slate-200 pt-2.5 dark:border-slate-800">
                      <p className="mb-1.5 font-semibold text-[#38608f] dark:text-[#78a8de]">
                        تنبيه: الصنف موجود في فرع آخر وليس في مخزون {storeName}:
                      </p>
                      <div className="space-y-1">
                        {otherBranchMatches.map((p) => (
                          <div
                            key={p.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-800 dark:bg-slate-900"
                          >
                            <span className="font-medium text-slate-800 dark:text-slate-200">
                              {p.name}{' '}
                              <span className="text-slate-500 dark:text-slate-400">
                                ({getStoreName(p.storeId)})
                              </span>
                            </span>
                            <span className="font-num text-slate-600 dark:text-slate-300">
                              السعر: {fmt(p.price)} · العدد: {fmt(p.stock)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {storeProducts.length === 0 &&
                    otherBranchMatches.length === 0 &&
                    db.products.length > 0 && (
                      <p className="text-slate-500 dark:text-slate-400">
                        توجد {db.products.length} منتجات مسجلة في فروع أخرى. اطلب من المدير اختيار "{storeName}" عند إضافة البضاعة أو نقلها من جدول المخزون.
                      </p>
                    )}
                </div>
              )}
            </div>

            {/* Cart Table */}
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                    <th className="px-3 py-2.5 text-right font-semibold">
                      المنتج
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      العدد
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      السعر
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      الإجمالي
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      إجراء
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {cart.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400"
                      >
                        اختر المنتجات من الأعلى لإضافتها إلى الفاتورة
                      </td>
                    </tr>
                  ) : (
                    cart.map((c) => (
                      <tr
                        key={c.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-medium">{c.name}</div>
                          <div className="font-num text-[11px] text-slate-500 dark:text-slate-400">
                            المتوفر بالمخزن: {fmt(stockOf(c.id))}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => changeQty(c.id, -1)}
                              className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="font-num w-6 text-center font-semibold">
                              {c.qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => changeQty(c.id, 1)}
                              className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="number"
                            value={
                              draftPrices[c.id] !== undefined
                                ? draftPrices[c.id]
                                : c.price
                            }
                            onChange={(e) =>
                              setDraftPrices({
                                ...draftPrices,
                                [c.id]: e.target.value,
                              })
                            }
                            onBlur={() => commitPriceBlur(c)}
                            className="font-num w-28 rounded border border-slate-300 bg-white px-2 py-1 text-center text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                          />
                          <div className="font-num mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            الحد الأدنى: {fmt(c.min)}
                          </div>
                        </td>
                        <td className="font-num px-3 py-2.5 text-center font-bold text-slate-900 dark:text-slate-100">
                          {fmt(c.qty * c.price)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setCart(cart.filter((x) => x.id !== c.id))
                            }
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>حذف</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {cart.length > 0 && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                <div>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    إجمالي الفاتورة
                  </span>
                  <span className="font-num text-2xl font-bold text-[#38608f] dark:text-[#78a8de]">
                    {fmt(total)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmSaleOpen(true)}
                  className="flex items-center gap-2 rounded-lg bg-[#38608f] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2d4f77] whitespace-nowrap"
                >
                  <Receipt className="h-4 w-4" />
                  <span>تأكيد البيع وحفظ الفاتورة</span>
                </button>
              </div>
            )}
          </section>

          {/* Operations Sidebar */}
          <aside
            className={`lg:col-span-4 space-y-4 ${
              mobilePane === 'ops' ? 'block' : 'hidden lg:block'
            }`}
          >
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-4 text-base font-bold">عمليات الصندوق والمخزن</h2>
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => setModal('intake')}
                  className="flex w-full items-center justify-between rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                  <span>إدخال بضاعة (الصورة اختيارية)</span>
                  <Camera className="h-4 w-4" />
                </button>
                {myPendingIntakes > 0 && (
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    لديك {myPendingIntakes} فاتورة توريد بانتظار مطابقة وموافقة المدير
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setPaymentsInitialFilter(
                      noPhotoStoreIntakesCount > 0 ? 'no_photo' : 'all'
                    );
                    setModal('payments');
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  <span className="text-right">
                    إضافة صورة لفاتورة قديمة
                    {noPhotoStoreIntakesCount > 0 && (
                      <span className="font-num mr-1.5 inline-block rounded bg-amber-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
                        {noPhotoStoreIntakesCount}
                      </span>
                    )}
                  </span>
                  <Upload className="h-4 w-4 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPaymentsInitialFilter('unpaid_partial');
                    setModal('payments');
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-[#38608f]/35 bg-[#38608f]/10 px-4 py-3 text-sm font-semibold text-[#38608f] transition-colors hover:bg-[#38608f]/20 dark:border-[#4f7fb5]/40 dark:bg-[#38608f]/20 dark:text-[#98c1f0]"
                >
                  <span className="text-right">
                    دفعات الفواتير (المدفوع والمتبقي)
                    {openStoreIntakes.length > 0 && (
                      <span className="font-num mr-1.5 inline-block rounded bg-rose-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
                        {openStoreIntakes.length} · {fmt(openIntakesRemainingTotal)}
                      </span>
                    )}
                  </span>
                  <FileText className="h-4 w-4 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => setModal('exp')}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  <span>إضافة مصاريف ونثريات</span>
                  <Wallet className="h-4 w-4 text-slate-500" />
                </button>

                <button
                  type="button"
                  onClick={() => setModal('sal')}
                  className="flex w-full items-center justify-between rounded-lg bg-[#38608f] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2d4f77]"
                >
                  <span>صرف راتب</span>
                  <CreditCard className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={() => setModal('wd')}
                  className="flex w-full items-center justify-between rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-600"
                >
                  <span>تسجيل مسحوبات (بضاعة / نقدي)</span>
                  <PackageMinus className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={() => setModal('staff_wd')}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  <span className="text-right">
                    محاسبة مسحوبات البضاعة
                    {unpaidGoodsWithdrawals.length > 0 && (
                      <span className="font-num mr-1.5 inline-block rounded bg-rose-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
                        {unpaidGoodsWithdrawals.length} · {fmt(unpaidGoodsTotal)}
                      </span>
                    )}
                  </span>
                  <Wallet className="h-4 w-4 shrink-0" />
                </button>

                {myPendingWithdrawals > 0 && (
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    لديك {myPendingWithdrawals} طلب سحب بانتظار موافقة المدير
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => setModal('debts')}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-[#38608f]/35 bg-[#38608f]/10 px-4 py-3 text-sm font-semibold text-[#38608f] transition-colors hover:bg-[#38608f]/20 dark:border-[#4f7fb5]/40 dark:bg-[#38608f]/20 dark:text-[#98c1f0]"
                >
                  <span className="text-right">
                    ديون زباين ({storeName})
                    {openBranchDebts.length > 0 && (
                      <span className="font-num mr-1.5 inline-block rounded bg-rose-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
                        {openBranchDebts.length} · {fmt(openBranchDebtsTotal)}
                      </span>
                    )}
                  </span>
                  <UserCheck className="h-4 w-4 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => setModal('ret')}
                  className="flex w-full items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/70"
                >
                  <span>ترجيع غرض (مرتجع)</span>
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
            </div>

            {allTodayBranchSales.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    فواتير اليوم في {storeName} ({filteredTodayBranchSales.length})
                  </h3>
                  {(salesEmpFilter !== 'all' || salesItemQuery.trim()) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSalesEmpFilter('all');
                        setSalesItemQuery('');
                      }}
                      className="text-[11px] font-semibold text-[#38608f] hover:underline dark:text-[#78a8de]"
                    >
                      عرض الكل
                    </button>
                  )}
                </div>

                {/* Quick Seller Buttons & Item Search */}
                <div className="mb-3 space-y-2">
                  {todaySalesSellers.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSalesEmpFilter('all')}
                        className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                          salesEmpFilter === 'all'
                            ? 'bg-[#38608f] text-white'
                            : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                        }`}
                      >
                        الكل
                      </button>
                      {todaySalesSellers.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() =>
                            setSalesEmpFilter((prev) =>
                              prev === name ? 'all' : name
                            )
                          }
                          className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                            salesEmpFilter === name
                              ? 'bg-[#38608f] text-white'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                          }`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="relative">
                    <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      value={salesItemQuery}
                      onChange={(e) => setSalesItemQuery(e.target.value)}
                      placeholder="فلترة باسم القطعة في فواتير اليوم..."
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-8 pl-3 text-xs text-slate-900 focus:border-[#38608f] focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </div>

                {filteredTodayBranchSales.length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                    لا توجد فواتير مطابقة للفلتر
                  </p>
                ) : (
                  <div className="max-h-80 divide-y divide-slate-200 overflow-y-auto text-xs dark:divide-slate-800">
                    {filteredTodayBranchSales.slice(0, 20).map((s) => (
                      <div key={s.id} className="py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 truncate">
                            <span className="font-num font-semibold">#{s.id}</span>
                            <span className="mx-1.5 text-slate-400">·</span>
                            <span className="font-semibold text-[#38608f] dark:text-[#78a8de]">
                              {s.emp}
                            </span>
                            <span className="mx-1.5 text-slate-400">·</span>
                            <span className="font-num text-slate-500 dark:text-slate-400">
                              {tm(s.ts)}
                            </span>
                          </div>
                          <span className="font-num font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                            {fmt(s.total)}
                          </span>
                        </div>
                        <div className="mt-1 space-y-0.5 pr-2">
                          {s.items
                            .filter(
                              (item) =>
                                !salesItemQuery.trim() ||
                                matchesQuery(item.name, salesItemQuery)
                            )
                            .map((item, idx) => (
                              <div
                                key={`${item.id}-${idx}`}
                                className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400"
                              >
                                <span className="truncate">
                                  {item.name}{' '}
                                  <span className="font-num">× {item.qty - item.ret}</span>
                                </span>
                                <span className="font-num shrink-0">
                                  {fmt(item.price * (item.qty - item.ret))}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      </main>

      {modal === 'intake' && (
        <StockIntakeModal
          db={db}
          defaultStoreId={storeId}
          isManager={false}
          notify={notify}
          onClose={() => setModal(null)}
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
                status: 'pending',
                ts: nowTs,
              });
              addLog(
                d,
                user.name,
                `[${storeName}] رفع فاتورة توريد بضاعة #${id} (${items.length} أصناف${
                  photoDataUrl ? '' : ' · بدون صورة'
                }${
                  initialPaymentAmount > 0
                    ? ` · دفعة ${fmt(initialPaymentAmount)}`
                    : ''
                }) بانتظار موافقة المدير`,
                targetStore
              );
              return d;
            });
            notify(
              photoDataUrl
                ? 'تم إرسال الفاتورة وصورتها للمدير للمطابقة والموافقة'
                : 'تم إرسال الفاتورة للمدير للمطابقة والموافقة (يمكن إرفاق صورتها لاحقاً)'
            );
          }}
        />
      )}

      {modal === 'payments' && (
        <InvoicePaymentsModal
          db={db}
          upd={upd}
          user={user}
          allowedStoreIds={allowedStoreIds}
          initialStoreId={storeId}
          initialFilter={paymentsInitialFilter}
          onClose={() => setModal(null)}
          notify={notify}
        />
      )}

      {modal === 'exp' && (
        <ExpenseForm
          notify={notify}
          onClose={() => setModal(null)}
          onSubmit={(desc, amount) => {
            upd((d) => {
              d.expenses.unshift({
                storeId,
                desc,
                amount,
                emp: user.name,
                ts: Date.now(),
              });
              addLog(
                d,
                user.name,
                `[${storeName}] مصروف: ${desc} ${fmt(amount)}`,
                storeId
              );
              return d;
            });
            notify('تم تسجيل المصروف');
          }}
        />
      )}

      {modal === 'wd' && (
        <WithdrawForm
          db={db}
          storeId={storeId}
          currentUserName={user.name}
          notify={notify}
          onClose={() => setModal(null)}
          onSubmit={({
            type,
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
            const isManagerGoods = type === 'goods' && whoType === 'manager';
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
                      `[${storeName}] تنبيه تلقائي: وصول "${prod.name}" إلى الحد الأدنى للمخزون (${prod.stock} / ${threshold})`,
                      storeId
                    );
                  }
                }
              });
              d.withdrawals.unshift({
                id: d.nid++,
                storeId,
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
                paidToCash: type === 'goods' && paid ? Boolean(paidToCash) : false,
                settlementMethod: type === 'goods' && paid ? 'cash' : undefined,
                managerExclusive:
                  Boolean(managerExclusive || isManagerGoods) || undefined,
                note,
                emp: user.name,
                ts: nowTs,
                status: 'pending',
              });
              const roleLabel =
                whoType === 'employee' ? 'موظف' : 'مدير / مالك';
              const takerText = takenBy ? ` (${takenBy})` : '';
              const goodsStatusText =
                type === 'goods'
                  ? ` · جملة: ${fmt(amount)} · ${
                      paid
                        ? 'دفع فوري'
                        : isManagerGoods
                          ? 'مسجّل بقائمة المدير والمالك'
                          : 'لم يحاسب عليها (لا)'
                    }`
                  : '';
              addLog(
                d,
                user.name,
                `[${storeName}] سحب ${roleLabel}${takerText} (${type === 'cash' ? fmt(amount) : 'بضاعة'}${goodsStatusText})`,
                storeId
              );
              return d;
            });
            notify(
              isManagerGoods
                ? 'تم تسجيل السحب في قائمة المدير والمالك وإبلاغ الإدارة'
                : 'تم التسجيل وإرساله للإدارة للاعتماد'
            );
          }}
        />
      )}

      {modal === 'staff_wd' && (
        <StaffWithdrawalsModal
          db={db}
          upd={upd}
          user={user}
          allowedStoreIds={allowedStoreIds}
          initialStoreId={storeId}
          onClose={() => setModal(null)}
          notify={notify}
        />
      )}

      {modal === 'debts' && (
        <Modal
          title={`ديون زباين — ${storeName}`}
          onClose={() => setModal(null)}
          maxWidth="max-w-4xl"
        >
          <CustomerDebtsView
            db={db}
            upd={upd}
            user={user}
            allowedStoreIds={[storeId]}
            initialStoreId={storeId}
            notify={notify}
          />
        </Modal>
      )}

      {modal === 'sal' && (
        <SalaryForm
          db={db}
          currentUser={user}
          notify={notify}
          onClose={() => setModal(null)}
          onSubmit={(u, netAmount, isManagerPin, settlement) => {
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
                storeId,
                uid: u.id,
                name: u.name,
                amount: netAmount,
                grossAmount: settlement?.grossAmount ?? netAmount,
                withdrawalDeduction: isDeduct ? settlement.deductionAmount : 0,
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
                `[${storeName}] راتب ${u.name}: ${fmt(netAmount)}${
                  isDeduct
                    ? ` (بعد خصم مسحوبات ${fmt(settlement.deductionAmount)} من ${fmt(settlement.grossAmount)})`
                    : isDefer
                      ? ` (تم تأجيل المسحوبات إلى ${settlement.nextMonth})`
                      : ''
                }`,
                storeId
              );
              return d;
            });
            notify('تم تسجيل صرف الراتب');
          }}
        />
      )}

      {modal === 'ret' && (
        <ReturnGoodsModal
          db={db}
          upd={upd}
          user={user}
          storeId={storeId}
          storeName={storeName}
          todaySales={todaySales}
          onClose={() => setModal(null)}
          notify={notify}
        />
      )}

      {modal === 'logout_choice' && (
        <Modal title="خيارات الخروج وإنهاء الدوام" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              اختر نوع الخروج المناسب — إغلاق التطبيق بالخطأ أو نفاد البطارية لا ينهي دوامك تلقائياً.
            </p>

            <button
              type="button"
              onClick={() => {
                setModal(null);
                onTemporaryLogout();
              }}
              className="flex w-full items-start gap-3 rounded-xl border border-amber-300 bg-amber-50/70 p-4 text-right transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/35 dark:hover:bg-amber-950/60"
            >
              <Coffee className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  تسجيل خروج مؤقت (متعدد / استراحة / غداء)
                </p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  يخرج لشاشة الدخول مؤقتاً دون تقفيل الصندوق أو جرد الدرج، ويمكنك أو لغيرك المتابعة فوراً عند العودة.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setCashCount('');
                setTries(0);
                setModal('close');
              }}
              className="flex w-full items-start gap-3 rounded-xl border border-rose-300 bg-rose-50/70 p-4 text-right transition-colors hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/35 dark:hover:bg-rose-950/60"
            >
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  إنهاء الدوام النهائي (جرد وتقفيل الصندوق)
                </p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  عند انتهاء الدوام الكامل: تعدّ المبلغ الفعلي بالدرج، ويُرحّل هذا المبلغ تلقائياً كافتتاح للدوام واليوم التالي.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setModal(null)}
              className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              إلغاء والبقاء في الدوام
            </button>
          </div>
        </Modal>
      )}

      {modal === 'close' && (
        <Modal title="جرد الصندوق وإنهاء الدوام النهائي" onClose={() => setModal(null)}>
          <form onSubmit={handleCloseShift} className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1 dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">الرصيد المرحّل من الدوام السابق:</span>
                <span className="font-num font-semibold">{fmt(carryover.openingCash)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">صافي حركة الدوام (بعد المصاريف والمسحوبات):</span>
                <span className="font-num font-semibold">
                  {carryover.todayNetMovement >= 0
                    ? `+${fmt(carryover.todayNetMovement)}`
                    : fmt(carryover.todayNetMovement)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 pt-1.5 font-bold dark:border-slate-800">
                <span>المبلغ المحسوب المتوقع في الدرج:</span>
                <span className="font-num text-[#38608f] dark:text-[#78a8de]">
                  {fmt(carryover.expectedCash)}
                </span>
              </div>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-400">
              أدخل المبلغ الموجود فعلياً في صندوق{' '}
              <strong>{storeName}</strong> (سيتم ترحيله لليوم التالي). المحاولات:{' '}
              <span className="font-num font-semibold">{tries}/3</span>
            </p>
            <input
              type="number"
              inputMode="numeric"
              value={cashCount}
              onChange={(e) => setCashCount(e.target.value)}
              placeholder="المبلغ الفعلي بالدرج"
              className="font-num w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 min-h-[44px] rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap"
              >
                تأكيد التقفيل والترحيل
              </button>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="flex-1 min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                رجوع
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmSaleOpen && cart.length > 0 && (
        <SaleConfirmModal
          cart={cart}
          storeName={storeName}
          sellerName={user.name}
          invoiceNumber={db.nid}
          onConfirm={finalizeSale}
          onClose={() => setConfirmSaleOpen(false)}
        />
      )}

      {modal === 'mailbox' && (
        <InternalMailboxModal
          db={db}
          upd={upd}
          user={user}
          allowedStoreIds={allowedStoreIds}
          onClose={() => setModal(null)}
          notify={notify}
        />
      )}

      {modal === 'branch_ledger' && (
        <BranchDrawerLedgerModal
          db={db}
          upd={upd}
          user={user}
          storeId={storeId}
          storeName={storeName}
          onClose={() => setModal(null)}
          notify={notify}
        />
      )}

      {invoice && (
        <InvoiceModal
          sale={invoice}
          storeName={storeName}
          onClose={() => setInvoice(null)}
        />
      )}
    </div>
  );
};
