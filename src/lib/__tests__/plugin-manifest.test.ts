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

  it('rejects unknown permissions and warns about duplicate permissions', () => {
    const result = validatePluginManifest({
      id: 'demo.plugin',
      name: 'Demo',
      version: '1.0.0',
      permissions: ['file:read', 'file:read', 'system:all'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unknown permissions: system:all');
    expect(result.warnings).toContain('Duplicate permissions were removed: file:read');
  });

  it('rejects unsafe main entry paths', () => {
    const result = validatePluginManifest({
      id: 'demo.plugin',
      name: 'Demo',
      version: '1.0.0',
      main: '../main.js',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Main entry must be a relative .js file path inside the plugin package');
  });

  it('rejects duplicate command and panel contribution ids', () => {
    const result = validatePluginManifest({
      id: 'demo.plugin',
      name: 'Demo',
      version: '1.0.0',
      contributes: {
        commands: [
          { id: 'demo.run', title: 'Run' },
          { id: 'demo.run', title: 'Run again' },
        ],
        panels: [
          { id: 'demo.panel', title: 'Panel', schema: { type: 'custom' } },
          { id: 'demo.panel', title: 'Panel duplicate', schema: { type: 'custom' } },
        ],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Duplicate command id: demo.run');
    expect(result.errors).toContain('Duplicate panel id: demo.panel');
  });
});
