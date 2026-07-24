import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { verifyPrePushExecution } from "../src/pre-push.mjs";
import { baseConfig, commitAll, git, initGitRepo, temporaryDirectory, write, writeConfig } from "./helpers.mjs";

const ZERO_SHA = "0".repeat(40);

function fixture() {
  const repo = initGitRepo();
  writeConfig(repo, baseConfig());
  write(join(repo, "README.md"), "# Base\n");
  const base = commitAll(repo, "base");
  const remote = join(temporaryDirectory("repo-governance-pre-push-remote-"), "remote.git");
  git(repo, ["init", "--bare", "-b", "main", remote]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "-u", "origin", "main"]);
  git(repo, ["switch", "-c", "feature"]);
  write(join(repo, "README.md"), "# Feature\n");
  const feature = commitAll(repo, "feature");
  return { repo, remote, base, feature };
}

test("pre-push verifies the pushed tip in an isolated checkout and reports the exact base", () => {
  const { repo, remote, base, feature } = fixture();
  write(join(repo, "dist", "stale.txt"), "source-only ignored residue\n");
  write(join(repo, ".git", "info", "exclude"), "dist/\n");
  const result = verifyPrePushExecution(repo, {
    remote: "origin",
    remoteUrl: remote,
    input: `refs/heads/feature ${feature} refs/heads/feature ${ZERO_SHA}\n`,
  });
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].pushedCommitSha, feature);
  assert.equal(result.reports[0].testedCommitSha, feature);
  assert.equal(result.reports[0].sameRevision, true);
  assert.equal(result.reports[0].canonicalBaseInputSha, base);
  assert.equal(result.reports[0].cleanCheckoutVerified, true);
});

test("multiple refs with the same tip and base execute once and retain every ref report", () => {
  const { repo, remote, feature } = fixture();
  git(repo, ["tag", "release-candidate", feature]);
  let executions = 0;
  let isolatedCheckout;
  const result = verifyPrePushExecution(repo, {
    remote: "origin",
    remoteUrl: remote,
    input: [
      `refs/heads/feature ${feature} refs/heads/feature ${ZERO_SHA}`,
      `refs/tags/release-candidate ${feature} refs/tags/release-candidate ${ZERO_SHA}`,
    ].join("\n"),
    verify(checkout, options) {
      executions += 1;
      isolatedCheckout = checkout;
      assert.equal(options.revision.eventCommitSha, feature);
      return {
        testedCommitSha: feature,
        canonicalBaseSha: options.revision.canonicalBaseInputSha,
        executionContractVersion: 1,
        prePushProtocolVersion: 1,
        executionContractVerified: true,
        workflowConsumersVerified: true,
        cleanCheckoutVerified: true,
        semanticCoverageVerified: false,
      };
    },
  });
  assert.equal(executions, 1);
  assert.deepEqual(result.reports.map((report) => report.ref), ["refs/heads/feature", "refs/tags/release-candidate"]);
  assert.equal(existsSync(isolatedCheckout), false);
});

test("deletion-only push skips execution", () => {
  const { repo, remote } = fixture();
  let executions = 0;
  const result = verifyPrePushExecution(repo, {
    remote: "origin",
    remoteUrl: remote,
    input: `(delete) ${ZERO_SHA} refs/heads/old ${"a".repeat(40)}\n`,
    verify() { executions += 1; },
  });
  assert.equal(executions, 0);
  assert.deepEqual(result.skipped, [{ ref: "refs/heads/old", reason: "delete" }]);
});
