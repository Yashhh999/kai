/**
 * senderKeys.ts — group messaging (Signal "sender keys").
 *
 * Each member owns a per-epoch chain key that ratchets forward once per message,
 * yielding a fresh one-time message key each time (so a fixed zero IV is safe and
 * there is no nonce reuse). The chain key is distributed to current members inside
 * a `SenderKeyDistribution`, itself signed by the member's long-lived identity.
 *
 * Because every recipient holds the chain key (to decrypt), a chain key alone can't
 * authenticate the sender — any member could forge. So EVERY message additionally
 * carries an Ed25519 signature under a per-epoch signing subkey whose public half is
 * bound (signed) by the identity in the distribution. This closes member-to-member
 * forgery, at the deliberate cost of deniability (groups accept this).
 *
 * Forward secrecy comes from epoch rekey: on join/leave the room bumps the epoch and
 * every member issues a fresh chain key. Ex-members can't read epoch+1; late joiners
 * can't read < the epoch they received.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf, LABELS, EMPTY_SALT } from './kdf';
import { committingEncrypt, committingDecrypt, randomBytes, ZERO_IV } from './encryption';
import { IdentityKeyPair, PublicIdentity, computeFingerprint, signBytes, verifyBytes } from './identity';
import { RoomEnvelopeV2, envelopeAad } from './protocol';
import {
  bytesToBase64,
  base64ToBytes,
  utf8ToBytes,
  frame,
  u32,
  concatBytes,
} from './wire';

const MAX_SKIP = 2000;

/** Our own sending state for one epoch (contains the epoch signing PRIVATE key). */
export interface SenderKeyState {
  fingerprint: string;
  epoch: number;
  chainKey: Uint8Array;
  signPub: Uint8Array; // epoch subkey public
  signPriv: Uint8Array; // epoch subkey private
  n: number;
}

/** A remote member's receiving state (no private material). */
export interface RemoteSenderKeyState {
  fingerprint: string;
  epoch: number;
  chainKey: Uint8Array;
  signPub: Uint8Array;
  n: number;
  skipped: Map<number, Uint8Array>;
}

/** What we hand to other members so they can decrypt our messages. */
export interface SenderKeyDistribution {
  fingerprint: string;
  epoch: number;
  chainKey: string; // base64
  signPub: string; // base64 (epoch subkey public)
  n: number;
  sig: string; // base64 Ed25519(identity) over the bound fields
}

const distSignBytes = (
  fingerprint: string,
  epoch: number,
  chainKey: Uint8Array,
  signPub: Uint8Array,
  n: number,
): Uint8Array => frame(utf8ToBytes(fingerprint), u32(epoch), chainKey, signPub, u32(n));

export const createSenderKey = (identity: IdentityKeyPair, epoch: number): SenderKeyState => {
  const signPriv = ed25519.utils.randomSecretKey();
  const signPub = ed25519.getPublicKey(signPriv);
  return {
    fingerprint: identity.fingerprint,
    epoch,
    chainKey: randomBytes(32),
    signPub,
    signPriv,
    n: 0,
  };
};

export const makeDistribution = (
  state: SenderKeyState,
  identity: IdentityKeyPair,
): SenderKeyDistribution => {
  const sig = signBytes(
    identity.signPriv,
    distSignBytes(state.fingerprint, state.epoch, state.chainKey, state.signPub, state.n),
  );
  return {
    fingerprint: state.fingerprint,
    epoch: state.epoch,
    chainKey: bytesToBase64(state.chainKey),
    signPub: bytesToBase64(state.signPub),
    n: state.n,
    sig: bytesToBase64(sig),
  };
};

/**
 * Verify a distribution against the claimed sender's identity and adopt it as a
 * remote receiving state. Throws if the identity fingerprint or signature is wrong.
 */
export const importDistribution = (
  dist: SenderKeyDistribution,
  senderIdentity: PublicIdentity,
): RemoteSenderKeyState => {
  if (dist.fingerprint !== senderIdentity.fingerprint) {
    throw new Error('Sender-key distribution fingerprint mismatch');
  }
  const chainKey = base64ToBytes(dist.chainKey);
  const signPub = base64ToBytes(dist.signPub);
  const ok = verifyBytes(
    senderIdentity.signPub,
    distSignBytes(dist.fingerprint, dist.epoch, chainKey, signPub, dist.n),
    base64ToBytes(dist.sig),
  );
  if (!ok) throw new Error('Sender-key distribution signature invalid');
  return { fingerprint: dist.fingerprint, epoch: dist.epoch, chainKey, signPub, n: dist.n, skipped: new Map() };
};

/** One ratchet step: derive this message's key and the next chain key. */
export const ratchetChain = (chainKey: Uint8Array): { messageKey: Uint8Array; nextChain: Uint8Array } => ({
  messageKey: hkdf(chainKey, EMPTY_SALT, LABELS.senderKeyMsg, 32),
  nextChain: hkdf(chainKey, EMPTY_SALT, LABELS.senderKeyChain, 32),
});

const roomAad = (sid: string, epoch: number, n: number): Uint8Array =>
  envelopeAad(2, 'room', utf8ToBytes(sid), u32(epoch), u32(n));

const canonicalRoomBytes = (
  sid: string,
  epoch: number,
  n: number,
  iv: Uint8Array,
  ct: Uint8Array,
  commit: Uint8Array,
): Uint8Array => frame(utf8ToBytes('room'), utf8ToBytes(sid), u32(epoch), u32(n), iv, ct, commit);

export const senderKeyEncrypt = async (
  state: SenderKeyState,
  plaintext: Uint8Array,
): Promise<{ env: RoomEnvelopeV2; state: SenderKeyState }> => {
  const { messageKey, nextChain } = ratchetChain(state.chainKey);
  const n = state.n;
  const aad = roomAad(state.fingerprint, state.epoch, n);
  const { iv, ct, commit } = await committingEncrypt(messageKey, plaintext, aad, ZERO_IV);
  const sig = signBytes(state.signPriv, canonicalRoomBytes(state.fingerprint, state.epoch, n, iv, ct, commit));
  const env: RoomEnvelopeV2 = {
    v: 2,
    k: 'room',
    sid: state.fingerprint,
    epoch: state.epoch,
    n,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(ct),
    commit: bytesToBase64(commit),
    sig: bytesToBase64(sig),
  };
  return { env, state: { ...state, chainKey: nextChain, n: n + 1 } };
};

export const senderKeyDecrypt = async (
  state: RemoteSenderKeyState,
  env: RoomEnvelopeV2,
): Promise<{ plaintext: Uint8Array; state: RemoteSenderKeyState }> => {
  if (env.sid !== state.fingerprint || env.epoch !== state.epoch) {
    throw new Error('Envelope does not match sender-key state');
  }
  const iv = base64ToBytes(env.iv);
  const ct = base64ToBytes(env.ct);
  const commit = base64ToBytes(env.commit);
  const ok = verifyBytes(
    state.signPub,
    canonicalRoomBytes(env.sid, env.epoch, env.n, iv, ct, commit),
    base64ToBytes(env.sig),
  );
  if (!ok) throw new Error('Group message signature invalid');

  const aad = roomAad(env.sid, env.epoch, env.n);
  const next = { ...state, skipped: new Map(state.skipped) };

  if (env.n < state.n) {
    // Out-of-order: must have a stored skipped key, else it's a replay/duplicate.
    const mk = next.skipped.get(env.n);
    if (!mk) throw new Error('No key for this message (replay or too old)');
    const plaintext = await committingDecrypt(mk, iv, ct, commit, aad);
    next.skipped.delete(env.n);
    return { plaintext, state: next };
  }

  // Advance the chain from state.n up to and including env.n, banking skipped keys.
  if (env.n - state.n > MAX_SKIP) throw new Error('Too many skipped messages');
  let chain = state.chainKey;
  for (let i = state.n; i < env.n; i++) {
    const { messageKey, nextChain } = ratchetChain(chain);
    next.skipped.set(i, messageKey);
    chain = nextChain;
  }
  const { messageKey, nextChain } = ratchetChain(chain);
  const plaintext = await committingDecrypt(messageKey, iv, ct, commit, aad);
  next.chainKey = nextChain;
  next.n = env.n + 1;
  // Bound memory used by skipped keys.
  while (next.skipped.size > MAX_SKIP) {
    const oldest = next.skipped.keys().next().value as number;
    next.skipped.delete(oldest);
  }
  return { plaintext, state: next };
};

// ---------------------------------------------------------------------------
// Serialization of our OWN sender-key state for keyManager persistence.
// ---------------------------------------------------------------------------

export const serializeSenderKey = (s: SenderKeyState): string =>
  JSON.stringify({
    fingerprint: s.fingerprint,
    epoch: s.epoch,
    chainKey: bytesToBase64(s.chainKey),
    signPub: bytesToBase64(s.signPub),
    signPriv: bytesToBase64(s.signPriv),
    n: s.n,
  });

export const deserializeSenderKey = (blob: string): SenderKeyState => {
  const o = JSON.parse(blob);
  return {
    fingerprint: o.fingerprint,
    epoch: o.epoch,
    chainKey: base64ToBytes(o.chainKey),
    signPub: base64ToBytes(o.signPub),
    signPriv: base64ToBytes(o.signPriv),
    n: o.n,
  };
};

/** Deterministic bytes identifying a distribution (for wrapping/AAD if needed). */
export const distributionId = (dist: SenderKeyDistribution): Uint8Array =>
  concatBytes(utf8ToBytes(dist.fingerprint), u32(dist.epoch));

// ---------------------------------------------------------------------------
// Room-key-wrapped distribution. Distributions carry the chain key in the clear,
// so they MUST be encrypted before relay. We wrap under the room key (which the
// server never holds) and bundle the sender's public identity so receivers can
// verify the signature (trust-on-first-use; safety numbers confirm out-of-band).
// ---------------------------------------------------------------------------

interface WrappedPayload {
  identity: { signPub: string; dhPub: string; fingerprint: string };
  dist: SenderKeyDistribution;
}

const WRAP_AAD = utf8ToBytes('kai/senderkey/wrap/v2');

export const wrapDistribution = async (
  roomKeyBytes: Uint8Array,
  identity: PublicIdentity,
  dist: SenderKeyDistribution,
): Promise<string> => {
  const payload: WrappedPayload = {
    identity: {
      signPub: bytesToBase64(identity.signPub),
      dhPub: bytesToBase64(identity.dhPub),
      fingerprint: identity.fingerprint,
    },
    dist,
  };
  const { iv, ct, commit } = await committingEncrypt(roomKeyBytes, utf8ToBytes(JSON.stringify(payload)), WRAP_AAD);
  return `${bytesToBase64(iv)}.${bytesToBase64(ct)}.${bytesToBase64(commit)}`;
};

export const unwrapDistribution = async (
  roomKeyBytes: Uint8Array,
  wrapped: string,
): Promise<{ identity: PublicIdentity; remote: RemoteSenderKeyState }> => {
  const [iv, ct, commit] = wrapped.split('.');
  const pt = await committingDecrypt(
    roomKeyBytes,
    base64ToBytes(iv),
    base64ToBytes(ct),
    base64ToBytes(commit),
    WRAP_AAD,
  );
  const payload: WrappedPayload = JSON.parse(new TextDecoder().decode(pt));
  const signPub = base64ToBytes(payload.identity.signPub);
  const dhPub = base64ToBytes(payload.identity.dhPub);
  // Bind the asserted fingerprint to the actual keys before trusting it.
  if (computeFingerprint(signPub, dhPub) !== payload.identity.fingerprint) {
    throw new Error('Wrapped identity fingerprint mismatch');
  }
  const identity: PublicIdentity = { signPub, dhPub, fingerprint: payload.identity.fingerprint };
  const remote = importDistribution(payload.dist, identity);
  return { identity, remote };
};
