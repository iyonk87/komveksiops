import { describe, expect, it } from 'vitest';
import {
  calculateBomRequirements,
  calculateRecipeHpp,
  calculateWeightedAverageCosts,
  computeBalanceSheet,
  computeCashFlowReport,
  computeIntegrityAuditReport,
  computeIntegrityDiscrepancies,
  computeProductionEfficiency,
  computeProfitAndLoss,
  computeReceivingUsageQty,
  computeWeeklyWagesSummary,
  computeWipTransition,
  reconstructBalancesFromLedger,
  splitBomRequirementsIntoChunks,
  validatePeriodOpen,
  validateStockChange,
} from '../../src/services/domain/accounting';
import {
  buildSafeCsvString,
  neutralizeCsvCell,
  parseCsvText,
  validateMarketplaceImportRows,
  validateMaterialImportRows,
  validateRecipeImportRows,
} from '../../src/services/domain/csv';
import {
  formatUsageQty,
  parseLengthToCm,
  parsePatternLengthToCmPerPcs,
} from '../../src/utils/format';
import type {
  Account,
  BomItem,
  MarketplaceChannel,
  MarketplacePayout,
  Material,
  OperatingExpense,
  PeriodDoc,
  Product,
  ProductionCost,
  PurchaseCost,
  SalesOrder,
  SalesOrderItem,
  SalesReturn,
  StageLog,
  StockBalance,
  StockLedgerEntry,
  WagePayout,
  WorkOrder,
} from '../../src/types/models';

describe('Domain Accounting & Production Services', () => {
  it('merekonstruksi saldo stok secara akurat dari ledger append-only', () => {
    const entries: StockLedgerEntry[] = [
      {
        id: 'l1',
        itemId: 'mat-kain-1',
        itemType: 'material',
        jenis: 'penerimaan',
        qty: 100,
        tanggal: '2026-11-01',
        refType: 'manual',
        refId: 'r1',
        catatan: '',
        balance_before: 0,
        balance_after: 100,
        createdBy: 'u1',
      },
      {
        id: 'l2',
        itemId: 'mat-kain-1',
        itemType: 'material',
        jenis: 'pemakaian_produksi',
        qty: -35,
        tanggal: '2026-11-02',
        refType: 'wo',
        refId: 'wo1',
        catatan: '',
        balance_before: 100,
        balance_after: 65,
        createdBy: 'u1',
      },
      {
        id: 'l3',
        itemId: 'prod-kaos-m',
        itemType: 'product',
        jenis: 'hasil_produksi',
        qty: 20,
        tanggal: '2026-11-03',
        refType: 'wo',
        refId: 'wo1',
        catatan: '',
        balance_before: 0,
        balance_after: 20,
        createdBy: 'u1',
      },
    ];

    const balances = reconstructBalancesFromLedger(entries);
    expect(balances['mat-kain-1']).toBe(65);
    expect(balances['prod-kaos-m']).toBe(20);
  });

  it('menghitung Weighted Average HPP dan valuasi persediaan dengan benar', () => {
    const purchaseCosts: PurchaseCost[] = [
      {
        id: 'pc1',
        ledgerId: 'l1',
        itemId: 'mat-1',
        supplierId: 'sup-1',
        qty: 100,
        unitCost: 40000,
        totalCost: 4000000,
        paidAmount: 4000000,
        accountId: 'acc-1',
        tanggal: '2026-11-01',
        catatan: '',
        createdBy: 'owner',
      },
      {
        id: 'pc2',
        ledgerId: 'l2',
        itemId: 'mat-1',
        supplierId: 'sup-1',
        qty: 100,
        unitCost: 60000,
        totalCost: 6000000,
        paidAmount: 6000000,
        accountId: 'acc-1',
        tanggal: '2026-11-05',
        catatan: '',
        createdBy: 'owner',
      },
    ];

    const bomItems: BomItem[] = [
      {
        id: 'bom1',
        productId: 'prod-1',
        materialId: 'mat-1',
        qtyPerPcs: 2,
        active: true,
        createdBy: 'owner',
      },
    ];

    const workOrders: WorkOrder[] = [
      {
        id: 'wo1',
        woNumber: 'WO-001',
        productId: 'prod-1',
        targetQty: 50,
        completedQty: 50,
        wipQty: 0,
        currentStage: 'completed',
        status: 'completed',
        tanggal: '2026-11-06',
        catatan: '',
        createdBy: 'gudang',
      },
    ];

    const productionCosts: ProductionCost[] = [
      {
        id: 'prc1',
        woId: 'wo1',
        woNumber: 'WO-001',
        vendorName: 'CMT Jaya',
        kategori: 'jahit_cmt',
        amount: 500000,
        paidAmount: 500000,
        accountId: 'acc-1',
        tanggal: '2026-11-06',
        catatan: '',
        createdBy: 'owner',
      },
    ];

    const ledgerEntries: StockLedgerEntry[] = [
      {
        id: 'l1',
        itemId: 'mat-1',
        itemType: 'material',
        jenis: 'penerimaan',
        qty: 200,
        tanggal: '2026-11-01',
        refType: 'purchase',
        refId: 'pc1',
        catatan: '',
        balance_before: 0,
        balance_after: 200,
        createdBy: 'gudang',
      },
      {
        id: 'l2',
        itemId: 'mat-1',
        itemType: 'material',
        jenis: 'pemakaian_produksi',
        qty: -100,
        tanggal: '2026-11-06',
        refType: 'wo',
        refId: 'wo1',
        catatan: '',
        balance_before: 200,
        balance_after: 100,
        createdBy: 'gudang',
      },
      {
        id: 'l3',
        itemId: 'prod-1',
        itemType: 'product',
        jenis: 'hasil_produksi',
        qty: 50,
        tanggal: '2026-11-07',
        refType: 'wo',
        refId: 'wo1',
        catatan: '',
        balance_before: 0,
        balance_after: 50,
        createdBy: 'gudang',
      },
      {
        id: 'l4',
        itemId: 'prod-1',
        itemType: 'product',
        jenis: 'penjualan',
        qty: -20,
        tanggal: '2026-11-10',
        refType: 'so',
        refId: 'so1',
        catatan: '',
        balance_before: 50,
        balance_after: 30,
        createdBy: 'kasir',
      },
    ];

    const result = calculateWeightedAverageCosts({
      ledgerEntries,
      purchaseCosts,
      productionCosts,
      workOrders,
      bomItems,
    });

    // Avg material cost: (4jt + 6jt) / 200 = 50.000/unit
    expect(result.materialUnitCost['mat-1']).toBe(50000);
    // Product cost for 50 pcs: 100 mat * 50.000 (5.000.000) + 500.000 CMT = 5.500.000 / 50 = 110.000/pcs
    expect(result.productUnitCost['prod-1']).toBe(110000);
    // HPP for 20 sold pcs: 20 * 110.000 = 2.200.000
    expect(result.cogsTotal).toBe(2200000);
    // Ending inventory: 100 mat * 50.000 (5jt) + 30 prod * 110.000 (3.3jt) = 8.300.000
    expect(result.totalMaterialValue).toBe(5000000);
    expect(result.totalProductValue).toBe(3300000);
    expect(result.totalInventoryValue).toBe(8300000);
  });

  it('menghitung Laba Rugi (Pendapatan Bersih - HPP - Beban Operasional)', () => {
    const salesOrders: SalesOrder[] = [
      {
        id: 'so1',
        soNumber: 'SO-001',
        customerId: 'c1',
        customerName: 'Toko A',
        channel: 'grosir',
        totalAmount: 4000000,
        paidAmount: 4000000,
        paymentStatus: 'paid',
        shippingStatus: 'delivered',
        status: 'active',
        tanggal: '2026-11-10',
        catatan: '',
        createdBy: 'kasir',
      },
      {
        id: 'so2',
        soNumber: 'SO-002',
        customerId: 'c2',
        customerName: 'Toko B',
        channel: 'reseller',
        totalAmount: 1000000,
        paidAmount: 0,
        paymentStatus: 'unpaid',
        shippingStatus: 'pending',
        status: 'void',
        tanggal: '2026-11-11',
        catatan: '',
        createdBy: 'kasir',
      },
    ];

    const returns: SalesReturn[] = [
      {
        id: 'ret1',
        soId: 'so1',
        soNumber: 'SO-001',
        productId: 'prod-1',
        qty: 2,
        refundAmount: 400000,
        restockable: true,
        alasan: 'Salah ukuran',
        tanggal: '2026-11-12',
        createdBy: 'kasir',
      },
    ];

    const expenses: OperatingExpense[] = [
      {
        id: 'exp1',
        kategori: 'Listrik',
        deskripsi: 'Tagihan PLN',
        accountId: 'acc1',
        amount: 600000,
        tanggal: '2026-11-15',
        createdBy: 'owner',
      },
    ];

    const pnl = computeProfitAndLoss({
      salesOrders,
      returns,
      operatingExpenses: expenses,
      hppTotal: 2000000,
      periodFilter: '2026-11',
    });

    expect(pnl.grossSales).toBe(4000000);
    expect(pnl.returnsTotal).toBe(400000);
    expect(pnl.netSales).toBe(3600000);
    expect(pnl.grossProfit).toBe(1600000);
    expect(pnl.operatingExpensesTotal).toBe(600000);
    expect(pnl.netProfit).toBe(1000000);
  });

  it('menghitung kebutuhan BOM, konversi WIP lintas tahap, dan efisiensi reject', () => {
    const bom: BomItem[] = [
      { id: 'b1', productId: 'p1', materialId: 'm-kain', qtyPerPcs: 2, active: true, createdBy: 'u' },
      { id: 'b2', productId: 'p1', materialId: 'm-kancing', qtyPerPcs: 5, active: true, createdBy: 'u' },
    ];
    const reqs = calculateBomRequirements(bom, 'p1', 30);
    expect(reqs).toEqual([
      { materialId: 'm-kain', requiredQty: 60 },
      { materialId: 'm-kancing', requiredQty: 150 },
    ]);

    const afterCutting = computeWipTransition({
      stage: 'cutting',
      currentWipQty: 0,
      inputQty: 30,
      goodQty: 28,
      rejectQty: 2,
      reworkQty: 0,
    });
    expect(afterCutting.nextWipQty).toBe(28);
    expect(afterCutting.nextStage).toBe('sewing');
    expect(afterCutting.finishedGoodsDelta).toBe(0);

    const afterPacking = computeWipTransition({
      stage: 'packing',
      currentWipQty: 28,
      inputQty: 28,
      goodQty: 26,
      rejectQty: 2,
      reworkQty: 0,
    });
    expect(afterPacking.nextWipQty).toBe(0);
    expect(afterPacking.finishedGoodsDelta).toBe(26);
    expect(afterPacking.nextStage).toBe('completed');

    const logs: StageLog[] = [
      {
        id: 'sl1',
        stage: 'cutting',
        inputQty: 100,
        goodQty: 95,
        rejectQty: 5,
        reworkQty: 0,
        rejectReason: 'Cacat kain',
        tanggal: '2026-11-10',
        createdBy: 'gudang',
      },
    ];
    const eff = computeProductionEfficiency({ workOrders: [], stageLogs: logs });
    expect(eff.stageMetrics[0].rejectPercent).toBe(5);
  });

  it('menolak stok minus bila tanpa approval owner dan menolak periode closed', () => {
    expect(() =>
      validateStockChange({ currentBalance: 5, deltaQty: -6, allowNegative: false }),
    ).toThrow();
    expect(
      validateStockChange({ currentBalance: 5, deltaQty: -6, allowNegative: true }),
    ).toEqual({ balanceBefore: 5, balanceAfter: -1 });

    const periods: PeriodDoc[] = [{ id: '2026-10', closed: true, updatedBy: 'owner' }];
    expect(() => validatePeriodOpen('2026-10-15', periods)).toThrow();
    expect(() => validatePeriodOpen('2026-11-01', periods)).not.toThrow();
  });

  it('mendeteksi selisih saldo stok dan total SO pada Cek Integritas', () => {
    const balances: StockBalance[] = [
      { id: 'm1', itemId: 'm1', itemType: 'material', qty: 99, lastLedgerId: 'l1' },
    ];
    const ledgerEntries: StockLedgerEntry[] = [
      {
        id: 'l1',
        itemId: 'm1',
        itemType: 'material',
        jenis: 'penerimaan',
        qty: 90,
        tanggal: '2026-11-01',
        refType: 'manual',
        refId: 'r1',
        catatan: '',
        balance_before: 0,
        balance_after: 90,
        createdBy: 'u1',
      },
    ];
    const salesOrders: SalesOrder[] = [
      {
        id: 'so1',
        soNumber: 'SO-001',
        customerId: 'c1',
        customerName: 'Pelanggan A',
        channel: 'grosir',
        totalAmount: 100000,
        paidAmount: 0,
        paymentStatus: 'unpaid',
        shippingStatus: 'pending',
        status: 'active',
        tanggal: '2026-11-01',
        catatan: '',
        createdBy: 'u1',
      },
    ];
    const items: Record<string, SalesOrderItem[]> = {
      so1: [
        {
          id: 'i1',
          productId: 'p1',
          productName: 'Kaos',
          sku: 'K-M',
          qty: 2,
          unitPrice: 60000,
          subtotal: 120000,
        },
      ],
    };

    const issues = computeIntegrityDiscrepancies({
      balances,
      ledgerEntries,
      salesOrders,
      soItemsByOrderId: items,
      itemLabels: { m1: 'Kain Katun' },
    });
    expect(issues).toHaveLength(3);
    expect(issues.find((i) => i.kind === 'stock_balance')?.difference).toBe(9);
    expect(issues.find((i) => i.kind === 'sales_order_total')?.difference).toBe(-20000);
    expect(issues.find((i) => i.kind === 'sales_ledger_qty_mismatch')?.difference).toBe(-2);
  });

  it('menjalankan seluruh 7 pemeriksaan Cek Integritas dan melaporkan tidak ada selisih saat data valid', () => {
    const validIssues = computeIntegrityDiscrepancies({
      accounts: [
        {
          id: 'acc-1',
          nama: 'Kas Utama',
          tipe: 'kas',
          nomorRekening: '',
          saldoAwal: 1000000,
          saldoBerjalan: 1150000,
          active: true,
          createdBy: 'owner',
        },
      ],
      balances: [
        { id: 'prod-1', itemId: 'prod-1', itemType: 'product', qty: 8, lastLedgerId: 'l-out' },
      ],
      ledgerEntries: [
        {
          id: 'l-in',
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'hasil_produksi',
          qty: 10,
          tanggal: '2026-11-01',
          refType: 'wo',
          refId: 'wo-1',
          catatan: '',
          balance_before: 0,
          balance_after: 10,
          createdBy: 'gudang',
          createdAt: new Date('2026-11-01T10:00:00Z'),
        },
        {
          id: 'l-out',
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'penjualan',
          qty: -2,
          tanggal: '2026-11-02',
          refType: 'so',
          refId: 'so-1',
          catatan: '',
          balance_before: 10,
          balance_after: 8,
          createdBy: 'kasir',
          createdAt: new Date('2026-11-02T10:00:00Z'),
        },
      ],
      salesOrders: [
        {
          id: 'so-1',
          soNumber: 'SO-001',
          customerId: 'c1',
          customerName: 'Toko Jaya',
          channel: 'grosir',
          totalAmount: 300000,
          paidAmount: 200000,
          paymentStatus: 'dp',
          shippingStatus: 'pending',
          status: 'active',
          tanggal: '2026-11-02',
          catatan: '',
          createdBy: 'kasir',
          createdAt: new Date('2026-11-02T10:00:00Z'),
        },
      ],
      soItemsByOrderId: {
        'so-1': [
          {
            id: 'item-1',
            productId: 'prod-1',
            productName: 'Kemeja',
            sku: 'KM-L',
            qty: 2,
            unitPrice: 150000,
            subtotal: 300000,
          },
        ],
      },
      payments: [
        {
          id: 'pay-1',
          soId: 'so-1',
          soNumber: 'SO-001',
          accountId: 'acc-1',
          accountName: 'Kas Utama',
          amount: 200000,
          tanggal: '2026-11-02',
          metode: 'Tunai',
          catatan: '',
          createdBy: 'kasir',
          createdAt: new Date('2026-11-02T10:00:00Z'),
        },
      ],
      operatingExpenses: [
        {
          id: 'exp-1',
          kategori: 'Listrik',
          deskripsi: 'PLN',
          accountId: 'acc-1',
          amount: 50000,
          tanggal: '2026-11-03',
          createdBy: 'owner',
          createdAt: new Date('2026-11-03T10:00:00Z'),
        },
      ],
      journalEntries: [
        {
          id: 'j-1',
          tanggal: '2026-11-02',
          source: 'sales_order',
          refId: 'so-1',
          debitAccount: 'piutang_usaha',
          creditAccount: 'pendapatan_penjualan',
          amount: 300000,
          debitAmount: 300000,
          creditAmount: 300000,
          deskripsi: 'Penjualan SO-001',
          createdBy: 'kasir',
          createdAt: new Date('2026-11-02T10:00:00Z'),
        },
      ],
      workOrders: [
        {
          id: 'wo-1',
          woNumber: 'WO-001',
          productId: 'prod-1',
          targetQty: 10,
          completedQty: 10,
          wipQty: 0,
          currentStage: 'completed',
          status: 'completed',
          tanggal: '2026-11-01',
          catatan: '',
          createdBy: 'gudang',
        },
      ],
      periods: [
        {
          id: '2026-10',
          closed: true,
          updatedBy: 'owner',
          updatedAt: new Date('2026-11-01T00:00:00Z'),
        },
      ],
      itemLabels: { 'prod-1': 'Kemeja L' },
    });
    expect(validIssues).toEqual([]);

    const brokenIssues = computeIntegrityDiscrepancies({
      accounts: [
        {
          id: 'acc-1',
          nama: 'Kas Utama',
          tipe: 'kas',
          nomorRekening: '',
          saldoAwal: 1000000,
          saldoBerjalan: 9999999,
          active: true,
          createdBy: 'owner',
        },
      ],
      balances: [
        { id: 'orphan-bal', itemId: 'orphan-bal', itemType: 'material', qty: 5, lastLedgerId: 'missing-ledger' },
      ],
      ledgerEntries: [
        {
          id: 'orphan-led',
          itemId: 'mat-missing-bal',
          itemType: 'material',
          jenis: 'penerimaan',
          qty: 12,
          tanggal: '2026-10-20',
          refType: 'manual',
          refId: 'r1',
          catatan: '',
          balance_before: 0,
          balance_after: 12,
          createdBy: 'gudang',
          createdAt: new Date('2026-11-05T12:00:00Z'),
        },
      ],
      salesOrders: [
        {
          id: 'so-bad',
          soNumber: 'SO-BAD',
          customerId: 'c1',
          customerName: 'Toko C',
          channel: 'online',
          totalAmount: 500000,
          paidAmount: 200000,
          paymentStatus: 'paid',
          shippingStatus: 'pending',
          status: 'active',
          tanggal: '2026-11-04',
          catatan: '',
          createdBy: 'kasir',
        },
      ],
      soItemsByOrderId: {
        'so-bad': [
          {
            id: 'i1',
            productId: 'p1',
            productName: 'Kaos',
            sku: 'K-1',
            qty: 1,
            unitPrice: 400000,
            subtotal: 400000,
          },
        ],
      },
      payments: [
        {
          id: 'pay-bad',
          soId: 'so-bad',
          soNumber: 'SO-BAD',
          accountId: 'acc-1',
          accountName: 'Kas Utama',
          amount: 100000,
          tanggal: '2026-11-04',
          metode: 'Tunai',
          catatan: '',
          createdBy: 'kasir',
        },
      ],
      journalEntries: [
        {
          id: 'j-bad',
          tanggal: '2026-11-04',
          source: 'manual',
          refId: 'r1',
          debitAccount: 'kas_bank',
          creditAccount: 'kas_bank',
          amount: 10000,
          debitAmount: 10000,
          creditAmount: 9000,
          deskripsi: 'Jurnal cacat',
          createdBy: 'owner',
        },
      ],
      periods: [
        {
          id: '2026-10',
          closed: true,
          updatedBy: 'owner',
          updatedAt: new Date('2026-11-01T00:00:00Z'),
        },
      ],
      itemLabels: {},
    });

    const kinds = new Set(brokenIssues.map((i) => i.kind));
    expect(kinds.has('cash_balance')).toBe(true);
    expect(kinds.has('orphan_stock_balance')).toBe(true);
    expect(kinds.has('orphan_stock_ledger')).toBe(true);
    expect(kinds.has('sales_order_total')).toBe(true);
    expect(kinds.has('sales_order_payment')).toBe(true);
    expect(kinds.has('sales_order_payment_status')).toBe(true);
    expect(kinds.has('closed_period_tx')).toBe(true);
    expect(kinds.has('journal_imbalance')).toBe(true);
  });

  it('audit putaran 2 (Task D): mendeteksi ledger yatim SO/Retur/WO, selisih qty, INFO belum diberi harga, INFO override harga, dan retur tidak memotong kas (bersih & rusak)', () => {
    const products: Product[] = [
      {
        id: 'prod-1',
        sku: 'KM-L',
        nama: 'Kemeja Linen',
        model: 'Regular',
        warna: 'Putih',
        ukuran: 'L',
        satuan: 'pcs',
        minStock: 5,
        hargaJual: 150000,
        active: true,
        createdBy: 'owner',
      },
    ];

    // Skenario BERSIH: semua referensi valid, purchase_costs lengkap, harga jual normal, retur ada refundAmount tapi saldo kas tetap utuh
    const cleanReport = computeIntegrityAuditReport({
      accounts: [
        {
          id: 'acc-1',
          nama: 'Kas Utama',
          tipe: 'kas',
          nomorRekening: '',
          saldoAwal: 1000000,
          saldoBerjalan: 1300000,
          active: true,
          createdBy: 'owner',
        },
      ],
      balances: [
        { id: 'mat-1', itemId: 'mat-1', itemType: 'material', qty: 80, lastLedgerId: 'l-mat-use' },
        { id: 'prod-1', itemId: 'prod-1', itemType: 'product', qty: 9, lastLedgerId: 'l-ret' },
      ],
      ledgerEntries: [
        {
          id: 'l-mat-in',
          itemId: 'mat-1',
          itemType: 'material',
          jenis: 'penerimaan',
          qty: 100,
          tanggal: '2026-11-01',
          refType: 'manual',
          refId: 'r-in',
          catatan: 'Beli kain',
          balance_before: 0,
          balance_after: 100,
          createdBy: 'gudang',
          createdByName: 'Budi Gudang',
        },
        {
          id: 'l-mat-use',
          itemId: 'mat-1',
          itemType: 'material',
          jenis: 'pemakaian_produksi',
          qty: -20,
          tanggal: '2026-11-02',
          refType: 'work_order',
          refId: 'wo-1',
          catatan: '',
          balance_before: 100,
          balance_after: 80,
          createdBy: 'gudang',
        },
        {
          id: 'l-wo-out',
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'hasil_produksi',
          qty: 10,
          tanggal: '2026-11-02',
          refType: 'work_order',
          refId: 'wo-1',
          catatan: '',
          balance_before: 0,
          balance_after: 10,
          createdBy: 'gudang',
        },
        {
          id: 'l-so',
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'penjualan',
          qty: -2,
          tanggal: '2026-11-03',
          refType: 'sales_order',
          refId: 'so-1',
          catatan: '',
          balance_before: 10,
          balance_after: 8,
          createdBy: 'kasir',
        },
        {
          id: 'l-ret',
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'retur',
          qty: 1,
          tanggal: '2026-11-04',
          refType: 'sales_return',
          refId: 'ret-1',
          catatan: '',
          balance_before: 8,
          balance_after: 9,
          createdBy: 'kasir',
        },
      ],
      purchaseCosts: [
        {
          id: 'pc-1',
          ledgerId: 'l-mat-in',
          itemId: 'mat-1',
          supplierId: 'sup-1',
          qty: 100,
          unitCost: 20000,
          totalCost: 2000000,
          paidAmount: 0,
          accountId: '',
          tanggal: '2026-11-01',
          catatan: '',
          createdBy: 'owner',
        },
      ],
      workOrders: [
        {
          id: 'wo-1',
          woNumber: 'WO-001',
          productId: 'prod-1',
          targetQty: 10,
          completedQty: 10,
          wipQty: 0,
          currentStage: 'completed',
          status: 'completed',
          tanggal: '2026-11-02',
          catatan: '',
          createdBy: 'gudang',
        },
      ],
      salesOrders: [
        {
          id: 'so-1',
          soNumber: 'SO-001',
          customerId: 'c1',
          customerName: 'Toko A',
          channel: 'grosir',
          totalAmount: 300000,
          paidAmount: 300000,
          paymentStatus: 'paid',
          shippingStatus: 'shipped',
          status: 'active',
          tanggal: '2026-11-03',
          catatan: '',
          createdBy: 'kasir',
          createdByName: 'Siti Kasir',
        },
      ],
      soItemsByOrderId: {
        'so-1': [
          {
            id: 'line-1',
            productId: 'prod-1',
            productName: 'Kemeja Linen',
            sku: 'KM-L',
            qty: 2,
            unitPrice: 150000,
            subtotal: 300000,
          },
        ],
      },
      payments: [
        {
          id: 'pay-1',
          soId: 'so-1',
          soNumber: 'SO-001',
          accountId: 'acc-1',
          accountName: 'Kas Utama',
          amount: 300000,
          tanggal: '2026-11-03',
          metode: 'Tunai',
          catatan: '',
          createdBy: 'kasir',
        },
      ],
      salesReturns: [
        {
          id: 'ret-1',
          soId: 'so-1',
          soNumber: 'SO-001',
          productId: 'prod-1',
          qty: 1,
          refundAmount: 150000, // D.5: tidak memotong kas secara otomatis
          restockable: true,
          alasan: 'Jahitan lepas',
          tanggal: '2026-11-04',
          createdBy: 'kasir',
        },
      ],
      products,
      itemLabels: { 'mat-1': '[Bahan] Kain', 'prod-1': '[SKU] Kemeja Linen (L)' },
    });

    expect(cleanReport.discrepancies).toEqual([]);
    expect(cleanReport.unpricedReceipts).toEqual([]);
    expect(cleanReport.priceOverrides).toEqual([]);

    // Skenario RUSAK + INFO:
    // - l-mat-in2 tidak punya purchase_costs -> INFO unpricedReceipts
    // - l-mat-use-orphan menunjuk wo-missing -> orphan_ledger_wo
    // - l-wo-orphan menunjuk wo-missing-2 -> orphan_ledger_wo
    // - l-so-orphan menunjuk so-missing -> orphan_ledger_sales
    // - so-1 item qty 2 tapi ledger penjualan hanya -1 -> sales_ledger_qty_mismatch
    // - l-ret-orphan menunjuk ret-missing -> orphan_ledger_return
    // - ret-1 restockable qty 3 tapi ledger retur hanya +1 -> return_ledger_qty_mismatch
    // - so-1 unitPrice 125000 != hargaJual 150000 -> INFO priceOverrides dengan createdByName
    const brokenReport = computeIntegrityAuditReport({
      balances: [
        { id: 'mat-1', itemId: 'mat-1', itemType: 'material', qty: 40, lastLedgerId: 'l-mat-use-orphan' },
        { id: 'prod-1', itemId: 'prod-1', itemType: 'product', qty: 5, lastLedgerId: 'l-ret-1' },
      ],
      ledgerEntries: [
        {
          id: 'l-mat-in2',
          itemId: 'mat-1',
          itemType: 'material',
          jenis: 'penerimaan',
          qty: 50,
          tanggal: '2026-11-01',
          refType: 'manual_gudang',
          refId: 'MAN-1',
          catatan: 'Belum diinput harga beli',
          balance_before: 0,
          balance_after: 50,
          createdBy: 'gudang',
          createdByName: 'Budi Gudang',
        },
        {
          id: 'l-mat-use-orphan',
          itemId: 'mat-1',
          itemType: 'material',
          jenis: 'pemakaian_produksi',
          qty: -10,
          tanggal: '2026-11-02',
          refType: 'work_order',
          refId: 'wo-missing',
          catatan: '',
          balance_before: 50,
          balance_after: 40,
          createdBy: 'gudang',
        },
        {
          id: 'l-wo-orphan',
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'hasil_produksi',
          qty: 5,
          tanggal: '2026-11-02',
          refType: 'work_order',
          refId: 'wo-missing-2',
          catatan: '',
          balance_before: 0,
          balance_after: 5,
          createdBy: 'gudang',
        },
        {
          id: 'l-so-orphan',
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'penjualan',
          qty: -1,
          tanggal: '2026-11-03',
          refType: 'sales_order',
          refId: 'so-missing',
          catatan: '',
          balance_before: 5,
          balance_after: 4,
          createdBy: 'kasir',
        },
        {
          id: 'l-so-mismatch',
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'penjualan',
          qty: -1,
          tanggal: '2026-11-03',
          refType: 'sales_order',
          refId: 'so-1',
          catatan: '',
          balance_before: 4,
          balance_after: 3,
          createdBy: 'kasir',
        },
        {
          id: 'l-ret-orphan',
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'retur',
          qty: 1,
          tanggal: '2026-11-04',
          refType: 'sales_return',
          refId: 'ret-missing',
          catatan: '',
          balance_before: 3,
          balance_after: 4,
          createdBy: 'kasir',
        },
        {
          id: 'l-ret-1',
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'retur',
          qty: 1,
          tanggal: '2026-11-04',
          refType: 'sales_return',
          refId: 'ret-1',
          catatan: '',
          balance_before: 4,
          balance_after: 5,
          createdBy: 'kasir',
        },
      ],
      salesOrders: [
        {
          id: 'so-1',
          soNumber: 'SO-OVERRIDE',
          customerId: 'c1',
          customerName: 'Toko B',
          channel: 'custom',
          totalAmount: 250000,
          paidAmount: 0,
          paymentStatus: 'unpaid',
          shippingStatus: 'pending',
          status: 'active',
          tanggal: '2026-11-03',
          catatan: '',
          createdBy: 'kasir',
          createdByName: 'Siti Kasir',
        },
      ],
      soItemsByOrderId: {
        'so-1': [
          {
            id: 'line-1',
            productId: 'prod-1',
            productName: 'Kemeja Linen',
            sku: 'KM-L',
            qty: 2,
            unitPrice: 125000,
            subtotal: 250000,
          },
        ],
      },
      salesReturns: [
        {
          id: 'ret-1',
          soId: 'so-1',
          soNumber: 'SO-OVERRIDE',
          productId: 'prod-1',
          qty: 3,
          refundAmount: 375000,
          restockable: true,
          alasan: 'Cacat',
          tanggal: '2026-11-04',
          createdBy: 'kasir',
        },
      ],
      products,
      itemLabels: { 'mat-1': '[Bahan] Kain', 'prod-1': '[SKU] Kemeja Linen (L)' },
    });

    const brokenKinds = brokenReport.discrepancies.map((d) => d.kind);
    expect(brokenKinds).toContain('orphan_ledger_sales');
    expect(brokenKinds).toContain('sales_ledger_qty_mismatch');
    expect(brokenKinds).toContain('orphan_ledger_return');
    expect(brokenKinds).toContain('return_ledger_qty_mismatch');
    expect(brokenKinds.filter((k) => k === 'orphan_ledger_wo')).toHaveLength(2);

    // D.2 INFO bukan error
    expect(brokenReport.unpricedReceipts).toHaveLength(1);
    expect(brokenReport.unpricedReceipts[0]).toMatchObject({
      ledgerId: 'l-mat-in2',
      itemId: 'mat-1',
      qty: 50,
      createdByName: 'Budi Gudang',
    });

    // D.4 INFO override harga bukan error
    expect(brokenReport.priceOverrides).toHaveLength(1);
    expect(brokenReport.priceOverrides[0]).toMatchObject({
      soNumber: 'SO-OVERRIDE',
      productId: 'prod-1',
      normalPrice: 150000,
      usedPrice: 125000,
      differencePerUnit: -25000,
      createdByName: 'Siti Kasir',
    });
  });

  it('audit putaran 3 (Task C.1-C.5): deteksi payment yatim, retur > qty jual, jurnal vs sumber, hasil_produksi vs packing, WO completed tanpa output, & mode 2 bulan (bersih & rusak)', () => {
    // 1. Skenario BERSIH dengan stageLogsByWoId, journal_entries payment/SO/retur, dan extraLookup pada mode two_months
    const cleanFull = computeIntegrityAuditReport({
      balances: [
        { id: 'prod-1', itemId: 'prod-1', itemType: 'product', qty: 18, lastLedgerId: 'l-ret' },
      ],
      workOrders: [
        {
          id: 'wo-1',
          woNumber: 'WO-100',
          productId: 'prod-1',
          targetQty: 20,
          completedQty: 20,
          wipQty: 0,
          currentStage: 'completed',
          status: 'completed',
          tanggal: '2026-11-01',
          catatan: '',
          createdBy: 'gudang',
        },
      ],
      stageLogsByWoId: {
        'wo-1': [
          {
            id: 'sl-cut',
            woId: 'wo-1',
            stage: 'cutting',
            inputQty: 20,
            goodQty: 20,
            rejectQty: 0,
            reworkQty: 0,
            rejectReason: '',
            tanggal: '2026-11-01',
            createdBy: 'gudang',
          },
          {
            id: 'sl-pack',
            woId: 'wo-1',
            stage: 'packing',
            inputQty: 20,
            goodQty: 20,
            rejectQty: 0,
            reworkQty: 0,
            rejectReason: '',
            tanggal: '2026-11-02',
            createdBy: 'gudang',
          },
        ],
      },
      ledgerEntries: [
        {
          id: 'l-wo',
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'hasil_produksi',
          qty: 20,
          tanggal: '2026-11-02',
          refType: 'work_order',
          refId: 'wo-1',
          catatan: '',
          balance_before: 0,
          balance_after: 20,
          createdBy: 'gudang',
        },
        {
          id: 'l-so',
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'penjualan',
          qty: -3,
          tanggal: '2026-11-03',
          refType: 'sales_order',
          refId: 'so-1',
          catatan: '',
          balance_before: 20,
          balance_after: 17,
          createdBy: 'kasir',
        },
        {
          id: 'l-ret',
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'retur',
          qty: 1,
          tanggal: '2026-11-04',
          refType: 'sales_return',
          refId: 'ret-1',
          catatan: '',
          balance_before: 17,
          balance_after: 18,
          createdBy: 'kasir',
        },
      ],
      salesOrders: [
        {
          id: 'so-1',
          soNumber: 'SO-100',
          customerId: 'c1',
          customerName: 'Toko',
          channel: 'grosir',
          totalAmount: 300000,
          paidAmount: 300000,
          paymentStatus: 'paid',
          shippingStatus: 'pending',
          status: 'active',
          tanggal: '2026-11-03',
          catatan: '',
          createdBy: 'kasir',
        },
      ],
      soItemsByOrderId: {
        'so-1': [
          {
            id: 'i1',
            productId: 'prod-1',
            productName: 'Kaos',
            sku: 'K-M',
            qty: 3,
            unitPrice: 100000,
            subtotal: 300000,
          },
        ],
      },
      payments: [
        {
          id: 'pay-1',
          soId: 'so-1',
          soNumber: 'SO-100',
          accountId: 'acc-1',
          accountName: 'Kas',
          amount: 300000,
          tanggal: '2026-11-03',
          metode: 'Tunai',
          catatan: '',
          createdBy: 'kasir',
        },
      ],
      salesReturns: [
        {
          id: 'ret-1',
          soId: 'so-1',
          soNumber: 'SO-100',
          productId: 'prod-1',
          qty: 1,
          refundAmount: 100000,
          restockable: true,
          alasan: 'Cacat',
          tanggal: '2026-11-04',
          createdBy: 'kasir',
        },
      ],
      journalEntries: [
        {
          id: 'j-so',
          tanggal: '2026-11-03',
          source: 'sales_order',
          refId: 'so-1',
          debitAccount: 'kas_bank',
          creditAccount: 'pendapatan_penjualan',
          amount: 300000,
          deskripsi: 'SO',
          createdBy: 'kasir',
        },
        {
          id: 'j-pay',
          tanggal: '2026-11-03',
          source: 'payment',
          refId: 'pay-1',
          debitAccount: 'kas_bank',
          creditAccount: 'piutang_usaha',
          amount: 300000,
          deskripsi: 'Pay',
          createdBy: 'kasir',
        },
        {
          id: 'j-ret',
          tanggal: '2026-11-04',
          source: 'sales_return',
          refId: 'ret-1',
          debitAccount: 'retur_penjualan',
          creditAccount: 'piutang_usaha',
          amount: 100000,
          deskripsi: 'Ret',
          createdBy: 'kasir',
        },
      ],
      itemLabels: { 'prod-1': 'Kaos M' },
    });
    expect(cleanFull.discrepancies).toEqual([]);

    // 2. Skenario BERSIH mode two_months: saldo kas/stok kumulatif dilewati, referensi lintas bulan disuplai extraLookup
    const cleanTwoMonths = computeIntegrityDiscrepancies({
      scopeMode: 'two_months',
      accounts: [
        {
          id: 'acc-1',
          nama: 'Kas',
          tipe: 'kas',
          nomorRekening: '',
          saldoAwal: 0,
          saldoBerjalan: 999999,
          active: true,
          createdBy: 'owner',
        },
      ],
      balances: [{ id: 'prod-1', itemId: 'prod-1', itemType: 'product', qty: 50, lastLedgerId: 'old-ledger' }],
      ledgerEntries: [],
      salesOrders: [],
      soItemsByOrderId: {
        'so-old': [
          {
            id: 'i-old',
            productId: 'prod-1',
            productName: 'Kaos',
            sku: 'K-M',
            qty: 5,
            unitPrice: 100000,
            subtotal: 500000,
          },
        ],
      },
      payments: [
        {
          id: 'pay-cur',
          soId: 'so-old',
          soNumber: 'SO-OLD',
          accountId: 'acc-1',
          accountName: 'Kas',
          amount: 200000,
          tanggal: '2026-11-10',
          metode: 'Transfer',
          catatan: '',
          createdBy: 'kasir',
        },
      ],
      salesReturns: [
        {
          id: 'ret-cur',
          soId: 'so-old',
          soNumber: 'SO-OLD',
          productId: 'prod-1',
          qty: 2,
          refundAmount: 200000,
          restockable: false,
          alasan: 'Rusak',
          tanggal: '2026-11-11',
          createdBy: 'kasir',
        },
      ],
      journalEntries: [
        {
          id: 'j-cur-pay',
          tanggal: '2026-11-10',
          source: 'payment',
          refId: 'pay-cur',
          debitAccount: 'kas_bank',
          creditAccount: 'piutang_usaha',
          amount: 200000,
          deskripsi: 'Bayar SO lama',
          createdBy: 'kasir',
        },
      ],
      extraLookup: {
        salesOrders: [
          {
            id: 'so-old',
            soNumber: 'SO-OLD',
            customerId: 'c1',
            customerName: 'Toko Lama',
            channel: 'grosir',
            totalAmount: 500000,
            paidAmount: 200000,
            paymentStatus: 'dp',
            shippingStatus: 'shipped',
            status: 'active',
            tanggal: '2026-08-01',
            catatan: '',
            createdBy: 'kasir',
          },
        ],
      },
      itemLabels: { 'prod-1': 'Kaos M' },
    });
    expect(cleanTwoMonths).toEqual([]);

    // 3. Skenario RUSAK: semua temuan C.1–C.4 harus terdeteksi
    const brokenC = computeIntegrityDiscrepancies({
      balances: [
        { id: 'prod-1', itemId: 'prod-1', itemType: 'product', qty: 15, lastLedgerId: 'l-wo1' },
      ],
      workOrders: [
        {
          id: 'wo-1',
          woNumber: 'WO-MISMATCH',
          productId: 'prod-1',
          targetQty: 20,
          completedQty: 15,
          wipQty: 0,
          currentStage: 'packing',
          status: 'in_progress',
          tanggal: '2026-11-01',
          catatan: '',
          createdBy: 'gudang',
        },
        {
          id: 'wo-2',
          woNumber: 'WO-NO-OUTPUT',
          productId: 'prod-1',
          targetQty: 10,
          completedQty: 10,
          wipQty: 0,
          currentStage: 'completed',
          status: 'completed',
          tanggal: '2026-11-02',
          catatan: '',
          createdBy: 'gudang',
        },
      ],
      stageLogsByWoId: {
        'wo-1': [
          {
            id: 'sl-p1',
            woId: 'wo-1',
            stage: 'packing',
            inputQty: 20,
            goodQty: 18,
            rejectQty: 2,
            reworkQty: 0,
            rejectReason: '',
            tanggal: '2026-11-02',
            createdBy: 'gudang',
          },
        ],
      },
      ledgerEntries: [
        {
          id: 'l-wo1',
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'hasil_produksi',
          qty: 15, // beda dari packing goodQty = 18
          tanggal: '2026-11-02',
          refType: 'work_order',
          refId: 'wo-1',
          catatan: '',
          balance_before: 0,
          balance_after: 15,
          createdBy: 'gudang',
        },
      ],
      salesOrders: [
        {
          id: 'so-1',
          soNumber: 'SO-1',
          customerId: 'c1',
          customerName: 'Toko',
          channel: 'grosir',
          totalAmount: 200000,
          paidAmount: 0,
          paymentStatus: 'unpaid',
          shippingStatus: 'pending',
          status: 'active',
          tanggal: '2026-11-03',
          catatan: '',
          createdBy: 'kasir',
        },
      ],
      soItemsByOrderId: {
        'so-1': [
          {
            id: 'i1',
            productId: 'prod-1',
            productName: 'Kaos',
            sku: 'K-M',
            qty: 2,
            unitPrice: 100000,
            subtotal: 200000,
          },
        ],
      },
      payments: [
        {
          id: 'pay-orphan',
          soId: 'so-missing',
          soNumber: 'SO-MISSING',
          accountId: 'acc-1',
          accountName: 'Kas',
          amount: 150000,
          tanggal: '2026-11-03',
          metode: 'Tunai',
          catatan: '',
          createdBy: 'kasir',
        },
      ],
      salesReturns: [
        {
          id: 'ret-a',
          soId: 'so-1',
          soNumber: 'SO-1',
          productId: 'prod-1',
          qty: 2,
          refundAmount: 200000,
          restockable: false,
          alasan: 'R1',
          tanggal: '2026-11-04',
          createdBy: 'kasir',
        },
        {
          id: 'ret-b',
          soId: 'so-1',
          soNumber: 'SO-1',
          productId: 'prod-1',
          qty: 1, // total retur 3 > terjual 2
          refundAmount: 100000,
          restockable: false,
          alasan: 'R2',
          tanggal: '2026-11-05',
          createdBy: 'kasir',
        },
      ],
      journalEntries: [
        {
          id: 'j-so-mismatch',
          tanggal: '2026-11-03',
          source: 'sales_order',
          refId: 'so-1',
          debitAccount: 'piutang_usaha',
          creditAccount: 'pendapatan_penjualan',
          amount: 180000, // SO totalAmount = 200000
          deskripsi: 'SO mismatch',
          createdBy: 'kasir',
        },
        {
          id: 'j-pay-missing',
          tanggal: '2026-11-03',
          source: 'payment',
          refId: 'pay-not-found',
          debitAccount: 'kas_bank',
          creditAccount: 'piutang_usaha',
          amount: 50000,
          deskripsi: 'Pay missing',
          createdBy: 'kasir',
        },
      ],
      itemLabels: { 'prod-1': 'Kaos M' },
    });

    const cKinds = brokenC.map((d) => d.kind);
    expect(cKinds).toContain('orphan_payment');
    expect(cKinds).toContain('return_exceeds_sold');
    expect(cKinds).toContain('journal_source_mismatch');
    expect(cKinds.filter((k) => k === 'journal_source_mismatch')).toHaveLength(2);
    expect(cKinds).toContain('wo_packing_qty_mismatch');
    expect(cKinds).toContain('wo_completed_without_output');
  });

  it('menetralkan formula injection pada ekspor CSV dan mem-parse CSV dengan aman', () => {
    expect(neutralizeCsvCell('=CMD("calc")')).toBe(`"'=CMD(""calc"")"`);
    const csv = buildSafeCsvString(['Nama', 'Catatan'], [['Budi', '+SUM(A1:A2)'], ['Ani', '-100']]);
    expect(csv).toContain("'+SUM(A1:A2)");
    expect(csv).toContain("'-100");

    const parsed = parseCsvText('Tanggal,Nominal,Ket\n2026-11-01,250000,"Transfer Masuk, BCA"');
    expect(parsed.headers).toEqual(['Tanggal', 'Nominal', 'Ket']);
    expect(parsed.rows[0]).toEqual(['2026-11-01', '250000', 'Transfer Masuk, BCA']);

    // Auto-detect delimiter ';'
    const parsedSemi = parseCsvText('sku;nama;qty\nTAS-01;Ransel Besar;10');
    expect(parsedSemi.delimiter).toBe(';');
    expect(parsedSemi.rows[0]).toEqual(['TAS-01', 'Ransel Besar', '10']);
  });

  it('Area 1: konversi satuan m/cm bulat tanpa pecahan cm, pola "1 mtr jadi 5 pcs", formatUsageQty, & blokir beli jika konversi kosong', () => {
    expect(parseLengthToCm('0,5', 'm')).toBe(50);
    expect(parseLengthToCm('12.5', 'm')).toBe(1250);
    expect(formatUsageQty(1250, 'cm')).toBe('12,5 m (1.250 cm)');
    expect(() => parseLengthToCm('12.5', 'cm')).toThrow(); // menolak pecahan cm
    expect(parsePatternLengthToCmPerPcs('1 mtr jadi 5 pcs')).toBe(20);
    expect(() => parsePatternLengthToCmPerPcs('1 mtr jadi 3 pcs')).toThrow(); // 33.33 cm ditolak

    // Blokir penerimaan satuan beli jika konversi kosong tanpa panjang aktual
    expect(() =>
      computeReceivingUsageQty({
        purchaseQty: 2,
        unitMode: 'purchase',
        konversi: null,
      }),
    ).toThrow();
    // Jika diisi panjang aktual (cm), diizinkan
    expect(
      computeReceivingUsageQty({
        purchaseQty: 2,
        unitMode: 'purchase',
        konversi: null,
        actualUsageQty: 9800,
      }),
    ).toBe(9800);
    // Dengan konversi terisi
    expect(
      computeReceivingUsageQty({
        purchaseQty: 3,
        unitMode: 'purchase',
        konversi: 5000,
      }),
    ).toBe(15000);
  });

  it('Area 2 & 3: harga per cm pecahan (float), Resep HPP campuran bahan + biaya, chunking > 6 bahan, setoran bertahap & reject beban periode', () => {
    const reqs = Array.from({ length: 10 }, (_, i) => ({
      materialId: `mat-${i + 1}`,
      requiredQty: (i + 1) * 10,
    }));
    const chunks = splitBomRequirementsIntoChunks(reqs, 4);
    expect(chunks.map((c) => c.length)).toEqual([4, 4, 2]);

    // Transisi produksi bertahap baru: potong -> setoran bertahap -> reject terpisah
    const afterPotong = computeWipTransition({
      stage: 'potong',
      currentWipQty: 0,
      inputQty: 100,
      goodQty: 100,
      rejectQty: 0,
      reworkQty: 0,
    });
    expect(afterPotong).toEqual({ nextWipQty: 100, finishedGoodsDelta: 0, nextStage: 'setoran' });

    const setoran1 = computeWipTransition({
      stage: 'setoran',
      currentWipQty: 100,
      inputQty: 20,
      goodQty: 20,
      rejectQty: 0,
      reworkQty: 0,
    });
    expect(setoran1).toEqual({ nextWipQty: 80, finishedGoodsDelta: 20, nextStage: 'setoran' });

    const setoran2 = computeWipTransition({
      stage: 'setoran',
      currentWipQty: 80,
      inputQty: 40,
      goodQty: 40,
      rejectQty: 0,
      reworkQty: 0,
    });
    expect(setoran2).toEqual({ nextWipQty: 40, finishedGoodsDelta: 40, nextStage: 'setoran' });

    const rejectStep = computeWipTransition({
      stage: 'reject',
      currentWipQty: 40,
      inputQty: 5,
      goodQty: 0,
      rejectQty: 5,
      reworkQty: 0,
    });
    expect(rejectStep).toEqual({ nextWipQty: 35, finishedGoodsDelta: 0, nextStage: 'setoran' });

    // Resep HPP dengan harga bahan pecahan per cm: Rp 1.000.000 / 3.000 cm = 333.3333... Rp/cm
    // Pemakaian 45 cm => 15.000 Rp + jahit_cutting 25.000 + sablon 10.000 + packing 1.000 = 51.000
    const bomItems: BomItem[] = [
      { id: 'b1', productId: 'tas-1', jenis: 'material', materialId: 'kain-d300', qtyPerPcs: 45, active: true, createdBy: 'u' },
      { id: 'b2', productId: 'tas-1', jenis: 'cost', costCategory: 'jahit_cutting', label: 'Jahit+Cut', amountPerPcs: 25000, active: true, createdBy: 'u' },
      { id: 'b3', productId: 'tas-1', jenis: 'cost', costCategory: 'sablon', label: 'Sablon', amountPerPcs: 10000, active: true, createdBy: 'u' },
      { id: 'b4', productId: 'tas-1', jenis: 'cost', costCategory: 'packing', label: 'Packing', amountPerPcs: 1000, active: true, createdBy: 'u' },
    ];
    const hpp = calculateRecipeHpp({
      productId: 'tas-1',
      bomItems,
      materialUnitCostFloat: { 'kain-d300': 1000000 / 3000 },
    });
    expect(hpp.materialCostFloat).toBeCloseTo(15000, 6);
    expect(hpp.productionCostSum).toBe(36000);
    expect(hpp.hppPerPcs).toBe(51000);
  });

  it('Area 4: rekap upah mingguan cocok persis dengan fixture wawancara 21/11 (Rp 11.480.000 + sablon Rp 850.000 = Rp 12.330.000)', () => {
    const products: Product[] = [
      { id: 'p-ransel', sku: 'RN-01', nama: 'Ransel', model: 'Ransel', warna: 'Hitam', ukuran: 'L', satuan: 'pcs', minStock: 0, hargaJual: 0, active: true, createdBy: 'u' },
      { id: 'p-jinjing', sku: 'JJ-01', nama: 'Jinjing', model: 'Jinjing', warna: 'Hitam', ukuran: 'M', satuan: 'pcs', minStock: 0, hargaJual: 0, active: true, createdBy: 'u' },
      { id: 'p-sepatu', sku: 'TS-01', nama: 'Tas Sepatu', model: 'Sepatu', warna: 'Navy', ukuran: 'S', satuan: 'pcs', minStock: 0, hargaJual: 0, active: true, createdBy: 'u' },
      { id: 'p-tote', sku: 'TT-01', nama: 'Tote', model: 'Tote', warna: 'Cream', ukuran: 'M', satuan: 'pcs', minStock: 0, hargaJual: 0, active: true, createdBy: 'u' },
    ];
    const bomItems: BomItem[] = [
      { id: 'c1', productId: 'p-ransel', jenis: 'cost', costCategory: 'jahit_cutting', label: 'Jahit', amountPerPcs: 25000, active: true, createdBy: 'u' },
      { id: 'c2', productId: 'p-jinjing', jenis: 'cost', costCategory: 'jahit_cutting', label: 'Jahit', amountPerPcs: 5000, active: true, createdBy: 'u' },
      { id: 'c3', productId: 'p-sepatu', jenis: 'cost', costCategory: 'jahit_cutting', label: 'Jahit', amountPerPcs: 43000, active: true, createdBy: 'u' },
      { id: 'c4', productId: 'p-tote', jenis: 'cost', costCategory: 'jahit_cutting', label: 'Jahit', amountPerPcs: 20000, active: true, createdBy: 'u' },
      { id: 'c5', productId: 'p-ransel', jenis: 'cost', costCategory: 'sablon', label: 'Sablon', amountPerPcs: 3148, active: true, createdBy: 'u' },
    ];
    const workOrders: WorkOrder[] = [
      { id: 'wo-r', woNumber: 'WO-R', productId: 'p-ransel', targetQty: 270, completedQty: 270, wipQty: 0, currentStage: 'completed', status: 'completed', tanggal: '2026-11-21', catatan: '', createdBy: 'u' },
      { id: 'wo-j', woNumber: 'WO-J', productId: 'p-jinjing', targetQty: 780, completedQty: 780, wipQty: 0, currentStage: 'completed', status: 'completed', tanggal: '2026-11-21', catatan: '', createdBy: 'u' },
      { id: 'wo-s', woNumber: 'WO-S', productId: 'p-sepatu', targetQty: 10, completedQty: 10, wipQty: 0, currentStage: 'completed', status: 'completed', tanggal: '2026-11-21', catatan: '', createdBy: 'u' },
      { id: 'wo-t', woNumber: 'WO-T', productId: 'p-tote', targetQty: 20, completedQty: 20, wipQty: 0, currentStage: 'completed', status: 'completed', tanggal: '2026-11-21', catatan: '', createdBy: 'u' },
    ];
    const stageLogsByWoId: Record<string, StageLog[]> = {
      'wo-r': [{ id: 'l1', stage: 'setoran', inputQty: 270, goodQty: 270, rejectQty: 0, reworkQty: 0, rejectReason: '', tanggal: '2026-11-21', createdBy: 'u' }],
      'wo-j': [{ id: 'l2', stage: 'setoran', inputQty: 780, goodQty: 780, rejectQty: 0, reworkQty: 0, rejectReason: '', tanggal: '2026-11-21', createdBy: 'u' }],
      'wo-s': [{ id: 'l3', stage: 'setoran', inputQty: 10, goodQty: 10, rejectQty: 0, reworkQty: 0, rejectReason: '', tanggal: '2026-11-21', createdBy: 'u' }],
      'wo-t': [{ id: 'l4', stage: 'setoran', inputQty: 20, goodQty: 20, rejectQty: 0, reworkQty: 0, rejectReason: '', tanggal: '2026-11-21', createdBy: 'u' }],
    };

    const summary = computeWeeklyWagesSummary({
      startDate: '2026-11-15',
      endDate: '2026-11-21',
      workOrders,
      stageLogsByWoId,
      bomItems,
      products,
    });
    // 270*25.000 + 780*5.000 + 10*43.000 + 20*20.000 = 6.750.000 + 3.900.000 + 430.000 + 400.000 = 11.480.000
    expect(summary.jahitCuttingStandard).toBe(11480000);
    // Contoh 21/11: jahit 11.480.000 + aktual sablon 850.000 = 12.330.000 total dibayar
    const actualSablonPaid = 850000;
    const totalPaidExample = summary.jahitCuttingStandard + actualSablonPaid;
    expect(totalPaidExample).toBe(12330000);
  });

  it('Area 5 & 6: Arus Kas mengecualikan Saldo Marketplace belum cair & Neraca seimbang persis tanpa plug (selisih == 0 saat modalAwal cocok)', () => {
    // Skenario lengkap double-entry:
    // Modal Awal Rp 10.000.000 di Kas
    // Beli kain Rp 2.000.000 (50.000 cm -> Rp 40/cm) bayar tunai Rp 2.000.000
    // Produksi 10 tas (pemakaian 500 cm = Rp 20.000 + upah standar jahit 10 * 25.000 = 250.000) -> HPP/tas = 27.000
    // Bayar upah mingguan Rp 260.000 (variance +10.000 masuk beban selisih biaya produksi)
    // Jual 4 tas via TikTok @100.000 = 400.000, admin 30.000 => penerimaanBersih = 370.000 masuk Saldo TikTok
    // Pencairan TikTok ke Bank BCA Rp 200.000 -> Sisa saldo TikTok Rp 170.000
    const accounts: Account[] = [
      { id: 'kas-1', nama: 'Kas', tipe: 'kas', nomorRekening: '', saldoAwal: 10000000, saldoBerjalan: 10000000 - 2000000 - 260000, active: true, createdBy: 'u' },
      { id: 'bank-1', nama: 'BCA', tipe: 'bank', nomorRekening: '123', saldoAwal: 0, saldoBerjalan: 200000, active: true, createdBy: 'u' },
    ];
    const marketplaceChannels: MarketplaceChannel[] = [
      { id: 'tiktok', nama: 'TikTok', balance: 170000, active: true, createdBy: 'u' },
    ];
    const marketplacePayouts: MarketplacePayout[] = [
      { id: 'mp-1', channelId: 'tiktok', channelName: 'TikTok', accountId: 'bank-1', accountName: 'BCA', amount: 200000, tanggal: '2026-11-22', catatan: '', createdBy: 'u' },
    ];
    const purchaseCosts: PurchaseCost[] = [
      { id: 'pc-1', ledgerId: 'l1', itemId: 'm1', supplierId: 's1', qty: 50000, unitCost: 40, totalCost: 2000000, paidAmount: 2000000, accountId: 'kas-1', tanggal: '2026-11-20', catatan: '', createdBy: 'u' },
    ];
    const bomItems: BomItem[] = [
      { id: 'b1', productId: 'p1', jenis: 'material', materialId: 'm1', qtyPerPcs: 50, active: true, createdBy: 'u' },
      { id: 'b2', productId: 'p1', jenis: 'cost', costCategory: 'jahit_cutting', label: 'Jahit', amountPerPcs: 25000, active: true, createdBy: 'u' },
    ];
    const workOrders: WorkOrder[] = [
      { id: 'wo-1', woNumber: 'WO-1', productId: 'p1', targetQty: 10, completedQty: 10, wipQty: 0, rejectedQty: 0, currentStage: 'completed', status: 'completed', tanggal: '2026-11-20', catatan: '', createdBy: 'u' },
    ];
    const wagePayouts: WagePayout[] = [
      {
        id: 'wp-1',
        startDate: '2026-11-15',
        endDate: '2026-11-21',
        tanggal: '2026-11-21',
        accountId: 'kas-1',
        accountName: 'Kas',
        jahitCuttingStandard: 250000,
        sablonStandard: 0,
        packingStandard: 0,
        lainnyaStandard: 0,
        totalStandard: 250000,
        jahitCuttingPaid: 260000,
        sablonPaid: 0,
        packingPaid: 0,
        lainnyaPaid: 0,
        totalPaid: 260000,
        variance: 10000,
        catatan: '',
        createdBy: 'u',
      },
    ];
    const ledgerEntries: StockLedgerEntry[] = [
      { id: 'l1', itemId: 'm1', itemType: 'material', jenis: 'penerimaan', qty: 50000, tanggal: '2026-11-20', refType: 'penerimaan_bahan', refId: 'r1', catatan: '', balance_before: 0, balance_after: 50000, createdBy: 'u' },
      { id: 'l2', itemId: 'm1', itemType: 'material', jenis: 'pemakaian_produksi', qty: -500, tanggal: '2026-11-20', refType: 'work_order', refId: 'wo-1', catatan: '', balance_before: 50000, balance_after: 49500, createdBy: 'u' },
      { id: 'l3', itemId: 'p1', itemType: 'product', jenis: 'hasil_produksi', qty: 10, tanggal: '2026-11-21', refType: 'work_order', refId: 'wo-1', catatan: '', balance_before: 0, balance_after: 10, createdBy: 'u' },
      { id: 'l4', itemId: 'p1', itemType: 'product', jenis: 'penjualan', qty: -4, tanggal: '2026-11-22', refType: 'sales_order', refId: 'so-1', catatan: '', balance_before: 10, balance_after: 6, createdBy: 'u' },
    ];
    const salesOrders: SalesOrder[] = [
      {
        id: 'so-1',
        soNumber: 'TT-001',
        customerId: 'marketplace',
        customerName: 'TikTok',
        channel: 'TikTok',
        noPesanan: 'TT-001',
        totalAmount: 400000,
        biayaAdmin: 30000,
        komisiAffiliate: 0,
        potonganLain: 0,
        penerimaanBersih: 370000,
        paidAmount: 400000,
        paymentStatus: 'paid',
        shippingStatus: 'pending',
        status: 'active',
        tanggal: '2026-11-22',
        catatan: '',
        createdBy: 'u',
      },
    ];

    const costs = calculateWeightedAverageCosts({
      ledgerEntries,
      purchaseCosts,
      productionCosts: [],
      workOrders,
      bomItems,
      wagePayouts,
    });
    const pnl = computeProfitAndLoss({
      salesOrders,
      returns: [],
      operatingExpenses: [],
      hppTotal: costs.cogsTotal,
      rejectExpenseTotal: costs.rejectExpenseTotal,
      wagePayouts,
      opnameAdjustmentTotal: costs.opnameAdjustmentTotal,
    });
    const cashFlow = computeCashFlowReport({
      accounts,
      marketplacePayouts,
      payments: [],
      purchaseCosts,
      productionCosts: [],
      wagePayouts,
      operatingExpenses: [],
      journalEntries: [],
    });
    // Saldo Marketplace 170.000 belum cair TIDAK masuk arus kas; hanya pencairan 200.000 yang masuk!
    expect(cashFlow.marketplacePayoutInflows).toBe(200000);
    expect(cashFlow.endingCashBank).toBe(7940000);
    expect(cashFlow.endingCashBank).toBe(cashFlow.recordedCashBank);

    const balancedSheet = computeBalanceSheet({
      accounts,
      marketplaceChannels,
      salesOrders,
      returns: [],
      marketplacePayouts,
      purchaseCosts,
      productionCosts: [],
      journalEntries: [],
      costs,
      profitLoss: pnl,
      modalAwal: 10000000,
    });
    expect(balancedSheet.selisih).toBe(0);
    expect(balancedSheet.isBalanced).toBe(true);

    // Jika Modal Awal belum diisi (null -> 0), selisih tampil jujur tanpa angka plug
    const unbalancedSheet = computeBalanceSheet({
      accounts,
      marketplaceChannels,
      salesOrders,
      returns: [],
      marketplacePayouts,
      purchaseCosts,
      productionCosts: [],
      journalEntries: [],
      costs,
      profitLoss: pnl,
      modalAwal: null,
    });
    expect(unbalancedSheet.selisih).toBe(10000000);
    expect(unbalancedSheet.isBalanced).toBe(false);

    // Cek Integritas saldo marketplace
    const mpBroken = computeIntegrityDiscrepancies({
      accounts,
      marketplaceChannels: [{ id: 'tiktok', nama: 'TikTok', balance: 999999, active: true, createdBy: 'u' }],
      marketplacePayouts,
      wagePayouts,
      balances: [
        { id: 'm1', itemId: 'm1', itemType: 'material', qty: 49500, lastLedgerId: 'l2' },
        { id: 'p1', itemId: 'p1', itemType: 'product', qty: 6, lastLedgerId: 'l4' },
      ],
      ledgerEntries,
      salesOrders,
      soItemsByOrderId: {
        'so-1': [{ id: 'i1', productId: 'p1', productName: 'Tas', sku: 'TAS-1', qty: 4, unitPrice: 100000, subtotal: 400000 }],
      },
      purchaseCosts,
      workOrders,
      stageLogsByWoId: {
        'wo-1': [{ id: 'sl1', stage: 'setoran', inputQty: 10, goodQty: 10, rejectQty: 0, reworkQty: 0, rejectReason: '', tanggal: '2026-11-21', createdBy: 'u' }],
      },
      itemLabels: { m1: 'Kain', p1: 'Tas' },
    });
    expect(mpBroken.some((d) => d.kind === 'marketplace_balance')).toBe(true);
  });

  it('Area 7: validasi impor bahan, impor Resep (termasuk peringatan KAIN di produk), & impor marketplace anti-duplikat', () => {
    const matRes = validateMaterialImportRows({
      rows: [
        ['KAIN-D300', 'Kain Cordura', 'kain', 'roll', 'cm', '', '500'],
        ['', 'Tanpa Kode', 'kain', 'roll', 'cm', '', '0'],
      ],
      map: { kode: 0, nama: 1, kategori: 2, satuanBeli: 3, satuanPakai: 4, konversi: 5, minStock: 6 },
      existingMaterials: [],
    });
    expect(matRes.validRows).toHaveLength(1);
    expect(matRes.validRows[0].konversi).toBeNull();
    expect(matRes.errorRows).toHaveLength(1);

    const existingMat: Material = {
      id: 'm1',
      kode: 'KAIN-D300',
      nama: 'Kain Cordura',
      kategori: 'kain',
      satuan: 'cm',
      satuanBeli: 'roll',
      satuanPakai: 'cm',
      konversi: null,
      minStock: 0,
      active: true,
      createdBy: 'u',
    };
    const suspectProd: Product = {
      id: 'p-kain',
      sku: 'KAIN-SALAH',
      nama: 'Kain Masuk Produk',
      model: '',
      warna: '',
      ukuran: '',
      satuan: 'pcs',
      minStock: 0,
      hargaJual: 0,
      active: true,
      createdBy: 'u',
    };
    const recRes = validateRecipeImportRows({
      rows: [
        ['KAIN-SALAH', 'material', 'KAIN-D300', '0.5', 'm', '', '', ''],
        ['KAIN-SALAH', 'cost', '', '', '', 'sablon', 'Sablon Depan', '12000'],
        ['KAIN-SALAH', 'material', 'KAIN-D300', '12.5', 'cm', '', '', ''], // pecahan cm ditolak
      ],
      map: {
        skuProduk: 0,
        jenisBaris: 1,
        kodeBahan: 2,
        qtyPerPcs: 3,
        satuanQty: 4,
        kategoriBiaya: 5,
        labelBiaya: 6,
        biayaPerPcs: 7,
      },
      products: [suspectProd],
      materials: [existingMat],
    });
    expect(recRes.validRows).toHaveLength(2);
    expect(recRes.validRows[0].qtyPerPcs).toBe(50);
    expect(recRes.validRows[1].amountPerPcs).toBe(12000);
    expect(recRes.errorRows).toHaveLength(1);
    expect(recRes.warningsSummary.some((w) => w.includes('mencurigakan'))).toBe(true);

    const mpRes = validateMarketplaceImportRows({
      channelName: 'Shopee',
      rows: [
        ['2026-11-22', 'SHP-001', 'KAIN-SALAH', '2', '200000', '10000', '5000', '0', 'Order 1'],
        ['2026-11-22', 'SHP-001', 'KAIN-SALAH', '2', '200000', '10000', '5000', '0', 'Duplikat'],
      ],
      map: {
        tanggal: 0,
        noPesanan: 1,
        sku: 2,
        qty: 3,
        hargaJual: 4,
        biayaAdmin: 5,
        komisiAffiliate: 6,
        potonganLain: 7,
        catatan: 8,
      },
      products: [suspectProd],
      existingImportKeys: new Set(),
      existingOrderNumbers: new Set(),
    });
    expect(mpRes.validRows).toHaveLength(1);
    expect(mpRes.validRows[0].penerimaanBersih).toBe(185000);
    expect(mpRes.skippedDuplicateRows).toHaveLength(1);
  });
});
