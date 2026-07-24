import { createHash } from "node:crypto";

const HASH_PREFIX = "repo-governance:dependency-preparation:v1\0";

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort(compareUtf8).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function dependencyPreparationDefinition(runtime, preparation) {
  return {
    resolvedRuntime: runtime,
    adapter: preparation.adapter,
    workingDirectory: preparation.workingDirectory,
    env: preparation.env,
    lifecycleScripts: preparation.lifecycleScripts,
    hookArgv: preparation.hookArgv,
    ciArgv: preparation.ciArgv,
  };
}

export function dependencyPreparationDefinitionHash(runtime, preparation) {
  const serialized = canonicalJson(dependencyPreparationDefinition(runtime, preparation));
  return createHash("sha256").update(HASH_PREFIX, "utf8").update(serialized, "utf8").digest("hex");
}

export function governanceOnlyExecutionContract() {
  const runtime = {
    id: "system-git",
    systemTools: [
      { name: "git", version: "2.x" },
      { name: "sh", version: "posix" },
    ],
  };
  const dependencyPreparation = {
    id: "none",
    semantics: "No repository dependencies are prepared for a governance-only repository.",
    adapter: "none",
    workingDirectory: ".",
    env: {},
    lifecycleScripts: { mode: "forbid", allowlist: [] },
    hookArgv: [],
    ciArgv: [],
    consumers: {
      contractTests: ["tests/**"],
      docs: ["README.md"],
      workflows: [".github/workflows/**"],
    },
  };
  dependencyPreparation.definitionHash = dependencyPreparationDefinitionHash(runtime, dependencyPreparation);
  return {
    runtimes: [runtime],
    executionProfiles: [{
      id: "pr-validation",
      tier: "pr-blocking",
      runtimeId: runtime.id,
      entry: {
        publicCommand: "governance-only",
        argv: ["git", "status", "--porcelain=v1"],
      },
      requiredStages: [
        { id: "dependencies", commands: [`dependency:${dependencyPreparation.id}`] },
        { id: "validate", commands: ["system:git-status"] },
      ],
      dependencyPreparation,
      consumers: [{ type: "pre-push", revisionSource: "pushed-ref-tip" }],
    }],
  };
}
