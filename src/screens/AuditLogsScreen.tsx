import React, { useCallback, useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { fetchAuditLogs } from '../services/firebase/financeRepo';
import { normalizeFirestoreError } from '../services/firebase/common';
import type { AuditLog } from '../types/models';
import { formatTimestamp } from '../utils/format';
import { CacheNoticeBanner, EmptyState, ErrorBanner, LoadingCard } from '../components/ui/StateViews';

export const AuditLogsScreen: React.FC = () => {
  useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [logs, setLogs] = useState<AuditLog[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAuditLogs(100);
      setLogs(res.items);
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Audit Log (Append-Only)
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Rekam jejak aksi sensitif: approval opname, mutasi kas/upah, void/reversal, tutup &amp; buka periode, dan kelola user.
        </p>
      </div>

      <CacheNoticeBanner visible={fromCache} />
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {loading ? (
        <LoadingCard />
      ) : logs.length === 0 ? (
        <EmptyState description="Belum ada catatan audit log." />
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div
              key={log.id}
              className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-bold text-indigo-700 dark:text-indigo-400">
                  <Shield className="h-3.5 w-3.5" /> {log.aksi}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {formatTimestamp(log.createdAt)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                Actor: {log.createdByName ? `${log.createdByName} ` : ''}
                <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{log.uid}</code> · Target:{' '}
                {log.targetCollection}/{log.targetId}
              </p>
              <div className="mt-2 grid gap-1 rounded-lg bg-slate-50 p-2 font-mono text-[10px] text-slate-700 sm:grid-cols-2 dark:bg-slate-950/60 dark:text-slate-300">
                <div>Sebelum: {log.sebelum}</div>
                <div>Sesudah: {log.sesudah}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
