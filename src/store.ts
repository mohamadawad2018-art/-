import type {
  ActivityCategory,
  CartItem,
  CustomerDebt,
  InternalMessage,
  PosDatabase,
  Product,
  SaleItem,
  ShiftRecord,
  StockIntake,
  StoreBranch,
  User,
  UserRole,
  Withdrawal,
} from './types';

export const STORAGE_KEY = 'pos_v4';
export const SESSION_KEY = 'pos_v4_session';
export const PENDING_SYNC_KEY = 'pos_v4_pending_sync';

export interface SavedSessionRef {
  userId: number;
  storeId: number;
  savedAt: number;
}

export const loadSavedSession = (d: PosDatabase): { user: User; storeId: number } | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedSessionRef>;
    if (!parsed || typeof parsed.userId !== 'number') return null;
    const user = d.users.find((u) => u.id === parsed.userId);
    if (!user) return null;
    const allowedIds = getUserStoreIds(user, d.stores);
    const storeId =
      typeof parsed.storeId === 'number' && allowedIds.includes(parsed.storeId)
        ? parsed.storeId
        : allowedIds[0] ?? d.stores[0]?.id ?? 1;
    return { user, storeId };
  } catch {
    return null;
  }
};

export const saveSessionRef = (userId: number, storeId: number): void => {
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ userId, storeId, savedAt: Date.now() })
    );
  } catch {
    // Ignore storage errors
  }
};

export const clearSavedSession = (): void => {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore storage errors
  }
};

export const num = (v: unknown): number => {
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? 0 : n;
};

export const fmt = (n: number | undefined | null): string =>
  Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

export const norm = (s: string): string =>
  (s || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/[ةە]/g, 'ه')
    .replace(/ک/g, 'ك')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ط/g, 'ت')
    .replace(/\s+/g, ' ')
    .trim();

export const matchesQuery = (text: string, query: string): boolean => {
  const q = norm(query);
  if (!q) return true;
  const target = norm(text);
  const tokens = q.split(' ').filter(Boolean);
  return tokens.every((token) => target.includes(token));
};

export const sameDay = (ts: number, refTs = Date.now()): boolean =>
  new Date(ts).toDateString() === new Date(refTs).toDateString();

export const dayKey = (ts: number): string => {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const monthKey = (ts: number): string => dayKey(ts).slice(0, 7);

export const ARABIC_WEEKDAYS = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

export const ARABIC_GREGORIAN_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const;

export const formatMonthArabic = (mKey: string): string => {
  const [yStr, mStr] = mKey.split('-');
  const mIdx = Number(mStr) - 1;
  const monthName = ARABIC_GREGORIAN_MONTHS[mIdx] ?? mStr;
  return yStr ? `${monthName} ${yStr}` : mKey;
};

export const formatGregorianParts = (ts = Date.now()) => {
  const d = new Date(ts);
  const weekday = ARABIC_WEEKDAYS[d.getDay()];
  const day = String(d.getDate()).padStart(2, '0');
  const monthNum = String(d.getMonth() + 1).padStart(2, '0');
  const monthName = ARABIC_GREGORIAN_MONTHS[d.getMonth()];
  const year = d.getFullYear();

  const hours24 = d.getHours();
  const period = hours24 >= 12 ? 'م' : 'ص';
  const hours12 = String(hours24 % 12 || 12).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return {
    weekday,
    dateNumeric: `${year}/${monthNum}/${day}`,
    dateVerbose: `${day} ${monthName} ${year}`,
    time12: `${hours12}:${minutes}:${seconds} ${period}`,
  };
};

export const tm = (ts: number): string =>
  new Date(ts).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' });

export const fullDate = (ts: number): string =>
  new Date(ts).toLocaleString('ar-SY');

export const compressImageFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('فشل قراءة الصورة'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ملف الصورة غير صالح'));
      img.onload = () => {
        const maxDim = 960;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

export const getUserStoreIds = (
  u: User | null | undefined,
  stores: StoreBranch[]
): number[] => {
  const validIds = stores.map((s) => s.id);
  if (!u || u.owner) return validIds;
  const raw =
    Array.isArray(u.storeIds) && u.storeIds.length > 0
      ? u.storeIds
      : u.storeId !== undefined
        ? [u.storeId]
        : [];
  const filtered = Array.from(
    new Set(raw.filter((id) => validIds.includes(id)))
  );
  if (filtered.length > 0) return filtered;
  return validIds[0] !== undefined ? [validIds[0]] : [1];
};

export const getIntakeTotals = (
  intake: StockIntake
): {
  totalCost: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
} => {
  const totalCost =
    Math.round(
      intake.items.reduce((a, i) => a + i.qty * i.cost, 0) * 100
    ) / 100;
  const paidAmount =
    Math.round(
      (intake.payments ?? []).reduce((a, p) => a + Math.max(0, p.amount), 0) *
        100
    ) / 100;
  const remainingAmount = Math.max(
    0,
    Math.round((totalCost - paidAmount) * 100) / 100
  );
  const paymentStatus: 'unpaid' | 'partial' | 'paid' =
    totalCost > 0 && remainingAmount <= 0
      ? 'paid'
      : paidAmount > 0
        ? 'partial'
        : 'unpaid';
  return { totalCost, paidAmount, remainingAmount, paymentStatus };
};

export const getNextMonthKey = (mKey?: string): string => {
  const base = mKey && /^\d{4}-\d{2}$/.test(mKey) ? mKey : monthKey(Date.now());
  const [y, m] = base.split('-').map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
};

export const getWithdrawalWholesaleTotal = (
  w: Withdrawal,
  products: Product[]
): number => {
  if (w.type !== 'goods') return w.amount;
  const computed = w.items.reduce((sum, item) => {
    const unitCost =
      item.cost ?? products.find((p) => p.id === item.id)?.cost ?? 0;
    return sum + item.qty * unitCost;
  }, 0);
  if (computed > 0) return Math.round(computed * 100) / 100;
  return Math.round((w.amount || 0) * 100) / 100;
};

export const getCustomerDebtTotals = (
  debt: CustomerDebt
): {
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  isPaid: boolean;
} => {
  const computedItems = debt.items.reduce(
    (sum, i) => sum + i.qty * i.unitPrice,
    0
  );
  const totalAmount =
    Math.round((computedItems > 0 ? computedItems : debt.totalAmount || 0) * 100) /
    100;
  const paidAmount =
    Math.round(
      (debt.payments ?? []).reduce((sum, p) => sum + Math.max(0, p.amount), 0) *
        100
    ) / 100;
  const remainingAmount = Math.max(
    0,
    Math.round((totalAmount - paidAmount) * 100) / 100
  );
  const isPaid = Boolean(debt.paid) || (totalAmount > 0 && remainingAmount <= 0);
  return { totalAmount, paidAmount, remainingAmount, isPaid };
};

export const isEndOfWeekDay = (ts = Date.now()): boolean => {
  const day = new Date(ts).getDay();
  // Thursday (4), Friday (5), Saturday (6)
  return day === 4 || day === 5 || day === 6;
};

export const getUnpaidGoodsWithdrawalsForUser = (
  d: PosDatabase,
  userName: string,
  storeIds?: number[],
  includeFutureDeferred = false
): Withdrawal[] => {
  const curMonth = monthKey(Date.now());
  const targetNorm = norm(userName);
  return d.withdrawals.filter((w) => {
    if (w.type !== 'goods' || w.status === 'rejected' || w.paid) return false;
    if (storeIds && !storeIds.includes(w.storeId)) return false;
    const taker = norm(w.takenBy || w.emp);
    if (taker !== targetNorm) return false;
    if (!includeFutureDeferred && w.deferredToMonth && w.deferredToMonth > curMonth) {
      return false;
    }
    return true;
  });
};

export const createSeedData = (): PosDatabase => ({
  stores: [{ id: 1, name: 'المحل الرئيسي' }],
  activeHolders: {},
  users: [
    {
      id: 1,
      name: 'محمد',
      role: 'manager',
      owner: true,
      pin: '0000',
      storeId: 1,
      storeIds: [1],
      salary: 0,
    },
  ],
  products: [],
  sales: [],
  discounts: [],
  expenses: [],
  withdrawals: [],
  salaries: [],
  returns: [],
  shifts: [],
  stockIntakes: [],
  stockEntries: [],
  rents: [],
  ownerAlerts: [],
  activityAlerts: [],
  messages: [],
  branchFeedSeenAt: {},
  customerDebts: [],
  bonuses: [],
  log: [],
  openingByStore: { 1: 0 },
  lastCloseByStore: { 1: 0 },
  sheetsLinks: {},
  nid: 1,
});

export const migrateDatabase = (raw: Partial<PosDatabase>): PosDatabase => {
  const stores =
    Array.isArray(raw.stores) && raw.stores.length > 0
      ? raw.stores
      : [{ id: 1, name: 'المحل الرئيسي' }];
  const defaultStoreId = stores[0].id;

  const legacyOpening = (raw as unknown as { opening?: number }).opening ?? 0;
  const legacyLastClose = (raw as unknown as { lastClose?: number }).lastClose ?? 0;

  return {
    stores,
    activeHolders: raw.activeHolders ?? {},
    users: (raw.users ?? []).map((u) => {
      const storeIds =
        Array.isArray(u.storeIds) && u.storeIds.length > 0
          ? Array.from(new Set(u.storeIds))
          : [u.storeId ?? defaultStoreId];
      return {
        ...u,
        storeId: storeIds[0] ?? defaultStoreId,
        storeIds,
        salary: u.salary ?? 0,
      };
    }),
    products: (raw.products ?? []).map((p) => ({
      ...p,
      storeId: p.storeId ?? defaultStoreId,
      minStock: p.minStock ?? 3,
    })),
    sales: (raw.sales ?? []).map((s) => ({
      ...s,
      storeId: s.storeId ?? defaultStoreId,
    })),
    discounts: (raw.discounts ?? []).map((dsc) => ({
      ...dsc,
      storeId: dsc.storeId ?? defaultStoreId,
    })),
    expenses: (raw.expenses ?? []).map((e) => ({
      ...e,
      storeId: e.storeId ?? defaultStoreId,
    })),
    withdrawals: (raw.withdrawals ?? []).map((w) => ({
      ...w,
      storeId: w.storeId ?? defaultStoreId,
    })),
    salaries: (raw.salaries ?? []).map((s) => ({
      ...s,
      storeId: s.storeId ?? defaultStoreId,
    })),
    returns: (raw.returns ?? []).map((r) => ({
      ...r,
      storeId: r.storeId ?? defaultStoreId,
    })),
    shifts: (raw.shifts ?? []).map((sh) => ({
      ...sh,
      storeId: sh.storeId ?? defaultStoreId,
    })),
    stockIntakes: (raw.stockIntakes ?? []).map((i) => ({
      ...i,
      payments: i.payments ?? [],
    })),
    stockEntries: (raw.stockEntries ?? []).map((se) => ({
      ...se,
      storeId: se.storeId ?? defaultStoreId,
    })),
    rents: (raw.rents ?? []).map((r) => ({
      ...r,
      storeId: r.storeId ?? defaultStoreId,
    })),
    ownerAlerts: raw.ownerAlerts ?? [],
    activityAlerts: raw.activityAlerts ?? [],
    messages: (raw.messages ?? []).map((m) => ({
      ...m,
      readByUserIds: Array.isArray(m.readByUserIds) ? m.readByUserIds : [],
    })),
    branchFeedSeenAt: raw.branchFeedSeenAt ?? {},
    customerDebts: (raw.customerDebts ?? []).map((cd) => ({
      ...cd,
      storeId: cd.storeId ?? defaultStoreId,
      payments: cd.payments ?? [],
    })),
    bonuses: raw.bonuses ?? [],
    log: raw.log ?? [],
    openingByStore: raw.openingByStore ?? { [defaultStoreId]: legacyOpening },
    lastCloseByStore: raw.lastCloseByStore ?? { [defaultStoreId]: legacyLastClose },
    sheetsLinks: raw.sheetsLinks ?? {},
    masterSheetLink: raw.masterSheetLink,
    trustedGoogleEmail: raw.trustedGoogleEmail,
    nid: raw.nid ?? 100,
  };
};

export const loadDatabase = (): PosDatabase => {
  try {
    localStorage.removeItem('pos_v3');
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PosDatabase>;
      if (parsed && Array.isArray(parsed.users)) {
        return migrateDatabase(parsed);
      }
    }
  } catch {
    // Fallback to initial seed
  }
  return createSeedData();
};

const inferActivityMeta = (
  d: PosDatabase,
  who: string,
  t: string
): {
  actorRole: UserRole | 'owner' | 'system';
  category: ActivityCategory;
  title: string;
  important: boolean;
} => {
  const matchedUser = d.users.find((u) => norm(u.name) === norm(who));
  const actorRole: UserRole | 'owner' | 'system' = matchedUser
    ? matchedUser.owner
      ? 'owner'
      : matchedUser.role
    : who === 'النظام' || who.includes('مزامنة')
      ? 'system'
      : 'employee';

  if (t.includes('تعديل كمية') || t.includes('الحد الأدنى للمخزون')) {
    return {
      actorRole,
      category: 'stock_edit',
      title: t.includes('تعديل كمية') ? 'تعديل كمية مخزون (صلاحية المالك)' : 'تنبيه مخزون منخفض',
      important: true,
    };
  }
  if (
    t.includes('تعديل سعر') ||
    t.includes('سعر البيع') ||
    t.includes('الحد الأدنى للبيع') ||
    t.includes('تعديل التكلفة')
  ) {
    return {
      actorRole,
      category: 'price_edit',
      title: 'تعديل سعر قطعة في المخزون',
      important: true,
    };
  }
  if (t.includes('رقم سري') || t.includes('صلاحيات') || t.includes('نسخة احتياطية')) {
    return {
      actorRole,
      category: 'security_pin',
      title: t.includes('رقم سري') ? 'تعديل رقم سري' : 'تحديث أمني / نسخة احتياطية',
      important: true,
    };
  }
  if (t.includes('فاتورة #') || t.includes('بيع سريع') || t.includes('خصم')) {
    return { actorRole, category: 'sale', title: 'عملية بيع', important: false };
  }
  if (t.includes('ترجيع') || t.includes('مرتجع')) {
    return { actorRole, category: 'return', title: 'ترجيع بضاعة', important: false };
  }
  if (
    t.includes('توريد') ||
    t.includes('دفعة فاتورة') ||
    t.includes('صورة لفاتورة') ||
    t.includes('إضافة منتج') ||
    t.includes('حذف منتج') ||
    t.includes('نقل منتج') ||
    t.includes('تعديل منتج') ||
    t.includes('المخزون من الجدول') ||
    t.includes('جدول المخزون')
  ) {
    return {
      actorRole,
      category: 'intake',
      title: 'حركة مخزون وفواتير',
      important: t.includes('حذف منتج'),
    };
  }
  if (t.includes('مصروف')) {
    return { actorRole, category: 'expense', title: 'مصروفات ونثريات', important: false };
  }
  if (t.includes('سحب') || t.includes('تحصيل') || t.includes('مسحوبات')) {
    return { actorRole, category: 'withdrawal', title: 'سحب أو محاسبة مسحوبات', important: false };
  }
  if (t.includes('دين') || t.includes('ديون')) {
    return { actorRole, category: 'debt', title: 'ديون الزبائن', important: false };
  }
  if (t.includes('راتب') || t.includes('مكافأة')) {
    return { actorRole, category: 'salary', title: 'رواتب ومكافآت', important: false };
  }
  if (t.includes('فرع') || t.includes('إيجار')) {
    return { actorRole, category: 'branch_rent', title: 'إدارة الفروع والإيجار', important: false };
  }
  if (
    t.includes('تسجيل دخول') ||
    t.includes('خروج مؤقت') ||
    t.includes('إنهاء دوام') ||
    t.includes('انتقال طارئ') ||
    t.includes('خروج')
  ) {
    return {
      actorRole,
      category: 'session',
      title: 'حركة دوام وصندوق',
      important: t.includes('فرق'),
    };
  }
  if (t.includes('رسالة داخلية') || t.includes('بريد داخلي')) {
    return {
      actorRole,
      category: 'message',
      title: 'رسالة بريد داخلي',
      important: false,
    };
  }
  return { actorRole, category: 'system', title: 'نشاط في النظام', important: false };
};

export interface AddLogMeta {
  actorRole?: UserRole | 'owner' | 'system';
  category?: ActivityCategory;
  title?: string;
  important?: boolean;
}

export const addLog = (
  d: PosDatabase,
  who: string,
  t: string,
  storeId?: number,
  meta?: AddLogMeta
): void => {
  const nowTs = Date.now();
  d.log.unshift({ storeId, ts: nowTs, who, t });
  d.log = d.log.slice(0, 300);

  const inferred = inferActivityMeta(d, who, t);
  if (!Array.isArray(d.activityAlerts)) d.activityAlerts = [];
  d.activityAlerts.unshift({
    id: d.nid++,
    storeId,
    actor: who,
    actorRole: meta?.actorRole ?? inferred.actorRole,
    category: meta?.category ?? inferred.category,
    title: meta?.title ?? inferred.title,
    message: t,
    important: meta?.important ?? inferred.important,
    ts: nowTs,
    read: false,
  });
  d.activityAlerts = d.activityAlerts.slice(0, 400);
};

export const getDrawerCarryoverSummary = (
  d: PosDatabase,
  storeId: number
): {
  openingCash: number;
  expectedCash: number;
  todayNetMovement: number;
  lastCloseTs: number;
  lastShift: ShiftRecord | null;
} => {
  const openingCash = Math.round((d.openingByStore[storeId] ?? 0) * 100) / 100;
  const expected = Math.round(expectedCashForStore(d, storeId) * 100) / 100;
  const lastCloseTs = d.lastCloseByStore[storeId] ?? 0;
  const storeShifts = d.shifts
    .filter((s) => s.storeId === storeId)
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const lastShift = storeShifts[0] ?? null;
  return {
    openingCash,
    expectedCash: expected,
    todayNetMovement: Math.round((expected - openingCash) * 100) / 100,
    lastCloseTs,
    lastShift,
  };
};

export const expectedCashForStore = (d: PosDatabase, storeId: number): number => {
  const c = d.lastCloseByStore[storeId] ?? 0;
  const opening = d.openingByStore[storeId] ?? 0;
  const intakePaymentsFromCash = d.stockIntakes
    .filter((i) => i.storeId === storeId && i.status !== 'rejected')
    .reduce(
      (sum, i) =>
        sum +
        (i.payments ?? [])
          .filter((p) => p.deductFromCash && p.ts > c)
          .reduce((pSum, p) => pSum + p.amount, 0),
      0
    );
  const rentsFromCash = (d.rents ?? [])
    .filter((r) => r.storeId === storeId && r.deductFromCash && r.ts > c)
    .reduce((sum, r) => sum + r.localAmount, 0);
  const goodsWithdrawalsPaidToCash = d.withdrawals
    .filter(
      (w) =>
        w.storeId === storeId &&
        w.type === 'goods' &&
        w.status !== 'rejected' &&
        w.paid &&
        w.paidToCash &&
        (w.paidAt ?? w.ts) > c
    )
    .reduce(
      (sum, w) => sum + (w.paidAmount ?? getWithdrawalWholesaleTotal(w, d.products)),
      0
    );

  const customerDebtPaymentsToCash = (d.customerDebts ?? [])
    .filter((cd) => cd.storeId === storeId)
    .reduce(
      (sum, cd) =>
        sum +
        (cd.payments ?? [])
          .filter((p) => p.addToCash && p.ts > c)
          .reduce((pSum, p) => pSum + Math.max(0, p.amount), 0),
      0
    );

  const cashCustomerDebtsFromCash = (d.customerDebts ?? [])
    .filter(
      (cd) =>
        cd.storeId === storeId &&
        cd.debtType === 'cash' &&
        cd.deductFromCash !== false &&
        cd.ts > c
    )
    .reduce((sum, cd) => sum + Math.max(0, cd.totalAmount), 0);

  return (
    opening +
    d.sales
      .filter((s) => s.storeId === storeId && s.ts > c)
      .reduce((a, s) => a + s.total, 0) +
    goodsWithdrawalsPaidToCash +
    customerDebtPaymentsToCash -
    cashCustomerDebtsFromCash -
    d.expenses
      .filter((e) => e.storeId === storeId && e.ts > c)
      .reduce((a, e) => a + e.amount, 0) -
    d.withdrawals
      .filter(
        (w) =>
          w.storeId === storeId &&
          w.type === 'cash' &&
          w.status !== 'rejected' &&
          w.ts > c
      )
      .reduce((a, w) => a + w.amount, 0) -
    d.salaries
      .filter(
        (w) =>
          w.storeId === storeId && w.status !== 'rejected' && w.ts > c
      )
      .reduce((a, w) => a + w.amount, 0) -
    d.returns
      .filter((r) => r.storeId === storeId && r.ts > c)
      .reduce((a, r) => a + r.price * r.qty, 0) -
    intakePaymentsFromCash -
    rentsFromCash
  );
};

export const canUserSeeMessage = (
  msg: InternalMessage,
  user: User,
  allowedStoreIds: number[]
): boolean => {
  if (msg.senderId === user.id) return true;
  if (user.owner) return true;
  if (msg.recipientType === 'all') return true;
  if (msg.recipientType === 'user') return msg.recipientUserId === user.id;
  if (msg.recipientType === 'all_managers') return user.role === 'manager';
  if (msg.recipientType === 'all_employees') return user.role === 'employee';
  if (msg.recipientType === 'store_staff') {
    return msg.storeId !== undefined && allowedStoreIds.includes(msg.storeId);
  }
  return false;
};

export const getUnreadMessagesCount = (
  d: PosDatabase,
  user: User,
  allowedStoreIds: number[]
): number => {
  return (d.messages ?? []).filter(
    (m) =>
      m.senderId !== user.id &&
      canUserSeeMessage(m, user, allowedStoreIds) &&
      !m.readByUserIds.includes(user.id)
  ).length;
};

export interface DailyDrawerMovement {
  id: string;
  ts: number;
  kind:
    | 'sale'
    | 'cash_withdrawal'
    | 'goods_withdrawal'
    | 'expense'
    | 'salary'
    | 'invoice_payment'
    | 'rent'
    | 'debt_cash'
    | 'debt_goods'
    | 'debt_payment'
    | 'return';
  actor: string;
  actorRoleLabel: string;
  title: string;
  details: string;
  cashDelta: number; // + added to drawer, - removed from drawer, 0 goods-only
  goodsValue?: number;
  inCurrentShift: boolean;
}

export const getBranchDailyDrawerMovements = (
  d: PosDatabase,
  storeId: number,
  refTs = Date.now()
): DailyDrawerMovement[] => {
  const lastClose = d.lastCloseByStore[storeId] ?? 0;
  const roleLabelFor = (name: string): string => {
    const matched = d.users.find((u) => norm(u.name) === norm(name));
    if (!matched) return 'نظام';
    return matched.owner ? 'مالك' : matched.role === 'manager' ? 'مدير' : 'موظف';
  };

  const events: DailyDrawerMovement[] = [];

  // 1. Sales
  for (const s of d.sales) {
    if (s.storeId !== storeId || (!sameDay(s.ts, refTs) && s.ts <= lastClose)) continue;
    if (!sameDay(s.ts, refTs)) continue;
    const itemsDesc = s.items.map((i) => `${i.name} × ${i.qty}`).join('، ');
    events.push({
      id: `sale-${s.id}`,
      ts: s.ts,
      kind: 'sale',
      actor: s.emp,
      actorRoleLabel: roleLabelFor(s.emp),
      title: `فاتورة مبيع #${s.id}`,
      details: `${itemsDesc}${s.discount ? ` (خصم ${fmt(s.discount)})` : ''}`,
      cashDelta: s.total,
      inCurrentShift: s.ts > lastClose,
    });
  }

  // 2. Withdrawals (Cash & Goods)
  for (const w of d.withdrawals) {
    if (w.storeId !== storeId || w.status === 'rejected') continue;
    const activeTs = w.paidAt ?? w.ts;
    if (!sameDay(w.ts, refTs) && !(w.paid && w.paidToCash && sameDay(activeTs, refTs))) continue;

    if (w.type === 'cash' && sameDay(w.ts, refTs)) {
      const taker = w.takenBy || w.emp;
      events.push({
        id: `wd-cash-${w.id}`,
        ts: w.ts,
        kind: 'cash_withdrawal',
        actor: w.emp,
        actorRoleLabel: roleLabelFor(w.emp),
        title: `سحب مصاري من الدرج (${taker})`,
        details: `${w.note || 'سحب نقدي'} · ${
          w.status === 'approved' ? 'معتمد' : 'بانتظار الاعتماد'
        }`,
        cashDelta: -w.amount,
        inCurrentShift: w.ts > lastClose,
      });
    } else if (w.type === 'goods') {
      const taker = w.takenBy || w.emp;
      const wCost = getWithdrawalWholesaleTotal(w, d.products);
      const itemsDesc = w.items.map((i) => `${i.name} × ${i.qty}`).join('، ');
      if (sameDay(w.ts, refTs)) {
        events.push({
          id: `wd-goods-${w.id}`,
          ts: w.ts,
          kind: 'goods_withdrawal',
          actor: w.emp,
          actorRoleLabel: roleLabelFor(w.emp),
          title: `سحب بضاعة (${taker})`,
          details: `${itemsDesc} · جملة ${fmt(wCost)} · ${
            w.paid
              ? w.paidToCash
                ? 'مدفوع للدرج'
                : 'محاسب عليه'
              : w.managerExclusive
                ? 'مسجّل بقائمة الإدارة'
                : 'غير محاسب عليه'
          }`,
          cashDelta: w.paid && w.paidToCash && w.paidAt === w.ts ? w.paidAmount ?? wCost : 0,
          goodsValue: wCost,
          inCurrentShift: w.ts > lastClose,
        });
      }
      if (w.paid && w.paidToCash && w.paidAt && w.paidAt !== w.ts && sameDay(w.paidAt, refTs)) {
        const payActor = w.paidBy || w.emp;
        events.push({
          id: `wd-pay-${w.id}`,
          ts: w.paidAt,
          kind: 'goods_withdrawal',
          actor: payActor,
          actorRoleLabel: roleLabelFor(payActor),
          title: `تحصيل مسحوبات بضاعة للدرج (${taker})`,
          details: itemsDesc,
          cashDelta: w.paidAmount ?? wCost,
          goodsValue: wCost,
          inCurrentShift: w.paidAt > lastClose,
        });
      }
    }
  }

  // 3. Expenses
  for (let i = 0; i < d.expenses.length; i++) {
    const e = d.expenses[i];
    if (e.storeId !== storeId || !sameDay(e.ts, refTs)) continue;
    events.push({
      id: `exp-${e.ts}-${i}`,
      ts: e.ts,
      kind: 'expense',
      actor: e.emp,
      actorRoleLabel: roleLabelFor(e.emp),
      title: `مصروف: ${e.desc}`,
      details: 'مخصوم من صندوق الفرع',
      cashDelta: -e.amount,
      inCurrentShift: e.ts > lastClose,
    });
  }

  // 4. Salaries
  for (const sal of d.salaries) {
    if (sal.storeId !== storeId || sal.status === 'rejected' || !sameDay(sal.ts, refTs)) continue;
    events.push({
      id: `sal-${sal.id}`,
      ts: sal.ts,
      kind: 'salary',
      actor: sal.by,
      actorRoleLabel: roleLabelFor(sal.by),
      title: `صرف راتب: ${sal.name}`,
      details: `${sal.note ? sal.note + ' · ' : ''}${sal.status === 'approved' ? 'معتمد' : 'بالانتظار'}`,
      cashDelta: -sal.amount,
      inCurrentShift: sal.ts > lastClose,
    });
  }

  // 5. Stock Intake Payments from Cash
  for (const intake of d.stockIntakes) {
    if (intake.storeId !== storeId || intake.status === 'rejected') continue;
    for (const pay of intake.payments ?? []) {
      if (!pay.deductFromCash || !sameDay(pay.ts, refTs)) continue;
      events.push({
        id: `intpay-${intake.id}-${pay.id}`,
        ts: pay.ts,
        kind: 'invoice_payment',
        actor: pay.by,
        actorRoleLabel: roleLabelFor(pay.by),
        title: `دفعة فاتورة توريد #${intake.id}`,
        details: `${intake.supplierName || 'مورد'}${pay.note ? ` · ${pay.note}` : ''}`,
        cashDelta: -pay.amount,
        inCurrentShift: pay.ts > lastClose,
      });
    }
  }

  // 6. Rents from Cash
  for (const r of d.rents ?? []) {
    if (r.storeId !== storeId || !r.deductFromCash || !sameDay(r.ts, refTs)) continue;
    events.push({
      id: `rent-${r.id}`,
      ts: r.ts,
      kind: 'rent',
      actor: r.by,
      actorRoleLabel: roleLabelFor(r.by),
      title: `إيجار المحل (${r.month})`,
      details: `${r.usdAmount}$ × ${fmt(r.exchangeRate)}${r.note ? ` · ${r.note}` : ''}`,
      cashDelta: -r.localAmount,
      inCurrentShift: r.ts > lastClose,
    });
  }

  // 7. Customer Debts (Cash & Goods) + Debt Repayments
  for (const cd of d.customerDebts ?? []) {
    if (cd.storeId !== storeId) continue;
    if (sameDay(cd.ts, refTs)) {
      const isCashDebt = cd.debtType === 'cash';
      const deductCash = isCashDebt && cd.deductFromCash !== false;
      const desc = isCashDebt
        ? `سلفة / دين نقدي للزبون ${cd.customerName}`
        : cd.items.map((i) => `${i.name} × ${i.qty}`).join('، ');
      events.push({
        id: `debt-${cd.id}`,
        ts: cd.ts,
        kind: isCashDebt ? 'debt_cash' : 'debt_goods',
        actor: cd.givenBy,
        actorRoleLabel: roleLabelFor(cd.givenBy),
        title: isCashDebt
          ? `دين مصاري لزبون: ${cd.customerName}`
          : `دين بضاعة لزبون: ${cd.customerName}`,
        details: `${desc}${cd.note ? ` · ${cd.note}` : ''}`,
        cashDelta: deductCash ? -cd.totalAmount : 0,
        goodsValue: isCashDebt ? undefined : cd.totalAmount,
        inCurrentShift: cd.ts > lastClose,
      });
    }
    for (const p of cd.payments ?? []) {
      if (!sameDay(p.ts, refTs)) continue;
      events.push({
        id: `debtpay-${cd.id}-${p.id}`,
        ts: p.ts,
        kind: 'debt_payment',
        actor: p.by,
        actorRoleLabel: roleLabelFor(p.by),
        title: `سداد دين زبون: ${cd.customerName}`,
        details: p.addToCash ? 'أُضيف لصندوق الفرع' : 'سداد خارجي (لم يُضف للدرج)',
        cashDelta: p.addToCash ? p.amount : 0,
        inCurrentShift: p.ts > lastClose,
      });
    }
  }

  // 8. Returns
  for (let i = 0; i < d.returns.length; i++) {
    const r = d.returns[i];
    if (r.storeId !== storeId || !sameDay(r.ts, refTs)) continue;
    const isGoodsOnly = r.settlementType === 'goods';
    const totalCashOut = isGoodsOnly ? 0 : r.price * r.qty;
    events.push({
      id: `ret-${r.ts}-${i}`,
      ts: r.ts,
      kind: 'return',
      actor: r.emp,
      actorRoleLabel: roleLabelFor(r.emp),
      title: `مرتجع: ${r.name} × ${r.qty}`,
      details: `${
        r.sourceType === 'staff' ? `من ${r.staffName || 'أحد العاملين'}` : 'من زبون'
      } · ${isGoodsOnly ? 'إرجاع للمخزن فقط' : `استرداد نقدي ${fmt(totalCashOut)}`}`,
      cashDelta: -totalCashOut,
      goodsValue: r.goodsValue,
      inCurrentShift: r.ts > lastClose,
    });
  }

  return events.sort((a, b) => b.ts - a.ts);
};

export const expectedCash = (d: PosDatabase, storeId?: number): number => {
  if (storeId !== undefined) {
    return expectedCashForStore(d, storeId);
  }
  return d.stores.reduce(
    (sum, store) => sum + expectedCashForStore(d, store.id),
    0
  );
};

export const getLowStockProducts = (
  d: PosDatabase,
  storeId?: number | 'all'
) =>
  d.products
    .filter(
      (p) =>
        (storeId === undefined || storeId === 'all' || p.storeId === storeId) &&
        p.stock <= (p.minStock ?? 3)
    )
    .sort((a, b) => a.stock - b.stock);

// Distribute an invoice-level discount proportionally across all sold items
// so unit prices, item revenues, profits, returns, and drawer cash stay exact.
export const buildDiscountedSaleItems = (
  cart: CartItem[],
  rawDiscount: number
): {
  items: SaleItem[];
  subtotalBeforeDiscount: number;
  discount: number;
  netTotal: number;
} => {
  const subtotalBeforeDiscount = cart.reduce(
    (acc, c) => acc + c.qty * c.price,
    0
  );
  const discount = Math.max(
    0,
    Math.min(subtotalBeforeDiscount, Number.isFinite(rawDiscount) ? rawDiscount : 0)
  );

  if (discount <= 0 || subtotalBeforeDiscount <= 0) {
    return {
      items: cart.map((c) => ({
        id: c.id,
        name: c.name,
        qty: c.qty,
        price: c.price,
        originalPrice: c.price,
        discountShare: 0,
        cost: c.cost,
        ret: 0,
      })),
      subtotalBeforeDiscount,
      discount: 0,
      netTotal: subtotalBeforeDiscount,
    };
  }

  let allocated = 0;
  const items: SaleItem[] = cart.map((c, idx) => {
    const lineOriginal = c.qty * c.price;
    const isLast = idx === cart.length - 1;
    const lineDiscount = isLast
      ? Math.max(0, Math.round((discount - allocated) * 100) / 100)
      : Math.round(((discount * lineOriginal) / subtotalBeforeDiscount) * 100) / 100;
    allocated += lineDiscount;

    const effectiveLineTotal = Math.max(0, lineOriginal - lineDiscount);
    const effectiveUnitPrice =
      c.qty > 0
        ? Math.round((effectiveLineTotal / c.qty) * 10000) / 10000
        : c.price;

    return {
      id: c.id,
      name: c.name,
      qty: c.qty,
      price: effectiveUnitPrice,
      originalPrice: c.price,
      discountShare: lineDiscount,
      cost: c.cost,
      ret: 0,
    };
  });

  const netTotal = Math.max(0, Math.round((subtotalBeforeDiscount - discount) * 100) / 100);
  return {
    items,
    subtotalBeforeDiscount,
    discount,
    netTotal,
  };
};
