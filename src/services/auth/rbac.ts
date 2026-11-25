import type { AppScreen, UserRole } from '../../types/models';

export interface NavItemConfig {
  id: AppScreen;
  label: string;
  shortLabel: string;
  roles: UserRole[];
  primaryMobile?: boolean;
}

// Peran hanya 'owner' dan 'admin'. Customer/Piutang disembunyikan sesuai model bisnis marketplace.
// Seluruh layar bisa diakses Owner & Admin kecuali Kelola User (Owner-only).
export const APP_SCREENS: NavItemConfig[] = [
  { id: 'dashboard', label: 'Dashboard', shortLabel: 'Beranda', roles: ['owner', 'admin'], primaryMobile: true },
  { id: 'inventory', label: 'Persediaan & Kartu Stok', shortLabel: 'Stok', roles: ['owner', 'admin'], primaryMobile: true },
  { id: 'work_orders', label: 'Produksi Bertahap (WO)', shortLabel: 'Produksi', roles: ['owner', 'admin'], primaryMobile: true },
  { id: 'sales', label: 'Penjualan Marketplace', shortLabel: 'Jual', roles: ['owner', 'admin'], primaryMobile: true },
  { id: 'wages', label: 'Upah Mingguan', shortLabel: 'Upah', roles: ['owner', 'admin'] },
  { id: 'opname', label: 'Stock Opname', shortLabel: 'Opname', roles: ['owner', 'admin'] },
  { id: 'master', label: 'Master Data & Resep', shortLabel: 'Master', roles: ['owner', 'admin'] },
  { id: 'cash', label: 'Arus Kas & Biaya', shortLabel: 'Kas', roles: ['owner', 'admin'] },
  { id: 'profit_loss', label: 'Laporan Keuangan & Neraca', shortLabel: 'Laporan', roles: ['owner', 'admin'] },
  { id: 'reconciliation', label: 'Rekonsiliasi Bank', shortLabel: 'Rekon', roles: ['owner', 'admin'] },
  { id: 'periods', label: 'Tutup Periode', shortLabel: 'Periode', roles: ['owner', 'admin'] },
  { id: 'integrity', label: 'Cek Integritas', shortLabel: 'Integritas', roles: ['owner', 'admin'] },
  { id: 'import_export', label: 'Impor & Ekspor Data', shortLabel: 'Impor/Ekspor', roles: ['owner', 'admin'] },
  { id: 'audit_logs', label: 'Audit Log', shortLabel: 'Audit', roles: ['owner', 'admin'] },
  { id: 'users', label: 'Kelola User', shortLabel: 'User', roles: ['owner'] },
];

export function canAccessScreen(role: UserRole, screen: AppScreen): boolean {
  const cfg = APP_SCREENS.find((item) => item.id === screen);
  return cfg ? cfg.roles.includes(role) : false;
}

export function getAllowedScreens(role: UserRole): NavItemConfig[] {
  return APP_SCREENS.filter((item) => item.roles.includes(role));
}

export function getRoleLabel(role: UserRole): string {
  if (role === 'owner') return 'Owner';
  return 'Admin';
}
