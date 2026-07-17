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
  const skillsSource = join(root, "skills");
  for (const required of [cliSource, dispatcherSource, skillsSource]) {
    if (!existsSync(required)) throw new GovernanceError(`Expected build output is missing: ${required}`, { code: "RG_INSTALL" });
  }

  const dataRoot = governanceDataRoot(env, platform);
  const engineDirectory = join(dataRoot, "engines", commitSha);
  const dispatcherTarget = join(dataRoot, dispatcherFile);
  if (existsSync(engineDirectory)) throw new GovernanceError("Engine version is already installed; refusing an implicit replacement.", { code: "RG_INSTALL" });
  if (existsSync(dispatcherTarget)) throw new GovernanceError("Stable dispatcher already exists; use repo-governance update instead of install:local.", { code: "RG_INSTALL" });

  const cliSha256 = digest(cliSource);
  const dispatcherSha256 = digest(dispatcherSource);
  const skillsSha256 = treeDigest(skillsSource);

  try {
    mkdirSync(engineDirectory, { recursive: true });
    const cliTarget = join(engineDirectory, cliFile);
    cpSync(cliSource, cliTarget);
    cpSync(dispatcherSource, dispatcherTarget);
    if (platform !== "win32") {
      chmodSync(cliTarget, 0o755);
      chmodSync(dispatcherTarget, 0o755);
    }

    const engineManifest = {
      schemaVersion: 1,
      engineVersion: version,
      engineCommitSha: commitSha,
      repository: "Andrewlislin/repo-governance",
      installKind: "source",
      platform: `${platform}-${arch}`,
      cli: { file: cliFile, sha256: cliSha256 },
      dispatcher: { file: dispatcherFile, sha256: dispatcherSha256 },
      skillsSha256,
    };
    writeFileSync(join(engineDirectory, "local-engine-manifest.json"), `${JSON.stringify(engineManifest, null, 2)}\n`);
    writeFileSync(join(engineDirectory, "engine-manifest.json"), `${JSON.stringify({ engineVersion: version, engineCommitSha: commitSha, sha256: cliSha256 }, null, 2)}\n`);
    writeFileSync(join(engineDirectory, "SHA256SUMS"), `${cliSha256}  ${cliFile}\n${dispatcherSha256}  ${dispatcherFile}\n`);
    const skills = installSkills(skillsSource, { env });
    return { engineVersion: version, engineCommitSha: commitSha, dataRoot, engineDirectory, executable: cliTarget, dispatcher: dispatcherTarget, skills };
  } catch (error) {
    rmSync(engineDirectory, { recursive: true, force: true });
    rmSync(dispatcherTarget, { force: true });
    throw error;
  }
}

if (process.argv[1] === scriptPath) {
  try {
    const result = installLocalFromSource();
    process.stdout.write(`Installed repo-governance ${result.engineVersion} from source at ${result.engineDirectory}\n`);
    process.stdout.write(`Run next: ${result.executable} hooks install\n`);
    process.stdout.write("Then initialize future repositories with: repo-governance init\n");
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
