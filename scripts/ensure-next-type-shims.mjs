import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const CANDIDATE_DIRS = [
  path.join(ROOT_DIR, ".next", "types"),
  path.join(ROOT_DIR, "web-dist", "types"),
  path.join(ROOT_DIR, "web-dist", "dev", "types"),
  path.join(ROOT_DIR, "web-dist-dev", "types"),
  path.join(ROOT_DIR, "web-dist-dev", "dev", "types"),
  path.join(ROOT_DIR, "web-dist-browser-regression", "types"),
  path.join(ROOT_DIR, "web-dist-browser-regression", "dev", "types"),
];

async function ensureRoutesShim(directory) {
  const routesDtsPath = path.join(directory, "routes.d.ts");
  const validatorPath = path.join(directory, "validator.ts");
  const routesJsPath = path.join(directory, "routes.js");

  const hasRoutesDts = await fs.access(routesDtsPath).then(() => true).catch(() => false);
  const hasValidator = await fs.access(validatorPath).then(() => true).catch(() => false);
  if (!hasRoutesDts || !hasValidator) {
    return false;
  }

  const hasRoutesJs = await fs.access(routesJsPath).then(() => true).catch(() => false);
  if (hasRoutesJs) {
    return false;
  }

  await fs.writeFile(routesJsPath, "export {}\n", "utf8");
  return true;
}

const ensured = [];
for (const directory of CANDIDATE_DIRS) {
  const created = await ensureRoutesShim(directory);
  if (created) {
    ensured.push(path.relative(ROOT_DIR, path.join(directory, "routes.js")));
  }
}

if (ensured.length > 0) {
  console.log(`[ensure-next-type-shims] created ${ensured.length} shim(s):`);
  ensured.forEach((entry) => console.log(`- ${entry}`));
}
