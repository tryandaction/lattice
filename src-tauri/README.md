# Lattice Desktop Application (Tauri)

This directory contains the Tauri 2.x backend for the Lattice desktop application.

Current desktop baseline:

- desktop prefers local runtimes over browser fallback
- desktop restores the most recently opened workspace on startup and falls back to the configured default folder
- PDF item workspace v2 is part of the main desktop UX
- release facts are synchronized into `releases/vX.Y.Z/`
- web static export is still produced from the shared frontend and can be deployed to Cloudflare Pages / GitHub Pages

## Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) 20+
- Platform-specific dependencies:
  - **Windows**: WebView2 (bundled automatically)
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libgtk-3-dev libwebkit2gtk-4.0-dev libappindicator3-dev librsvg2-dev patchelf`

## Project Structure

```
src-tauri/
├── Cargo.toml          # Rust dependencies and build config
├── tauri.conf.json     # Tauri configuration
├── build.rs            # Build script
├── icons/              # Application icons (all sizes)
└── src/
    └── main.rs         # Main application entry point
```

## Configuration Notes

### tauri.conf.json

Key configuration options:

- `bundle.windows.webviewInstallMode`: Set to `embedBootstrapper` to ensure WebView2 is available
- `app.windows[0].minWidth/minHeight`: Minimum window size for usability
- `plugins`: Empty object - plugins are configured in Rust code, not JSON (Tauri 2.x change)

### Important: Plugin Configuration

In Tauri 2.x, plugin configuration has changed significantly:

```json
// ❌ OLD (Tauri 1.x) - DO NOT USE
"plugins": {
  "fs": { "scope": ["**"] },
  "dialog": { "all": true }
}

// ✅ NEW (Tauri 2.x) - Use empty object
"plugins": {}
```

Plugins are now configured entirely in Rust code via their builder patterns.

## Development

```bash
# From project root
npm run tauri:dev
```

## Building

```bash
# From project root
npm run tauri:build
```

For a local release-ready bundle with copied artifacts and metadata:

```bash
# From project root
npm run release:prepare
```

Output locations:
- Windows MSI: `target/release/bundle/msi/`
- Windows NSIS: `target/release/bundle/nsis/`
- macOS DMG: `target/release/bundle/dmg/`
- Linux AppImage: `target/release/bundle/appimage/`

Release-ready copies and metadata:

- `../releases/vX.Y.Z/`
- `../releases/vX.Y.Z/checksums.txt`
- `../releases/vX.Y.Z/release-manifest.json`
- `../releases/vX.Y.Z/RELEASE_SUMMARY.md`

## Troubleshooting

### Exit Code 101

This usually means a configuration error. Check:
1. `plugins` section in `tauri.conf.json` should be `{}`
2. All plugin initialization is done in `main.rs`

### WebView2 Issues

The app bundles WebView2 bootstrapper. If issues persist:
1. Manually install WebView2 from Microsoft
2. Check Windows version (requires Windows 10 1803+)

### Build Failures

1. Ensure Rust is up to date: `rustup update`
2. Clean build: `cargo clean` in src-tauri directory
3. Check Node.js version: requires 18+
