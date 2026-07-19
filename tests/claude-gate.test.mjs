import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  runPreflight as runClaudePreflight,
  translateHook as translateClaudeHook,
} from "../adapters/claude-code/hooks/repo-governance-agent-gate.mjs";
import { translateHook as translateCodexHook } from "../adapters/codex/hooks/repo-governance-agent-gate.mjs";

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

test("Claude runner invokes only preflight JSON", () => {
  const calls = [];
  const expected = report();
  const actual = runClaudePreflight("/repo", {
    env: { REPO_GOVERNANCE_CLI: "/engine/repo-governance" },
    run(command, args, options) {
      calls.push({ command, args, cwd: options.cwd });
      return { status: 1, stdout: JSON.stringify(expected), stderr: "" };
    },
  });
  assert.deepEqual(actual, expected);
  assert.deepEqual(calls, [{ command: "/engine/repo-governance", args: ["preflight", "--json"], cwd: "/repo" }]);
});

test("Claude and Codex translate the same structured decisions", () => {
  for (const input of [{ hook_event_name: "SessionStart" }, { hook_event_name: "PreToolUse" }]) {
    for (const decision of [
      report(),
      report({ status: "succeeded", repoState: "managed" }),
      report({ ok: false, status: "blocked", repoState: "blocked" }),
    ]) {
      assert.deepEqual(translateClaudeHook(input, decision), translateCodexHook(input, decision));
    }
  }
  assert.equal(translateClaudeHook({ hook_event_name: "PreToolUse" }, report()).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(translateClaudeHook(
    { hook_event_name: "PreToolUse" },
    report({ status: "succeeded", repoState: "managed" }),
  ), null);
});

test("Claude Hook and pre-commit templates require explicit installation", () => {
  const template = JSON.parse(readFileSync(new URL(
    "../adapters/claude-code/hooks/settings.example.json",
    import.meta.url,
  ), "utf8"));
  assert.deepEqual(Object.keys(template.hooks), ["SessionStart", "PreToolUse"]);
  assert.equal(template.hooks.PreToolUse[0].matcher, "Edit|Write");
  assert.match(template.hooks.SessionStart[0].hooks[0].command, /absolute\/path\/to\/installed/);
  assert.equal(existsSync(new URL("../adapters/claude-code/.claude/settings.json", import.meta.url)), false);

  const preCommit = readFileSync(new URL("../adapters/claude-code/hooks/pre-commit.example", import.meta.url), "utf8");
  assert.match(preCommit, /repo-governance preflight --json/);
  assert.doesNotMatch(preCommit, /bootstrap|prepare-pr|github enforce/);
});

test("Claude gate wrappers contain no governance engine or remote-write implementation", () => {
  const files = [
    new URL("../adapters/claude-code/hooks/repo-governance-agent-gate.mjs", import.meta.url),
    new URL("../adapters/claude-code/commands/repo-governance-agent-gate.md", import.meta.url),
    new URL("../adapters/claude-code/hooks/pre-commit.example", import.meta.url),
  ];
  const combined = files.map((path) => readFileSync(path, "utf8")).join("\n");
  assert.doesNotMatch(combined, /definitionHash|highImpactMappings|workflowAllowedEntries|createHash|globToRegExp/);
  const runner = readFileSync(files[0], "utf8");
  assert.match(runner, /\.\.\/\.\.\/\.\.\/\.\.\/repo-governance/);
  assert.doesNotMatch(runner, /bootstrap|github enforce|pull request|ruleset|writeFileSync/);
});
