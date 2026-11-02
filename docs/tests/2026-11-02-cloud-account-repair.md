# Cloud account and collaboration repair — 2026-11-02

## Scope and baseline

- Source baseline: `main` / `0ddcd6384a53807f7dbde581de82766129d953ee`, product `3.2.0`.
- Production baseline: `https://lattice-apq.pages.dev/`, index SHA256 `968a78a5e2fb6dbd86da38d8799f216046d5ab323c8dc3892eb13df7d4ba405d`.
- Work occurs in an isolated checkout. The independent, uncommitted AI reliability changes in the original checkout are excluded from source, build, staging, and deployment.
- No real OTP email, private mailbox, private link, operator key, or private browser profile is used. Auth/API responses in browser acceptance are synthetic and all external HTTP/WebSocket traffic is intercepted or rejected.

## Reproduction and changes

The ordinary product entry is Home → Shared library → Create account. The baseline form contained only email and one password. After a synthetic signup, dismissing the management backdrop and reopening the panel lost both email and the OTP step. Actual browser `blur`/`focus` events alone retained the step; the reported operating-system interaction must not be described as independently reproduced solely from that evidence.

Registration now requires a matching confirmation password before invoking signup. The account panel retains its component identity when management closes. Background clicks during signed-out authentication do not dismiss the flow; the explicit close button remains available. Tab-scoped recovery stores only email, account step, confirmation status, cooldown deadline, and expiration. It never stores either password or OTP. Refresh restores the step with an empty OTP input. Changing cloud connection resets component credentials and uses a separate recovery key.

The resend timer uses an absolute deadline and updates on focus/visibility return. Failed resend leaves the entered code editable; successful resend clears it and starts a new cooldown. Authentication errors retain stable Supabase codes and give specific network, timeout, server, rate-limit, and existing-account feedback without reflecting upstream private details.

Once verification succeeds, malformed session responses, session storage failure, identity cancellation, library-list failure, and library-selection failure lead to password-login recovery. A consumed OTP is not offered for reuse, and an invalidated identity cannot overwrite a newer session.

## Collaboration and delivery checks

The existing create/join, members/roles, PDF shared annotations and author filtering, immutable version recovery, GitHub authorization/import, team AI management, activity, and synchronization retry paths are connected to production clients. Synthetic browser responses exercise these UI/protocol paths; they do not establish that remote GitHub, model providers, or email delivery succeeded.

The repeatable browser script is `node scripts/cloud-account-acceptance.mjs`. Serve the final `web-dist` on loopback and set `LATTICE_ACCEPTANCE_URL` and optionally `LATTICE_ACCEPTANCE_OUTPUT`. It uses desktop 1440×900 and mobile 390×844; mobile has touch enabled. Reports and screenshots default to a temporary directory, and report serialization rejects fixture password/OTP content.

The full test command prepares pinned local PostgreSQL fixtures through `pretest:run`. These fixtures exercise local HTTP and PostgreSQL RLS without contacting a hosted database. Missing fixtures produce preparation/test failure instead of silent SQL-suite skips.

Builds use a distinct `LATTICE_WINDOWS_BUILD_ROOT`; existing junctions that target another checkout are rejected. Release artifacts must use a fresh version directory. Installer updates must abort when a user instance is running and preserve user configuration and workspace data.

## Functional acceptance and release gate

- Initial account UI baseline: 2 files / 30 tests passed.
- Added lifecycle regressions first ran with 3 failures / 1 pass, demonstrating missing confirmation, lost remount state, and background timer drift.
- Account/auth/locale integration run after repairs: 8 files / 116 tests passed. Additional consumed-session regressions also passed after their observed RED runs.
- Independent physical `node_modules` matches the lockfile. The original shared installation had five invalid versions and was excluded from final verification.
- Official root dependency audit: 0 vulnerabilities after bounded dependency updates. Pinned PGlite fixture audit: 0 vulnerabilities.
- Typecheck passed; the final documentation check passed for 228 files. Lint has 0 errors and 159 warnings; it is not warning-free.
- Installed baseline desktop: `3.2.0`, executable SHA256 `AA3359631BFA6653B7AA9086229972558B63865ED8621E42440A30824D7D69D8`. A separate diagnostic profile read/rendered a synthetic seven-page PDF, created a highlight, persisted/reloaded its sidecar, and wrote/read a PDF copy. This does not claim the product menu's annotated-PDF export was tested.
- The complete `npm run qa:gate` on the repaired source (before the metadata increment from 3.2.0) exited 0: 649 test files / 5,980 tests passed, 3 tests skipped, followed by successful web and desktop builds and both MSI/NSIS bundles. The earlier gate's TypeScript failure is retained in its separate log; it was fixed and the complete gate rerun.
- The three skips are two explicitly disabled real-model tests and one local Auth/PostgREST recovery test without its executable fixtures. PGlite and native PostgreSQL tests actually ran. No secret-bearing live-model settings were opened to enable those tests.
- Final synthetic browser acceptance passed 131 assertions across owner, viewer, and GitHub contexts on desktop 1440×900 and touch mobile 390×844. The GitHub flow uses a zero-delay synthetic authorization redirect and completed RED → GREEN. All profiles had zero uncaught page errors and zero unmodeled external requests. Intentional HTTP/transport failures account for the recorded resource errors.
- The two-user Markdown script `node scripts/cloud-coedit-acceptance.mjs` passed 13 assertions: mutual version visibility, immutable history/authors, draft protection, visible save rejection, copying the exact draft, safe retry rejection, real close-without-save/reopen, manual merge, and successful final save. Together the browser scripts cover 144 assertions; they do not inject application stores.
- An isolated desktop candidate compiled from the repaired source passed 10 auth/PDF checks, including actual native blur/focus and a separately labeled synthetic visibility regression. Its version/hash was verified before launch; this candidate result is separate from the installed new-version result.

## Final release status

After the full gate and browser acceptance passed, product metadata was incremented to `3.2.1`. The original worktree's independent AI changes remain outside this release.

The 3.2.1 web build and native executable compilation succeeded. The first full packaging run was interrupted during WiX `light`; no 3.2.1 MSI is distributed from that attempt. Subsequent rebuild attempts encountered read-only Next/Cargo cache ACLs; permissions were not changed. A separate temporary-target cold compile was stopped after the local Tauri CLI documented its supported `bundle` command. Final NSIS packaging uses the already compiled 3.2.1 executable and the accepted static frontend through that command. Its actual generated NSIS script was independently checked for version 3.2.1, hook inclusion order, and both installation/uninstallation process checks.

| Final local verification | Result |
|---|---|
| Web version and index SHA256 | `3.2.1` / `3569326dc9a9e89b4ed99783c06e7836d99c9ec5c0b98cdbc39811f13acb07b0` |
| Final static browser acceptance | 131 account/collaboration checks and 13 two-user Markdown checks passed; desktop and touch mobile |
| NSIS package | `Lattice_3.2.1_x64-setup.exe`, 203,610,410 bytes |
| NSIS SHA256 | `ed3be1260bc17ecc56293f1770653004f3051a8da1e411e4b608185140131da3` |
| Installed executable | `3.2.1`, SHA256 `99165ca122e395cc77df55c035fa4ba7ad21b511d9686d67b0794eff1b9f985c` |
| Actual update | `/S /UPDATE /NS`, exit 0; installed executable hash matches the compiled candidate |
| Installed-version smoke | 10/10 passed, 0 page errors, one synthetic signup, no real OTP email |

The installed-version smoke used its own diagnostic identifier and temporary WebView profile. It exercised actual native minimize/restore, a separately labeled synthetic visibility transition, close/reopen OTP retention, seven-page PDF rendering, renderer highlight/sidecar persistence, and native PDF byte-copy round trip. Only its own process was closed; the separate application instance observed after installation was preserved. This is basic PDF read/write coverage, not an annotated-PDF export claim.

Production deployment and Git publishing are recorded after their respective completion checks; local success alone is not a production-deployment result.

Real OTP delivery remains **not tested**. An accepted synthetic send response or an older confirmation-link email is not delivery evidence.
