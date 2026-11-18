import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  KeyRound,
  Package,
  Search,
  ShieldAlert,
  Tag,
} from 'lucide-react';
import { fullDate, matchesQuery } from '../store';
import type { OwnerAlert, PosDatabase, User } from '../types';
import { Modal } from './Modals';

interface OwnerImportantAlertsModalProps {
  db: PosDatabase;
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void;
  user: User;
  allowedStoreIds: number[];
  initialStoreId: number | 'all';
  notify: (msg: string) => void;
  onClose: () => void;
}

type ImportantKindFilter = 'all' | 'price' | 'stock' | 'pin' | 'critical';

const KIND_LABELS: Record<ImportantKindFilter, string> = {
  all: 'الكل',
  price: 'تعديلات الأسعار',
  stock: 'تعديلات الكميات',
  pin: 'الأرقام السرية والأمان',
  critical: 'تنبيهات حرجة (فروقات / حذف)',
};

export const OwnerImportantAlertsModal: React.FC<
  OwnerImportantAlertsModalProps
> = ({
  db,
  upd,
  user,
  allowedStoreIds,
  initialStoreId,
  notify,
  onClose,
}) => {
  const [kindFilter, setKindFilter] = useState<ImportantKindFilter>('all');
  const [storeFilter, setStoreFilter] = useState<number | 'all'>(initialStoreId);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [query, setQuery] = useState('');

  const getStoreName = (id?: number) =>
    id !== undefined
      ? db.stores.find((s) => s.id === id)?.name ?? 'فرع غير محدد'
      : 'الإدارة العامة';

  const accessibleStores = useMemo(
    () => db.stores.filter((s) => allowedStoreIds.includes(s.id)),
    [db.stores, allowedStoreIds]
  );

  const normalizeKind = (a: OwnerAlert): ImportantKindFilter => {
    if (a.kind === 'price' || a.title.includes('سعر')) return 'price';
    if (a.kind === 'stock' || a.title.includes('كمية')) return 'stock';
    if (a.kind === 'pin' || a.title.includes('سري')) return 'pin';
    return 'critical';
  };

  const scopedAlerts = useMemo(() => {
    return (db.ownerAlerts ?? []).filter((a) => {
      const k = normalizeKind(a);
      if (!user.owner) {
        // Branch managers see price alerts and critical alerts for their branches
        if (k === 'pin' || k === 'stock') return false;
        if (a.storeId !== undefined && !allowedStoreIds.includes(a.storeId)) {
          return false;
        }
      }
      if (storeFilter !== 'all' && a.storeId !== storeFilter) return false;
      return true;
    });
  }, [db.ownerAlerts, user.owner, allowedStoreIds, storeFilter]);

  const unreadCount = useMemo(
    () => scopedAlerts.filter((a) => !a.read).length,
    [scopedAlerts]
  );

  const visibleAlerts = useMemo(() => {
    return scopedAlerts.filter((a) => {
      const k = normalizeKind(a);
      if (kindFilter !== 'all' && k !== kindFilter) return false;
      if (onlyUnread && a.read) return false;
      if (
        query.trim() &&
        !matchesQuery(
          `${a.title} ${a.message} ${a.by} ${getStoreName(a.storeId)}`,
          query
        )
      ) {
        return false;
      }
      return true;
    });
  }, [scopedAlerts, kindFilter, onlyUnread, query]);

  const markSingleRead = (id: number) => {
    upd((d) => {
      const target = (d.ownerAlerts ?? []).find((x) => x.id === id);
      if (target) target.read = true;
      return d;
    });
  };

  const markVisibleRead = () => {
    const ids = new Set(visibleAlerts.map((a) => a.id));
    upd((d) => {
      (d.ownerAlerts ?? []).forEach((a) => {
        if (ids.has(a.id)) a.read = true;
      });
      return d;
    });
    notify('تم تحديد التنبيهات المعروضة كمقروءة');
  };

  const iconForKind = (k: ImportantKindFilter) => {
    switch (k) {
      case 'price':
        return <Tag className="h-4 w-4 text-amber-600 dark:text-amber-400" />;
      case 'stock':
        return <Package className="h-4 w-4 text-sky-600 dark:text-sky-400" />;
      case 'pin':
        return <KeyRound className="h-4 w-4 text-rose-600 dark:text-rose-400" />;
      default:
        return (
          <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
        );
    }
  };

  return (
    <Modal
      title={
        user.owner
          ? 'نافذة مراجعة تنبيهات المالك المهمة (الأسعار والكميات والأمان)'
          : 'نافذة مراجعة تنبيهات تعديل الأسعار بالفرع'
      }
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      <div className="space-y-4">
        {/* Top Summary & Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-xs">
              <p className="font-bold text-slate-900 dark:text-slate-100">
                سجل المراجعة الأمنية وتعديلات الأسعار والمخزون
              </p>
              <p className="font-num text-slate-500 dark:text-slate-400">
                غير مقروء: {unreadCount} · الإجمالي في النطاق: {scopedAlerts.length}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOnlyUnread((v) => !v)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                onlyUnread
                  ? 'border-[#38608f] bg-[#38608f] text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
              }`}
            >
              غير المقروء فقط ({unreadCount})
            </button>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markVisibleRead}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span>تحديد الكل كمقروء</span>
              </button>
            )}
          </div>
        </div>

        {/* Category Filter Tabs + Store Select + Search */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {(Object.keys(KIND_LABELS) as ImportantKindFilter[])
              .filter((k) => user.owner || k === 'all' || k === 'price' || k === 'critical')
              .map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    kindFilter === k
                      ? 'bg-[#38608f] text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {KIND_LABELS[k]}
                </button>
              ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {accessibleStores.length > 1 && (
              <select
                value={storeFilter}
                onChange={(e) =>
                  setStoreFilter(
                    e.target.value === 'all' ? 'all' : Number(e.target.value)
                  )
                }
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                <option value="all">جميع الفروع</option>
                {accessibleStores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}

            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="بحث باسم القطعة، المدير، أو الفرع..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-8 pl-3 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>
        </div>

        {/* Alerts List */}
        {visibleAlerts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            لا توجد تنبيهات مطابقة للتصفية الحالية
          </div>
        ) : (
          <div className="max-h-[420px] space-y-2 overflow-y-auto pl-1">
            {visibleAlerts.map((alert) => {
              const k = normalizeKind(alert);
              return (
                <div
                  key={alert.id}
                  className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3.5 transition-colors ${
                    alert.read
                      ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                      : 'border-amber-300 bg-amber-50/70 dark:border-amber-800/80 dark:bg-amber-950/25'
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <div className="mt-0.5 shrink-0">{iconForKind(k)}</div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {alert.title}
                        </span>
                        <span aria-hidden="true" className="text-slate-400">
                          ·
                        </span>
                        <span className="font-semibold text-[#38608f] dark:text-[#78a8de]">
                          {getStoreName(alert.storeId)}
                        </span>
                        <span aria-hidden="true" className="text-slate-400">
                          ·
                        </span>
                        <span className="text-slate-600 dark:text-slate-300">
                          بواسطة: <strong>{alert.by}</strong>
                        </span>
                        <span aria-hidden="true" className="text-slate-400">
                          ·
                        </span>
                        <span className="font-num text-slate-500 dark:text-slate-400">
                          {fullDate(alert.ts)}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-800 dark:text-slate-200">
                        {alert.message}
                      </p>
                    </div>
                  </div>

                  {!alert.read ? (
                    <button
                      type="button"
                      onClick={() => markSingleRead(alert.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-300 whitespace-nowrap shrink-0"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>تمت المراجعة</span>
                    </button>
                  ) : (
                    <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap shrink-0">
                      مقروء
                    </span>
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
