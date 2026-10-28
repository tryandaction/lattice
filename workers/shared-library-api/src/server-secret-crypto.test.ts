import { describe, expect, it } from 'vitest';
import { decryptServerSecret, encryptServerSecret } from './server-secret-crypto';

describe('server-encrypted secrets', () => {
  const key = Buffer.alloc(32, 19).toString('base64');

  it('encrypts with a fresh nonce and binds ciphertext to its record identity', async () => {
    const first = await encryptServerSecret('provider-key', key, 'library-1:provider-1');
    const second = await encryptServerSecret('provider-key', key, 'library-1:provider-1');
    expect(first).not.toBe(second);
    expect(first).not.toContain('provider-key');
    expect(await decryptServerSecret(first, key, 'library-1:provider-1')).toBe('provider-key');
    await expect(decryptServerSecret(first, key, 'library-2:provider-1')).rejects.toThrow();
  });

  it('rejects malformed ciphertext and a key that is not exactly 32 bytes', async () => {
    await expect(decryptServerSecret('raw-provider-key', key, 'library-1:provider-1')).rejects.toThrow();
    await expect(encryptServerSecret('provider-key', Buffer.alloc(31).toString('base64'), 'record')).rejects.toThrow();
  });
});
