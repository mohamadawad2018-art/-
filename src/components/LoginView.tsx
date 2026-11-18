import React, { useEffect, useState } from 'react';
import { Lock, Sun, Moon, RotateCcw, Wallet } from 'lucide-react';
import {
  fmt,
  fullDate,
  getDrawerCarryoverSummary,
  getUserStoreIds,
} from '../store';
import type { PosDatabase, User } from '../types';
import { LiveClockBadge } from './LiveClockBadge';
import { ConnectivitySyncBadge, PWAInstallButton } from './PWAControls';
import type { GoogleSheetsSyncState } from '../services/useGoogleSheetsSync';

interface LoginViewProps {
  db: PosDatabase;
  onLogin: (user: User, storeId: number) => void;
  notify: (msg: string) => void;
  dark: boolean;
  onToggleTheme: () => void;
  onResetSeed: () => void;
  sheetsSync?: GoogleSheetsSyncState;
}

export const LoginView: React.FC<LoginViewProps> = ({
  db,
  onLogin,
  notify,
  dark,
  onToggleTheme,
  onResetSeed,
  sheetsSync,
}) => {
  const [uid, setUid] = useState<string>(() =>
    db.users.length === 1 ? String(db.users[0].id) : ''
  );
  const [storeId, setStoreId] = useState<number>(
    () => db.stores[0]?.id ?? 1
  );
  const [pin, setPin] = useState('');

  const selectedUser = db.users.find((u) => String(u.id) === uid);
  const availableStoreIds = getUserStoreIds(selectedUser, db.stores);
  const availableStores = db.stores.filter((s) =>
    availableStoreIds.includes(s.id)
  );

  useEffect(() => {
    const selected = db.users.find((u) => String(u.id) === uid);
    const allowedIds = getUserStoreIds(selected, db.stores);
    setStoreId((prev) =>
      allowedIds.includes(prev) ? prev : allowedIds[0] ?? db.stores[0]?.id ?? 1
    );
  }, [uid, db.users, db.stores]);

  const carryover = getDrawerCarryoverSummary(db, storeId);
  const activeHolder = db.activeHolders[storeId];
  const storeName =
    db.stores.find((s) => s.id === storeId)?.name ?? 'المحل الرئيسي';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const u = db.users.find((x) => String(x.id) === uid);
    if (!u) {
      notify('اختر الاسم أولاً');
      return;
    }
    const isValid =
      u.pin === pin ||
      db.users.some((m) => m.role === 'manager' && m.pin === pin);
    if (isValid) {
      onLogin(u, storeId);
    } else {
      notify('كلمة السر خاطئة');
      setPin('');
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-between bg-slate-50 px-4 py-8 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">
          نظام إدارة المبيعات
        </span>
        <div className="flex flex-wrap items-center gap-2">
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
            onClick={onToggleTheme}
            aria-label="تبديل المظهر"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="mx-auto my-8 w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-[#38608f]/10 text-[#38608f] dark:bg-[#4f7fb5]/20 dark:text-[#78a8de]">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            تسجيل الدخول
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            اختر حسابك والمحل وأدخل الرقم السري للمتابعة
          </p>
        </div>

        {/* Drawer Carryover & Shift Continuity Notice */}
        {(carryover.lastShift || activeHolder || carryover.expectedCash !== 0) && (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/70">
            <div className="flex items-center justify-between gap-2 font-semibold text-slate-700 dark:text-slate-200">
              <span className="flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5 text-[#38608f] dark:text-[#78a8de]" />
                <span>صندوق {storeName}</span>
              </span>
              <span className="font-num font-bold text-emerald-700 dark:text-emerald-400">
                بالدرج حالياً: {fmt(carryover.expectedCash)}
              </span>
            </div>
            {carryover.lastShift && (
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                مرحّل من إغلاق {carryover.lastShift.emp}:{' '}
                <span className="font-num font-semibold text-slate-700 dark:text-slate-300">
                  {fmt(carryover.openingCash)}
                </span>{' '}
                ({fullDate(carryover.lastShift.ts)})
              </p>
            )}
            {activeHolder && (
              <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {activeHolder.paused
                  ? `الدرج في خروج مؤقت / استراحة باسم: ${activeHolder.userName}`
                  : `الدرج مستلم حالياً باسم: ${activeHolder.userName}`}
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
              المستخدم
            </label>
            <select
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">-- اختر اسمك --</option>
              {db.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} (
                  {u.owner ? 'مالك' : u.role === 'manager' ? 'مدير' : 'موظف'})
                </option>
              ))}
            </select>
          </div>

          {db.stores.length > 1 && availableStores.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                المحل / الفرع
                {availableStores.length > 1 && (
                  <span className="mr-1.5 text-[11px] font-semibold text-[#38608f] dark:text-[#78a8de]">
                    ({availableStores.length} فروع متاحة)
                  </span>
                )}
              </label>
              <select
                value={storeId}
                onChange={(e) => setStoreId(Number(e.target.value))}
                disabled={availableStores.length === 1}
                className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none disabled:bg-slate-100 disabled:text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-900 dark:disabled:text-slate-300"
              >
                {availableStores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
              الرقم السري
            </label>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              className="font-num w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <button
            type="submit"
            className="w-full min-h-[44px] rounded-lg bg-[#38608f] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2d4f77]"
          >
            دخول
          </button>
        </form>

        <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>الرمز الافتراضي للمالك (محمد):</span>
            <span className="font-num font-semibold text-slate-700 dark:text-slate-200">
              0000
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              onResetSeed();
              setUid('1');
            }}
            className="flex w-full min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
            title="تفريغ جميع البيانات والبدء من جديد"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>تصفير جميع البيانات</span>
          </button>
        </div>
      </div>

      <div className="text-center text-xs text-slate-400 dark:text-slate-600">
        الحفظ محلي والأوفلاين مفعل على الجوال · المزامنة التلقائية فور توفر الإنترنت
      </div>
    </div>
  );
};
