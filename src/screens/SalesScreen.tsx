import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  Banknote,
  Plus,
  RotateCcw,
  ShoppingCart,
  Store,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  createSalesOrderAtomic,
  ensureDefaultMarketplaceChannels,
  fetchMarketplaceChannels,
  fetchMarketplacePayouts,
  fetchSalesOrderItems,
  fetchSalesOrders,
  fetchSalesReturns,
  recordMarketplacePayout,
  recordSalesPayment,
  recordSalesReturn,
  saveMarketplaceChannel,
  updateShippingStatus,
  voidSalesOrderByOwner,
  type SalesOrderLineInput,
} from '../services/firebase/salesRepo';
import { fetchAccounts, fetchProducts } from '../services/firebase/masterRepo';
import { fetchStockBalances } from '../services/firebase/inventoryRepo';
import { normalizeFirestoreError } from '../services/firebase/common';
import type {
  Account,
  MarketplaceChannel,
  MarketplacePayout,
  Product,
  SalesOrder,
  SalesOrderItem,
  SalesReturn,
  ShippingStatus,
} from '../types/models';
import { formatNumber, formatRupiah, parseIntegerInput, todayJakarta } from '../utils/format';
import {
  CacheNoticeBanner,
  ConfirmModal,
  EmptyState,
  ErrorBanner,
  LoadingCard,
  OfflineWriteBlockedBanner,
} from '../components/ui/StateViews';

type SalesTab = 'orders' | 'payouts';

export const SalesScreen: React.FC = () => {
  const { profile, isOnline } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [tab, setTab] = useState<SalesTab>('orders');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const [channels, setChannels] = useState<MarketplaceChannel[]>([]);
  const [payouts, setPayouts] = useState<MarketplacePayout[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [returns, setReturns] = useState<SalesReturn[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});

  // Tambah channel marketplace baru
  const [newChannelName, setNewChannelName] = useState('');
  const [addingChannel, setAddingChannel] = useState(false);

  // Form Penjualan Marketplace
  const [soNumber, setSoNumber] = useState(`MP-${Date.now().toString().slice(-6)}`);
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [noPesanan, setNoPesanan] = useState('');
  const [tanggal, setTanggal] = useState(todayJakarta());
  const [lines, setLines] = useState<SalesOrderLineInput[]>([]);
  const [pickProductId, setPickProductId] = useState('');
  const [pickQty, setPickQty] = useState('1');
  const [pickPrice, setPickPrice] = useState('0');
  const [biayaAdmin, setBiayaAdmin] = useState('0');
  const [komisiAffiliate, setKomisiAffiliate] = useState('0');
  const [potonganLain, setPotonganLain] = useState('0');
  const [catatan, setCatatan] = useState('');

  // Form Pencairan Saldo Marketplace
  const [payoutChannelId, setPayoutChannelId] = useState('');
  const [payoutAccountId, setPayoutAccountId] = useState('');
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutTanggal, setPayoutTanggal] = useState(todayJakarta());
  const [payoutCatatan, setPayoutCatatan] = useState('');

  // Modal pelunasan SO legacy non-marketplace / retur / void
  const [paySo, setPaySo] = useState<SalesOrder | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payAccountId, setPayAccountId] = useState('');
  const [payTanggal, setPayTanggal] = useState(todayJakarta());

  const [retSo, setRetSo] = useState<SalesOrder | null>(null);
  const [retItems, setRetItems] = useState<SalesOrderItem[]>([]);
  const [retProductId, setRetProductId] = useState('');
  const [retQty, setRetQty] = useState('1');
  const [retRefund, setRetRefund] = useState('0');
  const [retRestock, setRetRestock] = useState(true);
  const [retAlasan, setRetAlasan] = useState('');

  const [voidSo, setVoidSo] = useState<SalesOrder | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [chRes, payOutRes, soRes, retRes, prodRes, accRes, balRes] = await Promise.all([
        fetchMarketplaceChannels(),
        fetchMarketplacePayouts(50),
        fetchSalesOrders(50),
        fetchSalesReturns(50),
        fetchProducts(200),
        fetchAccounts(50),
        fetchStockBalances(300),
      ]);

      let activeChannels = chRes.items;
      if (activeChannels.length === 0 && profile && isOnline) {
        activeChannels = await ensureDefaultMarketplaceChannels(profile.uid);
      }

      setChannels(activeChannels);
      setPayouts(payOutRes.items);
      setOrders(soRes.items);
      setReturns(retRes.items);
      setProducts(prodRes.items);
      setAccounts(accRes.items);

      setSelectedChannelId((prev) => prev || activeChannels[0]?.id || '');
      setPayoutChannelId((prev) => prev || activeChannels[0]?.id || '');
      setPayoutAccountId((prev) => prev || accRes.items.find((a) => a.active)?.id || '');

      const bMap: Record<string, number> = {};
      balRes.items.forEach((b) => {
        bMap[b.itemId] = b.qty;
      });
      setBalances(bMap);
      setFromCache(soRes.fromCache || prodRes.fromCache || chRes.fromCache);
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, [isOnline, profile]);

  useEffect(() => {
    void load();
  }, [load]);

  const soTotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0),
    [lines],
  );

  const parsedBiayaAdmin = parseIntegerInput(biayaAdmin);
  const parsedKomisiAff = parseIntegerInput(komisiAffiliate);
  const parsedPotonganLain = parseIntegerInput(potonganLain);
  const previewPenerimaanBersih = soTotal - parsedBiayaAdmin - parsedKomisiAff - parsedPotonganLain;

  const distinctProductCount = useMemo(
    () => new Set(lines.map((l) => l.productId)).size,
    [lines],
  );

  const negativeStockWarnings = useMemo(() => {
    const requestedByPid: Record<string, number> = {};
    for (const line of lines) {
      requestedByPid[line.productId] = (requestedByPid[line.productId] ?? 0) + line.qty;
    }
    const warnings: string[] = [];
    for (const [pid, qty] of Object.entries(requestedByPid)) {
      const current = balances[pid] ?? 0;
      const after = current - qty;
      if (after < 0) {
        const prod = products.find((p) => p.id === pid);
        warnings.push(`${prod?.sku ?? pid}: stok ${current} -> ${after} pcs (Perlu Opname)`);
      }
    }
    return warnings;
  }, [balances, lines, products]);

  const totalMarketplaceBalance = useMemo(
    () => channels.filter((c) => c.active).reduce((sum, c) => sum + c.balance, 0),
    [channels],
  );

  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !newChannelName.trim()) return;
    setAddingChannel(true);
    setError(null);
    setMsg(null);
    try {
      const id = await saveMarketplaceChannel({ actorUid: profile.uid, nama: newChannelName.trim() });
      setMsg(`Channel marketplace "${newChannelName.trim()}" ditambahkan.`);
      setNewChannelName('');
      setSelectedChannelId(id);
      setPayoutChannelId(id);
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setAddingChannel(false);
    }
  };

  const handleAddLine = () => {
    const prod = products.find((p) => p.id === pickProductId);
    const qty = parseIntegerInput(pickQty);
    const price = parseIntegerInput(pickPrice);
    if (!prod || qty <= 0) return;

    const alreadyInLines = lines.some((l) => l.productId === prod.id);
    if (!alreadyInLines && distinctProductCount >= 6) {
      setError('Maksimal 6 item berbeda per transaksi, pecah menjadi beberapa pesanan.');
      return;
    }

    setError(null);
    setLines((prev) => [
      ...prev,
      {
        productId: prod.id,
        productName: `${prod.nama}${prod.ukuran ? ` (${prod.ukuran})` : ''}`,
        sku: prod.sku,
        qty,
        unitPrice: price,
      },
    ]);
    setPickProductId('');
    setPickQty('1');
    setPickPrice('0');
  };

  const handleCreateSo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setError(null);
    setMsg(null);

    if (distinctProductCount > 6) {
      setError('Maksimal 6 item berbeda per transaksi, pecah menjadi beberapa pesanan.');
      return;
    }
    const ch = channels.find((c) => c.id === selectedChannelId);
    if (!ch) {
      setError('Pilih channel marketplace terlebih dahulu.');
      return;
    }
    if (previewPenerimaanBersih < 0) {
      setError('Penerimaan bersih marketplace tidak boleh negatif.');
      return;
    }

    const orderRef = noPesanan.trim() || soNumber.trim();

    try {
      await createSalesOrderAtomic({
        actorUid: profile.uid,
        actorName: profile.nama,
        actorRole: profile.role,
        soNumber: soNumber.trim() || orderRef,
        customerId: 'marketplace',
        customerName: ch.nama,
        channel: ch.nama,
        marketplaceChannelId: ch.id,
        noPesanan: orderRef,
        biayaAdmin: parsedBiayaAdmin,
        komisiAffiliate: parsedKomisiAff,
        potonganLain: parsedPotonganLain,
        tanggal,
        catatan,
        items: lines,
        initialPayment: 0,
      });
      setMsg(
        `Pesanan ${soNumber} (${ch.nama}) tersimpan, stok berkurang, dan Saldo Marketplace bertambah ${formatRupiah(previewPenerimaanBersih)}.`,
      );
      setSoNumber(`MP-${Date.now().toString().slice(-6)}`);
      setNoPesanan('');
      setLines([]);
      setBiayaAdmin('0');
      setKomisiAffiliate('0');
      setPotonganLain('0');
      setCatatan('');
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
    }
  };

  const handlePayoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setError(null);
    setMsg(null);
    const ch = channels.find((c) => c.id === payoutChannelId);
    const acc = accounts.find((a) => a.id === payoutAccountId);
    if (!ch) {
      setError('Pilih channel marketplace.');
      return;
    }
    if (!acc) {
      setError('Pilih akun kas/bank penerima.');
      return;
    }
    try {
      const amt = parseIntegerInput(payoutAmount);
      await recordMarketplacePayout({
        actorUid: profile.uid,
        actorName: profile.nama,
        channelId: ch.id,
        accountId: acc.id,
        accountName: acc.nama,
        amount: amt,
        tanggal: payoutTanggal,
        catatan: payoutCatatan || `Pencairan ${ch.nama}`,
      });
      setMsg(`Pencairan ${formatRupiah(amt)} dari Saldo ${ch.nama} ke ${acc.nama} berhasil dicatat.`);
      setPayoutAmount('');
      setPayoutCatatan('');
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
    }
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !paySo) return;
    setError(null);
    setMsg(null);
    const acc = accounts.find((a) => a.id === payAccountId);
    if (!acc) {
      setError('Pilih akun kas/bank.');
      return;
    }
    try {
      await recordSalesPayment({
        actorUid: profile.uid,
        actorName: profile.nama,
        soId: paySo.id,
        accountId: acc.id,
        accountName: acc.nama,
        amount: parseIntegerInput(payAmount),
        tanggal: payTanggal,
        metode: acc.tipe === 'bank' ? 'Transfer Bank' : 'Tunai',
        catatan: 'Pelunasan SO lama',
      });
      setMsg(`Pembayaran untuk ${paySo.soNumber} berhasil dicatat.`);
      setPaySo(null);
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
    }
  };

  const openReturnModal = async (so: SalesOrder) => {
    setRetSo(so);
    setRetQty('1');
    setRetRefund('0');
    setRetRestock(true);
    setRetAlasan('');
    try {
      const items = await fetchSalesOrderItems(so.id);
      setRetItems(items);
      if (items[0]) {
        setRetProductId(items[0].productId);
        setRetRefund(String(items[0].unitPrice));
      }
    } catch {
      setRetItems([]);
    }
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !retSo) return;
    setError(null);
    setMsg(null);
    const matchingChannel = channels.find(
      (c) => c.nama.toLowerCase() === retSo.channel.toLowerCase(),
    );
    try {
      await recordSalesReturn({
        actorUid: profile.uid,
        actorName: profile.nama,
        soId: retSo.id,
        soNumber: retSo.soNumber,
        productId: retProductId,
        qty: parseIntegerInput(retQty),
        refundAmount: parseIntegerInput(retRefund),
        restockable: retRestock,
        alasan: retAlasan,
        tanggal: todayJakarta(),
        marketplaceChannelId: matchingChannel?.id,
      });
      setMsg(
        `Retur ${retSo.soNumber} tercatat.${retRestock ? ' Stok produk dikembalikan.' : ' Barang rusak/tidak restock.'}`,
      );
      setRetSo(null);
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
    }
  };

  const selectedPayoutChannel = channels.find((c) => c.id === payoutChannelId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Penjualan Marketplace &amp; Pencairan Saldo
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Penjualan menambah Saldo Marketplace (setelah biaya admin, komisi affiliate, potongan). Kas/Bank baru masuk saat Pencairan.
          </p>
        </div>
        <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setTab('orders')}
            className={`min-h-[38px] rounded-lg px-3 text-xs font-semibold transition ${
              tab === 'orders'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            Penjualan &amp; Retur
          </button>
          <button
            type="button"
            onClick={() => setTab('payouts')}
            className={`min-h-[38px] rounded-lg px-3 text-xs font-semibold transition ${
              tab === 'payouts'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            Pencairan Saldo ({formatRupiah(totalMarketplaceBalance)})
          </button>
        </div>
      </div>

      <OfflineWriteBlockedBanner isOnline={isOnline} />
      <CacheNoticeBanner visible={fromCache} />
      {msg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
          {msg}
        </div>
      )}
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {/* Kartu Saldo Marketplace per Channel */}
      <section className="grid gap-3 sm:grid-cols-3">
        {channels
          .filter((c) => c.active)
          .map((ch) => (
            <div
              key={ch.id}
              className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                  <Store className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                  {ch.nama}
                </span>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                  Saldo Mengendap
                </span>
              </div>
              <p className="mt-1.5 text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {formatRupiah(ch.balance)}
              </p>
            </div>
          ))}

        {/* Tambah Channel Marketplace */}
        <form
          onSubmit={handleAddChannel}
          className="flex flex-col justify-between gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-900/50"
        >
          <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Tambah Channel Marketplace Baru
          </p>
          <div className="flex gap-1.5">
            <input
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              placeholder="Mis. Lazada / Tokopedia"
              className="min-h-[38px] w-full rounded-lg border border-slate-300 px-2.5 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              type="submit"
              disabled={!isOnline || addingChannel || !newChannelName.trim()}
              className="min-h-[38px] shrink-0 rounded-lg bg-slate-800 px-3 text-xs font-semibold text-white disabled:opacity-50 dark:bg-slate-700"
            >
              Tambah
            </button>
          </div>
        </form>
      </section>

      {tab === 'payouts' ? (
        <div className="space-y-4">
          <form
            onSubmit={handlePayoutSubmit}
            className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <ArrowDownToLine className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Catat Pencairan Saldo Marketplace ke Kas / Bank
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Saldo marketplace yang dicairkan akan mengurangi saldo channel dan langsung masuk ke rekening kas/bank serta Arus Kas.
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Channel Marketplace
                </label>
                <select
                  required
                  value={payoutChannelId}
                  onChange={(e) => setPayoutChannelId(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">-- Pilih Channel --</option>
                  {channels
                    .filter((c) => c.active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nama} (Saldo: {formatRupiah(c.balance)})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Masuk ke Akun Kas / Bank
                </label>
                <select
                  required
                  value={payoutAccountId}
                  onChange={(e) => setPayoutAccountId(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">-- Pilih Akun Kas / Bank --</option>
                  {accounts
                    .filter((a) => a.active)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.nama} ({a.tipe})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Nominal Dicairkan (Rp)
                  {selectedPayoutChannel
                    ? ` · Maks ${formatRupiah(selectedPayoutChannel.balance)}`
                    : ''}
                </label>
                <input
                  required
                  type="number"
                  min={1}
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  placeholder="Nominal cair (Rp)"
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Tanggal Pencairan
                </label>
                <input
                  required
                  type="date"
                  value={payoutTanggal}
                  onChange={(e) => setPayoutTanggal(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
            </div>
            <input
              value={payoutCatatan}
              onChange={(e) => setPayoutCatatan(e.target.value)}
              placeholder="Catatan pencairan (mis. Penarikan mingguan TikTok)"
              className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
            />
            <button
              type="submit"
              disabled={!isOnline}
              className="min-h-[46px] w-full rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Catat Pencairan Saldo Marketplace
            </button>
          </form>

          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              Riwayat Pencairan Saldo Marketplace
            </h3>
            {payouts.length === 0 ? (
              <EmptyState description="Belum ada pencairan saldo marketplace." />
            ) : (
              <div className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
                {payouts.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {p.channelName} → {p.accountName}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {p.tanggal} · {p.catatan || 'Pencairan saldo'}
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
        </div>
      ) : (
        <>
          {/* Form Penjualan Marketplace Manual */}
          <form
            onSubmit={handleCreateSo}
            className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <ShoppingCart className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              Catat Penjualan Marketplace
            </h3>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <select
                required
                value={selectedChannelId}
                onChange={(e) => setSelectedChannelId(e.target.value)}
                className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
              >
                <option value="">-- Pilih Marketplace --</option>
                {channels
                  .filter((c) => c.active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nama}
                    </option>
                  ))}
              </select>
              <input
                required
                value={noPesanan}
                onChange={(e) => setNoPesanan(e.target.value)}
                placeholder="No. Pesanan Marketplace"
                className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
              />
              <input
                required
                value={soNumber}
                onChange={(e) => setSoNumber(e.target.value)}
                placeholder="No. Referensi Internal"
                className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
              />
              <input
                required
                type="date"
                value={tanggal}
                onChange={(e) => setTanggal(e.target.value)}
                className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
              />
            </div>

            {/* Picker Item Produk */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Tambah Item SKU</p>
                <span className="text-[11px] font-medium text-slate-500 tabular-nums dark:text-slate-400">
                  Maks. 6 SKU berbeda ({distinctProductCount}/6)
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                <select
                  value={pickProductId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    setPickProductId(pid);
                    const found = products.find((p) => p.id === pid);
                    if (found) setPickPrice(String(found.hargaJual));
                  }}
                  className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs sm:col-span-2"
                >
                  <option value="">-- Pilih Produk --</option>
                  {products
                    .filter((p) => p.active)
                    .map((p) => {
                      const stok = balances[p.id] ?? 0;
                      return (
                        <option key={p.id} value={p.id}>
                          [{p.sku}] {p.nama} ({p.ukuran}) — Stok: {stok} pcs{stok < 0 ? ' [Perlu Opname]' : ''}
                        </option>
                      );
                    })}
                </select>
                <input
                  type="number"
                  min={1}
                  value={pickQty}
                  onChange={(e) => setPickQty(e.target.value)}
                  placeholder="Qty"
                  className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                />
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    min={0}
                    value={pickPrice}
                    onChange={(e) => setPickPrice(e.target.value)}
                    placeholder="Harga"
                    className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleAddLine}
                    className="min-h-[42px] shrink-0 rounded-lg bg-slate-800 px-3 text-xs font-semibold text-white dark:bg-slate-700"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {lines.length > 0 && (
                <div className="mt-3 divide-y divide-slate-200 border-t border-slate-200 pt-2 text-xs dark:divide-slate-800 dark:border-slate-800">
                  {lines.map((l, idx) => (
                    <div key={`${l.productId}-${idx}`} className="flex items-center justify-between py-1.5">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {l.sku} · {l.productName}
                        </p>
                        <p className="text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          {l.qty} pcs x {formatRupiah(l.unitPrice)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 tabular-nums dark:text-slate-100">
                          {formatRupiah(l.qty * l.unitPrice)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-rose-600 dark:text-rose-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between pt-2 text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    <span>Total Penjualan Kotor</span>
                    <span>{formatRupiah(soTotal)}</span>
                  </div>
                </div>
              )}
            </div>

            {negativeStockWarnings.length > 0 && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200">
                <p className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Perhatian Stok Barang Jadi Minus (Penjualan Tetap Diizinkan):
                </p>
                <ul className="mt-1 list-disc pl-5 text-[11px]">
                  {negativeStockWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Potongan Marketplace */}
            <div className="grid gap-2.5 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Biaya Admin Marketplace (Rp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={biayaAdmin}
                  onChange={(e) => setBiayaAdmin(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Komisi Affiliate (Rp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={komisiAffiliate}
                  onChange={(e) => setKomisiAffiliate(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Potongan Lain / Promo (Rp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={potonganLain}
                  onChange={(e) => setPotonganLain(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-900 tabular-nums dark:bg-indigo-950/60 dark:text-indigo-200">
              <span>Penerimaan Bersih Masuk Saldo Marketplace</span>
              <span className={previewPenerimaanBersih < 0 ? 'text-rose-600' : 'text-indigo-700 dark:text-indigo-300'}>
                {formatRupiah(previewPenerimaanBersih)}
              </span>
            </div>

            <input
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Catatan order / ekspedisi"
              className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
            />

            <button
              type="submit"
              disabled={!isOnline || lines.length === 0}
              className="min-h-[46px] w-full rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Simpan Penjualan Marketplace &amp; Potong Stok
            </button>
          </form>

          {/* Daftar Penjualan */}
          {loading ? (
            <LoadingCard />
          ) : orders.length === 0 ? (
            <EmptyState description="Belum ada penjualan tercatat." />
          ) : (
            <div className="space-y-2.5">
              {orders.map((so) => {
                const isMarketplace = so.penerimaanBersih !== undefined;
                const legacySisa = !isMarketplace ? Math.max(0, so.totalAmount - so.paidAmount) : 0;
                const totalPotongan =
                  (so.biayaAdmin ?? 0) + (so.komisiAffiliate ?? 0) + (so.potonganLain ?? 0);

                return (
                  <div
                    key={so.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {so.noPesanan || so.soNumber} · {so.channel}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {so.tanggal} · Ref: {so.soNumber}
                          {!isMarketplace && so.customerName ? ` · ${so.customerName}` : ''}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${
                          so.status === 'void'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                        }`}
                      >
                        {so.status === 'void' ? 'VOID' : isMarketplace ? 'MARKETPLACE' : so.paymentStatus}
                      </span>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs tabular-nums dark:bg-slate-950/60">
                      <span>
                        Harga Jual: <strong>{formatRupiah(so.totalAmount)}</strong>
                      </span>
                      {isMarketplace ? (
                        <>
                          <span className="text-rose-700 dark:text-rose-400">
                            Potongan: -{formatRupiah(totalPotongan)}
                          </span>
                          <span className="font-bold text-indigo-700 dark:text-indigo-300">
                            Bersih: {formatRupiah(so.penerimaanBersih ?? so.totalAmount)}
                          </span>
                        </>
                      ) : (
                        <>
                          <span>
                            Dibayar: <strong>{formatRupiah(so.paidAmount)}</strong>
                          </span>
                          <span className={legacySisa > 0 ? 'font-bold text-rose-700' : 'text-emerald-700'}>
                            Sisa: {formatRupiah(legacySisa)}
                          </span>
                        </>
                      )}
                    </div>

                    {so.status === 'active' && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <select
                          disabled={!isOnline}
                          value={so.shippingStatus}
                          onChange={(e) =>
                            void updateShippingStatus(so.id, e.target.value as ShippingStatus).then(load)
                          }
                          className="min-h-[40px] rounded-lg border border-slate-300 px-2.5 text-xs"
                        >
                          <option value="pending">Kirim: Pending</option>
                          <option value="packed">Kirim: Packed</option>
                          <option value="shipped">Kirim: Shipped</option>
                          <option value="delivered">Kirim: Delivered</option>
                        </select>

                        {!isMarketplace && legacySisa > 0 && (
                          <button
                            type="button"
                            disabled={!isOnline}
                            onClick={() => {
                              setPaySo(so);
                              setPayAmount(String(legacySisa));
                              setPayAccountId(accounts[0]?.id ?? '');
                            }}
                            className="inline-flex min-h-[40px] items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <Banknote className="h-3.5 w-3.5" /> Pelunasan SO Lama
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={!isOnline}
                          onClick={() => void openReturnModal(so)}
                          className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Retur
                        </button>

                        {isOwner && (
                          <button
                            type="button"
                            disabled={!isOnline}
                            onClick={() => setVoidSo(so)}
                            className="min-h-[40px] rounded-lg border border-rose-300 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/60"
                          >
                            Void (Owner)
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {returns.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                Riwayat Retur Penjualan
              </h3>
              <div className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
                {returns.map((r) => (
                  <div key={r.id} className="flex justify-between py-2">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {r.soNumber} · {formatNumber(r.qty)} pcs
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {r.tanggal} · {r.alasan} ({r.restockable ? 'Masuk stok kembali' : 'Rusak / tidak restock'})
                      </p>
                    </div>
                    <span className="font-bold text-rose-700 tabular-nums dark:text-rose-400">
                      -{formatRupiah(r.refundAmount)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Modal Pelunasan SO Legacy */}
      {paySo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <form
            onSubmit={handlePaySubmit}
            className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 dark:border dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Catat Pelunasan SO Lama — {paySo.soNumber}
            </h3>
            <input
              required
              type="number"
              min={1}
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder="Nominal (Rp)"
              className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
            />
            <select
              required
              value={payAccountId}
              onChange={(e) => setPayAccountId(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
            >
              <option value="">-- Pilih Akun Kas / Bank --</option>
              {accounts
                .filter((a) => a.active)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nama} ({a.tipe})
                  </option>
                ))}
            </select>
            <input
              required
              type="date"
              value={payTanggal}
              onChange={(e) => setPayTanggal(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPaySo(null)}
                className="min-h-[44px] flex-1 rounded-lg border border-slate-300 text-xs font-semibold dark:border-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                className="min-h-[44px] flex-1 rounded-lg bg-emerald-600 text-xs font-semibold text-white"
              >
                Simpan Pembayaran
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Retur */}
      {retSo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <form
            onSubmit={handleReturnSubmit}
            className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 dark:border dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Proses Retur — {retSo.noPesanan || retSo.soNumber}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Retur menyesuaikan Saldo Marketplace (jika order marketplace) dan tidak mengubah saldo kas/bank.
            </p>
            <select
              required
              value={retProductId}
              onChange={(e) => setRetProductId(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
            >
              {retItems.map((it) => (
                <option key={it.id} value={it.productId}>
                  {it.productName} (Qty: {it.qty})
                </option>
              ))}
            </select>
            <input
              required
              type="number"
              min={1}
              value={retQty}
              onChange={(e) => setRetQty(e.target.value)}
              placeholder="Qty Retur"
              className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
            />
            <input
              required
              type="number"
              min={0}
              value={retRefund}
              onChange={(e) => setRetRefund(e.target.value)}
              placeholder="Nilai Potongan Saldo Marketplace (Rp)"
              className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
            />
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={retRestock}
                onChange={(e) => setRetRestock(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              Barang layak jual (kembalikan ke stok produk)
            </label>
            <input
              required
              value={retAlasan}
              onChange={(e) => setRetAlasan(e.target.value)}
              placeholder="Alasan retur"
              className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRetSo(null)}
                className="min-h-[44px] flex-1 rounded-lg border border-slate-300 text-xs font-semibold dark:border-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                className="min-h-[44px] flex-1 rounded-lg bg-indigo-600 text-xs font-semibold text-white"
              >
                Simpan Retur
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmModal
        open={Boolean(voidSo)}
        title="Void Pesanan Penjualan?"
        message={`Pesanan ${voidSo?.noPesanan || voidSo?.soNumber} akan dibatalkan, stok dikembalikan lewat ledger reversal, Saldo Marketplace disesuaikan, dan jurnal pembalik dibuat.`}
        danger
        busy={voidBusy}
        onConfirm={() => {
          if (!profile || !voidSo) return;
          setVoidBusy(true);
          const matchingChannel = channels.find(
            (c) => c.nama.toLowerCase() === voidSo.channel.toLowerCase(),
          );
          void voidSalesOrderByOwner({
            actorUid: profile.uid,
            actorName: profile.nama,
            soId: voidSo.id,
            tanggal: todayJakarta(),
            alasan: 'Void oleh Owner',
            marketplaceChannelId: matchingChannel?.id,
          })
            .then(() => {
              setVoidSo(null);
              setMsg('Pesanan berhasil di-void dengan jurnal reversal.');
              return load();
            })
            .catch((err) => setError(normalizeFirestoreError(err)))
            .finally(() => setVoidBusy(false));
        }}
        onCancel={() => setVoidSo(null)}
      />
    </div>
  );
};
