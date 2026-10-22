// @vitest-environment node

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build, type Plugin } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { AiMessage } from '@/lib/ai/types';
import type { ChatConversation } from '@/stores/ai-chat-store';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// Browser plugin not available: regular Playwright validates native IndexedDB and
// the actual ChatPanel/Composer/Timeline/stores. Only model I/O and unused UI leaves
// are replaced in this test bundle. No real API or native assistant is invoked.
const require = createRequire(import.meta.url);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const TEXT = '附件实验记录：样品温度从二十摄氏度升至三十摄氏度，测试信号随温度变化。研究者在固定光强下重复测量三次，结果用于比较实验条件。';
const SCREENSHOT_DIR = path.join(tmpdir(), 'lattice-composer-attachment-qa');

interface CapturedApiCall { stage: string; messages: AiMessage[]; body: { messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }> }; text: string }
interface FixtureState {
  activeConversationId: string | null;
  conversation: ChatConversation | null;
  attachments: import('@/lib/ai/chat-attachments').ChatAttachmentRef[];
  calls: CapturedApiCall[];
  harnessCalls: Array<{ conversationId: string; text: string; images?: Array<{ data: string; mimeType: string }>; workspace: string; beforeTurnChecked: boolean; imageOnlyToolDenied: boolean }>;
  sessions: Array<{ id: string; documentResearch?: { status: string; directory?: import('@/lib/ai/directory-research').DirectoryResearchCheckpoint; checkpoint: { coverage: Array<{ readUnits: number[]; unreadableUnits: unknown[]; pendingUnits: number[] }> } } }>;
  workspace: { root: boolean; path: string | null };
  busy: boolean;
  errors: string[];
  fileReads: Record<string, number>;
}
interface BrowserFixture { fixture: { snapshot(): FixtureState; openMentionWorkspace(): void; openScreenshotWorkspace(bytes: number[], mode: 'chat' | 'agent'): void; openCloudDirectory(): void; focusUnrelatedCloudFile(): void; openPdf(bytes: number[], mode: 'chat' | 'agent'): void; focusNote(): void; prepareContinuation(status: 'verified' | 'unverified'): void }; ready: boolean }

const providerSource = String.raw`
  import { buildProtocolRequest } from '@/lib/ai/protocol-adapters';
  import { getMessageText } from '@/lib/ai/types';
  import { createDefaultAiProviderProfile } from '@/lib/ai/provider-profiles';
  const profile = createDefaultAiProviderProfile('custom-openai-compatible', { id: 'browser-fixture', model: 'fixture-vision', baseUrl: 'https://never-called.invalid/v1' });
  const answer = '已读取上传附件中的实验记录。样品在固定光强下经历不同温度条件，因此信号变化可以用于比较测量条件；重复测量提供了观察一致性的依据。这里的解释来自真实上传文本，不代表完成了新的实验，也不把图片当作伪造的OCR文本。当前材料只能支持记录中明确给出的条件，无法证明温度是唯一影响因素。若需要进一步判断因果关系，应补充仪器校准、误差范围和其他控制变量。对同一会话的追问继续使用这些附件，不依赖当前编辑器是否打开工作区。';
  async function generate(messages, options = {}) {
    options.signal?.throwIfAborted();
    const text = messages.map(message => getMessageText(message.content)).join('\n');
    const first = getMessageText(messages[0]?.content ?? '');
    const stage = first.includes('Read the supplied document fragments') ? 'document-batch'
      : first.includes('Summarize ALL supplied research notes') ? 'directory-reduction'
      : text.includes('You are planning a Lattice Research Agent run.') ? 'planning' : 'answer';
    const body = JSON.parse(buildProtocolRequest('openai-chat-completions', profile, '', messages, options).init.body);
    (window.__fixtureCalls ??= []).push({ stage, messages: structuredClone(messages), body, text });
    // A bounded delay makes pending/generating transitions observable in a real browser.
    await new Promise(resolve => setTimeout(resolve, 20));
    options.signal?.throwIfAborted();
    let output = answer;
    if (stage === 'planning') output = JSON.stringify({ steps: [
      { id: 'context-pack', title: '确认输入', description: '使用授权附件。' },
      { id: 'evidence-resolve', title: '读取原文', description: '核对附件原文。', toolName: 'evidence.resolve' },
      { id: 'synthesize-answer', title: '回答问题', description: '根据证据回答。' },
    ] });
    if (stage === 'document-batch') {
      const payload = JSON.parse(getMessageText(messages.findLast(message => message.role === 'user').content));
      const findings = payload.units.flatMap(unit => {
        const passage = unit.passages.find(passage => passage.passageId && passage.text.trim().length >= 8 && passage.text.length <= 600);
        return passage ? [{ sourceId: unit.id, passageId: passage.passageId, reason: '上传原文中的实验条件', importance: 2 }] : [];
      }).slice(0, 8);
      output = JSON.stringify({ summary: '原文记录了固定光强下不同温度条件与重复测量。', findings });
    }
    if (stage === 'directory-reduction') output = JSON.stringify({ summary: '每条合成云论文的测量系数均保留在子摘要，所有输入均已覆盖。' });
    if (window.__workspacePaper) {
      const sourcePath = window.__workspacePaper;
      if (stage === 'planning') output = JSON.stringify({ steps: [
        { id: 'context-pack', title: '确认来源', description: '使用本次授权文件。' },
        ...(text.includes(sourcePath) ? [{ id: 'read-source', title: '读取相关页面', description: '读取活动 PDF 的第一页面。', toolName: 'lattice.sources.read', toolArgs: { path: sourcePath, units: [1], maxChars: 4000, maxUnits: 1 } }] : []),
        { id: 'evidence-resolve', title: '核实证据', description: '保留真实页码。', toolName: 'evidence.resolve' },
        { id: 'synthesize-answer', title: '解释概念', description: '仅根据已读取证据解释。' },
      ] });
      else if (stage === 'answer') {
        const citationId = text.match(/\[p\.1\]\((citation:[^)]+)\)/)?.[1]?.split('?')[0];
        const quote = text.match(/GHZ_SOURCE_SENTINEL: Z2-ordered GHZ states coherently superpose two alternating spin configurations\./)?.[0];
        const citation = citationId && quote ? citationId + '?quote=' + encodeURIComponent(quote) : undefined;
        output = text.includes('GHZ_SOURCE_SENTINEL')
          ? 'Z2有序 GHZ 态将两种交替排列构型相干叠加。GHZ_SOURCE_SENTINEL 是当前 PDF 的实际证据。' + (citation ? '[p.1](' + citation + ')' : '')
          : '这是独立问题，当前请求未提供论文正文。';
      }
    }
    return { text: output, finishReason: 'stop', model: 'fixture-vision' };
  }
  const provider = { id: 'custom', name: 'Browser fixture', isConfigured: () => true, generate,
    async *stream(messages, options) { const result = await generate(messages, options); yield { type: 'text', text: result.text }; yield { type: 'done' }; },
    estimateTokens: text => Math.ceil(text.length / 2), getAvailableModels: async () => [], testConnection: async () => ({ ok: true }) };
  export function routeModel(taskType, settings) { return { provider,
    modelInfo: { providerId: 'custom', providerName: 'Browser fixture', model: 'fixture-vision', source: 'cloud' },
    policy: { taskType, maxContextTokens: 18000, evidenceRequired: true, preferredProvider: null, fallbackProvider: null } }; }
`;

const fixtureSource = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { AiChatPanel } from './src/components/ai/ai-chat-panel';
  import { useAiChatStore } from './src/stores/ai-chat-store';
  import { useAiAttachmentStore } from './src/stores/ai-attachment-store';
  import { useAiHarnessStore } from './src/stores/ai-harness-store';
  import { useAiProviderProfileStore } from './src/stores/ai-provider-profile-store';
  import { useWorkspaceStore } from './src/stores/workspace-store';
  import { useSettingsStore } from './src/stores/settings-store';
  import { useAgentSessionStore } from './src/stores/agent-session-store';
  import { DEFAULT_SETTINGS } from './src/types/settings';
  import { createDefaultAiProviderProfile } from './src/lib/ai/provider-profiles';
  import { SourceTestDirectory, SourceTestFile } from './src/lib/ai/__tests__/fixtures/source-workspace';
  import { setCloudWorkspaceProvider, setCloudWorkspaceResource, setCloudWorkspaceActive } from './src/lib/cloud-workspace-host';
  window.__fixtureCalls = []; window.__harnessCalls = []; window.__fixtureErrors = []; window.__fileReads = {};
  const profile = createDefaultAiProviderProfile('custom-openai-compatible', { id: 'browser-fixture', model: 'fixture-vision', baseUrl: 'https://never-called.invalid/v1' });
  profile.models = [{ id: 'fixture-vision', name: 'Test vision', contextWindow: 128000, maxOutputTokens: 8192, enabled: true }];
  useAiProviderProfileStore.setState({ profiles: [profile], activeProfileId: profile.id, isLoading: false, isInitialized: true, error: null });
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, aiEnabled: true, aiProvider: 'custom', aiModel: 'fixture-vision', aiStreamingEnabled: false, aiAgentOmittedSummaryEnabled: false }, isInitialized: true, isLoading: false, error: null });
  useWorkspaceStore.setState({ rootHandle: null, workspaceRootPath: null, workspaceIdentity: null,
    layout: { activePaneId: 'fixture-pane', root: { type: 'pane', id: 'fixture-pane', tabs: [], activeTabIndex: -1 } } });
  useAiChatStore.setState({ conversations: [], activeConversationId: null, isOpen: true, hasHydratedConversations: true,
    isGenerating: false, activeAssistantMessageId: null, abortController: null, composerMode: 'chat', composerDraft: null,
    selectedResearchWorkflowId: null, persistenceError: null, hydrationError: null });
  useAiHarnessStore.setState({ config: { engine: 'api' }, isHydrated: true, connections: {}, sessions: {},
    async sendTurn(options) {
      await options.onBeforeTurn?.();
      let imageOnlyToolDenied = false;
      if (!options.text.includes('Documents referenced') && options.onToolCall) {
        const result = await options.onToolCall({ tool: 'lattice_sources_active', arguments: {}, requestId: 'fixture-request', callId: 'fixture-call' });
        imageOnlyToolDenied = result.success === false && result.text.includes('图像');
      }
      window.__harnessCalls.push({ conversationId: options.conversationId, text: options.text, workspace: options.workspace,
        images: structuredClone(options.images), beforeTurnChecked: true, imageOnlyToolDenied });
      return 'Codex 测试替身收到了真实图片；本测试未调用本机模型。';
    },
  });
  window.fixture = {
    openCloudDirectory() {
      const folder = { id: 'lattice-cloud:synthetic-browser:cloud-library:folder', libraryId: 'cloud-library', itemId: 'folder',
        versionId: 'folder-v1', name: 'Cloud research', kind: 'folder', path: 'cloud://folder', role: 'viewer', content: null };
      const items = Array.from({ length: 101 }, (_, index) => ({ id: 'paper-' + String(index).padStart(3, '0'), libraryId: 'cloud-library',
        canonicalName: 'paper-' + String(index).padStart(3, '0') + '.md', kind: 'markdown', status: 'active', title: 'Synthetic cloud paper ' + index,
        currentVersionId: 'v-' + index, metadata: { parentItemId: 'folder', sizeBytes: 150 }, updatedAt: '2026-10-22T00:00:00.000Z', createdAt: '2026-10-22T00:00:00.000Z', createdBy: 'synthetic' }));
      const resource = item => ({ ...folder, id: 'lattice-cloud:synthetic-browser:cloud-library:' + item.id, itemId: item.id,
        name: item.canonicalName, kind: item.kind, versionId: item.currentVersionId,
        content: { kind: 'text', text: 'CLOUD_BROWSER_PAPER_' + item.id + ' reports synthetic measurement coefficient ' + item.id.slice(-3) + '. Repeated measurements use constant illumination.', mimeType: 'text/markdown', updatedAt: item.updatedAt } });
      const provider = { scope: 'synthetic-browser-account', async read(libraryId, itemId, signal) {
        signal?.throwIfAborted();
        if (libraryId !== 'cloud-library') throw new Error('Wrong synthetic cloud library');
        window.__fileReads[itemId] = (window.__fileReads[itemId] ?? 0) + 1;
        if (itemId === 'folder') return folder;
        if (itemId === 'unrelated') return { ...folder, id: 'lattice-cloud:synthetic-browser:cloud-library:unrelated', itemId, kind: 'markdown', name: 'unrelated.md',
          content: { kind: 'text', text: 'CLOUD_UNRELATED_MUST_NOT_READ', mimeType: 'text/markdown', updatedAt: '2026-10-22T00:00:00.000Z' } };
        const item = items.find(item => item.id === itemId); if (!item) throw new Error('Missing synthetic cloud item'); return resource(item);
      }, async list(libraryId, parentItemId, signal) { signal?.throwIfAborted(); if (libraryId !== 'cloud-library') throw new Error('Wrong library'); return parentItemId === 'folder' ? structuredClone(items) : []; },
        async search() { return { results: [] }; }, async save() { throw new Error('Read-only synthetic provider'); } };
      window.__cloudFixtureProvider = provider;
      setCloudWorkspaceProvider(provider); setCloudWorkspaceResource(folder); setCloudWorkspaceActive(true);
      useAiChatStore.getState().setComposerMode('agent');
    },
    focusUnrelatedCloudFile() {
      const provider = window.__cloudFixtureProvider;
      setCloudWorkspaceResource({ id: 'lattice-cloud:synthetic-browser:cloud-library:unrelated', libraryId: 'cloud-library', itemId: 'unrelated',
        versionId: 'v-unrelated', name: 'unrelated.md', kind: 'markdown', path: 'cloud://unrelated', role: 'viewer', content: null });
    },
    openMentionWorkspace() {
      const root = new SourceTestDirectory('workspace');
      root.add(new SourceTestDirectory('Theoretical Research')).add(new SourceTestDirectory('gates'))
        .add(new SourceTestFile('plain@100%.txt', 'Synthetic experimental record. Three repeated measurements were made at fixed intensity and different temperatures.'));
      useWorkspaceStore.setState({ rootHandle: root.handle() });
    },
    openScreenshotWorkspace(bytes, mode) {
      const root = new SourceTestDirectory('atom');
      Object.assign(root, { fullPath: 'C:/synthetic/atom' });
      const gates = root.add(new SourceTestDirectory('Theoretical Research')).add(new SourceTestDirectory('taiyi'))
        .add(new SourceTestDirectory('essay')).add(new SourceTestDirectory('06_fast_long_range_and_native_gates'));
      const prefix = 'Theoretical Research/taiyi/essay/06_fast_long_range_and_native_gates/';
      const pdf = gates.add(new SourceTestFile('01_synthetic_gate.pdf', ''));
      pdf.getFile = async () => { window.__fileReads[prefix + pdf.name] = (window.__fileReads[prefix + pdf.name] ?? 0) + 1;
        return new File([new Uint8Array(bytes)], pdf.name, { type: 'application/pdf', lastModified: 1 }); };
      gates.add(new SourceTestFile('02_lab_notes.md', 'SCREENSHOT_SELECTED_NOTE: Synthetic measurements at fixed illumination were repeated three times.'));
      gates.add(new SourceTestDirectory('nested notes')).add(new SourceTestFile('03_appendix.txt', 'SCREENSHOT_SELECTED_APPENDIX: Synthetic pulse duration is ten arbitrary time units with constant phase.'));
      const unrelated = root.add(new SourceTestFile('active.md', 'SCREENSHOT_UNRELATED_NOTE_MUST_NOT_READ'));
      unrelated.getFile = async () => { window.__fileReads['active.md'] = (window.__fileReads['active.md'] ?? 0) + 1; return new File([unrelated.content], unrelated.name, { lastModified: 1 }); };
      // Exact folder targeting must succeed even if the parent is too large to scan.
      root.values = async function* () { window.__fileReads.rootEnumerations = (window.__fileReads.rootEnumerations ?? 0) + 1;
        throw new Error('Exact screenshot folder request must not enumerate the entire workspace'); };
      const tab = { id: 'screenshot-active-note', kind: 'file', fileName: unrelated.name, filePath: 'active.md', fileHandle: unrelated, isDirty: false, scrollPosition: 0 };
      useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: 'C:/synthetic/atom', workspaceIdentity: null,
        layout: { activePaneId: 'fixture-pane', root: { type: 'pane', id: 'fixture-pane', tabs: [tab], activeTabIndex: 0 } } });
      useAiChatStore.getState().setComposerMode(mode);
    },
    prepareContinuation(historyStatus) {
      const state = useAiChatStore.getState();
      useAiChatStore.setState({ conversations: state.conversations.map(conversation => ({ ...conversation,
        messages: conversation.messages.map((message, index) => index === conversation.messages.length - 1
          ? { ...message, historyStatus, content: 'UNVERIFIED_OLD_CLAIM: invented history fact.\\n下一步：继续解释复合脉冲为什么能补偿幅度误差。' }
          : message), sourcesValidation: 'required' })) });
    },
    openPdf(bytes, mode) {
      const root = new SourceTestDirectory('workspace');
      const papers = root.add(new SourceTestDirectory('essay'));
      const pdf = papers.add(new SourceTestFile('Senoo 2026.pdf', ''));
      pdf.getFile = async () => { window.__fileReads['essay/Senoo 2026.pdf'] = (window.__fileReads['essay/Senoo 2026.pdf'] ?? 0) + 1; return new File([new Uint8Array(bytes)], pdf.name, { type: 'application/pdf', lastModified: 1 }); };
      const notes = root.add(new SourceTestDirectory('notes'));
      const note = notes.add(new SourceTestFile('other.md', 'UNRELATED_NOTE_SENTINEL'));
      note.getFile = async () => { window.__fileReads['notes/other.md'] = (window.__fileReads['notes/other.md'] ?? 0) + 1; return new File([note.content], note.name, { lastModified: 1 }); };
      const sameName = notes.add(new SourceTestFile('GHZ.md', 'UNRELATED_GHZ_NOTE_SENTINEL'));
      sameName.getFile = async () => { window.__fileReads['notes/GHZ.md'] = (window.__fileReads['notes/GHZ.md'] ?? 0) + 1; return new File([sameName.content], sameName.name, { lastModified: 1 }); };
      window.__workspacePaper = 'essay/Senoo 2026.pdf';
      const tab = { id: 'pdf-tab', fileName: pdf.name, filePath: window.__workspacePaper, fileHandle: pdf, isDirty: false, scrollPosition: 0 };
      const otherTab = { id: 'note-tab', kind: 'file', fileName: note.name, filePath: 'notes/other.md', fileHandle: note, isDirty: false, scrollPosition: 0 };
      useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: null, workspaceIdentity: null,
        layout: { activePaneId: 'pdf-pane', root: { type: 'split', id: 'split', direction: 'horizontal', sizes: [50, 50], children: [
          { type: 'pane', id: 'note-pane', tabs: [otherTab], activeTabIndex: 0 },
          { type: 'pane', id: 'pdf-pane', tabs: [tab], activeTabIndex: 0 },
        ] } } });
      useAiChatStore.getState().setComposerMode(mode);
    },
    focusNote() { useWorkspaceStore.setState(state => ({ layout: { ...state.layout, activePaneId: 'note-pane' } })); },
    snapshot() { const chat = useAiChatStore.getState(), workspace = useWorkspaceStore.getState();
      return { activeConversationId: chat.activeConversationId, conversation: chat.getActiveConversation(),
        attachments: useAiAttachmentStore.getState().attachmentsByConversation[chat.activeConversationId ?? ''] ?? [],
        calls: window.__fixtureCalls, harnessCalls: window.__harnessCalls, sessions: useAgentSessionStore.getState().sessions,
        workspace: { root: Boolean(workspace.rootHandle), path: workspace.workspaceRootPath }, busy: chat.isGenerating,
        errors: window.__fixtureErrors, fileReads: window.__fileReads }; }
  };
  createRoot(document.getElementById('root')).render(React.createElement(AiChatPanel, { loadPersistedState: false }));
  window.ready = true;
`;

function testSubstitutions(): Plugin {
  const uiLeaves: Record<string, string> = {
    'evidence-panel': 'export const EvidencePanel = () => null;',
    'agent-trace-panel': 'export const AgentTracePanel = () => null;',
    'agent-memory-panel': 'export const AgentMemoryPanel = () => null;',
    'agent-inspector': 'export const AgentInspector = () => null;',
    'scheduled-task-panel': 'export const ScheduledTaskPanel = () => null;',
    'workbench-queue': 'export const WorkbenchQueue = () => null; export const SelectionOriginBadge = () => null; export const createWorkbenchDraftWithTrace = async () => {}; export const createWorkbenchProposalWithTrace = async () => {};',
    'markdown-renderer': "import React from 'react'; export const MarkdownRenderer = ({ content }) => React.createElement('div', { style: { whiteSpace: 'pre-wrap' } }, content);",
    'pdf-companion-review': 'export const PdfCompanionReview = () => null;',
    'diff-preview': 'export const DiffPreview = () => null;',
    'prompt-picker': 'export const PromptPicker = () => null;',
    'prompt-editor-dialog': 'export const PromptEditorDialog = () => null;',
    'settings-dialog': 'export const SettingsDialog = () => null;',
    'agent-runner-tool': "export const runCodeWithWorkspaceRunner = async () => { throw new Error('Code execution is outside this browser fixture.'); };",
    'next/dynamic': "import React from 'react'; export default function dynamic(load) { const Component = React.lazy(load); return props => React.createElement(React.Suspense, { fallback: null }, React.createElement(Component, props)); }",
  };
  return { name: 'deterministic-model-and-unused-ui', setup(builder) {
    builder.onResolve({ filter: /(?:^|\/)model-router(?:\.ts)?$/ }, () => ({ path: 'fixture-provider', namespace: 'fixture' }));
    builder.onResolve({ filter: /(?:^|\/)(?:evidence-panel|agent-trace-panel|agent-memory-panel|agent-inspector|scheduled-task-panel|workbench-queue|markdown-renderer|pdf-companion-review|diff-preview|prompt-picker|prompt-editor-dialog|settings-dialog|agent-runner-tool)$/ }, args => ({ path: args.path.split('/').at(-1)!, namespace: 'fixture' }));
    builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'next/dynamic', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'fixture-provider' ? providerSource : uiLeaves[args.path], loader: 'tsx', resolveDir: process.cwd() }));
  } };
}

let browser: Browser;
let server: Server;
let context: BrowserContext;
let page: Page;
let url: string;
let browserErrors: string[];
let externalRequests: string[];

beforeAll(async () => {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const bundle = await build({ stdin: { contents: fixtureSource, resolveDir: process.cwd(), loader: 'tsx' }, plugins: [testSubstitutions()],
    bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'empty', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' },
    define: { 'process.env.NODE_ENV': JSON.stringify('test') }, logLevel: 'silent' });
  const postcss = require('postcss');
  const css = await postcss([require('tailwindcss')({ config: path.join(process.cwd(), 'tailwind.config.ts') })]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.join(process.cwd(), 'src/app/globals.css') });
  server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return; }
    if (request.url === '/styles.css') { response.setHeader('Content-Type', 'text/css'); response.end(css.css); return; }
    if (request.url === '/pdfjs-dist/build/pdf.worker.min.mjs') { response.setHeader('Content-Type', 'text/javascript'); void readFile(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')).then(bytes => response.end(bytes)); return; }
    if (request.url === '/favicon.ico') { response.statusCode = 204; response.end(); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Lattice Composer Attachment QA</title><link rel="stylesheet" href="/styles.css"><style>html,body{height:100%;margin:0;font-family:Arial,"Microsoft YaHei",sans-serif}body{background:#f7f7f8;padding:20px}#root{height:calc(100vh - 40px);max-width:820px;margin:auto;border:1px solid #ddd;border-radius:8px;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Composer test server failed.');
  url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});

beforeEach(async () => {
  browserErrors = []; externalRequests = [];
  context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await context.route('**/*', route => {
    const target = route.request().url();
    if (target.startsWith(url) || /^(?:blob:|data:)/.test(target)) return route.continue();
    externalRequests.push(target); return route.abort('blockedbyclient');
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  await page.goto(url);
  if (browserErrors.length) throw new Error('Composer fixture bootstrap failed: ' + browserErrors.join('\n'));
  await page.waitForFunction(() => (window as unknown as BrowserFixture).ready, null, { timeout: 15000 }).catch(error => {
    throw new Error('Composer fixture was not ready: ' + browserErrors.join('\n') + '\n' + error.message);
  });
  await page.getByTestId('ai-chat-input').waitFor().catch(error => { throw new Error('Composer did not render: ' + browserErrors.join('\n') + '\n' + error.message); });
});

afterEach(async () => { await context?.close(); });
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    // Chromium may leave a preconnected HTTP socket without a request. Close
    // the listener first, then its connections so teardown cannot race it.
    server.closeAllConnections();
  });
});

const snapshot = () => page.evaluate(() => (window as unknown as BrowserFixture).fixture.snapshot());

async function uploadFromPaperclip(files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '上传文件或图片', exact: true }).click();
  await (await chooser).setFiles(files);
  for (const file of files) await page.getByRole('button', { name: `移除附件 ${file.name}`, exact: true }).waitFor();
  await page.waitForFunction(() => {
    const fixture = (window as unknown as BrowserFixture).fixture.snapshot();
    return fixture.attachments.length > 0 && !document.querySelector('[data-testid="ai-chat-submit"]')?.hasAttribute('disabled');
  });
}

async function send(text: string) {
  await page.getByTestId('ai-chat-input').fill(text);
  await page.getByTestId('ai-chat-submit').click();
  await page.waitForFunction(() => {
    const state = (window as unknown as BrowserFixture).fixture.snapshot();
    return !state.busy && state.conversation?.messages.at(-1)?.role === 'assistant' && !state.conversation.messages.at(-1)?.isStreaming;
  }, null, { timeout: 30000 });
}

describe('real ChatComposer attachment send integration', () => {
  it.each([
    { mode: 'chat', prefix: '' }, { mode: 'agent', prefix: '' },
    { mode: 'chat', prefix: '@' }, { mode: 'agent', prefix: '@' },
  ] as const)('reads the screenshot folder path and PDF later pages from $mode with prefix "$prefix" without scanning the workspace', async ({ mode, prefix }) => {
    const pdf = await PDFDocument.create();
    for (let pageNumber = 1; pageNumber <= 4; pageNumber++) pdf.addPage().drawText(
      'SCREENSHOT_GATE_PAGE_' + pageNumber + ': A synthetic pulse family has a uniquely recorded result on this page.', { x: 30, y: 750, size: 10 });
    await page.evaluate(({ bytes, mode }) => (window as unknown as BrowserFixture).fixture.openScreenshotWorkspace(bytes, mode), { bytes: Array.from(await pdf.save()), mode });
    const selected = 'Theoretical Research/taiyi/essay/06_fast_long_range_and_native_gates';
    await send(prefix + selected + '中文章都阅读并讲述文章内容，对话内回复');
    const state = await snapshot();
    const response = state.conversation?.messages.at(-1);
    expect(response?.error).toBeUndefined();
    const directory = state.sessions.find(session => session.documentResearch?.directory)?.documentResearch?.directory;
    expect(directory?.phase).toBe('ready');
    expect(directory?.files).toHaveLength(3);
    expect(directory?.files.every(file => file.status === 'complete' && file.path.startsWith(selected + '/'))).toBe(true);
    expect(directory?.files.find(file => file.path.endsWith('.pdf'))?.checkpoint?.coverage[0]?.readUnits).toEqual([1, 2, 3, 4]);
    const readText = state.calls.filter(call => call.stage === 'document-batch').map(call => call.text).join('\n');
    expect(readText).toContain('SCREENSHOT_GATE_PAGE_4');
    expect(readText).toContain('SCREENSHOT_SELECTED_NOTE');
    expect(readText).toContain('SCREENSHOT_SELECTED_APPENDIX');
    expect(state.calls.every(call => !call.text.includes('SCREENSHOT_UNRELATED_NOTE_MUST_NOT_READ'))).toBe(true);
    expect(state.fileReads.rootEnumerations ?? 0).toBe(0);
    expect(state.fileReads['active.md'] ?? 0).toBe(0);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'screenshot-folder-' + mode + (prefix ? '-mention' : '-plain') + '.png') });
    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  }, 90_000);

  it('resumes all 101 selected cloud files through the actual Composer after changing the active cloud document', async () => {
    await page.evaluate(() => (window as unknown as BrowserFixture).fixture.openCloudDirectory());
    await send('@cloud-folder:cloud-library:folder 读取当前文件夹中的所有文章并逐篇综合讲解，在对话内回复');
    const first = await snapshot();
    const firstSession = first.sessions.find(session => session.documentResearch?.directory?.cloud);
    expect(first.conversation?.messages.at(-1)?.error).toBeUndefined();
    expect(firstSession?.documentResearch?.directory?.files.filter(file => file.status === 'complete')).toHaveLength(48);
    expect(firstSession?.documentResearch?.directory?.cloud?.providerScope).toBe('synthetic-browser-account');
    expect(await page.getByTestId('document-reading-resume').count()).toBe(1);
    await page.evaluate(() => (window as unknown as BrowserFixture).fixture.focusUnrelatedCloudFile());
    await send('继续');
    const second = await snapshot();
    expect(second.conversation?.messages.at(-1)?.error).toBeUndefined();
    expect(second.sessions.find(session => session.id === firstSession?.id)?.documentResearch?.directory?.files.filter(file => file.status === 'complete')).toHaveLength(96);
    await send('继续');
    const final = await snapshot();
    const directory = final.sessions.find(session => session.id === firstSession?.id)?.documentResearch?.directory;
    expect(final.conversation?.messages.at(-1)?.error).toBeUndefined();
    expect(directory?.phase).toBe('ready');
    expect(directory?.files.filter(file => file.status === 'complete')).toHaveLength(101);
    expect(directory?.files.every(file => file.snapshot?.cloudIdentity?.libraryId === 'cloud-library')).toBe(true);
    expect(final.calls.filter(call => call.stage === 'document-batch')).toHaveLength(101);
    expect(final.calls.filter(call => call.stage === 'directory-reduction').length).toBeGreaterThan(0);
    expect(final.fileReads.unrelated ?? 0).toBe(0);
    expect(final.calls.every(call => !call.text.includes('CLOUD_UNRELATED_MUST_NOT_READ'))).toBe(true);
    expect(final.conversation?.messages.at(-1)?.documentContext?.cloudSnapshots).toHaveLength(101);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'cloud-directory-complete-101.png') });
    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  }, 180_000);

  it('completes folder and whole-file references, then lets ordinary text and Enter reach the composer', async () => {
    await page.evaluate(() => (window as unknown as BrowserFixture).fixture.openMentionWorkspace());
    const input = page.getByTestId('ai-chat-input');
    const picker = page.getByTestId('mention-autocomplete');
    await input.fill('@');
    await picker.getByRole('button', { name: 'Theoretical Research', exact: true }).click();
    await picker.getByRole('button', { name: 'gates', exact: true }).click();
    await picker.getByRole('button', { name: '引用此文件夹', exact: true }).click();
    await input.pressSequentially('中的文章都阅读');
    expect(await input.inputValue()).toBe('@folder:Theoretical%20Research/gates 中的文章都阅读');
    expect(await picker.count()).toBe(0);
    expect((await snapshot()).calls).toHaveLength(0);

    await input.fill('@');
    await picker.getByRole('button', { name: 'Theoretical Research', exact: true }).click();
    await picker.getByRole('button', { name: 'gates', exact: true }).click();
    await picker.getByRole('button', { name: 'plain@100%.txt', exact: true }).click();
    await input.pressSequentially('解释实验条件');
    expect(await input.inputValue()).toBe('@Theoretical%20Research/gates/plain%40100%25.txt 解释实验条件');
    expect(await picker.count()).toBe(0);
    await input.press('Enter');
    await page.waitForFunction(() => (window as unknown as BrowserFixture).fixture.snapshot().calls.length > 0);
    await page.waitForFunction(() => !(window as unknown as BrowserFixture).fixture.snapshot().busy);
    const state = await snapshot();
    expect(state.conversation?.messages.at(-1)?.error).toBeUndefined();
    expect(state.calls.map(call => call.text).join('\n')).toContain('Synthetic experimental record');
    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  });

  it.each(['verified', 'unverified'] as const)('carries short continuation intent independently of %s evidence history', async historyStatus => {
    const pdf = await PDFDocument.create();
    for (let number = 1; number <= 20; number++) pdf.addPage().drawText(number === 12
      ? 'BB1_CONTINUATION_SOURCE: BB1 compensates pulse amplitude errors with different phase axes.'
      : 'Unrelated background only.', { x: 30, y: 750, size: 10 });
    await page.evaluate(bytes => (window as unknown as BrowserFixture).fixture.openPdf(bytes, 'agent'), Array.from(await pdf.save()));
    await send('BB1是什么？');
    await page.evaluate(status => (window as unknown as BrowserFixture).fixture.prepareContinuation(status), historyStatus);
    const before = await snapshot();
    await send('做');
    const after = await snapshot();
    const calls = after.calls.slice(before.calls.length);
    for (const stage of ['planning', 'answer']) {
      const prompt = calls.filter(call => call.stage === stage).map(call => call.text).join('\n');
      expect(prompt).toContain('BB1是什么');
      expect(prompt).toContain('继续解释复合脉冲为什么能补偿幅度误差');
      if (historyStatus === 'unverified') expect(prompt).not.toContain('UNVERIFIED_OLD_CLAIM');
    }
    expect(calls.filter(call => call.stage === 'answer').map(call => call.text).join('\n')).toContain('BB1_CONTINUATION_SOURCE');
    expect(after.conversation?.messages.at(-1)?.error).toBeUndefined();
    expect(after.conversation?.messages.at(-1)?.documentContext?.paths).toEqual(['essay/Senoo 2026.pdf']);
    expect(after.fileReads['notes/other.md'] ?? 0).toBe(0);
  });
  it.each(['chat', 'agent'] as const)('reads the active PDF for an unqualified scientific question through the real %s entry point', async mode => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText('GHZ_SOURCE_SENTINEL: Z2-ordered GHZ states coherently superpose two alternating spin configurations.', { x: 30, y: 750, size: 10, font });
    pdf.addPage().drawText('UNREAD_PAGE_SENTINEL: An unrelated section that the focused question does not need.', { x: 30, y: 750, size: 10, font });
    const bytes = Array.from(await pdf.save());
    await page.evaluate(({ bytes, mode }) => (window as unknown as BrowserFixture).fixture.openPdf(bytes, mode), { bytes, mode });
    await send('Z2-ordered Greenberger–Horne–Zeilinger (GHZ) states是什么思想');
    const first = await snapshot();
    const response = first.conversation?.messages.at(-1);
    expect(response?.error).toBeUndefined();
    expect(response?.documentContext?.paths).toEqual(['essay/Senoo 2026.pdf']);
    expect(response?.documentContext?.snapshots?.[0]).toMatchObject({ path: 'essay/Senoo 2026.pdf', kind: 'pdf', totalUnits: 2 });
    expect(response?.evidenceRefs?.some(ref => ref.locator.includes('Senoo') && ref.locator.includes('page=1'))).toBe(true);
    expect(response?.content).toContain('GHZ_SOURCE_SENTINEL');
    expect(first.fileReads['essay/Senoo 2026.pdf']).toBeGreaterThan(0);
    expect(first.fileReads['notes/other.md'] ?? 0).toBe(0);
    expect(first.calls.some(call => call.stage === 'document-batch')).toBe(false);
    expect(response?.agentResult?.toolObservations?.some(observation => observation.toolName === 'lattice.sources.read' && observation.status === 'completed' && (observation.evidenceCount ?? 0) > 0)).toBe(true);
    expect(first.calls.map(call => call.text).join('\n')).not.toContain('research/current-note.md');
    expect(first.calls.map(call => call.text).join('\n')).not.toContain('UNREAD_PAGE_SENTINEL');
    if (mode === 'agent') expect(first.calls.some(call => call.stage === 'planning' && call.text.includes('essay/Senoo 2026.pdf'))).toBe(true);
    await page.evaluate(() => (window as unknown as BrowserFixture).fixture.focusNote());
    await send('为什么需要这样的叠加？');
    const followup = await snapshot();
    expect(followup.conversation?.messages.at(-1)?.error).toBeUndefined();
    expect(followup.conversation?.messages.at(-1)?.documentContext?.paths).toEqual(['essay/Senoo 2026.pdf']);
    expect(followup.fileReads['notes/other.md'] ?? 0).toBe(0);
    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  });

  it.each(['chat', 'agent'] as const)('does not read an open PDF for an explicitly independent %s question', async mode => {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText('DO_NOT_READ_SOURCE_SENTINEL', { x: 30, y: 750 });
    const bytes = Array.from(await pdf.save());
    await page.evaluate(({ bytes, mode }) => (window as unknown as BrowserFixture).fixture.openPdf(bytes, mode), { bytes, mode });
    await send('不结合当前论文，解释 GHZ 态的一般思想');
    const state = await snapshot();
    expect(state.conversation?.messages.at(-1)?.error).toBeUndefined();
    expect(state.conversation?.messages.at(-1)?.documentContext?.paths).toEqual([]);
    expect(state.fileReads).toEqual({});
    expect(state.calls.every(call => !call.text.includes('DO_NOT_READ_SOURCE_SENTINEL') && !call.text.includes('research/current-note.md'))).toBe(true);
    expect(state.calls.some(call => call.stage === 'document-batch')).toBe(false);
    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  });

  it('analyzes the active PDF through Composer when an unrelated GHZ.md matches the concept name', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText('GHZ_SOURCE_SENTINEL: Z2-ordered GHZ states coherently superpose two alternating spin configurations.', { x: 30, y: 750, size: 10 });
    await page.evaluate(bytes => (window as unknown as BrowserFixture).fixture.openPdf(bytes, 'agent'), Array.from(await pdf.save()));
    await send('分析 GHZ 态的物理意义');
    const state = await snapshot();
    const response = state.conversation?.messages.at(-1);
    expect(response?.error).toBeUndefined();
    expect(response?.documentContext?.paths).toEqual(['essay/Senoo 2026.pdf']);
    expect(response?.content).toContain('GHZ_SOURCE_SENTINEL');
    expect(response?.agentResult?.toolObservations?.some(observation => observation.toolName === 'lattice.sources.read' && observation.status === 'completed' && (observation.evidenceCount ?? 0) > 0)).toBe(true);
    expect(state.fileReads['notes/GHZ.md'] ?? 0).toBe(0);
    expect(state.calls.map(call => call.text).join('\n')).not.toContain('UNRELATED_GHZ_NOTE_SENTINEL');
    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  });

  it('answers a named concept in this paper through bounded source tools instead of full-document batches', async () => {
    const pdf = await PDFDocument.create();
    for (let pageNumber = 1; pageNumber <= 20; pageNumber++) pdf.addPage().drawText(pageNumber === 12
      ? 'BB1_ROUTE_SENTINEL: BB1 compensates pulse amplitude errors using different phase axes.'
      : 'Synthetic unrelated introduction on this page.', { x: 30, y: 750, size: 10 });
    await page.evaluate(bytes => (window as unknown as BrowserFixture).fixture.openPdf(bytes, 'agent'), Array.from(await pdf.save()));
    await send('BB1是什么？请依据这篇论文解释，区分原文内容和一般背景。回答最后给一个明确下一步建议：可以根据已经找到的原文继续解释复合脉冲为什么能补偿幅度误差。');
    const state = await snapshot();
    expect(state.conversation?.messages.at(-1)?.error).toBeUndefined();
    expect(state.conversation?.messages.at(-1)?.documentContext?.paths).toEqual(['essay/Senoo 2026.pdf']);
    expect(state.calls.some(call => call.stage === 'document-batch')).toBe(false);
    expect(state.sessions.some(session => session.documentResearch)).toBe(false);
    expect(state.calls.filter(call => call.stage === 'answer').map(call => call.text).join('\n')).toContain('BB1_ROUTE_SENTINEL');
    expect(state.fileReads['notes/GHZ.md'] ?? 0).toBe(0);
    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  });

  it('creates a conversation without a workspace and sends TXT plus actual PNG bytes to the API', async () => {
    expect(await page.title()).toBe('Lattice Composer Attachment QA');
    expect((await snapshot()).activeConversationId).toBeNull();
    await uploadFromPaperclip([
      { name: '实验记录.txt', mimeType: 'text/plain', buffer: Buffer.from(TEXT) },
      { name: '样品.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') },
    ]);
    const pending = await snapshot();
    expect(pending.activeConversationId).toBeTruthy();
    expect(pending.workspace).toEqual({ root: false, path: null });
    expect(pending.attachments.map(ref => ref.status)).toEqual(['pending', 'pending']);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'composer-pending.png') });
    await send('请分析上传的实验记录和图片。');
    const state = await snapshot();
    expect(state.conversation?.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(state.conversation?.messages[0].attachments?.map(ref => ref.name).sort()).toEqual(['实验记录.txt', '样品.png'].sort());
    expect(state.conversation?.messages[1].error).toBeUndefined();
    expect(state.attachments.every(ref => ref.status === 'sent')).toBe(true);
    expect(state.calls.some(call => call.stage === 'document-batch' && call.text.includes(TEXT))).toBe(true);
    const imageInputs = state.calls.flatMap(call => call.body.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_url') : []));
    expect(imageInputs.length).toBeGreaterThan(0);
    expect(imageInputs.every(part => part.image_url?.url === `data:image/png;base64,${PNG}`)).toBe(true);
    expect(await page.getByTestId('ai-chat-attachments').getByRole('button', { name: /移除附件/ }).count()).toBe(0);
    expect(await page.getByTestId('chat-message-attachments').textContent()).toContain('实验记录.txt');
    expect(await page.getByTestId('chat-message-attachments').textContent()).toContain('样品.png');
    expect(await page.getByTestId('document-reading-progress').textContent()).toContain('全部正文已分析');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'composer-sent.png') });
    await page.setViewportSize({ width: 390, height: 780 });
    const composerBox = await page.getByTestId('ai-chat-composer').boundingBox();
    expect(composerBox && composerBox.x + composerBox.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'composer-sent-mobile.png') });
    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  });

  it('reuses the same document and image for a Chinese why follow-up in the same conversation', async () => {
    await uploadFromPaperclip([
      { name: '记录.txt', mimeType: 'text/plain', buffer: Buffer.from(TEXT) },
      { name: '图像.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') },
    ]);
    await send('请分析附件。');
    const first = await snapshot();
    const originalIds = first.attachments.map(ref => ref.id);
    const priorCalls = first.calls.length;
    await send('为什么会出现这样的结果？请用中文解释。');
    const state = await snapshot();
    expect(state.activeConversationId).toBe(first.activeConversationId);
    expect(state.conversation?.messages).toHaveLength(4);
    expect(state.conversation?.messages[2].attachments?.map(ref => ref.id)).toEqual(originalIds);
    expect(state.conversation?.messages[3].error).toBeUndefined();
    const calls = state.calls.slice(priorCalls);
    expect(calls.some(call => call.text.includes(TEXT))).toBe(true);
    expect(calls.some(call => call.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image' && part.data === PNG)))).toBe(true);
    expect(await page.getByTestId('chat-message-attachments').count()).toBe(2);
    expect(state.workspace.root).toBe(false);
    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  });

  it('keeps normal Chinese composition input in the draft until the final Enter', async () => {
    const input = page.getByTestId('ai-chat-input');
    await input.fill('你好，请用中文回答。');
    await input.dispatchEvent('compositionstart');
    await input.press('Enter');
    expect((await snapshot()).conversation?.messages ?? []).toEqual([]);
    expect(await input.inputValue()).toContain('你好');
    await input.dispatchEvent('compositionend');
    await input.press('Enter');
    await page.waitForFunction(() => {
      const state = (window as unknown as BrowserFixture).fixture.snapshot();
      return !state.busy && state.conversation?.messages.length === 2;
    });
    const state = await snapshot();
    expect(state.conversation?.messages[0].content).toContain('你好，请用中文回答。');
    expect(state.conversation?.messages[1].error).toBeUndefined();
    expect(state.conversation?.messages[0].attachments ?? []).toEqual([]);
    expect(state.calls.at(-1)?.text).toContain('你好，请用中文回答。');
    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  });

  it('retains unreadable binary and damaged PDF coverage as incomplete rather than claiming a successful read', async () => {
    await uploadFromPaperclip([
      { name: '未知.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 255, 3, 7]) },
      { name: '损坏.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\ncorrupted PDF payload') },
    ]);
    await send('请阅读全文并分析这两个附件。');
    const state = await snapshot();
    const coverage = state.sessions.flatMap(session => session.documentResearch?.checkpoint.coverage ?? []);
    expect(coverage).toHaveLength(2);
    expect(coverage.every(entry => entry.readUnits.length === 0 && entry.unreadableUnits.length > 0)).toBe(true);
    const progress = await page.getByTestId('document-reading-progress').textContent();
    expect(progress).toMatch(/暂停|部分|失败/);
    expect(progress).not.toContain('全文已读完');
    expect(state.calls.some(call => call.stage === 'document-batch')).toBe(false);
    expect(state.conversation?.messages[0].attachments).toHaveLength(2);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'composer-unreadable.png') });
    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  });

  it('passes a pure image through the actual Codex Composer helper without calling a native model', async () => {
    await uploadFromPaperclip([{ name: '仅图片.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') }]);
    await page.getByTestId('ai-runtime-engine').selectOption('codex');
    await send('请描述这张图片。');
    const state = await snapshot();
    expect(state.harnessCalls).toHaveLength(1);
    expect(state.harnessCalls[0]).toMatchObject({ conversationId: state.activeConversationId, images: [{ data: PNG, mimeType: 'image/png' }], beforeTurnChecked: true, imageOnlyToolDenied: true });
    expect(state.harnessCalls[0].workspace).toMatch(/^lattice-cloud:/);
    expect(state.harnessCalls[0].text).toContain('请描述这张图片。');
    expect(state.calls).toEqual([]);
    expect(state.conversation?.messages[1].error).toBeUndefined();
    expect(state.conversation?.messages[1].model?.providerName).toBe('本机 Codex');
    expect(state.attachments[0].status).toBe('sent');
    expect(await page.getByTestId('chat-message-attachments').textContent()).toContain('仅图片.png');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'composer-codex-image.png') });
    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  });
});
