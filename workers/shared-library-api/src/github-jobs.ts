import { processGitHubWebhookDeliveries } from './github';
import type { SharedLibraryWorkerEnv } from './index';

export async function handleGitHubJobs(request: Request, env: SharedLibraryWorkerEnv): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: { code: 'METHOD_NOT_ALLOWED' } }, { status: 405 });
  if (!env.GITHUB_SYNC_JOB_SECRET || env.GITHUB_SYNC_JOB_SECRET.length < 32) return Response.json({ error: { code: 'GITHUB_NOT_CONFIGURED' } }, { status: 503 });
  const candidate = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1] ?? '';
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [received, expected] = await Promise.all([digest(candidate), digest(env.GITHUB_SYNC_JOB_SECRET)]);
  let difference = 0; for (let index = 0; index < expected.length; index++) difference |= received[index] ^ expected[index];
  if (difference !== 0) return Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  try { return Response.json(await processGitHubWebhookDeliveries(env)); }
  catch { return Response.json({ error: { code: 'GITHUB_JOB_RETRY_REQUIRED' } }, { status: 503 }); }
}
