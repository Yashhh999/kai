/**
 * ratchet.ts — 1:1 direct messages: X3DH handshake + Double Ratchet.
 *
 * Provides per-message forward secrecy and post-compromise security. Message
 * authentication comes from the ratchet's symmetric AEAD keys (not signatures), so
 * 1:1 messages remain deniable — either party could have produced them.
 *
 * Prekeys live only in the ephemeral in-RAM rendezvous: a client publishes a fresh
 * signed prekey + one-time prekey on connect, the initiator fetches the live bundle
 * and runs X3DH. There is no durable prekey pool or offline queue (that would be
 * durable server storage) — DMs require both parties online, by design.
 *
 * Follows the Signal Double Ratchet spec; KDFs are HKDF-SHA-256 with the labels in
 * kdf.ts. Skipped message keys are bounded to resist memory-exhaustion DoS.
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf, LABELS, EMPTY_SALT } from './kdf';
import { importAesKey, aeadEncrypt, aeadDecrypt, ZERO_IV } from './encryption';
import {
  IdentityKeyPair,
  PublicIdentity,
  computeFingerprint,
  signBytes,
  verifyBytes,
  dh,
} from './identity';
import { DirectEnvelopeV2, RatchetHeaderWire } from './protocol';
import {
  bytesToBase64,
  base64ToBytes,
  concatBytes,
  frame,
  u32,
  bytesEqual,
} from './wire';

const MAX_SKIP = 2000;

interface KeyPair {
  pub: Uint8Array;
  priv: Uint8Array;
}

const genDh = (): KeyPair => {
  const priv = x25519.utils.randomSecretKey();
  return { pub: x25519.getPublicKey(priv), priv };
};

// ---------------------------------------------------------------------------
// Prekey bundles (published into the rendezvous)
// ---------------------------------------------------------------------------

export interface PreKeyBundle {
  identity: PublicIdentity;
  signedPreKey: Uint8Array; // X25519 pub
  signedPreKeySig: Uint8Array; // Ed25519(identity) over signedPreKey
  oneTimePreKey?: Uint8Array; // X25519 pub
  epoch: number;
}

/** Secret half a responder keeps in memory after publishing a bundle. */
export interface PreKeySecrets {
  signedPreKey: KeyPair;
  oneTimePreKey?: KeyPair;
  epoch: number;
}

export const generatePreKeyBundle = (
  self: IdentityKeyPair,
): { bundle: PreKeyBundle; secrets: PreKeySecrets } => {
  const spk = genDh();
  const opk = genDh();
  const sig = signBytes(self.signPriv, spk.pub);
  return {
    bundle: {
      identity: { signPub: self.signPub, dhPub: self.dhPub, fingerprint: self.fingerprint },
      signedPreKey: spk.pub,
      signedPreKeySig: sig,
      oneTimePreKey: opk.pub,
      epoch: Date.now(),
    },
    secrets: { signedPreKey: spk, oneTimePreKey: opk, epoch: Date.now() },
  };
};

// ---------------------------------------------------------------------------
// X3DH
// ---------------------------------------------------------------------------

/** First message sent alongside the initial ratchet ciphertext. */
export interface InitialMessage {
  identitySignPub: string; // base64
  identityDhPub: string; // base64
  ephPub: string; // base64 EK_a
  usedOneTime: boolean;
}

const x3dhAd = (aDh: Uint8Array, bDh: Uint8Array): Uint8Array => frame(aDh, bDh);

const rootFromDhs = (dhs: Uint8Array[]): Uint8Array =>
  hkdf(concatBytes(...dhs), new Uint8Array(32), LABELS.x3dhRoot, 32);

export interface RatchetState {
  peerFingerprint: string;
  ad: Uint8Array;
  rk: Uint8Array;
  dhs: KeyPair;
  dhr: Uint8Array | null;
  cks: Uint8Array | null;
  ckr: Uint8Array | null;
  ns: number;
  nr: number;
  pn: number;
  skipped: Map<string, Uint8Array>;
}

const kdfRk = (rk: Uint8Array, dhOut: Uint8Array): { rk: Uint8Array; ck: Uint8Array } => {
  const out = hkdf(dhOut, rk, LABELS.ratchetRoot, 64);
  return { rk: out.slice(0, 32), ck: out.slice(32, 64) };
};

const kdfCk = (ck: Uint8Array): { ck: Uint8Array; mk: Uint8Array } => ({
  mk: hkdf(ck, EMPTY_SALT, LABELS.ratchetMsg, 32),
  ck: hkdf(ck, EMPTY_SALT, LABELS.ratchetChain, 32),
});

/**
 * Initiator (Alice): verify Bob's signed prekey, run X3DH, initialize the ratchet
 * ready to send. Returns the state plus the InitialMessage Bob needs.
 */
export const initiateSession = (
  self: IdentityKeyPair,
  bundle: PreKeyBundle,
): { state: RatchetState; init: InitialMessage } => {
  if (!verifyBytes(bundle.identity.signPub, bundle.signedPreKey, bundle.signedPreKeySig)) {
    throw new Error('Signed prekey signature invalid');
  }
  const eph = genDh();
  const dh1 = dh(self.dhPriv, bundle.signedPreKey);
  const dh2 = dh(eph.priv, bundle.identity.dhPub);
  const dh3 = dh(eph.priv, bundle.signedPreKey);
  const dhs = [dh1, dh2, dh3];
  if (bundle.oneTimePreKey) dhs.push(dh(eph.priv, bundle.oneTimePreKey));
  const sk = rootFromDhs(dhs);
  const ad = x3dhAd(self.dhPub, bundle.identity.dhPub);

  // RatchetInitAlice: DHr = Bob's signed prekey; derive sending chain immediately.
  const initialDhs = genDh();
  const { rk, ck } = kdfRk(sk, dh(initialDhs.priv, bundle.signedPreKey));
  const state: RatchetState = {
    peerFingerprint: bundle.identity.fingerprint,
    ad,
    rk,
    dhs: initialDhs,
    dhr: bundle.signedPreKey,
    cks: ck,
    ckr: null,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: new Map(),
  };
  return {
    state,
    init: {
      identitySignPub: bytesToBase64(self.signPub),
      identityDhPub: bytesToBase64(self.dhPub),
      ephPub: bytesToBase64(eph.pub),
      usedOneTime: !!bundle.oneTimePreKey,
    },
  };
};

/**
 * Responder (Bob): reconstruct X3DH from Alice's InitialMessage using his own prekey
 * secrets, then initialize the ratchet ready to receive Alice's first message.
 */
export const respondSession = (
  self: IdentityKeyPair,
  secrets: PreKeySecrets,
  init: InitialMessage,
): RatchetState => {
  const aliceDh = base64ToBytes(init.identityDhPub);
  const aliceEph = base64ToBytes(init.ephPub);
  const dh1 = dh(secrets.signedPreKey.priv, aliceDh);
  const dh2 = dh(self.dhPriv, aliceEph);
  const dh3 = dh(secrets.signedPreKey.priv, aliceEph);
  const dhs = [dh1, dh2, dh3];
  if (init.usedOneTime) {
    if (!secrets.oneTimePreKey) throw new Error('One-time prekey required but missing');
    dhs.push(dh(secrets.oneTimePreKey.priv, aliceEph));
  }
  const sk = rootFromDhs(dhs);
  const ad = x3dhAd(aliceDh, self.dhPub);
  const aliceSignPub = base64ToBytes(init.identitySignPub);

  // RatchetInitBob: DHs = signed prekey pair, RK = SK, chains derived on first recv.
  return {
    peerFingerprint: computeFingerprint(aliceSignPub, aliceDh),
    ad,
    rk: sk,
    dhs: secrets.signedPreKey,
    dhr: null,
    cks: null,
    ckr: null,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: new Map(),
  };
};

// ---------------------------------------------------------------------------
// Message encryption / decryption
//
// Each ratchet message key is single-use, so a fixed zero IV is safe and a plain
// (non-committing) AEAD suffices: AES-GCM integrity binds the ciphertext to that
// exact one-time key, and the header + X3DH AD are folded into the AAD.
// ---------------------------------------------------------------------------

const headerBytes = (h: RatchetHeaderWire): Uint8Array =>
  frame(base64ToBytes(h.dh), u32(h.pn), u32(h.n));

const skipKey = (dhr: Uint8Array, n: number): string => `${bytesToBase64(dhr)}:${n}`;

const decryptWith = async (
  keyBytes: Uint8Array,
  iv: Uint8Array,
  ct: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> => aeadDecrypt(await importAesKey(keyBytes), iv, ct, aad);

export const ratchetEncrypt = async (
  state: RatchetState,
  plaintext: Uint8Array,
): Promise<{ env: DirectEnvelopeV2; state: RatchetState }> => {
  if (!state.cks) throw new Error('No sending chain (cannot send yet)');
  const { ck, mk } = kdfCk(state.cks);
  const header: RatchetHeaderWire = { dh: bytesToBase64(state.dhs.pub), pn: state.pn, n: state.ns };
  const aad = concatBytes(state.ad, headerBytes(header));
  const { iv, ct } = await aeadEncrypt(await importAesKey(mk), plaintext, aad, ZERO_IV);
  const env: DirectEnvelopeV2 = { v: 2, k: 'dm', hdr: header, iv: bytesToBase64(iv), ct: bytesToBase64(ct) };
  return { env, state: { ...state, cks: ck, ns: state.ns + 1 } };
};

const trySkipped = async (
  state: RatchetState,
  env: DirectEnvelopeV2,
): Promise<Uint8Array | null> => {
  const dhr = base64ToBytes(env.hdr.dh);
  const key = skipKey(dhr, env.hdr.n);
  const mk = state.skipped.get(key);
  if (!mk) return null;
  const aad = concatBytes(state.ad, headerBytes(env.hdr));
  const pt = await decryptWith(mk, base64ToBytes(env.iv), base64ToBytes(env.ct), aad);
  state.skipped.delete(key);
  return pt;
};

const skipMessageKeys = (state: RatchetState, until: number): void => {
  if (state.ckr === null) return;
  if (until - state.nr > MAX_SKIP) throw new Error('Too many skipped messages');
  while (state.nr < until) {
    const { ck, mk } = kdfCk(state.ckr);
    state.skipped.set(skipKey(state.dhr!, state.nr), mk);
    state.ckr = ck;
    state.nr += 1;
  }
  while (state.skipped.size > MAX_SKIP) {
    const oldest = state.skipped.keys().next().value as string;
    state.skipped.delete(oldest);
  }
};

const dhRatchet = (state: RatchetState, header: RatchetHeaderWire): void => {
  state.pn = state.ns;
  state.ns = 0;
  state.nr = 0;
  state.dhr = base64ToBytes(header.dh);
  {
    const { rk, ck } = kdfRk(state.rk, dh(state.dhs.priv, state.dhr));
    state.rk = rk;
    state.ckr = ck;
  }
  state.dhs = genDh();
  {
    const { rk, ck } = kdfRk(state.rk, dh(state.dhs.priv, state.dhr));
    state.rk = rk;
    state.cks = ck;
  }
};

export const ratchetDecrypt = async (
  input: RatchetState,
  env: DirectEnvelopeV2,
): Promise<{ plaintext: Uint8Array; state: RatchetState }> => {
  // Work on a shallow clone so a failed decrypt doesn't corrupt caller state.
  const state: RatchetState = { ...input, skipped: new Map(input.skipped), dhs: { ...input.dhs } };

  const skippedPt = await trySkipped(state, env);
  if (skippedPt) return { plaintext: skippedPt, state };

  const headerDh = base64ToBytes(env.hdr.dh);
  if (!state.dhr || !bytesEqual(headerDh, state.dhr)) {
    skipMessageKeys(state, env.hdr.pn);
    dhRatchet(state, env.hdr);
  }
  skipMessageKeys(state, env.hdr.n);
  if (state.ckr === null) throw new Error('No receiving chain');
  const { ck, mk } = kdfCk(state.ckr);
  const aad = concatBytes(state.ad, headerBytes(env.hdr));
  const plaintext = await decryptWith(mk, base64ToBytes(env.iv), base64ToBytes(env.ct), aad);
  state.ckr = ck;
  state.nr += 1;
  return { plaintext, state };
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export const serializeRatchet = (s: RatchetState): string =>
  JSON.stringify({
    peerFingerprint: s.peerFingerprint,
    ad: bytesToBase64(s.ad),
    rk: bytesToBase64(s.rk),
    dhsPub: bytesToBase64(s.dhs.pub),
    dhsPriv: bytesToBase64(s.dhs.priv),
    dhr: s.dhr ? bytesToBase64(s.dhr) : null,
    cks: s.cks ? bytesToBase64(s.cks) : null,
    ckr: s.ckr ? bytesToBase64(s.ckr) : null,
    ns: s.ns,
    nr: s.nr,
    pn: s.pn,
    skipped: Array.from(s.skipped.entries()).map(([k, v]) => [k, bytesToBase64(v)]),
  });

export const deserializeRatchet = (blob: string): RatchetState => {
  const o = JSON.parse(blob);
  return {
    peerFingerprint: o.peerFingerprint,
    ad: base64ToBytes(o.ad),
    rk: base64ToBytes(o.rk),
    dhs: { pub: base64ToBytes(o.dhsPub), priv: base64ToBytes(o.dhsPriv) },
    dhr: o.dhr ? base64ToBytes(o.dhr) : null,
    cks: o.cks ? base64ToBytes(o.cks) : null,
    ckr: o.ckr ? base64ToBytes(o.ckr) : null,
    ns: o.ns,
    nr: o.nr,
    pn: o.pn,
    skipped: new Map((o.skipped as [string, string][]).map(([k, v]) => [k, base64ToBytes(v)])),
  };
};
