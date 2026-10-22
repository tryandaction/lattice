import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHtmlWorkspaceAssets } from "../html-workspace-assets";
describe("workspace HTML preview assets", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((file: File) => `blob:${file.name}`), revokeObjectURL: vi.fn() }));
  });
  it("loads sibling styles and images and resolves CSS images relative to the stylesheet", async () => {
    const files: Record<string, { name: string; text: () => Promise<string> }> = {
      "style.css": { name: "style.css", text: async () => '.plot{background:url("../plot.png")}' },
      "plot.png": { name: "plot.png", text: async () => "" },
    };
    const root = { name: "workspace", getDirectoryHandle: vi.fn(async () => root), getFileHandle: vi.fn(async (name: string) => {
      if (!files[name]) throw new Error("missing");
      return { getFile: async () => files[name] };
    }) } as unknown as FileSystemDirectoryHandle;
    const result = await resolveHtmlWorkspaceAssets('<link rel="stylesheet" href="styles/style.css"><img src="plot.png"><a href="other.html">Next</a>', "report/index.html", root);
    expect(result.html).toContain('src="blob:plot.png"');
    expect(result.html).toContain('background:url("blob:plot.png")');
    expect(result.html).toContain('href="other.html"');
    expect(root.getFileHandle).toHaveBeenCalledWith("plot.png");
    result.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:plot.png");
  });
  it('resolves cloud images and stylesheet dependencies without a filesystem root and revokes owned URLs', async () => {
    const resolve = vi.fn(async (href: string, source?: string) => {
      if (href === 'styles/main.css') return new Blob(['.plot{background:url("../plot.png")}'], { type: 'text/css' });
      return new File([`${source ?? 'document'}:${href}`], 'cloud-plot.png', { type: 'image/png' });
    });
    const result = await resolveHtmlWorkspaceAssets('<link rel="stylesheet" href="styles/main.css"><img src="plot.png">', 'cloud://opaque', null, resolve);
    expect(resolve).toHaveBeenCalledWith('plot.png', undefined);
    expect(resolve).toHaveBeenCalledWith('../plot.png', 'styles/main.css');
    expect(result.html).toContain('src="blob:cloud-plot.png"');
    expect(result.html).toContain('background:url("blob:cloud-plot.png")');
    result.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cloud-plot.png');
  });
});
