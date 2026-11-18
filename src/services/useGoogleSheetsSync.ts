import { useCallback, useEffect, useRef, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { PENDING_SYNC_KEY, addLog, fmt, norm } from '../store';
import type { PosDatabase, StoreBranch } from '../types';

interface PendingSyncQueue {
  storeIds: number[];
  master: boolean;
  pendingOpsCount: number;
  lastQueuedTs?: number;
}

const loadPendingQueue = (): PendingSyncQueue => {
  try {
    const raw = localStorage.getItem(PENDING_SYNC_KEY);
    if (!raw) return { storeIds: [], master: false, pendingOpsCount: 0 };
    const parsed = JSON.parse(raw) as Partial<PendingSyncQueue>;
    return {
      storeIds: Array.isArray(parsed.storeIds) ? parsed.storeIds : [],
      master: Boolean(parsed.master),
      pendingOpsCount: Math.max(0, Number(parsed.pendingOpsCount) || 0),
      lastQueuedTs: parsed.lastQueuedTs,
    };
  } catch {
    return { storeIds: [], master: false, pendingOpsCount: 0 };
  }
};

const savePendingQueue = (q: PendingSyncQueue) => {
  try {
    localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(q));
  } catch {
    // Ignore storage errors
  }
};
import {
  clearCachedToken,
  getAccessToken,
  getTrustedGoogleEmail,
  googleLogout,
  googleSignIn,
  initGoogleAuth,
  isTokenExpiringSoon,
  setTrustedGoogleEmail,
  trySilentGoogleTokenRefresh,
} from './googleAuth';
import {
  applySheetInventoryToStore,
  createBranchSpreadsheet,
  createMasterSpreadsheet,
  ensureBranchSpreadsheetTabs,
  ensureMasterSpreadsheetTabs,
  GoogleAuthExpiredError,
  pushBranchToGoogleSheet,
  pushMasterToGoogleSheet,
  readBranchInventoryFromSheet,
  type SheetInventoryRow,
} from './sheetsSync';

const computeStoreDataHash = (db: PosDatabase, storeId: number): string => {
  const isMainStore = db.stores[0]?.id === storeId;
  const products = db.products
    .filter((p) => p.storeId === storeId)
    .map((p) => [p.id, p.name, p.price, p.min, p.cost, p.stock, p.minStock ?? 3]);
  const sales = db.sales
    .filter((s) => s.storeId === storeId)
    .map((s) => [s.id, s.total, s.discount ?? 0, s.items.map((i) => [i.id, i.qty, i.ret])]);
  const returns = db.returns
    .filter((r) => r.storeId === storeId)
    .map((r) => [r.ts, r.qty, r.price]);
  const expenses = db.expenses
    .filter((e) => e.storeId === storeId)
    .map((e) => [e.ts, e.desc, e.amount]);
  const salaries = db.salaries
    .filter((s) => s.storeId === storeId)
    .map((s) => [s.id, s.status, s.amount]);
  const discounts = (db.discounts ?? [])
    .filter((d) => d.storeId === storeId)
    .map((d) => [d.id, d.saleId, d.amount, d.ts]);
  const stockIntakes = db.stockIntakes
    .filter((i) => isMainStore || i.storeId === storeId)
    .map((i) => [
      i.id,
      i.storeId,
      i.status,
      i.approvedTs ?? i.ts,
      i.items.length,
      (i.payments ?? []).length,
      (i.payments ?? []).reduce((a, p) => a + p.amount, 0),
    ]);
  const rents = (db.rents ?? [])
    .filter((r) => r.storeId === storeId)
    .map((r) => [r.id, r.month, r.usdAmount, r.exchangeRate, r.localAmount]);
  const stockEntries = (db.stockEntries ?? [])
    .filter((se) => isMainStore || se.storeId === storeId)
    .map((se) => [se.id, se.storeId, se.qty, se.ts]);
  const withdrawals = db.withdrawals
    .filter((w) => w.storeId === storeId)
    .map((w) => [w.id, w.status, w.paid, w.paidAmount ?? 0, w.deferredToMonth ?? '']);
  const customerDebts = (db.customerDebts ?? [])
    .filter((cd) => cd.storeId === storeId)
    .map((cd) => [
      cd.id,
      cd.paid,
      cd.customerPhone ?? '',
      cd.note ?? '',
      cd.payments.length,
      cd.payments.reduce((a, p) => a + p.amount, 0),
    ]);
  const allProductsSignature = isMainStore
    ? db.products.map((p) => [p.id, p.storeId, p.stock, p.cost, p.price])
    : undefined;

  return JSON.stringify({
    products,
    sales,
    returns,
    expenses,
    salaries,
    discounts,
    rents,
    stockIntakes,
    stockEntries,
    withdrawals,
    customerDebts,
    allProductsSignature,
  });
};

const computeMasterDataHash = (db: PosDatabase): string => {
  const stores = db.stores.map((s) => [s.id, s.name]);
  const products = db.products.map((p) => [
    p.id,
    p.storeId,
    p.name,
    p.price,
    p.cost,
    p.stock,
  ]);
  const stockIntakes = db.stockIntakes
    .filter((i) => i.status === 'approved')
    .map((i) => [i.id, i.storeId, i.approvedTs ?? i.ts, i.items.length]);
  const stockEntries = (db.stockEntries ?? []).map((se) => [
    se.id,
    se.storeId,
    se.qty,
    se.ts,
  ]);
  return JSON.stringify({ stores, products, stockIntakes, stockEntries });
};

const snapshotFromProducts = (
  db: PosDatabase,
  storeId: number
): Record<string, SheetInventoryRow> => {
  const map: Record<string, SheetInventoryRow> = {};
  for (const p of db.products) {
    if (p.storeId !== storeId) continue;
    const key = String(p.id);
    map[key] = {
      id: p.id,
      name: p.name,
      price: p.price,
      min: p.min,
      cost: p.cost,
      stock: p.stock,
      minStock: p.minStock ?? 3,
    };
  }
  return map;
};

const rowsEqual = (a: SheetInventoryRow, b: SheetInventoryRow): boolean =>
  a.name.trim() === b.name.trim() &&
  a.price === b.price &&
  a.min === b.min &&
  a.cost === b.cost &&
  a.stock === b.stock &&
  a.minStock === b.minStock;

export interface GoogleSheetsSyncState {
  googleUser: FirebaseUser | null;
  trustedEmail: string | null;
  accessToken: string | null;
  isSigningIn: boolean;
  isSyncing: boolean;
  isOnline: boolean;
  pendingSyncCount: number;
  lastError: string;
  signIn: (forceAccountSelect?: boolean) => Promise<string | null>;
  signOut: () => Promise<void>;
  createAndLinkBranch: (
    storeId: number,
    explicitStore?: StoreBranch
  ) => Promise<boolean>;
  createAllUnlinkedBranches: (storeIds: number[]) => Promise<void>;
  linkExistingBranch: (storeId: number, spreadsheetId: string) => Promise<void>;
  unlinkBranch: (storeId: number) => void;
  toggleAutoSync: (storeId: number, enabled: boolean) => void;
  pushBranchNow: (storeId: number) => Promise<void>;
  pushAllLinkedNow: () => Promise<void>;
  flushPendingNow: () => Promise<void>;
  pullBranchInventoryNow: (
    storeId: number,
    explicitRows?: SheetInventoryRow[]
  ) => Promise<{ addedCount: number; updatedCount: number }>;
  createAndLinkMaster: () => Promise<void>;
  linkExistingMaster: (spreadsheetId: string) => Promise<void>;
  unlinkMaster: () => void;
  toggleMasterAutoSync: (enabled: boolean) => void;
  pushMasterNow: () => Promise<void>;
  setLastError: (msg: string) => void;
}

export const useGoogleSheetsSync = (
  db: PosDatabase,
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void,
  notify: (msg: string) => void
): GoogleSheetsSyncState => {
  const [googleUser, setGoogleUser] = useState<FirebaseUser | null>(null);
  const [trustedEmail, setTrustedEmailState] = useState<string | null>(
    () => db.trustedGoogleEmail || getTrustedGoogleEmail()
  );
  const [accessToken, setAccessToken] = useState<string | null>(getAccessToken);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [pendingQueue, setPendingQueue] =
    useState<PendingSyncQueue>(loadPendingQueue);
  const [lastError, setLastError] = useState('');

  const dbRef = useRef(db);
  dbRef.current = db;
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const trustedEmailRef = useRef(trustedEmail);
  trustedEmailRef.current = trustedEmail;
  const queueRef = useRef(pendingQueue);
  queueRef.current = pendingQueue;

  const updatePendingQueue = useCallback(
    (updater: (prev: PendingSyncQueue) => PendingSyncQueue) => {
      setPendingQueue((prev) => {
        const next = updater(prev);
        savePendingQueue(next);
        return next;
      });
    },
    []
  );

  const lastPushedHashRef = useRef<Record<number, string>>({});
  const lastMasterHashRef = useRef<string>('');
  const lastSheetSnapshotRef = useRef<
    Record<number, Record<string, SheetInventoryRow>>
  >({});
  const syncLockRef = useRef(false);

  const rememberTrustedEmail = useCallback(
    (email?: string | null) => {
      const cleaned = email?.trim();
      if (!cleaned) return;
      setTrustedEmailState(cleaned);
      setTrustedGoogleEmail(cleaned);
      if (dbRef.current.trustedGoogleEmail !== cleaned) {
        upd((d) => {
          d.trustedGoogleEmail = cleaned;
          return d;
        });
      }
    },
    [upd]
  );

  useEffect(() => {
    if (db.trustedGoogleEmail && db.trustedGoogleEmail !== trustedEmail) {
      setTrustedEmailState(db.trustedGoogleEmail);
      setTrustedGoogleEmail(db.trustedGoogleEmail);
    }
  }, [db.trustedGoogleEmail, trustedEmail]);

  const ensureValidToken = useCallback(
    async (forceRefresh = false): Promise<string | null> => {
      if (!forceRefresh && tokenRef.current && !isTokenExpiringSoon()) {
        return tokenRef.current;
      }
      const hint =
        trustedEmailRef.current ||
        dbRef.current.trustedGoogleEmail ||
        googleUser?.email ||
        getTrustedGoogleEmail();
      if (hint) {
        const refreshed = await trySilentGoogleTokenRefresh(hint);
        if (refreshed) {
          tokenRef.current = refreshed;
          setAccessToken(refreshed);
          setLastError('');
          return refreshed;
        }
      }
      return forceRefresh ? null : tokenRef.current;
    },
    [googleUser]
  );

  useEffect(() => {
    const unsub = initGoogleAuth(
      (u, token, email) => {
        setGoogleUser(u);
        tokenRef.current = token;
        setAccessToken(token);
        if (email || u?.email) {
          rememberTrustedEmail(u?.email || email);
        }
      },
      () => {
        setGoogleUser(null);
        // Attempt silent recovery via saved trusted email (e.g., on secondary device/browser)
        const hint = dbRef.current.trustedGoogleEmail || getTrustedGoogleEmail();
        if (hint && navigator.onLine) {
          void trySilentGoogleTokenRefresh(hint).then((tok) => {
            if (tok) {
              tokenRef.current = tok;
              setAccessToken(tok);
            } else {
              tokenRef.current = null;
              setAccessToken(null);
            }
          });
        } else {
          tokenRef.current = null;
          setAccessToken(null);
        }
      }
    );
    return () => unsub();
  }, [rememberTrustedEmail]);

  // Keep Google Sheets OAuth session silently alive every 42 minutes while online
  useEffect(() => {
    if (!isOnline) return;
    const hint = trustedEmail || db.trustedGoogleEmail || googleUser?.email;
    if (!hint) return;

    const timer = setInterval(() => {
      if (navigator.onLine && isTokenExpiringSoon()) {
        void ensureValidToken(true);
      }
    }, 42 * 60 * 1000);

    return () => clearInterval(timer);
  }, [isOnline, trustedEmail, db.trustedGoogleEmail, googleUser, ensureValidToken]);

  const handleApiError = useCallback(
    (err: unknown) => {
      if (err instanceof GoogleAuthExpiredError) {
        clearCachedToken();
        tokenRef.current = null;
        setAccessToken(null);
        setLastError(err.message);
        notify(err.message);
        return;
      }
      const msg =
        err instanceof Error ? err.message : 'حدث خطأ أثناء الاتصال بـ Google Sheets';
      setLastError(msg);
      notify(msg);
    },
    [notify]
  );

  const signIn = useCallback(
    async (forceAccountSelect = false) => {
      setIsSigningIn(true);
      setLastError('');
      try {
        const hint =
          trustedEmailRef.current ||
          dbRef.current.trustedGoogleEmail ||
          getTrustedGoogleEmail();
        const res = await googleSignIn(hint, forceAccountSelect);
        if (res) {
          setGoogleUser(res.user);
          tokenRef.current = res.accessToken;
          setAccessToken(res.accessToken);
          rememberTrustedEmail(res.user.email);
          notify(
            `تم تأكيد وتثبيت حساب المالك: ${res.user.email || res.user.displayName || 'Google'}`
          );
          return res.accessToken;
        }
        return null;
      } catch (err) {
        handleApiError(err);
        return null;
      } finally {
        setIsSigningIn(false);
      }
    },
    [handleApiError, notify, rememberTrustedEmail]
  );

  const signOut = useCallback(async () => {
    await googleLogout();
    setGoogleUser(null);
    setTrustedEmailState(null);
    tokenRef.current = null;
    setAccessToken(null);
    upd((d) => {
      delete d.trustedGoogleEmail;
      return d;
    });
    notify('تم تسجيل الخروج من Google');
  }, [notify, upd]);

  const pushBranchNow = useCallback(
    async (storeId: number, silent = false): Promise<boolean> => {
      const curDb = dbRef.current;
      const link = curDb.sheetsLinks?.[storeId];
      if (!link) return false;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        updatePendingQueue((q) => ({
          storeIds: Array.from(new Set([...q.storeIds, storeId])),
          master: q.master,
          pendingOpsCount: q.pendingOpsCount + 1,
          lastQueuedTs: Date.now(),
        }));
        if (!silent) {
          notify('لا يوجد اتصال بالإنترنت — تم حفظ العملية وستُرفع تلقائياً فور توفر الشبكة');
        }
        return false;
      }

      const token = await ensureValidToken(false);
      if (!token) return false;

      try {
        if (!silent) setIsSyncing(true);
        setLastError('');
        try {
          await pushBranchToGoogleSheet(token, link.spreadsheetId, curDb, storeId);
        } catch (err) {
          if (err instanceof GoogleAuthExpiredError) {
            const refreshed = await ensureValidToken(true);
            if (!refreshed) throw err;
            await pushBranchToGoogleSheet(refreshed, link.spreadsheetId, curDb, storeId);
          } else {
            throw err;
          }
        }
        lastPushedHashRef.current[storeId] = computeStoreDataHash(curDb, storeId);
        lastSheetSnapshotRef.current[storeId] = snapshotFromProducts(curDb, storeId);
        updatePendingQueue((q) => {
          const nextIds = q.storeIds.filter((id) => id !== storeId);
          return {
            storeIds: nextIds,
            master: q.master,
            pendingOpsCount: nextIds.length === 0 && !q.master ? 0 : q.pendingOpsCount,
            lastQueuedTs: q.lastQueuedTs,
          };
        });
        upd((d) => {
          if (!d.sheetsLinks) d.sheetsLinks = {};
          if (d.sheetsLinks[storeId]) {
            d.sheetsLinks[storeId].lastSyncTs = Date.now();
          }
          return d;
        });
        if (!silent) {
          const storeName =
            curDb.stores.find((s) => s.id === storeId)?.name ?? 'الفرع';
          notify(`تمت مزامنة جداول "${storeName}" إلى Google Sheets`);
        }
        return true;
      } catch (err) {
        handleApiError(err);
        return false;
      } finally {
        if (!silent) setIsSyncing(false);
      }
    },
    [ensureValidToken, handleApiError, notify, upd, updatePendingQueue]
  );

  const pushAllLinkedNow = useCallback(async () => {
    const token = tokenRef.current;
    const curDb = dbRef.current;
    if (!token) return;
    const links = curDb.sheetsLinks ?? {};
    const storeIds = curDb.stores
      .map((s) => s.id)
      .filter((id) => Boolean(links[id]?.spreadsheetId));
    if (storeIds.length === 0) return;

    setIsSyncing(true);
    setLastError('');
    try {
      for (const sid of storeIds) {
        await pushBranchNow(sid, true);
      }
      notify(`تمت مزامنة ${storeIds.length} فروع مع Google Sheets`);
    } finally {
      setIsSyncing(false);
    }
  }, [notify, pushBranchNow]);

  const createAndLinkBranch = useCallback(
    async (storeId: number, explicitStore?: StoreBranch): Promise<boolean> => {
      const token = tokenRef.current;
      const curDb = dbRef.current;
      const store =
        explicitStore ?? curDb.stores.find((s) => s.id === storeId);
      if (!token || !store) return false;

      setIsSyncing(true);
      setLastError('');
      try {
        const isMain = curDb.stores[0]?.id === storeId;
        const created = await createBranchSpreadsheet(token, store, isMain);
        await pushBranchToGoogleSheet(token, created.spreadsheetId, curDb, storeId);
        lastPushedHashRef.current[storeId] = computeStoreDataHash(curDb, storeId);
        lastSheetSnapshotRef.current[storeId] = snapshotFromProducts(curDb, storeId);
        upd((d) => {
          if (!d.sheetsLinks) d.sheetsLinks = {};
          d.sheetsLinks[storeId] = {
            spreadsheetId: created.spreadsheetId,
            spreadsheetUrl: created.spreadsheetUrl,
            title: created.title,
            autoSyncEnabled: true,
            lastSyncTs: Date.now(),
          };
          addLog(
            d,
            'النظام',
            `[${store.name}] ربط جدول Google Sheets (${created.title}) وتفعيل المزامنة التلقائية`,
            storeId
          );
          return d;
        });
        notify(`تم إنشاء وربط جدول "${store.name}" بنجاح`);
        return true;
      } catch (err) {
        handleApiError(err);
        return false;
      } finally {
        setIsSyncing(false);
      }
    },
    [handleApiError, notify, upd]
  );

  const createAllUnlinkedBranches = useCallback(
    async (storeIds: number[]) => {
      const token = tokenRef.current;
      const curDb = dbRef.current;
      if (!token || storeIds.length === 0) return;

      setIsSyncing(true);
      setLastError('');
      let createdCount = 0;
      try {
        for (const storeId of storeIds) {
          const store = curDb.stores.find((s) => s.id === storeId);
          if (!store) continue;
          const isMain = curDb.stores[0]?.id === storeId;
          const created = await createBranchSpreadsheet(token, store, isMain);
          await pushBranchToGoogleSheet(token, created.spreadsheetId, curDb, storeId);
          lastPushedHashRef.current[storeId] = computeStoreDataHash(curDb, storeId);
          lastSheetSnapshotRef.current[storeId] = snapshotFromProducts(curDb, storeId);
          upd((d) => {
            if (!d.sheetsLinks) d.sheetsLinks = {};
            d.sheetsLinks[storeId] = {
              spreadsheetId: created.spreadsheetId,
              spreadsheetUrl: created.spreadsheetUrl,
              title: created.title,
              autoSyncEnabled: true,
              lastSyncTs: Date.now(),
            };
            addLog(
              d,
              'النظام',
              `[${store.name}] إنشاء وربط جدول Google Sheets (${created.title}) وتفعيل المزامنة التلقائية`,
              storeId
            );
            return d;
          });
          createdCount += 1;
        }
        if (createdCount > 0) {
          notify(
            `تم إنشاء وربط ${createdCount} جداول في Google Sheets وتفعيل المزامنة التلقائية`
          );
        }
      } catch (err) {
        handleApiError(err);
      } finally {
        setIsSyncing(false);
      }
    },
    [handleApiError, notify, upd]
  );

  const linkExistingBranch = useCallback(
    async (storeId: number, spreadsheetId: string) => {
      const token = tokenRef.current;
      const curDb = dbRef.current;
      const store = curDb.stores.find((s) => s.id === storeId);
      if (!token || !store) return;

      setIsSyncing(true);
      setLastError('');
      try {
        const isMain = curDb.stores[0]?.id === storeId;
        const info = await ensureBranchSpreadsheetTabs(token, spreadsheetId, isMain);
        upd((d) => {
          if (!d.sheetsLinks) d.sheetsLinks = {};
          d.sheetsLinks[storeId] = {
            spreadsheetId: info.spreadsheetId,
            spreadsheetUrl: info.spreadsheetUrl,
            title: info.title,
            autoSyncEnabled: false,
            lastSyncTs: Date.now(),
          };
          addLog(
            d,
            'النظام',
            `[${store.name}] ربط جدول Google Sheets موجود (${info.title})`,
            storeId
          );
          return d;
        });
        notify(`تم ربط الجدول "${info.title}" بفرع ${store.name}`);
      } catch (err) {
        handleApiError(err);
      } finally {
        setIsSyncing(false);
      }
    },
    [handleApiError, notify, upd]
  );

  const unlinkBranch = useCallback(
    (storeId: number) => {
      upd((d) => {
        if (d.sheetsLinks) {
          delete d.sheetsLinks[storeId];
        }
        return d;
      });
      delete lastPushedHashRef.current[storeId];
      delete lastSheetSnapshotRef.current[storeId];
      notify('تم فك ارتباط الجدول');
    },
    [notify, upd]
  );

  const toggleAutoSync = useCallback(
    (storeId: number, enabled: boolean) => {
      const curDb = dbRef.current;
      lastPushedHashRef.current[storeId] = computeStoreDataHash(curDb, storeId);
      lastSheetSnapshotRef.current[storeId] = snapshotFromProducts(curDb, storeId);
      upd((d) => {
        if (d.sheetsLinks?.[storeId]) {
          d.sheetsLinks[storeId].autoSyncEnabled = enabled;
        }
        return d;
      });
      notify(
        enabled
          ? 'تم تفعيل المزامنة التلقائية بالاتجاهين'
          : 'تم إيقاف المزامنة التلقائية'
      );
    },
    [notify, upd]
  );

  const pushMasterNow = useCallback(
    async (silent = false): Promise<boolean> => {
      const curDb = dbRef.current;
      const link = curDb.masterSheetLink;
      if (!link?.spreadsheetId) return false;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        updatePendingQueue((q) => ({
          ...q,
          master: true,
          pendingOpsCount: q.pendingOpsCount + 1,
          lastQueuedTs: Date.now(),
        }));
        return false;
      }

      const token = await ensureValidToken(false);
      if (!token) return false;

      try {
        if (!silent) setIsSyncing(true);
        setLastError('');
        try {
          await pushMasterToGoogleSheet(token, link.spreadsheetId, curDb);
        } catch (err) {
          if (err instanceof GoogleAuthExpiredError) {
            const refreshed = await ensureValidToken(true);
            if (!refreshed) throw err;
            await pushMasterToGoogleSheet(refreshed, link.spreadsheetId, curDb);
          } else {
            throw err;
          }
        }
        lastMasterHashRef.current = computeMasterDataHash(curDb);
        updatePendingQueue((q) => ({
          storeIds: q.storeIds,
          master: false,
          pendingOpsCount: q.storeIds.length === 0 ? 0 : q.pendingOpsCount,
          lastQueuedTs: q.lastQueuedTs,
        }));
        upd((d) => {
          if (d.masterSheetLink) {
            d.masterSheetLink.lastSyncTs = Date.now();
          }
          return d;
        });
        if (!silent) {
          notify('تمت مزامنة شيت إجمالي المخزون ودخول البضاعة مع Google Sheets');
        }
        return true;
      } catch (err) {
        handleApiError(err);
        return false;
      } finally {
        if (!silent) setIsSyncing(false);
      }
    },
    [ensureValidToken, handleApiError, notify, upd, updatePendingQueue]
  );

  const createAndLinkMaster = useCallback(async () => {
    const token = tokenRef.current;
    const curDb = dbRef.current;
    if (!token) return;

    setIsSyncing(true);
    setLastError('');
    try {
      const created = await createMasterSpreadsheet(token);
      await pushMasterToGoogleSheet(token, created.spreadsheetId, curDb);
      lastMasterHashRef.current = computeMasterDataHash(curDb);
      upd((d) => {
        d.masterSheetLink = {
          spreadsheetId: created.spreadsheetId,
          spreadsheetUrl: created.spreadsheetUrl,
          title: created.title,
          autoSyncEnabled: true,
          lastSyncTs: Date.now(),
        };
        addLog(
          d,
          'النظام',
          `إنشاء وربط الشيت الإجمالي للمخزون ودخول البضاعة (${created.title})`
        );
        return d;
      });
      notify('تم إنشاء شيت إجمالي المخزون ودخول البضاعة في Google Sheets');
    } catch (err) {
      handleApiError(err);
    } finally {
      setIsSyncing(false);
    }
  }, [handleApiError, notify, upd]);

  const linkExistingMaster = useCallback(
    async (spreadsheetId: string) => {
      const token = tokenRef.current;
      const curDb = dbRef.current;
      if (!token) return;

      setIsSyncing(true);
      setLastError('');
      try {
        const info = await ensureMasterSpreadsheetTabs(token, spreadsheetId);
        await pushMasterToGoogleSheet(token, info.spreadsheetId, curDb);
        lastMasterHashRef.current = computeMasterDataHash(curDb);
        upd((d) => {
          d.masterSheetLink = {
            spreadsheetId: info.spreadsheetId,
            spreadsheetUrl: info.spreadsheetUrl,
            title: info.title,
            autoSyncEnabled: true,
            lastSyncTs: Date.now(),
          };
          addLog(
            d,
            'النظام',
            `ربط الشيت الإجمالي للمخزون ودخول البضاعة (${info.title})`
          );
          return d;
        });
        notify(`تم ربط ومزامنة "${info.title}"`);
      } catch (err) {
        handleApiError(err);
      } finally {
        setIsSyncing(false);
      }
    },
    [handleApiError, notify, upd]
  );

  const unlinkMaster = useCallback(() => {
    upd((d) => {
      delete d.masterSheetLink;
      return d;
    });
    lastMasterHashRef.current = '';
    notify('تم فك ارتباط شيت إجمالي المخزون');
  }, [notify, upd]);

  const toggleMasterAutoSync = useCallback(
    (enabled: boolean) => {
      lastMasterHashRef.current = computeMasterDataHash(dbRef.current);
      upd((d) => {
        if (d.masterSheetLink) {
          d.masterSheetLink.autoSyncEnabled = enabled;
        }
        return d;
      });
      notify(
        enabled
          ? 'تم تفعيل المزامنة التلقائية لشيت إجمالي المخزون'
          : 'تم إيقاف المزامنة التلقائية لشيت إجمالي المخزون'
      );
    },
    [notify, upd]
  );

  const pullBranchInventoryNow = useCallback(
    async (storeId: number, explicitRows?: SheetInventoryRow[]) => {
      const token = tokenRef.current;
      const curDb = dbRef.current;
      const link = curDb.sheetsLinks?.[storeId];
      if (!explicitRows && (!token || !link)) {
        return { addedCount: 0, updatedCount: 0 };
      }

      setIsSyncing(true);
      setLastError('');
      try {
        const rows =
          explicitRows ??
          (await readBranchInventoryFromSheet(token!, link!.spreadsheetId));
        let summary = { addedCount: 0, updatedCount: 0 };
        let assignedNewIds = false;

        upd((d) => {
          const hadRowWithoutId = rows.some(
            (r) =>
              !r.id ||
              !d.products.some((p) => p.id === r.id && p.storeId === storeId)
          );
          assignedNewIds = hadRowWithoutId;
          summary = applySheetInventoryToStore(d, storeId, rows);
          if (summary.addedCount > 0 || summary.updatedCount > 0) {
            const storeName =
              d.stores.find((s) => s.id === storeId)?.name ?? 'الفرع';
            addLog(
              d,
              'مزامنة Google Sheets',
              `[${storeName}] تحديث المخزون من الجدول (إضافة ${summary.addedCount} · تعديل ${summary.updatedCount})`,
              storeId
            );
          }
          if (d.sheetsLinks?.[storeId]) {
            d.sheetsLinks[storeId].lastSyncTs = Date.now();
          }
          return d;
        });

        // Update snapshot after pull so auto-sync won't bounce back unless new IDs were generated
        setTimeout(() => {
          const latestDb = dbRef.current;
          lastSheetSnapshotRef.current[storeId] = snapshotFromProducts(
            latestDb,
            storeId
          );
          if (!assignedNewIds) {
            lastPushedHashRef.current[storeId] = computeStoreDataHash(
              latestDb,
              storeId
            );
          }
        }, 50);

        return summary;
      } catch (err) {
        handleApiError(err);
        return { addedCount: 0, updatedCount: 0 };
      } finally {
        setIsSyncing(false);
      }
    },
    [handleApiError, upd]
  );

  const flushPendingNow = useCallback(
    async (silent = false) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (syncLockRef.current) return;

      const token = await ensureValidToken(false);
      if (!token) return;

      const curDb = dbRef.current;
      const curQueue = queueRef.current;
      const links = curDb.sheetsLinks ?? {};

      const autoStores = curDb.stores.filter(
        (s) => links[s.id]?.spreadsheetId && links[s.id]?.autoSyncEnabled
      );
      const changedStoreIds = autoStores
        .filter((s) => lastPushedHashRef.current[s.id] !== computeStoreDataHash(curDb, s.id))
        .map((s) => s.id);

      const targetStoreIds = Array.from(
        new Set([
          ...curQueue.storeIds.filter((id) => Boolean(links[id]?.spreadsheetId)),
          ...changedStoreIds,
        ])
      );

      const masterLinked = Boolean(curDb.masterSheetLink?.spreadsheetId);
      const masterChanged =
        masterLinked &&
        Boolean(curDb.masterSheetLink?.autoSyncEnabled) &&
        lastMasterHashRef.current !== computeMasterDataHash(curDb);
      const shouldPushMaster = masterLinked && (curQueue.master || masterChanged);

      if (targetStoreIds.length === 0 && !shouldPushMaster) return;

      syncLockRef.current = true;
      setIsSyncing(true);
      try {
        const tasks: Promise<boolean>[] = targetStoreIds.map((sid) =>
          pushBranchNow(sid, true)
        );
        if (shouldPushMaster) {
          tasks.push(pushMasterNow(true));
        }
        const results = await Promise.allSettled(tasks);
        const anySucceeded = results.some(
          (r) => r.status === 'fulfilled' && r.value === true
        );
        if (anySucceeded && !silent) {
          notify('تم نقل ومزامنة البيانات المعلقة إلى Google Sheets بنجاح');
        }
      } finally {
        syncLockRef.current = false;
        setIsSyncing(false);
      }
    },
    [ensureValidToken, notify, pushBranchNow, pushMasterNow]
  );

  // Track online/offline status and immediately refresh token + flush pending queue on reconnect
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setTimeout(() => {
        void (async () => {
          await ensureValidToken(false);
          await flushPendingNow(false);
        })();
      }, 250);
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void (async () => {
          await ensureValidToken(false);
          await flushPendingNow(true);
        })();
      }
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [ensureValidToken, flushPendingNow]);

  // 1. Track local changes into offline-resilient queue & push quickly (550ms) when online
  const prevSnapshotHashRef = useRef<Record<number, string>>({});
  const prevMasterLocalHashRef = useRef<string>('');
  useEffect(() => {
    const links = db.sheetsLinks ?? {};
    const autoStores = db.stores.filter(
      (s) => links[s.id]?.spreadsheetId && links[s.id]?.autoSyncEnabled
    );
    const masterAuto =
      Boolean(db.masterSheetLink?.spreadsheetId) &&
      Boolean(db.masterSheetLink?.autoSyncEnabled);

    const newlyModifiedStores: number[] = [];
    for (const s of autoStores) {
      const nextHash = computeStoreDataHash(db, s.id);
      if (
        prevSnapshotHashRef.current[s.id] !== undefined &&
        prevSnapshotHashRef.current[s.id] !== nextHash
      ) {
        newlyModifiedStores.push(s.id);
      }
      prevSnapshotHashRef.current[s.id] = nextHash;
    }

    const nextMasterHash = computeMasterDataHash(db);
    const newlyModifiedMaster =
      masterAuto &&
      prevMasterLocalHashRef.current !== '' &&
      prevMasterLocalHashRef.current !== nextMasterHash;
    prevMasterLocalHashRef.current = nextMasterHash;

    if (newlyModifiedStores.length > 0 || newlyModifiedMaster) {
      updatePendingQueue((q) => ({
        storeIds: Array.from(new Set([...q.storeIds, ...newlyModifiedStores])),
        master: q.master || newlyModifiedMaster,
        pendingOpsCount: q.pendingOpsCount + 1,
        lastQueuedTs: Date.now(),
      }));
    }

    if (!accessToken || !isOnline) return;

    const changedStores = autoStores.filter((s) => {
      const nextHash = computeStoreDataHash(db, s.id);
      return lastPushedHashRef.current[s.id] !== nextHash;
    });
    const masterChanged =
      masterAuto && lastMasterHashRef.current !== nextMasterHash;

    if (
      changedStores.length === 0 &&
      !masterChanged &&
      queueRef.current.storeIds.length === 0 &&
      !queueRef.current.master
    ) {
      return;
    }

    const timer = setTimeout(() => {
      void flushPendingNow(true);
    }, 550);

    return () => clearTimeout(timer);
  }, [db, accessToken, isOnline, flushPendingNow, updatePendingQueue]);

  // 2. Automatic Google Sheets -> App Inventory Pull (every 18s when online) for 2-way sync
  useEffect(() => {
    if (!accessToken || !isOnline) return;
    const links = db.sheetsLinks ?? {};
    const hasAnyAuto = db.stores.some(
      (s) => links[s.id]?.spreadsheetId && links[s.id]?.autoSyncEnabled
    );
    if (!hasAnyAuto) return;

    const interval = setInterval(async () => {
      if (syncLockRef.current || !tokenRef.current || !navigator.onLine) return;
      const curDb = dbRef.current;
      const curLinks = curDb.sheetsLinks ?? {};
      const autoStores = curDb.stores.filter(
        (s) => curLinks[s.id]?.spreadsheetId && curLinks[s.id]?.autoSyncEnabled
      );
      if (autoStores.length === 0) return;

      syncLockRef.current = true;
      try {
        for (const store of autoStores) {
          const curHash = computeStoreDataHash(curDb, store.id);
          // Don't overwrite pending unpushed local edits
          if (
            lastPushedHashRef.current[store.id] &&
            lastPushedHashRef.current[store.id] !== curHash
          ) {
            continue;
          }

          const link = curLinks[store.id];
          if (!link) continue;
          const sheetRows = await readBranchInventoryFromSheet(
            tokenRef.current!,
            link.spreadsheetId
          );

          const prevSnap = lastSheetSnapshotRef.current[store.id];
          const storeProducts = curDb.products.filter(
            (p) => p.storeId === store.id
          );

          const rowsToApply: SheetInventoryRow[] = [];
          let needsIdWriteback = false;

          for (const sr of sheetRows) {
            const matched =
              (sr.id ? storeProducts.find((p) => p.id === sr.id) : undefined) ??
              storeProducts.find((p) => norm(p.name) === norm(sr.name));

            if (!matched) {
              rowsToApply.push(sr);
              needsIdWriteback = true;
            } else {
              const localRow: SheetInventoryRow = {
                id: matched.id,
                name: matched.name,
                price: matched.price,
                min: matched.min,
                cost: matched.cost,
                stock: matched.stock,
                minStock: matched.minStock ?? 3,
              };
              const snapRow = prevSnap?.[String(matched.id)];
              if (!rowsEqual(localRow, sr) && (!snapRow || !rowsEqual(snapRow, sr))) {
                rowsToApply.push({ ...sr, id: matched.id });
              }
            }
          }

          if (rowsToApply.length > 0) {
            let appliedCount = 0;
            upd((d) => {
              const res = applySheetInventoryToStore(d, store.id, rowsToApply);
              appliedCount = res.addedCount + res.updatedCount;
              if (appliedCount > 0) {
                addLog(
                  d,
                  'مزامنة تلقائية (Google Sheets)',
                  `[${store.name}] تطبيق ${fmt(appliedCount)} تعديل من جدول المخزون تلقائياً`,
                  store.id
                );
              }
              if (d.sheetsLinks?.[store.id]) {
                d.sheetsLinks[store.id].lastSyncTs = Date.now();
              }
              return d;
            });

            if (appliedCount > 0) {
              notify(
                `تحديث تلقائي من Google Sheets: ${appliedCount} صنف في "${store.name}"`
              );
              setTimeout(() => {
                const updatedDb = dbRef.current;
                lastSheetSnapshotRef.current[store.id] = snapshotFromProducts(
                  updatedDb,
                  store.id
                );
                if (!needsIdWriteback) {
                  lastPushedHashRef.current[store.id] = computeStoreDataHash(
                    updatedDb,
                    store.id
                  );
                }
              }, 50);
            }
          }
        }
      } catch (err) {
        if (err instanceof GoogleAuthExpiredError) {
          handleApiError(err);
        }
      } finally {
        syncLockRef.current = false;
      }
    }, 18000);

    return () => clearInterval(interval);
  }, [accessToken, isOnline, db.stores, db.sheetsLinks, handleApiError, notify, upd]);

  const pendingSyncCount =
    pendingQueue.pendingOpsCount > 0
      ? pendingQueue.pendingOpsCount
      : pendingQueue.storeIds.length + (pendingQueue.master ? 1 : 0);

  return {
    googleUser,
    trustedEmail,
    accessToken,
    isSigningIn,
    isSyncing,
    isOnline,
    pendingSyncCount,
    lastError,
    signIn,
    signOut,
    createAndLinkBranch,
    createAllUnlinkedBranches,
    linkExistingBranch,
    unlinkBranch,
    toggleAutoSync,
    pushBranchNow: async (sid) => {
      await pushBranchNow(sid, false);
    },
    pushAllLinkedNow,
    flushPendingNow: () => flushPendingNow(false),
    pullBranchInventoryNow,
    createAndLinkMaster,
    linkExistingMaster,
    unlinkMaster,
    toggleMasterAutoSync,
    pushMasterNow: async () => {
      await pushMasterNow(false);
    },
    setLastError,
  };
};
