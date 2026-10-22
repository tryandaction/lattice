import type { Annotation, AnnotationComment, Item, ItemChild, ItemKind, ItemVersion, Library, LibraryMember, LibraryRole, SyncStatus } from "./domain";
import type { CloudLibraryConnection } from "./connection";
import { validateCloudPath } from "./connection";
import type { SharedLibraryItemContent } from "./content-store";
import { cloudArrayBuffer, cloudContentFromBytes } from "./file-content";
import type { CloudPersistence } from "./cloud-persistence";
import { CloudPersistenceConflict } from "./cloud-persistence";
import type { TransportRequest } from "./remote-repository";
import { RemoteRepository } from "./remote-repository";
import { ApiTransport } from "./api-transport";
import { RemoteBlobStore, defaultSha256Hex, type UploadSession } from "./blob-store";
import { SharedLibraryError } from "./errors";
import { can } from "./permissions";
import { createSharedLibrarySearchClient, RemoteSharedLibrarySearchTransport } from "./search-client";
import type { CreateAnnotationInput } from "./repository";

export interface CloudOutboxEntry {
  id: string;
  libraryId: string;
  itemId: string;
  kind: "request" | "content";
  request?: TransportRequest;
  contentKey?: string;
  versionId?: string;
  baseVersionId?: string;
  hash?: string;
  upload?: UploadSession;
  parts?: Array<{ partNumber: number; etag: string }>;
  uploadRecoveryNeeded?: boolean;
  blobId?: string;
  state: "pending" | "paused" | "conflicted" | "failed";
  error?: string;
  remoteVersionId?: string;
  createdAt: string;
}

export interface CloudWorkspaceSnapshot {
  schema: 1;
  revision: number;
  libraries: Library[];
  items: Item[];
  versions: ItemVersion[];
  annotations: Annotation[];
  comments: AnnotationComment[];
  outbox: CloudOutboxEntry[];
  roles: Record<string, { role: LibraryRole; verifiedAt: number }>;
  memberNames?: Record<string, Record<string, string>>;
  revoked: string[];
  cursors: Record<string, string>;
}
export interface CloudLibraryUsage { usedBytes: number; reservedBytes: number; maxStorageBytes: number; maxFileBytes: number }

const initialSnapshot = (): CloudWorkspaceSnapshot => ({ schema: 1, revision: 0, libraries: [], items: [], versions: [], annotations: [], comments: [], outbox: [], roles: {}, revoked: [], cursors: {} });
const now = () => new Date().toISOString();
const bytes = (content: SharedLibraryItemContent): ArrayBuffer => content.kind === "binary" ? content.data : new TextEncoder().encode(content.text).buffer;
const parentId = (item: Item) => typeof item.metadata.parentItemId === "string" ? item.metadata.parentItemId : undefined;

/** Local-first product controller. HTTP execution, durable projection and UI state share this boundary. */
export class CloudLibraryWorkspaceController {
  private snapshot = initialSnapshot();
  private tail: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private disposed = false;
  private syncing: Promise<void> | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private status: SyncStatus = "offline";
  private error: string | null = null;
  private unreachableUntil = 0;
  private started = false;
  private wakeRequested = false;
  private readonly observedLibraries = new Set<string>();
  private readonly repository: RemoteRepository;
  readonly searchClient: ReturnType<typeof createSharedLibrarySearchClient>;

  constructor(readonly connection: CloudLibraryConnection, readonly userId: string, private readonly persistence: CloudPersistence<CloudWorkspaceSnapshot>, readonly transport: ApiTransport, private readonly physicalOnline = () => typeof navigator === "undefined" || navigator.onLine !== false) {
    this.repository = new RemoteRepository(transport);
    this.searchClient = createSharedLibrarySearchClient(new RemoteSharedLibrarySearchTransport(transport));
  }
  private online() { return this.physicalOnline() && Date.now() >= this.unreachableUntil; }
  async initialize() { this.snapshot = await this.persistence.load() ?? initialSnapshot(); this.emit(); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  getStatus = () => ({ status: this.status, error: this.error, pending: this.snapshot.outbox.length });
  private emit() { for (const listener of this.listeners) listener(); }
  private assertLive() { if (this.disposed) throw new Error("云端身份已关闭，请重新打开连接。"); }
  private guard(signal?: AbortSignal) { this.assertLive(); if (signal?.aborted) throw new DOMException("云资源读取已取消", "AbortError"); }
  private transaction<T>(update: (draft: CloudWorkspaceSnapshot) => T, contents: ReadonlyArray<{ key: string; content: SharedLibraryItemContent | null }> = []): Promise<T> {
    const run = this.tail.then(async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        this.assertLive();
        const revision = this.snapshot.revision ?? 0;
        const draft = structuredClone(this.snapshot);
        const result = update(draft); draft.revision = revision + 1;
        try {
          await this.persistence.commit(draft, contents, revision);
          const shouldWake = draft.outbox.some(entry => entry.state === "pending" && !this.snapshot.outbox.some(previous => previous.id === entry.id && previous.state === "pending"));
          this.snapshot = draft; this.emit();
          if (this.started && shouldWake) { this.wakeRequested = true; queueMicrotask(() => { if (!this.disposed) void this.sync(); }); }
          return result;
        } catch (error) {
          if (!(error instanceof CloudPersistenceConflict)) throw error;
          this.snapshot = await this.persistence.load() ?? initialSnapshot();
        }
      }
      throw new Error("云库多窗口保存持续冲突，操作尚未保存，请重试。");
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
  async request<T>(request: TransportRequest): Promise<T> {
    this.assertLive();
    const response = await this.transport.request(request);
    this.assertLive();
    const body = response.body;
    return (body && typeof body === "object" && "data" in body ? (body as { data: unknown }).data : body) as T;
  }
  async verifyAccess(libraryId: string, signal?: AbortSignal): Promise<LibraryRole> {
    this.guard(signal);
    if (this.snapshot.revoked.includes(libraryId)) throw new Error("该库访问已撤销；本机缓存已隔离。");
    if (!this.online()) {
      const lease = this.snapshot.roles[libraryId];
      if (!lease || Date.now() - lease.verifiedAt > 24 * 3600_000) throw new Error("离线授权已过期，请联网验证成员资格。");
      return lease.role;
    }
    try {
      const member = await this.request<LibraryMember>({ method: "GET", path: `/v1/libraries/${encodeURIComponent(libraryId)}/members/me`, signal });
      if (member.userId !== this.userId) throw new SharedLibraryError({ code: "UNAUTHORIZED", message: "服务端身份与当前缓存账号不一致，已停止访问。", status: 401 });
      if (member.status !== "active") throw new SharedLibraryError({ code: "FORBIDDEN", message: "成员资格已撤销", status: 403 });
      await this.transaction(draft => { draft.roles[libraryId] = { role: member.role, verifiedAt: Date.now() }; if (member.displayName) { draft.memberNames ??= {}; draft.memberNames[libraryId] ??= {}; draft.memberNames[libraryId][member.userId] = member.displayName; } });
      return member.role;
    } catch (error) {
      // A tab switch can cancel its read; that says nothing about connectivity.
      if (signal?.aborted || (error as { name?: string })?.name === "AbortError") throw error;
      if (error instanceof SharedLibraryError && (error.status === 403 || error.status === 404)) {
        await this.transaction(draft => { draft.revoked.push(libraryId); delete draft.roles[libraryId]; });
      }
      const status = (error as { status?: number }).status;
      const transient = error instanceof SharedLibraryError ? error.retryable && ["NETWORK_ERROR", "DATABASE_ERROR", "STORAGE_UNAVAILABLE"].includes(error.code) : error instanceof TypeError || (status !== undefined && status >= 500);
      const lease = this.snapshot.roles[libraryId];
      if (transient && lease && Date.now() - lease.verifiedAt <= 24 * 3600_000) {
        this.unreachableUntil = Date.now() + 10000;
        this.status = "offline"; this.error = error instanceof Error ? error.message : String(error); this.emit();
        return lease.role;
      }
      throw error;
    }
  }
  async refreshLibraries() {
    if (!this.online()) return this.snapshot.libraries.filter(l => !this.snapshot.revoked.includes(l.id));
    const libraries = await this.repository.listLibraries();
    await this.transaction(draft => { draft.libraries = libraries; });
    return libraries;
  }
  async createLibrary(name: string, organizationId?: string) {
    const library = await this.repository.createLibrary({ name, organizationId, visibility: "private", slug: `library-${crypto.randomUUID()}` });
    await this.transaction(draft => { draft.libraries.push(library); });
    await this.verifyAccess(library.id);
    return library;
  }
  async refreshLibrary(libraryId: string, signal?: AbortSignal) {
    this.observedLibraries.add(libraryId);
    await this.verifyAccess(libraryId, signal);
    if (!this.online()) return;
    let hasMore = true;
    while (hasMore) {
      const cursor = this.snapshot.cursors[libraryId] ?? "0";
      const page = await this.request<{ changes: Array<{ sequence: string; type: "item" | "annotation" | "comment"; value: Item | Annotation | AnnotationComment }>; cursor: string; hasMore: boolean }>({ method: "GET", path: `/v1/libraries/${encodeURIComponent(libraryId)}/changes`, query: { cursor, limit: 200 }, signal });
      await this.transaction(draft => {
        if (BigInt(page.cursor) < BigInt(draft.cursors[libraryId] ?? "0")) return;
        const pendingItems = new Set(draft.outbox.filter(o => o.libraryId === libraryId).map(o => o.itemId));
        const pendingEntities = new Set(draft.outbox.flatMap(o => { const body = o.request?.body as { id?: string; annotation?: { id: string } } | undefined; return body ? [body.id, body.annotation?.id] : []; }));
        for (const change of page.changes) {
          if (change.type === "item") { const item = change.value as Item; if (!pendingItems.has(item.id)) draft.items = [...draft.items.filter(i => i.id !== item.id), item]; }
          else if (change.type === "annotation") { const annotation = change.value as Annotation; if (!pendingEntities.has(annotation.id)) draft.annotations = [...draft.annotations.filter(a => a.id !== annotation.id), annotation]; }
          else { const comment = change.value as AnnotationComment; if (!pendingEntities.has(comment.id)) draft.comments = [...draft.comments.filter(c => c.id !== comment.id), comment]; }
        }
        draft.cursors[libraryId] = page.cursor;
      });
      if (page.hasMore && page.cursor === cursor) throw new Error("云端增量游标未前进，请检查服务版本。");
      hasMore = page.hasMore;
      this.guard(signal);
    }
  }
  async list(libraryId: string, parentItemId?: string, signal?: AbortSignal) {
    await this.refreshLibrary(libraryId, signal);
    this.guard(signal);
    return this.snapshot.items.filter(i => i.libraryId === libraryId && i.status !== "trashed" && parentId(i) === parentItemId);
  }
  async readResource(libraryId: string, itemId: string, signal?: AbortSignal): Promise<{ item: Item; role: LibraryRole; content: SharedLibraryItemContent | null }> {
    const role = await this.verifyAccess(libraryId, signal);
    const item = this.snapshot.items.find(i => i.id === itemId && i.libraryId === libraryId && i.status !== "trashed");
    if (!item) throw new Error("云库文件不存在或未授权。");
    const pending = [...this.snapshot.outbox].reverse().find(o => o.itemId === itemId && o.kind === "content");
    if (pending?.contentKey) { const content = await this.persistence.content(pending.contentKey); this.guard(signal); return { item: structuredClone(item), role, content }; }
    if (!this.online()) { const content = await this.persistence.content(`cache:${itemId}:${item.contentHash}`); this.guard(signal); return { item: structuredClone(item), role, content }; }
    const current = await this.request<Item>({ method: "GET", path: `/v1/items/${encodeURIComponent(itemId)}`, signal });
    if (current.libraryId !== libraryId || current.status === "trashed") throw new Error("文件访问已失效。");
    const key = `cache:${itemId}:${current.contentHash}`;
    const cached = await this.persistence.content(key);
    let content = cached;
    if (!content && current.currentVersionId) {
      const versions = await this.request<ItemVersion[]>({ method: "GET", path: `/v1/items/${encodeURIComponent(itemId)}/versions`, signal });
      const version = versions.find(v => v.id === current.currentVersionId);
      if (!version || version.contentHash !== current.contentHash) throw new Error("内容版本元数据不一致，请刷新重试。");
      if (version.blobId) {
        const response = await this.transport.request({ method: "GET", path: `/v1/libraries/${encodeURIComponent(libraryId)}/blobs/${encodeURIComponent(version.blobId)}/content`, responseType: "arrayBuffer", signal });
        const data = cloudArrayBuffer(response.body);
        if (!data) throw new Error("云端返回的文件内容不是有效的二进制数据。");
        const mimeType = typeof version.manifest.mimeType === "string" ? version.manifest.mimeType : "application/octet-stream";
        content = cloudContentFromBytes(current.canonicalName, data, mimeType, version.createdAt);
      }
    }
    this.guard(signal);
    if (content && current.contentHash && await defaultSha256Hex(bytes(content)) !== current.contentHash) throw new Error("下载内容 hash 不匹配，未写入缓存。");
    await this.transaction(draft => { const index = draft.items.findIndex(i => i.id === itemId); if (index >= 0 && !draft.outbox.some(o => o.itemId === itemId)) draft.items[index] = current; }, content && !cached ? [{ key, content }] : []);
    this.guard(signal);
    return { item: current, role, content };
  }
  async readContent(libraryId: string, itemId: string, signal?: AbortSignal) { return (await this.readResource(libraryId, itemId, signal)).content; }
  async assertCurrentVersion(libraryId: string, itemId: string, expectedVersion: string) {
    await this.verifyAccess(libraryId);
    const item = this.online() ? await this.repository.getItem(itemId) : this.snapshot.items.find(i => i.id === itemId && i.libraryId === libraryId);
    if (!item || item.libraryId !== libraryId || item.status !== "active" || item.currentVersionId !== expectedVersion) throw new Error("文件源版本已变化；请重新载入后添加批注或子文件。");
  }
  async createChild(libraryId: string, parentItemId: string, input: { name: string; kind: ItemKind; content: SharedLibraryItemContent; expectedParentVersion: string }, signal?: AbortSignal) {
    this.guard(signal);
    await this.writable(libraryId, "item.create");
    const parent = this.online() ? await this.request<Item>({ method: "GET", path: `/v1/items/${encodeURIComponent(parentItemId)}`, signal }) : this.snapshot.items.find(i => i.id === parentItemId && i.libraryId === libraryId);
    if (!parent || parent.libraryId !== libraryId || parent.status !== "active" || parent.currentVersionId !== input.expectedParentVersion) throw new Error("父文件版本已变化或未授权，请重新读取后创建子文件。");
    this.guard(signal);
    return this.createItem({ libraryId, name: input.name, kind: input.kind, parentItemId }, input.content, input.expectedParentVersion);
  }
  private async writable(libraryId: string, capability: "item.create" | "item.update" | "item.delete" | "annotation.create" | "comment.create") {
    if (!can(await this.verifyAccess(libraryId), capability)) throw new Error("当前角色没有此操作权限。");
  }
  async createItem(input: { libraryId: string; name: string; kind: ItemKind; parentItemId?: string }, content?: SharedLibraryItemContent, expectedParentVersion?: string) {
    await this.writable(input.libraryId, "item.create");
    const name = validateCloudPath(input.name);
    if (name.includes("/")) throw new Error("名称必须是单个文件名，目录请逐层创建。");
    if (input.parentItemId && !this.snapshot.items.some(i => i.id === input.parentItemId && i.libraryId === input.libraryId && i.status === "active")) throw new Error("父条目不在当前库。");
    const item: Item = { id: crypto.randomUUID(), libraryId: input.libraryId, title: name, canonicalName: name, kind: input.kind, metadata: input.parentItemId ? { parentItemId: input.parentItemId, ...(expectedParentVersion ? { expectedParentVersion } : {}) } : {}, status: "active", createdBy: this.userId, createdAt: now(), updatedAt: now() };
    const entry: CloudOutboxEntry = { id: crypto.randomUUID(), libraryId: item.libraryId, itemId: item.id, kind: "request", request: { method: "POST", path: `/v1/libraries/${encodeURIComponent(item.libraryId)}/items`, body: { ...item, parentItemId: input.parentItemId } }, state: "pending", createdAt: now() };
    const contentEntry = content ? await this.contentEntry(item, content) : undefined;
    await this.transaction(draft => {
      if (draft.items.some(i => i.libraryId === item.libraryId && parentId(i) === input.parentItemId && i.canonicalName === name && i.status !== "trashed")) throw new Error("此目录已存在同名文件，请先改名。");
      draft.items.push(contentEntry ? { ...item, currentVersionId: contentEntry.versionId, contentHash: contentEntry.hash } : item);
      draft.outbox.push(entry);
      if (contentEntry) draft.outbox.push(contentEntry);
    }, contentEntry && content ? [{ key: contentEntry.contentKey!, content }] : []);
    return this.snapshot.items.find(i => i.id === item.id)!;
  }
  private async contentEntry(item: Item, content: SharedLibraryItemContent): Promise<CloudOutboxEntry> {
    const data = bytes(content);
    if (data.byteLength > this.connection.maxFileBytes) throw new Error(`文件超过连接的单文件限额 ${this.connection.maxFileBytes} bytes。`);
    const id = crypto.randomUUID();
    return { id, libraryId: item.libraryId, itemId: item.id, kind: "content", contentKey: `operation:${id}`, versionId: crypto.randomUUID(), baseVersionId: item.currentVersionId, hash: await defaultSha256Hex(data), state: "pending", createdAt: now() };
  }
  async save(libraryId: string, itemId: string, content: SharedLibraryItemContent, expectedVersionId?: string) {
    await this.writable(libraryId, "item.update");
    const item = this.snapshot.items.find(i => i.id === itemId && i.libraryId === libraryId);
    if (!item) throw new Error("文件不存在。");
    const entry = await this.contentEntry(item, content);
    if (entry.hash === item.contentHash) return item.currentVersionId;
    await this.transaction(draft => {
      const current = draft.items.find(i => i.id === itemId)!;
      entry.baseVersionId = expectedVersionId ?? current.currentVersionId;
      current.currentVersionId = entry.versionId; current.contentHash = entry.hash; current.updatedAt = now();
      draft.outbox.push(entry);
    }, [{ key: entry.contentKey!, content }]);
    return entry.versionId;
  }
  async updateItem(libraryId: string, itemId: string, name: string, newParentId?: string) {
    await this.writable(libraryId, "item.update");
    validateCloudPath(name);
    if (name.includes("/")) throw new Error("名称不能含目录分隔符。");
    await this.transaction(draft => {
      const item = draft.items.find(i => i.id === itemId && i.libraryId === libraryId);
      if (!item) throw new Error("文件不存在。");
      let ancestor = newParentId;
      const seen = new Set([itemId]);
      while (ancestor) {
        if (seen.has(ancestor)) throw new Error("不能移动到自身或子目录。");
        seen.add(ancestor);
        const parent = draft.items.find(i => i.id === ancestor && i.libraryId === libraryId && i.status === "active");
        if (!parent) throw new Error("目标父条目不在当前库。");
        ancestor = parentId(parent);
      }
      if (draft.items.some(i => i.id !== itemId && i.libraryId === libraryId && parentId(i) === newParentId && i.canonicalName === name && i.status !== "trashed")) throw new Error("目标目录已存在同名文件。");
      item.title = name; item.canonicalName = name; item.metadata = { ...item.metadata, parentItemId: newParentId ?? null }; item.updatedAt = now();
      draft.outbox.push({ id: crypto.randomUUID(), libraryId, itemId, kind: "request", request: { method: "PATCH", path: `/v1/items/${encodeURIComponent(itemId)}`, body: { title: name, canonicalName: name, metadata: item.metadata } }, state: "pending", createdAt: now() });
    });
  }
  async listChildren(libraryId: string, itemId: string): Promise<ItemChild[]> {
    await this.verifyAccess(libraryId);
    return this.snapshot.items.filter(i => i.libraryId === libraryId && parentId(i) === itemId && i.status === "active").map(i => ({ parentItemId: itemId, childItemId: i.id, relativePath: i.canonicalName, kind: i.kind, sortKey: i.canonicalName, createdAt: i.createdAt, updatedAt: i.updatedAt }));
  }
  async trashItem(libraryId: string, itemId: string) {
    await this.writable(libraryId, "item.delete");
    await this.transaction(draft => {
      const item = draft.items.find(item => item.id === itemId && item.libraryId === libraryId && item.status === "active");
      if (!item) throw new Error("文件不存在。");
      if (draft.items.some(child => parentId(child) === itemId && child.status === "active")) throw new Error("请先移除文件夹中的文件，再删除空文件夹。");
      item.status = "trashed"; item.updatedAt = now();
      draft.outbox.push({ id: crypto.randomUUID(), libraryId, itemId, kind: "request", request: { method: "DELETE", path: `/v1/items/${encodeURIComponent(itemId)}` }, state: "pending", createdAt: now() });
    });
  }
  async annotations(libraryId: string, itemId: string) {
    await this.verifyAccess(libraryId);
    if (this.online()) {
      const entries = await this.repository.listAnnotations(itemId);
      await this.transaction(draft => {
        const pending = new Set(draft.outbox.filter(o => o.itemId === itemId).map(o => (o.request?.body as { id?: string })?.id));
        draft.annotations = [...draft.annotations.filter(a => a.itemId !== itemId || pending.has(a.id)), ...entries.filter(a => !pending.has(a.id))];
      });
    }
    return this.snapshot.annotations.filter(a => a.itemId === itemId && a.status !== "deleted");
  }
  async createAnnotation(libraryId: string, input: CreateAnnotationInput) {
    await this.writable(libraryId, "annotation.create");
    const displayName = this.snapshot.memberNames?.[libraryId]?.[this.userId];
    const annotationBody = { ...input.body }; delete annotationBody.authorDisplayName;
    const annotation: Annotation = { ...input, id: crypto.randomUUID(), authorId: this.userId, body: { ...annotationBody, ...(displayName ? { authorDisplayName: displayName } : {}) }, revision: 1, status: "active", createdAt: now(), updatedAt: now() };
    await this.transaction(draft => {
      draft.annotations.push(annotation);
      draft.outbox.push({ id: crypto.randomUUID(), libraryId, itemId: input.itemId, kind: "request", request: { method: "POST", path: `/v1/items/${encodeURIComponent(input.itemId)}/annotations`, body: annotation }, state: "pending", createdAt: now() });
    });
    return annotation;
  }
  async persistAnnotations(libraryId: string, itemId: string, upserts: Annotation[], removeIds: string[]) {
    await this.writable(libraryId, "annotation.create");
    await this.transaction(draft => {
      for (const annotation of upserts) {
        const id = annotation.id.startsWith("ann-") ? annotation.id.slice(4) : annotation.id;
        const existing = draft.annotations.find(a => a.id === annotation.id || a.id === id);
        if (existing && existing.authorId !== this.userId && !can(draft.roles[libraryId].role, "comment.editOthers")) throw new Error("不能修改其他成员批注。");
        const displayName = existing?.body.authorDisplayName ?? draft.memberNames?.[libraryId]?.[this.userId];
        const annotationBody = { ...existing?.body, ...annotation.body }; delete annotationBody.authorDisplayName;
        const next = { ...annotation, id, itemId, authorId: existing?.authorId ?? this.userId, body: { ...annotationBody, ...(displayName ? { authorDisplayName: displayName } : {}) }, revision: (existing?.revision ?? 0) + 1, updatedAt: now() };
        draft.annotations = [...draft.annotations.filter(a => a.id !== annotation.id && a.id !== id), next];
        draft.outbox.push({ id: crypto.randomUUID(), libraryId, itemId, kind: "request", state: "pending", createdAt: now(), request: { method: "POST", path: `/v1/items/${encodeURIComponent(itemId)}/annotation-mutations`, body: { annotation: next, baseRevision: existing?.revision ?? 0 } } });
      }
      for (const id of removeIds) {
        const existing = draft.annotations.find(a => a.id === id);
        if (!existing) continue;
        if (existing.authorId !== this.userId && !can(draft.roles[libraryId].role, "comment.editOthers")) throw new Error("不能删除其他成员批注。");
        existing.status = "deleted";
        draft.outbox.push({ id: crypto.randomUUID(), libraryId, itemId, kind: "request", state: "pending", createdAt: now(), request: { method: "POST", path: `/v1/items/${encodeURIComponent(itemId)}/annotation-mutations`, body: { annotation: existing, baseRevision: existing.revision, deleted: true } } });
      }
    });
  }
  async comments(libraryId: string, annotationId: string) {
    await this.verifyAccess(libraryId);
    if (this.online()) {
      const entries = await this.repository.listComments(annotationId);
      await this.transaction(draft => {
        const pending = new Set(draft.outbox.filter(o => o.request?.path === `/v1/annotations/${encodeURIComponent(annotationId)}/comments`).map(o => (o.request?.body as { id?: string })?.id));
        draft.comments = [...draft.comments.filter(c => c.annotationId !== annotationId || pending.has(c.id)), ...entries.filter(c => !pending.has(c.id))];
      });
    }
    return this.snapshot.comments.filter(c => c.annotationId === annotationId && !c.deletedAt);
  }
  async createComment(libraryId: string, itemId: string, annotationId: string, body: string, parentId?: string) {
    await this.writable(libraryId, "comment.create");
    if (!body.trim() || body.length > 20000) throw new Error("评论内容须为1–20000字符。");
    const comment: AnnotationComment = { id: crypto.randomUUID(), annotationId, parentId, authorId: this.userId, body, createdAt: now() };
    await this.transaction(draft => {
      draft.comments.push(comment);
      draft.outbox.push({ id: crypto.randomUUID(), libraryId, itemId, kind: "request", state: "pending", createdAt: now(), request: { method: "POST", path: `/v1/annotations/${encodeURIComponent(annotationId)}/comments`, body: comment } });
    });
  }
  async members(libraryId: string) {
    await this.verifyAccess(libraryId);
    const members = await this.request<LibraryMember[]>({ method: "GET", path: `/v1/libraries/${encodeURIComponent(libraryId)}/members` });
    await this.transaction(draft => { draft.memberNames ??= {}; draft.memberNames[libraryId] = Object.fromEntries(members.filter(member => member.displayName).map(member => [member.userId, member.displayName!])); });
    return members;
  }
  async setDisplayName(libraryId: string, displayName: string) {
    const member = await this.request<LibraryMember>({ method: "PATCH", path: `/v1/libraries/${encodeURIComponent(libraryId)}/members/me`, body: { displayName } });
    await this.transaction(draft => { draft.memberNames ??= {}; draft.memberNames[libraryId] ??= {}; if (member.displayName) draft.memberNames[libraryId][this.userId] = member.displayName; });
    return member;
  }
  async usage(libraryId: string) {
    await this.verifyAccess(libraryId);
    const result = await this.request<CloudLibraryUsage>({ method: "GET", path: `/v1/libraries/${encodeURIComponent(libraryId)}/usage` });
    if ([result.usedBytes, result.reservedBytes, result.maxStorageBytes, result.maxFileBytes].some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("云端返回的库额度无效，请检查Worker及migration版本。");
    return result;
  }
  async invite(libraryId: string, email: string, role: LibraryRole) { return this.request<{ token: string; id: string; expiresAt: string }>({ method: "POST", path: `/v1/libraries/${encodeURIComponent(libraryId)}/invitations`, body: { email, role } }); }
  async acceptInvite(token: string) { const result = await this.request<{ libraryId: string }>({ method: "POST", path: "/v1/invitations/accept", body: { token } }); await this.transaction(draft => { draft.revoked = draft.revoked.filter(id => id !== result.libraryId); }); return result; }
  async changeMember(libraryId: string, userId: string, role?: LibraryRole) { await this.request({ method: role ? "PATCH" : "DELETE", path: `/v1/libraries/${encodeURIComponent(libraryId)}/members/${encodeURIComponent(userId)}`, ...(role ? { body: { role } } : {}) }); }
  async suspendMember(libraryId: string, userId: string) { await this.request({ method: "PATCH", path: `/v1/libraries/${encodeURIComponent(libraryId)}/members/${encodeURIComponent(userId)}`, body: { status: "suspended" } }); }
  async invitations(libraryId: string) { return this.request<Array<{ id: string; email: string; role: LibraryRole; status: string; expires_at: string }>>({ method: "GET", path: `/v1/libraries/${encodeURIComponent(libraryId)}/invitations` }); }
  async revokeInvitation(libraryId: string, invitationId: string) { await this.request({ method: "DELETE", path: `/v1/libraries/${encodeURIComponent(libraryId)}/invitations/${encodeURIComponent(invitationId)}` }); }
  async pause(operationId: string) { await this.transaction(draft => { const op = draft.outbox.find(o => o.id === operationId); if (op) op.state = "paused"; }); }
  async retry(operationId: string) {
    const entry = this.snapshot.outbox.find(operation => operation.id === operationId);
    if (entry?.uploadRecoveryNeeded) { await this.restartExpiredUpload(structuredClone(entry), ""); return; }
    await this.transaction(draft => { const op = draft.outbox.find(o => o.id === operationId); if (op) { op.state = "pending"; delete op.error; } });
  }
  private async restartExpiredUpload(entry: CloudOutboxEntry, message: string) {
    if (entry.upload) await new RemoteBlobStore(this.transport, { libraryId: entry.libraryId }).abortUpload(entry.upload.uploadId);
    const replacementId = crypto.randomUUID();
    await this.transaction(draft => { const operation = draft.outbox.find(o => o.id === entry.id); if (operation) Object.assign(operation, { id: replacementId, state: "pending", error: message, upload: undefined, parts: undefined, blobId: undefined, uploadRecoveryNeeded: undefined }); });
  }
  private async checkpoint(id: string, patch: Partial<CloudOutboxEntry>) { await this.transaction(draft => { const op = draft.outbox.find(o => o.id === id); if (op) Object.assign(op, patch); }); }
  private async upload(entry: CloudOutboxEntry) {
    const content = await this.persistence.content(entry.contentKey!);
    if (!content) throw new Error("持久化上传内容缺失，操作保留供恢复。");
    const data = bytes(content);
    const blob = new RemoteBlobStore(this.transport, { libraryId: entry.libraryId });
    const item = this.snapshot.items.find(i => i.id === entry.itemId)!;
    if (!entry.blobId && !entry.upload) {
      const existing = await this.request<{ blobId?: string }>({ method: "GET", path: `/v1/libraries/${encodeURIComponent(entry.libraryId)}/blobs/find`, query: { hash: entry.hash! } });
      if (existing.blobId) { entry.blobId = existing.blobId; await this.checkpoint(entry.id, { blobId: entry.blobId }); }
    }
    if (!entry.blobId && !entry.upload) {
      entry.upload = await blob.createUpload({ libraryId: entry.libraryId, fileName: item.canonicalName, mimeType: content.mimeType, sizeBytes: data.byteLength, idempotencyKey: entry.id });
      await this.checkpoint(entry.id, { upload: entry.upload });
    }
    const parts = entry.parts ?? [];
    const size = entry.upload?.partSize ?? 5 * 1024 * 1024;
    if (!Number.isSafeInteger(size) || size < 1) throw new Error("云端上传分片大小无效，操作保留供恢复。");
    for (let offset = 0, partNumber = 1; !entry.blobId && offset < Math.max(data.byteLength, 1); offset += size, partNumber++) {
      this.assertLive();
      if (this.snapshot.outbox.find(o => o.id === entry.id)?.state !== "pending") return false;
      if (parts.some(p => p.partNumber === partNumber)) continue;
      const uploaded = await blob.uploadPart({ uploadId: entry.upload!.uploadId, partNumber, data: data.slice(offset, offset + size) });
      parts.push(uploaded);
      await this.checkpoint(entry.id, { parts: [...parts] });
    }
    if (this.snapshot.outbox.find(o => o.id === entry.id)?.state !== "pending") return false;
    if (!entry.blobId) { entry.blobId = (await blob.completeUpload({ uploadId: entry.upload!.uploadId, sha256: entry.hash!, parts })).blobId; await this.checkpoint(entry.id, { blobId: entry.blobId }); }
    const response = await this.request<ItemVersion>({ method: "POST", path: `/v1/items/${encodeURIComponent(entry.itemId)}/versions`, idempotencyKey: entry.id, body: { id: entry.versionId, blobId: entry.blobId, baseVersionId: entry.baseVersionId ?? null, contentHash: entry.hash, manifest: { mimeType: content.mimeType, sizeBytes: data.byteLength } } });
    if (content.kind === "text" && data.byteLength <= 1024 * 1024) {
      await this.request({ method: "POST", path: `/v1/items/${encodeURIComponent(entry.itemId)}/index-text`, body: { versionId: response.id, text: content.text } });
    }
    await this.transaction(draft => { draft.versions = [...draft.versions.filter(v => v.id !== response.id), response]; }, [{ key: `cache:${entry.itemId}:${entry.hash}`, content }]);
    return true;
  }
  async sync() {
    if (this.syncing) return this.syncing;
    this.wakeRequested = false;
    this.syncing = this.runSync().finally(() => { this.syncing = null; if (this.started && this.wakeRequested && !this.disposed) queueMicrotask(() => { void this.sync(); }); });
    return this.syncing;
  }
  private async runSync() {
    this.assertLive();
    if (!this.online()) { this.status = "offline"; this.emit(); return; }
    this.status = "syncing"; this.error = null; this.emit();
    try {
      const blocked = new Set<string>();
      for (const original of [...this.snapshot.outbox]) {
        this.assertLive();
        const entry = structuredClone(this.snapshot.outbox.find(o => o.id === original.id)!);
        if (blocked.has(entry.itemId)) continue;
        if (entry.state !== "pending") { blocked.add(entry.itemId); continue; }
        try {
          await this.verifyAccess(entry.libraryId);
          if (entry.kind === "content") { if (!await this.upload(entry)) { blocked.add(entry.itemId); continue; } }
          else await this.request({ ...entry.request!, idempotencyKey: entry.id });
          await this.transaction(draft => { draft.outbox = draft.outbox.filter(o => o.id !== entry.id); });
        } catch (error) {
          if (this.disposed) throw error;
          const message = error instanceof Error ? error.message : String(error);
          const conflict = error instanceof SharedLibraryError && error.status === 409;
          if (conflict) {
            const remote = await this.repository.getItem(entry.itemId);
            await this.checkpoint(entry.id, { state: "conflicted", error: message, remoteVersionId: remote.currentVersionId });
          } else if (error instanceof SharedLibraryError && !error.retryable) {
            if (error.code === "UPLOAD_EXPIRED") await this.restartExpiredUpload(entry, message);
            else await this.checkpoint(entry.id, { state: "failed", error: message, ...(error.code === "UPLOAD_HASH_MISMATCH" && !entry.blobId ? { uploadRecoveryNeeded: true } : {}) });
          } else { await this.checkpoint(entry.id, { error: message }); throw error; }
          blocked.add(entry.itemId);
        }
      }
      const libraries = new Set([...this.observedLibraries, ...this.snapshot.outbox.map(o => o.libraryId)]);
      for (const id of libraries) { if (!this.snapshot.revoked.includes(id)) await this.refreshLibrary(id); }
      this.status = this.snapshot.outbox.some(o => o.state === "conflicted") ? "conflicted" : this.snapshot.outbox.some(o => o.state === "failed") ? "failed" : this.snapshot.outbox.length ? "offline" : "synced";
    } catch (error) {
      this.status = this.online() ? "failed" : "offline";
      this.error = error instanceof Error ? error.message : String(error);
    } finally { if (!this.disposed) this.emit(); }
  }
  async resolveConflict(id: string, choice: "remote" | "local" | "copy") {
    const operation = this.snapshot.outbox.find(o => o.id === id && o.state === "conflicted");
    if (!operation) throw new Error("冲突不存在。");
    const annotationMutation = Boolean((operation.request?.body as { annotation?: Annotation } | undefined)?.annotation);
    await this.writable(operation.libraryId, annotationMutation ? "annotation.create" : "item.update");
    // Resolve only after dependent edits are visible; do not silently delete subsequent saves.
    if (this.snapshot.outbox.some(o => o.itemId === operation.itemId && o.id !== id && o.baseVersionId === operation.versionId)) throw new Error("此版本还有后续离线编辑，请先导出副本后处理冲突。");
    const remote = await this.repository.getItem(operation.itemId);
    const annotationPayload = operation.request?.body && typeof operation.request.body === "object"
      ? (operation.request.body as { annotation?: Annotation; baseRevision?: number })
      : null;
    if (annotationPayload?.annotation && choice === "local") {
      const remoteAnnotations = await this.repository.listAnnotations(operation.itemId);
      const remoteAnnotation = remoteAnnotations.find(candidate => candidate.id === annotationPayload.annotation!.id);
      if (!remoteAnnotation) throw new Error("远端批注已删除，请选择另存副本。");
      await this.transaction(draft => {
        const entry = draft.outbox.find(candidate => candidate.id === id);
        const body = entry?.request?.body;
        if (!body || typeof body !== "object") return;
        const payload = body as { annotation: Annotation; baseRevision?: number };
        payload.baseRevision = remoteAnnotation.revision;
        payload.annotation = { ...payload.annotation, versionId: remoteAnnotation.versionId, revision: remoteAnnotation.revision };
        if (entry) { entry.state = "pending"; delete entry.error; }
      });
    } else if (annotationPayload?.annotation && choice === "remote") {
      await this.transaction(draft => {
        draft.outbox = draft.outbox.filter(candidate => candidate.id !== id);
        draft.annotations = draft.annotations.filter(candidate => candidate.id !== annotationPayload.annotation!.id);
      });
    } else if (annotationPayload?.annotation && choice === "copy") {
      const copy = { ...annotationPayload.annotation, id: crypto.randomUUID(), body: { ...annotationPayload.annotation.body, copiedFrom: annotationPayload.annotation.id } };
      await this.transaction(draft => {
        draft.outbox = draft.outbox.filter(candidate => candidate.id !== id);
        draft.annotations.push(copy);
        draft.outbox.push({ id: crypto.randomUUID(), libraryId: operation.libraryId, itemId: operation.itemId, kind: "request", state: "pending", createdAt: now(), request: { method: "POST", path: `/v1/items/${encodeURIComponent(operation.itemId)}/annotation-mutations`, body: { annotation: copy, baseRevision: 0 } } });
      });
    } else if (choice === "local") {
      await this.checkpoint(id, { baseVersionId: remote.currentVersionId, state: "pending", error: undefined });
    } else if (choice === "copy") {
      const item = this.snapshot.items.find(i => i.id === operation.itemId)!;
      const content = await this.persistence.content(operation.contentKey!);
      if (!content) throw new Error("本地冲突内容缺失。");
      await this.createItem({ libraryId: item.libraryId, name: `${item.canonicalName}.conflict-${crypto.randomUUID().slice(0, 8)}`, kind: item.kind, parentItemId: parentId(item) }, content);
      await this.transaction(draft => { draft.outbox = draft.outbox.filter(o => o.id !== id); draft.items = draft.items.map(i => i.id === remote.id ? remote : i); });
    } else {
      // Immutable op bytes remain in durable storage as a recoverable local version.
      await this.transaction(draft => { draft.outbox = draft.outbox.filter(o => o.id !== id); draft.items = draft.items.map(i => i.id === remote.id ? remote : i); });
    }
  }
  start(interval = 30000) {
    if (this.started) return;
    this.started = true;
    const run = async () => { if (this.disposed) return; await this.sync(); if (!this.disposed) this.timer = setTimeout(() => { void run(); }, interval); };
    void run();
  }
  dispose() { this.disposed = true; if (this.timer) clearTimeout(this.timer); this.listeners.clear(); }
}
