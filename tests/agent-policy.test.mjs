import assert from "node:assert/strict";
import { readFileSync, realpathSync, symlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { matchAgentPolicy, resolveAgentPolicy } from "../src/agent-policy.mjs";
import { preflightRepository } from "../src/preflight.mjs";
import { commitAll, initGitRepo, temporaryDirectory, write } from "./helpers.mjs";

const identity = { version: "1.1.0", commitSha: "a".repeat(40) };

function fixture() {
  const home = temporaryDirectory("repo-governance-agent-policy-home-");
  const repo = initGitRepo();
  const root = repo;
  write(join(repo, "README.md"), "# Fixture\n");
  commitAll(repo, "initial");
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
  return { env, home, root, repo };
}

function writePolicy(home, policy) {
  write(join(home, ".repo-governance-agent.json"), `${JSON.stringify(policy, null, 2)}\n`);
}

function policy(entries, overrides = {}) {
  return {
    schemaVersion: 1,
    autoPreflight: true,
    autoBootstrap: false,
    defaultPresetByPath: entries,
    ...overrides,
  };
}

test("missing Agent policy uses immutable built-in defaults", () => {
  const { env, repo } = fixture();
  assert.deepEqual(resolveAgentPolicy(repo, { env }), {
    source: "built-in-defaults",
    autoPreflight: true,
    autoBootstrap: false,
    matchedPathPrefix: null,
    preset: null,
  });
});

test("priority fixture selects the longest matching path prefix", () => {
  const fixtureData = JSON.parse(readFileSync(new URL("./fixtures/agent-policy-priority.json", import.meta.url), "utf8"));
  assert.deepEqual(matchAgentPolicy(fixtureData.repoPath, fixtureData.entries), fixtureData.expected);
});

test("real-path normalization makes a more specific symlink rule deterministic", () => {
  const { env, home, root, repo } = fixture();
  const alias = join(dirname(repo), `${basename(repo)}-alias`);
  symlinkSync(repo, alias, "dir");
  writePolicy(home, policy([
    { pathPrefix: dirname(root), preset: "node-library" },
    { pathPrefix: alias, preset: "node-service" },
  ]));
  const resolved = resolveAgentPolicy(repo, { env });
  assert.equal(resolved.matchedPathPrefix, realpathSync(repo));
  assert.equal(resolved.preset, "node-service");
});

test("equal-priority real-path conflicts block preflight", () => {
  const { env, home, root, repo } = fixture();
  const alias = join(dirname(repo), `${basename(repo)}-alias`);
  symlinkSync(repo, alias, "dir");
  writePolicy(home, policy([
    { pathPrefix: root, preset: "node-library" },
    { pathPrefix: alias, preset: "node-service" },
  ]));
  const report = preflightRepository(repo, { env, identity });
  assert.equal(report.repoState, "blocked");
  assert.equal(report.error.code, "RG_AGENT_POLICY");
  assert.equal(report.policy.source, "user-policy");
  assert.equal(report.policy.autoBootstrap, false);
});

test("invalid policy and unknown presets fail closed", () => {
  for (const contents of [
    "{invalid json\n",
    JSON.stringify(policy([], { autoPreflight: false, autoBootstrap: true })),
    JSON.stringify(policy([{ pathPrefix: "/", preset: "inferred-framework" }])),
  ]) {
    const { env, home, repo } = fixture();
    write(join(home, ".repo-governance-agent.json"), contents);
    const report = preflightRepository(repo, { env, identity });
    assert.equal(report.repoState, "blocked");
    assert.equal(report.status, "blocked");
    assert.equal(report.exitCode, 2);
    assert.equal(report.error.code, "RG_AGENT_POLICY");
  }
});

test("autoBootstrap only removes repeated confirmation for an explicitly matched preset", () => {
  const matchedFixture = fixture();
  writePolicy(matchedFixture.home, policy([
    { pathPrefix: matchedFixture.root, preset: "node-library" },
  ], { autoBootstrap: true }));
  const matched = preflightRepository(matchedFixture.repo, { env: matchedFixture.env, identity });
  assert.equal(matched.repoState, "unmanaged");
  assert.deepEqual(matched.policy, {
    source: "user-policy",
    autoPreflight: true,
    autoBootstrap: true,
    matchedPathPrefix: realpathSync(matchedFixture.root),
    preset: "node-library",
  });
  assert.deepEqual(matched.recommendedAction, {
    id: "bootstrap-required",
    command: "repo-governance bootstrap --preset node-library --json",
    preset: "node-library",
    requiresPreset: false,
    requiresConfirmation: false,
  });

  const unmatchedFixture = fixture();
  const outside = temporaryDirectory("repo-governance-agent-policy-outside-");
  writePolicy(unmatchedFixture.home, policy([
    { pathPrefix: outside, preset: "node-library" },
  ], { autoBootstrap: true }));
  const unmatched = preflightRepository(unmatchedFixture.repo, { env: unmatchedFixture.env, identity });
  assert.equal(unmatched.policy.autoBootstrap, false);
  assert.equal(unmatched.policy.preset, null);
  assert.equal(unmatched.recommendedAction.requiresPreset, true);
  assert.equal(unmatched.recommendedAction.requiresConfirmation, true);
});

test("authorization policy source contains no remote-write capability", () => {
  const source = readFileSync(new URL("../src/agent-policy.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /github enforce|pull request|comment|ruleset|createPullRequest/);
  assert.doesNotMatch(source, /writeFileSync|appendFileSync|mkdirSync|rmSync|renameSync/);

  const wrappers = [
    new URL("../adapters/codex/hooks/repo-governance-agent-gate.mjs", import.meta.url),
    new URL("../adapters/claude-code/hooks/repo-governance-agent-gate.mjs", import.meta.url),
  ].map((path) => readFileSync(path, "utf8")).join("\n");
  assert.doesNotMatch(wrappers, /\.repo-governance-agent\.json|defaultPresetByPath|matchAgentPolicy|realpathSync/);
});
