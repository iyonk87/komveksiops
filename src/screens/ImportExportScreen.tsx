import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Save,
  Upload,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchAllStockBalancesPaginated,
  fetchStockLedger,
} from '../services/firebase/inventoryRepo';
import {
  fetchAccounts,
  fetchBomItems,
  fetchMaterials,
  fetchProducts,
  importMaterialsChunk,
  importRecipeChunk,
} from '../services/firebase/masterRepo';
import { fetchWorkOrders } from '../services/firebase/productionRepo';
import {
  ensureDefaultMarketplaceChannels,
  fetchMarketplaceChannels,
  fetchMarketplaceMapping,
  fetchMarketplacePayouts,
  fetchPayments,
  fetchSalesOrders,
  fetchSalesReturns,
  importMarketplaceOrdersBatch,
  saveMarketplaceMapping,
} from '../services/firebase/salesRepo';
import {
  fetchAccountingSettings,
  fetchJournalEntries,
  fetchOperatingExpenses,
  fetchProductionCosts,
  fetchPurchaseCosts,
  fetchWagePayouts,
} from '../services/firebase/financeRepo';
import {
  calculateWeightedAverageCosts,
  computeBalanceSheet,
  computeCashFlowReport,
  computeProfitAndLoss,
  getMaterialUsageUnit,
} from '../services/domain/accounting';
import {
  downloadBalanceSheetCsv,
  downloadCashFlowCsv,
  downloadCsv,
  downloadImportErrorRowsCsv,
  downloadImportTemplate,
  downloadProfitLossCsv,
  parseSpreadsheetFile,
  validateMarketplaceImportRows,
  validateMaterialImportRows,
  validateRecipeImportRows,
  type MarketplaceImportColumnMap,
  type MaterialImportColumnMap,
  type ParsedCsvData,
  type RecipeImportColumnMap,
} from '../services/domain/csv';
import { exportTableToPdf } from '../services/domain/pdf';
import { normalizeFirestoreError } from '../services/firebase/common';
import type { BomItem, MarketplaceChannel, Material, Product, SalesOrder } from '../types/models';
import { currentPeriodJakarta, formatRupiah, formatUsageQty, todayJakarta } from '../utils/format';
import { ErrorBanner, OfflineWriteBlockedBanner } from '../components/ui/StateViews';

type ImportMode = 'marketplace' | 'materials' | 'resep';

function guessColumnIndex(headers: string[], keywords: string[], fallback = -1): number {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const kw of keywords) {
    const idx = lower.findIndex((h) => h.includes(kw));
    if (idx >= 0) return idx;
  }
  return fallback;
}

export const ImportExportScreen: React.FC = () => {
  const { profile, isOnline } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const [mode, setMode] = useState<ImportMode>('marketplace');
  const [parsedFile, setParsedFile] = useState<ParsedCsvData | null>(null);
  const [fileName, setFileName] = useState('');

  // Referensi master & order untuk validasi pratinjau
  const [channels, setChannels] = useState<MarketplaceChannel[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [bomItems, setBomItems] = useState<BomItem[]>([]);
  const [existingOrders, setExistingOrders] = useState<SalesOrder[]>([]);

  // Mapping Marketplace
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [mpMap, setMpMap] = useState<MarketplaceImportColumnMap>({
    tanggal: 0,
    noPesanan: 1,
    sku: 2,
    qty: 3,
    hargaJual: 4,
    biayaAdmin: -1,
    komisiAffiliate: -1,
    potonganLain: -1,
    catatan: -1,
  });

  // Mapping Bahan Baku
  const [matMap, setMatMap] = useState<MaterialImportColumnMap>({
    kode: 0,
    nama: 1,
    kategori: 2,
    satuanBeli: 3,
    satuanPakai: 4,
    konversi: 5,
    minStock: 6,
  });

  // Mapping Resep
  const [resepMap, setResepMap] = useState<RecipeImportColumnMap>({
    skuProduk: 0,
    jenisBaris: 1,
    kodeBahan: 2,
    qtyPerPcs: 3,
    satuanQty: 4,
    kategoriBiaya: 5,
    labelBiaya: 6,
    biayaPerPcs: 7,
  });

  const loadRefs = useCallback(async () => {
    try {
      const [chRes, matRes, prodRes, bomRes, soRes] = await Promise.all([
        fetchMarketplaceChannels(),
        fetchMaterials(300),
        fetchProducts(300),
        fetchBomItems(undefined, 500),
        fetchSalesOrders(300),
      ]);
      let activeCh = chRes.items;
      if (activeCh.length === 0 && profile && isOnline) {
        activeCh = await ensureDefaultMarketplaceChannels(profile.uid);
      }
      setChannels(activeCh);
      setMaterials(matRes.items);
      setProducts(prodRes.items);
      setBomItems(bomRes.items);
      setExistingOrders(soRes.items);
      setSelectedChannelId((prev) => prev || activeCh[0]?.id || '');
    } catch (err) {
      setError(normalizeFirestoreError(err));
    }
  }, [isOnline, profile]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  const applySavedMappingIfAvailable = useCallback(
    async (channelId: string, headers: string[]) => {
      try {
        const saved = await fetchMarketplaceMapping(channelId);
        if (saved?.mappingJson) {
          const parsed = JSON.parse(saved.mappingJson) as Partial<MarketplaceImportColumnMap>;
          const safeIdx = (v: unknown, fb: number) =>
            typeof v === 'number' && v >= -1 && v < headers.length ? v : fb;
          setMpMap({
            tanggal: safeIdx(parsed.tanggal, 0),
            noPesanan: safeIdx(parsed.noPesanan, Math.min(1, headers.length - 1)),
            sku: safeIdx(parsed.sku, Math.min(2, headers.length - 1)),
            qty: safeIdx(parsed.qty, Math.min(3, headers.length - 1)),
            hargaJual: safeIdx(parsed.hargaJual, Math.min(4, headers.length - 1)),
            biayaAdmin: safeIdx(parsed.biayaAdmin, -1),
            komisiAffiliate: safeIdx(parsed.komisiAffiliate, -1),
            potonganLain: safeIdx(parsed.potonganLain, -1),
            catatan: safeIdx(parsed.catatan, -1),
          });
          return;
        }
      } catch {
        // fallback ke auto-guess
      }
      setMpMap({
        tanggal: guessColumnIndex(headers, ['tanggal', 'tgl', 'date', 'waktu'], 0),
        noPesanan: guessColumnIndex(headers, ['no_pesanan', 'order', 'pesanan', 'resi', 'invoice'], Math.min(1, headers.length - 1)),
        sku: guessColumnIndex(headers, ['sku', 'kode_produk', 'seller sku'], Math.min(2, headers.length - 1)),
        qty: guessColumnIndex(headers, ['qty', 'jumlah', 'quantity'], Math.min(3, headers.length - 1)),
        hargaJual: guessColumnIndex(headers, ['harga', 'total', 'subtotal', 'price'], Math.min(4, headers.length - 1)),
        biayaAdmin: guessColumnIndex(headers, ['admin', 'biaya layanan', 'fee'], -1),
        komisiAffiliate: guessColumnIndex(headers, ['affiliate', 'komisi', 'ams'], -1),
        potonganLain: guessColumnIndex(headers, ['potongan', 'diskon', 'voucher'], -1),
        catatan: guessColumnIndex(headers, ['catatan', 'note', 'keterangan'], -1),
      });
    },
    [],
  );

  useEffect(() => {
    if (mode === 'marketplace' && parsedFile && selectedChannelId) {
      void applySavedMappingIfAvailable(selectedChannelId, parsedFile.headers);
    }
  }, [applySavedMappingIfAvailable, mode, parsedFile, selectedChannelId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setMsg(null);
    setProgress(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseSpreadsheetFile(file);
      setParsedFile(parsed);
      setFileName(file.name);
      const h = parsed.headers;
      if (mode === 'materials') {
        setMatMap({
          kode: guessColumnIndex(h, ['kode', 'code'], 0),
          nama: guessColumnIndex(h, ['nama', 'name'], Math.min(1, h.length - 1)),
          kategori: guessColumnIndex(h, ['kategori', 'category'], -1),
          satuanBeli: guessColumnIndex(h, ['satuan_beli', 'beli'], -1),
          satuanPakai: guessColumnIndex(h, ['satuan_pakai', 'pakai'], -1),
          konversi: guessColumnIndex(h, ['konversi', 'isi'], -1),
          minStock: guessColumnIndex(h, ['min', 'minimum'], -1),
        });
      } else if (mode === 'resep') {
        setResepMap({
          skuProduk: guessColumnIndex(h, ['sku_produk', 'sku', 'produk'], 0),
          jenisBaris: guessColumnIndex(h, ['jenis', 'tipe'], -1),
          kodeBahan: guessColumnIndex(h, ['kode_bahan', 'bahan'], Math.min(2, h.length - 1)),
          qtyPerPcs: guessColumnIndex(h, ['qty_per_pcs', 'qty', 'jumlah'], Math.min(3, h.length - 1)),
          satuanQty: guessColumnIndex(h, ['satuan_qty', 'satuan', 'unit'], -1),
          kategoriBiaya: guessColumnIndex(h, ['kategori_biaya', 'kategori'], -1),
          labelBiaya: guessColumnIndex(h, ['label_biaya', 'label'], -1),
          biayaPerPcs: guessColumnIndex(h, ['biaya_per_pcs', 'biaya', 'upah'], -1),
        });
      } else if (selectedChannelId) {
        await applySavedMappingIfAvailable(selectedChannelId, h);
      }
    } catch (err) {
      setError(normalizeFirestoreError(err));
    }
  };

  const selectedChannel = channels.find((c) => c.id === selectedChannelId);

  const preview = useMemo(() => {
    if (!parsedFile) return null;
    if (mode === 'materials') {
      const res = validateMaterialImportRows({
        rows: parsedFile.rows,
        map: matMap,
        existingMaterials: materials,
      });
      return {
        kind: 'materials' as const,
        validCount: res.validRows.length,
        duplicateCount: 0,
        errorCount: res.errorRows.length,
        warnings: res.warningsSummary,
        errorRows: res.errorRows,
        validRows: res.validRows,
      };
    }
    if (mode === 'resep') {
      const res = validateRecipeImportRows({
        rows: parsedFile.rows,
        map: resepMap,
        products,
        materials,
      });
      return {
        kind: 'resep' as const,
        validCount: res.validRows.length,
        duplicateCount: 0,
        errorCount: res.errorRows.length,
        warnings: res.warningsSummary,
        errorRows: res.errorRows,
        validRows: res.validRows,
      };
    }

    const existingImportKeys = new Set(
      existingOrders.map((o) => o.importKey).filter((k): k is string => Boolean(k)),
    );
    const existingOrderNumbers = new Set(
      existingOrders
        .map((o) => (o.noPesanan || o.soNumber || '').trim().toUpperCase())
        .filter(Boolean),
    );
    const res = validateMarketplaceImportRows({
      channelName: selectedChannel?.nama ?? 'Marketplace',
      rows: parsedFile.rows,
      map: mpMap,
      products,
      existingImportKeys,
      existingOrderNumbers,
    });
    return {
      kind: 'marketplace' as const,
      validCount: res.validRows.length,
      duplicateCount: res.skippedDuplicateRows.length,
      errorCount: res.errorRows.length,
      warnings: res.warningsSummary,
      errorRows: res.errorRows,
      validRows: res.validRows,
    };
  }, [existingOrders, matMap, materials, mode, mpMap, parsedFile, products, resepMap, selectedChannel]);

  const handleSaveMarketplaceMapping = async () => {
    if (!profile || !selectedChannel) return;
    setError(null);
    setMsg(null);
    try {
      await saveMarketplaceMapping({
        actorUid: profile.uid,
        channelId: selectedChannel.id,
        channelName: selectedChannel.nama,
        mappingJson: JSON.stringify(mpMap),
      });
      setMsg(`Pemetaan kolom untuk ${selectedChannel.nama} berhasil disimpan.`);
    } catch (err) {
      setError(normalizeFirestoreError(err));
    }
  };

  const handleExecuteImport = async () => {
    if (!profile || !preview || preview.validCount === 0) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    setProgress({ done: 0, total: preview.validCount });
    try {
      if (preview.kind === 'materials') {
        const existingByKode = new Map<string, Material>();
        materials.forEach((m) => existingByKode.set(m.kode.trim().toUpperCase(), m));
        let created = 0;
        let updated = 0;
        for (let i = 0; i < preview.validRows.length; i += 8) {
          const chunk = preview.validRows.slice(i, i + 8);
          const res = await importMaterialsChunk({
            actorUid: profile.uid,
            rows: chunk,
            existingByKode,
          });
          created += res.created;
          updated += res.updated;
          setProgress({
            done: Math.min(preview.validRows.length, i + chunk.length),
            total: preview.validRows.length,
          });
        }
        setMsg(`Impor Bahan Baku selesai: ${created} baru, ${updated} diperbarui.`);
      } else if (preview.kind === 'resep') {
        let created = 0;
        let updated = 0;
        for (let i = 0; i < preview.validRows.length; i += 8) {
          const chunk = preview.validRows.slice(i, i + 8);
          const res = await importRecipeChunk({
            actorUid: profile.uid,
            rows: chunk,
            existingItems: bomItems,
          });
          created += res.created;
          updated += res.updated;
          setProgress({
            done: Math.min(preview.validRows.length, i + chunk.length),
            total: preview.validRows.length,
          });
        }
        setMsg(`Impor Resep selesai: ${created} baris baru, ${updated} baris diperbarui.`);
      } else {
        if (!selectedChannel) {
          throw new Error('Pilih channel marketplace terlebih dahulu.');
        }
        const res = await importMarketplaceOrdersBatch({
          actorUid: profile.uid,
          actorName: profile.nama,
          actorRole: profile.role,
          channelId: selectedChannel.id,
          channelName: selectedChannel.nama,
          rows: preview.validRows,
          onProgress: (done, total) => setProgress({ done, total }),
        });
        setMsg(
          `Impor Marketplace (${selectedChannel.nama}) selesai: ${res.imported} pesanan dibuat, ${res.skipped} duplikat/sudah ada dilewati.`,
        );
      }
      await loadRefs();
    } catch (err) {
      setError(
        `${normalizeFirestoreError(err)} — Anda bisa klik "Jalankan Impor" lagi untuk melanjutkan baris tersisa secara idempoten.`,
      );
    } finally {
      setBusy(false);
    }
  };

  // --- Ekspor Data CSV & PDF ---
  const exportStockCsv = async () => {
    setBusy(true);
    setError(null);
    try {
      const [balRes, matRes, prodRes] = await Promise.all([
        fetchAllStockBalancesPaginated(),
        fetchMaterials(300),
        fetchProducts(300),
      ]);
      const matMapLocal = new Map<string, Material>();
      matRes.items.forEach((m) => matMapLocal.set(m.id, m));
      const prodMapLocal = new Map<string, Product>();
      prodRes.items.forEach((p) => prodMapLocal.set(p.id, p));

      downloadCsv(
        `stok-konveksiops-${todayJakarta()}.csv`,
        ['ItemID', 'Nama Item', 'Jenis', 'Saldo Angka', 'Tampilan Satuan', 'Status'],
        balRes.items.map((b) => {
          const mat = matMapLocal.get(b.itemId);
          const prod = prodMapLocal.get(b.itemId);
          const label = mat
            ? `[Bahan] ${mat.nama}`
            : prod
              ? `[SKU] ${prod.sku} - ${prod.nama}`
              : b.itemId;
          const display = mat
            ? formatUsageQty(b.qty, getMaterialUsageUnit(mat))
            : `${b.qty} pcs`;
          return [
            b.itemId,
            label,
            b.itemType,
            b.qty,
            display,
            b.qty < 0 ? 'Perlu Opname' : 'Normal',
          ];
        }),
      );
      setMsg('Ekspor CSV saldo stok selesai.');
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setBusy(false);
    }
  };

  const exportFinancialCsv = async (kind: 'pnl' | 'cashflow' | 'balance_sheet') => {
    setBusy(true);
    setError(null);
    try {
      const [
        accRes,
        chRes,
        mpRes,
        ledRes,
        pcRes,
        prRes,
        woRes,
        bomRes,
        soRes,
        payRes,
        retRes,
        expRes,
        wageRes,
        jRes,
        prodRes,
        settings,
      ] = await Promise.all([
        fetchAccounts(50),
        fetchMarketplaceChannels(),
        fetchMarketplacePayouts(300),
        fetchStockLedger({ pageSize: 500 }),
        fetchPurchaseCosts(500),
        fetchProductionCosts(500),
        fetchWorkOrders(300),
        fetchBomItems(undefined, 500),
        fetchSalesOrders(500),
        fetchPayments(undefined, 500),
        fetchSalesReturns(300),
        fetchOperatingExpenses(300),
        fetchWagePayouts(300),
        fetchJournalEntries(500),
        fetchProducts(300),
        fetchAccountingSettings(),
      ]);

      const weighted = calculateWeightedAverageCosts({
        ledgerEntries: ledRes.items,
        purchaseCosts: pcRes.items,
        productionCosts: prRes.items,
        workOrders: woRes.items,
        bomItems: bomRes.items,
        wagePayouts: wageRes.items,
        products: prodRes.items,
      });

      const pnl = computeProfitAndLoss({
        salesOrders: soRes.items,
        returns: retRes.items,
        operatingExpenses: expRes.items,
        hppTotal: weighted.cogsTotal,
        rejectExpenseTotal: weighted.rejectExpenseTotal,
        wagePayouts: wageRes.items,
        opnameAdjustmentTotal: weighted.opnameAdjustmentTotal,
      });

      const periodLabel = currentPeriodJakarta();
      if (kind === 'pnl') {
        downloadProfitLossCsv(`kumulatif-${periodLabel}`, pnl);
        setMsg('Ekspor CSV Laba Rugi selesai.');
      } else if (kind === 'cashflow') {
        const cf = computeCashFlowReport({
          accounts: accRes.items,
          marketplacePayouts: mpRes.items,
          payments: payRes.items,
          purchaseCosts: pcRes.items,
          productionCosts: prRes.items,
          wagePayouts: wageRes.items,
          operatingExpenses: expRes.items,
          journalEntries: jRes.items,
        });
        downloadCashFlowCsv(`kumulatif-${periodLabel}`, cf);
        setMsg('Ekspor CSV Arus Kas selesai.');
      } else {
        const bs = computeBalanceSheet({
          accounts: accRes.items,
          marketplaceChannels: chRes.items,
          salesOrders: soRes.items,
          returns: retRes.items,
          marketplacePayouts: mpRes.items,
          purchaseCosts: pcRes.items,
          productionCosts: prRes.items,
          journalEntries: jRes.items,
          costs: weighted,
          profitLoss: pnl,
          modalAwal: settings?.modalAwal ?? null,
        });
        downloadBalanceSheetCsv(bs);
        setMsg('Ekspor CSV Neraca Keuangan selesai.');
      }
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setBusy(false);
    }
  };

  const exportLedgerPdf = async () => {
    setBusy(true);
    setError(null);
    try {
      const ledRes = await fetchStockLedger({ pageSize: 100 });
      await exportTableToPdf({
        filename: `kartu-stok-${todayJakarta()}.pdf`,
        title: 'Kartu Stok (100 Entri Terbaru)',
        headers: ['Tanggal', 'Item ID', 'Jenis', 'Qty', 'Sebelum', 'Sesudah'],
        rows: ledRes.items.map((l) => [
          l.tanggal,
          l.itemId,
          l.jenis,
          l.qty,
          l.balance_before,
          l.balance_after,
        ]),
      });
      setMsg('Ekspor PDF kartu stok selesai.');
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setBusy(false);
    }
  };

  const exportWoPdf = async () => {
    setBusy(true);
    setError(null);
    try {
      const woRes = await fetchWorkOrders(100);
      await exportTableToPdf({
        filename: `work-orders-${todayJakarta()}.pdf`,
        title: 'Laporan Work Order Produksi',
        headers: ['No WO', 'Tanggal', 'Target', 'WIP', 'Jadi', 'Reject', 'Tahap', 'Status'],
        rows: woRes.items.map((w) => [
          w.woNumber,
          w.tanggal,
          w.targetQty,
          w.wipQty,
          w.completedQty,
          w.rejectedQty ?? 0,
          w.currentStage,
          w.status,
        ]),
      });
      setMsg('Ekspor PDF Work Order selesai.');
    } catch (err) {
      setError(normalizeFirestoreError(err));
    } finally {
      setBusy(false);
    }
  };

  const renderColSelect = (
    label: string,
    value: number,
    onChange: (idx: number) => void,
    optional = false,
  ) => (
    <label key={label} className="block">
      <span className="mb-1 block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2 text-xs"
      >
        {optional && <option value={-1}>-- Abaikan / Tidak Ada --</option>}
        {parsedFile?.headers.map((h, idx) => (
          <option key={idx} value={idx}>
            Kolom {idx + 1}: {h}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Impor Data (CSV / XLSX) &amp; Ekspor Laporan
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Mendukung file Excel (.xlsx) dan CSV pemisah koma (,) atau titik koma (;) secara otomatis dengan pemetaan kolom &amp; pratinjau.
        </p>
      </div>

      <OfflineWriteBlockedBanner isOnline={isOnline} />
      {msg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
          {msg}
        </div>
      )}
      {error && <ErrorBanner message={error} />}

      {/* Ekspor Laporan CSV & PDF */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
          Ekspor Laporan Keuangan &amp; Operasional
        </h3>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportStockCsv()}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <Download className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Ekspor Stok (CSV)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportFinancialCsv('pnl')}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <Download className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Ekspor Laba Rugi (CSV)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportFinancialCsv('cashflow')}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <Download className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Ekspor Arus Kas (CSV)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportFinancialCsv('balance_sheet')}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <Download className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Ekspor Neraca (CSV)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportLedgerPdf()}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <FileText className="h-4 w-4 text-rose-600 dark:text-rose-400" /> Kartu Stok (PDF)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportWoPdf()}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <FileText className="h-4 w-4 text-rose-600 dark:text-rose-400" /> Work Order (PDF)
          </button>
        </div>
      </section>

      {/* Bagian Impor Data */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
            <Upload className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            Impor Data Bertahap &amp; Idempoten
          </h3>
          <button
            type="button"
            onClick={() => downloadImportTemplate(mode)}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-indigo-300 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Unduh Template Kosong (Header Saja)
          </button>
        </div>

        {/* Mode Tab */}
        <div className="flex flex-wrap gap-1.5">
          {[
            ['marketplace', 'Penjualan Marketplace'],
            ['materials', 'Master Bahan Baku'],
            ['resep', 'Resep per SKU'],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setMode(k as ImportMode);
                setParsedFile(null);
                setFileName('');
                setProgress(null);
              }}
              className={`min-h-[40px] rounded-lg px-3.5 text-xs font-semibold transition ${
                mode === k
                  ? 'bg-indigo-600 text-white'
                  : 'border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'marketplace' && (
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Pilih Channel Marketplace
              </label>
              <select
                value={selectedChannelId}
                onChange={(e) => setSelectedChannelId(e.target.value)}
                className="min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-xs"
              >
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.nama}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              {parsedFile && (
                <button
                  type="button"
                  disabled={!isOnline || !selectedChannel}
                  onClick={() => void handleSaveMarketplaceMapping()}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                >
                  <Save className="h-3.5 w-3.5" /> Simpan Pemetaan Kolom ({selectedChannel?.nama})
                </button>
              )}
            </div>
          </div>
        )}

        <div>
          <input
            type="file"
            accept=".csv,.xlsx,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => void handleFileUpload(e)}
            className="block w-full text-xs text-slate-600 file:mr-3 file:min-h-[40px] file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:text-xs file:font-semibold file:text-indigo-700 dark:text-slate-300 dark:file:bg-indigo-950/70 dark:file:text-indigo-200"
          />
          {parsedFile && (
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              File: <strong>{fileName}</strong> · Format: <strong>{parsedFile.delimiter === 'xlsx' ? 'Excel XLSX' : `CSV (${parsedFile.delimiter})`}</strong> · Total baris data: <strong>{parsedFile.rows.length}</strong>
            </p>
          )}
        </div>

        {/* Pemetaan Kolom */}
        {parsedFile && (
          <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-900/70 dark:bg-indigo-950/30">
            <p className="text-xs font-bold text-indigo-950 dark:text-indigo-200">
              Pemetaan Kolom (Kolom yang tidak dipakai dapat diset ke &ldquo;Abaikan&rdquo;)
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {mode === 'marketplace' && (
                <>
                  {renderColSelect('Tanggal Order', mpMap.tanggal, (v) => setMpMap((m) => ({ ...m, tanggal: v })))}
                  {renderColSelect('No. Pesanan', mpMap.noPesanan, (v) => setMpMap((m) => ({ ...m, noPesanan: v })))}
                  {renderColSelect('SKU Produk', mpMap.sku, (v) => setMpMap((m) => ({ ...m, sku: v })))}
                  {renderColSelect('Qty (pcs)', mpMap.qty, (v) => setMpMap((m) => ({ ...m, qty: v })))}
                  {renderColSelect('Total Harga Jual (Rp)', mpMap.hargaJual, (v) => setMpMap((m) => ({ ...m, hargaJual: v })))}
                  {renderColSelect('Biaya Admin', mpMap.biayaAdmin, (v) => setMpMap((m) => ({ ...m, biayaAdmin: v })), true)}
                  {renderColSelect('Komisi Affiliate', mpMap.komisiAffiliate, (v) => setMpMap((m) => ({ ...m, komisiAffiliate: v })), true)}
                  {renderColSelect('Potongan Lain', mpMap.potonganLain, (v) => setMpMap((m) => ({ ...m, potonganLain: v })), true)}
                  {renderColSelect('Catatan', mpMap.catatan, (v) => setMpMap((m) => ({ ...m, catatan: v })), true)}
                </>
              )}

              {mode === 'materials' && (
                <>
                  {renderColSelect('Kode Bahan', matMap.kode, (v) => setMatMap((m) => ({ ...m, kode: v })))}
                  {renderColSelect('Nama Bahan', matMap.nama, (v) => setMatMap((m) => ({ ...m, nama: v })))}
                  {renderColSelect('Kategori', matMap.kategori, (v) => setMatMap((m) => ({ ...m, kategori: v })), true)}
                  {renderColSelect('Satuan Beli', matMap.satuanBeli, (v) => setMatMap((m) => ({ ...m, satuanBeli: v })), true)}
                  {renderColSelect('Satuan Pakai (cm/pcs)', matMap.satuanPakai, (v) => setMatMap((m) => ({ ...m, satuanPakai: v })), true)}
                  {renderColSelect('Konversi (opsional)', matMap.konversi, (v) => setMatMap((m) => ({ ...m, konversi: v })), true)}
                  {renderColSelect('Stok Minimum', matMap.minStock, (v) => setMatMap((m) => ({ ...m, minStock: v })), true)}
                </>
              )}

              {mode === 'resep' && (
                <>
                  {renderColSelect('SKU Produk', resepMap.skuProduk, (v) => setResepMap((m) => ({ ...m, skuProduk: v })))}
                  {renderColSelect('Jenis Baris (material/cost)', resepMap.jenisBaris, (v) => setResepMap((m) => ({ ...m, jenisBaris: v })), true)}
                  {renderColSelect('Kode Bahan', resepMap.kodeBahan, (v) => setResepMap((m) => ({ ...m, kodeBahan: v })), true)}
                  {renderColSelect('Qty Pemakaian per Pcs', resepMap.qtyPerPcs, (v) => setResepMap((m) => ({ ...m, qtyPerPcs: v })), true)}
                  {renderColSelect('Satuan Qty (cm/m/pcs)', resepMap.satuanQty, (v) => setResepMap((m) => ({ ...m, satuanQty: v })), true)}
                  {renderColSelect('Kategori Biaya', resepMap.kategoriBiaya, (v) => setResepMap((m) => ({ ...m, kategoriBiaya: v })), true)}
                  {renderColSelect('Label Biaya', resepMap.labelBiaya, (v) => setResepMap((m) => ({ ...m, labelBiaya: v })), true)}
                  {renderColSelect('Biaya per Pcs (Rp)', resepMap.biayaPerPcs, (v) => setResepMap((m) => ({ ...m, biayaPerPcs: v })), true)}
                </>
              )}
            </div>
          </div>
        )}

        {/* Pratinjau & Validasi */}
        {preview && parsedFile && (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/60">
            <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
              <div className="rounded-lg bg-emerald-100/80 p-2 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200">
                <p className="text-[11px]">Siap Diimpor</p>
                <p className="text-base font-bold">{preview.validCount}</p>
              </div>
              <div className="rounded-lg bg-amber-100/80 p-2 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200">
                <p className="text-[11px]">Duplikat Dilewati</p>
                <p className="text-base font-bold">{preview.duplicateCount}</p>
              </div>
              <div className="rounded-lg bg-rose-100/80 p-2 text-rose-900 dark:bg-rose-950/70 dark:text-rose-200">
                <p className="text-[11px]">Ditolak / Error</p>
                <p className="text-base font-bold">{preview.errorCount}</p>
              </div>
            </div>

            {preview.warnings.length > 0 && (
              <div className="max-h-36 overflow-y-auto rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                <p className="mb-1 flex items-center gap-1 font-bold">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Peringatan ({preview.warnings.length}):
                </p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {preview.warnings.slice(0, 30).map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {preview.errorRows.length > 0 && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-[11px] text-rose-900 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    {preview.errorRows.length} baris gagal validasi tidak akan diimpor.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      downloadImportErrorRowsCsv(
                        `baris-gagal-${mode}-${todayJakarta()}.csv`,
                        parsedFile.headers,
                        preview.errorRows,
                      )
                    }
                    className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-rose-400 bg-white px-2.5 font-semibold text-rose-800 hover:bg-rose-100 dark:border-rose-700 dark:bg-slate-900 dark:text-rose-200"
                  >
                    <Download className="h-3.5 w-3.5" /> Unduh Baris Gagal (CSV)
                  </button>
                </div>
                <ul className="mt-1.5 max-h-28 list-disc overflow-y-auto pl-4">
                  {preview.errorRows.slice(0, 15).map((err) => (
                    <li key={err.rowNumber}>
                      Baris {err.rowNumber}: {err.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.kind === 'marketplace' && preview.validRows.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] text-slate-600 tabular-nums dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                Pratinjau baris valid #1: <strong>{preview.validRows[0].noPesanan}</strong> · SKU{' '}
                <strong>{preview.validRows[0].sku}</strong> · {preview.validRows[0].qty} pcs · Kotor{' '}
                {formatRupiah(preview.validRows[0].hargaJual)} → Bersih{' '}
                <strong className="text-indigo-700 dark:text-indigo-300">
                  {formatRupiah(preview.validRows[0].penerimaanBersih)}
                </strong>
              </div>
            )}

            {progress && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-indigo-700 tabular-nums dark:text-indigo-300">
                  <span>Progres Impor</span>
                  <span>
                    {progress.done} / {progress.total}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full bg-indigo-600 transition-all"
                    style={{
                      width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={!isOnline || busy || preview.validCount === 0}
              onClick={() => void handleExecuteImport()}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {busy
                ? `Memproses Impor (${progress?.done ?? 0}/${progress?.total ?? preview.validCount})...`
                : `Jalankan Impor (${preview.validCount} baris valid)`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
