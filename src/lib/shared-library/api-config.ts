/**
 * Shared Library API configuration.
 *
 * Only public client-safe values live here: the API base URL and a token
 * provider. Service role keys and secrets never belong in this module or
 * anywhere in the Web/Desktop bundle.
 */

export interface ApiConfig {
  baseUrl: string;
  /** Resolves the current bearer token, or null when signed out. */
  getAccessToken: () => Promise<string | null>;
  /** Request timeout in milliseconds. Defaults to 15s. */
  timeoutMs?: number;
  /** Injectable fetch for tests and for Web/Desktop adapters. */
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
}
