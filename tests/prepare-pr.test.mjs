import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { projectAgentReport } from "../src/agent-report.mjs";
import { preparePullRequest } from "../src/prepare-pr.mjs";
import { baseConfig, commitAll, git, initGitRepo, write, writeConfig } from "./helpers.mjs";

function featureRepository({ includeCompanionTest = false } = {}) {
  const repo = initGitRepo();
  writeConfig(repo, baseConfig({
    testCategories: { contract: ["tests/contract/**"] },
    highImpactMappings: [{ businessPaths: ["src/**"], requirements: [{ anyOf: ["contract"] }] }],
  }));
  write(join(repo, "src", "api.mjs"), "export const value = 1;\n");
  write(join(repo, "tests", "contract", "api.test.mjs"), "// baseline\n");
  commitAll(repo, "initial");
  git(repo, ["checkout", "-b", "feature"]);
  write(join(repo, "src", "api.mjs"), "export const value = 2;\n");
  if (includeCompanionTest) write(join(repo, "tests", "contract", "api.test.mjs"), "// changed assertion fixture\n");
  commitAll(repo, "feature");
  return repo;
}

test("prepare-pr projects missing and satisfied RG001 evidence without claiming semantics", () => {
  const missing = preparePullRequest(featureRepository());
  assert.equal(missing.ok, false);
  assert.equal(missing.status, "needs_attention");
  assert.equal(missing.ruleFindings.RG001.status, "fail");
  assert.equal(missing.ruleFindings.RG005.status, "pass");
  assert.equal(missing.requiredTests[0].status, "missing");
  assert.equal(missing.requiredTests[0].semanticCoverageVerified, false);
  assert.match(missing.suggestedPRBody, /does not prove assertion quality/);

  const satisfied = preparePullRequest(featureRepository({ includeCompanionTest: true }));
  assert.equal(satisfied.ok, true);
  assert.equal(satisfied.requiredTests[0].status, "satisfied");
  assert.equal(satisfied.requiredTests[0].semanticCoverageVerified, false);
});

test("prepare-pr blocks every kind of uncommitted worktree change", () => {
  const repo = featureRepository({ includeCompanionTest: true });
  write(join(repo, "untracked.txt"), "dirty\n");
  assert.throws(() => preparePullRequest(repo), (error) => error.code === "RG_WORKTREE_DIRTY" && /clean worktree/.test(error.message));
});

test("prepare-pr preserves canonical-history errors as RG005 structured evidence", () => {
  const report = preparePullRequest(featureRepository(), { base: "missing-target" });
  assert.equal(report.status, "blocked");
  assert.equal(report.ruleFindings.RG005.status, "error");
  assert.equal(report.sourceCheckResult.error.code, "RG_GIT_HISTORY_INSUFFICIENT");
  assert.equal(report.suggestedPRBody, "");
});

test("agent report groups CLI findings without adding new rule classifications", () => {
  const checkResult = {
    schemaVersion: 1,
    ok: false,
    exitCode: 1,
    endpoints: { canonicalBaseSha: "a", baseTip: "b", headSha: "c" },
    changedPaths: ["src/a.mjs"],
    findings: [
      { rule: "RG002", message: "tier" },
      { rule: "RG003", message: "workflow" },
      { rule: "RG004", message: "command" },
      { rule: "RG005", message: "waiver" },
    ],
    satisfied: [],
    capabilityBoundary: "boundary",
  };
  const report = projectAgentReport(checkResult, { repoPath: "/repo", baseRef: "main" });
  assert.deepEqual(report.workflowFindings, [checkResult.findings[1]]);
  assert.deepEqual(report.commandContractFindings, [checkResult.findings[2]]);
  assert.equal(report.ruleFindings.RG002.findings[0], checkResult.findings[0]);
  assert.equal(report.ruleFindings.RG005.findings[0], checkResult.findings[3]);
});
