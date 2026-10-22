import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const disk = new Map<string, string>();
  const memory = new Map<string, string>();
  const store = {
    get: vi.fn(async (key: string) => memory.get(key)),
    set: vi.fn(async (key: string, value: string) => { memory.set(key, value); }),
    delete: vi.fn(async (key: string) => { memory.delete(key); }),
    entries: vi.fn(async () => [...memory.entries()]),
    save: vi.fn(async () => { disk.clear(); memory.forEach((value, key) => disk.set(key, value)); }),
  };
  return { disk, memory, store, desktop: false, load: vi.fn(async () => store) };
});
vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: mock.load } }));
vi.mock('@/lib/storage-adapter', () => ({ isTauriHost: () => mock.desktop }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  localStorage.clear(); sessionStorage.clear(); mock.disk.clear(); mock.memory.clear();
  mock.desktop = false; mock.load.mockImplementation(async () => mock.store);
  mock.store.save.mockImplementation(async () => { mock.disk.clear(); mock.memory.forEach((value, key) => mock.disk.set(key, value)); });
});
afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  Reflect.deleteProperty(window, '__TAURI__');
});
function desktop() {
  mock.desktop = true;
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
}

describe('credential persistence lifecycle with synthetic values', () => {
  it('restores profile credentials after a new web session', async () => {
    let storage = await import('../key-storage');
    await storage.setProfileApiKey('test-profile', 'synthetic-value');
    sessionStorage.clear(); vi.resetModules();
    storage = await import('../key-storage');
    await storage.initKeyStorage();
    expect(storage.getProfileApiKey('test-profile')).toBe('synthetic-value');
  });

  it('recognizes the modern desktop host and restores all saved profile keys', async () => {
    desktop();
    mock.memory.set('lattice-ai-profile-key:test-profile', 'synthetic-value');
    const storage = await import('../key-storage');
    await storage.initKeyStorage();
    expect(mock.load).toHaveBeenCalledOnce();
    expect(storage.getProfileApiKey('test-profile')).toBe('synthetic-value');
    expect(localStorage.getItem('lattice-ai-profile-key:test-profile')).toBeNull();
  });

  it('waits for desktop initialization before an early save and shares concurrent initialization', async () => {
    desktop();
    let finish!: (value: typeof mock.store) => void;
    mock.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const storage = await import('../key-storage');
    const first = storage.initKeyStorage(); const second = storage.initKeyStorage();
    const saving = storage.setProfileApiKey('test-profile', 'synthetic-value');
    await vi.waitFor(() => expect(mock.load).toHaveBeenCalledOnce());
    expect(mock.store.set).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    finish(mock.store); await Promise.all([first, second, saving]);
    expect(mock.disk.get('lattice-ai-profile-key:test-profile')).toBe('synthetic-value');
  });

  it('does not silently use browser storage when the desktop store fails', async () => {
    desktop(); mock.load.mockRejectedValueOnce(new Error('synthetic storage failure'));
    const storage = await import('../key-storage');
    await expect(storage.setProfileApiKey('test-profile', 'synthetic-value')).rejects.toThrow();
    expect(localStorage.length).toBe(0);
    expect(storage.getProfileApiKey('test-profile')).toBe('');
  });

  it('preserves the previous committed key when a desktop save fails', async () => {
    desktop();
    const storage = await import('../key-storage');
    await storage.setProfileApiKey('test-profile', 'synthetic-before');
    mock.store.save.mockRejectedValueOnce(new Error('synthetic disk failure'));
    await expect(storage.setProfileApiKey('test-profile', 'synthetic-after')).rejects.toThrow();
    expect(storage.getProfileApiKey('test-profile')).toBe('synthetic-before');
    expect(mock.disk.get('lattice-ai-profile-key:test-profile')).toBe('synthetic-before');
  });

  it('migrates profile credentials from browser persistence without overwriting a desktop key', async () => {
    let storage = await import('../key-storage');
    await storage.setProfileApiKey('new-profile', 'synthetic-migrated');
    await storage.setProfileApiKey('existing-profile', 'synthetic-old');
    vi.resetModules(); desktop();
    mock.memory.set('lattice-ai-profile-key:existing-profile', 'synthetic-authoritative');
    storage = await import('../key-storage'); await storage.initKeyStorage();
    expect(storage.getProfileApiKey('new-profile')).toBe('synthetic-migrated');
    expect(storage.getProfileApiKey('existing-profile')).toBe('synthetic-authoritative');
    expect(mock.disk.get('lattice-ai-profile-key:new-profile')).toBe('synthetic-migrated');
  });
});
