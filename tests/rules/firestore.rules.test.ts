import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const OWNER_UID = 'owner-1';
const ADMIN_UID = 'admin-1';
const ADMIN2_UID = 'admin-2';
const LEGACY_ROLE_UID = 'legacy-gudang-1';
const INACTIVE_UID = 'inactive-1';
const ORPHAN_UID = 'orphan-1';

beforeAll(async () => {
  const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: 'konveksiops-rules-test',
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', OWNER_UID), {
      nama: 'Owner',
      email: 'owner@konveksi.test',
      role: 'owner',
      active: true,
    });
    await setDoc(doc(db, 'users', ADMIN_UID), {
      nama: 'Admin Satu',
      email: 'admin1@konveksi.test',
      role: 'admin',
      active: true,
    });
    await setDoc(doc(db, 'users', ADMIN2_UID), {
      nama: 'Admin Dua',
      email: 'admin2@konveksi.test',
      role: 'admin',
      active: true,
    });
    // Akun role lama ('gudang') harus ditolak fail-closed oleh rules
    await setDoc(doc(db, 'users', LEGACY_ROLE_UID), {
      nama: 'Role Lama',
      email: 'legacy@konveksi.test',
      role: 'gudang',
      active: true,
    });
    await setDoc(doc(db, 'users', INACTIVE_UID), {
      nama: 'Nonaktif',
      email: 'nonaktif@konveksi.test',
      role: 'admin',
      active: false,
    });

    await setDoc(doc(db, 'periods', '2026-10'), {
      closed: true,
      updatedBy: OWNER_UID,
    });
    await deleteDoc(doc(db, 'periods', '2026-11'));
    await deleteDoc(doc(db, 'periods', '2026-12'));

    await setDoc(doc(db, 'accounts', 'acc-1'), {
      nama: 'Kas Utama',
      tipe: 'kas',
      nomorRekening: '',
      saldoAwal: 1000000,
      saldoBerjalan: 1000000,
      active: true,
      createdBy: OWNER_UID,
    });

    await setDoc(doc(db, 'marketplace_channels', 'tiktok'), {
      nama: 'TikTok',
      balance: 500000,
      active: true,
      createdBy: OWNER_UID,
    });

    await setDoc(doc(db, 'purchase_costs', 'pc-1'), {
      ledgerId: 'l1',
      itemId: 'm1',
      qty: 3000,
      unitCost: 1000000 / 3000,
      totalCost: 1000000,
      paidAmount: 1000000,
      tanggal: '2026-11-01',
      createdBy: OWNER_UID,
    });
    await setDoc(doc(db, 'production_costs', 'prc-1'), {
      woId: 'wo-1',
      kategori: 'jahit_cmt',
      amount: 100000,
      paidAmount: 100000,
      tanggal: '2026-11-01',
      createdBy: OWNER_UID,
    });
    await setDoc(doc(db, 'operating_expenses', 'exp-1'), {
      kategori: 'Listrik',
      deskripsi: 'PLN',
      accountId: 'acc-1',
      amount: 50000,
      tanggal: '2026-11-01',
      createdBy: OWNER_UID,
    });
    await setDoc(doc(db, 'journal_entries', 'j-1'), {
      tanggal: '2026-11-01',
      source: 'manual',
      debitAccount: 'kas_bank',
      creditAccount: 'modal',
      amount: 1000000,
      createdBy: OWNER_UID,
    });
    await setDoc(doc(db, 'bank_statements', 'bs-1'), {
      accountId: 'acc-1',
      tanggal: '2026-11-01',
      deskripsi: 'Mutasi Awal',
      amount: 1000000,
      createdBy: OWNER_UID,
    });
    await setDoc(doc(db, 'audit_logs', 'audit-init'), {
      uid: OWNER_UID,
      createdBy: OWNER_UID,
      aksi: 'INIT',
      targetCollection: 'accounts',
      targetId: 'acc-1',
      sebelum: '{}',
      sesudah: '{}',
    });

    await setDoc(doc(db, 'materials', 'm1'), {
      kode: 'K-01',
      nama: 'Kain Cordura',
      kategori: 'kain',
      satuan: 'cm',
      satuanBeli: 'roll',
      satuanPakai: 'cm',
      konversi: 5000,
      minStock: 500,
      active: true,
      createdBy: OWNER_UID,
    });
    await setDoc(doc(db, 'stock_balances', 'm1'), {
      itemId: 'm1',
      itemType: 'material',
      qty: 2000,
      lastLedgerId: 'init-mat-1',
    });
    await setDoc(doc(db, 'stock_ledger', 'init-mat-1'), {
      itemId: 'm1',
      itemType: 'material',
      jenis: 'penerimaan',
      qty: 2000,
      tanggal: '2026-11-01',
      refType: 'init',
      refId: 'init',
      balance_before: 0,
      balance_after: 2000,
      createdBy: ADMIN_UID,
    });

    await setDoc(doc(db, 'stock_balances', 'prod-1'), {
      itemId: 'prod-1',
      itemType: 'product',
      qty: 10,
      lastLedgerId: 'init-1',
    });
    await setDoc(doc(db, 'stock_ledger', 'init-1'), {
      itemId: 'prod-1',
      itemType: 'product',
      jenis: 'hasil_produksi',
      qty: 10,
      tanggal: '2026-11-01',
      refType: 'init',
      refId: 'init',
      balance_before: 0,
      balance_after: 10,
      createdBy: ADMIN_UID,
    });
    for (const i of [2, 3, 4, 5, 6]) {
      const pid = `prod-${i}`;
      const lid = `init-${i}`;
      await setDoc(doc(db, 'stock_balances', pid), {
        itemId: pid,
        itemType: 'product',
        qty: 20,
        lastLedgerId: lid,
      });
      await setDoc(doc(db, 'stock_ledger', lid), {
        itemId: pid,
        itemType: 'product',
        jenis: 'hasil_produksi',
        qty: 20,
        tanggal: '2026-11-01',
        refType: 'init',
        refId: 'init',
        balance_before: 0,
        balance_after: 20,
        createdBy: ADMIN_UID,
      });
    }

    await setDoc(doc(db, 'sales_orders', 'so-1'), {
      soNumber: 'SO-001',
      customerId: 'marketplace',
      customerName: 'TikTok',
      channel: 'TikTok',
      noPesanan: 'TT-001',
      totalAmount: 500000,
      biayaAdmin: 25000,
      komisiAffiliate: 15000,
      potonganLain: 0,
      penerimaanBersih: 460000,
      paidAmount: 500000,
      paymentStatus: 'paid',
      shippingStatus: 'pending',
      status: 'active',
      tanggal: '2026-11-02',
      createdBy: ADMIN_UID,
    });
    await setDoc(doc(db, 'sales_orders', 'so-1', 'items', 'line-1'), {
      productId: 'prod-1',
      productName: 'Ransel',
      sku: 'RN-01',
      qty: 5,
      unitPrice: 100000,
      subtotal: 500000,
    });

    await setDoc(doc(db, 'opname_requests', 'op-1'), {
      itemId: 'prod-1',
      itemType: 'product',
      systemQty: 10,
      physicalQty: 12,
      diffQty: 2,
      alasan: 'Temuan rak B',
      tanggal: '2026-11-02',
      status: 'pending',
      createdBy: ADMIN_UID,
    });
  });
});

describe('Firestore Security Rules & RBAC (Owner & Admin + Adaptasi Usaha Tas)', () => {
  it('E.1: menolak orphan, user nonaktif, & role lama ("gudang"); mengizinkan owner & admin aktif', async () => {
    const orphanDb = testEnv.authenticatedContext(ORPHAN_UID).firestore();
    const inactiveDb = testEnv.authenticatedContext(INACTIVE_UID).firestore();
    const legacyDb = testEnv.authenticatedContext(LEGACY_ROLE_UID).firestore();
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();

    await assertFails(getDoc(doc(orphanDb, 'materials', 'm1')));
    await assertFails(getDoc(doc(inactiveDb, 'materials', 'm1')));
    await assertFails(getDoc(doc(legacyDb, 'materials', 'm1')));
    await assertFails(getDoc(doc(orphanDb, 'stock_balances', 'prod-1')));
    await assertSucceeds(getDoc(doc(adminDb, 'materials', 'm1')));
  });

  it('E.2: menolak eskalasi/ubah role diri sendiri & tolak admin ubah user lain; hanya owner ubah user lain', async () => {
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      updateDoc(doc(adminDb, 'users', ADMIN_UID), {
        nama: 'Admin Satu',
        email: 'admin1@konveksi.test',
        role: 'owner',
        active: true,
      }),
    );
    await assertFails(
      setDoc(doc(adminDb, 'users', 'user-baru'), {
        nama: 'User Baru',
        email: 'baru@konveksi.test',
        role: 'admin',
        active: true,
      }),
    );

    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(
      updateDoc(doc(ownerDb, 'users', OWNER_UID), {
        nama: 'Owner',
        email: 'owner@konveksi.test',
        role: 'admin',
        active: true,
      }),
    );

    await assertSucceeds(
      updateDoc(doc(ownerDb, 'users', ADMIN_UID), {
        nama: 'Admin Senior',
        email: 'admin1@konveksi.test',
        role: 'admin',
        active: false,
      }),
    );
  });

  it('E.3: admin dilarang list users atau baca user lain, hanya get profil sendiri; owner boleh list semua', async () => {
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();

    await assertFails(getDoc(doc(adminDb, 'users', OWNER_UID)));
    await assertFails(getDocs(collection(adminDb, 'users')));

    await assertSucceeds(getDoc(doc(adminDb, 'users', ADMIN_UID)));
    await assertSucceeds(getDocs(collection(ownerDb, 'users')));
  });

  it('E.4: admin & owner dapat membaca seluruh koleksi operasional, biaya, marketplace, upah, jurnal, & audit_logs', async () => {
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();

    for (const [colName, docId] of [
      ['purchase_costs', 'pc-1'],
      ['production_costs', 'prc-1'],
      ['operating_expenses', 'exp-1'],
      ['journal_entries', 'j-1'],
      ['bank_statements', 'bs-1'],
      ['audit_logs', 'audit-init'],
      ['marketplace_channels', 'tiktok'],
    ] as const) {
      await assertSucceeds(getDoc(doc(adminDb, colName, docId)));
      await assertSucceeds(getDoc(doc(ownerDb, colName, docId)));
    }
  });

  it('E.5: mutasi accounts.saldoBerjalan wajib berpasangan dengan payments atau audit_logs', async () => {
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();

    // 1. Update saldoBerjalan sembarang -> DITOLAK
    await assertFails(
      updateDoc(doc(adminDb, 'accounts', 'acc-1'), {
        saldoBerjalan: 9999999,
      }),
    );

    // 2. Payment dengan selisih tidak cocok -> DITOLAK
    await assertFails(
      runTransaction(adminDb, async (tx) => {
        tx.set(doc(adminDb, 'payments', 'pay-mismatch'), {
          soId: 'so-1',
          accountId: 'acc-1',
          amount: 100000,
          tanggal: '2026-11-05',
          createdBy: ADMIN_UID,
          createdAt: serverTimestamp(),
        });
        tx.update(doc(adminDb, 'accounts', 'acc-1'), {
          saldoBerjalan: 1200000,
          lastPaymentId: 'pay-mismatch',
        });
      }),
    );

    // 3. Payment sah berpasangan dengan payments/{lastPaymentId} -> DIIZINKAN
    await assertSucceeds(
      runTransaction(adminDb, async (tx) => {
        tx.set(doc(adminDb, 'payments', 'pay-valid-1'), {
          soId: 'so-1',
          accountId: 'acc-1',
          amount: 250000,
          tanggal: '2026-11-05',
          createdBy: ADMIN_UID,
          createdAt: serverTimestamp(),
        });
        tx.update(doc(adminDb, 'accounts', 'acc-1'), {
          saldoBerjalan: 1250000,
          lastPaymentId: 'pay-valid-1',
        });
      }),
    );

    // 4. Perubahan kas oleh admin/owner disertai audit_logs dalam transaksi sama -> DIIZINKAN
    await assertSucceeds(
      runTransaction(ownerDb, async (tx) => {
        tx.update(doc(ownerDb, 'accounts', 'acc-1'), {
          saldoBerjalan: 1200000,
          lastAuditLogId: 'audit-cash-out-1',
        });
        tx.set(doc(ownerDb, 'audit_logs', 'audit-cash-out-1'), {
          uid: OWNER_UID,
          createdBy: OWNER_UID,
          aksi: 'OPERATING_EXPENSE_CASH_OUT',
          targetCollection: 'accounts',
          targetId: 'acc-1',
          sebelum: '{"saldoBerjalan":1250000}',
          sesudah: '{"saldoBerjalan":1200000}',
          createdAt: serverTimestamp(),
        });
      }),
    );
  });

  it('E.6: melarang update/delete append-only collections & pemalsuan uid pada audit_logs', async () => {
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();

    await assertFails(updateDoc(doc(ownerDb, 'stock_ledger', 'init-1'), { qty: 99 }));
    await assertFails(deleteDoc(doc(ownerDb, 'stock_ledger', 'init-1')));
    await assertFails(updateDoc(doc(ownerDb, 'sales_orders', 'so-1', 'items', 'line-1'), { qty: 10 }));
    await assertFails(deleteDoc(doc(ownerDb, 'journal_entries', 'j-1')));
    await assertFails(updateDoc(doc(ownerDb, 'audit_logs', 'audit-init'), { aksi: 'TAMPERED' }));
    await assertFails(deleteDoc(doc(ownerDb, 'audit_logs', 'audit-init')));

    await assertFails(
      setDoc(doc(adminDb, 'audit_logs', 'audit-forge'), {
        uid: OWNER_UID,
        createdBy: OWNER_UID,
        aksi: 'FORGE',
        targetCollection: 'stock_balances',
        targetId: 'prod-1',
        createdAt: serverTimestamp(),
      }),
    );

    await assertSucceeds(
      setDoc(doc(adminDb, 'audit_logs', 'audit-valid-admin'), {
        uid: ADMIN_UID,
        createdBy: ADMIN_UID,
        aksi: 'LOG_ADMIN',
        targetCollection: 'sales_orders',
        targetId: 'so-1',
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('E.7 (Aturan Stok Minus): product BOLEH minus (owner & admin), material & wip DILARANG minus (bahkan oleh owner)', async () => {
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();

    // 1. Produk jadi menjadi minus oleh admin -> DIIZINKAN (untuk tanda merah Perlu Opname)
    await assertSucceeds(
      runTransaction(adminDb, async (tx) => {
        tx.set(doc(adminDb, 'stock_ledger', 'l-prod-minus-ok'), {
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'penjualan',
          qty: -15,
          tanggal: '2026-11-05',
          refType: 'sales_order',
          refId: 'so-1',
          balance_before: 10,
          balance_after: -5,
          createdBy: ADMIN_UID,
          createdAt: serverTimestamp(),
        });
        tx.set(doc(adminDb, 'stock_balances', 'prod-1'), {
          itemId: 'prod-1',
          itemType: 'product',
          qty: -5,
          lastLedgerId: 'l-prod-minus-ok',
          updatedAt: serverTimestamp(),
        });
      }),
    );

    // 2. Material minus oleh Owner sekalipun -> DITOLAK
    await assertFails(
      runTransaction(ownerDb, async (tx) => {
        tx.set(doc(ownerDb, 'stock_ledger', 'l-mat-minus-deny'), {
          itemId: 'm1',
          itemType: 'material',
          jenis: 'pemakaian_produksi',
          qty: -3000,
          tanggal: '2026-11-05',
          refType: 'wo',
          refId: 'wo-1',
          balance_before: 2000,
          balance_after: -1000,
          createdBy: OWNER_UID,
          createdAt: serverTimestamp(),
        });
        tx.set(doc(ownerDb, 'stock_balances', 'm1'), {
          itemId: 'm1',
          itemType: 'material',
          qty: -1000,
          lastLedgerId: 'l-mat-minus-deny',
        });
      }),
    );

    // 3. WIP minus oleh Owner -> DITOLAK
    await assertFails(
      runTransaction(ownerDb, async (tx) => {
        tx.set(doc(ownerDb, 'stock_ledger', 'l-wip-minus-deny'), {
          itemId: 'wip-wo-1',
          itemType: 'wip',
          jenis: 'wip_keluar',
          qty: -5,
          tanggal: '2026-11-05',
          refType: 'wo',
          refId: 'wo-1',
          balance_before: 0,
          balance_after: -5,
          createdBy: OWNER_UID,
          createdAt: serverTimestamp(),
        });
        tx.set(doc(ownerDb, 'stock_balances', 'wip-wo-1'), {
          itemId: 'wip-wo-1',
          itemType: 'wip',
          qty: -5,
          lastLedgerId: 'l-wip-minus-deny',
        });
      }),
    );

    // 4. Replay stock_balances tanpa ledger baru -> DITOLAK
    await assertFails(
      updateDoc(doc(ownerDb, 'stock_balances', 'm1'), {
        qty: 9999,
        lastLedgerId: 'init-mat-1',
      }),
    );
  });

  it('E.8: admin & owner dapat ajukan serta memproses opname', async () => {
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();

    await assertSucceeds(
      setDoc(doc(adminDb, 'opname_requests', 'op-2'), {
        itemId: 'prod-1',
        itemType: 'product',
        systemQty: 10,
        physicalQty: 9,
        diffQty: -1,
        alasan: 'Susut rak',
        tanggal: '2026-11-05',
        status: 'pending',
        createdBy: ADMIN_UID,
        createdAt: serverTimestamp(),
      }),
    );

    await assertSucceeds(
      updateDoc(doc(ownerDb, 'opname_requests', 'op-1'), {
        status: 'approved',
        approvedBy: OWNER_UID,
        approvedAt: serverTimestamp(),
      }),
    );
  });

  it('E.9: admin & owner dapat void SO bila disertai reversal ledger yang sah', async () => {
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();

    await assertSucceeds(
      runTransaction(adminDb, async (tx) => {
        tx.update(doc(adminDb, 'sales_orders', 'so-1'), { status: 'void' });
        tx.set(doc(adminDb, 'stock_ledger', 'l-rev-admin'), {
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'reversal',
          qty: 5,
          tanggal: '2026-11-05',
          refType: 'void_sales_order',
          refId: 'so-1',
          balance_before: 10,
          balance_after: 15,
          createdBy: ADMIN_UID,
          createdAt: serverTimestamp(),
        });
        tx.set(doc(adminDb, 'stock_balances', 'prod-1'), {
          itemId: 'prod-1',
          itemType: 'product',
          qty: 15,
          lastLedgerId: 'l-rev-admin',
        });
      }),
    );
  });

  it('E.10: menolak transaksi periode closed & mengizinkan SO 6 SKU berbeda + marketplace/pembayaran dalam batas 20 get() rules', async () => {
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();

    await assertFails(
      runTransaction(adminDb, async (tx) => {
        tx.set(doc(adminDb, 'stock_ledger', 'l-closed'), {
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'hasil_produksi',
          qty: 5,
          tanggal: '2026-10-15',
          refType: 'wo',
          refId: 'wo1',
          balance_before: 10,
          balance_after: 15,
          createdBy: ADMIN_UID,
          createdAt: serverTimestamp(),
        });
        tx.set(doc(adminDb, 'stock_balances', 'prod-1'), {
          itemId: 'prod-1',
          itemType: 'product',
          qty: 15,
          lastLedgerId: 'l-closed',
        });
      }),
    );

    await assertSucceeds(
      runTransaction(adminDb, async (tx) => {
        const soId = 'so-6-items';
        tx.set(doc(adminDb, 'sales_orders', soId), {
          soNumber: 'SO-SIX',
          customerId: 'marketplace',
          customerName: 'Shopee',
          channel: 'Shopee',
          noPesanan: 'SHP-SIX',
          totalAmount: 600000,
          biayaAdmin: 30000,
          komisiAffiliate: 10000,
          potonganLain: 0,
          penerimaanBersih: 560000,
          paidAmount: 600000,
          paymentStatus: 'paid',
          shippingStatus: 'pending',
          status: 'active',
          tanggal: '2026-11-12',
          catatan: '',
          createdBy: ADMIN_UID,
          createdAt: serverTimestamp(),
        });
        for (const i of [1, 2, 3, 4, 5, 6]) {
          const pid = `prod-${i}`;
          const prevQty = i === 1 ? 10 : 20;
          const lid = `l-six-${i}`;
          tx.set(doc(adminDb, 'sales_orders', soId, 'items', `line-${i}`), {
            productId: pid,
            productName: `Tas ${i}`,
            sku: `SKU-${i}`,
            qty: 1,
            unitPrice: 100000,
            subtotal: 100000,
          });
          tx.set(doc(adminDb, 'stock_ledger', lid), {
            itemId: pid,
            itemType: 'product',
            jenis: 'penjualan',
            qty: -1,
            tanggal: '2026-11-12',
            refType: 'sales_order',
            refId: soId,
            balance_before: prevQty,
            balance_after: prevQty - 1,
            createdBy: ADMIN_UID,
            createdAt: serverTimestamp(),
          });
          tx.set(doc(adminDb, 'stock_balances', pid), {
            itemId: pid,
            itemType: 'product',
            qty: prevQty - 1,
            lastLedgerId: lid,
          });
        }
        tx.set(doc(adminDb, 'journal_entries', 'j-six-1'), {
          tanggal: '2026-11-12',
          source: 'sales_order',
          refId: soId,
          debitAccount: 'saldo_marketplace',
          creditAccount: 'pendapatan_penjualan',
          amount: 560000,
          createdBy: ADMIN_UID,
          createdAt: serverTimestamp(),
        });
      }),
    );
  });

  it('E.12: wajibkan kombinasi itemType per jenis pada stock_ledger', async () => {
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();

    await assertFails(
      runTransaction(adminDb, async (tx) => {
        tx.set(doc(adminDb, 'stock_ledger', 'l-bad-mat'), {
          itemId: 'm1',
          itemType: 'material',
          jenis: 'penjualan',
          qty: -1,
          tanggal: '2026-11-12',
          refType: 'sales_order',
          refId: 'so-1',
          balance_before: 2000,
          balance_after: 1999,
          createdBy: ADMIN_UID,
          createdAt: serverTimestamp(),
        });
        tx.set(doc(adminDb, 'stock_balances', 'm1'), {
          itemId: 'm1',
          itemType: 'material',
          qty: 1999,
          lastLedgerId: 'l-bad-mat',
        });
      }),
    );

    await assertFails(
      runTransaction(adminDb, async (tx) => {
        tx.set(doc(adminDb, 'stock_ledger', 'l-bad-prod'), {
          itemId: 'prod-1',
          itemType: 'product',
          jenis: 'penerimaan',
          qty: 5,
          tanggal: '2026-11-12',
          refType: 'manual',
          refId: 'MAN-1',
          balance_before: 10,
          balance_after: 15,
          createdBy: ADMIN_UID,
          createdAt: serverTimestamp(),
        });
        tx.set(doc(adminDb, 'stock_balances', 'prod-1'), {
          itemId: 'prod-1',
          itemType: 'product',
          qty: 15,
          lastLedgerId: 'l-bad-prod',
        });
      }),
    );
  });

  it('E.14: reopen periode (closed true->false) STRICTLY OWNER-ONLY + audit_logs; admin DITOLAK reopen tapi BOLEH tutup periode', async () => {
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();

    // Admin mencoba reopen periode 2026-10 meski pakai audit_logs -> DITOLAK!
    await assertFails(
      runTransaction(adminDb, async (tx) => {
        tx.set(doc(adminDb, 'periods', '2026-10'), {
          closed: false,
          closedNote: 'Admin reopen',
          updatedBy: ADMIN_UID,
          updatedAt: serverTimestamp(),
          lastAuditLogId: 'audit-admin-reopen',
        });
        tx.set(doc(adminDb, 'audit_logs', 'audit-admin-reopen'), {
          uid: ADMIN_UID,
          createdBy: ADMIN_UID,
          aksi: 'REOPEN_PERIOD',
          targetCollection: 'periods',
          targetId: '2026-10',
          createdAt: serverTimestamp(),
        });
      }),
    );

    // Owner reopen tanpa audit_logs -> DITOLAK
    await assertFails(
      setDoc(doc(ownerDb, 'periods', '2026-10'), {
        closed: false,
        closedNote: 'Owner tanpa log',
        updatedBy: OWNER_UID,
        updatedAt: serverTimestamp(),
      }),
    );

    // Owner reopen dengan audit_logs sah -> DIIZINKAN
    await assertSucceeds(
      runTransaction(ownerDb, async (tx) => {
        tx.set(doc(ownerDb, 'periods', '2026-10'), {
          closed: false,
          closedNote: 'Koreksi resmi',
          updatedBy: OWNER_UID,
          updatedAt: serverTimestamp(),
          lastAuditLogId: 'audit-owner-reopen',
        });
        tx.set(doc(ownerDb, 'audit_logs', 'audit-owner-reopen'), {
          uid: OWNER_UID,
          createdBy: OWNER_UID,
          aksi: 'REOPEN_PERIOD',
          targetCollection: 'periods',
          targetId: '2026-10',
          sebelum: '{"closed":true}',
          sesudah: '{"closed":false}',
          createdAt: serverTimestamp(),
        });
      }),
    );

    // Admin menutup periode baru (closed: true) -> DIIZINKAN
    await assertSucceeds(
      setDoc(doc(adminDb, 'periods', '2026-12'), {
        closed: true,
        closedNote: 'Tutup buku Desember',
        updatedBy: ADMIN_UID,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('E.19: koleksi baru (Resep cost, unitCost float, marketplace_channels/mappings/payouts, wage_payouts, accounting_settings) sesuai whitelist & tolak field liar', async () => {
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();

    // 1. purchase_costs menerima unitCost pecahan float + satuan beli
    await assertSucceeds(
      setDoc(doc(adminDb, 'purchase_costs', 'pc-float-ok'), {
        ledgerId: 'init-mat-1',
        itemId: 'm1',
        supplierId: 'sup-1',
        qty: 3000,
        unitCost: 1000000 / 3000,
        totalCost: 1000000,
        paidAmount: 0,
        accountId: '',
        purchaseQty: 1,
        purchaseUnit: 'roll',
        actualUsageQty: 3000,
        tanggal: '2026-11-15',
        catatan: 'Harga total dibagi cm',
        createdBy: ADMIN_UID,
        createdAt: serverTimestamp(),
      }),
    );

    // purchase_costs totalCost pecahan -> DITOLAK (uang totalCost wajib int)
    await assertFails(
      setDoc(doc(adminDb, 'purchase_costs', 'pc-float-total-bad'), {
        ledgerId: 'init-mat-1',
        itemId: 'm1',
        supplierId: 'sup-1',
        qty: 3000,
        unitCost: 333.33,
        totalCost: 1000000.5,
        paidAmount: 0,
        accountId: '',
        tanggal: '2026-11-15',
        catatan: '',
        createdBy: ADMIN_UID,
        createdAt: serverTimestamp(),
      }),
    );

    // 2. bom_items (Resep) baris biaya jahit_cutting -> DIIZINKAN
    await assertSucceeds(
      setDoc(doc(adminDb, 'bom_items', 'bom-cost-ok'), {
        productId: 'prod-1',
        jenis: 'cost',
        costCategory: 'jahit_cutting',
        label: 'Upah Jahit & Cutting',
        amountPerPcs: 25000,
        active: true,
        createdBy: ADMIN_UID,
        createdAt: serverTimestamp(),
      }),
    );

    // 3. marketplace_mappings & marketplace_payouts -> DIIZINKAN, field liar DITOLAK
    await assertSucceeds(
      setDoc(doc(adminDb, 'marketplace_mappings', 'tiktok'), {
        channelId: 'tiktok',
        channelName: 'TikTok',
        mappingJson: '{"tanggal":0,"noPesanan":1}',
        updatedBy: ADMIN_UID,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      setDoc(doc(adminDb, 'marketplace_payouts', 'mp-ok'), {
        channelId: 'tiktok',
        channelName: 'TikTok',
        accountId: 'acc-1',
        accountName: 'Kas Utama',
        amount: 200000,
        tanggal: '2026-11-15',
        catatan: 'Pencairan',
        createdBy: ADMIN_UID,
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(adminDb, 'marketplace_payouts', 'mp-rogue'), {
        channelId: 'tiktok',
        channelName: 'TikTok',
        accountId: 'acc-1',
        amount: 200000,
        tanggal: '2026-11-15',
        rogue: 1,
        createdBy: ADMIN_UID,
        createdAt: serverTimestamp(),
      }),
    );

    // 4. wage_payouts dengan variance benar -> DIIZINKAN; variance tidak cocok -> DITOLAK
    await assertSucceeds(
      setDoc(doc(ownerDb, 'wage_payouts', 'wp-ok'), {
        startDate: '2026-11-15',
        endDate: '2026-11-21',
        tanggal: '2026-11-21',
        accountId: 'acc-1',
        accountName: 'Kas Utama',
        jahitCuttingStandard: 11480000,
        sablonStandard: 0,
        packingStandard: 0,
        lainnyaStandard: 0,
        totalStandard: 11480000,
        jahitCuttingPaid: 11480000,
        sablonPaid: 850000,
        packingPaid: 0,
        lainnyaPaid: 0,
        totalPaid: 12330000,
        variance: 850000,
        catatan: 'Contoh 21/11',
        createdBy: OWNER_UID,
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, 'wage_payouts', 'wp-bad-var'), {
        startDate: '2026-11-15',
        endDate: '2026-11-21',
        tanggal: '2026-11-21',
        accountId: 'acc-1',
        accountName: 'Kas Utama',
        jahitCuttingStandard: 100000,
        sablonStandard: 0,
        packingStandard: 0,
        lainnyaStandard: 0,
        totalStandard: 100000,
        jahitCuttingPaid: 150000,
        sablonPaid: 0,
        packingPaid: 0,
        lainnyaPaid: 0,
        totalPaid: 150000,
        variance: 0, // salah, seharusnya 50000
        catatan: '',
        createdBy: OWNER_UID,
        createdAt: serverTimestamp(),
      }),
    );

    // 5. accounting_settings modalAwal (int >= 0 atau null)
    await assertSucceeds(
      setDoc(doc(adminDb, 'accounting_settings', 'default'), {
        modalAwal: 25000000,
        updatedBy: ADMIN_UID,
        updatedAt: serverTimestamp(),
      }),
    );

    // 6. stage_logs tahap 'potong' & 'setoran' -> DIIZINKAN + good+reject > input DITOLAK
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'work_orders', 'wo-stage-test'), {
        woNumber: 'WO-ST',
        productId: 'prod-1',
        targetQty: 50,
        completedQty: 0,
        wipQty: 50,
        currentStage: 'setoran',
        status: 'in_progress',
        tanggal: '2026-11-15',
        catatan: '',
        createdBy: ADMIN_UID,
      });
    });
    await assertSucceeds(
      setDoc(doc(adminDb, 'work_orders', 'wo-stage-test', 'stage_logs', 'sl-setoran-ok'), {
        stage: 'setoran',
        inputQty: 20,
        goodQty: 20,
        rejectQty: 0,
        reworkQty: 0,
        rejectReason: '',
        tanggal: '2026-11-15',
        createdBy: ADMIN_UID,
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(adminDb, 'work_orders', 'wo-stage-test', 'stage_logs', 'sl-over'), {
        stage: 'setoran',
        inputQty: 10,
        goodQty: 9,
        rejectQty: 2,
        reworkQty: 0,
        rejectReason: '',
        tanggal: '2026-11-15',
        createdBy: ADMIN_UID,
        createdAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(getDocs(collectionGroup(adminDb, 'stage_logs')));
  });
});
