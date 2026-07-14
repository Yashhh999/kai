/**
 * inviteSession.ts — hand a redeemed invite's room key from the landing page to the
 * room page across a client-side navigation.
 *
 * Invitees receive the room KEY (wrapped in the invite), not the room code, so they
 * enter the room by its routingId. We stash the unwrapped key in sessionStorage
 * (cleared when the tab closes) keyed by routingId; the room page picks it up and
 * builds a room context without a code.
 */

import { base64ToBytes, bytesToBase64 } from './crypto/wire';

const PREFIX = 'kai_invitekey_';

export interface StashedInvite {
  roomKeyBytes: Uint8Array;
  issuerFingerprint: string;
}

export const stashInvite = (routingId: string, roomKeyBytes: Uint8Array, issuerFingerprint: string): void => {
  sessionStorage.setItem(
    PREFIX + routingId,
    JSON.stringify({ k: bytesToBase64(roomKeyBytes), issuer: issuerFingerprint }),
  );
};

export const readStashedInvite = (routingId: string): StashedInvite | null => {
  try {
    const raw = sessionStorage.getItem(PREFIX + routingId);
    if (!raw) return null;
    const { k, issuer } = JSON.parse(raw);
    return { roomKeyBytes: base64ToBytes(k), issuerFingerprint: issuer };
  } catch {
    return null;
  }
};
