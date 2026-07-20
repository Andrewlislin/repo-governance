import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readConfig } from "./config.mjs";
import { GovernanceError } from "./errors.mjs";
import { governanceDataRoot } from "./paths.mjs";

const LOCK_TIMEOUT_MS = 2_000;

export function repositoryRegistryPath(env = process.env, platform = process.platform) {
  return join(governanceDataRoot(env, platform), "repositories.json");
}

function emptyRegistry() {
  return { schemaVersion: 1, revision: 0, repositories: [] };
}

function validateRegistry(registry, path) {
  if (registry?.schemaVersion !== 1 || !Number.isInteger(registry.revision) || !Array.isArray(registry.repositories)) {
    throw new GovernanceError("Repository registry is invalid.", { code: "RG_REPOSITORIES_INVALID", details: { path } });
  }
  for (const record of registry.repositories) {
    if (
      typeof record.path !== "string"
      || typeof record.realpath !== "string"
      || typeof record.engineVersion !== "string"
      || !/^[0-9a-f]{40}$/.test(record.engineCommitSha || "")
    ) {
      throw new GovernanceError("Repository registry contains an invalid record.", { code: "RG_REPOSITORIES_INVALID", details: { path } });
    }
  }
  return registry;
}

export function readRepositoryRegistry({ env = process.env, platform = process.platform } = {}) {
  const path = repositoryRegistryPath(env, platform);
  if (!existsSync(path)) return emptyRegistry();
  try {
    return validateRegistry(JSON.parse(readFileSync(path, "utf8")), path);
  } catch (error) {
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError(`Unable to read repository registry: ${error.message}`, {
      code: "RG_REPOSITORIES_READ",
      details: { path, causeCode: error.code || null },
    });
  }
}

function withRegistryLock(env, platform, operation) {
  const path = repositoryRegistryPath(env, platform);
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - started >= LOCK_TIMEOUT_MS) {
        throw new GovernanceError("Repository registry is locked by another process; retry after it finishes.", {
          code: "RG_REPOSITORIES_LOCKED",
          details: { lock },
        });
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    return operation(path);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function writeRegistry(path, registry, { failBeforeRename = false } = {}) {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { flag: "wx" });
    if (failBeforeRename) throw new GovernanceError("Injected repository registry write failure.", { code: "RG_REPOSITORIES_WRITE" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function registerRepository(path = process.cwd(), {
  env = process.env,
  platform = process.platform,
  now = () => new Date().toISOString(),
  failBeforeRename = false,
} = {}) {
  const canonicalPath = resolve(path);
  if (!existsSync(canonicalPath)) throw new GovernanceError("Repository path does not exist.", { code: "RG_REPOSITORIES_PATH", details: { path: canonicalPath } });
  const resolvedRealpath = realpathSync(canonicalPath);
  const config = readConfig(resolvedRealpath, { enforceEngine: false });
  if (!/^[0-9a-f]{40}$/.test(config.engineCommitSha)) {
    throw new GovernanceError("Repository registration requires a full locked engine commit SHA.", {
      code: "RG_REPOSITORIES_ENGINE",
      details: { path: canonicalPath, engineCommitSha: config.engineCommitSha },
    });
  }
  return withRegistryLock(env, platform, (registryPath) => {
    const registry = readRepositoryRegistry({ env, platform });
    const record = {
      path: canonicalPath,
      realpath: resolvedRealpath,
      engineVersion: config.engineVersion,
      engineCommitSha: config.engineCommitSha,
      registeredAt: now(),
    };
    const index = registry.repositories.findIndex((item) => item.path === canonicalPath || item.realpath === resolvedRealpath);
    if (index === -1) registry.repositories.push(record);
    else registry.repositories[index] = record;
    registry.repositories.sort((left, right) => left.path.localeCompare(right.path));
    registry.revision += 1;
    writeRegistry(registryPath, registry, { failBeforeRename });
    return {
      command: "repositories register",
      registered: true,
      repository: record,
      revision: registry.revision,
      message: `Registered ${canonicalPath} with engine ${config.engineCommitSha}.`,
    };
  });
}

export function unregisterRepository(path, { env = process.env, platform = process.platform, failBeforeRename = false } = {}) {
  if (!path) throw new GovernanceError("repositories unregister requires a path.", { code: "RG_INVOCATION" });
  const canonicalPath = resolve(path);
  const currentRealpath = existsSync(canonicalPath) ? realpathSync(canonicalPath) : null;
  return withRegistryLock(env, platform, (registryPath) => {
    const registry = readRepositoryRegistry({ env, platform });
    const before = registry.repositories.length;
    registry.repositories = registry.repositories.filter((record) => (
      record.path !== canonicalPath
      && record.realpath !== canonicalPath
      && (!currentRealpath || record.realpath !== currentRealpath)
    ));
    const removed = before - registry.repositories.length;
    if (removed > 0) {
      registry.revision += 1;
      writeRegistry(registryPath, registry, { failBeforeRename });
    }
    return {
      command: "repositories unregister",
      unregistered: removed > 0,
      path: canonicalPath,
      revision: registry.revision,
      message: removed > 0 ? `Unregistered ${canonicalPath}.` : `No repository registration matched ${canonicalPath}.`,
    };
  });
}

export function listRepositories({ env = process.env, platform = process.platform } = {}) {
  const registry = readRepositoryRegistry({ env, platform });
  return {
    command: "repositories list",
    revision: registry.revision,
    repositories: registry.repositories,
    message: `${registry.repositories.length} registered repositories.`,
  };
}
