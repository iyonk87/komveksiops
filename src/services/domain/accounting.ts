import type {
  Account,
  BomItem,
  JournalEntry,
  MarketplaceChannel,
  MarketplacePayout,
  Material,
  MaterialUsageUnit,
  OperatingExpense,
  Payment,
  PaymentStatus,
  PeriodDoc,
  Product,
  ProductionCost,
  ProductionStage,
  PurchaseCost,
  SalesOrder,
  SalesOrderItem,
  SalesReturn,
  StageLog,
  StockBalance,
  StockLedgerEntry,
  WagePayout,
  WorkOrder,
} from '../../types/models';
import { periodFromDate } from '../../utils/format';

export interface RecipeHppBreakdown {
  productId: string;
  materialCostFloat: number;
  jahitCuttingPerPcs: number;
  sablonPerPcs: number;
  packingPerPcs: number;
  lainnyaPerPcs: number;
  productionCostSum: number;
  exactHppFloat: number;
  hppPerPcs: number;
}

export interface WeightedCostResult {
  materialUnitCostFloat: Record<string, number>;
  materialUnitCost: Record<string, number>;
  productUnitCostFloat: Record<string, number>;
  productUnitCost: Record<string, number>;
  recipeHppByProduct: Record<string, RecipeHppBreakdown>;
  woUnitMaterialCostFloat: Record<string, number>;
  totalMaterialValue: number;
  totalWipValue: number;
  totalProductValue: number;
  totalInventoryValue: number;
  cogsTotal: number;
  rejectExpenseTotal: number;
  accruedWagesTotal: number;
  opnameAdjustmentTotal: number;
}

export interface ProfitLossReport {
  grossSales: number;
  marketplaceFeesTotal: number;
  returnsTotal: number;
  netSales: number;
  hppTotal: number;
  grossProfit: number;
  rejectExpenseTotal: number;
  wageVarianceTotal: number;
  opnameAdjustmentTotal: number;
  operatingExpensesTotal: number;
  netProfit: number;
  marginPercent: number;
}

export interface CashFlowReport {
  openingCashBank: number;
  marketplacePayoutInflows: number;
  directSalesPaymentInflows: number;
  totalCashInflows: number;
  purchaseCashOutflows: number;
  productionCashOutflows: number;
  wagePayoutCashOutflows: number;
  apSettlementCashOutflows: number;
  operatingExpenseCashOutflows: number;
  totalCashOutflows: number;
  netCashChange: number;
  endingCashBank: number;
  recordedCashBank: number;
}

export interface BalanceSheetReport {
  // Aset
  kasBalance: number;
  bankBalance: number;
  marketplaceBalance: number;
  receivablesBalance: number;
  materialInventoryValue: number;
  wipInventoryValue: number;
  productInventoryValue: number;
  totalAssets: number;
  // Liabilitas
  supplierPayables: number;
  productionPayables: number;
  accruedWages: number;
  totalLiabilities: number;
  // Ekuitas
  modalAwal: number | null;
  modalAwalUsed: number;
  retainedEarnings: number;
  totalEquity: number;
  // Rekonsiliasi ketat tanpa plug
  totalLiabilitiesAndEquity: number;
  selisih: number;
  isBalanced: boolean;
}

export interface WeeklyWageProductRow {
  productId: string;
  sku: string;
  productName: string;
  setoranQty: number;
  jahitCuttingRate: number;
  sablonRate: number;
  packingRate: number;
  lainnyaRate: number;
  jahitCuttingAmount: number;
  sablonAmount: number;
  packingAmount: number;
  lainnyaAmount: number;
  totalStandard: number;
}

export interface WeeklyWagesSummary {
  startDate: string;
  endDate: string;
  rows: WeeklyWageProductRow[];
  totalSetoranQty: number;
  jahitCuttingStandard: number;
  sablonStandard: number;
  packingStandard: number;
  lainnyaStandard: number;
  totalStandard: number;
  totalAlreadyPaid: number;
  totalVarianceRecorded: number;
}

export interface StageEfficiencyMetric {
  stage: ProductionStage;
  totalInput: number;
  totalGood: number;
  totalReject: number;
  totalRework: number;
  rejectPercent: number;
}

export interface ProductionEfficiencyReport {
  totalWorkOrders: number;
  completedWorkOrders: number;
  activeWipQty: number;
  totalRejectedQty: number;
  averageLeadTimeDays: number;
  stageMetrics: StageEfficiencyMetric[];
}

export type IntegrityDiscrepancyKind =
  | 'cash_balance'
  | 'marketplace_balance'
  | 'stock_balance'
  | 'orphan_stock_ledger'
  | 'orphan_stock_balance'
  | 'sales_order_total'
  | 'sales_order_payment'
  | 'sales_order_payment_status'
  | 'orphan_payment'
  | 'return_exceeds_sold'
  | 'journal_source_mismatch'
  | 'wo_packing_qty_mismatch'
  | 'wo_completed_without_output'
  | 'orphan_ledger_sales'
  | 'sales_ledger_qty_mismatch'
  | 'orphan_ledger_return'
  | 'return_ledger_qty_mismatch'
  | 'orphan_ledger_wo'
  | 'closed_period_tx'
  | 'journal_imbalance';

export interface IntegrityDiscrepancy {
  kind: IntegrityDiscrepancyKind;
  id: string;
  label: string;
  recordedValue: number;
  recalculatedValue: number;
  difference: number;
  unit?: 'qty' | 'rupiah' | 'seconds' | 'status';
  detail?: string;
}

export interface UnpricedReceiptInfo {
  ledgerId: string;
  itemId: string;
  itemLabel: string;
  qty: number;
  tanggal: string;
  refId: string;
  catatan: string;
  createdByName: string;
}

export interface PriceOverrideInfo {
  soId: string;
  soNumber: string;
  tanggal: string;
  productId: string;
  productLabel: string;
  sku: string;
  qty: number;
  normalPrice: number;
  usedPrice: number;
  differencePerUnit: number;
  createdByName: string;
}

export interface IntegrityAuditReport {
  discrepancies: IntegrityDiscrepancy[];
  unpricedReceipts: UnpricedReceiptInfo[];
  priceOverrides: PriceOverrideInfo[];
}

export function getMaterialUsageUnit(mat: Pick<Material, 'satuanPakai' | 'satuan'>): MaterialUsageUnit {
  if (mat.satuanPakai === 'cm' || mat.satuanPakai === 'pcs') return mat.satuanPakai;
  return mat.satuan === 'cm' ? 'cm' : 'pcs';
}

export function computeReceivingUsageQty(params: {
  purchaseQty: number;
  unitMode: 'purchase' | 'usage';
  konversi?: number | null;
  actualUsageQty?: number | null;
}): number {
  const { purchaseQty, unitMode, konversi, actualUsageQty } = params;
  if (actualUsageQty !== undefined && actualUsageQty !== null) {
    if (!Number.isInteger(actualUsageQty) || actualUsageQty <= 0) {
      throw new Error('Panjang/jumlah aktual dalam satuan pakai harus bilangan bulat > 0.');
    }
    return actualUsageQty;
  }

  if (unitMode === 'usage') {
    if (!Number.isInteger(purchaseQty) || purchaseQty <= 0) {
      throw new Error('Jumlah penerimaan dalam satuan pakai harus bilangan bulat > 0.');
    }
    return purchaseQty;
  }

  if (konversi === undefined || konversi === null || !Number.isInteger(konversi) || konversi <= 0) {
    throw new Error(
      'Konversi satuan beli belum diisi pada bahan ini. Isi konversi di Master Bahan atau masukkan jumlah aktual dalam satuan pakai.',
    );
  }
  if (!Number.isFinite(purchaseQty) || purchaseQty <= 0) {
    throw new Error('Jumlah pembelian harus lebih dari 0.');
  }
  const exact = purchaseQty * konversi;
  const rounded = Math.round(exact);
  if (Math.abs(exact - rounded) > 1e-6 || rounded <= 0) {
    throw new Error('Hasil konversi ke satuan pakai harus bilangan bulat > 0.');
  }
  return rounded;
}

export function validatePeriodOpen(tanggal: string, periods: PeriodDoc[]): void {
  const periodId = periodFromDate(tanggal);
  const found = periods.find((p) => p.id === periodId);
  if (found && found.closed) {
    throw new Error(`Periode ${periodId} sudah ditutup. Gunakan jurnal reversal di periode terbuka.`);
  }
}

export function validateStockChange(params: {
  currentBalance: number;
  deltaQty: number;
  allowNegative: boolean;
}): { balanceBefore: number; balanceAfter: number } {
  if (!Number.isInteger(params.deltaQty) || params.deltaQty === 0) {
    throw new Error('Kuantitas mutasi stok harus bilangan bulat dan tidak boleh 0.');
  }
  const balanceBefore = params.currentBalance;
  const balanceAfter = balanceBefore + params.deltaQty;
  if (balanceAfter < 0 && !params.allowNegative) {
    throw new Error(`Stok tidak mencukupi (tersedia ${balanceBefore}, diminta ${Math.abs(params.deltaQty)}).`);
  }
  return { balanceBefore, balanceAfter };
}

export function isRecipeMaterialRow(item: BomItem): boolean {
  return (item.jenis ?? 'material') === 'material' && Boolean(item.materialId);
}

export function isRecipeCostRow(item: BomItem): boolean {
  return item.jenis === 'cost';
}

export function calculateBomRequirements(
  bomItems: BomItem[],
  productId: string,
  pcsQty: number,
): Array<{ materialId: string; requiredQty: number }> {
  if (!Number.isInteger(pcsQty) || pcsQty <= 0) {
    throw new Error('Jumlah produksi harus bilangan bulat lebih dari 0.');
  }
  const map = new Map<string, number>();
  for (const item of bomItems) {
    if (!item.active || item.productId !== productId || !isRecipeMaterialRow(item)) continue;
    const matId = item.materialId!;
    const qtyPerPcs = item.qtyPerPcs ?? 0;
    if (qtyPerPcs <= 0) continue;
    const prev = map.get(matId) ?? 0;
    map.set(matId, prev + qtyPerPcs * pcsQty);
  }
  return Array.from(map.entries()).map(([materialId, requiredQty]) => ({
    materialId,
    requiredQty,
  }));
}

export function splitBomRequirementsIntoChunks<T>(items: T[], chunkSize = 6): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export function calculateRecipeHpp(params: {
  productId: string;
  bomItems: BomItem[];
  materialUnitCostFloat: Record<string, number>;
}): RecipeHppBreakdown {
  const { productId, bomItems, materialUnitCostFloat } = params;
  let materialCostFloat = 0;
  let jahitCuttingPerPcs = 0;
  let sablonPerPcs = 0;
  let packingPerPcs = 0;
  let lainnyaPerPcs = 0;

  for (const item of bomItems) {
    if (!item.active || item.productId !== productId) continue;
    if (isRecipeMaterialRow(item)) {
      const unitCost = materialUnitCostFloat[item.materialId!] ?? 0;
      materialCostFloat += (item.qtyPerPcs ?? 0) * unitCost;
    } else if (isRecipeCostRow(item)) {
      const amt = item.amountPerPcs ?? 0;
      if (item.costCategory === 'jahit_cutting') jahitCuttingPerPcs += amt;
      else if (item.costCategory === 'sablon') sablonPerPcs += amt;
      else if (item.costCategory === 'packing') packingPerPcs += amt;
      else lainnyaPerPcs += amt;
    }
  }

  const productionCostSum = jahitCuttingPerPcs + sablonPerPcs + packingPerPcs + lainnyaPerPcs;
  const exactHppFloat = materialCostFloat + productionCostSum;
  return {
    productId,
    materialCostFloat,
    jahitCuttingPerPcs,
    sablonPerPcs,
    packingPerPcs,
    lainnyaPerPcs,
    productionCostSum,
    exactHppFloat,
    hppPerPcs: Math.round(exactHppFloat),
  };
}

export function computeWipTransition(params: {
  stage: ProductionStage;
  currentWipQty: number;
  inputQty: number;
  goodQty: number;
  rejectQty: number;
  reworkQty: number;
}): {
  nextWipQty: number;
  finishedGoodsDelta: number;
  nextStage: WorkOrder['currentStage'];
} {
  const { stage, currentWipQty, inputQty, goodQty, rejectQty, reworkQty } = params;
  if (
    !Number.isInteger(inputQty) ||
    !Number.isInteger(goodQty) ||
    !Number.isInteger(rejectQty) ||
    !Number.isInteger(reworkQty) ||
    inputQty < 0 ||
    goodQty < 0 ||
    rejectQty < 0 ||
    reworkQty < 0
  ) {
    throw new Error('Kuantitas progres produksi harus bilangan bulat >= 0.');
  }
  if (goodQty + rejectQty + reworkQty > inputQty && inputQty > 0) {
    throw new Error('Total good + reject + rework tidak boleh melebihi input tahap.');
  }

  // Model baru produksi bertahap: potong -> setoran bertahap -> reject terpisah
  if (stage === 'potong') {
    return {
      nextWipQty: currentWipQty + goodQty,
      finishedGoodsDelta: 0,
      nextStage: 'setoran',
    };
  }
  if (stage === 'setoran') {
    if (goodQty <= 0) {
      throw new Error('Jumlah setoran ke gudang harus > 0.');
    }
    if (goodQty > currentWipQty) {
      throw new Error(`Setoran (${goodQty}) melebihi sisa WIP (${currentWipQty}).`);
    }
    const remaining = currentWipQty - goodQty;
    return {
      nextWipQty: remaining,
      finishedGoodsDelta: goodQty,
      nextStage: remaining === 0 ? 'completed' : 'setoran',
    };
  }
  if (stage === 'reject') {
    if (rejectQty <= 0) {
      throw new Error('Jumlah reject harus > 0.');
    }
    if (rejectQty > currentWipQty) {
      throw new Error(`Jumlah reject (${rejectQty}) melebihi sisa WIP (${currentWipQty}).`);
    }
    const remaining = currentWipQty - rejectQty;
    return {
      nextWipQty: remaining,
      finishedGoodsDelta: 0,
      nextStage: remaining === 0 ? 'completed' : 'setoran',
    };
  }

  // Fallback tahap lama agar data historis tetap aman dibaca/dijalankan
  if (stage === 'cutting') {
    return {
      nextWipQty: currentWipQty + goodQty,
      finishedGoodsDelta: 0,
      nextStage: 'sewing',
    };
  }
  if (stage === 'sewing') {
    return {
      nextWipQty: Math.max(0, currentWipQty - rejectQty),
      finishedGoodsDelta: 0,
      nextStage: 'qc',
    };
  }
  if (stage === 'qc') {
    return {
      nextWipQty: Math.max(0, currentWipQty - rejectQty),
      finishedGoodsDelta: 0,
      nextStage: 'packing',
    };
  }
  const released = Math.min(currentWipQty, goodQty);
  const remaining = Math.max(0, currentWipQty - released - rejectQty);
  return {
    nextWipQty: remaining,
    finishedGoodsDelta: goodQty,
    nextStage: remaining === 0 && goodQty > 0 ? 'completed' : 'packing',
  };
}

export function reconstructBalancesFromLedger(
  entries: StockLedgerEntry[],
): Record<string, number> {
  const balances: Record<string, number> = {};
  for (const entry of entries) {
    balances[entry.itemId] = (balances[entry.itemId] ?? 0) + entry.qty;
  }
  return balances;
}

/**
 * Menghitung harga rata-rata tertimbang bahan (float per cm/pcs), HPP Resep, WIP, Barang Jadi,
 * HPP Penjualan, Beban Reject, dan Akrual Upah Standar.
 * Pembulatan hanya dilakukan pada hasil akhir baris/total tanpa angka plug.
 */
export function calculateWeightedAverageCosts(params: {
  ledgerEntries: StockLedgerEntry[];
  purchaseCosts: PurchaseCost[];
  productionCosts: ProductionCost[];
  workOrders: WorkOrder[];
  bomItems: BomItem[];
  wagePayouts?: WagePayout[];
  products?: Product[];
  periodFilter?: string;
}): WeightedCostResult {
  const {
    ledgerEntries,
    purchaseCosts,
    productionCosts,
    workOrders,
    bomItems,
    wagePayouts = [],
    products = [],
    periodFilter,
  } = params;

  // 1. Weighted average cost bahan baku (float murni per cm/pcs) dari purchase_costs
  const matQtySum: Record<string, number> = {};
  const matCostSum: Record<string, number> = {};
  for (const pc of purchaseCosts) {
    matQtySum[pc.itemId] = (matQtySum[pc.itemId] ?? 0) + pc.qty;
    matCostSum[pc.itemId] = (matCostSum[pc.itemId] ?? 0) + pc.totalCost;
  }

  const materialUnitCostFloat: Record<string, number> = {};
  const materialUnitCost: Record<string, number> = {};
  for (const itemId of Object.keys(matQtySum)) {
    const qty = matQtySum[itemId];
    const floatCost = qty > 0 ? matCostSum[itemId] / qty : 0;
    materialUnitCostFloat[itemId] = floatCost;
    materialUnitCost[itemId] = Math.round(floatCost);
  }

  // 2. Resep HPP per produk (bahan float + biaya per pcs dari Resep)
  const productIds = new Set<string>();
  for (const p of products) productIds.add(p.id);
  for (const b of bomItems) productIds.add(b.productId);
  for (const w of workOrders) productIds.add(w.productId);

  const recipeHppByProduct: Record<string, RecipeHppBreakdown> = {};
  for (const productId of productIds) {
    recipeHppByProduct[productId] = calculateRecipeHpp({
      productId,
      bomItems,
      materialUnitCostFloat,
    });
  }

  // 3. Tracking bahan terpotong per WO dari ledger pemakaian_produksi
  const woById = new Map<string, WorkOrder>();
  for (const wo of workOrders) {
    woById.set(wo.id, wo);
  }

  const woCutMaterialCostFromLedger: Record<string, number> = {};
  for (const entry of ledgerEntries) {
    if (entry.jenis === 'pemakaian_produksi' && entry.refId && entry.qty < 0) {
      const unitFloat = materialUnitCostFloat[entry.itemId] ?? 0;
      woCutMaterialCostFromLedger[entry.refId] =
        (woCutMaterialCostFromLedger[entry.refId] ?? 0) + Math.abs(entry.qty) * unitFloat;
    }
  }

  // Legacy production_costs per WO (hanya untuk WO lama yang memakai production_costs langsung)
  const prodCostByWoId: Record<string, number> = {};
  for (const pc of productionCosts) {
    prodCostByWoId[pc.woId] = (prodCostByWoId[pc.woId] ?? 0) + pc.amount;
  }

  const woUnitMaterialCostFloat: Record<string, number> = {};
  const prodCostPoolByProduct: Record<string, number> = {};
  const prodCompletedQtyByProduct: Record<string, number> = {};
  let totalWipFloat = 0;
  let rejectExpenseFloat = 0;
  let accruedWagesEarnedFloat = 0;

  for (const wo of workOrders) {
    if (wo.status === 'cancelled') continue;
    const recipe = recipeHppByProduct[wo.productId];
    const ledgerMatCost = woCutMaterialCostFromLedger[wo.id];
    // Jika ledger pemakaian_produksi tercatat untuk WO ini, pakai nilai bahan persis dari ledger potong.
    // Jika tidak ada ledger (misal WO sintetis di test), pakai resep material * total unit diproses.
    const totalProcessedUnits = wo.targetQty > 0 ? wo.targetQty : wo.completedQty + wo.wipQty + (wo.rejectedQty ?? 0);
    const matUnitFloat =
      ledgerMatCost !== undefined
        ? totalProcessedUnits > 0
          ? ledgerMatCost / totalProcessedUnits
          : 0
        : recipe?.materialCostFloat ?? 0;

    woUnitMaterialCostFloat[wo.id] = matUnitFloat;

    if (wo.wipQty > 0) {
      totalWipFloat += wo.wipQty * matUnitFloat;
    }

    const rejectedUnits = wo.rejectedQty ?? 0;
    if (rejectedUnits > 0 && (!periodFilter || periodFromDate(wo.tanggal) === periodFilter)) {
      rejectExpenseFloat += rejectedUnits * matUnitFloat;
    }

    if (wo.completedQty > 0) {
      const recipeLaborPerPcs = recipe?.productionCostSum ?? 0;
      const legacyWoLabor = prodCostByWoId[wo.id] ?? 0;
      const completedMatCost = wo.completedQty * matUnitFloat;
      const completedLaborCost = wo.completedQty * recipeLaborPerPcs + legacyWoLabor;
      prodCompletedQtyByProduct[wo.productId] =
        (prodCompletedQtyByProduct[wo.productId] ?? 0) + wo.completedQty;
      prodCostPoolByProduct[wo.productId] =
        (prodCostPoolByProduct[wo.productId] ?? 0) + completedMatCost + completedLaborCost;
      accruedWagesEarnedFloat += wo.completedQty * recipeLaborPerPcs;
    }
  }

  const productUnitCostFloat: Record<string, number> = {};
  const productUnitCost: Record<string, number> = {};
  for (const productId of productIds) {
    const completedQty = prodCompletedQtyByProduct[productId] ?? 0;
    if (completedQty > 0) {
      const floatCost = (prodCostPoolByProduct[productId] ?? 0) / completedQty;
      productUnitCostFloat[productId] = floatCost;
      productUnitCost[productId] = Math.round(floatCost);
    } else {
      const fallbackHpp = recipeHppByProduct[productId]?.exactHppFloat ?? 0;
      productUnitCostFloat[productId] = fallbackHpp;
      productUnitCost[productId] = Math.round(fallbackHpp);
    }
  }

  // 4. Nilai stok akhir (termasuk produk minus), HPP penjualan & koreksi opname
  const balances = reconstructBalancesFromLedger(ledgerEntries);
  const itemTypes: Record<string, 'material' | 'product' | 'wip'> = {};
  let cogsFloat = 0;
  let opnameAdjustmentFloat = 0;

  for (const entry of ledgerEntries) {
    itemTypes[entry.itemId] = entry.itemType;
    const inPeriod = !periodFilter || periodFromDate(entry.tanggal) === periodFilter;
    if (!inPeriod) continue;

    if (entry.jenis === 'penjualan' && entry.qty < 0) {
      const unitCost = productUnitCostFloat[entry.itemId] ?? 0;
      cogsFloat += Math.abs(entry.qty) * unitCost;
    } else if (entry.jenis === 'retur' && entry.qty > 0) {
      const unitCost = productUnitCostFloat[entry.itemId] ?? 0;
      cogsFloat -= entry.qty * unitCost;
    } else if (entry.jenis === 'opname_koreksi' || (entry.jenis === 'reversal' && entry.refType !== 'void_sales_order')) {
      if (entry.itemType === 'material') {
        opnameAdjustmentFloat += entry.qty * (materialUnitCostFloat[entry.itemId] ?? 0);
      } else if (entry.itemType === 'product') {
        opnameAdjustmentFloat += entry.qty * (productUnitCostFloat[entry.itemId] ?? 0);
      }
    }
  }

  let totalMaterialFloat = 0;
  let totalProductFloat = 0;

  for (const [itemId, qty] of Object.entries(balances)) {
    const t = itemTypes[itemId];
    if (t === 'material') {
      if (qty > 0) {
        totalMaterialFloat += qty * (materialUnitCostFloat[itemId] ?? 0);
      }
    } else if (t === 'product') {
      // Produk boleh minus dan pengurangannya mempertahankan konsistensi Neraca sampai diopname
      totalProductFloat += qty * (productUnitCostFloat[itemId] ?? 0);
    }
  }

  const paidStandardWages = wagePayouts.reduce((sum, w) => sum + w.totalStandard, 0);
  const accruedWagesTotal = Math.round(accruedWagesEarnedFloat - paidStandardWages);

  const totalMaterialValue = Math.round(totalMaterialFloat);
  const totalWipValue = Math.round(totalWipFloat);
  const totalProductValue = Math.round(totalProductFloat);

  return {
    materialUnitCostFloat,
    materialUnitCost,
    productUnitCostFloat,
    productUnitCost,
    recipeHppByProduct,
    woUnitMaterialCostFloat,
    totalMaterialValue,
    totalWipValue,
    totalProductValue,
    totalInventoryValue: totalMaterialValue + totalWipValue + totalProductValue,
    cogsTotal: Math.round(cogsFloat),
    rejectExpenseTotal: Math.round(rejectExpenseFloat),
    accruedWagesTotal,
    opnameAdjustmentTotal: Math.round(opnameAdjustmentFloat),
  };
}

export function computeProfitAndLoss(params: {
  salesOrders: SalesOrder[];
  returns: SalesReturn[];
  operatingExpenses: OperatingExpense[];
  hppTotal: number;
  rejectExpenseTotal?: number;
  wagePayouts?: WagePayout[];
  opnameAdjustmentTotal?: number;
  periodFilter?: string;
}): ProfitLossReport {
  const {
    salesOrders,
    returns,
    operatingExpenses,
    hppTotal,
    rejectExpenseTotal = 0,
    wagePayouts = [],
    opnameAdjustmentTotal = 0,
    periodFilter,
  } = params;

  const activeOrders = salesOrders.filter(
    (so) => so.status === 'active' && (!periodFilter || periodFromDate(so.tanggal) === periodFilter),
  );

  const grossSales = activeOrders.reduce((sum, so) => sum + so.totalAmount, 0);
  const marketplaceFeesTotal = activeOrders.reduce(
    (sum, so) => sum + (so.biayaAdmin ?? 0) + (so.komisiAffiliate ?? 0) + (so.potonganLain ?? 0),
    0,
  );

  const returnsTotal = returns
    .filter((ret) => !periodFilter || periodFromDate(ret.tanggal) === periodFilter)
    .reduce((sum, ret) => sum + ret.refundAmount, 0);

  const netSales = grossSales - marketplaceFeesTotal - returnsTotal;
  const grossProfit = netSales - hppTotal;

  const wageVarianceTotal = wagePayouts
    .filter((w) => !periodFilter || periodFromDate(w.tanggal) === periodFilter)
    .reduce((sum, w) => sum + w.variance, 0);

  const operatingExpensesTotal = operatingExpenses
    .filter((exp) => !periodFilter || periodFromDate(exp.tanggal) === periodFilter)
    .reduce((sum, exp) => sum + exp.amount, 0);

  const netProfit =
    grossProfit - rejectExpenseTotal - wageVarianceTotal - operatingExpensesTotal + opnameAdjustmentTotal;
  const marginPercent = netSales > 0 ? Math.round((netProfit / netSales) * 100) : 0;

  return {
    grossSales,
    marketplaceFeesTotal,
    returnsTotal,
    netSales,
    hppTotal,
    grossProfit,
    rejectExpenseTotal,
    wageVarianceTotal,
    opnameAdjustmentTotal,
    operatingExpensesTotal,
    netProfit,
    marginPercent,
  };
}

/**
 * Laporan Arus Kas murni pergerakan uang masuk/keluar akun kas & bank.
 * Saldo Marketplace yang belum dicairkan TIDAK masuk Arus Kas sampai dicairkan.
 */
export function computeCashFlowReport(params: {
  accounts: Account[];
  marketplacePayouts: MarketplacePayout[];
  payments: Payment[];
  purchaseCosts: PurchaseCost[];
  productionCosts: ProductionCost[];
  wagePayouts: WagePayout[];
  operatingExpenses: OperatingExpense[];
  journalEntries: JournalEntry[];
  periodFilter?: string;
}): CashFlowReport {
  const {
    accounts,
    marketplacePayouts,
    payments,
    purchaseCosts,
    productionCosts,
    wagePayouts,
    operatingExpenses,
    journalEntries,
    periodFilter,
  } = params;

  const inPeriod = (tanggal: string) => !periodFilter || periodFromDate(tanggal) === periodFilter;

  const openingCashBank = accounts.reduce((sum, a) => sum + a.saldoAwal, 0);
  const recordedCashBank = accounts.reduce((sum, a) => sum + a.saldoBerjalan, 0);

  const marketplacePayoutInflows = marketplacePayouts
    .filter((p) => inPeriod(p.tanggal))
    .reduce((sum, p) => sum + p.amount, 0);

  const directSalesPaymentInflows = payments
    .filter((p) => Boolean(p.accountId) && inPeriod(p.tanggal))
    .reduce((sum, p) => sum + p.amount, 0);

  const totalCashInflows = marketplacePayoutInflows + directSalesPaymentInflows;

  const purchaseCashOutflows = purchaseCosts
    .filter((pc) => Boolean(pc.accountId) && pc.paidAmount > 0 && inPeriod(pc.tanggal))
    .reduce((sum, pc) => sum + pc.paidAmount, 0);

  const productionCashOutflows = productionCosts
    .filter((pr) => Boolean(pr.accountId) && pr.paidAmount > 0 && inPeriod(pr.tanggal))
    .reduce((sum, pr) => sum + pr.paidAmount, 0);

  const wagePayoutCashOutflows = wagePayouts
    .filter((w) => Boolean(w.accountId) && w.totalPaid > 0 && inPeriod(w.tanggal))
    .reduce((sum, w) => sum + w.totalPaid, 0);

  const apSettlementCashOutflows = journalEntries
    .filter((j) => j.source === 'ap_payment' && Boolean(j.accountId) && inPeriod(j.tanggal))
    .reduce((sum, j) => sum + j.amount, 0);

  const operatingExpenseCashOutflows = operatingExpenses
    .filter((ex) => Boolean(ex.accountId) && inPeriod(ex.tanggal))
    .reduce((sum, ex) => sum + ex.amount, 0);

  const totalCashOutflows =
    purchaseCashOutflows +
    productionCashOutflows +
    wagePayoutCashOutflows +
    apSettlementCashOutflows +
    operatingExpenseCashOutflows;

  const netCashChange = totalCashInflows - totalCashOutflows;
  const endingCashBank = openingCashBank + netCashChange;

  return {
    openingCashBank,
    marketplacePayoutInflows,
    directSalesPaymentInflows,
    totalCashInflows,
    purchaseCashOutflows,
    productionCashOutflows,
    wagePayoutCashOutflows,
    apSettlementCashOutflows,
    operatingExpenseCashOutflows,
    totalCashOutflows,
    netCashChange,
    endingCashBank,
    recordedCashBank,
  };
}

/**
 * Neraca kumulatif Aset == Liabilitas + Ekuitas TANPA angka plug.
 * Selisih dihitung apa adanya agar pemilik dapat melihat jika Modal Awal belum diisi atau ada ketidakseimbangan.
 */
export function computeBalanceSheet(params: {
  accounts: Account[];
  marketplaceChannels: MarketplaceChannel[];
  salesOrders: SalesOrder[];
  returns: SalesReturn[];
  marketplacePayouts: MarketplacePayout[];
  purchaseCosts: PurchaseCost[];
  productionCosts: ProductionCost[];
  journalEntries: JournalEntry[];
  costs: WeightedCostResult;
  profitLoss: ProfitLossReport;
  modalAwal: number | null;
}): BalanceSheetReport {
  const {
    accounts,
    marketplaceChannels,
    salesOrders,
    returns,
    purchaseCosts,
    productionCosts,
    journalEntries,
    costs,
    profitLoss,
    modalAwal,
  } = params;

  const kasBalance = accounts
    .filter((a) => a.tipe === 'kas')
    .reduce((sum, a) => sum + a.saldoBerjalan, 0);
  const bankBalance = accounts
    .filter((a) => a.tipe === 'bank')
    .reduce((sum, a) => sum + a.saldoBerjalan, 0);

  const marketplaceBalance = marketplaceChannels.reduce((sum, ch) => sum + ch.balance, 0);

  // Piutang legacy (bila masih ada SO non-marketplace yang belum lunas)
  const receivablesBalance = salesOrders
    .filter((so) => so.status === 'active' && so.penerimaanBersih === undefined)
    .reduce((sum, so) => sum + Math.max(0, so.totalAmount - so.paidAmount), 0);

  const materialInventoryValue = costs.totalMaterialValue;
  const wipInventoryValue = costs.totalWipValue;
  const productInventoryValue = costs.totalProductValue;

  const totalAssets =
    kasBalance +
    bankBalance +
    marketplaceBalance +
    receivablesBalance +
    materialInventoryValue +
    wipInventoryValue +
    productInventoryValue;

  const apPaidMap: Record<string, number> = {};
  for (const j of journalEntries) {
    if (j.source === 'ap_payment' && j.refId) {
      apPaidMap[j.refId] = (apPaidMap[j.refId] ?? 0) + j.amount;
    }
  }

  const supplierPayables = purchaseCosts.reduce((sum, pc) => {
    const settled = apPaidMap[pc.id] ?? 0;
    return sum + Math.max(0, pc.totalCost - pc.paidAmount - settled);
  }, 0);

  const productionPayables = productionCosts.reduce((sum, pr) => {
    const settled = apPaidMap[pr.id] ?? 0;
    return sum + Math.max(0, pr.amount - pr.paidAmount - settled);
  }, 0);

  // Jika ada retur pada periode berbeda tanpa penurunan saldo channel legacy, netProfit sudah dikurangi returns.
  void returns;

  const accruedWages = costs.accruedWagesTotal;
  const totalLiabilities = supplierPayables + productionPayables + accruedWages;

  const modalAwalUsed = modalAwal ?? 0;
  const retainedEarnings = profitLoss.netProfit;
  const totalEquity = modalAwalUsed + retainedEarnings;

  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
  const selisih = totalAssets - totalLiabilitiesAndEquity;

  return {
    kasBalance,
    bankBalance,
    marketplaceBalance,
    receivablesBalance,
    materialInventoryValue,
    wipInventoryValue,
    productInventoryValue,
    totalAssets,
    supplierPayables,
    productionPayables,
    accruedWages,
    totalLiabilities,
    modalAwal,
    modalAwalUsed,
    retainedEarnings,
    totalEquity,
    totalLiabilitiesAndEquity,
    selisih,
    isBalanced: selisih === 0,
  };
}

/**
 * Menghitung rekap upah mingguan berdasarkan hasil setoran ke gudang pada rentang tanggal
 * dikalikan tarif upah jahit/cutting, sablon, dan packing pada Resep produk.
 */
export function computeWeeklyWagesSummary(params: {
  startDate: string;
  endDate: string;
  workOrders: WorkOrder[];
  stageLogsByWoId: Record<string, StageLog[]>;
  bomItems: BomItem[];
  products: Product[];
  wagePayouts?: WagePayout[];
}): WeeklyWagesSummary {
  const { startDate, endDate, workOrders, stageLogsByWoId, bomItems, products, wagePayouts = [] } = params;

  const productById = new Map<string, Product>();
  for (const p of products) {
    productById.set(p.id, p);
  }

  const setoranByProduct = new Map<string, number>();
  for (const wo of workOrders) {
    if (wo.status === 'cancelled') continue;
    const logs = stageLogsByWoId[wo.id] ?? [];
    for (const log of logs) {
      if (log.tanggal < startDate || log.tanggal > endDate) continue;
      if ((log.stage === 'setoran' || log.stage === 'packing') && log.goodQty > 0) {
        setoranByProduct.set(wo.productId, (setoranByProduct.get(wo.productId) ?? 0) + log.goodQty);
      }
    }
  }

  const rows: WeeklyWageProductRow[] = [];
  let totalSetoranQty = 0;
  let jahitCuttingStandard = 0;
  let sablonStandard = 0;
  let packingStandard = 0;
  let lainnyaStandard = 0;

  for (const [productId, setoranQty] of setoranByProduct.entries()) {
    const prod = productById.get(productId);
    const recipe = calculateRecipeHpp({
      productId,
      bomItems,
      materialUnitCostFloat: {},
    });

    const jahitCuttingAmount = setoranQty * recipe.jahitCuttingPerPcs;
    const sablonAmount = setoranQty * recipe.sablonPerPcs;
    const packingAmount = setoranQty * recipe.packingPerPcs;
    const lainnyaAmount = setoranQty * recipe.lainnyaPerPcs;
    const totalStandard = jahitCuttingAmount + sablonAmount + packingAmount + lainnyaAmount;

    totalSetoranQty += setoranQty;
    jahitCuttingStandard += jahitCuttingAmount;
    sablonStandard += sablonAmount;
    packingStandard += packingAmount;
    lainnyaStandard += lainnyaAmount;

    rows.push({
      productId,
      sku: prod?.sku ?? productId,
      productName: prod?.nama ?? productId,
      setoranQty,
      jahitCuttingRate: recipe.jahitCuttingPerPcs,
      sablonRate: recipe.sablonPerPcs,
      packingRate: recipe.packingPerPcs,
      lainnyaRate: recipe.lainnyaPerPcs,
      jahitCuttingAmount,
      sablonAmount,
      packingAmount,
      lainnyaAmount,
      totalStandard,
    });
  }

  rows.sort((a, b) => b.totalStandard - a.totalStandard);

  const matchingPayouts = wagePayouts.filter(
    (w) => w.startDate <= endDate && w.endDate >= startDate,
  );
  const totalAlreadyPaid = matchingPayouts.reduce((sum, w) => sum + w.totalPaid, 0);
  const totalVarianceRecorded = matchingPayouts.reduce((sum, w) => sum + w.variance, 0);

  return {
    startDate,
    endDate,
    rows,
    totalSetoranQty,
    jahitCuttingStandard,
    sablonStandard,
    packingStandard,
    lainnyaStandard,
    totalStandard: jahitCuttingStandard + sablonStandard + packingStandard + lainnyaStandard,
    totalAlreadyPaid,
    totalVarianceRecorded,
  };
}

export function computeProductionEfficiency(params: {
  workOrders: WorkOrder[];
  stageLogs: StageLog[];
}): ProductionEfficiencyReport {
  const { workOrders, stageLogs } = params;
  const stages: ProductionStage[] = ['potong', 'setoran', 'reject'];

  const stageMap = new Map<ProductionStage, { input: number; good: number; reject: number; rework: number }>();
  for (const s of stages) {
    stageMap.set(s, { input: 0, good: 0, reject: 0, rework: 0 });
  }

  for (const log of stageLogs) {
    const mappedStage: ProductionStage =
      log.stage === 'cutting'
        ? 'potong'
        : log.stage === 'packing'
          ? 'setoran'
          : log.stage === 'sewing' || log.stage === 'qc'
            ? (log.rejectQty > 0 ? 'reject' : 'setoran')
            : log.stage;
    const bucket = stageMap.get(mappedStage);
    if (!bucket) continue;
    bucket.input += log.inputQty;
    bucket.good += log.goodQty;
    bucket.reject += log.rejectQty;
    bucket.rework += log.reworkQty;
  }

  const stageMetrics: StageEfficiencyMetric[] = stages.map((stage) => {
    const b = stageMap.get(stage)!;
    const denom = b.input > 0 ? b.input : b.good + b.reject;
    const rejectPercent = denom > 0 ? Math.round((b.reject / denom) * 100) : 0;
    return {
      stage,
      totalInput: b.input,
      totalGood: b.good,
      totalReject: b.reject,
      totalRework: b.rework,
      rejectPercent,
    };
  });

  const completed = workOrders.filter((w) => w.status === 'completed');
  let leadTimeSum = 0;
  let leadTimeCount = 0;
  for (const wo of completed) {
    if (wo.completedAt && typeof wo.completedAt === 'object' && 'toDate' in wo.completedAt) {
      const start = new Date(`${wo.tanggal}T00:00:00+07:00`).getTime();
      const end = (wo.completedAt as { toDate: () => Date }).toDate().getTime();
      if (end >= start) {
        leadTimeSum += Math.max(1, Math.round((end - start) / 86_400_000));
        leadTimeCount += 1;
      }
    }
  }

  const activeWipQty = workOrders
    .filter((w) => w.status === 'in_progress')
    .reduce((sum, w) => sum + w.wipQty, 0);

  const totalRejectedQty = workOrders.reduce((sum, w) => sum + (w.rejectedQty ?? 0), 0);

  return {
    totalWorkOrders: workOrders.length,
    completedWorkOrders: completed.length,
    activeWipQty,
    totalRejectedQty,
    averageLeadTimeDays: leadTimeCount > 0 ? Math.round(leadTimeSum / leadTimeCount) : 0,
    stageMetrics,
  };
}

function extractTimestampMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object') {
    const obj = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof obj.toMillis === 'function') return obj.toMillis();
    if (typeof obj.toDate === 'function') return obj.toDate().getTime();
    if (typeof obj.seconds === 'number') {
      return obj.seconds * 1000 + Math.round((obj.nanoseconds ?? 0) / 1_000_000);
    }
  }
  return null;
}

export interface IntegrityCheckInput {
  accounts?: Account[];
  marketplaceChannels?: MarketplaceChannel[];
  marketplacePayouts?: MarketplacePayout[];
  wagePayouts?: WagePayout[];
  balances: StockBalance[];
  ledgerEntries: StockLedgerEntry[];
  salesOrders: SalesOrder[];
  soItemsByOrderId: Record<string, SalesOrderItem[]>;
  payments?: Payment[];
  salesReturns?: SalesReturn[];
  purchaseCosts?: PurchaseCost[];
  productionCosts?: ProductionCost[];
  operatingExpenses?: OperatingExpense[];
  journalEntries?: JournalEntry[];
  workOrders?: WorkOrder[];
  stageLogsByWoId?: Record<string, StageLog[]>;
  periods?: PeriodDoc[];
  products?: Product[];
  itemLabels: Record<string, string>;
  scopeMode?: 'all' | 'two_months';
  extraLookup?: {
    salesOrders?: SalesOrder[];
    payments?: Payment[];
    salesReturns?: SalesReturn[];
    workOrders?: WorkOrder[];
  };
}

export function computeIntegrityDiscrepancies(params: IntegrityCheckInput): IntegrityDiscrepancy[] {
  const {
    accounts = [],
    marketplaceChannels = [],
    marketplacePayouts = [],
    wagePayouts = [],
    balances,
    ledgerEntries,
    salesOrders,
    soItemsByOrderId,
    payments = [],
    salesReturns = [],
    purchaseCosts = [],
    productionCosts = [],
    operatingExpenses = [],
    journalEntries = [],
    workOrders = [],
    stageLogsByWoId,
    periods = [],
    itemLabels,
    scopeMode = 'all',
    extraLookup,
  } = params;
  const discrepancies: IntegrityDiscrepancy[] = [];
  const isPartialScope = scopeMode === 'two_months';

  // 1. Kas/Bank: accounts.saldoBerjalan vs saldoAwal + arus kas masuk/keluar
  if (!isPartialScope && accounts.length > 0) {
    const cashDeltaByAccount: Record<string, number> = {};
    for (const p of payments) {
      if (!p.accountId) continue;
      cashDeltaByAccount[p.accountId] = (cashDeltaByAccount[p.accountId] ?? 0) + p.amount;
    }
    for (const mp of marketplacePayouts) {
      if (!mp.accountId) continue;
      cashDeltaByAccount[mp.accountId] = (cashDeltaByAccount[mp.accountId] ?? 0) + mp.amount;
    }
    for (const pc of purchaseCosts) {
      if (!pc.accountId || pc.paidAmount <= 0) continue;
      cashDeltaByAccount[pc.accountId] = (cashDeltaByAccount[pc.accountId] ?? 0) - pc.paidAmount;
    }
    for (const pr of productionCosts) {
      if (!pr.accountId || pr.paidAmount <= 0) continue;
      cashDeltaByAccount[pr.accountId] = (cashDeltaByAccount[pr.accountId] ?? 0) - pr.paidAmount;
    }
    for (const wp of wagePayouts) {
      if (!wp.accountId || wp.totalPaid <= 0) continue;
      cashDeltaByAccount[wp.accountId] = (cashDeltaByAccount[wp.accountId] ?? 0) - wp.totalPaid;
    }
    for (const ex of operatingExpenses) {
      if (!ex.accountId) continue;
      cashDeltaByAccount[ex.accountId] = (cashDeltaByAccount[ex.accountId] ?? 0) - ex.amount;
    }
    for (const j of journalEntries) {
      if (j.source === 'ap_payment' && j.accountId) {
        cashDeltaByAccount[j.accountId] = (cashDeltaByAccount[j.accountId] ?? 0) - j.amount;
      }
    }

    for (const acc of accounts) {
      const expected = acc.saldoAwal + (cashDeltaByAccount[acc.id] ?? 0);
      if (acc.saldoBerjalan !== expected) {
        discrepancies.push({
          kind: 'cash_balance',
          id: acc.id,
          label: `${acc.nama} (${acc.tipe.toUpperCase()})`,
          recordedValue: acc.saldoBerjalan,
          recalculatedValue: expected,
          difference: acc.saldoBerjalan - expected,
          unit: 'rupiah',
          detail: `Dokumen accounts/${acc.id}: saldoAwal (${acc.saldoAwal}) + mutasi kas tidak cocok dengan saldoBerjalan.`,
        });
      }
    }
  }

  // 1b. Saldo Marketplace per channel vs SO penerimaanBersih - retur - pencairan
  if (!isPartialScope && marketplaceChannels.length > 0) {
    const channelByName = new Map<string, MarketplaceChannel>();
    const expectedBalByChannelId: Record<string, number> = {};
    for (const ch of marketplaceChannels) {
      channelByName.set(ch.nama.toLowerCase(), ch);
      expectedBalByChannelId[ch.id] = 0;
    }
    const soMap = new Map<string, SalesOrder>();
    for (const so of salesOrders) {
      soMap.set(so.id, so);
      if (so.status !== 'active' || so.penerimaanBersih === undefined) continue;
      const ch = channelByName.get(so.channel.toLowerCase());
      if (ch) {
        expectedBalByChannelId[ch.id] += so.penerimaanBersih;
      }
    }
    for (const ret of salesReturns) {
      const so = soMap.get(ret.soId);
      if (!so || so.penerimaanBersih === undefined) continue;
      const ch = channelByName.get(so.channel.toLowerCase());
      if (ch) {
        expectedBalByChannelId[ch.id] -= ret.refundAmount;
      }
    }
    for (const mp of marketplacePayouts) {
      if (expectedBalByChannelId[mp.channelId] !== undefined) {
        expectedBalByChannelId[mp.channelId] -= mp.amount;
      }
    }
    for (const ch of marketplaceChannels) {
      const expected = expectedBalByChannelId[ch.id] ?? 0;
      if (ch.balance !== expected) {
        discrepancies.push({
          kind: 'marketplace_balance',
          id: ch.id,
          label: `Saldo Marketplace ${ch.nama}`,
          recordedValue: ch.balance,
          recalculatedValue: expected,
          difference: ch.balance - expected,
          unit: 'rupiah',
          detail: `Saldo marketplace_channels/${ch.id} (${ch.balance}) ≠ penerimaan bersih - retur - pencairan (${expected}).`,
        });
      }
    }
  }

  // 2 & 3. Stok: stock_balances vs stock_ledger + deteksi orphan dua arah
  const recalculated = reconstructBalancesFromLedger(ledgerEntries);
  if (!isPartialScope) {
    const balanceByItemId = new Map<string, StockBalance>();
    for (const b of balances) {
      balanceByItemId.set(b.itemId, b);
    }
    const ledgerById = new Map<string, StockLedgerEntry>();
    const ledgerCountByItem = new Map<string, number>();
    for (const entry of ledgerEntries) {
      ledgerById.set(entry.id, entry);
      ledgerCountByItem.set(entry.itemId, (ledgerCountByItem.get(entry.itemId) ?? 0) + 1);
    }

    const allItemIds = new Set<string>([
      ...balances.map((b) => b.itemId),
      ...Object.keys(recalculated),
    ]);

    for (const itemId of allItemIds) {
      const balDoc = balanceByItemId.get(itemId);
      const recorded = balDoc?.qty ?? 0;
      const expected = recalculated[itemId] ?? 0;
      if (recorded !== expected) {
        discrepancies.push({
          kind: 'stock_balance',
          id: itemId,
          label: itemLabels[itemId] ?? itemId,
          recordedValue: recorded,
          recalculatedValue: expected,
          difference: recorded - expected,
          unit: 'qty',
          detail: `Dokumen stock_balances/${itemId} tidak sama dengan jumlah mutasi stock_ledger.`,
        });
      }

      const ledgerCount = ledgerCountByItem.get(itemId) ?? 0;
      if (ledgerCount > 0 && !balDoc) {
        discrepancies.push({
          kind: 'orphan_stock_ledger',
          id: itemId,
          label: itemLabels[itemId] ?? itemId,
          recordedValue: 0,
          recalculatedValue: expected,
          difference: -expected,
          unit: 'qty',
          detail: `Terdapat ${ledgerCount} entri stock_ledger untuk item ini tanpa dokumen stock_balances/${itemId}.`,
        });
      }
    }

    for (const bal of balances) {
      const itemLabel = itemLabels[bal.itemId] ?? bal.itemId;
      const ledgerCount = ledgerCountByItem.get(bal.itemId) ?? 0;
      const lastLedger = bal.lastLedgerId ? ledgerById.get(bal.lastLedgerId) : undefined;
      if (ledgerCount === 0) {
        discrepancies.push({
          kind: 'orphan_stock_balance',
          id: bal.id,
          label: itemLabel,
          recordedValue: bal.qty,
          recalculatedValue: 0,
          difference: bal.qty,
          unit: 'qty',
          detail: `Dokumen stock_balances/${bal.id} tidak memiliki entri stock_ledger sama sekali.`,
        });
      } else if (!lastLedger) {
        discrepancies.push({
          kind: 'orphan_stock_balance',
          id: bal.id,
          label: itemLabel,
          recordedValue: bal.qty,
          recalculatedValue: recalculated[bal.itemId] ?? 0,
          difference: bal.qty - (recalculated[bal.itemId] ?? 0),
          unit: 'qty',
          detail: `lastLedgerId "${bal.lastLedgerId || '-'}" pada stock_balances/${bal.id} tidak ditemukan di stock_ledger.`,
        });
      } else if (lastLedger.itemId !== bal.itemId) {
        discrepancies.push({
          kind: 'orphan_stock_balance',
          id: bal.id,
          label: itemLabel,
          recordedValue: bal.qty,
          recalculatedValue: lastLedger.balance_after,
          difference: bal.qty - lastLedger.balance_after,
          unit: 'qty',
          detail: `lastLedgerId "${lastLedger.id}" menunjuk item ${lastLedger.itemId}, tidak cocok dengan stock_balances/${bal.id}.`,
        });
      }
    }
  }

  // 4 & 5. Sales Orders
  const paymentSumBySo: Record<string, number> = {};
  const paymentCountBySo: Record<string, number> = {};
  for (const pay of payments) {
    paymentSumBySo[pay.soId] = (paymentSumBySo[pay.soId] ?? 0) + pay.amount;
    paymentCountBySo[pay.soId] = (paymentCountBySo[pay.soId] ?? 0) + 1;
  }

  for (const so of salesOrders) {
    const lines = soItemsByOrderId[so.id];
    if (lines) {
      const expectedTotal = lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
      if (so.totalAmount !== expectedTotal) {
        discrepancies.push({
          kind: 'sales_order_total',
          id: so.id,
          label: `${so.soNumber} (${so.id})`,
          recordedValue: so.totalAmount,
          recalculatedValue: expectedTotal,
          difference: so.totalAmount - expectedTotal,
          unit: 'rupiah',
          detail: `Total SO tidak sama dengan penjumlahan subkoleksi sales_orders/${so.id}/items.`,
        });
      }
    }

    // Pada SO marketplace (penerimaanBersih !== undefined), paidAmount dicatat penuh sebagai saldo marketplace tanpa payments dokumen
    if (so.penerimaanBersih === undefined && (payments.length > 0 || so.paidAmount > 0)) {
      const sumPaid = paymentSumBySo[so.id] ?? 0;
      if (so.paidAmount !== sumPaid) {
        discrepancies.push({
          kind: 'sales_order_payment',
          id: so.id,
          label: `${so.soNumber} (${so.id})`,
          recordedValue: so.paidAmount,
          recalculatedValue: sumPaid,
          difference: so.paidAmount - sumPaid,
          unit: 'rupiah',
          detail: `paidAmount pada sales_orders/${so.id} tidak cocok dengan total ${paymentCountBySo[so.id] ?? 0} dokumen payments.`,
        });
      }

      const expectedStatus: PaymentStatus =
        sumPaid <= 0 ? 'unpaid' : sumPaid >= so.totalAmount ? 'paid' : 'dp';
      if (so.paymentStatus !== expectedStatus) {
        const statusRank = (s: PaymentStatus) => (s === 'unpaid' ? 0 : s === 'dp' ? 1 : 2);
        discrepancies.push({
          kind: 'sales_order_payment_status',
          id: so.id,
          label: `${so.soNumber} (${so.id})`,
          recordedValue: statusRank(so.paymentStatus),
          recalculatedValue: statusRank(expectedStatus),
          difference: statusRank(so.paymentStatus) - statusRank(expectedStatus),
          unit: 'status',
          detail: `paymentStatus tercatat "${so.paymentStatus}", seharusnya "${expectedStatus}".`,
        });
      }
    }
  }

  // 6. Transaksi bertanggal di periode closed yang dibuat setelah period.updatedAt
  const closedPeriodUpdatedMs = new Map<string, number>();
  for (const p of periods) {
    if (!p.closed) continue;
    const ms = extractTimestampMs(p.updatedAt);
    if (ms !== null) {
      closedPeriodUpdatedMs.set(p.id, ms);
    }
  }

  if (closedPeriodUpdatedMs.size > 0) {
    const inspectClosedPeriodTx = (
      colName: string,
      docId: string,
      label: string,
      tanggal: string,
      createdAt: unknown,
    ) => {
      if (!tanggal || tanggal.length < 7) return;
      const periodId = periodFromDate(tanggal);
      const closedMs = closedPeriodUpdatedMs.get(periodId);
      const txMs = extractTimestampMs(createdAt);
      if (closedMs !== undefined && txMs !== null && txMs > closedMs) {
        const diffSec = Math.max(1, Math.round((txMs - closedMs) / 1000));
        discrepancies.push({
          kind: 'closed_period_tx',
          id: `${colName}-${docId}`,
          label: `[${colName}] ${label}`,
          recordedValue: txMs,
          recalculatedValue: closedMs,
          difference: diffSec,
          unit: 'seconds',
          detail: `Dokumen ${colName}/${docId} bertanggal ${tanggal} dibuat ${diffSec} detik setelah periode ${periodId} ditutup.`,
        });
      }
    };

    for (const l of ledgerEntries) {
      inspectClosedPeriodTx('stock_ledger', l.id, `${itemLabels[l.itemId] ?? l.itemId} (${l.jenis})`, l.tanggal, l.createdAt);
    }
    for (const wo of workOrders) {
      inspectClosedPeriodTx('work_orders', wo.id, wo.woNumber, wo.tanggal, wo.createdAt);
    }
    for (const so of salesOrders) {
      inspectClosedPeriodTx('sales_orders', so.id, so.soNumber, so.tanggal, so.createdAt);
    }
    for (const p of payments) {
      inspectClosedPeriodTx('payments', p.id, `${p.soNumber} (${p.amount})`, p.tanggal, p.createdAt);
    }
    for (const r of salesReturns) {
      inspectClosedPeriodTx('sales_returns', r.id, r.soNumber, r.tanggal, r.createdAt);
    }
    for (const pc of purchaseCosts) {
      inspectClosedPeriodTx('purchase_costs', pc.id, pc.itemId, pc.tanggal, pc.createdAt);
    }
    for (const pr of productionCosts) {
      inspectClosedPeriodTx('production_costs', pr.id, pr.woNumber, pr.tanggal, pr.createdAt);
    }
    for (const mp of marketplacePayouts) {
      inspectClosedPeriodTx('marketplace_payouts', mp.id, mp.channelName, mp.tanggal, mp.createdAt);
    }
    for (const wp of wagePayouts) {
      inspectClosedPeriodTx('wage_payouts', wp.id, `${wp.startDate}..${wp.endDate}`, wp.tanggal, wp.createdAt);
    }
    for (const ex of operatingExpenses) {
      inspectClosedPeriodTx('operating_expenses', ex.id, ex.kategori, ex.tanggal, ex.createdAt);
    }
    for (const j of journalEntries) {
      inspectClosedPeriodTx('journal_entries', j.id, j.deskripsi || j.source, j.tanggal, j.createdAt);
    }
  }

  // 7. journal_entries balance check
  for (const j of journalEntries) {
    const debitVal = j.debitAmount ?? j.amount;
    const creditVal = j.creditAmount ?? j.amount;
    const reasons: string[] = [];
    if (!Number.isInteger(j.amount) || j.amount < 0) {
      reasons.push(`nominal amount (${j.amount}) tidak valid`);
    }
    if (debitVal !== creditVal || debitVal !== j.amount) {
      reasons.push(`debit (${debitVal}) ≠ kredit (${creditVal}) / amount (${j.amount})`);
    }
    if (!j.debitAccount || !j.creditAccount) {
      reasons.push('akun debit/kredit kosong');
    } else if (j.debitAccount === j.creditAccount) {
      reasons.push(`akun debit dan kredit sama (${j.debitAccount})`);
    }

    if (reasons.length > 0) {
      discrepancies.push({
        kind: 'journal_imbalance',
        id: j.id,
        label: `${j.tanggal} · ${j.deskripsi || j.id}`,
        recordedValue: debitVal,
        recalculatedValue: creditVal,
        difference: debitVal - creditVal,
        unit: 'rupiah',
        detail: `Dokumen journal_entries/${j.id}: ${reasons.join('; ')}.`,
      });
    }
  }

  // 8. Peta referensi lintas periode
  const salesOrderById = new Map<string, SalesOrder>();
  for (const so of extraLookup?.salesOrders ?? []) salesOrderById.set(so.id, so);
  for (const so of salesOrders) salesOrderById.set(so.id, so);

  const paymentById = new Map<string, Payment>();
  for (const pay of extraLookup?.payments ?? []) paymentById.set(pay.id, pay);
  for (const pay of payments) paymentById.set(pay.id, pay);

  const salesReturnById = new Map<string, SalesReturn>();
  for (const ret of extraLookup?.salesReturns ?? []) salesReturnById.set(ret.id, ret);
  for (const ret of salesReturns) salesReturnById.set(ret.id, ret);

  const workOrderById = new Map<string, WorkOrder>();
  for (const wo of extraLookup?.workOrders ?? []) workOrderById.set(wo.id, wo);
  for (const wo of workOrders) workOrderById.set(wo.id, wo);

  // Payment yatim
  for (const pay of payments) {
    if (!pay.soId || !salesOrderById.has(pay.soId)) {
      discrepancies.push({
        kind: 'orphan_payment',
        id: pay.id,
        label: `${pay.soNumber || pay.id} (${pay.tanggal})`,
        recordedValue: pay.amount,
        recalculatedValue: 0,
        difference: pay.amount,
        unit: 'rupiah',
        detail: `Payment yatim: payments/${pay.id} menunjuk sales_orders/${pay.soId || '-'} yang tidak ditemukan.`,
      });
    }
  }

  // Retur melebihi qty terjual
  const returnedQtyBySoProduct = new Map<string, Map<string, number>>();
  for (const ret of salesReturns) {
    if (!ret.soId || !ret.productId) continue;
    const prodMap = returnedQtyBySoProduct.get(ret.soId) ?? new Map<string, number>();
    prodMap.set(ret.productId, (prodMap.get(ret.productId) ?? 0) + ret.qty);
    returnedQtyBySoProduct.set(ret.soId, prodMap);
  }

  for (const [soId, prodReturnMap] of returnedQtyBySoProduct.entries()) {
    const lines = soItemsByOrderId[soId];
    if (!lines) continue;
    const soldByProd = new Map<string, number>();
    for (const line of lines) {
      soldByProd.set(line.productId, (soldByProd.get(line.productId) ?? 0) + line.qty);
    }
    const so = salesOrderById.get(soId);
    for (const [productId, returnedQty] of prodReturnMap.entries()) {
      const soldQty = soldByProd.get(productId) ?? 0;
      if (returnedQty > soldQty) {
        discrepancies.push({
          kind: 'return_exceeds_sold',
          id: `${soId}-${productId}`,
          label: `${so?.soNumber ?? soId} · ${itemLabels[productId] ?? productId}`,
          recordedValue: returnedQty,
          recalculatedValue: soldQty,
          difference: returnedQty - soldQty,
          unit: 'qty',
          detail: `Total qty retur (${returnedQty}) melebihi qty terjual (${soldQty}) pada sales_orders/${soId}.`,
        });
      }
    }
  }

  // Jurnal vs sumber
  for (const j of journalEntries) {
    if (j.source === 'payment') {
      const pay = j.refId ? paymentById.get(j.refId) : undefined;
      if (!pay) {
        discrepancies.push({
          kind: 'journal_source_mismatch',
          id: j.id,
          label: `${j.tanggal} · ${j.deskripsi || j.id}`,
          recordedValue: j.amount,
          recalculatedValue: 0,
          difference: j.amount,
          unit: 'rupiah',
          detail: `Jurnal sumber payment (${j.id}) menunjuk payments/${j.refId || '-'} yang tidak ditemukan.`,
        });
      } else if (j.amount !== pay.amount) {
        discrepancies.push({
          kind: 'journal_source_mismatch',
          id: j.id,
          label: `${j.tanggal} · ${j.deskripsi || j.id}`,
          recordedValue: j.amount,
          recalculatedValue: pay.amount,
          difference: j.amount - pay.amount,
          unit: 'rupiah',
          detail: `Nominal journal_entries/${j.id} (${j.amount}) ≠ payments/${pay.id}.amount (${pay.amount}).`,
        });
      }
    } else if (j.source === 'sales_order') {
      const so = j.refId ? salesOrderById.get(j.refId) : undefined;
      if (!so) {
        discrepancies.push({
          kind: 'journal_source_mismatch',
          id: j.id,
          label: `${j.tanggal} · ${j.deskripsi || j.id}`,
          recordedValue: j.amount,
          recalculatedValue: 0,
          difference: j.amount,
          unit: 'rupiah',
          detail: `Jurnal sumber sales_order (${j.id}) menunjuk sales_orders/${j.refId || '-'} yang tidak ditemukan.`,
        });
      } else {
        const expectedAmount = so.penerimaanBersih ?? so.totalAmount;
        if (j.amount !== expectedAmount && j.amount !== so.totalAmount) {
          discrepancies.push({
            kind: 'journal_source_mismatch',
            id: j.id,
            label: `${j.tanggal} · ${j.deskripsi || j.id}`,
            recordedValue: j.amount,
            recalculatedValue: expectedAmount,
            difference: j.amount - expectedAmount,
            unit: 'rupiah',
            detail: `Nominal journal_entries/${j.id} (${j.amount}) ≠ sales_orders/${so.id} (${expectedAmount}).`,
          });
        }
      }
    } else if (j.source === 'sales_return') {
      const ret = j.refId ? salesReturnById.get(j.refId) : undefined;
      if (!ret) {
        discrepancies.push({
          kind: 'journal_source_mismatch',
          id: j.id,
          label: `${j.tanggal} · ${j.deskripsi || j.id}`,
          recordedValue: j.amount,
          recalculatedValue: 0,
          difference: j.amount,
          unit: 'rupiah',
          detail: `Jurnal sumber sales_return (${j.id}) menunjuk sales_returns/${j.refId || '-'} yang tidak ditemukan.`,
        });
      } else if (j.amount !== ret.refundAmount) {
        discrepancies.push({
          kind: 'journal_source_mismatch',
          id: j.id,
          label: `${j.tanggal} · ${j.deskripsi || j.id}`,
          recordedValue: j.amount,
          recalculatedValue: ret.refundAmount,
          difference: j.amount - ret.refundAmount,
          unit: 'rupiah',
          detail: `Nominal journal_entries/${j.id} (${j.amount}) ≠ sales_returns/${ret.id}.refundAmount (${ret.refundAmount}).`,
        });
      }
    }
  }

  const salesLedgerQtyBySoProduct = new Map<string, Map<string, number>>();
  const returnLedgerQtyByRetProduct = new Map<string, Map<string, number>>();
  const woOutputQtyByWoId = new Map<string, number>();

  for (const entry of ledgerEntries) {
    const itemLabel = itemLabels[entry.itemId] ?? entry.itemId;
    if (entry.jenis === 'penjualan') {
      if (!entry.refId || !salesOrderById.has(entry.refId)) {
        discrepancies.push({
          kind: 'orphan_ledger_sales',
          id: entry.id,
          label: `${itemLabel} (penjualan)`,
          recordedValue: Math.abs(entry.qty),
          recalculatedValue: 0,
          difference: Math.abs(entry.qty),
          unit: 'qty',
          detail: `Ledger yatim: stock_ledger/${entry.id} menunjuk sales_orders/${entry.refId || '-'} yang tidak ditemukan.`,
        });
      } else {
        const byProd = salesLedgerQtyBySoProduct.get(entry.refId) ?? new Map<string, number>();
        byProd.set(entry.itemId, (byProd.get(entry.itemId) ?? 0) + Math.abs(entry.qty));
        salesLedgerQtyBySoProduct.set(entry.refId, byProd);
      }
    } else if (entry.jenis === 'retur') {
      if (!entry.refId || !salesReturnById.has(entry.refId)) {
        discrepancies.push({
          kind: 'orphan_ledger_return',
          id: entry.id,
          label: `${itemLabel} (retur)`,
          recordedValue: entry.qty,
          recalculatedValue: 0,
          difference: entry.qty,
          unit: 'qty',
          detail: `Ledger yatim: stock_ledger/${entry.id} menunjuk sales_returns/${entry.refId || '-'} yang tidak ditemukan.`,
        });
      } else {
        const byProd = returnLedgerQtyByRetProduct.get(entry.refId) ?? new Map<string, number>();
        byProd.set(entry.itemId, (byProd.get(entry.itemId) ?? 0) + entry.qty);
        returnLedgerQtyByRetProduct.set(entry.refId, byProd);
      }
    } else if (entry.jenis === 'pemakaian_produksi' || entry.jenis === 'hasil_produksi') {
      if (!entry.refId || !workOrderById.has(entry.refId)) {
        discrepancies.push({
          kind: 'orphan_ledger_wo',
          id: entry.id,
          label: `${itemLabel} (${entry.jenis})`,
          recordedValue: Math.abs(entry.qty),
          recalculatedValue: 0,
          difference: Math.abs(entry.qty),
          unit: 'qty',
          detail: `Ledger yatim: stock_ledger/${entry.id} menunjuk work_orders/${entry.refId || '-'} yang tidak ditemukan.`,
        });
      } else if (entry.jenis === 'hasil_produksi') {
        woOutputQtyByWoId.set(entry.refId, (woOutputQtyByWoId.get(entry.refId) ?? 0) + entry.qty);
      }
    }
  }

  for (const wo of workOrders) {
    const ledgerOutputQty = woOutputQtyByWoId.get(wo.id) ?? 0;
    const rejectedOnlyCompleted = wo.status === 'completed' && (wo.rejectedQty ?? 0) > 0 && wo.completedQty === 0;
    if (wo.status === 'completed' && ledgerOutputQty <= 0 && !rejectedOnlyCompleted) {
      discrepancies.push({
        kind: 'wo_completed_without_output',
        id: wo.id,
        label: `${wo.woNumber} (${wo.id})`,
        recordedValue: wo.completedQty,
        recalculatedValue: 0,
        difference: wo.completedQty,
        unit: 'qty',
        detail: `Work Order ${wo.woNumber} berstatus completed tanpa entri stock_ledger jenis 'hasil_produksi'.`,
      });
    }

    if (stageLogsByWoId && stageLogsByWoId[wo.id]) {
      const setoranGoodQty = stageLogsByWoId[wo.id]
        .filter((log) => log.stage === 'setoran' || log.stage === 'packing')
        .reduce((sum, log) => sum + log.goodQty, 0);
      if (ledgerOutputQty !== setoranGoodQty) {
        discrepancies.push({
          kind: 'wo_packing_qty_mismatch',
          id: wo.id,
          label: `${wo.woNumber} (${wo.id})`,
          recordedValue: ledgerOutputQty,
          recalculatedValue: setoranGoodQty,
          difference: ledgerOutputQty - setoranGoodQty,
          unit: 'qty',
          detail: `Total hasil_produksi di stock_ledger (${ledgerOutputQty}) ≠ goodQty setoran/packing (${setoranGoodQty}) pada work_orders/${wo.id}.`,
        });
      }
    }
  }

  for (const so of salesOrders) {
    const lines = soItemsByOrderId[so.id];
    if (!lines) continue;
    const expectedByProd = new Map<string, number>();
    for (const line of lines) {
      expectedByProd.set(line.productId, (expectedByProd.get(line.productId) ?? 0) + line.qty);
    }
    const ledgerByProd = salesLedgerQtyBySoProduct.get(so.id) ?? new Map<string, number>();
    const allProds = new Set<string>([...expectedByProd.keys(), ...ledgerByProd.keys()]);
    for (const productId of allProds) {
      const expectedQty = expectedByProd.get(productId) ?? 0;
      const recordedQty = ledgerByProd.get(productId) ?? 0;
      if (recordedQty !== expectedQty) {
        discrepancies.push({
          kind: 'sales_ledger_qty_mismatch',
          id: `${so.id}-${productId}`,
          label: `${so.soNumber} · ${itemLabels[productId] ?? productId}`,
          recordedValue: recordedQty,
          recalculatedValue: expectedQty,
          difference: recordedQty - expectedQty,
          unit: 'qty',
          detail: `Qty ledger penjualan (${recordedQty}) ≠ total qty item pada sales_orders/${so.id}/items (${expectedQty}).`,
        });
      }
    }
  }

  for (const ret of salesReturns) {
    const expectedByProd = new Map<string, number>();
    if (ret.restockable) {
      expectedByProd.set(ret.productId, ret.qty);
    }
    const ledgerByProd = returnLedgerQtyByRetProduct.get(ret.id) ?? new Map<string, number>();
    const allProds = new Set<string>([...expectedByProd.keys(), ...ledgerByProd.keys()]);
    for (const productId of allProds) {
      const expectedQty = expectedByProd.get(productId) ?? 0;
      const recordedQty = ledgerByProd.get(productId) ?? 0;
      if (recordedQty !== expectedQty) {
        discrepancies.push({
          kind: 'return_ledger_qty_mismatch',
          id: `${ret.id}-${productId}`,
          label: `Retur ${ret.soNumber} · ${itemLabels[productId] ?? productId}`,
          recordedValue: recordedQty,
          recalculatedValue: expectedQty,
          difference: recordedQty - expectedQty,
          unit: 'qty',
          detail: `Qty ledger retur (${recordedQty}) ≠ qty retur restockable (${expectedQty}) pada sales_returns/${ret.id}.`,
        });
      }
    }
  }

  return discrepancies;
}

export function computeIntegrityAuditReport(params: IntegrityCheckInput): IntegrityAuditReport {
  const discrepancies = computeIntegrityDiscrepancies(params);
  const {
    ledgerEntries,
    purchaseCosts = [],
    salesOrders,
    soItemsByOrderId,
    products = [],
    itemLabels,
  } = params;

  const pricedLedgerIds = new Set<string>();
  for (const pc of purchaseCosts) {
    if (pc.ledgerId) pricedLedgerIds.add(pc.ledgerId);
  }
  const unpricedReceipts: UnpricedReceiptInfo[] = [];
  for (const entry of ledgerEntries) {
    if (entry.jenis === 'penerimaan' && !pricedLedgerIds.has(entry.id)) {
      unpricedReceipts.push({
        ledgerId: entry.id,
        itemId: entry.itemId,
        itemLabel: itemLabels[entry.itemId] ?? entry.itemId,
        qty: entry.qty,
        tanggal: entry.tanggal,
        refId: entry.refId,
        catatan: entry.catatan,
        createdByName: entry.createdByName || entry.createdBy,
      });
    }
  }

  const productById = new Map<string, Product>();
  for (const p of products) {
    productById.set(p.id, p);
  }
  const priceOverrides: PriceOverrideInfo[] = [];
  for (const so of salesOrders) {
    const lines = soItemsByOrderId[so.id] ?? [];
    for (const line of lines) {
      const prod = productById.get(line.productId);
      if (!prod) continue;
      if (line.unitPrice !== prod.hargaJual) {
        priceOverrides.push({
          soId: so.id,
          soNumber: so.soNumber,
          tanggal: so.tanggal,
          productId: line.productId,
          productLabel: `${prod.nama} (${prod.ukuran})`,
          sku: line.sku || prod.sku,
          qty: line.qty,
          normalPrice: prod.hargaJual,
          usedPrice: line.unitPrice,
          differencePerUnit: line.unitPrice - prod.hargaJual,
          createdByName: so.createdByName || so.createdBy,
        });
      }
    }
  }

  return {
    discrepancies,
    unpricedReceipts,
    priceOverrides,
  };
}
