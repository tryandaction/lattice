import { describe, it, expect } from 'vitest';
import { validatePluginManifest } from '@/lib/plugins/manifest';

describe('validatePluginManifest', () => {
  it('accepts a minimal manifest', () => {
    const result = validatePluginManifest({
      id: 'demo.plugin',
      name: 'Demo',
      version: '1.0.0',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects missing fields', () => {
    const result = validatePluginManifest({ id: 'demo' });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid id format', () => {
    const result = validatePluginManifest({
      id: 'Bad Id',
      name: 'Demo',
      version: '1.0.0',
    });
    expect(result.valid).toBe(false);
  });
});

