import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleGitHubJobs } from './github-jobs';
import type { SharedLibraryWorkerEnv } from './index';
vi.mock('./github', () => ({ processGitHubWebhookDeliveries: vi.fn(async () => ({ processed: 2, failed: 0 })) }));
afterEach(() => vi.clearAllMocks());
const env: SharedLibraryWorkerEnv = { SUPABASE_URL:'https://project.test',SUPABASE_ANON_KEY:'public',GITHUB_SYNC_JOB_SECRET:'generated-server-job-secret-32-characters' };
describe('private GitHub background job ingress',()=>{
  it('refuses absent or wrong credentials',async()=>{
    for(const token of ['', 'ordinary-user-jwt']) expect((await handleGitHubJobs(new Request('https://api.test/jobs',{method:'POST',headers:{authorization:`Bearer ${token}`}}),env)).status).toBe(401);
  });
  it('refuses GET even with the job secret',async()=>{
    expect((await handleGitHubJobs(new Request('https://api.test/jobs',{headers:{authorization:`Bearer ${env.GITHUB_SYNC_JOB_SECRET}`}}),env)).status).toBe(405);
  });
  it('processes durable delivery retries without returning credentials',async()=>{
    const response=await handleGitHubJobs(new Request('https://api.test/jobs',{method:'POST',headers:{authorization:`Bearer ${env.GITHUB_SYNC_JOB_SECRET}`}}),env);
    expect(response.status).toBe(200);expect(await response.json()).toEqual({processed:2,failed:0});
  });
});
