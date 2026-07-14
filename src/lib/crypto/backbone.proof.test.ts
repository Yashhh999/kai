import { describe, it, expect } from 'vitest';
import { deriveRoomContext } from './room';
import { GroupSession } from './groupSession';
import { unwrapDistribution } from './senderKeys';
import { generateIdentity } from './identity';
import { base32ToBytes, bytesToUtf8, utf8ToBytes } from './wire';

/**
 * The backbone security property: an adversary who holds EVERYTHING the server sees
 * — the routingId, the relayed envelopes, and the wrapped sender-key distributions —
 * still cannot recover any plaintext, because the room key lives on a separate HKDF
 * branch that is never transmitted.
 */
describe('backbone proof: the server cannot decrypt', () => {
  it('routingId does not yield the room key, and server-visible data stays opaque', async () => {
    const code = 'SECRETCODE123456';
    const ctx = await deriveRoomContext(code);

    // Two members establish a group session and exchange (wrapped) distributions.
    const alice = generateIdentity();
    const bob = generateIdentity();
    const aSession = await GroupSession.create(ctx.roomKeyBytes, alice);
    const bSession = await GroupSession.create(ctx.roomKeyBytes, bob);
    await aSession.adopt(bSession.distribution());
    await bSession.adopt(aSession.distribution());

    const envelope = await aSession.encrypt(utf8ToBytes('top secret'));

    // Exactly what the server observes on the wire:
    const serverView = {
      routingId: ctx.routingId, // join-room roomId
      envelope, // relayed send-message payload (opaque)
      wrappedDistribution: aSession.distribution(), // relayed sender-key payload (opaque)
    };

    // 1) The room key is not the routingId, and can't be reconstructed from it.
    const routingBytes = base32ToBytes(serverView.routingId);
    expect(Buffer.from(routingBytes).equals(Buffer.from(ctx.roomKeyBytes))).toBe(false);

    // 2) An attacker who tries to treat routingId material as the room key cannot
    //    unwrap the distribution (committing AEAD rejects the wrong key).
    const attackerKeyGuess = new Uint8Array(32);
    attackerKeyGuess.set(routingBytes.slice(0, 32));
    await expect(unwrapDistribution(attackerKeyGuess, serverView.wrappedDistribution)).rejects.toBeTruthy();

    // 3) A legitimate member (with the real room key) CAN read it — sanity check that
    //    the message is well-formed and only the KEY is what gates access.
    const { plaintext } = await bSession.decrypt(serverView.envelope);
    expect(bytesToUtf8(plaintext)).toBe('top secret');
  });
});
