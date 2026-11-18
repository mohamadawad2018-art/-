import React, { useMemo, useState } from 'react';
import {
  Camera,
  CreditCard,
  Image as ImageIcon,
  Search,
  Upload,
  ZoomIn,
} from 'lucide-react';
import { addLog, compressImageFile, fmt, fullDate, getIntakeTotals, norm } from '../store';
import type { ApprovalStatus, PosDatabase, StockIntake } from '../types';
import { PhotoLightboxModal } from './Modals';

interface ArchiveViewProps {
  db: PosDatabase;
  upd?: (fn: (draft: PosDatabase) => PosDatabase) => void;
  userName?: string;
  selectedStoreId: number | 'all';
  onOpenNewIntake: () => void;
  onOpenPayments?: () => void;
  onOpenAttachOldPhoto?: () => void;
  notify?: (msg: string) => void;
}

const STATUS_TEXT: Record<ApprovalStatus, string> = {
  approved: 'معتمدة ودخلت المخزن',
  pending: 'بانتظار المطابقة',
  rejected: 'مرفوضة',
};

export const ArchiveView: React.FC<ArchiveViewProps> = ({
  db,
  upd,
  userName = 'الإدارة',
  selectedStoreId,
  onOpenNewIntake,
  onOpenPayments,
  onOpenAttachOldPhoto,
  notify,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'no_photo' | ApprovalStatus>(
    'all'
  );
  const [query, setQuery] = useState('');
  const [previewIntakeId, setPreviewIntakeId] = useState<number | null>(null);
  const [uploadingId, setUploadingId] = useState<number | null>(null);

  const getStoreName = (id: number) =>
    db.stores.find((s) => s.id === id)?.name ?? 'المحل الرئيسي';

  const noPhotoCount = useMemo(
    () =>
      db.stockIntakes.filter(
        (item) =>
          (selectedStoreId === 'all' || item.storeId === selectedStoreId) &&
          !item.photoDataUrl
      ).length,
    [db.stockIntakes, selectedStoreId]
  );

  const filtered = useMemo(() => {
    const q = norm(query);
    return db.stockIntakes.filter((item) => {
      if (selectedStoreId !== 'all' && item.storeId !== selectedStoreId) {
        return false;
      }
      if (statusFilter === 'no_photo') {
        if (item.photoDataUrl) return false;
      } else if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      const inEmp = norm(item.enteredBy).includes(q);
      const inNote = norm(item.note ?? '').includes(q);
      const inSupplier = norm(item.supplierName ?? '').includes(q);
      const inItems = item.items.some((x) => norm(x.name).includes(q));
      const inId = String(item.id).includes(q);
      return inEmp || inNote || inSupplier || inItems || inId;
    });
  }, [db.stockIntakes, selectedStoreId, statusFilter, query]);

  const savePhotoForIntake = (intake: StockIntake, photoDataUrl: string) => {
    if (!upd) return;
    const storeName = getStoreName(intake.storeId);
    const hadPhoto = Boolean(intake.photoDataUrl);
    upd((d) => {
      const target = d.stockIntakes.find((x) => x.id === intake.id);
      if (!target) return d;
      target.photoDataUrl = photoDataUrl;
      addLog(
        d,
        userName,
        `[${storeName}] ${hadPhoto ? 'تحديث' : 'إضافة'} صورة فاتورة #${intake.id}${intake.supplierName ? ` (${intake.supplierName})` : ''}`,
        intake.storeId
      );
      return d;
    });
    notify?.(
      hadPhoto
        ? `تم تحديث صورة الفاتورة #${intake.id}`
        : `تمت إضافة صورة للفاتورة #${intake.id} بنجاح`
    );
  };

  const handleAttachFile = async (
    intake: StockIntake,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingId(intake.id);
    try {
      const compressed = await compressImageFile(file);
      savePhotoForIntake(intake, compressed);
    } catch {
      notify?.('تعذر معالجة صورة الفاتورة');
    } finally {
      setUploadingId(null);
    }
  };

  const previewIntake =
    previewIntakeId !== null
      ? db.stockIntakes.find((x) => x.id === previewIntakeId) ?? null
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-base font-bold">أرشيف الفواتير (البضاعة الواردة)</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            كل الفواتير (المصورة أو بدون صورة) مع إمكانية إضافة أو تحديث صورة أي فاتورة قديمة في أي وقت
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenAttachOldPhoto && (
            <button
              type="button"
              onClick={onOpenAttachOldPhoto}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200 whitespace-nowrap shrink-0"
            >
              <Upload className="h-4 w-4" />
              <span>إضافة صورة لفاتورة قديمة</span>
            </button>
          )}
          {onOpenPayments && (
            <button
              type="button"
              onClick={onOpenPayments}
              className="inline-flex items-center gap-2 rounded-lg border border-[#38608f]/40 bg-[#38608f]/10 px-4 py-2.5 text-xs font-semibold text-[#38608f] transition-colors hover:bg-[#38608f]/20 dark:text-[#98c1f0] whitespace-nowrap shrink-0"
            >
              <CreditCard className="h-4 w-4" />
              <span>متابعة وسداد دفعات الفواتير</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenNewIntake}
            className="inline-flex items-center gap-2 rounded-lg bg-[#38608f] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#2d4f77] whitespace-nowrap shrink-0"
          >
            <Camera className="h-4 w-4" />
            <span>إدخال فاتورة بضاعة جديدة</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
          {(
            [
              ['all', 'الكل'],
              ['no_photo', `بدون صورة (${noPhotoCount})`],
              ['approved', 'المعتمدة'],
              ['pending', 'بانتظار المطابقة'],
              ['rejected', 'المرفوضة'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setStatusFilter(k)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === k
                  ? 'bg-[#38608f] text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="بحث باسم الموظف، الصنف، رقم الفاتورة..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-9 pl-3 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
          />
        </div>
      </div>

      {/* Photo Cards Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          لا توجد صور فواتير مطابقة في الأرشيف
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
            const { totalCost, paidAmount, remainingAmount, paymentStatus } =
              getIntakeTotals(item);
            return (
              <article
                key={item.id}
                className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              >
                {item.photoDataUrl ? (
                  <div className="relative aspect-[4/3] w-full overflow-hidden border-b border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950">
                    <button
                      type="button"
                      onClick={() => setPreviewIntakeId(item.id)}
                      className="group relative block h-full w-full"
                    >
                      <img
                        src={item.photoDataUrl}
                        alt={`صورة فاتورة #${item.id}`}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      />
                      <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-slate-950/75 px-2.5 py-1 text-xs font-medium text-white">
                        <ZoomIn className="h-3.5 w-3.5" />
                        <span>تكبير الصورة</span>
                      </span>
                    </button>
                    {upd && (
                      <label className="absolute bottom-2 right-2 inline-flex cursor-pointer items-center gap-1 rounded-md bg-white/90 px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-sm hover:bg-white dark:bg-slate-900/90 dark:text-slate-100">
                        <Upload className="h-3.5 w-3.5" />
                        <span>
                          {uploadingId === item.id ? 'جاري الحفظ...' : 'تغيير الصورة'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleAttachFile(item, e)}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                ) : (
                  <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2.5 border-b border-slate-200 bg-slate-50 p-4 text-center dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-200/80 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <ImageIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        فاتورة مسجّلة بدون صورة
                      </p>
                      <button
                        type="button"
                        onClick={() => setPreviewIntakeId(item.id)}
                        className="mt-0.5 text-[11px] font-medium text-[#38608f] hover:underline dark:text-[#78a8de]"
                      >
                        فتح تفاصيل الفاتورة
                      </button>
                    </div>
                    {upd && (
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-[#38608f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2d4f77] whitespace-nowrap">
                          <Camera className="h-3.5 w-3.5" />
                          <span>
                            {uploadingId === item.id ? 'جاري الحفظ...' : 'تصوير الفاتورة'}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => handleAttachFile(item, e)}
                            className="hidden"
                          />
                        </label>
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap">
                          <Upload className="h-3.5 w-3.5" />
                          <span>رفع صورة</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleAttachFile(item, e)}
                            className="hidden"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-1 flex-col justify-between p-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-num font-bold text-slate-900 dark:text-slate-100">
                        فاتورة #{item.id} · {getStoreName(item.storeId)}
                      </span>
                      <span
                        className={`font-semibold ${
                          item.status === 'approved'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : item.status === 'pending'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {STATUS_TEXT[item.status]}
                      </span>
                    </div>

                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      <span>أدخلها: </span>
                      <strong className="text-slate-800 dark:text-slate-200">
                        {item.enteredBy}
                      </strong>
                      {item.supplierName && (
                        <>
                          {' · '}
                          <span>المورد: </span>
                          <strong className="text-[#38608f] dark:text-[#78a8de]">
                            {item.supplierName}
                          </strong>
                        </>
                      )}
                      {item.approvedBy && (
                        <>
                          {' · '}
                          <span>اعتمدها: </span>
                          <strong className="text-slate-800 dark:text-slate-200">
                            {item.approvedBy}
                          </strong>
                        </>
                      )}
                    </div>

                    <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2 text-xs dark:divide-slate-800 dark:border-slate-800">
                      {item.items.map((line, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between py-1"
                        >
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {line.name} × {line.qty}
                          </span>
                          <span className="font-num text-slate-500 dark:text-slate-400">
                            جملة {fmt(line.cost)} · مبيع {fmt(line.price)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 space-y-2 border-t border-slate-200 pt-2.5 text-xs dark:border-slate-800">
                    {item.status !== 'rejected' && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-950">
                        <span
                          className={`font-semibold ${
                            paymentStatus === 'paid'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : paymentStatus === 'partial'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {paymentStatus === 'paid'
                            ? 'مسددة بالكامل'
                            : paymentStatus === 'partial'
                              ? 'دفعة جزئية'
                              : 'غير مدفوعة'}
                        </span>
                        <span className="font-num text-slate-600 dark:text-slate-300">
                          مدفوع: <strong className="text-emerald-600 dark:text-emerald-400">{fmt(paidAmount)}</strong>
                          {remainingAmount > 0 && (
                            <>
                              {' · '}متبقي:{' '}
                              <strong className="text-rose-600 dark:text-rose-400">
                                {fmt(remainingAmount)}
                              </strong>
                            </>
                          )}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="font-num text-slate-400">
                        {fullDate(item.ts)}
                      </span>
                      <span className="font-num font-bold text-[#38608f] dark:text-[#78a8de]">
                        الجملة: {fmt(totalCost)}
                      </span>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {previewIntake && (
        <PhotoLightboxModal
          intake={previewIntake}
          storeName={getStoreName(previewIntake.storeId)}
          onClose={() => setPreviewIntakeId(null)}
          onAttachPhoto={upd ? savePhotoForIntake : undefined}
          notify={notify}
        />
      )}
    </div>
  );
};
