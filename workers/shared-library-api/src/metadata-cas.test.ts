import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from './index';
afterEach(()=>vi.restoreAllMocks());
const token = `e30.${btoa(JSON.stringify({sub:'user'}))}.signature`;
const env = {SUPABASE_URL:'https://project.test',SUPABASE_ANON_KEY:'public'};
const request=()=>new Request('https://api.test/v1/items/item',{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({metadataPatch:{github:{sha:'source'}},expectedVersionId:'version'})});
describe('source metadata CAS API',()=>{
  it('sends only the patch and expected version to an atomic database RPC',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({id:'item',library_id:'lib',metadata:{parentItemId:'new-folder',github:{sha:'source'}}}));
    const response=await handleRequest(request(),env,'cas');
    expect(response.status).toBe(200);
    expect(String(fetch.mock.calls[0][0])).toContain('/rpc/cloud_update_item_metadata');
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({p_item_id:'item',p_patch:{github:{sha:'source'}},p_expected_version_id:'version'});
  });
  it('returns a visible conflict when the content version changed',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({code:'40001'},{status:409}));
    const response=await handleRequest(request(),env,'cas-conflict');
    expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'SYNC_CONFLICT'}});
  });
});
