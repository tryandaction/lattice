# Lattice Deployment Checklist

## Preflight

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:browser-regression`
- [ ] `npm run test:run`
- [ ] `npm run build`
- [ ] `npm run tauri:build`

## Version Consistency

- [ ] `package.json`
- [ ] `src-tauri/tauri.conf.json`
- [ ] `src-tauri/Cargo.toml`

## Cloudflare Pages Deploy

- [ ] `web-dist/index.html` exists
- [ ] `deploy-cloudflare-pages.yml` deploys `web-dist/` to project `lattice`
- [ ] Cloudflare workflow summary shows target URL `https://lattice-apq.pages.dev`

## GitHub Pages Deploy

- [ ] `web-dist/index.html` exists
- [ ] `deploy.yml` uploads `web-dist/`
- [ ] workflow summary shows Pages artifact path and final URL

## Desktop Release

- [ ] `release.yml` preflight passes before matrix builds
- [ ] Windows artifacts include `lattice.exe`, `*.msi`, `*.exe`
- [ ] Draft release includes:
  - [ ] `checksums.txt`
  - [ ] `release-manifest.json`
  - [ ] `RELEASE_SUMMARY.md`

## Local Release

- [ ] `npm run release:prepare` succeeds
- [ ] `releases/vX.Y.Z/` contains artifacts and metadata
- [ ] `RELEASE_SUMMARY.md` matches this release

## Platform Boundary

- [ ] GitHub billing / runner startup issues recorded as platform blockers
- [ ] Repository-side failures traceable to workflow summaries or browser-regression output
