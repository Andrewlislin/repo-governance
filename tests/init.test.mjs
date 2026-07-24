import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { detectCandidates, initializeRepository } from "../src/init.mjs";
import { initGitRepo, write } from "./helpers.mjs";

test("initializer detects Node, pnpm, Bun, and Python candidates without guessing strict policy", () => {
  const repo = initGitRepo();
  write(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node --test", "check:static": "eslint ." } }));
  write(join(repo, "bun.lock"), "");
  write(join(repo, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  write(join(repo, "pyproject.toml"), "[tool.pytest.ini_options]\n");
  const candidates = detectCandidates(repo);
  assert.deepEqual(candidates.ecosystems.sort(), ["bun", "pnpm-workspace", "python"]);
  assert.deepEqual(candidates.commands.map((entry) => entry.command), ["test", "check:static"]);
  const preview = initializeRepository(repo);
  assert.equal(preview.written, false);
  assert.equal(existsSync(join(repo, ".repo-governance.json")), false);
});

test("strict configuration is written only after explicit acceptance", () => {
  const repo = initGitRepo();
  const result = initializeRepository(repo, { accept: true, defaultBranch: "trunk" });
  assert.equal(result.written, true);
  assert.equal(result.config.defaultBranch, "trunk");
  assert.equal(result.config.executionContractVersion, 1);
  assert.equal(result.config.executionProfiles[0].id, "pr-validation");
  assert.deepEqual(result.config.highImpactMappings, []);
});
