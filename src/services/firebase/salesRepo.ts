import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
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
import { validateStockChange } from '../domain/accounting';
import type { ValidatedMarketplaceImportRow } from '../domain/csv';
import type {
  MarketplaceChannel,
  MarketplaceMapping,
  MarketplacePayout,
  Payment,
  PaymentStatus,
  SalesChannel,
  SalesOrder,
  SalesOrderItem,
  SalesReturn,
  ShippingStatus,
  UserRole,
} from '../../types/models';
import { assertNonNegativeInt, assertPositiveInt, isValidDateStr } from '../../utils/format';

function mapSalesOrder(id: string, d: Record<string, unknown>): SalesOrder {
  return {
    id,
    soNumber: String(d.soNumber ?? ''),
    customerId: String(d.customerId ?? ''),
    customerName: String(d.customerName ?? ''),
    channel: String(d.channel ?? 'marketplace') as SalesChannel,
    noPesanan: d.noPesanan ? String(d.noPesanan) : undefined,
    totalAmount: Number(d.totalAmount ?? 0),
    biayaAdmin: d.biayaAdmin !== undefined ? Number(d.biayaAdmin) : undefined,
    komisiAffiliate: d.komisiAffiliate !== undefined ? Number(d.komisiAffiliate) : undefined,
    potonganLain: d.potonganLain !== undefined ? Number(d.potonganLain) : undefined,
    penerimaanBersih: d.penerimaanBersih !== undefined ? Number(d.penerimaanBersih) : undefined,
    paidAmount: Number(d.paidAmount ?? 0),
    paymentStatus: (d.paymentStatus ?? 'paid') as PaymentStatus,
    shippingStatus: (d.shippingStatus ?? 'pending') as ShippingStatus,
    status: (d.status ?? 'active') as 'active' | 'void',
    importKey: d.importKey ? String(d.importKey) : undefined,
    tanggal: String(d.tanggal ?? ''),
    catatan: String(d.catatan ?? ''),
    createdBy: String(d.createdBy ?? ''),
    createdByName: d.createdByName ? String(d.createdByName) : undefined,
    createdAt: d.createdAt,
  };
}

function mapPayment(id: string, d: Record<string, unknown>): Payment {
  return {
    id,
    soId: String(d.soId ?? ''),
    soNumber: String(d.soNumber ?? ''),
    accountId: String(d.accountId ?? ''),
    accountName: String(d.accountName ?? ''),
    amount: Number(d.amount ?? 0),
    tanggal: String(d.tanggal ?? ''),
    metode: String(d.metode ?? ''),
    catatan: String(d.catatan ?? ''),
    createdBy: String(d.createdBy ?? ''),
    createdByName: d.createdByName ? String(d.createdByName) : undefined,
    createdAt: d.createdAt,
  };
}

function mapSalesReturn(id: string, d: Record<string, unknown>): SalesReturn {
  return {
    id,
    soId: String(d.soId ?? ''),
    soNumber: String(d.soNumber ?? ''),
    productId: String(d.productId ?? ''),
    qty: Number(d.qty ?? 0),
    refundAmount: Number(d.refundAmount ?? 0),
    restockable: Boolean(d.restockable),
    alasan: String(d.alasan ?? ''),
    tanggal: String(d.tanggal ?? ''),
    createdBy: String(d.createdBy ?? ''),
    createdByName: d.createdByName ? String(d.createdByName) : undefined,
    createdAt: d.createdAt,
  };
}

function mapMarketplaceChannel(id: string, d: Record<string, unknown>): MarketplaceChannel {
  return {
    id,
    nama: String(d.nama ?? ''),
    balance: Number(d.balance ?? 0),
    active: Boolean(d.active),
    createdBy: String(d.createdBy ?? ''),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function mapMarketplacePayout(id: string, d: Record<string, unknown>): MarketplacePayout {
  return {
    id,
    channelId: String(d.channelId ?? ''),
    channelName: String(d.channelName ?? ''),
    accountId: String(d.accountId ?? ''),
    accountName: String(d.accountName ?? ''),
    amount: Number(d.amount ?? 0),
    tanggal: String(d.tanggal ?? ''),
    catatan: String(d.catatan ?? ''),
    createdBy: String(d.createdBy ?? ''),
    createdByName: d.createdByName ? String(d.createdByName) : undefined,
    createdAt: d.createdAt,
  };
}

// --- MARKETPLACE CHANNELS & MAPPINGS ---
export async function fetchMarketplaceChannels(): Promise<FetchResult<MarketplaceChannel>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'marketplace_channels'), orderBy('nama', 'asc'), limit(50));
  return fetchQueryWithCacheFlag(q, mapMarketplaceChannel);
}

export async function fetchAllMarketplaceChannelsPaginated() {
  return fetchCollectionPaginated<MarketplaceChannel>({
    collectionName: 'marketplace_channels',
    mapper: mapMarketplaceChannel,
  });
}

/**
 * Menjamin channel bawaan TikTok dan Shopee tersedia dengan saldo awal 0 bila belum ada.
 * Idempoten memakai ID dokumen deterministik.
 */
export async function ensureDefaultMarketplaceChannels(actorUid: string): Promise<MarketplaceChannel[]> {
  assertOnlineForTransaction();
  const db = getFirebaseDb();
  const defaults = [
    { id: 'tiktok', nama: 'TikTok' },
    { id: 'shopee', nama: 'Shopee' },
  ];

  for (const ch of defaults) {
    const ref = doc(db, 'marketplace_channels', ch.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        nama: ch.nama,
        balance: 0,
        active: true,
        createdBy: actorUid,
        createdAt: serverTimestamp(),
      });
    }
  }

  return (await fetchMarketplaceChannels()).items;
}

export async function saveMarketplaceChannel(params: {
  actorUid: string;
  nama: string;
}): Promise<string> {
  assertOnlineForTransaction();
  const cleanName = params.nama.trim();
  if (!cleanName) throw new Error('Nama channel marketplace wajib diisi.');
  const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const id = slug || `ch_${Date.now()}`;
  const db = getFirebaseDb();
  const ref = doc(db, 'marketplace_channels', id);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, {
      nama: cleanName,
      active: true,
      updatedAt: serverTimestamp(),
    });
    return id;
  }
  await setDoc(ref, {
    nama: cleanName,
    balance: 0,
    active: true,
    createdBy: params.actorUid,
    createdAt: serverTimestamp(),
  });
  return id;
}

export async function fetchMarketplaceMapping(channelId: string): Promise<MarketplaceMapping | null> {
  const res = await fetchDocWithCacheFlag(
    doc(getFirebaseDb(), 'marketplace_mappings', channelId),
    (id, d) => ({
      id,
      channelId: String(d.channelId ?? id),
      channelName: String(d.channelName ?? ''),
      mappingJson: String(d.mappingJson ?? '{}'),
      updatedBy: String(d.updatedBy ?? ''),
      updatedAt: d.updatedAt,
    }),
  );
  return res.item;
}

export async function saveMarketplaceMapping(params: {
  actorUid: string;
  channelId: string;
  channelName: string;
  mappingJson: string;
}): Promise<void> {
  assertOnlineForTransaction();
  const db = getFirebaseDb();
  await setDoc(doc(db, 'marketplace_mappings', params.channelId), {
    channelId: params.channelId,
    channelName: params.channelName,
    mappingJson: params.mappingJson,
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  });
}

export async function fetchMarketplacePayouts(pageLimit = 50): Promise<FetchResult<MarketplacePayout>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'marketplace_payouts'), orderBy('createdAt', 'desc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, mapMarketplacePayout);
}

export async function fetchAllMarketplacePayoutsPaginated(minDate?: string) {
  return fetchCollectionPaginated<MarketplacePayout>({
    collectionName: 'marketplace_payouts',
    minDate,
    mapper: mapMarketplacePayout,
  });
}

export async function recordMarketplacePayout(params: {
  actorUid: string;
  actorName?: string;
  channelId: string;
  accountId: string;
  accountName: string;
  amount: number;
  tanggal: string;
  catatan: string;
}): Promise<string> {
  assertOnlineForTransaction();
  assertPositiveInt(params.amount, 'Nominal pencairan');
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal tidak valid.');

  const db = getFirebaseDb();
  const chRef = doc(db, 'marketplace_channels', params.channelId);
  const accRef = doc(db, 'accounts', params.accountId);
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));
  const payoutRef = doc(collection(db, 'marketplace_payouts'));

  await runTransaction(db, async (tx) => {
    const [chSnap, accSnap, periodSnap] = await Promise.all([
      tx.get(chRef),
      tx.get(accRef),
      tx.get(periodRef),
    ]);
    if (!chSnap.exists()) throw new Error('Channel marketplace tidak ditemukan.');
    if (!accSnap.exists()) throw new Error('Akun kas/bank tujuan tidak ditemukan.');
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    const chBal = Number(chSnap.data().balance ?? 0);
    const chName = String(chSnap.data().nama ?? params.channelId);
    if (params.amount > chBal) {
      throw new Error(`Nominal pencairan (${params.amount}) melebihi Saldo Marketplace ${chName} (${chBal}).`);
    }

    tx.update(chRef, {
      balance: chBal - params.amount,
      updatedAt: serverTimestamp(),
    });

    const prevSaldo = Number(accSnap.data().saldoBerjalan ?? 0);
    const nextSaldo = prevSaldo + params.amount;
    const auditRef = doc(collection(db, 'audit_logs'));
    tx.update(accRef, {
      saldoBerjalan: nextSaldo,
      lastAuditLogId: auditRef.id,
    });
    tx.set(auditRef, {
      uid: params.actorUid,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      aksi: 'MARKETPLACE_PAYOUT_CASH_IN',
      targetCollection: 'accounts',
      targetId: params.accountId,
      sebelum: JSON.stringify({ saldoBerjalan: prevSaldo }),
      sesudah: JSON.stringify({ saldoBerjalan: nextSaldo, payoutId: payoutRef.id, channelId: params.channelId }),
      createdAt: serverTimestamp(),
    });

    tx.set(payoutRef, {
      channelId: params.channelId,
      channelName: chName,
      accountId: params.accountId,
      accountName: params.accountName,
      amount: params.amount,
      tanggal: params.tanggal,
      catatan: params.catatan.trim(),
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    tx.set(doc(collection(db, 'journal_entries')), {
      tanggal: params.tanggal,
      source: 'marketplace_payout',
      refId: payoutRef.id,
      accountId: params.accountId,
      debitAccount: 'kas_bank',
      creditAccount: 'saldo_marketplace',
      amount: params.amount,
      deskripsi: `Pencairan ${chName} ke ${params.accountName}`,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });
  });

  return payoutRef.id;
}

// --- SALES ORDERS, PAYMENTS & RETURNS ---
export async function fetchSalesOrders(pageLimit = 50): Promise<FetchResult<SalesOrder>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'sales_orders'), orderBy('createdAt', 'desc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, mapSalesOrder);
}

export async function fetchAllSalesOrdersPaginated(minDate?: string) {
  return fetchCollectionPaginated<SalesOrder>({
    collectionName: 'sales_orders',
    minDate,
    mapper: mapSalesOrder,
  });
}

export async function fetchSalesOrderById(soId: string): Promise<SalesOrder | null> {
  const res = await fetchDocWithCacheFlag(doc(getFirebaseDb(), 'sales_orders', soId), mapSalesOrder);
  return res.item;
}

export async function fetchSalesOrderItems(soId: string): Promise<SalesOrderItem[]> {
  const db = getFirebaseDb();
  const snap = await getDocs(collection(db, 'sales_orders', soId, 'items'));
  return snap.docs.map((docSnap) => {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      productId: String(d.productId ?? ''),
      productName: String(d.productName ?? ''),
      sku: String(d.sku ?? ''),
      qty: Number(d.qty ?? 0),
      unitPrice: Number(d.unitPrice ?? 0),
      subtotal: Number(d.subtotal ?? 0),
    };
  });
}

export async function fetchPayments(soId?: string, pageLimit = 50): Promise<FetchResult<Payment>> {
  const db = getFirebaseDb();
  if (!soId) {
    const q = query(collection(db, 'payments'), orderBy('createdAt', 'desc'), limit(pageLimit));
    return fetchQueryWithCacheFlag(q, mapPayment);
  }

  const q = query(collection(db, 'payments'), where('soId', '==', soId), orderBy('createdAt', 'desc'), limit(pageLimit));
  try {
    return await fetchQueryWithCacheFlag(q, mapPayment);
  } catch (err) {
    if (!isMissingIndexError(err)) throw err;
    const fallbackQ = query(collection(db, 'payments'), where('soId', '==', soId), limit(pageLimit));
    const res = await fetchQueryWithCacheFlag(fallbackQ, mapPayment);
    return {
      ...res,
      items: [...res.items].sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt)),
    };
  }
}

export async function fetchAllPaymentsPaginated(minDate?: string) {
  return fetchCollectionPaginated<Payment>({
    collectionName: 'payments',
    minDate,
    mapper: mapPayment,
  });
}

export async function fetchPaymentById(payId: string): Promise<Payment | null> {
  const res = await fetchDocWithCacheFlag(doc(getFirebaseDb(), 'payments', payId), mapPayment);
  return res.item;
}

export async function fetchSalesReturns(pageLimit = 50): Promise<FetchResult<SalesReturn>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'sales_returns'), orderBy('createdAt', 'desc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, mapSalesReturn);
}

export async function fetchAllSalesReturnsPaginated(minDate?: string) {
  return fetchCollectionPaginated<SalesReturn>({
    collectionName: 'sales_returns',
    minDate,
    mapper: mapSalesReturn,
  });
}

export async function fetchSalesReturnById(retId: string): Promise<SalesReturn | null> {
  const res = await fetchDocWithCacheFlag(doc(getFirebaseDb(), 'sales_returns', retId), mapSalesReturn);
  return res.item;
}

export interface SalesOrderLineInput {
  productId: string;
  productName: string;
  sku: string;
  qty: number;
  unitPrice: number;
}

export async function createSalesOrderAtomic(params: {
  actorUid: string;
  actorName?: string;
  actorRole: UserRole;
  soNumber: string;
  customerId?: string;
  customerName?: string;
  channel: SalesChannel;
  marketplaceChannelId?: string;
  noPesanan?: string;
  biayaAdmin?: number;
  komisiAffiliate?: number;
  potonganLain?: number;
  importKey?: string;
  tanggal: string;
  catatan: string;
  items: SalesOrderLineInput[];
  initialPayment: number;
  accountId?: string;
  accountName?: string;
}): Promise<string> {
  assertOnlineForTransaction();
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal tidak valid.');
  if (params.items.length === 0) throw new Error('Minimal 1 item penjualan wajib diisi.');
  assertNonNegativeInt(params.initialPayment, 'Pembayaran awal');

  const biayaAdmin = params.biayaAdmin ?? 0;
  const komisiAffiliate = params.komisiAffiliate ?? 0;
  const potonganLain = params.potonganLain ?? 0;
  assertNonNegativeInt(biayaAdmin, 'Biaya admin');
  assertNonNegativeInt(komisiAffiliate, 'Komisi affiliate');
  assertNonNegativeInt(potonganLain, 'Potongan lain');

  const qtyByProduct = new Map<string, number>();
  let totalAmount = 0;
  for (const item of params.items) {
    assertPositiveInt(item.qty, `Qty ${item.productName}`);
    assertNonNegativeInt(item.unitPrice, `Harga ${item.productName}`);
    totalAmount += item.qty * item.unitPrice;
    qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + item.qty);
  }

  if (qtyByProduct.size > 6) {
    throw new Error('Maksimal 6 item berbeda per transaksi, pecah menjadi beberapa pesanan.');
  }

  const isMarketplaceMode = Boolean(
    params.marketplaceChannelId ||
      params.noPesanan ||
      biayaAdmin > 0 ||
      komisiAffiliate > 0 ||
      potonganLain > 0,
  );
  const penerimaanBersih = isMarketplaceMode
    ? totalAmount - biayaAdmin - komisiAffiliate - potonganLain
    : undefined;
  if (penerimaanBersih !== undefined && penerimaanBersih < 0) {
    throw new Error('Penerimaan bersih marketplace tidak boleh negatif.');
  }

  if (params.initialPayment > totalAmount) {
    throw new Error('Pembayaran awal tidak boleh melebihi total Sales Order.');
  }
  if (params.initialPayment > 0 && !params.accountId) {
    throw new Error('Pilih akun kas/bank penerima pembayaran.');
  }

  const db = getFirebaseDb();
  const soRef = params.importKey
    ? doc(db, 'sales_orders', `mp_${params.importKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)}`)
    : doc(collection(db, 'sales_orders'));
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));
  const productIds = Array.from(qtyByProduct.keys());

  await runTransaction(db, async (tx) => {
    const periodSnap = await tx.get(periodRef);
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    const balSnaps = await Promise.all(
      productIds.map((pid) => tx.get(doc(db, 'stock_balances', pid))),
    );

    let accSnap = null;
    const accRef = params.accountId && params.initialPayment > 0 ? doc(db, 'accounts', params.accountId) : null;
    if (accRef) {
      accSnap = await tx.get(accRef);
      if (!accSnap.exists()) throw new Error('Akun kas/bank tidak ditemukan.');
    }

    let chSnap = null;
    const chRef = params.marketplaceChannelId
      ? doc(db, 'marketplace_channels', params.marketplaceChannelId)
      : null;
    if (chRef) {
      chSnap = await tx.get(chRef);
      if (!chSnap.exists()) throw new Error('Channel marketplace tidak ditemukan.');
    }

    const effectivePaid = isMarketplaceMode ? totalAmount : params.initialPayment;
    const paymentStatus: PaymentStatus =
      effectivePaid === 0 ? 'unpaid' : effectivePaid >= totalAmount ? 'paid' : 'dp';

    tx.set(soRef, {
      soNumber: params.soNumber.trim(),
      customerId: params.customerId ?? 'marketplace',
      customerName: params.customerName ?? params.channel,
      channel: params.channel,
      ...(params.noPesanan ? { noPesanan: params.noPesanan.trim() } : {}),
      totalAmount,
      ...(isMarketplaceMode
        ? {
            biayaAdmin,
            komisiAffiliate,
            potonganLain,
            penerimaanBersih,
          }
        : {}),
      paidAmount: effectivePaid,
      paymentStatus,
      shippingStatus: 'pending',
      status: 'active',
      ...(params.importKey ? { importKey: params.importKey } : {}),
      tanggal: params.tanggal,
      catatan: params.catatan.trim(),
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    for (const line of params.items) {
      const lineRef = doc(collection(db, 'sales_orders', soRef.id, 'items'));
      tx.set(lineRef, {
        productId: line.productId,
        productName: line.productName,
        sku: line.sku,
        qty: line.qty,
        unitPrice: line.unitPrice,
        subtotal: line.qty * line.unitPrice,
      });
    }

    productIds.forEach((pid, idx) => {
      const soldQty = qtyByProduct.get(pid)!;
      const balSnap = balSnaps[idx];
      const currentQty = balSnap.exists() ? Number(balSnap.data().qty ?? 0) : 0;
      // Produk jadi BOLEH minus saat terjual sebelum setoran; UI akan memberi tanda merah "perlu opname"
      const { balanceBefore, balanceAfter } = validateStockChange({
        currentBalance: currentQty,
        deltaQty: -soldQty,
        allowNegative: true,
      });

      const ledgerRef = doc(collection(db, 'stock_ledger'));
      tx.set(ledgerRef, {
        itemId: pid,
        itemType: 'product',
        jenis: 'penjualan',
        qty: -soldQty,
        tanggal: params.tanggal,
        refType: 'sales_order',
        refId: soRef.id,
        catatan: `Penjualan ${params.soNumber}`,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        createdAt: serverTimestamp(),
      });

      tx.set(doc(db, 'stock_balances', pid), {
        itemId: pid,
        itemType: 'product',
        qty: balanceAfter,
        lastLedgerId: ledgerRef.id,
        updatedAt: serverTimestamp(),
      });
    });

    if (params.initialPayment > 0 && accRef && accSnap) {
      const prevSaldo = Number(accSnap.data().saldoBerjalan ?? 0);
      const payRef = doc(collection(db, 'payments'));
      tx.update(accRef, {
        saldoBerjalan: prevSaldo + params.initialPayment,
        lastPaymentId: payRef.id,
      });

      tx.set(payRef, {
        soId: soRef.id,
        soNumber: params.soNumber.trim(),
        accountId: params.accountId,
        accountName: params.accountName ?? '',
        amount: params.initialPayment,
        tanggal: params.tanggal,
        metode: 'Transfer/Tunai',
        catatan: `Pembayaran awal ${params.soNumber}`,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        createdAt: serverTimestamp(),
      });
    }

    if (chRef && chSnap && penerimaanBersih !== undefined) {
      const prevBal = Number(chSnap.data().balance ?? 0);
      tx.update(chRef, {
        balance: prevBal + penerimaanBersih,
        updatedAt: serverTimestamp(),
      });
    }

    const journalAmount = isMarketplaceMode ? (penerimaanBersih ?? totalAmount) : totalAmount;
    const journalRef = doc(collection(db, 'journal_entries'));
    tx.set(journalRef, {
      tanggal: params.tanggal,
      source: 'sales_order',
      refId: soRef.id,
      debitAccount: isMarketplaceMode
        ? 'saldo_marketplace'
        : params.initialPayment >= totalAmount
          ? 'kas_bank'
          : 'piutang_usaha',
      creditAccount: 'pendapatan_penjualan',
      amount: journalAmount,
      deskripsi: `Penjualan ${params.soNumber} (${params.channel})`,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });
  });

  return soRef.id;
}

/**
 * Memecah satu baris impor marketplace yang harga totalnya tidak habis dibagi qty menjadi 1-2 sub-item
 * agar subtotal == qty * unitPrice tetap valid persis di Firestore Rules.
 */
export function buildOrderLinesFromTotal(row: ValidatedMarketplaceImportRow): SalesOrderLineInput[] {
  const baseUnit = Math.floor(row.hargaJual / row.qty);
  const remainder = row.hargaJual % row.qty;
  if (remainder === 0) {
    return [
      {
        productId: row.productId,
        productName: row.productName,
        sku: row.sku,
        qty: row.qty,
        unitPrice: baseUnit,
      },
    ];
  }
  const lines: SalesOrderLineInput[] = [];
  if (row.qty - 1 > 0) {
    lines.push({
      productId: row.productId,
      productName: row.productName,
      sku: row.sku,
      qty: row.qty - 1,
      unitPrice: baseUnit,
    });
  }
  lines.push({
    productId: row.productId,
    productName: row.productName,
    sku: row.sku,
    qty: 1,
    unitPrice: baseUnit + remainder,
  });
  return lines;
}

/**
 * Mengimpor batch penjualan marketplace secara bertahap dan idempoten.
 * Jika dokumen dengan importKey sudah ada di Firestore, baris dilewati tanpa menduplikasi stok atau saldo.
 */
export async function importMarketplaceOrdersBatch(params: {
  actorUid: string;
  actorName?: string;
  actorRole: UserRole;
  channelId: string;
  channelName: string;
  rows: ValidatedMarketplaceImportRow[];
  onProgress?: (done: number, total: number) => void;
}): Promise<{ imported: number; skipped: number }> {
  assertOnlineForTransaction();
  const db = getFirebaseDb();
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < params.rows.length; i += 1) {
    const row = params.rows[i];
    const soDocId = `mp_${row.importKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)}`;
    const existingSnap = await getDoc(doc(db, 'sales_orders', soDocId));
    if (existingSnap.exists()) {
      skipped += 1;
      params.onProgress?.(i + 1, params.rows.length);
      continue;
    }

    await createSalesOrderAtomic({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: params.actorRole,
      soNumber: row.noPesanan,
      customerId: 'marketplace',
      customerName: params.channelName,
      channel: params.channelName,
      marketplaceChannelId: params.channelId,
      noPesanan: row.noPesanan,
      biayaAdmin: row.biayaAdmin,
      komisiAffiliate: row.komisiAffiliate,
      potonganLain: row.potonganLain,
      importKey: row.importKey,
      tanggal: row.tanggal,
      catatan: row.catatan || `Impor ${params.channelName}`,
      items: buildOrderLinesFromTotal(row),
      initialPayment: 0,
    });
    imported += 1;
    params.onProgress?.(i + 1, params.rows.length);
  }

  return { imported, skipped };
}

export async function recordSalesPayment(params: {
  actorUid: string;
  actorName?: string;
  soId: string;
  accountId: string;
  accountName: string;
  amount: number;
  tanggal: string;
  metode: string;
  catatan: string;
}): Promise<void> {
  assertOnlineForTransaction();
  assertPositiveInt(params.amount, 'Nominal pembayaran');
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal tidak valid.');

  const db = getFirebaseDb();
  const soRef = doc(db, 'sales_orders', params.soId);
  const accRef = doc(db, 'accounts', params.accountId);
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));

  await runTransaction(db, async (tx) => {
    const [soSnap, accSnap, periodSnap] = await Promise.all([
      tx.get(soRef),
      tx.get(accRef),
      tx.get(periodRef),
    ]);
    if (!soSnap.exists()) throw new Error('Sales Order tidak ditemukan.');
    if (!accSnap.exists()) throw new Error('Akun kas/bank tidak ditemukan.');
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    const so = soSnap.data();
    if (so.status !== 'active') throw new Error('Sales Order berstatus void.');
    const totalAmount = Number(so.totalAmount ?? 0);
    const currentPaid = Number(so.paidAmount ?? 0);
    const nextPaid = currentPaid + params.amount;
    if (nextPaid > totalAmount) {
      throw new Error(`Pembayaran melebihi sisa piutang (sisa ${totalAmount - currentPaid}).`);
    }

    const nextStatus: PaymentStatus = nextPaid >= totalAmount ? 'paid' : 'dp';
    tx.update(soRef, {
      paidAmount: nextPaid,
      paymentStatus: nextStatus,
    });

    const prevSaldo = Number(accSnap.data().saldoBerjalan ?? 0);
    const payRef = doc(collection(db, 'payments'));
    tx.update(accRef, {
      saldoBerjalan: prevSaldo + params.amount,
      lastPaymentId: payRef.id,
    });

    tx.set(payRef, {
      soId: params.soId,
      soNumber: String(so.soNumber ?? ''),
      accountId: params.accountId,
      accountName: params.accountName,
      amount: params.amount,
      tanggal: params.tanggal,
      metode: params.metode.trim() || 'Tunai',
      catatan: params.catatan.trim(),
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    const journalRef = doc(collection(db, 'journal_entries'));
    tx.set(journalRef, {
      tanggal: params.tanggal,
      source: 'payment',
      refId: payRef.id,
      debitAccount: 'kas_bank',
      creditAccount: 'piutang_usaha',
      amount: params.amount,
      deskripsi: `Pelunasan ${String(so.soNumber ?? '')}`,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });
  });
}

export async function updateShippingStatus(soId: string, shippingStatus: ShippingStatus): Promise<void> {
  assertOnlineForTransaction();
  await updateDoc(doc(getFirebaseDb(), 'sales_orders', soId), { shippingStatus });
}

/**
 * Mencatat retur penjualan: restockable menambah stok produk; non-restockable tidak menambah stok.
 * Bila marketplaceChannelId disertakan, mengurangi Saldo Marketplace channel terkait.
 * Kas/bank TIDAK pernah berubah otomatis pada retur.
 */
export async function recordSalesReturn(params: {
  actorUid: string;
  actorName?: string;
  soId: string;
  soNumber: string;
  productId: string;
  qty: number;
  refundAmount: number;
  restockable: boolean;
  alasan: string;
  tanggal: string;
  marketplaceChannelId?: string;
}): Promise<void> {
  assertOnlineForTransaction();
  assertPositiveInt(params.qty, 'Qty retur');
  assertNonNegativeInt(params.refundAmount, 'Nilai retur');
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal tidak valid.');

  const db = getFirebaseDb();
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));
  const balRef = doc(db, 'stock_balances', params.productId);
  const chRef = params.marketplaceChannelId
    ? doc(db, 'marketplace_channels', params.marketplaceChannelId)
    : null;

  await runTransaction(db, async (tx) => {
    const [periodSnap, balSnap, chSnap] = await Promise.all([
      tx.get(periodRef),
      params.restockable ? tx.get(balRef) : Promise.resolve(null),
      chRef ? tx.get(chRef) : Promise.resolve(null),
    ]);
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }

    const retRef = doc(collection(db, 'sales_returns'));
    tx.set(retRef, {
      soId: params.soId,
      soNumber: params.soNumber,
      productId: params.productId,
      qty: params.qty,
      refundAmount: params.refundAmount,
      restockable: params.restockable,
      alasan: params.alasan.trim(),
      tanggal: params.tanggal,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    if (params.restockable && balSnap) {
      const currentQty = balSnap.exists() ? Number(balSnap.data().qty ?? 0) : 0;
      const { balanceBefore, balanceAfter } = validateStockChange({
        currentBalance: currentQty,
        deltaQty: params.qty,
        allowNegative: true,
      });

      const ledgerRef = doc(collection(db, 'stock_ledger'));
      tx.set(ledgerRef, {
        itemId: params.productId,
        itemType: 'product',
        jenis: 'retur',
        qty: params.qty,
        tanggal: params.tanggal,
        refType: 'sales_return',
        refId: retRef.id,
        catatan: `Retur ${params.soNumber}: ${params.alasan}`,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        createdAt: serverTimestamp(),
      });

      tx.set(balRef, {
        itemId: params.productId,
        itemType: 'product',
        qty: balanceAfter,
        lastLedgerId: ledgerRef.id,
        updatedAt: serverTimestamp(),
      });
    }

    if (chRef && chSnap && chSnap.exists() && params.refundAmount > 0) {
      const prevBal = Number(chSnap.data().balance ?? 0);
      tx.update(chRef, {
        balance: prevBal - params.refundAmount,
        updatedAt: serverTimestamp(),
      });
    }

    const journalRef = doc(collection(db, 'journal_entries'));
    tx.set(journalRef, {
      tanggal: params.tanggal,
      source: 'sales_return',
      refId: retRef.id,
      debitAccount: 'retur_penjualan',
      creditAccount: chRef ? 'saldo_marketplace' : 'piutang_usaha',
      amount: params.refundAmount,
      deskripsi: `Retur penjualan ${params.soNumber}`,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });
  });
}

export async function voidSalesOrderByOwner(params: {
  actorUid: string;
  actorName?: string;
  soId: string;
  tanggal: string;
  alasan: string;
  marketplaceChannelId?: string;
}): Promise<void> {
  assertOnlineForTransaction();
  if (!isValidDateStr(params.tanggal)) throw new Error('Tanggal void tidak valid.');

  const db = getFirebaseDb();
  const items = await fetchSalesOrderItems(params.soId);
  const qtyByProduct = new Map<string, number>();
  for (const line of items) {
    qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + line.qty);
  }

  const productIds = Array.from(qtyByProduct.keys());
  const soRef = doc(db, 'sales_orders', params.soId);
  const periodRef = doc(db, 'periods', params.tanggal.slice(0, 7));
  const chRef = params.marketplaceChannelId
    ? doc(db, 'marketplace_channels', params.marketplaceChannelId)
    : null;

  await runTransaction(db, async (tx) => {
    const [soSnap, periodSnap, chSnap, ...balSnaps] = await Promise.all([
      tx.get(soRef),
      tx.get(periodRef),
      chRef ? tx.get(chRef) : Promise.resolve(null),
      ...productIds.map((pid) => tx.get(doc(db, 'stock_balances', pid))),
    ]);

    if (!soSnap.exists()) throw new Error('Sales Order tidak ditemukan.');
    if (periodSnap.exists() && periodSnap.data().closed === true) {
      throw new Error(`Periode ${params.tanggal.slice(0, 7)} sudah ditutup.`);
    }
    const so = soSnap.data();
    if (so.status === 'void') throw new Error('Sales Order sudah berstatus void.');

    tx.update(soRef, { status: 'void' });

    productIds.forEach((pid, idx) => {
      const qtyRestore = qtyByProduct.get(pid)!;
      const balSnap = balSnaps[idx];
      const currentQty = balSnap.exists() ? Number(balSnap.data().qty ?? 0) : 0;
      const { balanceBefore, balanceAfter } = validateStockChange({
        currentBalance: currentQty,
        deltaQty: qtyRestore,
        allowNegative: true,
      });

      const ledgerRef = doc(collection(db, 'stock_ledger'));
      tx.set(ledgerRef, {
        itemId: pid,
        itemType: 'product',
        jenis: 'reversal',
        qty: qtyRestore,
        tanggal: params.tanggal,
        refType: 'void_sales_order',
        refId: params.soId,
        catatan: `Void SO ${String(so.soNumber ?? '')}: ${params.alasan}`,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        createdBy: params.actorUid,
        ...(params.actorName ? { createdByName: params.actorName } : {}),
        createdAt: serverTimestamp(),
      });

      tx.set(doc(db, 'stock_balances', pid), {
        itemId: pid,
        itemType: 'product',
        qty: balanceAfter,
        lastLedgerId: ledgerRef.id,
        updatedAt: serverTimestamp(),
      });
    });

    const netAmt =
      so.penerimaanBersih !== undefined ? Number(so.penerimaanBersih) : Number(so.totalAmount ?? 0);

    if (chRef && chSnap && chSnap.exists() && so.penerimaanBersih !== undefined) {
      const prevBal = Number(chSnap.data().balance ?? 0);
      tx.update(chRef, {
        balance: prevBal - netAmt,
        updatedAt: serverTimestamp(),
      });
    }

    tx.set(doc(collection(db, 'journal_entries')), {
      tanggal: params.tanggal,
      source: 'void_reversal',
      refId: params.soId,
      debitAccount: 'pendapatan_penjualan',
      creditAccount: so.penerimaanBersih !== undefined ? 'saldo_marketplace' : 'piutang_usaha',
      amount: netAmt,
      deskripsi: `Reversal Void SO ${String(so.soNumber ?? '')}`,
      isReversal: true,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      createdAt: serverTimestamp(),
    });

    tx.set(doc(collection(db, 'audit_logs')), {
      uid: params.actorUid,
      createdBy: params.actorUid,
      ...(params.actorName ? { createdByName: params.actorName } : {}),
      aksi: 'VOID_SALES_ORDER',
      targetCollection: 'sales_orders',
      targetId: params.soId,
      sebelum: JSON.stringify({ status: 'active', totalAmount: so.totalAmount }),
      sesudah: JSON.stringify({ status: 'void', alasan: params.alasan }),
      createdAt: serverTimestamp(),
    });
  });
}
