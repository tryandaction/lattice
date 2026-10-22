# Web Navigation Quality - 2026-10-20

## Outcome

The Web sources index keeps URL pages separate from local-file tabs. Local HTML stays in the file tree and retains preview/source editing. A navigation commit now updates the address-bar draft baseline, so a redirect back to a previously visited URL displays the browser's final location rather than stale typed text.

The desktop shell records the final top-level URL from WebView2 `NavigationCompleted` and `HistoryChanged` events. URL updates are restricted to HTTP/HTTPS. Native navigation no longer depends on the original address submitted to `WebviewBuilder`, and frontend address synchronization does not remount the child view or start another request.

## Verification

- `npm run build` passed with Next.js 16.3.4; all static routes were generated.
- Focused Vitest passed: 5 files, 19 tests, including address draft synchronization, native WebView navigation races, separate Web indexing and persisted web tabs.
- `npx tsc --noEmit --incremental false` passed.
- Focused Rust WebView tests passed: 2 tests.
- Release candidate `releases/v3.1.0-webview-quality-20261020-installed/lattice.exe`, SHA256 `fc35a950acea06c75e7da68eddbc8ecd545bea2ffc95abb03b5573b33c8c74ed`, passed an isolated real desktop UI run using only synthetic localhost pages and files. Eight stages covered local HTML preview/source/save, separate Web index, redirects, page links, back/forward, source-index restore, HTTP 503 handling and closing the web source. The run recorded zero page errors.
- Expected diagnostic console messages were limited to Tauri IPC fallback in the isolated profile, the deliberately failing HTTP 503 fixture and sandboxed `about:srcdoc` scripts.

## Desktop Installation

- Installed path: `%LOCALAPPDATA%\Lattice\lattice.exe`.
- Product version: `3.1.0`.
- Installed SHA256 matches the release executable: `fc35a950acea06c75e7da68eddbc8ecd545bea2ffc95abb03b5573b33c8c74ed`.
- The installed `settings.json` SHA256 is unchanged: `eb102fc58bf960cdb5b69f79ee91c9a34d129ddb958ada3b3e06652296564d3e`.
- Rollback copies of the prior executable and settings bytes are in `.lattice-build/install-backup-20261020/`.
- The app was not started after installation because it would automatically restore the user's external research workspace. This run did not open or process research files.
- The static bundle was deployed successfully to Cloudflare Pages `main`: `https://58db7cc4.lattice-apq-7xj.pages.dev`. Wrangler confirmed deployment completion; no separate production content fetch was performed in this run.
