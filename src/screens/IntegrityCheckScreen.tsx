import React, { useCallback, useMemo, useState } from 'react';
import { Info, Play, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchAllStockBalancesPaginated,
  fetchAllStockLedgerPaginated,
} from '../services/firebase/inventoryRepo';
import {
  fetchAllAccountsPaginated,
  fetchAllMaterialsPaginated,
  fetchAllProductsPaginated,
} from '../services/firebase/masterRepo';
import {
  fetchAllMarketplaceChannelsPaginated,
  fetchAllMarketplacePayoutsPaginated,
  fetchAllPaymentsPaginated,
  fetchAllSalesOrdersPaginated,
  fetchAllSalesReturnsPaginated,
  fetchPaymentById,
  fetchSalesOrderById,
  fetchSalesOrderItems,
  fetchSalesReturnById,
} from '../services/firebase/salesRepo';
import {
  fetchAllJournalEntriesPaginated,
  fetchAllOperatingExpensesPaginated,
  fetchAllPeriodsPaginated,
  fetchAllProductionCostsPaginated,
  fetchAllPurchaseCostsPaginated,
  fetchAllWagePayoutsPaginated,
} from '../services/firebase/financeRepo';
import {
  fetchAllWorkOrdersPaginated,
  fetchStageLogs,
  fetchWorkOrderById,
} from '../services/firebase/productionRepo';
import {
  computeIntegrityAuditReport,
  type IntegrityDiscrepancy,
  type IntegrityDiscrepancyKind,
  type PriceOverrideInfo,
  type UnpricedReceiptInfo,
} from '../services/domain/accounting';
import { countCollectionDocs, normalizeFirestoreError } from '../services/firebase/common';
import type {
  Payment,
  SalesOrder,
  SalesOrderItem,
  SalesReturn,
  StageLog,
  WorkOrder,
} from '../types/models';
import { formatNumber, formatRupiah, todayJakarta } from '../utils/format';
import { ConfirmModal, ErrorBanner, LoadingCard } from '../components/ui/StateViews';

type AuditScopeMode = 'two_months' | 'all';

const KIND_LABELS: Record<IntegrityDiscrepancyKind, string> = {
  cash_balance: 'Selisih Saldo Kas/Bank',
  marketplace_balance: 'Selisih Saldo Marketplace',
  stock_balance: 'Selisih Saldo Stok',
  orphan_stock_ledger: 'Orphan Stock Ledger',
  orphan_stock_balance: 'Orphan Stock Balance',
  sales_order_total: 'Selisih Total SO',
  sales_order_payment: 'Selisih Paid SO vs Payments',
  sales_order_payment_status: 'Status Bayar SO Tidak Sinkron',
  orphan_payment: 'Payment Yatim (SO Hilang)',
  return_exceeds_sold: 'Retur Melebihi Qty Terjual',
  journal_source_mismatch: 'Jurnal vs Dokumen Sumber Tidak Cocok',
  wo_packing_qty_mismatch: 'Selisih Hasil Produksi vs Setoran',
  wo_completed_without_output: 'WO Selesai Tanpa Hasil Produksi',
  orphan_ledger_sales: 'Ledger Penjualan Yatim',
  sales_ledger_qty_mismatch: 'Selisih Qty Ledger vs SO Items',
  orphan_ledger_return: 'Ledger Retur Yatim',
  return_ledger_qty_mismatch: 'Selisih Qty Ledger vs Retur',
  orphan_ledger_wo: 'Ledger Produksi Yatim (WO)',
  closed_period_tx: 'Transaksi Periode Closed',
  journal_imbalance: 'Jurnal Tidak Seimbang',
};

const AUDIT_CHECKS: Array<{
  title: string;
  kinds: IntegrityDiscrepancyKind[];
  requiresAllScope?: boolean;
}> = [
  {
    title: '1. Saldo Kas/Bank & Saldo Marketplace',
    kinds: ['cash_balance', 'marketplace_balance'],
    requiresAllScope: true,
  },
  { title: '2. Saldo Stok vs Akumulasi Ledger', kinds: ['stock_balance'], requiresAllScope: true },
  {
    title: '3. Orphan Ledger / Balance Dua Arah',
    kinds: ['orphan_stock_ledger', 'orphan_stock_balance'],
    requiresAllScope: true,
  },
  { title: '4. Total Sales Order vs Rincian Item', kinds: ['sales_order_total'] },
  {
    title: '5. Payments vs SO Paid, Status & Yatim',
    kinds: ['sales_order_payment', 'sales_order_payment_status', 'orphan_payment'],
  },
  {
    title: '6. Referensi, Qty Ledger & Batas Retur SO',
    kinds: [
      'orphan_ledger_sales',
      'sales_ledger_qty_mismatch',
      'orphan_ledger_return',
      'return_ledger_qty_mismatch',
      'return_exceeds_sold',
    ],
  },
  {
    title: '7. Ledger Produksi, Setoran & Status WO',
    kinds: ['orphan_ledger_wo', 'wo_packing_qty_mismatch', 'wo_completed_without_output'],
  },
  { title: '8. Transaksi Setelah Periode Closed', kinds: ['closed_period_tx'] },
  {
    title: '9. Keseimbangan Jurnal & Kecocokan Sumber',
    kinds: ['journal_imbalance', 'journal_source_mismatch'],
  },
];

function computeTwoMonthMinDate(): string {
  const today = todayJakarta();
  const year = Number.parseInt(today.slice(0, 4), 10);
  const month = Number.parseInt(today.slice(5, 7), 10);
  if (month === 1) {
    return `${year - 1}-12-01`;
  }
  return `${year}-${String(month - 1).padStart(2, '0')}-01`;
}

export const IntegrityCheckScreen: React.FC = () => {
  useAuth();
  const [scopeMode, setScopeMode] = useState<AuditScopeMode>('two_months');
  const [lastExecutedScope, setLastExecutedScope] = useState<AuditScopeMode>('two_months');
  const [hasRun, setHasRun] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimatedReads, setEstimatedReads] = useState<number>(0);
  const [estimateDetail, setEstimateDetail] = useState<{ topLevel: number; subcollections: number }>({
    topLevel: 0,
    subcollections: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discrepancies, setDiscrepancies] = useState<IntegrityDiscrepancy[]>([]);
  const [unpricedReceipts, setUnpricedReceipts] = useState<UnpricedReceiptInfo[]>([]);
  const [priceOverrides, setPriceOverrides] = useState<PriceOverrideInfo[]>([]);
  const [truncatedCollections, setTruncatedCollections] = useState<string[]>([]);
  const [totalDocsRead, setTotalDocsRead] = useState(0);
  const [checkedCounts, setCheckedCounts] = useState({
    accounts: 0,
    balances: 0,
    ledger: 0,
    orders: 0,
    payments: 0,
    journals: 0,
  });

  const twoMonthMinDate = useMemo(() => computeTwoMonthMinDate(), []);

  const openConfirmWithEstimate = useCallback(async () => {
    setError(null);
    setEstimating(true);
    const minDate = scopeMode === 'two_months' ? twoMonthMinDate : undefined;
    try {
      const datedCols = [
        'stock_ledger',
        'sales_orders',
        'payments',
        'sales_returns',
        'purchase_costs',
        'production_costs',
        'operating_expenses',
        'journal_entries',
        'work_orders',
        'marketplace_payouts',
        'wage_payouts',
      ];
      const masterCols =
        scopeMode === 'all'
          ? ['accounts', 'marketplace_channels', 'stock_balances', 'periods', 'materials', 'products']
          : ['periods', 'materials', 'products'];

      const [datedCounts, masterCounts] = await Promise.all([
        Promise.all(datedCols.map((c) => countCollectionDocs(c, minDate))),
        Promise.all(masterCols.map((c) => countCollectionDocs(c))),
      ]);

      const cappedDated = datedCounts.reduce((sum, n) => sum + Math.min(n, 3000), 0);
      const cappedMaster = masterCounts.reduce((sum, n) => sum + Math.min(n, 3000), 0);
      const soCount = Math.min(datedCounts[1] ?? 0, 3000);
      const woCount = Math.min(datedCounts[8] ?? 0, 3000);
      const subEst = soCount * 6 + woCount * 4;
      const topLevel = cappedDated + cappedMaster;
      setEstimateDetail({ topLevel, subcollections: subEst });
      setEstimatedReads(topLevel + subEst);
      setConfirmOpen(true);
    } catch {
      const fallbackTop = (scopeMode === 'all' ? 17 : 14) * 3000;
      const fallbackSub = 3000 * 6 + 3000 * 4;
      setEstimateDetail({ topLevel: fallbackTop, subcollections: fallbackSub });
      setEstimatedReads(fallbackTop + fallbackSub);
      setConfirmOpen(true);
    } finally {
      setEstimating(false);
    }
  }, [scopeMode, twoMonthMinDate]);

  const runCheck = useCallback(async () => {
    setConfirmOpen(false);
    setLoading(true);
    setError(null);
    const activeScope = scopeMode;
    const minDate = activeScope === 'two_months' ? twoMonthMinDate : undefined;

    try {
      const [
        accRes,
        chRes,
        mpRes,
        wageRes,
        balRes,
        ledRes,
        soRes,
        payRes,
        retRes,
        pcRes,
        prRes,
        expRes,
        jRes,
        woRes,
        perRes,
        matRes,
        prodRes,
      ] = await Promise.all([
        activeScope === 'all'
          ? fetchAllAccountsPaginated()
          : Promise.resolve({ items: [], truncated: false, fromCache: false }),
        activeScope === 'all'
          ? fetchAllMarketplaceChannelsPaginated()
          : Promise.resolve({ items: [], truncated: false, fromCache: false }),
        fetchAllMarketplacePayoutsPaginated(minDate),
        fetchAllWagePayoutsPaginated(minDate),
        activeScope === 'all'
          ? fetchAllStockBalancesPaginated()
          : Promise.resolve({ items: [], truncated: false, fromCache: false }),
        fetchAllStockLedgerPaginated(minDate),
        fetchAllSalesOrdersPaginated(minDate),
        fetchAllPaymentsPaginated(minDate),
        fetchAllSalesReturnsPaginated(minDate),
        fetchAllPurchaseCostsPaginated(minDate),
        fetchAllProductionCostsPaginated(minDate),
        fetchAllOperatingExpensesPaginated(minDate),
        fetchAllJournalEntriesPaginated(minDate),
        fetchAllWorkOrdersPaginated(minDate),
        fetchAllPeriodsPaginated(),
        fetchAllMaterialsPaginated(),
        fetchAllProductsPaginated(),
      ]);

      const truncatedList: string[] = [];
      if (accRes.truncated) truncatedList.push('accounts');
      if (chRes.truncated) truncatedList.push('marketplace_channels');
      if (mpRes.truncated) truncatedList.push('marketplace_payouts');
      if (wageRes.truncated) truncatedList.push('wage_payouts');
      if (balRes.truncated) truncatedList.push('stock_balances');
      if (ledRes.truncated) truncatedList.push('stock_ledger');
      if (soRes.truncated) truncatedList.push('sales_orders');
      if (payRes.truncated) truncatedList.push('payments');
      if (retRes.truncated) truncatedList.push('sales_returns');
      if (pcRes.truncated) truncatedList.push('purchase_costs');
      if (prRes.truncated) truncatedList.push('production_costs');
      if (expRes.truncated) truncatedList.push('operating_expenses');
      if (jRes.truncated) truncatedList.push('journal_entries');
      if (woRes.truncated) truncatedList.push('work_orders');
      if (perRes.truncated) truncatedList.push('periods');
      if (matRes.truncated) truncatedList.push('materials');
      if (prodRes.truncated) truncatedList.push('products');
      setTruncatedCollections(truncatedList);

      const itemLabels: Record<string, string> = {};
      matRes.items.forEach((m) => {
        itemLabels[m.id] = `[Bahan] ${m.nama}`;
      });
      prodRes.items.forEach((p) => {
        itemLabels[p.id] = `[SKU] ${p.nama} (${p.ukuran})`;
      });

      const soItemsByOrderId: Record<string, SalesOrderItem[]> = {};
      let subcollectionReads = 0;
      for (let i = 0; i < soRes.items.length; i += 10) {
        const chunk = soRes.items.slice(i, i + 10);
        await Promise.all(
          chunk.map(async (so) => {
            const lines = await fetchSalesOrderItems(so.id);
            soItemsByOrderId[so.id] = lines;
            subcollectionReads += lines.length;
          }),
        );
      }

      const stageLogsByWoId: Record<string, StageLog[]> = {};
      for (let i = 0; i < woRes.items.length; i += 10) {
        const chunk = woRes.items.slice(i, i + 10);
        await Promise.all(
          chunk.map(async (wo) => {
            const res = await fetchStageLogs(wo.id, 100);
            stageLogsByWoId[wo.id] = res.items;
            subcollectionReads += res.items.length;
          }),
        );
      }

      let extraReads = 0;
      const extraSalesOrders: SalesOrder[] = [];
      const extraPayments: Payment[] = [];
      const extraSalesReturns: SalesReturn[] = [];
      const extraWorkOrders: WorkOrder[] = [];

      if (activeScope === 'two_months') {
        const loadedSoIds = new Set(soRes.items.map((s) => s.id));
        const loadedPayIds = new Set(payRes.items.map((p) => p.id));
        const loadedRetIds = new Set(retRes.items.map((r) => r.id));
        const loadedWoIds = new Set(woRes.items.map((w) => w.id));

        const missingSoIds = new Set<string>();
        const returnSoIdsNeedingItems = new Set<string>();
        for (const p of payRes.items) {
          if (p.soId && !loadedSoIds.has(p.soId)) missingSoIds.add(p.soId);
        }
        for (const r of retRes.items) {
          if (r.soId && !loadedSoIds.has(r.soId)) {
            missingSoIds.add(r.soId);
            returnSoIdsNeedingItems.add(r.soId);
          }
        }
        for (const l of ledRes.items) {
          if (l.jenis === 'penjualan' && l.refId && !loadedSoIds.has(l.refId)) {
            missingSoIds.add(l.refId);
          }
        }
        for (const j of jRes.items) {
          if (j.source === 'sales_order' && j.refId && !loadedSoIds.has(j.refId)) {
            missingSoIds.add(j.refId);
          }
        }

        const missingPayIds = new Set<string>();
        const missingRetIds = new Set<string>();
        const missingWoIds = new Set<string>();
        for (const j of jRes.items) {
          if (j.source === 'payment' && j.refId && !loadedPayIds.has(j.refId)) {
            missingPayIds.add(j.refId);
          } else if (j.source === 'sales_return' && j.refId && !loadedRetIds.has(j.refId)) {
            missingRetIds.add(j.refId);
          }
        }
        for (const l of ledRes.items) {
          if (l.jenis === 'retur' && l.refId && !loadedRetIds.has(l.refId)) {
            missingRetIds.add(l.refId);
          } else if (
            (l.jenis === 'pemakaian_produksi' || l.jenis === 'hasil_produksi') &&
            l.refId &&
            !loadedWoIds.has(l.refId)
          ) {
            missingWoIds.add(l.refId);
          }
        }

        const [fetchedSos, fetchedPays, fetchedRets, fetchedWos] = await Promise.all([
          Promise.all(
            Array.from(missingSoIds).map(async (id) => {
              extraReads += 1;
              return fetchSalesOrderById(id);
            }),
          ),
          Promise.all(
            Array.from(missingPayIds).map(async (id) => {
              extraReads += 1;
              return fetchPaymentById(id);
            }),
          ),
          Promise.all(
            Array.from(missingRetIds).map(async (id) => {
              extraReads += 1;
              return fetchSalesReturnById(id);
            }),
          ),
          Promise.all(
            Array.from(missingWoIds).map(async (id) => {
              extraReads += 1;
              return fetchWorkOrderById(id);
            }),
          ),
        ]);

        fetchedSos.forEach((s) => {
          if (s) extraSalesOrders.push(s);
        });
        fetchedPays.forEach((p) => {
          if (p) extraPayments.push(p);
        });
        fetchedRets.forEach((r) => {
          if (r) extraSalesReturns.push(r);
        });
        fetchedWos.forEach((w) => {
          if (w) extraWorkOrders.push(w);
        });

        await Promise.all(
          Array.from(returnSoIdsNeedingItems).map(async (soId) => {
            if (soItemsByOrderId[soId]) return;
            const lines = await fetchSalesOrderItems(soId);
            soItemsByOrderId[soId] = lines;
            subcollectionReads += lines.length;
          }),
        );
      }

      const topLevelReads =
        accRes.items.length +
        chRes.items.length +
        mpRes.items.length +
        wageRes.items.length +
        balRes.items.length +
        ledRes.items.length +
        soRes.items.length +
        payRes.items.length +
        retRes.items.length +
        pcRes.items.length +
        prRes.items.length +
        expRes.items.length +
        jRes.items.length +
        woRes.items.length +
        perRes.items.length +
        matRes.items.length +
        prodRes.items.length;

      const report = computeIntegrityAuditReport({
        accounts: accRes.items,
        marketplaceChannels: chRes.items,
        marketplacePayouts: mpRes.items,
        wagePayouts: wageRes.items,
        balances: balRes.items,
        ledgerEntries: ledRes.items,
        salesOrders: soRes.items,
        soItemsByOrderId,
        payments: payRes.items,
        salesReturns: retRes.items,
        purchaseCosts: pcRes.items,
        productionCosts: prRes.items,
        operatingExpenses: expRes.items,
        journalEntries: jRes.items,
        workOrders: woRes.items,
        stageLogsByWoId,
        periods: perRes.items,
        products: prodRes.items,
        itemLabels,
        scopeMode: activeScope,
        extraLookup:
          activeScope === 'two_months'
            ? {
                salesOrders: extraSalesOrders,
                payments: extraPayments,
                salesReturns: extraSalesReturns,
                workOrders: extraWorkOrders,
              }
            : undefined,
      });

      setDiscrepancies(report.discrepancies);
      setUnpricedReceipts(report.unpricedReceipts);
      setPriceOverrides(report.priceOverrides);
      setTotalDocsRead(topLevelReads + subcollectionReads + extraReads);
      setCheckedCounts({
        accounts: accRes.items.length,
        balances: balRes.items.length,
        ledger: ledRes.items.length,
        orders: soRes.items.length,
        payments: payRes.items.length,
        journals: jRes.items.length,
      });
      setLastExecutedScope(activeScope);
      setHasRun(true);
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, [scopeMode, twoMonthMinDate]);

  const checkSummary = useMemo(
    () =>
      AUDIT_CHECKS.map((chk) => ({
        title: chk.title,
        skipped: Boolean(chk.requiresAllScope && lastExecutedScope === 'two_months'),
        count: discrepancies.filter((d) => chk.kinds.includes(d.kind)).length,
      })),
    [discrepancies, lastExecutedScope],
  );

  const formatMetricValue = (d: IntegrityDiscrepancy, val: number) => {
    if (d.unit === 'rupiah') return formatRupiah(val);
    if (d.unit === 'seconds') return `${formatNumber(val)} dtk`;
    if (d.unit === 'status') {
      return val === 0 ? 'unpaid' : val === 1 ? 'dp' : 'paid';
    }
    return formatNumber(val);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Cek Integritas Data
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Audit paginasi kas/bank, Saldo Marketplace, stok-ledger, referensi SO/Retur/WO, setoran, harga modal/jual, periode, dan jurnal.
          </p>
        </div>
        <button
          type="button"
          disabled={loading || estimating}
          onClick={() => void openConfirmWithEstimate()}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {hasRun ? <RefreshCw className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {estimating ? 'Menghitung estimasi...' : hasRun ? 'Jalankan audit ulang' : 'Jalankan audit'}
        </button>
      </div>

      {/* Pemilih cakupan tanggal */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
          Cakupan Tanggal Audit
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={loading || estimating}
            onClick={() => setScopeMode('two_months')}
            className={`min-h-[44px] rounded-lg border px-3 py-2 text-left text-xs transition ${
              scopeMode === 'two_months'
                ? 'border-indigo-600 bg-indigo-50 text-indigo-950 dark:bg-indigo-950/60 dark:text-indigo-100'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
            }`}
          >
            <p className="font-bold">Bulan berjalan + bulan lalu (Default)</p>
            <p className="text-[11px] opacity-80">
              Mulai {twoMonthMinDate} · Hemat read untuk audit rutin; cek kumulatif saldo/stok dari hari ke-1 dilewati.
            </p>
          </button>
          <button
            type="button"
            disabled={loading || estimating}
            onClick={() => setScopeMode('all')}
            className={`min-h-[44px] rounded-lg border px-3 py-2 text-left text-xs transition ${
              scopeMode === 'all'
                ? 'border-indigo-600 bg-indigo-50 text-indigo-950 dark:bg-indigo-950/60 dark:text-indigo-100'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
            }`}
          >
            <p className="font-bold">Semua periode</p>
            <p className="text-[11px] opacity-80">
              Audit penuh seluruh riwayat termasuk saldo kas/bank, Saldo Marketplace &amp; stok kumulatif sejak awal.
            </p>
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Konfirmasi Biaya Pembacaan Audit Integritas"
        message={`Cakupan dipilih: ${
          scopeMode === 'two_months'
            ? `Bulan berjalan + bulan lalu (mulai ${twoMonthMinDate})`
            : 'Semua periode'
        }. Estimasi pembacaan saat ini: ${formatNumber(estimateDetail.topLevel)} dokumen utama + hingga ${formatNumber(
          estimateDetail.subcollections,
        )} dokumen subkoleksi (total maks ~${formatNumber(estimatedReads)} baca). Lanjutkan?`}
        confirmLabel="Jalankan audit"
        busy={loading}
        onConfirm={() => void runCheck()}
        onCancel={() => setConfirmOpen(false)}
      />

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <p>
            <strong>Catatan Retur &amp; Kas:</strong> Retur penjualan marketplace memotong{' '}
            <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">Saldo Marketplace</code> dan{' '}
            <strong>tidak mengubah saldo akun kas/bank</strong> secara otomatis.
          </p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void openConfirmWithEstimate()} />}

      {truncatedCollections.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
          Sebagian koleksi melebihi batas paginasi 3.000 dokumen ({truncatedCollections.join(', ')}). Hasil audit terbatas pada 3.000 dokumen pertama per koleksi tersebut.
        </div>
      )}

      {loading ? (
        <LoadingCard label="Menjalankan 9 pemeriksaan integritas & info audit lintas koleksi..." />
      ) : !hasRun ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900">
          <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-indigo-600 dark:text-indigo-400" />
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Audit Integritas Siap Dijalankan
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
            Untuk menghemat kuota baca Firestore, audit tidak berjalan otomatis saat layar dibuka. Pilih cakupan tanggal lalu klik tombol <strong>Jalankan audit</strong> dan konfirmasi estimasi pembacaan.
          </p>
          <button
            type="button"
            disabled={estimating}
            onClick={() => void openConfirmWithEstimate()}
            className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" /> {estimating ? 'Menghitung estimasi...' : 'Jalankan audit'}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs text-indigo-950 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-100">
            <span>
              Total dokumen dibaca pada audit ini:{' '}
              <strong className="tabular-nums">{formatNumber(totalDocsRead)} dokumen</strong>
            </span>
            <span className="text-[11px] text-indigo-800 dark:text-indigo-300">
              Cakupan:{' '}
              {lastExecutedScope === 'two_months'
                ? `Bulan berjalan + bulan lalu (>= ${twoMonthMinDate})`
                : 'Semua periode'}{' '}
              · Estimasi awal: {formatNumber(estimatedReads)} baca
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-white p-3 text-center text-xs tabular-nums sm:grid-cols-6 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <p className="text-slate-500 dark:text-slate-400">Akun Kas</p>
              <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                {lastExecutedScope === 'two_months' ? '—' : checkedCounts.accounts}
              </p>
            </div>
            <div>
              <p className="text-slate-500 dark:text-slate-400">Saldo Stok</p>
              <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                {lastExecutedScope === 'two_months' ? '—' : checkedCounts.balances}
              </p>
            </div>
            <div>
              <p className="text-slate-500 dark:text-slate-400">Entri Ledger</p>
              <p className="text-base font-bold text-slate-900 dark:text-slate-100">{checkedCounts.ledger}</p>
            </div>
            <div>
              <p className="text-slate-500 dark:text-slate-400">Sales Order</p>
              <p className="text-base font-bold text-slate-900 dark:text-slate-100">{checkedCounts.orders}</p>
            </div>
            <div>
              <p className="text-slate-500 dark:text-slate-400">Pembayaran</p>
              <p className="text-base font-bold text-slate-900 dark:text-slate-100">{checkedCounts.payments}</p>
            </div>
            <div>
              <p className="text-slate-500 dark:text-slate-400">Jurnal</p>
              <p className="text-base font-bold text-slate-900 dark:text-slate-100">{checkedCounts.journals}</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="mb-2 text-xs font-bold text-slate-800 dark:text-slate-100">
              Ringkasan 9 Pemeriksaan Integritas
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {checkSummary.map((item) => (
                <div
                  key={item.title}
                  className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-950/60"
                >
                  <span className="text-slate-700 dark:text-slate-200">{item.title}</span>
                  {item.skipped ? (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      Dilewati (cakupan 2 bln)
                    </span>
                  ) : (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        item.count === 0
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                      }`}
                    >
                      {item.count === 0 ? 'Tidak ada selisih' : `${item.count} temuan`}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {discrepancies.length === 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="text-sm font-bold">Tidak ada selisih</p>
                  <p className="text-xs text-emerald-800 dark:text-emerald-200">
                    {lastExecutedScope === 'two_months'
                      ? `Seluruh pemeriksaan transaksi cakupan >= ${twoMonthMinDate} valid. Jalankan mode "Semua periode" secara berkala untuk audit saldo kas/marketplace/stok kumulatif.`
                      : 'Seluruh 9 pemeriksaan integritas (kas/bank, marketplace, stok & orphan ledger, referensi SO/Retur/WO, setoran, periode tutup buku, dan jurnal) valid.'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {discrepancies.map((d) => (
                <div
                  key={`${d.kind}-${d.id}`}
                  className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-100"
                >
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    <div className="flex-1">
                      <p className="font-bold">
                        [{KIND_LABELS[d.kind]}] {d.label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-rose-800 dark:text-rose-200">
                        Dokumen: <code className="rounded bg-rose-100 px-1 dark:bg-rose-900">{d.id}</code>
                        {d.detail ? ` — ${d.detail}` : ''}
                      </p>
                      <p className="mt-1 tabular-nums">
                        Tercatat: {d.unit === 'seconds' ? 'Pasca tutup' : formatMetricValue(d, d.recordedValue)} ·
                        Hitung Ulang: {d.unit === 'seconds' ? 'Sebelum tutup' : formatMetricValue(d, d.recalculatedValue)} ·
                        Selisih:{' '}
                        <strong>
                          {d.unit === 'status'
                            ? `${d.difference} tingkat`
                            : formatMetricValue(d, d.difference)}
                        </strong>
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* INFO: Penerimaan bahan baku belum diberi harga */}
          <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 text-xs text-slate-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-slate-200">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                <h3 className="font-bold text-slate-900 dark:text-slate-100">
                  INFO: Penerimaan Belum Diberi Harga
                </h3>
              </div>
              <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-bold text-sky-800 dark:bg-sky-900 dark:text-sky-200">
                {unpricedReceipts.length === 0 ? 'Semua sudah diberi harga' : `${unpricedReceipts.length} belum diberi harga`}
              </span>
            </div>
            {unpricedReceipts.length === 0 ? (
              <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">
                Seluruh entri penerimaan bahan baku di stock_ledger dalam cakupan sudah memiliki pasangan dokumen purchase_costs.
              </p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {unpricedReceipts.map((item) => (
                  <div
                    key={item.ledgerId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-white px-3 py-2 dark:border-sky-900 dark:bg-slate-900"
                  >
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {item.itemLabel} (+{formatNumber(item.qty)})
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {item.tanggal} · Ledger <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{item.ledgerId}</code> · Oleh {item.createdByName}
                        {item.catatan ? ` · ${item.catatan}` : ''}
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      Belum diberi harga
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* INFO: Override harga pada Sales Order */}
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-slate-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-slate-200">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                <h3 className="font-bold text-slate-900 dark:text-slate-100">
                  INFO: Override Harga Penjualan
                </h3>
              </div>
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-900 dark:bg-amber-900 dark:text-amber-200">
                {priceOverrides.length === 0 ? 'Tidak ada override harga' : `${priceOverrides.length} override harga`}
              </span>
            </div>
            {priceOverrides.length === 0 ? (
              <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">
                Seluruh item Sales Order dalam cakupan memakai harga jual standar pada master produk.
              </p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {priceOverrides.map((ov, idx) => (
                  <div
                    key={`${ov.soId}-${ov.productId}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 dark:border-amber-900 dark:bg-slate-900"
                  >
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {ov.soNumber} ({ov.tanggal}) · {ov.productLabel}
                      </p>
                      <p className="text-[11px] text-slate-600 tabular-nums dark:text-slate-400">
                        Harga normal: {formatRupiah(ov.normalPrice)} → Harga dipakai: <strong>{formatRupiah(ov.usedPrice)}</strong> ({ov.qty} pcs) · Pembuat: <strong>{ov.createdByName}</strong>
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 tabular-nums dark:bg-amber-900 dark:text-amber-200">
                      Override harga ({ov.differencePerUnit >= 0 ? `+${formatRupiah(ov.differencePerUnit)}` : formatRupiah(ov.differencePerUnit)})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
