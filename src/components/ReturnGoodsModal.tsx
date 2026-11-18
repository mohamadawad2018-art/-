import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Package,
  RotateCcw,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  addLog,
  fmt,
  getUnpaidGoodsWithdrawalsForUser,
  getWithdrawalWholesaleTotal,
  norm,
  num,
  tm,
} from '../store';
import type { PosDatabase, Product, Sale, SaleItem, User } from '../types';
import { Modal } from './Modals';

interface ReturnGoodsModalProps {
  db: PosDatabase;
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void;
  user: User;
  storeId: number;
  storeName: string;
  todaySales: Sale[];
  onClose: () => void;
  notify: (msg: string) => void;
}

type PendingReturnTarget =
  | {
      mode: 'sale';
      sale: Sale;
      item: SaleItem;
      maxQty: number;
      defaultUnitPrice: number;
      unitCost: number;
    }
  | {
      mode: 'direct_product';
      product: Product;
      maxQty: number;
      defaultUnitPrice: number;
      unitCost: number;
      preselectedStaffName?: string;
    };

export const ReturnGoodsModal: React.FC<ReturnGoodsModalProps> = ({
  db,
  upd,
  user,
  storeId,
  storeName,
  todaySales,
  onClose,
  notify,
}) => {
  const [pickTab, setPickTab] = useState<'sales' | 'direct'>('sales');
  const [pendingTarget, setPendingTarget] = useState<PendingReturnTarget | null>(
    null
  );

  // Confirmation & edit step state
  const [retQty, setRetQty] = useState('1');
  const [sourceType, setSourceType] = useState<'customer' | 'staff'>('customer');
  const [staffName, setStaffName] = useState(db.users[0]?.name ?? user.name);
  const [settlementType, setSettlementType] = useState<'cash' | 'goods'>('cash');
  const [unitRefundStr, setUnitRefundStr] = useState('0');
  const [offsetUnpaidWithdrawal, setOffsetUnpaidWithdrawal] = useState(true);
  const [note, setNote] = useState('');

  // Direct staff product selection state
  const [directStaffName, setDirectStaffName] = useState(user.name);
  const [directProdId, setDirectProdId] = useState('');

  const storeProducts = useMemo(
    () => db.products.filter((p) => p.storeId === storeId),
    [db.products, storeId]
  );

  const openConfirmForSaleItem = (sale: Sale, item: SaleItem) => {
    const avail = Math.max(0, item.qty - item.ret);
    if (avail <= 0) return;
    setPendingTarget({
      mode: 'sale',
      sale,
      item,
      maxQty: avail,
      defaultUnitPrice: item.price,
      unitCost: item.cost,
    });
    setRetQty('1');
    setSourceType('customer');
    setStaffName(db.users[0]?.name ?? user.name);
    setSettlementType('cash');
    setUnitRefundStr(String(item.price));
    setOffsetUnpaidWithdrawal(true);
    setNote('');
  };

  const openConfirmForDirectProduct = (
    product: Product,
    preStaff?: string,
    defaultSettlement: 'cash' | 'goods' = 'goods'
  ) => {
    setPendingTarget({
      mode: 'direct_product',
      product,
      maxQty: 100,
      defaultUnitPrice: product.price,
      unitCost: product.cost,
      preselectedStaffName: preStaff,
    });
    setRetQty('1');
    setSourceType(preStaff ? 'staff' : 'customer');
    setStaffName(preStaff || db.users[0]?.name || user.name);
    setSettlementType(defaultSettlement);
    setUnitRefundStr(String(product.cost));
    setOffsetUnpaidWithdrawal(true);
    setNote('');
  };

  const selectedStaffUser = db.users.find((u) => u.name === staffName);
  const staffUnpaidWithdrawals = useMemo(() => {
    if (sourceType !== 'staff' || !staffName) return [];
    return getUnpaidGoodsWithdrawalsForUser(db, staffName, [storeId], true);
  }, [db, sourceType, staffName, storeId]);

  const parsedQty = Math.max(
    1,
    Math.min(pendingTarget?.maxQty ?? 1, Math.floor(num(retQty) || 1))
  );
  const effectiveUnitRefund =
    settlementType === 'cash' ? Math.max(0, num(unitRefundStr)) : 0;
  const totalRefundPreview =
    Math.round(effectiveUnitRefund * parsedQty * 100) / 100;
  const goodsWholesalePreview =
    Math.round((pendingTarget?.unitCost ?? 0) * parsedQty * 100) / 100;

  const handleConfirmReturn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingTarget) return;

    const itemName =
      pendingTarget.mode === 'sale'
        ? pendingTarget.item.name
        : pendingTarget.product.name;
    const itemId =
      pendingTarget.mode === 'sale'
        ? pendingTarget.item.id
        : pendingTarget.product.id;

    if (parsedQty <= 0 || parsedQty > pendingTarget.maxQty) {
      notify(`أدخل كمية مرتجعة صالحة (بين 1 و ${pendingTarget.maxQty})`);
      return;
    }

    if (sourceType === 'staff' && !staffName) {
      notify('اختر اسم الموظف أو المدير المرجِع للبضاعة');
      return;
    }

    if (settlementType === 'cash' && effectiveUnitRefund <= 0) {
      notify('أدخل قيمة الخصم/الاسترداد النقدي للقطعة');
      return;
    }

    upd((d) => {
      if (pendingTarget.mode === 'sale') {
        const targetSale = d.sales.find((x) => x.id === pendingTarget.sale.id);
        const targetItem = targetSale?.items.find((x) => x.id === itemId);
        if (!targetItem || targetItem.ret + parsedQty > targetItem.qty) {
          return d;
        }
        targetItem.ret += parsedQty;
      }

      const prod = d.products.find(
        (p) =>
          p.id === itemId ||
          (p.storeId === storeId && norm(p.name) === norm(itemName))
      );
      if (prod) {
        prod.stock += parsedQty;
      }

      const nowTs = Date.now();
      d.returns.unshift({
        storeId,
        name: itemName,
        price: effectiveUnitRefund,
        qty: parsedQty,
        emp: user.name,
        ts: nowTs,
        sale: pendingTarget.mode === 'sale' ? pendingTarget.sale.id : 0,
        sourceType,
        staffName: sourceType === 'staff' ? staffName : undefined,
        staffUserId:
          sourceType === 'staff' ? selectedStaffUser?.id : undefined,
        settlementType,
        goodsValue: goodsWholesalePreview,
        note: note.trim() || undefined,
      });

      // If staff goods return & offsetting unpaid withdrawal
      if (
        sourceType === 'staff' &&
        settlementType === 'goods' &&
        offsetUnpaidWithdrawal
      ) {
        const targetNorm = norm(staffName);
        let qtyLeftToOffset = parsedQty;
        for (const w of d.withdrawals) {
          if (qtyLeftToOffset <= 0) break;
          if (
            w.type !== 'goods' ||
            w.status === 'rejected' ||
            w.paid ||
            w.storeId !== storeId ||
            norm(w.takenBy || w.emp) !== targetNorm
          ) {
            continue;
          }
          const matchingLine = w.items.find(
            (wi) => wi.id === itemId || norm(wi.name) === norm(itemName)
          );
          if (matchingLine && matchingLine.qty > 0) {
            const deductQty = Math.min(qtyLeftToOffset, matchingLine.qty);
            matchingLine.qty -= deductQty;
            qtyLeftToOffset -= deductQty;
            w.items = w.items.filter((wi) => wi.qty > 0);
            const nextWholesale = getWithdrawalWholesaleTotal(w, d.products);
            w.amount = nextWholesale;
            if (w.items.length === 0 || nextWholesale <= 0) {
              w.paid = true;
              w.paidAmount = 0;
              w.paidAt = nowTs;
              w.paidBy = user.name;
              w.settlementMethod = 'return_offset';
              w.note = w.note
                ? `${w.note} · تم إرجاع البضاعة للمخزن`
                : 'تم إرجاع البضاعة للمخزن';
            } else {
              w.note = w.note
                ? `${w.note} · أُرجع ${deductQty} × ${itemName}`
                : `أُرجع ${deductQty} × ${itemName}`;
            }
          }
        }
      }

      const sourceLabel =
        sourceType === 'staff'
          ? `من ${staffName} (${
              selectedStaffUser?.owner
                ? 'مالك'
                : selectedStaffUser?.role === 'manager'
                  ? 'مدير'
                  : 'أحد العاملين'
            })`
          : 'من زبون';
      const settleLabel =
        settlementType === 'cash'
          ? `خصم مصاري: ${fmt(totalRefundPreview)}`
          : `ترجيع بضاعة للمخزن (جملة: ${fmt(goodsWholesalePreview)})`;

      addLog(
        d,
        user.name,
        `[${storeName}] مرتجع ${itemName} × ${parsedQty} (${sourceLabel} · ${settleLabel})${
          pendingTarget.mode === 'sale'
            ? ` من فاتورة #${pendingTarget.sale.id}`
            : ' (مباشر)'
        }${note.trim() ? ` · ${note.trim()}` : ''}`,
        storeId
      );
      return d;
    });

    notify(
      settlementType === 'cash'
        ? `تم تسجيل المرتجع وخصم ${fmt(totalRefundPreview)} (${itemName} × ${parsedQty})`
        : `تم إرجاع ${itemName} × ${parsedQty} إلى المخزن وتسوية البضاعة`
    );
    onClose();
  };

  if (pendingTarget) {
    const itemName =
      pendingTarget.mode === 'sale'
        ? pendingTarget.item.name
        : pendingTarget.product.name;

    return (
      <Modal
        title="تأكيد وتعديل المرتجع قبل الإتمام"
        onClose={onClose}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleConfirmReturn} className="space-y-4">
          {/* Selected Item Card */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {itemName}
              </span>
              <span className="font-num rounded bg-[#38608f]/15 px-2 py-0.5 text-xs font-semibold text-[#38608f] dark:text-[#98c1f0]">
                {pendingTarget.mode === 'sale'
                  ? `فاتورة #${pendingTarget.sale.id}`
                  : 'ترجيع مباشر للمخزن'}
              </span>
            </div>
            <p className="font-num mt-1 text-xs text-slate-500 dark:text-slate-400">
              سعر المبيع الأصلي: {fmt(pendingTarget.defaultUnitPrice)} · سعر الجملة:{' '}
              {fmt(pendingTarget.unitCost)}
              {pendingTarget.mode === 'sale'
                ? ` · المتاح للترجيع: ${pendingTarget.maxQty}`
                : ''}
            </p>
          </div>

          {/* Quantity & Source */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                الكمية المرتجعة (قابل للتعديل)
              </label>
              <input
                type="number"
                min={1}
                max={pendingTarget.maxQty}
                value={retQty}
                onChange={(e) => setRetQty(e.target.value)}
                className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                نوع الخصم / التسوية
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setSettlementType('cash')}
                  className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                    settlementType === 'cash'
                      ? 'border-rose-600 bg-rose-600 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                  }`}
                >
                  خصم مصاري
                </button>
                <button
                  type="button"
                  onClick={() => setSettlementType('goods')}
                  className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                    settlementType === 'goods'
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                  }`}
                >
                  ترجيع بضاعة
                </button>
              </div>
            </div>
          </div>

          {/* Return Source: Customer vs Staff */}
          <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">
              من الذي أرجع الغرض؟
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSourceType('customer')}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  sourceType === 'customer'
                    ? 'border-[#38608f] bg-[#38608f] text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                <span>زبون</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceType('staff')}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  sourceType === 'staff'
                    ? 'border-amber-500 bg-amber-500 text-slate-950'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <UserCheck className="h-3.5 w-3.5" />
                <span>أحد العاملين بالشركة</span>
              </button>
            </div>

            {sourceType === 'staff' && (
              <div className="space-y-2 pt-1">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  اختر الموظف / المدير / المالك
                </label>
                <select
                  value={staffName}
                  onChange={(e) => setStaffName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                >
                  {db.users.map((u) => (
                    <option key={u.id} value={u.name}>
                      {u.name} ({u.owner ? 'مالك' : u.role === 'manager' ? 'مدير' : 'موظف'})
                    </option>
                  ))}
                </select>

                {settlementType === 'goods' && staffUnpaidWithdrawals.length > 0 && (
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    <input
                      type="checkbox"
                      checked={offsetUnpaidWithdrawal}
                      onChange={(e) => setOffsetUnpaidWithdrawal(e.target.checked)}
                      className="h-4 w-4 rounded border-amber-400 text-[#38608f]"
                    />
                    <span>
                      يوجد على {staffName} مسحوبات غير محاسب عليها — خصم هذا الصنف تلقائياً من مسحوباته عند التطابق
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Settlement Details (Editable Refund Amount or Goods Restock Summary) */}
          {settlementType === 'cash' ? (
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-3 sm:grid-cols-2 dark:border-rose-900/50 dark:bg-rose-950/25">
              <div>
                <label className="mb-1 block text-xs font-semibold text-rose-800 dark:text-rose-300">
                  مبلغ الاسترداد / الخصم للقطعة (قابل للتعديل)
                </label>
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={unitRefundStr}
                  onChange={(e) => setUnitRefundStr(e.target.value)}
                  className="font-num w-full rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:outline-none dark:border-rose-800 dark:bg-slate-950"
                />
              </div>
              <div className="flex flex-col justify-center">
                <span className="text-xs text-rose-700 dark:text-rose-300">
                  إجمالي المبلغ المخصوم من الصندوق:
                </span>
                <span className="font-num text-lg font-bold text-rose-700 dark:text-rose-400">
                  {fmt(totalRefundPreview)}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
              <p className="font-bold">
                سيتم إرجاع {parsedQty} قطعة إلى مخزن {storeName} (قيمة جملة:{' '}
                <span className="font-num">{fmt(goodsWholesalePreview)}</span>) بدون خصم نقدي من الصندوق.
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              ملاحظة أو سبب الترجيع (اختياري)
            </label>
            <input
              placeholder="مثال: تبديل قياس، غرض مرجع من الموظف..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="flex gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
            <button
              type="submit"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
            >
              <Check className="h-4 w-4" />
              <span>تأكيد وإتمام الترجيع</span>
            </button>
            <button
              type="button"
              onClick={() => setPendingTarget(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
            >
              <ArrowRight className="h-4 w-4" />
              <span>تعديل الاختيار</span>
            </button>
          </div>
        </form>
      </Modal>
    );
  }

  const directUnpaidList = getUnpaidGoodsWithdrawalsForUser(
    db,
    directStaffName,
    [storeId],
    true
  );

  return (
    <Modal title="ترجيع غرض (مرتجع)" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
          <button
            type="button"
            onClick={() => setPickTab('sales')}
            className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
              pickTab === 'sales'
                ? 'bg-[#38608f] text-white'
                : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300'
            }`}
          >
            من فواتير المبيع ({todaySales.length})
          </button>
          <button
            type="button"
            onClick={() => setPickTab('direct')}
            className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
              pickTab === 'direct'
                ? 'bg-[#38608f] text-white'
                : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300'
            }`}
          >
            مرتجع مباشر (أحد العاملين / مخزن)
          </button>
        </div>

        {pickTab === 'sales' ? (
          !todaySales.length ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              لا توجد فواتير مبيع مسجلة اليوم
            </p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {todaySales.map((s) => (
                <div key={s.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="mb-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-num font-bold text-slate-900 dark:text-slate-100">
                      #{s.id}
                    </span>
                    <span>·</span>
                    <span className="font-num">{tm(s.ts)}</span>
                    <span>·</span>
                    <span>{s.emp}</span>
                  </div>
                  <div className="space-y-1.5">
                    {s.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <div>
                          <span>{item.name}</span>
                          <span className="font-num mr-1.5 text-xs text-slate-500 dark:text-slate-400">
                            × {item.qty} ({fmt(item.price)})
                          </span>
                          {item.ret > 0 && (
                            <span className="font-num mr-1.5 text-xs text-rose-600 dark:text-rose-400">
                              - مرتجع {item.ret}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={item.ret >= item.qty}
                          onClick={() => openConfirmForSaleItem(s, item)}
                          className="inline-flex items-center gap-1 rounded bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>اختيار للترجيع</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                اختر العامل / المدير / المالك لإرجاع غرض باسمه
              </label>
              <select
                value={directStaffName}
                onChange={(e) => setDirectStaffName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
              >
                {db.users.map((u) => (
                  <option key={u.id} value={u.name}>
                    {u.name} ({u.owner ? 'مالك' : u.role === 'manager' ? 'مدير' : 'موظف'})
                  </option>
                ))}
              </select>
            </div>

            {directUnpaidList.length > 0 && (
              <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                  أغراض مسحوبة باسم {directStaffName} لم يُحاسَب عليها:
                </p>
                <div className="space-y-1.5">
                  {directUnpaidList.map((w) => (
                    <div
                      key={w.id}
                      className="rounded-lg border border-amber-200 bg-white p-2 text-xs dark:border-amber-800/60 dark:bg-slate-900"
                    >
                      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                        <span className="font-num">سحب #{w.id}</span>
                        <span className="font-num font-bold text-rose-600">
                          جملة: {fmt(getWithdrawalWholesaleTotal(w, db.products))}
                        </span>
                      </div>
                      {w.items.map((wi) => {
                        const prod =
                          storeProducts.find((p) => p.id === wi.id) ?? {
                            id: wi.id,
                            storeId,
                            name: wi.name,
                            price: wi.cost ?? 0,
                            min: wi.cost ?? 0,
                            cost: wi.cost ?? 0,
                            stock: 0,
                            minStock: 3,
                          };
                        return (
                          <div
                            key={wi.id}
                            className="flex items-center justify-between gap-2 py-1"
                          >
                            <span>
                              {wi.name} × <strong className="font-num">{wi.qty}</strong>
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                openConfirmForDirectProduct(
                                  prod,
                                  directStaffName,
                                  'goods'
                                )
                              }
                              className="rounded bg-[#38608f] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#2d4f77] whitespace-nowrap"
                            >
                              إرجاع للمخزن
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                أو اختر أي منتج من مخزن {storeName} لترجيعه:
              </label>
              <div className="flex gap-2">
                <select
                  value={directProdId}
                  onChange={(e) => setDirectProdId(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="">-- اختر الصنف --</option>
                  {storeProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (مبيع {fmt(p.price)} · جملة {fmt(p.cost)})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const prod = storeProducts.find(
                      (p) => String(p.id) === directProdId
                    );
                    if (!prod) {
                      notify('اختر الصنف أولاً');
                      return;
                    }
                    openConfirmForDirectProduct(prod, directStaffName, 'goods');
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                >
                  <Package className="h-3.5 w-3.5" />
                  <span>متابعة</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
