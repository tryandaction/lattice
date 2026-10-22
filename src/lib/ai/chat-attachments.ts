import type { AgentDocumentSource, AgentDocumentUnitResult } from './document-source';
import type { AiContentPart } from './types';

export const CHAT_ATTACHMENT_LIMITS = {
  maxFiles: 10,
  maxFileBytes: 32 * 1024 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxModelImageBytes: 32 * 1024 * 1024,
} as const;

export interface ChatAttachmentRef {
  id: string;
  conversationId: string;
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
  createdAt: number;
  kind: 'image' | 'document' | 'unreadable';
  status: 'pending' | 'sent';
  reason?: string;
}

export interface ChatAttachmentScope {
  signal?: AbortSignal;
  /** The caller owns the conversation/workspace scope and rechecks it after awaits. */
  isCurrent?: () => boolean;
}

interface AttachmentRecord extends ChatAttachmentRef { blob: Blob }

const DATABASE_NAME = 'lattice-chat-attachments-v1';
const STORE_NAME = 'attachments';
const DOCUMENT_EXTENSIONS = /^(?:pdf|md|mdx|markdown|txt|docx|pptx|html|htm|ipynb|py|pyw|js|jsx|ts|tsx|json|jsonc|yaml|yml|toml|xml|csv|tsv|tex|bib|r|jl|sh|bash|ps1|c|h|cpp|hpp|cc|cxx|cs|java|go|rs|rb|php|sql|css|scss|sass|less|vue|svelte|lua|m|f|f90|f95|ini|cfg|conf|log|diff|patch)$/i;
const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif|bmp|ico|tiff?|avif|heic|heif|svg)$/i;

export function assertChatAttachmentScope(options: ChatAttachmentScope = {}): void {
  if (options.signal?.aborted) throw new DOMException('附件操作已取消。', 'AbortError');
  if (options.isCurrent && !options.isCurrent()) throw new Error('附件会话作用域已改变。');
}

function assertConversation(conversationId: string): void {
  if (!conversationId.trim()) throw new Error('附件需要有效会话。');
}

/** FileReader also works in WebViews/test environments without Blob.arrayBuffer(). */
export async function browserFileReader(blob: Blob, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (signal?.aborted) throw new DOMException('附件读取已取消。', 'AbortError');
  return new Promise((resolve, reject) => {
    const reader = typeof blob.arrayBuffer === 'function' ? undefined : new FileReader();
    const abort = () => {
      reader?.abort();
      finish(undefined, new DOMException('附件读取已取消。', 'AbortError'));
    };
    const finish = (bytes?: ArrayBuffer, error?: unknown) => {
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else if (bytes) resolve(bytes);
      else reject(new Error('无法读取附件。'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (typeof blob.arrayBuffer === 'function') {
      void blob.arrayBuffer().then(bytes => finish(bytes), error => finish(undefined, error));
      return;
    }
    if (!reader) { finish(undefined, new Error('附件读取器不可用。')); return; }
    reader.onload = () => {
      if (reader?.result instanceof ArrayBuffer) finish(reader.result);
      else finish(undefined, new Error('附件读取未返回二进制数据。'));
    };
    reader.onerror = () => finish(undefined, reader?.error ?? new Error('附件读取失败。'));
    reader.onabort = () => finish(undefined, new DOMException('附件读取已取消。', 'AbortError'));
    reader.readAsArrayBuffer(blob);
  });
}

export function sniffChatImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

function metadata(record: AttachmentRecord): ChatAttachmentRef {
  const { blob: _blob, ...ref } = record;
  return ref;
}

async function openDatabase(options: ChatAttachmentScope): Promise<IDBDatabase> {
  assertChatAttachmentScope(options);
  if (typeof indexedDB === 'undefined') throw new Error('当前环境无法持久保存附件，请启用浏览器本地存储。');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    let settled = false;
    const abort = () => { settled = true; reject(new DOMException('附件操作已取消。', 'AbortError')); };
    options.signal?.addEventListener('abort', abort, { once: true });
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('conversationId', 'conversationId');
    };
    request.onerror = request.onblocked = () => {
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      reject(request.error ?? new Error('无法打开附件存储。'));
    };
    request.onsuccess = () => {
      options.signal?.removeEventListener('abort', abort);
      if (settled) { request.result.close(); return; }
      try { assertChatAttachmentScope(options); resolve(request.result); }
      catch (error) { request.result.close(); reject(error); }
    };
  });
}

async function transaction<T>(mode: IDBTransactionMode, options: ChatAttachmentScope,
  run: (store: IDBObjectStore, result: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
  const database = await openDatabase(options);
  try {
    assertChatAttachmentScope(options);
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, mode);
      let value: T;
      let failure: unknown;
      const abort = () => { failure = new DOMException('附件操作已取消。', 'AbortError'); tx.abort(); };
      options.signal?.addEventListener('abort', abort, { once: true });
      const cleanup = () => options.signal?.removeEventListener('abort', abort);
      tx.oncomplete = () => {
        cleanup();
        try { assertChatAttachmentScope(options); resolve(value); } catch (error) { reject(error); }
      };
      tx.onabort = tx.onerror = () => { cleanup(); reject(failure ?? tx.error ?? new Error('附件存储失败。')); };
      const fail = (error: unknown) => { failure = error; tx.abort(); };
      try { run(tx.objectStore(STORE_NAME), result => { value = result; }, fail); } catch (error) { fail(error); }
    });
  } finally { database.close(); }
}

export async function listChatAttachments(conversationId: string, options: ChatAttachmentScope = {}): Promise<ChatAttachmentRef[]> {
  assertConversation(conversationId);
  return transaction('readonly', options, (store, done) => {
    const request = store.index('conversationId').getAll(conversationId);
    request.onsuccess = () => done((request.result as AttachmentRecord[]).map(metadata).sort((a, b) => a.createdAt - b.createdAt));
  });
}

function classifyFile(file: File, bytes: Uint8Array): Pick<ChatAttachmentRef, 'kind' | 'mimeType' | 'reason'> {
  const imageMime = sniffChatImageMime(bytes);
  if (imageMime) return { kind: 'image', mimeType: imageMime };
  if (file.type.startsWith('image/') || IMAGE_EXTENSION.test(file.name)) {
    return { kind: 'unreadable', mimeType: 'application/octet-stream', reason: '图片格式不支持或文件头无效；支持 PNG、JPEG、WEBP。' };
  }
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  if (extension === 'pdf' || file.type === 'application/pdf') {
    return new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
      ? { kind: 'document', mimeType: 'application/pdf' }
      : { kind: 'unreadable', mimeType: 'application/octet-stream', reason: 'PDF 文件头无效，无法读取文档。' };
  }
  if (extension === 'docx' || extension === 'pptx') {
    return bytes.length >= 4 && bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4
      ? { kind: 'document', mimeType: file.type || 'application/octet-stream' }
      : { kind: 'unreadable', mimeType: 'application/octet-stream', reason: 'Office 文档格式无效，无法读取文档。' };
  }
  if (extension === 'doc') return { kind: 'unreadable', mimeType: 'application/msword', reason: '请将旧版 Word 文件转换为 DOCX 后上传。' };
  if (DOCUMENT_EXTENSIONS.test(extension) || file.type.startsWith('text/')) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('binary');
      return { kind: 'document', mimeType: file.type || 'text/plain' };
    } catch { return { kind: 'unreadable', mimeType: 'application/octet-stream', reason: '文件包含二进制或无效 UTF-8，无法作为文本读取。' }; }
  }
  return { kind: 'unreadable', mimeType: file.type || 'application/octet-stream', reason: '附件已保存，此格式暂不支持内容读取。' };
}

export async function addChatAttachments(conversationId: string, files: readonly File[], options: ChatAttachmentScope = {}): Promise<ChatAttachmentRef[]> {
  assertConversation(conversationId);
  assertChatAttachmentScope(options);
  if (!files.length) return [];
  if (files.length > CHAT_ATTACHMENT_LIMITS.maxFiles) throw new Error('每条消息最多上传 10 个附件。');
  const records: AttachmentRecord[] = [];
  let totalBytes = 0;
  for (const file of files) {
    if (!(file instanceof File)) throw new TypeError('附件必须为 File。');
    if (file.size > CHAT_ATTACHMENT_LIMITS.maxFileBytes) throw new Error(`${file.name} 超过 32 MB 文件限制。`);
    if ((file.type.startsWith('image/') || IMAGE_EXTENSION.test(file.name)) && file.size > CHAT_ATTACHMENT_LIMITS.maxImageBytes) throw new Error(`${file.name} 超过 10 MB 图片限制。`);
    totalBytes += file.size;
    if (totalBytes > CHAT_ATTACHMENT_LIMITS.maxTotalBytes) throw new Error('附件总大小不能超过 64 MB。');
    const bytes = await browserFileReader(file, options.signal);
    assertChatAttachmentScope(options);
    const classified = classifyFile(file, new Uint8Array(bytes));
    if (classified.kind === 'image' && file.size > CHAT_ATTACHMENT_LIMITS.maxImageBytes) throw new Error(`${file.name} 超过 10 MB 图片限制。`);
    records.push({ ...classified, id: crypto.randomUUID(), conversationId, name: file.name.replace(/[\\/\u0000-\u001f]/g, '_') || 'attachment', size: file.size,
      lastModified: file.lastModified, createdAt: Date.now(), status: 'pending', blob: new Blob([bytes], { type: classified.mimeType }) });
  }
  return transaction('readwrite', options, (store, done, fail) => {
    const request = store.index('conversationId').getAll(conversationId);
    request.onsuccess = () => {
      try {
        assertChatAttachmentScope(options);
        const pending = (request.result as AttachmentRecord[]).filter(ref => ref.status === 'pending');
        if (pending.length + records.length > CHAT_ATTACHMENT_LIMITS.maxFiles) throw new Error('每条消息最多上传 10 个附件。');
        if (pending.reduce((sum, ref) => sum + ref.size, totalBytes) > CHAT_ATTACHMENT_LIMITS.maxTotalBytes) throw new Error('附件总大小不能超过 64 MB。');
        for (const record of records) store.add(record);
        done(records.map(metadata));
      } catch (error) { fail(error); }
    };
  });
}

export async function getChatAttachmentFiles(conversationId: string, attachmentIds: readonly string[], options: ChatAttachmentScope = {}): Promise<Array<{ attachment: ChatAttachmentRef; file: File }>> {
  assertConversation(conversationId);
  const ids = [...new Set(attachmentIds)];
  const records = await transaction<AttachmentRecord[]>('readonly', options, (store, done, fail) => {
    const result: AttachmentRecord[] = new Array(ids.length);
    if (!ids.length) { done([]); return; }
    let remaining = ids.length;
    ids.forEach((id, index) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const record = request.result as AttachmentRecord | undefined;
        if (!record || record.conversationId !== conversationId) { fail(new Error('附件不存在或不属于当前会话，请重新上传。')); return; }
        result[index] = record;
        if (--remaining === 0) done(result);
      };
    });
  });
  assertChatAttachmentScope(options);
  return records.map(record => {
    const file = new File([record.blob], record.name, { type: record.mimeType, lastModified: record.lastModified });
    // Some embedded browsers expose FileReader but omit modern File methods.
    if (typeof file.arrayBuffer !== 'function') Object.defineProperty(file, 'arrayBuffer', { value: () => browserFileReader(record.blob, options.signal) });
    if (typeof file.text !== 'function') Object.defineProperty(file, 'text', { value: async () => new TextDecoder().decode(await browserFileReader(record.blob, options.signal)) });
    return { attachment: metadata(record), file };
  });
}

export async function removeChatAttachment(conversationId: string, attachmentId: string, options: ChatAttachmentScope = {}): Promise<void> {
  assertConversation(conversationId);
  return transaction('readwrite', options, (store, done, fail) => {
    const request = store.get(attachmentId);
    request.onsuccess = () => {
      try {
        assertChatAttachmentScope(options);
        const record = request.result as AttachmentRecord | undefined;
        if (record && record.conversationId !== conversationId) throw new Error('附件不属于当前会话。');
        if (record?.status === 'sent') throw new Error('已发送附件需要保留以重放历史。');
        if (record) store.delete(attachmentId);
        done(undefined);
      } catch (error) { fail(error); }
    };
  });
}

export async function markChatAttachmentsSent(conversationId: string, attachmentIds: readonly string[], options: ChatAttachmentScope = {}): Promise<void> {
  assertConversation(conversationId);
  return transaction('readwrite', options, (store, done, fail) => {
    for (const id of new Set(attachmentIds)) {
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          assertChatAttachmentScope(options);
          const record = request.result as AttachmentRecord | undefined;
          if (!record || record.conversationId !== conversationId) throw new Error('附件不存在或不属于当前会话。');
          store.put({ ...record, status: 'sent' });
        } catch (error) { fail(error); }
      };
    }
    done(undefined);
  });
}

export function chatAttachmentDocumentPath(ref: ChatAttachmentRef): string {
  const name = ref.name.replace(/[\\/\u0000-\u001f]/g, '_').replace(/^\.+$/, 'attachment');
  return `attachments/${ref.id}/${name}`;
}

/** A minimal File accessor for the source index; it never resolves a workspace path. */
export async function getChatAttachmentFileForPath(conversationId: string, path: string, options: ChatAttachmentScope = {}): Promise<File> {
  const refs = await listChatAttachments(conversationId, options);
  const ref = refs.find(item => chatAttachmentDocumentPath(item) === path);
  if (!ref) throw new Error('附件路径不属于当前会话。');
  const [record] = await getChatAttachmentFiles(conversationId, [ref.id], options);
  assertChatAttachmentScope(options);
  return record.file;
}

function scopedSource(source: AgentDocumentSource, options: ChatAttachmentScope, path = source.path): AgentDocumentSource {
  return {
    path, kind: source.kind, version: source.version, totalUnits: source.totalUnits, unitLabel: source.unitLabel,
    async readUnit(unit, signal) {
      assertChatAttachmentScope(options);
      assertChatAttachmentScope({ ...options, signal: signal ?? options.signal });
      const combinedSignal = signal && options.signal && signal !== options.signal ? AbortSignal.any([signal, options.signal]) : signal ?? options.signal;
      const result = await source.readUnit(unit, combinedSignal);
      assertChatAttachmentScope(options);
      assertChatAttachmentScope({ signal });
      return { ...result, ...(result.locator && source.path !== path ? { locator: result.locator.replace(source.path, path) } : {}) };
    },
    close: () => source.close(),
  };
}

function unreadableSource(ref: ChatAttachmentRef, options: ChatAttachmentScope): AgentDocumentSource {
  let closed = false;
  return {
    path: chatAttachmentDocumentPath(ref), kind: /\.pdf$/i.test(ref.name) ? 'pdf' : 'text', version: `${ref.id}|${ref.size}|${ref.lastModified}`,
    totalUnits: 1, unitLabel: /\.pdf$/i.test(ref.name) ? 'page' : 'lines',
    async readUnit(_unit, signal): Promise<AgentDocumentUnitResult> {
      assertChatAttachmentScope(options);
      assertChatAttachmentScope({ ...options, signal: signal ?? options.signal });
      return { text: '', status: 'unreadable', reason: closed ? 'source_closed' : ref.reason ?? '附件内容无法读取。' };
    },
    async close() { closed = true; },
  };
}

function base64(bytes: Uint8Array): string {
  // Small chunks avoid spreading a multi-megabyte file onto the call stack.
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  return btoa(chunks.join(''));
}

export interface CapturedChatAttachments {
  refs: ChatAttachmentRef[];
  sources: AgentDocumentSource[];
  imageParts: AiContentPart[];
  unreadable: ChatAttachmentRef[];
  close(): Promise<void>;
}

export async function captureChatAttachments(options: ChatAttachmentScope & { conversationId: string; attachmentIds: readonly string[] }): Promise<CapturedChatAttachments> {
  const records = await getChatAttachmentFiles(options.conversationId, options.attachmentIds, options);
  const sources: AgentDocumentSource[] = [];
  const imageParts: AiContentPart[] = [];
  const unreadable: ChatAttachmentRef[] = [];
  const refs: ChatAttachmentRef[] = [];
  const totalImageBytes = records.filter(record => record.attachment.kind === 'image').reduce((sum, record) => sum + record.attachment.size, 0);
  if (totalImageBytes > CHAT_ATTACHMENT_LIMITS.maxModelImageBytes) throw new Error('模型请求中的图片总大小不能超过 32 MB。');
  try {
    for (const { attachment, file } of records) {
      assertChatAttachmentScope(options);
      let ref = attachment;
      if (ref.kind === 'image') {
        const bytes = new Uint8Array(await browserFileReader(file, options.signal));
        assertChatAttachmentScope(options);
        const mimeType = sniffChatImageMime(bytes);
        if (!mimeType || mimeType !== ref.mimeType) throw new Error('附件图片数据已损坏，请重新上传。');
        imageParts.push({ type: 'image', mimeType, data: base64(bytes) });
      } else {
        if (ref.kind === 'document') {
          try {
            const { openAgentDocumentSource, isAgentDocumentPath, getAgentDocumentVersion } = await import('./document-source');
            assertChatAttachmentScope(options);
            const path = chatAttachmentDocumentPath(ref);
            // Unknown text extensions use the existing plain-text reader while keeping their real identity.
            const openedPath = isAgentDocumentPath(path) || ref.mimeType === 'application/pdf' ? path : `${path}.txt`;
            const source = await openAgentDocumentSource(file, openedPath, options.signal);
            try {
              assertChatAttachmentScope(options);
              const wrapped = scopedSource(source, options, path);
              if (openedPath !== path) {
                const version = await getAgentDocumentVersion(file, path, options.signal);
                sources.push({ ...wrapped, version });
              } else sources.push(wrapped);
            }
            catch (error) { await source.close(); throw error; }
          } catch (error) {
            assertChatAttachmentScope(options);
            ref = { ...ref, kind: 'unreadable', reason: `附件内容无法读取：${error instanceof Error ? error.message : '文档格式无效'}` };
          }
        }
        if (ref.kind === 'unreadable') { unreadable.push(ref); sources.push(unreadableSource(ref, options)); }
      }
      refs.push(ref);
    }
    assertChatAttachmentScope(options);
    return { refs, sources, imageParts, unreadable, async close() { await Promise.all(sources.map(source => source.close())); } };
  } catch (error) {
    await Promise.allSettled(sources.map(source => source.close()));
    throw error;
  }
}
