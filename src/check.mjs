import { readConfig } from "./config.mjs";
import { changedPaths, resolveCanonicalBase } from "./git.mjs";
import { evaluateRg001 } from "./rg001.mjs";
import { applyLocalWaivers } from "./waiver.mjs";

export function checkRepository(repo, { base, head = "HEAD", now } = {}) {
  const config = readConfig(repo);
  const baseRef = base || config.defaultBranch;
  const endpoints = resolveCanonicalBase(repo, baseRef, head);
  const changed = changedPaths(repo, endpoints.canonicalBaseSha, endpoints.headSha);
  const rg001 = evaluateRg001(config, changed);
  const waived = applyLocalWaivers(repo, rg001.findings, endpoints.canonicalBaseSha, endpoints.headSha, now);
  return {
    schemaVersion: 1,
    ok: waived.findings.length === 0,
    exitCode: waived.findings.length === 0 ? 0 : 1,
    endpoints,
    changedPaths: changed,
    findings: waived.findings,
    satisfied: rg001.satisfied,
    acceptedWaivers: waived.accepted,
    capabilityBoundary: "RG001 verifies mapped companion categories and change evidence only. It does not prove assertion quality, semantic coverage, or business correctness.",
  };
}
