import { describe, it, expect } from 'vitest';
import {
  utf8ToBytes,
  bytesToUtf8,
  bytesEqual,
  bytesToBase64,
  base64ToBytes,
  bytesToBase64Url,
  base64UrlToBytes,
  bytesToBase32,
  base32ToBytes,
  frame,
} from './wire';
import { hkdf, argon2idKdf, roomKdfSalt, ARGON2_ROOM } from './kdf';
import {
  aeadEncrypt,
  aeadDecrypt,
  importAesKey,
  committingEncrypt,
  committingDecrypt,
  randomBytes,
  ZERO_IV,
} from './encryption';
import {
  generateIdentity,
  computeFingerprint,
  signBytes,
  verifyBytes,
  serializePublicIdentity,
  parsePublicIdentity,
  toPublicIdentity,
  dh,
} from './identity';
import { computeSafetyNumber, roomSafetyNumber, safetyNumbersMatch } from './safetyNumber';
import { detectVersion, VersionPin, envelopeAad } from './protocol';

const TINY_ARGON = { t: 1, m: 256, p: 1, dkLen: 32 };

describe('wire', () => {
  it('base64 round-trips', () => {
    const b = randomBytes(40);
    expect(bytesEqual(base64ToBytes(bytesToBase64(b)), b)).toBe(true);
  });
  it('base64url is fragment-safe and round-trips', () => {
    const b = randomBytes(48);
    const s = bytesToBase64Url(b);
    expect(s).not.toMatch(/[+/=]/);
    expect(bytesEqual(base64UrlToBytes(s), b)).toBe(true);
  });
  it('base32 round-trips', () => {
    const b = randomBytes(20);
    expect(bytesEqual(base32ToBytes(bytesToBase32(b)), b)).toBe(true);
  });
  it('utf8 round-trips', () => {
    expect(bytesToUtf8(utf8ToBytes('héllo 🔐'))).toBe('héllo 🔐');
  });
  it('bytesEqual is length-and-content sensitive', () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
  it('frame is unambiguous under different field splits', () => {
    const a = frame(utf8ToBytes('ab'), utf8ToBytes('c'));
    const b = frame(utf8ToBytes('a'), utf8ToBytes('bc'));
    expect(bytesEqual(a, b)).toBe(false);
  });
});

describe('kdf', () => {
  it('hkdf is deterministic and label-separated', () => {
    const ikm = randomBytes(32);
    const salt = new Uint8Array(0);
    const k1 = hkdf(ikm, salt, 'kai/a', 32);
    const k1b = hkdf(ikm, salt, 'kai/a', 32);
    const k2 = hkdf(ikm, salt, 'kai/b', 32);
    expect(bytesEqual(k1, k1b)).toBe(true);
    expect(bytesEqual(k1, k2)).toBe(false);
  });
  it('argon2id is deterministic for fixed salt/params', () => {
    const pw = utf8ToBytes('room-code');
    const salt = roomKdfSalt();
    const a = argon2idKdf(pw, salt, TINY_ARGON);
    const b = argon2idKdf(pw, salt, TINY_ARGON);
    expect(bytesEqual(a, b)).toBe(true);
    expect(a.length).toBe(32);
  });
  it('roomKdfSalt is a stable constant', () => {
    expect(bytesEqual(roomKdfSalt(), roomKdfSalt())).toBe(true);
  });
  it('ARGON2_ROOM uses OWASP-interactive memory', () => {
    expect(ARGON2_ROOM.m).toBe(19456);
  });
});

describe('encryption', () => {
  it('AEAD round-trips with AAD', async () => {
    const key = await importAesKey(randomBytes(32));
    const pt = utf8ToBytes('secret message');
    const aad = utf8ToBytes('ctx');
    const { iv, ct } = await aeadEncrypt(key, pt, aad);
    const out = await aeadDecrypt(key, iv, ct, aad);
    expect(bytesToUtf8(out)).toBe('secret message');
  });
  it('AEAD fails when AAD is tampered', async () => {
    const key = await importAesKey(randomBytes(32));
    const { iv, ct } = await aeadEncrypt(key, utf8ToBytes('x'), utf8ToBytes('aad-1'));
    await expect(aeadDecrypt(key, iv, ct, utf8ToBytes('aad-2'))).rejects.toBeTruthy();
  });
  it('committing AEAD round-trips and rejects a mismatched commitment', async () => {
    const keyBytes = randomBytes(32);
    const { iv, ct, commit } = await committingEncrypt(keyBytes, utf8ToBytes('hello'));
    expect(bytesToUtf8(await committingDecrypt(keyBytes, iv, ct, commit))).toBe('hello');
    const badCommit = randomBytes(32);
    await expect(committingDecrypt(keyBytes, iv, ct, badCommit)).rejects.toThrow(/commitment/);
  });
  it('zero-IV is safe with a per-message key (round-trips)', async () => {
    const key = await importAesKey(randomBytes(32));
    const { iv, ct } = await aeadEncrypt(key, utf8ToBytes('one-time'), undefined, ZERO_IV);
    expect(bytesEqual(iv, ZERO_IV)).toBe(true);
    expect(bytesToUtf8(await aeadDecrypt(key, iv, ct))).toBe('one-time');
  });
});

describe('identity', () => {
  it('generates bound keypairs with a stable fingerprint', () => {
    const id = generateIdentity();
    expect(id.signPub.length).toBe(32);
    expect(id.dhPub.length).toBe(32);
    expect(id.fingerprint).toBe(computeFingerprint(id.signPub, id.dhPub));
  });
  it('sign/verify works and rejects tampering', () => {
    const id = generateIdentity();
    const msg = utf8ToBytes('authentic');
    const sig = signBytes(id.signPriv, msg);
    expect(verifyBytes(id.signPub, msg, sig)).toBe(true);
    expect(verifyBytes(id.signPub, utf8ToBytes('forged'), sig)).toBe(false);
  });
  it('public identity serialize/parse round-trips and recomputes the fingerprint', () => {
    const id = generateIdentity();
    const pub = toPublicIdentity(id);
    const parsed = parsePublicIdentity(serializePublicIdentity(pub));
    expect(parsed.fingerprint).toBe(pub.fingerprint);
    expect(bytesEqual(parsed.signPub, pub.signPub)).toBe(true);
  });
  it('X25519 DH agrees both directions', () => {
    const a = generateIdentity();
    const b = generateIdentity();
    expect(bytesEqual(dh(a.dhPriv, b.dhPub), dh(b.dhPriv, a.dhPub))).toBe(true);
  });
});

describe('safety numbers', () => {
  it('both parties compute the same 60-digit number regardless of order', () => {
    const a = toPublicIdentity(generateIdentity());
    const b = toPublicIdentity(generateIdentity());
    const fromA = computeSafetyNumber(a, b);
    const fromB = computeSafetyNumber(b, a);
    expect(fromA).toBe(fromB);
    expect(fromA).toMatch(/^\d{60}$/);
  });
  it('different peers yield different numbers; match() is exact', () => {
    const a = toPublicIdentity(generateIdentity());
    const b = toPublicIdentity(generateIdentity());
    const c = toPublicIdentity(generateIdentity());
    expect(safetyNumbersMatch(computeSafetyNumber(a, b), computeSafetyNumber(a, b))).toBe(true);
    expect(safetyNumbersMatch(computeSafetyNumber(a, b), computeSafetyNumber(a, c))).toBe(false);
  });
  it('room safety number is deterministic for a seed', () => {
    const seed = randomBytes(32);
    expect(roomSafetyNumber(seed)).toBe(roomSafetyNumber(seed));
    expect(roomSafetyNumber(seed)).toMatch(/^\d{60}$/);
  });
});

describe('protocol', () => {
  it('detects legacy vs v2', () => {
    expect(detectVersion({ ciphertext: 'x', iv: 'y' })).toBe(1);
    expect(detectVersion({ v: 2, k: 'room' })).toBe(2);
  });
  it('VersionPin refuses a downgrade', () => {
    const pin = new VersionPin();
    expect(pin.accept(2)).toBe(true);
    expect(pin.accept(1)).toBe(false);
    expect(pin.accept(2)).toBe(true);
  });
  it('envelopeAad binds version and kind distinctly', () => {
    expect(bytesEqual(envelopeAad(2, 'room'), envelopeAad(2, 'room'))).toBe(true);
    expect(bytesEqual(envelopeAad(2, 'room'), envelopeAad(2, 'dm'))).toBe(false);
  });
});
