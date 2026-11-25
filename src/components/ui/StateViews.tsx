import React from 'react';
import { AlertTriangle, Database, RefreshCw, WifiOff } from 'lucide-react';

export const EmptyState: React.FC<{
  title?: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title = 'Belum ada data', description, actionLabel, onAction }) => (
  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900">
    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
      <Database className="h-6 w-6" />
    </div>
    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
    <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">{description}</p>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="mt-4 min-h-[44px] rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 active:bg-indigo-800"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

export const ErrorBanner: React.FC<{
  message: string;
  onRetry?: () => void;
}> = ({ message, onRetry }) => (
  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
    <div className="flex items-start gap-3">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
      <div className="flex-1">
        <p className="text-sm font-semibold">Gagal memuat atau menyimpan data</p>
        <p className="mt-0.5 text-xs text-rose-800 dark:text-rose-300">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Coba Lagi
          </button>
        )}
      </div>
    </div>
  </div>
);

export const CacheNoticeBanner: React.FC<{ visible: boolean }> = ({ visible }) => {
  if (!visible) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
      <WifiOff className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <span>Data cache, mungkin usang. Hubungkan internet untuk menyegarkan data.</span>
    </div>
  );
};

export const OfflineWriteBlockedBanner: React.FC<{ isOnline: boolean }> = ({ isOnline }) => {
  if (isOnline) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-900 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-200">
      <WifiOff className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
      <span>
        Mode Offline: transaksi tulis (stok, penjualan, jurnal, tutup periode) diblokir. Anda tetap bisa membaca data cache.
      </span>
    </div>
  );
};

export const LoadingCard: React.FC<{ label?: string }> = ({ label = 'Memuat data dari Firestore...' }) => (
  <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-10 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
    <RefreshCw className="mr-2 h-4 w-4 animate-spin text-indigo-600 dark:text-indigo-400" />
    <span>{label}</span>
  </div>
);

export const ConfirmModal: React.FC<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  open,
  title,
  message,
  confirmLabel = 'Ya, Lanjutkan',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h3>
        <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`min-h-[44px] rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 ${
              danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {busy ? 'Memproses...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
