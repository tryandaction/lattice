import type { SharedLibraryTransport, TransportRequest } from './remote-repository';

export interface GitHubIdentityStatus {
  configured: boolean; connected: boolean; githubUserId?: number; login?: string; expiresAt?: string; requiresReauth?: boolean; joinedLibraries?: number; installationUrl?: string | null;
}
export interface GitHubAuthorization { authorizationUrl: string; expiresAt: string; redirectUri: string; returnTo: string | null; flow: 'server' | 'legacy' }
export interface GitHubAuthorizeInput { returnTo?: string; desktop?: boolean; connectionId: string; libraryId?: string }
export type GitHubOAuthClaim = GitHubIdentityStatus | { pending: true };
export interface GitHubRepository {
  id: number; installationId: number; owner: string; name: string; fullName: string; private: boolean; defaultBranch: string;
  permissions: { push: boolean; maintain: boolean; admin: boolean };
}
export interface GitHubSyncResult { granted: number; revoked: number; matched: number; unbound: number; lastSyncedAt: string }
export interface GitHubConnection {
  id: string; libraryId: string; repositoryId: number; installationId: number; owner: string; name: string; fullName: string; branch: string; private: boolean;
  connectedAt: string; lastSyncedAt: string | null; stale: boolean; accessVerifiedAt?: string; sync?: GitHubSyncResult;
}
export interface GitHubTreeEntry { path: string; sha: string; size: number; type: 'blob' }
export interface GitHubFile { path: string; sha: string; content: string; encoding: 'base64'; size: number; branch: string; repositoryId?: number }
export interface GitHubPublishInput { path: string; content: string; expectedSha: string | null; message?: string; expectedRepositoryId?: number; expectedBranch?: string }
export interface GitHubPublishResult { path: string; sha: string; commitSha: string; branch: string; repositoryId?: number }

/** All GitHub credentials remain in the server. Uses the shared bearer transport. */
export class GitHubIntegrationClient {
  constructor(private readonly transport: SharedLibraryTransport) {}
  private async request<T>(input: TransportRequest): Promise<T> {
    const response = await this.transport.request(input);
    const body = response.body;
    return (body && typeof body === 'object' && 'data' in body ? (body as { data: T }).data : body) as T;
  }
  status(): Promise<GitHubIdentityStatus> { return this.request({ method: 'GET', path: '/v1/integrations/github/status' }); }
  authorize(input: GitHubAuthorizeInput): Promise<GitHubAuthorization> {
    return this.request({ method: 'POST', path: '/v1/integrations/github/authorize', body: input });
  }
  claim(input: { state: string; connectionId: string }): Promise<GitHubOAuthClaim> { return this.request({ method: 'POST', path: '/v1/integrations/github/claim', body: input }); }
  unlinkIdentity(): Promise<{ disconnected: true }> { return this.request({ method: 'DELETE', path: '/v1/integrations/github/identity' }); }
  exchange(input: { code: string; state: string; redirectUri: string }): Promise<GitHubIdentityStatus> {
    return this.request({ method: 'POST', path: '/v1/integrations/github/exchange', body: input });
  }
  repositories(): Promise<GitHubRepository[]> { return this.request({ method: 'GET', path: '/v1/integrations/github/repositories' }); }
  connection(libraryId: string): Promise<GitHubConnection | null> { return this.request({ method: 'GET', path: this.path(libraryId) }); }
  connect(libraryId: string, input: { repositoryId: number; installationId: number }): Promise<GitHubConnection> {
    return this.request({ method: 'POST', path: this.path(libraryId), body: input });
  }
  sync(libraryId: string): Promise<GitHubSyncResult> { return this.request({ method: 'POST', path: `${this.path(libraryId)}/sync`, body: {} }); }
  disconnect(libraryId: string): Promise<{ disconnected: true }> { return this.request({ method: 'DELETE', path: this.path(libraryId) }); }
  tree(libraryId: string): Promise<{ branch: string; sha: string; entries: GitHubTreeEntry[] }> { return this.request({ method: 'GET', path: `${this.path(libraryId)}/tree` }); }
  readFile(libraryId: string, path: string): Promise<GitHubFile> { return this.request({ method: 'GET', path: `${this.path(libraryId)}/file`, query: { path } }); }
  publishFile(libraryId: string, input: GitHubPublishInput): Promise<GitHubPublishResult> { return this.request({ method: 'PUT', path: `${this.path(libraryId)}/file`, body: input }); }
  private path(libraryId: string): string { return `/v1/libraries/${encodeURIComponent(libraryId)}/github`; }
}

/** Decode repository bytes without corrupting UTF-8 source text. */
export function decodeGitHubFile(file: Pick<GitHubFile, 'content'>): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(file.content), character => character.charCodeAt(0));
}
export function encodeGitHubFile(bytes: Uint8Array): string {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary);
}
