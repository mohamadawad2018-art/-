export type UserRole = 'manager' | 'employee';

export interface StoreBranch {
  id: number;
  name: string;
}

export interface User {
  id: number;
  name: string;
  role: UserRole;
  owner?: boolean;
  pin: string;
  storeId?: number;
  storeIds?: number[];
  salary?: number;
}

export interface Product {
  id: number;
  storeId: number;
  name: string;
  price: number;
  min: number;
  cost: number;
  stock: number;
  minStock: number;
}

export interface SaleItem {
  id: number;
  name: string;
  qty: number;
  price: number;
  originalPrice?: number;
  discountShare?: number;
  cost: number;
  ret: number;
}

export interface Sale {
  id: number;
  storeId: number;
  emp: string;
  items: SaleItem[];
  total: number;
  discount?: number;
  subtotalBeforeDiscount?: number;
  ts: number;
}

export interface DiscountRecord {
  id: number;
  saleId: number;
  storeId: number;
  emp: string;
  role: UserRole;
  amount: number;
  subtotalBefore: number;
  netTotal: number;
  itemCount: number;
  note?: string;
  ts: number;
}

export interface Expense {
  storeId: number;
  desc: string;
  amount: number;
  emp: string;
  ts: number;
}

export interface WithdrawalItem {
  id: number;
  name: string;
  qty: number;
  cost?: number;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Withdrawal {
  id: number;
  storeId: number;
  type: 'cash' | 'goods';
  whoType?: 'manager' | 'employee';
  takenBy?: string;
  takenByUserId?: number;
  amount: number;
  items: WithdrawalItem[];
  paid?: boolean;
  paidAmount?: number;
  paidAt?: number;
  paidBy?: string;
  paidToCash?: boolean;
  settlementMethod?: 'cash' | 'salary_deduction' | 'return_offset';
  deductedSalaryId?: number;
  deferredToMonth?: string;
  managerExclusive?: boolean;
  note?: string;
  emp: string;
  ts: number;
  status: ApprovalStatus;
}

export interface Salary {
  id: number;
  storeId: number;
  uid: number;
  name: string;
  amount: number;
  grossAmount?: number;
  withdrawalDeduction?: number;
  deductedWithdrawalIds?: number[];
  note?: string;
  by: string;
  ts: number;
  status: ApprovalStatus;
}

export interface ReturnRecord {
  storeId: number;
  name: string;
  price: number;
  qty: number;
  emp: string;
  ts: number;
  sale: number;
  sourceType?: 'customer' | 'staff';
  staffName?: string;
  staffUserId?: number;
  settlementType?: 'cash' | 'goods';
  goodsValue?: number;
  note?: string;
}

export interface ShiftRecord {
  storeId: number;
  emp: string;
  openingCash?: number;
  expected: number;
  actual: number;
  diff: number;
  ts: number;
  tries: number;
}

export interface StockIntakeItem {
  productId?: number;
  name: string;
  qty: number;
  cost: number;
  price: number;
  min: number;
  minStock?: number;
}

export interface StockIntakePayment {
  id: number;
  amount: number;
  by: string;
  role: UserRole;
  ts: number;
  note?: string;
  deductFromCash?: boolean;
}

export interface StockIntake {
  id: number;
  storeId: number;
  items: StockIntakeItem[];
  photoDataUrl?: string;
  note?: string;
  supplierName?: string;
  payments?: StockIntakePayment[];
  enteredBy: string;
  enteredRole: UserRole;
  approvedBy?: string;
  status: ApprovalStatus;
  ts: number;
  approvedTs?: number;
}

export interface StockEntryRecord {
  id: number;
  storeId: number;
  name: string;
  qty: number;
  cost: number;
  price: number;
  min: number;
  enteredBy: string;
  approvedBy?: string;
  source: 'manual' | 'sync';
  note?: string;
  ts: number;
}

export interface ActiveDrawerHolder {
  storeId: number;
  userId: number;
  userName: string;
  since: number;
  paused?: boolean;
  pausedAt?: number;
}

export interface BonusRecord {
  id: number;
  storeId: number;
  uid?: number;
  empName: string;
  amount: number;
  note: string;
  deductFromCash: boolean;
  by: string;
  ts: number;
}

export interface LogEntry {
  storeId?: number;
  ts: number;
  who: string;
  t: string;
}

export interface BranchSheetLink {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  autoSyncEnabled?: boolean;
  lastSyncTs?: number;
}

export interface StoreRentRecord {
  id: number;
  storeId: number;
  month: string; // YYYY-MM
  usdAmount: number;
  exchangeRate: number;
  localAmount: number;
  deductFromCash: boolean;
  note?: string;
  by: string;
  ts: number;
}

export interface OwnerAlert {
  id: number;
  kind?: 'pin' | 'stock' | 'price' | 'critical';
  title: string;
  message: string;
  by: string;
  targetUserName?: string;
  storeId?: number;
  ts: number;
  read: boolean;
}

export type ActivityCategory =
  | 'stock_edit'
  | 'price_edit'
  | 'security_pin'
  | 'sale'
  | 'return'
  | 'intake'
  | 'expense'
  | 'withdrawal'
  | 'debt'
  | 'salary'
  | 'branch_rent'
  | 'session'
  | 'message'
  | 'system';

export interface ActivityNotification {
  id: number;
  storeId?: number;
  actor: string;
  actorRole: UserRole | 'owner' | 'system';
  category: ActivityCategory;
  title: string;
  message: string;
  important?: boolean;
  ts: number;
  read: boolean;
}

export interface InternalMessage {
  id: number;
  senderId: number;
  senderName: string;
  senderRole: UserRole | 'owner';
  recipientType: 'user' | 'store_staff' | 'all_managers' | 'all_employees' | 'all';
  recipientUserId?: number;
  recipientName?: string;
  storeId?: number;
  subject: string;
  body: string;
  priority?: 'normal' | 'important';
  replyToId?: number;
  ts: number;
  readByUserIds: number[];
}

export interface CustomerDebtItem {
  productId: number;
  name: string;
  qty: number;
  unitPrice: number;
  cost: number;
}

export interface CustomerDebtPayment {
  id: number;
  amount: number;
  by: string;
  ts: number;
  addToCash: boolean;
  note?: string;
}

export interface CustomerDebt {
  id: number;
  storeId: number;
  debtType?: 'goods' | 'cash';
  deductFromCash?: boolean;
  customerName: string;
  customerPhone?: string;
  givenBy: string;
  givenByRole: UserRole;
  items: CustomerDebtItem[];
  totalAmount: number;
  payments: CustomerDebtPayment[];
  paid: boolean;
  paidAt?: number;
  paidBy?: string;
  note?: string;
  ts: number;
}

export interface PosDatabase {
  stores: StoreBranch[];
  activeHolders: Record<number, ActiveDrawerHolder>;
  users: User[];
  products: Product[];
  sales: Sale[];
  discounts?: DiscountRecord[];
  expenses: Expense[];
  withdrawals: Withdrawal[];
  salaries: Salary[];
  returns: ReturnRecord[];
  shifts: ShiftRecord[];
  stockIntakes: StockIntake[];
  stockEntries?: StockEntryRecord[];
  rents?: StoreRentRecord[];
  ownerAlerts?: OwnerAlert[];
  activityAlerts?: ActivityNotification[];
  messages?: InternalMessage[];
  branchFeedSeenAt?: Record<string, number>;
  customerDebts?: CustomerDebt[];
  bonuses: BonusRecord[];
  log: LogEntry[];
  openingByStore: Record<number, number>;
  lastCloseByStore: Record<number, number>;
  sheetsLinks?: Record<number, BranchSheetLink>;
  masterSheetLink?: BranchSheetLink;
  trustedGoogleEmail?: string;
  nid: number;
}

export interface CartItem {
  id: number;
  name: string;
  min: number;
  cost: number;
  qty: number;
  price: number;
}
