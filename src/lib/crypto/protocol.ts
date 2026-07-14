/**
 * protocol.ts — the versioned wire envelope and downgrade protection.
 *
 * Every encrypted payload on the wire is one of these shapes. Version + kind are
 * bound into the AEAD associated data (see `envelopeAad`) so they cannot be
 * stripped or rewritten by a relay, and receivers pin the highest version they have
 * seen to refuse a forced downgrade to the weaker legacy path.
 */

import { utf8ToBytes, frame, u32 } from './wire';

export const PROTOCOL_VERSION = 2 as const;

/** Serialized Double Ratchet header (base64 dh key + counters). */
export interface RatchetHeaderWire {
  dh: string; // base64 X25519 ratchet public key
  pn: number; // previous chain length
  n: number; // message number in current chain
}

/** Current on-the-wire format (v absent). AES-GCM over the room-code-derived key. */
export interface LegacyEnvelope {
  v?: 1;
  ciphertext: string;
  iv: string;
}

/** Group message under a per-sender chain key (sender-keys). */
export interface RoomEnvelopeV2 {
  v: 2;
  k: 'room';
  sid: string; // sender fingerprint
  epoch: number; // membership epoch
  n: number; // message number in the sender's chain
  iv: string; // base64 (fixed zero-IV in practice; per-message key)
  ct: string; // base64 ciphertext+tag
  commit: string; // base64 key commitment
  sig: string; // base64 Ed25519 signature over the canonical message bytes
}

/** 1:1 direct message under the Double Ratchet. */
export interface DirectEnvelopeV2 {
  v: 2;
  k: 'dm';
  hdr: RatchetHeaderWire;
  iv: string;
  ct: string;
}

export type EncryptedEnvelope = LegacyEnvelope | RoomEnvelopeV2 | DirectEnvelopeV2;

/** No numeric `v` (or v===1) ⇒ legacy; v===2 ⇒ new format. */
export const detectVersion = (raw: unknown): 1 | 2 => {
  if (raw && typeof raw === 'object' && (raw as { v?: unknown }).v === 2) return 2;
  return 1;
};

export const isLegacy = (e: EncryptedEnvelope): e is LegacyEnvelope => detectVersion(e) === 1;
export const isRoomV2 = (e: EncryptedEnvelope): e is RoomEnvelopeV2 =>
  detectVersion(e) === 2 && (e as RoomEnvelopeV2).k === 'room';
export const isDirectV2 = (e: EncryptedEnvelope): e is DirectEnvelopeV2 =>
  detectVersion(e) === 2 && (e as DirectEnvelopeV2).k === 'dm';

/**
 * Associated data binding version + kind + caller context. Included in AEAD so a
 * relay cannot alter the envelope's claimed version/kind or rebind it to another room.
 */
export const envelopeAad = (version: number, kind: string, ...context: Uint8Array[]): Uint8Array =>
  frame(u32(version), utf8ToBytes(kind), ...context);

/**
 * Downgrade guard: track the highest protocol version observed for a peer/room and
 * reject anything lower afterwards. Callers hold one instance per conversation.
 */
export class VersionPin {
  private highest = 0;
  /** Returns false if `v` is a downgrade below the highest seen (caller should drop). */
  accept(v: number): boolean {
    if (v < this.highest) return false;
    if (v > this.highest) this.highest = v;
    return true;
  }
  get current(): number {
    return this.highest;
  }
}
