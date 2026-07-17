import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { GovernanceError } from "../src/errors.mjs";
import { evaluateRg002 } from "../src/rg002.mjs";
import { baseConfig, temporaryDirectory, write } from "./helpers.mjs";

test("only executable entries require exactly one tier; support files are not entries", () => {
  const repo = temporaryDirectory();
  const config = baseConfig({
    testEntries: [{ id: "unit", type: "file", path: "tests/unit/app.test.js" }],
    testSupport: ["tests/fixtures/**", "tests/helpers/**"],
    testTiers: { "pr-blocking": [], nightly: [], "manual-smoke": [] },
  });
  const result = evaluateRg002(repo, config);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].testEntry, "unit");
  assert.equal(result.findings.some((finding) => /fixture|helper/.test(finding.testEntry || "")), false);
});

test("real provider entry cannot be reached by default PR command even when it may skip", () => {
  const repo = temporaryDirectory();
  write(join(repo, "package.json"), JSON.stringify({ scripts: { test: "pnpm run test:unit && pnpm run test:provider", "test:unit": "node --test unit", "test:provider": "node --test provider --skip-if-no-key" } }));
  const config = baseConfig({
    testEntries: [
      { id: "unit", type: "command", command: "node --test unit", node: "package.json#test:unit" },
      { id: "provider", type: "command", command: "node --test provider --skip-if-no-key", node: "package.json#test:provider" },
    ],
    testTiers: { "pr-blocking": ["unit"], nightly: ["provider"], "manual-smoke": [] },
    prBlockingCommands: ["package.json#test"],
  });
  const result = evaluateRg002(repo, config);
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].message, /nightly/);
});

test("pnpm, Bun, registered pytest entries, and explicit aliases are traversed", () => {
  const repo = temporaryDirectory();
  write(join(repo, "package.json"), JSON.stringify({ scripts: { test: "bun run test:js && pytest -q tests/contract", "test:js": "node --test" } }));
  const config = baseConfig({
    testEntries: [
      { id: "js", type: "command", command: "node --test", node: "package.json#test:js" },
      { id: "py", type: "command", command: "pytest -q tests/contract" },
    ],
    pythonTestEntries: [{ id: "py", command: "pytest -q tests/contract" }],
    testTiers: { "pr-blocking": ["js", "py"], nightly: [], "manual-smoke": [] },
    prBlockingCommands: ["root-test"],
    commandAliases: { "root-test": ["package.json#test"] },
  });
  const result = evaluateRg002(repo, config);
  assert.deepEqual(result.findings, []);
  assert.ok(result.reachable.includes("py"));
  assert.ok(result.reachable.includes("package.json#test:js"));
});

for (const definition of ["eval $TEST_COMMAND", "make test", "sh scripts/tests.sh", "pnpm run ${TARGET}"]) {
  test(`unresolvable protected command is a configuration error: ${definition}`, () => {
    const repo = temporaryDirectory();
    write(join(repo, "package.json"), JSON.stringify({ scripts: { test: definition } }));
    assert.throws(
      () => evaluateRg002(repo, baseConfig({ prBlockingCommands: ["package.json#test"] })),
      (error) => error instanceof GovernanceError && error.code === "RG002_COMMAND_GRAPH" && error.exitCode === 2,
    );
  });
}
