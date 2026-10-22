import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeSelector } from '../theme-selector';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { setLocale } from '@/lib/i18n';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => storage }));
vi.mock('../appearance-editor', () => ({ AppearanceEditor: () => null }));

describe('theme mode save feedback', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: { ...structuredClone(DEFAULT_SETTINGS), theme: 'light' }, isInitialized: true, isLoading: false, error: null });
    setLocale('zh-CN');
    storage.set.mockReset().mockResolvedValue(undefined);
  });

  it('shows a save error and restores the last mode if storage rejects a change', async () => {
    storage.set.mockRejectedValue(new Error('Synthetic storage denied'));
    render(<ThemeSelector compact />);
    fireEvent.click(screen.getByRole('button', { name: '深色' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Synthetic storage denied'));
    expect(useSettingsStore.getState().settings.theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
