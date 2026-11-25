import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Download,
  Landmark,
  RotateCcw,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  createReversalJournal,
  fetchAccountingSettings,
  fetchAllJournalEntriesPaginated,
  fetchAllOperatingExpensesPaginated,
  fetchAllProductionCostsPaginated,
  fetchAllPurchaseCostsPaginated,
  fetchAllWagePayoutsPaginated,
  saveModalAwalSetting,
} from '../services/firebase/financeRepo';
import { fetchAllStockLedgerPaginated } from '../services/firebase/inventoryRepo';
import {
  fetchAllAccountsPaginated,
  fetchAllBomItemsPaginated,
  fetchAllProductsPaginated,
} from '../services/firebase/masterRepo';
import { fetchAllWorkOrdersPaginated } from '../services/firebase/productionRepo';
import {
  fetchAllMarketplaceChannelsPaginated,
  fetchAllMarketplacePayoutsPaginated,
  fetchAllPaymentsPaginated,
  fetchAllSalesOrdersPaginated,
  fetchAllSalesReturnsPaginated,
} from '../services/firebase/salesRepo';
import {
  calculateWeightedAverageCosts,
  computeBalanceSheet,
  computeCashFlowReport,
  computeProfitAndLoss,
} from '../services/domain/accounting';
import {
  downloadBalanceSheetCsv,
  downloadCashFlowCsv,
  downloadProfitLossCsv,
} from '../services/domain/csv';
import { normalizeFirestoreError } from '../services/firebase/common';
import type { JournalEntry } from '../types/models';
import { currentPeriodJakarta, formatRupiah, parseLocaleNumber, todayJakarta } from '../utils/format';
import {
  CacheNoticeBanner,
  EmptyState,
  ErrorBanner,
  LoadingCard,
  OfflineWriteBlockedBanner,
} from '../components/ui/StateViews';

type ReportTab = 'pnl' | 'cashflow' | 'balance_sheet' | 'journals';

export const ProfitLossScreen: React.FC = () => {
  const { profile, isOnline } = useAuth();
  const [tab, setTab] = useState<ReportTab>('pnl');
  const [periodFilter, setPeriodFilter] = useState(currentPeriodJakarta());
  const [showAllPeriods, setShowAllPeriods] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  // Modal Awal Pemilik (kosong/null hingga diisi pemilik; TANPA angka tebakan)
  const [modalAwalInput, setModalAwalInput] = useState('');
  const [savingModal, setSavingModal] = useState(false);

  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [bundle, setBundle] = useState<{
    weightedPeriod: ReturnType<typeof calculateWeightedAverageCosts>;
    pnlPeriod: ReturnType<typeof computeProfitAndLoss>;
    cashFlow: ReturnType<typeof computeCashFlowReport>;
    balanceSheet: ReturnType<typeof computeBalanceSheet>;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        accRes,
        chRes,
        mpRes,
        ledRes,
        pcRes,
        prcRes,
        woRes,
        bomRes,
        soRes,
        payRes,
        retRes,
        expRes,
        wageRes,
        jRes,
        prodRes,
        settings,
      ] = await Promise.all([
        fetchAllAccountsPaginated(),
        fetchAllMarketplaceChannelsPaginated(),
        fetchAllMarketplacePayoutsPaginated(),
        fetchAllStockLedgerPaginated(),
        fetchAllPurchaseCostsPaginated(),
        fetchAllProductionCostsPaginated(),
        fetchAllWorkOrdersPaginated(),
        fetchAllBomItemsPaginated(),
        fetchAllSalesOrdersPaginated(),
        fetchAllPaymentsPaginated(),
        fetchAllSalesReturnsPaginated(),
        fetchAllOperatingExpensesPaginated(),
        fetchAllWagePayoutsPaginated(),
        fetchAllJournalEntriesPaginated(),
        fetchAllProductsPaginated(),
        fetchAccountingSettings(),
      ]);

      const activeFilter = showAllPeriods ? undefined : periodFilter;

      const weightedPeriod = calculateWeightedAverageCosts({
        ledgerEntries: ledRes.items,
        purchaseCosts: pcRes.items,
        productionCosts: prcRes.items,
        workOrders: woRes.items,
        bomItems: bomRes.items,
        wagePayouts: wageRes.items,
        products: prodRes.items,
        periodFilter: activeFilter,
      });

      const pnlPeriod = computeProfitAndLoss({
        salesOrders: soRes.items,
        returns: retRes.items,
        operatingExpenses: expRes.items,
        hppTotal: weightedPeriod.cogsTotal,
        rejectExpenseTotal: weightedPeriod.rejectExpenseTotal,
        wagePayouts: wageRes.items,
        opnameAdjustmentTotal: weightedPeriod.opnameAdjustmentTotal,
        periodFilter: activeFilter,
      });

      const cashFlow = computeCashFlowReport({
        accounts: accRes.items,
        marketplacePayouts: mpRes.items,
        payments: payRes.items,
        purchaseCosts: pcRes.items,
        productionCosts: prcRes.items,
        wagePayouts: wageRes.items,
        operatingExpenses: expRes.items,
        journalEntries: jRes.items,
        periodFilter: activeFilter,
      });

      // Neraca bersifat kumulatif sepanjang waktu sehingga Laba Ditahan selalu sinkron dengan Aset & Liabilitas
      const weightedAll = activeFilter
        ? calculateWeightedAverageCosts({
            ledgerEntries: ledRes.items,
            purchaseCosts: pcRes.items,
            productionCosts: prcRes.items,
            workOrders: woRes.items,
            bomItems: bomRes.items,
            wagePayouts: wageRes.items,
            products: prodRes.items,
          })
        : weightedPeriod;

      const pnlAll = activeFilter
        ? computeProfitAndLoss({
            salesOrders: soRes.items,
            returns: retRes.items,
            operatingExpenses: expRes.items,
            hppTotal: weightedAll.cogsTotal,
            rejectExpenseTotal: weightedAll.rejectExpenseTotal,
            wagePayouts: wageRes.items,
            opnameAdjustmentTotal: weightedAll.opnameAdjustmentTotal,
          })
        : pnlPeriod;

      const savedModalAwal = settings?.modalAwal ?? null;
      setModalAwalInput(savedModalAwal === null ? '' : String(savedModalAwal));

      const balanceSheet = computeBalanceSheet({
        accounts: accRes.items,
        marketplaceChannels: chRes.items,
        salesOrders: soRes.items,
        returns: retRes.items,
        marketplacePayouts: mpRes.items,
        purchaseCosts: pcRes.items,
        productionCosts: prcRes.items,
        journalEntries: jRes.items,
        costs: weightedAll,
        profitLoss: pnlAll,
        modalAwal: savedModalAwal,
      });

      setBundle({ weightedPeriod, pnlPeriod, cashFlow, balanceSheet });
      setJournals(jRes.items);
      setFromCache(ledRes.fromCache || jRes.fromCache);
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, [periodFilter, showAllPeriods]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredJournals = useMemo(
    () =>
      showAllPeriods
        ? journals
        : journals.filter((j) => j.tanggal.startsWith(periodFilter)),
    [journals, periodFilter, showAllPeriods],
  );

  const handleSaveModalAwal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSavingModal(true);
    setError(null);
    setMsg(null);
    try {
      const trimmed = modalAwalInput.trim();
      let value: number | null = null;
      if (trimmed !== '') {
        const parsed = parseLocaleNumber(trimmed);
        if (!Number.isInteger(parsed) || parsed < 0) {
          throw new Error('Modal awal harus berupa rupiah bulat >= 0 atau dikosongkan.');
        }
        value = parsed;
      }
      await saveModalAwalSetting({ actorUid: profile.uid, modalAwal: value });
      setMsg(
        value === null
          ? 'Modal awal dikosongkan.'
          : `Modal awal pemilik disimpan: ${formatRupiah(value)}.`,
      );
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setSavingModal(false);
    }
  };

  const activePeriodLabel = showAllPeriods ? 'semua-periode' : periodFilter;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Laporan Keuangan (Laba Rugi, Arus Kas &amp; Neraca)
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          HPP weighted-average pecahan dihitung akurat dari ledger, Arus Kas murni uang tunai/bank, dan Neraca tanpa angka plug.
        </p>
      </div>

      <OfflineWriteBlockedBanner isOnline={isOnline} />
      <CacheNoticeBanner visible={fromCache} />
      {msg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
          {msg}
        </div>
      )}
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {/* Filter Periode & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="month"
            disabled={showAllPeriods}
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
            className="min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs disabled:opacity-50"
          />
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={showAllPeriods}
              onChange={(e) => setShowAllPeriods(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            Semua Periode
          </label>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[
            ['pnl', 'Laba Rugi'],
            ['cashflow', 'Arus Kas'],
            ['balance_sheet', 'Neraca'],
            ['journals', 'Jurnal'],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k as ReportTab)}
              className={`min-h-[38px] rounded-lg px-3 text-xs font-semibold transition ${
                tab === k
                  ? 'bg-indigo-600 text-white'
                  : 'border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingCard />
      ) : bundle ? (
        <>
          {tab === 'pnl' && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                  <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  Laporan Laba Rugi ({showAllPeriods ? 'Semua Periode' : periodFilter})
                </h3>
                <button
                  type="button"
                  onClick={() => downloadProfitLossCsv(activePeriodLabel, bundle.pnlPeriod)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" /> Ekspor CSV
                </button>
              </div>
              <div className="space-y-2 text-xs tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-300">Penjualan Kotor (Harga Jual)</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatRupiah(bundle.pnlPeriod.grossSales)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-300">
                    (-) Potongan Marketplace (Admin, Affiliate, Promo)
                  </span>
                  <span className="font-semibold text-rose-700 dark:text-rose-400">
                    -{formatRupiah(bundle.pnlPeriod.marketplaceFeesTotal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-300">(-) Retur Penjualan</span>
                  <span className="font-semibold text-rose-700 dark:text-rose-400">
                    -{formatRupiah(bundle.pnlPeriod.returnsTotal)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                  <span className="font-bold text-slate-900 dark:text-slate-100">Penjualan Bersih</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {formatRupiah(bundle.pnlPeriod.netSales)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-300">(-) HPP (Weighted Average)</span>
                  <span className="font-semibold text-rose-700 dark:text-rose-400">
                    -{formatRupiah(bundle.pnlPeriod.hppTotal)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                  <span className="font-bold text-slate-900 dark:text-slate-100">Laba Kotor</span>
                  <span className="font-bold text-indigo-700 dark:text-indigo-300">
                    {formatRupiah(bundle.pnlPeriod.grossProfit)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-300">(-) Beban Reject Produksi</span>
                  <span className="font-semibold text-rose-700 dark:text-rose-400">
                    -{formatRupiah(bundle.pnlPeriod.rejectExpenseTotal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-300">
                    (-) Selisih Biaya Produksi (Upah Aktual vs Standar)
                  </span>
                  <span
                    className={`font-semibold ${
                      bundle.pnlPeriod.wageVarianceTotal > 0
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {bundle.pnlPeriod.wageVarianceTotal >= 0
                      ? `-${formatRupiah(bundle.pnlPeriod.wageVarianceTotal)}`
                      : `+${formatRupiah(Math.abs(bundle.pnlPeriod.wageVarianceTotal))}`}
                  </span>
                </div>
                {bundle.pnlPeriod.opnameAdjustmentTotal !== 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-300">(+/-) Selisih Koreksi Opname</span>
                    <span
                      className={`font-semibold ${
                        bundle.pnlPeriod.opnameAdjustmentTotal >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {formatRupiah(bundle.pnlPeriod.opnameAdjustmentTotal)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-300">(-) Beban Operasional (Gaji Admin, dll)</span>
                  <span className="font-semibold text-rose-700 dark:text-rose-400">
                    -{formatRupiah(bundle.pnlPeriod.operatingExpensesTotal)}
                  </span>
                </div>
                <div className="flex justify-between border-t-2 border-slate-200 pt-2.5 text-sm dark:border-slate-700">
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    Laba Bersih (Margin {bundle.pnlPeriod.marginPercent}%)
                  </span>
                  <span
                    className={`font-bold ${
                      bundle.pnlPeriod.netProfit >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {formatRupiah(bundle.pnlPeriod.netProfit)}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-3 text-xs tabular-nums sm:grid-cols-3 dark:bg-slate-950/60">
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Valuasi Bahan Baku</p>
                  <p className="font-bold text-slate-900 dark:text-slate-100">
                    {formatRupiah(bundle.weightedPeriod.totalMaterialValue)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Valuasi WIP Produksi</p>
                  <p className="font-bold text-slate-900 dark:text-slate-100">
                    {formatRupiah(bundle.weightedPeriod.totalWipValue)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Valuasi Barang Jadi</p>
                  <p className="font-bold text-slate-900 dark:text-slate-100">
                    {formatRupiah(bundle.weightedPeriod.totalProductValue)}
                  </p>
                </div>
              </div>
            </section>
          )}

          {tab === 'cashflow' && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                  <Banknote className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Laporan Arus Kas Riil (Kas &amp; Bank)
                </h3>
                <button
                  type="button"
                  onClick={() => downloadCashFlowCsv(activePeriodLabel, bundle.cashFlow)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" /> Ekspor CSV
                </button>
              </div>
              <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
                Hanya mencatat uang kas &amp; bank yang benar-benar masuk/keluar. Saldo Marketplace yang belum dicairkan tidak masuk sampai dicairkan.
              </p>

              <div className="space-y-2 text-xs tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-300">Saldo Awal Akun Kas &amp; Bank</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatRupiah(bundle.cashFlow.openingCashBank)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-300">(+) Kas Masuk: Pencairan Saldo Marketplace</span>
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                    +{formatRupiah(bundle.cashFlow.marketplacePayoutInflows)}
                  </span>
                </div>
                {bundle.cashFlow.directSalesPaymentInflows > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-300">(+) Kas Masuk: Pembayaran Penjualan Langsung</span>
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                      +{formatRupiah(bundle.cashFlow.directSalesPaymentInflows)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                  <span className="font-bold text-slate-900 dark:text-slate-100">Total Kas Masuk</span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">
                    {formatRupiah(bundle.cashFlow.totalCashInflows)}
                  </span>
                </div>

                <div className="flex justify-between pt-1">
                  <span className="text-slate-600 dark:text-slate-300">(-) Pembelian Bahan Baku</span>
                  <span className="font-semibold text-rose-700 dark:text-rose-400">
                    -{formatRupiah(bundle.cashFlow.purchaseCashOutflows)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-300">(-) Pembayaran Upah Mingguan</span>
                  <span className="font-semibold text-rose-700 dark:text-rose-400">
                    -{formatRupiah(bundle.cashFlow.wagePayoutCashOutflows)}
                  </span>
                </div>
                {bundle.cashFlow.productionCashOutflows > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-300">(-) Biaya Produksi / CMT</span>
                    <span className="font-semibold text-rose-700 dark:text-rose-400">
                      -{formatRupiah(bundle.cashFlow.productionCashOutflows)}
                    </span>
                  </div>
                )}
                {bundle.cashFlow.apSettlementCashOutflows > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-300">(-) Pelunasan Utang Supplier/CMT</span>
                    <span className="font-semibold text-rose-700 dark:text-rose-400">
                      -{formatRupiah(bundle.cashFlow.apSettlementCashOutflows)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-300">(-) Beban Operasional (Gaji Admin, dll)</span>
                  <span className="font-semibold text-rose-700 dark:text-rose-400">
                    -{formatRupiah(bundle.cashFlow.operatingExpenseCashOutflows)}
                  </span>
                </div>

                <div className="flex justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                  <span className="font-bold text-slate-900 dark:text-slate-100">Total Kas Keluar</span>
                  <span className="font-bold text-rose-700 dark:text-rose-400">
                    -{formatRupiah(bundle.cashFlow.totalCashOutflows)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                  <span className="font-bold text-slate-900 dark:text-slate-100">Perubahan Kas Bersih Periode Ini</span>
                  <span className="font-bold text-indigo-700 dark:text-indigo-300">
                    {formatRupiah(bundle.cashFlow.netCashChange)}
                  </span>
                </div>
                <div className="flex justify-between border-t-2 border-slate-200 pt-2 text-sm dark:border-slate-700">
                  <span className="font-bold text-slate-900 dark:text-slate-100">Saldo Kas &amp; Bank Saat Ini</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {formatRupiah(bundle.cashFlow.recordedCashBank)}
                  </span>
                </div>
              </div>
            </section>
          )}

          {tab === 'balance_sheet' && (
            <div className="space-y-4">
              {/* Pengaturan Modal Awal (Kosong sampai diisi pemilik) */}
              <form
                onSubmit={handleSaveModalAwal}
                className="flex flex-wrap items-end gap-2.5 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="min-w-[220px] flex-1">
                  <label className="mb-1 block text-xs font-bold text-slate-800 dark:text-slate-200">
                    Modal Awal Pemilik (Rp — kosongkan jika belum diketahui)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={modalAwalInput}
                    onChange={(e) => setModalAwalInput(e.target.value)}
                    placeholder="Kosong (belum diisi pemilik)"
                    className="min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!isOnline || savingModal}
                  className="min-h-[42px] rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {savingModal ? 'Menyimpan...' : 'Simpan Modal Awal'}
                </button>
              </form>

              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                    <Landmark className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    Neraca Keuangan Kumulatif (Tanpa Angka Plug)
                  </h3>
                  <button
                    type="button"
                    onClick={() => downloadBalanceSheetCsv(bundle.balanceSheet)}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Download className="h-3.5 w-3.5" /> Ekspor CSV
                  </button>
                </div>

                {/* Status keseimbangan Neraca */}
                <div
                  className={`mb-4 flex items-center justify-between rounded-lg border px-3 py-2.5 text-xs ${
                    bundle.balanceSheet.isBalanced
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200'
                      : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200'
                  }`}
                >
                  <span className="flex items-center gap-2 font-bold">
                    {bundle.balanceSheet.isBalanced ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                    )}
                    {bundle.balanceSheet.isBalanced
                      ? 'Neraca Seimbang (Aset = Liabilitas + Ekuitas)'
                      : 'Selisih Neraca Terdeteksi (periksa Modal Awal / Saldo Awal Akun / Harga Bahan)'}
                  </span>
                  <span className="font-bold tabular-nums">
                    Selisih: {formatRupiah(bundle.balanceSheet.selisih)}
                  </span>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {/* Aset */}
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-xs tabular-nums dark:border-slate-800">
                    <h4 className="font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                      ASET
                    </h4>
                    <div className="flex justify-between">
                      <span>Kas Tunai</span>
                      <span>{formatRupiah(bundle.balanceSheet.kasBalance)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Bank</span>
                      <span>{formatRupiah(bundle.balanceSheet.bankBalance)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Saldo Marketplace (Belum Cair)</span>
                      <span>{formatRupiah(bundle.balanceSheet.marketplaceBalance)}</span>
                    </div>
                    {bundle.balanceSheet.receivablesBalance > 0 && (
                      <div className="flex justify-between">
                        <span>Piutang Usaha (Order Lama)</span>
                        <span>{formatRupiah(bundle.balanceSheet.receivablesBalance)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Persediaan Bahan Baku</span>
                      <span>{formatRupiah(bundle.balanceSheet.materialInventoryValue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Persediaan WIP Produksi</span>
                      <span>{formatRupiah(bundle.balanceSheet.wipInventoryValue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Persediaan Barang Jadi</span>
                      <span>{formatRupiah(bundle.balanceSheet.productInventoryValue)}</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold dark:border-slate-700">
                      <span>Total Aset</span>
                      <span>{formatRupiah(bundle.balanceSheet.totalAssets)}</span>
                    </div>
                  </div>

                  {/* Liabilitas + Ekuitas */}
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-xs tabular-nums dark:border-slate-800">
                    <h4 className="font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                      LIABILITAS &amp; EKUITAS
                    </h4>
                    <div className="flex justify-between">
                      <span>Utang Supplier Bahan</span>
                      <span>{formatRupiah(bundle.balanceSheet.supplierPayables)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Utang Produksi / CMT</span>
                      <span>{formatRupiah(bundle.balanceSheet.productionPayables)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Akrual Upah Produksi (Belum Dibayar)</span>
                      <span>{formatRupiah(bundle.balanceSheet.accruedWages)}</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-100 pt-1.5 font-semibold dark:border-slate-800">
                      <span>Total Liabilitas</span>
                      <span>{formatRupiah(bundle.balanceSheet.totalLiabilities)}</span>
                    </div>
                    <div className="flex justify-between pt-1">
                      <span>
                        Modal Awal Pemilik{' '}
                        {bundle.balanceSheet.modalAwal === null && (
                          <span className="text-amber-600 dark:text-amber-400">(Belum diisi)</span>
                        )}
                      </span>
                      <span>{formatRupiah(bundle.balanceSheet.modalAwalUsed)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Laba Ditahan Kumulatif</span>
                      <span>{formatRupiah(bundle.balanceSheet.retainedEarnings)}</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-100 pt-1.5 font-semibold dark:border-slate-800">
                      <span>Total Ekuitas</span>
                      <span>{formatRupiah(bundle.balanceSheet.totalEquity)}</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold dark:border-slate-700">
                      <span>Total Liabilitas + Ekuitas</span>
                      <span>{formatRupiah(bundle.balanceSheet.totalLiabilitiesAndEquity)}</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {tab === 'journals' && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-100">
                Jurnal Umum (Append-Only)
              </h3>
              {filteredJournals.length === 0 ? (
                <EmptyState description="Belum ada entri jurnal pada periode yang dipilih." />
              ) : (
                <div className="space-y-2">
                  {filteredJournals.map((j) => (
                    <div
                      key={j.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60"
                    >
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {j.deskripsi}{' '}
                          {j.isReversal && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                              REVERSAL
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {j.tanggal} · Dr: {j.debitAccount} · Cr: {j.creditAccount}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 tabular-nums dark:text-slate-100">
                          {formatRupiah(j.amount)}
                        </span>
                        {!j.isReversal && profile && (
                          <button
                            type="button"
                            disabled={!isOnline}
                            onClick={() => {
                              void createReversalJournal({
                                actorUid: profile.uid,
                                actorName: profile.nama,
                                original: j,
                                tanggal: todayJakarta(),
                                alasan: `Koreksi reversal oleh ${profile.nama}`,
                              })
                                .then(() => {
                                  setMsg('Jurnal pembalik (reversal) berhasil dibuat di periode terbuka.');
                                  return load();
                                })
                                .catch((err) => setError(normalizeFirestoreError(err)));
                            }}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          >
                            <RotateCcw className="h-3 w-3" /> Reverse
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      ) : null}
    </div>
  );
};
