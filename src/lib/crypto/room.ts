/**
 * room.ts — the backbone fix.
 *
 * A room code is stretched with Argon2id into a single 32-byte `seed`, then split
 * by HKDF into THREE independent, domain-separated branches:
 *
 *   routingId      → what the server sees (the Socket.IO room name)
 *   roomKeyBytes   → the client-only symmetric root for the room
 *   roomSafetySeed → basis for the room-level safety number
 *
 * Because HKDF-Expand is a PRF, `routingId` leaks nothing about the sibling
 * `roomKeyBytes`. The server only ever receives `routingId`, so — unlike today,
 * where the raw code is both the room id and the key material — it can route but
 * can never derive the room key.
 */

import { argon2idKdf, hkdf, roomKdfSalt, LABELS, ARGON2_ROOM, EMPTY_SALT } from './kdf';
import { importAesKey } from './encryption';
import { bytesToBase32, utf8ToBytes } from './wire';

export interface RoomContext {
  routingId: string; // server room name (Crockford base32 of 16 bytes)
  roomKeyBytes: Uint8Array; // 32-byte symmetric root (client only)
  roomKey: CryptoKey; // AES-GCM-256, non-extractable
  roomSafetySeed: Uint8Array; // 32 bytes
}

/**
 * Derive the full room context from a room code. Runs Argon2id (~1–3 s in-browser)
 * exactly once per room join; all per-message work downstream is fast HKDF/AEAD.
 */
export const deriveRoomContext = async (roomCode: string): Promise<RoomContext> => {
  const seed = argon2idKdf(utf8ToBytes(roomCode), roomKdfSalt(), ARGON2_ROOM);
  const routingBytes = hkdf(seed, EMPTY_SALT, LABELS.routingId, 16);
  const roomKeyBytes = hkdf(seed, EMPTY_SALT, LABELS.roomKey, 32);
  return roomContextFromKey(bytesToBase32(routingBytes), roomKeyBytes);
};

/**
 * Build a room context from an already-known routingId + room key. Used by invitees,
 * who receive the room key (wrapped in the invite) rather than the room code. The
 * safety seed is derived from the room key itself so that everyone holding the key —
 * including invitees — computes the same room safety number, while the server (which
 * never holds the key) cannot.
 */
export const roomContextFromKey = async (
  routingId: string,
  roomKeyBytes: Uint8Array,
): Promise<RoomContext> => {
  const roomSafetySeed = hkdf(roomKeyBytes, EMPTY_SALT, LABELS.roomSafety, 32);
  const roomKey = await importAesKey(roomKeyBytes);
  return { routingId, roomKeyBytes, roomKey, roomSafetySeed };
};
