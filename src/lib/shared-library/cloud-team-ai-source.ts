import { captureCloudAgentDocumentSources, verifyCloudAgentCitation } from '@/lib/ai/cloud-source';
import type { AgentDocumentSource } from '@/lib/ai/document-source';
import type { CloudLibraryResource, CloudLibrarySourceProvider } from './source-provider';

export const TEAM_AI_SOURCE_MAX_BYTES = 24_000;
const MAX_READ_UNITS = 512;
export interface TeamAiCapturedSource {
  name: string; text: string; versionId?: string; truncated: boolean; readUnits: number; totalUnits: number;
}
export interface CaptureTeamAiSourceInput {
  provider: CloudLibrarySourceProvider; libraryId: string; itemId: string; expectedVersionId?: string; signal?: AbortSignal; isCurrent?: () => boolean;
}
function utf8Prefix(text: string, budget: number): { text: string; bytes: number; truncated: boolean } {
  const encoder = new TextEncoder(); const chunks: string[] = []; let bytes = 0;
  for (const character of text) {
    const size = encoder.encode(character).byteLength;
    if (bytes + size > budget) return { text: chunks.join(''), bytes, truncated: true };
    bytes += size; chunks.push(character);
  }
  return { text: chunks.join(''), bytes, truncated: false };
}

/** Explicit, read-only capture of one selected file. Never calls an AI service. */
export async function captureTeamAiSource(input: CaptureTeamAiSourceInput): Promise<TeamAiCapturedSource> {
  const { provider, libraryId, itemId, signal } = input; const scope = provider.scope;
  const resourceIdentity = provider.resourceIdentity?.(libraryId, itemId);
  const check = () => {
    if (signal?.aborted) throw new DOMException('团队 AI 资料读取已取消。', 'AbortError');
    if (provider.scope !== scope || input.isCurrent && !input.isCurrent() || resourceIdentity !== undefined && provider.resourceIdentity?.(libraryId, itemId) !== resourceIdentity) throw new Error('云端账号或当前文件已变化，请重新选择团队 AI 资料。');
  };
  const assertResource = (resource: CloudLibraryResource, baseline?: { id: string; versionId?: string; role: string }) => {
    if (resource.libraryId !== libraryId || resource.itemId !== itemId || resourceIdentity !== undefined && resource.id !== resourceIdentity
      || baseline && (resource.id !== baseline.id || resource.versionId !== baseline.versionId || resource.role !== baseline.role)
      || input.expectedVersionId !== undefined && resource.versionId !== input.expectedVersionId) throw new Error('云端资料的身份、权限或版本已变化，请重新打开文件。');
  };
  check();
  const resource = await provider.read(libraryId, itemId, signal);
  check(); assertResource(resource);
  if (resource.kind === 'folder' || !resource.content) throw new Error('请选择一个具有可读内容的文件，不能将整个目录附为团队 AI 资料。');
  const baseline = { id: resource.id, versionId: resource.versionId, role: resource.role };
  let sources: AgentDocumentSource[] = [];
  try {
    const captured = await captureCloudAgentDocumentSources({ provider, resource, signal, isCurrent: () => { check(); return true; } });
    sources = captured.sources; check();
    if (sources.length !== 1 || captured.snapshots.length !== 1) throw new Error('团队 AI 仅支持显式选择一个文件作为本次资料。');
    const source = sources[0]; const identity = source.cloudIdentity;
    if (!identity || source.path !== baseline.id || identity.resourceId !== baseline.id || identity.libraryId !== libraryId || identity.itemId !== itemId
      || identity.versionId !== baseline.versionId || identity.role !== baseline.role || source.providerScope !== scope) throw new Error('资料捕获期间身份、权限或版本已变化，已丢弃提取文本。');
    if (!Number.isSafeInteger(source.totalUnits) || source.totalUnits < 0) throw new Error('文件提取器返回的内容单元无效。');
    let text = ''; let byteLength = 0; let truncated = false; let readUnits = 0;
    for (let unit = 1; unit <= source.totalUnits && unit <= MAX_READ_UNITS; unit++) {
      check();
      const value = await source.readUnit(unit, signal);
      check(); readUnits++;
      if (value.status === 'unreadable') throw new Error('文件文字提取失败，或来源权限、版本已变化；请重新打开后重试。');
      if (!value.text.trim()) continue;
      const separator = text ? String.fromCharCode(10) : '';
      const available = TEAM_AI_SOURCE_MAX_BYTES - byteLength - separator.length;
      if (available < 0) { truncated = true; break; }
      const prefix = utf8Prefix(value.text, available);
      text += separator + prefix.text; byteLength += separator.length + prefix.bytes;
      if (prefix.truncated || byteLength >= TEAM_AI_SOURCE_MAX_BYTES && unit < source.totalUnits) { truncated = true; break; }
    }
    if (readUnits < source.totalUnits) truncated = true;
    if (!text.trim()) throw new Error(`没有可提取的文字${source.totalUnits > MAX_READ_UNITS ? '（已检查前 512 个内容单元）' : ''}。扫描 PDF 或图片文档需要先进行 OCR；未将其假作已读资料。`);
    check();
    // A final authorized read and content fingerprint check catch changes after
    // the last extracted unit, including unversioned resources and role changes.
    const verified = await verifyCloudAgentCitation({ provider, identity, signal });
    check(); assertResource(verified, baseline);
    return { name: verified.name, text, versionId: verified.versionId, truncated, readUnits, totalUnits: source.totalUnits };
  } finally { await Promise.allSettled(sources.map(source => source.close())); }
}
