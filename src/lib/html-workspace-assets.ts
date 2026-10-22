import { normalizeWorkspacePath, resolveRelativeWorkspacePath, safeDecodeLinkTarget } from "./link-router/path-utils";
import type { AsyncAssetResolver } from './asset-source-context';

/** Resolve preview resources through granted workspace handles, without a server. */
export async function resolveHtmlWorkspaceAssets(html: string, filePath: string, root?: FileSystemDirectoryHandle | null, asyncAssetResolver?: AsyncAssetResolver) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const urls: string[] = [];
  const cache = new Map<string, Promise<string>>();
  const local = (href: string) => Boolean(href.trim()) && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href.trim());
  const resolvePath = (source: string, href: string) => {
    const path = safeDecodeLinkTarget(href.split(/[?#]/, 1)[0]);
    return path.startsWith("/") ? normalizeWorkspacePath(path.slice(1)) : resolveRelativeWorkspacePath(source, path);
  };
  const read = async (path: string) => {
    if (!root) throw new Error('No authorized asset source.');
    const parts = normalizeWorkspacePath(path).split("/").filter(Boolean);
    if (parts[0] === root.name) parts.shift();
    let directory = root;
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    return (await directory.getFileHandle(parts.at(-1)!)).getFile();
  };
  const resource = (source: string, href: string): Promise<string> => {
    if (!local(href)) return Promise.resolve(href);
    const path = asyncAssetResolver ? `${source}\n${href}` : resolvePath(source, href);
    let promise = cache.get(path);
    if (!promise) {
      promise = (asyncAssetResolver ? asyncAssetResolver(href, source === filePath ? undefined : source) : read(path)).then((file) => {
        if (!file) return 'about:blank';
        const url = URL.createObjectURL(file);
        urls.push(url);
        return url;
      }).catch(() => "about:blank");
      cache.set(path, promise);
    }
    return promise;
  };
  const css = async (text: string, source: string): Promise<string> => {
    const matches = [...text.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)];
    const replacements = await Promise.all(matches.map((match) => resource(source, match[2].trim())));
    let result = text;
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const match = matches[index];
      result = result.slice(0, match.index) + `url("${replacements[index]}")` + result.slice(match.index! + match[0].length);
    }
    return result;
  };
  try {
    await Promise.all([
      ...Array.from(document.querySelectorAll<HTMLImageElement>("img[src],video[poster],source[src],audio[src],video[src]")).map(async (element) => {
        const attr = element.hasAttribute("poster") ? "poster" : "src";
        element.setAttribute(attr, await resource(filePath, element.getAttribute(attr)!));
      }),
      ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')).map(async (link) => {
        const href = link.getAttribute("href")!;
        if (!local(href)) return;
        try {
          const path = asyncAssetResolver ? href : resolvePath(filePath, href);
          const style = document.createElement("style");
          const asset = asyncAssetResolver ? await asyncAssetResolver(href) : await read(path);
          if (!asset) { link.remove(); return; }
          style.textContent = await css(await asset.text(), path);
          link.replaceWith(style);
        } catch { link.remove(); }
      }),
      ...Array.from(document.querySelectorAll<HTMLStyleElement>("style")).map(async (style) => { style.textContent = await css(style.textContent ?? "", filePath); }),
      ...Array.from(document.querySelectorAll<HTMLElement>("[style]")).map(async (element) => { element.setAttribute("style", await css(element.getAttribute("style")!, filePath)); }),
    ]);
    return { html: document.documentElement.outerHTML, dispose: () => urls.forEach((url) => URL.revokeObjectURL(url)) };
  } catch (error) {
    urls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}
