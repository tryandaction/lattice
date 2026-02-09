const DEMO_PATH = "lattice-demo/obsidian-compat-demo.md";
const DEMO_RENAMED = "lattice-demo/obsidian-compat-demo-renamed.md";

function getObsidian(ctx) {
  return ctx.obsidian?.app?.vault ? ctx.obsidian : null;
}

export function activate(ctx) {
  const obsidian = getObsidian(ctx);
  if (!obsidian) {
    ctx.log("obsidian compat not available");
    return;
  }

  ctx.commands.register({
    id: "obsidian.compat.extended.create",
    title: "Obsidian Compat: Create Demo File",
    run: async () => {
      try {
        await obsidian.app.vault.create(DEMO_PATH, "# Demo File\nCreated by Obsidian compat plugin.");
        ctx.log("created:", DEMO_PATH);
      } catch (error) {
        ctx.log("create failed:", error?.message || String(error));
      }
    }
  });

  ctx.commands.register({
    id: "obsidian.compat.extended.rename",
    title: "Obsidian Compat: Rename Demo File",
    run: async () => {
      try {
        await obsidian.app.vault.rename(DEMO_PATH, DEMO_RENAMED);
        ctx.log("renamed:", DEMO_PATH, "->", DEMO_RENAMED);
      } catch (error) {
        ctx.log("rename failed:", error?.message || String(error));
      }
    }
  });

  ctx.commands.register({
    id: "obsidian.compat.extended.delete",
    title: "Obsidian Compat: Delete Demo File",
    run: async () => {
      try {
        await obsidian.app.vault.delete(DEMO_RENAMED);
        ctx.log("deleted:", DEMO_RENAMED);
      } catch (error) {
        ctx.log("delete failed:", error?.message || String(error));
      }
    }
  });

  ctx.commands.register({
    id: "obsidian.compat.extended.watch",
    title: "Obsidian Compat: Watch Active File (logs)",
    run: async () => {
      try {
        const unsubscribe = obsidian.app.workspace.onActiveFileChange((path) => {
          ctx.log("active file changed:", path ?? "(none)");
        });
        ctx.log("watching active file changes (unsubscribe after 30s)");
        setTimeout(() => {
          unsubscribe?.();
          ctx.log("stopped watching active file changes");
        }, 30000);
      } catch (error) {
        ctx.log("watch failed:", error?.message || String(error));
      }
    }
  });

  ctx.commands.register({
    id: "obsidian.compat.extended.watchVault",
    title: "Obsidian Compat: Watch Vault Events (logs)",
    run: async () => {
      try {
        const stopChange = obsidian.app.vault.onChange((path) => {
          ctx.log("vault change:", path);
        });
        const stopRename = obsidian.app.vault.onRename((oldPath, newPath) => {
          ctx.log("vault rename:", oldPath, "->", newPath);
        });
        const stopDelete = obsidian.app.vault.onDelete((path) => {
          ctx.log("vault delete:", path);
        });
        ctx.log("watching vault events (unsubscribe after 30s)");
        setTimeout(() => {
          stopChange?.();
          stopRename?.();
          stopDelete?.();
          ctx.log("stopped watching vault events");
        }, 30000);
      } catch (error) {
        ctx.log("watch vault failed:", error?.message || String(error));
      }
    }
  });
}

export function deactivate() {
  // optional cleanup
}
