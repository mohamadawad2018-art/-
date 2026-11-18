import {
  ARABIC_WEEKDAYS,
  dayKey,
  formatMonthArabic,
  fullDate,
  getCustomerDebtTotals,
  getIntakeTotals,
  getWithdrawalWholesaleTotal,
  monthKey,
  norm,
  num,
} from '../store';
import type {
  Expense,
  PosDatabase,
  Product,
  Sale,
  StoreBranch,
} from '../types';
import { clearCachedToken } from './googleAuth';

export const SHEET_TABS = {
  inventory: 'المخزون',
  incoming: 'دخول البضاعة',
  sales: 'المبيعات',
  profits: 'الأرباح',
  expenses: 'المصاريف',
  discounts: 'الخصومات',
  rent: 'إيجار المحل',
  invoicePayments: 'دفعات الفواتير',
  staffWithdrawals: 'مسحوبات البضاعة',
  managerGoodsWithdrawals: 'مسحوبات المدير والمالك',
  customerDebts: 'ديون زباين',
  returns: 'المرتجعات',
} as const;

export const MASTER_SHEET_TABS = {
  totalInventory: 'إجمالي المخزون',
  allIncoming: 'دخول البضاعة الشامل',
  incomingSummary: 'ملخص دخول البضاعة',
} as const;

const dayWeekdayArabic = (dKey: string): string => {
  const parts = dKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return '';
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  return ARABIC_WEEKDAYS[dt.getDay()] ?? '';
};

export type SheetRowKind =
  | 'header'
  | 'month'
  | 'day'
  | 'data'
  | 'subtotal'
  | 'spacer';

export interface DriveSpreadsheetFile {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface SheetInventoryRow {
  id?: number;
  name: string;
  price: number;
  min: number;
  cost: number;
  stock: number;
  minStock: number;
}

export interface InventoryDiffResult {
  added: SheetInventoryRow[];
  updated: { existing: Product; incoming: SheetInventoryRow }[];
  unchanged: number;
  totalSheetRows: number;
}

export class GoogleAuthExpiredError extends Error {
  constructor() {
    super('انتهت صلاحية جلسة Google، يرجى تسجيل الدخول مجدداً');
    this.name = 'GoogleAuthExpiredError';
  }
}

async function googleFetch<T>(
  url: string,
  accessToken: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearCachedToken();
    throw new GoogleAuthExpiredError();
  }
  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
  } & T;
  if (!res.ok) {
    throw new Error(
      data?.error?.message || `فشل الاتصال بخدمة Google (${res.status})`
    );
  }
  return data;
}

export const extractSpreadsheetId = (input: string): string => {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  return trimmed;
};

export const listAppSpreadsheets = async (
  accessToken: string
): Promise<DriveSpreadsheetFile[]> => {
  const q = encodeURIComponent(
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
  );
  const fields = encodeURIComponent('files(id,name,modifiedTime,webViewLink)');
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=modifiedTime desc&pageSize=50`;
  const data = await googleFetch<{ files?: DriveSpreadsheetFile[] }>(
    url,
    accessToken
  );
  return data.files ?? [];
};

export const createBranchSpreadsheet = async (
  accessToken: string,
  store: StoreBranch,
  isMainStore = false
): Promise<{
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
}> => {
  const title = `نظام المبيعات - ${store.name}`;
  const sheetTitles: string[] = [
    SHEET_TABS.inventory,
    SHEET_TABS.incoming,
    SHEET_TABS.sales,
    SHEET_TABS.profits,
    SHEET_TABS.expenses,
    SHEET_TABS.discounts,
    SHEET_TABS.rent,
    SHEET_TABS.invoicePayments,
    SHEET_TABS.staffWithdrawals,
    SHEET_TABS.managerGoodsWithdrawals,
    SHEET_TABS.customerDebts,
    SHEET_TABS.returns,
  ];
  if (isMainStore) {
    sheetTitles.push(
      MASTER_SHEET_TABS.totalInventory,
      MASTER_SHEET_TABS.allIncoming
    );
  }

  const body = {
    properties: {
      title,
    },
    sheets: sheetTitles.map((t) => ({
      properties: { title: t, rightToLeft: true },
    })),
  };

  const created = await googleFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties?: { title?: string };
  }>('https://sheets.googleapis.com/v4/spreadsheets', accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl: created.spreadsheetUrl,
    title: created.properties?.title || title,
  };
};

const ensureSpreadsheetTabsInternal = async (
  accessToken: string,
  spreadsheetId: string,
  requiredTabs: string[],
  fallbackTitle: string
): Promise<{
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  existingTabs: string[];
  sheetIdByTitle: Record<string, number>;
}> => {
  const meta = await googleFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties?: { title?: string };
    sheets?: { properties?: { sheetId?: number; title?: string } }[];
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)`,
    accessToken
  );

  const sheetIdByTitle: Record<string, number> = {};
  const existingTabs: string[] = [];
  for (const sh of meta.sheets ?? []) {
    const t = sh.properties?.title ?? '';
    if (t) {
      existingTabs.push(t);
      if (typeof sh.properties?.sheetId === 'number') {
        sheetIdByTitle[t] = sh.properties.sheetId;
      }
    }
  }

  const missingTabs = requiredTabs.filter((t) => !existingTabs.includes(t));

  if (missingTabs.length > 0) {
    const addRes = await googleFetch<{
      replies?: { addSheet?: { properties?: { sheetId?: number; title?: string } } }[];
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: missingTabs.map((title) => ({
            addSheet: {
              properties: { title, rightToLeft: true },
            },
          })),
        }),
      }
    );
    for (const rep of addRes.replies ?? []) {
      const props = rep.addSheet?.properties;
      if (props?.title && typeof props.sheetId === 'number') {
        sheetIdByTitle[props.title] = props.sheetId;
      }
    }
  }

  return {
    spreadsheetId: meta.spreadsheetId,
    spreadsheetUrl: meta.spreadsheetUrl,
    title: meta.properties?.title || fallbackTitle,
    existingTabs: [...existingTabs, ...missingTabs],
    sheetIdByTitle,
  };
};

export const ensureBranchSpreadsheetTabs = async (
  accessToken: string,
  spreadsheetId: string,
  includeMasterTabs = false
) => {
  const tabs: string[] = [
    SHEET_TABS.inventory,
    SHEET_TABS.incoming,
    SHEET_TABS.sales,
    SHEET_TABS.profits,
    SHEET_TABS.expenses,
    SHEET_TABS.discounts,
    SHEET_TABS.rent,
    SHEET_TABS.invoicePayments,
    SHEET_TABS.staffWithdrawals,
    SHEET_TABS.managerGoodsWithdrawals,
    SHEET_TABS.customerDebts,
    SHEET_TABS.returns,
  ];
  if (includeMasterTabs) {
    tabs.push(MASTER_SHEET_TABS.totalInventory, MASTER_SHEET_TABS.allIncoming);
  }
  return ensureSpreadsheetTabsInternal(
    accessToken,
    spreadsheetId,
    tabs,
    'جدول الفرع'
  );
};

export const createMasterSpreadsheet = async (
  accessToken: string
): Promise<{
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
}> => {
  const title = 'المخزن الرئيسي - إجمالي المخزون ودخول البضاعة';
  const created = await googleFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties?: { title?: string };
  }>('https://sheets.googleapis.com/v4/spreadsheets', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: Object.values(MASTER_SHEET_TABS).map((t) => ({
        properties: { title: t, rightToLeft: true },
      })),
    }),
  });

  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl: created.spreadsheetUrl,
    title: created.properties?.title || title,
  };
};

export const ensureMasterSpreadsheetTabs = async (
  accessToken: string,
  spreadsheetId: string
) =>
  ensureSpreadsheetTabsInternal(
    accessToken,
    spreadsheetId,
    Object.values(MASTER_SHEET_TABS),
    'إجمالي المخزون ودخول البضاعة'
  );

// Group timestamps by Month (YYYY-MM) descending, then Day (YYYY-MM-DD) descending
const groupByMonthAndDay = <T extends { ts: number }>(items: T[]) => {
  const sorted = items.slice().sort((a, b) => b.ts - a.ts);
  const months = new Map<string, Map<string, T[]>>();

  for (const item of sorted) {
    const mKey = monthKey(item.ts);
    const dKey = dayKey(item.ts);
    let daysMap = months.get(mKey);
    if (!daysMap) {
      daysMap = new Map<string, T[]>();
      months.set(mKey, daysMap);
    }
    const list = daysMap.get(dKey) ?? [];
    list.push(item);
    daysMap.set(dKey, list);
  }

  return Array.from(months.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([mKey, daysMap]) => ({
      month: mKey,
      days: Array.from(daysMap.entries()).sort((a, b) =>
        b[0].localeCompare(a[0])
      ),
    }));
};

export interface UnifiedIncomingEntry {
  refId: number;
  ts: number;
  storeId: number;
  storeName: string;
  name: string;
  qty: number;
  cost: number;
  totalCost: number;
  price: number;
  enteredBy: string;
  approvedBy: string;
  sourceLabel: string;
  note: string;
}

export const collectIncomingGoodsEntries = (
  db: PosDatabase,
  filterStoreId?: number
): UnifiedIncomingEntry[] => {
  const getStoreName = (id: number) =>
    db.stores.find((s) => s.id === id)?.name ?? 'المحل الرئيسي';
  const result: UnifiedIncomingEntry[] = [];

  for (const intake of db.stockIntakes) {
    if (intake.status !== 'approved') continue;
    if (filterStoreId !== undefined && intake.storeId !== filterStoreId) continue;
    const entryTs = intake.approvedTs ?? intake.ts;
    for (const item of intake.items) {
      result.push({
        refId: intake.id,
        ts: entryTs,
        storeId: intake.storeId,
        storeName: getStoreName(intake.storeId),
        name: item.name,
        qty: item.qty,
        cost: item.cost,
        totalCost: Math.round(item.qty * item.cost * 100) / 100,
        price: item.price,
        enteredBy: intake.enteredBy,
        approvedBy: intake.approvedBy ?? intake.enteredBy,
        sourceLabel: 'فاتورة توريد',
        note: intake.note || '',
      });
    }
  }

  for (const se of db.stockEntries ?? []) {
    if (filterStoreId !== undefined && se.storeId !== filterStoreId) continue;
    result.push({
      refId: se.id,
      ts: se.ts,
      storeId: se.storeId,
      storeName: getStoreName(se.storeId),
      name: se.name,
      qty: se.qty,
      cost: se.cost,
      totalCost: Math.round(se.qty * se.cost * 100) / 100,
      price: se.price,
      enteredBy: se.enteredBy,
      approvedBy: se.approvedBy ?? se.enteredBy,
      sourceLabel: se.source === 'sync' ? 'مزامنة إكسل' : 'إضافة مباشرة للمخزون',
      note: se.note || '',
    });
  }

  return result.sort((a, b) => b.ts - a.ts);
};

const buildIncomingSheetTable = (
  entries: UnifiedIncomingEntry[],
  includeStoreCol: boolean
) => {
  const header = includeStoreCol
    ? [
        'رقم المرجع',
        'التاريخ والوقت',
        'الفرع المستلم',
        'اسم الصنف (البند)',
        'الكمية الداخلة',
        'سعر الجملة',
        'إجمالي التكلفة',
        'سعر البيع',
        'المصدر / المدخل',
        'المعتمد',
        'ملاحظة',
      ]
    : [
        'رقم المرجع',
        'التاريخ والوقت',
        'اسم الصنف (البند)',
        'الكمية الداخلة',
        'سعر الجملة',
        'إجمالي التكلفة',
        'سعر البيع',
        'المصدر / المدخل',
        'المعتمد',
        'ملاحظة',
      ];

  const rows: (string | number)[][] = [header];
  const rowKinds: SheetRowKind[] = ['header'];
  const colCount = header.length;
  const blankRow = Array.from({ length: colCount }, () => '');

  const grouped = groupByMonthAndDay(entries);
  for (const mGroup of grouped) {
    const mList = mGroup.days.flatMap(([, list]) => list);
    const mQty = mList.reduce((acc, x) => acc + x.qty, 0);
    const mCost = Math.round(mList.reduce((acc, x) => acc + x.totalCost, 0) * 100) / 100;
    const mLabel = formatMonthArabic(mGroup.month);

    if (includeStoreCol) {
      rows.push([
        `══ شهر ${mLabel} (${mGroup.month}) ══`,
        'ملخص الشهر',
        `${new Set(mList.map((x) => x.storeName)).size} فرع`,
        `${mList.length} بند وارد`,
        mQty,
        '',
        mCost,
        '',
        '',
        '',
        '',
      ]);
    } else {
      rows.push([
        `══ شهر ${mLabel} (${mGroup.month}) ══`,
        'ملخص الشهر',
        `${mList.length} بند وارد`,
        mQty,
        '',
        mCost,
        '',
        '',
        '',
        '',
      ]);
    }
    rowKinds.push('month');

    for (const [dKey, dayList] of mGroup.days) {
      const dQty = dayList.reduce((acc, x) => acc + x.qty, 0);
      const dCost = Math.round(dayList.reduce((acc, x) => acc + x.totalCost, 0) * 100) / 100;
      const wday = dayWeekdayArabic(dKey);
      const dayTitle = wday ? `▸ يوم ${dKey} (${wday})` : `▸ يوم ${dKey}`;

      if (includeStoreCol) {
        const branchSummary = Array.from(new Set(dayList.map((x) => x.storeName))).join('، ');
        rows.push([
          dayTitle,
          'بضاعة واردة اليوم',
          branchSummary,
          `${dayList.length} بند`,
          dQty,
          '',
          dCost,
          '',
          '',
          '',
          '',
        ]);
      } else {
        rows.push([
          dayTitle,
          'بضاعة واردة اليوم',
          `${dayList.length} بند`,
          dQty,
          '',
          dCost,
          '',
          '',
          '',
          '',
        ]);
      }
      rowKinds.push('day');

      for (const item of dayList) {
        if (includeStoreCol) {
          rows.push([
            item.refId,
            fullDate(item.ts),
            item.storeName,
            item.name,
            item.qty,
            item.cost,
            item.totalCost,
            item.price,
            `${item.sourceLabel} (${item.enteredBy})`,
            item.approvedBy,
            item.note,
          ]);
        } else {
          rows.push([
            item.refId,
            fullDate(item.ts),
            item.name,
            item.qty,
            item.cost,
            item.totalCost,
            item.price,
            `${item.sourceLabel} (${item.enteredBy})`,
            item.approvedBy,
            item.note,
          ]);
        }
        rowKinds.push('data');
      }

      rows.push(blankRow);
      rowKinds.push('spacer');
    }
  }

  return { rows, rowKinds, colCount };
};

// Build Master Warehouse Total Inventory + All-Branches Incoming Goods payloads
export const buildMasterSheetPayloads = (db: PosDatabase) => {
  const stores = db.stores;
  const allEntries = collectIncomingGoodsEntries(db);

  // 1. Total Inventory Across All Branches
  const totalCols = 6 + stores.length;
  const blankTotalRow = Array.from({ length: totalCols }, () => '');
  const padTotalRow = (cells: (string | number)[]): (string | number)[] => {
    const out = cells.slice(0, totalCols);
    while (out.length < totalCols) out.push('');
    return out;
  };

  type AggItem = {
    name: string;
    totalStock: number;
    byStore: Record<number, number>;
    totalWholesaleValue: number;
    totalSellValue: number;
    weightedCostSum: number;
    weightedPriceSum: number;
    countProducts: number;
    latestPrice: number;
    latestCost: number;
  };

  const aggMap = new Map<string, AggItem>();
  for (const p of db.products) {
    const key = norm(p.name) || String(p.id);
    let entry = aggMap.get(key);
    if (!entry) {
      entry = {
        name: p.name.trim(),
        totalStock: 0,
        byStore: {},
        totalWholesaleValue: 0,
        totalSellValue: 0,
        weightedCostSum: 0,
        weightedPriceSum: 0,
        countProducts: 0,
        latestPrice: p.price,
        latestCost: p.cost,
      };
      aggMap.set(key, entry);
    }
    entry.totalStock += p.stock;
    entry.byStore[p.storeId] = (entry.byStore[p.storeId] ?? 0) + p.stock;
    entry.totalWholesaleValue += Math.max(0, p.stock) * p.cost;
    entry.totalSellValue += Math.max(0, p.stock) * p.price;
    entry.weightedCostSum += p.cost;
    entry.weightedPriceSum += p.price;
    entry.countProducts += 1;
  }

  const aggList = Array.from(aggMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'ar')
  );

  const totalInventoryRows: (string | number)[][] = [];
  const totalInventoryRowKinds: SheetRowKind[] = [];

  totalInventoryRows.push(
    padTotalRow(['══ إجمالي المخزون الكلي (المخزن الرئيسي + جميع الفروع) ══'])
  );
  totalInventoryRowKinds.push('month');

  totalInventoryRows.push([
    'اسم الصنف',
    'الإجمالي الكلي',
    ...stores.map((s) => `كمية: ${s.name}`),
    'متوسط التكلفة',
    'سعر البيع',
    'قيمة الجملة الكلية',
    'قيمة المبيع الكلية',
  ]);
  totalInventoryRowKinds.push('header');

  let grandTotalStock = 0;
  let grandTotalCostVal = 0;
  let grandTotalSellVal = 0;
  const branchTotals: Record<number, number> = {};

  for (const item of aggList) {
    grandTotalStock += item.totalStock;
    grandTotalCostVal += item.totalWholesaleValue;
    grandTotalSellVal += item.totalSellValue;
    for (const s of stores) {
      branchTotals[s.id] = (branchTotals[s.id] ?? 0) + (item.byStore[s.id] ?? 0);
    }
    const avgCost =
      item.countProducts > 0
        ? Math.round((item.weightedCostSum / item.countProducts) * 100) / 100
        : item.latestCost;
    const avgPrice =
      item.countProducts > 0
        ? Math.round((item.weightedPriceSum / item.countProducts) * 100) / 100
        : item.latestPrice;

    totalInventoryRows.push([
      item.name,
      item.totalStock,
      ...stores.map((s) => item.byStore[s.id] ?? 0),
      avgCost,
      avgPrice,
      Math.round(item.totalWholesaleValue * 100) / 100,
      Math.round(item.totalSellValue * 100) / 100,
    ]);
    totalInventoryRowKinds.push('data');
  }

  totalInventoryRows.push([
    `المجموع الكلي (${aggList.length} صنف)`,
    grandTotalStock,
    ...stores.map((s) => branchTotals[s.id] ?? 0),
    '',
    '',
    Math.round(grandTotalCostVal * 100) / 100,
    Math.round(grandTotalSellVal * 100) / 100,
  ]);
  totalInventoryRowKinds.push('subtotal');

  totalInventoryRows.push(blankTotalRow);
  totalInventoryRowKinds.push('spacer');

  // Detailed Branch-by-Branch Section
  totalInventoryRows.push(padTotalRow(['══ تفاصيل مخزون كل فرع على حدة ══']));
  totalInventoryRowKinds.push('month');
  totalInventoryRows.push(
    padTotalRow([
      'الفرع',
      'رقم الصنف',
      'اسم الصنف',
      'الكمية المتوفرة',
      'سعر الجملة',
      'سعر البيع',
      'قيمة الجملة',
      'الحالة',
    ])
  );
  totalInventoryRowKinds.push('header');

  for (const s of stores) {
    const storeProds = db.products.filter((p) => p.storeId === s.id);
    const storeQty = storeProds.reduce((a, p) => a + p.stock, 0);
    const storeVal =
      Math.round(
        storeProds.reduce((a, p) => a + Math.max(0, p.stock) * p.cost, 0) * 100
      ) / 100;
    totalInventoryRows.push(
      padTotalRow([
        `▸ ${s.name}`,
        '',
        `${storeProds.length} صنف`,
        storeQty,
        '',
        '',
        storeVal,
        '',
      ])
    );
    totalInventoryRowKinds.push('day');

    for (const p of storeProds) {
      const minStk = p.minStock ?? 3;
      const status = p.stock <= 0 ? 'نفد' : p.stock <= minStk ? 'منخفض' : 'متوفر';
      totalInventoryRows.push(
        padTotalRow([
          s.name,
          p.id,
          p.name,
          p.stock,
          p.cost,
          p.price,
          Math.round(Math.max(0, p.stock) * p.cost * 100) / 100,
          status,
        ])
      );
      totalInventoryRowKinds.push('data');
    }
    totalInventoryRows.push(blankTotalRow);
    totalInventoryRowKinds.push('spacer');
  }

  // 2. All-Branches Incoming Goods (by Month & Day)
  const allIncomingTable = buildIncomingSheetTable(allEntries, true);

  // 3. Incoming Summary by Month & Day
  const incomingSummaryRows: (string | number)[][] = [];
  const incomingSummaryRowKinds: SheetRowKind[] = [];
  const sumCols = 6;
  const blankSumRow = ['', '', '', '', '', ''];

  incomingSummaryRows.push([
    '══ ملخص دخول البضاعة الشهري واليومي (جميع الفروع) ══',
    '',
    '',
    '',
    '',
    '',
  ]);
  incomingSummaryRowKinds.push('month');
  incomingSummaryRows.push([
    'الفترة (الشهر / اليوم)',
    'الفروع المستلمة',
    'عدد البنود الداخلة',
    'إجمالي القطع الداخلة',
    'إجمالي التكلفة (الجملة)',
    'أبرز الأصناف',
  ]);
  incomingSummaryRowKinds.push('header');

  for (const mGroup of groupByMonthAndDay(allEntries)) {
    const mList = mGroup.days.flatMap(([, list]) => list);
    const mQty = mList.reduce((acc, x) => acc + x.qty, 0);
    const mCost =
      Math.round(mList.reduce((acc, x) => acc + x.totalCost, 0) * 100) / 100;
    const mBranches = Array.from(new Set(mList.map((x) => x.storeName))).join('، ');
    incomingSummaryRows.push([
      `══ شهر ${formatMonthArabic(mGroup.month)} (${mGroup.month}) ══`,
      mBranches,
      mList.length,
      mQty,
      mCost,
      `${mGroup.days.length} يوم توريد`,
    ]);
    incomingSummaryRowKinds.push('subtotal');

    for (const [dKey, dayList] of mGroup.days) {
      const dQty = dayList.reduce((acc, x) => acc + x.qty, 0);
      const dCost =
        Math.round(dayList.reduce((acc, x) => acc + x.totalCost, 0) * 100) / 100;
      const dBranches = Array.from(new Set(dayList.map((x) => x.storeName))).join('، ');
      const dItemsPreview = Array.from(
        new Set(dayList.map((x) => `${x.name} (×${x.qty})`))
      )
        .slice(0, 6)
        .join('، ');
      const wday = dayWeekdayArabic(dKey);
      incomingSummaryRows.push([
        wday ? `${dKey} (${wday})` : dKey,
        dBranches,
        dayList.length,
        dQty,
        dCost,
        dItemsPreview,
      ]);
      incomingSummaryRowKinds.push('data');
    }

    incomingSummaryRows.push(blankSumRow);
    incomingSummaryRowKinds.push('spacer');
  }

  return {
    totalInventoryRows,
    totalInventoryRowKinds,
    totalInventoryCols: totalCols,
    allIncomingRows: allIncomingTable.rows,
    allIncomingRowKinds: allIncomingTable.rowKinds,
    allIncomingCols: allIncomingTable.colCount,
    incomingSummaryRows,
    incomingSummaryRowKinds,
    incomingSummaryCols: sumCols,
    counts: {
      uniqueProducts: aggList.length,
      totalUnits: grandTotalStock,
      incomingLines: allEntries.length,
    },
  };
};

// Build sheet row matrices + visual row kinds for a specific store
export const buildBranchSheetPayloads = (db: PosDatabase, storeId: number) => {
  const products = db.products.filter((p) => p.storeId === storeId);
  const incomingEntries = collectIncomingGoodsEntries(db, storeId);
  const incomingTable = buildIncomingSheetTable(incomingEntries, false);
  const sales = db.sales
    .filter((s) => s.storeId === storeId)
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const discounts = (db.discounts ?? [])
    .filter((d) => d.storeId === storeId)
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const returns = db.returns
    .filter((r) => r.storeId === storeId)
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const branchWithdrawals = db.withdrawals
    .filter((w) => w.storeId === storeId && w.status !== 'rejected')
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const expenses = db.expenses
    .filter((e) => e.storeId === storeId)
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const salaries = db.salaries
    .filter((s) => s.storeId === storeId && s.status !== 'rejected')
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const rents = (db.rents ?? [])
    .filter((r) => r.storeId === storeId)
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const branchIntakes = db.stockIntakes
    .filter((i) => i.storeId === storeId && i.status !== 'rejected')
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const storeCustomerDebts = (db.customerDebts ?? [])
    .filter((cd) => cd.storeId === storeId)
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const branchStoreName =
    db.stores.find((s) => s.id === storeId)?.name ?? 'المحل الرئيسي';

  // 1. Inventory rows
  const inventoryRows: (string | number)[][] = [
    [
      'رقم الصنف',
      'اسم المنتج',
      'سعر المبيع',
      'الحد الأدنى للبيع',
      'سعر الجملة',
      'الكمية بالمخزن',
      'حد التنبيه',
      'حالة المخزون',
    ],
    ...products.map((p) => {
      const minStk = p.minStock ?? 3;
      const status =
        p.stock <= 0 ? 'نفد' : p.stock <= minStk ? 'منخفض' : 'متوفر';
      return [p.id, p.name, p.price, p.min, p.cost, p.stock, minStk, status];
    }),
  ];
  const inventoryRowKinds: SheetRowKind[] = [
    'header',
    ...products.map(() => 'data' as const),
  ];

  // 2. Sales rows — grouped visibly by Month AND each Day separately (1 row per sold item)
  const salesRows: (string | number)[][] = [
    [
      'رقم الفاتورة',
      'التاريخ والوقت',
      'الموظف / البائع',
      'اسم المنتج (البند)',
      'الكمية الصافية',
      'سعر الوحدة',
      'خصم البند',
      'إجمالي البند',
      'التكلفة',
      'صافي ربح البند',
    ],
  ];
  const salesRowKinds: SheetRowKind[] = ['header'];

  const salesGrouped = groupByMonthAndDay(sales);
  for (const mGroup of salesGrouped) {
    const monthSales = mGroup.days.flatMap(([, list]) => list);
    let mQty = 0;
    let mDisc = 0;
    let mRev = 0;
    let mCost = 0;
    let mProfit = 0;
    for (const s of monthSales) {
      for (const item of s.items) {
        const netQty = item.qty - item.ret;
        const lineTotal = item.price * netQty;
        const lineCost = item.cost * netQty;
        mQty += netQty;
        mDisc += item.discountShare ?? 0;
        mRev += lineTotal;
        mCost += lineCost;
        mProfit += lineTotal - lineCost;
      }
    }

    salesRows.push([
      `══ شهر ${mGroup.month} ══`,
      'ملخص الشهر',
      `${monthSales.length} فاتورة`,
      'إجمالي بنود الشهر',
      mQty,
      '',
      Math.round(mDisc * 100) / 100,
      Math.round(mRev * 100) / 100,
      Math.round(mCost * 100) / 100,
      Math.round(mProfit * 100) / 100,
    ]);
    salesRowKinds.push('month');

    for (const [dKey, daySales] of mGroup.days) {
      let dQty = 0;
      let dDisc = 0;
      let dRev = 0;
      let dCost = 0;
      let dProfit = 0;
      for (const s of daySales) {
        for (const item of s.items) {
          const netQty = item.qty - item.ret;
          const lineTotal = item.price * netQty;
          const lineCost = item.cost * netQty;
          dQty += netQty;
          dDisc += item.discountShare ?? 0;
          dRev += lineTotal;
          dCost += lineCost;
          dProfit += lineTotal - lineCost;
        }
      }

      salesRows.push([
        `▸ يوم ${dKey}`,
        'مبيعات اليوم',
        `${daySales.length} فاتورة`,
        'ملخص اليوم',
        dQty,
        '',
        Math.round(dDisc * 100) / 100,
        Math.round(dRev * 100) / 100,
        Math.round(dCost * 100) / 100,
        Math.round(dProfit * 100) / 100,
      ]);
      salesRowKinds.push('day');

      for (const s of daySales) {
        for (const item of s.items) {
          const netQty = item.qty - item.ret;
          const lineTotal = Math.round(item.price * netQty * 100) / 100;
          const lineCost = Math.round(item.cost * netQty * 100) / 100;
          const lineProfit = Math.round((lineTotal - lineCost) * 100) / 100;
          const itemLabel =
            item.ret > 0 ? `${item.name} (مرتجع ${item.ret})` : item.name;
          salesRows.push([
            s.id,
            fullDate(s.ts),
            s.emp,
            itemLabel,
            netQty,
            item.price,
            item.discountShare ?? 0,
            lineTotal,
            lineCost,
            lineProfit,
          ]);
          salesRowKinds.push('data');
        }
      }

      salesRows.push(['', '', '', '', '', '', '', '', '', '']);
      salesRowKinds.push('spacer');
    }
  }

  // 3. Profits: Monthly Totals Section (with Rent deduction) + Daily Breakdown Grouped Under Each Month
  interface PeriodAgg {
    invoices: number;
    beforeDiscount: number;
    discountsTotal: number;
    grossSalesAfterDiscount: number;
    returnsTotal: number;
    grossMargin: number;
    expensesAndSalaries: number;
  }

  const dayMap = new Map<string, PeriodAgg>();
  const ensureDay = (d: string): PeriodAgg => {
    let cur = dayMap.get(d);
    if (!cur) {
      cur = {
        invoices: 0,
        beforeDiscount: 0,
        discountsTotal: 0,
        grossSalesAfterDiscount: 0,
        returnsTotal: 0,
        grossMargin: 0,
        expensesAndSalaries: 0,
      };
      dayMap.set(d, cur);
    }
    return cur;
  };

  for (const s of sales) {
    const d = ensureDay(dayKey(s.ts));
    d.invoices += 1;
    d.beforeDiscount += s.subtotalBeforeDiscount ?? s.total + (s.discount ?? 0);
    d.discountsTotal += s.discount ?? 0;
    d.grossSalesAfterDiscount += s.total;
    d.grossMargin += s.items.reduce(
      (a, i) => a + (i.price - i.cost) * (i.qty - i.ret),
      0
    );
  }
  for (const r of returns) {
    ensureDay(dayKey(r.ts)).returnsTotal += r.price * r.qty;
  }
  for (const e of expenses) {
    ensureDay(dayKey(e.ts)).expensesAndSalaries += e.amount;
  }
  for (const sal of salaries) {
    if (sal.status === 'approved') {
      ensureDay(dayKey(sal.ts)).expensesAndSalaries += sal.amount;
    }
  }

  const monthRentMap = new Map<string, number>();
  for (const r of rents) {
    monthRentMap.set(
      r.month,
      Math.round(((monthRentMap.get(r.month) ?? 0) + r.localAmount) * 100) / 100
    );
  }

  const monthBuckets = new Map<string, [string, PeriodAgg][]>();
  for (const [dKey, agg] of dayMap.entries()) {
    const mKey = dKey.slice(0, 7);
    const list = monthBuckets.get(mKey) ?? [];
    list.push([dKey, agg]);
    monthBuckets.set(mKey, list);
  }
  for (const mKey of monthRentMap.keys()) {
    if (!monthBuckets.has(mKey)) {
      monthBuckets.set(mKey, []);
    }
  }
  const sortedMonths = Array.from(monthBuckets.entries()).sort((a, b) =>
    b[0].localeCompare(a[0])
  );

  const profitRows: (string | number)[][] = [];
  const profitRowKinds: SheetRowKind[] = [];

  // Section A: Monthly Summary Table (9 columns)
  profitRows.push([
    '══ ملخص الأرباح حسب الشهر (كل شهر على حدة مع خصم الإيجار) ══',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  profitRowKinds.push('month');
  profitRows.push([
    'الشهر',
    'عدد الفواتير',
    'إجمالي قبل الخصم',
    'الخصومات',
    'صافي المبيع',
    'هامش الربح',
    'المصاريف والرواتب',
    'إيجار المحل',
    'صافي الربح',
  ]);
  profitRowKinds.push('header');

  for (const [mKey, dayEntries] of sortedMonths) {
    const mSum = dayEntries.reduce(
      (acc, [, v]) => ({
        invoices: acc.invoices + v.invoices,
        beforeDiscount: acc.beforeDiscount + v.beforeDiscount,
        discountsTotal: acc.discountsTotal + v.discountsTotal,
        grossSalesAfterDiscount:
          acc.grossSalesAfterDiscount + v.grossSalesAfterDiscount,
        returnsTotal: acc.returnsTotal + v.returnsTotal,
        grossMargin: acc.grossMargin + v.grossMargin,
        expensesAndSalaries: acc.expensesAndSalaries + v.expensesAndSalaries,
      }),
      {
        invoices: 0,
        beforeDiscount: 0,
        discountsTotal: 0,
        grossSalesAfterDiscount: 0,
        returnsTotal: 0,
        grossMargin: 0,
        expensesAndSalaries: 0,
      }
    );
    const mRent = monthRentMap.get(mKey) ?? 0;
    const mNetSales = mSum.grossSalesAfterDiscount - mSum.returnsTotal;
    const mNetProfit = mSum.grossMargin - mSum.expensesAndSalaries - mRent;
    profitRows.push([
      mKey,
      mSum.invoices,
      Math.round(mSum.beforeDiscount * 100) / 100,
      Math.round(mSum.discountsTotal * 100) / 100,
      Math.round(mNetSales * 100) / 100,
      Math.round(mSum.grossMargin * 100) / 100,
      Math.round(mSum.expensesAndSalaries * 100) / 100,
      mRent,
      Math.round(mNetProfit * 100) / 100,
    ]);
    profitRowKinds.push('subtotal');
  }

  profitRows.push(['', '', '', '', '', '', '', '', '']);
  profitRowKinds.push('spacer');

  // Section B: Daily Summary Grouped Under Each Month
  profitRows.push([
    '══ تفاصيل الأرباح حسب اليوم (كل يوم على حدة مقسّم تحت شهره) ══',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  profitRowKinds.push('month');
  profitRows.push([
    'التاريخ',
    'عدد الفواتير',
    'إجمالي قبل الخصم',
    'الخصومات',
    'صافي المبيع',
    'هامش الربح',
    'المصاريف والرواتب',
    'الإيجار (شهري)',
    'صافي الربح اليومي',
  ]);
  profitRowKinds.push('header');

  for (const [mKey, dayEntries] of sortedMonths) {
    profitRows.push([`▸ شهر ${mKey}`, '', '', '', '', '', '', '', '']);
    profitRowKinds.push('day');

    const sortedDays = dayEntries.slice().sort((a, b) => b[0].localeCompare(a[0]));
    if (sortedDays.length === 0) {
      profitRows.push([
        `لا توجد مبيعات يومية مسجلة في ${mKey}`,
        0,
        0,
        0,
        0,
        0,
        0,
        monthRentMap.get(mKey) ?? 0,
        -(monthRentMap.get(mKey) ?? 0),
      ]);
      profitRowKinds.push('data');
    } else {
      for (const [dKey, v] of sortedDays) {
        const netSales = v.grossSalesAfterDiscount - v.returnsTotal;
        const netProfit = v.grossMargin - v.expensesAndSalaries;
        profitRows.push([
          dKey,
          v.invoices,
          Math.round(v.beforeDiscount * 100) / 100,
          Math.round(v.discountsTotal * 100) / 100,
          Math.round(netSales * 100) / 100,
          Math.round(v.grossMargin * 100) / 100,
          Math.round(v.expensesAndSalaries * 100) / 100,
          '—',
          Math.round(netProfit * 100) / 100,
        ]);
        profitRowKinds.push('data');
      }
    }

    profitRows.push(['', '', '', '', '', '', '', '', '']);
    profitRowKinds.push('spacer');
  }

  // 4. Expenses & Salaries rows — grouped by Month & Day
  const expenseEntries = [
    ...expenses.map((e) => ({
      ts: e.ts,
      kind: 'مصروف',
      desc: e.desc,
      amount: e.amount,
      by: e.emp,
      status: 'معتمد',
    })),
    ...salaries.map((sal) => {
      const ded = sal.withdrawalDeduction ?? 0;
      const gross = sal.grossAmount ?? sal.amount + ded;
      return {
        ts: sal.ts,
        kind: 'راتب',
        desc:
          ded > 0
            ? `راتب: ${sal.name} (الأساسي ${gross} - خصم مسحوبات ${ded})`
            : `راتب: ${sal.name}`,
        amount: sal.amount,
        by: sal.by,
        status: sal.status === 'approved' ? 'معتمد' : 'بالانتظار',
      };
    }),
  ];

  const expensesRows: (string | number)[][] = [
    ['التاريخ والوقت', 'النوع', 'البيان', 'المبلغ', 'المسجّل', 'الحالة'],
  ];
  const expensesRowKinds: SheetRowKind[] = ['header'];

  for (const mGroup of groupByMonthAndDay(expenseEntries)) {
    const mExpTotal = mGroup.days
      .flatMap(([, list]) => list)
      .reduce((acc, x) => acc + x.amount, 0);
    expensesRows.push([
      `══ شهر ${mGroup.month} ══`,
      'ملخص الشهر',
      'إجمالي المصاريف والرواتب',
      Math.round(mExpTotal * 100) / 100,
      '',
      '',
    ]);
    expensesRowKinds.push('month');

    for (const [dKey, dayList] of mGroup.days) {
      const dExpTotal = dayList.reduce((acc, x) => acc + x.amount, 0);
      expensesRows.push([
        `▸ يوم ${dKey}`,
        'ملخص اليوم',
        'مصاريف ورواتب اليوم',
        Math.round(dExpTotal * 100) / 100,
        '',
        '',
      ]);
      expensesRowKinds.push('day');

      for (const e of dayList) {
        expensesRows.push([
          fullDate(e.ts),
          e.kind,
          e.desc,
          e.amount,
          e.by,
          e.status,
        ]);
        expensesRowKinds.push('data');
      }
      expensesRows.push(['', '', '', '', '', '']);
      expensesRowKinds.push('spacer');
    }
  }

  // 5. Discounts rows — grouped by Month & Day
  const discountsRows: (string | number)[][] = [
    [
      'رقم الفاتورة',
      'التاريخ والوقت',
      'البائع',
      'الصفة',
      'قبل الخصم',
      'قيمة الخصم',
      'بعد الخصم',
      'عدد القطع',
      'ملاحظة',
    ],
  ];
  const discountsRowKinds: SheetRowKind[] = ['header'];

  for (const mGroup of groupByMonthAndDay(discounts)) {
    const mDiscList = mGroup.days.flatMap(([, list]) => list);
    const mDiscSum = mDiscList.reduce((acc, x) => acc + x.amount, 0);
    discountsRows.push([
      `══ شهر ${mGroup.month} ══`,
      'ملخص الشهر',
      `${mDiscList.length} فاتورة`,
      '',
      '',
      Math.round(mDiscSum * 100) / 100,
      '',
      '',
      '',
    ]);
    discountsRowKinds.push('month');

    for (const [dKey, dayList] of mGroup.days) {
      const dDiscSum = dayList.reduce((acc, x) => acc + x.amount, 0);
      discountsRows.push([
        `▸ يوم ${dKey}`,
        'خصومات اليوم',
        `${dayList.length} فاتورة`,
        '',
        '',
        Math.round(dDiscSum * 100) / 100,
        '',
        '',
        '',
      ]);
      discountsRowKinds.push('day');

      for (const dsc of dayList) {
        discountsRows.push([
          dsc.saleId,
          fullDate(dsc.ts),
          dsc.emp,
          dsc.role === 'manager' ? 'إدارة' : 'موظف',
          dsc.subtotalBefore,
          dsc.amount,
          dsc.netTotal,
          dsc.itemCount,
          dsc.note || '',
        ]);
        discountsRowKinds.push('data');
      }
      discountsRows.push(['', '', '', '', '', '', '', '', '']);
      discountsRowKinds.push('spacer');
    }
  }

  // 6. Store Rent rows — grouped by Month
  const rentRows: (string | number)[][] = [
    [
      'الشهر',
      'المبلغ بالدولار ($)',
      'سعر الصرف',
      'المبلغ المدفوع',
      'من الصندوق',
      'ملاحظة',
      'المسجّل',
      'التاريخ والوقت',
    ],
  ];
  const rentRowKinds: SheetRowKind[] = ['header'];

  const rentMonths = Array.from(new Set(rents.map((r) => r.month))).sort((a, b) =>
    b.localeCompare(a)
  );
  for (const mKey of rentMonths) {
    const mRents = rents.filter((r) => r.month === mKey);
    const mUsd = Math.round(mRents.reduce((a, r) => a + r.usdAmount, 0) * 100) / 100;
    const mLocal = Math.round(mRents.reduce((a, r) => a + r.localAmount, 0) * 100) / 100;
    rentRows.push([
      `══ شهر ${formatMonthArabic(mKey)} (${mKey}) ══`,
      mUsd,
      '',
      mLocal,
      '',
      `${mRents.length} سجل إيجار`,
      '',
      '',
    ]);
    rentRowKinds.push('month');
    for (const r of mRents) {
      rentRows.push([
        r.month,
        r.usdAmount,
        r.exchangeRate,
        r.localAmount,
        r.deductFromCash ? 'نعم' : 'لا',
        r.note || '',
        r.by,
        fullDate(r.ts),
      ]);
      rentRowKinds.push('data');
    }
    rentRows.push(['', '', '', '', '', '', '', '']);
    rentRowKinds.push('spacer');
  }

  // 7. Invoice Payments & Installments rows — organized vertically (each invoice block with payments stacked underneath)
  const invoicePaymentsCols = 9;
  const invoicePaymentsRows: (string | number)[][] = [
    [
      'رقم الفاتورة',
      'البند / الدفعة',
      'التاريخ والوقت',
      'المورد / المسدِّد',
      'إجمالي الفاتورة',
      'المبلغ المدفوع',
      'المتبقي علينا',
      'الحالة / طريقة الدفع',
      'ملاحظات',
    ],
  ];
  const invoicePaymentsRowKinds: SheetRowKind[] = ['header'];

  const intakeMonths = Array.from(
    new Set(branchIntakes.map((i) => monthKey(i.ts)))
  ).sort((a, b) => b.localeCompare(a));

  for (const mKey of intakeMonths) {
    const mIntakes = branchIntakes.filter((i) => monthKey(i.ts) === mKey);
    let mTotal = 0;
    let mPaid = 0;
    let mRem = 0;
    for (const intake of mIntakes) {
      const t = getIntakeTotals(intake);
      mTotal += t.totalCost;
      mPaid += t.paidAmount;
      mRem += t.remainingAmount;
    }
    invoicePaymentsRows.push([
      `══ شهر ${formatMonthArabic(mKey)} (${mKey}) ══`,
      'ملخص الشهر',
      '',
      `${mIntakes.length} فاتورة`,
      Math.round(mTotal * 100) / 100,
      Math.round(mPaid * 100) / 100,
      Math.round(mRem * 100) / 100,
      '',
      '',
    ]);
    invoicePaymentsRowKinds.push('month');

    for (const intake of mIntakes) {
      const t = getIntakeTotals(intake);
      const statusText =
        (t.paymentStatus === 'paid'
          ? 'مسددة بالكامل'
          : t.paymentStatus === 'partial'
            ? 'مدفوعة جزئياً'
            : 'غير مدفوعة') +
        (intake.status === 'pending' ? ' (بانتظار الاعتماد)' : '');

      // Invoice summary header row
      invoicePaymentsRows.push([
        `فاتورة #${intake.id}`,
        'ملخص الفاتورة',
        fullDate(intake.ts),
        intake.supplierName || 'مورد غير محدد',
        t.totalCost,
        t.paidAmount,
        t.remainingAmount,
        statusText,
        intake.note || '',
      ]);
      invoicePaymentsRowKinds.push('day');

      const sortedPayments = (intake.payments ?? [])
        .slice()
        .sort((a, b) => a.ts - b.ts);

      if (sortedPayments.length === 0) {
        invoicePaymentsRows.push([
          intake.id,
          '  ↳ لا توجد دفعات مسجلة بعد',
          '—',
          '—',
          '',
          0,
          t.remainingAmount,
          'على الحساب',
          '',
        ]);
        invoicePaymentsRowKinds.push('data');
      } else {
        let runningRem = t.totalCost;
        sortedPayments.forEach((p, idx) => {
          runningRem = Math.max(
            0,
            Math.round((runningRem - p.amount) * 100) / 100
          );
          invoicePaymentsRows.push([
            intake.id,
            `  ↳ دفعة #${idx + 1}`,
            fullDate(p.ts),
            p.by,
            '',
            p.amount,
            runningRem,
            p.deductFromCash ? 'من الصندوق' : 'دفع خارجي',
            p.note || '',
          ]);
          invoicePaymentsRowKinds.push('data');
        });
      }

      // Blank spacer row separating each invoice and its payments from the next invoice
      invoicePaymentsRows.push(['', '', '', '', '', '', '', '', '']);
      invoicePaymentsRowKinds.push('spacer');
    }
  }

  // 8. Staff & Management Goods Withdrawals — vertically stacked item-by-item, grouped by Month & Day
  const staffWithdrawalsCols = 10;
  const staffWithdrawalsRows: (string | number)[][] = [
    [
      'رقم السحب',
      'التاريخ والوقت',
      'المستفيد (الموظف / الإدارة)',
      'الصفة',
      'الصنف / النوع',
      'الكمية',
      'سعر الجملة للوحدة',
      'الإجمالي بسعر الجملة',
      'حالة المحاسبة (نعم / لا)',
      'ملاحظات / مسجّل العملية',
    ],
  ];
  const staffWithdrawalsRowKinds: SheetRowKind[] = ['header'];

  const describeWithdrawalPaidStatus = (
    w: (typeof branchWithdrawals)[number]
  ): string => {
    if (w.type === 'cash') {
      return w.status === 'approved' ? 'معتمد (سحب نقدي)' : 'بالانتظار (سحب نقدي)';
    }
    if (w.paid) {
      if (w.settlementMethod === 'salary_deduction') {
        return 'نعم — مخصوم من الراتب';
      }
      if (w.settlementMethod === 'return_offset') {
        return 'نعم — مسوّى بترجيع بضاعة';
      }
      return w.paidToCash ? 'نعم — حاسب عليها (أضيف للصندوق)' : 'نعم — حاسب عليها';
    }
    if (w.deferredToMonth) {
      return `لا — مؤجل لشهر ${w.deferredToMonth}`;
    }
    return 'لا — لم يحاسب عليها';
  };

  for (const mGroup of groupByMonthAndDay(branchWithdrawals)) {
    const mList = mGroup.days.flatMap(([, list]) => list);
    const mGoods = mList.filter((w) => w.type === 'goods');
    const mWholesale =
      Math.round(
        mGoods.reduce(
          (acc, w) => acc + getWithdrawalWholesaleTotal(w, db.products),
          0
        ) * 100
      ) / 100;
    const mUnpaid =
      Math.round(
        mGoods
          .filter((w) => !w.paid)
          .reduce(
            (acc, w) => acc + getWithdrawalWholesaleTotal(w, db.products),
            0
          ) * 100
      ) / 100;

    staffWithdrawalsRows.push([
      `══ شهر ${formatMonthArabic(mGroup.month)} (${mGroup.month}) ══`,
      'ملخص الشهر',
      `${mList.length} عملية سحب`,
      '',
      `${mGoods.length} مسحوبات بضاعة`,
      '',
      '',
      mWholesale,
      `متبقي غير محاسب: ${mUnpaid}`,
      '',
    ]);
    staffWithdrawalsRowKinds.push('month');

    for (const [dKey, dayList] of mGroup.days) {
      const dGoods = dayList.filter((w) => w.type === 'goods');
      const dWholesale =
        Math.round(
          dGoods.reduce(
            (acc, w) => acc + getWithdrawalWholesaleTotal(w, db.products),
            0
          ) * 100
        ) / 100;
      const wday = dayWeekdayArabic(dKey);
      staffWithdrawalsRows.push([
        wday ? `▸ يوم ${dKey} (${wday})` : `▸ يوم ${dKey}`,
        'ملخص اليوم',
        `${dayList.length} عملية`,
        '',
        '',
        '',
        '',
        dWholesale,
        '',
        '',
      ]);
      staffWithdrawalsRowKinds.push('day');

      for (const w of dayList) {
        const taker = w.takenBy || w.emp;
        const roleText = w.whoType === 'employee' ? 'موظف' : 'مدير / مالك';
        const statusText = describeWithdrawalPaidStatus(w);
        const noteText = [
          w.emp ? `سجّله: ${w.emp}` : '',
          w.status === 'pending' ? 'بانتظار الاعتماد' : '',
          w.note || '',
        ]
          .filter(Boolean)
          .join(' · ');

        if (w.type === 'cash' || w.items.length === 0) {
          staffWithdrawalsRows.push([
            w.id,
            fullDate(w.ts),
            taker,
            roleText,
            'سحب نقدي',
            1,
            w.amount,
            w.amount,
            statusText,
            noteText,
          ]);
          staffWithdrawalsRowKinds.push('data');
        } else {
          for (const item of w.items) {
            const matchedProd = db.products.find((p) => p.id === item.id);
            const unitCost = item.cost ?? matchedProd?.cost ?? 0;
            const lineCost = Math.round(unitCost * item.qty * 100) / 100;
            staffWithdrawalsRows.push([
              w.id,
              fullDate(w.ts),
              taker,
              roleText,
              item.name,
              item.qty,
              unitCost,
              lineCost,
              statusText,
              noteText,
            ]);
            staffWithdrawalsRowKinds.push('data');
          }
        }
      }

      staffWithdrawalsRows.push(['', '', '', '', '', '', '', '', '', '']);
      staffWithdrawalsRowKinds.push('spacer');
    }
  }

  // 8B. Exclusive Manager & Owner Goods Withdrawals rows — grouped by Month & Day, items stacked vertically
  const managerGoodsWithdrawals = branchWithdrawals.filter(
    (w) => w.type === 'goods' && w.whoType === 'manager'
  );
  const managerGoodsCols = 10;
  const managerGoodsRows: (string | number)[][] = [
    [
      'رقم السحب',
      'التاريخ والوقت',
      'المالك / المدير',
      'الصفة',
      'اسم الصنف',
      'الكمية',
      'سعر الجملة للوحدة',
      'الإجمالي بسعر الجملة',
      'حالة المحاسبة (نعم / لا)',
      'ملاحظات / مسجّل العملية',
    ],
  ];
  const managerGoodsRowKinds: SheetRowKind[] = ['header'];

  for (const mGroup of groupByMonthAndDay(managerGoodsWithdrawals)) {
    const mList = mGroup.days.flatMap(([, list]) => list);
    const mTotalQty = mList.reduce(
      (sum, w) => sum + w.items.reduce((qAcc, i) => qAcc + i.qty, 0),
      0
    );
    const mWholesale =
      Math.round(
        mList.reduce(
          (acc, w) => acc + getWithdrawalWholesaleTotal(w, db.products),
          0
        ) * 100
      ) / 100;
    const mUnpaid =
      Math.round(
        mList
          .filter((w) => !w.paid)
          .reduce(
            (acc, w) => acc + getWithdrawalWholesaleTotal(w, db.products),
            0
          ) * 100
      ) / 100;

    managerGoodsRows.push([
      `══ شهر ${formatMonthArabic(mGroup.month)} (${mGroup.month}) ══`,
      'ملخص الشهر',
      `${mList.length} سحب مدير/مالك`,
      '',
      `${mTotalQty} قطعة`,
      mTotalQty,
      '',
      mWholesale,
      `متبقي غير محاسب: ${mUnpaid}`,
      '',
    ]);
    managerGoodsRowKinds.push('month');

    for (const [dKey, dayList] of mGroup.days) {
      const dTotalQty = dayList.reduce(
        (sum, w) => sum + w.items.reduce((qAcc, i) => qAcc + i.qty, 0),
        0
      );
      const dWholesale =
        Math.round(
          dayList.reduce(
            (acc, w) => acc + getWithdrawalWholesaleTotal(w, db.products),
            0
          ) * 100
        ) / 100;
      const wday = dayWeekdayArabic(dKey);
      managerGoodsRows.push([
        wday ? `▸ يوم ${dKey} (${wday})` : `▸ يوم ${dKey}`,
        'ملخص اليوم',
        `${dayList.length} سحب`,
        '',
        '',
        dTotalQty,
        '',
        dWholesale,
        '',
        '',
      ]);
      managerGoodsRowKinds.push('day');

      for (const w of dayList) {
        const taker = w.takenBy || w.emp;
        const matchedUser =
          (w.takenByUserId
            ? db.users.find((u) => u.id === w.takenByUserId)
            : undefined) ??
          db.users.find((u) => norm(u.name) === norm(taker));
        const roleText = matchedUser?.owner ? 'مالك' : 'مدير';
        const statusText = describeWithdrawalPaidStatus(w);
        const noteText = [
          w.managerExclusive ? 'سحب مسجّل خاص (مدير/مالك)' : '',
          w.emp ? `سجّله: ${w.emp}` : '',
          w.status === 'pending' ? 'بانتظار الاعتماد' : '',
          w.note || '',
        ]
          .filter(Boolean)
          .join(' · ');

        if (w.items.length === 0) {
          const totalCost = getWithdrawalWholesaleTotal(w, db.products);
          managerGoodsRows.push([
            w.id,
            fullDate(w.ts),
            taker,
            roleText,
            'بضاعة مسحوبة',
            1,
            totalCost,
            totalCost,
            statusText,
            noteText,
          ]);
          managerGoodsRowKinds.push('data');
        } else {
          for (const item of w.items) {
            const matchedProd = db.products.find((p) => p.id === item.id);
            const unitCost = item.cost ?? matchedProd?.cost ?? 0;
            const lineCost = Math.round(unitCost * item.qty * 100) / 100;
            managerGoodsRows.push([
              w.id,
              fullDate(w.ts),
              taker,
              roleText,
              item.name,
              item.qty,
              unitCost,
              lineCost,
              statusText,
              noteText,
            ]);
            managerGoodsRowKinds.push('data');
          }
        }
      }

      managerGoodsRows.push(['', '', '', '', '', '', '', '', '', '']);
      managerGoodsRowKinds.push('spacer');
    }
  }

  // 9. Returns rows — grouped by Month & Day (distinguishing Customer vs Staff and Cash vs Goods return)
  const returnsCols = 9;
  const returnsRows: (string | number)[][] = [
    [
      'رقم الفاتورة / المرجع',
      'التاريخ والوقت',
      'اسم الصنف',
      'الكمية المرتجعة',
      'مصدر الترجيع',
      'نوع التسوية / الخصم',
      'مبلغ خصم المصاري',
      'قيمة البضاعة (جملة)',
      'المسجّل والملاحظات',
    ],
  ];
  const returnsRowKinds: SheetRowKind[] = ['header'];

  for (const mGroup of groupByMonthAndDay(returns)) {
    const mList = mGroup.days.flatMap(([, list]) => list);
    const mQty = mList.reduce((acc, r) => acc + r.qty, 0);
    const mCash =
      Math.round(
        mList
          .filter((r) => r.settlementType !== 'goods')
          .reduce((acc, r) => acc + r.price * r.qty, 0) * 100
      ) / 100;
    const mGoods =
      Math.round(
        mList.reduce((acc, r) => {
          const prod = db.products.find(
            (p) => p.storeId === storeId && norm(p.name) === norm(r.name)
          );
          const gv = r.goodsValue ?? (prod?.cost ?? 0) * r.qty;
          return acc + gv;
        }, 0) * 100
      ) / 100;

    returnsRows.push([
      `══ شهر ${formatMonthArabic(mGroup.month)} (${mGroup.month}) ══`,
      'ملخص الشهر',
      `${mList.length} عملية ترجيع`,
      mQty,
      '',
      '',
      mCash,
      mGoods,
      '',
    ]);
    returnsRowKinds.push('month');

    for (const [dKey, dayList] of mGroup.days) {
      const dQty = dayList.reduce((acc, r) => acc + r.qty, 0);
      const dCash =
        Math.round(
          dayList
            .filter((r) => r.settlementType !== 'goods')
            .reduce((acc, r) => acc + r.price * r.qty, 0) * 100
        ) / 100;
      const wday = dayWeekdayArabic(dKey);
      returnsRows.push([
        wday ? `▸ يوم ${dKey} (${wday})` : `▸ يوم ${dKey}`,
        'ملخص اليوم',
        `${dayList.length} مرتجع`,
        dQty,
        '',
        '',
        dCash,
        '',
        '',
      ]);
      returnsRowKinds.push('day');

      for (const r of dayList) {
        const sourceText =
          r.sourceType === 'staff'
            ? `أحد العاملين بالشركة: ${r.staffName || 'غير محدد'}`
            : 'زبون';
        const settlementText =
          r.settlementType === 'goods' ? 'ترجيع بضاعة' : 'خصم مصاري';
        const cashVal =
          r.settlementType === 'goods'
            ? 0
            : Math.round(r.price * r.qty * 100) / 100;
        const matchedProd = db.products.find(
          (p) => p.storeId === storeId && norm(p.name) === norm(r.name)
        );
        const goodsVal =
          r.goodsValue ??
          Math.round((matchedProd?.cost ?? 0) * r.qty * 100) / 100;
        const notes = [r.emp, r.note].filter(Boolean).join(' · ');

        returnsRows.push([
          r.sale > 0 ? `#${r.sale}` : 'مرتجع مباشر',
          fullDate(r.ts),
          r.name,
          r.qty,
          sourceText,
          settlementText,
          cashVal,
          goodsVal,
          notes,
        ]);
        returnsRowKinds.push('data');
      }

      returnsRows.push(['', '', '', '', '', '', '', '', '']);
      returnsRowKinds.push('spacer');
    }
  }

  // 10. Customer Debts (ديون زباين) — grouped by Month & Day, items stacked vertically (تحت بعض مو حد بعض)
  const customerDebtsCols = 12;
  const customerDebtsRows: (string | number)[][] = [
    [
      'رقم الدين',
      'التاريخ والوقت',
      'الفرع',
      'اسم الزبون',
      'رقم الهاتف (اختياري)',
      'مين عطاه الغرض',
      'اسم الصنف (البند)',
      'الكمية',
      'سعر القطعة',
      'قيمة الغرض',
      'حالة السداد والمبلغ',
      'ملاحظات',
    ],
  ];
  const customerDebtsRowKinds: SheetRowKind[] = ['header'];

  for (const mGroup of groupByMonthAndDay(storeCustomerDebts)) {
    const mList = mGroup.days.flatMap(([, list]) => list);
    let mTotalQty = 0;
    let mTotalVal = 0;
    let mRemaining = 0;
    for (const d of mList) {
      const totals = getCustomerDebtTotals(d);
      mTotalVal += totals.totalAmount;
      mRemaining += totals.remainingAmount;
      mTotalQty += d.items.reduce((acc, i) => acc + i.qty, 0);
    }

    customerDebtsRows.push([
      `══ شهر ${formatMonthArabic(mGroup.month)} (${mGroup.month}) ══`,
      'ملخص الشهر',
      branchStoreName,
      `${mList.length} سجل دين`,
      '',
      '',
      `${mTotalQty} قطعة`,
      mTotalQty,
      '',
      Math.round(mTotalVal * 100) / 100,
      `متبقي غير مسدد: ${Math.round(mRemaining * 100) / 100}`,
      '',
    ]);
    customerDebtsRowKinds.push('month');

    for (const [dKey, dayList] of mGroup.days) {
      let dTotalQty = 0;
      let dTotalVal = 0;
      let dRemaining = 0;
      for (const d of dayList) {
        const totals = getCustomerDebtTotals(d);
        dTotalVal += totals.totalAmount;
        dRemaining += totals.remainingAmount;
        dTotalQty += d.items.reduce((acc, i) => acc + i.qty, 0);
      }
      const wday = dayWeekdayArabic(dKey);
      customerDebtsRows.push([
        wday ? `▸ يوم ${dKey} (${wday})` : `▸ يوم ${dKey}`,
        'ملخص اليوم',
        branchStoreName,
        `${dayList.length} سجل دين`,
        '',
        '',
        '',
        dTotalQty,
        '',
        Math.round(dTotalVal * 100) / 100,
        `متبقي اليوم: ${Math.round(dRemaining * 100) / 100}`,
        '',
      ]);
      customerDebtsRowKinds.push('day');

      for (const cd of dayList) {
        const totals = getCustomerDebtTotals(cd);
        const statusText = totals.isPaid
          ? `مسدد بالكامل (إجمالي ${totals.totalAmount})`
          : totals.paidAmount > 0
            ? `مدفوع جزئياً (${totals.paidAmount} من ${totals.totalAmount} · متبقي ${totals.remainingAmount})`
            : `غير مسدد (إجمالي ${totals.totalAmount} · متبقي ${totals.remainingAmount})`;
        const paymentLogNote = (cd.payments ?? [])
          .map(
            (p) =>
              `دفعة ${p.amount} (${fullDate(p.ts)} · ${p.by})`
          )
          .join(' | ');
        const combinedNote = [cd.note || '', paymentLogNote]
          .filter(Boolean)
          .join(' · ');

        if (cd.items.length === 0) {
          customerDebtsRows.push([
            cd.id,
            fullDate(cd.ts),
            branchStoreName,
            cd.customerName,
            cd.customerPhone || '—',
            cd.givenBy,
            cd.debtType === 'cash'
              ? cd.deductFromCash !== false
                ? 'دين نقدي (سُحب من الصندوق)'
                : 'دين نقدي (مصاري)'
              : 'أغراض',
            1,
            totals.totalAmount,
            totals.totalAmount,
            statusText,
            combinedNote,
          ]);
          customerDebtsRowKinds.push('data');
        } else {
          for (const item of cd.items) {
            const lineVal = Math.round(item.qty * item.unitPrice * 100) / 100;
            customerDebtsRows.push([
              cd.id,
              fullDate(cd.ts),
              branchStoreName,
              cd.customerName,
              cd.customerPhone || '—',
              cd.givenBy,
              item.name,
              item.qty,
              item.unitPrice,
              lineVal,
              statusText,
              combinedNote,
            ]);
            customerDebtsRowKinds.push('data');
          }
        }
      }

      customerDebtsRows.push([
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
      customerDebtsRowKinds.push('spacer');
    }
  }

  return {
    inventoryRows,
    inventoryRowKinds,
    incomingRows: incomingTable.rows,
    incomingRowKinds: incomingTable.rowKinds,
    incomingCols: incomingTable.colCount,
    salesRows,
    salesRowKinds,
    profitRows,
    profitRowKinds,
    expensesRows,
    expensesRowKinds,
    discountsRows,
    discountsRowKinds,
    rentRows,
    rentRowKinds,
    invoicePaymentsRows,
    invoicePaymentsRowKinds,
    invoicePaymentsCols,
    staffWithdrawalsRows,
    staffWithdrawalsRowKinds,
    staffWithdrawalsCols,
    managerGoodsRows,
    managerGoodsRowKinds,
    managerGoodsCols,
    customerDebtsRows,
    customerDebtsRowKinds,
    customerDebtsCols,
    returnsRows,
    returnsRowKinds,
    returnsCols,
    counts: {
      products: products.length,
      incoming: incomingEntries.length,
      sales: sales.length,
      profitDays: dayMap.size,
      expenses: expenseEntries.length,
      discounts: discounts.length,
      rents: rents.length,
      invoicePayments: branchIntakes.length,
      staffWithdrawals: branchWithdrawals.length,
      managerGoods: managerGoodsWithdrawals.length,
      customerDebts: storeCustomerDebts.length,
      returns: returns.length,
    },
  };
};

async function clearAndWriteSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  values: (string | number)[][]
) {
  const clearRange = encodeURIComponent(`'${sheetTitle}'!A1:Z5000`);
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${clearRange}:clear`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );

  const writeRange = encodeURIComponent(`'${sheetTitle}'!A1`);
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${writeRange}?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({
        range: `'${sheetTitle}'!A1`,
        majorDimension: 'ROWS',
        values,
      }),
    }
  );
}

const buildRowStyleRequests = (
  sheetId: number | undefined,
  colCount: number,
  rowKinds: SheetRowKind[]
) => {
  if (sheetId === undefined) return [];
  const requests: Record<string, unknown>[] = [];

  // Reset base formatting across written range
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: Math.max(rowKinds.length, 1),
        startColumnIndex: 0,
        endColumnIndex: colCount,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 1, green: 1, blue: 1 },
          textFormat: {
            bold: false,
            foregroundColor: { red: 0.1, green: 0.12, blue: 0.16 },
          },
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    },
  });

  rowKinds.forEach((kind, rowIdx) => {
    if (kind === 'data' || kind === 'spacer') return;
    let bg = { red: 0.95, green: 0.96, blue: 0.98 };
    let fg = { red: 0.08, green: 0.12, blue: 0.2 };
    const bold = true;

    if (kind === 'header') {
      bg = { red: 0.12, green: 0.16, blue: 0.24 };
      fg = { red: 1, green: 1, blue: 1 };
    } else if (kind === 'month') {
      bg = { red: 0.22, green: 0.38, blue: 0.56 };
      fg = { red: 1, green: 1, blue: 1 };
    } else if (kind === 'day') {
      bg = { red: 0.86, green: 0.92, blue: 0.98 };
      fg = { red: 0.11, green: 0.23, blue: 0.38 };
    } else if (kind === 'subtotal') {
      bg = { red: 0.9, green: 0.96, blue: 0.92 };
      fg = { red: 0.06, green: 0.35, blue: 0.2 };
    }

    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: rowIdx,
          endRowIndex: rowIdx + 1,
          startColumnIndex: 0,
          endColumnIndex: colCount,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: bg,
            textFormat: {
              bold,
              foregroundColor: fg,
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    });
  });

  return requests;
};

export const pushBranchToGoogleSheet = async (
  accessToken: string,
  spreadsheetId: string,
  db: PosDatabase,
  storeId: number
) => {
  const isMainStore = db.stores[0]?.id === storeId;
  const { sheetIdByTitle } = await ensureBranchSpreadsheetTabs(
    accessToken,
    spreadsheetId,
    isMainStore
  );
  const payloads = buildBranchSheetPayloads(db, storeId);

  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    SHEET_TABS.inventory,
    payloads.inventoryRows
  );
  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    SHEET_TABS.incoming,
    payloads.incomingRows
  );
  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    SHEET_TABS.sales,
    payloads.salesRows
  );
  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    SHEET_TABS.profits,
    payloads.profitRows
  );
  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    SHEET_TABS.expenses,
    payloads.expensesRows
  );
  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    SHEET_TABS.discounts,
    payloads.discountsRows
  );
  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    SHEET_TABS.rent,
    payloads.rentRows
  );
  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    SHEET_TABS.invoicePayments,
    payloads.invoicePaymentsRows
  );
  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    SHEET_TABS.staffWithdrawals,
    payloads.staffWithdrawalsRows
  );
  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    SHEET_TABS.managerGoodsWithdrawals,
    payloads.managerGoodsRows
  );
  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    SHEET_TABS.customerDebts,
    payloads.customerDebtsRows
  );
  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    SHEET_TABS.returns,
    payloads.returnsRows
  );

  // Apply crisp visual Month/Day/Header highlighting
  const formatRequests = [
    ...buildRowStyleRequests(
      sheetIdByTitle[SHEET_TABS.inventory],
      8,
      payloads.inventoryRowKinds
    ),
    ...buildRowStyleRequests(
      sheetIdByTitle[SHEET_TABS.incoming],
      payloads.incomingCols,
      payloads.incomingRowKinds
    ),
    ...buildRowStyleRequests(
      sheetIdByTitle[SHEET_TABS.sales],
      10,
      payloads.salesRowKinds
    ),
    ...buildRowStyleRequests(
      sheetIdByTitle[SHEET_TABS.profits],
      9,
      payloads.profitRowKinds
    ),
    ...buildRowStyleRequests(
      sheetIdByTitle[SHEET_TABS.expenses],
      6,
      payloads.expensesRowKinds
    ),
    ...buildRowStyleRequests(
      sheetIdByTitle[SHEET_TABS.discounts],
      9,
      payloads.discountsRowKinds
    ),
    ...buildRowStyleRequests(
      sheetIdByTitle[SHEET_TABS.rent],
      8,
      payloads.rentRowKinds
    ),
    ...buildRowStyleRequests(
      sheetIdByTitle[SHEET_TABS.invoicePayments],
      payloads.invoicePaymentsCols,
      payloads.invoicePaymentsRowKinds
    ),
    ...buildRowStyleRequests(
      sheetIdByTitle[SHEET_TABS.staffWithdrawals],
      payloads.staffWithdrawalsCols,
      payloads.staffWithdrawalsRowKinds
    ),
    ...buildRowStyleRequests(
      sheetIdByTitle[SHEET_TABS.managerGoodsWithdrawals],
      payloads.managerGoodsCols,
      payloads.managerGoodsRowKinds
    ),
    ...buildRowStyleRequests(
      sheetIdByTitle[SHEET_TABS.customerDebts],
      payloads.customerDebtsCols,
      payloads.customerDebtsRowKinds
    ),
    ...buildRowStyleRequests(
      sheetIdByTitle[SHEET_TABS.returns],
      payloads.returnsCols,
      payloads.returnsRowKinds
    ),
  ];

  // If this is the Main Warehouse branch, also sync Master Total Inventory & All-Branches Incoming Goods tabs inside it
  if (isMainStore) {
    const masterPayloads = buildMasterSheetPayloads(db);
    await clearAndWriteSheet(
      accessToken,
      spreadsheetId,
      MASTER_SHEET_TABS.totalInventory,
      masterPayloads.totalInventoryRows
    );
    await clearAndWriteSheet(
      accessToken,
      spreadsheetId,
      MASTER_SHEET_TABS.allIncoming,
      masterPayloads.allIncomingRows
    );
    formatRequests.push(
      ...buildRowStyleRequests(
        sheetIdByTitle[MASTER_SHEET_TABS.totalInventory],
        masterPayloads.totalInventoryCols,
        masterPayloads.totalInventoryRowKinds
      ),
      ...buildRowStyleRequests(
        sheetIdByTitle[MASTER_SHEET_TABS.allIncoming],
        masterPayloads.allIncomingCols,
        masterPayloads.allIncomingRowKinds
      )
    );
  }

  if (formatRequests.length > 0) {
    await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ requests: formatRequests }),
      }
    ).catch(() => undefined);
  }

  return payloads.counts;
};

export const pushMasterToGoogleSheet = async (
  accessToken: string,
  spreadsheetId: string,
  db: PosDatabase
) => {
  const { sheetIdByTitle } = await ensureMasterSpreadsheetTabs(
    accessToken,
    spreadsheetId
  );
  const master = buildMasterSheetPayloads(db);

  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    MASTER_SHEET_TABS.totalInventory,
    master.totalInventoryRows
  );
  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    MASTER_SHEET_TABS.allIncoming,
    master.allIncomingRows
  );
  await clearAndWriteSheet(
    accessToken,
    spreadsheetId,
    MASTER_SHEET_TABS.incomingSummary,
    master.incomingSummaryRows
  );

  const formatRequests = [
    ...buildRowStyleRequests(
      sheetIdByTitle[MASTER_SHEET_TABS.totalInventory],
      master.totalInventoryCols,
      master.totalInventoryRowKinds
    ),
    ...buildRowStyleRequests(
      sheetIdByTitle[MASTER_SHEET_TABS.allIncoming],
      master.allIncomingCols,
      master.allIncomingRowKinds
    ),
    ...buildRowStyleRequests(
      sheetIdByTitle[MASTER_SHEET_TABS.incomingSummary],
      master.incomingSummaryCols,
      master.incomingSummaryRowKinds
    ),
  ];

  if (formatRequests.length > 0) {
    await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ requests: formatRequests }),
      }
    ).catch(() => undefined);
  }

  return master.counts;
};

export const parseInventoryRows = (rawValues: unknown[][]): SheetInventoryRow[] => {
  if (!Array.isArray(rawValues) || rawValues.length <= 1) return [];
  const rows: SheetInventoryRow[] = [];

  for (let i = 1; i < rawValues.length; i++) {
    const row = rawValues[i];
    if (!Array.isArray(row)) continue;

    // Support both 8-col (with ID in col 0) and 7-col (without ID)
    const rawCol0 = row[0];
    const col0IsId =
      rawCol0 !== undefined &&
      rawCol0 !== '' &&
      !Number.isNaN(Number(rawCol0)) &&
      typeof row[1] === 'string' &&
      String(row[1]).trim().length > 0;

    const id = col0IsId ? Math.floor(num(rawCol0)) : undefined;
    const name = String(col0IsId ? row[1] ?? '' : row[0] ?? '').trim();
    if (!name) continue;

    const offset = col0IsId ? 2 : 1;
    const price = Math.max(0, num(row[offset]));
    const min = Math.max(0, num(row[offset + 1]));
    const cost = Math.max(0, num(row[offset + 2]));
    const stock = Math.max(0, Math.floor(num(row[offset + 3])));
    const minStockRaw = row[offset + 4];
    const minStock =
      minStockRaw !== undefined && minStockRaw !== ''
        ? Math.max(0, Math.floor(num(minStockRaw)))
        : 3;

    rows.push({
      id: id && id > 0 ? id : undefined,
      name,
      price,
      min: min > price && price > 0 ? price : min,
      cost,
      stock,
      minStock,
    });
  }
  return rows;
};

export const readBranchInventoryFromSheet = async (
  accessToken: string,
  spreadsheetId: string
): Promise<SheetInventoryRow[]> => {
  const range = encodeURIComponent(`'${SHEET_TABS.inventory}'!A1:H5000`);
  const data = await googleFetch<{ values?: unknown[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`,
    accessToken
  );
  return parseInventoryRows(data.values ?? []);
};

export const diffBranchInventory = (
  existingProducts: Product[],
  sheetRows: SheetInventoryRow[]
): InventoryDiffResult => {
  const added: SheetInventoryRow[] = [];
  const updated: { existing: Product; incoming: SheetInventoryRow }[] = [];
  let unchanged = 0;

  for (const row of sheetRows) {
    const match =
      (row.id ? existingProducts.find((p) => p.id === row.id) : undefined) ??
      existingProducts.find((p) => norm(p.name) === norm(row.name));

    if (!match) {
      added.push(row);
    } else {
      const isDifferent =
        match.name.trim() !== row.name.trim() ||
        match.price !== row.price ||
        match.min !== row.min ||
        match.cost !== row.cost ||
        match.stock !== row.stock ||
        (match.minStock ?? 3) !== row.minStock;
      if (isDifferent) {
        updated.push({ existing: match, incoming: row });
      } else {
        unchanged += 1;
      }
    }
  }

  return {
    added,
    updated,
    unchanged,
    totalSheetRows: sheetRows.length,
  };
};

export const applySheetInventoryToStore = (
  d: PosDatabase,
  storeId: number,
  sheetRows: SheetInventoryRow[]
): { addedCount: number; updatedCount: number } => {
  let addedCount = 0;
  let updatedCount = 0;
  const nowTs = Date.now();

  for (const row of sheetRows) {
    const existing =
      (row.id
        ? d.products.find((p) => p.id === row.id && p.storeId === storeId)
        : undefined) ??
      d.products.find(
        (p) => p.storeId === storeId && norm(p.name) === norm(row.name)
      );

    if (existing) {
      const prevStock = existing.stock;
      const changed =
        existing.name.trim() !== row.name.trim() ||
        existing.price !== row.price ||
        existing.min !== row.min ||
        existing.cost !== row.cost ||
        existing.stock !== row.stock ||
        (existing.minStock ?? 3) !== row.minStock;
      if (changed) {
        existing.name = row.name;
        existing.price = row.price;
        existing.min = row.min;
        existing.cost = row.cost;
        existing.stock = row.stock;
        existing.minStock = row.minStock;
        updatedCount += 1;
        if (row.stock > prevStock) {
          if (!Array.isArray(d.stockEntries)) d.stockEntries = [];
          d.stockEntries.unshift({
            id: d.nid++,
            storeId,
            name: row.name,
            qty: row.stock - prevStock,
            cost: row.cost,
            price: row.price,
            min: row.min,
            enteredBy: 'مزامنة الجدول',
            approvedBy: 'مزامنة الجدول',
            source: 'sync',
            note: 'زيادة كمية من جدول إكسل / Google Sheets',
            ts: nowTs,
          });
        }
      }
    } else {
      const newId =
        row.id && !d.products.some((p) => p.id === row.id) ? row.id : d.nid++;
      if (newId >= d.nid) d.nid = newId + 1;
      d.products.push({
        id: newId,
        storeId,
        name: row.name,
        price: row.price,
        min: row.min,
        cost: row.cost,
        stock: row.stock,
        minStock: row.minStock,
      });
      if (row.stock > 0) {
        if (!Array.isArray(d.stockEntries)) d.stockEntries = [];
        d.stockEntries.unshift({
          id: d.nid++,
          storeId,
          name: row.name,
          qty: row.stock,
          cost: row.cost,
          price: row.price,
          min: row.min,
          enteredBy: 'مزامنة الجدول',
          approvedBy: 'مزامنة الجدول',
          source: 'sync',
          note: 'صنف مضاف من جدول إكسل / Google Sheets',
          ts: nowTs,
        });
      }
      addedCount += 1;
    }
  }

  return { addedCount, updatedCount };
};

// Restore inventory, sales, and expenses from a Google Sheet (for data-loss recovery)
export const restoreBranchDataFromSheet = async (
  accessToken: string,
  spreadsheetId: string,
  storeId: number
): Promise<{
  products: SheetInventoryRow[];
  sales: Sale[];
  expenses: Expense[];
}> => {
  const products = await readBranchInventoryFromSheet(accessToken, spreadsheetId);

  const salesRange = encodeURIComponent(`'${SHEET_TABS.sales}'!A1:J5000`);
  const salesRes = await googleFetch<{ values?: unknown[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${salesRange}?valueRenderOption=UNFORMATTED_VALUE`,
    accessToken
  ).catch(() => ({ values: [] }));

  const salesById = new Map<number, Sale>();
  const salesValues = salesRes.values ?? [];
  const colLen = Array.isArray(salesValues[0]) ? salesValues[0].length : 0;

  for (let i = 1; i < salesValues.length; i++) {
    const row = salesValues[i];
    if (!Array.isArray(row) || row[0] === undefined || row[0] === '') continue;
    // Skip month/day banner rows (only parse actual numeric invoice rows)
    const numericId = Number(row[0]);
    if (!Number.isFinite(numericId) || numericId <= 0) continue;

    const id = Math.floor(numericId);
    const dateVal = row[1];
    const parsedTs =
      typeof dateVal === 'number'
        ? Math.round((dateVal - 25569) * 86400 * 1000)
        : Date.parse(String(dateVal || '')) || Date.now();
    const emp = String(row[2] ?? 'موظف').trim();
    const itemName = String(row[3] ?? 'مبيعات مستعادة').trim();
    const qty = Math.max(1, Math.floor(num(row[4] ?? 1)));

    let unitPrice = 0;
    let discountShare = 0;
    let lineTotal = 0;
    let costTotal = 0;

    if (colLen >= 10) {
      unitPrice = Math.max(0, num(row[5]));
      discountShare = Math.max(0, num(row[6]));
      lineTotal = Math.max(0, num(row[7]));
      costTotal = Math.max(0, num(row[8]));
    } else if (colLen >= 9) {
      unitPrice = Math.max(0, num(row[5]));
      lineTotal = Math.max(0, num(row[6]));
      costTotal = Math.max(0, num(row[7]));
    } else {
      lineTotal = Math.max(0, num(row[5]));
      costTotal = Math.max(0, num(row[6]));
    }

    const lineItem = {
      id: 0,
      name: itemName,
      qty,
      price:
        unitPrice > 0 ? unitPrice : qty > 0 ? lineTotal / qty : lineTotal,
      discountShare: discountShare > 0 ? discountShare : undefined,
      cost: qty > 0 ? costTotal / qty : costTotal,
      ret: 0,
    };

    const existingSale = salesById.get(id);
    if (existingSale) {
      existingSale.items.push(lineItem);
      existingSale.total += lineTotal;
      if (discountShare > 0) {
        existingSale.discount = (existingSale.discount ?? 0) + discountShare;
      }
    } else {
      salesById.set(id, {
        id,
        storeId,
        emp,
        total: lineTotal,
        discount: discountShare > 0 ? discountShare : undefined,
        ts: parsedTs,
        items: [lineItem],
      });
    }
  }
  const parsedSales: Sale[] = Array.from(salesById.values());

  const expRange = encodeURIComponent(`'${SHEET_TABS.expenses}'!A1:F5000`);
  const expRes = await googleFetch<{ values?: unknown[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${expRange}?valueRenderOption=UNFORMATTED_VALUE`,
    accessToken
  ).catch(() => ({ values: [] }));

  const parsedExpenses: Expense[] = [];
  const expValues = expRes.values ?? [];
  for (let i = 1; i < expValues.length; i++) {
    const row = expValues[i];
    if (!Array.isArray(row) || !row[2]) continue;
    const kind = String(row[1] ?? '').trim();
    if (kind === 'راتب' || kind === 'ملخص الشهر' || kind === 'ملخص اليوم') {
      continue;
    }
    const dateVal = row[0];
    const parsedTs =
      typeof dateVal === 'number'
        ? Math.round((dateVal - 25569) * 86400 * 1000)
        : Date.parse(String(dateVal || '')) || Date.now();
    parsedExpenses.push({
      storeId,
      desc: String(row[2] ?? '').trim(),
      amount: Math.max(0, num(row[3])),
      emp: String(row[4] ?? 'الإدارة').trim(),
      ts: parsedTs,
    });
  }

  return { products, sales: parsedSales, expenses: parsedExpenses };
};
