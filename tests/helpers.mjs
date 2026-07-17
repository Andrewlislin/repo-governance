import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { DIFF_FINGERPRINT_ALGORITHM } from "../src/fingerprint.mjs";

export function temporaryDirectory(prefix = "repo-governance-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function write(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, mode ? { mode } : undefined);
}

export function git(repo, args, options = {}) {
  return execFileSync("git", args, { cwd: repo, encoding: options.binary ? null : "utf8", env: options.env || process.env });
}

export function initGitRepo() {
  const repo = temporaryDirectory();
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "Test User"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  return repo;
}

export function commitAll(repo, message) {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]).trim();
}

export function baseConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    engineVersion: "0.1.0",
    engineCommitSha: "development",
    diffFingerprintAlgorithm: DIFF_FINGERPRINT_ALGORITHM,
    defaultBranch: "main",
    testCategories: {
      unit: ["tests/unit/**"],
      contract: ["tests/contract/**"],
      integration: ["tests/integration/**"],
      frontend: ["tests/frontend/**"],
      "command-contract": ["tests/commands/**"],
      "build-verification": ["tests/build/**"],
    },
    highImpactMappings: [],
    managedFiles: [".repo-governance.json"],
    testEntries: [],
    testSupport: [],
    testTiers: { "pr-blocking": [], nightly: [], "manual-smoke": [] },
    commandAliases: {},
    prBlockingCommands: [],
    guards: [],
    policyChecks: [],
    workflowAllowedEntries: [],
    ...overrides,
  };
}

export function writeConfig(repo, config) {
  write(join(repo, ".repo-governance.json"), `${JSON.stringify(config, null, 2)}\n`);
}
