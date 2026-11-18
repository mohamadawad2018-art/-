import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Minus,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import {
  addLog,
  fmt,
  fullDate,
  getCustomerDebtTotals,
  getUserStoreIds,
  matchesQuery,
  norm,
  num,
} from '../store';
import type {
  CustomerDebt,
  CustomerDebtItem,
  PosDatabase,
  User,
} from '../types';

export type CustomerDebtStatusFilter = 'open' | 'paid' | 'all';

interface CustomerDebtsViewProps {
  db: PosDatabase;
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void;
  user: User;
  allowedStoreIds: number[];
  initialStoreId: number | 'all';
  notify: (msg: string) => void;
}

export const CustomerDebtsView: React.FC<CustomerDebtsViewProps> = ({
  db,
  upd,
  user,
  allowedStoreIds,
  initialStoreId,
  notify,
}) => {
  const allowedStores = useMemo(
    () => db.stores.filter((s) => allowedStoreIds.includes(s.id)),
    [db.stores, allowedStoreIds]
  );

  const getStoreName = (id: number) =>
    db.stores.find((s) => s.id === id)?.name ?? 'المحل الرئيسي';

  const [storeFilter, setStoreFilter] = useState<number | 'all'>(() => {
    if (
      initialStoreId !== 'all' &&
      allowedStoreIds.includes(initialStoreId)
    ) {
      return initialStoreId;
    }
    return allowedStoreIds.length === 1 ? allowedStoreIds[0] : 'all';
  });
  const [statusFilter, setStatusFilter] =
    useState<CustomerDebtStatusFilter>('open');
  const [giverFilter, setGiverFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

  // New Debt Form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [formStoreId, setFormStoreId] = useState<number>(() =>
    initialStoreId !== 'all' && allowedStoreIds.includes(initialStoreId)
      ? initialStoreId
      : allowedStores[0]?.id ?? db.stores[0]?.id ?? 1
  );
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [givenBy, setGivenBy] = useState(user.name);
  const [debtNote, setDebtNote] = useState('');
  const [debtType, setDebtType] = useState<'goods' | 'cash'>('goods');
  const [cashDebtAmount, setCashDebtAmount] = useState('');
  const [cashDeductFromDrawer, setCashDeductFromDrawer] = useState(true);
  const [prodQuery, setProdQuery] = useState('');
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [customPrices, setCustomPrices] = useState<Record<number, string>>({});

  // Settle / Payment inline state
  const [settlingDebtId, setSettlingDebtId] = useState<number | null>(null);
  const [payAmountInput, setPayAmountInput] = useState('');
  const [payAddToCash, setPayAddToCash] = useState(true);
  const [payNote, setPayNote] = useState('');

  // Inline Edit Phone / Note state
  const [editingDebtId, setEditingDebtId] = useState<number | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [editNote, setEditNote] = useState('');

  // Inline Delete Confirm state (Managers & Owner only when unpaid)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const branchStaffOptions = useMemo(() => {
    const branchUsers = db.users.filter((u) => {
      if (u.owner) return true;
      return getUserStoreIds(u, db.stores).includes(formStoreId);
    });
    const names = Array.from(
      new Set([user.name, ...branchUsers.map((u) => u.name)])
    );
    return names;
  }, [db.users, db.stores, formStoreId, user.name]);

  const formProducts = useMemo(
    () =>
      db.products.filter(
        (p) => p.storeId === formStoreId && matchesQuery(p.name, prodQuery)
      ),
    [db.products, formStoreId, prodQuery]
  );

  const selectedFormItems: CustomerDebtItem[] = useMemo(() => {
    const storeProds = db.products.filter((p) => p.storeId === formStoreId);
    return storeProds
      .filter((p) => (quantities[p.id] || 0) > 0)
      .map((p) => {
        const rawCustom = customPrices[p.id];
        const parsed =
          rawCustom !== undefined && rawCustom.trim() !== ''
            ? Math.max(0, num(rawCustom))
            : p.price;
        return {
          productId: p.id,
          name: p.name,
          qty: quantities[p.id],
          unitPrice: parsed,
          cost: p.cost,
        };
      });
  }, [db.products, formStoreId, quantities, customPrices]);

  const parsedCashAmount =
    Math.round(Math.max(0, num(cashDebtAmount)) * 100) / 100;

  const formTotal =
    debtType === 'cash'
      ? parsedCashAmount
      : Math.round(
          selectedFormItems.reduce((sum, i) => sum + i.qty * i.unitPrice, 0) *
            100
        ) / 100;

  const stepQty = (productId: number, stock: number, delta: number) => {
    setQuantities((prev) => ({
      ...prev,
      [productId]: Math.max(0, Math.min(stock, (prev[productId] || 0) + delta)),
    }));
  };

  const resetAddForm = () => {
    setCustomerName('');
    setCustomerPhone('');
    setGivenBy(user.name);
    setDebtNote('');
    setDebtType('goods');
    setCashDebtAmount('');
    setCashDeductFromDrawer(true);
    setProdQuery('');
    setQuantities({});
    setCustomPrices({});
  };

  const handleSaveDebt = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCustomer = customerName.trim();
    if (!cleanCustomer) {
      notify('أدخل اسم الزبون أولاً');
      return;
    }

    if (debtType === 'cash') {
      if (parsedCashAmount <= 0) {
        notify('أدخل مبلغ الدين النقدي أكبر من صفر');
        return;
      }
    } else {
      if (selectedFormItems.length === 0) {
        notify('اختر غرضاً واحداً على الأقل للزبون');
        return;
      }
      if (!user.owner && user.role === 'employee') {
        for (const item of selectedFormItems) {
          const prod = db.products.find((p) => p.id === item.productId);
          if (prod && item.unitPrice < prod.min) {
            notify(
              `سعر "${item.name}" أقل من الحد الأدنى المسموح (${fmt(prod.min)})`
            );
            return;
          }
        }
      }
      for (const item of selectedFormItems) {
        const prod = db.products.find((p) => p.id === item.productId);
        if (!prod || prod.stock < item.qty) {
          notify(`الكمية المتوفرة من "${item.name}" لا تكفي`);
          return;
        }
      }
    }

    const giverName = givenBy.trim() || user.name;
    const giverUser = db.users.find((u) => norm(u.name) === norm(giverName));
    const storeName = getStoreName(formStoreId);
    const cleanPhone = customerPhone.trim() || undefined;
    const cleanNote = debtNote.trim() || undefined;

    upd((d) => {
      if (!Array.isArray(d.customerDebts)) d.customerDebts = [];
      const nowTs = Date.now();
      if (debtType === 'goods') {
        selectedFormItems.forEach((item) => {
          const prod = d.products.find((p) => p.id === item.productId);
          if (prod) {
            const prevStock = prod.stock;
            prod.stock -= item.qty;
            const threshold = prod.minStock ?? 3;
            if (prevStock > threshold && prod.stock <= threshold) {
              addLog(
                d,
                'النظام',
                `[${storeName}] تنبيه تلقائي: وصول "${prod.name}" إلى الحد الأدنى للمخزون (${prod.stock} / ${threshold})`,
                formStoreId
              );
            }
          }
        });
      }

      const debtId = d.nid++;
      d.customerDebts.unshift({
        id: debtId,
        storeId: formStoreId,
        customerName: cleanCustomer,
        customerPhone: cleanPhone,
        givenBy: giverName,
        givenByRole: giverUser?.role ?? user.role,
        debtType,
        deductFromCash: debtType === 'cash' ? cashDeductFromDrawer : false,
        items: debtType === 'cash' ? [] : selectedFormItems,
        totalAmount: formTotal,
        payments: [],
        paid: false,
        note: cleanNote,
        ts: nowTs,
      });

      addLog(
        d,
        user.name,
        debtType === 'cash'
          ? `[${storeName}] تسجيل دين مصاري لزبون #${debtId}: ${cleanCustomer}${
              cleanPhone ? ` (${cleanPhone})` : ''
            } · أعطاه: ${giverName} · المبلغ: ${fmt(formTotal)}${
              cashDeductFromDrawer ? ' (سُحب من الصندوق)' : ' (خارج الصندوق)'
            }`
          : `[${storeName}] تسجيل دين بضاعة لزبون #${debtId}: ${cleanCustomer}${
              cleanPhone ? ` (${cleanPhone})` : ''
            } · أعطاه: ${giverName} · القيمة: ${fmt(formTotal)}`,
        formStoreId
      );
      return d;
    });

    notify(
      debtType === 'cash'
        ? `تم تسجيل دين مصاري للزبون "${cleanCustomer}" (${fmt(formTotal)}) بنجاح`
        : `تم تسجيل دين الزبون "${cleanCustomer}" (${fmt(formTotal)}) بنجاح`
    );
    resetAddForm();
    setShowAddForm(false);
    setStatusFilter('open');
  };

  // Scope debts strictly by allowedStoreIds and selected storeFilter
  const scopedDebts = useMemo(() => {
    return (db.customerDebts ?? [])
      .filter((cd) => {
        if (!allowedStoreIds.includes(cd.storeId)) return false;
        if (storeFilter !== 'all' && cd.storeId !== storeFilter) return false;
        return true;
      })
      .map((cd) => ({
        debt: cd,
        totals: getCustomerDebtTotals(cd),
      }))
      .sort((a, b) => b.debt.ts - a.debt.ts);
  }, [db.customerDebts, allowedStoreIds, storeFilter]);

  const giversList = useMemo(
    () =>
      Array.from(new Set(scopedDebts.map((x) => x.debt.givenBy))).sort((a, b) =>
        a.localeCompare(b, 'ar')
      ),
    [scopedDebts]
  );

  const summary = useMemo(() => {
    let totalAll = 0;
    let totalPaid = 0;
    let totalRemaining = 0;
    let openCount = 0;
    let paidCount = 0;
    const customerRemainingMap = new Map<
      string,
      { name: string; phone?: string; remaining: number; count: number }
    >();

    for (const { debt, totals } of scopedDebts) {
      totalAll += totals.totalAmount;
      totalPaid += totals.paidAmount;
      totalRemaining += totals.remainingAmount;
      if (totals.isPaid) {
        paidCount += 1;
      } else {
        openCount += 1;
        const cKey = norm(debt.customerName);
        const existing = customerRemainingMap.get(cKey);
        if (existing) {
          existing.remaining =
            Math.round((existing.remaining + totals.remainingAmount) * 100) /
            100;
          existing.count += 1;
          if (!existing.phone && debt.customerPhone) {
            existing.phone = debt.customerPhone;
          }
        } else {
          customerRemainingMap.set(cKey, {
            name: debt.customerName,
            phone: debt.customerPhone,
            remaining: totals.remainingAmount,
            count: 1,
          });
        }
      }
    }

    const topDebtors = Array.from(customerRemainingMap.values()).sort(
      (a, b) => b.remaining - a.remaining
    );

    return {
      totalAll: Math.round(totalAll * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalRemaining: Math.round(totalRemaining * 100) / 100,
      openCount,
      paidCount,
      topDebtors,
    };
  }, [scopedDebts]);

  const filteredDebts = useMemo(() => {
    const q = norm(query);
    return scopedDebts.filter(({ debt, totals }) => {
      if (giverFilter !== 'all' && debt.givenBy !== giverFilter) return false;
      if (statusFilter === 'open' && totals.isPaid) return false;
      if (statusFilter === 'paid' && !totals.isPaid) return false;

      if (!q) return true;
      const inCustomer = norm(debt.customerName).includes(q);
      const inPhone = norm(debt.customerPhone ?? '').includes(q);
      const inGiver = norm(debt.givenBy).includes(q);
      const inItems = debt.items.some((i) => norm(i.name).includes(q));
      const inNote = norm(debt.note ?? '').includes(q);
      return (
        inCustomer ||
        inPhone ||
        inGiver ||
        inItems ||
        inNote ||
        String(debt.id).includes(q)
      );
    });
  }, [scopedDebts, giverFilter, statusFilter, query]);

  const handleSettleSubmit = (
    e: React.FormEvent,
    debt: CustomerDebt,
    remaining: number
  ) => {
    e.preventDefault();
    const amt = Math.round(num(payAmountInput) * 100) / 100;
    if (amt <= 0) {
      notify('أدخل مبلغ الدفع أكبر من صفر');
      return;
    }
    if (amt > remaining + 0.01) {
      notify(`المبلغ المدخل أكبر من المتبقي (${fmt(remaining)})`);
      return;
    }

    const appliedAmt = Math.min(amt, remaining);
    const sName = getStoreName(debt.storeId);
    const cleanNote = payNote.trim() || undefined;

    upd((d) => {
      const target = (d.customerDebts ?? []).find((x) => x.id === debt.id);
      if (!target) return d;
      if (!Array.isArray(target.payments)) target.payments = [];
      const nowTs = Date.now();
      target.payments.push({
        id: d.nid++,
        amount: appliedAmt,
        by: user.name,
        ts: nowTs,
        addToCash: payAddToCash,
        note: cleanNote,
      });
      const updatedTotals = getCustomerDebtTotals(target);
      if (updatedTotals.isPaid) {
        target.paid = true;
        target.paidAt = nowTs;
        target.paidBy = user.name;
      }
      addLog(
        d,
        user.name,
        `[${sName}] محاسبة دين زبون #${debt.id} (${debt.customerName}): دفعة ${fmt(appliedAmt)}${
          updatedTotals.isPaid
            ? ' (سداد كامل)'
            : ` (متبقي ${fmt(updatedTotals.remainingAmount)})`
        }${payAddToCash ? ' · أضيف للصندوق' : ''}`,
        debt.storeId
      );
      return d;
    });

    setSettlingDebtId(null);
    setPayAmountInput('');
    setPayNote('');
    notify(
      appliedAmt >= remaining
        ? `تمت محاسبة كامل دين "${debt.customerName}" (${fmt(appliedAmt)})`
        : `تم تسجيل دفعة (${fmt(appliedAmt)}) لحساب "${debt.customerName}"`
    );
  };

  const handleSaveDetailsEdit = (e: React.FormEvent, debtId: number) => {
    e.preventDefault();
    upd((d) => {
      const target = (d.customerDebts ?? []).find((x) => x.id === debtId);
      if (!target) return d;
      target.customerPhone = editPhone.trim() || undefined;
      target.note = editNote.trim() || undefined;
      addLog(
        d,
        user.name,
        `[${getStoreName(target.storeId)}] تحديث بيانات دين زبون #${target.id} (${target.customerName})`,
        target.storeId
      );
      return d;
    });
    setEditingDebtId(null);
    notify('تم تحديث رقم الهاتف والملاحظة');
  };

  const handleDeleteUnpaidDebt = (debt: CustomerDebt) => {
    const sName = getStoreName(debt.storeId);
    const isCashDebt = debt.debtType === 'cash' || debt.items.length === 0;
    upd((d) => {
      debt.items.forEach((item) => {
        const prod = d.products.find(
          (p) =>
            p.id === item.productId ||
            (p.storeId === debt.storeId && norm(p.name) === norm(item.name))
        );
        if (prod) {
          prod.stock += item.qty;
        }
      });
      d.customerDebts = (d.customerDebts ?? []).filter((x) => x.id !== debt.id);
      addLog(
        d,
        user.name,
        isCashDebt
          ? `[${sName}] إلغاء وحذف سجل دين مصاري لزبون #${debt.id} (${debt.customerName})`
          : `[${sName}] حذف سجل دين زبون #${debt.id} (${debt.customerName}) وإرجاع الأغراض للمخزون`,
        debt.storeId
      );
      return d;
    });
    setConfirmDeleteId(null);
    notify(
      isCashDebt
        ? 'تم إلغاء سجل الدين النقدي بنجاح'
        : 'تم حذف سجل الدين وإرجاع الكميات للمخزون'
    );
  };

  return (
    <div className="space-y-5">
      {/* Header Banner & Primary CTA */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            ديون زباين
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            تسجيل ومتابعة الأغراض المأخوذة بالدين حسب الفرع والتاريخ (مع اسم الزبون، رقم اختياري، الشخص الذي أعطاه الغرض، والمحاسبة عند السداد)، ومرتبطة تلقائياً مع ورقة «ديون زباين» في Excel و Google Sheets.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!showAddForm && storeFilter !== 'all') {
              setFormStoreId(storeFilter);
            }
            setShowAddForm((prev) => !prev);
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            showAddForm
              ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
              : 'bg-[#38608f] text-white hover:bg-[#2d4f77]'
          }`}
        >
          {showAddForm ? (
            <>
              <X className="h-4 w-4" />
              <span>إغلاق نموذج التسجيل</span>
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              <span>تسجيل دين زبون جديد</span>
            </>
          )}
        </button>
      </div>

      {/* Add New Customer Debt Form */}
      {showAddForm && (
        <form
          onSubmit={handleSaveDebt}
          className="rounded-xl border border-[#38608f]/40 bg-white p-5 dark:border-[#4f7fb5]/40 dark:bg-slate-900 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-[#38608f] dark:text-[#78a8de]">
                تسجيل دين جديد على حساب زبون (بضاعة أو مصاري)
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                الفرع: {getStoreName(formStoreId)}
              </span>
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setDebtType('goods')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  debtType === 'goods'
                    ? 'bg-[#38608f] text-white'
                    : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                دين بضاعة (أغراض)
              </button>
              <button
                type="button"
                onClick={() => setDebtType('cash')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  debtType === 'cash'
                    ? 'bg-[#38608f] text-white'
                    : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                دين مصاري (نقدي)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                اسم الزبون *
              </label>
              <input
                required
                placeholder="مثال: أبو محمد..."
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                رقم الهاتف (اختياري)
              </label>
              <input
                type="tel"
                placeholder="09xxxxxxxx (اختياري)"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            {allowedStores.length > 1 ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  من فرع
                </label>
                <select
                  value={formStoreId}
                  onChange={(e) => {
                    setFormStoreId(Number(e.target.value));
                    setQuantities({});
                    setCustomPrices({});
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {allowedStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  الفرع
                </label>
                <input
                  readOnly
                  value={getStoreName(formStoreId)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400"
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                مين عطاه الغرض
              </label>
              <select
                value={givenBy}
                onChange={(e) => setGivenBy(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {branchStaffOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              ملاحظات (اختياري)
            </label>
            <input
              placeholder="مثال: موعد السداد نهاية الشهر أو أي تفاصيل..."
              value={debtNote}
              onChange={(e) => setDebtNote(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          {debtType === 'cash' ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    مبلغ الدين النقدي (مصاري) *
                  </label>
                  <input
                    type="number"
                    min={0.01}
                    step="any"
                    required
                    placeholder="أدخل المبلغ..."
                    value={cashDebtAmount}
                    onChange={(e) => setCashDebtAmount(e.target.value)}
                    className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={cashDeductFromDrawer}
                      onChange={(e) => setCashDeductFromDrawer(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#38608f]"
                    />
                    <span>
                      سحب المبلغ من درج فرع {getStoreName(formStoreId)} الآن (ينعكس في مطابقة الدرج)
                    </span>
                  </label>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  اختر الأغراض المأخوذة من مخزون {getStoreName(formStoreId)}
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    placeholder="بحث عن صنف..."
                    value={prodQuery}
                    onChange={(e) => setProdQuery(e.target.value)}
                    className="w-52 rounded-lg border border-slate-300 bg-white py-1.5 pr-8 pl-3 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>

              <div className="max-h-64 divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {formProducts.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    لا توجد أصناف مطابقة في هذا الفرع
                  </div>
                ) : (
                  formProducts.map((p) => {
                    const qty = quantities[p.id] || 0;
                    const priceStr =
                      customPrices[p.id] !== undefined
                        ? customPrices[p.id]
                        : String(p.price);
                    return (
                      <div
                        key={p.id}
                        className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm ${
                          qty > 0 ? 'bg-[#38608f]/5 dark:bg-[#38608f]/15' : ''
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {p.name}
                          </p>
                          <p className="font-num text-xs text-slate-500 dark:text-slate-400">
                            المتوفر: {p.stock} · سعر البيع: {fmt(p.price)} · الحد الأدنى:{' '}
                            {fmt(p.min)}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {qty > 0 && (
                            <div className="flex items-center gap-1">
                              <span className="text-[11px] text-slate-500">
                                السعر:
                              </span>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={priceStr}
                                onChange={(e) =>
                                  setCustomPrices((prev) => ({
                                    ...prev,
                                    [p.id]: e.target.value,
                                  }))
                                }
                                className="font-num w-20 rounded border border-slate-300 bg-white px-2 py-1 text-center text-xs font-semibold focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                              />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => stepQty(p.id, p.stock, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="font-num w-7 text-center text-sm font-bold">
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => stepQty(p.id, p.stock, 1)}
                            disabled={p.stock <= 0}
                            className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-slate-800">
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {debtType === 'cash'
                  ? 'إجمالي مبلغ الدين النقدي:'
                  : 'إجمالي قيمة الأغراض المأخوذة:'}
              </span>
              <span className="font-num mr-2 text-lg font-bold text-[#38608f] dark:text-[#78a8de]">
                {fmt(formTotal)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  resetAddForm();
                  setShowAddForm(false);
                }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>حفظ وتسجيل الدين</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            إجمالي الديون المسجلة
          </p>
          <p className="font-num mt-1 text-lg font-bold text-[#38608f] dark:text-[#78a8de]">
            {fmt(summary.totalAll)}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            المبالغ المحصّلة (المدفوع)
          </p>
          <p className="font-num mt-1 text-lg font-bold text-emerald-700 dark:text-emerald-400">
            {fmt(summary.totalPaid)}
          </p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 dark:border-rose-900/50 dark:bg-rose-950/20">
          <p className="text-xs text-rose-700 dark:text-rose-300">
            الديون المتبقية ({summary.openCount})
          </p>
          <p className="font-num mt-1 text-lg font-bold text-rose-700 dark:text-rose-400">
            {fmt(summary.totalRemaining)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            زباين بذمتهم رصيد حالياً
          </p>
          <p className="font-num mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">
            {summary.topDebtors.length}
          </p>
        </div>
      </div>

      {/* Top Debtors Quick Summary (Click to filter by customer) */}
      {summary.topDebtors.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              ملخص الزبائن غير المسددين (اضغط على اسم الزبون للتصفية)
            </span>
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-xs font-semibold text-[#38608f] hover:underline dark:text-[#78a8de]"
              >
                عرض الجميع
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {summary.topDebtors.slice(0, 12).map((d) => (
              <button
                key={d.name}
                type="button"
                onClick={() => setQuery(d.name)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  norm(query) === norm(d.name)
                    ? 'border-[#38608f] bg-[#38608f] text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                <span>{d.name}</span>
                <span className="opacity-50">·</span>
                <span className="font-num font-bold">{fmt(d.remaining)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
          {(
            [
              ['open', `غير مسددة (${summary.openCount})`],
              ['paid', `مسددة بالكامل (${summary.paidCount})`],
              ['all', `الكل (${scopedDebts.length})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setStatusFilter(k)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                statusFilter === k
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
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="all">كل الفروع المتاحة</option>
              {allowedStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}

          <select
            value={giverFilter}
            onChange={(e) => setGiverFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="all">كل البائعين (مين عطاه الغرض)</option>
            {giversList.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="بحث باسم الزبون، الرقم، أو الغرض..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-56 rounded-lg border border-slate-300 bg-white py-1.5 pr-8 pl-3 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>
      </div>

      {/* Debts List */}
      {filteredDebts.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          لا توجد ديون زباين ضمن هذا التصنيف
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDebts.map(({ debt, totals }) => {
            const isSettling = settlingDebtId === debt.id;
            const isEditing = editingDebtId === debt.id;
            const isDeleting = confirmDeleteId === debt.id;
            const isPartial = !totals.isPaid && totals.paidAmount > 0;

            return (
              <div
                key={debt.id}
                className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                {/* Header Row: Customer Info + Financial Totals */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        {debt.customerName}
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">·</span>
                      <span className="text-xs font-semibold text-[#38608f] dark:text-[#78a8de]">
                        {debt.debtType === 'cash' ? 'دين مصاري' : 'دين بضاعة'}
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">·</span>
                      <span
                        className={`text-xs font-bold ${
                          totals.isPaid
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : isPartial
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        {totals.isPaid
                          ? 'مسدد بالكامل'
                          : isPartial
                            ? 'مدفوع جزئياً'
                            : 'غير مسدد'}
                      </span>
                    </div>

                    <div className="font-num flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <span>#{debt.id}</span>
                      <span>·</span>
                      <span>{fullDate(debt.ts)}</span>
                      <span>·</span>
                      <span>الفرع: {getStoreName(debt.storeId)}</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <UserCheck className="h-3 w-3" />
                        <span>
                          {debt.debtType === 'cash' ? 'سجّله/سلّمه:' : 'أعطاه الغرض:'}{' '}
                          {debt.givenBy}
                        </span>
                      </span>
                      {debt.customerPhone && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300">
                            <Phone className="h-3 w-3" />
                            <span>{debt.customerPhone}</span>
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-5 text-left shrink-0">
                    <div>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                        {debt.debtType === 'cash' ? 'المبلغ الأساسي' : 'قيمة الأغراض'}
                      </span>
                      <span className="font-num text-sm font-bold text-slate-900 dark:text-slate-100">
                        {fmt(totals.totalAmount)}
                      </span>
                    </div>
                    {totals.paidAmount > 0 && (
                      <div>
                        <span className="block text-[11px] text-emerald-700 dark:text-emerald-400">
                          المدفوع
                        </span>
                        <span className="font-num text-sm font-bold text-emerald-700 dark:text-emerald-400">
                          {fmt(totals.paidAmount)}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                        المتبقي
                      </span>
                      <span
                        className={`font-num text-base font-bold ${
                          totals.remainingAmount > 0
                            ? 'text-rose-700 dark:text-rose-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {fmt(totals.remainingAmount)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Items List (vertically stacked lines) or Cash Debt Info */}
                <div className="mt-3 divide-y divide-slate-200/70 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1 text-xs dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950/60">
                  {debt.items.length === 0 ? (
                    <div className="flex items-center justify-between gap-2 py-1.5">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        دين نقدي (مصاري)
                        {debt.deductFromCash !== false
                          ? ' — تم سحب المبلغ من درج الفرع'
                          : ' — خارج الصندوق'}
                      </span>
                      <span className="font-num font-bold text-slate-700 dark:text-slate-200">
                        {fmt(totals.totalAmount)}
                      </span>
                    </div>
                  ) : (
                    debt.items.map((item, idx) => (
                      <div
                        key={`${debt.id}-${item.productId}-${idx}`}
                        className="flex items-center justify-between gap-2 py-1.5"
                      >
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {item.name} ×{' '}
                          <strong className="font-num">{item.qty}</strong>
                        </span>
                        <span className="font-num text-slate-600 dark:text-slate-300">
                          سعر القطعة {fmt(item.unitPrice)} · الإجمالي{' '}
                          <strong>{fmt(item.qty * item.unitPrice)}</strong>
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {debt.note && (
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                    ملاحظات: <span className="font-medium">{debt.note}</span>
                  </p>
                )}

                {/* Payments History */}
                {debt.payments.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-slate-200/70 pt-2 text-[11px] text-emerald-700 dark:border-slate-800 dark:text-emerald-400">
                    {debt.payments.map((p) => (
                      <div
                        key={p.id}
                        className="font-num flex flex-wrap items-center justify-between gap-2"
                      >
                        <span>
                          دفعة {fmt(p.amount)} بتاريخ {fullDate(p.ts)} · استلمها:{' '}
                          {p.by}
                          {p.addToCash ? ' (أُضيفت للصندوق)' : ' (دفع خارجي)'}
                          {p.note ? ` · ${p.note}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions Footer */}
                {!isSettling && !isEditing && !isDeleting && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800/80">
                    {!totals.isPaid && (
                      <button
                        type="button"
                        onClick={() => {
                          setSettlingDebtId(debt.id);
                          setPayAmountInput(String(totals.remainingAmount));
                          setPayAddToCash(true);
                          setPayNote('');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                      >
                        <Wallet className="h-3.5 w-3.5" />
                        <span>محاسبة / تسديد ({fmt(totals.remainingAmount)})</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setEditingDebtId(debt.id);
                        setEditPhone(debt.customerPhone ?? '');
                        setEditNote(debt.note ?? '');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span>تعديل الرقم / الملاحظة</span>
                    </button>

                    {(user.role === 'manager' || user.owner) &&
                      totals.paidAmount === 0 && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(debt.id)}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 whitespace-nowrap"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>
                            {debt.debtType === 'cash' || debt.items.length === 0
                              ? 'إلغاء الدين'
                              : 'إلغاء وإرجاع للمخزون'}
                          </span>
                        </button>
                      )}
                  </div>
                )}

                {/* Inline Settle / Partial Payment Form */}
                {isSettling && (
                  <form
                    onSubmit={(e) =>
                      handleSettleSubmit(e, debt, totals.remainingAmount)
                    }
                    className="mt-3 space-y-2.5 rounded-lg border border-emerald-300 bg-emerald-50/40 p-3 dark:border-emerald-800 dark:bg-emerald-950/20"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        محاسبة دين {debt.customerName}
                      </span>
                      <span className="font-num font-bold text-rose-700 dark:text-rose-400">
                        المتبقي: {fmt(totals.remainingAmount)}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          المبلغ المدفوع الآن (كامل أو دفعة جزئية)
                        </label>
                        <input
                          type="number"
                          min={0.01}
                          max={totals.remainingAmount}
                          step="any"
                          required
                          value={payAmountInput}
                          onChange={(e) => setPayAmountInput(e.target.value)}
                          className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          ملاحظة السداد (اختياري)
                        </label>
                        <input
                          placeholder="مثال: سداد نقدي..."
                          value={payNote}
                          onChange={(e) => setPayNote(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>
                    </div>

                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={payAddToCash}
                        onChange={(e) => setPayAddToCash(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                      />
                      <span>
                        إضافة المبلغ المدفوع لصندوق فرع {getStoreName(debt.storeId)}
                      </span>
                    </label>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                      >
                        تأكيد المحاسبة واستلام المبلغ
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPayAmountInput(String(totals.remainingAmount))
                        }
                        className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300 whitespace-nowrap"
                      >
                        تحديد كامل المتبقي
                      </button>
                      <button
                        type="button"
                        onClick={() => setSettlingDebtId(null)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
                      >
                        إلغاء
                      </button>
                    </div>
                  </form>
                )}

                {/* Inline Edit Phone & Note Form */}
                {isEditing && (
                  <form
                    onSubmit={(e) => handleSaveDetailsEdit(e, debt.id)}
                    className="mt-3 space-y-2.5 rounded-lg border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          رقم الهاتف (اختياري)
                        </label>
                        <input
                          type="tel"
                          placeholder="09xxxxxxxx"
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          ملاحظات
                        </label>
                        <input
                          placeholder="ملاحظة..."
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="rounded-lg bg-[#38608f] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#2d4f77] whitespace-nowrap"
                      >
                        حفظ التعديل
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingDebtId(null)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
                      >
                        إلغاء
                      </button>
                    </div>
                  </form>
                )}

                {/* Inline Delete Confirmation */}
                {isDeleting && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-300 bg-rose-50/70 p-3 text-xs dark:border-rose-800 dark:bg-rose-950/30">
                    <span className="font-semibold text-rose-800 dark:text-rose-200">
                      {debt.debtType === 'cash' || debt.items.length === 0
                        ? 'تأكيد إلغاء وحذف سجل الدين النقدي؟'
                        : `تأكيد حذف هذا السجل وإرجاع الأغراض إلى مخزون ${getStoreName(debt.storeId)}؟`}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleDeleteUnpaidDebt(debt)}
                        className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 whitespace-nowrap"
                      >
                        {debt.debtType === 'cash' || debt.items.length === 0
                          ? 'نعم، إلغاء'
                          : 'نعم، حذف وإرجاع'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
                      >
                        تراجع
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
