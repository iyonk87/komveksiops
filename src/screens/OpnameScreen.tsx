import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ClipboardList, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchOpnameRequests,
  fetchStockBalances,
  resolveOpnameRequest,
  submitOpnameRequest,
} from '../services/firebase/inventoryRepo';
import { fetchMaterials, fetchProducts } from '../services/firebase/masterRepo';
import { getMaterialUsageUnit } from '../services/domain/accounting';
import { normalizeFirestoreError } from '../services/firebase/common';
import type { OpnameRequest } from '../types/models';
import { formatNumber, formatUsageQty, parseIntegerInput, todayJakarta } from '../utils/format';
import {
  CacheNoticeBanner,
  ConfirmModal,
  EmptyState,
  ErrorBanner,
  LoadingCard,
  OfflineWriteBlockedBanner,
} from '../components/ui/StateViews';

export const OpnameScreen: React.FC = () => {
  const { profile, isOnline } = useAuth();
  const canApprove = profile?.role === 'owner' || profile?.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const [requests, setRequests] = useState<OpnameRequest[]>([]);
  const [items, setItems] = useState<
    Array<{ id: string; type: 'material' | 'product'; label: string; qty: number; unit: string }>
  >([]);

  const [selectedItemId, setSelectedItemId] = useState('');
  const [physicalQty, setPhysicalQty] = useState('');
  const [alasan, setAlasan] = useState('');
  const [tanggal, setTanggal] = useState(todayJakarta());

  const [confirmTarget, setConfirmTarget] = useState<{ op: OpnameRequest; decision: 'approved' | 'rejected' } | null>(null);
  const [busyApprove, setBusyApprove] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [opRes, balRes, matRes, prodRes] = await Promise.all([
        fetchOpnameRequests(50),
        fetchStockBalances(300),
        fetchMaterials(200),
        fetchProducts(200),
      ]);
      const balMap = new Map<string, number>();
      balRes.items.forEach((b) => balMap.set(b.itemId, b.qty));

      const merged: Array<{
        id: string;
        type: 'material' | 'product';
        label: string;
        qty: number;
        unit: string;
      }> = [];
      matRes.items
        .filter((m) => m.active)
        .forEach((m) =>
          merged.push({
            id: m.id,
            type: 'material',
            label: `[Bahan] ${m.nama}`,
            qty: balMap.get(m.id) ?? 0,
            unit: getMaterialUsageUnit(m),
          }),
        );
      prodRes.items
        .filter((p) => p.active)
        .forEach((p) =>
          merged.push({
            id: p.id,
            type: 'product',
            label: `[SKU] ${p.sku} - ${p.nama} (${p.ukuran})`,
            qty: balMap.get(p.id) ?? 0,
            unit: 'pcs',
          }),
        );
      setItems(merged);
      setRequests(opRes.items);
      setFromCache(opRes.fromCache || balRes.fromCache);
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const itemLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((it) => m.set(it.id, it.label));
    return m;
  }, [items]);

  const negativeProducts = useMemo(
    () => items.filter((it) => it.type === 'product' && it.qty < 0),
    [items],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setError(null);
    setMsg(null);
    const chosen = items.find((i) => i.id === selectedItemId);
    if (!chosen) {
      setError('Pilih item terlebih dahulu.');
      return;
    }
    try {
      await submitOpnameRequest({
        actorUid: profile.uid,
        actorName: profile.nama,
        itemId: chosen.id,
        itemType: chosen.type,
        systemQty: chosen.qty,
        physicalQty: parseIntegerInput(physicalQty),
        alasan,
        tanggal,
      });
      setMsg('Pengajuan stock opname berhasil dikirim.');
      setPhysicalQty('');
      setAlasan('');
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
    }
  };

  const executeDecision = async () => {
    if (!profile || !confirmTarget) return;
    setBusyApprove(true);
    setError(null);
    setMsg(null);
    try {
      await resolveOpnameRequest({
        actorUid: profile.uid,
        actorName: profile.nama,
        opnameId: confirmTarget.op.id,
        decision: confirmTarget.decision,
      });
      setMsg(
        confirmTarget.decision === 'approved'
          ? 'Opname disetujui dan mutasi koreksi telah ditulis ke ledger.'
          : 'Pengajuan opname ditolak.',
      );
      setConfirmTarget(null);
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setBusyApprove(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Stock Opname</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Koreksi selisih hitung fisik (termasuk barang jadi bersaldo minus dari penjualan sebelum setoran) dicatat lewat ledger opname_koreksi.
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

      {negativeProducts.length > 0 && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200">
          <p className="flex items-center gap-1.5 font-bold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {negativeProducts.length} Produk Barang Jadi Bersaldo Minus (Perlu Opname / Setoran):
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {negativeProducts.map((np) => (
              <button
                key={np.id}
                type="button"
                onClick={() => setSelectedItemId(np.id)}
                className="rounded-full border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-800 hover:bg-rose-100 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-200"
              >
                {np.label}: {np.qty} pcs
              </button>
            ))}
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
      >
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 sm:col-span-2 dark:text-slate-100">
          <ClipboardList className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Ajukan Stock Opname
        </h3>
        <select
          required
          value={selectedItemId}
          onChange={(e) => setSelectedItemId(e.target.value)}
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm sm:col-span-2"
        >
          <option value="">-- Pilih Item --</option>
          {items.map((it) => (
            <option key={it.id} value={it.id}>
              {it.label} (Stok Sistem: {formatUsageQty(it.qty, it.unit)}){it.qty < 0 ? ' [PERLU OPNAME]' : ''}
            </option>
          ))}
        </select>
        <input
          required
          type="number"
          min={0}
          value={physicalQty}
          onChange={(e) => setPhysicalQty(e.target.value)}
          placeholder="Jumlah Fisik Sebenarnya (dalam cm / pcs)"
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        />
        <input
          required
          type="date"
          value={tanggal}
          onChange={(e) => setTanggal(e.target.value)}
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        />
        <input
          required
          value={alasan}
          onChange={(e) => setAlasan(e.target.value)}
          placeholder="Alasan / keterangan selisih opname"
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm sm:col-span-2"
        />
        <button
          type="submit"
          disabled={!isOnline}
          className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 sm:col-span-2"
        >
          Kirim Pengajuan Opname
        </button>
      </form>

      {loading ? (
        <LoadingCard />
      ) : requests.length === 0 ? (
        <EmptyState description="Belum ada pengajuan stock opname." />
      ) : (
        <div className="space-y-2.5">
          {requests.map((op) => (
            <div
              key={op.id}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {itemLabelMap.get(op.itemId) ?? op.itemId}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {op.tanggal} · {op.alasan}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${
                    op.status === 'approved'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                      : op.status === 'rejected'
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                  }`}
                >
                  {op.status}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5 text-center text-xs tabular-nums dark:bg-slate-950/60">
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Sistem</p>
                  <p className="font-bold text-slate-900 dark:text-slate-100">{formatNumber(op.systemQty)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Fisik</p>
                  <p className="font-bold text-slate-900 dark:text-slate-100">{formatNumber(op.physicalQty)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Selisih</p>
                  <p
                    className={`font-bold ${
                      op.diffQty >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {op.diffQty > 0 ? `+${op.diffQty}` : op.diffQty}
                  </p>
                </div>
              </div>

              {canApprove && op.status === 'pending' && (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={!isOnline}
                    onClick={() => setConfirmTarget({ op, decision: 'approved' })}
                    className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" /> Setujui &amp; Koreksi Stok
                  </button>
                  <button
                    type="button"
                    disabled={!isOnline}
                    onClick={() => setConfirmTarget({ op, decision: 'rejected' })}
                    className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg border border-rose-300 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/60"
                  >
                    <X className="h-4 w-4" /> Tolak
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmTarget)}
        title={confirmTarget?.decision === 'approved' ? 'Setujui Stock Opname?' : 'Tolak Stock Opname?'}
        message={
          confirmTarget?.decision === 'approved'
            ? `Stok sistem akan dikoreksi ke ${confirmTarget?.op.physicalQty} dan dicatat di ledger + audit log.`
            : 'Pengajuan opname akan ditolak tanpa mengubah stok.'
        }
        danger={confirmTarget?.decision === 'rejected'}
        busy={busyApprove}
        onConfirm={() => void executeDecision()}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
};
