import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertOctagon, Factory, Layers, PackageCheck, PlayCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  cancelWorkOrderByOwner,
  createWorkOrderWithBom,
  fetchRecentStageLogs,
  fetchStageLogs,
  fetchWorkOrders,
  recordWorkOrderReject,
  recordWorkOrderSetoran,
  resumeWorkOrderCut,
  type WoCutProgress,
} from '../services/firebase/productionRepo';
import { fetchBomItems, fetchMaterials, fetchProducts } from '../services/firebase/masterRepo';
import { fetchPurchaseCosts } from '../services/firebase/financeRepo';
import {
  calculateBomRequirements,
  calculateWeightedAverageCosts,
  computeProductionEfficiency,
} from '../services/domain/accounting';
import { normalizeFirestoreError } from '../services/firebase/common';
import type { BomItem, Material, Product, PurchaseCost, StageLog, WorkOrder } from '../types/models';
import { formatNumber, formatRupiah, formatUsageQty, parseIntegerInput, todayJakarta } from '../utils/format';
import {
  CacheNoticeBanner,
  ConfirmModal,
  EmptyState,
  ErrorBanner,
  LoadingCard,
  OfflineWriteBlockedBanner,
} from '../components/ui/StateViews';

const STAGE_LABEL: Record<string, string> = {
  potong: '1. Potong Bahan',
  setoran: '2. Proses & Setoran Bertahap',
  reject: 'Reject Terpisah',
  completed: 'Selesai',
  // Fallback tampilan data historis
  cutting: 'Cutting (Lama)',
  sewing: 'Sewing (Lama)',
  qc: 'QC (Lama)',
  packing: 'Packing (Lama)',
};

export const WorkOrderScreen: React.FC = () => {
  const { profile, isOnline } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cutProgress, setCutProgress] = useState<WoCutProgress | null>(null);
  const [busy, setBusy] = useState(false);

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [recentLogs, setRecentLogs] = useState<StageLog[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [bomItems, setBomItems] = useState<BomItem[]>([]);
  const [purchaseCosts, setPurchaseCosts] = useState<PurchaseCost[]>([]);

  // Form buat WO
  const [woNumber, setWoNumber] = useState(`WO-${Date.now().toString().slice(-6)}`);
  const [productId, setProductId] = useState('');
  const [targetQty, setTargetQty] = useState('20');
  const [tanggal, setTanggal] = useState(todayJakarta());
  const [catatan, setCatatan] = useState('');

  // Modal Setoran / Reject
  const [modalMode, setModalMode] = useState<'setoran' | 'reject' | null>(null);
  const [activeWo, setActiveWo] = useState<WorkOrder | null>(null);
  const [activeWoLogs, setActiveWoLogs] = useState<StageLog[]>([]);
  const [actionQty, setActionQty] = useState('0');
  const [actionDate, setActionDate] = useState(todayJakarta());
  const [actionNote, setActionNote] = useState('');

  const [cancelTarget, setCancelTarget] = useState<WorkOrder | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [woRes, logRes, prodRes, matRes, bomRes, costRes] = await Promise.all([
        fetchWorkOrders(50),
        fetchRecentStageLogs(100),
        fetchProducts(150),
        fetchMaterials(150),
        fetchBomItems(undefined, 300),
        fetchPurchaseCosts(300),
      ]);
      setWorkOrders(woRes.items);
      setRecentLogs(logRes.items);
      setProducts(prodRes.items);
      setMaterials(matRes.items);
      setBomItems(bomRes.items);
      setPurchaseCosts(costRes.items);
      setFromCache(woRes.fromCache || prodRes.fromCache);
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const costModel = useMemo(
    () =>
      calculateWeightedAverageCosts({
        ledgerEntries: [],
        purchaseCosts,
        productionCosts: [],
        workOrders,
        bomItems,
        products,
      }),
    [bomItems, products, purchaseCosts, workOrders],
  );

  const bomPreview = useMemo(() => {
    const qty = parseIntegerInput(targetQty);
    if (!productId || qty <= 0) return [];
    return calculateBomRequirements(bomItems, productId, qty).map((req) => {
      const mat = materials.find((m) => m.id === req.materialId);
      return {
        ...req,
        nama: mat?.nama ?? req.materialId,
        satuan: mat?.satuanPakai ?? mat?.satuan ?? 'pcs',
      };
    });
  }, [bomItems, materials, productId, targetQty]);

  const selectedRecipeHpp = productId ? costModel.recipeHppByProduct[productId] : undefined;

  const efficiency = useMemo(
    () => computeProductionEfficiency({ workOrders, stageLogs: recentLogs }),
    [workOrders, recentLogs],
  );

  const openActionModal = async (wo: WorkOrder, mode: 'setoran' | 'reject') => {
    setActiveWo(wo);
    setModalMode(mode);
    setActionQty(mode === 'setoran' ? String(wo.wipQty) : '1');
    setActionDate(todayJakarta());
    setActionNote('');
    try {
      const logs = await fetchStageLogs(wo.id, 50);
      setActiveWoLogs(logs.items);
    } catch {
      setActiveWoLogs([]);
    }
  };

  const handleCreateWo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setError(null);
    setMsg(null);
    setCutProgress(null);
    setBusy(true);
    try {
      await createWorkOrderWithBom({
        actorUid: profile.uid,
        actorName: profile.nama,
        actorRole: profile.role,
        woNumber,
        productId,
        targetQty: parseIntegerInput(targetQty),
        tanggal,
        catatan,
        bomItems,
        hppPerPcsSnapshot: selectedRecipeHpp?.hppPerPcs,
        onProgress: (p) => setCutProgress(p),
      });
      setMsg(`Work Order ${woNumber} dibuat & seluruh bahan Resep berhasil dipotong.`);
      setWoNumber(`WO-${Date.now().toString().slice(-6)}`);
      setCatatan('');
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleResumeCut = async (wo: WorkOrder) => {
    if (!profile) return;
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const prog = await resumeWorkOrderCut({
        actorUid: profile.uid,
        actorName: profile.nama,
        wo,
        bomItems,
        onProgress: (p) => setCutProgress(p),
      });
      setMsg(
        `Pemotongan bahan ${wo.woNumber} dilanjutkan (${prog.doneMaterials}/${prog.totalMaterials} bahan selesai).`,
      );
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !activeWo || !modalMode) return;
    setError(null);
    setMsg(null);
    setBusy(true);
    const qty = parseIntegerInput(actionQty);
    try {
      if (modalMode === 'setoran') {
        await recordWorkOrderSetoran({
          actorUid: profile.uid,
          actorName: profile.nama,
          woId: activeWo.id,
          setoranQty: qty,
          tanggal: actionDate,
          catatan: actionNote,
        });
        setMsg(`Setoran ${qty} pcs dari ${activeWo.woNumber} masuk ke gudang barang jadi.`);
      } else {
        const unitMatCost = Math.round(
          costModel.woUnitMaterialCostFloat[activeWo.id] ??
            costModel.recipeHppByProduct[activeWo.productId]?.materialCostFloat ??
            0,
        );
        await recordWorkOrderReject({
          actorUid: profile.uid,
          actorName: profile.nama,
          woId: activeWo.id,
          rejectQty: qty,
          reason: actionNote,
          tanggal: actionDate,
          unitMaterialCostRupiah: unitMatCost,
        });
        setMsg(`Reject ${qty} pcs pada ${activeWo.woNumber} dicatat ke beban reject periode.`);
      }
      setActiveWo(null);
      setModalMode(null);
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Produksi Bertahap (Work Order)</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Potong bahan sesuai Resep (otomatis dipecah &le; 4 bahan/transaksi agar aman) → Setoran bertahap ke gudang → Catat Reject terpisah.
        </p>
      </div>

      <OfflineWriteBlockedBanner isOnline={isOnline} />
      <CacheNoticeBanner visible={fromCache} />
      {cutProgress && !cutProgress.completed && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">
          Progres pemotongan bahan: {cutProgress.doneMaterials}/{cutProgress.totalMaterials} item selesai...
        </div>
      )}
      {msg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          {msg}
        </div>
      )}
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
          <Layers className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Ringkasan Produksi & Antrean WIP
        </h3>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/70">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Antrean WIP</p>
            <p className="text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
              {formatNumber(efficiency.activeWipQty)} pcs
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/70">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">WO Selesai</p>
            <p className="text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
              {efficiency.completedWorkOrders}/{efficiency.totalWorkOrders}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/70">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Total Reject</p>
            <p className="text-base font-bold text-rose-700 tabular-nums dark:text-rose-400">
              {formatNumber(efficiency.totalRejectedQty)} pcs
            </p>
          </div>
        </div>
      </section>

      {/* Form Buat WO */}
      <form
        onSubmit={handleCreateWo}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
      >
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 sm:col-span-2 dark:text-slate-100">
          <Factory className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Buat Work Order & Potong Bahan Resep
        </h3>
        <input
          required
          value={woNumber}
          onChange={(e) => setWoNumber(e.target.value)}
          placeholder="Nomor WO"
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        />
        <input
          required
          type="date"
          value={tanggal}
          onChange={(e) => setTanggal(e.target.value)}
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        />
        <select
          required
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
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
        <input
          required
          type="number"
          min={1}
          value={targetQty}
          onChange={(e) => setTargetQty(e.target.value)}
          placeholder="Target Qty (pcs)"
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        />
        {bomPreview.length > 0 && (
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 p-3 text-xs sm:col-span-2 dark:border-indigo-900 dark:bg-indigo-950/40">
            <p className="font-semibold text-indigo-900 dark:text-indigo-200">
              Kebutuhan Bahan Resep ({bomPreview.length} item{bomPreview.length > 4 ? ' · dipotong bertahap per 4 item' : ''}):
            </p>
            <ul className="mt-1 list-disc pl-4 text-indigo-800 tabular-nums dark:text-indigo-300">
              {bomPreview.map((b) => (
                <li key={b.materialId}>
                  {b.nama}: {formatUsageQty(b.requiredQty, b.satuan)}
                </li>
              ))}
            </ul>
            {selectedRecipeHpp && (
              <p className="mt-2 font-semibold text-indigo-900 dark:text-indigo-100">
                Snapshot Estimasi HPP Resep: {formatRupiah(selectedRecipeHpp.hppPerPcs)} / pcs
              </p>
            )}
          </div>
        )}
        <input
          value={catatan}
          onChange={(e) => setCatatan(e.target.value)}
          placeholder="Catatan produksi / penjahit / sablon (opsional)"
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm sm:col-span-2"
        />
        <button
          type="submit"
          disabled={!isOnline || busy}
          className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 sm:col-span-2"
        >
          {busy ? 'Memotong Bahan...' : 'Terbitkan Work Order & Potong Bahan Resep'}
        </button>
      </form>

      {loading ? (
        <LoadingCard />
      ) : workOrders.length === 0 ? (
        <EmptyState description="Belum ada Work Order produksi." />
      ) : (
        <div className="space-y-2.5">
          {workOrders.map((wo) => {
            const prod = products.find((p) => p.id === wo.productId);
            const totalReqMats = calculateBomRequirements(bomItems, wo.productId, wo.targetQty).length;
            const cutDoneCount = wo.cutMaterialIds?.length ?? totalReqMats;
            const cutIncomplete = wo.status === 'in_progress' && wo.cutCompleted === false;

            return (
              <div
                key={wo.id}
                className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {wo.woNumber} · {prod ? `${prod.nama} (${prod.ukuran})` : wo.productId}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {wo.tanggal} · {STAGE_LABEL[wo.currentStage] ?? wo.currentStage}
                      {wo.hppPerPcsSnapshot ? ` · HPP: ${formatRupiah(wo.hppPerPcsSnapshot)}/pcs` : ''}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${
                      wo.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : wo.status === 'cancelled'
                          ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                    }`}
                  >
                    {wo.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-2 text-center text-xs tabular-nums dark:bg-slate-800/70">
                  <div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Target</p>
                    <p className="font-bold text-slate-900 dark:text-slate-100">{formatNumber(wo.targetQty)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">WIP</p>
                    <p className="font-bold text-indigo-700 dark:text-indigo-400">{formatNumber(wo.wipQty)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Disetor</p>
                    <p className="font-bold text-emerald-700 dark:text-emerald-400">{formatNumber(wo.completedQty)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Reject</p>
                    <p className="font-bold text-rose-700 dark:text-rose-400">{formatNumber(wo.rejectedQty ?? 0)}</p>
                  </div>
                </div>

                {cutIncomplete && (
                  <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                    Pemotongan bahan belum selesai ({cutDoneCount}/{totalReqMats} bahan). Lanjutkan potong bahan agar masuk WIP.
                  </div>
                )}

                {wo.status === 'in_progress' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {cutIncomplete ? (
                      <button
                        type="button"
                        disabled={!isOnline || busy}
                        onClick={() => void handleResumeCut(wo)}
                        className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        <PlayCircle className="h-4 w-4" /> Lanjutkan Potong Bahan ({cutDoneCount}/{totalReqMats})
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={!isOnline || wo.wipQty <= 0}
                          onClick={() => void openActionModal(wo, 'setoran')}
                          className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <PackageCheck className="h-4 w-4" /> Setoran ke Gudang
                        </button>
                        <button
                          type="button"
                          disabled={!isOnline || wo.wipQty <= 0}
                          onClick={() => void openActionModal(wo, 'reject')}
                          className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg border border-rose-300 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950"
                        >
                          <AlertOctagon className="h-4 w-4" /> Catat Reject
                        </button>
                      </>
                    )}
                    {isOwner && (
                      <button
                        type="button"
                        disabled={!isOnline}
                        onClick={() => setCancelTarget(wo)}
                        className="min-h-[42px] rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        Batalkan
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Setoran / Reject */}
      {activeWo && modalMode && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {modalMode === 'setoran' ? 'Setoran Barang Jadi ke Gudang' : 'Catat Reject Produksi'} — {activeWo.woNumber}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sisa WIP tersedia: <strong className="tabular-nums">{formatNumber(activeWo.wipQty)} pcs</strong>
            </p>

            {activeWoLogs.length > 0 && (
              <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-2.5 text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <p className="font-semibold">Riwayat Setoran & Reject:</p>
                {activeWoLogs.map((l) => (
                  <p key={l.id}>
                    • {STAGE_LABEL[l.stage] ?? l.stage} ({l.tanggal}): Good {l.goodQty}, Reject {l.rejectQty}
                    {l.rejectReason ? ` (${l.rejectReason})` : ''}
                  </p>
                ))}
              </div>
            )}

            <form onSubmit={handleSubmitAction} className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  {modalMode === 'setoran' ? 'Jumlah Setoran Masuk Gudang (pcs)' : 'Jumlah Rusak Parah / Reject (pcs)'}
                </label>
                <input
                  required
                  type="number"
                  min={1}
                  max={activeWo.wipQty}
                  value={actionQty}
                  onChange={(e) => setActionQty(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">Tanggal</label>
                <input
                  required
                  type="date"
                  value={actionDate}
                  onChange={(e) => setActionDate(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  {modalMode === 'reject' ? 'Alasan Reject (wajib)' : 'Catatan Setoran (opsional)'}
                </label>
                <input
                  required={modalMode === 'reject'}
                  value={actionNote}
                  onChange={(e) => setActionNote(e.target.value)}
                  placeholder={modalMode === 'reject' ? 'Cth: Kain sobek saat jahit' : 'Cth: Setoran kloter 1'}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setActiveWo(null);
                    setModalMode(null);
                  }}
                  className="min-h-[44px] flex-1 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  Tutup
                </button>
                <button
                  type="submit"
                  disabled={!isOnline || busy}
                  className={`min-h-[44px] flex-1 rounded-lg text-xs font-semibold text-white disabled:opacity-50 ${
                    modalMode === 'reject' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {busy ? 'Menyimpan...' : modalMode === 'setoran' ? 'Simpan Setoran' : 'Simpan Reject'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(cancelTarget)}
        title="Batalkan Work Order?"
        message={`Work Order ${cancelTarget?.woNumber} akan ditandai cancelled dan dicatat di audit log.`}
        danger
        onConfirm={() => {
          if (!profile || !cancelTarget) return;
          void cancelWorkOrderByOwner({
            actorUid: profile.uid,
            actorName: profile.nama,
            woId: cancelTarget.id,
            woNumber: cancelTarget.woNumber,
          }).then(() => {
            setCancelTarget(null);
            setMsg('Work Order dibatalkan.');
            return load();
          });
        }}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
};
