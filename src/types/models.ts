export type UserRole = 'owner' | 'admin';

export type MaterialCategory =
  | 'kain'
  | 'benang'
  | 'kancing'
  | 'resleting'
  | 'hangtag'
  | 'kemasan'
  | 'lainnya';

export type MaterialPurchaseUnit = 'roll' | 'pak' | 'bungkus' | 'meter' | 'kg' | 'lusin';
export type MaterialUsageUnit = 'cm' | 'pcs';

export type LedgerEntryType =
  | 'penerimaan'
  | 'pemakaian_produksi'
  | 'wip_masuk'
  | 'wip_keluar'
  | 'hasil_produksi'
  | 'penjualan'
  | 'retur'
  | 'opname_koreksi'
  | 'reversal';

export type ProductionStage =
  | 'potong'
  | 'setoran'
  | 'reject'
  | 'cutting'
  | 'sewing'
  | 'qc'
  | 'packing';
export type WorkOrderStage = ProductionStage | 'completed';
export type WorkOrderStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';

export type BomItemKind = 'material' | 'cost';
export type RecipeCostCategory = 'jahit_cutting' | 'sablon' | 'packing' | 'lainnya';

export type SalesChannel = string;
export type PaymentStatus = 'unpaid' | 'dp' | 'paid';
export type ShippingStatus = 'pending' | 'packed' | 'shipped' | 'delivered';

export interface UserProfile {
  uid: string;
  nama: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Material {
  id: string;
  kode: string;
  nama: string;
  kategori: MaterialCategory;
  satuan: string; // Disinkronkan ke satuanPakai ('cm' | 'pcs') untuk kompatibilitas ledger
  satuanBeli: MaterialPurchaseUnit;
  satuanPakai: MaterialUsageUnit;
  konversi?: number | null; // 1 satuanBeli = N satuanPakai; kosong jika pemilik belum isi
  minStock: number;
  active: boolean;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Product {
  id: string;
  sku: string;
  nama: string;
  model: string;
  warna: string;
  ukuran: string;
  satuan: string;
  minStock: number;
  hargaJual: number;
  hppPerPcs?: number;
  active: boolean;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Supplier {
  id: string;
  nama: string;
  telepon: string;
  alamat: string;
  catatan: string;
  active: boolean;
  createdBy: string;
  createdAt?: unknown;
}

export interface Customer {
  id: string;
  nama: string;
  tipe: string;
  telepon: string;
  alamat: string;
  active: boolean;
  createdBy: string;
  createdAt?: unknown;
}

export interface Account {
  id: string;
  nama: string;
  tipe: 'kas' | 'bank';
  nomorRekening: string;
  saldoAwal: number;
  saldoBerjalan: number;
  active: boolean;
  lastPaymentId?: string;
  lastAuditLogId?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
}

export interface StockLedgerEntry {
  id: string;
  itemId: string;
  itemType: 'material' | 'product' | 'wip';
  jenis: LedgerEntryType;
  qty: number;
  tanggal: string;
  refType: string;
  refId: string;
  catatan: string;
  balance_before: number;
  balance_after: number;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
}

export interface StockBalance {
  id: string;
  itemId: string;
  itemType: 'material' | 'product' | 'wip';
  qty: number;
  lastLedgerId: string;
  updatedAt?: unknown;
}

export interface OpnameRequest {
  id: string;
  itemId: string;
  itemType: 'material' | 'product';
  systemQty: number;
  physicalQty: number;
  diffQty: number;
  alasan: string;
  tanggal: string;
  status: 'pending' | 'approved' | 'rejected';
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
  approvedBy?: string;
  approvedAt?: unknown;
}

export interface BomItem {
  id: string;
  productId: string;
  jenis?: BomItemKind; // default 'material' untuk kompatibilitas dokumen lama
  materialId?: string;
  qtyPerPcs?: number;
  costCategory?: RecipeCostCategory;
  label?: string;
  amountPerPcs?: number;
  active: boolean;
  createdBy: string;
  createdAt?: unknown;
}

export interface WorkOrder {
  id: string;
  woNumber: string;
  productId: string;
  targetQty: number;
  completedQty: number;
  wipQty: number;
  rejectedQty?: number;
  cutCompleted?: boolean;
  cutMaterialIds?: string[];
  hppPerPcsSnapshot?: number;
  currentStage: WorkOrderStage;
  status: WorkOrderStatus;
  tanggal: string;
  catatan: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  completedAt?: unknown;
}

export interface StageLog {
  id: string;
  woId?: string;
  stage: ProductionStage;
  inputQty: number;
  goodQty: number;
  rejectQty: number;
  reworkQty: number;
  rejectReason: string;
  tanggal: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
}

export interface SalesOrderItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  qty: number;
  unitPrice: number;
  subtotal: number;
}

export interface SalesOrder {
  id: string;
  soNumber: string;
  customerId: string;
  customerName: string;
  channel: SalesChannel;
  noPesanan?: string;
  totalAmount: number; // hargaJual total
  biayaAdmin?: number;
  komisiAffiliate?: number;
  potonganLain?: number;
  penerimaanBersih?: number;
  paidAmount: number;
  paymentStatus: PaymentStatus;
  shippingStatus: ShippingStatus;
  status: 'active' | 'void';
  importKey?: string;
  tanggal: string;
  catatan: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
}

export interface Payment {
  id: string;
  soId: string;
  soNumber: string;
  accountId: string;
  accountName: string;
  amount: number;
  tanggal: string;
  metode: string;
  catatan: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
}

export interface SalesReturn {
  id: string;
  soId: string;
  soNumber: string;
  productId: string;
  qty: number;
  refundAmount: number;
  restockable: boolean;
  alasan: string;
  tanggal: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
}

export interface PurchaseCost {
  id: string;
  ledgerId: string;
  itemId: string;
  supplierId: string;
  qty: number; // kuantitas dalam satuan pakai terkecil (cm/pcs)
  unitCost: number; // dapat berupa pecahan untuk per cm/pcs
  totalCost: number; // total harga beli bulat rupiah
  paidAmount: number;
  accountId: string;
  purchaseQty?: number;
  purchaseUnit?: string;
  actualUsageQty?: number;
  tanggal: string;
  catatan: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
}

export interface ProductionCost {
  id: string;
  woId: string;
  woNumber: string;
  vendorName: string;
  kategori: 'jahit_cmt' | 'cutting' | 'finishing' | 'sablon' | 'packing' | 'lainnya';
  amount: number;
  paidAmount: number;
  accountId: string;
  tanggal: string;
  catatan: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
}

export interface OperatingExpense {
  id: string;
  kategori: string;
  deskripsi: string;
  accountId: string;
  amount: number;
  tanggal: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
}

export interface JournalEntry {
  id: string;
  tanggal: string;
  source: string;
  refId: string;
  accountId?: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  debitAmount?: number;
  creditAmount?: number;
  deskripsi: string;
  isReversal?: boolean;
  reversedEntryId?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
}

export interface PeriodDoc {
  id: string;
  closed: boolean;
  closedNote?: string;
  updatedBy: string;
  updatedAt?: unknown;
}

export interface BankStatement {
  id: string;
  accountId: string;
  tanggal: string;
  deskripsi: string;
  amount: number;
  matchedRefId?: string;
  matchedNote?: string;
  createdBy: string;
  createdAt?: unknown;
}

export interface AuditLog {
  id: string;
  uid: string;
  createdBy?: string;
  createdByName?: string;
  aksi: string;
  targetCollection: string;
  targetId: string;
  sebelum: string;
  sesudah: string;
  createdAt?: unknown;
}

export interface MarketplaceChannel {
  id: string;
  nama: string;
  balance: number; // Saldo Marketplace menunggu pencairan (rupiah bulat)
  active: boolean;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MarketplaceMapping {
  id: string;
  channelId: string;
  channelName: string;
  mappingJson: string;
  updatedBy: string;
  updatedAt?: unknown;
}

export interface MarketplacePayout {
  id: string;
  channelId: string;
  channelName: string;
  accountId: string;
  accountName: string;
  amount: number;
  tanggal: string;
  catatan: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
}

export interface WagePayout {
  id: string;
  startDate: string;
  endDate: string;
  tanggal: string;
  accountId: string;
  accountName: string;
  jahitCuttingStandard: number;
  sablonStandard: number;
  packingStandard: number;
  lainnyaStandard: number;
  totalStandard: number;
  jahitCuttingPaid: number;
  sablonPaid: number;
  packingPaid: number;
  lainnyaPaid: number;
  totalPaid: number;
  variance: number; // totalPaid - totalStandard
  catatan: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
}

export interface AccountingSettings {
  id: string;
  modalAwal: number | null; // null berarti belum diisi oleh pemilik
  updatedBy: string;
  updatedAt?: unknown;
}

export type AppScreen =
  | 'dashboard'
  | 'master'
  | 'inventory'
  | 'opname'
  | 'work_orders'
  | 'wages'
  | 'sales'
  | 'cash'
  | 'payables_receivables'
  | 'profit_loss'
  | 'reconciliation'
  | 'periods'
  | 'integrity'
  | 'users'
  | 'import_export'
  | 'audit_logs';
