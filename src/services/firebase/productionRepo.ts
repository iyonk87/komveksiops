import {
  collection,
  collectionGroup,
  doc,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { getFirebaseDb } from './config';
import {
  assertOnlineForTransaction,
  fetchCollectionPaginated,
  fetchDocWithCacheFlag,
  fetchQueryWithCacheFlag,
  isMissingIndexError,
  timestampToMillis,
  type FetchResult,
} from './common';
import {
  calculateBomRequirements,
  computeWipTransition,
  splitBomRequirementsIntoChunks,
  validateStockChange,
} from '../domain/accounting';
import type {
  BomItem,
  ProductionStage,
  StageLog,
  UserRole,
  WorkOrder,
  WorkOrderStage,
  WorkOrderStatus,
} from '../../types/models';
import { assertPositiveInt, isValidDateStr } from '../../utils/format';

export const WO_CUT_CHUNK_SIZE = 4; // Maks 4 bahan + 1 WIP per tx agar total get/getAfter rules < 20

function mapWorkOrder(id: string, d: Record<string, unknown>): WorkOrder {
  return {
    id,
    woNumber: String(d.woNumber ?? ''),
    productId: String(d.productId ?? ''),
    targetQty: Number(d.targetQty ?? 0),
    completedQty: Number(d.completedQty ?? 0),
    wipQty: Number(d.wipQty ?? 0),
    rejectedQty: d.rejectedQty !== undefined ? Number(d.rejectedQty) : 0,
    cutCompleted: d.cutCompleted !== undefined ? Boolean(d.cutCompleted) : true,
    cutMaterialIds: Array.isArray(d.cutMaterialIds) ? d.cutMaterialIds.map(String) : undefined,
    hppPerPcsSnapshot:
      d.hppPerPcsSnapshot !== undefined ? Number(d.hppPerPcsSnapshot) : undefined,
    currentStage: (d.currentStage ?? 'potong') as WorkOrderStage,
    status: (d.status ?? 'in_progress') as WorkOrderStatus,
    tanggal: String(d.tanggal ?? ''),
    catatan: String(d.catatan ?? ''),
    createdBy: String(d.createdBy ?? ''),
    createdByName: d.createdByName ? String(d.createdByName) : undefined,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    completedAt: d.completedAt,
  };
}

export async function fetchWorkOrders(pageLimit = 50): Promise<FetchResult<WorkOrder>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'work_orders'), orderBy('createdAt', 'desc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, mapWorkOrder);
}

export async function fetchAllWorkOrdersPaginated(minDate?: string) {
  return fetchCollectionPaginated<WorkOrder>({
    collectionName: 'work_orders',
    minDate,
    mapper: mapWorkOrder,
  });
}

export async function fetchWorkOrderById(woId: string): Promise<WorkOrder | null> {
  const res = await fetchDocWithCacheFlag(doc(getFirebaseDb(), 'work_orders', woId), mapWorkOrder);
  return res.item;
}

export async function fetchStageLogs(woId: string, pageLimit = 100): Promise<FetchResult<StageLog>> {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'work_orders', woId, 'stage_logs'),
    orderBy('createdAt', 'asc'),
    limit(pageLimit),
  );
  return fetchQueryWithCacheFlag(q, (id, d) => ({
    id,
    woId,
    stage: d.stage as ProductionStage,
    inputQty: Number(d.inputQty ?? 0),
    goodQty: Number(d.goodQty ?? 0),
    rejectQty: Number(d.rejectQty ?? 0),
    reworkQty: Number(d.reworkQty ?? 0),
    rejectReason: String(d.rejectReason ?? ''),
    tanggal: String(d.tanggal ?? ''),
    createdBy: String(d.createdBy ?? ''),
    createdByName: d.createdByName ? String(d.createdByName) : undefined,
    createdAt: d.createdAt,
  }));
}

export async function fetchRecentStageLogs(pageLimit = 100): Promise<FetchResult<StageLog>> {
  const db = getFirebaseDb();
  const q = query(collectionGroup(db, 'stage_logs'), orderBy('createdAt', 'desc'), limit(pageLimit));
  try {
    return await fetchQueryWithCacheFlag(q, (id, d) => ({
      id,
      stage: d.stage as ProductionStage,
      inputQty: Number(d.inputQty ?? 0),
      goodQty: Number(d.goodQty ?? 0),
      rejectQty: Number(d.rejectQty ?? 0),
      reworkQty: Number(d.reworkQty ?? 0),
      rejectReason: String(d.rejectReason ?? ''),
      tanggal: String(d.tanggal ?? ''),
      createdBy: String(d.createdBy ?? ''),
      createdAt: d.createdAt,
    }));
  } catch (err) {
    if (!isMissingIndexError(err)) throw err;
    const woRes = await fetchWorkOrders(25);
    const logBatches = await Promise.all(woRes.items.map((wo) => fetchStageLogs(wo.id, 50)));
    const combined = logBatches
      .flatMap((res) => res.items)
      .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt))
      .slice(0, pageLimit);
    return {
      items: combined,
      fromCache: woRes.fromCache || logBatches.some((b) => b.fromCache),
    };
  }
}

export interface WoCutProgress {
  woId: string;
  doneMaterials: number;
  totalMaterials: number;
  completed: boolean;
}

/**
 * Menjalankan satu chunk pemotongan bahan untuk WO yang sudah dibuat, secara idempoten.
 * Bahan yang sudah ada di wo.cutMaterialIds dilewati otomatis.
 * Saat seluruh bahan selesai terpotong, mencatat wip_masuk dan mengaktifkan WIP batch.
 */
export async function executeWorkOrderCutChunk(params: {
  actorUid: string;
  actorName?: string;
  woId: string;
  bomItems: BomItem[];
  chunkMaterialIds?: string[];
}): Promise<WoCutProgress> {
  assertOnlineForTransaction();
  const db = getFirebaseDb();
  const woRef = doc(db, 'work_orders', params.woId);

  let result: WoCutProgress = {
    woId: params.woId,
    doneMaterials: 0,
    totalMaterials: 0,
    completed: false,
  };

  await runTransaction(db, async (tx) => {
    const woSnap = await tx.get(woRef);
    if (!woSnap.exists()) throw new Error('Work Order tidak ditemukan.');
    const wo = woSnap.data();
    if (wo.status === 'cancelled') throw new Error('Work Order sudah dibatalkan.');

    const tanggal = String(wo.tanggal ?? '');
    const periodSnap = await tx.get(doc(db, 'periods', tanggal.slice(0, 7)));
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${tanggal.slice(0, 7)} sudah ditutup.`);
    }

    if (wo.cutCompleted === true) {
      const reqsAll = calculateBomRequirements(
        params.bomItems,
        String(wo.productId),
        Number(wo.targetQty),
      );
      result = {
        woId: params.woId,
        doneMaterials: reqsAll.length,
        totalMaterials: reqsAll.length,
        completed: true,
      };
      return;
    }

    const targetQty = Number(wo.targetQty ?? 0);
    const productId = String(wo.productId ?? '');
    const woNumber = String(wo.woNumber ?? '');
    const allReqs = calculateBomRequirements(params.bomItems, productId, targetQty);
    const alreadyCut = new Set<string>(Array.isArray(wo.cutMaterialIds) ? wo.cutMaterialIds.map(String) : []);
    const remainingReqs = allReqs.filter((r) => !alreadyCut.has(r.materialId));

    const batchReqs = params.chunkMaterialIds
      ? remainingReqs.filter((r) => params.chunkMaterialIds!.includes(r.materialId)).slice(0, WO_CUT_CHUNK_SIZE)
      : remainingReqs.slice(0, WO_CUT_CHUNK_SIZE);

    const willFinishCut = alreadyCut.size + batchReqs.length >= allReqs.length;
    const wipItemId = `wip-${params.woId}`;

    const balSnaps = await Promise.all([
      ...batchReqs.map((req) => tx.get(doc(db, 'stock_balances', req.materialId))),
      ...(willFinishCut ? [tx.get(doc(db, 'stock_balances', wipItemId))] : []),
    ]);

    batchReqs.forEach((req, idx) => {
      const balSnap = balSnaps[idx];
      const currentQty = balSnap.exists() ? Number(balSnap.data().qty ?? 0) : 0;
      // Bahan baku TIDAK BOLEH minus
      const { balanceBefore, balanceAfter } = validateStockChange({
        currentBalance: currentQty,
        deltaQty: -req.requiredQty,
        allowNegative: false,
      });

      const ledgerRef = doc(collection(db, 'stock_ledger'));
      tx.set(ledgerRef, {
        itemId: req.materialId,
        itemType: 'material',
        jenis: 'pemakaian_produksi',
        qty: -req.requiredQty,
        tanggal,
        refType: 'work_order',
        refId: params.woId,
        catatan: `Potong bahan Resep ${woNumber}`,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        createdAt: serverTimestamp(),
      });

      tx.set(doc(db, 'stock_balances', req.materialId), {
        itemId: req.materialId,
        itemType: 'material',
        qty: balanceAfter,
        lastLedgerId: ledgerRef.id,
        updatedAt: serverTimestamp(),
      });

      alreadyCut.add(req.materialId);
    });

    if (willFinishCut) {
      const wipSnap = balSnaps[batchReqs.length];
      const currentWipBal = wipSnap?.exists() ? Number(wipSnap.data().qty ?? 0) : 0;
      const { balanceBefore, balanceAfter } = validateStockChange({
        currentBalance: currentWipBal,
        deltaQty: targetQty,
        allowNegative: false,
      });

      const wipLedgerRef = doc(collection(db, 'stock_ledger'));
      tx.set(wipLedgerRef, {
        itemId: wipItemId,
        itemType: 'wip',
        jenis: 'wip_masuk',
        qty: targetQty,
        tanggal,
        refType: 'work_order',
        refId: params.woId,
        catatan: `Masuk WIP potong ${woNumber}`,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        createdAt: serverTimestamp(),
      });

      tx.set(doc(db, 'stock_balances', wipItemId), {
        itemId: wipItemId,
        itemType: 'wip',
        qty: balanceAfter,
        lastLedgerId: wipLedgerRef.id,
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(collection(db, 'work_orders', params.woId, 'stage_logs')), {
        stage: 'potong',
        inputQty: targetQty,
        goodQty: targetQty,
        rejectQty: 0,
        reworkQty: 0,
        rejectReason: '',
        tanggal,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        createdAt: serverTimestamp(),
      });
    }

    tx.update(woRef, {
      cutMaterialIds: Array.from(alreadyCut),
      cutCompleted: willFinishCut,
      wipQty: willFinishCut ? targetQty : 0,
      currentStage: willFinishCut ? 'setoran' : 'potong',
      status: 'in_progress',
      updatedAt: serverTimestamp(),
    });

    result = {
      woId: params.woId,
      doneMaterials: alreadyCut.size,
      totalMaterials: allReqs.length,
      completed: willFinishCut,
    };
  });

  return result;
}

/**
 * Membuat Work Order baru lalu memotong seluruh bahan Resep secara bertahap (chunk <= 4 bahan/tx)
 * sehingga Resep dengan > 6 bahan tetap berjalan tanpa melebihi batas 20 get() Firestore Rules.
 */
export async function createWorkOrderWithBom(params: {
  actorUid: string;
  actorName?: string;
  actorRole: UserRole;
  woNumber: string;
  productId: string;
  targetQty: number;
  tanggal: string;
  catatan: string;
  bomItems: BomItem[];
  hppPerPcsSnapshot?: number;
  onProgress?: (progress: WoCutProgress) => void;
}): Promise<string> {
  assertOnlineForTransaction();
  assertPositiveInt(params.targetQty, 'Target produksi');
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal tidak valid.');

  const requirements = calculateBomRequirements(params.bomItems, params.productId, params.targetQty);
  const db = getFirebaseDb();
  const woRef = doc(collection(db, 'work_orders'));
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));

  await runTransaction(db, async (tx) => {
    const periodSnap = await tx.get(periodRef);
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    tx.set(woRef, {
      woNumber: params.woNumber.trim(),
      productId: params.productId,
      targetQty: params.targetQty,
      completedQty: 0,
      wipQty: 0,
      rejectedQty: 0,
      cutCompleted: false,
      cutMaterialIds: [],
      ...(params.hppPerPcsSnapshot !== undefined ? { hppPerPcsSnapshot: Math.round(params.hppPerPcsSnapshot) } : {}),
      currentStage: 'potong',
      status: 'in_progress',
      tanggal: params.tanggal,
      catatan: params.catatan.trim(),
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });
  });

  if (requirements.length === 0) {
    const progress = await executeWorkOrderCutChunk({
      actorUid: params.actorUid,
      actorName: params.actorName,
      woId: woRef.id,
      bomItems: params.bomItems,
    });
    params.onProgress?.(progress);
    return woRef.id;
  }

  const chunks = splitBomRequirementsIntoChunks(requirements, WO_CUT_CHUNK_SIZE);
  for (const chunk of chunks) {
    const progress = await executeWorkOrderCutChunk({
      actorUid: params.actorUid,
      actorName: params.actorName,
      woId: woRef.id,
      bomItems: params.bomItems,
      chunkMaterialIds: chunk.map((c) => c.materialId),
    });
    params.onProgress?.(progress);
  }

  return woRef.id;
}

/**
 * Melanjutkan pemotongan bahan WO yang terhenti di tengah jalan secara idempoten.
 */
export async function resumeWorkOrderCut(params: {
  actorUid: string;
  actorName?: string;
  wo: WorkOrder;
  bomItems: BomItem[];
  onProgress?: (progress: WoCutProgress) => void;
}): Promise<WoCutProgress> {
  const requirements = calculateBomRequirements(params.bomItems, params.wo.productId, params.wo.targetQty);
  const doneSet = new Set(params.wo.cutMaterialIds ?? []);
  const pending = requirements.filter((r) => !doneSet.has(r.materialId));
  let lastProgress: WoCutProgress = {
    woId: params.wo.id,
    doneMaterials: doneSet.size,
    totalMaterials: requirements.length,
    completed: Boolean(params.wo.cutCompleted),
  };

  if (pending.length === 0 && !params.wo.cutCompleted) {
    lastProgress = await executeWorkOrderCutChunk({
      actorUid: params.actorUid,
      actorName: params.actorName,
      woId: params.wo.id,
      bomItems: params.bomItems,
    });
    params.onProgress?.(lastProgress);
    return lastProgress;
  }

  const chunks = splitBomRequirementsIntoChunks(pending, WO_CUT_CHUNK_SIZE);
  for (const chunk of chunks) {
    lastProgress = await executeWorkOrderCutChunk({
      actorUid: params.actorUid,
      actorName: params.actorName,
      woId: params.wo.id,
      bomItems: params.bomItems,
      chunkMaterialIds: chunk.map((c) => c.materialId),
    });
    params.onProgress?.(lastProgress);
  }

  return lastProgress;
}

/**
 * Mencatat Setoran Barang Jadi bertahap dari sisa WIP ke gudang barang jadi.
 */
export async function recordWorkOrderSetoran(params: {
  actorUid: string;
  actorName?: string;
  woId: string;
  setoranQty: number;
  tanggal: string;
  catatan?: string;
}): Promise<void> {
  assertOnlineForTransaction();
  assertPositiveInt(params.setoranQty, 'Jumlah setoran');
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal tidak valid.');

  const db = getFirebaseDb();
  const woRef = doc(db, 'work_orders', params.woId);
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));
  const wipItemId = `wip-${params.woId}`;
  const wipBalRef = doc(db, 'stock_balances', wipItemId);

  await runTransaction(db, async (tx) => {
    const [woSnap, periodSnap, wipBalSnap] = await Promise.all([
      tx.get(woRef),
      tx.get(periodRef),
      tx.get(wipBalRef),
    ]);
    if (!woSnap.exists()) throw new Error('Work Order tidak ditemukan.');
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    const wo = woSnap.data();
    if (wo.status === 'cancelled' || wo.status === 'completed') {
      throw new Error('Work Order sudah selesai atau dibatalkan.');
    }
    if (wo.cutCompleted === false) {
      throw new Error('Pemotongan bahan WO belum selesai. Lanjutkan potong bahan terlebih dahulu.');
    }

    const currentWip = Number(wo.wipQty ?? 0);
    const transition = computeWipTransition({
      stage: 'setoran',
      currentWipQty: currentWip,
      inputQty: params.setoranQty,
      goodQty: params.setoranQty,
      rejectQty: 0,
      reworkQty: 0,
    });

    const productId = String(wo.productId);
    const productBalRef = doc(db, 'stock_balances', productId);
    const productBalSnap = await tx.get(productBalRef);

    // Kurangi stok WIP (tidak boleh minus)
    const currentWipBal = wipBalSnap.exists() ? Number(wipBalSnap.data().qty ?? 0) : currentWip;
    const wipDelta = validateStockChange({
      currentBalance: currentWipBal,
      deltaQty: -params.setoranQty,
      allowNegative: false,
    });
    const wipLedgerRef = doc(collection(db, 'stock_ledger'));
    tx.set(wipLedgerRef, {
      itemId: wipItemId,
      itemType: 'wip',
      jenis: 'wip_keluar',
      qty: -params.setoranQty,
      tanggal: params.tanggal,
      refType: 'work_order',
      refId: params.woId,
      catatan: `Setoran ${String(wo.woNumber)}${params.catatan ? ` · ${params.catatan.trim()}` : ''}`,
      balance_before: wipDelta.balanceBefore,
      balance_after: wipDelta.balanceAfter,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });
    tx.set(wipBalRef, {
      itemId: wipItemId,
      itemType: 'wip',
      qty: wipDelta.balanceAfter,
      lastLedgerId: wipLedgerRef.id,
      updatedAt: serverTimestamp(),
    });

    // Tambah stok Barang Jadi
    const currentProdQty = productBalSnap.exists() ? Number(productBalSnap.data().qty ?? 0) : 0;
    const prodDelta = validateStockChange({
      currentBalance: currentProdQty,
      deltaQty: params.setoranQty,
      allowNegative: true, // Bila sebelumnya minus akibat penjualan duluan, tetap bisa naik
    });
    const prodLedgerRef = doc(collection(db, 'stock_ledger'));
    tx.set(prodLedgerRef, {
      itemId: productId,
      itemType: 'product',
      jenis: 'hasil_produksi',
      qty: params.setoranQty,
      tanggal: params.tanggal,
      refType: 'work_order',
      refId: params.woId,
      catatan: `Setoran gudang ${String(wo.woNumber)}`,
      balance_before: prodDelta.balanceBefore,
      balance_after: prodDelta.balanceAfter,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });
    tx.set(productBalRef, {
      itemId: productId,
      itemType: 'product',
      qty: prodDelta.balanceAfter,
      lastLedgerId: prodLedgerRef.id,
      updatedAt: serverTimestamp(),
    });

    tx.set(doc(collection(db, 'work_orders', params.woId, 'stage_logs')), {
      stage: 'setoran',
      inputQty: params.setoranQty,
      goodQty: params.setoranQty,
      rejectQty: 0,
      reworkQty: 0,
      rejectReason: params.catatan?.trim() ?? '',
      tanggal: params.tanggal,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    const newCompletedQty = Number(wo.completedQty ?? 0) + params.setoranQty;
    const isNowCompleted = transition.nextWipQty === 0;
    tx.update(woRef, {
      wipQty: transition.nextWipQty,
      completedQty: newCompletedQty,
      currentStage: isNowCompleted ? 'completed' : 'setoran',
      status: isNowCompleted ? 'completed' : 'in_progress',
      updatedAt: serverTimestamp(),
      ...(isNowCompleted ? { completedAt: serverTimestamp() } : {}),
    });
  });
}

/**
 * Mencatat Reject terpisah dari WIP: mengurangi WIP dan mencatat nilai bahan reject sebagai beban periode (bukan HPP).
 */
export async function recordWorkOrderReject(params: {
  actorUid: string;
  actorName?: string;
  woId: string;
  rejectQty: number;
  reason: string;
  tanggal: string;
  unitMaterialCostRupiah?: number;
}): Promise<void> {
  assertOnlineForTransaction();
  assertPositiveInt(params.rejectQty, 'Jumlah reject');
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal tidak valid.');
  if (!params.reason.trim()) throw new Error('Alasan reject wajib diisi.');

  const db = getFirebaseDb();
  const woRef = doc(db, 'work_orders', params.woId);
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));
  const wipItemId = `wip-${params.woId}`;
  const wipBalRef = doc(db, 'stock_balances', wipItemId);

  await runTransaction(db, async (tx) => {
    const [woSnap, periodSnap, wipBalSnap] = await Promise.all([
      tx.get(woRef),
      tx.get(periodRef),
      tx.get(wipBalRef),
    ]);
    if (!woSnap.exists()) throw new Error('Work Order tidak ditemukan.');
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    const wo = woSnap.data();
    if (wo.status === 'cancelled' || wo.status === 'completed') {
      throw new Error('Work Order sudah selesai atau dibatalkan.');
    }
    if (wo.cutCompleted === false) {
      throw new Error('Pemotongan bahan WO belum selesai.');
    }

    const currentWip = Number(wo.wipQty ?? 0);
    const transition = computeWipTransition({
      stage: 'reject',
      currentWipQty: currentWip,
      inputQty: params.rejectQty,
      goodQty: 0,
      rejectQty: params.rejectQty,
      reworkQty: 0,
    });

    const currentWipBal = wipBalSnap.exists() ? Number(wipBalSnap.data().qty ?? 0) : currentWip;
    const wipDelta = validateStockChange({
      currentBalance: currentWipBal,
      deltaQty: -params.rejectQty,
      allowNegative: false,
    });

    const wipLedgerRef = doc(collection(db, 'stock_ledger'));
    tx.set(wipLedgerRef, {
      itemId: wipItemId,
      itemType: 'wip',
      jenis: 'wip_keluar',
      qty: -params.rejectQty,
      tanggal: params.tanggal,
      refType: 'work_order_reject',
      refId: params.woId,
      catatan: `Reject ${String(wo.woNumber)}: ${params.reason.trim()}`,
      balance_before: wipDelta.balanceBefore,
      balance_after: wipDelta.balanceAfter,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });
    tx.set(wipBalRef, {
      itemId: wipItemId,
      itemType: 'wip',
      qty: wipDelta.balanceAfter,
      lastLedgerId: wipLedgerRef.id,
      updatedAt: serverTimestamp(),
    });

    const logRef = doc(collection(db, 'work_orders', params.woId, 'stage_logs'));
    tx.set(logRef, {
      stage: 'reject',
      inputQty: params.rejectQty,
      goodQty: 0,
      rejectQty: params.rejectQty,
      reworkQty: 0,
      rejectReason: params.reason.trim(),
      tanggal: params.tanggal,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    const nextRejectedQty = Number(wo.rejectedQty ?? 0) + params.rejectQty;
    const isNowCompleted = transition.nextWipQty === 0;
    tx.update(woRef, {
      wipQty: transition.nextWipQty,
      rejectedQty: nextRejectedQty,
      currentStage: isNowCompleted ? 'completed' : 'setoran',
      status: isNowCompleted ? 'completed' : 'in_progress',
      updatedAt: serverTimestamp(),
      ...(isNowCompleted ? { completedAt: serverTimestamp() } : {}),
    });

    const rejectCost = Math.round(
      Math.max(0, (params.unitMaterialCostRupiah ?? 0) * params.rejectQty),
    );
    if (rejectCost > 0) {
      tx.set(doc(collection(db, 'journal_entries')), {
        tanggal: params.tanggal,
        source: 'production_reject',
        refId: logRef.id,
        debitAccount: 'beban_reject',
        creditAccount: 'persediaan_wip',
        amount: rejectCost,
        deskripsi: `Reject produksi ${String(wo.woNumber)} (${params.rejectQty} pcs): ${params.reason.trim()}`,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        createdAt: serverTimestamp(),
      });
    }
  });
}

export async function recordWorkOrderStage(params: {
  actorUid: string;
  actorName?: string;
  woId: string;
  stage: ProductionStage;
  inputQty: number;
  goodQty: number;
  rejectQty: number;
  reworkQty: number;
  rejectReason: string;
  tanggal: string;
}): Promise<void> {
  if (params.stage === 'setoran') {
    return recordWorkOrderSetoran({
      actorUid: params.actorUid,
      actorName: params.actorName,
      woId: params.woId,
      setoranQty: params.goodQty,
      tanggal: params.tanggal,
      catatan: params.rejectReason,
    });
  }
  if (params.stage === 'reject') {
    return recordWorkOrderReject({
      actorUid: params.actorUid,
      actorName: params.actorName,
      woId: params.woId,
      rejectQty: params.rejectQty,
      reason: params.rejectReason || 'Reject produksi',
      tanggal: params.tanggal,
    });
  }

  assertOnlineForTransaction();
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal tidak valid.');

  const db = getFirebaseDb();
  const woRef = doc(db, 'work_orders', params.woId);
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));

  await runTransaction(db, async (tx) => {
    const [woSnap, periodSnap] = await Promise.all([tx.get(woRef), tx.get(periodRef)]);
    if (!woSnap.exists()) throw new Error('Work Order tidak ditemukan.');
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    const wo = woSnap.data();
    if (wo.status === 'cancelled' || wo.status === 'completed') {
      throw new Error('Work Order sudah selesai atau dibatalkan.');
    }

    const transition = computeWipTransition({
      stage: params.stage,
      currentWipQty: Number(wo.wipQty ?? 0),
      inputQty: params.inputQty,
      goodQty: params.goodQty,
      rejectQty: params.rejectQty,
      reworkQty: params.reworkQty,
    });

    let productBalSnap = null;
    const productId = String(wo.productId);
    const productBalRef = doc(db, 'stock_balances', productId);
    if (transition.finishedGoodsDelta > 0) {
      productBalSnap = await tx.get(productBalRef);
    }

    const stageLogRef = doc(collection(db, 'work_orders', params.woId, 'stage_logs'));
    tx.set(stageLogRef, {
      stage: params.stage,
      inputQty: params.inputQty,
      goodQty: params.goodQty,
      rejectQty: params.rejectQty,
      reworkQty: params.reworkQty,
      rejectReason: params.rejectReason.trim(),
      tanggal: params.tanggal,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    const newCompletedQty = Number(wo.completedQty ?? 0) + transition.finishedGoodsDelta;
    const isNowCompleted = transition.nextStage === 'completed' || newCompletedQty >= Number(wo.targetQty ?? 0);

    tx.update(woRef, {
      wipQty: transition.nextWipQty,
      completedQty: newCompletedQty,
      currentStage: isNowCompleted ? 'completed' : transition.nextStage,
      status: isNowCompleted ? 'completed' : 'in_progress',
      updatedAt: serverTimestamp(),
      ...(isNowCompleted ? { completedAt: serverTimestamp() } : {}),
    });

    if (transition.finishedGoodsDelta > 0 && productBalSnap) {
      const currentProdQty = productBalSnap.exists() ? Number(productBalSnap.data().qty ?? 0) : 0;
      const { balanceBefore, balanceAfter } = validateStockChange({
        currentBalance: currentProdQty,
        deltaQty: transition.finishedGoodsDelta,
        allowNegative: true,
      });

      const ledgerRef = doc(collection(db, 'stock_ledger'));
      tx.set(ledgerRef, {
        itemId: productId,
        itemType: 'product',
        jenis: 'hasil_produksi',
        qty: transition.finishedGoodsDelta,
        tanggal: params.tanggal,
        refType: 'work_order',
        refId: params.woId,
        catatan: `Hasil produksi ${String(wo.woNumber)}`,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        createdAt: serverTimestamp(),
      });

      tx.set(productBalRef, {
        itemId: productId,
        itemType: 'product',
        qty: balanceAfter,
        lastLedgerId: ledgerRef.id,
        updatedAt: serverTimestamp(),
      });
    }
  });
}

export async function cancelWorkOrderByOwner(params: {
  actorUid: string;
  actorName?: string;
  woId: string;
  woNumber: string;
}): Promise<void> {
  assertOnlineForTransaction();
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  batch.update(doc(db, 'work_orders', params.woId), {
    status: 'cancelled',
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, 'audit_logs')), {
    uid: params.actorUid,
    createdBy: params.actorUid,
    ...(params.actorName ? { createdByName: params.actorName } : {}),
    aksi: 'CANCEL_WORK_ORDER',
    targetCollection: 'work_orders',
    targetId: params.woId,
    sebelum: JSON.stringify({ woNumber: params.woNumber, status: 'in_progress' }),
    sesudah: JSON.stringify({ woNumber: params.woNumber, status: 'cancelled' }),
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}
