#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { GovernanceError } from "../src/errors.mjs";
import { governanceDataRoot } from "../src/paths.mjs";
import { installSkills } from "../src/skills-install.mjs";
import { treeDigest } from "../src/tree-digest.mjs";
import { stageAgentAssets } from "../src/agent-assets.mjs";
import { assertRuntimeEntriesAvailable, installRuntimeEntries } from "../src/launcher-install.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(scriptPath), "..");

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function defaultRun(command, args, options = {}) {
  return execFileSync(command, args, { cwd: options.cwd, env: options.env, encoding: "utf8", stdio: options.stdio || "pipe" });
}

function executableName(name, platform) {
  return platform === "win32" ? `${name}.exe` : name;
}

function checkedGitOutput(root, args, runCommand) {
  return String(runCommand("git", args, { cwd: root })).trim();
}

export function installLocalFromSource({
  root = defaultRoot,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.versions.node,
  runCommand = defaultRun,
} = {}) {
  if (Number(nodeVersion.split(".")[0]) !== 22) {
    throw new GovernanceError(`Local source installation requires Node.js 22.x; found ${nodeVersion}.`, { code: "RG_INSTALL" });
  }

  const commitSha = checkedGitOutput(root, ["rev-parse", "HEAD"], runCommand);
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new GovernanceError("Local source installation requires a full 40-character git commit SHA.", { code: "RG_INSTALL" });
  }

  const dirty = checkedGitOutput(root, ["status", "--porcelain"], runCommand);
  if (dirty) {
    throw new GovernanceError("Local source installation requires a clean git working tree so engineCommitSha matches the built source.", { code: "RG_INSTALL" });
  }

  runCommand("npm", ["run", "check"], { cwd: root, env, stdio: "inherit" });
  runCommand("npm", ["run", "build:sea"], { cwd: root, env: { ...env, REPO_GOVERNANCE_BUILD_SHA: commitSha }, stdio: "inherit" });

  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const cliFile = executableName("repo-governance", platform);
  const dispatcherFile = executableName("dispatcher", platform);
  const cliSource = join(root, "dist", cliFile);
  const dispatcherSource = join(root, "dist", dispatcherFile);
  const skillsSource = join(root, "adapters", "codex", "skills");
  const playbooksSource = join(root, "playbooks");
  const adaptersSource = join(root, "adapters");
  for (const required of [cliSource, dispatcherSource, skillsSource, playbooksSource, adaptersSource]) {
    if (!existsSync(required)) throw new GovernanceError(`Expected build output is missing: ${required}`, { code: "RG_INSTALL" });
  }

  const dataRoot = governanceDataRoot(env, platform);
  const engineDirectory = join(dataRoot, "engines", commitSha);
  if (existsSync(engineDirectory)) throw new GovernanceError("Engine version is already installed; refusing an implicit replacement.", { code: "RG_INSTALL" });
  assertRuntimeEntriesAvailable({ env, platform, engineCommitSha: commitSha });

  const cliSha256 = digest(cliSource);
  const dispatcherSha256 = digest(dispatcherSource);
  const skillsSha256 = treeDigest(skillsSource);
  const installedAt = new Date().toISOString();

  let skills = null;
  try {
    mkdirSync(engineDirectory, { recursive: true });
    const cliTarget = join(engineDirectory, cliFile);
    cpSync(cliSource, cliTarget);
    const agentAssets = join(engineDirectory, "agent-assets");
    stageAgentAssets({ playbooksSource, adaptersSource, destination: agentAssets });
    if (platform !== "win32") {
      chmodSync(cliTarget, 0o755);
    }

    const engineManifest = {
      schemaVersion: 1,
      engineVersion: version,
      engineCommitSha: commitSha,
      repository: "CoaseEdge/repo-governance",
      installKind: "source",
      installedAt,
      platform: `${platform}-${arch}`,
      cli: { file: cliFile, sha256: cliSha256 },
      dispatcher: { file: dispatcherFile, sha256: dispatcherSha256 },
      launcher: { file: dispatcherFile, sha256: dispatcherSha256 },
      skillsSha256,
      playbooksSha256: treeDigest(playbooksSource),
      agentAssetsSha256: treeDigest(agentAssets),
    };
    writeFileSync(join(engineDirectory, "local-engine-manifest.json"), `${JSON.stringify(engineManifest, null, 2)}\n`);
    writeFileSync(join(engineDirectory, "engine-manifest.json"), `${JSON.stringify({
      engineVersion: version,
      engineCommitSha: commitSha,
      sha256: cliSha256,
      installedAt,
      agentAssetsSha256: engineManifest.agentAssetsSha256,
    }, null, 2)}\n`);
    writeFileSync(join(engineDirectory, "SHA256SUMS"), `${cliSha256}  ${cliFile}\n${dispatcherSha256}  ${dispatcherFile}\n`);
    skills = installSkills(skillsSource, { env, playbooksSource });
    const runtime = installRuntimeEntries({
      launcherSource: dispatcherSource,
      engineVersion: version,
      engineCommitSha: commitSha,
      env,
      platform,
    });
    return {
      engineVersion: version,
      engineCommitSha: commitSha,
      dataRoot,
      engineDirectory,
      executable: cliTarget,
      dispatcher: runtime.legacyDispatcherPath,
      agentAssets,
      skills,
      ...runtime,
    };
  } catch (error) {
    rmSync(engineDirectory, { recursive: true, force: true });
    for (const name of skills?.installed || []) rmSync(join(skills.root, name), { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] === scriptPath) {
  try {
    const result = installLocalFromSource();
    process.stdout.write(`${result.message}\n`);
    if (result.actionRequired) process.stdout.write(`Run next: ${result.actionRequired}\n`);
    process.stdout.write(`Run next: ${result.executable} hooks install\n`);
    process.stdout.write("Then adopt a repository with: repo-governance bootstrap --preset <preset>\n");
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
