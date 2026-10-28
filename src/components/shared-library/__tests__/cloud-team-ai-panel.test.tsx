import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudTeamAiPanel } from '../cloud-team-ai-panel';
import type { TeamAiRequest, TeamAiLibraryConfig, TeamAiSaveConfig } from '@/lib/shared-library/cloud-team-ai';

afterEach(cleanup);
const providers = [{ id: 'team', label: '研究组模型', models: ['research'], maxOutputTokens: 4096 }];
describe('team cloud AI', () => {
  it('lets a library admin configure a team model without echoing its key into the panel', async () => {
    const saveConfig = vi.fn(async () => undefined);
    render(<CloudTeamAiPanel
      canManage
      loadProviders={async () => ({ enabled: false, providers: [] })}
      loadConfig={async () => ({ enabled: false, maxRequestsPerDay: 100, monthlyBudgetUsdMicros: 1000000, maxOutputTokens: 2048, providers: [] })}
      saveConfig={saveConfig}
      send={vi.fn()}
    />);
    await screen.findByRole('button', { name: '添加团队模型' });
    fireEvent.click(screen.getByRole('button', { name: '添加团队模型' }));
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'Team Research' } });
    fireEvent.change(screen.getByLabelText('兼容 API 地址'), { target: { value: 'https://gateway.example.com/v1' } });
    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: 'research-v2' } });
    fireEvent.change(screen.getByLabelText('团队 API Key'), { target: { value: 'TEAM_KEY_DO_NOT_ECHO' } });
    fireEvent.click(screen.getByRole('button', { name: '保存团队模型' }));
    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      provider: expect.objectContaining({ label: 'Team Research', baseUrl: 'https://gateway.example.com/v1', models: ['research-v2'], apiKey: 'TEAM_KEY_DO_NOT_ECHO' }),
    }), expect.any(AbortSignal)));
    expect(document.body.textContent).not.toContain('TEAM_KEY_DO_NOT_ECHO');
    await screen.findByText(/团队模型已保存/);
    expect(screen.queryByLabelText('团队 API Key')).toBeNull();
  });

  it('edits settings without exposing or replacing a saved key and refreshes member-visible models', async () => {
    const config: TeamAiLibraryConfig = { enabled: false, maxRequestsPerDay: 100, monthlyBudgetUsdMicros: 1000000, maxOutputTokens: 2048, providers: [{ id: 'own', label: 'Own model', baseUrl: 'https://api.openai.com/v1', models: ['before'], maxOutputTokens: 1024, requestBudgetUsdMicros: 10000, apiKeyConfigured: true }] };
    let saved: TeamAiSaveConfig | undefined;
    const loadProviders = async () => ({ enabled: Boolean(saved?.enabled), providers: saved ? [{ ...saved.provider }] : [] });
    render(<CloudTeamAiPanel canManage loadProviders={loadProviders} loadConfig={async () => config} saveConfig={async input => { saved = input; return { ...config, enabled: input.enabled, providers: [{ ...input.provider, apiKeyConfigured: true }] }; }} send={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑 Own model' }));
    const key = screen.getByLabelText('团队 API Key') as HTMLInputElement;
    expect(key.value).toBe(''); expect(key.type).toBe('password');
    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: 'new-one, new-two' } });
    fireEvent.click(screen.getByLabelText('启用本库团队 AI'));
    fireEvent.click(screen.getByRole('button', { name: '保存团队模型' }));
    await screen.findByRole('option', { name: 'Own model · new-two' });
    expect(saved?.provider).not.toHaveProperty('apiKey');
    expect(saved?.provider.models).toEqual(['new-one', 'new-two']);
    expect(screen.queryByLabelText('团队 API Key')).toBeNull();
  });

  it('requires confirmation before removing a team model and removes it from the catalogue', async () => {
    let deleted = false;
    const own = { id: 'own', label: 'Own model', baseUrl: 'https://api.openai.com/v1', models: ['m'], maxOutputTokens: 1024, requestBudgetUsdMicros: 10000, apiKeyConfigured: true };
    const loadConfig = async () => ({ enabled: !deleted, maxRequestsPerDay: 100, monthlyBudgetUsdMicros: 1000000, maxOutputTokens: 2048, providers: deleted ? [] : [own] });
    const loadProviders = async () => ({ enabled: !deleted, providers: deleted ? [] : [own] });
    render(<CloudTeamAiPanel canManage loadProviders={loadProviders} loadConfig={loadConfig} saveConfig={async () => undefined} deleteProvider={async id => { expect(id).toBe('own'); deleted = true; }} send={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '移除 Own model' }));
    expect(screen.getByRole('alertdialog', { name: '确认移除团队模型' })).toBeTruthy(); expect(deleted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '确认移除模型' }));
    await screen.findByText('团队模型已移除。');
    await waitFor(() => expect(screen.queryByRole('button', { name: '移除 Own model' })).toBeNull());
    expect(screen.queryByRole('option', { name: 'Own model · m' })).toBeNull();
  });

  it('does not expose provider management controls to regular library members', async () => {
    render(<CloudTeamAiPanel loadProviders={async () => ({ enabled: true, providers })} send={vi.fn()} />);
    await screen.findByRole('option', { name: '研究组模型 · research' });
    expect(screen.queryByRole('button', { name: '添加团队模型' })).toBeNull();
    expect(screen.queryByLabelText('团队 API Key')).toBeNull();
  });

  it('shows missing server setup without inventing usable models', async () => {
    render(<CloudTeamAiPanel loadProviders={async () => ({ enabled: false, providers: [] })} send={vi.fn()} />);
    await screen.findByText(/管理员尚未配置团队 AI/);
    expect((screen.getByRole('button', { name: '发送给团队 AI' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('sends only after submission and includes selected source explicitly', async () => {
    const send = vi.fn(async (_input: TeamAiRequest) => ({ content: '研究结论', model: 'research' }));
    render(<CloudTeamAiPanel loadProviders={async () => ({ enabled: true, providers })} send={send} source={{ name: 'paper.md', text: 'Research source', versionId: 'version-1' }} />);
    await screen.findByRole('option', { name: '研究组模型 · research' });
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('团队 AI 问题'), { target: { value: '总结这篇文章' } });
    fireEvent.click(screen.getByRole('button', { name: '发送给团队 AI' }));
    await screen.findByText('研究结论');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ providerId: 'team', model: 'research', messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: expect.stringContaining('Research source') })]) });
  });
  it('does not include source after opting out', async () => {
    const send = vi.fn(async (_input: TeamAiRequest) => ({ content: 'answer', model: 'research' }));
    render(<CloudTeamAiPanel loadProviders={async () => ({ enabled: true, providers })} send={send} source={{ name: 'paper.md', text: 'SECRET_SOURCE' }} />);
    await screen.findByRole('option', { name: '研究组模型 · research' });
    fireEvent.click(screen.getByLabelText('附上 paper.md'));
    fireEvent.change(screen.getByLabelText('团队 AI 问题'), { target: { value: '只问这个问题' } });
    fireEvent.click(screen.getByRole('button', { name: '发送给团队 AI' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(send.mock.calls[0][0])).not.toContain('SECRET_SOURCE');
  });
  it('aborts an in-flight request on unmount', async () => {
    let signal: AbortSignal | undefined;
    const send = vi.fn((_input, nextSignal: AbortSignal) => { signal = nextSignal; return new Promise<{content:string;model:string}>(() => {}); });
    const result = render(<CloudTeamAiPanel loadProviders={async () => ({ enabled: true, providers })} send={send} />);
    await screen.findByRole('option', { name: '研究组模型 · research' });
    fireEvent.change(screen.getByLabelText('团队 AI 问题'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: '发送给团队 AI' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    result.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
