import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageSelector } from '../language-selector';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { getLocale, setLocale } from '@/lib/i18n';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => storage }));

describe('language selector persistence', () => {
  beforeEach(() => {
    storage.get.mockReset().mockResolvedValue({ ...DEFAULT_SETTINGS, language: 'zh-CN' });
    storage.set.mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS), isInitialized: false, isLoading: true, error: null });
    setLocale('zh-CN');
  });

  it('switches all mounted selectors and restores the persisted language after hydration', async () => {
    let saved = { ...structuredClone(DEFAULT_SETTINGS), language: 'zh-CN' as const } as typeof DEFAULT_SETTINGS;
    storage.get.mockImplementation(async () => structuredClone(saved));
    storage.set.mockImplementation(async (_key, value) => { saved = structuredClone(value); });
    await useSettingsStore.getState().loadSettings();
    const mounted = render(<LanguageSelector />);
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    await waitFor(() => expect(saved.language).toBe('en-US'));
    expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.lang).toBe('en-US');
    mounted.unmount();
    useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS), isInitialized: false });
    setLocale('zh-CN');
    render(<LanguageSelector />);
    await act(() => useSettingsStore.getState().loadSettings());
    expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Language')).toBeTruthy();
  });

  it('rolls back the visible locale and reports a failed save', async () => {
    await useSettingsStore.getState().loadSettings();
    storage.set.mockRejectedValue(new Error('Synthetic disk full'));
    render(<LanguageSelector compact />);
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Synthetic disk full'));
    expect(useSettingsStore.getState().settings.language).toBe('zh-CN');
    expect(getLocale()).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(screen.getByRole('button', { name: '简体中文' }).getAttribute('aria-pressed')).toBe('true');
  });
});
