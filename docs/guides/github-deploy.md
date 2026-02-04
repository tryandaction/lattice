# GitHub Deployment Guide

This guide describes a safe, repeatable deployment workflow to GitHub.

---

## 1. Pre-flight Checks

- Ensure local build/tests are green.
- Confirm you are on the intended branch.
- Review diff for unintended changes.

Recommended checks:
```bash
npm run test:run
npm run build
```

---

## 2. Review Changes

```bash
git status
```

Optional:
```bash
git diff
```

---

## 3. Stage Changes

```bash
git add -A
```

---

## 4. Commit

```bash
git commit -m "<clear summary>"
```

---

## 5. Push

```bash
git push origin <branch>
```

---

## 6. Optional: Tag Release

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

---

## 7. If Using GitHub Pages

If `next.config.ts` uses `output: "export"`, run:
```bash
npm run build
```
Then publish the `out/` directory with your preferred GitHub Pages workflow.

---

## Notes
- Keep commits small and focused.
- Avoid pushing secrets (use `.gitignore`).
- If you need CI/CD, add a GitHub Actions workflow.
