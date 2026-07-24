import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { checkRepository } from "../src/check.mjs";
import {
  canonicalJson,
  dependencyPreparationDefinitionHash,
  governanceOnlyExecutionContract,
} from "../src/execution-contract.mjs";
import { evaluateRg006 } from "../src/rg006.mjs";
import { baseConfig, commitAll, git, initGitRepo, temporaryDirectory, write, writeConfig } from "./helpers.mjs";

test("dependency preparation hash uses recursively UTF-8-sorted canonical JSON and preserves array order", () => {
  assert.equal(canonicalJson({ z: [2, 1], a: { y: true, x: null } }), '{"a":{"x":null,"y":true},"z":[2,1]}');
  const { runtimes, executionProfiles } = governanceOnlyExecutionContract();
  assert.equal(
    dependencyPreparationDefinitionHash(runtimes[0], executionProfiles[0].dependencyPreparation),
    "2ae76f3afd45d6c22c0a140466c51e13716ba1d840562e8b16c72b58294cb90f",
  );
});

test("RG006 accepts a complete contract and rejects a changed dependency definition hash", () => {
  const repo = temporaryDirectory();
  const config = baseConfig();
  assert.deepEqual(evaluateRg006(repo, config).findings, []);
  config.executionProfiles[0].dependencyPreparation.hookArgv = ["unexpected"];
  assert.match(evaluateRg006(repo, config).findings[0].message, /definitionHash/);
});

test("ordered stage graph preserves duplicates and rejects reordered stages", () => {
  const repo = temporaryDirectory();
  const config = baseConfig();
  config.executionProfiles[0].requiredStages[1].commands = ["system:git-status", "system:git-status"];
  let result = evaluateRg006(repo, config);
  assert.deepEqual(result.commandGraphs["pr-validation"][1].commands, ["system:git-status", "system:git-status"]);
  config.executionProfiles[0].requiredStages.reverse();
  result = evaluateRg006(repo, config);
  assert.ok(result.findings.some((finding) => /ordered/.test(finding.message)));
});

for (const definition of ["npm run b || npm run c", "npm run b; npm run c", "echo $(date)", "echo `date`"]) {
  test(`RG006 rejects shell composition in protected command: ${definition}`, () => {
    const repo = temporaryDirectory();
    write(join(repo, "package.json"), JSON.stringify({ scripts: { a: definition, b: "node --test", c: "node --test" } }));
    const config = baseConfig();
    config.executionProfiles[0].requiredStages[1].commands = ["package.json#a"];
    const result = evaluateRg006(repo, config);
    assert.ok(result.findings.some((finding) => /forbidden shell composition/.test(finding.message)));
  });
}

test("RG006 rejects command graph cycles", () => {
  const repo = temporaryDirectory();
  write(join(repo, "package.json"), JSON.stringify({ scripts: { a: "npm run b", b: "npm run a" } }));
  const config = baseConfig();
  config.executionProfiles[0].requiredStages[1].commands = ["package.json#a"];
  const result = evaluateRg006(repo, config);
  assert.ok(result.findings.some((finding) => /cycle/.test(finding.message)));
});

test("RG006 forbids undeclared repository lifecycle scripts", () => {
  const repo = temporaryDirectory();
  write(join(repo, "package.json"), JSON.stringify({ scripts: { prepare: "node build.js" } }));
  const result = evaluateRg006(repo, baseConfig());
  assert.ok(result.findings.some((finding) => /lifecycle scripts are forbidden/i.test(finding.message)));
});

test("static check reports execution evidence without claiming clean checkout or semantic coverage", () => {
  const repo = initGitRepo();
  writeConfig(repo, baseConfig());
  write(join(repo, "README.md"), "# Base\n");
  const base = commitAll(repo, "base");
  git(repo, ["switch", "-c", "feature"]);
  write(join(repo, "README.md"), "# Feature\n");
  commitAll(repo, "feature");
  const report = checkRepository(repo, { base });
  assert.equal(report.executionContractVerified, true);
  assert.equal(report.workflowConsumersVerified, true);
  assert.equal(report.cleanCheckoutVerified, null);
  assert.equal(report.cleanCheckoutStatus, "not-run");
  assert.equal(report.semanticCoverageVerified, false);
});
