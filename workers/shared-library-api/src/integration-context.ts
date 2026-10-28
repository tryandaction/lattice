import type { SharedLibraryWorkerEnv } from './index';

/** Integration routes retain the caller's verified database/RLS boundary. */
export interface CloudIntegrationContext {
  env: SharedLibraryWorkerEnv;
  actor: { userId: string; accessToken: string };
  segments: string[];
  url: URL;
  db: (table: string, init?: RequestInit, query?: Record<string, string | number | undefined>) => Promise<{ response: Response; body: unknown }>;
  json: (body: unknown, status?: number) => Response;
  error: (code: string, message: string, status: number, retryable?: boolean) => Response;
}
