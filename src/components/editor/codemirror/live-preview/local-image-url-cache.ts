export interface LocalImageUrlCache {
  get: (path: string) => string | undefined;
  set: (path: string, url: string) => void;
  revokeAll: () => void;
  size: () => number;
}

export function createLocalImageUrlCache(): LocalImageUrlCache {
  const cache = new Map<string, string>();

  return {
    get: (path) => cache.get(path),
    set: (path, url) => {
      const existing = cache.get(path);
      if (existing && existing !== url) {
        URL.revokeObjectURL(existing);
      }
      cache.set(path, url);
    },
    revokeAll: () => {
      cache.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      cache.clear();
    },
    size: () => cache.size,
  };
}
