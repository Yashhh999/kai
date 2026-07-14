/**
 * safetyNumber.ts — out-of-band verification codes (à la Signal safety numbers).
 *
 * Each party derives a 30-digit numeric fingerprint from an iterated SHA-512 over
 * their bound public keys; the shared 60-digit safety number is the two halves in a
 * canonical (sorted) order so both sides display an identical value. A matching
 * number proves neither party's keys were swapped by an active MITM at handshake.
 */

import { sha512 } from '@noble/hashes/sha2.js';
import { LABELS } from './kdf';
import { PublicIdentity, encodePublicIdentity } from './identity';
import { concatBytes, utf8ToBytes } from './wire';

const ITERATIONS = 5200;
const LABEL = utf8ToBytes(LABELS.safetyNumber);

/** Iterated SHA-512: hash = SHA512(hash || keyMaterial), ITERATIONS times. */
const iteratedHash = (keyMaterial: Uint8Array, stableId: Uint8Array): Uint8Array => {
  let hash = sha512(concatBytes(LABEL, keyMaterial, stableId));
  for (let i = 0; i < ITERATIONS; i++) hash = sha512(concatBytes(hash, keyMaterial));
  return hash;
};

/** Render `groups` 5-digit blocks (each 40-bit big-endian chunk mod 100000). */
const toDigits = (hash: Uint8Array, groups: number): string => {
  const out: string[] = [];
  for (let g = 0; g < groups; g++) {
    const o = g * 5;
    const v =
      hash[o] * 2 ** 32 + hash[o + 1] * 2 ** 24 + hash[o + 2] * 2 ** 16 + hash[o + 3] * 2 ** 8 + hash[o + 4];
    out.push((v % 100000).toString().padStart(5, '0'));
  }
  return out.join('');
};

/** A single party's 30-digit numeric fingerprint. */
const numericFingerprint = (p: PublicIdentity): string => {
  const stableId = utf8ToBytes(p.fingerprint);
  return toDigits(iteratedHash(encodePublicIdentity(p), stableId), 6);
};

/** 60-digit shared safety number for two identities (canonical ordering). */
export const computeSafetyNumber = (local: PublicIdentity, remote: PublicIdentity): string => {
  const a = numericFingerprint(local);
  const b = numericFingerprint(remote);
  return a < b ? a + b : b + a;
};

/** Room-level 60-digit number derived from the room safety seed (all members share it). */
export const roomSafetyNumber = (roomSafetySeed: Uint8Array): string =>
  toDigits(iteratedHash(roomSafetySeed, utf8ToBytes('kai/room')), 12);

/** Format a digit string into space-separated 5-digit groups for display. */
export const formatSafetyNumber = (sn: string): string => sn.match(/.{1,5}/g)?.join(' ') ?? sn;

/** 12-digit short code for quick verbal comparison. */
export const shortNumericCode = (sn: string): string => sn.slice(0, 12);

/**
 * QR payload: both serialized public identities. Scanning lets the other device
 * recompute and compare the safety number without manual digit reading.
 */
export const safetyNumberQR = (local: PublicIdentity, remote: PublicIdentity): string => {
  const enc = (p: PublicIdentity) => `${p.fingerprint}`;
  return `kai-sn:${enc(local)}:${enc(remote)}`;
};

/** Constant-time comparison of two safety numbers (ignores whitespace). */
export const safetyNumbersMatch = (a: string, b: string): boolean => {
  const na = a.replace(/\s/g, '');
  const nb = b.replace(/\s/g, '');
  if (na.length !== nb.length) return false;
  let diff = 0;
  for (let i = 0; i < na.length; i++) diff |= na.charCodeAt(i) ^ nb.charCodeAt(i);
  return diff === 0;
};
