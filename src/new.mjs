import { existsSync, rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { bootstrapRepository } from "./bootstrap.mjs";
import { checkRepository } from "./check.mjs";
import { GovernanceError } from "./errors.mjs";
import { runGit } from "./process.mjs";
import { runtimeIdentity } from "./version.mjs";

function removeCreatedTarget(target) {
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}

export function newRepository(name, {
  cwd = process.cwd(),
  presetName,
  defaultBranch = "main",
  env = process.env,
  identity = runtimeIdentity(),
  verifyInstallation = true,
} = {}) {
  if (!name) throw new GovernanceError("new requires a repository name or path.", { code: "RG_INVOCATION" });
  if (!presetName) throw new GovernanceError("--preset is required.", { code: "RG_INVOCATION" });
  const target = resolve(cwd, name);
  if (existsSync(target)) throw new GovernanceError("New repository target already exists.", { code: "RG_TARGET_EXISTS", details: { repoPath: target } });
  try {
    runGit(["init", "-b", defaultBranch, target], { cwd: dirname(target), env });
    const identityCheck = runGit(["-c", "user.useConfigOnly=true", "var", "GIT_AUTHOR_IDENT"], { cwd: target, env, allowFailure: true });
    if (identityCheck.status !== 0) throw new GovernanceError("Git author identity is required for the initial governance commit.", { code: "RG_GIT_IDENTITY", details: { repoPath: target } });
    const bootstrap = bootstrapRepository(target, {
      presetName,
      defaultBranch,
      env,
      identity,
      verifyInstallation,
      deferCheck: true,
    });
    runGit(["add", "--", ...bootstrap.writtenFiles], { cwd: target, env });
    runGit(["commit", "-m", "chore: initialize repository governance", "--", ...bootstrap.writtenFiles], { cwd: target, env });
    const initialCommit = runGit(["rev-parse", "HEAD"], { cwd: target, env }).stdout.trim();
    const checkResult = checkRepository(target, { base: defaultBranch });
    if (!checkResult.ok) {
      removeCreatedTarget(target);
      return {
        schemaVersion: 1,
        command: "new",
        ok: false,
        status: "needs_attention",
        exitCode: 1,
        repoPath: target,
        preset: bootstrap.preset,
        initialized: false,
        initialCommit: null,
        hookConnected: false,
        checkResult,
        nextActions: bootstrap.nextActions,
        message: "New repository governance check failed; the created target was removed.",
      };
    }
    return {
      schemaVersion: 1,
      command: "new",
      ok: true,
      status: "succeeded",
      exitCode: 0,
      repoPath: target,
      preset: bootstrap.preset,
      initialized: true,
      initialCommit,
      hookConnected: bootstrap.hookConnected,
      checkResult,
      nextActions: bootstrap.nextActions,
      message: `Created ${basename(target)} with preset ${presetName}.`,
    };
  } catch (error) {
    removeCreatedTarget(target);
    if (error instanceof GovernanceError && !error.details.repoPath) error.details.repoPath = target;
    throw error;
  }
}
