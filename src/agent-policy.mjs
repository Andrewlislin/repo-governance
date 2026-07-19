import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import policySchema from "../schemas/agent-policy.schema.json" with { type: "json" };
import { GovernanceError } from "./errors.mjs";
import { loadPreset } from "./presets.mjs";

export const AGENT_POLICY_FILE = ".repo-governance-agent.json";
export const DEFAULT_AGENT_POLICY = Object.freeze({
  source: "built-in-defaults",
  autoPreflight: true,
  autoBootstrap: false,
  matchedPathPrefix: null,
  preset: null,
});

function fail(message, details = {}) {
  throw new GovernanceError(message, { code: "RG_AGENT_POLICY", details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} must contain exactly: ${wanted.join(", ")}.`, { actual });
  }
}

function validatePolicy(policy) {
  exactKeys(policy, policySchema.required, "Agent policy");
  if (policy.schemaVersion !== 1) fail("Agent policy schemaVersion must be 1.");
  if (typeof policy.autoPreflight !== "boolean") fail("Agent policy autoPreflight must be boolean.");
  if (typeof policy.autoBootstrap !== "boolean") fail("Agent policy autoBootstrap must be boolean.");
  if (!Array.isArray(policy.defaultPresetByPath)) fail("Agent policy defaultPresetByPath must be an array.");
  if (policy.autoBootstrap && !policy.autoPreflight) fail("autoBootstrap requires autoPreflight: true.");
  if (policy.autoBootstrap && policy.defaultPresetByPath.length === 0) fail("autoBootstrap requires at least one explicit path preset.");

  return policy.defaultPresetByPath.map((entry, index) => {
    exactKeys(entry, ["pathPrefix", "preset"], `Agent policy path entry ${index}`);
    if (typeof entry.pathPrefix !== "string" || !isAbsolute(entry.pathPrefix)) {
      fail(`Agent policy path entry ${index} needs an absolute pathPrefix.`, { pathPrefix: entry.pathPrefix });
    }
    if (typeof entry.preset !== "string" || !/^[a-z][a-z0-9-]+$/.test(entry.preset)) {
      fail(`Agent policy path entry ${index} has an invalid preset name.`, { preset: entry.preset });
    }
    try {
      loadPreset(entry.preset);
    } catch (error) {
      fail(`Agent policy path entry ${index} references an unknown or invalid preset: ${entry.preset}.`, {
        preset: entry.preset,
        causeCode: error.code || null,
      });
    }
    try {
      return { pathPrefix: realpathSync(resolve(entry.pathPrefix)), preset: entry.preset };
    } catch (error) {
      fail(`Agent policy path entry ${index} cannot be resolved: ${error.message}`, {
        pathPrefix: entry.pathPrefix,
        causeCode: error.code || null,
      });
    }
  });
}

function containsPath(pathPrefix, repoPath) {
  const remainder = relative(pathPrefix, repoPath);
  return remainder === "" || (remainder !== ".." && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder));
}

export function matchAgentPolicy(repoPath, entries) {
  const matches = entries.filter((entry) => containsPath(entry.pathPrefix, repoPath));
  if (matches.length === 0) return null;
  const longest = Math.max(...matches.map((entry) => entry.pathPrefix.length));
  const highestPriority = matches.filter((entry) => entry.pathPrefix.length === longest);
  const presets = new Set(highestPriority.map((entry) => entry.preset));
  if (presets.size > 1) {
    fail("Agent policy has conflicting presets at the same path priority.", {
      repoPath,
      matches: highestPriority,
    });
  }
  return highestPriority[0];
}

export function agentPolicyPath(env = process.env) {
  return join(env.HOME || homedir(), AGENT_POLICY_FILE);
}

export function resolveAgentPolicy(repoPath, { env = process.env } = {}) {
  const path = agentPolicyPath(env);
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { ...DEFAULT_AGENT_POLICY };
    fail(`Unable to read Agent policy: ${error.message}`, { path, causeCode: error.code || null });
  }

  let policy;
  try {
    policy = JSON.parse(source);
  } catch (error) {
    fail(`Agent policy is not valid JSON: ${error.message}`, { path });
  }
  const entries = validatePolicy(policy);
  let normalizedRepoPath;
  try {
    normalizedRepoPath = realpathSync(resolve(repoPath));
  } catch (error) {
    fail(`Agent policy repository path cannot be resolved: ${error.message}`, {
      repoPath,
      causeCode: error.code || null,
    });
  }
  const matched = matchAgentPolicy(normalizedRepoPath, entries);
  return {
    source: "user-policy",
    autoPreflight: policy.autoPreflight,
    autoBootstrap: policy.autoBootstrap && matched !== null,
    matchedPathPrefix: matched?.pathPrefix || null,
    preset: matched?.preset || null,
  };
}
