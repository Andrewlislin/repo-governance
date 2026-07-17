import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GovernanceError } from "./errors.mjs";
import { DIFF_FINGERPRINT_ALGORITHM } from "./fingerprint.mjs";
import { runtimeIdentity } from "./version.mjs";

export const CONFIG_FILE = ".repo-governance.json";

function expect(condition, message, details = {}) {
  if (!condition) {
    throw new GovernanceError(message, { code: "RG_CONFIG", details });
  }
}

export function validateConfig(config, { identity = runtimeIdentity(), enforceEngine = true } = {}) {
  expect(config && typeof config === "object" && !Array.isArray(config), "Governance configuration must be an object.");
  expect(config.schemaVersion === 1, "Unsupported schemaVersion; expected 1.");
  expect(typeof config.engineVersion === "string" && config.engineVersion.length > 0, "engineVersion is required.");
  expect(typeof config.engineCommitSha === "string" && config.engineCommitSha.length > 0, "engineCommitSha is required.");
  expect(config.engineCommitSha === "development" || /^[0-9a-f]{40}$/.test(config.engineCommitSha), "engineCommitSha must be development or a full 40-character commit SHA.");
  expect(config.diffFingerprintAlgorithm === DIFF_FINGERPRINT_ALGORITHM, `diffFingerprintAlgorithm must be ${DIFF_FINGERPRINT_ALGORITHM}.`);
  expect(typeof config.defaultBranch === "string" && config.defaultBranch.length > 0, "defaultBranch is required.");
  expect(config.testCategories && typeof config.testCategories === "object", "testCategories is required.");
  expect(Array.isArray(config.highImpactMappings), "highImpactMappings must be an array.");
  expect(config.testEntries === undefined || Array.isArray(config.testEntries), "testEntries must be an array of executable entries.");
  expect(config.testSupport === undefined || Array.isArray(config.testSupport), "testSupport must be an array of fixture/helper patterns.");
  if (config.testTiers !== undefined) {
    expect(config.testTiers && typeof config.testTiers === "object", "testTiers must be an object.");
    for (const tier of ["pr-blocking", "nightly", "manual-smoke"]) expect(Array.isArray(config.testTiers[tier]), `testTiers.${tier} must be an array.`);
  }
  expect(config.guards === undefined || Array.isArray(config.guards), "guards must be an array.");
  expect(config.policyChecks === undefined || Array.isArray(config.policyChecks), "policyChecks must be an array.");
  expect(config.workflowAllowedEntries === undefined || Array.isArray(config.workflowAllowedEntries), "workflowAllowedEntries must be an array.");
  expect(config.publicCommands === undefined || Array.isArray(config.publicCommands), "publicCommands must be an array.");
  for (const command of config.publicCommands || []) {
    expect(typeof command.id === "string" && typeof command.manifest === "string" && typeof command.command === "string", "Each public command needs id, manifest, and command.");
    expect(/^[0-9a-f]{64}$/.test(command.definitionHash || ""), `Public command ${command.id} needs a lowercase SHA-256 definitionHash.`);
    expect(typeof command.semantics === "string" && command.semantics.length > 0, `Public command ${command.id} needs semantics.`);
    expect(typeof command.tier === "string" && command.tier.length > 0, `Public command ${command.id} needs a test tier.`);
    for (const kind of ["contractTests", "docs", "workflows"]) expect(Array.isArray(command.consumers?.[kind]) && command.consumers[kind].length > 0, `Public command ${command.id} needs ${kind} consumers.`);
  }

  for (const [category, patterns] of Object.entries(config.testCategories)) {
    expect(Array.isArray(patterns) && patterns.every((item) => typeof item === "string" && item.length > 0), `Invalid paths for test category ${category}.`);
  }
  for (const mapping of config.highImpactMappings) {
    expect(Array.isArray(mapping.businessPaths) && mapping.businessPaths.length > 0, "Each high-impact mapping needs businessPaths.");
    expect(Array.isArray(mapping.requirements) && mapping.requirements.length > 0, "Each high-impact mapping needs requirements.");
    for (const requirement of mapping.requirements) {
      expect(Array.isArray(requirement.anyOf) && requirement.anyOf.length > 0, "Each mapping requirement needs an anyOf category list.");
      for (const category of requirement.anyOf) {
        expect(Object.hasOwn(config.testCategories, category), `Unknown test category in high-impact mapping: ${category}.`);
      }
    }
  }
  if (enforceEngine && identity.commitSha !== "development") {
    expect(
      config.engineVersion === identity.version && config.engineCommitSha === identity.commitSha,
      "Local CLI, hook, and configuration versions differ. Run repo-governance update before checking.",
      { configured: { version: config.engineVersion, commitSha: config.engineCommitSha }, runtime: identity },
    );
  }
  return config;
}

export function readConfig(repo, options) {
  const path = join(repo, CONFIG_FILE);
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new GovernanceError(`Unable to read ${CONFIG_FILE}: ${error.message}`, { code: "RG_CONFIG" });
  }
  return validateConfig(config, options);
}

export function writeConfig(repo, config) {
  validateConfig(config, { enforceEngine: false });
  writeFileSync(join(repo, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
}
