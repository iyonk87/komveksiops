import React, { useCallback, useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  createOperatingExpense,
  createProductionCost,
  createPurchaseCost,
  fetchOperatingExpenses,
  fetchProductionCosts,
  fetchPurchaseCosts,
  fetchWagePayouts,
} from '../services/firebase/financeRepo';
import { fetchAccounts, fetchMaterials, fetchSuppliers } from '../services/firebase/masterRepo';
import { fetchWorkOrders } from '../services/firebase/productionRepo';
import { fetchMarketplacePayouts, fetchPayments } from '../services/firebase/salesRepo';
import { getMaterialUsageUnit } from '../services/domain/accounting';
import { normalizeFirestoreError } from '../services/firebase/common';
import type {
  Account,
  MarketplacePayout,
  Material,
  OperatingExpense,
  Payment,
  ProductionCost,
  PurchaseCost,
  Supplier,
  WagePayout,
  WorkOrder,
} from '../types/models';
import {
  formatRupiah,
  formatUnitCost,
  formatUsageQty,
  parseIntegerInput,
  todayJakarta,
} from '../utils/format';
import {
  CacheNoticeBanner,
  EmptyState,
  ErrorBanner,
  LoadingCard,
  OfflineWriteBlockedBanner,
} from '../components/ui/StateViews';

export const CashScreen: React.FC = () => {
  const { profile, isOnline } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [marketplacePayouts, setMarketplacePayouts] = useState<MarketplacePayout[]>([]);
  const [wagePayouts, setWagePayouts] = useState<WagePayout[]>([]);
  const [expenses, setExpenses] = useState<OperatingExpense[]>([]);
  const [purchaseCosts, setPurchaseCosts] = useState<PurchaseCost[]>([]);
  const [productionCosts, setProductionCosts] = useState<ProductionCost[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);

  // Form beban operasional
  const [expKategori, setExpKategori] = useState('Gaji Admin Bulanan');
  const [expDesc, setExpDesc] = useState('');
  const [expAccount, setExpAccount] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expTanggal, setExpTanggal] = useState(todayJakarta());

  // Form biaya pembelian bahan (totalCost bulat untuk qty dalam satuan pakai)
  const [pcItemId, setPcItemId] = useState('');
  const [pcSupId, setPcSupId] = useState('');
  const [pcQty, setPcQty] = useState('');
  const [pcTotalCost, setPcTotalCost] = useState('');
  const [pcPaid, setPcPaid] = useState('');
  const [pcAcc, setPcAcc] = useState('');
  const [pcTanggal, setPcTanggal] = useState(todayJakarta());

  // Form biaya produksi/CMT
  const [woId, setWoId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [prodKat, setProdKat] = useState<ProductionCost['kategori']>('jahit_cmt');
  const [prodAmount, setProdAmount] = useState('');
  const [prodPaid, setProdPaid] = useState('');
  const [prodAcc, setProdAcc] = useState('');
  const [prodTanggal, setProdTanggal] = useState(todayJakarta());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accRes, payRes, mpRes, wageRes, expRes, pcRes, prcRes, matRes, supRes, woRes] =
        await Promise.all([
          fetchAccounts(50),
          fetchPayments(undefined, 50),
          fetchMarketplacePayouts(50),
          fetchWagePayouts(50),
          fetchOperatingExpenses(50),
          fetchPurchaseCosts(50),
          fetchProductionCosts(50),
          fetchMaterials(200),
          fetchSuppliers(100),
          fetchWorkOrders(50),
        ]);
      setAccounts(accRes.items);
      setPayments(payRes.items);
      setMarketplacePayouts(mpRes.items);
      setWagePayouts(wageRes.items);
      setExpenses(expRes.items);
      setPurchaseCosts(pcRes.items);
      setProductionCosts(prcRes.items);
      setMaterials(matRes.items);
      setSuppliers(supRes.items);
      setWorkOrders(woRes.items);
      setFromCache(accRes.fromCache || expRes.fromCache);
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedPcMaterial = materials.find((m) => m.id === pcItemId);
  const selectedPcUsageUnit = selectedPcMaterial ? getMaterialUsageUnit(selectedPcMaterial) : 'pcs';
  const parsedPcQty = parseIntegerInput(pcQty);
  const parsedPcTotal = parseIntegerInput(pcTotalCost);
  const previewPcUnitCost = parsedPcQty > 0 ? parsedPcTotal / parsedPcQty : 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Kas, Bank &amp; Pencatatan Biaya
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Saldo akun kas/bank serta pencatatan pembelian bahan (harga total), biaya produksi, dan beban operasional (termasuk gaji admin bulanan).
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

      {loading ? (
        <LoadingCard />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2">
            {accounts.length === 0 ? (
              <div className="sm:col-span-2">
                <EmptyState description="Belum ada akun kas/bank. Tambahkan di Master Data." />
              </div>
            ) : (
              accounts
                .filter((a) => a.active)
                .map((a) => (
                  <div
                    key={a.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                      <span className="text-xs font-semibold uppercase">{a.tipe}</span>
                      <Wallet className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">{a.nama}</p>
                    <p className="mt-1 text-xl font-bold text-indigo-700 tabular-nums dark:text-indigo-300">
                      {formatRupiah(a.saldoBerjalan)}
                    </p>
                  </div>
                ))
            )}
          </section>

          {profile && (
            <div className="space-y-4">
              {/* Catat Harga Beli Bahan */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  void createPurchaseCost({
                    actorUid: profile.uid,
                    actorName: profile.nama,
                    ledgerId: 'manual',
                    itemId: pcItemId,
                    supplierId: pcSupId,
                    qty: parsedPcQty,
                    totalCost: parsedPcTotal,
                    paidAmount: parseIntegerInput(pcPaid),
                    accountId: pcAcc,
                    tanggal: pcTanggal,
                    catatan: 'Pembelian bahan baku',
                  })
                    .then(() => {
                      setMsg('Biaya pembelian bahan baku tercatat.');
                      setPcQty('');
                      setPcTotalCost('');
                      setPcPaid('');
                      return load();
                    })
                    .catch((err) => setError(normalizeFirestoreError(err)));
                }}
                className="grid gap-2.5 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <h3 className="text-sm font-bold text-slate-900 sm:col-span-2 dark:text-slate-100">
                  Catat Harga Beli Bahan (Harga Total Rupiah Bulat)
                </h3>
                <select
                  required
                  value={pcItemId}
                  onChange={(e) => setPcItemId(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">-- Pilih Bahan Baku --</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nama} (Satuan pakai: {getMaterialUsageUnit(m)})
                    </option>
                  ))}
                </select>
                <select
                  required
                  value={pcSupId}
                  onChange={(e) => setPcSupId(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">-- Pilih Supplier --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nama}
                    </option>
                  ))}
                </select>
                <input
                  required
                  type="number"
                  min={1}
                  value={pcQty}
                  onChange={(e) => setPcQty(e.target.value)}
                  placeholder={`Qty dalam satuan pakai (${selectedPcUsageUnit})`}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <input
                  required
                  type="number"
                  min={0}
                  value={pcTotalCost}
                  onChange={(e) => setPcTotalCost(e.target.value)}
                  placeholder="Total Harga Beli (Rp bulat)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                {parsedPcQty > 0 && parsedPcTotal > 0 && (
                  <p className="text-[11px] font-medium text-indigo-700 tabular-nums sm:col-span-2 dark:text-indigo-300">
                    {formatUsageQty(parsedPcQty, selectedPcUsageUnit)} · Rata-rata:{' '}
                    <strong>{formatUnitCost(previewPcUnitCost)}/{selectedPcUsageUnit}</strong>
                  </p>
                )}
                <input
                  required
                  type="number"
                  min={0}
                  value={pcPaid}
                  onChange={(e) => setPcPaid(e.target.value)}
                  placeholder="Dibayar Sekarang (Rp, 0 jika hutang)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <select
                  value={pcAcc}
                  onChange={(e) => setPcAcc(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">-- Akun Kas/Bank (jika bayar &gt; 0) --</option>
                  {accounts
                    .filter((a) => a.active)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.nama}
                      </option>
                    ))}
                </select>
                <input
                  required
                  type="date"
                  value={pcTanggal}
                  onChange={(e) => setPcTanggal(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm sm:col-span-2"
                />
                <button
                  type="submit"
                  disabled={!isOnline}
                  className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white disabled:opacity-50 sm:col-span-2"
                >
                  Simpan Biaya Pembelian
                </button>
              </form>

              {/* Catat Beban Operasional (termasuk Gaji Admin Bulanan) */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  void createOperatingExpense({
                    actorUid: profile.uid,
                    actorName: profile.nama,
                    kategori: expKategori,
                    deskripsi: expDesc,
                    accountId: expAccount,
                    amount: parseIntegerInput(expAmount),
                    tanggal: expTanggal,
                  })
                    .then(() => {
                      setMsg('Beban operasional tercatat.');
                      setExpDesc('');
                      setExpAmount('');
                      return load();
                    })
                    .catch((err) => setError(normalizeFirestoreError(err)));
                }}
                className="grid gap-2.5 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <h3 className="text-sm font-bold text-slate-900 sm:col-span-2 dark:text-slate-100">
                  Catat Beban Operasional (Gaji Admin Bulanan, Listrik, Sewa, dll)
                </h3>
                <input
                  required
                  value={expKategori}
                  onChange={(e) => setExpKategori(e.target.value)}
                  placeholder="Kategori (Gaji Admin Bulanan, Listrik, Sewa)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <input
                  required
                  type="number"
                  min={1}
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                  placeholder="Nominal (Rp)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <select
                  required
                  value={expAccount}
                  onChange={(e) => setExpAccount(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">-- Pilih Akun Kas/Bank --</option>
                  {accounts
                    .filter((a) => a.active)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.nama}
                      </option>
                    ))}
                </select>
                <input
                  required
                  type="date"
                  value={expTanggal}
                  onChange={(e) => setExpTanggal(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <input
                  required
                  value={expDesc}
                  onChange={(e) => setExpDesc(e.target.value)}
                  placeholder="Keterangan beban"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm sm:col-span-2"
                />
                <button
                  type="submit"
                  disabled={!isOnline}
                  className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white disabled:opacity-50 sm:col-span-2"
                >
                  Simpan Beban Operasional
                </button>
              </form>

              {/* Catat Biaya Tambahan WO (CMT / Khusus) */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const wo = workOrders.find((w) => w.id === woId);
                  if (!wo) return;
                  setError(null);
                  void createProductionCost({
                    actorUid: profile.uid,
                    actorName: profile.nama,
                    woId: wo.id,
                    woNumber: wo.woNumber,
                    vendorName,
                    kategori: prodKat,
                    amount: parseIntegerInput(prodAmount),
                    paidAmount: parseIntegerInput(prodPaid),
                    accountId: prodAcc,
                    tanggal: prodTanggal,
                    catatan: `Biaya produksi ${wo.woNumber}`,
                  })
                    .then(() => {
                      setMsg('Biaya tambahan WO tercatat.');
                      setVendorName('');
                      setProdAmount('');
                      setProdPaid('');
                      return load();
                    })
                    .catch((err) => setError(normalizeFirestoreError(err)));
                }}
                className="grid gap-2.5 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <h3 className="text-sm font-bold text-slate-900 sm:col-span-2 dark:text-slate-100">
                  Catat Biaya Langsung WO Tambahan (Opsional — Upah Mingguan di Menu Upah)
                </h3>
                <select
                  required
                  value={woId}
                  onChange={(e) => setWoId(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">-- Pilih Work Order --</option>
                  {workOrders.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.woNumber} ({w.targetQty} pcs)
                    </option>
                  ))}
                </select>
                <input
                  required
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="Nama Penjahit / Vendor"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <select
                  value={prodKat}
                  onChange={(e) => setProdKat(e.target.value as ProductionCost['kategori'])}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="jahit_cmt">Jahit / CMT</option>
                  <option value="cutting">Cutting</option>
                  <option value="sablon">Sablon</option>
                  <option value="packing">Packing</option>
                  <option value="finishing">Finishing</option>
                  <option value="lainnya">Lainnya</option>
                </select>
                <input
                  required
                  type="number"
                  min={0}
                  value={prodAmount}
                  onChange={(e) => setProdAmount(e.target.value)}
                  placeholder="Nominal (Rp)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <input
                  required
                  type="number"
                  min={0}
                  value={prodPaid}
                  onChange={(e) => setProdPaid(e.target.value)}
                  placeholder="Dibayar (Rp)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <select
                  value={prodAcc}
                  onChange={(e) => setProdAcc(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">-- Akun Kas/Bank --</option>
                  {accounts
                    .filter((a) => a.active)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.nama}
                      </option>
                    ))}
                </select>
                <input
                  required
                  type="date"
                  value={prodTanggal}
                  onChange={(e) => setProdTanggal(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm sm:col-span-2"
                />
                <button
                  type="submit"
                  disabled={!isOnline}
                  className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white disabled:opacity-50 sm:col-span-2"
                >
                  Simpan Biaya Langsung WO
                </button>
              </form>
            </div>
          )}

          {/* Riwayat Kas Masuk */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              Kas Masuk Terbaru (Pencairan Marketplace &amp; Pembayaran)
            </h3>
            {marketplacePayouts.length === 0 && payments.length === 0 ? (
              <EmptyState description="Belum ada kas masuk tercatat." />
            ) : (
              <div className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
                {marketplacePayouts.map((mp) => (
                  <div key={mp.id} className="flex justify-between py-2">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        Pencairan {mp.channelName} → {mp.accountName}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {mp.tanggal} · {mp.catatan}
                      </p>
                    </div>
                    <span className="font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
                      +{formatRupiah(mp.amount)}
                    </span>
                  </div>
                ))}
                {payments.map((p) => (
                  <div key={p.id} className="flex justify-between py-2">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {p.soNumber} · {p.accountName}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {p.tanggal} · {p.metode}
                      </p>
                    </div>
                    <span className="font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
                      +{formatRupiah(p.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              Ringkasan Beban, Pembelian &amp; Upah Terbaru
            </h3>
            <div className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
              {wagePayouts.map((w) => (
                <div key={w.id} className="flex justify-between py-2">
                  <span>
                    [Upah Mingguan] {w.startDate} s/d {w.endDate} ({w.tanggal})
                  </span>
                  <span className="font-bold text-rose-700 tabular-nums dark:text-rose-400">
                    -{formatRupiah(w.totalPaid)}
                  </span>
                </div>
              ))}
              {expenses.map((ex) => (
                <div key={ex.id} className="flex justify-between py-2">
                  <span>
                    [Beban] {ex.kategori} — {ex.deskripsi} ({ex.tanggal})
                  </span>
                  <span className="font-bold text-rose-700 tabular-nums dark:text-rose-400">
                    -{formatRupiah(ex.amount)}
                  </span>
                </div>
              ))}
              {purchaseCosts.map((pc) => (
                <div key={pc.id} className="flex justify-between py-2">
                  <span>
                    [Beli Bahan] {pc.qty} sat. pakai @ {formatUnitCost(pc.unitCost)} ({pc.tanggal})
                  </span>
                  <span className="font-bold text-slate-800 tabular-nums dark:text-slate-200">
                    {formatRupiah(pc.totalCost)}
                  </span>
                </div>
              ))}
              {productionCosts.map((pr) => (
                <div key={pr.id} className="flex justify-between py-2">
                  <span>
                    [WO Cost] {pr.woNumber} — {pr.vendorName} ({pr.tanggal})
                  </span>
                  <span className="font-bold text-slate-800 tabular-nums dark:text-slate-200">
                    {formatRupiah(pr.amount)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
};
