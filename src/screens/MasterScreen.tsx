import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Calculator, Edit3, Plus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchAccounts,
  fetchBomItems,
  fetchMaterials,
  fetchProducts,
  fetchSuppliers,
  saveAccount,
  saveBomItem,
  saveMaterial,
  saveProduct,
  saveSupplier,
  setAccountActive,
  setBomItemActive,
  setMaterialActive,
  setProductActive,
  setSupplierActive,
} from '../services/firebase/masterRepo';
import { fetchPurchaseCosts } from '../services/firebase/financeRepo';
import { calculateRecipeHpp, calculateWeightedAverageCosts } from '../services/domain/accounting';
import { normalizeFirestoreError } from '../services/firebase/common';
import type {
  Account,
  BomItem,
  BomItemKind,
  Material,
  MaterialCategory,
  MaterialPurchaseUnit,
  MaterialUsageUnit,
  Product,
  PurchaseCost,
  RecipeCostCategory,
  Supplier,
} from '../types/models';
import {
  formatRupiah,
  formatUsageQty,
  parseIntegerInput,
  parseLengthToCm,
  parsePatternLengthToCmPerPcs,
} from '../utils/format';
import {
  CacheNoticeBanner,
  EmptyState,
  ErrorBanner,
  LoadingCard,
  OfflineWriteBlockedBanner,
} from '../components/ui/StateViews';

type MasterTab = 'materials' | 'products' | 'resep' | 'suppliers' | 'accounts';

const COST_CATEGORY_LABEL: Record<RecipeCostCategory, string> = {
  jahit_cutting: 'Upah Jahit & Cutting',
  sablon: 'Upah Sablon',
  packing: 'Upah Packing',
  lainnya: 'Biaya Produksi Lainnya',
};

export const MasterScreen: React.FC = () => {
  const { profile, isOnline } = useAuth();

  const availableTabs: Array<{ id: MasterTab; label: string }> = [
    { id: 'materials', label: 'Bahan Baku' },
    { id: 'products', label: 'Produk SKU' },
    { id: 'resep', label: 'Resep & Tarif' },
    { id: 'suppliers', label: 'Supplier' },
    { id: 'accounts', label: 'Kas & Bank' },
  ];

  const [tab, setTab] = useState<MasterTab>('materials');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const [materials, setMaterials] = useState<Material[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [bomItems, setBomItems] = useState<BomItem[]>([]);
  const [purchaseCosts, setPurchaseCosts] = useState<PurchaseCost[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  // Form Bahan Baku
  const [editMatId, setEditMatId] = useState<string | null>(null);
  const [matKode, setMatKode] = useState('');
  const [matNama, setMatNama] = useState('');
  const [matKategori, setMatKategori] = useState<MaterialCategory>('kain');
  const [matSatuanBeli, setMatSatuanBeli] = useState<MaterialPurchaseUnit>('roll');
  const [matSatuanPakai, setMatSatuanPakai] = useState<MaterialUsageUnit>('cm');
  const [matKonversi, setMatKonversi] = useState('');
  const [matKonversiUnit, setMatKonversiUnit] = useState<'cm' | 'm'>('m');
  const [matMin, setMatMin] = useState('0');

  // Form Produk
  const [prodSku, setProdSku] = useState('');
  const [prodNama, setProdNama] = useState('');
  const [prodModel, setProdModel] = useState('');
  const [prodWarna, setProdWarna] = useState('');
  const [prodUkuran, setProdUkuran] = useState('');
  const [prodSatuan, setProdSatuan] = useState('pcs');
  const [prodMin, setProdMin] = useState('5');
  const [prodHarga, setProdHarga] = useState('0');

  // Form Resep
  const [resepProductId, setResepProductId] = useState('');
  const [resepKind, setResepKind] = useState<BomItemKind>('material');
  const [resepMaterialId, setResepMaterialId] = useState('');
  const [resepQtyInput, setResepQtyInput] = useState('');
  const [resepLengthUnit, setResepLengthUnit] = useState<'cm' | 'm'>('cm');
  const [resepPatternInput, setResepPatternInput] = useState('');
  const [resepCostCat, setResepCostCat] = useState<RecipeCostCategory>('jahit_cutting');
  const [resepCostLabel, setResepCostLabel] = useState('');
  const [resepCostAmount, setResepCostAmount] = useState('');

  // Form Supplier & Kas
  const [supNama, setSupNama] = useState('');
  const [supTelp, setSupTelp] = useState('');
  const [supAlamat, setSupAlamat] = useState('');

  const [accNama, setAccNama] = useState('');
  const [accTipe, setAccTipe] = useState<'kas' | 'bank'>('kas');
  const [accRek, setAccRek] = useState('');
  const [accSaldo, setAccSaldo] = useState('0');

  const loadAll = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const [matRes, prodRes, bomRes, costRes, supRes, accRes] = await Promise.all([
        fetchMaterials(200),
        fetchProducts(200),
        fetchBomItems(undefined, 400),
        fetchPurchaseCosts(300),
        fetchSuppliers(100),
        fetchAccounts(50),
      ]);
      setMaterials(matRes.items);
      setProducts(prodRes.items);
      setBomItems(bomRes.items);
      setPurchaseCosts(costRes.items);
      setSuppliers(supRes.items);
      setAccounts(accRes.items);
      setFromCache(matRes.fromCache || prodRes.fromCache);
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const weightedCosts = useMemo(
    () =>
      calculateWeightedAverageCosts({
        ledgerEntries: [],
        purchaseCosts,
        productionCosts: [],
        workOrders: [],
        bomItems,
        products,
      }),
    [bomItems, products, purchaseCosts],
  );

  const selectedResepMaterial = useMemo(
    () => materials.find((m) => m.id === resepMaterialId) ?? null,
    [materials, resepMaterialId],
  );

  const selectedResepHpp = useMemo(() => {
    if (!resepProductId) return null;
    return calculateRecipeHpp({
      productId: resepProductId,
      bomItems,
      materialUnitCostFloat: weightedCosts.materialUnitCostFloat,
    });
  }, [bomItems, resepProductId, weightedCosts.materialUnitCostFloat]);

  const handleAction = async (fn: () => Promise<void>, successText: string) => {
    setError(null);
    setSaveMessage(null);
    try {
      await fn();
      setSaveMessage(successText);
      await loadAll();
    } catch (err) {
      setError(normalizeFirestoreError(err));
    }
  };

  if (!profile) return null;

  const displayedBomItems = resepProductId
    ? bomItems.filter((b) => b.productId === resepProductId)
    : bomItems;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Master Data & Resep Produk</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Kelola bahan baku (satuan beli & satuan pakai cm/pcs), produk SKU, Resep bahan + tarif upah, supplier, dan kas/bank.
        </p>
      </div>

      <OfflineWriteBlockedBanner isOnline={isOnline} />
      <CacheNoticeBanner visible={fromCache} />

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {availableTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-[40px] shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tab === t.id
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {saveMessage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          {saveMessage}
        </div>
      )}
      {error && <ErrorBanner message={error} onRetry={() => void loadAll()} />}

      {loading ? (
        <LoadingCard />
      ) : (
        <>
          {tab === 'materials' && (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAction(async () => {
                    let parsedKonversi: number | null = null;
                    if (matKonversi.trim() !== '') {
                      if (matSatuanPakai === 'cm') {
                        parsedKonversi = parseLengthToCm(matKonversi, matKonversiUnit);
                      } else {
                        const n = parseIntegerInput(matKonversi);
                        if (n <= 0) throw new Error('Nilai konversi harus bilangan bulat > 0.');
                        parsedKonversi = n;
                      }
                    }
                    await saveMaterial({
                      id: editMatId ?? undefined,
                      actorUid: profile.uid,
                      kode: matKode,
                      nama: matNama,
                      kategori: matKategori,
                      satuanBeli: matSatuanBeli,
                      satuanPakai: matSatuanPakai,
                      konversi: parsedKonversi,
                      minStock: parseIntegerInput(matMin),
                    });
                    setEditMatId(null);
                    setMatKode('');
                    setMatNama('');
                    setMatKonversi('');
                    setMatMin('0');
                  }, editMatId ? 'Bahan baku berhasil diperbarui.' : 'Bahan baku berhasil disimpan.');
                }}
                className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between sm:col-span-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {editMatId ? 'Edit Bahan Baku' : 'Tambah Bahan Baku'}
                  </h3>
                  {editMatId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditMatId(null);
                        setMatKode('');
                        setMatNama('');
                        setMatKonversi('');
                      }}
                      className="text-xs font-semibold text-rose-600 hover:underline"
                    >
                      Batal Edit
                    </button>
                  )}
                </div>
                <input
                  required
                  value={matKode}
                  onChange={(e) => setMatKode(e.target.value)}
                  placeholder="Kode Bahan (cth: D300-HITAM)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <input
                  required
                  value={matNama}
                  onChange={(e) => setMatNama(e.target.value)}
                  placeholder="Nama Bahan (cth: Cordura D300 Hitam)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <select
                  value={matKategori}
                  onChange={(e) => setMatKategori(e.target.value as MaterialCategory)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="kain">Kain / Kanvas / Dinier</option>
                  <option value="benang">Benang</option>
                  <option value="resleting">Resleting / Daun Resleting</option>
                  <option value="kancing">Kancing / Ring / Aksesoris</option>
                  <option value="hangtag">Hangtag / Label</option>
                  <option value="kemasan">Kemasan / Plastik</option>
                  <option value="lainnya">Lainnya</option>
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={matSatuanBeli}
                    onChange={(e) => setMatSatuanBeli(e.target.value as MaterialPurchaseUnit)}
                    className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                  >
                    <option value="roll">Beli: Roll</option>
                    <option value="meter">Beli: Meter</option>
                    <option value="pak">Beli: Pak</option>
                    <option value="bungkus">Beli: Bungkus</option>
                    <option value="lusin">Beli: Lusin</option>
                    <option value="kg">Beli: Kg</option>
                  </select>
                  <select
                    value={matSatuanPakai}
                    onChange={(e) => setMatSatuanPakai(e.target.value as MaterialUsageUnit)}
                    className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                  >
                    <option value="cm">Pakai: cm</option>
                    <option value="pcs">Pakai: pcs</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    Konversi: 1 {matSatuanBeli} = berapa {matSatuanPakai}? (kosongkan jika belum tahu)
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={matKonversi}
                      onChange={(e) => setMatKonversi(e.target.value)}
                      placeholder={matSatuanPakai === 'cm' ? 'Kosongkan atau isi (cth: 50)' : 'Kosongkan atau isi pcs'}
                      className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 text-sm"
                    />
                    {matSatuanPakai === 'cm' && (
                      <select
                        value={matKonversiUnit}
                        onChange={(e) => setMatKonversiUnit(e.target.value as 'cm' | 'm')}
                        className="min-h-[44px] rounded-lg border border-slate-300 px-2.5 text-xs font-semibold"
                      >
                        <option value="m">meter</option>
                        <option value="cm">cm</option>
                      </select>
                    )}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    Stok Minimum ({matSatuanPakai})
                  </label>
                  <input
                    required
                    type="number"
                    min={0}
                    value={matMin}
                    onChange={(e) => setMatMin(e.target.value)}
                    placeholder="Stok Min"
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!isOnline}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 sm:col-span-2"
                >
                  <Plus className="h-4 w-4" /> {editMatId ? 'Perbarui Bahan Baku' : 'Simpan Bahan Baku'}
                </button>
              </form>

              {materials.length === 0 ? (
                <EmptyState description="Belum ada data bahan baku. Tambahkan bahan pertama di atas atau impor dari CSV/XLSX." />
              ) : (
                <div className="space-y-2">
                  {materials.map((m) => (
                    <div
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{m.nama}</p>
                          {!m.active && (
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                              Nonaktif
                            </span>
                          )}
                          {!m.konversi && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              Konversi belum diisi
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {m.kode} · {m.kategori} · Beli: {m.satuanBeli} → Pakai: {m.satuanPakai}
                          {m.konversi ? ` (1 ${m.satuanBeli} = ${formatUsageQty(m.konversi, m.satuanPakai)})` : ''} · Min:{' '}
                          {formatUsageQty(m.minStock, m.satuanPakai)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditMatId(m.id);
                            setMatKode(m.kode);
                            setMatNama(m.nama);
                            setMatKategori(m.kategori);
                            setMatSatuanBeli(m.satuanBeli);
                            setMatSatuanPakai(m.satuanPakai);
                            setMatKonversiUnit('cm');
                            setMatKonversi(m.konversi ? String(m.konversi) : '');
                            setMatMin(String(m.minStock));
                          }}
                          className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-slate-700 dark:text-indigo-400 dark:hover:bg-slate-800"
                        >
                          <Edit3 className="h-3.5 w-3.5" /> Edit
                        </button>
                        <button
                          type="button"
                          disabled={!isOnline}
                          onClick={() =>
                            void handleAction(
                              () => setMaterialActive(m.id, !m.active),
                              m.active ? 'Bahan dinonaktifkan.' : 'Bahan diaktifkan kembali.',
                            )
                          }
                          className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Archive className="h-3.5 w-3.5" />
                          {m.active ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'products' && (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAction(async () => {
                    await saveProduct({
                      actorUid: profile.uid,
                      sku: prodSku,
                      nama: prodNama,
                      model: prodModel,
                      warna: prodWarna,
                      ukuran: prodUkuran,
                      satuan: prodSatuan || 'pcs',
                      minStock: parseIntegerInput(prodMin),
                      hargaJual: parseIntegerInput(prodHarga),
                    });
                    setProdSku('');
                    setProdNama('');
                    setProdModel('');
                    setProdWarna('');
                    setProdUkuran('');
                    setProdHarga('0');
                  }, 'Produk SKU berhasil disimpan.');
                }}
                className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <h3 className="text-sm font-bold text-slate-900 sm:col-span-2 dark:text-slate-100">
                  Tambah Produk Tas Jadi (SKU)
                </h3>
                <input
                  required
                  value={prodSku}
                  onChange={(e) => setProdSku(e.target.value)}
                  placeholder="Kode SKU (cth: TAS-RANSEL-01)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <input
                  required
                  value={prodNama}
                  onChange={(e) => setProdNama(e.target.value)}
                  placeholder="Nama Produk"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <input
                  required
                  value={prodModel}
                  onChange={(e) => setProdModel(e.target.value)}
                  placeholder="Model (Ransel / Jinjing / Tas Sepatu / Tote)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    required
                    value={prodWarna}
                    onChange={(e) => setProdWarna(e.target.value)}
                    placeholder="Warna"
                    className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                  />
                  <input
                    required
                    value={prodUkuran}
                    onChange={(e) => setProdUkuran(e.target.value)}
                    placeholder="Ukuran"
                    className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                  <input
                    required
                    value={prodSatuan}
                    onChange={(e) => setProdSatuan(e.target.value)}
                    placeholder="Satuan (pcs)"
                    className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                  />
                  <input
                    required
                    type="number"
                    min={0}
                    value={prodMin}
                    onChange={(e) => setProdMin(e.target.value)}
                    placeholder="Stok Min"
                    className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                  />
                  <input
                    required
                    type="number"
                    min={0}
                    value={prodHarga}
                    onChange={(e) => setProdHarga(e.target.value)}
                    placeholder="Harga Jual (Rp)"
                    className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!isOnline}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 sm:col-span-2"
                >
                  <Plus className="h-4 w-4" /> Simpan Produk SKU
                </button>
              </form>

              {products.length === 0 ? (
                <EmptyState description="Belum ada data produk jadi (SKU)." />
              ) : (
                <div className="space-y-2">
                  {products.map((p) => {
                    const hpp = weightedCosts.recipeHppByProduct[p.id];
                    return (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {p.nama} · {p.warna} ({p.ukuran})
                          </p>
                          <p className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                            SKU: {p.sku} · Model: {p.model} · Harga Jual: {formatRupiah(p.hargaJual)} ·{' '}
                            <strong className="text-indigo-700 dark:text-indigo-400">
                              HPP Resep: {formatRupiah(hpp?.hppPerPcs ?? p.hppPerPcs ?? 0)}/pcs
                            </strong>
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={!isOnline}
                          onClick={() =>
                            void handleAction(
                              () => setProductActive(p.id, !p.active),
                              p.active ? 'Produk dinonaktifkan.' : 'Produk diaktifkan kembali.',
                            )
                          }
                          className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          {p.active ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'resep' && (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAction(async () => {
                    if (!resepProductId) throw new Error('Pilih produk SKU terlebih dahulu.');
                    if (resepKind === 'material') {
                      if (!selectedResepMaterial) throw new Error('Pilih bahan baku.');
                      let qtyInt = 0;
                      if (selectedResepMaterial.satuanPakai === 'cm') {
                        qtyInt = parseLengthToCm(resepQtyInput, resepLengthUnit);
                      } else {
                        qtyInt = parseIntegerInput(resepQtyInput);
                        if (qtyInt <= 0) throw new Error('Qty pemakaian harus bilangan bulat > 0.');
                      }
                      await saveBomItem({
                        actorUid: profile.uid,
                        productId: resepProductId,
                        jenis: 'material',
                        materialId: selectedResepMaterial.id,
                        qtyPerPcs: qtyInt,
                      });
                      setResepQtyInput('');
                      setResepPatternInput('');
                    } else {
                      const amt = parseIntegerInput(resepCostAmount);
                      const label = resepCostLabel.trim() || COST_CATEGORY_LABEL[resepCostCat];
                      await saveBomItem({
                        actorUid: profile.uid,
                        productId: resepProductId,
                        jenis: 'cost',
                        costCategory: resepCostCat,
                        label,
                        amountPerPcs: amt,
                      });
                      setResepCostLabel('');
                      setResepCostAmount('');
                    }
                  }, 'Baris Resep berhasil ditambahkan.');
                }}
                className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <h3 className="text-sm font-bold text-slate-900 sm:col-span-2 dark:text-slate-100">
                  Atur Resep Produk (Kebutuhan Bahan & Tarif Upah per 1 Pcs)
                </h3>

                <select
                  required
                  value={resepProductId}
                  onChange={(e) => setResepProductId(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">-- Pilih Produk SKU --</option>
                  {products
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} - {p.nama} ({p.ukuran})
                      </option>
                    ))}
                </select>

                <select
                  value={resepKind}
                  onChange={(e) => setResepKind(e.target.value as BomItemKind)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="material">Baris Bahan Baku</option>
                  <option value="cost">Komponen Biaya / Upah Produksi</option>
                </select>

                {resepKind === 'material' ? (
                  <>
                    <select
                      required
                      value={resepMaterialId}
                      onChange={(e) => setResepMaterialId(e.target.value)}
                      className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                    >
                      <option value="">-- Pilih Bahan Baku --</option>
                      {materials
                        .filter((m) => m.active)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.kode} · {m.nama} ({m.satuanPakai})
                          </option>
                        ))}
                    </select>

                    <div className="flex gap-2">
                      <input
                        required
                        value={resepQtyInput}
                        onChange={(e) => setResepQtyInput(e.target.value)}
                        placeholder={
                          selectedResepMaterial?.satuanPakai === 'cm'
                            ? `Pakai (${resepLengthUnit === 'm' ? 'cth: 0,5' : 'cth: 50'})`
                            : 'Qty per pcs (integer)'
                        }
                        className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 text-sm"
                      />
                      {selectedResepMaterial?.satuanPakai === 'cm' && (
                        <select
                          value={resepLengthUnit}
                          onChange={(e) => setResepLengthUnit(e.target.value as 'cm' | 'm')}
                          className="min-h-[44px] rounded-lg border border-slate-300 px-2.5 text-xs font-semibold"
                        >
                          <option value="cm">cm</option>
                          <option value="m">meter</option>
                        </select>
                      )}
                    </div>

                    {selectedResepMaterial?.satuanPakai === 'cm' && (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2.5 sm:col-span-2 dark:bg-slate-800/60">
                        <Calculator className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        <input
                          value={resepPatternInput}
                          onChange={(e) => setResepPatternInput(e.target.value)}
                          placeholder='Kalkulator pola: cth "1 mtr jadi 5 pcs"'
                          className="min-h-[38px] flex-1 rounded-lg border border-slate-300 px-2.5 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            try {
                              setError(null);
                              const cmPerPcs = parsePatternLengthToCmPerPcs(resepPatternInput);
                              setResepLengthUnit('cm');
                              setResepQtyInput(String(cmPerPcs));
                            } catch (err) {
                              setError(normalizeFirestoreError(err));
                            }
                          }}
                          className="min-h-[38px] rounded-lg bg-indigo-100 px-3 text-xs font-semibold text-indigo-800 hover:bg-indigo-200 dark:bg-indigo-900 dark:text-indigo-200"
                        >
                          Hitung cm/pcs
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <select
                      value={resepCostCat}
                      onChange={(e) => setResepCostCat(e.target.value as RecipeCostCategory)}
                      className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                    >
                      <option value="jahit_cutting">Upah Jahit + Cutting</option>
                      <option value="sablon">Upah Sablon</option>
                      <option value="packing">Upah Packing</option>
                      <option value="lainnya">Biaya Produksi Lainnya</option>
                    </select>
                    <input
                      type="number"
                      min={0}
                      required
                      value={resepCostAmount}
                      onChange={(e) => setResepCostAmount(e.target.value)}
                      placeholder="Nominal Rp / pcs (cth: 25000)"
                      className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                    />
                    <input
                      value={resepCostLabel}
                      onChange={(e) => setResepCostLabel(e.target.value)}
                      placeholder={`Label (opsional, default: ${COST_CATEGORY_LABEL[resepCostCat]})`}
                      className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm sm:col-span-2"
                    />
                  </>
                )}

                <button
                  type="submit"
                  disabled={!isOnline}
                  className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 sm:col-span-2"
                >
                  Tambah Baris Resep
                </button>
              </form>

              {selectedResepHpp && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 text-xs dark:border-indigo-900 dark:bg-indigo-950/40">
                  <p className="font-bold text-indigo-950 dark:text-indigo-100">
                    Kalkulasi HPP Resep SKU Terpilih: {formatRupiah(selectedResepHpp.hppPerPcs)} / pcs
                  </p>
                  <p className="mt-1 text-indigo-800 tabular-nums dark:text-indigo-300">
                    Bahan (rata-rata tertimbang): {formatRupiah(Math.round(selectedResepHpp.materialCostFloat))} · Jahit+Cut:{' '}
                    {formatRupiah(selectedResepHpp.jahitCuttingPerPcs)} · Sablon: {formatRupiah(selectedResepHpp.sablonPerPcs)} ·
                    Packing: {formatRupiah(selectedResepHpp.packingPerPcs)}
                  </p>
                </div>
              )}

              {displayedBomItems.length === 0 ? (
                <EmptyState description="Belum ada baris Resep pada filter SKU ini." />
              ) : (
                <div className="space-y-2">
                  {displayedBomItems.map((b) => {
                    const p = products.find((x) => x.id === b.productId);
                    const isCost = b.jenis === 'cost';
                    const m = b.materialId ? materials.find((x) => x.id === b.materialId) : undefined;
                    return (
                      <div
                        key={b.id}
                        className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {p ? `${p.sku} · ${p.nama}` : b.productId}{' '}
                            {!b.active && (
                              <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                Nonaktif
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {isCost
                              ? `[Biaya · ${COST_CATEGORY_LABEL[b.costCategory ?? 'lainnya']}] ${b.label ?? '-'}: ${formatRupiah(b.amountPerPcs ?? 0)} / pcs`
                              : `[Bahan] ${m?.nama ?? b.materialId}: ${formatUsageQty(b.qtyPerPcs ?? 0, m?.satuanPakai ?? m?.satuan ?? 'pcs')} / pcs`}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={!isOnline}
                          onClick={() =>
                            void handleAction(
                              () => setBomItemActive(b.id, !b.active),
                              b.active ? 'Baris Resep dinonaktifkan.' : 'Baris Resep diaktifkan.',
                            )
                          }
                          className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                        >
                          {b.active ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'suppliers' && (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAction(async () => {
                    await saveSupplier({
                      actorUid: profile.uid,
                      nama: supNama,
                      telepon: supTelp,
                      alamat: supAlamat,
                      catatan: '',
                    });
                    setSupNama('');
                    setSupTelp('');
                    setSupAlamat('');
                  }, 'Supplier berhasil disimpan.');
                }}
                className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <h3 className="text-sm font-bold text-slate-900 sm:col-span-2 dark:text-slate-100">Tambah Supplier</h3>
                <input
                  required
                  value={supNama}
                  onChange={(e) => setSupNama(e.target.value)}
                  placeholder="Nama Supplier"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <input
                  value={supTelp}
                  onChange={(e) => setSupTelp(e.target.value)}
                  placeholder="No. Telepon"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <input
                  value={supAlamat}
                  onChange={(e) => setSupAlamat(e.target.value)}
                  placeholder="Alamat"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm sm:col-span-2"
                />
                <button
                  type="submit"
                  disabled={!isOnline}
                  className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 sm:col-span-2"
                >
                  Simpan Supplier
                </button>
              </form>

              {suppliers.length === 0 ? (
                <EmptyState description="Belum ada data supplier." />
              ) : (
                <div className="space-y-2">
                  {suppliers.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{s.nama}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {s.telepon || '-'} · {s.alamat || '-'}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!isOnline}
                        onClick={() => void handleAction(() => setSupplierActive(s.id, !s.active), 'Status supplier diperbarui.')}
                        className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                      >
                        {s.active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'accounts' && (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAction(async () => {
                    await saveAccount({
                      actorUid: profile.uid,
                      nama: accNama,
                      tipe: accTipe,
                      nomorRekening: accRek,
                      saldoAwal: parseIntegerInput(accSaldo),
                    });
                    setAccNama('');
                    setAccRek('');
                    setAccSaldo('0');
                  }, 'Akun kas/bank berhasil dibuat.');
                }}
                className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <h3 className="text-sm font-bold text-slate-900 sm:col-span-2 dark:text-slate-100">
                  Tambah Akun Kas / Bank
                </h3>
                <input
                  required
                  value={accNama}
                  onChange={(e) => setAccNama(e.target.value)}
                  placeholder="Nama Akun (cth: Kas Utama / BCA)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <select
                  value={accTipe}
                  onChange={(e) => setAccTipe(e.target.value as 'kas' | 'bank')}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="kas">Kas Tunai</option>
                  <option value="bank">Rekening Bank</option>
                </select>
                <input
                  value={accRek}
                  onChange={(e) => setAccRek(e.target.value)}
                  placeholder="Nomor Rekening (opsional)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <input
                  required
                  type="number"
                  min={0}
                  value={accSaldo}
                  onChange={(e) => setAccSaldo(e.target.value)}
                  placeholder="Saldo Awal (Rp)"
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <button
                  type="submit"
                  disabled={!isOnline}
                  className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 sm:col-span-2"
                >
                  Simpan Akun Kas/Bank
                </button>
              </form>

              {accounts.length === 0 ? (
                <EmptyState description="Belum ada akun kas atau rekening bank." />
              ) : (
                <div className="space-y-2">
                  {accounts.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {a.nama} <span className="text-xs uppercase text-slate-500">({a.tipe})</span>
                        </p>
                        <p className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                          Saldo Berjalan: <strong className="text-slate-900 dark:text-slate-100">{formatRupiah(a.saldoBerjalan)}</strong> · Awal:{' '}
                          {formatRupiah(a.saldoAwal)}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!isOnline}
                        onClick={() => void handleAction(() => setAccountActive(a.id, !a.active), 'Status akun diperbarui.')}
                        className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                      >
                        {a.active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
