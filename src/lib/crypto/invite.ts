/**
 * invite.ts — shareable room invites.
 *
 * The room key never reaches the server: the entire token lives in the URL FRAGMENT
 * (`/join#i=…`), which browsers never transmit. The token carries the room's
 * routingId and the room key WRAPPED under either:
 *   - a random per-link key placed in a second fragment param (`k`), or
 *   - a key derived from an invite password via Argon2id (`pwSalt` is public).
 *
 * The issuer signs the token with their identity so a relay can't tamper with the
 * flags/expiry, and the joiner learns who invited them (for safety-number checks).
 * Single-use / max-uses / expiry counters are enforced by the server's ephemeral
 * in-RAM registry keyed by `inviteId = SHA-256(nonce)` — a hash, never the key.
 */

import { argon2idKdf, hkdf, sha256Bytes, LABELS, ARGON2_INTERACTIVE, EMPTY_SALT } from './kdf';
import { committingEncrypt, committingDecrypt, randomBytes } from './encryption';
import { IdentityKeyPair, computeFingerprint, signBytes, verifyBytes } from './identity';
import {
  bytesToBase64,
  base64ToBytes,
  bytesToBase64Url,
  base64UrlToBytes,
  utf8ToBytes,
  frame,
} from './wire';

export interface InviteFlags {
  maxUses?: number;
  expiresAt?: number; // epoch ms
  oneTime?: boolean;
  maxParticipants?: number;
}

export interface InvitePayloadV2 {
  v: 2;
  routingId: string;
  wrappedKey: string; // "ivB64.ctB64.commitB64"
  flags: InviteFlags;
  issuerSignPub: string; // base64
  issuerDhPub: string; // base64
  issuerFingerprint: string;
  issuedAt: number;
  nonce: string; // base64url
  pwSalt?: string; // base64 (present iff password-protected)
  sig: string; // base64 Ed25519(issuer) over canonical(token minus sig)
}

/**
 * Deterministic JSON with sorted keys — stable input for signing. Keys whose value
 * is `undefined` are skipped so that a field being absent vs. explicitly-undefined
 * (which `JSON.stringify` drops when the token is serialized into the link) produces
 * identical canonical bytes on both the signing and verifying side.
 */
const stableStringify = (obj: unknown): string => {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
};

const canonicalBytes = (token: Omit<InvitePayloadV2, 'sig'>): Uint8Array =>
  utf8ToBytes(stableStringify(token));

/** AEAD associated data binding the wrap to this specific invite. */
const wrapAad = (routingId: string, nonce: string): Uint8Array =>
  frame(utf8ToBytes(routingId), base64UrlToBytes(nonce));

const packWrapped = (iv: Uint8Array, ct: Uint8Array, commit: Uint8Array): string =>
  `${bytesToBase64(iv)}.${bytesToBase64(ct)}.${bytesToBase64(commit)}`;

const unpackWrapped = (s: string): { iv: Uint8Array; ct: Uint8Array; commit: Uint8Array } => {
  const [iv, ct, commit] = s.split('.');
  return { iv: base64ToBytes(iv), ct: base64ToBytes(ct), commit: base64ToBytes(commit) };
};

/** SHA-256(nonce) base64url — the server's opaque invite id (no key material). */
export const inviteId = (token: InvitePayloadV2): string =>
  bytesToBase64Url(sha256Bytes(base64UrlToBytes(token.nonce)));

export interface CreatedInvite {
  token: InvitePayloadV2;
  /** Fragment string to append after `#` (e.g. `i=…&k=…`). */
  fragment: string;
  /** Full link if an origin/path is provided. */
  link: (origin: string, path?: string) => string;
}

export const createInvite = async (
  roomKeyBytes: Uint8Array,
  routingId: string,
  self: IdentityKeyPair,
  flags: InviteFlags = {},
  password?: string,
): Promise<CreatedInvite> => {
  const nonce = bytesToBase64Url(randomBytes(16));
  const aad = wrapAad(routingId, nonce);

  let wrapKey: Uint8Array;
  let linkKey: Uint8Array | null = null;
  let pwSalt: string | undefined;
  if (password) {
    const salt = randomBytes(16);
    pwSalt = bytesToBase64(salt);
    wrapKey = hkdf(argon2idKdf(utf8ToBytes(password), salt, ARGON2_INTERACTIVE), EMPTY_SALT, LABELS.inviteWrap, 32);
  } else {
    linkKey = randomBytes(32);
    wrapKey = hkdf(linkKey, EMPTY_SALT, LABELS.inviteWrap, 32);
  }

  const { iv, ct, commit } = await committingEncrypt(wrapKey, roomKeyBytes, aad);
  const unsigned: Omit<InvitePayloadV2, 'sig'> = {
    v: 2,
    routingId,
    wrappedKey: packWrapped(iv, ct, commit),
    flags,
    issuerSignPub: bytesToBase64(self.signPub),
    issuerDhPub: bytesToBase64(self.dhPub),
    issuerFingerprint: self.fingerprint,
    issuedAt: Date.now(),
    nonce,
    pwSalt,
  };
  const sig = bytesToBase64(signBytes(self.signPriv, canonicalBytes(unsigned)));
  const token: InvitePayloadV2 = { ...unsigned, sig };

  const iParam = bytesToBase64Url(utf8ToBytes(JSON.stringify(token)));
  const fragment = linkKey ? `i=${iParam}&k=${bytesToBase64Url(linkKey)}` : `i=${iParam}`;
  return {
    token,
    fragment,
    link: (origin, path = '/join') => `${origin}${path}#${fragment}`,
  };
};

export interface ParsedInvite {
  token: InvitePayloadV2;
  linkKey?: Uint8Array;
}

/** Parse a link or bare fragment (`#i=…&k=…` or `i=…&k=…`). */
export const parseInvite = (linkOrFragment: string): ParsedInvite => {
  const hashIdx = linkOrFragment.indexOf('#');
  const fragment = hashIdx >= 0 ? linkOrFragment.slice(hashIdx + 1) : linkOrFragment;
  const params = new URLSearchParams(fragment);
  const i = params.get('i');
  if (!i) throw new Error('Invite token missing');
  const token: InvitePayloadV2 = JSON.parse(new TextDecoder().decode(base64UrlToBytes(i)));
  const k = params.get('k');
  return { token, linkKey: k ? base64UrlToBytes(k) : undefined };
};

/** True if the token's issuer identity and signature are self-consistent. */
export const verifyInvite = (token: InvitePayloadV2): boolean => {
  const signPub = base64ToBytes(token.issuerSignPub);
  const dhPub = base64ToBytes(token.issuerDhPub);
  if (computeFingerprint(signPub, dhPub) !== token.issuerFingerprint) return false;
  const { sig, ...unsigned } = token;
  return verifyBytes(signPub, canonicalBytes(unsigned), base64ToBytes(sig));
};

export interface RedeemResult {
  roomKeyBytes: Uint8Array;
  routingId: string;
  issuerFingerprint: string;
}

export const redeemInvite = async (
  parsed: ParsedInvite,
  opts: { password?: string } = {},
): Promise<RedeemResult> => {
  const { token, linkKey } = parsed;
  if (!verifyInvite(token)) throw new Error('Invite signature/identity invalid');
  if (token.flags.expiresAt && Date.now() > token.flags.expiresAt) throw new Error('Invite expired');

  let wrapKey: Uint8Array;
  if (token.pwSalt) {
    if (!opts.password) throw new Error('This invite requires a password');
    wrapKey = hkdf(
      argon2idKdf(utf8ToBytes(opts.password), base64ToBytes(token.pwSalt), ARGON2_INTERACTIVE),
      EMPTY_SALT,
      LABELS.inviteWrap,
      32,
    );
  } else {
    if (!linkKey) throw new Error('Invite link key missing');
    wrapKey = hkdf(linkKey, EMPTY_SALT, LABELS.inviteWrap, 32);
  }

  const { iv, ct, commit } = unpackWrapped(token.wrappedKey);
  const aad = wrapAad(token.routingId, token.nonce);
  const roomKeyBytes = await committingDecrypt(wrapKey, iv, ct, commit, aad);
  return { roomKeyBytes, routingId: token.routingId, issuerFingerprint: token.issuerFingerprint };
};
