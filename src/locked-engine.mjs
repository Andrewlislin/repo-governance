import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GovernanceError } from "./errors.mjs";
import { governanceDataRoot } from "./paths.mjs";
import { runtimeIdentity } from "./version.mjs";

function publicError(code, message, details = {}) {
  return { code, message, details };
}

export function lockedRuntimePaths(identity, env = process.env, platform = process.platform) {
  const dataRoot = governanceDataRoot(env, platform);
  const engineDirectory = join(dataRoot, "engines", identity.commitSha);
  return {
    executable: join(engineDirectory, platform === "win32" ? "repo-governance.exe" : "repo-governance"),
    manifest: join(engineDirectory, "engine-manifest.json"),
    dispatcher: join(dataRoot, platform === "win32" ? "dispatcher.exe" : "dispatcher"),
  };
}

export function inspectLockedRuntime(configuredIdentity, {
  env = process.env,
  runningIdentity = runtimeIdentity(),
  platform = process.platform,
} = {}) {
  if (runningIdentity.commitSha === "development") {
    return {
      aligned: null,
      error: publicError(
        "RG_ENGINE_UNVERIFIED",
        "A development runtime cannot verify the repository's published engine identity. Run preflight with the installed version-locked engine.",
        { configured: configuredIdentity, runtime: runningIdentity },
      ),
    };
  }
  if (
    configuredIdentity.engineVersion !== runningIdentity.version
    || configuredIdentity.engineCommitSha !== runningIdentity.commitSha
  ) {
    return {
      aligned: false,
      error: publicError(
        "RG_ENGINE_MISMATCH",
        "Running and configured repo-governance engine identities differ. Run repo-governance update with a verified bundle before continuing.",
        { configured: configuredIdentity, runtime: runningIdentity },
      ),
    };
  }
  const paths = lockedRuntimePaths(runningIdentity, env, platform);
  if (!existsSync(paths.executable) || !existsSync(paths.manifest) || !existsSync(paths.dispatcher)) {
    return {
      aligned: false,
      error: publicError(
        "RG_ENGINE_NOT_INSTALLED",
        "The locked engine or stable dispatcher is not installed; install a verified repo-governance release before continuing.",
        paths,
      ),
    };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        aligned: false,
        error: publicError("RG_ENGINE_MANIFEST_INVALID", "The installed engine manifest is invalid JSON.", { manifest: paths.manifest }),
      };
    }
    throw new GovernanceError(`Unable to read the installed engine manifest: ${error.message}`, {
      code: "RG_ENGINE_MANIFEST_READ",
      details: { manifest: paths.manifest, causeCode: error.code || null },
    });
  }
  if (
    manifest.engineCommitSha !== runningIdentity.commitSha
    || manifest.engineVersion !== runningIdentity.version
  ) {
    return {
      aligned: false,
      error: publicError(
        "RG_ENGINE_MISMATCH",
        "Installed engine manifest does not match the running repo-governance engine.",
        { configured: configuredIdentity, runtime: runningIdentity, installed: manifest },
      ),
    };
  }
  return { aligned: true, error: null, paths };
}

export function assertLockedRuntime(identity, env = process.env, platform = process.platform) {
  if (!/^[0-9a-f]{40}$/.test(identity.commitSha)) {
    throw new GovernanceError("Bootstrap requires a release or source build locked to a full engine commit SHA.", { code: "RG_ENGINE_UNPINNED" });
  }
  const inspected = inspectLockedRuntime(
    { engineVersion: identity.version, engineCommitSha: identity.commitSha },
    { env, runningIdentity: identity, platform },
  );
  if (inspected.aligned !== true) {
    throw new GovernanceError(inspected.error.message, {
      code: inspected.error.code,
      details: inspected.error.details,
    });
  }
  return inspected.paths;
}
