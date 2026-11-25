/// <reference types="vite/client" />

interface AndroidFirebaseInjectedConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  databaseId?: string;
}

interface Window {
  __ANDROID_FIREBASE_CONFIG__?: AndroidFirebaseInjectedConfig;
}
