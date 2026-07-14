import { describe, it, expect } from 'vitest';
import { createKeyManager, KVStore } from './keyManager';
import { Argon2Params } from './kdf';

const FAST_ARGON: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 32 };

const memStore = (): KVStore => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
};

describe('KeyManager sealed store', () => {
  it('creates an identity and unlocks with the correct PIN', async () => {
    const store = memStore();
    const km = createKeyManager(store, FAST_ARGON);
    const pub = await km.createWithPin('1234');
    expect(km.hasSealedStore()).toBe(true);
    expect(km.isUnlocked()).toBe(true);

    // A fresh manager over the same store can unlock and recover the same identity.
    const km2 = createKeyManager(store, FAST_ARGON);
    expect(km2.isUnlocked()).toBe(false);
    await km2.unlock('1234');
    expect(km2.getPublicIdentity().fingerprint).toBe(pub.fingerprint);
  });

  it('rejects a wrong PIN without any plaintext comparison', async () => {
    const store = memStore();
    const km = createKeyManager(store, FAST_ARGON);
    await km.createWithPin('1234');
    const km2 = createKeyManager(store, FAST_ARGON);
    await expect(km2.unlock('9999')).rejects.toBeTruthy();
    expect(store.getItem('session_pin')).toBeNull(); // no plaintext PIN anywhere
  });

  it('persists sessions and sender keys across lock/unlock', async () => {
    const store = memStore();
    const km = createKeyManager(store, FAST_ARGON);
    await km.createWithPin('1234');
    await km.saveSession('peerFP', 'ratchet-blob');
    await km.saveSenderKey('routing123', 'senderkey-blob');
    km.lock();
    expect(km.isUnlocked()).toBe(false);

    const km2 = createKeyManager(store, FAST_ARGON);
    await km2.unlock('1234');
    expect(km2.loadSession('peerFP')).toBe('ratchet-blob');
    expect(km2.loadSenderKey('routing123')).toBe('senderkey-blob');
  });

  it('changePin re-seals under a new PIN', async () => {
    const store = memStore();
    const km = createKeyManager(store, FAST_ARGON);
    const pub = await km.createWithPin('1111');
    await km.changePin('1111', '2222');

    const km2 = createKeyManager(store, FAST_ARGON);
    await expect(km2.unlock('1111')).rejects.toBeTruthy();
    await km2.unlock('2222');
    expect(km2.getPublicIdentity().fingerprint).toBe(pub.fingerprint);
  });

  it('remembers conversations (sorted by activity) across lock/unlock', async () => {
    const store = memStore();
    const km = createKeyManager(store, FAST_ARGON);
    await km.createWithPin('1234');
    await km.upsertConversation({ id: 'r1', kind: 'room', label: 'Room 1', lastActivity: 100, routingId: 'r1', code: 'AAAA1111AAAA1111' });
    await km.upsertConversation({ id: 'dm:PEER', kind: 'dm', label: 'peer', lastActivity: 200, peer: 'PEER' });
    km.lock();

    const km2 = createKeyManager(store, FAST_ARGON);
    await km2.unlock('1234');
    const convos = km2.getConversations();
    expect(convos.map((c) => c.id)).toEqual(['dm:PEER', 'r1']); // most recent first
    await km2.removeConversation('r1');
    expect(km2.getConversations().map((c) => c.id)).toEqual(['dm:PEER']);
  });

  it('persists DM history and bounds/round-trips it', async () => {
    const store = memStore();
    const km = createKeyManager(store, FAST_ARGON);
    await km.createWithPin('1234');
    await km.appendDmMessage('PEER', { mine: true, text: 'hello', ts: 1 });
    await km.appendDmMessage('PEER', { mine: false, text: 'hi', ts: 2 });
    km.lock();

    const km2 = createKeyManager(store, FAST_ARGON);
    await km2.unlock('1234');
    const hist = km2.getDmHistory('PEER');
    expect(hist.map((m) => m.text)).toEqual(['hello', 'hi']);
    expect(km2.getDmHistory('UNKNOWN')).toEqual([]);
  });

  it('roomCacheKey is deterministic per routingId and locked-safe', async () => {
    const store = memStore();
    const km = createKeyManager(store, FAST_ARGON);
    await km.createWithPin('1234');
    const k1 = km.roomCacheKey('routingA');
    const k2 = km.roomCacheKey('routingA');
    const k3 = km.roomCacheKey('routingB');
    expect(Buffer.from(k1).equals(Buffer.from(k2))).toBe(true);
    expect(Buffer.from(k1).equals(Buffer.from(k3))).toBe(false);
    km.lock();
    expect(() => km.roomCacheKey('routingA')).toThrow();
  });
});
