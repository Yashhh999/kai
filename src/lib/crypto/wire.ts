/**
 * wire.ts — byte/serialization primitives shared across the crypto layer.
 *
 * No external dependencies. Everything here is deterministic and side-effect free
 * so it is trivially unit-testable and auditable.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const utf8ToBytes = (s: string): Uint8Array => textEncoder.encode(s);
export const bytesToUtf8 = (b: Uint8Array): string => textDecoder.decode(b);

export const concatBytes = (...arrays: Uint8Array[]): Uint8Array => {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
};

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  // Constant-time comparison — does not early-exit on the first differing byte.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

// ---------------------------------------------------------------------------
// Standard base64 (used for the legacy `{ciphertext, iv}` wire format)
// ---------------------------------------------------------------------------

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

export const base64ToBytes = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

// ---------------------------------------------------------------------------
// base64url (URL/​fragment-safe, no padding) — used for invite tokens & QR
// ---------------------------------------------------------------------------

export const bytesToBase64Url = (bytes: Uint8Array): string =>
  bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const base64UrlToBytes = (b64url: string): Uint8Array => {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return base64ToBytes(b64 + pad);
};

// ---------------------------------------------------------------------------
// Crockford base32 — human-readable, no ambiguous chars (0/O, 1/I/L excluded).
// Used for User-ID fingerprints and room routing ids.
// ---------------------------------------------------------------------------

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD_DECODE: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) map[CROCKFORD_ALPHABET[i]] = i;
  // Common look-alike normalizations for decode robustness.
  map['O'] = 0;
  map['I'] = 1;
  map['L'] = 1;
  return map;
})();

export const bytesToBase32 = (bytes: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
  return out;
};

export const base32ToBytes = (s: string): Uint8Array => {
  const clean = s.toUpperCase().replace(/[^0-9A-Z]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const v = CROCKFORD_DECODE[ch];
    if (v === undefined) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
};

// ---------------------------------------------------------------------------
// Length-prefixed framing — deterministic serialization for signing/AAD.
// Each field is prefixed with a 4-byte big-endian length so concatenated
// blobs are unambiguous (prevents canonicalization/confusion attacks).
// ---------------------------------------------------------------------------

export const frame = (...fields: Uint8Array[]): Uint8Array => {
  const parts: Uint8Array[] = [];
  for (const f of fields) {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, f.length, false);
    parts.push(len, f);
  }
  return concatBytes(...parts);
};

export const u32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
};
