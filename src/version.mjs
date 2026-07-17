import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8"));

export function runtimeIdentity(executablePath = process.execPath) {
  const manifestPath = join(dirname(executablePath), "engine-manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return { version: manifest.engineVersion, commitSha: manifest.engineCommitSha };
  }
  return {
    version: packageJson.version,
    commitSha: process.env.REPO_GOVERNANCE_ENGINE_SHA || "development",
  };
}
