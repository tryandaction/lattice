import { beforeEach, describe, expect, it } from 'vitest';
import { pdfCompanionDocumentIdentity, useAiPdfCompanionStore, type PdfCompanionOperation } from '../ai-pdf-companion-store';

const proposal = { id: 'proposal', documentPath: 'paper.pdf', page: 1, quote: 'A verified sentence.', rects: [], source: { kind: 'pdf_page' as const, label: 'Paper', locator: 'paper.pdf#page=1' } };
const store = () => useAiPdfCompanionStore.getState();
const request = (): PdfCompanionOperation => {
  store().setTransientAnnotations([proposal]);
  store().requestInjection();
  return { kind: 'injection', requestId: store().pendingInjection!.requestId, fileIdentity: 'workspace:paper.pdf', consumerId: 'pane-a:attempt-1' };
};

describe('PDF companion operation ownership', () => {
  beforeEach(() => {
    useAiPdfCompanionStore.setState({ operationClaim: null });
    store().clear();
  });

  it('hands off unresolved work after unmount without allowing the old consumer to release the new claim', () => {
    const operation = request();
    expect(store().claimOperation(operation)).toBe(true);
    const next = { ...operation, consumerId: 'pane-b:attempt-1' };
    expect(store().claimOperation(next)).toBe(false);
    store().releaseOperation(operation);
    expect(store().claimOperation(next)).toBe(true);
    store().releaseOperation(operation, true);
    expect(store().operationClaim?.consumerId).toBe('pane-b:attempt-1');
  });

  it('does not release an in-flight write on unmount or clear and only accepts its first persistence transition', () => {
    const operation = request();
    expect(store().claimOperation(operation)).toBe(true);
    expect(store().beginOperationPersistence(operation)).toBe(true);
    expect(store().beginOperationPersistence(operation)).toBe(false);
    store().releaseOperation(operation);
    expect(store().claimOperation({ ...operation, consumerId: 'pane-b' })).toBe(false);
    store().clear();
    expect(store().operationClaim?.phase).toBe('persisting');
    store().releaseOperation(operation, true);
    expect(store().operationClaim).toBeNull();
  });

  it('allows a failed write to be retried as a new request after it settles', () => {
    const operation = request();
    store().claimOperation(operation);
    store().beginOperationPersistence(operation);
    store().failInjection(operation.requestId, 'Failed to save');
    store().releaseOperation(operation, true);
    expect(store().transientAnnotations).toEqual([proposal]);
    store().requestInjection();
    const next = { ...operation, requestId: store().pendingInjection!.requestId };
    expect(next.requestId).not.toBe(operation.requestId);
    expect(store().claimOperation(next)).toBe(true);
    store().completeInjection(operation.requestId, [proposal.id]);
    expect(store().pendingInjection?.requestId).toBe(next.requestId);
  });

  it('gives undo one owner and ignores completion from an earlier undo request', () => {
    store().requestUndo('paper.pdf');
    const operation: PdfCompanionOperation = { kind: 'undo', requestId: store().pendingUndoRequestId!, fileIdentity: 'workspace:paper.pdf', consumerId: 'pane-a' };
    expect(store().claimOperation(operation)).toBe(true);
    expect(store().claimOperation({ ...operation, consumerId: 'pane-b' })).toBe(false);
    store().beginOperationPersistence(operation);
    store().completeUndo(operation.requestId, [], 'Storage unavailable');
    store().releaseOperation(operation, true);
    store().requestUndo('paper.pdf');
    const retryId = store().pendingUndoRequestId;
    expect(retryId).not.toBe(operation.requestId);
    store().completeUndo(operation.requestId, []);
    expect(store().pendingUndoRequestId).toBe(retryId);
  });
});

describe('PDF companion file identity', () => {
  const workspace = { rootPath: 'C:/Research/Workspace', rootName: 'Workspace', workspaceKey: 'research' };
  it.each([
    ['paper.pdf', 'c:/research/workspace/paper.pdf'],
    ['Workspace/paper.pdf', 'c:/research/workspace/paper.pdf'],
    ['archive/paper.pdf', 'c:/research/workspace/archive/paper.pdf'],
    ['C:\\Research\\Workspace\\paper.pdf', 'c:/research/workspace/paper.pdf'],
    ['C:/Research/Workspace-copy/paper.pdf', null],
    ['D:/Research/Workspace/paper.pdf', null],
    ['../paper.pdf', null],
  ])('resolves %s only through the known root', (path, expected) => {
    expect(pdfCompanionDocumentIdentity(path!, workspace)).toBe(expected);
  });
  it('keeps browser workspace-relative names distinct without suffix matching', () => {
    const scope = { rootName: 'Workspace', workspaceKey: 'browser-workspace' };
    expect(pdfCompanionDocumentIdentity('paper.pdf', scope)).toBe('browser-workspace:paper.pdf');
    expect(pdfCompanionDocumentIdentity('archive/paper.pdf', scope)).toBe('browser-workspace:archive/paper.pdf');
  });
});
