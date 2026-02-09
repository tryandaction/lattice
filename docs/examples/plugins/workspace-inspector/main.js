function summarizeList(items, limit = 20) {
  if (!Array.isArray(items)) return [];
  if (items.length <= limit) return items;
  return items.slice(0, limit).concat([`... (${items.length - limit} more)`]);
}

export function activate(ctx) {
  ctx.commands.register({
    id: "workspace.inspector.listFiles",
    title: "Workspace Inspector: List Files",
    run: async () => {
      try {
        const files = await ctx.workspace.listFiles();
        const preview = summarizeList(files, 10);
        ctx.log("[workspace] file count:", files.length);
        ctx.log("[workspace] preview:", preview);
      } catch (error) {
        ctx.log("[workspace] listFiles failed:", error?.message || String(error));
      }
    }
  });

  ctx.commands.register({
    id: "workspace.inspector.listAnnotations",
    title: "Workspace Inspector: List Annotations (first file)",
    run: async () => {
      try {
        const files = await ctx.workspace.listFiles();
        const target = files[0];
        if (!target) {
          ctx.log("[annotations] no files in workspace");
          return;
        }
        const items = await ctx.annotations.list({ filePath: target });
        const preview = summarizeList(items, 5);
        ctx.log(`[annotations] file: ${target}`);
        ctx.log("[annotations] count:", items.length);
        ctx.log("[annotations] preview:", preview);
      } catch (error) {
        ctx.log("[annotations] list failed:", error?.message || String(error));
      }
    }
  });

  ctx.panels.register({
    id: "workspace.inspector.panel.runtime",
    title: "Workspace Inspector (Runtime)",
    schema: {
      type: "markdown",
      props: {
        content: "## Runtime Panel\nUse the command center to run Inspector commands."
      }
    }
  });
}

export function deactivate() {
  // optional cleanup
}
