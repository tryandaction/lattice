import type { SharedLibraryTransport } from './remote-repository';

export interface TeamAiProvider { id: string; label: string; models: string[]; maxOutputTokens: number }
export interface TeamAiProviders { enabled: boolean; providers: TeamAiProvider[] }
export interface TeamAiMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface TeamAiRequest { providerId: string; model: string; messages: TeamAiMessage[]; maxTokens?: number }
export interface TeamAiAnswer { content: string; model: string; providerId?: string; reservationId?: string; usage?: { totalTokens?: number } }
export interface TeamAiProviderConfig extends TeamAiProvider { baseUrl: string; requestBudgetUsdMicros: number; apiKeyConfigured: boolean }
export interface TeamAiLibraryConfig { enabled: boolean; maxRequestsPerDay: number; monthlyBudgetUsdMicros: number; maxOutputTokens: number; providers: TeamAiProviderConfig[] }
export interface TeamAiSaveConfig { enabled: boolean; maxRequestsPerDay: number; monthlyBudgetUsdMicros: number; maxOutputTokens: number; provider: Omit<TeamAiProviderConfig, 'apiKeyConfigured'> & { apiKey?: string } }
function unwrap<T>(body: unknown): T { return (body && typeof body === 'object' && 'data' in body ? (body as { data: unknown }).data : body) as T; }
export function cloudTeamAiClient(transport: SharedLibraryTransport, libraryId: string) {
  const path = `/v1/libraries/${encodeURIComponent(libraryId)}/ai`;
  return {
    async loadConfig(signal?: AbortSignal): Promise<TeamAiLibraryConfig> { return unwrap((await transport.request({ method: 'GET', path: `${path}/config`, signal })).body); },
    async saveConfig(body: TeamAiSaveConfig, signal?: AbortSignal): Promise<TeamAiLibraryConfig> { return unwrap((await transport.request({ method: 'PUT', path: `${path}/config`, body, signal })).body); },
    async deleteProvider(providerId: string, signal?: AbortSignal): Promise<void> { await transport.request({ method: 'DELETE', path: `${path}/config`, body: { providerId }, signal }); },
    async loadProviders(signal?: AbortSignal): Promise<TeamAiProviders> { return unwrap((await transport.request({ method: 'GET', path: `${path}/providers`, signal })).body); },
    async send(body: TeamAiRequest, signal?: AbortSignal): Promise<TeamAiAnswer> { return unwrap((await transport.request({ method: 'POST', path: `${path}/chat`, body, signal })).body); },
  };
}
