import React, { useMemo, useState } from 'react';
import {
  Bell,
  Check,
  CheckCheck,
  KeyRound,
  Package,
  Search,
  ShieldAlert,
  Tag,
  User as UserIcon,
} from 'lucide-react';
import { fullDate, matchesQuery } from '../store';
import type { ActivityCategory, ActivityNotification, PosDatabase } from '../types';

interface ActivityNotificationsViewProps {
  db: PosDatabase;
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void;
  selectedStoreId: number | 'all';
  allowedStoreIds: number[];
  isOwner?: boolean;
  notify: (msg: string) => void;
}

const CATEGORY_LABELS: Record<'all' | ActivityCategory, string> = {
  all: 'كل الإشعارات',
  stock_edit: 'تعديلات كمية المخزون',
  price_edit: 'تعديلات الأسعار بالمخزون',
  security_pin: 'الأرقام السرية والأمان',
  message: 'الرسائل والبريد الداخلي',
  sale: 'المبيعات والخصومات',
  return: 'المرتجعات',
  intake: 'الفواتير والمخزون',
  withdrawal: 'المسحوبات والمحاسبة',
  debt: 'ديون الزبائن',
  expense: 'المصاريف',
  salary: 'الرواتب والمكافآت',
  branch_rent: 'الفروع والإيجار',
  session: 'الدخول والخروج والدوام',
  system: 'إشعارات النظام',
};

const ROLE_LABELS: Record<'all' | 'employee' | 'manager' | 'owner' | 'system', string> = {
  all: 'جميع الأدوار',
  employee: 'الموظفون',
  manager: 'المدراء',
  owner: 'المالك',
  system: 'النظام',
};

export const ActivityNotificationsView: React.FC<ActivityNotificationsViewProps> = ({
  db,
  upd,
  selectedStoreId,
  allowedStoreIds,
  isOwner = true,
  notify,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<'all' | ActivityCategory>('all');
  const [roleFilter, setRoleFilter] = useState<
    'all' | 'employee' | 'manager' | 'owner' | 'system'
  >('all');
  const [actorFilter, setActorFilter] = useState<string>('all');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [query, setQuery] = useState('');

  const getStoreName = (id?: number) =>
    id !== undefined
      ? db.stores.find((s) => s.id === id)?.name ?? 'فرع غير محدد'
      : 'الإدارة العامة';

  const scopedAlerts = useMemo<ActivityNotification[]>(() => {
    return (db.activityAlerts ?? []).filter((a) => {
      if (a.storeId !== undefined) {
        if (!allowedStoreIds.includes(a.storeId)) return false;
        if (selectedStoreId !== 'all' && a.storeId !== selectedStoreId) return false;
      } else if (
        !isOwner &&
        (a.category === 'security_pin' || a.category === 'stock_edit')
      ) {
        return false;
      }
      return true;
    });
  }, [db.activityAlerts, allowedStoreIds, selectedStoreId, isOwner]);

  const actorsList = useMemo(
    () =>
      Array.from(
        new Set(scopedAlerts.map((a) => a.actor).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b, 'ar')),
    [scopedAlerts]
  );

  const unreadCount = useMemo(
    () => scopedAlerts.filter((a) => !a.read).length,
    [scopedAlerts]
  );
  const stockEditCount = useMemo(
    () => scopedAlerts.filter((a) => a.category === 'stock_edit' && !a.read).length,
    [scopedAlerts]
  );

  const visibleAlerts = useMemo(() => {
    return scopedAlerts.filter((a) => {
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false;
      if (roleFilter !== 'all' && a.actorRole !== roleFilter) return false;
      if (actorFilter !== 'all' && a.actor !== actorFilter) return false;
      if (onlyUnread && a.read) return false;
      if (
        query.trim() &&
        !matchesQuery(`${a.actor} ${a.title} ${a.message} ${getStoreName(a.storeId)}`, query)
      ) {
        return false;
      }
      return true;
    });
  }, [scopedAlerts, categoryFilter, roleFilter, actorFilter, onlyUnread, query]);

  const markAllRead = () => {
    const visibleIds = new Set(visibleAlerts.map((a) => a.id));
    upd((d) => {
      (d.activityAlerts ?? []).forEach((a) => {
        if (visibleIds.has(a.id)) a.read = true;
      });
      return d;
    });
    notify('تم تحديد الإشعارات الظاهرة كمقروءة');
  };

  const markSingleRead = (id: number) => {
    upd((d) => {
      const target = (d.activityAlerts ?? []).find((a) => a.id === id);
      if (target) target.read = true;
      return d;
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
              <Bell className="h-4 w-4 text-[#38608f] dark:text-[#78a8de]" />
              <span>لوحة الإشعارات الشاملة لجميع الحركات</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              توثيق تلقائي لكل ضغطة زر وعملية يقوم بها الموظفون والمدراء، بما في ذلك تعديلات الكميات من المالك
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-num text-xs font-semibold text-slate-600 dark:text-slate-300">
              غير مقروء: {unreadCount}
              {stockEditCount > 0 ? ` · تعديل كميات: ${stockEditCount}` : ''}
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#38608f] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2d4f77] whitespace-nowrap"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span>تحديد الكل كمقروء</span>
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث باسم المستخدم أو العملية..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-9 pl-3 text-xs text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value as 'all' | ActivityCategory)
            }
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>

          <select
            value={roleFilter}
            onChange={(e) =>
              setRoleFilter(
                e.target.value as
                  | 'all'
                  | 'employee'
                  | 'manager'
                  | 'owner'
                  | 'system'
              )
            }
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            {Object.entries(ROLE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>

          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
            <span>غير المقروء فقط</span>
            <input
              type="checkbox"
              checked={onlyUnread}
              onChange={(e) => setOnlyUnread(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#38608f]"
            />
          </label>
        </div>

        {/* Clickable Employee / Actor Filter Buttons */}
        {actorsList.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              تصفية بالاسم:
            </span>
            <button
              type="button"
              onClick={() => setActorFilter('all')}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                actorFilter === 'all'
                  ? 'bg-[#38608f] text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              الكل
            </button>
            {actorsList.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() =>
                  setActorFilter((prev) => (prev === name ? 'all' : name))
                }
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                  actorFilter === name
                    ? 'bg-[#38608f] text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Feed List */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {visibleAlerts.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            لا توجد إشعارات مطابقة للفلاتر المختارة حالياً
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {visibleAlerts.slice(0, 150).map((a) => {
              const isCritical =
                a.category === 'stock_edit' ||
                a.category === 'price_edit' ||
                a.category === 'security_pin' ||
                Boolean(a.important);
              return (
                <div
                  key={a.id}
                  className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 transition-colors ${
                    !a.read
                      ? isCritical
                        ? 'bg-amber-50/80 dark:bg-amber-950/25'
                        : 'bg-slate-50/90 dark:bg-slate-800/35'
                      : ''
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {a.category === 'stock_edit' ? (
                        <Package className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      ) : a.category === 'price_edit' ? (
                        <Tag className="h-3.5 w-3.5 shrink-0 text-[#38608f] dark:text-[#78a8de]" />
                      ) : a.category === 'security_pin' ? (
                        <KeyRound className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                      ) : isCritical ? (
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <UserIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      )}
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        {a.title}
                      </span>
                      <span aria-hidden="true" className="text-slate-400">
                        ·
                      </span>
                      <span className="font-semibold text-[#38608f] dark:text-[#78a8de]">
                        {a.actor} ({ROLE_LABELS[a.actorRole]})
                      </span>
                      <span aria-hidden="true" className="text-slate-400">
                        ·
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {getStoreName(a.storeId)}
                      </span>
                      <span aria-hidden="true" className="text-slate-400">
                        ·
                      </span>
                      <span className="font-num text-[11px] text-slate-500 dark:text-slate-400">
                        {fullDate(a.ts)}
                      </span>
                    </div>

                    <p className="text-sm text-slate-700 dark:text-slate-200">
                      {a.message}
                    </p>
                  </div>

                  <div className="shrink-0">
                    {!a.read ? (
                      <button
                        type="button"
                        onClick={() => markSingleRead(a.id)}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
                      >
                        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>مقروء</span>
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        تمت القراءة
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
