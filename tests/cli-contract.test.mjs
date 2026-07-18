import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { main } from "../src/cli.mjs";
import { baseConfig, commitAll, git, initGitRepo, temporaryDirectory, write, writeConfig } from "./helpers.mjs";

const identity = { version: "1.1.0", commitSha: "a".repeat(40) };

function sink() {
  let value = "";
  return { stream: { write(chunk) { value += String(chunk); } }, value: () => value };
}

function repository() {
  const repo = initGitRepo();
  write(join(repo, "README.md"), "# Fixture\n");
  commitAll(repo, "initial");
  return repo;
}

test("bootstrap CLI emits its stable JSON contract", async () => {
  const stdout = sink();
  const stderr = sink();
  const code = await main(["bootstrap", "--preset", "node-library", "--json"], {
    cwd: repository(), stdout: stdout.stream, stderr: stderr.stream, identity, verifyInstallation: false,
  });
  assert.equal(code, 0);
  assert.equal(stderr.value(), "");
  const report = JSON.parse(stdout.value());
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.command, "bootstrap");
  assert.equal(report.status, "succeeded");
  assert.equal(report.preset.name, "node-library");
  assert.equal(report.checkResult.mode, "adoption");
});

test("automation invocation errors retain the stable blocked envelope", async () => {
  const stdout = sink();
  const stderr = sink();
  const repo = repository();
  const code = await main(["bootstrap", "--json"], {
    cwd: repo, stdout: stdout.stream, stderr: stderr.stream, identity, verifyInstallation: false,
  });
  assert.equal(code, 2);
  assert.equal(stdout.value(), "");
  const report = JSON.parse(stderr.value());
  assert.equal(report.command, "bootstrap");
  assert.equal(report.status, "blocked");
  assert.equal(report.error.code, "RG_INVOCATION");
});

test("new CLI parses its public arguments and emits the shared automation envelope", async () => {
  const stdout = sink();
  const stderr = sink();
  const parent = temporaryDirectory("repo-governance-cli-new-");
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Test User",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test User",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  const code = await main(["new", "service", "--preset", "node-service", "--json"], {
    cwd: parent, env, stdout: stdout.stream, stderr: stderr.stream, identity, verifyInstallation: false,
  });
  assert.equal(code, 0);
  assert.equal(stderr.value(), "");
  const report = JSON.parse(stdout.value());
  assert.equal(report.command, "new");
  assert.equal(report.initialized, true);
  assert.match(report.initialCommit, /^[0-9a-f]{40}$/);
});

test("prepare-pr CLI emits the projected check result without remote writes", async () => {
  const repo = initGitRepo();
  writeConfig(repo, baseConfig());
  write(join(repo, "README.md"), "# Baseline\n");
  commitAll(repo, "initial");
  git(repo, ["checkout", "-b", "feature"]);
  write(join(repo, "README.md"), "# Feature\n");
  commitAll(repo, "feature");
  const stdout = sink();
  const stderr = sink();
  const code = await main(["prepare-pr", "--json"], { cwd: repo, stdout: stdout.stream, stderr: stderr.stream });
  assert.equal(code, 0);
  assert.equal(stderr.value(), "");
  const report = JSON.parse(stdout.value());
  assert.equal(report.command, "prepare-pr");
  assert.equal(report.summary.status, "ready");
  assert.equal(report.sourceCheckResult.mode, "standard");
});
