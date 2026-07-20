import { lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_AGENT_POLICY, resolveAgentPolicy } from "./agent-policy.mjs";
import { CONFIG_FILE, readConfig } from "./config.mjs";
import { asFailure, GovernanceError } from "./errors.mjs";
import { inspectEffectiveRepositoryHook } from "./hooks.mjs";
import { inspectLockedRuntime } from "./locked-engine.mjs";
import { runGit } from "./process.mjs";
import { runtimeIdentity } from "./version.mjs";
import { readUpdateAdvisory } from "./release-catalog.mjs";

function action(id, { command, preset = null, requiresPreset = false, requiresConfirmation = false } = {}) {
  return { id, ...(command ? { command } : {}), preset, requiresPreset, requiresConfirmation };
}

function baseReport(cwd, updateAdvisory, overrides) {
  return {
    schemaVersion: 1,
    command: "preflight",
    cwd,
    policy: { ...DEFAULT_AGENT_POLICY },
    nextActions: [],
    updateAdvisory,
    ...overrides,
  };
}

function inspection(overrides = {}) {
  return {
    gitRepository: false,
    configPresent: false,
    configValid: null,
    engineAligned: null,
    hookConnected: null,
    ...overrides,
  };
}

function normalizeDirectory(cwd) {
  try {
    return realpathSync(resolve(cwd));
  } catch (error) {
    throw new GovernanceError(`Unable to resolve the preflight working directory: ${error.message}`, {
      code: "RG_PREFLIGHT_CWD",
      details: { cwd: resolve(cwd), causeCode: error.code || null },
    });
  }
}

function findRepositoryRoot(cwd, env) {
  const result = runGit(["rev-parse", "--show-toplevel"], { cwd, env, allowFailure: true });
  if (result.status === 0 && result.stdout.trim()) return realpathSync(resolve(result.stdout.trim()));
  const diagnostic = String(result.stderr || "").trim();
  if (/not a git repository|must be run in a work tree/i.test(diagnostic)) return null;
  throw new GovernanceError(`Unable to inspect the Git repository root: ${diagnostic || "git rev-parse failed"}`, {
    code: "RG_GIT",
    details: { cwd, status: result.status },
  });
}

function configExists(repoPath) {
  const path = join(repoPath, CONFIG_FILE);
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw new GovernanceError(`Unable to inspect ${CONFIG_FILE}: ${error.message}`, {
      code: "RG_CONFIG_READ",
      details: { path, causeCode: error.code || null },
    });
  }
}

function misconfigured(cwd, repoPath, facts, policy, error, recommendedAction, updateAdvisory) {
  return baseReport(cwd, updateAdvisory, {
    ok: true,
    status: "needs_attention",
    exitCode: 1,
    repoPath,
    repoState: "misconfigured",
    inspection: facts,
    policy,
    recommendedAction,
    error,
    message: `Repository governance is misconfigured: ${error.code}: ${error.message}`,
  });
}

function blocked(cwd, repoPath, facts, policy, error, updateAdvisory) {
  return baseReport(cwd, updateAdvisory, {
    ok: false,
    status: "blocked",
    exitCode: 2,
    repoPath,
    repoState: "blocked",
    inspection: facts,
    policy,
    recommendedAction: action("manual-diagnosis-required", { requiresConfirmation: true }),
    error,
    message: `Preflight could not inspect the repository safely: ${error.code}: ${error.message}`,
  });
}

export function preflightRepository(invocationCwd = process.cwd(), {
  env = process.env,
  identity = runtimeIdentity(),
  invocationError = null,
  catalogPublicKey,
} = {}) {
  let cwd = resolve(invocationCwd);
  let repoPath = null;
  let facts = inspection();
  let policy = { ...DEFAULT_AGENT_POLICY };
  const updateAdvisory = readUpdateAdvisory(identity.version, { env, ...(catalogPublicKey ? { publicKeyBase64: catalogPublicKey } : {}) });
  try {
    cwd = normalizeDirectory(invocationCwd);
    if (invocationError) return blocked(cwd, null, facts, policy, asFailure(invocationError).error, updateAdvisory);
    repoPath = findRepositoryRoot(cwd, env);
    if (!repoPath) {
      return baseReport(cwd, updateAdvisory, {
        ok: true,
        status: "needs_attention",
        exitCode: 1,
        repoPath: null,
        repoState: "not_git_repo",
        inspection: facts,
        recommendedAction: action("enter-repository-required"),
        message: "The current directory is not a Git repository. Enter a repository or use repo-governance new with an explicit preset.",
      });
    }
    facts = inspection({ gitRepository: true });
    try {
      policy = resolveAgentPolicy(repoPath, { env });
    } catch (error) {
      policy = { ...DEFAULT_AGENT_POLICY, source: "user-policy", autoPreflight: false };
      throw error;
    }
    if (!configExists(repoPath)) {
      const preset = policy.preset;
      return baseReport(cwd, updateAdvisory, {
        ok: true,
        status: "needs_attention",
        exitCode: 1,
        repoPath,
        repoState: "unmanaged",
        inspection: facts,
        policy,
        recommendedAction: action("bootstrap-required", {
          command: `repo-governance bootstrap --preset ${preset || "<preset>"} --json`,
          preset,
          requiresPreset: preset === null,
          requiresConfirmation: preset === null || !policy.autoBootstrap,
        }),
        message: preset
          ? "The Git repository is not governed. The user policy selected an explicit preset; bootstrap must complete before writing repository files."
          : "The Git repository is not governed. Select an explicit preset and confirm bootstrap before writing repository files.",
      });
    }
    facts = inspection({ gitRepository: true, configPresent: true });
    let config;
    try {
      config = readConfig(repoPath, { identity, enforceEngine: false });
      facts.configValid = true;
    } catch (error) {
      const failure = asFailure(error);
      if (failure.error.details?.unreadable) return blocked(cwd, repoPath, facts, policy, failure.error, updateAdvisory);
      facts.configValid = false;
      return misconfigured(cwd, repoPath, facts, policy, failure.error, action("configuration-repair-required", { requiresConfirmation: true }), updateAdvisory);
    }

    const engine = inspectLockedRuntime(
      { engineVersion: config.engineVersion, engineCommitSha: config.engineCommitSha },
      { env, runningIdentity: identity },
    );
    facts.engineAligned = engine.aligned;
    const hook = inspectEffectiveRepositoryHook(repoPath, { env });
    facts.hookConnected = hook.connected;

    if (engine.aligned !== true) {
      return misconfigured(
        cwd,
        repoPath,
        facts,
        policy,
        engine.error,
        action(engine.aligned === null ? "verified-engine-required" : "engine-repair-required", {
          command: "repo-governance update --bundle <verified-directory>",
          requiresConfirmation: true,
        }),
        updateAdvisory,
      );
    }
    if (!hook.connected) {
      const error = {
        code: "RG_HOOKS_DISCONNECTED",
        message: "The current repository's effective pre-push hook does not reach the stable dispatcher.",
        details: { mode: hook.mode, path: hook.path, dispatcher: hook.dispatcher },
      };
      return misconfigured(
        cwd,
        repoPath,
        facts,
        policy,
        error,
        action("hook-reconnect-required", { command: "repo-governance hooks doctor --json", requiresConfirmation: true }),
        updateAdvisory,
      );
    }
    return baseReport(cwd, updateAdvisory, {
      ok: true,
      status: "succeeded",
      exitCode: 0,
      repoPath,
      repoState: "managed",
      inspection: facts,
      policy,
      recommendedAction: action("none"),
      message: "Repository governance preflight succeeded; the repository is managed and ready for work.",
    });
  } catch (error) {
    const failure = asFailure(error);
    return blocked(cwd, repoPath, facts, policy, failure.error, updateAdvisory);
  }
}
