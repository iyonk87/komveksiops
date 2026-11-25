import React, { useState } from 'react';
import { Lock, LogIn, Settings, ShieldAlert } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  clearRuntimeFirebaseConfig,
  getActiveFirebaseConfigSummary,
  hasRuntimeFirebaseOverride,
  isFirebaseConfigured,
  missingFirebaseEnvVars,
  saveRuntimeFirebaseConfig,
} from '../services/firebase/config';
import { normalizeFirestoreError } from '../services/firebase/common';

export const LoginScreen: React.FC = () => {
  const { login, authError, firebaseUser, logout, refreshProfile } = useAuth();
  const activeSummary = getActiveFirebaseConfigSummary();
  const hasOverride = hasRuntimeFirebaseOverride();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [showSetup, setShowSetup] = useState(!isFirebaseConfigured);
  const [apiKey, setApiKey] = useState(activeSummary.apiKey);
  const [authDomain, setAuthDomain] = useState(activeSummary.authDomain);
  const [projectId, setProjectId] = useState(activeSummary.projectId);
  const [appId, setAppId] = useState(activeSummary.appId);
  const [databaseId, setDatabaseId] = useState(activeSummary.databaseId ?? '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setFormError(normalizeFirestoreError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanProjectId = projectId.trim();
    saveRuntimeFirebaseConfig({
      apiKey: apiKey.trim(),
      authDomain: authDomain.trim(),
      projectId: cleanProjectId,
      storageBucket: activeSummary.storageBucket || `${cleanProjectId}.firebasestorage.app`,
      messagingSenderId: activeSummary.messagingSenderId || '',
      appId: appId.trim(),
      databaseId: databaseId.trim() || undefined,
    });
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8 pt-safe pb-safe dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">KonveksiOps</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Produksi Tas, Stok & Keuangan</p>
            </div>
          </div>
          {isFirebaseConfigured && (
            <button
              type="button"
              onClick={() => setShowSetup((v) => !v)}
              title="Pengaturan Koneksi Firebase"
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
        </div>

        {!isFirebaseConfigured || showSetup ? (
          <div className="space-y-4">
            {!isFirebaseConfigured && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
                  <div>
                    <p className="font-semibold">Konfigurasi Firebase Web SDK Belum Terpasang</p>
                    <p className="mt-1">
                      Isi <code className="rounded bg-rose-100 px-1 dark:bg-rose-900">.env</code> (
                      {missingFirebaseEnvVars.join(', ')}) atau tempel konfigurasi Web App Firebase di bawah ini:
                    </p>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSaveConfig} className="space-y-2.5 text-xs">
              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">API Key (Web App)</label>
                <input
                  required
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">Auth Domain</label>
                <input
                  required
                  value={authDomain}
                  onChange={(e) => setAuthDomain(e.target.value)}
                  placeholder="project-id.firebaseapp.com"
                  className="min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">Project ID</label>
                <input
                  required
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  placeholder="project-id"
                  className="min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">Web App ID</label>
                <input
                  required
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="1:1234567890:web:..."
                  className="min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                  Database ID Firestore (kosongkan jika memakai (default))
                </label>
                <input
                  value={databaseId}
                  onChange={(e) => setDatabaseId(e.target.value)}
                  placeholder="(default)"
                  className="min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-xs"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  className="min-h-[44px] flex-1 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Simpan & Hubungkan Firebase
                </button>
                {(isFirebaseConfigured || hasOverride) && (
                  <button
                    type="button"
                    onClick={() => {
                      clearRuntimeFirebaseConfig();
                      window.location.reload();
                    }}
                    className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
                  >
                    Reset
                  </button>
                )}
              </div>
            </form>
          </div>
        ) : firebaseUser ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              <p className="font-semibold">Login Auth berhasil: {firebaseUser.email}</p>
              <p className="mt-1">
                UID: <code className="select-all rounded bg-amber-100 px-1.5 py-0.5 font-mono dark:bg-amber-900">{firebaseUser.uid}</code>
              </p>
              <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">
                Project: <strong>{activeSummary.projectId}</strong> · Database:{' '}
                <strong>{activeSummary.databaseId || '(default)'}</strong>
              </p>
              <p className="mt-2 font-medium">
                {authError || 'Profil pengguna tidak aktif atau belum tersedia.'}
              </p>
              <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-300">
                Pastikan dokumen <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">users/{firebaseUser.uid}</code> ada di
                Firestore dengan field <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">role: &quot;owner&quot;</code> atau{' '}
                <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">&quot;admin&quot;</code> dan{' '}
                <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">active: true</code>.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void refreshProfile()}
                className="min-h-[44px] flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                Periksa Ulang Profil
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Keluar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {(formError || authError) && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
                {formError || authError}
              </div>
            )}

            <div>
              <label htmlFor="login-email" className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@perusahaan.com"
                className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Kata Sandi
              </label>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
            >
              <LogIn className="h-4 w-4" />
              {submitting ? 'Memverifikasi...' : 'Masuk ke KonveksiOps'}
            </button>

            <div className="space-y-1 text-center text-[11px] text-slate-500 dark:text-slate-400">
              <p>
                Terhubung ke <strong>{activeSummary.projectId}</strong> (DB:{' '}
                <strong>{activeSummary.databaseId || '(default)'}</strong> · {activeSummary.source})
              </p>
              <p>Pendaftaran publik dinonaktifkan. Akun baru hanya dibuat oleh Owner di menu Kelola User.</p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
