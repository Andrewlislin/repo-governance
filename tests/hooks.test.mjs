import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { connectEffectiveRepositoryHook, doctorHooks, installFutureHooks, uninstallFutureHooks } from "../src/hooks.mjs";
import { git, initGitRepo, temporaryDirectory, write } from "./helpers.mjs";

function isolatedEnv() {
  const home = temporaryDirectory("repo-governance-home-");
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

function dispatcher(env) {
  const path = join(env.HOME, "dispatcher-source");
  write(path, "#!/bin/sh\nexit 0\n", 0o755);
  return path;
}

test("future hook installation and uninstall are reversible in an isolated HOME", () => {
  const env = isolatedEnv();
  const installed = installFutureHooks({ env, dispatcherSource: dispatcher(env) });
  assert.equal(git(env.HOME, ["config", "--global", "--get", "init.templateDir"], { env }).trim(), installed.managedTemplate);
  assert.match(readFileSync(join(installed.managedTemplate, "hooks", "pre-push"), "utf8"), /stable-dispatcher/);
  const result = uninstallFutureHooks({ env });
  assert.equal(result.restoredTemplate, null);
  assert.equal(existsSync(installed.managedTemplate), false);
});

test("existing global template is not overwritten and compose conflicts stop", () => {
  const env = isolatedEnv();
  const original = join(env.HOME, "original-template");
  mkdirSync(join(original, "hooks"), { recursive: true });
  git(env.HOME, ["config", "--global", "init.templateDir", original], { env });
  assert.throws(() => installFutureHooks({ env, dispatcherSource: dispatcher(env) }), /already exists/);
  write(join(original, "hooks", "pre-push"), "#!/bin/sh\necho original\n", 0o755);
  assert.throws(() => installFutureHooks({ env, dispatcherSource: dispatcher(env), compose: true }), /conflicts/);
  assert.equal(git(env.HOME, ["config", "--global", "--get", "init.templateDir"], { env }).trim(), original);
});

test("doctor blocks a stale composition after the original template changes", () => {
  const env = isolatedEnv();
  const original = join(env.HOME, "original-template");
  write(join(original, "description"), "original\n");
  git(env.HOME, ["config", "--global", "init.templateDir", original], { env });
  installFutureHooks({ env, dispatcherSource: dispatcher(env), compose: true });
  const repo = initGitRepo();
  assert.equal(doctorHooks(repo, { env }).ok, true);
  write(join(original, "description"), "changed later\n");
  const result = doctorHooks(repo, { env });
  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /changed after composition/);
});

test("uninstall refuses to overwrite a newer user template setting", () => {
  const env = isolatedEnv();
  installFutureHooks({ env, dispatcherSource: dispatcher(env) });
  const newer = join(env.HOME, "newer-template");
  git(env.HOME, ["config", "--global", "init.templateDir", newer], { env });
  assert.throws(() => uninstallFutureHooks({ env }), /refusing to overwrite/);
});

test("Husky pre-push keeps existing commands and gains the governance dispatcher", () => {
  const env = isolatedEnv();
  const repo = initGitRepo();
  mkdirSync(join(repo, ".husky"), { recursive: true });
  write(join(repo, ".husky", "pre-push"), "#!/bin/sh\nnpm test\n", 0o755);
  git(repo, ["config", "core.hooksPath", ".husky"]);
  const connected = connectEffectiveRepositoryHook(repo, { env });
  assert.equal(connected.mode, "husky");
  const contents = readFileSync(join(repo, ".husky", "pre-push"), "utf8");
  assert.match(contents, /npm test/);
  assert.match(contents, /stable-dispatcher/);
  const diagnosis = doctorHooks(repo, { env });
  assert.equal(diagnosis.issues.some((issue) => /core\.hooksPath/.test(issue)), false);
});

test("doctor detects a later hooksPath change that bypasses governance", () => {
  const env = isolatedEnv();
  const repo = initGitRepo();
  mkdirSync(join(repo, ".husky"), { recursive: true });
  write(join(repo, ".husky", "pre-push"), "#!/bin/sh\nnpm test\n", 0o755);
  git(repo, ["config", "core.hooksPath", ".husky"]);
  const result = doctorHooks(repo, { env });
  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /does not reach/);
});
