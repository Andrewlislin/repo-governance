import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { main } from "../src/cli.mjs";
import { commitAll, initGitRepo, write } from "./helpers.mjs";

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
