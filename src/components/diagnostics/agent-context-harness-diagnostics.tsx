'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AiChatPanel } from '@/components/ai/ai-chat-panel';
import { useAiChatStore } from '@/stores/ai-chat-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useAiProviderProfileStore } from '@/stores/ai-provider-profile-store';
import { useAiWorkbenchStore } from '@/stores/ai-workbench-store';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { useAiHarnessStore, createAiHarnessStore } from '@/stores/ai-harness-store';
import { setProviderOverride, clearProviderOverrides } from '@/lib/ai/providers';
import { getMessageText, type AiProvider, type AiModel } from '@/lib/ai/types';
import { DEFAULT_SETTINGS } from '@/types/settings';
import type { DirectoryNode, TreeNode } from '@/types/file-system';
import type { HarnessEvent, HarnessTransport } from '@/lib/ai/harness/types';
import { getStorageAdapter } from '@/lib/storage-adapter';
import { useFileSystem } from '@/hooks/use-file-system';
import { movePdfItemWorkspace } from '@/lib/pdf-item';
import { setLocale } from '@/lib/i18n';

class FixtureFile {
  kind = 'file' as const;
  constructor(public name: string, public content: BlobPart, public mimeType = 'text/markdown') {}
  async getFile() { return new File([this.content], this.name, { type: this.mimeType, lastModified: 1 }); }
  replaceContent(content: BlobPart) { this.content = content; }
  async createWritable() {
    let pending = this.content;
    return { write: async (value: BlobPart) => { pending = value; }, close: async () => { this.content = pending; }, abort: async () => {} };
  }
}
class FixtureDirectory {
  kind = 'directory' as const;
  entries = new Map<string, FixtureDirectory | FixtureFile>();
  permission: PermissionState = 'granted';
  constructor(public name: string) {}
  async queryPermission() { return this.permission; }
  revokePermission() { this.permission = 'denied'; }
  renameFile(from: string, to: string) {
    const file = this.entries.get(from);
    if (!file || file.kind !== 'file') throw new Error('Fixture source missing.');
    this.entries.delete(from); file.name = to; this.entries.set(to, file); return file;
  }
  async *values() { for (const value of this.entries.values()) yield value; }
  add<T extends FixtureDirectory | FixtureFile>(entry: T): T { this.entries.set(entry.name, entry); return entry; }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    if (this.permission !== 'granted') throw new DOMException('Fixture permission revoked', 'NotAllowedError');
    let value = this.entries.get(name);
    if (!value && options?.create) value = this.add(new FixtureDirectory(name));
    if (!value || value.kind !== 'directory') throw new DOMException('Missing fixture directory', 'NotFoundError');
    return value;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (this.permission !== 'granted') throw new DOMException('Fixture permission revoked', 'NotAllowedError');
    let value = this.entries.get(name);
    if (!value && options?.create) value = this.add(new FixtureFile(name, ''));
    if (!value || value.kind !== 'file') throw new DOMException('Missing fixture file', 'NotFoundError');
    return value;
  }
  async removeEntry(name: string) { this.entries.delete(name); }
  handle() { return this as unknown as FileSystemDirectoryHandle; }
}
function tree(directory: FixtureDirectory, path = directory.name): DirectoryNode {
  return { kind: 'directory', name: directory.name, path, handle: directory.handle(), isExpanded: true, childrenState: 'ready', children: Array.from(directory.entries.values(), entry => {
    const nextPath = path ? path + '/' + entry.name : entry.name;
    return entry.kind === 'directory' ? tree(entry, nextPath) : { kind: 'file', name: entry.name, path: nextPath, extension: entry.name.split('.').at(-1) ?? '', handle: entry as unknown as FileSystemFileHandle } as TreeNode;
  }) };
}

export function AgentContextHarnessDiagnostics() {
  const { hydratePdfVirtualChildren } = useFileSystem();
  const [ready, setReady] = useState(false);
  const [root, setRoot] = useState<FixtureDirectory | null>(null);
  const [requests, setRequests] = useState<Array<{ characters: number; history: number; kind: string; originalCharacters: number; originalIncluded: boolean; markers: string[] }>>([]);
  const [notice, setNotice] = useState('隔离 fixture：真实推理与收费请求均为 0。');
  const [fileEvidence, setFileEvidence] = useState('');
  const [largeStorageNotice, setLargeStorageNotice] = useState('not-created');
  const harnessUnsubscribe = useRef<(() => void) | null>(null);
  const isOpen = useAiChatStore(state => state.isOpen);
  const activeId = useAiChatStore(state => state.activeConversationId);
  const activeDraftLength = useAiChatStore(state => state.getConversationDraft()?.text.length ?? 0);
  const latestAnswer = useAiChatStore(state => state.getActiveConversation()?.messages.filter(message => message.role === 'assistant').at(-1));
  const directorySession = useAgentSessionStore(state => state.sessions.findLast(session => session.documentResearch?.directory));
  const directory = directorySession?.documentResearch?.directory;
  const largeStorageSession = useAgentSessionStore(state => state.sessions.find(session => session.id === 'synthetic-large-storage-fixture'));
  const model: AiModel = { id: 'agent-context-fixture', name: 'Local deterministic fixture', provider: 'openai', contextWindow: 128000, supportsStreaming: true };

  useEffect(() => {
    let live = true;
    const originalHarnessState = useAiHarnessStore.getState();
    const fixtureRoot = new FixtureDirectory('agent-fixture');
    fixtureRoot.add(new FixtureFile('conversation-a.md', '# Conversation A\n\nThe measured marker is ALPHA_SOURCE_731.'));
    fixtureRoot.add(new FixtureFile('conversation-b.md', '# Conversation B\n\nUnrelated marker is BETA_SOURCE_482.'));
    const notes = fixtureRoot.add(new FixtureDirectory('notes'));
    for (let i = 0; i < 12; i++) notes.add(new FixtureDirectory(`topic-${i}`)).add(new FixtureFile('same.md', `# Topic ${i}\n\nThe verified fixture passage for topic ${i} gives measurement coefficient ${i + 1}. It is supplied from this exact source.\n\n$$E_{${i}} = (${i + 1}) x^2$$\n`));
    notes.add(new FixtureFile('code.py', '# Actual fixture source\nvalue = 13\n', 'text/plain'));
    notes.add(new FixtureFile('analysis.ipynb', JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ id: 'cell-1', cell_type: 'markdown', metadata: {}, source: ['Notebook fixture is actually read.'] }] }), 'application/json'));
    const collection = fixtureRoot.add(new FixtureDirectory('collection-101'));
    for (let index = 0; index < 101; index++) collection.add(new FixtureDirectory(`topic-${String(index).padStart(3, '0')}`))
      .add(new FixtureFile('paper.md', `# Synthetic paper ${index}\n\nSource marker D${String(index).padStart(3, '0')}. This synthetic paper reports coefficient ${index + 1}, and belongs to this exact authorized directory file.\n\n$$E_{${index}} = ${index + 1}x^2$$`));
    const provider: AiProvider = {
      id: 'openai', name: 'Explicit isolated fixture', isConfigured: () => true,
      getAvailableModels: async () => [model], testConnection: async () => ({ ok: true, message: 'fixture only' }), estimateTokens: text => Math.ceil(text.length / 3),
      async generate(messages, options) {
        options?.signal?.throwIfAborted();
        const system = getMessageText(messages[0]?.content ?? '');
        const user = getMessageText(messages.at(-1)?.content ?? '');
        const original = user.match(/^User request:\n([\s\S]*?)(?:\n\nAvailable authorized|\n\nUse the supplied context|$)/)?.[1] ?? user;
        const kind = system.includes('Summarize ALL supplied research notes') ? 'directory-reduction' : system.includes('[long-input:') ? 'long-input' : user.startsWith('{') ? 'document-batch' : 'answer';
        const latestUser = useAiChatStore.getState().getActiveConversation()?.messages.filter(message => message.role === 'user').at(-1)?.content ?? '';
        if (live) setRequests(previous => [...previous, { characters: original.length, history: messages.filter(message => message.role === 'assistant').length, kind,
          originalCharacters: latestUser.length, originalIncluded: Boolean(latestUser && user.includes(latestUser)), markers: ['ALPHA_SOURCE_731', 'BETA_SOURCE_482'].filter(marker => (system + user).includes(marker)) }]);
        if (system.includes('Prepare the complete final UTF-8 text')) return { model: model.id, text: '# PDF 子文件\n\n实际 fixture 阅读提案。\n\n| 参数 | 值 |\n|---|---|\n| E | 1 |\n\n$$E=x^2$$\n\n```py\nprint(1)\n```' };
        if (system.includes('[long-input:batch]') || system.includes('[long-input:merge]')) return { model: model.id, text: '实际分批摘要：用户要求读取全文并保持公式与代码，fixture 原文已按所示范围提交。' };
        let payload: { units?: Array<{ id: string; passages: Array<{ passageId?: string; text: string }> }>; nodes?: Array<{ summary: string; batches: number }> } | null = null;
        try { payload = JSON.parse(user); } catch { /* Ordinary chat has a text request. */ }
        if (kind === 'directory-reduction' && payload?.nodes) {
          const markers = [...new Set(payload.nodes.flatMap(node => node.summary.match(/\bD\d{3}\b/gu) ?? []))].sort();
          return { model: model.id, text: JSON.stringify({ summary: `Synthetic directory reduction; ${payload.nodes.reduce((sum, node) => sum + node.batches, 0)} input batches. Markers: ${markers.join(' ')}.` }) };
        }
        if (payload?.units) {
          const markers = [...new Set(payload.units.flatMap(unit => unit.passages.flatMap(passage => passage.text.match(/\bD\d{3}\b/gu) ?? [])))];
          return { model: model.id, text: JSON.stringify({ summary: `实际读取 ${payload.units.length} 个 fixture 片段。 ${markers.join(' ')}`, findings: payload.units.flatMap(unit => unit.passages.filter(passage => passage.passageId).slice(0, 1).map(passage => ({ sourceId: unit.id, passageId: passage.passageId, reason: 'Actual supplied fixture measurement passage.', importance: 1 }))).slice(0, 8) }) };
        }
        if (system.includes('planning module') || user.includes('You are planning a Lattice Research Agent run')) return { model: model.id, text: JSON.stringify({ steps: [{ id: 'context-pack', title: '读取真实 fixture 上下文', description: 'Collect actual authorized source' }, { id: 'synthesize-answer', title: '返回回答', description: 'Synthesize from supplied evidence' }] }) };
        const citations = Array.from((messages.map(message => getMessageText(message.content)).join('\n')).matchAll(/\]\((citation:citation-v2-[a-z0-9-]+)\)(?:[^\n]*passage anchor available)/g)).slice(0, 4).map(match => `[来源](${match[1]})`);
        return { model: model.id, text: `# Fixture 回答\n\n已使用实际提供的范围。${citations.join(' ')}\n\n| 项 | 内容 |\n|---|---|\n| Markdown | 完整复制 |\n\n$$E=mc^2$$\n\n\`\`\`ts\nconst verified = true;\n\`\`\`\n\n${kind === 'long-input' ? '分批全文处理完成。' : '实际请求历史保留在运行记录中。'}` };
      },
      async *stream(messages, options) { const result = await provider.generate(messages, options); yield { type: 'text', text: result.text }; yield { type: 'done' }; },
    };
    useAiProviderProfileStore.setState({ profiles: [], activeProfileId: null, isInitialized: true, isLoading: false, error: null });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, aiEnabled: true, aiProvider: 'openai', aiModel: model.id, aiStreamingEnabled: true }, isInitialized: true, isLoading: false, error: null });
    useWorkspaceStore.setState({ rootHandle: fixtureRoot.handle(), workspaceRootHandle: fixtureRoot.handle(), workspaceRootPath: 'C:/Lattice-isolated-fixture', workspaceIdentity: { workspaceKey: 'agent-fixture' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'], fileTree: { root: tree(fixtureRoot) }, layout: { activePaneId: 'fixture-pane', root: { type: 'pane', id: 'fixture-pane', tabs: [], activeTabIndex: -1 } } });
    setProviderOverride('openai', provider);
    useAiHarnessStore.getState().setConfig({ engine: 'api' });
    void (async () => {
      const { PDFDocument, StandardFonts } = await import('pdf-lib');
      const pdf = await PDFDocument.create(); pdf.setCreationDate(new Date('2020-01-01')); pdf.setModificationDate(new Date('2020-01-01'));
      const font = await pdf.embedFont(StandardFonts.Helvetica); pdf.addPage().drawText('Actual isolated PDF fixture. Energy is E = x squared.', { x: 50, y: 700, font });
      fixtureRoot.add(new FixtureFile('paper.pdf', new Uint8Array(await pdf.save()).buffer, 'application/pdf'));
      if (!live) return;
      useWorkspaceStore.setState({ fileTree: { root: tree(fixtureRoot) } });
      await useAiChatStore.getState().loadConversations();
      await useAgentSessionStore.getState().loadSessions();
      useAiChatStore.getState().setOpen(true);
      setRoot(fixtureRoot); setReady(true);
    })().catch(error => setNotice(String(error)));
    return () => { live = false; clearProviderOverrides(); harnessUnsubscribe.current?.(); useAiHarnessStore.setState(originalHarnessState, true); };
    // The fixture runtime belongs to this diagnostic mount, never to a user workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createHistory = useCallback(async () => {
    const chat = useAiChatStore.getState(); chat.clearAllHistory();
    useAiWorkbenchStore.setState({ drafts: [], proposals: [], highlightedProposalId: null });
    chat.newConversation(); chat.addUserMessage('第一历史问题'); let id = chat.startAssistantMessage(); chat.finishAssistantMessage(id, '# 第一回答');
    chat.newConversation(); chat.addUserMessage('第二历史问题'); id = chat.startAssistantMessage(); chat.finishAssistantMessage(id, '# 第二回答\n\n```py\nx=2\n```');
    await chat.flushConversations(); setNotice('两个历史对话已落盘，当前为第二对话。');
  }, []);

  const createLargeStorageFixture = async () => {
    setLargeStorageNotice('saving');
    try {
      const store = useAgentSessionStore.getState();
      const sessionId = 'synthetic-large-storage-fixture';
      if (!store.getSession(sessionId)) store.createSession({ id: sessionId, profile: 'research', task: 'Synthetic storage-only checkpoint; no source/model request was performed.' });
      const units = Array.from({ length: 3200 }, (_, index) => index + 1);
      const checkpoint = { version: 1 as const, queryKey: '["Synthetic storage only","No model request"]',
        sources: [{ path: 'synthetic-storage-only.md', version: 'synthetic-version', totalUnits: units.length, completedUnits: units, offsets: {} }],
        coverage: [{ path: 'synthetic-storage-only.md', kind: 'markdown' as const, unitLabel: 'section' as const, totalUnits: units.length,
          readUnits: units, pendingUnits: [], emptyUnits: [], unreadableUnits: [] }],
        summaries: units.map(unit => `SYNTHETIC_STORAGE_ONLY_BATCH_${String(unit).padStart(4, '0')}: `.padEnd(1024, 's')),
        findings: [], completedBatches: units.length };
      if (['queued', 'running', 'waiting_approval'].includes(store.getSession(sessionId)!.status)) {
        store.cancelSession(sessionId, 'Synthetic checkpoint storage acceptance only.');
      }
      await store.saveDocumentResearch(sessionId, { checkpoint, status: 'paused', workspaceKey: 'agent-fixture', directory: {
        version: 2, workspaceKey: 'agent-fixture', selections: [{ kind: 'folder', path: 'synthetic-storage-only' }],
        task: 'Synthetic storage-only checkpoint', query: 'No model request', calls: 0, phase: 'paused', reductions: [], removedPaths: [],
        files: [{ path: 'synthetic-storage-only.md', size: 1, lastModified: 1, status: 'complete', checkpoint,
          snapshot: { workspaceKey: 'agent-fixture', path: 'synthetic-storage-only.md', sourceId: 'synthetic-storage-only', version: 'synthetic-version',
            kind: 'markdown', unitLabel: 'section', totalUnits: units.length } }],
      } });
      setLargeStorageNotice('saved');
    } catch (error) { setLargeStorageNotice(`error:${error instanceof Error ? `${error.name}:${error.message}` : String(error)}`); }
  };

  const showDisplayOnlyModelFixture = () => {
    // Used only after response acceptance for selector geometry. The endpoint
    // is loopback and no credential is present; this is not a real provider.
    useAiProviderProfileStore.setState({ activeProfileId: 'display-only-fixture', profiles: [{
      id: 'display-only-fixture', name: 'Offline test API', provider: 'openai', protocol: 'openai-chat-completions', channel: 'custom',
      baseUrl: 'http://127.0.0.1/never-requested-display-fixture', model: model.id, defaultModelId: model.id,
      models: [{ id: model.id, name: 'Local fixture (offline)', contextWindow: 128000, maxOutputTokens: 4096, enabled: true, supportsStreaming: true }],
      enabled: true, isDefault: true, authMode: 'none', timeoutMs: 1000, maxRetries: 0, customHeaders: {},
      privacy: { sendCurrentFile: true, sendAnnotations: true, sendChatHistory: true, sendWorkspaceIndex: true },
    }] });
  };

  const attachPdf = async () => {
    if (!root) return;
    const file = await root.getFileHandle('paper.pdf');
    useWorkspaceStore.setState({ layout: { activePaneId: 'fixture-pane', root: { type: 'pane', id: 'fixture-pane', tabs: [{ id: 'fixture-pdf', kind: 'file', fileName: 'paper.pdf', filePath: 'paper.pdf', fileHandle: file as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }], activeTabIndex: 0 } } });
    useAiChatStore.getState().setComposerDraft({ text: '在当前 PDF 下创建 note.md 子文件，内容包含讲解、表格、公式和代码', mode: 'chat' });
  };

  const installHarnessFixture = async () => {
    let sequence = 0;
    let conversationId = '';
    let queue: HarnessEvent[] = [];
    const event = (kind: HarnessEvent['kind'], extra: Partial<HarnessEvent> = {}): HarnessEvent => ({ kind, connectionId: 'fixture-connection', conversationId, sessionId: 'fixture-session', turnId: 'fixture-turn', sequence: ++sequence, timestamp: Date.now(), ...extra });
    const scratchContent = '# 实际隔离 fixture 草稿\n\n$$E=x^2$$\n\n| 项 | 值 |\n|---|---|\n|x|1|';
    const finish = () => { queue.push(event('file-change', { itemId: 'fixture-scratch', scratchPaths: ['C:/Lattice-isolated-fixture/scratch/fixture-output.md'] }), event('message', { text: '# Harness fixture 回答\n\nPDF 子文件已生成审查草稿，尚未写入正式工作区。' }), event('completed')); };
    const transport: HarnessTransport = {
      probe: async () => ({ engine: 'codex', executable: 'Explicit fixture', version: 'official-protocol-fixture', installed: true, supported: true, reason: '隔离 fixture，未运行真实 Codex 推理', protocol: 'codex-app-server-jsonl', capabilities: { resume: true, interrupt: true, approvals: true, workspaceRead: true, scratchWrite: true } }),
      connect: async request => { conversationId = request.conversationId; return { connectionId: 'fixture-connection', conversationId, engine: 'codex', workspace: request.workspace, scratchPath: 'C:/Lattice-isolated-fixture/scratch', permissionProfile: 'explicit-fixture', probe: await transport.probe('codex') }; },
      start: async () => ({ connectionId: 'fixture-connection', conversationId, sessionId: 'fixture-session' }),
      resume: async () => ({ connectionId: 'fixture-connection', conversationId, sessionId: 'fixture-session' }),
      turn: async () => { queue.push(event('started'), event('tool-call', { toolCall: { requestId: 'fixture-read-request', callId: 'fixture-read-call', tool: 'lattice_sources_read', arguments: { path: 'paper.pdf', maxChars: 4000, maxUnits: 1 } } })); return { connectionId: 'fixture-connection', conversationId, sessionId: 'fixture-session', turnId: 'fixture-turn' }; },
      toolResult: async result => {
        if (!result.success) queue.push(event('error', { text: result.text }));
        else if (result.requestId === 'fixture-read-request') queue.push(event('tool-call', { toolCall: { requestId: 'fixture-pdf-request', callId: 'fixture-pdf-call', tool: 'lattice_pdf_proposeChild', arguments: { parentPath: 'paper.pdf', fileName: 'harness-note.md', content: '# Harness 技能子文件\n\n原文已由 lattice.sources.read 实际读取。\n\n```py\nprint(2)\n```\n\n$$E=x^2$$', mode: 'create' } } }));
        else finish();
      },
      readScratch: async (_connectionId, path) => {
        if (path !== 'C:/Lattice-isolated-fixture/scratch/fixture-output.md') throw new Error('Unknown fixture scratch.');
        return { path, fileName: 'fixture-output.md', content: scratchContent, byteLength: new TextEncoder().encode(scratchContent).length, revision: 'explicit-browser-fixture' };
      },
      interrupt: async () => { queue = [event('interrupted')]; },
      approval: async () => {},
      drainEvents: async () => { const events = queue; queue = []; return events; },
      disconnect: async () => { queue = []; },
    };
    const fixtureStorage = getStorageAdapter();
    const fixture = createAiHarnessStore({ transport, storage: {
      get: key => fixtureStorage.get('agent-context-fixture:' + key),
      set: (key, value) => fixtureStorage.set('agent-context-fixture:' + key, value),
      remove: key => fixtureStorage.remove('agent-context-fixture:' + key),
      clear: async () => {},
    }, pollMs: 10 });
    await fixture.getState().hydrate();
    fixture.getState().setConfig({ engine: 'codex' });
    harnessUnsubscribe.current?.();
    harnessUnsubscribe.current = fixture.subscribe(state => useAiHarnessStore.setState(state, true));
    useAiHarnessStore.setState(fixture.getState(), true);
    useAiChatStore.getState().setComposerDraft({ text: '使用 Lattice PDF 子文件技能为 paper.pdf 创建 Markdown 子笔记，然后等待审查', mode: 'agent' });
    setNotice('明确的官方协议 fixture：动态工具请求将经过真实 Lattice PDF broker → Review；真实外部推理为 0。');
  };

  const inspectFiles = async () => {
    if (!root) return;
    const files: Array<{ path: string; text: string }> = [];
    const walk = async (directory: FixtureDirectory, path: string) => {
      for (const entry of directory.entries.values()) {
        const next = path + '/' + entry.name;
        if (entry.kind === 'directory') await walk(entry, next);
        else if (!/\.pdf$/i.test(entry.name) && files.length < 40) files.push({ path: next, text: (await (await entry.getFile()).text()).slice(0, 1000) });
      }
    };
    const items = root.entries.get('.lattice');
    if (items?.kind === 'directory') await walk(items, '.lattice');
    const drafts = root.entries.get('AI Drafts');
    if (drafts?.kind === 'directory') await walk(drafts, 'AI Drafts');
    const workspace = useWorkspaceStore.getState();
    const pdf = workspace.fileTree?.root?.children.find(node => /\.pdf$/i.test(node.name));
    setFileEvidence(JSON.stringify({ files, activePath: workspace.getActiveTab()?.filePath, pdfChildren: pdf?.children?.map(node => ({ path: node.path, parentPdfPath: node.kind === 'file' ? node.parentPdfPath : undefined })), drafts: useAiWorkbenchStore.getState().drafts.map(draft => ({ status: draft.status, target: draft.targetPath })) }, null, 2));
  };

  const renamePdf = async () => {
    if (!root) return;
    const pdf = root.renameFile('paper.pdf', 'renamed.pdf');
    await movePdfItemWorkspace(root.handle(), 'paper.pdf', 'renamed.pdf');
    useWorkspaceStore.setState({ fileTree: { root: tree(root) } });
    await hydratePdfVirtualChildren(root.name + '/renamed.pdf', { force: true, expand: true });
    useWorkspaceStore.getState().openFileInPane('fixture-pane', pdf as unknown as FileSystemFileHandle, root.name + '/renamed.pdf');
    setNotice('父 PDF 已在隔离 fixture 改名；通过生产 manifest 服务保留同一子文件工作区。');
  };

  return <div className="flex h-screen min-h-0 flex-col bg-background text-foreground" data-testid={ready ? 'agent-context-harness-ready' : 'agent-context-harness-loading'}>
    <header className="space-y-2 border-b border-border p-3 text-xs">
      <h1 className="font-medium">Agent 上下文与 Harness 隔离验收</h1><p>{notice}</p>
      <div className="flex flex-wrap gap-2">
        {['conversation-a.md', 'conversation-b.md'].map(name => <button key={name} className="rounded border px-2 py-1" data-testid={`fixture-open-${name}`} onClick={() => void (async () => {
          const file = await root?.getFileHandle(name); if (!file) return;
          useWorkspaceStore.getState().openFileInPane('fixture-pane', file as unknown as FileSystemFileHandle, name);
        })()}>{name}</button>)}
        <button className="rounded border px-2 py-1" data-testid="fixture-two-history" onClick={() => void createHistory()}>创建两段历史</button>
        <button className="rounded border px-2 py-1" data-testid="fixture-toggle-panel" onClick={() => useAiChatStore.getState().setOpen(!isOpen)}>{isOpen ? '关闭面板' : '重开面板'}</button>
        <button className="rounded border px-2 py-1" data-testid="fixture-folder" onClick={() => useAiChatStore.getState().setComposerDraft({ text: '读取并综合 @folder:notes 中所有文件的测量系数和公式，引用实际来源', mode: 'chat' })}>嵌套目录 14 文件</button>
        <button className="rounded border px-2 py-1" data-testid="fixture-folder-101" onClick={() => useAiChatStore.getState().setComposerDraft({ text: '阅读 @folder:collection-101 中全部文章并综合讲述测量系数和公式，引用实际来源，对话内回复', mode: 'agent' })}>目录 101 文件完整阅读</button>
        <button className="rounded border px-2 py-1" data-testid="fixture-language-en" onClick={() => setLocale('en-US')}>English UI</button>
        <button className="rounded border px-2 py-1" data-testid="fixture-language-zh" onClick={() => setLocale('zh-CN')}>中文界面</button>
        <button className="rounded border px-2 py-1" data-testid="fixture-large-storage" onClick={() => void createLargeStorageFixture()}>合成 6MB 检查点存储</button>
        <button className="rounded border px-2 py-1" data-testid="fixture-model-display" onClick={showDisplayOnlyModelFixture}>离线模型选择器展示</button>
        <button className="rounded border px-2 py-1" data-testid="fixture-pdf-child" onClick={() => void attachPdf()}>PDF 子文件审查</button>
        <button className="rounded border px-2 py-1" data-testid="fixture-harness-pdf" onClick={() => void installHarnessFixture()}>Harness PDF 工具桥</button>
        <button className="rounded border px-2 py-1" data-testid="fixture-inspect-files" onClick={() => void inspectFiles()}>回读子文件与树</button>
        <button className="rounded border px-2 py-1" data-testid="fixture-rename-pdf" onClick={() => void renamePdf()}>改名并重开 PDF</button>
        <button className="rounded border px-2 py-1" data-testid="fixture-change-source" onClick={() => { const folder = root?.entries.get('notes'); if (folder?.kind === 'directory') { const topic = folder.entries.get('topic-0'); if (topic?.kind === 'directory') { const file = topic.entries.get('same.md'); if (file?.kind === 'file') file.replaceContent('# Modified source\n\nChanged after the original verified reading.'); } } }}>修改源</button>
        <button className="rounded border px-2 py-1" data-testid="fixture-revoke" onClick={() => root?.revokePermission()}>撤销读取权限</button>
      </div>
      <output data-testid="fixture-active-id">{activeId}</output> · <output data-testid="fixture-draft-length">{activeDraftLength}</output> 字符 · <output data-testid="fixture-provider-request-count">{requests.length}</output> fixture 请求 · <output data-testid="fixture-last-input-length">{requests.at(-1)?.characters ?? 0}</output>
      <details><summary>实际 fixture 请求边界</summary><pre data-testid="fixture-requests">{JSON.stringify(requests)}</pre></details>
      <details><summary>目录任务只读账本</summary><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all" data-testid="fixture-directory-ledger">{JSON.stringify(directory ? {
        sessionId: directorySession?.id, status: directorySession?.status, readingStatus: directorySession?.documentResearch?.status,
        phase: directory.phase, workspaceKey: directory.workspaceKey, selections: directory.selections, calls: directory.calls,
        discoveryComplete: directory.manifest?.complete, reductions: directory.reductions.map(node => ({ id: node.id, batches: node.batches, summary: node.summary })),
        files: directory.files.map(file => ({ path: file.path, status: file.status, version: file.snapshot?.version, batches: file.checkpoint?.completedBatches,
          readUnits: file.checkpoint?.coverage.reduce((sum, entry) => sum + entry.readUnits.length, 0), summaries: file.checkpoint?.summaries })),
      } : null)}</pre></details>
      <output data-testid="fixture-latest-answer">{latestAnswer?.content.length ?? 0}</output>
      <output data-testid="fixture-large-storage-state">{JSON.stringify({ status: largeStorageNotice, present: Boolean(largeStorageSession),
        summaries: largeStorageSession?.documentResearch?.checkpoint.summaries.length ?? 0,
        first: largeStorageSession?.documentResearch?.checkpoint.summaries[0]?.slice(0, 40),
        last: largeStorageSession?.documentResearch?.checkpoint.summaries.at(-1)?.slice(0, 40) })}</output>
      {fileEvidence && <details open><summary>真实子文件回读与树</summary><pre className="max-h-40 overflow-auto" data-testid="fixture-file-evidence">{fileEvidence}</pre></details>}
    </header>
    <main className="min-h-0 flex-1">{ready && isOpen ? <AiChatPanel loadPersistedState={false} /> : <p className="p-4 text-xs">{ready ? '面板已关闭，草稿和历史保留。' : '正在建立隔离资源…'}</p>}</main>
  </div>;
}
