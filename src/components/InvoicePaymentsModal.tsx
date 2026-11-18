import React, { useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Clock,
  CreditCard,
  Image as ImageIcon,
  Plus,
  Search,
  Upload,
  Wallet,
} from 'lucide-react';
import {
  addLog,
  compressImageFile,
  fmt,
  fullDate,
  getIntakeTotals,
  norm,
  num,
} from '../store';
import type { PosDatabase, StockIntake, User } from '../types';
import { Modal, PhotoLightboxModal } from './Modals';

export type InvoicePaymentsFilter = 'unpaid_partial' | 'no_photo' | 'paid' | 'all';

interface InvoicePaymentsModalProps {
  db: PosDatabase;
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void;
  user: User;
  allowedStoreIds: number[];
  initialStoreId: number | 'all';
  initialFilter?: InvoicePaymentsFilter;
  onClose: () => void;
  notify: (msg: string) => void;
}

export const InvoicePaymentsModal: React.FC<InvoicePaymentsModalProps> = ({
  db,
  upd,
  user,
  allowedStoreIds,
  initialStoreId,
  initialFilter = 'unpaid_partial',
  onClose,
  notify,
}) => {
  const [filterStatus, setFilterStatus] = useState<InvoicePaymentsFilter>(initialFilter);
  const [storeFilter, setStoreFilter] = useState<number | 'all'>(initialStoreId);
  const [query, setQuery] = useState('');
  const [payingId, setPayingId] = useState<number | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [deductFromCash, setDeductFromCash] = useState(true);
  const [previewIntakeId, setPreviewIntakeId] = useState<number | null>(null);
  const [uploadingIntakeId, setUploadingIntakeId] = useState<number | null>(null);

  const allowedStores = db.stores.filter((s) => allowedStoreIds.includes(s.id));
  const getStoreName = (id: number) =>
    db.stores.find((s) => s.id === id)?.name ?? 'المحل الرئيسي';

  const scopedIntakes = useMemo(() => {
    return db.stockIntakes
      .filter((i) => {
        if (i.status === 'rejected') return false;
        if (!allowedStoreIds.includes(i.storeId)) return false;
        if (storeFilter !== 'all' && i.storeId !== storeFilter) return false;
        return true;
      })
      .map((i) => ({
        intake: i,
        totals: getIntakeTotals(i),
      }))
      .sort((a, b) => b.intake.ts - a.intake.ts);
  }, [db.stockIntakes, allowedStoreIds, storeFilter]);

  const summary = useMemo(() => {
    let totalAll = 0;
    let totalPaid = 0;
    let totalRemaining = 0;
    let openCount = 0;
    let noPhotoCount = 0;
    for (const row of scopedIntakes) {
      totalAll += row.totals.totalCost;
      totalPaid += row.totals.paidAmount;
      totalRemaining += row.totals.remainingAmount;
      if (row.totals.remainingAmount > 0) openCount += 1;
      if (!row.intake.photoDataUrl) noPhotoCount += 1;
    }
    return { totalAll, totalPaid, totalRemaining, openCount, noPhotoCount };
  }, [scopedIntakes]);

  const filteredList = useMemo(() => {
    const q = norm(query);
    return scopedIntakes.filter(({ intake, totals }) => {
      if (
        filterStatus === 'unpaid_partial' &&
        totals.paymentStatus === 'paid'
      ) {
        return false;
      }
      if (filterStatus === 'no_photo' && Boolean(intake.photoDataUrl)) {
        return false;
      }
      if (filterStatus === 'paid' && totals.paymentStatus !== 'paid') {
        return false;
      }
      if (!q) return true;
      const inId = String(intake.id).includes(q);
      const inSupplier = norm(intake.supplierName ?? '').includes(q);
      const inNote = norm(intake.note ?? '').includes(q);
      const inItems = intake.items.some((x) => norm(x.name).includes(q));
      const inBy = norm(intake.enteredBy).includes(q);
      return inId || inSupplier || inNote || inItems || inBy;
    });
  }, [scopedIntakes, filterStatus, query]);

  const savePhotoForIntake = (intake: StockIntake, photoDataUrl: string) => {
    const storeName = getStoreName(intake.storeId);
    const hadPhoto = Boolean(intake.photoDataUrl);
    upd((d) => {
      const target = d.stockIntakes.find((x) => x.id === intake.id);
      if (!target) return d;
      target.photoDataUrl = photoDataUrl;
      addLog(
        d,
        user.name,
        `[${storeName}] ${hadPhoto ? 'تحديث' : 'إضافة'} صورة فاتورة قديمة #${intake.id}${intake.supplierName ? ` (${intake.supplierName})` : ''}`,
        intake.storeId
      );
      return d;
    });
    notify(
      hadPhoto
        ? `تم تحديث صورة الفاتورة #${intake.id}`
        : `تمت إضافة صورة للفاتورة #${intake.id} بنجاح`
    );
  };

  const handleAttachPhotoFile = async (
    intake: StockIntake,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingIntakeId(intake.id);
    try {
      const compressed = await compressImageFile(file);
      savePhotoForIntake(intake, compressed);
    } catch {
      notify('تعذر معالجة صورة الفاتورة');
    } finally {
      setUploadingIntakeId(null);
    }
  };

  const previewIntake =
    previewIntakeId !== null
      ? db.stockIntakes.find((x) => x.id === previewIntakeId) ?? null
      : null;

  const startPay = (intake: StockIntake, remainingAmount: number) => {
    setPayingId(intake.id);
    setPayAmount(String(remainingAmount));
    setPayNote('');
    setDeductFromCash(true);
  };

  const submitPayment = (
    e: React.FormEvent,
    intake: StockIntake,
    remainingAmount: number
  ) => {
    e.preventDefault();
    const val = Math.round(num(payAmount) * 100) / 100;
    if (val <= 0) {
      notify('أدخل قيمة الدفعة أكبر من صفر');
      return;
    }
    if (val > remainingAmount + 0.01) {
      notify(`المبلغ يتجاوز المتبقي من الفاتورة (${fmt(remainingAmount)})`);
      return;
    }

    const actualPay = Math.min(val, remainingAmount);
    const nextRemaining = Math.max(
      0,
      Math.round((remainingAmount - actualPay) * 100) / 100
    );
    const storeName = getStoreName(intake.storeId);

    upd((d) => {
      const target = d.stockIntakes.find((x) => x.id === intake.id);
      if (!target) return d;
      if (!Array.isArray(target.payments)) target.payments = [];
      target.payments.push({
        id: d.nid++,
        amount: actualPay,
        by: user.name,
        role: user.role,
        ts: Date.now(),
        note: payNote.trim() || undefined,
        deductFromCash,
      });
      addLog(
        d,
        user.name,
        `[${storeName}] سداد دفعة لفاتورة #${intake.id}${intake.supplierName ? ` (${intake.supplierName})` : ''}: ${fmt(actualPay)} · المتبقي: ${fmt(nextRemaining)}`,
        intake.storeId
      );
      return d;
    });

    setPayingId(null);
    setPayAmount('');
    setPayNote('');
    notify(
      nextRemaining <= 0
        ? `تم تسكير حساب الفاتورة #${intake.id} بالكامل`
        : `تم تسجيل دفعة بقيمة ${fmt(actualPay)} (المتبقي ${fmt(nextRemaining)})`
    );
  };

  return (
    <>
      <Modal
        title="متابعة وتسديد فواتير البضاعة (المدفوع والمتبقي والدفعات)"
        onClose={onClose}
        maxWidth="max-w-3xl"
      >
        <div className="space-y-4">
          {/* Quick KPI Strip */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                إجمالي قيمة الفواتير
              </span>
              <p className="font-num mt-1 text-lg font-bold text-[#38608f] dark:text-[#78a8de]">
                {fmt(summary.totalAll)}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-800/80 dark:bg-emerald-950/30">
              <span className="text-xs text-emerald-700 dark:text-emerald-300">
                المدفوع حتى الآن
              </span>
              <p className="font-num mt-1 text-lg font-bold text-emerald-700 dark:text-emerald-400">
                {fmt(summary.totalPaid)}
              </p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-3 dark:border-rose-800/80 dark:bg-rose-950/30">
              <span className="text-xs text-rose-700 dark:text-rose-300">
                المتبقي علينا ({summary.openCount} فاتورة مفتوحة)
              </span>
              <p className="font-num mt-1 text-lg font-bold text-rose-700 dark:text-rose-400">
                {fmt(summary.totalRemaining)}
              </p>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
              {(
                [
                  ['unpaid_partial', `متبقي عليها (${summary.openCount})`],
                  ['no_photo', `بدون صورة (${summary.noPhotoCount})`],
                  ['paid', 'مسددة بالكامل'],
                  ['all', `الكل (${scopedIntakes.length})`],
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
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-800 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                >
                  <option value="all">كل الفروع المتاحة</option>
                  {allowedStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}

              <div className="relative">
                <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  placeholder="بحث برقم الفاتورة، المورد، الصنف..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-56 rounded-lg border border-slate-300 bg-white py-1.5 pr-8 pl-3 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>
          </div>

          {/* Invoice List */}
          {filteredList.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              لا توجد فواتير ضمن هذا التصنيف
            </div>
          ) : (
            <div className="space-y-3">
              {filteredList.map(({ intake, totals }) => {
                const {
                  totalCost,
                  paidAmount,
                  remainingAmount,
                  paymentStatus,
                } = totals;
                const progressPct =
                  totalCost > 0
                    ? Math.min(100, Math.round((paidAmount / totalCost) * 100))
                    : 0;
                const payments = intake.payments ?? [];
                const isPaying = payingId === intake.id;

                return (
                  <div
                    key={intake.id}
                    className={`rounded-xl border p-4 transition-colors ${
                      paymentStatus === 'paid'
                        ? 'border-emerald-200 bg-emerald-50/30 dark:border-emerald-900/50 dark:bg-emerald-950/15'
                        : paymentStatus === 'partial'
                          ? 'border-amber-300 bg-amber-50/30 dark:border-amber-800/70 dark:bg-amber-950/15'
                          : 'border-rose-200 bg-rose-50/30 dark:border-rose-900/50 dark:bg-rose-950/15'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-num text-sm font-bold text-slate-900 dark:text-slate-100">
                            فاتورة #{intake.id}
                          </span>
                          <span className="rounded bg-slate-200/80 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {getStoreName(intake.storeId)}
                          </span>
                          {intake.supplierName && (
                            <span className="rounded bg-[#38608f]/15 px-2 py-0.5 text-[11px] font-semibold text-[#38608f] dark:text-[#98c1f0]">
                              المورد: {intake.supplierName}
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold ${
                              paymentStatus === 'paid'
                                ? 'bg-emerald-600 text-white'
                                : paymentStatus === 'partial'
                                  ? 'bg-amber-500 text-slate-950'
                                  : 'bg-rose-600 text-white'
                            }`}
                          >
                            {paymentStatus === 'paid' ? (
                              <>
                                <CheckCircle2 className="h-3 w-3" />
                                <span>مسددة بالكامل</span>
                              </>
                            ) : paymentStatus === 'partial' ? (
                              <>
                                <Clock className="h-3 w-3" />
                                <span>دفعة جزئية</span>
                              </>
                            ) : (
                              <span>غير مدفوعة (على الحساب)</span>
                            )}
                          </span>
                        </div>
                        <p className="font-num mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {fullDate(intake.ts)} · أدخلها: {intake.enteredBy}
                          {intake.note ? ` · ${intake.note}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {intake.photoDataUrl ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setPreviewIntakeId(intake.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
                            >
                              <ImageIcon className="h-3.5 w-3.5" />
                              <span>عرض الصورة</span>
                            </button>
                            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap">
                              <Upload className="h-3.5 w-3.5" />
                              <span>
                                {uploadingIntakeId === intake.id
                                  ? 'جاري الحفظ...'
                                  : 'تحديث الصورة'}
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => handleAttachPhotoFile(intake, e)}
                                className="hidden"
                              />
                            </label>
                          </>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-[#38608f] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#2d4f77] whitespace-nowrap">
                              <Camera className="h-3.5 w-3.5" />
                              <span>
                                {uploadingIntakeId === intake.id
                                  ? 'جاري الحفظ...'
                                  : 'تصوير إضافة صورة'}
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={(e) => handleAttachPhotoFile(intake, e)}
                                className="hidden"
                              />
                            </label>
                            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap">
                              <Upload className="h-3.5 w-3.5" />
                              <span>رفع صورة</span>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => handleAttachPhotoFile(intake, e)}
                                className="hidden"
                              />
                            </label>
                          </div>
                        )}
                        {remainingAmount > 0 && !isPaying && (
                          <button
                            type="button"
                            onClick={() => startPay(intake, remainingAmount)}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>تسجيل دفعة</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Items summary */}
                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                      الأصناف:{' '}
                      {intake.items
                        .map((item) => `${item.name} × ${item.qty}`)
                        .join(' ، ')}
                    </p>

                    {/* Paid / Remaining Amounts + Progress */}
                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-center text-xs dark:border-slate-800 dark:bg-slate-900">
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">
                          إجمالي الفاتورة
                        </span>
                        <p className="font-num mt-0.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                          {fmt(totalCost)}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">
                          المدفوع
                        </span>
                        <p className="font-num mt-0.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                          {fmt(paidAmount)}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">
                          المتبقي علينا
                        </span>
                        <p
                          className={`font-num mt-0.5 text-sm font-bold ${
                            remainingAmount > 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {fmt(remainingAmount)}
                        </p>
                      </div>
                    </div>

                    {/* Visual Progress Bar */}
                    <div className="mt-2 flex items-center gap-2">
                      <progress
                        value={progressPct}
                        max={100}
                        className={`h-2 flex-1 overflow-hidden rounded [&::-webkit-progress-bar]:bg-slate-200 dark:[&::-webkit-progress-bar]:bg-slate-800 ${
                          progressPct >= 100
                            ? '[&::-webkit-progress-value]:bg-emerald-600 [&::-moz-progress-bar]:bg-emerald-600'
                            : '[&::-webkit-progress-value]:bg-amber-500 [&::-moz-progress-bar]:bg-amber-500'
                        }`}
                      />
                      <span className="font-num text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        {progressPct}%
                      </span>
                    </div>

                    {/* Chronological Payment Installments */}
                    {payments.length > 0 && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-800 dark:bg-slate-900">
                        <p className="mb-1.5 flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300">
                          <CreditCard className="h-3.5 w-3.5 text-emerald-600" />
                          <span>سجل الدفعات المسددة ({payments.length}):</span>
                        </p>
                        <div className="space-y-1 divide-y divide-slate-100 dark:divide-slate-800">
                          {payments.map((p, idx) => (
                            <div
                              key={p.id}
                              className="flex flex-wrap items-center justify-between gap-2 pt-1 first:pt-0"
                            >
                              <span className="text-slate-600 dark:text-slate-300">
                                دفعة #{idx + 1}: دفعها <strong>{p.by}</strong>
                                {p.deductFromCash ? ' (من الصندوق)' : ' (دفع خارجي)'}
                                {p.note ? ` · ${p.note}` : ''}
                              </span>
                              <span className="font-num font-bold text-emerald-600 dark:text-emerald-400">
                                {fmt(p.amount)} · {fullDate(p.ts)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Inline Installment Form */}
                    {isPaying && (
                      <form
                        onSubmit={(e) => submitPayment(e, intake, remainingAmount)}
                        className="mt-3 space-y-2.5 rounded-lg border border-[#38608f]/40 bg-white p-3 dark:border-[#4f7fb5]/50 dark:bg-slate-900"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-xs font-bold text-[#38608f] dark:text-[#78a8de]">
                            <Wallet className="h-3.5 w-3.5" />
                            <span>إضافة دفعة جديدة لفاتورة #{intake.id}</span>
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setPayAmount(String(remainingAmount))}
                              className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                            >
                              كامل المتبقي ({fmt(remainingAmount)})
                            </button>
                            {remainingAmount > 2 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPayAmount(
                                    String(Math.round((remainingAmount / 2) * 100) / 100)
                                  )
                                }
                                className="rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              >
                                نصف المتبقي
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <input
                            type="number"
                            step="any"
                            min="0.01"
                            inputMode="decimal"
                            placeholder="قيمة الدفعة"
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value)}
                            className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                          />
                          <input
                            placeholder="ملاحظة عن الدفعة (اختياري)..."
                            value={payNote}
                            onChange={(e) => setPayNote(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                          />
                        </div>

                        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={deductFromCash}
                            onChange={(e) => setDeductFromCash(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-[#38608f]"
                          />
                          <span>خصم قيمة الدفعة من صندوق الفرع</span>
                        </label>

                        <div className="flex gap-2">
                          <button
                            type="submit"
                            className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                          >
                            تأكيد تسجيل الدفعة
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayingId(null)}
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

      {previewIntake && (
        <PhotoLightboxModal
          intake={previewIntake}
          storeName={getStoreName(previewIntake.storeId)}
          onClose={() => setPreviewIntakeId(null)}
          onAttachPhoto={savePhotoForIntake}
          notify={notify}
        />
      )}
    </>
  );
};
