import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const result: Record<string, string> = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let val = line.slice(eqIndex + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

const FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_DATABASE_ID',
] as const;

export default defineConfig(({ mode }) => {
  const isTest = mode === 'test' || Boolean(process.env.VITEST);
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const define: Record<string, string> = {};

  if (!isTest && !env.VITE_FIREBASE_API_KEY) {
    const exampleEnv = parseEnvFile(path.resolve(process.cwd(), '.env.example'));
    if (exampleEnv.VITE_FIREBASE_API_KEY && !exampleEnv.VITE_FIREBASE_API_KEY.startsWith('MY_')) {
      for (const key of FIREBASE_ENV_KEYS) {
        if (!env[key] && key in exampleEnv) {
          define[`import.meta.env.${key}`] = JSON.stringify(exampleEnv[key]);
        }
      }
    }
  }

  return {
    base: './',
    plugins: [react()],
    define,
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
