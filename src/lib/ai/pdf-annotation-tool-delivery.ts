import { agentToolSourceReads, type AgentToolExecutionResult } from './agent-tool-broker';
import { parsePdfAnnotationMarkdownDrafts } from '../pdf-annotation-markdown-drafts';

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined;
const canonicalPath = (path: string) => path.replace(/\\/gu, '/');

/** Recognize real, source-bound Workbench receipts, never a model's success claim. */
export function verifiedPdfAnnotationToolDeliveries(results: readonly AgentToolExecutionResult[] = []): Array<{ acceptedCount: number; rejectedCount: number }> {
  return results.flatMap(receipt => {
    if (receipt.status !== 'completed' || receipt.toolName !== 'lattice.pdf.proposeAnnotations') return [];
    const result = record(receipt.result), validation = record(result?.annotationValidation);
    if (!result || result.status !== 'pending-review' || !validation
      || !Number.isSafeInteger(validation.acceptedCount) || (validation.acceptedCount as number) < 1
      || !Number.isSafeInteger(validation.rejectedCount) || (validation.rejectedCount as number) < 0) return [];
    const read = agentToolSourceReads(receipt.toolName, receipt.result)[0];
    const targetPath = receipt.resultMetadata?.annotationTargetPath;
    if (!read || typeof targetPath !== 'string' || canonicalPath(targetPath) !== canonicalPath(read.snapshot.path)) return [];
    const draft = record(result.draft), proposal = record(result.proposal);
    const target = record(draft?.pdfChildTarget), cloud = record(draft?.cloudPdfChildProposal), cloudParent = record(cloud?.parent);
    const localBinding = target && typeof target.sourcePath === 'string' && canonicalPath(target.sourcePath) === canonicalPath(read.snapshot.path)
      && target.parentVersion === read.snapshot.version && target.workspaceKey === read.snapshot.workspaceKey;
    const proposalBinding = proposal && typeof proposal.parentPath === 'string' && canonicalPath(proposal.parentPath) === canonicalPath(read.snapshot.path)
      && proposal.parentVersion === read.snapshot.version && proposal.workspaceKey === read.snapshot.workspaceKey;
    const identity = read.snapshot.cloudIdentity;
    const cloudBinding = identity && cloudParent && ['libraryId', 'itemId', 'versionId'].every(key => {
      const value = identity[key as keyof typeof identity];
      return typeof value === 'string' && value.length > 0 && cloudParent[key] === value;
    });
    const content = typeof draft?.content === 'string' ? draft.content : proposal?.content;
    const path = typeof draft?.targetPath === 'string' ? draft.targetPath : proposal?.targetPath;
    if (!localBinding && !proposalBinding && !cloudBinding || typeof content !== 'string' || typeof path !== 'string'
      || !canonicalPath(path).endsWith('/_annotations.md')
      || parsePdfAnnotationMarkdownDrafts(content).length < (validation.acceptedCount as number)) return [];
    return [{ acceptedCount: validation.acceptedCount as number, rejectedCount: validation.rejectedCount as number }];
  });
}
