import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../skills", import.meta.url));
const expected = [
  "bootstrap-repo-governance",
  "classify-test-tier",
  "plan-change-test-impact",
  "protect-public-commands",
  "triage-ci-failure",
];

function frontmatter(contents) {
  const match = contents.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md must begin with YAML frontmatter");
  return parse(match[1]);
}

test("all planned Skills have valid metadata and no scaffold placeholders", () => {
  assert.deepEqual(readdirSync(root).sort(), expected);
  for (const name of expected) {
    const contents = readFileSync(join(root, name, "SKILL.md"), "utf8");
    const metadata = frontmatter(contents);
    assert.equal(metadata.name, name);
    assert.ok(metadata.description.length > 80);
    assert.doesNotMatch(contents, /\bTODO\b|Structuring This Skill/);
    const agent = parse(readFileSync(join(root, name, "agents/openai.yaml"), "utf8"));
    assert.match(agent.interface.default_prompt, new RegExp(`\\$${name}`));
    assert.ok(agent.interface.short_description.length >= 25 && agent.interface.short_description.length <= 64);
  }
});

test("failure triage fixtures cover four classes and insufficient evidence", () => {
  const fixtures = readFileSync(join(root, "triage-ci-failure", "references/classification-fixtures.md"), "utf8");
  for (const classification of ["true-bug", "stale-test", "stale-workflow", "wrong-ci-tier", "insufficient-evidence"]) {
    assert.match(fixtures, new RegExp(`\\b${classification}\\b`));
  }
  const skill = readFileSync(join(root, "triage-ci-failure", "SKILL.md"), "utf8");
  assert.match(skill, /stop before modifying code/);
});

test("Skills delegate hard decisions to CLI structured output", () => {
  const combined = expected.map((name) => readFileSync(join(root, name, "SKILL.md"), "utf8")).join("\n");
  assert.match(combined, /repo-governance check --json/);
  assert.match(combined, /does not prove semantic coverage|Do not copy the engine/i);
});
