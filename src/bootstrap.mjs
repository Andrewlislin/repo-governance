import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkAdoption } from "./check.mjs";
import { validateConfig, writeConfig } from "./config.mjs";
import { DIFF_FINGERPRINT_ALGORITHM } from "./fingerprint.mjs";
import { GovernanceError } from "./errors.mjs";
import { connectEffectiveRepositoryHook, restoreEffectiveRepositoryHook, snapshotEffectiveRepositoryHook } from "./hooks.mjs";
import { assertLockedRuntime } from "./locked-engine.mjs";
import { loadPreset, materializePreset } from "./presets.mjs";
import { runGit } from "./process.mjs";
import { runtimeIdentity } from "./version.mjs";
import { THIN_WORKFLOW_PATH, thinWorkflow } from "./workflow.mjs";

function gitValue(repo, args, env) {
  const result = runGit(args, { cwd: repo, env, allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function detectDefaultBranch(repo, { explicit, env = process.env } = {}) {
  if (explicit) return explicit;
  const upstream = gitValue(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], env);
  if (upstream?.includes("/")) {
    const remote = upstream.split("/", 1)[0];
    const remoteHead = gitValue(repo, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], env);
    if (remoteHead) return remoteHead.slice(remote.length + 1);
  }
  const originHead = gitValue(repo, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], env);
  if (originHead) return originHead.replace(/^origin\//, "");
  const branches = (gitValue(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads"], env) || "").split("\n").filter(Boolean);
  if (branches.length === 1) return branches[0];
  throw new GovernanceError("Unable to determine the default branch without guessing; pass --default-branch.", { code: "RG_DEFAULT_BRANCH", details: { branches } });
}

function assertCommittedRepository(repo, env) {
  const result = runGit(["rev-parse", "--verify", "HEAD^{commit}"], { cwd: repo, env, allowFailure: true });
  if (result.status !== 0) throw new GovernanceError("Bootstrap requires an existing commit graph. Use repo-governance new for an empty repository or create the first commit.", { code: "RG_GIT_HISTORY_INSUFFICIENT" });
}

function removeEmptyParent(path, stop) {
  let current = dirname(path);
  while (current !== stop && current.startsWith(stop) && existsSync(current) && readdirSync(current).length === 0) {
    rmdirSync(current);
    current = dirname(current);
  }
}

function remoteKind(repo, env) {
  const url = gitValue(repo, ["remote", "get-url", "origin"], env);
  if (!url) return "none";
  return /(?:github\.com[:/])/.test(url) ? "github" : "non-github";
}

function nextActionsFor(materialized, kind) {
  const actions = materialized.missingOptional.map((selector) => ({
    id: `preset-selector:${selector}`,
    severity: "info",
    message: `Optional preset selector is not present and was not materialized: ${selector}.`,
  }));
  for (const candidate of materialized.advisoryCandidates) actions.push({
    id: `public-command-candidate:${candidate.id}`,
    severity: "info",
    message: `Review the preset public-command candidate without creating an unverifiable contract: ${candidate.command}.`,
  });
  if (kind !== "github") actions.push({
    id: "ci-provider-unconfirmed",
    severity: "info",
    message: "The GitHub Actions caller was generated as a template, but the origin is not confirmed as GitHub.",
  });
  return actions;
}

export function bootstrapRepository(repo, {
  presetName,
  defaultBranch,
  env = process.env,
  identity = runtimeIdentity(),
  verifyInstallation = true,
  deferCheck = false,
} = {}) {
  const root = resolve(repo);
  if (!presetName) throw new GovernanceError("--preset is required.", { code: "RG_INVOCATION" });
  if (!deferCheck) assertCommittedRepository(root, env);
  if (verifyInstallation) assertLockedRuntime(identity, env);
  const branch = detectDefaultBranch(root, { explicit: defaultBranch, env });
  const configPath = join(root, ".repo-governance.json");
  const workflowPath = join(root, THIN_WORKFLOW_PATH);
  if (existsSync(configPath)) throw new GovernanceError("Repository is already initialized; bootstrap never overwrites .repo-governance.json.", { code: "RG_CONFIG" });
  if (existsSync(workflowPath)) throw new GovernanceError(`Workflow already exists: ${THIN_WORKFLOW_PATH}.`, { code: "RG_WORKFLOW_CONFLICT" });
  const loaded = loadPreset(presetName);
  const materialized = materializePreset(root, loaded, { engineCommitSha: identity.commitSha });
  const workflowContents = thinWorkflow({ engineVersion: identity.version, engineCommitSha: identity.commitSha, comment: false });
  if (!workflowContents) throw new GovernanceError("A thin workflow requires an immutable engine commit SHA.", { code: "RG_ENGINE_UNPINNED" });
  const config = {
    schemaVersion: 1,
    engineVersion: identity.version,
    engineCommitSha: identity.commitSha,
    diffFingerprintAlgorithm: DIFF_FINGERPRINT_ALGORITHM,
    defaultBranch: branch,
    ...materialized.config,
    managedFiles: [".repo-governance.json", THIN_WORKFLOW_PATH],
  };
  validateConfig(config, { identity, enforceEngine: false });
  const hookSnapshot = snapshotEffectiveRepositoryHook(root, { env });
  const workflowParentExisted = existsSync(dirname(workflowPath));
  let hookChanged = false;
  let wroteConfig = false;
  let wroteWorkflow = false;
  const rollback = () => {
    if (hookChanged) restoreEffectiveRepositoryHook(hookSnapshot);
    if (wroteWorkflow) rmSync(workflowPath, { force: true });
    if (!workflowParentExisted) removeEmptyParent(workflowPath, root);
    if (wroteConfig) rmSync(configPath, { force: true });
  };
  try {
    writeConfig(root, config);
    wroteConfig = true;
    mkdirSync(dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, workflowContents, { flag: "wx" });
    wroteWorkflow = true;
    hookChanged = true;
    const hook = connectEffectiveRepositoryHook(root, { env, requireDispatcher: verifyInstallation });
    const checkResult = deferCheck ? null : checkAdoption(root, { base: branch });
    const common = {
      schemaVersion: 1,
      command: "bootstrap",
      repoPath: root,
      preset: materialized.identity,
      hookMode: hook.mode,
      hookConnected: true,
      checkResult,
      nextActions: nextActionsFor(materialized, remoteKind(root, env)),
    };
    if (checkResult && !checkResult.ok) {
      rollback();
      return { ...common, ok: false, status: "needs_attention", exitCode: 1, writtenFiles: [], rolledBack: true, message: "Bootstrap found governance issues and rolled back the attempted adoption." };
    }
    return {
      ...common,
      ok: true,
      status: "succeeded",
      exitCode: 0,
      writtenFiles: [".repo-governance.json", THIN_WORKFLOW_PATH],
      rolledBack: false,
      message: `Bootstrapped repository governance with preset ${presetName}.`,
    };
  } catch (error) {
    rollback();
    throw error;
  }
}
