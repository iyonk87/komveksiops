# KonveksiOps — Sistem Manajemen Usaha Konveksi (Mobile-First + Capacitor + Firebase)

Aplikasi operasional dan keuangan usaha konveksi tas end-to-end berbahasa Indonesia dengan **React + TypeScript + Vite + Tailwind CSS + Capacitor** dan backend **Firebase Auth (Email/Password) + Cloud Firestore** tanpa Cloud Functions.

---

## 1. Skema Koleksi Cloud Firestore

Seluruh nominal uang disimpan dalam **integer Rupiah**, kecuali **harga satuan bahan (`purchase_costs.unitCost`)** yang disimpan sebagai **pecahan (`number`) per satuan pakai terkecil (`cm` atau `pcs`)** karena pembulatan hanya dilakukan pada hasil akhir baris/HPP. Format tanggal transaksi `"YYYY-MM-DD"` (zona `Asia/Jakarta`), disertai `createdAt: serverTimestamp()`, `createdBy: uid`, dan snapshot `createdByName`.

### Koleksi Operasional, Produksi, Marketplace & Keuangan
- `users/{uid}`: `{ nama, email, role ('owner'|'admin'), active, createdAt, updatedAt }`
  - **Hak baca & tulis**: `admin` hanya dapat membaca (`get`) dokumen miliknya sendiri (`users/{request.auth.uid}`); `list`, tambah, dan ubah user **khusus `owner`**. Akun dengan role lama (selain `'owner'|'admin'`) ditolak fail-closed oleh `firestore.rules`.
- `materials/{id}`: `{ kode, nama, kategori ('kain'|'benang'|'kancing'|'resleting'|'hangtag'|'kemasan'|'lainnya'), satuan, satuanBeli ('roll'|'pak'|'bungkus'|'meter'|'kg'|'lusin'), satuanPakai ('cm'|'pcs'), konversi (int|null), minStock, active, createdBy, createdAt, updatedAt? }`
- `products/{id}`: `{ sku, nama, model, warna, ukuran, satuan, minStock, hargaJual, hppPerPcs?, active, createdBy, createdAt, updatedAt? }`
- `suppliers/{id}`: `{ nama, telepon, alamat, catatan, active, createdBy, createdAt }`
- `customers/{id}`: *(dipertahankan hanya untuk kompatibilitas data lama)* `{ nama, tipe, telepon, alamat, active, createdBy, createdAt }`
- `accounts/{id}`: `{ nama, tipe ('kas'|'bank'), nomorRekening, saldoAwal, saldoBerjalan, active, lastPaymentId?, lastAuditLogId?, createdBy, createdByName?, createdAt }`
- `stock_ledger/{ledgerId}` *(append-only)*: `{ itemId, itemType ('material'|'product'|'wip'), jenis, qty, tanggal, refType, refId, catatan, balance_before, balance_after, createdBy, createdByName?, createdAt }`
- `stock_balances/{itemId}`: `{ itemId, itemType, qty, lastLedgerId, updatedAt }` *(wajib berpasangan dengan `stock_ledger/{lastLedgerId}` baru; `product` diizinkan minus untuk penanda "Perlu Opname", sedangkan `material` dan `wip` dilarang minus)*
- `opname_requests/{id}`: `{ itemId, itemType ('material'|'product'), systemQty, physicalQty, diffQty, alasan, tanggal, status ('pending'|'approved'|'rejected'), createdBy, createdByName?, createdAt, approvedBy?, approvedAt? }`
- `bom_items/{id}` *(Resep SKU)*: `{ productId, jenis ('material'|'cost'), materialId?, qtyPerPcs?, costCategory? ('jahit_cutting'|'sablon'|'packing'|'lainnya'), label?, amountPerPcs?, active, createdBy, createdAt }`
- `work_orders/{woId}`: `{ woNumber, productId, targetQty, completedQty, wipQty, rejectedQty?, cutCompleted?, cutMaterialIds?, hppPerPcsSnapshot?, currentStage ('potong'|'setoran'|'reject'|'completed'|...), status, tanggal, catatan, createdBy, createdByName?, createdAt, updatedAt?, completedAt? }`
  - Subkoleksi `work_orders/{woId}/stage_logs/{logId}` *(append-only)*: `{ stage, inputQty, goodQty, rejectQty, reworkQty, rejectReason, tanggal, createdBy, createdByName?, createdAt }`
- `marketplace_channels/{id}`: `{ nama, balance, active, createdBy, createdAt, updatedAt? }` *(default idempoten: `tiktok`, `shopee`)*
- `marketplace_mappings/{id}`: `{ channelId, channelName, mappingJson, updatedBy, updatedAt }`
- `marketplace_payouts/{id}`: `{ channelId, channelName, accountId, accountName, amount, tanggal, catatan, createdBy, createdByName?, createdAt }`
- `sales_orders/{soId}`: `{ soNumber, customerId, customerName, channel, noPesanan?, totalAmount, biayaAdmin?, komisiAffiliate?, potonganLain?, penerimaanBersih?, paidAmount, paymentStatus, shippingStatus, status ('active'|'void'), importKey?, tanggal, catatan, createdBy, createdByName?, createdAt }`
  - Subkoleksi `sales_orders/{soId}/items/{lineId}`: `{ productId, productName, sku, qty, unitPrice, subtotal }`
- `payments/{id}`: `{ soId, soNumber, accountId, accountName, amount, tanggal, metode, catatan, createdBy, createdByName?, createdAt }`
- `sales_returns/{id}`: `{ soId, soNumber, productId, qty, refundAmount, restockable, alasan, tanggal, createdBy, createdByName?, createdAt }`
- `purchase_costs/{id}`: `{ ledgerId, itemId, supplierId, qty, unitCost (float), totalCost (int), paidAmount, accountId, purchaseQty?, purchaseUnit?, actualUsageQty?, tanggal, catatan, createdBy, createdByName?, createdAt }`
- `production_costs/{id}`: `{ woId, woNumber, vendorName, kategori, amount, paidAmount, accountId, tanggal, catatan, createdBy, createdByName?, createdAt }`
- `wage_payouts/{id}`: `{ startDate, endDate, tanggal, accountId, accountName, jahitCuttingStandard, sablonStandard, packingStandard, lainnyaStandard, totalStandard, jahitCuttingPaid, sablonPaid, packingPaid, lainnyaPaid, totalPaid, variance, catatan, createdBy, createdByName?, createdAt }`
- `operating_expenses/{id}`: `{ kategori, deskripsi, accountId, amount, tanggal, createdBy, createdByName?, createdAt }`
- `journal_entries/{id}` *(append-only)*: `{ tanggal, source, refId, accountId?, debitAccount, creditAccount, amount, debitAmount?, creditAmount?, deskripsi, isReversal?, reversedEntryId?, createdBy, createdByName?, createdAt }`
- `accounting_settings/{id}`: `{ modalAwal (int|null), updatedBy, updatedAt }` *(dokumen `default` kosong/null sampai diisi pemilik)*
- `periods/{YYYY-MM}`: `{ closed, closedNote, updatedBy, updatedAt, lastAuditLogId? }` *(reopen `closed: true -> false` **khusus Owner** dan wajib berpasangan dengan `audit_logs/{lastAuditLogId}` baru)*
- `bank_statements/{id}`: `{ accountId, tanggal, deskripsi, amount, matchedRefId?, matchedNote?, createdBy, createdAt }`
- `audit_logs/{id}` *(append-only)*: `{ uid, createdBy, createdByName?, aksi (<=100 kar), targetCollection, targetId, sebelum, sesudah, createdAt }`

---

## 2. Setup Proyek Firebase & Deploy Rules

1. Buat proyek di [Firebase Console](https://console.firebase.google.com).
2. Aktifkan **Authentication → Sign-in method → Email/Password**.
   - **Catatan sign-up publik**: `firestore.rules` menolak seluruh akses bagi akun yang tidak memiliki dokumen aktif di `users/{uid}` dengan role `'owner'` atau `'admin'`.
3. Aktifkan **Cloud Firestore** (pilih region terdekat, mis. `asia-southeast2` Jakarta atau `asia-southeast1` Singapura).
   - **PENTING — Region Firestore tidak dapat diubah** setelah database dibuat.
4. Salin `.env.example` menjadi `.env` dan isi seluruh nilai `VITE_FIREBASE_*` dari Project Settings → Web App di Firebase Console (jangan commit `.env`).
5. Deploy Security Rules dan Indexes:
   ```bash
   npx firebase login
   npx firebase use <PROJECT_ID>
   npx firebase deploy --only firestore:rules,firestore:indexes
   ```

---

## 3. Membuat OWNER Pertama (Manual)

Tidak ada seed data bisnis atau auto-signup admin. Untuk membuat akun **OWNER pertama**:
1. Buka Firebase Console → **Authentication → Users → Add user**, masukkan email & password Owner.
2. Salin **User UID** yang terbentuk.
3. Buka **Firestore Database → Start collection `users`**, buat dokumen dengan **Document ID = `<User UID>`** dan isi:
   - `nama`: `"Owner Konveksi"` (string)
   - `email`: `"owner@domain.com"` (string)
   - `role`: `"owner"` (string)
   - `active`: `true` (boolean)
4. Login ke aplikasi dengan akun tersebut. User **Admin** selanjutnya dibuat oleh Owner melalui menu **Kelola User**.
5. **Keamanan Akun Owner**: Gunakan password kuat minimal 12+ karakter dan hanya login pada perangkat tepercaya. Owner dan Admin memiliki akses operasional & keuangan yang sama, kecuali **Kelola User** (`users`) dan **Buka Ulang Periode** (`periods` `closed: true -> false`) yang khusus **Owner**.

---

## 4. Build Web & Pembungkusan APK Android via Capacitor

> **Catatan Folder Android Bawaan Workspace**: Folder template Android bawaan di root (`app/`, `build.gradle.kts`, `gradle/`, `settings.gradle.kts`) bukan bagian dari proyek web KonveksiOps dan diabaikan pada alur Capacitor.

```bash
# 1. Install dependencies & verifikasi
npm install
npm run lint
npm run build

# 2. Tambah platform Android Capacitor & sinkronisasi aset web (dist/)
npx cap add android
npx cap sync android

# 3. Buka di Android Studio untuk build APK / AAB bertanda tangan
npx cap open android
```

> **Optimasi Bundle (Code-Split)**: Pustaka ekspor PDF (`jspdf`, `jspdf-autotable`) dan parser Excel (`read-excel-file/browser`) dimuat secara dinamis (`import()`) saat dibutuhkan agar ukuran bundle awal tetap ringan.

---

## 5. Arsitektur Transaksi, Keamanan & Cek Integritas

- **Batas Kuota 20 `get()` Firestore Rules (SO & WO Bertahap)**:
  - **Sales Order**: Maksimal **6 SKU berbeda** per transaksi agar total evaluasi `get()`/`existsAfter()` tetap di bawah batas 20 dokumen Firestore Rules.
  - **Work Order (Potong Resep Bertahap)**: Pemotongan bahan pada WO otomatis dipecah menjadi transaksi chunk (maks **4 bahan per transaksi**) yang mencatat progres ke `cutMaterialIds` dan `cutCompleted`. Resep dengan > 6 bahan tetap berjalan lancar, dapat dilanjutkan jika terputus, dan idempoten (tidak memotong ganda).
- **Stok Minus Produk Jadi vs Bahan/WIP**:
  - `stock_balances` & `stock_ledger` mengizinkan stok `product` menjadi minus (ditandai merah `"Perlu Opname"` di UI) jika barang terjual sebelum setoran selesai; `material` dan `wip` tetap dilarang minus bahkan untuk Owner.
- **Harga Bahan Pecahan & HPP Resep**:
  - Harga rata-rata tertimbang bahan (`totalCost / qty`) dihitung sebagai pecahan `number`, dikalikan pemakaian Resep (`cm`/`pcs`) per baris, dijumlahkan dengan tarif biaya (`jahit_cutting`, `sablon`, `packing`, `lainnya`), lalu dibulatkan hanya pada hasil akhir `HPP/pcs`.
- **Marketplace Saldo, Arus Kas & Neraca Tanpa Angka Plug**:
  - Penjualan marketplace masuk ke `marketplace_channels.balance` sebesar `penerimaanBersih` (harga jual - admin - affiliate - potongan lain) dan **tidak masuk Arus Kas** sampai dicairkan via `marketplace_payouts` ke Kas/Bank.
  - Neraca menghitung `selisih = Total Aset - (Total Liabilitas + Total Ekuitas)` secara ketat tanpa angka plug, memakai `accounting_settings/default.modalAwal` yang kosong sampai diisi pemilik.
- **Hardening `accounts.saldoBerjalan` & `stock_balances`**:
  - Setiap perubahan `accounts.saldoBerjalan` wajib berpasangan dengan `payments/{lastPaymentId}` atau `audit_logs/{lastAuditLogId}` baru dalam transaksi yang sama.
  - Setiap perubahan `stock_balances` wajib berpasangan dengan `stock_ledger/{lastLedgerId}` baru serta kecocokan `itemType` per `jenis`.
  - Seluruh koleksi utama dikunci dengan `keys().hasOnly([...])` dan batas panjang string.
- **Cek Integritas & Pengujian**:
  - Layar **Cek Integritas** mendukung mode rutin **2 bulan terakhir** dan **Semua periode** (mengaudit saldo kas/bank, saldo channel marketplace, saldo stok, WO vs setoran/reject, SO vs payment/retur, jurnal vs sumber, dan transaksi di periode tertutup).
  - Jalankan pengujian lokal:
    ```bash
    npm run test:unit
    npm run test:rules
    npm run test:integration
    ```

