#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function parseReport(result) {
  const output = result.status === 2 ? result.stderr : result.stdout;
  const report = JSON.parse(String(output || ""));
  if (
    report?.command !== "preflight"
    || typeof report.status !== "string"
    || typeof report.repoState !== "string"
    || !report.recommendedAction
  ) throw new Error("preflight returned an incomplete Agent decision contract");
  return report;
}

export function runPreflight(cwd, { env = process.env, run = spawnSync } = {}) {
  const installedCli = fileURLToPath(new URL(`../../../../repo-governance${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
  const cli = env.REPO_GOVERNANCE_CLI || (existsSync(installedCli) ? installedCli : "repo-governance");
  const result = run(cli, ["preflight", "--json"], { cwd, env, encoding: "utf8", stdio: "pipe" });
  if (result.error) throw result.error;
  if (![0, 1, 2].includes(result.status)) throw new Error(`preflight exited with unexpected status ${result.status}`);
  return parseReport(result);
}

function managed(report) {
  return report.status === "succeeded" && report.repoState === "managed";
}

export function translateHook(input, report) {
  if (input.hook_event_name === "SessionStart") {
    return {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `repo-governance preflight decision: ${JSON.stringify(report)}`,
      },
    };
  }
  if (input.hook_event_name === "PreToolUse") {
    if (managed(report)) return null;
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Repository write blocked by preflight: ${report.repoState}/${report.status}; action=${report.recommendedAction.id}`,
      },
    };
  }
  throw new Error(`Unsupported Hook event: ${input.hook_event_name}`);
}

function failureOutput(input, error) {
  const reason = `repo-governance preflight failed: ${error.message}`;
  if (input?.hook_event_name === "SessionStart") {
    return {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: reason,
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

export function main({ stdin = readFileSync(0, "utf8"), env = process.env } = {}) {
  let input;
  try {
    input = JSON.parse(stdin);
    const report = runPreflight(input.cwd, { env });
    const output = translateHook(input, report);
    return { exitCode: 0, stdout: output ? `${JSON.stringify(output)}\n` : "", stderr: "" };
  } catch (error) {
    const output = failureOutput(input, error);
    return { exitCode: 0, stdout: `${JSON.stringify(output)}\n`, stderr: "" };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = main();
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
