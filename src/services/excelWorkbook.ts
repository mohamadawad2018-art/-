import * as XLSX from 'xlsx';
import { dayKey } from '../store';
import type { PosDatabase, StoreBranch } from '../types';
import {
  buildBranchSheetPayloads,
  buildMasterSheetPayloads,
  MASTER_SHEET_TABS,
  parseInventoryRows,
  SHEET_TABS,
  type SheetInventoryRow,
} from './sheetsSync';

const safeSheetName = (name: string): string =>
  name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'ورقة';

const buildStyledSheet = (rows: (string | number)[][]) => {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!views'] = [{ RTL: true }];
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  ws['!cols'] = Array.from({ length: maxCols }, (_, colIdx) => {
    let maxLen = 12;
    for (const row of rows) {
      const val = row[colIdx];
      if (val !== undefined && val !== null) {
        maxLen = Math.max(maxLen, String(val).length + 3);
      }
    }
    return { wch: Math.min(38, maxLen) };
  });
  return ws;
};

export const exportMasterInventoryWorkbook = (db: PosDatabase) => {
  const wb = XLSX.utils.book_new();
  const master = buildMasterSheetPayloads(db);

  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(master.totalInventoryRows),
    MASTER_SHEET_TABS.totalInventory
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(master.allIncomingRows),
    MASTER_SHEET_TABS.allIncoming
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(master.incomingSummaryRows),
    MASTER_SHEET_TABS.incomingSummary
  );

  XLSX.writeFile(wb, `المخزن-الرئيسي-إجمالي-المخزون-${dayKey(Date.now())}.xlsx`);
};

export const exportBranchWorkbook = (db: PosDatabase, store: StoreBranch) => {
  const wb = XLSX.utils.book_new();
  const payloads = buildBranchSheetPayloads(db, store.id);
  const isMainStore = db.stores[0]?.id === store.id;

  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(payloads.inventoryRows),
    SHEET_TABS.inventory
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(payloads.incomingRows),
    SHEET_TABS.incoming
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(payloads.salesRows),
    SHEET_TABS.sales
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(payloads.profitRows),
    SHEET_TABS.profits
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(payloads.expensesRows),
    SHEET_TABS.expenses
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(payloads.discountsRows),
    SHEET_TABS.discounts
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(payloads.rentRows),
    SHEET_TABS.rent
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(payloads.invoicePaymentsRows),
    SHEET_TABS.invoicePayments
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(payloads.staffWithdrawalsRows),
    SHEET_TABS.staffWithdrawals
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(payloads.managerGoodsRows),
    SHEET_TABS.managerGoodsWithdrawals
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(payloads.customerDebtsRows),
    SHEET_TABS.customerDebts
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(payloads.returnsRows),
    SHEET_TABS.returns
  );

  if (isMainStore) {
    const master = buildMasterSheetPayloads(db);
    XLSX.utils.book_append_sheet(
      wb,
      buildStyledSheet(master.totalInventoryRows),
      MASTER_SHEET_TABS.totalInventory
    );
    XLSX.utils.book_append_sheet(
      wb,
      buildStyledSheet(master.allIncomingRows),
      MASTER_SHEET_TABS.allIncoming
    );
  }

  const fileName = `${safeSheetName(store.name)}-${dayKey(Date.now())}.xlsx`;
  XLSX.writeFile(wb, fileName);
};

export const exportAllBranchesWorkbook = (db: PosDatabase) => {
  const wb = XLSX.utils.book_new();
  const master = buildMasterSheetPayloads(db);

  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(master.totalInventoryRows),
    MASTER_SHEET_TABS.totalInventory
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(master.allIncomingRows),
    MASTER_SHEET_TABS.allIncoming
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildStyledSheet(master.incomingSummaryRows),
    MASTER_SHEET_TABS.incomingSummary
  );

  for (const store of db.stores) {
    const payloads = buildBranchSheetPayloads(db, store.id);
    const shortStore = store.name.slice(0, 18);
    const tabs: [string, (string | number)[][]][] = [
      [safeSheetName(`مخزون-${shortStore}`), payloads.inventoryRows],
      [safeSheetName(`وارد-${shortStore}`), payloads.incomingRows],
      [safeSheetName(`مبيعات-${shortStore}`), payloads.salesRows],
      [safeSheetName(`أرباح-${shortStore}`), payloads.profitRows],
      [safeSheetName(`مصاريف-${shortStore}`), payloads.expensesRows],
      [safeSheetName(`خصومات-${shortStore}`), payloads.discountsRows],
      [safeSheetName(`إيجار-${shortStore}`), payloads.rentRows],
      [safeSheetName(`دفعات-${shortStore}`), payloads.invoicePaymentsRows],
      [safeSheetName(`مسحوبات-${shortStore}`), payloads.staffWithdrawalsRows],
      [safeSheetName(`بضاعة-مدير-${shortStore}`), payloads.managerGoodsRows],
      [safeSheetName(`ديون-${shortStore}`), payloads.customerDebtsRows],
      [safeSheetName(`مرتجعات-${shortStore}`), payloads.returnsRows],
    ];
    for (const [tabName, rows] of tabs) {
      XLSX.utils.book_append_sheet(wb, buildStyledSheet(rows), tabName);
    }
  }
  XLSX.writeFile(wb, `all-branches-${dayKey(Date.now())}.xlsx`);
};

export const parseInventoryFromExcelFile = async (
  file: File
): Promise<SheetInventoryRow[]> => {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const targetSheetName =
    wb.SheetNames.find((n) => n.includes(SHEET_TABS.inventory)) ??
    wb.SheetNames[0];
  if (!targetSheetName) return [];
  const ws = wb.Sheets[targetSheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: '',
  });
  return parseInventoryRows(aoa);
};
