/**
 * legacy.ts — read-only support for the ORIGINAL (v1) format.
 *
 * The v1 scheme derived an AES-GCM-256 key directly from the raw room code with a
 * hardcoded static salt (PBKDF2, 100k). This is retained ONLY to:
 *   - decrypt messages already cached in localStorage from before the upgrade, and
 *   - interoperate with an already-open old tab during the transition window.
 *
 * It is NEVER used for outgoing messages. New rooms use `deriveRoomContext`.
 */

import { LegacyEnvelope } from './protocol';
import { base64ToBytes, utf8ToBytes } from './wire';

const LEGACY_SALT = 'rooms-chat-salt-2024';

export const deriveKeyLegacy = async (roomCode: string): Promise<CryptoKey> => {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    utf8ToBytes(roomCode) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: utf8ToBytes(LEGACY_SALT) as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
};

export const decryptMessageLegacy = async (env: LegacyEnvelope, key: CryptoKey): Promise<string> => {
  const ct = base64ToBytes(env.ciphertext);
  const iv = base64ToBytes(env.iv);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
  return new TextDecoder().decode(pt);
};
