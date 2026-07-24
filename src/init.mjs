import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GovernanceError } from "./errors.mjs";
import { writeConfig } from "./config.mjs";
import { DIFF_FINGERPRINT_ALGORITHM } from "./fingerprint.mjs";
import { runtimeIdentity } from "./version.mjs";
import { commandDefinitionHash } from "./rg004.mjs";
import { THIN_WORKFLOW_PATH, writeThinWorkflow } from "./workflow.mjs";
import { governanceOnlyExecutionContract } from "./execution-contract.mjs";

export function detectCandidates(repo) {
  const candidates = { ecosystems: [], manifests: [], commands: [] };
  const packagePath = join(repo, "package.json");
  if (existsSync(packagePath)) {
    const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
    candidates.ecosystems.push(existsSync(join(repo, "bun.lock")) || existsSync(join(repo, "bun.lockb")) ? "bun" : "node");
    candidates.manifests.push("package.json");
    for (const command of ["test", "check:static", "tauri:build"]) {
      if (manifest.scripts?.[command]) candidates.commands.push({ manifest: "package.json", command, definition: manifest.scripts[command], definitionHash: commandDefinitionHash(manifest.scripts[command]) });
    }
  }
  if (existsSync(join(repo, "pnpm-workspace.yaml"))) candidates.ecosystems.push("pnpm-workspace");
  if (existsSync(join(repo, "pyproject.toml")) || existsSync(join(repo, "pytest.ini"))) {
    candidates.ecosystems.push("python");
    if (existsSync(join(repo, "pyproject.toml"))) candidates.manifests.push("pyproject.toml");
  }
  return candidates;
}

export function initializeRepository(repo, { accept = false, defaultBranch = "main" } = {}) {
  const candidates = detectCandidates(repo);
  if (!accept) {
    return { written: false, candidates, message: "Review candidates, then rerun with --accept. No strict configuration was written." };
  }
  if (existsSync(join(repo, ".repo-governance.json"))) throw new GovernanceError("Repository is already initialized.", { code: "RG_CONFIG" });
  const identity = runtimeIdentity();
  const config = {
    schemaVersion: 1,
    executionContractVersion: 1,
    governanceCompleteness: "complete",
    ...governanceOnlyExecutionContract(),
    engineVersion: identity.version,
    engineCommitSha: identity.commitSha,
    diffFingerprintAlgorithm: DIFF_FINGERPRINT_ALGORITHM,
    defaultBranch,
    testCategories: {},
    highImpactMappings: [],
    testEntries: [],
    testSupport: [],
    testTiers: { "pr-blocking": [], nightly: [], "manual-smoke": [] },
    commandAliases: {},
    publicCommands: [],
    guards: [],
    policyChecks: [],
    workflowAllowedEntries: [],
    waiverApprovers: [],
    managedFiles: [".repo-governance.json", THIN_WORKFLOW_PATH],
  };
  writeConfig(repo, config);
  const workflow = writeThinWorkflow(repo, identity);
  return { written: true, candidates, config, workflow };
}
