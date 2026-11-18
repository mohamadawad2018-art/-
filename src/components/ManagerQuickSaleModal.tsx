import React, { useState } from 'react';
import { Minus, Plus, Receipt, Search, Store, Trash2, X } from 'lucide-react';
import { addLog, buildDiscountedSaleItems, fmt, matchesQuery } from '../store';
import type { CartItem, PosDatabase, Product, Sale, User } from '../types';
import { InvoiceModal, Modal } from './Modals';
import { SaleConfirmModal } from './SaleConfirmModal';

interface ManagerQuickSaleModalProps {
  db: PosDatabase;
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void;
  user: User;
  defaultStoreId: number;
  notify: (msg: string) => void;
  onClose: () => void;
}

export const ManagerQuickSaleModal: React.FC<ManagerQuickSaleModalProps> = ({
  db,
  upd,
  user,
  defaultStoreId,
  notify,
  onClose,
}) => {
  const [storeId, setStoreId] = useState<number>(defaultStoreId);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [draftPrices, setDraftPrices] = useState<Record<number, string>>({});
  const [confirmDiscountOpen, setConfirmDiscountOpen] = useState(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);

  const storeName =
    db.stores.find((s) => s.id === storeId)?.name ?? 'المحل الرئيسي';
  const storeProducts = db.products.filter((p) => p.storeId === storeId);
  const filteredProducts = storeProducts.filter((p) =>
    matchesQuery(p.name, query)
  );

  const stockOf = (id: number) =>
    storeProducts.find((p) => p.id === id)?.stock ?? 0;

  const handleStoreChange = (nextStoreId: number) => {
    setStoreId(nextStoreId);
    setCart([]);
    setDraftPrices({});
    setQuery('');
  };

  const addToCart = (p: Product) => {
    const existing = cart.find((x) => x.id === p.id);
    const nextQty = existing ? existing.qty + 1 : 1;
    if (nextQty > p.stock) {
      notify(`الكمية المتوفرة بالمخزون: ${p.stock}`);
      return;
    }
    setCart(
      existing
        ? cart.map((x) => (x.id === p.id ? { ...x, qty: nextQty } : x))
        : [
            ...cart,
            {
              id: p.id,
              name: p.name,
              min: p.min,
              cost: p.cost,
              qty: 1,
              price: p.price,
            },
          ]
    );
  };

  const changeQty = (id: number, delta: number) => {
    const existing = cart.find((x) => x.id === id);
    if (!existing) return;
    const nextQty = existing.qty + delta;
    if (nextQty > stockOf(id)) {
      notify('لا يوجد مخزون كافٍ');
      return;
    }
    setCart(
      nextQty <= 0
        ? cart.filter((x) => x.id !== id)
        : cart.map((x) => (x.id === id ? { ...x, qty: nextQty } : x))
    );
  };

  const commitPriceBlur = (c: CartItem) => {
    const raw = draftPrices[c.id];
    if (raw === undefined) return;
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed) || parsed < c.min) {
      notify(`لا يمكن البيع بأقل من الحد الأدنى (${fmt(c.min)})`);
    } else {
      setCart(cart.map((x) => (x.id === c.id ? { ...x, price: parsed } : x)));
    }
    setDraftPrices(({ [c.id]: _, ...rest }) => rest);
  };

  const total = cart.reduce((acc, c) => acc + c.qty * c.price, 0);

  const finalizeEmergencySale = (discountAmount: number, discountNote: string) => {
    if (cart.length === 0) return;
    const nowTs = Date.now();
    const { items, subtotalBeforeDiscount, discount, netTotal } =
      buildDiscountedSaleItems(cart, discountAmount);

    const sale: Sale = {
      id: db.nid,
      storeId,
      emp: user.name,
      items,
      total: netTotal,
      discount: discount > 0 ? discount : undefined,
      subtotalBeforeDiscount: discount > 0 ? subtotalBeforeDiscount : undefined,
      ts: nowTs,
    };

    upd((d) => {
      sale.items.forEach((item) => {
        const prod = d.products.find((p) => p.id === item.id);
        if (prod) {
          const prevStock = prod.stock;
          prod.stock -= item.qty;
          const threshold = prod.minStock ?? 3;
          if (prevStock > threshold && prod.stock <= threshold) {
            addLog(
              d,
              'النظام',
              `[${storeName}] تنبيه تلقائي: وصول "${prod.name}" إلى الحد الأدنى للمخزون (${prod.stock} / ${threshold})`,
              storeId
            );
          }
        }
      });
      d.sales.unshift(sale);
      d.nid++;

      if (discount > 0) {
        if (!Array.isArray(d.discounts)) d.discounts = [];
        const totalUnits = sale.items.reduce((a, i) => a + i.qty, 0);
        d.discounts.unshift({
          id: d.nid++,
          saleId: sale.id,
          storeId,
          emp: user.name,
          role: user.role,
          amount: discount,
          subtotalBefore: subtotalBeforeDiscount,
          netTotal,
          itemCount: totalUnits,
          note: discountNote || undefined,
          ts: nowTs,
        });
      }

      sale.items.forEach((item) => {
        addLog(
          d,
          user.name,
          `[${storeName}] بيع طارئ (إدارة) فاتورة #${sale.id} — ${item.name} × ${item.qty} (${fmt(item.qty * item.price)})${
            item.discountShare ? ` [خصم: ${fmt(item.discountShare)}]` : ''
          }`,
          storeId
        );
      });
      return d;
    });

    setCart([]);
    setDraftPrices({});
    setConfirmDiscountOpen(false);
    setCompletedSale(sale);
    notify(`تم إصدار فاتورة البيع الطارئ #${sale.id} من فرع "${storeName}"`);
  };

  if (completedSale) {
    return (
      <InvoiceModal
        sale={completedSale}
        storeName={storeName}
        onClose={() => {
          setCompletedSale(null);
          onClose();
        }}
      />
    );
  }

  if (confirmDiscountOpen && cart.length > 0) {
    return (
      <SaleConfirmModal
        cart={cart}
        storeName={storeName}
        sellerName={user.name}
        invoiceNumber={db.nid}
        onConfirm={finalizeEmergencySale}
        onClose={() => setConfirmDiscountOpen(false)}
      />
    );
  }

  return (
    <Modal
      title="بيع طارئ مباشر (صلاحية المدير / المالك)"
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      <div className="space-y-4">
        {/* Top bar: Store Selection & Next Invoice Number */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-wrap items-center gap-2">
            <Store className="h-4 w-4 text-[#38608f] dark:text-[#78a8de]" />
            <label
              htmlFor="emergency-sale-store"
              className="text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              البيع من مخزن فرع:
            </label>
            <select
              id="emergency-sale-store"
              value={storeId}
              onChange={(e) => handleStoreChange(Number(e.target.value))}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {db.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="font-num text-xs text-slate-500 dark:text-slate-400">
            البائع: <strong className="text-slate-800 dark:text-slate-200">{user.name}</strong> · الفاتورة #{db.nid}
          </div>
        </div>

        {/* Live Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            placeholder={`ابحث في مخزون "${storeName}" بالاسم أو أول حروفه...`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim()) {
                e.preventDefault();
                const firstAvailable = filteredProducts.find((p) => p.stock > 0);
                if (firstAvailable) {
                  addToCart(firstAvailable);
                  setQuery('');
                }
              }
            }}
            className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-9 pl-9 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="مسح البحث"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Matching Products Grid */}
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {query.trim()
                ? `النتائج المطابقة في ${storeName}`
                : `أصناف مخزون ${storeName}`}
            </span>
            <span className="font-num font-semibold">
              {filteredProducts.length} صنف
            </span>
          </div>

          {filteredProducts.length > 0 ? (
            <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {filteredProducts.map((p) => {
                const outOfStock = p.stock <= 0;
                const isLow = p.stock > 0 && p.stock <= (p.minStock ?? 3);
                const inCartQty = cart.find((item) => item.id === p.id)?.qty ?? 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={outOfStock}
                    onClick={() => addToCart(p)}
                    className={`flex items-center justify-between gap-3 rounded-lg border p-2.5 text-right transition-colors ${
                      outOfStock
                        ? 'cursor-not-allowed border-slate-200 bg-slate-100/70 text-slate-400 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-500'
                        : 'border-slate-200 bg-slate-50/70 hover:border-emerald-500 hover:bg-emerald-50/60 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/30'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                          {p.name}
                        </span>
                        {inCartQty > 0 && (
                          <span className="font-num rounded bg-[#38608f] px-1.5 py-0.5 text-[11px] font-semibold text-white whitespace-nowrap">
                            بالفاتورة: {inCartQty}
                          </span>
                        )}
                      </div>
                      <div className="font-num mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                          السعر: {fmt(p.price)}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">
                          الأدنى: {fmt(p.min)}
                        </span>
                        <span
                          className={`font-semibold ${
                            outOfStock
                              ? 'text-rose-600 dark:text-rose-400'
                              : isLow
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          المتوفر: {p.stock}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${
                        outOfStock
                          ? 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-500'
                          : 'bg-emerald-600 text-white'
                      }`}
                    >
                      {outOfStock ? 'نفد' : 'إضافة +'}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-4 py-5 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400">
              لا توجد أصناف مطابقة في مخزون «{storeName}»
            </div>
          )}
        </div>

        {/* Emergency Sale Cart */}
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                <th className="px-3 py-2 text-right font-semibold">المنتج</th>
                <th className="px-3 py-2 text-center font-semibold">العدد</th>
                <th className="px-3 py-2 text-center font-semibold">السعر</th>
                <th className="px-3 py-2 text-center font-semibold">الإجمالي</th>
                <th className="px-3 py-2 text-center font-semibold">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {cart.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400"
                  >
                    اختر المنتجات من القائمة أعلاه لإضافتها لفاتورة البيع الطارئ
                  </td>
                </tr>
              ) : (
                cart.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => changeQty(c.id, -1)}
                          className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="font-num min-w-[24px] text-center font-semibold">
                          {c.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeQty(c.id, 1)}
                          className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        inputMode="numeric"
                        value={draftPrices[c.id] ?? String(c.price)}
                        onChange={(e) =>
                          setDraftPrices((prev) => ({
                            ...prev,
                            [c.id]: e.target.value,
                          }))
                        }
                        onBlur={() => commitPriceBlur(c)}
                        className="font-num w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-center text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                      />
                    </td>
                    <td className="font-num px-3 py-2 text-center font-semibold">
                      {fmt(c.qty * c.price)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setCart(cart.filter((x) => x.id !== c.id))
                        }
                        aria-label={`حذف ${c.name}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Total & Submit Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-slate-800">
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              إجمالي الفاتورة:
            </span>
            <span className="font-num mr-2 text-xl font-bold text-emerald-600 dark:text-emerald-400">
              {fmt(total)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              إلغاء
            </button>
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={() => setConfirmDiscountOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
            >
              <Receipt className="h-4 w-4" />
              <span>تأكيد وإصدار الفاتورة</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
