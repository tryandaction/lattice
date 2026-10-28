"use client";

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { TeamAiLibraryConfig, TeamAiProviderConfig, TeamAiSaveConfig } from '@/lib/shared-library/cloud-team-ai';

export interface CloudTeamAiSettingsProps {
  loadConfig: (signal?: AbortSignal) => Promise<TeamAiLibraryConfig>;
  saveConfig: (input: TeamAiSaveConfig, signal?: AbortSignal) => Promise<TeamAiLibraryConfig | void>;
  deleteProvider?: (id: string, signal?: AbortSignal) => Promise<void>;
  onSaved: () => void;
}
const field = 'min-w-0 w-full rounded border border-border bg-background px-2 py-1.5 text-xs';
type Draft = Omit<TeamAiProviderConfig, 'models' | 'apiKeyConfigured'> & { models: string; apiKey: string; existing: boolean };
const newDraft = (): Draft => ({ id: 'team-' + crypto.randomUUID(), label: '', baseUrl: 'https://api.openai.com/v1', models: '', apiKey: '', maxOutputTokens: 2048, requestBudgetUsdMicros: 10000, existing: false });

export function CloudTeamAiSettings({ loadConfig, saveConfig, deleteProvider, onSaved }: CloudTeamAiSettingsProps) {
  const [config, setConfig] = useState<TeamAiLibraryConfig>();
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string>();
  const [reload, setReload] = useState(0);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadConfig(controller.signal).then(value => { if (!controller.signal.aborted) { setConfig(value); setError(''); } }).catch(() => { if (!controller.signal.aborted) setError('团队模型设置暂时无法读取，请重试。'); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, [loadConfig, reload]);

  async function save() {
    if (!config || !draft || busy) return;
    const models = [...new Set(draft.models.split(/[,，]/).map(value => value.trim()).filter(Boolean))];
    if (!draft.label.trim() || !models.length || (!draft.existing && !draft.apiKey.trim())) { setError('请填写名称、模型 ID 和新模型所需的 API Key。'); return; }
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError(''); setNotice('');
    try {
      const result = await saveConfig({ enabled: config.enabled, maxRequestsPerDay: config.maxRequestsPerDay, monthlyBudgetUsdMicros: config.monthlyBudgetUsdMicros, maxOutputTokens: config.maxOutputTokens, provider: { id: draft.id, label: draft.label.trim(), baseUrl: draft.baseUrl.trim(), models, maxOutputTokens: Math.min(draft.maxOutputTokens, config.maxOutputTokens), requestBudgetUsdMicros: draft.requestBudgetUsdMicros, ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}) } }, controller.signal);
      if (controller.signal.aborted) return;
      setDraft(undefined); if (result) setConfig(result); else setReload(value => value + 1);
      setNotice('团队模型已保存。密钥不会回显；发送一次问题可验证实际模型连接。'); onSaved();
    } catch { if (!controller.signal.aborted) setError('团队模型未能保存。请检查地址、模型和权限；更换地址时需重新填写 API Key。'); }
    finally { if (pending.current === controller) { pending.current = null; if (!controller.signal.aborted) setBusy(false); } }
  }
  async function remove(id: string) {
    if (!deleteProvider || busy) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError('');
    try {
      await deleteProvider(id, controller.signal);
      if (controller.signal.aborted) return;
      setDeleting(undefined); setDraft(undefined); setNotice('团队模型已移除。'); setReload(value => value + 1); onSaved();
    } catch { if (!controller.signal.aborted) setError('团队模型未能移除，请重试。'); }
    finally { if (pending.current === controller) { pending.current = null; if (!controller.signal.aborted) setBusy(false); } }
  }
  return <section aria-label="团队模型设置" className="space-y-3 rounded border border-border p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">团队模型设置</h3><Button size="sm" variant="outline" disabled={busy || !config} onClick={() => { setDraft(newDraft()); setDeleting(undefined); setError(''); setNotice(''); }}>添加团队模型</Button></div>
    <p className="text-muted-foreground">由本库管理员配置。团队 Key 加密保存在云端，仅用于本库授权成员；不会写入共享文件、邀请或安装包。个人模型请在「设置 → AI 提供商」中配置。</p>
    {config?.providers.map(provider => <div key={provider.id} className="flex flex-wrap items-center gap-2 rounded border border-border p-2"><span className="min-w-0 flex-1 break-all">{provider.label} · {provider.models.join(', ')} · 密钥已配置</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDraft({ ...provider, models: provider.models.join(', '), apiKey: '', existing: true }); setDeleting(undefined); }}>编辑 {provider.label}</Button>{deleteProvider ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleting(provider.id)}>移除 {provider.label}</Button> : null}</div>)}
    {deleting ? <div role="alertdialog" aria-label="确认移除团队模型" className="flex flex-wrap gap-2"><p className="w-full">移除后成员将无法继续调用此模型，已产生的用量记录保留。</p><Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove(deleting)}>确认移除模型</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleting(undefined)}>取消</Button></div> : null}
    {draft && config ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="grid gap-1">模型名称<input className={field} value={draft.label} maxLength={120} required disabled={busy} onChange={event => setDraft({ ...draft, label: event.target.value })} /></label>
      <label className="grid gap-1">兼容 API 地址<input className={field} type="url" value={draft.baseUrl} required disabled={busy} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
      <p className="text-muted-foreground sm:col-span-2">支持 OpenAI Chat Completions 兼容接口。常用官方服务可直接配置；自定义网关需由平台批准其域名后使用。</p>
      <label className="grid gap-1">模型 ID<input className={field} value={draft.models} required disabled={busy} placeholder="多个模型用逗号分隔" onChange={event => setDraft({ ...draft, models: event.target.value })} /></label>
      <label className="grid gap-1">团队 API Key<input className={field} type="password" autoComplete="off" value={draft.apiKey} required={!draft.existing} maxLength={4096} disabled={busy} placeholder={draft.existing ? '留空保留原密钥；更换地址需新密钥' : '仅用于此团队库'} onChange={event => setDraft({ ...draft, apiKey: event.target.value })} /></label>
      <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={config.enabled} disabled={busy} onChange={event => setConfig({ ...config, enabled: event.target.checked })} />启用本库团队 AI</label>
      <details className="sm:col-span-2"><summary className="cursor-pointer">用量上限与费用预留</summary><div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1">每日请求上限<input className={field} type="number" min={0} max={100000} value={config.maxRequestsPerDay} disabled={busy} onChange={event => setConfig({ ...config, maxRequestsPerDay: Number(event.target.value) })} /></label>
        <label className="grid gap-1">每次输出 Token 上限<input className={field} type="number" min={1} max={8192} value={config.maxOutputTokens} disabled={busy} onChange={event => { const value = Number(event.target.value); setConfig({ ...config, maxOutputTokens: value }); setDraft({ ...draft, maxOutputTokens: value }); }} /></label>
        <label className="grid gap-1">每月额度（美元）<input className={field} type="number" min={0} max={1000000} step={0.000001} value={config.monthlyBudgetUsdMicros / 1000000} disabled={busy} onChange={event => setConfig({ ...config, monthlyBudgetUsdMicros: Math.round(Number(event.target.value) * 1000000) })} /></label>
        <label className="grid gap-1">每次请求预留（美元）<input className={field} type="number" min={0.000001} max={1000} step={0.000001} value={draft.requestBudgetUsdMicros / 1000000} disabled={busy} onChange={event => setDraft({ ...draft, requestBudgetUsdMicros: Math.round(Number(event.target.value) * 1000000) })} /></label>
      </div><p className="mt-2 text-muted-foreground">这是请求额度预留，不是供应商实际账单。请按供应商价格设置足够的单次预留，并在供应商侧设置消费上限；失败请求可能仍计费。</p></details>
      <div className="flex flex-wrap gap-2 sm:col-span-2"><Button size="sm" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存团队模型'}</Button><Button size="sm" type="button" variant="ghost" disabled={busy} onClick={() => setDraft(undefined)}>取消配置</Button></div>
    </form> : null}
    {notice ? <p role="status">{notice}</p> : null}{error ? <div><p role="alert" className="text-destructive">{error}</p>{!config ? <Button size="sm" variant="ghost" onClick={() => setReload(value => value + 1)}>重试读取设置</Button> : null}</div> : null}
  </section>;
}
