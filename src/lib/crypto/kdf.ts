/**
 * kdf.ts — key-derivation primitives and the canonical domain-separation labels.
 *
 * Two building blocks:
 *   - Argon2id: slow, memory-hard stretch for LOW-entropy inputs (room code, PIN,
 *     invite password). Runs only at join / unlock / redeem — never per message.
 *   - HKDF-SHA-256: fast PRF expansion for domain-separated subkeys. Every key in
 *     the system is `hkdf(ikm, salt, LABEL, len)` with a distinct LABEL so no two
 *     purposes ever share key material.
 *
 * Swap point: `argon2idKdf` is the single Argon2 call site. If pure-JS latency is
 * unacceptable it can be replaced with a WASM implementation without touching callers.
 */

import { argon2id } from '@noble/hashes/argon2.js';
import { hkdf as nobleHkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from './wire';

/** Canonical HKDF `info` labels. Every derived key uses exactly one of these. */
export const LABELS = {
  roomKdfSalt: 'kai/room-kdf/salt/v2',
  routingId: 'kai/routing-id/v2',
  roomKey: 'kai/room-key/v2',
  roomSafety: 'kai/room-safety/v2',
  senderKeyChain: 'kai/senderkey/chain/v2',
  senderKeyMsg: 'kai/senderkey/msg/v2',
  x3dhRoot: 'kai/x3dh/root/v2',
  ratchetRoot: 'kai/ratchet/root/v2',
  ratchetChain: 'kai/ratchet/chain/v2',
  ratchetMsg: 'kai/ratchet/msg/v2',
  identitySeal: 'kai/identity-seal/v2',
  roomCache: 'kai/roomcache/v2',
  inviteWrap: 'kai/invite-wrap/v2',
  safetyNumber: 'kai/safetynumber/v2',
  voiceKey: 'kai/voice-key/v2',
  fileKey: 'kai/file-key/v2',
} as const;

export type Label = (typeof LABELS)[keyof typeof LABELS];

export interface Argon2Params {
  /** iterations (time cost) */ t: number;
  /** memory in KiB */ m: number;
  /** parallelism */ p: number;
  /** derived-key length in bytes */ dkLen: number;
}

/**
 * OWASP-interactive params. Used to stretch a room code into the room seed.
 * ~19 MiB / 2 passes — roughly 1–3 s in-browser (pure JS).
 */
export const ARGON2_ROOM: Argon2Params = { t: 2, m: 19456, p: 1, dkLen: 32 };

/** Interactive stretch for PIN unlock and invite-password unwrap. */
export const ARGON2_INTERACTIVE: Argon2Params = { t: 3, m: 19456, p: 1, dkLen: 32 };

/** Argon2id stretch of a low-entropy secret. */
export const argon2idKdf = (
  password: Uint8Array,
  salt: Uint8Array,
  params: Argon2Params,
): Uint8Array => argon2id(password, salt, { t: params.t, m: params.m, p: params.p, dkLen: params.dkLen });

/**
 * HKDF-SHA-256 expansion. `info` is a domain-separation label (from LABELS) plus
 * optional binding context appended as bytes (e.g. a routingId or transferId).
 */
export const hkdf = (
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string | Uint8Array,
  length: number,
): Uint8Array => {
  const infoBytes = typeof info === 'string' ? utf8ToBytes(info) : info;
  return nobleHkdf(sha256, ikm, salt, infoBytes, length);
};

/** SHA-256 convenience (re-exported so callers don't import noble directly). */
export const sha256Bytes = (data: Uint8Array): Uint8Array => sha256(data);

/** The fixed room-KDF salt: SHA-256 of the salt label. Constant across all rooms. */
export const roomKdfSalt = (): Uint8Array => sha256(utf8ToBytes(LABELS.roomKdfSalt));

const EMPTY = new Uint8Array(0);
export { EMPTY as EMPTY_SALT };
