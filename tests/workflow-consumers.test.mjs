import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { evaluateWorkflowConsumers } from "../src/workflow-consumers.mjs";
import { baseConfig, temporaryDirectory, write, writeConfig } from "./helpers.mjs";

const ENGINE_SHA = "a".repeat(40);

function fixture() {
  const repo = temporaryDirectory("repo-governance-workflow-consumer-");
  const config = baseConfig({ engineVersion: "1.3.0", engineCommitSha: ENGINE_SHA });
  writeConfig(repo, config);
  return { repo, config, workflow: join(repo, ".github/workflows/repo-governance.yml") };
}

test("declared workflow consumer uniquely verifies exact revision and complete execution context", () => {
  const { repo, config } = fixture();
  assert.deepEqual(evaluateWorkflowConsumers(repo, config), { findings: [], verified: true });
});

for (const [name, replace, message] of [
  ["floating Action", ["actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38", "actions/setup-node@v6"], /full 40-character/],
  ["wrong revision", ["${{ github.event.pull_request.head.sha }}", "${{ github.sha }}"], /declared exact revision/],
  ["independent install", ["      - name: Run governed validation", "      - name: Install\n        run: npm ci\n      - name: Run governed validation"], /undeclared run or uses/],
  ["local composite", [`CoaseEdge/repo-governance/action@${ENGINE_SHA}`, "./action"], /Local composite Actions/],
]) {
  test(`workflow consumer rejects ${name}`, () => {
    const { repo, config, workflow } = fixture();
    const contents = readFileSync(workflow, "utf8");
    write(workflow, contents.replace(replace[0], replace[1]));
    const result = evaluateWorkflowConsumers(repo, config);
    assert.ok(result.findings.some((finding) => message.test(finding.message)));
  });
}

test("workflow consumer rejects undeclared conditions, needs, and matrix through execution-context equality", () => {
  const { repo, config } = fixture();
  config.executionProfiles[0].consumers[1].executionContext.jobIf = "github.actor != 'bot'";
  const result = evaluateWorkflowConsumers(repo, config);
  assert.ok(result.findings.some((finding) => /execution context/.test(finding.message)));
});

test("profile without Hook or workflow consumers fails closed", () => {
  const { repo, config } = fixture();
  config.executionProfiles[0].consumers = [];
  const result = evaluateWorkflowConsumers(repo, config);
  assert.equal(result.verified, false);
  assert.equal(result.findings.length, 2);
});
