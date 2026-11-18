import React, { useMemo, useState } from 'react';
import { CalendarDays, Clock, FileText, Package, Search, Store, Users, X } from 'lucide-react';
import { dayKey, fmt, fullDate, matchesQuery, monthKey, norm, tm } from '../store';
import type { PosDatabase } from '../types';
import { Modal } from './Modals';

interface BranchSalesReviewModalProps {
  db: PosDatabase;
  initialMode: 'daily' | 'monthly';
  initialStoreId: number | 'all';
  onClose: () => void;
}

type DetailTab = 'products' | 'invoices' | 'sellers';

export const BranchSalesReviewModal: React.FC<BranchSalesReviewModalProps> = ({
  db,
  initialMode,
  initialStoreId,
  onClose,
}) => {
  const [mode, setMode] = useState<'daily' | 'monthly'>(initialMode);
  const [selectedDay, setSelectedDay] = useState<string>(() =>
    dayKey(Date.now())
  );
  const [selectedMonth, setSelectedMonth] = useState<string>(() =>
    monthKey(Date.now())
  );
  const [branchFilter, setBranchFilter] = useState<number | 'all'>(
    initialStoreId
  );
  const [sellerFilter, setSellerFilter] = useState<string>('all');
  const [itemQuery, setItemQuery] = useState<string>('');
  const [detailTab, setDetailTab] = useState<DetailTab>('products');

  const getStoreName = (id: number) =>
    db.stores.find((s) => s.id === id)?.name ?? 'المحل الرئيسي';

  const matchesPeriod = (ts: number) =>
    mode === 'daily'
      ? dayKey(ts) === selectedDay
      : monthKey(ts) === selectedMonth;

  const {
    branchRows,
    totals,
    soldProducts,
    filteredInvoices,
    sellerRows,
    availableSellers,
  } = useMemo(() => {
      const branchesToSummarize = db.stores.map((store) => {
        const sSales = db.sales.filter(
          (s) => s.storeId === store.id && matchesPeriod(s.ts)
        );
        const sReturns = db.returns.filter(
          (r) => r.storeId === store.id && matchesPeriod(r.ts)
        );
        const sExpenses = db.expenses.filter(
          (e) => e.storeId === store.id && matchesPeriod(e.ts)
        );
        const sSalaries = db.salaries.filter(
          (sal) =>
            sal.storeId === store.id &&
            sal.status === 'approved' &&
            matchesPeriod(sal.ts)
        );

        const grossSales = sSales.reduce((a, s) => a + s.total, 0);
        const returnsTotal = sReturns.reduce((a, r) => a + r.price * r.qty, 0);
        const netSales = grossSales - returnsTotal;
        const unitsSold = sSales.reduce(
          (a, s) => a + s.items.reduce((b, i) => b + Math.max(0, i.qty - i.ret), 0),
          0
        );
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

        return {
          store,
          invoiceCount: sSales.length,
          unitsSold,
          grossSales,
          returnsTotal,
          netSales,
          grossMargin,
          expensesTotal,
          netProfit,
        };
      });

      const matchBranch = (sid: number) =>
        branchFilter === 'all' || sid === branchFilter;

      const scopedBranches = branchesToSummarize.filter((b) =>
        matchBranch(b.store.id)
      );

      const tot = scopedBranches.reduce(
        (acc, b) => ({
          invoices: acc.invoices + b.invoiceCount,
          units: acc.units + b.unitsSold,
          grossSales: acc.grossSales + b.grossSales,
          returns: acc.returns + b.returnsTotal,
          netSales: acc.netSales + b.netSales,
          grossMargin: acc.grossMargin + b.grossMargin,
          expenses: acc.expenses + b.expensesTotal,
          netProfit: acc.netProfit + b.netProfit,
        }),
        {
          invoices: 0,
          units: 0,
          grossSales: 0,
          returns: 0,
          netSales: 0,
          grossMargin: 0,
          expenses: 0,
          netProfit: 0,
        }
      );

      const baseInvoices = db.sales
        .filter((s) => matchBranch(s.storeId) && matchesPeriod(s.ts))
        .slice()
        .sort((a, b) => b.ts - a.ts);

      const sellersSet = Array.from(
        new Set(baseInvoices.map((s) => s.emp.trim()).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b, 'ar'));

      const matchItem = (name: string) =>
        !itemQuery.trim() || matchesQuery(name, itemQuery);

      const invoices = baseInvoices.filter((s) => {
        if (sellerFilter !== 'all' && norm(s.emp) !== norm(sellerFilter)) {
          return false;
        }
        if (itemQuery.trim() && !s.items.some((i) => matchItem(i.name))) {
          return false;
        }
        return true;
      });

      const prodMap = new Map<
        string,
        {
          key: string;
          storeId: number;
          storeName: string;
          name: string;
          qty: number;
          returned: number;
          revenue: number;
          profit: number;
        }
      >();

      const sellerMap = new Map<
        string,
        {
          key: string;
          emp: string;
          storeName: string;
          invoices: number;
          units: number;
          revenue: number;
          profit: number;
        }
      >();

      for (const s of invoices) {
        const sName = getStoreName(s.storeId);
        const sKey = `${s.storeId}__${s.emp}`;
        const curSeller = sellerMap.get(sKey) ?? {
          key: sKey,
          emp: s.emp,
          storeName: sName,
          invoices: 0,
          units: 0,
          revenue: 0,
          profit: 0,
        };
        curSeller.invoices += 1;

        for (const item of s.items) {
          if (!matchItem(item.name)) continue;
          const netQty = Math.max(0, item.qty - item.ret);
          const itemRev = netQty * item.price;
          const itemProfit = netQty * (item.price - item.cost);

          curSeller.units += netQty;
          curSeller.revenue += itemRev;
          curSeller.profit += itemProfit;

          const pKey = `${s.storeId}__${item.name}`;
          const curProd = prodMap.get(pKey) ?? {
            key: pKey,
            storeId: s.storeId,
            storeName: sName,
            name: item.name,
            qty: 0,
            returned: 0,
            revenue: 0,
            profit: 0,
          };
          curProd.qty += netQty;
          curProd.returned += item.ret;
          curProd.revenue += itemRev;
          curProd.profit += itemProfit;
          prodMap.set(pKey, curProd);
        }

        sellerMap.set(sKey, curSeller);
      }

      return {
        branchRows: branchesToSummarize,
        totals: tot,
        soldProducts: Array.from(prodMap.values()).sort(
          (a, b) => b.revenue - a.revenue || b.qty - a.qty
        ),
        filteredInvoices: invoices,
        sellerRows: Array.from(sellerMap.values()).sort(
          (a, b) => b.revenue - a.revenue || b.profit - a.profit
        ),
        availableSellers: sellersSet,
      };
    }, [db, mode, selectedDay, selectedMonth, branchFilter, sellerFilter, itemQuery]);

  const periodTitle =
    mode === 'daily' ? `تفاصيل مبيع اليوم (${selectedDay})` : `تفاصيل مبيع الشهر (${selectedMonth})`;

  return (
    <Modal
      title={`مراجعة تفاصيل مبيع الفروع — ${periodTitle}`}
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      <div className="space-y-5">
        {/* Mode Switcher + Date/Month Picker + Branch Filter */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setMode('daily')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  mode === 'daily'
                    ? 'bg-[#38608f] text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Clock className="h-3.5 w-3.5" />
                <span>مبيع اليوم</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('monthly')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  mode === 'monthly'
                    ? 'bg-[#38608f] text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                <span>مبيع الشهر</span>
              </button>
            </div>

            {mode === 'daily' ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={selectedDay}
                  onChange={(e) => setSelectedDay(e.target.value)}
                  className="font-num rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                {selectedDay !== dayKey(Date.now()) && (
                  <button
                    type="button"
                    onClick={() => setSelectedDay(dayKey(Date.now()))}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#38608f] hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-[#78a8de] whitespace-nowrap"
                  >
                    اليوم
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="font-num rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                {selectedMonth !== monthKey(Date.now()) && (
                  <button
                    type="button"
                    onClick={() => setSelectedMonth(monthKey(Date.now()))}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#38608f] hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-[#78a8de] whitespace-nowrap"
                  >
                    هذا الشهر
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Branch Filter Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setBranchFilter('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                branchFilter === 'all'
                  ? 'bg-emerald-600 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              كل الفروع
            </button>
            {db.stores.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setBranchFilter(s.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  branchFilter === s.id
                    ? 'bg-emerald-600 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">صافي المبيع</p>
            <p className="font-num mt-1 text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {fmt(totals.netSales)}
            </p>
            <p className="font-num text-[11px] text-slate-400">
              مرتجعات: {fmt(totals.returns)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              عدد الفواتير والقطع
            </p>
            <p className="font-num mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">
              {totals.invoices} فاتورة
            </p>
            <p className="font-num text-[11px] text-slate-400">
              {totals.units} قطعة مباعة
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              المصاريف والرواتب
            </p>
            <p className="font-num mt-1 text-lg font-bold text-amber-700 dark:text-amber-400">
              {fmt(totals.expenses)}
            </p>
            <p className="font-num text-[11px] text-slate-400">
              هامش الربح: {fmt(totals.grossMargin)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">صافي الربح</p>
            <p
              className={`font-num mt-1 text-lg font-bold ${
                totals.netProfit >= 0
                  ? 'text-[#38608f] dark:text-[#78a8de]'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {fmt(totals.netProfit)}
            </p>
            <p className="text-[11px] text-slate-400">
              {branchFilter === 'all' ? 'إجمالي الفروع' : getStoreName(branchFilter)}
            </p>
          </div>
        </div>

        {/* Per-Branch Comparison Table */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            <Store className="h-4 w-4 text-[#38608f] dark:text-[#78a8de]" />
            <h4 className="text-sm font-bold">ملخص كل فرع ({mode === 'daily' ? 'اليوم المحدد' : 'الشهر المحدد'})</h4>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                  <th className="px-3 py-2 text-right font-semibold">الفرع</th>
                  <th className="px-3 py-2 text-center font-semibold">الفواتير</th>
                  <th className="px-3 py-2 text-center font-semibold">القطع</th>
                  <th className="px-3 py-2 text-center font-semibold">صافي المبيع</th>
                  <th className="px-3 py-2 text-center font-semibold">المصاريف</th>
                  <th className="px-3 py-2 text-center font-semibold">صافي الربح</th>
                  <th className="px-3 py-2 text-left font-semibold">تصفية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {branchRows.map((b) => {
                  const active = branchFilter === b.store.id;
                  return (
                    <tr
                      key={b.store.id}
                      className={
                        active
                          ? 'bg-[#38608f]/5 dark:bg-[#38608f]/15'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                      }
                    >
                      <td className="px-3 py-2 font-bold text-slate-900 dark:text-slate-100">
                        {b.store.name}
                      </td>
                      <td className="font-num px-3 py-2 text-center">
                        {b.invoiceCount}
                      </td>
                      <td className="font-num px-3 py-2 text-center">
                        {b.unitsSold}
                      </td>
                      <td className="font-num px-3 py-2 text-center font-bold text-emerald-600 dark:text-emerald-400">
                        {fmt(b.netSales)}
                      </td>
                      <td className="font-num px-3 py-2 text-center text-amber-700 dark:text-amber-400">
                        {fmt(b.expensesTotal)}
                      </td>
                      <td
                        className={`font-num px-3 py-2 text-center font-bold ${
                          b.netProfit >= 0
                            ? 'text-[#38608f] dark:text-[#78a8de]'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {fmt(b.netProfit)}
                      </td>
                      <td className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setBranchFilter(active ? 'all' : b.store.id)
                          }
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-[#38608f] hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-[#78a8de] whitespace-nowrap"
                        >
                          {active ? 'عرض الكل' : 'تفاصيل الفرع'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detailed Breakdown Tabs: Sold Products | Invoices | Sellers */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setDetailTab('products')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  detailTab === 'products'
                    ? 'bg-[#38608f] text-white'
                    : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Package className="h-3.5 w-3.5" />
                <span>المنتجات المباعة ({soldProducts.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('invoices')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  detailTab === 'invoices'
                    ? 'bg-[#38608f] text-white'
                    : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>الفواتير ({filteredInvoices.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('sellers')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  detailTab === 'sellers'
                    ? 'bg-[#38608f] text-white'
                    : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                <span>البائعون ({sellerRows.length})</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={itemQuery}
                  onChange={(e) => setItemQuery(e.target.value)}
                  placeholder="بحث باسم القطعة..."
                  className="w-44 rounded-lg border border-slate-300 bg-white py-1.5 pr-8 pl-3 text-xs text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              {(sellerFilter !== 'all' || itemQuery.trim()) && (
                <button
                  type="button"
                  onClick={() => {
                    setSellerFilter('all');
                    setItemQuery('');
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 whitespace-nowrap"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>إلغاء الفلتر</span>
                </button>
              )}
            </div>
          </div>

          {availableSellers.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5 dark:border-slate-800">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                تصفية حسب الموظف:
              </span>
              <button
                type="button"
                onClick={() => setSellerFilter('all')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                  sellerFilter === 'all'
                    ? 'bg-[#38608f] text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                الكل
              </button>
              {availableSellers.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() =>
                    setSellerFilter((prev) => (prev === name ? 'all' : name))
                  }
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                    sellerFilter === name
                      ? 'bg-[#38608f] text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          {detailTab === 'products' && (
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                    {branchFilter === 'all' && db.stores.length > 1 && (
                      <th className="px-3 py-2 text-right font-semibold">الفرع</th>
                    )}
                    <th className="px-3 py-2 text-right font-semibold">المنتج</th>
                    <th className="px-3 py-2 text-center font-semibold">الكمية المباعة</th>
                    <th className="px-3 py-2 text-center font-semibold">المرتجع</th>
                    <th className="px-3 py-2 text-center font-semibold">إجمالي المبيع</th>
                    <th className="px-3 py-2 text-left font-semibold">الربح</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {soldProducts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={branchFilter === 'all' && db.stores.length > 1 ? 6 : 5}
                        className="px-4 py-6 text-center text-slate-500 dark:text-slate-400"
                      >
                        لا توجد منتجات مباعة في هذه الفترة
                      </td>
                    </tr>
                  ) : (
                    soldProducts.map((p) => (
                      <tr key={p.key}>
                        {branchFilter === 'all' && db.stores.length > 1 && (
                          <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                            {p.storeName}
                          </td>
                        )}
                        <td className="px-3 py-2 font-semibold">{p.name}</td>
                        <td className="font-num px-3 py-2 text-center">{p.qty}</td>
                        <td className="font-num px-3 py-2 text-center text-rose-600 dark:text-rose-400">
                          {p.returned > 0 ? p.returned : '—'}
                        </td>
                        <td className="font-num px-3 py-2 text-center font-bold text-emerald-600 dark:text-emerald-400">
                          {fmt(p.revenue)}
                        </td>
                        <td className="font-num px-3 py-2 text-left font-semibold text-[#38608f] dark:text-[#78a8de]">
                          {fmt(p.profit)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {detailTab === 'invoices' && (
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                    <th className="px-3 py-2 text-right font-semibold">فاتورة</th>
                    {branchFilter === 'all' && db.stores.length > 1 && (
                      <th className="px-3 py-2 text-right font-semibold">الفرع</th>
                    )}
                    <th className="px-3 py-2 text-right font-semibold">البائع</th>
                    <th className="px-3 py-2 text-right font-semibold">البند (الصنف)</th>
                    <th className="px-3 py-2 text-center font-semibold">العدد</th>
                    <th className="px-3 py-2 text-center font-semibold">القيمة</th>
                    <th className="px-3 py-2 text-center font-semibold">الربح</th>
                    <th className="px-3 py-2 text-left font-semibold">الوقت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td
                        colSpan={branchFilter === 'all' && db.stores.length > 1 ? 8 : 7}
                        className="px-4 py-6 text-center text-slate-500 dark:text-slate-400"
                      >
                        لا توجد بنود مبيع مسجلة في هذه الفترة
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.flatMap((s) =>
                      s.items
                        .filter(
                          (item) =>
                            !itemQuery.trim() ||
                            matchesQuery(item.name, itemQuery)
                        )
                        .map((item, idx) => {
                          const netQty = item.qty - item.ret;
                          const netTotal = item.price * netQty;
                          const profit = (item.price - item.cost) * netQty;
                          return (
                            <tr key={`${s.id}-${item.id}-${idx}`}>
                              <td className="font-num px-3 py-2 font-bold">#{s.id}</td>
                              {branchFilter === 'all' && db.stores.length > 1 && (
                                <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                                  {getStoreName(s.storeId)}
                                </td>
                              )}
                              <td className="px-3 py-2 font-medium">{s.emp}</td>
                              <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">
                                {item.name}
                                {item.ret > 0 && (
                                  <span className="font-num mr-1.5 text-rose-600 dark:text-rose-400">
                                    (مرتجع {item.ret})
                                  </span>
                                )}
                              </td>
                              <td className="font-num px-3 py-2 text-center font-semibold">
                                {netQty}
                              </td>
                              <td className="font-num px-3 py-2 text-center font-bold text-emerald-600 dark:text-emerald-400">
                                {fmt(netTotal)}
                              </td>
                              <td className="font-num px-3 py-2 text-center font-semibold text-[#38608f] dark:text-[#78a8de]">
                                {fmt(profit)}
                              </td>
                              <td className="font-num px-3 py-2 text-left text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                {mode === 'daily' ? tm(s.ts) : fullDate(s.ts)}
                              </td>
                            </tr>
                          );
                        })
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}

          {detailTab === 'sellers' && (
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                    {branchFilter === 'all' && db.stores.length > 1 && (
                      <th className="px-3 py-2 text-right font-semibold">الفرع</th>
                    )}
                    <th className="px-3 py-2 text-right font-semibold">البائع / الموظف</th>
                    <th className="px-3 py-2 text-center font-semibold">الفواتير</th>
                    <th className="px-3 py-2 text-center font-semibold">القطع</th>
                    <th className="px-3 py-2 text-center font-semibold">المبيع</th>
                    <th className="px-3 py-2 text-left font-semibold">الربح</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {sellerRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={branchFilter === 'all' && db.stores.length > 1 ? 6 : 5}
                        className="px-4 py-6 text-center text-slate-500 dark:text-slate-400"
                      >
                        لا توجد مبيعات في هذه الفترة
                      </td>
                    </tr>
                  ) : (
                    sellerRows.map((sr) => (
                      <tr key={sr.key}>
                        {branchFilter === 'all' && db.stores.length > 1 && (
                          <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                            {sr.storeName}
                          </td>
                        )}
                        <td className="px-3 py-2 font-bold">{sr.emp}</td>
                        <td className="font-num px-3 py-2 text-center">
                          {sr.invoices}
                        </td>
                        <td className="font-num px-3 py-2 text-center">
                          {sr.units}
                        </td>
                        <td className="font-num px-3 py-2 text-center font-bold text-emerald-600 dark:text-emerald-400">
                          {fmt(sr.revenue)}
                        </td>
                        <td className="font-num px-3 py-2 text-left font-semibold text-[#38608f] dark:text-[#78a8de]">
                          {fmt(sr.profit)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
