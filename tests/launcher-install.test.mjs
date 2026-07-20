import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  installRuntimeEntries,
  isPathConfigured,
  MANAGED_ENTRY_MARKER,
  runtimeEntryPaths,
} from "../src/launcher-install.mjs";
import { temporaryDirectory, write } from "./helpers.mjs";

test("Windows command entry uses a versioned launcher, quotes it, and forwards all arguments", () => {
  const root = temporaryDirectory("repo-governance-windows-entry-");
  const env = { LOCALAPPDATA: join(root, "Local App Data"), PATH: "" };
  const launcherSource = join(root, "repo-governance-launcher.exe");
  const commitSha = "a".repeat(40);
  write(launcherSource, "launcher");
  const result = installRuntimeEntries({
    launcherSource,
    engineVersion: "1.2.0",
    engineCommitSha: commitSha,
    env,
    platform: "win32",
  });
  assert.match(result.launcherPath, new RegExp(`${commitSha}[/\\\\]repo-governance-launcher\\.exe$`));
  const command = readFileSync(result.commandPath, "utf8");
  assert.match(command, new RegExp(MANAGED_ENTRY_MARKER));
  assert.match(command, /".*repo-governance-launcher\.exe" %\*/);
  assert.match(command, /exit \/b %ERRORLEVEL%/);
  assert.equal(result.pathConfigured, false);
  assert.match(result.actionRequired, /SetEnvironmentVariable\('Path'/);
});

test("Windows PATH matching ignores case and surrounding quotes", () => {
  const root = temporaryDirectory("repo-governance-windows-path-");
  const env = { LOCALAPPDATA: join(root, "Local App Data"), PATH: "" };
  const paths = runtimeEntryPaths({ env, platform: "win32", engineCommitSha: "a".repeat(40) });
  const bin = dirname(paths.commandPath);
  env.PATH = `C:\\Other;"${bin.toUpperCase()}"`;
  assert.equal(isPathConfigured(bin, env, "win32"), true);
});

test("launcher replacement failure restores the previous managed launcher, entry, and default pointer", () => {
  const root = temporaryDirectory("repo-governance-launcher-rollback-");
  const env = { ...process.env, HOME: root, XDG_DATA_HOME: join(root, "data"), PATH: "" };
  const firstSource = join(root, "first-launcher");
  const secondSource = join(root, "second-launcher");
  write(firstSource, "first", 0o755);
  write(secondSource, "second", 0o755);
  const first = installRuntimeEntries({
    launcherSource: firstSource,
    engineVersion: "1.1.1",
    engineCommitSha: "a".repeat(40),
    env,
  });
  const before = {
    launcher: readFileSync(first.launcherPath),
    command: readFileSync(first.commandPath),
    pointer: readFileSync(first.defaultEnginePath),
  };
  assert.throws(() => installRuntimeEntries({
    launcherSource: secondSource,
    engineVersion: "1.2.0",
    engineCommitSha: "b".repeat(40),
    env,
    failAfterLauncher: true,
  }), /Injected launcher installation failure/);
  assert.deepEqual(readFileSync(first.launcherPath), before.launcher);
  assert.deepEqual(readFileSync(first.commandPath), before.command);
  assert.deepEqual(readFileSync(first.defaultEnginePath), before.pointer);
  assert.equal(existsSync(`${first.launcherPath}.tmp`), false);
});
