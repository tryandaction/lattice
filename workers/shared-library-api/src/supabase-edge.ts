import { handleRequest, type SharedLibraryWorkerEnv } from "./index";

/** Reuse the Worker policy boundary without duplicating the cloud API. */
export async function handleSupabaseEdgeRequest(request: Request, env: SharedLibraryWorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const publicPrefix = "/functions/v1/shared-library-api";
  const prefix = [publicPrefix, "/shared-library-api"].find(value => url.pathname === value || url.pathname.startsWith(`${value}/`));
  if (prefix) {
    url.pathname = url.pathname.slice(prefix.length) || "/";
    request = new Request(url, request);
  }
  return handleRequest(request, { ...env, PUBLIC_API_BASE_URL: `${new URL(env.SUPABASE_URL).origin}${publicPrefix}` }, `sl-${crypto.randomUUID()}`);
}
