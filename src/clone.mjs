import { existsSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";
import { bootstrapRepository } from "./bootstrap.mjs";
import { GovernanceError } from "./errors.mjs";
import { runGit } from "./process.mjs";
import { runtimeIdentity } from "./version.mjs";

function inferredDirectory(repository) {
  const withoutSlash = String(repository).replace(/[\\/]$/, "");
  return basename(withoutSlash).replace(/\.git$/, "");
}

export function cloneRepository(repository, directory, {
  cwd = process.cwd(),
  presetName,
  defaultBranch,
  env = process.env,
  identity = runtimeIdentity(),
  verifyInstallation = true,
} = {}) {
  if (!repository) throw new GovernanceError("clone requires a repository URL or path.", { code: "RG_INVOCATION" });
  if (!presetName) throw new GovernanceError("--preset is required.", { code: "RG_INVOCATION" });
  const target = resolve(cwd, directory || inferredDirectory(repository));
  if (existsSync(target)) throw new GovernanceError("Clone target already exists.", { code: "RG_TARGET_EXISTS", details: { repoPath: target } });
  try {
    runGit(["clone", repository, target], { cwd, env });
    const bootstrap = bootstrapRepository(target, { presetName, defaultBranch, env, identity, verifyInstallation });
    if (!bootstrap.ok) {
      rmSync(target, { recursive: true, force: true });
      return {
        schemaVersion: 1,
        command: "clone",
        ok: false,
        status: "needs_attention",
        exitCode: 1,
        repoPath: target,
        preset: bootstrap.preset,
        initialized: false,
        initialCommit: null,
        hookConnected: false,
        checkResult: bootstrap.checkResult,
        nextActions: bootstrap.nextActions,
        message: "Cloned repository failed adoption; the created target was removed.",
      };
    }
    return {
      schemaVersion: 1,
      command: "clone",
      ok: true,
      status: "succeeded",
      exitCode: 0,
      repoPath: target,
      preset: bootstrap.preset,
      initialized: true,
      initialCommit: null,
      hookConnected: bootstrap.hookConnected,
      checkResult: bootstrap.checkResult,
      nextActions: bootstrap.nextActions,
      message: `Cloned and bootstrapped ${basename(target)} with preset ${presetName}.`,
    };
  } catch (error) {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    if (error instanceof GovernanceError && !error.details.repoPath) error.details.repoPath = target;
    throw error;
  }
}
