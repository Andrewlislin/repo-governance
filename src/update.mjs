import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readConfig } from "./config.mjs";
import { GovernanceError } from "./errors.mjs";
import { trackedChanges } from "./git.mjs";
import { governanceDataRoot } from "./paths.mjs";
import { installRuntimeEntries } from "./launcher-install.mjs";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function controlledUpdate(repo, bundleDirectory, {
  env = process.env,
  failAfterReplace = false,
  failAfterLauncher = false,
  platform = process.platform,
} = {}) {
  const current = readConfig(repo, { enforceEngine: false });
  const dirty = trackedChanges(repo, current.managedFiles || [".repo-governance.json"]);
  if (dirty.length > 0) throw new GovernanceError("Managed files have uncommitted changes; update was not started.", { code: "RG_UPDATE_DIRTY", details: { dirty } });
  const manifest = JSON.parse(readFileSync(join(bundleDirectory, "update-manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.diffFingerprintAlgorithm !== current.diffFingerprintAlgorithm) throw new GovernanceError("Update manifest is incompatible with this configuration.", { code: "RG_UPDATE_MANIFEST" });
  const engineSource = join(bundleDirectory, manifest.engine.file);
  if (!existsSync(engineSource) || sha256(engineSource) !== manifest.engine.sha256) throw new GovernanceError("New engine checksum verification failed.", { code: "RG_UPDATE_ENGINE" });
  if (!manifest.launcher?.file || !manifest.launcher?.sha256) {
    throw new GovernanceError("Update manifest must include the verified version-aware launcher.", { code: "RG_UPDATE_LAUNCHER" });
  }
  const launcherSource = join(bundleDirectory, manifest.launcher.file);
  if (!existsSync(launcherSource) || sha256(launcherSource) !== manifest.launcher.sha256) {
    throw new GovernanceError("New launcher checksum verification failed.", { code: "RG_UPDATE_LAUNCHER" });
  }
  const dataRoot = governanceDataRoot(env);
  const engineDirectory = join(dataRoot, "engines", manifest.engineCommitSha);
  const staging = mkdtempSync(join(tmpdir(), "repo-governance-update-"));
  const backup = join(staging, "backup");
  const generated = join(staging, "generated");
  let engineInstalled = false;
  const replaced = [];
  try {
    mkdirSync(join(dataRoot, "engines"), { recursive: true });
    if (existsSync(engineDirectory)) throw new GovernanceError("Target engine is already installed; refusing to replace it implicitly.", { code: "RG_UPDATE_ENGINE" });
    mkdirSync(engineDirectory, { recursive: false });
    const engineTarget = join(engineDirectory, platform === "win32" ? "repo-governance.exe" : "repo-governance");
    cpSync(engineSource, engineTarget);
    if (platform !== "win32") chmodSync(engineTarget, 0o755);
    writeFileSync(join(engineDirectory, "engine-manifest.json"), `${JSON.stringify({ engineVersion: manifest.engineVersion, engineCommitSha: manifest.engineCommitSha, sha256: manifest.engine.sha256 }, null, 2)}\n`);
    engineInstalled = true;
    for (const relative of manifest.managedFiles) {
      const source = join(bundleDirectory, "managed", relative);
      if (!existsSync(source)) throw new GovernanceError(`Update bundle is missing managed file ${relative}.`, { code: "RG_UPDATE_MANIFEST" });
      mkdirSync(dirname(join(generated, relative)), { recursive: true });
      cpSync(source, join(generated, relative));
    }
    const nextConfigPath = join(generated, ".repo-governance.json");
    const nextConfig = JSON.parse(readFileSync(nextConfigPath, "utf8"));
    if (nextConfig.engineVersion !== manifest.engineVersion || nextConfig.engineCommitSha !== manifest.engineCommitSha || nextConfig.diffFingerprintAlgorithm !== manifest.diffFingerprintAlgorithm) {
      throw new GovernanceError("Generated configuration and update manifest versions differ.", { code: "RG_UPDATE_MANIFEST" });
    }
    for (const relative of manifest.managedFiles) {
      const target = join(repo, relative);
      if (existsSync(target)) {
        mkdirSync(dirname(join(backup, relative)), { recursive: true });
        cpSync(target, join(backup, relative));
      }
      mkdirSync(dirname(target), { recursive: true });
      renameSync(join(generated, relative), target);
      replaced.push(relative);
      if (failAfterReplace) throw new GovernanceError("Injected replacement failure.", { code: "RG_UPDATE_REPLACE" });
    }
    const reread = readConfig(repo, { enforceEngine: false });
    if (reread.engineVersion !== manifest.engineVersion || reread.engineCommitSha !== manifest.engineCommitSha || reread.diffFingerprintAlgorithm !== manifest.diffFingerprintAlgorithm) {
      throw new GovernanceError("Post-update consistency verification failed.", { code: "RG_UPDATE_VERIFY" });
    }
    const runtime = installRuntimeEntries({
      launcherSource,
      engineVersion: reread.engineVersion,
      engineCommitSha: reread.engineCommitSha,
      env,
      platform,
      failAfterLauncher,
    });
    rmSync(staging, { recursive: true, force: true });
    return {
      updated: true,
      engineVersion: reread.engineVersion,
      engineCommitSha: reread.engineCommitSha,
      defaultEngineCommitSha: reread.engineCommitSha,
      commandPath: runtime.commandPath,
      launcherPath: runtime.launcherPath,
      pathConfigured: runtime.pathConfigured,
      actionRequired: runtime.actionRequired,
      message: `Updated repo-governance to ${reread.engineVersion} (${reread.engineCommitSha}).`,
    };
  } catch (error) {
    for (const relative of replaced.reverse()) {
      const target = join(repo, relative);
      const saved = join(backup, relative);
      if (existsSync(saved)) cpSync(saved, target, { force: true });
      else rmSync(target, { force: true });
    }
    if (engineInstalled) rmSync(engineDirectory, { recursive: true, force: true });
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
