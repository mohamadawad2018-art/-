import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CheckCheck,
  Package,
  Search,
  Wallet,
} from 'lucide-react';
import {
  fmt,
  getBranchDailyDrawerMovements,
  getDrawerCarryoverSummary,
  matchesQuery,
  norm,
  tm,
} from '../store';
import type { PosDatabase, User } from '../types';
import { Modal } from './Modals';

interface BranchDrawerLedgerModalProps {
  db: PosDatabase;
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void;
  user: User;
  storeId: number;
  storeName: string;
  notify: (msg: string) => void;
  onClose: () => void;
}

type FeedFilterMode = 'others' | 'all' | 'cash_out' | 'goods_and_debts';

export const BranchDrawerLedgerModal: React.FC<
  BranchDrawerLedgerModalProps
> = ({ db, upd, user, storeId, storeName, notify, onClose }) => {
  const [filterMode, setFilterMode] = useState<FeedFilterMode>('others');
  const [actorFilter, setActorFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

  const feedKey = `${user.id}_${storeId}`;
  const seenAt = db.branchFeedSeenAt?.[feedKey] ?? 0;

  const carryover = getDrawerCarryoverSummary(db, storeId);

  const movements = useMemo(
    () => getBranchDailyDrawerMovements(db, storeId, Date.now()),
    [db, storeId]
  );

  const actors = useMemo(
    () =>
      Array.from(new Set(movements.map((m) => m.actor))).sort((a, b) =>
        a.localeCompare(b, 'ar')
      ),
    [movements]
  );

  const othersUnreadCount = useMemo(
    () =>
      movements.filter(
        (m) => norm(m.actor) !== norm(user.name) && m.ts > seenAt
      ).length,
    [movements, user.name, seenAt]
  );

  const totals = useMemo(() => {
    let cashIn = 0;
    let cashOut = 0;
    let goodsWithdrawnOrDebt = 0;
    for (const m of movements) {
      if (!m.inCurrentShift) continue;
      if (m.cashDelta > 0) cashIn += m.cashDelta;
      else if (m.cashDelta < 0) cashOut += Math.abs(m.cashDelta);
      if (m.goodsValue && (m.kind === 'goods_withdrawal' || m.kind === 'debt_goods')) {
        goodsWithdrawnOrDebt += m.goodsValue;
      }
    }
    return {
      cashIn: Math.round(cashIn * 100) / 100,
      cashOut: Math.round(cashOut * 100) / 100,
      goodsWithdrawnOrDebt: Math.round(goodsWithdrawnOrDebt * 100) / 100,
    };
  }, [movements]);

  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      if (filterMode === 'others' && norm(m.actor) === norm(user.name)) {
        return false;
      }
      if (filterMode === 'cash_out' && m.cashDelta >= 0) {
        return false;
      }
      if (
        filterMode === 'goods_and_debts' &&
        m.kind !== 'goods_withdrawal' &&
        m.kind !== 'debt_goods' &&
        m.kind !== 'debt_cash'
      ) {
        return false;
      }
      if (actorFilter !== 'all' && m.actor !== actorFilter) return false;
      if (
        query.trim() &&
        !matchesQuery(`${m.actor} ${m.title} ${m.details}`, query)
      ) {
        return false;
      }
      return true;
    });
  }, [movements, filterMode, actorFilter, query, user.name]);

  const markAllSeen = () => {
    upd((d) => {
      if (!d.branchFeedSeenAt) d.branchFeedSeenAt = {};
      d.branchFeedSeenAt[feedKey] = Date.now();
      return d;
    });
    notify(`تم تأكيد مراجعة حركات فرع "${storeName}"`);
  };

  return (
    <Modal
      title={`كشف الدرج وحركات الفرع اليومية — ${storeName}`}
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      <div className="space-y-4">
        {/* Reconciliation Formula Strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              الرصيد المرحّل
            </p>
            <p className="font-num mt-1 text-base font-bold text-slate-900 dark:text-slate-100">
              {fmt(carryover.openingCash)}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
            <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              وارد الدرج (+)
            </p>
            <p className="font-num mt-1 text-base font-bold text-emerald-700 dark:text-emerald-300">
              +{fmt(totals.cashIn)}
            </p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 dark:border-rose-900/60 dark:bg-rose-950/30">
            <p className="text-[11px] font-medium text-rose-700 dark:text-rose-300">
              مسحوب ومصاريف (-)
            </p>
            <p className="font-num mt-1 text-base font-bold text-rose-700 dark:text-rose-300">
              -{fmt(totals.cashOut)}
            </p>
          </div>
          <div className="rounded-xl border border-[#38608f]/40 bg-[#38608f]/10 p-3 dark:border-[#6aa0db]/40 dark:bg-[#38608f]/20">
            <p className="text-[11px] font-semibold text-[#38608f] dark:text-[#98c1f0]">
              المتوقع بالدرج الآن
            </p>
            <p className="font-num mt-1 text-base font-bold text-[#38608f] dark:text-white">
              {fmt(carryover.expectedCash)}
            </p>
          </div>
        </div>

        {/* Unread Actions Header + Mark Seen */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-xs">
            <Bell className="h-4 w-4 text-[#38608f] dark:text-[#78a8de]" />
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              تتابع هنا أي مبيعات أو مسحوبات بضاعة أو مصاري أو ديون قام بها المدير أو المالك أو زميل آخر بالفرع لمطابقة الدرج بدقة.
            </span>
          </div>

          {othersUnreadCount > 0 && (
            <button
              type="button"
              onClick={markAllSeen}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap shrink-0"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span>تحديد الكل كمراجع ({othersUnreadCount})</span>
            </button>
          )}
        </div>

        {/* Mode Filters & Employee Quick Buttons */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFilterMode('others')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  filterMode === 'others'
                    ? 'bg-[#38608f] text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                حركات الإدارة والزملاء غيري
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  filterMode === 'all'
                    ? 'bg-[#38608f] text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                كل حركات اليوم ({movements.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('cash_out')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  filterMode === 'cash_out'
                    ? 'bg-rose-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                المسحوب من الدرج (-)
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('goods_and_debts')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  filterMode === 'goods_and_debts'
                    ? 'bg-amber-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                سحب البضاعة والديون
              </button>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="بحث بالصنف أو الشخص..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-48 rounded-lg border border-slate-300 bg-white py-1.5 pr-8 pl-3 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          {actors.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                تصفية حسب الشخص:
              </span>
              <button
                type="button"
                onClick={() => setActorFilter('all')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                  actorFilter === 'all'
                    ? 'bg-emerald-600 text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                الكل
              </button>
              {actors.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setActorFilter(name)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                    actorFilter === name
                      ? 'bg-emerald-600 text-white'
                      : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Movements List */}
        {filteredMovements.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            لا توجد حركات مطابقة لهذا التصنيف اليوم
          </div>
        ) : (
          <div className="max-h-[380px] space-y-2 overflow-y-auto pl-1">
            {filteredMovements.map((m) => {
              const isNew =
                norm(m.actor) !== norm(user.name) && m.ts > seenAt;
              return (
                <div
                  key={m.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-xs ${
                    isNew
                      ? 'border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/25'
                      : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <div className="mt-0.5 shrink-0">
                      {m.cashDelta > 0 ? (
                        <ArrowDownLeft className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      ) : m.cashDelta < 0 ? (
                        <ArrowUpRight className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                      ) : m.kind === 'goods_withdrawal' || m.kind === 'debt_goods' ? (
                        <Package className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <Wallet className="h-4 w-4 text-slate-500" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {m.title}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="font-semibold text-[#38608f] dark:text-[#98c1f0]">
                          {m.actor} ({m.actorRoleLabel})
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="font-num text-slate-500 dark:text-slate-400">
                          {tm(m.ts)}
                        </span>
                        {isNew && (
                          <span className="font-bold text-amber-700 dark:text-amber-300">
                            · جديد
                          </span>
                        )}
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">
                        {m.details}
                      </p>
                    </div>
                  </div>

                  <div className="text-left shrink-0 whitespace-nowrap">
                    {m.cashDelta !== 0 ? (
                      <span
                        className={`font-num text-sm font-bold ${
                          m.cashDelta > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {m.cashDelta > 0
                          ? `+${fmt(m.cashDelta)}`
                          : fmt(m.cashDelta)}
                      </span>
                    ) : (
                      <span className="font-num text-xs font-semibold text-amber-700 dark:text-amber-300">
                        {m.goodsValue ? `بضاعة ${fmt(m.goodsValue)}` : 'بدون أثر نقدي'}
                      </span>
                    )}
                    <p className="text-[10px] text-slate-400">
                      {m.inCurrentShift ? 'ضمن الدرج الحالي' : 'قبل التقفيل'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
};
