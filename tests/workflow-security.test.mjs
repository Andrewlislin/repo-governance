import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { thinWorkflow } from "../src/workflow.mjs";

const root = new URL("..", import.meta.url).pathname;

test("workflows never use pull_request_target and pin every external Action to a full SHA", () => {
  for (const name of readdirSync(join(root, ".github", "workflows"))) {
    const contents = readFileSync(join(root, ".github", "workflows", name), "utf8");
    assert.doesNotMatch(contents, /pull_request_target/);
    for (const match of contents.matchAll(/^\s*uses:\s*([^\s]+)\s*$/gm)) {
      const uses = match[1];
      if (uses.startsWith("./")) continue;
      const revision = uses.split("@").at(-1);
      assert.match(revision, /^[0-9a-f]{40}$/, `${name} contains floating Action/reusable workflow reference: ${uses}`);
    }
  }
});

test("reusable workflow fetches full history and separates comment permissions", () => {
  const contents = readFileSync(join(root, ".github", "workflows", "governance.yml"), "utf8");
  const workflow = parse(contents);
  assert.equal(workflow.jobs.governance.permissions.contents, "read");
  assert.equal(workflow.jobs.governance.permissions["pull-requests"], "read");
  assert.equal(workflow.jobs.governance.steps[0].with["fetch-depth"], 0);
  assert.equal(workflow.jobs.reporter.permissions["pull-requests"], "write");
  assert.equal(workflow.jobs.reporter.steps.some((step) => String(step.uses || "").startsWith("actions/checkout@")), false);
  assert.match(contents, /job\.workflow_repository/);
  assert.match(contents, /job\.workflow_sha/);
  assert.doesNotMatch(contents, /github\.job_workflow_sha/);
});

test("thin caller pins reusable workflow to the same full engine commit", () => {
  const sha = "a".repeat(40);
  const contents = thinWorkflow({ engineVersion: "1.0.0", engineCommitSha: sha });
  assert.match(contents, new RegExp(`governance\\.yml@${sha}`));
  assert.match(contents, /pull_request:/);
  assert.equal(thinWorkflow({ engineVersion: "dev", engineCommitSha: "development" }), null);
});

test("release requires both checksum metadata and GitHub artifact attestation", () => {
  const contents = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(contents, /attest-build-provenance@[0-9a-f]{40}/);
  assert.match(contents, /package:release/);
  assert.match(contents, /SHA256SUMS|release\/\$\{\{ matrix\.platform \}\}/);
});
