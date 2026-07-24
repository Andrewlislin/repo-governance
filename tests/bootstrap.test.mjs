import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { bootstrapRepository } from "../src/bootstrap.mjs";
import { governanceDataRoot } from "../src/paths.mjs";
import { PRE_PUSH_PROTOCOL_VERSION, SUPPORTED_EXECUTION_CONTRACT_VERSIONS } from "../src/protocol.mjs";
import { commitAll, git, initGitRepo, temporaryDirectory, write } from "./helpers.mjs";

const identity = { version: "1.1.1", commitSha: "a".repeat(40) };

function isolatedEnv() {
  const home = temporaryDirectory("repo-governance-bootstrap-home-");
  return {
    ...process.env,
    HOME: home,
    XDG_DATA_HOME: join(home, ".local", "share"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

function installRuntime(env) {
  const dataRoot = governanceDataRoot(env);
  const engine = join(dataRoot, "engines", identity.commitSha);
  const bytes = Buffer.from("#!/bin/sh\nexit 0\n");
  write(join(dataRoot, "dispatcher"), "#!/bin/sh\nexit 0\n", 0o755);
  write(join(engine, "repo-governance"), bytes, 0o755);
  write(join(engine, "engine-manifest.json"), `${JSON.stringify({
    engineVersion: identity.version,
    engineCommitSha: identity.commitSha,
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

test("bootstrap atomically initializes an existing repository and connects its native hook", () => {
  const repo = committedRepository();
  const env = isolatedEnv();
  installRuntime(env);
  const result = bootstrapRepository(repo, { presetName: "node-library", env, identity });
  assert.equal(result.ok, true);
  assert.equal(result.hookMode, "native");
  assert.equal(result.checkResult.mode, "adoption");
  assert.deepEqual(result.writtenFiles, [".repo-governance.json", ".github/workflows/repo-governance.yml"]);
  assert.match(readFileSync(join(repo, ".git", "hooks", "pre-push"), "utf8"), /stable-dispatcher/);
  const config = JSON.parse(readFileSync(join(repo, ".repo-governance.json"), "utf8"));
  assert.equal(config.preset.name, "node-library");
  assert.equal(config.engineCommitSha, identity.commitSha);
});

test("bootstrap refuses existing configuration without changing it", () => {
  const repo = committedRepository();
  const env = isolatedEnv();
  installRuntime(env);
  write(join(repo, ".repo-governance.json"), "existing\n");
  assert.throws(() => bootstrapRepository(repo, { presetName: "node-library", env, identity }), /never overwrites/);
  assert.equal(readFileSync(join(repo, ".repo-governance.json"), "utf8"), "existing\n");
});

test("bootstrap composes Husky without removing its existing pre-push command", () => {
  const repo = committedRepository();
  const env = isolatedEnv();
  installRuntime(env);
  git(repo, ["config", "core.hooksPath", ".husky"]);
  write(join(repo, ".husky", "pre-push"), "#!/bin/sh\nnpm test\n", 0o755);
  const result = bootstrapRepository(repo, { presetName: "node-library", env, identity });
  assert.equal(result.hookMode, "husky");
  const hook = readFileSync(join(repo, ".husky", "pre-push"), "utf8");
  assert.match(hook, /npm test/);
  assert.match(hook, /stable-dispatcher/);
});

test("adoption findings roll back files and exact hook contents", () => {
  const repo = initGitRepo();
  write(join(repo, "README.md"), "# Fixture\n");
  write(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  commitAll(repo, "initial");
  const env = isolatedEnv();
  installRuntime(env);
  const hookPath = join(repo, ".git", "hooks", "pre-push");
  write(hookPath, "#!/bin/sh\necho original\n", 0o755);
  const result = bootstrapRepository(repo, { presetName: "node-library", env, identity });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.equal(existsSync(join(repo, ".repo-governance.json")), false);
  assert.equal(existsSync(join(repo, ".github", "workflows", "repo-governance.yml")), false);
  assert.equal(readFileSync(hookPath, "utf8"), "#!/bin/sh\necho original\n");
});

test("bootstrap blocks an unborn repository with a concrete next entry point", () => {
  const repo = initGitRepo();
  const env = isolatedEnv();
  installRuntime(env);
  assert.throws(() => bootstrapRepository(repo, { presetName: "node-library", env, identity }), /repo-governance new/);
});
