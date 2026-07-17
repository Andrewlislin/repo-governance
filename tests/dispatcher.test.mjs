import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { dispatch } from "../src/dispatcher.mjs";
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
