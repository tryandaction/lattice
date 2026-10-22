import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceEditor } from '../appearance-editor';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { isAppearancePreviewActive } from '@/lib/appearance/runtime';
import { makeAIThemeTemplate } from '@/lib/appearance/exchange';
import { setLocale } from '@/lib/i18n';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => storage }));

describe('appearance editor workflows', () => {
  beforeEach(() => {
    setLocale('zh-CN');
    storage.set.mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState({settings:structuredClone(DEFAULT_SETTINGS), isInitialized:true, isLoading:false, error:null});
  });
  afterEach(() => setLocale('zh-CN'));
  it('follows the persisted active skin loaded after the editor mounts', async () => {
    useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS), isInitialized: false, isLoading: true });
    storage.get.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, activeThemeId: 'folio' } });
    render(<AppearanceEditor />);
    await act(() => useSettingsStore.getState().loadSettings());
    expect(document.documentElement.dataset.appearanceTheme).toBe('folio');
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(storage.set).toHaveBeenCalled());
    expect(useSettingsStore.getState().settings.appearance.activeThemeId).toBe('folio');
  });
  it('localizes the built-in skin summary in the selected UI language', () => {
    render(<AppearanceEditor />);
    expect(screen.getByRole('button', { name: /格致/ }).textContent).toContain('标准 · 系统字体');
    expect(screen.queryByText('standard · system')).toBeNull();
  });
  it('uses translated color names in the English theme editor', () => {
    act(() => setLocale('en-US'));
    render(<AppearanceEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Background')).toBeTruthy();
    expect(screen.getByText('Muted text')).toBeTruthy();
    expect(screen.queryByText('background')).toBeNull();
    expect(screen.queryByText('mutedForeground')).toBeNull();
  });
  it('uses the active language for a cloned built-in skin name', () => {
    act(() => setLocale('en-US'));
    render(<AppearanceEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Clone as custom' }));
    expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('Lattice Custom');
  });
  it('shows theme import validation errors in Chinese', () => {
    render(<AppearanceEditor />);
    fireEvent.change(screen.getByPlaceholderText('粘贴 ThemePackage JSON'), { target: { value: '{' } });
    fireEvent.click(screen.getByRole('button', { name: '导入文本' }));
    expect(screen.getByRole('alert').textContent).toContain('主题 JSON 格式错误');
    expect(screen.queryByText('Theme JSON is malformed')).toBeNull();
  });
  it('previews repeatedly, cancels without persistence, and restores when closed', async () => {
    const { unmount } = render(<AppearanceEditor />);
    fireEvent.click(screen.getByRole('button', {name:/书页/}));
    expect(document.documentElement.dataset.appearanceTheme).toBe('folio');
    fireEvent.click(screen.getByRole('button', {name:'取消预览'}));
    expect(document.documentElement.dataset.appearanceTheme).toBe('lattice');
    fireEvent.click(screen.getByRole('button', {name:/微风/}));
    expect(document.documentElement.dataset.appearanceTheme).toBe('breeze');
    unmount();
    expect(isAppearancePreviewActive()).toBe(false);
    expect(document.documentElement.dataset.appearanceTheme).toBe('lattice');
    expect(storage.set).not.toHaveBeenCalled();
  });
  it('edits names, saves, switches and deletes a custom theme', async () => {
    render(<AppearanceEditor />);
    fireEvent.click(screen.getByRole('button', {name:'克隆为自定义'}));
    fireEvent.change(screen.getByLabelText('自定义名称'), {target:{value:'我的阅读'}});
    expect((screen.getByLabelText('自定义名称') as HTMLInputElement).value).toBe('我的阅读');
    fireEvent.click(screen.getByRole('button', {name:'保存自定义'}));
    await waitFor(() => expect(useSettingsStore.getState().settings.appearance.customThemes[0]?.name).toBe('我的阅读'));
    await waitFor(() => expect(screen.queryByRole('button', {name:'保存自定义'})).toBeNull());
    fireEvent.click(screen.getByRole('button', {name:'删除自定义'}));
    await waitFor(() => expect(useSettingsStore.getState().settings.appearance.activeThemeId).toBe('lattice'));
  });
  it('imports a complete AI template for review without writing storage', () => {
    render(<AppearanceEditor />);
    fireEvent.change(screen.getByPlaceholderText('粘贴 ThemePackage JSON'), {target:{value:makeAIThemeTemplate()}});
    fireEvent.click(screen.getByRole('button', {name:'导入文本'}));
    expect(screen.getByLabelText('自定义名称')).toBeTruthy();
    expect(storage.set).not.toHaveBeenCalled();
  });
  it('keeps the last valid preview while an editable draft fails contrast validation', () => {
    render(<AppearanceEditor />);
    fireEvent.click(screen.getByRole('button', {name:'克隆为自定义'}));
    const colorInputs = Array.from(document.querySelectorAll('input[type="color"]')) as HTMLInputElement[];
    expect(colorInputs.length).toBeGreaterThan(1);
    const background = colorInputs[0];
    const foreground = colorInputs[1];
    fireEvent.change(background, { target: { value: '#ffffff' } });
    const validBackgroundToken = document.documentElement.style.getPropertyValue('--background');
    const validForegroundToken = document.documentElement.style.getPropertyValue('--foreground');
    fireEvent.change(foreground, { target: { value: '#ffffff' } });
    expect(screen.getByRole('alert').textContent).toContain('对比度不足');
    expect(document.documentElement.style.getPropertyValue('--background')).toBe(validBackgroundToken);
    expect(document.documentElement.style.getPropertyValue('--foreground')).toBe(validForegroundToken);
    expect(foreground.value).toBe('#ffffff');
    fireEvent.change(foreground, { target: { value: '#20242b' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--background')).toMatch(/^0 0% 100/);
    fireEvent.click(screen.getByRole('button', {name:'取消预览'}));
    expect(document.documentElement.dataset.appearanceTheme).toBe('lattice');
    expect(storage.set).not.toHaveBeenCalled();
  });
  it('shows save and clipboard failures without claiming success', async () => {
    storage.set.mockRejectedValueOnce(new Error('disk full'));
    render(<AppearanceEditor />);
    fireEvent.click(screen.getByRole('button', {name:'克隆为自定义'}));
    fireEvent.click(screen.getByRole('button', {name:'保存自定义'}));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('disk full'));
    expect(useSettingsStore.getState().settings.appearance.customThemes).toEqual([]);
    expect(useSettingsStore.getState().settings.appearance.activeThemeId).toBe('lattice');
    Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:vi.fn().mockRejectedValue(new Error('denied')) } });
    fireEvent.click(screen.getByRole('button', {name:'复制 AI 设计提示词'}));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('denied'));
    expect(screen.queryByText('已复制')).toBeNull();
  });
  it('cancel respects durable changes made by another settings writer', async () => {
    render(<AppearanceEditor />);
    fireEvent.click(screen.getByRole('button', {name:/书页/}));
    await act(() => useSettingsStore.getState().setAppearanceTheme('atelier'));
    fireEvent.click(screen.getByRole('button', {name:'取消预览'}));
    expect(document.documentElement.dataset.appearanceTheme).toBe('atelier');
  });
});
