export interface EncryptedMessage {
  ciphertext: string;
  iv: string;
}

export const deriveKey = async (roomCode: string): Promise<CryptoKey> => {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(roomCode),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('rooms-chat-salt-2024'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

export const encryptMessage = async (
  message: string,
  key: CryptoKey
): Promise<EncryptedMessage> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    data
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv.buffer),
  };
};

export const decryptMessage = async (
  encryptedMessage: EncryptedMessage,
  key: CryptoKey
): Promise<string> => {
  const ciphertext = base64ToArrayBuffer(encryptedMessage.ciphertext);
  const iv = base64ToArrayBuffer(encryptedMessage.iv);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

// Voice E2E Encryption using AES-GCM
// Frame structure: [4 bytes IV prefix][encrypted payload]
const VOICE_IV_LENGTH = 12;
const VOICE_TAG_LENGTH = 16;

export const deriveVoiceKey = async (roomCode: string): Promise<CryptoKey> => {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(roomCode + '-voice'),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('rooms-voice-e2e-salt-2024'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 128 },
    true,
    ['encrypt', 'decrypt']
  );
};

// Export raw key bytes for Web Workers
export const exportKeyBytes = async (key: CryptoKey): Promise<ArrayBuffer> => {
  return crypto.subtle.exportKey('raw', key);
};

// Import key from raw bytes
export const importVoiceKey = async (keyBytes: ArrayBuffer): Promise<CryptoKey> => {
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt', 'decrypt']
  );
};

// Frame counter for unique IVs (per-sender)
let frameCounter = 0;

export const encryptAudioFrame = async (
  frame: ArrayBuffer,
  key: CryptoKey
): Promise<ArrayBuffer> => {
  // Generate IV: 4 bytes counter + 8 bytes random
  const iv = new Uint8Array(VOICE_IV_LENGTH);
  const counterBytes = new DataView(new ArrayBuffer(4));
  counterBytes.setUint32(0, frameCounter++, true);
  iv.set(new Uint8Array(counterBytes.buffer), 0);
  crypto.getRandomValues(iv.subarray(4));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: VOICE_TAG_LENGTH * 8 },
    key,
    frame
  );

  // Prepend IV to encrypted data
  const result = new Uint8Array(VOICE_IV_LENGTH + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), VOICE_IV_LENGTH);

  return result.buffer;
};

export const decryptAudioFrame = async (
  encryptedFrame: ArrayBuffer,
  key: CryptoKey
): Promise<ArrayBuffer> => {
  const data = new Uint8Array(encryptedFrame);
  
  if (data.length < VOICE_IV_LENGTH + VOICE_TAG_LENGTH) {
    throw new Error('Frame too short');
  }

  const iv = data.slice(0, VOICE_IV_LENGTH);
  const ciphertext = data.slice(VOICE_IV_LENGTH);

  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: VOICE_TAG_LENGTH * 8 },
    key,
    ciphertext
  );
};
