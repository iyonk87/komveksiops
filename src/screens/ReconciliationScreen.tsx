import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchBankStatements,
  importBankStatementsBatch,
  matchBankStatement,
} from '../services/firebase/financeRepo';
import { fetchAccounts } from '../services/firebase/masterRepo';
import { fetchMarketplacePayouts, fetchPayments } from '../services/firebase/salesRepo';
import { parseSpreadsheetFile, type ParsedCsvData } from '../services/domain/csv';
import { normalizeFirestoreError } from '../services/firebase/common';
import type { Account, BankStatement, MarketplacePayout, Payment } from '../types/models';
import { formatRupiah, parseIntegerInput } from '../utils/format';
import {
  CacheNoticeBanner,
  EmptyState,
  ErrorBanner,
  LoadingCard,
  OfflineWriteBlockedBanner,
} from '../components/ui/StateViews';

export const ReconciliationScreen: React.FC = () => {
  const { profile, isOnline } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [statements, setStatements] = useState<BankStatement[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [marketplacePayouts, setMarketplacePayouts] = useState<MarketplacePayout[]>([]);

  // Manual column mapping
  const [parsedCsv, setParsedCsv] = useState<ParsedCsvData | null>(null);
  const [colDate, setColDate] = useState(0);
  const [colDesc, setColDesc] = useState(1);
  const [colAmount, setColAmount] = useState(2);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accRes, stRes, payRes, mpRes] = await Promise.all([
        fetchAccounts(50),
        fetchBankStatements(selectedAccountId || undefined, 100),
        fetchPayments(undefined, 100),
        fetchMarketplacePayouts(100),
      ]);
      setAccounts(accRes.items);
      if (!selectedAccountId && accRes.items[0]) {
        setSelectedAccountId(accRes.items[0].id);
      }
      setStatements(stRes.items);
      setPayments(payRes.items);
      setMarketplacePayouts(mpRes.items);
      setFromCache(accRes.fromCache || stRes.fromCache);
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseSpreadsheetFile(file);
      setParsedCsv(parsed);
      setColDate(0);
      setColDesc(Math.min(1, parsed.headers.length - 1));
      setColAmount(Math.min(2, parsed.headers.length - 1));
    } catch (err) {
      setError(normalizeFirestoreError(err));
    }
  };

  const handleImportMapped = async () => {
    if (!profile || !parsedCsv || !selectedAccountId) return;
    setError(null);
    setMsg(null);
    try {
      const rows = parsedCsv.rows.map((r) => ({
        tanggal: (r[colDate] ?? '').trim(),
        deskripsi: r[colDesc] ?? '',
        amount: parseIntegerInput(r[colAmount] ?? '0'),
      }));
      const count = await importBankStatementsBatch({
        actorUid: profile.uid,
        accountId: selectedAccountId,
        rows,
      });
      setMsg(`${count} baris mutasi bank berhasil diimpor (baris tanggal invalid otomatis dilewati).`);
      setParsedCsv(null);
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Rekonsiliasi Kas &amp; Bank
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Impor CSV/XLSX mutasi bank lalu cocokkan dengan pencairan marketplace atau pembayaran di sistem.
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

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">
              Akun Kas / Bank
            </label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
            >
              <option value="">Semua Akun</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nama} ({formatRupiah(a.saldoBerjalan)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">
              Unggah File Mutasi (.csv / .xlsx)
            </label>
            <input
              type="file"
              accept=".csv,.xlsx,.txt,text/csv"
              onChange={(e) => void handleFileChange(e)}
              className="block w-full text-xs text-slate-600 file:mr-3 file:min-h-[40px] file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:text-xs file:font-semibold file:text-indigo-700 dark:text-slate-300 dark:file:bg-indigo-950/70 dark:file:text-indigo-200"
            />
          </div>
        </div>

        {parsedCsv && (
          <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 text-xs dark:border-indigo-900 dark:bg-indigo-950/30">
            <p className="flex items-center gap-1.5 font-bold text-indigo-900 dark:text-indigo-200">
              <FileSpreadsheet className="h-4 w-4" /> Pemetaan Kolom Manual ({parsedCsv.rows.length} baris)
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block font-semibold">Kolom Tanggal (YYYY-MM-DD)</span>
                <select
                  value={colDate}
                  onChange={(e) => setColDate(Number(e.target.value))}
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2"
                >
                  {parsedCsv.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block font-semibold">Kolom Keterangan</span>
                <select
                  value={colDesc}
                  onChange={(e) => setColDesc(Number(e.target.value))}
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2"
                >
                  {parsedCsv.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block font-semibold">Kolom Nominal (Integer)</span>
                <select
                  value={colAmount}
                  onChange={(e) => setColAmount(Number(e.target.value))}
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2"
                >
                  {parsedCsv.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              disabled={!isOnline || !selectedAccountId}
              onClick={() => void handleImportMapped()}
              className="min-h-[42px] rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white disabled:opacity-50"
            >
              Simpan Mutasi Terpetakan ke Firestore
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <LoadingCard />
      ) : statements.length === 0 ? (
        <EmptyState description="Belum ada mutasi bank yang diimpor untuk rekonsiliasi." />
      ) : (
        <div className="space-y-2">
          {statements.map((st) => {
            const candidatePayout = marketplacePayouts.find(
              (mp) => mp.amount === st.amount && mp.tanggal === st.tanggal,
            );
            const candidatePayment = payments.find(
              (p) => p.amount === st.amount && p.tanggal === st.tanggal,
            );
            const matchedId = candidatePayout?.id ?? candidatePayment?.id ?? 'manual-verified';
            const matchedLabel = candidatePayout
              ? `Pencairan ${candidatePayout.channelName}`
              : candidatePayment
                ? `Pembayaran ${candidatePayment.soNumber}`
                : 'Terverifikasi manual';

            return (
              <div
                key={st.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3.5 text-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    {st.deskripsi || '(Tanpa keterangan)'}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {st.tanggal} · {st.matchedRefId ? `Cocok: ${st.matchedNote}` : 'Belum cocok'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {formatRupiah(st.amount)}
                  </span>
                  {st.matchedRefId ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Rekonsil
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={!isOnline}
                      onClick={() => {
                        void matchBankStatement({
                          statementId: st.id,
                          matchedRefId: matchedId,
                          matchedNote: matchedLabel,
                        })
                          .then(() => {
                            setMsg('Mutasi ditandai rekonsil.');
                            return load();
                          })
                          .catch((err) => setError(normalizeFirestoreError(err)));
                      }}
                      className="min-h-[36px] rounded-lg border border-indigo-300 px-2.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
                    >
                      {candidatePayout || candidatePayment ? `Cocokkan (${matchedLabel})` : 'Tandai Cocok'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
