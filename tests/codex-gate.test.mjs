import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { runPreflight, translateHook } from "../adapters/codex/hooks/repo-governance-agent-gate.mjs";

const adapterRoot = new URL("../adapters/codex/", import.meta.url);

function report(overrides = {}) {
  return {
    schemaVersion: 1,
    command: "preflight",
    ok: true,
    status: "needs_attention",
    repoState: "unmanaged",
    recommendedAction: { id: "bootstrap-required" },
    ...overrides,
  };
}

test("Codex runner invokes only preflight JSON and accepts its needs-attention exit", () => {
  const calls = [];
  const expected = report();
  const actual = runPreflight("/repo", {
    env: { REPO_GOVERNANCE_CLI: "/engine/repo-governance" },
    run(command, args, options) {
      calls.push({ command, args, cwd: options.cwd });
      return { status: 1, stdout: JSON.stringify(expected), stderr: "" };
    },
  });
  assert.deepEqual(actual, expected);
  assert.deepEqual(calls, [{ command: "/engine/repo-governance", args: ["preflight", "--json"], cwd: "/repo" }]);
});

test("Codex Hook denies unmanaged edits even when preflight ok is true", () => {
  const denied = translateHook({ hook_event_name: "PreToolUse" }, report());
  assert.equal(denied.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /unmanaged\/needs_attention/);

  const allowed = translateHook({ hook_event_name: "PreToolUse" }, report({ status: "succeeded", repoState: "managed" }));
  assert.equal(allowed, null);
});

test("SessionStart adds the complete CLI decision as context without changing it", () => {
  const expected = report({ repoState: "misconfigured" });
  const output = translateHook({ hook_event_name: "SessionStart" }, expected);
  assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(output.hookSpecificOutput.additionalContext, new RegExp(JSON.stringify(expected).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Codex Hook template is explicit, trusted by the user, and limited to the two planned events", () => {
  const path = new URL("../adapters/codex/hooks/hooks.example.json", import.meta.url);
  const template = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(Object.keys(template.hooks), ["SessionStart", "PreToolUse"]);
  assert.equal(template.hooks.PreToolUse[0].matcher, "Edit|Write");
  assert.match(template.description, /Replace the runner path, install explicitly/);
  assert.match(template.hooks.SessionStart[0].hooks[0].command, /absolute\/path\/to\/installed/);
  assert.equal(existsSync(new URL("../adapters/codex/.codex/config.toml", import.meta.url)), false);
});

test("Codex gate wrappers contain no governance engine or remote-write implementation", () => {
  const files = [
    new URL("../adapters/codex/hooks/repo-governance-agent-gate.mjs", import.meta.url),
    new URL("../adapters/codex/skills/repo-governance-agent-gate/SKILL.md", import.meta.url),
    new URL("../playbooks/repo-governance-agent-gate.md", import.meta.url),
  ];
  const combined = files.map((path) => readFileSync(path, "utf8")).join("\n");
  assert.doesNotMatch(combined, /definitionHash|highImpactMappings|workflowAllowedEntries|createHash|globToRegExp/);
  const runner = readFileSync(files[0], "utf8");
  assert.match(runner, /\.\.\/\.\.\/\.\.\/\.\.\/repo-governance/);
  assert.doesNotMatch(runner, /bootstrap|github enforce|pull request|ruleset|writeFileSync/);
});
