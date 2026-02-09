# Plugin Development Guide (MVP)

This document describes the current plugin package format and how to install and test plugins in Lattice.

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
  // optional cleanup
}
```

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

## Notes
- Network access can be restricted by the allowlist in Settings.
- Built-in plugins live under src/plugins/core.
