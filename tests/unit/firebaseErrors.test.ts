import { describe, expect, it } from 'vitest';
import {
  isMissingIndexError,
  normalizeFirestoreError,
  timestampToMillis,
} from '../../src/services/firebase/common';

describe('normalizeFirestoreError', () => {
  it('memetakan auth/invalid-credential menjadi pesan yang jelas', () => {
    const err = Object.assign(new Error('Firebase: Error (auth/invalid-credential).'), {
      code: 'auth/invalid-credential',
    });
    expect(normalizeFirestoreError(err)).toContain('Email atau kata sandi salah');
  });

  it('memetakan auth/operation-not-allowed menjadi petunjuk Email/Password Console', () => {
    const err = Object.assign(new Error('Firebase: Error (auth/operation-not-allowed).'), {
      code: 'auth/operation-not-allowed',
    });
    expect(normalizeFirestoreError(err)).toContain('Email/Password belum diaktifkan');
  });

  it('memetakan permission-denied menjadi petunjuk deploy rules dan users/{uid}', () => {
    const err = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    });
    expect(normalizeFirestoreError(err)).toContain('firestore.rules');
  });

  it('memetakan not-found database menjadi petunjuk Database ID (default)', () => {
    const err = Object.assign(new Error('5 NOT_FOUND: Database does not exist'), {
      code: 'not-found',
    });
    expect(normalizeFirestoreError(err)).toContain('Database ID');
  });

  it('mendeteksi failed-precondition / requires an index dengan benar', () => {
    const err1 = Object.assign(new Error('The query requires an index.'), {
      code: 'failed-precondition',
    });
    const err2 = new Error('The query requires an index. You can create it here: https://...');
    const err3 = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    });
    expect(isMissingIndexError(err1)).toBe(true);
    expect(isMissingIndexError(err2)).toBe(true);
    expect(isMissingIndexError(err3)).toBe(false);
  });

  it('mengonversi timestamp Firestore ke milidetik secara aman', () => {
    expect(timestampToMillis({ toMillis: () => 1700000000000 })).toBe(1700000000000);
    expect(timestampToMillis({ seconds: 1700000000 })).toBe(1700000000000);
    expect(timestampToMillis(null)).toBe(0);
  });
});
