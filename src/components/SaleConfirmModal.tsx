import React, { useMemo, useState } from 'react';
import { Check, Tag } from 'lucide-react';
import { buildDiscountedSaleItems, fmt, num } from '../store';
import type { CartItem } from '../types';
import { Modal } from './Modals';

interface SaleConfirmModalProps {
  cart: CartItem[];
  storeName: string;
  sellerName: string;
  invoiceNumber: number;
  onConfirm: (discountAmount: number, discountNote: string) => void;
  onClose: () => void;
}

export const SaleConfirmModal: React.FC<SaleConfirmModalProps> = ({
  cart,
  storeName,
  sellerName,
  invoiceNumber,
  onConfirm,
  onClose,
}) => {
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountInput, setDiscountInput] = useState('');
  const [discountNote, setDiscountNote] = useState('');

  const subtotalBefore = useMemo(
    () => cart.reduce((acc, c) => acc + c.qty * c.price, 0),
    [cart]
  );

  const parsedDiscount = discountOpen
    ? Math.max(0, Math.min(subtotalBefore, num(discountInput)))
    : 0;

  const preview = useMemo(
    () => buildDiscountedSaleItems(cart, parsedDiscount),
    [cart, parsedDiscount]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(parsedDiscount, discountNote.trim());
  };

  return (
    <Modal
      title={`تأكيد الفاتورة #${invoiceNumber} (${storeName})`}
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-950">
          <span className="text-slate-600 dark:text-slate-400">
            البائع: <strong className="text-slate-900 dark:text-slate-100">{sellerName}</strong>
          </span>
          <span className="font-num text-slate-600 dark:text-slate-400">
            الإجمالي قبل الخصم:{' '}
            <strong className="text-sm text-slate-900 dark:text-slate-100">
              {fmt(subtotalBefore)}
            </strong>
          </span>
        </div>

        {/* Discount Toggle Button + Input Field */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                الخصم على الفاتورة (اختياري)
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                في حال وجود خصم يُقسّم تلقائياً على القطع المباعة ويُسجّل في قسم الخصومات
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setDiscountOpen((v) => {
                  const next = !v;
                  if (!next) {
                    setDiscountInput('');
                    setDiscountNote('');
                  }
                  return next;
                });
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                discountOpen
                  ? 'bg-amber-500 text-slate-950 hover:bg-amber-600'
                  : 'border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
              }`}
            >
              <Tag className="h-3.5 w-3.5" />
              <span>{discountOpen ? 'إلغاء الخصم' : 'إضافة خصم'}</span>
            </button>
          </div>

          {discountOpen && (
            <div className="mt-3 grid grid-cols-1 gap-2.5 border-t border-slate-200 pt-3 sm:grid-cols-2 dark:border-slate-800">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  قيمة الخصم
                </label>
                <input
                  type="number"
                  min={0}
                  max={subtotalBefore}
                  step="any"
                  inputMode="decimal"
                  autoFocus
                  placeholder="أدخل مبلغ الخصم..."
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  ملاحظة / سبب الخصم (اختياري)
                </label>
                <input
                  type="text"
                  placeholder="مثال: زبون دائم / عرض..."
                  value={discountNote}
                  onChange={(e) => setDiscountNote(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>
          )}
        </div>

        {/* Breakdown Preview showing how discount is split across sold items */}
        <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                <th className="px-2.5 py-2 text-right font-semibold">البند</th>
                <th className="px-2.5 py-2 text-center font-semibold">العدد</th>
                {parsedDiscount > 0 && (
                  <th className="px-2.5 py-2 text-center font-semibold">
                    حصة الخصم
                  </th>
                )}
                <th className="px-2.5 py-2 text-left font-semibold">الصافي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {preview.items.map((it) => (
                <tr key={it.id}>
                  <td className="px-2.5 py-2 font-medium">{it.name}</td>
                  <td className="font-num px-2.5 py-2 text-center">{it.qty}</td>
                  {parsedDiscount > 0 && (
                    <td className="font-num px-2.5 py-2 text-center text-amber-700 dark:text-amber-400">
                      -{fmt(it.discountShare ?? 0)}
                    </td>
                  )}
                  <td className="font-num px-2.5 py-2 text-left font-bold">
                    {fmt(it.price * it.qty)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Final Totals & Confirm Button */}
        <div className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3.5 py-3 dark:border-emerald-800/70 dark:bg-emerald-950/30">
          {parsedDiscount > 0 && (
            <div className="flex items-center justify-between text-xs text-amber-800 dark:text-amber-300">
              <span>إجمالي الخصم الموزّع على القطع:</span>
              <span className="font-num font-bold">-{fmt(preview.discount)}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm font-bold text-slate-900 dark:text-slate-100">
            <span>الصافي النهائي للدفع:</span>
            <span className="font-num text-lg text-emerald-700 dark:text-emerald-400">
              {fmt(preview.netTotal)}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap"
          >
            <Check className="h-4 w-4" />
            <span>حفظ وإصدار الفاتورة</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            تراجع
          </button>
        </div>
      </form>
    </Modal>
  );
};
