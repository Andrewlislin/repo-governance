import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, normalize } from "node:path";
import { GovernanceError } from "./errors.mjs";
import { governanceDataRoot } from "./paths.mjs";

export const MANAGED_ENTRY_MARKER = "repo-governance:managed-command-entry:v1";
export const MANAGED_LAUNCHER_MARKER = "repo-governance:managed-launcher:v1";

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function atomicWrite(path, contents, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, contents, mode === undefined ? undefined : { mode });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function atomicCopy(source, target, mode) {
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    copyFileSync(source, temporary);
    if (mode !== undefined) chmodSync(temporary, mode);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function userBinDirectory(env = process.env, platform = process.platform) {
  if (platform === "win32") return join(governanceDataRoot(env, platform), "bin");
  return join(env.HOME || homedir(), ".local", "bin");
}

export function runtimeEntryPaths({
  env = process.env,
  platform = process.platform,
  engineCommitSha,
} = {}) {
  const dataRoot = governanceDataRoot(env, platform);
  const launcherDirectory = join(dataRoot, "launcher");
  const launcherPath = platform === "win32"
    ? join(launcherDirectory, engineCommitSha, "repo-governance-launcher.exe")
    : join(launcherDirectory, "repo-governance-launcher");
  return {
    dataRoot,
    launcherDirectory,
    launcherPath,
    launcherManifestPath: join(launcherDirectory, "launcher-manifest.json"),
    defaultEnginePath: join(dataRoot, "default-engine.json"),
    commandPath: join(userBinDirectory(env, platform), platform === "win32" ? "repo-governance.cmd" : "repo-governance"),
    legacyDispatcherPath: join(dataRoot, platform === "win32" ? "dispatcher.exe" : "dispatcher"),
  };
}

function normalizePathEntry(value, platform) {
  let unquoted = value.trim();
  if (unquoted.startsWith('"') && unquoted.endsWith('"')) unquoted = unquoted.slice(1, -1);
  const normalized = normalize(unquoted).replace(/[\\/]+$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isPathConfigured(binDirectory, env = process.env, platform = process.platform) {
  const expected = normalizePathEntry(binDirectory, platform);
  const pathDelimiter = platform === process.platform ? delimiter : platform === "win32" ? ";" : ":";
  return String(env.PATH || "")
    .split(pathDelimiter)
    .filter(Boolean)
    .some((entry) => normalizePathEntry(entry, platform) === expected);
}

function pathAction(binDirectory, platform) {
  if (platform === "win32") {
    const escaped = binDirectory.replaceAll("'", "''");
    return `$userPath = [Environment]::GetEnvironmentVariable('Path', 'User'); [Environment]::SetEnvironmentVariable('Path', '${escaped};' + $userPath, 'User')`;
  }
  return `export PATH="${binDirectory}:$PATH"`;
}

function commandContents(launcherPath, platform) {
  if (platform === "win32") {
    return `@echo off\r\nREM ${MANAGED_ENTRY_MARKER}\r\n"${launcherPath}" %*\r\nexit /b %ERRORLEVEL%\r\n`;
  }
  const quoted = launcherPath.replaceAll("'", `'"'"'`);
  return `#!/bin/sh\n# ${MANAGED_ENTRY_MARKER}\nexec '${quoted}' "$@"\n`;
}

function launcherManifest({ env = process.env, platform = process.platform } = {}) {
  const path = runtimeEntryPaths({ env, platform, engineCommitSha: "pending" }).launcherManifestPath;
  if (!existsSync(path)) return null;
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    if (manifest.marker !== MANAGED_LAUNCHER_MARKER || !existsSync(manifest.launcherPath) || digest(manifest.launcherPath) !== manifest.sha256) return null;
    return manifest;
  } catch {
    return null;
  }
}

function isManagedCommand(path, env, platform) {
  if (!existsSync(path)) return false;
  const stat = lstatSync(path);
  const manifest = launcherManifest({ env, platform });
  return stat.isFile()
    && !stat.isSymbolicLink()
    && manifest !== null
    && readFileSync(path, "utf8") === commandContents(manifest.launcherPath, platform);
}

export function assertCommandEntryAvailable({ env = process.env, platform = process.platform } = {}) {
  const paths = runtimeEntryPaths({ env, platform, engineCommitSha: "pending" });
  if (existsSync(paths.commandPath) && !isManagedCommand(paths.commandPath, env, platform)) {
    throw new GovernanceError(`Refusing to overwrite an unmanaged repo-governance command entry: ${paths.commandPath}`, {
      code: "RG_INSTALL_COMMAND_CONFLICT",
      details: { commandPath: paths.commandPath },
    });
  }
  return paths.commandPath;
}

export function assertRuntimeEntriesAvailable({
  env = process.env,
  platform = process.platform,
  engineCommitSha = "pending",
} = {}) {
  assertCommandEntryAvailable({ env, platform });
  const paths = runtimeEntryPaths({ env, platform, engineCommitSha });
  const manifest = launcherManifest({ env, platform });
  if (existsSync(paths.launcherPath) && (
    manifest === null
    || normalizePathEntry(manifest.launcherPath, platform) !== normalizePathEntry(paths.launcherPath, platform)
  )) {
    throw new GovernanceError(`Refusing to overwrite an unmanaged repo-governance launcher: ${paths.launcherPath}`, {
      code: "RG_INSTALL_LAUNCHER_CONFLICT",
      details: { launcherPath: paths.launcherPath },
    });
  }
  return paths;
}

export function readDefaultEngine({ env = process.env, platform = process.platform } = {}) {
  const path = runtimeEntryPaths({ env, platform, engineCommitSha: "pending" }).defaultEnginePath;
  if (!existsSync(path)) return null;
  let pointer;
  try {
    pointer = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new GovernanceError("Default engine pointer is invalid JSON.", { code: "RG_DEFAULT_ENGINE_INVALID", details: { path } });
  }
  if (pointer.schemaVersion !== 1 || !/^[0-9a-f]{40}$/.test(pointer.engineCommitSha || "") || typeof pointer.engineVersion !== "string") {
    throw new GovernanceError("Default engine pointer is invalid.", { code: "RG_DEFAULT_ENGINE_INVALID", details: { path } });
  }
  return pointer;
}

export function writeDefaultEngine(identity, { env = process.env, platform = process.platform } = {}) {
  const path = runtimeEntryPaths({ env, platform, engineCommitSha: identity.engineCommitSha }).defaultEnginePath;
  atomicWrite(path, `${JSON.stringify({ schemaVersion: 1, ...identity }, null, 2)}\n`);
  return path;
}

function snapshot(path) {
  if (!existsSync(path)) return { existed: false };
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new GovernanceError(`Managed runtime path is not a regular file: ${path}`, { code: "RG_INSTALL_CONFLICT", details: { path } });
  }
  return { existed: true, contents: readFileSync(path), mode: stat.mode };
}

function restore(path, saved) {
  if (!saved.existed) {
    rmSync(path, { force: true });
    return;
  }
  atomicWrite(path, saved.contents, saved.mode);
}

export function installRuntimeEntries({
  launcherSource,
  engineVersion,
  engineCommitSha,
  env = process.env,
  platform = process.platform,
  installLegacyDispatcher = true,
  failAfterLauncher = false,
} = {}) {
  const paths = assertRuntimeEntriesAvailable({ env, platform, engineCommitSha });
  const mutablePaths = [paths.launcherPath, paths.launcherManifestPath, paths.commandPath, paths.defaultEnginePath];
  if (installLegacyDispatcher && !existsSync(paths.legacyDispatcherPath)) mutablePaths.push(paths.legacyDispatcherPath);
  const saved = new Map(mutablePaths.map((path) => [path, snapshot(path)]));
  try {
    atomicCopy(launcherSource, paths.launcherPath, platform === "win32" ? undefined : 0o755);
    if (failAfterLauncher) throw new GovernanceError("Injected launcher installation failure.", { code: "RG_INSTALL_LAUNCHER" });
    atomicWrite(paths.launcherManifestPath, `${JSON.stringify({
      schemaVersion: 1,
      marker: MANAGED_LAUNCHER_MARKER,
      launcherPath: paths.launcherPath,
      engineVersion,
      engineCommitSha,
      sha256: digest(paths.launcherPath),
    }, null, 2)}\n`);
    atomicWrite(paths.commandPath, commandContents(paths.launcherPath, platform), platform === "win32" ? undefined : 0o755);
    if (installLegacyDispatcher && !existsSync(paths.legacyDispatcherPath)) {
      atomicCopy(launcherSource, paths.legacyDispatcherPath, platform === "win32" ? undefined : 0o755);
    }
    writeDefaultEngine({ engineVersion, engineCommitSha }, { env, platform });
    const binDirectory = dirname(paths.commandPath);
    const pathConfigured = isPathConfigured(binDirectory, env, platform);
    return {
      ...paths,
      defaultEngineCommitSha: engineCommitSha,
      pathConfigured,
      actionRequired: pathConfigured ? null : pathAction(binDirectory, platform),
      message: pathConfigured
        ? `Installed managed repo-governance command entry at ${paths.commandPath}.`
        : `Created the managed command entry at ${paths.commandPath}, but the current shell cannot use the bare repo-governance command until PATH is updated.`,
    };
  } catch (error) {
    for (const path of [...mutablePaths].reverse()) restore(path, saved.get(path));
    throw error;
  }
}

export function verifyManagedLauncher({ env = process.env, platform = process.platform } = {}) {
  return launcherManifest({ env, platform }) !== null;
}
