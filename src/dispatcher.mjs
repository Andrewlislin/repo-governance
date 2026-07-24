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

function findGitRepository(start) {
  let current = start;
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return null;
    current = parent;
  }
}

function gitExecutable(platform = process.platform) {
  if (platform !== "win32" && existsSync("/usr/bin/git")) return "/usr/bin/git";
  return "git";
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

function candidateIdentity(repo, commitSha, env, gitSpawn, platform) {
  const shown = gitSpawn(gitExecutable(platform), ["show", `${commitSha}:.repo-governance.json`], {
    cwd: repo,
    env: { ...env, GIT_OPTIONAL_LOCKS: "0" },
    encoding: "utf8",
  });
  if (shown.status !== 0) throw new Error(`Candidate commit ${commitSha} has no readable .repo-governance.json.`);
  try {
    const config = JSON.parse(shown.stdout);
    if (typeof config.engineVersion !== "string" || !/^[0-9a-f]{40}$/.test(config.engineCommitSha || "")) {
      throw new Error("missing engine identity");
    }
    if (!Number.isInteger(config.executionContractVersion)) throw new Error("missing executionContractVersion");
    return {
      engineVersion: config.engineVersion,
      engineCommitSha: config.engineCommitSha,
      executionContractVersion: config.executionContractVersion,
    };
  } catch (error) {
    throw new Error(`Candidate governance configuration is invalid (${error.message}); refusing fallback.`);
  }
}

function prePushGroups(repo, input, env, gitSpawn, platform) {
  const groups = new Map();
  for (const line of input.split(/\r?\n/).filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) throw new Error("Invalid pre-push stdin record; expected four fields.");
    const localSha = fields[1];
    if (!/^[0-9a-f]{40}$/.test(localSha)) throw new Error("Invalid pre-push local object SHA.");
    if (localSha === "0".repeat(40)) continue;
    const peeled = gitSpawn(gitExecutable(platform), ["rev-parse", "--verify", `${localSha}^{commit}`], {
      cwd: repo,
      env: { ...env, GIT_OPTIONAL_LOCKS: "0" },
      encoding: "utf8",
    });
    if (peeled.status !== 0) throw new Error(`Pushed object ${localSha} cannot be peeled to a commit.`);
    const identity = candidateIdentity(repo, peeled.stdout.trim(), env, gitSpawn, platform);
    const key = `${identity.engineVersion}\0${identity.engineCommitSha}\0${identity.executionContractVersion}`;
    const group = groups.get(key) || { identity, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function usesDefaultEngine(argv, repo) {
  const [command] = argv;
  if (["engines", "repositories"].includes(command)) return true;
  if (command === "version") return true;
  return !repo && command !== "check";
}

export function dispatch({
  cwd = process.cwd(),
  argv = [],
  env = process.env,
  platform = process.platform,
  spawn = spawnSync,
  gitSpawn = spawnSync,
  stdin,
} = {}) {
  try {
    const prePush = argv[0] === "pre-push";
    const repo = prePush ? findGitRepository(cwd) : findRepository(cwd);
    if (prePush && !repo) {
      throw new Error("Repository is not initialized. Run repo-governance bootstrap --preset <preset> from a Git repository before pushing.");
    }
    if (prePush && !existsSync(join(repo, ".repo-governance.json")) && argv.length < 3) {
      throw new Error("Repository is not initialized. Run repo-governance bootstrap --preset <preset> from a Git repository before pushing.");
    }
    if (prePush) {
      const [remote, remoteUrl] = argv.slice(1);
      if (!remote || !remoteUrl) throw new Error("Pre-push requires the Git remote name and URL.");
      const input = stdin ?? readFileSync(0, "utf8");
      for (const group of prePushGroups(repo, input, env, gitSpawn, platform)) {
        const executable = engineExecutable(group.identity, env, platform, group.identity.executionContractVersion);
        const result = spawn(executable, [
          "verify-execution",
          "--pre-push=true",
          "--remote", remote,
          "--remote-url", remoteUrl,
        ], {
          cwd,
          env,
          input: `${group.lines.join("\n")}\n`,
          stdio: ["pipe", "inherit", "inherit"],
        });
        if (result.error) return { exitCode: 2, message: result.error.message };
        if (result.status !== 0) return { exitCode: result.status ?? (result.signal ? 128 : 2), signal: result.signal || null };
      }
      return { exitCode: 0, signal: null };
    }
    const forwarded = argv;
    let identity;
    if (usesDefaultEngine(forwarded, repo)) {
      identity = readDefaultEngine({ env, platform });
      if (!identity) throw new Error("No default engine is configured. Install a verified repo-governance release first.");
    } else if (repo) {
      identity = repositoryIdentity(repo);
    } else {
      throw new Error("Repository is not initialized. Run repo-governance bootstrap --preset <preset> from a Git repository, or use repo-governance new/clone.");
    }
    const executable = engineExecutable(identity, env, platform);
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
