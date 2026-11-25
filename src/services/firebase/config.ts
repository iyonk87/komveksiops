import { deleteApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  signOut,
  type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';

export interface FirebaseRuntimeConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseId?: string;
}

const LEGACY_STORAGE_KEY = 'konveksiops_firebase_config_v1';
const RUNTIME_CONFIG_STORAGE_KEY = 'konveksiops_firebase_config_v2';
const STALE_TEMPLATE_PROJECT_ID = 'gen-lang-client-0953073542';
const STALE_TEMPLATE_DATABASE_ID = 'ai-studio-android-konveksi-55b594d2-ec0a-4621-93cd-ef8299f6dabf';

function readNodeEnv(key: string): string {
  if (typeof process !== 'undefined' && process.env) {
    return (process.env[key] ?? '').trim();
  }
  return '';
}

function readStoredConfig(): Partial<FirebaseRuntimeConfig> {
  if (typeof window === 'undefined') return {};
  try {
    // Bersihkan cache lama v1 yang berpotensi menyimpan default template yang salah
    if (window.localStorage.getItem(LEGACY_STORAGE_KEY)) {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    const raw = window.localStorage.getItem(RUNTIME_CONFIG_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<FirebaseRuntimeConfig>;
    if (
      parsed.projectId === STALE_TEMPLATE_PROJECT_ID ||
      parsed.databaseId === STALE_TEMPLATE_DATABASE_ID
    ) {
      window.localStorage.removeItem(RUNTIME_CONFIG_STORAGE_KEY);
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function readAndroidInjectedConfig(): Partial<FirebaseRuntimeConfig> {
  if (typeof window === 'undefined') return {};
  return window.__ANDROID_FIREBASE_CONFIG__ ?? {};
}

function readEnvOnlyConfig(): Partial<FirebaseRuntimeConfig> {
  return {
    apiKey: (import.meta.env.VITE_FIREBASE_API_KEY || readNodeEnv('VITE_FIREBASE_API_KEY') || '').trim(),
    authDomain: (
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
      readNodeEnv('VITE_FIREBASE_AUTH_DOMAIN') ||
      ''
    ).trim(),
    projectId: (
      import.meta.env.VITE_FIREBASE_PROJECT_ID ||
      readNodeEnv('VITE_FIREBASE_PROJECT_ID') ||
      ''
    ).trim(),
    storageBucket: (
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
      readNodeEnv('VITE_FIREBASE_STORAGE_BUCKET') ||
      ''
    ).trim(),
    messagingSenderId: (
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
      readNodeEnv('VITE_FIREBASE_MESSAGING_SENDER_ID') ||
      ''
    ).trim(),
    appId: (import.meta.env.VITE_FIREBASE_APP_ID || readNodeEnv('VITE_FIREBASE_APP_ID') || '').trim(),
    databaseId:
      (import.meta.env.VITE_FIREBASE_DATABASE_ID || readNodeEnv('VITE_FIREBASE_DATABASE_ID') || '').trim() ||
      undefined,
  };
}

function resolveEnvConfig(): FirebaseRuntimeConfig {
  const stored = readStoredConfig();
  const envOnly = readEnvOnlyConfig();
  const androidCfg = readAndroidInjectedConfig();
  const hasStoredOverride = Boolean(stored.apiKey && stored.projectId && stored.appId);
  const hasCompleteEnv = Boolean(envOnly.apiKey && envOnly.projectId && envOnly.appId);

  if (hasStoredOverride) {
    return {
      apiKey: (stored.apiKey ?? '').trim(),
      authDomain: (stored.authDomain || envOnly.authDomain || '').trim(),
      projectId: (stored.projectId ?? '').trim(),
      storageBucket: (stored.storageBucket ?? '').trim(),
      messagingSenderId: (stored.messagingSenderId ?? '').trim(),
      appId: (stored.appId ?? '').trim(),
      databaseId: stored.databaseId?.trim() || undefined,
    };
  }

  if (hasCompleteEnv) {
    return {
      apiKey: (envOnly.apiKey ?? '').trim(),
      authDomain: (envOnly.authDomain ?? '').trim(),
      projectId: (envOnly.projectId ?? '').trim(),
      storageBucket: (envOnly.storageBucket ?? '').trim(),
      messagingSenderId: (envOnly.messagingSenderId ?? '').trim(),
      appId: (envOnly.appId ?? '').trim(),
      databaseId: envOnly.databaseId?.trim() || undefined,
    };
  }

  return {
    apiKey: (stored.apiKey || envOnly.apiKey || androidCfg.apiKey || '').trim(),
    authDomain: (stored.authDomain || envOnly.authDomain || androidCfg.authDomain || '').trim(),
    projectId: (stored.projectId || envOnly.projectId || androidCfg.projectId || '').trim(),
    storageBucket: (stored.storageBucket || envOnly.storageBucket || androidCfg.storageBucket || '').trim(),
    messagingSenderId: (
      stored.messagingSenderId ||
      envOnly.messagingSenderId ||
      androidCfg.messagingSenderId ||
      ''
    ).trim(),
    appId: (stored.appId || envOnly.appId || androidCfg.appId || '').trim(),
    databaseId: (stored.databaseId || envOnly.databaseId || androidCfg.databaseId || '').trim() || undefined,
  };
}

function shouldUseEmulators(): boolean {
  return (
    import.meta.env.VITE_USE_EMULATORS === 'true' ||
    readNodeEnv('VITE_USE_EMULATORS') === 'true'
  );
}

function getAuthEmulatorUrl(): string {
  const host =
    import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST ||
    readNodeEnv('FIREBASE_AUTH_EMULATOR_HOST') ||
    '127.0.0.1:9099';
  return host.startsWith('http://') || host.startsWith('https://') ? host : `http://${host}`;
}

function getFirestoreEmulatorHostPort(): { host: string; port: number } {
  const raw =
    import.meta.env.VITE_FIRESTORE_EMULATOR_HOST ||
    readNodeEnv('FIRESTORE_EMULATOR_HOST') ||
    '127.0.0.1:8080';
  const [host, portStr] = raw.split(':');
  return {
    host: host || '127.0.0.1',
    port: Number.parseInt(portStr || '8080', 10) || 8080,
  };
}

const envConfig = resolveEnvConfig();

const requiredEnvEntries: Array<[string, string]> = [
  ['VITE_FIREBASE_API_KEY', envConfig.apiKey],
  ['VITE_FIREBASE_AUTH_DOMAIN', envConfig.authDomain],
  ['VITE_FIREBASE_PROJECT_ID', envConfig.projectId],
  ['VITE_FIREBASE_APP_ID', envConfig.appId],
];

export const missingFirebaseEnvVars = requiredEnvEntries
  .filter(([, value]) => !value || value.trim() === '')
  .map(([key]) => key);

export const isFirebaseConfigured = missingFirebaseEnvVars.length === 0;

export function hasRuntimeFirebaseOverride(): boolean {
  const stored = readStoredConfig();
  return Boolean(stored.apiKey || stored.projectId || stored.appId || stored.databaseId);
}

export function getActiveFirebaseConfigSummary(): FirebaseRuntimeConfig & {
  source: 'localStorage' | 'env' | 'android' | 'none';
} {
  const stored = readStoredConfig();
  const envOnly = readEnvOnlyConfig();
  const androidCfg = readAndroidInjectedConfig();
  const resolved = resolveEnvConfig();
  const source =
    stored.apiKey || stored.projectId
      ? 'localStorage'
      : envOnly.apiKey || envOnly.projectId
        ? 'env'
        : androidCfg.apiKey || androidCfg.projectId
          ? 'android'
          : 'none';
  return { ...resolved, source };
}

export function saveRuntimeFirebaseConfig(cfg: FirebaseRuntimeConfig): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  window.localStorage.setItem(RUNTIME_CONFIG_STORAGE_KEY, JSON.stringify(cfg));
}

export function clearRuntimeFirebaseConfig(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  window.localStorage.removeItem(RUNTIME_CONFIG_STORAGE_KEY);
}

let primaryApp: FirebaseApp | null = null;
let primaryAuth: Auth | null = null;
let primaryDb: Firestore | null = null;
let emulatorsConnected = false;

function ensureInitialized(): void {
  const activeConfig = resolveEnvConfig();
  const missing = [
    ['VITE_FIREBASE_API_KEY', activeConfig.apiKey],
    ['VITE_FIREBASE_AUTH_DOMAIN', activeConfig.authDomain],
    ['VITE_FIREBASE_PROJECT_ID', activeConfig.projectId],
    ['VITE_FIREBASE_APP_ID', activeConfig.appId],
  ].filter(([, value]) => !value || value.trim() === '');

  if (missing.length > 0) {
    throw new Error(
      `Konfigurasi Firebase belum lengkap (${missing.map(([k]) => k).join(', ')}). Periksa file .env atau isi melalui form pengaturan.`,
    );
  }
  if (primaryApp && primaryAuth && primaryDb) return;

  const existing = getApps().find((a) => a.name === '[DEFAULT]');
  primaryApp = existing ?? initializeApp(activeConfig);

  try {
    primaryAuth = initializeAuth(primaryApp, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    });
  } catch {
    primaryAuth = getAuth(primaryApp);
  }

  const databaseId = activeConfig.databaseId;

  try {
    primaryDb = initializeFirestore(
      primaryApp,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      databaseId,
    );
  } catch {
    primaryDb = databaseId ? getFirestore(primaryApp, databaseId) : getFirestore(primaryApp);
  }

  if (shouldUseEmulators() && !emulatorsConnected) {
    connectAuthEmulator(primaryAuth, getAuthEmulatorUrl(), { disableWarnings: true });
    const fsEmu = getFirestoreEmulatorHostPort();
    connectFirestoreEmulator(primaryDb, fsEmu.host, fsEmu.port);
    emulatorsConnected = true;
  }
}

export function getFirebaseAuth(): Auth {
  ensureInitialized();
  return primaryAuth!;
}

export function getFirebaseDb(): Firestore {
  ensureInitialized();
  return primaryDb!;
}

/**
 * Membuat user Firebase Auth baru memakai instance aplikasi sekunder agar sesi OWNER saat ini
 * tidak tergantikan oleh user baru yang sedang dibuat.
 */
export async function createAuthUserWithSecondaryApp(
  email: string,
  password: string,
): Promise<string> {
  ensureInitialized();
  const activeConfig = resolveEnvConfig();
  const secondaryName = 'konveksiops-secondary-user-creator';
  const existing = getApps().find((a) => a.name === secondaryName);
  if (existing) {
    await deleteApp(existing);
  }
  const secondaryApp = initializeApp(activeConfig, secondaryName);
  const secondaryAuth = getAuth(secondaryApp);
  if (shouldUseEmulators()) {
    connectAuthEmulator(secondaryAuth, getAuthEmulatorUrl(), { disableWarnings: true });
  }
  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = credential.user.uid;
    await signOut(secondaryAuth);
    return uid;
  } finally {
    await deleteApp(secondaryApp).catch(() => undefined);
  }
}
