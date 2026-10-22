// @vitest-environment node
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { resolve } from 'node:path';
import { realPlatformAuthAvailable,realPlatformAuthFixture } from '../test-support/real-platform-auth';
import { syntheticIds } from '../test-support/platform-postgres';
import { SupabaseAuthRepository } from '../../../src/lib/shared-library/supabase-auth';
import type { AuthSession } from '../../../src/lib/shared-library/auth';

describe.skipIf(!realPlatformAuthAvailable)('real Auth and PostgREST recovery acceptance',()=>{
  let f:Awaited<ReturnType<typeof realPlatformAuthFixture>>;
  beforeAll(async()=>{f=await realPlatformAuthFixture();},240000);
  afterAll(async()=>{await f?.close();});
  it('runs real confirmation, password login and restored account login with no external mail or hosted service',async()=>{
    const auth=await f.startAuth('lattice_source');
    const password='Synthetic-only-password-20261022!';
    const accounts=new Map<string,string>();
    for(const name of ['owner','viewer','outsider']){
      const mailIndex=f.smtp.messages.length;
      const result=await fetch(auth.base+'/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:name+'@synthetic.test',password})});
      if(result.status!==200)throw new Error('Synthetic signup '+result.status+': '+await result.text()+'; '+auth.diagnostics());
      const signup=await result.json() as {id:string};expect(signup.id).toMatch(/^[a-f0-9-]{36}$/);accounts.set(name,signup.id);
      for(let attempt=0;attempt<40&&f.smtp.messages.length===mailIndex;attempt++)await new Promise(resolve=>setTimeout(resolve,50));
      expect(f.smtp.messages).toHaveLength(mailIndex+1);
      const mail=f.smtp.messages[mailIndex].replace(/=\r\n/g,'').replace(/=([a-f0-9]{2})/gi,(_match,value)=>String.fromCharCode(parseInt(value,16)));
      const link=mail.match(/https?:\/\/127\.0\.0\.1:\d+\/verify\?[^"<>\s]+/)?.[0]?.replaceAll('&amp;','&');
      expect(Boolean(link)).toBe(true);
      const verified=await fetch(link!,{redirect:'manual'});expect([302,303]).toContain(verified.status);
    }
    const i=syntheticIds,owner=accounts.get('owner')!,viewer=accounts.get('viewer')!;
    await f.sql(`set session_replication_role=replica;
      insert into public.organizations(id,name,slug,created_by) values('${i.organization}','Synthetic recovery','synthetic','${owner}');
      insert into public.libraries(id,organization_id,name,slug,created_by) values('${i.library}','${i.organization}','恢复科研库','research','${owner}');
      insert into public.library_members(library_id,user_id,role,display_name) values('${i.library}','${owner}','owner','原作者'),('${i.library}','${viewer}','viewer','协作者');
      insert into public.blobs(id,library_id,storage_key,size_bytes,sha256,storage_backend) values('${i.blob}','${i.library}','libraries/${i.library}/blobs/${i.blob}',20971520,repeat('a',64),'supabase'),('${i.oldBlob}','${i.library}','libraries/${i.library}/blobs/${i.oldBlob}',4,repeat('b',64),'supabase');
      insert into public.items(id,library_id,kind,title,canonical_name,created_by,current_version_id,metadata) values('${i.paper}','${i.library}','pdf','Paper','paper.pdf','${owner}','${i.version}','{}'),('${i.child}','${i.library}','markdown','Child','note.md','${owner}',null,'{"parentItemId":"${i.paper}"}');
      insert into public.item_versions(id,item_id,version_number,blob_id,content_hash,created_by) values('${i.version}','${i.paper}',2,'${i.blob}',repeat('a',64),'${owner}'),('${i.oldVersion}','${i.paper}',1,'${i.oldBlob}',repeat('b',64),'${owner}');
      insert into public.item_children(parent_item_id,child_item_id,relative_path,kind,sort_key) values('${i.paper}','${i.child}','note.md','markdown','note.md');
      insert into public.annotations(item_id,version_id,author_id,kind,target,quote,body) values('${i.paper}','${i.version}','${owner}','highlight','{"page":3}','{"text":"Synthetic evidence"}','{"authorDisplayName":"原作者","text":"完整恢复批注"}');
      set session_replication_role=origin;`);
    await auth.stop();
    const {capturePostgresPlatformRecoverySnapshot}=await import('../../../scripts/cloud-library-postgres-snapshot.mjs');
    const {restorePostgresPlatformRecoverySnapshot}=await import('../../../scripts/cloud-library-platform-restore.mjs');
    const captureRoot=resolve(f.root,'actual-auth-capture');
    await capturePostgresPlatformRecoverySnapshot({connection:f.connection,binDirectory:f.binDirectory,output:captureRoot});
    await restorePostgresPlatformRecoverySnapshot({captureRoot,connection:{...f.connection,database:'lattice_target',projectRef:'synthetic-target'},binDirectory:f.binDirectory});
    const restored=await f.startAuth('lattice_target');
    const rest=await f.startRest('lattice_target'),gateway=await f.gateway(restored.base,rest.base);
    try{
      const repository=new SupabaseAuthRepository({id:'synthetic-recovery',name:'合成恢复云库',supabaseUrl:gateway.base,apiUrl:gateway.base+'/functions/v1/shared-library-api',publicKey:f.jwt('anon'),maxFileBytes:20971520});
      const tokens=new Map<string,AuthSession>();
      for(const [name,id] of accounts){
        const session=await repository.signIn({email:name+'@synthetic.test',password,deviceId:'synthetic-device'});expect(session.userId).toBe(id);tokens.set(name,session);
      }
      await expect(repository.signIn({email:'owner@synthetic.test',password:'synthetic-wrong-password',deviceId:'synthetic-device'})).rejects.toMatchObject({status:400});
      const api=(name:string,path:string)=>fetch(gateway.base+'/functions/v1/shared-library-api/v1'+path,{headers:{authorization:'Bearer '+tokens.get(name)!.accessToken}});
      const items=await api('viewer',`/libraries/${i.library}/items`);expect(items.status).toBe(200);expect(await items.json()).toHaveLength(2);
      const versions=await api('viewer',`/items/${i.paper}/versions`);expect(versions.status).toBe(200);expect(await versions.json()).toHaveLength(2);
      const children=await api('viewer',`/items/${i.paper}/children`);expect(children.status).toBe(200);expect(await children.json()).toHaveLength(1);
      const annotations=await api('viewer',`/items/${i.paper}/annotations`);expect(annotations.status).toBe(200);expect(JSON.stringify(await annotations.json())).toContain('完整恢复批注');
      const members=await api('viewer',`/libraries/${i.library}/members`);expect(members.status).toBe(200);expect(JSON.stringify(await members.json())).toContain('协作者');
      const outsiders=await api('outsider',`/libraries/${i.library}/items`);expect(outsiders.status).toBe(403);expect(await outsiders.json()).toMatchObject({error:{code:'FORBIDDEN'}});
      await f.sql(`update public.library_members set status='suspended' where user_id='${viewer}'`,'lattice_target');
      const revoked=await api('viewer',`/libraries/${i.library}/items`);expect(revoked.status).toBe(403);expect(await revoked.json()).toMatchObject({error:{code:'FORBIDDEN'}});
      expect(await f.sql(`select status from public.library_members where user_id='${viewer}'`)).toBe('active');
      const fresh=await repository.refresh({refreshToken:tokens.get('owner')!.refreshToken,deviceId:'synthetic-device'});expect(fresh.userId).toBe(owner);
      await repository.signOut({session:fresh});
      await expect(repository.refresh({refreshToken:fresh.refreshToken,deviceId:'synthetic-device'})).rejects.toMatchObject({status:400});
    }finally{await gateway.close();await rest.stop();await restored.stop();}
  },240000);
});
