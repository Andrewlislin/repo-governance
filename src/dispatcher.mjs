#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { spawnSync } from "node:child_process";
import { governanceDataRoot } from "./paths.mjs";
import { readDefaultEngine, writeDefaultEngine } from "./launcher-install.mjs";
import { PRE_PUSH_PROTOCOL_VERSION, supportsExecutionContract } from "./protocol.mjs";

function findRepository(start) {
  let current = start;
  while (true) {
    if (existsSync(join(current, ".repo-governance.json"))) return current;
    if (existsSync(join(current, ".git"))) return null;
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return null;
    current = parent;
  }
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function engineExecutable(identity, env, platform, executionContractVersion = null) {
  const executableName = platform === "win32" ? "repo-governance.exe" : "repo-governance";
  const engineDirectory = join(governanceDataRoot(env, platform), "engines", identity.engineCommitSha);
  const executable = join(engineDirectory, executableName);
  const manifestPath = join(engineDirectory, "engine-manifest.json");
  if (!existsSync(executable) || !existsSync(manifestPath)) {
    throw new Error(`Engine ${identity.engineCommitSha} is not installed. Run repo-governance update from a verified bundle.`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("Engine manifest is invalid JSON; refusing to select another engine.");
  }
  if (manifest.engineCommitSha !== identity.engineCommitSha || manifest.engineVersion !== identity.engineVersion || digest(executable) !== manifest.sha256) {
    throw new Error("Engine manifest or checksum is invalid; refusing to select another engine.");
  }
  if (executionContractVersion !== null && !supportsExecutionContract(manifest, executionContractVersion)) {
    throw new Error(
      `Engine pre-push protocol is incompatible: protocol ${manifest.prePushProtocolVersion ?? "missing"} `
      + `(minimum ${PRE_PUSH_PROTOCOL_VERSION}) does not support execution contract ${executionContractVersion}.`,
    );
  }
  if (platform !== "win32" && (statSync(executable).mode & 0o111) === 0) {
    throw new Error("Selected engine is not executable.");
  }
  return executable;
}

function repositoryIdentity(repo, { requireExecutionContract = false } = {}) {
  try {
    const config = JSON.parse(readFileSync(join(repo, ".repo-governance.json"), "utf8"));
    if (typeof config.engineVersion !== "string" || !/^[0-9a-f]{40}$/.test(config.engineCommitSha || "")) {
      throw new Error("missing engine identity");
    }
    if (requireExecutionContract && !Number.isInteger(config.executionContractVersion)) {
      throw new Error("missing executionContractVersion");
    }
    return {
      engineVersion: config.engineVersion,
      engineCommitSha: config.engineCommitSha,
      executionContractVersion: config.executionContractVersion ?? null,
    };
  } catch (error) {
    throw new Error(`Repository governance configuration is invalid (${error.message}); refusing to use the default engine.`);
  }
}

function usesDefaultEngine(argv, repo) {
  const [command] = argv;
  if (["engines", "repositories"].includes(command)) return true;
  if (command === "version") return true;
  return !repo && command !== "check";
}

export function dispatch({ cwd = process.cwd(), argv = [], env = process.env, platform = process.platform, spawn = spawnSync } = {}) {
  try {
    const repo = findRepository(cwd);
    const prePush = argv[0] === "pre-push";
    if (prePush && !repo) {
      throw new Error("Repository is not initialized. Run repo-governance bootstrap --preset <preset> from a Git repository before pushing.");
    }
    const forwarded = prePush ? ["verify-execution", "--pre-push", ...argv.slice(1)] : argv;
    let identity;
    if (usesDefaultEngine(forwarded, repo)) {
      identity = readDefaultEngine({ env, platform });
      if (!identity) throw new Error("No default engine is configured. Install a verified repo-governance release first.");
    } else if (repo) {
      identity = repositoryIdentity(repo, { requireExecutionContract: prePush });
    } else {
      throw new Error("Repository is not initialized. Run repo-governance bootstrap --preset <preset> from a Git repository, or use repo-governance new/clone.");
    }
    const executable = engineExecutable(identity, env, platform, prePush ? identity.executionContractVersion : null);
    const result = spawn(executable, forwarded, { cwd, env, stdio: "inherit" });
    if (result.error) return { exitCode: 2, message: result.error.message };
    if (result.status === 0 && forwarded[0] === "update" && repo) {
      const updated = repositoryIdentity(repo);
      engineExecutable(updated, env, platform);
      writeDefaultEngine(updated, { env, platform });
    }
    return { exitCode: result.status ?? (result.signal ? 128 : 2), signal: result.signal || null };
  } catch (error) {
    return { exitCode: 2, message: error.message };
  }
}
