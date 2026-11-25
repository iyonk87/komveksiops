import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getFirebaseAuth, getFirebaseDb, isFirebaseConfigured } from '../services/firebase/config';
import { normalizeFirestoreError } from '../services/firebase/common';
import type { UserProfile, UserRole } from '../types/models';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string | null;
  isOnline: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(isFirebaseConfigured);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const loadUserProfile = useCallback(async (user: User | null) => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    try {
      setAuthError(null);
      const db = getFirebaseDb();
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) {
        setProfile(null);
        setAuthError(
          `Dokumen users/${user.uid} belum tersedia. Hubungi Owner atau buat dokumen OWNER pertama di Firebase Console.`,
        );
      } else {
        const d = snap.data();
        const rawRole = String(d.role ?? '');
        if (rawRole !== 'owner' && rawRole !== 'admin') {
          setProfile(null);
          setAuthError(
            `Role akun Anda ("${rawRole || 'kosong'}") masih menggunakan skema lama. Minta Owner mengubah role akun ini menjadi "admin" di Firestore Console atau Kelola User.`,
          );
          return;
        }
        const loaded: UserProfile = {
          uid: snap.id,
          nama: String(d.nama ?? ''),
          email: String(d.email ?? user.email ?? ''),
          role: rawRole as UserRole,
          active: Boolean(d.active),
        };
        if (!loaded.active) {
          setProfile(null);
          setAuthError('Akun Anda berstatus non-aktif. Hubungi Owner untuk mengaktifkan kembali.');
        } else {
          setProfile(loaded);
        }
      }
    } catch (err) {
      setProfile(null);
      setAuthError(normalizeFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    const auth = getFirebaseAuth();
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setLoading(true);
      void loadUserProfile(user);
    });
    return () => unsub();
  }, [loadUserProfile]);

  const login = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    const auth = getFirebaseAuth();
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const logout = useCallback(async () => {
    const auth = getFirebaseAuth();
    await signOut(auth);
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (firebaseUser) {
      setLoading(true);
      await loadUserProfile(firebaseUser);
    }
  }, [firebaseUser, loadUserProfile]);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        loading,
        authError,
        isOnline,
        login,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider');
  return ctx;
}
