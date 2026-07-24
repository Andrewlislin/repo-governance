import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { bootstrapRepository } from "../src/bootstrap.mjs";
import { governanceDataRoot } from "../src/paths.mjs";
import { preflightRepository } from "../src/preflight.mjs";
import { PRE_PUSH_PROTOCOL_VERSION, SUPPORTED_EXECUTION_CONTRACT_VERSIONS } from "../src/protocol.mjs";
import { commitAll, initGitRepo, temporaryDirectory, write } from "./helpers.mjs";

const identity = { version: "1.1.1", commitSha: "a".repeat(40) };

function isolatedEnv() {
  const home = temporaryDirectory("repo-governance-preflight-home-");
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

function installRuntime(env, selectedIdentity = identity) {
  const dataRoot = governanceDataRoot(env);
  const engine = join(dataRoot, "engines", selectedIdentity.commitSha);
  const bytes = Buffer.from("engine\n");
  write(join(dataRoot, process.platform === "win32" ? "dispatcher.exe" : "dispatcher"), "dispatcher\n", 0o755);
  write(join(engine, process.platform === "win32" ? "repo-governance.exe" : "repo-governance"), bytes, 0o755);
  write(join(engine, "engine-manifest.json"), `${JSON.stringify({
    engineVersion: selectedIdentity.version,
    engineCommitSha: selectedIdentity.commitSha,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    prePushProtocolVersion: PRE_PUSH_PROTOCOL_VERSION,
    supportedExecutionContractVersions: SUPPORTED_EXECUTION_CONTRACT_VERSIONS,
  })}\n`);
}

function committedRepository() {
  const repo = initGitRepo();
  write(join(repo, "README.md"), "# Fixture\n");
  commitAll(repo, "initial");
  return repo;
}

function managedRepository() {
  const repo = committedRepository();
  const env = isolatedEnv();
  installRuntime(env);
  const bootstrap = bootstrapRepository(repo, { presetName: "node-library", env, identity });
  assert.equal(bootstrap.ok, true);
  return { repo, env };
}

function directorySnapshot(root) {
  if (!existsSync(root)) return [];
  const snapshot = [];
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = join(path, entry.name);
      const stat = lstatSync(entryPath);
      const item = { path: relative(root, entryPath), mode: stat.mode, type: entry.isDirectory() ? "directory" : "file" };
      if (entry.isDirectory()) visit(entryPath);
      else item.sha256 = createHash("sha256").update(readFileSync(entryPath)).digest("hex");
      snapshot.push(item);
    }
  }
  visit(root);
  return snapshot.sort((left, right) => left.path.localeCompare(right.path));
}

test("non-Git and unmanaged repositories are successful classifications that require attention", () => {
  const nonGit = temporaryDirectory("repo-governance-not-git-");
  const nonGitReport = preflightRepository(nonGit, { env: isolatedEnv(), identity });
  assert.equal(nonGitReport.ok, true);
  assert.equal(nonGitReport.status, "needs_attention");
  assert.equal(nonGitReport.exitCode, 1);
  assert.equal(nonGitReport.repoState, "not_git_repo");
  assert.equal(nonGitReport.cwd, realpathSync(nonGit));
  assert.equal(nonGitReport.repoPath, null);
  assert.deepEqual(nonGitReport.inspection, {
    gitRepository: false,
    configPresent: false,
    configValid: null,
    engineAligned: null,
    hookConnected: null,
  });

  const repo = committedRepository();
  const unmanaged = preflightRepository(join(repo, ".git", ".."), { env: isolatedEnv(), identity });
  assert.equal(unmanaged.ok, true);
  assert.equal(unmanaged.status, "needs_attention");
  assert.equal(unmanaged.exitCode, 1);
  assert.equal(unmanaged.repoState, "unmanaged");
  assert.equal(unmanaged.repoPath, realpathSync(repo));
  assert.equal(unmanaged.inspection.gitRepository, true);
  assert.equal(unmanaged.inspection.configPresent, false);
  assert.deepEqual(unmanaged.recommendedAction, {
    id: "bootstrap-required",
    command: "repo-governance bootstrap --preset <preset> --json",
    preset: null,
    requiresPreset: true,
    requiresConfirmation: true,
  });
});

test("a managed repository requires valid config, aligned engine, and the effective current hook", () => {
  const { repo, env } = managedRepository();
  const beforeRepo = directorySnapshot(repo);
  const beforeHome = directorySnapshot(env.HOME);
  const report = preflightRepository(repo, { env, identity });
  assert.equal(report.ok, true);
  assert.equal(report.status, "succeeded");
  assert.equal(report.exitCode, 0);
  assert.equal(report.repoState, "managed");
  assert.deepEqual(report.inspection, {
    gitRepository: true,
    configPresent: true,
    configValid: true,
    engineAligned: true,
    hookConnected: true,
  });
  assert.deepEqual(report.policy, {
    source: "built-in-defaults",
    autoPreflight: true,
    autoBootstrap: false,
    matchedPathPrefix: null,
    preset: null,
  });
  assert.deepEqual(directorySnapshot(repo), beforeRepo);
  assert.deepEqual(directorySnapshot(env.HOME), beforeHome);
});

test("invalid configuration preserves its stable error while unreadable input blocks", () => {
  const invalidRepo = committedRepository();
  write(join(invalidRepo, ".repo-governance.json"), "{invalid json\n");
  const invalid = preflightRepository(invalidRepo, { env: isolatedEnv(), identity });
  assert.equal(invalid.repoState, "misconfigured");
  assert.equal(invalid.ok, true);
  assert.equal(invalid.exitCode, 1);
  assert.equal(invalid.inspection.configPresent, true);
  assert.equal(invalid.inspection.configValid, false);
  assert.equal(invalid.error.code, "RG_CONFIG");
  assert.equal(invalid.recommendedAction.id, "configuration-repair-required");

  const unreadableRepo = committedRepository();
  mkdirSync(join(unreadableRepo, ".repo-governance.json"));
  const unreadable = preflightRepository(unreadableRepo, { env: isolatedEnv(), identity });
  assert.equal(unreadable.repoState, "blocked");
  assert.equal(unreadable.ok, false);
  assert.equal(unreadable.status, "blocked");
  assert.equal(unreadable.exitCode, 2);
  assert.equal(unreadable.inspection.configPresent, true);
  assert.equal(unreadable.inspection.configValid, null);
  assert.equal(unreadable.error.code, "RG_CONFIG");
});

test("engine mismatch, missing installation, and development identity remain distinct facts", () => {
  const mismatchFixture = managedRepository();
  const otherIdentity = { version: identity.version, commitSha: "b".repeat(40) };
  const mismatch = preflightRepository(mismatchFixture.repo, { env: mismatchFixture.env, identity: otherIdentity });
  assert.equal(mismatch.repoState, "misconfigured");
  assert.equal(mismatch.inspection.configValid, true);
  assert.equal(mismatch.inspection.engineAligned, false);
  assert.equal(mismatch.inspection.hookConnected, true);
  assert.equal(mismatch.error.code, "RG_ENGINE_MISMATCH");

  const missingFixture = managedRepository();
  const enginePath = join(governanceDataRoot(missingFixture.env), "engines", identity.commitSha, process.platform === "win32" ? "repo-governance.exe" : "repo-governance");
  rmSync(enginePath);
  const missing = preflightRepository(missingFixture.repo, { env: missingFixture.env, identity });
  assert.equal(missing.inspection.engineAligned, false);
  assert.equal(missing.inspection.hookConnected, true);
  assert.equal(missing.error.code, "RG_ENGINE_NOT_INSTALLED");

  const developmentFixture = managedRepository();
  const development = preflightRepository(developmentFixture.repo, {
    env: developmentFixture.env,
    identity: { version: identity.version, commitSha: "development" },
  });
  assert.equal(development.inspection.engineAligned, null);
  assert.equal(development.inspection.hookConnected, true);
  assert.equal(development.error.code, "RG_ENGINE_UNVERIFIED");
  assert.equal(development.recommendedAction.id, "verified-engine-required");
});

test("a disconnected current hook retains valid config and aligned-engine facts", () => {
  const { repo, env } = managedRepository();
  write(join(repo, ".git", "hooks", "pre-push"), "#!/bin/sh\nexit 0\n", 0o755);
  const report = preflightRepository(repo, { env, identity });
  assert.equal(report.ok, true);
  assert.equal(report.status, "needs_attention");
  assert.equal(report.exitCode, 1);
  assert.equal(report.repoState, "misconfigured");
  assert.deepEqual(report.inspection, {
    gitRepository: true,
    configPresent: true,
    configValid: true,
    engineAligned: true,
    hookConnected: false,
  });
  assert.equal(report.error.code, "RG_HOOKS_DISCONNECTED");
  assert.equal(report.recommendedAction.id, "hook-reconnect-required");
  assert.equal(report.recommendedAction.requiresConfirmation, true);
});

test("automation schema fixes every public preflight state combination", () => {
  const schema = JSON.parse(readFileSync(new URL("../schemas/automation-report.schema.json", import.meta.url), "utf8"));
  assert.ok(schema.properties.command.enum.includes("preflight"));
  const preflight = schema.allOf.find((condition) => condition.if?.properties?.command?.const === "preflight");
  assert.deepEqual(preflight.then.required, ["exitCode", "cwd", "repoState", "inspection", "policy", "recommendedAction", "updateAdvisory"]);
  const conditions = new Map(preflight.then.allOf.map((condition) => [condition.if.properties.repoState.const, condition.then.properties]));
  assert.deepEqual([...conditions.keys()], ["managed", "not_git_repo", "unmanaged", "misconfigured", "blocked"]);
  assert.deepEqual(
    [conditions.get("managed").ok.const, conditions.get("managed").status.const, conditions.get("managed").exitCode.const],
    [true, "succeeded", 0],
  );
  assert.deepEqual(
    [conditions.get("unmanaged").ok.const, conditions.get("unmanaged").status.const, conditions.get("unmanaged").exitCode.const],
    [true, "needs_attention", 1],
  );
  assert.equal(conditions.get("not_git_repo").repoPath.type, "null");
  assert.deepEqual(
    [conditions.get("blocked").ok.const, conditions.get("blocked").status.const, conditions.get("blocked").exitCode.const],
    [false, "blocked", 2],
  );
});

test("preflight remains a read-only classifier and does not invoke RG001-RG005", () => {
  const source = readFileSync(new URL("../src/preflight.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /checkRepository|checkAdoption|evaluateRg00[1-5]/);
  assert.doesNotMatch(source, /writeFileSync|appendFileSync|mkdirSync|rmSync|renameSync|chmodSync/);
});
