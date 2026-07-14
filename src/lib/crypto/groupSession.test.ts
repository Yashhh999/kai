import { describe, it, expect } from 'vitest';
import { GroupSession, MissingSenderKeyError } from './groupSession';
import { generateIdentity } from './identity';
import { randomBytes } from './encryption';
import { utf8ToBytes, bytesToUtf8 } from './wire';

describe('GroupSession', () => {
  it('exchanges distributions and decrypts across two members', async () => {
    const roomKey = randomBytes(32);
    const alice = generateIdentity();
    const bob = generateIdentity();
    const aSession = await GroupSession.create(roomKey, alice);
    const bSession = await GroupSession.create(roomKey, bob);

    // Members swap wrapped distributions (as relayed by the server).
    await bSession.adopt(aSession.distribution());
    await aSession.adopt(bSession.distribution());

    const env = await aSession.encrypt(utf8ToBytes('hi from alice'));
    const got = await bSession.decrypt(env);
    expect(bytesToUtf8(got.plaintext)).toBe('hi from alice');
    expect(got.identity.fingerprint).toBe(alice.fingerprint);
  });

  it('raises MissingSenderKeyError when the distribution has not arrived yet', async () => {
    const roomKey = randomBytes(32);
    const alice = generateIdentity();
    const bob = generateIdentity();
    const aSession = await GroupSession.create(roomKey, alice);
    const bSession = await GroupSession.create(roomKey, bob);
    const env = await aSession.encrypt(utf8ToBytes('early'));
    await expect(bSession.decrypt(env)).rejects.toBeInstanceOf(MissingSenderKeyError);
    // After adopting, the buffered envelope decrypts.
    await bSession.adopt(aSession.distribution());
    expect(bytesToUtf8((await bSession.decrypt(env)).plaintext)).toBe('early');
  });

  it('rekey bumps the epoch so a new chain is issued', async () => {
    const roomKey = randomBytes(32);
    const alice = generateIdentity();
    const bob = generateIdentity();
    const aSession = await GroupSession.create(roomKey, alice);
    const bSession = await GroupSession.create(roomKey, bob);
    expect(aSession.epoch).toBe(0);
    await aSession.rekey();
    expect(aSession.epoch).toBe(1);
    await bSession.adopt(aSession.distribution());
    const env = await aSession.encrypt(utf8ToBytes('epoch 1 msg'));
    expect(env.epoch).toBe(1);
    expect(bytesToUtf8((await bSession.decrypt(env)).plaintext)).toBe('epoch 1 msg');
  });
});
