function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function importSecretKey(encoded: string): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = decodeBase64(encoded); }
  catch { throw new Error('Invalid server encryption key'); }
  if (bytes.byteLength !== 32) throw new Error('Server encryption key must contain exactly 32 bytes');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptServerSecret(secret: string, encodedKey: string, recordIdentity: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(recordIdentity) }, await importSecretKey(encodedKey), new TextEncoder().encode(secret));
  return `v1.${encodeBase64(iv)}.${encodeBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptServerSecret(ciphertext: string, encodedKey: string, recordIdentity: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext, extra] = ciphertext.split('.');
  if (version !== 'v1' || !encodedIv || !encodedCiphertext || extra) throw new Error('Invalid encrypted secret');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(encodedIv), additionalData: new TextEncoder().encode(recordIdentity) }, await importSecretKey(encodedKey), decodeBase64(encodedCiphertext));
  return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
}
