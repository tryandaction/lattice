import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudLibraryWorkspaceController } from '@/lib/shared-library/cloud-workspace';
import { CloudGitHubPanel } from '../cloud-github-panel';
afterEach(cleanup);
function controller(configured=true, requiresReauth=false) {
  const request=vi.fn(async (input:{path:string})=>({status:200,body:{data:input.path.endsWith('/status')?{configured,connected:configured,login:'alice',requiresReauth}:input.path.endsWith('/tree')?{entries:[{path:'docs/research.md',sha:'a'.repeat(40),size:12,type:'blob'}],branch:'main',sha:'b'.repeat(40)}:input.path.endsWith('/repositories')?[]:{id:'connection',repositoryId:1,fullName:'group/private',private:true,branch:'main',stale:false}}}));
  return {transport:{request},getSnapshot:()=>({items:[{id:'ordinary',libraryId:'lib',status:'active',metadata:{},title:'ordinary.md',canonicalName:'ordinary.md',currentVersionId:'version'}],outbox:[]})} as unknown as CloudLibraryWorkspaceController;
}
describe('GitHub cloud library panel',()=>{
  it('shows a service message without making end users configure a GitHub App',async()=>{
    render(<CloudGitHubPanel controller={controller(false)} libraryId="lib" role="owner" />);
    await screen.findByText(/GitHub 连接服务暂不可用/);
    expect(screen.queryByRole('button',{name:'登录并授权 GitHub'})).toBeNull();
    expect(screen.queryByText('已关联文件')).toBeNull();
    expect(screen.queryByRole('button',{name:'发布到 GitHub'})).toBeNull();
  });
  it('creates and links a cloud library from an authorized private repository without an existing library',async()=>{
    const repo = { id: 88, installationId: 77, fullName: 'team/private-notes', name: 'private-notes', private: true, permissions: { push: true } };
    const request = vi.fn(async (input: {path: string}) => ({status: 200, body: {data: input.path.endsWith('/status') ? {configured: true, connected: true, login: 'alice', installationUrl: 'https://github.com/apps/lattice-cloud/installations/new'} : input.path.endsWith('/repositories') ? [repo] : { repositoryId: 88, fullName: repo.fullName, private: true, branch: 'main' }}}));
    const current = { transport: {request}, refreshLibrary: vi.fn(async () => {}), getSnapshot: () => ({items: []}) } as unknown as CloudLibraryWorkspaceController;
    const create = vi.fn(async () => 'created-library');
    const onLibraryConnected = vi.fn();
    render(<CloudGitHubPanel controller={current} role="owner" onCreateLibrary={create} onLibraryConnected={onLibraryConnected} />);
    await screen.findByRole('link',{name: '安装或管理授权仓库'});
    fireEvent.click(screen.getByRole('button',{name: '选择授权仓库'}));
    await screen.findByRole('option',{name: 'team/private-notes · 私有'});
    fireEvent.click(screen.getByRole('button',{name: '创建云库并关联'}));
    await screen.findByText(/仓库已关联/);
    expect(create).toHaveBeenCalledWith(repo);
    expect(onLibraryConnected).toHaveBeenCalledWith('created-library');
    expect(request).toHaveBeenCalledWith(expect.objectContaining({path:'/v1/libraries/created-library/github', body:{repositoryId:88, installationId:77}}));
  });
  it('helps a connected user install the app when there are no authorized repositories',async()=>{
    const current = controller();
    vi.mocked(current.transport.request).mockImplementation(async input => ({status:200,body:{data:input.path.endsWith('/status')?{configured:true,connected:true,login:'alice',installationUrl:'https://github.com/apps/lattice-cloud/installations/new'}:[]}}));
    render(<CloudGitHubPanel controller={current} role="owner" onCreateLibrary={async () => 'created'} />);
    fireEvent.click(await screen.findByRole('button',{name:'选择授权仓库'}));
    await screen.findByText(/还没有可关联的授权仓库/);
    expect(screen.getByRole('link',{name:'安装或管理授权仓库'}).getAttribute('href')).toBe('https://github.com/apps/lattice-cloud/installations/new');
  });
  it('lists repository files only on explicit request',async()=>{
    const current=controller();render(<CloudGitHubPanel controller={current} libraryId="lib" role="editor" />);
    await screen.findByText('group/private');
    expect(current.transport.request).not.toHaveBeenCalledWith(expect.objectContaining({path:expect.stringContaining('/tree')}));
    fireEvent.click(screen.getByRole('button',{name:'浏览仓库文件'}));
    await screen.findByRole('option',{name:'docs/research.md'});
  });
  it('offers reauthorization when the linked identity has expired credentials',async()=>{
    render(<CloudGitHubPanel controller={controller(true,true)} libraryId="lib" role="editor" />);
    await screen.findByRole('button',{name:'重新授权 GitHub'});
    expect(screen.queryByText('已关联文件')).toBeNull();
  });
  it('keeps repository management unavailable to read-only members',async()=>{
    render(<CloudGitHubPanel controller={controller()} libraryId="lib" role="viewer" />);
    await screen.findByText('group/private');
    expect(screen.queryByRole('button',{name:'断开仓库连接'})).toBeNull();
    expect(screen.queryByRole('button',{name:'导入所选文件'})).toBeNull();
  });
});
