# Lattice Release

## Summary

- Web export built from `web-dist/`
- Cloudflare Pages primary site: `https://lattice-apq.pages.dev`
- GitHub Pages kept as backup/mirror static deploy path
- Desktop artifacts generated through `tauri build`
- Local release directory synchronized through `scripts/prepare-release.mjs`

## QA

- `lint`
- `typecheck`
- `test:browser-regression`
- `test:run`
- `build`
- `tauri:build`

## Artifacts

- Desktop installers and binaries
- `checksums.txt`
- `release-manifest.json`
- `RELEASE_SUMMARY.md`

## Notes

- GitHub platform issues such as billing / workflow startup failures are tracked separately from repository-side release failures.
