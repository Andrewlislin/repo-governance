import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { controlledUpdate } from "../src/update.mjs";
import { PRE_PUSH_PROTOCOL_VERSION, SUPPORTED_EXECUTION_CONTRACT_VERSIONS } from "../src/protocol.mjs";
import { baseConfig, commitAll, initGitRepo, temporaryDirectory, write, writeConfig } from "./helpers.mjs";

function envForTest() {
  const home = temporaryDirectory("repo-governance-update-home-");
  return { ...process.env, HOME: home, XDG_DATA_HOME: join(home, ".local", "share") };
}

function createBundle(config, { badChecksum = false } = {}) {
  const bundle = temporaryDirectory("repo-governance-bundle-");
  const engine = Buffer.from("verified engine");
  const launcher = Buffer.from("verified launcher");
  write(join(bundle, "repo-governance"), engine, 0o755);
  write(join(bundle, "dispatcher"), launcher, 0o755);
  const next = { ...config, engineVersion: "0.2.0", engineCommitSha: "b".repeat(40) };
  write(join(bundle, "managed", ".repo-governance.json"), `${JSON.stringify(next, null, 2)}\n`);
  write(join(bundle, "update-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    engineVersion: next.engineVersion,
    engineCommitSha: next.engineCommitSha,
    diffFingerprintAlgorithm: next.diffFingerprintAlgorithm,
    prePushProtocolVersion: PRE_PUSH_PROTOCOL_VERSION,
    supportedExecutionContractVersions: SUPPORTED_EXECUTION_CONTRACT_VERSIONS,
    managedFiles: [".repo-governance.json"],
    engine: {
      file: "repo-governance",
      sha256: badChecksum ? "0".repeat(64) : createHash("sha256").update(engine).digest("hex"),
    },
    launcher: {
      file: "dispatcher",
      sha256: createHash("sha256").update(launcher).digest("hex"),
    },
  }, null, 2)}\n`);
  return { bundle, next };
}

function configuredRepo() {
  const repo = initGitRepo();
  const config = baseConfig();
  writeConfig(repo, config);
  commitAll(repo, "base config");
  return { repo, config };
}

test("dirty managed files block update before engine installation", () => {
  const { repo, config } = configuredRepo();
  writeConfig(repo, { ...config, defaultBranch: "develop" });
  const { bundle } = createBundle(config);
  assert.throws(() => controlledUpdate(repo, bundle, { env: envForTest() }), /uncommitted changes/);
});

test("engine verification failure leaves managed files unchanged", () => {
  const { repo, config } = configuredRepo();
  const before = readFileSync(join(repo, ".repo-governance.json"), "utf8");
  const { bundle } = createBundle(config, { badChecksum: true });
  assert.throws(() => controlledUpdate(repo, bundle, { env: envForTest() }), /checksum/);
  assert.equal(readFileSync(join(repo, ".repo-governance.json"), "utf8"), before);
});

test("replacement failure restores backups and removes the inactive engine", () => {
  const env = envForTest();
  const { repo, config } = configuredRepo();
  const before = readFileSync(join(repo, ".repo-governance.json"), "utf8");
  const { bundle, next } = createBundle(config);
  assert.throws(() => controlledUpdate(repo, bundle, { env, failAfterReplace: true }), /replacement failure/);
  assert.equal(readFileSync(join(repo, ".repo-governance.json"), "utf8"), before);
  assert.equal(existsSync(join(env.XDG_DATA_HOME, "repo-governance", "engines", next.engineCommitSha)), false);
});

test("successful update rereads consistent version fields", () => {
  const env = envForTest();
  const { repo, config } = configuredRepo();
  const { bundle, next } = createBundle(config);
  const result = controlledUpdate(repo, bundle, { env });
  assert.equal(result.updated, true);
  const saved = JSON.parse(readFileSync(join(repo, ".repo-governance.json"), "utf8"));
  assert.equal(saved.engineVersion, next.engineVersion);
  assert.equal(saved.engineCommitSha, next.engineCommitSha);
  assert.equal(saved.diffFingerprintAlgorithm, next.diffFingerprintAlgorithm);
  const pointer = JSON.parse(readFileSync(join(env.XDG_DATA_HOME, "repo-governance", "default-engine.json"), "utf8"));
  assert.equal(pointer.engineCommitSha, next.engineCommitSha);
  assert.equal(result.defaultEngineCommitSha, next.engineCommitSha);
  assert.ok(existsSync(result.launcherPath));
  assert.ok(existsSync(result.commandPath));
  const engineManifest = JSON.parse(readFileSync(join(env.XDG_DATA_HOME, "repo-governance", "engines", next.engineCommitSha, "engine-manifest.json"), "utf8"));
  assert.ok(Number.isFinite(Date.parse(engineManifest.installedAt)));
  assert.equal(engineManifest.prePushProtocolVersion, PRE_PUSH_PROTOCOL_VERSION);
  assert.deepEqual(engineManifest.supportedExecutionContractVersions, SUPPORTED_EXECUTION_CONTRACT_VERSIONS);
});

test("launcher replacement failure restores repository, engine, command entry, and default pointer", () => {
  const env = envForTest();
  const { repo, config } = configuredRepo();
  const before = readFileSync(join(repo, ".repo-governance.json"), "utf8");
  const { bundle, next } = createBundle(config);
  assert.throws(() => controlledUpdate(repo, bundle, { env, failAfterLauncher: true }), /launcher installation failure/);
  assert.equal(readFileSync(join(repo, ".repo-governance.json"), "utf8"), before);
  const dataRoot = join(env.XDG_DATA_HOME, "repo-governance");
  assert.equal(existsSync(join(dataRoot, "engines", next.engineCommitSha)), false);
  assert.equal(existsSync(join(dataRoot, "default-engine.json")), false);
  assert.equal(existsSync(join(env.HOME, ".local", "bin", "repo-governance")), false);
});
