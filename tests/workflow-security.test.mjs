import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { thinWorkflow } from "../src/workflow.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

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
  assert.match(contents, /job\.workflow_repository/);
  assert.match(contents, /job\.workflow_sha/);
  assert.doesNotMatch(contents, /github\.job_workflow_sha/);
});

test("comment reporter is a separate write-capable reusable that never checks out PR code", () => {
  const reporter = parse(readFileSync(join(root, ".github", "workflows", "reporter.yml"), "utf8"));
  assert.equal(reporter.jobs.reporter.permissions["pull-requests"], "write");
  assert.equal(reporter.jobs.reporter.steps.some((step) => String(step.uses || "").startsWith("actions/checkout@")), false);
  const caller = thinWorkflow({ engineVersion: "1.0.0", engineCommitSha: "a".repeat(40), comment: true });
  assert.match(caller, /reporter\.yml@[0-9a-f]{40}/);
  assert.match(caller, /pull-requests: write/);
});

test("central CI runs PR governance only on pull request events", () => {
  const workflow = parse(readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8"));
  assert.equal(workflow.jobs.governance.if, "github.event_name == 'pull_request'");
  assert.equal(workflow.jobs.test.if, undefined);
});

test("central CI governance ref matches the locked engine commit", () => {
  const config = JSON.parse(readFileSync(join(root, ".repo-governance.json"), "utf8"));
  const workflow = parse(readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8"));
  const governanceRef = `Andrewlislin/repo-governance/.github/workflows/governance.yml@${config.engineCommitSha}`;
  const reporterRef = `uses:Andrewlislin/repo-governance/.github/workflows/reporter.yml@${config.engineCommitSha}`;
  assert.equal(workflow.jobs.governance.uses, governanceRef);
  assert.ok(config.workflowAllowedEntries.includes(`uses:${governanceRef}`));
  assert.ok(config.workflowAllowedEntries.includes(reporterRef));
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
  const workflow = parse(contents);
  const steps = workflow.jobs.build.steps;
  const indexWriter = readFileSync(join(root, "scripts", "write-release-index.mjs"), "utf8");
  const sourceChecker = readFileSync(join(root, "scripts", "check-sources.mjs"), "utf8");
  const seaBuilder = readFileSync(join(root, "scripts", "build-sea.mjs"), "utf8");
  const releasePackager = readFileSync(join(root, "scripts", "package-release.mjs"), "utf8");
  assert.ok(steps.some((step) => step.name === "Install" && step.run === "npm ci"));
  assert.ok(steps.some((step) => step.name === "Static checks" && step.run === "npm run check:static"));
  assert.ok(steps.some((step) => step.name === "Full tests" && step.if === "runner.os != 'Windows'" && step.run === "npm test"));
  assert.match(contents, /attest-build-provenance@[0-9a-f]{40}/);
  assert.match(contents, /package:release/);
  assert.match(contents, /id: package-version/);
  assert.match(contents, /version="\$\(node -p/);
  assert.match(contents, /echo "version=\$\{version\}" >> "\$GITHUB_OUTPUT"/);
  assert.match(contents, /release\/assets\/\$\{\{ matrix\.platform \}\}\/repo-governance-v\$\{\{ steps\.package-version\.outputs\.version \}\}-/);
  assert.match(contents, /release\/assets\/\$\{\{ matrix\.platform \}\}\/release-manifest\.json/);
  assert.match(contents, /write-release-index\.mjs/);
  assert.match(contents, /release\/final\/\*/);
  assert.doesNotMatch(contents, /gh release create "\$GITHUB_REF_NAME" release\/\*\*/);
  assert.match(indexWriter, /SHA256SUMS/);
  assert.match(sourceChecker, /fileURLToPath\(new URL\("\.\.\/src", import\.meta\.url\)\)/);
  assert.match(seaBuilder, /fileURLToPath\(new URL\("\.\.", import\.meta\.url\)\)/);
  assert.match(seaBuilder, /shell: process\.platform === "win32"/);
  assert.match(releasePackager, /fileURLToPath\(new URL\("\.\.", import\.meta\.url\)\)/);
  assert.match(indexWriter, /fileURLToPath\(new URL\("\.\.", import\.meta\.url\)\)/);
  for (const script of [sourceChecker, seaBuilder, releasePackager, indexWriter]) {
    assert.doesNotMatch(script, /new URL\([^)]+import\.meta\.url\)\.pathname/);
  }
});
