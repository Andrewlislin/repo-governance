import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { evaluateRg003 } from "../src/rg003.mjs";
import { baseConfig, temporaryDirectory, write } from "./helpers.mjs";

function fixture(policyJob, extra = {}) {
  const repo = temporaryDirectory();
  write(join(repo, ".github/workflows/ci.yml"), `name: CI\non: pull_request\njobs:\n${policyJob}\n`);
  const config = baseConfig({
    workflowAllowedEntries: ["uses:CoaseEdge/repo-governance/action@0123456789012345678901234567890123456789", "run:node scripts/repo-hygiene.mjs"],
    guards: [{ id: "repo-hygiene", path: "scripts/repo-hygiene.mjs", entry: "run:node scripts/repo-hygiene.mjs" }],
    policyChecks: [{ workflow: ".github/workflows/ci.yml", job: "policy", steps: ["Governance"], requiredGuards: extra.requiredGuards || [] }],
  });
  return { repo, config };
}

test("registered policy step calling central Action passes", () => {
  const { repo, config } = fixture(`  policy:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Governance\n        uses: CoaseEdge/repo-governance/action@0123456789012345678901234567890123456789`);
  assert.deepEqual(evaluateRg003(repo, config).findings, []);
});

test("unregistered inline command inside formal policy job fails", () => {
  const { repo, config } = fixture(`  policy:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Governance\n        uses: CoaseEdge/repo-governance/action@0123456789012345678901234567890123456789\n      - name: Inline secret scan\n        run: |\n          grep -R secret .\n          exit 0`);
  const result = evaluateRg003(repo, config);
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].message, /unregistered run/);
});

test("registered repository guard must exist and be invoked exactly", () => {
  const { repo, config } = fixture(`  policy:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Governance\n        run: node scripts/repo-hygiene.mjs`, { requiredGuards: ["repo-hygiene"] });
  assert.equal(evaluateRg003(repo, config).findings[0].guard, "repo-hygiene");
  write(join(repo, "scripts/repo-hygiene.mjs"), "// official guard\n");
  assert.deepEqual(evaluateRg003(repo, config).findings, []);
});

test("ordinary multiline build and suspicious unregistered jobs are outside the hard gate", () => {
  const { repo, config } = fixture(`  policy:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Governance\n        uses: CoaseEdge/repo-governance/action@0123456789012345678901234567890123456789\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Build preparation\n        run: |\n          npm ci\n          npm run build\n      - name: Suspicious but unregistered duplicate\n        run: grep -R secret .`);
  assert.deepEqual(evaluateRg003(repo, config).findings, []);
});

test("registered policy entry must be on the explicit allowlist", () => {
  const { repo, config } = fixture(`  policy:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Governance\n        run: echo pretend-governance`);
  assert.match(evaluateRg003(repo, config).findings[0].message, /does not call an allowed/);
});
