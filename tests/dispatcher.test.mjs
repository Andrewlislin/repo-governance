import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { dispatch } from "../src/dispatcher.mjs";
import { writeDefaultEngine } from "../src/launcher-install.mjs";
import { baseConfig, initGitRepo, temporaryDirectory, write, writeConfig } from "./helpers.mjs";

function setup() {
  const repo = initGitRepo();
  const sha = "a".repeat(40);
  writeConfig(repo, baseConfig({ engineVersion: "1.2.3", engineCommitSha: sha }));
  const data = temporaryDirectory("repo-governance-dispatch-");
  const env = { ...process.env, PATH: "", XDG_DATA_HOME: data };
  const engineDirectory = join(data, "repo-governance", "engines", sha);
  const executable = join(engineDirectory, "repo-governance");
  const bytes = readFileSync("/usr/bin/true");
  mkdirSync(engineDirectory, { recursive: true });
  symlinkSync("/usr/bin/true", executable);
  write(join(engineDirectory, "engine-manifest.json"), `${JSON.stringify({
    engineVersion: "1.2.3",
    engineCommitSha: sha,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  })}\n`);
  return { repo, env, executable };
}

test("dispatcher locates the locked engine with an empty PATH", () => {
  const fixture = setup();
  assert.equal(dispatch({ cwd: fixture.repo, env: fixture.env, argv: ["pre-push"] }).exitCode, 0);
});

test("dispatcher translates pre-push to check and preserves arguments, cwd, environment, and inherited stdio", () => {
  const fixture = setup();
  let invocation;
  const result = dispatch({
    cwd: fixture.repo,
    env: fixture.env,
    argv: ["pre-push", "origin", "git@example/repo"],
    spawn(executable, argv, options) {
      invocation = { executable, argv, options };
      return { status: 7, signal: null };
    },
  });
  assert.equal(result.exitCode, 7);
  assert.equal(invocation.executable, fixture.executable);
  assert.deepEqual(invocation.argv, ["check", "origin", "git@example/repo"]);
  assert.equal(invocation.options.cwd, fixture.repo);
  assert.equal(invocation.options.env, fixture.env);
  assert.equal(invocation.options.stdio, "inherit");
});

test("one launcher routes two repositories to their independently locked engines", () => {
  const first = setup();
  const second = initGitRepo();
  const secondSha = "b".repeat(40);
  writeConfig(second, baseConfig({ engineVersion: "2.0.0", engineCommitSha: secondSha }));
  const secondDirectory = join(first.env.XDG_DATA_HOME, "repo-governance", "engines", secondSha);
  const secondExecutable = join(secondDirectory, "repo-governance");
  const bytes = readFileSync("/usr/bin/true");
  mkdirSync(secondDirectory, { recursive: true });
  symlinkSync("/usr/bin/true", secondExecutable);
  write(join(secondDirectory, "engine-manifest.json"), `${JSON.stringify({
    engineVersion: "2.0.0",
    engineCommitSha: secondSha,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  })}\n`);
  const selected = [];
  const spawn = (executable) => { selected.push(executable); return { status: 0, signal: null }; };
  dispatch({ cwd: first.repo, env: first.env, argv: ["preflight", "--json"], spawn });
  dispatch({ cwd: second, env: first.env, argv: ["preflight", "--json"], spawn });
  assert.deepEqual(selected, [first.executable, secondExecutable]);
});

test("global commands and unconfigured bootstrap use the verified default engine", () => {
  const fixture = setup();
  writeDefaultEngine({ engineVersion: "1.2.3", engineCommitSha: "a".repeat(40) }, { env: fixture.env });
  const outside = initGitRepo();
  const selected = [];
  const spawn = (executable, argv) => { selected.push([executable, argv]); return { status: 0, signal: null }; };
  dispatch({ cwd: outside, env: fixture.env, argv: ["bootstrap", "--preset", "node-library"], spawn });
  dispatch({ cwd: outside, env: fixture.env, argv: ["engines", "list", "--json"], spawn });
  dispatch({ cwd: outside, env: fixture.env, argv: ["repositories", "list"], spawn });
  dispatch({ cwd: outside, env: fixture.env, argv: ["version", "check"], spawn });
  dispatch({ cwd: outside, env: fixture.env, argv: ["preflight", "--json"], spawn });
  assert.deepEqual(selected.map(([executable]) => executable), Array(5).fill(fixture.executable));
});

test("an unconfigured nested Git repository never inherits a parent repository engine", () => {
  const fixture = setup();
  writeDefaultEngine({ engineVersion: "1.2.3", engineCommitSha: "a".repeat(40) }, { env: fixture.env });
  const nested = join(fixture.repo, "nested");
  mkdirSync(nested, { recursive: true });
  const { status } = spawnSync("git", ["init", "-q", nested]);
  assert.equal(status, 0);
  let argv;
  dispatch({
    cwd: nested,
    env: fixture.env,
    argv: ["preflight", "--json"],
    spawn(_executable, forwarded) { argv = forwarded; return { status: 0, signal: null }; },
  });
  assert.deepEqual(argv, ["preflight", "--json"]);
});

test("damaged repository configuration fails without falling back to the default engine", () => {
  const fixture = setup();
  writeDefaultEngine({ engineVersion: "1.2.3", engineCommitSha: "a".repeat(40) }, { env: fixture.env });
  write(join(fixture.repo, ".repo-governance.json"), "{damaged");
  let spawned = false;
  const result = dispatch({ cwd: fixture.repo, env: fixture.env, argv: ["preflight"], spawn() { spawned = true; } });
  assert.equal(result.exitCode, 2);
  assert.equal(spawned, false);
  assert.match(result.message, /configuration is invalid.*refusing to use the default engine/i);
});

test("successful cross-version update verifies the new engine before changing the default pointer", () => {
  const fixture = setup();
  writeDefaultEngine({ engineVersion: "1.2.3", engineCommitSha: "a".repeat(40) }, { env: fixture.env });
  const nextSha = "b".repeat(40);
  const nextDirectory = join(fixture.env.XDG_DATA_HOME, "repo-governance", "engines", nextSha);
  const nextExecutable = join(nextDirectory, "repo-governance");
  const bytes = readFileSync("/usr/bin/true");
  const result = dispatch({
    cwd: fixture.repo,
    env: fixture.env,
    argv: ["update", "--bundle", "/verified"],
    spawn() {
      mkdirSync(nextDirectory, { recursive: true });
      symlinkSync("/usr/bin/true", nextExecutable);
      write(join(nextDirectory, "engine-manifest.json"), `${JSON.stringify({
        engineVersion: "2.0.0",
        engineCommitSha: nextSha,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      })}\n`);
      writeConfig(fixture.repo, baseConfig({ engineVersion: "2.0.0", engineCommitSha: nextSha }));
      return { status: 0, signal: null };
    },
  });
  assert.equal(result.exitCode, 0);
  const pointer = JSON.parse(readFileSync(join(fixture.env.XDG_DATA_HOME, "repo-governance", "default-engine.json"), "utf8"));
  assert.equal(pointer.engineCommitSha, nextSha);
});

test("missing or damaged locked engine fails without downloading", () => {
  const fixture = setup();
  write(join(fixture.executable, "..", "engine-manifest.json"), `${JSON.stringify({
    engineVersion: "1.2.3",
    engineCommitSha: "a".repeat(40),
    sha256: "0".repeat(64),
  })}\n`);
  const result = dispatch({ cwd: fixture.repo, env: fixture.env, argv: [] });
  assert.equal(result.exitCode, 2);
  assert.match(result.message, /checksum.*invalid/i);
});

test("first push from an uninitialized repository names the explicit bootstrap entry", () => {
  const repo = initGitRepo();
  const result = dispatch({ cwd: repo, env: process.env, argv: ["pre-push"] });
  assert.equal(result.exitCode, 2);
  assert.match(result.message, /bootstrap --preset <preset>/);
});
