/**
 * fileTransfer.ts — encrypt file payloads under the room key.
 *
 * Fixes two gaps in the legacy app: direct files were AES-GCM'd under the
 * room-code key (which the server could derive), and large-file P2P transfers were
 * sent as PLAINTEXT JSON over the WebRTC data channel. Both now use the v2 room key,
 * which the server never holds.
 *
 * A per-transfer subkey (HKDF of the room key + random transferId) keeps IVs from
 * ever colliding across transfers, and metadata travels encrypted too.
 */

import { hkdf, LABELS, EMPTY_SALT } from './kdf';
import { importAesKey, aeadEncrypt, aeadDecrypt, randomBytes } from './encryption';
import { bytesToBase64, base64ToBytes, utf8ToBytes } from './wire';

const FILE_AAD = utf8ToBytes('kai/file/v2');

/**
 * Encrypt an arbitrary blob under the room key with a fresh random per-transfer
 * subkey. Returns a compact `transferId.iv.ct` base64 string.
 */
export const encryptRoomBlob = async (roomKeyBytes: Uint8Array, plaintext: Uint8Array): Promise<string> => {
  const transferId = randomBytes(16);
  const subKey = await importAesKey(hkdf(roomKeyBytes, EMPTY_SALT, LABELS.fileKey + ':' + bytesToBase64(transferId), 32));
  const { iv, ct } = await aeadEncrypt(subKey, plaintext, FILE_AAD);
  return `${bytesToBase64(transferId)}.${bytesToBase64(iv)}.${bytesToBase64(ct)}`;
};

export const decryptRoomBlob = async (roomKeyBytes: Uint8Array, blob: string): Promise<Uint8Array> => {
  const [transferId, iv, ct] = blob.split('.');
  const subKey = await importAesKey(hkdf(roomKeyBytes, EMPTY_SALT, LABELS.fileKey + ':' + transferId, 32));
  return aeadDecrypt(subKey, base64ToBytes(iv), base64ToBytes(ct), FILE_AAD);
};
