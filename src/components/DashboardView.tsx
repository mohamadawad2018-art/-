import React, { useMemo, useState } from 'react';
import {
  Check,
  X,
  ArrowUpLeft,
  TrendingUp,
  PackageCheck,
  AlertTriangle,
  Store,
  UserCheck,
  ZoomIn,
  BellRing,
  Camera,
  Award,
  CalendarDays,
  Trophy,
  Clock,
  FileSpreadsheet,
  BarChart3,
  Image as ImageIcon,
  Search,
} from 'lucide-react';
import {
  dayKey,
  expectedCash,
  expectedCashForStore,
  fmt,
  getLowStockProducts,
  getWithdrawalWholesaleTotal,
  matchesQuery,
  monthKey,
  norm,
  sameDay,
  tm,
} from '../store';
import type { PosDatabase, Salary, StockIntake, Withdrawal } from '../types';
import { PhotoLightboxModal } from './Modals';

interface DashboardViewProps {
  db: PosDatabase;
  selectedStoreId: number | 'all';
  onDecideWithdrawal: (w: Withdrawal, status: 'approved' | 'rejected') => void;
  onDecideSalary: (s: Salary, status: 'approved' | 'rejected') => void;
  onDecideIntake: (intake: StockIntake, status: 'approved' | 'rejected') => void;
  onOpenInventory: () => void;
  onOpenIntake: () => void;
  onOpenMonthly: () => void;
  onOpenShifts: (mode?: 'daily' | 'monthly') => void;
  onSendBonus: (empName: string, storeId?: number) => void;
  onSelectStore: (id: number | 'all') => void;
  sheetsConnected?: boolean;
  onOpenSync?: () => void;
  onOpenBranchSalesReview?: (mode: 'daily' | 'monthly', storeId?: number | 'all') => void;
  allowedStoreIds?: number[];
  onAttachIntakePhoto?: (intake: StockIntake, photoDataUrl: string) => void;
  notify?: (msg: string) => void;
}

type TopProductsPeriod = 'today' | 'all';

export const DashboardView: React.FC<DashboardViewProps> = ({
  db,
  selectedStoreId,
  onDecideWithdrawal,
  onDecideSalary,
  onDecideIntake,
  onOpenInventory,
  onOpenIntake,
  onOpenMonthly,
  onOpenShifts,
  onSendBonus,
  onSelectStore,
  sheetsConnected = false,
  onOpenSync,
  onOpenBranchSalesReview,
  allowedStoreIds,
  onAttachIntakePhoto,
  notify,
}) => {
  const [period, setPeriod] = useState<TopProductsPeriod>('today');
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [itemFilter, setItemFilter] = useState<string>('');
  const [inspectIntakeId, setInspectIntakeId] = useState<number | null>(null);
  const currentMonth = monthKey(Date.now());
  const todayStr = dayKey(Date.now());
  const inspectIntake =
    inspectIntakeId !== null
      ? db.stockIntakes.find((x) => x.id === inspectIntakeId) ?? null
      : null;

  const accessibleStoreIds = useMemo(
    () =>
      allowedStoreIds && allowedStoreIds.length > 0
        ? allowedStoreIds
        : db.stores.map((s) => s.id),
    [allowedStoreIds, db.stores]
  );

  const matchStore = (id: number) =>
    selectedStoreId === 'all'
      ? accessibleStoreIds.includes(id)
      : id === selectedStoreId;

  const getStoreName = (id: number) =>
    db.stores.find((s) => s.id === id)?.name ?? 'المحل الرئيسي';

  const lowStockAlerts = useMemo(
    () =>
      getLowStockProducts(db, selectedStoreId).filter((p) =>
        accessibleStoreIds.includes(p.storeId)
      ),
    [db, selectedStoreId, accessibleStoreIds]
  );

  // Live Per-Store Snapshot for Today
  const storeSnapshots = useMemo(() => {
    return db.stores
      .filter((s) => accessibleStoreIds.includes(s.id))
      .map((store) => {
      const sSales = db.sales.filter(
        (s) => s.storeId === store.id && sameDay(s.ts)
      );
      const sReturns = db.returns.filter(
        (r) => r.storeId === store.id && sameDay(r.ts)
      );
      const sExpenses = db.expenses.filter(
        (e) => e.storeId === store.id && sameDay(e.ts)
      );
      const sSalaries = db.salaries.filter(
        (s) =>
          s.storeId === store.id && s.status === 'approved' && sameDay(s.ts)
      );

      const grossSales = sSales.reduce((a, s) => a + s.total, 0);
      const returnsTotal = sReturns.reduce((a, r) => a + r.price * r.qty, 0);
      const netSales = grossSales - returnsTotal;

      const grossMargin = sSales.reduce(
        (a, s) =>
          a +
          s.items.reduce(
            (b, i) => b + (i.price - i.cost) * (i.qty - i.ret),
            0
          ),
        0
      );
      const expensesTotal =
        sExpenses.reduce((a, e) => a + e.amount, 0) +
        sSalaries.reduce((a, s) => a + s.amount, 0);
      const netProfit = grossMargin - expensesTotal;

      const soldItemsMap = new Map<string, number>();
      let unitsSold = 0;
      for (const s of sSales) {
        for (const item of s.items) {
          const netQty = item.qty - item.ret;
          if (netQty <= 0) continue;
          unitsSold += netQty;
          soldItemsMap.set(
            item.name,
            (soldItemsMap.get(item.name) ?? 0) + netQty
          );
        }
      }
      const soldItemsList = Array.from(soldItemsMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, qty]) => ({ name, qty }));

      const holder = db.activeHolders[store.id];
      const storeLowCount = getLowStockProducts(db, store.id).length;
      const todayShifts = db.shifts.filter(
        (sh) => sh.storeId === store.id && sameDay(sh.ts)
      );
      const lastShiftToday =
        todayShifts.length > 0
          ? todayShifts.slice().sort((a, b) => b.ts - a.ts)[0]
          : null;

      return {
        store,
        holder,
        invoiceCount: sSales.length,
        unitsSold,
        soldItemsList,
        netSales,
        netProfit,
        expectedCash: expectedCashForStore(db, store.id),
        storeLowCount,
        todayShiftCount: todayShifts.length,
        lastShiftToday,
      };
    });
  }, [db, accessibleStoreIds]);

  const sellerNames = useMemo(() => {
    const names = new Set<string>();
    for (const s of db.sales) {
      if (matchStore(s.storeId) && s.emp.trim()) {
        names.add(s.emp.trim());
      }
    }
    for (const u of db.users) {
      if (u.role === 'employee') {
        const uStores =
          u.storeIds && u.storeIds.length > 0
            ? u.storeIds
            : u.storeId !== undefined
              ? [u.storeId]
              : [];
        if (
          selectedStoreId === 'all'
            ? uStores.some((sid) => accessibleStoreIds.includes(sid))
            : uStores.includes(selectedStoreId)
        ) {
          names.add(u.name.trim());
        }
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [db.sales, db.users, selectedStoreId, accessibleStoreIds]);

  const hasSalesFilter =
    staffFilter !== 'all' || itemFilter.trim().length > 0;
  const matchSeller = (empName: string) =>
    staffFilter === 'all' || norm(empName) === norm(staffFilter);
  const matchItemName = (name: string) =>
    !itemFilter.trim() || matchesQuery(name, itemFilter);

  const todaySales = useMemo(
    () =>
      db.sales.filter(
        (s) =>
          matchStore(s.storeId) &&
          sameDay(s.ts) &&
          matchSeller(s.emp) &&
          (!itemFilter.trim() || s.items.some((i) => matchItemName(i.name)))
      ),
    [db.sales, selectedStoreId, staffFilter, itemFilter]
  );
  const todayReturns = useMemo(
    () =>
      db.returns.filter(
        (r) =>
          matchStore(r.storeId) &&
          sameDay(r.ts) &&
          (!itemFilter.trim() || matchItemName(r.name))
      ),
    [db.returns, selectedStoreId, itemFilter]
  );
  const todayExpenses = useMemo(
    () => db.expenses.filter((e) => matchStore(e.storeId) && sameDay(e.ts)),
    [db.expenses, selectedStoreId]
  );

  const dailyStats = useMemo(() => {
    const itemScoped = itemFilter.trim().length > 0;
    const grossSales = todaySales.reduce(
      (acc, s) =>
        acc +
        (itemScoped
          ? s.items
              .filter((i) => matchItemName(i.name))
              .reduce((sum, i) => sum + i.price * i.qty, 0)
          : s.total),
      0
    );
    const returnsTotal =
      staffFilter !== 'all'
        ? todaySales.reduce(
            (acc, s) =>
              acc +
              s.items
                .filter((i) => matchItemName(i.name))
                .reduce((sum, i) => sum + i.price * i.ret, 0),
            0
          )
        : todayReturns.reduce((acc, r) => acc + r.price * r.qty, 0);
    const netSales = grossSales - returnsTotal;

    const grossMargin = todaySales.reduce(
      (acc, s) =>
        acc +
        s.items
          .filter((i) => matchItemName(i.name))
          .reduce(
            (sum, item) => sum + (item.price - item.cost) * (item.qty - item.ret),
            0
          ),
      0
    );

    const approvedSalariesToday = db.salaries
      .filter(
        (s) =>
          matchStore(s.storeId) && s.status === 'approved' && sameDay(s.ts)
      )
      .reduce((acc, s) => acc + s.amount, 0);
    const expensesTotal = hasSalesFilter
      ? 0
      : todayExpenses.reduce((acc, e) => acc + e.amount, 0) +
        approvedSalariesToday;

    const netProfit = grossMargin - expensesTotal;
    const unitsSold = todaySales.reduce(
      (acc, s) =>
        acc +
        s.items
          .filter((i) => matchItemName(i.name))
          .reduce((sum, item) => sum + (item.qty - item.ret), 0),
      0
    );
    const invoiceCount = todaySales.length;
    const avgInvoice = invoiceCount > 0 ? Math.round(netSales / invoiceCount) : 0;

    return {
      netSales,
      returnsTotal,
      returnsCount:
        staffFilter !== 'all'
          ? todaySales.reduce(
              (acc, s) =>
                acc +
                s.items
                  .filter((i) => matchItemName(i.name))
                  .reduce((sum, i) => sum + i.ret, 0),
              0
            )
          : todayReturns.reduce((acc, r) => acc + r.qty, 0),
      expensesTotal,
      netProfit,
      unitsSold,
      invoiceCount,
      avgInvoice,
      cashExpected: expectedCash(
        db,
        selectedStoreId === 'all' ? undefined : selectedStoreId
      ),
    };
  }, [
    db,
    todaySales,
    todayReturns,
    todayExpenses,
    selectedStoreId,
    staffFilter,
    itemFilter,
    hasSalesFilter,
  ]);

  const topProducts = useMemo(() => {
    const sourceSales =
      period === 'today'
        ? todaySales
        : db.sales.filter(
            (s) =>
              matchStore(s.storeId) &&
              matchSeller(s.emp) &&
              (!itemFilter.trim() || s.items.some((i) => matchItemName(i.name)))
          );
    const map = new Map<
      string,
      { key: string; name: string; qty: number; revenue: number; profit: number }
    >();

    for (const sale of sourceSales) {
      for (const item of sale.items) {
        if (!matchItemName(item.name)) continue;
        const netQty = item.qty - item.ret;
        if (netQty <= 0) continue;
        const key = item.name;
        const current = map.get(key) || {
          key,
          name: item.name,
          qty: 0,
          revenue: 0,
          profit: 0,
        };
        current.qty += netQty;
        current.revenue += netQty * item.price;
        current.profit += netQty * (item.price - item.cost);
        map.set(key, current);
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
      .slice(0, itemFilter.trim() ? 12 : 6);
  }, [db.sales, todaySales, period, selectedStoreId, staffFilter, itemFilter]);

  const maxTopQty = topProducts.length > 0 ? topProducts[0].qty : 1;

  const inventorySummary = useMemo(() => {
    const products = db.products.filter((p) => matchStore(p.storeId));
    const totalSkus = products.length;
    const totalUnits = products.reduce((acc, p) => acc + p.stock, 0);
    const costValue = products.reduce((acc, p) => acc + p.stock * p.cost, 0);
    const outOfStock = products.filter((p) => p.stock <= 0);
    const lowStock = products.filter(
      (p) => p.stock > 0 && p.stock <= (p.minStock ?? 3)
    );
    const healthyCount = totalSkus - outOfStock.length - lowStock.length;
    const attentionItems = [...outOfStock, ...lowStock].sort(
      (a, b) => a.stock - b.stock
    );

    return {
      totalSkus,
      totalUnits,
      costValue,
      outOfStockCount: outOfStock.length,
      lowStockCount: lowStock.length,
      healthyCount,
      attentionItems,
    };
  }, [db.products, selectedStoreId]);

  const pendingIntakes = db.stockIntakes.filter(
    (i) => matchStore(i.storeId) && i.status === 'pending'
  );
  const pendingWithdrawals = db.withdrawals.filter(
    (w) => matchStore(w.storeId) && w.status === 'pending'
  );
  const pendingSalaries = db.salaries.filter(
    (s) => matchStore(s.storeId) && s.status === 'pending'
  );
  const filteredSalesFeed = db.sales
    .filter(
      (s) =>
        matchStore(s.storeId) &&
        matchSeller(s.emp) &&
        (!itemFilter.trim() || s.items.some((i) => matchItemName(i.name)))
    )
    .slice(0, hasSalesFilter ? 25 : 12);

  // Live Current Month Summary (updates automatically day-by-day) + Daily History + Top Seller
  const { monthTotals, dailyHistoryRows, topSellersMonth } = useMemo(() => {
    const mSales = db.sales.filter(
      (s) => matchStore(s.storeId) && monthKey(s.ts) === currentMonth
    );
    const mReturns = db.returns.filter(
      (r) => matchStore(r.storeId) && monthKey(r.ts) === currentMonth
    );
    const mExpenses = db.expenses.filter(
      (e) => matchStore(e.storeId) && monthKey(e.ts) === currentMonth
    );
    const mSalaries = db.salaries.filter(
      (s) =>
        matchStore(s.storeId) &&
        s.status === 'approved' &&
        monthKey(s.ts) === currentMonth
    );
    const mIntakes = db.stockIntakes.filter(
      (i) =>
        matchStore(i.storeId) &&
        i.status === 'approved' &&
        monthKey(i.approvedTs ?? i.ts) === currentMonth
    );

    const monthGrossSales = mSales.reduce((acc, s) => acc + s.total, 0);
    const monthReturnsTotal = mReturns.reduce(
      (acc, r) => acc + r.price * r.qty,
      0
    );
    const monthNetSales = monthGrossSales - monthReturnsTotal;
    const monthGrossProfit = mSales.reduce(
      (acc, s) =>
        acc +
        s.items.reduce(
          (sum, i) => sum + (i.price - i.cost) * (i.qty - i.ret),
          0
        ),
      0
    );
    const mRents = (db.rents ?? []).filter(
      (r) => matchStore(r.storeId) && r.month === currentMonth
    );
    const monthRentTotal =
      Math.round(mRents.reduce((acc, r) => acc + r.localAmount, 0) * 100) / 100;
    const monthExpenses =
      mExpenses.reduce((acc, e) => acc + e.amount, 0) +
      mSalaries.reduce((acc, s) => acc + s.amount, 0);
    const monthNetProfit = monthGrossProfit - monthExpenses - monthRentTotal;
    const monthIntakeValue = mIntakes.reduce(
      (acc, i) =>
        acc + i.items.reduce((sum, item) => sum + item.qty * item.cost, 0),
      0
    );

    // Group ALL historical days (not only current month, sorted newest first)
    const dayMap = new Map<
      string,
      {
        invoiceCount: number;
        grossSales: number;
        returnsTotal: number;
        grossMargin: number;
        expensesTotal: number;
        intakeCount: number;
        intakeValue: number;
        sellers: Set<string>;
      }
    >();

    const ensureDay = (dKey: string) => {
      let entry = dayMap.get(dKey);
      if (!entry) {
        entry = {
          invoiceCount: 0,
          grossSales: 0,
          returnsTotal: 0,
          grossMargin: 0,
          expensesTotal: 0,
          intakeCount: 0,
          intakeValue: 0,
          sellers: new Set<string>(),
        };
        dayMap.set(dKey, entry);
      }
      return entry;
    };

    for (const s of db.sales) {
      if (!matchStore(s.storeId)) continue;
      const d = ensureDay(dayKey(s.ts));
      d.invoiceCount += 1;
      d.grossSales += s.total;
      d.sellers.add(s.emp);
      d.grossMargin += s.items.reduce(
        (acc, i) => acc + (i.price - i.cost) * (i.qty - i.ret),
        0
      );
    }
    for (const r of db.returns) {
      if (!matchStore(r.storeId)) continue;
      ensureDay(dayKey(r.ts)).returnsTotal += r.price * r.qty;
    }
    for (const e of db.expenses) {
      if (!matchStore(e.storeId)) continue;
      ensureDay(dayKey(e.ts)).expensesTotal += e.amount;
    }
    for (const sal of db.salaries) {
      if (!matchStore(sal.storeId) || sal.status !== 'approved') continue;
      ensureDay(dayKey(sal.ts)).expensesTotal += sal.amount;
    }
    for (const intake of db.stockIntakes) {
      if (!matchStore(intake.storeId) || intake.status !== 'approved') continue;
      const d = ensureDay(dayKey(intake.approvedTs ?? intake.ts));
      d.intakeCount += 1;
      d.intakeValue += intake.items.reduce(
        (sum, item) => sum + item.qty * item.cost,
        0
      );
    }

    const dailyRows = Array.from(dayMap.entries())
      .map(([date, v]) => ({
        date,
        invoiceCount: v.invoiceCount,
        netSales: v.grossSales - v.returnsTotal,
        expensesTotal: v.expensesTotal,
        netProfit: v.grossMargin - v.expensesTotal,
        intakeCount: v.intakeCount,
        intakeValue: v.intakeValue,
        sellers: Array.from(v.sellers),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    // Top-selling employees this month
    const sellerMap = new Map<
      string,
      {
        emp: string;
        salesTotal: number;
        profitTotal: number;
        invoices: number;
        units: number;
      }
    >();
    for (const s of mSales) {
      const cur = sellerMap.get(s.emp) ?? {
        emp: s.emp,
        salesTotal: 0,
        profitTotal: 0,
        invoices: 0,
        units: 0,
      };
      cur.invoices += 1;
      cur.salesTotal += s.items.reduce(
        (acc, i) => acc + i.price * (i.qty - i.ret),
        0
      );
      cur.profitTotal += s.items.reduce(
        (acc, i) => acc + (i.price - i.cost) * (i.qty - i.ret),
        0
      );
      cur.units += s.items.reduce((acc, i) => acc + (i.qty - i.ret), 0);
      sellerMap.set(s.emp, cur);
    }

    const sellers = Array.from(sellerMap.values()).sort(
      (a, b) => b.salesTotal - a.salesTotal || b.profitTotal - a.profitTotal
    );

    return {
      monthTotals: {
        monthGrossSales,
        monthNetSales,
        monthGrossProfit,
        monthNetProfit,
        monthExpenses,
        monthRentTotal,
        monthInvoices: mSales.length,
        monthIntakeCount: mIntakes.length,
        monthIntakeValue,
      },
      dailyHistoryRows: dailyRows,
      topSellersMonth: sellers,
    };
  }, [db, selectedStoreId, currentMonth, accessibleStoreIds]);

  const linkedStoreCount = db.stores.filter((s) =>
    Boolean(db.sheetsLinks?.[s.id]?.spreadsheetId)
  ).length;

  return (
    <div className="space-y-6">
      {/* Google Sheets & Excel Sync Status Strip */}
      {onOpenSync && (!sheetsConnected || linkedStoreCount < db.stores.length) && (
        <section
          aria-label="حالة الربط مع Google Sheets وإكسل"
          className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-800/70 dark:bg-emerald-950/30"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" />
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {!sheetsConnected
                    ? 'النسخ التلقائي إلى Google Sheets بانتظار تسجيل الدخول بحساب Google'
                    : `مرتبط ${linkedStoreCount} من ${db.stores.length} فروع مع Google Sheets`}
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {!sheetsConnected
                    ? 'افتح «جداول إكسل والمزامنة» وسجّل الدخول بحسابك لإنشاء جداول كل فرع تلقائياً في Google Drive / Sheets'
                    : 'أكمل ربط بقية الفروع لتفعيل المزامنة التلقائية بالاتجاهين للمخزون والمبيعات والأرباح والمصاريف'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenSync}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>ربط ومزامنة Google Sheets الآن</span>
              <ArrowUpLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>
      )}

      {/* Automatic Low-Stock Alert Banner */}
      {lowStockAlerts.length > 0 && (
        <section
          aria-label="تنبيهات انخفاض المخزون التلقائية"
          className="rounded-xl border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-800/80 dark:bg-amber-950/30"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <BellRing className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  تنبيه تلقائي: {lowStockAlerts.length}{' '}
                  {lowStockAlerts.length === 1
                    ? 'منتج وصل'
                    : 'منتجات وصلت'}{' '}
                  إلى الحد الأدنى للمخزون
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  يرجى توريد كميات جديدة للأصناف التالية قبل نفادها بالكامل
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onOpenIntake}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#38608f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2d4f77] whitespace-nowrap"
              >
                <Camera className="h-3.5 w-3.5" />
                <span>توريد بضاعة</span>
              </button>
              <button
                type="button"
                onClick={onOpenInventory}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-amber-100/60 dark:border-amber-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <span>مراجعة المخزون</span>
                <ArrowUpLeft className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {lowStockAlerts.slice(0, 6).map((prod) => {
              const isOut = prod.stock <= 0;
              return (
                <div
                  key={prod.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-amber-200/80 bg-white px-3 py-2 text-xs dark:border-amber-900/60 dark:bg-slate-900"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-900 dark:text-slate-100">
                      {prod.name}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">
                      {getStoreName(prod.storeId)}
                    </div>
                  </div>
                  <div className="text-left shrink-0 whitespace-nowrap">
                    <div
                      className={`font-semibold ${
                        isOut
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {isOut ? 'نفد المخزون' : 'وصل للحد الأدنى'}
                    </div>
                    <div className="font-num text-slate-600 dark:text-slate-300">
                      المتبقي: <strong>{prod.stock}</strong> / الحد:{' '}
                      {prod.minStock ?? 3}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Monthly Live KPIs + Top Seller Reward Card */}
      <section aria-label="ملخص الشهر الجاري المتجدد يومياً">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-[#38608f] dark:text-[#78a8de]" />
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">
              ملخص الشهر الجاري (<span className="font-num">{currentMonth}</span>) — يتجدد يومياً
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenShifts('daily')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Clock className="h-3.5 w-3.5 text-[#38608f] dark:text-[#78a8de]" />
              <span>جرد الدوامات اليومي</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenShifts('monthly')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <CalendarDays className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>جرد الدوامات الشهري</span>
            </button>
            <button
              type="button"
              onClick={onOpenMonthly}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#38608f] hover:underline dark:text-[#78a8de] whitespace-nowrap"
            >
              <span>الجداول التفصيلية لكل موظف والشهر</span>
              <ArrowUpLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              إجمالي مبيعات الشهر
            </p>
            <p className="font-num mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {fmt(monthTotals.monthGrossSales)}
            </p>
            <p className="font-num mt-1 text-xs text-slate-500 dark:text-slate-400">
              الصافي: {fmt(monthTotals.monthNetSales)} · {monthTotals.monthInvoices} فاتورة
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              أرباح الشهر الإجمالية
            </p>
            <p className="font-num mt-2 text-2xl font-bold text-[#38608f] dark:text-[#78a8de]">
              {fmt(monthTotals.monthGrossProfit)}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              الربح قبل المصاريف والرواتب
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              صافي ربح الشهر
            </p>
            <p
              className={`font-num mt-2 text-2xl font-bold ${
                monthTotals.monthNetProfit >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {fmt(monthTotals.monthNetProfit)}
            </p>
            <p className="font-num mt-1 text-xs text-slate-500 dark:text-slate-400">
              بعد مصاريف ورواتب بقيمة {fmt(monthTotals.monthExpenses)}
              {monthTotals.monthRentTotal > 0 &&
                ` وإيجار المحل (${fmt(monthTotals.monthRentTotal)})`}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              البضاعة الداخلة للشهر (فواتير)
            </p>
            <p className="font-num mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
              {fmt(monthTotals.monthIntakeValue)}
            </p>
            <p className="font-num mt-1 text-xs text-slate-500 dark:text-slate-400">
              {monthTotals.monthIntakeCount} فاتورة توريد معتمدة
            </p>
          </div>
        </div>

        {/* Top-Selling Employee Card for Bonus */}
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-800/80 dark:bg-amber-950/25">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400">
                <Trophy className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  أكثر موظف مبيعاً هذا الشهر (لإرسال مكافأة)
                </h3>
                {topSellersMonth.length > 0 ? (
                  <div className="mt-1 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                    <p>
                      المركز الأول:{' '}
                      <strong className="text-sm text-[#38608f] dark:text-[#78a8de]">
                        {topSellersMonth[0].emp}
                      </strong>{' '}
                      <span className="font-num">
                        — مبيعات: <strong>{fmt(topSellersMonth[0].salesTotal)}</strong> · أرباح:{' '}
                        <strong className="text-emerald-700 dark:text-emerald-400">
                          {fmt(topSellersMonth[0].profitTotal)}
                        </strong>{' '}
                        · {topSellersMonth[0].invoices} فاتورة ({fmt(topSellersMonth[0].units)} قطعة)
                      </span>
                    </p>
                    {topSellersMonth.length > 1 && (
                      <p className="font-num text-slate-500 dark:text-slate-400">
                        يليهم:{' '}
                        {topSellersMonth
                          .slice(1, 3)
                          .map((s, i) => `#${i + 2} ${s.emp} (${fmt(s.salesTotal)})`)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    لا توجد مبيعات مسجلة هذا الشهر لتحديد أكثر موظف مبيعاً بعد.
                  </p>
                )}
              </div>
            </div>

            {topSellersMonth.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  onSendBonus(
                    topSellersMonth[0].emp,
                    selectedStoreId === 'all' ? undefined : selectedStoreId
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap shrink-0"
              >
                <Award className="h-4 w-4" />
                <span>إرسال مكافأة لـ {topSellersMonth[0].emp}</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Row 0: Live Per-Store Snapshot */}
      <section aria-label="موقف المحلات لحظياً اليوم">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Store className="h-4 w-4 text-[#38608f] dark:text-[#78a8de]" />
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">
              موقف المحلات لحظياً — اليوم
            </h2>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            متابعة المبيع والقيمة والربح ومستلم الصندوق لكل محل حتى هذه اللحظة
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {storeSnapshots.map((snap) => {
            const isSelected = selectedStoreId === snap.store.id;
            return (
              <div
                key={snap.store.id}
                className={`rounded-xl border bg-white p-5 transition-colors dark:bg-slate-900 ${
                  isSelected
                    ? 'border-[#38608f] dark:border-[#6aa0db]'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onSelectStore(isSelected ? 'all' : snap.store.id)
                      }
                      className="text-base font-bold text-slate-900 hover:text-[#38608f] dark:text-slate-100 dark:hover:text-[#78a8de]"
                    >
                      {snap.store.name}
                    </button>
                    {isSelected && (
                      <span className="text-xs font-semibold text-[#38608f] dark:text-[#78a8de]">
                        · محدد
                      </span>
                    )}
                    {snap.storeLowCount > 0 && (
                      <span className="font-num text-xs font-semibold text-amber-700 dark:text-amber-400">
                        · {snap.storeLowCount} تنبيه مخزون
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    <UserCheck className="h-3.5 w-3.5 text-slate-500" />
                    <span className="text-slate-500 dark:text-slate-400">
                      مستلم الصندوق:
                    </span>
                    {snap.holder ? (
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        {snap.holder.userName}{' '}
                        <span className="font-num font-normal text-slate-400">
                          (منذ {tm(snap.holder.since)})
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400">غير مستلم حالياً</span>
                    )}
                  </div>
                </div>

                <div className="mb-3 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      قيمة المبيع اليوم
                    </p>
                    <p className="font-num mt-1 text-lg font-bold text-emerald-600 dark:text-emerald-400">
                      {fmt(snap.netSales)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      الربح الصافي
                    </p>
                    <p
                      className={`font-num mt-1 text-lg font-bold ${
                        snap.netProfit >= 0
                          ? 'text-[#38608f] dark:text-[#78a8de]'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {fmt(snap.netProfit)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      الصندوق المتوقع
                    </p>
                    <p className="font-num mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">
                      {fmt(snap.expectedCash)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-start justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      المباع حتى الآن:
                    </span>
                    {snap.soldItemsList.length === 0 ? (
                      <span className="mr-1">لا توجد مبيعات اليوم بعد</span>
                    ) : (
                      <div className="mt-1 space-y-0.5">
                        {snap.soldItemsList.map((it) => (
                          <div
                            key={it.name}
                            className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-0.5 dark:bg-slate-800/60"
                          >
                            <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                              {it.name}
                            </span>
                            <span className="font-num font-bold text-[#38608f] dark:text-[#78a8de] shrink-0">
                              × {it.qty}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
                    {snap.lastShiftToday && (
                      <button
                        type="button"
                        onClick={() => onOpenShifts('daily')}
                        className={`font-num rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                          snap.lastShiftToday.diff === 0
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                            : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                        }`}
                      >
                        جرد اليوم ({snap.todayShiftCount}):{' '}
                        {snap.lastShiftToday.diff === 0
                          ? 'مطابق'
                          : fmt(snap.lastShiftToday.diff)}
                      </button>
                    )}
                    <span className="font-num text-slate-500">
                      {snap.invoiceCount} فاتورة · {snap.unitsSold} قطعة
                    </span>
                  </div>
                </div>

                {onOpenBranchSalesReview && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenBranchSalesReview('daily', snap.store.id)
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:border-[#38608f] hover:text-[#38608f] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-[#78a8de] whitespace-nowrap"
                    >
                      <BarChart3 className="h-3 w-3" />
                      <span>تفاصيل مبيع اليوم</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenBranchSalesReview('monthly', snap.store.id)
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:border-emerald-600 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-emerald-400 whitespace-nowrap"
                    >
                      <CalendarDays className="h-3 w-3" />
                      <span>تفاصيل مبيع الشهر</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Quick Filter Bar: Employee Buttons & Item Name Search */}
      <section
        aria-label="فلترة المبيعات حسب الموظف والقطعة"
        className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              فلترة المبيعات بالموظف:
            </span>
            <button
              type="button"
              onClick={() => setStaffFilter('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                staffFilter === 'all'
                  ? 'bg-[#38608f] text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              الكل
            </button>
            {sellerNames.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() =>
                  setStaffFilter((prev) => (prev === name ? 'all' : name))
                }
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  staffFilter === name
                    ? 'bg-[#38608f] text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
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
                value={itemFilter}
                onChange={(e) => setItemFilter(e.target.value)}
                placeholder="فلترة باسم القطعة..."
                className="w-48 rounded-lg border border-slate-300 bg-white py-1.5 pr-8 pl-3 text-xs text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            {hasSalesFilter && (
              <button
                type="button"
                onClick={() => {
                  setStaffFilter('all');
                  setItemFilter('');
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 whitespace-nowrap"
              >
                <X className="h-3.5 w-3.5" />
                <span>إلغاء الفلتر</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Row 1: Daily Sales Statistics KPIs */}
      <section aria-label="إحصائيات المبيعات اليومية">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300">
            ملخص اليوم (
            {selectedStoreId === 'all'
              ? 'جميع المحلات'
              : getStoreName(selectedStoreId)}
            )
            {hasSalesFilter && (
              <span className="mr-2 text-xs font-semibold text-[#38608f] dark:text-[#78a8de]">
                · مفلتر
                {staffFilter !== 'all' ? ` (${staffFilter})` : ''}
                {itemFilter.trim() ? ` [${itemFilter.trim()}]` : ''}
              </span>
            )}
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-num">{dailyStats.invoiceCount} فاتورة</span>
            <span aria-hidden="true">·</span>
            <span className="font-num">{dailyStats.unitsSold} قطعة مباعة</span>
            <span aria-hidden="true">·</span>
            <span className="font-num">
              متوسط الفاتورة {fmt(dailyStats.avgInvoice)}
            </span>
            {dailyStats.returnsCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-num text-rose-600 dark:text-rose-400">
                  مرتجعات {dailyStats.returnsCount} ({fmt(dailyStats.returnsTotal)})
                </span>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              صافي مبيعات اليوم
            </p>
            <p className="font-num mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {fmt(dailyStats.netSales)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              صافي الأرباح اليومية
            </p>
            <p
              className={`font-num mt-2 text-2xl font-bold ${
                dailyStats.netProfit >= 0
                  ? 'text-[#38608f] dark:text-[#78a8de]'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {fmt(dailyStats.netProfit)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              المصاريف والرواتب المعتمدة
            </p>
            <p className="font-num mt-2 text-2xl font-bold text-amber-600 dark:text-amber-400">
              {fmt(dailyStats.expensesTotal)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              الصندوق المتوقع
            </p>
            <p className="font-num mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
              {fmt(dailyStats.cashExpected)}
            </p>
          </div>
        </div>
      </section>

      {/* Row 2: Top-Selling Products + Inventory Status */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#38608f] dark:text-[#78a8de]" />
              <h3 className="text-base font-bold">المنتجات الأكثر مبيعاً</h3>
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setPeriod('today')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  period === 'today'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                اليوم
              </button>
              <button
                type="button"
                onClick={() => setPeriod('all')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  period === 'all'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                كل الفترات
              </button>
            </div>
          </div>

          {topProducts.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              {period === 'today'
                ? 'لا توجد مبيعات مسجلة اليوم بعد'
                : 'لا توجد مبيعات مسجلة لعرض المنتجات الأكثر مبيعاً'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                    <th className="px-3 py-2.5 text-right font-semibold">#</th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      المنتج
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      الكمية
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      الإيراد
                    </th>
                    <th className="px-3 py-2.5 text-left font-semibold">
                      الربح
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {topProducts.map((item, idx) => {
                    const widthPct = Math.max(
                      8,
                      Math.round((item.qty / maxTopQty) * 100)
                    );
                    return (
                      <tr
                        key={item.key}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                      >
                        <td className="font-num px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium">{item.name}</div>
                          <div className="mt-1.5 h-1.5 w-full max-w-[180px] overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-800">
                            <div
                              className="h-full bg-[#38608f] dark:bg-[#6aa0db]"
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                        </td>
                        <td className="font-num px-3 py-2.5 text-center font-bold">
                          {fmt(item.qty)}
                        </td>
                        <td className="font-num px-3 py-2.5 text-center text-slate-700 dark:text-slate-300">
                          {fmt(item.revenue)}
                        </td>
                        <td className="font-num px-3 py-2.5 text-left font-semibold text-emerald-600 dark:text-emerald-400">
                          {fmt(item.profit)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Inventory Status */}
        <section className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <PackageCheck className="h-4 w-4 text-[#38608f] dark:text-[#78a8de]" />
              <h3 className="text-base font-bold">حالة المخزون</h3>
            </div>
            <button
              type="button"
              onClick={onOpenInventory}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#38608f] hover:underline dark:text-[#78a8de] whitespace-nowrap shrink-0"
            >
              <span>إدارة المخزون</span>
              <ArrowUpLeft className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-3 border-b border-slate-200 pb-4 text-center dark:border-slate-800">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">متوفر</p>
              <p className="font-num mt-1 text-lg font-bold text-emerald-600 dark:text-emerald-400">
                {inventorySummary.healthyCount}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                عند الحد الأدنى
              </p>
              <p className="font-num mt-1 text-lg font-bold text-amber-600 dark:text-amber-400">
                {inventorySummary.lowStockCount}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">نفد</p>
              <p className="font-num mt-1 text-lg font-bold text-rose-600 dark:text-rose-400">
                {inventorySummary.outOfStockCount}
              </p>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              إجمالي الأصناف:{' '}
              <strong className="font-num text-slate-800 dark:text-slate-200">
                {fmt(inventorySummary.totalSkus)}
              </strong>
            </span>
            <span>
              إجمالي القطع:{' '}
              <strong className="font-num text-slate-800 dark:text-slate-200">
                {fmt(inventorySummary.totalUnits)}
              </strong>
            </span>
            <span>
              قيمة التكلفة:{' '}
              <strong className="font-num text-slate-800 dark:text-slate-200">
                {fmt(inventorySummary.costValue)}
              </strong>
            </span>
          </div>

          {inventorySummary.attentionItems.length === 0 ? (
            <div className="py-6 text-center text-sm text-emerald-700 dark:text-emerald-400">
              جميع الأصناف فوق الحد الأدنى المحدد للمخزون
            </div>
          ) : (
            <div className="divide-y divide-slate-200 border-t border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {inventorySummary.attentionItems.slice(0, 6).map((p) => {
                const isOut = p.stock <= 0;
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertTriangle
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isOut
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      />
                      <span className="truncate font-medium">
                        {p.name}
                        {selectedStoreId === 'all' && db.stores.length > 1 && (
                          <span className="mr-1.5 text-xs font-normal text-slate-400">
                            ({getStoreName(p.storeId)})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
                      <span
                        className={`text-xs font-semibold ${
                          isOut
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {isOut ? 'نفد المخزون' : 'وصل للحد الأدنى'}
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">
                        ·
                      </span>
                      <span className="font-num text-xs font-bold text-slate-700 dark:text-slate-300">
                        {p.stock} / {p.minStock ?? 3}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Row 3: Approvals Queue + Live Sales Feed */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-4 text-base font-bold">بانتظار تأكيدك ومطابقتك</h3>
          {!pendingIntakes.length &&
          !pendingWithdrawals.length &&
          !pendingSalaries.length ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              لا توجد طلبات معلقة حالياً
            </p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {pendingIntakes.map((intake) => (
                <div key={intake.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      توريد بضاعة #{intake.id} · {getStoreName(intake.storeId)}
                    </span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      أدخلها: {intake.enteredBy}
                    </span>
                  </div>

                  <div className="mt-2 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setInspectIntakeId(intake.id)}
                      className="group relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-950"
                      title={
                        intake.photoDataUrl
                          ? 'عرض صورة الفاتورة'
                          : 'تفاصيل الفاتورة (بدون صورة)'
                      }
                    >
                      {intake.photoDataUrl ? (
                        <>
                          <img
                            src={intake.photoDataUrl}
                            alt={`فاتورة ${intake.id}`}
                            className="h-full w-full object-cover"
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-slate-950/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
                            <ZoomIn className="h-4 w-4" />
                          </span>
                        </>
                      ) : (
                        <div className="flex flex-col items-center gap-1 px-1 text-center text-slate-400">
                          <ImageIcon className="h-5 w-5" />
                          <span className="text-[10px] font-medium">بدون صورة</span>
                        </div>
                      )}
                    </button>

                    <div className="min-w-0 flex-1 space-y-1 text-xs">
                      {intake.items.map((line, i) => (
                        <div key={i} className="text-slate-700 dark:text-slate-200">
                          <span className="font-semibold">{line.name}</span> ×{' '}
                          <span className="font-num font-bold">{line.qty}</span>{' '}
                          <span className="font-num text-slate-500 dark:text-slate-400">
                            (جملة {fmt(line.cost)} · مبيع {fmt(line.price)} · أدنى{' '}
                            {fmt(line.min)})
                          </span>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setInspectIntakeId(intake.id)}
                        className="text-xs font-semibold text-[#38608f] hover:underline dark:text-[#78a8de]"
                      >
                        {intake.photoDataUrl
                          ? 'فتح صورة الفاتورة للمطابقة'
                          : 'تفاصيل الفاتورة / إرفاق صورة'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onDecideIntake(intake, 'approved')}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>مطابقة وإدخال للمخزن</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDecideIntake(intake, 'rejected')}
                      className="flex items-center justify-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 whitespace-nowrap"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>رفض</span>
                    </button>
                  </div>
                </div>
              ))}

              {pendingWithdrawals.map((w) => {
                const isEmp = w.whoType === 'employee';
                const whoLabel = isEmp ? 'سحب موظف' : 'سحب مدير / مالك';
                const takerName = w.takenBy || w.emp || 'الإدارة';
                const wholesaleTotal =
                  w.type === 'goods'
                    ? getWithdrawalWholesaleTotal(w, db.products)
                    : w.amount;
                return (
                  <div key={w.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                          isEmp
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-[#38608f]/15 text-[#38608f] dark:bg-[#38608f]/30 dark:text-[#98c1f0]'
                        }`}
                      >
                        {whoLabel}
                      </span>
                      {w.type === 'goods' && (
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                            w.paid
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : isEmp
                                ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                                : 'bg-[#38608f]/10 text-[#38608f] dark:bg-[#38608f]/25 dark:text-[#98c1f0]'
                          }`}
                        >
                          {w.paid
                            ? 'تم الدفع والمحاسبة'
                            : isEmp
                              ? 'لم يحاسب عليها (لا)'
                              : 'مسجّل بالقائمة (بدون دفع)'}
                        </span>
                      )}
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {getStoreName(w.storeId)} · الساحب:{' '}
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {takerName}
                        </span>{' '}
                        · سجّله بالصندوق: {w.emp}
                      </p>
                    </div>
                    <p className="mt-1.5 text-sm text-slate-800 dark:text-slate-200">
                      {w.type === 'cash' ? (
                        <>
                          سحب مبلغ{' '}
                          <span className="font-num font-bold">
                            {fmt(w.amount)}
                          </span>{' '}
                          من الدرج بواسطة{' '}
                          <span className="font-semibold">{takerName}</span>. هل
                          تم السحب فعلاً؟
                        </>
                      ) : (
                        <>
                          سحب أغراض بواسطة{' '}
                          <span className="font-semibold">{takerName}</span>:{' '}
                          <span className="font-semibold">
                            {w.items
                              .map((i) => `${i.name} × ${i.qty}`)
                              .join('، ')}
                          </span>{' '}
                          <span className="font-num text-xs font-bold text-[#38608f] dark:text-[#78a8de]">
                            (بسعر الجملة: {fmt(wholesaleTotal)})
                          </span>
                          . هل تم أخذها فعلاً؟
                        </>
                      )}
                    </p>
                    <div className="mt-2.5 flex gap-2">
                      <button
                        type="button"
                        onClick={() => onDecideWithdrawal(w, 'approved')}
                        className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>نعم، تم السحب</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDecideWithdrawal(w, 'rejected')}
                        className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 whitespace-nowrap"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>لا، لم يتم</span>
                      </button>
                    </div>
                  </div>
                );
              })}

              {pendingSalaries.map((s) => (
                <div key={s.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    طلب راتب ({getStoreName(s.storeId)}) · سجّله {s.by}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {s.name} — <span className="font-num">{fmt(s.amount)}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    الموافقة تُدخله ضمن المصاريف.
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onDecideSalary(s, 'approved')}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>موافقة</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDecideSalary(s, 'rejected')}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 whitespace-nowrap"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>رفض</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-4 text-base font-bold">شريط المبيعات اللحظي</h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                  <th className="px-3 py-2.5 text-right font-semibold">#</th>
                  {selectedStoreId === 'all' && db.stores.length > 1 && (
                    <th className="px-3 py-2.5 text-right font-semibold">
                      المحل
                    </th>
                  )}
                  <th className="px-3 py-2.5 text-right font-semibold">
                    البند (الصنف)
                  </th>
                  <th className="px-3 py-2.5 text-center font-semibold">
                    العدد
                  </th>
                  <th className="px-3 py-2.5 text-center font-semibold">
                    المبلغ
                  </th>
                  <th className="px-3 py-2.5 text-center font-semibold">
                    البائع
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold">الوقت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredSalesFeed.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400"
                    >
                      لم يتم تسجيل أي فواتير مبيع بعد
                    </td>
                  </tr>
                ) : (
                  filteredSalesFeed.flatMap((s) =>
                    s.items
                      .filter((item) => matchItemName(item.name))
                      .map((item, idx) => {
                        const netQty = item.qty - item.ret;
                        const lineAmount = netQty * item.price;
                        return (
                          <tr
                            key={`${s.id}-${item.id}-${idx}`}
                            className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                          >
                            <td className="font-num px-3 py-2.5 font-semibold">
                              #{s.id}
                            </td>
                            {selectedStoreId === 'all' && db.stores.length > 1 && (
                              <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                {getStoreName(s.storeId)}
                              </td>
                            )}
                            <td className="px-3 py-2.5 font-medium">
                              {item.name}
                              {item.ret > 0 && (
                                <span className="font-num mr-1.5 text-xs text-rose-600 dark:text-rose-400">
                                  (مرتجع {item.ret})
                                </span>
                              )}
                            </td>
                            <td className="font-num px-3 py-2.5 text-center font-semibold">
                              {netQty}
                            </td>
                            <td className="font-num px-3 py-2.5 text-center font-bold text-emerald-600 dark:text-emerald-400">
                              {fmt(lineAmount)}
                            </td>
                            <td className="px-3 py-2.5 text-center">{s.emp}</td>
                            <td className="font-num px-3 py-2.5 text-left text-slate-500 dark:text-slate-400">
                              {tm(s.ts)}
                            </td>
                          </tr>
                        );
                      })
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Row 4: Previous & Current Days Summary Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">
              سجل الأيام السابقة والحالية (المبيعات والأرباح والمصاريف وفواتير التوريد)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              ملخص يومي لكل يوم: كم باع بالنهار، صافي الربح، المصاريف، الفواتير الداخلة للمحل وقيمتها، والموظفون الذين باعوا
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenMonthly}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#38608f] hover:underline dark:text-[#78a8de] whitespace-nowrap"
          >
            <span>عرض التقرير الشهري الكامل</span>
            <ArrowUpLeft className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                <th className="px-3 py-2.5 text-right font-semibold">التاريخ</th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  الموظفون الذين باعوا
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  مبيع النهار
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  المصاريف
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  فواتير التوريد الداخلة وقيمتها
                </th>
                <th className="px-3 py-2.5 text-left font-semibold">
                  صافي الربح
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {dailyHistoryRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    لا توجد عمليات مسجلة للأيام السابقة أو اليوم حتى الآن
                  </td>
                </tr>
              ) : (
                dailyHistoryRows.map((row) => (
                  <tr
                    key={row.date}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                  >
                    <td className="font-num px-3 py-2.5 font-semibold whitespace-nowrap">
                      {row.date}
                      {row.date === todayStr && (
                        <span className="mr-2 rounded bg-[#38608f]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[#38608f] dark:text-[#78a8de]">
                          اليوم
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                      {row.sellers.length > 0 ? row.sellers.join('، ') : '—'}
                    </td>
                    <td className="font-num px-3 py-2.5 text-center font-semibold">
                      {fmt(row.netSales)}{' '}
                      <span className="text-xs font-normal text-slate-400">
                        ({row.invoiceCount})
                      </span>
                    </td>
                    <td className="font-num px-3 py-2.5 text-center text-amber-600 dark:text-amber-400">
                      {fmt(row.expensesTotal)}
                    </td>
                    <td className="font-num px-3 py-2.5 text-center text-slate-700 dark:text-slate-300">
                      {row.intakeCount > 0
                        ? `${row.intakeCount} فاتورة · ${fmt(row.intakeValue)}`
                        : '—'}
                    </td>
                    <td
                      className={`font-num px-3 py-2.5 text-left font-bold ${
                        row.netProfit >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {fmt(row.netProfit)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {inspectIntake && (
        <PhotoLightboxModal
          intake={inspectIntake}
          storeName={getStoreName(inspectIntake.storeId)}
          onClose={() => setInspectIntakeId(null)}
          onAttachPhoto={onAttachIntakePhoto}
          notify={notify}
        />
      )}
    </div>
  );
};
