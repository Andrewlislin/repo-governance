import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { dependencyPreparationDefinitionHash } from "../src/execution-contract.mjs";
import { verifyCiExecution } from "../src/verify-execution.mjs";
import { baseConfig, commitAll, git, initGitRepo, temporaryDirectory, write, writeConfig } from "./helpers.mjs";

function fixture() {
  const repo = initGitRepo();
  writeConfig(repo, baseConfig());
  write(join(repo, "README.md"), "# Base\n");
  const base = commitAll(repo, "base");
  git(repo, ["switch", "-c", "feature"]);
  write(join(repo, "README.md"), "# Feature\n");
  const feature = commitAll(repo, "feature");
  const eventFile = join(temporaryDirectory("repo-governance-event-"), "event.json");
  write(eventFile, JSON.stringify({ pull_request: { head: { sha: feature }, base: { sha: base } } }));
  return { repo, base, feature, eventFile };
}

function verifiedRuntime(repo, runtime, preparation) {
  return {
    path: "",
    env: {},
    workingDirectory: join(repo, preparation.workingDirectory),
  };
}

test("CI verification binds the event revision, static check, profile, and clean checkout", () => {
  const { repo, base, feature, eventFile } = fixture();
  const calls = [];
  const report = verifyCiExecution(repo, {
    profileId: "pr-validation",
    eventFile,
    runtimeVerifier: verifiedRuntime,
    execute(command, args, options) {
      calls.push({ command, args, cwd: options.cwd });
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.deepEqual(calls, [{ command: "git", args: ["status", "--porcelain=v1"], cwd: repo }]);
  assert.equal(report.revisionSource, "pull-request-head");
  assert.equal(report.eventCommitSha, feature);
  assert.equal(report.testedCommitSha, feature);
  assert.equal(report.canonicalBaseInputSha, base);
  assert.equal(report.sameRevision, true);
  assert.equal(report.executionContractVerified, true);
  assert.equal(report.workflowConsumersVerified, true);
  assert.equal(report.cleanCheckoutVerified, true);
  assert.equal(report.semanticCoverageVerified, false);
});

test("CI verification rejects a checkout that differs from the event revision", () => {
  const { repo, eventFile } = fixture();
  git(repo, ["reset", "--hard", "HEAD^"]);
  assert.throws(
    () => verifyCiExecution(repo, { profileId: "pr-validation", eventFile, runtimeVerifier: verifiedRuntime }),
    (error) => error.code === "RG_REVISION_MISMATCH",
  );
});

test("CI verification rejects ignored residue before static checks or execution", () => {
  const { repo, feature, base } = fixture();
  write(join(repo, ".gitignore"), "dist/\n");
  const cleanFeature = commitAll(repo, "declare ignored output");
  mkdirSync(join(repo, "dist"));
  write(join(repo, "dist", "output.txt"), "stale\n");
  const eventFile = join(temporaryDirectory("repo-governance-event-"), "event.json");
  write(eventFile, JSON.stringify({ pull_request: { head: { sha: cleanFeature }, base: { sha: base } } }));
  let executions = 0;
  assert.throws(
    () => verifyCiExecution(repo, {
      profileId: "pr-validation",
      eventFile,
      runtimeVerifier: verifiedRuntime,
      execute() { executions += 1; },
    }),
    (error) => error.code === "RG_CLEAN_CHECKOUT",
  );
  assert.equal(executions, 0);
  assert.notEqual(feature, cleanFeature);
});

test("candidate RG006 findings block before runtime and dependency preparation", () => {
  const { repo, base } = fixture();
  const config = baseConfig();
  config.executionProfiles[0].dependencyPreparation.definitionHash = "0".repeat(64);
  writeConfig(repo, config);
  const feature = commitAll(repo, "break execution contract");
  const eventFile = join(temporaryDirectory("repo-governance-event-"), "event.json");
  write(eventFile, JSON.stringify({ pull_request: { head: { sha: feature }, base: { sha: base } } }));
  let runtimeChecks = 0;
  let executions = 0;
  assert.throws(
    () => verifyCiExecution(repo, {
      profileId: "pr-validation",
      eventFile,
      runtimeVerifier() { runtimeChecks += 1; },
      execute() { executions += 1; },
    }),
    (error) => error.code === "RG_STATIC_CHECK" && error.details.findings.some((finding) => finding.rule === "RG006"),
  );
  assert.equal(runtimeChecks, 0);
  assert.equal(executions, 0);
});

test("dependency preparation runs before the declared public entry", () => {
  const { repo, base } = fixture();
  const config = baseConfig();
  const runtime = config.runtimes[0];
  runtime.packageManager = { name: "npm", version: "10.9.2" };
  const preparation = config.executionProfiles[0].dependencyPreparation;
  preparation.adapter = "npm";
  preparation.hookArgv = ["npm", "ci", "--offline", "--ignore-scripts"];
  preparation.ciArgv = ["npm", "ci", "--ignore-scripts"];
  preparation.definitionHash = dependencyPreparationDefinitionHash(runtime, preparation);
  writeConfig(repo, config);
  const feature = commitAll(repo, "declare npm preparation");
  const eventFile = join(temporaryDirectory("repo-governance-event-"), "event.json");
  write(eventFile, JSON.stringify({ pull_request: { head: { sha: feature }, base: { sha: base } } }));
  const calls = [];
  verifyCiExecution(repo, {
    profileId: "pr-validation",
    eventFile,
    runtimeVerifier: verifiedRuntime,
    execute(command, args) {
      calls.push([command, ...args]);
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.deepEqual(calls, [
    ["npm", "ci", "--ignore-scripts"],
    ["git", "status", "--porcelain=v1"],
  ]);
});

test("tracked mutations produced by the profile fail the final clean-checkout proof", () => {
  const { repo, eventFile } = fixture();
  assert.throws(
    () => verifyCiExecution(repo, {
      profileId: "pr-validation",
      eventFile,
      runtimeVerifier: verifiedRuntime,
      execute() {
        write(join(repo, "README.md"), "# Mutated\n");
        return { status: 0, stdout: "", stderr: "" };
      },
    }),
    (error) => error.code === "RG_CLEAN_CHECKOUT",
  );
});
