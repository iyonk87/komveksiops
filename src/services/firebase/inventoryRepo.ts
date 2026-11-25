import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  type QueryDocumentSnapshot,
  type DocumentData,
  getDocs,
} from 'firebase/firestore';
import { getFirebaseDb } from './config';
import {
  assertOnlineForTransaction,
  fetchCollectionPaginated,
  fetchQueryWithCacheFlag,
  isMissingIndexError,
  timestampToMillis,
  type FetchResult,
} from './common';
import { computeReceivingUsageQty, validateStockChange } from '../domain/accounting';
import type {
  LedgerEntryType,
  Material,
  OpnameRequest,
  StockBalance,
  StockLedgerEntry,
  UserRole,
} from '../../types/models';
import { assertNonNegativeInt, isValidDateStr } from '../../utils/format';

export async function fetchStockBalances(pageLimit = 200): Promise<FetchResult<StockBalance>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'stock_balances'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, (id, d) => ({
    id,
    itemId: String(d.itemId ?? id),
    itemType: (d.itemType ?? 'material') as 'material' | 'product' | 'wip',
    qty: Number(d.qty ?? 0),
    lastLedgerId: String(d.lastLedgerId ?? ''),
    updatedAt: d.updatedAt,
  }));
}

export async function fetchAllStockBalancesPaginated() {
  return fetchCollectionPaginated<StockBalance>({
    collectionName: 'stock_balances',
    mapper: (id, d) => ({
      id,
      itemId: String(d.itemId ?? id),
      itemType: (d.itemType ?? 'material') as 'material' | 'product' | 'wip',
      qty: Number(d.qty ?? 0),
      lastLedgerId: String(d.lastLedgerId ?? ''),
      updatedAt: d.updatedAt,
    }),
  });
}

export async function fetchAllStockLedgerPaginated(minDate?: string) {
  return fetchCollectionPaginated<StockLedgerEntry>({
    collectionName: 'stock_ledger',
    minDate,
    mapper: (id, d) => ({
      id,
      itemId: String(d.itemId ?? ''),
      itemType: (d.itemType ?? 'material') as 'material' | 'product' | 'wip',
      jenis: d.jenis as LedgerEntryType,
      qty: Number(d.qty ?? 0),
      tanggal: String(d.tanggal ?? ''),
      refType: String(d.refType ?? ''),
      refId: String(d.refId ?? ''),
      catatan: String(d.catatan ?? ''),
      balance_before: Number(d.balance_before ?? 0),
      balance_after: Number(d.balance_after ?? 0),
      createdBy: String(d.createdBy ?? ''),
      createdByName: d.createdByName ? String(d.createdByName) : undefined,
      createdAt: d.createdAt,
    }),
  });
}

export interface PaginatedLedgerResult extends FetchResult<StockLedgerEntry> {
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

export async function fetchStockLedger(params: {
  itemId?: string;
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
}): Promise<PaginatedLedgerResult> {
  const db = getFirebaseDb();
  const pageSize = params.pageSize ?? 25;
  const constraints = [];
  if (params.itemId) {
    constraints.push(where('itemId', '==', params.itemId));
  }
  constraints.push(orderBy('createdAt', 'desc'));
  if (params.cursor) {
    constraints.push(startAfter(params.cursor));
  }
  constraints.push(limit(pageSize));

  const mapLedger = (docSnap: QueryDocumentSnapshot<DocumentData>): StockLedgerEntry => {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      itemId: String(d.itemId ?? ''),
      itemType: (d.itemType ?? 'material') as 'material' | 'product' | 'wip',
      jenis: d.jenis as LedgerEntryType,
      qty: Number(d.qty ?? 0),
      tanggal: String(d.tanggal ?? ''),
      refType: String(d.refType ?? ''),
      refId: String(d.refId ?? ''),
      catatan: String(d.catatan ?? ''),
      balance_before: Number(d.balance_before ?? 0),
      balance_after: Number(d.balance_after ?? 0),
      createdBy: String(d.createdBy ?? ''),
      createdByName: d.createdByName ? String(d.createdByName) : undefined,
      createdAt: d.createdAt,
    };
  };

  const q = query(collection(db, 'stock_ledger'), ...constraints);
  try {
    const snap = await getDocs(q);
    const items: StockLedgerEntry[] = snap.docs.map(mapLedger);
    return {
      items,
      fromCache: snap.metadata.fromCache,
      lastDoc: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
      hasMore: snap.docs.length === pageSize,
    };
  } catch (err) {
    if (!params.itemId || !isMissingIndexError(err)) throw err;
    const fallbackSnap = await getDocs(
      query(collection(db, 'stock_ledger'), where('itemId', '==', params.itemId), limit(500)),
    );
    const sorted = fallbackSnap.docs
      .map(mapLedger)
      .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
    return {
      items: sorted.slice(0, pageSize),
      fromCache: fallbackSnap.metadata.fromCache,
      lastDoc: null,
      hasMore: false,
    };
  }
}

export async function recordStockMutation(params: {
  actorUid: string;
  actorName?: string;
  actorRole: UserRole;
  itemId: string;
  itemType: 'material' | 'product' | 'wip';
  jenis: LedgerEntryType;
  qty: number;
  tanggal: string;
  refType: string;
  refId: string;
  catatan: string;
}): Promise<string> {
  assertOnlineForTransaction();
  if (!isValidDateStr(params.tanggal)) {
    throw new Error('Format tanggal harus YYYY-MM-DD.');
  }
  const db = getFirebaseDb();
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));
  const balRef = doc(db, 'stock_balances', params.itemId);
  const ledgerRef = doc(collection(db, 'stock_ledger'));

  await runTransaction(db, async (tx) => {
    const [periodSnap, balSnap] = await Promise.all([tx.get(periodRef), tx.get(balRef)]);
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    const currentQty = balSnap.exists() ? Number(balSnap.data().qty ?? 0) : 0;
    // Hanya produk jadi ('product') yang boleh minus; bahan & WIP wajib >= 0
    const { balanceBefore, balanceAfter } = validateStockChange({
      currentBalance: currentQty,
      deltaQty: params.qty,
      allowNegative: params.itemType === 'product',
    });

    tx.set(ledgerRef, {
      itemId: params.itemId,
      itemType: params.itemType,
      jenis: params.jenis,
      qty: params.qty,
      tanggal: params.tanggal,
      refType: params.refType,
      refId: params.refId,
      catatan: params.catatan.trim(),
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    tx.set(balRef, {
      itemId: params.itemId,
      itemType: params.itemType,
      qty: balanceAfter,
      lastLedgerId: ledgerRef.id,
      updatedAt: serverTimestamp(),
    });
  });

  return ledgerRef.id;
}

/**
 * Penerimaan bahan baku dengan pilihan satuan beli atau satuan pakai, plus opsional panjang/jumlah aktual
 * dan opsional pencatatan total harga pembelian (rupiah bulat) pada transaksi yang sama.
 */
export async function recordMaterialReceiptAtomic(params: {
  actorUid: string;
  actorName?: string;
  material: Material;
  unitMode: 'purchase' | 'usage';
  purchaseQty: number;
  actualUsageQty?: number | null;
  totalCost?: number | null;
  paidAmount?: number;
  supplierId?: string;
  accountId?: string;
  tanggal: string;
  refId: string;
  catatan: string;
}): Promise<{ ledgerId: string; usageQty: number; purchaseCostId?: string }> {
  assertOnlineForTransaction();
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal tidak valid.');

  const usageQty = computeReceivingUsageQty({
    purchaseQty: params.purchaseQty,
    unitMode: params.unitMode,
    konversi: params.material.konversi,
    actualUsageQty: params.actualUsageQty,
  });

  const hasCost = params.totalCost !== undefined && params.totalCost !== null;
  let totalCost = 0;
  let paidAmount = 0;
  if (hasCost) {
    totalCost = params.totalCost!;
    assertNonNegativeInt(totalCost, 'Total harga beli');
    paidAmount = params.paidAmount ?? 0;
    assertNonNegativeInt(paidAmount, 'Nominal dibayar');
    if (paidAmount > totalCost) throw new Error('Nominal dibayar melebihi total harga beli.');
    if (paidAmount > 0 && !params.accountId) throw new Error('Pilih akun kas/bank pembayaran.');
  }

  const db = getFirebaseDb();
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));
  const balRef = doc(db, 'stock_balances', params.material.id);
  const ledgerRef = doc(collection(db, 'stock_ledger'));
  const costRef = hasCost ? doc(collection(db, 'purchase_costs')) : null;
  const accRef = hasCost && paidAmount > 0 && params.accountId ? doc(db, 'accounts', params.accountId) : null;

  await runTransaction(db, async (tx) => {
    const [periodSnap, balSnap, accSnap] = await Promise.all([
      tx.get(periodRef),
      tx.get(balRef),
      accRef ? tx.get(accRef) : Promise.resolve(null),
    ]);
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }
    if (accRef && (!accSnap || !accSnap.exists())) {
      throw new Error('Akun kas/bank tidak ditemukan.');
    }

    const currentQty = balSnap.exists() ? Number(balSnap.data().qty ?? 0) : 0;
    const { balanceBefore, balanceAfter } = validateStockChange({
      currentBalance: currentQty,
      deltaQty: usageQty,
      allowNegative: false,
    });

    const unitLabel = params.unitMode === 'purchase' ? params.material.satuanBeli : params.material.satuanPakai;
    const detailNote = params.actualUsageQty
      ? `${params.purchaseQty} ${unitLabel} (aktual ${usageQty} ${params.material.satuanPakai})`
      : `${params.purchaseQty} ${unitLabel} = ${usageQty} ${params.material.satuanPakai}`;

    tx.set(ledgerRef, {
      itemId: params.material.id,
      itemType: 'material',
      jenis: 'penerimaan',
      qty: usageQty,
      tanggal: params.tanggal,
      refType: 'penerimaan_bahan',
      refId: params.refId.trim() || `TRM-${params.tanggal}`,
      catatan: params.catatan.trim() ? `${detailNote} · ${params.catatan.trim()}` : detailNote,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    tx.set(balRef, {
      itemId: params.material.id,
      itemType: 'material',
      qty: balanceAfter,
      lastLedgerId: ledgerRef.id,
      updatedAt: serverTimestamp(),
    });

    if (hasCost && costRef) {
      const unitCostFloat = totalCost / usageQty;
      tx.set(costRef, {
        ledgerId: ledgerRef.id,
        itemId: params.material.id,
        supplierId: params.supplierId ?? '',
        qty: usageQty,
        unitCost: unitCostFloat,
        totalCost,
        paidAmount,
        accountId: params.accountId ?? '',
        purchaseQty: params.purchaseQty,
        purchaseUnit: unitLabel,
        ...(params.actualUsageQty ? { actualUsageQty: params.actualUsageQty } : {}),
        tanggal: params.tanggal,
        catatan: params.catatan.trim() || detailNote,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        createdAt: serverTimestamp(),
      });

      if (paidAmount > 0 && accRef && accSnap) {
        const prevSaldo = Number(accSnap.data()!.saldoBerjalan ?? 0);
        const nextSaldo = prevSaldo - paidAmount;
        const auditRef = doc(collection(db, 'audit_logs'));
        tx.update(accRef, {
          saldoBerjalan: nextSaldo,
          lastAuditLogId: auditRef.id,
        });
        tx.set(auditRef, {
          uid: params.actorUid,
          createdBy: params.actorUid,
          ...(params.actorName ? { createdByName: params.actorName } : {}),
          aksi: 'PURCHASE_COST_CASH_OUT',
          targetCollection: 'accounts',
          targetId: accRef.id,
          sebelum: JSON.stringify({ saldoBerjalan: prevSaldo }),
          sesudah: JSON.stringify({ saldoBerjalan: nextSaldo, purchaseCostId: costRef.id }),
          createdAt: serverTimestamp(),
        });
      }

      tx.set(doc(collection(db, 'journal_entries')), {
        tanggal: params.tanggal,
        source: 'purchase_cost',
        refId: costRef.id,
        debitAccount: 'persediaan_bahan',
        creditAccount: paidAmount >= totalCost ? 'kas_bank' : 'utang_supplier',
        amount: totalCost,
        deskripsi: `Pembelian ${params.material.nama} (${detailNote})`,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        createdAt: serverTimestamp(),
      });
    }
  });

  return {
    ledgerId: ledgerRef.id,
    usageQty,
    purchaseCostId: costRef?.id,
  };
}

export async function fetchOpnameRequests(pageLimit = 50): Promise<FetchResult<OpnameRequest>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'opname_requests'), orderBy('createdAt', 'desc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, (id, d) => ({
    id,
    itemId: String(d.itemId ?? ''),
    itemType: (d.itemType ?? 'material') as 'material' | 'product',
    systemQty: Number(d.systemQty ?? 0),
    physicalQty: Number(d.physicalQty ?? 0),
    diffQty: Number(d.diffQty ?? 0),
    alasan: String(d.alasan ?? ''),
    tanggal: String(d.tanggal ?? ''),
    status: (d.status ?? 'pending') as 'pending' | 'approved' | 'rejected',
    createdBy: String(d.createdBy ?? ''),
    createdByName: d.createdByName ? String(d.createdByName) : undefined,
    createdAt: d.createdAt,
    approvedBy: d.approvedBy ? String(d.approvedBy) : undefined,
    approvedAt: d.approvedAt,
  }));
}

export async function submitOpnameRequest(params: {
  actorUid: string;
  actorName?: string;
  itemId: string;
  itemType: 'material' | 'product';
  systemQty: number;
  physicalQty: number;
  alasan: string;
  tanggal: string;
}): Promise<string> {
  assertOnlineForTransaction();
  assertNonNegativeInt(params.physicalQty, 'Stok fisik');
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal tidak valid.');
  const db = getFirebaseDb();
  const ref = doc(collection(db, 'opname_requests'));
  await setDoc(ref, {
    itemId: params.itemId,
    itemType: params.itemType,
    systemQty: params.systemQty,
    physicalQty: params.physicalQty,
    diffQty: params.physicalQty - params.systemQty,
    alasan: params.alasan.trim(),
    tanggal: params.tanggal,
    status: 'pending',
    createdBy: params.actorUid,
    ...(params.actorName ? { createdByName: params.actorName } : {}),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function resolveOpnameRequest(params: {
  actorUid: string;
  actorName?: string;
  opnameId: string;
  decision: 'approved' | 'rejected';
}): Promise<void> {
  assertOnlineForTransaction();
  const db = getFirebaseDb();
  const opnameRef = doc(db, 'opname_requests', params.opnameId);

  await runTransaction(db, async (tx) => {
    const opSnap = await tx.get(opnameRef);
    if (!opSnap.exists()) throw new Error('Pengajuan opname tidak ditemukan.');
    const opData = opSnap.data();
    if (opData.status !== 'pending') {
      throw new Error('Pengajuan opname sudah diproses sebelumnya.');
    }

    const tanggal = String(opData.tanggal);
    const periodRef = doc(db, 'periods', tanggal.slice(0, 7));
    const itemId = String(opData.itemId);
    const balRef = doc(db, 'stock_balances', itemId);

    const [periodSnap, balSnap] = await Promise.all([tx.get(periodRef), tx.get(balRef)]);
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${tanggal.slice(0, 7)} sudah ditutup.`);
    }

    const currentQty = balSnap.exists() ? Number(balSnap.data().qty ?? 0) : 0;
    const physicalQty = Number(opData.physicalQty ?? 0);
    const diffQty = physicalQty - currentQty;

    if (params.decision === 'approved' && diffQty !== 0) {
      const ledgerRef = doc(collection(db, 'stock_ledger'));
      tx.set(ledgerRef, {
        itemId,
        itemType: opData.itemType,
        jenis: 'opname_koreksi',
        qty: diffQty,
        tanggal,
        refType: 'opname',
        refId: params.opnameId,
        catatan: `Approval opname: ${String(opData.alasan ?? '')}`,
        balance_before: currentQty,
        balance_after: physicalQty,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        createdAt: serverTimestamp(),
      });

      tx.set(balRef, {
        itemId,
        itemType: opData.itemType,
        qty: physicalQty,
        lastLedgerId: ledgerRef.id,
        updatedAt: serverTimestamp(),
      });
    }

    tx.update(opnameRef, {
      status: params.decision,
      approvedBy: params.actorUid,
      approvedAt: serverTimestamp(),
    });

    const auditRef = doc(collection(db, 'audit_logs'));
    tx.set(auditRef, {
      uid: params.actorUid,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      aksi: params.decision === 'approved' ? 'APPROVE_OPNAME' : 'REJECT_OPNAME',
      targetCollection: 'opname_requests',
      targetId: params.opnameId,
      sebelum: JSON.stringify({ status: 'pending', currentQty }),
      sesudah: JSON.stringify({ status: params.decision, physicalQty, diffQty }),
      createdAt: serverTimestamp(),
    });
  });
}
