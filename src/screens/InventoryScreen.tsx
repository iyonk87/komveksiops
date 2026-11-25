import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Filter } from 'lucide-react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchStockBalances,
  fetchStockLedger,
  recordMaterialReceiptAtomic,
  recordStockMutation,
} from '../services/firebase/inventoryRepo';
import {
  fetchAccounts,
  fetchMaterials,
  fetchProducts,
  fetchSuppliers,
} from '../services/firebase/masterRepo';
import { computeReceivingUsageQty } from '../services/domain/accounting';
import { normalizeFirestoreError } from '../services/firebase/common';
import type {
  Account,
  Material,
  Product,
  StockBalance,
  StockLedgerEntry,
  Supplier,
} from '../types/models';
import {
  formatRupiah,
  formatUnitCost,
  formatUsageQty,
  parseIntegerInput,
  parseLengthToCm,
  parseLocaleNumber,
  todayJakarta,
} from '../utils/format';
import {
  CacheNoticeBanner,
  EmptyState,
  ErrorBanner,
  LoadingCard,
  OfflineWriteBlockedBanner,
} from '../components/ui/StateViews';

export const InventoryScreen: React.FC = () => {
  const { profile, isOnline } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const [materials, setMaterials] = useState<Material[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [ledger, setLedger] = useState<StockLedgerEntry[]>([]);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const [filterItemId, setFilterItemId] = useState('');
  const [onlyLowStock, setOnlyLowStock] = useState(false);

  // Form Penerimaan / Pemakaian Bahan Baku
  const [mutMode, setMutMode] = useState<'penerimaan' | 'pemakaian_produksi'>('penerimaan');
  const [selectedMatId, setSelectedMatId] = useState('');
  const [unitMode, setUnitMode] = useState<'purchase' | 'usage'>('purchase');
  const [purchaseQtyInput, setPurchaseQtyInput] = useState('');
  const [usageLengthUnit, setUsageLengthUnit] = useState<'cm' | 'm'>('cm');
  const [actualOverrideInput, setActualOverrideInput] = useState('');
  const [actualOverrideUnit, setActualOverrideUnit] = useState<'cm' | 'm'>('m');
  const [recordPurchaseCost, setRecordPurchaseCost] = useState(true);
  const [totalCostInput, setTotalCostInput] = useState('');
  const [paidAmountInput, setPaidAmountInput] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [mutTanggal, setMutTanggal] = useState(todayJakarta());
  const [mutRefId, setMutRefId] = useState('');
  const [mutCatatan, setMutCatatan] = useState('');

  const itemOptions = useMemo(() => {
    const list: Array<{
      id: string;
      type: 'material' | 'product';
      label: string;
      minStock: number;
      satuan: string;
    }> = [];
    materials
      .filter((m) => m.active)
      .forEach((m) =>
        list.push({
          id: m.id,
          type: 'material',
          label: `[Bahan] ${m.nama} (${m.kode})`,
          minStock: m.minStock,
          satuan: m.satuanPakai || m.satuan,
        }),
      );
    products
      .filter((p) => p.active)
      .forEach((p) =>
        list.push({
          id: p.id,
          type: 'product',
          label: `[SKU] ${p.nama} ${p.warna} (${p.ukuran})`,
          minStock: p.minStock,
          satuan: p.satuan || 'pcs',
        }),
      );
    return list;
  }, [materials, products]);

  const balByItem = useMemo(() => {
    const m = new Map<string, number>();
    balances.forEach((b) => m.set(b.itemId, b.qty));
    return m;
  }, [balances]);

  const selectedMaterial = useMemo(
    () => materials.find((m) => m.id === selectedMatId) ?? null,
    [materials, selectedMatId],
  );

  const previewEffectiveUsage = useMemo(() => {
    if (!selectedMaterial || mutMode !== 'penerimaan') return { qty: null as number | null, err: null as string | null };
    try {
      let actualQty: number | null = null;
      if (actualOverrideInput.trim() !== '') {
        actualQty =
          selectedMaterial.satuanPakai === 'cm'
            ? parseLengthToCm(actualOverrideInput, actualOverrideUnit)
            : parseIntegerInput(actualOverrideInput);
      }

      let rawPurchaseQty = 0;
      if (unitMode === 'usage' && selectedMaterial.satuanPakai === 'cm') {
        rawPurchaseQty = purchaseQtyInput.trim() ? parseLengthToCm(purchaseQtyInput, usageLengthUnit) : 0;
      } else {
        const num = parseLocaleNumber(purchaseQtyInput);
        rawPurchaseQty = Number.isFinite(num) ? num : 0;
      }

      if (rawPurchaseQty <= 0 && !actualQty) return { qty: null, err: null };
      const qty = computeReceivingUsageQty({
        purchaseQty: rawPurchaseQty > 0 ? rawPurchaseQty : 1,
        unitMode,
        konversi: selectedMaterial.konversi,
        actualUsageQty: actualQty,
      });
      return { qty, err: null };
    } catch (err) {
      return { qty: null, err: normalizeFirestoreError(err) };
    }
  }, [
    actualOverrideInput,
    actualOverrideUnit,
    mutMode,
    purchaseQtyInput,
    selectedMaterial,
    unitMode,
    usageLengthUnit,
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [matRes, prodRes, balRes, ledRes, supRes, accRes] = await Promise.all([
        fetchMaterials(150),
        fetchProducts(150),
        fetchStockBalances(250),
        fetchStockLedger({ itemId: filterItemId || undefined, pageSize: 25 }),
        fetchSuppliers(100),
        fetchAccounts(50),
      ]);
      setMaterials(matRes.items);
      setProducts(prodRes.items);
      setBalances(balRes.items);
      setLedger(ledRes.items);
      setLastDoc(ledRes.lastDoc);
      setHasMore(ledRes.hasMore);
      setSuppliers(supRes.items.filter((s) => s.active));
      setAccounts(accRes.items.filter((a) => a.active));
      setFromCache(matRes.fromCache || prodRes.fromCache || balRes.fromCache || ledRes.fromCache);
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, [filterItemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMoreLedger = async () => {
    if (!lastDoc) return;
    try {
      const next = await fetchStockLedger({
        itemId: filterItemId || undefined,
        pageSize: 25,
        cursor: lastDoc,
      });
      setLedger((prev) => [...prev, ...next.items]);
      setLastDoc(next.lastDoc);
      setHasMore(next.hasMore);
    } catch (err) {
      setError(normalizeFirestoreError(err));
    }
  };

  const handleSubmitMutation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !selectedMaterial) {
      setError('Pilih bahan baku terlebih dahulu.');
      return;
    }
    setError(null);
    setMsg(null);

    try {
      if (mutMode === 'pemakaian_produksi') {
        const qtyOut =
          selectedMaterial.satuanPakai === 'cm'
            ? parseLengthToCm(purchaseQtyInput, usageLengthUnit)
            : parseIntegerInput(purchaseQtyInput);
        if (qtyOut <= 0) throw new Error('Kuantitas pemakaian harus > 0.');
        const ledgerId = await recordStockMutation({
          actorUid: profile.uid,
          actorName: profile.nama,
          actorRole: profile.role,
          itemId: selectedMaterial.id,
          itemType: 'material',
          jenis: 'pemakaian_produksi',
          qty: -qtyOut,
          tanggal: mutTanggal,
          refType: 'manual_gudang',
          refId: mutRefId.trim() || `OUT-${Date.now()}`,
          catatan: mutCatatan,
        });
        setMsg(`Pemakaian ${formatUsageQty(qtyOut, selectedMaterial.satuanPakai)} tercatat (${ledgerId}).`);
      } else {
        let actualQty: number | null = null;
        if (actualOverrideInput.trim() !== '') {
          actualQty =
            selectedMaterial.satuanPakai === 'cm'
              ? parseLengthToCm(actualOverrideInput, actualOverrideUnit)
              : parseIntegerInput(actualOverrideInput);
        }

        let pQty = 0;
        if (unitMode === 'usage' && selectedMaterial.satuanPakai === 'cm') {
          pQty = parseLengthToCm(purchaseQtyInput, usageLengthUnit);
        } else {
          const num = parseLocaleNumber(purchaseQtyInput);
          if (!Number.isFinite(num) || num <= 0) throw new Error('Kuantitas penerimaan harus > 0.');
          pQty = num;
        }

        const totalCost = recordPurchaseCost && totalCostInput.trim() !== '' ? parseIntegerInput(totalCostInput) : null;
        const paidAmount = recordPurchaseCost ? parseIntegerInput(paidAmountInput) : 0;

        const res = await recordMaterialReceiptAtomic({
          actorUid: profile.uid,
          actorName: profile.nama,
          material: selectedMaterial,
          unitMode,
          purchaseQty: pQty,
          actualUsageQty: actualQty,
          totalCost,
          paidAmount,
          supplierId,
          accountId,
          tanggal: mutTanggal,
          refId: mutRefId,
          catatan: mutCatatan,
        });
        setMsg(
          `Penerimaan ${formatUsageQty(res.usageQty, selectedMaterial.satuanPakai)} tercatat (Ledger: ${res.ledgerId}).`,
        );
      }
      setPurchaseQtyInput('');
      setActualOverrideInput('');
      setTotalCostInput('');
      setPaidAmountInput('');
      setMutRefId('');
      setMutCatatan('');
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
    }
  };

  const displayedItems = itemOptions.filter((item) => {
    if (onlyLowStock) {
      const q = balByItem.get(item.id) ?? 0;
      return q <= item.minStock || q < 0;
    }
    return true;
  });

  const totalCostVal = parseIntegerInput(totalCostInput);
  const unitCostPreview =
    recordPurchaseCost && totalCostVal > 0 && previewEffectiveUsage.qty
      ? totalCostVal / previewEffectiveUsage.qty
      : null;

  const missingKonversiBlocked =
    mutMode === 'penerimaan' &&
    Boolean(selectedMaterial) &&
    unitMode === 'purchase' &&
    !selectedMaterial?.konversi &&
    actualOverrideInput.trim() === '';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Persediaan & Kartu Stok</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Bahan & WIP dilarang minus. Produk jadi diperbolehkan minus sementara dan ditandai merah &quot;PERLU OPNAME&quot;.
        </p>
      </div>

      <OfflineWriteBlockedBanner isOnline={isOnline} />
      <CacheNoticeBanner visible={fromCache} />
      {msg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          {msg}
        </div>
      )}
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <form
        onSubmit={handleSubmitMutation}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
      >
        <h3 className="text-sm font-bold text-slate-900 sm:col-span-2 dark:text-slate-100">
          Penerimaan & Pemakaian Bahan Baku
        </h3>

        <select
          value={mutMode}
          onChange={(e) => setMutMode(e.target.value as 'penerimaan' | 'pemakaian_produksi')}
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        >
          <option value="penerimaan">Penerimaan Bahan (+)</option>
          <option value="pemakaian_produksi">Pemakaian Produksi Manual (-)</option>
        </select>

        <select
          required
          value={selectedMatId}
          onChange={(e) => {
            setSelectedMatId(e.target.value);
            setActualOverrideInput('');
          }}
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        >
          <option value="">-- Pilih Bahan Baku --</option>
          {materials
            .filter((m) => m.active)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.kode} · {m.nama} (Stok: {formatUsageQty(balByItem.get(m.id) ?? 0, m.satuanPakai)})
              </option>
            ))}
        </select>

        {mutMode === 'penerimaan' && selectedMaterial && (
          <>
            <select
              value={unitMode}
              onChange={(e) => setUnitMode(e.target.value as 'purchase' | 'usage')}
              className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
            >
              <option value="purchase">
                Satuan Beli ({selectedMaterial.satuanBeli}
                {selectedMaterial.konversi
                  ? ` · 1 = ${formatUsageQty(selectedMaterial.konversi, selectedMaterial.satuanPakai)}`
                  : ' · konversi kosong'}
                )
              </option>
              <option value="usage">Satuan Pakai ({selectedMaterial.satuanPakai})</option>
            </select>

            <div className="flex gap-2">
              <input
                required
                value={purchaseQtyInput}
                onChange={(e) => setPurchaseQtyInput(e.target.value)}
                placeholder={
                  unitMode === 'purchase'
                    ? `Jumlah (${selectedMaterial.satuanBeli})`
                    : selectedMaterial.satuanPakai === 'cm'
                      ? `Jumlah (${usageLengthUnit})`
                      : 'Jumlah (pcs)'
                }
                className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 text-sm"
              />
              {unitMode === 'usage' && selectedMaterial.satuanPakai === 'cm' && (
                <select
                  value={usageLengthUnit}
                  onChange={(e) => setUsageLengthUnit(e.target.value as 'cm' | 'm')}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-2.5 text-xs font-semibold"
                >
                  <option value="cm">cm</option>
                  <option value="m">meter</option>
                </select>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Panjang / Jumlah Aktual (opsional, menimpa konversi standar)
              </label>
              <div className="flex gap-2">
                <input
                  value={actualOverrideInput}
                  onChange={(e) => setActualOverrideInput(e.target.value)}
                  placeholder={
                    selectedMaterial.satuanPakai === 'cm'
                      ? `Kosongkan atau isi panjang aktual (${actualOverrideUnit})`
                      : 'Kosongkan atau isi jumlah pcs aktual'
                  }
                  className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 text-sm"
                />
                {selectedMaterial.satuanPakai === 'cm' && (
                  <select
                    value={actualOverrideUnit}
                    onChange={(e) => setActualOverrideUnit(e.target.value as 'cm' | 'm')}
                    className="min-h-[44px] rounded-lg border border-slate-300 px-2.5 text-xs font-semibold"
                  >
                    <option value="m">meter</option>
                    <option value="cm">cm</option>
                  </select>
                )}
              </div>
            </div>

            {missingKonversiBlocked && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs font-medium text-amber-900 sm:col-span-2 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                Konversi <strong>1 {selectedMaterial.satuanBeli}</strong> belum diisi oleh pemilik. Isi nilai konversi di{' '}
                <strong>Master Bahan</strong>, pilih mode <strong>Satuan Pakai</strong>, atau isi{' '}
                <strong>Panjang/Jumlah Aktual</strong> di atas.
              </div>
            )}

            {previewEffectiveUsage.qty && (
              <div className="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-900 sm:col-span-2 dark:bg-indigo-950/50 dark:text-indigo-200">
                Stok Masuk Efekif: {formatUsageQty(previewEffectiveUsage.qty, selectedMaterial.satuanPakai)}
                {unitCostPreview !== null && (
                  <span className="ml-2">
                    · Harga per {selectedMaterial.satuanPakai}: {formatUnitCost(unitCostPreview)}
                  </span>
                )}
              </div>
            )}

            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700 sm:col-span-2 dark:text-slate-200">
              <input
                type="checkbox"
                checked={recordPurchaseCost}
                onChange={(e) => setRecordPurchaseCost(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              Sekalian catat harga pembelian (total Rupiah bulat)
            </label>

            {recordPurchaseCost && (
              <>
                <input
                  type="number"
                  min={0}
                  value={totalCostInput}
                  onChange={(e) => setTotalCostInput(e.target.value)}
                  placeholder="Total Harga Beli (Rp bulat)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <input
                  type="number"
                  min={0}
                  value={paidAmountInput}
                  onChange={(e) => setPaidAmountInput(e.target.value)}
                  placeholder="Dibayar Tunai/Transfer (Rp, 0 jika utang)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">-- Pilih Supplier (opsional) --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nama}
                    </option>
                  ))}
                </select>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">-- Akun Kas/Bank (wajib jika dibayar &gt; 0) --</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nama} ({formatRupiah(a.saldoBerjalan)})
                    </option>
                  ))}
                </select>
              </>
            )}
          </>
        )}

        {mutMode === 'pemakaian_produksi' && selectedMaterial && (
          <div className="flex gap-2 sm:col-span-2">
            <input
              required
              value={purchaseQtyInput}
              onChange={(e) => setPurchaseQtyInput(e.target.value)}
              placeholder={`Kuantitas Keluar (${selectedMaterial.satuanPakai === 'cm' ? usageLengthUnit : 'pcs'})`}
              className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 text-sm"
            />
            {selectedMaterial.satuanPakai === 'cm' && (
              <select
                value={usageLengthUnit}
                onChange={(e) => setUsageLengthUnit(e.target.value as 'cm' | 'm')}
                className="min-h-[44px] rounded-lg border border-slate-300 px-2.5 text-xs font-semibold"
              >
                <option value="cm">cm</option>
                <option value="m">meter</option>
              </select>
            )}
          </div>
        )}

        <input
          required
          type="date"
          value={mutTanggal}
          onChange={(e) => setMutTanggal(e.target.value)}
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        />
        <input
          value={mutRefId}
          onChange={(e) => setMutRefId(e.target.value)}
          placeholder="No. Surat Jalan / Nota (opsional)"
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        />
        <input
          value={mutCatatan}
          onChange={(e) => setMutCatatan(e.target.value)}
          placeholder="Catatan tambahan"
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm sm:col-span-2"
        />

        <button
          type="submit"
          disabled={!isOnline || missingKonversiBlocked}
          className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 sm:col-span-2"
        >
          Simpan Mutasi Stok
        </button>
      </form>

      {loading ? (
        <LoadingCard />
      ) : (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Saldo Stok Saat Ini</h3>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={onlyLowStock}
                  onChange={(e) => setOnlyLowStock(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
                Hanya stok menipis / minus
              </label>
            </div>

            {displayedItems.length === 0 ? (
              <EmptyState description="Belum ada item persediaan yang sesuai filter." />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {displayedItems.map((item) => {
                  const qty = balByItem.get(item.id) ?? 0;
                  const isNegativeProduct = item.type === 'product' && qty < 0;
                  const low = qty <= item.minStock;
                  return (
                    <div
                      key={item.id}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2.5 ${
                        isNegativeProduct ? 'bg-rose-50 dark:bg-rose-950/40' : ''
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{item.label}</p>
                          {isNegativeProduct && (
                            <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                              Perlu Opname
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Minimum: {formatUsageQty(item.minStock, item.satuan)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
                            isNegativeProduct
                              ? 'bg-rose-600 text-white'
                              : low
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                          }`}
                        >
                          {formatUsageQty(qty, item.satuan)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setFilterItemId(filterItemId === item.id ? '' : item.id)}
                          className="min-h-[36px] rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-slate-700 dark:text-indigo-400 dark:hover:bg-slate-800"
                        >
                          Kartu
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Kartu Stok (Ledger Append-Only)</h3>
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-slate-500" />
                <select
                  value={filterItemId}
                  onChange={(e) => setFilterItemId(e.target.value)}
                  className="min-h-[38px] rounded-lg border border-slate-300 px-2.5 text-xs"
                >
                  <option value="">Semua Item</option>
                  {itemOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {ledger.length === 0 ? (
              <EmptyState description="Belum ada catatan mutasi stok pada filter ini." />
            ) : (
              <div className="space-y-2">
                {ledger.map((entry) => {
                  const info = itemOptions.find((o) => o.id === entry.itemId);
                  const unit = info?.satuan ?? (entry.itemType === 'wip' ? 'pcs' : 'unit');
                  const isIn = entry.qty > 0;
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/50"
                    >
                      <div className="flex items-start gap-2.5">
                        <div
                          className={`mt-0.5 rounded-full p-1.5 ${
                            isIn
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                          }`}
                        >
                          {isIn ? (
                            <ArrowDownLeft className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {info?.label ?? entry.itemId}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {entry.tanggal} · {entry.jenis} · {entry.catatan || entry.refType}
                          </p>
                        </div>
                      </div>
                      <div className="text-right tabular-nums">
                        <p className={`text-xs font-bold ${isIn ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                          {isIn ? `+${formatUsageQty(entry.qty, unit)}` : formatUsageQty(entry.qty, unit)}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {formatUsageQty(entry.balance_before, unit)} → {formatUsageQty(entry.balance_after, unit)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {hasMore && (
                  <button
                    type="button"
                    onClick={() => void loadMoreLedger()}
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    Muat Halaman Berikutnya
                  </button>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
