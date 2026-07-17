import { readConfig } from "./config.mjs";
import { changedPaths, resolveCanonicalBase } from "./git.mjs";
import { evaluateRg001 } from "./rg001.mjs";
import { applyLocalWaivers } from "./waiver.mjs";
import { evaluateRg002 } from "./rg002.mjs";
import { evaluateRg003 } from "./rg003.mjs";

export function checkRepository(repo, { base, head = "HEAD", now } = {}) {
  const config = readConfig(repo);
  const baseRef = base || config.defaultBranch;
  const endpoints = resolveCanonicalBase(repo, baseRef, head);
  const changed = changedPaths(repo, endpoints.canonicalBaseSha, endpoints.headSha);
  const rg001 = evaluateRg001(config, changed);
  const waived = applyLocalWaivers(repo, rg001.findings, endpoints.canonicalBaseSha, endpoints.headSha, now);
  const rg002 = evaluateRg002(repo, config);
  const rg003 = evaluateRg003(repo, config);
  const findings = [...waived.findings, ...rg002.findings, ...rg003.findings];
  return {
    schemaVersion: 1,
    ok: findings.length === 0,
    exitCode: findings.length === 0 ? 0 : 1,
    endpoints,
    changedPaths: changed,
    findings,
    satisfied: rg001.satisfied,
    acceptedWaivers: waived.accepted,
    testCommandGraph: rg002.reachable,
    capabilityBoundary: "RG001 verifies mapped companion categories and change evidence only. It does not prove assertion quality, semantic coverage, or business correctness.",
  };
}
