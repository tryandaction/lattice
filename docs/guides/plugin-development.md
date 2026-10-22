# Lattice Plugin Development Guide

This document describes the installable plugin package format, runtime lifecycle, permissions, settings, and verification workflow.

The smallest working package is [`docs/examples/plugins/hello-plugin`](../examples/plugins/hello-plugin). It contains only `manifest.json`, `main.js`, one Markdown resource, and one SVG asset; it can be imported from a folder or zipped without a build step.

## Package Structure
A plugin package is a folder or zip with the following files:

- manifest.json (required)
- main.js (required)
- ui/ (optional UI assets)
- assets/ (optional static files)

Example:

plugin-example/
  manifest.json
  main.js
  ui/
  assets/

## manifest.json
Required fields:
- id (lowercase, digits, ., -, _)
- name
- version

Optional fields:
- description
- author
- minAppVersion
- engines
- permissions
- main (default: main.js)
- ui.panels

Example:

```json
{
  "id": "demo.plugin",
  "name": "Demo Plugin",
  "version": "1.0.0",
  "description": "Example plugin",
  "author": "Lattice",
  "permissions": ["ui:commands", "ui:panels"],
  "main": "main.js",
  "ui": {
    "panels": [
      {
        "id": "demo.panel",
        "title": "Demo Panel",
        "schema": {
          "type": "markdown",
          "props": {
            "content": "# Demo Panel\nThis is a demo panel."
          }
        }
      }
    ]
  }
}
```

## main.js
Your plugin must export an activate() function. deactivate() is optional.

```js
export async function activate(ctx) {
  ctx.commands.register({
    id: "demo.hello",
    title: "Demo: Hello",
    run: () => {
      ctx.log("Hello from plugin");
    }
  });

  const logoUrl = await ctx.assets.getUrl("assets/logo.svg");
  ctx.panels.register({
    id: "demo.panel.runtime",
    title: "Runtime Panel",
    schema: {
      type: "markdown",
      props: { content: `![Logo](${logoUrl})\n\nRuntime panel content` }
    }
  });
}

export function deactivate() {
  // Optional explicit cleanup. Lattice also removes registered commands,
  // panels, listeners, themes, editor extensions, and asset URLs.
}
```

Every activation receives `ctx.lifecycle.signal` and `ctx.lifecycle.registerCleanup()`. Long-running work should stop when the signal is aborted; registrations that need custom cleanup should return the disposer from `registerCleanup`. Lattice runs cleanup when the plugin is disabled, replaced, unloaded, or when activation fails halfway through.

Markdown panels may display image resources returned by their own
`ctx.assets.getUrl()` calls. The host permits only live image URLs belonging to
the panel's plugin; another plugin's URLs, non-image resources and arbitrary
Blob links remain filtered. Disabling or removing the plugin revokes these
URLs and removes the panel.

## Permissions
Common permissions:
- file:read
- file:write
- annotations:read
- annotations:write
- network
- ui:commands
- ui:panels
- storage

Formula extraction also uses `read-current-document`, `clipboard-write`, `export-file`, and (for image OCR only) `use-ocr`. A permission is denied at the API boundary when it is absent. Keep the manifest narrow: `network`, `file:write`, `annotations:write`, and `use-ai` are high-risk permissions and are shown with a risk label in Settings.

If a permission is not granted, calls to that API will be rejected.

## Assets & UI resources
Files under `assets/` and `ui/` are bundled and can be accessed at runtime.

API:
- `ctx.assets.getUrl(path)` -> Blob URL (use in markdown/images)
- `ctx.assets.readText(path)` -> read UTF-8 text files

Example:
```js
const iconUrl = await ctx.assets.getUrl("assets/icon.png");
const panelHtml = await ctx.assets.readText("ui/panel.html");
```

## Install
### Install from zip
- Open Settings -> Extensions
- Click "Install plugin"
- Select a .zip containing manifest.json + main.js

### Install from folder
- Open Settings -> Extensions
- Click "Install from folder"
- Pick the plugin folder (requires File System Access API)

After installation, a package is visible but remains untrusted and disabled until the user explicitly enables its trust and runtime state. Installing a package with an ID that already exists first revokes that ID's enabled/trusted authorization and stops the current instance before the new package is stored. Other plugin IDs keep their authorization. If persistence or package validation fails, the old authorization is restored and the replacement is not activated.

## Example packages
Install-ready examples live here:
- docs/examples/plugins/hello-plugin
- docs/examples/plugins/workspace-inspector
- docs/examples/plugins/obsidian-compat-demo
- docs/examples/plugins/obsidian-compat-extended

You can install them directly via "Install from folder".

## Obsidian compatibility (MVP)
Plugins can access a minimal Obsidian-like API via `ctx.obsidian`:
- `ctx.obsidian.app.vault.getFiles()`
- `ctx.obsidian.app.vault.getMarkdownFiles()`
- `ctx.obsidian.app.vault.read(path)`
- `ctx.obsidian.app.vault.modify(path, content)`
- `ctx.obsidian.app.vault.create(path, content)`
- `ctx.obsidian.app.vault.delete(path)`
- `ctx.obsidian.app.vault.rename(path, newPath)`
- `ctx.obsidian.app.vault.onChange(callback)`
- `ctx.obsidian.app.vault.onRename(callback)`
- `ctx.obsidian.app.vault.onDelete(callback)`
- `ctx.obsidian.app.workspace.getActiveFile()`
- `ctx.obsidian.app.workspace.onActiveFileChange(callback)`

This is a small subset intended to ease migration of common workflows.

## Test
- Enable plugin system
- Trust the plugin
- Enable the plugin
- Open Command Center (Ctrl+K) or Plugin Panels (Ctrl+Shift+P)

For a package smoke test, use the following sequence:

1. Import `docs/examples/plugins/hello-plugin` from folder (or zip it and use Install ZIP).
2. Confirm the package appears as installed, but not trusted or running.
3. Trust it, enable it, and run `hello.demo.sayHello`.
4. Disable it and confirm its command and panel disappear.
5. Re-enable it and confirm activation runs once and the command returns.

The repository tests cover the same lifecycle with a real ZIP payload, including same-ID replacement and failed persistence recovery.

## Notes
- Network access can be restricted by the allowlist in Settings.
- Built-in plugins live under `src/plugins`; installed packages are stored in the browser OPFS/localStorage fallback or the desktop plugin store.
