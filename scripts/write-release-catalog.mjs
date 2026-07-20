import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { writeSignedReleaseCatalog } from "../src/release-catalog-build.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const releaseMetadata = JSON.parse(readFileSync(join(root, "release-metadata.json"), "utf8"));
const version = process.env.REPO_GOVERNANCE_BUILD_VERSION || packageJson.version;
const commitSha = process.env.REPO_GOVERNANCE_BUILD_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const commitDate = execFileSync("git", ["show", "-s", "--format=%cI", commitSha], { cwd: root, encoding: "utf8" }).trim();
const releasedAt = process.env.REPO_GOVERNANCE_RELEASED_AT || new Date(commitDate).toISOString();
const privateKeyPem = process.env.REPO_GOVERNANCE_CATALOG_PRIVATE_KEY;

if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error("REPO_GOVERNANCE_BUILD_SHA must be the full release commit SHA.");
if (releaseMetadata.schemaVersion !== 1 || typeof releaseMetadata.securityFix !== "boolean") throw new Error("release-metadata.json is invalid.");
if (!privateKeyPem) throw new Error("REPO_GOVERNANCE_CATALOG_PRIVATE_KEY is required in the controlled release environment.");

writeSignedReleaseCatalog({
  sourcePath: resolve(process.env.REPO_GOVERNANCE_CATALOG_SOURCE || join(root, "release-catalog.json")),
  outputDirectory: resolve(process.env.REPO_GOVERNANCE_RELEASE_OUTPUT || join(root, "release", "final")),
  version,
  commitSha,
  releasedAt,
  securityFix: releaseMetadata.securityFix,
  privateKeyPem,
});
