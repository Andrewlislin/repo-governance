import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { cloneRepository } from "../src/clone.mjs";
import { newRepository } from "../src/new.mjs";
import { commitAll, git, initGitRepo, temporaryDirectory, write } from "./helpers.mjs";

const identity = { version: "1.1.0", commitSha: "a".repeat(40) };

function isolatedEnv({ identityConfigured = true } = {}) {
  const home = temporaryDirectory("repo-governance-command-home-");
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
  for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) delete env[key];
  if (identityConfigured) {
    env.GIT_AUTHOR_NAME = "Test User";
    env.GIT_AUTHOR_EMAIL = "test@example.com";
    env.GIT_COMMITTER_NAME = "Test User";
    env.GIT_COMMITTER_EMAIL = "test@example.com";
  }
  return env;
}

test("new creates a governance-only repository and commits only generated files", () => {
  const parent = temporaryDirectory("repo-governance-new-parent-");
  const result = newRepository("service", {
    cwd: parent,
    presetName: "node-service",
    env: isolatedEnv(),
    identity,
    verifyInstallation: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.initialized, true);
  assert.match(result.initialCommit, /^[0-9a-f]{40}$/);
  assert.equal(result.checkResult.mode, "standard");
  assert.equal(git(result.repoPath, ["status", "--porcelain"]), "");
  assert.deepEqual(git(result.repoPath, ["ls-tree", "-r", "--name-only", "HEAD"]).trim().split("\n"), [
    ".github/workflows/repo-governance.yml",
    ".repo-governance.json",
  ]);
});

test("new rejects existing targets and removes a target when Git identity is missing", () => {
  const parent = temporaryDirectory("repo-governance-new-parent-");
  const existing = join(parent, "existing");
  write(join(existing, "keep.txt"), "keep\n");
  assert.throws(() => newRepository("existing", { cwd: parent, presetName: "node-library", identity, verifyInstallation: false }), /already exists/);
  assert.equal(existsSync(join(existing, "keep.txt")), true);
  const missing = join(parent, "missing-identity");
  assert.throws(() => newRepository("missing-identity", {
    cwd: parent,
    presetName: "node-library",
    env: isolatedEnv({ identityConfigured: false }),
    identity,
    verifyInstallation: false,
  }), /author identity/);
  assert.equal(existsSync(missing), false);
});

test("clone bootstraps a local non-GitHub remote without rewriting source history", () => {
  const source = initGitRepo();
  write(join(source, "README.md"), "# Source\n");
  const sourceHead = commitAll(source, "initial");
  const parent = temporaryDirectory("repo-governance-clone-parent-");
  const result = cloneRepository(source, "copy", {
    cwd: parent,
    presetName: "node-library",
    env: isolatedEnv(),
    identity,
    verifyInstallation: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.initialCommit, null);
  assert.equal(git(result.repoPath, ["rev-parse", "HEAD"]).trim(), sourceHead);
  assert.match(git(result.repoPath, ["status", "--porcelain"]), /\.repo-governance\.json/);
  assert.ok(result.nextActions.some((action) => action.id === "ci-provider-unconfirmed"));
});

test("clone failure and failed adoption leave no partial destination", () => {
  const parent = temporaryDirectory("repo-governance-clone-parent-");
  assert.throws(() => cloneRepository(join(parent, "missing-source"), "failed", {
    cwd: parent,
    presetName: "node-library",
    identity,
    verifyInstallation: false,
  }), /git failed/);
  assert.equal(existsSync(join(parent, "failed")), false);

  const source = initGitRepo();
  write(join(source, "README.md"), "# Source\n");
  write(join(source, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  commitAll(source, "initial");
  const result = cloneRepository(source, "policy-failed", {
    cwd: parent,
    presetName: "node-library",
    env: isolatedEnv(),
    identity,
    verifyInstallation: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "needs_attention");
  assert.equal(existsSync(join(parent, "policy-failed")), false);
});
