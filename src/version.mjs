import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function developmentVersion() {
  try {
    const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    return JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8")).version;
  } catch {
    return "0.0.0-development";
  }
}

export function runtimeIdentity(executablePath = process.execPath) {
  const manifestPath = join(dirname(executablePath), "engine-manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return { version: manifest.engineVersion, commitSha: manifest.engineCommitSha };
  }
  return {
    version: typeof REPO_GOVERNANCE_BUILD_VERSION !== "undefined" ? REPO_GOVERNANCE_BUILD_VERSION : developmentVersion(),
    commitSha: process.env.REPO_GOVERNANCE_ENGINE_SHA
      || (typeof REPO_GOVERNANCE_BUILD_SHA !== "undefined" ? REPO_GOVERNANCE_BUILD_SHA : "development"),
  };
}
