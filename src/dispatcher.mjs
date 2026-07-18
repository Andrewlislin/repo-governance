#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { spawnSync } from "node:child_process";
import { governanceDataRoot } from "./paths.mjs";

function findRepository(start) {
  let current = start;
  while (true) {
    if (existsSync(join(current, ".repo-governance.json"))) return current;
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return null;
    current = parent;
  }
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function dispatch({ cwd = process.cwd(), argv = [], env = process.env, platform = process.platform } = {}) {
  const repo = findRepository(cwd);
  if (!repo) {
    return { exitCode: 2, message: "Repository is not initialized. Run repo-governance bootstrap --preset <preset> before the first push." };
  }
  const config = JSON.parse(readFileSync(join(repo, ".repo-governance.json"), "utf8"));
  const executableName = platform === "win32" ? "repo-governance.exe" : "repo-governance";
  const engineDirectory = join(governanceDataRoot(env, platform), "engines", config.engineCommitSha);
  const executable = join(engineDirectory, executableName);
  const manifestPath = join(engineDirectory, "engine-manifest.json");
  if (!existsSync(executable) || !existsSync(manifestPath)) {
    return { exitCode: 2, message: `Locked engine ${config.engineCommitSha} is not installed. Run repo-governance update before pushing.` };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.engineCommitSha !== config.engineCommitSha || manifest.engineVersion !== config.engineVersion || digest(executable) !== manifest.sha256) {
    return { exitCode: 2, message: "Locked engine manifest or checksum is invalid. Run repo-governance update before pushing." };
  }
  if (platform !== "win32" && (statSync(executable).mode & 0o111) === 0) {
    return { exitCode: 2, message: "Locked engine is not executable. Run repo-governance update before pushing." };
  }
  const forwarded = argv[0] === "pre-push" ? argv.slice(1) : argv;
  const result = spawnSync(executable, ["check", ...forwarded], { cwd: repo, env, stdio: "inherit" });
  return { exitCode: result.status ?? 2, message: result.error?.message };
}
