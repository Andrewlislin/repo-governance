import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { matchesAny } from "./glob.mjs";
import { runGit } from "./process.mjs";

const COMMAND_DOMAIN = "repo-governance:command-contract:v1\0";

export function commandDefinitionHash(definition) {
  return createHash("sha256").update(COMMAND_DOMAIN).update(definition).digest("hex");
}

function manifestAt(repo, manifest, revision) {
  if (!revision) {
    const path = join(repo, manifest);
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  }
  const result = runGit(["show", `${revision}:${manifest}`], { cwd: repo, allowFailure: true });
  return result.status === 0 ? JSON.parse(result.stdout) : null;
}

function configAt(repo, revision) {
  const result = runGit(["show", `${revision}:.repo-governance.json`], { cwd: repo, allowFailure: true });
  return result.status === 0 ? JSON.parse(result.stdout) : { publicCommands: [] };
}

function changedEvidence(changed, patterns) {
  return (patterns || []).filter((pattern) => changed.some((path) => matchesAny(path, [pattern])));
}

export function evaluateRg004(repo, config, changed, canonicalBaseSha) {
  const findings = [];
  const previousConfig = configAt(repo, canonicalBaseSha);
  for (const contract of config.publicCommands || []) {
    const currentManifest = manifestAt(repo, contract.manifest);
    const currentDefinition = currentManifest?.scripts?.[contract.command];
    if (typeof currentDefinition !== "string") {
      findings.push({ rule: "RG004", command: contract.id, message: "Public command is missing from its declared manifest.", waivable: false });
      continue;
    }
    const actualHash = commandDefinitionHash(currentDefinition);
    if (actualHash !== contract.definitionHash) {
      findings.push({ rule: "RG004", command: contract.id, expectedHash: contract.definitionHash, actualHash, message: "Public command text changed without accepting a new command contract.", waivable: false });
      continue;
    }
    const previousManifest = manifestAt(repo, contract.manifest, canonicalBaseSha);
    const previousDefinition = previousManifest?.scripts?.[contract.command];
    const previousContract = (previousConfig.publicCommands || []).find((entry) => entry.id === contract.id);
    const definitionChanged = previousDefinition !== currentDefinition;
    const contractChanged = !previousContract
      || previousContract.definitionHash !== contract.definitionHash
      || previousContract.semantics !== contract.semantics
      || previousContract.tier !== contract.tier;
    if (!definitionChanged && !contractChanged) continue;

    const missing = [];
    if (!changed.includes(".repo-governance.json")) missing.push("contract configuration");
    for (const [kind, patterns] of Object.entries({
      contractTests: contract.consumers?.contractTests,
      docs: contract.consumers?.docs,
      workflows: contract.consumers?.workflows,
    })) {
      if (changedEvidence(changed, patterns).length === 0) missing.push(kind);
    }
    if (missing.length > 0) {
      findings.push({
        rule: "RG004",
        command: contract.id,
        missingConsumers: missing,
        message: `Accepted public command semantics were not synchronized with: ${missing.join(", ")}.`,
        waivable: false,
      });
    }
  }
  return { findings };
}
