import {
  collection,
  doc,
  getAggregateFromServer,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  sum,
} from 'firebase/firestore';
import { getFirebaseDb } from './config';
import {
  assertOnlineForTransaction,
  fetchCollectionPaginated,
  fetchDocWithCacheFlag,
  fetchQueryWithCacheFlag,
  isMissingIndexError,
  type FetchResult,
} from './common';
import type {
  AccountingSettings,
  AuditLog,
  BankStatement,
  JournalEntry,
  OperatingExpense,
  PeriodDoc,
  ProductionCost,
  PurchaseCost,
  UserRole,
  WagePayout,
} from '../../types/models';
import { assertNonNegativeInt, assertPositiveInt, isValidDateStr } from '../../utils/format';

function mapPurchaseCost(id: string, d: Record<string, unknown>): PurchaseCost {
  return {
    id,
    ledgerId: String(d.ledgerId ?? ''),
    itemId: String(d.itemId ?? ''),
    supplierId: String(d.supplierId ?? ''),
    qty: Number(d.qty ?? 0),
    unitCost: Number(d.unitCost ?? 0),
    totalCost: Number(d.totalCost ?? 0),
    paidAmount: Number(d.paidAmount ?? 0),
    accountId: String(d.accountId ?? ''),
    purchaseQty: d.purchaseQty !== undefined ? Number(d.purchaseQty) : undefined,
    purchaseUnit: d.purchaseUnit ? String(d.purchaseUnit) : undefined,
    actualUsageQty: d.actualUsageQty !== undefined ? Number(d.actualUsageQty) : undefined,
    tanggal: String(d.tanggal ?? ''),
    catatan: String(d.catatan ?? ''),
    createdBy: String(d.createdBy ?? ''),
    createdByName: d.createdByName ? String(d.createdByName) : undefined,
    createdAt: d.createdAt,
  };
}

function mapProductionCost(id: string, d: Record<string, unknown>): ProductionCost {
  return {
    id,
    woId: String(d.woId ?? ''),
    woNumber: String(d.woNumber ?? ''),
    vendorName: String(d.vendorName ?? ''),
    kategori: (d.kategori ?? 'jahit_cmt') as ProductionCost['kategori'],
    amount: Number(d.amount ?? 0),
    paidAmount: Number(d.paidAmount ?? 0),
    accountId: String(d.accountId ?? ''),
    tanggal: String(d.tanggal ?? ''),
    catatan: String(d.catatan ?? ''),
    createdBy: String(d.createdBy ?? ''),
    createdByName: d.createdByName ? String(d.createdByName) : undefined,
    createdAt: d.createdAt,
  };
}

function mapWagePayout(id: string, d: Record<string, unknown>): WagePayout {
  return {
    id,
    startDate: String(d.startDate ?? ''),
    endDate: String(d.endDate ?? ''),
    tanggal: String(d.tanggal ?? ''),
    accountId: String(d.accountId ?? ''),
    accountName: String(d.accountName ?? ''),
    jahitCuttingStandard: Number(d.jahitCuttingStandard ?? 0),
    sablonStandard: Number(d.sablonStandard ?? 0),
    packingStandard: Number(d.packingStandard ?? 0),
    lainnyaStandard: Number(d.lainnyaStandard ?? 0),
    totalStandard: Number(d.totalStandard ?? 0),
    jahitCuttingPaid: Number(d.jahitCuttingPaid ?? 0),
    sablonPaid: Number(d.sablonPaid ?? 0),
    packingPaid: Number(d.packingPaid ?? 0),
    lainnyaPaid: Number(d.lainnyaPaid ?? 0),
    totalPaid: Number(d.totalPaid ?? 0),
    variance: Number(d.variance ?? 0),
    catatan: String(d.catatan ?? ''),
    createdBy: String(d.createdBy ?? ''),
    createdByName: d.createdByName ? String(d.createdByName) : undefined,
    createdAt: d.createdAt,
  };
}

function mapOperatingExpense(id: string, d: Record<string, unknown>): OperatingExpense {
  return {
    id,
    kategori: String(d.kategori ?? ''),
    deskripsi: String(d.deskripsi ?? ''),
    accountId: String(d.accountId ?? ''),
    amount: Number(d.amount ?? 0),
    tanggal: String(d.tanggal ?? ''),
    createdBy: String(d.createdBy ?? ''),
    createdByName: d.createdByName ? String(d.createdByName) : undefined,
    createdAt: d.createdAt,
  };
}

function mapJournalEntry(id: string, d: Record<string, unknown>): JournalEntry {
  return {
    id,
    tanggal: String(d.tanggal ?? ''),
    source: String(d.source ?? ''),
    refId: String(d.refId ?? ''),
    accountId: d.accountId ? String(d.accountId) : undefined,
    debitAccount: String(d.debitAccount ?? ''),
    creditAccount: String(d.creditAccount ?? ''),
    amount: Number(d.amount ?? 0),
    debitAmount: d.debitAmount !== undefined ? Number(d.debitAmount) : undefined,
    creditAmount: d.creditAmount !== undefined ? Number(d.creditAmount) : undefined,
    deskripsi: String(d.deskripsi ?? ''),
    isReversal: Boolean(d.isReversal),
    reversedEntryId: d.reversedEntryId ? String(d.reversedEntryId) : undefined,
    createdBy: String(d.createdBy ?? ''),
    createdByName: d.createdByName ? String(d.createdByName) : undefined,
    createdAt: d.createdAt,
  };
}

function mapPeriodDoc(id: string, d: Record<string, unknown>): PeriodDoc {
  return {
    id,
    closed: Boolean(d.closed),
    closedNote: d.closedNote ? String(d.closedNote) : undefined,
    updatedBy: String(d.updatedBy ?? ''),
    updatedAt: d.updatedAt,
  };
}

export async function fetchPurchaseCosts(pageLimit = 100): Promise<FetchResult<PurchaseCost>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'purchase_costs'), orderBy('createdAt', 'desc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, mapPurchaseCost);
}

export async function fetchAllPurchaseCostsPaginated(minDate?: string) {
  return fetchCollectionPaginated<PurchaseCost>({
    collectionName: 'purchase_costs',
    minDate,
    mapper: mapPurchaseCost,
  });
}

/**
 * Mencatat total biaya pembelian (rupiah bulat) untuk qty dalam satuan pakai (cm/pcs)
 * dan menghitung harga per satuan pakai sebagai pecahan float.
 */
export async function createPurchaseCost(params: {
  actorUid: string;
  actorName?: string;
  ledgerId: string;
  itemId: string;
  supplierId: string;
  qty: number;
  unitCost?: number;
  totalCost?: number;
  paidAmount: number;
  accountId: string;
  purchaseQty?: number;
  purchaseUnit?: string;
  actualUsageQty?: number;
  tanggal: string;
  catatan: string;
}): Promise<string> {
  assertOnlineForTransaction();
  assertPositiveInt(params.qty, 'Qty dalam satuan pakai');
  assertNonNegativeInt(params.paidAmount, 'Pembayaran');
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal tidak valid.');

  const totalCost =
    params.totalCost !== undefined
      ? params.totalCost
      : Math.round(params.qty * (params.unitCost ?? 0));
  assertNonNegativeInt(totalCost, 'Total harga beli');

  const unitCost = totalCost / params.qty; // pecahan per cm/pcs
  if (params.paidAmount > totalCost) throw new Error('Pembayaran melebihi total harga beli.');
  if (params.paidAmount > 0 && !params.accountId) throw new Error('Pilih akun kas/bank.');

  const db = getFirebaseDb();
  const costRef = doc(collection(db, 'purchase_costs'));
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));

  await runTransaction(db, async (tx) => {
    const periodSnap = await tx.get(periodRef);
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    let accSnap = null;
    const accRef = params.accountId ? doc(db, 'accounts', params.accountId) : null;
    if (params.paidAmount > 0 && accRef) {
      accSnap = await tx.get(accRef);
      if (!accSnap.exists()) throw new Error('Akun kas/bank tidak ditemukan.');
    }

    tx.set(costRef, {
      ledgerId: params.ledgerId.trim() || 'manual',
      itemId: params.itemId,
      supplierId: params.supplierId,
      qty: params.qty,
      unitCost,
      totalCost,
      paidAmount: params.paidAmount,
      accountId: params.accountId,
      ...(params.purchaseQty !== undefined ? { purchaseQty: params.purchaseQty } : {}),
      ...(params.purchaseUnit ? { purchaseUnit: params.purchaseUnit } : {}),
      ...(params.actualUsageQty !== undefined ? { actualUsageQty: params.actualUsageQty } : {}),
      tanggal: params.tanggal,
      catatan: params.catatan.trim(),
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    if (params.paidAmount > 0 && accRef && accSnap) {
      const prev = Number(accSnap.data().saldoBerjalan ?? 0);
      const next = prev - params.paidAmount;
      const auditRef = doc(collection(db, 'audit_logs'));
      tx.update(accRef, {
        saldoBerjalan: next,
        lastAuditLogId: auditRef.id,
      });
      tx.set(auditRef, {
        uid: params.actorUid,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        aksi: 'PURCHASE_COST_CASH_OUT',
        targetCollection: 'accounts',
        targetId: params.accountId,
        sebelum: JSON.stringify({ saldoBerjalan: prev }),
        sesudah: JSON.stringify({ saldoBerjalan: next, purchaseCostId: costRef.id }),
        createdAt: serverTimestamp(),
      });
    }

    tx.set(doc(collection(db, 'journal_entries')), {
      tanggal: params.tanggal,
      source: 'purchase_cost',
      refId: costRef.id,
      debitAccount: 'persediaan_bahan',
      creditAccount: params.paidAmount >= totalCost ? 'kas_bank' : 'utang_supplier',
      amount: totalCost,
      deskripsi: `Pembelian bahan (${params.qty} satuan pakai · total ${totalCost})`,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });
  });

  return costRef.id;
}

export async function fetchProductionCosts(pageLimit = 100): Promise<FetchResult<ProductionCost>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'production_costs'), orderBy('createdAt', 'desc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, mapProductionCost);
}

export async function fetchAllProductionCostsPaginated(minDate?: string) {
  return fetchCollectionPaginated<ProductionCost>({
    collectionName: 'production_costs',
    minDate,
    mapper: mapProductionCost,
  });
}

export async function createProductionCost(params: {
  actorUid: string;
  actorName?: string;
  woId: string;
  woNumber: string;
  vendorName: string;
  kategori: ProductionCost['kategori'];
  amount: number;
  paidAmount: number;
  accountId: string;
  tanggal: string;
  catatan: string;
}): Promise<string> {
  assertOnlineForTransaction();
  assertNonNegativeInt(params.amount, 'Biaya produksi');
  assertNonNegativeInt(params.paidAmount, 'Pembayaran');
  if (params.paidAmount > params.amount) throw new Error('Pembayaran melebihi biaya produksi.');
  if (params.paidAmount > 0 && !params.accountId) throw new Error('Pilih akun kas/bank.');
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal tidak valid.');

  const db = getFirebaseDb();
  const costRef = doc(collection(db, 'production_costs'));
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));

  await runTransaction(db, async (tx) => {
    const periodSnap = await tx.get(periodRef);
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    let accSnap = null;
    const accRef = params.accountId ? doc(db, 'accounts', params.accountId) : null;
    if (params.paidAmount > 0 && accRef) {
      accSnap = await tx.get(accRef);
      if (!accSnap.exists()) throw new Error('Akun kas/bank tidak ditemukan.');
    }

    tx.set(costRef, {
      woId: params.woId,
      woNumber: params.woNumber,
      vendorName: params.vendorName.trim(),
      kategori: params.kategori,
      amount: params.amount,
      paidAmount: params.paidAmount,
      accountId: params.accountId,
      tanggal: params.tanggal,
      catatan: params.catatan.trim(),
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    if (params.paidAmount > 0 && accRef && accSnap) {
      const prev = Number(accSnap.data().saldoBerjalan ?? 0);
      const next = prev - params.paidAmount;
      const auditRef = doc(collection(db, 'audit_logs'));
      tx.update(accRef, {
        saldoBerjalan: next,
        lastAuditLogId: auditRef.id,
      });
      tx.set(auditRef, {
        uid: params.actorUid,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        aksi: 'PRODUCTION_COST_CASH_OUT',
        targetCollection: 'accounts',
        targetId: params.accountId,
        sebelum: JSON.stringify({ saldoBerjalan: prev }),
        sesudah: JSON.stringify({ saldoBerjalan: next, productionCostId: costRef.id }),
        createdAt: serverTimestamp(),
      });
    }

    tx.set(doc(collection(db, 'journal_entries')), {
      tanggal: params.tanggal,
      source: 'production_cost',
      refId: costRef.id,
      debitAccount: 'wip_produksi',
      creditAccount: params.paidAmount >= params.amount ? 'kas_bank' : 'utang_cmt',
      amount: params.amount,
      deskripsi: `Biaya ${params.kategori} ${params.woNumber} (${params.vendorName})`,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });
  });

  return costRef.id;
}

// --- UPAH MINGGUAN ---
export async function fetchWagePayouts(pageLimit = 50): Promise<FetchResult<WagePayout>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'wage_payouts'), orderBy('createdAt', 'desc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, mapWagePayout);
}

export async function fetchAllWagePayoutsPaginated(minDate?: string) {
  return fetchCollectionPaginated<WagePayout>({
    collectionName: 'wage_payouts',
    minDate,
    mapper: mapWagePayout,
  });
}

export async function recordWagePayout(params: {
  actorUid: string;
  actorName?: string;
  startDate: string;
  endDate: string;
  tanggal: string;
  accountId: string;
  accountName: string;
  jahitCuttingStandard: number;
  sablonStandard: number;
  packingStandard: number;
  lainnyaStandard: number;
  jahitCuttingPaid: number;
  sablonPaid: number;
  packingPaid: number;
  lainnyaPaid: number;
  catatan: string;
}): Promise<string> {
  assertOnlineForTransaction();
  if (!isValidDateStr(params.startDate) || !isValidDateStr(params.endDate) || !isValidDateStr(params.tanggal)) {
    throw new Error('Format tanggal rentang & bayar harus YYYY-MM-DD.');
  }
  assertNonNegativeInt(params.jahitCuttingStandard, 'Standar jahit/cutting');
  assertNonNegativeInt(params.sablonStandard, 'Standar sablon');
  assertNonNegativeInt(params.packingStandard, 'Standar packing');
  assertNonNegativeInt(params.lainnyaStandard, 'Standar lainnya');
  assertNonNegativeInt(params.jahitCuttingPaid, 'Bayar jahit/cutting');
  assertNonNegativeInt(params.sablonPaid, 'Bayar sablon');
  assertNonNegativeInt(params.packingPaid, 'Bayar packing');
  assertNonNegativeInt(params.lainnyaPaid, 'Bayar lainnya');

  const totalStandard =
    params.jahitCuttingStandard + params.sablonStandard + params.packingStandard + params.lainnyaStandard;
  const totalPaid =
    params.jahitCuttingPaid + params.sablonPaid + params.packingPaid + params.lainnyaPaid;
  if (totalPaid <= 0 && totalStandard <= 0) {
    throw new Error('Nominal upah standar dan aktual tidak boleh keduanya 0.');
  }
  if (!params.accountId) throw new Error('Pilih akun kas/bank pembayar upah.');

  const variance = totalPaid - totalStandard;
  const db = getFirebaseDb();
  const payoutRef = doc(collection(db, 'wage_payouts'));
  const accRef = doc(db, 'accounts', params.accountId);
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));

  await runTransaction(db, async (tx) => {
    const [accSnap, periodSnap] = await Promise.all([tx.get(accRef), tx.get(periodRef)]);
    if (!accSnap.exists()) throw new Error('Akun kas/bank tidak ditemukan.');
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    if (totalPaid > 0) {
      const prev = Number(accSnap.data().saldoBerjalan ?? 0);
      const next = prev - totalPaid;
      const auditRef = doc(collection(db, 'audit_logs'));
      tx.update(accRef, {
        saldoBerjalan: next,
        lastAuditLogId: auditRef.id,
      });
      tx.set(auditRef, {
        uid: params.actorUid,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        aksi: 'WAGE_PAYOUT_CASH_OUT',
        targetCollection: 'accounts',
        targetId: params.accountId,
        sebelum: JSON.stringify({ saldoBerjalan: prev }),
        sesudah: JSON.stringify({ saldoBerjalan: next, wagePayoutId: payoutRef.id }),
        createdAt: serverTimestamp(),
      });
    }

    tx.set(payoutRef, {
      startDate: params.startDate,
      endDate: params.endDate,
      tanggal: params.tanggal,
      accountId: params.accountId,
      accountName: params.accountName,
      jahitCuttingStandard: params.jahitCuttingStandard,
      sablonStandard: params.sablonStandard,
      packingStandard: params.packingStandard,
      lainnyaStandard: params.lainnyaStandard,
      totalStandard,
      jahitCuttingPaid: params.jahitCuttingPaid,
      sablonPaid: params.sablonPaid,
      packingPaid: params.packingPaid,
      lainnyaPaid: params.lainnyaPaid,
      totalPaid,
      variance,
      catatan: params.catatan.trim(),
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    if (totalPaid > 0) {
      tx.set(doc(collection(db, 'journal_entries')), {
        tanggal: params.tanggal,
        source: 'wage_payout',
        refId: payoutRef.id,
        accountId: params.accountId,
        debitAccount: 'akrual_upah',
        creditAccount: 'kas_bank',
        amount: totalPaid,
        deskripsi: `Pembayaran upah mingguan (${params.startDate} s/d ${params.endDate})`,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        createdAt: serverTimestamp(),
      });
    }

    if (variance !== 0) {
      tx.set(doc(collection(db, 'journal_entries')), {
        tanggal: params.tanggal,
        source: 'wage_variance',
        refId: payoutRef.id,
        debitAccount: variance > 0 ? 'beban_selisih_biaya_produksi' : 'akrual_upah',
        creditAccount: variance > 0 ? 'akrual_upah' : 'beban_selisih_biaya_produksi',
        amount: Math.abs(variance),
        deskripsi: `Selisih biaya produksi upah (${variance > 0 ? 'lebih bayar' : 'hemat'})`,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        createdAt: serverTimestamp(),
      });
    }
  });

  return payoutRef.id;
}

// --- PENGATURAN NERACA (Modal Awal Pemilik) ---
export async function fetchAccountingSettings(): Promise<AccountingSettings | null> {
  const res = await fetchDocWithCacheFlag(
    doc(getFirebaseDb(), 'accounting_settings', 'default'),
    (id, d) => ({
      id,
      modalAwal: typeof d.modalAwal === 'number' ? d.modalAwal : null,
      updatedBy: String(d.updatedBy ?? ''),
      updatedAt: d.updatedAt,
    }),
  );
  return res.item;
}

export async function saveModalAwalSetting(params: {
  actorUid: string;
  modalAwal: number | null;
}): Promise<void> {
  assertOnlineForTransaction();
  if (params.modalAwal !== null) {
    assertNonNegativeInt(params.modalAwal, 'Modal awal');
  }
  await setDoc(doc(getFirebaseDb(), 'accounting_settings', 'default'), {
    modalAwal: params.modalAwal,
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  });
}

export async function settlePayableEntry(params: {
  actorUid: string;
  actorName?: string;
  refType: 'purchase_cost' | 'production_cost';
  refId: string;
  accountId: string;
  amount: number;
  tanggal: string;
  deskripsi: string;
}): Promise<void> {
  assertOnlineForTransaction();
  assertPositiveInt(params.amount, 'Nominal pelunasan utang');
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal tidak valid.');

  const db = getFirebaseDb();
  const accRef = doc(db, 'accounts', params.accountId);
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));

  await runTransaction(db, async (tx) => {
    const [accSnap, periodSnap] = await Promise.all([tx.get(accRef), tx.get(periodRef)]);
    if (!accSnap.exists()) throw new Error('Akun kas/bank tidak ditemukan.');
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    const prevSaldo = Number(accSnap.data().saldoBerjalan ?? 0);
    const nextSaldo = prevSaldo - params.amount;
    const auditRef = doc(collection(db, 'audit_logs'));
    tx.update(accRef, {
      saldoBerjalan: nextSaldo,
      lastAuditLogId: auditRef.id,
    });
    tx.set(auditRef, {
      uid: params.actorUid,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      aksi: 'SETTLE_PAYABLE_CASH_OUT',
      targetCollection: 'accounts',
      targetId: params.accountId,
      sebelum: JSON.stringify({ saldoBerjalan: prevSaldo }),
      sesudah: JSON.stringify({ saldoBerjalan: nextSaldo, refType: params.refType, refId: params.refId }),
      createdAt: serverTimestamp(),
    });

    tx.set(doc(collection(db, 'journal_entries')), {
      tanggal: params.tanggal,
      source: 'ap_payment',
      refId: params.refId,
      accountId: params.accountId,
      debitAccount: params.refType === 'purchase_cost' ? 'utang_supplier' : 'utang_cmt',
      creditAccount: 'kas_bank',
      amount: params.amount,
      deskripsi: params.deskripsi,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });
  });
}

export async function fetchOperatingExpenses(pageLimit = 100): Promise<FetchResult<OperatingExpense>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'operating_expenses'), orderBy('createdAt', 'desc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, mapOperatingExpense);
}

export async function fetchAllOperatingExpensesPaginated(minDate?: string) {
  return fetchCollectionPaginated<OperatingExpense>({
    collectionName: 'operating_expenses',
    minDate,
    mapper: mapOperatingExpense,
  });
}

export async function createOperatingExpense(params: {
  actorUid: string;
  actorName?: string;
  kategori: string;
  deskripsi: string;
  accountId: string;
  amount: number;
  tanggal: string;
}): Promise<string> {
  assertOnlineForTransaction();
  assertPositiveInt(params.amount, 'Nominal beban');
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal tidak valid.');

  const db = getFirebaseDb();
  const expRef = doc(collection(db, 'operating_expenses'));
  const accRef = doc(db, 'accounts', params.accountId);
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));

  await runTransaction(db, async (tx) => {
    const [accSnap, periodSnap] = await Promise.all([tx.get(accRef), tx.get(periodRef)]);
    if (!accSnap.exists()) throw new Error('Akun kas/bank tidak ditemukan.');
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    const prev = Number(accSnap.data().saldoBerjalan ?? 0);
    const next = prev - params.amount;
    const auditRef = doc(collection(db, 'audit_logs'));
    tx.update(accRef, {
      saldoBerjalan: next,
      lastAuditLogId: auditRef.id,
    });
    tx.set(auditRef, {
      uid: params.actorUid,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      aksi: 'OPERATING_EXPENSE_CASH_OUT',
      targetCollection: 'accounts',
      targetId: params.accountId,
      sebelum: JSON.stringify({ saldoBerjalan: prev }),
      sesudah: JSON.stringify({ saldoBerjalan: next, expenseId: expRef.id }),
      createdAt: serverTimestamp(),
    });

    tx.set(expRef, {
      kategori: params.kategori.trim(),
      deskripsi: params.deskripsi.trim(),
      accountId: params.accountId,
      amount: params.amount,
      tanggal: params.tanggal,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    tx.set(doc(collection(db, 'journal_entries')), {
      tanggal: params.tanggal,
      source: 'operating_expense',
      refId: expRef.id,
      debitAccount: `beban_${params.kategori.trim().toLowerCase()}`,
      creditAccount: 'kas_bank',
      amount: params.amount,
      deskripsi: `${params.kategori}: ${params.deskripsi}`,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });
  });

  return expRef.id;
}

export async function fetchJournalEntries(pageLimit = 100): Promise<FetchResult<JournalEntry>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'journal_entries'), orderBy('createdAt', 'desc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, mapJournalEntry);
}

export async function fetchAllJournalEntriesPaginated(minDate?: string) {
  return fetchCollectionPaginated<JournalEntry>({
    collectionName: 'journal_entries',
    minDate,
    mapper: mapJournalEntry,
  });
}

export async function createReversalJournal(params: {
  actorUid: string;
  actorName?: string;
  original: JournalEntry;
  tanggal: string;
  alasan: string;
}): Promise<string> {
  assertOnlineForTransaction();
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal reversal tidak valid.');

  const db = getFirebaseDb();
  const jRef = doc(collection(db, 'journal_entries'));
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));

  await runTransaction(db, async (tx) => {
    const periodSnap = await tx.get(periodRef);
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    tx.set(jRef, {
      tanggal: params.tanggal,
      source: 'reversal',
      refId: params.original.id,
      debitAccount: params.original.creditAccount,
      creditAccount: params.original.debitAccount,
      amount: params.original.amount,
      deskripsi: `Reversal [${params.original.deskripsi}]: ${params.alasan}`,
      isReversal: true,
      reversedEntryId: params.original.id,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    tx.set(doc(collection(db, 'audit_logs')), {
      uid: params.actorUid,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      aksi: 'JOURNAL_REVERSAL',
      targetCollection: 'journal_entries',
      targetId: jRef.id,
      sebelum: JSON.stringify({ originalId: params.original.id, amount: params.original.amount }),
      sesudah: JSON.stringify({ reversalId: jRef.id, tanggal: params.tanggal, alasan: params.alasan }),
      createdAt: serverTimestamp(),
    });
  });

  return jRef.id;
}

export async function fetchPeriods(pageLimit = 36): Promise<FetchResult<PeriodDoc>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'periods'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, mapPeriodDoc);
}

export async function fetchAllPeriodsPaginated() {
  return fetchCollectionPaginated<PeriodDoc>({
    collectionName: 'periods',
    mapper: mapPeriodDoc,
  });
}

export async function setPeriodClosed(params: {
  actorUid: string;
  actorName?: string;
  periodId: string;
  closed: boolean;
  note: string;
}): Promise<void> {
  assertOnlineForTransaction();
  if (!/^\d{4}-\d{2}$/.test(params.periodId)) {
    throw new Error('Format periode harus YYYY-MM.');
  }
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const auditRef = doc(collection(db, 'audit_logs'));
  batch.set(doc(db, 'periods', params.periodId), {
    closed: params.closed,
    closedNote: params.note.trim(),
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
    ...(!params.closed ? { lastAuditLogId: auditRef.id } : {}),
  });
  batch.set(auditRef, {
    uid: params.actorUid,
    createdBy: params.actorUid,
    ...(params.actorName ? { createdByName: params.actorName } : {}),
    aksi: params.closed ? 'CLOSE_PERIOD' : 'REOPEN_PERIOD',
    targetCollection: 'periods',
    targetId: params.periodId,
    sebelum: JSON.stringify({ closed: !params.closed }),
    sesudah: JSON.stringify({ closed: params.closed, note: params.note.trim() }),
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function fetchBankStatements(accountId?: string, pageLimit = 100): Promise<FetchResult<BankStatement>> {
  const db = getFirebaseDb();
  const mapper = (id: string, d: Record<string, unknown>): BankStatement => ({
    id,
    accountId: String(d.accountId ?? ''),
    tanggal: String(d.tanggal ?? ''),
    deskripsi: String(d.deskripsi ?? ''),
    amount: Number(d.amount ?? 0),
    matchedRefId: d.matchedRefId ? String(d.matchedRefId) : undefined,
    matchedNote: d.matchedNote ? String(d.matchedNote) : undefined,
    createdBy: String(d.createdBy ?? ''),
    createdAt: d.createdAt,
  });

  if (!accountId) {
    const q = query(collection(db, 'bank_statements'), orderBy('tanggal', 'desc'), limit(pageLimit));
    return fetchQueryWithCacheFlag(q, mapper);
  }

  const q = query(
    collection(db, 'bank_statements'),
    where('accountId', '==', accountId),
    orderBy('tanggal', 'desc'),
    limit(pageLimit),
  );
  try {
    return await fetchQueryWithCacheFlag(q, mapper);
  } catch (err) {
    if (!isMissingIndexError(err)) throw err;
    const fallbackQ = query(
      collection(db, 'bank_statements'),
      where('accountId', '==', accountId),
      limit(pageLimit),
    );
    const res = await fetchQueryWithCacheFlag(fallbackQ, mapper);
    return {
      ...res,
      items: [...res.items].sort((a, b) => b.tanggal.localeCompare(a.tanggal)),
    };
  }
}

export async function importBankStatementsBatch(params: {
  actorUid: string;
  accountId: string;
  rows: Array<{ tanggal: string; deskripsi: string; amount: number }>;
}): Promise<number> {
  assertOnlineForTransaction();
  const db = getFirebaseDb();
  let inserted = 0;
  for (let i = 0; i < params.rows.length; i += 400) {
    const chunk = params.rows.slice(i, i + 400);
    const batch = writeBatch(db);
    for (const row of chunk) {
      if (!isValidDateStr(row.tanggal) || !Number.isInteger(row.amount)) continue;
      const ref = doc(collection(db, 'bank_statements'));
      batch.set(ref, {
        accountId: params.accountId,
        tanggal: row.tanggal,
        deskripsi: row.deskripsi.trim(),
        amount: row.amount,
        createdBy: params.actorUid,
        createdAt: serverTimestamp(),
      });
      inserted += 1;
    }
    await batch.commit();
  }
  return inserted;
}

export async function matchBankStatement(params: {
  statementId: string;
  matchedRefId: string;
  matchedNote: string;
}): Promise<void> {
  assertOnlineForTransaction();
  await updateDoc(doc(getFirebaseDb(), 'bank_statements', params.statementId), {
    matchedRefId: params.matchedRefId,
    matchedNote: params.matchedNote,
  });
}

export async function fetchAuditLogs(pageLimit = 100): Promise<FetchResult<AuditLog>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, (id, d) => ({
    id,
    uid: String(d.uid ?? ''),
    createdBy: d.createdBy ? String(d.createdBy) : undefined,
    createdByName: d.createdByName ? String(d.createdByName) : undefined,
    aksi: String(d.aksi ?? ''),
    targetCollection: String(d.targetCollection ?? ''),
    targetId: String(d.targetId ?? ''),
    sebelum: String(d.sebelum ?? ''),
    sesudah: String(d.sesudah ?? ''),
    createdAt: d.createdAt,
  }));
}

export interface DashboardAggregations {
  activeWoCount: number;
  pendingOpnameCount: number;
  activeSoCount: number;
  totalCashBalance: number;
  marketplaceBalanceTotal: number;
  grossSalesActive: number;
  paidSalesActive: number;
  operatingExpensesTotal: number;
}

export async function fetchDashboardAggregations(_role: UserRole): Promise<DashboardAggregations> {
  void _role;
  const db = getFirebaseDb();
  const [activeWoCountSnap, pendingOpnameSnap] = await Promise.all([
    getCountFromServer(query(collection(db, 'work_orders'), where('status', '==', 'in_progress'))),
    getCountFromServer(query(collection(db, 'opname_requests'), where('status', '==', 'pending'))),
  ]);

  let activeSoCount = 0;
  let grossSalesActive = 0;
  let paidSalesActive = 0;
  let totalCashBalance = 0;
  let marketplaceBalanceTotal = 0;
  let operatingExpensesTotal = 0;

  const activeSoQuery = query(collection(db, 'sales_orders'), where('status', '==', 'active'));
  try {
    const [soAgg, soCountSnap] = await Promise.all([
      getAggregateFromServer(activeSoQuery, {
        total: sum('totalAmount'),
        paid: sum('paidAmount'),
      }),
      getCountFromServer(activeSoQuery),
    ]);
    activeSoCount = soCountSnap.data().count;
    grossSalesActive = Number(soAgg.data().total ?? 0);
    paidSalesActive = Number(soAgg.data().paid ?? 0);
  } catch (err) {
    if (!isMissingIndexError(err)) throw err;
    const snap = await getDocs(activeSoQuery);
    activeSoCount = snap.size;
    snap.docs.forEach((docSnap) => {
      const d = docSnap.data();
      grossSalesActive += Number(d.totalAmount ?? 0);
      paidSalesActive += Number(d.paidAmount ?? 0);
    });
  }

  const activeAccQuery = query(collection(db, 'accounts'), where('active', '==', true));
  try {
    const accAgg = await getAggregateFromServer(activeAccQuery, {
      totalCash: sum('saldoBerjalan'),
    });
    totalCashBalance = Number(accAgg.data().totalCash ?? 0);
  } catch (err) {
    if (!isMissingIndexError(err)) throw err;
    const snap = await getDocs(activeAccQuery);
    snap.docs.forEach((docSnap) => {
      totalCashBalance += Number(docSnap.data().saldoBerjalan ?? 0);
    });
  }

  const chQuery = query(collection(db, 'marketplace_channels'), where('active', '==', true));
  try {
    const chAgg = await getAggregateFromServer(chQuery, { totalBal: sum('balance') });
    marketplaceBalanceTotal = Number(chAgg.data().totalBal ?? 0);
  } catch (err) {
    if (!isMissingIndexError(err)) throw err;
    const snap = await getDocs(chQuery);
    snap.docs.forEach((docSnap) => {
      marketplaceBalanceTotal += Number(docSnap.data().balance ?? 0);
    });
  }

  try {
    const expAgg = await getAggregateFromServer(collection(db, 'operating_expenses'), {
      totalExp: sum('amount'),
    });
    operatingExpensesTotal = Number(expAgg.data().totalExp ?? 0);
  } catch (err) {
    if (!isMissingIndexError(err)) throw err;
    const snap = await getDocs(collection(db, 'operating_expenses'));
    snap.docs.forEach((docSnap) => {
      operatingExpensesTotal += Number(docSnap.data().amount ?? 0);
    });
  }

  return {
    activeWoCount: activeWoCountSnap.data().count,
    pendingOpnameCount: pendingOpnameSnap.data().count,
    activeSoCount,
    totalCashBalance,
    marketplaceBalanceTotal,
    grossSalesActive,
    paidSalesActive,
    operatingExpensesTotal,
  };
}
