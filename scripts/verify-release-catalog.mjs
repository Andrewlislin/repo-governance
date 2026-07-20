import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { verifyReleaseCatalog } from "../src/release-catalog.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDirectory = resolve(process.env.REPO_GOVERNANCE_RELEASE_OUTPUT || join(root, "release", "final"));
const version = process.env.REPO_GOVERNANCE_BUILD_VERSION || JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const commitSha = process.env.REPO_GOVERNANCE_BUILD_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const catalog = verifyReleaseCatalog(
  readFileSync(join(outputDirectory, "release-catalog.json")),
  readFileSync(join(outputDirectory, "release-catalog.sig")),
);
const latest = catalog.releases.at(-1);
if (latest.version !== version || latest.commitSha !== commitSha) throw new Error("Signed catalog does not identify the release being published.");
