import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CloudUpload,
  ExternalLink,
  FileSpreadsheet,
  FolderSearch,
  Link2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Unlink,
  Upload,
  WifiOff,
} from 'lucide-react';
import { addLog, fmt, fullDate } from '../store';
import type { PosDatabase, StoreBranch } from '../types';
import {
  exportAllBranchesWorkbook,
  exportBranchWorkbook,
  exportMasterInventoryWorkbook,
  parseInventoryFromExcelFile,
} from '../services/excelWorkbook';
import {
  applySheetInventoryToStore,
  collectIncomingGoodsEntries,
  diffBranchInventory,
  extractSpreadsheetId,
  listAppSpreadsheets,
  readBranchInventoryFromSheet,
  restoreBranchDataFromSheet,
  type DriveSpreadsheetFile,
  type InventoryDiffResult,
  type SheetInventoryRow,
} from '../services/sheetsSync';
import type { GoogleSheetsSyncState } from '../services/useGoogleSheetsSync';
import { Modal } from './Modals';

interface SheetsSyncViewProps {
  db: PosDatabase;
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void;
  selectedStoreId: number | 'all';
  sheetsSync: GoogleSheetsSyncState;
  notify: (msg: string) => void;
  userName: string;
  isOwner?: boolean;
}

type ConfirmDialogState =
  | {
      kind: 'create_branch';
      store: StoreBranch;
      counts: {
        products: number;
        sales: number;
        expenses: number;
        rents: number;
        invoicePayments: number;
        staffWithdrawals: number;
        managerGoods: number;
        customerDebts: number;
        returns: number;
      };
    }
  | {
      kind: 'push_branch';
      store: StoreBranch;
      title: string;
      counts: {
        products: number;
        sales: number;
        expenses: number;
        rents: number;
        invoicePayments: number;
        staffWithdrawals: number;
        managerGoods: number;
        customerDebts: number;
        returns: number;
      };
    }
  | {
      kind: 'create_all_unlinked';
      stores: StoreBranch[];
    }
  | {
      kind: 'push_all';
      branches: { store: StoreBranch; title: string }[];
    }
  | {
      kind: 'enable_auto';
      store: StoreBranch;
      title: string;
    }
  | {
      kind: 'restore_branch';
      store: StoreBranch;
      spreadsheetId: string;
      title: string;
      productsCount: number;
      salesCount: number;
      expensesCount: number;
      payload: Awaited<ReturnType<typeof restoreBranchDataFromSheet>>;
    }
  | {
      kind: 'apply_inventory_diff';
      sourceLabel: string;
      store: StoreBranch;
      rows: SheetInventoryRow[];
      diff: InventoryDiffResult;
    };

export const SheetsSyncView: React.FC<SheetsSyncViewProps> = ({
  db,
  upd,
  selectedStoreId,
  sheetsSync,
  notify,
  userName,
  isOwner = false,
}) => {
  const [linkInputs, setLinkInputs] = useState<Record<number, string>>({});
  const [confirmState, setConfirmState] = useState<ConfirmDialogState | null>(
    null
  );
  const [ownerPinInput, setOwnerPinInput] = useState('');
  const [driveFiles, setDriveFiles] = useState<DriveSpreadsheetFile[] | null>(
    null
  );
  const [loadingDrive, setLoadingDrive] = useState(false);
  const [assignStoreByFile, setAssignStoreByFile] = useState<
    Record<string, number>
  >({});
  const [masterLinkInput, setMasterLinkInput] = useState('');
  const excelImportTargetStoreRef = useRef<StoreBranch | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  const incomingAllEntries = collectIncomingGoodsEntries(db);
  const masterTotalUnits = db.products.reduce((acc, p) => acc + Math.max(0, p.stock), 0);

  const visibleStores =
    selectedStoreId === 'all'
      ? db.stores
      : db.stores.filter((s) => s.id === selectedStoreId);

  const getBranchCounts = (storeId: number) => ({
    products: db.products.filter((p) => p.storeId === storeId).length,
    sales: db.sales.filter((s) => s.storeId === storeId).length,
    expenses:
      db.expenses.filter((e) => e.storeId === storeId).length +
      db.salaries.filter((s) => s.storeId === storeId && s.status !== 'rejected')
        .length,
    rents: (db.rents ?? []).filter((r) => r.storeId === storeId).length,
    invoicePayments: db.stockIntakes.filter(
      (i) => i.storeId === storeId && i.status !== 'rejected'
    ).length,
    staffWithdrawals: db.withdrawals.filter(
      (w) => w.storeId === storeId && w.status !== 'rejected'
    ).length,
    managerGoods: db.withdrawals.filter(
      (w) =>
        w.storeId === storeId &&
        w.status !== 'rejected' &&
        w.type === 'goods' &&
        w.whoType === 'manager'
    ).length,
    customerDebts: (db.customerDebts ?? []).filter(
      (cd) => cd.storeId === storeId
    ).length,
    returns: db.returns.filter((r) => r.storeId === storeId).length,
  });

  const handleSearchDrive = async () => {
    if (!sheetsSync.accessToken) return;
    setLoadingDrive(true);
    try {
      const files = await listAppSpreadsheets(sheetsSync.accessToken);
      setDriveFiles(files);
      if (files.length === 0) {
        notify('لم يتم العثور على جداول مرتبطة بالتطبيق في Google Drive');
      }
    } catch (err) {
      sheetsSync.setLastError(
        err instanceof Error ? err.message : 'تعذر البحث في Google Drive'
      );
    } finally {
      setLoadingDrive(false);
    }
  };

  const handleInspectSheetInventory = async (store: StoreBranch) => {
    const link = db.sheetsLinks?.[store.id];
    if (!sheetsSync.accessToken || !link) return;
    try {
      const rows = await readBranchInventoryFromSheet(
        sheetsSync.accessToken,
        link.spreadsheetId
      );
      const existing = db.products.filter((p) => p.storeId === store.id);
      const diff = diffBranchInventory(existing, rows);
      setConfirmState({
        kind: 'apply_inventory_diff',
        sourceLabel: `Google Sheets (${link.title})`,
        store,
        rows,
        diff,
      });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر قراءة جدول المخزون');
    }
  };

  const handlePrepareRestoreFromSheet = async (
    store: StoreBranch,
    spreadsheetId: string,
    title: string
  ) => {
    if (!sheetsSync.accessToken) return;
    try {
      const payload = await restoreBranchDataFromSheet(
        sheetsSync.accessToken,
        spreadsheetId,
        store.id
      );
      setConfirmState({
        kind: 'restore_branch',
        store,
        spreadsheetId,
        title,
        productsCount: payload.products.length,
        salesCount: payload.sales.length,
        expensesCount: payload.expenses.length,
        payload,
      });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر قراءة بيانات الاستعادة');
    }
  };

  const handleExcelFilePicked = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const store = excelImportTargetStoreRef.current;
    if (!file || !store) return;
    try {
      const rows = await parseInventoryFromExcelFile(file);
      if (rows.length === 0) {
        notify('لم يتم العثور على أصناف صالحة في ملف Excel');
        return;
      }
      const existing = db.products.filter((p) => p.storeId === store.id);
      const diff = diffBranchInventory(existing, rows);
      setConfirmState({
        kind: 'apply_inventory_diff',
        sourceLabel: `ملف Excel (${file.name})`,
        store,
        rows,
        diff,
      });
    } catch {
      notify('تعذر قراءة ملف Excel');
    }
  };

  const diffHasStockChange = (diff: InventoryDiffResult) =>
    diff.updated.some((u) => u.existing.stock !== u.incoming.stock);

  const executeConfirmedAction = async () => {
    if (!confirmState) return;
    if (
      confirmState.kind === 'apply_inventory_diff' &&
      diffHasStockChange(confirmState.diff)
    ) {
      if (!isOwner) {
        notify('لا يمكن للمدير تعديل كميات أصناف موجودة عبر الاستيراد — يلزم صلاحية المالك');
        return;
      }
      const pinValid = db.users.some(
        (u) => u.owner && u.pin === ownerPinInput.trim()
      );
      if (!pinValid) {
        notify('كلمة سر المالك غير صحيحة لاعتماد تعديل كميات المخزون');
        return;
      }
    }

    const state = confirmState;
    setConfirmState(null);
    setOwnerPinInput('');

    if (state.kind === 'create_branch') {
      await sheetsSync.createAndLinkBranch(state.store.id);
    } else if (state.kind === 'create_all_unlinked') {
      await sheetsSync.createAllUnlinkedBranches(state.stores.map((s) => s.id));
    } else if (state.kind === 'push_branch') {
      await sheetsSync.pushBranchNow(state.store.id);
    } else if (state.kind === 'push_all') {
      await sheetsSync.pushAllLinkedNow();
    } else if (state.kind === 'enable_auto') {
      sheetsSync.toggleAutoSync(state.store.id, true);
    } else if (state.kind === 'apply_inventory_diff') {
      if (state.sourceLabel.startsWith('Google Sheets')) {
        const res = await sheetsSync.pullBranchInventoryNow(
          state.store.id,
          state.rows
        );
        notify(
          `تم تحديث مخزون "${state.store.name}": إضافة ${res.addedCount} · تعديل ${res.updatedCount}`
        );
      } else {
        let added = 0;
        let updated = 0;
        const hadStockEdit = diffHasStockChange(state.diff);
        const priceEdits = state.diff.updated.filter(
          ({ existing, incoming }) =>
            existing.price !== incoming.price ||
            existing.min !== incoming.min ||
            existing.cost !== incoming.cost
        );
        upd((d) => {
          const res = applySheetInventoryToStore(d, state.store.id, state.rows);
          added = res.addedCount;
          updated = res.updatedCount;
          if (priceEdits.length > 0) {
            if (!Array.isArray(d.ownerAlerts)) d.ownerAlerts = [];
            const namesPreview = priceEdits
              .slice(0, 3)
              .map((x) => x.existing.name)
              .join('، ');
            d.ownerAlerts.unshift({
              id: d.nid++,
              kind: 'price',
              title: 'تعديل أسعار عبر استيراد جدول',
              message: `[${state.store.name}] قام ${userName} بتعديل أسعار ${priceEdits.length} قطعة عبر ${state.sourceLabel}: ${namesPreview}${priceEdits.length > 3 ? '...' : ''}`,
              by: userName,
              storeId: state.store.id,
              ts: Date.now(),
              read: false,
            });
          }
          addLog(
            d,
            userName,
            `[${state.store.name}] استيراد مخزون من ${state.sourceLabel} (إضافة ${added} · تعديل ${updated})${
              hadStockEdit ? ' · تعديل كمية بكلمة سر المالك' : ''
            }${priceEdits.length > 0 ? ` · تعديل أسعار ${priceEdits.length} قطعة` : ''}`,
            state.store.id
          );
          return d;
        });
        notify(
          `تم تطبيق تعديلات Excel على "${state.store.name}": إضافة ${added} · تعديل ${updated}`
        );
      }
    } else if (state.kind === 'restore_branch') {
      upd((d) => {
        const invRes = applySheetInventoryToStore(
          d,
          state.store.id,
          state.payload.products
        );
        let restoredSales = 0;
        for (const s of state.payload.sales) {
          if (!d.sales.some((ex) => ex.id === s.id && ex.storeId === state.store.id)) {
            d.sales.push(s);
            if (s.id >= d.nid) d.nid = s.id + 1;
            restoredSales += 1;
          }
        }
        let restoredExpenses = 0;
        for (const exp of state.payload.expenses) {
          const dup = d.expenses.some(
            (ex) =>
              ex.storeId === state.store.id &&
              ex.desc === exp.desc &&
              ex.amount === exp.amount &&
              Math.abs(ex.ts - exp.ts) < 60000
          );
          if (!dup) {
            d.expenses.push(exp);
            restoredExpenses += 1;
          }
        }
        addLog(
          d,
          userName,
          `[${state.store.name}] استعادة من Google Sheets (${invRes.addedCount + invRes.updatedCount} صنف، ${restoredSales} فاتورة، ${restoredExpenses} مصروف)`,
          state.store.id
        );
        return d;
      });
      notify(`تمت استعادة بيانات فرع "${state.store.name}" بنجاح`);
    }
  };

  const linkedStores = db.stores
    .filter((s) => Boolean(db.sheetsLinks?.[s.id]?.spreadsheetId))
    .map((s) => ({ store: s, title: db.sheetsLinks![s.id].title }));

  const unlinkedStores = db.stores.filter(
    (s) => !db.sheetsLinks?.[s.id]?.spreadsheetId
  );

  return (
    <div className="space-y-6">
      <input
        ref={excelInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleExcelFilePicked}
        className="hidden"
      />

      {/* Google Sheets Cloud Sync Header Card */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                الربط التلقائي مع جداول Google Sheets وإكسل (كل فرع مستقل)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                يُنشئ النظام لكل محل جدولاً مستقلاً يضم 12 ورقة منظمة حسب الشهر واليوم بألوان واضحة للعين: المخزون، دخول البضاعة، المبيعات، الأرباح (مع خصم الإيجار)، المصاريف، الخصومات، إيجار المحل، دفعات الفواتير، مسحوبات البضاعة (بسعر الجملة وحالة المحاسبة)، مسحوبات المدير والمالك (قائمة مسجّلة خاصة)، ديون زباين، والمرتجعات. أي بضاعة تدخل لأي فرع تُسجّل أيضاً في شيت المخزن الرئيسي الإجمالي تلقائياً.
              </p>
            </div>
          </div>

          {!sheetsSync.accessToken ? (
            <button
              type="button"
              disabled={sheetsSync.isSigningIn}
              onClick={() => sheetsSync.signIn()}
              className="gsi-material-button inline-flex items-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-xs transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              <span className="gsi-material-button-icon block h-5 w-5 shrink-0">
                <svg
                  version="1.1"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 48 48"
                  className="block h-5 w-5"
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                  <path fill="none" d="M0 0h48v48H0z" />
                </svg>
              </span>
              <span className="gsi-material-button-contents">
                {sheetsSync.isSigningIn
                  ? 'جاري تسجيل الدخول...'
                  : 'Sign in with Google'}
              </span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                حساب المالك موثوق ومربوط:{' '}
                {sheetsSync.trustedEmail ||
                  sheetsSync.googleUser?.email ||
                  sheetsSync.googleUser?.displayName ||
                  'Google'}
              </div>

              {unlinkedStores.length > 0 && (
                <button
                  type="button"
                  disabled={sheetsSync.isSyncing}
                  onClick={() =>
                    setConfirmState({
                      kind: 'create_all_unlinked',
                      stores: unlinkedStores,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>
                    إنشاء جداول جميع الفروع الآن ({unlinkedStores.length})
                  </span>
                </button>
              )}

              {linkedStores.length > 0 && (
                <button
                  type="button"
                  disabled={sheetsSync.isSyncing}
                  onClick={() =>
                    setConfirmState({
                      kind: 'push_all',
                      branches: linkedStores,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#38608f] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2d4f77] disabled:opacity-60 whitespace-nowrap"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      sheetsSync.isSyncing ? 'animate-spin' : ''
                    }`}
                  />
                  <span>مزامنة جميع الفروع ({linkedStores.length})</span>
                </button>
              )}

              <button
                type="button"
                disabled={loadingDrive}
                onClick={handleSearchDrive}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                <FolderSearch className="h-3.5 w-3.5 text-[#38608f] dark:text-[#78a8de]" />
                <span>
                  {loadingDrive
                    ? 'جاري البحث...'
                    : 'استعادة الجداول من Google Drive'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => sheetsSync.signOut()}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                فك ارتباط الحساب
              </button>
            </div>
          )}
        </div>

        {!sheetsSync.accessToken ? (
          <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50/70 px-3.5 py-2.5 text-xs text-sky-900 dark:border-sky-800/70 dark:bg-sky-950/40 dark:text-sky-200">
            {sheetsSync.trustedEmail ? (
              <>
                حساب المالك الموثوق مسجّل (<strong>{sheetsSync.trustedEmail}</strong>). في حال فتح النظام من جهاز جديد لأول مرة أو مسح بيانات المتصفح، اضغط <strong>«Sign in with Google»</strong> مرة واحدة فقط ليتم تثبيت الربط والتجديد الصامت تلقائياً دون إعادة الطلب.
              </>
            ) : (
              <>
                <strong>ملاحظة هامة:</strong> اربط حساب المالك عبر <strong>«Sign in with Google»</strong> لمرة واحدة فقط لتأكيد الحساب واعتماده، ثم اضغط على <strong>«إنشاء جداول جميع الفروع الآن»</strong> لتستمر المزامنة والتجديد تلقائياً في الخلفية.
              </>
            )}
          </div>
        ) : unlinkedStores.length > 0 ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200">
            تم تأكيد حساب المالك بنجاح! اضغط على <strong>«إنشاء جداول جميع الفروع الآن ({unlinkedStores.length})»</strong> أعلاه ليتم إنشاء جدول مستقل لكل فرع داخل <strong>Google Drive / Google Sheets</strong> وتفعيل المزامنة التلقائية الدائمة.
          </div>
        ) : null}

        {(!sheetsSync.isOnline || sheetsSync.pendingSyncCount > 0) && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-200">
            <div className="flex items-center gap-2">
              {!sheetsSync.isOnline ? (
                <WifiOff className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              ) : (
                <CloudUpload className="h-4 w-4 shrink-0 text-[#38608f] dark:text-[#78a8de]" />
              )}
              <span>
                {!sheetsSync.isOnline
                  ? `العمل حالياً بدون إنترنت (Offline) — كل التعديلات محفوظة محلياً وسيتم تفريغها تلقائياً على إكسل فور عودة الشبكة لثوانٍ.${
                      sheetsSync.pendingSyncCount > 0
                        ? ` (${sheetsSync.pendingSyncCount} عمليات بانتظار الرفع)`
                        : ''
                    }`
                  : `توجد ${sheetsSync.pendingSyncCount} تحديثات معلّقة بانتظار التفريغ إلى Google Sheets.`}
              </span>
            </div>
            {sheetsSync.isOnline &&
              sheetsSync.accessToken &&
              sheetsSync.pendingSyncCount > 0 && (
                <button
                  type="button"
                  disabled={sheetsSync.isSyncing}
                  onClick={() => void sheetsSync.flushPendingNow()}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#38608f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2d4f77] disabled:opacity-60 whitespace-nowrap"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      sheetsSync.isSyncing ? 'animate-spin' : ''
                    }`}
                  />
                  <span>تفريغ المعلّق الآن</span>
                </button>
              )}
          </div>
        )}

        {sheetsSync.lastError && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{sheetsSync.lastError}</span>
          </div>
        )}

        {/* Discovered Google Drive Files for Recovery */}
        {driveFiles && driveFiles.length > 0 && sheetsSync.accessToken && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                الجداول المحفوظة في Google Drive ({driveFiles.length})
              </h3>
              <button
                type="button"
                onClick={() => setDriveFiles(null)}
                className="text-xs font-medium text-slate-500 hover:underline"
              >
                إغلاق القائمة
              </button>
            </div>
            <div className="space-y-2">
              {driveFiles.map((file) => {
                const targetStoreId =
                  assignStoreByFile[file.id] ?? db.stores[0]?.id ?? 1;
                const targetStore =
                  db.stores.find((s) => s.id === targetStoreId) ?? db.stores[0];
                return (
                  <div
                    key={file.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div>
                      <p className="font-bold text-slate-800 dark:text-slate-200">
                        {file.name}
                      </p>
                      {file.modifiedTime && (
                        <p className="font-num mt-0.5 text-slate-500 dark:text-slate-400">
                          آخر تعديل: {fullDate(Date.parse(file.modifiedTime))}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {db.stores.length > 1 && (
                        <select
                          value={targetStoreId}
                          onChange={(e) =>
                            setAssignStoreByFile((prev) => ({
                              ...prev,
                              [file.id]: Number(e.target.value),
                            }))
                          }
                          className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                        >
                          {db.stores.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {targetStore && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              sheetsSync.linkExistingBranch(
                                targetStore.id,
                                file.id
                              )
                            }
                            className="rounded-lg bg-[#38608f] px-3 py-1.5 font-semibold text-white hover:bg-[#2d4f77] whitespace-nowrap"
                          >
                            ربط بالفرع
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handlePrepareRestoreFromSheet(
                                targetStore,
                                file.id,
                                file.name
                              )
                            }
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                          >
                            استعادة البيانات منه
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* Master Warehouse Total Inventory & Incoming Goods Ledger Card */}
        <div className="mt-5 rounded-xl border border-[#38608f]/30 bg-[#38608f]/5 p-4 dark:border-[#4f7fb5]/40 dark:bg-[#38608f]/10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                المخزن الرئيسي: شيت إجمالي المخزون وسجل دخول البضاعة (كل الفروع)
              </h3>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                يعرض إجمالي كمية كل صنف في جميع الفروع معاً، ويسجّل تلقائياً كل بضاعة دخلت لأي فرع مقسّمة حسب اليوم والشهر لمعرفة التواريخ والأصناف الداخلة بدقة.
              </p>
              <div className="font-num mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
                <span>
                  إجمالي القطع بكل المخازن: <strong>{fmt(masterTotalUnits)}</strong>
                </span>
                <span>
                  حركات دخول البضاعة المسجلة: <strong>{fmt(incomingAllEntries.length)}</strong> بند
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  exportMasterInventoryWorkbook(db);
                  notify('تم تحميل شيت إجمالي المخزون ودخول البضاعة (.xlsx)');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
                <span>تحميل شيت إجمالي المخزون (.xlsx)</span>
              </button>

              {sheetsSync.accessToken && !db.masterSheetLink && (
                <button
                  type="button"
                  disabled={sheetsSync.isSyncing}
                  onClick={() => sheetsSync.createAndLinkMaster()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#38608f] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#2d4f77] disabled:opacity-60 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>إنشاء شيت إجمالي المخزون على Google Sheets</span>
                </button>
              )}
            </div>
          </div>

          {sheetsSync.accessToken && (
            <div className="mt-3 border-t border-[#38608f]/20 pt-3">
              {db.masterSheetLink ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-100">
                      {db.masterSheetLink.title}
                    </span>
                    <span className="font-num mr-2 text-slate-500 dark:text-slate-400">
                      {db.masterSheetLink.lastSyncTs
                        ? `آخر تحديث: ${fullDate(db.masterSheetLink.lastSyncTs)}`
                        : ''}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={db.masterSheetLink.spreadsheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-[#38608f] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-[#78a8de] whitespace-nowrap"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>فتح الشيت الإجمالي</span>
                    </a>
                    <button
                      type="button"
                      onClick={() =>
                        sheetsSync.toggleMasterAutoSync(
                          !db.masterSheetLink?.autoSyncEnabled
                        )
                      }
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-semibold whitespace-nowrap ${
                        db.masterSheetLink.autoSyncEnabled
                          ? 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-300'
                          : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span>
                        {db.masterSheetLink.autoSyncEnabled
                          ? 'مزامنة تلقائية مفعّلة'
                          : 'تفعيل المزامنة التلقائية'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={sheetsSync.isSyncing}
                      onClick={() => sheetsSync.pushMasterNow()}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#38608f] px-2.5 py-1.5 font-semibold text-white hover:bg-[#2d4f77] disabled:opacity-60 whitespace-nowrap"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>تحديث الآن</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => sheetsSync.unlinkMaster()}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50 whitespace-nowrap"
                    >
                      <Unlink className="h-3.5 w-3.5" />
                      <span>فك</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    placeholder="أو الصق رابط/معرف شيت Google Sheets موجود لربطه كشيت إجمالي..."
                    value={masterLinkInput}
                    onChange={(e) => setMasterLinkInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                  />
                  <button
                    type="button"
                    disabled={!masterLinkInput.trim() || sheetsSync.isSyncing}
                    onClick={() => {
                      const id = extractSpreadsheetId(masterLinkInput);
                      if (!id) return;
                      sheetsSync.linkExistingMaster(id);
                      setMasterLinkInput('');
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    <span>ربط</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Per-Branch Cards */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {visibleStores.map((store) => {
          const link = db.sheetsLinks?.[store.id];
          const counts = getBranchCounts(store.id);
          const linkInput = linkInputs[store.id] ?? '';

          return (
            <section
              key={store.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      {store.name}
                    </h3>
                    <p className="font-num mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {counts.products} منتج بالمخزون · {counts.sales} فاتورة
                      مبيع · {counts.expenses} مصروف/راتب
                    </p>
                  </div>

                  {link ? (
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-bold ${
                        link.autoSyncEnabled
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {link.autoSyncEnabled ? 'مزامنة تلقائية مفعّلة' : 'مربوط يدوياً'}
                    </span>
                  ) : (
                    <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                      غير مربوط بـ Google Sheets
                    </span>
                  )}
                </div>

                {/* Linked Google Sheet Controls */}
                {link ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60">
                      <div>
                        <p className="font-bold text-slate-800 dark:text-slate-200">
                          {link.title}
                        </p>
                        <p className="font-num mt-0.5 text-slate-500 dark:text-slate-400">
                          {link.lastSyncTs
                            ? `آخر مزامنة: ${fullDate(link.lastSyncTs)}`
                            : 'بانتظار أول مزامنة'}
                        </p>
                      </div>
                      <a
                        href={link.spreadsheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-[#38608f] hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-[#78a8de] dark:hover:bg-slate-700 whitespace-nowrap"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>فتح الجدول</span>
                      </a>
                    </div>

                    {sheetsSync.accessToken ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (link.autoSyncEnabled) {
                              sheetsSync.toggleAutoSync(store.id, false);
                            } else {
                              setConfirmState({
                                kind: 'enable_auto',
                                store,
                                title: link.title,
                              });
                            }
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                            link.autoSyncEnabled
                              ? 'border border-emerald-600/30 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : 'bg-emerald-600 text-white hover:bg-emerald-700'
                          }`}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          <span>
                            {link.autoSyncEnabled
                              ? 'إيقاف المزامنة التلقائية'
                              : 'تفعيل المزامنة التلقائية (اتوماتيك)'}
                          </span>
                        </button>

                        <button
                          type="button"
                          disabled={sheetsSync.isSyncing}
                          onClick={() =>
                            setConfirmState({
                              kind: 'push_branch',
                              store,
                              title: link.title,
                              counts,
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#38608f] px-3 py-2 text-xs font-semibold text-white hover:bg-[#2d4f77] disabled:opacity-60 whitespace-nowrap"
                        >
                          <ArrowUpFromLine className="h-3.5 w-3.5" />
                          <span>رفع وتحديث الجدول</span>
                        </button>

                        <button
                          type="button"
                          disabled={sheetsSync.isSyncing}
                          onClick={() => handleInspectSheetInventory(store)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#38608f]/40 bg-[#38608f]/10 px-3 py-2 text-xs font-semibold text-[#38608f] hover:bg-[#38608f]/20 dark:text-[#98c1f0] whitespace-nowrap"
                        >
                          <ArrowDownToLine className="h-3.5 w-3.5" />
                          <span>سحب تعديلات المخزون من الجدول</span>
                        </button>

                        <button
                          type="button"
                          disabled={sheetsSync.isSyncing}
                          onClick={() =>
                            handlePrepareRestoreFromSheet(
                              store,
                              link.spreadsheetId,
                              link.title
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>استعادة البيانات منه</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => sheetsSync.unlinkBranch(store.id)}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50 whitespace-nowrap"
                        >
                          <Unlink className="h-3.5 w-3.5" />
                          <span>فك الارتباط</span>
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        سجّل الدخول بحساب Google أعلاه لتفعيل المزامنة التلقائية أو سحب/رفع التعديلات.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sheetsSync.accessToken ? (
                      <>
                        <button
                          type="button"
                          disabled={sheetsSync.isSyncing}
                          onClick={() =>
                            setConfirmState({
                              kind: 'create_branch',
                              store,
                              counts,
                            })
                          }
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
                        >
                          <Plus className="h-4 w-4" />
                          <span>
                            إنشاء جدول Google Sheets مستقل لـ «{store.name}» ومزامنته
                          </span>
                        </button>

                        <div className="flex items-center gap-2">
                          <input
                            placeholder="أو الصق رابط أو معرف جدول Google Sheets موجود..."
                            value={linkInput}
                            onChange={(e) =>
                              setLinkInputs((prev) => ({
                                ...prev,
                                [store.id]: e.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                          />
                          <button
                            type="button"
                            disabled={!linkInput.trim() || sheetsSync.isSyncing}
                            onClick={() => {
                              const id = extractSpreadsheetId(linkInput);
                              if (!id) return;
                              sheetsSync.linkExistingBranch(store.id, id);
                              setLinkInputs((prev) => ({
                                ...prev,
                                [store.id]: '',
                              }));
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            <span>ربط</span>
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                        اضغط «Sign in with Google» في الأعلى لإنشاء أو ربط جدول خاص بفرع «{store.name}».
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Offline Excel (.xlsx) Export & 2-way Import per Branch */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  ملف Excel محلي (.xlsx):
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      exportBranchWorkbook(db, store);
                      notify(`تم تحميل ملف Excel لفرع "${store.name}"`);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>تصدير Excel للفرع</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      excelImportTargetStoreRef.current = store;
                      excelInputRef.current?.click();
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
                  >
                    <Upload className="h-3.5 w-3.5 text-[#38608f] dark:text-[#78a8de]" />
                    <span>تحديث المخزون من Excel</span>
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* Combined All-Branches Offline Excel Download */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              تحميل ملف Excel شامل لجميع الفروع (.xlsx)
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              يجمع إجمالي المخزون الكلي ودخول البضاعة الشامل أولاً، ثم المخزون ودخول البضاعة والمبيعات والأرباح والمصاريف والخصومات لكل فرع في أوراق منفصلة مقسّمة حسب الشهر واليوم.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              exportAllBranchesWorkbook(db);
              notify('تم تصدير مصنف Excel الشامل لجميع الفروع');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>تحميل Excel لجميع الفروع</span>
          </button>
        </div>
      </section>

      {/* Explicit Confirmation Modals for All Spreadsheet/Data Mutations */}
      {confirmState && (
        <Modal
          title="تأكيد المزامنة وتحديث البيانات"
          onClose={() => setConfirmState(null)}
          maxWidth="max-w-lg"
        >
          <div className="space-y-4">
            {confirmState.kind === 'create_branch' && (
              <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                <p>
                  سيتم إنشاء جدول Google Sheets جديد باسم{' '}
                  <strong>«نظام المبيعات - {confirmState.store.name}»</strong> في
                  حسابك وتفريغ البيانات الحالية بداخله:
                </p>
                <ul className="font-num list-disc pr-5 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                  <li>ورقة «المخزون»: {confirmState.counts.products} صنف</li>
                  <li>ورقة «دخول البضاعة»: سجل البضاعة الداخلة مقسّماً حسب اليوم والشهر</li>
                  <li>ورقة «المبيعات» (مقسّمة شهرياً ويومياً): {confirmState.counts.sales} فاتورة</li>
                  <li>ورقة «الأرباح»: ملخص الأرباح الشهري واليومي</li>
                  <li>ورقة «المصاريف»: {confirmState.counts.expenses} سجل</li>
                  <li>ورقة «الخصومات»: سجل الخصومات مقسّماً حسب الشهر واليوم</li>
                  <li>ورقة «إيجار المحل»: {confirmState.counts.rents} سجل (يُخصم شهرياً من الأرباح)</li>
                  <li>ورقة «دفعات الفواتير»: {confirmState.counts.invoicePayments} فاتورة (المدفوع والمتبقي)</li>
                  <li>ورقة «مسحوبات البضاعة»: {confirmState.counts.staffWithdrawals} سجل (بالجملة وحالة المحاسبة والخصم من الراتب)</li>
                  <li>ورقة «مسحوبات المدير والمالك»: {confirmState.counts.managerGoods} سجل (سحب بضاعة خاص بالمدير والمالك بالجملة)</li>
                  <li>ورقة «ديون زباين»: {confirmState.counts.customerDebts} سجل (حسب الفرع والتاريخ والزبون مع المحاسبة)</li>
                  <li>ورقة «المرتجعات»: {confirmState.counts.returns} سجل (زبون / عامل، مصاري / بضاعة)</li>
                </ul>
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  ستُفعَّل المزامنة التلقائية بالاتجاهين لهذا الفرع فور الإنشاء.
                </p>
              </div>
            )}

            {confirmState.kind === 'create_all_unlinked' && (
              <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                <p>
                  سيتم إنشاء <strong>{confirmState.stores.length}</strong> جداول Google Sheets مستقلة في حسابك (جدول خاص بكل فرع) وتفريغ بياناتها تلقائياً:
                </p>
                <ul className="list-disc pr-5 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                  {confirmState.stores.map((st) => (
                    <li key={st.id}>
                      <strong>نظام المبيعات - {st.name}</strong> (المخزون، دخول البضاعة، المبيعات، الأرباح، المصاريف، الخصومات، الإيجار، دفعات الفواتير، مسحوبات البضاعة، مسحوبات المدير والمالك، ديون زباين، المرتجعات)
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  ستُفعَّل المزامنة التلقائية بالاتجاهين لجميع هذه الفروع مباشرة بعد الإنشاء.
                </p>
              </div>
            )}

            {confirmState.kind === 'push_branch' && (
              <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                <p>
                  هل تريد تحديث واستبدال محتوى أوراق الجدول{' '}
                  <strong>«{confirmState.title}»</strong> الخاص بفرع{' '}
                  <strong>«{confirmState.store.name}»</strong> بالبيانات الحالية؟
                </p>
                <ul className="font-num list-disc pr-5 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                  <li>المخزون: {confirmState.counts.products} صنف</li>
                  <li>المبيعات: {confirmState.counts.sales} فاتورة</li>
                  <li>الأرباح اليومية والمصاريف ({confirmState.counts.expenses} سجل)</li>
                </ul>
              </div>
            )}

            {confirmState.kind === 'push_all' && (
              <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                <p>
                  سيتم تحديث جداول Google Sheets التالية ({confirmState.branches.length} فروع):
                </p>
                <ul className="list-disc pr-5 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                  {confirmState.branches.map((b) => (
                    <li key={b.store.id}>
                      {b.store.name}: <strong>{b.title}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {confirmState.kind === 'enable_auto' && (
              <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                <p>
                  سيتم تفعيل المزامنة التلقائية بالاتجاهين بين فرع{' '}
                  <strong>«{confirmState.store.name}»</strong> وجدوله في Google
                  Sheets (<strong>{confirmState.title}</strong>):
                </p>
                <ul className="list-disc pr-5 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                  <li>
                    أي عملية بيع أو توريد أو مصروف أو تعديل بالمخزون من النظام ستحدّث جدول Google Sheets تلقائياً.
                  </li>
                  <li>
                    أي تعديل على ورقة «المخزون» داخل جدول Google Sheets سيُطبق تلقائياً على مخزون هذا الفرع.
                  </li>
                </ul>
              </div>
            )}

            {confirmState.kind === 'restore_branch' && (
              <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                <p>
                  سيتم استيراد البيانات من جدول{' '}
                  <strong>«{confirmState.title}»</strong> إلى فرع{' '}
                  <strong>«{confirmState.store.name}»</strong>:
                </p>
                <ul className="font-num list-disc pr-5 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                  <li>الأصناف الموجودة بالجدول: {confirmState.productsCount} صنف</li>
                  <li>فواتير المبيعات بالجدول: {confirmState.salesCount} فاتورة</li>
                  <li>المصاريف بالجدول: {confirmState.expensesCount} بند</li>
                </ul>
              </div>
            )}

            {confirmState.kind === 'apply_inventory_diff' && (
              <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
                <p>
                  نتائج قراءة المخزون لفرع{' '}
                  <strong>«{confirmState.store.name}»</strong> من{' '}
                  <strong>{confirmState.sourceLabel}</strong>:
                </p>
                <div className="font-num grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                    أصناف جديدة: <strong>{confirmState.diff.added.length}</strong>
                  </div>
                  <div className="rounded-lg border border-[#38608f]/30 bg-[#38608f]/10 p-2 text-[#38608f] dark:text-[#98c1f0]">
                    أصناف معدّلة: <strong>{confirmState.diff.updated.length}</strong>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                    بدون تغيير: <strong>{confirmState.diff.unchanged}</strong>
                  </div>
                </div>

                {(confirmState.diff.added.length > 0 ||
                  confirmState.diff.updated.length > 0) && (
                  <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-slate-800 dark:bg-slate-950">
                    {confirmState.diff.added.map((a, i) => (
                      <div
                        key={`add-${i}`}
                        className="flex items-center justify-between text-emerald-700 dark:text-emerald-400"
                      >
                        <span>+ جديد: {a.name}</span>
                        <span className="font-num">
                          الكمية: {fmt(a.stock)} · السعر: {fmt(a.price)}
                        </span>
                      </div>
                    ))}
                    {confirmState.diff.updated.map((u, i) => (
                      <div
                        key={`upd-${i}`}
                        className="flex items-center justify-between text-[#38608f] dark:text-[#78a8de]"
                      >
                        <span>تعديل: {u.incoming.name}</span>
                        <span className="font-num">
                          الكمية: {fmt(u.existing.stock)} ← {fmt(u.incoming.stock)} ·
                          السعر: {fmt(u.existing.price)} ← {fmt(u.incoming.price)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {confirmState.diff.added.length === 0 &&
                  confirmState.diff.updated.length === 0 && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      مخزون النظام والجدول متطابقان تماماً (النتيجة واحدة).
                    </p>
                  )}

                {diffHasStockChange(confirmState.diff) && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs space-y-2 dark:border-amber-800 dark:bg-amber-950/40">
                    <p className="font-bold text-amber-900 dark:text-amber-200">
                      تنبيه أمان المخزون: هذا التحديث يتضمن تعديل كميات أصناف موجودة
                    </p>
                    {!isOwner ? (
                      <p className="text-rose-700 dark:text-rose-300">
                        تعديل كميات المخزون محصور بالمالك وكلمة سره فقط. يُرجى استخدام فاتورة التوريد أو إضافة منتج جديد أو مراجعة المالك.
                      </p>
                    ) : (
                      <div>
                        <label className="mb-1 block font-semibold text-amber-900 dark:text-amber-200">
                          أدخل كلمة سر المالك لاعتماد تغيير الكميات:
                        </label>
                        <input
                          type="password"
                          inputMode="numeric"
                          value={ownerPinInput}
                          onChange={(e) => setOwnerPinInput(e.target.value)}
                          placeholder="كلمة سر المالك"
                          className="font-num w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-amber-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
              {!(
                confirmState.kind === 'apply_inventory_diff' &&
                confirmState.diff.added.length === 0 &&
                confirmState.diff.updated.length === 0
              ) && (
                <button
                  type="button"
                  disabled={
                    confirmState.kind === 'apply_inventory_diff' &&
                    diffHasStockChange(confirmState.diff) &&
                    !isOwner
                  }
                  onClick={executeConfirmedAction}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                >
                  <Check className="h-4 w-4" />
                  <span>تأكيد وتنفيذ</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setConfirmState(null);
                  setOwnerPinInput('');
                }}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                {confirmState.kind === 'apply_inventory_diff' &&
                confirmState.diff.added.length === 0 &&
                confirmState.diff.updated.length === 0
                  ? 'إغلاق'
                  : 'إلغاء'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
