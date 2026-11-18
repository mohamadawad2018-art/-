import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Package,
  Search,
  Wallet,
} from 'lucide-react';
import {
  addLog,
  fmt,
  fullDate,
  getNextMonthKey,
  getWithdrawalWholesaleTotal,
  monthKey,
  norm,
} from '../store';
import type { PosDatabase, User, Withdrawal } from '../types';
import { Modal } from './Modals';

export type StaffWithdrawalFilter = 'unpaid' | 'deferred' | 'paid' | 'all';
export type StaffWithdrawalWhoFilter = 'all' | 'manager' | 'employee';

interface StaffWithdrawalsModalProps {
  db: PosDatabase;
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void;
  user: User;
  allowedStoreIds: number[];
  initialStoreId: number | 'all';
  initialFilter?: StaffWithdrawalFilter;
  initialWhoFilter?: StaffWithdrawalWhoFilter;
  onOpenSalaryForUser?: (targetUser: User) => void;
  onClose: () => void;
  notify: (msg: string) => void;
}

export const StaffWithdrawalsModal: React.FC<StaffWithdrawalsModalProps> = ({
  db,
  upd,
  user,
  allowedStoreIds,
  initialStoreId,
  initialFilter = 'unpaid',
  initialWhoFilter = 'all',
  onOpenSalaryForUser,
  onClose,
  notify,
}) => {
  const [filterStatus, setFilterStatus] = useState<StaffWithdrawalFilter>(
    initialWhoFilter === 'manager' && initialFilter === 'unpaid'
      ? 'all'
      : initialFilter
  );
  const [whoFilter, setWhoFilter] =
    useState<StaffWithdrawalWhoFilter>(initialWhoFilter);
  const [storeFilter, setStoreFilter] = useState<number | 'all'>(initialStoreId);
  const [personFilter, setPersonFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [settlingId, setSettlingId] = useState<number | null>(null);
  const [addToCash, setAddToCash] = useState(true);
  const [settleNote, setSettleNote] = useState('');

  const curMonth = monthKey(Date.now());
  const nextMonth = getNextMonthKey(curMonth);
  const allowedStores = db.stores.filter((s) => allowedStoreIds.includes(s.id));
  const getStoreName = (id: number) =>
    db.stores.find((s) => s.id === id)?.name ?? 'المحل الرئيسي';

  const scopedGoods = useMemo(() => {
    const isEmployeeViewer = !user.owner && user.role === 'employee';
    return db.withdrawals
      .filter((w) => {
        if (w.type !== 'goods' || w.status === 'rejected') return false;
        if (!allowedStoreIds.includes(w.storeId)) return false;
        if (storeFilter !== 'all' && w.storeId !== storeFilter) return false;
        if (isEmployeeViewer && w.whoType !== 'employee') return false;
        if (whoFilter === 'manager' && w.whoType !== 'manager') return false;
        if (whoFilter === 'employee' && w.whoType !== 'employee') return false;
        return true;
      })
      .map((w) => ({
        withdrawal: w,
        wholesaleTotal: getWithdrawalWholesaleTotal(w, db.products),
        takerName: w.takenBy || w.emp,
      }))
      .sort((a, b) => b.withdrawal.ts - a.withdrawal.ts);
  }, [db.withdrawals, db.products, allowedStoreIds, storeFilter, whoFilter, user.owner, user.role]);

  const peopleNames = useMemo(
    () =>
      Array.from(new Set(scopedGoods.map((x) => x.takerName))).sort((a, b) =>
        a.localeCompare(b, 'ar')
      ),
    [scopedGoods]
  );

  const summary = useMemo(() => {
    let totalAll = 0;
    let totalPaid = 0;
    let totalUnpaid = 0;
    let unpaidCount = 0;
    let deferredCount = 0;
    let paidCount = 0;

    for (const row of scopedGoods) {
      totalAll += row.wholesaleTotal;
      if (row.withdrawal.paid) {
        totalPaid += row.withdrawal.paidAmount ?? row.wholesaleTotal;
        paidCount += 1;
      } else {
        totalUnpaid += row.wholesaleTotal;
        if (
          row.withdrawal.deferredToMonth &&
          row.withdrawal.deferredToMonth > curMonth
        ) {
          deferredCount += 1;
        } else {
          unpaidCount += 1;
        }
      }
    }

    return {
      totalAll: Math.round(totalAll * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalUnpaid: Math.round(totalUnpaid * 100) / 100,
      unpaidCount,
      deferredCount,
      paidCount,
    };
  }, [scopedGoods, curMonth]);

  const filteredList = useMemo(() => {
    const q = norm(query);
    return scopedGoods.filter(({ withdrawal, takerName }) => {
      if (personFilter !== 'all' && takerName !== personFilter) return false;

      const isDeferredFuture =
        !withdrawal.paid &&
        Boolean(withdrawal.deferredToMonth && withdrawal.deferredToMonth > curMonth);

      if (filterStatus === 'unpaid') {
        if (withdrawal.paid || isDeferredFuture) return false;
      } else if (filterStatus === 'deferred') {
        if (!isDeferredFuture) return false;
      } else if (filterStatus === 'paid') {
        if (!withdrawal.paid) return false;
      }

      if (!q) return true;
      const inName = norm(takerName).includes(q);
      const inItems = withdrawal.items.some((i) => norm(i.name).includes(q));
      const inNote = norm(withdrawal.note ?? '').includes(q);
      return inName || inItems || inNote || String(withdrawal.id).includes(q);
    });
  }, [scopedGoods, personFilter, filterStatus, query, curMonth]);

  const confirmSettleCash = (
    e: React.FormEvent,
    w: Withdrawal,
    wholesaleTotal: number,
    takerName: string
  ) => {
    e.preventDefault();
    const sName = getStoreName(w.storeId);
    upd((d) => {
      const target = d.withdrawals.find((x) => x.id === w.id);
      if (!target) return d;
      target.paid = true;
      target.paidAmount = wholesaleTotal;
      target.paidAt = Date.now();
      target.paidBy = user.name;
      target.paidToCash = addToCash;
      target.settlementMethod = 'cash';
      target.deferredToMonth = undefined;
      if (settleNote.trim()) {
        target.note = target.note
          ? `${target.note} · ${settleNote.trim()}`
          : settleNote.trim();
      }
      addLog(
        d,
        user.name,
        `[${sName}] محاسبة مسحوبات بضاعة #${w.id} (${takerName}) بسعر الجملة: ${fmt(wholesaleTotal)}${
          addToCash ? ' (أُضيف للصندوق)' : ' (دفع خارجي)'
        }`,
        w.storeId
      );
      return d;
    });
    setSettlingId(null);
    setSettleNote('');
    notify(`تم تسجيل محاسبة مسحوبات ${takerName} (${fmt(wholesaleTotal)}) بنجاح`);
  };

  const handleDeferNextMonth = (w: Withdrawal, takerName: string) => {
    const sName = getStoreName(w.storeId);
    upd((d) => {
      const target = d.withdrawals.find((x) => x.id === w.id);
      if (!target) return d;
      target.deferredToMonth = nextMonth;
      addLog(
        d,
        user.name,
        `[${sName}] تأجيل محاسبة مسحوبات #${w.id} (${takerName}) إلى شهر ${nextMonth}`,
        w.storeId
      );
      return d;
    });
    notify(`تم تأجيل حساب مسحوبات ${takerName} إلى شهر ${nextMonth}`);
  };

  return (
    <Modal
      title="سجل ومحاسبة مسحوبات البضاعة (بسعر الجملة)"
      onClose={onClose}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4">
        {/* KPI Strip */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              إجمالي المسحوبات (جملة)
            </span>
            <p className="font-num mt-1 text-lg font-bold text-[#38608f] dark:text-[#78a8de]">
              {fmt(summary.totalAll)}
            </p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-800/80 dark:bg-emerald-950/30">
            <span className="text-xs text-emerald-700 dark:text-emerald-300">
              محاسب عليه / مخصوم ({summary.paidCount})
            </span>
            <p className="font-num mt-1 text-lg font-bold text-emerald-700 dark:text-emerald-400">
              {fmt(summary.totalPaid)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
            <span className="text-xs text-slate-600 dark:text-slate-300">
              {whoFilter === 'manager' ? 'مسجّل بالقائمة بدون دفع' : 'غير محاسب بعد'} ({summary.unpaidCount + summary.deferredCount})
            </span>
            <p className={`font-num mt-1 text-lg font-bold ${whoFilter === 'manager' ? 'text-[#38608f] dark:text-[#78a8de]' : 'text-rose-700 dark:text-rose-400'}`}>
              {fmt(summary.totalUnpaid)}
            </p>
          </div>
        </div>

        {/* Role Scope Switcher (Managers & Owner exclusive list vs Employee vs All) */}
        {(user.role === 'manager' || user.owner) && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
            {(
              [
                ['manager', 'قائمة المدير والمالك فقط'],
                ['employee', 'الموظفون فقط'],
                ['all', 'الكل (مدراء وموظفون)'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setWhoFilter(k);
                  if (k === 'manager') setFilterStatus('all');
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  whoFilter === k
                    ? 'bg-[#38608f] text-white'
                    : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
            {(
              [
                ['all', `الكل (${scopedGoods.length})`],
                [
                  'unpaid',
                  whoFilter === 'manager'
                    ? `مسجّل فقط (${summary.unpaidCount})`
                    : `غير محاسب عليها (${summary.unpaidCount})`,
                ],
                ['paid', `تم الدفع / محاسب عليها (${summary.paidCount})`],
                ...(whoFilter !== 'manager'
                  ? ([['deferred', `مؤجلة (${summary.deferredCount})`]] as const)
                  : []),
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilterStatus(k)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  filterStatus === k
                    ? 'bg-[#38608f] text-white'
                    : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {allowedStores.length > 1 && (
              <select
                value={storeFilter}
                onChange={(e) =>
                  setStoreFilter(
                    e.target.value === 'all' ? 'all' : Number(e.target.value)
                  )
                }
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                <option value="all">كل الفروع</option>
                {allowedStores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}

            <select
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="all">كل الأشخاص</option>
              {peopleNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>

            <div className="relative">
              <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="بحث بالاسم أو الصنف..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-44 rounded-lg border border-slate-300 bg-white py-1.5 pr-8 pl-3 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>
        </div>

        {/* Withdrawals Cards */}
        {filteredList.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
            لا توجد مسحوبات بضاعة ضمن هذا التصنيف
          </div>
        ) : (
          <div className="space-y-3">
            {filteredList.map(({ withdrawal: w, wholesaleTotal, takerName }) => {
              const isEmp = w.whoType === 'employee';
              const isManagerEntry = !isEmp;
              const takerUser = db.users.find(
                (u) => u.id === w.takenByUserId || norm(u.name) === norm(takerName)
              );
              const isDeferredFuture =
                !w.paid &&
                Boolean(w.deferredToMonth && w.deferredToMonth > curMonth);
              const isSettling = settlingId === w.id;

              return (
                <div
                  key={w.id}
                  className={`rounded-xl border p-4 ${
                    w.paid
                      ? 'border-emerald-200 bg-emerald-50/30 dark:border-emerald-900/50 dark:bg-emerald-950/15'
                      : isManagerEntry
                        ? 'border-indigo-200 bg-indigo-50/30 dark:border-indigo-900/50 dark:bg-indigo-950/15'
                        : isDeferredFuture
                          ? 'border-sky-200 bg-sky-50/30 dark:border-sky-900/50 dark:bg-sky-950/15'
                          : 'border-rose-200 bg-rose-50/30 dark:border-rose-900/50 dark:bg-rose-950/15'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-num text-sm font-bold text-slate-900 dark:text-slate-100">
                          سحب #{w.id} · {takerName}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                            isEmp
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-[#38608f]/15 text-[#38608f] dark:bg-[#38608f]/30 dark:text-[#98c1f0]'
                          }`}
                        >
                          {takerUser?.owner
                            ? 'مالك'
                            : isEmp
                              ? 'موظف'
                              : 'مدير'}
                        </span>
                        <span className="rounded bg-slate-200/80 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {getStoreName(w.storeId)}
                        </span>
                        {w.status === 'pending' && (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                            بانتظار اعتماد المدير
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold ${
                            w.paid
                              ? 'bg-emerald-600 text-white'
                              : isManagerEntry
                                ? 'bg-[#38608f] text-white'
                                : isDeferredFuture
                                  ? 'bg-[#38608f] text-white'
                                  : 'bg-rose-600 text-white'
                          }`}
                        >
                          {w.paid ? (
                            <>
                              <CheckCircle2 className="h-3 w-3" />
                              <span>
                                {w.settlementMethod === 'salary_deduction'
                                  ? 'نعم — مخصوم من الراتب'
                                  : w.settlementMethod === 'return_offset'
                                    ? 'نعم — تمت التسوية بالمرتجع'
                                    : 'تم الدفع والمحاسبة'}
                              </span>
                            </>
                          ) : isManagerEntry ? (
                            <>
                              <Clock className="h-3 w-3" />
                              <span>مسجّل بالقائمة (بدون دفع)</span>
                            </>
                          ) : isDeferredFuture ? (
                            <>
                              <CalendarClock className="h-3 w-3" />
                              <span>مؤجل لشهر {w.deferredToMonth}</span>
                            </>
                          ) : (
                            <>
                              <Clock className="h-3 w-3" />
                              <span>لا — لم يحاسب عليها</span>
                            </>
                          )}
                        </span>
                      </div>

                      <p className="font-num mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {fullDate(w.ts)} · سجّله: {w.emp}
                        {w.note ? ` · ${w.note}` : ''}
                      </p>
                    </div>

                    <div className="text-left">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        بسعر الجملة
                      </span>
                      <p className="font-num text-base font-bold text-[#38608f] dark:text-[#78a8de]">
                        {fmt(wholesaleTotal)}
                      </p>
                    </div>
                  </div>

                  {/* Items list */}
                  <div className="mt-2.5 divide-y divide-slate-200/70 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                    {w.items.map((item, idx) => {
                      const unitCost =
                        item.cost ??
                        db.products.find((p) => p.id === item.id)?.cost ??
                        0;
                      return (
                        <div
                          key={`${item.id}-${idx}`}
                          className="flex items-center justify-between gap-2 py-1"
                        >
                          <span className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
                            <Package className="h-3.5 w-3.5 text-slate-400" />
                            <span>
                              {item.name} × <strong className="font-num">{item.qty}</strong>
                            </span>
                          </span>
                          <span className="font-num text-slate-600 dark:text-slate-300">
                            جملة القطعة {fmt(unitCost)} · الإجمالي{' '}
                            <strong>{fmt(unitCost * item.qty)}</strong>
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {w.paid && w.paidAt && (
                    <p className="font-num mt-2 text-[11px] text-emerald-700 dark:text-emerald-400">
                      حاسبت بتاريخ {fullDate(w.paidAt)} بواسطة {w.paidBy || user.name}
                      {w.paidToCash ? ' (تم إيداع المبلغ بصندوق المحل)' : ''}
                    </p>
                  )}

                  {!w.paid && !isSettling && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSettlingId(w.id);
                          setAddToCash(true);
                          setSettleNote('');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                      >
                        <Wallet className="h-3.5 w-3.5" />
                        <span>دفع / محاسبة الآن ({fmt(wholesaleTotal)})</span>
                      </button>

                      {isManagerEntry && (
                        <span className="text-[11px] font-medium text-[#38608f] dark:text-[#98c1f0]">
                          مسجّل بالقائمة بدون دفع (يمكنك تركه مسجّلاً أو دفعه بأي وقت)
                        </span>
                      )}

                      {isEmp &&
                        user.role === 'manager' &&
                        takerUser &&
                        onOpenSalaryForUser && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenSalaryForUser(takerUser);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200 whitespace-nowrap"
                          >
                            <span>خصم من الراتب</span>
                          </button>
                        )}

                      {isEmp && user.role === 'manager' && !isDeferredFuture && (
                        <button
                          type="button"
                          onClick={() => handleDeferNextMonth(w, takerName)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
                        >
                          <CalendarClock className="h-3.5 w-3.5" />
                          <span>تأجيل للشهر القادم ({nextMonth})</span>
                        </button>
                      )}
                    </div>
                  )}

                  {isSettling && (
                    <form
                      onSubmit={(e) =>
                        confirmSettleCash(e, w, wholesaleTotal, takerName)
                      }
                      className="mt-3 space-y-2.5 rounded-lg border border-emerald-300 bg-white p-3 dark:border-emerald-800 dark:bg-slate-900"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800 dark:text-slate-100">
                          تأكيد محاسبة مسحوبات {takerName}
                        </span>
                        <span className="font-num font-bold text-emerald-600 dark:text-emerald-400">
                          {fmt(wholesaleTotal)}
                        </span>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={addToCash}
                          onChange={(e) => setAddToCash(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                        />
                        <span>إضافة المبلغ المدفوع ({fmt(wholesaleTotal)}) لصندوق الفرع</span>
                      </label>
                      <input
                        placeholder="ملاحظة (اختياري)..."
                        value={settleNote}
                        onChange={(e) => setSettleNote(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                        >
                          نعم، تم الدفع والمحاسبة
                        </button>
                        <button
                          type="button"
                          onClick={() => setSettlingId(null)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
                        >
                          إلغاء
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
};
