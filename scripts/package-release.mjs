import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { treeDigest } from "../src/tree-digest.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const platform = process.env.REPO_GOVERNANCE_PLATFORM || `${process.platform}-${process.arch}`;
const commitSha = process.env.REPO_GOVERNANCE_BUILD_SHA;
if (!/^[0-9a-f]{40}$/.test(commitSha || "")) throw new Error("REPO_GOVERNANCE_BUILD_SHA must be the full source commit.");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const extension = process.platform === "win32" ? ".exe" : "";
const output = join(root, "release", platform);
mkdirSync(output, { recursive: true });

function copyWithDigest(name) {
  const source = join(root, "dist", `${name}${extension}`);
  const targetName = `${name}${extension}`;
  cpSync(source, join(output, targetName));
  return { file: targetName, sha256: createHash("sha256").update(readFileSync(source)).digest("hex") };
}

const cli = copyWithDigest("repo-governance");
const dispatcher = copyWithDigest("dispatcher");
cpSync(join(root, "skills"), join(output, "skills"), { recursive: true });
const manifest = {
  schemaVersion: 1,
  engineVersion: version,
  engineCommitSha: commitSha,
  repository: "Andrewlislin/repo-governance",
  buildWorkflow: ".github/workflows/release.yml",
  platform,
  cli,
  dispatcher,
  skillsSha256: treeDigest(join(output, "skills")),
  attestationRequired: true,
};
writeFileSync(join(output, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(output, "SHA256SUMS"), `${cli.sha256}  ${cli.file}\n${dispatcher.sha256}  ${dispatcher.file}\n`);
