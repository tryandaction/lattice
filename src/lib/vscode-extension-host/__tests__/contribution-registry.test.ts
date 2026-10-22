import { describe, expect, it } from "vitest";
import { buildVSCodeContributionRegistry } from "@/lib/vscode-extension-host/contribution-registry";
import type { VSCodeExtensionInventoryEntry } from "@/lib/vscode-compat/types";
import type { VSCodeHostSnapshot } from "@/lib/vscode-extension-host/types";

function extension(input: {
  id: string;
  container?: string;
  viewId?: string;
  commandOnly?: boolean;
}): VSCodeExtensionInventoryEntry {
  const container = input.container ?? `${input.id}.container`;
  const viewId = input.viewId ?? `${input.id}.view`;
  return {
    id: input.id,
    displayName: input.id,
    source: "installed",
    path: `C:/extensions/${input.id}`,
    main: "./extension.js",
    contributes: {
      languages: [],
      snippets: [],
      commands: input.commandOnly ? 1 : 0,
      commandItems: input.commandOnly ? [{ command: `${input.id}.run`, title: "Run" }] : [],
      debuggers: 0,
      configuration: false,
      views: input.commandOnly ? [] : [{ container, id: viewId, name: "Demo View" }],
      viewContainers: input.commandOnly ? [] : [container],
      viewContainerItems: input.commandOnly ? [] : [{ id: container, title: "Demo Tools", location: "activitybar" }],
      menus: 0,
      notebooks: [],
      notebookRenderers: [],
      grammars: [],
      themes: [],
    },
  };
}

function snapshot(overrides: Partial<VSCodeHostSnapshot> = {}): VSCodeHostSnapshot {
  return {
    status: "ready",
    runtime: "node",
    commandCount: 0,
    activeExtensionCount: 0,
    commands: [],
    views: [],
    extensions: [],
    lastError: null,
    ...overrides,
  };
}

describe("VS Code contribution registry", () => {
  it("creates a real custom activity container from manifest views", () => {
    const result = buildVSCodeContributionRegistry(
      [extension({ id: "publisher.demo" })],
      snapshot({
        extensions: [{
          id: "publisher.demo",
          status: "skipped",
          commandCount: 0,
          viewCount: 0,
        }],
      }),
    );

    expect(result.containers).toEqual([
      expect.objectContaining({
        id: "publisher.demo.container",
        title: "Demo Tools",
        extensionId: "publisher.demo",
        status: "ready",
        views: [expect.objectContaining({ id: "publisher.demo.view", status: "unresolved" })],
      }),
    ]);
  });

  it("merges registered host kind and container into the manifest view", () => {
    const result = buildVSCodeContributionRegistry(
      [extension({ id: "publisher.demo" })],
      snapshot({
        views: [{
          id: "publisher.demo.view",
          title: "Runtime View",
          extensionId: "publisher.demo",
          container: "publisher.demo.container",
          kind: "tree",
          source: "host",
        }],
        extensions: [{ id: "publisher.demo", status: "active", commandCount: 0, viewCount: 1 }],
      }),
    );

    expect(result.containers[0]?.views[0]).toMatchObject({
      id: "publisher.demo.view",
      title: "Runtime View",
      kind: "tree",
      status: "registered",
    });
  });

  it("attaches explorer, scm, and debug contributions to built-in tools", () => {
    const result = buildVSCodeContributionRegistry([
      extension({ id: "publisher.files", container: "explorer", viewId: "publisher.files.view" }),
      extension({ id: "publisher.scm", container: "scm", viewId: "publisher.scm.view" }),
      extension({ id: "publisher.debug", container: "debug", viewId: "publisher.debug.view" }),
    ], snapshot({
      extensions: [
        { id: "publisher.files", status: "skipped", commandCount: 0, viewCount: 0 },
        { id: "publisher.scm", status: "skipped", commandCount: 0, viewCount: 0 },
        { id: "publisher.debug", status: "skipped", commandCount: 0, viewCount: 0 },
      ],
    }));

    expect(result.containers).toEqual([]);
    expect(result.builtInViews.explorer?.[0]?.id).toBe("publisher.files.view");
    expect(result.builtInViews.scm?.[0]?.id).toBe("publisher.scm.view");
    expect(result.builtInViews.debug?.[0]?.id).toBe("publisher.debug.view");
  });

  it("keeps multiple built-in containers from one extension separate", () => {
    const baseExtension = extension({ id: "publisher.multi" });
    const multiContainerExtension: VSCodeExtensionInventoryEntry = {
      ...baseExtension,
      contributes: {
        ...baseExtension.contributes!,
        views: [
          { container: "explorer", id: "publisher.multi.explorer", name: "Explorer View" },
          { container: "debug", id: "publisher.multi.debug", name: "Debug View" },
        ],
        viewContainers: [],
        viewContainerItems: [],
      },
    };

    const result = buildVSCodeContributionRegistry([multiContainerExtension], snapshot({
      extensions: [{ id: "publisher.multi", status: "skipped", commandCount: 0, viewCount: 0 }],
    }));

    expect(result.containers).toEqual([]);
    expect(result.builtInViews.explorer?.map((view) => view.id)).toEqual(["publisher.multi.explorer"]);
    expect(result.builtInViews.debug?.map((view) => view.id)).toEqual(["publisher.multi.debug"]);
  });

  it("does not create activity tools for command-only extensions", () => {
    const result = buildVSCodeContributionRegistry(
      [extension({ id: "publisher.commands", commandOnly: true })],
      snapshot({ extensions: [{ id: "publisher.commands", status: "active", commandCount: 1, viewCount: 0 }] }),
    );

    expect(result.containers).toEqual([]);
  });

  it("suppresses failed containers and reports exact missing API diagnostics", () => {
    const result = buildVSCodeContributionRegistry(
      [extension({ id: "publisher.failed" })],
      snapshot({
        extensions: [{
          id: "publisher.failed",
          status: "failed",
          commandCount: 0,
          viewCount: 0,
          error: "VS Code API shim missing: window.createQuickPick",
          missingApi: ["window.createQuickPick"],
        }],
      }),
    );

    expect(result.containers).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      extensionId: "publisher.failed",
      status: "failed",
      error: "VS Code API shim missing: window.createQuickPick",
      missingApi: ["window.createQuickPick"],
    }));
  });

  it("keeps same-named containers from different extensions without a false collision", () => {
    const result = buildVSCodeContributionRegistry([
      extension({ id: "publisher.first", container: "shared.tools", viewId: "publisher.first.view" }),
      extension({ id: "publisher.second", container: "shared.tools", viewId: "publisher.second.view" }),
    ], snapshot({
      extensions: [
        { id: "publisher.first", status: "skipped", commandCount: 0, viewCount: 0 },
        { id: "publisher.second", status: "skipped", commandCount: 0, viewCount: 0 },
      ],
    }));

    expect(result.containers).toHaveLength(2);
    expect(result.containers.map((container) => container.extensionId)).toEqual([
      "publisher.first",
      "publisher.second",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("honors extension-host context keys for conditional activity containers", () => {
    const conditionalExtension = extension({ id: "anthropic.claude-code" });
    conditionalExtension.contributes = {
      ...conditionalExtension.contributes!,
      views: [
        {
          container: "claude-sidebar",
          id: "claudeVSCodeSidebar",
          name: "Claude Code",
          when: "claude-code:doesNotSupportSecondarySidebar",
        },
        {
          container: "claude-sessions-sidebar",
          id: "claudeVSCodeSessionsList",
          name: "Claude Sessions",
          when: "claude-vscode.sessionsListEnabled",
        },
      ],
      viewContainers: ["claude-sidebar", "claude-sessions-sidebar"],
      viewContainerItems: [
        {
          id: "claude-sidebar",
          title: "Claude Code",
          location: "activitybar",
          when: "claude-code:doesNotSupportSecondarySidebar",
        },
        {
          id: "claude-sessions-sidebar",
          title: "Claude Code",
          location: "activitybar",
          when: "claude-vscode.sessionsListEnabled",
        },
      ],
    };

    const result = buildVSCodeContributionRegistry(
      [conditionalExtension],
      snapshot({
        contextKeys: {
          "claude-code:doesNotSupportSecondarySidebar": true,
          "claude-vscode.sessionsListEnabled": false,
        },
        extensions: [{ id: "anthropic.claude-code", status: "active", commandCount: 0, viewCount: 1 }],
      }),
    );

    expect(result.containers).toHaveLength(1);
    expect(result.containers[0]).toMatchObject({
      id: "claude-sidebar",
      views: [{ id: "claudeVSCodeSidebar" }],
    });
  });
});
