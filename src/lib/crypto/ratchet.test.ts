import { describe, it, expect } from 'vitest';
import {
  generatePreKeyBundle,
  initiateSession,
  respondSession,
  ratchetEncrypt,
  ratchetDecrypt,
  serializeRatchet,
  deserializeRatchet,
  RatchetState,
} from './ratchet';
import { generateIdentity } from './identity';
import { utf8ToBytes, bytesToUtf8 } from './wire';

const enc = (s: string) => utf8ToBytes(s);
const dec = (b: Uint8Array) => bytesToUtf8(b);

/** Establish a session: Bob publishes a bundle, Alice initiates, Bob responds to msg1. */
const handshake = async () => {
  const alice = generateIdentity();
  const bob = generateIdentity();
  const { bundle, secrets } = generatePreKeyBundle(bob);
  const { state: aliceState, init } = initiateSession(alice, bundle);
  const first = await ratchetEncrypt(aliceState, enc('hello bob'));
  const bobState = respondSession(bob, secrets, init);
  const d = await ratchetDecrypt(bobState, first.env);
  expect(dec(d.plaintext)).toBe('hello bob');
  return { alice, bob, aliceState: first.state, bobState: d.state };
};

describe('X3DH + Double Ratchet', () => {
  it('completes a handshake and decrypts the first message', async () => {
    await handshake();
  });

  it('supports a full back-and-forth conversation', async () => {
    let { aliceState, bobState } = await handshake();

    const b1 = await ratchetEncrypt(bobState, enc('hi alice'));
    bobState = b1.state;
    const da = await ratchetDecrypt(aliceState, b1.env);
    aliceState = da.state;
    expect(dec(da.plaintext)).toBe('hi alice');

    const a2 = await ratchetEncrypt(aliceState, enc('how are you'));
    aliceState = a2.state;
    const db = await ratchetDecrypt(bobState, a2.env);
    bobState = db.state;
    expect(dec(db.plaintext)).toBe('how are you');

    const b2 = await ratchetEncrypt(bobState, enc('good thanks'));
    const da2 = await ratchetDecrypt(aliceState, b2.env);
    expect(dec(da2.plaintext)).toBe('good thanks');
  });

  it('handles out-of-order messages within a chain', async () => {
    let { aliceState, bobState } = await handshake();
    const m1 = await ratchetEncrypt(aliceState, enc('m1'));
    aliceState = m1.state;
    const m2 = await ratchetEncrypt(aliceState, enc('m2'));
    aliceState = m2.state;
    const m3 = await ratchetEncrypt(aliceState, enc('m3'));

    // Deliver m3, then m1, then m2.
    let d = await ratchetDecrypt(bobState, m3.env);
    expect(dec(d.plaintext)).toBe('m3');
    bobState = d.state;
    d = await ratchetDecrypt(bobState, m1.env);
    expect(dec(d.plaintext)).toBe('m1');
    bobState = d.state;
    d = await ratchetDecrypt(bobState, m2.env);
    expect(dec(d.plaintext)).toBe('m2');
  });

  it('rejects a tampered ciphertext', async () => {
    const { aliceState, bobState } = await handshake();
    const m = await ratchetEncrypt(aliceState, enc('secret'));
    const tampered = { ...m.env, ct: m.env.ct.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) };
    await expect(ratchetDecrypt(bobState, tampered)).rejects.toBeTruthy();
  });

  it('rejects a bundle with an invalid signed-prekey signature', () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    const { bundle } = generatePreKeyBundle(bob);
    bundle.signedPreKeySig = new Uint8Array(64); // forged
    expect(() => initiateSession(alice, bundle)).toThrow(/signature/);
  });

  it('persists and restores ratchet state mid-conversation', async () => {
    const { aliceState, bobState } = await handshake();
    const restored: RatchetState = deserializeRatchet(serializeRatchet(bobState));
    const a = await ratchetEncrypt(aliceState, enc('after reload'));
    const d = await ratchetDecrypt(restored, a.env);
    expect(dec(d.plaintext)).toBe('after reload');
  });
});
