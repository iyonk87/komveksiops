import React, { useEffect, useMemo, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import {
  Boxes,
  ClipboardCheck,
  Factory,
  Home,
  LogOut,
  Menu,
  Monitor,
  Moon,
  ShoppingBag,
  Sun,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { canAccessScreen, getAllowedScreens, getRoleLabel } from './services/auth/rbac';
import type { AppScreen } from './types/models';
import { LoadingCard } from './components/ui/StateViews';
import { LoginScreen } from './screens/LoginScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { MasterScreen } from './screens/MasterScreen';
import { InventoryScreen } from './screens/InventoryScreen';
import { OpnameScreen } from './screens/OpnameScreen';
import { WorkOrderScreen } from './screens/WorkOrderScreen';
import { WagesScreen } from './screens/WagesScreen';
import { SalesScreen } from './screens/SalesScreen';
import { CashScreen } from './screens/CashScreen';
import { PayablesReceivablesScreen } from './screens/PayablesReceivablesScreen';
import { ProfitLossScreen } from './screens/ProfitLossScreen';
import { ReconciliationScreen } from './screens/ReconciliationScreen';
import { PeriodCloseScreen } from './screens/PeriodCloseScreen';
import { IntegrityCheckScreen } from './screens/IntegrityCheckScreen';
import { UsersScreen } from './screens/UsersScreen';
import { ImportExportScreen } from './screens/ImportExportScreen';
import { AuditLogsScreen } from './screens/AuditLogsScreen';

type ThemePref = 'system' | 'light' | 'dark';
const THEME_STORAGE_KEY = 'konveksiops_theme';

function getStoredThemePref(): ThemePref {
  try {
    const val = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (val === 'light' || val === 'dark' || val === 'system') return val;
  } catch {
    // ignore storage access issues
  }
  return 'system';
}

function primaryIcon(id: AppScreen) {
  switch (id) {
    case 'dashboard':
      return <Home className="h-4 w-4" />;
    case 'inventory':
      return <Boxes className="h-4 w-4" />;
    case 'work_orders':
      return <Factory className="h-4 w-4" />;
    case 'sales':
      return <ShoppingBag className="h-4 w-4" />;
    default:
      return <ClipboardCheck className="h-4 w-4" />;
  }
}

const AuthenticatedShell: React.FC<{
  themePref: ThemePref;
  onCycleTheme: () => void;
}> = ({ themePref, onCycleTheme }) => {
  const { profile, loading, isOnline, logout } = useAuth();
  const [screen, setScreen] = useState<AppScreen>('dashboard');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const allowedScreens = useMemo(
    () => (profile ? getAllowedScreens(profile.role) : []),
    [profile],
  );

  const primaryTabs = useMemo(
    () => allowedScreens.filter((s) => s.primaryMobile),
    [allowedScreens],
  );

  useEffect(() => {
    if (profile && !canAccessScreen(profile.role, screen)) {
      setScreen('dashboard');
    }
  }, [profile, screen]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listenerPromise = CapacitorApp.addListener('backButton', () => {
      if (drawerOpen) {
        setDrawerOpen(false);
        return;
      }
      if (screen !== 'dashboard') {
        setScreen('dashboard');
        return;
      }
      void CapacitorApp.exitApp();
    });
    return () => {
      void listenerPromise.then((handle) => handle.remove());
    };
  }, [drawerOpen, screen]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
        <LoadingCard label="Memeriksa sesi dan profil pengguna..." />
      </div>
    );
  }

  if (!profile) {
    return <LoginScreen />;
  }

  const navigateTo = (next: AppScreen) => {
    if (canAccessScreen(profile.role, next)) {
      setScreen(next);
      setDrawerOpen(false);
    }
  };

  const renderThemeIcon = () => {
    if (themePref === 'dark') return <Moon className="h-4 w-4" />;
    if (themePref === 'light') return <Sun className="h-4 w-4" />;
    return <Monitor className="h-4 w-4" />;
  };

  const renderThemeLabel = () => {
    if (themePref === 'dark') return 'Gelap';
    if (themePref === 'light') return 'Terang';
    return 'Otomatis';
  };

  const renderScreen = () => {
    if (!canAccessScreen(profile.role, screen)) {
      return <DashboardScreen onNavigate={navigateTo} />;
    }
    switch (screen) {
      case 'dashboard':
        return <DashboardScreen onNavigate={navigateTo} />;
      case 'master':
        return <MasterScreen />;
      case 'inventory':
        return <InventoryScreen />;
      case 'opname':
        return <OpnameScreen />;
      case 'work_orders':
        return <WorkOrderScreen />;
      case 'wages':
        return <WagesScreen />;
      case 'sales':
        return <SalesScreen />;
      case 'cash':
        return <CashScreen />;
      case 'payables_receivables':
        return <PayablesReceivablesScreen />;
      case 'profit_loss':
        return <ProfitLossScreen />;
      case 'reconciliation':
        return <ReconciliationScreen />;
      case 'periods':
        return <PeriodCloseScreen />;
      case 'integrity':
        return <IntegrityCheckScreen />;
      case 'users':
        return <UsersScreen />;
      case 'import_export':
        return <ImportExportScreen />;
      case 'audit_logs':
        return <AuditLogsScreen />;
      default:
        return <DashboardScreen onNavigate={navigateTo} />;
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Top Safe-Area Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 pb-3 pt-safe backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              aria-label="Buka menu navigasi"
              onClick={() => setDrawerOpen(true)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 lg:hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-base font-bold leading-tight text-slate-900 dark:text-slate-100">KonveksiOps</h1>
              <p className="text-[11px] font-medium text-indigo-700 dark:text-indigo-400">
                {profile.nama} · {getRoleLabel(profile.role)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCycleTheme}
              title={`Tema tampilan: ${renderThemeLabel()} (ketuk untuk ganti)`}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {renderThemeIcon()}
              <span className="hidden sm:inline">{renderThemeLabel()}</span>
            </button>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                isOnline
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300'
                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
              }`}
            >
              {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {isOnline ? 'Online' : 'Offline'}
            </span>
            <button
              type="button"
              aria-label="Keluar"
              onClick={() => void logout()}
              className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-rose-950 dark:hover:text-rose-300"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Desktop Sidebar + Responsive Main Area */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-4 py-4 pb-24 lg:pb-8">
        <aside className="hidden w-64 shrink-0 lg:block">
          <nav className="sticky top-20 space-y-1 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Navigasi ({getRoleLabel(profile.role)})
            </p>
            {allowedScreens.map((item) => {
              const active = screen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={`flex min-h-[40px] w-full items-center rounded-xl px-3 text-left text-xs font-semibold transition ${
                    active
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">{renderScreen()}</main>
      </div>

      {/* Bottom Safe-Area Mobile Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-2 pt-1.5 pb-safe backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-4xl items-center justify-around">
          {primaryTabs.map((item) => {
            const active = screen === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                className={`flex min-h-[46px] min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-xl px-2.5 text-[11px] font-semibold transition ${
                  active
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {primaryIcon(item.id)}
                <span>{item.shortLabel}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex min-h-[46px] min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-xl px-2.5 text-[11px] font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <Menu className="h-4 w-4" />
            <span>Menu</span>
          </button>
        </div>
      </nav>

      {/* Mobile Navigation Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex bg-slate-900/60 lg:hidden">
          <div className="flex h-full w-80 max-w-[85vw] flex-col bg-white p-4 pt-safe pb-safe shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <p className="text-base font-bold text-slate-900 dark:text-slate-100">Menu KonveksiOps</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Hak Akses: <strong className="text-indigo-700 dark:text-indigo-400">{getRoleLabel(profile.role)}</strong>
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup menu"
                onClick={() => setDrawerOpen(false)}
                className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-lg border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-1 overflow-y-auto">
              {allowedScreens.map((item) => {
                const active = screen === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateTo(item.id)}
                    className={`flex min-h-[44px] w-full items-center justify-between rounded-xl px-3.5 text-left text-xs font-semibold transition ${
                      active
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={onCycleTheme}
                className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                {renderThemeIcon()} Tema: {renderThemeLabel()}
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-300"
              >
                <LogOut className="h-4 w-4" /> Keluar Akun
              </button>
            </div>
          </div>
          <div className="flex-1" onClick={() => setDrawerOpen(false)} />
        </div>
      )}
    </div>
  );
};

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { errorMessage: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { errorMessage: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { errorMessage: error.message || 'Terjadi kesalahan aplikasi.' };
  }

  render() {
    if (this.state.errorMessage) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
          <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-5 text-center shadow-sm dark:border-rose-900 dark:bg-slate-900">
            <h1 className="text-base font-bold text-rose-700 dark:text-rose-400">KonveksiOps Mengalami Gangguan</h1>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{this.state.errorMessage}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 min-h-[44px] rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white"
            >
              Muat Ulang Aplikasi
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [themePref, setThemePref] = useState<ThemePref>(() => getStoredThemePref());

  useEffect(() => {
    const applyTheme = () => {
      const prefersDark =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = themePref === 'dark' || (themePref === 'system' && prefersDark);
      document.documentElement.classList.toggle('dark', isDark);
    };

    applyTheme();
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themePref);
    } catch {
      // ignore storage failure
    }

    if (themePref === 'system' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme();
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    return undefined;
  }, [themePref]);

  const cycleTheme = () => {
    setThemePref((prev) => (prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'));
  };

  return (
    <AppErrorBoundary>
      <AuthProvider>
        <AuthenticatedShell themePref={themePref} onCycleTheme={cycleTheme} />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
