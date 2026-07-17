import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { GovernanceError } from "./errors.mjs";
import { diffFingerprint } from "./fingerprint.mjs";

const WAIVER_DIRECTORY = ".repo-governance/waivers";
const ALLOWED_FIELDS = new Set(["baseSha", "rule", "businessPaths", "reason", "expiresAt", "diffFingerprint"]);

export function validateWaiverShape(waiver, filename = "waiver") {
  const keys = Object.keys(waiver);
  if (keys.some((key) => !ALLOWED_FIELDS.has(key))) {
    throw new GovernanceError(`${filename} contains forbidden waiver fields. headSha, approver, and approval state must come from live GitHub data.`, {
      code: "RG005_WAIVER_SCHEMA",
      details: { fields: keys.filter((key) => !ALLOWED_FIELDS.has(key)) },
    });
  }
  if (waiver.rule !== "RG001") throw new GovernanceError("Only RG001 can be waived.", { code: "RG005_WAIVER_SCHEMA" });
  if (typeof waiver.baseSha !== "string" || !/^[0-9a-f]{40,64}$/.test(waiver.baseSha)) throw new GovernanceError("Waiver baseSha must be a full object ID.", { code: "RG005_WAIVER_SCHEMA" });
  if (!Array.isArray(waiver.businessPaths) || waiver.businessPaths.length === 0 || !waiver.businessPaths.every((path) => typeof path === "string")) throw new GovernanceError("Waiver businessPaths must be a non-empty string array.", { code: "RG005_WAIVER_SCHEMA" });
  if (typeof waiver.reason !== "string" || waiver.reason.trim().length < 10) throw new GovernanceError("Waiver reason must contain at least 10 characters.", { code: "RG005_WAIVER_SCHEMA" });
  if (Number.isNaN(Date.parse(waiver.expiresAt))) throw new GovernanceError("Waiver expiresAt must be an ISO date.", { code: "RG005_WAIVER_SCHEMA" });
  if (!/^[0-9a-f]{64}$/.test(waiver.diffFingerprint || "")) throw new GovernanceError("Waiver diffFingerprint must be a lowercase SHA-256 value.", { code: "RG005_WAIVER_SCHEMA" });
  return waiver;
}

export function loadWaivers(repo) {
  const directory = join(repo, WAIVER_DIRECTORY);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const path = join(directory, name);
      return { filename: name, waiver: validateWaiverShape(JSON.parse(readFileSync(path, "utf8")), name) };
    });
}

export function applyLocalWaivers(repo, findings, canonicalBaseSha, headSha, now = new Date()) {
  if (findings.length === 0) return { findings, accepted: [] };
  const fingerprint = diffFingerprint(repo, canonicalBaseSha, headSha);
  const accepted = [];
  const remaining = [];
  const auditFindings = [];
  const waivers = loadWaivers(repo);
  for (const finding of findings) {
    const candidate = waivers.find(({ waiver }) => finding.businessPaths.some((path) => waiver.businessPaths.includes(path)));
    if (candidate) {
      const reasons = [];
      if (candidate.waiver.baseSha !== canonicalBaseSha) reasons.push("declared baseSha does not equal the independently computed canonical base");
      if (candidate.waiver.diffFingerprint !== fingerprint) reasons.push("business diff fingerprint does not match");
      if (Date.parse(candidate.waiver.expiresAt) <= now.getTime()) reasons.push("waiver is expired");
      if (!finding.businessPaths.every((path) => candidate.waiver.businessPaths.includes(path))) reasons.push("business path scope expanded beyond the waiver");
      if (reasons.length > 0) {
        auditFindings.push({
          rule: "RG005",
          businessPaths: finding.businessPaths,
          waiver: candidate.filename,
          message: `Waiver validation failed: ${reasons.join("; ")}.`,
          waivable: false,
        });
        remaining.push(finding);
        continue;
      }
    }
    const matching = candidate;
    if (matching) {
      accepted.push({
        ...finding,
        waivedBy: matching.filename,
        remoteApproval: "pending-current-head-review",
        message: "Local waiver structure, canonical base, path scope, expiry, and business diff fingerprint are valid; current-head GitHub approval is still required.",
      });
    } else {
      remaining.push(finding);
    }
  }
  return { findings: [...auditFindings, ...remaining], accepted };
}

export function createWaiver(repo, { name, rule = "RG001", businessPaths, reason, expiresAt, canonicalBaseSha, headSha }) {
  const waiver = validateWaiverShape({
    baseSha: canonicalBaseSha,
    rule,
    businessPaths,
    reason,
    expiresAt,
    diffFingerprint: diffFingerprint(repo, canonicalBaseSha, headSha),
  });
  const safeName = basename(name).replace(/[^a-zA-Z0-9._-]/g, "-");
  const directory = join(repo, WAIVER_DIRECTORY);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, safeName.endsWith(".json") ? safeName : `${safeName}.json`);
  writeFileSync(path, `${JSON.stringify(waiver, null, 2)}\n`, { flag: "wx" });
  return path;
}
