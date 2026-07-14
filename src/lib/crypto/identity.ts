/**
 * identity.ts — a Kai cryptographic identity: an Ed25519 signing keypair plus an
 * X25519 key-agreement keypair. The public halves fold into a stable fingerprint
 * that IS the User ID.
 *
 * Private keys never leave this module in the clear; keyManager.ts seals them at
 * rest under an Argon2id(PIN) key.
 */

import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha256Bytes } from './kdf';
import {
  bytesToBase32,
  bytesToBase64Url,
  base64UrlToBytes,
  concatBytes,
  utf8ToBytes,
  frame,
} from './wire';

export interface IdentityKeyPair {
  signPub: Uint8Array; // Ed25519 public (32)
  signPriv: Uint8Array; // Ed25519 secret (32) — sealed at rest
  dhPub: Uint8Array; // X25519 public (32)
  dhPriv: Uint8Array; // X25519 secret (32) — sealed at rest
  fingerprint: string; // User ID
  createdAt: number;
}

export interface PublicIdentity {
  signPub: Uint8Array;
  dhPub: Uint8Array;
  fingerprint: string;
}

const FINGERPRINT_LABEL = utf8ToBytes('kai-id/v2');
const FINGERPRINT_BYTES = 20; // 160-bit collision resistance

/**
 * User ID = first 20 bytes of SHA-256("kai-id/v2" || signPub || dhPub), Crockford
 * base32 (32 chars). Both public keys are bound so one cannot be swapped for another.
 */
export const computeFingerprint = (signPub: Uint8Array, dhPub: Uint8Array): string => {
  const digest = sha256Bytes(concatBytes(FINGERPRINT_LABEL, signPub, dhPub));
  return bytesToBase32(digest.slice(0, FINGERPRINT_BYTES));
};

/** Short display form (first 8 chars) for compact UI. */
export const shortId = (fingerprint: string): string => fingerprint.slice(0, 8);

/** Group a fingerprint into 4-char blocks for display. */
export const formatFingerprint = (fingerprint: string): string =>
  fingerprint.match(/.{1,4}/g)?.join('-') ?? fingerprint;

export const generateIdentity = (): IdentityKeyPair => {
  const signPriv = ed25519.utils.randomSecretKey();
  const signPub = ed25519.getPublicKey(signPriv);
  const dhPriv = x25519.utils.randomSecretKey();
  const dhPub = x25519.getPublicKey(dhPriv);
  return {
    signPub,
    signPriv,
    dhPub,
    dhPriv,
    fingerprint: computeFingerprint(signPub, dhPub),
    createdAt: Date.now(),
  };
};

export const toPublicIdentity = (id: IdentityKeyPair): PublicIdentity => ({
  signPub: id.signPub,
  dhPub: id.dhPub,
  fingerprint: id.fingerprint,
});

export const signBytes = (signPriv: Uint8Array, msg: Uint8Array): Uint8Array =>
  ed25519.sign(msg, signPriv);

export const verifyBytes = (signPub: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean => {
  try {
    return ed25519.verify(sig, msg, signPub);
  } catch {
    return false;
  }
};

/** X25519 raw Diffie-Hellman. */
export const dh = (priv: Uint8Array, pub: Uint8Array): Uint8Array => x25519.getSharedSecret(priv, pub);

// ---------------------------------------------------------------------------
// Serialization for QR / share links.  Format: base64url(signPub(32) || dhPub(32))
// ---------------------------------------------------------------------------

export const serializePublicIdentity = (p: PublicIdentity): string =>
  bytesToBase64Url(concatBytes(p.signPub, p.dhPub));

export const parsePublicIdentity = (s: string): PublicIdentity => {
  const bytes = base64UrlToBytes(s.trim());
  if (bytes.length !== 64) throw new Error('Invalid public identity length');
  const signPub = bytes.slice(0, 32);
  const dhPub = bytes.slice(32, 64);
  return { signPub, dhPub, fingerprint: computeFingerprint(signPub, dhPub) };
};

/** Deterministic signable/AAD encoding of a public identity. */
export const encodePublicIdentity = (p: PublicIdentity): Uint8Array => frame(p.signPub, p.dhPub);
