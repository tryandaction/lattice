function safeObsidian(ctx) {
  if (ctx.obsidian?.app?.vault && ctx.obsidian?.app?.workspace) {
    return ctx.obsidian;
  }
  return null;
}

export function activate(ctx) {
  const obsidian = safeObsidian(ctx);

  ctx.commands.register({
    id: "obsidian.compat.listMarkdown",
    title: "Obsidian Compat: List Markdown Files",
    run: async () => {
      if (!obsidian) {
        ctx.log("obsidian compat not available");
        return;
      }
      try {
        const files = await obsidian.app.vault.getMarkdownFiles();
        ctx.log("[obsidian] markdown files:", files);
      } catch (error) {
        ctx.log("[obsidian] list markdown failed:", error?.message || String(error));
      }
    }
  });

  ctx.commands.register({
    id: "obsidian.compat.activeFile",
    title: "Obsidian Compat: Active File",
    run: async () => {
      if (!obsidian) {
        ctx.log("obsidian compat not available");
        return;
      }
      try {
        const active = await obsidian.app.workspace.getActiveFile();
        ctx.log("[obsidian] active file:", active ?? "(none)");
      } catch (error) {
        ctx.log("[obsidian] active file failed:", error?.message || String(error));
      }
    }
  });
}

export function deactivate() {
  // optional cleanup
}
