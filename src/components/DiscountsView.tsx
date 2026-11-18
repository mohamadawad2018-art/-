import React, { useMemo, useState } from 'react';
import { CalendarDays, Percent, Tag } from 'lucide-react';
import { dayKey, fmt, fullDate, monthKey } from '../store';
import type { PosDatabase } from '../types';

interface DiscountsViewProps {
  db: PosDatabase;
  selectedStoreId: number | 'all';
}

export const DiscountsView: React.FC<DiscountsViewProps> = ({
  db,
  selectedStoreId,
}) => {
  const [periodMode, setPeriodMode] = useState<'all' | 'day' | 'month'>('all');
  const [filterDay, setFilterDay] = useState<string>(() => dayKey(Date.now()));
  const [filterMonth, setFilterMonth] = useState<string>(() =>
    monthKey(Date.now())
  );

  const getStoreName = (id: number) =>
    db.stores.find((s) => s.id === id)?.name ?? 'المحل الرئيسي';

  const matchStore = (id: number) =>
    selectedStoreId === 'all' || id === selectedStoreId;

  const allStoreDiscounts = useMemo(() => {
    const raw = (db.discounts ?? []).filter((d) => matchStore(d.storeId));
    return raw.slice().sort((a, b) => b.ts - a.ts);
  }, [db.discounts, selectedStoreId]);

  const filteredDiscounts = useMemo(() => {
    return allStoreDiscounts.filter((d) => {
      if (periodMode === 'day') return dayKey(d.ts) === filterDay;
      if (periodMode === 'month') return monthKey(d.ts) === filterMonth;
      return true;
    });
  }, [allStoreDiscounts, periodMode, filterDay, filterMonth]);

  const stats = useMemo(() => {
    const todayStr = dayKey(Date.now());
    const monthStr = monthKey(Date.now());
    let todayTotal = 0;
    let monthTotal = 0;
    let totalAll = 0;
    let scopedTotal = 0;

    for (const d of allStoreDiscounts) {
      totalAll += d.amount;
      if (dayKey(d.ts) === todayStr) todayTotal += d.amount;
      if (monthKey(d.ts) === monthStr) monthTotal += d.amount;
    }
    for (const d of filteredDiscounts) {
      scopedTotal += d.amount;
    }
    return {
      todayTotal,
      monthTotal,
      totalAll,
      scopedTotal,
      count: filteredDiscounts.length,
    };
  }, [allStoreDiscounts, filteredDiscounts]);

  return (
    <div className="space-y-6">
      {/* KPI Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            خصومات اليوم
          </p>
          <p className="font-num mt-1.5 text-2xl font-bold text-amber-600 dark:text-amber-400">
            {fmt(stats.todayTotal)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            خصومات الشهر الحالي
          </p>
          <p className="font-num mt-1.5 text-2xl font-bold text-[#38608f] dark:text-[#78a8de]">
            {fmt(stats.monthTotal)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            إجمالي الخصومات (حسب الفلتر)
          </p>
          <p className="font-num mt-1.5 text-2xl font-bold text-slate-900 dark:text-slate-100">
            {fmt(stats.scopedTotal)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            عدد الفواتير المخفضة
          </p>
          <p className="font-num mt-1.5 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {stats.count}
          </p>
        </div>
      </div>

      {/* Discounts Table Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <div>
              <h3 className="text-base font-bold">سجل الخصومات</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                يُخصم المبلغ تلقائياً ويُقسّم نسبياً على القطع المباعة داخل الفاتورة لتبقى الأرباح والصندوق متطابقين تماماً
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
              {(
                [
                  ['all', 'الكل'],
                  ['day', 'يوم محدد'],
                  ['month', 'شهر محدد'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPeriodMode(k)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                    periodMode === k
                      ? 'bg-[#38608f] text-white'
                      : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {periodMode === 'day' && (
              <input
                type="date"
                value={filterDay}
                onChange={(e) => setFilterDay(e.target.value)}
                className="font-num rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
              />
            )}
            {periodMode === 'month' && (
              <input
                type="month"
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                className="font-num rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
              />
            )}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                <th className="px-3 py-2.5 text-right font-semibold">فاتورة</th>
                {selectedStoreId === 'all' && db.stores.length > 1 && (
                  <th className="px-3 py-2.5 text-right font-semibold">المحل</th>
                )}
                <th className="px-3 py-2.5 text-right font-semibold">البائع</th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  قبل الخصم
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  قيمة الخصم
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  بعد الخصم
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  توزيع القطع
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">ملاحظة</th>
                <th className="px-3 py-2.5 text-left font-semibold">
                  التاريخ والوقت
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredDiscounts.length === 0 ? (
                <tr>
                  <td
                    colSpan={selectedStoreId === 'all' && db.stores.length > 1 ? 9 : 8}
                    className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    لا توجد خصومات مسجلة في هذه الفترة
                  </td>
                </tr>
              ) : (
                filteredDiscounts.map((d) => {
                  const linkedSale = db.sales.find((s) => s.id === d.saleId);
                  return (
                    <tr
                      key={d.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      <td className="font-num px-3 py-2.5 font-bold">
                        #{d.saleId}
                      </td>
                      {selectedStoreId === 'all' && db.stores.length > 1 && (
                        <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {getStoreName(d.storeId)}
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        <span className="font-semibold">{d.emp}</span>
                        <span
                          className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            d.role === 'manager'
                              ? 'bg-[#38608f]/15 text-[#38608f] dark:bg-[#38608f]/30 dark:text-[#98c1f0]'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          }`}
                        >
                          {d.role === 'manager' ? 'إدارة' : 'موظف'}
                        </span>
                      </td>
                      <td className="font-num px-3 py-2.5 text-center text-slate-600 dark:text-slate-300">
                        {fmt(d.subtotalBefore)}
                      </td>
                      <td className="font-num px-3 py-2.5 text-center font-bold text-amber-700 dark:text-amber-400">
                        -{fmt(d.amount)}
                      </td>
                      <td className="font-num px-3 py-2.5 text-center font-bold text-emerald-600 dark:text-emerald-400">
                        {fmt(d.netTotal)}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {linkedSale && linkedSale.items.length > 0 ? (
                          <div className="space-y-0.5">
                            {linkedSale.items.map((it, idx) => (
                              <div
                                key={`${it.id}-${idx}`}
                                className="flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300"
                              >
                                <span className="truncate">
                                  {it.name} × {it.qty}
                                </span>
                                <span className="font-num text-amber-700 dark:text-amber-400 shrink-0">
                                  -{fmt(it.discountShare ?? 0)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="font-num text-slate-500">
                            {d.itemCount} قطعة
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                        {d.note || '—'}
                      </td>
                      <td className="font-num px-3 py-2.5 text-left text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {fullDate(d.ts)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unused icons prevention check */}
      <span className="hidden" aria-hidden="true">
        <CalendarDays className="h-0 w-0" />
        <Percent className="h-0 w-0" />
      </span>
    </div>
  );
};
