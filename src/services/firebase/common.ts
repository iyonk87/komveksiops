import {
  collection,
  doc,
  documentId,
  getCountFromServer,
  getDocFromCache,
  getDocsFromCache,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentReference,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type DocumentData,
  getDocs,
  getDoc,
} from 'firebase/firestore';
import { getFirebaseDb } from './config';

export interface FetchResult<T> {
  items: T[];
  fromCache: boolean;
}

export function assertOnlineForTransaction(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(
      'Perangkat sedang offline. Transaksi tulis (stok, penjualan, jurnal, tutup periode) diblokir demi mencegah selisih data.',
    );
  }
}

export async function fetchQueryWithCacheFlag<T>(
  q: Query<DocumentData>,
  mapper: (id: string, data: DocumentData) => T,
): Promise<FetchResult<T>> {
  try {
    const snap: QuerySnapshot<DocumentData> = await getDocs(q);
    return {
      items: snap.docs.map((d) => mapper(d.id, d.data())),
      fromCache: snap.metadata.fromCache,
    };
  } catch (err) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const cached = await getDocsFromCache(q);
      return {
        items: cached.docs.map((d) => mapper(d.id, d.data())),
        fromCache: true,
      };
    }
    throw err;
  }
}

export async function fetchCollectionPaginated<T>(params: {
  collectionName: string;
  mapper: (id: string, data: DocumentData) => T;
  pageSize?: number;
  maxPages?: number;
  minDate?: string;
}): Promise<{ items: T[]; truncated: boolean; fromCache: boolean }> {
  const db = getFirebaseDb();
  const pageSize = params.pageSize ?? 200;
  const maxPages = params.maxPages ?? 15;
  const items: T[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  let truncated = false;
  let fromCache = false;

  const baseConstraints: QueryConstraint[] = params.minDate
    ? [where('tanggal', '>=', params.minDate), orderBy('tanggal', 'asc')]
    : [orderBy(documentId())];

  for (let page = 0; page < maxPages; page += 1) {
    const constraints: QueryConstraint[] = cursor
      ? [...baseConstraints, startAfter(cursor), limit(pageSize)]
      : [...baseConstraints, limit(pageSize)];
    const q: Query<DocumentData> = query(collection(db, params.collectionName), ...constraints);
    const snap: QuerySnapshot<DocumentData> = await getDocs(q);
    fromCache = fromCache || snap.metadata.fromCache;
    snap.docs.forEach((d) => items.push(params.mapper(d.id, d.data())));
    if (snap.docs.length < pageSize) {
      return { items, truncated: false, fromCache };
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (page === maxPages - 1) {
      truncated = true;
    }
  }

  return { items, truncated, fromCache };
}

export async function countCollectionDocs(collectionName: string, minDate?: string): Promise<number> {
  const db = getFirebaseDb();
  const q = minDate
    ? query(collection(db, collectionName), where('tanggal', '>=', minDate))
    : collection(db, collectionName);
  const snap = await getCountFromServer(q);
  return snap.data().count;
}

export async function fetchDocWithCacheFlag<T>(
  ref: DocumentReference<DocumentData>,
  mapper: (id: string, data: DocumentData) => T,
): Promise<{ item: T | null; fromCache: boolean }> {
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return { item: null, fromCache: snap.metadata.fromCache };
    return { item: mapper(snap.id, snap.data()), fromCache: snap.metadata.fromCache };
  } catch (err) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const cached = await getDocFromCache(ref);
      if (!cached.exists()) return { item: null, fromCache: true };
      return { item: mapper(cached.id, cached.data()), fromCache: true };
    }
    throw err;
  }
}

export function getPeriodRef(tanggal: string) {
  const db = getFirebaseDb();
  const periodId = tanggal.slice(0, 7);
  return doc(db, 'periods', periodId);
}

export function isMissingIndexError(err: unknown): boolean {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code ?? '').toLowerCase()
      : '';
  const msg = (err instanceof Error ? err.message : '').toLowerCase();
  return code.includes('failed-precondition') || msg.includes('requires an index');
}

export function timestampToMillis(val: unknown): number {
  if (!val || typeof val !== 'object') return 0;
  if ('toMillis' in val && typeof (val as { toMillis?: unknown }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  if ('seconds' in val && typeof (val as { seconds?: unknown }).seconds === 'number') {
    return (val as { seconds: number }).seconds * 1000;
  }
  return 0;
}

export function normalizeFirestoreError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  const msg = err instanceof Error ? err.message : '';
  const combined = `${code} ${msg}`.toLowerCase();

  if (
    combined.includes('auth/invalid-credential') ||
    combined.includes('auth/wrong-password') ||
    combined.includes('auth/user-not-found')
  ) {
    return 'Email atau kata sandi salah, atau akun belum dibuat di Firebase Console → Authentication → Users.';
  }
  if (combined.includes('auth/invalid-email')) {
    return 'Format email tidak valid.';
  }
  if (combined.includes('auth/user-disabled')) {
    return 'Akun ini dinonaktifkan di Firebase Authentication.';
  }
  if (combined.includes('auth/operation-not-allowed')) {
    return 'Login Email/Password belum diaktifkan di Firebase Console (Authentication → Sign-in method → Email/Password).';
  }
  if (combined.includes('auth/invalid-api-key') || combined.includes('api-key-not-valid')) {
    return 'API Key Firebase Web SDK tidak valid. Periksa VITE_FIREBASE_API_KEY di .env atau Reset pengaturan.';
  }
  if (combined.includes('auth/unauthorized-domain')) {
    return 'Domain aplikasi belum masuk daftar Authorized Domains di Firebase Authentication → Settings.';
  }
  if (combined.includes('auth/network-request-failed')) {
    return 'Gagal terhubung ke Firebase Auth. Periksa koneksi internet atau pemblokir jaringan.';
  }
  if (combined.includes('auth/too-many-requests')) {
    return 'Terlalu banyak percobaan login gagal. Tunggu beberapa saat lalu coba lagi.';
  }
  if (combined.includes('permission-denied') || combined.includes('missing or insufficient permissions')) {
    return 'Akses ditolak oleh Firestore Security Rules (pastikan firestore.rules sudah di-deploy ke project ini, dokumen users/{uid} ada dan active: true).';
  }
  if (combined.includes('not-found') || combined.includes('database') && combined.includes('does not exist')) {
    return 'Database Firestore tidak ditemukan. Pastikan Firestore Database sudah dibuat dan kolom Database ID dikosongkan untuk (default).';
  }
  if (combined.includes('unavailable') || combined.includes('offline')) {
    return 'Koneksi ke server Firestore gagal. Periksa internet, pastikan Firestore Database sudah dibuat, dan Database ID sudah benar.';
  }

  return msg || 'Terjadi kesalahan tidak terduga pada Firebase.';
}
