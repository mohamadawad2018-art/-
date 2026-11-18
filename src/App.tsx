import { useEffect, useState } from 'react';
import {
  STORAGE_KEY,
  addLog,
  clearSavedSession,
  createSeedData,
  getLowStockProducts,
  loadDatabase,
  loadSavedSession,
  saveSessionRef,
} from './store';
import type { PosDatabase, User } from './types';
import { LoginView } from './components/LoginView';
import { CashierView } from './components/CashierView';
import { ManagerView } from './components/ManagerView';
import { useGoogleSheetsSync } from './services/useGoogleSheetsSync';

export default function App() {
  const [db, setDb] = useState<PosDatabase>(loadDatabase);
  const [session, setSession] = useState<{ user: User; storeId: number } | null>(
    () => loadSavedSession(loadDatabase())
  );
  const [toast, setToast] = useState('');
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      // Ignore storage quota errors
    }
  }, [db]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  // Keep current session user object synchronized if db.users edits occur
  const activeUser = session
    ? db.users.find((u) => u.id === session.user.id) ?? session.user
    : null;

  const upd = (fn: (draft: PosDatabase) => PosDatabase) => {
    setDb((prev) => fn(JSON.parse(JSON.stringify(prev)) as PosDatabase));
  };

  const sheetsSync = useGoogleSheetsSync(db, upd, setToast);

  const handleResetSeed = () => {
    clearSavedSession();
    setSession(null);
    setDb(createSeedData());
    setToast('تم تفريغ جميع البيانات والبدء من جديد');
  };

  const handleLogin = (selected: User, storeId: number) => {
    saveSessionRef(selected.id, storeId);
    setSession({ user: selected, storeId });
    upd((d) => {
      const storeName =
        d.stores.find((s) => s.id === storeId)?.name ?? 'المحل الرئيسي';
      const prevHolder = d.activeHolders[storeId];
      const resumingOwnPause =
        prevHolder && prevHolder.userId === selected.id && prevHolder.paused;

      if (selected.role === 'employee') {
        d.activeHolders[storeId] = {
          storeId,
          userId: selected.id,
          userName: selected.name,
          since: resumingOwnPause ? prevHolder.since : Date.now(),
          paused: false,
          pausedAt: undefined,
        };
      }
      addLog(
        d,
        selected.name,
        resumingOwnPause
          ? `[${storeName}] استئناف الدوام بعد الخروج المؤقت / الاستراحة`
          : `[${storeName}] تسجيل دخول`,
        storeId
      );
      return d;
    });
    if (selected.role === 'manager') {
      const lowCount = getLowStockProducts(db).length;
      const unreadSecurityAlerts = selected.owner
        ? (db.ownerAlerts ?? []).filter((a) => !a.read).length
        : 0;
      const unreadActivity = (db.activityAlerts ?? []).filter((a) => !a.read).length;
      if (unreadSecurityAlerts > 0 && lowCount > 0) {
        setToast(
          `تنبيه: ${unreadSecurityAlerts} إشعار أمني · ${lowCount} منتجات منخفضة المخزون`
        );
      } else if (unreadSecurityAlerts > 0) {
        setToast(`تنبيه للمالك: يوجد ${unreadSecurityAlerts} إشعار أمني جديد`);
      } else if (lowCount > 0) {
        setToast(`تنبيه تلقائي: ${lowCount} منتجات وصلت للحد الأدنى للمخزون`);
      } else if (unreadActivity > 0) {
        setToast(`يوجد ${unreadActivity} إشعار حركة جديدة في لوحة الإشعارات`);
      }
    }
  };

  const handleTemporaryCashierLogout = () => {
    if (!session || !activeUser) return;
    const { storeId } = session;
    upd((d) => {
      const storeName =
        d.stores.find((s) => s.id === storeId)?.name ?? 'المحل الرئيسي';
      const cur = d.activeHolders[storeId];
      d.activeHolders[storeId] = {
        storeId,
        userId: activeUser.id,
        userName: activeUser.name,
        since: cur?.userId === activeUser.id ? cur.since : Date.now(),
        paused: true,
        pausedAt: Date.now(),
      };
      addLog(
        d,
        activeUser.name,
        `[${storeName}] تسجيل خروج مؤقت (استراحة / تبديل مؤقت — الصندوق ما زال مفتوحاً)`,
        storeId
      );
      return d;
    });
    clearSavedSession();
    setSession(null);
    setToast('تم تسجيل الخروج المؤقت — الدوام والصندوق ما زالا محفوظين');
  };

  const handleFinalLogout = (logManagerExit = false) => {
    if (logManagerExit && activeUser && session) {
      upd((d) => {
        addLog(d, activeUser.name, 'تسجيل خروج من لوحة الإدارة', session.storeId);
        return d;
      });
    }
    clearSavedSession();
    setSession(null);
  };

  const handleSwitchCashierStore = (nextStoreId: number) => {
    if (!session || !activeUser) return;
    const prevStoreId = session.storeId;
    saveSessionRef(activeUser.id, nextStoreId);
    setSession({ user: activeUser, storeId: nextStoreId });
    upd((d) => {
      if (d.activeHolders[prevStoreId]?.userId === activeUser.id) {
        delete d.activeHolders[prevStoreId];
      }
      d.activeHolders[nextStoreId] = {
        storeId: nextStoreId,
        userId: activeUser.id,
        userName: activeUser.name,
        since: Date.now(),
        paused: false,
      };
      const nextStoreName =
        d.stores.find((s) => s.id === nextStoreId)?.name ?? 'الفرع';
      addLog(
        d,
        activeUser.name,
        `[${nextStoreName}] انتقال طارئ لاستلام الصندوق`,
        nextStoreId
      );
      return d;
    });
    const nextName =
      db.stores.find((s) => s.id === nextStoreId)?.name ?? 'الفرع';
    setToast(`تم الانتقال إلى فرع "${nextName}"`);
  };

  return (
    <>
      {!session || !activeUser ? (
        <LoginView
          db={db}
          onLogin={handleLogin}
          notify={setToast}
          dark={dark}
          onToggleTheme={() => setDark((v) => !v)}
          onResetSeed={handleResetSeed}
          sheetsSync={sheetsSync}
        />
      ) : activeUser.role === 'manager' ? (
        <ManagerView
          db={db}
          upd={upd}
          user={activeUser}
          initialStoreId={session.storeId}
          onLogout={() => handleFinalLogout(true)}
          notify={setToast}
          dark={dark}
          onToggleTheme={() => setDark((v) => !v)}
          sheetsSync={sheetsSync}
        />
      ) : (
        <CashierView
          db={db}
          upd={upd}
          user={activeUser}
          storeId={session.storeId}
          onSwitchStore={handleSwitchCashierStore}
          onTemporaryLogout={handleTemporaryCashierLogout}
          onLogout={() => handleFinalLogout(false)}
          notify={setToast}
          dark={dark}
          onToggleTheme={() => setDark((v) => !v)}
          sheetsSync={sheetsSync}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
        >
          {toast}
        </div>
      )}
    </>
  );
}
