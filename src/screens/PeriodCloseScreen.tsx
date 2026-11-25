import React, { useCallback, useEffect, useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { fetchPeriods, setPeriodClosed } from '../services/firebase/financeRepo';
import { normalizeFirestoreError } from '../services/firebase/common';
import type { PeriodDoc } from '../types/models';
import { currentPeriodJakarta } from '../utils/format';
import {
  CacheNoticeBanner,
  ConfirmModal,
  EmptyState,
  ErrorBanner,
  LoadingCard,
  OfflineWriteBlockedBanner,
} from '../components/ui/StateViews';

export const PeriodCloseScreen: React.FC = () => {
  const { profile, isOnline } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const [periods, setPeriods] = useState<PeriodDoc[]>([]);
  const [periodId, setPeriodId] = useState(currentPeriodJakarta());
  const [note, setNote] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ id: string; closed: boolean; note: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPeriods(36);
      setPeriods(res.items);
      setFromCache(res.fromCache);
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!profile) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Tutup Periode Akuntansi
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Periode berstatus closed menolak seluruh transaksi baru pada bulan tersebut. Membuka kembali periode tertutup hanya boleh dilakukan oleh Owner.
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setConfirmAction({ id: periodId, closed: true, note });
        }}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
      >
        <h3 className="text-sm font-bold text-slate-900 sm:col-span-2 dark:text-slate-100">
          Tutup Periode Baru
        </h3>
        <input
          required
          type="month"
          value={periodId}
          onChange={(e) => setPeriodId(e.target.value)}
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Catatan tutup buku"
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        />
        <button
          type="submit"
          disabled={!isOnline}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 sm:col-span-2"
        >
          <Lock className="h-4 w-4" /> Tutup Periode {periodId}
        </button>
      </form>

      {loading ? (
        <LoadingCard />
      ) : periods.length === 0 ? (
        <EmptyState description="Belum ada periode yang ditutup. Semua periode masih terbuka." />
      ) : (
        <div className="space-y-2">
          {periods.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Periode {p.id}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{p.closedNote || '-'}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${
                    p.closed
                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                  }`}
                >
                  {p.closed ? 'Closed' : 'Open'}
                </span>
                {p.closed && isOwner && (
                  <button
                    type="button"
                    disabled={!isOnline}
                    onClick={() =>
                      setConfirmAction({ id: p.id, closed: false, note: 'Dibuka ulang oleh Owner' })
                    }
                    className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-300 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Unlock className="h-3.5 w-3.5" /> Buka Ulang (Owner)
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmAction)}
        title={confirmAction?.closed ? `Tutup Periode ${confirmAction.id}?` : `Buka Ulang Periode ${confirmAction?.id}?`}
        message={
          confirmAction?.closed
            ? 'Setelah ditutup, tidak ada transaksi baru yang bisa memakai tanggal di periode ini.'
            : 'Membuka ulang periode dicatat ke audit log dan hanya dapat dilakukan Owner.'
        }
        danger={Boolean(confirmAction?.closed)}
        onConfirm={() => {
          if (!confirmAction) return;
          void setPeriodClosed({
            actorUid: profile.uid,
            actorName: profile.nama,
            periodId: confirmAction.id,
            closed: confirmAction.closed,
            note: confirmAction.note,
          })
            .then(() => {
              setMsg(`Periode ${confirmAction.id} diperbarui.`);
              setConfirmAction(null);
              return load();
            })
            .catch((err) => setError(normalizeFirestoreError(err)));
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
};
