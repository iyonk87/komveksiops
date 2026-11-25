import type {
  Material,
  MaterialCategory,
  MaterialPurchaseUnit,
  MaterialUsageUnit,
  Product,
} from '../../types/models';
import {
  formatRupiah,
  isValidDateStr,
  parseLengthToCm,
  parseLocaleNumber,
} from '../../utils/format';
import type { BalanceSheetReport, CashFlowReport, ProfitLossReport } from './accounting';

const FORMULA_PREFIX_REGEX = /^[=+\-@\t\r]/;
export const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_XLSX_BYTES = 5 * 1024 * 1024; // 5 MB

export function neutralizeCsvCell(value: string | number | boolean | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = FORMULA_PREFIX_REGEX.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r;]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function buildSafeCsvString(
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>,
): string {
  const lines: string[] = [];
  lines.push(headers.map((h) => neutralizeCsvCell(h)).join(','));
  for (const row of rows) {
    lines.push(row.map((cell) => neutralizeCsvCell(cell)).join(','));
  }
  return lines.join('\r\n');
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>,
): void {
  const csv = buildSafeCsvString(headers, rows);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface ParsedCsvData {
  headers: string[];
  rows: string[][];
  delimiter: ',' | ';' | 'xlsx';
}

export function detectCsvDelimiter(headerLine: string): ',' | ';' {
  let inQuotes = false;
  let commaCount = 0;
  let semicolonCount = 0;
  for (let i = 0; i < headerLine.length; i += 1) {
    const ch = headerLine[i];
    if (ch === '"') {
      if (inQuotes && headerLine[i + 1] === '"') {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes) {
      if (ch === ',') commaCount += 1;
      if (ch === ';') semicolonCount += 1;
    }
  }
  return semicolonCount > commaCount ? ';' : ',';
}

export function parseCsvText(text: string, byteSize = text.length): ParsedCsvData {
  if (byteSize > MAX_CSV_BYTES) {
    throw new Error('Ukuran file CSV melebihi batas maksimal 2 MB.');
  }

  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstNonEmptyLine = normalized.split('\n').find((line) => line.trim() !== '') ?? '';
  const delimiter = detectCsvDelimiter(firstNonEmptyLine);

  const parsedRows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"' && normalized[i + 1] === '"') {
        currentCell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if (ch === '\n') {
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell !== '')) {
        parsedRows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell !== '')) {
      parsedRows.push(currentRow);
    }
  }

  if (parsedRows.length === 0) {
    throw new Error('File CSV kosong.');
  }

  const [headers, ...rows] = parsedRows;
  return { headers, rows, delimiter };
}

function formatXlsxCell(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) {
    const y = cell.getFullYear();
    const m = String(cell.getMonth() + 1).padStart(2, '0');
    const d = String(cell.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(cell).trim();
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedCsvData> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx')) {
    if (file.size > MAX_XLSX_BYTES) {
      throw new Error('Ukuran file Excel (.xlsx) melebihi batas maksimal 5 MB.');
    }
    const { readSheet } = await import('read-excel-file/browser');
    const rawRows = await readSheet(file);
    const cleaned = rawRows
      .map((row) => row.map((cell) => formatXlsxCell(cell)))
      .filter((row) => row.some((c) => c !== ''));
    if (cleaned.length === 0) {
      throw new Error('Sheet Excel kosong.');
    }
    const [headers, ...rows] = cleaned;
    return { headers, rows, delimiter: 'xlsx' };
  }

  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = await file.text();
    return parseCsvText(text, file.size);
  }

  throw new Error('Format file harus .csv atau .xlsx.');
}

// --- Template Header-Only (TANPA baris contoh/dummy) ---
export type ImportTemplateKind = 'materials' | 'resep' | 'marketplace';

export function downloadImportTemplate(kind: ImportTemplateKind): void {
  if (kind === 'materials') {
    downloadCsv(
      'template_impor_bahan_baku.csv',
      ['kode', 'nama', 'kategori', 'satuan_beli', 'satuan_pakai', 'konversi', 'min_stok'],
      [],
    );
    return;
  }
  if (kind === 'resep') {
    downloadCsv(
      'template_impor_resep.csv',
      ['sku_produk', 'jenis_baris', 'kode_bahan', 'qty_per_pcs', 'satuan_qty', 'kategori_biaya', 'label_biaya', 'biaya_per_pcs'],
      [],
    );
    return;
  }
  downloadCsv(
    'template_impor_penjualan_marketplace.csv',
    ['tanggal', 'no_pesanan', 'sku', 'qty', 'harga_jual', 'biaya_admin', 'komisi_affiliate', 'potongan_lain', 'catatan'],
    [],
  );
}

// --- Validasi & Pratinjau Impor Bahan Baku ---
export interface MaterialImportColumnMap {
  kode: number;
  nama: number;
  kategori: number;
  satuanBeli: number;
  satuanPakai: number;
  konversi: number;
  minStock: number;
}

export interface ValidatedMaterialImportRow {
  rowNumber: number;
  kode: string;
  nama: string;
  kategori: MaterialCategory;
  satuanBeli: MaterialPurchaseUnit;
  satuanPakai: MaterialUsageUnit;
  konversi: number | null;
  minStock: number;
  warnings: string[];
}

export interface ImportErrorRow {
  rowNumber: number;
  reason: string;
  rawRow: string[];
}

const VALID_CATEGORIES = new Set<MaterialCategory>([
  'kain',
  'benang',
  'kancing',
  'resleting',
  'hangtag',
  'kemasan',
  'lainnya',
]);

const VALID_PURCHASE_UNITS = new Set<MaterialPurchaseUnit>([
  'roll',
  'pak',
  'bungkus',
  'meter',
  'kg',
  'lusin',
]);

export function validateMaterialImportRows(params: {
  rows: string[][];
  map: MaterialImportColumnMap;
  existingMaterials: Material[];
}): {
  validRows: ValidatedMaterialImportRow[];
  errorRows: ImportErrorRow[];
  warningsSummary: string[];
} {
  const { rows, map, existingMaterials } = params;
  const existingByKode = new Set(existingMaterials.map((m) => m.kode.trim().toUpperCase()));
  const seenInFile = new Set<string>();

  const validRows: ValidatedMaterialImportRow[] = [];
  const errorRows: ImportErrorRow[] = [];
  const warningsSummary: string[] = [];

  rows.forEach((rawRow, idx) => {
    const rowNumber = idx + 2;
    const kode = (map.kode >= 0 ? rawRow[map.kode] : '')?.trim() ?? '';
    const nama = (map.nama >= 0 ? rawRow[map.nama] : '')?.trim() ?? '';
    const katRaw = ((map.kategori >= 0 ? rawRow[map.kategori] : '')?.trim().toLowerCase() || 'lainnya') as MaterialCategory;
    const beliRaw = ((map.satuanBeli >= 0 ? rawRow[map.satuanBeli] : '')?.trim().toLowerCase() || 'roll') as MaterialPurchaseUnit;
    const pakaiRaw = ((map.satuanPakai >= 0 ? rawRow[map.satuanPakai] : '')?.trim().toLowerCase() || 'pcs') as MaterialUsageUnit;
    const konvRaw = (map.konversi >= 0 ? rawRow[map.konversi] : '')?.trim() ?? '';
    const minRaw = (map.minStock >= 0 ? rawRow[map.minStock] : '')?.trim() ?? '';

    if (!kode || !nama) {
      errorRows.push({ rowNumber, reason: 'Kode dan nama bahan wajib diisi.', rawRow });
      return;
    }

    const normKode = kode.toUpperCase();
    const warnings: string[] = [];
    if (seenInFile.has(normKode)) {
      warnings.push(`Kode "${kode}" duplikat di file (baris ini akan memperbarui baris sebelumnya).`);
    }
    seenInFile.add(normKode);
    if (existingByKode.has(normKode)) {
      warnings.push(`Kode "${kode}" sudah ada di Master (mode idempoten akan memperbarui data).`);
    }

    const kategori: MaterialCategory = VALID_CATEGORIES.has(katRaw) ? katRaw : 'lainnya';
    if (!VALID_CATEGORIES.has(katRaw) && map.kategori >= 0 && rawRow[map.kategori]?.trim()) {
      warnings.push(`Kategori "${katRaw}" dinormalisasi ke "lainnya".`);
    }

    const satuanBeli: MaterialPurchaseUnit = VALID_PURCHASE_UNITS.has(beliRaw) ? beliRaw : 'roll';
    const satuanPakai: MaterialUsageUnit = pakaiRaw === 'cm' ? 'cm' : 'pcs';

    let konversi: number | null = null;
    if (konvRaw !== '') {
      const parsed = parseLocaleNumber(konvRaw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        errorRows.push({
          rowNumber,
          reason: `Nilai konversi "${konvRaw}" harus bilangan bulat > 0 atau dikosongkan.`,
          rawRow,
        });
        return;
      }
      konversi = parsed;
    } else {
      warnings.push('Konversi satuan beli masih kosong (harus diisi pemilik sebelum beli per satuan beli).');
    }

    let minStock = 0;
    if (minRaw !== '') {
      const parsedMin = parseLocaleNumber(minRaw);
      if (!Number.isInteger(parsedMin) || parsedMin < 0) {
        errorRows.push({ rowNumber, reason: `Min stok "${minRaw}" harus bilangan bulat >= 0.`, rawRow });
        return;
      }
      minStock = parsedMin;
    }

    warnings.forEach((w) => warningsSummary.push(`Baris ${rowNumber}: ${w}`));
    validRows.push({
      rowNumber,
      kode,
      nama,
      kategori,
      satuanBeli,
      satuanPakai,
      konversi,
      minStock,
      warnings,
    });
  });

  return { validRows, errorRows, warningsSummary };
}

// --- Validasi & Pratinjau Impor Resep ---
export interface RecipeImportColumnMap {
  skuProduk: number;
  jenisBaris: number;
  kodeBahan: number;
  qtyPerPcs: number;
  satuanQty: number;
  kategoriBiaya: number;
  labelBiaya: number;
  biayaPerPcs: number;
}

export interface ValidatedRecipeImportRow {
  rowNumber: number;
  productId: string;
  productSku: string;
  jenis: 'material' | 'cost';
  materialId?: string;
  materialKode?: string;
  qtyPerPcs?: number;
  costCategory?: 'jahit_cutting' | 'sablon' | 'packing' | 'lainnya';
  label?: string;
  amountPerPcs?: number;
  warnings: string[];
}

export function validateRecipeImportRows(params: {
  rows: string[][];
  map: RecipeImportColumnMap;
  products: Product[];
  materials: Material[];
}): {
  validRows: ValidatedRecipeImportRow[];
  errorRows: ImportErrorRow[];
  warningsSummary: string[];
} {
  const { rows, map, products, materials } = params;
  const prodBySku = new Map<string, Product>();
  for (const p of products) prodBySku.set(p.sku.trim().toUpperCase(), p);
  const matByKode = new Map<string, Material>();
  for (const m of materials) matByKode.set(m.kode.trim().toUpperCase(), m);

  const seenPairs = new Set<string>();
  const validRows: ValidatedRecipeImportRow[] = [];
  const errorRows: ImportErrorRow[] = [];
  const warningsSummary: string[] = [];

  rows.forEach((rawRow, idx) => {
    const rowNumber = idx + 2;
    const skuRaw = (map.skuProduk >= 0 ? rawRow[map.skuProduk] : '')?.trim() ?? '';
    if (!skuRaw) {
      errorRows.push({ rowNumber, reason: 'SKU Produk kosong.', rawRow });
      return;
    }

    const prod = prodBySku.get(skuRaw.toUpperCase());
    if (!prod) {
      errorRows.push({ rowNumber, reason: `SKU Produk "${skuRaw}" tidak ditemukan di Master.`, rawRow });
      return;
    }

    const warnings: string[] = [];
    if (/^(KAIN|BAHAN|BENANG|RESLETING)/i.test(prod.sku) || /^(KAIN|BAHAN)\b/i.test(prod.nama)) {
      warnings.push(`Produk "${prod.sku} - ${prod.nama}" mencurigakan seperti bahan baku di kategori barang jadi.`);
    }

    const jenisRaw = ((map.jenisBaris >= 0 ? rawRow[map.jenisBaris] : '')?.trim().toLowerCase() || 'material');
    const isCost = jenisRaw === 'cost' || jenisRaw === 'biaya' || jenisRaw === 'upah';

    if (!isCost) {
      const matKode = (map.kodeBahan >= 0 ? rawRow[map.kodeBahan] : '')?.trim() ?? '';
      const qtyRaw = (map.qtyPerPcs >= 0 ? rawRow[map.qtyPerPcs] : '')?.trim() ?? '';
      const unitRaw = (map.satuanQty >= 0 ? rawRow[map.satuanQty] : '')?.trim().toLowerCase() ?? '';
      const mat = matByKode.get(matKode.toUpperCase());
      if (!mat) {
        errorRows.push({ rowNumber, reason: `Kode bahan "${matKode}" tidak ditemukan di Master Bahan.`, rawRow });
        return;
      }

      let qtyInt = 0;
      try {
        if (unitRaw === 'm' || unitRaw === 'meter' || unitRaw === 'mtr') {
          qtyInt = parseLengthToCm(qtyRaw, 'm');
        } else if (unitRaw === 'cm') {
          qtyInt = parseLengthToCm(qtyRaw, 'cm');
        } else {
          const parsed = parseLocaleNumber(qtyRaw);
          if (!Number.isInteger(parsed) || parsed <= 0) {
            throw new Error('Qty pemakaian per pcs harus bilangan bulat > 0.');
          }
          qtyInt = parsed;
        }
      } catch (err) {
        errorRows.push({
          rowNumber,
          reason: err instanceof Error ? err.message : 'Qty per pcs tidak valid.',
          rawRow,
        });
        return;
      }

      const pairKey = `${prod.id}:mat:${mat.id}`;
      if (seenPairs.has(pairKey)) {
        warnings.push(`Duplikat bahan ${mat.kode} pada SKU ${prod.sku} di file impor.`);
      }
      seenPairs.add(pairKey);

      warnings.forEach((w) => warningsSummary.push(`Baris ${rowNumber}: ${w}`));
      validRows.push({
        rowNumber,
        productId: prod.id,
        productSku: prod.sku,
        jenis: 'material',
        materialId: mat.id,
        materialKode: mat.kode,
        qtyPerPcs: qtyInt,
        warnings,
      });
      return;
    }

    // Cost row
    const catRaw = ((map.kategoriBiaya >= 0 ? rawRow[map.kategoriBiaya] : '')?.trim().toLowerCase() || 'lainnya');
    const costCategory: 'jahit_cutting' | 'sablon' | 'packing' | 'lainnya' =
      catRaw === 'jahit_cutting' || catRaw === 'jahit' || catRaw === 'cutting'
        ? 'jahit_cutting'
        : catRaw === 'sablon'
          ? 'sablon'
          : catRaw === 'packing'
            ? 'packing'
            : 'lainnya';
    const label = (map.labelBiaya >= 0 ? rawRow[map.labelBiaya] : '')?.trim() || costCategory;
    const amtRaw = (map.biayaPerPcs >= 0 ? rawRow[map.biayaPerPcs] : '')?.trim() ?? '';
    const parsedAmt = parseLocaleNumber(amtRaw);
    if (!Number.isInteger(parsedAmt) || parsedAmt < 0) {
      errorRows.push({ rowNumber, reason: `Biaya per pcs "${amtRaw}" harus rupiah bulat >= 0.`, rawRow });
      return;
    }

    warnings.forEach((w) => warningsSummary.push(`Baris ${rowNumber}: ${w}`));
    validRows.push({
      rowNumber,
      productId: prod.id,
      productSku: prod.sku,
      jenis: 'cost',
      costCategory,
      label,
      amountPerPcs: parsedAmt,
      warnings,
    });
  });

  return { validRows, errorRows, warningsSummary };
}

// --- Validasi & Pratinjau Impor Penjualan Marketplace ---
export interface MarketplaceImportColumnMap {
  tanggal: number;
  noPesanan: number;
  sku: number;
  qty: number;
  hargaJual: number;
  biayaAdmin: number;
  komisiAffiliate: number;
  potonganLain: number;
  catatan: number;
}

export interface ValidatedMarketplaceImportRow {
  rowNumber: number;
  importKey: string;
  tanggal: string;
  noPesanan: string;
  productId: string;
  sku: string;
  productName: string;
  qty: number;
  hargaJual: number; // total line / order amount (integer rupiah)
  biayaAdmin: number;
  komisiAffiliate: number;
  potonganLain: number;
  penerimaanBersih: number;
  catatan: string;
  warnings: string[];
}

export function buildMarketplaceImportKey(channel: string, noPesanan: string, sku: string): string {
  const normChannel = channel.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
  const normOrder = noPesanan.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  const normSku = sku.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  return `${normChannel}__${normOrder}__${normSku}`;
}

export function normalizeImportDate(raw: string): string | null {
  const s = raw.trim();
  if (isValidDateStr(s)) return s;
  // DD/MM/YYYY atau DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const d = dmy[1].padStart(2, '0');
    const m = dmy[2].padStart(2, '0');
    const y = dmy[3];
    const candidate = `${y}-${m}-${d}`;
    return isValidDateStr(candidate) ? candidate : null;
  }
  // YYYY/MM/DD ...
  const ymd = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (ymd) {
    const candidate = `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
    return isValidDateStr(candidate) ? candidate : null;
  }
  return null;
}

export function validateMarketplaceImportRows(params: {
  channelName: string;
  rows: string[][];
  map: MarketplaceImportColumnMap;
  products: Product[];
  existingImportKeys: Set<string>;
  existingOrderNumbers: Set<string>;
}): {
  validRows: ValidatedMarketplaceImportRow[];
  skippedDuplicateRows: ImportErrorRow[];
  errorRows: ImportErrorRow[];
  warningsSummary: string[];
} {
  const { channelName, rows, map, products, existingImportKeys, existingOrderNumbers } = params;
  const prodBySku = new Map<string, Product>();
  for (const p of products) {
    prodBySku.set(p.sku.trim().toUpperCase(), p);
  }

  const seenInFile = new Set<string>();
  const validRows: ValidatedMarketplaceImportRow[] = [];
  const skippedDuplicateRows: ImportErrorRow[] = [];
  const errorRows: ImportErrorRow[] = [];
  const warningsSummary: string[] = [];

  rows.forEach((rawRow, idx) => {
    const rowNumber = idx + 2;
    const tglRaw = (map.tanggal >= 0 ? rawRow[map.tanggal] : '')?.trim() ?? '';
    const tanggal = normalizeImportDate(tglRaw);
    const noPesanan = (map.noPesanan >= 0 ? rawRow[map.noPesanan] : '')?.trim() ?? '';
    const skuRaw = (map.sku >= 0 ? rawRow[map.sku] : '')?.trim() ?? '';
    const qtyRaw = (map.qty >= 0 ? rawRow[map.qty] : '')?.trim() ?? '';
    const hargaRaw = (map.hargaJual >= 0 ? rawRow[map.hargaJual] : '')?.trim() ?? '';
    const adminRaw = (map.biayaAdmin >= 0 ? rawRow[map.biayaAdmin] : '')?.trim() ?? '0';
    const affRaw = (map.komisiAffiliate >= 0 ? rawRow[map.komisiAffiliate] : '')?.trim() ?? '0';
    const lainRaw = (map.potonganLain >= 0 ? rawRow[map.potonganLain] : '')?.trim() ?? '0';
    const catatan = (map.catatan >= 0 ? rawRow[map.catatan] : '')?.trim() ?? '';

    if (!tanggal) {
      errorRows.push({ rowNumber, reason: `Tanggal "${tglRaw}" tidak valid (gunakan YYYY-MM-DD / DD-MM-YYYY).`, rawRow });
      return;
    }
    if (!noPesanan) {
      errorRows.push({ rowNumber, reason: 'Nomor pesanan kosong.', rawRow });
      return;
    }
    const prod = prodBySku.get(skuRaw.toUpperCase());
    if (!prod) {
      errorRows.push({ rowNumber, reason: `SKU "${skuRaw}" tidak dikenal di Master Produk.`, rawRow });
      return;
    }

    const qty = parseLocaleNumber(qtyRaw);
    if (!Number.isInteger(qty) || qty <= 0) {
      errorRows.push({ rowNumber, reason: `Qty "${qtyRaw}" harus bilangan bulat > 0.`, rawRow });
      return;
    }

    const parseMoney = (val: string) => {
      if (!val) return 0;
      const n = Math.round(parseLocaleNumber(val));
      return Number.isFinite(n) ? n : Number.NaN;
    };

    const hargaJual = parseMoney(hargaRaw);
    const biayaAdmin = Math.abs(parseMoney(adminRaw));
    const komisiAffiliate = Math.abs(parseMoney(affRaw));
    const potonganLain = Math.abs(parseMoney(lainRaw));

    if (!Number.isInteger(hargaJual) || hargaJual < 0) {
      errorRows.push({ rowNumber, reason: `Harga jual "${hargaRaw}" tidak valid.`, rawRow });
      return;
    }
    if (!Number.isInteger(biayaAdmin) || !Number.isInteger(komisiAffiliate) || !Number.isInteger(potonganLain)) {
      errorRows.push({ rowNumber, reason: 'Potongan biaya/komisi tidak valid.', rawRow });
      return;
    }

    const importKey = buildMarketplaceImportKey(channelName, noPesanan, prod.sku);
    if (existingImportKeys.has(importKey) || existingOrderNumbers.has(noPesanan.toUpperCase()) || seenInFile.has(importKey)) {
      const msg = `Duplikat no. pesanan "${noPesanan}" (${prod.sku}) dilewati otomatis.`;
      skippedDuplicateRows.push({ rowNumber, reason: msg, rawRow });
      warningsSummary.push(`Baris ${rowNumber}: ${msg}`);
      return;
    }
    seenInFile.add(importKey);

    const penerimaanBersih = hargaJual - biayaAdmin - komisiAffiliate - potonganLain;
    const warnings: string[] = [];
    if (penerimaanBersih < 0) {
      errorRows.push({
        rowNumber,
        reason: `Penerimaan bersih negatif (${formatRupiah(penerimaanBersih)}). Periksa kolom harga & potongan.`,
        rawRow,
      });
      return;
    }
    if (hargaJual % qty !== 0) {
      warnings.push('Harga jual bukan kelipatan qty; unitPrice akan disesuaikan agar total pas.');
    }

    validRows.push({
      rowNumber,
      importKey,
      tanggal,
      noPesanan,
      productId: prod.id,
      sku: prod.sku,
      productName: prod.nama,
      qty,
      hargaJual,
      biayaAdmin,
      komisiAffiliate,
      potonganLain,
      penerimaanBersih,
      catatan,
      warnings,
    });
  });

  return { validRows, skippedDuplicateRows, errorRows, warningsSummary };
}

export function downloadImportErrorRowsCsv(filename: string, headers: string[], errorRows: ImportErrorRow[]): void {
  const outHeaders = ['baris_ke', 'alasan_penolakan', ...headers];
  const outRows = errorRows.map((err) => [err.rowNumber, err.reason, ...err.rawRow]);
  downloadCsv(filename, outHeaders, outRows);
}

// --- Ekspor Laporan Keuangan CSV ---
export function downloadProfitLossCsv(periodLabel: string, report: ProfitLossReport): void {
  downloadCsv(
    `laba_rugi_${periodLabel}.csv`,
    ['Komponen', 'Nilai (Rp)'],
    [
      ['Penjualan Kotor (Harga Jual)', report.grossSales],
      ['Potongan Marketplace (Admin + Affiliate + Lain)', -report.marketplaceFeesTotal],
      ['Retur Penjualan', -report.returnsTotal],
      ['Penjualan Bersih', report.netSales],
      ['HPP Penjualan', -report.hppTotal],
      ['Laba Kotor', report.grossProfit],
      ['Beban Reject Produksi', -report.rejectExpenseTotal],
      ['Beban Selisih Biaya Produksi (Upah)', -report.wageVarianceTotal],
      ['Penyesuaian Koreksi Opname', report.opnameAdjustmentTotal],
      ['Beban Operasional', -report.operatingExpensesTotal],
      ['Laba Bersih', report.netProfit],
      ['Margin Bersih (%)', `${report.marginPercent}%`],
    ],
  );
}

export function downloadCashFlowCsv(periodLabel: string, cf: CashFlowReport): void {
  downloadCsv(
    `arus_kas_${periodLabel}.csv`,
    ['Arus Kas', 'Nilai (Rp)'],
    [
      ['Saldo Awal Kas & Bank', cf.openingCashBank],
      ['Kas Masuk: Pencairan Marketplace', cf.marketplacePayoutInflows],
      ['Kas Masuk: Pembayaran Penjualan Langsung', cf.directSalesPaymentInflows],
      ['Total Kas Masuk', cf.totalCashInflows],
      ['Kas Keluar: Pembelian Bahan', -cf.purchaseCashOutflows],
      ['Kas Keluar: Upah Mingguan', -cf.wagePayoutCashOutflows],
      ['Kas Keluar: Biaya Produksi CMT', -cf.productionCashOutflows],
      ['Kas Keluar: Pelunasan Utang', -cf.apSettlementCashOutflows],
      ['Kas Keluar: Beban Operasional', -cf.operatingExpenseCashOutflows],
      ['Total Kas Keluar', -cf.totalCashOutflows],
      ['Perubahan Kas Bersih', cf.netCashChange],
      ['Saldo Akhir Kas & Bank (Kalkulasi)', cf.endingCashBank],
      ['Saldo Tercatat Akun Kas & Bank', cf.recordedCashBank],
    ],
  );
}

export function downloadBalanceSheetCsv(bs: BalanceSheetReport): void {
  downloadCsv(
    'neraca_keuangan.csv',
    ['Kategori', 'Pos', 'Nilai (Rp)'],
    [
      ['Aset', 'Kas', bs.kasBalance],
      ['Aset', 'Bank', bs.bankBalance],
      ['Aset', 'Saldo Marketplace (Belum Cair)', bs.marketplaceBalance],
      ['Aset', 'Piutang Usaha', bs.receivablesBalance],
      ['Aset', 'Persediaan Bahan Baku', bs.materialInventoryValue],
      ['Aset', 'Persediaan WIP', bs.wipInventoryValue],
      ['Aset', 'Persediaan Barang Jadi', bs.productInventoryValue],
      ['Aset', 'TOTAL ASET', bs.totalAssets],
      ['Liabilitas', 'Utang Supplier', bs.supplierPayables],
      ['Liabilitas', 'Utang Produksi/CMT', bs.productionPayables],
      ['Liabilitas', 'Akrual Upah Produksi', bs.accruedWages],
      ['Liabilitas', 'TOTAL LIABILITAS', bs.totalLiabilities],
      ['Ekuitas', 'Modal Awal Pemilik', bs.modalAwal === null ? 'Belum diisi (0)' : bs.modalAwal],
      ['Ekuitas', 'Laba Ditahan', bs.retainedEarnings],
      ['Ekuitas', 'TOTAL EKUITAS', bs.totalEquity],
      ['Rekonsiliasi', 'Total Liabilitas + Ekuitas', bs.totalLiabilitiesAndEquity],
      ['Rekonsiliasi', 'Selisih (Aset - (Liabilitas + Ekuitas))', bs.selisih],
    ],
  );
}
