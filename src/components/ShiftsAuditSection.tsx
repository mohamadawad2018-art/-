import React, { useMemo, useState } from 'react';
import {
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { dayKey, fmt, fullDate, monthKey } from '../store';
import type { PosDatabase, ShiftRecord } from '../types';

interface ShiftsAuditSectionProps {
  db: PosDatabase;
  selectedStoreId: number | 'all';
  initialViewMode?: 'daily' | 'monthly';
}

interface CalendarDaySummary {
  dateStr: string;
  weekdayName: string;
  shifts: ShiftRecord[];
  expectedTotal: number;
  actualTotal: number;
  diffTotal: number;
  employees: string[];
}

export const ShiftsAuditSection: React.FC<ShiftsAuditSectionProps> = ({
  db,
  selectedStoreId,
  initialViewMode = 'daily',
}) => {
  const todayStr = dayKey(Date.now());
  const currentMonthStr = monthKey(Date.now());

  const [viewMode, setViewMode] = useState<'daily' | 'monthly'>(initialViewMode);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [showMonthDays, setShowMonthDays] = useState<boolean>(false);
  const [onlyActiveDays, setOnlyActiveDays] = useState<boolean>(false);

  const getStoreName = (id: number) =>
    db.stores.find((s) => s.id === id)?.name ?? 'المحل الرئيسي';

  const storeShifts = useMemo(
    () =>
      db.shifts
        .filter((s) => selectedStoreId === 'all' || s.storeId === selectedStoreId)
        .slice()
        .sort((a, b) => b.ts - a.ts),
    [db.shifts, selectedStoreId]
  );

  // Shifts for selected day
  const dayShifts = useMemo(
    () => storeShifts.filter((s) => dayKey(s.ts) === selectedDate),
    [storeShifts, selectedDate]
  );

  // Shifts for selected month
  const monthShifts = useMemo(
    () => storeShifts.filter((s) => monthKey(s.ts) === selectedMonth),
    [storeShifts, selectedMonth]
  );

  const activeDaysInMonthSet = useMemo(
    () => new Set(monthShifts.map((s) => dayKey(s.ts))),
    [monthShifts]
  );

  // Summary KPIs
  const dailySummary = useMemo(() => {
    const expectedTotal = dayShifts.reduce((a, s) => a + s.expected, 0);
    const actualTotal = dayShifts.reduce((a, s) => a + s.actual, 0);
    const diffTotal = dayShifts.reduce((a, s) => a + s.diff, 0);
    const matchedCount = dayShifts.filter((s) => s.diff === 0).length;
    return { expectedTotal, actualTotal, diffTotal, matchedCount };
  }, [dayShifts]);

  const monthlySummary = useMemo(() => {
    const expectedTotal = monthShifts.reduce((a, s) => a + s.expected, 0);
    const actualTotal = monthShifts.reduce((a, s) => a + s.actual, 0);
    const diffTotal = monthShifts.reduce((a, s) => a + s.diff, 0);
    const matchedCount = monthShifts.filter((s) => s.diff === 0).length;
    const diffCount = monthShifts.length - matchedCount;
    return {
      expectedTotal,
      actualTotal,
      diffTotal,
      matchedCount,
      diffCount,
      activeDays: activeDaysInMonthSet.size,
    };
  }, [monthShifts, activeDaysInMonthSet]);

  // Monthly employee shift breakdown
  const monthlyByEmployee = useMemo(() => {
    const map = new Map<
      string,
      {
        emp: string;
        count: number;
        matched: number;
        withDiff: number;
        actualTotal: number;
        diffTotal: number;
        lastTs: number;
      }
    >();
    for (const s of monthShifts) {
      const cur = map.get(s.emp) ?? {
        emp: s.emp,
        count: 0,
        matched: 0,
        withDiff: 0,
        actualTotal: 0,
        diffTotal: 0,
        lastTs: 0,
      };
      cur.count += 1;
      if (s.diff === 0) cur.matched += 1;
      else cur.withDiff += 1;
      cur.actualTotal += s.actual;
      cur.diffTotal += s.diff;
      if (s.ts > cur.lastTs) cur.lastTs = s.ts;
      map.set(s.emp, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [monthShifts]);

  // All calendar days of selectedMonth with dates
  const monthCalendarDays = useMemo<CalendarDaySummary[]>(() => {
    const [yStr, mStr] = selectedMonth.split('-');
    const year = Number(yStr);
    const monthNum = Number(mStr);
    if (!year || !monthNum) return [];
    const totalDays = new Date(year, monthNum, 0).getDate();

    const byDay = new Map<string, ShiftRecord[]>();
    for (const s of monthShifts) {
      const dk = dayKey(s.ts);
      const list = byDay.get(dk) ?? [];
      list.push(s);
      byDay.set(dk, list);
    }

    const rows: CalendarDaySummary[] = [];
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${yStr}-${mStr}-${String(d).padStart(2, '0')}`;
      const dt = new Date(year, monthNum - 1, d);
      const weekdayName = dt.toLocaleDateString('ar-SY', { weekday: 'long' });
      const shifts = byDay.get(dateStr) ?? [];
      const expectedTotal = shifts.reduce((a, s) => a + s.expected, 0);
      const actualTotal = shifts.reduce((a, s) => a + s.actual, 0);
      const diffTotal = shifts.reduce((a, s) => a + s.diff, 0);
      const employees = Array.from(new Set(shifts.map((s) => s.emp)));
      rows.push({
        dateStr,
        weekdayName,
        shifts,
        expectedTotal,
        actualTotal,
        diffTotal,
        employees,
      });
    }
    return rows;
  }, [selectedMonth, monthShifts]);

  const visibleCalendarDays = onlyActiveDays
    ? monthCalendarDays.filter((d) => d.shifts.length > 0)
    : monthCalendarDays;

  const activeShifts = viewMode === 'daily' ? dayShifts : monthShifts;
  const showStoreCol = selectedStoreId === 'all' && db.stores.length > 1;

  const handleDateChange = (nextDate: string) => {
    if (!nextDate) return;
    setSelectedDate(nextDate);
    setSelectedMonth(nextDate.slice(0, 7));
  };

  const handleJumpToDay = (dateStr: string) => {
    setSelectedDate(dateStr);
    setSelectedMonth(dateStr.slice(0, 7));
    setViewMode('daily');
  };

  const renderDiffBadge = (diff: number, hasData = true) => {
    if (!hasData) {
      return <span className="text-xs text-slate-400">—</span>;
    }
    if (diff === 0) {
      return (
        <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          <span>مطابق</span>
        </span>
      );
    }
    return (
      <span className="font-num inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-400">
        <AlertCircle className="h-3 w-3" />
        <span>{diff > 0 ? `+${fmt(diff)} زيادة` : `${fmt(diff)} عجز`}</span>
      </span>
    );
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      {/* Header & Mode Controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold">
            جرد الدوامات ({viewMode === 'daily' ? 'اليومي' : 'الشهري'})
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            متابعة إقفالات الصندوق والمطابقة والفروقات يومياً وشهرياً لجميع الفروع والموظفين
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Mode Toggle */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
            <button
              type="button"
              onClick={() => setViewMode('daily')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'daily'
                  ? 'bg-[#38608f] text-white'
                  : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>يومي</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('monthly')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'monthly'
                  ? 'bg-[#38608f] text-white'
                  : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>شهري</span>
            </button>
          </div>

          {viewMode === 'daily' ? (
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="font-num bg-transparent text-xs font-semibold text-slate-800 focus:outline-none dark:text-slate-200"
                />
              </div>
              {selectedDate !== todayStr && (
                <button
                  type="button"
                  onClick={() => handleDateChange(todayStr)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#38608f] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-[#78a8de] dark:hover:bg-slate-700 whitespace-nowrap"
                >
                  اليوم
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) =>
                    e.target.value && setSelectedMonth(e.target.value)
                  }
                  className="font-num bg-transparent text-xs font-semibold text-slate-800 focus:outline-none dark:text-slate-200"
                />
              </div>
              {selectedMonth !== currentMonthStr && (
                <button
                  type="button"
                  onClick={() => setSelectedMonth(currentMonthStr)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#38608f] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-[#78a8de] dark:hover:bg-slate-700 whitespace-nowrap"
                >
                  الشهر الحالي
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      {viewMode === 'daily' ? (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              إقفالات يوم <span className="font-num">{selectedDate}</span>
            </p>
            <p className="font-num mt-1 text-lg font-bold">
              {dayShifts.length}{' '}
              <span className="text-xs font-normal text-slate-500">
                ({dailySummary.matchedCount} مطابق)
              </span>
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              إجمالي المتوقع
            </p>
            <p className="font-num mt-1 text-lg font-bold text-[#38608f] dark:text-[#78a8de]">
              {fmt(dailySummary.expectedTotal)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              إجمالي الفعلي المسلّم
            </p>
            <p className="font-num mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">
              {fmt(dailySummary.actualTotal)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              صافي الفرق اليومي
            </p>
            <p
              className={`font-num mt-1 text-lg font-bold ${
                dailySummary.diffTotal === 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {dayShifts.length === 0
                ? '—'
                : dailySummary.diffTotal === 0
                ? 'مطابق (0)'
                : fmt(dailySummary.diffTotal)}
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              إقفالات شهر <span className="font-num">{selectedMonth}</span>
            </p>
            <p className="font-num mt-1 text-lg font-bold">
              {monthShifts.length}{' '}
              <span className="text-xs font-normal text-slate-500">
                في {monthlySummary.activeDays} يوم
              </span>
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              حالة المطابقة
            </p>
            <p className="font-num mt-1 text-sm font-bold">
              <span className="text-emerald-600 dark:text-emerald-400">
                {monthlySummary.matchedCount} مطابق
              </span>
              {' · '}
              <span
                className={
                  monthlySummary.diffCount > 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-slate-500'
                }
              >
                {monthlySummary.diffCount} بها فرق
              </span>
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              مجموع الفعلي المسلّم بالشهر
            </p>
            <p className="font-num mt-1 text-lg font-bold text-[#38608f] dark:text-[#78a8de]">
              {fmt(monthlySummary.actualTotal)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              صافي الفروقات بالشهر
            </p>
            <p
              className={`font-num mt-1 text-lg font-bold ${
                monthlySummary.diffTotal === 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {monthShifts.length === 0
                ? '—'
                : monthlySummary.diffTotal === 0
                ? 'مطابق (0)'
                : fmt(monthlySummary.diffTotal)}
            </p>
          </div>
        </div>
      )}

      {/* Monthly Employee Shift Summary (only in monthly mode if there are shifts) */}
      {viewMode === 'monthly' && monthlyByEmployee.length > 0 && (
        <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200">
            ملخص جرد الموظفين خلال شهر <span className="font-num">{selectedMonth}</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                <th className="px-3 py-2 text-right font-semibold">الموظف</th>
                <th className="px-3 py-2 text-center font-semibold">عدد الدوامات</th>
                <th className="px-3 py-2 text-center font-semibold">مطابق</th>
                <th className="px-3 py-2 text-center font-semibold">بها فرق</th>
                <th className="px-3 py-2 text-center font-semibold">إجمالي الفعلي</th>
                <th className="px-3 py-2 text-left font-semibold">صافي الفرق</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {monthlyByEmployee.map((row) => (
                <tr key={row.emp}>
                  <td className="px-3 py-2 font-semibold">{row.emp}</td>
                  <td className="font-num px-3 py-2 text-center">{row.count}</td>
                  <td className="font-num px-3 py-2 text-center text-emerald-600 dark:text-emerald-400">
                    {row.matched}
                  </td>
                  <td
                    className={`font-num px-3 py-2 text-center ${
                      row.withDiff > 0
                        ? 'font-bold text-rose-600 dark:text-rose-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {row.withDiff}
                  </td>
                  <td className="font-num px-3 py-2 text-center font-medium">
                    {fmt(row.actualTotal)}
                  </td>
                  <td className="px-3 py-2 text-left">
                    {renderDiffBadge(row.diffTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Primary Shifts List (Daily or Monthly) */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
              {showStoreCol && (
                <th className="px-3 py-2.5 text-right font-semibold">المحل</th>
              )}
              <th className="px-3 py-2.5 text-right font-semibold">الموظف</th>
              <th className="px-3 py-2.5 text-center font-semibold">مرحّل من السابق</th>
              <th className="px-3 py-2.5 text-center font-semibold">المتوقع</th>
              <th className="px-3 py-2.5 text-center font-semibold">الفعلي</th>
              <th className="px-3 py-2.5 text-center font-semibold">الفرق</th>
              <th className="px-3 py-2.5 text-center font-semibold">المحاولات</th>
              <th className="px-3 py-2.5 text-left font-semibold">
                التاريخ والوقت
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {activeShifts.length === 0 ? (
              <tr>
                <td
                  colSpan={showStoreCol ? 8 : 7}
                  className="px-4 py-7 text-center text-sm text-slate-500 dark:text-slate-400"
                >
                  {viewMode === 'daily'
                    ? `لا توجد عمليات جرد دوام مسجلة بتاريخ ${selectedDate}`
                    : `لا توجد عمليات جرد دوام مسجلة في شهر ${selectedMonth}`}
                </td>
              </tr>
            ) : (
              activeShifts.map((s, idx) => (
                <tr
                  key={`${s.ts}-${idx}`}
                  className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  {showStoreCol && (
                    <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {getStoreName(s.storeId)}
                    </td>
                  )}
                  <td className="px-3 py-2.5 font-semibold">{s.emp}</td>
                  <td className="font-num px-3 py-2.5 text-center text-xs text-slate-500 dark:text-slate-400">
                    {typeof s.openingCash === 'number' ? fmt(s.openingCash) : '—'}
                  </td>
                  <td className="font-num px-3 py-2.5 text-center">
                    {fmt(s.expected)}
                  </td>
                  <td className="font-num px-3 py-2.5 text-center font-semibold">
                    {fmt(s.actual)}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {renderDiffBadge(s.diff)}
                  </td>
                  <td className="font-num px-3 py-2.5 text-center text-xs text-slate-500 dark:text-slate-400">
                    {s.tries <= 1 ? 'من أول مرة' : `${s.tries} محاولات`}
                  </td>
                  <td className="font-num px-3 py-2.5 text-left text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {fullDate(s.ts)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Button Underneath: Show All Days of the Month with Dates */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setShowMonthDays((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg border border-[#38608f]/40 bg-[#38608f]/10 px-4 py-2 text-xs font-bold text-[#38608f] transition-colors hover:bg-[#38608f]/20 dark:border-[#78a8de]/40 dark:bg-[#38608f]/25 dark:text-[#98c1f0] dark:hover:bg-[#38608f]/35 whitespace-nowrap"
        >
          <CalendarDays className="h-4 w-4" />
          <span>
            {showMonthDays
              ? `إخفاء جميع أيام شهر ${selectedMonth}`
              : `عرض جميع أيام الشهر بالتواريخ (${selectedMonth})`}
          </span>
          {showMonthDays ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        <span className="font-num text-xs text-slate-500 dark:text-slate-400">
          إجمالي الإقفالات في {selectedMonth}: {monthShifts.length} (في{' '}
          {monthlySummary.activeDays} يوم)
        </span>
      </div>

      {/* Expanded Full Month Days Calendar Table */}
      {showMonthDays && (
        <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                جرد جميع أيام الشهر بالتواريخ
              </h4>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) =>
                  e.target.value && setSelectedMonth(e.target.value)
                }
                className="font-num rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              />
            </div>

            <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-800 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setOnlyActiveDays(false)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                  !onlyActiveDays
                    ? 'bg-[#38608f] text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                كل أيام الشهر ({monthCalendarDays.length})
              </button>
              <button
                type="button"
                onClick={() => setOnlyActiveDays(true)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                  onlyActiveDays
                    ? 'bg-[#38608f] text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                أيام الجرد فقط ({monthlySummary.activeDays})
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                  <th className="px-3 py-2 text-right font-semibold">
                    التاريخ واليوم
                  </th>
                  <th className="px-3 py-2 text-center font-semibold">
                    عدد الإقفالات
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    الموظفون
                  </th>
                  <th className="px-3 py-2 text-center font-semibold">
                    إجمالي المتوقع
                  </th>
                  <th className="px-3 py-2 text-center font-semibold">
                    إجمالي الفعلي
                  </th>
                  <th className="px-3 py-2 text-center font-semibold">
                    صافي الفرق
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {visibleCalendarDays.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      لا توجد أيام فيها عمليات جرد في هذا الشهر
                    </td>
                  </tr>
                ) : (
                  visibleCalendarDays.map((day) => {
                    const hasShifts = day.shifts.length > 0;
                    const isToday = day.dateStr === todayStr;
                    const isSelected =
                      viewMode === 'daily' && day.dateStr === selectedDate;
                    return (
                      <tr
                        key={day.dateStr}
                        className={
                          isSelected
                            ? 'bg-[#38608f]/10 dark:bg-[#38608f]/20'
                            : isToday
                            ? 'bg-emerald-50/50 dark:bg-emerald-950/20'
                            : hasShifts
                            ? 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                            : 'text-slate-400 dark:text-slate-600'
                        }
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="font-num font-semibold text-slate-800 dark:text-slate-200">
                            {day.dateStr}
                          </span>
                          <span className="mr-2 text-xs text-slate-500 dark:text-slate-400">
                            {day.weekdayName}
                          </span>
                          {isToday && (
                            <span className="mr-1.5 rounded bg-[#38608f]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#38608f] dark:text-[#78a8de]">
                              اليوم
                            </span>
                          )}
                        </td>
                        <td className="font-num px-3 py-2 text-center font-semibold">
                          {hasShifts ? day.shifts.length : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {hasShifts ? day.employees.join('، ') : '—'}
                        </td>
                        <td className="font-num px-3 py-2 text-center">
                          {hasShifts ? fmt(day.expectedTotal) : '—'}
                        </td>
                        <td className="font-num px-3 py-2 text-center font-semibold">
                          {hasShifts ? fmt(day.actualTotal) : '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {renderDiffBadge(day.diffTotal, hasShifts)}
                        </td>
                        <td className="px-3 py-2 text-left">
                          {hasShifts ? (
                            <button
                              type="button"
                              onClick={() => handleJumpToDay(day.dateStr)}
                              className="rounded border border-[#38608f]/30 bg-white px-2.5 py-1 text-xs font-semibold text-[#38608f] hover:bg-[#38608f]/10 dark:border-[#78a8de]/30 dark:bg-slate-800 dark:text-[#78a8de] dark:hover:bg-slate-700 whitespace-nowrap"
                            >
                              عرض اليوم
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400">
                              لا يوجد جرد
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
