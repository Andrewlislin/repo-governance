import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const sourceRoot = resolve(process.env.REPO_GOVERNANCE_RELEASE_SOURCE || join(root, "release"));
const outputRoot = resolve(process.env.REPO_GOVERNANCE_RELEASE_OUTPUT || join(root, "release", "final"));
mkdirSync(outputRoot, { recursive: true });

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walk(directory) {
  const entries = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (path === outputRoot) continue;
    if (statSync(path).isDirectory()) entries.push(...walk(path));
    else entries.push(path);
  }
  return entries;
}

const archives = walk(sourceRoot)
  .filter((path) => /repo-governance-v.+-(linux-x64|darwin-arm64)\.tar\.gz$/.test(path) || /repo-governance-v.+-win32-x64\.zip$/.test(path))
  .sort((a, b) => basename(a).localeCompare(basename(b)));

if (archives.length === 0) throw new Error(`No platform archives found under ${sourceRoot}.`);

const records = [];
for (const archive of archives) {
  const manifestPath = join(dirname(archive), "release-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  cpSync(archive, join(outputRoot, basename(archive)));
  records.push({
    platform: manifest.platform,
    file: basename(archive),
    sha256: sha256(archive),
    manifestSha256: sha256(manifestPath),
    archiveFormat: archive.endsWith(".zip") ? "zip" : "tar.gz",
  });
}

const firstManifest = JSON.parse(readFileSync(join(dirname(archives[0]), "release-manifest.json"), "utf8"));
const index = {
  schemaVersion: 1,
  artifactLayout: "platform-archive-v1",
  engineVersion: firstManifest.engineVersion,
  engineCommitSha: firstManifest.engineCommitSha,
  repository: firstManifest.repository,
  buildWorkflow: firstManifest.buildWorkflow,
  archives: records,
};

writeFileSync(join(outputRoot, "SHA256SUMS"), `${records.map((record) => `${record.sha256}  ${record.file}`).join("\n")}\n`);
writeFileSync(join(outputRoot, "release-index.json"), `${JSON.stringify(index, null, 2)}\n`);
