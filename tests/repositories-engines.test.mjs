import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { listEngines, pruneEngines } from "../src/engines.mjs";
import { writeDefaultEngine } from "../src/launcher-install.mjs";
import { PRE_PUSH_PROTOCOL_VERSION, SUPPORTED_EXECUTION_CONTRACT_VERSIONS } from "../src/protocol.mjs";
import {
  listRepositories,
  registerRepository,
  repositoryRegistryPath,
  unregisterRepository,
} from "../src/repositories.mjs";
import { baseConfig, initGitRepo, temporaryDirectory, write, writeConfig } from "./helpers.mjs";

function isolatedEnv() {
  const home = temporaryDirectory("repo-governance-registry-home-");
  return { ...process.env, HOME: home, XDG_DATA_HOME: join(home, "data") };
}

function repository(sha = "a".repeat(40), version = "1.0.0") {
  const repo = initGitRepo();
  writeConfig(repo, baseConfig({ engineCommitSha: sha, engineVersion: version }));
  return repo;
}

function engine(env, sha, version, installedAt, { unknown = false } = {}) {
  const directory = join(env.XDG_DATA_HOME, "repo-governance", "engines", sha);
  const executable = join(directory, process.platform === "win32" ? "repo-governance.exe" : "repo-governance");
  const bytes = Buffer.from(`${sha}:${version}`);
  write(executable, bytes, 0o755);
  write(join(directory, "engine-manifest.json"), `${JSON.stringify({
    engineVersion: version,
    engineCommitSha: sha,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    prePushProtocolVersion: PRE_PUSH_PROTOCOL_VERSION,
    supportedExecutionContractVersions: SUPPORTED_EXECUTION_CONTRACT_VERSIONS,
    ...(!unknown ? { installedAt } : {}),
  }, null, 2)}\n`);
  return directory;
}

test("repository registration normalizes paths, updates duplicates, tracks moves, and unregisters missing paths", () => {
  const env = isolatedEnv();
  const repo = repository();
  registerRepository(repo, { env, now: () => "2026-01-01T00:00:00.000Z" });
  registerRepository(join(repo, "."), { env, now: () => "2026-01-02T00:00:00.000Z" });
  let listed = listRepositories({ env });
  assert.equal(listed.repositories.length, 1);
  assert.equal(listed.repositories[0].registeredAt, "2026-01-02T00:00:00.000Z");
  const original = repo;
  const moved = `${repo}-moved`;
  renameSync(repo, moved);
  registerRepository(moved, { env });
  listed = listRepositories({ env });
  assert.equal(listed.repositories.length, 2);
  assert.equal(unregisterRepository(original, { env }).unregistered, true);
  assert.equal(listRepositories({ env }).repositories.length, 1);
});

test("failed atomic registry write preserves the previous registry bytes", () => {
  const env = isolatedEnv();
  const first = repository("a".repeat(40));
  const second = repository("b".repeat(40));
  registerRepository(first, { env });
  const path = repositoryRegistryPath(env);
  const before = readFileSync(path);
  assert.throws(() => registerRepository(second, { env, failBeforeRename: true }), /registry write failure/);
  assert.deepEqual(readFileSync(path), before);
});

test("file lock serializes concurrent repository registrations without losing a record", async () => {
  const env = isolatedEnv();
  const first = repository("a".repeat(40));
  const second = repository("b".repeat(40));
  const moduleUrl = new URL("../src/repositories.mjs", import.meta.url).href;
  const launch = (repo) => new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `import { registerRepository } from ${JSON.stringify(moduleUrl)}; registerRepository(${JSON.stringify(repo)}, { env: process.env });`], { env });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(stderr)));
  });
  await Promise.all([launch(first), launch(second)]);
  assert.deepEqual(listRepositories({ env }).repositories.map((record) => record.engineCommitSha).sort(), ["a".repeat(40), "b".repeat(40)]);
});

test("engine prune protects default, registered, unknown, latest, and one historical engine", () => {
  const env = isolatedEnv();
  const shas = Object.fromEntries(["default", "referenced", "unknown", "candidate", "history", "latest"].map((name, index) => [name, String(index + 1).repeat(40)]));
  engine(env, shas.default, "1.0.0", "2026-01-01T00:00:00.000Z");
  engine(env, shas.referenced, "1.1.0", "2026-02-01T00:00:00.000Z");
  engine(env, shas.unknown, "1.2.0", null, { unknown: true });
  const candidate = engine(env, shas.candidate, "1.3.0", "2026-04-01T00:00:00.000Z");
  engine(env, shas.history, "1.4.0", "2026-05-01T00:00:00.000Z");
  engine(env, shas.latest, "1.5.0", "2026-06-01T00:00:00.000Z");
  writeDefaultEngine({ engineVersion: "1.0.0", engineCommitSha: shas.default }, { env });
  const repo = repository(shas.referenced, "1.1.0");
  registerRepository(repo, { env });
  rmSync(repo, { recursive: true, force: true });

  const dryRun = pruneEngines({ env });
  assert.deepEqual(dryRun.willDelete.map((item) => item.engineCommitSha), [shas.candidate]);
  assert.equal(existsSync(candidate), true);
  assert.match(dryRun.boundary, /does not prove.*unregistered repository/i);
  const reasons = Object.fromEntries(dryRun.engines.map((item) => [item.engineCommitSha, item.protectedReasons]));
  assert.ok(reasons[shas.default].includes("default_engine"));
  assert.ok(reasons[shas.referenced].includes("registered_repository_reference"));
  assert.ok(reasons[shas.unknown].includes("unknown_metadata"));
  assert.ok(reasons[shas.latest].includes("latest_installed"));
  assert.ok(reasons[shas.history].includes("historical_retention"));

  const newlyReferenced = repository(shas.candidate, "1.3.0");
  registerRepository(newlyReferenced, { env });
  const refreshed = pruneEngines({ env, confirm: true });
  assert.deepEqual(refreshed.deleted, []);
  assert.equal(existsSync(candidate), true);
  unregisterRepository(newlyReferenced, { env });
  const confirmed = pruneEngines({ env, confirm: true });
  assert.deepEqual(confirmed.deleted, [shas.candidate]);
  assert.equal(existsSync(candidate), false);
});

test("missing installedAt marks a legacy engine unknown and an invalid default pointer blocks every deletion", () => {
  const env = isolatedEnv();
  const legacySha = "a".repeat(40);
  engine(env, legacySha, "1.0.0", null, { unknown: true });
  write(join(env.XDG_DATA_HOME, "repo-governance", "default-engine.json"), "damaged\n");
  const listing = listEngines({ env });
  assert.equal(listing.defaultStatus, "invalid");
  assert.equal(listing.engines[0].status, "unknown");
  const plan = pruneEngines({ env });
  assert.deepEqual(plan.willDelete, []);
  assert.ok(plan.engines[0].protectedReasons.includes("default_pointer_uncertain"));
});
