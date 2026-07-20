import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { GovernanceError } from "./errors.mjs";
import { readDefaultEngine } from "./launcher-install.mjs";
import { governanceDataRoot } from "./paths.mjs";
import { readRepositoryRegistry } from "./repositories.mjs";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function semverParts(value) {
  const match = String(value).match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(left, right) {
  const a = semverParts(left);
  const b = semverParts(right);
  if (!a || !b) return String(left).localeCompare(String(right));
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function directorySize(path) {
  if (!existsSync(path)) return 0;
  const stat = lstatSync(path);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((total, name) => total + directorySize(join(path, name)), 0);
}

function inspectEngine(directory, sha, platform) {
  const executable = join(directory, platform === "win32" ? "repo-governance.exe" : "repo-governance");
  const manifestPath = join(directory, "engine-manifest.json");
  const base = { engineCommitSha: sha, directory, sizeBytes: null };
  try {
    base.sizeBytes = directorySize(directory);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const installedAt = Date.parse(manifest.installedAt || "");
    if (
      manifest.engineCommitSha !== sha
      || typeof manifest.engineVersion !== "string"
      || !semverParts(manifest.engineVersion)
      || !Number.isFinite(installedAt)
      || !existsSync(executable)
      || sha256(executable) !== manifest.sha256
    ) {
      return { ...base, status: "unknown", engineVersion: manifest.engineVersion || null, installedAt: manifest.installedAt || null };
    }
    return { ...base, status: "available", engineVersion: manifest.engineVersion, installedAt: manifest.installedAt };
  } catch {
    return { ...base, status: "unknown", engineVersion: null, installedAt: null };
  }
}

export function listEngines({ env = process.env, platform = process.platform } = {}) {
  const dataRoot = governanceDataRoot(env, platform);
  const enginesRoot = join(dataRoot, "engines");
  const engines = existsSync(enginesRoot)
    ? readdirSync(enginesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => inspectEngine(join(enginesRoot, entry.name), entry.name, platform))
    : [];
  engines.sort((left, right) => {
    if (left.status !== right.status) return left.status === "available" ? -1 : 1;
    const time = Date.parse(right.installedAt || "") - Date.parse(left.installedAt || "");
    if (time) return time;
    const version = compareVersions(right.engineVersion, left.engineVersion);
    return version || right.engineCommitSha.localeCompare(left.engineCommitSha);
  });
  let defaultEngine = null;
  let defaultStatus = "missing";
  try {
    defaultEngine = readDefaultEngine({ env, platform });
    if (defaultEngine) defaultStatus = "valid";
  } catch {
    defaultStatus = "invalid";
  }
  return {
    command: "engines list",
    defaultEngine,
    defaultStatus,
    engines,
    message: `${engines.length} installed engines; default pointer is ${defaultStatus}.`,
  };
}

function prunePlan(options) {
  const { env = process.env, platform = process.platform } = options;
  const listing = listEngines({ env, platform });
  const registry = readRepositoryRegistry({ env, platform });
  const references = new Set(registry.repositories.map((record) => record.engineCommitSha));
  const reasons = new Map(listing.engines.map((engine) => [engine.engineCommitSha, new Set()]));
  if (listing.defaultStatus !== "valid") {
    for (const engine of listing.engines) reasons.get(engine.engineCommitSha).add("default_pointer_uncertain");
  } else {
    reasons.get(listing.defaultEngine.engineCommitSha)?.add("default_engine");
  }
  for (const engine of listing.engines) {
    if (engine.status === "unknown") reasons.get(engine.engineCommitSha).add("unknown_metadata");
    if (references.has(engine.engineCommitSha)) reasons.get(engine.engineCommitSha).add("registered_repository_reference");
  }
  const available = listing.engines.filter((engine) => engine.status === "available");
  if (available[0]) reasons.get(available[0].engineCommitSha).add("latest_installed");
  if (available[1]) reasons.get(available[1].engineCommitSha).add("historical_retention");
  const evaluated = listing.engines.map((engine) => ({
    ...engine,
    protectedReasons: [...reasons.get(engine.engineCommitSha)].sort(),
  }));
  const willDelete = evaluated.filter((engine) => engine.protectedReasons.length === 0);
  return {
    listing,
    registryRevision: registry.revision,
    evaluated,
    willDelete,
    estimatedBytes: willDelete.reduce((total, engine) => total + (engine.sizeBytes || 0), 0),
  };
}

export function pruneEngines({
  env = process.env,
  platform = process.platform,
  confirm = false,
  failBeforeDelete = false,
} = {}) {
  const plan = prunePlan({ env, platform });
  if (confirm && !failBeforeDelete) {
    for (const engine of plan.willDelete) {
      if (!/^[0-9a-f]{40}$/.test(engine.engineCommitSha)) {
        throw new GovernanceError("Refusing to prune an engine directory without a full commit SHA name.", { code: "RG_ENGINES_PRUNE" });
      }
      rmSync(engine.directory, { recursive: true, force: true });
    }
  }
  if (failBeforeDelete) throw new GovernanceError("Injected engine prune failure.", { code: "RG_ENGINES_PRUNE" });
  const mode = confirm ? "confirm" : "dry-run";
  return {
    command: "engines prune",
    mode,
    registryRevision: plan.registryRevision,
    engines: plan.evaluated,
    willDelete: plan.willDelete.map((engine) => ({
      engineVersion: engine.engineVersion,
      engineCommitSha: engine.engineCommitSha,
      sizeBytes: engine.sizeBytes,
    })),
    deleted: confirm ? plan.willDelete.map((engine) => engine.engineCommitSha) : [],
    estimatedBytes: plan.estimatedBytes,
    boundary: "No registered repository reference does not prove that no unregistered repository on this computer uses an engine.",
    message: confirm
      ? `Pruned ${plan.willDelete.length} engines and released approximately ${plan.estimatedBytes} bytes.`
      : `Dry run would prune ${plan.willDelete.length} engines and release approximately ${plan.estimatedBytes} bytes.`,
  };
}
