import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchSalesOrders, recordSalesPayment } from '../services/firebase/salesRepo';
import {
  fetchJournalEntries,
  fetchProductionCosts,
  fetchPurchaseCosts,
  settlePayableEntry,
} from '../services/firebase/financeRepo';
import { fetchAccounts } from '../services/firebase/masterRepo';
import { normalizeFirestoreError } from '../services/firebase/common';
import type { Account, JournalEntry, ProductionCost, PurchaseCost, SalesOrder } from '../types/models';
import { formatRupiah, todayJakarta } from '../utils/format';
import {
  CacheNoticeBanner,
  EmptyState,
  ErrorBanner,
  LoadingCard,
  OfflineWriteBlockedBanner,
} from '../components/ui/StateViews';

export const PayablesReceivablesScreen: React.FC = () => {
  const { profile, isOnline } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const [legacyReceivables, setLegacyReceivables] = useState<SalesOrder[]>([]);
  const [purchaseCosts, setPurchaseCosts] = useState<PurchaseCost[]>([]);
  const [productionCosts, setProductionCosts] = useState<ProductionCost[]>([]);
  const [apPayments, setApPayments] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [soRes, accRes, pcRes, prRes, jRes] = await Promise.all([
        fetchSalesOrders(100),
        fetchAccounts(50),
        fetchPurchaseCosts(100),
        fetchProductionCosts(100),
        fetchJournalEntries(100),
      ]);
      setLegacyReceivables(
        soRes.items.filter(
          (so) => so.status === 'active' && so.penerimaanBersih === undefined && so.totalAmount > so.paidAmount,
        ),
      );
      setAccounts(accRes.items);
      if (accRes.items[0]) setSelectedAccountId(accRes.items[0].id);
      setPurchaseCosts(pcRes.items);
      setProductionCosts(prRes.items);
      setApPayments(jRes.items.filter((j) => j.source === 'ap_payment'));
      setFromCache(soRes.fromCache || accRes.fromCache || pcRes.fromCache);
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const paidByRef = (refId: string) =>
    apPayments.filter((j) => j.refId === refId).reduce((sum, j) => sum + j.amount, 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Utang Supplier &amp; CMT
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Pembayaran utang pembelian bahan ke supplier serta biaya produksi/CMT. Penjualan marketplace kini langsung menggunakan Saldo Marketplace (bukan piutang).
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

      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">
          Akun Kas / Bank Pembayaran
        </label>
        <select
          value={selectedAccountId}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          className="min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-xs"
        >
          <option value="">-- Pilih Akun --</option>
          {accounts
            .filter((a) => a.active)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.nama} ({formatRupiah(a.saldoBerjalan)})
              </option>
            ))}
        </select>
      </div>

      {loading ? (
        <LoadingCard />
      ) : (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-100">Utang ke Supplier</h3>
            {purchaseCosts.filter((pc) => pc.totalCost > pc.paidAmount + paidByRef(pc.id)).length === 0 ? (
              <EmptyState description="Tidak ada utang pembelian supplier yang belum lunas." />
            ) : (
              <div className="space-y-2">
                {purchaseCosts
                  .filter((pc) => pc.totalCost > pc.paidAmount + paidByRef(pc.id))
                  .map((pc) => {
                    const sisa = pc.totalCost - pc.paidAmount - paidByRef(pc.id);
                    return (
                      <div
                        key={pc.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60"
                      >
                        <div>
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            Pembelian {pc.tanggal} ({pc.qty} sat. pakai)
                          </p>
                          <p className="text-[11px] font-semibold text-rose-700 tabular-nums dark:text-rose-400">
                            Sisa Utang: {formatRupiah(sisa)}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={!isOnline || !selectedAccountId}
                          onClick={() => {
                            if (!profile) return;
                            void settlePayableEntry({
                              actorUid: profile.uid,
                              actorName: profile.nama,
                              refType: 'purchase_cost',
                              refId: pc.id,
                              accountId: selectedAccountId,
                              amount: sisa,
                              tanggal: todayJakarta(),
                              deskripsi: `Pelunasan utang pembelian ${pc.tanggal}`,
                            })
                              .then(() => {
                                setMsg('Utang supplier dilunasi.');
                                return load();
                              })
                              .catch((err) => setError(normalizeFirestoreError(err)));
                          }}
                          className="min-h-[38px] rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          Bayar Utang
                        </button>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-100">
              Utang Biaya Produksi / CMT
            </h3>
            {productionCosts.filter((pr) => pr.amount > pr.paidAmount + paidByRef(pr.id)).length === 0 ? (
              <EmptyState description="Tidak ada utang biaya produksi / CMT yang belum lunas." />
            ) : (
              <div className="space-y-2">
                {productionCosts
                  .filter((pr) => pr.amount > pr.paidAmount + paidByRef(pr.id))
                  .map((pr) => {
                    const sisa = pr.amount - pr.paidAmount - paidByRef(pr.id);
                    return (
                      <div
                        key={pr.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60"
                      >
                        <div>
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            {pr.woNumber} · {pr.vendorName}
                          </p>
                          <p className="text-[11px] font-semibold text-rose-700 tabular-nums dark:text-rose-400">
                            Sisa Utang: {formatRupiah(sisa)}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={!isOnline || !selectedAccountId}
                          onClick={() => {
                            if (!profile) return;
                            void settlePayableEntry({
                              actorUid: profile.uid,
                              actorName: profile.nama,
                              refType: 'production_cost',
                              refId: pr.id,
                              accountId: selectedAccountId,
                              amount: sisa,
                              tanggal: todayJakarta(),
                              deskripsi: `Pelunasan upah CMT ${pr.woNumber} (${pr.vendorName})`,
                            })
                              .then(() => {
                                setMsg('Utang CMT dilunasi.');
                                return load();
                              })
                              .catch((err) => setError(normalizeFirestoreError(err)));
                          }}
                          className="min-h-[38px] rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          Bayar Upah
                        </button>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>

          {legacyReceivables.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-100">
                Piutang Sales Order Lama
              </h3>
              <div className="space-y-2">
                {legacyReceivables.map((so) => {
                  const sisa = so.totalAmount - so.paidAmount;
                  return (
                    <div
                      key={so.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60"
                    >
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          {so.soNumber} · {so.customerName}
                        </p>
                        <p className="text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          {so.tanggal} · Sisa: <strong className="text-rose-700 dark:text-rose-400">{formatRupiah(sisa)}</strong>
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!isOnline || !selectedAccountId}
                        onClick={() => {
                          if (!profile) return;
                          const acc = accounts.find((a) => a.id === selectedAccountId);
                          if (!acc) return;
                          void recordSalesPayment({
                            actorUid: profile.uid,
                            actorName: profile.nama,
                            soId: so.id,
                            accountId: acc.id,
                            accountName: acc.nama,
                            amount: sisa,
                            tanggal: todayJakarta(),
                            metode: acc.tipe === 'bank' ? 'Transfer' : 'Tunai',
                            catatan: 'Pelunasan SO lama',
                          })
                            .then(() => {
                              setMsg(`Piutang ${so.soNumber} dilunasi.`);
                              return load();
                            })
                            .catch((err) => setError(normalizeFirestoreError(err)));
                        }}
                        className="min-h-[38px] rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Lunasi Penuh
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};
