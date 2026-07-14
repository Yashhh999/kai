import { describe, it, expect } from 'vitest';
import {
  createSenderKey,
  makeDistribution,
  importDistribution,
  senderKeyEncrypt,
  senderKeyDecrypt,
  serializeSenderKey,
  deserializeSenderKey,
  wrapDistribution,
  unwrapDistribution,
} from './senderKeys';
import { generateIdentity, toPublicIdentity } from './identity';
import { randomBytes } from './encryption';
import { utf8ToBytes, bytesToUtf8, bytesEqual } from './wire';

describe('sender keys (group)', () => {
  it('round-trips a message from sender to receiver', async () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    let aState = createSenderKey(alice, 0);
    const dist = makeDistribution(aState, alice);
    let bView = importDistribution(dist, toPublicIdentity(alice));

    const r = await senderKeyEncrypt(aState, utf8ToBytes('hello group'));
    aState = r.state;
    const d = await senderKeyDecrypt(bView, r.env);
    bView = d.state;
    expect(bytesToUtf8(d.plaintext)).toBe('hello group');
    // bob is unused for decryption here beyond identity import; sanity ref
    expect(bob.fingerprint).not.toBe(alice.fingerprint);
  });

  it('handles out-of-order delivery via skipped keys', async () => {
    const alice = generateIdentity();
    let aState = createSenderKey(alice, 0);
    let bView = importDistribution(makeDistribution(aState, alice), toPublicIdentity(alice));

    const m0 = await senderKeyEncrypt(aState, utf8ToBytes('m0'));
    aState = m0.state;
    const m1 = await senderKeyEncrypt(aState, utf8ToBytes('m1'));
    aState = m1.state;
    const m2 = await senderKeyEncrypt(aState, utf8ToBytes('m2'));
    aState = m2.state;

    // Deliver out of order: m2 first, then m0, then m1.
    let d = await senderKeyDecrypt(bView, m2.env);
    expect(bytesToUtf8(d.plaintext)).toBe('m2');
    bView = d.state;
    d = await senderKeyDecrypt(bView, m0.env);
    expect(bytesToUtf8(d.plaintext)).toBe('m0');
    bView = d.state;
    d = await senderKeyDecrypt(bView, m1.env);
    expect(bytesToUtf8(d.plaintext)).toBe('m1');
  });

  it('rejects a forged message (bad signature)', async () => {
    const alice = generateIdentity();
    const aState = createSenderKey(alice, 0);
    const bView = importDistribution(makeDistribution(aState, alice), toPublicIdentity(alice));
    const r = await senderKeyEncrypt(aState, utf8ToBytes('legit'));
    const tampered = { ...r.env, ct: r.env.ct.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) };
    await expect(senderKeyDecrypt(bView, tampered)).rejects.toBeTruthy();
  });

  it('rejects a distribution not signed by the claimed identity', async () => {
    const alice = generateIdentity();
    const mallory = generateIdentity();
    const aState = createSenderKey(alice, 0);
    const dist = makeDistribution(aState, alice);
    // Import claiming alice's dist but verifying against mallory's identity → mismatch.
    expect(() => importDistribution(dist, toPublicIdentity(mallory))).toThrow();
  });

  it('rejects replayed messages once consumed', async () => {
    const alice = generateIdentity();
    const aState = createSenderKey(alice, 0);
    let bView = importDistribution(makeDistribution(aState, alice), toPublicIdentity(alice));
    const r = await senderKeyEncrypt(aState, utf8ToBytes('once'));
    const d = await senderKeyDecrypt(bView, r.env);
    bView = d.state;
    await expect(senderKeyDecrypt(bView, r.env)).rejects.toBeTruthy(); // replay
  });

  it('serializes and restores own sender-key state', () => {
    const alice = generateIdentity();
    const s = createSenderKey(alice, 3);
    const restored = deserializeSenderKey(serializeSenderKey(s));
    expect(restored.epoch).toBe(3);
    expect(bytesEqual(restored.chainKey, s.chainKey)).toBe(true);
    expect(bytesEqual(restored.signPriv, s.signPriv)).toBe(true);
  });

  it('wraps a distribution under the room key so a member (not the server) can adopt it', async () => {
    const alice = generateIdentity();
    const roomKey = randomBytes(32);
    const aState = createSenderKey(alice, 0);
    const dist = makeDistribution(aState, alice);

    const wrapped = await wrapDistribution(roomKey, toPublicIdentity(alice), dist);
    // A member with the room key recovers the sender identity + receiving state.
    const { identity, remote } = await unwrapDistribution(roomKey, wrapped);
    expect(identity.fingerprint).toBe(alice.fingerprint);

    const r = await senderKeyEncrypt(aState, utf8ToBytes('wrapped hello'));
    const d = await senderKeyDecrypt(remote, r.env);
    expect(bytesToUtf8(d.plaintext)).toBe('wrapped hello');

    // The server (no room key) cannot unwrap it.
    await expect(unwrapDistribution(randomBytes(32), wrapped)).rejects.toBeTruthy();
  });
});
