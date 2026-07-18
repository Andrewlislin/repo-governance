import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { treeDigest } from "../src/tree-digest.mjs";
import { stageCodexSkills } from "../src/agent-assets.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const platform = process.env.REPO_GOVERNANCE_PLATFORM || `${process.platform}-${process.arch}`;
const commitSha = process.env.REPO_GOVERNANCE_BUILD_SHA;
if (!/^[0-9a-f]{40}$/.test(commitSha || "")) throw new Error("REPO_GOVERNANCE_BUILD_SHA must be the full source commit.");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const extension = process.platform === "win32" ? ".exe" : "";
const staging = join(root, "release", "staging", platform);
const assets = join(root, "release", "assets", platform);
rmSync(staging, { recursive: true, force: true });
rmSync(assets, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
mkdirSync(assets, { recursive: true });

function copyWithDigest(name) {
  const source = join(root, "dist", `${name}${extension}`);
  const targetName = `${name}${extension}`;
  cpSync(source, join(staging, targetName));
  return { file: targetName, sha256: createHash("sha256").update(readFileSync(source)).digest("hex") };
}

function archiveExtension() {
  return platform.startsWith("win32") ? ".zip" : ".tar.gz";
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
}

function createArchive(archivePath) {
  if (archivePath.endsWith(".zip")) {
    run("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${staging.replaceAll("'", "''")}/*' -DestinationPath '${archivePath.replaceAll("'", "''")}' -Force`]);
    return;
  }
  run("tar", ["-czf", archivePath, "-C", staging, "."]);
}

const cli = copyWithDigest("repo-governance");
const dispatcher = copyWithDigest("dispatcher");
stageCodexSkills({
  skillsSource: join(root, "adapters", "codex", "skills"),
  playbooksSource: join(root, "playbooks"),
  destination: join(staging, "skills"),
});
cpSync(join(root, "presets"), join(staging, "policy-assets", "presets"), { recursive: true });
cpSync(join(root, "schemas"), join(staging, "policy-assets", "schemas"), { recursive: true });
cpSync(join(root, "playbooks"), join(staging, "agent-assets", "playbooks"), { recursive: true });
cpSync(join(root, "adapters", "codex"), join(staging, "agent-assets", "adapters", "codex"), { recursive: true });
const manifest = {
  schemaVersion: 1,
  engineVersion: version,
  engineCommitSha: commitSha,
  repository: "Andrewlislin/repo-governance",
  buildWorkflow: ".github/workflows/release.yml",
  platform,
  artifactLayout: "platform-archive-v1",
  cli,
  dispatcher,
  skillsSha256: treeDigest(join(staging, "skills")),
  policyAssetsSha256: treeDigest(join(staging, "policy-assets")),
  agentAssetsSha256: treeDigest(join(staging, "agent-assets")),
  attestationRequired: true,
};
writeFileSync(join(staging, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(staging, "SHA256SUMS"), `${cli.sha256}  ${cli.file}\n${dispatcher.sha256}  ${dispatcher.file}\n`);
cpSync(join(staging, "release-manifest.json"), join(assets, "release-manifest.json"));
const archiveName = `repo-governance-v${version}-${platform}${archiveExtension()}`;
const archivePath = join(assets, archiveName);
createArchive(archivePath);
