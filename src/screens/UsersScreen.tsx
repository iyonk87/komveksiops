import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { fetchUsers, provisionUserByOwner, updateUserRoleStatus } from '../services/firebase/masterRepo';
import { getRoleLabel } from '../services/auth/rbac';
import { normalizeFirestoreError } from '../services/firebase/common';
import type { UserProfile, UserRole } from '../types/models';
import {
  CacheNoticeBanner,
  EmptyState,
  ErrorBanner,
  LoadingCard,
  OfflineWriteBlockedBanner,
} from '../components/ui/StateViews';

export const UsersScreen: React.FC = () => {
  const { profile, isOnline } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [nama, setNama] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('admin');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchUsers(50);
      setUsers(res.items);
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

  if (profile?.role !== 'owner') {
    return <ErrorBanner message="Kelola User hanya dapat diakses oleh Owner." />;
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMsg(null);
    try {
      await provisionUserByOwner({
        actorUid: profile.uid,
        actorName: profile.nama,
        nama,
        email,
        password,
        role,
      });
      setMsg(`User ${email} (${getRoleLabel(role)}) berhasil dibuat tanpa mengganti sesi Owner.`);
      setNama('');
      setEmail('');
      setPassword('');
      await load();
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Kelola User &amp; Role (Khusus Owner)
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Peran sistem hanya Owner dan Admin. Admin mengakses semua menu operasional &amp; keuangan kecuali Kelola User dan buka ulang periode tertutup.
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
        onSubmit={handleCreate}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
      >
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 sm:col-span-2 dark:text-slate-100">
          <UserPlus className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Daftarkan User Baru
        </h3>
        <input
          required
          value={nama}
          onChange={(e) => setNama(e.target.value)}
          placeholder="Nama Lengkap"
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        />
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email Login"
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        />
        <input
          required
          type="password"
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Kata Sandi (min 6 karakter)"
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
        >
          <option value="admin">Admin</option>
          <option value="owner">Owner</option>
        </select>
        <button
          type="submit"
          disabled={!isOnline || submitting}
          className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 sm:col-span-2"
        >
          {submitting ? 'Membuat Akun...' : 'Buat Akun User'}
        </button>
      </form>

      {loading ? (
        <LoadingCard />
      ) : users.length === 0 ? (
        <EmptyState description="Belum ada dokumen pengguna." />
      ) : (
        <div className="space-y-2">
          {users.map((u) => {
            const isSelf = u.uid === profile.uid;
            const isLegacyRole = (u.role as string) !== 'owner' && (u.role as string) !== 'admin';
            return (
              <div
                key={u.uid}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {u.nama}{' '}
                    {isSelf && <span className="text-xs text-indigo-600 dark:text-indigo-400">(Anda)</span>}
                    {isLegacyRole && (
                      <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        Role lama ({u.role}) — perbarui ke Admin/Owner
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {u.email} · {getRoleLabel(u.role)}
                  </p>
                </div>
                {!isSelf && (
                  <div className="flex items-center gap-2">
                    <select
                      disabled={!isOnline}
                      value={u.role === 'owner' ? 'owner' : 'admin'}
                      onChange={(e) =>
                        void updateUserRoleStatus({
                          actorUid: profile.uid,
                          actorName: profile.nama,
                          target: u,
                          role: e.target.value as UserRole,
                          active: u.active,
                        })
                          .then(() => {
                            setMsg(`Role ${u.nama} diubah.`);
                            return load();
                          })
                          .catch((err) => setError(normalizeFirestoreError(err)))
                      }
                      className="min-h-[38px] rounded-lg border border-slate-300 px-2 text-xs"
                    >
                      <option value="admin">Admin</option>
                      <option value="owner">Owner</option>
                    </select>
                    <button
                      type="button"
                      disabled={!isOnline}
                      onClick={() =>
                        void updateUserRoleStatus({
                          actorUid: profile.uid,
                          actorName: profile.nama,
                          target: u,
                          role: u.role === 'owner' ? 'owner' : 'admin',
                          active: !u.active,
                        })
                          .then(() => {
                            setMsg(`Status aktif ${u.nama} diperbarui.`);
                            return load();
                          })
                          .catch((err) => setError(normalizeFirestoreError(err)))
                      }
                      className={`min-h-[38px] rounded-lg px-3 text-xs font-semibold ${
                        u.active
                          ? 'border border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/60'
                          : 'bg-emerald-600 text-white hover:bg-emerald-700'
                      }`}
                    >
                      {u.active ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
