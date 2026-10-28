// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ApiTransport } from '../api-transport';
import { CloudLibraryWorkspaceController, type CloudWorkspaceSnapshot } from '../cloud-workspace';
import type { CloudPersistence } from '../cloud-persistence';
async function fixture(contentHash?: string) {
  let snapshot: CloudWorkspaceSnapshot = { schema:1,revision:0,libraries:[],items:[{id:'item',libraryId:'lib',canonicalName:'note.md',title:'note.md',kind:'markdown',metadata:{parentItemId:'folder'},currentVersionId:'v2',status:'active',createdBy:'u',createdAt:'',updatedAt:''}],versions:[],annotations:[],comments:[],outbox:[],roles:{lib:{role:'editor',verifiedAt:Date.now()}},revoked:[],cursors:{} };
  const persistence: CloudPersistence<CloudWorkspaceSnapshot> = { load:async()=>structuredClone(snapshot),content:async()=>null,commit:async next=>{snapshot=structuredClone(next);} };
  if (contentHash) snapshot.items[0].contentHash = contentHash;
  const controller=new CloudLibraryWorkspaceController({id:'c',name:'test',apiUrl:'https://api.test',supabaseUrl:'https://auth.test',publicKey:'public',maxFileBytes:100000},'u',persistence,new ApiTransport({baseUrl:'https://api.test',getAccessToken:async()=>null}),()=>false);
  await controller.initialize();return controller;
}
describe('GitHub cloud metadata safety',()=>{
  it('refuses a stale content save without replacing the local projection',async()=>{
    const controller=await fixture();
    await expect(controller.save('lib','item',{kind:'text',text:'stale',mimeType:'text/plain',updatedAt:''},'v1')).rejects.toThrow(/版本/);
    expect(controller.getSnapshot().items[0].currentVersionId).toBe('v2');expect(controller.getSnapshot().outbox).toHaveLength(0);
  });
  it('durably queues source metadata while retaining parent and content version',async()=>{
    const controller=await fixture();
    await controller.updateMetadata('lib','item',{github:{repositoryId:1,path:'docs/note.md',sha:'source-sha',branch:'main'}},'v2');
    expect(controller.getSnapshot().items[0]).toMatchObject({currentVersionId:'v2',metadata:{parentItemId:'folder',github:{repositoryId:1}}});
    expect(controller.getSnapshot().outbox[0].request?.body).toEqual({metadataPatch:{github:{repositoryId:1,path:'docs/note.md',sha:'source-sha',branch:'main'}},expectedVersionId:'v2'});
    await expect(controller.updateMetadata('lib','item',{parentItemId:'other'},'v2')).rejects.toThrow();
  });
  it('checks the expected source version even when the saved bytes are unchanged', async () => {
    const content = { kind: 'text' as const, text: 'same', mimeType: 'text/plain', updatedAt: '' };
    const controller = await fixture(createHash('sha256').update(content.text).digest('hex'));
    await expect(controller.save('lib', 'item', content, 'v1')).rejects.toThrow(/版本/);
    expect(controller.getSnapshot().items[0].currentVersionId).toBe('v2');
    expect(controller.getSnapshot().outbox).toHaveLength(0);
    expect(await controller.save('lib', 'item', content, 'v2')).toBe('v2');
    expect(controller.getSnapshot().outbox).toHaveLength(0);
  });
});
