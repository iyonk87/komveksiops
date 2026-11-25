import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  ClipboardCheck,
  Factory,
  RefreshCw,
  ShoppingBag,
  Store,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { fetchDashboardAggregations, type DashboardAggregations } from '../services/firebase/financeRepo';
import { fetchStockBalances } from '../services/firebase/inventoryRepo';
import { fetchMaterials, fetchProducts } from '../services/firebase/masterRepo';
import { normalizeFirestoreError } from '../services/firebase/common';
import type { AppScreen, Material, Product, StockBalance } from '../types/models';
import { formatRupiah, formatUsageQty } from '../utils/format';
import { CacheNoticeBanner, EmptyState, ErrorBanner, LoadingCard } from '../components/ui/StateViews';

interface LowStockRow {
  id: string;
  nama: string;
  jenis: 'Bahan Baku' | 'Produk Jadi';
  qty: number;
  minStock: number;
  satuan: string;
  needsOpname: boolean;
}

export const DashboardScreen: React.FC<{ onNavigate: (screen: AppScreen) => void }> = ({
  onNavigate,
}) => {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [agg, setAgg] = useState<DashboardAggregations | null>(null);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const [aggRes, balRes, matRes, prodRes] = await Promise.all([
        fetchDashboardAggregations(profile.role),
        fetchStockBalances(250),
        fetchMaterials(150),
        fetchProducts(150),
      ]);
      setAgg(aggRes);
      setFromCache(balRes.fromCache || matRes.fromCache || prodRes.fromCache);

      const balMap = new Map<string, StockBalance>();
      for (const b of balRes.items) balMap.set(b.itemId, b);

      const alerts: LowStockRow[] = [];
      matRes.items
        .filter((m: Material) => m.active)
        .forEach((m) => {
          const qty = balMap.get(m.id)?.qty ?? 0;
          if (qty <= m.minStock) {
            alerts.push({
              id: m.id,
              nama: m.nama,
              jenis: 'Bahan Baku',
              qty,
              minStock: m.minStock,
              satuan: m.satuanPakai || m.satuan,
              needsOpname: false,
            });
          }
        });
      prodRes.items
        .filter((p: Product) => p.active)
        .forEach((p) => {
          const qty = balMap.get(p.id)?.qty ?? 0;
          if (qty <= p.minStock || qty < 0) {
            alerts.push({
              id: p.id,
              nama: `${p.nama}${p.ukuran ? ` (${p.ukuran})` : ''}`,
              jenis: 'Produk Jadi',
              qty,
              minStock: p.minStock,
              satuan: p.satuan || 'pcs',
              needsOpname: qty < 0,
            });
          }
        });

      // Prioritaskan produk yang minus agar segera opname
      alerts.sort((a, b) => Number(b.needsOpname) - Number(a.needsOpname) || a.qty - b.qty);
      setLowStock(alerts.slice(0, 15));
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!profile) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Ringkasan Operasional</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Data langsung dari Cloud Firestore · Role {profile.role === 'owner' ? 'Owner' : 'Admin'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Muat Ulang
        </button>
      </div>

      <CacheNoticeBanner visible={fromCache} />

      {loading ? (
        <LoadingCard />
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => void load()} />
      ) : agg ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => onNavigate('work_orders')}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700"
            >
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span className="text-[11px] font-semibold uppercase tracking-wide">WO Berjalan</span>
                <Factory className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {agg.activeWoCount.toLocaleString('id-ID')}
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('opname')}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700"
            >
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span className="text-[11px] font-semibold uppercase tracking-wide">Opname Pending</span>
                <ClipboardCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {agg.pendingOpnameCount.toLocaleString('id-ID')}
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('sales')}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700"
            >
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span className="text-[11px] font-semibold uppercase tracking-wide">Order Marketplace</span>
                <ShoppingBag className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {agg.activeSoCount.toLocaleString('id-ID')}
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('cash')}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700"
            >
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span className="text-[11px] font-semibold uppercase tracking-wide">Saldo Kas & Bank</span>
                <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="mt-2 text-lg font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {formatRupiah(agg.totalCashBalance)}
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('sales')}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700"
            >
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span className="text-[11px] font-semibold uppercase tracking-wide">Saldo Marketplace</span>
                <Store className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              <p className="mt-2 text-lg font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {formatRupiah(agg.marketplaceBalanceTotal)}
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('profit_loss')}
              className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 text-left shadow-sm transition hover:border-indigo-400 dark:border-indigo-900/60 dark:bg-indigo-950/40"
            >
              <div className="flex items-center justify-between text-indigo-800 dark:text-indigo-300">
                <span className="text-[11px] font-semibold uppercase tracking-wide">Omzet & Beban</span>
                <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <p className="mt-1.5 text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                Omzet: {formatRupiah(agg.grossSalesActive)}
              </p>
              <p className="text-xs font-medium text-slate-600 tabular-nums dark:text-slate-300">
                Beban Ops: {formatRupiah(agg.operatingExpensesTotal)}
              </p>
            </button>
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Peringatan Stok Minimum & Minus
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
              >
                Lihat Semua <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {lowStock.length === 0 ? (
              <EmptyState
                title="Tidak ada item di bawah stok minimum"
                description="Semua bahan baku dan SKU produk aktif berada di atas ambang stok minimum, atau belum ada item master."
                actionLabel="Buka Persediaan"
                onAction={() => onNavigate('inventory')}
              />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {lowStock.map((item) => (
                  <div
                    key={item.id}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2.5 ${
                      item.needsOpname ? 'bg-rose-50/90 dark:bg-rose-950/40' : ''
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{item.nama}</p>
                        {item.needsOpname && (
                          <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                            Perlu Opname
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {item.jenis} · Min {formatUsageQty(item.minStock, item.satuan)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
                        item.qty < 0
                          ? 'bg-rose-600 text-white'
                          : item.qty === 0
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                      }`}
                    >
                      {formatUsageQty(item.qty, item.satuan)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
};
