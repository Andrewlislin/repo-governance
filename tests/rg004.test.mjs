import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { changedPaths } from "../src/git.mjs";
import { commandDefinitionHash, evaluateRg004 } from "../src/rg004.mjs";
import { baseConfig, commitAll, git, initGitRepo, write, writeConfig } from "./helpers.mjs";

function contract(definition) {
  return {
    id: "pnpm-test",
    manifest: "package.json",
    command: "test",
    definitionHash: commandDefinitionHash(definition),
    semantics: "Run deterministic PR-blocking tests",
    tier: "pr-blocking",
    consumers: {
      contractTests: ["tests/commands/**"],
      docs: ["docs/commands.md"],
      workflows: [".github/workflows/**"],
    },
  };
}

function fixture() {
  const repo = initGitRepo();
  const config = baseConfig({ publicCommands: [contract("node --test")] });
  writeConfig(repo, config);
  write(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  write(join(repo, "tests/commands/test.test.js"), "// base contract\n");
  write(join(repo, "docs/commands.md"), "old semantics\n");
  write(join(repo, ".github/workflows/ci.yml"), "name: CI\n");
  const base = commitAll(repo, "base");
  git(repo, ["switch", "-c", "feature"]);
  return { repo, base, config };
}

test("public command text change without contract update fails", () => {
  const { repo, base, config } = fixture();
  write(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node --test --test-reporter=spec" } }));
  const head = commitAll(repo, "change command only");
  const result = evaluateRg004(repo, config, changedPaths(repo, base, head), base);
  assert.match(result.findings[0].message, /without accepting a new command contract/);
});

test("accepted command contract still fails until tests, docs, and workflow synchronize", () => {
  const { repo, base, config } = fixture();
  const definition = "node --test --test-reporter=spec";
  const next = { ...config, publicCommands: [contract(definition)] };
  write(join(repo, "package.json"), JSON.stringify({ scripts: { test: definition } }));
  writeConfig(repo, next);
  const head = commitAll(repo, "command and config only");
  const result = evaluateRg004(repo, next, changedPaths(repo, base, head), base);
  assert.deepEqual(result.findings[0].missingConsumers.sort(), ["contractTests", "docs", "workflows"]);
});

test("command, contract test, documentation, and workflow update together pass", () => {
  const { repo, base, config } = fixture();
  const definition = "node --test --test-reporter=spec";
  const next = { ...config, publicCommands: [contract(definition)] };
  write(join(repo, "package.json"), JSON.stringify({ scripts: { test: definition } }));
  writeConfig(repo, next);
  write(join(repo, "tests/commands/test.test.js"), "// new contract\n");
  write(join(repo, "docs/commands.md"), "new semantics\n");
  write(join(repo, ".github/workflows/ci.yml"), "name: Updated CI\n");
  const head = commitAll(repo, "synchronized contract");
  assert.deepEqual(evaluateRg004(repo, next, changedPaths(repo, base, head), base).findings, []);
});
