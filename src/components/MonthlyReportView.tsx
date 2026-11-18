import React, { useMemo, useState } from 'react';
import { Award, Building2, Calendar, ChevronLeft, ChevronRight, PackagePlus, Trash2, Trophy, Users } from 'lucide-react';
import { dayKey, fmt, formatMonthArabic, fullDate, monthKey } from '../store';
import type { BonusRecord, PosDatabase, Sale } from '../types';
import { ShiftsAuditSection } from './ShiftsAuditSection';

interface MonthlyReportViewProps {
  db: PosDatabase;
  selectedStoreId: number | 'all';
  onSendBonus?: (empName: string, storeId?: number) => void;
  onDeleteRent?: (rentId: number) => void;
  allowedStoreIds?: number[];
}

interface DaySummary {
  date: string;
  invoiceCount: number;
  grossSales: number;
  returnsTotal: number;
  netSales: number;
  expensesTotal: number;
  netProfit: number;
  intakeCount: number;
  intakeValue: number;
  sellers: string[];
}

interface StaffDetailedSection {
  emp: string;
  daysWorked: number;
  invoiceCount: number;
  unitsSold: number;
  salesTotal: number;
  grossProfit: number;
  bonusesTotal: number;
  bonuses: BonusRecord[];
  sales: (Sale & { netSaleTotal: number; netSaleProfit: number })[];
}

export const MonthlyReportView: React.FC<MonthlyReportViewProps> = ({
  db,
  selectedStoreId,
  onSendBonus,
  onDeleteRent,
  allowedStoreIds,
}) => {
  const currentMonthStr = monthKey(Date.now());
  const [month, setMonth] = useState<string>(currentMonthStr);
  const todayStr = dayKey(Date.now());

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

  const availableMonths = useMemo(() => {
    const set = new Set<string>([currentMonthStr]);
    const pushTs = (ts: number, sId?: number) => {
      if (sId !== undefined && !matchStore(sId)) {
        return;
      }
      set.add(monthKey(ts));
    };
    db.sales.forEach((s) => pushTs(s.ts, s.storeId));
    db.returns.forEach((r) => pushTs(r.ts, r.storeId));
    db.expenses.forEach((e) => pushTs(e.ts, e.storeId));
    db.salaries.forEach((s) => pushTs(s.ts, s.storeId));
    db.stockIntakes.forEach((i) => pushTs(i.approvedTs ?? i.ts, i.storeId));
    (db.discounts ?? []).forEach((d) => pushTs(d.ts, d.storeId));
    (db.bonuses ?? []).forEach((b) => pushTs(b.ts, b.storeId));
    db.shifts.forEach((sh) => pushTs(sh.ts, sh.storeId));
    (db.stockEntries ?? []).forEach((se) => pushTs(se.ts, se.storeId));
    (db.rents ?? []).forEach((r) => {
      if (matchStore(r.storeId)) {
        set.add(r.month);
      }
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [
    db.sales,
    db.returns,
    db.expenses,
    db.salaries,
    db.stockIntakes,
    db.discounts,
    db.bonuses,
    db.shifts,
    db.stockEntries,
    db.rents,
    selectedStoreId,
    accessibleStoreIds,
    currentMonthStr,
  ]);

  const stepMonth = (delta: number) => {
    const [yStr, mStr] = month.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    if (!y || !m) return;
    const d = new Date(y, m - 1 + delta, 1);
    const nextY = d.getFullYear();
    const nextM = String(d.getMonth() + 1).padStart(2, '0');
    setMonth(`${nextY}-${nextM}`);
  };

  const monthLabelArabic = formatMonthArabic(month);
  const isCurrentMonth = month === currentMonthStr;

  const getStoreName = (id: number) =>
    db.stores.find((s) => s.id === id)?.name ?? 'المحل الرئيسي';

  const { dayRows, staffSections, monthRents, totals } = useMemo(() => {
    const sales = db.sales.filter(
      (s) => matchStore(s.storeId) && monthKey(s.ts) === month
    );
    const returns = db.returns.filter(
      (r) => matchStore(r.storeId) && monthKey(r.ts) === month
    );
    const expenses = db.expenses.filter(
      (e) => matchStore(e.storeId) && monthKey(e.ts) === month
    );
    const salaries = db.salaries.filter(
      (s) =>
        matchStore(s.storeId) &&
        s.status === 'approved' &&
        monthKey(s.ts) === month
    );
    const intakes = db.stockIntakes.filter(
      (i) =>
        matchStore(i.storeId) &&
        i.status === 'approved' &&
        monthKey(i.approvedTs ?? i.ts) === month
    );
    const bonuses = (db.bonuses ?? []).filter(
      (b) => matchStore(b.storeId) && monthKey(b.ts) === month
    );
    const monthRents = (db.rents ?? [])
      .filter((r) => matchStore(r.storeId) && r.month === month)
      .sort((a, b) => b.ts - a.ts);

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

    const staffMap = new Map<
      string,
      {
        days: Set<string>;
        invoiceCount: number;
        unitsSold: number;
        salesTotal: number;
        grossProfit: number;
        sales: (Sale & { netSaleTotal: number; netSaleProfit: number })[];
        bonuses: BonusRecord[];
        bonusesTotal: number;
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

    const ensureStaff = (emp: string) => {
      let entry = staffMap.get(emp);
      if (!entry) {
        entry = {
          days: new Set<string>(),
          invoiceCount: 0,
          unitsSold: 0,
          salesTotal: 0,
          grossProfit: 0,
          sales: [],
          bonuses: [],
          bonusesTotal: 0,
        };
        staffMap.set(emp, entry);
      }
      return entry;
    };

    for (const s of sales) {
      const dKey = dayKey(s.ts);
      const dayEntry = ensureDay(dKey);
      dayEntry.invoiceCount += 1;
      dayEntry.grossSales += s.total;
      dayEntry.sellers.add(s.emp);

      const saleMargin = s.items.reduce(
        (acc, i) => acc + (i.price - i.cost) * (i.qty - i.ret),
        0
      );
      const saleNetTotal = s.items.reduce(
        (acc, i) => acc + i.price * (i.qty - i.ret),
        0
      );
      const saleUnits = s.items.reduce((acc, i) => acc + (i.qty - i.ret), 0);

      dayEntry.grossMargin += saleMargin;

      const st = ensureStaff(s.emp);
      st.days.add(dKey);
      st.invoiceCount += 1;
      st.unitsSold += saleUnits;
      st.salesTotal += saleNetTotal;
      st.grossProfit += saleMargin;
      st.sales.push({
        ...s,
        netSaleTotal: saleNetTotal,
        netSaleProfit: saleMargin,
      });
    }

    for (const r of returns) {
      const dKey = dayKey(r.ts);
      const dayEntry = ensureDay(dKey);
      dayEntry.returnsTotal += r.price * r.qty;
    }

    for (const e of expenses) {
      const dKey = dayKey(e.ts);
      const dayEntry = ensureDay(dKey);
      dayEntry.expensesTotal += e.amount;
    }

    for (const sal of salaries) {
      const dKey = dayKey(sal.ts);
      const dayEntry = ensureDay(dKey);
      dayEntry.expensesTotal += sal.amount;
    }

    for (const intake of intakes) {
      const dKey = dayKey(intake.approvedTs ?? intake.ts);
      const dayEntry = ensureDay(dKey);
      const intakeCost = intake.items.reduce(
        (sum, item) => sum + item.qty * item.cost,
        0
      );
      dayEntry.intakeCount += 1;
      dayEntry.intakeValue += intakeCost;
    }

    for (const bonus of bonuses) {
      const st = ensureStaff(bonus.empName);
      st.bonuses.push(bonus);
      st.bonusesTotal += bonus.amount;
    }

    const days: DaySummary[] = Array.from(dayMap.entries())
      .map(([date, val]) => {
        const netSales = val.grossSales - val.returnsTotal;
        const netProfit = val.grossMargin - val.expensesTotal;
        return {
          date,
          invoiceCount: val.invoiceCount,
          grossSales: val.grossSales,
          returnsTotal: val.returnsTotal,
          netSales,
          expensesTotal: val.expensesTotal,
          netProfit,
          intakeCount: val.intakeCount,
          intakeValue: val.intakeValue,
          sellers: Array.from(val.sellers),
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    const staff: StaffDetailedSection[] = Array.from(staffMap.entries())
      .map(([emp, val]) => ({
        emp,
        daysWorked: val.days.size,
        invoiceCount: val.invoiceCount,
        unitsSold: val.unitsSold,
        salesTotal: val.salesTotal,
        grossProfit: val.grossProfit,
        bonusesTotal: val.bonusesTotal,
        bonuses: val.bonuses.sort((a, b) => b.ts - a.ts),
        sales: val.sales.sort((a, b) => b.ts - a.ts),
      }))
      .sort((a, b) => b.salesTotal - a.salesTotal || b.grossProfit - a.grossProfit);

    const monthGrossSales = days.reduce((a, d) => a + d.grossSales, 0);
    const monthNetSales = days.reduce((a, d) => a + d.netSales, 0);
    const monthGrossProfit = staff.reduce((a, s) => a + s.grossProfit, 0);
    const monthExpenses = days.reduce((a, d) => a + d.expensesTotal, 0);
    const monthRentTotal =
      Math.round(
        monthRents.reduce((a, r) => a + r.localAmount, 0) * 100
      ) / 100;
    const monthNetProfit =
      days.reduce((a, d) => a + d.netProfit, 0) - monthRentTotal;
    const monthInvoices = days.reduce((a, d) => a + d.invoiceCount, 0);
    const monthIntakeCount = days.reduce((a, d) => a + d.intakeCount, 0);
    const monthIntakeValue = days.reduce((a, d) => a + d.intakeValue, 0);

    return {
      dayRows: days,
      staffSections: staff,
      monthRents,
      totals: {
        monthGrossSales,
        monthNetSales,
        monthGrossProfit,
        monthExpenses,
        monthRentTotal,
        monthNetProfit,
        monthInvoices,
        monthIntakeCount,
        monthIntakeValue,
      },
    };
  }, [
    db.sales,
    db.returns,
    db.expenses,
    db.salaries,
    db.stockIntakes,
    db.bonuses,
    db.rents,
    selectedStoreId,
    month,
  ]);

  const topSeller =
    staffSections.find((s) => s.salesTotal > 0) ?? null;

  const storeLabel =
    selectedStoreId === 'all'
      ? 'جميع المحلات'
      : db.stores.find((s) => s.id === selectedStoreId)?.name ?? '';

  return (
    <div className="space-y-6">
      {/* Header & Month Picker + Past Months Archive Switcher */}
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">
                التقرير الشهري لشهر {monthLabelArabic} ({month}) — {storeLabel}
              </h2>
              <span
                className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                  isCurrentMonth
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'bg-[#38608f]/15 text-[#38608f] dark:bg-[#38608f]/30 dark:text-[#98c1f0]'
                }`}
              >
                {isCurrentMonth ? 'الشهر الحالي' : 'أرشيف شهر سابق'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              يتجدد يومياً ويعرض تفاصيل كل يوم، فواتير التوريد الداخلة، وأداء كل موظف لشهر {monthLabelArabic} مع إمكانية تصفح جميع الأشهر السابقة في أي وقت
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
              title="الشهر السابق"
            >
              <ChevronRight className="h-3.5 w-3.5" />
              <span>الشهر السابق</span>
            </button>

            <div className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950">
              <Calendar className="h-4 w-4 text-[#38608f] dark:text-[#78a8de]" />
              <input
                type="month"
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                className="font-num bg-transparent text-sm font-semibold text-slate-900 focus:outline-none dark:text-slate-100"
              />
            </div>

            <button
              type="button"
              onClick={() => stepMonth(1)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
              title="الشهر التالي"
            >
              <span>الشهر التالي</span>
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Recorded Months Quick Switcher */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            الأشهر المسجلة بالنظام:
          </span>
          {availableMonths.map((mKey) => (
            <button
              key={mKey}
              type="button"
              onClick={() => setMonth(mKey)}
              className={`font-num rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                mKey === month
                  ? 'bg-[#38608f] text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {formatMonthArabic(mKey)} ({mKey})
              {mKey === currentMonthStr ? ' · الحالي' : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Month KPI Totals */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            إجمالي مبيعات شهر {monthLabelArabic}
          </p>
          <p className="font-num mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {fmt(totals.monthGrossSales)}
          </p>
          <p className="font-num mt-1 text-xs text-slate-500 dark:text-slate-400">
            الصافي بعد المرتجع: {fmt(totals.monthNetSales)} · {totals.monthInvoices} فاتورة
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            إجمالي الأرباح (قبل المصاريف)
          </p>
          <p className="font-num mt-2 text-2xl font-bold text-[#38608f] dark:text-[#78a8de]">
            {fmt(totals.monthGrossProfit)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            هامش ربح البضاعة المباعة
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            صافي أرباح الشهر
          </p>
          <p
            className={`font-num mt-2 text-2xl font-bold ${
              totals.monthNetProfit >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {fmt(totals.monthNetProfit)}
          </p>
          <p className="font-num mt-1 text-xs text-slate-500 dark:text-slate-400">
            بعد خصم المصاريف والرواتب ({fmt(totals.monthExpenses)})
            {totals.monthRentTotal > 0 &&
              ` وإيجار المحل (${fmt(totals.monthRentTotal)})`}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            فواتير التوريد الداخلة للمحل
          </p>
          <p className="font-num mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
            {fmt(totals.monthIntakeValue)}
          </p>
          <p className="font-num mt-1 text-xs text-slate-500 dark:text-slate-400">
            عدد الفواتير المعتمدة: {fmt(totals.monthIntakeCount)}
          </p>
        </div>
      </div>

      {/* Top Selling Employee Highlight for Rewards */}
      <section className="rounded-xl border border-amber-300 bg-amber-50/60 p-5 dark:border-amber-800/80 dark:bg-amber-950/25">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                أكثر موظف مبيعاً في شهر {monthLabelArabic} ({month}) (مرشح للمكافأة)
              </h3>
              {topSeller ? (
                <div className="mt-1 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                  <p className="text-sm font-bold text-[#38608f] dark:text-[#78a8de]">
                    {topSeller.emp}
                  </p>
                  <p className="font-num">
                    إجمالي المبيعات: <strong>{fmt(topSeller.salesTotal)}</strong> · الأرباح المحققة:{' '}
                    <strong className="text-emerald-700 dark:text-emerald-400">
                      {fmt(topSeller.grossProfit)}
                    </strong>{' '}
                    · {topSeller.invoiceCount} فاتورة ({fmt(topSeller.unitsSold)} قطعة)
                    {totals.monthNetSales > 0 &&
                      ` · نسبة ${Math.round(
                        (topSeller.salesTotal / totals.monthNetSales) * 100
                      )}% من المبيعات`}
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  لم تُسجَّل مبيعات في هذا الشهر بعد لتحديد الأكثر مبيعاً.
                </p>
              )}
            </div>
          </div>

          {topSeller && onSendBonus && (
            <button
              type="button"
              onClick={() =>
                onSendBonus(
                  topSeller.emp,
                  selectedStoreId === 'all' ? undefined : selectedStoreId
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap shrink-0"
            >
              <Award className="h-4 w-4" />
              <span>إرسال مكافأة لـ {topSeller.emp}</span>
            </button>
          )}
        </div>
      </section>

      {/* Overall Staff Summary Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-[#38608f] dark:text-[#78a8de]" />
          <h3 className="text-base font-bold">
            جدول ملخص الموظفين العاملين خلال الشهر وأرباحهم
          </h3>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                <th className="px-3 py-2.5 text-right font-semibold">الترتيب</th>
                <th className="px-3 py-2.5 text-right font-semibold">الموظف</th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  أيام العمل
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  عدد الفواتير
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  القطع المباعة
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  إجمالي المبيعات
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  الأرباح المحققة
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  المكافآت
                </th>
                {onSendBonus && (
                  <th className="px-3 py-2.5 text-left font-semibold">إجراء</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {staffSections.length === 0 ? (
                <tr>
                  <td
                    colSpan={onSendBonus ? 9 : 8}
                    className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    لا توجد مبيعات مسجلة لموظفين في هذا الشهر
                  </td>
                </tr>
              ) : (
                staffSections.map((row, idx) => (
                  <tr
                    key={row.emp}
                    className={
                      idx === 0 && row.salesTotal > 0
                        ? 'bg-amber-50/50 dark:bg-amber-950/20'
                        : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                    }
                  >
                    <td className="font-num px-3 py-2.5 font-bold text-slate-500 dark:text-slate-400">
                      #{idx + 1}
                    </td>
                    <td className="px-3 py-2.5 font-semibold">
                      {row.emp}
                      {idx === 0 && row.salesTotal > 0 && (
                        <span className="mr-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                          الأكثر مبيعاً
                        </span>
                      )}
                    </td>
                    <td className="font-num px-3 py-2.5 text-center">
                      {row.daysWorked}
                    </td>
                    <td className="font-num px-3 py-2.5 text-center">
                      {row.invoiceCount}
                    </td>
                    <td className="font-num px-3 py-2.5 text-center">
                      {fmt(row.unitsSold)}
                    </td>
                    <td className="font-num px-3 py-2.5 text-center font-semibold">
                      {fmt(row.salesTotal)}
                    </td>
                    <td className="font-num px-3 py-2.5 text-center font-bold text-emerald-600 dark:text-emerald-400">
                      {fmt(row.grossProfit)}
                    </td>
                    <td className="font-num px-3 py-2.5 text-center text-[#38608f] dark:text-[#78a8de]">
                      {row.bonusesTotal > 0 ? fmt(row.bonusesTotal) : '—'}
                    </td>
                    {onSendBonus && (
                      <td className="px-3 py-2.5 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            onSendBonus(
                              row.emp,
                              selectedStoreId === 'all'
                                ? undefined
                                : selectedStoreId
                            )
                          }
                          className="inline-flex items-center gap-1 rounded border border-emerald-600/30 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-950 whitespace-nowrap"
                        >
                          <Award className="h-3.5 w-3.5" />
                          <span>مكافأة</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Individual Detailed Table Per Employee */}
      {staffSections.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              الجداول التفصيلية المستقلة لكل موظف ({staffSections.length})
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              جدول خاص بمبيعات وأرباح وفواتير كل موظف على حدة
            </span>
          </div>

          <div className="space-y-4">
            {staffSections.map((sec, idx) => (
              <div
                key={sec.emp}
                className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        سجل الموظف: {sec.emp}
                      </h4>
                      {idx === 0 && sec.salesTotal > 0 && (
                        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                          الأعلى مبيعاً #1
                        </span>
                      )}
                    </div>
                    <div className="font-num mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span>أيام العمل: {sec.daysWorked}</span>
                      <span>الفواتير: {sec.invoiceCount}</span>
                      <span>القطع: {fmt(sec.unitsSold)}</span>
                      <span>
                        إجمالي المبيع:{' '}
                        <strong className="text-slate-800 dark:text-slate-200">
                          {fmt(sec.salesTotal)}
                        </strong>
                      </span>
                      <span>
                        الأرباح:{' '}
                        <strong className="text-emerald-600 dark:text-emerald-400">
                          {fmt(sec.grossProfit)}
                        </strong>
                      </span>
                      {sec.bonusesTotal > 0 && (
                        <span>
                          المكافآت:{' '}
                          <strong className="text-[#38608f] dark:text-[#78a8de]">
                            {fmt(sec.bonusesTotal)}
                          </strong>
                        </span>
                      )}
                    </div>
                  </div>

                  {onSendBonus && (
                    <button
                      type="button"
                      onClick={() =>
                        onSendBonus(
                          sec.emp,
                          selectedStoreId === 'all' ? undefined : selectedStoreId
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#38608f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2d4f77] whitespace-nowrap shrink-0"
                    >
                      <Award className="h-3.5 w-3.5" />
                      <span>إرسال مكافأة</span>
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                        <th className="px-3 py-2 text-right font-semibold">#</th>
                        {selectedStoreId === 'all' && db.stores.length > 1 && (
                          <th className="px-3 py-2 text-right font-semibold">
                            المحل
                          </th>
                        )}
                        <th className="px-3 py-2 text-right font-semibold">
                          البند (الصنف)
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          العدد
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          قيمة البند
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          الربح
                        </th>
                        <th className="px-3 py-2 text-left font-semibold">
                          التاريخ والوقت
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {sec.sales.length === 0 ? (
                        <tr>
                          <td
                            colSpan={
                              selectedStoreId === 'all' && db.stores.length > 1
                                ? 7
                                : 6
                            }
                            className="px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400"
                          >
                            لا توجد مبيعات مسجلة لهذا الموظف في هذا الشهر
                          </td>
                        </tr>
                      ) : (
                        sec.sales.flatMap((s) =>
                          s.items.map((item, idx) => {
                            const netQty = item.qty - item.ret;
                            const lineTotal = item.price * netQty;
                            const lineProfit = (item.price - item.cost) * netQty;
                            return (
                              <tr
                                key={`${s.id}-${item.id}-${idx}`}
                                className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                              >
                                <td className="font-num px-3 py-2 font-semibold">
                                  #{s.id}
                                </td>
                                {selectedStoreId === 'all' &&
                                  db.stores.length > 1 && (
                                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                      {getStoreName(s.storeId)}
                                    </td>
                                  )}
                                <td className="px-3 py-2 font-medium">
                                  {item.name}
                                  {item.ret > 0 && (
                                    <span className="font-num mr-1.5 text-xs text-rose-600 dark:text-rose-400">
                                      (مرتجع {item.ret})
                                    </span>
                                  )}
                                </td>
                                <td className="font-num px-3 py-2 text-center font-semibold">
                                  {netQty}
                                </td>
                                <td className="font-num px-3 py-2 text-center font-semibold">
                                  {fmt(lineTotal)}
                                </td>
                                <td className="font-num px-3 py-2 text-center font-bold text-emerald-600 dark:text-emerald-400">
                                  {fmt(lineProfit)}
                                </td>
                                <td className="font-num px-3 py-2 text-left text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                  {fullDate(s.ts)}
                                </td>
                              </tr>
                            );
                          })
                        )
                      )}
                    </tbody>
                    {sec.sales.length > 0 && (
                      <tfoot>
                        <tr className="border-t border-slate-200 bg-slate-50 text-xs font-bold dark:border-slate-800 dark:bg-slate-800/60">
                          <td
                            colSpan={
                              selectedStoreId === 'all' && db.stores.length > 1
                                ? 4
                                : 3
                            }
                            className="px-3 py-2 text-right"
                          >
                            المجموع الكلي للموظف ({sec.invoiceCount} فاتورة)
                          </td>
                          <td className="font-num px-3 py-2 text-center">
                            {fmt(sec.salesTotal)}
                          </td>
                          <td className="font-num px-3 py-2 text-center text-emerald-600 dark:text-emerald-400">
                            {fmt(sec.grossProfit)}
                          </td>
                          <td className="px-3 py-2" />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                {sec.bonuses.length > 0 && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60">
                    <p className="mb-1.5 font-semibold text-[#38608f] dark:text-[#78a8de]">
                      المكافآت المرسلة لـ {sec.emp} خلال الشهر:
                    </p>
                    <div className="space-y-1">
                      {sec.bonuses.map((b) => (
                        <div
                          key={b.id}
                          className="flex flex-wrap items-center justify-between gap-2 text-slate-600 dark:text-slate-300"
                        >
                          <span>
                            {b.note} (من {b.by})
                          </span>
                          <span className="font-num font-bold text-emerald-600 dark:text-emerald-400">
                            {fmt(b.amount)} · {fullDate(b.ts)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Day-by-Day Breakdown Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-2">
          <PackagePlus className="h-4 w-4 text-[#38608f] dark:text-[#78a8de]" />
          <h3 className="text-base font-bold">
            جدول سجل الأيام — المبيعات والربح والمصاريف وفواتير التوريد الداخلة
          </h3>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                <th className="px-3 py-2.5 text-right font-semibold">اليوم</th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  الموظفون الذين باعوا
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  فواتير البيع
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  مبيعات النهار
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  المصاريف
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  فواتير البضاعة الداخلة
                </th>
                <th className="px-3 py-2.5 text-left font-semibold">
                  صافي الربح
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {dayRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    لا توجد حركات مسجلة في شهر {month}
                  </td>
                </tr>
              ) : (
                dayRows.map((row) => (
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
                    <td className="font-num px-3 py-2.5 text-center">
                      {row.invoiceCount}
                    </td>
                    <td className="font-num px-3 py-2.5 text-center font-semibold">
                      {fmt(row.netSales)}
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

      {/* Store Rents Deducted for this Month */}
      {monthRents.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[#38608f] dark:text-[#78a8de]" />
              <h3 className="text-base font-bold">
                إيجارات الفروع المخصومة من ربح شهر {monthLabelArabic}
              </h3>
            </div>
            <span className="font-num text-sm font-bold text-rose-600 dark:text-rose-400">
              إجمالي الإيجار: {fmt(totals.monthRentTotal)}
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                  <th className="px-3 py-2 text-right font-semibold">الفرع</th>
                  <th className="px-3 py-2 text-center font-semibold">بالدولار ($)</th>
                  <th className="px-3 py-2 text-center font-semibold">سعر الصرف</th>
                  <th className="px-3 py-2 text-center font-semibold">المبلغ المدفوع</th>
                  <th className="px-3 py-2 text-center font-semibold">من الصندوق</th>
                  <th className="px-3 py-2 text-right font-semibold">ملاحظة / المسجّل</th>
                  {onDeleteRent && <th className="px-3 py-2 text-center font-semibold">حذف</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {monthRents.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-semibold">{getStoreName(r.storeId)}</td>
                    <td className="font-num px-3 py-2 text-center">${fmt(r.usdAmount)}</td>
                    <td className="font-num px-3 py-2 text-center">{fmt(r.exchangeRate)}</td>
                    <td className="font-num px-3 py-2 text-center font-bold text-rose-600 dark:text-rose-400">
                      {fmt(r.localAmount)}
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      {r.deductFromCash ? 'نعم' : 'لا'}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                      {r.note ? `${r.note} · ` : ''}{r.by} ({fullDate(r.ts)})
                    </td>
                    {onDeleteRent && (
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => onDeleteRent(r.id)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Monthly Shift Closings & Full Calendar Days */}
      <ShiftsAuditSection
        db={db}
        selectedStoreId={selectedStoreId}
        initialViewMode="monthly"
      />
    </div>
  );
};
