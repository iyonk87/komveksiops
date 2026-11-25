import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { createAuthUserWithSecondaryApp, getFirebaseDb } from './config';
import { assertOnlineForTransaction, fetchCollectionPaginated, fetchQueryWithCacheFlag, type FetchResult } from './common';
import type {
  Account,
  BomItem,
  BomItemKind,
  Customer,
  Material,
  MaterialCategory,
  MaterialPurchaseUnit,
  MaterialUsageUnit,
  Product,
  RecipeCostCategory,
  SalesChannel,
  Supplier,
  UserProfile,
  UserRole,
} from '../../types/models';
import type { ValidatedMaterialImportRow, ValidatedRecipeImportRow } from '../domain/csv';
import { assertNonNegativeInt, assertPositiveInt } from '../../utils/format';

export async function fetchUsers(pageLimit = 50): Promise<FetchResult<UserProfile>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'users'), orderBy('nama', 'asc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, (id, d) => ({
    uid: id,
    nama: String(d.nama ?? ''),
    email: String(d.email ?? ''),
    role: (d.role === 'owner' ? 'owner' : 'admin') as UserRole,
    active: Boolean(d.active),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
}

export async function provisionUserByOwner(params: {
  actorUid: string;
  actorName?: string;
  nama: string;
  email: string;
  password: string;
  role: UserRole;
}): Promise<string> {
  assertOnlineForTransaction();
  if (params.nama.trim().length < 2) throw new Error('Nama minimal 2 karakter.');
  if (params.password.length < 6) throw new Error('Password minimal 6 karakter.');

  const newUid = await createAuthUserWithSecondaryApp(params.email.trim(), params.password);
  const db = getFirebaseDb();
  const batch = writeBatch(db);

  const userRef = doc(db, 'users', newUid);
  batch.set(userRef, {
    nama: params.nama.trim(),
    email: params.email.trim().toLowerCase(),
    role: params.role,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const auditRef = doc(collection(db, 'audit_logs'));
  batch.set(auditRef, {
    uid: params.actorUid,
    createdBy: params.actorUid,
    ...(params.actorName ? { createdByName: params.actorName } : {}),
    aksi: 'CREATE_USER',
    targetCollection: 'users',
    targetId: newUid,
    sebelum: '-',
    sesudah: JSON.stringify({ email: params.email.trim().toLowerCase(), role: params.role, active: true }),
    createdAt: serverTimestamp(),
  });

  await batch.commit();
  return newUid;
}

export async function updateUserRoleStatus(params: {
  actorUid: string;
  actorName?: string;
  target: UserProfile;
  role: UserRole;
  active: boolean;
}): Promise<void> {
  assertOnlineForTransaction();
  if (params.actorUid === params.target.uid && (params.role !== params.target.role || params.active !== params.target.active)) {
    throw new Error('Owner tidak dapat mengubah role atau menonaktifkan akun sendiri.');
  }
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', params.target.uid), {
    nama: params.target.nama,
    email: params.target.email,
    role: params.role,
    active: params.active,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, 'audit_logs')), {
    uid: params.actorUid,
    createdBy: params.actorUid,
    ...(params.actorName ? { createdByName: params.actorName } : {}),
    aksi: 'UPDATE_USER_ROLE_STATUS',
    targetCollection: 'users',
    targetId: params.target.uid,
    sebelum: JSON.stringify({ role: params.target.role, active: params.target.active }),
    sesudah: JSON.stringify({ role: params.role, active: params.active }),
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

function mapMaterial(id: string, d: Record<string, unknown>): Material {
  const satuanPakaiRaw = d.satuanPakai ? String(d.satuanPakai) : String(d.satuan ?? 'pcs');
  const satuanPakai: MaterialUsageUnit = satuanPakaiRaw === 'cm' ? 'cm' : 'pcs';
  const satuanBeli = (d.satuanBeli ?? 'roll') as MaterialPurchaseUnit;
  const konversi =
    typeof d.konversi === 'number' && Number.isFinite(d.konversi) && d.konversi > 0
      ? d.konversi
      : null;

  return {
    id,
    kode: String(d.kode ?? ''),
    nama: String(d.nama ?? ''),
    kategori: (d.kategori ?? 'lainnya') as MaterialCategory,
    satuan: String(d.satuan ?? satuanPakai),
    satuanBeli,
    satuanPakai,
    konversi,
    minStock: Number(d.minStock ?? 0),
    active: Boolean(d.active),
    createdBy: String(d.createdBy ?? ''),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

// --- MATERIALS ---
export async function fetchMaterials(pageLimit = 100): Promise<FetchResult<Material>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'materials'), orderBy('nama', 'asc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, mapMaterial);
}

export async function fetchAllMaterialsPaginated() {
  return fetchCollectionPaginated<Material>({
    collectionName: 'materials',
    mapper: mapMaterial,
  });
}

export async function saveMaterial(params: {
  id?: string;
  actorUid: string;
  kode: string;
  nama: string;
  kategori: MaterialCategory;
  satuanBeli?: MaterialPurchaseUnit;
  satuanPakai?: MaterialUsageUnit;
  satuan?: string;
  konversi?: number | null;
  minStock: number;
}): Promise<string> {
  assertOnlineForTransaction();
  assertNonNegativeInt(params.minStock, 'Stok minimum');
  const satuanPakai: MaterialUsageUnit =
    params.satuanPakai ?? (params.satuan === 'cm' ? 'cm' : 'pcs');
  const satuanBeli: MaterialPurchaseUnit = params.satuanBeli ?? 'roll';
  let konversi: number | null = null;
  if (params.konversi !== undefined && params.konversi !== null) {
    assertPositiveInt(params.konversi, 'Nilai konversi satuan beli');
    konversi = params.konversi;
  }

  const db = getFirebaseDb();
  const payload = {
    kode: params.kode.trim(),
    nama: params.nama.trim(),
    kategori: params.kategori,
    satuan: satuanPakai,
    satuanBeli,
    satuanPakai,
    konversi,
    minStock: params.minStock,
  };

  if (params.id) {
    await updateDoc(doc(db, 'materials', params.id), {
      ...payload,
      updatedAt: serverTimestamp(),
    });
    return params.id;
  }
  const ref = doc(collection(db, 'materials'));
  await setDoc(ref, {
    ...payload,
    active: true,
    createdBy: params.actorUid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Mengimpor potongan bahan baku secara idempoten (maks 8 baris per batch).
 * Jika kode bahan sudah ada, memperbarui dokumen existing tanpa menduplikasi.
 */
export async function importMaterialsChunk(params: {
  actorUid: string;
  rows: ValidatedMaterialImportRow[];
  existingByKode: Map<string, Material>;
}): Promise<{ created: number; updated: number }> {
  assertOnlineForTransaction();
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  let created = 0;
  let updated = 0;

  for (const row of params.rows) {
    const key = row.kode.trim().toUpperCase();
    const existing = params.existingByKode.get(key);
    const payload = {
      kode: row.kode.trim(),
      nama: row.nama.trim(),
      kategori: row.kategori,
      satuan: row.satuanPakai,
      satuanBeli: row.satuanBeli,
      satuanPakai: row.satuanPakai,
      konversi: row.konversi,
      minStock: row.minStock,
    };

    if (existing) {
      batch.update(doc(db, 'materials', existing.id), {
        ...payload,
        active: true,
        updatedAt: serverTimestamp(),
      });
      updated += 1;
    } else {
      // Gunakan ID deterministik berbasis kode sehingga pengulangan impor tetap idempoten
      const safeId = `mat_${key.replace(/[^A-Z0-9_-]/g, '_')}`;
      const newRef = doc(db, 'materials', safeId);
      batch.set(newRef, {
        ...payload,
        active: true,
        createdBy: params.actorUid,
        createdAt: serverTimestamp(),
      });
      params.existingByKode.set(key, {
        id: safeId,
        ...payload,
        active: true,
        createdBy: params.actorUid,
      });
      created += 1;
    }
  }

  await batch.commit();
  return { created, updated };
}

export async function setMaterialActive(id: string, active: boolean): Promise<void> {
  assertOnlineForTransaction();
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'materials', id), { active, updatedAt: serverTimestamp() });
}

function mapProduct(id: string, d: Record<string, unknown>): Product {
  return {
    id,
    sku: String(d.sku ?? ''),
    nama: String(d.nama ?? ''),
    model: String(d.model ?? ''),
    warna: String(d.warna ?? ''),
    ukuran: String(d.ukuran ?? ''),
    satuan: String(d.satuan ?? 'pcs'),
    minStock: Number(d.minStock ?? 0),
    hargaJual: Number(d.hargaJual ?? 0),
    hppPerPcs: typeof d.hppPerPcs === 'number' ? d.hppPerPcs : undefined,
    active: Boolean(d.active),
    createdBy: String(d.createdBy ?? ''),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

// --- PRODUCTS (SKU) ---
export async function fetchProducts(pageLimit = 100): Promise<FetchResult<Product>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'products'), orderBy('nama', 'asc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, mapProduct);
}

export async function fetchAllProductsPaginated() {
  return fetchCollectionPaginated<Product>({
    collectionName: 'products',
    mapper: mapProduct,
  });
}

export async function saveProduct(params: {
  id?: string;
  actorUid: string;
  sku: string;
  nama: string;
  model: string;
  warna: string;
  ukuran: string;
  satuan: string;
  minStock: number;
  hargaJual: number;
  hppPerPcs?: number;
}): Promise<string> {
  assertOnlineForTransaction();
  assertNonNegativeInt(params.minStock, 'Stok minimum');
  assertNonNegativeInt(params.hargaJual, 'Harga jual');
  if (params.hppPerPcs !== undefined) {
    assertNonNegativeInt(params.hppPerPcs, 'HPP per pcs');
  }
  const db = getFirebaseDb();
  const payload = {
    sku: params.sku.trim(),
    nama: params.nama.trim(),
    model: params.model.trim(),
    warna: params.warna.trim(),
    ukuran: params.ukuran.trim(),
    satuan: params.satuan.trim(),
    minStock: params.minStock,
    hargaJual: params.hargaJual,
    ...(params.hppPerPcs !== undefined ? { hppPerPcs: params.hppPerPcs } : {}),
  };

  if (params.id) {
    await updateDoc(doc(db, 'products', params.id), {
      ...payload,
      updatedAt: serverTimestamp(),
    });
    return params.id;
  }
  const ref = doc(collection(db, 'products'));
  await setDoc(ref, {
    ...payload,
    active: true,
    createdBy: params.actorUid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function setProductActive(id: string, active: boolean): Promise<void> {
  assertOnlineForTransaction();
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'products', id), { active, updatedAt: serverTimestamp() });
}

// --- SUPPLIERS ---
export async function fetchSuppliers(pageLimit = 100): Promise<FetchResult<Supplier>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'suppliers'), orderBy('nama', 'asc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, (id, d) => ({
    id,
    nama: String(d.nama ?? ''),
    telepon: String(d.telepon ?? ''),
    alamat: String(d.alamat ?? ''),
    catatan: String(d.catatan ?? ''),
    active: Boolean(d.active),
    createdBy: String(d.createdBy ?? ''),
    createdAt: d.createdAt,
  }));
}

export async function saveSupplier(params: {
  id?: string;
  actorUid: string;
  nama: string;
  telepon: string;
  alamat: string;
  catatan: string;
}): Promise<string> {
  assertOnlineForTransaction();
  const db = getFirebaseDb();
  if (params.id) {
    await updateDoc(doc(db, 'suppliers', params.id), {
      nama: params.nama.trim(),
      telepon: params.telepon.trim(),
      alamat: params.alamat.trim(),
      catatan: params.catatan.trim(),
    });
    return params.id;
  }
  const ref = doc(collection(db, 'suppliers'));
  await setDoc(ref, {
    nama: params.nama.trim(),
    telepon: params.telepon.trim(),
    alamat: params.alamat.trim(),
    catatan: params.catatan.trim(),
    active: true,
    createdBy: params.actorUid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function setSupplierActive(id: string, active: boolean): Promise<void> {
  assertOnlineForTransaction();
  await updateDoc(doc(getFirebaseDb(), 'suppliers', id), { active });
}

// --- CUSTOMERS (Dipertahankan hanya untuk kompatibilitas pembacaan data lama) ---
export async function fetchCustomers(pageLimit = 100): Promise<FetchResult<Customer>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'customers'), orderBy('nama', 'asc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, (id, d) => ({
    id,
    nama: String(d.nama ?? ''),
    tipe: String(d.tipe ?? 'online') as SalesChannel,
    telepon: String(d.telepon ?? ''),
    alamat: String(d.alamat ?? ''),
    active: Boolean(d.active),
    createdBy: String(d.createdBy ?? ''),
    createdAt: d.createdAt,
  }));
}

export async function saveCustomer(params: {
  id?: string;
  actorUid: string;
  nama: string;
  tipe: SalesChannel;
  telepon: string;
  alamat: string;
}): Promise<string> {
  assertOnlineForTransaction();
  const db = getFirebaseDb();
  if (params.id) {
    await updateDoc(doc(db, 'customers', params.id), {
      nama: params.nama.trim(),
      tipe: params.tipe,
      telepon: params.telepon.trim(),
      alamat: params.alamat.trim(),
    });
    return params.id;
  }
  const ref = doc(collection(db, 'customers'));
  await setDoc(ref, {
    nama: params.nama.trim(),
    tipe: params.tipe,
    telepon: params.telepon.trim(),
    alamat: params.alamat.trim(),
    active: true,
    createdBy: params.actorUid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function setCustomerActive(id: string, active: boolean): Promise<void> {
  assertOnlineForTransaction();
  await updateDoc(doc(getFirebaseDb(), 'customers', id), { active });
}

// --- ACCOUNTS (KAS/BANK) ---
function mapAccount(id: string, d: Record<string, unknown>): Account {
  return {
    id,
    nama: String(d.nama ?? ''),
    tipe: (d.tipe ?? 'kas') as 'kas' | 'bank',
    nomorRekening: String(d.nomorRekening ?? ''),
    saldoAwal: Number(d.saldoAwal ?? 0),
    saldoBerjalan: Number(d.saldoBerjalan ?? 0),
    active: Boolean(d.active),
    lastPaymentId: d.lastPaymentId ? String(d.lastPaymentId) : undefined,
    lastAuditLogId: d.lastAuditLogId ? String(d.lastAuditLogId) : undefined,
    createdBy: String(d.createdBy ?? ''),
    createdByName: d.createdByName ? String(d.createdByName) : undefined,
    createdAt: d.createdAt,
  };
}

export async function fetchAccounts(pageLimit = 50): Promise<FetchResult<Account>> {
  const db = getFirebaseDb();
  const q = query(collection(db, 'accounts'), orderBy('nama', 'asc'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, mapAccount);
}

export async function fetchAllAccountsPaginated() {
  return fetchCollectionPaginated<Account>({
    collectionName: 'accounts',
    mapper: mapAccount,
  });
}

export async function saveAccount(params: {
  actorUid: string;
  nama: string;
  tipe: 'kas' | 'bank';
  nomorRekening: string;
  saldoAwal: number;
}): Promise<string> {
  assertOnlineForTransaction();
  assertNonNegativeInt(params.saldoAwal, 'Saldo awal');
  const db = getFirebaseDb();
  const ref = doc(collection(db, 'accounts'));
  await setDoc(ref, {
    nama: params.nama.trim(),
    tipe: params.tipe,
    nomorRekening: params.nomorRekening.trim(),
    saldoAwal: params.saldoAwal,
    saldoBerjalan: params.saldoAwal,
    active: true,
    createdBy: params.actorUid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function setAccountActive(id: string, active: boolean): Promise<void> {
  assertOnlineForTransaction();
  await updateDoc(doc(getFirebaseDb(), 'accounts', id), { active });
}

// --- RESEP (bom_items: bahan baku & komponen biaya per pcs) ---
function mapBomItem(id: string, d: Record<string, unknown>): BomItem {
  const jenis: BomItemKind = d.jenis === 'cost' ? 'cost' : 'material';
  return {
    id,
    productId: String(d.productId ?? ''),
    jenis,
    materialId: d.materialId ? String(d.materialId) : undefined,
    qtyPerPcs: d.qtyPerPcs !== undefined ? Number(d.qtyPerPcs) : undefined,
    costCategory: d.costCategory ? (String(d.costCategory) as RecipeCostCategory) : undefined,
    label: d.label ? String(d.label) : undefined,
    amountPerPcs: d.amountPerPcs !== undefined ? Number(d.amountPerPcs) : undefined,
    active: Boolean(d.active),
    createdBy: String(d.createdBy ?? ''),
    createdAt: d.createdAt,
  };
}

export async function fetchBomItems(productId?: string, pageLimit = 300): Promise<FetchResult<BomItem>> {
  const db = getFirebaseDb();
  const q = productId
    ? query(collection(db, 'bom_items'), where('productId', '==', productId), limit(pageLimit))
    : query(collection(db, 'bom_items'), limit(pageLimit));
  return fetchQueryWithCacheFlag(q, mapBomItem);
}

export async function fetchAllBomItemsPaginated() {
  return fetchCollectionPaginated<BomItem>({
    collectionName: 'bom_items',
    mapper: mapBomItem,
  });
}

export async function saveBomItem(params: {
  actorUid: string;
  productId: string;
  jenis?: BomItemKind;
  materialId?: string;
  qtyPerPcs?: number;
  costCategory?: RecipeCostCategory;
  label?: string;
  amountPerPcs?: number;
}): Promise<string> {
  assertOnlineForTransaction();
  const jenis: BomItemKind = params.jenis ?? 'material';
  const db = getFirebaseDb();
  const ref = doc(collection(db, 'bom_items'));

  if (jenis === 'cost') {
    if (!params.costCategory) throw new Error('Kategori biaya resep wajib dipilih.');
    if (!params.label || !params.label.trim()) throw new Error('Label biaya resep wajib diisi.');
    const amountPerPcs = params.amountPerPcs ?? 0;
    assertNonNegativeInt(amountPerPcs, 'Nominal biaya per pcs');
    await setDoc(ref, {
      productId: params.productId,
      jenis: 'cost',
      costCategory: params.costCategory,
      label: params.label.trim(),
      amountPerPcs,
      active: true,
      createdBy: params.actorUid,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  }

  if (!params.materialId) throw new Error('Bahan baku wajib dipilih.');
  const qtyPerPcs = params.qtyPerPcs ?? 0;
  assertPositiveInt(qtyPerPcs, 'Kebutuhan per pcs');
  await setDoc(ref, {
    productId: params.productId,
    jenis: 'material',
    materialId: params.materialId,
    qtyPerPcs,
    active: true,
    createdBy: params.actorUid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Mengimpor potongan baris Resep secara idempoten (maks 8 baris per batch).
 */
export async function importRecipeChunk(params: {
  actorUid: string;
  rows: ValidatedRecipeImportRow[];
  existingItems: BomItem[];
}): Promise<{ created: number; updated: number }> {
  assertOnlineForTransaction();
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  let created = 0;
  let updated = 0;

  const byKey = new Map<string, BomItem>();
  for (const b of params.existingItems) {
    if (!b.active) continue;
    const key =
      (b.jenis ?? 'material') === 'cost'
        ? `${b.productId}:cost:${b.costCategory}:${(b.label ?? '').toUpperCase()}`
        : `${b.productId}:mat:${b.materialId}`;
    byKey.set(key, b);
  }

  for (const row of params.rows) {
    if (row.jenis === 'material') {
      const key = `${row.productId}:mat:${row.materialId}`;
      const existing = byKey.get(key);
      if (existing) {
        batch.update(doc(db, 'bom_items', existing.id), {
          productId: row.productId,
          jenis: 'material',
          materialId: row.materialId!,
          qtyPerPcs: row.qtyPerPcs!,
          active: true,
        });
        updated += 1;
      } else {
        const safeId = `bom_${row.productId}_mat_${row.materialId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        batch.set(doc(db, 'bom_items', safeId), {
          productId: row.productId,
          jenis: 'material',
          materialId: row.materialId!,
          qtyPerPcs: row.qtyPerPcs!,
          active: true,
          createdBy: params.actorUid,
          createdAt: serverTimestamp(),
        });
        created += 1;
      }
    } else {
      const safeLabel = (row.label ?? row.costCategory ?? 'biaya').trim();
      const key = `${row.productId}:cost:${row.costCategory}:${safeLabel.toUpperCase()}`;
      const existing = byKey.get(key);
      if (existing) {
        batch.update(doc(db, 'bom_items', existing.id), {
          productId: row.productId,
          jenis: 'cost',
          costCategory: row.costCategory!,
          label: safeLabel,
          amountPerPcs: row.amountPerPcs!,
          active: true,
        });
        updated += 1;
      } else {
        const safeId = `bom_${row.productId}_cost_${row.costCategory}_${safeLabel}`
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .slice(0, 120);
        batch.set(doc(db, 'bom_items', safeId), {
          productId: row.productId,
          jenis: 'cost',
          costCategory: row.costCategory!,
          label: safeLabel,
          amountPerPcs: row.amountPerPcs!,
          active: true,
          createdBy: params.actorUid,
          createdAt: serverTimestamp(),
        });
        created += 1;
      }
    }
  }

  await batch.commit();
  return { created, updated };
}

export async function setBomItemActive(id: string, active: boolean): Promise<void> {
  assertOnlineForTransaction();
  await updateDoc(doc(getFirebaseDb(), 'bom_items', id), { active });
}
