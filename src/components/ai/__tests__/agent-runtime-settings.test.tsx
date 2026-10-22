import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRuntimeSelector, AgentRuntimeSettings } from '../agent-runtime-settings';
import { useAiHarnessStore } from '@/stores/ai-harness-store';
import type { HarnessProbe } from '@/lib/ai/harness/types';
import { setLocale } from '@/lib/i18n';

const dialog = vi.hoisted(() => ({ open: vi.fn().mockResolvedValue(null) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: dialog.open }));

vi.mock('@/lib/storage-adapter', () => ({
  isTauriHost: () => true,
  getStorageAdapter: () => ({ get: async () => null, set: async () => {}, remove: async () => {} }),
}));

const readyProbe: HarnessProbe = { engine: 'codex', executable: 'C:/Apps/codex.exe', version: 'fixture', installed: true, supported: true, reason: 'Detailed protocol boundary', protocol: 'codex-app-server-jsonl', authStatus: 'ready', models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }], capabilities: { resume: true, interrupt: true, approvals: true, workspaceRead: true, scratchWrite: true } };
beforeEach(() => {
  setLocale('zh-CN');
  dialog.open.mockClear();
  useAiHarnessStore.setState({ config: { engine: 'api' }, configurations: {}, probes: { codex: readyProbe }, isHydrated: true, isLoading: false, discoveryComplete: true, isDiscovering: false, discoveryError: null, error: null });
});
describe('compact AI source and models', () => {
  it('uses English labels, source states and connection dialog text when English is selected', async () => {
    setLocale('en-US');
    useAiHarnessStore.setState({ config: { engine: 'codex', executable: 'C:/Apps/codex.exe' }, probes: { codex: { ...readyProbe, installed: false, supported: false, authStatus: 'login-required' } } });
    render(<AgentRuntimeSelector profiles={[{ id: 'api-profile', name: 'My API' }]} />);
    expect(screen.getByRole('combobox', { name: 'AI source' }).textContent).toContain('Not installed');
    expect(screen.getByRole('combobox', { name: 'AI model' }).textContent).toContain('Default model');
    fireEvent.click(screen.getByRole('button', { name: 'AI connection settings' }));
    const settings = screen.getByRole('dialog', { name: 'AI connection settings' });
    expect(settings.textContent).not.toMatch(/[\u4e00-\u9fff]/u);
    expect(screen.getByLabelText('Agent executable')).toBeTruthy();
    expect(screen.getByLabelText('Agent model')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh detection' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose installed application' }));
    await waitFor(() => expect(dialog.open).toHaveBeenCalledWith(expect.objectContaining({ title: 'Choose installed assistant', filters: [{ name: 'Assistant executable', extensions: ['exe'] }] })));
    fireEvent.click(screen.getByRole('button', { name: 'Close AI connection settings' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('localizes API defaults and empty model options while retaining profile and model product names', () => {
    setLocale('en-US');
    render(<AgentRuntimeSelector profiles={[{ id: 'api-profile', name: 'My API' }]} />);
    expect(screen.getByRole('combobox', { name: 'AI source' }).textContent).toContain('Default API');
    expect(screen.getByRole('combobox', { name: 'AI source' }).textContent).toContain('My API');
    expect(screen.getByRole('combobox', { name: 'AI model' }).textContent).toContain('No model configured');
  });

  it('localizes loading and advanced settings when no local probe is available', () => {
    setLocale('en-US');
    useAiHarnessStore.setState({ config: { engine: 'claude' }, probes: {}, isDiscovering: true });
    render(<><AgentRuntimeSelector /><AgentRuntimeSettings /></>);
    expect(screen.getByLabelText('Detecting local assistants')).toBeTruthy();
    expect(screen.getByText('Advanced connection and diagnostics')).toBeTruthy();
    expect(screen.getByText(/Claude Code · Not detected yet/)).toBeTruthy();
    expect(screen.getByLabelText('Agent executable').getAttribute('placeholder')).toBe('Discover automatically');
  });

  it('offers API profiles and local assistants in one source selector without exposing technical settings', () => {
    render(<AgentRuntimeSelector profiles={[{ id: 'api-profile', name: 'My API' }]} activeProfileId="api-profile" modelOptions={[{ id: 'api-model', name: 'API model' }]} activeModelId="api-model" onProfileChange={() => {}} onModelChange={() => {}} />);
    expect(screen.getByLabelText('AI 来源').querySelectorAll('option').length).toBeGreaterThan(2);
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.queryByLabelText('Agent 可执行文件')).toBeNull();
    expect(screen.queryByText('运行环境')).toBeNull();
    expect(screen.queryByText('Detailed protocol boundary')).toBeNull();
    expect(screen.getByLabelText('AI 模型').querySelector('option[value=""]')).toBeNull();
  });
  it('shows actual local model options and saves a selection without exposing a model-ID input', async () => {
    useAiHarnessStore.getState().selectEngine('codex');
    render(<AgentRuntimeSelector />);
    fireEvent.change(screen.getByLabelText('AI 模型'), { target: { value: 'model-b' } });
    expect(useAiHarnessStore.getState().config.model).toBe('model-b');
    expect(screen.queryByTestId('ai-harness-model-input')).toBeNull();
    expect(screen.getByLabelText('AI 模型').textContent).toContain('Model A');
    await act(async () => { await useAiHarnessStore.getState().flush(); });
  });
  it('opens advanced connection settings as a dismissible dialog without resizing the composer', async () => {
    useAiHarnessStore.getState().selectEngine('codex');
    render(<AgentRuntimeSelector />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 连接设置' }));
    expect(screen.getByRole('dialog', { name: 'AI 连接设置' })).toBeTruthy();
    expect(screen.getByLabelText('Agent 可执行文件')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('keeps an unavailable source selected and offers an explicit API switch without sending the draft', async () => {
    useAiHarnessStore.setState({ config: { engine: 'codex', model: 'chosen' }, probes: { codex: { ...readyProbe, supported: false, installed: false, reason: 'not installed' } } });
    render(<AgentRuntimeSelector profiles={[{ id: 'api-profile', name: 'My API' }]} />);
    expect(useAiHarnessStore.getState().config.engine).toBe('codex');
    fireEvent.click(screen.getByRole('button', { name: '切换到 API' }));
    expect(useAiHarnessStore.getState().config.engine).toBe('api');
    await act(async () => { await useAiHarnessStore.getState().flush(); });
  });
});
