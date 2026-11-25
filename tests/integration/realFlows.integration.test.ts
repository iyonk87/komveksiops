import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TEST_PROJECT_ID = 'konveksiops-int-test';

vi.hoisted(() => {
  process.env.VITE_USE_EMULATORS = 'true';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.VITE_FIREBASE_API_KEY = 'demo-api-key';
  process.env.VITE_FIREBASE_AUTH_DOMAIN = 'konveksiops-int-test.firebaseapp.com';
  process.env.VITE_FIREBASE_PROJECT_ID = 'konveksiops-int-test';
  process.env.VITE_FIREBASE_STORAGE_BUCKET = 'konveksiops-int-test.appspot.com';
  process.env.VITE_FIREBASE_MESSAGING_SENDER_ID = '1234567890';
  process.env.VITE_FIREBASE_APP_ID = '1:1234567890:web:abcdef123456';
});

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { signInWithEmailAndPassword } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { getFirebaseAuth, getFirebaseDb } from '../../src/services/firebase/config';
import {
  fetchAllAccountsPaginated,
  fetchAllMaterialsPaginated,
  fetchAllProductsPaginated,
  fetchUsers,
  importMaterialsChunk,
  importRecipeChunk,
  provisionUserByOwner,
  saveAccount,
  saveBomItem,
  saveMaterial,
  saveProduct,
  saveSupplier,
  updateUserRoleStatus,
} from '../../src/services/firebase/masterRepo';
import {
  fetchAllStockBalancesPaginated,
  fetchAllStockLedgerPaginated,
  recordMaterialReceiptAtomic,
  recordStockMutation,
  resolveOpnameRequest,
  submitOpnameRequest,
} from '../../src/services/firebase/inventoryRepo';
import {
  createWorkOrderWithBom,
  fetchAllWorkOrdersPaginated,
  fetchRecentStageLogs,
  fetchStageLogs,
  recordWorkOrderReject,
  recordWorkOrderSetoran,
  resumeWorkOrderCut,
} from '../../src/services/firebase/productionRepo';
import {
  createSalesOrderAtomic,
  ensureDefaultMarketplaceChannels,
  fetchAllMarketplaceChannelsPaginated,
  fetchAllMarketplacePayoutsPaginated,
  fetchAllPaymentsPaginated,
  fetchAllSalesOrdersPaginated,
  fetchAllSalesReturnsPaginated,
  fetchMarketplaceMapping,
  fetchSalesOrderItems,
  importMarketplaceOrdersBatch,
  recordMarketplacePayout,
  recordSalesPayment,
  recordSalesReturn,
  saveMarketplaceMapping,
  updateShippingStatus,
  voidSalesOrderByOwner,
} from '../../src/services/firebase/salesRepo';
import {
  createOperatingExpense,
  createProductionCost,
  createReversalJournal,
  fetchAccountingSettings,
  fetchAllJournalEntriesPaginated,
  fetchAllOperatingExpensesPaginated,
  fetchAllPeriodsPaginated,
  fetchAllProductionCostsPaginated,
  fetchAllPurchaseCostsPaginated,
  fetchAllWagePayoutsPaginated,
  fetchJournalEntries,
  recordWagePayout,
  saveModalAwalSetting,
  setPeriodClosed,
  settlePayableEntry,
} from '../../src/services/firebase/financeRepo';
import { computeIntegrityAuditReport } from '../../src/services/domain/accounting';
import type { ValidatedMarketplaceImportRow } from '../../src/services/domain/csv';
import type { BomItem, Material, SalesOrderItem, StageLog } from '../../src/types/models';

const OWNER_EMAIL = 'owner.int@konveksi.test';
const OWNER_PASS = 'OwnerStrong#2026';
const ADMIN_EMAIL = 'admin.int@konveksi.test';
const ADMIN_PASS = 'AdminStrong#2026';
const TEMP_EMAIL = 'temp.int@konveksi.test';
const TEMP_PASS = 'TempStrong#2026';
const LEGACY_EMAIL = 'legacy.gudang@konveksi.test';
const LEGACY_PASS = 'LegacyStrong#2026';

let testEnv: RulesTestEnvironment;
let ownerUid = '';
let adminUid = '';
let tempUid = '';
let legacyUid = '';

async function clearAuthEmulator(): Promise<void> {
  const res = await fetch(
    `http://127.0.0.1:9099/emulator/v1/projects/${TEST_PROJECT_ID}/accounts`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    throw new Error(`Gagal membersihkan Auth Emulator: ${res.status} ${await res.text()}`);
  }
}

async function createAuthUserViaEmulatorRest(email: string, password: string): Promise<string> {
  const res = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) {
    throw new Error(`Gagal membuat user auth emulator: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { localId: string };
  return json.localId;
}

async function signInAs(email: string, password: string): Promise<string> {
  const cred = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
  return cred.user.uid;
}

describe('Integration Tests: Real Repo Functions vs Auth & Firestore Emulators (owner | admin)', () => {
  const materialIds: string[] = [];
  const materials: Material[] = [];
  const productIds: string[] = [];
  const bomItems: BomItem[] = [];
  let kasAccountId = '';
  let kasNoRekFieldAccountId = '';
  let bankAccountId = '';
  let supplierId = '';
  let purchaseCostId = '';
  let woId = '';
  let prodCostId = '';
  let so6Id = '';
  let soMarketplaceDirectId = '';
  let soVoidId = '';
  let concurrencyMaterialId = '';

  beforeAll(async () => {
    await clearAuthEmulator();
    const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: TEST_PROJECT_ID,
      firestore: {
        rules,
        host: '127.0.0.1',
        port: 8080,
      },
    });
    await testEnv.clearFirestore();

    ownerUid = await createAuthUserViaEmulatorRest(OWNER_EMAIL, OWNER_PASS);
    legacyUid = await createAuthUserViaEmulatorRest(LEGACY_EMAIL, LEGACY_PASS);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', ownerUid), {
        nama: 'Owner Utama',
        email: OWNER_EMAIL,
        role: 'owner',
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      // Akun dengan role lama 'gudang' harus ditolak oleh rules (fail-closed)
      await setDoc(doc(ctx.firestore(), 'users', legacyUid), {
        nama: 'Legacy Gudang',
        email: LEGACY_EMAIL,
        role: 'gudang',
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  it('Skenario 1: Owner provision Admin + setup master (kas/bank, channel marketplace TikTok/Shopee, 8 bahan konversi, 6 SKU tas, Resep 8 bahan + komponen biaya)', async () => {
    const uid = await signInAs(OWNER_EMAIL, OWNER_PASS);
    expect(uid).toBe(ownerUid);

    adminUid = await provisionUserByOwner({
      actorUid: ownerUid,
      actorName: 'Owner Utama',
      nama: 'Admin Operasional',
      email: ADMIN_EMAIL,
      password: ADMIN_PASS,
      role: 'admin',
    });
    tempUid = await provisionUserByOwner({
      actorUid: ownerUid,
      actorName: 'Owner Utama',
      nama: 'Staf Sementara',
      email: TEMP_EMAIL,
      password: TEMP_PASS,
      role: 'admin',
    });

    const usersSnap = await fetchUsers();
    expect(usersSnap.items.length).toBeGreaterThanOrEqual(3);

    // Channel default TikTok & Shopee idempoten
    const channels = await ensureDefaultMarketplaceChannels(ownerUid);
    expect(channels.some((c) => c.id === 'tiktok' && c.nama === 'TikTok')).toBe(true);
    expect(channels.some((c) => c.id === 'shopee' && c.nama === 'Shopee')).toBe(true);

    kasAccountId = await saveAccount({
      actorUid: ownerUid,
      nama: 'Kas Tunai',
      tipe: 'kas',
      nomorRekening: '',
      saldoAwal: 5000000,
    });
    bankAccountId = await saveAccount({
      actorUid: ownerUid,
      nama: 'Bank BCA',
      tipe: 'bank',
      nomorRekening: '8810023456',
      saldoAwal: 20000000,
    });

    // Akun kas lama tanpa key nomorRekening
    kasNoRekFieldAccountId = doc(collection(getFirebaseDb(), 'accounts')).id;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'accounts', kasNoRekFieldAccountId), {
        nama: 'Kas Laci Tanpa Field Rekening',
        tipe: 'kas',
        saldoAwal: 1000000,
        saldoBerjalan: 1000000,
        active: true,
        createdBy: ownerUid,
        createdAt: serverTimestamp(),
      });
    });

    supplierId = await saveSupplier({
      actorUid: ownerUid,
      nama: 'PT Kanvas Tas Bandung',
      telepon: '08123456789',
      alamat: 'Bandung',
      catatan: 'Tempo 14 hari',
    });

    // 8 bahan baku: bahan 0 punya konversi=null (harus diisi aktual saat terima per satuan beli); bahan 1..7 punya konversi 5000 cm/roll atau 100 pcs/pak
    for (let i = 1; i <= 8; i += 1) {
      const isFabric = i <= 4;
      const satuanBeli = isFabric ? 'roll' : 'pak';
      const satuanPakai = isFabric ? 'cm' : 'pcs';
      const konversi = i === 1 ? null : isFabric ? 5000 : 100;
      const mId = await saveMaterial({
        actorUid: ownerUid,
        kode: `BHN-0${i}`,
        nama: isFabric ? `Kain Cordura ${i}` : `Aksesoris Tas ${i}`,
        kategori: isFabric ? 'kain' : i <= 6 ? 'resleting' : 'benang',
        satuanBeli,
        satuanPakai,
        konversi,
        minStock: 10,
      });
      materialIds.push(mId);
      materials.push({
        id: mId,
        kode: `BHN-0${i}`,
        nama: isFabric ? `Kain Cordura ${i}` : `Aksesoris Tas ${i}`,
        kategori: isFabric ? 'kain' : i <= 6 ? 'resleting' : 'benang',
        satuan: satuanPakai,
        satuanBeli,
        satuanPakai,
        konversi,
        minStock: 10,
        active: true,
        createdBy: ownerUid,
      });
    }

    for (let i = 1; i <= 6; i += 1) {
      const pId = await saveProduct({
        actorUid: ownerUid,
        sku: `TAS-0${i}`,
        nama: `Tas Ransel ${i}`,
        model: 'Ransel',
        warna: 'Hitam',
        ukuran: i <= 3 ? 'M' : 'L',
        satuan: 'pcs',
        minStock: 5,
        hargaJual: 120000 + i * 5000,
      });
      productIds.push(pId);
    }

    // Resep 8 bahan + 3 komponen biaya (jahit_cutting, sablon, packing) untuk productIds[0]
    for (let i = 0; i < 8; i += 1) {
      const qtyPerPcs = i < 4 ? 10 + i : i - 2; // cm / pcs
      const bId = await saveBomItem({
        actorUid: ownerUid,
        productId: productIds[0],
        jenis: 'material',
        materialId: materialIds[i],
        qtyPerPcs,
      });
      bomItems.push({
        id: bId,
        productId: productIds[0],
        jenis: 'material',
        materialId: materialIds[i],
        qtyPerPcs,
        active: true,
        createdBy: ownerUid,
      });
    }

    const costDefs: Array<{ cat: 'jahit_cutting' | 'sablon' | 'packing'; label: string; amt: number }> = [
      { cat: 'jahit_cutting', label: 'Upah Jahit & Cutting', amt: 25000 },
      { cat: 'sablon', label: 'Biaya Sablon', amt: 15000 },
      { cat: 'packing', label: 'Upah Packing', amt: 1000 },
    ];
    for (const c of costDefs) {
      const cId = await saveBomItem({
        actorUid: ownerUid,
        productId: productIds[0],
        jenis: 'cost',
        costCategory: c.cat,
        label: c.label,
        amountPerPcs: c.amt,
      });
      bomItems.push({
        id: cId,
        productId: productIds[0],
        jenis: 'cost',
        costCategory: c.cat,
        label: c.label,
        amountPerPcs: c.amt,
        active: true,
        createdBy: ownerUid,
      });
    }

    expect(materialIds).toHaveLength(8);
    expect(productIds).toHaveLength(6);
    expect(bomItems).toHaveLength(11);
  });

  it('Skenario 2: Admin terima bahan dengan konversi null (diblokir tanpa aktual, sukses dengan aktual -> harga pecahan/cm) + opname bahan', async () => {
    await signInAs(ADMIN_EMAIL, ADMIN_PASS);

    // Bahan 0 konversi === null -> wajib ditolak bila unitMode === 'purchase' tanpa actualUsageQty
    await expect(
      recordMaterialReceiptAtomic({
        actorUid: adminUid,
        actorName: 'Admin Operasional',
        material: materials[0],
        unitMode: 'purchase',
        purchaseQty: 2,
        tanggal: '2026-11-02',
        refId: 'PO-GAGAL',
        catatan: 'Harus gagal konversi kosong',
      }),
    ).rejects.toThrow(/konversi/i);

    // Sukses jika actualUsageQty diisi + totalCost bulat -> menghasilkan unitCost pecahan float
    // 2 roll, aktual 3000 cm, totalCost Rp 1.000.000 => unitCost = 333.333333... Rp/cm
    const rec0 = await recordMaterialReceiptAtomic({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      material: materials[0],
      unitMode: 'purchase',
      purchaseQty: 2,
      actualUsageQty: 3000,
      totalCost: 1000000,
      paidAmount: 400000, // utang supplier 600.000
      supplierId,
      accountId: bankAccountId,
      tanggal: '2026-11-02',
      refId: 'PO-01',
      catatan: 'Kain Cordura 1 (aktual 30m)',
    });
    purchaseCostId = rec0.purchaseCostId ?? '';
    expect(rec0.ledgerId).toBeTruthy();
    expect(rec0.usageQty).toBe(3000);
    expect(purchaseCostId).toBeTruthy();

    const pcSnap = await getDoc(doc(getFirebaseDb(), 'purchase_costs', purchaseCostId));
    expect(pcSnap.data()?.totalCost).toBe(1000000);
    expect(Number(pcSnap.data()?.unitCost)).toBeCloseTo(1000000 / 3000, 6);

    // Terima bahan 1..7 lewat recordMaterialReceiptAtomic dengan konversi terisi
    for (let i = 1; i < 8; i += 1) {
      await recordMaterialReceiptAtomic({
        actorUid: adminUid,
        actorName: 'Admin Operasional',
        material: materials[i],
        unitMode: 'purchase',
        purchaseQty: i >= 4 ? 5 : 1,
        totalCost: 500000,
        paidAmount: 500000,
        supplierId,
        accountId: bankAccountId,
        tanggal: '2026-11-02',
        refId: `PO-0${i + 1}`,
        catatan: `Penerimaan bahan ${i + 1}`,
      });
    }

    // Impor bahan idempoten 2x tidak menggandakan
    const matImportRes = await importMaterialsChunk({
      actorUid: adminUid,
      rows: [
        {
          rowNumber: 2,
          kode: 'BHN-IMP-1',
          nama: 'Webbing Nylon 3cm',
          kategori: 'lainnya',
          satuanBeli: 'roll',
          satuanPakai: 'cm',
          konversi: 4500,
          minStock: 100,
          warnings: [],
        },
      ],
      existingByKode: new Map(),
    });
    expect(matImportRes.created).toBe(1);

    // Stok awal produk 1..5 via opname_koreksi
    await signInAs(OWNER_EMAIL, OWNER_PASS);
    for (let i = 1; i < 6; i += 1) {
      await recordStockMutation({
        actorUid: ownerUid,
        actorName: 'Owner Utama',
        actorRole: 'owner',
        itemId: productIds[i],
        itemType: 'product',
        jenis: 'opname_koreksi',
        qty: 30,
        tanggal: '2026-11-02',
        refType: 'init_audit',
        refId: `INIT-${i + 1}`,
        catatan: 'Stok awal SKU tas',
      });
    }

    // Opname bahan oleh Admin -> approval oleh Admin
    await signInAs(ADMIN_EMAIL, ADMIN_PASS);
    const opId = await submitOpnameRequest({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      itemId: materialIds[1],
      itemType: 'material',
      systemQty: 5000,
      physicalQty: 4990,
      alasan: 'Susut potong gulungan',
      tanggal: '2026-11-02',
    });
    await resolveOpnameRequest({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      opnameId: opId,
      decision: 'approved',
    });
    const bal1Snap = await getDoc(doc(getFirebaseDb(), 'stock_balances', materialIds[1]));
    expect(bal1Snap.data()?.qty).toBe(4990);
  });

  it('Skenario 3: WO dengan Resep 8 bahan (chunked 4/tx + resumeWorkOrderCut idempoten), setoran bertahap, reject terpisah, & upah mingguan dengan selisih', async () => {
    await signInAs(ADMIN_EMAIL, ADMIN_PASS);

    let progressCalls = 0;
    woId = await createWorkOrderWithBom({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      actorRole: 'admin',
      woNumber: 'WO-TAS-001',
      productId: productIds[0],
      targetQty: 60,
      tanggal: '2026-11-03',
      catatan: 'Batch ransel 60 pcs (8 bahan)',
      bomItems,
      hppPerPcsSnapshot: 55000,
      onProgress: () => {
        progressCalls += 1;
      },
    });
    expect(woId).toBeTruthy();
    expect(progressCalls).toBe(2); // 8 bahan / 4 per chunk = 2 chunk transaksi

    const woSnap = await getDoc(doc(getFirebaseDb(), 'work_orders', woId));
    expect(woSnap.data()?.cutCompleted).toBe(true);
    expect(woSnap.data()?.cutMaterialIds).toHaveLength(8);
    expect(woSnap.data()?.wipQty).toBe(60);

    // Pemakaian bahan 0: 10 cm * 60 = 600 cm => sisa 3000 - 600 = 2400 cm
    const mat0BeforeResume = Number((await getDoc(doc(getFirebaseDb(), 'stock_balances', materialIds[0]))).data()?.qty);
    expect(mat0BeforeResume).toBe(2400);

    // Resume idempoten TIDAK boleh memotong bahan dua kali
    const resumeRes = await resumeWorkOrderCut({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      wo: {
        id: woId,
        woNumber: 'WO-TAS-001',
        productId: productIds[0],
        targetQty: 60,
        completedQty: 0,
        wipQty: 60,
        cutCompleted: true,
        cutMaterialIds: materialIds,
        currentStage: 'setoran',
        status: 'in_progress',
        tanggal: '2026-11-03',
        catatan: '',
        createdBy: adminUid,
      },
      bomItems,
    });
    expect(resumeRes.completed).toBe(true);
    expect(Number((await getDoc(doc(getFirebaseDb(), 'stock_balances', materialIds[0]))).data()?.qty)).toBe(2400);

    // Setoran bertahap ke gudang: 20 pcs lalu 38 pcs
    await recordWorkOrderSetoran({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      woId,
      setoranQty: 20,
      tanggal: '2026-11-04',
      catatan: 'Setoran gelombang 1',
    });
    await recordWorkOrderSetoran({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      woId,
      setoranQty: 38,
      tanggal: '2026-11-05',
      catatan: 'Setoran gelombang 2',
    });

    // Reject terpisah 2 pcs (tidak masuk barang jadi, catat beban reject)
    await recordWorkOrderReject({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      woId,
      rejectQty: 2,
      reason: 'Jahitan sablon robek parah',
      tanggal: '2026-11-05',
      unitMaterialCostRupiah: 10000,
    });

    const woEndSnap = await getDoc(doc(getFirebaseDb(), 'work_orders', woId));
    expect(woEndSnap.data()?.completedQty).toBe(58);
    expect(woEndSnap.data()?.rejectedQty).toBe(2);
    expect(woEndSnap.data()?.wipQty).toBe(0);
    expect(woEndSnap.data()?.status).toBe('completed');

    const prod0Bal = await getDoc(doc(getFirebaseDb(), 'stock_balances', productIds[0]));
    expect(prod0Bal.data()?.qty).toBe(58);

    const recentLogs = await fetchRecentStageLogs(20);
    expect(recentLogs.items.length).toBeGreaterThanOrEqual(4); // potong + 2 setoran + reject

    // Biaya produksi + pelunasan hutang supplier + pembayaran upah mingguan dengan selisih (variance)
    prodCostId = await createProductionCost({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      woId,
      woNumber: 'WO-TAS-001',
      vendorName: 'Vendor Sablon Jaya',
      kategori: 'sablon',
      amount: 870000,
      paidAmount: 870000,
      accountId: kasAccountId,
      tanggal: '2026-11-05',
      catatan: 'Sablon batch 1',
    });
    expect(prodCostId).toBeTruthy();

    await settlePayableEntry({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      refType: 'purchase_cost',
      refId: purchaseCostId,
      accountId: bankAccountId,
      amount: 200000,
      tanggal: '2026-11-05',
      deskripsi: 'Cicil utang kain Cordura',
    });

    const kasBeforeWage = Number((await getDoc(doc(getFirebaseDb(), 'accounts', kasAccountId))).data()?.saldoBerjalan);
    // Standar 58 pcs: jahit 25k*58=1.450.000, sablon 15k*58=870.000, packing 1k*58=58.000 (total 2.378.000)
    // Dibayar aktual: jahit 1.500.000, sablon 870.000, packing 58.000 (total 2.428.000 -> variance +50.000)
    const wageId = await recordWagePayout({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      startDate: '2026-11-01',
      endDate: '2026-11-07',
      tanggal: '2026-11-07',
      accountId: kasAccountId,
      accountName: 'Kas Tunai',
      jahitCuttingStandard: 1450000,
      sablonStandard: 870000,
      packingStandard: 58000,
      lainnyaStandard: 0,
      jahitCuttingPaid: 1500000,
      sablonPaid: 870000,
      packingPaid: 58000,
      lainnyaPaid: 0,
      catatan: 'Upah mingguan minggu 1 November',
    });
    expect(wageId).toBeTruthy();
    const kasAfterWage = Number((await getDoc(doc(getFirebaseDb(), 'accounts', kasAccountId))).data()?.saldoBerjalan);
    expect(kasAfterWage).toBe(kasBeforeWage - 2428000);
  });

  it('Skenario 4: Penjualan Marketplace (SO 6 SKU + impor idempoten + stok produk boleh minus + pencairan saldo marketplace ke bank + pelunasan langsung)', async () => {
    await signInAs(ADMIN_EMAIL, ADMIN_PASS);

    // 4a. Simpan mapping kolom marketplace
    await saveMarketplaceMapping({
      actorUid: adminUid,
      channelId: 'tiktok',
      channelName: 'TikTok',
      mappingJson: JSON.stringify({ tanggal: 0, noPesanan: 1, sku: 2 }),
    });
    const savedMap = await fetchMarketplaceMapping('tiktok');
    expect(savedMap?.channelName).toBe('TikTok');

    // 4b. SO 6 SKU manual (non-marketplace, DP ke kas tanpa field nomorRekening lalu pelunasan ke Bank BCA) -> E.10 path
    const items6 = productIds.map((pid, idx) => ({
      productId: pid,
      productName: `Tas Ransel ${idx + 1}`,
      sku: `TAS-0${idx + 1}`,
      qty: 2,
      unitPrice: 120000 + (idx + 1) * 5000,
    }));
    // Total = 2 * (125k + 130k + 135k + 140k + 145k + 150k) = 2 * 825.000 = 1.650.000
    so6Id = await createSalesOrderAtomic({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      actorRole: 'admin',
      soNumber: 'SO-INT-6SKU',
      customerId: 'grosir-1',
      customerName: 'Distributor Tas',
      channel: 'grosir',
      tanggal: '2026-11-06',
      catatan: 'Order 6 SKU lengkap',
      items: items6,
      initialPayment: 650000,
      accountId: kasNoRekFieldAccountId,
      accountName: 'Kas Laci Tanpa Field Rekening',
    });

    await recordSalesPayment({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      soId: so6Id,
      accountId: bankAccountId,
      accountName: 'Bank BCA',
      amount: 1000000,
      tanggal: '2026-11-07',
      metode: 'Transfer BCA',
      catatan: 'Pelunasan SO 6 SKU',
    });

    // 4c. Penjualan Marketplace TikTok (potongan admin/affiliate -> masuk Saldo Marketplace, BUKAN kas)
    const bankBeforeMp = Number((await getDoc(doc(getFirebaseDb(), 'accounts', bankAccountId))).data()?.saldoBerjalan);
    soMarketplaceDirectId = await createSalesOrderAtomic({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      actorRole: 'admin',
      soNumber: 'TT-20261108-001',
      channel: 'TikTok',
      marketplaceChannelId: 'tiktok',
      noPesanan: 'TT-20261108-001',
      biayaAdmin: 20000,
      komisiAffiliate: 15000,
      potonganLain: 5000,
      tanggal: '2026-11-08',
      catatan: 'Order TikTok',
      items: [
        {
          productId: productIds[0],
          productName: 'Tas Ransel 1',
          sku: 'TAS-01',
          qty: 4,
          unitPrice: 125000, // gross 500.000, net 460.000
        },
      ],
      initialPayment: 0,
    });
    expect(soMarketplaceDirectId).toBeTruthy();

    // Bank tidak berubah sebelum pencairan
    expect(Number((await getDoc(doc(getFirebaseDb(), 'accounts', bankAccountId))).data()?.saldoBerjalan)).toBe(bankBeforeMp);
    expect(Number((await getDoc(doc(getFirebaseDb(), 'marketplace_channels', 'tiktok'))).data()?.balance)).toBe(460000);

    // 4d. Impor marketplace batch idempoten (termasuk uji produk jadi boleh minus!)
    const prod5Before = Number((await getDoc(doc(getFirebaseDb(), 'stock_balances', productIds[5]))).data()?.qty); // 30 - 2 = 28
    const importRows: ValidatedMarketplaceImportRow[] = [
      {
        rowNumber: 2,
        importKey: 'tiktok__tt_imp_100__tas_06',
        tanggal: '2026-11-08',
        noPesanan: 'TT-IMP-100',
        productId: productIds[5],
        sku: 'TAS-06',
        productName: 'Tas Ransel 6',
        qty: 35, // melebihi stok 28 -> stok menjadi -7 (diizinkan untuk product!)
        hargaJual: 3500000,
        biayaAdmin: 150000,
        komisiAffiliate: 50000,
        potonganLain: 0,
        penerimaanBersih: 3300000,
        catatan: 'Impor TikTok batch',
        warnings: [],
      },
    ];
    const imp1 = await importMarketplaceOrdersBatch({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      actorRole: 'admin',
      channelId: 'tiktok',
      channelName: 'TikTok',
      rows: importRows,
    });
    expect(imp1).toEqual({ imported: 1, skipped: 0 });
    expect(Number((await getDoc(doc(getFirebaseDb(), 'stock_balances', productIds[5]))).data()?.qty)).toBe(
      prod5Before - 35,
    ); // negatif (-7) diizinkan untuk product!

    // Impor ulang dengan importKey sama wajib di-skip (idempoten)
    const imp2 = await importMarketplaceOrdersBatch({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      actorRole: 'admin',
      channelId: 'tiktok',
      channelName: 'TikTok',
      rows: importRows,
    });
    expect(imp2).toEqual({ imported: 0, skipped: 1 });
    expect(Number((await getDoc(doc(getFirebaseDb(), 'stock_balances', productIds[5]))).data()?.qty)).toBe(
      prod5Before - 35,
    );

    // Saldo TikTok sekarang 460.000 + 3.300.000 = 3.760.000
    expect(Number((await getDoc(doc(getFirebaseDb(), 'marketplace_channels', 'tiktok'))).data()?.balance)).toBe(
      3760000,
    );

    // 4e. Pencairan Saldo Marketplace TikTok ke Bank BCA
    await recordMarketplacePayout({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      channelId: 'tiktok',
      accountId: bankAccountId,
      accountName: 'Bank BCA',
      amount: 2000000,
      tanggal: '2026-11-09',
      catatan: 'Tarik dana TikTok ke BCA',
    });
    expect(Number((await getDoc(doc(getFirebaseDb(), 'accounts', bankAccountId))).data()?.saldoBerjalan)).toBe(
      bankBeforeMp + 2000000,
    );
    expect(Number((await getDoc(doc(getFirebaseDb(), 'marketplace_channels', 'tiktok'))).data()?.balance)).toBe(
      1760000,
    );
  });

  it('Skenario 5: Retur Marketplace restockable & non-restockable (kurangi Saldo Marketplace, kas/bank TIDAK berubah) + Resep import idempoten', async () => {
    await signInAs(ADMIN_EMAIL, ADMIN_PASS);

    const bankBefore = Number((await getDoc(doc(getFirebaseDb(), 'accounts', bankAccountId))).data()?.saldoBerjalan);
    const kasBefore = Number((await getDoc(doc(getFirebaseDb(), 'accounts', kasAccountId))).data()?.saldoBerjalan);
    const prod0Before = Number((await getDoc(doc(getFirebaseDb(), 'stock_balances', productIds[0]))).data()?.qty);
    const tiktokBefore = Number((await getDoc(doc(getFirebaseDb(), 'marketplace_channels', 'tiktok'))).data()?.balance);

    await updateShippingStatus(soMarketplaceDirectId, 'delivered');

    // Retur restockable 1 pcs -> stok produk naik 1, saldo TikTok turun 115.000
    await recordSalesReturn({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      soId: soMarketplaceDirectId,
      soNumber: 'TT-20261108-001',
      productId: productIds[0],
      qty: 1,
      refundAmount: 115000,
      restockable: true,
      alasan: 'Pembeli salah pilih warna',
      tanggal: '2026-11-09',
      marketplaceChannelId: 'tiktok',
    });
    expect(Number((await getDoc(doc(getFirebaseDb(), 'stock_balances', productIds[0]))).data()?.qty)).toBe(
      prod0Before + 1,
    );

    // Retur non-restockable 1 pcs -> stok produk TIDAK berubah, saldo TikTok turun 115.000
    await recordSalesReturn({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      soId: soMarketplaceDirectId,
      soNumber: 'TT-20261108-001',
      productId: productIds[0],
      qty: 1,
      refundAmount: 115000,
      restockable: false,
      alasan: 'Rusak di ekspedisi',
      tanggal: '2026-11-09',
      marketplaceChannelId: 'tiktok',
    });
    expect(Number((await getDoc(doc(getFirebaseDb(), 'stock_balances', productIds[0]))).data()?.qty)).toBe(
      prod0Before + 1,
    );
    expect(Number((await getDoc(doc(getFirebaseDb(), 'marketplace_channels', 'tiktok'))).data()?.balance)).toBe(
      tiktokBefore - 230000,
    );

    // Kas/Bank TIDAK pernah berubah otomatis pada retur
    expect(Number((await getDoc(doc(getFirebaseDb(), 'accounts', bankAccountId))).data()?.saldoBerjalan)).toBe(bankBefore);
    expect(Number((await getDoc(doc(getFirebaseDb(), 'accounts', kasAccountId))).data()?.saldoBerjalan)).toBe(kasBefore);

    // Impor Resep chunk idempoten
    const recImp = await importRecipeChunk({
      actorUid: adminUid,
      rows: [
        {
          rowNumber: 2,
          productId: productIds[1],
          productSku: 'TAS-02',
          jenis: 'cost',
          costCategory: 'packing',
          label: 'Packing Standar',
          amountPerPcs: 1000,
          warnings: [],
        },
      ],
      existingItems: bomItems,
    });
    expect(recImp.created).toBe(1);
  });

  it('Skenario 6: Admin catat beban operasional & modalAwal setting; Owner buat jurnal reversal & void SO', async () => {
    await signInAs(ADMIN_EMAIL, ADMIN_PASS);

    const kasBefore = Number((await getDoc(doc(getFirebaseDb(), 'accounts', kasAccountId))).data()?.saldoBerjalan);
    await createOperatingExpense({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      kategori: 'Gaji Admin',
      deskripsi: 'Gaji admin bulanan',
      accountId: kasAccountId,
      amount: 500000,
      tanggal: '2026-11-09',
    });
    expect(Number((await getDoc(doc(getFirebaseDb(), 'accounts', kasAccountId))).data()?.saldoBerjalan)).toBe(
      kasBefore - 500000,
    );

    await saveModalAwalSetting({ actorUid: adminUid, modalAwal: 26000000 });
    const settings = await fetchAccountingSettings();
    expect(settings?.modalAwal).toBe(26000000);

    // SO void
    const prod1Before = Number((await getDoc(doc(getFirebaseDb(), 'stock_balances', productIds[1]))).data()?.qty);
    soVoidId = await createSalesOrderAtomic({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      actorRole: 'admin',
      soNumber: 'SO-INT-VOID',
      customerId: 'grosir-1',
      customerName: 'Distributor Tas',
      channel: 'online',
      tanggal: '2026-11-10',
      catatan: 'Akan dibatalkan',
      items: [
        {
          productId: productIds[1],
          productName: 'Tas Ransel 2',
          sku: 'TAS-02',
          qty: 3,
          unitPrice: 130000,
        },
      ],
      initialPayment: 0,
    });

    await voidSalesOrderByOwner({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      soId: soVoidId,
      tanggal: '2026-11-10',
      alasan: 'Pembeli batal',
    });
    expect((await getDoc(doc(getFirebaseDb(), 'sales_orders', soVoidId))).data()?.status).toBe('void');
    expect((await getDoc(doc(getFirebaseDb(), 'stock_balances', productIds[1]))).data()?.qty).toBe(prod1Before);

    await signInAs(OWNER_EMAIL, OWNER_PASS);
    const journals = await fetchJournalEntries(50);
    const target = journals.items.find((j) => j.source === 'operating_expense');
    expect(target).toBeDefined();
    const revId = await createReversalJournal({
      actorUid: ownerUid,
      actorName: 'Owner Utama',
      original: target!,
      tanggal: '2026-11-10',
      alasan: 'Koreksi pos gaji admin',
    });
    expect(revId).toBeTruthy();
  });

  it('Skenario 7: Pemisahan Hak Owner vs Admin + Fail-Closed Role Lama (gudang) + User Nonaktif', async () => {
    // 1. Admin boleh menutup periode, tetapi DILARANG membuka ulang periode tertutup & DILARANG kelola user
    await signInAs(ADMIN_EMAIL, ADMIN_PASS);
    await expect(fetchUsers()).rejects.toThrow();

    await setPeriodClosed({
      actorUid: adminUid,
      actorName: 'Admin Operasional',
      periodId: '2026-10',
      closed: true,
      note: 'Tutup buku Oktober oleh Admin',
    });

    await expect(
      setPeriodClosed({
        actorUid: adminUid,
        actorName: 'Admin Operasional',
        periodId: '2026-10',
        closed: false,
        note: 'Admin coba buka ulang',
      }),
    ).rejects.toThrow();

    // Admin dilarang mengubah saldo akun secara langsung tanpa audit_log/payment
    await expect(
      updateDoc(doc(getFirebaseDb(), 'accounts', kasAccountId), {
        saldoBerjalan: 99999999,
      }),
    ).rejects.toThrow();

    // 2. Owner berhak membuka ulang periode dengan audit_logs, catat koreksi, lalu tutup kembali
    await signInAs(OWNER_EMAIL, OWNER_PASS);
    await setPeriodClosed({
      actorUid: ownerUid,
      actorName: 'Owner Utama',
      periodId: '2026-10',
      closed: false,
      note: 'Reopen oleh Owner',
    });

    await recordStockMutation({
      actorUid: ownerUid,
      actorName: 'Owner Utama',
      actorRole: 'owner',
      itemId: materialIds[0],
      itemType: 'material',
      jenis: 'opname_koreksi',
      qty: 2,
      tanggal: '2026-10-20',
      refType: 'opname',
      refId: 'OP-REOPEN-OK',
      catatan: 'Koreksi sah saat reopened',
    });

    await new Promise((r) => setTimeout(r, 50));
    await setPeriodClosed({
      actorUid: ownerUid,
      actorName: 'Owner Utama',
      periodId: '2026-10',
      closed: true,
      note: 'Tutup buku Oktober final',
    });

    // Owner dilarang mengubah role/status aktif dirinya sendiri
    await expect(
      updateDoc(doc(getFirebaseDb(), 'users', ownerUid), {
        nama: 'Owner Utama',
        email: OWNER_EMAIL,
        role: 'admin',
        active: true,
      }),
    ).rejects.toThrow();

    // 3. Role lama ('gudang') ditolak total (fail-closed)
    await signInAs(LEGACY_EMAIL, LEGACY_PASS);
    await expect(getDocs(collection(getFirebaseDb(), 'products'))).rejects.toThrow();

    // 4. User yang dinonaktifkan Owner langsung ditolak
    await signInAs(OWNER_EMAIL, OWNER_PASS);
    await updateUserRoleStatus({
      actorUid: ownerUid,
      actorName: 'Owner Utama',
      target: {
        uid: tempUid,
        nama: 'Staf Sementara',
        email: TEMP_EMAIL,
        role: 'admin',
        active: true,
      },
      role: 'admin',
      active: false,
    });

    await signInAs(TEMP_EMAIL, TEMP_PASS);
    await expect(getDocs(collection(getFirebaseDb(), 'products'))).rejects.toThrow();
  });

  it('Skenario 8: Uji Konkurensi Nyata pada Bahan Baku (stok 100 cm -> 2 permintaan potong 80 vs 80): hanya 1 sukses, bahan TIDAK pernah minus', async () => {
    await signInAs(OWNER_EMAIL, OWNER_PASS);
    concurrencyMaterialId = await saveMaterial({
      actorUid: ownerUid,
      kode: 'BHN-CONC',
      nama: 'Kain Uji Konkurensi',
      kategori: 'kain',
      satuanBeli: 'roll',
      satuanPakai: 'cm',
      konversi: 100,
      minStock: 10,
    });
    await recordStockMutation({
      actorUid: ownerUid,
      actorName: 'Owner Utama',
      actorRole: 'owner',
      itemId: concurrencyMaterialId,
      itemType: 'material',
      jenis: 'penerimaan',
      qty: 100,
      tanggal: '2026-11-11',
      refType: 'init_conc',
      refId: 'CONC-MAT-INIT',
      catatan: 'Stok 100 cm untuk uji konkurensi',
    });

    await signInAs(ADMIN_EMAIL, ADMIN_PASS);
    const makeCut = (suffix: string) =>
      recordStockMutation({
        actorUid: adminUid,
        actorName: 'Admin Operasional',
        actorRole: 'admin',
        itemId: concurrencyMaterialId,
        itemType: 'material',
        jenis: 'pemakaian_produksi',
        qty: -80,
        tanggal: '2026-11-11',
        refType: 'work_order',
        refId: `WO-CONC-${suffix}`,
        catatan: `Potong konkurensi ${suffix}`,
      });

    const settled = await Promise.allSettled([makeCut('A'), makeCut('B')]);
    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const balSnap = await getDoc(doc(getFirebaseDb(), 'stock_balances', concurrencyMaterialId));
    expect(balSnap.data()?.qty).toBe(20);
  });

  it('Skenario 9: Cek Integritas Akhir pada seluruh data riil = 0 temuan, lalu 6 manipulasi disuntik terdeteksi semua', async () => {
    await signInAs(OWNER_EMAIL, OWNER_PASS);

    // Note: WO konkurensi tidak dibuat dokumen work_orders karena recordStockMutation langsung di Skenario 8;
    // buat stub WO-CONC-A/B yang sah tidak perlu jika Skenario 8 pakai refId yang tidak orphan—tunggu!
    // Integrity check mendeteksi orphan_ledger_wo bila pemakaian_produksi menunjuk work_orders yang tidak ada!
    // Mari buat dokumen work_orders untuk WO-CONC yang berhasil atau periksa refId-nya terlebih dahulu.
    const concLedgerSnap = await fetchAllStockLedgerPaginated();
    const concEntries = concLedgerSnap.items.filter(
      (e) => e.itemId === concurrencyMaterialId && e.jenis === 'pemakaian_produksi',
    );
    for (const ce of concEntries) {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'work_orders', ce.refId), {
          woNumber: ce.refId,
          productId: productIds[0],
          targetQty: 1,
          completedQty: 0,
          wipQty: 1,
          rejectedQty: 0,
          cutCompleted: true,
          cutMaterialIds: [concurrencyMaterialId],
          currentStage: 'setoran',
          status: 'in_progress',
          tanggal: '2026-11-11',
          catatan: 'WO uji konkurensi',
          createdBy: adminUid,
          createdAt: serverTimestamp(),
        });
      });
    }

    const runFullAuditFromRepos = async () => {
      const [
        accRes,
        balRes,
        ledRes,
        soRes,
        payRes,
        retRes,
        pcRes,
        prRes,
        expRes,
        jRes,
        woRes,
        perRes,
        matRes,
        prodRes,
        chRes,
        mpRes,
        wageRes,
      ] = await Promise.all([
        fetchAllAccountsPaginated(),
        fetchAllStockBalancesPaginated(),
        fetchAllStockLedgerPaginated(),
        fetchAllSalesOrdersPaginated(),
        fetchAllPaymentsPaginated(),
        fetchAllSalesReturnsPaginated(),
        fetchAllPurchaseCostsPaginated(),
        fetchAllProductionCostsPaginated(),
        fetchAllOperatingExpensesPaginated(),
        fetchAllJournalEntriesPaginated(),
        fetchAllWorkOrdersPaginated(),
        fetchAllPeriodsPaginated(),
        fetchAllMaterialsPaginated(),
        fetchAllProductsPaginated(),
        fetchAllMarketplaceChannelsPaginated(),
        fetchAllMarketplacePayoutsPaginated(),
        fetchAllWagePayoutsPaginated(),
      ]);

      const soItemsByOrderId: Record<string, SalesOrderItem[]> = {};
      await Promise.all(
        soRes.items.map(async (so) => {
          soItemsByOrderId[so.id] = await fetchSalesOrderItems(so.id);
        }),
      );
      const stageLogsByWoId: Record<string, StageLog[]> = {};
      await Promise.all(
        woRes.items.map(async (wo) => {
          stageLogsByWoId[wo.id] = (await fetchStageLogs(wo.id, 100)).items;
        }),
      );

      const itemLabels: Record<string, string> = {};
      matRes.items.forEach((m) => {
        itemLabels[m.id] = m.nama;
      });
      prodRes.items.forEach((p) => {
        itemLabels[p.id] = p.nama;
      });

      return computeIntegrityAuditReport({
        accounts: accRes.items,
        balances: balRes.items,
        ledgerEntries: ledRes.items,
        salesOrders: soRes.items,
        soItemsByOrderId,
        payments: payRes.items,
        salesReturns: retRes.items,
        purchaseCosts: pcRes.items,
        productionCosts: prRes.items,
        operatingExpenses: expRes.items,
        journalEntries: jRes.items,
        workOrders: woRes.items,
        stageLogsByWoId,
        periods: perRes.items,
        products: prodRes.items,
        marketplaceChannels: chRes.items,
        marketplacePayouts: mpRes.items,
        wagePayouts: wageRes.items,
        itemLabels,
      });
    };

    // 1. Bersih sebelum manipulasi
    const cleanAudit = await runFullAuditFromRepos();
    expect(cleanAudit.discrepancies).toEqual([]);

    // 2. Suntik 6 manipulasi via withSecurityRulesDisabled
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      // M1: Ubah saldoBerjalan akun kas tanpa transaksi
      await updateDoc(doc(adminDb, 'accounts', kasAccountId), {
        saldoBerjalan: 99999999,
      });

      // M2: Ubah saldo marketplace TikTok tanpa pencairan
      await updateDoc(doc(adminDb, 'marketplace_channels', 'tiktok'), {
        balance: 88888888,
      });

      // M3: Tambah payment yatim (soId tidak ada)
      await setDoc(doc(adminDb, 'payments', 'pay-orphan-injected'), {
        soId: 'so-tidak-ada',
        soNumber: 'SO-HANTU',
        accountId: bankAccountId,
        accountName: 'Bank BCA',
        amount: 250000,
        tanggal: '2026-11-12',
        metode: 'Tunai',
        catatan: 'Suntikan payment yatim',
        createdBy: adminUid,
        createdAt: serverTimestamp(),
      });

      // M4: Retur melebihi qty terjual pada SO 6 SKU (productIds[1] terjual 2, retur 5)
      await setDoc(doc(adminDb, 'sales_returns', 'ret-over-injected'), {
        soId: so6Id,
        soNumber: 'SO-INT-6SKU',
        productId: productIds[1],
        qty: 5,
        refundAmount: 650000,
        restockable: false,
        alasan: 'Suntikan retur berlebih',
        tanggal: '2026-11-12',
        createdBy: adminUid,
        createdAt: serverTimestamp(),
      });

      // M5: Jurnal source 'sales_order' dengan nominal salah
      await setDoc(doc(adminDb, 'journal_entries', 'j-mismatch-injected'), {
        tanggal: '2026-11-12',
        source: 'sales_order',
        refId: so6Id,
        debitAccount: 'piutang_usaha',
        creditAccount: 'pendapatan_penjualan',
        amount: 12345,
        deskripsi: 'Suntikan jurnal nominal salah',
        createdBy: adminUid,
        createdAt: serverTimestamp(),
      });

      // M6: WO completed tanpa hasil_produksi sama sekali
      await setDoc(doc(adminDb, 'work_orders', 'wo-no-output-injected'), {
        woNumber: 'WO-HANTU',
        productId: productIds[2],
        targetQty: 15,
        completedQty: 15,
        wipQty: 0,
        rejectedQty: 0,
        currentStage: 'completed',
        status: 'completed',
        tanggal: '2026-11-12',
        catatan: 'Suntikan WO tanpa hasil produksi',
        createdBy: adminUid,
        createdAt: serverTimestamp(),
      });
    });

    const tamperedAudit = await runFullAuditFromRepos();
    const kinds = new Set(tamperedAudit.discrepancies.map((d) => d.kind));
    expect(kinds.has('cash_balance')).toBe(true);
    expect(kinds.has('marketplace_balance')).toBe(true);
    expect(kinds.has('orphan_payment')).toBe(true);
    expect(kinds.has('return_exceeds_sold')).toBe(true);
    expect(kinds.has('journal_source_mismatch')).toBe(true);
    expect(kinds.has('wo_completed_without_output')).toBe(true);
  });
});
