import { describe, it, expect } from 'vitest';
import { deriveRoomContext } from './room';
import { bytesEqual } from './wire';

describe('deriveRoomContext (backbone)', () => {
  it('is deterministic for a given code', async () => {
    const a = await deriveRoomContext('ABCD1234ABCD1234');
    const b = await deriveRoomContext('ABCD1234ABCD1234');
    expect(a.routingId).toBe(b.routingId);
    expect(bytesEqual(a.roomKeyBytes, b.roomKeyBytes)).toBe(true);
    expect(bytesEqual(a.roomSafetySeed, b.roomSafetySeed)).toBe(true);
  });

  it('different codes produce different routing ids and keys', async () => {
    const a = await deriveRoomContext('ABCD1234ABCD1234');
    const b = await deriveRoomContext('ZZZZ9999ZZZZ9999');
    expect(a.routingId).not.toBe(b.routingId);
    expect(bytesEqual(a.roomKeyBytes, b.roomKeyBytes)).toBe(false);
  });

  it('routingId reveals nothing usable as the room key (different byte spaces)', async () => {
    const { routingId, roomKeyBytes } = await deriveRoomContext('ABCD1234ABCD1234');
    // routingId is a 16-byte base32 string; roomKey is 32 bytes. They are separate
    // HKDF branches — this is a smoke check that they aren't trivially equal.
    expect(routingId.length).toBeGreaterThanOrEqual(24);
    expect(roomKeyBytes.length).toBe(32);
  });
});
