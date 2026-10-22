export class SourceTestFile {
  readonly kind = 'file' as const;
  reads = 0;
  writes = 0;
  constructor(public name: string, public content: string, public lastModified = 1) {}
  async getFile(): Promise<File> { this.reads++; return new File([this.content], this.name, { lastModified: this.lastModified }); }
  async createWritable() {
    let pending = this.content;
    return { write: async (value: string) => { pending = value; }, close: async () => { this.content = pending; this.writes++; }, abort: async () => {} };
  }
}
export class SourceTestDirectory {
  readonly kind = 'directory' as const;
  entries = new Map<string, SourceTestDirectory | SourceTestFile>();
  permission: PermissionState = 'granted';
  constructor(public name: string) {}
  async queryPermission() { return this.permission; }
  async *values() { for (const value of this.entries.values()) yield value; }
  add<T extends SourceTestDirectory | SourceTestFile>(value: T): T { this.entries.set(value.name, value); return value; }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<SourceTestDirectory> {
    if (this.permission !== 'granted') throw new DOMException('Denied', 'NotAllowedError');
    let value = this.entries.get(name);
    if (!value && options?.create) value = this.add(new SourceTestDirectory(name));
    if (!value || value.kind !== 'directory') throw new DOMException('Missing directory', 'NotFoundError');
    return value;
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<SourceTestFile> {
    if (this.permission !== 'granted') throw new DOMException('Denied', 'NotAllowedError');
    let value = this.entries.get(name);
    if (!value && options?.create) value = this.add(new SourceTestFile(name, ''));
    if (!value || value.kind !== 'file') throw new DOMException('Missing file', 'NotFoundError');
    return value;
  }
  async removeEntry(name: string) { this.entries.delete(name); }
  handle(): FileSystemDirectoryHandle { return this as unknown as FileSystemDirectoryHandle; }
}
