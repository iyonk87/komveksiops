import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Calendar, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { computeWeeklyWagesSummary } from '../services/domain/accounting';
import { normalizeFirestoreError } from '../services/firebase/common';
import { fetchWagePayouts, recordWagePayout } from '../services/firebase/financeRepo';
import { fetchAccounts, fetchBomItems, fetchProducts } from '../services/firebase/masterRepo';
import { fetchStageLogs, fetchWorkOrders } from '../services/firebase/productionRepo';
import type { Account, BomItem, Product, StageLog, WagePayout, WorkOrder } from '../types/models';
import { formatNumber, formatRupiah, parseIntegerInput, todayJakarta } from '../utils/format';
import {
  CacheNoticeBanner,
  EmptyState,
  ErrorBanner,
  LoadingCard,
  OfflineWriteBlockedBanner,
} from '../components/ui/StateViews';

function shiftDateJakarta(baseDate: string, deltaDays: number): string {
  const dt = new Date(`${baseDate}T00:00:00+07:00`);
  dt.setDate(dt.getDate() + deltaDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt);
}

export const WagesScreen: React.FC = () => {
  const { profile, isOnline } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [saving, setSaving] = useState(false);

  const today = todayJakarta();
  const [startDate, setStartDate] = useState(() => shiftDateJakarta(today, -6));
  const [endDate, setEndDate] = useState(today);
  const [payDate, setPayDate] = useState(today);

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [stageLogsByWoId, setStageLogsByWoId] = useState<Record<string, StageLog[]>>({});
  const [bomItems, setBomItems] = useState<BomItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [wagePayouts, setWagePayouts] = useState<WagePayout[]>([]);

  const [accountId, setAccountId] = useState('');
  const [jahitCuttingPaid, setJahitCuttingPaid] = useState('0');
  const [sablonPaid, setSablonPaid] = useState('0');
  const [packingPaid, setPackingPaid] = useState('0');
  const [lainnyaPaid, setLainnyaPaid] = useState('0');
  const [catatan, setCatatan] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [woRes, bomRes, prodRes, accRes, payRes] = await Promise.all([
        fetchWorkOrders(100),
        fetchBomItems(undefined, 300),
        fetchProducts(150),
        fetchAccounts(50),
        fetchWagePayouts(50),
      ]);

      const activeWos = woRes.items.filter((w) => w.status !== 'cancelled');
      const logsResults = await Promise.all(activeWos.map((w) => fetchStageLogs(w.id, 100)));
      const logsMap: Record<string, StageLog[]> = {};
      activeWos.forEach((w, idx) => {
        logsMap[w.id] = logsResults[idx].items;
      });

      setWorkOrders(woRes.items);
      setStageLogsByWoId(logsMap);
      setBomItems(bomRes.items);
      setProducts(prodRes.items);
      setAccounts(accRes.items.filter((a) => a.active));
      setWagePayouts(payRes.items);
      setFromCache(woRes.fromCache || bomRes.fromCache || prodRes.fromCache || payRes.fromCache);
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(
    () =>
      computeWeeklyWagesSummary({
        startDate,
        endDate,
        workOrders,
        stageLogsByWoId,
        bomItems,
        products,
        wagePayouts,
      }),
    [bomItems, endDate, products, stageLogsByWoId, startDate, wagePayouts, workOrders],
  );

  const syncFromStandard = () => {
    setJahitCuttingPaid(String(summary.jahitCuttingStandard));
    setSablonPaid(String(summary.sablonStandard));
    setPackingPaid(String(summary.packingStandard));
    setLainnyaPaid(String(summary.lainnyaStandard));
  };

  useEffect(() => {
    syncFromStandard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.jahitCuttingStandard, summary.sablonStandard, summary.packingStandard, summary.lainnyaStandard]);

  const totalPaidInput =
    parseIntegerInput(jahitCuttingPaid) +
    parseIntegerInput(sablonPaid) +
    parseIntegerInput(packingPaid) +
    parseIntegerInput(lainnyaPaid);
  const liveVariance = totalPaidInput - summary.totalStandard;

  const handleRecordPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setError(null);
    setMsg(null);
    const chosenAcc = accounts.find((a) => a.id === accountId);
    if (!chosenAcc) {
      setError('Pilih akun kas/bank pembayar upah.');
      return;
    }

    setSaving(true);
    try {
      await recordWagePayout({
        actorUid: profile.uid,
        actorName: profile.nama,
        startDate,
        endDate,
        tanggal: payDate,
        accountId: chosenAcc.id,
        accountName: chosenAcc.nama,
        jahitCuttingStandard: summary.jahitCuttingStandard,
        sablonStandard: summary.sablonStandard,
        packingStandard: summary.packingStandard,
        lainnyaStandard: summary.lainnyaStandard,
        jahitCuttingPaid: parseIntegerInput(jahitCuttingPaid),
        sablonPaid: parseIntegerInput(sablonPaid),
        packingPaid: parseIntegerInput(packingPaid),
        lainnyaPaid: parseIntegerInput(lainnyaPaid),
        catatan,
      });
      setMsg(
        `Pembayaran upah mingguan (${formatRupiah(totalPaidInput)}) berhasil dicatat. Selisih biaya produksi: ${formatRupiah(liveVariance)}.`,
      );
      setCatatan('');
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setSaving(false);
    }
  };

  if (!profile) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Upah Mingguan Produksi</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Akumulasi setoran barang jadi per SKU × tarif Resep (jahit+cutting, sablon, packing) & pencatatan bayar aktual.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Muat Ulang
        </button>
      </div>

      <OfflineWriteBlockedBanner isOnline={isOnline} />
      <CacheNoticeBanner visible={fromCache} />
      {msg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          {msg}
        </div>
      )}
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {/* Filter Rentang Minggu */}
      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <label className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            <Calendar className="h-3.5 w-3.5" /> Tanggal Mulai
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            <Calendar className="h-3.5 w-3.5" /> Tanggal Akhir
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
          />
        </div>
        <div className="flex flex-col justify-end">
          <div className="rounded-lg bg-indigo-50 px-3 py-2 dark:bg-indigo-950/50">
            <p className="text-[11px] font-semibold text-indigo-800 dark:text-indigo-300">Total Upah Standar</p>
            <p className="text-base font-bold text-indigo-950 tabular-nums dark:text-indigo-100">
              {formatRupiah(summary.totalStandard)}
            </p>
          </div>
        </div>
      </section>

      {loading ? (
        <LoadingCard />
      ) : (
        <>
          {/* Ringkasan Komponen Standar */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Total Setoran</p>
              <p className="mt-1 text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {formatNumber(summary.totalSetoranQty)} pcs
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Jahit + Cutting</p>
              <p className="mt-1 text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {formatRupiah(summary.jahitCuttingStandard)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Sablon</p>
              <p className="mt-1 text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {formatRupiah(summary.sablonStandard)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Packing (+ Lainnya)</p>
              <p className="mt-1 text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {formatRupiah(summary.packingStandard + summary.lainnyaStandard)}
              </p>
            </div>
          </div>

          {/* Rincian Setoran per SKU */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-100">
              Rincian Upah Standar per SKU ({startDate} s/d {endDate})
            </h3>
            {summary.rows.length === 0 ? (
              <EmptyState description="Belum ada setoran barang jadi ke gudang pada rentang tanggal ini." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      <th className="py-2 pr-2">SKU / Produk</th>
                      <th className="py-2 px-2 text-right">Setoran</th>
                      <th className="py-2 px-2 text-right">Jahit+Cut</th>
                      <th className="py-2 px-2 text-right">Sablon</th>
                      <th className="py-2 px-2 text-right">Packing</th>
                      <th className="py-2 pl-2 text-right">Total Standar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {summary.rows.map((r) => (
                      <tr key={r.productId}>
                        <td className="py-2 pr-2 font-medium text-slate-900 dark:text-slate-100">
                          {r.sku} · {r.productName}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">{formatNumber(r.setoranQty)} pcs</td>
                        <td className="py-2 px-2 text-right tabular-nums">{formatRupiah(r.jahitCuttingAmount)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{formatRupiah(r.sablonAmount)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          {formatRupiah(r.packingAmount + r.lainnyaAmount)}
                        </td>
                        <td className="py-2 pl-2 text-right font-bold tabular-nums">{formatRupiah(r.totalStandard)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Form Pembayaran Aktual */}
          <form
            onSubmit={handleRecordPayout}
            className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between sm:col-span-2">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                <Banknote className="h-4 w-4 text-emerald-600" /> Catat Pembayaran Upah Mingguan
              </h3>
              <button
                type="button"
                onClick={syncFromStandard}
                className="min-h-[36px] rounded-lg border border-slate-300 px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Isi Sesuai Standar
              </button>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Jahit + Cutting Aktual (Rp)
              </label>
              <input
                type="number"
                min={0}
                required
                value={jahitCuttingPaid}
                onChange={(e) => setJahitCuttingPaid(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Sablon Aktual (Rp)
              </label>
              <input
                type="number"
                min={0}
                required
                value={sablonPaid}
                onChange={(e) => setSablonPaid(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Packing Aktual (Rp)
              </label>
              <input
                type="number"
                min={0}
                required
                value={packingPaid}
                onChange={(e) => setPackingPaid(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Komponen Lainnya Aktual (Rp)
              </label>
              <input
                type="number"
                min={0}
                required
                value={lainnyaPaid}
                onChange={(e) => setLainnyaPaid(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm tabular-nums"
              />
            </div>

            <select
              required
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
            >
              <option value="">-- Pilih Akun Kas / Bank Pembayar --</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nama} ({formatRupiah(a.saldoBerjalan)})
                </option>
              ))}
            </select>
            <input
              type="date"
              required
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
            />
            <input
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Catatan mingguan / penerima borongan"
              className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm sm:col-span-2"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs sm:col-span-2 dark:bg-slate-800/70">
              <span>
                Total Bayar: <strong className="tabular-nums">{formatRupiah(totalPaidInput)}</strong>
              </span>
              <span
                className={`font-semibold tabular-nums ${
                  liveVariance === 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                Selisih Biaya Produksi (Aktual − Standar): {formatRupiah(liveVariance)}
              </span>
            </div>

            <button
              type="submit"
              disabled={!isOnline || saving}
              className="min-h-[44px] rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 sm:col-span-2"
            >
              {saving ? 'Menyimpan...' : 'Bayar Upah Mingguan & Catat Selisih'}
            </button>
          </form>

          {/* Riwayat Pembayaran Upah */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-100">Riwayat Pembayaran Upah</h3>
            {wagePayouts.length === 0 ? (
              <EmptyState description="Belum ada pembayaran upah mingguan yang dicatat." />
            ) : (
              <div className="space-y-2">
                {wagePayouts.map((w) => (
                  <div
                    key={w.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/50"
                  >
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        Periode {w.startDate} s/d {w.endDate} · {w.accountName}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Tgl bayar: {w.tanggal} · Standar: {formatRupiah(w.totalStandard)} · Selisih:{' '}
                        {formatRupiah(w.variance)} {w.catatan ? `· ${w.catatan}` : ''}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                      {formatRupiah(w.totalPaid)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
