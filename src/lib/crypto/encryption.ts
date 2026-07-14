/**
 * encryption.ts — AEAD primitives (AES-256-GCM) with associated data and an
 * optional key-committing wrapper.
 *
 * Byte-oriented on purpose: envelope (base64) framing lives in protocol.ts/wire.ts.
 *
 * Key commitment: plain AES-GCM is NOT key-committing — a single ciphertext can be
 * made to decrypt under two different keys (partitioning-oracle / "invisible
 * salamander" attacks), which matters when many keys are in play (sender-keys,
 * invites). `committingEncrypt` binds the ciphertext to the exact key by publishing
 * `commit = HKDF(keyBytes, "commit")` and verifying it in constant time on decrypt.
 */

import { hkdf } from './kdf';
import { bytesEqual } from './wire';

export const GCM_IV_LENGTH = 12;

/** A fixed all-zero IV — SAFE ONLY when the key is used exactly once (ratchet/sender message keys). */
export const ZERO_IV = new Uint8Array(GCM_IV_LENGTH);

export const randomIv = (): Uint8Array => crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH));

export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

/** Import 32 raw bytes as an AES-256-GCM key. Non-extractable by default. */
export const importAesKey = (raw: Uint8Array, extractable = false): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM', length: 256 }, extractable, [
    'encrypt',
    'decrypt',
  ]);

export interface AeadCiphertext {
  iv: Uint8Array;
  ct: Uint8Array; // ciphertext WITH the 16-byte GCM tag appended
}

export const aeadEncrypt = async (
  key: CryptoKey,
  plaintext: Uint8Array,
  aad?: Uint8Array,
  iv: Uint8Array = randomIv(),
): Promise<AeadCiphertext> => {
  const params: AesGcmParams = { name: 'AES-GCM', iv: iv as BufferSource };
  if (aad) params.additionalData = aad as BufferSource;
  const ct = await crypto.subtle.encrypt(params, key, plaintext as BufferSource);
  return { iv, ct: new Uint8Array(ct) };
};

export const aeadDecrypt = async (
  key: CryptoKey,
  iv: Uint8Array,
  ct: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> => {
  const params: AesGcmParams = { name: 'AES-GCM', iv: iv as BufferSource };
  if (aad) params.additionalData = aad as BufferSource;
  const pt = await crypto.subtle.decrypt(params, key, ct as BufferSource);
  return new Uint8Array(pt);
};

// ---------------------------------------------------------------------------
// Key-committing AEAD (raw-key-bytes interface)
// ---------------------------------------------------------------------------

export interface CommittingCiphertext {
  iv: Uint8Array;
  ct: Uint8Array;
  commit: Uint8Array; // 32-byte key commitment
}

const keyCommitment = (keyBytes: Uint8Array): Uint8Array =>
  hkdf(keyBytes, new Uint8Array(0), 'kai/aead/commit/v2', 32);

export const committingEncrypt = async (
  keyBytes: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
  iv: Uint8Array = randomIv(),
): Promise<CommittingCiphertext> => {
  const key = await importAesKey(keyBytes);
  const { ct } = await aeadEncrypt(key, plaintext, aad, iv);
  return { iv, ct, commit: keyCommitment(keyBytes) };
};

export const committingDecrypt = async (
  keyBytes: Uint8Array,
  iv: Uint8Array,
  ct: Uint8Array,
  commit: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> => {
  // Verify the commitment BEFORE attempting decryption — constant-time compare.
  if (!bytesEqual(commit, keyCommitment(keyBytes))) {
    throw new Error('Key commitment mismatch');
  }
  const key = await importAesKey(keyBytes);
  return aeadDecrypt(key, iv, ct, aad);
};
