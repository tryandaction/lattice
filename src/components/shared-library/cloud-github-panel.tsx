"use client";

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { GitHubIntegrationClient, type GitHubConnection, type GitHubIdentityStatus, type GitHubRepository, type GitHubTreeEntry } from '@/lib/shared-library/github';
import { githubItemLink, importGitHubFile, pullGitHubItem, publishGitHubItem } from '@/lib/shared-library/github-workspace';
import { GITHUB_OAUTH_ATTEMPT_KEY, GITHUB_OAUTH_RETURN_KEY, githubOAuthAttempt } from '@/lib/shared-library/github-oauth-return';
import type { CloudLibraryWorkspaceController } from '@/lib/shared-library/cloud-workspace';
import type { Item, LibraryRole } from '@/lib/shared-library/domain';
import type { CloudFileTabState, LayoutNode } from '@/types/layout';
import { can } from '@/lib/shared-library/permissions';
import { cloudDocumentHasDrafts, refreshCloudDocumentViews } from '@/lib/shared-library/cloud-document-actions';
import { cloudScope } from '@/lib/shared-library/connection';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { isTauriHost } from '@/lib/storage-adapter';
import type { GitHubAuthorization } from '@/lib/shared-library/github';
import { GITHUB_OAUTH_STARTED_EVENT } from '@/lib/shared-library/github-oauth-return';

function copies(controller: CloudLibraryWorkspaceController, libraryId: string, itemId: string) {
  const matches: CloudFileTabState[] = [];
  const visit = (node: LayoutNode) => { if (node.type === 'split') node.children.forEach(visit); else for (const tab of node.tabs) if (tab.kind === 'cloud-file' && tab.cloud.scope === cloudScope(controller.connection, controller.userId) && tab.cloud.libraryId === libraryId && tab.cloud.itemId === itemId) matches.push(tab); };
  visit(useWorkspaceStore.getState().layout.root); return matches;
}
export function CloudGitHubPanel({ controller, libraryId, role, onCreateLibrary, onLibraryConnected }: { controller: CloudLibraryWorkspaceController; libraryId?: string; role?: LibraryRole; onCreateLibrary?: (repository: GitHubRepository) => Promise<string>; onLibraryConnected?: (libraryId: string) => void | Promise<void> }) {
  const client = useMemo(() => new GitHubIntegrationClient(controller.transport), [controller]);
  const [status, setStatus] = useState<GitHubIdentityStatus>();
  const [connection, setConnection] = useState<GitHubConnection | null>(null);
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [repository, setRepository] = useState('');
  const [files, setFiles] = useState<GitHubTreeEntry[]>([]);
  const [file, setFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmPublish, setConfirmPublish] = useState<Item | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [revision, setRevision] = useState(0);
  const admin = libraryId ? !!role && can(role, 'member.manage') : !!onCreateLibrary, editor = !!role && can(role, 'item.update');
  useEffect(() => {
    let active = true;
    void client.status().then(async next => {
      if (!active) return; setStatus(next);
      if (next.connected && !next.requiresReauth && libraryId) { const current = await client.connection(libraryId); if (active) setConnection(current); }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [client, libraryId]);
  async function run(task: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); setMessage(''); try { await task(); setRevision(value => value + 1); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } }
  function clean(itemId: string) { if (libraryId && copies(controller, libraryId, itemId).some(cloudDocumentHasDrafts)) throw new Error('该文件有未保存草稿，请先保存再操作 GitHub。'); }
  function refreshed(itemId: string) { if (libraryId) for (const tab of copies(controller, libraryId, itemId)) refreshCloudDocumentViews(tab); }
  const linked = connection && libraryId ? controller.getSnapshot().items.filter(item => item.libraryId === libraryId && item.status === 'active' && githubItemLink(item)?.repositoryId === connection.repositoryId) : [];
  void revision;
  return <section aria-label="GitHub 仓库" className="space-y-3 p-3 text-xs">
    <p className="text-muted-foreground">仅访问你授权的仓库，包括私有仓库。拉取和发布操作均由你确认。</p>
    {status && !status.configured ? <p role="status">GitHub 连接服务暂不可用，请稍后重试。</p> : null}
    {status?.installationUrl ? <a href={status.installationUrl} target="_blank" rel="noreferrer" className="inline-flex items-center underline underline-offset-4">安装或管理授权仓库</a> : null}
    {status?.configured && (!status.connected || status.requiresReauth) ? <Button size="sm" disabled={busy} onClick={() => void run(async () => {
      const desktop = isTauriHost();
      const returnTo = desktop ? undefined : new URL(window.location.href).toString();
      const result: GitHubAuthorization = await client.authorize({ ...(returnTo ? { returnTo } : {}), ...(desktop ? { desktop: true } : {}), connectionId: controller.connection.id, ...(libraryId ? { libraryId } : {}) });
      const attempt = githubOAuthAttempt(result.authorizationUrl, { connectionId: controller.connection.id, userId: controller.userId, libraryId: libraryId ?? '', redirectUri: result.redirectUri, expiresAt: result.expiresAt, flow: result.flow, returnTo: result.returnTo });
      sessionStorage.removeItem(GITHUB_OAUTH_RETURN_KEY); sessionStorage.setItem(GITHUB_OAUTH_ATTEMPT_KEY, JSON.stringify(attempt)); window.dispatchEvent(new Event(GITHUB_OAUTH_STARTED_EVENT));
      if (desktop) { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(result.authorizationUrl); }
      else window.location.assign(result.authorizationUrl);
    })}>{status.requiresReauth ? '重新授权 GitHub' : '连接 GitHub'}</Button> : null}
    {status?.connected ? <p>已连接 GitHub：<strong>{status.login}</strong> <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDisconnect(true)}>解除 GitHub 授权</Button></p> : null}
    {connection ? <div className="space-y-2 rounded border border-border p-2">
      <p><strong>{connection.fullName}</strong> · {connection.private ? '私有仓库' : '公开仓库'} · {connection.branch}</p>
      <p className="text-muted-foreground">{connection.lastSyncedAt ? `成员同步于 ${new Date(connection.lastSyncedAt).toLocaleString()}` : '尚未完成成员同步'}{connection.stale ? ' · 状态需刷新' : ''}</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { const id = libraryId; if (!id) return; const result = await client.tree(id); setFiles(result.entries); setFile(result.entries[0]?.path ?? ''); })}>浏览仓库文件</Button>{admin ? <><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { const id = libraryId; if (!id) return; const result = await client.sync(id); await controller.refreshLibrary(id); setConnection(await client.connection(id)); setMessage(`成员同步完成：新增 ${result.granted}，撤销 ${result.revoked}，待绑定 ${result.unbound}。`); })}>刷新协作者</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDisconnect(true)}>断开仓库连接</Button></> : null}</div>
      {confirmDisconnect && libraryId ? <div className="space-y-2"><p>断开仓库连接会停止协作者同步；库文件、版本和手工成员保留。</p><Button size="sm" variant="destructive" disabled={busy} onClick={() => void run(async () => { const id = libraryId; if (!id) return; await client.disconnect(id); setConnection(null); setFiles([]); setConfirmDisconnect(false); await controller.refreshLibrary(id); })}>确认断开仓库</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(false)}>取消</Button></div> : null}
    </div> : status?.connected && admin ? <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { const values = await client.repositories(); setRepositories(values.filter(value => value.permissions.push || value.permissions.maintain || value.permissions.admin)); setRepository(values.find(value => value.permissions.push || value.permissions.maintain || value.permissions.admin)?.id.toString() ?? ''); })}>选择授权仓库</Button>
      {repositories.length ? <><select aria-label="GitHub 授权仓库" className="min-w-0 rounded border border-border bg-background p-1" value={repository} disabled={busy} onChange={event => setRepository(event.target.value)}>{repositories.map(value => <option key={`${value.installationId}:${value.id}`} value={value.id}>{value.fullName}{value.private ? ' · 私有' : ''}</option>)}</select><Button size="sm" disabled={busy || !repository} onClick={() => void run(async () => { const selected = repositories.find(value => String(value.id) === repository); if (!selected) return; const targetLibraryId = libraryId || await onCreateLibrary?.(selected); if (!targetLibraryId) return; setConnection(await client.connect(targetLibraryId, { repositoryId: selected.id, installationId: selected.installationId })); await controller.refreshLibrary(targetLibraryId); if (!libraryId) await onLibraryConnected?.(targetLibraryId); setMessage(libraryId ? '仓库已关联。' : '仓库已关联到新云库。'); })}>{libraryId ? '关联当前云库' : '创建云库并关联'}</Button></> : null}
      {!repositories.length && repository !== '' ? null : !repositories.length ? <p className="basis-full text-muted-foreground">还没有可关联的授权仓库。安装 GitHub App 后，可在 GitHub 选择允许访问的仓库，再返回此处刷新列表。</p> : null}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { const values = await client.repositories(); const writable = values.filter(value => value.permissions.push || value.permissions.maintain || value.permissions.admin); setRepositories(writable); setRepository(writable.find(value => value.permissions.push || value.permissions.maintain || value.permissions.admin)?.id.toString() ?? ''); })}>刷新授权仓库</Button>
    </div> : null}
    {files.length ? <div className="space-y-2"><select aria-label="GitHub 仓库文件" value={file} disabled={busy} onChange={event => setFile(event.target.value)} className="w-full rounded border border-border bg-background p-1">{files.map(value => <option key={value.path} value={value.path}>{value.path}</option>)}</select>{editor ? <Button size="sm" disabled={busy || !connection || !file} onClick={() => void run(async () => {
      const id = libraryId; if (!connection || !id) return; for (const item of linked) if (githubItemLink(item)?.path === file) clean(item.id);
      const result = await importGitHubFile(controller, id, connection, file); refreshed(result.item.id); setMessage(result.synced ? '文件已导入云库并同步。' : '文件已保存到本机，云库同步尚待完成。');
    })}>导入所选文件</Button> : null}<p className="text-muted-foreground">当前支持普通文件（每个最多 1 MB），保留目录结构和来源 SHA。子模块、LFS 实体和大文件请通过云库上传流程导入。</p></div> : null}
    {linked.length ? <div className="space-y-2"><h3 className="font-medium">已关联文件</h3>{linked.map(item => <div key={item.id} className="flex flex-wrap items-center gap-2 rounded border border-border p-2"><span className="min-w-0 flex-1 break-all">{githubItemLink(item)?.path}</span>{editor ? <><Button size="sm" variant="outline" disabled={busy || !item.currentVersionId} onClick={() => void run(async () => { const id = libraryId; if (!id || !item.currentVersionId) return; clean(item.id); const result = await pullGitHubItem(controller, id, item.id, item.currentVersionId); refreshed(item.id); setMessage(result.synced ? '已从 GitHub 拉取为新的云库版本。' : '已保存到本机，等待云库同步。'); })}>拉取更新</Button><Button size="sm" variant="outline" disabled={busy || !item.currentVersionId} onClick={() => { try { clean(item.id); setConfirmPublish(item); } catch (cause) { setError((cause as Error).message); } }}>发布到 GitHub</Button></> : null}</div>)}</div> : null}
    {confirmPublish ? <div role="alertdialog" aria-label="确认发布到 GitHub" className="space-y-2 rounded border border-border p-3"><p>将 {githubItemLink(confirmPublish)?.path} 的已同步云库版本发布为 GitHub 提交。远端变化会中止发布，请先确认文件内容。</p><Button size="sm" disabled={busy} onClick={() => void run(async () => { const id = libraryId; if (!id || !confirmPublish.currentVersionId) return; clean(confirmPublish.id); const result = await publishGitHubItem(controller, id, confirmPublish.id, confirmPublish.currentVersionId); setConfirmPublish(null); setMessage(`GitHub 提交成功：${result.commitSha.slice(0, 12)}${result.synced ? '' : '；来源记录仍待云库同步'}`); })}>确认创建 GitHub 提交</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmPublish(null)}>取消</Button></div> : null}
    {confirmDisconnect && status?.connected ? <div className="space-y-2"><p>解除后将撤销此 Lattice 账号保存的 GitHub 授权，并移除由 GitHub 提供的成员权限。云库内容及手动成员保留。仍连接的云库仓库将停止同步。</p><Button size="sm" variant="destructive" disabled={busy} onClick={() => void run(async () => { await client.unlinkIdentity(); setStatus(value => value ? {...value, connected: false, login: undefined, requiresReauth: false} : value); setConnection(null); setRepositories([]); setConfirmDisconnect(false); if (libraryId) await controller.refreshLibrary(libraryId); setMessage('已解除 GitHub 授权。'); })}>确认解除授权</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(false)}>取消</Button></div> : null}
    {message ? <p role="status">{message}</p> : null}{error ? <div><p role="alert" className="text-destructive">{error}</p><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { const next = await client.status(); setStatus(next); if (next.connected && !next.requiresReauth && libraryId) setConnection(await client.connection(libraryId)); })}>重试</Button></div> : null}{!status && !error ? <p role="status">正在读取 GitHub 连接…</p> : null}
  </section>;
}
