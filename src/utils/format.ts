const rupiahFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('id-ID', {
  maximumFractionDigits: 0,
});

const decimalFormatter = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatRupiah(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return rupiahFormatter.format(safe);
}

export function formatNumber(qty: number): string {
  const safe = Number.isFinite(qty) ? Math.round(qty) : 0;
  return numberFormatter.format(safe);
}

export function formatDecimalId(value: number, maxDecimals = 2): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

export function formatUnitCost(cost: number): string {
  if (!Number.isFinite(cost)) return 'Rp 0';
  if (Math.abs(cost - Math.round(cost)) < 0.005) {
    return formatRupiah(Math.round(cost));
  }
  return `Rp ${formatDecimalId(cost, 2)}`;
}

/**
 * Menampilkan kuantitas pemakaian secara rapi (misal 1.250 cm -> "12,5 m (1.250 cm)").
 */
export function formatUsageQty(qty: number, unit: string): string {
  const safe = Number.isFinite(qty) ? Math.round(qty) : 0;
  if (unit === 'cm') {
    const meters = safe / 100;
    return `${decimalFormatter.format(meters)} m (${numberFormatter.format(safe)} cm)`;
  }
  return `${numberFormatter.format(safe)} ${unit}`;
}

export function parseLocaleNumber(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return Number.NaN;
  // Normalisasi pemisah ribuan/desimal: "1.250,5" -> "1250.5", "0,5" -> "0.5", "12.5" -> "12.5"
  let normalized = trimmed.replace(/\s+/g, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (normalized.includes(',')) {
    const parts = normalized.split(',');
    if (parts.length === 2) {
      normalized = `${parts[0]}.${parts[1]}`;
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : Number.NaN;
}

/**
 * Mengonversi input panjang dalam m atau cm ke bilangan bulat cm.
 * Menerima angka desimal pada satuan m (misal 0,5 m = 50 cm), tetapi menolak pecahan cm.
 */
export function parseLengthToCm(rawValue: string | number, unit: 'm' | 'cm'): number {
  const num = typeof rawValue === 'number' ? rawValue : parseLocaleNumber(rawValue);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error('Panjang bahan harus berupa angka lebih dari 0.');
  }
  const cmExact = unit === 'm' ? num * 100 : num;
  const cmRounded = Math.round(cmExact);
  if (Math.abs(cmExact - cmRounded) > 1e-6) {
    throw new Error('Hasil panjang dalam cm harus bilangan bulat (tanpa pecahan cm).');
  }
  if (cmRounded <= 0) {
    throw new Error('Panjang dalam cm harus lebih dari 0.');
  }
  return cmRounded;
}

/**
 * Mengurai rasio pola seperti "1 mtr jadi 5 pcs" atau "2 m jadi 8 pcs" menjadi cm per pcs bulat.
 */
export function parsePatternLengthToCmPerPcs(rawPattern: string): number {
  const text = rawPattern.trim().toLowerCase();
  const match = text.match(/^([0-9.,]+)\s*(mtr|meter|m|cm)\s*(?:jadi|=|\/)\s*([0-9.,]+)\s*pcs?$/i);
  if (!match) {
    throw new Error('Format pola panjang tidak dikenali. Contoh valid: "1 mtr jadi 5 pcs" atau "50 cm jadi 2 pcs".');
  }
  const lenNum = parseLocaleNumber(match[1]);
  const unitToken = match[2];
  const pcsNum = parseLocaleNumber(match[3]);
  if (!Number.isFinite(lenNum) || lenNum <= 0 || !Number.isInteger(pcsNum) || pcsNum <= 0) {
    throw new Error('Angka panjang dan jumlah pcs pada pola harus valid (> 0) dengan jumlah pcs bulat.');
  }
  const totalCm = parseLengthToCm(lenNum, unitToken === 'cm' ? 'cm' : 'm');
  const cmPerPcs = totalCm / pcsNum;
  if (!Number.isInteger(cmPerPcs) || cmPerPcs <= 0) {
    throw new Error(`Hasil pembagian ${totalCm} cm / ${pcsNum} pcs = ${cmPerPcs} cm bukan bilangan bulat.`);
  }
  return cmPerPcs;
}

export function todayJakarta(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function currentPeriodJakarta(): string {
  return todayJakarta().slice(0, 7);
}

export function periodFromDate(tanggal: string): string {
  return tanggal.slice(0, 7);
}

export function isValidDateStr(tanggal: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(tanggal);
}

export function assertPositiveInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} harus berupa bilangan bulat lebih dari 0.`);
  }
  return value;
}

export function assertNonNegativeInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} harus berupa bilangan bulat >= 0.`);
  }
  return value;
}

export function parseIntegerInput(raw: string): number {
  const cleaned = raw.replace(/[^0-9-]/g, '');
  if (!cleaned || cleaned === '-') return 0;
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatTimestamp(ts: unknown): string {
  if (!ts) return '-';
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    const d = (ts as { toDate: () => Date }).toDate();
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  }
  if (ts instanceof Date) {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(ts);
  }
  return String(ts);
}
