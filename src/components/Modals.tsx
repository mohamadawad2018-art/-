import React, { useState } from 'react';
import {
  X,
  Printer,
  Banknote,
  Package,
  Camera,
  Plus,
  Trash2,
  Upload,
  Award,
  UserCheck,
  Building2,
  DollarSign,
  FileSpreadsheet,
  Store,
  Image as ImageIcon,
  AlertTriangle,
} from 'lucide-react';
import {
  compressImageFile,
  fmt,
  fullDate,
  getIntakeTotals,
  getNextMonthKey,
  getUnpaidGoodsWithdrawalsForUser,
  getUserStoreIds,
  getWithdrawalWholesaleTotal,
  monthKey,
  norm,
  num,
} from '../store';
import type {
  PosDatabase,
  Sale,
  StockIntake,
  StockIntakeItem,
  User,
  UserRole,
  WithdrawalItem,
} from '../types';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}

export const Modal: React.FC<ModalProps> = ({
  title,
  onClose,
  children,
  maxWidth = 'max-w-md',
}) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]"
    onClick={onClose}
  >
    <div
      className={`w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 text-slate-900 shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
        <h3 className="text-base font-bold">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

const EXPENSE_CATS = ['شاي', 'قهوة', 'كاسات', 'منظفات', 'أخرى'];

interface ExpenseFormProps {
  onSubmit: (desc: string, amount: number) => void;
  onClose: () => void;
  notify: (msg: string) => void;
}

export const ExpenseForm: React.FC<ExpenseFormProps> = ({
  onSubmit,
  onClose,
  notify,
}) => {
  const [cat, setCat] = useState('');
  const [other, setOther] = useState('');
  const [amt, setAmt] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const desc = cat === 'أخرى' ? other.trim() : cat;
    if (!desc || num(amt) <= 0) {
      notify('اختر البند وأدخل مبلغاً أكبر من صفر');
      return;
    }
    onSubmit(desc, num(amt));
    onClose();
  };

  return (
    <Modal title="مصاريف ونثريات" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            البند
          </label>
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="">-- اختر البند --</option>
            {EXPENSE_CATS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>

        {cat === 'أخرى' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              تفاصيل البند
            </label>
            <input
              placeholder="اكتب البند"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            المبلغ
          </label>
          <input
            type="number"
            inputMode="numeric"
            placeholder="0"
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
            className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap"
          >
            حفظ
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
};

export interface SalarySettlementChoice {
  grossAmount: number;
  deductionAmount: number;
  action: 'deduct' | 'defer' | 'none';
  targetWithdrawalIds: number[];
  nextMonth: string;
}

interface SalaryFormProps {
  db: PosDatabase;
  currentUser?: User;
  initialEmployeeId?: number;
  initialWithdrawalAction?: 'deduct' | 'defer' | '';
  onSubmit: (
    user: User,
    amount: number,
    isManagerPin: boolean,
    settlement?: SalarySettlementChoice
  ) => void;
  onClose: () => void;
  notify: (msg: string) => void;
}

export const SalaryForm: React.FC<SalaryFormProps> = ({
  db,
  currentUser,
  initialEmployeeId,
  initialWithdrawalAction = 'deduct',
  onSubmit,
  onClose,
  notify,
}) => {
  const isEmployeeLocked = Boolean(
    currentUser && currentUser.role === 'employee'
  );
  const lockedUser = isEmployeeLocked
    ? db.users.find((u) => u.id === currentUser?.id) ?? currentUser
    : undefined;

  const initialUserObj =
    !isEmployeeLocked && initialEmployeeId
      ? db.users.find((u) => u.id === initialEmployeeId)
      : undefined;

  const [id, setId] = useState(
    lockedUser
      ? String(lockedUser.id)
      : initialUserObj
        ? String(initialUserObj.id)
        : ''
  );
  const [pin, setPin] = useState('');
  const [amt, setAmt] = useState(
    lockedUser
      ? String(lockedUser.salary ?? 0)
      : initialUserObj && (initialUserObj.salary ?? 0) > 0
        ? String(initialUserObj.salary)
        : ''
  );
  const [withdrawalAction, setWithdrawalAction] = useState<'deduct' | 'defer' | ''>(
    initialWithdrawalAction
  );

  const selectedUser = isEmployeeLocked
    ? lockedUser
    : db.users.find((x) => String(x.id) === id);
  const registeredSalary = selectedUser?.salary ?? 0;

  const isTargetEmployee = Boolean(
    selectedUser && !selectedUser.owner && selectedUser.role === 'employee'
  );
  const dueWithdrawals = isTargetEmployee && selectedUser
    ? getUnpaidGoodsWithdrawalsForUser(db, selectedUser.name, undefined, false)
    : [];
  const deferredWithdrawals = isTargetEmployee && selectedUser
    ? getUnpaidGoodsWithdrawalsForUser(db, selectedUser.name, undefined, true).filter(
        (w) => w.deferredToMonth && w.deferredToMonth > monthKey(Date.now())
      )
    : [];
  const dueTotal = Math.round(
    dueWithdrawals.reduce(
      (sum, w) => sum + getWithdrawalWholesaleTotal(w, db.products),
      0
    ) * 100
  ) / 100;
  const nextMonth = getNextMonthKey();

  const grossAmount = isEmployeeLocked ? registeredSalary : num(amt);
  const effectiveDeduction =
    dueWithdrawals.length > 0 && withdrawalAction === 'deduct'
      ? Math.min(grossAmount, dueTotal)
      : 0;
  const netPayout = Math.max(
    0,
    Math.round((grossAmount - effectiveDeduction) * 100) / 100
  );

  const handleSelectEmployee = (nextId: string) => {
    setId(nextId);
    const found = db.users.find((x) => String(x.id) === nextId);
    setAmt(found && (found.salary ?? 0) > 0 ? String(found.salary) : '');
    setWithdrawalAction(initialWithdrawalAction || 'deduct');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) {
      notify('اختر الموظف أولاً');
      return;
    }

    if (grossAmount <= 0) {
      notify(
        isEmployeeLocked
          ? 'لم يتم تسجيل راتب لك من الإدارة بعد'
          : 'أدخل قيمة راتب أكبر من صفر'
      );
      return;
    }

    if (dueWithdrawals.length > 0 && !withdrawalAction) {
      notify('يرجى تحديد هل يتم خصم قيمة الأغراض من الراتب أم تأجيلها للشهر القادم');
      return;
    }

    const isManagerPin = db.users.some(
      (m) => m.role === 'manager' && m.pin === pin
    );
    if (!isManagerPin && selectedUser.pin !== pin) {
      notify('كلمة السر خاطئة');
      setPin('');
      return;
    }

    const settlement: SalarySettlementChoice | undefined =
      dueWithdrawals.length > 0
        ? {
            grossAmount,
            deductionAmount: effectiveDeduction,
            action: withdrawalAction === 'defer' ? 'defer' : 'deduct',
            targetWithdrawalIds: dueWithdrawals.map((w) => w.id),
            nextMonth,
          }
        : undefined;

    onSubmit(
      selectedUser,
      settlement?.action === 'deduct' ? netPayout : grossAmount,
      isManagerPin,
      settlement
    );
    onClose();
  };

  return (
    <Modal title="صرف راتب" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {isEmployeeLocked && lockedUser ? (
          <>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  الموظف المستفيد
                </span>
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {lockedUser.name}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 dark:border-slate-800">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  الراتب المسجل لك
                </span>
                <span
                  className={`font-num text-base font-bold ${
                    registeredSalary > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {registeredSalary > 0 ? fmt(registeredSalary) : 'غير مسجل بعد'}
                </span>
              </div>
            </div>

            {registeredSalary <= 0 && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                لم يقم المالك أو المدير بتسجيل قيمة راتبك بعد. يرجى مراجعة الإدارة لتسجيل راتبك في لوحة الموظفين.
              </p>
            )}
          </>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                الموظف
              </label>
              <select
                value={id}
                onChange={(e) => handleSelectEmployee(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="">-- اختر الموظف --</option>
                {db.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {(u.salary ?? 0) > 0
                      ? ` (الراتب المسجل: ${fmt(u.salary)})`
                      : ' (بدون راتب مسجل)'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                قيمة الراتب
              </label>
              <input
                type="number"
                inputMode="numeric"
                placeholder="0"
                value={amt}
                onChange={(e) => setAmt(e.target.value)}
                className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              {selectedUser && (selectedUser.salary ?? 0) > 0 && (
                <p className="font-num mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  الراتب الشهري المسجل للموظف: {fmt(selectedUser.salary)}
                </p>
              )}
            </div>
          </>
        )}

        {selectedUser && dueWithdrawals.length > 0 && (
          <div className="space-y-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/35">
            <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="text-xs">
                <p className="font-bold">
                  تنبيه: {selectedUser.name} لم يحاسب على مسحوبات بضاعة بقيمة جملة{' '}
                  <span className="font-num text-rose-700 dark:text-rose-400">
                    {fmt(dueTotal)}
                  </span>
                </p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-amber-800 dark:text-amber-300">
                  {dueWithdrawals.map((w) => (
                    <li key={w.id}>
                      • {w.items.map((i) => `${i.name} × ${i.qty}`).join('، ')} — بسعر الجملة:{' '}
                      <strong className="font-num">
                        {fmt(getWithdrawalWholesaleTotal(w, db.products))}
                      </strong>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              هل تريد خصم قيمتها من هذا الراتب؟
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setWithdrawalAction('deduct')}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  withdrawalAction === 'deduct'
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                نعم، خصم من الراتب (-{fmt(effectiveDeduction || dueTotal)})
              </button>
              <button
                type="button"
                onClick={() => setWithdrawalAction('defer')}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  withdrawalAction === 'defer'
                    ? 'border-[#38608f] bg-[#38608f] text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                لا، تأجيل للشهر القادم ({nextMonth})
              </button>
            </div>

            {grossAmount > 0 && withdrawalAction === 'deduct' && (
              <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs dark:border-emerald-900/60 dark:bg-slate-900">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">
                    صافي الراتب المصروف بعد الخصم:
                  </span>
                  <span className="font-num text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {fmt(netPayout)}
                  </span>
                </div>
                {dueTotal > grossAmount && (
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                    ملاحظة: قيمة المسحوبات ({fmt(dueTotal)}) تتجاوز الراتب المدخل؛ سيتم خصم قيمة الراتب بالكامل.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {selectedUser &&
          dueWithdrawals.length === 0 &&
          deferredWithdrawals.length > 0 && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
              لدى {selectedUser.name} مسحوبات مؤجلة مسبقاً إلى الشهر القادم (
              {deferredWithdrawals.length} عملية).
            </p>
          )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            كلمة السر (الموظف أو المدير)
          </label>
          <input
            type="password"
            inputMode="numeric"
            placeholder="••••"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={isEmployeeLocked && registeredSalary <= 0}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
          >
            {dueWithdrawals.length > 0 && withdrawalAction === 'deduct' && grossAmount > 0
              ? `تأكيد صرف الصافي (${fmt(netPayout)})`
              : 'تأكيد صرف الراتب'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
};

export interface WithdrawSubmitPayload {
  type: 'cash' | 'goods';
  storeId?: number;
  whoType?: 'manager' | 'employee';
  takenBy?: string;
  takenByUserId?: number;
  amount: number;
  items: WithdrawalItem[];
  paid?: boolean;
  paidToCash?: boolean;
  managerExclusive?: boolean;
  note?: string;
}

interface WithdrawFormProps {
  db: PosDatabase;
  storeId: number;
  storeChoices?: { id: number; name: string }[];
  currentUserName?: string;
  canRecordManagerGoods?: boolean;
  initialMode?: 'manager_cash' | 'employee_cash' | 'goods' | 'manager_goods' | '';
  onSubmit: (payload: WithdrawSubmitPayload) => void;
  onClose: () => void;
  notify: (msg: string) => void;
}

export const WithdrawForm: React.FC<WithdrawFormProps> = ({
  db,
  storeId,
  storeChoices,
  currentUserName,
  canRecordManagerGoods = false,
  initialMode = '',
  onSubmit,
  onClose,
  notify,
}) => {
  const managers = db.users.filter((u) => u.role === 'manager' || u.owner);
  const employees = db.users.filter((u) => u.role === 'employee');
  const employeeChoices = employees.length > 0 ? employees : db.users;

  const [activeStoreId, setActiveStoreId] = useState<number>(storeId);
  const [mode, setMode] = useState<
    'manager_cash' | 'employee_cash' | 'goods' | 'manager_goods' | ''
  >(initialMode);
  const [selectedManager, setSelectedManager] = useState(
    currentUserName && managers.some((m) => m.name === currentUserName)
      ? currentUserName
      : managers[0]?.name ?? ''
  );
  const [selectedEmployee, setSelectedEmployee] = useState(
    currentUserName && employeeChoices.some((e) => e.name === currentUserName)
      ? currentUserName
      : employeeChoices[0]?.name ?? ''
  );
  const [goodsTakenBy, setGoodsTakenBy] = useState(
    currentUserName && db.users.some((u) => u.name === currentUserName)
      ? currentUserName
      : db.users[0]?.name ?? ''
  );
  const [amt, setAmt] = useState('');
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [isGoodsPaid, setIsGoodsPaid] = useState<boolean>(false);
  const [addGoodsPaidToCash, setAddGoodsPaidToCash] = useState<boolean>(true);
  const [goodsNote, setGoodsNote] = useState('');

  const storeProducts = db.products.filter((p) => p.storeId === activeStoreId);

  const selectedGoodsItems: WithdrawalItem[] = storeProducts
    .filter((p) => (quantities[p.id] || 0) > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      qty: quantities[p.id],
      cost: p.cost,
    }));

  const wholesaleTotal = Math.round(
    selectedGoodsItems.reduce(
      (sum, i) => sum + i.qty * (i.cost ?? 0),
      0
    ) * 100
  ) / 100;

  const step = (id: number, stock: number, delta: number) => {
    setQuantities((prev) => ({
      ...prev,
      [id]: Math.max(0, Math.min(stock, (prev[id] || 0) + delta)),
    }));
  };

  const handleConfirm = () => {
    if (mode === 'manager_cash') {
      if (!selectedManager) {
        notify('اختر المدير الذي سحب المبلغ');
        return;
      }
      if (num(amt) <= 0) {
        notify('أدخل قيمة المبلغ المسحوب');
        return;
      }
      const mUser = db.users.find((u) => u.name === selectedManager);
      onSubmit({
        type: 'cash',
        storeId: activeStoreId,
        whoType: 'manager',
        takenBy: selectedManager,
        takenByUserId: mUser?.id,
        amount: num(amt),
        items: [],
      });
    } else if (mode === 'employee_cash') {
      if (!selectedEmployee) {
        notify('اختر الموظف الذي سحب المبلغ');
        return;
      }
      if (num(amt) <= 0) {
        notify('أدخل قيمة المبلغ المسحوب');
        return;
      }
      const eUser = db.users.find((u) => u.name === selectedEmployee);
      onSubmit({
        type: 'cash',
        storeId: activeStoreId,
        whoType: 'employee',
        takenBy: selectedEmployee,
        takenByUserId: eUser?.id,
        amount: num(amt),
        items: [],
      });
    } else if (mode === 'manager_goods') {
      if (!selectedManager) {
        notify('اختر المدير أو المالك المستلم للبضاعة');
        return;
      }
      if (!selectedGoodsItems.length) {
        notify('اختر غرضاً واحداً على الأقل');
        return;
      }
      const mUser = db.users.find((u) => u.name === selectedManager);
      onSubmit({
        type: 'goods',
        storeId: activeStoreId,
        whoType: 'manager',
        takenBy: selectedManager,
        takenByUserId: mUser?.id,
        amount: wholesaleTotal,
        items: selectedGoodsItems,
        paid: isGoodsPaid,
        paidToCash: isGoodsPaid ? addGoodsPaidToCash : false,
        managerExclusive: true,
        note: goodsNote.trim() || undefined,
      });
    } else if (mode === 'goods') {
      if (!goodsTakenBy) {
        notify('اختر الشخص المستلم للأغراض');
        return;
      }
      if (!selectedGoodsItems.length) {
        notify('اختر غرضاً واحداً على الأقل');
        return;
      }
      const takerUser = db.users.find((u) => u.name === goodsTakenBy);
      onSubmit({
        type: 'goods',
        storeId: activeStoreId,
        whoType: takerUser?.role === 'employee' ? 'employee' : 'manager',
        takenBy: goodsTakenBy,
        takenByUserId: takerUser?.id,
        amount: wholesaleTotal,
        items: selectedGoodsItems,
        paid: isGoodsPaid,
        paidToCash: isGoodsPaid ? addGoodsPaidToCash : false,
        managerExclusive:
          takerUser?.role === 'manager' || Boolean(takerUser?.owner)
            ? true
            : undefined,
        note: goodsNote.trim() || undefined,
      });
    }
    onClose();
  };

  const activeTakerName =
    mode === 'manager_goods' ? selectedManager : goodsTakenBy;
  const activeGoodsTakerUser = db.users.find((u) => u.name === activeTakerName);
  const isRecipientManagerOrOwner =
    mode === 'manager_goods' ||
    activeGoodsTakerUser?.role === 'manager' ||
    Boolean(activeGoodsTakerUser?.owner);
  const isGoodsMode = mode === 'goods' || mode === 'manager_goods';

  return (
    <Modal
      title={
        mode === 'manager_goods'
          ? 'سحب بضاعة مسجّل (خاص بالمدير والمالك فقط)'
          : 'مسحوبات الصندوق والبضاعة'
      }
      onClose={onClose}
    >
      {!mode ? (
        <div className="space-y-2.5">
          {canRecordManagerGoods && (
            <button
              type="button"
              onClick={() => setMode('manager_goods')}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#38608f] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2d4f77]"
            >
              <Package className="h-4 w-4" />
              <span>سحب بضاعة مسجّل — المدير والمالك فقط (جملة)</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode('goods')}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-600"
          >
            <Package className="h-4 w-4" />
            <span>سحب أغراض من المحل (موظف / مدير / مالك — بسعر الجملة)</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('manager_cash')}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#38608f] bg-[#38608f]/10 px-4 py-3 text-sm font-semibold text-[#38608f] transition-colors hover:bg-[#38608f]/20 dark:text-[#98c1f0]"
          >
            <Banknote className="h-4 w-4" />
            <span>سحب نقدي — مدير / مالك</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('employee_cash')}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            <UserCheck className="h-4 w-4" />
            <span>سحب نقدي — موظف</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            إلغاء
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {storeChoices && storeChoices.length > 1 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                المحل / الفرع المسحوب منه
              </label>
              <select
                value={activeStoreId}
                onChange={(e) => {
                  setActiveStoreId(Number(e.target.value));
                  setQuantities({});
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {storeChoices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === 'manager_cash' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  المدير الذي سحب المصاري
                </label>
                <select
                  value={selectedManager}
                  onChange={(e) => setSelectedManager(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {managers.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name} ({m.owner ? 'مالك' : 'مدير'})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  القيمة المسحوبة
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={amt}
                  onChange={(e) => setAmt(e.target.value)}
                  className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </>
          )}

          {mode === 'employee_cash' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  الموظف الذي سحب المصاري
                </label>
                <select
                  value={selectedEmployee}
                  onChange={(e) => setSelectedEmployee(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {employeeChoices.map((emp) => (
                    <option key={emp.id} value={emp.name}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  القيمة المسحوبة
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={amt}
                  onChange={(e) => setAmt(e.target.value)}
                  className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </>
          )}

          {isGoodsMode && (
            <div className="space-y-3">
              {mode === 'manager_goods' ? (
                <div className="rounded-lg border border-[#38608f]/30 bg-[#38608f]/5 p-3 dark:border-[#4f7fb5]/40 dark:bg-[#38608f]/10">
                  <p className="mb-2 text-xs font-bold text-[#38608f] dark:text-[#98c1f0]">
                    تُحفظ هذه العملية تلقائياً في القائمة الخاصة بالمدير والمالك فقط وورقة الإكسل الخاصة بهما
                  </p>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    اختر المدير أو المالك المستلم
                  </label>
                  <select
                    value={selectedManager}
                    onChange={(e) => setSelectedManager(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {managers.map((m) => (
                      <option key={m.id} value={m.name}>
                        {m.name} ({m.owner ? 'مالك' : 'مدير'})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    الشخص المستلم للأغراض (باسمه في السجل)
                  </label>
                  <select
                    value={goodsTakenBy}
                    onChange={(e) => setGoodsTakenBy(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {db.users.map((u) => (
                      <option key={u.id} value={u.name}>
                        {u.name} ({u.owner ? 'مالك' : u.role === 'manager' ? 'مدير' : 'موظف'})
                      </option>
                    ))}
                  </select>
                  {isRecipientManagerOrOwner && (
                    <p className="rounded-lg border border-[#38608f]/30 bg-[#38608f]/5 px-3 py-2 text-[11px] font-semibold text-[#38608f] dark:border-[#4f7fb5]/40 dark:bg-[#38608f]/15 dark:text-[#98c1f0]">
                      بما أن المستلم مدير/مالك، سيتم تسجيل السحب تلقائياً في القائمة الخاصة بالمدير والمالك منفصلاً عن الموظفين.
                    </p>
                  )}
                </div>
              )}

              <div className="max-h-56 divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {storeProducts.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{p.name}</span>
                      <div className="font-num text-[11px] text-slate-500 dark:text-slate-400">
                        المتوفر: {p.stock} · سعر الجملة:{' '}
                        <strong className="text-[#38608f] dark:text-[#78a8de]">
                          {fmt(p.cost)}
                        </strong>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => step(p.id, p.stock, -1)}
                        className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 text-sm font-bold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        -
                      </button>
                      <span className="font-num w-6 text-center font-semibold">
                        {quantities[p.id] || 0}
                      </span>
                      <button
                        type="button"
                        onClick={() => step(p.id, p.stock, 1)}
                        className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 text-sm font-bold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2.5 rounded-xl border border-[#38608f]/30 bg-[#38608f]/5 p-3 dark:border-[#4f7fb5]/40 dark:bg-[#38608f]/10">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    السعر الإجمالي بسعر الجملة:
                  </span>
                  <span className="font-num text-base font-bold text-[#38608f] dark:text-[#78a8de]">
                    {fmt(wholesaleTotal)}
                  </span>
                </div>

                <div>
                  <span className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {isRecipientManagerOrOwner
                      ? `خيارات الدفع أو التسجيل لـ ${activeTakerName || 'المدير / المالك'}:`
                      : `هل حاسب ${activeTakerName || 'المستلم'} على الأغراض؟`}
                  </span>
                  {isRecipientManagerOrOwner ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setIsGoodsPaid(false)}
                        className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                          !isGoodsPaid
                            ? 'border-[#38608f] bg-[#38608f] text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                        }`}
                      >
                        تسجيل بالقائمة فقط (بدون دفع الآن)
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsGoodsPaid(true)}
                        className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                          isGoodsPaid
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                        }`}
                      >
                        دفع وحساب الآن (بسعر الجملة)
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setIsGoodsPaid(false)}
                        className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                          !isGoodsPaid
                            ? 'border-rose-600 bg-rose-600 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                        }`}
                      >
                        لا (لم يحاسب بعد)
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsGoodsPaid(true)}
                        className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                          isGoodsPaid
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                        }`}
                      >
                        نعم (حاسب عليها)
                      </button>
                    </div>
                  )}
                </div>

                {isGoodsPaid && wholesaleTotal > 0 && (
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={addGoodsPaidToCash}
                      onChange={(e) => setAddGoodsPaidToCash(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#38608f]"
                    />
                    <span>إضافة المبلغ المدفوع ({fmt(wholesaleTotal)}) إلى صندوق المحل</span>
                  </label>
                )}

                <input
                  placeholder="ملاحظة عن السحب (اختياري)..."
                  value={goodsNote}
                  onChange={(e) => setGoodsNote(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap"
            >
              {isRecipientManagerOrOwner
                ? isGoodsPaid
                  ? 'حفظ السحب وتسجيل الدفع'
                  : 'تسجيل بالقائمة الخاصة'
                : 'حفظ وإبلاغ الإدارة'}
            </button>
            <button
              type="button"
              onClick={() => setMode('')}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              رجوع
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};

interface InvoiceModalProps {
  sale: Sale;
  storeName?: string;
  onClose: () => void;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({
  sale,
  storeName,
  onClose,
}) => (
  <Modal title="تمت العملية بنجاح" onClose={onClose}>
    <div id="invoice" className="space-y-3">
      <div className="text-center">
        <h3 className="text-lg font-bold">
          فاتورة #{sale.id}
          {storeName ? ` · ${storeName}` : ''}
        </h3>
        <p className="font-num text-xs text-slate-500 dark:text-slate-400">
          {fullDate(sale.ts)} · {sale.emp}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
              <th className="px-3 py-2 text-right font-semibold">الصنف</th>
              <th className="px-3 py-2 text-center font-semibold">العدد</th>
              <th className="px-3 py-2 text-center font-semibold">السعر</th>
              <th className="px-3 py-2 text-left font-semibold">المجموع</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {sale.items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2 font-medium">{item.name}</td>
                <td className="font-num px-3 py-2 text-center">{item.qty}</td>
                <td className="font-num px-3 py-2 text-center">
                  {fmt(item.price)}
                </td>
                <td className="font-num px-3 py-2 text-left font-semibold">
                  {fmt(item.qty * item.price)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {Boolean(sale.discount && sale.discount > 0) && (
        <div className="space-y-1 border-t border-slate-200 pt-2.5 text-xs dark:border-slate-800">
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
            <span>المجموع قبل الخصم</span>
            <span className="font-num font-semibold">
              {fmt(sale.subtotalBeforeDiscount ?? sale.total + (sale.discount ?? 0))}
            </span>
          </div>
          <div className="flex items-center justify-between text-amber-700 dark:text-amber-400">
            <span>الخصم الموزّع على القطع</span>
            <span className="font-num font-bold">-{fmt(sale.discount)}</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-base font-bold dark:border-slate-800">
        <span>{sale.discount && sale.discount > 0 ? 'الصافي النهائي' : 'الإجمالي'}</span>
        <span className="font-num text-lg text-[#38608f] dark:text-[#6aa0db]">
          {fmt(sale.total)}
        </span>
      </div>
    </div>

    <div className="mt-4 flex gap-2">
      <button
        type="button"
        onClick={() => window.print()}
        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#38608f] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2d4f77] whitespace-nowrap"
      >
        <Printer className="h-4 w-4" />
        <span>طباعة</span>
      </button>
      <button
        type="button"
        onClick={onClose}
        className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
      >
        إغلاق
      </button>
    </div>
  </Modal>
);

interface StockIntakeModalProps {
  db: PosDatabase;
  defaultStoreId: number;
  isManager: boolean;
  onSubmit: (payload: {
    storeId: number;
    items: StockIntakeItem[];
    photoDataUrl?: string;
    supplierName: string;
    note: string;
    initialPaymentAmount: number;
    deductFromCash: boolean;
  }) => void;
  onClose: () => void;
  notify: (msg: string) => void;
}

interface DraftIntakeLine {
  productId: string;
  name: string;
  qty: string;
  cost: string;
  price: string;
  min: string;
}

const emptyLine = (): DraftIntakeLine => ({
  productId: '',
  name: '',
  qty: '',
  cost: '',
  price: '',
  min: '',
});

export const StockIntakeModal: React.FC<StockIntakeModalProps> = ({
  db,
  defaultStoreId,
  isManager,
  onSubmit,
  onClose,
  notify,
}) => {
  const [storeId, setStoreId] = useState<number>(defaultStoreId);
  const [lines, setLines] = useState<DraftIntakeLine[]>([emptyLine()]);
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [note, setNote] = useState('');
  const [paymentMode, setPaymentMode] = useState<'unpaid' | 'partial' | 'paid'>(
    'unpaid'
  );
  const [partialPaid, setPartialPaid] = useState('');
  const [deductFromCash, setDeductFromCash] = useState(true);
  const [processingImg, setProcessingImg] = useState(false);

  const storeProducts = db.products.filter((p) => p.storeId === storeId);

  const liveTotalCost = lines.reduce((sum, line) => {
    const q = Math.max(0, Math.floor(num(line.qty)));
    const c = Math.max(0, num(line.cost));
    return sum + q * c;
  }, 0);

  const resolvedInitialPay =
    paymentMode === 'paid'
      ? Math.round(liveTotalCost * 100) / 100
      : paymentMode === 'partial'
        ? Math.max(0, num(partialPaid))
        : 0;

  const remainingPreview = Math.max(
    0,
    Math.round((liveTotalCost - resolvedInitialPay) * 100) / 100
  );

  const handleSelectProduct = (idx: number, prodIdStr: string) => {
    const prod = storeProducts.find((p) => String(p.id) === prodIdStr);
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== idx) return line;
        if (!prod) {
          return { ...line, productId: '', name: '' };
        }
        return {
          ...line,
          productId: String(prod.id),
          name: prod.name,
          cost: String(prod.cost),
          price: String(prod.price),
          min: String(prod.min),
        };
      })
    );
  };

  const updateLine = (
    idx: number,
    key: keyof DraftIntakeLine,
    value: string
  ) => {
    setLines((prev) =>
      prev.map((line, i) => (i === idx ? { ...line, [key]: value } : line))
    );
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessingImg(true);
    try {
      const compressed = await compressImageFile(file);
      setPhotoDataUrl(compressed);
    } catch {
      notify('تعذر معالجة صورة الفاتورة');
    } finally {
      setProcessingImg(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedItems: StockIntakeItem[] = [];
    for (const line of lines) {
      const name = line.name.trim();
      const qty = Math.floor(num(line.qty));
      const cost = num(line.cost);
      const price = num(line.price);
      const min = num(line.min);
      if (!name || qty <= 0 || cost <= 0 || price <= 0 || min <= 0) {
        notify('يرجى إدخال الاسم المحدد والعدد والجملة وسعر المبيع والحد الأدنى لكل صنف');
        return;
      }
      if (min > price) {
        notify(`الحد الأدنى للصنف "${name}" يجب ألا يتجاوز سعر المبيع`);
        return;
      }
      const matchedExisting = storeProducts.find(
        (p) =>
          String(p.id) === line.productId || norm(p.name) === norm(name)
      );
      parsedItems.push({
        productId: matchedExisting?.id,
        name,
        qty,
        cost,
        price,
        min,
      });
    }

    const totalCost = parsedItems.reduce((a, i) => a + i.qty * i.cost, 0);
    if (paymentMode === 'partial' && (resolvedInitialPay <= 0 || resolvedInitialPay > totalCost)) {
      notify(`أدخل قيمة دفعة جزئية صالحة (بين 1 و ${fmt(totalCost)})`);
      return;
    }

    onSubmit({
      storeId,
      items: parsedItems,
      photoDataUrl: photoDataUrl || undefined,
      supplierName: supplierName.trim(),
      note: note.trim(),
      initialPaymentAmount: resolvedInitialPay,
      deductFromCash: resolvedInitialPay > 0 ? deductFromCash : false,
    });
    onClose();
  };

  return (
    <Modal
      title={
        isManager
          ? 'إدخال بضاعة جديدة (تصوير الفاتورة اختياري)'
          : 'طلب توريد بضاعة (بموافقة المدير)'
      }
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {isManager
            ? 'تُضاف البضاعة مباشرة إلى مخزن المحل المحدد، ويمكنك تصوير الفاتورة الآن أو إرفاق صورتها لاحقاً من أرشيف الفواتير.'
            : 'لا يمكنك تعديل الكميات الموجودة مسبقاً. أدخل الأصناف وحالة السداد، وتصوير الفاتورة اختياري (يمكن إرفاق الصورة الآن أو لاحقاً).'}
        </p>

        {isManager && db.stores.length > 1 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              المحل / الفرع
            </label>
            <select
              value={storeId}
              onChange={(e) => {
                setStoreId(Number(e.target.value));
                setLines([emptyLine()]);
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
            >
              {db.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-3">
          {lines.map((line, idx) => (
            <div
              key={idx}
              className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  الصنف #{idx + 1}
                </span>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setLines((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:underline dark:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>إزالة</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    اختيار صنف حالي (أو اتركه لصنف جديد)
                  </label>
                  <select
                    value={line.productId}
                    onChange={(e) => handleSelectProduct(idx, e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="">-- صنف جديد / كتابة يدوية --</option>
                    {storeProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    الاسم المحدد للبضاعة
                  </label>
                  <input
                    placeholder="مثال: شال كشمير روز"
                    value={line.name}
                    onChange={(e) => updateLine(idx, 'name', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    العدد الوارد
                  </label>
                  <input
                    type="number"
                    min="1"
                    placeholder="0"
                    value={line.qty}
                    onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                    className="font-num w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    سعر الجملة
                  </label>
                  <input
                    type="number"
                    min="1"
                    placeholder="0"
                    value={line.cost}
                    onChange={(e) => updateLine(idx, 'cost', e.target.value)}
                    className="font-num w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    سعر المبيع
                  </label>
                  <input
                    type="number"
                    min="1"
                    placeholder="0"
                    value={line.price}
                    onChange={(e) => updateLine(idx, 'price', e.target.value)}
                    className="font-num w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    الحد الأدنى للقطعة
                  </label>
                  <input
                    type="number"
                    min="1"
                    placeholder="0"
                    value={line.min}
                    onChange={(e) => updateLine(idx, 'min', e.target.value)}
                    className="font-num w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>إضافة صنف آخر لنفس الفاتورة</span>
          </button>
        </div>

        {/* Supplier & Note */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              اسم المورد / التاجر
            </label>
            <input
              placeholder="مثال: شركة النور، أبو أحمد..."
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              ملاحظة أو رقم الفاتورة الورقية
            </label>
            <input
              placeholder="اختياري..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>

        {/* Invoice Installment & Payment Status */}
        <div className="space-y-3 rounded-xl border border-[#38608f]/30 bg-[#38608f]/5 p-3.5 dark:border-[#4f7fb5]/40 dark:bg-[#38608f]/10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
              حالة سداد الفاتورة (الدفع دفعة واحدة أو تقسيم دفعات)
            </span>
            <span className="font-num text-xs font-bold text-[#38608f] dark:text-[#78a8de]">
              إجمالي الجملة: {fmt(liveTotalCost)}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['unpaid', 'على الحساب (غير مدفوعة)'],
                ['partial', 'دفعة جزئية الآن'],
                ['paid', 'مدفوعة بالكامل'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setPaymentMode(k)}
                className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors ${
                  paymentMode === k
                    ? 'border-[#38608f] bg-[#38608f] text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {paymentMode === 'partial' && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  المبلغ المدفوع الآن
                </label>
                <input
                  type="number"
                  min={1}
                  inputMode="decimal"
                  placeholder="0"
                  value={partialPaid}
                  onChange={(e) => setPartialPaid(e.target.value)}
                  className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div className="flex flex-col justify-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800/80 dark:bg-amber-950/30">
                <span className="text-slate-500 dark:text-slate-400">
                  المتبقي علينا من الفاتورة:
                </span>
                <span className="font-num text-sm font-bold text-amber-700 dark:text-amber-300">
                  {fmt(remainingPreview)}
                </span>
              </div>
            </div>
          )}

          {paymentMode !== 'unpaid' && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={deductFromCash}
                onChange={(e) => setDeductFromCash(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-[#38608f]"
              />
              <span>خصم المبلغ المدفوع ({fmt(resolvedInitialPay)}) من صندوق المحل الحالي</span>
            </label>
          )}
        </div>

        {/* Invoice Photo Capture / Upload (Optional) */}
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              صورة الفاتورة (اختيارية — يمكن إضافتها الآن أو لاحقاً)
            </label>
            {photoDataUrl && (
              <button
                type="button"
                onClick={() => setPhotoDataUrl('')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline dark:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>إزالة الصورة</span>
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#38608f] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2d4f77]">
              <Camera className="h-4 w-4" />
              <span>تصوير بالكاميرا</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoChange}
                className="hidden"
              />
            </label>

            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
              <Upload className="h-4 w-4" />
              <span>رفع صورة من الجهاز</span>
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="hidden"
              />
            </label>

            {processingImg && (
              <span className="text-xs text-slate-500">جاري ضغط الصورة...</span>
            )}
          </div>

          {photoDataUrl && (
            <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950">
              <img
                src={photoDataUrl}
                alt="معاينة صورة الفاتورة"
                className="mx-auto max-h-52 rounded object-contain"
              />
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <button
            type="submit"
            disabled={processingImg}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
          >
            {isManager ? 'حفظ وإدخال للمخزن والأرشيف' : 'إرسال للمدير للمطابقة'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
};

interface PhotoLightboxModalProps {
  intake: StockIntake;
  storeName: string;
  onClose: () => void;
  onAttachPhoto?: (intake: StockIntake, photoDataUrl: string) => void;
  notify?: (msg: string) => void;
}

export const PhotoLightboxModal: React.FC<PhotoLightboxModalProps> = ({
  intake,
  storeName,
  onClose,
  onAttachPhoto,
  notify,
}) => {
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const { totalCost, paidAmount, remainingAmount, paymentStatus } =
    getIntakeTotals(intake);

  const handleReplaceOrAttachPhoto = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onAttachPhoto) return;
    setUploadingPhoto(true);
    try {
      const compressed = await compressImageFile(file);
      onAttachPhoto(intake, compressed);
    } catch {
      notify?.('تعذر معالجة صورة الفاتورة');
    } finally {
      setUploadingPhoto(false);
    }
  };

  return (
    <Modal
      title={`فاتورة توريد #${intake.id} · ${storeName}`}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>
            أدخلها: <strong className="text-slate-800 dark:text-slate-200">{intake.enteredBy}</strong>
            {intake.supplierName && (
              <>
                {' · '}المورد:{' '}
                <strong className="text-slate-800 dark:text-slate-200">
                  {intake.supplierName}
                </strong>
              </>
            )}
            {intake.approvedBy && (
              <>
                {' · '}اعتمدها:{' '}
                <strong className="text-emerald-700 dark:text-emerald-400">
                  {intake.approvedBy}
                </strong>
              </>
            )}
          </span>
          <span className="font-num">{fullDate(intake.ts)}</span>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
          {intake.photoDataUrl ? (
            <div className="space-y-3">
              <img
                src={intake.photoDataUrl}
                alt={`فاتورة توريد ${intake.id}`}
                className="mx-auto max-h-[52vh] w-auto rounded object-contain"
              />
              {onAttachPhoto && (
                <div className="flex flex-wrap items-center justify-center gap-2 border-t border-slate-200 pt-2.5 dark:border-slate-800">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#38608f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2d4f77] whitespace-nowrap">
                    <Camera className="h-3.5 w-3.5" />
                    <span>تحديث بالكاميرا</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleReplaceOrAttachPhoto}
                      className="hidden"
                    />
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap">
                    <Upload className="h-3.5 w-3.5" />
                    <span>رفع صورة بديلة</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleReplaceOrAttachPhoto}
                      className="hidden"
                    />
                  </label>
                  {uploadingPhoto && (
                    <span className="text-xs text-slate-500">جاري حفظ الصورة...</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-200/80 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <ImageIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  لا توجد صورة مرفقة لهذه الفاتورة بعد
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  يمكنك تصوير الفاتورة أو رفع صورتها الآن لإضافتها إلى هذه الفاتورة
                </p>
              </div>
              {onAttachPhoto && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#38608f] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#2d4f77] whitespace-nowrap">
                    <Camera className="h-4 w-4" />
                    <span>تصوير الفاتورة الآن</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleReplaceOrAttachPhoto}
                      className="hidden"
                    />
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap">
                    <Upload className="h-4 w-4" />
                    <span>رفع صورة من الجهاز</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleReplaceOrAttachPhoto}
                      className="hidden"
                    />
                  </label>
                  {uploadingPhoto && (
                    <span className="text-xs text-slate-500">جاري معالجة الصورة...</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                <th className="px-3 py-2 text-right font-semibold">الصنف</th>
                <th className="px-3 py-2 text-center font-semibold">العدد</th>
                <th className="px-3 py-2 text-center font-semibold">الجملة</th>
                <th className="px-3 py-2 text-center font-semibold">المبيع</th>
                <th className="px-3 py-2 text-left font-semibold">الحد الأدنى</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {intake.items.map((item, idx) => (
                <tr key={idx}>
                  <td className="px-3 py-2 font-medium">{item.name}</td>
                  <td className="font-num px-3 py-2 text-center font-bold">
                    {fmt(item.qty)}
                  </td>
                  <td className="font-num px-3 py-2 text-center">
                    {fmt(item.cost)}
                  </td>
                  <td className="font-num px-3 py-2 text-center">
                    {fmt(item.price)}
                  </td>
                  <td className="font-num px-3 py-2 text-left">
                    {fmt(item.min)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-center text-xs dark:border-slate-800 dark:bg-slate-950">
          <div>
            <span className="text-slate-500 dark:text-slate-400">الإجمالي</span>
            <p className="font-num mt-0.5 text-sm font-bold text-[#38608f] dark:text-[#78a8de]">
              {fmt(totalCost)}
            </p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">المدفوع</span>
            <p className="font-num mt-0.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">
              {fmt(paidAmount)}
            </p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">المتبقي</span>
            <p className="font-num mt-0.5 text-sm font-bold text-rose-600 dark:text-rose-400">
              {fmt(remainingAmount)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-800">
          <span className="text-slate-600 dark:text-slate-400">
            {intake.note || 'بدون ملاحظات إضافية'}
          </span>
          <span className="font-semibold text-slate-700 dark:text-slate-300">
            الحالة:{' '}
            {paymentStatus === 'paid'
              ? 'مسددة بالكامل'
              : paymentStatus === 'partial'
                ? 'مدفوعة جزئياً'
                : 'على الحساب'}
          </span>
        </div>
      </div>
    </Modal>
  );
};

interface BonusModalProps {
  db: PosDatabase;
  initialEmpName?: string;
  initialStoreId?: number;
  onSubmit: (payload: {
    empName: string;
    uid?: number;
    storeId: number;
    amount: number;
    note: string;
    deductFromCash: boolean;
  }) => void;
  onClose: () => void;
  notify: (msg: string) => void;
}

export const BonusModal: React.FC<BonusModalProps> = ({
  db,
  initialEmpName = '',
  initialStoreId,
  onSubmit,
  onClose,
  notify,
}) => {
  const employeeNames = Array.from(
    new Set([
      ...db.users.map((u) => u.name),
      ...db.sales.map((s) => s.emp),
    ])
  ).filter(Boolean);

  const [empName, setEmpName] = useState(
    initialEmpName || employeeNames[0] || ''
  );
  const [storeId, setStoreId] = useState<number>(() => {
    if (initialStoreId) return initialStoreId;
    const u = db.users.find((x) => x.name === initialEmpName);
    return u?.storeId ?? db.stores[0]?.id ?? 1;
  });
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('مكافأة التميز وأعلى مبيعات');
  const [deductFromCash, setDeductFromCash] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = num(amount);
    if (!empName.trim() || val <= 0) {
      notify('اختر الموظف وأدخل قيمة المكافأة أكبر من صفر');
      return;
    }
    const matchedUser = db.users.find((u) => u.name === empName.trim());
    onSubmit({
      empName: empName.trim(),
      uid: matchedUser?.id,
      storeId,
      amount: val,
      note: note.trim() || 'مكافأة تحفيزية',
      deductFromCash,
    });
    onClose();
  };

  return (
    <Modal title="إرسال مكافأة لموظف" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/80 dark:bg-amber-950/30 dark:text-amber-200">
          <Award className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>تصل المكافأة كإشعار مباشر للموظف عند دخوله وتُحفظ في السجل الشهري.</span>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            الموظف
          </label>
          <select
            value={empName}
            onChange={(e) => setEmpName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {employeeNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {db.stores.length > 1 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              المحل / الفرع
            </label>
            <select
              value={storeId}
              onChange={(e) => setStoreId(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {db.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            قيمة المكافأة
          </label>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            سبب / رسالة المكافأة
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: مكافأة أكثر موظف مبيعاً"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <input
            type="checkbox"
            checked={deductFromCash}
            onChange={(e) => setDeductFromCash(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-[#38608f]"
          />
          <span>خصم المكافأة من صندوق المحل وتسجيلها ضمن المصاريف اليومية</span>
        </label>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap"
          >
            إرسال المكافأة
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
};

interface EditUserModalProps {
  db: PosDatabase;
  targetUser: User;
  currentUser: User;
  onSubmit: (payload: {
    userId: number;
    name: string;
    role: UserRole;
    storeIds: number[];
    salary: number;
    pin?: string;
  }) => void;
  onClose: () => void;
  notify: (msg: string) => void;
}

export const EditUserModal: React.FC<EditUserModalProps> = ({
  db,
  targetUser,
  currentUser,
  onSubmit,
  onClose,
  notify,
}) => {
  const [name, setName] = useState(targetUser.name);
  const [role, setRole] = useState<UserRole>(targetUser.role);
  const [storeIds, setStoreIds] = useState<number[]>(() =>
    getUserStoreIds(targetUser, db.stores)
  );
  const [salary, setSalary] = useState(String(targetUser.salary ?? 0));
  const canViewPin = Boolean(
    currentUser.owner || targetUser.role === 'employee'
  );
  const [newPin, setNewPin] = useState('');

  const canChangeRole = Boolean(currentUser.owner && !targetUser.owner);

  const toggleStore = (id: number) => {
    setStoreIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) {
          notify('يجب إبقاء فرع واحد على الأقل للحساب');
          return prev;
        }
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      notify('أدخل اسم الموظف');
      return;
    }

    const trimmedPin = newPin.trim();
    if (trimmedPin) {
      if (trimmedPin.length < 4) {
        notify('الرقم السري يجب أن يكون 4 خانات على الأقل');
        return;
      }
      const conflict = db.users.some(
        (x) =>
          x.id !== targetUser.id &&
          x.pin === trimmedPin &&
          (x.role === 'manager') !== (role === 'manager')
      );
      if (conflict) {
        notify('هذا الرقم مستخدم لحساب آخر، اختر رقماً مختلفاً');
        return;
      }
    }

    onSubmit({
      userId: targetUser.id,
      name: trimmedName,
      role: canChangeRole ? role : targetUser.role,
      storeIds,
      salary: Math.max(0, num(salary)),
      pin: trimmedPin || undefined,
    });
    onClose();
  };

  return (
    <Modal title={`تعديل بيانات: ${targetUser.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            الاسم
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="الاسم"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
              الفروع المصرح بها (يدعم فرع واحد أو عدة فروع للحالات الطارئة)
            </label>
            {!targetUser.owner && db.stores.length > 1 && (
              <button
                type="button"
                onClick={() => setStoreIds(db.stores.map((s) => s.id))}
                className="text-[11px] font-semibold text-[#38608f] hover:underline dark:text-[#78a8de]"
              >
                تحديد الكل
              </button>
            )}
          </div>
          {targetUser.owner ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
              حساب المالك يملك صلاحية الوصول الكاملة لجميع الفروع تلقائياً.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {db.stores.map((s) => {
                const checked = storeIds.includes(s.id);
                return (
                  <label
                    key={s.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                      checked
                        ? 'border-[#38608f] bg-[#38608f]/10 text-[#38608f] dark:border-[#6aa0db] dark:text-[#98c1f0]'
                        : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleStore(s.id)}
                      className="h-4 w-4 rounded border-slate-300 text-[#38608f]"
                    />
                    <span className="truncate">{s.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              الصلاحية
            </label>
            <select
              value={role}
              disabled={!canChangeRole}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="employee">موظف</option>
              <option value="manager">{targetUser.owner ? 'مالك' : 'مدير'}</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              الراتب المسجل
            </label>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            تغيير الرقم السري (اتركه فارغاً للإبقاء على الحالي — يصل إشعار للمالك عند التغيير)
          </label>
          <input
            type={canViewPin ? 'text' : 'password'}
            inputMode="numeric"
            placeholder={canViewPin ? `الحالي: ${targetUser.pin}` : '••••'}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            className="flex-1 rounded-lg bg-[#38608f] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2d4f77] whitespace-nowrap"
          >
            حفظ التعديلات
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
};

interface AddBranchModalProps {
  sheetsConnected: boolean;
  onSubmit: (name: string) => void;
  onClose: () => void;
  notify: (msg: string) => void;
}

export const AddBranchModal: React.FC<AddBranchModalProps> = ({
  sheetsConnected,
  onSubmit,
  onClose,
  notify,
}) => {
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      notify('أدخل اسم الفرع الجديد');
      return;
    }
    onSubmit(trimmed);
    onClose();
  };

  return (
    <Modal title="إضافة فرع / محل جديد" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900 dark:border-emerald-800/80 dark:bg-emerald-950/30 dark:text-emerald-200">
          <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>
            {sheetsConnected
              ? 'فور إضافة الفرع سيتم تجهيز جداول إكسل وإنشاء جدول Google Sheets مستقل له تلقائياً (المخزون، دخول البضاعة، المبيعات، الأرباح، المصاريف، الخصومات، الإيجار، ودفعات الفواتير).'
              : 'فور إضافة الفرع يتم تجهيز كافة أوراق Excel المستقلة له تلقائياً، وعند ربط Google Sheets سيُنشأ جدوله فوراً.'}
          </span>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
            اسم المحل / الفرع الجديد
          </label>
          <div className="relative">
            <Store className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              placeholder="مثال: فرع الحمراء، فرع الجسر..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-9 pl-3 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap"
          >
            إضافة الفرع وتجهيز شيتاته
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
};

interface RentModalProps {
  db: PosDatabase;
  defaultStoreId: number;
  allowedStoreIds?: number[];
  onSubmit: (payload: {
    storeId: number;
    month: string;
    usdAmount: number;
    exchangeRate: number;
    localAmount: number;
    deductFromCash: boolean;
    note: string;
  }) => void;
  onClose: () => void;
  notify: (msg: string) => void;
}

export const RentModal: React.FC<RentModalProps> = ({
  db,
  defaultStoreId,
  allowedStoreIds,
  onSubmit,
  onClose,
  notify,
}) => {
  const stores = allowedStoreIds
    ? db.stores.filter((s) => allowedStoreIds.includes(s.id))
    : db.stores;
  const [storeId, setStoreId] = useState<number>(() =>
    stores.some((s) => s.id === defaultStoreId)
      ? defaultStoreId
      : stores[0]?.id ?? 1
  );
  const [month, setMonth] = useState<string>(() => monthKey(Date.now()));
  const [usdAmount, setUsdAmount] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');
  const [deductFromCash, setDeductFromCash] = useState(true);
  const [note, setNote] = useState('');

  const parsedUsd = Math.max(0, num(usdAmount));
  const parsedRate = Math.max(0, num(exchangeRate));
  const localAmount = Math.round(parsedUsd * parsedRate * 100) / 100;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!month) {
      notify('اختر الشهر');
      return;
    }
    if (parsedUsd <= 0 || parsedRate <= 0) {
      notify('أدخل قيمة الإيجار بالدولار وسعر الصرف أكبر من صفر');
      return;
    }
    onSubmit({
      storeId,
      month,
      usdAmount: parsedUsd,
      exchangeRate: parsedRate,
      localAmount,
      deductFromCash,
      note: note.trim(),
    });
    onClose();
  };

  return (
    <Modal title="تسجيل إيجار المحل (دولار × سعر الصرف)" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-xs text-sky-900 dark:border-sky-800/80 dark:bg-sky-950/30 dark:text-sky-200">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-[#38608f] dark:text-[#78a8de]" />
          <span>
            يُضرب الإيجار بالدولار بسعر الصرف تلقائياً، ويُسجّل منفصلاً لكل فرع وفي شيت الإيجار الخاص به، ويُخصم آخر الشهر من صافي الأرباح.
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              المحل / الفرع
            </label>
            <select
              value={storeId}
              onChange={(e) => setStoreId(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              عن شهر
            </label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              الإيجار بالدولار ($)
            </label>
            <div className="relative">
              <DollarSign className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                placeholder="مثال: 500"
                value={usdAmount}
                onChange={(e) => setUsdAmount(e.target.value)}
                className="font-num w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-8 pl-3 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              سعر الصرف لهذا الشهر
            </label>
            <input
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              placeholder="مثال: 14000"
              value={exchangeRate}
              onChange={(e) => setExchangeRate(e.target.value)}
              className="font-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-center dark:border-emerald-800/80 dark:bg-emerald-950/30">
          <span className="text-xs text-slate-600 dark:text-slate-300">
            قيمة الإيجار المدفوع لهذا الشهر ({fmt(parsedUsd)} × {fmt(parsedRate)})
          </span>
          <p className="font-num mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400">
            {fmt(localAmount)}
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            ملاحظة (اختياري)
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: إيجار المحل + خدمات"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <input
            type="checkbox"
            checked={deductFromCash}
            onChange={(e) => setDeductFromCash(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-[#38608f]"
          />
          <span>خصم قيمة الإيجار من صندوق الفرع الحالي</span>
        </label>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            className="flex-1 rounded-lg bg-[#38608f] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2d4f77] whitespace-nowrap"
          >
            حفظ وخصم من ربح الشهر
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
};


